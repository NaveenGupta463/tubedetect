import { ROUTES } from '../config';

export async function lookup(url, niche) {
  const res = await fetch(ROUTES.lookup, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, niche }),
  });
  if (!res.ok) throw new Error(`lookup failed: ${res.status}`);
  return res.json();
}

export async function explain(title, hook, niche, channelSize) {
  const res = await fetch(ROUTES.explain, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, hook, niche, channel_size: channelSize }),
  });
  if (!res.ok) throw new Error(`explain failed: ${res.status}`);
  return res.json();
}

export async function analyze(data) {
  const res = await fetch(ROUTES.analyze, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`analyze failed: ${res.status}`);
  return res.json();
}

export async function getMetrics() {
  const res = await fetch(ROUTES.metrics);
  if (!res.ok) throw new Error(`metrics failed: ${res.status}`);
  return res.json();
}

export async function getModelStatus() {
  const res = await fetch(ROUTES.modelStatus);
  if (!res.ok) throw new Error(`model status failed: ${res.status}`);
  return res.json();
}

export async function getResults(id) {
  const res = await fetch(ROUTES.results(id));
  if (!res.ok) throw new Error(`results failed: ${res.status}`);
  return res.json();
}

export async function getWorkspaces() {
  const res = await fetch(ROUTES.workspaces);
  if (!res.ok) throw new Error(`getWorkspaces failed: ${res.status}`);
  return res.json();
}

export async function saveWorkspace(ws) {
  const res = await fetch(ROUTES.workspaces, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ws),
  });
  if (!res.ok) throw new Error(`saveWorkspace failed: ${res.status}`);
  return res.json();
}

export async function updateWorkspace(id, data) {
  const res = await fetch(ROUTES.workspace(id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`updateWorkspace failed: ${res.status}`);
  return res.json();
}

export async function deleteWorkspace(id) {
  const res = await fetch(ROUTES.workspace(id), { method: 'DELETE' });
  if (!res.ok) throw new Error(`deleteWorkspace failed: ${res.status}`);
  return res.json();
}
