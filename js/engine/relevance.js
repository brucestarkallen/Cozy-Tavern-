/* One selection vocabulary for prompt views. Never edits stored records. */
import { nameOnPage, samePersonName } from './names.js';
import { mcName, mcAliases } from './duels.js';
import { onTheWay } from './world.js';

const STOP = new Set('this that with from have been would could should their there where which what when then your they them into just about only still some does doing said says were will'.split(' '));
const words = text => new Set(String(text || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)?.filter(w => !STOP.has(w)) || []);
export function relevanceScore(text, material) {
  const wanted = material instanceof Set ? material : words(material);
  let score = 0;
  for (const word of words(text)) if (wanted.has(word)) score++;
  return score;
}
export function selectRelevant(items, material, limit = 3, textOf = x => String(x || '')) {
  const wanted = words(material);
  return (items || []).map((item, index) => ({ item, index, score: relevanceScore(textOf(item), wanted) }))
    .sort((a, b) => b.score - a.score || b.index - a.index).slice(0, limit).map(row => row.item);
}
export function relevantPeople(state, material = '') {
  const present = (state?.present || []).map(p => typeof p === 'string' ? p : p?.name).filter(Boolean);
  const keys = [...new Set([...present, mcName(state), ...Object.keys(state?.characters || {}),
    ...Object.keys(state?.canon || {}), ...Object.keys(state?.offscreen || {}), ...Object.keys(state?.knowledge || {})])];
  const rows = [];
  for (const name of keys) {
    if (!name || name === 'the player') continue;
    const here = present.some(p => samePersonName(p, name));
    const aliases = state?.characters?.[name]?.aliases || [];
    const mentioned = nameOnPage(material, name) || aliases.some(a => nameOnPage(material, a));
    const player = name === mcName(state);
    const playerMention = player && mcAliases(state).some(a => nameOnPage(material, a));
    const coming = onTheWay(state?.offscreen?.[name], state?.clock?.minutes);
    if (here || mentioned || player || playerMention || coming) rows.push({name, priority:(mentioned ? 8 : 0) + (here ? 4 : 0) + (player ? 2 : 0) + (coming ? 1 : 0)});
  }
  return rows.sort((a,b) => b.priority - a.priority).map(r => r.name);
}
