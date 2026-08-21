// Auto-spawn / locate the rumahl-dev-deploy daemon.

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
        return vscode.workspace.getConfiguration('oraDev').get<string>('cliPath') || 'rumahl-dev-deploy';
    }

    private workspaceRoot(): string | undefined {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    private workspaceCliManifest(): string | undefined {
        const root = this.workspaceRoot();
        if (!root) return undefined;
        const manifest = path.join(root, 'tools', 'rumahl-dev-deploy', 'Cargo.toml');
        return fs.existsSync(manifest) ? manifest : undefined;
    }

    /** Check if there's a pre-built daemon binary available. */
    private hasBuiltBinary(): boolean {
        const root = this.workspaceRoot();
        if (!root) return false;
        // Check for a release build first, then debug
        const candidates = [
            path.join(root, 'tools', 'rumahl-dev-deploy', 'target', 'release', 'rumahl-dev-deploy.exe'),
            path.join(root, 'tools', 'rumahl-dev-deploy', 'target', 'debug', 'rumahl-dev-deploy.exe'),
            path.join(root, 'tools', 'rumahl-dev-deploy', 'target', 'release', 'rumahl-dev-deploy'),
            path.join(root, 'tools', 'rumahl-dev-deploy', 'target', 'debug', 'rumahl-dev-deploy'),
        ];
        for (const c of candidates) {
            if (fs.existsSync(c)) return true;
        }
        return false;
    }

    private daemonSpawnSpec(): SpawnSpec {
        // Prefer pre-built binary over cargo run (much faster startup)
        const root = this.workspaceRoot();
        if (root && this.hasBuiltBinary()) {
            const binDir = path.join(root, 'tools', 'rumahl-dev-deploy', 'target');
            const releaseBin = path.join(binDir, 'release', 'rumahl-dev-deploy.exe');
            const debugBin = path.join(binDir, 'debug', 'rumahl-dev-deploy.exe');
            const releaseBinNix = path.join(binDir, 'release', 'rumahl-dev-deploy');
            const debugBinNix = path.join(binDir, 'debug', 'rumahl-dev-deploy');
            const binary = fs.existsSync(releaseBin) ? releaseBin
                : fs.existsSync(debugBin) ? debugBin
                : fs.existsSync(releaseBinNix) ? releaseBinNix
                : fs.existsSync(debugBinNix) ? debugBinNix
                : this.cliPath();
            return {
                command: binary,
                args: ['daemon', '--bind', this.bind(), '--no-browser'],
                cwd: root,
            };
        }
        const manifest = this.workspaceCliManifest();
        if (manifest) {
            return {
                command: 'cargo',
                args: ['run', '--manifest-path', manifest, '--', 'daemon', '--bind', this.bind(), '--no-browser'],
                cwd: this.workspaceRoot(),
            };
        }
        return {
            command: this.cliPath(),
            args: ['daemon', '--bind', this.bind()],
        };
    }
    private bind(): string {
        return vscode.workspace.getConfiguration('oraDev').get<string>('daemon.bind') || '127.0.0.1:8765';
    }
    private autoStart(): boolean {
        return vscode.workspace.getConfiguration('oraDev').get<boolean>('daemon.autoStart') ?? true;
    }

    /** Returns a usable client, auto-starting the daemon if required. */
    async ensureClient(): Promise<DaemonClient> {
        // First: try to find an already-running daemon by pinging known URLs.
        // This handles the case where the user started the daemon manually
        // (via `cargo run` or the binary directly) before opening VS Code.
        let info = readDaemonInfo();
        if (info) {
            if (await this.ping(info)) {
                const existing = new DaemonClient(info);
                if (await this.supportsRequiredFeatures(existing)) {
                    this.output.appendLine('[daemon] found running daemon');
                    return existing;
                }
                this.output.appendLine('[daemon] existing daemon is missing required features; restarting workspace daemon');
                await this.stopStaleDaemon(info);
            } else {
                this.output.appendLine('[daemon] daemon.json exists but daemon is not responding — will start a new one');
            }
        }
        if (!this.autoStart()) {
            throw new Error('Daemon not running and oraDev.daemon.autoStart is false. Run "rumahl Dev: Start Daemon" first.');
        }
        await this.start();
        // Determine timeout based on how the daemon is started:
        // - Pre-built binary: ~2s
        // - `cargo run`: can take 30s+ to compile first
        const spec = this.daemonSpawnSpec();
        const usingCargo = spec.command === 'cargo';
        const maxAttempts = usingCargo ? 300 : 25;  // 60s for cargo, 5s for binary
        this.output.appendLine(`[daemon] waiting for daemon to respond (${usingCargo ? 'cargo mode, up to 60s' : 'binary mode, up to 5s'})...`);
        for (let i = 0; i < maxAttempts; i++) {
            await sleep(200);
            info = readDaemonInfo();
            if (info && await this.ping(info)) {
                this.output.appendLine('[daemon] daemon is responding');
                return new DaemonClient(info);
            }
            // Log progress periodically
            if (usingCargo && i > 0 && i % 50 === 0) {
                this.output.appendLine(`[daemon] still waiting... (${(i * 200) / 1000}s elapsed)`);
            }
        }
        throw new Error(`Daemon failed to start within ${usingCargo ? '60' : '5'}s — see "rumahl OS Dev" output channel.`);
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
