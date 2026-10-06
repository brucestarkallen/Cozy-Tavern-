/* M632 — his: "a benchmark so I can choose the LLM that writes the best and most realistic — score each, compare, keep a
 * rank; easy, no copy-paste". Laws RUN the grader's readers and the board. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { parseGrade, parseDuel, gradeMessages } from '../../js/agents/judge.js';
import { boardRows, recordGrade, recordDuel, loadBench, clearBench, writerKey } from '../../js/engine/bench.js';

test('M632-1 THE JUDGE\u2019S ANSWERS ARE READ WHOLE — a thought or a word first, scores kept to 0–10; a page is judged against its moment', () => {
  const g = parseGrade('<think>hmm {not json}</think>Here: {"prose":7,"people":8.5,"agency":12,"continuity":6,"pull":5,"overall":7,"why":"Sharp, but slow."}');
  eq(g.overall, 7, 'overall');
  eq(g.scores.agency, 10, 'a score past ten is ten');
  eq(g.scores.people, 8.5, 'halves kept');
  eq(parseGrade('no idea'), null, 'nothing readable: nothing');
  eq(parseDuel('{"better":"b","why":"tighter"}').better, 'B', 'B');
  eq(parseDuel('{"better":"equal"}').better, 'same', 'anything else is the same');
  const m = gradeMessages({ before: 'BEFORE', move: 'MOVE', notes: 'NOTES', page: 'PAGE' });
  assert(/<the page before>\nBEFORE/.test(m.user) && /<his move>\nMOVE/.test(m.user) && /<where things stand>\nNOTES/.test(m.user) && /<the page to judge>\nPAGE/.test(m.user), 'the moment it answers rides with the page');
});

test('M632-2 THE BOARD — each storyteller\u2019s average of its pages, ranked; head to head counted for both; a page graded again replaces its grade; one moment\u2019s pair judged once', async () => {
  await clearBench();
  await recordGrade({ writer: 'c1', label: 'Kimi', model: 'kimi-k3', pageKey: 's:p1:1', scores: { prose: 7 }, overall: 7 });
  await recordGrade({ writer: 'c1', label: 'Kimi', model: 'kimi-k3', pageKey: 's:p2:1', scores: { prose: 9 }, overall: 9 });
  await recordGrade({ writer: 'c2', label: 'Flash', model: 'flash', pageKey: 's:p3:1', scores: { prose: 6 }, overall: 6 });
  await recordGrade({ writer: 'c2', label: 'Flash', model: 'flash', pageKey: 's:p3:1', scores: { prose: 7 }, overall: 7 });
  await recordDuel({ x: 'c2', y: 'c1', winner: 'x', duelKey: 'd1' });
  eq(await recordDuel({ x: 'c2', y: 'c1', winner: 'y', duelKey: 'd1' }), false, 'the same pair of the same moment is judged once');
  await recordDuel({ x: 'c1', y: 'c2', winner: 'tie', duelKey: 'd2' });
  const { grades, duels } = await loadBench();
  eq(grades.length, 3, 'the regraded page counts once');
  const rows = boardRows(grades, duels, {});
  eq(rows.map((r) => r.writer + '#' + r.rank + '@' + r.average).join(' '), 'c1#1@8 c2#2@7', 'ranked by average');
  const c2 = rows.find((r) => r.writer === 'c2');
  eq(`${c2.win}-${c2.loss}-${c2.tie}`, '1-0-1', 'head to head for the second');
  const c1 = rows.find((r) => r.writer === 'c1');
  eq(`${c1.win}-${c1.loss}-${c1.tie}`, '0-1-1', 'and for the first');
  eq(c1.axes.prose, 8, 'each thing averaged too');
  eq(writerKey({ connId: 'c9', model: 'x' }), 'c9', 'a page knows its connection');
  eq(writerKey({ model: 'old-model' }), 'model:old-model', 'an older page, its model');
  await clearBench();
});
