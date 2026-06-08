import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'

const PORT = Number(process.env.DISCORD_RELAY_PORT || 8787)
const RELAY_API_KEY = String(process.env.RELAY_API_KEY || '').trim()
const DISCORD_CLIENT_SECRET = String(process.env.DISCORD_CLIENT_SECRET || '').trim()
const SESSION_TTL_SECONDS = clampTtlSeconds(process.env.SESSION_TTL_SECONDS)
const MASTER_KEY = String(process.env.DISCORD_RELAY_MASTER_KEY || '').trim()

const STORE_PATH = String(
  process.env.DISCORD_RELAY_STORE ||
    path.join(os.homedir(), '.config', 'tech-stack-streamdeck', 'discord-relay-sessions.enc.json')
)

if (!DISCORD_CLIENT_SECRET) {
  console.error('[discord-relay-local] DISCORD_CLIENT_SECRET is required')
  process.exit(1)
}

if (!MASTER_KEY) {
  console.error('[discord-relay-local] DISCORD_RELAY_MASTER_KEY is required')
  process.exit(1)
}

const store = createEncryptedStore(STORE_PATH, MASTER_KEY)

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)

    if (request.method === 'GET' && url.pathname === '/health') {
      return sendJson(response, 200, {
        ok: true,
        service: 'discord-relay-local',
        store: STORE_PATH,
      })
    }

    if (request.method !== 'POST') {
      return sendJson(response, 405, { error: 'Method not allowed' })
    }

    const authError = checkRelayAuth(request)
    if (authError) return sendJson(response, authError.status, { error: authError.message })

    if (url.pathname === '/oauth/discord/exchange') {
      const body = await readJsonBody(request)
      return handleExchange(response, body)
    }

    if (url.pathname === '/oauth/discord/access') {
      const body = await readJsonBody(request)
      return handleAccess(response, body)
    }

    if (url.pathname === '/oauth/discord/revoke') {
      const body = await readJsonBody(request)
      return handleRevoke(response, body)
    }

    return sendJson(response, 404, { error: 'Not found' })
  } catch (err) {
    return sendJson(response, 500, { error: err?.message || 'Unhandled relay error' })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log('[discord-relay-local] running at http://127.0.0.1:%d', PORT)
  console.log('[discord-relay-local] using encrypted store: %s', STORE_PATH)
})

async function handleExchange(response, body) {
  const clientId = String(body?.clientId || '').trim()
  const code = String(body?.code || '').trim()
  const existingSessionId = String(body?.sessionId || '').trim()
  const redirectUri = String(body?.redirectUri || process.env.DISCORD_REDIRECT_URI || 'http://127.0.0.1').trim()

  if (!clientId) return sendJson(response, 400, { error: 'Missing clientId' })
  if (!code) return sendJson(response, 400, { error: 'Missing authorization code' })

  const discordPayload = await exchangeWithDiscord({
    clientId,
    clientSecret: DISCORD_CLIENT_SECRET,
    grantType: 'authorization_code',
    code,
    redirectUri,
  })

  const sessionId = existingSessionId || crypto.randomUUID()

  await store.writeSession(sessionId, {
    clientId,
    refreshToken: String(discordPayload.refresh_token || ''),
    scope: discordPayload.scope || null,
    tokenType: discordPayload.token_type || null,
    updatedAt: Date.now(),
    expiresAt: Date.now() + (SESSION_TTL_SECONDS * 1000),
  })

  return sendJson(response, 200, toClientTokenResponse(discordPayload, sessionId))
}

async function handleAccess(response, body) {
  const clientId = String(body?.clientId || '').trim()
  const sessionId = String(body?.sessionId || '').trim()
  const legacyRefreshToken = String(body?.refreshToken || '').trim()

  if (!clientId) return sendJson(response, 400, { error: 'Missing clientId' })

  let refreshToken = legacyRefreshToken
  let session = null

  if (!refreshToken && sessionId) {
    session = await store.readSession(sessionId)
    if (!session) return sendJson(response, 404, { error: 'Relay session not found' })
    if (session.clientId !== clientId) return sendJson(response, 400, { error: 'Session client mismatch' })
    refreshToken = String(session.refreshToken || '')
  }

  if (!refreshToken) {
    return sendJson(response, 400, { error: 'Missing refresh token or relay session' })
  }

  const discordPayload = await exchangeWithDiscord({
    clientId,
    clientSecret: DISCORD_CLIENT_SECRET,
    grantType: 'refresh_token',
    refreshToken,
  })

  if (sessionId) {
    await store.writeSession(sessionId, {
      clientId,
      refreshToken: String(discordPayload.refresh_token || refreshToken),
      scope: discordPayload.scope || session?.scope || null,
      tokenType: discordPayload.token_type || session?.tokenType || null,
      updatedAt: Date.now(),
      expiresAt: Date.now() + (SESSION_TTL_SECONDS * 1000),
    })
  }

  return sendJson(response, 200, toClientTokenResponse(discordPayload, sessionId || null))
}

async function handleRevoke(response, body) {
  const sessionId = String(body?.sessionId || '').trim()
  if (!sessionId) return sendJson(response, 400, { error: 'Missing sessionId' })

  await store.deleteSession(sessionId)
  return sendJson(response, 200, { revoked: true, sessionId })
}

function checkRelayAuth(request) {
  if (!RELAY_API_KEY) return null

  const incomingKey = String(request.headers['x-relay-key'] || '').trim()
  if (incomingKey && incomingKey === RELAY_API_KEY) return null

  return { status: 401, message: 'Unauthorized relay request' }
}

async function exchangeWithDiscord({ clientId, clientSecret, grantType, code, refreshToken, redirectUri }) {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: grantType,
  })

  if (code) params.set('code', code)
  if (grantType === 'authorization_code' && redirectUri) params.set('redirect_uri', redirectUri)
  if (refreshToken) params.set('refresh_token', refreshToken)

  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  })

  const payload = await safeJson(res)
  if (!res.ok) {
    const reason = payload?.error_description || payload?.error || `Discord HTTP ${res.status}`
    throw new Error(`Discord token exchange failed: ${reason}`)
  }

  return payload
}

function toClientTokenResponse(discordPayload, sessionId) {
  return {
    accessToken: String(discordPayload.access_token || ''),
    expiresAt: Date.now() + (Number(discordPayload.expires_in || 0) * 1000),
    scope: discordPayload.scope || null,
    tokenType: discordPayload.token_type || null,
    sessionId: sessionId || null,
  }
}

function sendJson(response, status, payload) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(payload))
}

async function readJsonBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))

  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw.trim()) return {}

  try {
    return JSON.parse(raw)
  } catch {
    throw new Error('Invalid JSON body')
  }
}

async function safeJson(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function clampTtlSeconds(raw) {
  const fallback = 60 * 60 * 24 * 30
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  if (value < 60) return 60
  if (value > 60 * 60 * 24 * 90) return 60 * 60 * 24 * 90
  return Math.floor(value)
}

function createEncryptedStore(filePath, masterKey) {
  const dir = path.dirname(filePath)

  return {
    async readAll() {
      await fs.mkdir(dir, { recursive: true })

      let raw = ''
      try {
        raw = await fs.readFile(filePath, 'utf8')
      } catch (err) {
        if (err?.code === 'ENOENT') return {}
        throw err
      }

      if (!raw.trim()) return {}

      const container = JSON.parse(raw)
      const key = deriveKey(masterKey, container.salt)
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(container.iv, 'base64')
      )
      decipher.setAuthTag(Buffer.from(container.tag, 'base64'))

      const plain = Buffer.concat([
        decipher.update(Buffer.from(container.data, 'base64')),
        decipher.final(),
      ])

      const sessions = JSON.parse(plain.toString('utf8'))
      return pruneExpiredSessions(sessions)
    },

    async writeAll(sessions) {
      await fs.mkdir(dir, { recursive: true })

      const payload = Buffer.from(JSON.stringify(pruneExpiredSessions(sessions)), 'utf8')
      const salt = crypto.randomBytes(16)
      const iv = crypto.randomBytes(12)
      const key = deriveKey(masterKey, salt)

      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
      const encrypted = Buffer.concat([cipher.update(payload), cipher.final()])
      const tag = cipher.getAuthTag()

      const container = {
        v: 1,
        salt: salt.toString('base64'),
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        data: encrypted.toString('base64'),
      }

      await fs.writeFile(filePath, JSON.stringify(container), 'utf8')
    },

    async readSession(sessionId) {
      const sessions = await this.readAll()
      return sessions[sessionId] || null
    },

    async writeSession(sessionId, data) {
      const sessions = await this.readAll()
      sessions[sessionId] = data
      await this.writeAll(sessions)
    },

    async deleteSession(sessionId) {
      const sessions = await this.readAll()
      delete sessions[sessionId]
      await this.writeAll(sessions)
    },
  }
}

function deriveKey(masterKey, saltOrBase64) {
  const salt = Buffer.isBuffer(saltOrBase64)
    ? saltOrBase64
    : Buffer.from(String(saltOrBase64 || ''), 'base64')

  return crypto.scryptSync(masterKey, salt, 32)
}

function pruneExpiredSessions(sessions) {
  const now = Date.now()
  const next = {}

  for (const [sessionId, session] of Object.entries(sessions || {})) {
    if (!session || typeof session !== 'object') continue
    const expiresAt = Number(session.expiresAt || 0)
    if (expiresAt && expiresAt < now) continue
    next[sessionId] = session
  }

  return next
}
