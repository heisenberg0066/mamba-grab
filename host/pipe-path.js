'use strict';
// Where the Mamba Grab app listens for the native-messaging host (per user).
const os = require('os'), path = require('path');
function pipePath() {
  if (process.env.MAMBA_GRAB_PIPE) return process.env.MAMBA_GRAB_PIPE;
  let user = 'user'; try { user = os.userInfo().username.replace(/[^\w.-]+/g, '_'); } catch (e) { }
  if (process.platform === 'win32') return '\\\\.\\pipe\\mamba-grab-' + user;
  return path.join(os.tmpdir(), 'mamba-grab-' + user + '.sock');
}
function launchMarker() { return path.join(os.tmpdir(), 'mamba-grab-launch.json'); }
module.exports = { pipePath, launchMarker };
