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
            case 'stopWatch':
                await vscode.commands.executeCommand('ioraDev.stopWatch', msg.id);
                break;
            case 'refresh':
                await this.refresh();
                break;
            case 'logs':
                await vscode.commands.executeCommand('ioraDev.logs');
                break;
        }
    }
    html() {
        return /* html */ `<!DOCTYPE html><html><head>
<meta charset="utf-8" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 12px; }
  .row { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
  .card { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-editorWidget-border); border-radius: 6px; padding: 12px; min-width: 280px; flex: 1; }
  .card h2 { margin: 0 0 8px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--vscode-descriptionForeground); }
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
  pre { white-space: pre-wrap; font-size: 11px; max-height: 200px; overflow: auto; background: var(--vscode-textBlockQuote-background); padding: 6px; border-radius: 3px; }
</style>
</head><body>
<div class="row">
  <div class="card" style="flex:0 0 100%;">
    <h2>Connection</h2>
    <div id="conn">loading…</div>
    <div style="margin-top:8px;">
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
  <div class="card">
    <h2>Devices on LAN</h2>
    <table><thead><tr><th>Instance</th><th>Address</th><th>Build</th></tr></thead><tbody id="devices"></tbody></table>
  </div>
  <div class="card">
    <h2>Active Watch Sessions</h2>
    <table><thead><tr><th>Components</th><th>Target</th><th></th></tr></thead><tbody id="watches"></tbody></table>
  </div>
</div>
<div class="row">
  <div class="card" style="flex:1 1 100%;">
    <h2>Recent Jobs</h2>
    <table><thead><tr><th>When</th><th>Kind</th><th>Label</th><th>Status</th></tr></thead><tbody id="jobs"></tbody></table>
    <pre id="job-log" class="muted">(select a job to see its log)</pre>
  </div>
</div>
<script>
const vscode = acquireVsCodeApi();
const state = { devices: [], watches: [], jobs: [], components: [], conn: null };
function post(cmd, extra) { vscode.postMessage(Object.assign({ cmd }, extra || {})); }
function html(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function render() {
  const c = state.conn || {};
  document.getElementById('conn').innerHTML = c.host
    ? '<b>'+html(c.host)+'</b> &mdash; '+html(c.hostname || '?')+' (build '+html(c.build || '?')+', variant <span class="'+ (c.variant==='dev'?'ok':'err') +'">'+html(c.variant||'?')+'</span>) '
      + (c.reachable===false ? '<span class="err">[unreachable]</span>' : '<span class="ok">[connected]</span>')
    : '<span class="muted">no device configured</span>';
  document.getElementById('devices').innerHTML = state.devices.map(d => {
    const inst = d.instance.replace(/_iora-dev\\._tcp\\.local\\.?$/,'').replace(/\\.$/,'');
    const ep = (d.addrs[0]||d.host)+':'+d.port;
    return '<tr><td>'+html(inst)+'</td><td><code>'+html(ep)+'</code></td><td>'+html((d.txt&&d.txt.build)||'?')+'</td></tr>';
  }).join('') || '<tr><td colspan="3" class="muted">no devices yet — click Discover</td></tr>';
  document.getElementById('watches').innerHTML = state.watches.map(w =>
    '<tr><td>'+html(w.components.join(', '))+'</td><td><code>'+html(w.target)+'</code></td>'
    +'<td><button onclick="post(\\'stopWatch\\',{id:\\''+w.id+'\\'})">Stop</button></td></tr>'
  ).join('') || '<tr><td colspan="3" class="muted">no active sessions</td></tr>';
  document.getElementById('jobs').innerHTML = state.jobs.slice(0,30).map((j,i) =>
    '<tr onclick="showLog('+i+')" style="cursor:pointer"><td><code>'+html(new Date(j.started_at).toLocaleTimeString())+'</code></td>'
    +'<td>'+html(j.kind)+'</td><td>'+html(j.label)+'</td>'
    +'<td><span class="status-pill status-'+j.status+'">'+j.status+'</span></td></tr>'
  ).join('') || '<tr><td colspan="4" class="muted">no jobs</td></tr>';
}
function showLog(i){
  const j = state.jobs[i]; if (!j) return;
  document.getElementById('job-log').textContent = j.log.join('\\n');
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
      }
    } else if (p.type === 'connection') {
      state.conn = { host: p.host, hostname: p.hostname, build: p.build, variant: p.variant, reachable: !!p.host };
    }
    render();
  } else if (m.kind === 'error') {
    document.getElementById('conn').innerHTML = '<span class="err">'+html(m.message)+'</span>';
  }
});
post('refresh');
</script>
</body></html>`;
    }
}
exports.Dashboard = Dashboard;
//# sourceMappingURL=dashboard.js.map