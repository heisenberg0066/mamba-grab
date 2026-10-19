/* Mamba Grab — service worker: network sniffing, DRM detection, native messaging bridge, downloads. */
'use strict';
importScripts('lib/media-utils.js', 'lib/i18n.js');
const U = globalThis.MambaUtils;
const T = (k, lang, vars) => globalThis.MambaI18n.t(k, lang, vars);
const HOST = 'com.ammar.mambagrab';
const DEFAULTS = { lang: '', cookieMode: 'off', cookieBrowser: 'auto', autoStartApp: true, subfolder: true, hoverButton: true, quality: 'best', format: 'mp4', playlist: false, subs: false, thumb: false };

// ───────────── per-tab state (memory + storage.session so it survives SW restarts) ─────────────
const tabs = new Map(); // tabId → {pageUrl, items: Map(url→item), drm:{detected,how,system}}
let saveT = 0;
function tabState(tabId) {
  let s = tabs.get(tabId);
  if (!s) { s = { pageUrl: '', items: new Map(), drm: { detected: false, how: '', system: '' } }; tabs.set(tabId, s); }
  return s;
}
function persist() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const o = {};
    for (const [id, s] of tabs) o[id] = { pageUrl: s.pageUrl, items: [...s.items.values()].slice(-400), drm: s.drm };
    chrome.storage.session.set({ tabs: o }).catch(() => { });
  }, 400);
}
const ready = chrome.storage.session.get('tabs').then(({ tabs: o }) => {
  for (const id in o || {}) { const s = tabState(+id); s.pageUrl = o[id].pageUrl; s.drm = o[id].drm || s.drm; for (const it of o[id].items || []) s.items.set(it.url, it); }
}).catch(() => { });

function resetTab(tabId, url) { tabs.set(tabId, { pageUrl: url || '', items: new Map(), drm: { detected: false, how: '', system: '' } }); updateBadge(tabId); persist(); }
chrome.tabs.onRemoved.addListener((id) => { tabs.delete(id); persist(); });

function updateBadge(tabId) {
  const s = tabs.get(tabId);
  const n = s ? [...s.items.values()].filter(i => i.kind === 'video' || i.kind === 'audio').length : 0;
  const drm = s && s.drm.detected;
  chrome.action.setBadgeBackgroundColor({ tabId, color: drm ? '#6b7280' : '#ff7a00' }).catch(() => { });
  chrome.action.setBadgeText({ tabId, text: drm ? '🔒' : (n ? String(Math.min(n, 99)) : '') }).catch(() => { });
}

function markDrm(tabId, how, system) {
  const s = tabState(tabId);
  if (!s.drm.detected) { s.drm = { detected: true, how, system: system || '' }; updateBadge(tabId); persist(); }
  else if (system && !s.drm.system) { s.drm.system = system; persist(); }
}

// ───────────── network sniffing ─────────────
const LICENSE_RE = /widevine|playready|fairplay|clearkey|\/(get)?license(s)?(\/|\?|$)|drm[-_]?license|license[-_.]?(server|proxy|acquisition)|\/lic\?|cenc\/license|rightsmanager\.asmx|\/wv\/|\/fps\/|getckc|\/ckc(\?|$)/i;
chrome.webRequest.onBeforeRequest.addListener((d) => {
  if (d.tabId < 0) return;
  if (d.type === 'main_frame') { resetTab(d.tabId, d.url); return; }
  // EME licence request (POST to a licence server) → page plays DRM content. Detection only.
  if (d.method === 'POST' && (d.type === 'xmlhttprequest' || d.type === 'other') && LICENSE_RE.test(d.url)) markDrm(d.tabId, 'license-request', /playready|rightsmanager/i.test(d.url) ? 'PlayReady' : /fairplay|fps|ckc/i.test(d.url) ? 'FairPlay' : /widevine|wv/i.test(d.url) ? 'Widevine' : '');
}, { urls: ['<all_urls>'] });

chrome.webRequest.onResponseStarted.addListener((d) => {
  if (d.tabId < 0 || d.type === 'main_frame' || d.type === 'sub_frame' || d.type === 'script' || d.type === 'stylesheet' || d.type === 'font') return;
  if (!/^https?:/i.test(d.url)) return;
  const h = {}; for (const x of d.responseHeaders || []) h[x.name.toLowerCase()] = x.value;
  const ct = h['content-type'] || '';
  if (U.isSegmentRequest(d.url, ct)) {
    if (/googlevideo\.com\/videoplayback/.test(d.url)) { const s = tabState(d.tabId); s.ytdlpOnly = true; }
    return;
  }
  const c = U.classify(d.url, ct);
  if (!['video', 'audio'].includes(c.kind) && !(c.kind === 'doc' && d.type !== 'image') && !(c.kind === 'image' && d.type === 'image')) return;
  if (c.kind === 'image') {
    // images are found by the DOM scan; sniff only big ones (lazy galleries, canvases)
    const len = +h['content-length'] || 0; if (len < 60 * 1024) return;
  }
  let size = +h['content-length'] || 0;
  const cr = /\/(\d+)\s*$/.exec(h['content-range'] || ''); if (cr) size = +cr[1];
  if (c.kind === 'video' && !c.stream && size && size < 150 * 1024 && d.statusCode === 206) return; // probe ranges
  const s = tabState(d.tabId);
  const prev = s.items.get(d.url);
  const it = Object.assign(prev || {}, { url: d.url, kind: c.kind, stream: c.stream, mime: ct.split(';')[0], size: size || (prev && prev.size) || 0, source: 'network', frameUrl: d.initiator || '', ts: Date.now() });
  s.items.set(d.url, it);
  if (c.stream && !it.analyzed) analyzeManifest(d.tabId, it);
  updateBadge(d.tabId); persist();
}, { urls: ['<all_urls>'] }, ['responseHeaders']);

async function analyzeManifest(tabId, it) {
  it.analyzed = true;
  try {
    const r = await fetch(it.url, { credentials: 'include' });
    const text = await r.text();
    if (it.stream === 'hls') {
      const p = U.parseHls(text, it.url);
      if (p.master && p.variants.length) {
        it.variants = p.variants.slice(0, 12); it.height = p.variants[0].height; it.width = p.variants[0].width;
        if (!p.drm) { try { const t2 = await (await fetch(p.variants[0].url, { credentials: 'include' })).text(); const p2 = U.parseHls(t2, p.variants[0].url); if (p2.drm) { p.drm = true; p.system = p2.system; } if (p2.aes128) it.aes128 = true; } catch (e) { } }
      } else if (!p.master) {
        // media playlist: if a master for it is already known, hide this child entry
        const s = tabState(tabId);
        for (const o of s.items.values()) if (o.variants && o.variants.some(v => v.url === it.url)) { it.child = true; break; }
      }
      if (p.aes128) it.aes128 = true;
      if (p.drm) { it.drm = true; it.drmSystem = p.system; markDrm(tabId, 'hls-manifest', p.system); }
    } else if (it.stream === 'dash') {
      const p = U.parseMpd(text);
      it.height = p.maxHeight; it.heights = p.heights;
      if (p.drm) { it.drm = true; it.drmSystem = p.system; markDrm(tabId, 'dash-manifest', p.system); }
    }
  } catch (e) { it.analyzeError = String(e && e.message || e); }
  persist();
}

// ───────────── native messaging ─────────────
function native(msg, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve({ ok: false, error: 'timeout', appRunning: false }); } }, timeoutMs);
    try {
      chrome.runtime.sendNativeMessage(HOST, msg, (resp) => {
        if (done) return; done = true; clearTimeout(t);
        const err = chrome.runtime.lastError;
        if (err) resolve({ ok: false, error: err.message, notInstalled: /not found|forbidden|access/i.test(err.message), appRunning: false });
        else resolve(resp || { ok: false, error: 'empty reply' });
      });
    } catch (e) { done = true; clearTimeout(t); resolve({ ok: false, error: String(e), notInstalled: true }); }
  });
}
async function settings() { return Object.assign({}, DEFAULTS, await chrome.storage.local.get(DEFAULTS)); }
async function appStatus() {
  const s = await settings();
  return native({ cmd: 'ping', launch: s.autoStartApp }, s.autoStartApp ? 25000 : 8000);
}

function browserName() {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'edge';
  if (navigator.brave) return 'brave';
  return 'chrome';
}

async function cookiesFor(urls) {
  try {
    if (!(await chrome.permissions.contains({ permissions: ['cookies'] }))) return null;
    const seen = new Map();
    for (const u of urls) { if (!/^https?:/.test(u || '')) continue; for (const c of await chrome.cookies.getAll({ url: u })) seen.set(c.domain + '|' + c.path + '|' + c.name, c); }
    return seen.size ? U.toNetscapeCookies([...seen.values()]) : null;
  } catch (e) { return null; }
}

/** Build a job for the companion app (yt-dlp). */
async function makeJob(o) {
  const s = await settings();
  const job = {
    url: o.url, referer: o.referer || '', title: o.title || '', userAgent: navigator.userAgent,
    fallbackUrls: (o.fallbackUrls || []).filter(Boolean),
    quality: o.quality || s.quality, format: o.format || s.format, playlist: o.playlist != null ? o.playlist : s.playlist,
    subs: o.subs != null ? o.subs : s.subs, thumb: o.thumb != null ? o.thumb : s.thumb, source: 'extension'
  };
  if (s.cookieMode === 'browser') job.cookiesFromBrowser = s.cookieBrowser === 'auto' ? browserName() : s.cookieBrowser;
  else if (s.cookieMode === 'extension') { const c = await cookiesFor([o.url, o.referer, ...(job.fallbackUrls)]); if (c) job.cookiesTxt = c; }
  return job;
}

async function sendToApp(o) {
  const s = await settings();
  const job = await makeJob(o);
  return native({ cmd: 'enqueue', job, launch: s.autoStartApp }, s.autoStartApp ? 30000 : 10000);
}

async function directDownload(items, opts = {}) {
  const s = await settings();
  const results = [];
  for (const it of items) {
    let name = (it.filename || U.fileNameOf(it.url, (it.kind || 'file'))).replace(/^\.+/, '');
    if (!/\.[a-z0-9]{2,5}$/i.test(name)) { const ext = (it.mime || '').split('/')[1]; if (ext && /^[a-z0-9]+$/.test(ext)) name += '.' + ext.replace('jpeg', 'jpg').replace('quicktime', 'mov'); }
    let folder = '';
    if (s.subfolder) { let host = 'page'; try { host = new URL(opts.pageUrl || it.url).hostname.replace(/^www\./, ''); } catch (e) { } folder = 'Mamba Grab/' + host.replace(/[^\w.-]+/g, '_') + '/'; }
    try {
      const id = await chrome.downloads.download({ url: it.url, filename: folder + name, conflictAction: 'uniquify', saveAs: false });
      results.push({ url: it.url, ok: true, id });
    } catch (e) {
      try { const id = await chrome.downloads.download({ url: it.url, conflictAction: 'uniquify' }); results.push({ url: it.url, ok: true, id }); }
      catch (e2) { results.push({ url: it.url, ok: false, error: String(e2.message || e2) }); }
    }
  }
  return results;
}

const isDirectHttp = (u) => /^https?:/i.test(u || '') && !U.classify(u).stream;

/** One-click "download this video" from the hover button, the popup or the context menu. */
async function downloadThisVideo(tabId, o) {
  const s = await settings(); const lang = s.lang;
  await ready;
  const st = tabState(tabId);
  const pageUrl = o.topUrl || o.pageUrl || st.pageUrl;
  if (o.drm || st.drm.detected || U.isDrmOnlySite(pageUrl)) return { ok: false, drm: true, message: T('drmBlocked', lang) };
  const sniffed = [...st.items.values()].filter(i => (i.kind === 'video' || i.kind === 'audio') && !i.child);
  if (sniffed.some(i => i.drm)) return { ok: false, drm: true, message: T('drmBlocked', lang) };
  const streams = sniffed.filter(i => i.stream).sort((a, b) => (b.height || 0) - (a.height || 0));
  const files = sniffed.filter(i => !i.stream && i.kind === 'video').sort((a, b) => (b.size || 0) - (a.size || 0));
  const fallbackUrls = [o.src, ...streams.map(i => i.url), ...files.map(i => i.url)].filter(Boolean);
  // 1) companion app (yt-dlp on the page URL; falls back to the sniffed stream/file)
  const r = await sendToApp({ url: o.url || pageUrl, referer: pageUrl, title: o.title, fallbackUrls, quality: o.quality, format: o.format });
  if (r && r.ok) return { ok: true, via: 'app', jobId: r.job && r.job.id, message: T('sentToApp', lang) };
  if (r && r.drm) return { ok: false, drm: true, message: T('drmBlocked', lang) };
  // 2) browser downloads API for a direct file
  const direct = isDirectHttp(o.src) ? o.src : (files[0] && files[0].url);
  if (direct) { await directDownload([{ url: direct, kind: 'video', mime: files[0] && files[0].mime }], { pageUrl }); return { ok: true, via: 'browser', message: T('savedViaBrowser', lang) }; }
  return { ok: false, needApp: true, message: r && r.notInstalled ? T('needAppInstall', lang) : T('needAppRunning', lang) };
}

// ───────────── messages ─────────────
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  (async () => {
    await ready;
    const tabId = m.tabId != null ? m.tabId : (sender.tab && sender.tab.id);
    switch (m.type) {
      case 'drm-detected': if (tabId != null) markDrm(tabId, m.how); return { ok: true };
      case 'get-tab': { const s = tabState(tabId); return { pageUrl: s.pageUrl, items: [...s.items.values()], drm: s.drm, ytdlpOnly: !!s.ytdlpOnly }; }
      case 'download-this-video': return downloadThisVideo(tabId, m);
      case 'direct-download': return { ok: true, results: await directDownload(m.items, m) };
      case 'send-to-app': {
        const s = await settings();
        if (U.isDrmOnlySite(m.url) || m.drm) return { ok: false, drm: true, message: T('drmBlocked', s.lang) };
        return sendToApp(m);
      }
      case 'app-status': return appStatus();
      case 'native': return native(m.msg, m.timeout || 15000);
      case 'make-job': return makeJob(m);
      default: return { ok: false, error: 'unknown message' };
    }
  })().then(reply, (e) => reply({ ok: false, error: String(e && e.message || e) }));
  return true;
});

// ───────────── context menu ─────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'mg-media', title: 'Mamba Grab: download this', contexts: ['image', 'video', 'audio', 'link'] });
    chrome.contextMenus.create({ id: 'mg-page', title: 'Mamba Grab: download video on this page (app)', contexts: ['page', 'frame'] });
  });
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const s = await settings();
  const notify = (msg) => chrome.action.setTitle({ tabId: tab.id, title: 'Mamba Grab — ' + msg }).catch(() => { });
  if (info.menuItemId === 'mg-page') { const r = await downloadThisVideo(tab.id, { pageUrl: info.frameUrl || info.pageUrl, topUrl: info.pageUrl, title: tab.title }); notify(r.message); return; }
  const url = info.srcUrl || info.linkUrl;
  if (!url) return;
  if (/^https?:/.test(url) && (info.mediaType === 'image' || U.classify(url).kind !== 'other' && !U.classify(url).stream)) { await directDownload([{ url }], { pageUrl: info.pageUrl }); return; }
  const r = U.isDrmOnlySite(url) ? { message: T('drmBlocked', s.lang) } : await sendToApp({ url, referer: info.pageUrl, title: tab.title });
  notify(r.message || (r.ok ? T('sentToApp', s.lang) : T('needAppRunning', s.lang)));
});
