// Tree-view providers for the IORA OS Dev activity-bar container.

import * as vscode from 'vscode';
import { Component, Connection, DaemonClient, DeviceFound, Job, WatchSession } from './api';

abstract class BaseProvider<T> implements vscode.TreeDataProvider<T> {
    private _onDidChange = new vscode.EventEmitter<T | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChange.event;
    refresh(): void { this._onDidChange.fire(); }
    abstract getTreeItem(e: T): vscode.TreeItem;
    abstract getChildren(): Thenable<T[]> | T[];
}

type ConnectionItem = {
    label: string;
    description?: string;
    tooltip?: string;
    icon: string;
};

export class ConnectionProvider extends BaseProvider<ConnectionItem | string> {
    private conn: Connection | null = null;
    private runningJobs = 0;
    private watchCount = 0;

    private bridgeBuildStatus(): ConnectionItem {
        const supported = this.conn?.capabilities?.includes('binary.build_replace') ?? false;
        return supported
            ? {
                label: 'Device bridge',
                description: 'remote build supported',
                tooltip: 'The connected iora-dev-bridge supports binary.build_replace for device-side builds.',
                icon: 'check',
            }
            : {
                label: 'Device bridge',
                description: 'update required',
                tooltip: 'The connected iora-dev-bridge does not report binary.build_replace. Update the bridge on the device before using device build mode.',
                icon: 'warning',
            };
    }

    setState(conn: Connection | null, jobs: Job[], watches: WatchSession[]) {
        this.conn = conn;
        this.runningJobs = jobs.filter(j => j.status === 'running' || j.status === 'pending').length;
        this.watchCount = watches.length;
        this.refresh();
    }

    getChildren(): (ConnectionItem | string)[] {
        if (!this.conn?.host) {
            return ['No configured IORA dev server'];
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
                description: vscode.workspace.getConfiguration('ioraDev').get<string>('buildMode') || 'device',
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

    getTreeItem(item: ConnectionItem | string): vscode.TreeItem {
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

// ─── Devices ──────────────────────────────────────────────────────────────

export class DevicesProvider extends BaseProvider<DeviceFound | string> {
    private cache: DeviceFound[] = [];
    private active: string | null = null;
    constructor(private client: () => DaemonClient | undefined) { super(); }

    setDevices(d: DeviceFound[]) { this.cache = d; this.refresh(); }
    setActive(host: string | null) { this.active = host; this.refresh(); }

    async getChildren(): Promise<(DeviceFound | string)[]> {
        if (this.cache.length === 0) return ['(no devices — run "Discover Devices")'];
        return this.cache;
    }
    getTreeItem(e: DeviceFound | string): vscode.TreeItem {
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

// ─── Components ───────────────────────────────────────────────────────────

export class ComponentsProvider extends BaseProvider<Component> {
    private items: Component[] = [];
    setItems(items: Component[]) { this.items = items; this.refresh(); }
    getChildren() { return this.items; }
    getTreeItem(c: Component): vscode.TreeItem {
        const item = new vscode.TreeItem(c.name, vscode.TreeItemCollapsibleState.None);
        item.description = c.unit;
        item.tooltip = `${c.name}\nunit: ${c.unit}\npath: ${c.target_path}`;
        item.iconPath = new vscode.ThemeIcon('package');
        item.contextValue = 'component';
        return item;
    }
}

// ─── Watches ──────────────────────────────────────────────────────────────

export class WatchesProvider extends BaseProvider<WatchSession | string> {
    private items: WatchSession[] = [];
    setItems(items: WatchSession[]) { this.items = items; this.refresh(); }
    getChildren() { return this.items.length ? this.items : ['(no active watch sessions)']; }
    getTreeItem(w: WatchSession | string): vscode.TreeItem {
        if (typeof w === 'string') {
            const i = new vscode.TreeItem(w); i.iconPath = new vscode.ThemeIcon('info'); return i;
        }
        const item = new vscode.TreeItem(w.automatic ? 'Automatic workspace mode' : w.components.join(', '), vscode.TreeItemCollapsibleState.None);
        item.description = `${w.build_mode}${w.automatic ? ' • automatic' : ''} • ${w.target} • since ${new Date(w.started_at).toLocaleTimeString()}`;
        item.tooltip = `id: ${w.id}\nbuild mode: ${w.build_mode}\nautomatic: ${!!w.automatic}\ndebounce: ${w.debounce_ms}ms`;
        item.iconPath = new vscode.ThemeIcon('eye');
        item.contextValue = 'watch';
        return item;
    }
}

// ─── Jobs ─────────────────────────────────────────────────────────────────

export class JobsProvider extends BaseProvider<Job | string> {
    private items: Job[] = [];
    setItems(items: Job[]) { this.items = items; this.refresh(); }
    upsert(job: Job) {
        const i = this.items.findIndex(j => j.id === job.id);
        if (i >= 0) this.items[i] = job; else this.items.unshift(job);
        if (this.items.length > 100) this.items.length = 100;
        this.refresh();
    }
    getChildren() { return this.items.length ? this.items : ['(no jobs yet)']; }
    getTreeItem(j: Job | string): vscode.TreeItem {
        if (typeof j === 'string') {
            const i = new vscode.TreeItem(j); i.iconPath = new vscode.ThemeIcon('info'); return i;
        }
        const item = new vscode.TreeItem(j.label, vscode.TreeItemCollapsibleState.None);
        item.description = j.status;
        item.tooltip = `${j.kind}\nstarted: ${j.started_at}\n${j.finished_at ? 'finished: ' + j.finished_at : 'running…'}\n\n${j.log.join('\n')}`;
        item.iconPath = new vscode.ThemeIcon(jobIcon(j.status), jobColor(j.status));
        return item;
    }
}

function jobIcon(s: Job['status']) {
    switch (s) {
        case 'running':   return 'sync~spin';
        case 'pending':   return 'clock';
        case 'succeeded': return 'check';
        case 'failed':    return 'error';
        case 'canceled':  return 'circle-slash';
    }
}
function jobColor(s: Job['status']) {
    switch (s) {
        case 'succeeded': return new vscode.ThemeColor('charts.green');
        case 'failed':    return new vscode.ThemeColor('errorForeground');
        case 'running':   return new vscode.ThemeColor('charts.blue');
        default:          return undefined;
    }
}
