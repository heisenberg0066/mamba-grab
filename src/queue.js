'use strict';
/* Download queue: runs yt-dlp jobs with bounded concurrency, parses progress, retries fallbacks, refuses DRM. */
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const Y = require('./ytdlp');

const DRM_TEXT = { en: 'This video is copy-protected and can\'t be downloaded.', ar: 'هذا الفيديو محمي من النسخ ولا يمكن تنزيله.' };
const DRM_ONLY = ['netflix.com', 'disneyplus.com', 'primevideo.com', 'max.com', 'hbomax.com', 'hulu.com', 'tv.apple.com', 'music.apple.com', 'open.spotify.com', 'tidal.com', 'deezer.com', 'peacocktv.com', 'paramountplus.com', 'viaplay.com', 'viaplay.se', 'dazn.com', 'skyshowtime.com', 'crunchyroll.com'];
function isDrmOnly(url) { try { const h = new URL(url).hostname.toLowerCase(); return DRM_ONLY.some(d => h === d || h.endsWith('.' + d)); } catch (e) { return false; } }

class Queue extends EventEmitter {
  constructor(opts) {
    super();
    this.opts = opts; // {ytdlp(), ffmpegDir(), outDir(), concurrency(), lang(), stateFile, tempDir}
    this.jobs = []; this.procs = new Map(); this.seq = 0;
    this.load();
  }
  load() {
    try {
      const j = JSON.parse(fs.readFileSync(this.opts.stateFile, 'utf8'));
      this.jobs = (j.jobs || []).map(x => (x.status === 'running' || x.status === 'queued') ? Object.assign(x, { status: 'queued', progress: 0, speed: '', eta: '' }) : x).slice(-200);
      this.seq = j.seq || this.jobs.length;
    } catch (e) { }
  }
  save() {
    clearTimeout(this._st);
    this._st = setTimeout(() => {
      try { fs.mkdirSync(path.dirname(this.opts.stateFile), { recursive: true }); fs.writeFileSync(this.opts.stateFile, JSON.stringify({ seq: this.seq, jobs: this.jobs.map(j => Object.assign({}, j, { cookiesTxt: undefined, cookiesFile: undefined, log: (j.log || []).slice(-30) })) })); } catch (e) { }
    }, 300);
  }
  public(j) {
    return { id: j.id, url: j.url, title: j.title, status: j.status, progress: j.progress || 0, speed: j.speed || '', eta: j.eta || '', message: j.message || '', files: j.files || [], outDir: j.outDir, quality: j.quality, format: j.format, playlist: !!j.playlist, playlistIndex: j.playlistIndex || 0, playlistCount: j.playlistCount || 0, stage: j.stage || '', added: j.added, source: j.source || 'app', subs: !!j.subs, thumb: !!j.thumb };
  }
  list() { return this.jobs.slice().reverse().map(j => this.public(j)); }
  changed(j) { this.emit('changed', j ? this.public(j) : null); this.save(); }

  add(spec) {
    if (!spec || !/^https?:\/\//i.test(spec.url || '')) throw new Error('A http(s) URL is required');
    const j = Object.assign({
      id: 'j' + (++this.seq) + '-' + Date.now().toString(36), status: 'queued', progress: 0, added: Date.now(), files: [], log: [],
      title: spec.title || spec.url, outDir: spec.outDir || this.opts.outDir(), quality: spec.quality || 'best', format: spec.format || 'mp4'
    }, spec);
    j.title = j.title || j.url;
    // cookies from the extension: written to a private temp file for this job only, deleted afterwards
    if (spec.cookiesTxt) {
      const f = path.join(this.opts.tempDir, 'cookies-' + j.id + '.txt');
      fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, spec.cookiesTxt, { mode: 0o600 });
      j.cookiesFile = f; delete j.cookiesTxt;
    }
    if (isDrmOnly(j.url)) { j.status = 'drm'; j.message = DRM_TEXT[this.opts.lang()] || DRM_TEXT.en; }
    this.jobs.push(j); this.changed(j); this.pump();
    return this.public(j);
  }
  get(id) { return this.jobs.find(j => j.id === id); }
  cancel(id) {
    const j = this.get(id); if (!j) return false;
    const p = this.procs.get(id);
    if (p) { j.canceling = true; killTree(p); }
    if (j.status === 'queued' || j.status === 'running') { j.status = 'canceled'; j.speed = ''; j.eta = ''; this.changed(j); }
    return true;
  }
  retry(id) { const j = this.get(id); if (!j || j.status === 'running' || j.status === 'drm') return false; Object.assign(j, { status: 'queued', progress: 0, message: '', speed: '', eta: '', canceling: false, fallbackIndex: 0 }); this.changed(j); this.pump(); return true; }
  remove(id) { this.cancel(id); this.jobs = this.jobs.filter(j => j.id !== id); this.changed(null); return true; }
  clearFinished() { this.jobs = this.jobs.filter(j => ['queued', 'running'].includes(j.status)); this.changed(null); }

  pump() {
    const max = Math.max(1, Math.min(4, this.opts.concurrency() || 2));
    while ([...this.jobs].filter(j => j.status === 'running').length < max) {
      const j = this.jobs.find(x => x.status === 'queued'); if (!j) break;
      this.start(j);
    }
  }
  start(j, urlOverride) {
    const bin = this.opts.ytdlp();
    if (!bin) { j.status = 'error'; j.message = 'yt-dlp not found'; this.changed(j); return; }
    j.status = 'running'; j.progress = 0; j.message = ''; j.stage = '';
    let args;
    try { args = Y.buildArgs(Object.assign({}, j, { url: urlOverride || j.url }), Object.assign({ ffmpegDir: this.opts.ffmpegDir(), tempDir: path.join(this.opts.tempDir, 'parts') }, this.opts.js ? this.opts.js() : {})); }
    catch (e) { j.status = 'error'; j.message = e.message; this.changed(j); return; }
    fs.mkdirSync(j.outDir, { recursive: true });
    const cmd = typeof bin === 'string' ? bin : bin.cmd, pre = typeof bin === 'string' ? [] : (bin.args || []);
    const p = spawn(cmd, [...pre, ...args], { windowsHide: true, env: Y.runEnv(this.opts.js ? this.opts.js() : {}) });
    this.procs.set(j.id, p);
    let lastErr = '', drm = false, lastEmit = 0, buf = { out: '', err: '' };
    const onLine = (line) => {
      const ev = Y.parseLine(line);
      if (!ev) { if (line.trim()) { j.log.push(line.trim().slice(0, 400)); if (j.log.length > 60) j.log.shift(); } return; }
      if (ev.type === 'progress') {
        j.progress = ev.percent; j.speed = ev.speed; j.eta = ev.eta; j.playlistIndex = ev.playlistIndex; j.playlistCount = ev.playlistCount; j.stage = 'download';
        if (Date.now() - lastEmit > 400) { lastEmit = Date.now(); this.emit('changed', this.public(j)); }
      } else if (ev.type === 'postprocess') { j.stage = ev.name; this.emit('changed', this.public(j)); }
      else if (ev.type === 'title') { if (!j.titleFixed) { j.title = ev.title; j.titleFixed = true; } this.emit('changed', this.public(j)); }
      else if (ev.type === 'file') { j.files.push(ev.path); this.emit('changed', this.public(j)); }
      else if (ev.type === 'error') { lastErr = ev.message; if (ev.drm) drm = true; j.log.push('ERROR: ' + ev.message); }
      else if (ev.type === 'warning') { if (ev.drm) drm = true; j.log.push('WARNING: ' + ev.message); }
    };
    const feed = (k) => (d) => { buf[k] += d.toString('utf8'); let i; while ((i = buf[k].search(/[\r\n]/)) >= 0) { onLine(buf[k].slice(0, i)); buf[k] = buf[k].slice(i + 1); } };
    p.stdout.on('data', feed('out')); p.stderr.on('data', feed('err'));
    p.on('error', (e) => { lastErr = e.message; });
    p.on('close', (code) => {
      onLine(buf.out); onLine(buf.err);
      this.procs.delete(j.id);
      if (j.canceling) { j.status = 'canceled'; j.canceling = false; }
      else if (code === 0) { j.status = 'done'; j.progress = 100; j.message = ''; }
      else if (drm || Y.isDrmMessage(lastErr)) { j.status = 'drm'; j.message = DRM_TEXT[this.opts.lang()] || DRM_TEXT.en; }
      else {
        // page URL not supported by yt-dlp → try the stream/file the extension sniffed on that page
        const fb = (j.fallbackUrls || []).filter(u => /^https?:/i.test(u));
        j.fallbackIndex = j.fallbackIndex || 0;
        if (fb.length > j.fallbackIndex && (Y.isUnsupportedMessage(lastErr) || /HTTP Error 4\d\d|Unable to download webpage/i.test(lastErr))) {
          const next = fb[j.fallbackIndex++]; j.log.push('Falling back to ' + next);
          this.changed(j); return this.start(j, next);
        }
        j.status = 'error'; j.message = lastErr || ('yt-dlp exited with code ' + code);
      }
      j.speed = ''; j.eta = '';
      if (j.status !== 'running' && j.cookiesFile) { try { fs.unlinkSync(j.cookiesFile); } catch (e) { } delete j.cookiesFile; }
      this.changed(j); this.emit('finished', this.public(j)); this.pump();
    });
    this.changed(j);
  }
  stopAll() { for (const p of this.procs.values()) killTree(p); }
}
function killTree(p) {
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true });
    else p.kill('SIGTERM');
  } catch (e) { }
}
module.exports = { Queue, isDrmOnly, DRM_TEXT };
