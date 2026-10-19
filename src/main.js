'use strict';
/* Mamba Grab — companion app (Electron main process). */
const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, clipboard, Notification } = require('electron');
const fs = require('fs'), path = require('path'), os = require('os');
const Y = require('./ytdlp');
const { Queue } = require('./queue');
const { startPipeServer } = require('./pipe-server');
const { registerHost, hostStatus, EXT_ID } = require('./register-host');
const { launchMarker } = require('../host/pipe-path');

const SELFTEST = process.argv.includes('--selftest') || !!process.env.MAMBA_SELFTEST;
let BACKGROUND = process.argv.includes('--background');
try { const m = JSON.parse(fs.readFileSync(launchMarker(), 'utf8')); if (m.background && Date.now() - m.ts < 60000) BACKGROUND = true; fs.unlinkSync(launchMarker()); } catch (e) { }

if (process.env.MAMBA_GRAB_USERDATA) app.setPath('userData', process.env.MAMBA_GRAB_USERDATA);
if (!SELFTEST && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const RES = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
const USER = app.getPath('userData');
const SETTINGS_FILE = path.join(USER, 'settings.json');
const DEF = { lang: '', outDir: path.join(app.getPath('downloads'), 'Mamba Grab'), concurrency: 2, autoUpdate: true, keepInTray: true, quality: 'best', format: 'mp4', subLangs: 'en.*,ar.*', embedSubs: true, autoSubs: false, embedThumb: false, cookiesFromBrowser: '', notify: true, lastUpdateCheck: 0 };
let settings = Object.assign({}, DEF);
try { Object.assign(settings, JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))); } catch (e) { }
const saveSettings = () => { try { fs.mkdirSync(USER, { recursive: true }); fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch (e) { } };
const lang = () => settings.lang || (app.getLocale().startsWith('ar') ? 'ar' : 'en');

const dirs = () => Y.binDirs(app.isPackaged ? process.resourcesPath : null, USER);
let ytdlpBin = null, ffmpegBin = null, versions = { ytdlp: null, ffmpeg: null, updating: false, updateMsg: '' };
function resolveBins() {
  if (app.isPackaged) Y.seedYtdlp(process.resourcesPath, USER);
  ytdlpBin = Y.findTool('yt-dlp', dirs(), 'YTDLP_PATH');
  ffmpegBin = Y.findTool('ffmpeg', dirs(), 'FFMPEG_PATH');
}
resolveBins();

const jsCtx = () => (process.env.MAMBA_NO_JS_RUNTIME ? {} : { jsRuntime: process.execPath, jsRuntimeIsElectron: true });
const queue = new Queue({
  ytdlp: () => ytdlpBin, ffmpegDir: () => ffmpegBin ? path.dirname(ffmpegBin) : null,
  js: () => jsCtx(), outDir: () => settings.outDir, concurrency: () => settings.concurrency, lang,
  stateFile: path.join(USER, 'queue.json'), tempDir: path.join(USER, 'tmp')
});

let win = null, tray = null, pipe = null, quitting = false, extSeen = settings.lastExtSeen || 0;
const icon = () => nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png'));

function createWindow(show = true) {
  if (win) { if (show) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } return win; }
  win = new BrowserWindow({ width: 1180, height: 800, minWidth: 900, minHeight: 600, show: false, title: 'Mamba Grab', icon: icon(), backgroundColor: '#f6f7fb', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (show) win.show(); });
  if (process.env.MAMBA_UI_SHOT) { // test hook: screenshot of the main window (optionally a tab) then quit
    win.webContents.once('did-finish-load', async () => {
      await new Promise(r => setTimeout(r, 1500));
      if (process.env.MAMBA_UI_TAB) await win.webContents.executeJavaScript(`document.querySelector('.tab[data-tab="${process.env.MAMBA_UI_TAB}"]').click()`);
      if (process.env.MAMBA_UI_URL) { await win.webContents.executeJavaScript(`document.querySelector('#url').value=${JSON.stringify(process.env.MAMBA_UI_URL)};document.querySelector('#analyze').click()`); await new Promise(r => setTimeout(r, +process.env.MAMBA_UI_WAIT || 9000)); }
      if (process.env.MAMBA_UI_LANG) await win.webContents.executeJavaScript(`document.querySelector('.lang button[data-lang="${process.env.MAMBA_UI_LANG}"]').click()`);
      await new Promise(r => setTimeout(r, 600));
      fs.writeFileSync(process.env.MAMBA_UI_SHOT, (await win.webContents.capturePage()).toPNG());
      quitting = true; app.exit(0);
    });
  }
  win.on('close', (e) => {
    if (!quitting && settings.keepInTray && tray) { e.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  return win;
}
function createTray() {
  try {
    tray = new Tray(icon().resize({ width: 16, height: 16 }));
    tray.setToolTip('Mamba Grab');
    const L = lang() === 'ar';
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: L ? 'فتح مامبا جراب' : 'Open Mamba Grab', click: () => createWindow(true) },
      { label: L ? 'فتح مجلد التنزيلات' : 'Open download folder', click: () => shell.openPath(settings.outDir) },
      { type: 'separator' },
      { label: L ? 'خروج' : 'Quit', click: () => { quitting = true; app.quit(); } }
    ]));
    tray.on('click', () => createWindow(true));
  } catch (e) { tray = null; }
}
const toRenderer = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

queue.on('changed', (j) => { toRenderer('queue', queue.list()); if (pipe) pipe.broadcast({ event: 'jobs', jobs: queue.list().slice(0, 20) }); });
queue.on('finished', (j) => {
  if (settings.notify && Notification.isSupported() && !SELFTEST && (!win || !win.isFocused())) {
    const L = lang() === 'ar';
    const title = j.status === 'done' ? (L ? 'اكتمل التنزيل' : 'Download finished') : j.status === 'drm' ? (L ? 'محمي من النسخ' : 'Copy-protected') : (L ? 'فشل التنزيل' : 'Download failed');
    const n = new Notification({ title, body: (j.title || j.url) + (j.status !== 'done' && j.message ? '\n' + j.message : ''), icon: icon() });
    n.on('click', () => { if (j.files && j.files[0]) shell.showItemInFolder(j.files[0]); else createWindow(true); });
    n.show();
  }
});

function jobFromExtension(spec) {
  const s = Object.assign({}, spec);
  return {
    url: s.url, title: s.title, referer: s.referer, userAgent: s.userAgent, fallbackUrls: s.fallbackUrls || [],
    quality: s.quality || settings.quality, format: s.format || settings.format, playlist: !!s.playlist,
    subs: !!s.subs, subLangs: settings.subLangs, embedSubs: settings.embedSubs, autoSubs: settings.autoSubs,
    thumb: !!s.thumb, embedThumb: settings.embedThumb,
    cookiesTxt: s.cookiesTxt, cookiesFromBrowser: s.cookiesFromBrowser || '', source: 'extension'
  };
}

function seenExt() {
  const first = Date.now() - (settings.lastExtSeen || 0) > 60000;
  extSeen = settings.lastExtSeen = Date.now(); toRenderer('ext', { seen: extSeen });
  if (first) saveSettings();
}
// handlers shared by the pipe (extension) and the renderer
const H = {
  ping: async () => { seenExt(); return { ok: true, app: app.getVersion(), ytdlp: versions.ytdlp, ffmpeg: versions.ffmpeg, outDir: settings.outDir }; },
  show: async () => { createWindow(true); return { ok: true }; },
  list: () => queue.list(),
  jobs: async () => ({ ok: true, jobs: queue.list() }),
  enqueue: async (m) => { seenExt(); const j = queue.add(jobFromExtension(m.job || {})); if (j.status === 'drm') return { ok: false, drm: true, job: j, message: j.message }; return { ok: true, job: j }; },
  cancel: async (m) => ({ ok: queue.cancel(m.jobId) }),
  retry: async (m) => ({ ok: queue.retry(m.jobId) }),
  probe: async (m) => { if (!ytdlpBin) return { ok: false, error: 'yt-dlp missing' }; return Y.probe(ytdlpBin, m.url, Object.assign({ playlist: m.playlist, referer: m.referer, cookiesFromBrowser: m.cookiesFromBrowser }, jsCtx())); },
  settings: async () => ({ ok: true, settings })
};

async function checkVersions() {
  versions.ytdlp = await Y.version(ytdlpBin); versions.ffmpeg = await Y.ffmpegVersion(ffmpegBin);
  toRenderer('versions', versions);
}
async function updateYtdlp(force) {
  if (!ytdlpBin || versions.updating) return versions;
  if (!force && (!settings.autoUpdate || Date.now() - (settings.lastUpdateCheck || 0) < 20 * 3600 * 1000)) return versions;
  // update only the writable per-user copy, never a system/PATH copy
  if (app.isPackaged && !ytdlpBin.startsWith(USER)) { versions.updateMsg = 'bundled copy is read-only'; return versions; }
  versions.updating = true; toRenderer('versions', versions);
  const r = await Y.selfUpdate(ytdlpBin);
  settings.lastUpdateCheck = Date.now(); saveSettings();
  versions.updating = false; versions.updateMsg = r.output; versions.ytdlp = await Y.version(ytdlpBin);
  toRenderer('versions', versions);
  return versions;
}

// ───────── renderer IPC ─────────
ipcMain.handle('init', async () => ({ settings, versions, queue: queue.list(), extId: EXT_ID, platform: process.platform, hosts: hostStatus(), extSeen, extDir: path.join(RES, app.isPackaged ? 'extension' : 'extension'), appVersion: app.getVersion() }));
ipcMain.handle('set-settings', async (e, patch) => { Object.assign(settings, patch || {}); saveSettings(); return settings; });
ipcMain.handle('pick-folder', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: settings.outDir }); if (r.canceled || !r.filePaths[0]) return null; settings.outDir = r.filePaths[0]; saveSettings(); return settings.outDir; });
ipcMain.handle('open-folder', async (e, p) => { const d = p || settings.outDir; fs.mkdirSync(d, { recursive: true }); return shell.openPath(d); });
ipcMain.handle('show-file', async (e, p) => { if (p && fs.existsSync(p)) shell.showItemInFolder(p); else shell.openPath(settings.outDir); });
ipcMain.handle('open-external', async (e, u) => { if (/^https?:/.test(u)) shell.openExternal(u); });
ipcMain.handle('probe', async (e, o) => H.probe(o));
ipcMain.handle('add', async (e, spec) => { try { return { ok: true, job: queue.add(Object.assign({ source: 'app' }, spec)) }; } catch (err) { return { ok: false, error: err.message }; } });
ipcMain.handle('cancel', async (e, id) => queue.cancel(id));
ipcMain.handle('retry', async (e, id) => queue.retry(id));
ipcMain.handle('remove', async (e, id) => queue.remove(id));
ipcMain.handle('clear-finished', async () => queue.clearFinished());
ipcMain.handle('update-ytdlp', async () => updateYtdlp(true));
ipcMain.handle('clipboard', async () => clipboard.readText());
ipcMain.handle('register-host', async () => { const r = registerHost(RES, { force: true }); return { r, hosts: hostStatus() }; });
ipcMain.handle('job-log', async (e, id) => { const j = queue.get(id); return j ? (j.log || []).join('\n') : ''; });

// ───────── self-test (CI) ─────────
async function selftest() {
  const outDir = process.env.MAMBA_SMOKE || path.join(os.tmpdir(), 'mamba-grab-smoke');
  fs.mkdirSync(outDir, { recursive: true });
  const lines = []; let ok = true;
  const check = (name, cond, extra) => { lines.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')); if (!cond) ok = false; };
  await checkVersions();
  check('yt-dlp found', !!ytdlpBin, ytdlpBin); check('yt-dlp runs', !!versions.ytdlp, versions.ytdlp);
  check('ffmpeg found', !!ffmpegBin, ffmpegBin); check('ffmpeg runs', !!versions.ffmpeg, versions.ffmpeg);
  check('pipe server', !!pipe, pipe && pipe.path);
  if (pipe) {
    const net = require('net');
    const r = await new Promise((res) => { const s = net.connect(pipe.path, () => s.write(JSON.stringify({ _seq: 1, cmd: 'ping' }) + '\n')); let b = ''; s.on('data', d => { b += d; if (b.includes('\n')) { s.end(); res(JSON.parse(b)); } }); s.on('error', (e) => res({ ok: false, error: e.message })); setTimeout(() => res({ ok: false, error: 'timeout' }), 5000); });
    check('pipe ping', r.ok === true, JSON.stringify(r).slice(0, 120));
  }
  if (app.isPackaged) {
    for (const f of ['host/host.js', 'host/mamba-grab-host.bat', 'host/com.ammar.mambagrab.json', 'extension/manifest.json']) check('resource ' + f, fs.existsSync(path.join(process.resourcesPath, f)));
  }
  fs.writeFileSync(path.join(outDir, 'mamba-selftest.txt'), lines.join('\n') + '\n');
  console.log(lines.join('\n'));
  app.exit(ok ? 0 : 1);
}

app.on('second-instance', (e, argv) => { if (!argv.includes('--background')) createWindow(true); });
app.on('before-quit', () => { quitting = true; queue.stopAll(); });
app.on('window-all-closed', () => { if (!tray || !settings.keepInTray) app.quit(); });

app.whenReady().then(async () => {
  app.setAppUserModelId('com.ammar.mambagrab');
  try { pipe = await startPipeServer(H); } catch (e) { console.error('pipe failed', e.message); }
  if (SELFTEST) return selftest();
  if (process.platform === 'win32' && app.isPackaged) { try { registerHost(process.resourcesPath); } catch (e) { } }
  createTray();
  createWindow(!BACKGROUND);
  await checkVersions();
  if (!process.env.MAMBA_NO_UPDATE) setTimeout(() => updateYtdlp(false).catch(() => { }), 4000);
  queue.pump();
});
