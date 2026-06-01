'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const log = require('./log');

/**
 * File-backed task store.
 *
 * Tasks live in {dataDir}/tasks.json (atomic writes). Per-task agent output is
 * streamed line-by-line into {dataDir}/logs/{taskId}.jsonl so live viewers can
 * tail it and the full transcript survives restarts.
 *
 * An EventEmitter broadcasts `log:{taskId}` and `task:update` events so the HTTP
 * layer can push Server-Sent-Events to the UI without polling the disk.
 */
class TaskStore extends EventEmitter {
  constructor(dataDir) {
    super();
    this.dataDir = dataDir;
    this.logsDir = path.join(dataDir, 'logs');
    this.tasksFile = path.join(dataDir, 'tasks.json');
    this.tasks = new Map();
    this._writeChain = Promise.resolve();
    this._init();
  }

  _init() {
    fs.mkdirSync(this.logsDir, { recursive: true });
    if (fs.existsSync(this.tasksFile)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.tasksFile, 'utf8'));
        for (const task of raw.tasks || []) {
          // Any task left "running"/"queued" after a restart is stale.
          if (task.status === 'running' || task.status === 'queued') {
            task.status = 'interrupted';
            task.finishedAt = task.finishedAt || new Date().toISOString();
          }
          this.tasks.set(task.id, task);
        }
        log.info(`Loaded ${this.tasks.size} task(s) from disk`);
      } catch (err) {
        log.error('Failed to read tasks file, starting empty', { error: err.message });
      }
    }
  }

  _persist() {
    const snapshot = { version: 1, tasks: Array.from(this.tasks.values()) };
    const data = JSON.stringify(snapshot, null, 2);
    const tmp = `${this.tasksFile}.tmp`;
    // Serialize writes to avoid concurrent corruption.
    this._writeChain = this._writeChain.then(
      () =>
        new Promise((resolve) => {
          fs.writeFile(tmp, data, (err) => {
            if (err) {
              log.error('Failed to write tasks tmp file', { error: err.message });
              return resolve();
            }
            fs.rename(tmp, this.tasksFile, (renameErr) => {
              if (renameErr) log.error('Failed to commit tasks file', { error: renameErr.message });
              resolve();
            });
          });
        }),
    );
    return this._writeChain;
  }

  create(partial) {
    const id = partial.id || `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const task = {
      id,
      status: 'queued',
      source: partial.source || 'manual', // 'manual' | 'github'
      title: partial.title || 'Agentic coding task',
      prompt: partial.prompt || '',
      repoFullName: partial.repoFullName || null, // owner/repo
      cloneUrl: partial.cloneUrl || null,
      baseBranch: partial.baseBranch || 'main',
      workBranch: partial.workBranch || `ora/agent-${id}`,
      provider: partial.provider,
      model: partial.model,
      // GitHub context (for posting results back)
      installationId: partial.installationId || null,
      prNumber: partial.prNumber || null,
      issueNumber: partial.issueNumber || null,
      commentId: partial.commentId || null,
      requestedBy: partial.requestedBy || null,
      // lifecycle
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      result: null, // { branch, commitSha, prUrl, summary, changed }
      error: null,
      exitCode: null,
    };
    this.tasks.set(id, task);
    // Reset log file for this task.
    fs.writeFileSync(this._logPath(id), '');
    this._persist();
    this.emit('task:update', task);
    return task;
  }

  _logPath(id) {
    return path.join(this.logsDir, `${id}.jsonl`);
  }

  get(id) {
    return this.tasks.get(id) || null;
  }

  list() {
    return Array.from(this.tasks.values()).sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
    );
  }

  update(id, patch) {
    const task = this.tasks.get(id);
    if (!task) return null;
    Object.assign(task, patch);
    this._persist();
    this.emit('task:update', task);
    return task;
  }

  /** Append a structured log line for a task and broadcast it to live viewers. */
  appendLog(id, entry) {
    const line = {
      ts: new Date().toISOString(),
      ...entry,
    };
    try {
      fs.appendFileSync(this._logPath(id), `${JSON.stringify(line)}\n`);
    } catch (err) {
      log.error('Failed to append task log', { id, error: err.message });
    }
    this.emit(`log:${id}`, line);
    return line;
  }

  /** Read the full transcript for a task. */
  readLogs(id) {
    const p = this._logPath(id);
    if (!fs.existsSync(p)) return [];
    return fs
      .readFileSync(p, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return { ts: null, type: 'raw', text: l };
        }
      });
  }
}

module.exports = TaskStore;
