# Tauri Integration Notes

## How the Rust Backend is Integrated

The Tauri configuration uses Cargo's build system to compile the Rust backend (`llm-dag`) alongside the Tauri app.

The `src-tauri/Cargo.toml` workspace includes:
- `llm-dag` — the workflow engine
- `src-tauri` — the Tauri shell

When you run `npm run tauri:build`, Cargo compiles the Rust backend with the UI and packages everything into a single native executable.

## Development Flow

```bash
cd ui
npm install
npm run tauri:dev
```

This:
1. Compiles the Rust backend (`llm-dag`) in debug mode
2. Runs Tauri's dev server with hot-reload
3. The backend listens on `http://localhost:9091`
4. The UI connects to `http://localhost:9091`

## Production Build

```bash
cd ui
npm run tauri:build
```

Produces platform-specific installers with the backend embedded.

## Customization

- **Icons**: Replace files in `src-tauri/icons/` (icon.icns, icon.ico, etc.)
- **App metadata**: Edit `tauri.conf.json`
- **Backend features**: Enable Cargo features in `src-tauri/Cargo.toml` (e.g., `llm = ["llama-cpp-2"]` for local LLM support)
