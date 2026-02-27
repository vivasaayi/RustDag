const BACKEND_URL = 'http://localhost:9091';

async function jsonPost(path, body) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function jsonGet(path) {
  const res = await fetch(`${BACKEND_URL}${path}`);
  return res.json();
}

export async function syncTemplate(definition) {
  return jsonPost('/templates/sync', { templates: [definition] });
}

export async function syncTemplates(definitions) {
  return jsonPost('/templates/sync', { templates: definitions });
}

export async function listTemplates() {
  return jsonGet('/templates/list');
}

export async function executeWorkflow(workflow) {
  return jsonPost('/execute-workflow', { workflow });
}

export async function resumeWorkflow(instanceId, payload) {
  return jsonPost(`/workflow/${instanceId}/resume`, payload);
}

export async function getWorkflowState(instanceId) {
  return jsonGet(`/workflow/${instanceId}`);
}

export async function listExecutions(limit = 200) {
  return jsonGet(`/executions/list?limit=${limit}`);
}

export async function runTemplate(id) {
  return jsonPost('/templates/run', { id });
}

export async function updateTemplateConfig(payload) {
  return jsonPost('/templates/config', payload);
}

export async function healthcheck() {
  try {
    await jsonGet('/templates/list');
    return true;
  } catch {
    return false;
  }
}
