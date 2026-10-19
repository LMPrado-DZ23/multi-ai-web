#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -f config.json ]; then
  cp config.example.json config.json
  echo "Created config.json from config.example.json. Start your bridges, then rerun this script."
fi
node src/index.mjs check --config config.json
exec node src/index.mjs serve --config config.json
