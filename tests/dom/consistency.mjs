/* M107: the store held against itself — every book the house keeps must agree
 * with every other. Run after the random walk, the ripple, and the ninety
 * turns. Returns a list of problems; an empty list is the invariant. */
import { PLACEHOLDER_NAMES } from '../../js/engine/apply.js';
import { sameFact } from '../../js/engine/world.js';

export async function checkStoreConsistency(db, storyId) {
  const problems = [];
  const messages = (await db.messages.list(storyId)) || [];
  const visible = messages.filter((m) => m && !m.hidden);
  const assistants = visible.filter((m) => m.role === 'assistant');
  const state = await db.settings.get('state:' + storyId);
  if (!state) return ['no ledger for the story'];
  const lower = (s) => String(s || '').trim().toLowerCase();
  /* the page stamp */
  if (Number.isInteger(state.page) && state.page > assistants.length) problems.push('the ledger’s page (' + state.page + ') runs past the story’s pages (' + assistants.length + ')');
  /* nobody both present and seated elsewhere */
  const present = new Set((state.present || []).map((p) => lower(p && p.name)));
  for (const k of Object.keys(state.offscreen || {})) if (present.has(lower(k))) problems.push(k + ' is both present and seated elsewhere');
  /* no placeholder anywhere */
  const namesEverywhere = [
    ...(state.present || []).map((p) => p && p.name), ...Object.keys(state.offscreen || {}), ...Object.keys(state.characters || {}),
    ...Object.keys(state.relationships || {}), ...Object.keys(state.knowledge || {}), ...Object.keys(state.canon || {}),
    ...(state.threads || []).map((t) => t && t.owner),
  ];
  for (const n of namesEverywhere) if (PLACEHOLDER_NAMES.includes(lower(n))) problems.push('a placeholder in the ledger: ' + n);
  /* no fact twice */
  for (const [name, list] of Object.entries(state.knowledge || {})) {
    if (!Array.isArray(list)) continue;
    for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) if (sameFact(list[i].fact, list[j].fact)) problems.push('a fact twice for ' + name + ': ' + list[i].fact);
  }
  /* a retired page has no seat, no presence */
  for (const [name, c] of Object.entries(state.characters || {})) {
    if (!c || !c.retired) continue;
    if (present.has(lower(name))) problems.push(name + ' is retired yet present');
    if (Object.keys(state.offscreen || {}).some((k) => lower(k) === lower(name))) problems.push(name + ' is retired yet seated');
  }
  /* the journal never runs ahead of the page */
  for (const e of (state.journal || [])) if (Number.isInteger(e.p) && Number.isInteger(state.page) && e.p > state.page) { problems.push('a journal entry at page ' + e.p + ' past the ledger’s page ' + state.page); break; }
  /* the record covers only pages that stand */
  const mem = await db.settings.get('memory:' + storyId);
  for (const n of ((mem && mem.nodes) || [])) {
    if (!n || n.correction) continue;
    if (Array.isArray(n.span) && n.span[1] >= visible.length) problems.push('a record line folds pages past the story’s end: ' + JSON.stringify(n.span) + ' of ' + visible.length);
  }
  /* every checkpoint keys a message that stands */
  const ids = new Set(messages.map((m) => m.id));
  const versions = (await db.settings.get('versionState:' + storyId)) || {};
  for (const key of Object.keys(versions)) if (!ids.has(key.split(':')[0])) problems.push('a version checkpoint for a page that is gone: ' + key);
  const snaps = (await db.settings.get('snapshots:' + storyId)) || [];
  for (const e of snaps) if (e && e.id && !ids.has(e.id)) problems.push('a boundary snapshot for a message that is gone: ' + e.id);
  /* a mended page keeps its earlier words */
  for (const m of visible) if (m.mended && !(m.mended.before && typeof m.mended.before === 'string')) problems.push('a mend without its earlier words on page ' + m.id);
  return problems;
}
