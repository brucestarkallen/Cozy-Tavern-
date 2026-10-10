/* Cozy Tavern — harness laws of M680 (his: "Have you audited the whole ledger? The scene, who's here, mood of the scene, the
 * house has ruled, how they measure, the people, how they feel towards you, what's true of them, what canon says, the world
 * — what's happening elsewhere, the world beyond pages, voices elsewhere, even the books and the auditor and every agent …
 * I don't want to keep coming back to fix this"). The whole ledger, room by room: every law below was a fault reproduced on
 * m679-001 with the house's own code and the shapes it really writes, and asserts on what the ledger holds — or what the
 * storyteller is told — afterwards. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { emptyState, headerMutations, saveState, loadState } from '../../js/engine/state.js';
import { applyMutations, seatAtScene, staleNows } from '../../js/engine/apply.js';
import { db } from '../../js/store.js';
import { memoryAfterDeletion, memoryTruncatedAt } from '../../js/agents/memory.js';

const here = (st) => (st.present || []).map((p) => p.name).sort().join(', ');

test('M680-1 A STREET WITH ITS CITY IS THE SPOT (M679 writes "Cooper’s Row, Ilvarren"): the street was read as an address and set aside, so every seat in Ilvarren was "at the scene" — Old Hesk at his own tavern walked into Cooper’s Row, and a now on Gilder’s Row was never stale at the Bent Kettle. The street is what a seat must name now; a spot with its address still is not asked for the address', () => {
  eq(seatAtScene('the Bent Kettle, Ilvarren', 'Cooper’s Row, Ilvarren'), false, 'a tavern in the city is not on Cooper’s Row');
  eq(seatAtScene('the temple vestibule, Ilvarren', 'Cooper’s Row, Ilvarren'), false, 'nor the temple');
  eq(seatAtScene('Mark’s apartment, New York City', 'Fifth Avenue, New York City'), false, 'nor an apartment off Fifth Avenue');
  eq(seatAtScene('Cooper’s Row, Ilvarren', 'Cooper’s Row, Ilvarren'), true, 'the street itself is');
  eq(seatAtScene('at the no-sign door on Cooper’s Row', 'Cooper’s Row, Ilvarren'), true, 'and a door on it');
  eq(seatAtScene('Wells house kitchen', 'Wells house kitchen, 8 Mariner’s Lane'), true, 'a spot with its address: the address is still not asked for (M647)');
  const st = applyMutations({ ...emptyState(), page: 7 }, [
    { type: 'mc.set', name: 'Azrael' }, { type: 'place.set', name: 'Cooper’s Row, Ilvarren' },
    { type: 'presence.enter', name: 'Azrael' }, { type: 'presence.enter', name: 'Roska' },
  ]).state;
  const hesk = applyMutations(st, [{ type: 'offscreen.set', name: 'Old Hesk', location: 'the Bent Kettle, Ilvarren', activity: 'wiping down his barrel-top' }]).state;
  eq(here(hesk), 'Azrael, Roska', 'Old Hesk is seated at his tavern, not walked into the street');
  assert(hesk.offscreen['Old Hesk'], 'and he has his seat');
  let walk = applyMutations({ ...emptyState(), page: 5 }, [
    { type: 'mc.set', name: 'Azrael' }, { type: 'place.set', name: 'Gilder’s Row, Ilvarren' },
    { type: 'presence.enter', name: 'Azrael' }, { type: 'presence.enter', name: 'Roska' },
    { type: 'people.set', name: 'Roska', field: 'state', text: 'crouched behind the fruit-seller’s second stall, purse in her fist' },
  ]).state;
  walk = applyMutations({ ...walk, page: 6 }, [{ type: 'place.set', name: 'the Bent Kettle, Ilvarren' }]).state;
  eq(JSON.stringify(staleNows(walk, { ground: 'the Bent Kettle, Ilvarren' })), JSON.stringify(['Roska']), 'her now on Gilder’s Row is stale in the Bent Kettle');
});

/* his turn 21, the page that ends with Azrael gone down the side passage and Corven left at the hall */
const HALL21 = '[Kingsreach, the king’s hall — Thornday, October 16, 1247 | 19:40 | cold, clear | wool doublet | at the small council room door with the page]\n\n'
  + 'At the hall’s threshold Jugram swept the cloak off his shoulders and folded it over his forearm. Corven stood beside him, lamp up, waiting. Down the great table’s lower end Ser Holvard had one boot on a bench and a horn in his fist, complaining to anyone who would listen.\n\n'
  + 'A page came at a half-run and stopped short of them. “The king sups in the small council room tonight, m’lord. He asks for you before he sleeps.”\n\n'
  + '“I guess I should go, Captain Corven,” Jugram said, and asked the boy to walk him to the small council room.\n\n'
  + 'Corven let him go without another word about the cloak. The boy led Jugram down the side passage, past the kitchens’ heat, to the small council room’s door, where a grey steward took the cloak over his hand.';
async function turn21Read(storyId, { room = true } = {}) {
  let st = applyMutations({ ...emptyState(), page: 0, sheet: { actors: {}, playerName: 'Azrael Jugram' } }, [
    { type: 'mc.set', name: 'Azrael Jugram' }, { type: 'place.set', name: 'Kingsreach, the king’s hall' },
    { type: 'presence.enter', name: 'Azrael Jugram' }, { type: 'presence.enter', name: 'Corven', position: 'beside him, lamp up' },
    { type: 'people.set', name: 'Corven', field: 'core', text: 'captain of the king’s guard, a lamp and few words' },
    { type: 'offscreen.set', name: 'Ser Holvard', location: 'the lower end of the great table in the king’s hall', activity: 'drinking' },
  ]).state;
  st = applyMutations({ ...st, page: 1 }, [
    { type: 'presence.update', name: 'Azrael Jugram', position: 'at the small council room door with the page' },
    { type: 'presence.enter', name: 'the page', position: 'at the door beside him' },
    { type: 'presence.leave', name: 'Corven', shown: 'Corven let him go without another word about the cloak' },
  ]).state;
  await saveState(storyId, { ...st, readTo: 1, ...(room ? { roomAt: { page: 1, names: ['Azrael Jugram', 'the page'] } } : {}) });
}

test('M680-2 THE WORLD AGENT NO LONGER UNDOES THE PAGE’S READER (M679’s fault, through the door M679 left open — the world room’s audit): on his turn 21 the reader took Corven out; the world agent, running between the reader and the auditor, let his note go (a walk-in, M444) or seated him at the scene’s own ground (a walk-in, M402) — and Corven stood in the side passage again. Its walk-ins answer to the page’s ending and its reader now; someone the ending shows coming in still walks in', async () => {
  const { worldTurn } = await import('../../js/agents/world.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const world = (mutations) => thinkingHouse({ answer: JSON.stringify({ mutations, brief: { pressure: [], ripe: [], twb: null, voices: [] } }) });
  for (const [label, muts, room] of [
    ['its note let go', [{ type: 'offscreen.clear', name: 'Corven' }], true],
    ['a seat at the scene’s own ground', [{ type: 'offscreen.set', name: 'Corven', location: 'Kingsreach, the king’s hall', activity: 'keeping the hall' }], true],
    ['a seat at the scene’s own ground, no room named', [{ type: 'offscreen.set', name: 'Corven', location: 'Kingsreach, the king’s hall', activity: 'keeping the hall' }], false],
  ]) {
    const id = 'm680-world-' + label.replace(/\W+/g, '-');
    await turn21Read(id, { room });
    await withHouse(world(muts), () => worldTurn({ connection: HOUSES[0].conn, storyId: id, userText: 'I go in.', assistantText: HALL21, stale: () => false, pageAt: 1 }));
    const after = await loadState(id);
    eq(here(after), 'Azrael Jugram, the page', label + ': Corven is not walked back in');
    assert(after.offscreen.Corven, label + ': he keeps the seat the reader gave him');
  }
  /* the ending shows someone coming in, and no reader took them out: the world agent's seat at the scene walks them in */
  const id = 'm680-world-arrival';
  await turn21Read(id, { room: false });
  const arrival = HALL21 + '\n\nAt the door, Ser Brannick came in out of the passage and took his post beside the steward.';
  await withHouse(world([{ type: 'offscreen.set', name: 'Ser Brannick', location: 'Kingsreach, the king’s hall', activity: 'at his post' }]), () => worldTurn({ connection: HOUSES[0].conn, storyId: id, userText: 'I go in.', assistantText: arrival, stale: () => false, pageAt: 1 }));
  assert((await loadState(id)).present.some((p) => p.name === 'Ser Brannick'), 'someone the ending shows coming in walks in');
});

test('M680-3 THE DEAD ARE DEAD AT EVERY DOOR (the people and world audits): a death at the scene’s own place was a walk-in — Old Hesk, "dead — on the floor of the Bent Kettle taproom", stood in Here now and his seat (the one record of the death) was let go; a grave’s note let go walked him in too; the dead were told to the storyteller as close by, wounded and warm, asked of the reader as within earshot, marked for the world agent as due to be re-seated, and a seat for the living could be written over the grave', async () => {
  const { closeBy, renderStateFacts } = await import('../../js/engine/state.js');
  const { withinEarshotBlock } = await import('../../js/agents/extractor.js');
  const { voicesBeyondTheRoom } = await import('../../js/engine/world.js');
  let st = applyMutations({ ...emptyState(), page: 14 }, [
    { type: 'mc.set', name: 'Azrael' }, { type: 'place.set', name: 'the Bent Kettle, Ilvarren' },
    { type: 'presence.enter', name: 'Azrael' }, { type: 'presence.enter', name: 'Roska' }, { type: 'presence.enter', name: 'Old Hesk' },
    { type: 'people.set', name: 'Old Hesk', field: 'core', text: 'keeper of the Bent Kettle' },
    { type: 'rel.set', name: 'Old Hesk', p: 40, cause: 'he fed him for a winter' },
    { type: 'body.injure', name: 'Old Hesk', what: 'a crossbow bolt through the chest', sev: 3 },
  ]).state;
  /* the reader writes his death as a leave to "dead — …" */
  const died = applyMutations(st, [{ type: 'presence.leave', name: 'Old Hesk', to: 'dead — on the floor of the Bent Kettle taproom', shown: 'Old Hesk slid down the bar and did not rise' }]).state;
  eq(here(died), 'Azrael, Roska', 'he is out of the scene');
  /* the world agent seats the death where the body lies — the scene's own place */
  const seated = applyMutations(st, [{ type: 'offscreen.set', name: 'Old Hesk', location: 'dead — on the floor of the Bent Kettle taproom', activity: 'killed by the fence’s man' }]).state;
  assert(!seated.present.some((p) => p.name === 'Old Hesk'), 'a death at the scene’s place is not a walk-in: ' + here(seated));
  for (const [label, s] of [['his leave', died], ['the world’s seat', applyMutations({ ...st, present: st.present.filter((p) => p.name !== 'Old Hesk') }, [{ type: 'offscreen.set', name: 'Old Hesk', location: 'dead — on the floor of the Bent Kettle taproom' }]).state]]) {
    assert(s.offscreen['Old Hesk'], label + ': the death is kept as a seat');
    eq(applyMutations(s, [{ type: 'offscreen.clear', name: 'Old Hesk' }, { type: 'presence.enter', name: 'Roska' }]).state.present.filter((p) => p.name === 'Old Hesk').length, 0, label + ': nothing of the house walks him back in');
    eq(closeBy(s).length, 0, label + ': he is nobody’s company');
    eq(withinEarshotBlock(s).length, 0, label + ': nor asked of the reader as within earshot');
    const told = renderStateFacts(s);
    assert(!/crossbow bolt/.test(told) && !/Old Hesk — warm/.test(told) && /Dead: Old Hesk/.test(told), label + ': the storyteller is told him dead, once — not wounded, not warm: ' + told);
    eq(voicesBeyondTheRoom([{ speaker: 'Old Hesk', words: 'Close the shutters, girl.' }], s).length, 0, label + ': and no voice of his is heard');
    const raised = applyMutations(s, [{ type: 'offscreen.set', name: 'Old Hesk', location: 'his cellar, counting casks', activity: 'counting casks' }]);
    assert(!raised.applied.length && raised.rejected.some((r) => /is dead/.test(r.why)), label + ': a seat for the living is not written over the grave');
    assert(applyMutations(s, [{ type: 'offscreen.set', name: 'Old Hesk', location: 'his cellar, counting casks', byHand: true }]).applied.length === 1, label + ': but his own hand may');
  }
});

test('M680-4 A SIGHTING IS NOT COMPANY (the world audit): someone who LEFT with no word of where is noted "last seen at <the scene’s own ground>" — and was told to the storyteller as close by, able to hear and answer the door, and asked of the reader as within earshot; the reader’s own far-named list looked for a "last seen" that was never written that way', async () => {
  const { closeBy, renderStateFacts } = await import('../../js/engine/state.js');
  const { withinEarshotBlock, namedFromAfarBlock } = await import('../../js/agents/extractor.js');
  let st = applyMutations({ ...emptyState(), page: 19 }, [
    { type: 'mc.set', name: 'Azrael' }, { type: 'place.set', name: 'the great hall of Kingsreach' },
    { type: 'presence.enter', name: 'Azrael' }, { type: 'presence.enter', name: 'Corven' }, { type: 'presence.enter', name: 'Mirelia' },
    { type: 'people.set', name: 'Corven', field: 'core', text: 'the steward of Kingsreach' },
  ]).state;
  st = applyMutations(st, [{ type: 'presence.leave', name: 'Corven', shown: 'He bowed, and left the hall' }]).state;
  assert(st.offscreen.Corven && st.offscreen.Corven.lastSeen === true, 'the house notes where he was last seen');
  eq(closeBy(st).length, 0, 'he is not close by');
  eq(withinEarshotBlock(st).length, 0, 'nor within earshot');
  assert(/Elsewhere: Corven — last seen at the great hall of Kingsreach/.test(renderStateFacts(st)), 'he is elsewhere, last seen there: ' + renderStateFacts(st));
  assert(namedFromAfarBlock(st, '[the great hall of Kingsreach — x | 19:40]\n\nMirelia spoke of Corven.').join('\n').includes('Corven [last seen at the great hall of Kingsreach]'), 'the reader is told it as a sighting');
});

test('M680-5 TWO WRITERS NO LONGER ERASE EACH OTHER (the scene audit): the send path read the ledger before its waits — the weighing, the referee’s own call — and saved that whole copy back, writing over whatever the last page’s readers saved meanwhile (the auditor’s repairs were lost, and found again next page); the auditor asked the brief’s digits of its model between loading the ledger and saving it, and wrote over the referee’s duel, ruling and committed fate. The referee’s own writes are laid onto the ledger as it stands now, and the auditor makes its second call before it loads', async () => {
  const { refereeStep, refereeBase, refereeOnto } = await import('../../js/agents/referee.js');
  const SID = 'm680-lost-update';
  const st = applyMutations({ ...emptyState(), page: 4 }, [
    { type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Tenth Division Courtyard' },
    { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Renji Abarai', position: 'at the gate' },
    { type: 'presence.enter', name: 'Ikkaku Madarame', position: 'on the wall' },
  ]).state;
  await saveState(SID, st);
  let state = await loadState(SID);
  state.page = 5;
  const base = refereeBase(state);
  /* the last page's auditor lands its repair while the referee is out */
  const callLLM = async () => {
    const fresh = await loadState(SID);
    const r = applyMutations(fresh, [{ type: 'presence.leave', name: 'Ikkaku Madarame', to: 'the 11th Division barracks' }, { type: 'body.injure', name: 'Renji Abarai', what: 'a cut along the left forearm', sev: 2 }]);
    await saveState(SID, { ...r.state, audit: { at: 1, turn: 9, issues: [] } });
    return JSON.stringify({ check: true, action: 'Jovan swings at Renji', kind: 'actor', opposition: 'Renji Abarai', domain: 'melee', circumstance: 0, why: 'an open swing' });
  };
  const step = await refereeStep({ connection: { type: 'openai', baseUrl: 'x', apiKey: 'k', model: 'm' }, userText: 'I swing my sword at Renji.', userId: 'u5', history: [{ id: 'u5', role: 'user', text: 'I swing my sword at Renji.' }], state, settings: { sensitivity: 'normal', preset: 'realistic', fightStyle: 'tracked' }, callLLM });
  assert(step && step.ruling, 'the referee ruled: ' + (step && step.status));
  let after = step.state;
  after = { ...after, pendingVerdict: { ...step.ruling, forUser: 'u5' }, lastVerdict: step.ruling };
  await saveState(SID, refereeOnto(await loadState(SID), base, after));
  const now = await loadState(SID);
  eq(here(now), 'Jovan, Renji Abarai', 'the auditor’s repair stands: Ikkaku is not walked back onto the wall');
  assert(now.offscreen['Ikkaku Madarame'] && now.bodies['Renji Abarai'] && now.audit, 'his seat, Renji’s cut and the audit report stand');
  assert(now.pendingVerdict && now.lastVerdict && Array.isArray(now.refHistory) && now.refHistory.length, 'and so do the ruling and its committed fate');
  eq(now.page, 5, 'with this turn’s page stamp');
  /* the auditor's side: the referee saves during the auditor's second call */
  const { auditLedger } = await import('../../js/agents/auditor.js');
  const { thinkingHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const AID = 'm680-auditor-clobber';
  await db.messages.append(AID, { role: 'user', text: 'I square up to Renji.' });
  await db.messages.append(AID, { role: 'assistant', text: '[Tenth Division Courtyard — Monday, June 1, 2026 | 09:20 | sun | black shihakushō | on the sand]\n\nRenji rolled his shoulders and drew Zabimaru.' });
  await saveState(AID, applyMutations({ ...emptyState(), page: 0 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Tenth Division Courtyard' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Renji Abarai' }]).state);
  const audit = thinkingHouse({ answer: JSON.stringify({ issues: [] }) });
  const stand = thinkingHouse({ answer: JSON.stringify({ standings: [] }) });
  let raced = false;
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const text = String(opts && opts.body || '');
    if (/STATES a standing in digits/.test(text)) {
      if (!raced) { raced = true; let s = await loadState(AID); s = applyMutations({ ...s, page: 1 }, [{ type: 'combat.begin', kind: 'duel', opponent: 'Renji Abarai', domain: 'melee', opponentRating: 7 }]).state; await saveState(AID, { ...s, pendingVerdict: { words: 'succeeds', forUser: 'u2' }, refHistory: [{ key: 'h', msgId: 'u2', verdict: { words: 'succeeds' } }] }); }
      return stand.fetch(url, opts);
    }
    return audit.fetch(url, opts);
  };
  try { await auditLedger({ connection: HOUSES[0].conn, storyId: AID, brief: 'Jovan is a new recruit of the Tenth. (Rangiku → Jovan: P:40 R:10 S:0)', castNotes: '' }); } finally { globalThis.fetch = real; }
  const a = await loadState(AID);
  assert(raced, 'the referee saved during the auditor’s second call');
  assert(a.duel && a.duel.active && a.pendingVerdict && a.refHistory.length === 1 && a.journal.some((j) => j.m.type === 'combat.begin'), 'the duel, the ruling and its fate stand after the auditor saved');
});

test('M680-6 A PERSON’S NOW HAS ITS OWN AGE AND ITS OWN GROUND, AND THE CARD AND THE DRAWER TELL IT ONE WAY (the people audit): the scribe’s now (people.note) never knew the ground it was written on, so it never went stale by fact when the scene moved; any write to a page refreshed the now’s age (a loose end closed made a fifteen-page-old now fresh); and the storyteller’s card said "Now:" over a note fifteen pages old while Here now placed her elsewhere in the room', async () => {
  const { renderPeopleTiers, peopleView } = await import('../../js/engine/people.js');
  let st = applyMutations({ ...emptyState(), page: 4 }, [
    { type: 'mc.set', name: 'Azrael' }, { type: 'place.set', name: 'the Bent Kettle, Ilvarren' },
    { type: 'presence.enter', name: 'Azrael' }, { type: 'presence.enter', name: 'Roska' },
    { type: 'people.set', name: 'Roska', field: 'core', text: 'a thief of Ilvarren’s lower streets, quick hands, quicker mouth' },
    { type: 'people.note', name: 'Roska', field: 'state', text: 'leaning on the bar, nursing a cup of sour ale and counting the room' },
  ]).state;
  eq(st.characters.Roska.nowAt, 'the Bent Kettle, Ilvarren', 'the scribe’s now knows the ground it was written on');
  const moved = applyMutations({ ...st, page: 5 }, [{ type: 'place.set', name: 'the temple vestibule, Ilvarren' }]).state;
  eq(JSON.stringify(staleNows(moved, { ground: 'the temple vestibule, Ilvarren' })), JSON.stringify(['Roska']), 'and is stale by fact once the scene has moved');
  /* a now written on a page, then a loose end closed many pages later: the now keeps its own age */
  const nowAt = st.characters.Roska.nowTurn;
  let later = st;
  for (let i = 0; i < 6; i += 1) later = applyMutations({ ...later, page: 5 + i }, [{ type: 'presence.update', name: 'Roska', position: 'by the hearth ' + i }]).state;
  later = applyMutations(later, [{ type: 'people.note', name: 'Roska', field: 'thread', text: 'owes the fence behind the no-sign door a favour' }]).state;
  later = applyMutations(later, [{ type: 'people.note', name: 'Roska', field: 'unthread', text: 'owes the fence behind the no-sign door a favour' }]).state;
  eq(later.characters.Roska.nowTurn, nowAt, 'closing a loose end does not make her now fresh');
  later = applyMutations(later, [{ type: 'presence.update', name: 'Roska', position: 'at the hearth, warming her hands, laughing at his joke' }]).state;
  const card = renderPeopleTiers(later, { view: peopleView(200000) }).text;
  assert(/Roska[^\n]*\n?[^\n]*Now: here — at the hearth, warming her hands, laughing at his joke/.test(card) && !/nursing a cup of sour ale/.test(card), 'the card tells her by her place in the room, not a note from pages ago: ' + card);
  /* a fresh note still rides */
  const fresh = applyMutations(later, [{ type: 'people.note', name: 'Roska', field: 'state', text: 'laughing at his joke, cup forgotten' }]).state;
  assert(/Now: laughing at his joke, cup forgotten/.test(renderPeopleTiers(fresh, { view: peopleView(200000) }).text), 'a note written now is her now');
});

test('M680-7 "ALREADY SO" IS NO REFUSAL ON ANY WORKER’S LINE (the books audit — M679 mapped it in the auditor alone): a line of who knows what already held, a mood already on, a loose end already written were "refused" on the page reader’s line, the world agent’s and the founder’s', async () => {
  const { worldRunWords } = await import('../../js/agents/world.js');
  const { founderRunWords } = await import('../../js/agents/founder.js');
  const st = applyMutations({ ...emptyState(), page: 3 }, [
    { type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'the Wells kitchen' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rukia' },
    { type: 'knowledge.add', name: 'Rukia', fact: 'that Jovan hid the ledger under the floorboards' },
    { type: 'mode.set', flag: 'group' },
    { type: 'people.note', name: 'Rukia', field: 'thread', text: 'wants to know who sent the letter' },
  ]).state;
  const r = applyMutations(st, [
    { type: 'knowledge.add', name: 'Rukia', fact: 'that Jovan hid the ledger under the floorboards' },
    { type: 'mode.set', flag: 'group' },
    { type: 'people.note', name: 'Rukia', field: 'thread', text: 'wants to know who sent the letter' },
  ]);
  eq(r.applied.length, 0, 'nothing new');
  assert(r.rejected.length === 3 && r.rejected.every((x) => x.same === true), 'each is already so: ' + JSON.stringify(r.rejected));
  assert(!/refused/.test(worldRunWords({ applied: [], rejected: r.rejected, note: 'ok' })), 'the world agent’s line');
  assert(!/refused/.test(founderRunWords({ applied: [{ words: 'Rukia is here.' }], rejected: r.rejected, note: 'ok' })), 'the founder’s line');
});

test('M680-8 A TAKE-BACK OUTLIVES "TRY AGAIN" (the books audit): the reversal was journaled under the page the hand pressed on, so a fold to the page before (every Try again, every new version) dropped it and put back the line he took back; it is stamped with the page of the change it reverses', async () => {
  const { foldJournal } = await import('../../js/engine/state.js');
  const { undoEntry } = await import('../../js/engine/apply.js');
  const at = (st, page, list) => { st.page = page; return applyMutations(st, list).state; };
  let st = { ...emptyState() };
  st = at(st, 0, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'the yard' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rukia' }]);
  st = at(st, 27, [{ type: 'knowledge.add', name: 'Rukia', fact: 'saw Jovan hide the stolen ledger under the floorboards' }]);
  st = at(st, 28, [{ type: 'clock.advance', minutes: 10, reason: 'talk' }]);
  st = at(st, 29, [{ type: 'clock.advance', minutes: 5, reason: 'talk' }]);
  st = undoEntry(st, st.log.findIndex((e) => /stolen ledger/.test(e.words))).state;
  eq(st.knowledge.Rukia, undefined, 'taken back');
  const retried = foldJournal(st, [], 28, applyMutations);
  eq(retried.knowledge.Rukia, undefined, 'and still taken back in the ledger the retold page is told from');
  const before = foldJournal(st, [], 26, applyMutations);
  eq(before.knowledge.Rukia, undefined, 'a fold to before the change holds neither');
});

test('M680-9 WHEN PAGES GO, THE ONE RULE FOR LETTING A LINE GO REACHES THEM (the books audit — M675: never a line of his, and only where a keeper will fold again): a page let go, or the pages after a rewind, let go every line over them — his own, and in a tale whose keeper is off, for good. A line that began before still covers pages that stand: kept over them when it is his, or no keeper folds again — its audit mark no further than what stands; a line over the pages gone alone goes, whoever wrote it', () => {
  const his = (id, span, extra) => ({ id, span, text: 'his words ' + id, level: 1, verified: { at: 1, fixed: 'the writer' }, ...extra });
  const kept = (id, span, extra) => ({ id, span, text: 'the keeper ' + id, level: 1, ...extra });
  const spans = (m) => m.nodes.map((n) => n.id + ' ' + n.span.join('-') + (n.audited !== undefined ? ' read ' + n.audited : '')).join(' | ');
  const mem = { window: 4, nodes: [his('h', [0, 3], { audited: 4 }), kept('k', [4, 7], { audited: 3 }), kept('one', [8, 8]), his('h1', [9, 9]), kept('z', [10, 13])] };
  /* a page let go */
  eq(spans(memoryAfterDeletion(mem, 2)), 'h 0-2 read 3 | k 3-6 read 3 | one 7-7 | h1 8-8 | z 9-12', 'his line over the page let go stays, one page shorter, its mark one less; the rest slide');
  eq(spans(memoryAfterDeletion(mem, 5)), 'h 0-3 read 4 | one 7-7 | h1 8-8 | z 9-12', 'the keeper’s line over it goes (a keeper folds the hole) — as it ships');
  eq(spans(memoryAfterDeletion(mem, 5, { keepCovering: () => true })), 'h 0-3 read 4 | k 4-6 read 2 | one 7-7 | h1 8-8 | z 9-12', 'with no keeper to fold again it stays over the pages it still covers; a page let go within what was read takes one off the mark');
  eq(spans(memoryAfterDeletion(mem, 7, { keepCovering: () => true })), 'h 0-3 read 4 | k 4-6 read 3 | one 7-7 | h1 8-8 | z 9-12', 'a page let go past what was read leaves the mark as it was');
  eq(spans(memoryAfterDeletion(mem, 9, { keepCovering: () => true })), 'h 0-3 read 4 | k 4-7 read 3 | one 8-8 | z 9-12', 'a line over that one page alone has nothing left to cover and goes — his too');
  /* a rewind */
  eq(spans(memoryTruncatedAt(mem, 2)), 'h 0-1 read 2', 'his line reaching the cut stays over the pages before it, its mark no further; every line after the cut goes, his among them');
  eq(spans(memoryTruncatedAt(mem, 6)), 'h 0-3 read 4', 'the keeper’s line reaching the cut goes — as it ships');
  eq(spans(memoryTruncatedAt(mem, 6, { keepCovering: () => true })), 'h 0-3 read 4 | k 4-5 read 2', 'with no keeper to fold again it stays over the pages that stand');
  eq(spans(memoryTruncatedAt(mem, 9, { keepCovering: () => true })), 'h 0-3 read 4 | k 4-7 read 3 | one 8-8', 'a line ending before the cut is untouched');
  const corr = { window: 4, nodes: [{ id: 'c', span: [-1, -1], text: '[Correction] x', correction: true }, kept('k', [0, 3])] };
  eq(spans(memoryTruncatedAt(corr, 0)), 'c -1--1', 'a correction covers no page and stays');
  eq(spans(memoryAfterDeletion(corr, 0)), 'c -1--1', 'through a page let go too');
});

test('M680-10 WHAT IS TRUE OF THEM REACHES EVERY READER THAT IS TOLD IT (the people audit): a truth locked under her whole name ("Roska Venn") was told to nobody while the room kept her by her first name ("Roska") — not the storyteller’s notes, not the referee; the second reader and the weighing saw six truths of a person at most, so a seventh lock could be broken unseen', async () => {
  const { renderStateFacts } = await import('../../js/engine/state.js');
  const { buildRefereeUser, buildSeedUser } = await import('../../js/agents/referee.js');
  const { buildContinuityMessages } = await import('../../js/agents/continuity.js');
  const { renderWholeLedger } = await import('../../js/engine/whole.js');
  const keys = ['scar', 'eyes', 'hair', 'height', 'voice', 'hands', 'tattoo', 'gait', 'ring'];
  const muts = [{ type: 'mc.set', name: 'Azrael' }, { type: 'place.set', name: 'the Bent Kettle, Ilvarren' }, { type: 'presence.enter', name: 'Azrael' },
    { type: 'people.set', name: 'Roska Venn', field: 'core', text: 'a fence who sells to the watch' }, { type: 'presence.enter', name: 'Roska' }];
  keys.forEach((k, i) => muts.push({ type: 'canon.lock', name: 'Roska Venn', key: k, value: k + '-truth-' + i }));
  const st = applyMutations({ ...emptyState(), page: 3 }, muts).state;
  assert(st.present.some((p) => /^Roska/.test(p.name)), 'she is in the room');
  const notes = renderStateFacts(st);
  assert(/scar-truth-0/.test(notes), 'the storyteller’s notes tell her locked truth — got: ' + (notes.split('\n').find((l) => /Roska/.test(l)) || '(no line of hers)'));
  const ref = buildRefereeUser({ state: st, userText: 'I grab Roska by the collar.', history: [] });
  assert(/scar-truth-0/.test(ref), 'the referee is told it');
  const whole = renderWholeLedger(st);
  for (let i = 0; i < keys.length; i += 1) assert(whole.includes(keys[i] + '-truth-' + i), 'the whole ledger shows every truth of hers — missing ' + keys[i]);
  const cont = buildContinuityMessages({ state: st, assistantText: 'Roska smiled.' });
  for (let i = 0; i < keys.length; i += 1) assert(String(cont.user || '').includes(keys[i] + '-truth-' + i), 'the second reader is shown every one — missing ' + keys[i]);
  const seed = buildSeedUser({ state: st, pages: [] });
  for (let i = 0; i < keys.length; i += 1) assert(String(seed).includes(keys[i] + '-truth-' + i), 'the weighing is shown every one — missing ' + keys[i]);
});

test('M680-11 A WORKER’S WRITES ARE THE PAGE THEY ARE ABOUT (the world audit): when the page reader’s call failed, the ledger still stood at the page before — and the world agent’s and the scribe’s writes for the new page were stamped with the OLD page, so a fold to the old page (a “try again” of the new one) kept a seat and a note the new page alone had made', async () => {
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const { worldTurn } = await import('../../js/agents/world.js');
  const { scribeTurn } = await import('../../js/agents/scribe.js');
  const { foldJournal } = await import('../../js/engine/state.js');
  const st = await db.stories.create({ title: 'M680-11' });
  for (let i = 0; i < 4; i += 1) await db.messages.append(st.id, { role: i % 2 ? 'assistant' : 'user', text: i % 2 ? 'The yard, page ' + i + '. Kim watches.' : 'move ' + i });
  const led = applyMutations({ ...emptyState(), page: 0 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'The yard' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'people.set', name: 'Kim', field: 'core', text: 'a courier' }]).state;
  led.readTo = 0;
  await saveState(st.id, led);
  const worldHouse = thinkingHouse({ answer: JSON.stringify({ mutations: [{ type: 'offscreen.set', name: 'Kim', location: 'the north gate', activity: 'waiting for a reply', stance: 'busy' }], brief: { pressure: [], ripe: [], twb: null } }) });
  await withHouse(worldHouse, () => worldTurn({ connection: HOUSES[0].conn, storyId: st.id, userText: 'move 2', assistantText: 'The yard, page 3. Kim watches.', pageAt: 1 }));
  let after = await loadState(st.id);
  const seatEntry = (after.journal || []).find((e) => e.m && e.m.type === 'offscreen.set' && e.m.name === 'Kim');
  assert(seatEntry, 'the world agent’s seat is journaled');
  eq(seatEntry.p, 1, 'the world agent’s seat is stamped with the page it is about');
  eq(after.page, 0, 'the ledger’s own stamp is not the world agent’s to move');
  const folded = foldJournal(after, [], 0, applyMutations);
  assert(!(folded.offscreen || {}).Kim, 'a fold to the page before keeps no seat the new page alone made');
  const scribeHouse = thinkingHouse({ answer: JSON.stringify({ deltas: [{ name: 'Kim', field: 'arc', text: 'has started to trust Jovan with the letters' }] }) });
  await withHouse(scribeHouse, () => scribeTurn({ connection: HOUSES[0].conn, storyId: st.id, userText: 'move 2', assistantText: 'The yard, page 3. Kim watches Jovan and hands him the letters.', pageAt: 1 }));
  after = await loadState(st.id);
  const noteEntry = (after.journal || []).find((e) => e.m && /people\./.test(e.m.type) && e.m.name === 'Kim' && e.m.field === 'arc');
  assert(noteEntry, 'the scribe’s note is journaled');
  eq(noteEntry.p, 1, 'the scribe’s note is stamped with the page it is about');
  eq(after.page, 0, 'the ledger’s own stamp is not the scribe’s to move');
});

/* M680's two gate regressions (harness M655-1, walk DOM-100), closed at their one root: apply.js walkInFromPage. */
const OFFICE = '13th Division Barracks — Captain’s Office';
const OFFICE_PAGE = '[13th Division Barracks — Captain’s Office — Monday, June 1, 2026 | 10:00 | clear | captain’s haori | at the desk]\n\n'
  + 'Rukia set the report on Oda’s desk. Sentarō hovered by the window, pretending not to listen. Kuchiki-taichō studied them both, then turned and left without a word. Renji Abarai shouldered through the door a moment later, grinning.';
function office() {
  const st = applyMutations({ ...emptyState(), page: 3 }, [
    { type: 'mc.set', name: 'Jovan Oda' }, { type: 'place.set', name: OFFICE },
    ...['Jovan Oda', 'Rukia Kuchiki', 'Sentarō Kotsubaki', 'Byakuya Kuchiki'].map((name) => ({ type: 'presence.enter', name })),
    { type: 'offscreen.set', name: 'Renji Abarai', location: '6th Division Barracks — the training yard', activity: 'drilling', stance: 'busy' },
    { type: 'offscreen.set', name: 'Kiyone Kotetsu', location: '13th Division Barracks — the third seats’ office', activity: 'sorting rosters', stance: 'busy' },
  ]).state;
  st.characters = { ...st.characters, 'Rukia Kuchiki': { core: 'His lieutenant.' }, 'Byakuya Kuchiki': { core: 'Captain of the 6th.' }, 'Renji Abarai': { core: 'Lieutenant of the 6th.' }, 'Kiyone Kotetsu': { core: 'Third seat of the 13th.' }, 'Sentarō Kotsubaki': { core: 'Third seat of the 13th.' }, 'Kaien Shiba': { core: 'Once lieutenant of the 13th.' } };
  return st;
}
const READER_ROOM = ['Jovan Oda', 'Rukia Kuchiki', 'Sentarō Kotsubaki'];

test('M680-12 AN ARRIVAL THE PAGE’S ENDING TELLS, AND ONLY THAT (apply.js comesInAtTheEnd): this person the subject of a coming-in — never another’s, never one that did not happen, never a voice or a possessive, never one undone in the same sentence', async () => {
  const { comesInAtTheEnd } = await import('../../js/engine/apply.js');
  assert(typeof comesInAtTheEnd === 'function', 'the house can ask whether the ending tells someone coming in');
  const st = { ...office(), characters: { ...office().characters, Corven: {}, Salla: {}, Mirelia: {}, 'Ser Brannick': {} } };
  const no = [['Corven', 'Corven let him go.'], ['Salla', 'Salla called from behind the casks.'], ['Renji Abarai', 'Rukia waited for Renji to come in.'], ['Renji Abarai', 'Renji would come in later.'],
    ['Renji Abarai', 'If Renji came in, she would leave.'], ['Renji Abarai', 'Renji never came in.'], ['Renji Abarai', 'Renji didn’t come in.'], ['Renji Abarai', 'Renji’s voice came in through the window.'],
    ['Mirelia', 'Mirelia stayed where she was in the column’s shadow.'], ['Renji Abarai', 'Renji slipped in the mud.'], ['Renji Abarai', 'Renji walked in the rain.'],
    ['Rukia Kuchiki', 'Rukia watched as Renji came in.'], ['Rukia Kuchiki', 'Byakuya nodded to Rukia and Renji came in.'], ['Rukia Kuchiki', 'Rukia nodded and Renji came in.'],
    ['Renji Abarai', 'Renji walked through the door and out into the rain.'], ['Renji Abarai', 'Renji came in and went straight back out.'], ['Renji Abarai', 'Renji came in. Then he left again.'],
    ['Renji Abarai', '“Renji came in,” Rukia said.'], ['Renji Abarai', 'Renji walked into the courtyard.'], ['Rukia Kuchiki', 'Kuchiki-taichō came in.']];
  for (const [who, text] of no) eq(comesInAtTheEnd(st, text, who), false, who + ' does not come in: ' + text);
  const yes = [['Renji Abarai', OFFICE_PAGE], ['Renji Abarai', 'The door opened and Renji came in.'], ['Renji Abarai', 'In came Renji, grinning.'], ['Corven', 'The door opened behind them and Corven came in…'],
    ['Renji Abarai', 'When Renji came in, the room went quiet.'], ['Rukia Kuchiki', 'Rukia and Kaien came in.'], ['Kaien Shiba', 'Rukia and Kaien came in.'], ['Rukia Kuchiki', 'Rukia, then Renji, came in.'],
    ['Renji Abarai', 'Rukia, then Renji, came in.'], ['Rukia Kuchiki', 'Rukia, who had been waiting outside, came in.'], ['Kiyone Kotetsu', 'Kiyone came in with the tea.'], ['Renji Abarai', 'Renji came in the back door.'],
    ['Ser Brannick', 'At the door, Ser Brannick came in out of the passage and took his post.'], ['Renji Abarai', 'Renji paused, then he came in.'], ['Renji Abarai', 'Renji paused at the door. He came in.'],
    ['Renji Abarai', 'Renji walked into the office.'], ['Renji Abarai', 'Renji let himself in.'], ['Renji Abarai', 'Renji entered, carrying the rosters.'], ['Renji Abarai', 'Renji came in and took off his coat.']];
  for (const [who, text] of yes) eq(comesInAtTheEnd(st, text, who), true, who + ' comes in: ' + text);
  const sixth = { place: { name: 'the 6th Division office' }, present: [{ name: 'Jovan Oda' }], characters: { 'Byakuya Kuchiki': {} }, offscreen: {}, sheet: { playerName: 'Jovan Oda' } };
  eq(comesInAtTheEnd(sixth, 'Kuchiki-taichō came in.', 'Byakuya Kuchiki'), true, 'a family name nobody else in the ledger has, with his rank after it, is him');
  eq(comesInAtTheEnd(st, 'Renji came in.\n\n' + 'Jovan read the report line by line. '.repeat(14) + '\n\n' + 'Rukia waited. '.repeat(20), 'Renji Abarai'), false, 'a coming-in before the page’s ending is not its ending');
  eq(comesInAtTheEnd(st, 'Rukia looked up.', 'Kaien Shiba', 'Kaien Shiba stepped in from the corridor'), false, 'words handed over that are not on the page are nothing');
  eq(comesInAtTheEnd(st, 'The door slid open and the old lieutenant stepped in from the corridor.', 'Kaien Shiba', 'the old lieutenant stepped in from the corridor'), true, 'the page’s own words for him, handed over, that tell a coming-in');
});

test('M680-13 HIS BLEACH OFFICE (walk DOM-100 on m680-001): the page ends “Renji Abarai shouldered through the door a moment later” and the reader’s room forgot him — the world agent’s note let go and the reader’s own walk-in each put him in the room; Kiyone, seated in another room of the barracks and nowhere on the page, stays out against that room, and the reader’s own seat for her at the very office is not written', async () => {
  const { worldTurn } = await import('../../js/agents/world.js');
  const { extractTurn } = await import('../../js/agents/extractor.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const id = 'm681-office-world';
  await saveState(id, { ...office(), readTo: 3, roomAt: { page: 3, names: READER_ROOM } });
  const world = thinkingHouse({ answer: JSON.stringify({ mutations: [{ type: 'offscreen.clear', name: 'Renji Abarai' }, { type: 'offscreen.set', name: 'Kiyone Kotetsu', location: OFFICE, activity: 'listening at the desk' }], brief: { pressure: [], ripe: [], twb: null, voices: [] } }) });
  await withHouse(world, () => worldTurn({ connection: HOUSES[0].conn, storyId: id, userText: 'I look up from the report.', assistantText: OFFICE_PAGE, stale: () => false, pageAt: 3 }));
  const after = await loadState(id);
  assert(after.present.some((p) => p.name === 'Renji Abarai'), 'the world agent’s note let go walks Renji in: ' + here(after));
  assert(!after.offscreen['Renji Abarai'], 'and his old seat goes');
  assert(!after.present.some((p) => p.name === 'Kiyone Kotetsu') && after.offscreen['Kiyone Kotetsu'], 'Kiyone, nowhere on the page, stays in the third seats’ office');
  const reader = thinkingHouse({ answer: JSON.stringify({ mutations: [{ type: 'presence.enter', name: 'Renji Abarai', position: 'just inside the door' }, { type: 'offscreen.set', name: 'Kiyone Kotetsu', location: OFFICE, activity: 'by the desk' }, { type: 'mode.snapshot', flags: ['group'] }], here: READER_ROOM }) });
  const read = await withHouse(reader, () => extractTurn({ connection: HOUSES[0].conn, state: office(), userText: 'I look up from the report.', assistantText: OFFICE_PAGE, pageNumber: 4 }));
  assert(read.mutations.some((m) => m.type === 'presence.enter' && m.name === 'Renji Abarai'), 'the reader’s own walk-in of Renji stands: ' + JSON.stringify(read.mutations));
  assert(!read.mutations.some((m) => m.type === 'offscreen.set' && m.name === 'Kiyone Kotetsu'), 'its seat for Kiyone at the very office — a walk-in by another door — is not kept against its own room');
  const landed = applyMutations(office(), read.mutations).state;
  assert(landed.present.some((p) => p.name === 'Renji Abarai') && !landed.present.some((p) => p.name === 'Kiyone Kotetsu'), 'Renji in, Kiyone out, on the ledger');
});

test('M680-14 SILENCE IS NOT LEAVING, AGAIN (harness M655-1 on m680-001): someone with no seat whom the page never names, seated by the world agent in the very room the scene stands in, is in the scene — with or without a room the reader named; a SEATED person the page never names stays out against the reader’s room, and walks in only when there is none (M402)', async () => {
  const { worldTurn } = await import('../../js/agents/world.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const kitchen = () => applyMutations({ ...emptyState(), page: 12 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Wells house kitchen, 8 Mariner’s Lane' },
    ...['Jovan', 'Rias'].map((name) => ({ type: 'presence.enter', name })),
    { type: 'people.set', name: 'Tom', field: 'core', text: 'his cousin; slow to speak, quick to fix things' }, { type: 'people.set', name: 'Aunt Vera', field: 'core', text: 'runs the house' },
    { type: 'offscreen.set', name: 'Aunt Vera', location: 'upstairs in the Wells house', activity: 'asleep' }]).state;
  const PAGE = '[Wells house kitchen, 8 Mariner’s Lane — Monday, March 3, 2025 | 21:45 | rain | sweater | at the table]\n\nRias stirred the pot and said nothing.';
  for (const room of [true, false]) {
    const id = 'm681-kitchen-' + room;
    await saveState(id, { ...kitchen(), readTo: 12, ...(room ? { roomAt: { page: 12, names: ['Jovan', 'Rias'] } } : {}) });
    const house = thinkingHouse({ answer: JSON.stringify({ mutations: [{ type: 'offscreen.set', name: 'Tom', location: 'Wells house kitchen', activity: 'waiting by the stove' }, { type: 'offscreen.set', name: 'Aunt Vera', location: 'Wells house kitchen, by the sink', activity: 'drying cups' }], brief: { pressure: [], ripe: [], twb: null, voices: [] } }) });
    await withHouse(house, () => worldTurn({ connection: HOUSES[0].conn, storyId: id, userText: 'I wait.', assistantText: PAGE, stale: () => false, pageAt: 12 }));
    const after = await loadState(id);
    assert(after.present.some((p) => p.name === 'Tom'), (room ? 'with' : 'without') + ' a room: Tom, seated in the scene’s own room, is in the scene: ' + here(after));
    if (room) assert(!after.present.some((p) => p.name === 'Aunt Vera') && after.offscreen['Aunt Vera'].location === 'upstairs in the Wells house', 'Aunt Vera, seated upstairs and never on the page, stays out against the reader’s room');
    else assert(after.present.some((p) => p.name === 'Aunt Vera'), 'with no room named, the world’s seat of her at the scene is her in the scene (M402)');
  }
});

test('M680-15 SOMEONE THE ENDING SHOWS BUT NEVER COMING IN STAYS OUT OF THE ROOM ITS READER NAMED: Salla, new and with no seat, calls from behind the casks — the world agent seats her at the tavern and the reader’s room left her out: she is not walked in; another’s arrival is never hers (Kiyone watches Renji come in)', async () => {
  const { worldTurn } = await import('../../js/agents/world.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const eel = applyMutations({ ...emptyState(), page: 9 }, [{ type: 'mc.set', name: 'Azrael' }, { type: 'place.set', name: 'the Gilded Eel taproom' },
    ...['Azrael', 'Roska'].map((name) => ({ type: 'presence.enter', name })), { type: 'people.set', name: 'Salla', field: 'core', text: 'keeps the Eel’s casks' }]).state;
  await saveState('m681-eel', { ...eel, readTo: 9, roomAt: { page: 9, names: ['Azrael', 'Roska'] } });
  const EEL = '[the Gilded Eel taproom — Thornday, October 15, 1247 | 22:10 | rain | wool cloak | by the door]\n\nAzrael pushed the door open onto the lane. Salla called something from behind the casks. Roska did not look back.';
  await withHouse(thinkingHouse({ answer: JSON.stringify({ mutations: [{ type: 'offscreen.set', name: 'Salla', location: 'the Gilded Eel taproom, behind the casks', activity: 'calling after them' }], brief: { pressure: [], ripe: [], twb: null, voices: [] } }) }),
    () => worldTurn({ connection: HOUSES[0].conn, storyId: 'm681-eel', userText: 'I leave.', assistantText: EEL, stale: () => false, pageAt: 9 }));
  assert(!(await loadState('m681-eel')).present.some((p) => p.name === 'Salla'), 'Salla, calling from behind the casks, is not walked into the room the reader named');
  await saveState('m681-watch', { ...office(), readTo: 3, roomAt: { page: 3, names: READER_ROOM } });
  const WATCH = OFFICE_PAGE.replace('Renji Abarai shouldered through the door a moment later, grinning.', 'Kiyone watched from the corridor as Renji came in.');
  await withHouse(thinkingHouse({ answer: JSON.stringify({ mutations: [{ type: 'offscreen.clear', name: 'Kiyone Kotetsu' }, { type: 'offscreen.clear', name: 'Renji Abarai' }], brief: { pressure: [], ripe: [], twb: null, voices: [] } }) }),
    () => worldTurn({ connection: HOUSES[0].conn, storyId: 'm681-watch', userText: 'I look up.', assistantText: WATCH, stale: () => false, pageAt: 3 }));
  const w = await loadState('m681-watch');
  assert(w.present.some((p) => p.name === 'Renji Abarai'), 'Renji, who came in, is in');
  assert(!w.present.some((p) => p.name === 'Kiyone Kotetsu') && w.offscreen['Kiyone Kotetsu'], 'Kiyone, who only watched him come in, keeps her seat');
});

test('M680-16 THE AUDITOR’S SEAT AT THE SCENE FOR SOMEONE WITH NONE IS A WALK-IN, AND ANSWERS AS ITS WALK-INS DO: a seat in the very office for someone the page’s ending never shows is dropped; one for someone the ending shows coming in stands', async () => {
  const { auditorScope } = await import('../../js/agents/auditor.js');
  const issue = (name) => ({ what: name + ' is not placed', fix: 'seat them', mutations: [{ type: 'offscreen.set', name, location: OFFICE, activity: 'at the desk' }] });
  const page = OFFICE_PAGE + ' Kaien Shiba came in behind him with the tea.';
  const kept = auditorScope([issue('Hanatarō Yamada'), issue('Kaien Shiba')], office(), { page, pageAt: 3 });
  const seats = kept.flatMap((i) => i.mutations).filter((m) => m.type === 'offscreen.set').map((m) => m.name);
  eq(seats.join(', '), 'Kaien Shiba', 'Hanatarō, never on the page, is not seated into the office; Kaien, who came in, is');
});
