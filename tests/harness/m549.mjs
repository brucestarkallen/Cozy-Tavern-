/* Cozy Tavern — harness laws of M549: the automatic brief holds titles and seats to the wiki, never the keeper's memory
 * (his tale: "after TYBW — why does the brief say Zaraki is the Captain-Commander?"); the choices keeper has its own model. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { groundAsk, groundUpdateAsk, GROUND_RULES } from '../../js/agents/worldground.js';
import { WORKER_ROWS, pickWorkerConnection } from '../../js/agents/assign.js';

const WIKI = ['Shunsui Kyōraku — the Captain-Commander of the Gotei 13 and captain of the 1st Division', 'Kenpachi Zaraki — the captain of the 11th Division of the Gotei 13'];

test('M549-1 THE WORLD KEEPER IS HANDED THE WIKI\'S OWN LINES FOR WHO HOLDS WHICH SEAT, AND TOLD ITS OWN MEMORY IS NOT MATERIAL — on the first build and on every later look; with no lines, nothing of them', () => {
  const first = groundAsk({ concept: 'Bleach, after the Thousand-Year Blood War — Jovan Oda joins the 13th', wiki: WIKI });
  assert(/WHAT THE SERIES’ WIKI SAYS OF THE PEOPLE IN THIS STORY/.test(first.user), 'the wiki\'s heading');
  for (const w of WIKI) assert(first.user.includes('- ' + w), 'it reads: ' + w);
  assert(/Your own memory of a canon is NOT material/.test(first.system) && /who leads a group, who is alive or dead: only as the material above says it/.test(first.system), 'titles and seats from the material only');
  const later = groundUpdateAsk({ ground: { parts: { factions: 'Zaraki leads the Gotei 13.' } }, wiki: WIKI });
  assert(later.user.includes('- ' + WIKI[0]) && /NOT material/.test(later.system), 'and on a later look, beside what the world says now');
  assert(!/WIKI SAYS/.test(groundAsk({ concept: 'an original story' }).user), 'no lines, no heading');
  assert(GROUND_RULES >= 2, 'a world written under the old rules is written again');
});

test('M549-2 THE CHOICES KEEPER HAS ITS OWN MODEL: it stands in the workers\' list, and the model chosen for it is the one it is asked with', () => {
  assert(WORKER_ROWS.some(([k, words]) => k === 'choices' && /choices keeper/i.test(words)), 'a row of its own in Settings → The workers');
  const connections = [{ id: 'house', model: 'deepseek' }, { id: 'mine', model: 'kimi' }];
  eq(pickWorkerConnection({ map: { choices: 'mine' }, legacy: 'house', connections }, 'choices').id, 'mine', 'its own pick');
  eq(pickWorkerConnection({ map: {}, legacy: 'house', connections }, 'choices').id, 'house', 'none picked: the workers\' own');
});
