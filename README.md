# Workflow AI Builder

A cross-platform desktop app that lets users visually build and execute workflows with AI/LLM integration. Built with a Rust-based workflow engine and React UI.

## Goals
- UI builder (drag & drop nodes, inspector, save/load workflows)
- Rust-based workflow engine with support for async execution, human-in-the-loop approval, and LLM integration
- Extensible executor system for API calls, databases, AI models, cloud services
- Bundle into a single desktop app (macOS .dmg / Windows .exe / Linux .AppImage) with Tauri

## Architecture
1. **UI** (React + React Flow) — visual workflow editor with property inspector and metadata panel
2. **Backend** (Rust — `llm-dag`) — RESTful API server that executes workflows with support for:
   - Token-based data flow between nodes
   - Parallel splits, exclusive/multi-choice routing, merge strategies
   - Human-in-the-loop approval/pause nodes
   - LLM agents with streaming support
   - External executors (API calls, databases, email, cloud services, etc.)
3. **Packaging** — Tauri desktop app with embedded Rust backend

## Key Components
- **llm-dag**: Rust workflow engine with executors
- **ui**: React + Vite frontend with Tauri integration
- **Capacitor**: iOS support (wraps web UI for simulator/device)

## Quick Run (Dev Mode)
1. Rust backend: `cd llm-dag && cargo run` (runs on `http://localhost:9091`)
2. UI: `cd ui && npm install && npm run tauri:dev`

## Workflow Execution
- UI exports workflow definitions as JSON (nodes + edges + properties)
- Backend executes via token-based data flow through the workflow DAG
- Supports pausing at approval/trigger nodes and resuming with user decisions
- Returns execution results and events (success, error, waiting, etc.)

## Packaging & Distribution
The app is packaged using **Tauri**, which bundles:
- React-built web UI
- Rust backend compiled as native binary
- Platform-specific installers (.dmg, .msi, .AppImage)

Build command: `cd ui && npm run tauri:build`

## Security & Configuration
- API keys stored securely using OS Keychain (not hardcoded in binary)
- Settings panel for managing secrets and templates
- Support for multiple deployment profiles

## Execution Engines Supported
- **LLM Agents** — OpenAI, Ollama (local)
- **API Calls** — HTTP/REST with custom headers
- **Databases** — MySQL, PostgreSQL, MongoDB
- **Email** — SMTP-based mail sending
- **Cloud** — AWS (S3, SQS, Kinesis, CloudWatch), Kubernetes
- **System** — Process execution, file operations
- **Custom** — Inline scripts and templates
