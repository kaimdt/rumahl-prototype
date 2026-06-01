'use strict';

/**
 * Centralised configuration loader.
 *
 * IORA injects app settings (from the manifest `settings_schema`) into the
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
  defaultModel: env('DEFAULT_MODEL', 'ora-default'),
  oraBaseUrl: env('ORA_BASE_URL', 'http://iora-assist:8092/v1'),
  oraApiKey: env('ORA_API_KEY', ''),
  anthropicApiKey: env('ANTHROPIC_API_KEY', ''),
  openaiApiKey: env('OPENAI_API_KEY', ''),
  googleApiKey: env('GOOGLE_API_KEY', ''),

  // Runner
  runnerMode: env('RUNNER_MODE', 'docker'),
  agentImage: env('AGENT_IMAGE', 'ora-coding-agent-runtime:latest'),
  agentTimeoutSeconds: intEnv('AGENT_TIMEOUT_SECONDS', 1800),
  maxConcurrentTasks: intEnv('MAX_CONCURRENT_TASKS', 2),

  // Optional simple bearer token to protect the UI/API when not behind the IORA gateway.
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
      out.ORA_BASE_URL = config.oraBaseUrl;
      if (config.oraApiKey) out.ORA_API_KEY = config.oraApiKey;
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

module.exports = config;
