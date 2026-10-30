#!/usr/bin/env bash
# Copy shared/ into each Node app's lib/ folder.
# Connect deploys each app folder as its own bundle, so shared code must
# live inside the folder. Run this after you edit anything in shared/.
set -euo pipefail
cd "$(dirname "$0")/.."
for app in apps/ops-hub apps/ops-mcp; do
  rm -rf "$app/lib"
  mkdir -p "$app/lib"
  cp shared/fleet.js shared/bulletins.js "$app/lib/"
done
for app in apps/ops-hub apps/ops-mcp; do cp -R shared/brand "$app/lib/brand"; done
echo "Synced shared/ into apps/ops-hub/lib and apps/ops-mcp/lib"
# The Python assistant serves brand assets from www/.
mkdir -p apps/ops-assistant/www
rm -rf apps/ops-assistant/www/fonts apps/ops-assistant/www/logos
cp -R shared/brand/fonts shared/brand/logos shared/brand/posit-tokens.css apps/ops-assistant/www/
