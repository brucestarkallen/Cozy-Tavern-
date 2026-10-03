/* Cozy Tavern — harness law of M568: the automatic brief's world, read back through its kind — a part that is not text (an
 * older build, a damaged row) is left out of what the storyteller reads and out of the wiki check, never "[object Object]". */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { groundWords } from '../../js/agents/worldground.js';
import { worldClaims, worldWithout } from '../../js/agents/canoncheck.js';

test('M568 A WORLD PART OF THE WRONG KIND IS LEFT OUT — the brief the storyteller reads says what is whole; the wiki check reads only text and leaves the rest as it lay', () => {
  const parts = { world: 'Soul Society after the war.', factions: { x: 1 }, places: 42, standing: 'The Gotei 13 rebuilds. The Quincy are scattered.' };
  const words = groundWords({ parts });
  assert(/Soul Society after the war\./.test(words) && /The Gotei 13 rebuilds\./.test(words) && !/object|42/.test(words), words);
  const claims = worldClaims(parts);
  eq(claims.map((c) => c.part).join(','), 'world,standing,standing', 'only text is checked');
  const kept = worldWithout(parts, claims, [2]);
  eq(kept.standing, 'The Gotei 13 rebuilds.', 'the wrong sentence goes');
  eq(JSON.stringify(kept.factions), '{"x":1}', 'what was not text is left as it lay');
});
