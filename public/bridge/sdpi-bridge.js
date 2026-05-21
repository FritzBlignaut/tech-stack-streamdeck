/**
 * sdpi-bridge.js — Lightweight postMessage bridge for Stream Deck plugin Property Inspectors.
 *
 * Include in your plugin's inspector HTML:
 *   <script src="sdpi://host/bridge.js"></script>
 *
 * API (available as window.sdpi):
 *   sdpi.setSettings(obj)              — persist settings to the host app
 *   sdpi.getSettings(callback)         — receive current settings once (called immediately on open)
 *   sdpi.sendToPlugin(obj)             — send a message to your plugin's Node.js process
 *   sdpi.onSendToPropertyInspector(cb) — receive messages from your plugin's Node.js process
 */
;(function () {
  'use strict'

  const listeners = {}

  function on(event, cb) {
    listeners[event] = listeners[event] || []
    listeners[event].push(cb)
  }

  function emit(event, data) {
    ;(listeners[event] || []).forEach(cb => {
      try { cb(data) } catch (e) { console.error('[sdpi-bridge] listener error:', e) }
    })
  }

  // Receive messages from the host app (parent frame)
  window.addEventListener('message', e => {
    if (!e.data || typeof e.data !== 'object') return
    emit(e.data.type, e.data.payload)
  })

  window.sdpi = {
    /** Save settings object to the host app — persisted in the button config */
    setSettings(obj) {
      window.parent.postMessage({ type: 'sdpi:setSettings', payload: obj }, '*')
    },

    /** Request current settings; callback receives the settings object */
    getSettings(cb) {
      on('sdpi:settings', cb)
      window.parent.postMessage({ type: 'sdpi:getSettings' }, '*')
    },

    /** Send arbitrary data to the plugin's Node.js process */
    sendToPlugin(obj) {
      window.parent.postMessage({ type: 'sdpi:sendToPlugin', payload: obj }, '*')
    },

    /** Register a handler for messages sent from the plugin's Node.js process */
    onSendToPropertyInspector(cb) {
      on('sdpi:sendToPropertyInspector', cb)
    },
  }
})()
