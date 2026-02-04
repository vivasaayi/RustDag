llm-dag — Rust LLM DAG prototype
=================================

This folder contains a small Rust prototype of an LLM DAG executor and an HTTP shim used by the UI.

What it provides
- a simple DAG data model (`nodes`, `edges`) in `src/dag.rs`
- a topological executor (no parallelism yet) that executes each node in order
- a `llm` node type wired to `src/runner.rs` which currently provides a stub response
- an HTTP shim (`/execute-graph`) in `src/main.rs` that accepts JSON graph payloads

Next step — enable a real on-device LLM (llama.cpp / ggml)
---------------------------------------------------------
We intended to use a Rust wrapper for llama.cpp (e.g., `llama-rs` or another GGML wrapper) to run models on-device.

Plan for enabling `llama` support:
1. Add a dependency for the chosen wrapper in `Cargo.toml` (under `[dependencies]`) and make it optional under `[features]` (e.g., feature `llama`).
2. Implement the LLama adapter inside `src/runner.rs` using `#[cfg(feature = "llama")]` or a separate `llama_impl` module. The adapter should:
   - initialize/load a GGML model from the configured model path
   - accept a prompt and optional context/state, run the model, and return generated text
   - provide token/batch settings and timeout options for embedded devices
3. Wire the adapter in `execute_node` (already delegating to `runner::run_llm`) so the real runner is used when `--features llama` is enabled.

Example run (stub)
------------------
From repo root:

```bash
cargo run -p llm-dag
# POST a graph
curl -X POST http://127.0.0.1:9090/execute-graph -H 'Content-Type: application/json' \
  -d '{"graph":{"nodes":[{"id":"n1","typ":"llm","params":{"prompt":"Hello"}}],"edges":[]}}'
```

Notes about deployment to edge/mobile
- For iOS, you'll want the Rust library compiled as a static lib and called from Swift or a Capacitor plugin.
- On macOS and Linux, the crate can be used as a local binary or embedded service.

If you'd like, I can implement the llama adapter directly (I recommend targeting the `llama-rs` / ggml wrapper you prefer) and add a simple model-run example using a small GGML model.
