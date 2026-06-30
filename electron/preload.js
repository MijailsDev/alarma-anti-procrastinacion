const { contextBridge } = require('electron');

const backendPort = process.argv
  .find(arg => arg.startsWith('--backend-port='))
  ?.split('=')[1];

contextBridge.exposeInMainWorld('electronAPI', {
  apiBase: `http://127.0.0.1:${backendPort}/api`
});
