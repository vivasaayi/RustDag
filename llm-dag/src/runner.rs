use serde_json::Value;
use std::collections::HashMap;
use crate::secrets;
#[cfg(feature = "llama")]
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
///
/// Priority order:
/// 1. OpenAI API — if `OPENAI_API_KEY` secret is set (uses `OPENAI_MODEL` secret, defaults to gpt-4o-mini)
/// 2. Ollama — if `OLLAMA_API_URL` secret is set (uses `OLLAMA_MODEL` secret, defaults to llama3)
/// 3. Local llama.cpp model — if `llama` feature is compiled and a GGUF model is downloaded
/// 4. Stub — returns a placeholder response

pub async fn run_llm(prompt: &str, _state: &HashMap<String, Value>, node_id: &str) -> Value {
    // 1. OpenAI
    if let Ok(Some(api_key)) = secrets::get_secret("OPENAI_API_KEY") {
        let model = secrets::get_secret("OPENAI_MODEL")
            .ok()
            .flatten()
            .unwrap_or_else(|| "gpt-4o-mini".to_string());
        match call_openai(&api_key, &model, prompt).await {
            Ok(text) => return serde_json::json!({ "text": text, "model": model }),
            Err(e) => log::warn!("OpenAI call failed for node {node_id}: {e}"),
        }
    }

    // 2. Ollama
    if let Ok(Some(ollama_url)) = secrets::get_secret("OLLAMA_API_URL") {
        let model = secrets::get_secret("OLLAMA_MODEL")
            .ok()
            .flatten()
            .unwrap_or_else(|| "llama3".to_string());
        match call_ollama(&ollama_url, &model, prompt).await {
            Ok(text) => return serde_json::json!({ "text": text, "model": model }),
            Err(e) => log::warn!("Ollama call failed for node {node_id}: {e}"),
        }
    }

    // 3. Local llama.cpp
    #[cfg(feature = "llama")]
    {
        let model_name = "tinyllama-1.1b-chat-v1.0.Q4_0.gguf";
        let model_path = models::get_models_dir().join(model_name);
        if model_path.exists() {
            match load_and_generate(&model_path, prompt).await {
                Ok(text) => return serde_json::json!({ "text": text, "model": model_name }),
                Err(e) => log::warn!("llama.cpp inference failed for node {node_id}: {e}"),
            }
        }
    }

    // 4. Stub fallback — log clearly so it's not mistaken for real output
    log::warn!("node {node_id}: no LLM configured, returning stub response. Set OPENAI_API_KEY or OLLAMA_API_URL in secrets.");
    serde_json::json!({
        "text": format!("[no LLM configured — stub reply for node {node_id}]"),
        "model": "stub",
    })
}

async fn call_openai(api_key: &str, model: &str, prompt: &str) -> Result<String, String> {
    let body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": prompt}]
    });

    let response = reqwest::Client::new()
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("OpenAI API error {status}: {text}"));
    }

    let json: Value = response.json().await.map_err(|e| e.to_string())?;
    json.pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "unexpected OpenAI response shape".to_string())
}

async fn call_ollama(base_url: &str, model: &str, prompt: &str) -> Result<String, String> {
    let url = format!("{}/api/generate", base_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": model,
        "prompt": prompt,
        "stream": false
    });

    let response = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Ollama API error {status}: {text}"));
    }

    let json: Value = response.json().await.map_err(|e| e.to_string())?;
    json.get("response")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "unexpected Ollama response shape".to_string())
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
