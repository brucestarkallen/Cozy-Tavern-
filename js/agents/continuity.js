/* Cozy Tavern — agents/continuity.js
 * The continuity check: a quiet second reader. Once a page is finished (and
 * only then — background, after the extractor and the memory keeper), it
 * reads the new prose against what's locked true of the characters (the
 * canon store) and against the ledgers, and notes where the page drifted:
 * hair written blonde where black is locked, a healed arm suddenly sore
 * again, someone speaking who stepped out an hour ago.
 *
 * It is ADVISORY ONLY. It flags in the ledger drawer ("Something drifted")
 * and on the receipt; it never edits prose, never blocks a turn, and never
 * throws into the chat path — any failure resolves {findings:[]}.
 *
 * Contract (SPEC.md M6):
 *   checkTurn({connection, state, assistantText, signal})
 *     -> {findings:[{words, severity:'note'|'warn'}]}
 *
 * Findings are stored on the assistant message (msg.findings) by chat.js.
 * The check is optional: it runs only when the user switches it on
 * (Settings → "How much the story remembers"), so a story that never asks
 * for it never pays for it.
 */

import { renderStateFacts } from '../engine/state.js';
import { renderCanon } from '../engine/canon.js';
/* M9 (B16): the tolerant JSON-finder is shared by every agent —
 * agents/jsonutil.js. */
import { firstBalancedObject } from './jsonutil.js';
import { withFictionFrame } from './voice.js'; /* M21: the workers never break the fiction */
import { callWorker } from './call.js'; /* M28: the one wire path for workers */

const MAX_TOKENS = 1200; /* findings are a short JSON list; thinking is off on the wire (M28) */
const FINDINGS_CAP = 6;
const WORDS_CAP = 200;

/* ---------- the prompt (human-voiced, kept in the code) ---------- */

const SYSTEM_PROMPT = [
  'You are the continuity reader for a slow, warm story told between two writers.',
  'A page has just been finished. Your whole job is to compare it against what is',
  'written down — the locked truths about the characters, and the ledgers of the',
  'scene — and note where the page disagrees with them.',
  '',
  'Answer with JSON ONLY, in exactly this shape:',
  '{"findings":[{"words":"Mara’s hair is written blonde here, but it is locked black.","severity":"warn"}]}',
  '',
  'severity is "warn" when the page plainly contradicts something written down,',
  'and "note" when it merely sits awkwardly beside it. The words are one plain',
  'sentence each, naming both what the page says and what the ledger says.',
  '',
  'Be conservative. Drift means disagreement with what is written down — not a',
  'surprise, not a choice you wouldn’t have made. People change clothes, moods,',
  'and minds; those are story, not drift. If nothing disagrees, return',
  '{"findings":[]} — an empty list is a good and honest answer, and the most',
  'common one. No commentary, no markdown fences: the JSON object only.',
].join('\n');

/* Exported for the harness: the two messages any provider flavor receives.
 * The check reads ALL canon (not only who's present — a locked truth about
 * someone off-page still binds the page that speaks of them). */
export function buildContinuityMessages({ state, assistantText }) {
  const facts = renderStateFacts(state) || 'Nothing is written in the ledger yet.';
  const canon = state && state.canon && typeof state.canon === 'object'
    ? renderCanon(state.canon, Object.keys(state.canon))
    : '';
  const user = [
    'What is locked true of them:',
    canon || 'Nothing is locked yet.',
    '',
    'What the ledgers say of the scene:',
    facts,
    '',
    'The page just finished:',
    '"""',
    String(assistantText || '').slice(0, 8000),
    '"""',
    '',
    'Where does the page drift from what is written down, if anywhere? JSON only.',
  ].join('\n');
  return { system: withFictionFrame(SYSTEM_PROMPT), user };
}

/* ---------- the tolerant parser ---------- */

function cleanWords(value) {
  if (typeof value !== 'string') return '';
  const tidied = value.trim().replace(/\s+/g, ' ');
  return tidied.length > WORDS_CAP ? tidied.slice(0, WORDS_CAP - 1).trimEnd() + '…' : tidied;
}

/* Exported for the harness. Clean JSON, fenced JSON, prose-wrapped JSON,
 * and outright garbage are all survived; findings are kept only as
 * {words, severity} with severity coerced to 'note'|'warn'. Any trouble at
 * all resolves {findings:[]}. */
export function parseContinuityAnswer(raw) {
  try {
    let text = String(raw || '');
    text = text.replace(/```(?:json|JSON)?/g, '');
    const candidate = firstBalancedObject(text);
    if (!candidate) return { findings: [] };
    const parsed = JSON.parse(candidate);
    const list = parsed && Array.isArray(parsed.findings) ? parsed.findings : [];
    const findings = [];
    for (const item of list) {
      const words = cleanWords(item && item.words);
      if (!words) continue;
      findings.push({
        words,
        severity: item && item.severity === 'warn' ? 'warn' : 'note',
      });
      if (findings.length >= FINDINGS_CAP) break;
    }
    return { findings };
  } catch (err) {
    return { findings: [] };
  }
}

/* ---------- the contract ---------- */

/* Read one finished page against canon and the ledgers. M28: a transport
 * failure THROWS so the queue retries with backoff; a garbled answer is
 * {findings:[]}. A missing connection or an empty page: {findings:[]}. */
export async function checkTurn({ connection, state, assistantText, signal } = {}) {
  if (!connection || typeof connection !== 'object') return { findings: [] };
  if (!assistantText || !String(assistantText).trim()) return { findings: [] };
  const prompt = buildContinuityMessages({ state, assistantText });
  const { text } = await callWorker(connection, {
    system: prompt.system,
    user: prompt.user,
    maxTokens: MAX_TOKENS,
    effort: 'off',
    signal,
  });
  return parseContinuityAnswer(text);
}
