/* Cozy Tavern — import/sillytavern.js
 * Bring your engine: read a SillyTavern preset and lay it out on Cozy
 * Tavern's shelves — the craft, the rulebook, seeds for the frame, and a
 * retired shelf for what the house and its engines now do themselves.
 *
 * Everything happens on this device. The file is read, sorted, and —
 * only when you say so — written into the local store. Nothing uploads.
 *
 * Contract (SPEC.md M5):
 *   parsePreset(jsonText)  -> {entries:[{name,identifier,content,enabled,
 *                              role,pos,depth}], warnings:[]}
 *                              (throws a kind Error on garbage/empty JSON)
 *   decompose(entries)     -> Plan
 *   applyPlan(plan, opts)  -> summary {craftWords, modulesAdded,
 *                              retiredCount, skippedCount}
 *
 * Plan = {
 *   craft:     [{name, text, include, guessed?}],
 *   modules:   [{name, text, whenKey, pinned, why, include, guessed?}],
 *   frameSeeds:[{name, text, guessed?}],   // copy-only, never auto-applied
 *   retired:   [{name, why}],
 *   skipped:   [{name, why}],
 * }
 *
 * `include` rides on each craft/module item so the preview's checkboxes can
 * leave things behind without rebuilding the plan. Retired and skipped
 * rows are words to read, not things to apply.
 */

import { listModules, saveModule } from '../assemble/modules.js';
import { classify } from './v176map.js';

/* The entry's name, tidied for human shelves: emoji and decorations off,
 * ordinary punctuation kept, whitespace calmed. */
export function displayName(name) {
  const cleaned = String(name || '')
    .replace(/[^\p{L}\p{N}\s()\-–—’'&.,:;/#]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'An unnamed block';
}

/* ---------- parse ---------- */

export function parsePreset(jsonText) {
  const warnings = [];
  let raw;
  try {
    raw = JSON.parse(String(jsonText || ''));
  } catch (err) {
    throw new Error('That file wouldn’t open — it doesn’t read like JSON. Is it a preset export?');
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.prompts)) {
    throw new Error('That file doesn’t read like a SillyTavern preset — no list of instructions inside.');
  }
  if (raw.prompts.length === 0) {
    throw new Error('That preset is an empty shelf — there’s nothing in it to bring over.');
  }

  /* In SillyTavern the on/off switches live apart from the prompts, in
   * prompt_order; we marry them back together by identifier. */
  const enabledByIdentifier = new Map();
  const orderBlocks = Array.isArray(raw.prompt_order) ? raw.prompt_order : [];
  for (const block of orderBlocks) {
    const list = block && Array.isArray(block.order) ? block.order : [];
    for (const row of list) {
      if (row && row.identifier != null && !enabledByIdentifier.has(row.identifier)) {
        enabledByIdentifier.set(String(row.identifier), row.enabled !== false);
      }
    }
  }
  if (!enabledByIdentifier.size) {
    warnings.push('The file didn’t say which blocks were switched on, so everything was read as on.');
  }

  const entries = [];
  let unnamed = 0;
  for (const row of raw.prompts) {
    if (!row || typeof row !== 'object') continue;
    const name = typeof row.name === 'string' && row.name.trim() ? row.name : '';
    if (!name) unnamed += 1;
    const identifier = row.identifier != null ? String(row.identifier) : '';
    entries.push({
      name: name || identifier || 'An unnamed block',
      identifier,
      content: typeof row.content === 'string' ? row.content : '',
      enabled: enabledByIdentifier.has(identifier) ? enabledByIdentifier.get(identifier) : true,
      role: typeof row.role === 'string' ? row.role : null,
      pos: typeof row.injection_position === 'number' ? row.injection_position : null,
      depth: typeof row.injection_depth === 'number' ? row.injection_depth : null,
    });
  }
  if (unnamed) warnings.push(`${unnamed} ${unnamed === 1 ? 'block had' : 'blocks had'} no name and answered to their identifiers instead.`);
  return { entries, warnings };
}

/* ---------- decompose ---------- */

export function decompose(entries) {
  const plan = { craft: [], modules: [], frameSeeds: [], retired: [], skipped: [] };
  for (const entry of Array.isArray(entries) ? entries : []) {
    const verdict = classify(entry);
    const name = displayName(entry.name);
    const text = String(entry.content || '').trim();
    switch (verdict.bucket) {
      case 'craft':
        plan.craft.push({ name, text, include: true, guessed: Boolean(verdict.guessed) });
        break;
      case 'modules':
        plan.modules.push({
          name, text,
          whenKey: verdict.whenKey || 'manual',
          pinned: false,
          why: verdict.why || 'you choose when this walks in',
          include: true,
          guessed: Boolean(verdict.guessed),
        });
        break;
      case 'frameSeeds':
        plan.frameSeeds.push({ name, text, guessed: Boolean(verdict.guessed) });
        break;
      case 'retired':
        plan.retired.push({ name, why: verdict.why || 'the house sees to it now' });
        break;
      default:
        plan.skipped.push({ name, why: verdict.why || 'left behind' });
    }
  }
  return plan;
}

/* ---------- apply ---------- */

const CRAFT_ID = 'core-craft';

/* A free seat for a name: identical text under this name (or under one of
 * its numbered suffixes) means it's already home — re-imports change
 * nothing. Same name with different words gets a numbered suffix, the way
 * a second copy of a book does. */
function roomFor(existing, item) {
  const wanted = item.name.trim().toLowerCase();
  const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const suffixed = new RegExp(`^${escaped} \\(\\d+\\)$`);
  const kin = existing.filter((m) => {
    const n = (m.name || '').trim().toLowerCase();
    return n === wanted || suffixed.test(n);
  });
  if (kin.some((m) => (m.text || '').trim() === item.text.trim())) return 'already-home';
  if (!kin.some((m) => (m.name || '').trim().toLowerCase() === wanted)) return item.name;
  for (let n = 2; ; n += 1) {
    const candidate = `${item.name} (${n})`;
    if (!existing.some((m) => (m.name || '').trim().toLowerCase() === candidate.toLowerCase())) {
      return candidate;
    }
  }
}

export async function applyPlan(plan, opts = {}) {
  const summary = {
    craftWords: 0,
    modulesAdded: 0,
    modulesAlreadyHome: 0,
    retiredCount: (plan.retired || []).length,
    skippedCount: (plan.skipped || []).length,
  };

  const existing = await listModules();

  /* The craft: included entries join in their original order into a single
   * user override of core-craft (a fork — the shipped original stays
   * restorable, per the rulebook's rules). */
  const craftItems = (plan.craft || []).filter((item) => item.include !== false && item.text);
  if (craftItems.length) {
    const joined = craftItems.map((item) => item.text).join('\n\n');
    const current = existing.find((m) => m.id === CRAFT_ID);
    await saveModule({
      id: CRAFT_ID,
      name: current ? current.name : undefined,
      text: joined,
      pinned: current ? current.pinned : false,
    });
    summary.craftWords = joined.split(/\s+/).filter(Boolean).length;
  }

  /* The rulebook: one user module each, names deduped with a suffix. */
  for (const item of plan.modules || []) {
    if (item.include === false || !item.text) continue;
    const seat = roomFor(existing, item);
    if (seat === 'already-home') {
      summary.modulesAlreadyHome += 1;
      continue;
    }
    const saved = await saveModule({
      name: seat,
      text: item.text,
      pinned: Boolean(item.pinned),
      whenKey: item.whenKey,
      note: item.whenKey === 'manual' ? 'you choose when this walks in' : '',
    });
    existing.push(saved);
    summary.modulesAdded += 1;
  }

  return summary;
}

/* What the UI says when the dust settles — plain words, no numbers-still-
 * spinning. */
export function summaryWords(summary) {
  const parts = [];
  if (summary.craftWords) {
    parts.push(`The craft now carries your words (about ${summary.craftWords.toLocaleString()} of them) — the shipped original is still underneath, restorable from the rulebook.`);
  }
  if (summary.modulesAdded) {
    parts.push(`${summary.modulesAdded} ${summary.modulesAdded === 1 ? 'rule' : 'rules'} joined the rulebook.`);
  }
  if (summary.modulesAlreadyHome) {
    parts.push(`${summary.modulesAlreadyHome} ${summary.modulesAlreadyHome === 1 ? 'was' : 'were'} already home, so nothing doubled up.`);
  }
  if (summary.retiredCount) {
    parts.push(`${summary.retiredCount} ${summary.retiredCount === 1 ? 'block rests' : 'blocks rest'} on the retired shelf — the house and its engines do that work now.`);
  }
  if (!parts.length) {
    return 'Nothing was brought over — everything was left behind, as you asked.';
  }
  return parts.join(' ');
}
