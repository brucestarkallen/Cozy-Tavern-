/* M397: the housekeeper never leaves a wrong card beside its correction, never stages a card that cannot land as if it
 * could, and never says "done" of a card it only proposed. Runs the real housekeeper on a scripted model and the real
 * ledger. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { supersededByNew, runConversation, housekeeperTurn, loadSession } from '../../js/agents/housekeeper.js';
import { emptyState, saveState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const card = (mutations, extra = {}) => ({ kind: 'ledit', status: 'pending', op: { mutations }, ...extra });
const scene = () => applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Jovan Oda' }, { type: 'presence.enter', name: 'Jovan Oda' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }]).state;

test('M397-1 A NEWER CARD THAT DECIDES THE SAME THING REPLACES THE OLDER: a ledger card by the facts it writes, a page edit by the passage it quotes', () => {
  const wrong = card([{ type: 'people.set', name: 'Rukia Kuchiki', field: 'core', text: 'Captain of the 13th.' }]);
  const right = card([{ type: 'people.set', name: 'Rukia Kuchiki', field: 'core', text: 'Oda’s lieutenant.' }]);
  eq(supersededByNew(wrong, right), true, 'the correction replaces the wrong card');
  eq(supersededByNew(wrong, card([{ type: 'people.set', name: 'rukia kuchiki', field: 'core', text: 'x' }, { type: 'offscreen.set', name: 'Renji', location: 'x' }])), true, 'a correction that also decides more still replaces it');
  eq(supersededByNew(wrong, card([{ type: 'people.set', name: 'Rukia Kuchiki', field: 'state', text: 'x' }])), false, 'a card about another fact of hers does not');
  eq(supersededByNew(wrong, card([{ type: 'people.set', name: 'Byakuya Kuchiki', field: 'core', text: 'x' }])), false, 'nor one about someone else');
  const e1 = { kind: 'edit', status: 'pending', op: { messageId: 'm1', find: 'she married Renji', replace: 'she never married' } };
  const e2 = { kind: 'edit', status: 'pending', op: { messageId: 'm1', find: 'Years ago she married Renji and', replace: 'Years ago she never married, and' } };
  eq(supersededByNew(e1, e2), true, 'the same passage quoted longer is the same fix, refined');
});

test('M397-2 A CARD THAT CANNOT LAND IS HANDED BACK AT ONCE, AND "DONE" SAID OF A CARD ONLY PROPOSED IS TAKEN BACK', async () => {
  const sent = [];
  const answers = [
    'Done — Rukia is back in her office.\n<ledits>[{"type":"offscreen.set","name":"Rukia Kuchiki","location":"13th Division barracks, her office","activity":"reviewing the roster"}]</ledits>',
    'Done.\n<ledits>[{"type":"people.set","name":"Rukia Kuchiki","field":"state","text":"watching the duel from the galleries"}]</ledits>',
    'Once you apply it, her page will say she is watching the duel from the galleries.\n<ledits>[{"type":"people.set","name":"Rukia Kuchiki","field":"state","text":"watching the duel from the galleries"}]</ledits>',
  ];
  const call = async ({ messages }) => { sent.push(messages[messages.length - 1].content); return { text: answers[Math.min(sent.length - 1, answers.length - 1)] }; };
  const r = await runConversation({ story: { id: 's', title: 't', brief: '' }, messages: [], state: scene(), modules: [], lore: [], memory: { nodes: [] }, session: { turns: [] }, writerText: 'Rukia is at the duel, fix where she is', contextPages: 8, call });
  assert(r.ok, r.error);
  eq(sent.length, 3, 'two hand-backs, then the answer');
  assert(/^\[CANNOT LAND\]/.test(sent[1]) && /is in the scene/.test(sent[1]), 'the first: the ledger’s own reason, at once: ' + sent[1].slice(0, 160));
  assert(/^\[NOT YET\]/.test(sent[2]), 'the second: "done" of a card only proposed');
  assert(!/done/i.test(r.parsed.text) && r.parsed.ledits.length === 1, 'the answer he sees says what the card will do');
});

test('M397-3 STAGED, A CARD THAT STILL CANNOT LAND IS REFUSED WITH WHY — NEVER "PENDING"; AND ACROSS TURNS THE CORRECTION SETS THE WRONG CARD ASIDE', async () => {
  const st = await db.stories.create({ title: 'Housekeeper' });
  await saveState(st.id, scene());
  const stubborn = 'Here.\n<ledits>[{"type":"offscreen.set","name":"Rukia Kuchiki","location":"13th Division barracks, her office","activity":"reviewing"}]</ledits>';
  const t1 = await housekeeperTurn({ storyId: st.id, writerText: 'where is Rukia', connection: { type: 'openai' }, call: async () => ({ text: stubborn }) });
  assert(t1.ok, t1.error);
  let sess = await loadSession(st.id);
  let cards = sess.turns.flatMap((t) => t.proposals || []);
  const ledit = cards.find((p) => p.kind === 'ledit');
  eq(ledit.status, 'refused', 'never shown as a change he can apply');
  assert(/Could not land — .*is in the scene/.test(ledit.words), 'and says why: ' + ledit.words);
  const t2 = await housekeeperTurn({ storyId: st.id, writerText: 'set her page', connection: { type: 'openai' }, call: async () => ({ text: 'Proposed.\n<ledits>[{"type":"people.set","name":"Rukia Kuchiki","field":"core","text":"Captain of the 13th Division."}]</ledits>' }) });
  assert(t2.ok, t2.error);
  const t3 = await housekeeperTurn({ storyId: st.id, writerText: 'no — she is his lieutenant', connection: { type: 'openai' }, call: async () => ({ text: 'Corrected card below.\n<ledits>[{"type":"people.set","name":"Rukia Kuchiki","field":"core","text":"Oda’s lieutenant; she had expected the captaincy."}]</ledits>' }) });
  assert(t3.ok, t3.error);
  sess = await loadSession(st.id);
  cards = sess.turns.flatMap((t) => t.proposals || []).filter((p) => p.kind === 'ledit' && /people/.test(p.label));
  const wrong = cards.find((p) => /Captain of the 13th/.test(JSON.stringify(p.op.mutations)));
  const right = cards.find((p) => /lieutenant/.test(JSON.stringify(p.op.mutations)));
  eq(wrong.status, 'superseded', 'the wrong card is set aside');
  eq(right.status, 'pending', 'the correction waits for him');
});
