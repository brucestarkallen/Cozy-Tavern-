/* M285: THE MODEL'S ROOM — ONE ANSWER FOR THE WHOLE HOUSE.
 * M289: the writer's number; else the size the provider reports for this very
 * model (providers/detect.js asks once, in the background); else the preset's.
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
  deepseek: 1000000, /* M289: DeepSeek V4 (Pro and Flash) holds a million; the 128k API was retired on 24 July 2026 */
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

/* M289: a size the provider reported belongs to one model at one address */
export function detectKey(conn) {
  return String((conn && conn.model) || '').trim() + '@' + String((conn && conn.baseUrl) || '').trim();
}
export function contextOf(conn) {
  if (conn && typeof conn.contextSize === 'number' && conn.contextSize > 0) return conn.contextSize;
  if (conn && Number(conn.detectedContext) > 0 && conn.detectedFor === detectKey(conn)) return Math.floor(conn.detectedContext);
  return PRESET_CONTEXT[presetIdFor(conn)] || UNKNOWN_CONTEXT;
}
/* M289: the size the provider reports for a model, under any of the names houses use */
export function reportedContext(m) {
  if (!m || typeof m !== 'object') return 0;
  const candidates = [m.context_length, m.max_model_len, m.context_window, m.max_context_length, m.max_input_tokens,
    m.inputTokenLimit, m.input_token_limit, m.contextLength, m.max_context_tokens,
    m.top_provider && m.top_provider.context_length, m.limits && m.limits.context, m.limit && m.limit.context];
  for (const c of candidates) { const n = Number(c); if (Number.isFinite(n) && n >= 1000) return Math.floor(n); }
  return 0;
}

