# Packaging the Desktop AI Builder

This document shows three ways to package the UI + Java backend as "one desktop app" — Tauri + GraalVM (recommended), Electron + jlink/jpackage, and pure JavaFX + jpackage.

Prereqs
- JDK 21+ with jpackage available, or GraalVM with native-image
- Node.js + npm
- Rust toolchain for Tauri (if using Tauri)

Option A — Tauri (small runtime) + GraalVM native-image (single process)
1. Build UI

```bash
cd ui
npm install
npm run build
```

2. Compile Java backend to native binary (GraalVM native-image)

```bash
# Build the fat jar first
cd backend
./gradlew clean build
# Generate native binary
# NOTE: you must have GraalVM installed and native-image tool enabled
native-image --no-fallback --initialize-at-build-time -jar build/libs/backend.jar
# The above will generate a binary (backend) in the current directory
```

3. Configure Tauri to spawn the backend binary when your UI loads. Put `backend` inside `src-tauri/bin/` and reference it in code.
4. Build Tauri app for mac/win/linux

```bash
cd ui
npm run tauri build
```

Result: Single packaged app — small runtime thanks to Tauri, native backend is a single executable.

Quick automated macOS packaging
1. Ensure prerequisites — run the verification script:

```bash
./scripts/verify-macos-packaging.sh
```

2. Build + package Tauri macOS app (this builds UI, compiles a native image and packages):

```bash
chmod +x package-tauri-macos.sh
./package-tauri-macos.sh
```

This script runs the same steps as the manual flow: build UI, create native image, copy binary into `src-tauri/bin`, then call `tauri build`.

Option B — Electron + jlink/jpackage
1. Build UI as static assets (`npm run build`)
2. Build Java backend as jar

```bash
cd backend
./gradlew clean build
```

3. Use `jlink` to create a minimized runtime image

```bash
jlink --module-path $JAVA_HOME/jmods --add-modules java.base,java.logging,... --output jre
```

4. Use `jpackage` to package the runtime, jar, and the UI (copied as resources) into a single .dmg/.exe

```bash
jpackage --type dmg --name LangGraphBuilder --input build/libs --main-jar backend.jar --app-version 0.1 --resource-dir ../ui/dist --icon path/to/icon.icns
```

5. Optionally use electron to host the packaged UI; the electron process spawns Java runtime.

Option C — Pure Java (JavaFX) + jpackage
1. Write the UI with JavaFX and bind to LangChain4j directly — or use `WebView` to load local static files built from React.
2. Use `jpackage` to create native installers

```bash
./gradlew build
jpackage --name "LangGraphBuilder" --input build/libs --main-jar backend.jar --main-class app.Main --type dmg
```

Notes and tips
- Use `jlink` to reduce JRE size and include only necessary modules.
- For GraalVM build: many frameworks use reflection — check native-image configuration; use `--initialize-at-build-time` and reflection configs where needed.
 - `shadowJar` is optional: the `prepare_native_image.sh` script uses `gradle clean build` by default to produce a JAR. If you want a combined fat JAR, you can add the Shadow plugin and configure a `shadowJar` task in `backend/build.gradle.kts` then adjust `prepare_native_image.sh` to prefer it.
 - Installing GraalVM native-image on macOS:
	 - Download GraalVM for macOS from https://www.graalvm.org/releases/ and install or use SDKMAN for easier management.
	 - After installing GraalVM, enable native-image: `gu install native-image`.
	 - Add GraalVM to your PATH, e.g. `export PATH=/Library/Java/JavaVirtualMachines/graalvm-22.3.1/Contents/Home/bin:$PATH` (replace path with your distro path).
- For secure keys: use OS keychain integration — store API keys per user.
- For auto-update: consider Squirrel or electron-updater (if using Electron). Tauri has built-in updater features.

Trade-offs
- Tauri + native-image: best if you want minimal disk size and fast startup; but needs GraalVM setup and native-image configuration.
- Electron + jpackage: easier for dev, but larger app size because of Node & Chromium.
- JavaFX + jpackage: pure Java approach. Simpler for Java devs, but UI richness may be less.

Choose the option that best balances size vs development convenience.