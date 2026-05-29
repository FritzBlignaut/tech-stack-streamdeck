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

/**
 * Find Discord's X11 window ID.
 * Returns the window ID string, or null if Discord is not running / not found.
 *
 * Strategy: search by window NAME "Discord" first. Discord's main application
 * window has a title of "Discord" (or "Discord - #channel"), while the GPU
 * process, renderer sub-windows, and utility windows have empty or internal
 * titles that do NOT contain "Discord". Taking the first (oldest) result from
 * the name search reliably returns the main window across all button presses,
 * even after Discord briefly gains and loses focus (which can cause it to
 * create additional sub-windows, making a last-ID strategy unreliable).
 */
function getDiscordWindowId() {
  // Primary: name search — matches only the main Discord application window
  const byName = spawnSync('xdotool', ['search', '--name', 'Discord'], { stdio: 'pipe' })
  if (byName.status === 0) {
    const ids = byName.stdout.toString().trim().split('\n').filter(Boolean)
    if (ids.length > 0) return ids[0]
  }
  // Fallback: class search — take the first (oldest/main) window
  const byClass = spawnSync('xdotool', ['search', '--class', 'discord'], { stdio: 'pipe' })
  if (byClass.status === 0) {
    const ids = byClass.stdout.toString().trim().split('\n').filter(Boolean)
    if (ids.length > 0) return ids[0]
  }
  console.warn(`[${pluginUUID}] Could not find Discord window — sending key to focused window instead`)
  return null
}

/**
 * Focus `winId`, run `action()`, then restore focus to the previously active
 * window.  Uses XTestFakeKeyEvent (not XSendEvent) so Electron/Chromium treats
 * the event as a trusted hardware input (isTrusted=true in JavaScript).
 * xdotool key --window uses XSendEvent which Discord ignores.
 */
function withDiscordFocus(winId, action) {
  const prevResult = spawnSync('xdotool', ['getactivewindow'], { stdio: 'pipe' })
  const prevWinId  = prevResult.status === 0 ? prevResult.stdout.toString().trim() : null

  spawnSync('xdotool', ['windowfocus', '--sync', winId], { stdio: 'pipe' })
  action()
  if (prevWinId && prevWinId !== winId) {
    spawnSync('xdotool', ['windowfocus', '--sync', prevWinId], { stdio: 'pipe' })
  }
}

function xdotoolKey(hotkey) {
  if (!xdotoolAvailable) return
  const winId = getDiscordWindowId()
  const args  = ['key', '--clearmodifiers', hotkey]
  console.log(`[${pluginUUID}] xdotool${winId ? ' (via Discord focus)' : ''} ${args.join(' ')}`)
  if (winId) {
    withDiscordFocus(winId, () => {
      const r = spawnSync('xdotool', args, { stdio: 'pipe' })
      if (r.status !== 0) console.warn(`[${pluginUUID}] xdotool key failed:`, r.stderr?.toString().trim())
    })
  } else {
    const r = spawnSync('xdotool', args, { stdio: 'pipe' })
    if (r.status !== 0) console.warn(`[${pluginUUID}] xdotool key failed:`, r.stderr?.toString().trim())
  }
}

function xdotoolKeyDown(hotkey) {
  if (!xdotoolAvailable) return
  const winId = getDiscordWindowId()
  const args  = ['keydown', '--clearmodifiers', hotkey]
  console.log(`[${pluginUUID}] xdotool${winId ? ' (via Discord focus)' : ''} ${args.join(' ')}`)
  if (winId) {
    withDiscordFocus(winId, () => {
      const r = spawnSync('xdotool', args, { stdio: 'pipe' })
      if (r.status !== 0) console.warn(`[${pluginUUID}] xdotool keydown failed:`, r.stderr?.toString().trim())
    })
  } else {
    const r = spawnSync('xdotool', args, { stdio: 'pipe' })
    if (r.status !== 0) console.warn(`[${pluginUUID}] xdotool keydown failed:`, r.stderr?.toString().trim())
  }
}

function xdotoolKeyUp(hotkey) {
  if (!xdotoolAvailable) return
  const winId = getDiscordWindowId()
  const args  = ['keyup', '--clearmodifiers', hotkey]
  console.log(`[${pluginUUID}] xdotool${winId ? ' (via Discord focus)' : ''} ${args.join(' ')}`)
  if (winId) {
    withDiscordFocus(winId, () => {
      const r = spawnSync('xdotool', args, { stdio: 'pipe' })
      if (r.status !== 0) console.warn(`[${pluginUUID}] xdotool keyup failed:`, r.stderr?.toString().trim())
    })
  } else {
    const r = spawnSync('xdotool', args, { stdio: 'pipe' })
    if (r.status !== 0) console.warn(`[${pluginUUID}] xdotool keyup failed:`, r.stderr?.toString().trim())
  }
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
})

// Keep the process alive
setInterval(() => {}, 60_000)
