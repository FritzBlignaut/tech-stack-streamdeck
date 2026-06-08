export default {
  async fetch(request, env) {
    try {
      if (request.method !== 'POST' && !isHealthRequest(request)) {
        return json({ error: 'Method not allowed' }, 405)
      }

      if (isHealthRequest(request)) {
        return json({ ok: true, service: 'discord-relay' })
      }

      const authError = checkRelayAuth(request, env)
      if (authError) return authError

      const url = new URL(request.url)
      if (url.pathname === '/oauth/discord/exchange') {
        return handleExchange(request, env)
      }

      if (url.pathname === '/oauth/discord/access') {
        return handleAccess(request, env)
      }

      if (url.pathname === '/oauth/discord/revoke') {
        return handleRevoke(request, env)
      }

      return json({ error: 'Not found' }, 404)
    } catch (err) {
      return json({ error: err?.message || 'Unhandled relay error' }, 500)
    }
  },
}

function isHealthRequest(request) {
  const url = new URL(request.url)
  return request.method === 'GET' && url.pathname === '/health'
}

function checkRelayAuth(request, env) {
  const requiredKey = String(env.RELAY_API_KEY || '').trim()
  if (!requiredKey) return null

  const incomingKey = String(request.headers.get('x-relay-key') || '').trim()
  if (incomingKey && incomingKey === requiredKey) return null

  return json({ error: 'Unauthorized relay request' }, 401)
}

async function handleExchange(request, env) {
  const body = await request.json()
  const clientId = String(body?.clientId || '').trim()
  const code = String(body?.code || '').trim()
  const existingSessionId = String(body?.sessionId || '').trim()
  const redirectUri = String(body?.redirectUri || env.DISCORD_REDIRECT_URI || 'http://127.0.0.1').trim()

  if (!clientId) return json({ error: 'Missing clientId' }, 400)
  if (!code) return json({ error: 'Missing authorization code' }, 400)

  const discordPayload = await exchangeWithDiscord({
    clientId,
    clientSecret: requiredSecret(env),
    grantType: 'authorization_code',
    code,
    redirectUri,
  })

  const sessionId = existingSessionId || crypto.randomUUID()
  await writeSession(env, sessionId, {
    clientId,
    refreshToken: String(discordPayload.refresh_token || ''),
    scope: discordPayload.scope || null,
    tokenType: discordPayload.token_type || null,
    updatedAt: Date.now(),
  })

  return json(toClientTokenResponse(discordPayload, sessionId))
}

async function handleAccess(request, env) {
  const body = await request.json()
  const clientId = String(body?.clientId || '').trim()
  const sessionId = String(body?.sessionId || '').trim()
  const legacyRefreshToken = String(body?.refreshToken || '').trim()

  if (!clientId) return json({ error: 'Missing clientId' }, 400)

  let refreshToken = legacyRefreshToken
  if (!refreshToken && sessionId) {
    const session = await readSession(env, sessionId)
    if (!session) return json({ error: 'Relay session not found' }, 404)
    if (session.clientId !== clientId) return json({ error: 'Session client mismatch' }, 400)
    refreshToken = String(session.refreshToken || '')
  }

  if (!refreshToken) {
    return json({ error: 'Missing refresh token or relay session' }, 400)
  }

  const discordPayload = await exchangeWithDiscord({
    clientId,
    clientSecret: requiredSecret(env),
    grantType: 'refresh_token',
    refreshToken,
  })

  if (sessionId) {
    await writeSession(env, sessionId, {
      clientId,
      refreshToken: String(discordPayload.refresh_token || refreshToken),
      scope: discordPayload.scope || null,
      tokenType: discordPayload.token_type || null,
      updatedAt: Date.now(),
    })
  }

  return json(toClientTokenResponse(discordPayload, sessionId || null))
}

async function handleRevoke(request, env) {
  const body = await request.json()
  const sessionId = String(body?.sessionId || '').trim()

  if (!sessionId) return json({ error: 'Missing sessionId' }, 400)

  await env.DISCORD_SESSIONS.delete(sessionKey(sessionId))
  return json({ revoked: true, sessionId })
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

async function writeSession(env, sessionId, data) {
  const ttl = clampTtlSeconds(env.SESSION_TTL_SECONDS)
  await env.DISCORD_SESSIONS.put(sessionKey(sessionId), JSON.stringify(data), {
    expirationTtl: ttl,
  })
}

async function readSession(env, sessionId) {
  const raw = await env.DISCORD_SESSIONS.get(sessionKey(sessionId))
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function sessionKey(sessionId) {
  return `discord-session:${sessionId}`
}

function requiredSecret(env) {
  const value = String(env.DISCORD_CLIENT_SECRET || '').trim()
  if (!value) throw new Error('Server misconfigured: DISCORD_CLIENT_SECRET is missing')
  return value
}

function clampTtlSeconds(raw) {
  const fallback = 60 * 60 * 24 * 30
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  if (value < 60) return 60
  if (value > 60 * 60 * 24 * 90) return 60 * 60 * 24 * 90
  return Math.floor(value)
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

async function safeJson(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}
