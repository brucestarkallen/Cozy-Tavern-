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
 * Contract (SPEC.md M7):
 *   parseLorebook(jsonText)  -> [{id, keys:[], content, enabled}]
 *                               (throws kind, human Errors)
 *   saveLore(storyId, entries) / loadLore(storyId)
 *   matchLore(entries, recentText, budgetChars=1200) -> string ('' = none)
 *   recentText = the last user message + the last assistant message.
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
    entries.push({
      id: row.uid != null ? row.uid : (row.id != null ? row.id : i),
      keys,
      content: typeof row.content === 'string' ? row.content.trim() : '',
      /* ST's switch is `disable`; a few exports write `enabled` instead. */
      enabled: row.disable === true ? false : row.enabled !== false,
    });
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

/* ---------- retrieval: whole-word keys, deterministic ---------- */

/* A key "hits" only as a whole word — "ash" hears "the ash pit", never
 * "Ashford". Letters and numbers count as word; everything else (spaces,
 * punctuation, the edges of the text) is a boundary. Keys may themselves
 * carry spaces or apostrophes ("the old mill", "Mara's ring"). */
function keyRegex(key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?:^|[^\\p{L}\\p{N}])' + escaped + '(?=$|[^\\p{L}\\p{N}])', 'iu');
}

/* The entries whose keys were spoken, scored by how many DISTINCT keys hit,
 * strongest first (ties keep shelf order), joined under the budget. A
 * single entry longer than the whole budget is trimmed to fit; an entry
 * that no longer fits is simply left on the shelf this turn. '' when
 * nothing spoke. */
export function matchLore(entries, recentText, budgetChars = 1200) {
  const text = String(recentText || '');
  const budget = Number.isFinite(budgetChars) && budgetChars > 0 ? budgetChars : 1200;
  if (!text.trim() || !Array.isArray(entries) || !entries.length) return '';

  const hits = [];
  entries.forEach((entry, index) => {
    if (!entry || entry.enabled === false) return;
    const content = typeof entry.content === 'string' ? entry.content.trim() : '';
    if (!content) return;
    const keys = Array.isArray(entry.keys) ? entry.keys : [];
    const heard = new Set();
    for (const raw of keys) {
      const key = String(raw == null ? '' : raw).trim();
      if (!key) continue;
      const folded = key.toLowerCase();
      if (heard.has(folded)) continue;
      if (keyRegex(key).test(text)) heard.add(folded);
    }
    if (heard.size) hits.push({ content, score: heard.size, index });
  });

  hits.sort((a, b) => (b.score - a.score) || (a.index - b.index));

  let out = '';
  for (const hit of hits) {
    let content = hit.content;
    if (!out && content.length > budget) {
      content = content.slice(0, budget - 1).trimEnd() + '…';
    }
    const candidate = out ? out + '\n\n' + content : content;
    if (candidate.length > budget) break;
    out = candidate;
  }
  return out;
}
