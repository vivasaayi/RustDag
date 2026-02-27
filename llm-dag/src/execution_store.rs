use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::workflow::WorkflowExecutionResult;

/// Maximum number of records to keep in the history file.
/// Oldest records are pruned once this limit is exceeded.
const MAX_HISTORY_RECORDS: usize = 1_000;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExecutionRecord {
    pub id: String,
    pub instance_id: String,
    pub source: String,
    pub status: String,
    pub pending_count: usize,
    pub event_count: usize,
    pub output_keys: Vec<String>,
    pub timestamp_ms: u64,
    pub detail: Option<String>,
}

fn app_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".llm-dag")
}

fn history_path() -> PathBuf {
    app_dir().join("executions").join("history.jsonl")
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn log_result(source: &str, result: &WorkflowExecutionResult, detail: Option<String>) -> Result<(), String> {
    let mut output_keys: Vec<String> = result.outputs.keys().cloned().collect();
    output_keys.sort();

    let record = ExecutionRecord {
        id: uuid::Uuid::new_v4().to_string(),
        instance_id: result.instance_id.clone(),
        source: source.to_string(),
        status: result.status.clone(),
        pending_count: result.pending.len(),
        event_count: result.events.len(),
        output_keys,
        timestamp_ms: now_millis(),
        detail,
    };

    append_record(&record)?;
    maybe_rotate()
}

fn append_record(record: &ExecutionRecord) -> Result<(), String> {
    let path = history_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;

    let line = serde_json::to_string(record).map_err(|e| e.to_string())?;
    writeln!(file, "{line}").map_err(|e| e.to_string())
}

/// Trim the history file to MAX_HISTORY_RECORDS if it has grown beyond the limit.
/// Keeps the most recent records (by timestamp).
fn maybe_rotate() -> Result<(), String> {
    let path = history_path();
    if !path.exists() {
        return Ok(());
    }

    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut records: Vec<ExecutionRecord> = data
        .lines()
        .filter_map(|line| serde_json::from_str::<ExecutionRecord>(line).ok())
        .collect();

    if records.len() <= MAX_HISTORY_RECORDS {
        return Ok(());
    }

    // Sort oldest-first, keep only the tail (most recent)
    records.sort_by_key(|r| r.timestamp_ms);
    records.drain(0..records.len() - MAX_HISTORY_RECORDS);

    // Rewrite the file with retained records
    let mut file = fs::File::create(&path).map_err(|e| e.to_string())?;
    for record in &records {
        let line = serde_json::to_string(record).map_err(|e| e.to_string())?;
        writeln!(file, "{line}").map_err(|e| e.to_string())?;
    }

    log::info!("execution history rotated: retained {} records", records.len());
    Ok(())
}

pub fn list_records(limit: usize) -> Result<Vec<ExecutionRecord>, String> {
    let path = history_path();
    if !path.exists() {
        return Ok(vec![]);
    }

    let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut parsed: Vec<ExecutionRecord> = data
        .lines()
        .filter_map(|line| serde_json::from_str::<ExecutionRecord>(line).ok())
        .collect();

    parsed.sort_by_key(|item| item.timestamp_ms);
    parsed.reverse();

    let take = if limit == 0 { 100 } else { limit };
    Ok(parsed.into_iter().take(take).collect())
}
