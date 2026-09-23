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

import { BLIND_LINE } from '../engine/world.js'; /* M416: the one wording of a thing someone hasn't found out */
import { writerText, BRIEF_ROOM } from '../engine/whole.js'; /* M283 */
import { renderStateFacts } from '../engine/state.js';
import { renderCanon } from '../engine/canon.js';
/* M9 (B16): the tolerant JSON-finder is shared by every agent —
 * agents/jsonutil.js. */
import { balancedCandidates, parseLenient } from './jsonutil.js';
import { wholePage } from '../engine/whole.js'; /* M259: the page read to its end */
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
  'and minds; those are story, not drift. THE SCENE LEDGER IS THE MOMENT BEFORE',
  'THIS PAGE: posture, position, what a hand holds, what is on or off a foot,',
  'where someone stands — a page that changes those is the story moving, and',
  'you never report it. ABSENCE IS NEVER DRIFT: a fact the ledgers do not hold —',
  'a kinship, a nickname, a history no lock names — is not contradicted by',
  'anything; "the ledger never establishes it" is not a finding. Drift needs a',
  'WRITTEN fact (a lock, the brief, a standing seat) that DISAGREES with the page.',
  'Drift is against what LASTS: the locked truths (hair,',
  'eyes, age, name, kin, origin, a scar), a person present who the ledger says',
  'is elsewhere with no arrival on the page, a wound the ledger holds open',
  'written as if it never was.',
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
  'UNTOLD KNOWLEDGE — the one case where what is NOT written counts (M338). The ledger lists, for the',
  /* M416: the marker is the storyteller's own notes' words (engine/world.js BLIND_LINE), read from the one home */
  'people here, what each HAS learned ("knows:") and what no page has shown them learning ("' + BLIND_LINE.trim() + '" \u2014',
  'the same words the storyteller\u2019s notes use). When a character on this page STATES or ACTS ON one of the',
  'things they have not been shown learning — or claims a telling the ledger gives no sign of ("you told me yesterday",',
  '"you gave me the schedule") — and the page itself shows no true way they came to know it (told on',
  'this page, seen on this page, a guess said AS a guess), that is a warn: name who, and what they',
  'could not know. `fix` is the nearest TRUE way, in a short phrase: the person the ledger says knows',
  'it told them ("Aurora told her the time"), or, when nothing supports their knowing, that they do not',
  'know it and ask, guess or find out on the page instead. Never a finding: a character lying or',
  'bluffing on purpose with the scene giving a reason; common knowledge of the setting; anything said or',
  'done in front of them on this page; the main character, whose knowledge is the writer\'s.',
  '',
  'If nothing disagrees, return {"findings":[]} — an empty list is a good and honest',
  'answer, and the most common one. No commentary, no markdown fences: the JSON object',
  'only.',
].join('\n');

/* Exported for the harness: the two messages any provider flavor receives.
 * The check reads ALL canon (not only who's present — a locked truth about
 * someone off-page still binds the page that speaks of them). */
export function buildContinuityMessages({ state, assistantText, brief = '' }) {
  /* M267: THE SECOND READER IS SHOWN WHAT LASTS. Told that posture, position
   * and what is on a foot are the story moving, it still reported them — and
   * the mender wrote the page back to the ledger's older moment ("Rias's arms
   * are uncrossed"). It is not shown the moment at all now: who is here by
   * name, and where the absent are; never where anyone stands, what they wear,
   * or the mood. */
  const lasting = state && typeof state === 'object'
    ? { ...state, present: (Array.isArray(state.present) ? state.present : []).map((p) => (p && p.name ? { name: p.name } : p)), mode: {} }
    : state;
  /* M338: the blind spots are keyed to the page being read — what bears on it, and what is recent */
  const facts = renderStateFacts(lasting, { scenePages: [String(assistantText || '')] }) || 'Nothing is written in the ledger yet.';
  const canon = state && state.canon && typeof state.canon === 'object'
    ? renderCanon(state.canon, Object.keys(state.canon))
    : '';
  const user = [
    'What is locked true of them:',
    canon || 'Nothing is locked yet.',
    '',
    ...(String(brief || '').trim() ? ['The writer\'s brief — what the writer set down; it COUNTS AS WRITTEN (a kinship, a home, an age here needs no lock):', writerText(brief, BRIEF_ROOM, 'brief'), ''] : []), /* M267/M283: the whole brief */
    'What the ledgers hold that LASTS — who is here by name, where the absent are, what is locked (never where anyone stands or what they wear: those are the page\'s to move; a body this',
    'page moves, a posture it changes, a thing it takes off or picks up, is the story moving —',
    'never drift):',
    facts,
    '',
    'The page just finished:',
    '"""',
    wholePage(assistantText),
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
  /* M237: cut on a word — the reader's own words about a mend are read by
   * the writer on the receipt. */
  if (tidied.length <= WORDS_CAP) return tidied;
  const room = tidied.slice(0, WORDS_CAP - 1);
  const at = Math.max(room.lastIndexOf(' '), room.lastIndexOf('; '), room.lastIndexOf(', '));
  return (at > Math.floor(WORDS_CAP / 2) ? room.slice(0, at) : room).trimEnd().replace(/[,;]$/, '') + '…';
}

/* Exported for the harness. Clean JSON, fenced JSON, prose-wrapped JSON,
 * and outright garbage are all survived; findings are kept only as
 * {words, severity} with severity coerced to 'note'|'warn'. Any trouble at
 * all resolves {findings:[]}. */
export function parseContinuityAnswer(raw) {
  try {
    /* M259: thinking stripped, up to five candidates, the lenient repair — as
     * every other worker's answer is read (M26/M31) */
    let text = String(raw || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '');
    text = text.replace(/```(?:json|JSON)?/g, '');
    let parsed = null;
    for (const c of balancedCandidates(text, 5)) {
      const p = parseLenient(c);
      if (p && Array.isArray(p.findings)) { parsed = p; break; }
    }
    if (!parsed) return { findings: [] };
    const list = parsed.findings;
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
export async function checkTurn({ connection, state, assistantText, signal, brief = '' } = {}) {
  if (!connection || typeof connection !== 'object') return { findings: [] };
  if (!assistantText || !String(assistantText).trim()) return { findings: [] };
  const prompt = buildContinuityMessages({ state, assistantText, brief });
  const { text } = await callWorker(connection, {
    system: prompt.system,
    user: prompt.user,
    maxTokens: MAX_TOKENS,
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
    .map((p, i) => '[' + i + '] (' + (p.role === 'assistant' ? 'STORY' : 'PLAYER') + ') ' + String(p.text || ''))
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
    /* M259: THE EDIT, NOT THE PAGE. Asked for "the complete corrected page",
     * a model shown a long page either handed back a page without its ending
     * or spent minutes writing out thousands of words it was told to keep. */
    'Output ONLY the JSON array of edits: [{"index":<number>,"find":"<the exact words to change, copied character for character from that page>","replace":"<the words that take their place>"}]',
    'Each "find" is a phrase or a sentence that appears exactly ONCE in its page — never the whole page. Two changes to one page are two entries.',
  ].join('\n');
  return { system: withFictionFrame(MEND_SYSTEM), user };
}

export function parseMendAnswer(raw) {
  try {
    let text = String(raw || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/```(?:json|JSON)?/g, '').trim();
    /* M259: the first balanced array that reads as a list, past a stray
     * bracket in the prose; a trailing comma is repaired */
    let list = null;
    let from = 0;
    for (let tries = 0; tries < 5 && list === null; tries += 1) {
      const start = text.indexOf('[', from);
      if (start === -1) break;
      let depth = 0; let inStr = false; let esc = false; let end = -1;
      for (let i = start; i < text.length; i += 1) {
        const ch = text[i];
        if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
        if (ch === '"') inStr = true;
        else if (ch === '[') depth += 1;
        else if (ch === ']') { depth -= 1; if (depth === 0) { end = i; break; } }
      }
      if (end === -1) break;
      const read = parseLenient(text.slice(start, end + 1));
      if (Array.isArray(read) && (!read.length || read.some((e) => e && typeof e === 'object'))) list = read;
      from = start + 1;
    }
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const e of list) {
      if (!e || typeof e !== 'object' || !Number.isInteger(e.index)) continue;
      if (typeof e.find === 'string' && e.find.length >= 3 && typeof e.replace === 'string') out.push({ index: e.index, find: e.find, replace: e.replace });
      else if (typeof e.text === 'string' && e.text.trim()) out.push({ index: e.index, text: e.text });
    }
    return out;
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
export const MEND_PAGE_MAX = 60000;

export async function mendPages({ connection, storyId, pages, contradiction, record, playerName, signal, apply }) {
  if (!connection || !storyId || !Array.isArray(pages) || !pages.length || !contradiction) return [];
  /* M259: THE MENDER IS SHOWN THE WHOLE PAGE. It was shown the first 6,000
   * characters and asked for "the complete corrected page" — so for a page a
   * little longer, what came back was the page without its ending, and it
   * passed the size check below and was saved. A page too long to hand back
   * whole is not offered at all; the answer has room for the longest page. */
  const offered = pages.filter((p) => String(p && p.text || '').length <= MEND_PAGE_MAX);
  if (!offered.some((p) => p.role === 'assistant')) return [];
  pages = offered;
  const prompt = buildMendMessages({ record, contradiction, pages, playerName });
  const { text } = await callWorker(connection, { system: prompt.system, user: prompt.user, maxTokens: 4000, signal });
  const edits = parseMendAnswer(text);
  const byPage = new Map();
  for (const e of edits) { if (!byPage.has(e.index)) byPage.set(e.index, []); byPage.get(e.index).push(e); }
  const changed = [];
  for (const [index, list] of byPage) {
    const page = pages[index];
    if (!page || page.role !== 'assistant') continue;
    const before = String(page.text || '');
    let after = before;
    const swaps = list.filter((e) => typeof e.find === 'string');
    if (swaps.length) {
      /* each edit lands only where its words stand exactly once */
      for (const sw of swaps) {
        const at = after.indexOf(sw.find);
        if (at === -1 || after.indexOf(sw.find, at + 1) !== -1) continue;
        after = after.slice(0, at) + sw.replace + after.slice(at + sw.find.length);
      }
    } else {
      after = list[list.length - 1].text; /* the whole page, as a short page may still be answered */
    }
    if (after === before) continue;
    /* a mend is small: a change larger than half the page is a rewrite */
    const delta = Math.abs(after.length - before.length);
    if (delta > before.length * 0.5 || editDistanceRatio(before, after) > 0.5) continue;
    /* M259: and a mend never loses a page's ending — the smallest edit does not
     * drop a sixth of a page, nor its closing lines */
    if (after.length < before.length * 0.85) continue;
    const linesOf = (t) => t.trim().split('\n');
    const lostEnding = linesOf(after).length < linesOf(before).length
      && !after.includes(before.trim().slice(-60).trim())
      && linesOf(after).slice(-1)[0] !== linesOf(before).slice(-1)[0];
    if (lostEnding) continue;
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
  const byLines = 1 - same / total;
  /* M275: A PAGE OF ONE PARAGRAPH IS ONE LINE, and by lines any mend of it —
   * one word — read as a whole rewrite and was dropped without a word: a
   * one-paragraph page could never be mended. By words for a page of one
   * line; a page of several lines keeps the stricter of the two, as strict as
   * it ever was. */
  const words = (t) => String(t || '').toLowerCase().split(/\s+/).filter(Boolean);
  const wa = words(a); const wb = words(b);
  const pool = new Map();
  for (const w of wb) pool.set(w, (pool.get(w) || 0) + 1);
  let kept = 0;
  for (const w of wa) { const c = pool.get(w) || 0; if (c > 0) { kept += 1; pool.set(w, c - 1); } }
  const byWords = 1 - kept / Math.max(wa.length, wb.length, 1);
  return Math.max(la.length, lb.length) <= 1 ? byWords : Math.max(byLines, byWords);
}
