/**
 * IORA Bridge Extension v1.0 — pi.dev <-> IORA Assist live bridge & control
 *
 * This is the IORA Assist counterpart to the LocalUp agent extension. It makes
 * pi.dev and IORA Assist work together for interactive sessions (`pi serve`):
 *
 * - Monitoring (extension -> IORA): every 2 seconds a `BridgeState` snapshot is
 *   pushed via `ctx.ui.setStatus("iora_bridge", JSON)`. IORA Assist mirrors the
 *   same state server-side from the headless JSON event stream, so the dashboard
 *   sees identical data in both modes.
 * - Control (IORA -> extension): the `iora_control` tool accepts commands
 *   (ping, pause, resume, set_model, set_thinking, get_state, compact, reset)
 *   so the IORA Assist dashboard can drive a running pi.dev session.
 *
 * The protocol intentionally matches the IORA Assist `BridgeState` Rust struct
 * (see services/iora-assist/src/pi_dev_controller.rs).
 *
 * Install: pi -e iora-bridge.ts   (wired automatically when the container is
 * started with the IORA_PI_EXTENSION_PATH host path set).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as path from "node:path";

// ── Types (mirror of the Rust BridgeState) ──

interface BridgeFileChange {
  path: string;
  action: "created" | "modified" | "deleted";
  timestamp: number;
}

interface BridgeMetrics {
  tool_calls: number;
  files_modified: number;
  turns: number;
  messages: number;
  start_time: number;
  last_activity: number;
}

interface BridgeState {
  type: "iora_bridge";
  session_id: string;
  working_dir: string;
  model: string;
  provider: string;
  status: string;
  agent_running: boolean;
  last_message: string;
  last_changes: BridgeFileChange[];
  metrics: BridgeMetrics;
  extension_version: string;
  ts: number;
}

// ── Constants ──

const EXTENSION_VERSION = "1.0.0";
const BRIDGE_PUSH_INTERVAL_MS = 2000;
const MAX_TRACKED_CHANGES = 500;

const FILE_TOOL_KEYWORDS = ["write", "edit", "create", "replace", "patch", "insert", "delete"];

// ── Global state ──

let sessionId = "";
let workingDir = process.cwd();
let currentModel = "";
let currentProvider = "";
let agentRunning = false;
let status = "idle";
let lastMessage = "";
let trackedChanges: BridgeFileChange[] = [];
const metrics: BridgeMetrics = {
  tool_calls: 0,
  files_modified: 0,
  turns: 0,
  messages: 0,
  start_time: Date.now(),
  last_activity: Date.now(),
};

function buildState(): BridgeState {
  return {
    type: "iora_bridge",
    session_id: sessionId,
    working_dir: workingDir,
    model: currentModel,
    provider: currentProvider,
    status,
    agent_running: agentRunning,
    last_message: lastMessage,
    last_changes: trackedChanges.slice(-50),
    metrics,
    extension_version: EXTENSION_VERSION,
    ts: Date.now(),
  };
}

function fileChangeFromTool(toolName: string, args: any): BridgeFileChange | null {
  const lower = (toolName || "").toLowerCase();
  if (!FILE_TOOL_KEYWORDS.some((kw) => lower.includes(kw))) return null;
  const target =
    args?.path || args?.file_path || args?.filePath || args?.file || "";
  const action: BridgeFileChange["action"] = lower.includes("delete")
    ? "deleted"
    : lower.includes("create")
      ? "created"
      : "modified";
  return {
    path: typeof target === "string" ? target : "",
    action,
    timestamp: Date.now(),
  };
}

function trackFileChange(change: BridgeFileChange) {
  metrics.files_modified += 1;
  trackedChanges.push(change);
  if (trackedChanges.length > MAX_TRACKED_CHANGES) {
    trackedChanges = trackedChanges.slice(trackedChanges.length - MAX_TRACKED_CHANGES);
  }
}

function truncate(value: string, max: number): string {
  if (!value) return "";
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

// ── Extension entry point ──

export default function register(pi: ExtensionAPI): void {
  let activeCtx: ExtensionContext | null = null;
  let bridgeInterval: any = null;

  function pushBridge(ctx?: ExtensionContext) {
    const target = ctx || activeCtx;
    if (!target || !target.hasUI) return;
    try {
      target.ui.setStatus("iora_bridge", JSON.stringify(buildState()));
    } catch (error) {
      console.error("IORA bridge push error:", error);
    }
  }

  function startBridge() {
    if (bridgeInterval) clearInterval(bridgeInterval);
    bridgeInterval = setInterval(() => pushBridge(), BRIDGE_PUSH_INTERVAL_MS);
  }

  function stopBridge() {
    if (bridgeInterval) {
      clearInterval(bridgeInterval);
      bridgeInterval = null;
    }
  }

  // ── Lifecycle ──

  pi.on("session_start", async (event: any, ctx: ExtensionContext) => {
    activeCtx = ctx;
    sessionId = event?.sessionId || event?.session_id || sessionId;
    workingDir = (ctx as any)?.workingDir || process.cwd();
    currentModel = event?.model || currentModel;
    currentProvider = event?.provider || currentProvider;
    metrics.start_time = Date.now();
    metrics.last_activity = Date.now();
    startBridge();
    pushBridge(ctx);
  });

  pi.on("session_shutdown", async () => {
    stopBridge();
  });

  pi.on("agent_start", async (_event: any, ctx: ExtensionContext) => {
    activeCtx = ctx;
    agentRunning = true;
    status = "running";
    metrics.last_activity = Date.now();
    pushBridge(ctx);
  });

  pi.on("agent_end", async (_event: any, ctx: ExtensionContext) => {
    agentRunning = false;
    status = "idle";
    metrics.last_activity = Date.now();
    pushBridge(ctx);
  });

  pi.on("model_select", (event: any) => {
    if (event?.model) currentModel = event.model;
    if (event?.provider) currentProvider = event.provider;
    pushBridge();
  });

  pi.on("tool_execution_start", (event: any) => {
    const toolName = event?.tool || event?.name || "unknown";
    const args = event?.arguments || event?.args || {};
    metrics.tool_calls += 1;
    metrics.last_activity = Date.now();
    status = `tool:${toolName}`;
    const change = fileChangeFromTool(toolName, args);
    if (change) trackFileChange(change);
    pushBridge();
  });

  pi.on("tool_execution_end", () => {
    status = agentRunning ? "running" : "idle";
    metrics.last_activity = Date.now();
    pushBridge();
  });

  pi.on("message_end", (event: any) => {
    const content =
      event?.message?.content ?? event?.content ?? "";
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((c: any) => c?.text || "").join("")
          : "";
    if (text.trim()) {
      metrics.messages += 1;
      metrics.turns += 1;
      lastMessage = truncate(text.trim(), 500);
      metrics.last_activity = Date.now();
      pushBridge();
    }
  });

  // ── Tools ──

  pi.registerTool({
    name: "iora_bridge_status",
    label: "IORA Bridge Status",
    description:
      "Get the full IORA bridge state: working dir, model, file changes, and session metrics.",
    parameters: { type: "object", properties: {} },
    async execute() {
      return {
        content: [{ type: "text", text: JSON.stringify(buildState(), null, 2) }],
        details: buildState(),
      };
    },
  });

  pi.registerTool({
    name: "iora_control",
    label: "IORA Remote Control",
    description:
      "Receive control commands from IORA Assist to drive this pi.dev session (pause, resume, set model, set thinking, compact, reset).",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          enum: ["ping", "pause", "resume", "set_model", "set_thinking", "get_state", "compact", "reset"],
          description: "Command to execute",
        },
        model: { type: "string", description: "Model ID for set_model" },
        thinking: {
          type: "string",
          enum: ["off", "minimal", "low", "medium", "high"],
          description: "Thinking level for set_thinking",
        },
      },
      required: ["command"],
    },
    async execute(_id: string, params: any, _onUpdate: any, ctx: any) {
      const cmd = params?.command;
      try {
        switch (cmd) {
          case "ping":
            return {
              content: [{ type: "text", text: "pong — IORA bridge active" }],
              details: { sessionId, version: EXTENSION_VERSION, status },
            };
          case "pause":
            agentRunning = false;
            status = "paused";
            pushBridge();
            return {
              content: [{ type: "text", text: "Agent paused (finishes current turn)" }],
              details: { agentRunning },
            };
          case "resume":
            agentRunning = true;
            status = "running";
            pushBridge();
            return {
              content: [{ type: "text", text: "Agent resumed" }],
              details: { agentRunning },
            };
          case "set_model":
            if (params?.model && ctx?.setModel) {
              await ctx.setModel(params.model);
              currentModel = params.model;
              pushBridge();
              return {
                content: [{ type: "text", text: `Model set to ${params.model}` }],
                details: { model: currentModel },
              };
            }
            return {
              content: [{ type: "text", text: "Model change not supported in this context" }],
              details: { error: "setModel not available" },
            };
          case "set_thinking":
            if (params?.thinking && ctx?.setThinkingLevel) {
              await ctx.setThinkingLevel(params.thinking);
              return {
                content: [{ type: "text", text: `Thinking level set to ${params.thinking}` }],
                details: { thinking: params.thinking },
              };
            }
            return {
              content: [{ type: "text", text: "Thinking level change not supported" }],
              details: { error: "setThinkingLevel not available" },
            };
          case "get_state":
            return {
              content: [{ type: "text", text: "Current bridge state retrieved" }],
              details: buildState(),
            };
          case "compact":
            if (ctx?.compact) {
              await ctx.compact();
              return {
                content: [{ type: "text", text: "Context compaction triggered" }],
                details: { success: true },
              };
            }
            return {
              content: [{ type: "text", text: "Compaction not available" }],
              details: { error: "compact not available" },
            };
          case "reset":
            trackedChanges = [];
            lastMessage = "";
            metrics.tool_calls = 0;
            metrics.files_modified = 0;
            metrics.turns = 0;
            metrics.messages = 0;
            metrics.start_time = Date.now();
            metrics.last_activity = Date.now();
            pushBridge();
            return {
              content: [{ type: "text", text: "IORA bridge state reset" }],
              details: { success: true },
            };
          default:
            return {
              content: [{ type: "text", text: `Unknown command: ${cmd}` }],
              details: { error: "unknown_command" },
            };
        }
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Control error: ${e?.message || e}` }],
          details: { error: e?.message || String(e) },
        };
      }
    },
  });

  // ── Slash commands ──

  pi.registerCommand("iora-health", {
    description: "Show IORA bridge health and session metrics",
    async run(_args: string, ctx: ExtensionContext) {
      const state = buildState();
      const lines = [
        `IORA bridge v${EXTENSION_VERSION}`,
        `Session: ${state.session_id || "(none)"}`,
        `Working dir: ${path.basename(state.working_dir || "")}`,
        `Status: ${state.status} (agent ${state.agent_running ? "running" : "idle"})`,
        `Tool calls: ${state.metrics.tool_calls} | Files modified: ${state.metrics.files_modified} | Turns: ${state.metrics.turns}`,
      ];
      if (ctx.hasUI) ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("iora-help", {
    description: "List IORA bridge tools and commands",
    async run(_args: string, ctx: ExtensionContext) {
      const help = [
        "IORA Bridge commands:",
        "  /iora-health  — show bridge health & metrics",
        "  /iora-help    — this help",
        "Tools:",
        "  iora_bridge_status — full bridge state",
        "  iora_control       — ping/pause/resume/set_model/set_thinking/get_state/compact/reset",
      ].join("\n");
      if (ctx.hasUI) ctx.ui.notify(help, "info");
    },
  });
}
