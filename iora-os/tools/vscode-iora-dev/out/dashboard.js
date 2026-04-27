"use strict";
// IORA OS Dev — Dashboard webview.
//
// Shows live device + watch + job state by subscribing to the daemon's
// /api/v1/events WebSocket. Posts a fresh snapshot whenever the panel is
// re-opened.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Dashboard = void 0;
const vscode = __importStar(require("vscode"));
class Dashboard {
    context;
    getClient;
    panel;
    constructor(context, getClient) {
        this.context = context;
        this.getClient = getClient;
    }
    show() {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Active);
            return;
        }
        this.panel = vscode.window.createWebviewPanel('ioraDevDashboard', 'IORA OS Dev — Dashboard', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
        this.panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'icon.svg');
        this.panel.webview.html = this.html();
        this.panel.onDidDispose(() => this.panel = undefined);
        this.panel.webview.onDidReceiveMessage(msg => this.onMsg(msg));
        this.refresh();
    }
    update(events) {
        this.panel?.webview.postMessage({ kind: 'event', payload: events });
    }
    async refresh() {
        const c = this.getClient();
        if (!c || !this.panel)
            return;
        try {
            const [conn, devices, watches, jobs, comps] = await Promise.all([
                c.connection().catch(() => ({ host: null, configured: false })),
                c.devices().catch(() => []),
                c.watches().catch(() => []),
                c.jobs().catch(() => []),
                c.components().catch(() => []),
            ]);
            this.panel.webview.postMessage({ kind: 'snapshot', conn, devices, watches, jobs, components: comps });
        }
        catch (e) {
            this.panel.webview.postMessage({ kind: 'error', message: String(e.message ?? e) });
        }
    }
    async onMsg(msg) {
        const c = this.getClient();
        switch (msg?.cmd) {
            case 'discover':
                await vscode.commands.executeCommand('ioraDev.discover');
                break;
            case 'connect':
                await vscode.commands.executeCommand('ioraDev.connect');
                break;
            case 'deploy':
                await vscode.commands.executeCommand('ioraDev.deploy');
                break;
            case 'watch':
                await vscode.commands.executeCommand('ioraDev.watch');
                break;
            case 'deployComponent':
                await vscode.commands.executeCommand('ioraDev.deployFromTree', { label: msg.component });
                break;
            case 'watchComponent':
                await vscode.commands.executeCommand('ioraDev.watchFromTree', { label: msg.component });
                break;
            case 'componentActions':
                await vscode.commands.executeCommand('ioraDev.componentActions', { label: msg.component });
                break;
            case 'stopWatch':
                await vscode.commands.executeCommand('ioraDev.stopWatch', msg.id);
                break;
            case 'refresh':
                await this.refresh();
                break;
            case 'logs':
                await vscode.commands.executeCommand('ioraDev.logs');
                break;
            case 'serviceLogs':
                if (!c || !this.panel)
                    break;
                try {
                    const logs = await c.serviceLogs(msg.unit, msg.tail || 250);
                    this.panel.webview.postMessage({ kind: 'serviceLogs', unit: msg.unit, payload: logs });
                }
                catch (e) {
                    this.panel.webview.postMessage({ kind: 'error', message: String(e.message ?? e) });
                }
                break;
            case 'systemList':
                if (!c || !this.panel)
                    break;
                try {
                    const listing = await c.systemList(msg.path || '/etc');
                    this.panel.webview.postMessage({ kind: 'systemData', mode: 'list', payload: listing });
                }
                catch (e) {
                    this.panel.webview.postMessage({ kind: 'error', message: String(e.message ?? e) });
                }
                break;
            case 'systemRead':
                if (!c || !this.panel)
                    break;
                try {
                    const file = await c.systemRead(msg.path, msg.max_bytes || 65536);
                    this.panel.webview.postMessage({ kind: 'systemData', mode: 'read', payload: file });
                }
                catch (e) {
                    this.panel.webview.postMessage({ kind: 'error', message: String(e.message ?? e) });
                }
                break;
        }
    }
    html() {
        return /* html */ `<!DOCTYPE html><html><head>
<meta charset="utf-8" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 12px; }
  .row { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
  .card { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-editorWidget-border); border-radius: 8px; padding: 12px; min-width: 280px; flex: 1; }
  .card h2 { margin: 0 0 8px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--vscode-descriptionForeground); }
  .metric { display:flex; justify-content:space-between; border-top: 1px solid var(--vscode-editorWidget-border); padding: 6px 0; font-size: 12px; }
  .metric:first-of-type { border-top: none; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 10px; cursor: pointer; border-radius: 3px; margin-right: 6px; margin-bottom: 4px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  td, th { text-align: left; padding: 3px 6px; border-bottom: 1px solid var(--vscode-editorWidget-border); }
  .ok { color: var(--vscode-testing-iconPassed); }
  .err { color: var(--vscode-errorForeground); }
  .muted { color: var(--vscode-descriptionForeground); }
  .status-pill { display: inline-block; padding: 1px 8px; border-radius: 8px; font-size: 11px; }
  .status-running   { background: var(--vscode-charts-blue); color: white; }
  .status-succeeded { background: var(--vscode-testing-iconPassed); color: white; }
  .status-failed    { background: var(--vscode-errorForeground); color: white; }
  .status-pending,.status-canceled { background: var(--vscode-descriptionForeground); color: white; }
  .toolbar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:8px; }
  input { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; padding: 4px 8px; }
  .panel-scroll { max-height: 260px; overflow: auto; border: 1px solid var(--vscode-editorWidget-border); border-radius: 6px; background: var(--vscode-textBlockQuote-background); }
  .job-summary { display:grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap:8px; margin-bottom:10px; }
  .job-summary .metric { background: var(--vscode-editor-background); border: 1px solid var(--vscode-editorWidget-border); border-radius: 6px; padding: 8px; }
  .log-line { display:flex; gap:8px; padding:6px 8px; border-top: 1px solid var(--vscode-editorWidget-border); font-size: 12px; }
  .log-line:first-child { border-top:none; }
  .log-icon { width: 20px; text-align:center; font-weight: bold; }
  .log-build .log-icon, .log-build { color: var(--vscode-charts-blue); }
  .log-ok .log-icon, .log-ok { color: var(--vscode-testing-iconPassed); }
  .log-error .log-icon, .log-error { color: var(--vscode-errorForeground); }
  .log-info .log-icon, .log-info { color: var(--vscode-descriptionForeground); }
  .mono { font-family: var(--vscode-editor-font-family); }
  .entry-dir { color: var(--vscode-charts-blue); }
  .entry-file { color: var(--vscode-foreground); }
  pre { white-space: pre-wrap; font-size: 11px; max-height: 240px; overflow: auto; background: var(--vscode-textBlockQuote-background); padding: 6px; border-radius: 3px; }
</style>
</head><body>
<div class="row">
  <div class="card">
    <h2>Connected Server</h2>
    <div id="conn">loading…</div>
  </div>
  <div class="card">
    <h2>Current Activity</h2>
    <div id="activity">loading…</div>
  </div>
  <div class="card">
    <h2>Actions</h2>
    <div>
      <button onclick="post('discover')">Discover</button>
      <button onclick="post('connect')">Connect…</button>
      <button onclick="post('deploy')">Deploy…</button>
      <button onclick="post('watch')">Watch…</button>
      <button onclick="post('logs')">Logs…</button>
      <button onclick="post('refresh')">Refresh</button>
    </div>
  </div>
</div>
<div class="row">
  <div class="card" style="flex:1 1 100%;">
    <h2>Components</h2>
    <table><thead><tr><th>Component</th><th>Unit</th><th>Target</th><th>Actions</th></tr></thead><tbody id="components"></tbody></table>
  </div>
</div>
<div class="row">
  <div class="card">
    <h2>Devices on LAN</h2>
    <table><thead><tr><th>Instance</th><th>Address</th><th>Build</th></tr></thead><tbody id="devices"></tbody></table>
  </div>
  <div class="card">
    <h2>Active Watch Sessions</h2>
    <table><thead><tr><th>Components</th><th>Mode</th><th>Target</th><th></th></tr></thead><tbody id="watches"></tbody></table>
  </div>
</div>
<div class="row">
  <div class="card" style="flex:1 1 100%;">
    <h2>Live Activity</h2>
    <div id="activity-stream" class="panel-scroll muted" style="padding:8px;">(waiting for live events)</div>
  </div>
</div>
<div class="row">
  <div class="card">
    <h2>Service Logs</h2>
    <div class="toolbar">
      <input id="service-unit" placeholder="iora-assist.service" style="min-width:220px;" />
      <button onclick="loadServiceLogs()">Load Logs</button>
    </div>
    <pre id="service-logs" class="muted">(load a systemd unit log)</pre>
  </div>
  <div class="card">
    <h2>System Data</h2>
    <div class="toolbar">
      <input id="system-path" value="/etc" style="min-width:220px;" />
      <button onclick="browsePath()">Browse</button>
      <button onclick="readPath()">Read File</button>
    </div>
    <div id="system-data" class="panel-scroll muted" style="padding:8px;">(browse files or read a file preview)</div>
  </div>
</div>
<div class="row">
  <div class="card" style="flex:1 1 100%;">
    <h2>Recent Jobs</h2>
    <table><thead><tr><th>When</th><th>Kind</th><th>Label</th><th>Status</th></tr></thead><tbody id="jobs"></tbody></table>
    <div id="job-log" class="panel-scroll muted" style="padding:8px;">(select a job to see its log)</div>
  </div>
</div>
<script>
const vscode = acquireVsCodeApi();
const state = { devices: [], watches: [], jobs: [], components: [], conn: null, currentJobIndex: null, activity: [], liveServiceUnit: null, liveServiceTimer: null };
function post(cmd, extra) { vscode.postMessage(Object.assign({ cmd }, extra || {})); }
function html(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function bridgeCapability(c) { return Array.isArray(c.capabilities) && c.capabilities.includes('binary.build_replace'); }
function componentByName(name) { return state.components.find(c => c.name === name); }
function pushActivity(line) {
  if (!line) return;
  state.activity.unshift({ when: new Date().toLocaleTimeString(), line });
  if (state.activity.length > 60) state.activity.length = 60;
}
function classifyLog(line) {
  if (line.startsWith('✗')) return { cls: 'log-error', icon: '✗' };
  if (line.startsWith('✓')) return { cls: 'log-ok', icon: '✓' };
  if (line.startsWith('▶')) return { cls: 'log-build', icon: '▶' };
  return { cls: 'log-info', icon: '·' };
}
function renderJobLog() {
  const el = document.getElementById('job-log');
  const j = state.currentJobIndex == null ? null : state.jobs[state.currentJobIndex];
  if (!j) {
    el.innerHTML = '<span class="muted">(select a job to see its log)</span>';
    return;
  }
  const lines = (j.log || []).map(line => {
    const meta = classifyLog(line);
    return '<div class="log-line '+meta.cls+'"><div class="log-icon">'+meta.icon+'</div><div class="mono">'+html(line)+'</div></div>';
  }).join('') || '<div class="muted" style="padding:8px;">no log lines yet</div>';
  el.innerHTML = ''
    + '<div class="job-summary">'
    +   '<div class="metric"><span>Status</span><span class="status-pill status-'+html(j.status)+'">'+html(j.status)+'</span></div>'
    +   '<div class="metric"><span>Kind</span><span>'+html(j.kind)+'</span></div>'
    +   '<div class="metric"><span>Started</span><span>'+html(new Date(j.started_at).toLocaleTimeString())+'</span></div>'
    +   '<div class="metric"><span>Lines</span><span>'+String((j.log || []).length)+'</span></div>'
    + '</div>'
    + '<div class="panel-scroll">'+lines+'</div>';
}
function loadServiceLogs(unit) {
  const value = unit || document.getElementById('service-unit').value.trim();
  if (!value) return;
  if (state.liveServiceTimer) { clearInterval(state.liveServiceTimer); state.liveServiceTimer = null; }
  state.liveServiceUnit = value;
  document.getElementById('service-unit').value = value;
  document.getElementById('service-logs').textContent = 'loading ' + value + '...';
  post('serviceLogs', { unit: value, tail: 250 });
  state.liveServiceTimer = setInterval(() => post('serviceLogs', { unit: value, tail: 250 }), 2500);
}
function browsePath(path) {
  const value = path || document.getElementById('system-path').value.trim() || '/etc';
  document.getElementById('system-path').value = value;
  document.getElementById('system-data').innerHTML = '<span class="muted">loading '+html(value)+'...</span>';
  post('systemList', { path: value });
}
function readPath(path) {
  const value = path || document.getElementById('system-path').value.trim();
  if (!value) return;
  document.getElementById('system-path').value = value;
  document.getElementById('system-data').innerHTML = '<span class="muted">reading '+html(value)+'...</span>';
  post('systemRead', { path: value, max_bytes: 65536 });
}
function render() {
  const c = state.conn || {};
  const bridgeOk = bridgeCapability(c);
  document.getElementById('conn').innerHTML = c.host
    ? '<div><b>'+html(c.hostname || c.host)+'</b></div>'
      + '<div class="muted"><code>'+html(c.host)+'</code></div>'
      + '<div class="metric"><span>Build</span><span>'+html(c.build || '?')+'</span></div>'
      + '<div class="metric"><span>Variant</span><span class="'+ (c.variant==='dev'?'ok':'err') +'">'+html(c.variant||'?')+'</span></div>'
      + '<div class="metric"><span>Status</span><span class="'+ (c.reachable===false ? 'err' : 'ok') +'">'+(c.reachable===false ? 'unreachable' : 'connected')+'</span></div>'
      + '<div class="metric"><span>Device bridge</span><span class="'+ (bridgeOk ? 'ok' : 'err') +'">'+(bridgeOk ? 'remote build ready' : 'update required')+'</span></div>'
      + (bridgeOk ? '' : '<div class="muted" style="padding-top:6px;">This device does not report <code>binary.build_replace</code>. Update <code>iora-dev-bridge</code> on the target before using device build mode.</div>')
    : '<span class="muted">no device configured</span>';
  const running = state.jobs.filter(j => j.status === 'running' || j.status === 'pending').length;
  const failed = state.jobs.filter(j => j.status === 'failed').length;
  const watchMode = state.watches[0]?.build_mode || 'device';
  document.getElementById('activity').innerHTML = [
    ['Build mode', watchMode],
    ['Running jobs', String(running)],
    ['Active watches', String(state.watches.length)],
    ['Failed jobs', String(failed)],
  ].map(([k,v]) => '<div class="metric"><span>'+html(k)+'</span><span>'+html(v)+'</span></div>').join('');
  document.getElementById('devices').innerHTML = state.devices.map(d => {
    const inst = d.instance.replace(/_iora-dev\\._tcp\\.local\\.?$/,'').replace(/\\.$/,'');
    const ep = (d.addrs[0]||d.host)+':'+d.port;
    return '<tr><td>'+html(inst)+'</td><td><code>'+html(ep)+'</code></td><td>'+html((d.txt&&d.txt.build)||'?')+'</td></tr>';
  }).join('') || '<tr><td colspan="3" class="muted">no devices yet — click Discover</td></tr>';
  document.getElementById('components').innerHTML = state.components.map(c =>
    '<tr><td>'+html(c.name)+'</td><td><code>'+html(c.unit)+'</code></td><td><code>'+html(c.target_path)+'</code></td>'
    +'<td>'
    +'<button onclick="post(\'deployComponent\',{component:\''+html(c.name)+'\'})">🚀</button>'
    +'<button onclick="post(\'watchComponent\',{component:\''+html(c.name)+'\'})">👁</button>'
    +'<button onclick="loadServiceLogs(\''+html(c.unit)+'\')">Logs</button>'
    +'<button onclick="post(\'componentActions\',{component:\''+html(c.name)+'\'})">⋯</button>'
    +'</td></tr>'
  ).join('') || '<tr><td colspan="4" class="muted">no components loaded</td></tr>';
  document.getElementById('watches').innerHTML = state.watches.map(w =>
    '<tr><td>'+html(w.automatic ? 'Automatic workspace mode' : w.components.join(', '))+'</td><td>'+html((w.build_mode || '?') + (w.automatic ? ' • automatic' : ''))+'</td><td><code>'+html(w.target)+'</code></td>'
    +'<td>'
    +(componentByName(w.components[0]) ? '<button onclick="loadServiceLogs(\''+html(componentByName(w.components[0]).unit)+'\')">Logs</button>' : '')
    +'<button onclick="post(\\'stopWatch\\',{id:\\''+w.id+'\\'})">Stop</button></td></tr>'
  ).join('') || '<tr><td colspan="4" class="muted">no active sessions</td></tr>';
  document.getElementById('jobs').innerHTML = state.jobs.slice(0,30).map((j,i) =>
    '<tr onclick="showLog('+i+')" style="cursor:pointer"><td><code>'+html(new Date(j.started_at).toLocaleTimeString())+'</code></td>'
    +'<td>'+html(j.kind)+'</td><td>'+html(j.label)+'</td>'
    +'<td><span class="status-pill status-'+j.status+'">'+j.status+'</span></td></tr>'
  ).join('') || '<tr><td colspan="4" class="muted">no jobs</td></tr>';
  document.getElementById('activity-stream').innerHTML = state.activity.map(entry =>
    '<div class="log-line"><div class="log-icon">•</div><div class="mono"><span class="muted">['+html(entry.when)+']</span> '+html(entry.line)+'</div></div>'
  ).join('') || '<span class="muted">(waiting for live events)</span>';
  renderJobLog();
}
function showLog(i){
  state.currentJobIndex = i;
  renderJobLog();
}
window.addEventListener('message', ev => {
  const m = ev.data;
  if (m.kind === 'snapshot') {
    Object.assign(state, m); render();
  } else if (m.kind === 'event') {
    const p = m.payload;
    if (p.type === 'devices_updated') state.devices = p.devices;
    else if (p.type === 'watch_started') state.watches.push(p.session);
    else if (p.type === 'watch_stopped') state.watches = state.watches.filter(w => w.id !== p.id);
    else if (p.type === 'job_created' || p.type === 'job_finished') {
      const j = p.job; const idx = state.jobs.findIndex(x => x.id === j.id);
      if (idx >= 0) state.jobs[idx] = j; else state.jobs.unshift(j);
    } else if (p.type === 'job_updated') {
      const idx = state.jobs.findIndex(x => x.id === p.id);
      if (idx >= 0) {
        state.jobs[idx].status = p.status;
        if (p.line) state.jobs[idx].log.push(p.line);
        if (p.line) pushActivity(p.line);
      }
    } else if (p.type === 'connection') {
      state.conn = { host: p.host, hostname: p.hostname, build: p.build, variant: p.variant, reachable: !!p.host, capabilities: state.conn && state.conn.host === p.host ? state.conn.capabilities : undefined };
      pushActivity('connection changed to ' + (p.host || 'none'));
    } else if (p.type === 'watch_triggered') {
      pushActivity('watch triggered for ' + (Array.isArray(p.components) ? p.components.join(', ') : 'unknown component'));
    } else if (p.type === 'service_logs') {
      document.getElementById('service-logs').textContent = p.stdout + (p.stderr ? '\n--- stderr ---\n' + p.stderr : '');
      pushActivity('service logs updated for ' + p.unit);
    } else if (p.type === 'system_data') {
      if (p.kind === 'directory' && p.content && Array.isArray(p.content.entries)) {
        document.getElementById('system-data').innerHTML = p.content.entries.map(entry =>
          '<div class="log-line"><div class="log-icon">'+(entry.kind === 'dir' ? '📁' : '📄')+'</div><div class="mono '+(entry.kind === 'dir' ? 'entry-dir' : 'entry-file')+'" onclick="'+(entry.kind === 'dir' ? 'browsePath' : 'readPath')+'(\''+html(entry.path)+'\')" style="cursor:pointer;">'+html(entry.path)+' <span class="muted">('+html(entry.kind)+', '+String(entry.size)+' bytes)</span></div></div>'
        ).join('') || '<span class="muted">no entries</span>';
      } else if (p.kind === 'file' && p.content) {
        const file = p.content;
        document.getElementById('system-data').innerHTML = '<div class="muted" style="padding:8px;">'+html(file.path)+' · '+String(file.bytes)+'/'+String(file.total_bytes)+' bytes'+(file.truncated ? ' · truncated' : '')+(file.binary_hint ? ' · binary preview' : '')+'</div><pre>'+html(file.content || '')+'</pre>';
      }
    }
    render();
  } else if (m.kind === 'serviceLogs') {
    document.getElementById('service-logs').textContent = m.payload.stdout + (m.payload.stderr ? '\n--- stderr ---\n' + m.payload.stderr : '');
    pushActivity('service logs loaded for ' + (m.unit || state.liveServiceUnit || 'unknown service'));
  } else if (m.kind === 'systemData') {
    const p = m.payload;
    if (m.mode === 'list') {
      document.getElementById('system-data').innerHTML = p.entries.map(entry =>
        '<div class="log-line"><div class="log-icon">'+(entry.kind === 'dir' ? '📁' : '📄')+'</div><div class="mono '+(entry.kind === 'dir' ? 'entry-dir' : 'entry-file')+'" onclick="'+(entry.kind === 'dir' ? 'browsePath' : 'readPath')+'(\''+html(entry.path)+'\')" style="cursor:pointer;">'+html(entry.path)+' <span class="muted">('+html(entry.kind)+', '+String(entry.size)+' bytes)</span></div></div>'
      ).join('') || '<span class="muted">no entries</span>';
    } else {
      document.getElementById('system-data').innerHTML = '<div class="muted" style="padding:8px;">'+html(p.path)+' · '+String(p.bytes)+'/'+String(p.total_bytes)+' bytes'+(p.truncated ? ' · truncated' : '')+(p.binary_hint ? ' · binary preview' : '')+'</div><pre>'+html(p.content || '')+'</pre>';
    }
  } else if (m.kind === 'error') {
    document.getElementById('conn').innerHTML = '<span class="err">'+html(m.message)+'</span>';
  }
});
post('refresh');
browsePath('/etc');
</script>
</body></html>`;
    }
}
exports.Dashboard = Dashboard;
//# sourceMappingURL=dashboard.js.map