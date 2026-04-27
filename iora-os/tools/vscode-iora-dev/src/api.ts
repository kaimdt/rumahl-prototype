// HTTP/WebSocket client for the iora-dev-deploy daemon.
//
// All commands in this extension go through this client; the extension never
// shells out to the CLI per command. The daemon is auto-spawned on demand
// (see `daemonManager.ts`) and reads its bind address + auth token from
// ~/.config/iora-dev-deploy/daemon.json.

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import WebSocket from 'ws';

export interface DeviceFound {
    instance: string;
    host: string;
    port: number;
    addrs: string[];
    txt: Record<string, string>;
}

export interface Component {
    name: string;
    unit: string;
    target_path: string;
}

export interface Status {
    dev_mode: boolean;
    variant: string;
    build: string;
    hostname: string;
    capabilities: string[];
}

export interface Connection {
    host: string | null;
    configured: boolean;
    hostname?: string;
    build?: string;
    variant?: string;
    dev_mode?: boolean;
    capabilities?: string[];
    reachable?: boolean;
}

export interface Job {
    id: string;
    kind: string;
    label: string;
    status: 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled';
    started_at: string;
    finished_at: string | null;
    log: string[];
}

export interface WatchSession {
    id: string;
    components: string[];
    target: string;
    build_mode: string;
    automatic?: boolean;
    debounce_ms: number;
    started_at: string;
}

export interface CmdResult {
    ok: boolean;
    code: number;
    stdout: string;
    stderr: string;
}

export interface SystemEntry {
    name: string;
    path: string;
    kind: string;
    size: number;
}

export interface SystemListResult {
    path: string;
    entries: SystemEntry[];
}

export interface SystemReadResult {
    path: string;
    content: string;
    bytes: number;
    total_bytes: number;
    truncated: boolean;
    binary_hint: boolean;
}

export interface DaemonInfo { url: string; token: string; pid?: number; }
export interface DaemonVersionInfo { name: string; version: string; api: string; features?: string[]; }

export class DaemonUnavailable extends Error { constructor(m: string) { super(m); this.name = 'DaemonUnavailable'; } }

export function configDir(): string {
    if (process.platform === 'win32') {
        return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'iora-dev-deploy');
    }
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'iora-dev-deploy');
    }
    const xdg = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
    return path.join(xdg, 'iora-dev-deploy');
}

export function readDaemonInfo(): DaemonInfo | null {
    const cfg = vscode.workspace.getConfiguration('ioraDev');
    const urlOverride = (cfg.get<string>('daemon.url') ?? '').trim();
    const tokenOverride = (cfg.get<string>('daemon.token') ?? '').trim();
    if (urlOverride && tokenOverride) {
        return { url: urlOverride.replace(/\/$/, ''), token: tokenOverride };
    }
    const file = path.join(configDir(), 'daemon.json');
    if (!fs.existsSync(file)) return null;
    try {
        const j = JSON.parse(fs.readFileSync(file, 'utf8'));
        return {
            url: (urlOverride || j.url).replace(/\/$/, ''),
            token: tokenOverride || j.token,
            pid: j.pid,
        };
    } catch { return null; }
}

export class DaemonClient {
    constructor(private info: DaemonInfo) {}

    private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
        const url = `${this.info.url}${path}`;
        const headers: Record<string, string> = {
            'Authorization': `Bearer ${this.info.token}`,
            'Accept': 'application/json',
        };
        const init: RequestInit = { method, headers };
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(body);
        }
        let r: Response;
        try {
            r = await fetch(url, init);
        } catch (e: any) {
            throw new DaemonUnavailable(`cannot reach daemon at ${this.info.url}: ${e.message ?? e}`);
        }
        const text = await r.text();
        if (!r.ok) {
            throw new Error(`${method} ${path} → ${r.status}: ${text || r.statusText}`);
        }
        if (!text) return undefined as unknown as T;
        try { return JSON.parse(text) as T; }
        catch { return text as unknown as T; }
    }

    health(): Promise<{ ok: boolean; version: string; uptime_secs: number; active_watches: number; jobs: number }>{
        return this.req('GET', '/api/v1/health');
    }
    version(): Promise<DaemonVersionInfo> { return this.req('GET', '/api/v1/version'); }
    components(): Promise<Component[]> { return this.req('GET', '/api/v1/components'); }
    devices(): Promise<DeviceFound[]> { return this.req('GET', '/api/v1/devices'); }
    discover(timeout = 4): Promise<DeviceFound[]> {
        return this.req('POST', `/api/v1/discover?timeout=${timeout}`);
    }
    connection(): Promise<Connection> { return this.req('GET', '/api/v1/connection'); }
    connect(host: string, token: string) { return this.req('POST', '/api/v1/connect', { host, token }); }
    disconnect() { return this.req('POST', '/api/v1/disconnect'); }
    deviceStatus(): Promise<Status> { return this.req('GET', '/api/v1/status'); }
    deploy(opts: { components: string[]; target: string; build_mode: string; no_build?: boolean; no_restart?: boolean }): Promise<{ job_id: string }> {
        return this.req('POST', '/api/v1/deploy', opts);
    }
    jobs(): Promise<Job[]> { return this.req('GET', '/api/v1/jobs'); }
    job(id: string): Promise<Job> { return this.req('GET', `/api/v1/jobs/${id}`); }
    restart(unit: string) { return this.req('POST', '/api/v1/restart', { unit }); }
    serviceReload(unit: string) { return this.req('POST', '/api/v1/service/reload', { unit }); }
    composeReload(svc: string) { return this.req('POST', '/api/v1/compose/reload', { svc }); }
    composeLogs(svc: string, tail = 200): Promise<CmdResult> {
        return this.req('POST', '/api/v1/compose/logs', { svc, tail });
    }
    serviceLogs(unit: string, tail = 200): Promise<CmdResult> {
        return this.req('POST', '/api/v1/service/logs', { unit, tail });
    }
    systemList(path: string): Promise<SystemListResult> {
        return this.req('POST', '/api/v1/system/list', { path });
    }
    systemRead(path: string, max_bytes = 64 * 1024): Promise<SystemReadResult> {
        return this.req('POST', '/api/v1/system/read', { path, max_bytes });
    }
    watches(): Promise<WatchSession[]> { return this.req('GET', '/api/v1/watch'); }
    startWatch(opts: { components: string[]; target: string; build_mode: string; automatic?: boolean; debounce_ms?: number }): Promise<WatchSession> {
        return this.req('POST', '/api/v1/watch', opts);
    }
    stopWatch(id: string) { return this.req('DELETE', `/api/v1/watch/${id}`); }

    openEvents(onEvent: (e: any) => void, onClose?: () => void): WebSocket {
        const wsUrl = this.info.url.replace(/^http/, 'ws')
            + `/api/v1/events?token=${encodeURIComponent(this.info.token)}`;
        const ws = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${this.info.token}` } });
        ws.on('message', (data) => {
            try { onEvent(JSON.parse(data.toString())); } catch {}
        });
        ws.on('close', () => onClose?.());
        ws.on('error', () => {});
        return ws;
    }
}
