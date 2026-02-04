use serde_json::Value;
use std::collections::HashMap;

/// LLM runner abstraction.
///
/// Default (no feature) returns a stub response. Enable `llama` feature and implement the
/// llama adapter to run real on-device models (llama.cpp / ggml via a Rust wrapper).

pub async fn run_llm(prompt: &str, _state: &HashMap<String, Value>, node_id: &str) -> Value {
    // Default stub: echo prompt with a short generated text.
    let out = serde_json::json!({
        "text": format!("[llm={} generated reply to: {}]", node_id, prompt),
        "model": "stub",
    });
    out
}

// If compiled with the `llama` feature we will include a real runner implementation.
// The actual integration with llama-rs/llama.cpp will be implemented under this cfg.
#[cfg(feature = "llama")]
pub mod llama_impl {
    // Placeholder for a real llama-rs implementation
    // When the feature is turned on the adapter should initialize a model and expose
    // an async API similar to run_llm above.
}
