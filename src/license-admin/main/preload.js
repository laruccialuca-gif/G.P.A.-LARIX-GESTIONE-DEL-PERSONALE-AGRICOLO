const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('licenseAdminApi', {
  bootstrap: () => ipcRenderer.invoke('license-admin:bootstrap'),
  openDataDir: () => ipcRenderer.invoke('license-admin:open-data-dir'),
  customers: {
    list: (search) => ipcRenderer.invoke('license-admin:customers:list', search),
    create: (input) => ipcRenderer.invoke('license-admin:customers:create', input),
  },
  licenses: {
    list: (options) => ipcRenderer.invoke('license-admin:licenses:list', options),
    create: (input) => ipcRenderer.invoke('license-admin:licenses:create', input),
    renew: (input) => ipcRenderer.invoke('license-admin:licenses:renew', input),
    setStatus: (input) => ipcRenderer.invoke('license-admin:licenses:set-status', input),
    copyCode: (id) => ipcRenderer.invoke('license-admin:licenses:copy-code', id),
    exportCode: (id) => ipcRenderer.invoke('license-admin:licenses:export-code', id),
    verifyCompatibility: (code) => ipcRenderer.invoke('license-admin:licenses:verify-compatibility', code),
  },
});
