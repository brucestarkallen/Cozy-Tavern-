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
/* M348: the model's names — its own id, and the weights its provider says stand behind it (an alias such as Synthetic's
 * "syn:large:vision" is Kimi K3: moonshotai/Kimi-K3). Every family test reads both. */
export function modelNames(conn) {
  const c = conn || {};
  const own = String(c.model || '').toLowerCase();
  const known = c.identFor && c.identFor === detectKey(c) && typeof c.modelHf === 'string' ? c.modelHf.toLowerCase() : '';
  return known ? [own, known, known.split('/').pop()] : [own];
}
/* the thinking levels the model itself declares (Synthetic lists them per model) — null when it says nothing */
export function declaredEfforts(conn) {
  const c = conn || {};
  return c.identFor && c.identFor === detectKey(c) && Array.isArray(c.modelEfforts) && c.modelEfforts.length ? c.modelEfforts : null;
}

/* M349: A RELAY THAT PUBLISHES EACH MODEL'S LEVELS IS SPOKEN TO IN EXACTLY THOSE WORDS. Synthetic lists every route's
 * accepted values in reasoning_parameters.efforts and takes them through the one top-level reasoning_effort field — a
 * family's own switch (GLM's thinking:{type}, Qwen's enable_thinking) is not part of its surface, and "off" is the value
 * "none" where a model declares it. So when the house has learned a model's declared levels (M348), that is the spelling,
 * whatever family the weights are. */
export function reasonStyle(conn) {
  const c = conn || {};
  if (c.type === 'anthropic') return 'anthropic';
  if (declaredEfforts(c)) return 'declared';
  return familyStyle(c);
}

/* the family's own spelling — for a house that publishes no levels */
export function familyStyle(conn) {
  const c = conn || {};
  if (c.type === 'anthropic') return 'anthropic';
  const url = String(c.baseUrl || '').toLowerCase();
  const model = String(c.model || '').toLowerCase();
  const names = modelNames(c);
  const any = (re) => names.some((n) => re.test(n));
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
  if (any(/kimi[-_.]?k[3-9]/) || (kimiHost && /^k[3-9]\b/.test(model))) return 'kimi';
  if (kimiHost && /^kimi/.test(model)) return /k2\.?7-code/.test(model) ? 'none' : 'kimi2';
  if (c.preset === 'zai' || url.includes('api.z.ai') || any(/\bglm\b|^glm|glm-/)) return 'zai';
  if (any(/qwen/)) return 'qwen';
  /* M37: DeepSeek thinks by default (at high) and is told not to with
   * thinking:{type:'disabled'} — "decides for itself" left the workers
   * thinking their whole budget away. */
  if (c.preset === 'deepseek' || url.includes('deepseek') || any(/^deepseek/)) return 'deepseek';
  return 'openai';
}

/* M349: GLM'S GENERATION DECIDES ITS WORDS (Z.ai, "Core Parameters", "GLM-5.3"): reasoning_effort exists from GLM-5.2;
 * GLM-5.2 takes off (thinking disabled), high and max — low and medium are high on its own side, xhigh is max; GLM-5.3 and
 * after always think ("disabling reasoning is no longer supported" — a request with thinking disabled FAILS) and take
 * low, high and max. The house sent Low as "thinking on, no effort", which is max — the writer asked for the least and got
 * the most — and Off to GLM-5.3 as a switch-off it refuses. */
export function glmVersion(conn) {
  for (const n of modelNames(conn)) {
    const m = /glm[-_.]?(\d+)(?:[._](\d+))?/.exec(n);
    if (m) return Number(m[1]) + (m[2] ? Number('0.' + m[2]) : 0);
  }
  return null;
}
/* M349: a model that cannot be told not to think — Kimi K3, GLM-5.3 and after, and any model whose relay lists no "none"
 * among its levels. Its thinking is counted in the same room as its answer (the worker floor, M303) and its Off is spoken
 * as its least (the connection card says so). One test, read everywhere that asked "is it K3?". */
export function alwaysThinks(conn) {
  const style = reasonStyle(conn);
  if (style === 'declared') return !(declaredEfforts(conn) || []).includes('none');
  if (style === 'kimi') return true;
  if (style === 'zai') { const v = glmVersion(conn); return v !== null && v >= 5.3; }
  return false;
}
export function zaiWire(effort, version) {
  const e = effort === 'medium' ? 'high' : effort === 'xhigh' ? 'max' : effort;
  if (version !== null && version >= 5.3) return { thinking: { type: 'enabled' }, reasoning_effort: e === 'off' ? 'low' : e };
  if (version !== null && version < 5.2) return { thinking: { type: e === 'off' ? 'disabled' : 'enabled' } };
  if (e === 'off') return { thinking: { type: 'disabled' } };
  return { thinking: { type: 'enabled' }, reasoning_effort: e === 'low' ? 'high' : e };
}

/* M349: what a model that declares its levels is sent for the writer's level: "none" for Off where it declares none (else
 * its least — it always thinks); any other level through its family's own alias (K3 and GLM read medium as high, xhigh
 * as max), then the nearest declared thinking level below, else its least — a level that asks for SOME thinking is never
 * spoken as "none". */
export function declaredWire(conn, effort) {
  const declared = declaredEfforts(conn) || [];
  const thinking = EFFORT_RANK.filter((l) => l !== 'off' && declared.includes(l));
  if (effort === 'off') return declared.includes('none') ? 'none' : (thinking[0] || '');
  const fam = familyStyle(conn);
  const e = (EFFORT_ALIAS[fam] && EFFORT_ALIAS[fam][effort]) || effort;
  const r = EFFORT_RANK.indexOf(e);
  let best = '';
  for (const l of thinking) if (EFFORT_RANK.indexOf(l) <= r) best = l;
  return best || thinking[0] || '';
}

/* The effort this connection can actually SAY: alias-down first (a level
 * the house itself maps), then nearest-below within the style's levels;
 * `cap` is a rung the wire itself refused (rejection memory) and nothing
 * above it is ever spoken again for that connection. */
export function effortFor(style, eff, cap, declared = null) {
  const lv0 = EFFORT_LEVELS[style] || EFFORT_LEVELS.openai;
  /* M348: a model that declares its levels is only ever sent one of them ("off" stays where the style has it: it is
   * never a level anyone declares — it is sending none) */
  const lv = Array.isArray(declared) && declared.length ? lv0.filter((l) => l === 'off' || declared.includes(l)) : lv0;
  if (!lv.some((l) => l !== 'off') && Array.isArray(declared)) return effortFor(style, eff, cap, null);
  const e = (EFFORT_ALIAS[style] && EFFORT_ALIAS[style][eff]) || eff;
  let r = EFFORT_RANK.indexOf(e);
  if (r < 0) r = 0;
  const cr = cap ? EFFORT_RANK.indexOf(cap) : -1;
  if (cr >= 0 && r > cr) r = cr;
  while (r > 0 && lv.indexOf(EFFORT_RANK[r]) < 0) r--;
  if (lv.indexOf(EFFORT_RANK[r]) >= 0) return EFFORT_RANK[r];
  /* nothing at or below, and no "off" to fall to (a model that always thinks): the least it declares */
  if (lv.indexOf('off') < 0) { const least = lv.find((l) => l !== 'off'); if (least) return least; }
  return 'off';
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
import { detectKey } from './room.js'; /* M348: what the model is, kept for that very model at that very address */
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

/* M350: THE MODEL TEACHES THE HOUSE HOW IT THINKS. The house's family rules (Kimi, GLM, DeepSeek, Qwen…) are a head start
 * for the models it knows; a model that comes out after them must not need a new release. So the house learns from the
 * model's own answers, per model at its address, and uses what it learned over any rule:
 *   - a refusal that says which values it takes ("Supported values are: 'low', 'high', 'max'") — those values, and only
 *     those, from then on; the turn goes again at once at the nearest of them (it used to go without thinking at all, for
 *     a day: the model's own default, often its most);
 *   - a refusal that names one field it does not take ("Unrecognized request argument supplied: thinking") — that field
 *     is left out from then on; the rest of the thinking request still rides;
 *   - an Off that did not stop the thinking — Off then asks for the least it takes, instead of leaving it to a default
 *     that is often the most.
 * Kept 30 days, then learned again (a provider changes); let go at once when the model or the address changes. */
export const LEARN_FOR_MS = 30 * 24 * 60 * 60 * 1000;
export function learnedFacts(conn, now = Date.now()) {
  const c = conn || {};
  if (!c.learnedFor || c.learnedFor !== detectKey(c)) return null;
  if (Number.isFinite(c.learnedAt) && now - c.learnedAt > LEARN_FOR_MS) return null;
  return {
    efforts: Array.isArray(c.learnedEfforts) && c.learnedEfforts.length ? c.learnedEfforts : null,
    drop: Array.isArray(c.learnedDrop) ? c.learnedDrop : [],
    offThinks: c.learnedOffThinks === true,
  };
}
export async function learnFact(conn, fact = {}) {
  if (!conn) return null;
  const key = detectKey(conn);
  const was = learnedFacts(conn);
  const patch = {
    learnedFor: key,
    learnedAt: Date.now(),
    learnedEfforts: Array.isArray(fact.efforts) && fact.efforts.length ? fact.efforts : (was && was.efforts) || null,
    learnedDrop: [...new Set([...((was && was.drop) || []), ...(Array.isArray(fact.drop) ? fact.drop : [])])],
    learnedOffThinks: fact.offThinks === true || Boolean(was && was.offThinks),
  };
  Object.assign(conn, patch);
  if (conn.id) { try { await db.connections.update(conn.id, patch); } catch (err) { /* kept in hand this session */ } }
  return patch;
}
const EFFORT_WORDS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const OFFERS = /(supported values|allowed values|valid values|accepted values|possible values|available values|one of|must be|should be|expected|only supports?|options are|choose from|permitted values)/i;
const NOT_TAKEN = '(?:unrecognized|unknown|unsupported|not supported|extra (?:inputs?|fields?|arguments?)|not permitted|not allowed|unexpected|invalid (?:parameter|field|argument|key)|no such|does not support|doesn.t support)';
/* what a refusal teaches: the values it offers instead (never the one it refused), and a field it does not take */
export function lessonFrom(detail, body) {
  const text = String(detail || '');
  const b = body && typeof body === 'object' ? body : {};
  let allowed = null;
  const m = OFFERS.exec(text);
  if (m) {
    const refused = [b.reasoning_effort, b.reasoning && b.reasoning.effort].filter((x) => typeof x === 'string');
    const words = [...new Set((text.slice(m.index).toLowerCase().match(/[a-z]+/g) || []).filter((w) => EFFORT_WORDS.includes(w) && !refused.includes(w)))];
    if (words.length) allowed = EFFORT_WORDS.filter((w) => words.includes(w));
  }
  let badField = null;
  for (const f of ['thinking', 'enable_thinking', 'reasoning_effort', 'reasoning', 'chat_template_kwargs', 'model_options']) {
    if (!(f in b)) continue;
    const near = new RegExp(NOT_TAKEN + '[^.]{0,80}["\'`]?\\b' + f + '\\b(?!_)|\\b' + f + '\\b(?!_)["\'`]?[^.]{0,80}' + NOT_TAKEN, 'i');
    if (near.test(text)) { badField = f; break; }
  }
  return { allowed, badField };
}
/* a level made to fit what the model said it takes: Off -> "none" where it takes none, else its least; any other level ->
 * the nearest it takes at or below, else its least — never "none" for a level that asks for some thinking */
export function fitEffort(value, allowed, isOff = false) {
  if (!Array.isArray(allowed) || !allowed.length) return value;
  const thinking = EFFORT_RANK.filter((l) => l !== 'off' && allowed.includes(l));
  if (isOff || value === 'none' || value === 'off') return allowed.includes('none') ? 'none' : (thinking[0] || allowed[0]);
  if (allowed.includes(value)) return value;
  const r = EFFORT_RANK.indexOf(value);
  let best = '';
  for (const l of thinking) if (EFFORT_RANK.indexOf(l) <= r) best = l;
  return best || thinking[0] || allowed.find((a) => a !== 'none') || value;
}

/* M303: A REFUSAL IS REMEMBERED FOR THE SPELLING THAT WAS REFUSED. The mark
 * used to silence a connection's thinking settings "until the model
 * changes" — so a connection the wire refused because THE HOUSE spelled it
 * wrong (Kimi K3, sent the K2.x `thinking` block) stayed silenced after the
 * house learned the right spelling, and silence is max for K3. A mark made
 * before shapes were kept belongs to the spelling the connection had then:
 * its own, unless this release gave it a new one (the Kimi family spoke the
 * generic shape). */
/* M319: A REFUSAL IS REMEMBERED FOR A DAY, NOT FOR EVER. "Until the model changes" meant a single 400 whose words
 * happened to hold "effort", "thinking" or "reasoning" silenced a connection's thinking at every level
 * for as long as the writer kept that model — with one quiet line on a card to show for it. A house
 * that truly refuses says so again on the next ask (one extra request a day); one that refused once
 * for some passing reason gets its thinking back by itself. */
export const REFUSAL_MEMORY_MS = 24 * 60 * 60 * 1000;
export function reasoningIsDown(conn, style) {
  if (!conn || !conn.reasoningDownAt) return false;
  if (Number.isFinite(conn.reasoningDownAt) && Date.now() - conn.reasoningDownAt > REFUSAL_MEMORY_MS) return false;
  const was = typeof conn.reasoningDownShape === 'string' && conn.reasoningDownShape
    ? conn.reasoningDownShape
    : (style === 'kimi' || style === 'kimi2' ? 'openai' : style);
  return was === style;
}
/* a mark that no longer applies is let go for good — the card in Settings and
 * every other browser stop saying "unsent". Never throws. */
export async function healStaleRefusal(conn, style) {
  /* M318: a "no thinking here" remembered on DeepSeek's own host while a prefill was set is not to be trusted —
   * between M307 and M318 such turns went to the BETA address, and a no from there was read (first in
   * line) as the house refusing thinking, silencing it at every level until the model changed. DeepSeek's
   * ordinary address takes thinking. Let go once; a real refusal there is simply remembered again. */
  if (conn && conn.reasoningDownAt && !conn.reasoningDownRechecked && String(conn.prefill == null ? '' : conn.prefill).trim() && prefillProfile(conn) === 'deepseek' && deepseekBetaBase(conn.baseUrl)) {
    delete conn.reasoningDownAt; delete conn.reasoningDownShape; conn.reasoningDownRechecked = true;
    if (conn.id) { try { await db.connections.update(conn.id, { reasoningDownAt: null, reasoningDownShape: null, reasoningDownRechecked: true }); } catch (err) { /* tried again next turn */ } }
    return true;
  }
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
  if (style === 'declared') {
    const said = declaredWire(conn, want);
    const fam = familyStyle(conn);
    if (!said) return 'nothing is sent — this model declares no levels the house can speak';
    if (want === 'off' && said !== 'none') return `“${said}” — ${fam === 'kimi' ? 'Kimi K3' : 'this model'} always thinks; this is the least it declares`;
    return `“${said}”`;
  }
  if (style === 'zai') {
    const v = glmVersion(conn);
    const w = zaiWire(effortFor('zai', want), v);
    if (!w.reasoning_effort) return w.thinking.type === 'disabled' ? 'off' : 'thinking switched on';
    if (want === 'off') return `“${w.reasoning_effort}” — GLM-${v} always thinks; this is the least it can`;
    return `“${w.reasoning_effort}”`;
  }
  const said = effortFor(style, want, undefined, declaredEfforts(conn));
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
  if (style === 'declared') {
    const d = (declaredEfforts(conn) || []).join(', ');
    const who = familyStyle(conn) === 'kimi' ? 'Kimi K3' : 'This model';
    return who + ' takes exactly the levels its provider lists for it (' + d + '), and only those are ever sent, as reasoning_effort'
      + ((declaredEfforts(conn) || []).includes('none') ? ' — Off is sent as “none”.' : ' — it always thinks, so Off is its least.');
  }
  if (style === 'zai') {
    const v = glmVersion(conn);
    if (v !== null && v >= 5.3) return 'GLM-' + v + ' always thinks and takes low, high and max — Off is spoken as “low”, Medium as “high”, XHigh as “max”.';
    if (v !== null && v < 5.2) return 'This GLM’s thinking is a switch: Off turns it off, every other level turns it on (it takes no levels).';
    return 'GLM-5.2 takes off, high and max — Low and Medium are its “high”, XHigh its “max”.';
  }
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

/* M328: THE THINKING PREFILL — the writer's own SillyTavern extension (Prefill Control 1.5.1), brought into the house.
 *
 * A reasoning model writes on two channels: the reply, and the scratchpad it thinks in. A prefill that opens with
 * <think> is a SEED FOR THE SCRATCHPAD: what follows the tag (to </think>, or to the end when the tag is left
 * open) is sent in the provider's reasoning field with the reply left empty, flagged as unfinished — and the
 * model CONTINUES THE THOUGHT in the writer's words instead of starting one of its own:
 *
 *   { "role": "assistant", "content": "", "reasoning_content": "I should continue the story.", "partial": true }
 *
 * Anything after </think> is an ordinary started reply and rides in content as before. The house knew only a
 * CLOSED <think>…</think> span, and only on an address it had no other way into; on Moonshot and DeepSeek the
 * tag itself was sent as the first words of the page.
 *
 * What is NOT brought over is the extension's merge guard, its generation types and its tools/JSON-schema
 * guards: they exist for SillyTavern's server, which rewrites a finished prompt. This house sends what it
 * assembles; the started message is always the last one on the wire. */
export const SEED_OPEN = '<think>';
export const SEED_CLOSE = '</think>';
const SEED_SPAN = /^\s*<think>([\s\S]*?)(?:<\/think>|$)/;
/* { seed, content }: the scratchpad's first words, and the reply's. A trailing space is never sent (some houses refuse it). */
export function splitPrefill(text) {
  const raw = String(text == null ? '' : text).replace(/\s+$/, '');
  const m = raw.match(SEED_SPAN);
  if (!m) return { seed: '', content: raw };
  return { seed: m[1].trim(), content: raw.slice(m[0].length).replace(/^\s+/, '') };
}

/* keys that are part of the message itself: a flag named "content" would send content:true and destroy the prefill with it */
export const RESERVED_FIELDS = Object.freeze(['role', 'content', 'name', 'tool_calls', 'tool_call_id', 'refusal', '__proto__', 'constructor', 'prototype']);
/* a field name typed by hand: trimmed (" partial " is a key no provider reads), "none" for no field, and refused when unusable */
export function fieldName(raw) {
  const name = String(raw == null ? '' : raw).trim();
  if (!name) return { name: '', auto: true, valid: true, error: '' };
  if (/^none$/i.test(name)) return { name: '', auto: false, valid: true, error: '' };
  if (RESERVED_FIELDS.includes(name)) return { name, auto: false, valid: false, error: '“' + name + '” is part of the message itself' };
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return { name, auto: false, valid: false, error: '“' + name + '” is not a field name' };
  return { name, auto: false, valid: true, error: '' };
}
/* the two fields for this connection: the provider's own (the extension's mapping table), unless the writer typed others */
export function prefillFields(conn) {
  const c = conn || {};
  const profile = prefillProfile(c);
  const url = String(c.baseUrl || '').toLowerCase();
  const model = String(c.model || '').toLowerCase();
  let flag = PREFILL_PROFILES[profile].flagField;
  let reasoning = profile === 'anthropic' ? '' : 'reasoning_content';
  if (profile === 'generic' && url.includes('openrouter')) {
    /* OpenRouter hands a Moonshot model Moonshot's own fields; everything else reads its reasoning in "reasoning" */
    if (/^moonshotai\//.test(model)) { flag = 'partial'; reasoning = 'reasoning_content'; } else { flag = ''; reasoning = 'reasoning'; }
  }
  if (profile === 'anthropic') return { flag: '', reasoning: '', error: '' };
  const f = fieldName(c.prefillFlagField); const r = fieldName(c.prefillReasoningField);
  if (!f.valid) return { flag, reasoning, error: 'The continuation flag: ' + f.error + '.' };
  if (!r.valid) return { flag, reasoning, error: 'The thinking field: ' + r.error + '.' };
  if (!f.auto) flag = f.name;
  if (!r.auto) reasoning = r.name;
  if (flag && flag === reasoning) return { flag, reasoning, error: 'The continuation flag and the thinking field are both “' + flag + '” — the flag would overwrite the seed.' };
  return { flag, reasoning, error: '' };
}
/* M375: DOES THIS PROVIDER CONTINUE A STARTED THOUGHT? Only a provider with a continuation flag (DeepSeek's prefix,
 * Moonshot's partial) takes a trailing assistant message as the START of its reply. Everywhere else — Synthetic, most
 * OpenAI-shaped houses — the same message is a FINISHED, EMPTY turn the model then reads as part of the conversation, and
 * reasons about in its thinking ("the user's message… this wrapper…"). The grounding phrase is seeded only where it is
 * truly continued; everywhere else it lives in the standing words alone. */
export function seedContinues(conn) {
  if (prefillProfile(conn) === 'anthropic') return false;
  const f = prefillFields(conn);
  return !f.error && Boolean(f.flag);
}

/* what WOULD be sent for this connection, decided in one place: the turn, the card, the form and "Test it" all ask here */
export function prefillPlan(conn) {
  const text = String(conn && conn.prefill != null ? conn.prefill : '');
  if (!text.trim()) return { send: false, why: '' };
  const profile = prefillProfile(conn);
  const { seed, content } = splitPrefill(text);
  const fields = prefillFields(conn);
  const effort = conn && conn.reasoning && typeof conn.reasoning.effort === 'string' ? conn.reasoning.effort : '';
  const thinkingRefused = reasoningIsDown(conn, reasonStyle(conn));
  if (fields.error) return { send: false, why: fields.error + ' Nothing is sent until it is put right.' };
  if (profile === 'anthropic') {
    if (!content) return { send: false, why: 'Claude takes no thinking seed — there is no field for one — and nothing follows the seed, so nothing is sent.' };
    if (effort && effort !== 'off' && !thinkingRefused) return { send: false, why: 'The reply was not started for it: on this address a started reply makes the model skip its thinking, and thinking is set to ' + effort + '. Set thinking to Off to use the prefill.' };
    return { send: true, seed: '', content, flag: '', reasoning: '', dropped: seed ? 'Claude takes no thinking seed; only the words after it were sent.' : '' };
  }
  /* a seed needs a field to ride in and a thinking channel that is not refused */
  const seedRides = Boolean(seed) && Boolean(fields.reasoning) && !thinkingRefused;
  const dropped = seed && !seedRides ? (thinkingRefused ? 'This connection once refused its thinking settings, so the thinking seed stayed home.' : 'No thinking field is set, so the thinking seed stayed home.') : '';
  if (!seedRides && !content) return { send: false, why: dropped || '' };
  /* M318, narrowed: only a started REPLY switches DeepSeek's thinking off — a seed is the thinking */
  if (profile === 'deepseek' && content && !seedRides && effort && effort !== 'off' && !thinkingRefused) {
    return { send: false, why: 'The reply was not started for it: on this address a started reply makes the model skip its thinking, and thinking is set to ' + effort + '. Set thinking to Off to use the prefill — or open it with <think> to seed the thinking instead.' };
  }
  if (!fields.flag && !seedRides) return { send: false, why: 'This address has no known way to start the reply for it — the prefill stayed home. (Open it with <think> and it rides as a thinking seed.)' };
  return { send: true, seed: seedRides ? seed : '', content, flag: fields.flag, reasoning: seedRides ? fields.reasoning : '', dropped,
    /* the channel must be open for a seed to mean anything: "seeding a channel the request has switched off is the one failure that looks like success" */
    keepThinkingOpen: seedRides && (!conn || conn.prefillKeepThinking !== false) };
}
/* …and in words, for the card, the form and the turn's receipt */
export function describePrefill(conn) {
  const plan = prefillPlan(conn);
  if (!String(conn && conn.prefill != null ? conn.prefill : '').trim()) return '';
  if (prefillIsDown(conn)) return 'NOT sent — this connection once refused a started reply.';
  if (!plan.send) return 'NOT sent — ' + (plan.why || 'nothing to send.');
  const parts = [];
  if (plan.seed) parts.push('a thinking seed in “' + plan.reasoning + '” (' + plan.seed.length + ' characters) — the model continues the thought');
  if (plan.content) parts.push('the reply started with “' + (plan.content.length > 40 ? plan.content.slice(0, 40) + '…' : plan.content) + '”');
  return 'Sent as ' + parts.join(', and ') + (plan.flag ? ', flagged “' + plan.flag + '”' : ', no flag') + '.' + (plan.dropped ? ' ' + plan.dropped : '');
}

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
/* M318: true when this connection has a prefill AND asks for thinking on a house where the two cannot go together */
export function prefillSilencesThinking(conn) {
  if (!conn || !String(conn.prefill == null ? '' : conn.prefill).trim()) return false;
  const effort = conn.reasoning && typeof conn.reasoning.effort === 'string' ? conn.reasoning.effort : '';
  if (!effort || effort === 'off') return false;
  if (reasoningIsDown(conn, reasonStyle(conn))) return false; /* thinking is not being sent anyway */
  const profile = prefillProfile(conn);
  if (profile !== 'deepseek' && profile !== 'anthropic') return false;
  /* M328: a thinking SEED does not silence the thinking — it is the thinking. Only a started reply does. */
  const plan = prefillPlan(conn);
  return !plan.send && /skip its thinking/.test(plan.why || '');
}

export function prefillLead(conn) {
  const text = String(conn && conn.prefill != null ? conn.prefill : '').replace(/\s+$/, '');
  if (!text.trim()) return '';
  return splitPrefill(text).content; /* M328: whatever follows the seed — nothing at all for a pure thinking prefill */
}
/* M328: …and the words the THOUGHT was started with are part of the thought (the same law, the other channel) */
export function thinkingLead(conn) {
  const plan = prefillPlan(conn);
  return plan.send && plan.seed ? plan.seed : '';
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
  /* M328: one decision, made in prefillPlan (the card, the form and "Test it" read the same one) */
  const plan = prefillPlan(conn);
  if (!plan.send) return { messages: list, applied: false, ...(plan.why ? { note: plan.why } : {}) };
  const msg = { role: 'assistant', content: plan.content };
  if (plan.seed) msg[plan.reasoning] = plan.seed;
  if (plan.flag) msg[plan.flag] = true;
  list.push(msg);
  return { messages: list, applied: true, seed: plan.seed, content: plan.content, keepThinkingOpen: Boolean(plan.keepThinkingOpen), ...(plan.dropped ? { note: plan.dropped } : {}) };
}

export function hostIsOpenAI(baseUrl) {
  return /(^|\/\/)api\.openai\.com(\/|$)/i.test(String(baseUrl || ''));
}
