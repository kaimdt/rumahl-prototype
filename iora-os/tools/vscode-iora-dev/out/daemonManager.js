"use strict";
// Auto-spawn / locate the iora-dev-deploy daemon.
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
exports.DaemonManager = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const api_1 = require("./api");
const REQUIRED_DAEMON_FEATURES = ['device-build'];
class DaemonManager {
    output;
    child;
    constructor(output) {
        this.output = output;
    }
    cliPath() {
        return vscode.workspace.getConfiguration('ioraDev').get('cliPath') || 'iora-dev-deploy';
    }
    workspaceRoot() {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }
    workspaceCliManifest() {
        const root = this.workspaceRoot();
        if (!root)
            return undefined;
        const manifest = path.join(root, 'tools', 'iora-dev-deploy', 'Cargo.toml');
        return fs.existsSync(manifest) ? manifest : undefined;
    }
    daemonSpawnSpec() {
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
    bind() {
        return vscode.workspace.getConfiguration('ioraDev').get('daemon.bind') || '127.0.0.1:8765';
    }
    autoStart() {
        return vscode.workspace.getConfiguration('ioraDev').get('daemon.autoStart') ?? true;
    }
    /** Returns a usable client, auto-starting the daemon if required. */
    async ensureClient() {
        // Try existing.
        let info = (0, api_1.readDaemonInfo)();
        if (info && await this.ping(info)) {
            const existing = new api_1.DaemonClient(info);
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
            info = (0, api_1.readDaemonInfo)();
            if (info && await this.ping(info))
                return new api_1.DaemonClient(info);
        }
        throw new Error('Daemon failed to start within 5s — see "IORA OS Dev" output channel.');
    }
    async start() {
        if (this.child && this.child.exitCode === null)
            return;
        const spec = this.daemonSpawnSpec();
        this.output.appendLine(`$ ${spec.command} ${spec.args.join(' ')}`);
        try {
            this.child = (0, child_process_1.spawn)(spec.command, spec.args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: false,
                shell: false,
                cwd: spec.cwd,
            });
        }
        catch (e) {
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
    async stop() {
        if (this.child) {
            this.child.kill();
            this.child = undefined;
        }
        // Best-effort: also remove a stale daemon.json if one exists from a different pid.
        const info = path.join((0, api_1.configDir)(), 'daemon.json');
        if (fs.existsSync(info)) {
            try {
                fs.unlinkSync(info);
            }
            catch { }
        }
    }
    isManagedRunning() {
        return !!this.child && this.child.exitCode === null;
    }
    async ping(info) {
        try {
            const r = await fetch(`${info.url}/api/v1/health`, {
                method: 'GET',
                headers: { Authorization: `Bearer ${info.token}` },
            });
            return r.ok;
        }
        catch {
            return false;
        }
    }
    async supportsRequiredFeatures(client) {
        try {
            const version = await client.version();
            const features = new Set(version.features ?? []);
            return REQUIRED_DAEMON_FEATURES.every(feature => features.has(feature));
        }
        catch {
            return false;
        }
    }
    async stopStaleDaemon(info) {
        if (this.child) {
            this.child.kill();
            this.child = undefined;
        }
        if (typeof info.pid === 'number') {
            try {
                process.kill(info.pid);
            }
            catch { }
        }
        const daemonFile = path.join((0, api_1.configDir)(), 'daemon.json');
        if (fs.existsSync(daemonFile)) {
            try {
                fs.unlinkSync(daemonFile);
            }
            catch { }
        }
        await sleep(300);
    }
    dispose() { this.stop().catch(() => { }); }
}
exports.DaemonManager = DaemonManager;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
//# sourceMappingURL=daemonManager.js.map