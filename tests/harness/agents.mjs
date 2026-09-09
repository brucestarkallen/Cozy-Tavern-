/* B16 dedupe targets behave; referee fate replay; worker status ledger. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { firstBalancedObject, parseFirstObject } from '../../js/agents/jsonutil.js';
import { userMessageHash, refereeStep } from '../../js/agents/referee.js';
import { noteWorkerRun, loadWorkerStatus, workerSignal } from '../../js/agents/status.js';
import { saveModule, listModules, selectModules } from '../../js/assemble/modules.js';
import { workerPlan } from '../../js/ui/chat.js';

test('B16: firstBalancedObject respects quoted braces; parseFirstObject tolerates fences', () => {
  eq(firstBalancedObject('pre {"a":"}"} post'), '{"a":"}"}', 'brace in quotes ignored');
  eq(firstBalancedObject('no object'), '', 'none balances');
  const p = parseFirstObject('```json\n{"mutations":[]}\n```');
  assert(p && Array.isArray(p.mutations), 'fences stripped, object parsed');
});

/* M11: the M6 referee contract (cacheVerdict/verdictFor, d20 verdicts) is
 * REPLACED by the autonomous referee — the same fate-replay law now rides
 * the committed-fate timeline (state.refHistory) inside refereeStep. This
 * test keeps the law's smoke check; the full battery lives in
 * tests/harness/referee.mjs. */
test('committed fate: same words replay the verdict; new words roll fresh', async () => {
  eq(userMessageHash('I leap the fence'), userMessageHash('  i leap   the fence '), 'hash is wording-stable');
  const mkState = () => ({ sheet: { actors: {}, playerName: '' }, refHistory: [], turn: 1, mode: {} });
  const msg = { id: 'u1', role: 'user', pages: [{ text: 'I try to leap the fence' }], page: 0 };
  const callLLM = async () => JSON.stringify({ check: true, kind: 'task', action: 'leap the fence', tier: 'moderate', circumstance: 0 });
  const connection = { type: 'openai' };
  const first = await refereeStep({ connection, userText: 'I try to leap the fence', userId: 'u1', history: [msg], state: mkState(), settings: {}, callLLM });
  eq(first.status, 'ruled', 'a chancy attempt is ruled');
  assert(first.ruling && typeof first.ruling.directive === 'string' && first.ruling.directive.includes('The house has ruled'), 'the ruling speaks its name');
  let calls = 0;
  const spyLLM = async (...a) => { calls += 1; return callLLM(...a); };
  const replay = await refereeStep({ connection, userText: 'I try to leap the fence', userId: 'u1', history: [msg], state: first.state, settings: {}, callLLM: spyLLM });
  eq(replay.status, 'replayed', 'a swipe replays the committed verdict');
  eq(calls, 0, 'no re-roll — the referee is never re-asked');
  eq(replay.ruling.directive, first.ruling.directive, 'same ruling, word for word');
  const fresh = await refereeStep({ connection: null, userText: 'I try to climb the gate', userId: 'u2', history: [msg, { id: 'u2', role: 'user', pages: [{ text: 'I try to climb the gate' }], page: 0 }], state: replay.state, settings: {}, callLLM });
  eq(fresh.status, 'degraded', 'no connection degrades to nothing — never throws');
  eq(fresh.ruling, null, 'no ruling without the referee');
  assert((fresh.state.refHistory || []).length <= 12, 'the timeline is capped');
});

test('A5: workerSignal hands out an abortable signal with a releasable timer', async () => {
  const { signal, done } = workerSignal(25);
  assert(!signal.aborted, 'not yet aborted');
  await new Promise((r) => setTimeout(r, 45));
  assert(signal.aborted, 'the hard timeout fired');
  done();
  const { signal: s2, done: d2 } = workerSignal(60000);
  d2();
  assert(!s2.aborted, 'a settled worker is not aborted');
});

test('§5: the workers ledger records last run + why, per story', async () => {
  await noteWorkerRun('w-story', 'extractor', { ok: true });
  await noteWorkerRun('w-story', 'keeper', { ok: false, why: 'no answer' });
  const shelf = await loadWorkerStatus('w-story');
  assert(shelf.extractor && shelf.extractor.ok === true && Number.isFinite(shelf.extractor.at), 'ok run recorded');
  eq(shelf.keeper.why, 'no answer', 'the one-word why rides');
  await noteWorkerRun('w-story', 'not-a-worker', { ok: true });
  assert(!('not-a-worker' in await loadWorkerStatus('w-story')), 'unknown workers are refused');
});

test('B12: the three workers answer to three separate switches', () => {
  eq(workerPlan({ story: {}, settings: {} }).extraction, true, 'ledger defaults on');
  assert(workerPlan({ story: { extraction: false }, settings: {} }).keeper === true, 'keeper ungated by the ledger switch');
  assert(workerPlan({ story: { keeper: false }, settings: { memoryKeeper: true } }).keeper === false, 'per-story keeper off wins');
  assert(workerPlan({ story: { continuity: true }, settings: {} }).continuity === true, 'per-story reader on wins');
  assert(workerPlan({ story: {}, settings: { continuityCheck: true } }).continuity === true, 'house reader fallback');
});

test('modules: a rule of your own keeps its whenKey + note and wakes by them', async () => {
  await saveModule({ name: 'Test rule', text: 'rule text', pinned: false, whenKey: 'combat', note: 'a note' });
  const all = await listModules();
  const mod = all.find((m) => m.name === 'Test rule');
  assert(mod && mod.whenKey === 'combat' && mod.note === 'a note', 'whenKey + note persist');
  const quiet = selectModules(all, { mode: {}, present: [], relationships: {}, castNotes: '' });
  assert(!quiet.some((s) => s.mod.id === mod.id), 'quiet scene — the rule sleeps');
  const fight = selectModules(all, { mode: { combat: true }, present: [], relationships: {}, castNotes: '' });
  assert(fight.some((s) => s.mod.id === mod.id), 'a fight wakes it');
});
