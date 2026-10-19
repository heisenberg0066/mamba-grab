/* Browser end-to-end test: loads the unpacked extension into Chromium (Playwright), with the native host registered
 * and the Mamba Grab app running, then checks scanning, filters, batch download, one-click video, DRM refusal and a few
 * real public pages. Usage: node test/e2e-extension.js  (needs playwright; set PLAYWRIGHT_PATH if not installed here) */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), { execFileSync } = require('child_process');
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const EXT = path.join(__dirname, '..', 'extension');
const EXT_ID = 'phppfdojjnpdbkpoiphpcefadmnkmjfd';
const WORK = path.join(__dirname, 'work', 'e2e'); const SITE = path.join(WORK, 'site'); const SHOTS = path.join(__dirname, 'work', 'shots');
const REAL = !process.env.MAMBA_OFFLINE;
const res = []; let failed = 0;
const ok = (name, cond, info) => { const l = (cond ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''); console.log(l); res.push(l); if (!cond) failed++; };
const info = (s) => { console.log('INFO ' + s); res.push('INFO ' + s); };

function makeSite() {
  fs.rmSync(WORK, { recursive: true, force: true }); fs.mkdirSync(path.join(SITE, 'stream'), { recursive: true }); fs.mkdirSync(path.join(SITE, 'protected'), { recursive: true }); fs.mkdirSync(SHOTS, { recursive: true });
  for (const f of fs.readdirSync(path.join(__dirname, 'fixtures'))) fs.copyFileSync(path.join(__dirname, 'fixtures', f), path.join(SITE, f));
  const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  for (const [n, w, h, c] of [['small', 200, 150, 'red'], ['big', 1600, 1200, 'blue'], ['placeholder', 10, 10, 'gray'], ['lazy_full', 1200, 800, 'green'], ['thumb', 100, 75, 'orange'], ['full', 2000, 1500, 'purple'], ['bg', 900, 600, 'yellow'], ['poster', 480, 270, 'black'], ['og', 1200, 630, 'pink']])
    ff(['-f', 'lavfi', '-i', `color=c=${c}:s=${w}x${h}`, '-vf', 'noise=alls=60:allf=t', '-frames:v', '1', path.join(SITE, n + '.png')]);
  ff(['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=f=440', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(SITE, 'clip.mp4')]);
  ff(['-f', 'lavfi', '-i', 'sine=f=660', '-t', '2', path.join(SITE, 'tone.mp3')]);
  fs.writeFileSync(path.join(SITE, 'doc.pdf'), '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
  fs.writeFileSync(path.join(SITE, 'data.zip'), Buffer.from('504b0506000000000000000000000000000000000000', 'hex'));
  fs.writeFileSync(path.join(SITE, 'notes.txt'), 'hello\n');
  fs.writeFileSync(path.join(SITE, 'stream', 'master.m3u8'), '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\nv360.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720\nv720.m3u8\n');
  for (const v of ['v360', 'v720']) fs.writeFileSync(path.join(SITE, 'stream', v + '.m3u8'), '#EXTM3U\n#EXT-X-TARGETDURATION:3\n#EXTINF:3,\n../clip.mp4\n#EXT-X-ENDLIST\n');
  fs.writeFileSync(path.join(SITE, 'protected', 'manifest.mpd'), '<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static"><Period><AdaptationSet mimeType="video/mp4"><ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc"/><ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"/><Representation id="1" bandwidth="1000000" height="1080" width="1920"/></AdaptationSet></Period></MPD>');
}
const TYPES = { html: 'text/html', js: 'text/javascript', png: 'image/png', mp4: 'video/mp4', mp3: 'audio/mpeg', pdf: 'application/pdf', zip: 'application/zip', txt: 'text/plain', m3u8: 'application/vnd.apple.mpegurl', mpd: 'application/dash+xml' };
function serve() {
  return new Promise((r) => {
    const s = http.createServer((q, w) => {
      const p = path.join(SITE, decodeURIComponent(q.url.split('?')[0]));
      if (!p.startsWith(SITE) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { w.writeHead(404); return w.end(); }
      const b = fs.readFileSync(p); w.writeHead(200, { 'content-type': TYPES[path.extname(p).slice(1)] || 'application/octet-stream', 'content-length': b.length, 'access-control-allow-origin': '*' }); w.end(q.method === 'HEAD' ? undefined : b);
    }).listen(0, '127.0.0.1', () => r({ s, base: `http://127.0.0.1:${s.address().port}/` }));
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  makeSite(); const { s: server, base } = await serve();
  const profile = path.join(WORK, 'profile'); fs.mkdirSync(path.join(profile, 'NativeMessagingHosts'), { recursive: true });
  const mf = path.join(os.homedir(), '.config', 'google-chrome', 'NativeMessagingHosts', 'com.ammar.mambagrab.json');
  if (fs.existsSync(mf)) fs.copyFileSync(mf, path.join(profile, 'NativeMessagingHosts', 'com.ammar.mambagrab.json'));
  const dl = path.join(WORK, 'downloads'); fs.mkdirSync(dl, { recursive: true });
  const ctx = await pw.chromium.launchPersistentContext(profile, { headless: !!process.env.HEADLESS, viewport: { width: 1280, height: 860 }, acceptDownloads: true, downloadsPath: dl,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run', '--autoplay-policy=no-user-gesture-required'] });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  ok('extension loads with the fixed ID', extId === EXT_ID, extId);
  // downloads go to a known folder
  await sw.evaluate(() => chrome.storage.local.set({ subfolder: true, lang: 'en' }));
  // the app is started by the native host on demand (as the extension does with "start the app automatically")
  const boot = await sw.evaluate(() => new Promise(r => chrome.runtime.sendNativeMessage('com.ammar.mambagrab', { cmd: 'ping', launch: true }, (x) => r(x || { error: chrome.runtime.lastError && chrome.runtime.lastError.message }))));
  ok('native host auto-starts the app', boot && boot.ok === true, JSON.stringify(boot));

  async function popupFor(page) {
    const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({})).find(t => t.url === u).id, page.url());
    const pop = await ctx.newPage(); await pop.setViewportSize({ width: 780, height: 900 });
    await pop.goto(`chrome-extension://${extId}/popup.html?tab=${tabId}`);
    await pop.waitForFunction(() => window.__scanDone === true, null, { timeout: 60000 }).catch(() => { });
    await sleep(500);
    return { pop, tabId };
  }
  // waits for the job created by the last "Download this video" click to finish (status from the live queue)
  const lastJob = async (pop, ms) => {
    await pop.waitForFunction(() => { const id = window.__lastJob; const e = id && document.querySelector(`.job[data-id="${id}"]`); return e && /^(done|error|drm|canceled)$/.test(e.dataset.status); }, null, { timeout: ms }).catch(() => { });
    return pop.evaluate(() => { const id = window.__lastJob; const e = id && document.querySelector(`.job[data-id="${id}"]`); return { id, status: e ? e.dataset.status : 'missing', text: e ? e.textContent : '' }; });
  };
  const itemsOf = (pop) => pop.evaluate(() => items.map(i => ({ url: i.url, kind: i.kind, stream: i.stream, width: i.width, height: i.height, size: i.size, upgradedFrom: i.upgradedFrom, source: i.source, variants: i.variants, drm: i.drm })));

  // ── 1. local gallery ──
  const page = await ctx.newPage(); await page.goto(base + 'gallery.html'); await page.waitForLoadState('networkidle'); await sleep(800);
  let { pop, tabId } = await popupFor(page);
  let it = await itemsOf(pop);
  const has = (re, k) => it.find(i => re.test(i.url) && (!k || i.kind === k));
  ok('srcset → largest candidate (big.png 1600w)', !!has(/big\.png$/, 'image') && !has(/small\.png$/));
  ok('lazy data-src → full image', !!has(/lazy_full\.png$/, 'image'));
  ok('linked thumbnail → linked original', !!has(/\/full\.png$/, 'image'));
  ok('CSS background image', !!has(/bg\.png$/, 'image'));
  ok('og:image meta', !!has(/og\.png$/, 'image'));
  ok('poster image', !!has(/poster\.png$/, 'image'));
  ok('PDF/doc links', !!has(/doc\.pdf$/, 'doc') && !!has(/notes\.txt$/, 'doc'));
  ok('archive link', !!has(/data\.zip$/, 'archive'));
  ok('<video> file', !!has(/clip\.mp4$/, 'video'));
  ok('<audio> file', !!has(/tone\.mp3$/, 'audio'));
  const hls = has(/master\.m3u8$/);
  ok('HLS stream sniffed from network, variants parsed (720p best)', !!hls && hls.stream === 'hls' && hls.variants && hls.variants[0].height === 720, JSON.stringify(hls && hls.variants));
  ok('child variant playlists hidden', !has(/v720\.m3u8$/));
  const big = has(/big\.png$/); ok('image resolution + size measured', big && big.width === 1600 && big.height === 1200 && big.size > 1000, JSON.stringify(big));
  const pill = await pop.textContent('#appStatus'); ok('popup sees the companion app', /connected/i.test(pill), pill);
  await pop.screenshot({ path: path.join(SHOTS, 'popup-gallery.png'), fullPage: true });
  // filters
  await pop.click('.tab:has-text("Images")'); let n = await pop.$$eval('.card', c => c.length); ok('type filter: Images', n === it.filter(i => i.kind === 'image').length, n + ' cards');
  await pop.selectOption('#minRes', '1000'); n = await pop.$$eval('.card', c => c.length); ok('resolution filter ≥1000px', n === 4, n + ' cards (big, lazy_full, full, og)');
  await pop.selectOption('#minRes', '0');
  // batch download: all images
  const before = Date.now();
  const nImg = it.filter(i => i.kind === 'image').length;
  await pop.click('#dlAll');
  let done = [];
  for (let i = 0; i < 40; i++) { done = await sw.evaluate(async (t) => (await chrome.downloads.search({ startedAfter: new Date(t - 1000).toISOString() })).filter(d => d.state === 'complete').map(d => d.filename), before); if (done.length >= nImg) break; await sleep(500); }
  // (Playwright stores downloads under GUID names, so only the count/state is checked here)
  ok('batch "Download all" (images) via browser downloads API', done.length === nImg, done.length + '/' + nImg + ' complete');
  await pop.selectOption('#minRes', '0'); await pop.click('.tab:has-text("All")');
  await pop.screenshot({ path: path.join(SHOTS, 'popup-gallery-all.png'), fullPage: true });
  // app status & one-click video (page URL → yt-dlp in the app)
  await pop.selectOption('#quality', 'best'); await pop.selectOption('#format', 'mp4');
  await pop.click('#dlVideo');
  await pop.waitForFunction(() => !document.querySelector('#heroMsg').classList.contains('hidden') && document.querySelector('#heroMsg').textContent !== '…', null, { timeout: 40000 }).catch(() => { });
  const m1 = await pop.textContent('#heroMsg'); ok('"Download this video" → sent to app', /Sent to the Mamba Grab app/.test(m1), m1);
  const st1 = await lastJob(pop, 120000);
  ok('live queue in popup shows the job finishing', st1.status === 'done', JSON.stringify(st1));
  await pop.screenshot({ path: path.join(SHOTS, 'popup-job-done.png'), fullPage: true });
  // the hover button on the video
  await page.bringToFront(); await page.hover('#v'); await sleep(300);
  const hb = await page.evaluate(() => { const h = document.querySelector('mamba-grab-button'); return h ? { display: h.style.display, top: h.style.top, left: h.style.left } : null; });
  ok('hover "Download this video" button appears over the video', hb && hb.display === 'block', JSON.stringify(hb));
  await page.screenshot({ path: path.join(SHOTS, 'hover-button.png') });
  await pop.close();

  // ── 2. DRM page ──
  const dp = await ctx.newPage(); await dp.goto(base + 'drm.html'); await dp.waitForFunction(() => /mediaKeys set|EME error/.test(document.title), null, { timeout: 15000 }).catch(() => { }); await sleep(3000);
  info('DRM page title: ' + await dp.title());
  ({ pop } = await popupFor(dp));
  const banner = await pop.isVisible('#drmBanner'); ok('DRM page → copy-protected banner', banner);
  it = await itemsOf(pop); const mpd = it.find(i => /manifest\.mpd$/.test(i.url)); ok('protected DASH manifest flagged DRM (Widevine)', mpd && mpd.drm, JSON.stringify(mpd));
  await pop.click('#dlVideo'); await sleep(500); const m2 = await pop.textContent('#heroMsg');
  ok('"Download this video" on DRM page → refused with the clear message', m2.trim() === 'This video is copy-protected and can\'t be downloaded.', m2);
  const imgStill = it.some(i => /big\.png$/.test(i.url)); ok('other (non-DRM) files on a DRM page still listed', imgStill);
  const locked = await pop.$$eval('.card.locked', c => c.length); ok('DRM stream card is locked (no download button)', locked >= 1, locked + ' locked');
  await pop.screenshot({ path: path.join(SHOTS, 'popup-drm.png'), fullPage: true });
  // Arabic UI
  await pop.click('.lang button[data-lang="ar"]'); await sleep(300);
  const dir = await pop.evaluate(() => document.documentElement.dir); const arBtn = await pop.textContent('#dlVideo');
  ok('Arabic UI (RTL)', dir === 'rtl' && /تنزيل/.test(arBtn), arBtn);
  await pop.screenshot({ path: path.join(SHOTS, 'popup-drm-ar.png'), fullPage: true });
  await pop.click('.lang button[data-lang="en"]'); await pop.close();

  // ── 3. real public pages ──
  if (REAL) {
    const jobWait = async (pop, re, ms) => { await pop.waitForFunction((r) => [...document.querySelectorAll('.job')].some(j => /\b(done|error|drm)\b/.test(j.className) && new RegExp(r, 'i').test(j.textContent)), re, { timeout: ms }).catch(() => { }); return pop.$$eval('.job', j => j.map(x => x.className + ' | ' + x.textContent).slice(0, 4)); };
    try {
      const cp = await ctx.newPage(); await cp.goto('https://commons.wikimedia.org/wiki/File:Roundhay_Garden_Scene.ogv', { waitUntil: 'domcontentloaded' }); await sleep(3000);
      ({ pop } = await popupFor(cp)); it = await itemsOf(pop);
      const vids = it.filter(i => i.kind === 'video'); ok('Commons file page: video detected', vids.length > 0, vids.length ? vids.map(v => v.url.split('/').pop()).slice(0, 4).join(', ') : `items=${it.length} url=${cp.url()} kinds=${JSON.stringify(it.map(i => i.kind + ':' + i.source))} frames=${JSON.stringify(await pop.evaluate(() => [window.__frames, window.__scanErrors]))}`);
      await pop.selectOption('#format', 'mp4'); await pop.click('#dlVideo');
      const j = await lastJob(pop, 150000); ok('Commons video downloaded by the app (mp4)', j.status === 'done' && /Roundhay/.test(j.text), JSON.stringify(j));
      await pop.screenshot({ path: path.join(SHOTS, 'popup-commons.png'), fullPage: true }); await pop.close(); await cp.close();
    } catch (e) { ok('Commons video page', false, e.message); }
    try {
      const gp = await ctx.newPage(); await gp.goto('https://commons.wikimedia.org/wiki/Category:Featured_pictures_of_landscapes', { waitUntil: 'domcontentloaded' }); await sleep(3000);
      ({ pop } = await popupFor(gp)); it = await itemsOf(pop);
      const imgs = it.filter(i => i.kind === 'image'); const up = imgs.filter(i => i.upgradedFrom);
      ok('Commons gallery: thumbnails upgraded to originals', up.length >= 20 && !imgs.some(i => /\/wiki\/File:/.test(i.url)), `${imgs.length} images, ${up.length} upgraded, e.g. ${up[0] && up[0].url}`);
      await pop.selectOption('#minRes', '1920'); await pop.waitForFunction(() => window.__dimsDone === true, null, { timeout: 120000 }).catch(() => { }); const nBig = await pop.$$eval('.card', c => c.length); info(`gallery: ${nBig} images ≥ 1920px after loading`);
      await pop.screenshot({ path: path.join(SHOTS, 'popup-commons-gallery.png'), fullPage: true }); await pop.selectOption('#minRes', '0'); await pop.close(); await gp.close();
    } catch (e) { ok('Commons gallery page', false, e.message); }
    try {
      const yp = await ctx.newPage(); await yp.goto('https://www.youtube.com/watch?v=jNQXAC9IVRw', { waitUntil: 'domcontentloaded' }); await sleep(5000);
      if (/google\.com\/sorry/.test(yp.url())) throw Object.assign(new Error('YouTube served a bot-check page to this (datacenter) browser — skipped; yt-dlp itself is tested in run-tests.js'), { skip: true });
      ({ pop } = await popupFor(yp));
      ok('YouTube page: "works best through the app" hint', await pop.isVisible('#siteHint'));
      await pop.selectOption('#quality', '360'); await pop.selectOption('#format', 'mp4'); await pop.click('#dlVideo');
      const j = await lastJob(pop, 180000); ok('public YouTube video downloaded via yt-dlp in the app', j.status === 'done' && /zoo/i.test(j.text), JSON.stringify(j));
      await pop.screenshot({ path: path.join(SHOTS, 'popup-youtube.png'), fullPage: true }); await pop.close(); await yp.close();
    } catch (e) { if (e.skip) info(e.message); else ok('YouTube page', false, e.message); }
  }
  await ctx.close(); server.close();
  const sum = `${res.filter(r => r.startsWith('PASS')).length} passed, ${failed} failed`;
  console.log(sum); fs.writeFileSync(path.join(__dirname, 'work', 'e2e-results.txt'), res.join('\n') + '\n' + sum + '\n');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
