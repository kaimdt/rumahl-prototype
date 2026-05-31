'use strict';

const config = require('./config');
const log = require('./log');

/**
 * Capability surface for IORA's extended App/Plugin system (v2.4).
 *
 * This module backs the `assist_tools`, `exposed_services` and
 * `lifecycle_hooks` declared in manifest.json:
 *
 *  - **Assist tools**  — callable AI tools that IORA Assist / pi.dev coding
 *    agents can invoke. IORA dispatches a tool call to the tool's `handler`
 *    endpoint (mounted here under `/tools/...`) with the tool arguments as a
 *    JSON body and feeds the JSON response back to the model.
 *  - **Exposed services** — RPC methods other installed apps can call to drive
 *    the coding agent (mounted under the service `base_path`).
 *  - **Lifecycle hooks** — endpoints IORA invokes when system/app events fire
 *    (install, uninstall, config change).
 *
 * All handlers are thin wrappers around the existing task store + runner, so
 * the AI-tool / RPC / webhook entry points share one execution pipeline.
 */

/**
 * Create and enqueue a coding task from a normalised input object.
 * Shared by the manual API, the assist tools and the exposed RPC service.
 *
 * @returns {{ ok: boolean, error?: string, task?: object }}
 */
function createCodingTask(store, runner, input, requestedBy) {
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt) {
    return { ok: false, error: 'prompt is required' };
  }

  const repoFullName = input.repoFullName || input.repo || null;
  const cloneUrl =
    input.cloneUrl ||
    (repoFullName ? `https://github.com/${repoFullName}.git` : null);
  if (!cloneUrl && !repoFullName) {
    return { ok: false, error: 'cloneUrl or repoFullName is required' };
  }

  const task = store.create({
    source: input.source || 'assist-tool',
    title: input.title || `Task: ${prompt.slice(0, 60)}`,
    prompt,
    repoFullName,
    cloneUrl,
    baseBranch: input.baseBranch || input.base_branch || 'main',
    provider: input.provider || config.defaultProvider,
    model: input.model || config.defaultModel,
    installationId:
      input.installationId ||
      input.installation_id ||
      config.githubDefaultInstallationId ||
      null,
    requestedBy: requestedBy || 'assist',
  });
  runner.enqueue(task);
  return { ok: true, task };
}

/** Compact, model-friendly view of a task (no internal/secret fields). */
function publicTask(task) {
  if (!task) return null;
  return {
    task_id: task.id,
    title: task.title,
    status: task.status,
    source: task.source,
    repo: task.repoFullName,
    base_branch: task.baseBranch,
    work_branch: task.workBranch,
    provider: task.provider,
    model: task.model,
    created_at: task.createdAt,
    started_at: task.startedAt,
    finished_at: task.finishedAt,
    result: task.result,
    error: task.error,
  };
}

/**
 * Mount all capability routes on the Express app.
 *
 * @param {import('express').Express} app
 * @param {{ store: object, runner: object }} deps
 */
function registerCapabilityRoutes(app, { store, runner }) {
  // ─── Assist Tools ────────────────────────────────────────────────────────
  // Invoked by IORA Assist / pi.dev agents via the capability registry.

  // start_coding_task — kick off an agentic coding run.
  app.post('/tools/start_coding_task', (req, res) => {
    const input = req.body || {};
    const result = createCodingTask(store, runner, input, 'assist-tool');
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }
    log.info('Assist tool started coding task', { taskId: result.task.id });
    res.json({
      ok: true,
      task_id: result.task.id,
      status: result.task.status,
      message: `Coding task ${result.task.id} queued.`,
    });
  });

  // get_coding_task — report status / result of a task.
  app.post('/tools/get_coding_task', (req, res) => {
    const taskId = (req.body && (req.body.task_id || req.body.taskId)) || null;
    if (!taskId) return res.status(400).json({ ok: false, error: 'task_id is required' });
    const task = store.get(taskId);
    if (!task) return res.status(404).json({ ok: false, error: 'task not found' });
    res.json({ ok: true, task: publicTask(task) });
  });

  // list_coding_tasks — list the most recent tasks.
  app.post('/tools/list_coding_tasks', (req, res) => {
    const limitRaw = req.body && (req.body.limit ?? req.body.count);
    const limit = Math.min(Math.max(parseInt(limitRaw, 10) || 20, 1), 100);
    const tasks = store.list().slice(0, limit).map(publicTask);
    res.json({ ok: true, count: tasks.length, tasks });
  });

  // cancel_coding_task — cancel a queued or running task.
  app.post('/tools/cancel_coding_task', (req, res) => {
    const taskId = (req.body && (req.body.task_id || req.body.taskId)) || null;
    if (!taskId) return res.status(400).json({ ok: false, error: 'task_id is required' });
    const task = store.get(taskId);
    if (!task) return res.status(404).json({ ok: false, error: 'task not found' });
    const cancelled = runner.cancel(task.id);
    res.json({ ok: true, cancelled });
  });

  // ─── Exposed Service (inter-app RPC) ─────────────────────────────────────
  // base_path: /services/coding-agent — callable by other installed apps.

  app.post('/services/coding-agent/tasks', (req, res) => {
    const result = createCodingTask(store, runner, req.body || {}, 'app-rpc');
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }
    res.status(201).json({ ok: true, task: publicTask(result.task) });
  });

  app.post('/services/coding-agent/tasks/get', (req, res) => {
    const taskId = (req.body && (req.body.task_id || req.body.taskId)) || null;
    if (!taskId) return res.status(400).json({ ok: false, error: 'task_id is required' });
    const task = store.get(taskId);
    if (!task) return res.status(404).json({ ok: false, error: 'task not found' });
    res.json({ ok: true, task: publicTask(task) });
  });

  // ─── Lifecycle Hooks ─────────────────────────────────────────────────────
  // Invoked by IORA when the corresponding system/app event fires.

  app.post('/hooks/on_install', (req, res) => {
    log.info('Lifecycle hook: on_install', { event: req.body?.event || 'on_install' });
    res.json({ ok: true });
  });

  app.post('/hooks/on_uninstall', (req, res) => {
    log.info('Lifecycle hook: on_uninstall — cancelling active tasks');
    // Best-effort: stop everything still queued/running before removal.
    for (const task of store.list()) {
      if (task.status === 'queued' || task.status === 'running') {
        try {
          runner.cancel(task.id);
        } catch (err) {
          log.warn('Failed to cancel task during uninstall', { taskId: task.id, error: err.message });
        }
      }
    }
    res.json({ ok: true });
  });

  app.post('/hooks/on_config_changed', (req, res) => {
    log.info('Lifecycle hook: on_config_changed');
    res.json({ ok: true });
  });
}

module.exports = { registerCapabilityRoutes, createCodingTask, publicTask };
