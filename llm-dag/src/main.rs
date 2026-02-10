use axum::{
    http::{header, Method},
    extract::{Json, Query, State},
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{SocketAddr, TcpListener};
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};
use tower_http::cors::{Any, CorsLayer};

mod dag;
mod runner;
mod models;
mod workflow;
mod executors;
mod state_store;
mod expr;
mod secrets;
mod template_store;
mod execution_store;

use dag::{Dag, DagExecutionResult};
use models::ModelInfo;
use workflow::{ResumeAction, Workflow, WorkflowExecutionResult};

#[derive(Clone)]
struct AppState {
    template_lock: Arc<Mutex<()>>,
}

#[cfg(test)]
pub(crate) static TEST_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn app_router(app_state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::OPTIONS,
        ])
        .allow_headers([header::CONTENT_TYPE, header::ACCEPT, header::AUTHORIZATION]);

    Router::new()
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
        .route("/executions/list", get(list_executions))
        .layer(cors)
        .with_state(app_state)
}

#[tokio::main]
async fn main() {
    env_logger::init();
    let app_state = AppState {
        template_lock: Arc::new(Mutex::new(())),
    };

    tokio::spawn(template_scheduler_loop(app_state.clone()));

    let app = app_router(app_state);

    let addr = SocketAddr::from(([127, 0, 0, 1], 9091));
    println!("llm-dag http shim listening on {addr}");

    let listener = match TcpListener::bind(addr) {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("llm-dag failed to bind 127.0.0.1:9091: {error}");
            return;
        }
    };

    let server = match axum::Server::from_tcp(listener) {
        Ok(server) => server,
        Err(error) => {
            eprintln!("llm-dag failed to initialize server: {error}");
            return;
        }
    };

    if let Err(error) = server.serve(app.into_make_service()).await {
        eprintln!("llm-dag server error: {error}");
    }
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
    let _ = execution_store::log_result("workflow", &result, None);
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
    let _ = execution_store::log_result(&format!("resume:{id}"), &result, None);
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

#[derive(Debug, Deserialize)]
struct ListExecutionsQuery {
    limit: Option<usize>,
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

async fn list_executions(
    Query(query): Query<ListExecutionsQuery>,
) -> Json<serde_json::Value> {
    let limit = query.limit.unwrap_or(200);
    match execution_store::list_records(limit) {
        Ok(items) => Json(serde_json::json!({ "executions": items })),
        Err(err) => Json(serde_json::json!({ "error": err, "executions": [] })),
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
    let _ = execution_store::log_result(&format!("template:{template_id}"), &result, None);

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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Method, Request, StatusCode};
    use hyper::body::to_bytes;
    use serde_json::{json, Value};
    use tempfile::tempdir;
    use tower::util::ServiceExt;

    async fn json_request(app: &Router, method: Method, uri: &str, payload: Value) -> (StatusCode, Value) {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(uri)
                    .header("content-type", "application/json")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        let status = response.status();
        let body_bytes = to_bytes(response.into_body())
            .await
            .unwrap();
        let body_json: Value = serde_json::from_slice(&body_bytes).unwrap_or_else(|_| json!({}));
        (status, body_json)
    }

    async fn get_request(app: &Router, uri: &str) -> (StatusCode, Value) {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(uri)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        let status = response.status();
        let body_bytes = to_bytes(response.into_body())
            .await
            .unwrap();
        let body_json: Value = serde_json::from_slice(&body_bytes).unwrap_or_else(|_| json!({}));
        (status, body_json)
    }

    #[tokio::test]
    async fn templates_sync_config_run_and_list() {
        let _guard = crate::TEST_ENV_LOCK.lock().unwrap();
        let temp = tempdir().unwrap();
        std::env::set_var("HOME", temp.path());

        let state = AppState {
            template_lock: Arc::new(Mutex::new(())),
        };
        let app = app_router(state);

        let template_payload = json!({
            "templates": [
                {
                    "id": "t_simple",
                    "name": "Simple Template",
                    "category": "tests",
                    "description": "simple",
                    "profiles": ["everyday"],
                    "riskLevel": "low",
                    "defaultDevice": "local",
                    "recommendedSchedule": "manual",
                    "workflow": {
                        "version": 1,
                        "nodes": [
                            {
                                "id": "n1",
                                "stageId": "start",
                                "label": "Start",
                                "properties": {},
                                "ports": { "inputs": [], "outputs": [{ "id": "out" }] }
                            },
                            {
                                "id": "n2",
                                "stageId": "stop",
                                "label": "Stop",
                                "properties": {},
                                "ports": { "inputs": [{ "id": "in" }], "outputs": [] }
                            }
                        ],
                        "edges": [
                            {
                                "id": "e1",
                                "source": "n1",
                                "target": "n2",
                                "sourceHandle": "out",
                                "targetHandle": "in"
                            }
                        ]
                    }
                }
            ]
        });

        let (sync_status, sync_body) = json_request(&app, Method::POST, "/templates/sync", template_payload).await;
        assert_eq!(sync_status, StatusCode::OK);
        assert_eq!(sync_body["status"], "ok");

        let (config_status, config_body) = json_request(
            &app,
            Method::POST,
            "/templates/config",
            json!({
                "id": "t_simple",
                "enabled": true,
                "autoRun": true,
                "schedule": "hourly",
                "device": "local"
            }),
        )
        .await;
        assert_eq!(config_status, StatusCode::OK);
        assert_eq!(config_body["status"], "ok");
        assert_eq!(config_body["template"]["autoRun"], true);
        assert_eq!(config_body["template"]["schedule"], "hourly");

        let (run_status, run_body) = json_request(
            &app,
            Method::POST,
            "/templates/run",
            json!({"id": "t_simple"}),
        )
        .await;
        assert_eq!(run_status, StatusCode::OK);
        assert_eq!(run_body["status"], "ok");
        assert_eq!(run_body["result"]["status"], "completed");
        assert!(run_body["template"]["lastRunAt"].as_u64().unwrap_or(0) > 0);

        let (list_status, list_body) = get_request(&app, "/templates/list").await;
        assert_eq!(list_status, StatusCode::OK);
        let templates = list_body["templates"].as_array().unwrap();
        assert_eq!(templates.len(), 1);
        assert_eq!(templates[0]["id"], "t_simple");
        assert_eq!(templates[0]["lastStatus"], "completed");
    }

    #[tokio::test]
    async fn templates_config_returns_not_found_for_unknown_id() {
        let _guard = crate::TEST_ENV_LOCK.lock().unwrap();
        let temp = tempdir().unwrap();
        std::env::set_var("HOME", temp.path());

        let state = AppState {
            template_lock: Arc::new(Mutex::new(())),
        };
        let app = app_router(state);

        let (status, body) = json_request(
            &app,
            Method::POST,
            "/templates/config",
            json!({
                "id": "missing_template",
                "enabled": true
            }),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["error"], "not_found");
    }
}
