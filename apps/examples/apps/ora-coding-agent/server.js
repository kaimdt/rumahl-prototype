'use strict';

const path = require('path');
const express = require('express');
const config = require('./src/config');
const log = require('./src/log');
const github = require('./src/github');
const TaskStore = require('./src/store');
const AgentRunner = require('./src/runner');
const { registerCapabilityRoutes, createCodingTask } = require('./src/capabilities');

const app = express();
const store = new TaskStore(config.dataDir);
const runner = new AgentRunner(store);

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'ora-coding-agent',
    version: '1.0.0',
    runnerMode: config.runnerMode,
    githubConfigured: config.isGitHubConfigured(),
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// GitHub webhook (raw body required for signature verification)
// ---------------------------------------------------------------------------
app.post('/webhook/github', express.raw({ type: '*/*', limit: '5mb' }), (req, res) => {
  const signature = req.get('X-Hub-Signature-256');
  const rawBody = req.body instanceof Buffer ? req.body : Buffer.from('');

  if (!github.verifySignature(rawBody, signature)) {
    log.warn('Rejected webhook with invalid signature');
    return res.status(401).json({ error: 'invalid signature' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'invalid json' });
  }

  const event = req.get('X-GitHub-Event');
  // Acknowledge immediately; process asynchronously so GitHub doesn't time out.
  res.status(202).json({ accepted: true });
  handleWebhook(event, payload).catch((err) =>
    log.error('Webhook handling failed', { event, error: err.message }),
  );
});

// ---------------------------------------------------------------------------
// JSON body for the rest of the API
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '1mb' }));

// Optional bearer-token guard for the management API/UI (the IORA gateway
// normally provides auth; this is a fallback for standalone deployments).
function guard(req, res, next) {
  if (!config.apiToken) return next();
  const auth = req.get('Authorization') || '';
  if (auth === `Bearer ${config.apiToken}`) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

app.get('/api/config', guard, (_req, res) => {
  res.json({
    botMention: config.botMention,
    githubConfigured: config.isGitHubConfigured(),
    runnerMode: config.runnerMode,
    defaultProvider: config.defaultProvider,
    defaultModel: config.defaultModel,
    providers: ['ora', 'anthropic', 'openai', 'google'],
  });
});

app.get('/api/tasks', guard, (_req, res) => {
  res.json({ tasks: store.list() });
});

app.get('/api/tasks/:id', guard, (req, res) => {
  const task = store.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'not found' });
  res.json({ task, logs: store.readLogs(task.id) });
});

app.post('/api/tasks', guard, (req, res) => {
  const { repoFullName, cloneUrl, baseBranch, prompt, provider, model, title, installationId } = req.body || {};
  const result = createCodingTask(
    store,
    runner,
    {
      source: 'manual',
      title,
      prompt,
      repoFullName,
      cloneUrl,
      baseBranch,
      provider,
      model,
      installationId,
    },
    'ui',
  );
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }
  res.status(201).json({ task: result.task });
});

app.post('/api/tasks/:id/cancel', guard, (req, res) => {
  const task = store.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'not found' });
  const ok = runner.cancel(task.id);
  res.json({ cancelled: ok });
});

// Live log stream via Server-Sent-Events.
app.get('/api/tasks/:id/logs', guard, (req, res) => {
  const task = store.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'not found' });

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders?.();

  for (const line of store.readLogs(task.id)) {
    res.write(`data: ${JSON.stringify(line)}\n\n`);
  }

  const onLog = (line) => res.write(`data: ${JSON.stringify(line)}\n\n`);
  const onUpdate = (t) => {
    if (t.id === task.id) res.write(`event: status\ndata: ${JSON.stringify({ status: t.status, result: t.result })}\n\n`);
  };
  store.on(`log:${task.id}`, onLog);
  store.on('task:update', onUpdate);

  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(keepAlive);
    store.off(`log:${task.id}`, onLog);
    store.off('task:update', onUpdate);
  });
});

// ---------------------------------------------------------------------------
// Extended capability surface (assist tools, exposed RPC service, lifecycle
// hooks). These are internal service-to-service endpoints invoked by IORA
// Assist / the capability registry and other apps — not user-facing, so they
// are not behind the management `guard`.
// ---------------------------------------------------------------------------
registerCapabilityRoutes(app, { store, runner });

// ---------------------------------------------------------------------------
// Static UI
// ---------------------------------------------------------------------------
app.use('/', express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Webhook event processing
// ---------------------------------------------------------------------------
async function handleWebhook(event, payload) {
  const mention = `@${config.botMention}`;
  const installationId = payload.installation?.id || config.githubDefaultInstallationId;
  const repo = payload.repository;

  // 1) Comments on a PR (issue_comment with pull_request) or review comments.
  if (
    (event === 'issue_comment' && payload.action === 'created' && payload.issue?.pull_request) ||
    (event === 'pull_request_review_comment' && payload.action === 'created')
  ) {
    const comment = payload.comment;
    if (!comment?.body || !mentionsBot(comment.body, mention)) return;
    if (comment.user?.type === 'Bot') return; // never react to ourselves

    const prNumber = payload.issue?.number || payload.pull_request?.number;
    let baseBranch = payload.pull_request?.base?.ref || 'main';
    let cloneUrl = repo.clone_url;
    if (!payload.pull_request?.base?.ref && installationId) {
      try {
        const [owner, name] = repo.full_name.split('/');
        const pr = await github.getPullRequest(installationId, owner, name, prNumber);
        baseBranch = pr.head?.ref || pr.base?.ref || baseBranch;
        cloneUrl = pr.head?.repo?.clone_url || cloneUrl;
      } catch (err) {
        log.warn('Could not fetch PR details, using defaults', { error: err.message });
      }
    } else if (payload.pull_request?.head?.ref) {
      baseBranch = payload.pull_request.head.ref;
    }

    await startGitHubTask({
      installationId,
      repo,
      prNumber,
      baseBranch,
      cloneUrl,
      prompt: stripMention(comment.body, mention),
      commentId: comment.id,
      requestedBy: comment.user?.login,
    });
    return;
  }

  // 2) PR opened/edited with the bot mentioned in the description.
  if (event === 'pull_request' && ['opened', 'edited'].includes(payload.action)) {
    const pr = payload.pull_request;
    if (!pr?.body || !mentionsBot(pr.body, mention)) return;
    await startGitHubTask({
      installationId,
      repo,
      prNumber: pr.number,
      baseBranch: pr.head?.ref || 'main',
      cloneUrl: pr.head?.repo?.clone_url || repo.clone_url,
      prompt: stripMention(pr.body, mention),
      commentId: null,
      requestedBy: pr.user?.login,
    });
  }
}

async function startGitHubTask(ctx) {
  const task = store.create({
    source: 'github',
    title: `PR #${ctx.prNumber} in ${ctx.repo.full_name}`,
    prompt: ctx.prompt,
    repoFullName: ctx.repo.full_name,
    cloneUrl: ctx.cloneUrl,
    baseBranch: ctx.baseBranch,
    provider: config.defaultProvider,
    model: config.defaultModel,
    installationId: ctx.installationId,
    prNumber: ctx.prNumber,
    commentId: ctx.commentId,
    requestedBy: ctx.requestedBy,
  });

  // Acknowledge on the PR with a reaction so the user sees we picked it up.
  if (ctx.installationId && ctx.commentId) {
    const [owner, name] = ctx.repo.full_name.split('/');
    await github.addReaction(ctx.installationId, owner, name, ctx.commentId, 'eyes');
  }

  log.info('Started GitHub-triggered task', { taskId: task.id, repo: ctx.repo.full_name, pr: ctx.prNumber });
  runner.enqueue(task);
}

function mentionsBot(text, mention) {
  const re = new RegExp(`(^|\\s)${escapeRegExp(mention)}(\\b|\\s|$)`, 'i');
  return re.test(text);
}

function stripMention(text, mention) {
  return text.replace(new RegExp(escapeRegExp(mention), 'ig'), '').trim();
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
const server = app.listen(config.port, () => {
  log.info(`ORA Coding Agent listening on :${config.port}`, {
    runnerMode: config.runnerMode,
    githubConfigured: config.isGitHubConfigured(),
  });
});

process.on('SIGTERM', () => {
  log.info('SIGTERM received, shutting down');
  server.close(() => process.exit(0));
});

module.exports = app;
