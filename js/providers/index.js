/* Cozy Tavern — providers/index.js
 * The registry and factory. One interface for every storyteller:
 *   createProvider(connection) -> {
 *     test(): Promise<{ok, detail}>,
 *     streamChat({system, messages, signal, onToken}): Promise<string>
 *   }
 * Presets feed the connection form in Settings; each is just a starting
 * point the user can edit.
 */

import { createAnthropicProvider } from './anthropic.js';
import { createOpenAIProvider } from './openai.js';

export const PRESETS = [
  {
    id: 'claude',
    label: 'Claude',
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    type: 'openai',
    baseUrl: 'https://api.openai.com',
    model: 'gpt-4o-mini',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    type: 'openai',
    /* the provider appends /v1/chat/completions */
    baseUrl: 'https://openrouter.ai/api',
    model: 'anthropic/claude-sonnet-4.5',
  },
  {
    id: 'custom',
    label: 'Custom',
    type: 'openai',
    baseUrl: '',
    model: '',
  },
];

export function presetById(id) {
  return PRESETS.find((p) => p.id === id) || PRESETS[PRESETS.length - 1];
}

export function createProvider(connection) {
  if (!connection) {
    throw new Error('There’s no connection chosen yet. Add one in Settings first.');
  }
  if (connection.type === 'anthropic') return createAnthropicProvider(connection);
  if (connection.type === 'openai') return createOpenAIProvider(connection);
  throw new Error(`“${connection.type}” isn’t a storyteller we know how to call.`);
}
