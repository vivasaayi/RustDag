use serde::{Deserialize, Serialize};
use serde_json::Value;
use crate::runner;
use std::collections::{HashMap, VecDeque};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Node {
    pub id: String,
    pub typ: String,
    pub params: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Edge {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Dag {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DagExecutionResult {
    pub outputs: HashMap<String, Value>,
}

impl Dag {
    pub fn empty() -> Self {
        Self { nodes: vec![], edges: vec![] }
    }

    pub fn from_json(v: &Value) -> Result<Self, String> {
        serde_json::from_value(v.clone()).map_err(|e| e.to_string())
    }

    // very simple topological executor - does not attempt parallelism yet
    pub async fn execute(&self) -> DagExecutionResult {
        let mut outputs: HashMap<String, Value> = HashMap::new();

        // build adjacency and indegree
        let mut indeg: HashMap<String, usize> = HashMap::new();
        let mut adj: HashMap<String, Vec<String>> = HashMap::new();

        for n in &self.nodes {
            indeg.insert(n.id.clone(), 0);
        }
        for e in &self.edges {
            *indeg.entry(e.to.clone()).or_insert(0) += 1;
            adj.entry(e.from.clone()).or_default().push(e.to.clone());
        }

        // queue nodes with indegree 0
        let mut q: VecDeque<String> = VecDeque::new();
        for (id, &deg) in indeg.iter() {
            if deg == 0 {
                q.push_back(id.clone());
            }
        }

        while let Some(node_id) = q.pop_front() {
            let node = self.nodes.iter().find(|n| n.id == node_id).unwrap();
            let out = execute_node(node, &outputs).await;
            outputs.insert(node.id.clone(), out);

            // decrement neighbors
            if let Some(neigh) = adj.get(&node_id) {
                for n in neigh.iter() {
                    if let Some(x) = indeg.get_mut(n) {
                        *x -= 1;
                        if *x == 0 {
                            q.push_back(n.clone());
                        }
                    }
                }
            }
        }

        DagExecutionResult { outputs }
    }
}

async fn execute_node(node: &Node, inputs: &HashMap<String, Value>) -> Value {
    // stub: If node.typ == "llm", call the stub runner
    match node.typ.as_str() {
        "llm" => {
            // Node params->prompt can be a string or object — normalize to string
            let prompt = node
                .params
                .as_ref()
                .and_then(|p| p.get("prompt"))
                .map(|v| v.as_str().map(|s| s.to_string()).unwrap_or_else(|| v.to_string()))
                .unwrap_or_default();

            // Delegate to runner (could be llama or stub)
            runner::run_llm(&prompt, inputs, &node.id).await
        }
        _ => serde_json::json!({"ok": true, "node": node.id}),
    }
}
