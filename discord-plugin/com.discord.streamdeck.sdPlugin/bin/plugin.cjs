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
 * Find Discord's X11 window ID so we can send key events directly to it.
 * Without targeting a specific window, xdotool sends to the currently focused
 * window — which is the tech-stack-streamdeck Electron app when a Stream Deck
 * button is pressed.  Targeting Discord's window ensures the event reaches
 * Discord even when it is not focused.
 *
 * Returns the window ID string, or null if Discord is not running / not found.
 */
function getDiscordWindowId() {
  // Try by window class first (most reliable — matches the Electron app class)
  const byClass = spawnSync('xdotool', ['search', '--class', 'discord'], { stdio: 'pipe' })
  if (byClass.status === 0) {
    const ids = byClass.stdout.toString().trim().split('\n').filter(Boolean)
    if (ids.length > 0) return ids[ids.length - 1] // last = most recently active
  }
  // Fallback: search by window title
  const byName = spawnSync('xdotool', ['search', '--name', 'Discord'], { stdio: 'pipe' })
  if (byName.status === 0) {
    const ids = byName.stdout.toString().trim().split('\n').filter(Boolean)
    if (ids.length > 0) return ids[ids.length - 1]
  }
  console.warn(`[${pluginUUID}] Could not find Discord window — sending key to focused window instead`)
  return null
}

function xdotoolKey(hotkey) {
  if (!xdotoolAvailable) return
  const winId = getDiscordWindowId()
  const args = winId
    ? ['key', '--clearmodifiers', '--window', winId, hotkey]
    : ['key', '--clearmodifiers', hotkey]
  console.log(`[${pluginUUID}] xdotool ${args.join(' ')}`)
  const result = spawnSync('xdotool', args, { stdio: 'pipe' })
  if (result.status !== 0) {
    console.warn(`[${pluginUUID}] xdotool key failed for "${hotkey}":`, result.stderr?.toString().trim())
  }
}

function xdotoolKeyDown(hotkey) {
  if (!xdotoolAvailable) return
  const winId = getDiscordWindowId()
  const args = winId
    ? ['keydown', '--clearmodifiers', '--window', winId, hotkey]
    : ['keydown', '--clearmodifiers', hotkey]
  console.log(`[${pluginUUID}] xdotool ${args.join(' ')}`)
  const result = spawnSync('xdotool', args, { stdio: 'pipe' })
  if (result.status !== 0) {
    console.warn(`[${pluginUUID}] xdotool keydown failed for "${hotkey}":`, result.stderr?.toString().trim())
  }
}

function xdotoolKeyUp(hotkey) {
  if (!xdotoolAvailable) return
  const winId = getDiscordWindowId()
  const args = winId
    ? ['keyup', '--clearmodifiers', '--window', winId, hotkey]
    : ['keyup', '--clearmodifiers', hotkey]
  console.log(`[${pluginUUID}] xdotool ${args.join(' ')}`)
  const result = spawnSync('xdotool', args, { stdio: 'pipe' })
  if (result.status !== 0) {
    console.warn(`[${pluginUUID}] xdotool keyup failed for "${hotkey}":`, result.stderr?.toString().trim())
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
