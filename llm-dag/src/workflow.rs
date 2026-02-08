use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet, VecDeque};

use crate::executors;
use crate::expr;
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InputBuffer {
    pub node_id: String,
    pub port_id: String,
    pub queue: Vec<Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PendingAction {
    pub node_id: String,
    pub stage_id: String,
    pub action: String,
    pub detail: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkflowInstanceState {
    pub id: String,
    pub workflow: Workflow,
    pub outputs: HashMap<String, Value>,
    pub input_buffers: Vec<InputBuffer>,
    pub completed_nodes: Vec<String>,
    pub loop_counts: HashMap<String, usize>,
    pub pending: Vec<PendingAction>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkflowExecutionResult {
    pub instance_id: String,
    pub status: String,
    pub outputs: HashMap<String, Value>,
    pub events: Vec<ExecutionEvent>,
    pub pending: Vec<PendingAction>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExecutionEvent {
    pub node_id: String,
    pub stage_id: String,
    pub status: String,
    pub detail: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ResumeAction {
    pub node_id: String,
    pub decision: Option<String>,
    pub payload: Option<Value>,
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
    pub fn new_instance(&self) -> WorkflowInstanceState {
        WorkflowInstanceState {
            id: uuid::Uuid::new_v4().to_string(),
            workflow: self.clone(),
            outputs: HashMap::new(),
            input_buffers: vec![],
            completed_nodes: vec![],
            loop_counts: HashMap::new(),
            pending: vec![],
        }
    }
}

impl WorkflowInstanceState {
    pub async fn run(&mut self) -> WorkflowExecutionResult {
        run_instance(self, None).await
    }

    pub async fn resume(&mut self, action: ResumeAction) -> WorkflowExecutionResult {
        run_instance(self, Some(action)).await
    }
}

async fn run_instance(state: &mut WorkflowInstanceState, resume: Option<ResumeAction>) -> WorkflowExecutionResult {
    let mut events = vec![];
    let workflow = state.workflow.clone();

    let node_map: HashMap<String, StageNode> = workflow
        .nodes
        .iter()
        .cloned()
        .map(|node| (node.id.clone(), node))
        .collect();

    let mut outgoing: HashMap<String, Vec<Edge>> = HashMap::new();
    for edge in &workflow.edges {
        outgoing.entry(edge.source.clone()).or_default().push(edge.clone());
    }

    let mut input_buffers = buffer_vec_to_map(&state.input_buffers);
    let mut pending_nodes: HashSet<String> = state.pending.iter().map(|p| p.node_id.clone()).collect();
    let mut completed_nodes: HashSet<String> = state.completed_nodes.iter().cloned().collect();

    let mut queue = VecDeque::new();
    let mut scheduled = HashSet::new();

    if let Some(action) = resume.clone() {
        if let Some(node) = node_map.get(&action.node_id) {
            let ports = node.ports.clone().unwrap_or_default();
            let join_mode = join_mode(node);
            let inputs = take_inputs(node, &ports, &mut input_buffers, join_mode);
            let override_result = resume_override(node, action);
            let result = execute_stage(node, &inputs, &mut state.loop_counts, Some(override_result)).await;
            state.outputs.insert(node.id.clone(), result.clone());
            events.push(ExecutionEvent {
                node_id: node.id.clone(),
                stage_id: node.stage_id.clone(),
                status: "resumed".to_string(),
                detail: None,
            });

            pending_nodes.remove(&node.id);
            state.pending.retain(|p| p.node_id != node.id);

            if ports.inputs.is_empty() {
                completed_nodes.insert(node.id.clone());
            }

            let output_payloads = stage_outputs(node, &ports, &result);
            for token in build_tokens(&workflow, node, &output_payloads) {
                input_buffers
                    .entry((token.target_node.clone(), token.target_port.clone()))
                    .or_default()
                    .push(token.payload);
                enqueue_if_ready(
                    &node_map,
                    &mut queue,
                    &mut scheduled,
                    &pending_nodes,
                    &completed_nodes,
                    &input_buffers,
                    &token.target_node,
                );
            }
        }
    }

    for node in &workflow.nodes {
        if pending_nodes.contains(&node.id) {
            continue;
        }
        let ports = node.ports.clone().unwrap_or_default();
        if ports.inputs.is_empty() {
            if completed_nodes.contains(&node.id) {
                continue;
            }
            queue.push_back(node.id.clone());
            scheduled.insert(node.id.clone());
        } else if is_ready(node, &ports, &input_buffers, join_mode(node)) {
            queue.push_back(node.id.clone());
            scheduled.insert(node.id.clone());
        }
    }

    while let Some(node_id) = queue.pop_front() {
        scheduled.remove(&node_id);
        let Some(node) = node_map.get(&node_id) else { continue };
        if pending_nodes.contains(&node_id) {
            continue;
        }

        let ports = node.ports.clone().unwrap_or_default();
        let join_mode = join_mode(node);

        if ports.inputs.is_empty() {
            if completed_nodes.contains(&node_id) {
                continue;
            }
        } else if !is_ready(node, &ports, &input_buffers, join_mode) {
            continue;
        }

        if is_blocking(node) {
            let action = PendingAction {
                node_id: node.id.clone(),
                stage_id: node.stage_id.clone(),
                action: blocking_action(node),
                detail: None,
            };
            pending_nodes.insert(node.id.clone());
            state.pending.push(action.clone());
            events.push(ExecutionEvent {
                node_id: node.id.clone(),
                stage_id: node.stage_id.clone(),
                status: "waiting".to_string(),
                detail: None,
            });
            continue;
        }

        let inputs = take_inputs(node, &ports, &mut input_buffers, join_mode);
        let result = execute_stage(node, &inputs, &mut state.loop_counts, None).await;
        state.outputs.insert(node.id.clone(), result.clone());
        events.push(ExecutionEvent {
            node_id: node.id.clone(),
            stage_id: node.stage_id.clone(),
            status: "ok".to_string(),
            detail: None,
        });

        if ports.inputs.is_empty() {
            completed_nodes.insert(node.id.clone());
        }

        let output_payloads = stage_outputs(node, &ports, &result);
        for token in build_tokens(&workflow, node, &output_payloads) {
            input_buffers
                .entry((token.target_node.clone(), token.target_port.clone()))
                .or_default()
                .push(token.payload);
            enqueue_if_ready(
                &node_map,
                &mut queue,
                &mut scheduled,
                &pending_nodes,
                &completed_nodes,
                &input_buffers,
                &token.target_node,
            );
        }
    }

    state.input_buffers = buffer_map_to_vec(&input_buffers);
    state.completed_nodes = completed_nodes.into_iter().collect();

    let status = if state.pending.is_empty() { "completed" } else { "waiting" };

    WorkflowExecutionResult {
        instance_id: state.id.clone(),
        status: status.to_string(),
        outputs: state.outputs.clone(),
        events,
        pending: state.pending.clone(),
    }
}

fn enqueue_if_ready(
    node_map: &HashMap<String, StageNode>,
    queue: &mut VecDeque<String>,
    scheduled: &mut HashSet<String>,
    pending: &HashSet<String>,
    completed: &HashSet<String>,
    buffers: &HashMap<(String, String), Vec<Value>>,
    node_id: &str,
) {
    if scheduled.contains(node_id) || pending.contains(node_id) {
        return;
    }
    let Some(node) = node_map.get(node_id) else { return };
    let ports = node.ports.clone().unwrap_or_default();
    if ports.inputs.is_empty() {
        if completed.contains(node_id) {
            return;
        }
        queue.push_back(node_id.to_string());
        scheduled.insert(node_id.to_string());
    } else if is_ready(node, &ports, buffers, join_mode(node)) {
        queue.push_back(node_id.to_string());
        scheduled.insert(node_id.to_string());
    }
}

fn buffer_vec_to_map(buffers: &[InputBuffer]) -> HashMap<(String, String), Vec<Value>> {
    let mut map = HashMap::new();
    for buf in buffers {
        map.insert((buf.node_id.clone(), buf.port_id.clone()), buf.queue.clone());
    }
    map
}

fn buffer_map_to_vec(buffers: &HashMap<(String, String), Vec<Value>>) -> Vec<InputBuffer> {
    buffers
        .iter()
        .map(|((node_id, port_id), queue)| InputBuffer {
            node_id: node_id.clone(),
            port_id: port_id.clone(),
            queue: queue.clone(),
        })
        .collect()
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

fn is_blocking(node: &StageNode) -> bool {
    matches!(node.stage_id.as_str(), "pause" | "task_approval" | "trigger")
}

fn blocking_action(node: &StageNode) -> String {
    match node.stage_id.as_str() {
        "pause" => "pause".to_string(),
        "task_approval" => "approval".to_string(),
        "trigger" => "trigger".to_string(),
        _ => "pause".to_string(),
    }
}

fn resume_override(node: &StageNode, action: ResumeAction) -> Value {
    match node.stage_id.as_str() {
        "pause" | "task_approval" => {
            let decision = action.decision.unwrap_or_else(|| "approved".to_string());
            serde_json::json!({"decision": decision, "payload": action.payload})
        }
        "trigger" => serde_json::json!({"status": "triggered", "payload": action.payload}),
        _ => action.payload.unwrap_or(Value::Null),
    }
}

async fn execute_stage(
    node: &StageNode,
    inputs: &HashMap<String, Value>,
    loop_counts: &mut HashMap<String, usize>,
    override_result: Option<Value>,
) -> Value {
    if let Some(result) = override_result {
        return result;
    }

    let stage = node.stage_id.as_str();
    let props = node.properties.clone().unwrap_or(Value::Null);

    match stage {
        "start" => serde_json::json!({"status": "started"}),
        "stop" => serde_json::json!({"status": "stopped"}),
        "parallel_split" | "thread_split" => serde_json::json!({"status": "split"}),
        "exclusive_choice" => {
            let route_ids: Vec<String> = node
                .ports
                .clone()
                .unwrap_or_default()
                .outputs
                .iter()
                .map(|p| p.id.clone())
                .collect();
            let selection = expr::evaluate_exclusive(
                props.get("expression").and_then(|v| v.as_str()),
                &route_ids,
                inputs,
            );
            serde_json::json!({"route": selection})
        }
        "multi_choice" => {
            let route_ids: Vec<String> = node
                .ports
                .clone()
                .unwrap_or_default()
                .outputs
                .iter()
                .map(|p| p.id.clone())
                .collect();
            let routes = expr::evaluate_multi(
                props.get("rules").and_then(|v| v.as_str()),
                &route_ids,
                inputs,
            );
            serde_json::json!({"routes": routes})
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
        "send_mail"
        | "notify_user"
        | "exec_process"
        | "api_call"
        | "mysql_query"
        | "postgres_query"
        | "mongo_query"
        | "aws_kinesis"
        | "aws_sqs"
        | "aws_s3"
        | "kubernetes"
        | "cloudwatch"
        | "inline_script" => {
            let result = executors::execute(stage, &props, inputs).await;
            match result {
                Ok(data) => {
                    let ok = task_result_ok(stage, &data);
                    serde_json::json!({"ok": ok, "data": data})
                }
                Err(err) => serde_json::json!({"ok": false, "error": err.to_string()}),
            }
        }
        _ => serde_json::json!({"ok": true, "stage": stage}),
    }
}

fn task_result_ok(stage: &str, data: &Value) -> bool {
    match stage {
        "api_call" => data.get("status").and_then(|v| v.as_u64()).map(|s| s < 400).unwrap_or(true),
        "exec_process" => data.get("status").and_then(|v| v.as_i64()).map(|s| s == 0).unwrap_or(true),
        _ => true,
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
        "send_mail"
        | "notify_user"
        | "exec_process"
        | "api_call"
        | "mysql_query"
        | "postgres_query"
        | "mongo_query"
        | "aws_kinesis"
        | "aws_sqs"
        | "aws_s3"
        | "kubernetes"
        | "cloudwatch"
        | "inline_script" => {
            let ok = result.get("ok").and_then(|v| v.as_bool()).unwrap_or(true);
            if ok {
                if let Some(port) = find_port(ports, "success") {
                    outputs.insert(port.id.clone(), result.clone());
                } else if let Some(port) = ports.outputs.get(0) {
                    outputs.insert(port.id.clone(), result.clone());
                }
            } else if let Some(port) = find_port(ports, "error") {
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

fn build_tokens(workflow: &Workflow, node: &StageNode, output_payloads: &HashMap<String, Value>) -> Vec<Token> {
    let mut tokens = vec![];
    for edge in workflow.edges.iter().filter(|e| e.source == node.id) {
        let source_handle = edge
            .source_handle
            .clone()
            .unwrap_or_else(|| node.ports.clone().unwrap_or_default().outputs.get(0).map(|p| p.id.clone()).unwrap_or_default());
        if let Some(payload) = output_payloads.get(&source_handle) {
            let target_port = edge.target_handle.clone().unwrap_or_else(|| {
                workflow
                    .nodes
                    .iter()
                    .find(|n| n.id == edge.target)
                    .and_then(|n| n.ports.clone())
                    .and_then(|p| p.inputs.get(0).map(|port| port.id.clone()))
                    .unwrap_or_else(|| "in".to_string())
            });
            tokens.push(Token {
                target_node: edge.target.clone(),
                target_port,
                payload: payload.clone(),
            });
        }
    }
    tokens
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

#[cfg(test)]
mod tests {
    use super::*;

    fn port(id: &str) -> Port {
        Port {
            id: id.to_string(),
            label: None,
            data_type: None,
        }
    }

    fn ports(inputs: &[&str], outputs: &[&str]) -> Ports {
        Ports {
            inputs: inputs.iter().map(|id| port(id)).collect(),
            outputs: outputs.iter().map(|id| port(id)).collect(),
        }
    }

    #[tokio::test]
    async fn pause_stage_waits_and_resumes_to_approved_path() {
        let workflow = Workflow {
            version: Some(1),
            nodes: vec![
                StageNode {
                    id: "start".to_string(),
                    stage_id: "start".to_string(),
                    label: None,
                    properties: None,
                    ports: Some(ports(&[], &["out"])),
                },
                StageNode {
                    id: "pause1".to_string(),
                    stage_id: "pause".to_string(),
                    label: None,
                    properties: None,
                    ports: Some(ports(&["in"], &["approved", "rejected"])),
                },
                StageNode {
                    id: "done".to_string(),
                    stage_id: "stop".to_string(),
                    label: None,
                    properties: None,
                    ports: Some(ports(&["in"], &[])),
                },
            ],
            edges: vec![
                Edge {
                    id: "e1".to_string(),
                    source: "start".to_string(),
                    target: "pause1".to_string(),
                    source_handle: Some("out".to_string()),
                    target_handle: Some("in".to_string()),
                },
                Edge {
                    id: "e2".to_string(),
                    source: "pause1".to_string(),
                    target: "done".to_string(),
                    source_handle: Some("approved".to_string()),
                    target_handle: Some("in".to_string()),
                },
            ],
        };

        let mut instance = workflow.new_instance();
        let first = instance.run().await;
        assert_eq!(first.status, "waiting");
        assert_eq!(first.pending.len(), 1);
        assert_eq!(first.pending[0].node_id, "pause1");

        let second = instance
            .resume(ResumeAction {
                node_id: "pause1".to_string(),
                decision: Some("approved".to_string()),
                payload: None,
            })
            .await;

        assert_eq!(second.status, "completed");
        assert!(second.pending.is_empty());
        assert!(second.outputs.contains_key("done"));
    }

    #[tokio::test]
    async fn exclusive_choice_routes_to_selected_output() {
        let workflow = Workflow {
            version: Some(1),
            nodes: vec![
                StageNode {
                    id: "start".to_string(),
                    stage_id: "start".to_string(),
                    label: None,
                    properties: None,
                    ports: Some(ports(&[], &["out"])),
                },
                StageNode {
                    id: "choice".to_string(),
                    stage_id: "exclusive_choice".to_string(),
                    label: None,
                    properties: Some(serde_json::json!({"expression": "path_a"})),
                    ports: Some(ports(&["in"], &["path_a", "path_b", "default"])),
                },
                StageNode {
                    id: "a".to_string(),
                    stage_id: "stop".to_string(),
                    label: None,
                    properties: None,
                    ports: Some(ports(&["in"], &[])),
                },
                StageNode {
                    id: "b".to_string(),
                    stage_id: "stop".to_string(),
                    label: None,
                    properties: None,
                    ports: Some(ports(&["in"], &[])),
                },
            ],
            edges: vec![
                Edge {
                    id: "e1".to_string(),
                    source: "start".to_string(),
                    target: "choice".to_string(),
                    source_handle: Some("out".to_string()),
                    target_handle: Some("in".to_string()),
                },
                Edge {
                    id: "e2".to_string(),
                    source: "choice".to_string(),
                    target: "a".to_string(),
                    source_handle: Some("path_a".to_string()),
                    target_handle: Some("in".to_string()),
                },
                Edge {
                    id: "e3".to_string(),
                    source: "choice".to_string(),
                    target: "b".to_string(),
                    source_handle: Some("path_b".to_string()),
                    target_handle: Some("in".to_string()),
                },
            ],
        };

        let mut instance = workflow.new_instance();
        let result = instance.run().await;

        assert_eq!(result.status, "completed");
        assert!(result.outputs.contains_key("a"));
        assert!(!result.outputs.contains_key("b"));
    }
}
