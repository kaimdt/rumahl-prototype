#!/bin/bash
# rumahl Full Dev Mode - Unix Launcher
# Starts both Vite dev server and rumahl-home backend

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$SCRIPT_DIR/start-full.mjs" "$@"
