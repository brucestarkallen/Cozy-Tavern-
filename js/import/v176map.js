/* Cozy Tavern — import/v176map.js
 * The known-entry map for the Simulation Engine V176 preset, and the
 * heuristic net that catches every other preset.
 *
 * Matching is by entry NAME, case-insensitive and emoji-tolerant: names in
 * the wild arrive wrapped in emoji, parentheticals, and trailing notes
 * ("🚫 Banned Words (Slop List) 🚫"), so both sides are normalized down to
 * plain lowercase words before comparing. A known key matches when the
 * normalized name is the key, or carries the key as a whole leading,
 * trailing, or enclosed phrase.
 *
 * Buckets (SPEC.md M5):
 *   craft        — stable core, joins The Craft as one user override
 *   modules      — rulebook rules with the right triggers (whenKey)
 *   frameSeeds   — suggested Frame/Note material, copy-only, never applied
 *   retired      — the engines/house now do this work; shelved with a why
 *   skipped      — markers, off-switches, and empty husks; left behind
 *
 * Anything the map doesn't know falls to heuristicSort(), which guesses a
 * bucket from name/content keywords and marks the item `guessed` so the
 * preview can say so honestly.
 */

/* Down to plain words: letters, numbers, spaces; lowercase; single spaces. */
export function normalizeName(name) {
  return String(name || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/* Whole-phrase match: exact, or the key appears on word boundaries. */
function nameMatches(entryName, key) {
  const n = normalizeName(entryName);
  const k = normalizeName(key);
  if (!n || !k) return false;
  return n === k || n.startsWith(k + ' ') || n.endsWith(' ' + k) || n.includes(' ' + k + ' ');
}

/* A switch someone flipped off in the old house: "⛔ … IS OFF ⛔".
 * Checked before everything else — these are husks, never cargo. */
export function isOffToggle(entry) {
  const raw = String((entry && entry.name) || '');
  if (raw.includes('⛔')) return true;
  const n = normalizeName(raw);
  return / is off$/.test(n) || / is off /.test(' ' + n + ' ');
}

/* Markers are slots SillyTavern fills itself (lorebook, persona, scenario,
 * history…). Matched by identifier first, then by name. */
const MARKER_IDENTIFIERS = new Set([
  'worldInfoBefore', 'worldInfoAfter', 'personaDescription', 'charDescription',
  'charPersonality', 'scenario', 'chatHistory', 'dialogueExamples',
]);
const MARKER_NAMES = [
  'Lorebook Before', 'Lorebook After', 'Persona Description', 'Char Description',
  'Char Personality', 'Scenario', 'Chat History', 'Chat Examples',
];

/* ---------- Bucket A — the craft (stable core, joined in original order) ---------- */
const CRAFT_NAMES = [
  'Main Prompt',
  'Time and Place',
  'Writing Guidelines (Anti-Slop)',
  'Banned Words',
  'Simulation Core',
  'Character Integrity',
  'Information Quarantine',
  'NPC Psychology',
  'Living World',
];

/* ---------- Bucket B — rulebook modules and their triggers ---------- */
const MODULE_ROWS = [
  { name: 'NSFW Mode', whenKey: 'intimate',
    why: 'wakes when the scene turns intimate' },
  { name: 'Contested Resolution', whenKey: 'combat',
    why: 'wakes when talk gives way to contest' },
  { name: 'Voices Block', whenKey: 'socialField',
    why: 'wakes when the room is full of voices' },
  { name: 'Species Vocalization', whenKey: 'manual',
    why: 'you choose when this walks in' },
  { name: 'Group Chat only', whenKey: 'manual',
    why: 'you choose when this walks in' },
  { name: 'Hybrid POV', whenKey: 'manual',
    why: 'you choose when this walks in' },
  { name: 'Twitter X Feed', whenKey: 'manual',
    why: 'you choose when this walks in' },
  { name: 'The World Beyond (TWB)', whenKey: 'worldWindow',
    why: 'wakes when the world agent opens a window beyond the page' },
  { name: 'NPC Private Thoughts', whenKey: 'manual',
    why: 'you choose when this walks in' },
];

/* ---------- Frame seeds — suggested material, copy-only, never applied ---------- */
const FRAME_SEED_NAMES = [
  'Authorship Frame',
  'Soft Jailbreak NSFW',
  'Firm Jailbreak',
];

/* ---------- Bucket C — retired into the engines ---------- */
const RETIRED_ENGINE_ROWS = [
  { name: 'HQ NPC Genesis', why: 'the world agent names who must exist; the registry keeps names unique' },
  { name: 'Continuity Verification', why: 'the second reader and the canon store verify' },
  { name: 'Scene Pulse (IST)', why: 'the ledger renders it' },
  { name: 'NPC Watchlist (ACW)', why: 'the world agent keeps the absent, with stance and arrival on the clock' },
  { name: 'Factions', why: 'the world agent moves factions on cause; the ledger renders them' },
  /* M30: the storyteller no longer runs the simulation in its own output. */
  { name: 'Better Narrative Drive and Tracking', why: 'Plot Momentum’s gates are the world agent’s: it moves the absent with motive and means, keeps the threads, and briefs the storyteller' },
];

/* ---------- Bucket D — retired into the house ---------- */
const RETIRED_HOUSE_ROWS = [
  { name: 'Output Systems', why: 'the house keeps the order of things' },
  { name: 'Commands (#p #pp #q)', why: 'the house hears commands' },
  { name: 'CoT', why: 'the storyteller thinks natively now' },
];

/* ---------- Known skips (besides markers and off-switches) ---------- */
const SKIP_ROWS = [
  { name: 'Enhance Definitions', why: 'a helper the house no longer needs', onlyWhenEmpty: false },
  { name: 'Auxiliary Prompt', why: 'a helper the house no longer needs', onlyWhenEmpty: false },
  { name: 'Post-History Instructions', why: 'empty — nothing to carry over', onlyWhenEmpty: true },
];

/* Classify one parsed entry against the known map.
 * -> { bucket, why?, whenKey? } | null when the map doesn't know it. */
export function knownSort(entry) {
  const name = (entry && entry.name) || '';
  const empty = !String((entry && entry.content) || '').trim();

  if (isOffToggle(entry)) {
    return { bucket: 'skipped', why: 'a switch left off in the old house — nothing to carry over' };
  }
  if (MARKER_IDENTIFIERS.has(entry.identifier) || MARKER_NAMES.some((k) => nameMatches(name, k))) {
    return { bucket: 'skipped', why: 'a marker — the house keeps these slots itself' };
  }
  for (const row of SKIP_ROWS) {
    if (nameMatches(name, row.name) && (!row.onlyWhenEmpty || empty)) {
      return { bucket: 'skipped', why: row.why };
    }
  }
  if (CRAFT_NAMES.some((k) => nameMatches(name, k))) {
    return { bucket: 'craft' };
  }
  for (const row of MODULE_ROWS) {
    if (nameMatches(name, row.name)) {
      return { bucket: 'modules', whenKey: row.whenKey, why: row.why };
    }
  }
  if (FRAME_SEED_NAMES.some((k) => nameMatches(name, k))) {
    return { bucket: 'frameSeeds' };
  }
  for (const row of RETIRED_ENGINE_ROWS) {
    if (nameMatches(name, row.name)) return { bucket: 'retired', why: row.why };
  }
  for (const row of RETIRED_HOUSE_ROWS) {
    if (nameMatches(name, row.name)) return { bucket: 'retired', why: row.why };
  }
  return null;
}

/* The net for every other preset. Keyword guesses first; then in-chat
 * injections read as situational rules (manual modules); relative-position
 * blocks read as standing guidance (craft). Every guess is marked so the
 * preview can say "we're guessing" out loud. */
const HEURISTIC_WORDS = [
  { whenKey: 'intimate', re: /\b(nsfw|intimate|intimacy|erotic|explicit|lewd|sex)\b/i,
    why: 'reads like it belongs to intimate scenes — a guess' },
  { whenKey: 'combat', re: /\b(combat|contested|fight|fighting|battle|dice|difficulty|challenge)\b/i,
    why: 'reads like it settles contests — a guess' },
  { whenKey: 'socialField', re: /\b(voices?|dialogue|banter|crowd|party|social|conversation)\b/i,
    why: 'reads like it minds a room full of voices — a guess' },
];

export function heuristicSort(entry) {
  const name = (entry && entry.name) || '';
  const content = String((entry && entry.content) || '');
  const haystack = normalizeName(name) + ' ' + normalizeName(content.slice(0, 400));

  if (!content.trim()) {
    return { bucket: 'skipped', why: 'empty — nothing to carry over', guessed: true };
  }
  if (/\bjailbreak\b/.test(haystack)) {
    return { bucket: 'frameSeeds', guessed: true };
  }
  for (const { whenKey, re, why } of HEURISTIC_WORDS) {
    if (re.test(haystack)) {
      return { bucket: 'modules', whenKey, why, guessed: true };
    }
  }
  /* Injected in-chat at a depth (SillyTavern's position 1) reads as a
   * situational rule; everything else is standing guidance — the craft. */
  if (Number(entry && entry.pos) === 1) {
    return {
      bucket: 'modules', whenKey: 'manual',
      why: 'sat close to the page in the old house — pin it when it’s wanted (a guess)',
      guessed: true,
    };
  }
  return { bucket: 'craft', guessed: true };
}

/* One entry, one home: known map first, heuristics after. */
export function classify(entry) {
  return knownSort(entry) || heuristicSort(entry);
}
