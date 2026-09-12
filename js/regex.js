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
import { STYLE_PACK } from './regex-styles.js'; /* M34: the 🎨 pack */

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

const HOUSE_RULES = [
  {
    id: 'builtin-preset-header',
    name: 'Remove the preset’s header line',
    find: '^\\s*\\[[^\\[\\]\\n]*\\|[^\\[\\]\\n]*\\]\\s*$\\n?',
    flags: 'gm',
    replace: '',
    on: 'storyteller',
    mode: 'page',
    enabled: false,
    builtin: true,
    note: 'OFF by default (M31): most writers keep the [Place — Day, Date | HH:MM | weather | attire | position] header and style it with a display rule instead — bring your SillyTavern regex file below. Turn this on only if you want the line gone and the house masthead in its place.',
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
    name: 'The state blocks',
    find: '\\n*\\{(PULSE|WATCHLIST|VOICES)\\}[\\s\\S]*?\\{\\/\\1\\}\\s*',
    flags: 'g',
    replace: '',
    on: 'storyteller',
    mode: 'page',
    enabled: true,
    builtin: true,
    note: '{PULSE}…{/PULSE}, {WATCHLIST}…{/WATCHLIST} and {VOICES}…{/VOICES} — state the ledger keeps and voices the world agent writes (M97: read in the drawer, never on the page). A storyteller that writes them is copying old pages; they are taken off at the door.',
  },
  {
    id: 'builtin-rule-headings',
    name: 'A rule’s heading on the page',
    find: '^[ \\t]*#{0,6}[ \\t]*(?:The Window Beyond [Tt]he Page|The craft|When the scene turns intimate|When words won’t carry it)[ \\t]*\\n?',
    flags: 'gm',
    replace: '',
    on: 'storyteller',
    mode: 'page',
    enabled: true,
    builtin: true,
    note: 'M116: a storyteller that copies a rule’s own heading onto the page (a second window titled "The Window Beyond the Page") loses the heading at the door; the eye warns on the duplicate and the next turn recolors.',
  },
  {
    id: 'builtin-tracker-blocks-wire',
    name: 'The state blocks, off the wire',
    find: '\\n*\\{(PULSE|WATCHLIST|VOICES)\\}[\\s\\S]*?\\{\\/\\1\\}\\s*',
    flags: 'g',
    replace: '',
    on: 'storyteller',
    mode: 'wire',
    enabled: true,
    builtin: true,
    note: 'M106: the same blocks stripped from the pages the storyteller is SENT — old pages that still carry them (from before the house) taught the model to write them again.',
  },
];

/* The shelf's builtins: the house rules, then the 🎨 pack (display only). */
export const BUILTIN_RULES = [...HOUSE_RULES, ...STYLE_PACK.map((r) => ({ ...r }))];

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
    touched: r.touched === true,
    pack: typeof r.pack === 'string' ? r.pack : '',
  };
}

/* The shelf as stored, with any builtin the store lacks seeded in place. */
export async function loadRules() {
  let stored = await db.settings.get(REGEX_KEY);
  let list = Array.isArray(stored) ? stored.map(normalizeRule).filter(Boolean) : [];
  let seeded = false;
  for (const b of BUILTIN_RULES) {
    const at = list.findIndex((r) => r.id === b.id);
    if (at === -1) { list.push({ ...b }); seeded = true; continue; }
    /* M32: a builtin the writer never touched follows the shipped words and
     * switch — so an m30 shelf seeded with the header removal ON lands on
     * the m31 default (OFF) without the writer lifting a finger. A builtin
     * the writer toggled or edited (touched) stands as they left it. */
    if (!list[at].touched) {
      const fresh = { ...b, touched: false };
      if (JSON.stringify(normalizeRule(list[at], at)) !== JSON.stringify(normalizeRule(fresh, at))) { list[at] = fresh; seeded = true; }
    }
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

/* ---------- M31: bring your SillyTavern regex ---------- */

/* Does a replacement carry HTML the thread should render? */
export function replaceHasHtml(replace) {
  return /<\/?[a-z][^>]*>/i.test(String(replace || ''));
}

/* Parse SillyTavern's "/pattern/flags" form (or a bare pattern). */
export function splitFindRegex(findRegex) {
  const raw = String(findRegex || '');
  const m = raw.match(/^\/([\s\S]*)\/([gimsuy]*)$/);
  if (m) return { find: m[1], flags: m[2] || '' };
  return { find: raw, flags: '' };
}

/* A SillyTavern regex-script export (one object or an array) → shelf rules.
 *   placement 1 = the writer's words, 2 = the storyteller's pages (others skipped)
 *   markdownOnly → display; promptOnly → wire; both → one display + one wire
 *   rule; neither → page (SillyTavern's default alters the stored message).
 * Unknown macros in the replacement ({{user}} …) are left as typed. */
export function importSillyTavernRegex(jsonText) {
  let data;
  try { data = typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText; } catch (err) {
    throw new Error('That file wouldn’t open — it doesn’t read like JSON. Is it a regex export?');
  }
  const list = Array.isArray(data) ? data : [data];
  const rules = [];
  const skipped = [];
  for (const it of list) {
    if (!it || typeof it !== 'object' || typeof it.findRegex !== 'string' || !it.findRegex) { skipped.push(it && it.scriptName ? it.scriptName : 'an entry'); continue; }
    const { find, flags } = splitFindRegex(it.findRegex);
    const placement = Array.isArray(it.placement) ? it.placement.map(Number) : [2];
    const voices = [];
    if (placement.includes(2)) voices.push('storyteller');
    if (placement.includes(1)) voices.push('writer');
    if (!voices.length) { skipped.push(it.scriptName || 'an entry'); continue; }
    const on = voices.length === 2 ? 'both' : voices[0];
    const modes = [];
    if (it.markdownOnly) modes.push('display');
    if (it.promptOnly) modes.push('wire');
    if (!modes.length) modes.push('page');
    const name = typeof it.scriptName === 'string' && it.scriptName.trim() ? it.scriptName.trim() : 'A rule from SillyTavern';
    for (const mode of modes) {
      rules.push({
        id: 'st-' + (typeof it.id === 'string' && it.id ? it.id : Math.random().toString(36).slice(2)) + (modes.length > 1 ? '-' + mode : ''),
        name: modes.length > 1 ? name + ' (' + mode + ')' : name,
        find,
        flags: flags || 'g',
        replace: typeof it.replaceString === 'string' ? it.replaceString : '',
        on,
        mode,
        enabled: it.disabled !== true,
        builtin: false,
        note: '',
      });
    }
  }
  return { rules, skipped };
}
