"use strict";
// Tree-view providers for the IORA OS Dev activity-bar container.
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
exports.JobsProvider = exports.WatchesProvider = exports.ComponentsProvider = exports.DevicesProvider = void 0;
const vscode = __importStar(require("vscode"));
class BaseProvider {
    _onDidChange = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChange.event;
    refresh() { this._onDidChange.fire(); }
}
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
        const inst = e.instance.replace(/_iora-dev\._tcp\.local\.?$/, '').replace(/\.$/, '');
        const addr = e.addrs[0] ?? e.host;
        const ep = `${addr}:${e.port}`;
        const item = new vscode.TreeItem(inst, vscode.TreeItemCollapsibleState.None);
        item.description = ep + (e.txt.build ? `  (build ${e.txt.build})` : '');
        item.tooltip = JSON.stringify(e.txt, null, 2);
        item.contextValue = 'device';
        item.iconPath = new vscode.ThemeIcon(this.active && this.active.startsWith(addr) ? 'check' : 'circuit-board');
        item.command = {
            command: 'ioraDev.connectFromTree',
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
        const item = new vscode.TreeItem(w.components.join(', '), vscode.TreeItemCollapsibleState.None);
        item.description = `${w.target} • since ${new Date(w.started_at).toLocaleTimeString()}`;
        item.tooltip = `id: ${w.id}\ndebounce: ${w.debounce_ms}ms`;
        item.iconPath = new vscode.ThemeIcon('eye');
        item.contextValue = 'watch';
        return item;
    }
}
exports.WatchesProvider = WatchesProvider;
// ─── Jobs ─────────────────────────────────────────────────────────────────
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