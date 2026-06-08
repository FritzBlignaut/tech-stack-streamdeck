'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const net = require('net')
const crypto = require('crypto')

const OPCODE_HANDSHAKE = 0
const OPCODE_FRAME = 1
const OPCODE_CLOSE = 2
const OPCODE_PING = 3
const OPCODE_PONG = 4

const REQUEST_TIMEOUT_MS = 12_000
const RELAY_TIMEOUT_MS = 12_000

async function postJson(url, payload, headers = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), RELAY_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload || {}),
      signal: controller.signal,
    })

    let data = null
    try { data = await res.json() } catch {}

    if (!res.ok) {
      const reason = data?.error || data?.message || `HTTP ${res.status}`
      throw new Error(reason)
    }

    return data || {}
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('Relay request timed out')
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

function normalizeRelayUrl(relayUrl) {
  const base = String(relayUrl || '').trim().replace(/\/+$/, '')
  if (!base) return ''
  if (!/^https?:\/\//i.test(base)) {
    throw new Error('Relay URL must start with http:// or https://')
  }
  return base
}

function makeNonce() {
  return crypto.randomBytes(8).toString('hex')
}

function toLe32(num) {
  const b = Buffer.allocUnsafe(4)
  b.writeUInt32LE(num, 0)
  return b
}

function splitScopes(scopes) {
  if (!scopes) return ['rpc', 'identify']
  if (Array.isArray(scopes)) return scopes
  return String(scopes)
    .split(/[ ,]+/)
    .map(s => s.trim())
    .filter(Boolean)
}

class DiscordRpcClient {
  constructor({ logger } = {}) {
    this.log = logger || console
    this.socket = null
    this.buffer = Buffer.alloc(0)
    this.connected = false
    this.ready = false
    this.pending = new Map()
    this.clientId = null
  }

  getState() {
    return {
      connected: this.connected,
      ready: this.ready,
      clientId: this.clientId,
    }
  }

  async ensureConnected(clientId) {
    if (!clientId) throw new Error('Missing Discord client ID')

    if (this.ready && this.connected && this.clientId === clientId) return

    await this.disconnect()

    this.clientId = clientId
    const socketPath = this.findSocketPath()
    if (!socketPath) {
      throw new Error('Discord IPC socket not found. Start Discord desktop app and try again.')
    }

    this.socket = await this.openSocket(socketPath)
    this.connected = true
    this.ready = false

    this.socket.on('data', chunk => this.onData(chunk))
    this.socket.on('error', err => this.onSocketError(err))
    this.socket.on('close', () => this.onSocketClose())

    await this.sendRaw(OPCODE_HANDSHAKE, { v: 1, client_id: clientId })
    await this.waitForReady()
  }

  async disconnect() {
    this.ready = false
    this.connected = false

    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Discord RPC disconnected'))
    }
    this.pending.clear()

    if (this.socket) {
      try { this.socket.end() } catch {}
      try { this.socket.destroy() } catch {}
      this.socket = null
    }

    this.buffer = Buffer.alloc(0)
  }

  async authorize({ clientId, scopes }) {
    return this.call('AUTHORIZE', {
      client_id: clientId,
      scopes: splitScopes(scopes),
    })
  }

  async authenticate(accessToken) {
    if (!accessToken) throw new Error('Missing access token')
    return this.call('AUTHENTICATE', { access_token: accessToken })
  }

  async getVoiceSettings() {
    return this.call('GET_VOICE_SETTINGS', {})
  }

  async setVoiceSettings(patch) {
    return this.call('SET_VOICE_SETTINGS', patch || {})
  }

  async getGuilds() {
    const data = await this.call('GET_GUILDS', {})
    return data.guilds || []
  }

  async getChannels(guildId) {
    if (!guildId) throw new Error('Missing guild ID')
    const data = await this.call('GET_CHANNELS', { guild_id: guildId })
    return data.channels || []
  }

  async selectVoiceChannel(channelId) {
    return this.call('SELECT_VOICE_CHANNEL', { channel_id: channelId || null })
  }

  async selectTextChannel(channelId) {
    return this.call('SELECT_TEXT_CHANNEL', { channel_id: channelId || null })
  }

  async call(cmd, args) {
    if (!this.connected || !this.ready) {
      throw new Error('Discord RPC is not connected')
    }

    const nonce = makeNonce()
    const payload = { cmd, args: args || {}, nonce }

    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(nonce)
        reject(new Error(`Discord RPC timed out for ${cmd}`))
      }, REQUEST_TIMEOUT_MS)

      this.pending.set(nonce, { resolve, reject, timeout })
      this.sendRaw(OPCODE_FRAME, payload).catch(err => {
        clearTimeout(timeout)
        this.pending.delete(nonce)
        reject(err)
      })
    })

    if (result?.evt === 'ERROR') {
      const code = result?.data?.code ? ` (${result.data.code})` : ''
      throw new Error(`${result?.data?.message || 'Discord RPC error'}${code}`)
    }

    return result?.data || {}
  }

  findSocketPath() {
    const envCandidates = [
      process.env.XDG_RUNTIME_DIR,
      process.env.TMPDIR,
      process.env.TMP,
      process.env.TEMP,
      '/tmp',
      path.join('/run/user', String(process.getuid?.() || process.geteuid?.() || '')),
      os.tmpdir(),
    ]

    const dirs = [...new Set(envCandidates.filter(Boolean))]
    for (const dir of dirs) {
      for (let i = 0; i <= 9; i++) {
        const candidate = path.join(dir, `discord-ipc-${i}`)
        if (fs.existsSync(candidate)) return candidate
      }
    }
    return null
  }

  openSocket(socketPath) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(socketPath)
      const onError = err => {
        socket.removeListener('connect', onConnect)
        reject(err)
      }
      const onConnect = () => {
        socket.removeListener('error', onError)
        resolve(socket)
      }
      socket.once('error', onError)
      socket.once('connect', onConnect)
    })
  }

  async waitForReady() {
    const nonce = makeNonce()
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(nonce)
        reject(new Error('Discord RPC handshake timed out'))
      }, REQUEST_TIMEOUT_MS)

      this.pending.set(nonce, {
        resolve: payload => {
          clearTimeout(timeout)
          if (payload?.evt === 'READY') {
            this.ready = true
            resolve()
          } else {
            reject(new Error('Discord RPC did not return READY'))
          }
        },
        reject: err => {
          clearTimeout(timeout)
          reject(err)
        },
        timeout,
      })

      this.handshakeNonce = nonce
    })
  }

  async sendRaw(opcode, payloadObj) {
    if (!this.socket) throw new Error('Discord socket is not open')
    const payload = Buffer.from(JSON.stringify(payloadObj), 'utf8')
    const header = Buffer.allocUnsafe(8)
    header.writeInt32LE(opcode, 0)
    header.writeInt32LE(payload.length, 4)
    const frame = Buffer.concat([header, payload])

    await new Promise((resolve, reject) => {
      this.socket.write(frame, err => (err ? reject(err) : resolve()))
    })
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (this.buffer.length >= 8) {
      const opcode = this.buffer.readInt32LE(0)
      const length = this.buffer.readInt32LE(4)
      if (this.buffer.length < 8 + length) return

      const payloadBuf = this.buffer.subarray(8, 8 + length)
      this.buffer = this.buffer.subarray(8 + length)

      let payload = null
      try {
        payload = JSON.parse(payloadBuf.toString('utf8'))
      } catch {
        continue
      }

      if (opcode === OPCODE_PING) {
        this.sendRaw(OPCODE_PONG, payload).catch(() => {})
        continue
      }

      if (opcode === OPCODE_CLOSE) {
        this.onSocketClose()
        continue
      }

      if (opcode === OPCODE_FRAME || opcode === OPCODE_HANDSHAKE) {
        this.dispatchPayload(payload)
      }
    }
  }

  dispatchPayload(payload) {
    if (payload?.evt === 'READY' && this.handshakeNonce) {
      const pending = this.pending.get(this.handshakeNonce)
      if (pending) {
        this.pending.delete(this.handshakeNonce)
        this.handshakeNonce = null
        pending.resolve(payload)
        return
      }
    }

    const nonce = payload?.nonce
    if (!nonce) return

    const pending = this.pending.get(nonce)
    if (!pending) return

    this.pending.delete(nonce)
    clearTimeout(pending.timeout)
    pending.resolve(payload)
  }

  onSocketError(err) {
    this.log.warn('[Discord RPC] socket error:', err?.message || err)
  }

  onSocketClose() {
    this.ready = false
    this.connected = false
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Discord RPC connection closed'))
    }
    this.pending.clear()
  }
}

async function exchangeAuthCode({ clientId, clientSecret, code, relayUrl, relayApiKey, relaySessionId }) {
  const relayBaseUrl = normalizeRelayUrl(relayUrl)
  const relayKey = String(relayApiKey || '').trim()
  const relaySession = String(relaySessionId || '').trim()

  if (relayBaseUrl) {
    if (!clientId) throw new Error('Missing client ID for relay exchange')
    if (!code) throw new Error('Missing authorization code from Discord')

    const relayPayload = await postJson(
      `${relayBaseUrl}/oauth/discord/exchange`,
      { clientId, code, sessionId: relaySession || null },
      relayKey ? { 'x-relay-key': relayKey } : {}
    )

    return {
      accessToken: relayPayload.accessToken || '',
      refreshToken: relayPayload.refreshToken || null,
      sessionId: relayPayload.sessionId || relaySession || null,
      expiresAt: Number(relayPayload.expiresAt || 0),
      scope: relayPayload.scope || null,
      tokenType: relayPayload.tokenType || null,
    }
  }

  if (!clientId) throw new Error('Missing client ID for token exchange')
  if (!clientSecret) throw new Error('Missing client secret for token exchange')
  if (!code) throw new Error('Missing authorization code from Discord')

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
  })

  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  let payload = null
  try { payload = await res.json() } catch {}

  if (!res.ok) {
    const reason = payload?.error_description || payload?.error || `HTTP ${res.status}`
    throw new Error(`Token exchange failed: ${reason}`)
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || null,
    expiresAt: Date.now() + ((payload.expires_in || 0) * 1000),
    scope: payload.scope || null,
    tokenType: payload.token_type || null,
  }
}

async function refreshAccessToken({ clientId, clientSecret, refreshToken, relayUrl, relayApiKey, relaySessionId }) {
  const relayBaseUrl = normalizeRelayUrl(relayUrl)
  const relayKey = String(relayApiKey || '').trim()
  const relaySession = String(relaySessionId || '').trim()

  if (relayBaseUrl) {
    if (!clientId) throw new Error('Missing client ID for relay refresh')
    if (!relaySession && !refreshToken) throw new Error('Missing relay session or refresh token')

    const relayPayload = await postJson(
      `${relayBaseUrl}/oauth/discord/access`,
      { clientId, sessionId: relaySession || null, refreshToken: refreshToken || null },
      relayKey ? { 'x-relay-key': relayKey } : {}
    )

    return {
      accessToken: relayPayload.accessToken || '',
      refreshToken: relayPayload.refreshToken || refreshToken || null,
      sessionId: relayPayload.sessionId || relaySession || null,
      expiresAt: Number(relayPayload.expiresAt || 0),
      scope: relayPayload.scope || null,
      tokenType: relayPayload.tokenType || null,
    }
  }

  if (!clientId) throw new Error('Missing client ID for refresh')
  if (!clientSecret) throw new Error('Missing client secret for refresh')
  if (!refreshToken) throw new Error('Missing refresh token')

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })

  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  let payload = null
  try { payload = await res.json() } catch {}

  if (!res.ok) {
    const reason = payload?.error_description || payload?.error || `HTTP ${res.status}`
    throw new Error(`Token refresh failed: ${reason}`)
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || refreshToken,
    expiresAt: Date.now() + ((payload.expires_in || 0) * 1000),
    scope: payload.scope || null,
    tokenType: payload.token_type || null,
  }
}

module.exports = {
  DiscordRpcClient,
  exchangeAuthCode,
  refreshAccessToken,
  splitScopes,
}
