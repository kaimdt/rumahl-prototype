#!/usr/bin/env bash
# rumahl Dev Runner — Start interactive development manager
# Requires Node.js >= 18
cd "$(dirname "$0")/.." || exit 1
exec node dev/rumahl-dev.mjs "$@"
