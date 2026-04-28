// IORA OS Dev — VS Code extension entry point.
//
// Architecture: the extension is a thin orchestrator. All real work
// (mDNS discovery, cargo builds, binary uploads, watch sessions) is done
// by the `iora-dev-deploy daemon` process spawned on demand. We talk to it
// over HTTP/WS on 127.0.0.1.

import * as vscode from 'vscode';
import * as path from 'path';
import WebSocket from 'ws';
import { Component, Connection, DaemonClient, DaemonUnavailable, Job, ServicesStatus, WatchSession } from './api';
import { DaemonManager } from './daemonManager';
import { ComponentsProvider, ConnectionProvider, DevicesProvider, JobsProvider, ServicesProvider, WatchesProvider } from './views';
import { Dashboard } from './dashboard';
import { LiveLogManager } from './liveLogs';

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
let servicesProvider: ServicesProvider;
let liveLogs: LiveLogManager;

let currentConnection: Connection | null = null;
let currentJobs: Job[] = [];
let currentWatches: WatchSession[] = [];
let currentServices: ServicesStatus | null = null;

let wsBackoffMs = 1000;
let servicesPollTimer: NodeJS.Timeout | undefined;

export async function activate(ctx: vscode.ExtensionContext) {
    output = vscode.window.createOutputChannel('IORA OS Dev');
    statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    statusItem.text = '$(broadcast) IORA Dev: starting…';
    // Clicking the status bar opens the service quick-pick — the most
    // useful entry point in the steady state. The dashboard is still
    // reachable via Cmd-Shift-P.
    statusItem.command = 'ioraDev.servicePalette';
    statusItem.show();
    manager = new DaemonManager(output);
    dashboard = new Dashboard(ctx, () => client);

    connectionProvider = new ConnectionProvider();
    devicesProvider = new DevicesProvider(() => client);
    componentsProvider = new ComponentsProvider();
    watchesProvider = new WatchesProvider();
    jobsProvider = new JobsProvider();
    servicesProvider = new ServicesProvider();
    liveLogs = new LiveLogManager(() => client, output);

    ctx.subscriptions.push(
        output, statusItem,
        vscode.window.registerTreeDataProvider('ioraDev.connection', connectionProvider),
        vscode.window.registerTreeDataProvider('ioraDev.devices',    devicesProvider),
        vscode.window.registerTreeDataProvider('ioraDev.services',   servicesProvider),
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
        cmd('ioraDev.serviceLogs',           cmdServiceLogsTail),
        cmd('ioraDev.serviceLogsFromTree',   (item: any) => cmdServiceLogsTail(item?.label)),
        cmd('ioraDev.serviceRestartFromTree',(item: any) => cmdServiceRestart(item?.label)),
        cmd('ioraDev.openServiceLiveLogs',     (arg?: any) => cmdOpenLiveLogs(arg?.label ?? arg)),
        cmd('ioraDev.stopServiceLiveLogs',     () => cmdStopLiveLogs()),
        cmd('ioraDev.openServiceUrl',          (arg?: any) => cmdOpenServiceUrl(arg?.label ?? arg)),
        cmd('ioraDev.systemInfo',              cmdSystemInfo),
        cmd('ioraDev.rebootDevice',            cmdRebootDevice),
        cmd('ioraDev.servicePalette',          cmdServicePalette),
    );

    // Initial connection (spawns daemon if needed). Don't fail activation.
    connectDaemon().catch(e => output.appendLine(`startup: ${e}`));
}

export function deactivate() {
    try { ws?.close(); } catch {}
    if (servicesPollTimer) { clearInterval(servicesPollTimer); servicesPollTimer = undefined; }
    liveLogs?.disposeAll();
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
    ws = client.openEvents(
        (e) => {
            // Successful message → we have a working channel → reset backoff.
            wsBackoffMs = 1000;
            onEvent(e);
        },
        () => {
            statusItem.text = '$(circle-slash) IORA Dev: events disconnected';
            // Exponential backoff up to 30s. Without this, a daemon
            // restart used to cause a reconnect storm in the journal.
            const delay = wsBackoffMs;
            wsBackoffMs = Math.min(wsBackoffMs * 2, 30_000);
            output.appendLine(`events: socket closed; retrying in ${delay}ms`);
            setTimeout(() => { if (client) openEvents(); }, delay);
        },
    );
}

/// Lightweight 5s poll for the live service map. Belts-and-braces in
/// case the daemon's snapshot events don't include `services` (older
/// daemons) or the WebSocket is briefly down.
function startServicesPolling() {
    if (servicesPollTimer) clearInterval(servicesPollTimer);
    servicesPollTimer = setInterval(async () => {
        if (!client || !currentConnection?.host) return;
        try {
            const snap = await client.services();
            currentServices = snap;
            servicesProvider.setSnapshot(snap);
            renderStatusBar();
        } catch (e: any) {
            // Fail quiet — the WS feed should usually be enough; we just
            // surface the last known snapshot until the next attempt.
            servicesProvider.setSnapshot(currentServices, e?.message ?? String(e));
        }
    }, 5000);
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
            if (e.services && typeof e.services === 'object') {
                currentServices = e.services as ServicesStatus;
                servicesProvider.setSnapshot(currentServices);
            }
            syncConnectionView();
            break;
        case 'services_updated':
            if (e.services) {
                currentServices = e.services as ServicesStatus;
                servicesProvider.setSnapshot(currentServices);
                renderStatusBar();
            }
            break;
        case 'service.heartbeat':
        case 'service.stale':
        case 'service.registered':
            // Nudge the poll loop without waiting for the next tick.
            if (client) {
                client.services().then(s => {
                    currentServices = s;
                    servicesProvider.setSnapshot(s);
                    renderStatusBar();
                }).catch(() => {});
            }
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
        const summary = currentServices?.summary;
        const bad = (summary?.unhealthy ?? 0) + (summary?.stale ?? 0);
        const degraded = summary?.degraded ?? 0;
        let icon = '$(broadcast)';
        let bg: vscode.ThemeColor | undefined;
        if (summary && summary.total > 0) {
            if (bad > 0) {
                icon = '$(error)';
                bg = new vscode.ThemeColor('statusBarItem.errorBackground');
            } else if (degraded > 0) {
                icon = '$(warning)';
                bg = new vscode.ThemeColor('statusBarItem.warningBackground');
            } else {
                icon = '$(pass-filled)';
            }
        }
        statusItem.backgroundColor = bg;
        const parts: string[] = [];
        if (activeJobs > 0) parts.push(`${activeJobs} job${activeJobs === 1 ? '' : 's'}`);
        if (watchCount > 0) parts.push(`${watchCount} watch${watchCount === 1 ? '' : 'es'}`);
        if (summary && summary.total > 0) {
            parts.push(`${summary.healthy}/${summary.total} services up`);
        }
        const suffix = parts.length ? ` • ${parts.join(' • ')}` : '';
        statusItem.text = `${icon} IORA Dev: ${currentConnection.hostname ?? currentConnection.host}${suffix}`;
        const summaryLines = summary
            ? `\nservices: total=${summary.total} healthy=${summary.healthy} degraded=${summary.degraded} unhealthy=${summary.unhealthy} stale=${summary.stale}`
            : '\nservices: (no data)';
        statusItem.tooltip = `host=${currentConnection.host}\nvariant=${currentConnection.variant}\nbuild=${currentConnection.build}\nbridgeRemoteBuild=${bridgeReady ? 'ready' : 'update required'}\nactiveJobs=${activeJobs}\nwatchSessions=${watchCount}${summaryLines}`;
    } else {
        statusItem.backgroundColor = undefined;
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
        // Pull the live service map; tolerate older daemons that don't
        // expose /api/v1/services yet.
        try {
            const services = await client.services();
            currentServices = services;
            servicesProvider.setSnapshot(services);
        } catch (e: any) {
            servicesProvider.setSnapshot(currentServices, `services unavailable: ${e?.message ?? e}`);
        }
        syncConnectionView();
        startServicesPolling();
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

async function cmdServiceLogsTail(serviceName?: string) {
    const c = await ensureClient();
    let name = serviceName;
    if (!name) {
        const list = currentServices?.services ?? [];
        const pick = list.length
            ? await vscode.window.showQuickPick(list.map(s => ({ label: s.name, description: s.effective_status, detail: s.url })), { title: 'Tail logs of which service?' })
            : undefined;
        name = pick?.label ?? await vscode.window.showInputBox({ prompt: 'systemd unit name (e.g. iora-watchdog)', ignoreFocusOut: true });
        if (!name) return;
    }
    const r = await c.serviceLogs(name, 300);
    output.show(true);
    output.appendLine(`--- service logs ${name} (tail=300) ---`);
    output.append(r.stdout);
    if (r.stderr) { output.appendLine('---stderr---'); output.append(r.stderr); }
}

async function cmdOpenLiveLogs(serviceName?: string) {
    let unit = serviceName;
    if (!unit) {
        const list = currentServices?.services ?? [];
        const pick = list.length
            ? await vscode.window.showQuickPick(
                list.map(s => ({
                    label: s.name,
                    description: s.effective_status,
                    detail: s.message ?? s.url,
                })),
                { title: 'Open live logs for which service?' })
            : undefined;
        unit = pick?.label;
        if (!unit) {
            unit = await vscode.window.showInputBox({
                prompt: 'systemd unit name (e.g. iora-watchdog)',
                ignoreFocusOut: true,
            });
        }
        if (!unit) return;
    }
    // Most callers pass a friendly name (`iora-watchdog`); the bridge
    // also accepts the explicit `.service` form. We let the bridge
    // figure it out so users don't have to think about it.
    await liveLogs.open(unit);
}

async function cmdStopLiveLogs() {
    const active = liveLogs.activeUnits();
    if (active.length === 0) {
        vscode.window.showInformationMessage('No live-log streams are active.');
        return;
    }
    const pick = await vscode.window.showQuickPick(
        active.map(u => ({ label: u })),
        { title: 'Stop which live-log stream?', canPickMany: true });
    if (!pick) return;
    for (const p of pick) liveLogs.close(p.label);
}

async function cmdOpenServiceUrl(serviceName?: string) {
    const list = currentServices?.services ?? [];
    const svc = list.find(s => s.name === serviceName)
        ?? (await pickServiceFromTree('Open which service URL?'));
    if (!svc) return;
    if (!svc.url) {
        vscode.window.showWarningMessage(`${svc.name} has not reported a URL yet.`);
        return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(svc.url));
}

async function pickServiceFromTree(title: string) {
    const list = currentServices?.services ?? [];
    if (list.length === 0) {
        vscode.window.showInformationMessage('No services have heartbeated yet.');
        return undefined;
    }
    const pick = await vscode.window.showQuickPick(
        list.map(s => ({
            label: s.name,
            description: `${s.effective_status}${s.url ? ' • ' + s.url : ''}`,
            detail: s.message ?? '',
            svc: s,
        })),
        { title });
    return pick?.svc;
}

async function cmdSystemInfo() {
    const c = await ensureClient();
    try {
        const info = await c.systemInfo();
        const fmtBytes = (n: number) => {
            if (n > 1e9) return `${(n / 1e9).toFixed(1)} GB`;
            if (n > 1e6) return `${(n / 1e6).toFixed(1)} MB`;
            if (n > 1e3) return `${(n / 1e3).toFixed(1)} kB`;
            return `${n} B`;
        };
        const lines = [
            `host:    ${info.hostname}`,
            `build:   ${info.build}`,
            `uptime:  ${info.uptime_seconds}s`,
            `loadavg: ${info.loadavg}`,
            `cpus:    ${info.cpu_count}`,
            `memory:  ${fmtBytes(info.mem_total_bytes - info.mem_available_bytes)} / ${fmtBytes(info.mem_total_bytes)} used`,
            `disk /:  ${fmtBytes(info.disk_used_bytes)} / ${fmtBytes(info.disk_total_bytes)} used (${fmtBytes(info.disk_free_bytes)} free)`,
        ];
        output.show(true);
        output.appendLine('--- system info ---');
        for (const l of lines) output.appendLine(l);
    } catch (e: any) {
        vscode.window.showErrorMessage(`system info failed: ${e?.message ?? e}`);
    }
}

async function cmdRebootDevice() {
    const yes = await vscode.window.showWarningMessage(
        'Reboot the connected IORA device? This will interrupt all running services.',
        { modal: true },
        'Reboot');
    if (yes !== 'Reboot') return;
    const c = await ensureClient();
    try {
        const r = await c.systemReboot();
        vscode.window.showInformationMessage(`Reboot scheduled in ${r.scheduled_in_secs}s.`);
    } catch (e: any) {
        vscode.window.showErrorMessage(`reboot failed: ${e?.message ?? e}`);
    }
}

/// Quick-pick of every known service with the typical actions: deploy,
/// watch, restart, reload, live logs, open URL. Bound to clicking the
/// status-bar item so the most useful ops are one shortcut away.
async function cmdServicePalette() {
    const svc = await pickServiceFromTree('IORA Dev — Service Actions');
    if (!svc) return;
    const action = await vscode.window.showQuickPick([
        { label: '$(broadcast) Live Logs',  action: 'live'    },
        { label: '$(output) Tail Logs',     action: 'logs'    },
        { label: '$(rocket) Deploy',        action: 'deploy'  },
        { label: '$(eye) Watch',            action: 'watch'   },
        { label: '$(debug-restart) Restart',action: 'restart' },
        { label: '$(refresh) Reload',       action: 'reload'  },
        { label: '$(link-external) Open URL', action: 'url'   },
    ], { title: `Actions for ${svc.name}` });
    if (!action) return;
    switch (action.action) {
        case 'live':    return cmdOpenLiveLogs(svc.name);
        case 'logs':    return cmdServiceLogsTail(svc.name);
        case 'deploy':  return cmdDeploy([svc.name]);
        case 'watch':   return cmdWatchStart([svc.name]);
        case 'restart': return cmdServiceRestart(svc.name);
        case 'reload':  {
            const c = await ensureClient();
            const r = await c.serviceReload(svc.name) as any;
            output.show(true);
            output.appendLine(`--- reload ${svc.name} ---\n${JSON.stringify(r, null, 2)}`);
            return;
        }
        case 'url':     return cmdOpenServiceUrl(svc.name);
    }
}

async function cmdServiceRestart(serviceName?: string) {
    if (!serviceName) return;
    const yes = await vscode.window.showWarningMessage(`Restart ${serviceName}?`, { modal: true }, 'Restart');
    if (yes !== 'Restart') return;
    const c = await ensureClient();
    const r = await c.restart(serviceName) as any;
    output.show(true);
    output.appendLine(`--- restart ${serviceName} ---\n${JSON.stringify(r, null, 2)}`);
}

async function ensureClient(): Promise<DaemonClient> {
    if (client) return client;
    await connectDaemon();
    if (!client) throw new DaemonUnavailable('daemon could not be started');
    return client;
}
