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

import { reportedContext } from './room.js'; /* M289 */
import { readSSE } from './sse.js';
import { withImagePart, transportError } from './wire.js';
/* M22-A/D: the full reasoning ladder (per-house spellings, alias-down,
 * rejection memory) and the storyteller prefill live in effort.js. */
import {
  reasonStyle, effortFor, REASONING_REFUSAL, PREFILL_REFUSAL, hostIsOpenAI,
  applyPrefill, prefillPlan, markConnectionDown, reasoningIsDown, healStaleRefusal, budgetFor, prefillLead, prefillGap, prefillProfile, deepseekBetaBase, healStalePrefillRefusal, thinkingLead,
} from './effort.js';

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
function requestBody(connection, wireMessages, opts = {}) {
  /* M328: a retry that withholds the thinking params withholds the thinking SEED with them (a seed with no channel);
   * what follows the seed — a started reply — still rides */
  const asSent = opts.suppressReasoning && connection ? { ...connection, reasoningDownAt: Date.now(), reasoningDownShape: reasonStyle(connection) } : connection;
  const pf = opts.suppressPrefill
    ? { messages: wireMessages, applied: false }
    : applyPrefill(wireMessages, asSent);
  const body = {
    model: connection.model || 'gpt-4o-mini',
    messages: pf.messages,
    stream: true,
  };
  if (typeof connection.temperature === 'number') body.temperature = connection.temperature;
  if (typeof connection.topP === 'number') body.top_p = connection.topP;
  if (typeof connection.maxTokens === 'number' && connection.maxTokens > 0) {
    body.max_tokens = Math.round(connection.maxTokens);
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
  const effort = suppressed ? 'off' : effortFor(style, wanted);
  if (style === 'none') {
    /* the model decides on its own — nothing extra is ever sent */
  } else if (suppressed) {
    /* the wire refused these params once — nothing is spent on them again */
  } else if (style === 'openrouter') {
    const budget = budgetFor(connection).tokens; /* M308: only for a model that can hear one — for the rest the writer's LEVEL is what is sent */
    body.reasoning = effort === 'off'
      ? { enabled: false }
      : (budget ? { max_tokens: budget } : { effort });
  } else if (style === 'zai') {
    body.thinking = { type: effort === 'off' ? 'disabled' : 'enabled' };
    if (effort !== 'off' && effort !== 'low') body.reasoning_effort = effort;
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
  /* M22-C: "let it look things up" — OpenRouter's web plugin. Only the
   * openrouter host shape carries it; other openai-compatible addresses
   * hide the control in the form. */
  if (connection && connection.searchOn && style === 'openrouter') {
    body.plugins = [{ id: 'web' }];
  }
  return { body, prefill: opened && !suppressed ? { ...pf, note: [pf.note, 'Thinking was switched on (at its lightest) for this turn, so the thinking seed has a channel to land in.'].filter(Boolean).join(' ') } : pf };
}

/* M329: what the prefill did on this turn, in words — kept on the page's receipt ("What the storyteller saw") */
function prefillReport(connection, sent, modelThought, full) {
  if (!String(connection && connection.prefill != null ? connection.prefill : '').trim()) return null;
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

  function payload(extra) {
    return JSON.stringify({
      model: connection.model || 'gpt-4o-mini',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'Evening.' }],
      ...extra,
    });
  }

  async function test() {
    try {
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: headersOf(connection),
        body: payload(),
      });
      if (!res.ok) return { ok: false, detail: await explain(res, name) };
      return { ok: true, detail: 'They answered — the line is good.' };
    } catch (err) {
      return { ok: false, detail: `Couldn’t reach ${name} — check the connection and try again.` };
    }
  }

  async function streamChat({ systemBlocks: blocks, system, messages, signal, onToken }) {
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
    for (const m of messages) wire.push(withImagePart(m, 'openai'));

    const startedAt = Date.now();
    const notes = [];
    /* M22: the rejection memory — a 400-style no citing the reasoning
     * params or the prefill marks the connection, and the turn goes out
     * ONE more time without them; then never again until the model field
     * changes. */
    let res = null;
    let opts = {};
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
    for (let attempt = 0; attempt < 3 && !res; attempt += 1) { /* M318: three — the beta address may say no, and then the ordinary one may still refuse a dial */
      const { body, prefill } = requestBody(connection, wire, opts);
      /* M307: a started reply goes to DeepSeek's beta address, the only one that takes it */
      const beta = prefill.applied && prefillProfile(connection) === 'deepseek' ? deepseekBetaBase(connection.baseUrl) : '';
      const sentUrl = beta ? `${beta}/chat/completions` : `${base}/v1/chat/completions`; /* M347: outside the try — the answer's branch reads it */
      let out;
      try {
        out = await fetch(sentUrl, {
          method: 'POST',
          headers: headersOf(connection),
          signal,
          body: JSON.stringify(body),
        });
      } catch (err) {
        if (err && err.name === 'AbortError') throw err;
        throw new Error(`Couldn’t reach ${name} — check the connection and try again.`);
      }
      if (out.ok) {
        sentWire = { url: sentUrl, body };
        if (prefill.note) notes.push(prefill.note);
        lead = prefill.applied ? prefillLead(connection) : '';
        thoughtLead = prefill.applied && prefill.seed ? prefill.seed : '';
        sentPrefill = prefill.applied ? { seed: prefill.seed || '', content: prefill.content || '' } : { stayedHome: prefill.note || '' };
        res = out;
        break;
      }
      let detail = '';
      try {
        const j = await out.clone().json();
        detail = (j && j.error && j.error.message) || '';
      } catch (err) { /* not JSON — the status still tells a story */ }
      const fourHundred = out.status === 400 || out.status === 422;
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
      if (fourHundred && !opts.suppressReasoning && sentReasoning && REASONING_REFUSAL.test(detail)) {
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
    await readSSE(res.body, (data) => {
      const piece = data && data.choices && data.choices[0];
      const delta = piece && piece.delta;
      /* M9 (B9): why it stopped, when the stream says — 'length' means the
       * page ran out of room and the chat view will say so. */
      if (piece && typeof piece.finish_reason === 'string' && piece.finish_reason) {
        finishReason = piece.finish_reason;
      }
      if (delta) {
        const thought = delta.reasoning_content ?? delta.reasoning;
        if (typeof thought === 'string' && thought) {
          nativeThoughts = true;
          emit('thinking', thought);
        }
        const text = delta.content;
        if (typeof text === 'string' && text) {
          if (nativeThoughts) emit('prose', text);
          else splitter.feed(text);
        }
      }
      if (data && data.error) {
        refusal = data.error.message || 'The storyteller stumbled mid-sentence.';
      }
    });
    splitter.end();
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
    if (refusal && !full) throw new Error(refusal);
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
      res = await fetch(beta ? `${beta}/chat/completions` : `${base}/v1/chat/completions`, {
        method: 'POST',
        headers: headersOf(connection),
        body: JSON.stringify(body),
      });
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
      res = await fetch(`${base}/v1/models`, { headers: headersOf(connection) });
    } catch (err) {
      throw new Error(`Couldn’t reach ${name} — check the connection and try again.`);
    }
    if (!res.ok) throw new Error(await explain(res, name));
    const body = await res.json();
    const rows = body && Array.isArray(body.data) ? body.data : [];
    return rows
      .filter((m) => m && typeof m.id === 'string' && m.id)
      .map((m) => ({ id: m.id, label: m.id, context: reportedContext(m) })); /* M289: the room it reports */
  }

  return { test, listModels, streamChat, testPrefill };
}
