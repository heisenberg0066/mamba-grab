'use strict';
/* Local IPC endpoint for the native-messaging host (named pipe on Windows, unix socket elsewhere). NDJSON. */
const net = require('net'), fs = require('fs');
const { pipePath } = require('../host/pipe-path');

function startPipeServer(handlers) {
  const p = pipePath();
  if (process.platform !== 'win32') { try { fs.unlinkSync(p); } catch (e) { } }
  const subscribers = new Set();
  const server = net.createServer((sock) => {
    sock.setEncoding('utf8'); let buf = '';
    const send = (o) => { try { sock.write(JSON.stringify(o) + '\n'); } catch (e) { } };
    sock.on('data', async (d) => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let m; try { m = JSON.parse(line); } catch (e) { continue; }
        let r;
        try {
          if (m.cmd === 'subscribe') { subscribers.add(send); r = { ok: true }; setTimeout(() => send({ event: 'jobs', jobs: handlers.list() }), 10); }
          else if (handlers[m.cmd]) r = await handlers[m.cmd](m);
          else r = { ok: false, error: 'unknown command ' + m.cmd };
        } catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
        send(Object.assign({ _seq: m._seq, id: m.id }, r));
      }
    });
    sock.on('close', () => subscribers.delete(send));
    sock.on('error', () => subscribers.delete(send));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(p, () => resolve({
      server, path: p,
      broadcast: (o) => { for (const s of subscribers) s(o); },
      close: () => new Promise(r => server.close(r))
    }));
  });
}
module.exports = { startPipeServer };
