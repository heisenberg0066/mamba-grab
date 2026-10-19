/* Mamba Grab content script: page scanner + DRM detection + "download this video" hover button.
 * DRM handling is detection only (EME 'encrypted' event / HTMLMediaElement.mediaKeys) so the extension can refuse. */
(function () {
  'use strict';
  if (window.__mambaGrabLoaded) return; window.__mambaGrabLoaded = true;
  const U = globalThis.MambaUtils;
  const drm = { detected: false, how: '' };

  function markDrm(how) {
    if (drm.detected) return;
    drm.detected = true; drm.how = how;
    try { chrome.runtime.sendMessage({ type: 'drm-detected', how, frameUrl: location.href }); } catch (e) { }
  }
  // EME: an 'encrypted' event (fires on media elements, caught in capture phase) or attached MediaKeys = DRM playback.
  document.addEventListener('encrypted', (e) => markDrm('eme-encrypted:' + (e.initDataType || '')), true);
  function checkMediaKeys() {
    for (const m of document.querySelectorAll('video,audio')) if (m.mediaKeys) { markDrm('eme-mediakeys'); return; }
  }
  setInterval(checkMediaKeys, 2500);

  const abs = (u) => { try { if (!u || /^(javascript|about|mailto|tel):/i.test(u)) return null; return new URL(u, document.baseURI).href; } catch (e) { return null; } };
  const LAZY_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-lazy', 'data-url', 'data-hi-res-src', 'data-hires', 'data-full', 'data-full-src', 'data-fullsrc', 'data-large', 'data-large-src', 'data-zoom', 'data-zoom-image', 'data-zoom-src', 'data-big', 'data-orig', 'data-orig-file', 'data-original-src', 'data-image', 'data-img', 'data-highres', 'data-actualsrc', 'data-pin-media', 'data-flickity-lazyload'];
  const LAZY_SRCSET = ['data-srcset', 'data-lazy-srcset', 'data-original-set'];

  // wiki-style pages named after a file ("/wiki/File:Clip.ogv", "index.php?title=…") are HTML pages, not files
  function looksLikePage(h) {
    try { const pu = new URL(h); let p = pu.pathname; try { p = decodeURIComponent(p); } catch (e) { } return /\/wiki\/|\/index\.php/i.test(pu.pathname) || /[^/]:[^/]/.test(p) || pu.searchParams.has('title'); } catch (e) { return true; }
  }

  function scan() {
    const items = new Map();
    const add = (it) => {
      if (!it.url) return;
      if (/^data:/i.test(it.url) && it.url.length < 2000) return; // tiny inline icons
      const key = it.url;
      const prev = items.get(key);
      if (prev) { prev.width = Math.max(prev.width || 0, it.width || 0); prev.height = Math.max(prev.height || 0, it.height || 0); if (!prev.title && it.title) prev.title = it.title; return; }
      const c = U.classify(it.url, it.mime);
      items.set(key, Object.assign({ kind: c.kind === 'other' ? (it.kindHint || 'other') : c.kind, stream: c.stream, frameUrl: location.href }, it));
    };

    // images: <img>, <picture>, srcset, lazy attributes
    for (const img of document.images) {
      const cands = [];
      if (img.currentSrc) cands.push({ url: img.currentSrc, w: img.naturalWidth });
      if (img.src) cands.push({ url: img.src, w: img.naturalWidth });
      const ss = [img.getAttribute('srcset')];
      for (const a of LAZY_SRCSET) ss.push(img.getAttribute(a));
      if (img.parentElement && img.parentElement.tagName === 'PICTURE') for (const s of img.parentElement.querySelectorAll('source')) { ss.push(s.getAttribute('srcset')); ss.push(s.getAttribute('data-srcset')); }
      for (const s of ss) { const b = U.bestFromSrcset(s, document.baseURI); if (b) cands.push({ url: b.url, w: b.w || 0, srcset: true }); }
      for (const a of LAZY_ATTRS) { const v = abs(img.getAttribute(a)); if (v && !/^data:/.test(v)) cands.push({ url: v, w: 0, lazy: true }); }
      // a wrapping link that points at an image file is usually the full-size original
      const link = img.closest('a[href]');
      if (link) { const h = abs(link.getAttribute('href')); if (h && !looksLikePage(h) && U.classify(h).kind === 'image') cands.push({ url: h, w: 1e9, link: true }); }
      if (!cands.length) continue;
      // pick: linked original > lazy full > largest srcset > current
      const best = cands.find(c => c.link) || cands.filter(c => c.srcset).sort((a, b) => b.w - a.w)[0] || cands.find(c => c.lazy) || cands[0];
      const others = [...new Set(cands.map(c => c.url).filter(u => u && u !== best.url))];
      add({ url: abs(best.url), kindHint: 'image', source: best.link ? 'link' : best.srcset ? 'srcset' : best.lazy ? 'lazy' : 'img', width: best.url === img.currentSrc ? img.naturalWidth : 0, height: best.url === img.currentSrc ? img.naturalHeight : 0, thumb: img.currentSrc || img.src, title: img.alt || img.title || '', alternates: others, upgrade: U.upgradeCandidates(abs(best.url) || '') });
    }

    // CSS background images (bounded walk)
    let n = 0;
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode() && n < 6000) {
      n++;
      const el = walker.currentNode;
      const bg = getComputedStyle(el).backgroundImage;
      if (!bg || bg === 'none' || !bg.includes('url(')) continue;
      const re = /url\((['"]?)(.*?)\1\)/g; let m;
      while ((m = re.exec(bg))) {
        const u = abs(m[2]); if (!u) continue;
        const r = el.getBoundingClientRect();
        if (r.width * r.height < 40 * 40 && !/^data:/.test(u)) continue;
        add({ url: u, kindHint: 'image', source: 'css', thumb: u, title: el.getAttribute('aria-label') || el.title || '', upgrade: U.upgradeCandidates(u) });
      }
    }

    // video / audio elements
    for (const m of document.querySelectorAll('video,audio')) {
      const isV = m.tagName === 'VIDEO';
      const srcs = [m.currentSrc, m.src, ...[...m.querySelectorAll('source')].map(s => s.src)].filter(Boolean);
      const poster = isV ? abs(m.getAttribute('poster')) : null;
      let addedAny = false;
      for (const s of new Set(srcs)) {
        if (/^blob:/i.test(s)) continue;
        const t = m.querySelector(`source[src="${CSS.escape(s)}"]`);
        add({ url: s, kindHint: isV ? 'video' : 'audio', mime: t && t.type, source: m.tagName.toLowerCase(), width: isV ? m.videoWidth : 0, height: isV ? m.videoHeight : 0, thumb: poster, duration: isFinite(m.duration) ? m.duration : 0, title: m.title || m.getAttribute('aria-label') || document.title });
        addedAny = true;
      }
      for (const tr of m.querySelectorAll('track[src]')) add({ url: abs(tr.getAttribute('src')), kindHint: 'doc', source: 'subtitle', title: (tr.label || tr.srclang || 'subtitles') });
      if (!addedAny && srcs.some(s => /^blob:/i.test(s))) {
        add({ url: location.href + '#mamba-blob-' + items.size, kindHint: isV ? 'video' : 'audio', source: 'blob', blob: true, page: location.href, width: isV ? m.videoWidth : 0, height: isV ? m.videoHeight : 0, thumb: poster, duration: isFinite(m.duration) ? m.duration : 0, title: document.title, encrypted: !!m.mediaKeys });
      }
      if (poster) add({ url: poster, kindHint: 'image', source: 'poster', thumb: poster, title: 'Poster', upgrade: U.upgradeCandidates(poster) });
    }

    // embeds / objects / iframes of known players
    for (const e of document.querySelectorAll('embed[src],object[data]')) add({ url: abs(e.getAttribute('src') || e.getAttribute('data')), source: 'embed', title: e.title || '' });
    for (const f of document.querySelectorAll('iframe[src]')) {
      const s = abs(f.getAttribute('src'));
      if (s && U.isYtdlpSite(s) && /embed|player|video/i.test(s)) add({ url: s, kindHint: 'video', source: 'iframe-player', page: s, title: f.title || 'Embedded player' });
    }

    // links to files
    const here = location.href.split('#')[0];
    for (const a of document.querySelectorAll('a[href]')) {
      let h = abs(a.getAttribute('href')); if (!h || !/^https?:/i.test(h)) continue;
      h = h.split('#')[0]; if (h === here) continue;
      if (looksLikePage(h)) continue;
      const c = U.classify(h);
      if (c.kind === 'other' || c.kind === 'segment') continue;
      add({ url: h, source: 'link', title: (a.textContent || '').trim().slice(0, 120) || a.title || '', thumb: c.kind === 'image' ? h : null, upgrade: c.kind === 'image' ? U.upgradeCandidates(h) : undefined });
    }

    // meta tags
    for (const [sel, hint] of [['meta[property="og:image"],meta[property="og:image:url"],meta[name="twitter:image"]', 'image'], ['meta[property="og:video"],meta[property="og:video:url"],meta[property="og:video:secure_url"],meta[name="twitter:player:stream"]', 'video'], ['meta[property="og:audio"]', 'audio'], ['link[rel="image_src"]', 'image']]) {
      for (const m of document.querySelectorAll(sel)) { const u = abs(m.getAttribute('content') || m.getAttribute('href')); if (u) add({ url: u, kindHint: hint, source: 'meta', thumb: hint === 'image' ? u : null, title: document.title, upgrade: hint === 'image' ? U.upgradeCandidates(u) : undefined }); }
    }

    // inline <svg> are skipped; <a download> to blob skipped
    checkMediaKeys();
    return {
      frameUrl: location.href, top: window === window.top, title: document.title,
      items: [...items.values()].filter(i => i.url && !/^(blob|javascript):/i.test(i.url)),
      drm: drm.detected, drmHow: drm.how,
      hasVideoElement: !!document.querySelector('video'),
      hasBlobVideo: [...document.querySelectorAll('video')].some(v => /^blob:/.test(v.currentSrc || v.src || ''))
    };
  }
  window.__mambaScan = scan;

  // ── one-click hover button on videos ──
  let host = null, btn = null, current = null, hideT = 0, enabled = true, langPref = '';
  try { chrome.storage.local.get({ hoverButton: true, lang: '' }, (s) => { enabled = s.hoverButton !== false; langPref = s.lang; if (btn) btn.textContent = label(langPref); }); } catch (e) { }
  const label = (lang) => ((lang || (navigator.language || '').slice(0, 2)) === 'ar' ? '⬇ تنزيل هذا الفيديو' : '⬇ Download this video');
  function ensureBtn() {
    if (host) return;
    host = document.createElement('mamba-grab-button');
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483646;display:none;';
    const sh = host.attachShadow({ mode: 'closed' });
    sh.innerHTML = '<style>button{all:initial;font:600 12px "Segoe UI",system-ui,sans-serif;color:#fff;background:linear-gradient(135deg,#ff7a00,#ff9a3d);padding:6px 11px;border-radius:8px;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.35)}button:hover{filter:brightness(1.08)}.msg{display:block;max-width:260px;margin-top:6px;font:12px "Segoe UI",system-ui,sans-serif;color:#fff;background:#1f2937;padding:7px 9px;border-radius:8px}</style><button></button><span class="msg" hidden></span>';
    btn = sh.querySelector('button'); const msg = sh.querySelector('.msg');
    btn.textContent = label(langPref);
    btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const v = current; if (!v) return;
      if (v.mediaKeys) markDrm('eme-mediakeys');
      const src = v.currentSrc || v.src || '';
      chrome.runtime.sendMessage({ type: 'download-this-video', pageUrl: location.href, topUrl: (window === window.top ? location.href : document.referrer || location.href), src: /^blob:/.test(src) ? '' : src, title: document.title, drm: drm.detected }, (r) => {
        if (chrome.runtime.lastError) r = { ok: false, message: chrome.runtime.lastError.message };
        msg.hidden = false; msg.textContent = (r && r.message) || '…';
        setTimeout(() => { msg.hidden = true; }, 5000);
      });
    });
    host.addEventListener('mouseenter', () => clearTimeout(hideT));
    host.addEventListener('mouseleave', () => { hideT = setTimeout(() => { host.style.display = 'none'; }, 800); });
    (document.body || document.documentElement).appendChild(host);
  }
  document.addEventListener('mouseover', (e) => {
    if (!enabled) return;
    const v = e.target && e.target.closest ? e.target.closest('video') : null;
    let target = v;
    if (!target) { // many players put an overlay above the <video>
      const el = document.elementsFromPoint ? document.elementsFromPoint(e.clientX, e.clientY).find(x => x.tagName === 'VIDEO') : null;
      target = el || null;
    }
    if (!target) return;
    const r = target.getBoundingClientRect();
    if (r.width < 200 || r.height < 120) return;
    ensureBtn(); clearTimeout(hideT); current = target;
    host.style.top = Math.max(4, r.top + 10) + 'px'; host.style.left = Math.max(4, r.left + 10) + 'px'; host.style.display = 'block';
    hideT = setTimeout(() => { host.style.display = 'none'; }, 4000);
  }, { passive: true, capture: true });
})();
