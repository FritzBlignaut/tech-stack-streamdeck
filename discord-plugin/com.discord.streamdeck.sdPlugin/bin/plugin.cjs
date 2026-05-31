/**
 * com.discord.streamdeck — plugin.cjs
 *
 * Runs as a child process forked by the host app.
 * Controls Discord via xdotool keyboard shortcuts.
 *
 * Each button stores a `hotkey` in its settings (e.g. "ctrl+shift+m").
 * On keyDown the plugin fires `xdotool key <hotkey>`.
 * Push-to-Talk and Push-to-Mute use `xdotool keydown` / `xdotool keyup`
 * so the key is held for the duration of the button press.
 *
 * Requirements: xdotool must be installed (sudo apt install xdotool).
 */

'use strict'

const { spawnSync, execFileSync } = require('child_process')

const pluginUUID = process.env.PLUGIN_UUID || 'com.discord.streamdeck'

// Actions that use hold-and-release rather than a single tap
const HOLD_ACTIONS = new Set([
  'com.discord.streamdeck.ptt',
  'com.discord.streamdeck.ptm',
])

// Verify xdotool is available at startup
let xdotoolAvailable = false
try {
  execFileSync('which', ['xdotool'], { stdio: 'ignore' })
  xdotoolAvailable = true
  console.log(`[${pluginUUID}] xdotool found — ready`)
} catch {
  console.warn(`[${pluginUUID}] WARNING: xdotool not found. Install it with: sudo apt install xdotool`)
}

// Stress test state — toggled via DISCORD_MUTE_STRESS=1 env var or 'stress-test' IPC event
let _stressHotkey   = null
let _stressInterval = null
let _stressCount    = 0

function startStressTest(hotkey) {
  if (_stressInterval) return  // already running
  _stressHotkey = hotkey
  _stressCount  = 0
  let _busy = false
  _stressInterval = setInterval(() => {
    if (_busy || !_stressHotkey) return
    _busy = true
    try {
      _stressCount++
      console.log(`[${pluginUUID}] [stress] tick #${_stressCount} — firing "${_stressHotkey}"`)
      xdotoolKey(_stressHotkey)
    } finally {
      _busy = false
    }
  }, 5000)
  console.log(`[${pluginUUID}] [stress] started — will fire "${hotkey}" every 5s`)
}

function stopStressTest() {
  if (!_stressInterval) return
  clearInterval(_stressInterval)
  _stressInterval = null
  console.log(`[${pluginUUID}] [stress] stopped after ${_stressCount} ticks`)
  _stressCount = 0
}

/**
 * Find a Discord X11 window ID.
 *
 * @param {boolean} onlyVisible - When true, restrict to viewable (on-screen) windows only.
 *   IMPORTANT: XSetInputFocus (used by `xdotool windowfocus`) returns BadMatch for
 *   non-viewable windows.  Discord (Electron) creates many internal windows —
 *   GPU process, renderer sub-windows, utility overlays — that share the class
 *   'discord' but are NOT viewable.  The oldest result from an unrestricted
 *   search is often one of these internal windows.  Pass onlyVisible=true
 *   whenever the window ID will be used for focus/key injection.
 *
 *   Pass onlyVisible=false only when you need the window ID for
 *   getwindowstate or windowactivate (de-iconify), where a hidden window ID
 *   is acceptable and the visible window may not exist yet.
 */
function getDiscordWindowId(onlyVisible = false) {
  const flag = onlyVisible ? ['--onlyvisible'] : []
  // Primary: name search — Discord's main window title is "Discord" or "Discord - #channel"
  const byName = spawnSync('xdotool', ['search', ...flag, '--name', 'Discord'], { stdio: 'pipe', timeout: 2000 })
  if (byName.status === 0) {
    const ids = byName.stdout.toString().trim().split('\n').filter(Boolean)
    if (ids.length > 0) return ids[0]
  }
  // Fallback: class search
  const byClass = spawnSync('xdotool', ['search', ...flag, '--class', 'discord'], { stdio: 'pipe', timeout: 2000 })
  if (byClass.status === 0) {
    const ids = byClass.stdout.toString().trim().split('\n').filter(Boolean)
    if (ids.length > 0) return ids[0]
  }
  return null
}

/**
 * Focus Discord's window and fire `cmdArgs` atomically in ONE xdotool process.
 *
 * Focus strategy (two-step, single atomic process):
 *
 *   Step A — de-iconify (only if minimized):
 *     windowactivate --sync uses _NET_ACTIVE_WINDOW (WM-level) to restore a
 *     minimized window.  This is the only mechanism that works for hidden
 *     windows.  After this, the window is on-screen and viewable.
 *
 *   Step B — atomic focus + key in ONE process:
 *     windowfocus --sync <visibleWinId> <cmd>
 *     Both sub-commands share ONE X connection.  windowfocus --sync calls
 *     XSetInputFocus and waits for the FocusIn event; <cmd> fires the instant
 *     that confirmation arrives.  The WM cannot revert focus between these two
 *     operations because they execute on the same X connection event cycle.
 *
 * WHY --onlyvisible IS REQUIRED for the focus step:
 *   Discord (Electron) creates many X11 windows — GPU process, renderer
 *   sub-processes, overlays — that are NOT viewable (not mapped on screen).
 *   XSetInputFocus returns BadMatch for non-viewable windows, crashing the
 *   entire xdotool invocation.  --onlyvisible filters to only mapped,
 *   on-screen windows, so XSetInputFocus always succeeds.
 *
 * WHY windowfocus --sync does NOT hang here:
 *   --sync hangs only on iconified windows (hidden windows never receive
 *   FocusIn).  Step A already de-iconifies if needed.  For a visible but
 *   unfocused background window, FocusIn arrives in microseconds.
 *
 * @param {string[]} cmdArgs  xdotool sub-command args, e.g.
 *                            ['key', '--clearmodifiers', 'ctrl+shift+m']
 */
function withDiscordFocus(cmdArgs) {
  // Find any Discord window (including hidden internal ones) for state check + de-iconify
  const anyWinId = getDiscordWindowId(false)
  if (!anyWinId) {
    console.warn(`[${pluginUUID}] Discord window not found — sending key to focused window instead`)
    return spawnSync('xdotool', cmdArgs, { stdio: 'pipe', timeout: 2000 })
  }

  // Detect iconified (minimized) state
  const stateResult  = spawnSync('xdotool', ['getwindowstate', '--shell', anyWinId], { stdio: 'pipe', timeout: 2000 })
  const wasMinimized = stateResult.status === 0 && stateResult.stdout.toString().includes('HIDDEN=1')

  const prevResult = spawnSync('xdotool', ['getactivewindow'], { stdio: 'pipe', timeout: 2000 })
  const prevWinId  = prevResult.status === 0 ? prevResult.stdout.toString().trim() : null

  // Step A: de-iconify minimized window so it becomes viewable for XSetInputFocus
  if (wasMinimized) {
    spawnSync('xdotool', ['windowactivate', '--sync', anyWinId], { stdio: 'pipe', timeout: 2000 })
  }

  // Step B: find the VIEWABLE window for focus injection.
  // --onlyvisible skips non-viewable internal Electron/Discord windows that
  // cause XSetInputFocus to return BadMatch.
  const focusWinId = getDiscordWindowId(true) ?? anyWinId

  // ATOMIC: focus + command on ONE X connection — WM cannot revert between them
  const r = spawnSync('xdotool', ['windowfocus', '--sync', focusWinId, ...cmdArgs], { stdio: 'pipe', timeout: 3000 })

  // Re-minimize if Discord was iconified so it doesn't appear on screen
  if (wasMinimized) {
    spawnSync('xdotool', ['windowminimize', focusWinId], { stdio: 'pipe', timeout: 2000 })
  }

  // Restore keyboard focus to whatever had it before
  if (prevWinId && prevWinId !== focusWinId) {
    spawnSync('xdotool', ['windowfocus', prevWinId], { stdio: 'pipe', timeout: 2000 })
  }

  return r
}

function xdotoolKey(hotkey) {
  if (!xdotoolAvailable) return
  console.log(`[${pluginUUID}] xdotool key --clearmodifiers ${hotkey} (via Discord focus)`)
  const r = withDiscordFocus(['key', '--clearmodifiers', hotkey])
  if (r.status !== 0) console.warn(`[${pluginUUID}] xdotool key failed:`, r.stderr?.toString().trim())
}

function xdotoolKeyDown(hotkey) {
  if (!xdotoolAvailable) return
  console.log(`[${pluginUUID}] xdotool keydown --clearmodifiers ${hotkey} (via Discord focus)`)
  const r = withDiscordFocus(['keydown', '--clearmodifiers', hotkey])
  if (r.status !== 0) console.warn(`[${pluginUUID}] xdotool keydown failed:`, r.stderr?.toString().trim())
}

function xdotoolKeyUp(hotkey) {
  if (!xdotoolAvailable) return
  console.log(`[${pluginUUID}] xdotool keyup --clearmodifiers ${hotkey} (via Discord focus)`)
  const r = withDiscordFocus(['keyup', '--clearmodifiers', hotkey])
  if (r.status !== 0) console.warn(`[${pluginUUID}] xdotool keyup failed:`, r.stderr?.toString().trim())
}

process.on('message', (msg) => {
  if (!msg?.event) return

  const hotkey     = msg.settings?.hotkey
  const actionUUID = msg.actionUUID || ''

  if (msg.event === 'keyDown') {
    if (!hotkey) {
      console.warn(`[${pluginUUID}] keyDown on ${actionUUID} — no hotkey configured`)
      return
    }
    console.log(`[${pluginUUID}] keyDown ${actionUUID} → ${HOLD_ACTIONS.has(actionUUID) ? 'keydown' : 'key'} "${hotkey}"`)
    if (HOLD_ACTIONS.has(actionUUID)) {
      xdotoolKeyDown(hotkey)
    } else {
      _stressHotkey = hotkey  // track latest non-hold hotkey for stress testing
      xdotoolKey(hotkey)
    }
  }

  if (msg.event === 'keyUp') {
    if (!hotkey) return
    if (HOLD_ACTIONS.has(actionUUID)) {
      console.log(`[${pluginUUID}] keyUp   ${actionUUID} → keyup "${hotkey}"`)
      xdotoolKeyUp(hotkey)
    }
  }

  // Stress test control — sent from the UI toggle button
  if (msg.event === 'stress-test') {
    if (msg.settings?.active) {
      const h = msg.settings?.hotkey || _stressHotkey
      if (!h) {
        console.warn(`[${pluginUUID}] [stress] cannot start — no hotkey known yet. Press the mute button once first.`)
        return
      }
      startStressTest(h)
    } else {
      stopStressTest()
    }
  }
})

// Auto-start stress test when DISCORD_MUTE_STRESS=1 is set — waits for the
// first real keyDown to learn the hotkey, then fires every 5 s automatically.
if (process.env.DISCORD_MUTE_STRESS === '1') {
  console.log(`[${pluginUUID}] [stress] DISCORD_MUTE_STRESS=1 — stress test will auto-start on first keyDown`)
  const _waitForHotkey = setInterval(() => {
    if (_stressHotkey) {
      clearInterval(_waitForHotkey)
      startStressTest(_stressHotkey)
    }
  }, 500)
}

// Keep the process alive
setInterval(() => {}, 60_000)
