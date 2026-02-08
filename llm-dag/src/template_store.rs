use chrono::{Local, TimeZone};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::workflow::Workflow;

const STORE_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TemplateDefinition {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub profiles: Vec<String>,
    #[serde(default)]
    pub risk_level: String,
    #[serde(default)]
    pub default_device: String,
    #[serde(default)]
    pub recommended_schedule: String,
    pub workflow: Workflow,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TemplateRecord {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub profiles: Vec<String>,
    #[serde(default)]
    pub risk_level: String,
    #[serde(default = "default_device")]
    pub default_device: String,
    pub workflow: Workflow,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub auto_run: bool,
    #[serde(default = "default_schedule")]
    pub schedule: String,
    #[serde(default = "default_device")]
    pub device: String,
    #[serde(default)]
    pub last_run_at: u64,
    #[serde(default)]
    pub last_status: String,
    #[serde(default)]
    pub last_error: String,
    #[serde(default)]
    pub last_instance_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateConfigPatch {
    pub id: String,
    pub enabled: Option<bool>,
    pub auto_run: Option<bool>,
    pub schedule: Option<String>,
    pub device: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TemplateRunUpdate {
    pub last_run_at: u64,
    pub last_status: String,
    pub last_error: Option<String>,
    pub last_instance_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct TemplateStoreFile {
    version: u32,
    templates: Vec<TemplateRecord>,
}

fn default_enabled() -> bool {
    true
}

fn default_schedule() -> String {
    "manual".to_string()
}

fn default_device() -> String {
    "local".to_string()
}

fn app_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".llm-dag")
}

fn templates_path() -> PathBuf {
    app_dir().join("templates").join("state.json")
}

fn load_store_file() -> Result<TemplateStoreFile, String> {
    let path = templates_path();
    if !path.exists() {
        return Ok(TemplateStoreFile {
            version: STORE_VERSION,
            templates: vec![],
        });
    }

    let raw = fs::read(path).map_err(|e| e.to_string())?;
    if let Ok(store) = serde_json::from_slice::<TemplateStoreFile>(&raw) {
        return Ok(store);
    }
    if let Ok(templates) = serde_json::from_slice::<Vec<TemplateRecord>>(&raw) {
        return Ok(TemplateStoreFile {
            version: STORE_VERSION,
            templates,
        });
    }

    Err("failed to parse template store".to_string())
}

fn save_store_file(store: &TemplateStoreFile) -> Result<(), String> {
    let path = templates_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut file = fs::File::create(path).map_err(|e| e.to_string())?;
    let data = serde_json::to_vec_pretty(store).map_err(|e| e.to_string())?;
    file.write_all(&data).map_err(|e| e.to_string())
}

fn default_device_for(def: &TemplateDefinition) -> String {
    if def.default_device.trim().is_empty() {
        default_device()
    } else {
        def.default_device.clone()
    }
}

fn normalize_schedule(schedule: &str) -> String {
    match schedule.trim() {
        "every_15m" => "every_15m".to_string(),
        "hourly" => "hourly".to_string(),
        "daily_9am" => "daily_9am".to_string(),
        _ => "manual".to_string(),
    }
}

fn record_from_definition(def: &TemplateDefinition) -> TemplateRecord {
    let schedule = if def.recommended_schedule.trim().is_empty() {
        default_schedule()
    } else {
        normalize_schedule(&def.recommended_schedule)
    };
    let device = default_device_for(def);
    TemplateRecord {
        id: def.id.clone(),
        name: def.name.clone(),
        category: def.category.clone(),
        description: def.description.clone(),
        profiles: def.profiles.clone(),
        risk_level: def.risk_level.clone(),
        default_device: device.clone(),
        workflow: def.workflow.clone(),
        enabled: default_enabled(),
        auto_run: false,
        schedule,
        device,
        last_run_at: 0,
        last_status: String::new(),
        last_error: String::new(),
        last_instance_id: String::new(),
    }
}

fn sort_templates(templates: &mut Vec<TemplateRecord>) {
    templates.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
}

pub fn list_templates() -> Result<Vec<TemplateRecord>, String> {
    let mut templates = load_store_file()?.templates;
    sort_templates(&mut templates);
    Ok(templates)
}

pub fn sync_templates(definitions: &[TemplateDefinition]) -> Result<Vec<TemplateRecord>, String> {
    let existing = load_store_file()?.templates;
    let mut existing_map: HashMap<String, TemplateRecord> =
        existing.into_iter().map(|item| (item.id.clone(), item)).collect();

    let mut merged = vec![];
    for def in definitions {
        if def.id.trim().is_empty() {
            continue;
        }

        if let Some(current) = existing_map.remove(&def.id) {
            let mut next = record_from_definition(def);
            next.enabled = current.enabled;
            next.auto_run = current.auto_run;
            next.schedule = normalize_schedule(&current.schedule);
            next.device = if current.device.trim().is_empty() {
                default_device_for(def)
            } else {
                current.device
            };
            next.last_run_at = current.last_run_at;
            next.last_status = current.last_status;
            next.last_error = current.last_error;
            next.last_instance_id = current.last_instance_id;
            merged.push(next);
        } else {
            merged.push(record_from_definition(def));
        }
    }

    for leftover in existing_map.into_values() {
        merged.push(leftover);
    }

    sort_templates(&mut merged);
    save_store_file(&TemplateStoreFile {
        version: STORE_VERSION,
        templates: merged.clone(),
    })?;
    Ok(merged)
}

pub fn get_template(id: &str) -> Result<Option<TemplateRecord>, String> {
    let store = load_store_file()?;
    Ok(store.templates.into_iter().find(|item| item.id == id))
}

pub fn update_template_config(patch: &TemplateConfigPatch) -> Result<Option<TemplateRecord>, String> {
    let mut store = load_store_file()?;
    let mut updated: Option<TemplateRecord> = None;

    for template in &mut store.templates {
        if template.id != patch.id {
            continue;
        }
        if let Some(enabled) = patch.enabled {
            template.enabled = enabled;
        }
        if let Some(auto_run) = patch.auto_run {
            template.auto_run = auto_run;
        }
        if let Some(schedule) = patch.schedule.as_deref() {
            template.schedule = normalize_schedule(schedule);
        }
        if let Some(device) = patch.device.as_ref() {
            template.device = if device.trim().is_empty() {
                default_device()
            } else {
                device.clone()
            };
        }
        updated = Some(template.clone());
        break;
    }

    if updated.is_some() {
        sort_templates(&mut store.templates);
        save_store_file(&store)?;
    }

    Ok(updated)
}

pub fn update_template_run(id: &str, update: TemplateRunUpdate) -> Result<Option<TemplateRecord>, String> {
    let mut store = load_store_file()?;
    let mut updated: Option<TemplateRecord> = None;

    for template in &mut store.templates {
        if template.id != id {
            continue;
        }
        template.last_run_at = update.last_run_at;
        template.last_status = update.last_status.clone();
        template.last_error = update.last_error.unwrap_or_default();
        template.last_instance_id = update.last_instance_id.unwrap_or_default();
        updated = Some(template.clone());
        break;
    }

    if updated.is_some() {
        sort_templates(&mut store.templates);
        save_store_file(&store)?;
    }

    Ok(updated)
}

pub fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn is_schedule_due(schedule: &str, last_run_at: u64, now_ms: u64) -> bool {
    match normalize_schedule(schedule).as_str() {
        "every_15m" => now_ms.saturating_sub(last_run_at) >= 15 * 60 * 1000,
        "hourly" => now_ms.saturating_sub(last_run_at) >= 60 * 60 * 1000,
        "daily_9am" => is_daily_nine_due(last_run_at, now_ms),
        _ => false,
    }
}

fn is_daily_nine_due(last_run_at: u64, now_ms: u64) -> bool {
    let now = Local::now();
    let Some(today_nine_naive) = now.date_naive().and_hms_opt(9, 0, 0) else {
        return false;
    };
    let today_nine = Local
        .from_local_datetime(&today_nine_naive)
        .earliest()
        .or_else(|| Local.from_local_datetime(&today_nine_naive).latest());
    let Some(today_nine) = today_nine else {
        return false;
    };

    let today_nine_ms = today_nine.timestamp_millis();
    if today_nine_ms < 0 {
        return false;
    }
    let today_nine_ms = today_nine_ms as u64;
    now_ms >= today_nine_ms && last_run_at < today_nine_ms
}
