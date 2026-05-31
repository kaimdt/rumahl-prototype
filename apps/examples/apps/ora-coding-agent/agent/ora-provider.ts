// ORA AI provider extension for the pi coding agent.
//
// Registers a "ora" provider that points at IORA Assist's OpenAI-compatible
// endpoint. This is what bridges pi to ORA AI. External providers (anthropic,
// openai, google, ...) are handled by pi natively via their env-var API keys.
//
// Loaded with: pi -e /opt/ora/ora-provider.ts --provider ora --model <id>
//
// Env:
//   ORA_BASE_URL  OpenAI-compatible base URL of IORA Assist (e.g. http://iora-assist:8092/v1)
//   ORA_API_KEY   API key for that endpoint (optional)
//   PI_MODEL      model id to expose (defaults to "ora-default")

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function (pi: ExtensionAPI) {
  const baseUrl = process.env.ORA_BASE_URL || 'http://iora-assist:8092/v1';
  const modelId = process.env.PI_MODEL || 'ora-default';

  pi.registerProvider('ora', {
    name: 'IORA Assist (ORA AI)',
    baseUrl,
    // $ORA_API_KEY is interpolated by pi from the environment. "public" is used
    // when the endpoint requires no key (pi still expects a value).
    apiKey: process.env.ORA_API_KEY ? '$ORA_API_KEY' : 'public',
    api: 'openai-completions',
    models: [
      {
        id: modelId,
        name: 'ORA AI',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192,
      },
    ],
  });
}
