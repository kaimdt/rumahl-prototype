'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const readline = require('readline');
const { spawn } = require('child_process');
const config = require('./config');
const github = require('./github');
const log = require('./log');

/**
 * AgentRunner owns the task lifecycle: a small concurrency-limited queue that,
 * for each task, launches the pi coding agent either inside an isolated Docker
 * container (default) or locally inside the app container (dev mode), streams
 * its JSON event output into the store, and reports the result back to GitHub.
 */
class AgentRunner {
  constructor(store) {
    this.store = store;
    this.queue = [];
    this.active = new Map(); // taskId -> { cancel(): void }
    this.docker = null;
  }

  _getDocker() {
    if (!this.docker) {
      // Lazy require so local mode works without the dockerode dependency present.
      const Docker = require('dockerode');
      this.docker = new Docker();
    }
    return this.docker;
  }

  enqueue(task) {
    this.queue.push(task.id);
    this.store.appendLog(task.id, { type: 'ora', stage: 'queued', msg: 'Task queued' });
    this._drain();
  }

  cancel(taskId) {
    const idx = this.queue.indexOf(taskId);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
      this.store.update(taskId, { status: 'cancelled', finishedAt: new Date().toISOString() });
      this.store.appendLog(taskId, { type: 'ora', stage: 'cancelled', msg: 'Removed from queue' });
      return true;
    }
    const handle = this.active.get(taskId);
    if (handle) {
      handle.cancel();
      return true;
    }
    return false;
  }

  _drain() {
    while (this.active.size < config.maxConcurrentTasks && this.queue.length > 0) {
      const taskId = this.queue.shift();
      const task = this.store.get(taskId);
      if (!task || task.status === 'cancelled') continue;
      this._run(task).catch((err) => {
        log.error('Unhandled error running task', { taskId, error: err.message });
        this._finish(task, { status: 'failed', error: err.message });
      });
    }
  }

  async _run(task) {
    this.store.update(task.id, { status: 'running', startedAt: new Date().toISOString() });
    this.store.appendLog(task.id, { type: 'ora', stage: 'start', msg: `Starting agent (${config.runnerMode} mode)` });

    // ── Prompt Optimization (optional) ─────────────────────────────────
    let finalPrompt = task.prompt;
    if (config.promptOptimizerEnabled) {
      this.store.appendLog(task.id, { type: 'ora', stage: 'optimize', msg: 'Optimizing prompt via light model...' });
      const provider = task.provider || config.defaultProvider;
      const model = task.model || config.defaultModel;
      try {
        const optimized = await config.optimizePrompt(task.prompt, provider, model);
        if (optimized !== task.prompt) {
          finalPrompt = optimized;
          this.store.appendLog(task.id, { type: 'ora', stage: 'optimize', msg: `Prompt optimized (${task.prompt.length} → ${optimized.length} chars)` });
        } else {
          this.store.appendLog(task.id, { type: 'ora', stage: 'optimize', msg: 'Prompt unchanged by optimizer' });
        }
      } catch (err) {
        this.store.appendLog(task.id, { type: 'ora', stage: 'optimize', msg: `Optimizer failed: ${err.message}, using original` });
      }
    }

    // Resolve an authenticated clone URL when we have a GitHub installation.
    let cloneUrl = task.cloneUrl;
    let token = null;
    if (task.installationId && task.cloneUrl) {
      try {
        token = await github.getInstallationToken(task.installationId);
        cloneUrl = github.authenticatedCloneUrl(task.cloneUrl, token);
      } catch (err) {
        this.store.appendLog(task.id, { type: 'ora', stage: 'error', msg: `Token error: ${err.message}` });
        return this._finish(task, { status: 'failed', error: `GitHub token error: ${err.message}` });
      }
    }

    const provider = task.provider || config.defaultProvider;
    const model = task.model || config.defaultModel;
    const envForTask = {
      TASK_ID: task.id,
      TASK_PROMPT: finalPrompt,
      REPO_URL: cloneUrl || '',
      BASE_BRANCH: task.baseBranch,
      WORK_BRANCH: task.workBranch,
      PI_PROVIDER: provider,
      PI_MODEL: model,
      GIT_AUTHOR_NAME: `${config.botMention}-bot`,
      GIT_AUTHOR_EMAIL: `${config.botMention}-bot@rumahl.local`,
      PI_OFFLINE: '1',
      PI_SKIP_VERSION_CHECK: '1',
      INCREMENTAL_COMMITS: config.incrementalCommits ? 'true' : 'false',
      INCREMENTAL_COMMIT_INTERVAL: String(config.incrementalCommitInterval),
      PI_EXTENSIONS: config.piExtensions.join(','),
      ...config.providerEnvForRun(provider),
    };

    let result = null;
    let exitCode = null;
    const onLine = (line) => {
      const parsed = safeJson(line);
      if (parsed) {
        if (parsed.type === 'rumahl_result') {
          result = parsed;
        }
        this.store.appendLog(task.id, parsed);
      } else {
        this.store.appendLog(task.id, { type: 'raw', text: line });
      }
    };

    try {
      if (config.runnerMode === 'local') {
        exitCode = await this._runLocal(task, envForTask, onLine);
      } else {
        exitCode = await this._runDocker(task, envForTask, onLine);
      }
    } catch (err) {
      this.store.appendLog(task.id, { type: 'ora', stage: 'error', msg: err.message });
      return this._finish(task, { status: 'failed', error: err.message });
    }

    if (this.store.get(task.id)?.status === 'cancelled') {
      return this._finish(task, { status: 'cancelled' });
    }

    const success = exitCode === 0;
    const finalResult = result
      ? {
          branch: result.branch || task.workBranch,
          commitSha: result.commitSha || null,
          summary: result.summary || null,
          changed: Boolean(result.changed),
          prUrl: result.prUrl || null,
          filesChanged: result.filesChanged || null,
        }
      : null;

    await this._reportToGitHub(task, success, finalResult);

    this._finish(task, {
      status: success ? 'completed' : 'failed',
      exitCode,
      result: finalResult,
      error: success ? null : `Agent exited with code ${exitCode}`,
    });
  }

  async _runDocker(task, envForTask, onLine) {
    const docker = this._getDocker();
    const envArray = Object.entries(envForTask).map(([k, v]) => `${k}=${v}`);

    this.store.appendLog(task.id, { type: 'ora', stage: 'container', msg: `Creating container from ${config.agentImage}` });
    const container = await docker.createContainer({
      Image: config.agentImage,
      Env: envArray,
      Tty: false,
      HostConfig: {
        AutoRemove: true,
        // Keep the agent on the default bridge so it can reach GitHub and the
        // rumahl Assist endpoint, but isolate it from other app containers.
        NetworkMode: process.env.AGENT_NETWORK || 'bridge',
      },
    });

    let cancelled = false;
    const cancel = async () => {
      cancelled = true;
      try {
        await container.stop({ t: 5 });
      } catch {
        /* already stopped */
      }
    };
    this.active.set(task.id, { cancel });

    const stream = await container.attach({ stream: true, stdout: true, stderr: true });
    // Demux Docker's multiplexed stream into line-based stdout/stderr handlers.
    const stdout = new LineSink(onLine);
    const stderr = new LineSink((l) => this.store.appendLog(task.id, { type: 'stderr', text: l }));
    container.modem.demuxStream(stream, stdout, stderr);

    await container.start();

    const timeoutMs = config.agentTimeoutSeconds * 1000;
    const timer = setTimeout(() => {
      this.store.appendLog(task.id, { type: 'ora', stage: 'timeout', msg: 'Agent timed out' });
      cancel();
    }, timeoutMs);

    let statusCode = 1;
    try {
      const data = await container.wait();
      statusCode = data.StatusCode;
    } finally {
      clearTimeout(timer);
      stdout.flush();
      stderr.flush();
      this.active.delete(task.id);
    }
    if (cancelled) {
      this.store.update(task.id, { status: 'cancelled' });
    }
    return statusCode;
  }

  async _runLocal(task, envForTask, onLine) {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `rumahl-agent-${task.id}-`));
    const entrypoint = path.join(__dirname, '..', 'agent', 'entrypoint.sh');
    this.store.appendLog(task.id, { type: 'ora', stage: 'local', msg: `Running in ${workspace}` });

    return new Promise((resolve, reject) => {
      const child = spawn('bash', [entrypoint], {
        cwd: workspace,
        env: {
          ...process.env,
          ...envForTask,
          WORKSPACE: workspace,
          RUMAHL_EXTENSION_PATH: path.join(__dirname, '..', 'agent', 'rumahl-provider.ts'),
          COMMIT_WATCHER: path.join(__dirname, '..', 'agent', 'commit-watcher.js'),
        },
      });

      let cancelled = false;
      const cancel = () => {
        cancelled = true;
        child.kill('SIGTERM');
      };
      this.active.set(task.id, { cancel });

      const rlOut = readline.createInterface({ input: child.stdout });
      rlOut.on('line', onLine);
      const rlErr = readline.createInterface({ input: child.stderr });
      rlErr.on('line', (l) => this.store.appendLog(task.id, { type: 'stderr', text: l }));

      const timer = setTimeout(() => {
        this.store.appendLog(task.id, { type: 'ora', stage: 'timeout', msg: 'Agent timed out' });
        cancel();
      }, config.agentTimeoutSeconds * 1000);

      child.on('error', (err) => {
        clearTimeout(timer);
        this.active.delete(task.id);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        this.active.delete(task.id);
        if (cancelled) this.store.update(task.id, { status: 'cancelled' });
        try {
          fs.rmSync(workspace, { recursive: true, force: true });
        } catch {
          /* best effort cleanup */
        }
        resolve(code === null ? 1 : code);
      });
    });
  }

  async _reportToGitHub(task, success, result) {
    if (task.source !== 'github' || !task.installationId || !task.repoFullName) return;
    const [owner, repo] = task.repoFullName.split('/');
    const issueNumber = task.prNumber || task.issueNumber;
    if (!issueNumber) return;

    const body = renderComment(task, success, result, config.botMention);
    try {
      await github.postComment(task.installationId, owner, repo, issueNumber, body);
      if (task.commentId) {
        await github.addReaction(task.installationId, owner, repo, task.commentId, success ? 'rocket' : 'confused');
      }
    } catch (err) {
      log.error('Failed to report result to GitHub', { taskId: task.id, error: err.message });
      this.store.appendLog(task.id, { type: 'ora', stage: 'error', msg: `GitHub report failed: ${err.message}` });
    }
  }

  _finish(task, patch) {
    this.store.update(task.id, { finishedAt: new Date().toISOString(), ...patch });
    this.store.appendLog(task.id, { type: 'ora', stage: 'done', msg: `Task ${patch.status}` });
    this._drain();
  }
}

/** Buffers a stream into newline-delimited callbacks; satisfies the Writable duck type used by demuxStream. */
class LineSink {
  constructor(onLine) {
    this.onLine = onLine;
    this.buffer = '';
  }

  write(chunk) {
    this.buffer += chunk.toString('utf8');
    let idx;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, '');
      this.buffer = this.buffer.slice(idx + 1);
      if (line.length) this.onLine(line);
    }
    return true;
  }

  end() {
    this.flush();
  }

  flush() {
    if (this.buffer.length) {
      this.onLine(this.buffer);
      this.buffer = '';
    }
  }
}

function safeJson(line) {
  try {
    const v = JSON.parse(line);
    return typeof v === 'object' && v !== null ? v : null;
  } catch {
    return null;
  }
}

function renderComment(task, success, result, mention) {
  if (!success) {
    return [
      `### rumahl Coding Agent — run failed`,
      '',
      `The agent could not complete the task. Check the rumahl Coding Agent app logs for task \`${task.id}\`.`,
      '',
      `_Requested via @${mention}._`,
    ].join('\n');
  }
  const lines = [`### rumahl Coding Agent — done`, ''];
  if (result && result.summary) {
    lines.push(result.summary, '');
  }
  if (result && result.changed) {
    lines.push(`Pushed branch \`${result.branch}\`` + (result.commitSha ? ` (commit \`${result.commitSha.slice(0, 8)}\`).` : '.'));
    if (result.filesChanged) lines.push('', `Files changed: ${result.filesChanged}`);
    if (result.prUrl) lines.push('', `Pull request: ${result.prUrl}`);
    else lines.push('', `Open a PR from \`${result.branch}\` into \`${task.baseBranch}\` to review the changes.`);
  } else {
    lines.push('The agent finished without producing any code changes.');
  }
  lines.push('', `_Powered by rumahl Assist + pi. Task \`${task.id}\`._`);
  return lines.join('\n');
}

module.exports = AgentRunner;
