#!/usr/bin/env node
/* Mamba Grab native-messaging host.
 * Chrome/Edge start this (via mamba-grab-host.bat → "Mamba Grab.exe" in Node mode). It relays JSON messages between
 * the extension (stdin/stdout, 4-byte little-endian length + UTF-8 JSON) and the running Mamba Grab app (named pipe,
 * newline-delimited JSON). If the app is not running and the message asks for it, the host starts the app. */
'use strict';
const net = require('net'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const { pipePath, launchMarker } = require('./pipe-path');
const VERSION = '1.0.0';
const LOG = process.env.MAMBA_GRAB_HOST_LOG || '';
const log = (...a) => { if (LOG) try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + a.join(' ') + '\n'); } catch (e) { } };

// ── stdin framing ──
let inBuf = Buffer.alloc(0);
const queue = [];
function writeMsg(obj) {
  let json = Buffer.from(JSON.stringify(obj), 'utf8');
  if (json.length > 1000000) json = Buffer.from(JSON.stringify({ id: obj.id, ok: false, error: 'reply too large' }));
  const len = Buffer.alloc(4); len.writeUInt32LE(json.length, 0);
  process.stdout.write(Buffer.concat([len, json]));
}
process.stdin.on('data', (chunk) => {
  inBuf = Buffer.concat([inBuf, chunk]);
  while (inBuf.length >= 4) {
    const n = inBuf.readUInt32LE(0);
    if (inBuf.length < 4 + n) break;
    const body = inBuf.subarray(4, 4 + n).toString('utf8'); inBuf = inBuf.subarray(4 + n);
    let msg; try { msg = JSON.parse(body); } catch (e) { writeMsg({ ok: false, error: 'bad json' }); continue; }
    handle(msg);
  }
});
process.stdin.on('end', () => { log('stdin end'); setTimeout(() => process.exit(0), 50); });

// ── app connection ──
let sock = null, sockBuf = '', connecting = null;
const waiting = new Map(); let seq = 0;
function tryConnect() {
  return new Promise((resolve) => {
    const s = net.connect(pipePath());
    const to = setTimeout(() => { s.destroy(); resolve(null); }, 1500);
    s.once('connect', () => { clearTimeout(to); resolve(s); });
    s.once('error', () => { clearTimeout(to); resolve(null); });
  });
}
function appExe() {
  if (process.env.MAMBA_GRAB_EXE) return process.env.MAMBA_GRAB_EXE;
  if (/mamba grab(\.exe)?$/i.test(path.basename(process.execPath))) return process.execPath;
  const guess = path.resolve(__dirname, '..', '..', process.platform === 'win32' ? 'Mamba Grab.exe' : 'mamba-grab');
  return fs.existsSync(guess) ? guess : null;
}
function launchApp() {
  const exe = appExe(); if (!exe) { log('no exe'); return false; }
  const env = Object.assign({}, process.env); delete env.ELECTRON_RUN_AS_NODE;
  try { fs.writeFileSync(launchMarker(), JSON.stringify({ background: true, ts: Date.now() })); } catch (e) { }
  const extra = (process.env.MAMBA_GRAB_EXE_ARGS || '').split(' ').filter(Boolean);
  try {
    if (process.platform === 'win32' && !process.env.MAMBA_GRAB_DIRECT_LAUNCH) {
      // Started through Explorer so the app is not part of the browser's native-host job object.
      const p = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe'), [exe], { detached: true, stdio: 'ignore', env });
      p.on('error', () => { }); p.unref();
    } else {
      const p = spawn(exe, ['--background', ...extra], { detached: true, stdio: 'ignore', env });
      p.on('error', () => { }); p.unref();
    }
    log('launched', exe); return true;
  } catch (e) { log('launch failed', e.message); return false; }
}
function directLaunch() {
  const exe = appExe(); if (!exe) return;
  const env = Object.assign({}, process.env); delete env.ELECTRON_RUN_AS_NODE;
  try { const p = spawn(exe, ['--background'], { detached: true, stdio: 'ignore', env }); p.on('error', () => { }); p.unref(); } catch (e) { }
}
async function ensureApp(launch) {
  if (sock) return sock;
  if (connecting) return connecting;
  connecting = (async () => {
    let s = await tryConnect();
    if (!s && launch) {
      if (launchApp()) {
        const t0 = Date.now(); let fallbackDone = false;
        while (!s && Date.now() - t0 < 20000) {
          await new Promise(r => setTimeout(r, 400));
          s = await tryConnect();
          if (!s && !fallbackDone && process.platform === 'win32' && Date.now() - t0 > 7000) { fallbackDone = true; directLaunch(); }
        }
      }
    }
    if (s) {
      sock = s; s.setEncoding('utf8');
      s.on('data', (d) => {
        sockBuf += d; let i;
        while ((i = sockBuf.indexOf('\n')) >= 0) {
          const line = sockBuf.slice(0, i); sockBuf = sockBuf.slice(i + 1);
          if (!line.trim()) continue;
          let m; try { m = JSON.parse(line); } catch (e) { continue; }
          if (m._seq && waiting.has(m._seq)) { const w = waiting.get(m._seq); waiting.delete(m._seq); delete m._seq; w(m); }
          else if (m.event) writeMsg(m);
        }
      });
      s.on('close', () => { sock = null; for (const w of waiting.values()) w({ ok: false, appRunning: false, error: 'app closed' }); waiting.clear(); writeMsg({ event: 'app', running: false }); });
      s.on('error', () => { });
    }
    connecting = null;
    return s;
  })();
  return connecting;
}

async function handle(msg) {
  const id = msg.id;
  log('msg', msg.cmd);
  if (msg.cmd === 'host-ping') return writeMsg({ id, ok: true, host: VERSION, pipe: pipePath(), exe: appExe() });
  const s = await ensureApp(!!msg.launch || msg.cmd === 'show');
  if (!s) return writeMsg({ id, ok: false, appRunning: false, error: 'Mamba Grab app is not running' });
  const q = ++seq;
  const reply = await new Promise((resolve) => {
    waiting.set(q, resolve);
    const out = Object.assign({}, msg, { _seq: q }); delete out.launch;
    s.write(JSON.stringify(out) + '\n');
    setTimeout(() => { if (waiting.has(q)) { waiting.delete(q); resolve({ ok: false, error: 'app timeout' }); } }, msg.cmd === 'probe' ? 90000 : 20000);
  });
  writeMsg(Object.assign({ id, appRunning: reply.appRunning !== false }, reply));
}
