// Development (Linux/macOS): register the native host so a Chromium-based browser can reach `electron .` from this repo.
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
const { registerHost } = require('../src/register-host');
const root = path.join(__dirname, '..');
const electron = require('electron'); // path to the binary when required from Node
const launcher = path.join(os.homedir(), '.mamba-grab-host', 'launch-app.sh');
fs.mkdirSync(path.dirname(launcher), { recursive: true });
fs.writeFileSync(launcher, `#!/bin/sh\nexport PATH="${process.env.HOME}/bin:$PATH"\nexport DISPLAY="\${DISPLAY:-${process.env.DISPLAY || ':0'}}"\nunset ELECTRON_RUN_AS_NODE\nexec ${JSON.stringify(electron)} --no-sandbox ${JSON.stringify(root)} "$@" >> /tmp/mamba-grab-app.log 2>&1\n`, { mode: 0o755 });
const extraDirs = (process.env.EXTRA_NM_DIRS || '').split(path.delimiter).filter(Boolean);
const r = registerHost(root, { nodeExe: electron, hostJs: path.join(root, 'host', 'host.js'), env: { MAMBA_GRAB_EXE: launcher, MAMBA_GRAB_HOST_LOG: '/tmp/mamba-grab-host.log' } });
for (const d of extraDirs) { const p = path.join(d, 'NativeMessagingHosts'); fs.mkdirSync(p, { recursive: true }); fs.copyFileSync(path.join(os.homedir(), '.config', 'google-chrome', 'NativeMessagingHosts', 'com.ammar.mambagrab.json'), path.join(p, 'com.ammar.mambagrab.json')); r.push({ dir: p, ok: true }); }
console.log(JSON.stringify(r, null, 1));
