'use strict';

const log = require('./log');

/**
 * Centralised configuration loader.
 *
 * rumahl injects app settings (from the manifest `settings_schema`) into the
 * container environment using UPPER_SNAKE_CASE keys. To stay portable we read
 * each setting from the environment and fall back to sensible defaults.
 */

function env(key, fallback) {
  const value = process.env[key];
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return value;
}

function intEnv(key, fallback) {
  const raw = env(key, undefined);
  if (raw === undefined) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

const config = {
  port: intEnv('PORT', 3000),
  dataDir: env('DATA_DIR', '/app/data'),

  // Trigger
  botMention: env('BOT_MENTION', 'ora').replace(/^@/, '').toLowerCase(),

  // GitHub App
  githubAppId: env('GITHUB_APP_ID', undefined),
  githubAppPrivateKey: normalizePem(env('GITHUB_APP_PRIVATE_KEY', undefined)),
  githubWebhookSecret: env('GITHUB_WEBHOOK_SECRET', undefined),
  githubDefaultInstallationId: env('GITHUB_DEFAULT_INSTALLATION_ID', undefined),

  // Providers
  defaultProvider: env('DEFAULT_PROVIDER', 'ora'),
  defaultModel: env('DEFAULT_MODEL', 'rumahl-default'),
  oraBaseUrl: env('RUMAHL_BASE_URL', 'http://rumahl-assist:8092/v1'),
  oraApiKey: env('RUMAHL_API_KEY', ''),
  anthropicApiKey: env('ANTHROPIC_API_KEY', ''),
  openaiApiKey: env('OPENAI_API_KEY', ''),
  googleApiKey: env('GOOGLE_API_KEY', ''),

  // Runner
  runnerMode: env('RUNNER_MODE', 'docker'),
  agentImage: env('AGENT_IMAGE', 'rumahl-coding-agent-runtime:latest'),
  agentTimeoutSeconds: intEnv('AGENT_TIMEOUT_SECONDS', 1800),
  maxConcurrentTasks: intEnv('MAX_CONCURRENT_TASKS', 2),

  // Incremental commits: commit after each logical change step so individual
  // changes can be rolled back independently.
  incrementalCommits: env('INCREMENTAL_COMMITS', 'true') === 'true',
  incrementalCommitInterval: intEnv('INCREMENTAL_COMMIT_INTERVAL', 10),

  // Prompt optimizer: pre-process the user prompt with a lighter model before
  // passing it to the main agent model.
  promptOptimizerEnabled: env('PROMPT_OPTIMIZER_ENABLED', 'false') === 'true',
  promptOptimizerModel: env('PROMPT_OPTIMIZER_MODEL', 'rumahl-default'),
  promptOptimizerProvider: env('PROMPT_OPTIMIZER_PROVIDER', ''),

  // pi extensions: comma-separated list of pi.dev extension packages to load.
  // Supported: pi-context-tools (context management), pi-codex-goal (workflow tracking).
  // Empty = no additional extensions beyond the rumahl Assist provider extension.
  piExtensions: (env('PI_EXTENSIONS', '') || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),

  // Optional simple bearer token to protect the UI/API when not behind the rumahl gateway.
  apiToken: env('APP_API_TOKEN', undefined),
};

/**
 * Settings dialogs sometimes store PEM keys with escaped newlines ("\n").
 * Restore real newlines so the JWT signer accepts the key.
 */
function normalizePem(value) {
  if (!value) return value;
  if (value.includes('\\n')) {
    return value.replace(/\\n/g, '\n');
  }
  return value;
}

config.providerEnvForRun = function providerEnvForRun(provider) {
  const out = {};
  switch (provider) {
    case 'ora':
      out.RUMAHL_BASE_URL = config.oraBaseUrl;
      if (config.oraApiKey) out.RUMAHL_API_KEY = config.oraApiKey;
      break;
    case 'anthropic':
      if (config.anthropicApiKey) out.ANTHROPIC_API_KEY = config.anthropicApiKey;
      break;
    case 'openai':
      if (config.openaiApiKey) out.OPENAI_API_KEY = config.openaiApiKey;
      break;
    case 'google':
      if (config.googleApiKey) out.GEMINI_API_KEY = config.googleApiKey;
      break;
    default:
      break;
  }
  return out;
};

config.isGitHubConfigured = function isGitHubConfigured() {
  return Boolean(config.githubAppId && config.githubAppPrivateKey && config.githubWebhookSecret);
};

// ── Dynamic provider & model discovery ──────────────────────────────────

const ASSIST_BASE = config.oraBaseUrl.replace(/\/v1\/?$/, '');
let _providerCache = null;
let _modelCache = null;
let _cacheExpiry = 0;
const CACHE_TTL_MS = 60_000; // 1 minute

/** Fetch JSON from a URL with timeout. Returns null on any error. */
async function fetchJson(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Return the known provider list (fallback hardcoded set). */
config.getAvailableProviders = function getAvailableProviders() {
  // Always include the known providers; the dynamic fetch enriches later.
  return [
    { id: 'ora', label: 'rumahl Assist (rumahl AI)', enabled: true },
    { id: 'anthropic', label: 'Anthropic (Claude)', enabled: true },
    { id: 'openai', label: 'OpenAI', enabled: true },
    { id: 'google', label: 'Google Gemini', enabled: true },
  ];
};

/** Fetch the live provider list from rumahl-assist. */
config.fetchProvidersFromAssist = async function fetchProvidersFromAssist() {
  const now = Date.now();
  if (_providerCache && now < _cacheExpiry) return _providerCache;

  const data = await fetchJson(`${ASSIST_BASE}/api/assist/config/providers`);
  if (data && data.success && Array.isArray(data.providers)) {
    _providerCache = data.providers;
    _cacheExpiry = now + CACHE_TTL_MS;
  }
  return _providerCache || config.getAvailableProviders();
};

/** Fetch models for a specific provider from rumahl-assist. */
config.fetchModelsForProvider = async function fetchModelsForProvider(providerId) {
  const data = await fetchJson(`${ASSIST_BASE}/api/assist/models`);
  if (data && data.success && Array.isArray(data.providers)) {
    const match = data.providers.find(
      (p) => p.provider_type === providerId || p.provider_id === providerId
    );
    return match ? match.models || [] : [];
  }
  return [];
};

/**
 * Fetch ALL models grouped by provider, with deduplication for models that
 * appear under multiple providers (e.g. gpt-4o via both openai and ora).
 * Returns { providers: [...], models: [...], duplicates: {...} }
 */
config.fetchAllModelsGrouped = async function fetchAllModelsGrouped() {
  const now = Date.now();
  if (_modelCache && now < _cacheExpiry) return _modelCache;

  const data = await fetchJson(`${ASSIST_BASE}/api/assist/models`);
  if (!data || !data.success) {
    return { providers: [], models: [], duplicates: {} };
  }

  // Build model → provider list map for deduplication
  const modelProviders = new Map(); // modelId → Set<providerId>
  const providers = [];

  for (const p of data.providers || []) {
    providers.push({
      providerId: p.provider_id,
      providerType: p.provider_type,
      purpose: p.purpose,
      enabled: p.enabled,
      modelCount: (p.models || []).length,
    });
    for (const m of p.models || []) {
      if (!modelProviders.has(m.id)) {
        modelProviders.set(m.id, new Set());
      }
      modelProviders.get(m.id).add(p.provider_type);
    }
  }

  // Collect all unique models with their providers
  const models = [];
  const duplicates = {};
  for (const p of data.providers || []) {
    for (const m of p.models || []) {
      const providerSet = modelProviders.get(m.id);
      const providerList = providerSet ? Array.from(providerSet) : [p.provider_type];
      models.push({
        id: m.id,
        name: m.name || m.id,
        provider: p.provider_type,
        availableVia: providerList,
        isDuplicate: providerList.length > 1,
      });
    }
  }

  // Build duplicate map: modelId → [providerId, ...]
  for (const [modelId, providerSet] of modelProviders) {
    const list = Array.from(providerSet);
    if (list.length > 1) {
      duplicates[modelId] = list;
    }
  }

  _modelCache = { providers, models, duplicates, total: models.length };
  _cacheExpiry = now + CACHE_TTL_MS;
  return _modelCache;
};

// ── Prompt Optimizer ─────────────────────────────────────────────────────

const OPTIMIZER_SYSTEM_PROMPT = [
  'You are a prompt optimizer for coding agents. Your task is to take a user request and rewrite it into a clear, structured, technical prompt optimized for a code-generating AI.',
  '',
  'Guidelines:',
  '- Preserve ALL technical requirements, file paths, and constraints from the original.',
  '- Add structure: use bullet points for multi-step tasks, specify target files clearly.',
  '- Remove ambiguous language and replace with precise technical terms.',
  '- Keep the same language as the original prompt.',
  '- Do NOT add requirements or features the user did not ask for.',
  '- Do NOT explain what you changed. Output ONLY the optimized prompt text.',
  '',
  'Output format: Just the optimized prompt, nothing else.',
].join('\n');

/**
 * Optimize the user prompt via a lightweight model before passing it to
 * the main agent. Returns the optimized prompt, or the original on failure.
 */
config.optimizePrompt = async function optimizePrompt(originalPrompt, mainProvider, mainModel) {
  if (!config.promptOptimizerEnabled) return originalPrompt;
  if (!originalPrompt || originalPrompt.trim().length < 10) return originalPrompt;

  const optimizerProvider = config.promptOptimizerProvider || mainProvider || 'ora';
  const optimizerModel = config.promptOptimizerModel || 'rumahl-default';

  // Build the API endpoint for the optimizer
  const baseUrl = ASSIST_BASE;
  const endpoint = `${baseUrl}/v1/chat/completions`;

  // Resolve API key for the optimizer provider
  let apiKey = '';
  switch (optimizerProvider) {
    case 'ora': apiKey = config.oraApiKey; break;
    case 'openai': apiKey = config.openaiApiKey; break;
    case 'anthropic': apiKey = config.anthropicApiKey; break;
    case 'google': apiKey = config.googleApiKey; break;
  }

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const body = JSON.stringify({
    model: optimizerModel,
    messages: [
      { role: 'system', content: OPTIMIZER_SYSTEM_PROMPT },
      { role: 'user', content: originalPrompt },
    ],
    temperature: 0.3,
    max_tokens: 2000,
  });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      log.warn('Prompt optimizer API returned', { status: resp.status });
      return originalPrompt;
    }

    const data = await resp.json();
    const optimized = data?.choices?.[0]?.message?.content?.trim();
    if (optimized && optimized.length > 5) {
      log.info('Prompt optimized', {
        originalLen: originalPrompt.length,
        optimizedLen: optimized.length,
      });
      return optimized;
    }
  } catch (err) {
    log.warn('Prompt optimization failed, using original', { error: err.message });
  }

  return originalPrompt;
};

module.exports = config;
