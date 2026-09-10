/* Cozy Tavern — providers/effort.js
 * M22-A: the full reasoning ladder, ported from the Cozy Chat study
 * (mechanics, not the file). Each house spells "think harder" differently,
 * and sending the wrong shape is silently ignored (or 400s), so the level is
 * resolved explicitly per connection — and a level a provider can't name is
 * spoken as the nearest one below it, never a name the endpoint rejects.
 *
 * Also home to the rejection-memory patterns (a 400 that cites the
 * reasoning or prefill params marks the connection and the turn is retried
 * once without them — see the providers) and the storyteller prefill
 * mechanics (M22-D).
 */

/* The ladder above "high" exists now, spelled differently everywhere:
 * Anthropic's adaptive thinking and the newer OpenAI models add xhigh and
 * max, GLM tops out at max and rejects the names between, OpenRouter takes
 * the whole ladder and maps it down per model. */
export const EFFORT_RANK = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];

export const EFFORT_LEVELS = {
  anthropic: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
  openai: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
  openrouter: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
  zai: ['off', 'low', 'high', 'max'],
  qwen: ['off', 'low', 'medium', 'high'],
  hermes: ['off', 'low', 'medium', 'high'],
  /* M37: DeepSeek's current API — thinking:{type:enabled|disabled} plus
   * reasoning_effort low|high|max; medium and xhigh alias down/up. */
  deepseek: ['off', 'low', 'high', 'max'],
  none: ['off', 'low', 'medium', 'high'],
};

/* A stored level a house has no name for lands where the service itself
 * puts it, or on the nearest level below: GLM maps xhigh to max and medium
 * to high on its own side, so saying so here changes nothing it would have
 * done — while sending it "xhigh" verbatim is a request it rejects. */
export const EFFORT_ALIAS = { zai: { medium: 'high', xhigh: 'max' }, deepseek: { medium: 'high', xhigh: 'max' } };

export function effortLabel(l) {
  return l === 'off' ? 'Off' : l === 'xhigh' ? 'XHigh' : l.charAt(0).toUpperCase() + l.slice(1);
}

/* Which spelling of "think harder" this connection speaks. Read off the
 * saved preset first (the form stores it, M22), then off the address and
 * model name for connections that predate the marker. */
export function reasonStyle(conn) {
  const c = conn || {};
  if (c.type === 'anthropic') return 'anthropic';
  const url = String(c.baseUrl || '').toLowerCase();
  const model = String(c.model || '').toLowerCase();
  if (c.preset === 'hermes' || model === 'hermes-agent') return 'hermes';
  if (c.preset === 'openrouter' || url.includes('openrouter.ai')) return 'openrouter';
  if (c.preset === 'zai' || url.includes('api.z.ai') || /\bglm\b|^glm|glm-/.test(model)) return 'zai';
  if (/qwen/.test(model)) return 'qwen';
  /* M37: DeepSeek thinks by default (at high) and is told not to with
   * thinking:{type:'disabled'} — "decides for itself" left the workers
   * thinking their whole budget away. */
  if (c.preset === 'deepseek' || url.includes('deepseek') || /^deepseek/.test(model)) return 'deepseek';
  return 'openai';
}

/* The effort this connection can actually SAY: alias-down first (a level
 * the house itself maps), then nearest-below within the style's levels;
 * `cap` is a rung the wire itself refused (rejection memory) and nothing
 * above it is ever spoken again for that connection. */
export function effortFor(style, eff, cap) {
  const lv = EFFORT_LEVELS[style] || EFFORT_LEVELS.openai;
  const e = (EFFORT_ALIAS[style] && EFFORT_ALIAS[style][eff]) || eff;
  let r = EFFORT_RANK.indexOf(e);
  if (r < 0) r = 0;
  const cr = cap ? EFFORT_RANK.indexOf(cap) : -1;
  if (cr >= 0 && r > cr) r = cr;
  while (r > 0 && lv.indexOf(EFFORT_RANK[r]) < 0) r--;
  return lv.indexOf(EFFORT_RANK[r]) >= 0 ? EFFORT_RANK[r] : 'off';
}

/* One rung down within what the style can say; null at low — a refusal
 * there is not a level problem. */
export function effortStepDown(style, level) {
  const lv = EFFORT_LEVELS[style] || EFFORT_LEVELS.openai;
  for (let k = EFFORT_RANK.indexOf(level) - 1; k > 0; k--) {
    if (lv.indexOf(EFFORT_RANK[k]) >= 0) return EFFORT_RANK[k];
  }
  return null;
}

/* The token room each effort gives when a fixed budget is what the house
 * understands (the connection's optional "thinking room" dial overrides). */
export const EFFORT_BUDGETS = { low: 2048, medium: 8192, high: 24576, xhigh: 49152, max: 98304 };

/* The rejection-memory patterns. A 400 whose message cites the thinking
 * params means this endpoint won't carry them; one that cites the prefill
 * means it won't take a reply that has already started. The refusal itself
 * is the signal — model names can't say what's really behind an address. */
export const REASONING_REFUSAL = /reasoning|effort|thinking|budget_tokens|enable_thinking/i;
export const PREFILL_REFUSAL = /assistant message prefill|must end with a user message|prefix|partial/i;

/* Mark the refusal memory on the stored connection (reasoningDownAt /
 * prefillDownAt) and on the live copy, so this session spends no second
 * request on it either. The mark stands until the model field changes —
 * the settings form clears it then. Never throws: the turn's outcome is
 * already decided by the retry, the memory is a courtesy. */
import { db } from '../store.js';

export async function markConnectionDown(conn, field) {
  if (!conn || !conn.id) return false;
  const first = !conn[field];
  conn[field] = Date.now();
  try {
    await db.connections.update(conn.id, { [field]: conn[field] });
  } catch (err) { /* a memory that won't persist is no reason to fail */ }
  return first;
}

/* ---------- the storyteller prefill (M22-D) ----------
 * "Start the reply for it": a trailing assistant turn that opens the
 * answer. Anthropic takes the turn natively; the openai-compatible houses
 * each have their own flag — Moonshot partial:true, DeepSeek prefix:true —
 * and a generic endpoint only ever carries the prefill as reasoning_content
 * when the prefill itself already carries reasoning (a <think>…</think>
 * span); anything else is skipped with a kind note rather than gambled on
 * the wire. */

export const PREFILL_PROFILES = {
  anthropic: { label: 'Claude', flagField: '' },
  moonshot: { label: 'Moonshot / Kimi', flagField: 'partial' },
  deepseek: { label: 'DeepSeek (beta prefix)', flagField: 'prefix' },
  generic: { label: 'Anything OpenAI-compatible', flagField: '' },
};

export function prefillProfile(conn) {
  const c = conn || {};
  if (c.type === 'anthropic') return 'anthropic';
  const url = String(c.baseUrl || '').toLowerCase();
  if (url.includes('moonshot')) return 'moonshot';
  if (url.includes('deepseek')) return 'deepseek';
  return 'generic';
}

const THINK_SPAN = /^\s*<think>([\s\S]*?)<\/think>\s*/;

/* Apply the prefill to a FINISHED wire message list (a copy — the caller's
 * list is never touched). Returns {messages, applied, note?}: applied=false
 * means the request goes out exactly as assembled, with `note` saying why
 * in warm words when there's something worth saying. */
export function applyPrefill(messages, conn) {
  const list = (Array.isArray(messages) ? messages : []).map((m) => ({ ...m }));
  const text = String(conn && conn.prefill != null ? conn.prefill : '');
  if (!text.trim()) return { messages: list, applied: false };
  if (conn && conn.prefillDownAt) {
    return {
      messages: list,
      applied: false,
      note: 'This connection once refused a started reply, so it isn’t offered one. Change the model (or re-save the connection) to try again.',
    };
  }
  if (!list.length) return { messages: list, applied: false };
  const profile = prefillProfile(conn);
  const trimmed = text.replace(/\s+$/, ''); // a trailing space is refused by some houses
  if (profile === 'anthropic') {
    list.push({ role: 'assistant', content: trimmed });
    return { messages: list, applied: true };
  }
  const flag = PREFILL_PROFILES[profile].flagField;
  if (flag) {
    const msg = { role: 'assistant', content: trimmed };
    msg[flag] = true;
    list.push(msg);
    return { messages: list, applied: true };
  }
  /* generic: the prefill rides as reasoning_content only when it already
   * carries reasoning; otherwise it stays home, with a kind note. */
  const think = trimmed.match(THINK_SPAN);
  if (think) {
    const msg = { role: 'assistant', content: trimmed.slice(think[0].length) };
    msg.reasoning_content = think[1];
    list.push(msg);
    return { messages: list, applied: true };
  }
  return {
    messages: list,
    applied: false,
    note: 'This address has no known way to start the reply for it — the prefill stayed home. (A <think>…</think> prefill rides as reasoning.)',
  };
}

/* M37: real OpenAI never takes a `thinking` block; every other openai-shaped
 * house either honors it or ignores it (a 400 that names it marks the
 * connection down and the turn is retried without, as before). */
export function hostIsOpenAI(baseUrl) {
  return /(^|\/\/)api\.openai\.com(\/|$)/i.test(String(baseUrl || ''));
}
