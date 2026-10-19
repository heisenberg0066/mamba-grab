// Minimal stand-in for the Mamba Grab app: answers on the pipe (used to test the host's launch path).
const { startPipeServer } = require('../src/pipe-server');
startPipeServer({ ping: async () => ({ ok: true, app: 'fake' }), list: () => [] }).then(() => setTimeout(() => process.exit(0), 8000));
