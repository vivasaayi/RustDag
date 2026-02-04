#!/usr/bin/env bash
set -euo pipefail

# Helper script to prepare an iOS app wrapper using Capacitor and open Xcode.
# Run this from the `ui` folder (it will initialize Capacitor, add iOS, copy assets,
# and open the iOS project in Xcode so you can launch the iOS simulator).

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)
cd "$ROOT_DIR"

echo "Ensure you have the Java backend running on http://localhost:7000 before launching the simulator."

echo "Installing Capacitor CLI + core (if not present)..."
npm install --no-audit --no-fund --save-dev @capacitor/core @capacitor/cli >/dev/null

if [[ ! -d "node_modules/@capacitor/ios" ]]; then
  echo "Capacitor iOS package not found — installing @capacitor/ios..."
  npm install --no-audit --no-fund --save-dev @capacitor/ios >/dev/null
fi

echo "Building web assets (Vite)..."
npm run build

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required but not found. Install Node/npm first." >&2
  exit 1
fi

if [[ ! -d "ios" ]]; then
  echo "Initializing Capacitor project and adding iOS platform..."
  npx cap init "Desktop AI Builder" com.example.desktopai --web-dir=dist
  npx cap add ios
else
  echo "iOS platform already present — skipping 'cap add ios'."
fi

echo "Copying web build to iOS project..."
npx cap copy ios

echo "Opening iOS project in Xcode..."
npx cap open ios

echo "Done. In Xcode: set a simulator target and run the app."
