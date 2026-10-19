// Plays nothing: it only sets up EME the way a protected player does (ClearKey is built into Chromium) and
// fetches a CENC/Widevine-signalled manifest, so the extension's DRM detection can be tested.
fetch('protected/manifest.mpd').then(r => r.text());
const cfg = [{ initDataTypes: ['cenc'], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }] }];
navigator.requestMediaKeySystemAccess('org.w3.clearkey', cfg).then(a => a.createMediaKeys()).then(k => document.getElementById('v').setMediaKeys(k)).then(() => { document.title += ' (mediaKeys set)'; }).catch(e => { document.title += ' EME error ' + e; });
