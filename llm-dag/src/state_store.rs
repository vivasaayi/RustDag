use std::fs;
use std::path::PathBuf;
use std::io::Write;

use crate::workflow::WorkflowInstanceState;

pub fn instances_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
        .join(".llm-dag")
        .join("instances")
}

pub fn save_instance(state: &WorkflowInstanceState) -> Result<(), String> {
    let dir = instances_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.json", state.id));
    let data = serde_json::to_vec_pretty(state).map_err(|e| e.to_string())?;
    let mut file = fs::File::create(path).map_err(|e| e.to_string())?;
    file.write_all(&data).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_instance(id: &str) -> Result<WorkflowInstanceState, String> {
    let path = instances_dir().join(format!("{}.json", id));
    let data = fs::read(path).map_err(|e| e.to_string())?;
    serde_json::from_slice(&data).map_err(|e| e.to_string())
}

pub fn delete_instance(id: &str) -> Result<(), String> {
    let path = instances_dir().join(format!("{}.json", id));
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
