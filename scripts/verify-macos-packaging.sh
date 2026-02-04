#!/usr/bin/env bash
# Verify environment for macOS packaging with Tauri + GraalVM
set -euo pipefail

echo "Checking macOS packaging prerequisites..."

check() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "⚠️ $1 not found"
    return 1
  fi
  echo "✅ $1 - $(command -v $1)"
  return 0
}

MISSING=0
check java || MISSING=1
check javac || MISSING=1
check native-image || MISSING=1
check node || MISSING=1
check npm || MISSING=1
check cargo || MISSING=1
if command -v tauri >/dev/null 2>&1; then
  echo "✅ tauri - $(command -v tauri)"
else
  # check local project install via npx
  if npx --prefix ui --yes tauri --version >/dev/null 2>&1; then
    echo "✅ tauri (via npx)"
  else
    echo "⚠️ tauri not found"
    MISSING=1
  fi
fi

if [[ $MISSING -eq 1 ]]; then
  echo "\nSome prerequisites are missing. Follow these suggestions:"
  echo " - Install GraalVM and enable native-image (https://www.graalvm.org)",
  echo " - Install Node.js and npm (https://nodejs.org)",
  echo " - Install Rust toolchain (https://rustup.rs)",
  echo " - Install Tauri CLI: npm install -g @tauri-apps/cli or pnpm -g @tauri-apps/cli"
  exit 2
fi

echo "All prerequisites seem available on your machine — good to go!"

# Show versions
java -version
node --version
npm --version
native-image --version || true
cargo --version
tauri --version || true

exit 0
