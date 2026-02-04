use axum::{extract::Json, routing::{post, get}, Router};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;

mod dag;
mod runner;
mod models;
mod workflow;

use dag::{Dag, DagExecutionResult};
use models::ModelInfo;
use workflow::{Workflow, WorkflowExecutionResult};

#[tokio::main]
async fn main() {
    env_logger::init();

    // build router
    let app = Router::new()
        .route("/execute-graph", post(execute_graph))
        .route("/models/list", get(list_models))
        .route("/models/download", post(download_model))
        .route("/chat", post(chat))
        .route("/execute-workflow", post(execute_workflow));

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
    let result = payload.workflow.execute().await;
    Json(ExecuteWorkflowResponse { result })
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
