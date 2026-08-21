// rumahl OS Dev — Dashboard webview.
//
// Shows live device + watch + job + service state by subscribing to the
// daemon's /api/v1/events WebSocket and polling REST endpoints.
//
// Architecture: The extension pushes the latest connection state into the
// dashboard via update() (from WS events) and pushConnState() (on open).
// The webview never shows "not connected" if the extension says connected.

import * as vscode from 'vscode';
import { Connection, DaemonClient } from './api';

export class Dashboard {
    private panel?: vscode.WebviewPanel;
    private refreshTimer?: NodeJS.Timeout;
    private latestConn: Connection | null = null;

    constructor(
        private context: vscode.ExtensionContext,
        private getClient: () => DaemonClient | undefined,
    ) {}

    /** Push latest connection state into the dashboard (called from extension's event loop). */
    setConnection(conn: Connection | null) {
        console.log('[rumahl-dash] setConnection: host=' + (conn?.host ?? 'null'));
        this.latestConn = conn;
        this.pushConnState();
    }

    private pushConnState() {
        if (!this.panel) {
            console.log('[rumahl-dash] pushConnState: no panel, skipping');
            return;
        }
        console.log('[rumahl-dash] pushConnState: sending connState, host=' + (this.latestConn?.host ?? 'null'));
        this.panel.webview.postMessage({
            kind: 'connState',
            conn: this.latestConn,
            _debug: 'pushConnState host=' + (this.latestConn?.host ?? 'null'),
        });
    }

    show() {
        if (this.panel) { this.panel.reveal(vscode.ViewColumn.Active); return; }
        this.panel = vscode.window.createWebviewPanel(
            'oraDevDashboard',
            'rumahl OS Dev — Dashboard',
            vscode.ViewColumn.Active,
            { enableScripts: true, retainContextWhenHidden: true },
        );
        this.panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'icon.svg');
        this.panel.webview.onDidReceiveMessage(msg => this.onMsg(msg));
        this.panel.webview.html = this.html();
        this.panel.onDidDispose(() => {
            this.panel = undefined;
            if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = undefined; }
        });
    }

    update(events: any) {
        if (!this.panel) return;
        const payload: any = { kind: 'event', payload: events };
        // Always attach the latest connection state
        if (events?.type === 'connection' && events.host) {
            payload.conn = {
                host: events.host,
                hostname: events.hostname,
                build: events.build,
                variant: events.variant,
                reachable: true,
            };
        } else if (this.latestConn?.host) {
            payload.conn = this.latestConn;
        }
        this.panel.webview.postMessage(payload);
    }

    private async onMsg(msg: any) {
        if (msg?.cmd === 'ready') {
            console.log('[rumahl-dash] webview READY received, latestConn=' + (this.latestConn?.host ?? 'null') + ' panel=' + (this.panel ? 'yes' : 'no'));
            // Webview is now initialized. Push state + start refreshing.
            this.pushConnState();
            this.refresh();
            if (!this.refreshTimer) {
                this.refreshTimer = setInterval(() => this.refresh(), 5000);
            }
            return;
        }
        const c = this.getClient();
        switch (msg?.cmd) {
            case 'connect':         await vscode.commands.executeCommand('oraDev.connect'); break;
            case 'discover':        await vscode.commands.executeCommand('oraDev.discover'); break;
            case 'deploy':          await vscode.commands.executeCommand('oraDev.deploy'); break;
            case 'watch':           await vscode.commands.executeCommand('oraDev.watch'); break;
            case 'deployComponent': await vscode.commands.executeCommand('oraDev.deployFromTree', { name: msg.component }); break;
            case 'watchComponent':  await vscode.commands.executeCommand('oraDev.watchFromTree', { name: msg.component }); break;
            case 'stopWatch':       await vscode.commands.executeCommand('oraDev.stopWatch', msg.id); break;
            case 'refresh':         this.refresh(); break;
            case 'logs':            await vscode.commands.executeCommand('oraDev.logs'); break;
        }
    }

    async refresh() {
        const c = this.getClient();
        if (!c || !this.panel) return;
        try {
            const [conn, devices, watches, jobs, comps] = await Promise.all([
                c.connection().catch(() => ({ host: null, configured: false } as Connection)),
                c.devices().catch(() => []),
                c.watches().catch(() => []),
                c.jobs().catch(() => []),
                c.components().catch(() => []),
            ]);
            const effectiveConn = (this.latestConn?.host && !conn?.host) ? this.latestConn : conn;
            this.panel.webview.postMessage({ kind: 'snapshot', conn: effectiveConn, devices, watches, jobs, components: comps });
            if (effectiveConn?.host && this.refreshTimer) {
                clearInterval(this.refreshTimer);
                this.refreshTimer = undefined;
            }
        } catch (e: any) {
            this.panel.webview.postMessage({ kind: 'error', message: String(e.message ?? e) });
        }
    }

    private html(): string {
        return /* html */`<!DOCTYPE html><html><head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; font-size: 13px; }
  .flex { display: flex; gap: 12px; flex-wrap: wrap; }
  .card { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-editorWidget-border); border-radius: 8px; padding: 12px; flex: 1; min-width: 280px; }
  .card-full { flex: 1 1 100%; }
  .card h3 { margin: 0 0 8px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--vscode-descriptionForeground); }
  .row { display: flex; justify-content: space-between; padding: 4px 0; border-top: 1px solid var(--vscode-editorWidget-border); font-size: 12px; }
  .row:first-child { border-top: none; }
  .muted { color: var(--vscode-descriptionForeground); font-size: 11px; }
  .error { color: var(--vscode-errorForeground); }
  .ok { color: var(--vscode-testing-iconPassed); }
  .warn { color: var(--vscode-charts-yellow); }
  .bad { color: var(--vscode-errorForeground); }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 8px; font-size: 11px; line-height: 18px; }
  .pill-green { background: var(--vscode-testing-iconPassed); color: #fff; }
  .pill-red   { background: var(--vscode-errorForeground); color: #fff; }
  .pill-blue  { background: var(--vscode-charts-blue); color: #fff; }
  .pill-gray  { background: var(--vscode-descriptionForeground); color: #fff; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 10px; cursor: pointer; border-radius: 3px; font-size: 12px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--vscode-editorWidget-border); }
  th { color: var(--vscode-descriptionForeground); font-weight: 600; font-size: 11px; text-transform: uppercase; }
  code { font-family: var(--vscode-editor-font-family); font-size: 11px; }
  pre { white-space: pre-wrap; font-size: 11px; max-height: 300px; overflow: auto; background: var(--vscode-textBlockQuote-background); padding: 8px; border-radius: 4px; margin-top: 6px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 6px; }
  .stat { background: var(--vscode-editor-background); border: 1px solid var(--vscode-editorWidget-border); border-radius: 6px; padding: 8px; text-align: center; }
  .stat-val { font-size: 20px; font-weight: 700; }
  .stat-lbl { font-size: 10px; color: var(--vscode-descriptionForeground); text-transform: uppercase; }
  .not-connected { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 300px; gap: 12px; }
  .log-line { display: flex; gap: 6px; padding: 2px 0; font-size: 11px; font-family: var(--vscode-editor-font-family); }
  .build-ok { color: var(--vscode-testing-iconPassed); }
  .build-err { color: var(--vscode-errorForeground); }
  .build-info { color: var(--vscode-descriptionForeground); }
  .build-running { color: var(--vscode-charts-blue); }
  .job-detail { display: none; }
  .job-detail.open { display: block; }
  .job-row { cursor: pointer; }
  .job-row:hover { background: var(--vscode-list-hoverBackground); }
</style>
</head><body>
<div id="app">
  <!-- Not connected state (will be hidden when connState arrives) -->
  <div class="not-connected" id="noConn">
    <div style="font-size:48px;">🔌</div>
    <div class="muted" style="font-size:16px;">Not connected to an rumahl device</div>
    <div style="display:flex;gap:8px;margin-top:8px;">
      <button data-cmd="connect">Connect to Device…</button>
      <button class="secondary" data-cmd="discover">Discover LAN</button>
    </div>
  </div>

  <!-- Dashboard (hidden initially, shown when we get connection state) -->
  <div id="dashboard" style="display:none;">
    <div class="flex">
      <div class="card">
        <h3>🔗 Device</h3>
        <div id="conn"><span class="muted">loading…</span></div>
      </div>
      <div class="card" style="flex:2;">
        <h3>📊 Status</h3>
        <div id="status-grid"><span class="muted">loading…</span></div>
      </div>
      <div class="card">
        <h3>⚡ Actions</h3>
        <div style="display:flex;flex-wrap:wrap;gap:4px;">
          <button data-cmd="deploy">🚀 Deploy</button>
          <button data-cmd="watch">👁 Watch</button>
          <button data-cmd="logs">📋 Logs</button>
          <button data-cmd="refresh">🔄 Refresh</button>
        </div>
      </div>
    </div>
    <div class="flex" style="margin-top:12px;">
      <div class="card card-full">
        <h3>📦 Components</h3>
        <div id="components"><span class="muted">loading…</span></div>
      </div>
    </div>
    <div class="flex" style="margin-top:12px;">
      <div class="card">
        <h3>📡 Devices on LAN</h3>
        <div id="devices"><span class="muted">loading…</span></div>
      </div>
      <div class="card">
        <h3>👁 Watch Sessions</h3>
        <div id="watches"><span class="muted">loading…</span></div>
      </div>
    </div>
    <div class="flex" style="margin-top:12px;">
      <div class="card card-full">
        <h3>📋 Jobs</h3>
        <div id="jobs"><span class="muted">loading…</span></div>
      </div>
    </div>
  </div>
  <!-- Debug panel: ALWAYS visible (outside #dashboard) so we can see
       what messages arrive even when not connected. -->
  <div class="flex" style="margin-top:12px;">
    <div class="card card-full">
      <h3>🔍 Debug</h3>
      <div id="debug" style="font-size:11px;font-family:var(--vscode-editor-font-family);"></div>
    </div>
  </div>
</div>
<script>
const vscode = acquireVsCodeApi();
const state = { devices: [], watches: [], jobs: [], components: [], conn: null, connected: false };
var dbg = [];

function post(cmd, extra) { vscode.postMessage(Object.assign({ cmd }, extra || {})); }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function d(msg) { dbg.push(msg); if (dbg.length > 30) dbg.shift(); var el = document.getElementById('debug'); if (el) el.innerHTML = dbg.slice(-10).map(function(x) { return '<div>' + esc(x) + '</div>'; }).join(''); }

function render() {
  var connected = state.connected && state.conn && state.conn.host;
  document.getElementById('noConn').style.display = connected ? 'none' : '';
  document.getElementById('dashboard').style.display = connected ? '' : 'none';
  if (!connected) { d('render: NOT connected (state.connected=' + state.connected + ', host=' + (state.conn ? state.conn.host : 'null') + ')'); return; }
  d('render: CONNECTED to ' + state.conn.host);

  // --- Device card ---
  var c = state.conn;
  var bridgeOk = Array.isArray(c.capabilities) && c.capabilities.indexOf('binary.build_replace') >= 0;
  document.getElementById('conn').innerHTML = ''
    + '<div class="row"><span>Host</span><span><b>' + esc(c.hostname || c.host || '?') + '</b></span></div>'
    + '<div class="row"><span>Address</span><span><code>' + esc(c.host || '?') + '</code></span></div>'
    + '<div class="row"><span>Build</span><span>' + esc(c.build || '?') + '</span></div>'
    + '<div class="row"><span>Variant</span><span class="' + (c.variant==='dev'?'ok':'warn') + '">' + esc(c.variant||'?') + '</span></div>'
    + '<div class="row"><span>Status</span><span class="' + (c.reachable===false?'bad':'ok') + '">' + (c.reachable===false?'offline':'connected') + '</span></div>';

  // --- Status grid ---
  var running = (state.jobs||[]).filter(function(j) { return j.status==='running'||j.status==='pending'; }).length;
  var failed = (state.jobs||[]).filter(function(j) { return j.status==='failed'; }).length;
  document.getElementById('status-grid').innerHTML = '<div class="grid">'
    + '<div class="stat"><div class="stat-val">' + (state.watches||[]).length + '</div><div class="stat-lbl">Watches</div></div>'
    + '<div class="stat"><div class="stat-val">' + running + '</div><div class="stat-lbl">Running</div></div>'
    + '<div class="stat"><div class="stat-val' + (failed>0?' bad':'') + '">' + failed + '</div><div class="stat-lbl">Failed</div></div>'
    + '<div class="stat"><div class="stat-val">' + (state.components||[]).length + '</div><div class="stat-lbl">Components</div></div>'
    + '</div>';

  // --- Components ---
  var comps = (state.components||[]);
  document.getElementById('components').innerHTML = comps.length
    ? '<table><thead><tr><th>Component</th><th>Unit</th><th>Actions</th></tr></thead><tbody>'
      + comps.map(function(x) { return '<tr><td><b>' + esc(x.name) + '</b></td><td><code>' + esc(x.unit) + '</code></td>'
        + '<td><button data-cmd="deployComponent" data-arg="' + esc(x.name) + '">🚀</button> '
        + '<button data-cmd="watchComponent" data-arg="' + esc(x.name) + '">👁</button></td></tr>'; }).join('')
      + '</tbody></table>'
    : '<div class="muted">no components</div>';

  // --- Devices ---
  var devs = (state.devices||[]);
  document.getElementById('devices').innerHTML = devs.length
    ? '<table><thead><tr><th>Instance</th><th>Address</th></tr></thead><tbody>'
      + devs.map(function(d) {
        var ep = (d.addrs||[])[0] || d.host || '';
        return '<tr><td>' + esc(d.instance || '?') + '</td><td><code>' + esc(ep) + '</code></td></tr>'; }).join('')
      + '</tbody></table>'
    : '<div class="muted">no devices</div>';

  // --- Watches ---
  var w = (state.watches||[]);
  document.getElementById('watches').innerHTML = w.length
    ? '<table><thead><tr><th>Components</th><th>Since</th></tr></thead><tbody>'
      + w.map(function(x) { return '<tr><td>' + esc(x.components ? x.components.join(', ') : '?') + '</td>'
        + '<td class="muted">' + (x.started_at ? new Date(x.started_at).toLocaleTimeString() : '?') + '</td></tr>'; }).join('')
      + '</tbody></table>'
    : '<div class="muted">no active watches</div>';

  // --- Jobs with expandable log ---
  var jobs = (state.jobs||[]);
  document.getElementById('jobs').innerHTML = jobs.length
    ? '<table><thead><tr><th>Time</th><th>Kind</th><th>Label</th><th>Status</th></tr></thead><tbody>'
      + jobs.slice(0, 30).map(function(x, i) {
        var pcls = ({running:'pill-blue',succeeded:'pill-green',failed:'pill-red',pending:'pill-gray',canceled:'pill-gray'})[x.status]||'pill-gray';
        var log = (x.log||[]).map(function(l) {
          var cls = l.indexOf('✓')===0 ? 'build-ok' : l.indexOf('✗')===0 ? 'build-err' : l.indexOf('▶')===0 ? 'build-running' : 'build-info';
          return '<div class="log-line ' + cls + '">' + esc(l) + '</div>';
        }).join('');
        return '<tr class="job-row" data-job="' + i + '">'
          + '<td class="muted">' + esc(new Date(x.started_at).toLocaleTimeString()) + '</td>'
          + '<td>' + esc(x.kind) + '</td><td>' + esc(x.label) + '</td>'
          + '<td><span class="pill ' + pcls + '">' + esc(x.status) + '</span></td></tr>'
          + '<tr id="job-' + i + '" class="job-detail"><td colspan="4"><pre>' + (log || '<span class="muted">(no log output)</span>') + '</pre></td></tr>';
      }).join('') + '</tbody></table>'
    : '<div class="muted">no jobs yet</div>';
}

// Global click delegation: handles all data-cmd buttons
// (no inline onclick= attributes that break with special chars)
document.getElementById('app').addEventListener('click', function(ev) {
  var target = ev.target;
  while (target && target !== document.getElementById('app')) {
    // Job row toggle
    if (target.hasAttribute('data-job')) {
      var el = document.getElementById('job-' + target.getAttribute('data-job'));
      if (el) el.classList.toggle('open');
      ev.preventDefault();
      return;
    }
    // Command buttons
    if (target.hasAttribute('data-cmd')) {
      var cmd = target.getAttribute('data-cmd');
      var arg = target.getAttribute('data-arg');
      if (arg) {
        vscode.postMessage({ cmd: cmd, component: arg });
      } else {
        vscode.postMessage({ cmd: cmd });
      }
      ev.preventDefault();
      return;
    }
    target = target.parentElement;
  }
});

console.log('[rumahl-web] registering message listener');
// Listen for messages from the extension
window.addEventListener('message', function(ev) {
  var m = ev.data;
  d('got: kind=' + m.kind + ' host=' + ((m.conn && m.conn.host) || (m.connState && '(connState)') || '—'));

  if (m.kind === 'connState') {
    d('connState: received! host=' + (m.conn ? m.conn.host : 'null') + ' debug=' + (m._debug || ''));
    if (m.conn && m.conn.host) {
      state.conn = m.conn;
      state.connected = true;
      d('connState: SET host=' + m.conn.host);
      render();
    } else {
      d('connState: conn is null or host is empty');
    }
    return;
  }

  if (m.kind === 'snapshot') {
    state.connected = true;
    // Don't let REST snapshot with conn.host=null overwrite our real conn
    var prevHost = state.conn && state.conn.host;
    Object.assign(state, m);
    if (!m.conn || !m.conn.host) {
      if (prevHost) { state.conn = { host: prevHost }; d('snapshot: preserved prev host=' + prevHost); }
    }
    render();
    return;
  }

  if (m.kind === 'event') {
    state.connected = true;
    var p = m.payload;
    if (!p) return;

    if (p.type === 'connection') {
      state.conn = { host: p.host, hostname: p.hostname, build: p.build, variant: p.variant, reachable: !!p.host };
      d('event connection: host=' + (p.host || 'null'));
    } else if (p.type === 'snapshot') {
      if (p.connection && p.connection.host) {
        state.conn = { host: p.connection.host, hostname: p.connection.hostname, build: p.connection.build, variant: p.connection.variant, reachable: !!p.connection.host };
        d('event snapshot: connection.host=' + p.connection.host);
      }
      if (Array.isArray(p.devices)) state.devices = p.devices;
      if (Array.isArray(p.watches)) state.watches = p.watches;
      if (Array.isArray(p.jobs_recent)) {
        for (var j = 0; j < p.jobs_recent.length; j++) {
          var job = p.jobs_recent[j];
          var idx = (state.jobs||[]).findIndex(function(x) { return x.id === job.id; });
          if (idx >= 0) state.jobs[idx] = job; else (state.jobs||[]).push(job);
        }
      }
    } else if (p.type === 'devices_updated') {
      state.devices = p.devices || [];
    } else if (p.type === 'watch_started') {
      if (p.session) (state.watches||[]).push(p.session);
    } else if (p.type === 'watch_stopped') {
      state.watches = (state.watches||[]).filter(function(w) { return w.id !== p.id; });
    } else if (p.type === 'job_created' || p.type === 'job_finished') {
      if (p.job) {
        var idx = (state.jobs||[]).findIndex(function(x) { return x.id === p.job.id; });
        if (idx >= 0) state.jobs[idx] = p.job; else (state.jobs||[]).unshift(p.job);
      }
    } else if (p.type === 'job_updated') {
      if (p.id) {
        var idx = (state.jobs||[]).findIndex(function(x) { return x.id === p.id; });
        if (idx >= 0) {
          if (p.status) state.jobs[idx].status = p.status;
          if (p.line) { if (!state.jobs[idx].log) state.jobs[idx].log = []; state.jobs[idx].log.push(p.line); }
        }
      }
    } else if (p.type === 'services_updated' && p.services) {
      state._servicesSummary = p.services.summary;
    }
    render();
    return;
  }

  if (m.kind === 'error') {
    document.getElementById('conn').innerHTML = '<div class="error">⚠ ' + esc(m.message) + '</div>';
  }
});

console.log('[rumahl-web] dashboard loaded');
// Tell the extension that the webview is ready to receive data
vscode.postMessage({ cmd: 'ready' });
console.log('[rumahl-web] sent ready message');

// Initial render
render();
console.log('[rumahl-web] initial render done');
</script>
</body></html>`;
    }
}
