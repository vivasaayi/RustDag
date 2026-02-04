# iOS Simulator: wrapping the web UI in Capacitor

This project is a desktop app using Tauri for macOS; for the iOS simulator we wrap the Vite-built web UI into a simple Capacitor iOS app and use the backend running on your Mac for API calls.

Important notes
- You cannot run the Java backend inside iOS; the web UI must talk to an HTTP API. In the simulator you can access your host machine at `http://localhost`.
- Ensure the backend is running before starting the iOS app.

Prereqs
- macOS with Xcode installed
- Node, npm
- `npx` (included with npm)

Quick steps

1. Run the Java backend (from repo root):

```bash
cd backend
./gradlew clean build
java -jar build/libs/backend.jar --port 7000
```

2. Build UI and create Capacitor iOS app (from `ui` dir):

```bash
cd ui
npm install
npm run build
./prepare_ios.sh
```

3. Xcode will open. In Xcode:
   - Choose an iPhone simulator as the target
   - If your UI uses http://localhost, add App Transport Security exception to allow local http requests
     - In the left project tree, open `App/Info.plist` and add:

```xml
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsLocalNetworking</key>
  <true/>
</dict>
```

  (Alternatively: add NSAllowsArbitraryLoads = true for debugging.)

4. Build & Run in simulator (⌘R). The UI will load local assets and your backend at `http://localhost:7000`.

Troubleshooting
- If fetches to `localhost` fail, confirm the backend is running and not blocked by firewall.
- iOS Simulator maps `localhost` to host machine; Android emulator uses `10.0.2.2`.

Embedding the backend inside the app (one combined unit)
------------------------------------------------------

If you want the frontend and backend packaged as one unit so the app works without any external backend running on your Mac, there are two practical options:

1) Native plugin / native backend (recommended)
   - Port the backend logic to iOS-native code (Swift or Rust) and expose methods to the web UI via a Capacitor plugin or direct bridge. This avoids running an HTTP server inside the app and is the most app-store friendly approach.
   - Pros: Best performance, secure & App Store friendly, easy to call from JS.
   - Cons: Requires rewriting or porting Java code to Swift/Rust.

2) Embedded HTTP server in the app
   - Embed a small HTTP server inside the app and run the Java-like backend as native code that responds to HTTP requests from the web UI in the embedded WKWebView. On iOS this typically means implementing the backend endpoints in Swift (or Rust) and using a tiny web server library.
   - Example small server: GCDWebServer (https://github.com/swisspol/GCDWebServer) — easy to use and integrates via CocoaPods.
   - Pros: Keeps the same HTTP API surface; frontend unchanged.
   - Cons: Requires porting Java logic to Swift (or reimplementing behavior), and adds an extra HTTP server layer.

Which approach suits you?
- If you prefer a minimal port and to keep the web UI code unchanged, choose the "Embedded HTTP server" approach and I can provide a ready-to-drop example using GCDWebServer and an example Swift file that implements `/healthcheck` and `/execute-graph`.
- If you want a more robust integration that feels native and avoids HTTP and its pitfalls, I recommend a Capacitor native plugin with your backend logic ported to Swift — I can scaffold that too.

Implementation example (embedded server)
--------------------------------------
Below is a concise Swift example you can add into the Xcode iOS project (inside `ios/App/`) to start a tiny server with two endpoints used by the UI.

1) Add the Pod to `ios/Podfile` (inside the Xcode project created by Capacitor):

```ruby
pod 'GCDWebServer', '~> 3.5'
```

2) Example Swift implementation (add as `LocalBackend.swift`):

```swift
import Foundation
import GCDWebServer

final class LocalBackend {
  static let shared = LocalBackend()
  private let server = GCDWebServer()

  private init() {
    server.addHandler(forMethod: "GET", path: "/healthcheck", request: GCDWebServerRequest.self) { _ in
      return GCDWebServerDataResponse(jsonObject: ["status": "ok"])!
    }

    server.addHandler(forMethod: "POST", path: "/execute-graph", request: GCDWebServerDataRequest.self) { request in
      guard let body = request?.data else { return GCDWebServerResponse(statusCode: 400) }
      // TODO: Deserialize `body` JSON and run equivalent logic here.
      // For now, just echo back the JSON with a fake result.
      if let json = try? JSONSerialization.jsonObject(with: body, options: []) as? [String: Any] {
        let result: [String: Any] = ["ok": true, "input": json, "result": "executed-in-iOS"]
        return GCDWebServerDataResponse(jsonObject: result)!
      }
      return GCDWebServerResponse(statusCode: 500)
    }
  }

  func start() {
    do {
      try server.start(options: [GCDWebServerOption_Port: 7000, GCDWebServerOption_BindToLocalhost: true])
      print("Local backend started: \(server.serverURL?.absoluteString ?? "unknown")")
    } catch {
      print("Local backend failed to start: \(error)")
    }
  }

  func stop() {
    server.stop()
  }
}
```

3) Start `LocalBackend.shared.start()` in `SceneDelegate` or `AppDelegate` when app launches.

Now the web UI inside WKWebView/Capacitor can continue to use `http://localhost:7000` and talk to the embedded backend — so the whole stack is inside the app.

If you want, I can add a working GCDWebServer Xcode patch to the generated iOS project and wire up the `ui/src/nativeBackend.js` wrapper so the UI calls the bundled backend automatically.

