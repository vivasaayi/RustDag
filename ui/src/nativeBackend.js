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

export default { healthcheck, executeGraph, chat };
