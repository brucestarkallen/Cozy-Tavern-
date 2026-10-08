/* Cozy Tavern — the continuous audit (M673).
 *
 * HIS: "step by step it makes sure the folds summary, the ledger, the pages is always correct if I toggled on. It creates
 * someone who thinks as a logical or creative co-writer: ok, every continuity is correct. It's basically like the
 * housekeeper audit (slow, because an audit on 1,000 pages takes time — but if it's already starting from page 1 it's
 * efficient) … from turn 1 until 1,000 or beyond. Whether a new agent or added to an existing one, what matters is
 * fast and actually makes sure everything — the whole ledger, pages and fold — is great."
 *
 * WHAT ALREADY CHECKS A PAGE WHILE THE STORYTELLER STILL SEES IT: the second reader (each new page against what lasts),
 * the auditor (the whole ledger against the brief, the record and the unfolded pages — after every page by default),
 * and the keeper's own check of each record line as it writes it. WHAT NOTHING DID BY ITSELF: read a stretch of pages
 * ONE LAST TIME, WHOLE, AS IT PASSES OUT OF THE STORYTELLER'S SIGHT — the pages, the story before them, the record line
 * that now stands for them and what the ledger holds, side by side — and remember that it has. That is the
 * housekeeper's audit (#f, #a), which he had to ask for and which read a whole tale in one go. After a fold the
 * storyteller knows those pages only through the record line and the ledger; what those two got wrong or left out is
 * what a long tale slowly loses.
 *
 * WHAT THIS IS: one reading per record line (its pages, six at most at a time), oldest first, each line read once.
 * What it finds goes through the doors the house already has, each with its own take-back:
 *   - a page that cannot be true beside what the brief or the story before it had established -> the house's own mend
 *     (the smallest edit, the earlier words a tap away, off with his "mend" switch; never a page already mended or one
 *     whose words he put back) — the keeper then folds the mended words again and the new line is read once more;
 *   - a wrong fact in the record line -> repaired in the line, only when the wrong words are in the line and the right
 *     words are in the pages (the keeper's own rule); something lasting the line left out -> its Detail worth keeping
 *     (or, where the keeper wrote no line at all for those pages, the line itself);
 *   - something a person learned that the ledger never wrote down -> knowledge.add, through the ledger's own door,
 *     journaled at the OLD page it is about (so a retry, a version walked to or a branch keeps it). ONLY THAT, and only
 *     added: the ledger this reader is shown is today's, many pages later — it never "corrects" the present toward the
 *     past. The moment (who is where, the hour, a wound, a standing, a thread, how someone looks now) belongs to the
 *     readers of the newest pages, and the auditor holds the ledger against the record this reader has made true.
 *
 * THE MARK IS ON THE RECORD LINE ITSELF (node.audited: how many of the line's pages have been read). So it goes
 * wherever the line goes and ends when the line does: a line let go by a retry, an edit, a delete or a mend takes its
 * mark with it, and the line the keeper writes in its place is read; a line that slides when an older page is deleted
 * keeps its mark; a copy of the story (a branch, a backup brought back) carries them. A tale already a thousand pages
 * long is read from its first line, one line at a time, while the house is idle; a new tale is read as it folds.
 */

import { db } from '../store.js';
import { callWorker } from './call.js';
import { runningWorkers } from './status.js';
import { balancedCandidates, parseLenient } from './jsonutil.js';
import { withFictionFrame } from './voice.js';
import { roomChars, leashFor } from './lookup.js';
import { wholePage } from '../engine/pagecut.js';
import { writerText } from '../engine/whole.js';
import { loadState, saveState, notify } from '../engine/state.js';
import { applyMutations, personBookKey } from '../engine/apply.js';
import { findKnowledgeKey, sameFact, KNOWLEDGE_GUARD } from '../engine/world.js';
import { mcName } from '../engine/duels.js';
import { findPersonKey, isMc } from '../engine/people.js';
import { nameOnPage } from '../engine/names.js';
import { pageText } from '../assemble/stack.js';
import { asideAt } from '../commands.js'; /* M674: which pages are out of character */
import {
  loadMemory, saveMemory, visiblePages, recordLinesBefore,
  applyAuditFixes, mergeDetail, looksLikeTokenDump, isNoRecordLine, nodeSignature, nodeUnmoved, auditedOf,
} from './memory.js';

export const STRETCH_PAGES = 6;      /* the keeper's own batch: one record line, one reading */
export const STRETCH_CHARS = 36000;  /* very long pages are read fewer at a time */
export const LEDGER_ADDS = 4;        /* what one reading may add to the ledger, at most */
export const PAGE_FIXES = 2;         /* pages one reading may send to be mended, at most */
export const UNREADABLE_TRIES = 3;   /* answers that cannot be read, before the pages are passed by (never stuck) */
const MAX_TOKENS = 3000;
const BRIEF_CAP = 12000;
const PAGE_CAP = 24000;
const LINE_CAP = 6000;
const DETAIL_ADD_CAP = 400;          /* what one reading may add beneath a line */
const DETAIL_CAP = 1400;             /* the record's own cap for a line's detail (memory.js) */
const FENCE = '"""';

export async function continuousAuditOn() {
  return (await db.settings.get('continuousAudit')) === true;
}

/* ---------- the mark, on the record line ---------- */

/* How many of a line's pages have been read is kept on the line (memory.js auditedOf). */
const isLine = (n) => Boolean(n) && !n.correction && Array.isArray(n.span)
  && Number.isInteger(n.span[0]) && Number.isInteger(n.span[1]) && n.span[0] >= 0 && n.span[1] >= n.span[0];
const lineLength = (n) => n.span[1] - n.span[0] + 1;
export { auditedOf };

/* the lines that stand for pages the story still has, oldest first */
function linesOf(mem, pageCount) {
  return (mem && Array.isArray(mem.nodes) ? mem.nodes : [])
    .filter((n) => isLine(n) && n.span[1] < pageCount)
    .sort((a, b) => (a.span[0] - b.span[0]) || ((a.level || 1) - (b.level || 1)) || ((a.at || 0) - (b.at || 0)));
}

/* How far it has read, of what can be read: the pages the record has folded. */
export function auditProgress(mem, pageCount) {
  const count = Math.max(0, Math.round(Number(pageCount)) || 0);
  const folded = new Set();
  const read = new Set();
  for (const n of linesOf(mem, count)) {
    const k = auditedOf(n);
    for (let i = n.span[0]; i <= n.span[1]; i += 1) {
      folded.add(i);
      if (i - n.span[0] < k) read.add(i);
    }
  }
  return { done: read.size, folded: folded.size, left: folded.size - read.size };
}

const lengthOf = (m) => String(pageText(m) || '').length;

/* The next stretch: the oldest line not yet read to its end — its pages from where the reading stopped, six pages or
 * STRETCH_CHARS at most. null when every line is read. */
export function nextStretch(mem, pages) {
  const list = Array.isArray(pages) ? pages : [];
  for (const line of linesOf(mem, list.length)) {
    const had = auditedOf(line);
    if (had >= lineLength(line)) continue;
    const from = line.span[0] + had;
    let to = from;
    let chars = lengthOf(list[from]);
    while (to + 1 <= line.span[1] && (to + 1 - from) < STRETCH_PAGES) {
      const next = lengthOf(list[to + 1]);
      if (chars + next > STRETCH_CHARS) break;
      to += 1;
      chars += next;
    }
    return { from, to, line, lineWhole: from === line.span[0] && to === line.span[1] };
  }
  return null;
}

/* ---------- what it is asked ---------- */

function law({ mc }) {
  return [
    'You are the continuity editor of a long story told between two writers -- the last careful reader of a finished',
    'stretch of pages before the storyteller stops seeing them. From now on the storyteller will know these pages only',
    'through what the house keeps of them: THE RECORD LINE written for them, and THE LEDGER\'s note of what each person',
    'has learned. You read the pages once more, whole, and make sure that memory is true and that nothing the story',
    'will need again is lost.',
    mc ? `The main character is ${mc}.` : 'The main character is the one the PLAYER pages speak for.',
    '',
    'You are given, in this order: THE BRIEF (the writer\'s own words -- it wins over everything); THE STORY SO FAR (the',
    'record of everything before these pages, oldest to newest; a [Correction] line supersedes); THE PAGES, word for',
    'word (a PLAYER page is what the main character attempts; only a STORY page makes it so); THE RECORD LINE that now',
    'stands for these pages; and WHAT THE LEDGER HOLDS TODAY of what the people these pages name have learned.',
    '',
    'A page marked OUT OF CHARACTER is the two writers talking ABOUT the story -- a question, an idea, a plan. It is',
    'not the story: nothing on it happened in the story and nobody in the story learned anything from it. Never',
    'report such a page as a fault, and write no knowledge.add and no "detail" from it. (A background fact the WRITER',
    'states there is the writer\'s own word, as the brief is: a record line that holds it is not wrong for holding it.)',
    '',
    'Find only these three kinds of fault. Anything else is not yours.',
    '',
    '1. THE STORY AGAINST ITSELF. Something a STORY page here states that cannot be true beside what THE BRIEF or THE',
    '   STORY SO FAR had already established: a name, an age, kin, who is dead, a wound long healed, the colour of',
    '   someone\'s eyes, who already knew a secret, a thing that was lost, the day or the season. NOT a change the story',
    '   makes on purpose -- people move, learn, heal, lie, joke and change their minds; a character saying something',
    '   false is the character, not an error. Judge a page ONLY against the brief and the story before it -- never',
    '   against the ledger, which is from much later. Report it with "pages": true, "page": that page\'s number, and a',
    '   "fix" that says in one plain sentence what the page should read instead. The house mends the page by the',
    '   smallest edit; you never rewrite a page.',
    '',
    '2. THE RECORD LINE AGAINST THE PAGES. (a) A fact the line states that these pages do not -- a wrong name, number,',
    '   place, or who did what: give "fixes", each the line\'s OWN wrong words exactly as they stand in the line (enough',
    '   of them that they stand there only once), and the right words exactly as the pages have them. (b) Something',
    '   LASTING these pages established that neither the line nor its detail holds, and that the story will need',
    '   again: a promise or a debt, a secret and who learned it, a name or an identity revealed, how someone looks for',
    '   good (eyes, a scar, a missing finger), a death, an injury that will last, a thing that changed hands, a',
    '   decision that binds someone. Give it as "detail": short phrases separated by semicolons, with explicit names,',
    '   never pronouns. Never anything the story so far already holds; never the texture of the scene.',
    '',
    '3. WHAT SOMEONE LEARNED, MISSING FROM THE LEDGER. Something a person the ledger lists plainly LEARNED on these',
    '   pages -- was told, saw, overheard, worked out -- that the story will need again and that is not in that',
    '   person\'s list: write it with knowledge.add. ONLY WHAT IS MISSING: a thing listed in other words is ALREADY',
    '   there -- never write it again. The lists are TODAY\'S, from much later in the story: they are shown only so you',
    '   can tell what is already written, and they are never evidence against a page or against the record line.',
    '   Nothing else of the ledger is yours -- where anyone is, what anyone wears, the hour, a wound, a standing, a',
    '   thread: the readers of the newest pages keep those.',
    '',
    'Be exact and conservative: only what the pages plainly show, never what would be nice. Most stretches are clean;',
    'an empty list is the best answer there is. Two or three findings is a full reading; ten is a misreading.',
    'REPORT ONLY WHAT IS WRONG OR MISSING -- never a line that says something "stands" or "is complete".',
    '',
    'Answer with JSON ONLY, exactly this shape (every key but "what" is optional; use the ones the fault needs):',
    '{"issues":[{"what":"what is wrong or missing, in one sentence","pages":false,"page":0,"fix":"",',
    '  "record":{"fixes":[{"from":"the line\'s own wrong words","to":"the pages\' own words"}],"detail":""},',
    '  "mutations":[]}]}',
    '',
    'The only mutation that exists:',
    'knowledge.add {"type":"knowledge.add","name":"OTHER NAME","fact":"what they learned on these pages, said so it stands on its own"}',
    '',
    'Names keep the spelling the ledger and the pages use. No commentary, no fences: the JSON only.',
    'PLACEHOLDERS: OTHER NAME above is a placeholder, never a person -- never write it; write only the names the',
    'ledger and the pages use.',
  ].join('\n');
}

const lower = (x) => String(x || '').toLowerCase();

/* what the ledger holds of what one person knows, oldest to newest as the house reads it */
function knownBy(state, name) {
  const book = state && state.knowledge && typeof state.knowledge === 'object' ? state.knowledge : {};
  const key = personBookKey(state, book, name, findKnowledgeKey);
  const list = key && Array.isArray(book[key]) ? book[key].filter((k) => k && typeof k.fact === 'string' && k.fact.trim()) : [];
  return list.map((k, i) => ({ k, i }))
    .sort((a, b) => ((Number.isFinite(a.k.atTurn) ? a.k.atTurn : -1) - (Number.isFinite(b.k.atTurn) ? b.k.atTurn : -1)) || (a.i - b.i))
    .map((x) => x.k);
}

/* What the ledger holds today of what the people these pages name have learned -- the people it keeps, never the
 * main character. Shown so the reader can tell what is already written, and for nothing else. */
export function ledgerForPages(state, text, room = 12000) {
  const people = state && state.characters && typeof state.characters === 'object' ? state.characters : {};
  const names = Object.keys(people).filter((n) => !isMc(state, n) && nameOnPage(text, n));
  if (!names.length) return '';
  const blocks = names.map((name) => ({ name, knows: knownBy(state, name).map((k) => k.fact.trim().replace(/\.+$/, '')) }));
  const render = (keep) => blocks.map((b) => [
    b.name,
    '  knows: ' + (b.knows.slice(-keep).join('; ') || '(nothing written)') + (b.knows.length > keep ? ' (and ' + (b.knows.length - keep) + ' older lines not shown)' : ''),
  ].join('\n')).join('\n');
  /* whole when it fits; else each person's newest lines, fewer and fewer */
  for (const keep of [Infinity, 24, 12, 6, 3]) {
    const out = render(keep);
    if (out.length <= room || keep === 3) return out.length <= room ? out : out.slice(0, room);
  }
  return '';
}

/* A LINE IN HIS OWN WORDS IS HIS. A record line he rewrote by hand (the drawer's "Rewrite"), or that the housekeeper
 * changed for him, is read like any other -- its pages, and what the ledger should hold of them -- but its words and
 * its detail are left exactly as they are: this reader never writes over his hand. */
export function lineIsHis(node) {
  const by = node && node.verified && typeof node.verified === 'object' ? node.verified.fixed : '';
  return by === 'the writer' || by === 'the housekeeper';
}

/* The request for one stretch. Shrinks the stretch (never below one page) until it fits the reader's room. */
export function buildStretchMessages({ state, brief = '', castNotes = '', mem, pages, stretch, room = Infinity } = {}) {
  const list = Array.isArray(pages) ? pages : [];
  const known = mcName(state);
  const mc = known && known !== 'the player' ? known : '';
  const system = withFictionFrame(law({ mc }));
  const budget = Number.isFinite(room) && room > 0 ? room : 400000;
  const line = stretch.line;
  const lineEmpty = line.empty === true || !String(line.text || '').trim();
  const lineBlock = (whole) => [
    lineEmpty
      ? 'THE RECORD LINE: there is none for these pages.'
      : whole
        ? 'THE RECORD LINE that now stands for these pages:'
        : 'THE RECORD LINE that stands for pages ' + (line.span[0] + 1) + '-' + (line.span[1] + 1) + ' -- MORE pages than the ones above. Do not judge what it says of the others (no "fixes"); say only what lasting thing from THESE pages it is missing:',
    FENCE,
    lineEmpty
      ? (line.byHouse === true
        ? '(the keeper\'s model wrote no line for these pages -- if something lasting happened in them, give it as "detail")'
        : '(the keeper judged that nothing new happened in these pages -- if something lasting did, give it as "detail")')
      : String(line.text || '').slice(0, LINE_CAP),
    ...(!lineEmpty && line.detail ? ['  • Detail worth keeping: ' + String(line.detail).slice(0, 2000)] : []),
    FENCE,
  ];
  /* M674: the pages and the ledger's part depend on where the stretch ENDS, never on the record's room -- worked out
   * once for each end tried (a small room tries several record rooms over the same pages; each used to read the
   * ledger of everyone named again) */
  const endings = new Map();
  const endingAt = (to) => {
    let e = endings.get(to);
    if (!e) {
      const shown = list.slice(stretch.from, to + 1);
      /* M674: OUT OF CHARACTER IS NOT THE STORY (commands.js asideAt). His question to the storyteller and its answer are
       * pages of the thread -- the record's lines count them, so they ride in a stretch like any other -- and this reader
       * was handed them as PLAYER and STORY. An answer that talks ABOUT the story ("Renji knows nothing yet; he could
       * find out at the gate") names the people and holds the words, so everything the code checks a finding by would
       * pass: a thing nobody learned written into the ledger, an idea kept beneath the record line as if it had
       * happened, an answer to him "mended" for disagreeing with the story. Such a page is said to be out of character
       * in the request, and it is no evidence: the words a claim is held to are the story's own pages'. */
      const aside = shown.map((m, i) => asideAt(list, stretch.from + i));
      /* the story's own pages, word for word: what every claim is held to (never an out-of-character page) */
      const sourceText = shown.filter((m, i) => !aside[i]).map((m) => String(pageText(m) || '')).join('\n\n');
      const whose = (m, i) => (aside[i]
        ? (m.role === 'assistant' ? 'OUT OF CHARACTER (the storyteller answering the writer -- not a page of the story): ' : 'OUT OF CHARACTER (the writer asking the storyteller -- not a page of the story): ')
        : (m.role === 'assistant' ? 'STORY: ' : 'PLAYER: '));
      e = {
        pageBlocks: shown.map((m, i) => '[p' + (stretch.from + i + 1) + '] ' + whose(m, i) + wholePage(String(pageText(m) || ''), PAGE_CAP)),
        sourceText,
        asides: shown.map((m, i) => (aside[i] ? stretch.from + i + 1 : 0)).filter(Boolean), /* their page numbers, as the request numbers them */
        ledger: ledgerForPages(state, sourceText, Math.max(2000, Math.floor(budget * 0.15))),
      };
      endings.set(to, e);
    }
    return e;
  };
  const build = (to, recordCap) => {
    const { pageBlocks, sourceText, asides, ledger } = endingAt(to);
    const whole = stretch.lineWhole && to === stretch.to;
    const record = recordCap > 0 ? recordLinesBefore(mem, stretch.from, recordCap) : '';
    const user = [
      'THE BRIEF (the writer\'s own words):',
      FENCE, writerText(brief, Math.min(BRIEF_CAP, Math.max(2000, Math.floor(budget * 0.12))), 'brief') || '(none written)', FENCE,
      ...(castNotes && String(castNotes).trim() ? ['WHO IS IN IT (the writer\'s own words):', FENCE, writerText(castNotes, Math.min(6000, Math.max(1500, Math.floor(budget * 0.06))), 'cast notes'), FENCE] : []),
      '',
      'THE STORY SO FAR (the record of everything before these pages, oldest to newest):',
      FENCE, String(record || '').trim() || (stretch.from === 0 ? '(these are the story\'s first pages)' : '(nothing recorded before these pages)'), FENCE,
      '',
      'THE PAGES (pages ' + (stretch.from + 1) + '-' + (to + 1) + ' of the story, word for word):',
      FENCE, pageBlocks.join('\n\n'), FENCE,
      '',
      ...lineBlock(whole),
      '',
      'WHAT THE LEDGER HOLDS TODAY of what each person these pages name has learned (anyone not listed here is not kept by the ledger -- write nothing for them):',
      ledger || '(the ledger keeps nobody these pages name)',
      '',
      'Read the pages against all of it. JSON only.',
    ].join('\n');
    return { system, user, from: stretch.from, to, lineWhole: whole, sourceText, asides };
  };
  let to = stretch.to;
  let recordCap = Math.max(4000, Math.floor(budget * 0.3));
  let built = build(to, recordCap);
  const fits = (b) => b.system.length + b.user.length <= budget * 0.9;
  while (!fits(built) && recordCap > 4000) { recordCap = Math.max(4000, Math.floor(recordCap / 2)); built = build(to, recordCap); }
  while (!fits(built) && to > stretch.from) { to -= 1; built = build(to, recordCap); }
  return { ...built, lineId: line.id, lineSignature: nodeSignature(line), lineDetail: typeof line.detail === 'string' ? line.detail : '', lineEmpty, lineHis: lineIsHis(line) };
}

/* ---------- what it answers ---------- */

/* The answer, as a model writes it: a yes that is "true" or "yes", a number in quotes, a record given as bare words. */
export function parseStretchAnswer(raw) {
  try {
    const text = String(raw || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/```(?:json|JSON)?/g, '');
    let parsed = null;
    for (const c of balancedCandidates(text, 5)) {
      const p = parseLenient(c);
      if (p && Array.isArray(p.issues)) { parsed = p; break; }
    }
    if (!parsed) return { issues: [], note: 'unusable' };
    const yes = (v) => v === true || v === 1 || (typeof v === 'string' && /^\s*(?:true|yes|y|1)\s*$/i.test(v));
    const words = (v, cap) => (typeof v === 'string' ? v.trim().slice(0, cap) : '');
    const issues = parsed.issues.filter((i) => i && typeof i === 'object').map((i) => {
      const rec = typeof i.record === 'string' ? { detail: i.record } : (i.record && typeof i.record === 'object' ? i.record : null);
      const detail = words(rec && rec.detail, 1200) || words(i.detail, 1200);
      const fixes = (Array.isArray(rec && rec.fixes) ? rec.fixes : [])
        .filter((f) => f && typeof f.from === 'string' && typeof f.to === 'string')
        .map((f) => ({ from: f.from.trim(), to: f.to.trim() }))
        .filter((f) => f.from && f.to && f.from !== f.to && f.from.length <= 160 && f.to.length <= 160)
        .slice(0, 6);
      const page = Math.round(Number(typeof i.page === 'string' ? i.page.replace(/^\s*\[?p(?:age)?\s*/i, '') : i.page));
      return {
        what: words(i.what, 2000),
        pages: yes(i.pages),
        page: Number.isFinite(page) && page > 0 ? page : null,
        fix: words(i.fix, 2000),
        record: fixes.length || detail ? { fixes, detail } : null,
        mutations: Array.isArray(i.mutations) ? i.mutations.filter((m) => m && typeof m === 'object' && typeof m.type === 'string') : [],
      };
    }).filter((i) => (i.pages && i.fix) || i.record || i.mutations.length).slice(0, 12);
    return { issues, note: 'ok' };
  } catch (err) {
    return { issues: [], note: 'unusable' };
  }
}

/* Do the pages say it? The words that carry a claim (four letters and more, the small words left out) must be on
 * the pages -- most of them, each allowed its ending ("promised" for "promise"). A claim the pages do not hold is not
 * written anywhere, whoever made it. */
const SMALL = new Set(['that', 'this', 'with', 'from', 'have', 'been', 'were', 'they', 'them', 'their', 'there', 'then', 'than', 'what', 'when', 'where', 'which', 'while', 'will', 'would', 'could', 'should', 'about', 'into', 'over', 'after', 'before', 'because', 'also', 'only', 'very', 'more', 'most', 'some', 'such', 'each', 'both', 'does', 'done', 'herself', 'himself', 'itself', 'being', 'against', 'between', 'through', 'under', 'again', 'still', 'never', 'always', 'someone', 'something']);
export function pagesSay(claim, pagesLower) {
  const text = String(pagesLower || '');
  const wordsIn = lower(claim).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
  const telling = [...new Set(wordsIn.map((w) => w.replace(/['’]s$/, '')).filter((w) => w.length >= 4 && !SMALL.has(w)))];
  if (!telling.length) return false;
  const found = telling.filter((w) => text.includes(w.slice(0, Math.max(4, w.length - 2)))).length;
  return found / telling.length >= (telling.length <= 2 ? 1 : 0.6);
}
const PLACEHOLDER = /\b(?:OTHER NAME|NEW NAME|NAME SURNAME|MAIN CHARACTER|NAME)\b/;
const ECHO = /\bthe line'?s own wrong words\b|\bthe pages'? own words\b|\bwhat (?:is wrong or missing|the page should read)\b|\bwhat they learned on these pages\b/i;

/* What a reading may do, decided in code: who may be written for, what may be written, and how much.
 *   turn: the story's turn these pages end on (what an added fact is dated with, and what a full list is held to). */
export function scopeStretch(issues, { state, pagesText = '', from = 0, to = 0, lineWhole = true, turn = null, asides = [] } = {}) {
  const text = String(pagesText || '');
  const aside = new Set(Array.isArray(asides) ? asides : []); /* M674: the page numbers that are out of character */
  const low = lower(text);
  const people = state && state.characters && typeof state.characters === 'object' ? state.characters : {};
  const mutations = [];
  const refused = [];
  const pageFixes = [];
  const fixes = [];
  let detail = '';
  const refuse = (mutation, why) => refused.push({ mutation, why });
  for (const issue of (Array.isArray(issues) ? issues : [])) {
    if (!issue) continue;
    /* 1. a page against the story */
    if (issue.pages && issue.fix && !PLACEHOLDER.test(issue.fix) && !ECHO.test(issue.fix) && issue.fix.length >= 8 && pageFixes.length < PAGE_FIXES) {
      const page = Number.isInteger(issue.page) && issue.page >= from + 1 && issue.page <= to + 1 ? issue.page : null;
      /* M674: an out-of-character page is not the story -- it is never wrong against it, never mended, never noted */
      if (!(page && aside.has(page)) && !pageFixes.some((f) => f.page === page && f.fix === issue.fix)) pageFixes.push({ what: issue.what, fix: issue.fix, page });
    }
    /* 2. the record line */
    if (issue.record) {
      if (lineWhole) for (const f of issue.record.fixes) if (!PLACEHOLDER.test(f.to) && !ECHO.test(f.from) && !ECHO.test(f.to)) fixes.push(f);
      for (const clause of String(issue.record.detail || '').split(/\s*;\s*/)) {
        const c = clause.trim().replace(/[.;,]+$/g, '');
        if (!c || PLACEHOLDER.test(c) || ECHO.test(c) || !pagesSay(c, low)) continue;
        const merged = mergeDetail(detail, c);
        if (merged.length <= DETAIL_ADD_CAP) detail = merged;
      }
    }
    /* 3. the ledger: only what someone learned, only added, only for someone it keeps, only what these pages say */
    for (const m of (Array.isArray(issue.mutations) ? issue.mutations : [])) {
      if (m.type !== 'knowledge.add') { refuse(m, '“' + m.type + '” is not the continuous audit’s to write — the readers of the newest pages keep that'); continue; }
      const said = typeof m.name === 'string' && !PLACEHOLDER.test(m.name) ? m.name.trim() : '';
      if (said && isMc(state, said)) { refuse(m, 'nothing is written for the main character'); continue; }
      const key = said ? findPersonKey(people, said) : '';
      if (!key) { refuse(m, 'the ledger keeps no page for ' + (String(m.name || '').trim() || 'that name') + ' — nothing is written for someone it does not keep'); continue; }
      if (isMc(state, key)) { refuse(m, 'nothing is written for the main character'); continue; }
      if (!nameOnPage(text, key)) { refuse(m, 'these pages do not name ' + key); continue; }
      const fact = String(m.fact || m.text || '').trim();
      if (!fact || ECHO.test(fact)) { refuse(m, 'it did not say what ' + key + ' learned'); continue; }
      if (!pagesSay(fact, low)) { refuse(m, 'these pages do not say that'); continue; }
      /* in other words is still the same thing: against everything that person is known to know, whenever it was learned */
      const known = knownBy(state, key);
      if (known.some((k) => sameFact(k.fact, fact, { fuzzy: true })) || mutations.some((x) => x.name === key && sameFact(x.fact, fact, { fuzzy: true }))) {
        refuse(m, key + ' already knows that');
        continue;
      }
      /* a list that is full holds the newest things; something older than all of them would only push a newer one out */
      if (known.length >= KNOWLEDGE_GUARD && Number.isFinite(turn)) {
        const turns = known.map((k) => k.atTurn).filter((t) => Number.isFinite(t));
        if (turns.length && turn < Math.min(...turns)) { refuse(m, key + '’s list is full of newer things — an older one would only push a newer one out'); continue; }
      }
      if (mutations.length >= LEDGER_ADDS) { refuse(m, 'one reading adds ' + LEDGER_ADDS + ' things to the ledger at most'); continue; }
      mutations.push({ type: 'knowledge.add', name: key, fact });
    }
  }
  return { mutations, refused, pageFixes, record: { fixes, detail } };
}

/* the storyteller page a stretch ends on, as the journal counts pages (storyteller pages only, from 0; -1 before any) */
export function storyPageAt(pages, index) {
  let n = -1;
  for (let i = 0; i <= index && i < pages.length; i += 1) if (pages[i] && pages[i].role === 'assistant') n += 1;
  return n;
}

/* ---------- the storyteller comes first ---------- */

/* A reading in flight holds a stop of its own: pulled the moment he asks for a page, or anything waits for the workers
 * (pauseContinuousAudit — from generate and from pendingWork). Its call is dropped, nothing is written, and the same
 * pages are read later. */
const readings = new Map(); /* storyId -> Set<AbortController> */
export function beginReading(storyId) {
  const c = new AbortController();
  let set = readings.get(storyId);
  if (!set) { set = new Set(); readings.set(storyId, set); }
  set.add(c);
  return c;
}
export function endReading(storyId, c) {
  const set = readings.get(storyId);
  if (!set) return;
  set.delete(c);
  if (!set.size) readings.delete(storyId);
}
export function pauseContinuousAudit(storyId) {
  const set = readings.get(storyId);
  if (!set || !set.size) return false;
  for (const c of set) { try { if (!c.signal.aborted) c.abort(); } catch (err) { /* already let go */ } }
  return true;
}

/* ---------- one reading ---------- */

const unreadable = new Map(); /* story|line|from -> answers that could not be read */

/* ONE STRETCH. Returns null when nothing is due or nothing could be done now (every line read; the keeper at the
 * record; the pages or the line moved while it read — read again, as they then stand); else what it did. Throws on
 * transport, on a stop, and on an answer that cannot be read (the queue asks again) — until the third such answer for
 * the same pages, which are passed by and said so.
 *   mend(pageId, words) -> the pages changed          (the house's own page mender; it keeps his switch)
 *   note(pageId, finding)                             (a fault left on the page, where the second reader's are) */
export async function auditStretch({ connection, storyId, brief = '', castNotes = '', signal, stale, renew, mend, note } = {}) {
  if (!connection || typeof connection !== 'object' || !storyId) return null;
  const isStale = () => typeof stale === 'function' && stale();
  const stopped = () => Boolean(signal && signal.aborted);
  /* THE KEEPER FIRST. While it is at the record (folding, or checking a line it has just written — it writes that
   * line's detail when it is done) this reader neither reads nor writes: two hands on one line lose one's work. */
  const keeperAtWork = () => runningWorkers(storyId).includes('keeper');
  if (keeperAtWork()) return null;
  const state = await loadState(storyId);
  const mem = await loadMemory(storyId);
  const pages = visiblePages(await db.messages.list(storyId));
  const stretch = nextStretch(mem, pages);
  if (!stretch) return null;
  const prompt = buildStretchMessages({ state, brief, castNotes, mem, pages, stretch, room: roomChars(connection, MAX_TOKENS) });
  let read = { issues: [], note: 'unusable' };
  let raw = '';
  let user = prompt.user;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (typeof renew === 'function') renew(leashFor(prompt.system.length + user.length));
    const { text } = await callWorker(connection, { system: prompt.system, user, maxTokens: MAX_TOKENS, signal });
    raw = text;
    read = parseStretchAnswer(text);
    if (read.note === 'ok') break;
    user = prompt.user + '\n\nYour last answer was not a JSON object with an "issues" list. Answer with the JSON object only; an empty list is a good answer.';
  }
  if (isStale() || stopped()) return null;
  const tryKey = storyId + '|' + prompt.lineId + '|' + prompt.from;
  let passedBy = false;
  if (read.note !== 'ok') {
    const tries = (unreadable.get(tryKey) || 0) + 1;
    unreadable.set(tryKey, tries);
    if (tries < UNREADABLE_TRIES) {
      const err = new Error('its answer could not be read');
      err.raw = raw;
      throw err;
    }
    passedBy = true; /* M316's law: the house is never stuck on pages its model will not answer for */
  }
  unreadable.delete(tryKey);

  /* THE HOUSE MAY HAVE MOVED WHILE IT READ: the line, its detail, the pages themselves. Then nothing is written — the
   * pages are read again as they stand. */
  if (keeperAtWork()) return null;
  const shown = pages.slice(prompt.from, prompt.to + 1);
  const standsAsRead = async () => {
    const mNow = await loadMemory(storyId);
    if (!nodeUnmoved(mNow.nodes, prompt.lineId, prompt.lineSignature)) return null;
    const node = mNow.nodes.find((n) => n && n.id === prompt.lineId);
    if ((typeof node.detail === 'string' ? node.detail : '') !== prompt.lineDetail) return null;
    return mNow;
  };
  if (!(await standsAsRead())) return null;
  const pagesNow = visiblePages(await db.messages.list(storyId));
  if (!shown.every((pg, i) => pagesNow[prompt.from + i] && pagesNow[prompt.from + i].id === pg.id && pageText(pagesNow[prompt.from + i]) === pageText(pg))) return null;

  const turn = storyPageAt(pages, prompt.to) + 1;
  const first = scopeStretch(read.issues, { state, pagesText: prompt.sourceText, from: prompt.from, to: prompt.to, lineWhole: prompt.lineWhole && !prompt.lineEmpty, turn, asides: prompt.asides });

  /* 1. THE PAGES — the house's own mender, with his switch; a page already mended, or one whose words he put back, is
   * never mended again (noted, where the second reader's notes are). A reading that mends a page writes nothing else:
   * the mend lets the record line go, the keeper folds the mended words, and that line is read in its turn. */
  let mendedPages = 0;
  const notedFaults = [];
  for (const f of first.pageFixes) {
    if (isStale()) return null;
    const pg = f.page ? pagesNow[f.page - 1] : null;
    const itsStory = Boolean(pg && pg.role === 'assistant'); /* (a fault against an out-of-character page never gets here: scopeStretch) */
    const words = (f.what ? f.what.replace(/\s+$/, '') + ' ' : '') + 'It should read: ' + f.fix;
    let changed = [];
    if (itsStory && !pg.mended && !(typeof pg.keptText === 'string' && pg.keptText === pageText(pg)) && typeof mend === 'function') {
      try {
        if (typeof renew === 'function') renew();
        changed = (await mend(pg.id, words)) || [];
      } catch (err) {
        if (stopped()) throw err; /* stepped aside: nothing more is written, and the pages are read again */
        changed = [];
      }
    }
    if (Array.isArray(changed) && changed.length) { mendedPages += changed.length; continue; }
    notedFaults.push({ ...f, noted: false });
    if (itsStory && typeof note === 'function') {
      try { await note(pg.id, { words: 'The continuous audit: ' + words, severity: 'warn', kind: 'audit' }); notedFaults[notedFaults.length - 1].noted = true; } catch (err) { /* it is still said on the workers' line */ }
    }
  }
  if (mendedPages) {
    return { ok: true, from: prompt.from, to: prompt.to, mendedPages, applied: [], refused: first.refused, faults: notedFaults, lineMended: 0, detailAdded: '', lineWritten: false, passedBy: false, sealed: false, raw, ...auditProgress(await loadMemory(storyId), pagesNow.length) };
  }
  if (isStale() || stopped()) return null;

  /* 2. THE LEDGER, read fresh — what someone learned, dated with the pages it was learned on */
  let applied = [];
  let refused = first.refused;
  if (first.mutations.length) {
    const fresh = await loadState(storyId);
    const scoped = scopeStretch(read.issues, { state: fresh, pagesText: prompt.sourceText, from: prompt.from, to: prompt.to, lineWhole: prompt.lineWhole && !prompt.lineEmpty, turn, asides: prompt.asides });
    refused = scoped.refused;
    if (scoped.mutations.length) {
      const result = applyMutations({ ...fresh, page: storyPageAt(pages, prompt.to) }, scoped.mutations);
      applied = result.applied;
      refused = [...refused, ...result.rejected.map((r) => ({ mutation: r.mutation, why: r.why }))];
      if (applied.length) {
        await saveState(storyId, { ...result.state, page: fresh.page });
        notify(storyId);
      }
    }
  }

  /* 3. THE RECORD LINE, and the mark on it — one write, on the line as it stands this moment */
  let lineMended = 0;
  let detailAdded = '';
  let lineWritten = false;
  let sealed = false;
  let lineLeft = false;
  const current = await standsAsRead();
  if (current) {
    const node = current.nodes.find((n) => n && n.id === prompt.lineId);
    const add = first.record.detail && !looksLikeTokenDump(first.record.detail) ? first.record.detail : '';
    if (lineIsHis(node)) {
      /* his own words, or the housekeeper's for him: read, marked, never written over */
      lineLeft = Boolean(first.record.fixes.length || add);
    } else if (prompt.lineEmpty) {
      /* no line stood for these pages: what lasts of them becomes the line */
      if (add && !isNoRecordLine(add)) {
        node.text = add;
        node.empty = false;
        delete node.byHouse;
        node.at = Date.now();
        lineWritten = true;
        detailAdded = add;
      }
    } else {
      /* a fix lands only where its words stand exactly once in the line (a name the line also uses rightly elsewhere is
       * not swept along), never swaps a phrase for a fragment of it (three words for one loses what the line said), and
       * only by the keeper's own rule: the right words are in the pages */
      const wordsIn = (t) => String(t || '').trim().split(/\s+/).filter(Boolean).length;
      const once = first.record.fixes.filter((f) => f.from.length >= 3 && node.text.split(f.from).length === 2 && wordsIn(f.to) * 2 >= wordsIn(f.from));
      if (once.length) {
        const repaired = applyAuditFixes(node.text, once, prompt.sourceText);
        if (repaired.used.length && repaired.text.trim()) { node.text = repaired.text; lineMended = repaired.used.length; }
      }
      const had = String(node.detail || '');
      /* what the line or its detail already says is not said again */
      const fresher = add.split(/\s*;\s*/).filter((c) => c && !lower(node.text + ' ' + had).includes(lower(c))).join('; ');
      const merged = fresher ? mergeDetail(had, fresher) : had;
      if (merged !== had && merged.length <= DETAIL_CAP) { node.detail = merged; detailAdded = fresher; }
    }
    node.audited = prompt.to - node.span[0] + 1;
    await saveMemory(storyId, current);
    sealed = true;
  }
  const after = auditProgress(current || (await loadMemory(storyId)), pagesNow.length);
  return { ok: true, from: prompt.from, to: prompt.to, mendedPages: 0, applied, refused, faults: notedFaults, lineMended, detailAdded, lineWritten, lineLeft, passedBy, sealed, raw, ...after };
}

/* The line for the workers' shelf: what it read, what it set right, how far it has got. */
export function stretchWords(result) {
  if (!result) return '';
  const meter = ' — ' + result.done + ' of ' + result.folded + ' folded pages read';
  const pagesRead = result.from === result.to ? 'page ' + (result.from + 1) : 'pages ' + (result.from + 1) + '–' + (result.to + 1);
  if (result.mendedPages) {
    return 'read ' + pagesRead + ': mended ' + result.mendedPages + (result.mendedPages === 1 ? ' page' : ' pages')
      + ' that could not be true beside the story before (the earlier words are a tap away) — the keeper folds the mended words, and they are read once more' + meter;
  }
  if (result.passedBy) return pagesRead + ' could not be read (its model gave no answer it could use, ' + UNREADABLE_TRIES + ' times) and ' + (result.from === result.to ? 'was' : 'were') + ' passed by' + meter;
  const did = [
    ...result.applied.map((a) => String(a.words || '').replace(/\.+$/, '')),
    ...(result.lineMended ? ['the record line put right in ' + result.lineMended + (result.lineMended === 1 ? ' place' : ' places')] : []),
    ...(result.lineWritten ? ['wrote the record line the keeper had left empty: ' + result.detailAdded] : (result.detailAdded ? ['kept beneath the record line: ' + result.detailAdded] : [])),
  ];
  const faults = Array.isArray(result.faults) ? result.faults : [];
  const faultWords = faults.length ? '; ' + faults.length + (faults.length === 1 ? ' page fault' : ' page faults') + ' noted, not mended: ' + faults.map((f) => f.what || f.fix).join(' · ') : '';
  const refusedWords = result.refused.length ? '; ' + result.refused.length + ' not written (' + [...new Set(result.refused.map((r) => r.why))].slice(0, 2).join('; ') + ')' : '';
  const unsealed = result.sealed ? '' : '; the record moved while it read — these pages are read again';
  const left = result.lineLeft ? '; the record line is in your own words (or the housekeeper’s for you) — left as it is' : '';
  return 'read ' + pagesRead + ' against the story before, the record line and the ledger: '
    + (did.length ? 'set ' + did.length + (did.length === 1 ? ' thing' : ' things') + ' right — ' + did.join(' · ') : 'nothing to set right')
    + faultWords + refusedWords + left + unsealed + meter;
}
