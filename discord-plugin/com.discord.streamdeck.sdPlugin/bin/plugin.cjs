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

function xdotoolKey(hotkey) {
  if (!xdotoolAvailable) return
  const result = spawnSync('xdotool', ['key', hotkey], { stdio: 'pipe' })
  if (result.status !== 0) {
    console.warn(`[${pluginUUID}] xdotool key failed for "${hotkey}":`, result.stderr?.toString().trim())
  }
}

function xdotoolKeyDown(hotkey) {
  if (!xdotoolAvailable) return
  const result = spawnSync('xdotool', ['keydown', hotkey], { stdio: 'pipe' })
  if (result.status !== 0) {
    console.warn(`[${pluginUUID}] xdotool keydown failed for "${hotkey}":`, result.stderr?.toString().trim())
  }
}

function xdotoolKeyUp(hotkey) {
  if (!xdotoolAvailable) return
  const result = spawnSync('xdotool', ['keyup', hotkey], { stdio: 'pipe' })
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
