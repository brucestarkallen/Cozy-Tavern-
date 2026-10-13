/* Cozy Tavern — harness law of M559: a person's loose ends no longer forget (the M305 fault, in its third book). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { mergeDeltas, migrateCharacters, THREADS_MAX, renderPeopleTiers } from '../../js/engine/people.js';
import { emptyState } from '../../js/engine/state.js';

test('M559 A PERSON\'S LOOSE ENDS NO LONGER FORGET: the ninth does not push the first away (it did, at eight); since M713 nothing pushes the oldest away at all — past the old room of forty, and in a ledger loaded; the storyteller is shown the newest few and told the rest are kept', () => {
  let chars = {};
  const ends = Array.from({ length: 12 }, (_, i) => 'END-' + i + ': ' + ['owes Jovan a favour from the gate', 'hides the letter under the floorboard', 'wants the rematch before snow', 'fears the captain', 'is saving for the trip north', 'keeps the key to the archive', 'promised Rukia a sword', 'suspects the attendant', 'owes the inn three nights', 'is learning the second form', 'wrote to her brother', 'lost the bet at the river'][i]);
  for (let i = 0; i < ends.length; i += 1) chars = mergeDeltas({ turn: i }, chars, [{ name: 'Kaelen', field: 'thread', text: ends[i] }], i).characters;
  eq(chars.Kaelen.threads.length, 12, 'twelve kept');
  assert(chars.Kaelen.threads[0].startsWith('END-0'), 'the first — owed from page 10 — still stands');
  /* M713 (people.js): "the durable ledger must not discard an open obligation merely because the next one was recorded
   * (including on reload)" — the room of forty was a cap that let the oldest go; it is no cap now. The old room, passed: */
  eq(THREADS_MAX, Infinity, 'no number of loose ends lets one go');
  const OLD_ROOM = 40;
  const many = Array.from({ length: OLD_ROOM + 5 }, (_, i) => 'thread number ' + i + ' about something different ' + 'xyz'.repeat(i % 7));
  const loaded = migrateCharacters({ Kaelen: { core: 'x', threads: many } });
  eq(loaded.Kaelen.threads.length, OLD_ROOM + 5, 'a ledger loaded keeps every one');
  eq(loaded.Kaelen.threads[0], many[0].trim(), 'the oldest stands');
  eq(loaded.Kaelen.threads[OLD_ROOM + 4], many[many.length - 1], 'and the newest');
  /* ends that mean different things (M134-1's words) — the same end in other words is one end, by sense, not by room */
  const W = ['amber', 'basalt', 'cobalt', 'dune', 'ember', 'fjord', 'garnet', 'harbor', 'iris', 'juniper', 'kestrel', 'lagoon', 'marble', 'nectar', 'onyx', 'pewter', 'quartz', 'raven', 'saffron', 'tundra', 'umber', 'velvet', 'willow', 'xenon', 'yarrow', 'zephyr', 'acorn', 'bramble', 'citrine', 'delta', 'eagle', 'falcon', 'glacier'];
  const V = ['polish', 'bury', 'sell', 'paint', 'find', 'mend', 'carry', 'hide', 'trade', 'sharpen', 'burn', 'plant', 'seal', 'borrow', 'weigh', 'count', 'return', 'forge', 'study', 'guard', 'ferry', 'chart', 'brew', 'gather', 'sketch', 'buckle', 'tether', 'harvest', 'gild', 'trace', 'smuggle', 'cradle', 'salt'];
  for (let i = 12; i < OLD_ROOM + 5; i += 1) chars = mergeDeltas({ turn: i }, chars, [{ name: 'Kaelen', field: 'thread', text: V[i - 12] + 's the ' + W[i - 12] }], i).characters;
  eq(chars.Kaelen.threads.length, OLD_ROOM + 5, 'written one by one past forty, none is pushed away');
  assert(chars.Kaelen.threads[0].startsWith('END-0'), 'the first still stands');
  /* what grows is the record, never the view: her card tells three and counts the rest */
  const st = { ...emptyState(), turn: 50, present: [{ name: 'Kaelen' }], characters: { Kaelen: { ...chars.Kaelen, core: 'a swordswoman', updatedAtTurn: 50 } } };
  const line = renderPeopleTiers(st, { recentPages: [], brief: '' }).text.split('\n').find((l) => l.startsWith('Loose ends:')) || '';
  eq(line.replace(/ \(and \d+ more in their record\)$/, '').split('; ').length, 3, 'three on her card: ' + line);
  assert(new RegExp('\\(and ' + (OLD_ROOM + 2) + ' more in their record\\)$').test(line), 'and the rest are counted: ' + line);
});
