#!/usr/bin/env bash
# Deploy ops-hub, ops-mcp, and ops-assistant to Posit Connect, in order.
# Usage: ./scripts/deploy.sh <rsconnect-server-nickname>
set -euo pipefail
cd "$(dirname "$0")/.."
SERVER="${1:?Give the rsconnect server nickname, for example: ./scripts/deploy.sh myserver}"
RSC=(uvx --from 'rsconnect-python>=1.29' rsconnect)
SETTINGS=(uvx --from 'rsconnect-python>=1.29' python scripts/connect_settings.py "$SERVER")

./scripts/sync-shared.sh
(cd apps/ops-hub && npm install --silent)
(cd apps/ops-mcp && npm install --silent)

echo "==> ops-hub"
HUB=$("${RSC[@]}" deploy nodejs -n "$SERVER" --quiet --title "Fleet Ops Hub" -x node_modules apps/ops-hub)
HUB_URL=$("${SETTINGS[@]}" "$HUB" fleet-ops-hub 1)
echo "    $HUB_URL"

echo "==> ops-mcp"
MCP=$("${RSC[@]}" deploy nodejs -n "$SERVER" --quiet --title "Fleet Ops MCP Server" -x node_modules -E "OPS_HUB_URL=$HUB" apps/ops-mcp)
MCP_URL=$("${SETTINGS[@]}" "$MCP" fleet-ops-mcp 3)
echo "    $MCP_URL"

echo "==> ops-assistant"
ASSIST=$("${RSC[@]}" deploy shiny -n "$SERVER" --quiet --title "Fleet Ops Assistant" -x .venv -E "OPS_MCP_URL=${MCP%/}/mcp" apps/ops-assistant)
ASSIST_URL=$("${SETTINGS[@]}" "$ASSIST" fleet-ops-assistant 3)
echo "    $ASSIST_URL"
