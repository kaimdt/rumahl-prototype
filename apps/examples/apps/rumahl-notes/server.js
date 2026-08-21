/**
 * rumahl Notes — installable lifestyle app (Package 6).
 *
 * Demonstrates the rumahl App Framework for third-party apps:
 *   • App Storage KV  → notes are persisted via the rumahl storage API
 *     (PUT/GET /api/apps/<app-id>/storage/kv/<key>) using the app token.
 *   • Custom page     → the app registers a launcher page (/apps/rumahl-notes/).
 *   • Health check    → the supervisor polls /health.
 *
 * The app runs in its own Docker container; it never talks to the rumahl
 * database directly — only through the app-scoped storage API.
 */
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const RUMAHL_HOME = process.env.RUMAHL_HOME_URL || 'http://rumahl-home:3001';
const APP_ID = process.env.RUMAHL_APP_ID || 'rumahl-notes';
const KV_KEY = 'notes';

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/** Auth header for rumahl app-storage calls (token injected by the supervisor). */
function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (process.env.RUMAHL_API_KEY) h['Authorization'] = 'Bearer ' + process.env.RUMAHL_API_KEY;
  return h;
}

async function loadNotes() {
  try {
    const r = await fetch(`${RUMAHL_HOME}/api/apps/${APP_ID}/storage/kv/${KV_KEY}`, { headers: headers() });
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data.value) ? data.value : [];
  } catch {
    return [];
  }
}

async function saveNotes(notes) {
  await fetch(`${RUMAHL_HOME}/api/apps/${APP_ID}/storage/kv/${KV_KEY}`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify({ key: KV_KEY, value: notes }),
  });
}

// ── REST API ───────────────────────────────────────────────────────────────

app.get('/api/notes', async (_req, res) => {
  res.json(await loadNotes());
});

app.post('/api/notes', async (req, res) => {
  const title = String(req.body?.title || '').trim().slice(0, 200);
  const content = String(req.body?.content || '').slice(0, 50_000);
  if (!title) return res.status(400).json({ error: 'title required' });
  const notes = await loadNotes();
  const now = new Date().toISOString();
  const note = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    title,
    content,
    created_at: now,
    updated_at: now,
  };
  notes.unshift(note);
  await saveNotes(notes);
  res.status(201).json(note);
});

app.put('/api/notes/:id', async (req, res) => {
  const notes = await loadNotes();
  const index = notes.findIndex((n) => n.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'not found' });
  const updated = {
    ...notes[index],
    ...(req.body?.title !== undefined ? { title: String(req.body.title).trim().slice(0, 200) } : {}),
    ...(req.body?.content !== undefined ? { content: String(req.body.content).slice(0, 50_000) } : {}),
    updated_at: new Date().toISOString(),
  };
  notes[index] = updated;
  await saveNotes(notes);
  res.json(updated);
});

app.delete('/api/notes/:id', async (req, res) => {
  const notes = await loadNotes();
  await saveNotes(notes.filter((n) => n.id !== req.params.id));
  res.json({ deleted: true });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`rumahl Notes listening on :${PORT} (storage via ${RUMAHL_HOME})`);
});
