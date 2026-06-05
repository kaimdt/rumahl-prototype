// IORA Plugin Sandbox Runtime
// Schlanker Node.js-HTTP-Server, der Plugins aus /plugins/<id>/index.js lädt
// und über `/execute/<id>` ausführt.
//
// Sicherheitsmodell:
// - Plugins werden mit `vm.runInContext` in einem isolierten Context geladen.
// - Nur ein minimales `iora` API ist exponiert (log, return wert).
// - Kein direkter Zugriff auf require/process/fs für Plugin-Code.
// - Resource-Limits werden vom Container (cgroups) erzwungen, nicht hier.

const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PLUGINS_DIR = '/plugins';
const PORT = 8765;
const EXEC_TIMEOUT_MS = 5000;

const loaded = new Map(); // pluginId -> { manifest, script }

function loadPlugins() {
  loaded.clear();
  let count = 0;
  if (!fs.existsSync(PLUGINS_DIR)) return 0;
  for (const id of fs.readdirSync(PLUGINS_DIR)) {
    const dir = path.join(PLUGINS_DIR, id);
    const indexPath = path.join(dir, 'index.js');
    const manifestPath = path.join(dir, 'manifest.json');
    if (!fs.existsSync(indexPath)) continue;
    try {
      const source = fs.readFileSync(indexPath, 'utf8');
      const script = new vm.Script(source, { filename: `plugins/${id}/index.js` });
      let manifest = {};
      if (fs.existsSync(manifestPath)) {
        try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (_) {}
      }
      loaded.set(id, { manifest, script });
      count++;
    } catch (e) {
      console.error(`[sandbox] failed to load ${id}:`, e.message);
    }
  }
  console.log(`[sandbox] loaded ${count} plugins`);
  return count;
}

function runPlugin(id, input) {
  const entry = loaded.get(id);
  if (!entry) throw new Error(`plugin not found: ${id}`);
  const logs = [];
  let result = null;
  let error = null;
  const ctx = vm.createContext({
    iora: {
      log: (msg) => logs.push({ level: 'info', msg: String(msg) }),
      error: (msg) => logs.push({ level: 'error', msg: String(msg) }),
      input: input,
      manifest: entry.manifest,
      result: (v) => { result = v; },
    },
    console: {
      log: (...a) => logs.push({ level: 'info', msg: a.map(String).join(' ') }),
      error: (...a) => logs.push({ level: 'error', msg: a.map(String).join(' ') }),
    },
  });
  try {
    entry.script.runInContext(ctx, { timeout: EXEC_TIMEOUT_MS });
  } catch (e) {
    error = String(e && e.message || e);
  }
  return { ok: !error, result, error, logs };
}

const server = http.createServer((req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (req.method === 'GET' && req.url === '/health') {
    return send(200, { ok: true, plugins: loaded.size });
  }
  if (req.method === 'POST' && req.url === '/reload') {
    const n = loadPlugins();
    return send(200, { ok: true, plugins: n });
  }
  if (req.method === 'GET' && req.url === '/plugins') {
    const list = Array.from(loaded.keys());
    return send(200, { plugins: list });
  }
  if (req.method === 'POST' && req.url.startsWith('/execute/')) {
    const id = req.url.slice('/execute/'.length);
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let input = {};
      try { input = body ? JSON.parse(body) : {}; } catch (_) {}
      try {
        const r = runPlugin(id, input);
        send(r.ok ? 200 : 500, r);
      } catch (e) {
        send(404, { ok: false, error: String(e.message || e) });
      }
    });
    return;
  }
  send(404, { ok: false, error: 'unknown route' });
});

loadPlugins();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[sandbox] runtime ready on :${PORT}`);
});
