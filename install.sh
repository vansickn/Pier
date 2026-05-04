#!/bin/bash
# Pier installer. One-line install:
#
#   curl -fsSL https://raw.githubusercontent.com/vansickn/Pier/main/install.sh | bash
#
# Downloads the latest Pier.app for your CPU arch from GitHub Releases,
# installs it under ~/Applications, and drops the `pier` CLI into
# /usr/local/bin so you can drive it from any terminal.
set -euo pipefail

REPO="vansickn/Pier"
INSTALL_DIR="${PIER_INSTALL_DIR:-$HOME/Applications}"
CLI_DIR="${PIER_CLI_DIR:-/usr/local/bin}"

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*" >&2; }

OS="$(uname -s)"
if [ "$OS" != "Darwin" ]; then
  red "Pier is macOS-only. Detected OS: $OS"
  exit 1
fi

ARCH="$(uname -m)"
case "$ARCH" in
  arm64)  ASSET="Pier-arm64.zip" ;;
  x86_64) ASSET="Pier-x64.zip" ;;
  *)      red "Unsupported architecture: $ARCH"; exit 1 ;;
esac

bold "▸ Resolving latest Pier release ($ARCH)…"
ASSET_URL="$(
  curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null \
    | grep -oE "https://github.com/$REPO/releases/download/[^\"]+/$ASSET" \
    | head -n1
)"

if [ -z "$ASSET_URL" ]; then
  red "Could not find $ASSET in the latest release of $REPO."
  red "Check https://github.com/$REPO/releases — a $ARCH build may not be published yet."
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

bold "▸ Downloading $(basename "$ASSET_URL")…"
curl -fsSL --progress-bar "$ASSET_URL" -o "$TMP/Pier.zip"

mkdir -p "$INSTALL_DIR"
if [ -d "$INSTALL_DIR/Pier.app" ]; then
  bold "▸ Replacing existing $INSTALL_DIR/Pier.app…"
  # Quit a running Pier so we don't yank its bundle out from under it.
  if pgrep -lf "$INSTALL_DIR/Pier.app/Contents/MacOS/Electron" >/dev/null 2>&1; then
    osascript -e 'tell application "Pier" to quit' >/dev/null 2>&1 || true
    sleep 1
    pkill -f "$INSTALL_DIR/Pier.app/Contents/MacOS/Electron" 2>/dev/null || true
  fi
  rm -rf "$INSTALL_DIR/Pier.app"
fi

bold "▸ Unpacking to $INSTALL_DIR/Pier.app…"
unzip -q "$TMP/Pier.zip" -d "$INSTALL_DIR/"

# Pier is unsigned today. The user explicitly asked for this install via
# curl|bash, so strip Gatekeeper's quarantine attribute to avoid the
# "unidentified developer" prompt on first launch.
xattr -dr com.apple.quarantine "$INSTALL_DIR/Pier.app" 2>/dev/null || true

# CLI wrapper is a self-contained shell script — works whether Pier.app lives
# in /Applications or ~/Applications.
WRAPPER_SRC="$INSTALL_DIR/Pier.app/Contents/Resources/app/bin/pier-wrapper.sh"
if [ ! -f "$WRAPPER_SRC" ]; then
  red "Bundled CLI wrapper not found at $WRAPPER_SRC — Pier.app build looks incomplete."
  exit 1
fi

CLI_TARGET="$CLI_DIR/pier"
bold "▸ Installing CLI to $CLI_TARGET…"

if [ -w "$CLI_DIR" ]; then
  install -m 0755 "$WRAPPER_SRC" "$CLI_TARGET"
else
  echo "    $CLI_DIR is not writable — requesting admin password to install the CLI…"
  sudo install -m 0755 "$WRAPPER_SRC" "$CLI_TARGET"
fi

green ""
green "✓ Pier installed."
echo
echo "  App: $INSTALL_DIR/Pier.app"
echo "       open '$INSTALL_DIR/Pier.app'"
echo "  CLI: $CLI_TARGET"
echo "       pier list"
echo
echo "  Optional: install the agent skill so AI tools can drive Pier"
echo "       pier install-skill"
echo
