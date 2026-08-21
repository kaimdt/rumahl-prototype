#!/usr/bin/env node
/**
 * rumahl Frontend + Backend Dev Runner
 *
 * Starts both Vite dev server (frontend) and rumahl-home (backend) concurrently
 * with proper environment configuration for hot reload integration.
 *
 * Usage:
 *   npm run dev:full              # Start both frontend and backend
 *   npm run dev:full -- --port 3002  # Custom backend port
 *   node scripts/dev/start-full.mjs  # Direct execution
 *
 * Environment:
 *   - Automatically sets rumahl_FRONTEND_DEV_URL for backend
 *   - Configures VITE_rumahl_BACKEND_URL for frontend proxy
 *   - Aggregates logs from both processes
 */

import { spawn, execFileSync } from "node:child_process";
import { platform } from "node:os";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { Socket } from "node:net";

// ── Configuration ───────────────────────────────────────────────────────

const IS_WIN = platform() === "win32";
const ROOT = resolve(import.meta.dirname, "../..");
const FRONTEND_DIR = resolve(ROOT, "frontend");
const BACKEND_DIR = resolve(ROOT, "rumahl-os/backend");
const COMPOSE_FILE = resolve(ROOT, "deploy/docker-compose.yml");

// Default ports
const VITE_PORT = process.env.VITE_PORT || 5173;
const BACKEND_PORT = process.env.BACKEND_PORT || 3001;

// Parse command line args
const args = process.argv.slice(2);
const customPort = args.find(arg => arg.startsWith("--port="))?.split("=")[1] || BACKEND_PORT;
const DEV_ADMIN_USER = process.env.rumahl_BOOTSTRAP_ADMIN_USER || "admin";
const DEV_ADMIN_PASSWORD = process.env.rumahl_BOOTSTRAP_ADMIN_PASSWORD || "rumahl-dev-admin";
const DEV_OS_USER = process.env.rumahl_DEV_OS_USER || process.env.USER || "rumahl";
const DEV_OS_PASSWORD = process.env.rumahl_DEV_OS_PASSWORD || "rumahl-dev-os";

// ── ANSI Colors ─────────────────────────────────────────────────────────

const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
};

function log(prefix, color, message) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`${colors.dim}[${timestamp}]${colors.reset} ${color}${prefix}${colors.reset} ${message}`);
}


function probePort(port, timeoutMs = 500) {
  return new Promise((resolveProbe) => {
    const socket = new Socket();
    const finish = (result) => { socket.destroy(); resolveProbe(result); };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(Number(port), "127.0.0.1");
  });
}

async function ensurePostgres() {
  const postgresPort = process.env.POSTGRES_PORT || "5432";
  if (await probePort(postgresPort, 700)) return true;
  if (!existsSync(COMPOSE_FILE)) return false;
  try {
    log("SETUP", colors.yellow, "PostgreSQL is not reachable; starting the existing development container...");
    execFileSync("docker", ["compose", "-f", COMPOSE_FILE, "up", "-d", "postgres"], { cwd: ROOT, stdio: "inherit" });
    for (let attempt = 0; attempt < 30; attempt++) {
      if (await probePort(postgresPort, 700)) return true;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    log("ERROR", colors.red, `Could not start PostgreSQL: ${error.message}`);
  }
  return false;
}

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const user = process.env.POSTGRES_USER || "rumahl";
  const password = process.env.POSTGRES_PASSWORD || "changeme";
  const port = process.env.POSTGRES_PORT || "5432";
  return `postgres://${user}:${password}@127.0.0.1:${port}/rumahl_home`;
}

// ── Process Management ──────────────────────────────────────────────────

let frontendProcess = null;
let backendProcess = null;
let shuttingDown = false;

function cleanup() {
  if (shuttingDown) return;
  shuttingDown = true;

  log("SYSTEM", colors.yellow, "Shutting down processes...");

  if (frontendProcess && !frontendProcess.killed) {
    frontendProcess.kill();
  }
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
  }

  setTimeout(() => {
    process.exit(0);
  }, 1000);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("exit", cleanup);

// ── Startup ─────────────────────────────────────────────────────────────

async function main() {
  console.clear();
  console.log(`${colors.bold}${colors.cyan}╔════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}║  rumahl Full Dev Mode — Frontend + Backend Hot Reload      ║${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}╚════════════════════════════════════════════════════════════╝${colors.reset}\n`);

  // Verify directories exist
  if (!existsSync(FRONTEND_DIR)) {
    log("ERROR", colors.red, `Frontend directory not found: ${FRONTEND_DIR}`);
    process.exit(1);
  }
  if (!existsSync(BACKEND_DIR)) {
    log("ERROR", colors.red, `Backend directory not found: ${BACKEND_DIR}`);
    process.exit(1);
  }

  log("CONFIG", colors.blue, `Frontend (Vite): http://localhost:${VITE_PORT}`);
  log("CONFIG", colors.blue, `Backend (rumahl-home): http://localhost:${customPort}`);
  log("CONFIG", colors.blue, `Environment: rumahl_FRONTEND_DEV_URL=http://localhost:${VITE_PORT}`);
  log("CONFIG", colors.blue, `Dev rumahl login: ${DEV_ADMIN_USER} / ${DEV_ADMIN_PASSWORD}`);
  log("CONFIG", colors.blue, `Dev OS login: ${DEV_OS_USER} / ${DEV_OS_PASSWORD}`);
  console.log();

  const postgresReady = await ensurePostgres();
  if (!postgresReady) {
    log("WARNING", colors.yellow, "PostgreSQL is not reachable. Backend may keep retrying until it becomes available.");
  }

  // Start Frontend (Vite)
  log("START", colors.green, "Starting Vite dev server...");
  frontendProcess = spawn(
    IS_WIN ? "npm.cmd" : "npm",
    ["run", "dev"],
    {
      cwd: FRONTEND_DIR,
      env: {
        ...process.env,
        VITE_rumahl_BACKEND_URL: `http://localhost:${customPort}`,
        FORCE_COLOR: "1",
      },
      stdio: "pipe",
    }
  );

  frontendProcess.stdout.on("data", (data) => {
    const lines = data.toString().trim().split("\n");
    lines.forEach(line => {
      if (line.trim()) log("VITE", colors.cyan, line);
    });
  });

  frontendProcess.stderr.on("data", (data) => {
    const lines = data.toString().trim().split("\n");
    lines.forEach(line => {
      if (line.trim()) log("VITE", colors.yellow, line);
    });
  });

  frontendProcess.on("error", (err) => {
    log("ERROR", colors.red, `Frontend failed to start: ${err.message}`);
    cleanup();
  });

  frontendProcess.on("exit", (code) => {
    if (!shuttingDown) {
      log("EXIT", colors.red, `Frontend exited with code ${code}`);
      cleanup();
    }
  });

  // Wait for Vite to be ready (check for "ready in" message or timeout after 30s)
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      log("WARNING", colors.yellow, "Vite startup timeout, proceeding anyway...");
      resolve();
    }, 30000);

    const checkReady = (data) => {
      if (data.toString().includes("ready in") || data.toString().includes("Local:")) {
        clearTimeout(timeout);
        frontendProcess.stdout.off("data", checkReady);
        resolve();
      }
    };

    frontendProcess.stdout.on("data", checkReady);
  });

  log("READY", colors.green, "Vite dev server is ready!");
  console.log();

  // Start Backend (rumahl-home with cargo)
  log("START", colors.green, "Starting rumahl-home backend...");

  // Check if cargo is available
  const cargoCmd = IS_WIN ? "cargo.exe" : "cargo";

  backendProcess = spawn(
    cargoCmd,
    ["run", "-p", "rumahl-home"],
    {
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        rumahl_FRONTEND_DEV_URL: `http://localhost:${VITE_PORT}`,
        rumahl_DEV_MODE: "true",
        PORT: String(customPort),
        DATABASE_URL: databaseUrl(),
        rumahl_BOOTSTRAP_ADMIN_USER: DEV_ADMIN_USER,
        rumahl_BOOTSTRAP_ADMIN_PASSWORD: DEV_ADMIN_PASSWORD,
        rumahl_BOOTSTRAP_ADMIN_DISPLAY_NAME: process.env.rumahl_BOOTSTRAP_ADMIN_DISPLAY_NAME || "rumahl Dev Admin",
        rumahl_DEV_OS_USER: DEV_OS_USER,
        rumahl_DEV_OS_PASSWORD: DEV_OS_PASSWORD,
        RUST_LOG: process.env.RUST_LOG || "info,rumahl_home=debug",
        FORCE_COLOR: "1",
      },
      stdio: "pipe",
    }
  );

  backendProcess.stdout.on("data", (data) => {
    const lines = data.toString().trim().split("\n");
    lines.forEach(line => {
      if (line.trim()) log("BACKEND", colors.magenta, line);
    });
  });

  backendProcess.stderr.on("data", (data) => {
    const lines = data.toString().trim().split("\n");
    lines.forEach(line => {
      if (line.trim()) log("BACKEND", colors.yellow, line);
    });
  });

  backendProcess.on("error", (err) => {
    log("ERROR", colors.red, `Backend failed to start: ${err.message}`);
    if (err.code === "ENOENT") {
      log("HINT", colors.yellow, "Make sure Rust and Cargo are installed: https://rustup.rs/");
    }
    cleanup();
  });

  backendProcess.on("exit", (code) => {
    if (!shuttingDown) {
      log("EXIT", colors.red, `Backend exited with code ${code}`);
      cleanup();
    }
  });

  // Wait a bit for backend to start
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Display access info
  console.log();
  console.log(`${colors.bold}${colors.green}✓ Both services started!${colors.reset}\n`);
  console.log(`${colors.bold}Access Points:${colors.reset}`);
  console.log(`  ${colors.cyan}Frontend (with HMR):${colors.reset}  http://localhost:${VITE_PORT}`);
  console.log(`  ${colors.magenta}Backend API:${colors.reset}          http://localhost:${customPort}`);
  console.log(`  ${colors.green}rumahl Login:${colors.reset}          ${DEV_ADMIN_USER} / ${DEV_ADMIN_PASSWORD}`);
  console.log(`  ${colors.green}OS Login:${colors.reset}            ${DEV_OS_USER} / ${DEV_OS_PASSWORD}`);
  console.log(`  ${colors.dim}Backend Dev Info:${colors.reset}     http://localhost:${customPort}/ (shows dev mode page)`);
  console.log();
  console.log(`${colors.dim}Press Ctrl+C to stop both services${colors.reset}\n`);
}

// ── Run ─────────────────────────────────────────────────────────────────

main().catch(err => {
  log("ERROR", colors.red, `Fatal error: ${err.message}`);
  console.error(err);
  cleanup();
});
