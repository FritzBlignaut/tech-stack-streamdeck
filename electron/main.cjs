'use strict'

const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

let mainWindow

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  // Dev: load from Vite dev server — respect VITE_PORT env var set by npm run electron:dev
  const port = process.env.VITE_PORT || '5173'
  mainWindow.loadURL(`http://localhost:${port}`)

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

  const buttonControls = deck.CONTROLS.filter(c => c.type === 'button')
  const rows = Math.max(...buttonControls.map(c => c.row)) + 1
  const cols = Math.max(...buttonControls.map(c => c.column)) + 1
  let isSleeping = false

  // Get pixel size from the first LCD button (feedbackType 'lcd' = has a display)
  const lcdButtons = buttonControls.filter(c => c.feedbackType === 'lcd')
  const ICON_SIZE = lcdButtons.length > 0 ? lcdButtons[0].pixelSize.width : null
  console.log(`[StreamDeck] Icon size: ${ICON_SIZE}px  (${lcdButtons.length} LCD buttons, ${buttonControls.length} total)`)

  // Build an RGB pixel buffer: a filled circle of (r,g,b) on a dark background.
  // This proves pixel-level hardware control (Phase 1 test image requirement).
  function circleBuffer(r, g, b) {
    const buf = Buffer.alloc(ICON_SIZE * ICON_SIZE * 3, 0)
    const cx = ICON_SIZE / 2
    const cy = ICON_SIZE / 2
    const radius = ICON_SIZE * 0.38
    for (let y = 0; y < ICON_SIZE; y++) {
      for (let x = 0; x < ICON_SIZE; x++) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
        const i = (y * ICON_SIZE + x) * 3
        if (dist <= radius) {
          buf[i] = r; buf[i + 1] = g; buf[i + 2] = b
        } else {
          buf[i] = 18; buf[i + 1] = 18; buf[i + 2] = 18
        }
      }
    }
    return buf
  }

  // Restore all buttons to their awake state.
  // Button 0 shows a green circle (sleep-toggle indicator).
  // All other buttons go dark.
  async function drawAwakeState() {
    await deck.setBrightness(100)
    if (ICON_SIZE) {
      await deck.fillKeyBuffer(0, circleBuffer(0, 200, 80), { format: 'rgb' })
    } else {
      await deck.fillKeyColor(0, 0, 200, 80)
    }
    for (let i = 1; i < buttonControls.length; i++) {
      await deck.fillKeyColor(i, 0, 0, 0)
    }
  }

  // Draw initial test pattern — proves hardware image drawing works
  await drawAwakeState()
  console.log('[StreamDeck] Test image drawn — button 0 (green circle) = sleep toggle')

  deck.on('down', async (control) => {
    if (isSleeping) {
      // Any button press wakes the deck
      isSleeping = false
      await drawAwakeState()
      sendToRenderer('deck:wake', {})
      console.log('[StreamDeck] Wake')
      return
    }

    if (control.index === 0) {
      // Button 0 = sleep toggle
      isSleeping = true
      await deck.clearPanel()
      await deck.setBrightness(0)
      sendToRenderer('deck:sleep', {})
      console.log('[StreamDeck] Sleep')
      return
    }

    // Flash the pressed button blue
    if (ICON_SIZE) {
      await deck.fillKeyBuffer(control.index, circleBuffer(0, 130, 255), { format: 'rgb' })
    } else {
      await deck.fillKeyColor(control.index, 0, 130, 255)
    }
    console.log(`[StreamDeck] KEY DOWN  index=${control.index}  row=${control.row}  col=${control.column}`)
    sendToRenderer('deck:down', { index: control.index, row: control.row, column: control.column })
  })

  deck.on('up', async (control) => {
    if (isSleeping) return
    if (control.index !== 0) {
      await deck.fillKeyColor(control.index, 0, 0, 0)
    }
    console.log(`[StreamDeck] KEY UP    index=${control.index}  row=${control.row}  col=${control.column}`)
    sendToRenderer('deck:up', { index: control.index, row: control.row, column: control.column })
  })

  deck.on('error', (err) => {
    console.error('[StreamDeck] Device error:', err)
  })

  console.log('[StreamDeck] Ready — press a button!')

  // Compute grid dimensions from the controls manifest — already done above

  const sendInfo = () => sendToRenderer('deck:info', {
    model: deviceInfo.model,
    productName: deck.PRODUCT_NAME,
    serialNumber: deviceInfo.serialNumber,
    rows,
    cols,
    iconSize: ICON_SIZE ?? 72,
  })

  // IPC: renderer sends RGBA pixel data → draw on physical button
  ipcMain.handle('button:setIcon', async (_, { index, rgbaData }) => {
    if (!deck) return
    if (rgbaData) {
      await deck.fillKeyBuffer(index, Buffer.from(rgbaData), { format: 'rgba' })
    } else {
      // null = clear to black
      await deck.fillKeyColor(index, 0, 0, 0)
    }
  })

  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', sendInfo)
  } else {
    sendInfo()
  }

  app.on('before-quit', () => {
    deck.clearPanel().catch(() => {})
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
