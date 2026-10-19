// Stand-in for yt-dlp in queue tests. Behaviour is chosen by the URL.
const args = process.argv.slice(2); const url = args[args.length - 1];
const out = (s) => process.stdout.write(s + '\n');
if (args.includes('--allow-unplayable-formats')) { process.stderr.write('ERROR: forbidden flag reached yt-dlp\n'); process.exit(9); }
if (/drm/.test(url)) { process.stderr.write('ERROR: [generic] example: This video is DRM protected\n'); process.exit(1); }
if (/unsupported/.test(url)) { process.stderr.write('ERROR: Unsupported URL: ' + url + '\n'); process.exit(1); }
if (/fail/.test(url)) { process.stderr.write('ERROR: HTTP Error 500: boom\n'); process.exit(1); }
out('[MGTITLE] Fake title for ' + url.split('/').pop());
let i = 0;
const t = setInterval(() => {
  i += 25; out(`[MGP] ${i * 10}|1000|NA|2048|${(100 - i) / 10}|NA|NA|NA|NA`);
  if (i >= 100) { clearInterval(t); out('[MGPP] Merger|finished'); out('[MGFILE] ' + require('path').join(args[args.indexOf('-P') + 1], 'fake.mp4')); process.exit(0); }
}, 30);
