'use strict'

const { app, BrowserWindow, ipcMain, dialog, protocol, net, Tray, Menu, nativeImage } = require('electron')
const path   = require('path')
const fs     = require('fs')
const { spawn } = require('child_process')

let mainWindow
let libraryDir = null
let activeProfileName = 'Default Profile'
let tray           = null
let isQuitting     = false
let deck           = null   // current Stream Deck connection
let isSleeping     = false  // hardware sleep state
let reconnectTimer = null   // USB reconnect polling timer

// ── Tray icon: 22×22 PNG of a 5×3 button grid, no extra deps ─
function createTrayIconPng() {
  const { deflateSync } = require('zlib')
  const W = 22, H = 22
  const BG = [30, 30, 30]    // #1e1e1e
  const FG = [90, 156, 245]  // #5a9cf5
  const colStarts = [2, 6, 10, 14, 18]  // 5 cols, 3 px wide, 1 px gap
  const rowStarts = [4, 9, 14]          // 3 rows, 3 px tall, 2 px gap

  const rawRows = []
  for (let y = 0; y < H; y++) {
    rawRows.push(0)  // PNG filter byte: none
    for (let x = 0; x < W; x++) {
      const isBtn = colStarts.some(cx => x >= cx && x < cx + 3) &&
                    rowStarts.some(ry => y >= ry && y < ry + 3)
      rawRows.push(...(isBtn ? FG : BG))
    }
  }

  const CRC = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    CRC[n] = c
  }
  function crc32(buf) {
    let c = 0xFFFFFFFF
    for (const b of buf) c = CRC[(c ^ b) & 0xFF] ^ (c >>> 8)
    return (c ^ 0xFFFFFFFF) >>> 0
  }
  function mkChunk(type, data) {
    const t   = Buffer.from(type, 'ascii')
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
    return Buffer.concat([len, t, data, crc])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8; ihdr[9] = 2  // 8-bit, RGB

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    mkChunk('IHDR', ihdr),
    mkChunk('IDAT', deflateSync(Buffer.from(rawRows))),
    mkChunk('IEND', Buffer.alloc(0)),
  ])
}

function createTray() {
  const icon = nativeImage.createFromBuffer(createTrayIconPng())
  tray = new Tray(icon)
  tray.setToolTip('Tech Stack Stream Deck')
  const menu = Menu.buildFromTemplate([
    { label: 'Show Window', click: () => { mainWindow?.show(); mainWindow?.focus() } },
    { type: 'separator' },
    { label: 'Quit',        click: () => { isQuitting = true; app.quit() } },
  ])
  tray.setContextMenu(menu)
  // Left-click shows window (works on Windows/KDE; GNOME AppIndicator ignores it)
  tray.on('click', () => { mainWindow?.show(); mainWindow?.focus() })
}

function getProfilePath(name) {
  return path.join(app.getPath('userData'), `${name}.json`)
}

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

  // Hide to tray on close unless a real quit was requested
  mainWindow.on('close', e => {
    if (!isQuitting) { e.preventDefault(); mainWindow.hide() }
  })
}

// ── IPC handlers — registered once; use module-level deck/state ─────────────
function registerIpcHandlers() {
  // Hotkey via xdotool (Linux)
  ipcMain.handle('action:hotkey', async (_, { keys }) => {
    if (!keys || !/^[a-zA-Z0-9+_-]+$/.test(keys)) return { error: 'Invalid hotkey string' }
    return new Promise((resolve) => {
      const proc = spawn('xdotool', ['key', '--clearmodifiers', '--', keys], { stdio: 'ignore' })
      proc.on('close', (code) => resolve({ code }))
      proc.on('error', (err)  => resolve({ error: err.message }))
    })
  })

  ipcMain.handle('action:open-app', async (_, { target, mode }) => {
    if (!target?.trim()) return { error: 'No target specified' }
    const safeTarget = target.trim()
    let cmd, args
    if (mode === 'direct') {
      const parts = safeTarget.split(/\s+/); cmd = parts[0]; args = parts.slice(1)
    } else if (mode === 'xdg-open') {
      cmd = 'xdg-open'; args = [safeTarget]
    } else {
      cmd = 'gtk-launch'; args = [safeTarget]
    }
    console.log('[open-app] spawning:', cmd, args)
    return new Promise((resolve) => {
      const proc = spawn(cmd, args, { detached: true, stdio: 'ignore', env: process.env })
      proc.unref()
      proc.once('spawn', () => resolve({ code: 0 }))
      proc.once('error', (err) => { console.error('[open-app] error:', err.message); resolve({ error: err.message }) })
    })
  })

  ipcMain.handle('action:open-url', async (_, { url }) => {
    if (!url?.trim()) return { error: 'No URL specified' }
    const safe = url.trim()
    if (!/^https?:\/\//i.test(safe) && !/^ftp:\/\//i.test(safe)) return { error: 'Only http/https/ftp URLs are allowed' }
    return new Promise((resolve) => {
      const proc = spawn('xdg-open', [safe], { detached: true, stdio: 'ignore', env: process.env })
      proc.unref()
      proc.once('spawn', () => resolve({ code: 0 }))
      proc.once('error', (err) => resolve({ error: err.message }))
    })
  })

  ipcMain.handle('action:run-cmd', async (_, { command }) => {
    if (!command?.trim()) return { error: 'No command specified' }
    return new Promise((resolve) => {
      const proc = spawn('bash', ['-c', command.trim()], { detached: true, stdio: 'ignore', env: process.env })
      proc.unref()
      proc.once('spawn', () => resolve({ code: 0 }))
      proc.once('error', (err) => resolve({ error: err.message }))
    })
  })

  ipcMain.handle('action:sleep-toggle', async () => {
    if (!deck) return
    if (isSleeping) {
      isSleeping = false
      await deck.setBrightness(100)
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

  ipcMain.handle('dialog:open-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Select Application', properties: ['openFile'] })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('profile:save', async (_, data) => {
    const p = getProfilePath(activeProfileName)
    await fs.promises.mkdir(path.dirname(p), { recursive: true })
    await fs.promises.writeFile(p, JSON.stringify(data, null, 2), 'utf8')
  })

  ipcMain.handle('profile:load', async () => {
    try { return JSON.parse(await fs.promises.readFile(getProfilePath(activeProfileName), 'utf8')) }
    catch { return null }
  })

  ipcMain.handle('profile:list', async () => {
    try {
      const files = await fs.promises.readdir(app.getPath('userData'))
      const names = files
        .filter(f => f.endsWith('.json') && !f.startsWith('.'))
        .map(f => f.slice(0, -5))
        .sort((a, b) => a.localeCompare(b))
      return names.length ? names : ['Default Profile']
    } catch { return ['Default Profile'] }
  })

  ipcMain.handle('profile:get-active', async () => activeProfileName)

  ipcMain.handle('profile:switch', async (_, { name }) => {
    if (!name || typeof name !== 'string') return { ok: false, error: 'Invalid name' }
    try {
      const data = JSON.parse(await fs.promises.readFile(getProfilePath(name), 'utf8'))
      activeProfileName = name
      return { ok: true, data }
    } catch (e) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('profile:create', async (_, { name }) => {
    if (!name || typeof name !== 'string') return { ok: false, error: 'Invalid name' }
    const safe = name.trim().replace(/[/\\:*?"<>|]/g, '')
    if (!safe) return { ok: false, error: 'Invalid profile name' }
    const p = getProfilePath(safe)
    try { await fs.promises.access(p); return { ok: false, error: 'Profile already exists' } } catch { /* doesn't exist — good */ }
    await fs.promises.writeFile(p, JSON.stringify({ name: safe, buttons: {} }, null, 2), 'utf8')
    activeProfileName = safe
    return { ok: true, name: safe }
  })

  ipcMain.handle('profile:delete', async (_, { name }) => {
    if (name === activeProfileName) return { ok: false, error: 'Cannot delete the active profile' }
    try { await fs.promises.unlink(getProfilePath(name)); return { ok: true } }
    catch (e) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('button:setIcon', async (_, { index, rgbaData }) => {
    if (!deck) return
    if (rgbaData) await deck.fillKeyBuffer(index, Buffer.from(rgbaData), { format: 'rgba' })
    else          await deck.fillKeyColor(index, 0, 0, 0)
  })
}

// ── Open a Stream Deck and wire up its events ─────────────────────────────────
async function connectDeck() {
  const { listStreamDecks, openStreamDeck } = require('@elgato-stream-deck/node')

  let devices
  try { devices = await listStreamDecks() }
  catch (err) { console.error('[StreamDeck] Failed to list devices:', err.message); return }

  if (!devices.length) {
    console.log('[StreamDeck] No devices found — is it plugged in and do udev rules apply?')
    return
  }

  const deviceInfo = devices[0]
  console.log(`[StreamDeck] Found: ${deviceInfo.model}  path: ${deviceInfo.path}`)

  let newDeck
  try { newDeck = await openStreamDeck(deviceInfo.path) }
  catch (err) { console.error('[StreamDeck] Failed to open device:', err.message); return }

  deck       = newDeck
  isSleeping = false

  const buttonControls = newDeck.CONTROLS.filter(c => c.type === 'button')
  const rows = Math.max(...buttonControls.map(c => c.row)) + 1
  const cols = Math.max(...buttonControls.map(c => c.column)) + 1

  const lcdButtons = buttonControls.filter(c => c.feedbackType === 'lcd')
  const ICON_SIZE = lcdButtons.length > 0 ? lcdButtons[0].pixelSize.width : null
  console.log(`[StreamDeck] Icon size: ${ICON_SIZE}px  (${lcdButtons.length} LCD buttons, ${buttonControls.length} total)`)

  function circleBuffer(r, g, b) {
    const buf = Buffer.alloc(ICON_SIZE * ICON_SIZE * 3, 0)
    const cx = ICON_SIZE / 2, cy = ICON_SIZE / 2, radius = ICON_SIZE * 0.38
    for (let y = 0; y < ICON_SIZE; y++) {
      for (let x = 0; x < ICON_SIZE; x++) {
        const i = (y * ICON_SIZE + x) * 3
        const inside = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) <= radius
        buf[i] = inside ? r : 18; buf[i+1] = inside ? g : 18; buf[i+2] = inside ? b : 18
      }
    }
    return buf
  }

  await newDeck.clearPanel()
  await newDeck.setBrightness(100)
  console.log('[StreamDeck] Device ready')

  newDeck.on('down', async (control) => {
    if (isSleeping) {
      isSleeping = false
      await newDeck.setBrightness(100)
      sendToRenderer('deck:wake', {})
      console.log('[StreamDeck] Wake')
      return
    }
    if (ICON_SIZE) await newDeck.fillKeyBuffer(control.index, circleBuffer(0, 130, 255), { format: 'rgb' })
    else           await newDeck.fillKeyColor(control.index, 0, 130, 255)
    console.log(`[StreamDeck] KEY DOWN  index=${control.index}  row=${control.row}  col=${control.column}`)
    sendToRenderer('deck:down', { index: control.index, row: control.row, column: control.column })
  })

  newDeck.on('up', async (control) => {
    if (isSleeping) return
    console.log(`[StreamDeck] KEY UP    index=${control.index}  row=${control.row}  col=${control.column}`)
    sendToRenderer('deck:up', { index: control.index, row: control.row, column: control.column })
  })

  newDeck.on('error', async (err) => {
    if (deck !== newDeck) return  // stale handler from a previous connection
    console.error('[StreamDeck] Device error — treating as disconnect:', err.message ?? err)
    deck       = null
    isSleeping = false
    try { await newDeck.close() } catch {}
    sendToRenderer('deck:disconnect', {})
    scheduleReconnect()
  })

  const sendInfo = () => sendToRenderer('deck:info', {
    model:        deviceInfo.model,
    productName:  newDeck.PRODUCT_NAME,
    serialNumber: deviceInfo.serialNumber,
    rows,
    cols,
    iconSize: ICON_SIZE ?? 72,
  })

  if (mainWindow?.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', sendInfo)
  } else {
    sendInfo()
  }
}

// ── Reconnect polling — starts whenever the device goes away ─────────────────
function scheduleReconnect() {
  if (reconnectTimer) return
  console.log('[StreamDeck] Reconnect polling started (every 2 s)…')
  reconnectTimer = setInterval(async () => {
    if (deck) { clearInterval(reconnectTimer); reconnectTimer = null; return }
    const { listStreamDecks } = require('@elgato-stream-deck/node')
    let devices
    try { devices = await listStreamDecks() } catch { return }
    if (!devices.length) return
    clearInterval(reconnectTimer)
    reconnectTimer = null
    console.log('[StreamDeck] Device found — reconnecting…')
    await connectDeck()
  }, 2000)
}

async function initStreamDeck() {
  registerIpcHandlers()
  await connectDeck()
  if (!deck) scheduleReconnect()

  app.on('before-quit', () => {
    if (reconnectTimer) { clearInterval(reconnectTimer); reconnectTimer = null }
    if (deck) { deck.clearPanel().catch(() => {}); deck.close().catch(() => {}) }
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
  createTray()
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

// Tray keeps the process alive when the window is hidden
app.on('window-all-closed', () => {})

// Allow OS-level quit (shutdown, pkill) to bypass the hide intercept
app.on('before-quit', () => { isQuitting = true })

// Single-instance: second launch focuses the existing window instead
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => { mainWindow?.show(); mainWindow?.focus() })
}
