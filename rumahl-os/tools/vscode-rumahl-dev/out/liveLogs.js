"use strict";
// Live per-service log streaming using Server-Sent Events.
//
// The bridge exposes `/dev/service/:name/logs/stream` as SSE
// (`Content-Type: text/event-stream`, `journalctl -f` under the hood).
// We don't pull in an `EventSource` polyfill because Node 18+ ships
// streaming `fetch` with `Response.body.getReader()`, which is enough
// for SSE. A lightweight parser splits the stream on `\n\n` events and
// surfaces each `data:` line into a dedicated OutputChannel so devs can
// have one tab open per service.
//
// All sessions live as long as VS Code is running. A close on the wire
// is reconnected with exponential backoff so the panel stays useful
// across daemon restarts and brief network glitches without spamming.
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
exports.LiveLogManager = void 0;
const vscode = __importStar(require("vscode"));
class LiveLogManager {
    clientGetter;
    output;
    sessions = new Map();
    constructor(clientGetter, output) {
        this.clientGetter = clientGetter;
        this.output = output;
    }
    /**
     * Open (or focus) the live-log channel for `unit`. Subsequent calls
     * for the same unit are idempotent and just bring the channel into
     * view — they don't create extra streams.
     */
    async open(unit) {
        const existing = this.sessions.get(unit);
        if (existing) {
            existing.channel.show(true);
            return;
        }
        const channel = vscode.window.createOutputChannel(`rumahl: ${unit}`);
        const session = {
            unit,
            channel,
            abort: new AbortController(),
            backoffMs: 1000,
            closed: false,
        };
        this.sessions.set(unit, session);
        channel.show(true);
        channel.appendLine(`▶ live logs for ${unit} — press Ctrl-Shift-P → "rumahl Dev: Stop Live Logs" to detach`);
        this.streamLoop(session).catch(e => {
            channel.appendLine(`stream loop terminated unexpectedly: ${e?.message ?? e}`);
        });
    }
    /** Close the live-log channel and stop the background fetch. */
    close(unit) {
        const s = this.sessions.get(unit);
        if (!s)
            return;
        s.closed = true;
        try {
            s.abort.abort();
        }
        catch { }
        s.channel.appendLine('▶ live logs detached');
        s.channel.dispose();
        this.sessions.delete(unit);
    }
    /** Names of units that currently have an active live-log session. */
    activeUnits() {
        return Array.from(this.sessions.keys()).sort();
    }
    /** Tear everything down (called from `deactivate`). */
    disposeAll() {
        for (const unit of Array.from(this.sessions.keys())) {
            this.close(unit);
        }
    }
    /**
     * Reconnect every active session. Useful after the daemon restarts
     * because the auth token changed: existing fetch handles will be
     * 401'd and re-authed cleanly here.
     */
    reconnectAll() {
        for (const s of this.sessions.values()) {
            try {
                s.abort.abort();
            }
            catch { }
            s.abort = new AbortController();
            s.backoffMs = 1000;
            this.streamLoop(s).catch(e => {
                s.channel.appendLine(`reconnect failed: ${e?.message ?? e}`);
            });
        }
    }
    async streamLoop(session) {
        // We rebuild the URL on every reconnect because the daemon may
        // have been restarted on a new port or with a new token.
        while (!session.closed) {
            const client = this.clientGetter();
            if (!client) {
                session.channel.appendLine('waiting for daemon connection…');
                await this.delay(2000);
                continue;
            }
            let urlInfo;
            try {
                urlInfo = await client.serviceLogsUrl(session.unit);
            }
            catch (e) {
                session.channel.appendLine(`cannot resolve logs URL: ${e?.message ?? e}`);
                await this.delayWithBackoff(session);
                continue;
            }
            try {
                await this.streamOnce(session, urlInfo.url);
                // Stream ended cleanly (server closed the connection).
                if (!session.closed) {
                    session.channel.appendLine('— stream ended, reconnecting —');
                }
                session.backoffMs = 1000;
            }
            catch (e) {
                if (session.closed)
                    return;
                session.channel.appendLine(`stream error: ${e?.message ?? e}`);
                await this.delayWithBackoff(session);
                continue;
            }
            // Tight reconnect after a clean close.
            await this.delay(500);
        }
    }
    async streamOnce(session, url) {
        // Note: Node 18's global fetch supports AbortSignal and
        // ReadableStream on `body`. We deliberately avoid the
        // `eventsource` npm package because our SSE parsing is trivial
        // and pinning fewer deps means fewer surprises with VS Code's
        // bundled Node version.
        const resp = await fetch(url, {
            method: 'GET',
            signal: session.abort.signal,
            // Standard SSE Accept header — without it some proxies
            // try to chunk the response as plain JSON and break the
            // line-oriented parsing below.
            headers: { 'Accept': 'text/event-stream' },
        });
        if (!resp.ok || !resp.body) {
            throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
        }
        const reader = resp.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        // SSE event = blank-line-separated record. Each record can
        // contain multiple `data:` fields plus optional `event:`,
        // `id:` etc. We only care about `data:` payloads here.
        while (!session.closed) {
            const { value, done } = await reader.read();
            if (done)
                return;
            buffer += decoder.decode(value, { stream: true });
            // Split off complete events. A trailing `\n\n` may not be
            // present yet — keep that fragment in the buffer.
            let sepIdx;
            while ((sepIdx = buffer.indexOf('\n\n')) >= 0 || (sepIdx = buffer.indexOf('\r\n\r\n')) >= 0) {
                const isCRLF = buffer[sepIdx] === '\r';
                const record = buffer.slice(0, sepIdx);
                buffer = buffer.slice(sepIdx + (isCRLF ? 4 : 2));
                this.appendRecord(session, record);
            }
        }
    }
    appendRecord(session, record) {
        let eventName = 'message';
        const dataLines = [];
        for (const line of record.split(/\r?\n/)) {
            if (line.startsWith(':'))
                continue; // SSE comment / keep-alive
            if (line.startsWith('event:')) {
                eventName = line.slice(6).trim();
            }
            else if (line.startsWith('data:')) {
                dataLines.push(line.slice(5).replace(/^ /, ''));
            }
        }
        if (dataLines.length === 0)
            return;
        const data = dataLines.join('\n');
        if (eventName === 'error') {
            session.channel.appendLine(`! ${data}`);
        }
        else if (eventName === 'hello') {
            session.channel.appendLine(`# ${data}`);
        }
        else {
            session.channel.appendLine(data);
        }
    }
    async delayWithBackoff(session) {
        const delay = session.backoffMs;
        session.backoffMs = Math.min(session.backoffMs * 2, 30_000);
        session.channel.appendLine(`reconnecting in ${delay}ms…`);
        await this.delay(delay);
    }
    delay(ms) {
        return new Promise(res => setTimeout(res, ms));
    }
}
exports.LiveLogManager = LiveLogManager;
//# sourceMappingURL=liveLogs.js.map