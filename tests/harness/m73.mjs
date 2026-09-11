/* M73 — the housekeeper's bubble row, whole (Chat Assistant's attachMsgIcons):
 * edit-and-continue, copy, branch and delete on both voices; retry as a
 * version of the last answer; the versions walked; the top button says copy. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { saveSessionRoot, loadSession, editTurnAt, deleteTurnAt, truncateForRetry, keepVersions, walkVersion, versionsOf } from '../../js/agents/housekeeper.js';

const sid = 'm73';
const seed = async () => saveSessionRoot(sid, { sessions: [{ id: 1, name: 'S', turns: [
  { role: 'writer', text: 'q1', ts: 1 }, { role: 'housekeeper', text: 'a1', ts: 2, proposals: [{ id: 'p1', status: 'pending', label: 'x' }] },
  { role: 'writer', text: 'q2', ts: 3 }, { role: 'housekeeper', text: 'a2', ts: 4 },
] }], activeId: 1, batches: [] });

test('M73-1 edit-and-continue lets go of everything from the writer’s turn on and hands the words back; delete lets one turn go', async () => {
  await seed();
  const r = await editTurnAt(sid, 2);
  eq(r.text, 'q2'); eq(r.session.turns.length, 2, 'q1/a1 stand');
  eq(await editTurnAt(sid, 1), null, 'an answer is not edited this way');
  await seed();
  const d = await deleteTurnAt(sid, 1);
  eq(d.turns.map((t) => t.text).join(','), 'q1,q2,a2', 'the ones around it stay');
});

test('M73-2 retry-from-here truncates to the question and returns the answer let go; the last answer keeps it as a version; versions walk', async () => {
  await seed();
  const r = await truncateForRetry(sid, 3);
  eq(r.question, 'q2'); eq(r.dropped.text, 'a2'); eq(r.session.turns.length, 2);
  /* the new answer lands (as housekeeperTurn would), then the old one is kept beside it */
  const root = { sessions: [{ id: 1, name: 'S', turns: [...r.session.turns, { role: 'writer', text: 'q2', ts: 5 }, { role: 'housekeeper', text: 'a2b', ts: 6 }] }], activeId: 1, batches: [] };
  await saveSessionRoot(sid, root);
  let s = await keepVersions(sid, 3, r.dropped);
  eq(versionsOf(s.turns[3]).length, 2); eq(s.turns[3].swipeIdx, 1); eq(s.turns[3].text, 'a2b');
  s = await walkVersion(sid, 3, -1);
  eq(s.turns[3].text, 'a2', 'the old words show'); eq(s.turns[3].swipeIdx, 0);
  eq(await walkVersion(sid, 3, -1), null, 'past the first is a no-op');
  s = await walkVersion(sid, 3, 1);
  eq(s.turns[3].text, 'a2b');
  /* versions ride their cards: the first answer's pending card is its own */
  const t = await truncateForRetry(sid, 1);
  eq(t.dropped.proposals.length, 1, 'the answer let go carries its cards');
  /* a middle answer's retry lets the answers after it go (edit-and-continue) */
  eq(t.session.turns.length, 0);
  /* the store keeps versions on reload */
  s = await loadSession(sid);
  eq(s.turns.length, 0);
});

test('M73-3 the row is on both voices; the top button is a copy and says so', () => {
  const ui = readFileSync(new URL('../../js/ui/housekeeper.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const b = ui.slice(ui.indexOf('function bubble('), ui.indexOf('function lastAnswerIndex('));
  for (const act of ['edit-at', 'copy-at', 'branch-at', 'delete-at', 'retry-at', 'swipe-prev', 'swipe-next']) assert(b.includes("'" + act + "'"), act);
  assert(/if \(role === 'writer'\) mk\('✎ Edit'/.test(b), 'edit on the writer’s bubble only');
  assert(b.indexOf("mk('⧉ Copy'") > b.indexOf("mk('↻ Retry'") && b.indexOf("mk('⑂ Branch'") > 0 && b.indexOf("mk('✕ Delete'") > 0, 'copy, branch, delete on both');
  assert(!/\.disabled = at/.test(b), 'the version arrows are never disabled (a dropped click is a dead button)');
  assert(/if \(isLast\) \{[\s\S]*mk\('◂'[\s\S]*mk\('▸'[\s\S]*\} else \{[\s\S]*mk\('↻ Retry'/.test(b), 'the last answer always wears ◂ n/N ▸; an older answer wears ↻ (M73-002)');
  assert(/if \(at >= versions\.length - 1\) \{ await turnAct\('retry-at', index\); return; \}/.test(ui), '▸ past the last version asks for another answer');
  assert(/thread\.append\(bubble\(turn\.role, turn\.text, i, turn\)\)/.test(ui), 'every turn gets the row');
  assert(/id="hk-sess-branch"[^>]*>⧉ Copy</.test(html), 'the top button is a copy of the whole talk, and says so');
  assert(/await turnAct\('retry-at', i\);/.test(ui.slice(ui.indexOf('async function retryLast('))), 'the toolbar’s ↻ is the bubble’s ↻ on the last answer');
});
