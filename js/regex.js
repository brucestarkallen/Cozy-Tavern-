/* Cozy Tavern — regex.js
 * M30: the regex shelf — SillyTavern's regex scripts, in the house's voice.
 *
 * A rule is a find/replace that runs over words at one of three moments:
 *
 *   page    — on the finished page, BEFORE it is saved. This is the one that
 *             matters: what it removes is gone from the story, from the
 *             history sent back every turn, and from every worker's reading.
 *             (A block hidden only from the eye still rides the wire — and a
 *             transcript full of old tracker blocks is exactly the drift
 *             the world agent exists to end.)
 *   display — on the thread only. The stored page keeps its words.
 *   wire    — on the history the storyteller is sent, only. The page and the
 *             thread keep their words.
 *
 * and over one of two voices: the storyteller's pages, the writer's, or both.
 *
 * Shape: {id, name, find, flags, replace, on:'storyteller'|'writer'|'both',
 *         mode:'page'|'display'|'wire', enabled, builtin?, note?}
 * `find` is a JavaScript regular expression source; `flags` its flags ('g'
 * is added if missing so every match is taken). `replace` may use $1…$9.
 * A rule whose regex will not compile is skipped, never a crash.
 *
 * Three rules ship with the house, on by default, all page-mode over the
 * storyteller's pages — the residue of a SillyTavern preset whose output
 * systems the house has retired: the [Location — Day | HH:MM | …] header
 * (the house writes its own masthead from the ledger), the Plot Momentum
 * <details> block (the world agent keeps the threads), and the
 * {PULSE}/{WATCHLIST}/{VOICES} tracker blocks (the ledger renders them).
 *
 * Storage: settings key `regexRules` (the whole list, builtin rows
 * included, so a writer's edits to a builtin stand). A builtin the stored
 * list lacks — shipped by a newer coat — is seeded on load.
 */

import { db } from './store.js';

export const REGEX_KEY = 'regexRules';
export const MODES = ['page', 'display', 'wire'];
export const VOICES = ['storyteller', 'writer', 'both'];

export const MODE_WORDS = {
  page: 'the page itself, before it is saved (history and the workers see the result)',
  display: 'the thread only (the page keeps its words)',
  wire: 'what the storyteller is sent, only',
};
export const VOICE_WORDS = {
  storyteller: 'the storyteller’s pages',
  writer: 'the writer’s pages',
  both: 'both voices',
};

export const BUILTIN_RULES = [
  {
    id: 'builtin-preset-header',
    name: 'The preset’s own header line',
    find: '^\\s*\\[[^\\[\\]\\n]*\\|[^\\[\\]\\n]*\\]\\s*$\\n?',
    flags: 'gm',
    replace: '',
    on: 'storyteller',
    mode: 'page',
    enabled: true,
    builtin: true,
    note: 'A bracketed line with a pipe in it — [Place — Day, Date | HH:MM | weather | attire | position], and the [ACW: …|…] / [IST: …|…] tracker lines. The house writes its own masthead from the ledger.',
  },
  {
    id: 'builtin-plot-momentum',
    name: 'The Plot Momentum block',
    find: '\\n*<details>\\s*<summary>\\s*Plot Momentum\\s*</summary>[\\s\\S]*?</details>\\s*',
    flags: 'gi',
    replace: '',
    on: 'storyteller',
    mode: 'page',
    enabled: true,
    builtin: true,
    note: 'The <details> block a SillyTavern preset asks for at the end of every page. The world agent keeps the threads now.',
  },
  {
    id: 'builtin-tracker-blocks',
    name: 'The tracker blocks',
    find: '\\n*\\{(PULSE|WATCHLIST|VOICES)\\}[\\s\\S]*?\\{\\/\\1\\}\\s*',
    flags: 'g',
    replace: '',
    on: 'storyteller',
    mode: 'page',
    enabled: true,
    builtin: true,
    note: '{PULSE}…{/PULSE}, {WATCHLIST}…{/WATCHLIST}, {VOICES}…{/VOICES}. The ledger renders what they carried.',
  },
];

/* Compile a rule, or null when it cannot be. 'g' is always on: a rule takes
 * every match. Exported for the harness and the settings form's "try it". */
export function compileRule(rule) {
  if (!rule || typeof rule.find !== 'string' || !rule.find) return null;
  let flags = typeof rule.flags === 'string' ? rule.flags.replace(/[^gimsuy]/g, '') : '';
  if (!flags.includes('g')) flags += 'g';
  try {
    return { re: new RegExp(rule.find, flags), replace: typeof rule.replace === 'string' ? rule.replace : '' };
  } catch (err) {
    return null;
  }
}

function tidy(text) {
  /* A removal leaves holes: collapse three or more newlines to two, and
   * trim the ends. Never touches a page that no rule changed. */
  return String(text).replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
}

/* Run every enabled rule that fits this moment and voice, in shelf order.
 * `on` is the page's voice ('storyteller' for the storyteller's pages,
 * 'writer' for the writer's; the roles 'assistant'/'user' are accepted too).
 * Never throws; a rule that misbehaves is skipped. */
export function applyRules(text, rules, { on, mode } = {}) {
  let out = typeof text === 'string' ? text : '';
  if (!out || !Array.isArray(rules) || !rules.length) return out;
  const voice = on === 'assistant' ? 'storyteller' : (on === 'user' ? 'writer' : on);
  let changed = false;
  for (const rule of rules) {
    if (!rule || rule.enabled === false) continue;
    if (MODES.includes(mode) && rule.mode !== mode) continue;
    if (voice && rule.on !== 'both' && rule.on !== voice) continue;
    const c = compileRule(rule);
    if (!c) continue;
    try {
      const next = out.replace(c.re, c.replace);
      if (next !== out) { out = next; changed = true; }
    } catch (err) { /* a misbehaving rule is skipped, never a crash */ }
  }
  return changed && mode === 'page' ? tidy(out) : out;
}

/* How a rule would land on one text: matches and characters removed. */
export function tryRule(text, rule) {
  const c = compileRule(rule);
  if (!c) return { ok: false, why: 'That pattern won’t compile as a regular expression.' };
  const src = typeof text === 'string' ? text : '';
  const matches = (src.match(c.re) || []).length;
  const after = src.replace(c.re, c.replace);
  return { ok: true, matches, before: src.length, after: after.length, text: after };
}

/* ---------- persistence + the live shelf ---------- */

let live = BUILTIN_RULES.map((r) => ({ ...r }));

function normalizeRule(r, i) {
  if (!r || typeof r !== 'object') return null;
  const find = typeof r.find === 'string' ? r.find : '';
  if (!find) return null;
  return {
    id: typeof r.id === 'string' && r.id ? r.id : 'rule-' + Date.now().toString(36) + '-' + i,
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 80) : 'A rule',
    find,
    flags: typeof r.flags === 'string' ? r.flags.replace(/[^gimsuy]/g, '') : 'g',
    replace: typeof r.replace === 'string' ? r.replace : '',
    on: VOICES.includes(r.on) ? r.on : 'storyteller',
    mode: MODES.includes(r.mode) ? r.mode : 'page',
    enabled: r.enabled !== false,
    builtin: r.builtin === true,
    note: typeof r.note === 'string' ? r.note.slice(0, 300) : '',
  };
}

/* The shelf as stored, with any builtin the store lacks seeded in place. */
export async function loadRules() {
  let stored = await db.settings.get(REGEX_KEY);
  let list = Array.isArray(stored) ? stored.map(normalizeRule).filter(Boolean) : [];
  let seeded = false;
  for (const b of BUILTIN_RULES) {
    if (!list.some((r) => r.id === b.id)) { list.push({ ...b }); seeded = true; }
  }
  if (!Array.isArray(stored) || seeded) await db.settings.set(REGEX_KEY, list);
  live = list;
  return list;
}

export async function saveRules(rules) {
  const list = (Array.isArray(rules) ? rules : []).map(normalizeRule).filter(Boolean);
  await db.settings.set(REGEX_KEY, list);
  live = list;
  return list;
}

/* The shelf as last loaded — for render paths that cannot await. */
export function currentRules() {
  return live;
}

/* Restore a builtin's shipped words (after an edit). */
export function builtinOriginal(id) {
  const b = BUILTIN_RULES.find((r) => r.id === id);
  return b ? { ...b } : null;
}
