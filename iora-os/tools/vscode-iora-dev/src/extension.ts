// IORA OS Dev — VS Code extension entry point.
//
// Architecture: the extension is a thin orchestrator. All real work
// (mDNS discovery, cargo builds, binary uploads, watch sessions) is done
// by the `iora-dev-deploy daemon` process spawned on demand. We talk to it
// over HTTP/WS on 127.0.0.1.

import * as vscode from 'vscode';
import * as path from 'path';
import WebSocket from 'ws';
import { Component, Connection, DaemonClient, DaemonUnavailable, Job, WatchSession } from './api';
import { DaemonManager } from './daemonManager';
import { ComponentsProvider, ConnectionProvider, DevicesProvider, JobsProvider, WatchesProvider } from './views';
import { Dashboard } from './dashboard';

let output: vscode.OutputChannel;
let statusItem: vscode.StatusBarItem;
let manager: DaemonManager;
let client: DaemonClient | undefined;
let ws: WebSocket | undefined;
let dashboard: Dashboard;

let devicesProvider: DevicesProvider;
let componentsProvider: ComponentsProvider;
let watchesProvider: WatchesProvider;
let jobsProvider: JobsProvider;
let connectionProvider: ConnectionProvider;

let currentConnection: Connection | null = null;
let currentJobs: Job[] = [];
let currentWatches: WatchSession[] = [];

export async function activate(ctx: vscode.ExtensionContext) {
    output = vscode.window.createOutputChannel('IORA OS Dev');
    statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    statusItem.text = '$(broadcast) IORA Dev: starting…';
    statusItem.command = 'ioraDev.dashboard';
    statusItem.show();
    manager = new DaemonManager(output);
    dashboard = new Dashboard(ctx, () => client);

    connectionProvider = new ConnectionProvider();
    devicesProvider = new DevicesProvider(() => client);
    componentsProvider = new ComponentsProvider();
    watchesProvider = new WatchesProvider();
    jobsProvider = new JobsProvider();

    ctx.subscriptions.push(
        output, statusItem,
        vscode.window.registerTreeDataProvider('ioraDev.connection', connectionProvider),
        vscode.window.registerTreeDataProvider('ioraDev.devices',    devicesProvider),
        vscode.window.registerTreeDataProvider('ioraDev.components', componentsProvider),
        vscode.window.registerTreeDataProvider('ioraDev.watches',    watchesProvider),
        vscode.window.registerTreeDataProvider('ioraDev.jobs',       jobsProvider),
    );

    ctx.subscriptions.push(
        cmd('ioraDev.discover',         cmdDiscover),
        cmd('ioraDev.connect',          cmdConnect),
        cmd('ioraDev.disconnect',       cmdDisconnect),
        cmd('ioraDev.status',           cmdStatus),
        cmd('ioraDev.deploy',           cmdDeploy),
        cmd('ioraDev.deployCurrent',    cmdDeployCurrent),
        cmd('ioraDev.watch',            cmdWatchStart),
        cmd('ioraDev.stopWatch',        cmdWatchStop),
        cmd('ioraDev.restart',          cmdRestart),
        cmd('ioraDev.reload',           cmdReload),
        cmd('ioraDev.composeReload',    cmdComposeReload),
        cmd('ioraDev.logs',             cmdLogs),
        cmd('ioraDev.dashboard',        () => dashboard.show()),
        cmd('ioraDev.startDaemon',      cmdStartDaemon),
        cmd('ioraDev.stopDaemon',       cmdStopDaemon),
        cmd('ioraDev.refresh',          refreshAll),
        cmd('ioraDev.showOutput',       () => output.show()),
        cmd('ioraDev.deployFromTree',   (item: any) => cmdDeploy(item?.label ? [item.label] : undefined)),
        cmd('ioraDev.watchFromTree',    (item: any) => cmdWatchStart(item?.label ? [item.label] : undefined)),
        cmd('ioraDev.logsFromTree',     (item: any) => cmdComponentLogs(item?.label ? item.label : undefined)),
        cmd('ioraDev.componentActions', (item: any) => cmdComponentActions(item?.label ? item.label : undefined)),
        cmd('ioraDev.connectFromTree',  (ep: string | undefined) => cmdConnect(ep)),
        cmd('ioraDev.stopWatchFromTree',(item: any) => cmdWatchStop(item?.id ?? item)),
    );

    // Initial connection (spawns daemon if needed). Don't fail activation.
    connectDaemon().catch(e => output.appendLine(`startup: ${e}`));
}

export function deactivate() {
    try { ws?.close(); } catch {}
    manager?.dispose();
}

function cmd(name: string, fn: (...args: any[]) => any) {
    return vscode.commands.registerCommand(name, async (...args) => {
        try { await fn(...args); }
        catch (e: any) {
            const msg = e instanceof DaemonUnavailable ? `IORA Dev: ${e.message}` : `IORA Dev: ${e.message ?? e}`;
            vscode.window.showErrorMessage(msg, 'Show Output').then(s => { if (s) output.show(); });
            output.appendLine(`ERROR: ${e.stack ?? e}`);
        }
    });
}

async function connectDaemon() {
    statusItem.text = '$(broadcast) IORA Dev: starting daemon…';
    client = await manager.ensureClient();
    output.appendLine('daemon: connected');
    await refreshAll();
    openEvents();
}

function openEvents() {
    if (!client) return;
    try { ws?.close(); } catch {}
    ws = client.openEvents(onEvent, () => {
        statusItem.text = '$(circle-slash) IORA Dev: events disconnected';
        // Try to reconnect after a short delay.
        setTimeout(() => { if (client) openEvents(); }, 2000);
    });
}

function onEvent(e: any) {
    dashboard.update(e);
    switch (e.type) {
        case 'snapshot':
            if (Array.isArray(e.devices)) devicesProvider.setDevices(e.devices);
            if (Array.isArray(e.watches)) {
                currentWatches = e.watches;
                watchesProvider.setItems(e.watches);
            }
            if (Array.isArray(e.jobs_recent)) {
                currentJobs = e.jobs_recent;
                jobsProvider.setItems(e.jobs_recent);
            }
            syncConnectionView();
            break;
        case 'devices_updated':
            devicesProvider.setDevices(e.devices ?? []);
            break;
        case 'watch_started':
        case 'watch_stopped':
            client?.watches().then(w => {
                currentWatches = w;
                watchesProvider.setItems(w);
                syncConnectionView();
            }).catch(() => {});
            break;
        case 'job_created':
        case 'job_finished':
            jobsProvider.upsert(e.job as Job);
            upsertJob(e.job as Job);
            syncConnectionView();
            break;
        case 'job_updated':
            if (e.id) {
                const idx = currentJobs.findIndex(j => j.id === e.id);
                if (idx >= 0) {
                    currentJobs[idx] = {
                        ...currentJobs[idx],
                        status: e.status ?? currentJobs[idx].status,
                        log: e.line ? [...currentJobs[idx].log, e.line] : currentJobs[idx].log,
                    };
                }
                syncConnectionView();
            }
            break;
        case 'connection':
            const preservedCapabilities = currentConnection?.host === (e.host ?? null)
                ? currentConnection?.capabilities
                : undefined;
            currentConnection = {
                host: e.host ?? null,
                configured: !!e.host,
                hostname: e.hostname,
                build: e.build,
                variant: e.variant,
                capabilities: preservedCapabilities,
                reachable: !!e.host,
            };
            syncConnectionView();
            break;
    }
}

function renderStatusBar() {
    if (currentConnection?.host) {
        const activeJobs = currentJobs.filter(j => j.status === 'running' || j.status === 'pending').length;
        const watchCount = currentWatches.length;
        const bridgeReady = currentConnection.capabilities?.includes('binary.build_replace') ?? false;
        const suffix = activeJobs > 0 ? ` • ${activeJobs} active job${activeJobs === 1 ? '' : 's'}` : watchCount > 0 ? ` • ${watchCount} watch${watchCount === 1 ? '' : 'es'}` : '';
        statusItem.text = `$(broadcast) IORA Dev: ${currentConnection.hostname ?? currentConnection.host}${suffix}`;
        statusItem.tooltip = `host=${currentConnection.host}\nvariant=${currentConnection.variant}\nbuild=${currentConnection.build}\nbridgeRemoteBuild=${bridgeReady ? 'ready' : 'update required'}\nactiveJobs=${activeJobs}\nwatchSessions=${watchCount}`;
    } else {
        statusItem.text = '$(circle-slash) IORA Dev: not connected';
        statusItem.tooltip = 'No active IORA dev server connection';
    }
}

function upsertJob(job: Job) {
    const idx = currentJobs.findIndex(j => j.id === job.id);
    if (idx >= 0) currentJobs[idx] = job;
    else currentJobs.unshift(job);
    if (currentJobs.length > 100) currentJobs.length = 100;
}

function syncConnectionView() {
    connectionProvider.setState(currentConnection, currentJobs, currentWatches);
    renderStatusBar();
}

async function refreshAll() {
    if (!client) { try { await connectDaemon(); } catch { return; } }
    if (!client) return;
    try {
        const [conn, comps, devs, watches, jobs] = await Promise.all([
            client.connection(),
            client.components(),
            client.devices(),
            client.watches(),
            client.jobs(),
        ]);
        currentConnection = conn;
        currentWatches = watches;
        currentJobs = jobs;
        componentsProvider.setItems(comps);
        devicesProvider.setDevices(devs);
        devicesProvider.setActive(conn.host);
        watchesProvider.setItems(watches);
        jobsProvider.setItems(jobs);
        syncConnectionView();
    } catch (e: any) {
        output.appendLine(`refresh: ${e.message ?? e}`);
    }
}

// ─── commands ─────────────────────────────────────────────────────────────

async function cmdDiscover() {
    const c = await ensureClient();
    const t = vscode.workspace.getConfiguration('ioraDev').get<number>('discoverTimeoutSecs') ?? 4;
    const dev = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `IORA Dev: scanning LAN (${t}s)…` },
        () => c.discover(t),
    );
    devicesProvider.setDevices(dev);
    if (dev.length === 0) vscode.window.showWarningMessage('No IORA OS Dev devices found on the LAN.');
    else vscode.window.showInformationMessage(`Found ${dev.length} device(s).`);
}

async function cmdConnect(prefilled?: string) {
    const c = await ensureClient();
    const host = await vscode.window.showInputBox({
        prompt: 'IORA OS Dev device host[:port]',
        value: prefilled,
        ignoreFocusOut: true,
    });
    if (!host) return;
    const token = await vscode.window.showInputBox({
        prompt: 'Dev token (from /etc/iora/dev-token on the device)',
        password: true, ignoreFocusOut: true,
    });
    if (!token) return;
    const r = await c.connect(host, token) as any;
    vscode.window.showInformationMessage(`IORA Dev: connected to ${r.host} (${r.hostname}, build ${r.build}).`);
    refreshAll();
}

async function cmdDisconnect() {
    const c = await ensureClient();
    await c.disconnect();
    refreshAll();
}

async function cmdStatus() {
    const c = await ensureClient();
    const s = await c.deviceStatus();
    output.show(true);
    output.appendLine('--- /dev/status ---');
    output.appendLine(JSON.stringify(s, null, 2));
}

async function pickComponents(prefilled?: string[]): Promise<string[] | undefined> {
    const c = await ensureClient();
    const all = await c.components();
    if (prefilled && prefilled.length) return prefilled;
    const picked = await vscode.window.showQuickPick(
        all.map(x => ({ label: x.name, description: x.unit, detail: x.target_path })),
        { canPickMany: true, title: 'Select component(s)' },
    );
    return picked?.map(p => p.label);
}

async function componentByName(name: string): Promise<Component | undefined> {
    const c = await ensureClient();
    const all = await c.components();
    return all.find(component => component.name === name);
}

async function cmdDeploy(prefilled?: string[]) {
    const c = await ensureClient();
    const comps = await pickComponents(prefilled);
    if (!comps || comps.length === 0) return;
    const target = vscode.workspace.getConfiguration('ioraDev').get<string>('target') ?? 'aarch64-unknown-linux-gnu';
    const buildMode = vscode.workspace.getConfiguration('ioraDev').get<string>('buildMode') ?? 'device';
    const r = await c.deploy({ components: comps, target, build_mode: buildMode });
    vscode.window.showInformationMessage(`IORA Dev: deploy started (${r.job_id.slice(0,8)}).`);
}

async function cmdDeployCurrent() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showWarningMessage('No active editor.'); return; }
    const file = editor.document.uri.fsPath;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) { vscode.window.showWarningMessage('No workspace folder.'); return; }
    // Walk toward backend/<crate>/...
    const parts = path.relative(root, file).split(/[\\/]/);
    const i = parts.indexOf('backend');
    if (i < 0 || !parts[i + 1]) {
        vscode.window.showWarningMessage('Active file is not inside a deployable IORA component.');
        return;
    }
    if (parts[i + 1] === 'dev' && parts[i + 2] === 'iora-dev-bridge') {
        return cmdDeploy(['iora-dev-bridge']);
    }
    return cmdDeploy([parts[i + 1]]);
}

async function cmdWatchStart(prefilled?: string[]) {
    const c = await ensureClient();
    const automatic = (vscode.workspace.getConfiguration('ioraDev').get<boolean>('automaticMode') ?? false) && (!prefilled || prefilled.length === 0);
    const comps = automatic ? [] : await pickComponents(prefilled);
    if (!automatic && (!comps || comps.length === 0)) return;
    const target = vscode.workspace.getConfiguration('ioraDev').get<string>('target') ?? 'aarch64-unknown-linux-gnu';
    const buildMode = vscode.workspace.getConfiguration('ioraDev').get<string>('buildMode') ?? 'device';
    const debounce = vscode.workspace.getConfiguration('ioraDev').get<number>('watchDebounceMs') ?? 800;
    const w = await c.startWatch({ components: comps ?? [], target, build_mode: buildMode, automatic, debounce_ms: debounce });
    const label = w.automatic ? 'automatic workspace mode' : w.components.join(', ');
    vscode.window.showInformationMessage(`IORA Dev: watching ${label}.`);
    refreshAll();
}

async function cmdComponentLogs(componentName?: string) {
    const c = await ensureClient();
    let targetName = componentName;
    if (!targetName) {
        const selected = await pickComponents();
        if (!selected || selected.length === 0) return;
        targetName = selected[0];
    }
    const component = await componentByName(targetName);
    if (!component) {
        vscode.window.showWarningMessage(`Unknown component: ${targetName}`);
        return;
    }
    const r = await c.serviceLogs(component.unit, 300);
    output.show(true);
    output.appendLine(`--- service logs ${component.unit} (tail=300) ---`);
    output.append(r.stdout);
    if (r.stderr) { output.appendLine('---stderr---'); output.append(r.stderr); }
}

async function cmdComponentActions(componentName?: string) {
    let targetName = componentName;
    if (!targetName) {
        const selected = await pickComponents();
        if (!selected || selected.length === 0) return;
        targetName = selected[0];
    }
    const component = await componentByName(targetName);
    if (!component) {
        vscode.window.showWarningMessage(`Unknown component: ${targetName}`);
        return;
    }
    const pick = await vscode.window.showQuickPick([
        { label: 'Deploy', action: 'deploy' },
        { label: 'Watch', action: 'watch' },
        { label: 'Show Logs', action: 'logs' },
        { label: 'Restart Service', action: 'restart' },
        { label: 'Reload Service', action: 'reload' },
    ], { title: `Actions for ${component.name}` });
    if (!pick) return;
    switch (pick.action) {
        case 'deploy': return cmdDeploy([component.name]);
        case 'watch': return cmdWatchStart([component.name]);
        case 'logs': return cmdComponentLogs(component.name);
        case 'restart': {
            const daemon = await ensureClient();
            const r = await daemon.restart(component.unit) as any;
            output.show(true);
            output.appendLine(`--- restart ${component.unit} ---\n${JSON.stringify(r, null, 2)}`);
            return;
        }
        case 'reload': {
            const daemon = await ensureClient();
            const r = await daemon.serviceReload(component.unit) as any;
            output.show(true);
            output.appendLine(`--- reload ${component.unit} ---\n${JSON.stringify(r, null, 2)}`);
            return;
        }
    }
}

async function cmdWatchStop(arg?: WatchSession | string) {
    const c = await ensureClient();
    const list = await c.watches();
    if (list.length === 0) { vscode.window.showInformationMessage('No active watch sessions.'); return; }
    let id = typeof arg === 'string' ? arg : (arg as any)?.id;
    if (!id) {
        const pick = await vscode.window.showQuickPick(
            list.map(w => ({ label: w.components.join(', '), description: w.id, detail: w.target, w })),
            { title: 'Stop which watch session?' },
        );
        id = pick?.w.id;
    }
    if (!id) return;
    await c.stopWatch(id);
    refreshAll();
}

async function cmdRestart() {
    const c = await ensureClient();
    const unit = await vscode.window.showInputBox({ prompt: 'systemd unit (e.g. iora-control)', ignoreFocusOut: true });
    if (!unit) return;
    const r = await c.restart(unit) as any;
    output.show(true);
    output.appendLine(`--- restart ${unit} ---\n${JSON.stringify(r, null, 2)}`);
}

async function cmdReload() {
    const c = await ensureClient();
    const unit = await vscode.window.showInputBox({ prompt: 'systemd unit (e.g. iora-control)', ignoreFocusOut: true });
    if (!unit) return;
    const r = await c.serviceReload(unit) as any;
    output.show(true);
    output.appendLine(`--- reload ${unit} ---\n${JSON.stringify(r, null, 2)}`);
}

async function cmdComposeReload() {
    const c = await ensureClient();
    const svc = await vscode.window.showInputBox({ prompt: 'docker-compose service', ignoreFocusOut: true });
    if (!svc) return;
    const r = await c.composeReload(svc) as any;
    output.show(true);
    output.appendLine(`--- compose reload ${svc} ---\n${JSON.stringify(r, null, 2)}`);
}

async function cmdLogs() {
    const c = await ensureClient();
    const svc = await vscode.window.showInputBox({ prompt: 'docker-compose service', ignoreFocusOut: true });
    if (!svc) return;
    const r = await c.composeLogs(svc, 500);
    output.show(true);
    output.appendLine(`--- compose logs ${svc} (tail=500) ---`);
    output.append(r.stdout);
    if (r.stderr) { output.appendLine('---stderr---'); output.append(r.stderr); }
}

async function cmdStartDaemon() {
    await manager.start();
    setTimeout(() => connectDaemon().catch(() => {}), 500);
}

async function cmdStopDaemon() {
    try { ws?.close(); } catch {}
    await manager.stop();
    statusItem.text = '$(circle-slash) IORA Dev: daemon stopped';
}

async function ensureClient(): Promise<DaemonClient> {
    if (client) return client;
    await connectDaemon();
    if (!client) throw new DaemonUnavailable('daemon could not be started');
    return client;
}
