// rumahl AI provider extension for the pi coding agent.
//
// Registers a "ora" provider that points at rumahl Assist's OpenAI-compatible
// endpoint. This is what bridges pi to rumahl AI. External providers (anthropic,
// openai, google, ...) are handled by pi natively via their env-var API keys.
//
// Loaded with: pi -e /opt/rumahl/rumahl-provider.ts --provider ora --model <id>
//
// Env:
//   RUMAHL_BASE_URL  OpenAI-compatible base URL of rumahl Assist (e.g. http://rumahl-assist:8092/v1)
//   RUMAHL_API_KEY   API key for that endpoint (optional)
//   PI_MODEL      model id to expose (defaults to "rumahl-default")

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function (pi: ExtensionAPI) {
  const baseUrl = process.env.RUMAHL_BASE_URL || 'http://rumahl-assist:8092/v1';
  const modelId = process.env.PI_MODEL || 'rumahl-default';

  pi.registerProvider('ora', {
    name: 'rumahl Assist (rumahl AI)',
    baseUrl,
    // $RUMAHL_API_KEY is interpolated by pi from the environment. "public" is used
    // when the endpoint requires no key (pi still expects a value).
    apiKey: process.env.RUMAHL_API_KEY ? '$RUMAHL_API_KEY' : 'public',
    api: 'openai-completions',
    models: [
      {
        id: modelId,
        name: 'rumahl AI',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192,
      },
    ],
  });
}
