#!/usr/bin/env bash
# IORA Dev Runner — Start interactive development manager
# Requires Node.js >= 18
cd "$(dirname "$0")/.." || exit 1
exec node dev/iora-dev.mjs "$@"
