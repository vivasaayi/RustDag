# iOS Simulator: wrapping the web UI in Capacitor

This project is a desktop app using Tauri for macOS; for the iOS simulator we wrap the Vite-built web UI into a simple Capacitor iOS app and use the Rust backend running on your Mac for API calls.

## Important Notes
- The Rust backend (llm-dag) must be running before starting the iOS app
- In the simulator, you access your host machine at `http://localhost`
- All HTTP calls go to port 9091 (the Rust backend)

## Prerequisites
- macOS with Xcode installed
- Node, npm, `npx`
- Rust toolchain (for building the backend)

## Quick Steps

1. Run the Rust backend (from repo root):

```bash
cd llm-dag
cargo run --release
# Backend will be available at http://localhost:9091
```

2. Build UI and create Capacitor iOS app (from `ui` dir):

```bash
cd ui
npm install
npm run build
./prepare_ios.sh
```

3. In Xcode:
   - Choose an iPhone simulator as the target
   - Add App Transport Security exception to allow local HTTP requests
   - In the left project tree, open `App/Info.plist` and add:

```xml
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsLocalNetworking</key>
  <true/>
</dict>
```

4. Build & Run in simulator (⌘R). The UI will load and communicate with your backend at `http://localhost:9091`.

## Troubleshooting
- If fetches to `localhost` fail, confirm the backend is running and not blocked by firewall
- iOS Simulator maps `localhost` to host machine; Android emulator uses `10.0.2.2`

## Embedding the Backend in the App

If you want a fully self-contained app without external backend dependencies, you can embed the Rust backend using a Capacitor native plugin:

1) **Rust via Capacitor Plugin (Recommended)**
   - Compile the Rust engine as an iOS framework
   - Expose methods to the web UI via Capacitor plugin
   - The `llm-dag` Rust code can be compiled for iOS targets using `cargo-xcode`
   - Pros: Same workflow engine everywhere, best performance, native integration
   - Cons: Requires iOS Rust compilation setup

2) **Minimal HTTP Server (Alternative)**
   - Use a lightweight HTTP server library (e.g., GCDWebServer)
   - Run the embedded backend as native code responding to HTTP requests
   - Pros: Minimal porting, keeps HTTP API surface the same
   - Cons: Extra HTTP layer, duplicated logic

The current `nativeBackend.js` already has fallback patterns for Capacitor plugins, so integrating the Rust engine via iOS native code is the most aligned approach.

