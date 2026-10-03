/* Cozy Tavern — harness law of M559: a person's loose ends no longer forget (the M305 fault, in its third book). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { mergeDeltas, migrateCharacters, THREADS_MAX } from '../../js/engine/people.js';

test('M559 A PERSON\'S LOOSE ENDS NO LONGER FORGET: the ninth does not push the first away (it did, at eight); only past the room of forty does the oldest go; a ledger loaded keeps the newest forty, never the oldest', () => {
  let chars = {};
  const ends = Array.from({ length: 12 }, (_, i) => 'END-' + i + ': ' + ['owes Jovan a favour from the gate', 'hides the letter under the floorboard', 'wants the rematch before snow', 'fears the captain', 'is saving for the trip north', 'keeps the key to the archive', 'promised Rukia a sword', 'suspects the attendant', 'owes the inn three nights', 'is learning the second form', 'wrote to her brother', 'lost the bet at the river'][i]);
  for (let i = 0; i < ends.length; i += 1) chars = mergeDeltas({ turn: i }, chars, [{ name: 'Kaelen', field: 'thread', text: ends[i] }], i).characters;
  eq(chars.Kaelen.threads.length, 12, 'twelve kept');
  assert(chars.Kaelen.threads[0].startsWith('END-0'), 'the first — owed from page 10 — still stands');
  assert(THREADS_MAX >= 40, 'the room is forty');
  const many = Array.from({ length: THREADS_MAX + 5 }, (_, i) => 'thread number ' + i + ' about something different ' + 'xyz'.repeat(i % 7));
  const loaded = migrateCharacters({ Kaelen: { core: 'x', threads: many } });
  eq(loaded.Kaelen.threads.length, THREADS_MAX);
  eq(loaded.Kaelen.threads[THREADS_MAX - 1], many[many.length - 1], 'the newest stand');
});
