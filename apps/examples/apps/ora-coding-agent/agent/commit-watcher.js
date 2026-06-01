#!/usr/bin/env node
/**
 * commit-watcher.js – Event-basierter inkrementeller Git-Commit-Watcher.
 *
 * Liest pi-JSON-Events von stdin. Leitet jedes Event unverändert nach stdout
 * durch (für EVENTS_FILE). Erkennt `message_end`-Events des Assistant: sobald
 * der Agent eine Antwort abgeschlossen hat UND sich Dateien im Repo geändert
 * haben, wird ein Git-Commit mit der Assistant-Nachricht als Commit-Message
 * erstellt.
 *
 * Mehrere Dateien für ein Feature = EIN Commit. Der Commit umfasst ALLE
 * Änderungen seit dem letzten Commit – egal ob von einem direkten Tool-Call
 * oder von Subagents, die parallel arbeiten.
 *
 * Subagents: pi-Subagent-Events fließen durch denselben stdout-Stream. Der
 * parent-Agent empfängt Subagent-Ergebnisse als tool_result, verarbeitet sie
 * und sendet ein message_end. Der Commit enthält dann alle Dateiänderungen
 * die in diesem Schritt entstanden sind – inklusive der vom Subagent.
 *
 * Aufruf: node commit-watcher.js <repo-dir> <commit-log-file>
 *
 * Env:
 *   INCREMENTAL_COMMITS         – "true"|"false" (default: true)
 *   INCREMENTAL_COMMIT_INTERVAL – Min.-Abstand zw. Commits in Sek. (default: 10,
 *                                  greift nur bei rapid-fire message_end ohne
 *                                  neue Dateiänderungen)
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');

const REPO_DIR = process.argv[2] || process.env.REPO_DIR || '/workspace/repo';
const COMMIT_LOG = process.argv[3] || '/workspace/commits.jsonl';
const ENABLED = (process.env.INCREMENTAL_COMMITS || 'true') !== 'false';
const MIN_INTERVAL_MS = (parseInt(process.env.INCREMENTAL_COMMIT_INTERVAL, 10) || 10) * 1000;

let commitCounter = 0;
let lastCommitTs = 0;
let lastCommitSha = '';
let pendingMessage = '';  // accumulates assistant content between message_end events

// ── Git helpers (run inside REPO_DIR) ────────────────────────────────────

function git(args) {
  const result = spawnSync('git', args, { cwd: REPO_DIR, encoding: 'utf8', timeout: 10000 });
  return { ok: result.status === 0, stdout: (result.stdout || '').trim(), stderr: (result.stderr || '').trim() };
}

function hasChanges() {
  const r = git(['diff', '--quiet']);
  if (r.ok) {
    // working tree clean — check staged too
    const s = git(['diff', '--cached', '--quiet']);
    return !s.ok;
  }
  return true; // working tree dirty
}

function stageAndCommit(message) {
  // Stage everything
  git(['add', '-A']);

  // Check if there's actually anything to commit
  const dc = git(['diff', '--cached', '--quiet']);
  if (dc.ok) return false; // nothing staged

  // Get list of changed files
  const files = git(['diff', '--cached', '--name-only']);
  const fileList = files.stdout
    ? files.stdout.split('\n').slice(0, 5).join(', ')
    : 'various files';

  // Build commit message: first sentence of assistant message + file list
  const firstSentence = (message || 'changes').split(/[.!?]\s+/)[0].trim().slice(0, 60);
  const commitMsg = `ora: ${firstSentence} [${fileList}]`.slice(0, 72);

  const commit = git(['commit', '--quiet', '-m', commitMsg]);
  if (!commit.ok) return false;

  const sha = git(['rev-parse', '--short', 'HEAD']);
  commitCounter++;
  lastCommitSha = sha.stdout || '?';
  lastCommitTs = Date.now();

  // Log to commit log file
  const entry = {
    index: commitCounter,
    sha: lastCommitSha,
    msg: commitMsg,
    ts: new Date().toISOString(),
  };
  try { fs.appendFileSync(COMMIT_LOG, JSON.stringify(entry) + '\n'); } catch { /* ignore */ }

  // Emit commit event on stdout so IORA app can track it
  process.stdout.write(JSON.stringify({
    type: 'ora',
    stage: 'commit',
    msg: `Incremental commit #${commitCounter}: ${lastCommitSha} — ${firstSentence}`,
    commitIndex: commitCounter,
    commitSha: lastCommitSha,
    commitMsg: commitMsg,
  }) + '\n');

  return true;
}

// ── Main: read pi events from stdin ─────────────────────────────────────

if (!ENABLED) {
  // Pass-through mode: just forward stdin → stdout, single commit at end
  process.stdin.setEncoding('utf8');
  process.stdin.pipe(process.stdout);
  process.stdin.on('end', () => { /* entrypoint.sh handles final commit */ });
  return;
}

const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (rawLine) => {
  // Always pass through to stdout
  process.stdout.write(rawLine + '\n');

  // Try to parse as JSON event
  let event;
  try { event = JSON.parse(rawLine); } catch { return; }
  if (!event || typeof event !== 'object') return;

  // Track assistant message content
  if (event.type === 'message_update' || event.type === 'message_end') {
    const msg = event.message;
    if (msg && msg.role === 'assistant' && Array.isArray(msg.content)) {
      const texts = msg.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('');
      if (texts.trim()) {
        pendingMessage = texts.trim();
      }
    }
  }

  // On message_end: assistant finished a logical step.
  // Commit if files have changed since the last commit. Multiple files
  // changed in this step (including by subagents) = ONE commit.
  if (event.type === 'message_end') {
    const now = Date.now();

    // Only skip if: (a) no new file changes since last commit, OR
    // (b) the agent is rapid-firing message_end events without doing work.
    // In practice, hasChanges() already guards (a). The interval guard
    // prevents commits when the agent sends back-to-back message_end
    // without any tool calls in between (e.g. follow-up clarifications).
    if (!hasChanges()) return;
    if (now - lastCommitTs < MIN_INTERVAL_MS) return;

    const msg = pendingMessage || `Step ${commitCounter + 1}`;
    stageAndCommit(msg);
  }
});

rl.on('close', () => {
  // pi finished — commit any remaining uncommitted changes.
  // This catches the case where the agent made changes via tool calls
  // but the final message_end was a summary without code changes.
  if (hasChanges()) {
    const msg = pendingMessage || 'final changes';
    stageAndCommit(msg);
  }

  // Write summary to commit log for the IORA app
  const summary = {
    totalCommits: commitCounter,
    lastSha: lastCommitSha,
  };
  process.stdout.write(JSON.stringify({
    type: 'ora',
    stage: 'commit_summary',
    msg: `Incremental commit session finished: ${commitCounter} commits`,
    ...summary,
  }) + '\n');
});
