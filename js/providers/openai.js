/* Cozy Tavern — providers/openai.js
 * OpenAI-compatible chat completions (OpenAI, OpenRouter, or a custom
 * address), streamed over SSE.
 * Contract (M8.5): { test(): Promise<{ok, detail}>,
 *   listModels(): Promise<[{id, label}]>  (throws kindly on failure),
 *   streamChat({systemBlocks|system, messages, signal, onToken})
 *     : Promise<{text, thinking, ttftMs, tfftMs, durationMs}> }
 * onToken receives {channel:'thinking'|'prose', text}. The reasoning
 * channel (M8.5) arrives as delta.reasoning_content / delta.reasoning;
 * when no native channel speaks but the PROSE opens with a literal
 * <think>…</think> span (the V176 way), a small state machine splits it
 * out — even when the tags themselves are split across chunks.
 * ttftMs = first PROSE token; tfftMs = first THOUGHT (null when quiet);
 * durationMs = fetch start to stream end.
 */

import { db } from '../store.js'; /* M580: a structured refusal is remembered with its model */
import { structuredSchema, makeStructuredDecoder, hiddenMatcher, asciiOnly, STRUCTURED_REFUSAL, MIN_AFTER_DEFAULT, bannedPattern, unwrapStructured, readTemplate } from './structured.js'; /* M580, M581, M587, M590 */
import { knobsOf, KNOB_FIELDS, knobRefused } from './knobs.js'; /* M510: the rest of the dials */
import { houseFetch } from './relay.js'; /* M353: a provider that refuses a page is carried by the house */
import { lateSystemRefused, rememberLateSystemRefused } from './latesystem.js'; /* M380, M385 */
import { userFirstRequired, rememberUserFirst, withUserFirst, opensOnAssistant, ORDER_REFUSAL } from './userfirst.js'; /* M510-38 */
import { measureStream, speedWords, pickOpenAI, SPEED_ASK, SPEED_MAX_TOKENS } from './speed.js'; /* M373 */

/* M376: the least room a THINKING page is given — the same floor the workers already keep for a thinking model */
export const PAGE_THINKING_FLOOR = 16000;
import { reportedContext, reportedIdentity } from './room.js'; /* M289; M348 */
import { readSSE } from './sse.js';
import { withImagePart, transportError } from './wire.js';
/* M22-A/D: the full reasoning ladder (per-house spellings, alias-down,
 * rejection memory) and the storyteller prefill live in effort.js. */
import {
  reasonStyle, effortFor, REASONING_REFUSAL, PREFILL_REFUSAL, hostIsOpenAI,
  applyPrefill, prefillPlan, markConnectionDown, reasoningIsDown, healStaleRefusal, budgetFor, prefillLead, prefillGap, prefillProfile, deepseekBetaBase, healStalePrefillRefusal, thinkingLead,
 declaredEfforts, declaredWire, zaiWire, glmVersion, learnedFacts, learnFact, lessonFrom, fitEffort, alwaysThinks } from './effort.js';

const DEFAULT_BASE = 'https://api.openai.com';

/* The endpoint is {base}/v1/chat/completions (SPEC.md). Trim trailing
 * slashes, and forgive a pasted address that already ends in /v1. */
function baseOf(connection) {
  return (connection.baseUrl || DEFAULT_BASE)
    .replace(/\/+$/, '')
    .replace(/\/v1$/i, '');
}

function headersOf(connection) {
  const headers = { 'content-type': 'application/json' };
  if (connection.apiKey) headers.authorization = `Bearer ${connection.apiKey}`;
  return headers;
}

function nameOf(connection) {
  const base = connection.baseUrl || '';
  if (base.includes('openrouter.ai')) return 'OpenRouter';
  return 'the storyteller';
}

async function explain(res, name) {
  let detail = '';
  try {
    const body = await res.json();
    detail = (body && body.error && body.error.message) || '';
  } catch (err) { /* not JSON; the status still tells a story */ }
  if (res.status === 401 || res.status === 403) {
    return 'The key wasn’t accepted. It’s worth another look in Settings.';
  }
  if (res.status === 404) {
    return 'That model name didn’t ring a bell. Check it in Settings.';
  }
  if (res.status === 429) {
    return 'They’re busy just now. Give it a breath and try again.';
  }
  if (detail) return `${name} said no (${res.status}): ${detail}`;
  return `The answer was no, without a reason (${res.status}).`;
}

/* The SSE reader is shared by both providers (M9, B16): providers/sse.js. */

/* The V176 interop splitter (M8.5). Some storytellers have no native
 * reasoning channel but open their answer with a literal <think>…</think>
 * span. This machine feeds on prose deltas and re-routes that leading span
 * onto the thinking channel, holding back partial tags that straddle chunk
 * boundaries. Everything after the closing tag (or everything, when no
 * opening tag ever comes) is plain prose. */
function makeThinkSplitter(emit) {
  const OPEN = '<think>';
  const CLOSE = '</think>';
  let state = 'open'; // 'open' | 'thinking' | 'prose'
  let buf = '';

  function feed(text) {
    buf += text;
    for (;;) {
      if (state === 'open') {
        const trimmed = buf.replace(/^\s+/, '');
        if (trimmed.length < OPEN.length && OPEN.startsWith(trimmed)) return; // could still become the tag
        if (trimmed.startsWith(OPEN)) {
          const lead = buf.length - trimmed.length;
          if (lead) emit('prose', buf.slice(0, lead));
          buf = trimmed.slice(OPEN.length);
          state = 'thinking';
          continue;
        }
        emit('prose', buf);
        buf = '';
        state = 'prose';
        return;
      }
      if (state === 'thinking') {
        const at = buf.indexOf(CLOSE);
        if (at !== -1) {
          if (at) emit('thinking', buf.slice(0, at));
          buf = buf.slice(at + CLOSE.length);
          state = 'prose';
          continue;
        }
        /* No closing tag yet — but the tail might be the start of one,
         * cut in two by the chunk boundary. Hold back the longest suffix
         * that could still grow into it. */
        let hold = 0;
        const maxHold = Math.min(CLOSE.length - 1, buf.length);
        for (let k = maxHold; k > 0; k--) {
          if (CLOSE.startsWith(buf.slice(-k))) { hold = k; break; }
        }
        const out = buf.slice(0, buf.length - hold);
        if (out) emit('thinking', out);
        buf = buf.slice(buf.length - hold);
        return;
      }
      emit('prose', buf);
      buf = '';
      return;
    }
  }

  function end() {
    if (!buf) return;
    /* The stream closed mid-span: an unfinished opening tag was never
     * really a thought, so it goes home to the prose; an unclosed thought
     * stays a thought. */
    emit(state === 'thinking' ? 'thinking' : 'prose', buf);
    buf = '';
  }

  return { feed, end };
}

/* The request body, built pure. Sampling dials ride only when set on the
 * connection. The thinking voice maps per house (M8.5, full ladder M22-A):
 * OpenRouter takes reasoning:{effort} (or {max_tokens} when a budget was
 * named) — xhigh/max included, mapped down per model on their side;
 * Z.ai takes thinking:{enabled} plus reasoning_effort above low (its
 * ladder skips medium/xhigh — the alias-down in effort.js has already
 * spoken them as high/max); qwen takes enable_thinking; the Hermes agent
 * takes model_options.reasoning; DeepSeek decides for itself; everything
 * else takes reasoning_effort. 'off' sends nothing. A connection the wire
 * has refused (reasoningDownAt) sends nothing until its model changes.
 * M22-C: OpenRouter connections with searchOn ride plugins:[{id:'web'}].
 * M22-D: the prefill joins per the house's profile (effort.js). */
/* M580: does this turn go out structured? Only when he chose it for this connection, there is an opening to ask for (the
 * reply part of his prefill — a thinking seed has no place in a schema), and this model has not refused it */
export function structuredPlanFor(connection) {
  const c = connection || {};
  if (c.prefillMode !== 'structured' || c.type === 'anthropic') return null;
  if (c.structuredDownAt && (!c.structuredDownModel || c.structuredDownModel === c.model)) return null;
  /* M586: in Structured the WHOLE prefill is the template — a <think>…</think> in it is a thinking block the model must
   * write itself (and the house puts in the thinking box), not a seed handed over: the way to think AND be held to his
   * words in the same turn */
  const reply = String(c.prefill == null ? '' : c.prefill).replace(/\s+$/, '');
  if (!reply.trim()) return null;
  /* M581: the houses the extension itself never asks (their JSON answers are a mode, not a pattern): sent as written */
  if (STRUCTURED_NEVER.test(String(c.baseUrl || ''))) return null;
  const minChars = Number.isFinite(c.prefillMinChars) && c.prefillMinChars > 0 ? c.prefillMinChars : MIN_AFTER_DEFAULT;
  const ban = bannedPattern(String(c.prefillBanned || ''));
  const note = ban.tooBig ? 'Your banned words are too many for one exact pattern (' + ban.words.length + ' given) — the page went without them; fewer words ride.' : '';
  return { template: reply, schema: structuredSchema(reply, { minChars, ascii: asciiOnly(c), banned: asciiOnly(c) ? '' : ban.pattern }), hidden: hiddenMatcher(reply), note };
}
export const STRUCTURED_NEVER = /deepseek|moonshot|z\.ai|bigmodel|siliconflow|ai21|cometapi/i;
function requestBody(connection, wireMessages, opts = {}) {
  /* M328: a retry that withholds the thinking params withholds the thinking SEED with them (a seed with no channel);
   * what follows the seed — a started reply — still rides */
  const asSent = opts.suppressReasoning && connection ? { ...connection, reasoningDownAt: Date.now(), reasoningDownShape: reasonStyle(connection) } : connection;
  /* M580: THE STRUCTURED PREFILL — his opening words asked of the model through the answer's schema, not handed to it as an
   * assistant message (providers/structured.js). Nothing is appended to the conversation; the request carries the schema. */
  const structured = !opts.suppressPrefill && !opts.suppressStructured ? structuredPlanFor(connection) : null;
  const pf = opts.suppressPrefill || structured
    ? { messages: wireMessages, applied: false }
    : applyPrefill(wireMessages, asSent);
  const body = {
    model: connection.model || 'gpt-4o-mini',
    messages: pf.messages,
    stream: true,
  };

  if (typeof connection.temperature === 'number') body.temperature = connection.temperature;
  if (typeof connection.topP === 'number') body.top_p = connection.topP;
  Object.assign(body, knobsOf(connection)); /* M510: top-k, min-p, the penalties, stop texts, a seed — only what he set */
  if (typeof connection.maxTokens === 'number' && connection.maxTokens > 0) {
    body.max_tokens = Math.round(connection.maxTokens);
    /* M376: A FLOOR, NOT A SETTING (his rule: "the only override allowed is a floor that prevents corruption — a minimum
     * token budget"). A thinking model spends its room thinking first; set lower than this, the thinking used the room
     * up, the reply was cut before its page ever came, and the house had to ask a second time — the stop and restart he
     * saw. With thinking asked for (or a model that always thinks), a room he set below the floor is raised to it. A
     * room he never set is still never sent. */
    const thinkingAsked = (connection.reasoning && typeof connection.reasoning.effort === 'string' && connection.reasoning.effort !== 'off') || alwaysThinks(connection);
    if (thinkingAsked && body.max_tokens < PAGE_THINKING_FLOOR) body.max_tokens = PAGE_THINKING_FLOOR;
  }
  const style = reasonStyle(connection);
  const r = (connection && connection.reasoning) || {};
  const set = r && typeof r.effort === 'string' ? r.effort : 'off';
  /* M328: KEEP THE THINKING CHANNEL OPEN FOR A SEED. A thinking seed sent while the request itself says "do not
   * think" lands nowhere — "the one failure that looks like success" (the extension's words). A turn that
   * carries a seed asks for the lightest thinking when the dial says Off; only such turns, and only while the
   * connection's "keep the thinking open" tick stands. A turn whose thinking params are being withheld
   * (refused once, or this retry) carries no seed at all — prefillPlan and the retry below see to that. */
  const opened = pf.applied && pf.keepThinkingOpen && set === 'off';
  const wanted = opened ? 'low' : set;
  const suppressed = opts.suppressReasoning || reasoningIsDown(connection, style); /* M303: a refusal of another spelling is not a refusal of this one */
  const effort = suppressed ? 'off' : effortFor(style, wanted, undefined, declaredEfforts(connection)); /* M348: only levels the model itself declares */
  if (style === 'none') {
    /* the model decides on its own — nothing extra is ever sent */
  } else if (suppressed) {
    /* the wire refused these params once — nothing is spent on them again */
  } else if (style === 'openrouter') {
    const budget = budgetFor(connection).tokens; /* M308: only for a model that can hear one — for the rest the writer's LEVEL is what is sent */
    body.reasoning = effort === 'off'
      ? { enabled: false }
      : (budget ? { max_tokens: budget } : { effort });
  } else if (style === 'declared') {
    /* M349: the relay's own words for this model — one field, one of the values it lists */
    const said = declaredWire(connection, wanted);
    if (said) body.reasoning_effort = said;
  } else if (style === 'zai') {
    /* M349: by GLM's generation (effort.js zaiWire) */
    const w = zaiWire(effort, glmVersion(connection));
    body.thinking = w.thinking;
    if (w.reasoning_effort) body.reasoning_effort = w.reasoning_effort;
  } else if (style === 'qwen') {
    body.enable_thinking = effort !== 'off';
  } else if (style === 'hermes') {
    if (effort !== 'off') {
      body.model_options = { ...(body.model_options || {}), reasoning: { enabled: true, effort } };
    }
  } else if (style === 'kimi') {
    /* M303: Kimi K3, in Moonshot's own words — "configure its reasoning
     * effort with the top-level reasoning_effort request field, which
     * supports low / high / max"; "does not support the thinking parameter".
     * effortFor never says "off" here: K3 cannot stop thinking, and unsaid
     * means max. */
    if (effort !== 'off') body.reasoning_effort = effort;
  } else if (style === 'kimi2') {
    /* M303: K2.x on Moonshot's address — the switch, and no reasoning_effort
     * ("Not supported") */
    body.thinking = { type: effort === 'off' ? 'disabled' : 'enabled' };
  } else if (style === 'deepseek') {
    /* M37: the writer's provider, verbatim — thinking on by default at high;
     * off is thinking:{type:'disabled'}; effort rides reasoning_effort. */
    body.thinking = { type: effort === 'off' ? 'disabled' : 'enabled' };
    if (effort !== 'off') body.reasoning_effort = effort;
  } else {
    /* the generic openai shape: reasoning_effort when on — and, off the
     * real OpenAI host, the explicit thinking switch too, because more and
     * more houses think by default unless told not to. */
    if (effort !== 'off') body.reasoning_effort = effort;
    if (!hostIsOpenAI(connection && connection.baseUrl)) {
      body.thinking = { type: effort === 'off' ? 'disabled' : 'enabled' };
    }
  }
  /* M350: WHAT THE MODEL ITSELF TAUGHT THE HOUSE, applied last, over any spelling (effort.js learnedFacts) */
  const learned = suppressed || style === 'none' ? null : learnedFacts(connection);
  if (learned) {
    if (set === 'off' && !opened && learned.offThinks && style !== 'hermes') {
      /* its Off did not stop it: ask for the least it takes, not its own default */
      const least = learned.efforts ? fitEffort('low', learned.efforts) : 'low';
      if ('thinking' in body) body.thinking = { type: 'enabled' };
      if ('enable_thinking' in body) body.enable_thinking = true;
      if (style === 'openrouter') body.reasoning = { effort: least };
      else body.reasoning_effort = least;
    }
    for (const f of learned.drop) delete body[f];
    if (learned.efforts) {
      if (typeof body.reasoning_effort === 'string') body.reasoning_effort = fitEffort(body.reasoning_effort, learned.efforts, set === 'off' && !opened && !learned.offThinks);
      if (body.reasoning && typeof body.reasoning.effort === 'string') body.reasoning.effort = fitEffort(body.reasoning.effort, learned.efforts);
    }
  }
  /* M510: a dial this house refused is left out whatever the thinking's state (the block above stands aside when the
   * thinking is withheld) */
  { const taught = learnedFacts(connection); if (taught) for (const f of taught.drop) if (KNOB_FIELDS.includes(f) || f === 'stream_options') delete body[f]; } /* M510-25: and the usage request */
  /* M22-C: "let it look things up" — OpenRouter's web plugin. Only the
   * openrouter host shape carries it; other openai-compatible addresses
   * hide the control in the form. */
  if (connection && connection.searchOn && style === 'openrouter') {
    body.plugins = [{ id: 'web' }];
  }
  if (structured) {
    body.response_format = { type: 'json_schema', json_schema: { name: 'response', strict: true, schema: structured.schema } };
    /* OpenRouter routes only to a provider that keeps the schema (otherwise one that ignores it may take the turn) */
    if (/openrouter\.ai/i.test(String(connection.baseUrl || ''))) body.provider = { ...(body.provider && typeof body.provider === 'object' ? body.provider : {}), require_parameters: true };
  }
  return { structured, asked: { set, opened, suppressed }, body, prefill: opened && !suppressed ? { ...pf, note: [pf.note, 'Thinking was switched on (at its lightest) for this turn, so the thinking seed has a channel to land in.'].filter(Boolean).join(' ') } : pf };
}

/* M329: what the prefill did on this turn, in words — kept on the page's receipt ("What the storyteller saw") */
function prefillReport(connection, sent, modelThought, full) {
  if (!String(connection && connection.prefill != null ? connection.prefill : '').trim()) return null;
  /* M580: a structured turn — the opening was asked of the model through the answer's schema */
  if (sent && sent.structured) return { applied: true, structured: true, words: 'The prefill went structured: the model wrote its opening itself, to the pattern “' + String(sent.content || '').slice(0, 80) + (String(sent.content || '').length > 80 ? '…' : '') + '”.' };
  if (!sent) return null;
  if (sent.stayedHome !== undefined) return { applied: false, words: 'The prefill was NOT sent' + (sent.stayedHome ? ' — ' + sent.stayedHome : '.') };
  const bits = [];
  let working = true;
  if (sent.seed) {
    if (modelThought > 0) bits.push('the thinking seed was sent and the model thought on from it (' + modelThought + ' characters of its own thinking came back)');
    else { working = false; bits.push('the thinking seed was sent, but NO thinking came back — on this turn the model did not think, so the seed steered nothing'); }
  }
  if (sent.content) bits.push('the reply was started with “' + (sent.content.length > 40 ? sent.content.slice(0, 40) + '…' : sent.content) + '”');
  const words = bits.join('; ');
  return { applied: true, working, seeded: Boolean(sent.seed), words: 'The prefill: ' + words + '.' };
}

export function createOpenAIProvider(connection) {
  const base = baseOf(connection);
  const name = nameOf(connection);

  /* M351: DOES IT ACTUALLY THINK, AT THE LEVEL THIS CONNECTION IS SET TO? "Test" said only that the line was good, so
   * "low sends no thinking back" could only be answered by reading the provider's documents. It now sends exactly what a
   * page sends for the thinking (requestBody, the same plan, the same fields), reads the answer for thinking in any
   * channel and for the reasoning tokens the answer reports, and — when nothing came back — asks once more at the top
   * level, so the writer is told which it is: this LEVEL gives none, this ADDRESS gives none, or the words are hidden
   * though the model thought. A refusal teaches the house on the way (M350). */
  async function askOnce(effort, opts = {}) {
    const { body } = requestBody({ ...connection, reasoning: { effort } }, [{ role: 'user', content: 'Answer with one word: ready.' }], { ...opts, suppressStructured: true }); /* M587: a probe of the thinking never carries the page's schema — a refusal of the schema read as a refusal of a thinking field would teach the connection the wrong lesson */
    body.stream = false;
    body.max_tokens = 2000; /* room for thinking to start and a word to follow */
    delete body.plugins;
    const asked = {};
    for (const k of ['reasoning_effort', 'thinking', 'reasoning', 'enable_thinking', 'model_options']) if (k in body) asked[k] = body[k];
    const res = await houseFetch(`${base}/v1/chat/completions`, { method: 'POST', headers: headersOf(connection), body: JSON.stringify(body) }, connection);
    if (!res.ok) {
      let detail = '';
      try { const j = await res.clone().json(); detail = (j && j.error && j.error.message) || ''; } catch (err) { /* the status speaks */ }
      return { ok: false, res, detail, body, asked };
    }
    let j = null;
    try { j = await res.json(); } catch (err) { j = null; }
    const msg = (j && j.choices && j.choices[0] && j.choices[0].message) || {};
    let thought = msg.reasoning_content ?? msg.reasoning;
    if (thought == null) {
      for (const [k, v] of Object.entries(msg)) {
        if (k !== 'content' && k !== 'role' && k !== 'refusal' && typeof v === 'string' && v && /reason|think|thought/i.test(k)) { thought = v; break; }
      }
    }
    const usage = (j && j.usage) || {};
    const tokens = Number((usage.completion_tokens_details && usage.completion_tokens_details.reasoning_tokens) ?? usage.reasoning_tokens);
    return { ok: true, thought: typeof thought === 'string' ? thought.trim() : '', tokens: Number.isFinite(tokens) ? tokens : null, said: String(msg.content || '').trim(), asked };
  }

  /* M373: one streamed answer, timed — how long before its first words, and how fast it writes after them. His own
   * settings ride (M12); a provider that will not take the usage request is asked once more without it. */
  async function measure() {
    for (const withUsage of [true, false]) {
      try {
        const { body } = requestBody(connection, [{ role: 'user', content: SPEED_ASK }], { suppressStructured: true }); /* M587: the speed is the model's, not a schema's */
        body.stream = true;
        body.max_tokens = SPEED_MAX_TOKENS;
        delete body.plugins;
        if (withUsage) body.stream_options = { include_usage: true };
        const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const res = await houseFetch(`${base}/v1/chat/completions`, { method: 'POST', headers: headersOf(connection), body: JSON.stringify(body) }, connection);
        if (!res.ok) { if (withUsage && res.status >= 400 && res.status < 500) continue; return null; }
        return await measureStream(res, pickOpenAI, { startedAt: t0 });
      } catch (err) { return null; }
    }
    return null;
  }

  async function test() {
    const found = await testLine();
    if (!found || !found.ok) return found;
    const m = await measure();
    return m ? { ...found, detail: found.detail + ' ' + speedWords(m), speed: m } : found;
  }

  async function testLine() {
    const set = connection.reasoning && typeof connection.reasoning.effort === 'string' ? connection.reasoning.effort : 'off';
    const words = (a) => (Object.keys(a).length ? Object.entries(a).map(([k, v]) => k + ': ' + (typeof v === 'string' ? '“' + v + '”' : JSON.stringify(v))).join(', ') : 'nothing about thinking');
    try {
      let first = await askOnce(set);
      if (!first.ok) {
        /* M350: the refusal may teach — then the same question goes again, fitted to what it said */
        const lesson = lessonFrom(first.detail, first.body);
        if (lesson.allowed) { await learnFact(connection, { efforts: lesson.allowed }); first = await askOnce(set); }
        else if (lesson.badField) { await learnFact(connection, { drop: [lesson.badField] }); first = await askOnce(set); }
      }
      if (!first.ok) return { ok: false, detail: await explain(first.res, name) };
      const at = (a, t, n) => 'Asked at “' + set + '” (' + words(a) + ') — ' + (t ? n.toLocaleString() + ' characters of thinking came back.' : 'the answer came, but NO thinking with it.');
      if (first.thought) {
        /* an Off that thought anyway is learned here too, as on a page */
        if (set === 'off' && !alwaysThinks(connection)) await learnFact(connection, { offThinks: true });
        return { ok: true, detail: at(first.asked, true, first.thought.length) + ' Thinking works on this connection.' };
      }
      if (first.tokens) {
        return { ok: true, detail: at(first.asked, false, 0) + ' It reported ' + first.tokens.toLocaleString() + ' thinking tokens, so the model DID think — this address keeps the words to itself.' };
      }
      if (set === 'max') return { ok: true, detail: at(first.asked, false, 0) + ' At the top level too, so this address sends no thinking back at all — the model may still think inside it.' };
      const top = await askOnce('max');
      if (!top.ok) return { ok: true, detail: at(first.asked, false, 0) + ' (The top level was refused, so it could not be compared.)' };
      if (top.thought || top.tokens) {
        return { ok: true, detail: at(first.asked, false, 0) + ' Asked again at “max” (' + words(top.asked) + ') — ' + (top.thought ? top.thought.length.toLocaleString() + ' characters came back' : top.tokens.toLocaleString() + ' thinking tokens were reported') + '. So it is this LEVEL that gives none here, not the address: choose a higher one.' };
      }
      return { ok: true, detail: at(first.asked, false, 0) + ' Nor at “max” — this address sends no thinking back at any level, though the model may still think inside it.' };
    } catch (err) {
      return { ok: false, detail: `Couldn’t reach ${name} — check the connection and try again.` };
    }
  }

  async function streamChat({ systemBlocks: blocks, system, messages, signal: callerSignal, onToken, retryAs = null }) {
    /* M585: the turn's own line to the provider, tied to his Stop — so the house can cut it when an answer is complete
     * (a structured answer that closed): the provider stops writing (and billing), and the usage meter's copy of the
     * stream ends with it instead of reading the padding to the provider's end */
    const line = new AbortController();
    const signal = line.signal;
    const relay = () => { try { line.abort(); } catch (err) { /* already cut */ } };
    if (callerSignal) { if (callerSignal.aborted) relay(); else callerSignal.addEventListener('abort', relay, { once: true }); }
    /* System mapping (SPEC.md M2, widened M9 for A4): the cache:true blocks
     * concatenate into a single LEADING system message — the stable prefix
     * that provider-side caching keys on. Blocks marked cache:false (M9:
     * the brief and Who's here, which drift with the scene) follow as
     * separate system messages, in order, never merged into the stable
     * prefix. The M1 legacy `system` (string or array of strings) still
     * works, unchanged. */
    const wire = [];
    if (Array.isArray(blocks) && blocks.length) {
      const stable = blocks
        .filter((b) => b && b.cache && typeof b.text === 'string' && b.text.length)
        .map((b) => b.text)
        .join('\n\n');
      /* M321: ONE SYSTEM MESSAGE, NOT A STACK OF THEM. The brief and "Here right now" rode as their own system
       * messages after the prefix — three system messages in a row, and the storyteller's own thinking
       * said so: "These hints are layered on each other, which is unusual. Let me look: hint 1… hint 2…
       * hint 3…" — a turn's thinking spent sorting the house's wrapping instead of the scene. They follow
       * the stable prefix inside the SAME message, in the same order: a provider's prefix cache keys on
       * the leading bytes, which are unchanged (the frame and the craft still lead, byte for byte). */
      const rest = blocks.filter((b) => b && !b.cache && typeof b.text === 'string' && b.text.length).map((b) => b.text);
      const whole = [stable, ...rest].filter(Boolean).join('\n\n');
      if (whole) wire.push({ role: 'system', content: whole });
    } else {
      const systemText = Array.isArray(system) ? system.join('\n\n') : system;
      if (systemText) wire.push({ role: 'system', content: systemText });
    }
    /* M380: a system message after the story (the post-history words) — sent as a user one to a house that once refused it */
    /* M510-38: a house that once refused a conversation opening on the assistant gets his one line first */
    for (const m of (userFirstRequired(connection) ? withUserFirst(messages) : messages)) wire.push(withImagePart(m && m.role === 'system' && lateSystemRefused(connection) ? { ...m, role: 'user' } : m, 'openai'));
    /* M466: DEEPSEEK'S REASONER TAKES NO TWO OF A ROLE IN A ROW ("deepseek-reasoner does not support successive user or
     * assistant messages", a 400) — deepseek-chat and every other house take them. His own-voice entries (an assistant
     * message beside a storyteller page) and the state message beside his first page would meet that wall; for a
     * model named reasoner, neighbours of one role are folded into one message, a blank line between, order kept. */
    if (/reasoner/i.test(String(connection && connection.model || ''))) {
      for (let i = 1; i < wire.length; i += 1) {
        const prev = wire[i - 1]; const cur = wire[i];
        if (!prev || !cur || prev.role !== cur.role || prev.role === 'system' || typeof prev.content !== 'string' || typeof cur.content !== 'string') continue;
        wire[i - 1] = { ...prev, content: prev.content + '\n\n' + cur.content };
        wire.splice(i, 1);
        i -= 1;
      }
    }

    const startedAt = Date.now();
    const notes = [];
    /* M22: the rejection memory — a 400-style no citing the reasoning
     * params or the prefill marks the connection, and the turn goes out
     * ONE more time without them; then never again until the model field
     * changes. */
    let res = null;
    let opts = retryAs ? { ...retryAs } : {}; /* M590: a turn asked again the way that works carries how */
    /* M303: a refusal remembered for a spelling this connection no longer
     * speaks is let go before the turn — the house repairs what it can see */
    await healStaleRefusal(connection, reasonStyle(connection));
    await healStalePrefillRefusal(connection); /* M307 */
    let lead = ''; /* M307: the words the reply was started with, put back at its first word */
    let thoughtLead = ''; /* M328: and the words the THOUGHT was started with, at its first word */
    /* M329: DID IT WORK, ON THIS MODEL, ON THIS TURN? What was really sent, and what the model did with it */
    let sentPrefill = null;
    let modelThought = 0; /* characters of thinking the MODEL sent — the seed the house puts back is not counted */
    let sentWire = null; /* M347: the request exactly as the model took it (never the headers: the key stays home) */
    const wasRelay = Boolean(connection.viaRelay); /* M353: was the house already carrying this connection? */
    let askedPlan = null; /* M350: what was asked of the model's thinking on the turn it took */
    let structuredNow = null; /* M580: the structured prefill this turn went out with, if any */
    for (let attempt = 0; attempt < 5 && !res; attempt += 1) { /* M318: the beta address may say no, and the ordinary one may still refuse a dial; M350: a refusal may teach twice (values, a field) before the last resort */
      const { body, prefill, asked, structured } = requestBody(connection, wire, opts);
      /* M510-25: THE USAGE, ASKED FOR — most OpenAI-compatible providers say what a streamed call used only when asked;
       * without it the meter could only estimate the page (≈) and never saw the cache. Asked here, on the send loop's own
       * streamed body — never in requestBody, whose other callers (the Test, the speed probe) send their own or none, and
       * a body that does not stream must not carry it. An address that will not take it is taught once, below. */
      if (body.stream === true && !opts.noUsage) { const taught = learnedFacts(connection); if (!(taught && Array.isArray(taught.drop) && taught.drop.includes('stream_options'))) body.stream_options = { include_usage: true }; }
      /* M307: a started reply goes to DeepSeek's beta address, the only one that takes it */
      const beta = prefill.applied && prefillProfile(connection) === 'deepseek' ? deepseekBetaBase(connection.baseUrl) : '';
      const sentUrl = beta ? `${beta}/chat/completions` : `${base}/v1/chat/completions`; /* M347: outside the try — the answer's branch reads it */
      let out;
      try {
        out = await houseFetch(sentUrl, {
          method: 'POST',
          headers: headersOf(connection),
          signal,
          body: JSON.stringify(body),
        }, connection);
      } catch (err) {
        if (err && err.name === 'AbortError') throw err;
        throw new Error(`Couldn’t reach ${name} — check the connection and try again.`);
      }
      if (out.ok) {
        if (opts.usageTried && opts.noUsage) await learnFact(connection, { drop: ['stream_options'] }); /* M510-25 */
        sentWire = { url: sentUrl, body };
        askedPlan = asked;
        if (prefill.note) notes.push(prefill.note);
        lead = prefill.applied ? prefillLead(connection) : '';
        thoughtLead = prefill.applied && prefill.seed ? prefill.seed : '';
        sentPrefill = prefill.applied ? { seed: prefill.seed || '', content: prefill.content || '' } : { stayedHome: prefill.note || '' };
        if (structured) { structuredNow = structured; lead = ''; thoughtLead = ''; sentPrefill = { structured: true, content: structured.template }; if (structured.note) notes.push(structured.note); } /* M580: the model writes the opening itself — nothing is put back */
        res = out;
        break;
      }
      let detail = '';
      try {
        const j = await out.clone().json();
        detail = (j && j.error && j.error.message) || '';
      } catch (err) { /* not JSON — the status still tells a story */ }
      const fourHundred = out.status === 400 || out.status === 422;
      /* M580: A HOUSE THAT TAKES NO STRUCTURED ANSWER says so once; remembered for this model, and the same turn goes again
       * with the prefill as written (a started reply, or a thinking seed, where the house takes one) */
      if (structured && (fourHundred || out.status === 404) && STRUCTURED_REFUSAL.test(detail || String(out.status))) {
        connection.structuredDownModel = connection.model || '';
        await markConnectionDown(connection, 'structuredDownAt');
        try { await db.connections.update(connection.id, { structuredDownModel: connection.structuredDownModel }); } catch (err) { /* in hand for this turn */ }
        notes.push('This model would not take a structured prefill (' + (detail ? detail.slice(0, 120) : out.status) + '), so the turn went with the prefill as written — and it is sent so for this model from now on.');
        opts = { ...opts, suppressStructured: true };
        continue;
      }
      /* M380: A HOUSE THAT TAKES NO SYSTEM MESSAGE AFTER THE STORY says so once, is remembered, and the same turn goes again
       * with those words as a user message — his setting stands wherever it is taken */
      /* M510-38: A HOUSE THAT WANTS HIS TURN FIRST says so once (the order of the turns, in its words), is remembered for this
       * model at this address, and the same turn goes again opened by his one line */
      if (fourHundred && opensOnAssistant(wire) && !userFirstRequired(connection) && ORDER_REFUSAL.test(detail)) {
        await rememberUserFirst(connection);
        wire.splice(0, wire.length, ...withUserFirst(wire)); /* the same array the next attempt is built from */
        continue;
      }
      const lateSystem = wire.some((m, i) => i > 0 && m && m.role === 'system');
      if (fourHundred && lateSystem && !lateSystemRefused(connection) && /system/i.test(detail)) {
        await rememberLateSystemRefused(connection); /* M385: for THIS model at this address */
        for (let i = 1; i < wire.length; i += 1) if (wire[i] && wire[i].role === 'system') wire[i] = { ...wire[i], role: 'user' };
        continue;
      }
      /* M510-25: the usage request refused by name — remembered for this address, and the turn goes again without it */
      if (fourHundred && body.stream_options && /stream_options|include_usage/i.test(detail)) {
        await learnFact(connection, { drop: ['stream_options'] });
        continue;
      }
      /* M510: A DIAL THIS HOUSE DOES NOT TAKE — read BEFORE the thinking's lesson, so a refusal that names a dial ("top_k
       * is not supported when thinking is enabled") takes that dial away, never his thinking. The refusal names it; that
       * one dial is left out from now on (until the model or the address changes) and the turn goes again — the rest of
       * his dials still ride. */
      const sentKnobs = KNOB_FIELDS.filter((f) => f in body);
      if (fourHundred && sentKnobs.length && (opts.knobLessons || 0) < sentKnobs.length) {
        const refused = knobRefused(detail, sentKnobs);
        if (refused) {
          await learnFact(connection, { drop: [refused] });
          notes.push('This address does not take “' + refused + '”, so the turn went again without it — it is left out from now on, and the rest of your dials still ride.');
          opts = { ...opts, knobLessons: (opts.knobLessons || 0) + 1 };
          continue;
        }
      }
      const sentReasoning = Boolean(
        body.reasoning_effort || body.reasoning || body.thinking
        || 'enable_thinking' in body || (body.model_options && body.model_options.reasoning)
      );
      /* M318: THE BETA ADDRESS IS ASKED FIRST ABOUT ITSELF. This block stood LAST — so a no from DeepSeek's beta
       * address was first read by the block below as "this house refuses thinking" and REMEMBERED: the
       * connection's thinking silenced at every level until the model changed, for something the ordinary
       * address takes without complaint. Whatever the beta address says no to, the turn goes again at the
       * ordinary address without the prefill; only a no that names the prefix is remembered, and only
       * against the prefill. */
      if (beta && !opts.suppressPrefill && (fourHundred || out.status === 404)) {
        if (fourHundred && PREFILL_REFUSAL.test(detail)) {
          await markConnectionDown(connection, 'prefillDownAt', 'deepseek-beta');
          notes.push('A reply that starts before the storyteller wasn’t accepted — the prefill is off for this connection until the model changes.');
        } else {
          notes.push('DeepSeek’s beta address would not take this turn (' + out.status + '), so it went without the prefill this once.');
        }
        opts = { ...opts, suppressPrefill: true };
        continue;
      }
      /* M350: a refusal is about the thinking when it names a thinking field — or when it names the very level the house
       * sent and offers others ("Invalid value: 'medium'. Supported values are: 'low', 'high', and 'max'." names no field
       * at all: before, such a no was thrown at the writer as a failed page) */
      const lesson = fourHundred && sentReasoning ? lessonFrom(detail, body) : null;
      const sentLevel = typeof body.reasoning_effort === 'string' ? body.reasoning_effort : (body.reasoning && typeof body.reasoning.effort === 'string' ? body.reasoning.effort : '');
      const namesItsLevel = Boolean(lesson && lesson.allowed && sentLevel && new RegExp('\\b' + sentLevel + '\\b', 'i').test(detail));
      if (fourHundred && !opts.suppressReasoning && sentReasoning && (REASONING_REFUSAL.test(detail) || namesItsLevel)) {
        /* M350: before the thinking is given up, the refusal is READ — it usually says what the model takes */
        if (lesson.allowed && !opts.taughtValues) {
          await learnFact(connection, { efforts: lesson.allowed });
          notes.push('The model said which thinking levels it takes (' + lesson.allowed.join(', ') + '), so the turn went again at the nearest of them — and only those are sent from now on.');
          opts = { ...opts, taughtValues: true };
          continue;
        }
        if (lesson.badField && !opts.taughtField) {
          await learnFact(connection, { drop: [lesson.badField] });
          notes.push('This address does not take “' + lesson.badField + '”, so the turn went again without it — it is left out from now on, and the rest of the thinking settings still ride.');
          opts = { ...opts, taughtField: true };
          continue;
        }
        await markConnectionDown(connection, 'reasoningDownAt', reasonStyle(connection));
        notes.push('The thinking settings weren’t accepted, so this turn went without them — it won’t be asked again until the model changes.');
        opts = { ...opts, suppressReasoning: true };
        continue;
      }
      if (fourHundred && !opts.suppressPrefill && prefill.applied && PREFILL_REFUSAL.test(detail)) {
        await markConnectionDown(connection, 'prefillDownAt', beta ? 'deepseek-beta' : '');
        notes.push('A reply that starts before the storyteller wasn’t accepted — the prefill is off for this connection until the model changes.');
        opts = { ...opts, suppressPrefill: true };
        continue;
      }
      /* M510-25: a refusal that names nothing while the usage request rode: once more without it before giving up — and
       * when that goes through, the address is taught */
      if (fourHundred && body.stream_options && !opts.usageTried) { opts = { ...opts, noUsage: true, usageTried: true }; continue; }
      throw transportError(out, await explain(out, name));
    }
    if (!res) throw new Error(`The answer was no, without a reason (400).`);

    let full = '';
    let thinking = '';
    let refusal = '';
    let finishReason = null;
    let ttftMs = null;
    let tfftMs = null;
    let nativeThoughts = false;
    const emit = (channel, text) => {
      if (!text) return;
      if (channel === 'thinking') {
        if (tfftMs === null) tfftMs = Date.now() - startedAt;
        modelThought += text.length;
        /* M328: the model continues the writer's seed — what it sends back is only what comes AFTER it */
        if (thoughtLead) {
          const put = thoughtLead; thoughtLead = '';
          if (!text.startsWith(put)) { const back = put + (/^\s/.test(text) ? '' : ' '); thinking += back; if (onToken) onToken({ channel, text: back }); }
        }
        thinking += text;
      } else {
        if (ttftMs === null) ttftMs = Date.now() - startedAt;
        /* M307: at the reply's FIRST word, never before — put back ahead of the
         * thinking it would have read as prose already begun, and stopped the
         * thinking's clock; a house that echoes the prefill itself is not doubled */
        if (lead) {
          const put = lead; lead = '';
          if (!text.startsWith(put)) { const back = put + (/^\s/.test(text) ? '' : prefillGap(connection)); full += back; if (onToken) onToken({ channel, text: back }); }
        }
        full += text;
      }
      if (onToken) onToken({ channel, text });
    };
    /* The tag splitter only listens while no native reasoning channel has
     * spoken (SPEC.md M8.5: V176 interop is the fallback, never the rule). */
    const splitter = makeThinkSplitter(emit);
    /* M580: a structured answer is JSON — its words are read out of it as they stream (and the hidden part held back) */
    const decoder = structuredNow ? makeStructuredDecoder({ hidden: structuredNow.hidden }) : null;
    /* M586: THINK AND THINK. A structured answer that opens with a <think>…</think> block (his template's — a thinking seed in
     * his own words, or a brainstorm the schema holds to its shape) has that block put in the thinking box ALWAYS — beside
     * the model's own native thinking when it has some (that came first; the block follows it, a blank line between) —
     * and the page is what follows. The model thinks twice: in its own channel, and in his words. */
    let structuredThinkSep = false;
    let structuredProseBegun = false;
    const structuredEmit = (channel, text) => {
      if (channel === 'thinking' && !structuredThinkSep) { structuredThinkSep = true; if (thinking && !/\n\s*$/.test(thinking)) text = '\n\n' + text; }
      if (channel === 'prose' && !structuredProseBegun) { text = text.replace(/^\s+/, ''); if (!text) return; structuredProseBegun = true; } /* the line break after </think> is not the page's */
      emit(channel, text);
    };
    const structuredSplitter = decoder ? makeThinkSplitter(structuredEmit) : null;
    const prose = (text) => { const words = decoder ? decoder.feed(text) : text; if (!words) return; if (structuredSplitter) structuredSplitter.feed(words); else if (nativeThoughts) emit('prose', words); else splitter.feed(words); };
    /* M585: A STRUCTURED ANSWER THAT NEVER ENDS. His report: "sometimes in the middle of the reply it's stuck… waited 14
     * minutes, it stopped at 40%". Two ways it happens, both known to the extension (its stream guard): the model closes
     * the answer's text early — a dialogue quote written bare instead of escaped ends a JSON string — and then, held by the
     * schema to nothing but the object's close, pads with whitespace until its token limit; or it thrashes against the
     * pattern, sending characters that never become words. Now: the moment the text closes, the stream is let go and the
     * page is whole as it stands (Go on asks for more); and a structured answer whose words have not grown for 20 seconds
     * while it keeps sending is stopped, its words kept, the page marked cut short and said. */
    let rawSinceWords = 0; let wordsAt = Date.now(); let wordsLen = 0; let stalled = false;
    const STALL_MS = Number(globalThis.__cozyStructuredStallMs) > 0 ? Number(globalThis.__cozyStructuredStallMs) : 20000;
    const readStructured = () => {
      if (!decoder) return undefined;
      if (decoder.closed()) return 'stop';
      const n = decoder.wordsSoFar();
      if (n > wordsLen) { wordsLen = n; wordsAt = Date.now(); rawSinceWords = 0; return undefined; }
      if (Date.now() - wordsAt > STALL_MS && rawSinceWords > 400) { stalled = true; return 'stop'; }
      return undefined;
    };
    await readSSE(res.body, (data) => {
      const piece = data && data.choices && data.choices[0];
      const delta = piece && piece.delta;
      /* M9 (B9): why it stopped, when the stream says — 'length' means the
       * page ran out of room and the chat view will say so. */
      if (piece && typeof piece.finish_reason === 'string' && piece.finish_reason) {
        finishReason = piece.finish_reason;
      }
      if (delta) {
        let thought = delta.reasoning_content ?? delta.reasoning;
        /* M350: a house that names its thinking channel differently (reasoning_text, thought, thinking…) is read too — a
         * new provider's field is not a reason for the thinking to vanish */
        if (thought == null) {
          for (const [k, v] of Object.entries(delta)) {
            if (k !== 'content' && k !== 'role' && k !== 'refusal' && typeof v === 'string' && v && /reason|think|thought/i.test(k)) { thought = v; break; }
          }
        }
        if (typeof thought === 'string' && thought) {
          nativeThoughts = true;
          emit('thinking', thought);
        }
        const text = delta.content;
        if (typeof text === 'string' && text) { if (decoder) rawSinceWords += text.length; prose(text); }
      }
      if (data && data.error) {
        refusal = data.error.message || 'The storyteller stumbled mid-sentence.';
      }
      return readStructured(); /* M585 */
    });
    /* M590: every word flushed first — what the decoder and the splitters still hold is the page before anything is judged */
    if (decoder) { const rest = decoder.end(); if (rest) structuredSplitter.feed(rest); structuredSplitter.end(); }
    splitter.end();
    if (decoder && (decoder.closed() || stalled)) relay(); /* M585: the line cut — nothing more is wanted from it */
    /* M590 (his report: "I just said hi and it can't give output — on the provider's own chat it's ok"): THE WORDS ARE
     * NEVER LOST, AND A SCHEMA NOT HELD IS NOTICED. Three ways a structured turn came back as thinking with no page:
     * the provider ignored the schema and the model answered under another key (now read, structured.js end()); the
     * model put its JSON answer in the thinking channel (now taken out of the thinking and made the page); a template's
     * <think> never closed because nothing held it (all of it went to the thinking box). Whatever the case, an answer
     * that does not open as the template asks means this provider does not hold the schema for this model — it is
     * remembered (as a refusal is) and the turn after goes as written; he is told once. */
    if (structuredNow && decoder) {
      if (!full.trim() && /\{\s*"(?:response|value|content|text)"\s*:/.test(thinking)) {
        const at = thinking.search(/\{\s*"(?:response|value|content|text)"\s*:/);
        const fromThought = unwrapStructured(thinking.slice(at), { hidden: structuredNow.hidden });
        if (fromThought.trim()) {
          const split = { t: '', p: '' };
          const sp = makeThinkSplitter((ch, txt) => { if (ch === 'thinking') split.t += txt; else split.p += txt; });
          sp.feed(fromThought); sp.end();
          full = split.p.replace(/^\s+/, '');
          thinking = thinking.slice(0, at).replace(/\s+$/, '') + (split.t ? (thinking.slice(0, at).trim() ? '\n\n' : '') + split.t : '');
          if (finishReason !== 'length') finishReason = 'stop';
        }
      }
      let held = true;
      try { held = new RegExp(structuredNow.schema.properties.response.pattern).test(decoder.allWords() || full); } catch (err) { held = true; }
      if (!held && (decoder.allWords() || full || thinking).trim()) {
        connection.structuredDownModel = connection.model || '';
        try { await markConnectionDown(connection, 'structuredDownAt'); } catch (err) { /* in hand for this turn */ }
        try { await db.connections.update(connection.id, { structuredDownModel: connection.structuredDownModel }); } catch (err) { /* in hand */ }
        notes.push('This model’s provider did not hold the structured prefill — its answer did not open as your template asks (so the prefill did nothing, and could leave the page in the thinking box). It is sent as written for this model from now on.');
        if (!full.trim() && !retryAs) {
          /* M590: and the page he is waiting for is asked again at once, as written — never left to an "Ask again" */
          const again = await streamChat({ systemBlocks: blocks, system, messages, signal: callerSignal, onToken, retryAs: { suppressStructured: true } });
          return { ...again, thinking: (thinking.trim() ? thinking.replace(/\s+$/, '') + '\n\n' : '') + (again.thinking || ''), notes: [...notes, ...(again.notes || [])] };
        }
      }
    }
    /* M590: A THINKING SEED THAT LEFT NO PAGE. A model handed his <think> seed thought on and ended (stop) with no page —
     * on the provider's own chat, with no seed, it answers. The same turn is asked once more without the seed, and he is
     * told; nothing is changed on his connection (the next turn tries his seed again — it may have been this page alone). */
    if (!full.trim() && thinking.trim() && finishReason === 'stop' && !retryAs && sentPrefill && sentPrefill.seed && !structuredNow) {
      notes.push('The thinking seed left this model with no page — it thought on from your seed and stopped. The page was asked again without the seed.');
      const again = await streamChat({ systemBlocks: blocks, system, messages, signal: callerSignal, onToken, retryAs: { suppressPrefill: true } });
      return { ...again, thinking: thinking.replace(/\s+$/, '') + '\n\n' + (again.thinking || ''), notes: [...notes, ...(again.notes || [])] };
    }
    if (decoder && decoder.closed()) {
      /* M585: the answer's text closed. A page that ends on a sentence's close is complete; one that closed mid-sentence
       * (a bare quote ends a JSON string) is marked cut short and said, so Go on is offered for the rest */
      if (/[.!?…"”'’*)\]~—–-]\s*$/.test(full)) { if (!finishReason) finishReason = 'stop'; }
      else if (full.trim()) { finishReason = 'length'; notes.push('The structured answer closed in the middle of a sentence (a quote the model wrote bare ends its text) — the words before were kept. Say “go on” for the rest.'); }
    }
    if (stalled) {
      finishReason = 'length';
      notes.push('The structured answer stopped making progress (it kept sending, but no more words came), so it was stopped — the words before were kept. Say “go on” to carry the page forward.');
    }
    /* M160: A PAGE THE WIRE BROKE IS NEVER SHOWN AS WHOLE. An error frame
     * arriving mid-stream was thrown only when nothing had landed yet; with
     * prose already on the page the refusal was dropped on the floor, the
     * finish reason stayed empty, and a page that stopped in the middle of a
     * sentence was saved, read by every worker and folded into the record as
     * if the storyteller had finished it. The words before the break are
     * still kept — they are the story — but the page is marked cut short and
     * the break is said out loud. */
    if (refusal && full) {
      finishReason = finishReason || 'length';
      notes.push('The wire broke mid-page — the words before the break were kept. Say “go on” to carry the page forward.');
    }
    if (!wasRelay && connection.viaRelay) notes.push('This address refuses calls from a web page, so your own tavern server carried the turn — the key never left this phone. Every later turn on this connection goes the same way.'); /* M353 */
    if (refusal && !full) throw new Error(refusal);
    /* M350: AN OFF THAT DID NOT STOP THE THINKING IS NOTICED. The dial said Off (not opened for a seed), the request said
     * so, and the model thought anyway: from now on Off asks it for the least it takes — never its own default, which for
     * the models that cannot stop is their most. A model the house already knows cannot stop is not "taught" again. */
    if (askedPlan && askedPlan.set === 'off' && !askedPlan.opened && !askedPlan.suppressed && modelThought > 0 && !alwaysThinks(connection)) {
      const was = learnedFacts(connection);
      if (!was || !was.offThinks) {
        await learnFact(connection, { offThinks: true });
        notes.push('Off did not stop this model thinking — from now on Off asks it for the least thinking it takes, rather than leaving it to its own default.');
      }
    }
    const durationMs = Date.now() - startedAt;
    return {
      text: full,
      thinking,
      finishReason,
      notes,
      prefill: prefillReport(connection, sentPrefill, modelThought, full),
      sent: sentWire, /* M347 */
      sources: [],
      ttftMs: ttftMs === null ? durationMs : ttftMs,
      tfftMs,
      durationMs,
    };
  }

  /* M22-D: "Test it" — a tiny non-streamed probe carrying the prefill per
   * this house's profile, reporting plainly. A refusal marks the
   * connection's memory. */
  async function testPrefill() {
    const prefill = String(connection.prefill || '').trim();
    if (!prefill) return { ok: false, detail: 'There’s no prefill to try — write one first.' };
    /* M587 (the prefill audit): "Test the prefill" on a Structured connection tested the WRONG way — it looked for an
     * assistant message (which a structured turn never sends) and answered "no known way to start the reply". It asks the
     * structured way now, with the very schema a page carries, and reads what came back. */
    const plan = structuredPlanFor(connection);
    if (plan) {
      const { body: sbody } = requestBody(connection, [{ role: 'user', content: 'Write one short paragraph of a story — a gate at dawn.' }]);
      sbody.stream = false;
      sbody.max_tokens = 600;
      delete sbody.plugins;
      let sres;
      try {
        sres = await houseFetch(`${base}/v1/chat/completions`, { method: 'POST', headers: headersOf(connection), body: JSON.stringify(sbody) }, connection);
      } catch (err) {
        return { ok: false, detail: `Couldn’t reach ${name} — check the connection and try again.` };
      }
      if (!sres.ok) {
        let detail = '';
        try { const j = await sres.clone().json(); detail = (j && j.error && j.error.message) || ''; } catch (err) { /* the status speaks */ }
        if (STRUCTURED_REFUSAL.test(detail || String(sres.status))) {
          connection.structuredDownModel = connection.model || '';
          await markConnectionDown(connection, 'structuredDownAt');
          try { await db.connections.update(connection.id, { structuredDownModel: connection.structuredDownModel }); } catch (err) { /* in hand */ }
          return { ok: false, detail: 'This model would not take a structured prefill (' + (detail ? detail.slice(0, 140) : sres.status) + ') — its pages will get the prefill as written.' };
        }
        return { ok: false, detail: `${name} refused the test (${sres.status})${detail ? ': ' + detail.slice(0, 140) : ''}.` };
      }
      let j = null;
      try { j = await sres.json(); } catch (err) { j = null; }
      const said = (j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      const words = unwrapStructured(said, { hidden: plan.hidden });
      const opening = readTemplate(plan.template).shown.split(/\[\[/)[0].replace(/<\/?think>/g, '').trim();
      const held = new RegExp(plan.schema.properties.response.pattern).test(unwrapStructured(said));
      if (held) return { ok: true, detail: 'Structured works on this model — its answer opened ' + (opening ? 'with “' + opening.slice(0, 60) + '”' : 'as your template asks') + ': “' + words.replace(/\s+/g, ' ').slice(0, 120) + '…”' };
      return { ok: false, detail: 'The model answered, but not in the shape asked (the provider did not hold it to the schema): “' + String(said).replace(/\s+/g, ' ').slice(0, 120) + '”. Its pages may not open with your words — As written may serve better here.' };
    }
    const { body } = requestBody(connection, [
      { role: 'user', content: 'A' },
      { role: 'assistant', content: 'B' },
      { role: 'user', content: 'C' },
    ]);
    body.stream = false;
    body.max_tokens = 8;
    const started = body.messages.length ? body.messages[body.messages.length - 1] : null;
    if (!started || started.role !== 'assistant') {
      /* M328: the reason is the plan's own — the same words the turn would give */
      const why = prefillPlan(connection).why;
      return { ok: false, detail: why ? why + ' Nothing was sent.' : 'This address has no known way to start the reply for it — nothing was sent.' };
    }
    /* M328: a probe that carries a thinking SEED keeps its thinking params — the seed needs the channel it is sent in;
     * a plain started reply is probed without them, as before */
    const seededField = Object.keys(started).find((k) => !['role', 'content', 'partial', 'prefix'].includes(k) && typeof started[k] === 'string') || '';
    const seeded = Boolean(seededField);
    if (seeded) body.max_tokens = 96; /* M329: room for a first few words of thinking to come back and be seen */
    if (!seeded) {
      delete body.reasoning;
      delete body.reasoning_effort;
      delete body.thinking;
      delete body.enable_thinking;
      delete body.model_options;
    }
    delete body.plugins;
    /* M307: THE PROBE GOES WHERE THE TURN GOES. It asked DeepSeek's ordinary
     * address, which never takes a started reply — so "Test it" answered
     * "won't take a prefill" and switched the prefill OFF for the connection. */
    const beta = prefillProfile(connection) === 'deepseek' ? deepseekBetaBase(connection.baseUrl) : '';
    let res;
    try {
      res = await houseFetch(beta ? `${beta}/chat/completions` : `${base}/v1/chat/completions`, {
        method: 'POST',
        headers: headersOf(connection),
        body: JSON.stringify(body),
      }, connection);
    } catch (err) {
      return { ok: false, detail: `Couldn’t reach ${name} — check the connection and try again.` };
    }
    if (res.ok) {
      /* M329: "TOOK IT" SAID MORE THAN IT KNEW. Any 200 was reported as "the reply picked up where the prefill left
       * off" — without one look at the reply. The probe is read now: for a seed, did the model THINK ON from
       * it; for a started reply, what came after the writer's words. */
      let msg = null;
      try { const j = await res.json(); msg = j && j.choices && j.choices[0] && j.choices[0].message; } catch (err) { msg = null; }
      const thought = String((msg && (msg.reasoning_content || msg.reasoning || (seededField && msg[seededField]))) || '').trim();
      const saidBack = String((msg && msg.content) || '').trim();
      const clip = (t) => (t.length > 70 ? t.slice(0, 70) + '…' : t);
      if (seeded) {
        if (thought) return { ok: true, detail: 'Working — the model took your seed and thought on from it: “…' + clip(thought) + '”' };
        if (saidBack) return { ok: false, detail: 'Accepted, but NO thinking came back — this model answered straight away (“' + clip(saidBack) + '”), so a seed steers nothing here. It may not think, or this address drops the thinking field.' };
        return { ok: false, detail: 'Accepted, but nothing came back in this short probe — it cannot tell whether the seed was used.' };
      }
      const started = String(body.messages[body.messages.length - 1].content || '');
      if (saidBack && started && saidBack.startsWith(started)) return { ok: true, detail: 'Took it — this address echoes your words back before going on (the house never doubles them).' };
      return { ok: true, detail: saidBack ? 'Working — the reply went on from your words: “' + clip(started) + '” → “' + clip(saidBack) + '”' : 'Took it — the address accepted a started reply (nothing came back in this short probe to show).' };
    }
    let detail = '';
    try {
      const j = await res.json();
      detail = (j && j.error && j.error.message) || '';
    } catch (err) { /* the status speaks for itself */ }
    if ((res.status === 400 || res.status === 422) && PREFILL_REFUSAL.test(detail)) {
      await markConnectionDown(connection, 'prefillDownAt', beta ? 'deepseek-beta' : '');
      return { ok: false, detail: 'Won’t take a prefill — sent without it from here on, until the model changes.' };
    }
    return { ok: false, detail: await explain(res, name) };
  }

  /* "Fetch what's on offer" (M8): GET {base}/v1/models. Throws with human
   * words on failure — the editor keeps the hand-typed field either way. */
  async function listModels() {
    let res;
    try {
      res = await houseFetch(`${base}/v1/models`, { headers: headersOf(connection) }, connection);
    } catch (err) {
      throw new Error(`Couldn’t reach ${name} — check the connection and try again.`);
    }
    if (!res.ok) throw new Error(await explain(res, name));
    const body = await res.json();
    const rows = body && Array.isArray(body.data) ? body.data : [];
    return rows
      .filter((m) => m && typeof m.id === 'string' && m.id)
      .map((m) => ({ id: m.id, label: m.id, context: reportedContext(m), ...reportedIdentity(m) })); /* M289: the room it reports; M348: what it is */
  }

  return { test, listModels, streamChat, testPrefill };
}
