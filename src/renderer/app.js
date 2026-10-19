'use strict';
const $ = (s) => document.querySelector(s);
let S = {}, L = 'en', init = {}, jobs = [], probeInfo = null;
const t = (k, v) => { let s = (I18N[L] && I18N[L][k]) ?? I18N.en[k] ?? k; if (v && typeof s === 'string') for (const x in v) s = s.replace('{' + x + '}', v[x]); return s; };
const VQ = ['best', '2160', '1440', '1080', '720', '480', '360', '240'];
const VF = ['mp4', 'mkv', 'webm'], AF = ['mp3', 'm4a', 'opus', 'wav', 'flac'];

function applyLang() {
  L = S.lang || (navigator.language.startsWith('ar') ? 'ar' : 'en');
  document.documentElement.lang = L; document.documentElement.dir = L === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach(e => { const v = t(e.dataset.i18n); if (typeof v === 'string') e.textContent = v; });
  document.querySelectorAll('[data-i18n-ph]').forEach(e => e.placeholder = t(e.dataset.i18nPh));
  document.querySelectorAll('.lang button').forEach(b => b.classList.toggle('on', b.dataset.lang === L));
  $('#extSteps').innerHTML = ''; for (const s of t('extSteps')) { const li = document.createElement('li'); li.textContent = s; $('#extSteps').appendChild(li); }
  fillOptions(); renderQueue(); renderStatus(); renderExt();
}
function fillOptions() {
  const audio = $('#mode').value === 'audio';
  const q = $('#quality'), f = $('#format'); const qv = q.value || S.quality, fv = f.value || S.format;
  q.innerHTML = VQ.map(x => `<option value="${x}">${x === 'best' ? t('best') : x + 'p'}</option>`).join('');
  f.innerHTML = (audio ? AF : VF).map(x => `<option value="${x}">${x.toUpperCase()}</option>`).join('');
  q.value = VQ.includes(qv) ? qv : 'best'; f.value = (audio ? AF : VF).includes(fv) ? fv : (audio ? 'mp3' : 'mp4');
  $('#qualityBox').classList.toggle('hidden', audio);
}
function msg(text, cls) { const m = $('#probeMsg'); m.className = 'msg ' + (cls || ''); m.textContent = text; m.classList.toggle('hidden', !text); }
const dur = (s) => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const human = (n) => { if (!n) return ''; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return n.toFixed(n < 10 ? 1 : 0) + ' ' + u[i]; };

async function analyze() {
  const url = $('#url').value.trim(); if (!url) return msg(t('noUrl'), 'err');
  msg(t('analyzing')); $('#probe').classList.add('hidden'); probeInfo = null;
  const r = await mg.probe({ url, playlist: $('#playlist').checked, cookiesFromBrowser: $('#cookies').value || undefined });
  if (!r.ok) return msg(r.drm ? t('drmMsg') : r.error, r.drm ? 'drm' : 'err');
  const i = probeInfo = r.info;
  if (i.drm) return msg(t('drmMsg'), 'drm');
  msg('');
  $('#probe').classList.remove('hidden');
  $('#pThumb').src = i.thumbnail || ''; $('#pThumb').classList.toggle('hidden', !i.thumbnail);
  $('#pTitle').textContent = i.title || url;
  const parts = []; if (i.uploader) parts.push(t('by') + ' ' + i.uploader); if (i.duration) parts.push(t('duration') + ' ' + dur(i.duration)); if (i.isPlaylist) parts.push(i.entries + ' ' + t('entries'));
  if (i.heights.length) parts.push(i.heights.slice(0, 6).map(h => h + 'p').join(' · ')); if (i.subtitles.length) parts.push(i.subtitles.length + ' ' + t('subsAvail') + ' (' + i.subtitles.slice(0, 6).join(', ') + ')'); if (i.extractor) parts.push(i.extractor);
  $('#pMeta').textContent = parts.join('  ·  ');
  if (i.isPlaylist) $('#playlist').checked = true, $('#itemsBox').classList.remove('hidden');
  const sel = $('#pFormats'); sel.innerHTML = `<option value="">${t('autoFormat')}</option>`;
  for (const f of i.formats.filter(f => !f.drm).slice().reverse()) {
    const v = f.vcodec && f.vcodec !== 'none', a = f.acodec && f.acodec !== 'none';
    const label = `${f.id} · ${f.ext} · ${v ? (f.height ? f.height + 'p' : 'video') + (f.fps ? f.fps : '') : 'audio'}${v && !a ? ' (video only)' : ''}${!v && a ? ' ' + (f.acodec || '') : ''}${f.size ? ' · ' + human(f.size) : f.tbr ? ' · ' + Math.round(f.tbr) + 'k' : ''}${f.note ? ' · ' + f.note : ''}`;
    const o = document.createElement('option'); o.value = f.id; o.textContent = label; sel.appendChild(o);
  }
}
async function add() {
  const url = $('#url').value.trim(); if (!url) return msg(t('noUrl'), 'err');
  if (probeInfo && probeInfo.drm) return msg(t('drmMsg'), 'drm');
  const audio = $('#mode').value === 'audio';
  const spec = { url, title: probeInfo && probeInfo.title, quality: audio ? 'audio' : $('#quality').value, format: $('#format').value, playlist: $('#playlist').checked, items: $('#items').value.trim() || undefined,
    subs: $('#subs').checked, subLangs: S.subLangs, embedSubs: S.embedSubs, autoSubs: S.autoSubs, thumb: $('#thumb').checked, embedThumb: S.embedThumb, cookiesFromBrowser: $('#cookies').value || '', formatId: $('#pFormats').value || undefined };
  const r = await mg.add(spec);
  if (!r.ok) return msg(r.error, 'err');
  if (r.job.status === 'drm') return msg(t('drmMsg'), 'drm');
  msg(t('added')); $('#url').value = ''; $('#probe').classList.add('hidden'); probeInfo = null;
  S.quality = $('#quality').value; S.format = $('#format').value; mg.setSettings({ quality: S.quality, format: S.format });
}

function renderQueue() {
  const q = $('#queue'); q.innerHTML = '';
  $('#qEmpty').classList.toggle('hidden', jobs.length > 0);
  const c = { running: 0, queued: 0, done: 0 }; for (const j of jobs) if (c[j.status] != null) c[j.status]++;
  $('#qStats').textContent = jobs.length ? `${t('running')}: ${c.running} · ${t('queued')}: ${c.queued} · ${t('done')}: ${c.done}` : '';
  for (const j of jobs) {
    const d = document.createElement('div'); d.className = 'job ' + j.status; d.dataset.id = j.id;
    const title = document.createElement('div'); title.className = 't'; title.textContent = j.title || j.url; title.title = j.url;
    const sub = document.createElement('div'); sub.className = 'sub';
    const fmt = `${j.quality === 'audio' ? '' : (j.quality === 'best' ? t('best') : j.quality + 'p') + ' · '}${(j.format || '').toUpperCase()}${j.playlist ? ' · ' + t('playlist') : ''}${j.source === 'extension' ? ' · 🧩' : ''}`;
    let st = t(j.status);
    if (j.status === 'running') st = `${(j.progress || 0).toFixed(1)}%  ${j.speed || ''}  ${j.eta ? 'ETA ' + j.eta : ''}  ${j.playlistCount ? `(${j.playlistIndex}/${j.playlistCount})` : ''} ${j.stage && j.stage !== 'download' ? '· ' + j.stage : ''}`;
    if (j.status === 'drm') st = '🔒 ' + t('drmMsg');
    if (j.status === 'error') st = t('error') + ': ' + (j.message || '');
    if (j.status === 'done' && j.files.length) st = t('done') + ' · ' + j.files[j.files.length - 1].split(/[\\/]/).pop() + (j.files.length > 1 ? ` (+${j.files.length - 1})` : '');
    sub.textContent = st + '   ' + fmt;
    const acts = document.createElement('div'); acts.className = 'acts';
    const btn = (k, f) => { const b = document.createElement('button'); b.className = 'ghost'; b.textContent = t(k); b.onclick = f; acts.appendChild(b); };
    if (j.status === 'running' || j.status === 'queued') btn('cancel', () => mg.cancel(j.id));
    if (j.status === 'error' || j.status === 'canceled') btn('retry', () => mg.retry(j.id));
    if (j.status === 'done') btn('show', () => mg.showFile(j.files[j.files.length - 1]));
    if (j.status === 'error') btn('log', async () => alert(await mg.jobLog(j.id)));
    if (j.status !== 'running') btn('remove', () => mg.remove(j.id));
    const bar = document.createElement('div'); bar.className = 'bar'; bar.innerHTML = `<i style="width:${j.status === 'done' ? 100 : Math.max(0, Math.min(100, j.progress || 0))}%"></i>`;
    d.append(title, acts, sub, bar); q.appendChild(d);
  }
}
function renderStatus() {
  const v = init.versions || {};
  $('#vY').textContent = v.ytdlp || t('missing'); $('#vF').textContent = v.ffmpeg || t('missing');
  $('#updY').textContent = v.updating ? t('updating') : t('updateNow'); $('#updY').disabled = !!v.updating;
  $('#updMsg').textContent = v.updateMsg || '';
  $('#stLeft').textContent = `Mamba Grab ${init.appVersion || ''} · yt-dlp ${v.ytdlp || '—'} · FFmpeg ${v.ffmpeg || '—'}`;
  $('#stRight').textContent = init.extSeen ? t('extSeenAt', { t: new Date(init.extSeen).toLocaleTimeString() }) : t('extNever');
  $('#outPick').textContent = '📁 ' + (S.outDir || ''); $('#outPick').title = S.outDir || '';
}
function renderExt() {
  $('#extId').textContent = init.extId || ''; $('#extDir').textContent = init.extDir || '';
  $('#hosts').innerHTML = (init.hosts || []).map(h => `${h.registered ? '✅' : '❌'} HKCU\\${h.key}\\com.ammar.mambagrab`).join('<br>') || '—';
  $('#extSeen').textContent = init.extSeen ? t('extSeenAt', { t: new Date(init.extSeen).toLocaleString() }) : t('extNever');
}

document.addEventListener('DOMContentLoaded', async () => {
  init = await mg.init(); S = init.settings; jobs = init.queue;
  $('#mode').value = S.quality === 'audio' ? 'audio' : 'video';
  applyLang();
  document.querySelectorAll('.tab').forEach(b => b.onclick = () => { document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === b)); document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'tab-' + b.dataset.tab)); });
  document.querySelectorAll('.lang button').forEach(b => b.onclick = async () => { S.lang = b.dataset.lang; await mg.setSettings({ lang: S.lang }); applyLang(); });
  $('#mode').onchange = fillOptions;
  $('#playlist').onchange = () => $('#itemsBox').classList.toggle('hidden', !$('#playlist').checked);
  $('#paste').onclick = async () => { $('#url').value = (await mg.clipboard()).trim(); };
  $('#analyze').onclick = analyze; $('#addBtn').onclick = add;
  $('#url').addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  $('#url').addEventListener('paste', () => setTimeout(analyze, 50));
  $('#outPick').onclick = async () => { const d = await mg.pickFolder(); if (d) { S.outDir = d; renderStatus(); } };
  $('#outOpen').onclick = () => mg.openFolder();
  $('#clearDone').onclick = () => mg.clearFinished();
  $('#openExtDir').onclick = () => mg.openFolder(init.extDir);
  $('#regHost').onclick = async () => { const r = await mg.registerHost(); init.hosts = r.hosts; renderExt(); };
  $('#updY').onclick = async () => { init.versions.updating = true; renderStatus(); init.versions = await mg.updateYtdlp(); renderStatus(); };
  const bind = (id, key, isChk, num) => { const e = $('#' + id); if (isChk) e.checked = !!S[key]; else e.value = S[key]; e.onchange = () => { S[key] = isChk ? e.checked : (num ? +e.value : e.value); mg.setSettings({ [key]: S[key] }); }; };
  bind('sConc', 'concurrency', false, true); bind('sSubLangs', 'subLangs'); bind('sEmbedSubs', 'embedSubs', true); bind('sAutoSubs', 'autoSubs', true); bind('sEmbedThumb', 'embedThumb', true);
  bind('sTray', 'keepInTray', true); bind('sNotify', 'notify', true); bind('sAutoUpd', 'autoUpdate', true);
  $('#cookies').value = S.cookiesFromBrowser || ''; $('#cookies').onchange = () => mg.setSettings({ cookiesFromBrowser: $('#cookies').value });
  mg.on('queue', (q) => { jobs = q; renderQueue(); });
  mg.on('versions', (v) => { init.versions = v; renderStatus(); });
  mg.on('ext', (e) => { init.extSeen = e.seen; renderStatus(); renderExt(); });
});
