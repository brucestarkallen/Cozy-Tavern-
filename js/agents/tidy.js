/* M291: THE CHARACTER PAGES, TIDIED ONCE.
 *
 * The writer's pages read as a stale, jumbled record beside the living
 * "elsewhere" of the world agent: the founder had been told that a page's
 * "now" is "where they are in their life", so eleven pages said "Now:
 * Ravenwood High second-year; 17" — who they are, standing where the moment
 * should — and nothing ever replaced it (a person away is the world agent's;
 * the scribe writes the now of those on the page). An older mistake had put
 * Mrs. Sterling's moments on Mr. Sterling's page. The founder and the scribe
 * now agree what each field is; this reads every page once more — with the
 * brief, the cast notes, where each one is, and the latest pages — and puts
 * each line where it belongs. The standings are not touched; a field the
 * writer wrote by hand is never rewritten; a core is never shortened; every
 * change is journaled and can be taken back. */
import { seatForPerson } from '../engine/people.js'; /* M320 */
import { callWorker } from './call.js';
import { balancedCandidates, parseLenient } from './jsonutil.js';
import { withFictionFrame } from './voice.js';
import { db } from '../store.js';
import { loadState, saveState, notify } from '../engine/state.js';
import { applyMutations } from '../engine/apply.js';
import { isMc } from '../engine/people.js';
import { mcName } from '../engine/duels.js';
import { writerText, BRIEF_ROOM, CAST_ROOM } from '../engine/whole.js';
import { wholePage } from '../engine/pagecut.js';
import { visiblePages } from './memory.js';
import { pageText } from '../assemble/stack.js';

export const TIDY_GEN = 291;
const MAX_TOKENS = 8000;
const BATCH = 8;
const FENCE = '"' + '"' + '"';
const LIFE_LINE = /\b(first|second|third|fourth|final)[-\s]year\b|\b(freshman|sophomore|junior|senior)\b|;\s*\d{1,2}\s*(;|$)|\b\d{1,2}[-\s]years?[-\s]old\b|\baged\s+\d{1,2}\b/i;
const TITLED = /^(mr|mrs|ms|miss)\.?\s+(.+)$/i;

const pagesOf = (state) => Object.entries((state && state.characters) || {})
  .filter(([n, c]) => c && typeof c === 'object' && !c.retired && !isMc(state, n));

/* a "now" that is who they are in their life, not where they are */
export function lifeLineInNow(state) {
  return pagesOf(state).some(([, c]) => !(c.hand && c.hand.state) && LIFE_LINE.test(String(c.state || '')));
}
/* a titled page that speaks of the other titled one of its house */
export function titleCrossed(state) {
  const all = pagesOf(state);
  for (const [name, c] of all) {
    const t = TITLED.exec(name);
    if (!t) continue;
    const male = /^mr$/i.test(t[1]);
    const other = all.find(([n]) => { const u = TITLED.exec(n); return u && u[2].trim().toLowerCase() === t[2].trim().toLowerCase() && /^mr$/i.test(u[1]) !== male; });
    if (!other) continue;
    const said = String(c.state || '') + ' ' + String(c.arc || '');
    if ((male ? /\b(she|her|herself)\b/i : /\b(he|his|himself)\b/i).test(said)) return true;
  }
  return false;
}
export function tidyDue(state) {
  return !(Number(state && state.tidiedGen) >= TIDY_GEN) && (lifeLineInNow(state) || titleCrossed(state));
}

export const TIDY_SYSTEM = [
  'You keep the character pages of a long story tidy. Each page has three fields:',
  '  core  — WHO THEY ARE: nature, role, and their standing facts — school year, age, family, home, background.',
  '  state — WHERE THEY ARE AND WHAT THEY ARE DOING NOW, in this story\'s present; nothing else.',
  '  arc   — HOW THINGS STAND between them and the main character, and why.',
  'You are handed the writer\'s brief and cast notes (they outrank every page), the pages, where the absent are',
  'right now (the world\'s own word), and the latest pages of the story. For each page, return only the fields',
  'that are wrong, whole, corrected:',
  '  - a "state" that holds who they are (a school year, an age, a role, a family, a home) is not a state:',
  '    add those facts to their core (keep every fact the core already has — never shorten a core) and',
  '    write their state from the latest pages if they are in them; otherwise return "state": "" to let it go.',
  '  - a person away from the scene whose place is given under WHERE THE ABSENT ARE: their state is that',
  '    place already — return "state": "" if their page says something older.',
  '  - words on one person\'s page that tell another person\'s doings (a husband\'s page holding his wife\'s',
  '    moments — "her fist", "she is baking") belong to that other person: write them into THAT person\'s',
  '    fields, and correct or let go (as "") the field they sat in.',
  '  - never invent: every fact comes from the brief, the cast notes, the pages given, or the latest pages.',
  '  - the main character has no page here.',
  'Answer with JSON ONLY: {"pages":[{"name":"NAME","core":"…","state":"…","arc":"…"}]} — a field left out is',
  'kept as it is; "" lets a state or an arc go. A page that is already right is left out. No commentary.',
].join('\n');

export function buildTidyMessages({ brief = '', castNotes = '', batch = [], kin = [], seats = {}, recent = '', mc = '' }) {
  const pageOf = ([name, c]) => '[' + name + ']\n  core: ' + (c.core || '(empty)') + '\n  state: ' + (c.state || '(empty)') + '\n  arc: ' + (c.arc || '(empty)');
  const seatLines = Object.entries(seats).map(([n, s]) => n + ' — ' + [s.location, s.activity].filter(Boolean).join(', '));
  const user = [
    'THE BRIEF (it outranks every page):', FENCE, writerText(brief, BRIEF_ROOM, 'brief') || '(none)', FENCE, '',
    'THE CAST NOTES:', FENCE, writerText(castNotes, CAST_ROOM, 'cast notes') || '(none)', FENCE, '',
    'THE PAGES TO TIDY' + (mc ? ' (the main character is ' + mc + ')' : '') + ':', batch.map(pageOf).join('\n') || '(none)', '',
    ...(kin.length ? ['THEIR HOUSEHOLDS\u2019 PAGES (for words that belong to another; tidy them too if they need it):', kin.map(pageOf).join('\n'), ''] : []),
    'WHERE THE ABSENT ARE RIGHT NOW (the world\u2019s own word):', seatLines.join('\n') || '(nobody seated)', '',
    'THE LATEST PAGES OF THE STORY:', FENCE, recent || '(none)', FENCE, '',
    'Which fields are wrong? JSON only.',
  ].join('\n');
  return { system: withFictionFrame(TIDY_SYSTEM), user };
}

export function parseTidyAnswer(raw) {
  try {
    const text = String(raw || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/```(?:json|JSON)?/g, '');
    for (const cand of balancedCandidates(text, 5)) {
      const p = parseLenient(cand);
      if (p && Array.isArray(p.pages)) {
        return p.pages.filter((x) => x && typeof x.name === 'string' && x.name.trim()).map((x) => {
          const out = { name: x.name.trim() };
          for (const f of ['core', 'state', 'arc']) if (typeof x[f] === 'string') out[f] = x[f].trim();
          return out;
        });
      }
    }
  } catch (err) { /* nothing usable */ }
  return null;
}

/* what an answer may change: never a hand-written field, never an emptied or shortened core */
export function tidyMutations(state, answer) {
  const chars = (state && state.characters) || {};
  const out = [];
  for (const p of answer || []) {
    const key = Object.keys(chars).find((k) => k.toLowerCase() === String(p.name || '').toLowerCase());
    if (!key || isMc(state, key)) continue;
    const c = chars[key] || {};
    for (const f of ['core', 'state', 'arc']) {
      if (!(f in p)) continue;
      if (c.hand && c.hand[f]) continue;
      const now = String(c[f] || '').trim();
      const next = p[f];
      if (next === now) continue;
      if (f === 'core') {
        if (!next || next.length < now.length * 0.9) continue;
        out.push({ type: 'people.set', name: key, field: 'core', text: next });
      } else if (!next) {
        if (now) out.push({ type: 'people.set', name: key, field: f, text: '', clear: true });
      } else {
        out.push({ type: 'people.set', name: key, field: f, text: next });
      }
    }
  }
  return out;
}

export async function tidyPeople({ connection, storyId, brief = '', castNotes = '', signal, stale = () => false, renew } = {}) {
  if (!connection || !storyId) return null;
  const state = await loadState(storyId);
  const mc = mcName(state) !== 'the player' ? mcName(state) : '';
  const list = pagesOf(state);
  const history = visiblePages(await db.messages.list(storyId));
  const recent = history.slice(-6).map((m) => (m.role === 'assistant' ? 'THE STORYTELLER' : 'THE WRITER') + ':\n' + wholePage(pageText(m), 8000)).join('\n\n');
  const surname = (n) => { const t = TITLED.exec(n); return t ? t[2].trim().toLowerCase() : n.trim().split(/\s+/).slice(-1)[0].toLowerCase(); };
  const answers = [];
  let batches = 0;
  let failed = 0;
  for (let i = 0; i < list.length; i += BATCH) {
    if (stale()) return null;
    const batch = list.slice(i, i + BATCH);
    const names = new Set(batch.map(([n]) => n));
    const kin = list.filter(([n]) => !names.has(n) && TITLED.test(n) && batch.some(([b]) => TITLED.test(b) && surname(b) === surname(n)));
    const seats = {};
    for (const [n] of [...batch, ...kin]) {
      const k = (seatForPerson(state, n) || {}).key; /* M320 */
      if (k) seats[n] = state.offscreen[k];
    }
    const prompt = buildTidyMessages({ brief, castNotes, batch, kin, seats, recent, mc });
    if (typeof renew === 'function') renew();
    let answer = null;
    try {
      const res = await callWorker(connection, { system: prompt.system, user: prompt.user, maxTokens: MAX_TOKENS, signal });
      answer = parseTidyAnswer(res && res.text);
    } catch (err) {
      if (err && (err.name === 'AbortError' || (signal && signal.aborted))) return null;
      throw err;
    }
    batches += 1;
    if (!answer) { failed += 1; continue; }
    answers.push(...answer);
  }
  if (stale()) return null;
  /* judged against the pages as they stand now (a page may have moved while it read) */
  const fresh = await loadState(storyId);
  const { state: next, applied, rejected } = applyMutations(fresh, tidyMutations(fresh, answers));
  /* an answer that could not be read is asked again next time — the stamp waits for a clean reading */
  await saveState(storyId, failed ? next : { ...next, tidiedGen: TIDY_GEN });
  notify(storyId);
  return { applied, rejected, batches, failed };
}

export function tidyRunWords(r) {
  if (!r) return 'left behind';
  const n = r.applied.length;
  const who = [...new Set(r.applied.map((a) => a.mutation.name))];
  return (n
    ? 'tidied ' + who.length + (who.length === 1 ? ' page' : ' pages') + ' (' + n + (n === 1 ? ' line' : ' lines') + ' put where they belong: ' + who.slice(0, 6).join(', ') + (who.length > 6 ? ', \u2026' : '') + ')'
    : 'read the character pages; each line already stood where it belongs')
    + (r.failed ? ' \u2014 ' + r.failed + ' of ' + r.batches + ' answers could not be read; it tries those again' : '');
}
