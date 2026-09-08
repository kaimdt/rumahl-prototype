"use strict";
// Tree-view providers for the rumahl OS Dev activity-bar container.
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
exports.JobsProvider = exports.ActivityProvider = exports.ServicesProvider = exports.WatchesProvider = exports.ComponentsProvider = exports.DevicesProvider = exports.ConnectionProvider = void 0;
const vscode = __importStar(require("vscode"));
class BaseProvider {
    _onDidChange = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChange.event;
    refresh() { this._onDidChange.fire(); }
}
class ConnectionProvider extends BaseProvider {
    conn = null;
    runningJobs = 0;
    watchCount = 0;
    bridgeBuildStatus() {
        const supported = this.conn?.capabilities?.includes('binary.build_replace') ?? false;
        return supported
            ? {
                label: 'Device bridge',
                description: 'remote build supported',
                tooltip: 'The connected rumahl-dev-bridge supports binary.build_replace for device-side builds.',
                icon: 'check',
            }
            : {
                label: 'Device bridge',
                description: 'update required',
                tooltip: 'The connected rumahl-dev-bridge does not report binary.build_replace. Update the bridge on the device before using device build mode.',
                icon: 'warning',
            };
    }
    setState(conn, jobs, watches) {
        this.conn = conn;
        this.runningJobs = jobs.filter(j => j.status === 'running' || j.status === 'pending').length;
        this.watchCount = watches.length;
        this.refresh();
    }
    getChildren() {
        if (!this.conn?.host) {
            return ['No configured rumahl dev server'];
        }
        const reachability = this.conn.reachable === false ? 'offline' : 'connected';
        return [
            {
                label: this.conn.hostname || this.conn.host,
                description: `${this.conn.host} • ${reachability}`,
                tooltip: `host: ${this.conn.host}\nbuild: ${this.conn.build || '?'}\nvariant: ${this.conn.variant || '?'}\nreachable: ${this.conn.reachable !== false}`,
                icon: this.conn.reachable === false ? 'warning' : 'plug',
            },
            this.bridgeBuildStatus(),
            {
                label: 'Build mode',
                description: vscode.workspace.getConfiguration('oraDev').get('buildMode') || 'device',
                tooltip: 'Current deploy/watch build mode',
                icon: 'tools',
            },
            {
                label: 'Activity',
                description: `${this.runningJobs} running jobs • ${this.watchCount} watch sessions`,
                tooltip: 'Current extension activity overview',
                icon: this.runningJobs > 0 ? 'sync~spin' : 'pulse',
            },
        ];
    }
    getTreeItem(item) {
        if (typeof item === 'string') {
            const info = new vscode.TreeItem(item);
            info.iconPath = new vscode.ThemeIcon('info');
            return info;
        }
        const tree = new vscode.TreeItem(item.label, vscode.TreeItemCollapsibleState.None);
        tree.description = item.description;
        tree.tooltip = item.tooltip;
        tree.iconPath = new vscode.ThemeIcon(item.icon);
        return tree;
    }
}
exports.ConnectionProvider = ConnectionProvider;
// ─── Devices ──────────────────────────────────────────────────────────────
class DevicesProvider extends BaseProvider {
    client;
    cache = [];
    active = null;
    constructor(client) {
        super();
        this.client = client;
    }
    setDevices(d) { this.cache = d; this.refresh(); }
    setActive(host) { this.active = host; this.refresh(); }
    async getChildren() {
        if (this.cache.length === 0)
            return ['(no devices — run "Discover Devices")'];
        return this.cache;
    }
    getTreeItem(e) {
        if (typeof e === 'string') {
            const i = new vscode.TreeItem(e);
            i.iconPath = new vscode.ThemeIcon('info');
            return i;
        }
        const inst = e.instance.replace(/_rumahl-dev\._tcp\.local\.?$/, '').replace(/\.$/, '');
        const addr = e.addrs[0] ?? e.host;
        const ep = `${addr}:${e.port}`;
        const item = new vscode.TreeItem(inst, vscode.TreeItemCollapsibleState.None);
        item.description = ep + (e.txt.build ? `  (build ${e.txt.build})` : '');
        item.tooltip = JSON.stringify(e.txt, null, 2);
        item.contextValue = 'device';
        item.iconPath = new vscode.ThemeIcon(this.active && this.active.startsWith(addr) ? 'check' : 'circuit-board');
        item.command = {
            command: 'oraDev.connectFromTree',
            title: 'Connect',
            arguments: [ep],
        };
        return item;
    }
}
exports.DevicesProvider = DevicesProvider;
// ─── Components ───────────────────────────────────────────────────────────
class ComponentsProvider extends BaseProvider {
    items = [];
    setItems(items) { this.items = items; this.refresh(); }
    getChildren() { return this.items; }
    getTreeItem(c) {
        const item = new vscode.TreeItem(c.name, vscode.TreeItemCollapsibleState.None);
        item.description = c.unit;
        item.tooltip = `${c.name}\nunit: ${c.unit}\npath: ${c.target_path}`;
        item.iconPath = new vscode.ThemeIcon('package');
        item.contextValue = 'component';
        return item;
    }
}
exports.ComponentsProvider = ComponentsProvider;
// ─── Watches ──────────────────────────────────────────────────────────────
class WatchesProvider extends BaseProvider {
    items = [];
    setItems(items) { this.items = items; this.refresh(); }
    getChildren() { return this.items.length ? this.items : ['(no active watch sessions)']; }
    getTreeItem(w) {
        if (typeof w === 'string') {
            const i = new vscode.TreeItem(w);
            i.iconPath = new vscode.ThemeIcon('info');
            return i;
        }
        const item = new vscode.TreeItem(w.automatic ? 'Automatic workspace mode' : w.components.join(', '), vscode.TreeItemCollapsibleState.None);
        item.description = `${w.build_mode}${w.automatic ? ' • automatic' : ''} • ${w.target} • since ${new Date(w.started_at).toLocaleTimeString()}`;
        item.tooltip = `id: ${w.id}\nbuild mode: ${w.build_mode}\nautomatic: ${!!w.automatic}\ndebounce: ${w.debounce_ms}ms`;
        item.iconPath = new vscode.ThemeIcon('eye');
        item.contextValue = 'watch';
        return item;
    }
}
exports.WatchesProvider = WatchesProvider;
// ─── Jobs ─────────────────────────────────────────────────────────────────
class ServicesProvider extends BaseProvider {
    snapshot = null;
    err = null;
    setSnapshot(snap, err) {
        this.snapshot = snap;
        this.err = err ?? null;
        this.refresh();
    }
    summary() {
        return this.snapshot?.summary ?? null;
    }
    getChildren() {
        if (this.err)
            return [`(error: ${this.err})`];
        if (!this.snapshot)
            return ['(no data — connect to a device)'];
        if (this.snapshot.services.length === 0)
            return ['(no services have heartbeated yet)'];
        const order = { unhealthy: 0, degraded: 1, healthy: 2 };
        return [...this.snapshot.services].sort((a, b) => {
            const sa = order[a.effective_status] ?? 9;
            const sb = order[b.effective_status] ?? 9;
            if (sa !== sb)
                return sa - sb;
            return a.name.localeCompare(b.name);
        });
    }
    getTreeItem(e) {
        if (typeof e === 'string') {
            const i = new vscode.TreeItem(e);
            i.iconPath = new vscode.ThemeIcon('info');
            return i;
        }
        const item = new vscode.TreeItem(e.name, vscode.TreeItemCollapsibleState.None);
        const ageStr = e.heartbeat_age_secs == null
            ? 'no beat'
            : (e.heartbeat_age_secs < 60 ? `${e.heartbeat_age_secs}s ago` : `${Math.floor(e.heartbeat_age_secs / 60)}m ago`);
        item.description = `${e.effective_status} • ♥ ${ageStr}`;
        const metricLines = Object.entries(e.metrics ?? {}).map(([k, v]) => `  ${k}=${v}`);
        item.tooltip = [
            e.description || null,
            `status: ${e.effective_status}${e.reported_status && e.reported_status !== e.effective_status ? ` (reported: ${e.reported_status})` : ''}`,
            e.message ? `message: ${e.message}` : null,
            e.version ? `version: ${e.version}` : null,
            e.host ? `host: ${e.host}${e.pid ? ` pid=${e.pid}` : ''}` : null,
            e.uptime_seconds != null ? `uptime: ${formatDuration(e.uptime_seconds)}` : null,
            e.last_heartbeat ? `last beat: ${e.last_heartbeat}` : 'no heartbeat received',
            e.last_poll ? `last poll: ${e.last_poll} (${e.last_poll_status ?? 'n/a'})` : null,
            e.url ? `url: ${e.url}` : null,
            e.stale ? '⚠  stale (no recent heartbeat)' : null,
            metricLines.length ? '\nmetrics:' : null,
            ...metricLines,
        ].filter(Boolean).join('\n');
        item.iconPath = new vscode.ThemeIcon(statusIcon(e), statusColor(e));
        item.contextValue = 'service';
        return item;
    }
}
exports.ServicesProvider = ServicesProvider;
function statusIcon(e) {
    if (e.stale)
        return 'circle-slash';
    switch (e.effective_status) {
        case 'healthy': return 'pass-filled';
        case 'degraded': return 'warning';
        case 'unhealthy': return 'error';
    }
}
function statusColor(e) {
    if (e.stale)
        return new vscode.ThemeColor('descriptionForeground');
    switch (e.effective_status) {
        case 'healthy': return new vscode.ThemeColor('charts.green');
        case 'degraded': return new vscode.ThemeColor('charts.yellow');
        case 'unhealthy': return new vscode.ThemeColor('errorForeground');
    }
}
// ─── Activity (Watches + Jobs combined) ────────────────────────────────
class ActivityProvider extends BaseProvider {
    watches = [];
    jobs = [];
    setWatches(w) { this.watches = w; this.refresh(); }
    setJobs(j) { this.jobs = j; this.refresh(); }
    upsertJob(job) {
        const i = this.jobs.findIndex(j => j.id === job.id);
        if (i >= 0)
            this.jobs[i] = job;
        else
            this.jobs.unshift(job);
        if (this.jobs.length > 100)
            this.jobs.length = 100;
        this.refresh();
    }
    getChildren() {
        const children = [];
        if (this.watches.length > 0) {
            for (const w of this.watches)
                children.push(w);
        }
        if (this.jobs.length > 0) {
            // Show only the most recent 10 jobs
            for (const j of this.jobs.slice(0, 10))
                children.push(j);
        }
        if (children.length === 0)
            return ['(no active watches or recent jobs)'];
        return children;
    }
    getTreeItem(e) {
        if (typeof e === 'string') {
            const i = new vscode.TreeItem(e);
            i.iconPath = new vscode.ThemeIcon('info');
            return i;
        }
        // WatchSession
        if ('components' in e && 'started_at' in e) {
            const w = e;
            const item = new vscode.TreeItem(w.automatic ? '👁 Auto-watch' : `👁 ${w.components.join(', ')}`, vscode.TreeItemCollapsibleState.None);
            item.description = `${w.build_mode}${w.automatic ? ' • auto' : ''} • since ${new Date(w.started_at).toLocaleTimeString()}`;
            item.tooltip = `watch ${w.id}\nbuild mode: ${w.build_mode}\nautomatic: ${!!w.automatic}\ndebounce: ${w.debounce_ms}ms`;
            item.contextValue = 'watch';
            return item;
        }
        // Job
        const j = e;
        const item = new vscode.TreeItem(j.label, vscode.TreeItemCollapsibleState.None);
        item.description = j.status;
        item.tooltip = `${j.kind}\nstarted: ${new Date(j.started_at).toLocaleTimeString()}\n${j.finished_at ? 'finished: ' + new Date(j.finished_at).toLocaleTimeString() : 'running…'}\n\n${j.log.slice(-5).join('\n')}`;
        item.iconPath = new vscode.ThemeIcon(jobIcon(j.status), jobColor(j.status));
        return item;
    }
}
exports.ActivityProvider = ActivityProvider;
function formatDuration(secs) {
    if (secs < 60)
        return `${secs}s`;
    if (secs < 3600)
        return `${Math.floor(secs / 60)}m${secs % 60}s`;
    if (secs < 86400)
        return `${Math.floor(secs / 3600)}h${Math.floor((secs % 3600) / 60)}m`;
    return `${Math.floor(secs / 86400)}d${Math.floor((secs % 86400) / 3600)}h`;
}
class JobsProvider extends BaseProvider {
    items = [];
    setItems(items) { this.items = items; this.refresh(); }
    upsert(job) {
        const i = this.items.findIndex(j => j.id === job.id);
        if (i >= 0)
            this.items[i] = job;
        else
            this.items.unshift(job);
        if (this.items.length > 100)
            this.items.length = 100;
        this.refresh();
    }
    getChildren() { return this.items.length ? this.items : ['(no jobs yet)']; }
    getTreeItem(j) {
        if (typeof j === 'string') {
            const i = new vscode.TreeItem(j);
            i.iconPath = new vscode.ThemeIcon('info');
            return i;
        }
        const item = new vscode.TreeItem(j.label, vscode.TreeItemCollapsibleState.None);
        item.description = j.status;
        item.tooltip = `${j.kind}\nstarted: ${j.started_at}\n${j.finished_at ? 'finished: ' + j.finished_at : 'running…'}\n\n${j.log.join('\n')}`;
        item.iconPath = new vscode.ThemeIcon(jobIcon(j.status), jobColor(j.status));
        return item;
    }
}
exports.JobsProvider = JobsProvider;
function jobIcon(s) {
    switch (s) {
        case 'running': return 'sync~spin';
        case 'pending': return 'clock';
        case 'succeeded': return 'check';
        case 'failed': return 'error';
        case 'canceled': return 'circle-slash';
    }
}
function jobColor(s) {
    switch (s) {
        case 'succeeded': return new vscode.ThemeColor('charts.green');
        case 'failed': return new vscode.ThemeColor('errorForeground');
        case 'running': return new vscode.ThemeColor('charts.blue');
        default: return undefined;
    }
}
//# sourceMappingURL=views.js.map