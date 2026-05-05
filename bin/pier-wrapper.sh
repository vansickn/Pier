#!/bin/bash
# Standalone Pier CLI wrapper. Installed into /usr/local/bin/pier (or another
# directory on PATH). Resolves Pier.app at runtime and runs the CLI script
# through Pier's bundled Electron in node mode, so users don't need a system
# Node installation for the CLI to work.
set -e

APP_DIRS=(
  "/Applications/Pier.app"
  "$HOME/Applications/Pier.app"
)

APP_DIR=""
for candidate in "${APP_DIRS[@]}"; do
  if [ -d "$candidate" ]; then
    APP_DIR="$candidate"
    break
  fi
done

if [ -z "$APP_DIR" ]; then
  echo "pier: Pier.app not found in /Applications or ~/Applications" >&2
  echo "      Install it from https://github.com/vansickn/Pier" >&2
  exit 1
fi

ELECTRON="$APP_DIR/Contents/MacOS/Electron"
CLI="$APP_DIR/Contents/Resources/app/bin/pier.js"

if [ ! -x "$ELECTRON" ] || [ ! -f "$CLI" ]; then
  echo "pier: Pier.app at $APP_DIR looks corrupted (missing Electron or CLI)." >&2
  echo "      Try reinstalling." >&2
  exit 1
fi

exec env ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$CLI" "$@"
