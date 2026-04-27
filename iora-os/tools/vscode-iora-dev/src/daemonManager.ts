// Auto-spawn / locate the iora-dev-deploy daemon.

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { configDir, DaemonClient, DaemonInfo, readDaemonInfo } from './api';

type SpawnSpec = {
    command: string;
    args: string[];
    cwd?: string;
};

const REQUIRED_DAEMON_FEATURES = ['device-build'];

export class DaemonManager {
    private child?: ChildProcess;
    constructor(private output: vscode.OutputChannel) {}

    private cliPath(): string {
        return vscode.workspace.getConfiguration('ioraDev').get<string>('cliPath') || 'iora-dev-deploy';
    }

    private workspaceRoot(): string | undefined {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    private workspaceCliManifest(): string | undefined {
        const root = this.workspaceRoot();
        if (!root) return undefined;
        const manifest = path.join(root, 'tools', 'iora-dev-deploy', 'Cargo.toml');
        return fs.existsSync(manifest) ? manifest : undefined;
    }

    private daemonSpawnSpec(): SpawnSpec {
        const manifest = this.workspaceCliManifest();
        if (manifest) {
            return {
                command: 'cargo',
                args: ['run', '--manifest-path', manifest, '--', 'daemon', '--bind', this.bind()],
                cwd: this.workspaceRoot(),
            };
        }
        return {
            command: this.cliPath(),
            args: ['daemon', '--bind', this.bind()],
        };
    }
    private bind(): string {
        return vscode.workspace.getConfiguration('ioraDev').get<string>('daemon.bind') || '127.0.0.1:8765';
    }
    private autoStart(): boolean {
        return vscode.workspace.getConfiguration('ioraDev').get<boolean>('daemon.autoStart') ?? true;
    }

    /** Returns a usable client, auto-starting the daemon if required. */
    async ensureClient(): Promise<DaemonClient> {
        // Try existing.
        let info = readDaemonInfo();
        if (info && await this.ping(info)) {
            const existing = new DaemonClient(info);
            if (await this.supportsRequiredFeatures(existing)) {
                return existing;
            }
            this.output.appendLine('[daemon] existing daemon is missing required features; restarting workspace daemon');
            await this.stopStaleDaemon(info);
        }
        if (!this.autoStart()) {
            throw new Error('Daemon not running and ioraDev.daemon.autoStart is false. Run "IORA Dev: Start Daemon" first.');
        }
        await this.start();
        // Wait for daemon to write daemon.json + start serving (up to ~5s).
        for (let i = 0; i < 25; i++) {
            await sleep(200);
            info = readDaemonInfo();
            if (info && await this.ping(info)) return new DaemonClient(info);
        }
        throw new Error('Daemon failed to start within 5s — see "IORA OS Dev" output channel.');
    }

    async start(): Promise<void> {
        if (this.child && this.child.exitCode === null) return;
        const spec = this.daemonSpawnSpec();
        this.output.appendLine(`$ ${spec.command} ${spec.args.join(' ')}`);
        try {
            this.child = spawn(spec.command, spec.args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: false,
                shell: false,
                cwd: spec.cwd,
            });
        } catch (e: any) {
            throw new Error(`failed to spawn ${spec.command}: ${e.message ?? e}`);
        }
        this.child.stdout?.on('data', (d) => this.output.append(d.toString()));
        this.child.stderr?.on('data', (d) => this.output.append(d.toString()));
        this.child.on('exit', (code, sig) => {
            this.output.appendLine(`[daemon exited code=${code} signal=${sig}]`);
            this.child = undefined;
        });
        this.child.on('error', (e) => this.output.appendLine(`[daemon error] ${e.message}`));
    }

    async stop(): Promise<void> {
        if (this.child) {
            this.child.kill();
            this.child = undefined;
        }
        // Best-effort: also remove a stale daemon.json if one exists from a different pid.
        const info = path.join(configDir(), 'daemon.json');
        if (fs.existsSync(info)) {
            try { fs.unlinkSync(info); } catch {}
        }
    }

    isManagedRunning(): boolean {
        return !!this.child && this.child.exitCode === null;
    }

    private async ping(info: DaemonInfo): Promise<boolean> {
        try {
            const r = await fetch(`${info.url}/api/v1/health`, {
                method: 'GET',
                headers: { Authorization: `Bearer ${info.token}` },
            });
            return r.ok;
        } catch { return false; }
    }

    private async supportsRequiredFeatures(client: DaemonClient): Promise<boolean> {
        try {
            const version = await client.version();
            const features = new Set(version.features ?? []);
            return REQUIRED_DAEMON_FEATURES.every(feature => features.has(feature));
        } catch {
            return false;
        }
    }

    private async stopStaleDaemon(info: DaemonInfo): Promise<void> {
        if (this.child) {
            this.child.kill();
            this.child = undefined;
        }
        if (typeof info.pid === 'number') {
            try { process.kill(info.pid); } catch {}
        }
        const daemonFile = path.join(configDir(), 'daemon.json');
        if (fs.existsSync(daemonFile)) {
            try { fs.unlinkSync(daemonFile); } catch {}
        }
        await sleep(300);
    }

    dispose() { this.stop().catch(() => {}); }
}

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }
