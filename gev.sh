#!/usr/bin/env bash
# Local hardened launcher for God's Eye View (not part of upstream; ignored via .git/info/exclude).
#
#   ./gev.sh               start on http://localhost:4173 (Node 24, localhost only, Keychain keys)
#   ./gev.sh key <NAME>    store a provider key in the macOS Keychain (prompts, never echoes)
#   ./gev.sh keys          list which provider keys are in the Keychain / .env (names only)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# ENV_VAR -> "keychain-service keychain-account", matching what scripts/dev-fresh.sh reads.
keychain_slot() {
  case "$1" in
    GOOGLE_MAPS_API_KEY)   echo "google-maps-api api-key" ;;
    CESIUM_ION_TOKEN)      echo "cesium-ion token" ;;
    OPENAI_API_KEY)        echo "openai-api api-key" ;;
    AISSTREAM_API_KEY)     echo "aisstream-api api-key" ;;
    TOMTOM_API_KEY)        echo "tomtom-api api-key" ;;
    FIRMS_MAP_KEY)         echo "firms-map map-key" ;;
    OPENSKY_CLIENT_ID)     echo "opensky-network client_id" ;;
    OPENSKY_CLIENT_SECRET) echo "opensky-network client_secret" ;;
    *) return 1 ;;
  esac
}
ALL_KEYS=(GOOGLE_MAPS_API_KEY CESIUM_ION_TOKEN OPENAI_API_KEY AISSTREAM_API_KEY TOMTOM_API_KEY FIRMS_MAP_KEY OPENSKY_CLIENT_ID OPENSKY_CLIENT_SECRET)

use_node24() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1091
  source "$NVM_DIR/nvm.sh"
  nvm use 24 >/dev/null
}

case "${1:-start}" in
  key)
    name="${2:-}"
    if ! slot="$(keychain_slot "$name")"; then
      echo "usage: ./gev.sh key <$(IFS='|'; echo "${ALL_KEYS[*]}")>" >&2
      exit 1
    fi
    read -r service account <<<"$slot"
    # -w as the LAST argument with no value makes `security` prompt for it,
    # so the secret never lands in argv, shell history or a file.
    security add-generic-password -U -s "$service" -a "$account" -w
    echo "Stored $name in the Keychain ($service / $account). Restart with ./gev.sh"
    exit 0
    ;;
  keys)
    use_node24
    for name in "${ALL_KEYS[@]}"; do
      read -r service account <<<"$(keychain_slot "$name")"
      where=()
      security find-generic-password -s "$service" -a "$account" >/dev/null 2>&1 && where+=(keychain)
      [[ -n "$(node scripts/read-dotenv-value.mjs "$name" 2>/dev/null)" ]] && where+=(".env (plaintext!)")
      printf '  %-22s %s\n' "$name" "${where[*]:-not set}"
    done
    exit 0
    ;;
  start) ;;
  *)
    sed -n '2,7p' "$0"
    exit 1
    ;;
esac

use_node24

# 1) Never expose the key broker to the network from this launcher.
if [[ -n "${HOST:-}" && "$HOST" != "localhost" && "$HOST" != "127.0.0.1" && "$HOST" != "::1" ]]; then
  echo "refusing HOST=$HOST: this launcher is localhost-only (it would expose your paid API keys to the network)." >&2
  exit 1
fi
export HOST=localhost

# 2) Plaintext key files: owner-only permissions, and nudge towards the Keychain.
for f in .env .env.local pinokio/ENVIRONMENT; do
  if [[ -f "$f" ]]; then
    chmod 600 "$f"
    for name in "${ALL_KEYS[@]}"; do
      if grep -qE "^[[:space:]]*(export[[:space:]]+)?${name}=.+" "$f"; then
        echo "note: $name is stored in plaintext in $f — prefer: ./gev.sh key $name (then delete the line)" >&2
      fi
    done
  fi
done

# 3) Throttle the paid proxies even locally (these are per-minute limits, NOT billing caps;
#    also set budget alerts at OpenAI / Google Cloud).
export GEV_RATELIMIT_OPENAI_PER_MIN="${GEV_RATELIMIT_OPENAI_PER_MIN:-30}"
export GEV_RATELIMIT_GOOGLE_PER_MIN="${GEV_RATELIMIT_GOOGLE_PER_MIN:-60}"

# 4) CCTV: some Turkish camera hosts omit their intermediate certificate, which
#    browsers fetch but Node does not. Trust exactly those public intermediates
#    (they chain to Mozilla-trusted roots; see the file header).
export NODE_EXTRA_CA_CERTS="$ROOT/config/tls/cctv-intermediates.pem"

# 5) Heat/CPU: AISStream defaults to the WHOLE WORLD and never disconnects, so
#    the server parses every ship message on Earth once any tab asked for ships.
#    Limit it to Turkey + Europe + Mediterranean + Black Sea (override to widen).
export AISSTREAM_BOUNDING_BOXES="${AISSTREAM_BOUNDING_BOXES:-[[[27,-25],[72,50]]]}"

# 6) Upstream launcher: reads keys from env/.env/Keychain, clears the Vite cache, binds localhost.
exec ./scripts/dev-fresh.sh
