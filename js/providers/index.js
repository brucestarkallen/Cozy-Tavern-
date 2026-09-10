/* Cozy Tavern — providers/index.js
 * The registry and factory. One interface for every storyteller:
 *   createProvider(connection) -> {
 *     test(): Promise<{ok, detail}>,
 *     listModels(): Promise<[{id, label}]>,
 *     streamChat({systemBlocks|system, messages, signal, onToken})
 *       : Promise<{text, thinking, ttftMs, tfftMs, durationMs}>
 *   }
 * onToken receives {channel:'thinking'|'prose', text} (M8.5 — the
 * reasoning channel; M1's contract silently dropped thinking).
 * `systemBlocks` is the M2 assembler's shape ([{text, cache}]); the M1
 * plain-string `system` is still accepted. Presets feed the connection form
 * in Settings; each is just a starting point the user can edit.
 */

import { createAnthropicProvider } from './anthropic.js';
import { createOpenAIProvider } from './openai.js';

/* M22-B: the presets align with the proven set from the Cozy Chat study —
 * each carries the full address, a sample model, the model's room (context
 * size, feeding the ember bar), and the hint text under the model field.
 * Each is just a starting point the user can edit. */
export const PRESETS = [
  {
    id: 'claude',
    label: 'Claude',
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-6',
    contextSize: 200000,
    hint: 'e.g. claude-sonnet-4-6, claude-opus-4-5',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    contextSize: 128000,
    hint: 'e.g. gpt-4o, gpt-4o-mini',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    type: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: '',
    contextSize: 128000,
    hint: 'e.g. anthropic/claude-sonnet-4-6',
  },
  {
    id: 'zai',
    label: 'Z.ai GLM',
    type: 'openai',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    model: 'glm-4.6',
    contextSize: 200000,
    hint: 'e.g. glm-4.6, glm-4.5-air',
  },
  {
    id: 'google',
    label: 'Gemini',
    type: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-pro',
    contextSize: 1000000,
    hint: 'e.g. gemini-2.5-pro, gemini-2.5-flash',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    type: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    contextSize: 128000,
    hint: 'e.g. deepseek-chat, deepseek-reasoner',
  },
  {
    id: 'hermes',
    label: 'Hermes Agent',
    type: 'openai',
    baseUrl: 'http://127.0.0.1:8642/v1',
    model: 'hermes-agent',
    contextSize: 200000,
    hint: 'hermes-agent — or a profile’s name',
  },
  {
    id: 'custom',
    label: 'Custom',
    type: 'openai',
    baseUrl: '',
    model: '',
    contextSize: 128000,
    hint: 'Whatever the endpoint calls it',
  },
];

export function presetById(id) {
  return PRESETS.find((p) => p.id === id) || PRESETS[PRESETS.length - 1];
}

/* ---------- address normalization (M22-B, the SillyTavern courtesy) ----------
 * Strip trailing slashes; when the host is a known openai-compatible API
 * shape and the path carries no version segment (/v1, /v4, /v1beta…),
 * append /v1 — so "https://api.openai.com" and "https://openrouter.ai/api"
 * both land on the address that house actually listens at. Custom addresses
 * are never touched: only a host we recognize earns the courtesy. */
export const KNOWN_V1_HOSTS = [
  'api.openai.com',
  'openrouter.ai',
  'api.deepseek.com',
  'api.moonshot.cn',
  'api.moonshot.ai',
  'generativelanguage.googleapis.com',
];

export function normalizeBaseUrl(raw) {
  const trimmed = String(raw == null ? '' : raw).trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  let u;
  try {
    u = new URL(trimmed);
  } catch (err) {
    return trimmed; // not a URL we can read — kept exactly as typed
  }
  const known = KNOWN_V1_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
  if (known && !/\/v\d/i.test(u.pathname)) {
    return trimmed + '/v1';
  }
  return trimmed;
}

/* Whether the typed address would change under normalizeBaseUrl — the
 * form's "add /v1" one-tap offers itself only then, and only for
 * openai-compatible connections (Claude's address is left as-is). */
export function wouldNormalize(raw) {
  return normalizeBaseUrl(raw) !== String(raw == null ? '' : raw).trim().replace(/\/+$/, '');
}

export function createProvider(connection) {
  if (!connection) {
    throw new Error('There’s no connection chosen yet. Add one in Settings first.');
  }
  if (connection.type === 'anthropic') return createAnthropicProvider(connection);
  if (connection.type === 'openai') return createOpenAIProvider(connection);
  throw new Error(`“${connection.type}” isn’t a storyteller we know how to call.`);
}
