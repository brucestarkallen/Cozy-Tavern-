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
  /* M303: Kimi K3 (platform.kimi.ai → "Thinking Effort", "Model Parameter
   * Reference"): it ALWAYS thinks — there is no off — and its one dial is the
   * top-level reasoning_effort, low | high | max, max when omitted. */
  kimi: ['low', 'high', 'max'],
  /* M303: the K2.x models on Moonshot's own address: thinking is a switch
   * (thinking:{type}) and reasoning_effort is "Not supported". Every level
   * above off is the same "on". */
  kimi2: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
  none: ['off', 'low', 'medium', 'high'],
};

/* A stored level a house has no name for lands where the service itself
 * puts it, or on the nearest level below: GLM maps xhigh to max and medium
 * to high on its own side, so saying so here changes nothing it would have
 * done — while sending it "xhigh" verbatim is a request it rejects. */
export const EFFORT_ALIAS = {
  zai: { medium: 'high', xhigh: 'max' },
  deepseek: { medium: 'high', xhigh: 'max' },
  /* M303: K3 cannot be told not to think, so "off" is the LEAST it can do —
   * sending nothing would be its default, max: minutes of thinking for a
   * writer who asked for none. */
  kimi: { off: 'low', medium: 'high', xhigh: 'max' },
};

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
  /* M303: THE KIMI FAMILY HAD NO SPELLING OF ITS OWN. A Moonshot address fell
   * to the generic shape, so every request to kimi-k3 carried the K2.x
   * `thinking` block — a field Moonshot's docs say K3 "does not support"
   * ("remove the K2.x thinking configuration") — beside a reasoning_effort
   * that could be "medium" or "xhigh", which are not K3 levels; and a 400
   * that named the block set the refusal memory, after which NOTHING was
   * sent and K3 fell to its default, max, whatever the writer had chosen.
   * K3 (and whatever follows it) is read off the model's name on any
   * openai-shaped address but OpenRouter's, which maps its own; the K2.x
   * switch only on Moonshot's own address, where its fields are known. */
  const kimiHost = url.includes('moonshot') || /(^|[/.])kimi\.(ai|com)([/:]|$)/.test(url);
  if (/kimi[-_.]?k[3-9]/.test(model) || (kimiHost && /^k[3-9]\b/.test(model))) return 'kimi';
  if (kimiHost && /^kimi/.test(model)) return /k2\.?7-code/.test(model) ? 'none' : 'kimi2';
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

export async function markConnectionDown(conn, field, shape) {
  if (!conn || !conn.id) return false;
  const first = !conn[field];
  conn[field] = Date.now();
  const patch = { [field]: conn[field] };
  /* M303: the thinking refusal remembers WHICH spelling was refused */
  if (field === 'reasoningDownAt' && typeof shape === 'string' && shape) { conn.reasoningDownShape = shape; patch.reasoningDownShape = shape; }
  if (field === 'prefillDownAt' && typeof shape === 'string' && shape) { conn.prefillDownShape = shape; patch.prefillDownShape = shape; } /* M307: which address refused it */
  try {
    await db.connections.update(conn.id, patch);
  } catch (err) { /* a memory that won't persist is no reason to fail */ }
  return first;
}

/* M303: A REFUSAL IS REMEMBERED FOR THE SPELLING THAT WAS REFUSED. The mark
 * used to silence a connection's thinking settings "until the model
 * changes" — so a connection the wire refused because THE HOUSE spelled it
 * wrong (Kimi K3, sent the K2.x `thinking` block) stayed silenced after the
 * house learned the right spelling, and silence is max for K3. A mark made
 * before shapes were kept belongs to the spelling the connection had then:
 * its own, unless this release gave it a new one (the Kimi family spoke the
 * generic shape). */
export function reasoningIsDown(conn, style) {
  if (!conn || !conn.reasoningDownAt) return false;
  const was = typeof conn.reasoningDownShape === 'string' && conn.reasoningDownShape
    ? conn.reasoningDownShape
    : (style === 'kimi' || style === 'kimi2' ? 'openai' : style);
  return was === style;
}
/* a mark that no longer applies is let go for good — the card in Settings and
 * every other browser stop saying "unsent". Never throws. */
export async function healStaleRefusal(conn, style) {
  if (!conn || !conn.reasoningDownAt || reasoningIsDown(conn, style)) return false;
  delete conn.reasoningDownAt;
  delete conn.reasoningDownShape;
  if (conn.id) { try { await db.connections.update(conn.id, { reasoningDownAt: null, reasoningDownShape: null }); } catch (err) { /* let go in hand; tried again next turn */ } }
  return true;
}

/* M303: what the chosen level is SPOKEN as on this connection's wire, in
 * words — for the connection's card and its form. Pure. */
export function spokenAs(conn, effort) {
  const style = reasonStyle(conn);
  const want = EFFORT_RANK.includes(effort) ? effort : 'off';
  if (style === 'none') return 'nothing is sent — this model decides for itself';
  if (style === 'kimi2' || style === 'qwen') return want === 'off' ? 'thinking switched off' : 'thinking switched on (this model has no levels)';
  const said = effortFor(style, want);
  if (style === 'kimi' && want === 'off') return `“${said}” — Kimi K3 always thinks; this is the least it can`;
  return said === 'off' ? 'off' : `“${said}”`;
}
/* M308: THE THINKING ROOM IS A NUMBER ONLY TWO HOUSES CAN HEAR. "Thinking room, in
 * tokens" was read in exactly two places — Claude (thinking.budget_tokens) and
 * OpenRouter (reasoning.max_tokens) — and silently dropped everywhere else, so
 * the writer typed 512 on a Kimi connection, watched it think as long as ever,
 * and had no way to know the number had gone nowhere: Moonshot, DeepSeek, Z.ai
 * and the rest have LEVELS and no budget at all. And on OpenRouter the number
 * REPLACED his level ("one of the following, not both") for every model —
 * though OpenRouter's own docs give a real budget only to Anthropic and
 * Gemini models and say that for the rest "the max_tokens value will be used
 * to determine the effort level": the level he chose was thrown away for one
 * of OpenRouter's choosing. Now: a budget is sent only where a house can
 * hear it; everywhere else his LEVEL is sent, and the form says which.
 *   budgetFor(conn) → { sent, tokens, words }   (pure) */
export const CLAUDE_BUDGET_FLOOR = 1024; /* Anthropic refuses less — and that 400 names "budget_tokens", which the refusal memory would read as "this house takes no thinking" and switch it off */
export function budgetFor(conn) {
  const c = conn || {};
  const r = c.reasoning && typeof c.reasoning === 'object' ? c.reasoning : {};
  const asked = typeof r.budgetTokens === 'number' && r.budgetTokens > 0 ? Math.round(r.budgetTokens) : 0;
  const model = String(c.model || '').toLowerCase();
  const url = String(c.baseUrl || '').toLowerCase();
  if (c.type === 'anthropic') {
    if (/deepseek/.test(url + ' ' + model)) return { sent: false, tokens: 0, words: 'DeepSeek has thinking LEVELS and no thinking room — a number here is never sent; the level above is.' };
    const tokens = asked ? Math.max(CLAUDE_BUDGET_FLOOR, asked) : 0;
    return { sent: Boolean(tokens), tokens, words: 'Claude takes a thinking room (no less than 1,024 tokens — a smaller number is sent as 1,024). Set, it replaces the level above; empty, the level decides.' };
  }
  if (reasonStyle(c) === 'openrouter') {
    const takes = /^(anthropic|google)\//.test(model);
    if (takes) return { sent: Boolean(asked), tokens: asked, words: 'Through OpenRouter this model takes a thinking room (OpenRouter keeps it between 1,024 and 32,000). Set, it replaces the level above; empty, the level decides.' };
    return { sent: false, tokens: 0, words: 'Through OpenRouter only Claude and Gemini models take a thinking room. For this model a number here is never sent — OpenRouter would only turn it into a level of its own choosing in place of yours; the level above is what is sent.' };
  }
  return { sent: false, tokens: 0, words: 'This address has thinking LEVELS and no thinking room — a number here is never sent; the level above is what decides how long it thinks.' };
}

/* M308: which thinking voice speaks this turn — the story's own level, when it has
 * one, over the connection's; the connection's thinking ROOM rides either way
 * (a story's level used to drop it). Pure; chat.js asks it. */
export function effectiveReasoningOf(connection, story) {
  const r = connection && connection.reasoning && typeof connection.reasoning === 'object' ? connection.reasoning : null;
  const override = story && typeof story.reasoningEffort === 'string' ? story.reasoningEffort : '';
  if (EFFORT_RANK.includes(override)) return { ...(r && typeof r.budgetTokens === 'number' ? { budgetTokens: r.budgetTokens } : {}), effort: override };
  if (r && EFFORT_RANK.includes(r.effort)) return r;
  return { effort: 'off' };
}

/* the standing word under the form's thinking dial, when the house has one */
export function thinkingHint(conn) {
  const style = reasonStyle(conn);
  if (style === 'kimi') return 'Kimi K3 always thinks — it cannot be told not to — and has three levels only. Off and Low are spoken as “low”, Medium and High as “high”, XHigh and Max as “max”; left unsaid it would think at max. At “low” K3 often answers almost at once, with little or no thinking shown: that is the model’s own lightest setting, and there is nothing between it and “high”. Moonshot fixes its temperature (1.0) and top-p (0.95) and asks that they be left out — leave those two dials empty for this connection.';
  if (style === 'kimi2') return 'This Kimi model’s thinking is a switch: Off turns it off, every other level turns it on. Moonshot fixes its temperature and top-p — leave those two dials empty.';
  if (style === 'none' && /kimi/i.test(String(conn && conn.model || ''))) return 'This Kimi model always thinks and takes no thinking setting — nothing is sent for it.';
  return '';
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

/* M307: THE WORDS THE REPLY WAS STARTED WITH ARE PART OF THE REPLY. Every house
 * that takes a prefill answers with what comes AFTER it (Moonshot's own docs:
 * "prepend that prefix when displaying the final result") — and nothing here
 * ever put it back, so a page begun with "[The Bluebird —" landed as
 * " Friday | 20:00] She looked up.": a page that starts mid-line, whose header
 * the house can no longer read for the ground and the hour, and a worker
 * begun with "{" answered with JSON missing its first brace. What is put back
 * is what the reader should see: the prefill as sent (its trailing space
 * trimmed, as the wire trims it), less a leading <think>…</think> span, which
 * is thinking and never the page. */
export function prefillLead(conn) {
  const text = String(conn && conn.prefill != null ? conn.prefill : '').replace(/\s+$/, '');
  if (!text.trim()) return '';
  return text.replace(THINK_SPAN, '');
}
/* the space the writer ended his prefill with. The wire trims it (some houses
 * refuse a trailing space), and a model usually begins its continuation with
 * one — but not always: "[The Wells house —" + "Friday, March 14…" read as one
 * word to the header's own parser, which took the whole of it for the ground
 * (seen in the walk, DOM-50). It goes back only when the continuation brought
 * none of its own. */
export function prefillGap(conn) {
  const raw = String(conn && conn.prefill != null ? conn.prefill : '');
  if (!raw.trim()) return '';
  const m = raw.match(/\s+$/);
  return m ? m[0] : '';
}

/* M307: DEEPSEEK TAKES A STARTED REPLY ONLY AT ITS BETA ADDRESS (its docs, "Chat
 * Prefix Completion (Beta)": "the user needs to set
 * base_url=https://api.deepseek.com/beta"). The house sent prefix:true to the
 * ordinary address, which refuses it — and the refusal memory then switched
 * the prefill off for the connection, so on DeepSeek a prefill never once
 * worked. Only DeepSeek's own host is sent there; a proxy that merely has
 * "deepseek" in its name keeps its own path. */
/* M307: a refusal of a started reply is remembered for the ADDRESS that refused
 * it. On DeepSeek's own host every refusal before now came from the ordinary
 * address, which never takes one — it says nothing about the beta address
 * that does. Such a mark is not honoured, and is let go before the turn. */
export function prefillIsDown(conn) {
  if (!conn || !conn.prefillDownAt) return false;
  /* only where the beta address is the one asked: DeepSeek's own host in the openai shape. Its
   * Anthropic-shaped address (api.deepseek.com/anthropic) takes a started reply natively and is
   * never sent to /beta — a no from it is a real no, and forgetting it would ask twice every turn. */
  if (prefillProfile(conn) === 'deepseek' && deepseekBetaBase(conn.baseUrl) && conn.prefillDownShape !== 'deepseek-beta') return false;
  return true;
}
export async function healStalePrefillRefusal(conn) {
  if (!conn || !conn.prefillDownAt || prefillIsDown(conn)) return false;
  delete conn.prefillDownAt;
  delete conn.prefillDownShape;
  if (conn.id) { try { await db.connections.update(conn.id, { prefillDownAt: null, prefillDownShape: null }); } catch (err) { /* let go in hand; tried again next turn */ } }
  return true;
}
export function deepseekBetaBase(baseUrl) {
  const m = String(baseUrl || '').trim().match(/^(https?:\/\/api\.deepseek\.com)(?:\/|$)/i);
  return m ? m[1] + '/beta' : '';
}

/* Apply the prefill to a FINISHED wire message list (a copy — the caller's
 * list is never touched). Returns {messages, applied, note?}: applied=false
 * means the request goes out exactly as assembled, with `note` saying why
 * in warm words when there's something worth saying. */
export function applyPrefill(messages, conn) {
  const list = (Array.isArray(messages) ? messages : []).map((m) => ({ ...m }));
  const text = String(conn && conn.prefill != null ? conn.prefill : '');
  if (!text.trim()) return { messages: list, applied: false };
  if (prefillIsDown(conn)) {
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
