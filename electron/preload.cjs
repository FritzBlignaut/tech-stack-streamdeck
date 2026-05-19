'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('streamDeck', {
  onInfo:    (cb) => { const wrap = (_, d) => cb(d); ipcRenderer.on('deck:info',  wrap); return () => ipcRenderer.removeListener('deck:info',  wrap) },
  onKeyDown: (cb) => { const wrap = (_, d) => cb(d); ipcRenderer.on('deck:down',  wrap); return () => ipcRenderer.removeListener('deck:down',  wrap) },
  onKeyUp:   (cb) => { const wrap = (_, d) => cb(d); ipcRenderer.on('deck:up',    wrap); return () => ipcRenderer.removeListener('deck:up',    wrap) },
  onSleep:   (cb) => { const wrap = (_, d) => cb(d); ipcRenderer.on('deck:sleep', wrap); return () => ipcRenderer.removeListener('deck:sleep', wrap) },
  onWake:    (cb) => { const wrap = (_, d) => cb(d); ipcRenderer.on('deck:wake',  wrap); return () => ipcRenderer.removeListener('deck:wake',  wrap) },
  setButtonIcon: (index, rgbaData) => ipcRenderer.invoke('button:setIcon', { index, rgbaData }),
  saveProfile:    (data)        => ipcRenderer.invoke('profile:save', data),
  loadProfile:    ()            => ipcRenderer.invoke('profile:load'),
  executeHotkey:    (keys)          => ipcRenderer.invoke('action:hotkey',        { keys }),
  openApplication:  (target, mode)  => ipcRenderer.invoke('action:open-app',      { target, mode }),
  openUrl:          (url)           => ipcRenderer.invoke('action:open-url',       { url }),
  runCommand:       (command)       => ipcRenderer.invoke('action:run-cmd',        { command }),
  sleepToggle:      ()              => ipcRenderer.invoke('action:sleep-toggle'),
  browseForFile:    ()              => ipcRenderer.invoke('dialog:open-file'),
  browseIconDir:    ()              => ipcRenderer.invoke('icons:browse-dir'),
  scanIconDir:      (dirPath)       => ipcRenderer.invoke('icons:scan-dir',  { dirPath }),
  loadIconFile:     (filePath)      => ipcRenderer.invoke('icons:load-file', { filePath }),
})
