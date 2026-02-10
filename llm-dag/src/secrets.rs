use aes_gcm::aead::{Aead, OsRng};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
#[cfg(all(feature = "os-keychain", not(target_os = "macos")))]
use std::sync::Once;

#[cfg(all(feature = "os-keychain", target_os = "macos"))]
use std::process::Command;

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

fn read_key_from_file_if_exists() -> Result<Option<Vec<u8>>, String> {
    let path = key_path();
    if path.exists() {
        let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
        let key = B64.decode(raw.trim()).map_err(|e| e.to_string())?;
        return Ok(Some(key));
    }
    Ok(None)
}

#[cfg(any(
    not(feature = "os-keychain"),
    all(feature = "os-keychain", not(target_os = "macos"))
))]
fn ensure_key_from_file() -> Result<Vec<u8>, String> {
    if let Some(key) = read_key_from_file_if_exists()? {
        return Ok(key);
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

#[cfg(not(feature = "os-keychain"))]
fn ensure_key() -> Result<Vec<u8>, String> {
    ensure_key_from_file()
}

#[cfg(all(feature = "os-keychain", target_os = "macos"))]
fn keychain_service() -> &'static str {
    "llm-dag.master-key"
}

#[cfg(all(feature = "os-keychain", target_os = "macos"))]
fn keychain_account() -> &'static str {
    "default"
}

#[cfg(all(feature = "os-keychain", target_os = "macos"))]
fn keychain_missing_item(stderr: &str) -> bool {
    stderr.contains("could not be found")
        || stderr.contains("specified item could not be found")
        || stderr.contains("The specified item could not be found")
}

#[cfg(all(feature = "os-keychain", target_os = "macos"))]
fn read_key_from_keychain() -> Result<Option<Vec<u8>>, String> {
    let output = Command::new("security")
        .args([
            "find-generic-password",
            "-a",
            keychain_account(),
            "-s",
            keychain_service(),
            "-w",
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        let raw = String::from_utf8_lossy(&output.stdout);
        let key = B64.decode(raw.trim()).map_err(|e| e.to_string())?;
        return Ok(Some(key));
    }

    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if keychain_missing_item(&stderr) {
        return Ok(None);
    }

    Err(format!("keychain read failed: {stderr}"))
}

#[cfg(all(feature = "os-keychain", target_os = "macos"))]
fn write_key_to_keychain(key: &[u8]) -> Result<(), String> {
    let encoded = B64.encode(key);
    let output = Command::new("security")
        .args([
            "add-generic-password",
            "-a",
            keychain_account(),
            "-s",
            keychain_service(),
            "-w",
            encoded.as_str(),
            "-U",
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    Err(format!("keychain write failed: {stderr}"))
}

#[cfg(all(feature = "os-keychain", target_os = "macos"))]
fn ensure_key() -> Result<Vec<u8>, String> {
    if let Some(key) = read_key_from_keychain()? {
        return Ok(key);
    }

    if let Some(key) = read_key_from_file_if_exists()? {
        write_key_to_keychain(&key)?;
        return Ok(key);
    }

    let mut key = vec![0_u8; 32];
    OsRng.fill_bytes(&mut key);
    write_key_to_keychain(&key)?;
    Ok(key)
}

#[cfg(all(feature = "os-keychain", not(target_os = "macos")))]
fn ensure_key() -> Result<Vec<u8>, String> {
    static WARN_ONCE: Once = Once::new();
    WARN_ONCE.call_once(|| {
        log::warn!("feature 'os-keychain' is enabled but platform keychain integration is only implemented for macOS; using file-based key storage");
    });
    ensure_key_from_file()
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
