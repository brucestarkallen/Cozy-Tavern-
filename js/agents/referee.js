/* Cozy Tavern — agents/referee.js
 * The referee. When a moment is genuinely contested — the writer called for
 * a roll inline ("#roll I leap the gap"), or talk has given way to a fight —
 * the house rules on the attempt BEFORE the storyteller narrates, and the
 * ruling rides into the turn as plain fact. It never flatters the player:
 * the board sets the mark, a real die (crypto.getRandomValues, never the
 * model) decides, and the outcome words say what the margin earned.
 *
 * This is the ONLY agent that may run before the story generation, and only
 * when triggered (the latency law, SPEC.md M6). The call is tiny —
 * max_tokens 150, temperature 0 — and its failure never blocks the turn:
 * any trouble resolves null, and the story simply proceeds without a ruling.
 *
 * Contract (SPEC.md M6):
 *   shouldAdjudicate({userText, state})
 *     -> true iff inline "#roll" is present, OR state.mode.combat === true
 *   adjudicate({connection, userText, state, signal})
 *     -> {dc, roll, margin, outcome, words} | null on any failure
 *        (never throws; failure = no verdict, the turn proceeds)
 *
 * The board -> DC rungs: 5 clearly favored, 10 even, 14 disadvantaged,
 * 18 outclassed. The model only reads the board and picks a rung (JSON
 * {"dc":n,"reason":"..."}); a rung it invents is snapped to the nearest
 * honest one. The d20 is rolled HERE, in code. Margin = roll - DC, mapped:
 *   >= +10 decisive | +5..+9 clean | +1..+4 a success with a cost |
 *   0..-4 partial | -5..-9 failure | -10..-14 failure with consequences |
 *   <= -15 catastrophic.
 *
 * The verdict is stored on state.pendingVerdict by the send path (chat.js);
 * buildRequest renders it as a fact line in the state-of-things block
 * ("The house has ruled: …") and it is cleared after that turn. The
 * receipt's slot 5 thereby records it.
 */

import { renderStateFacts } from '../engine/state.js';

const MAX_TOKENS = 150;
const TEMPERATURE = 0;

/* The four honest rungs of the board. */
export const DC_RUNGS = [5, 10, 14, 18];
export const DC_WORDS = {
  5: 'clearly favored',
  10: 'even odds',
  14: 'disadvantaged',
  18: 'outclassed',
};

/* ---------- the die (crypto, rolled in code — never by the model) ---------- */

/* Rejection sampling over a 32-bit draw, so every face of the d20 is exactly
 * as likely as every other. */
export function rollD20() {
  const range = 20;
  const limit = Math.floor(0x100000000 / range) * range;
  const buf = new Uint32Array(1);
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return (buf[0] % range) + 1;
}

/* ---------- the curve ---------- */

/* Snap whatever the model offered to the nearest honest rung. */
export function snapDC(dc) {
  const n = Number(dc);
  if (!Number.isFinite(n)) return null;
  let best = DC_RUNGS[0];
  for (const rung of DC_RUNGS) {
    if (Math.abs(n - rung) < Math.abs(n - best)) best = rung;
  }
  return best;
}

/* Margin = roll - DC, mapped to the outcome the margin earned. */
export function marginOutcome(margin) {
  const m = Number(margin);
  if (!Number.isFinite(m)) return null;
  if (m >= 10) return 'decisive';
  if (m >= 5) return 'clean';
  if (m >= 1) return 'costly';
  if (m >= -4) return 'partial';
  if (m >= -9) return 'failure';
  if (m >= -14) return 'consequences';
  return 'catastrophic';
}

export const OUTCOME_WORDS = {
  decisive: 'a decisive success',
  clean: 'a clean success',
  costly: 'a success, with a cost',
  partial: 'a partial success',
  failure: 'a failure',
  consequences: 'a failure, with consequences',
  catastrophic: 'a catastrophic failure',
};

/* ---------- the trigger (the law: #roll inline, or a fight on) ---------- */

export function shouldAdjudicate({ userText, state } = {}) {
  const text = typeof userText === 'string' ? userText : '';
  if (/#roll\b/i.test(text)) return true;
  return Boolean(state && state.mode && state.mode.combat === true);
}

/* ---------- the tiny prompt (the model reads the board; it never rolls) ---------- */

const SYSTEM_PROMPT = [
  'You are the referee for a slow, warm story told between two writers. A chancy',
  'moment has been called, and your whole job is to set the mark — how hard the',
  'attempt honestly is, given everything the ledger knows. You do not narrate and',
  'you never roll the die; the house rolls it in code after you answer.',
  '',
  'Answer with JSON ONLY, in exactly this shape:',
  '{"dc":10,"reason":"the gap is wide but the roofline is near"}',
  '',
  'The mark (dc) is one of four rungs — choose the honest one:',
  '5 = clearly favored (the board leans their way)',
  '10 = even (a fair contest)',
  '14 = disadvantaged (the board leans against them)',
  '18 = outclassed (it would take something like luck)',
  '',
  'Read the board coldly: hurts that haven\'t healed, weariness, who stands where,',
  'the mood of the scene, what is locked true of them. Never flatter the attempt.',
  'The reason is a few plain words naming what set the mark. No commentary, no',
  'markdown fences: the JSON object only.',
].join('\n');

/* Exported for the harness: the two messages any provider flavor receives. */
export function buildRefereeMessages({ state, userText }) {
  const facts = renderStateFacts(state) || 'Nothing is written in the ledger yet.';
  const user = [
    'Here is what the ledger currently says:',
    facts,
    '',
    'The attempt, as the writer made it:',
    '"""',
    String(userText || '').slice(0, 2000),
    '"""',
    '',
    'Set the mark. JSON only.',
  ].join('\n');
  return { system: SYSTEM_PROMPT, user };
}

/* ---------- the tolerant parser ---------- */

/* Pull the first balanced {...} out of a string, respecting quoted text. */
function firstBalancedObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return '';
}

/* Exported for the harness. Fences stripped, first balanced object parsed,
 * the mark snapped to an honest rung. Any trouble at all resolves null. */
export function parseRefereeAnswer(raw) {
  try {
    let text = String(raw || '');
    text = text.replace(/```(?:json|JSON)?/g, '');
    const candidate = firstBalancedObject(text);
    if (!candidate) return null;
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== 'object') return null;
    const dc = snapDC(parsed.dc);
    if (dc === null) return null;
    const reason = typeof parsed.reason === 'string'
      ? parsed.reason.trim().replace(/\s+/g, ' ').slice(0, 160)
      : '';
    return { dc, reason };
  } catch (err) {
    return null;
  }
}

/* ---------- the provider calls (non-streaming, tiny, cold) ---------- */

async function callAnthropic(connection, prompt, signal) {
  const base = (connection.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': connection.apiKey || '',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: connection.model || 'claude-sonnet-4-5',
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: prompt.system,
      messages: [
        { role: 'user', content: prompt.user },
        /* the prefill: the answer must begin mid-JSON */
        { role: 'assistant', content: '{' },
      ],
    }),
  });
  if (!res.ok) return '';
  const body = await res.json();
  const piece = body && Array.isArray(body.content)
    ? body.content.find((b) => b && b.type === 'text' && typeof b.text === 'string')
    : null;
  /* the prefill's "{" belongs back on the front of the answer */
  return piece ? '{' + piece.text : '';
}

async function callOpenAI(connection, prompt, signal) {
  const base = (connection.baseUrl || 'https://api.openai.com')
    .replace(/\/+$/, '')
    .replace(/\/v1$/i, '');
  const headers = { 'content-type': 'application/json' };
  if (connection.apiKey) headers.authorization = `Bearer ${connection.apiKey}`;
  const payload = {
    model: connection.model || 'gpt-4o-mini',
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
  };
  /* response_format json_object only where the knob is known to exist. */
  if (base.includes('api.openai.com')) {
    payload.response_format = { type: 'json_object' };
  }
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify(payload),
  });
  if (!res.ok) return '';
  const body = await res.json();
  const choice = body && Array.isArray(body.choices) ? body.choices[0] : null;
  const text = choice && choice.message && choice.message.content;
  return typeof text === 'string' ? text : '';
}

/* ---------- the contract ---------- */

/* Set the mark, roll the die in code, and say what the margin earned.
 * NEVER throws into the chat path — every failure (no connection, network,
 * non-JSON, an un-snappable mark) lands as null, and the turn proceeds
 * without a ruling. */
export async function adjudicate({ connection, userText, state, signal } = {}) {
  try {
    if (!connection || typeof connection !== 'object') return null;
    if (!userText || !String(userText).trim()) return null;
    const prompt = buildRefereeMessages({ state, userText });
    let raw = '';
    if (connection.type === 'anthropic') {
      raw = await callAnthropic(connection, prompt, signal);
    } else if (connection.type === 'openai') {
      raw = await callOpenAI(connection, prompt, signal);
    } else {
      return null;
    }
    const board = parseRefereeAnswer(raw);
    if (!board) return null;
    const roll = rollD20();
    const margin = roll - board.dc;
    const outcome = marginOutcome(margin);
    /* The plain sentence the drawer and the state-of-things speak. */
    let words = 'the roll came up ' + roll + ' against a mark of ' + board.dc
      + ' (' + DC_WORDS[board.dc] + ') — ' + OUTCOME_WORDS[outcome];
    if (board.reason) words += '; the mark was set so because ' + board.reason.replace(/\.+$/, '');
    words += '. Let the prose honor it.';
    return {
      dc: board.dc,
      roll,
      margin,
      outcome,
      words,
      at: Date.now(),
    };
  } catch (err) {
    return null;
  }
}
