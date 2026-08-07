#!/usr/bin/env node
// ╔═══════════════════════════════════════════════════════════════════╗
// ║  IORA Dev Runner — Interactive development service manager       ║
// ║  Works on Windows & Linux · No dependencies · Node.js ≥ 18      ║
// ║  Auto-discovers services from filesystem                         ║
// ╚═══════════════════════════════════════════════════════════════════╝
//
// Usage:
//   node dev/iora-dev.mjs              — interactive mode
//   node dev/iora-dev.mjs start all    — start everything
//   node dev/iora-dev.mjs start home   — start single service
//   node dev/iora-dev.mjs --watch      — enable hot-reload on start
//
// Interactive navigation:
//   ↑/↓/Mouse  Navigate service list
//   Space/Click Toggle selected service (start/stop)
//   Enter       Show service info (live)
//   →           Start selected    ←  Stop selected
//   a           Start all         s  Stop all
//   r           Restart selected  R  Restart all
//   w           Toggle hot-reload
//   l           Show logs for selected service
//   f           Open Explorer in service directory
//   t           Open terminal in service directory
//   B           Build all backend   q  Quit

import { spawn, execFileSync, execSync } from "node:child_process";
import { watch, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { platform } from "node:os";
import { Socket } from "node:net";
import { pathToFileURL } from "node:url";

// ── Constants ───────────────────────────────────────────────────────

const IS_WIN = platform() === "win32";
export const ROOT = resolve(import.meta.dirname, "../..");
export const BACKEND = join(ROOT, "iora-os", "backend");
const FRONTEND = join(ROOT, "frontend");
const LOG_DIR = join(import.meta.dirname, ".logs");
const COMPOSE_FILE = join(ROOT, "deploy", "docker-compose.yml");
const DEV_LOCAL_STATE = join(ROOT, "iora-os", ".cache", "runtime-state.json");
const DEV_ADMIN_USER = process.env.IORA_BOOTSTRAP_ADMIN_USER || "admin";
const DEV_ADMIN_PASSWORD = process.env.IORA_BOOTSTRAP_ADMIN_PASSWORD || "iora-dev-admin";
const DEV_OS_USER = process.env.IORA_DEV_OS_USER || process.env.USER || "iora";
const DEV_OS_PASSWORD = process.env.IORA_DEV_OS_PASSWORD || "iora-dev-os";

const SERVICE_PORTS = {
  "iora-home": 3001, "iora-core": 8090, "iora-control": 8091,
  "iora-assist": 8092, "iora-secrets": 8093, "iora-watchdog": 8094,
  "iora-security": 8095, "iora-gateway": 8096, "iora-supervisor": 8097,
  "iora-appstore": 8098, "iora-intelligence": 8099, "iora-files": 8100,
  "iora-api": 8101, "iora-connector": 8102, "iora-network-monitor": 8103,
  "iora-domain-validator": 8104, "iora-resource-manager": 8105,
  "iora-updater": 8106, "iora-backup": 8107, "iora-nginx": 8108,
};

if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

// ── ANSI Helpers ────────────────────────────────────────────────────

const ESC = "\x1b";
const CSI = `${ESC}[`;
const A = {
  reset: `${CSI}0m`,   bold: `${CSI}1m`,    dim: `${CSI}2m`,     italic: `${CSI}3m`,
  inverse: `${CSI}7m`,
  red: `${CSI}31m`,     green: `${CSI}32m`,   yellow: `${CSI}33m`,  blue: `${CSI}34m`,
  magenta: `${CSI}35m`, cyan: `${CSI}36m`,    white: `${CSI}37m`,   gray: `${CSI}90m`,
  bgRed: `${CSI}41m`,   bgGreen: `${CSI}42m`, bgYellow: `${CSI}43m`,bgBlue: `${CSI}44m`,
  bgCyan: `${CSI}46m`,
};

function clear()      { write(`${CSI}2J${CSI}H`); }
function hideCursor() { write(`${CSI}?25l`); }
function showCursor() { write(`${CSI}?25h`); }
function moveTo(r, c) { write(`${CSI}${r};${c}H`); }
function enableMouse() { write(`${CSI}?1000h${CSI}?1006h`); }   // X10 + SGR
function disableMouse(){ write(`${CSI}?1000l${CSI}?1006l`); }
function enableAltScreen()  { write(`${CSI}?1049h`); }
function disableAltScreen() { write(`${CSI}?1049l`); }
function write(s) { process.stdout.write(s); }

// ── Terminal geometry helpers ───────────────────────────────────────

function termCols() { return process.stdout.columns || 80; }
function termRows() { return process.stdout.rows || 24; }

/** Visible (printable) length of a string with ANSI codes */
function vlen(s) { return s.replace(/\x1b\[[0-9;]*m/g, "").length; }

/** Pad/truncate string to exactly `w` visible chars */
function fit(s, w) {
  if (w <= 0) return "";
  const v = vlen(s);
  if (v === w) return s;
  if (v < w) return s + " ".repeat(w - v);
  // truncate — walk chars, track visible count
  let out = "", vis = 0, inEsc = false;
  for (const ch of s) {
    if (ch === "\x1b") { inEsc = true; out += ch; continue; }
    if (inEsc) { out += ch; if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z")) inEsc = false; continue; }
    if (vis >= w - 1) { out += "…"; break; }
    out += ch; vis++;
  }
  return out + A.reset;
}

/** Draw a horizontal line */
function hline(w, ch = "─") { return w > 0 ? ch.repeat(w) : ""; }

// ── Auto-Discovery ──────────────────────────────────────────────────

export function discoverServices(root = ROOT, backend = BACKEND) {
  const services = [];

  // 1. Frontend (Vite)
  const frontendDir = join(root, "frontend");
  if (existsSync(join(frontendDir, "package.json"))) {
    try {
      const pkg = JSON.parse(readFileSync(join(frontendDir, "package.json"), "utf8"));
      if (pkg.scripts?.dev) {
        services.push({
          id: "frontend",
          name: "Frontend (Vite)",
          port: extractPortFromScript(pkg.scripts.dev) || 5173,
          cwd: frontendDir,
          cmd: IS_WIN ? "npm.cmd" : "npm",
          args: ["run", "dev", "--", "--host"],
          group: "frontend",
          type: "node",
          srcDir: join(frontendDir, "src"),
          autostart: true,
        });
      }
    } catch {}
  }

  // 2. Desktop frontend (Tauri v2)
  const desktopPkg = join(root, "desktop", "package.json");
  if (existsSync(desktopPkg)) {
    try {
      const pkg = JSON.parse(readFileSync(desktopPkg, "utf8"));
      const hasTauri = existsSync(join(root, "desktop", "src-tauri", "tauri.conf.json"));
      if (hasTauri && (pkg.scripts?.tauri || pkg.devDependencies?.["@tauri-apps/cli"])) {
        services.push({
          id: "desktop",
          name: "Desktop (Tauri v2)",
          port: extractPortFromScript(pkg.scripts?.dev) || 1420,
          cwd: join(root, "desktop"),
          cmd: IS_WIN ? "npx.cmd" : "npx",
          args: ["tauri", "dev"],
          group: "frontend",
          type: "tauri",
          srcDir: join(root, "desktop", "src"),
          autostart: false,
        });
      } else if (pkg.scripts?.dev) {
        services.push({
          id: "desktop",
          name: "Desktop (Vite)",
          port: extractPortFromScript(pkg.scripts.dev) || 1420,
          cwd: join(root, "desktop"),
          cmd: IS_WIN ? "npx.cmd" : "npx",
          args: ["vite", "--port", "1420", "--host"],
          group: "frontend",
          type: "node",
          autostart: false,
        });
      }
    } catch {}
  }

  // 3. IORA OS development VM (PowerShell dev-local.ps1). It is explicit-only
  // because it starts QEMU and may download/create the VM image on first use.
  if (existsSync(join(root, "iora-os", "dev-local.ps1"))) {
    services.push({
      id: "iora-dev-vm",
      name: "IORA Dev VM",
      port: 2222,
      cwd: join(root, "iora-os"),
      cmd: IS_WIN ? "powershell.exe" : "pwsh",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "iora-os", "dev-local.ps1"), "-NoWatch"],
      reinstallArgs: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "iora-os", "dev-local.ps1"), "-Rebuild", "-NoWatch"],
      group: "core",
      type: "dev-vm",
      srcDir: join(root, "iora-os"),
      autostart: false,
    });
  }

  // 4. Long-running Rust crates are grouped below services/, apps/system/, and dev/.
  const crateRoots = [join(backend, "services"), join(backend, "apps", "system"), join(backend, "dev")];
  for (const crateRoot of crateRoots) {
    if (!existsSync(crateRoot)) continue;
    const entries = readdirSync(crateRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const crateDir = join(crateRoot, entry.name);
      const cargoPath = join(crateDir, "Cargo.toml");
      const mainPath = join(crateDir, "src", "main.rs");
      if (!existsSync(cargoPath)) continue;
      if (!existsSync(mainPath)) continue;

      try {
        const cargo = readFileSync(cargoPath, "utf8");
        const nameMatch = cargo.match(/^name\s*=\s*"([^"]+)"/m);
        const descMatch = cargo.match(/^description\s*=\s*"([^"]+)"/m);
        const pkgName = nameMatch ? nameMatch[1] : entry.name;

        const mainSrc = readFileSync(mainPath, "utf8");
        const port = SERVICE_PORTS[pkgName] || detectPort(mainSrc, pkgName);

        if (port === 0 && !mainSrc.includes("listener") && !mainSrc.includes("axum::serve") && !mainSrc.includes("bind")) continue;

        const desc = descMatch ? descMatch[1] : "";
        const group = categorize(pkgName, desc);

        services.push({
          id: pkgName,
          name: formatCrateName(pkgName),
          port,
          cwd: backend,
          cmd: "cargo",
          args: ["run", "-p", pkgName],
          group,
          type: "rust",
          srcDir: join(crateDir, "src"),
          manifestPath: cargoPath,
          autostart: crateRoot === join(backend, "services") && pkgName !== "iora-nginx",
        });
      } catch {}
    }
  }

  const groupOrder = { frontend: 0, core: 1, extra: 2 };
  services.sort((a, b) => {
    const ga = groupOrder[a.group] ?? 9;
    const gb = groupOrder[b.group] ?? 9;
    if (ga !== gb) return ga - gb;
    return a.id.localeCompare(b.id);
  });

  return services;
}

function detectPort(mainSrc, pkgName) {
  const lines = mainSrc.split("\n");
  for (const line of lines) {
    const socketAddr = line.match(/SocketAddr::from\(\(\[[\d,\s]+\],\s*(\d{4,5})\)\)/);
    if (socketAddr) return parseInt(socketAddr[1]);
  }
  for (const line of lines) {
    if (!line.toLowerCase().includes("port")) continue;
    const envPort = line.match(/unwrap_or_else\(\|_\|\s*"(\d{4,5})"\.to_string/);
    if (envPort) return parseInt(envPort[1]);
  }
  for (let i = 0; i < lines.length; i++) {
    if (!/\bport\b/i.test(lines[i])) continue;
    const block = lines.slice(i, i + 6).join(" ");
    const unwrap = block.match(/\.unwrap_or\((\d{4,5})\)/);
    if (unwrap) {
      const val = parseInt(unwrap[1]);
      if (val >= 1024 && val <= 65535 && val !== 1883) return val;
    }
  }
  return 0;
}

function extractPortFromScript(script) {
  if (!script) return null;
  const m = script.match(/--port\s+(\d+)/);
  return m ? parseInt(m[1]) : null;
}

function formatCrateName(name) {
  return name.replace(/^iora-/, "IORA ").replace(/\b\w/g, c => c.toUpperCase());
}

function categorize(name, desc) {
  const core = ["iora-home", "iora-core", "iora-gateway", "iora-security", "iora-secrets", "iora-control"];
  if (core.includes(name)) return "core";
  return "extra";
}

// ── Service Discovery ───────────────────────────────────────────────

const SERVICES = discoverServices();

function readDevVmState() {
  try {
    if (!existsSync(DEV_LOCAL_STATE)) return null;
    return JSON.parse(readFileSync(DEV_LOCAL_STATE, "utf8"));
  } catch {
    return null;
  }
}

function summarizeDevVmState() {
  const vm = readDevVmState();
  if (!vm) return "VM state: not initialized";
  const parts = [
    `VM ${vm.lifecycle || "unknown"}`,
    `sync ${vm.syncStatus || "unknown"}`,
    `watcher ${vm.watcherStatus || "unknown"}`,
  ];
  if (vm.lastReadyAt) parts.push(`ready ${vm.lastReadyAt}`);
  if (vm.lastSyncAt) parts.push(`last sync ${vm.lastSyncAt}`);
  if (vm.lastError) parts.push(`error ${vm.lastError}`);
  return parts.join("  |  ");
}

// ── State ───────────────────────────────────────────────────────────

/** @type {Map<string, {proc:any, status:string, pid:number|null, logs:string[], startTime:number|null, restartCount:number}>} */
const state = new Map();
let cursor = 0;
let hotReload = false;
let watchers = [];
let shuttingDown = false;
let cliMode = false;

// View stack: "main" | "logs" | "info"
let viewMode = "main";
let viewServiceId = null;     // for logs/info view
let logScrollOffset = 0;      // 0 = bottom (live)

// Scroll state for main view (when terminal is short)
let mainScrollOffset = 0;

for (const svc of SERVICES) {
  state.set(svc.id, {
    proc: null,
    status: "stopped",
    pid: null,
    logs: [],
    startTime: null,
    restartCount: 0,
    expectedStop: false,
    healthTimer: null,
  });
}

// ── Process Management ──────────────────────────────────────────────

export function databaseUrlFor(serviceId, env = process.env) {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const specificKey = `${serviceId.toUpperCase().replaceAll("-", "_")}_DB_URL`;
  if (env[specificKey]) return env[specificKey];
  const dedicatedDatabases = {
    "iora-core": "iora_core", "iora-security": "iora_security",
    "iora-secrets": "iora_secrets", "iora-appstore": "iora_appstore",
  };
  const database = dedicatedDatabases[serviceId] || "iora_home";
  const user = env.POSTGRES_USER || "iora";
  const password = env.POSTGRES_PASSWORD || "changeme";
  const port = env.POSTGRES_PORT || "5432";
  return `postgres://${user}:${password}@127.0.0.1:${port}/${database}`;
}

function serviceEnv(svc) {
  const env = { ...process.env, FORCE_COLOR: "1", RUST_LOG: process.env.RUST_LOG || "info" };
  if (svc.type !== "rust") {
    env.VITE_IORA_BACKEND_URL ||= `http://localhost:${process.env.BACKEND_PORT || SERVICE_PORTS["iora-home"]}`;
    return env;
  }
  env.DATABASE_URL = databaseUrlFor(svc.id, env);
  if (svc.port) env.PORT ||= String(svc.port);
  env.POSTGRES_ADMIN_URL ||= databaseUrlFor("postgres", { ...env, DATABASE_URL: "" }).replace(/\/iora_postgres$/, "/postgres");
  env.IORA_FRONTEND_DEV_URL ||= `http://localhost:${process.env.VITE_PORT || 5173}`;
  env.IORA_DEV_MODE ||= "true";
  env.IORA_BOOTSTRAP_ADMIN_USER ||= DEV_ADMIN_USER;
  env.IORA_BOOTSTRAP_ADMIN_PASSWORD ||= DEV_ADMIN_PASSWORD;
  env.IORA_BOOTSTRAP_ADMIN_DISPLAY_NAME ||= "IORA Dev Admin";
  env.IORA_DEV_OS_USER ||= DEV_OS_USER;
  env.IORA_DEV_OS_PASSWORD ||= DEV_OS_PASSWORD;
  return env;
}

function probePort(port, timeoutMs = 500) {
  if (!port) return Promise.resolve(false);
  return new Promise((resolveProbe) => {
    const socket = new Socket();
    const finish = (result) => { socket.destroy(); resolveProbe(result); };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, "127.0.0.1");
  });
}

async function ensureDevDependencies() {
  const postgresPort = Number(process.env.POSTGRES_PORT || 5432);
  if (await probePort(postgresPort, 700)) return true;
  if (!existsSync(COMPOSE_FILE)) return false;
  try {
    console.log(`${A.yellow}PostgreSQL is not reachable; starting the existing development container...${A.reset}`);
    execFileSync("docker", ["compose", "-f", COMPOSE_FILE, "up", "-d", "postgres"], { cwd: ROOT, stdio: "inherit" });
    for (let attempt = 0; attempt < 30; attempt++) {
      if (await probePort(postgresPort, 700)) return true;
      await delay(1000);
    }
  } catch (error) {
    console.error(`${A.red}Could not start PostgreSQL:${A.reset} ${error.message}`);
    console.error(`${A.yellow}Start PostgreSQL manually or set DATABASE_URL before starting database-backed services.${A.reset}`);
  }
  return false;
}

function monitorServiceHealth(svc, st) {
  if (st.healthTimer) clearInterval(st.healthTimer);
  if (!svc.port) return;
  let failedChecks = 0;
  st.healthTimer = setInterval(async () => {
    if (!st.proc || shuttingDown) return;
    const healthy = await probePort(svc.port);
    if (healthy) {
      failedChecks = 0;
      if (st.status === "starting" || st.status === "unhealthy") st.status = "running";
    } else if (st.status === "running" && ++failedChecks >= 3) {
      st.status = "unhealthy";
      st.logs.push(`${ts()} [health] Port ${svc.port} stopped responding`);
    }
    draw();
  }, 2000);
}

function startService(id) {
  const svc = SERVICES.find(s => s.id === id);
  const st = state.get(id);
  if (!svc || !st) return;
  if (st.proc) return;

  st.status = "starting";
  st.logs = [];
  st.startTime = Date.now();
  st.expectedStop = false;

  let proc;
  try {
    proc = spawn(svc.cmd, svc.args, {
      cwd: svc.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: serviceEnv(svc),
      shell: IS_WIN,
      detached: !IS_WIN,
      windowsHide: true,
    });
  } catch (err) {
    st.status = "error";
    st.logs.push(`${ts()} ERROR spawn: ${err.message}`);
    draw();
    return;
  }

  st.proc = proc;
  st.pid = proc.pid;
  monitorServiceHealth(svc, st);

  const appendLog = (data) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      if (line.trim() === "") continue;
      st.logs.push(`${ts()} ${line}`);
      if (cliMode) console.log(`${A.dim}${ts()}${A.reset} ${A.cyan}[${svc.id}]${A.reset} ${line}`);
      if (st.logs.length > 500) st.logs.shift();
    }
    const text = data.toString().toLowerCase();
    if (text.includes("listening") || text.includes("started") || text.includes("ready") || text.includes("local:") || text.includes("running on") || text.includes("app running")) {
      if (st.status === "starting") {
        st.status = "running";
      }
    }
    draw();
  };

  proc.stdout?.on("data", appendLog);
  proc.stderr?.on("data", appendLog);

  proc.on("error", (err) => {
    st.status = "error";
    st.logs.push(`${ts()} ERROR: ${err.message}`);
    st.proc = null;
    st.pid = null;
    if (!shuttingDown) draw();
  });

  proc.on("exit", (code, signal) => {
    if (st.healthTimer) clearInterval(st.healthTimer);
    st.healthTimer = null;
    if (st.expectedStop || code === 0 || code === null) {
      st.status = "stopped";
    } else {
      const recentLogs = st.logs.slice(-20).join("\n").toLowerCase();
      const hasError = /\b(error|panic|fatal|failed|exception|cannot|thread .+ panicked)\b/.test(recentLogs);
      st.status = hasError ? "error" : "stopped";
    }
    st.logs.push(`${ts()} Exited (code=${code}, signal=${signal})`);
    st.proc = null;
    st.pid = null;
    if (!shuttingDown) draw();
  });

  draw();
}

function stopService(id) {
  const st = state.get(id);
  if (!st || !st.proc) return;

  const proc = st.proc;
  st.expectedStop = true;
  st.status = "stopped";
  st.proc = null;
  const pid = st.pid;
  st.pid = null;

  try {
    if (IS_WIN && pid) {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, shell: false });
    } else {
      if (pid) process.kill(-pid, "SIGTERM");
      else proc.kill("SIGTERM");
    }
  } catch {}

  if (!shuttingDown) draw();
}

async function restartService(id) {
  const st = state.get(id);
  const svc = SERVICES.find(s => s.id === id);
  if (st) st.restartCount++;
  stopService(id);
  await delay(1500);
  if (svc?.type === "dev-vm" && Array.isArray(svc.reinstallArgs)) {
    const originalArgs = svc.args;
    svc.args = svc.reinstallArgs;
    startService(id);
    svc.args = originalArgs;
  } else {
    startService(id);
  }
}

async function startAll() {
  const dependenciesReady = await ensureDevDependencies();
  let i = 0;
  for (const svc of SERVICES.filter(service => service.autostart !== false)) {
    const st = state.get(svc.id);
    if (svc.type === "rust" && !dependenciesReady) {
      st.status = "error";
      st.logs.push(`${ts()} [dependency] PostgreSQL is unavailable; service was not started`);
      if (cliMode) console.error(`${A.yellow}[${svc.id}] skipped: PostgreSQL is unavailable${A.reset}`);
      continue;
    }
    if (!st.proc) {
      setTimeout(() => startService(svc.id), i * 500);
      i++;
    }
  }
}

function stopAll() {
  for (const svc of SERVICES) stopService(svc.id);
}

async function restartAll() {
  stopAll();
  await delay(2000);
  await startAll();
}

// ── Hot Reload ──────────────────────────────────────────────────────

function enableHotReload() {
  if (hotReload) return;
  hotReload = true;

  for (const svc of SERVICES) {
    const srcDir = svc.srcDir || (svc.type === "node" ? join(svc.cwd, "src") : null);
    if (!srcDir || !existsSync(srcDir)) continue;

    // Vite already owns frontend HMR. A second watcher only creates duplicate work.
    if ((svc.type === "node" || svc.type === "tauri") && svc.group === "frontend") {
      const st = state.get(svc.id);
      if (st) st.logs.push(`${ts()} [hot-reload] Vite HMR active`);
      continue;
    }

    const extensions = svc.type === "rust" ? [".rs", ".toml"] : [".ts", ".tsx", ".css", ".json"];
    let debounce = null;
    const watchedPaths = new Set([srcDir, dirname(svc.manifestPath || srcDir)]);
    const directories = [];
    for (const watchedPath of watchedPaths) {
      if (!existsSync(watchedPath)) continue;
      const pending = [watchedPath];
      while (pending.length) {
        const directory = pending.pop();
        directories.push(directory);
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          if (entry.isDirectory() && !["target", "node_modules", ".git"].includes(entry.name)) pending.push(join(directory, entry.name));
        }
      }
    }

    for (const directory of new Set(directories)) try {
      const watcher = watch(directory, (_ev, filename) => {
        if (!filename || !extensions.some(ext => filename.endsWith(ext))) return;

        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => {
          const st = state.get(svc.id);
          if (st?.proc) {
            st.logs.push(`${ts()} [hot-reload] ${join(directory, filename)} changed — rebuilding`);
            void restartService(svc.id);
          }
        }, 650);
      });
      watchers.push(watcher);
    } catch {}
  }
  draw();
}

function disableHotReload() {
  if (!hotReload) return;
  hotReload = false;
  for (const w of watchers) { try { w.close(); } catch {} }
  watchers = [];
  draw();
}

// ── Open directory helpers ──────────────────────────────────────────

/** Open Explorer/Finder/file manager in the service's source directory */
function openExplorer(serviceId) {
  const svc = SERVICES.find(s => s.id === serviceId);
  const st = state.get(serviceId);
  if (!svc) return;
  const dir = svc.srcDir || svc.cwd;
  if (!existsSync(dir)) { st?.logs.push(`${ts()} [dev-runner] Cannot open missing path: ${dir}`); draw(); return; }
  const commands = IS_WIN
    ? [["explorer.exe", [dir], false], ["cmd.exe", ["/c", "start", "", dir], false]]
    : platform() === "darwin"
      ? [["open", [dir], false]]
      : [["xdg-open", [dir], false], ["gio", ["open", dir], false]];
  for (const [cmd, args, shell] of commands) {
    try {
      const p = spawn(cmd, args, { stdio: "ignore", detached: true, shell, windowsHide: true });
      p.on("error", err => st?.logs.push(`${ts()} [dev-runner] ${cmd} failed: ${err.message}`));
      p.unref();
      st?.logs.push(`${ts()} [dev-runner] Opened ${dir}`);
      draw();
      return;
    } catch (err) { st?.logs.push(`${ts()} [dev-runner] ${cmd} failed: ${err.message}`); }
  }
  draw();
}

/** Open a new terminal window in the service's working directory */
function openTerminal(serviceId) {
  const svc = SERVICES.find(s => s.id === serviceId);
  const st = state.get(serviceId);
  if (!svc) return;
  const dir = svc.srcDir || svc.cwd;
  if (!existsSync(dir)) { st?.logs.push(`${ts()} [dev-runner] Cannot open terminal for missing path: ${dir}`); draw(); return; }
  try {
    if (IS_WIN) {
      // Try Windows Terminal first, fall back to cmd
      const p = spawn("wt", ["-d", dir], { stdio: "ignore", detached: true, shell: true, windowsHide: false });
      p.unref();
    } else if (platform() === "darwin") {
      const p = spawn("open", ["-a", "Terminal", dir], { stdio: "ignore", detached: true });
      p.unref();
    } else {
      // Linux — try common terminals
      for (const term of ["gnome-terminal", "konsole", "xfce4-terminal", "xterm"]) {
        try {
          const p = spawn(term, ["--working-directory=" + dir], { stdio: "ignore", detached: true });
          p.unref();
          break;
        } catch { continue; }
      }
    }
  } catch {}
}

// ── Log Helpers ─────────────────────────────────────────────────────

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function colorizeLog(line) {
  const raw = stripAnsi(line);
  const lower = raw.toLowerCase();

  const tsMatch = raw.match(/^(\d{1,2}:\d{2}:\d{2})\s/);
  const tsPrefix = tsMatch ? `${A.dim}${tsMatch[1]}${A.reset} ` : "";
  const rest = tsMatch ? raw.slice(tsMatch[0].length) : raw;

  if (/\b(error|err!|panic|fatal|failed|exception|cannot|thread .+ panicked)\b/i.test(lower)) {
    return `${tsPrefix}${A.red}${rest}${A.reset}`;
  }
  if (/\b(warn|warning|deprecated)\b/i.test(lower)) {
    return `${tsPrefix}${A.yellow}${rest}${A.reset}`;
  }
  if (/\b(listening|ready|started|running|compiled|success|connected|healthy)\b/i.test(lower)) {
    return `${tsPrefix}${A.green}${rest}${A.reset}`;
  }
  if (/\b(debug|trace)\b/i.test(lower)) {
    return `${tsPrefix}${A.dim}${rest}${A.reset}`;
  }
  if (/\b(info)\b/i.test(lower)) {
    return `${tsPrefix}${rest.replace(/\bINFO\b/i, `${A.cyan}INFO${A.reset}`)}`;
  }
  if (lower.includes("exited")) {
    const hasErr = /code=[^0n]/.test(lower);
    return `${tsPrefix}${hasErr ? A.red : A.dim}${rest}${A.reset}`;
  }
  if (lower.includes("[hot-reload]")) {
    return `${tsPrefix}${A.magenta}${rest}${A.reset}`;
  }
  return `${tsPrefix}${rest}`;
}

function openLogsInEditor(serviceId) {
  const st = state.get(serviceId);
  const svc = SERVICES.find(s => s.id === serviceId);
  if (!st || !svc) return;

  const filename = `${svc.id}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.log`;
  const filePath = join(LOG_DIR, filename);

  const plainLogs = st.logs.map(l => stripAnsi(l)).join("\n");
  const header = [
    `=== IORA Dev Runner — Log Export ===`,
    `Service: ${svc.name} (${svc.id})`,
    `Type:    ${svc.type}  |  Group: ${svc.group}  |  Port: ${svc.port || "N/A"}`,
    `Status:  ${st.status}  |  PID: ${st.pid || "—"}`,
    `Export:  ${new Date().toISOString()}`,
    `Lines:   ${st.logs.length}`,
    `${"=".repeat(50)}`,
    "",
  ].join("\n");

  writeFileSync(filePath, header + plainLogs + "\n", "utf8");

  const editor = IS_WIN ? "code" : (process.env.EDITOR || "code");
  try {
    const editorProc = spawn(editor, [filePath], { stdio: "ignore", detached: true, shell: IS_WIN, windowsHide: true });
    editorProc.unref();
    st.logs.push(`${ts()} [dev-runner] Logs exported to ${filePath}`);
  } catch {
    const openCmd = IS_WIN ? "start" : (platform() === "darwin" ? "open" : "xdg-open");
    try {
      const fallback = spawn(openCmd, IS_WIN ? ["\"\"", filePath] : [filePath], { stdio: "ignore", detached: true, shell: true, windowsHide: true });
      fallback.unref();
      st.logs.push(`${ts()} [dev-runner] Logs exported to ${filePath}`);
    } catch (err) {
      st.logs.push(`${ts()} [dev-runner] Could not open editor: ${err.message}`);
      st.logs.push(`${ts()} [dev-runner] Log saved to: ${filePath}`);
    }
  }
}

// ── Formatting ──────────────────────────────────────────────────────

function fmtStatus(status) {
  switch (status) {
    case "running":  return `${A.bgGreen}${A.white}${A.bold} RUN ${A.reset}`;
    case "starting": return `${A.bgYellow}${A.white}${A.bold} START ${A.reset}`;
    case "unhealthy":return `${A.bgYellow}${A.white}${A.bold} WAIT ${A.reset}`;
    case "error":    return `${A.bgRed}${A.white}${A.bold} ERR ${A.reset}`;
    case "stopped":  return `${A.dim} STOP ${A.reset}`;
    default:         return `${A.dim} ??? ${A.reset}`;
  }
}

function fmtStatusPlain(status) {
  switch (status) {
    case "running": return "RUN"; case "starting": return "START"; case "unhealthy": return "WAIT";
    case "error": return "ERR"; case "stopped": return "STOP"; default: return "???";
  }
}

function fmtUptime(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

function ts() {
  return new Date().toLocaleTimeString("de-DE", { hour12: false });
}

// ── Build All ───────────────────────────────────────────────────────

function buildAll() {
  viewMode = "build";
  draw();

  let proc;
  try {
    proc = spawn("cargo", ["build"], {
      cwd: BACKEND,
      stdio: ["ignore", "pipe", "pipe"],
      shell: IS_WIN,
      windowsHide: true,
    });
  } catch (err) {
    viewMode = "main";
    draw();
    return;
  }

  const buildLines = [];
  const onData = (d) => {
    const ls = d.toString().split("\n");
    for (const l of ls) { if (l.trim()) buildLines.push(l); }
    // Redraw build view
    const W = termCols(), H = termRows();
    clear();
    moveTo(1, 1);
    write(`  ${A.yellow}${A.bold}Building all backend crates...${A.reset}\n\n`);
    const maxL = H - 5;
    const visible = buildLines.slice(-maxL);
    for (const bl of visible) write(`  ${bl}\n`);
  };
  proc.stdout?.on("data", onData);
  proc.stderr?.on("data", onData);
  proc.on("exit", (code) => {
    buildLines.push(code === 0
      ? `\n  ${A.green}${A.bold}Build successful!${A.reset}`
      : `\n  ${A.red}${A.bold}Build failed (code ${code})${A.reset}`);
    onData(Buffer.from(""));
    setTimeout(() => { viewMode = "main"; draw(); }, 2500);
  });
}

// ═══════════════════════════════════════════════════════════════════
// ══  RENDERING ENGINE  ═════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════

/** Central draw dispatcher — call this whenever state changes */
function draw() {
  if (shuttingDown || cliMode) return;
  switch (viewMode) {
    case "main":  drawMain();  break;
    case "logs":  drawLogs();  break;
    case "info":  drawInfo();  break;
    case "build": break; // build draws itself
  }
}

// ── Main View ───────────────────────────────────────────────────────

function drawMain() {
  const W = termCols();
  const H = termRows();
  clear();
  hideCursor();

  let row = 1;

  // ── Header ──────────────────────────────────────────────
  moveTo(row, 1);
  if (H >= 10) {
    write(`${A.bold}${A.cyan}╔${hline(W - 2, "═")}╗${A.reset}`);
    row++;
    moveTo(row, 1);
    const title = `  ${A.bold}IORA Dev Runner${A.reset}   ${A.dim}Interactive Development Manager${A.reset}`;
    write(`${A.bold}${A.cyan}║${A.reset}${fit(title, W - 2)}${A.bold}${A.cyan}║${A.reset}`);
    row++;
    moveTo(row, 1);
    write(`${A.bold}${A.cyan}╚${hline(W - 2, "═")}╝${A.reset}`);
    row++;
  } else {
    // Compact: single line header
    write(fit(`${A.bold}${A.cyan} IORA Dev Runner${A.reset}`, W));
    row++;
  }

  // ── Status bar ──────────────────────────────────────────
  const running = [...state.values()].filter(s => s.status === "running").length;
  const starting = [...state.values()].filter(s => s.status === "starting").length;
  const errorCount = [...state.values()].filter(s => s.status === "error").length;
  const watchIcon = hotReload ? `${A.green}●${A.reset}` : `${A.dim}○${A.reset}`;

  moveTo(row, 1);
  const statusLine = ` ${A.green}${running}${A.reset} run`
    + (starting > 0 ? `  ${A.yellow}${starting}${A.reset} start` : "")
    + (errorCount > 0 ? `  ${A.red}${errorCount}${A.reset} err` : "")
    + `  ${A.dim}/${SERVICES.length}${A.reset}`
    + `  │  Hot-Reload ${watchIcon}`
    + `  │  Watchers ${A.cyan}${watchers.length}${A.reset}`
    + `  │  ${A.dim}${ts()}${A.reset}`;
  write(fit(statusLine, W));
  row++;

  if (H >= 16) {
    moveTo(row, 1);
    write(fit(` ${A.bold}Access:${A.reset} Frontend http://127.0.0.1:${process.env.VITE_PORT || 5173}  Backend http://127.0.0.1:${process.env.BACKEND_PORT || SERVICE_PORTS["iora-home"]}`, W));
    row++;
    moveTo(row, 1);
    write(fit(` ${A.bold}Credentials:${A.reset} IORA ${DEV_ADMIN_USER} / ${DEV_ADMIN_PASSWORD}  OS ${DEV_OS_USER} / ${DEV_OS_PASSWORD}`, W));
    row++;
    moveTo(row, 1);
    write(fit(` ${A.bold}Dev VM:${A.reset} ${summarizeDevVmState()}`, W));
    row++;
  }

  // ── Service list ────────────────────────────────────────
  const footerLines = H >= 14 ? 4 : (H >= 10 ? 2 : 1);
  const availRows = Math.max(1, H - row - footerLines);

  // Build display lines for services (with group headers)
  const displayLines = [];
  let lastGroup = "";
  const groupLabels = { frontend: "Frontend", core: "Core Services", extra: "Extensions" };

  for (let i = 0; i < SERVICES.length; i++) {
    const svc = SERVICES[i];
    const st = state.get(svc.id);

    if (svc.group !== lastGroup) {
      if (lastGroup !== "") displayLines.push({ type: "blank" });
      displayLines.push({ type: "group", label: groupLabels[svc.group] || svc.group });
      lastGroup = svc.group;
    }

    displayLines.push({ type: "service", index: i, svc, st });
  }

  // Ensure cursor is visible (auto-scroll)
  const cursorDisplayIdx = displayLines.findIndex(d => d.type === "service" && d.index === cursor);
  if (cursorDisplayIdx >= 0) {
    if (cursorDisplayIdx < mainScrollOffset) mainScrollOffset = cursorDisplayIdx;
    if (cursorDisplayIdx >= mainScrollOffset + availRows) mainScrollOffset = cursorDisplayIdx - availRows + 1;
  }
  if (mainScrollOffset < 0) mainScrollOffset = 0;
  const maxScroll = Math.max(0, displayLines.length - availRows);
  if (mainScrollOffset > maxScroll) mainScrollOffset = maxScroll;

  const visibleDisplayLines = displayLines.slice(mainScrollOffset, mainScrollOffset + availRows);

  // Column widths adapt to terminal width
  const nameW = Math.max(12, Math.min(28, W - 40));

  for (const dl of visibleDisplayLines) {
    row++;
    moveTo(row, 1);

    if (dl.type === "blank") {
      write(" ".repeat(W));
      continue;
    }

    if (dl.type === "group") {
      const label = ` ${A.bold}${A.blue}── ${dl.label} ${hline(Math.max(0, W - dl.label.length - 7), "─")}${A.reset}`;
      write(fit(label, W));
      continue;
    }

    // Service row
    const { index: i, svc, st } = dl;
    const selected = i === cursor;

    const marker = selected ? `${A.cyan}▸${A.reset}` : " ";
    const statusBadge = fmtStatus(st.status);
    const port = svc.port ? `${A.dim}:${svc.port}${A.reset}` : "";
    const pid = st.pid ? `${A.dim}pid ${st.pid}${A.reset}` : "";
    const uptime = st.startTime && (st.status === "running" || st.status === "starting")
      ? `${A.dim}${fmtUptime(Date.now() - st.startTime)}${A.reset}` : "";
    const restarts = st.restartCount > 0 ? `${A.dim}×${st.restartCount}${A.reset}` : "";
    const name = selected ? `${A.bold}${A.white}${svc.name}${A.reset}` : svc.name;

    if (W >= 70) {
      const line = ` ${marker} ${fit(name, nameW)} ${statusBadge} ${fit(port, 7)} ${fit(pid, 12)} ${uptime} ${restarts}`;
      write(fit(line, W));
    } else if (W >= 45) {
      const line = ` ${marker} ${fit(name, nameW)} ${statusBadge} ${fit(port, 7)}`;
      write(fit(line, W));
    } else {
      // Very narrow: just name + status
      const plainStatus = fmtStatusPlain(st.status);
      const line = `${marker}${fit(name, W - plainStatus.length - 3)} ${plainStatus}`;
      write(fit(line, W));
    }
  }

  // Fill empty rows
  for (let r = row + 1; r <= H - footerLines; r++) {
    moveTo(r, 1);
    write(" ".repeat(W));
  }

  // Scroll indicator
  if (displayLines.length > availRows) {
    const scrollPct = Math.round((mainScrollOffset / Math.max(1, displayLines.length - availRows)) * 100);
    moveTo(H - footerLines, W - 7);
    write(`${A.dim}${scrollPct}%${A.reset}`);
  }

  // ── Footer / keybinds ───────────────────────────────────
  const footerRow = H - footerLines + 1;
  moveTo(footerRow, 1);
  write(`${A.dim}${hline(W, "─")}${A.reset}`);

  if (footerLines >= 4) {
    moveTo(footerRow + 1, 1);
    write(fit(` ${A.cyan}↑↓${A.reset} Navigate  ${A.cyan}Space${A.reset} Toggle  ${A.cyan}Enter${A.reset} Info  ${A.cyan}l${A.reset} Logs  ${A.cyan}→${A.reset} Start  ${A.cyan}←${A.reset} Stop`, W));
    moveTo(footerRow + 2, 1);
    write(fit(` ${A.cyan}a${A.reset} Start all  ${A.cyan}s${A.reset} Stop all  ${A.cyan}r${A.reset} Restart/Reinstall  ${A.cyan}R${A.reset} Restart all  ${A.cyan}w${A.reset} Hot-reload  ${A.cyan}B${A.reset} Build`, W));
    moveTo(footerRow + 3, 1);
    write(fit(` ${A.cyan}f${A.reset} Explorer   ${A.cyan}t${A.reset} Terminal  ${A.cyan}e${A.reset} Logs→Editor  ${A.cyan}q${A.reset}/Ctrl+C Quit  ${A.dim}Mouse: click to select/toggle${A.reset}`, W));
  } else if (footerLines >= 2) {
    moveTo(footerRow + 1, 1);
    write(fit(` ${A.cyan}↑↓${A.reset}Nav ${A.cyan}Space${A.reset}Toggle ${A.cyan}Enter${A.reset}Info ${A.cyan}l${A.reset}Logs ${A.cyan}f${A.reset}Explorer ${A.cyan}t${A.reset}Terminal ${A.cyan}a${A.reset}All ${A.cyan}q${A.reset}Quit`, W));
  } else {
    moveTo(footerRow, 1);
    write(fit(` ${A.dim}↑↓ Space Enter l f t a s r w B q${A.reset}`, W));
  }
}

// ── Log View ────────────────────────────────────────────────────────

function drawLogs() {
  const id = viewServiceId;
  const st = state.get(id);
  const svc = SERVICES.find(s => s.id === id);
  if (!st || !svc) { viewMode = "main"; draw(); return; }

  const W = termCols();
  const H = termRows();
  clear();
  hideCursor();

  // Header
  const maxLines = Math.max(1, H - 4);
  const totalLogs = st.logs.length;

  const maxOffset = Math.max(0, totalLogs - maxLines);
  if (logScrollOffset > maxOffset) logScrollOffset = maxOffset;
  if (logScrollOffset < 0) logScrollOffset = 0;

  const endIdx = totalLogs - logScrollOffset;
  const startIdx = Math.max(0, endIdx - maxLines);
  const visible = st.logs.slice(startIdx, endIdx);

  const atBottom = logScrollOffset === 0;
  const scrollIndicator = atBottom
    ? `${A.green}● LIVE${A.reset}`
    : `${A.yellow}↑ ${logScrollOffset} lines${A.reset}`;

  moveTo(1, 1);
  write(fit(`${A.bold}${A.yellow}═══ Logs: ${svc.name} ═══${A.reset}  ${fmtStatus(st.status)}  ${scrollIndicator}`, W));
  moveTo(2, 1);
  write(fit(`${A.dim}[Esc/q] back  [c] clear  [↑↓/PgUp/PgDn] scroll  [Home/End]  [e] editor  [f] explorer  [t] terminal${A.reset}`, W));

  for (let i = 0; i < maxLines; i++) {
    moveTo(i + 3, 1);
    const logLine = visible[i];
    if (logLine) {
      write(fit(` ${colorizeLog(logLine)}`, W));
    } else {
      write(" ".repeat(W));
    }
  }

  // Bottom bar with scroll position
  moveTo(H, 1);
  const pct = totalLogs > maxLines ? Math.round(((totalLogs - logScrollOffset - maxLines) / Math.max(1, totalLogs - maxLines)) * 100) : 100;
  write(fit(`${A.dim}─ ${totalLogs} lines  ${pct}% ─${A.reset}`, W));
}

// ── Info View (Live Updating) ───────────────────────────────────────

function drawInfo() {
  const id = viewServiceId;
  const st = state.get(id);
  const svc = SERVICES.find(s => s.id === id);
  if (!st || !svc) { viewMode = "main"; draw(); return; }

  const W = termCols();
  const H = termRows();
  clear();
  hideCursor();

  let row = 1;

  // Header
  moveTo(row, 1);
  write(fit(`${A.bold}${A.cyan}═══ Service Info: ${svc.name} ═══${A.reset}  ${fmtStatus(st.status)}`, W));
  row++;
  moveTo(row, 1);
  write(fit(`${A.dim}[Esc/q/Enter] back  [e] editor  [f] explorer  [t] terminal  [l] full logs  [Space] toggle${A.reset}`, W));
  row++;

  // Info fields
  const labelW = 14;
  const fields = [
    ["ID", svc.id],
    ["Name", svc.name],
    ["Type", svc.type],
    ["Group", svc.group],
    ["Port", svc.port ? `:${svc.port}` : "N/A"],
    ["Status", fmtStatusPlain(st.status)],
    ["PID", st.pid || "—"],
    ["Restarts", String(st.restartCount)],
    ["Command", `${svc.cmd} ${svc.args.join(" ")}`],
    ["CWD", svc.cwd],
  ];
  if (svc.type === "dev-vm") {
    const vm = readDevVmState();
    fields.push(["Install", "Right arrow / Space starts dev-local.ps1 safely"]);
    fields.push(["Reinstall", "r runs dev-local.ps1 -Rebuild -NoWatch"]);
    fields.push(["VM Life", vm?.lifecycle || "not initialized"]);
    fields.push(["Sync", vm?.syncStatus || "unknown"]);
    fields.push(["Watcher", vm?.watcherStatus || "unknown"]);
    fields.push(["Last Ready", vm?.lastReadyAt || "—"]);
    fields.push(["Last Sync", vm?.lastSyncAt || "—"]);
    fields.push(["Last Error", vm?.lastError || "—"]);
  }
  if (svc.id === "iora-home") {
    fields.push(["IORA Login", `${DEV_ADMIN_USER} / ${DEV_ADMIN_PASSWORD}`]);
    fields.push(["OS Login", `${DEV_OS_USER} / ${DEV_OS_PASSWORD}`]);
    fields.push(["Frontend", `http://127.0.0.1:${process.env.VITE_PORT || 5173}`]);
  }
  if (svc.srcDir) fields.push(["Source", svc.srcDir]);
  if (st.startTime && (st.status === "running" || st.status === "starting")) {
    fields.push(["Uptime", fmtUptime(Date.now() - st.startTime)]);
  }

  row++;
  for (const [label, value] of fields) {
    if (row >= H - 14) break;  // reserve space for logs
    moveTo(row, 1);
    write(fit(`  ${A.bold}${label}:${A.reset}${" ".repeat(Math.max(1, labelW - label.length - 1))}${value}`, W));
    row++;
  }

  // Separator
  row++;
  moveTo(row, 1);
  write(fit(`  ${A.dim}${hline(Math.max(0, W - 4), "─")}${A.reset}`, W));
  row++;

  // Recent logs — fill remaining space
  moveTo(row, 1);
  write(fit(`  ${A.bold}Recent Logs:${A.reset}  ${A.dim}(auto-updating)${A.reset}`, W));
  row++;

  const logSpace = Math.max(1, H - row - 1);
  const recentLogs = st.logs.slice(-logSpace);
  for (let i = 0; i < logSpace; i++) {
    moveTo(row + i, 1);
    const line = recentLogs[i];
    if (line) {
      write(fit(` ${colorizeLog(line)}`, W));
    } else {
      write(" ".repeat(W));
    }
  }

  // Bottom
  moveTo(H, 1);
  write(fit(`${A.dim}─ ${st.logs.length} log lines  ${ts()} ─${A.reset}`, W));
}

// ═══════════════════════════════════════════════════════════════════
// ══  INPUT HANDLING  ═══════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════

const SEQ_UP    = `${CSI}A`;
const SEQ_DOWN  = `${CSI}B`;
const SEQ_RIGHT = `${CSI}C`;
const SEQ_LEFT  = `${CSI}D`;
const SEQ_PGUP  = `${CSI}5~`;
const SEQ_PGDN  = `${CSI}6~`;
const SEQ_HOME  = `${CSI}H`;
const SEQ_HOME2 = `${CSI}1~`;
const SEQ_END   = `${CSI}F`;
const SEQ_END2  = `${CSI}4~`;

/** Parse SGR mouse events: ESC [ < Cb ; Cx ; Cy M/m */
function parseMouse(seq) {
  const m = seq.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
  if (!m) return null;
  const btn = parseInt(m[1]);
  const x = parseInt(m[2]);
  const y = parseInt(m[3]);
  const release = m[4] === "m";
  const isScroll = (btn & 64) !== 0;
  const scrollDir = isScroll ? ((btn & 1) ? "down" : "up") : null;
  const button = isScroll ? "scroll" : (btn & 3) === 0 ? "left" : (btn & 3) === 2 ? "right" : "middle";
  return { button, x, y, release, scrollDir };
}

function setupInput() {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  process.stdin.on("data", async (data) => {
    const chunks = splitInput(data);
    for (const key of chunks) {
      await handleKey(key);
    }
  });
}

/** Split combined input into individual escape sequences */
function splitInput(data) {
  const result = [];
  let i = 0;
  while (i < data.length) {
    if (data[i] === ESC && i + 1 < data.length && data[i + 1] === "[") {
      // Find end of escape sequence
      let j = i + 2;
      // SGR mouse: ESC [ < ... M/m
      if (j < data.length && data[j] === "<") {
        while (j < data.length && data[j] !== "M" && data[j] !== "m") j++;
        if (j < data.length) j++;
        result.push(data.slice(i, j));
        i = j;
        continue;
      }
      // CSI sequence: ESC [ (params) (letter)
      while (j < data.length && !((data.charCodeAt(j) >= 0x40 && data.charCodeAt(j) <= 0x7E))) j++;
      if (j < data.length) j++;
      result.push(data.slice(i, j));
      i = j;
    } else {
      result.push(data[i]);
      i++;
    }
  }
  return result;
}

async function handleKey(key) {
  // Ctrl+C
  if (key === "\x03") { shutdown(); return; }

  // Mouse events
  const mouse = parseMouse(key);
  if (mouse) {
    handleMouse(mouse);
    return;
  }

  // ── Info View ────────────────────────────────────────────
  if (viewMode === "info") {
    if (key === ESC || key === "q" || key === "\r" || key === "\n" || key === "\x7f" || key === "\b") {
      viewMode = "main";
      draw();
      return;
    }
    if (key === "e") { openLogsInEditor(viewServiceId); draw(); return; }
    if (key === "f") { openExplorer(viewServiceId); return; }
    if (key === "t") { openTerminal(viewServiceId); return; }
    if (key === "l") { viewMode = "logs"; logScrollOffset = 0; draw(); return; }
    if (key === " ") {
      const st = state.get(viewServiceId);
      if (st?.proc) stopService(viewServiceId);
      else startService(viewServiceId);
      return;
    }
    return;
  }

  // ── Log View ─────────────────────────────────────────────
  if (viewMode === "logs") {
    if (key === ESC || key === "q" || key === "\x7f" || key === "\b") {
      viewMode = "main"; logScrollOffset = 0; draw(); return;
    }
    if (key === "c") {
      const st = state.get(viewServiceId);
      if (st) st.logs = [];
      logScrollOffset = 0; draw(); return;
    }
    if (key === "e") { openLogsInEditor(viewServiceId); draw(); return; }
    if (key === "f") { openExplorer(viewServiceId); return; }
    if (key === "t") { openTerminal(viewServiceId); return; }
    if (key === SEQ_UP) { logScrollOffset++; draw(); return; }
    if (key === SEQ_DOWN) { logScrollOffset = Math.max(0, logScrollOffset - 1); draw(); return; }
    if (key === SEQ_PGUP) { logScrollOffset += 20; draw(); return; }
    if (key === SEQ_PGDN) { logScrollOffset = Math.max(0, logScrollOffset - 20); draw(); return; }
    if (key === SEQ_HOME || key === SEQ_HOME2) {
      const st = state.get(viewServiceId);
      if (st) logScrollOffset = st.logs.length;
      draw(); return;
    }
    if (key === SEQ_END || key === SEQ_END2) { logScrollOffset = 0; draw(); return; }
    return;
  }

  // ── Build View ───────────────────────────────────────────
  if (viewMode === "build") {
    if (key === ESC || key === "q") { viewMode = "main"; draw(); }
    return;
  }

  // ── Main View ────────────────────────────────────────────
  if (key === SEQ_UP) {
    cursor = (cursor - 1 + SERVICES.length) % SERVICES.length;
    draw(); return;
  }
  if (key === SEQ_DOWN) {
    cursor = (cursor + 1) % SERVICES.length;
    draw(); return;
  }
  if (key === SEQ_RIGHT) { startService(SERVICES[cursor].id); return; }
  if (key === SEQ_LEFT)  { stopService(SERVICES[cursor].id); return; }

  if (key === "\r" || key === "\n") {
    viewServiceId = SERVICES[cursor].id;
    viewMode = "info";
    draw(); return;
  }

  if (key === " ") {
    const svc = SERVICES[cursor];
    const st = state.get(svc.id);
    if (st.proc) stopService(svc.id);
    else startService(svc.id);
    return;
  }

  switch (key) {
    case "q": shutdown(); return;
    case "a": await startAll(); return;
    case "s": stopAll(); draw(); return;
    case "r": await restartService(SERVICES[cursor].id); return;
    case "R": await restartAll(); return;
    case "w": hotReload ? disableHotReload() : enableHotReload(); return;
    case "l":
      viewServiceId = SERVICES[cursor].id;
      logScrollOffset = 0;
      viewMode = "logs";
      draw(); return;
    case "B": buildAll(); return;
    case "e": openLogsInEditor(SERVICES[cursor].id); draw(); return;
    case "f": openExplorer(SERVICES[cursor].id); return;
    case "t": openTerminal(SERVICES[cursor].id); return;
  }
}

// ── Mouse Handling ──────────────────────────────────────────────────

function handleMouse(mouse) {
  if (viewMode === "main") {
    // Scroll wheel
    if (mouse.button === "scroll") {
      if (mouse.scrollDir === "up") {
        cursor = (cursor - 1 + SERVICES.length) % SERVICES.length;
      } else {
        cursor = (cursor + 1) % SERVICES.length;
      }
      draw();
      return;
    }

    // Left click — select or toggle
    if (mouse.button === "left" && !mouse.release) {
      const clickedIdx = clickToServiceIndex(mouse.y);
      if (clickedIdx !== null && clickedIdx >= 0 && clickedIdx < SERVICES.length) {
        if (cursor === clickedIdx) {
          // Second click on same row — toggle
          const st = state.get(SERVICES[clickedIdx].id);
          if (st?.proc) stopService(SERVICES[clickedIdx].id);
          else startService(SERVICES[clickedIdx].id);
        } else {
          cursor = clickedIdx;
          draw();
        }
      }
      return;
    }

    // Right click — open info
    if (mouse.button === "right" && !mouse.release) {
      const clickedIdx = clickToServiceIndex(mouse.y);
      if (clickedIdx !== null && clickedIdx >= 0 && clickedIdx < SERVICES.length) {
        cursor = clickedIdx;
        viewServiceId = SERVICES[clickedIdx].id;
        viewMode = "info";
        draw();
      }
      return;
    }
    return;
  }

  if (viewMode === "logs") {
    if (mouse.button === "scroll") {
      if (mouse.scrollDir === "up") logScrollOffset += 3;
      else logScrollOffset = Math.max(0, logScrollOffset - 3);
      draw();
    }
    // Left click on header area returns to main
    if (mouse.button === "left" && !mouse.release && mouse.y <= 2) {
      viewMode = "main";
      logScrollOffset = 0;
      draw();
    }
    return;
  }

  if (viewMode === "info") {
    // Left click on header area returns to main
    if (mouse.button === "left" && !mouse.release && mouse.y <= 2) {
      viewMode = "main";
      draw();
    }
    if (mouse.button === "scroll") {
      // scroll just refreshes (info is not scrollable atm)
    }
    return;
  }
}

/** Map a terminal row to a service index based on the current main view layout */
function clickToServiceIndex(y) {
  const H = termRows();
  const headerRows = H >= 10 ? 3 : 1;
  const statusRow = headerRows + 1;
  const footerLines = H >= 14 ? 4 : (H >= 10 ? 2 : 1);
  const firstContentRow = statusRow + 1;

  // Build display lines (same logic as drawMain)
  const displayLines = [];
  let lastGroup = "";
  for (let i = 0; i < SERVICES.length; i++) {
    const svc = SERVICES[i];
    if (svc.group !== lastGroup) {
      if (lastGroup !== "") displayLines.push({ type: "blank" });
      displayLines.push({ type: "group" });
      lastGroup = svc.group;
    }
    displayLines.push({ type: "service", index: i });
  }

  const relRow = y - firstContentRow;  // 0-based row within content area
  if (relRow < 0) return null;

  const dlIdx = mainScrollOffset + relRow;
  if (dlIdx >= 0 && dlIdx < displayLines.length) {
    const dl = displayLines[dlIdx];
    if (dl.type === "service") return dl.index;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// ══  LIFECYCLE  ════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (!cliMode) {
    disableMouse();
    showCursor();
    disableAltScreen();
  }
  write(`\n${A.yellow}Stopping all services...${A.reset}\n`);
  disableHotReload();
  stopAll();
  setTimeout(() => {
    write(`${A.green}All stopped. Goodbye!${A.reset}\n`);
    process.exit(0);
  }, 2500);
}

process.on("exit", () => {
  if (process.stdout.isTTY && !cliMode) try { disableMouse(); showCursor(); disableAltScreen(); } catch {}
});
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("uncaughtException", (err) => {
  try { disableMouse(); showCursor(); disableAltScreen(); } catch {}
  process.stderr.write(`\n${A.red}Uncaught: ${err.message}${A.reset}\n`);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  process.stderr.write(`\n${A.red}Unhandled: ${err}${A.reset}\n`);
});

// Redraw on terminal resize
process.stdout.on("resize", () => { draw(); });

// ── Utility ─────────────────────────────────────────────────────────

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── CLI Arguments ───────────────────────────────────────────────────

function parseCLI() {
  const args = process.argv.slice(2);
  if (args.length === 0) return null;
  return { cmd: args[0], target: args[1] || "all", flags: args.slice(2) };
}

async function runDoctor() {
  const checks = [
    ["Repository", existsSync(join(ROOT, "AGENTS.md")), ROOT],
    ["Frontend", existsSync(join(FRONTEND, "package.json")), FRONTEND],
    ["Rust workspace", existsSync(join(BACKEND, "Cargo.toml")), BACKEND],
  ];
  for (const [label, ok, detail] of checks) console.log(`${ok ? A.green : A.red}${ok ? "PASS" : "FAIL"}${A.reset} ${label}: ${detail}`);
  for (const command of ["node", "npm", "cargo", "docker"]) {
    try {
      const version = execSync(`${command} --version`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      console.log(`${A.green}PASS${A.reset} ${command}: ${version}`);
    } catch {
      console.log(`${command === "docker" ? A.yellow : A.red}${command === "docker" ? "WARN" : "FAIL"}${A.reset} ${command}: not available`);
    }
  }
  const postgresPort = Number(process.env.POSTGRES_PORT || 5432);
  const postgresReady = await probePort(postgresPort, 700);
  console.log(`${postgresReady ? A.green : A.yellow}${postgresReady ? "PASS" : "WARN"}${A.reset} PostgreSQL: ${postgresReady ? "ready" : "not reachable"} on 127.0.0.1:${postgresPort}`);
  console.log(`${A.cyan}INFO${A.reset} Discovered ${SERVICES.length} runnable services.`);
  return checks.every(([, ok]) => ok);
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log(`${A.cyan}${A.bold}IORA Dev Runner${A.reset} — discovered ${A.green}${SERVICES.length}${A.reset} services\n`);
  for (const svc of SERVICES) {
    console.log(`  ${A.dim}${svc.type === "rust" ? "🦀" : "⚡"}${A.reset} ${svc.name.padEnd(24)} ${A.dim}:${svc.port || "?"}${A.reset}  ${A.dim}[${svc.group}]${A.reset}`);
  }
  console.log("");

  const cli = parseCLI();

  if (cli) {
    cliMode = true;
    switch (cli.cmd) {
      case "start":
        if (cli.target === "all") {
          await startAll();
        } else {
          const svc = SERVICES.find(s =>
            s.id === cli.target ||
            s.id === `iora-${cli.target}` ||
            s.name.toLowerCase().includes(cli.target.toLowerCase())
          );
          if (svc) {
            if (svc.type === "rust" && !await ensureDevDependencies()) {
              console.error(`PostgreSQL is unavailable; ${svc.id} was not started.`);
              process.exitCode = 1;
              return;
            }
            startService(svc.id);
          }
          else { console.error(`Unknown service: ${cli.target}`); process.exit(1); }
        }
        if (process.argv.includes("--watch")) enableHotReload();
        process.on("SIGINT", shutdown);
        return;
      case "build":
        buildAll();
        return;
      case "list":
        return;
      case "doctor":
        process.exitCode = await runDoctor() ? 0 : 1;
        return;
      default:
        console.log(`Usage: node scripts/dev/iora-dev.mjs [start|build|list|doctor] [service|all] [--watch]`);
        process.exit(0);
    }
  }

  // Enter interactive mode
  await delay(1200);

  enableAltScreen();
  enableMouse();
  draw();
  setupInput();

  // Refresh display every 2s for uptime counters + live info view
  setInterval(() => {
    if (!shuttingDown) draw();
  }, 2000);
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entryPoint) main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
