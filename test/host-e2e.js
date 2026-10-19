/* End-to-end through the REGISTERED native-messaging host, exactly as Chrome/Edge would start it:
 * registry (Windows) / NativeMessagingHosts dir (Linux) → manifest → host → app (auto-launched) → yt-dlp → file. */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), { spawn, execFileSync } = require('child_process');
const ORIGIN = 'chrome-extension://phppfdojjnpdbkpoiphpcefadmnkmjfd/';
const out = []; const log = (s) => { console.log(s); out.push(s); };
function manifestPath(browser) {
  if (process.platform === 'win32') {
    const key = { chrome: 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.ammar.mambagrab', edge: 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.ammar.mambagrab' }[browser];
    const r = execFileSync('reg', ['query', key, '/ve'], { encoding: 'utf8' });
    return /REG_SZ\s+(.+)$/m.exec(r)[1].trim();
  }
  return path.join(os.homedir(), '.config', browser === 'edge' ? 'microsoft-edge' : 'google-chrome', 'NativeMessagingHosts', 'com.ammar.mambagrab.json');
}
function session(browser) {
  const mf = manifestPath(browser); const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  if (!m.allowed_origins.includes(ORIGIN)) throw new Error('origin not allowed in ' + mf);
  const hostPath = path.isAbsolute(m.path) ? m.path : path.join(path.dirname(mf), m.path);
  log(`${browser}: manifest ${mf} → host ${hostPath}`);
  const p = process.platform === 'win32' ? spawn(`"${hostPath}" ${ORIGIN}`, { shell: true, windowsHide: true }) : spawn(hostPath, [ORIGIN]);
  let buf = Buffer.alloc(0); const msgs = [];
  p.stdout.on('data', (d) => { buf = Buffer.concat([buf, d]); while (buf.length >= 4) { const n = buf.readUInt32LE(0); if (buf.length < 4 + n) break; msgs.push(JSON.parse(buf.subarray(4, 4 + n).toString())); buf = buf.subarray(4 + n); } });
  p.stderr.on('data', (d) => log('host stderr: ' + d));
  const send = (o) => { const b = Buffer.from(JSON.stringify(o)); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); p.stdin.write(Buffer.concat([l, b])); };
  const next = (pred, ms) => new Promise((res, rej) => { const t0 = Date.now(); const iv = setInterval(() => { const i = msgs.findIndex(pred); if (i >= 0) { clearInterval(iv); res(msgs.splice(i, 1)[0]); } else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error('timeout waiting for reply')); } }, 100); });
  return { send, next, close: () => p.stdin.end(), p };
}
(async () => {
  let ok = true;
  try {
    const s = session('chrome');
    s.send({ id: 1, cmd: 'host-ping' }); log('host-ping: ' + JSON.stringify(await s.next(m => m.id === 1, 30000)));
    const t0 = Date.now(); s.send({ id: 2, cmd: 'ping', launch: true });
    const pong = await s.next(m => m.id === 2, 60000); log(`ping (auto-launch) after ${Date.now() - t0} ms: ` + JSON.stringify(pong));
    if (!pong.ok) throw new Error('app did not answer');
    const url = process.env.E2E_URL || 'https://commons.wikimedia.org/wiki/File:Roundhay_Garden_Scene.ogv';
    s.send({ id: 3, cmd: 'enqueue', job: { url, title: 'e2e', quality: '480', format: 'mp4', source: 'extension' } });
    const enq = await s.next(m => m.id === 3, 30000); log('enqueue: ' + JSON.stringify(enq)); if (!enq.ok) throw new Error('enqueue failed');
    s.send({ id: 4, cmd: 'enqueue', job: { url: 'https://www.netflix.com/watch/80100172' } });
    const drm = await s.next(m => m.id === 4, 30000); log('DRM-only site: ' + JSON.stringify({ ok: drm.ok, drm: drm.drm, message: drm.message }));
    if (!drm.drm || drm.message !== 'This video is copy-protected and can\'t be downloaded.') throw new Error('DRM refusal missing');
    s.send({ id: 5, cmd: 'subscribe' }); await s.next(m => m.id === 5, 10000);
    const jobId = enq.job.id; let job = null; const t1 = Date.now();
    while (Date.now() - t1 < 240000) {
      const ev = await s.next(m => m.event === 'jobs', 240000 - (Date.now() - t1));
      job = ev.jobs.find(j => j.id === jobId);
      if (job && !['queued', 'running'].includes(job.status)) break;
    }
    log('job: ' + JSON.stringify(job));
    if (!job || job.status !== 'done') throw new Error('download did not finish: ' + (job && job.message));
    const f = job.files[job.files.length - 1]; const size = fs.statSync(f).size; log(`file ${f} (${size} bytes)`);
    if (size < 50000) throw new Error('file too small');
    // Edge registration points at the same host
    const e = session('edge'); e.send({ id: 1, cmd: 'ping' }); log('edge ping: ' + JSON.stringify(await e.next(m => m.id === 1, 30000))); e.close();
    s.close();
  } catch (err) { ok = false; log('FAIL ' + err.message); }
  log(ok ? 'HOST E2E PASS' : 'HOST E2E FAIL');
  if (process.env.E2E_OUT) fs.writeFileSync(process.env.E2E_OUT, out.join('\n'));
  setTimeout(() => process.exit(ok ? 0 : 1), 300);
})();
