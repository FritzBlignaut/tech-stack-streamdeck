#!/usr/bin/env bash
set -euo pipefail

echo "Discord local relay setup"
echo "-------------------------"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is not installed or not on PATH."
  exit 1
fi

default_port="${DISCORD_RELAY_PORT:-8787}"
default_store="${DISCORD_RELAY_STORE:-$HOME/.config/tech-stack-streamdeck/discord-relay-sessions.enc.json}"

echo
printf "Discord client secret: "
IFS= read -rs discord_client_secret
echo
if [[ -z "$discord_client_secret" ]]; then
  echo "Error: DISCORD_CLIENT_SECRET is required."
  exit 1
fi

echo
printf "Master key (used to encrypt local sessions): "
IFS= read -rs relay_master_key
echo
if [[ -z "$relay_master_key" ]]; then
  echo "Error: DISCORD_RELAY_MASTER_KEY is required."
  exit 1
fi

echo
printf "Relay API key (optional, press Enter to skip): "
IFS= read -rs relay_api_key
echo

echo
printf "Relay port [%s]: " "$default_port"
IFS= read -r relay_port_input
relay_port="${relay_port_input:-$default_port}"

printf "Encrypted session store path [%s]: " "$default_store"
IFS= read -r relay_store_input
relay_store="${relay_store_input:-$default_store}"

export DISCORD_CLIENT_SECRET="$discord_client_secret"
export DISCORD_RELAY_MASTER_KEY="$relay_master_key"
export DISCORD_RELAY_PORT="$relay_port"
export DISCORD_RELAY_STORE="$relay_store"

if [[ -n "$relay_api_key" ]]; then
  export RELAY_API_KEY="$relay_api_key"
else
  unset RELAY_API_KEY 2>/dev/null || true
fi

echo
echo "Starting local relay on http://127.0.0.1:${DISCORD_RELAY_PORT}"
echo "Use this URL in the Discord inspector Relay URL field."

action_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$action_dir/.." && pwd)"

cd "$repo_root"
exec node discord-relay/local-server.mjs
