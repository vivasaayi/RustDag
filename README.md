# Desktop AI Builder — Minimal Prototype

This repository demonstrates how to build a cross-platform desktop app that lets users visually build LangGraph (LangChain4j/LangGraph4j) graphs and execute them locally.

Goals
- UI builder (drag & drop nodes, inspector, save/load graph)
- Java backend that runs graphs using LangChain4j + LangGraph4j
- Bundle into a single desktop app (macOS .dmg / Windows .exe / Linux .AppImage)

Architecture
1. UI (React + React Flow) — graph editor and property panel. UI exports a JSON representation of the graph.
2. Backend (Java — Javalin or Spring Boot) — receives graph JSON, converts to LangGraph model and runs it using LangGraph4j and LangChain4j.
3. Packaging: Use Tauri/Electron for web-based UI or JavaFX WebView to embed the UI; use jlink + jpackage or GraalVM native-image to produce single-file packages.

Key packages and libs
- Java backend: LangChain4j, LangGraph4j
- Web UI: React + reactflow (or cytoscape for richer graph layouts)
- Java server: Javalin or Spring Boot; lightweight JSON APIs
- Packaging: jpackage (JDK 17+), GraalVM native-image, Tauri or Electron

See the `backend` and `ui` directories for a minimal skeleton and sample code.

Quick run (dev mode)
1. backend: `cd backend && ./gradlew run`
2. ui: `cd ui && npm install && npm run start`

Export & run
- UI should export a JSON schema describing nodes + edges
- Backend imports that schema and creates an executable graph
- Backend returns status/outputs (or streams them as progress updates via websocket)

Packaging & distribution options

A. Pure Java (JavaFX WebView or JavaFX UI)
- Build a JavaFX-based desktop, include a `WebView` to render the React UI or write the UI with JavaFX controls.
- Use `jlink` to create a minimal runtime image that contains only required JDK modules
- Use `jpackage` to create platform installers (.dmg, .exe, .deb)

Example `jpackage` (macOS):

```bash
# create a runnable jar first
cd backend
./gradlew clean build

# jpackage: adjust paths and your jdk home
jpackage \
	--type dmg \
	--name "LangGraphBuilder" \
	--input build/libs \
	--main-jar backend.jar \
	--main-class app.Main \
	--app-version 0.1 \
	--icon assets/icon.icns
```

B. Web UI + Electron or Tauri (recommended if you want advanced UI)
- Build UI in React with React Flow
- Embed the UI in a Electron/Tauri shell
- Backend options:
	- Run the Java backend as a child process and communicate via HTTP / WebSocket / stdin
	- Or compile the Java backend to a native binary with GraalVM native-image and call it directly

Example electron main (simplified):

```js
const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');

function createWindow() {
	const win = new BrowserWindow({ width: 1200, height: 900 });
	win.loadFile('index.html');
}

app.whenReady().then(() => {
	// spawn backend
	const backend = spawn('java', ['-jar', 'backend.jar']);
	backend.stdout.on('data', (d) => console.log(d.toString()));

	createWindow();
});
```

C. GraalVM native-image
- Compile your Java backend into a single native binary. This is a good fit if you want one executable bundled.
- Requires native-image build steps and may need configuration for reflection used by LangChain4j/Http libs.

Which approach to pick?
- For a modern, complex UI: choose React + React Flow embedded in Electron/Tauri; compile backend to native if you want a single binary -> use `electron-builder` or `tauri` for final packaging.
- For a pure-Java solution with fewer moving parts: use JavaFX + jpackage.

Security & keys
- Don\'t store API keys inside the binary. Provide a secure settings window that uses the OS Keychain.

Next steps
- Wire LangGraph import and run logic
- Implement node type library and UI property editor
- Implement graph persistence# RustDag
