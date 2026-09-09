/* Cozy Tavern — import/lorebook.js
 * Bring your lore: read a SillyTavern lorebook (World Info JSON) and shelve
 * it for one story. Entries stay on the shelf until one of their keys is
 * spoken in the latest pages — then, and only then, the entry rides along
 * in slot 7 ("What remains"), inside the slot's budget.
 *
 * Retrieval here is pure and deterministic: case-insensitive whole-word key
 * hits, scored by how many distinct keys woke, joined under a character
 * budget. No LLM, no network, no per-turn cost — the latency law is
 * untouched.
 *
 * Contract (SPEC.md M7, widened M9):
 *   parseLorebook(jsonText)  -> [{id, keys:[], content, enabled, constant,
 *                                 secondaryKeys, depth}]
 *                               (throws kind, human Errors)
 *   saveLore(storyId, entries) / loadLore(storyId)
 *   updateLoreEntry(storyId, id, patch)   // M9: per-entry save
 *   removeLoreEntry(storyId, id)          // M9: per-entry delete
 *   moveLoreEntry(storyId, id, dir)       // M9: per-entry reorder (+1/-1)
 *   matchLore(entries, recent, budgetChars=1200) -> string ('' = none)
 *   matchLoreDetailed(entries, recent, budgetChars) -> {text, fired:[…]}
 *   recent = a string (the last pages joined), or — M9 — an array of page
 *            texts, newest last, so each entry scans its own depth.
 *
 * M9 retrieval rules: a constant entry ALWAYS rides (budget first, in shelf
 * order, no key needed). A keyed entry scans the last `depth` pages
 * (default 2). An entry with secondaryKeys is SillyTavern's selective
 * AND-mode: at least one primary AND at least one secondary key must be
 * spoken. Whole-word matching is kept.
 *
 * The shelf lives in the settings store under `lore:<storyId>`, so backups
 * carry it — and it is let go with its story (see store.js).
 */

import { db } from '../store.js';

const KEY_PREFIX = 'lore:';

/* ---------- parse ---------- */

export function parseLorebook(jsonText) {
  let raw;
  try {
    raw = JSON.parse(String(jsonText || ''));
  } catch (err) {
    throw new Error('That file wouldn’t open — it doesn’t read like JSON. Is it a lorebook export?');
  }
  const container = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw.entries : null;
  if (!container || typeof container !== 'object') {
    throw new Error('That file doesn’t read like a SillyTavern lorebook — no entries on the shelf.');
  }
  /* SillyTavern writes entries as an object keyed by "0", "1", …; some
   * exports hand over an array instead. Integer-like keys sort themselves
   * ascending in JS, but we sort by hand so the order is never in doubt. */
  const rows = Array.isArray(container)
    ? container
    : Object.keys(container)
      .sort((a, b) => {
        const na = Number(a);
        const nb = Number(b);
        return Number.isFinite(na) && Number.isFinite(nb) ? na - nb : 0;
      })
      .map((k) => container[k]);

  const entries = [];
  rows.forEach((row, i) => {
    if (!row || typeof row !== 'object') return;
    const rawKeys = Array.isArray(row.keys) ? row.keys : (Array.isArray(row.key) ? row.key : []);
    const keys = rawKeys.map((k) => String(k == null ? '' : k).trim()).filter(Boolean);
    const rawSecondary = Array.isArray(row.keysecondary) ? row.keysecondary
      : (Array.isArray(row.secondary_keys) ? row.secondary_keys
        : (Array.isArray(row.secondaryKeys) ? row.secondaryKeys : []));
    const secondaryKeys = rawSecondary.map((k) => String(k == null ? '' : k).trim()).filter(Boolean);
    const entry = {
      id: row.uid != null ? row.uid : (row.id != null ? row.id : i),
      keys,
      content: typeof row.content === 'string' ? row.content.trim() : '',
      /* ST's switch is `disable`; a few exports write `enabled` instead. */
      enabled: row.disable === true ? false : row.enabled !== false,
    };
    /* M9: the rest of ST's semantics travel too — constant entries always
     * ride; selective entries need a primary AND a secondary key;
     * scan_depth says how far back the listening reaches. */
    if (row.constant === true) entry.constant = true;
    if (secondaryKeys.length) entry.secondaryKeys = secondaryKeys;
    const depth = Number(row.scan_depth != null ? row.scan_depth : row.depth);
    if (Number.isFinite(depth) && depth > 0) entry.depth = Math.floor(depth);
    entries.push(entry);
  });
  if (!entries.length) {
    throw new Error('That lorebook is an empty shelf — there’s nothing in it to bring over.');
  }
  return entries;
}

/* ---------- the shelf (per story, in the settings store) ---------- */

export async function saveLore(storyId, entries) {
  if (!storyId) return;
  await db.settings.set(KEY_PREFIX + storyId, Array.isArray(entries) ? entries : []);
}

export async function loadLore(storyId) {
  if (!storyId) return [];
  const saved = await db.settings.get(KEY_PREFIX + storyId);
  if (!Array.isArray(saved)) return [];
  return saved.filter((e) => e && typeof e === 'object');
}

/* ---------- M9: per-entry operations (the settings UI's editor) ----------
 * Each reads the shelf, changes one entry, writes the shelf back. None
 * throws on a missing id — that's a quiet no-op returning undefined. */

export async function updateLoreEntry(storyId, entryId, patch) {
  if (!storyId || !entryId) return undefined;
  const entries = await loadLore(storyId);
  const index = entries.findIndex((e) => e && e.id === entryId);
  if (index === -1) return undefined;
  const next = { ...entries[index] };
  const p = patch && typeof patch === 'object' ? patch : {};
  if (typeof p.content === 'string') next.content = p.content;
  if (typeof p.name === 'string') next.name = p.name.trim() || null;
  if (Array.isArray(p.keys)) {
    next.keys = p.keys.map((k) => String(k == null ? '' : k).trim()).filter(Boolean);
  }
  if (Array.isArray(p.secondaryKeys)) {
    next.secondaryKeys = p.secondaryKeys.map((k) => String(k == null ? '' : k).trim()).filter(Boolean);
  }
  if (typeof p.enabled === 'boolean') next.enabled = p.enabled;
  if (typeof p.constant === 'boolean') next.constant = p.constant;
  if (Number.isFinite(p.depth) && p.depth > 0) next.depth = Math.floor(p.depth);
  entries[index] = next;
  await saveLore(storyId, entries);
  return next;
}

export async function removeLoreEntry(storyId, entryId) {
  if (!storyId || !entryId) return undefined;
  const entries = await loadLore(storyId);
  const next = entries.filter((e) => e && e.id !== entryId);
  if (next.length === entries.length) return undefined;
  await saveLore(storyId, next);
  return next;
}

/* dir = -1 (earlier on the shelf) or +1 (later). */
export async function moveLoreEntry(storyId, entryId, dir) {
  if (!storyId || !entryId) return undefined;
  const entries = await loadLore(storyId);
  const index = entries.findIndex((e) => e && e.id === entryId);
  if (index === -1) return undefined;
  const swap = index + (dir < 0 ? -1 : 1);
  if (swap < 0 || swap >= entries.length) return undefined;
  const [entry] = entries.splice(index, 1);
  entries.splice(swap, 0, entry);
  await saveLore(storyId, entries);
  return entries;
}

/* ---------- retrieval: whole-word keys, deterministic ---------- */

/* A key "hits" only as a whole word — "ash" hears "the ash pit", never
 * "Ashford". Letters and numbers count as word; everything else (spaces,
 * punctuation, the edges of the text) is a boundary. Keys may themselves
 * carry spaces or apostrophes ("the old mill", "Mara's ring"). */
function keyRegex(key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?:^|[^\\p{L}\\p{N}])' + escaped + '(?=$|[^\\p{L}\\p{N}])', 'iu');
}

/* M9: the detailed answer — which entries woke and what they said.
 * `recent` is a string (scanned whole) or an array of page texts, newest
 * last; each entry then scans only its own last `depth` pages. Constant
 * entries always ride, budget first, in shelf order. Keyed entries are
 * scored by how many DISTINCT keys hit, strongest first (ties keep shelf
 * order); selective entries (secondaryKeys) need a primary AND a secondary
 * key. A single entry longer than the budget is trimmed to fit; an entry
 * that no longer fits stays on the shelf this turn. */
export function matchLoreDetailed(entries, recent, budgetChars = 1200) {
  const budget = Number.isFinite(budgetChars) && budgetChars > 0 ? budgetChars : 1200;
  const none = { text: '', fired: [] };
  if (!Array.isArray(entries) || !entries.length) return none;

  /* Normalize `recent` into an array of page texts, newest last. */
  const pages = Array.isArray(recent)
    ? recent.map((p) => String(p == null ? '' : p))
    : [String(recent || '')];

  const constants = [];
  const hits = [];
  entries.forEach((entry, index) => {
    if (!entry || entry.enabled === false) return;
    const content = typeof entry.content === 'string' ? entry.content.trim() : '';
    if (!content) return;
    const meta = () => ({
      id: entry.id,
      name: typeof entry.name === 'string' ? entry.name : '',
      keys: Array.isArray(entry.keys) ? entry.keys.slice() : [],
      constant: true,
    });
    if (entry.constant === true) {
      constants.push({ content, index, entry, fired: meta() });
      return;
    }
    const depth = Number.isFinite(entry.depth) && entry.depth > 0 ? Math.floor(entry.depth) : 2;
    const scanned = pages.slice(-depth).join('\n');
    if (!scanned.trim()) return;
    const keys = Array.isArray(entry.keys) ? entry.keys : [];
    const secondaries = Array.isArray(entry.secondaryKeys) ? entry.secondaryKeys : [];
    const heard = new Set();
    for (const raw of keys) {
      const key = String(raw == null ? '' : raw).trim();
      if (!key) continue;
      const folded = key.toLowerCase();
      if (heard.has(folded)) continue;
      if (keyRegex(key).test(scanned)) heard.add(folded);
    }
    if (!heard.size) return;
    if (secondaries.length) {
      /* ST selective AND-mode: a secondary key must also be spoken. */
      const secondaryHeard = secondaries.some((raw) => {
        const key = String(raw == null ? '' : raw).trim();
        return key && keyRegex(key).test(scanned);
      });
      if (!secondaryHeard) return;
    }
    hits.push({
      content,
      score: heard.size,
      index,
      entry,
      fired: { ...meta(), constant: false, heard: [...heard] },
    });
  });

  hits.sort((a, b) => (b.score - a.score) || (a.index - b.index));

  /* Constant entries take the budget first, in shelf order; the keyed hits
   * ride in the room that's left. */
  let out = '';
  const fired = [];
  const admit = (hit) => {
    let content = hit.content;
    if (!out && content.length > budget) {
      content = content.slice(0, budget - 1).trimEnd() + '…';
    }
    const candidate = out ? out + '\n\n' + content : content;
    if (candidate.length > budget) return false;
    out = candidate;
    fired.push(hit.fired);
    return true;
  };
  for (const hit of constants) admit(hit);
  for (const hit of hits) admit(hit);
  return { text: out, fired };
}

/* The M7 contract, kept: just the joined text. */
export function matchLore(entries, recent, budgetChars = 1200) {
  return matchLoreDetailed(entries, recent, budgetChars).text;
}
