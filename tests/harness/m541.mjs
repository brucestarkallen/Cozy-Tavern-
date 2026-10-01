/* Cozy Tavern — harness laws of M541: his Ravenwood evening (Claire gone yet "here"; Aurora "last seen 8 pages ago" the page
 * she left). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { lastSeenTurn, renderPeopleTiers } from '../../js/engine/people.js';

test('M541-1 LAST SEEN IS WHEN THEY WERE LAST IN THE SCENE: Aurora, whose page was last rewritten on page 9 but who stood in the room until page 16, was last seen on page 16 — not "8 pages ago"', () => {
  let st = applyMutations({ ...emptyState(), page: 8 }, [{ type: 'mc.set', name: 'Jovan Wells' }, { type: 'place.set', name: '8 Mariner\'s Lane — kitchen' }, { type: 'presence.enter', name: 'Jovan Wells' }, { type: 'presence.enter', name: 'Aurora Sterling' }]).state;
  st = { ...st, characters: { ...(st.characters || {}), 'Aurora Sterling': { core: 'his neighbour at number 10', state: 'at the counter, reading his message for the ninth time', updatedAtTurn: 9 } } }; /* her page, as the scribe left it on page 9 */
  for (let p = 9; p <= 15; p += 1) st = applyMutations({ ...st, page: p }, [{ type: 'presence.update', name: 'Jovan Wells', position: 'by the sink, page ' + p }]).state;
  st = applyMutations({ ...st, page: 16 }, [{ type: 'presence.leave', name: 'Aurora Sterling' }]).state;
  st = { ...st, page: 16 };
  const key = Object.keys(st.characters).find((k) => /Aurora/.test(k));
  eq(st.characters[key].updatedAtTurn, 9, 'fixture: her page was last rewritten on page 9 (turn 9)');
  eq(lastSeenTurn(st, key), 17, 'she was last in the scene on page 16 (turn 17)');
  const tiers = renderPeopleTiers(st, {});
  const text = typeof tiers === 'string' ? tiers : JSON.stringify(tiers);
  assert(!/Aurora Sterling[^\n]*last seen 8 turns ago/.test(text), 'the storyteller is not told she was last seen 8 turns ago');
});
