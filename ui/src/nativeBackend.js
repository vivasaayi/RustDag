// Lightweight bridge: prefer native plugin (iOS Capacitor), otherwise fallback to HTTP to localhost

const isCapacitor = !!window.Capacitor && !!window.Capacitor.Plugins;

export async function healthcheck() {
  if (isCapacitor && window.Capacitor.Plugins.NativeBackend) {
    return window.Capacitor.Plugins.NativeBackend.healthcheck();
  }
  // fallback to HTTP
  const res = await fetch('http://localhost:7000/healthcheck');
  return res.json();
}

export async function executeGraph(payload) {
  if (isCapacitor && window.Capacitor.Plugins.NativeBackend) {
    return window.Capacitor.Plugins.NativeBackend.executeGraph({ payload });
  }
  const res = await fetch('http://localhost:7000/execute-graph', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function chat(messages) {
  if (isCapacitor && window.Capacitor.Plugins.NativeBackend) {
    return window.Capacitor.Plugins.NativeBackend.chat({ messages });
  }
  // fallback to HTTP
  const res = await fetch('http://localhost:9091/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });
  return res.json();
}

export async function executeWorkflow(workflow) {
  if (isCapacitor && window.Capacitor.Plugins.NativeBackend) {
    return window.Capacitor.Plugins.NativeBackend.executeWorkflow({ workflow });
  }
  const res = await fetch('http://localhost:9091/execute-workflow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflow }),
  });
  return res.json();
}

export async function resumeWorkflow(instanceId, payload) {
  if (isCapacitor && window.Capacitor.Plugins.NativeBackend) {
    return window.Capacitor.Plugins.NativeBackend.resumeWorkflow({ instanceId, payload });
  }
  const res = await fetch(`http://localhost:9091/workflow/${instanceId}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function listSecrets() {
  const res = await fetch('http://localhost:9091/secrets/list');
  return res.json();
}

export async function setSecret(name, value) {
  const res = await fetch('http://localhost:9091/secrets/set', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, value }),
  });
  return res.json();
}

export async function deleteSecret(name) {
  const res = await fetch('http://localhost:9091/secrets/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

export async function listTemplates() {
  const res = await fetch('http://localhost:9091/templates/list');
  return res.json();
}

export async function syncTemplates(templates) {
  const res = await fetch('http://localhost:9091/templates/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templates }),
  });
  return res.json();
}

export async function updateTemplateConfig(payload) {
  const res = await fetch('http://localhost:9091/templates/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function runTemplate(id) {
  const res = await fetch('http://localhost:9091/templates/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  return res.json();
}

export async function listExecutions(limit = 200) {
  const res = await fetch(`http://localhost:9091/executions/list?limit=${encodeURIComponent(limit)}`);
  return res.json();
}

export default {
  healthcheck,
  executeGraph,
  chat,
  executeWorkflow,
  resumeWorkflow,
  listSecrets,
  setSecret,
  deleteSecret,
  listTemplates,
  syncTemplates,
  updateTemplateConfig,
  runTemplate,
  listExecutions,
};
