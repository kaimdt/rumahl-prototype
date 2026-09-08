"use strict";
// rumahl OS Dev — VS Code extension entry point.
//
// Architecture: thin orchestrator. All real work (mDNS discovery, cargo builds,
// binary uploads, watch sessions) is done by the `rumahl-dev-deploy daemon`
// spawned on demand. We talk to it over HTTP/WS on 127.0.0.1.
//
// Key improvement: the dev-token is persisted in VS Code's secret storage
// (OS keychain) so that reconnecting survives daemon / VS Code restarts.
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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const api_1 = require("./api");
const daemonManager_1 = require("./daemonManager");
const views_1 = require("./views");
const dashboard_1 = require("./dashboard");
const liveLogs_1 = require("./liveLogs");
// ─── Module-level state ───────────────────────────────────────────────────
let output;
let statusItem;
let manager;
let client;
let ws;
let dashboard;
let devicesProvider;
let componentsProvider;
let activityProvider;
let connectionProvider;
let servicesProvider;
let liveLogs;
let currentConnection = null;
let currentJobs = [];
let currentWatches = [];
let currentServices = null;
let wsBackoffMs = 1000;
let servicesPollTimer;
// Persisted credentials
const SECRET_TOKEN_KEY = 'oraDev.devToken';
const STATE_HOST_KEY = 'oraDev.savedHost';
const STATE_HOSTNAME_KEY = 'oraDev.savedHostname';
let extensionContext;
// ─── Activate / Deactivate ────────────────────────────────────────────────
async function activate(ctx) {
    extensionContext = ctx;
    output = vscode.window.createOutputChannel('rumahl OS Dev');
    statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    statusItem.text = '$(broadcast) rumahl Dev: starting…';
    statusItem.command = 'oraDev.servicePalette';
    statusItem.tooltip = 'Click for service actions';
    statusItem.show();
    manager = new daemonManager_1.DaemonManager(output);
    dashboard = new dashboard_1.Dashboard(ctx, () => client);
    // Providers
    connectionProvider = new views_1.ConnectionProvider();
    devicesProvider = new views_1.DevicesProvider(() => client);
    componentsProvider = new views_1.ComponentsProvider();
    activityProvider = new views_1.ActivityProvider();
    servicesProvider = new views_1.ServicesProvider();
    liveLogs = new liveLogs_1.LiveLogManager(() => client, output);
    ctx.subscriptions.push(output, statusItem, vscode.window.registerTreeDataProvider('oraDev.connection', connectionProvider), vscode.window.registerTreeDataProvider('oraDev.devices', devicesProvider), vscode.window.registerTreeDataProvider('oraDev.services', servicesProvider), vscode.window.registerTreeDataProvider('oraDev.components', componentsProvider), vscode.window.registerTreeDataProvider('oraDev.activity', activityProvider));
    ctx.subscriptions.push(cmd('oraDev.discover', cmdDiscover), cmd('oraDev.connect', cmdConnect), cmd('oraDev.disconnect', cmdDisconnect), cmd('oraDev.forgetCredentials', cmdForgetCredentials), cmd('oraDev.deploy', cmdDeploy), cmd('oraDev.deployCurrent', cmdDeployCurrent), cmd('oraDev.watch', cmdWatchStart), cmd('oraDev.stopWatch', cmdWatchStop), cmd('oraDev.restart', cmdRestart), cmd('oraDev.reload', cmdReload), cmd('oraDev.composeReload', cmdComposeReload), cmd('oraDev.logs', cmdLogs), cmd('oraDev.dashboard', () => dashboard.show()), cmd('oraDev.startDaemon', cmdStartDaemon), cmd('oraDev.stopDaemon', cmdStopDaemon), cmd('oraDev.refresh', refreshAll), cmd('oraDev.showOutput', () => output.show()), cmd('oraDev.deployFromTree', (item) => cmdDeploy(item?.name ? [item.name] : (item?.label ? [item.label] : undefined))), cmd('oraDev.watchFromTree', (item) => cmdWatchStart(item?.name ? [item.name] : (item?.label ? [item.label] : undefined))), cmd('oraDev.logsFromTree', (item) => cmdComponentLogs(item?.name ?? item?.label ?? item)), cmd('oraDev.componentActions', (item) => cmdComponentActions(item?.name ?? item?.label ?? item)), cmd('oraDev.connectFromTree', (ep) => cmdConnect(ep)), cmd('oraDev.stopWatchFromTree', (item) => cmdWatchStop(item?.id ?? item)), cmd('oraDev.serviceLogs', cmdServiceLogsTail), cmd('oraDev.serviceLogsFromTree', (item) => cmdServiceLogsTail(item?.name ?? item?.label ?? item)), cmd('oraDev.serviceRestartFromTree', (item) => cmdServiceRestart(item?.name ?? item?.label ?? item)), cmd('oraDev.openServiceLiveLogs', (arg) => cmdOpenLiveLogs(arg?.name ?? arg?.label ?? arg)), cmd('oraDev.stopServiceLiveLogs', () => cmdStopLiveLogs()), cmd('oraDev.openServiceUrl', (arg) => cmdOpenServiceUrl(arg?.name ?? arg?.label ?? arg)), cmd('oraDev.systemInfo', cmdSystemInfo), cmd('oraDev.rebootDevice', cmdRebootDevice), cmd('oraDev.servicePalette', cmdServicePalette), cmd('oraDev.connectSaved', cmdConnectSaved));
    // Start: spawn daemon + try saved credentials
    connectDaemon().catch(e => output.appendLine(`startup: ${e}`));
}
function deactivate() {
    try {
        ws?.close();
    }
    catch { /* ignore */ }
    if (servicesPollTimer) {
        clearInterval(servicesPollTimer);
        servicesPollTimer = undefined;
    }
    liveLogs?.disposeAll();
    manager?.dispose();
}
/** Extract the meaningful detail from a daemon error message. */
function extractDetail(msg) {
    // The daemon puts the bridge's response in the error message, e.g.:
    // "system/info 401 Unauthorized from http://..."
    // Or the new detailed message from h_connect.
    if (msg.includes('1. SSH into the device')) {
        // The daemon now returns helpful instructions directly
        const lines = msg.split('\n').slice(1).filter(l => l.match(/^\d\./));
        return lines.join('\n');
    }
    if (msg.includes('401') || msg.includes('Unauthorized')) {
        return 'The dev-token was rejected. Make sure you\'re using the token from /var/lib/ora/dev-token on the device.';
    }
    return msg;
}
// ─── Command wrapper ──────────────────────────────────────────────────────
function cmd(name, fn) {
    return vscode.commands.registerCommand(name, async (...args) => {
        try {
            await fn(...args);
        }
        catch (e) {
            const isAuth = e?.message?.includes('401') || e?.message?.includes('Unauthorized');
            const msg = e instanceof api_1.DaemonUnavailable
                ? `rumahl Dev: ${e.message}`
                : isAuth
                    ? `rumahl Dev: Authentication failed — the saved dev-token may be invalid. Run "rumahl Dev: Connect to Device…" to re-connect.`
                    : `rumahl Dev: ${e.message ?? e}`;
            const actions = isAuth ? ['Forget Token & Reconnect', 'Show Output'] : ['Show Output'];
            vscode.window.showErrorMessage(msg, ...actions).then(s => {
                if (s === 'Forget Token & Reconnect')
                    cmdForgetCredentials().then(() => cmdConnect());
                else if (s === 'Show Output')
                    output.show();
            });
            output.appendLine(`ERROR: ${e.stack ?? e}`);
        }
    });
}
// ─── Daemon connection lifecycle ──────────────────────────────────────────
async function connectDaemon() {
    statusItem.text = '$(broadcast) rumahl Dev: starting daemon…';
    client = await manager.ensureClient();
    output.appendLine('daemon: connected');
    // The daemon auto-connects to devices on startup (mDNS scan +
    // token reuse). We just read whatever state the daemon has
    // already established — no separate VS Code auto-connect needed.
    await refreshAll();
    openEvents();
}
/** Try to authenticate with a previously saved host+token. Silent on failure.
 * When the saved host is unreachable, the extension checks the daemon's
 * connection state for discovered alternatives and offers one-click reconnect. */
async function tryAutoConnect(host) {
    if (!client)
        return;
    const token = await extensionContext.secrets.get(SECRET_TOKEN_KEY);
    if (!token) {
        output.appendLine('auto-connect: no saved token found');
        return;
    }
    // First, check what the daemon actually has in its config.toml.
    // VS Code globalState can drift (e.g. if the user re-connects via CLI).
    try {
        const conn = await client.connection();
        const daemonHost = conn.saved_host;
        if (daemonHost && daemonHost !== host) {
            output.appendLine(`auto-connect: VS Code saved "${host}" but daemon has "${daemonHost}" — using daemon's config`);
            host = daemonHost;
            // Persist the daemon's host so we don't drift again.
            await extensionContext.globalState.update(STATE_HOST_KEY, daemonHost);
        }
    }
    catch {
        // Daemon may not be fully ready yet; proceed with what we have.
    }
    try {
        const r = await client.connect(host, token);
        output.appendLine(`auto-connect: connected to ${r.host} (${r.hostname})`);
        await refreshAll();
    }
    catch (e) {
        const msg = e?.message ?? String(e);
        output.appendLine(`auto-connect failed: ${msg}`);
        // Check if the daemon found alternative devices on the LAN
        try {
            const conn = await client.connection();
            const discovered = conn.discovered;
            const suggestedHost = conn.suggested_host;
            if (discovered && discovered.length > 0 && suggestedHost && token) {
                // Device IP likely changed — offer one-click reconnect.
                const suggestedName = conn.suggested_hostname
                    ?? suggestedHost.split(':')[0];
                const label = discovered.length === 1
                    ? `Reconnect to ${suggestedName} (${suggestedHost})`
                    : `Reconnect to ${suggestedName} (${suggestedHost}) — ${discovered.length} device(s) found`;
                output.appendLine(`auto-connect: found ${discovered.length} alternative device(s) on LAN, suggesting ${suggestedHost}`);
                vscode.window.showWarningMessage(`rumahl Dev: Saved host ${host} is unreachable. ${discovered.length === 1 ? 'One device' : `${discovered.length} devices`} found on LAN.`, 'Reconnect Now', 'Show All Devices').then(async (choice) => {
                    if (choice === 'Reconnect Now') {
                        try {
                            const r = await client.connect(suggestedHost, token);
                            await extensionContext.secrets.store(SECRET_TOKEN_KEY, token);
                            await extensionContext.globalState.update(STATE_HOST_KEY, suggestedHost);
                            await extensionContext.globalState.update(STATE_HOSTNAME_KEY, r.hostname ?? null);
                            output.appendLine(`reconnected to ${r.host} (${r.hostname})`);
                            await refreshAll();
                        }
                        catch (e2) {
                            output.appendLine(`reconnect failed: ${e2?.message ?? e2}`);
                            cmdConnect(suggestedHost);
                        }
                    }
                    else if (choice === 'Show All Devices') {
                        // Let user pick from all discovered devices
                        cmdConnect();
                    }
                });
                return;
            }
        }
        catch {
            // Couldn't get connection state; fall through to error handling.
        }
        // If 401, clear the stored credentials so user knows to re-connect
        if (msg.includes('401') || msg.includes('Unauthorized')) {
            output.appendLine('auto-connect: token rejected, clearing saved credentials');
            await extensionContext.secrets.delete(SECRET_TOKEN_KEY);
            await extensionContext.globalState.update(STATE_HOST_KEY, undefined);
            await extensionContext.globalState.update(STATE_HOSTNAME_KEY, undefined);
            vscode.window.showWarningMessage('rumahl Dev: Saved dev-token was rejected by the device. Please reconnect.', 'Connect').then(s => { if (s === 'Connect')
                cmdConnect(); });
        }
    }
}
function openEvents() {
    if (!client)
        return;
    try {
        ws?.close();
    }
    catch { /* ignore */ }
    ws = client.openEvents((e) => {
        wsBackoffMs = 1000;
        onEvent(e);
    }, () => {
        statusItem.text = '$(circle-slash) rumahl Dev: events disconnected';
        const delay = wsBackoffMs;
        wsBackoffMs = Math.min(wsBackoffMs * 2, 30_000);
        output.appendLine(`events: socket closed; retrying in ${delay}ms`);
        setTimeout(() => { if (client)
            openEvents(); }, delay);
    });
}
function startServicesPolling() {
    if (servicesPollTimer)
        clearInterval(servicesPollTimer);
    servicesPollTimer = setInterval(async () => {
        if (!client || !currentConnection?.host)
            return;
        try {
            const snap = await client.services();
            currentServices = snap;
            servicesProvider.setSnapshot(snap);
            renderStatusBar();
        }
        catch (e) {
            servicesProvider.setSnapshot(currentServices, e?.message ?? String(e));
        }
    }, 5000);
}
// ─── Event handler ────────────────────────────────────────────────────────
function onEvent(e) {
    dashboard.update(e);
    switch (e.type) {
        case 'snapshot':
            if (Array.isArray(e.devices))
                devicesProvider.setDevices(e.devices);
            if (Array.isArray(e.watches)) {
                currentWatches = e.watches;
                activityProvider.setWatches(e.watches);
            }
            if (Array.isArray(e.jobs_recent)) {
                currentJobs = e.jobs_recent;
                activityProvider.setJobs(e.jobs_recent);
            }
            if (e.services && typeof e.services === 'object') {
                currentServices = e.services;
                servicesProvider.setSnapshot(currentServices);
            }
            // The daemon now includes connection state in the WS snapshot
            // (fixes dashboard showing "not connected" after reconnect).
            if (e.connection && typeof e.connection === 'object') {
                const c = e.connection;
                const preservedCapabilities = currentConnection?.host === (c.host ?? null)
                    ? currentConnection?.capabilities
                    : undefined;
                currentConnection = {
                    host: c.host ?? null,
                    configured: !!c.host,
                    hostname: c.hostname,
                    build: c.build,
                    variant: c.variant,
                    capabilities: preservedCapabilities ?? c.capabilities,
                    reachable: c.reachable !== false && !!c.host,
                };
                dashboard.setConnection(currentConnection);
                // Keep VS Code globalState in sync with the daemon.
                // When the daemon auto-connects/reconnects, the IDE knows
                // about it without a separate credential store.
                if (c.host) {
                    extensionContext.globalState.update(STATE_HOST_KEY, c.host);
                    if (c.hostname) {
                        extensionContext.globalState.update(STATE_HOSTNAME_KEY, c.hostname);
                    }
                }
            }
            syncConnectionView();
            break;
        case 'services_updated':
            if (e.services) {
                currentServices = e.services;
                servicesProvider.setSnapshot(currentServices);
                renderStatusBar();
            }
            break;
        case 'service.heartbeat':
        case 'service.stale':
        case 'service.registered':
            if (client) {
                client.services().then(s => {
                    currentServices = s;
                    servicesProvider.setSnapshot(s);
                    renderStatusBar();
                }).catch(() => { });
            }
            break;
        case 'devices_updated':
            devicesProvider.setDevices(e.devices ?? []);
            break;
        case 'watch_started':
        case 'watch_stopped':
            client?.watches().then(w => {
                currentWatches = w;
                activityProvider.setWatches(w);
                syncConnectionView();
            }).catch(() => { });
            break;
        case 'job_created':
        case 'job_finished':
            activityProvider.upsertJob(e.job);
            upsertJob(e.job);
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
            dashboard.setConnection(currentConnection);
            syncConnectionView();
            break;
    }
}
// ─── UI updates ───────────────────────────────────────────────────────────
function renderStatusBar() {
    if (currentConnection?.host) {
        const activeJobs = currentJobs.filter(j => j.status === 'running' || j.status === 'pending').length;
        const watchCount = currentWatches.length;
        const summary = currentServices?.summary;
        const bad = (summary?.unhealthy ?? 0) + (summary?.stale ?? 0);
        const degraded = summary?.degraded ?? 0;
        let icon = '$(broadcast)';
        let bg;
        if (summary && summary.total > 0) {
            if (bad > 0) {
                icon = '$(error)';
                bg = new vscode.ThemeColor('statusBarItem.errorBackground');
            }
            else if (degraded > 0) {
                icon = '$(warning)';
                bg = new vscode.ThemeColor('statusBarItem.warningBackground');
            }
            else {
                icon = '$(pass-filled)';
            }
        }
        statusItem.backgroundColor = bg;
        const parts = [];
        if (activeJobs > 0)
            parts.push(`${activeJobs} job${activeJobs === 1 ? '' : 's'}`);
        if (watchCount > 0)
            parts.push(`${watchCount} watch${watchCount === 1 ? '' : 'es'}`);
        if (summary && summary.total > 0)
            parts.push(`${summary.healthy}/${summary.total} services up`);
        const suffix = parts.length ? ` • ${parts.join(' • ')}` : '';
        statusItem.text = `${icon} rumahl Dev: ${currentConnection.hostname ?? currentConnection.host}${suffix}`;
        statusItem.tooltip = `host=${currentConnection.host}\nvariant=${currentConnection.variant}\nbuild=${currentConnection.build}\nactiveJobs=${activeJobs}\nwatchSessions=${watchCount}`;
    }
    else {
        statusItem.backgroundColor = undefined;
        statusItem.text = '$(circle-slash) rumahl Dev: not connected';
        statusItem.tooltip = 'No connected device. Click to connect.';
    }
}
function upsertJob(job) {
    const idx = currentJobs.findIndex(j => j.id === job.id);
    if (idx >= 0)
        currentJobs[idx] = job;
    else
        currentJobs.unshift(job);
    if (currentJobs.length > 100)
        currentJobs.length = 100;
}
function syncConnectionView() {
    connectionProvider.setState(currentConnection, currentJobs, currentWatches);
    renderStatusBar();
}
async function refreshAll() {
    if (!client) {
        try {
            await connectDaemon();
        }
        catch {
            return;
        }
    }
    if (!client)
        return;
    try {
        const [conn, comps, devs, watches, jobs] = await Promise.all([
            client.connection(),
            client.components(),
            client.devices(),
            client.watches(),
            client.jobs(),
        ]);
        currentConnection = conn;
        dashboard.setConnection(conn);
        currentWatches = watches;
        currentJobs = jobs;
        componentsProvider.setItems(comps);
        devicesProvider.setDevices(devs);
        devicesProvider.setActive(conn.host);
        activityProvider.setWatches(watches);
        activityProvider.setJobs(jobs);
        try {
            const services = await client.services();
            currentServices = services;
            servicesProvider.setSnapshot(services);
        }
        catch (e) {
            servicesProvider.setSnapshot(currentServices, `services unavailable: ${e?.message ?? e}`);
        }
        syncConnectionView();
        startServicesPolling();
    }
    catch (e) {
        output.appendLine(`refresh: ${e.message ?? e}`);
    }
}
// ─── Helper: ensure daemon is connected ───────────────────────────────────
async function ensureClient() {
    if (client)
        return client;
    await connectDaemon();
    if (!client)
        throw new api_1.DaemonUnavailable('daemon could not be started');
    return client;
}
// ─── Picker helpers ───────────────────────────────────────────────────────
async function pickComponents(prefilled) {
    const c = await ensureClient();
    const all = await c.components();
    if (prefilled && prefilled.length)
        return prefilled;
    const picked = await vscode.window.showQuickPick(all.map(x => ({ label: x.name, description: x.unit, detail: x.target_path })), { canPickMany: true, title: 'Select component(s)' });
    return picked?.map(p => p.label);
}
async function componentByName(name) {
    const c = await ensureClient();
    const all = await c.components();
    return all.find(component => component.name === name);
}
async function pickServiceFromTree(title) {
    const list = currentServices?.services ?? [];
    if (list.length === 0) {
        vscode.window.showInformationMessage('No services have heartbeated yet.');
        return undefined;
    }
    const pick = await vscode.window.showQuickPick(list.map(s => ({
        label: s.name,
        description: `${s.effective_status}${s.url ? ' • ' + s.url : ''}`,
        detail: s.message ?? '',
        svc: s,
    })), { title });
    return pick?.svc;
}
// ─── COMMANDS ─────────────────────────────────────────────────────────────
// -- Connection --
async function cmdDiscover() {
    const c = await ensureClient();
    const t = vscode.workspace.getConfiguration('oraDev').get('discoverTimeoutSecs') ?? 4;
    const dev = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `rumahl Dev: scanning LAN (${t}s)…` }, () => c.discover(t));
    devicesProvider.setDevices(dev);
    if (dev.length === 0)
        vscode.window.showWarningMessage('No rumahl OS Dev devices found on the LAN.');
    else
        vscode.window.showInformationMessage(`Found ${dev.length} device(s).`);
}
async function cmdConnect(prefilled) {
    const c = await ensureClient();
    // If we have discovered devices (e.g. from a failed auto-connect),
    // offer them as quick-pick options alongside manual entry.
    let discovered = [];
    try {
        const conn = await c.connection();
        discovered = conn.discovered ?? [];
    }
    catch { /* ignore */ }
    let host = prefilled;
    if (discovered.length > 0 && !host) {
        // Let user pick from discovered devices or enter manually
        const items = discovered.map(d => {
            const endpoint = `${d.addrs?.[0] ?? d.host}:${d.port}`;
            const hostname = d.txt?.hostname ?? d.instance;
            const build = d.txt?.build ?? '?';
            return {
                label: `$(device-desktop) ${hostname}`,
                description: endpoint,
                detail: `build: ${build}`,
            };
        });
        items.push({ label: '$(edit) Enter host manually…', description: '', detail: 'Type IP or hostname:port' });
        const pick = await vscode.window.showQuickPick(items, {
            title: 'Connect to rumahl OS Dev device',
            placeHolder: 'Pick a device or enter manually',
            ignoreFocusOut: true,
        });
        if (!pick)
            return;
        if (pick.label.includes('Enter host manually')) {
            host = await vscode.window.showInputBox({
                prompt: 'rumahl OS Dev device host[:port]',
                ignoreFocusOut: true,
                placeHolder: 'e.g. 192.168.1.42:8099',
            });
            if (!host)
                return;
        }
        else {
            host = pick.description;
        }
    }
    else if (!host) {
        host = await vscode.window.showInputBox({
            prompt: 'rumahl OS Dev device host[:port]',
            ignoreFocusOut: true,
            placeHolder: 'e.g. 192.168.1.42:8099',
        });
        if (!host)
            return;
    }
    // Check if we have a saved token we can reuse
    let token = await extensionContext.secrets.get(SECRET_TOKEN_KEY);
    if (!token) {
        token = await vscode.window.showInputBox({
            prompt: 'Dev token (from /etc/ora/dev-token on the device)',
            password: true,
            ignoreFocusOut: true,
            placeHolder: 'eyJ…',
        });
        if (!token)
            return;
    }
    else {
        // Confirm with user that we should use the saved token
        const useSaved = await vscode.window.showQuickPick(['Yes, use saved token', 'No, enter a new token'], { title: `Use saved token for ${host}?` });
        if (!useSaved)
            return;
        if (useSaved === 'No, enter a new token') {
            token = await vscode.window.showInputBox({
                prompt: 'Dev token (from /etc/ora/dev-token on the device)',
                password: true, ignoreFocusOut: true,
            });
            if (!token)
                return;
        }
    }
    try {
        const r = await c.connect(host, token);
        // Persist credentials
        await extensionContext.secrets.store(SECRET_TOKEN_KEY, token);
        await extensionContext.globalState.update(STATE_HOST_KEY, host);
        await extensionContext.globalState.update(STATE_HOSTNAME_KEY, r.hostname ?? null);
        output.appendLine(`connected to ${r.host} (${r.hostname}, build ${r.build})`);
        vscode.window.showInformationMessage(`rumahl Dev: connected to ${r.hostname ?? r.host}.`);
        await refreshAll();
    }
    catch (e) {
        const msg = e?.message ?? String(e);
        if (msg.includes('401') || msg.includes('Unauthorized')) {
            // Token was rejected — clear stored & offer to retry
            await extensionContext.secrets.delete(SECRET_TOKEN_KEY);
            await extensionContext.globalState.update(STATE_HOST_KEY, undefined);
            await extensionContext.globalState.update(STATE_HOSTNAME_KEY, undefined);
            // Show the daemon's detailed error which includes instructions
            const daemonDetail = extractDetail(msg);
            const retry = await vscode.window.showErrorMessage(`rumahl Dev: Invalid dev-token.\n\n${daemonDetail}`, 'Retry with new token', 'Show Output');
            if (retry === 'Show Output') {
                output.show();
                return;
            }
            if (retry) {
                const newToken = await vscode.window.showInputBox({
                    prompt: 'Dev token (from /var/lib/ora/dev-token on the device)',
                    password: true, ignoreFocusOut: true,
                });
                if (newToken) {
                    await extensionContext.secrets.store(SECRET_TOKEN_KEY, newToken);
                    await extensionContext.globalState.update(STATE_HOST_KEY, host);
                    await extensionContext.globalState.update(STATE_HOSTNAME_KEY, null);
                    await c.connect(host, newToken);
                    vscode.window.showInformationMessage(`rumahl Dev: connected.`);
                    await refreshAll();
                }
            }
        }
        else {
            throw e;
        }
    }
}
async function cmdDisconnect() {
    const c = await ensureClient();
    await c.disconnect();
    // Do NOT clear saved credentials — user might just want to reconnect later
    refreshAll();
}
async function cmdForgetCredentials() {
    await extensionContext.secrets.delete(SECRET_TOKEN_KEY);
    await extensionContext.globalState.update(STATE_HOST_KEY, undefined);
    await extensionContext.globalState.update(STATE_HOSTNAME_KEY, undefined);
    vscode.window.showInformationMessage('rumahl Dev: Saved credentials cleared.');
    output.appendLine('saved credentials cleared');
}
async function cmdConnectSaved() {
    const host = extensionContext.globalState.get(STATE_HOST_KEY);
    if (!host) {
        vscode.window.showInformationMessage('No saved device. Use "rumahl Dev: Connect to Device…" first.');
        return;
    }
    await tryAutoConnect(host);
}
// -- Deploy / Watch --
async function cmdDeploy(prefilled) {
    const c = await ensureClient();
    const comps = await pickComponents(prefilled);
    if (!comps || comps.length === 0)
        return;
    const target = vscode.workspace.getConfiguration('oraDev').get('target') ?? 'aarch64-unknown-linux-gnu';
    const buildMode = vscode.workspace.getConfiguration('oraDev').get('buildMode') ?? 'auto';
    const r = await c.deploy({ components: comps, target, build_mode: buildMode });
    vscode.window.showInformationMessage(`rumahl Dev: deploy started (${r.job_id.slice(0, 8)}).`);
}
async function cmdDeployCurrent() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor.');
        return;
    }
    const file = editor.document.uri.fsPath;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
        vscode.window.showWarningMessage('No workspace folder.');
        return;
    }
    const parts = path.relative(root, file).split(/[\\/]/);
    const i = parts.indexOf('backend');
    if (i < 0 || !parts[i + 1]) {
        vscode.window.showWarningMessage('Active file is not inside a deployable rumahl component.');
        return;
    }
    if (parts[i + 1] === 'dev' && parts[i + 2] === 'rumahl-dev-bridge') {
        return cmdDeploy(['rumahl-dev-bridge']);
    }
    return cmdDeploy([parts[i + 1]]);
}
async function cmdWatchStart(prefilled) {
    const c = await ensureClient();
    const automatic = (vscode.workspace.getConfiguration('oraDev').get('automaticMode') ?? false)
        && (!prefilled || prefilled.length === 0);
    const comps = automatic ? [] : await pickComponents(prefilled);
    if (!automatic && (!comps || comps.length === 0))
        return;
    const target = vscode.workspace.getConfiguration('oraDev').get('target') ?? 'aarch64-unknown-linux-gnu';
    const buildMode = vscode.workspace.getConfiguration('oraDev').get('buildMode') ?? 'auto';
    const debounce = vscode.workspace.getConfiguration('oraDev').get('watchDebounceMs') ?? 800;
    const w = await c.startWatch({ components: comps ?? [], target, build_mode: buildMode, automatic, debounce_ms: debounce });
    const label = w.automatic ? 'automatic workspace mode' : w.components.join(', ');
    vscode.window.showInformationMessage(`rumahl Dev: watching ${label}.`);
    refreshAll();
}
async function cmdWatchStop(arg) {
    const c = await ensureClient();
    const list = await c.watches();
    if (list.length === 0) {
        vscode.window.showInformationMessage('No active watch sessions.');
        return;
    }
    let id = typeof arg === 'string' ? arg : arg?.id;
    if (!id) {
        const pick = await vscode.window.showQuickPick(list.map(w => ({ label: w.components.join(', '), description: w.id, detail: w.target, w })), { title: 'Stop which watch session?' });
        id = pick?.w.id;
    }
    if (!id)
        return;
    await c.stopWatch(id);
    refreshAll();
}
// -- Infrastructure commands --
async function cmdRestart() {
    const c = await ensureClient();
    const unit = await vscode.window.showInputBox({ prompt: 'systemd unit (e.g. rumahl-control)', ignoreFocusOut: true });
    if (!unit)
        return;
    const r = await c.restart(unit);
    output.show(true);
    output.appendLine(`--- restart ${unit} ---\n${JSON.stringify(r, null, 2)}`);
}
async function cmdReload() {
    const c = await ensureClient();
    const unit = await vscode.window.showInputBox({ prompt: 'systemd unit (e.g. rumahl-control)', ignoreFocusOut: true });
    if (!unit)
        return;
    const r = await c.serviceReload(unit);
    output.show(true);
    output.appendLine(`--- reload ${unit} ---\n${JSON.stringify(r, null, 2)}`);
}
async function cmdComposeReload() {
    const c = await ensureClient();
    const svc = await vscode.window.showInputBox({ prompt: 'docker-compose service', ignoreFocusOut: true });
    if (!svc)
        return;
    const r = await c.composeReload(svc);
    output.show(true);
    output.appendLine(`--- compose reload ${svc} ---\n${JSON.stringify(r, null, 2)}`);
}
async function cmdLogs() {
    const c = await ensureClient();
    const svc = await vscode.window.showInputBox({ prompt: 'docker-compose service', ignoreFocusOut: true });
    if (!svc)
        return;
    const r = await c.composeLogs(svc, 500);
    output.show(true);
    output.appendLine(`--- compose logs ${svc} (tail=500) ---`);
    output.append(r.stdout);
    if (r.stderr) {
        output.appendLine('---stderr---');
        output.append(r.stderr);
    }
}
// -- Daemon lifecycle --
async function cmdStartDaemon() {
    await manager.start();
    setTimeout(() => connectDaemon().catch(() => { }), 500);
}
async function cmdStopDaemon() {
    try {
        ws?.close();
    }
    catch { /* ignore */ }
    await manager.stop();
    statusItem.text = '$(circle-slash) rumahl Dev: daemon stopped';
}
// -- Service commands --
async function cmdServiceLogsTail(serviceName) {
    const c = await ensureClient();
    let name = serviceName;
    if (!name) {
        const list = currentServices?.services ?? [];
        const pick = list.length
            ? await vscode.window.showQuickPick(list.map(s => ({ label: s.name, description: s.effective_status, detail: s.url })), { title: 'Tail logs of which service?' })
            : undefined;
        name = pick?.label ?? await vscode.window.showInputBox({ prompt: 'systemd unit name (e.g. rumahl-watchdog)', ignoreFocusOut: true });
        if (!name)
            return;
    }
    const r = await c.serviceLogs(name, 300);
    output.show(true);
    output.appendLine(`--- service logs ${name} (tail=300) ---`);
    output.append(r.stdout);
    if (r.stderr) {
        output.appendLine('---stderr---');
        output.append(r.stderr);
    }
}
async function cmdOpenLiveLogs(serviceName) {
    let unit = serviceName;
    if (!unit) {
        const list = currentServices?.services ?? [];
        const pick = list.length
            ? await vscode.window.showQuickPick(list.map(s => ({ label: s.name, description: s.effective_status, detail: s.message ?? s.url })), { title: 'Open live logs for which service?' })
            : undefined;
        unit = pick?.label;
        if (!unit) {
            unit = await vscode.window.showInputBox({ prompt: 'systemd unit name (e.g. rumahl-watchdog)', ignoreFocusOut: true });
        }
        if (!unit)
            return;
    }
    await liveLogs.open(unit);
}
async function cmdStopLiveLogs() {
    const active = liveLogs.activeUnits();
    if (active.length === 0) {
        vscode.window.showInformationMessage('No live-log streams are active.');
        return;
    }
    const pick = await vscode.window.showQuickPick(active.map(u => ({ label: u })), { title: 'Stop which live-log stream?', canPickMany: true });
    if (!pick)
        return;
    for (const p of pick)
        liveLogs.close(p.label);
}
async function cmdOpenServiceUrl(serviceName) {
    const list = currentServices?.services ?? [];
    const svc = list.find(s => s.name === serviceName)
        ?? (await pickServiceFromTree('Open which service URL?'));
    if (!svc)
        return;
    if (!svc.url) {
        vscode.window.showWarningMessage(`${svc.name} has not reported a URL yet.`);
        return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(svc.url));
}
async function cmdSystemInfo() {
    const c = await ensureClient();
    try {
        const info = await c.systemInfo();
        const fmtBytes = (n) => {
            if (n > 1e9)
                return `${(n / 1e9).toFixed(1)} GB`;
            if (n > 1e6)
                return `${(n / 1e6).toFixed(1)} MB`;
            if (n > 1e3)
                return `${(n / 1e3).toFixed(1)} kB`;
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
        for (const l of lines)
            output.appendLine(l);
    }
    catch (e) {
        vscode.window.showErrorMessage(`system info failed: ${e?.message ?? e}`);
    }
}
async function cmdRebootDevice() {
    const yes = await vscode.window.showWarningMessage('Reboot the connected rumahl device? This will interrupt all running services.', { modal: true }, 'Reboot');
    if (yes !== 'Reboot')
        return;
    const c = await ensureClient();
    try {
        const r = await c.systemReboot();
        vscode.window.showInformationMessage(`Reboot scheduled in ${r.scheduled_in_secs}s.`);
    }
    catch (e) {
        vscode.window.showErrorMessage(`reboot failed: ${e?.message ?? e}`);
    }
}
async function cmdComponentLogs(componentName) {
    const c = await ensureClient();
    let targetName = componentName;
    if (!targetName) {
        const selected = await pickComponents();
        if (!selected || selected.length === 0)
            return;
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
    if (r.stderr) {
        output.appendLine('---stderr---');
        output.append(r.stderr);
    }
}
async function cmdComponentActions(componentName) {
    let targetName = componentName;
    if (!targetName) {
        const selected = await pickComponents();
        if (!selected || selected.length === 0)
            return;
        targetName = selected[0];
    }
    const component = await componentByName(targetName);
    if (!component) {
        vscode.window.showWarningMessage(`Unknown component: ${targetName}`);
        return;
    }
    const pick = await vscode.window.showQuickPick([
        { label: '🚀 Deploy', action: 'deploy' },
        { label: '👁 Watch', action: 'watch' },
        { label: '📋 Show Logs', action: 'logs' },
        { label: '🔁 Restart Service', action: 'restart' },
        { label: '🔄 Reload Service', action: 'reload' },
    ], { title: `Actions for ${component.name}` });
    if (!pick)
        return;
    switch (pick.action) {
        case 'deploy': return cmdDeploy([component.name]);
        case 'watch': return cmdWatchStart([component.name]);
        case 'logs': return cmdComponentLogs(component.name);
        case 'restart': {
            const daemon = await ensureClient();
            const r = await daemon.restart(component.unit);
            output.show(true);
            output.appendLine(`--- restart ${component.unit} ---\n${JSON.stringify(r, null, 2)}`);
            return;
        }
        case 'reload': {
            const daemon = await ensureClient();
            const r = await daemon.serviceReload(component.unit);
            output.show(true);
            output.appendLine(`--- reload ${component.unit} ---\n${JSON.stringify(r, null, 2)}`);
            return;
        }
    }
}
async function cmdServicePalette() {
    const svc = await pickServiceFromTree('rumahl Dev — Service Actions');
    if (!svc)
        return;
    const action = await vscode.window.showQuickPick([
        { label: '$(broadcast) Live Logs', action: 'live' },
        { label: '$(output) Tail Logs', action: 'logs' },
        { label: '$(rocket) Deploy', action: 'deploy' },
        { label: '$(eye) Watch', action: 'watch' },
        { label: '$(debug-restart) Restart', action: 'restart' },
        { label: '$(refresh) Reload', action: 'reload' },
        { label: '$(link-external) Open URL', action: 'url' },
    ], { title: `Actions for ${svc.name}` });
    if (!action)
        return;
    switch (action.action) {
        case 'live': return cmdOpenLiveLogs(svc.name);
        case 'logs': return cmdServiceLogsTail(svc.name);
        case 'deploy': return cmdDeploy([svc.name]);
        case 'watch': return cmdWatchStart([svc.name]);
        case 'restart': return cmdServiceRestart(svc.name);
        case 'reload': {
            const c = await ensureClient();
            const r = await c.serviceReload(svc.name);
            output.show(true);
            output.appendLine(`--- reload ${svc.name} ---\n${JSON.stringify(r, null, 2)}`);
            return;
        }
        case 'url': return cmdOpenServiceUrl(svc.name);
    }
}
async function cmdServiceRestart(serviceName) {
    if (!serviceName)
        return;
    const yes = await vscode.window.showWarningMessage(`Restart ${serviceName}?`, { modal: true }, 'Restart');
    if (yes !== 'Restart')
        return;
    const c = await ensureClient();
    const r = await c.restart(serviceName);
    output.show(true);
    output.appendLine(`--- restart ${serviceName} ---\n${JSON.stringify(r, null, 2)}`);
}
//# sourceMappingURL=extension.js.map