use std::path::PathBuf;
use std::fs;
use reqwest::Client;
use tokio::io::AsyncWriteExt;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub name: String,
    pub url: String,
    pub size_mb: u64,
    pub description: String,
}

pub fn get_available_models() -> Vec<ModelInfo> {
    vec![
        ModelInfo {
            name: "tinyllama-1.1b-chat-v1.0.Q4_0.gguf".to_string(),
            url: "https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_0.gguf".to_string(),
            size_mb: 637,
            description: "TinyLlama 1.1B Chat, quantized for mobile".to_string(),
        },
        ModelInfo {
            name: "phi-2.Q4_0.gguf".to_string(),
            url: "https://huggingface.co/TheBloke/phi-2-GGUF/resolve/main/phi-2.Q4_0.gguf".to_string(),
            size_mb: 1620,
            description: "Microsoft Phi-2, 2.7B parameters, quantized".to_string(),
        },
        // Add more as needed
    ]
}

pub fn get_models_dir() -> PathBuf {
    dirs::home_dir().unwrap().join(".llm-dag").join("models")
}

pub fn is_model_downloaded(model_name: &str) -> bool {
    let path = get_models_dir().join(model_name);
    path.exists()
}

pub async fn download_model(model: &ModelInfo) -> Result<(), Box<dyn std::error::Error>> {
    let client = Client::new();
    let mut response = client.get(&model.url).send().await?;
    let models_dir = get_models_dir();
    fs::create_dir_all(&models_dir)?;
    let path = models_dir.join(&model.name);
    let mut file = tokio::fs::File::create(&path).await?;
    while let Some(chunk) = response.chunk().await? {
        file.write_all(&chunk).await?;
    }
    Ok(())
}