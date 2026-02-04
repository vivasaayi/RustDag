#!/usr/bin/env bash
set -euo pipefail

# Top-level packaging helper for macOS using Tauri + GraalVM
REPO_ROOT=$(cd "$(dirname "$0")" && pwd)
cd "$REPO_ROOT/ui"

# 1) Build UI
echo "Building React UI..."
npm install
npm run build

# 2) Build native backend and copy to Tauri bin
echo "Preparing native backend binary..."
cd "$REPO_ROOT/backend"
chmod +x scripts/prepare_native_image.sh
set +e
./scripts/prepare_native_image.sh || true
set -e

# 3) Build Tauri app
cd "$REPO_ROOT/ui"
# Ensure Tauri CLI is available; otherwise recommend installation
if command -v tauri >/dev/null 2>&1; then
  npm run tauri:build
else
  echo "tauri CLI not available globally; running via npx from ui/";
  npx --prefix ui tauri build
fi

# Ensure create-dmg is available for macOS bundling (Tauri uses it to create .dmg)
if ! command -v create-dmg >/dev/null 2>&1; then
  echo "create-dmg not found. Trying to install via Homebrew..."
  if command -v brew >/dev/null 2>&1; then
    brew install create-dmg
  else
    echo "Homebrew not found — install create-dmg manually: npm i -g create-dmg" >&2
    exit 1
  fi
fi

echo "Tauri macOS build complete. Check dist for the .dmg or .app."