"use strict";
// HTTP/WebSocket client for the rumahl-dev-deploy daemon.
//
// All commands in this extension go through this client; the extension never
// shells out to the CLI per command. The daemon is auto-spawned on demand
// (see `daemonManager.ts`) and reads its bind address + auth token from
// ~/.config/rumahl-dev-deploy/daemon.json.
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DaemonClient = exports.DaemonUnavailable = void 0;
exports.configDir = configDir;
exports.readDaemonInfo = readDaemonInfo;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const ws_1 = __importDefault(require("ws"));
class DaemonUnavailable extends Error {
    constructor(m) { super(m); this.name = 'DaemonUnavailable'; }
}
exports.DaemonUnavailable = DaemonUnavailable;
function configDir() {
    if (process.platform === 'win32') {
        return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'rumahl-dev-deploy');
    }
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'rumahl-dev-deploy');
    }
    const xdg = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
    return path.join(xdg, 'rumahl-dev-deploy');
}
function readDaemonInfo() {
    const cfg = vscode.workspace.getConfiguration('oraDev');
    const urlOverride = (cfg.get('daemon.url') ?? '').trim();
    const tokenOverride = (cfg.get('daemon.token') ?? '').trim();
    if (urlOverride && tokenOverride) {
        return { url: urlOverride.replace(/\/$/, ''), token: tokenOverride };
    }
    const file = path.join(configDir(), 'daemon.json');
    if (!fs.existsSync(file))
        return null;
    try {
        const j = JSON.parse(fs.readFileSync(file, 'utf8'));
        return {
            url: (urlOverride || j.url).replace(/\/$/, ''),
            token: tokenOverride || j.token,
            pid: j.pid,
        };
    }
    catch {
        return null;
    }
}
class DaemonClient {
    info;
    constructor(info) {
        this.info = info;
    }
    async req(method, path, body) {
        const url = `${this.info.url}${path}`;
        const headers = {
            'Authorization': `Bearer ${this.info.token}`,
            'Accept': 'application/json',
        };
        const init = { method, headers };
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(body);
        }
        let r;
        try {
            r = await fetch(url, init);
        }
        catch (e) {
            throw new DaemonUnavailable(`cannot reach daemon at ${this.info.url}: ${e.message ?? e}`);
        }
        const text = await r.text();
        if (!r.ok) {
            throw new Error(`${method} ${path} → ${r.status}: ${text || r.statusText}`);
        }
        if (!text)
            return undefined;
        try {
            return JSON.parse(text);
        }
        catch {
            return text;
        }
    }
    health() {
        return this.req('GET', '/api/v1/health');
    }
    version() { return this.req('GET', '/api/v1/version'); }
    components() { return this.req('GET', '/api/v1/components'); }
    devices() { return this.req('GET', '/api/v1/devices'); }
    discover(timeout = 4) {
        return this.req('POST', `/api/v1/discover?timeout=${timeout}`);
    }
    connection() { return this.req('GET', '/api/v1/connection'); }
    connect(host, token) { return this.req('POST', '/api/v1/connect', { host, token }); }
    disconnect() { return this.req('POST', '/api/v1/disconnect'); }
    deviceStatus() { return this.req('GET', '/api/v1/status'); }
    deploy(opts) {
        return this.req('POST', '/api/v1/deploy', opts);
    }
    jobs() { return this.req('GET', '/api/v1/jobs'); }
    job(id) { return this.req('GET', `/api/v1/jobs/${id}`); }
    restart(unit) { return this.req('POST', '/api/v1/restart', { unit }); }
    serviceReload(unit) { return this.req('POST', '/api/v1/service/reload', { unit }); }
    composeReload(svc) { return this.req('POST', '/api/v1/compose/reload', { svc }); }
    composeLogs(svc, tail = 200) {
        return this.req('POST', '/api/v1/compose/logs', { svc, tail });
    }
    serviceLogs(unit, tail = 200) {
        return this.req('POST', '/api/v1/service/logs', { unit, tail });
    }
    /// Live service status from the device (aggregated heartbeats).
    /// The daemon proxies `/dev/services` from the bridge, which proxies
    /// `/api/core/services/status` from rumahl-core.
    services() { return this.req('GET', '/api/v1/services'); }
    systemInfo() { return this.req('GET', '/api/v1/system/info'); }
    systemReboot() { return this.req('POST', '/api/v1/system/reboot'); }
    /// Returns a directly-usable Server-Sent-Events URL (token in the query
    /// string) for live `journalctl -f` of a systemd unit on the device.
    serviceLogsUrl(unit) {
        return this.req('GET', `/api/v1/service/${encodeURIComponent(unit)}/logs-url`);
    }
    systemList(path) {
        return this.req('POST', '/api/v1/system/list', { path });
    }
    systemRead(path, max_bytes = 64 * 1024) {
        return this.req('POST', '/api/v1/system/read', { path, max_bytes });
    }
    watches() { return this.req('GET', '/api/v1/watch'); }
    startWatch(opts) {
        return this.req('POST', '/api/v1/watch', opts);
    }
    stopWatch(id) { return this.req('DELETE', `/api/v1/watch/${id}`); }
    openEvents(onEvent, onClose) {
        const wsUrl = this.info.url.replace(/^http/, 'ws')
            + `/api/v1/events?token=${encodeURIComponent(this.info.token)}`;
        const ws = new ws_1.default(wsUrl, { headers: { Authorization: `Bearer ${this.info.token}` } });
        ws.on('message', (data) => {
            try {
                onEvent(JSON.parse(data.toString()));
            }
            catch { }
        });
        ws.on('close', () => onClose?.());
        ws.on('error', () => { });
        return ws;
    }
}
exports.DaemonClient = DaemonClient;
//# sourceMappingURL=api.js.map