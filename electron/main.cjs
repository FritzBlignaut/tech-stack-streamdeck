'use strict'

const { app, BrowserWindow } = require('electron')

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // Dev: load from Vite dev server (run `npm run dev` first in a separate terminal)
  mainWindow.loadURL('http://localhost:5173')

  // Show DevTools so console output from the renderer is visible too
  mainWindow.webContents.openDevTools()

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

async function initStreamDeck() {
  const { listStreamDecks, openStreamDeck } = require('@elgato-stream-deck/node')

  let devices
  try {
    devices = await listStreamDecks()
  } catch (err) {
    console.error('[StreamDeck] Failed to list devices:', err.message)
    return
  }

  if (devices.length === 0) {
    console.log('[StreamDeck] No devices found — is it plugged in and do udev rules apply?')
    return
  }

  const deviceInfo = devices[0]
  console.log(`[StreamDeck] Found: ${deviceInfo.model}  path: ${deviceInfo.path}`)

  let deck
  try {
    deck = await openStreamDeck(deviceInfo.path)
  } catch (err) {
    console.error('[StreamDeck] Failed to open device:', err.message)
    return
  }

  deck.on('down', (control) => {
    console.log(`[StreamDeck] KEY DOWN  index=${control.index}  row=${control.row}  col=${control.column}`)
  })

  deck.on('up', (control) => {
    console.log(`[StreamDeck] KEY UP    index=${control.index}  row=${control.row}  col=${control.column}`)
  })

  deck.on('error', (err) => {
    console.error('[StreamDeck] Device error:', err)
  })

  console.log('[StreamDeck] Ready — press a button!')

  app.on('before-quit', () => {
    deck.close().catch(() => {})
  })
}

app.whenReady().then(async () => {
  createWindow()
  await initStreamDeck()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
