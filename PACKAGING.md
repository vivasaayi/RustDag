# Packaging the Workflow AI Builder

This document describes how to build and package the desktop app with Tauri, combining the React UI and Rust workflow engine into a single native application.

## Prerequisites
- Rust toolchain (1.70+)
- Node.js + npm
- macOS / Windows / Linux with build tools

## Development Build

```bash
# Build UI (runs hot reload with Vite)
cd ui
npm install
npm run tauri:dev
```

This launches the Tauri dev environment, which:
1. Starts the Rust backend (llm-dag) on port 9091
2. Loads the UI with hot-reload
3. Bridges UI ↔ Backend via HTTP

## Production Build

```bash
# From repository root
cd ui
npm run tauri:build
```

This produces:
- **macOS**: `.dmg` installer in `ui/src-tauri/target/release/bundle/dmg/`
- **Windows**: `.msi` installer in `ui/src-tauri/target/release/bundle/msi/`
- **Linux**: `.AppImage` in `ui/src-tauri/target/release/bundle/appimage/`

The Rust backend is automatically compiled and embedded in the binary.

## How It Works

The Tauri configuration (`ui/src-tauri/tauri.conf.json`) specifies:
- The React UI as the frontend (built with Vite)
- The Rust backend (llm-dag) which Tauri spawns as a sidecar
- Platform-specific icons and metadata

The frontend communicates with the backend via HTTP on port 9091 (same as dev).

## Customization

### App Icon
Replace icons in `ui/src-tauri/icons/`:
- `icon.icns` - macOS
- `icon.ico` - Windows
- `icon.png` - Linux

### Metadata
Edit `ui/src-tauri/tauri.conf.json`:
```json
{
  "build": {
    "productName": "Workflow AI Builder",
    "devUrl": "http://localhost:5173",
    "frontendDist": "../../dist"
  },
  "app": {
    "version": "0.1.0",
    "windows": [{ "title": "Workflow AI Builder" }]
  }
}
```

## Notes
- The Rust backend (`llm-dag`) is compiled with `--release` for production
- All dependencies are statically linked in the binary
- API keys are stored securely using OS Keychain (see llm-dag/src/main.rs)
- For distribution, code-sign the app (macOS) or get an EV certificate (Windows)