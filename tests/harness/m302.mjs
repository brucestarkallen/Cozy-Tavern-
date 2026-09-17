/* M302 — a housekeeper retry that never landed takes nothing. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { saveSessionRoot, loadSession, loadSessionRoot, truncateForRetry, restoreAfterRetry } from '../../js/agents/housekeeper.js';

const seed = async (sid) => saveSessionRoot(sid, {
  sessions: [{ id: 1, name: 'Session 1', turns: [
    { role: 'writer', text: 'first question', ts: 1 },
    { role: 'housekeeper', text: 'first answer', ts: 2 },
    { role: 'writer', text: 'is the tide right?', ts: 3 },
    { role: 'housekeeper', text: 'the tide is right', ts: 4, thinking: 'weighed it', proposals: [{ id: 'p1', label: 'a card', status: 'pending' }],
      swipes: [{ text: 'an older version' }, { text: 'the tide is right' }], swipeIdx: 1 },
  ] }],
  activeId: 1, batches: [],
});

test('M302-1: a retry lets the old answer go, and a retry that never landed puts every turn back exactly — cards, thinking and versions with it', async () => {
  const st = await db.stories.create({ title: 'a cut retry' });
  await seed(st.id);
  const asItWas = JSON.stringify((await loadSession(st.id)).turns);
  const r = await truncateForRetry(st.id, 3);
  eq(r.question, 'is the tide right?');
  eq((await loadSession(st.id)).turns.length, 2, 'the question and its answer are let go while the new one is asked for');
  const back = await restoreAfterRetry(st.id, r.undo);
  assert(back, 'put back');
  eq(JSON.stringify(back.turns), asItWas, 'exactly as it was');
  eq(JSON.stringify((await loadSession(st.id)).turns), asItWas, 'and kept');
});

test('M302-2: nothing is put back over a session that has moved on, or into the wrong session', async () => {
  const st = await db.stories.create({ title: 'a retry, then more' });
  await seed(st.id);
  const r = await truncateForRetry(st.id, 3);
  /* the new answer landed after all (or the writer said something else) */
  const root = await loadSessionRoot(st.id);
  root.sessions[0].turns.push({ role: 'writer', text: 'is the tide right?', ts: 5 }, { role: 'housekeeper', text: 'a NEW answer', ts: 6 });
  await saveSessionRoot(st.id, root);
  eq(await restoreAfterRetry(st.id, r.undo), null, 'refused: the session as it stands is the truth');
  const turns = (await loadSession(st.id)).turns;
  eq(turns.length, 4, 'nothing doubled');
  eq(turns[3].text, 'a NEW answer');
  eq(await restoreAfterRetry(st.id, { ...r.undo, sessionId: 99 }), null, 'a session that is gone takes nothing');
  eq(await restoreAfterRetry(st.id, null), null);
  eq(await restoreAfterRetry(st.id, { sessionId: 1, at: 4, turns: [] }), null);
});
