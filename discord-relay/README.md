# Discord OAuth Relay (Cloudflare Worker)

This worker keeps the Discord client secret and refresh tokens on the server side.
The Stream Deck Discord plugin calls this relay for OAuth token exchange and refresh.

## Endpoints

- `GET /health`
- `POST /oauth/discord/exchange`
- `POST /oauth/discord/access`
- `POST /oauth/discord/revoke`

The local server (`../discord-relay/local-server.mjs`) exposes the same endpoints for zero-host deployments.

## Required bindings and secrets

1. Cloudflare KV namespace bound as `DISCORD_SESSIONS`
1. Secret: `DISCORD_CLIENT_SECRET`
1. Optional secret: `RELAY_API_KEY`

## Cloudflare Free Tier Plan

This relay is designed for low-cost personal/small-team usage and works well on the Cloudflare Workers free tier.

What users run locally:

- Tech Stack Stream Deck app
- Discord desktop app

What runs in Cloudflare:

- OAuth code exchange (`/oauth/discord/exchange`)
- Access token refresh (`/oauth/discord/access`)
- Session revoke (`/oauth/discord/revoke`)
- Refresh-token session storage in KV (`DISCORD_SESSIONS`)

This lets users click **Authorize** once in Discord, while keeping client secret and refresh tokens off their machine.

Discord application requirement:

- In Discord Developer Portal → **OAuth2**, add `http://127.0.0.1` to the app Redirects list.

## Local dev

1. Install Wrangler
   - `npm i -g wrangler`
1. Authenticate
   - `wrangler login`
1. Create KV
   - `wrangler kv namespace create DISCORD_SESSIONS`
   - `wrangler kv namespace create DISCORD_SESSIONS --preview`
1. Put generated IDs into `wrangler.toml`
1. Set secrets
   - `wrangler secret put DISCORD_CLIENT_SECRET`
   - `wrangler secret put RELAY_API_KEY`
1. Start worker
   - `wrangler dev`

When running `wrangler dev`, use the local URL shown in terminal (usually `http://127.0.0.1:8787`) as the plugin `Relay URL`.

## Local encrypted relay (no hosting cost)

Run from the project root:

```bash
npm run discord-relay:local:setup
```

Or run non-interactive mode:

```bash
export DISCORD_CLIENT_SECRET="your-discord-client-secret"
export DISCORD_RELAY_MASTER_KEY="long-random-local-passphrase"
export RELAY_API_KEY="optional-local-relay-key"
npm run discord-relay:local
```

Defaults:

- Listens on `http://127.0.0.1:8787`
- Encrypted session store at `~/.config/tech-stack-streamdeck/discord-relay-sessions.enc.json`
- Session TTL defaults to 30 days

Optional overrides:

- `DISCORD_RELAY_PORT`
- `DISCORD_RELAY_STORE`
- `SESSION_TTL_SECONDS`

## Deploy

1. `wrangler deploy`
1. Copy deployed worker URL
1. Put relay URL into the Discord action inspector
1. Put `RELAY_API_KEY` into the plugin setting if you enabled it

## Clone User Setup (Discord)

1. Clone and run the main app
1. Install the Discord plugin package into `~/.config/tech-stack-streamdeck/plugins/`
1. Open Discord desktop app
1. In the plugin inspector, set:
   - `Client ID`
   - `Relay URL` (deployed Worker URL)
   - `Relay API Key` (if enabled)
1. Click **Authorize** once

After this, token refresh is automatic through relay session state.

## Security notes

- In hosted mode, the plugin should not store `clientSecret` or `refreshToken`.
- The relay stores refresh tokens in KV with TTL (`SESSION_TTL_SECONDS`).
- Rotate `RELAY_API_KEY` and `DISCORD_CLIENT_SECRET` regularly.

## No-hosting-cost fallback

If you do not want any hosted service cost, run the relay only on your machine:

1. Export `DISCORD_CLIENT_SECRET`
1. Export `DISCORD_RELAY_MASTER_KEY`
1. Run `npm run discord-relay:local:setup` (or `npm run discord-relay:local` if env vars are already exported)
1. Put `http://127.0.0.1:8787` into plugin `Relay URL`

This keeps costs at zero, but the local relay must be running while using Discord actions.
