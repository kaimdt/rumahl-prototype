/**
 * ORA Shopping List — installable lifestyle app (Package 6).
 * Persists data via the ORA App Storage KV API using the app token.
 */
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const IORA_HOME = process.env.IORA_HOME_URL || 'http://iora-home:3001';
const APP_ID = process.env.IORA_APP_ID || 'ora-shopping';
const KV_KEY = 'items';

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (process.env.IORA_API_KEY) h['Authorization'] = 'Bearer ' + process.env.IORA_API_KEY;
  return h;
}

async function loadData() {
  try {
    const r = await fetch(`${IORA_HOME}/api/apps/${APP_ID}/storage/kv/${KV_KEY}`, { headers: headers() });
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data.value) ? data.value : [];
  } catch { return []; }
}

async function saveData(data) {
  await fetch(`${IORA_HOME}/api/apps/${APP_ID}/storage/kv/${KV_KEY}`, {
    method: 'PUT', headers: headers(),
    body: JSON.stringify({ key: KV_KEY, value: data }),
  });
}

app.get('/api/items', async (_req, res) => res.json(await loadData()));
app.post('/api/items', async (req, res) => {
  const items = await loadData();
  const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), created_at: new Date().toISOString(), ...(req.body || {}) };
  items.push(item);
  await saveData(items);
  res.status(201).json(item);
});
app.put('/api/items/:id', async (req, res) => {
  const items = await loadData();
  const index = items.findIndex((i) => i.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'not found' });
  items[index] = { ...items[index], ...(req.body || {}), updated_at: new Date().toISOString() };
  await saveData(items);
  res.json(items[index]);
});
app.delete('/api/items/:id', async (req, res) => {
  const items = await loadData();
  await saveData(items.filter((i) => i.id !== req.params.id));
  res.json({ deleted: true });
});
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.listen(PORT, () => console.log(`ORA Shopping List listening on :${PORT} (storage via ${IORA_HOME})`));
