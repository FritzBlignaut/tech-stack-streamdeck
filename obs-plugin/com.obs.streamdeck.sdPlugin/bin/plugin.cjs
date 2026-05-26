/**
 * com.obs.streamdeck — plugin.cjs
 *
 * Runs as a child process forked by the host app.
 * Connects to OBS WebSocket v5 at localhost:4455 and dispatches commands.
 *
 * Uses only Node.js built-ins (crypto + the global WebSocket available in Node 22+).
 * No npm dependencies required.
 */

'use strict'

const crypto = require('crypto')

const pluginUUID  = process.env.PLUGIN_UUID || 'com.obs.streamdeck'
const OBS_HOST    = 'localhost'
const OBS_PORT    = 4455
const RECONNECT_MS = 5000

// ─── OBS WebSocket v5 client ──────────────────────────────────────────────────

let ws               = null
let connected        = false
let identified       = false
let pendingRequests  = new Map()  // requestId → { resolve, reject }
let reconnectTimer   = null

function sha256base64(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('base64')
}

function generateAuth(password, salt, challenge) {
  const secretHash = sha256base64(password + salt)
  return sha256base64(secretHash + challenge)
}

function nextId() {
  return crypto.randomBytes(6).toString('hex')
}

/**
 * Send a request to OBS and return a Promise that resolves with responseData.
 * Rejects if OBS returns a non-success status or the request times out.
 */
function obsCall(requestType, requestData = {}) {
  return new Promise((resolve, reject) => {
    if (!identified) {
      reject(new Error('OBS not connected'))
      return
    }
    const requestId = nextId()
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId)
      reject(new Error(`OBS request "${requestType}" timed out`))
    }, 10_000)

    pendingRequests.set(requestId, {
      resolve: (data) => { clearTimeout(timeout); resolve(data) },
      reject:  (err)  => { clearTimeout(timeout); reject(err) },
    })

    ws.send(JSON.stringify({
      op: 6,
      d: { requestType, requestId, requestData },
    }))
  })
}

function scheduleReconnect() {
  if (reconnectTimer != null) return
  reconnectTimer = setTimeout(connect, RECONNECT_MS)
}

function connect() {
  reconnectTimer = null
  if (ws) {
    try { ws.close() } catch {}
    ws = null
  }
  connected   = false
  identified  = false

  // Node 22 built-in WebSocket
  if (typeof WebSocket === 'undefined') {
    console.error(`[${pluginUUID}] WebSocket is not available. Requires Node.js 22+.`)
    scheduleReconnect()
    return
  }

  const obsWs = new WebSocket(`ws://${OBS_HOST}:${OBS_PORT}`)
  ws = obsWs

  obsWs.onopen = () => {
    connected = true
    console.log(`[${pluginUUID}] WebSocket connected — waiting for Hello`)
  }

  obsWs.onmessage = ({ data }) => {
    let msg
    try { msg = JSON.parse(data) } catch { return }
    const { op, d } = msg

    // Op 0 — Hello: server sends auth info
    if (op === 0) {
      const identifyData = { rpcVersion: 1 }
      if (d?.authentication) {
        const password = process.env.OBS_PASSWORD || ''
        identifyData.authentication = generateAuth(password, d.authentication.salt, d.authentication.challenge)
      }
      obsWs.send(JSON.stringify({ op: 1, d: identifyData }))
      return
    }

    // Op 2 — Identified: connection ready
    if (op === 2) {
      identified = true
      console.log(`[${pluginUUID}] OBS identified — ready`)
      return
    }

    // Op 7 — RequestResponse
    if (op === 7) {
      const pending = pendingRequests.get(d?.requestId)
      if (!pending) return
      pendingRequests.delete(d.requestId)
      if (d.requestStatus?.result) {
        pending.resolve(d.responseData ?? {})
      } else {
        pending.reject(new Error(`OBS error ${d.requestStatus?.code}: ${d.requestStatus?.comment ?? ''}`))
      }
    }
  }

  obsWs.onclose = () => {
    connected  = false
    identified = false
    // Reject all pending requests
    for (const { reject } of pendingRequests.values()) {
      reject(new Error('OBS disconnected'))
    }
    pendingRequests.clear()
    if (obsWs === ws) {
      ws = null
      console.log(`[${pluginUUID}] OBS disconnected — retrying in ${RECONNECT_MS / 1000}s`)
      scheduleReconnect()
    }
  }

  obsWs.onerror = (err) => {
    // onclose will fire after onerror; just log here
    console.warn(`[${pluginUUID}] OBS WebSocket error:`, err?.message ?? err)
  }
}

// ─── Action → OBS command mapping ────────────────────────────────────────────

async function handleKeyDown(actionUUID, settings) {
  if (!identified) {
    console.warn(`[${pluginUUID}] keyDown ${actionUUID} — OBS not connected`)
    return
  }

  try {
    switch (actionUUID) {
      case 'com.obs.streamdeck.record':
        await obsCall('ToggleRecord')
        break

      case 'com.obs.streamdeck.record-pause':
        await obsCall('ToggleRecordPause')
        break

      case 'com.obs.streamdeck.stream':
        await obsCall('ToggleStream')
        break

      case 'com.obs.streamdeck.replay-buffer':
        await obsCall('ToggleReplayBuffer')
        break

      case 'com.obs.streamdeck.save-replay':
        await obsCall('SaveReplayBuffer')
        break

      case 'com.obs.streamdeck.studio-mode':
        await obsCall('ToggleStudioMode')
        break

      case 'com.obs.streamdeck.push-to-program':
        await obsCall('TriggerStudioModeTransition')
        break

      case 'com.obs.streamdeck.scene':
        if (settings?.sceneName) {
          await obsCall('SetCurrentProgramScene', { sceneName: settings.sceneName })
        }
        break

      case 'com.obs.streamdeck.scene-collection':
        if (settings?.sceneCollectionName) {
          await obsCall('SetCurrentSceneCollection', { sceneCollectionName: settings.sceneCollectionName })
        }
        break

      case 'com.obs.streamdeck.mute':
        if (settings?.inputName) {
          await obsCall('ToggleInputMute', { inputName: settings.inputName })
        }
        break

      case 'com.obs.streamdeck.media':
        if (settings?.inputName) {
          await obsCall('TriggerMediaInputAction', {
            inputName:   settings.inputName,
            mediaAction: settings.mediaAction ?? 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE',
          })
        }
        break

      case 'com.obs.streamdeck.source-visibility':
        if (settings?.sceneName && settings?.sourceName) {
          const { sceneItems } = await obsCall('GetSceneItemList', { sceneName: settings.sceneName })
          const item = sceneItems?.find(i => i.sourceName === settings.sourceName)
          if (item != null) {
            await obsCall('SetSceneItemEnabled', {
              sceneName:        settings.sceneName,
              sceneItemId:      item.sceneItemId,
              sceneItemEnabled: !item.sceneItemEnabled,
            })
          }
        }
        break

      case 'com.obs.streamdeck.filter':
        if (settings?.sourceName && settings?.filterName) {
          const { filterEnabled } = await obsCall('GetSourceFilter', {
            sourceName: settings.sourceName,
            filterName: settings.filterName,
          })
          await obsCall('SetSourceFilterEnabled', {
            sourceName:    settings.sourceName,
            filterName:    settings.filterName,
            filterEnabled: !filterEnabled,
          })
        }
        break

      case 'com.obs.streamdeck.screenshot':
        if (settings?.sourceName) {
          const filePath = settings.imageFilePath || `/tmp/obs-screenshot-${Date.now()}.png`
          await obsCall('SaveSourceScreenshot', {
            sourceName:  settings.sourceName,
            imageFormat: 'png',
            imageFilePath: filePath,
          })
        }
        break

      case 'com.obs.streamdeck.transition':
        if (settings?.transitionName) {
          await obsCall('SetCurrentSceneTransitionOverride', { transitionName: settings.transitionName })
        }
        break

      case 'com.obs.streamdeck.chapter-marker':
        await obsCall('SendStreamCaption', { captionText: settings?.captionText ?? '' })
        break

      default:
        console.warn(`[${pluginUUID}] Unknown action UUID: ${actionUUID}`)
    }
  } catch (err) {
    console.warn(`[${pluginUUID}] Action "${actionUUID}" failed:`, err.message)
  }
}

// ─── Inspector data requests ──────────────────────────────────────────────────

/**
 * Handle requests from the property inspector (sdpi:sendToPlugin).
 * The inspector sends { type: 'getScenes' | 'getInputs' | 'getTransitions' | 'getSceneCollections' }
 * We fetch from OBS and reply via process.send (relayed to inspector via plugin:message).
 */
async function handleSendToPlugin(actionUUID, payload) {
  const requestType = payload?.type
  if (!requestType) return

  if (!identified) {
    process.send({ event: 'sendToPropertyInspector', actionUUID, payload: { type: 'error', message: 'OBS not connected' } })
    return
  }

  try {
    if (requestType === 'getScenes') {
      const { scenes } = await obsCall('GetSceneList')
      const sorted = [...(scenes ?? [])].sort((a, b) => (b.sceneIndex ?? 0) - (a.sceneIndex ?? 0)).map(s => s.sceneName).filter(Boolean)
      process.send({ event: 'sendToPropertyInspector', actionUUID, payload: { type: 'scenes', scenes: sorted } })

    } else if (requestType === 'getInputs') {
      const { inputs } = await obsCall('GetInputList')
      const names = (inputs ?? []).map(i => i.inputName).filter(Boolean)
      process.send({ event: 'sendToPropertyInspector', actionUUID, payload: { type: 'inputs', inputs: names } })

    } else if (requestType === 'getTransitions') {
      const { transitions } = await obsCall('GetSceneTransitionList')
      const names = (transitions ?? []).map(t => t.transitionName).filter(Boolean)
      process.send({ event: 'sendToPropertyInspector', actionUUID, payload: { type: 'transitions', transitions: names } })

    } else if (requestType === 'getSceneCollections') {
      const { sceneCollections } = await obsCall('GetSceneCollectionList')
      const names = (sceneCollections ?? []).map(c => c.sceneCollectionName ?? c).filter(Boolean)
      process.send({ event: 'sendToPropertyInspector', actionUUID, payload: { type: 'sceneCollections', sceneCollections: names } })
    }
  } catch (err) {
    process.send({ event: 'sendToPropertyInspector', actionUUID, payload: { type: 'error', message: err.message } })
  }
}

// ─── Message handler ──────────────────────────────────────────────────────────

process.on('message', (msg) => {
  if (!msg?.event) return

  if (msg.event === 'keyDown') {
    handleKeyDown(msg.actionUUID || '', msg.settings || {})
  }

  // keyUp has no OBS actions that require hold-release, so nothing to do

  if (msg.event === 'sendToPlugin') {
    handleSendToPlugin(msg.actionUUID || '', msg.payload || {})
  }
})

// ─── Start ────────────────────────────────────────────────────────────────────

console.log(`[${pluginUUID}] Starting — connecting to OBS at ${OBS_HOST}:${OBS_PORT}`)
connect()

// Keep the process alive
setInterval(() => {}, 60_000)
