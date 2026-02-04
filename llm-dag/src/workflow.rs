use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet, VecDeque};

use crate::runner;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Port {
    pub id: String,
    pub label: Option<String>,
    #[serde(rename = "dataType")]
    pub data_type: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Ports {
    pub inputs: Vec<Port>,
    pub outputs: Vec<Port>,
}

impl Default for Ports {
    fn default() -> Self {
        Self { inputs: vec![], outputs: vec![] }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StageNode {
    pub id: String,
    #[serde(rename = "stageId")]
    pub stage_id: String,
    pub label: Option<String>,
    pub properties: Option<Value>,
    pub ports: Option<Ports>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Edge {
    pub id: String,
    pub source: String,
    pub target: String,
    #[serde(rename = "sourceHandle")]
    pub source_handle: Option<String>,
    #[serde(rename = "targetHandle")]
    pub target_handle: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Workflow {
    pub version: Option<u32>,
    pub nodes: Vec<StageNode>,
    pub edges: Vec<Edge>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkflowExecutionResult {
    pub outputs: HashMap<String, Value>,
    pub events: Vec<ExecutionEvent>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExecutionEvent {
    pub node_id: String,
    pub stage_id: String,
    pub status: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone)]
struct Token {
    target_node: String,
    target_port: String,
    payload: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum JoinMode {
    All,
    Any,
}

impl Workflow {
    pub async fn execute(&self) -> WorkflowExecutionResult {
        let mut outputs: HashMap<String, Value> = HashMap::new();
        let mut events: Vec<ExecutionEvent> = vec![];

        let node_map: HashMap<String, StageNode> = self
            .nodes
            .iter()
            .cloned()
            .map(|node| (node.id.clone(), node))
            .collect();

        let mut outgoing: HashMap<String, Vec<Edge>> = HashMap::new();
        for edge in &self.edges {
            outgoing.entry(edge.source.clone()).or_default().push(edge.clone());
        }

        let mut input_buffers: HashMap<(String, String), Vec<Value>> = HashMap::new();
        let mut scheduled: HashSet<String> = HashSet::new();
        let mut queue: VecDeque<String> = VecDeque::new();
        let mut loop_counts: HashMap<String, usize> = HashMap::new();

        for node in &self.nodes {
            let ports = node.ports.clone().unwrap_or_default();
            if ports.inputs.is_empty() || node.stage_id == "start" || node.stage_id == "trigger" {
                queue.push_back(node.id.clone());
                scheduled.insert(node.id.clone());
            }
        }

        while let Some(node_id) = queue.pop_front() {
            scheduled.remove(&node_id);
            let Some(node) = node_map.get(&node_id) else { continue };
            let ports = node.ports.clone().unwrap_or_default();

            let join_mode = join_mode(node);
            if !ports.inputs.is_empty() && !is_ready(node, &ports, &input_buffers, join_mode) {
                continue;
            }

            let inputs = take_inputs(node, &ports, &mut input_buffers, join_mode);

            let result = execute_stage(node, &inputs, &mut loop_counts).await;
            outputs.insert(node.id.clone(), result.clone());
            events.push(ExecutionEvent {
                node_id: node.id.clone(),
                stage_id: node.stage_id.clone(),
                status: "ok".to_string(),
                detail: None,
            });

            let output_payloads = stage_outputs(node, &ports, &result);
            if let Some(edges) = outgoing.get(&node_id) {
                for edge in edges {
                    let out_port_id = edge
                        .source_handle
                        .clone()
                        .unwrap_or_else(|| ports.outputs.get(0).map(|p| p.id.clone()).unwrap_or_default());
                    if let Some(payload) = output_payloads.get(&out_port_id) {
                        let target_port = edge.target_handle.clone().unwrap_or_else(|| {
                            node_map
                                .get(&edge.target)
                                .and_then(|target| target.ports.clone())
                                .and_then(|p| p.inputs.get(0).map(|port| port.id.clone()))
                                .unwrap_or_else(|| "in".to_string())
                        });
                        let token = Token {
                            target_node: edge.target.clone(),
                            target_port: target_port.clone(),
                            payload: payload.clone(),
                        };
                        input_buffers
                            .entry((token.target_node.clone(), token.target_port.clone()))
                            .or_default()
                            .push(token.payload);

                        let target_id = edge.target.clone();
                        if let Some(target) = node_map.get(&target_id) {
                            let target_ports = target.ports.clone().unwrap_or_default();
                            let mode = join_mode(target);
                            if is_ready(target, &target_ports, &input_buffers, mode) && !scheduled.contains(&target_id) {
                                scheduled.insert(target_id.clone());
                                queue.push_back(target_id);
                            }
                        }
                    }
                }
            }
        }

        WorkflowExecutionResult { outputs, events }
    }
}

fn join_mode(node: &StageNode) -> JoinMode {
    let stage = node.stage_id.as_str();
    let props = node.properties.clone().unwrap_or(Value::Null);
    let default_all = stage == "sync_merge" || stage == "thread_join";
    let default_any = stage == "simple_merge";

    if let Some(mode) = props.get("mode").and_then(|v| v.as_str()) {
        return if mode.eq_ignore_ascii_case("all") { JoinMode::All } else { JoinMode::Any };
    }

    if let Some(mode) = props.get("joinType").and_then(|v| v.as_str()) {
        return if mode.eq_ignore_ascii_case("all") { JoinMode::All } else { JoinMode::Any };
    }

    if default_all {
        return JoinMode::All;
    }
    if default_any {
        return JoinMode::Any;
    }

    JoinMode::Any
}

fn is_ready(
    node: &StageNode,
    ports: &Ports,
    buffers: &HashMap<(String, String), Vec<Value>>,
    mode: JoinMode,
) -> bool {
    if ports.inputs.is_empty() {
        return true;
    }

    match mode {
        JoinMode::All => ports.inputs.iter().all(|port| {
            buffers
                .get(&(node.id.clone(), port.id.clone()))
                .map(|queue| !queue.is_empty())
                .unwrap_or(false)
        }),
        JoinMode::Any => ports.inputs.iter().any(|port| {
            buffers
                .get(&(node.id.clone(), port.id.clone()))
                .map(|queue| !queue.is_empty())
                .unwrap_or(false)
        }),
    }
}

fn take_inputs(
    node: &StageNode,
    ports: &Ports,
    buffers: &mut HashMap<(String, String), Vec<Value>>,
    mode: JoinMode,
) -> HashMap<String, Value> {
    let mut inputs: HashMap<String, Value> = HashMap::new();
    if ports.inputs.is_empty() {
        return inputs;
    }

    match mode {
        JoinMode::All => {
            for port in &ports.inputs {
                if let Some(queue) = buffers.get_mut(&(node.id.clone(), port.id.clone())) {
                    if let Some(value) = queue.pop() {
                        inputs.insert(port.id.clone(), value);
                    }
                }
            }
        }
        JoinMode::Any => {
            for port in &ports.inputs {
                if let Some(queue) = buffers.get_mut(&(node.id.clone(), port.id.clone())) {
                    if let Some(value) = queue.pop() {
                        inputs.insert(port.id.clone(), value);
                        break;
                    }
                }
            }
        }
    }

    inputs
}

async fn execute_stage(
    node: &StageNode,
    inputs: &HashMap<String, Value>,
    loop_counts: &mut HashMap<String, usize>,
) -> Value {
    let stage = node.stage_id.as_str();
    let props = node.properties.clone().unwrap_or(Value::Null);

    match stage {
        "start" | "trigger" => serde_json::json!({"status": "triggered"}),
        "stop" => serde_json::json!({"status": "stopped"}),
        "parallel_split" | "thread_split" => serde_json::json!({"status": "split"}),
        "exclusive_choice" => {
            let selection = props
                .get("expression")
                .and_then(|v| v.as_str())
                .unwrap_or("default");
            serde_json::json!({"route": selection})
        }
        "multi_choice" => {
            let rules = props.get("rules");
            serde_json::json!({"routes": rules.unwrap_or(&Value::Null)})
        }
        "simple_merge" | "sync_merge" | "thread_join" => serde_json::json!({"status": "merged"}),
        "loop" => {
            let count = loop_counts.entry(node.id.clone()).or_insert(0);
            let max_iters = props
                .get("maxIterations")
                .and_then(|v| v.as_u64())
                .unwrap_or(1) as usize;
            let condition = props.get("condition").and_then(|v| v.as_str()).unwrap_or("true");
            let should_continue = condition != "false" && *count < max_iters;
            if should_continue {
                *count += 1;
                serde_json::json!({"route": "next", "iteration": *count})
            } else {
                serde_json::json!({"route": "done", "iteration": *count})
            }
        }
        "pause" | "task_approval" => {
            let decision = props.get("decision").and_then(|v| v.as_str()).unwrap_or("approved");
            serde_json::json!({"decision": decision})
        }
        "call_workflow" => serde_json::json!({"status": "called"}),
        "string_template" => {
            let template = props.get("template").and_then(|v| v.as_str()).unwrap_or("");
            let rendered = render_template(template, inputs);
            serde_json::json!({"text": rendered})
        }
        "llm_agent" | "custom_llm_agent" => {
            let prompt = props
                .get("prompt")
                .and_then(|v| v.as_str())
                .unwrap_or("Say hello");
            runner::run_llm(prompt, inputs, &node.id).await
        }
        "send_mail" | "notify_user" | "exec_process" | "api_call" => {
            serde_json::json!({"ok": true, "stage": stage})
        }
        "csv_writer" | "csv_reader" | "image_writer" | "image_reader" | "word_doc" | "pdf_generator" => {
            serde_json::json!({"ok": true, "stage": stage})
        }
        "mysql_query" | "postgres_query" | "mongo_query" | "aws_kinesis" | "aws_sqs" | "aws_s3" | "kubernetes" | "cloudwatch" | "inline_script" => {
            serde_json::json!({"ok": true, "stage": stage})
        }
        _ => serde_json::json!({"ok": true, "stage": stage}),
    }
}

fn stage_outputs(node: &StageNode, ports: &Ports, result: &Value) -> HashMap<String, Value> {
    let mut outputs = HashMap::new();
    if ports.outputs.is_empty() {
        return outputs;
    }

    let stage = node.stage_id.as_str();

    match stage {
        "exclusive_choice" => {
            let route = result.get("route").and_then(|v| v.as_str()).unwrap_or("default");
            if let Some(port) = find_port(ports, route) {
                outputs.insert(port.id.clone(), Value::Null);
            } else if let Some(default_port) = ports.outputs.iter().find(|p| p.id == "default") {
                outputs.insert(default_port.id.clone(), Value::Null);
            } else {
                outputs.insert(ports.outputs[0].id.clone(), Value::Null);
            }
        }
        "multi_choice" => {
            if let Some(routes) = result.get("routes") {
                if let Some(list) = routes.as_array() {
                    for item in list {
                        if let Some(key) = item.as_str() {
                            if let Some(port) = find_port(ports, key) {
                                outputs.insert(port.id.clone(), Value::Null);
                            }
                        }
                    }
                } else if let Some(text) = routes.as_str() {
                    for key in text.split(',').map(|s| s.trim()) {
                        if let Some(port) = find_port(ports, key) {
                            outputs.insert(port.id.clone(), Value::Null);
                        }
                    }
                }
            }
            if outputs.is_empty() {
                for port in &ports.outputs {
                    if port.id != "default" {
                        outputs.insert(port.id.clone(), Value::Null);
                    }
                }
            }
        }
        "loop" => {
            let route = result.get("route").and_then(|v| v.as_str()).unwrap_or("done");
            if let Some(port) = find_port(ports, route) {
                outputs.insert(port.id.clone(), Value::Null);
            }
        }
        "pause" | "task_approval" => {
            let decision = result.get("decision").and_then(|v| v.as_str()).unwrap_or("approved");
            if let Some(port) = find_port(ports, decision) {
                outputs.insert(port.id.clone(), Value::Null);
            } else if let Some(port) = ports.outputs.get(0) {
                outputs.insert(port.id.clone(), Value::Null);
            }
        }
        "send_mail" | "notify_user" | "exec_process" | "api_call" => {
            if let Some(port) = find_port(ports, "success") {
                outputs.insert(port.id.clone(), result.clone());
            } else if let Some(port) = ports.outputs.get(0) {
                outputs.insert(port.id.clone(), result.clone());
            }
        }
        "string_template" | "llm_agent" | "custom_llm_agent" => {
            if let Some(port) = find_port(ports, "out") {
                outputs.insert(port.id.clone(), result.clone());
            } else if let Some(port) = ports.outputs.get(0) {
                outputs.insert(port.id.clone(), result.clone());
            }
        }
        _ => {
            for port in &ports.outputs {
                outputs.insert(port.id.clone(), Value::Null);
            }
        }
    }

    outputs
}

fn find_port<'a>(ports: &'a Ports, key: &str) -> Option<&'a Port> {
    ports
        .outputs
        .iter()
        .find(|p| p.id == key || p.label.as_deref().unwrap_or("") == key)
}

fn render_template(template: &str, inputs: &HashMap<String, Value>) -> String {
    let mut rendered = template.to_string();
    for (key, value) in inputs {
        let placeholder = format!("{{{{{}}}}}", key);
        let replacement = value
            .as_str()
            .map(|s| s.to_string())
            .unwrap_or_else(|| value.to_string());
        rendered = rendered.replace(&placeholder, &replacement);
    }
    rendered
}
