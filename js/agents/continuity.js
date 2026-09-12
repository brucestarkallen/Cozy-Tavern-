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
  '{"findings":[{"words":"NAME’s hair is written blonde here, but it is locked black.","severity":"warn","fix":"NAME’s hair is black"}]}',
  '',
  'severity is "warn" when the page plainly contradicts something written down,',
  'and "note" when it merely sits awkwardly beside it. The words are one plain',
  'sentence each, naming both what the page says and what the ledger says. `fix`',
  'is how the page should read instead, in a short plain phrase — the truth from',
  'the ledger, never a rewrite of the scene — and only on a warn.',
  '',
  'Be conservative. Drift means disagreement with what is written down — not a',
  'surprise, not a choice you wouldn’t have made. People change clothes, moods,',
  'and minds; those are story, not drift.',
  '',
  'WHAT IS NOT DRIFT — a fact a CHARACTER states wrongly ON PURPOSE or IN CHARACTER is',
  'the story, never a slip: a lie, a joke, a tease, an exaggeration, sarcasm, a memory',
  'gone wrong, an outsider who does not know. "Nineteen, she says, twice" from a sister',
  'winding him up is a joke; the NARRATION saying she is nineteen when the ledger locks',
  'seventeen is drift. Read who speaks and whether the scene gives them a reason; when',
  'the page itself shows the wrongness (a wink, a correction, "you know I\'m seventeen"),',
  'it is deliberate. Only what the page presents as TRUE with no reason to be false is',
  'drift: the narrator\'s facts, and a character stating their own age, home, name or',
  'kin plainly and wrongly with nothing in the scene to explain it.',
  '',
  'WORDS IN ANOTHER LANGUAGE are drift only when nobody in the scene would speak them:',
  'a character the ledger, the brief or the page establishes as speaking that language',
  'may speak it; a sudden run of another script inside an English sentence, from a',
  'character with no reason, is a glitch of the wire — a warn, with `fix` giving the',
  'words the sentence meant in the page\'s own language (or "remove" when they were',
  'noise).',
  '',
  'If nothing disagrees, return {"findings":[]} — an empty list is a good and honest',
  'answer, and the most common one. No commentary, no markdown fences: the JSON object',
  'only.',
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
      const finding = {
        words,
        severity: item && item.severity === 'warn' ? 'warn' : 'note',
      };
      const fix = cleanWords(item && item.fix);
      if (fix && finding.severity === 'warn') finding.fix = fix;
      findings.push(finding);
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


/* ---------- M35: the mend — the smallest edit that ends a contradiction ----------
 * Summaryception's law, ported: when a page contradicts the record, edit the
 * fewest storyteller pages by the smallest amount so it no longer does. Never
 * the writer's own pages. Keep each page's style, length, formatting and all
 * unrelated words. If no safe minimal edit exists, edit nothing. */

const MEND_SYSTEM = 'You mend a story\'s pages so they stop contradicting what is established. You edit the fewest storyteller pages by the smallest amount, keep every page\'s style, length, formatting and unrelated words exactly, and never touch the player\'s pages. Output only the JSON array asked for.';

export function buildMendMessages({ record, contradiction, pages, playerName = 'the player' }) {
  const passage = (Array.isArray(pages) ? pages : [])
    .map((p, i) => '[' + i + '] (' + (p.role === 'assistant' ? 'STORY' : 'PLAYER') + ') ' + String(p.text || '').slice(0, 6000))
    .join('\n\n');
  const user = [
    '<player_name>' + playerName + '</player_name>',
    '<record>' + String(record || '') + '</record>',
    '<contradiction>' + String(contradiction || '') + '</contradiction>',
    '<passage>',
    passage,
    '</passage>',
    '',
    '<passage> is the story as written, one page per block, each prefixed with its [index] and author. <record> is established canon. <contradiction> names what in the passage contradicts the record and how it should read instead.',
    '',
    'Edit the fewest (STORY) pages by the smallest amount so the passage no longer contradicts the record. Keep each edited page\'s style, length, formatting, and all unrelated content. Never edit a (PLAYER) page. If a page\'s text is embedded in another page\'s quote, edit the ORIGINAL, not the quote. If no safe minimal edit exists, output [].',
    '',
    'Output ONLY the JSON array: [{"index":<number>,"text":"<complete corrected page text>"}]',
  ].join('\n');
  return { system: withFictionFrame(MEND_SYSTEM), user };
}

export function parseMendAnswer(raw) {
  try {
    let text = String(raw || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/```(?:json|JSON)?/g, '').trim();
    const start = text.indexOf('[');
    if (start === -1) return [];
    /* the first balanced array */
    let depth = 0; let inStr = false; let esc = false; let end = -1;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '[') depth += 1;
      else if (ch === ']') { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) return [];
    const list = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(list)) return [];
    return list
      .filter((e) => e && typeof e === 'object' && Number.isInteger(e.index) && typeof e.text === 'string' && e.text.trim())
      .map((e) => ({ index: e.index, text: e.text }));
  } catch (err) {
    return [];
  }
}

/* Mend the pages that contradict the record. `pages` are the candidate
 * pages in order (the drifted page and a few before it); only STORY pages
 * may change, and only by a real, small edit (a change larger than half the
 * page is refused — that is a rewrite, not a mend). Applies the edits to the
 * store with `mended:{before, why, at}` so the page can be taken back.
 * Returns [{id, before, after}] for what changed. Throws on transport. */
export async function mendPages({ connection, storyId, pages, contradiction, record, playerName, signal, apply }) {
  if (!connection || !storyId || !Array.isArray(pages) || !pages.length || !contradiction) return [];
  const prompt = buildMendMessages({ record, contradiction, pages, playerName });
  const { text } = await callWorker(connection, { system: prompt.system, user: prompt.user, maxTokens: 4000, effort: 'off', signal });
  const edits = parseMendAnswer(text);
  const changed = [];
  for (const e of edits) {
    const page = pages[e.index];
    if (!page || page.role !== 'assistant') continue;
    const before = String(page.text || '');
    const after = e.text;
    if (after === before) continue;
    /* a mend is small: a change larger than half the page is a rewrite */
    const delta = Math.abs(after.length - before.length);
    if (delta > before.length * 0.5 || editDistanceRatio(before, after) > 0.5) continue;
    if (typeof apply === 'function') await apply(page, after, contradiction);
    changed.push({ id: page.id, before, after });
  }
  return changed;
}

/* A cheap sense of how much changed: the share of lines that differ. */
export function editDistanceRatio(a, b) {
  const la = String(a).split('\n'); const lb = String(b).split('\n');
  const set = new Set(la);
  let same = 0;
  for (const line of lb) if (set.has(line)) same += 1;
  const total = Math.max(la.length, lb.length, 1);
  return 1 - same / total;
}
