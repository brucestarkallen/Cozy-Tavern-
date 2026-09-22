/* M399: each story has its own canon switch — off unless switched on for that story; the old single switch moves
 * once to the stories it was really used in; a tale's switch rides its book, goes with it, and a branch keeps it. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { canonOn, setCanonOn, canonMetaKey, carryCanonMemory, _canonSwitchMigrationAgain } from '../../js/canon/bridge.js';

test('M399-1 EACH STORY HAS ITS OWN SWITCH: off until switched on for it; on in Bleach is on in Bleach alone', async () => {
  const a = await db.stories.create({ title: 'Bleach' });
  const b = await db.stories.create({ title: 'An original tale' });
  eq(await canonOn(a.id), false, 'off by default');
  await setCanonOn(a.id, true);
  eq(await canonOn(a.id), true, 'on for Bleach');
  eq(await canonOn(b.id), false, 'the other story stays off');
  await setCanonOn(a.id, false);
  eq(await canonOn(a.id), false, 'and off again');
  eq(await canonOn(''), false, 'no story, no switch');
});

test('M399-2 THE OLD ONE SWITCH MOVES ONCE: on where canon was really used (a wiki bound, someone found), off everywhere else, and then it is gone', async () => {
  const used = await db.stories.create({ title: 'Played with canon' });
  const bound = await db.stories.create({ title: 'A wiki bound' });
  const plain = await db.stories.create({ title: 'Never used it' });
  await db.settings.set(canonMetaKey(used.id), { canon_grounding_cache: { rukia: { name: 'Rukia Kuchiki', found: true } } });
  await db.settings.set(canonMetaKey(bound.id), { canon_grounding_wiki: 'bleach' });
  await db.settings.set(canonMetaKey(plain.id), { canon_grounding_cache: { jovan: { name: 'Jovan', found: false } } });
  await db.settings.set('canonOn', true);
  _canonSwitchMigrationAgain();
  eq(await canonOn(used.id), true, 'someone found there: on');
  eq(await canonOn(bound.id), true, 'a wiki bound there: on');
  eq(await canonOn(plain.id), false, 'only misses: off');
  eq(await db.settings.get('canonOn'), undefined, 'the one switch is gone');
});

test('M399-3 A STORY’S SWITCH IS THE STORY’S: it rides the tale’s book, never the house’s; it goes with the tale; a branch keeps it', async () => {
  const t = await db.stories.create({ title: 'Switched on' });
  await setCanonOn(t.id, true);
  await db.settings.set(canonMetaKey(t.id), { canon_grounding_wiki: 'bleach' });
  const book = JSON.parse(await db.exportStory(t.id)).settings.map((r) => r.key);
  assert(book.includes('canonOn:' + t.id), 'in the tale’s book');
  const house = JSON.parse(await db.exportHouse()).settings.map((r) => r.key);
  assert(!house.includes('canonOn:' + t.id), 'never in the house’s');
  const br = await db.stories.create({ title: 'Switched on — a branch' });
  await carryCanonMemory(t.id, br.id, { fromTheTail: true });
  eq(await canonOn(br.id), true, 'the branch keeps it');
  await db.settings.set('canonOn:a-tale-long-gone', true);
  await db.sweepOrphans();
  assert(!(await db.settings.keys()).includes('canonOn:a-tale-long-gone'), 'a gone tale’s switch is swept');
  await db.stories.remove(t.id);
  assert(!(await db.settings.keys()).includes('canonOn:' + t.id), 'and goes with the tale');
});
