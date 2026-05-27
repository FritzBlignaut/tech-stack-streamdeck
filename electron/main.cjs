'use strict'

const { app, BrowserWindow, ipcMain, dialog, protocol, net, Tray, Menu, nativeImage } = require('electron')
const path   = require('path')
const fs     = require('fs')
const os     = require('os')
const { spawn, fork } = require('child_process')
const {
  PLAYERCTL_COMMANDS,
  isValidHotkey,
  isValidUrl,
  isValidPactlArgs,
  isValidSinkName,
  isValidPlayerctlCommand,
  isValidPlayerName,
  sanitizeProfileName,
} = require('./validation.cjs')
const { parseSystemStats } = require('./stats.cjs')

// Register custom protocol schemes before app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'plugin', privileges: { standard: true, secure: true, corsEnabled: true, supportFetchAPI: true } },
  { scheme: 'sdpi',   privileges: { standard: true, secure: true, corsEnabled: true, supportFetchAPI: true } },
])

let mainWindow
let libraryDir = null
let activeProfileName = 'Default Profile'
let tray           = null
let isQuitting     = false
let deck            = null   // current Stream Deck connection
let isSleeping      = false  // hardware sleep state
let reconnectTimer  = null   // USB reconnect polling timer
let deviceInfoCache = null   // last known device info — for renderer reload recovery
let _stressInterval = null   // set when SLEEP_STRESS=1; cleared on disconnect/quit

// Per-button latest-wins HID write queue.
// Only the most recent rgbaData per button index is retained — if a button is
// written many times in quick succession (e.g. 15-button wake redraw + clock
// tick), only ONE HID write is issued per drain cycle. This caps the queue at
// 15 entries (one per button) regardless of how many sleep/wake cycles occur
// while the window is in the tray, preventing the progressive backlog that
// caused performance degradation after tray restore.
const _hidQueue = new Map()   // index -> rgbaData | null  (null = fill black)
let _hidDraining = false

function enqueueHIDWrite(index, rgbaData) {
  const before = _hidQueue.size
  _hidQueue.set(index, rgbaData)
  if (before === 0 && _hidQueue.size === 1) {
    console.log(`[HID] Queue started — 1 button pending`)
  } else if (_hidQueue.size !== before) {
    console.log(`[HID] Enqueue button ${index} — queue depth: ${_hidQueue.size}`)
  }
  if (!_hidDraining) drainHIDQueue()
}

async function drainHIDQueue() {
  if (_hidDraining) return
  _hidDraining = true
  const t0 = Date.now()
  let count = 0
  while (_hidQueue.size > 0) {
    const [index, rgbaData] = _hidQueue.entries().next().value
    _hidQueue.delete(index)
    // Skip writes after sleep is triggered — clearPanel() will blank the device;
    // any fill that races against it would either be overwritten or cause a
    // partial-update artefact on the hardware.
    if (!deck || isSleeping) continue
    try {
      // Wrap in a timeout — libusb can hang indefinitely on Linux if the
      // device stops ACKing; without it _hidDraining stays true forever.
      const write = rgbaData
        ? deck.fillKeyBuffer(index, Buffer.from(rgbaData), { format: 'rgba' })
        : deck.fillKeyColor(index, 0, 0, 0)
      await Promise.race([
        write,
        new Promise((_, rej) => setTimeout(() => rej(new Error('HID write timeout')), 2000)),
      ])
      count++
    } catch (err) {
      console.error(`[HID] Write error (button ${index}):`, err.message)
    }
  }
  if (count > 0) console.log(`[HID] Drain complete — ${count} write(s) in ${Date.now() - t0}ms`)
  _hidDraining = false
}

// ── Plugin system state ───────────────────────────────────────────────────────
const pluginProcesses = new Map()  // pluginUUID -> ChildProcess
let pluginManifests   = []         // [{ manifest, pluginDir }]

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

// Central quit — destroys GUI elements immediately then calls app.exit(0).
// app.exit bypasses the window-all-closed no-op handler that otherwise keeps
// the process alive as a background tray app, guaranteeing the process exits.
function doQuit() {
  if (isQuitting) return
  isQuitting = true
  if (reconnectTimer)  { clearInterval(reconnectTimer);  reconnectTimer  = null }
  if (_stressInterval) { clearInterval(_stressInterval); _stressInterval = null }
  for (const child of pluginProcesses.values()) { try { child.kill() } catch {} }
  pluginProcesses.clear()
  if (tray) { tray.destroy(); tray = null }           // remove icon immediately
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy()
  const deckRef = deck
  deck = null
  const exit = () => app.exit(0)
  if (deckRef) {
    // removeAllListeners first: after clearPanel/setBrightness the hardware queues
    // HID input reports; when close() drains that queue the C++ read thread tries
    // to invoke JS callbacks — if any are still registered it can throw Napi::Error.
    deckRef.removeAllListeners()
    // After close() the USB read thread has stopped, but node-hid's HIDAsync
    // ObjectWrap may still have pending napi_async_work completions or
    // napi_threadsafe_function callbacks queued in libuv. Draining 3 event-loop
    // iterations lets those fire harmlessly (no listeners) and allows the wrapper
    // to finish cleanup before app.exit(0) tears down the V8 environment,
    // preventing "terminate called after throwing an instance of Napi::Error".
    deckRef.close().then(
      () => setImmediate(() => setImmediate(() => setImmediate(exit))),
      () => setImmediate(() => setImmediate(() => setImmediate(exit)))
    )
  } else { exit() }
}

function createTray() {
  const icon = nativeImage.createFromBuffer(createTrayIconPng())
  tray = new Tray(icon)
  tray.setToolTip('Tech Stack Stream Deck')
  const menu = Menu.buildFromTemplate([
    { label: 'Show Window', click: () => { mainWindow?.show(); mainWindow?.focus() } },
    { type: 'separator' },
    { label: 'Quit', click: doQuit },
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
  const iconPath = app.isPackaged
    ? path.join(__dirname, '../dist/tech_stack_streamdeck.png')
    : path.join(__dirname, '../public/tech_stack_streamdeck.png')

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: 'Tech Stack Studios - Streamdeck',
    maximizable: false,
    icon: iconPath,
    autoHideMenuBar: true,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  // Production: load the packaged renderer; dev: load from the Vite dev server
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  } else {
    const port = process.env.VITE_PORT || '5173'
    mainWindow.loadURL(`http://localhost:${port}`)
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Prevent the HTML page title from overriding the window title
  mainWindow.on('page-title-updated', e => { e.preventDefault() })

  // Hide to tray on close unless a real quit was requested
  mainWindow.on('close', e => {
    if (!isQuitting) { e.preventDefault(); mainWindow.hide(); console.log('[App] Window hidden to tray') }
  })

  mainWindow.on('show', () => {
    console.log(`[App] Window shown from tray — HID queue depth: ${_hidQueue.size}, draining: ${_hidDraining}`)
  })

  // If the renderer process crashes, reload it automatically
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[App] Renderer process gone:', details.reason, details.exitCode)
    if (details.reason !== 'clean-exit') {
      console.log('[App] Reloading renderer…')
      mainWindow.webContents.reload()
    }
  })

  // Forward renderer console output to main-process stdout so [Renderer] logs
  // appear in the terminal during `npm run test:stress` (levels: 0=verbose,1=info,2=warn,3=error)
  mainWindow.webContents.on('console-message', (_, level, message) => {
    const tag = level === 2 ? '[Renderer:warn]' : level >= 3 ? '[Renderer:err]' : '[Renderer]'
    console.log(`${tag} ${message}`)
  })

  // After any load/reload, re-send device info if the deck is already connected
  mainWindow.webContents.on('did-finish-load', () => {
    if (deck && deviceInfoCache) sendToRenderer('deck:info', deviceInfoCache)
  })
}

// ── Plugin system ─────────────────────────────────────────────────────────────
function getPluginsDir() {
  return path.join(app.getPath('userData'), 'plugins')
}

function startPluginProcess(manifest, pluginDir) {
  const codePath = path.join(pluginDir, manifest.CodePath ?? 'bin/plugin.cjs')
  if (!fs.existsSync(codePath)) {
    console.warn(`[Plugin] ${manifest.UUID}: CodePath not found: ${codePath}`)
    return null
  }
  let child
  try {
    child = fork(codePath, [], {
      silent: true,
      env: { ...process.env, PLUGIN_UUID: manifest.UUID, PLUGIN_DIR: pluginDir },
    })
  } catch (err) {
    console.error(`[Plugin] ${manifest.UUID}: fork failed:`, err.message)
    return null
  }
  child.stdout?.on('data', d => console.log(`[Plugin ${manifest.UUID}]`, d.toString().trimEnd()))
  child.stderr?.on('data', d => console.error(`[Plugin ${manifest.UUID}]`, d.toString().trimEnd()))
  child.on('message', msg => {
    if (!msg?.event) return
    sendToRenderer('plugin:message', msg)
  })
  child.on('exit', code => {
    console.log(`[Plugin] ${manifest.UUID} exited (code ${code})`)
    pluginProcesses.delete(manifest.UUID)
  })
  child.on('error', err => console.error(`[Plugin] ${manifest.UUID} error:`, err.message))
  pluginProcesses.set(manifest.UUID, child)
  console.log(`[Plugin] ${manifest.UUID} started (pid ${child.pid})`)
  return child
}

function stopPlugin(uuid) {
  const child = pluginProcesses.get(uuid)
  if (child) {
    try { child.kill() } catch {}
    pluginProcesses.delete(uuid)
  }
}

async function loadPlugins() {
  const dir = getPluginsDir()
  await fs.promises.mkdir(dir, { recursive: true }).catch(() => {})
  let entries
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) }
  catch { pluginManifests = []; return }
  pluginManifests = []
  for (const entry of entries.filter(e => e.isDirectory() && e.name.endsWith('.sdPlugin'))) {
    const pluginDir = path.join(dir, entry.name)
    let manifest
    try {
      manifest = JSON.parse(await fs.promises.readFile(path.join(pluginDir, 'manifest.json'), 'utf8'))
    } catch (err) {
      console.warn(`[Plugin] Skipping ${entry.name}:`, err.message)
      continue
    }
    if (!manifest.UUID || !Array.isArray(manifest.Actions)) {
      console.warn(`[Plugin] Skipping ${entry.name}: invalid manifest`)
      continue
    }
    pluginManifests.push({ manifest, pluginDir })
    startPluginProcess(manifest, pluginDir)
  }
  console.log(`[Plugin] Loaded ${pluginManifests.length} plugin(s)`)
}

// ── Module-level state for CPU polling (plugin: system monitor) ──────────────
let lastCpuTimes = null



// ── Sleep toggle — shared by the IPC handler and the stress-test interval ──────
async function toggleSleep() {
  if (!deck) return
  if (isSleeping) {
    isSleeping = false
    console.log('[StreamDeck] Wake (action) — restoring brightness…')
    const t0 = Date.now()
    try { await deck.setBrightness(100) } catch (err) { console.error('[StreamDeck] Failed to restore brightness on wake:', err.message) }
    console.log(`[StreamDeck] Brightness restored in ${Date.now() - t0}ms — notifying renderer`)
    sendToRenderer('deck:wake', {})
  } else {
    isSleeping = true
    _hidQueue.clear()   // discard any pending redraws — no new writes while sleeping
    // Do NOT clearPanel() here: that queues 15 HID writes which can hang in the
    // libusb thread and block every subsequent fillKeyBuffer on wake.  Just dim
    // the display; the last-drawn button images stay on the hardware but are
    // invisible at brightness 0.  On wake setBrightness(100) makes them
    // instantly visible again, then the wake-redraw refreshes any stale content.
    try {
      await Promise.race([
        deck.setBrightness(0),
        new Promise((_, rej) => setTimeout(() => rej(new Error('setBrightness(0) timeout')), 2000)),
      ])
    } catch (err) {
      console.error('[StreamDeck] setBrightness(0) error on sleep:', err.message)
    }
    sendToRenderer('deck:sleep', {})   // always notify renderer even if HID op failed
    console.log('[StreamDeck] Sleep (action)')
  }
}

// ── IPC handlers — registered once; use module-level deck/state ─────────────
function registerIpcHandlers() {
  // Hotkey via xdotool (Linux)
  ipcMain.handle('action:hotkey', async (_, { keys }) => {
    if (!isValidHotkey(keys)) return { error: 'Invalid hotkey string' }
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
    if (!isValidUrl(url)) return { error: 'Only http/https/ftp URLs are allowed' }
    const safe = url.trim()
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

  ipcMain.handle('action:sleep-toggle', () => toggleSleep())

  ipcMain.handle('dialog:open-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Select Application', properties: ['openFile'] })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('apps:list', async () => {
    const dirs = [
      '/usr/share/applications',
      '/var/lib/flatpak/exports/share/applications',
      path.join(os.homedir(), '.local/share/applications'),
      path.join(os.homedir(), '.local/share/flatpak/exports/share/applications'),
    ]
    const apps = []
    const seen = new Set()
    for (const dir of dirs) {
      let files
      try { files = await fs.promises.readdir(dir) } catch { continue }
      for (const file of files) {
        if (!file.endsWith('.desktop')) continue
        const appId = file.replace(/\.desktop$/, '')
        if (seen.has(appId)) continue
        seen.add(appId)
        try {
          const content = await fs.promises.readFile(path.join(dir, file), 'utf8')
          const data = {}
          let inEntry = false
          for (const line of content.split('\n')) {
            const t = line.trim()
            if (t === '[Desktop Entry]') { inEntry = true; continue }
            if (t.startsWith('[') && t !== '[Desktop Entry]') { inEntry = false; continue }
            if (!inEntry) continue
            const eq = t.indexOf('=')
            if (eq === -1) continue
            const key = t.slice(0, eq).trim()
            if (key.includes('[')) continue // skip localized keys
            if (!data[key]) data[key] = t.slice(eq + 1).trim()
          }
          if (data.Type !== 'Application') continue
          if (data.NoDisplay === 'true' || data.Hidden === 'true') continue
          if (!data.Name) continue
          apps.push({ name: data.Name, appId })
        } catch { continue }
      }
    }
    return apps.sort((a, b) => a.name.localeCompare(b.name))
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

  ipcMain.handle('app:get-version', () => app.getVersion())

  // ── Plugin system ────────────────────────────────────────────────────────────
  ipcMain.handle('plugins:list', () =>
    pluginManifests.map(({ manifest, pluginDir }) => ({
      ...manifest,
      pluginDir,
      running: pluginProcesses.has(manifest.UUID),
    }))
  )

  ipcMain.handle('plugins:install', async (_, { sourcePath }) => {
    if (!sourcePath) return { ok: false, error: 'No source path' }
    const resolved = path.resolve(sourcePath)
    if (!resolved.endsWith('.sdPlugin')) return { ok: false, error: 'Folder must end with .sdPlugin' }
    let manifest
    try {
      manifest = JSON.parse(await fs.promises.readFile(path.join(resolved, 'manifest.json'), 'utf8'))
    } catch {
      return { ok: false, error: 'Cannot read manifest.json in that folder' }
    }
    if (!manifest.UUID || !Array.isArray(manifest.Actions)) {
      return { ok: false, error: 'Invalid manifest: missing UUID or Actions array' }
    }
    const destDir = path.join(getPluginsDir(), `${manifest.UUID}.sdPlugin`)
    try {
      await fs.promises.mkdir(getPluginsDir(), { recursive: true })
      await fs.promises.cp(resolved, destDir, { recursive: true })
    } catch (err) {
      return { ok: false, error: err.message }
    }
    pluginManifests.push({ manifest, pluginDir: destDir })
    startPluginProcess(manifest, destDir)
    return { ok: true, uuid: manifest.UUID }
  })

  ipcMain.handle('plugins:uninstall', async (_, { uuid }) => {
    if (!uuid) return { ok: false, error: 'No UUID provided' }
    stopPlugin(uuid)
    pluginManifests = pluginManifests.filter(p => p.manifest.UUID !== uuid)
    try {
      await fs.promises.rm(path.join(getPluginsDir(), `${uuid}.sdPlugin`), { recursive: true, force: true })
    } catch (err) {
      return { ok: false, error: err.message }
    }
    return { ok: true }
  })

  ipcMain.handle('plugin:send', (_, { pluginUUID, actionUUID, event, settings, context }) => {
    const child = pluginProcesses.get(pluginUUID)
    if (!child) return { ok: false, error: 'Plugin not running' }
    child.send({ event: event ?? 'keyDown', actionUUID, settings, context })
    return { ok: true }
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
    const safe = sanitizeProfileName(name)
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

  ipcMain.handle('button:setIcon', (_, { index, rgbaData }) => {
    enqueueHIDWrite(index, rgbaData)
    // Renderer never awaits this result — fire-and-forget from renderer side
  })

  // ── Plugin 2: CPU / RAM stats ──────────────────────────────────────────────
  ipcMain.handle('system:stats', async () => {
    try {
      const [statFile, memFile] = await Promise.all([
        fs.promises.readFile('/proc/stat',    'utf8'),
        fs.promises.readFile('/proc/meminfo', 'utf8'),
      ])

      const result = parseSystemStats(statFile, memFile, lastCpuTimes)
      lastCpuTimes = result.newCpuTimes
      return { cpuPercent: result.cpuPercent, ramPercent: result.ramPercent, ramUsedMB: result.ramUsedMB, ramTotalMB: result.ramTotalMB }
    } catch (err) {
      return { error: err.message }
    }
  })

  // ── Plugin 3: Volume via pactl ─────────────────────────────────────────────
  ipcMain.handle('action:pactl', async (_, { args }) => {
    if (!isValidPactlArgs(args)) return { error: 'Invalid pactl arguments' }
    const safe = args.map(String)
    return new Promise(resolve => {
      const proc = spawn('pactl', safe, { stdio: 'ignore' })
      const kill  = setTimeout(() => { try { proc.kill() } catch {} resolve({ error: 'timeout' }) }, 1500)
      proc.on('close', code  => { clearTimeout(kill); resolve({ code }) })
      proc.on('error', err   => { clearTimeout(kill); resolve({ error: err.message }) })
    })
  })

  ipcMain.handle('pactl:get-volume', async (_, { sink = '@DEFAULT_SINK@' } = {}) => {
    if (!isValidSinkName(sink)) return { error: 'Invalid sink name' }
    return new Promise(resolve => {
      const proc = spawn('pactl', ['get-sink-volume', sink], { stdio: ['ignore', 'pipe', 'ignore'] })
      let out = ''
      const kill = setTimeout(() => { try { proc.kill() } catch {} resolve({ percent: 0, muted: false }) }, 3000)
      proc.stdout.on('data', d => { out += d })
      proc.on('close', () => {
        clearTimeout(kill)
        const m = out.match(/(\d+)%/)
        resolve(m ? { percent: parseInt(m[1]), muted: false } : { percent: 0, muted: false })
      })
      proc.on('error', err => { clearTimeout(kill); resolve({ error: err.message }) })
    })
  })

  ipcMain.handle('pactl:get-mute', async (_, { sink = '@DEFAULT_SINK@' } = {}) => {
    if (!isValidSinkName(sink)) return { error: 'Invalid sink name' }
    return new Promise(resolve => {
      const proc = spawn('pactl', ['get-sink-mute', sink], { stdio: ['ignore', 'pipe', 'ignore'] })
      let out = ''
      const kill = setTimeout(() => { try { proc.kill() } catch {} resolve({ muted: false }) }, 3000)
      proc.stdout.on('data', d => { out += d })
      proc.on('close', () => {
        clearTimeout(kill)
        resolve({ muted: /yes/i.test(out) })
      })
      proc.on('error', err => { clearTimeout(kill); resolve({ error: err.message }) })
    })
  })

  // ── Plugin 4: Media control via playerctl ──────────────────────────────────
  ipcMain.handle('action:playerctl', async (_, { command, player = '%any' }) => {
    if (!isValidPlayerctlCommand(command))  return { error: 'Invalid command' }
    if (!isValidPlayerName(player))         return { error: 'Invalid player name' }
    return new Promise(resolve => {
      const proc = spawn('playerctl', [`--player=${player}`, command], { stdio: 'ignore' })
      proc.on('close', code => resolve({ code }))
      proc.on('error', err  => resolve({ error: err.message }))
    })
  })

  ipcMain.handle('playerctl:status', async (_, { player = '%any' } = {}) => {
    if (!isValidPlayerName(player)) return null
    const run = (args) => new Promise(res => {
      let out = ''
      const p = spawn('playerctl', [`--player=${player}`, ...args], { stdio: ['ignore', 'pipe', 'ignore'] })
      p.stdout.on('data', d => { out += d })
      p.on('close', ()  => res(out.trim()))
      p.on('error', ()  => res(null))
      setTimeout(() => { try { p.kill() } catch {} res(null) }, 500)
    })
    const [status, title, artist] = await Promise.all([
      run(['status']),
      run(['metadata', 'title']),
      run(['metadata', 'artist']),
    ])
    if (!status || status === 'No players found') return null
    return { status, title: title || '', artist: artist || '' }
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
  _hidQueue.clear()   // reset queue — discard any stale writes from prior connection
  _hidDraining = false
  clearInterval(_stressInterval); _stressInterval = null  // reset on reconnect

  const buttonControls = newDeck.CONTROLS.filter(c => c.type === 'button')
  const rows = Math.max(...buttonControls.map(c => c.row)) + 1
  const cols = Math.max(...buttonControls.map(c => c.column)) + 1

  const lcdButtons = buttonControls.filter(c => c.feedbackType === 'lcd')
  const ICON_SIZE = lcdButtons.length > 0 ? lcdButtons[0].pixelSize.width : null
  console.log(`[StreamDeck] Icon size: ${ICON_SIZE}px  (${lcdButtons.length} LCD buttons, ${buttonControls.length} total)`)

  await newDeck.clearPanel()
  await newDeck.setBrightness(100)
  console.log('[StreamDeck] Device ready')

  if (process.env.SLEEP_STRESS === '1') {
    let _busy = false
    _stressInterval = setInterval(async () => {
      if (_busy) return
      _busy = true
      try { await toggleSleep() } finally { _busy = false }
    }, 5000)
    console.log('[Stress] Auto sleep/wake every 5s (SLEEP_STRESS=1) — stop with Ctrl+C')
  }

  newDeck.on('down', async (control) => {
    if (isSleeping) {
      isSleeping = false
      console.log('[StreamDeck] Wake (hardware) — restoring brightness…')
      const t0 = Date.now()
      try { await newDeck.setBrightness(100) } catch (err) { console.error('[StreamDeck] Failed to restore brightness on wake:', err.message) }
      console.log(`[StreamDeck] Brightness restored in ${Date.now() - t0}ms — notifying renderer`)
      sendToRenderer('deck:wake', {})
      return
    }
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
    clearInterval(_stressInterval); _stressInterval = null
    console.error('[StreamDeck] Device error — treating as disconnect:', err.message ?? err)
    deck            = null
    isSleeping      = false
    deviceInfoCache = null
    try { await newDeck.close() } catch {}
    sendToRenderer('deck:disconnect', {})
    scheduleReconnect()
  })

  const sendInfo = () => {
    deviceInfoCache = {
      model:        deviceInfo.model,
      productName:  newDeck.PRODUCT_NAME,
      serialNumber: deviceInfo.serialNumber,
      rows,
      cols,
      iconSize: ICON_SIZE ?? 72,
    }
    sendToRenderer('deck:info', deviceInfoCache)
  }

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
  await loadPlugins()
  await connectDeck()
  if (!deck) scheduleReconnect()

  app.on('before-quit', () => {
    if (reconnectTimer) { clearInterval(reconnectTimer); reconnectTimer = null }
    if (deck) { deck.clearPanel().catch(() => {}); deck.close().catch(() => {}) }
  })
}

app.whenReady().then(async () => {
  // Serve plugin HTML/JS assets via plugin://{UUID}/path (e.g. plugin://com.example.obs/ui/inspector.html)
  protocol.handle('plugin', (request) => {
    const url        = new URL(request.url)
    const pluginUUID = url.hostname
    const filePath   = decodeURIComponent(url.pathname.slice(1))
    const pluginsDir = getPluginsDir()
    const pluginDir  = path.join(pluginsDir, `${pluginUUID}.sdPlugin`)
    const resolved   = path.resolve(path.join(pluginDir, filePath))
    // Security: only serve files inside the plugin's own directory
    if (!resolved.startsWith(pluginDir + path.sep) && resolved !== pluginDir) {
      return new Response('Forbidden', { status: 403 })
    }
    return net.fetch('file://' + resolved)
  })

  // Serve sdpi-bridge.js from the host app: <script src="sdpi://host/bridge.js"></script>
  protocol.handle('sdpi', (request) => {
    const url = new URL(request.url)
    if (url.pathname === '/bridge.js') {
      const bridgePath = app.isPackaged
        ? path.join(process.resourcesPath, 'bridge', 'sdpi-bridge.js')
        : path.join(__dirname, '..', 'public', 'bridge', 'sdpi-bridge.js')
      return net.fetch('file://' + bridgePath)
    }
    return new Response('Not Found', { status: 404 })
  })

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

  ipcMain.handle('plugins:browse-dir', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select .sdPlugin folder',
      properties: ['openDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

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

// Ensure the tray icon disappears for any quit path that goes through app.quit()
app.on('before-quit', () => {
  isQuitting = true
  if (tray) { tray.destroy(); tray = null }
})

// OS signals (pkill, systemd stop) → use doQuit() for immediate, guaranteed exit
process.on('SIGTERM', doQuit)
process.on('SIGINT',  doQuit)

// Single-instance: second launch focuses the existing window instead
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => { mainWindow?.show(); mainWindow?.focus() })
}
