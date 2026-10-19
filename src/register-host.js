'use strict';
/* Registers the native-messaging host for Chrome, Edge (and Chromium/Brave) for the current user.
 * The NSIS installer writes the same keys; the app re-checks them on start so a moved/zip install still works. */
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const NAME = 'com.ammar.mambagrab';
const EXT_ID = 'phppfdojjnpdbkpoiphpcefadmnkmjfd';
const WIN_KEYS = ['Software\\Google\\Chrome\\NativeMessagingHosts', 'Software\\Microsoft\\Edge\\NativeMessagingHosts', 'Software\\Chromium\\NativeMessagingHosts', 'Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts'];

function manifest(hostPath) {
  return { name: NAME, description: 'Mamba Grab companion app (native messaging host)', path: hostPath, type: 'stdio', allowed_origins: ['chrome-extension://' + EXT_ID + '/'] };
}
function regQuery(key) { try { return execFileSync('reg', ['query', 'HKCU\\' + key + '\\' + NAME, '/ve'], { windowsHide: true, encoding: 'utf8' }); } catch (e) { return ''; } }

/** resourcesPath: packaged resources dir. Returns [{browser, ok, manifest}] */
function registerHost(resourcesPath, opts = {}) {
  const out = [];
  if (process.platform === 'win32') {
    const mf = path.join(resourcesPath, 'host', NAME + '.json');
    if (!fs.existsSync(mf)) return [{ ok: false, error: 'manifest missing ' + mf }];
    for (const k of WIN_KEYS) {
      const cur = regQuery(k);
      if (cur.toLowerCase().includes(mf.toLowerCase()) && !opts.force) { out.push({ key: k, ok: true, already: true }); continue; }
      try { execFileSync('reg', ['add', 'HKCU\\' + k + '\\' + NAME, '/ve', '/t', 'REG_SZ', '/d', mf, '/f'], { windowsHide: true }); out.push({ key: k, ok: true }); }
      catch (e) { out.push({ key: k, ok: false, error: e.message }); }
    }
    return out;
  }
  // Linux/macOS (development & tests): a small launcher script + manifests in each browser's config dir
  const dir = path.join(opts.dataDir || os.homedir(), '.mamba-grab-host'); fs.mkdirSync(dir, { recursive: true });
  const hostJs = opts.hostJs || path.join(resourcesPath, 'host', 'host.js');
  const sh = path.join(dir, 'mamba-grab-host.sh');
  const envs = Object.entries(opts.env || {}).map(([k, v]) => `export ${k}=${JSON.stringify(v)}`).join('\n');
  fs.writeFileSync(sh, `#!/bin/sh\n${envs}\nexport ELECTRON_RUN_AS_NODE=1\nexec ${JSON.stringify(opts.nodeExe || process.execPath)} ${JSON.stringify(hostJs)} "$@"\n`, { mode: 0o755 });
  const base = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config');
  const dirs = process.platform === 'darwin' ? ['Google/Chrome', 'Microsoft Edge', 'Chromium'] : ['google-chrome', 'chromium', 'microsoft-edge', 'google-chrome-for-testing'];
  for (const d of (opts.browserDirs || dirs)) {
    const p = path.join(opts.configBase || base, d, 'NativeMessagingHosts');
    try { fs.mkdirSync(p, { recursive: true }); fs.writeFileSync(path.join(p, NAME + '.json'), JSON.stringify(manifest(sh), null, 2)); out.push({ dir: p, ok: true }); } catch (e) { out.push({ dir: p, ok: false, error: e.message }); }
  }
  return out;
}
function hostStatus() {
  if (process.platform !== 'win32') return [];
  return WIN_KEYS.map(k => ({ key: k, registered: !!regQuery(k) }));
}
module.exports = { registerHost, hostStatus, NAME, EXT_ID, manifest };
