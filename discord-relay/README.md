# Discord OAuth Relay (Cloudflare Worker)

This worker keeps the Discord client secret and refresh tokens on the server side.
The Stream Deck Discord plugin calls this relay for OAuth token exchange and refresh.

## Endpoints

- `GET /health`
- `POST /oauth/discord/exchange`
- `POST /oauth/discord/access`
- `POST /oauth/discord/revoke`

## Required bindings and secrets

1. Cloudflare KV namespace bound as `DISCORD_SESSIONS`
1. Secret: `DISCORD_CLIENT_SECRET`
1. Optional secret: `RELAY_API_KEY`

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

## Deploy

1. `wrangler deploy`
1. Copy deployed worker URL
1. Put relay URL into the Discord action inspector
1. Put `RELAY_API_KEY` into the plugin setting if you enabled it

## Security notes

- In hosted mode, the plugin should not store `clientSecret` or `refreshToken`.
- The relay stores refresh tokens in KV with TTL (`SESSION_TTL_SECONDS`).
- Rotate `RELAY_API_KEY` and `DISCORD_CLIENT_SECRET` regularly.
