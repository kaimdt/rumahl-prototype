// VS Code companion for the iora-dev-deploy CLI.
//
// All actual work — mDNS discovery, building, uploading, watching — is done
// by the Rust CLI.  This extension is a thin wrapper that:
//   * Adds palette commands and a status bar item
//   * Provides a tree view of devices/components
//   * Keeps an output channel for the CLI's stdout/stderr
//
// The extension never talks HTTP to a device directly, so the "only-dev"
// safety guarantee enforced by the CLI applies here too.

import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';

const KNOWN_COMPONENTS = [
    'iora-home', 'iora-core', 'iora-control', 'iora-assist', 'iora-secrets',
    'iora-watchdog', 'iora-installer', 'iora-security', 'iora-gateway',
    'iora-files', 'iora-connector', 'iora-api', 'iora-supervisor', 'iora-cli',
    'iora-appstore', 'iora-nginx', 'iora-network-monitor',
    'iora-domain-validator', 'iora-resource-manager', 'iora-developer-app',
    'iora-verify', 'iora-updater', 'iora-sign', 'iora-dev-bridge',
    'iora-backup',
];

let output: vscode.OutputChannel;
let statusItem: vscode.StatusBarItem;

export function activate(ctx: vscode.ExtensionContext) {
    output = vscode.window.createOutputChannel('IORA OS Dev');
    statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    statusItem.text = '$(broadcast) IORA Dev: …';
    statusItem.command = 'ioraDev.status';
    statusItem.show();
    ctx.subscriptions.push(output, statusItem);

    refreshStatus();

    ctx.subscriptions.push(
        vscode.commands.registerCommand('ioraDev.discover',  cmdDiscover),
        vscode.commands.registerCommand('ioraDev.connect',   cmdConnect),
        vscode.commands.registerCommand('ioraDev.status',    cmdStatus),
        vscode.commands.registerCommand('ioraDev.deploy',    cmdDeploy),
        vscode.commands.registerCommand('ioraDev.deployCurrent', cmdDeployCurrent),
        vscode.commands.registerCommand('ioraDev.watch',     cmdWatch),
        vscode.commands.registerCommand('ioraDev.restart',   cmdRestart),
        vscode.commands.registerCommand('ioraDev.logs',      cmdLogs),
    );

    const devicesProvider = new SimpleListProvider(['(run "Discover Devices" to populate)']);
    const componentsProvider = new SimpleListProvider(KNOWN_COMPONENTS);
    ctx.subscriptions.push(
        vscode.window.registerTreeDataProvider('ioraDev.devices', devicesProvider),
        vscode.window.registerTreeDataProvider('ioraDev.components', componentsProvider),
    );
}

export function deactivate() {}

// ─── helpers ──────────────────────────────────────────────────────────────

function cfg<T>(key: string, fallback: T): T {
    return vscode.workspace.getConfiguration('ioraDev').get<T>(key) ?? fallback;
}

function cliBase(): string[] {
    const args: string[] = [];
    const host = cfg<string>('host', '').trim();
    const token = cfg<string>('token', '').trim();
    if (host)  args.push('--host', host);
    if (token) args.push('--token', token);
    return args;
}

interface RunResult { code: number | null; stdout: string; stderr: string; }

function runCli(args: string[], opts: { cwd?: string; stream?: boolean } = {}): Promise<RunResult> {
    return new Promise((resolve) => {
        const bin = cfg<string>('cliPath', 'iora-dev-deploy');
        output.appendLine(`$ ${bin} ${args.join(' ')}`);
        const child = spawn(bin, [...cliBase(), ...args], {
            cwd: opts.cwd ?? workspaceRoot(),
            shell: false,
        });
        let stdout = '', stderr = '';
        child.stdout.on('data', (d) => {
            const s = d.toString();
            stdout += s;
            if (opts.stream) output.append(s);
        });
        child.stderr.on('data', (d) => {
            const s = d.toString();
            stderr += s;
            if (opts.stream) output.append(s);
        });
        child.on('error', (e) => {
            output.appendLine(`ERROR: ${e.message}`);
            resolve({ code: -1, stdout, stderr: stderr + e.message });
        });
        child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
}

function workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

async function refreshStatus() {
    const r = await runCli(['status']);
    if (r.code === 0) {
        try {
            const j = JSON.parse(r.stdout);
            statusItem.text = `$(broadcast) IORA Dev: ${j.hostname} (${j.build})`;
            statusItem.tooltip = `variant=${j.variant}\nbuild=${j.build}\ncaps=${(j.capabilities || []).join(', ')}`;
        } catch {
            statusItem.text = '$(broadcast) IORA Dev: connected';
        }
    } else {
        statusItem.text = '$(circle-slash) IORA Dev: not connected';
        statusItem.tooltip = 'Click to retry, or run "IORA Dev: Connect to Device…"';
    }
}

// ─── commands ─────────────────────────────────────────────────────────────

async function cmdDiscover() {
    output.show(true);
    output.appendLine('--- discover ---');
    await runCli(['discover'], { stream: true });
}

async function cmdConnect() {
    const host = await vscode.window.showInputBox({
        prompt: 'IORA OS Dev device host[:port] (e.g. 192.168.1.42:8099 or my-dev.local:8099)',
        ignoreFocusOut: true,
    });
    if (!host) return;
    const token = await vscode.window.showInputBox({
        prompt: 'Dev token (from /etc/iora/dev-token on the device)',
        password: true, ignoreFocusOut: true,
    });
    if (!token) return;
    output.show(true);
    const r = await runCli(['connect', host, '--token', token], { stream: true });
    if (r.code === 0) vscode.window.showInformationMessage(`IORA Dev: connected to ${host}`);
    else vscode.window.showErrorMessage(`IORA Dev connect failed: ${r.stderr || r.stdout}`);
    refreshStatus();
}

async function cmdStatus() {
    output.show(true);
    output.appendLine('--- status ---');
    await runCli(['status'], { stream: true });
    refreshStatus();
}

async function cmdDeploy() {
    const picks = await vscode.window.showQuickPick(KNOWN_COMPONENTS, {
        canPickMany: true,
        title: 'Components to deploy',
    });
    if (!picks || picks.length === 0) return;
    output.show(true);
    output.appendLine(`--- deploy: ${picks.join(', ')} ---`);
    const args = ['deploy', '--target', cfg<string>('target', 'aarch64-unknown-linux-gnu'), ...picks];
    const r = await runCli(args, { stream: true });
    if (r.code === 0) vscode.window.showInformationMessage(`IORA Dev: deployed ${picks.join(', ')}`);
    else vscode.window.showErrorMessage('IORA Dev deploy failed (see output)');
}

async function cmdDeployCurrent() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showWarningMessage('No active editor.'); return; }
    const file = editor.document.uri.fsPath;
    const root = workspaceRoot();
    if (!root) { vscode.window.showWarningMessage('No workspace folder.'); return; }
    // Walk up from the file until we find a directory directly under .../backend/
    const rel = path.relative(path.join(root, 'backend'), file);
    if (rel.startsWith('..')) {
        vscode.window.showWarningMessage('Active file is not inside backend/.');
        return;
    }
    const crate = rel.split(path.sep)[0];
    if (!KNOWN_COMPONENTS.includes(crate)) {
        vscode.window.showWarningMessage(`"${crate}" is not in the IORA component catalog.`);
        return;
    }
    output.show(true);
    output.appendLine(`--- deploy current: ${crate} ---`);
    const r = await runCli(
        ['deploy', '--target', cfg<string>('target', 'aarch64-unknown-linux-gnu'), crate],
        { stream: true },
    );
    if (r.code === 0) vscode.window.showInformationMessage(`IORA Dev: deployed ${crate}`);
    else vscode.window.showErrorMessage(`IORA Dev deploy of ${crate} failed (see output)`);
}

async function cmdWatch() {
    const picks = await vscode.window.showQuickPick(KNOWN_COMPONENTS, {
        canPickMany: true,
        title: 'Components to watch',
    });
    if (!picks || picks.length === 0) return;
    output.show(true);
    output.appendLine(`--- watch: ${picks.join(', ')} ---`);
    // Long-running; don't await completion.
    runCli(['watch', '--target', cfg<string>('target', 'aarch64-unknown-linux-gnu'), ...picks], { stream: true });
}

async function cmdRestart() {
    const unit = await vscode.window.showInputBox({
        prompt: 'systemd unit (e.g. iora-control or iora-stack.service)',
        ignoreFocusOut: true,
    });
    if (!unit) return;
    output.show(true);
    await runCli(['restart', unit], { stream: true });
}

async function cmdLogs() {
    const svc = await vscode.window.showInputBox({
        prompt: 'docker-compose service (e.g. iora-stack)',
        ignoreFocusOut: true,
    });
    if (!svc) return;
    output.show(true);
    await runCli(['logs', svc, '--tail', '500'], { stream: true });
}

// ─── tree views ───────────────────────────────────────────────────────────

class SimpleListProvider implements vscode.TreeDataProvider<string> {
    constructor(private items: string[]) {}
    getTreeItem(e: string): vscode.TreeItem { return new vscode.TreeItem(e); }
    getChildren(): string[] { return this.items; }
}
