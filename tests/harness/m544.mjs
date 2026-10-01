/* Cozy Tavern — harness laws of M544: the audit for the same fault in its other doors (his word: "audit everything — do I need to
 * keep telling the same thing?"). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { voicesBeyondTheRoom } from '../../js/engine/world.js';
import { renderPeopleTiers } from '../../js/engine/people.js';

const room = () => applyMutations({ ...emptyState(), page: 20 }, [{ type: 'mc.set', name: 'Jovan Wells' }, { type: 'place.set', name: "8 Mariner's Lane — upstairs hall" }, { type: 'presence.enter', name: 'Jovan Wells' }, { type: 'presence.enter', name: 'Rias Wells', position: 'leaning on the jamb of her room' }]).state;

test('M544-1 THE VOICES ARE PEOPLE HE CANNOT HEAR: a voice from Rias, standing in the hall with him, or from Jovan himself, is not kept under the page; Vanessa in her kitchen is', () => {
  const st = room();
  const kept = voicesBeyondTheRoom([
    { icon: '💬', speaker: 'Rias Wells', channel: 'the hall', content: 'Talk.' },
    { icon: '💬', speaker: 'Jovan Wells', channel: 'group chat', content: 'back home' },
    { icon: '📱', speaker: 'Vanessa Reynolds', channel: 'group chat · now', content: 'single as wrinkled potatoes' },
  ], st).map((v) => v.speaker);
  eq(kept.join(', '), 'Vanessa Reynolds', 'only the voice from beyond the room');
});

test('M544-2 A NOTE FROM BEFORE THEY CAME IN IS NOT THEIR NOW: Claire\'s page says "at the corner of Mariner\'s Lane and Larkspur" (written page 18, while she was away); she walks back in on page 20 — her card says she is here, not at the corner; a note written after she came in is her now', () => {
  let st = room();
  st = { ...st, characters: { ...st.characters, 'Claire Stone': { core: "Aurora's best friend", state: "at the corner of Mariner's Lane and Larkspur, phone out", updatedAtTurn: 19 } } };
  st = applyMutations({ ...st, page: 20 }, [{ type: 'presence.enter', name: 'Claire Stone', position: 'at the top of the stairs' }]).state;
  st = { ...st, page: 20 };
  const text = (renderPeopleTiers(st, {}) || {}).text || '';
  const card = text.split('\n\n').find((c) => c.startsWith('Claire Stone')) || '';
  assert(!/corner of Mariner/.test(card), 'the note from before she came in is not her now: ' + card);
  assert(/Now: here — at the top of the stairs/.test(card), 'she is here, where the ledger has her: ' + card);
  const later = { ...st, characters: { ...st.characters, 'Claire Stone': { ...st.characters['Claire Stone'], state: 'arms crossed at the top of the stairs, waiting for Rias to finish', updatedAtTurn: 21 } }, page: 20 };
  const card2 = (((renderPeopleTiers(later, {}) || {}).text || '').split('\n\n').find((c) => c.startsWith('Claire Stone')) || '');
  assert(/Now: arms crossed at the top of the stairs/.test(card2), 'a note written after she came in is her now: ' + card2);
});

import { auditorScope } from '../../js/agents/auditor.js';

test('M544-3 A PLACE IN THE ROOM THE PAGE LEFT BEHIND IS LET GO: the auditor reports Jovan still "in the kitchen with the cordless taken out of his hand" while the newest page has him at Rias\'s door — the old place goes (no new one is written by the auditor); when the newest page still has him in the kitchen, nothing changes', () => {
  let st = applyMutations({ ...emptyState(), page: 20 }, [{ type: 'mc.set', name: 'Jovan Wells' }, { type: 'place.set', name: "8 Mariner's Lane" }, { type: 'presence.enter', name: 'Jovan Wells', position: 'in the kitchen with the cordless taken out of his hand' }, { type: 'presence.enter', name: 'Rias Wells' }]).state;
  const upstairs = "[8 Mariner's Lane — Thu, Aug 20, 2026 | 18:40 | dusk | white tee | at Rias's door]\n\nHe took the stairs two at a time and stopped at Rias's door. She leaned on the jamb, arms folded.";
  const issue = { what: "the ledger's Here now still describes Jovan Wells in the kitchen", mutations: [{ type: 'presence.update', name: 'Jovan Wells', position: "in the upstairs hall at the door of Rias's room" }] };
  const kept = auditorScope([issue], st, { header: [], page: upstairs }).flatMap((i) => i.mutations);
  eq(JSON.stringify(kept.map((m) => [m.type, m.name, m.position])), JSON.stringify([['presence.update', 'Jovan Wells', '']]), 'the kitchen is let go; no new place from the auditor');
  const after = applyMutations(st, kept).state;
  eq((after.present.find((p) => p.name === 'Jovan Wells') || {}).position, undefined, 'the ledger no longer has him in the kitchen');
  const stillKitchen = "[8 Mariner's Lane — Thu, Aug 20, 2026 | 18:40 | dusk | white tee | kitchen]\n\nIn the kitchen Rias took the cordless out of his hand.";
  eq(auditorScope([issue], st, { header: [], page: stillKitchen }).flatMap((i) => i.mutations).length, 0, 'a place the newest page still shows stands');
});
