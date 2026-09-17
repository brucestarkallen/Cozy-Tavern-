/* M298 — a ruling on a "Go on." turn stands on the next turn. */
import './idb-shim.mjs';
import { test, eq, assert } from './lib.mjs';
import { refereeStep } from '../../js/agents/referee.js';
import { emptyState } from '../../js/engine/state.js';

const mkUser = (id, text, hidden = false) => ({ id, role: 'user', pages: [{ text }], page: 0, text, ...(hidden ? { hidden: true } : {}) });
const conn = { type: 'openai' };
const ruling = async () => JSON.stringify({ check: true, kind: 'task', action: 'try the risky thing', tier: 'moderate', circumstance: 0 });

test('M298-1: the referee’s ruling on a hidden “Go on.” page is not pruned as a deleted page on the next turn — the world it left stands', async () => {
  const state = { ...emptyState(), turn: 1 };
  const m1 = mkUser('u1', 'I try to sneak past the guard');
  const first = await refereeStep({ connection: conn, userText: m1.text, userId: 'u1', history: [m1], state, settings: {}, callLLM: ruling });
  eq(first.status, 'ruled', 'the first turn is ruled');
  /* the nudge: a hidden writer page, ruled like any other */
  const nudge = mkUser('u2', 'I try to slip through the side door', true);
  const second = await refereeStep({ connection: conn, userText: nudge.text, userId: 'u2', history: [m1, nudge], state: first.state, settings: {}, callLLM: ruling });
  eq(second.status, 'ruled', 'the hidden page is ruled like any other');
  const entries = second.state.refHistory.length;
  assert(entries >= 1, 'the timeline holds the rulings');
  /* the next turn: the nudge is still in the store, hidden; nothing was deleted */
  const m3 = mkUser('u3', 'I lunge at him.');
  let asked = 0;
  const third = await refereeStep({ connection: conn, userText: m3.text, userId: 'u3', history: [m1, nudge, m3], state: JSON.parse(JSON.stringify(second.state)), settings: {}, callLLM: async (...a) => { asked += 1; return ruling(...a); } });
  const kept = third.state.refHistory.filter((e) => e && (e.msgId === 'u1' || e.msgId === 'u2')).length;
  eq(kept, second.state.refHistory.filter((e) => e && (e.msgId === 'u1' || e.msgId === 'u2')).length, 'the earlier commits — the nudge’s among them — stand (they used to be cut as a deleted page, the world rewound with them)');
});
