/* M285: THE MODEL'S ROOM — ONE ANSWER FOR THE WHOLE HOUSE.
 *
 * A connection's "The model's room, in tokens" is how much the model can
 * hold. Left empty, the storyteller took 200,000 for every provider and the
 * workers 128,000 — two answers, and neither was the provider's: a DeepSeek
 * connection (128,000) was planned for 200,000. Now: the writer's number if
 * he set one; else the number of the preset the connection came from; else
 * 128,000. No imports, so every part of the house can ask it.
 * (tests/harness/m259.mjs holds this table to PRESETS in providers/index.js.) */
export const PRESET_CONTEXT = {
  claude: 200000,
  openai: 128000,
  openrouter: 128000,
  zai: 200000,
  google: 1000000,
  deepseek: 128000,
  hermes: 200000,
  custom: 128000,
};
export const UNKNOWN_CONTEXT = 128000;

/* Which preset a saved connection comes from — the one it was made from, else
 * by its kind and its address. */
export function presetIdFor(conn) {
  if (!conn || typeof conn !== 'object') return 'custom';
  if (conn.preset && typeof conn.preset === 'string') return conn.preset;
  if (conn.type === 'anthropic') return 'claude';
  const base = String(conn.baseUrl || '').toLowerCase();
  if (base.includes('openrouter.ai')) return 'openrouter';
  if (base.includes('api.openai.com')) return 'openai';
  if (base.includes('api.z.ai')) return 'zai';
  if (base.includes('generativelanguage.googleapis.com')) return 'google';
  if (base.includes('api.deepseek.com')) return 'deepseek';
  if (base.includes('127.0.0.1:8642')) return 'hermes';
  return 'custom';
}

export function contextOf(conn) {
  if (conn && typeof conn.contextSize === 'number' && conn.contextSize > 0) return conn.contextSize;
  return PRESET_CONTEXT[presetIdFor(conn)] || UNKNOWN_CONTEXT;
}
