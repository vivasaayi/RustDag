use aes_gcm::aead::{Aead, OsRng};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SecretEntry {
    nonce: String,
    ciphertext: String,
}

fn app_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".llm-dag")
}

fn key_path() -> PathBuf {
    app_dir().join("secrets.key")
}

fn store_path() -> PathBuf {
    app_dir().join("secrets.enc.json")
}

fn ensure_key() -> Result<Vec<u8>, String> {
    let path = key_path();
    if path.exists() {
        let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
        return B64.decode(raw.trim()).map_err(|e| e.to_string());
    }

    fs::create_dir_all(app_dir()).map_err(|e| e.to_string())?;
    let mut key = vec![0_u8; 32];
    OsRng.fill_bytes(&mut key);
    let mut file = fs::File::create(key_path()).map_err(|e| e.to_string())?;
    file.write_all(B64.encode(&key).as_bytes()).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(key_path(), fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    }
    Ok(key)
}

fn load_store() -> Result<HashMap<String, SecretEntry>, String> {
    let path = store_path();
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let raw = fs::read(path).map_err(|e| e.to_string())?;
    serde_json::from_slice(&raw).map_err(|e| e.to_string())
}

fn save_store(store: &HashMap<String, SecretEntry>) -> Result<(), String> {
    fs::create_dir_all(app_dir()).map_err(|e| e.to_string())?;
    let mut file = fs::File::create(store_path()).map_err(|e| e.to_string())?;
    let data = serde_json::to_vec_pretty(store).map_err(|e| e.to_string())?;
    file.write_all(&data).map_err(|e| e.to_string())
}

fn encrypt_value(plain: &str) -> Result<SecretEntry, String> {
    let key = ensure_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let mut nonce_bytes = [0_u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let encrypted = cipher
        .encrypt(nonce, plain.as_bytes())
        .map_err(|e| e.to_string())?;
    Ok(SecretEntry {
        nonce: B64.encode(nonce_bytes),
        ciphertext: B64.encode(encrypted),
    })
}

fn decrypt_value(entry: &SecretEntry) -> Result<String, String> {
    let key = ensure_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let nonce_raw = B64.decode(&entry.nonce).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(&nonce_raw);
    let ciphertext = B64.decode(&entry.ciphertext).map_err(|e| e.to_string())?;
    let plain = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|e| e.to_string())?;
    String::from_utf8(plain).map_err(|e| e.to_string())
}

pub fn set_secret(name: &str, value: &str) -> Result<(), String> {
    let mut store = load_store()?;
    store.insert(name.to_string(), encrypt_value(value)?);
    save_store(&store)
}

pub fn get_secret(name: &str) -> Result<Option<String>, String> {
    let store = load_store()?;
    let Some(entry) = store.get(name) else {
        return Ok(None);
    };
    Ok(Some(decrypt_value(entry)?))
}

pub fn delete_secret(name: &str) -> Result<(), String> {
    let mut store = load_store()?;
    store.remove(name);
    save_store(&store)
}

pub fn list_secrets() -> Result<Vec<String>, String> {
    let store = load_store()?;
    let mut keys: Vec<String> = store.keys().cloned().collect();
    keys.sort();
    Ok(keys)
}

pub fn resolve_secret_refs(value: &mut serde_json::Value) -> Result<(), String> {
    match value {
        serde_json::Value::String(text) => {
            if let Some(name) = text.strip_prefix("secret://") {
                let Some(secret) = get_secret(name)? else {
                    return Err(format!("secret not found: {name}"));
                };
                *value = serde_json::Value::String(secret);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                resolve_secret_refs(item)?;
            }
        }
        serde_json::Value::Object(map) => {
            for item in map.values_mut() {
                resolve_secret_refs(item)?;
            }
        }
        _ => {}
    }
    Ok(())
}
