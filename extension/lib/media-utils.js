/* Mamba Grab — shared helpers (content script, service worker, popup and Node tests).
 * Classic script: attaches to globalThis.MambaUtils and module.exports.
 * Detection only. Nothing here decrypts, extracts keys or touches a CDM: DRM is detected so it can be refused. */
(function (root) {
  'use strict';

  const EXT = {
    video: ['mp4', 'm4v', 'webm', 'mkv', 'mov', 'avi', 'wmv', 'flv', 'ogv', '3gp', 'mpg', 'mpeg', 'ts'],
    audio: ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac', 'weba', 'wma', 'mid', 'midi'],
    image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg', 'tif', 'tiff', 'ico', 'heic', 'jxl'],
    doc: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'txt', 'csv', 'epub', 'mobi', 'djvu', 'xps', 'md', 'json', 'xml'],
    archive: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'iso', 'apk', 'exe', 'msi', 'dmg']
  };
  const STREAM_EXT = { m3u8: 'hls', mpd: 'dash', ism: 'mss' };

  const MIME = [
    [/^application\/(vnd\.apple\.mpegurl|x-mpegurl|mpegurl)/i, 'video', 'hls'],
    [/^audio\/(x-)?mpegurl/i, 'video', 'hls'],
    [/^application\/dash\+xml/i, 'video', 'dash'],
    [/^video\/mp2t/i, 'segment', null],
    [/^video\/iso\.segment/i, 'segment', null],
    [/^video\//i, 'video', null],
    [/^audio\//i, 'audio', null],
    [/^image\//i, 'image', null],
    [/^application\/pdf/i, 'doc', null],
    [/^application\/(msword|vnd\.openxmlformats|vnd\.ms-|vnd\.oasis|epub|rtf)/i, 'doc', null],
    [/^application\/(zip|x-7z|x-rar|gzip|x-tar)/i, 'archive', null]
  ];

  function extOf(url) {
    try {
      const u = new URL(url, 'http://x/');
      const m = /\.([a-z0-9]{1,5})$/i.exec(decodeURIComponent(u.pathname));
      return m ? m[1].toLowerCase() : '';
    } catch (e) { return ''; }
  }

  function fileNameOf(url, fallback) {
    try {
      const u = new URL(url);
      let n = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
      n = n.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').slice(0, 150);
      return n || fallback || u.hostname;
    } catch (e) { return fallback || 'file'; }
  }

  /** Classify a URL (+ optional content-type) → {kind, stream} kind ∈ video|audio|image|doc|archive|segment|other */
  function classify(url, contentType) {
    const ct = (contentType || '').split(';')[0].trim();
    if (ct) {
      for (const [re, kind, stream] of MIME) if (re.test(ct)) {
        if (kind === 'video' && !stream) { const e = extOf(url); if (STREAM_EXT[e]) return { kind: 'video', stream: STREAM_EXT[e] }; }
        return { kind, stream };
      }
    }
    const e = extOf(url);
    if (STREAM_EXT[e]) return { kind: 'video', stream: STREAM_EXT[e] };
    if (e === 'm4s' || (e === 'ts' && /seg|chunk|frag|\d{3,}\.ts$/i.test(url))) return { kind: 'segment', stream: null };
    for (const k of Object.keys(EXT)) if (EXT[k].includes(e)) return { kind: k, stream: null };
    if (/\/manifest\(format=m3u8|format=m3u8|\.m3u8\?/i.test(url)) return { kind: 'video', stream: 'hls' };
    if (/\/manifest\(format=mpd|format=mpd|\.mpd\?/i.test(url)) return { kind: 'video', stream: 'dash' };
    return { kind: 'other', stream: null };
  }

  /** Requests that are pieces of an adaptive stream (not useful on their own). */
  function isSegmentRequest(url, contentType) {
    if (/^https?:\/\/[^/]*googlevideo\.com\/videoplayback/i.test(url)) return true;
    if (/[?&](range|sq|rn)=/.test(url) && /videoplayback|\/range\//i.test(url)) return true;
    const c = classify(url, contentType);
    if (c.kind === 'segment') return true;
    if (/\/(seg|segment|chunk|frag(ment)?)[-_]?\d+/i.test(url) && c.kind !== 'image') return true;
    if (/\.(m4s|m4f|cmfv|cmfa)(\?|$)/i.test(url)) return true;
    return false;
  }

  /** Parse srcset → [{url, w, x}] sorted best first */
  function parseSrcset(srcset, base) {
    if (!srcset) return [];
    const out = [];
    // split on commas that are followed by whitespace+url or that end a descriptor
    const parts = srcset.match(/[^\s,][^\s]*(\s+[\d.]+[wx])?/g) || [];
    for (let p of parts) {
      p = p.trim(); if (!p) continue;
      const m = /^(\S+?)(?:\s+([\d.]+)([wx]))?$/.exec(p);
      if (!m) continue;
      let url = m[1].replace(/,$/, '');
      try { url = new URL(url, base || undefined).href; } catch (e) { continue; }
      out.push({ url, w: m[3] === 'w' ? parseFloat(m[2]) : 0, x: m[3] === 'x' ? parseFloat(m[2]) : (m[3] ? 0 : 1) });
    }
    out.sort((a, b) => (b.w - a.w) || (b.x - a.x));
    return out;
  }

  function bestFromSrcset(srcset, base) { const s = parseSrcset(srcset, base); return s.length ? s[0] : null; }

  /** Known "thumbnail → original" URL rewrites. Returns candidate URLs (best first) — callers verify them. */
  function upgradeCandidates(url) {
    const c = [];
    let u; try { u = new URL(url); } catch (e) { return c; }
    const h = u.hostname, p = u.pathname;
    // Wikimedia / MediaWiki thumbs: /thumb/a/ab/File.jpg/220px-File.jpg → /a/ab/File.jpg
    let m = /^(.*)\/thumb(\/[0-9a-f]\/[0-9a-f]{2}\/[^/]+)\/[^/]+$/.exec(p);
    if (m) c.push((h === 'thumb.wikimedia.org' ? 'https://upload.wikimedia.org' : u.origin) + m[1] + m[2]); // thumbs host → originals host
    // Twitter/X images
    if (/(^|\.)twimg\.com$/.test(h) && /\/media\//.test(p)) {
      const v = new URL(u.href); v.searchParams.set('name', 'orig'); c.push(v.href);
    }
    // Pinterest
    if (/pinimg\.com$/.test(h)) { m = /^\/(\d+x\d*|\d+x)(\/.*)$/.exec(p); if (m) c.push(u.origin + '/originals' + m[2]); }
    // Reddit previews
    if (h === 'preview.redd.it' || h === 'external-preview.redd.it') { if (h === 'preview.redd.it') c.push('https://i.redd.it' + p); }
    // Google user content / Blogger: =s220, =w400-h300, /s320/
    if (/googleusercontent\.com$|ggpht\.com$|bp\.blogspot\.com$/.test(h)) {
      if (/=[swh]\d+[^/]*$/.test(u.href)) c.push(u.href.replace(/=[swh]\d+[^/]*$/, '=s0'));
      m = /^(.*)\/(s|w)\d+(-[a-z0-9-]+)?(\/[^/]+)$/.exec(p); if (m) c.push(u.origin + m[1] + '/s0' + m[4]);
    }
    // YouTube thumbnails
    m = /^\/(vi|vi_webp)\/([\w-]{11})\/[a-z0-9_]+\.(jpg|webp)$/.exec(p);
    if (/ytimg\.com$/.test(h) && m) { c.push(`https://i.ytimg.com/${m[1]}/${m[2]}/maxresdefault.${m[3]}`); c.push(`https://i.ytimg.com/vi/${m[2]}/hqdefault.jpg`); }
    // Amazon media: name._AC_SX300_.jpg → name.jpg
    if (/media-amazon\.com$|images-amazon\.com$|ssl-images-amazon\.com$/.test(h)) { const q = p.replace(/\._[^/]*_\.(\w+)$/, '.$1'); if (q !== p) c.push(u.origin + q); }
    // Imgur size suffix (s,b,t,m,l,h): abcdefgl.jpg → abcdefg.jpg
    if (h === 'i.imgur.com') { m = /^\/(\w{7})[sbtmlh]\.(\w+)$/.exec(p); if (m) c.push(`${u.origin}/${m[1]}.${m[2]}`); }
    // Shopify: _300x.jpg / _300x200.jpg / _small.jpg
    if (/cdn\.shopify\.com$|\/cdn\/shop\//.test(h + p)) { const q = p.replace(/_(\d+x\d*|\d*x\d+|pico|icon|thumb|small|compact|medium|large|grande)(@\dx)?(\.\w+)$/, '$3'); if (q !== p) c.push(u.origin + q); const v = new URL(u.href); if (v.searchParams.has('width')) { v.searchParams.delete('width'); c.push(v.href); } }
    // WordPress resized: name-300x200.jpg → name.jpg ; also ?w=300 / ?resize=
    m = /^(.*)-\d{2,5}x\d{2,5}(\.(jpe?g|png|webp|gif|avif))$/i.exec(p); if (m) c.push(u.origin + m[1] + m[2] + u.search);
    if (/wp\.com$|\/wp-content\//.test(h + p) && /[?&](w|h|resize|fit)=/.test(u.search)) c.push(u.origin + p);
    // Tumblr: _500.jpg → _1280.jpg
    if (/media\.tumblr\.com$/.test(h)) { m = /^(.*)_(\d{2,4})(\.\w+)$/.exec(p); if (m && +m[2] < 1280) c.push(u.origin + m[1] + '_1280' + m[3]); }
    // Flickr: _m/_n/_q/_s/_t/_z/_c → _b (1024)
    if (/staticflickr\.com$/.test(h)) { m = /^(.*_\w+)_[mnqstzc](\.jpg)$/.exec(p); if (m) c.push(u.origin + m[1] + '_b' + m[2]); }
    // Generic CDN resize query params (imgix, cloudinary-like ?w= ?width= ?h=)
    if (/[?&](w|width|h|height|resize|size)=\d+/i.test(u.search) && !c.length) {
      const v = new URL(u.href); for (const k of ['w', 'width', 'h', 'height', 'resize', 'size', 'fit', 'crop', 'q', 'quality', 'dpr']) v.searchParams.delete(k);
      if (v.href !== u.href) c.push(v.href);
    }
    // Cloudinary transformations: /upload/w_300,h_200,c_fill/ → /upload/
    m = /^(.*\/upload\/)(?:[a-z]{1,2}_[^/]+\/)+(v\d+\/.*)$/.exec(p); if (/cloudinary\.com$/.test(h) && m) c.push(u.origin + m[1] + m[2]);
    return [...new Set(c.filter(x => x !== url))];
  }

  // ── DRM detection (manifests). Detection only — used to REFUSE downloads. ──
  const DRM_SYSTEMS = {
    'edef8ba9-79d6-4ace-a3c8-27dcd51d21ed': 'Widevine',
    '9a04f079-9840-4286-ab92-e65be0885f95': 'PlayReady',
    '94ce86fb-07ff-4f43-adb8-93d2fa968ca2': 'FairPlay',
    'e2719d58-a985-b3c9-781a-b030af78d30e': 'ClearKey',
    '3ea8778f-7742-4bf9-b18b-e834b2acbd47': 'ClearKey',
    'f239e769-efa3-4850-9c16-a903c6932efb': 'Adobe Primetime',
    '5e629af5-38da-4063-8977-97ffbd9902d4': 'Marlin'
  };

  /** HLS playlist → {drm, system, encryptedAes128, master, variants:[{url,width,height,bandwidth}]} */
  function parseHls(text, baseUrl) {
    const r = { drm: false, system: null, aes128: false, master: false, variants: [], audio: [] };
    if (!/^#EXTM3U/m.test(text || '')) return r;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (/^#EXT-X-(SESSION-)?KEY:/i.test(l)) {
        const method = (/METHOD=([A-Z0-9-]+)/i.exec(l) || [])[1] || '';
        const fmt = ((/KEYFORMAT="([^"]+)"/i.exec(l) || [])[1] || '').toLowerCase();
        if (/^SAMPLE-AES/i.test(method) || (fmt && fmt !== 'identity')) {
          r.drm = true;
          if (/streamingkeydelivery|fairplay/.test(fmt) || /^skd:/i.test((/URI="([^"]+)"/i.exec(l) || [])[1] || '')) r.system = 'FairPlay';
          else if (fmt.includes('edef8ba9')) r.system = 'Widevine';
          else if (fmt.includes('playready') || fmt.includes('9a04f079')) r.system = 'PlayReady';
          else r.system = r.system || 'SAMPLE-AES';
        } else if (/^AES-128$/i.test(method)) r.aes128 = true;
      } else if (/^#EXT-X-STREAM-INF:/i.test(l)) {
        r.master = true;
        const res = /RESOLUTION=(\d+)x(\d+)/i.exec(l), bw = /[^-]BANDWIDTH=(\d+)/i.exec(l) || /^#EXT-X-STREAM-INF:BANDWIDTH=(\d+)/i.exec(l);
        let j = i + 1; while (j < lines.length && (!lines[j].trim() || lines[j].trim().startsWith('#'))) j++;
        if (j < lines.length) {
          let url = lines[j].trim(); try { url = new URL(url, baseUrl).href; } catch (e) { }
          r.variants.push({ url, width: res ? +res[1] : 0, height: res ? +res[2] : 0, bandwidth: bw ? +bw[1] : 0 });
        }
      } else if (/^#EXT-X-MEDIA:.*TYPE=AUDIO/i.test(l)) r.audio.push(((/NAME="([^"]+)"/i.exec(l) || [])[1]) || 'audio');
    }
    r.variants.sort((a, b) => (b.height - a.height) || (b.bandwidth - a.bandwidth));
    return r;
  }

  /** DASH MPD → {drm, system, heights:[...], maxHeight} */
  function parseMpd(text) {
    const r = { drm: false, system: null, heights: [], maxHeight: 0 };
    if (!/<MPD[\s>]/i.test(text || '')) return r;
    const re = /<(?:\w+:)?ContentProtection\b([^>]*)>/gi; let m;
    while ((m = re.exec(text))) {
      const attrs = m[1];
      const scheme = ((/schemeIdUri="([^"]+)"/i.exec(attrs) || [])[1] || '').toLowerCase();
      const uuid = (/urn:uuid:([0-9a-f-]{36})/i.exec(scheme) || [])[1];
      if (/urn:mpeg:dash:mp4protection:2011/.test(scheme) || uuid) {
        r.drm = true;
        if (uuid && DRM_SYSTEMS[uuid]) r.system = r.system && r.system !== 'CENC' ? r.system : DRM_SYSTEMS[uuid];
        else if (!r.system) r.system = 'CENC';
      }
    }
    const hr = /<Representation\b[^>]*\bheight="(\d+)"/gi;
    while ((m = hr.exec(text))) r.heights.push(+m[1]);
    const ar = /<AdaptationSet\b[^>]*\bmaxHeight="(\d+)"/gi;
    while ((m = ar.exec(text))) r.heights.push(+m[1]);
    r.heights = [...new Set(r.heights)].sort((a, b) => b - a);
    r.maxHeight = r.heights[0] || 0;
    return r;
  }

  /** Services that only ship DRM-protected video — the app refuses them up front. */
  const DRM_ONLY_HOSTS = [
    'netflix.com', 'disneyplus.com', 'primevideo.com', 'max.com', 'hbomax.com', 'hulu.com', 'tv.apple.com',
    'music.apple.com', 'open.spotify.com', 'tidal.com', 'deezer.com', 'peacocktv.com', 'paramountplus.com',
    'viaplay.com', 'viaplay.se', 'dazn.com', 'skyshowtime.com', 'crunchyroll.com', 'play.max.com'
  ];
  function isDrmOnlySite(url) {
    let h; try { h = new URL(url).hostname.toLowerCase(); } catch (e) { return false; }
    if (/(^|\.)amazon\.[a-z.]+$/.test(h) && /\/(gp\/video|video\/detail)/.test(String(url))) return true;
    return DRM_ONLY_HOSTS.some(d => h === d || h.endsWith('.' + d));
  }

  /** Sites where yt-dlp gives a much better result from the PAGE url than from sniffed requests. */
  const YTDLP_PREFERRED = ['youtube.com', 'youtu.be', 'vimeo.com', 'dailymotion.com', 'twitch.tv', 'tiktok.com', 'instagram.com', 'facebook.com', 'fb.watch', 'x.com', 'twitter.com', 'reddit.com', 'soundcloud.com', 'bandcamp.com', 'bilibili.com', 'rumble.com', 'odysee.com', 'streamable.com', 'svtplay.se', 'nrk.no', 'dr.dk', 'arte.tv', 'ted.com', 'bbc.co.uk', 'archive.org', 'commons.wikimedia.org', 'mixcloud.com', 'kick.com', 'linkedin.com', 'pinterest.com', 'tumblr.com', 'imgur.com', '9gag.com', 'vk.com', 'ok.ru', 'niconico.jp', 'nicovideo.jp', 'aparat.com', 'shahid.mbc.net'];
  function isYtdlpSite(url) {
    let h; try { h = new URL(url).hostname.toLowerCase(); } catch (e) { return false; }
    return YTDLP_PREFERRED.some(d => h === d || h.endsWith('.' + d));
  }

  function humanSize(n) {
    if (!n || n < 0) return '';
    const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i ? n.toFixed(n < 10 ? 1 : 0) : n) + ' ' + u[i];
  }

  /** Netscape cookies.txt from chrome.cookies objects (used only for the user's own session, opt-in). */
  function toNetscapeCookies(cookies) {
    const lines = ['# Netscape HTTP Cookie File', '# Generated by Mamba Grab for a single download; deleted afterwards.'];
    for (const c of cookies || []) {
      const domain = (c.hostOnly ? '' : (c.domain.startsWith('.') ? '' : '.')) + c.domain;
      const exp = c.session || !c.expirationDate ? 0 : Math.floor(c.expirationDate);
      lines.push([c.httpOnly ? '#HttpOnly_' + domain : domain, c.hostOnly ? 'FALSE' : 'TRUE', c.path || '/', c.secure ? 'TRUE' : 'FALSE', exp, c.name, c.value].join('\t'));
    }
    return lines.join('\n') + '\n';
  }

  const api = { EXT, classify, extOf, fileNameOf, isSegmentRequest, parseSrcset, bestFromSrcset, upgradeCandidates, parseHls, parseMpd, DRM_SYSTEMS, isDrmOnlySite, isYtdlpSite, humanSize, toNetscapeCookies, DRM_MESSAGE_KEY: 'drmBlocked' };
  root.MambaUtils = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
