/* M405: everyone's "now" belongs to the ground it was written on — a move lets it go, and a now of a ground the scene has
 * left heals on the next change; a nickname in brackets finds its page. Runs the real engine. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { applyMutations, undoEntry, staleNows } from '../../js/engine/apply.js';
import { emptyState } from '../../js/engine/state.js';
import { findPersonKey } from '../../js/engine/people.js';

const base = () => {
  let st = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Jovan Oda' }, { type: 'place.set', name: '1st Division HQ — outside the assembly hall' },
    { type: 'presence.enter', name: 'Jovan Oda' }, { type: 'presence.enter', name: 'Shunsui Kyōraku' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }]).state;
  st.characters = { 'Shunsui Kyōraku': { core: 'Captain-Commander.', state: 'Inside the assembly hall at 1st Division HQ, the announcement pending.', threads: [] },
    'Rukia Kuchiki': { core: 'His lieutenant.', state: 'by the doors, watching him', threads: [], hand: { state: true } } };
  return st;
};

test('M405-1 A MOVE, THEN THE READERS’ CHAIN: every present person whose now names the ground the scene just left is named and let go (journaled, undoable) — never one his hand wrote', () => {
  let st = applyMutations(base(), [{ type: 'place.set', name: '10th Division HQ — training courtyard' }]).state;
  eq(staleNows(st).join(), 'Shunsui Kyōraku', 'the assembly-hall now is named; her own words are not');
  st = applyMutations(st, staleNows(st).map((name) => ({ type: 'people.set', name, field: 'state', text: '', clear: true }))).state;
  assert(!st.characters['Shunsui Kyōraku'].state, 'the assembly-hall now does not follow him into the courtyard');
  eq(st.characters['Rukia Kuchiki'].state, 'by the doors, watching him', 'his own words stay');
  const back = undoEntry(st, st.log.length - 1);
  eq(back.state.characters['Shunsui Kyōraku'].state, 'Inside the assembly hall at 1st Division HQ, the announcement pending.', 'taken back, it returns');
});

test('M405-2 A LEDGER ALREADY HOLDING A NOW OF A GROUND THE SCENE LEFT IS NAMED, AND LET GO AS A JOURNALED CHANGE (what the readers’ chain does) — a now of the ground it stands on stays', () => {
  let st = base();
  /* the move happened before this law: the old now is still there */
  st.journal = [...st.journal, { id: 99, p: 5, m: { type: 'place.set', name: '10th Division HQ — training courtyard' } }];
  st.place = { name: '10th Division HQ — training courtyard' };
  st.characters['Rukia Kuchiki'] = { ...st.characters['Rukia Kuchiki'], hand: {}, state: 'at the 10th Division HQ rail, arms folded' };
  eq(staleNows(st).join(), 'Shunsui Kyōraku', 'named: only his');
  const r = applyMutations(st, staleNows(st).map((name) => ({ type: 'people.set', name, field: 'state', text: '', clear: true })));
  eq(r.applied.length, 1, 'let go, journaled');
  st = r.state;
  assert(!st.characters['Shunsui Kyōraku'].state, 'his stale now is gone');
  eq(st.characters['Rukia Kuchiki'].state, 'at the 10th Division HQ rail, arms folded', 'a now of this ground stays');
  eq(staleNows(st).length, 0, 'and nothing is named again');
});

test('M405-3 A NICKNAME IN BRACKETS FINDS ITS PAGE: "Rose" is "Rōjūrō Otoribashi (Rose)" — never a second, empty page', () => {
  const chars = { 'Rōjūrō Otoribashi (Rose)': { core: 'Captain of the 3rd.' } };
  eq(findPersonKey(chars, 'Rose'), 'Rōjūrō Otoribashi (Rose)', 'found');
  const st = applyMutations({ ...emptyState(), page: 1, characters: chars }, [{ type: 'people.set', name: 'Rose', field: 'state', text: 'on the shaded arc' }]).state;
  eq(Object.keys(st.characters).join(), 'Rōjūrō Otoribashi (Rose)', 'one page');
  eq(st.characters['Rōjūrō Otoribashi (Rose)'].state, 'on the shaded arc', 'written where he is kept');
});

test('M406-1 ONE PERSON, TWO PAGES, JOINED: the empty "Rose" page folds into "Rōjūrō Otoribashi (Rose)" — his presence follows, nothing is lost, it can be taken back; two Kuchikis and two Vanessas are never joined', async () => {
  const { duplicatePages } = await import('../../js/engine/apply.js');
  let st = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Jovan Oda' }, { type: 'presence.enter', name: 'Rose' }]).state;
  st.characters = { ...st.characters, 'Rose': { core: '', state: 'on the shaded arc', threads: [] }, 'Rōjūrō Otoribashi (Rose)': { core: 'Captain of the 3rd.', state: '', threads: [] },
    'Rukia Kuchiki': { core: 'y', threads: [] }, 'Byakuya Kuchiki': { core: 'z', threads: [] }, 'Vanessa Reynolds': { threads: [] }, 'Vanessa Cole': { threads: [] } };
  const joins = duplicatePages(st);
  eq(JSON.stringify(joins), JSON.stringify([{ from: 'Rose', to: 'Rōjūrō Otoribashi (Rose)' }]), 'only Rose, onto his full page');
  const r = applyMutations(st, joins.map((j) => ({ type: 'people.rename', from: j.from, to: j.to })));
  eq(r.applied.length, 1, 'joined');
  st = r.state;
  assert(!st.characters['Rose'], 'the empty page is gone');
  eq(st.characters['Rōjūrō Otoribashi (Rose)'].core, 'Captain of the 3rd.', 'his description stays');
  assert(st.present.some((p) => p.name === 'Rōjūrō Otoribashi (Rose)'), 'he is here under his one page');
  const back = undoEntry(st, st.log.length - 1);
  assert(back.state.characters['Rose'], 'taken back, it is as it was');
});

test('M408-1 EVERYONE HERE HAS A NOW: the scribe is told who in the scene has none; the storyteller’s card is never blank — "here, by the rail" until a reader writes more', async () => {
  const { buildScribeMessages } = await import('../../js/agents/scribe.js');
  const { renderPeopleTiers } = await import('../../js/engine/people.js');
  let st = applyMutations({ ...emptyState(), page: 2 }, [{ type: 'mc.set', name: 'Jovan Oda' }, { type: 'presence.enter', name: 'Jovan Oda' }, { type: 'presence.enter', name: 'Shunsui Kyōraku', position: 'by the rail' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }]).state;
  st.characters = { 'Shunsui Kyōraku': { core: 'Captain-Commander.', threads: [] }, 'Rukia Kuchiki': { core: 'His lieutenant.', state: 'arms folded at the gate', threads: [] } };
  const msg = buildScribeMessages({ state: st, userText: 'I step in.', assistantText: 'Kyōraku tips his hat.' });
  assert(/IN THE SCENE WITH NO NOW YET[^\n]*Shunsui Kyōraku/.test(msg.user) && !/NO NOW YET[^\n]*Rukia/.test(msg.user), 'the scribe is told: Kyōraku, not Rukia');
  const told = renderPeopleTiers(st, { recentPages: ['Kyōraku tips his hat.'] });
  const text = typeof told === 'string' ? told : String(told.text || '');
  assert(/Shunsui Kyōraku — Captain-Commander\.\nNow: here — by the rail\./.test(text), 'his card says what the scene knows: ' + text.slice(0, 300));
});
