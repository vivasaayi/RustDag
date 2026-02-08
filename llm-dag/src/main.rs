use axum::{
    extract::{Json, State},
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

mod dag;
mod runner;
mod models;
mod workflow;
mod executors;
mod state_store;
mod expr;
mod secrets;
mod template_store;

use dag::{Dag, DagExecutionResult};
use models::ModelInfo;
use workflow::{ResumeAction, Workflow, WorkflowExecutionResult};

#[derive(Clone)]
struct AppState {
    template_lock: Arc<Mutex<()>>,
}

#[tokio::main]
async fn main() {
    env_logger::init();
    let app_state = AppState {
        template_lock: Arc::new(Mutex::new(())),
    };

    tokio::spawn(template_scheduler_loop(app_state.clone()));

    // build router
    let app = Router::new()
        .route("/execute-graph", post(execute_graph))
        .route("/models/list", get(list_models))
        .route("/models/download", post(download_model))
        .route("/chat", post(chat))
        .route("/execute-workflow", post(execute_workflow))
        .route("/workflow/:id/resume", post(resume_workflow))
        .route("/workflow/:id", get(get_workflow_state))
        .route("/secrets/list", get(list_secrets))
        .route("/secrets/set", post(set_secret))
        .route("/secrets/delete", post(delete_secret))
        .route("/templates/list", get(list_templates))
        .route("/templates/sync", post(sync_templates))
        .route("/templates/config", post(update_template_config))
        .route("/templates/run", post(run_template))
        .with_state(app_state);

    let addr = SocketAddr::from(([127, 0, 0, 1], 9091));
    println!("llm-dag http shim listening on {addr}");

    axum::Server::bind(&addr)
        .serve(app.into_make_service())
        .await
        .unwrap();
}

#[derive(Debug, Deserialize)]
struct ExecuteGraphRequest {
    graph: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct ExecuteGraphResponse {
    result: DagExecutionResult,
}

async fn execute_graph(Json(payload): Json<ExecuteGraphRequest>) -> Json<ExecuteGraphResponse> {
    // parse a DAG from payload.graph (we'll accept a simple JSON format)
    let dag = Dag::from_json(&payload.graph).unwrap_or_else(|_| Dag::empty());
    let result = dag.execute().await;
    Json(ExecuteGraphResponse { result })
}

#[derive(Debug, Deserialize)]
struct ExecuteWorkflowRequest {
    workflow: Workflow,
}

#[derive(Debug, Serialize)]
struct ExecuteWorkflowResponse {
    result: WorkflowExecutionResult,
}

async fn execute_workflow(Json(payload): Json<ExecuteWorkflowRequest>) -> Json<ExecuteWorkflowResponse> {
    let mut instance = payload.workflow.new_instance();
    let result = instance.run().await;
    if result.status == "waiting" {
        let _ = state_store::save_instance(&instance);
    } else {
        let _ = state_store::delete_instance(&instance.id);
    }
    Json(ExecuteWorkflowResponse { result })
}

#[derive(Debug, Deserialize)]
struct ResumeWorkflowRequest {
    node_id: String,
    decision: Option<String>,
    payload: Option<serde_json::Value>,
}

async fn resume_workflow(
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(payload): Json<ResumeWorkflowRequest>,
) -> Json<ExecuteWorkflowResponse> {
    let mut instance = match state_store::load_instance(&id) {
        Ok(state) => state,
        Err(_) => {
            let result = WorkflowExecutionResult {
                instance_id: id,
                status: "not_found".to_string(),
                outputs: HashMap::new(),
                events: vec![],
                pending: vec![],
            };
            return Json(ExecuteWorkflowResponse { result });
        }
    };

    let action = ResumeAction {
        node_id: payload.node_id,
        decision: payload.decision,
        payload: payload.payload,
    };

    let result = instance.resume(action).await;
    if result.status == "waiting" {
        let _ = state_store::save_instance(&instance);
    } else {
        let _ = state_store::delete_instance(&instance.id);
    }
    Json(ExecuteWorkflowResponse { result })
}

async fn get_workflow_state(
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Json<serde_json::Value> {
    match state_store::load_instance(&id) {
        Ok(state) => Json(serde_json::to_value(state).unwrap_or(serde_json::json!({}))),
        Err(_) => Json(serde_json::json!({"error": "not_found"})),
    }
}

#[derive(Debug, Deserialize)]
struct SetSecretRequest {
    name: String,
    value: String,
}

#[derive(Debug, Deserialize)]
struct DeleteSecretRequest {
    name: String,
}

async fn list_secrets() -> Json<serde_json::Value> {
    match secrets::list_secrets() {
        Ok(items) => Json(serde_json::json!({ "secrets": items })),
        Err(err) => Json(serde_json::json!({ "error": err })),
    }
}

async fn set_secret(Json(payload): Json<SetSecretRequest>) -> Json<serde_json::Value> {
    match secrets::set_secret(&payload.name, &payload.value) {
        Ok(_) => Json(serde_json::json!({ "status": "ok" })),
        Err(err) => Json(serde_json::json!({ "error": err })),
    }
}

async fn delete_secret(Json(payload): Json<DeleteSecretRequest>) -> Json<serde_json::Value> {
    match secrets::delete_secret(&payload.name) {
        Ok(_) => Json(serde_json::json!({ "status": "ok" })),
        Err(err) => Json(serde_json::json!({ "error": err })),
    }
}

#[derive(Debug, Deserialize)]
struct SyncTemplatesRequest {
    templates: Vec<template_store::TemplateDefinition>,
}

#[derive(Debug, Deserialize)]
struct RunTemplateRequest {
    id: String,
}

async fn list_templates(State(state): State<AppState>) -> Json<serde_json::Value> {
    let _guard = state.template_lock.lock().await;
    match template_store::list_templates() {
        Ok(templates) => Json(serde_json::json!({ "templates": templates })),
        Err(err) => Json(serde_json::json!({ "error": err, "templates": [] })),
    }
}

async fn sync_templates(
    State(state): State<AppState>,
    Json(payload): Json<SyncTemplatesRequest>,
) -> Json<serde_json::Value> {
    let _guard = state.template_lock.lock().await;
    match template_store::sync_templates(&payload.templates) {
        Ok(templates) => Json(serde_json::json!({ "status": "ok", "templates": templates })),
        Err(err) => Json(serde_json::json!({ "error": err, "templates": [] })),
    }
}

async fn update_template_config(
    State(state): State<AppState>,
    Json(payload): Json<template_store::TemplateConfigPatch>,
) -> Json<serde_json::Value> {
    let _guard = state.template_lock.lock().await;
    match template_store::update_template_config(&payload) {
        Ok(Some(template)) => Json(serde_json::json!({ "status": "ok", "template": template })),
        Ok(None) => Json(serde_json::json!({ "error": "not_found" })),
        Err(err) => Json(serde_json::json!({ "error": err })),
    }
}

async fn run_template(
    State(state): State<AppState>,
    Json(payload): Json<RunTemplateRequest>,
) -> Json<serde_json::Value> {
    match execute_template_by_id(&state, &payload.id).await {
        Ok((template, result)) => Json(serde_json::json!({
            "status": "ok",
            "template": template,
            "result": result
        })),
        Err(err) => Json(serde_json::json!({ "error": err })),
    }
}

async fn execute_template_by_id(
    state: &AppState,
    template_id: &str,
) -> Result<(template_store::TemplateRecord, WorkflowExecutionResult), String> {
    let template = {
        let _guard = state.template_lock.lock().await;
        template_store::get_template(template_id)?
            .ok_or_else(|| format!("template not found: {template_id}"))?
    };

    let mut instance = template.workflow.new_instance();
    let result = instance.run().await;
    let state_error = if result.status == "waiting" {
        state_store::save_instance(&instance).err()
    } else {
        state_store::delete_instance(&instance.id).err()
    };

    let update = template_store::TemplateRunUpdate {
        last_run_at: template_store::now_millis(),
        last_status: result.status.clone(),
        last_error: state_error,
        last_instance_id: Some(result.instance_id.clone()),
    };

    let updated = {
        let _guard = state.template_lock.lock().await;
        template_store::update_template_run(template_id, update)?
            .ok_or_else(|| format!("template not found: {template_id}"))?
    };

    Ok((updated, result))
}

async fn template_scheduler_loop(state: AppState) {
    loop {
        if let Err(err) = template_scheduler_tick(&state).await {
            log::warn!("template scheduler tick failed: {err}");
        }
        sleep(Duration::from_secs(60)).await;
    }
}

async fn template_scheduler_tick(state: &AppState) -> Result<(), String> {
    let due_templates: Vec<String> = {
        let _guard = state.template_lock.lock().await;
        let now = template_store::now_millis();
        template_store::list_templates()?
            .into_iter()
            .filter(|template| {
                template.enabled
                    && template.auto_run
                    && template_store::is_schedule_due(&template.schedule, template.last_run_at, now)
            })
            .map(|template| template.id)
            .collect()
    };

    for template_id in due_templates {
        if let Err(err) = execute_template_by_id(state, &template_id).await {
            log::warn!("scheduled template run failed for {template_id}: {err}");
            let _guard = state.template_lock.lock().await;
            let _ = template_store::update_template_run(
                &template_id,
                template_store::TemplateRunUpdate {
                    last_run_at: template_store::now_millis(),
                    last_status: "error".to_string(),
                    last_error: Some(err),
                    last_instance_id: None,
                },
            );
        }
    }

    Ok(())
}

async fn list_models() -> Json<Vec<ModelInfo>> {
    let models = models::get_available_models();
    let mut with_status = vec![];
    for m in models {
        let downloaded = models::is_model_downloaded(&m.name);
        let mut m = m.clone();
        m.description = format!("{} - {}", m.description, if downloaded { "Downloaded" } else { "Not downloaded" });
        with_status.push(m);
    }
    Json(with_status)
}

#[derive(Deserialize)]
struct DownloadRequest {
    name: String,
}

async fn download_model(Json(payload): Json<DownloadRequest>) -> Json<serde_json::Value> {
    let models = models::get_available_models();
    if let Some(model) = models.into_iter().find(|m| m.name == payload.name) {
        match models::download_model(&model).await {
            Ok(_) => Json(serde_json::json!({"status": "downloaded"})),
            Err(e) => Json(serde_json::json!({"error": e.to_string()})),
        }
    } else {
        Json(serde_json::json!({"error": "model not found"}))
    }
}

#[derive(Deserialize)]
struct ChatRequest {
    messages: Vec<ChatMessage>,
}

#[derive(Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct ChatResponse {
    response: String,
}

async fn chat(Json(payload): Json<ChatRequest>) -> Json<ChatResponse> {
    // Simple: concatenate messages into prompt
    let prompt = payload.messages.iter().map(|m| format!("{}: {}", m.role, m.content)).collect::<Vec<_>>().join("\n");
    let result = runner::run_llm(&prompt, &std::collections::HashMap::new(), "chat").await;
    let response = result.get("text").and_then(|v| v.as_str()).unwrap_or("No response").to_string();
    Json(ChatResponse { response })
}
