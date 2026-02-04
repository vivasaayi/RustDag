# Tauri Integration Notes

Put the native backend binary in `src-tauri/bin/backend`.

The `src-tauri/src/main.rs` spawns `src-tauri/bin/backend` when present and does not block.

Dev flow:
1. Build backend native-image: `cd backend && ./scripts/prepare_native_image.sh`
2. Build UI and start Tauri dev: `cd ui && npm install && npm run tauri:dev`

Packaging flow (macOS): run from repository root:

```bash
chmod +x package-tauri-macos.sh
./package-tauri-macos.sh
```

`tauri.conf.json` references icons present in `src-tauri/icons` for mac packaging; replace `icon.icns` with a real icon for distribution.
