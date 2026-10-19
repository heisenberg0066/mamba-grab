'use strict';
/* yt-dlp/FFmpeg integration for Mamba Grab. No DRM circumvention: `--allow-unplayable-formats` is never passed and
 * DRM errors from yt-dlp are reported as "copy-protected". */
const fs = require('fs'), path = require('path'), os = require('os'), { spawn, execFile } = require('child_process');

const EXE = process.platform === 'win32' ? '.exe' : '';
const DRM_RE = /\bDRM\b|drm[ -]protected|known to use DRM|Widevine|PlayReady|FairPlay|This video is protected|encrypted media/i;
const FORBIDDEN_ARGS = ['--allow-unplayable-formats', '--hls-use-mpegts-decrypt', '--decryption-key'];

/** Find bundled binaries: resources/bin (packaged), vendor/bin-* (dev), PATH. */
function binDirs(resourcesPath, userData) {
  const d = [];
  if (process.env.MAMBA_GRAB_BIN) d.push(process.env.MAMBA_GRAB_BIN);
  if (userData) d.push(path.join(userData, 'bin'));
  if (resourcesPath) d.push(path.join(resourcesPath, 'bin'));
  d.push(path.join(__dirname, '..', 'vendor', process.platform === 'win32' ? 'bin-win' : 'bin-' + process.platform));
  return d;
}
function which(name) {
  for (const p of (process.env.PATH || '').split(path.delimiter)) { const f = path.join(p, name + EXE); if (p && fs.existsSync(f)) return f; }
  return null;
}
function findTool(name, dirs, env) {
  if (env && process.env[env] && fs.existsSync(process.env[env])) return process.env[env];
  for (const d of dirs) { const f = path.join(d, name + EXE); if (fs.existsSync(f)) return f; }
  return which(name);
}

/** Ensure a writable, self-updatable copy of yt-dlp in userData/bin (bundled copy is the seed). */
function seedYtdlp(resourcesPath, userData) {
  try {
    const src = resourcesPath && path.join(resourcesPath, 'bin', 'yt-dlp' + EXE);
    if (!src || !fs.existsSync(src) || !userData) return null;
    const dst = path.join(userData, 'bin', 'yt-dlp' + EXE);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const sv = fs.statSync(src);
    if (!fs.existsSync(dst) || (fs.existsSync(dst + '.seed') && fs.readFileSync(dst + '.seed', 'utf8') !== String(sv.mtimeMs) && sv.mtimeMs > fs.statSync(dst).mtimeMs)) {
      fs.copyFileSync(src, dst); fs.writeFileSync(dst + '.seed', String(sv.mtimeMs));
    }
    return dst;
  } catch (e) { return null; }
}

/** Electron doubles as the JavaScript runtime yt-dlp needs for YouTube (ELECTRON_RUN_AS_NODE). */
function runEnv(ctx = {}) {
  const env = Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' });
  if (ctx.jsRuntime && ctx.jsRuntimeIsElectron) env.ELECTRON_RUN_AS_NODE = '1';
  return env;
}
function run(bin, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, Object.assign({ windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 120000 }, opts), (err, stdout, stderr) => resolve({ code: err ? (err.code || 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), err }));
  });
}
async function version(bin) { if (!bin) return null; const r = await run(bin, ['--version'], { timeout: 30000 }); return r.code === 0 ? r.stdout.trim().split(/\r?\n/)[0] : null; }
async function ffmpegVersion(bin) { if (!bin) return null; const r = await run(bin, ['-hide_banner', '-version'], { timeout: 30000 }); const m = /ffmpeg version (\S+)/.exec(r.stdout); return m ? m[1] : null; }
async function selfUpdate(bin) {
  const r = await run(bin, ['-U'], { timeout: 180000 });
  const out = (r.stdout + '\n' + r.stderr).trim();
  return { ok: r.code === 0, output: out.split(/\r?\n/).slice(-3).join('\n') };
}

const VIDEO_FORMATS = ['mp4', 'mkv', 'webm'];
const AUDIO_FORMATS = ['mp3', 'm4a', 'opus', 'wav', 'flac', 'aac', 'ogg'];

/** Build yt-dlp arguments for a job. */
function buildArgs(job, ctx = {}) {
  const a = ['--newline', '--no-colors', '--ignore-config', '--no-mtime', '--progress',
    '--progress-template', 'download:[MGP] %(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress.fragment_index)s|%(progress.fragment_count)s|%(info.playlist_index)s|%(info.n_entries)s',
    '--progress-template', 'postprocess:[MGPP] %(progress.postprocessor)s|%(progress.status)s',
    '--print', 'before_dl:[MGTITLE] %(title)s',
    '--print', 'after_move:[MGFILE] %(filepath)s',
    '--concurrent-fragments', '4', '--retries', '10', '--fragment-retries', '10'];
  if (ctx.ffmpegDir) a.push('--ffmpeg-location', ctx.ffmpegDir);
  if (ctx.jsRuntime) a.push('--js-runtimes', 'node:' + ctx.jsRuntime);
  if (process.platform === 'win32') a.push('--windows-filenames');
  const out = job.outDir || ctx.outDir || path.join(os.homedir(), 'Downloads', 'Mamba Grab');
  a.push('-P', out);
  if (ctx.tempDir) a.push('-P', 'temp:' + ctx.tempDir);
  const playlist = !!job.playlist;
  a.push(playlist ? '--yes-playlist' : '--no-playlist');
  if (playlist && job.items) a.push('-I', String(job.items));
  const tpl = job.template || (playlist
    ? '%(playlist_title,playlist_id|Playlist).100B/%(playlist_index|0)03d - %(title).150B [%(id)s].%(ext)s'
    : '%(title).180B [%(id)s].%(ext)s');
  a.push('-o', tpl);
  a.push('-o', 'thumbnail:%(title).180B [%(id)s].%(ext)s', '-o', 'subtitle:%(title).180B [%(id)s].%(ext)s');

  const fmt = String(job.format || 'mp4').toLowerCase();
  const q = String(job.quality || 'best');
  const isAudio = AUDIO_FORMATS.includes(fmt) || q === 'audio';
  if (job.formatId) {
    a.push('-f', `${job.formatId}+bestaudio/${job.formatId}`);
    if (!isAudio && VIDEO_FORMATS.includes(fmt)) a.push('--merge-output-format', fmt);
  } else if (isAudio) {
    a.push('-f', 'bestaudio/best', '-x', '--audio-format', AUDIO_FORMATS.includes(fmt) ? fmt : 'mp3', '--audio-quality', job.audioQuality || '0');
  } else {
    const h = /^\d+$/.test(q) ? +q : 0;
    const f = h ? `bv*[height<=${h}]+ba/b[height<=${h}]/bv*+ba/b` : 'bv*+ba/b';
    a.push('-f', f);
    if (fmt === 'mp4') a.push('-S', 'res,fps,vcodec:h264,acodec:m4a', '--merge-output-format', 'mp4');
    else if (fmt === 'webm') a.push('-S', 'res,fps,vcodec:vp9,acodec:opus', '--merge-output-format', 'webm');
    else a.push('--merge-output-format', 'mkv');
  }
  if (job.subs) {
    a.push('--write-subs', '--sub-langs', job.subLangs || 'en.*,ar.*,sv.*,-live_chat', '--convert-subs', 'srt');
    if (job.autoSubs) a.push('--write-auto-subs');
    if (job.embedSubs && !isAudio) a.push('--embed-subs');
  }
  if (job.thumb) { a.push('--write-thumbnail', '--convert-thumbnails', 'jpg'); if (job.embedThumb) a.push('--embed-thumbnail'); }
  if (job.metadata !== false) a.push('--embed-metadata');
  if (job.cookiesFile) a.push('--cookies', job.cookiesFile);
  else if (job.cookiesFromBrowser) a.push('--cookies-from-browser', String(job.cookiesFromBrowser));
  if (job.referer) a.push('--referer', job.referer);
  if (job.userAgent) a.push('--user-agent', job.userAgent);
  if (job.rateLimit) a.push('-r', String(job.rateLimit));
  a.push('--', job.url);
  for (const f of FORBIDDEN_ARGS) if (a.includes(f)) throw new Error('forbidden yt-dlp option ' + f);
  return a;
}

function num(x) { const n = parseFloat(x); return isFinite(n) ? n : 0; }
function fmtSpeed(b) { if (!b) return ''; const u = ['B/s', 'KB/s', 'MB/s', 'GB/s']; let i = 0; while (b >= 1024 && i < 3) { b /= 1024; i++; } return b.toFixed(b < 10 ? 1 : 0) + ' ' + u[i]; }
function fmtEta(s) { s = Math.round(num(s)); if (!s) return ''; const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(ss).padStart(2, '0'); }

/** Parse one line of yt-dlp output → event or null. */
function parseLine(line) {
  line = String(line).replace(/\r/g, '').trim();
  let m;
  if ((m = /^\[MGP\] (.*)$/.exec(line))) {
    const [dl, tot, est, spd, eta, fi, fc, pi, pn] = m[1].split('|');
    const total = num(tot) || num(est);
    let pct = total ? num(dl) / total * 100 : 0;
    if (!pct && num(fc)) pct = num(fi) / num(fc) * 100;
    return { type: 'progress', downloaded: num(dl), total, percent: Math.max(0, Math.min(100, pct)), speed: fmtSpeed(num(spd)), eta: fmtEta(eta), playlistIndex: num(pi) || 0, playlistCount: num(pn) || 0 };
  }
  if ((m = /^\[MGPP\] (.*)$/.exec(line))) { const [pp, st] = m[1].split('|'); return { type: 'postprocess', name: pp, status: st }; }
  if ((m = /^\[MGTITLE\] (.*)$/.exec(line))) return { type: 'title', title: m[1] };
  if ((m = /^\[MGFILE\] (.*)$/.exec(line))) return { type: 'file', path: m[1] };
  if ((m = /^ERROR: (.*)$/.exec(line))) return { type: 'error', message: m[1], drm: DRM_RE.test(m[1]) };
  if ((m = /^WARNING: (.*)$/.exec(line))) return { type: 'warning', message: m[1], drm: DRM_RE.test(m[1]) && /DRM/.test(m[1]) && /(all|only|every)/i.test(m[1]) };
  return null;
}
const isDrmMessage = (s) => DRM_RE.test(String(s || ''));
const isUnsupportedMessage = (s) => /Unsupported URL|no video formats found|Unable to extract|is not a valid URL/i.test(String(s || ''));

/** Probe a URL: yt-dlp -J (flat playlist) → summary for the UI. */
async function probe(bin, url, opts = {}) {
  const args = ['-J', '--no-warnings', '--ignore-config', '--flat-playlist', '--no-playlist'];
  if (opts.playlist) args.splice(args.indexOf('--no-playlist'), 1, '--yes-playlist');
  if (opts.cookiesFile) args.push('--cookies', opts.cookiesFile); else if (opts.cookiesFromBrowser) args.push('--cookies-from-browser', opts.cookiesFromBrowser);
  if (opts.referer) args.push('--referer', opts.referer);
  if (opts.userAgent) args.push('--user-agent', opts.userAgent);
  if (opts.jsRuntime) args.push('--js-runtimes', 'node:' + opts.jsRuntime);
  args.push('--', url);
  const r = await run(bin, args, { timeout: 120000, env: runEnv(opts) });
  if (r.code !== 0) {
    const msg = (r.stderr.split(/\r?\n/).filter(l => /^ERROR:/.test(l)).pop() || r.stderr.trim().split(/\r?\n/).pop() || 'yt-dlp failed').replace(/^ERROR:\s*/, '');
    return { ok: false, drm: isDrmMessage(msg), unsupported: isUnsupportedMessage(msg), error: msg };
  }
  let j; try { j = JSON.parse(r.stdout); } catch (e) { return { ok: false, error: 'bad JSON from yt-dlp' }; }
  return { ok: true, info: summarize(j) };
}
function summarize(j) {
  const formats = (j.formats || []).map(f => ({ id: f.format_id, ext: f.ext, height: f.height || 0, width: f.width || 0, fps: f.fps || 0, vcodec: f.vcodec, acodec: f.acodec, size: f.filesize || f.filesize_approx || 0, tbr: f.tbr || 0, note: f.format_note || '', protocol: f.protocol, drm: !!f.has_drm }));
  const playable = formats.filter(f => !f.drm);
  return {
    id: j.id, title: j.title, uploader: j.uploader || j.channel || '', duration: j.duration || 0, thumbnail: j.thumbnail || (j.thumbnails && j.thumbnails.length ? j.thumbnails[j.thumbnails.length - 1].url : ''),
    webpage_url: j.webpage_url || j.url, extractor: j.extractor_key || j.extractor, isPlaylist: j._type === 'playlist', entries: j._type === 'playlist' ? (j.entries || []).length : 0,
    formats: formats.slice(-80), heights: [...new Set(playable.map(f => f.height).filter(Boolean))].sort((a, b) => b - a),
    subtitles: Object.keys(j.subtitles || {}), autoCaptions: Object.keys(j.automatic_captions || {}).slice(0, 30),
    drm: formats.length > 0 && playable.length === 0
  };
}

module.exports = { runEnv, binDirs, findTool, seedYtdlp, version, ffmpegVersion, selfUpdate, buildArgs, parseLine, probe, summarize, isDrmMessage, isUnsupportedMessage, FORBIDDEN_ARGS, AUDIO_FORMATS, VIDEO_FORMATS, run };
