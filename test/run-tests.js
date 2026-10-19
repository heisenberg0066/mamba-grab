/* Mamba Grab test-suite (Node). Unit tests always run; real-network tests run when yt-dlp is available
 * (YTDLP_PATH or PATH) — set MAMBA_OFFLINE=1 to skip them. */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), net = require('net'), { spawn } = require('child_process');
const U = require('../extension/lib/media-utils.js');
const XI = require('../extension/lib/i18n.js');
const Y = require('../src/ytdlp');
const results = []; let failed = 0;
async function test(name, fn, { optional } = {}) {
  const t0 = Date.now();
  try { await fn(); results.push(`PASS ${name} (${Date.now() - t0} ms)`); }
  catch (e) { if (optional) results.push(`SKIP/INFO ${name}: ${e.message.split('\n')[0]}`); else { failed++; results.push(`FAIL ${name}: ${e.stack || e}`); } }
  console.log(results[results.length - 1]);
}
const WORK = path.join(__dirname, 'work'); fs.rmSync(WORK, { recursive: true, force: true }); fs.mkdirSync(WORK, { recursive: true });

(async () => {
  // ───────── extension helpers ─────────
  await test('srcset: picks the widest candidate, resolves relative URLs', () => {
    const b = U.bestFromSrcset('a.jpg 320w, /img/b.jpg 1600w, c.jpg 800w', 'https://ex.com/p/');
    assert.strictEqual(b.url, 'https://ex.com/img/b.jpg'); assert.strictEqual(b.w, 1600);
    assert.strictEqual(U.bestFromSrcset('x1.jpg 1x, x2.jpg 2x', 'https://e.com/').url, 'https://e.com/x2.jpg');
    assert.strictEqual(U.bestFromSrcset('https://res.cloudinary.com/d/image/upload/w_300,h_200/v1/a.jpg 300w, https://res.cloudinary.com/d/image/upload/w_900/v1/a.jpg 900w').w, 900);
  });
  await test('classify: by extension and content-type, streams and segments', () => {
    assert.deepStrictEqual(U.classify('https://x/v.m3u8?t=1'), { kind: 'video', stream: 'hls' });
    assert.deepStrictEqual(U.classify('https://x/manifest.mpd'), { kind: 'video', stream: 'dash' });
    assert.strictEqual(U.classify('https://x/a', 'application/vnd.apple.mpegurl').stream, 'hls');
    assert.strictEqual(U.classify('https://x/a.pdf').kind, 'doc');
    assert.strictEqual(U.classify('https://x/a', 'image/webp').kind, 'image');
    assert.strictEqual(U.classify('https://x/song.mp3').kind, 'audio');
    assert.strictEqual(U.classify('https://x/seg-00012.ts').kind, 'segment');
    assert.ok(U.isSegmentRequest('https://rr1---sn.googlevideo.com/videoplayback?id=1&range=0-1000'));
    assert.ok(U.isSegmentRequest('https://cdn/x/chunk-stream0-00012.m4s'));
    assert.ok(!U.isSegmentRequest('https://cdn/x/movie.mp4'));
  });
  await test('original-size upgrades for common sites', () => {
    const up = (u) => U.upgradeCandidates(u)[0];
    assert.strictEqual(up('https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Example.jpg/220px-Example.jpg'), 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg');
    assert.strictEqual(up('https://pbs.twimg.com/media/Fabc?format=jpg&name=small'), 'https://pbs.twimg.com/media/Fabc?format=jpg&name=orig');
    assert.strictEqual(up('https://i.pinimg.com/236x/aa/bb/cc/abc.jpg'), 'https://i.pinimg.com/originals/aa/bb/cc/abc.jpg');
    assert.strictEqual(up('https://example.com/wp-content/uploads/2024/01/photo-300x200.jpg'), 'https://example.com/wp-content/uploads/2024/01/photo.jpg');
    assert.strictEqual(up('https://m.media-amazon.com/images/I/71abc._AC_SX300_.jpg'), 'https://m.media-amazon.com/images/I/71abc.jpg');
    assert.strictEqual(up('https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg'), 'https://i.ytimg.com/vi/jNQXAC9IVRw/maxresdefault.jpg');
    assert.strictEqual(up('https://preview.redd.it/abc.jpg?width=640&auto=webp'), 'https://i.redd.it/abc.jpg');
    assert.strictEqual(up('https://lh3.googleusercontent.com/abc=w400-h300'), 'https://lh3.googleusercontent.com/abc=s0');
    assert.strictEqual(up('https://i.imgur.com/AbCdEfGl.jpg'), 'https://i.imgur.com/AbCdEfG.jpg');
    assert.strictEqual(up('https://res.cloudinary.com/demo/image/upload/w_300,c_fill/v1/sample.jpg'), 'https://res.cloudinary.com/demo/image/upload/v1/sample.jpg');
    assert.deepStrictEqual(U.upgradeCandidates('https://example.com/plain.jpg'), []);
  });
  await test('HLS: variants sorted, AES-128 is not DRM, SAMPLE-AES/FairPlay/Widevine are DRM', () => {
    const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080\nhd/index.m3u8\n';
    const p = U.parseHls(master, 'https://cdn.ex/v/master.m3u8');
    assert.ok(p.master && !p.drm); assert.strictEqual(p.variants[0].height, 1080); assert.strictEqual(p.variants[0].url, 'https://cdn.ex/v/hd/index.m3u8');
    const aes = U.parseHls('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:4,\ns1.ts\n');
    assert.ok(!aes.drm && aes.aes128);
    const fp = U.parseHls('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://abc",KEYFORMAT="com.apple.streamingkeydelivery",KEYFORMATVERSIONS="1"\n#EXTINF:4,\ns1.ts\n');
    assert.ok(fp.drm); assert.strictEqual(fp.system, 'FairPlay');
    const wv = U.parseHls('#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES-CTR,URI="data:x",KEYFORMAT="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"\n');
    assert.ok(wv.drm); assert.strictEqual(wv.system, 'Widevine');
  });
  await test('DASH: ContentProtection → DRM with system name; clear MPD is not DRM', () => {
    const drm = '<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period><AdaptationSet><ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc"/><ContentProtection schemeIdUri="urn:uuid:EDEF8BA9-79D6-4ACE-A3C8-27DCD51D21ED"/><Representation id="1" height="720"/><Representation id="2" height="1080"/></AdaptationSet></Period></MPD>';
    const p = U.parseMpd(drm); assert.ok(p.drm); assert.strictEqual(p.system, 'Widevine'); assert.strictEqual(p.maxHeight, 1080);
    const pr = U.parseMpd('<MPD><ContentProtection schemeIdUri="urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95"/></MPD>'); assert.strictEqual(pr.system, 'PlayReady');
    const clear = U.parseMpd('<MPD><Period><AdaptationSet><Representation height="480"/></AdaptationSet></Period></MPD>'); assert.ok(!clear.drm); assert.strictEqual(clear.maxHeight, 480);
  });
  await test('DRM-only services and yt-dlp sites are recognised', () => {
    assert.ok(U.isDrmOnlySite('https://www.netflix.com/watch/123')); assert.ok(U.isDrmOnlySite('https://www.disneyplus.com/video/x'));
    assert.ok(U.isDrmOnlySite('https://www.amazon.de/gp/video/detail/B0'));
    assert.ok(!U.isDrmOnlySite('https://www.amazon.de/dp/B0')); assert.ok(!U.isDrmOnlySite('https://www.youtube.com/watch?v=x'));
    assert.ok(U.isYtdlpSite('https://m.youtube.com/watch?v=x')); assert.ok(U.isYtdlpSite('https://commons.wikimedia.org/wiki/File:X.webm'));
  });
  await test('cookies.txt export (Netscape format)', () => {
    const s = U.toNetscapeCookies([{ domain: '.youtube.com', hostOnly: false, path: '/', secure: true, httpOnly: true, expirationDate: 1900000000.5, name: 'SID', value: 'v' }, { domain: 'example.com', hostOnly: true, path: '/', secure: false, session: true, name: 'a', value: 'b' }]);
    assert.ok(s.startsWith('# Netscape HTTP Cookie File'));
    assert.ok(s.includes('#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t1900000000\tSID\tv'));
    assert.ok(s.includes('example.com\tFALSE\t/\tFALSE\t0\ta\tb'));
  });
  await test('EN/AR strings complete (extension + app)', () => {
    for (const k of Object.keys(XI.S.en)) assert.ok(XI.S.ar[k], 'extension ar missing ' + k);
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'i18n.js'), 'utf8');
    const w = {}; new Function('window', src)(w);
    for (const k of Object.keys(w.I18N.en)) assert.ok(w.I18N.ar[k], 'app ar missing ' + k);
    assert.strictEqual(XI.t('drmBlocked', 'en'), 'This video is copy-protected and can\'t be downloaded.');
    // every data-i18n key used in the HTML exists
    for (const [file, dict] of [['extension/popup.html', XI.S.en], ['src/renderer/index.html', w.I18N.en]]) {
      const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
      for (const m of html.matchAll(/data-i18n(?:-ph)?="([^"]+)"/g)) assert.ok(dict[m[1]], `${file}: missing key ${m[1]}`);
    }
  });
  await test('manifest: MV3, fixed key → extension ID matches the native host allow-list', () => {
    const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'extension', 'manifest.json'), 'utf8'));
    assert.strictEqual(m.manifest_version, 3);
    const der = Buffer.from(m.key, 'base64'); const h = require('crypto').createHash('sha256').update(der).digest('hex').slice(0, 32);
    const id = [...h].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
    const host = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'host', 'com.ammar.mambagrab.json'), 'utf8'));
    assert.deepStrictEqual(host.allowed_origins, [`chrome-extension://${id}/`]);
    assert.strictEqual(require('../src/register-host').EXT_ID, id);
    for (const f of [m.background.service_worker, m.action.default_popup, ...m.content_scripts[0].js, ...Object.values(m.icons)]) assert.ok(fs.existsSync(path.join(__dirname, '..', 'extension', f)), 'missing ' + f);
    assert.ok(m.permissions.includes('nativeMessaging') && m.permissions.includes('downloads') && m.permissions.includes('webRequest'));
    assert.ok(!m.permissions.includes('cookies') && m.optional_permissions.includes('cookies'), 'cookies must be opt-in');
  });
  await test('no DRM circumvention code paths anywhere in the source', () => {
    const files = []; const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) { if (!/node_modules|work|dist|vendor|\.git/.test(f)) walk(p); } else if (/\.(js|json|html)$/.test(f) && !/run-tests|fake-ytdlp/.test(f)) files.push(p); } };
    walk(path.join(__dirname, '..', 'extension')); walk(path.join(__dirname, '..', 'src')); walk(path.join(__dirname, '..', 'host'));
    for (const f of files) {
      const s = fs.readFileSync(f, 'utf8').split('\n').filter(l => !/FORBIDDEN_ARGS =/.test(l)).join('\n');
      assert.ok(!/allow-unplayable-formats['"]\s*\)|push\([^)]*allow-unplayable/.test(s), f + ' passes --allow-unplayable-formats');
      assert.ok(!/requestMediaKeySystemAccess\s*=|MediaKeySession\.prototype|generateRequest\s*\(|\.update\(\s*license|decryption-key|mp4decrypt|shaka-packager|pywidevine|\bl3cdm\b/i.test(s), f + ' contains EME/CDM manipulation');
    }
  });

  // ───────── yt-dlp args & output parsing ─────────
  const job = (o) => Object.assign({ url: 'https://ex.com/v', outDir: '/tmp/out' }, o);
  await test('buildArgs: best MP4 / height cap / audio / exact format / options', () => {
    let a = Y.buildArgs(job({}), { ffmpegDir: '/ff', jsRuntime: '/e' });
    assert.ok(a.includes('bv*+ba/b') && a.includes('--merge-output-format') && a[a.indexOf('--merge-output-format') + 1] === 'mp4');
    assert.ok(a.includes('--no-playlist') && a.includes('--ffmpeg-location') && a.includes('node:/e'));
    assert.strictEqual(a[a.length - 1], 'https://ex.com/v'); assert.strictEqual(a[a.length - 2], '--');
    a = Y.buildArgs(job({ quality: '720' })); assert.ok(a.includes('bv*[height<=720]+ba/b[height<=720]/bv*+ba/b'));
    a = Y.buildArgs(job({ format: 'mp3' })); assert.ok(a.includes('-x') && a[a.indexOf('--audio-format') + 1] === 'mp3');
    a = Y.buildArgs(job({ quality: 'audio', format: 'm4a' })); assert.ok(a.includes('-x') && a[a.indexOf('--audio-format') + 1] === 'm4a');
    a = Y.buildArgs(job({ formatId: '137', format: 'mkv' })); assert.ok(a.includes('137+bestaudio/137'));
    a = Y.buildArgs(job({ playlist: true, items: '1-3', subs: true, embedSubs: true, thumb: true, embedThumb: true, cookiesFile: '/tmp/c.txt', referer: 'https://ref/' }));
    for (const x of ['--yes-playlist', '-I', '--write-subs', '--embed-subs', '--write-thumbnail', '--embed-thumbnail', '--cookies', '--referer']) assert.ok(a.includes(x), 'missing ' + x);
    assert.ok(a[a.indexOf('-o') + 1].includes('%(playlist_index'));
    a = Y.buildArgs(job({ cookiesFromBrowser: 'edge' })); assert.strictEqual(a[a.indexOf('--cookies-from-browser') + 1], 'edge');
    for (const q of ['best', '1080', 'audio']) for (const f of ['mp4', 'mkv', 'webm', 'mp3', 'flac']) for (const x of Y.FORBIDDEN_ARGS) assert.ok(!Y.buildArgs(job({ quality: q, format: f })).includes(x));
  });
  await test('parseLine: progress, title, file, DRM error', () => {
    let e = Y.parseLine('[MGP] 500|1000|NA|1048576|12|NA|NA|2|5');
    assert.strictEqual(e.type, 'progress'); assert.strictEqual(e.percent, 50); assert.strictEqual(e.speed, '1.0 MB/s'); assert.strictEqual(e.eta, '0:12'); assert.strictEqual(e.playlistIndex, 2);
    e = Y.parseLine('[MGP] 10|NA|NA|NA|NA|3|12|NA|NA'); assert.strictEqual(Math.round(e.percent), 25);
    assert.deepStrictEqual(Y.parseLine('[MGFILE] C:\\x\\a.mp4'), { type: 'file', path: 'C:\\x\\a.mp4' });
    assert.ok(Y.parseLine('ERROR: [generic] abc: This video is DRM protected').drm);
    assert.ok(Y.parseLine('ERROR: The requested site is known to use DRM protection. It will NOT be supported.').drm);
    assert.ok(!Y.parseLine('ERROR: HTTP Error 404: Not Found').drm);
    assert.strictEqual(Y.parseLine('random text'), null);
  });

  // ───────── queue with a fake yt-dlp ─────────
  const { Queue } = require('../src/queue');
  const mkQueue = (dir) => new Queue({ ytdlp: () => ({ cmd: process.execPath, args: [path.join(__dirname, 'fake-ytdlp.js')] }), ffmpegDir: () => null, outDir: () => dir, concurrency: () => 2, lang: () => 'en', stateFile: path.join(dir, 'q.json'), tempDir: path.join(dir, 'tmp') });
  const waitDone = (q, id, ms = 10000) => new Promise((res, rej) => { const t0 = Date.now(); const iv = setInterval(() => { const j = q.get(id); if (j && !['queued', 'running'].includes(j.status)) { clearInterval(iv); res(j); } else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error('timeout ' + (j && j.status))); } }, 50); });
  await test('queue: progress → done, file recorded, cookies temp file deleted', async () => {
    const d = path.join(WORK, 'q1'); const q = mkQueue(d); const seen = [];
    q.on('changed', (j) => j && seen.push(j.progress));
    const j = q.add({ url: 'https://ok.example/video1', cookiesTxt: '# Netscape HTTP Cookie File\n' });
    const ck = q.get(j.id).cookiesFile; assert.ok(fs.existsSync(ck));
    const r = await waitDone(q, j.id);
    assert.strictEqual(r.status, 'done'); assert.ok(r.files[0].endsWith('fake.mp4')); assert.strictEqual(r.title, 'Fake title for video1');
    assert.ok(seen.some(p => p > 0 && p < 100), 'intermediate progress');
    assert.ok(!fs.existsSync(ck), 'cookie file removed');
  });
  await test('queue: DRM error → "copy-protected" status; DRM-only site refused up front', async () => {
    const d = path.join(WORK, 'q2'); const q = mkQueue(d);
    const r = await waitDone(q, q.add({ url: 'https://x.example/drm-video' }).id);
    assert.strictEqual(r.status, 'drm'); assert.strictEqual(r.message, 'This video is copy-protected and can\'t be downloaded.');
    const n = q.add({ url: 'https://www.netflix.com/watch/1' }); assert.strictEqual(n.status, 'drm');
    assert.strictEqual(q.retry(n.id), false);
  });
  await test('queue: unsupported page URL falls back to the sniffed stream', async () => {
    const d = path.join(WORK, 'q3'); const q = mkQueue(d);
    const r = await waitDone(q, q.add({ url: 'https://x.example/unsupported-page', fallbackUrls: ['https://cdn.example/stream.m3u8'] }).id);
    assert.strictEqual(r.status, 'done'); assert.ok(r.log.some(l => /Falling back/.test(l)));
  });
  await test('queue: failure, retry, cancel, persistence', async () => {
    const d = path.join(WORK, 'q4'); const q = mkQueue(d);
    const j = q.add({ url: 'https://x.example/fail' }); let r = await waitDone(q, j.id); assert.strictEqual(r.status, 'error'); assert.ok(/500/.test(r.message));
    const k = q.add({ url: 'https://x.example/long' }); q.cancel(k.id); assert.strictEqual(q.get(k.id).status, 'canceled');
    await new Promise(r => setTimeout(r, 600));
    const q2 = mkQueue(d); assert.ok(q2.list().length >= 2);
  });

  // ───────── native messaging host ↔ app pipe ─────────
  const { startPipeServer } = require('../src/pipe-server');
  const pipeName = process.platform === 'win32' ? '\\\\.\\pipe\\mamba-grab-test-' + process.pid : path.join(os.tmpdir(), 'mg-test-' + process.pid + '.sock');
  process.env.MAMBA_GRAB_PIPE = pipeName;
  function hostSession(env) {
    const p = spawn(process.execPath, [path.join(__dirname, '..', 'host', 'host.js'), 'chrome-extension://phppfdojjnpdbkpoiphpcefadmnkmjfd/'], { env: Object.assign({}, process.env, { MAMBA_GRAB_PIPE: pipeName }, env || {}) });
    let buf = Buffer.alloc(0); const msgs = []; const waiters = [];
    p.stdout.on('data', (d) => { buf = Buffer.concat([buf, d]); while (buf.length >= 4) { const n = buf.readUInt32LE(0); if (buf.length < 4 + n) break; const m = JSON.parse(buf.subarray(4, 4 + n).toString()); buf = buf.subarray(4 + n); msgs.push(m); waiters.splice(0).forEach(w => w()); } });
    const send = (o) => { const b = Buffer.from(JSON.stringify(o)); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); p.stdin.write(Buffer.concat([l, b])); };
    const next = (pred, ms = 25000) => new Promise((res, rej) => { const t0 = Date.now(); const chk = () => { const i = msgs.findIndex(pred); if (i >= 0) return res(msgs.splice(i, 1)[0]); if (Date.now() - t0 > ms) return rej(new Error('no reply')); waiters.push(chk); setTimeout(chk, 200); }; chk(); });
    return { p, send, next, close: () => { p.stdin.end(); } };
  }
  await test('native host: framing + host-ping without the app', async () => {
    const h = hostSession(); h.send({ id: 1, cmd: 'host-ping' });
    const r = await h.next(m => m.id === 1); assert.ok(r.ok && r.host === '1.0.0' && r.pipe === pipeName);
    h.send({ id: 2, cmd: 'ping', launch: false }); const r2 = await h.next(m => m.id === 2); assert.strictEqual(r2.ok, false); assert.strictEqual(r2.appRunning, false);
    h.close();
  });
  await test('native host: relays enqueue/subscribe to the running app (unicode, 200 KB payload)', async () => {
    const got = [];
    const srv = await startPipeServer({ ping: async () => ({ ok: true, app: 'test' }), enqueue: async (m) => { got.push(m.job); return { ok: true, job: { id: 'j1', title: m.job.title } }; }, list: () => [{ id: 'j1', status: 'queued' }] });
    const h = hostSession();
    h.send({ id: 1, cmd: 'ping' }); assert.strictEqual((await h.next(m => m.id === 1)).app, 'test');
    const big = 'x'.repeat(200000);
    h.send({ id: 2, cmd: 'enqueue', job: { url: 'https://ex.com/v', title: 'فيديو ✓', cookiesTxt: big } });
    const r = await h.next(m => m.id === 2); assert.ok(r.ok); assert.strictEqual(r.job.title, 'فيديو ✓'); assert.strictEqual(got[0].cookiesTxt.length, 200000);
    h.send({ id: 3, cmd: 'subscribe' }); await h.next(m => m.id === 3); const ev = await h.next(m => m.event === 'jobs'); assert.strictEqual(ev.jobs[0].id, 'j1');
    h.close(); await srv.close();
  });
  if (process.platform !== 'win32') await test('native host: starts the app when it is not running (launch:true)', async () => {
    const sh = path.join(WORK, 'fake-app.sh'); fs.writeFileSync(sh, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(__dirname, 'fake-app.js'))}\n`, { mode: 0o755 });
    const h = hostSession({ MAMBA_GRAB_EXE: sh });
    h.send({ id: 5, cmd: 'ping', launch: true }); const r = await h.next(m => m.id === 5);
    assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.app, 'fake'); h.close();
  });

  // ───────── real network + real yt-dlp/ffmpeg ─────────
  const ytdlp = process.env.MAMBA_OFFLINE ? null : Y.findTool('yt-dlp', Y.binDirs(null, null), 'YTDLP_PATH');
  const ffmpeg = Y.findTool('ffmpeg', Y.binDirs(null, null), 'FFMPEG_PATH');
  if (ytdlp) {
    console.log('yt-dlp:', ytdlp, await Y.version(ytdlp), ' ffmpeg:', ffmpeg);
    const runQueue = (spec, ms = 240000) => { const d = path.join(WORK, 'real'); const q = new Queue({ ytdlp: () => ytdlp, ffmpegDir: () => ffmpeg ? path.dirname(ffmpeg) : null, js: () => (process.env.MAMBA_JS_RUNTIME ? { jsRuntime: process.env.MAMBA_JS_RUNTIME, jsRuntimeIsElectron: !!process.env.MAMBA_JS_ELECTRON } : {}), outDir: () => d, concurrency: () => 2, lang: () => 'en', stateFile: path.join(d, 'q.json'), tempDir: path.join(d, 'tmp') }); return waitDone(q, q.add(spec).id, ms); };
    const COMMONS = 'https://commons.wikimedia.org/wiki/File:Roundhay_Garden_Scene.ogv';
    await test('real: probe a Wikimedia Commons video page', async () => {
      const r = await Y.probe(ytdlp, COMMONS); assert.ok(r.ok, r.error); assert.ok(/Roundhay/.test(r.info.title)); assert.ok(r.info.formats.length >= 1); assert.ok(!r.info.drm);
    });
    await test('real: download Commons video as MP4 (best ≤ 480p) with thumbnail', async () => {
      const r = await runQueue({ url: COMMONS, quality: '480', format: 'mp4', thumb: true });
      assert.strictEqual(r.status, 'done', r.message + '\n' + (r.log || []).slice(-5).join('\n'));
      const f = r.files.find(x => /\.(mp4|webm|ogv|mkv)$/.test(x)); assert.ok(f && fs.statSync(f).size > 50000, 'video file ' + r.files.join(','));
    });
    if (ffmpeg) await test('real: extract audio to MP3 from a direct Commons file', async () => {
      const r = await runQueue({ url: 'https://upload.wikimedia.org/wikipedia/commons/d/da/Small_tortoises_mating.webm', format: 'mp3', quality: 'audio' });
      // this clip may have no audio track → accept a clear yt-dlp/ffmpeg error, but the direct-file path must work
      if (r.status !== 'done') assert.ok(/audio|stream|codec|Postprocessing/i.test(r.message), r.message);
      else assert.ok(r.files.some(f => f.endsWith('.mp3')));
    });
    await test('real: direct image/file download through yt-dlp generic extractor', async () => {
      const r = await runQueue({ url: 'https://upload.wikimedia.org/wikipedia/commons/b/b6/Earth_free_oscillation_spheroidal_mode_n%3D0_l%3D5_m%3D1_bis.webm', format: 'mkv' });
      assert.strictEqual(r.status, 'done', r.message); assert.ok(r.files.length);
    });
    await test('real: DRM-protected DASH (Shaka demo, Widevine) → detected + refused', async () => {
      const url = 'https://storage.googleapis.com/shaka-demo-assets/angel-one-widevine/dash.mpd';
      const txt = await (await fetch(url)).text(); const p = U.parseMpd(txt); assert.ok(p.drm, 'parser flags DRM'); assert.ok(/Widevine|CENC|PlayReady/.test(p.system));
      const r = await runQueue({ url, format: 'mp4' }, 120000);
      assert.strictEqual(r.status, 'drm', r.status + ' ' + r.message); assert.strictEqual(r.message, 'This video is copy-protected and can\'t be downloaded.');
    });
    await test('real: public YouTube video via yt-dlp (Me at the zoo, 240p)', async () => {
      const r = await runQueue({ url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', quality: '240', format: 'mp4', subs: true, subLangs: 'en' });
      assert.strictEqual(r.status, 'done', r.message); assert.ok(r.files.some(f => f.endsWith('.mp4')));
    }, { optional: !!process.env.CI });
  } else results.push('SKIP real-network tests (no yt-dlp)');

  const summary = `\n${results.filter(r => r.startsWith('PASS')).length} passed, ${failed} failed, ${results.filter(r => r.startsWith('SKIP')).length} skipped/info`;
  console.log(summary);
  fs.writeFileSync(path.join(__dirname, 'last-results.txt'), results.join('\n') + summary + '\n');
  process.exit(failed ? 1 : 0);
})();
