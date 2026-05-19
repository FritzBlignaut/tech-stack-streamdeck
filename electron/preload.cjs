'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('streamDeck', {
  onInfo:       (cb) => ipcRenderer.on('deck:info',  (_, data) => cb(data)),
  onKeyDown:    (cb) => ipcRenderer.on('deck:down',  (_, data) => cb(data)),
  onKeyUp:      (cb) => ipcRenderer.on('deck:up',    (_, data) => cb(data)),
  onSleep:      (cb) => ipcRenderer.on('deck:sleep', (_, data) => cb(data)),
  onWake:       (cb) => ipcRenderer.on('deck:wake',  (_, data) => cb(data)),
  setButtonIcon: (index, rgbaData) => ipcRenderer.invoke('button:setIcon', { index, rgbaData }),
  saveProfile:    (data)        => ipcRenderer.invoke('profile:save', data),
  loadProfile:    ()            => ipcRenderer.invoke('profile:load'),
  executeHotkey:  (keys)        => ipcRenderer.invoke('action:hotkey', { keys }),
})
