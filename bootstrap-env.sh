#!/usr/bin/env bash
# Generate bl-api-proxy-admin/.env: pull APISIX admin key + BinaryLane master
# token from the proxy project's .env, and generate fresh session + bootstrap secrets.
#
# Usage:
#   ./bootstrap-env.sh [path-to-proxy-project] [hostname]
#
#   path-to-proxy-project  default: ../bl-api-proxy   (the APISIX proxy install)
#   hostname               default: bl-api.example.com (your public HTTPS domain)
set -euo pipefail
cd "$(dirname "$0")"

PROXY_DIR="${1:-../bl-api-proxy}"
HOSTNAME="${2:-bl-api.example.com}"
PROXY_ENV="$PROXY_DIR/.env"

if [ ! -f "$PROXY_ENV" ]; then
  echo "ERROR: proxy .env not found at $PROXY_ENV" >&2
  echo "       Pass the proxy project path as the first argument." >&2
  exit 1
fi

ADMIN_KEY=$(grep '^ADMIN_KEY=' "$PROXY_ENV" | cut -d= -f2-)
BL_TOKEN=$(grep '^BL_API_TOKEN=' "$PROXY_ENV" | cut -d= -f2-)

if [ -z "$ADMIN_KEY" ] || [ -z "$BL_TOKEN" ]; then
  echo "ERROR: could not read ADMIN_KEY/BL_API_TOKEN from $PROXY_ENV" >&2
  exit 1
fi

SESSION_SECRET=$(openssl rand -hex 32)
BOOTSTRAP_TOKEN=$(openssl rand -hex 16)

install -m 600 /dev/null .env
cat > .env <<EOF
# bl-api-proxy-admin secrets — generated $(date -u +%FT%TZ)
SESSION_SECRET=$SESSION_SECRET
ADMIN_BOOTSTRAP_TOKEN=$BOOTSTRAP_TOKEN

# From the proxy project (APISIX admin + master BL token; never exposed to browser)
ADMIN_KEY=$ADMIN_KEY
BL_API_TOKEN=$BL_TOKEN

# WebAuthn RP
RP_ID=$HOSTNAME
ORIGIN=https://$HOSTNAME

# APISIX admin API (shared docker network)
APISIX_ADMIN_URL=http://bl-apisix:9180/apisix/admin

# Proxy project (mounted read-only at /bl-proxy)
ROLES_JSON=/bl-proxy/manifest/roles.json
POLICY_GENERATOR=/bl-proxy/scripts/generate-policy-lua.py

# docker-compose variable substitution
PROXY_DIR=$PROXY_DIR
APISIX_NETWORK=bl-api-proxy_apisix-net
EOF

echo "[+] .env written (mode 600) — RP_ID=$HOSTNAME"
echo
echo "=== one-time setup token (use this to enroll the first admin) ==="
echo "    $BOOTSTRAP_TOKEN"
echo
echo "=== verify (lengths only) ==="
echo "SESSION_SECRET:       ${#SESSION_SECRET} chars"
echo "ADMIN_BOOTSTRAP_TOKEN:${#BOOTSTRAP_TOKEN} chars"
echo "ADMIN_KEY:            ${#ADMIN_KEY} chars"
echo "BL_API_TOKEN:         ${#BL_TOKEN} chars"
