// Auto-spawn / locate the iora-dev-deploy daemon.

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { configDir, DaemonClient, DaemonInfo, readDaemonInfo } from './api';

export class DaemonManager {
    private child?: ChildProcess;
    constructor(private output: vscode.OutputChannel) {}

    private cliPath(): string {
        return vscode.workspace.getConfiguration('ioraDev').get<string>('cliPath') || 'iora-dev-deploy';
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
            return new DaemonClient(info);
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
        const cli = this.cliPath();
        const args = ['daemon', '--bind', this.bind()];
        this.output.appendLine(`$ ${cli} ${args.join(' ')}`);
        try {
            this.child = spawn(cli, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: false,
                shell: false,
            });
        } catch (e: any) {
            throw new Error(`failed to spawn ${cli}: ${e.message ?? e}`);
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

    dispose() { this.stop().catch(() => {}); }
}

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }
