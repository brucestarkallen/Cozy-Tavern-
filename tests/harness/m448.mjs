/* M448: what the series says is never a reason to mend his page. Canon's faces (source 'canon') are where his story
 * started; the second reader and the record's checker were shown them as locks that outrank a page, and both can mend
 * pages — a page that cut Rukia's hair would be written back to the wiki. Runs the real request builders and ledger. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { applyMutations } from '../../js/engine/apply.js';
import { emptyState, saveState } from '../../js/engine/state.js';
import { buildContinuityMessages } from '../../js/agents/continuity.js';
import { canonRecord } from '../../js/agents/memory.js';
import { db } from '../../js/store.js';

const ledger = () => applyMutations({ ...emptyState(), page: 4 }, [{ type: 'mc.set', name: 'Jovan Oda' },
  ...['Jovan Oda', 'Rukia Kuchiki'].map((n) => ({ type: 'presence.enter', name: n })),
  { type: 'canon.lock', name: 'Rukia Kuchiki', key: 'hair', value: 'black, chin-length, a strand between the eyes', source: 'canon' },
  { type: 'canon.lock', name: 'Rukia Kuchiki', key: 'age', value: 'seems about twenty' }]).state;
const PAGE = 'Rukia ran a hand through her hair, cropped short since the war.';

test('M448-1 THE SECOND READER IS SHOWN HIS TRUTHS, NEVER THE SERIES’ OWN — a page that changed canon’s face is never set against it', () => {
  const m = buildContinuityMessages({ state: ledger(), assistantText: PAGE });
  assert(!/chin-length/.test(m.user), 'the series’ face is not shown: ' + m.user.slice(0, 400));
  assert(/seems about twenty/.test(m.user), 'his own truth still binds');
});

test('M448-2 THE RECORD’S CHECKER, THE SAME — what outranks a page is the brief and his truths', async () => {
  const st = await db.stories.create({ title: 'The haircut' });
  await db.stories.update(st.id, { brief: 'Oda is the new captain of the 13th.' });
  await saveState(st.id, ledger());
  const r = await canonRecord(st.id, 'Oda took the 13th.');
  assert(!/chin-length/.test(r) && /seems about twenty/.test(r) && /new captain/.test(r), 'the brief and his truth, never the series’: ' + r.slice(0, 300));
});

test('M448-3 A FACE THE STORY CHANGED, RELOCKED, STANDS — the series cannot write its own over it', () => {
  let st = applyMutations(ledger(), [{ type: 'canon.lock', name: 'Rukia Kuchiki', key: 'hair', value: 'black, cropped short since the war' }]).state;
  const back = applyMutations(st, [{ type: 'canon.lock', name: 'Rukia Kuchiki', key: 'hair', value: 'black, chin-length, a strand between the eyes', source: 'canon' }]);
  eq(back.applied.length, 0, 'the series does not write over the story’s');
  const fact = back.state.canon['Rukia Kuchiki'].facts.find((f) => f.key === 'hair');
  eq(fact.value, 'black, cropped short since the war', 'her hair is as the story made it');
});
