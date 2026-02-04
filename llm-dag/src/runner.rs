use serde_json::Value;
use std::collections::HashMap;
use crate::models;

#[cfg(feature = "llama")]
use llama_cpp_2::{
    context::params::LlamaContextParams,
    llama_backend::LlamaBackend,
    llama_batch::LlamaBatch,
    model::params::LlamaModelParams,
    model::AddBos,
    model::LlamaModel,
    model::Special,
    token::data_array::LlamaTokenDataArray,
};

/// LLM runner abstraction.
/// Uses stub if llama feature not enabled.
/// With llama feature, uses llama-cpp-2 for GGUF models.

pub async fn run_llm(prompt: &str, _state: &HashMap<String, Value>, node_id: &str) -> Value {
    #[cfg(feature = "llama")]
    {
        // Try to use tinyllama if downloaded
        let model_name = "tinyllama-1.1b-chat-v1.0.Q4_0.gguf";
        let model_path = models::get_models_dir().join(model_name);
        if model_path.exists() {
            match load_and_generate(&model_path, prompt).await {
                Ok(text) => return serde_json::json!({
                    "text": text,
                    "model": model_name,
                }),
                Err(e) => {
                    eprintln!("LLM error: {}", e);
                    // Fall back to stub
                }
            }
        }
    }

    // Stub fallback
    serde_json::json!({
        "text": format!("[stub reply from node {} -> {}]", node_id, prompt),
        "model": "stub",
    })
}

#[cfg(feature = "llama")]
async fn load_and_generate(model_path: &std::path::Path, prompt: &str) -> Result<String, Box<dyn std::error::Error>> {
    // Initialize backend
    let backend = LlamaBackend::init()?;

    // Load model
    let model_params = LlamaModelParams::default();
    let model = LlamaModel::load_from_file(&backend, model_path, &model_params)?;

    // Create context
    let ctx_params = LlamaContextParams::default().with_n_ctx(Some(std::num::NonZeroU32::new(512).unwrap()));
    let mut ctx = model.new_context(&backend, ctx_params)?;

    // Tokenize prompt
    let tokens = model.str_to_token(prompt, AddBos::Always)?;

    // Create batch
    let mut batch = LlamaBatch::new(512, 1);

    // Add tokens to batch
    let mut n_cur = 0;
    for (i, &token) in tokens.iter().enumerate() {
        let is_last = i == tokens.len() - 1;
        batch.add(token, n_cur, &[0], is_last)?;
        n_cur += 1;
    }

    // Decode initial batch
    ctx.decode(&mut batch)?;

    // Generate up to 100 tokens
    let mut output = String::new();
    let mut n_generated = 0;
    while n_generated < 100 {
        // Sample next token
        let candidates = ctx.candidates_ith(batch.n_tokens() - 1);
        let mut candidates_array = LlamaTokenDataArray::from_iter(candidates, false);
        let next_token = candidates_array.sample_token(rand::random::<u32>());

        if next_token == model.token_eos() {
            break;
        }

        // Add to output
        let token_str = model.token_to_str(next_token, Special::Tokenize)?;
        output.push_str(&token_str);

        // Add to batch for next decode
        batch.clear();
        batch.add(next_token, n_cur, &[0], true)?;
        n_cur += 1;

        // Decode
        ctx.decode(&mut batch)?;

        n_generated += 1;
    }

    Ok(output)
}
