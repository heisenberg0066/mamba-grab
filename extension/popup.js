/* Mamba Grab popup */
'use strict';
const U = window.MambaUtils, I = window.MambaI18n;
const HOST = 'com.ammar.mambagrab';
const $ = (s) => document.querySelector(s);
const DEFAULTS = { lang: '', cookieMode: 'off', cookieBrowser: 'auto', autoStartApp: true, subfolder: true, hoverButton: true, quality: 'best', format: 'mp4', playlist: false, subs: false, thumb: false, kind: 'all', minRes: '0', minSize: '0' };
let S = {}, tab = null, items = [], drm = { detected: false }, pageUrl = '', selected = new Set(), kind = 'all', ytdlpOnly = false;
let port = null, appState = 'checking', reqId = 0; const pending = new Map();
const t = (k, v) => I.t(k, S.lang, v);
const send = (m) => new Promise((res) => chrome.runtime.sendMessage(m, (r) => res(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : r)));

function applyLang() {
  const L = I.pick(S.lang);
  document.documentElement.lang = L; document.documentElement.dir = L === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach(e => e.textContent = t(e.dataset.i18n));
  document.querySelectorAll('[data-i18n-ph]').forEach(e => e.placeholder = t(e.dataset.i18nPh));
  document.querySelectorAll('.lang button').forEach(b => b.classList.toggle('on', b.dataset.lang === L));
  setAppPill(appState); render();
}
async function save(patch) { Object.assign(S, patch); await chrome.storage.local.set(patch); }

// ───────── native port (live queue) ─────────
function rpc(msg, timeout = 15000) {
  return new Promise((resolve) => {
    if (!port) return resolve({ ok: false, appRunning: false, error: 'no port' });
    const id = ++reqId; const to = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: 'timeout' }); }, timeout);
    pending.set(id, (r) => { clearTimeout(to); resolve(r); });
    port.postMessage(Object.assign({ id }, msg));
  });
}
function connectPort() {
  try { port = chrome.runtime.connectNative(HOST); } catch (e) { port = null; setAppPill('missing'); return; }
  port.onMessage.addListener((m) => {
    if (m && m.id && pending.has(m.id)) { const f = pending.get(m.id); pending.delete(m.id); f(m); return; }
    if (m && m.event === 'jobs') renderJobs(m.jobs || []);
    if (m && m.event === 'app') setAppPill(m.running ? 'ok' : 'off');
  });
  port.onDisconnect.addListener(() => {
    const e = chrome.runtime.lastError; port = null;
    for (const f of pending.values()) f({ ok: false, appRunning: false, error: e && e.message }); pending.clear();
    setAppPill(e && /not found|forbidden/i.test(e.message || '') ? 'missing' : 'off');
  });
  rpc({ cmd: 'ping', launch: false }, 6000).then(r => { setAppPill(r && r.ok ? 'ok' : (port ? 'off' : appState)); if (r && r.ok) rpc({ cmd: 'subscribe' }); });
}
function setAppPill(st) {
  appState = st; const p = $('#appStatus'); if (!p) return;
  p.className = 'pill ' + (st === 'ok' ? 'ok' : st === 'checking' ? '' : 'off');
  p.textContent = t(st === 'ok' ? 'appOk' : st === 'missing' ? 'appMissing' : st === 'checking' ? 'appChecking' : 'appOff');
}
function renderJobs(jobs) {
  const box = $('#jobs'); box.innerHTML = '';
  if (!jobs.length) { box.innerHTML = `<div class="muted small">${t('noJobs')}</div>`; return; }
  for (const j of jobs.slice(0, 5)) {
    const d = document.createElement('div'); d.className = 'job ' + j.status; d.dataset.id = j.id; d.dataset.status = j.status;
    const st = j.status === 'drm' ? t('drmBlocked') : j.status === 'running' ? `${Math.round(j.progress || 0)}% ${j.speed || ''} ${j.eta ? '· ' + j.eta : ''}` : t(j.status === 'error' ? 'error' : j.status);
    d.innerHTML = `<div class="t"></div><div class="s"></div><div class="bar"><i style="width:${Math.max(0, Math.min(100, j.status === 'done' ? 100 : j.progress || 0))}%"></i></div>`;
    d.querySelector('.t').textContent = j.title || j.url; d.querySelector('.s').textContent = st + (j.status === 'error' && j.message ? ' — ' + j.message.slice(0, 80) : '');
    box.appendChild(d);
  }
}

// ───────── scanning ─────────
async function scanTab() {
  window.__scanDone = false;
  let frames = [];
  const run = async (allFrames) => {
    const target = { tabId: tab.id, allFrames };
    const scanFn = () => { try { return window.__mambaScan ? window.__mambaScan() : null; } catch (e) { return { error: String(e && e.stack || e), items: [] }; } };
    let f = await chrome.scripting.executeScript({ target, func: scanFn });
    if (!f.length || f.some(x => !x.result)) { // a frame without the content script (opened before install, prerender…) → inject, rescan
      await chrome.scripting.executeScript({ target, files: ['lib/media-utils.js', 'content.js'] });
      f = await chrome.scripting.executeScript({ target, func: scanFn });
    }
    window.__scanErrors = f.filter(x => x.result && x.result.error).map(x => x.result.error);
    window.__frames = f.map(x => ({ frameId: x.frameId, n: x.result && x.result.items ? x.result.items.length : null, url: x.result && x.result.frameUrl }));
    return f;
  };
  // all frames first (embedded players); if one frame is inaccessible the whole call fails → main frame only
  try { frames = await run(true); } catch (e) { try { frames = await run(false); } catch (e2) { /* chrome:// pages etc. */ } }
  const bg = await send({ type: 'get-tab', tabId: tab.id }) || {};
  drm = bg.drm || { detected: false }; ytdlpOnly = !!bg.ytdlpOnly;
  const map = new Map();
  for (const f of frames) {
    const r = f.result; if (!r) continue;
    if (r.drm) drm = { detected: true, how: r.drmHow };
    for (const it of r.items) if (!map.has(it.url)) map.set(it.url, it);
  }
  const alternates = new Set(); for (const it of map.values()) for (const a of it.alternates || []) alternates.add(a);
  for (const it of bg.items || []) {
    if (it.child) continue;
    if (it.kind === 'image' && alternates.has(it.url)) continue; // a smaller srcset/thumb variant of an image we already list
    const prev = map.get(it.url);
    map.set(it.url, Object.assign({}, prev || {}, it, prev ? { title: prev.title || it.title, thumb: prev.thumb } : {}));
  }
  pageUrl = tab.url;
  items = [...map.values()].filter(i => i.kind !== 'segment');
  if (U.isDrmOnlySite(pageUrl)) drm = { detected: true, how: 'drm-only-site' };
  for (const it of items) if (it.drm || it.encrypted) drm = { detected: true, how: it.drm ? 'manifest' : 'eme' };
  $('#drmBanner').classList.toggle('hidden', !drm.detected);
  $('#siteHint').classList.toggle('hidden', drm.detected || !(U.isYtdlpSite(pageUrl) || ytdlpOnly));
  render();
  enrich();
}

// upgrade thumbnails to originals + fetch sizes (HEAD), bounded concurrency
async function head(url) {
  try {
    const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 6000);
    const r = await fetch(url, { method: 'HEAD', credentials: 'include', cache: 'force-cache', signal: ac.signal }); clearTimeout(to);
    if (!r.ok) return null;
    return { type: r.headers.get('content-type') || '', size: +r.headers.get('content-length') || 0 };
  } catch (e) { return null; }
}
async function enrich() {
  const jobs = [];
  for (const it of items) {
    if (it.kind === 'image' && it.upgrade && it.upgrade.length && !it.upgradedFrom) jobs.push(async () => {
      for (const c of it.upgrade) { const h = await head(c); if (h && /^image\//.test(h.type)) { it.upgradedFrom = it.url; it.thumb = it.thumb || it.url; it.url = c; it.size = h.size; it.width = 0; it.height = 0; return; } }
    });
  }
  for (const it of items) if (!it.size && /^https?:/.test(it.url) && !it.stream && !it.blob && it.source !== 'iframe-player') jobs.push(async () => { const h = await head(it.url); if (h) { it.size = h.size; if (!it.mime) it.mime = h.type.split(';')[0]; } });
  $('#sizeNote').textContent = jobs.length ? t('checkingSizes') : '';
  let i = 0; const worker = async () => { while (i < jobs.length && i < 160) { const j = jobs[i++]; await j(); if (i % 8 === 0) render(); } };
  await Promise.all([1, 2, 3, 4, 5, 6].map(worker));
  // dedupe after upgrades (several thumbs → one original)
  const seen = new Map(); for (const it of items) { if (!seen.has(it.url)) seen.set(it.url, it); else { const p = seen.get(it.url); p.width = Math.max(p.width || 0, it.width || 0); } }
  items = [...seen.values()];
  $('#sizeNote').textContent = '';
  render();
  window.__scanDone = true;
}

// ───────── render ─────────
const KINDS = ['all', 'video', 'audio', 'image', 'doc', 'archive', 'other'];
const ICON = { video: '🎬', audio: '🎵', image: '🖼', doc: '📄', archive: '🗜', other: '📎' };
function visible() {
  const minRes = +S.minRes || 0, minSize = +S.minSize || 0, q = ($('#q').value || '').toLowerCase();
  return items.filter(it => {
    if (kind !== 'all' && it.kind !== kind) return false;
    if (minRes && (it.kind === 'image' || it.kind === 'video')) { const m = Math.max(it.width || 0, it.height || 0); if (m && m < minRes) return false; if (!m && it.kind === 'image' && it.dimsKnown) return false; }
    if (minSize && it.size && it.size < minSize) return false;
    if (minSize && !it.size && it.kind !== 'video') return false;
    if (q && !((it.title || '') + ' ' + it.url).toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => order(a) - order(b) || ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)) || (b.size || 0) - (a.size || 0));
}
const order = (it) => ({ video: 0, audio: 1, image: 2, doc: 3, archive: 4, other: 5 }[it.kind] ?? 6);
const isLocked = (it) => it.drm || it.encrypted || (drm.detected && (it.kind === 'video' || it.kind === 'audio') && (it.stream || it.blob || it.source === 'network'));
function needsApp(it) { return !!(it.stream || it.blob || it.source === 'iframe-player'); }

function render() {
  if (!$('#kindTabs')) return;
  const counts = {}; for (const k of KINDS) counts[k] = k === 'all' ? items.length : items.filter(i => i.kind === k).length;
  $('#kindTabs').innerHTML = '';
  for (const k of KINDS) { if (k !== 'all' && !counts[k]) continue; const b = document.createElement('button'); b.className = 'tab' + (k === kind ? ' active' : ''); b.innerHTML = `${t(k)}<span class="n">${counts[k]}</span>`; b.onclick = () => { kind = k; save({ kind }); render(); }; $('#kindTabs').appendChild(b); }
  const vis = visible();
  const grid = $('#grid'); grid.innerHTML = '';
  $('#empty').classList.toggle('hidden', !!items.length);
  for (const it of vis) {
    const locked = isLocked(it);
    const c = document.createElement('div'); c.className = 'card' + (selected.has(it.url) ? ' sel' : '') + (locked ? ' locked' : '');
    const th = document.createElement('div'); th.className = 'th';
    const thumbUrl = it.kind === 'image' ? it.url : it.thumb;
    if (thumbUrl && /^(https?|data):/.test(thumbUrl)) {
      const img = document.createElement('img'); img.loading = 'lazy'; img.referrerPolicy = 'no-referrer-when-downgrade'; img.src = thumbUrl;
      img.onload = () => { if (it.kind === 'image' && (!it.width || !it.dimsKnown)) { const chg = it.width !== img.naturalWidth; it.width = img.naturalWidth; it.height = img.naturalHeight; it.dimsKnown = true; if (chg) dims(c, it); } };
      img.onerror = () => { if (it.upgradedFrom && img.src !== it.upgradedFrom) { it.url = it.upgradedFrom; delete it.upgradedFrom; img.src = it.url; } else { img.remove(); th.textContent = ICON[it.kind] || '📎'; } };
      th.appendChild(img);
    } else th.textContent = ICON[it.kind] || '📎';
    th.title = it.url; th.onclick = () => toggle(it, c);
    const pick = document.createElement('input'); pick.type = 'checkbox'; pick.className = 'pick'; pick.checked = selected.has(it.url); pick.disabled = locked; pick.onclick = (e) => { e.stopPropagation(); toggle(it, c); };
    c.appendChild(pick); c.appendChild(th);
    const meta = document.createElement('div'); meta.className = 'meta';
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = it.blob ? (it.title || t('blob')) : (it.title && it.kind !== 'image' ? it.title : U.fileNameOf(it.url)); nm.title = it.url; meta.appendChild(nm);
    const bd = document.createElement('div'); bd.className = 'badges'; meta.appendChild(bd);
    c._badges = bd; dims(c, it);
    const acts = document.createElement('div'); acts.className = 'acts';
    if (locked) { const b = document.createElement('button'); b.textContent = '🔒'; b.title = t('drmBlocked'); b.onclick = () => msg(t('drmBlocked'), 'drm'); acts.appendChild(b); }
    else {
      const b = document.createElement('button'); b.textContent = needsApp(it) ? '⬇ ' + t('viaApp') : '⬇'; b.title = t('download'); b.onclick = () => downloadItems([it]); acts.appendChild(b);
      const cp = document.createElement('button'); cp.textContent = '⧉'; cp.title = t('copy'); cp.onclick = async () => { await navigator.clipboard.writeText(it.page || it.url); cp.textContent = '✓'; }; acts.appendChild(cp);
      if (/^https?:/.test(it.url) && !it.blob) { const o = document.createElement('button'); o.textContent = '↗'; o.title = t('open'); o.onclick = () => chrome.tabs.create({ url: it.url, active: false }); acts.appendChild(o); }
    }
    meta.appendChild(acts); c.appendChild(meta); grid.appendChild(c);
  }
  const dl = vis.filter(i => !isLocked(i));
  $('#dlAll').textContent = t('dlAll', { n: dl.length }); $('#dlAll').disabled = !dl.length;
  const nsel = [...selected].length; $('#dlSel').textContent = t('dlSelected', { n: nsel }); $('#dlSel').disabled = !nsel;
  $('#selAll').checked = dl.length > 0 && dl.every(i => selected.has(i.url));
  const dv = $('#dlVideo'); dv.disabled = false; dv.classList.toggle('locked', drm.detected);
}
function dims(c, it) {
  const bd = c._badges; if (!bd) return; bd.innerHTML = '';
  const add = (txt, cls) => { const s = document.createElement('span'); s.className = 'b ' + (cls || ''); s.textContent = txt; bd.appendChild(s); };
  add(t(it.kind), 'k-' + it.kind);
  const ext = it.stream ? it.stream.toUpperCase() : U.extOf(it.url).toUpperCase(); if (ext) add(ext);
  if (it.width && it.height) add(`${it.width}×${it.height}`); else if (it.height) add(it.height + 'p');
  if (it.size) add(U.humanSize(it.size));
  if (it.upgradedFrom) add(t('upgraded'), 'up');
  if (it.blob) add(t('blob'));
  if (isLocked(it)) add('🔒 ' + t('drm'), 'drm');
}
function toggle(it, c) { if (isLocked(it)) return; if (selected.has(it.url)) selected.delete(it.url); else selected.add(it.url); render(); }
function msg(text, cls) { const m = $('#heroMsg'); m.className = 'msg ' + (cls || ''); m.textContent = text; m.classList.remove('hidden'); clearTimeout(msg.t); msg.t = setTimeout(() => m.classList.add('hidden'), 7000); }

function opts() { return { quality: $('#quality').value, format: $('#format').value, playlist: $('#optPlaylist').checked, subs: $('#optSubs').checked, thumb: $('#optThumb').checked }; }

async function downloadItems(list) {
  list = list.filter(i => !isLocked(i));
  if (!list.length) { if (drm.detected) msg(t('drmBlocked'), 'drm'); return; }
  const direct = list.filter(i => !needsApp(i)), viaApp = list.filter(needsApp);
  let sent = 0, failed = 0, started = 0;
  if (direct.length) { const r = await send({ type: 'direct-download', items: direct.map(i => ({ url: i.url, kind: i.kind, mime: i.mime })), pageUrl }); started = (r.results || []).filter(x => x.ok).length; }
  for (const it of viaApp) {
    const r = await send(Object.assign({ type: 'send-to-app', url: it.page || it.url, referer: pageUrl, title: it.title || tab.title, fallbackUrls: it.page ? [] : [], drm: drm.detected && !!(it.stream || it.blob) }, opts(), it.stream ? { playlist: false } : {}));
    if (r && r.ok) sent++; else { failed++; if (r && r.drm) { msg(t('drmBlocked'), 'drm'); return; } }
  }
  const parts = []; if (started) parts.push(t('started', { n: started })); if (sent) parts.push(t('sentN', { n: sent }));
  if (failed) parts.push(appState === 'missing' ? t('needAppInstall') : t('needAppRunning'));
  msg(parts.join(' · ') || '…', failed ? 'err' : 'ok');
  if (sent && !port) connectPort();
}

async function downloadThisVideo() {
  if (drm.detected) { msg(t('drmBlocked'), 'drm'); return; }
  $('#dlVideo').disabled = true; msg('…');
  const vids = items.filter(i => i.kind === 'video' && !isLocked(i));
  const src = (vids.find(i => i.source === 'video' && /^https?:/.test(i.url)) || {}).url || '';
  const o = opts();
  const r = await send(Object.assign({ type: 'download-this-video', tabId: tab.id, pageUrl, topUrl: pageUrl, src, title: tab.title }, o));
  $('#dlVideo').disabled = false;
  msg(r ? r.message : t('needAppRunning'), r && r.drm ? 'drm' : r && r.ok ? 'ok' : 'err');
  if (r && r.jobId) window.__lastJob = r.jobId;
  if (r && r.ok && r.via === 'app') { if (!port) connectPort(); else rpc({ cmd: 'subscribe' }); }
}

// ───────── init ─────────
document.addEventListener('DOMContentLoaded', async () => {
  S = Object.assign({}, DEFAULTS, await chrome.storage.local.get(DEFAULTS)); kind = S.kind || 'all';
  const qt = new URLSearchParams(location.search).get('tab'); // ?tab=<id> lets the popup run in a normal tab (tests / pop-out)
  if (qt) tab = await chrome.tabs.get(+qt); else [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $('#quality').value = S.quality; $('#format').value = S.format; $('#optPlaylist').checked = S.playlist; $('#optSubs').checked = S.subs; $('#optThumb').checked = S.thumb;
  $('#minRes').value = S.minRes; $('#minSize').value = S.minSize;
  for (const k of ['cookieMode', 'cookieBrowser']) $('#' + k).value = S[k];
  for (const k of ['autoStartApp', 'subfolder', 'hoverButton']) $('#' + k).checked = !!S[k];
  $('#cookieBrowserRow').classList.toggle('hidden', S.cookieMode !== 'browser');
  $('#extId').textContent = 'ID: ' + chrome.runtime.id;
  applyLang();
  document.querySelectorAll('.lang button').forEach(b => b.onclick = () => { save({ lang: b.dataset.lang }); applyLang(); });
  $('#gear').onclick = () => $('#settings').classList.toggle('hidden');
  $('#quality').onchange = () => save({ quality: $('#quality').value });
  $('#format').onchange = () => save({ format: $('#format').value });
  for (const k of ['optPlaylist', 'optSubs', 'optThumb']) $('#' + k).onchange = () => save({ [k.slice(3).toLowerCase()]: $('#' + k).checked });
  $('#minRes').onchange = () => { save({ minRes: $('#minRes').value }); render(); };
  $('#minSize').onchange = () => { save({ minSize: $('#minSize').value }); render(); };
  $('#q').oninput = () => render();
  $('#rescan').onclick = () => scanTab();
  $('#selAll').onchange = () => { const vis = visible().filter(i => !isLocked(i)); if ($('#selAll').checked) vis.forEach(i => selected.add(i.url)); else vis.forEach(i => selected.delete(i.url)); render(); };
  $('#dlSel').onclick = () => downloadItems(items.filter(i => selected.has(i.url)));
  $('#dlAll').onclick = () => downloadItems(visible());
  $('#dlVideo').onclick = downloadThisVideo;
  $('#openApp').onclick = async () => { const r = await send({ type: 'native', msg: { cmd: 'show', launch: true }, timeout: 25000 }); setAppPill(r && r.ok ? 'ok' : (r && r.notInstalled ? 'missing' : 'off')); if (r && r.ok && !port) connectPort(); };
  $('#cookieMode').onchange = async () => {
    const v = $('#cookieMode').value;
    if (v === 'extension') { const ok = await chrome.permissions.request({ permissions: ['cookies'] }).catch(() => false); if (!ok) { $('#cookieMode').value = S.cookieMode; return; } }
    save({ cookieMode: v }); $('#cookieBrowserRow').classList.toggle('hidden', v !== 'browser');
  };
  $('#cookieBrowser').onchange = () => save({ cookieBrowser: $('#cookieBrowser').value });
  for (const k of ['autoStartApp', 'subfolder', 'hoverButton']) $('#' + k).onchange = () => save({ [k]: $('#' + k).checked });
  connectPort();
  renderJobs([]);
  if (tab) scanTab();
});
