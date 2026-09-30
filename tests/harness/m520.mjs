/* Cozy Tavern — harness laws of M520: who knows what, unscrambled (his report: "the auditor ran — found 1 thing, set 27
 * right: the ledger's knowledge lines for the hero, priestess, paladin, assassin and mage are scrambled — each holds facts
 * that belong to another… can this be prevented before the auditor saw it?"). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { broadcastPublicMoments } from '../../js/agents/extractor.js';
import { publicMoment } from '../../js/engine/world.js';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const party = ['the priestess', 'the paladin', 'the assassin', 'the mage'];
const chapel = () => applyMutations({ ...emptyState(), page: 30 }, [{ type: 'mc.set', name: 'the hero' }, { type: 'place.set', name: 'the ruined chapel' }, { type: 'presence.enter', name: 'the hero' }, ...party.map((n) => ({ type: 'presence.enter', name: n }))]).state;
const LINES = [
  { type: 'knowledge.add', name: 'the priestess', fact: 'saw the paladin hesitate at the chapel gate' },
  { type: 'knowledge.add', name: 'the mage', fact: 'watched the assassin slip a vial into the paladin\'s cup when no one was looking' },
  { type: 'knowledge.add', name: 'the assassin', fact: 'saw the mage\'s hand glow when she touched the seal' },
  { type: 'knowledge.add', name: 'the paladin', fact: 'heard the priestess pray aloud for the dead before the whole company' },
  { type: 'knowledge.add', name: 'the priestess', fact: 'saw the altar crack down the middle' },
];
const holders = (out, re) => out.filter((m) => m.type === 'knowledge.add' && re.test(m.fact)).map((m) => m.name).sort().join(', ');

test('M520-1 A MOMENT THE ROOM SAW GOES TO THE ROOM — never into the book of the one it is about (they know what they did), never the main character\'s; a hidden act stays with the one who caught it', () => {
  const out = broadcastPublicMoments(chapel(), LINES, null);
  eq(holders(out, /altar crack/), 'the assassin, the mage, the paladin, the priestess', 'a moment the whole room saw: every book in the room');
  eq(holders(out, /paladin hesitate/), 'the assassin, the mage, the priestess', 'not the paladin — it is about him');
  eq(holders(out, /hand glow/), 'the assassin, the paladin, the priestess', 'not the mage');
  eq(holders(out, /pray aloud/), 'the assassin, the mage, the paladin', 'not the priestess — she said it');
  eq(holders(out, /slip a vial/), 'the mage', 'the poisoning stays with the one who caught it — not the paladin who drank it, not the room');
  assert(!out.some((m) => m.type === 'knowledge.add' && m.name === 'the hero'), 'never the main character');
  eq(out.filter((m) => m.type === 'knowledge.add').length, 14, 'fourteen lines where twenty were written (m519): six that the auditor would have to take back are never written');
  /* M522: named is not the one who did it — the demon prince's offer to them all is every listener's, the paladin's too */
  const offer = broadcastPublicMoments(chapel(), [{ type: 'knowledge.add', name: 'the mage', fact: 'heard the demon prince offer all of them — even the paladin — a place at his side, aloud before the whole company' }], null);
  eq(holders(offer, /demon prince offer/), 'the assassin, the mage, the paladin, the priestess', 'every listener, the paladin named among them');
});

test('M520-2 WHAT IS A HIDDEN ACT: done secretly, slipped, palmed, pocketed, hidden, unnoticed, when no one was looking, behind someone\'s back — not a whisper seen (the room saw him lean in), not a plain act', () => {
  for (const hidden of ['watched her slip the letter into her sleeve', 'saw him palm the key', 'saw the thief pocket the ring unnoticed', 'watched the steward hide the ledger behind the tapestry', 'saw the mage secretly sign to the assassin', 'saw him draw the knife behind her back', 'watched the guard take a coin when no one was looking']) eq(publicMoment(hidden), false, hidden);
  for (const open of ['watched Jovan bow and whisper to Rukia', 'saw the altar crack down the middle', 'saw the paladin draw his sword', 'watched the dragon land in the square']) eq(publicMoment(open), true, open);
});
