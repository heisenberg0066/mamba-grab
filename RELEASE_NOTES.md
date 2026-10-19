## Mamba Grab 1.0.0

First release — Chrome/Edge extension (Manifest V3) + offline Windows x64 companion app.

**Files**
* `MambaGrab-Setup-1.0.0-x64.exe` — installs the app and registers the native-messaging host for Chrome and Edge (per user, no admin).
* `MambaGrab-Extension-1.0.0.zip` — the extension (also installed with the app under `resources\extension`).
* `MambaGrab-1.0.0-win-x64.zip` — app without installer.

**Load the extension (developer mode, no Web Store):** unzip to a permanent folder → `chrome://extensions` or `edge://extensions` → enable **Developer mode** → **Load unpacked** → choose the folder with `manifest.json` → pin Mamba Grab. Extension ID: `phppfdojjnpdbkpoiphpcefadmnkmjfd`.

**Highlights**
* Detects videos (incl. HLS/DASH and blob/MSE players via network sniffing), audio, images at the highest available resolution (srcset, lazy-load attributes, CSS backgrounds, original-size URL patterns), PDFs and other documents; grid with type/size/resolution filters; batch download; one-click “Download this video” (popup, hover button, context menu).
* Companion app with bundled yt-dlp (auto-updating) + FFmpeg: best or chosen quality, MP4/MKV/WEBM, MP3/M4A/OPUS/WAV/FLAC, exact formats, playlists, subtitles, thumbnails, queue with progress, output folder, tray.
* Falls back to the browser's downloads API for direct files when the app isn't available.
* Opt-in use of your own browser session (site cookies sent for one job, or `--cookies-from-browser`).
* EN/AR UI.
* **No DRM circumvention** — copy-protected content is detected and refused with “This video is copy-protected and can't be downloaded.”
