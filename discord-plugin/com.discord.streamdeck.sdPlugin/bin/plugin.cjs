'use strict'

const {
  DiscordRpcClient,
  exchangeAuthCode,
  refreshAccessToken,
  splitScopes,
} = require('./discord-rpc.cjs')

const pluginUUID = process.env.PLUGIN_UUID || 'com.discord.streamdeck'

const ACTION_PTT = 'com.discord.streamdeck.ptt'
const ACTION_PTM = 'com.discord.streamdeck.ptm'

const HOLD_ACTIONS = new Set([ACTION_PTT, ACTION_PTM])

const rpc = new DiscordRpcClient({ logger: console })

const holdState = new Map()

function log(msg, ...rest) {
  console.log(`[${pluginUUID}] ${msg}`, ...rest)
}

function sendToInspector(actionUUID, payload) {
  if (!process.send || !actionUUID) return
  process.send({ event: 'sendToPropertyInspector', actionUUID, payload })
}

function sanitizeSettings(settings = {}) {
  return {
    clientId: String(settings.clientId || '').trim(),
    clientSecret: String(settings.clientSecret || '').trim(),
    relayUrl: String(settings.relayUrl || '').trim(),
    relayApiKey: String(settings.relayApiKey || '').trim(),
    relaySessionId: String(settings.relaySessionId || '').trim(),
    accessToken: String(settings.accessToken || '').trim(),
    refreshToken: String(settings.refreshToken || '').trim(),
    expiresAt: Number(settings.expiresAt || 0),
    scopes: splitScopes(settings.scopes),
    guildId: String(settings.guildId || '').trim(),
    channelId: String(settings.channelId || '').trim(),
    forceMove: Boolean(settings.forceMove),
  }
}

async function ensureConnection(settings) {
  const s = sanitizeSettings(settings)
  await rpc.ensureConnected(s.clientId)
  return s
}

async function ensureAuthenticated(actionUUID, settings) {
  const s = await ensureConnection(settings)

  if (s.accessToken && s.expiresAt > Date.now() + 30_000) {
    await rpc.authenticate(s.accessToken)
    return s
  }

  if (s.refreshToken) {
    const refreshed = await refreshAccessToken({
      clientId: s.clientId,
      clientSecret: s.clientSecret,
      refreshToken: s.refreshToken,
      relayUrl: s.relayUrl,
      relayApiKey: s.relayApiKey,
      relaySessionId: s.relaySessionId,
    })

    await rpc.authenticate(refreshed.accessToken)

    const patch = {
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
      scope: refreshed.scope,
      tokenType: refreshed.tokenType,
    }
    if (refreshed.refreshToken) patch.refreshToken = refreshed.refreshToken
    if (refreshed.sessionId) patch.relaySessionId = refreshed.sessionId
    if (s.relayUrl) { patch.clientSecret = ''; patch.refreshToken = '' }

    sendToInspector(actionUUID, { type: 'patchSettings', patch })
    return { ...s, ...refreshed }
  }

  if (s.relayUrl && s.relaySessionId) {
    const refreshed = await refreshAccessToken({
      clientId: s.clientId,
      relayUrl: s.relayUrl,
      relayApiKey: s.relayApiKey,
      relaySessionId: s.relaySessionId,
    })

    await rpc.authenticate(refreshed.accessToken)

    sendToInspector(actionUUID, {
      type: 'patchSettings',
      patch: {
        accessToken: refreshed.accessToken,
        expiresAt: refreshed.expiresAt,
        scope: refreshed.scope,
        tokenType: refreshed.tokenType,
        relaySessionId: refreshed.sessionId || s.relaySessionId,
        clientSecret: '',
        refreshToken: '',
      },
    })

    return { ...s, ...refreshed }
  }

  throw new Error('Not authorized. Use the Discord inspector to authorize this action first.')
}

async function toggleMute() {
  const voice = await rpc.getVoiceSettings()
  await rpc.setVoiceSettings({ mute: !Boolean(voice.mute) })
}

async function toggleDeafen() {
  const voice = await rpc.getVoiceSettings()
  await rpc.setVoiceSettings({ deaf: !Boolean(voice.deaf) })
}

async function handleHold(actionUUID, event, context) {
  if (!context) return

  if (event === 'keyDown') {
    const voice = await rpc.getVoiceSettings()
    holdState.set(context, { mute: Boolean(voice.mute), deaf: Boolean(voice.deaf) })

    if (actionUUID === ACTION_PTT) {
      await rpc.setVoiceSettings({ mute: false })
    } else if (actionUUID === ACTION_PTM) {
      await rpc.setVoiceSettings({ mute: true })
    }
    return
  }

  if (event === 'keyUp') {
    const prev = holdState.get(context)
    holdState.delete(context)

    if (actionUUID === ACTION_PTT) {
      await rpc.setVoiceSettings({ mute: prev ? prev.mute : true })
    } else if (actionUUID === ACTION_PTM) {
      await rpc.setVoiceSettings({ mute: prev ? prev.mute : false })
    }
  }
}

async function handleChannelAction(actionUUID, settings) {
  const s = sanitizeSettings(settings)
  if (!s.channelId) {
    throw new Error('No channel selected. Open the Discord inspector and choose a channel first.')
  }

  if (actionUUID === 'com.discord.streamdeck.voice-channel') {
    await rpc.selectVoiceChannel(s.channelId)
    return
  }

  if (actionUUID === 'com.discord.streamdeck.text-channel') {
    await rpc.selectTextChannel(s.channelId)
    return
  }
}

function unsupportedActionError(actionUUID) {
  if (actionUUID === 'com.discord.streamdeck.video') {
    return 'Discord RPC does not expose a stable video-toggle command for this plugin. Action is currently unsupported in RPC mode.'
  }
  if (actionUUID === 'com.discord.streamdeck.stream') {
    return 'Discord RPC does not expose a stable stream-toggle command for this plugin. Action is currently unsupported in RPC mode.'
  }
  return 'Unsupported Discord action.'
}

async function handleKeyEvent(msg) {
  const actionUUID = msg.actionUUID || ''
  const event = msg.event || 'keyDown'
  const settings = msg.settings || {}
  const context = msg.context || ''

  if (!actionUUID) return

  try {
    await ensureAuthenticated(actionUUID, settings)

    if (HOLD_ACTIONS.has(actionUUID)) {
      await handleHold(actionUUID, event, context)
      return
    }

    if (event !== 'keyDown') return

    switch (actionUUID) {
      case 'com.discord.streamdeck.mute':
        await toggleMute()
        return
      case 'com.discord.streamdeck.deafen':
        await toggleDeafen()
        return
      case 'com.discord.streamdeck.voice-channel':
      case 'com.discord.streamdeck.text-channel':
        await handleChannelAction(actionUUID, settings)
        return
      case 'com.discord.streamdeck.video':
      case 'com.discord.streamdeck.stream':
        throw new Error(unsupportedActionError(actionUUID))
      default:
        return
    }
  } catch (err) {
    const message = err?.message || String(err)
    console.warn(`[${pluginUUID}] ${actionUUID} failed: ${message}`)
    sendToInspector(actionUUID, { type: 'error', message })
  }
}

async function handleInspectorMessage(actionUUID, payload) {
  const cmd = payload?.$cmd || ''
  const settings = payload?.settings || payload || {}

  try {
    if (cmd === 'rpc-status') {
      const s = sanitizeSettings(settings)
      await rpc.ensureConnected(s.clientId)

      let authed = false
      if (s.accessToken) {
        try {
          await rpc.authenticate(s.accessToken)
          authed = true
        } catch {
          authed = false
        }
      }

      sendToInspector(actionUUID, {
        type: 'status',
        connected: true,
        ready: rpc.getState().ready,
        authenticated: authed,
      })
      return
    }

    if (cmd === 'rpc-authorize') {
      const s = await ensureConnection(settings)
      const auth = await rpc.authorize({ clientId: s.clientId, scopes: s.scopes })
      const token = await exchangeAuthCode({
        clientId: s.clientId,
        clientSecret: s.clientSecret,
        code: auth.code,
        relayUrl: s.relayUrl,
        relayApiKey: s.relayApiKey,
        relaySessionId: s.relaySessionId,
      })
      await rpc.authenticate(token.accessToken)

      const patch = {
        accessToken: token.accessToken,
        expiresAt: token.expiresAt,
        scope: token.scope,
        tokenType: token.tokenType,
      }
      if (token.refreshToken) patch.refreshToken = token.refreshToken
      if (token.sessionId) patch.relaySessionId = token.sessionId
      if (s.relayUrl) { patch.clientSecret = ''; patch.refreshToken = '' }

      sendToInspector(actionUUID, { type: 'patchSettings', patch })

      sendToInspector(actionUUID, {
        type: 'status',
        connected: true,
        ready: rpc.getState().ready,
        authenticated: true,
      })
      return
    }

    if (cmd === 'rpc-refresh') {
      const authedSettings = await ensureAuthenticated(actionUUID, settings)
      const guilds = await rpc.getGuilds()

      sendToInspector(actionUUID, {
        type: 'guilds',
        guilds,
      })

      if (authedSettings.guildId) {
        const channels = await rpc.getChannels(authedSettings.guildId)
        sendToInspector(actionUUID, {
          type: 'channels',
          guildId: authedSettings.guildId,
          channels,
        })
      }
      return
    }

    if (cmd === 'rpc-load-channels') {
      const authedSettings = await ensureAuthenticated(actionUUID, settings)
      if (!authedSettings.guildId) {
        sendToInspector(actionUUID, { type: 'channels', guildId: '', channels: [] })
        return
      }
      const channels = await rpc.getChannels(authedSettings.guildId)
      sendToInspector(actionUUID, {
        type: 'channels',
        guildId: authedSettings.guildId,
        channels,
      })
      return
    }
  } catch (err) {
    const message = err?.message || String(err)
    sendToInspector(actionUUID, { type: 'error', message })
  }
}

process.on('message', msg => {
  if (!msg?.event) return

  if (msg.event === 'sendToPlugin') {
    handleInspectorMessage(msg.actionUUID || '', msg.settings || {})
    return
  }

  if (msg.event === 'keyDown' || msg.event === 'keyUp') {
    handleKeyEvent(msg)
  }
})

log('Discord RPC plugin ready')
setInterval(() => {}, 60_000)
