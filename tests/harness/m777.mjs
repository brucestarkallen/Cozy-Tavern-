/* Cozy Tavern — harness laws of M777. His (24 October 2026), with his debug report: "found 3 things, 5 proposed changes need
 * a different repair … Céleste Vermaine's People core states 'Away from the manor tonight; expected at dawn' and her state
 * is 'Elsewhere, on the road toward the manor'; the pages show her arriving and standing in the hall: the writer explicitly
 * controls this field … Why it keeps being like this why there are no solutions that it's self healing". A now his hand
 * wrote stood against every reader for good, and a moment filed in a nature told the storyteller she was away while she
 * stood in the hall. Each law runs the real ledger door or the real auditor and reads the ledger back; each fails on
 * m776-001. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { applyMutations, handHolds, staleWhereaboutsInCores, undoEntry } from '../../js/engine/apply.js';

const CORE = 'A Vermaine Higher Vampire, the quiet one; remembers every slight. Away from the manor tonight; expected at dawn.';
const ROAD = 'Elsewhere, on the road toward the manor';
const base = () => applyMutations({ ...emptyState(), page: 0, sheet: { actors: {}, playerName: 'Jovan Wessex' } }, [
  { type: 'mc.set', name: 'Jovan Wessex' }, { type: 'place.set', name: 'The Vermaine manor, the long hall' },
  { type: 'presence.enter', name: 'Jovan Wessex' },
  { type: 'people.set', name: 'Céleste Vermaine', field: 'core', text: CORE, byHand: true },
  { type: 'people.set', name: 'Céleste Vermaine', field: 'state', text: ROAD, byHand: true }]).state;

test('M777-1 HIS HAND ON SOMEONE’S NOW HOLDS FOR ITS OWN PAGE, AND YIELDS TO THE PAGES AFTER IT; HIS HAND ON WHO THEY ARE HOLDS FOR GOOD', () => {
  const st = base();
  const c = st.characters['Céleste Vermaine'];
  eq(handHolds(st, c, 'state'), true, 'on the page he wrote it');
  eq(handHolds({ ...st, page: 1 }, c, 'state'), false, 'a later page moves it');
  eq(handHolds(st, c, 'state', 1), false, 'as does a reader told it reads a later page');
  eq(handHolds({ ...st, page: 40 }, c, 'core'), true, 'his words on who she is stand');
  const moved = applyMutations({ ...st, page: 1 }, [{ type: 'people.set', name: 'Céleste Vermaine', field: 'state', text: 'standing in the hall at a measured distance from Jovan' }]).state;
  eq(moved.characters['Céleste Vermaine'].state, 'standing in the hall at a measured distance from Jovan', 'a reader of the later page writes it');
  assert(!moved.characters['Céleste Vermaine'].hand.state && moved.characters['Céleste Vermaine'].hand.core, 'the now is the story’s again; the nature is still his');
});

test('M777-2 THE AUDITOR’S REPAIR OF HER NOW LANDS ONCE THE STORY HAS MOVED PAST HIS WORDS — never on the page he wrote them; and the audit itself lets a moment go from the nature of someone in the scene', async () => {
  const { auditLedger } = await import('../../js/agents/auditor.js');
  const { withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const say = (text, stream) => {
    const lines = 'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n' + 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n' + 'data: [DONE]\n\n';
    if (stream) { const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(lines)); c.close(); } }); return { ok: true, status: 200, headers: new Headers(), body, async json() { return {}; }, async text() { return lines; }, clone() { return this; } }; }
    const obj = { choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }] };
    return { ok: true, status: 200, headers: new Headers(), async json() { return obj; }, async text() { return JSON.stringify(obj); }, clone() { return this; } };
  };
  const SHOWN = 'She came past her sister’s noise without comment, set herself at the correct conversational distance from Jovan, precisely measured, and stopped.';
  const FIX = { what: 'Céleste’s state has her on the road; the page shows her in the hall', fix: 'she is in the hall', pages: false,
    mutations: [{ type: 'people.set', name: 'Céleste Vermaine', field: 'state', text: 'in the long hall, at a measured distance from Jovan', shown: SHOWN }] };
  const answer = { scene: [], issues: [FIX], review: { status: 'complete', why: 'every entry read against the newest page', open: [] }, standings: [] };
  const house = { fetch: async (url, opts) => { const body = JSON.parse(opts.body); const sys = String(body.messages[0].content || '');
    return say(/auditor of the ledger/i.test(sys) ? JSON.stringify(answer) : '{"standings":[],"mutations":[],"people":[]}', body.stream); } };
  const run = async (laterPage) => {
    const { id } = await db.stories.create({ title: 'M777-2' });
    const st = laterPage ? applyMutations(base(), [{ type: 'presence.enter', name: 'Céleste Vermaine' }]).state : base();
    /* his words were written as page 1 stood (index 0); the later page is page 2 (index 1), the one the chain reads next */
    await saveState(id, { ...st, page: laterPage ? 1 : 0, readTo: laterPage ? 2 : 1 });
    await db.messages.append(id, { role: 'user', text: 'I wait.' });
    await db.messages.append(id, { role: 'assistant', text: laterPage ? 'The night went on; the road was empty.' : '[The Vermaine manor, the long hall — Sunday | 01:16 | candlelight | field kit | by the table]\n\n' + SHOWN });
    if (laterPage) {
      await db.messages.append(id, { role: 'user', text: 'The door opens.' });
      await db.messages.append(id, { role: 'assistant', text: '[The Vermaine manor, the long hall — Sunday | 01:16 | candlelight | field kit | by the table]\n\n' + SHOWN });
    }
    const r = await withHouse(house, () => auditLedger({ connection: HOUSES[0].conn, storyId: id, stale: () => false }));
    return { r, after: await loadState(id) };
  };
  const later = await run(true);
  eq(later.after.characters['Céleste Vermaine'].state, 'in the long hall, at a measured distance from Jovan', 'the later page’s truth lands');
  eq(later.after.characters['Céleste Vermaine'].core, 'A Vermaine Higher Vampire, the quiet one; remembers every slight.', 'and the audit lets the moment go from her nature, she being here');
  const same = await run(false);
  eq(same.after.characters['Céleste Vermaine'].state, ROAD, 'on his own page his words stand');
});

test('M777-3 A MOMENT FILED AS WHO SOMEONE IS IS LET GO WHILE THEY STAND IN THE SCENE: “away from the manor tonight; expected at dawn” goes from Céleste’s nature, the rest of his words stay his, and Undo puts it back', () => {
  const away = base();
  eq(staleWhereaboutsInCores(away).length, 0, 'while she is away, nothing');
  const here = applyMutations(away, [{ type: 'presence.enter', name: 'Céleste Vermaine', position: 'at a measured distance from Jovan' }]).state;
  const heal = staleWhereaboutsInCores(here);
  eq(heal.length, 1, 'named once');
  const r = applyMutations(here, heal);
  eq(r.state.characters['Céleste Vermaine'].core, 'A Vermaine Higher Vampire, the quiet one; remembers every slight.', 'only the moment goes');
  assert(r.state.characters['Céleste Vermaine'].hand.core, 'the words left are still his');
  const back = undoEntry(r.state, r.state.log.length - 1);
  eq(back.state.characters['Céleste Vermaine'].core, CORE, 'Undo returns it');
  const nature = applyMutations(here, [{ type: 'people.set', name: 'Céleste Vermaine', field: 'core', text: 'The quiet one; her arrival in a room changes it. Expected to rule the family one day.', byHand: true }]).state;
  eq(staleWhereaboutsInCores(nature).length, 0, 'a nature that only speaks of arriving or of what is expected of her is not a moment');
});
