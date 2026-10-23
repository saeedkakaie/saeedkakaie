/*
 * پل امن بین صفحه برنامه و پوسته رومیزی: فقط همین چند فرمان در دسترس صفحه است.
 * کلید Claude فقط به پوسته فرستاده می‌شود و هیچ فرمانی برای خواندن آن وجود ندارد.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ibpDesktop', {
  info: () => ipcRenderer.invoke('ibp:info'),
  setClaudeKey: (key) => ipcRenderer.invoke('ibp:setClaudeKey', key),
  restartEngine: () => ipcRenderer.invoke('ibp:restartEngine'),
  openDataFolder: () => ipcRenderer.invoke('ibp:openDataFolder'),
  openEngineLog: () => ipcRenderer.invoke('ibp:openEngineLog'),
  setUpdateConfig: (cfg) => ipcRenderer.invoke('ibp:setUpdateConfig', cfg),
  checkUpdates: () => ipcRenderer.invoke('ibp:checkUpdates'),
  onEngine: (cb) => { const f = (_e, st) => cb(st); ipcRenderer.on('ibp:engine', f); return () => ipcRenderer.removeListener('ibp:engine', f); }
});
