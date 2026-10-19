// Copies extension/ → dist-ext/ (bundled with the app) and zips it → dist/MambaGrab-Extension-<version>.zip
'use strict';
const fs = require('fs'), path = require('path'), JSZip = require('jszip');
const root = path.join(__dirname, '..'), src = path.join(root, 'extension'), out = path.join(root, 'dist-ext');
const version = require('../package.json').version;
const m = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
if (m.version !== version) throw new Error(`extension version ${m.version} != package ${version}`);
fs.rmSync(out, { recursive: true, force: true });
const zip = new JSZip(); const top = zip.folder('mamba-grab-extension');
(function copy(d, rel) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f), r = path.join(rel, f);
    if (fs.statSync(p).isDirectory()) { fs.mkdirSync(path.join(out, r), { recursive: true }); copy(p, r); }
    else { fs.mkdirSync(path.dirname(path.join(out, r)), { recursive: true }); fs.copyFileSync(p, path.join(out, r)); top.file(r.split(path.sep).join('/'), fs.readFileSync(p)); }
  }
})(src, '');
top.file('INSTALL.txt', [
  'Mamba Grab extension ' + version + ' — load it as an unpacked extension (no Web Store listing).', '',
  'Chrome: 1) unzip this folder somewhere permanent (e.g. Documents\\Mamba Grab Extension)', '  2) open chrome://extensions  3) switch on "Developer mode" (top right)', '  4) "Load unpacked" → pick the folder that contains manifest.json  5) pin Mamba Grab (puzzle icon).',
  'Edge: same steps at edge://extensions ("Developer mode" is in the left sidebar).', '',
  'Install MambaGrab-Setup-' + version + '-x64.exe too: it registers the native-messaging host for Chrome and Edge,', 'so streams/YouTube etc. are downloaded by the app (yt-dlp + FFmpeg). Without the app, direct files still download through the browser.', '',
  'The Setup also installs this same folder at %LOCALAPPDATA%\\Programs\\Mamba Grab\\resources\\extension (Start menu → "Mamba Grab Extension Folder").'
].join('\r\n'));
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const zp = path.join(root, 'dist', `MambaGrab-Extension-${version}.zip`);
zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }).then(b => { fs.writeFileSync(zp, b); console.log('wrote', zp, b.length, 'bytes; dist-ext ready'); });
