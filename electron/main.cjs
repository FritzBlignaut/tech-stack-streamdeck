'use strict'

const { app, BrowserWindow, ipcMain, dialog, protocol, net } = require('electron')
const path   = require('path')
const fs     = require('fs')
const { spawn } = require('child_process')

let mainWindow
let libraryDir = null

// Recursively walk a directory and collect image file paths
function scanDir(dirPath, maxFiles = 5000) {
  const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg'])
  const results = []
  function walk(dir, category) {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (results.length >= maxFiles) return
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, entry.name)
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (IMAGE_EXTS.has(ext)) {
          results.push({ name: path.basename(entry.name, ext), category, path: full })
        }
      }
    }
  }
  walk(dirPath, '')
  return results
}

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

  // Restore brightness when waking — renderer redraws icons from profile
  async function drawAwakeState() {
    await deck.setBrightness(100)
  }

  // Start with a clean panel; renderer will draw icons once the profile loads
  await deck.clearPanel()
  await drawAwakeState()
  console.log('[StreamDeck] Device ready')

  deck.on('down', async (control) => {
    if (isSleeping) {
      // Any button press wakes the deck
      isSleeping = false
      await drawAwakeState()
      sendToRenderer('deck:wake', {})
      console.log('[StreamDeck] Wake')
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
    // Don't blank the button here — the renderer will redraw it with the user's config
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

  // IPC: execute a hotkey via xdotool (Linux only)
  ipcMain.handle('action:hotkey', async (_, { keys }) => {
    // Allow only safe xdotool key names: letters, digits, F-keys, modifiers joined by +
    if (!keys || !/^[a-zA-Z0-9+_-]+$/.test(keys)) {
      return { error: 'Invalid hotkey string' }
    }
    return new Promise((resolve) => {
      const proc = spawn('xdotool', ['key', '--clearmodifiers', '--', keys], { stdio: 'ignore' })
      proc.on('close', (code) => resolve({ code }))
      proc.on('error', (err)  => resolve({ error: err.message }))
    })
  })

  // IPC: open application via xdg-open or direct binary
  ipcMain.handle('action:open-app', async (_, { target, mode }) => {
    if (!target?.trim()) return { error: 'No target specified' }
    const safeTarget = target.trim()
    let cmd, args
    if (mode === 'direct') {
      // Split so "flatpak run com.obsproject.Studio" → cmd=flatpak args=[run, ...]
      const parts = safeTarget.split(/\s+/)
      cmd  = parts[0]
      args = parts.slice(1)
    } else if (mode === 'xdg-open') {
      cmd  = 'xdg-open'
      args = [safeTarget]
    } else {
      // default: gtk-launch — resolves .desktop IDs including Flatpak apps
      cmd  = 'gtk-launch'
      args = [safeTarget]
    }
    console.log('[open-app] spawning:', cmd, args)
    return new Promise((resolve) => {
      const proc = spawn(cmd, args, { detached: true, stdio: 'ignore', env: process.env })
      proc.unref()
      proc.once('spawn', () => resolve({ code: 0 }))
      proc.once('error', (err) => {
        console.error('[open-app] error:', err.message)
        resolve({ error: err.message })
      })
    })
  })

  // IPC: sleep / wake toggle — triggered by renderer when a sleep-toggle action fires
  ipcMain.handle('action:sleep-toggle', async () => {
    if (isSleeping) {
      isSleeping = false
      await drawAwakeState()
      sendToRenderer('deck:wake', {})
      console.log('[StreamDeck] Wake (action)')
    } else {
      isSleeping = true
      await deck.clearPanel()
      await deck.setBrightness(0)
      sendToRenderer('deck:sleep', {})
      console.log('[StreamDeck] Sleep (action)')
    }
  })

  // IPC: open native file-picker so renderer can browse for a binary
  ipcMain.handle('dialog:open-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Application',
      properties: ['openFile'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // IPC: save / load profile JSON
  const profileDir  = app.getPath('userData')
  const profilePath = path.join(profileDir, 'Default Profile.json')

  ipcMain.handle('profile:save', async (_, data) => {
    await fs.promises.mkdir(profileDir, { recursive: true })
    await fs.promises.writeFile(profilePath, JSON.stringify(data, null, 2), 'utf8')
  })

  ipcMain.handle('profile:load', async () => {
    try {
      const raw = await fs.promises.readFile(profilePath, 'utf8')
      return JSON.parse(raw)
    } catch {
      return null
    }
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
  // Serve local icon library files via a custom protocol to avoid CORS issues in dev
  protocol.handle('iconlib', (request) => {
    const encoded = request.url.slice('iconlib://'.length)
    const filePath = decodeURIComponent(encoded)
    const resolved = path.resolve(filePath)
    const safeBase = libraryDir ? path.resolve(libraryDir) : null
    // Security: only serve files within the chosen library directory
    if (!safeBase || (!resolved.startsWith(safeBase + path.sep) && resolved !== safeBase)) {
      return new Response('Forbidden', { status: 403 })
    }
    const ext = path.extname(resolved).toLowerCase()
    if (!['.png', '.jpg', '.jpeg', '.gif', '.svg'].includes(ext)) {
      return new Response('Forbidden', { status: 403 })
    }
    return net.fetch('file://' + resolved)
  })

  createWindow()
  await initStreamDeck()

  // IPC: icon library — open folder picker
  ipcMain.handle('icons:browse-dir', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Icon Library Folder',
      properties: ['openDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // IPC: icon library — scan folder, return [{name, category, path}]
  ipcMain.handle('icons:scan-dir', async (_, { dirPath }) => {
    if (!dirPath) return { error: 'No path given' }
    const resolved = path.resolve(dirPath)
    libraryDir = resolved
    const icons = scanDir(resolved)
    return { icons }
  })

  // IPC: icon library — read one icon file, return base64 dataUrl
  ipcMain.handle('icons:load-file', async (_, { filePath }) => {
    if (!filePath) return { error: 'No path' }
    const resolved = path.resolve(filePath)
    const safeBase = libraryDir ? path.resolve(libraryDir) : null
    if (!safeBase || (!resolved.startsWith(safeBase + path.sep) && resolved !== safeBase)) {
      return { error: 'Path not in library' }
    }
    const ext = path.extname(resolved).toLowerCase()
    const ALLOWED = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg'])
    if (!ALLOWED.has(ext)) return { error: 'Not an image' }
    try {
      const data = fs.readFileSync(resolved)
      const mime = { '.svg': 'image/svg+xml', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }[ext] ?? 'image/png'
      return { dataUrl: `data:${mime};base64,${data.toString('base64')}` }
    } catch (err) {
      return { error: err.message }
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
