'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('mg', {
  init: inv('init'), setSettings: inv('set-settings'), pickFolder: inv('pick-folder'), openFolder: inv('open-folder'), showFile: inv('show-file'),
  openExternal: inv('open-external'), probe: inv('probe'), add: inv('add'), cancel: inv('cancel'), retry: inv('retry'), remove: inv('remove'),
  clearFinished: inv('clear-finished'), updateYtdlp: inv('update-ytdlp'), clipboard: inv('clipboard'), registerHost: inv('register-host'), jobLog: inv('job-log'),
  on: (ch, f) => { if (['queue', 'versions', 'ext'].includes(ch)) ipcRenderer.on(ch, (e, d) => f(d)); }
});
