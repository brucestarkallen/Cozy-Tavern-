/* M259 — the ledger bulletproof, the auditor the last line.
 *
 * The writer's standing order: the ledger tracks the whole moving world on
 * its own; the auditor sees ALL of the ledger and every page the record has
 * not folded, and only catches a rare slip — never the same thing twice.
 * Every law here RUNS the feature through a fake wire and reads back what was
 * sent or what was written. None of them reads source text. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { HOUSES, withHouse, thinkingHouse } from './thinkinghouse.mjs';
import { db } from '../../js/store.js';
import { emptyState, saveState, loadState, renderStateFacts } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { saveMemory } from '../../js/agents/memory.js';
import { auditLedger, buildAuditorMessages, auditLineWords } from '../../js/agents/auditor.js';
import { extractTurn } from '../../js/agents/extractor.js';
import { worldTurn } from '../../js/agents/world.js';
import { scribeTurn, parseScribeAnswer } from '../../js/agents/scribe.js';

const CONN = HOUSES[0].conn;

/* A wire that answers from a script, one answer per call (the last repeats),
 * with the finish reason the script names — so a CUT answer can be served. */
function scriptedHouse(answers) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url: String(url), body });
    const a = typeof answers === 'function' ? await answers(body) : answers[Math.min(calls.length - 1, answers.length - 1)];
    const text = typeof a === 'string' ? a : a.text;
    const finish = typeof a === 'string' ? 'stop' : (a.finish || 'stop');
    if (body.stream) {
      const lines = 'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n'
        + 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] }) + '\n\n'
        + 'data: [DONE]\n\n';
      const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(lines)); c.close(); } });
      return { ok: true, status: 200, headers: new Headers(), body: stream, async json() { return {}; }, async text() { return lines; }, clone() { return this; } };
    }
    const obj = { choices: [{ message: { role: 'assistant', content: text }, finish_reason: finish }] };
    return { ok: true, status: 200, headers: new Headers(), async json() { return obj; }, async text() { return JSON.stringify(obj); }, clone() { return this; } };
  };
  return { calls, fetch: fetchImpl };
}
const sentText = (call) => JSON.stringify(call.body);

const NAMES = ['Rias Wells', 'Aurora Sterling', 'Claire Stone', 'Mi-na Song', 'Vanessa Reynolds', 'Chloe Park', 'Caleb Thorne',
  'Alaric Stone', 'Lena Voss', 'Mira Hale', 'Tomas Reed', 'Ines Cole', 'Yuki Ito'];
function bigLedger() {
  let st = emptyState();
  st.sheet = { actors: {}, playerName: 'Jovan' };
  const muts = [{ type: 'place.set', name: 'the Wells kitchen' }, { type: 'clock.set', year: 2026, month: 3, day: 15, hour: 14, minute: 30 }];
  NAMES.forEach((n, i) => muts.push({ type: 'rel.set', name: n, p: 80 - i * 5, r: 10, s: 0, cause: 'the brief says ' + n + ' and Jovan are close' }));
  for (let i = 0; i < 8; i += 1) muts.push({ type: 'thread.set', title: 'Thread number ' + (i + 1) + ' about ' + NAMES[i], owner: NAMES[i], heat: 'hot', next: 'act ' + i });
  muts.push({ type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rias Wells', position: 'by the stove' });
  for (let i = 0; i < 9; i += 1) muts.push({ type: 'knowledge.add', name: 'Rias Wells', fact: 'distinct fact number ' + i + ' that she learned on page ' + i });
  st = applyMutations(st, muts).state;
  eq(Object.keys(st.relationships).length, 13, 'fixture: thirteen standings');
  eq(st.threads.length, 8, 'fixture: eight threads');
  eq(st.knowledge['Rias Wells'].length, 9, 'fixture: nine facts');
  return st;
}
const issuesAnswer = (issues) => JSON.stringify({ issues });

test('M259-1: the auditor is shown the WHOLE ledger — every standing, thread, fact, and the ground', async () => {
  const st = bigLedger();
  const a = buildAuditorMessages({ state: st, brief: 'b', castNotes: '', record: '', pages: [{ role: 'assistant', text: 'x' }] });
  for (const [i, n] of NAMES.entries()) assert(a.user.includes(n + ' — P:' + (80 - i * 5) + ' R:10 S:0'), 'standing shown with its numbers: ' + n);
  for (let i = 1; i <= 8; i += 1) assert(a.user.includes('"Thread number ' + i + ' about'), 'thread shown, title quoted: ' + i);
  for (let i = 0; i < 9; i += 1) assert(a.user.includes('distinct fact number ' + i + ' '), 'fact shown: ' + i);
  assert(a.user.includes('The ground: the Wells kitchen.'), 'the ground is shown');
  assert(a.user.includes('The hour: '), 'and the hour');
  /* the brief is the first authority — it was cut at 4,000 characters */
  const longBrief = 'Opening. ' + 'z'.repeat(9000) + ' BRIEF-TAIL-FACT';
  assert(buildAuditorMessages({ state: st, brief: longBrief, pages: [] }).user.includes('BRIEF-TAIL-FACT'), 'a long brief is read to its end');
});

test('M259-2: the auditor reads every page the record has not folded, each to its end, and the whole record', async () => {
  const storyId = 'm259-pages';
  const st = emptyState(); st.sheet = { actors: {}, playerName: 'Jovan' };
  await saveState(storyId, st);
  for (let i = 0; i < 40; i += 1) {
    let text = (i % 2 ? 'STORY PAGE ' : 'PLAYER PAGE ') + i;
    if (i === 5) text += ' MARK-FIVE';
    if (i === 13) text += ' MARK-THIRTEEN';
    if (i === 39) text += ' ' + 'x'.repeat(30000) + ' END-OF-PAGE-39';
    await db.messages.append(storyId, { role: i % 2 ? 'assistant' : 'user', text });
  }
  await saveMemory(storyId, { window: 20, nodes: [{ span: [0, 11], level: 1, text: 'RECORD-LINE for the first twelve pages', at: 1 }] });
  const house = scriptedHouse([issuesAnswer([])]);
  const r = await withHouse(house, () => auditLedger({ connection: CONN, storyId, brief: 'a brief', castNotes: '', stale: () => false }));
  eq(r && r.note, 'ok', 'the audit ran');
  const sent = sentText(house.calls[0]);
  assert(sent.includes('RECORD-LINE for the first twelve pages'), 'the record rides');
  assert(sent.includes('MARK-THIRTEEN'), 'a page past the record but older than the last ten is read (it was read by nobody)');
  assert(!sent.includes('MARK-FIVE'), 'a folded page is read through its record line, not twice');
  assert(sent.includes('END-OF-PAGE-39'), 'the newest page is read to its END — where the scene now stands');

  /* a record longer than the storyteller's 30,000 characters reaches the auditor whole */
  const longId = 'm259-longrecord';
  await saveState(longId, st);
  await db.messages.append(longId, { role: 'user', text: 'u' });
  await db.messages.append(longId, { role: 'assistant', text: 'a' });
  const nodes = Array.from({ length: 400 }, (_, i) => ({ id: 'L' + i, span: [i * 6, i * 6 + 5], text: '[Day ' + i + '] FOLDED-LINE-' + i + ' ' + 'x'.repeat(110), level: 1, at: i }));
  await saveMemory(longId, { window: 20, nodes });
  const lh = scriptedHouse([issuesAnswer([])]);
  await withHouse(lh, () => auditLedger({ connection: CONN, storyId: longId, stale: () => false }));
  const ls = sentText(lh.calls[0]);
  assert(ls.includes('FOLDED-LINE-0 ') && ls.includes('FOLDED-LINE-399 '), 'the whole record, ' + (400 * 130) + ' characters, first line and last');
});

test('M259-3: a finished loose end the auditor closes is closed (it was thrown away before it landed)', async () => {
  const storyId = 'm259-loose';
  let st = emptyState(); st.sheet = { actors: {}, playerName: 'Jovan' };
  st.characters = { Mira: { core: 'the innkeeper', state: '', arc: '', threads: ['she still owes the ferryman'], updatedAtTurn: 0 } };
  st = applyMutations(st, [{ type: 'presence.enter', name: 'Mira' }]).state;
  await saveState(storyId, st);
  await db.messages.append(storyId, { role: 'user', text: 'I watch her pay.' });
  await db.messages.append(storyId, { role: 'assistant', text: 'Mira hands the ferryman his coin at last; the debt is settled.' });
  const house = scriptedHouse([issuesAnswer([{ what: 'Mira’s loose end about the ferryman is answered', fix: 'closed', pages: false,
    mutations: [{ type: 'people.note', name: 'Mira', field: 'unthread', text: 'she still owes the ferryman money' }] }])]);
  const r = await withHouse(house, () => auditLedger({ connection: CONN, storyId, stale: () => false }));
  const after = await loadState(storyId);
  eq((after.characters.Mira.threads || []).length, 0, 'the loose end is gone from her page');
  eq(r.issues.length, 1, 'and the finding is reported');
  eq(r.issues[0].landed, 1, 'with its change landed');
  assert(auditLineWords(after.audit.issues[0]).text.startsWith('Set right:'), 'the drawer says set right');
  /* the other fields of people.note are still the page reader's */
  const house2 = scriptedHouse([issuesAnswer([{ what: 'her now line is stale', fix: 'x', pages: false,
    mutations: [{ type: 'people.note', name: 'Mira', field: 'state', text: 'at the dock' }] }])]);
  await withHouse(house2, () => auditLedger({ connection: CONN, storyId, stale: () => false }));
  assert(!/dock/.test((await loadState(storyId)).characters.Mira.state || ''), 'a "now" line is never the auditor’s');
});

test('M259-4: the report says what LANDED; a finding the ledger already held is not reported', async () => {
  const storyId = 'm259-landed';
  let st = emptyState(); st.sheet = { actors: {}, playerName: 'Jovan' };
  st = applyMutations(st, [
    { type: 'place.set', name: 'the Wells kitchen' },
    { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rias Wells' },
    { type: 'thread.set', title: 'Aurora and the letter', owner: 'Aurora', heat: 'hot' },
  ]).state;
  await saveState(storyId, st);
  await db.messages.append(storyId, { role: 'user', text: 'I read the letter aloud.' });
  await db.messages.append(storyId, { role: 'assistant', text: 'Rias listens from the stove while Jovan reads the letter aloud in the Wells kitchen.' });
  const house = scriptedHouse([issuesAnswer([
    { what: 'Caleb’s frame thread was resolved', fix: 'close it', pages: false, mutations: [{ type: 'thread.close', title: 'Caleb and the missing frame' }] },
    { what: 'the ground is not set', fix: 'the Wells kitchen', pages: false, mutations: [{ type: 'place.set', name: 'The Wells Kitchen' }] },
    { what: 'Rias heard the letter and has no knowledge line', fix: 'add it', pages: false, mutations: [{ type: 'knowledge.add', name: 'Rias Wells', fact: 'heard Jovan read the letter aloud' }] },
  ])]);
  const r = await withHouse(house, () => auditLedger({ connection: CONN, storyId, stale: () => false }));
  const after = await loadState(storyId);
  eq(after.audit.issues.length, 2, 'the phantom ground finding is not reported — the ledger already held it');
  const [refusedOne, realOne] = after.audit.issues;
  eq(refusedOne.landed, 0, 'the refused close landed nothing');
  assert(/no thread called/.test(refusedOne.refused[0]), 'and says why: ' + refusedOne.refused[0]);
  assert(auditLineWords(refusedOne).text.startsWith('Seen; its change did not hold'), 'the drawer does NOT say set right: ' + auditLineWords(refusedOne).text);
  eq(realOne.landed, 1, 'the real fix landed');
  assert(auditLineWords(realOne).text.startsWith('Set right:'), 'and says so');
  assert(!r.applied.some((a) => a.mutation.type === 'place.set'), 'no place was re-written');
  /* a run whose only changes were the house's own says what it changed */
  const { auditRunWords } = await import('../../js/agents/auditor.js');
  const words = auditRunWords({ issues: [], applied: [{ words: 'Rias Wells — restored from the brief.' }], rejected: [] });
  assert(!/true to the story/.test(words) && /set 1 right/.test(words), 'house-side changes are never hidden: ' + words);
  eq(auditRunWords({ issues: [], applied: [], rejected: [{ why: 'already so', same: true }] }), 'the ledger is true to the story', 'a clean run with only restatements is true');
  /* a report from before M259 reads as it always did */
  assert(auditLineWords({ what: 'old', fix: 'f', fixable: true }).text.startsWith('Set right:'), 'old reports keep their words');
});

test('M259-5: the auditor restores a zero standing but never moves one the pages moved', async () => {
  const storyId = 'm259-stand';
  let st = emptyState(); st.sheet = { actors: {}, playerName: 'Jovan' };
  st = applyMutations(st, [{ type: 'presence.enter', name: 'Jovan' }, { type: 'rel.set', name: 'Caleb Thorne', p: 20, cause: 'the brief says they were friends' }]).state;
  st = applyMutations(st, [{ type: 'rel.shift', name: 'Caleb Thorne', axis: 'p', delta: -15, cause: 'he lied to her about the photos' }]).state;
  eq(st.relationships['Caleb Thorne'].p, 5, 'fixture: the pages brought Caleb down to 5');
  await saveState(storyId, st);
  await db.messages.append(storyId, { role: 'user', text: 'I call Rias.' });
  await db.messages.append(storyId, { role: 'assistant', text: 'Rias answers on the first ring.' });
  const house = scriptedHouse([issuesAnswer([
    { what: 'Caleb’s standing is below the brief', fix: 'P:20', pages: false, mutations: [{ type: 'rel.set', name: 'Caleb Thorne', p: 20, cause: 'the brief says they are old friends' }] },
    { what: 'Rias has no standing though the brief makes her his devoted sister', fix: 'P:60', pages: false, mutations: [{ type: 'rel.set', name: 'Rias Wells', p: 60, r: 0, s: 0, cause: 'the brief says she is Jovan’s devoted sister' }] },
  ])]);
  await withHouse(house, () => auditLedger({ connection: CONN, storyId, brief: 'Rias Wells is Jovan’s devoted older sister. Caleb Thorne is an old friend.', stale: () => false }));
  const after = await loadState(storyId);
  eq(after.relationships['Caleb Thorne'].p, 5, 'the drop the pages earned stands');
  eq(after.relationships['Rias Wells'].p, 60, 'the missing bond is restored');
  eq(after.audit.issues[0].landed, 0, 'the refused raise is reported as not landed');
});

test('M259-6: the header line owns the ground and the hour — the auditor never overrides it', async () => {
  const storyId = 'm259-header';
  let st = emptyState(); st.sheet = { actors: {}, playerName: 'Jovan' };
  st = applyMutations(st, [{ type: 'place.set', name: 'Wells Gate' }, { type: 'clock.set', year: 2026, month: 3, day: 13, hour: 14, minute: 20 }, { type: 'presence.enter', name: 'Jovan' }]).state;
  const minutes = st.clock.minutes;
  await saveState(storyId, st);
  await db.messages.append(storyId, { role: 'user', text: 'I wait.' });
  await db.messages.append(storyId, { role: 'assistant', text: '[Wells Gate — Friday, March 13, 2026 | 14:20 | clear | hoodie | standing]\n\nJovan waits at the gate.' });
  const house = scriptedHouse([issuesAnswer([{ what: 'the ground and hour are wrong', fix: 'the Stone gate at 15:00', pages: false,
    mutations: [{ type: 'place.set', name: 'the Stone gate' }, { type: 'clock.set', year: 2026, month: 3, day: 13, hour: 15, minute: 0 }] }])]);
  await withHouse(house, () => auditLedger({ connection: CONN, storyId, stale: () => false }));
  const after = await loadState(storyId);
  eq(after.place.name, 'Wells Gate', 'the ground stays as the header wrote it');
  eq(after.clock.minutes, minutes, 'the hour stays as the header wrote it');
  eq(after.audit.issues.length, 0, 'and nothing is reported as set right');
});

test('M259-7: the extractor and the world agent receive the record, the whole ledger, and the page to its end', async () => {
  const st = bigLedger();
  const page = 'Start of the page. ' + 'y'.repeat(70000) + ' THE-END-OF-THE-PAGE';
  const house = thinkingHouse({ answer: '{"mutations":[{"type":"mode.snapshot","flags":[]}]}' });
  await withHouse(house, () => extractTurn({ connection: CONN, state: st, userText: 'I wait.', assistantText: page, founding: false, record: '- [Mar 1] REC-LINE-EXTRACTOR' }));
  const x = sentText(house.calls[0]);
  for (const probe of ['REC-LINE-EXTRACTOR', 'The ground: the Wells kitchen', 'Thread number 8 about', 'distinct fact number 0 ', 'Yuki Ito — P:20', 'THE-END-OF-THE-PAGE'])
    assert(x.includes(probe), 'the extractor is sent: ' + probe);

  const storyId = 'm259-world';
  await saveState(storyId, st);
  const wh = thinkingHouse({ answer: '{"mutations":[],"brief":{"pressure":[],"ripe":[],"twb":null,"voices":[]}}' });
  await withHouse(wh, () => worldTurn({ connection: CONN, storyId, userText: 'I wait.', assistantText: page, record: '- [Mar 1] REC-LINE-WORLD', stale: () => false }));
  const w = sentText(wh.calls[0]);
  for (const probe of ['REC-LINE-WORLD', 'Thread number 8 about', 'distinct fact number 0 ', 'THE-END-OF-THE-PAGE'])
    assert(w.includes(probe), 'the world agent is sent: ' + probe);
});

test('M259-8: a thread is found by sense, and only when one answers', async () => {
  let st = applyMutations(emptyState(), [
    { type: 'thread.set', title: 'Chloe’s clip of Jovan at the Wells house', owner: 'Chloe', heat: 'hot' },
    { type: 'thread.set', title: 'Aurora and the letter', owner: 'Aurora', heat: 'hot' },
  ]).state;
  const moved = applyMutations(st, [{ type: 'thread.set', title: "Chloe's clip of Jovan", next: 'post it tonight' }]);
  eq(moved.state.threads.length, 2, 'a reworded thread.set moves the thread, never opens a second copy');
  eq(moved.state.threads[0].title, 'Chloe’s clip of Jovan at the Wells house', 'and the ledger keeps its own title');
  eq(moved.state.threads[0].next, 'post it tonight', 'with the new next step');
  const closed = applyMutations(st, [{ type: 'thread.close', title: "Chloe's clip of Jovan" }]);
  eq(closed.applied.length, 1, 'a reworded close closes it');
  eq(closed.state.threads.map((t) => t.title).join('|'), 'Aurora and the letter', 'and only it');
  eq(applyMutations(st, [{ type: 'thread.close', title: 'Aurora and the ring' }]).applied.length, 0, 'a different thread is not closed');
  let two = applyMutations(emptyState(), [
    { type: 'thread.set', title: 'Aurora’s letter to Caleb', owner: 'Aurora' },
    { type: 'thread.set', title: 'Aurora’s letter to Jovan', owner: 'Aurora' },
  ]).state;
  eq(two.threads.length, 2, 'two different letters are two threads');
  eq(applyMutations(two, [{ type: 'thread.close', title: 'Aurora’s letter' }]).applied.length, 0, 'two that both answer match neither');
  const alike = applyMutations(emptyState(), [
    { type: 'thread.set', title: 'Rias and Jovan’s dinner', owner: 'Rias' },
    { type: 'thread.set', title: 'Rias wants Jovan’s number', owner: 'Rias' },
    { type: 'thread.set', title: 'Thread about Claire Stone', owner: 'Claire' },
    { type: 'thread.set', title: 'Thread about Alaric Stone', owner: 'Alaric' },
  ]).state;
  eq(alike.threads.length, 4, 'titles that merely share words stay apart');
  const names = applyMutations(emptyState(), [
    { type: 'thread.set', title: 'Rias and Jovan', owner: 'Rias' },
    { type: 'thread.set', title: 'Rias and Jovan’s first date', owner: 'Rias' },
  ]).state;
  eq(names.threads.length, 2, 'a title of names alone never swallows a longer thread those two are in');
  const namesAgain = applyMutations(names, [{ type: 'thread.set', title: 'Jovan and Rias', next: 'talk tonight' }]);
  eq(namesAgain.state.threads.length, 2, 'the same names in another order are the same thread');
  eq(namesAgain.state.threads[0].next, 'talk tonight', 'and it is that thread that moves');
});

test('M259-9: the scribe reads an answer thought out loud or cut short, and asks again once', async () => {
  eq(parseScribeAnswer('<think>{"deltas":[{"name":"Draft","field":"state","text":"a draft"}]}</think>{"deltas":[{"name":"Mira","field":"state","text":"at the bar"}]}').deltas.map((d) => d.name).join('|'), 'Mira', 'a draft inside the thinking is not the answer');
  eq(parseScribeAnswer('{"note":1} {"deltas":[{"name":"Mira","field":"state","text":"at the bar",},]}').deltas.length, 1, 'a stray object first and trailing commas are read past');
  eq(parseScribeAnswer('{"deltas":[{"name":"Mira","field":"state","text":"at the bar"},{"name":"Rias","field":"sta').deltas.length, 1, 'a cut list keeps what arrived whole');
  eq(parseScribeAnswer('nothing at all').deltas.length, 0, 'garbage is nothing');

  const storyId = 'm259-scribe';
  let st = emptyState(); st.sheet = { actors: {}, playerName: 'Jovan' };
  st.characters = { Mira: { core: 'the innkeeper', state: 'behind the bar', arc: '', threads: ['she still owes the ferryman'], updatedAtTurn: 0 } };
  st = applyMutations(st, [{ type: 'presence.enter', name: 'Mira' }]).state;
  await saveState(storyId, st);
  const house = scriptedHouse([
    { text: '{"deltas":[{"name":"Mira","field":"state","text":"at the ba', finish: 'length' },
    { text: '{"deltas":[{"name":"Mira","field":"state","text":"in the kitchen, at the stove"},{"name":"Mira","field":"unthread","text":"she still owes the ferryman"}]}', finish: 'stop' },
  ]);
  const r = await withHouse(house, () => scribeTurn({ connection: CONN, storyId, userText: 'I follow her.', assistantText: 'Mira pays the ferryman and goes to the stove.', stale: () => false }));
  eq(house.calls.length, 2, 'a cut answer is asked for again');
  eq(r.note, 'ok', 'and the second, whole answer is taken');
  const after = await loadState(storyId);
  eq(after.characters.Mira.state, 'in the kitchen, at the stove', 'her now line is written');
  eq((after.characters.Mira.threads || []).length, 0, 'and the answered loose end is closed');

  /* a house that never says "length" still cuts: the answer itself shows it */
  const quietCut = scriptedHouse([
    { text: '{"deltas":[{"name":"Mira","field":"arc","text":"she paid her debt"},{"name":"Mira","field":"sta', finish: 'stop' },
    { text: '{"deltas":[{"name":"Mira","field":"arc","text":"she paid her debt at last"}]}', finish: 'stop' },
  ]);
  const q = await withHouse(quietCut, () => scribeTurn({ connection: CONN, storyId, userText: 'u', assistantText: 'Mira smiles.', stale: () => false }));
  eq(quietCut.calls.length, 2, 'an answer that stops mid-list is asked for again');
  eq(q.note, 'ok', 'and the whole second answer is taken');
  /* a whole answer with trailing commas is whole — not asked twice */
  const commas = scriptedHouse(['{"deltas":[{"name":"Mira","field":"arc","text":"she laughs again"},],}']);
  const c = await withHouse(commas, () => scribeTurn({ connection: CONN, storyId, userText: 'u', assistantText: 'Mira laughs.', stale: () => false }));
  eq(commas.calls.length, 1, 'a whole answer with trailing commas is read once');
  eq(c.changes.length, 1, 'and written');
  const honest = scriptedHouse(['{"deltas":[]}']);
  await withHouse(honest, () => scribeTurn({ connection: CONN, storyId, userText: 'u', assistantText: 'a quiet page', stale: () => false }));
  eq(honest.calls.length, 1, 'an honest empty answer is not asked twice');
});

test('M259-10: a change that changes nothing is not a change', async () => {
  let st = applyMutations(emptyState(), [
    { type: 'place.set', name: 'the Wells kitchen' },
    { type: 'clock.set', year: 2026, month: 3, day: 15, hour: 14, minute: 30 },
    { type: 'presence.enter', name: 'Rias Wells', position: 'by the stove' },
    { type: 'rel.set', name: 'Rias Wells', p: 60, cause: 'the brief says' },
    { type: 'canon.lock', name: 'Rias Wells', key: 'hair', value: 'black' },
  ]).state;
  const cases = [
    [{ type: 'place.set', name: 'The Wells Kitchen' }, { type: 'place.set', name: 'the Wells gate' }],
    [{ type: 'clock.set', year: 2026, month: 3, day: 15, hour: 14, minute: 30 }, { type: 'clock.set', year: 2026, month: 3, day: 15, hour: 15, minute: 0 }],
    [{ type: 'presence.update', name: 'Rias Wells', position: 'by the stove' }, { type: 'presence.update', name: 'Rias Wells', position: 'at the window' }],
    [{ type: 'rel.set', name: 'Rias Wells', p: 60, cause: 'the brief says' }, { type: 'rel.set', name: 'Rias Wells', p: 70, cause: 'the brief says' }],
    [{ type: 'canon.lock', name: 'Rias Wells', key: 'hair', value: 'Black' }, { type: 'canon.lock', name: 'Rias Wells', key: 'hair', value: 'auburn' }],
  ];
  /* restating the ledger is not a refusal; a move written as an entrance is a move */
  const mcSame = applyMutations({ ...st, sheet: { actors: {}, playerName: 'Jovan' } }, [{ type: 'mc.set', name: 'jovan' }]);
  eq(mcSame.rejected[0] && mcSame.rejected[0].same, true, 'mc.set: the same main character is already so');
  const reEnter = applyMutations(st, [{ type: 'presence.enter', name: 'Rias Wells' }]);
  eq(reEnter.applied.length, 0, 'presence.enter: someone already here writes nothing');
  eq(reEnter.rejected[0] && reEnter.rejected[0].same, true, 'and it is already so, not a refusal');
  const moved = applyMutations(st, [{ type: 'presence.enter', name: 'Rias Wells', position: 'in the doorway' }]);
  eq(moved.applied.length, 1, 'presence.enter at a new spot for someone already here is written');
  eq(moved.state.present.find((p) => p.name === 'Rias Wells').position, 'in the doorway', 'as the move it is');
  eq(moved.state.present.filter((p) => p.name === 'Rias Wells').length, 1, 'never a second copy of her');
  const sameSpot = applyMutations(st, [{ type: 'presence.enter', name: 'Rias Wells', position: 'by the stove' }]);
  eq(sameSpot.rejected[0] && sameSpot.rejected[0].same, true, 'at the spot she already holds, it is already so');
  const { auditorScope } = await import('../../js/agents/auditor.js');
  eq(auditorScope([{ what: 'w', fix: 'f', mutations: [{ type: 'presence.enter', name: 'Rias Wells', position: 'in the doorway' }] }], st).length, 0,
    'the auditor cannot move someone by "entering" them');
  eq(auditorScope([{ what: 'w', fix: 'f', mutations: [{ type: 'presence.enter', name: 'Kim' }] }], st)[0].mutations.length, 1,
    'while bringing in someone who is not here still stands');
  for (const [same, changed] of cases) {
    const a = applyMutations(st, [same]);
    eq(a.applied.length, 0, same.type + ': the same value writes nothing');
    eq(a.rejected[0] && a.rejected[0].same, true, same.type + ': and is marked already so');
    const logBefore = (st.log || []).length;
    eq((a.state.log || []).length, logBefore, same.type + ': and logs nothing');
    const b = applyMutations(st, [changed]);
    eq(b.applied.length, 1, changed.type + ': a real change still lands');
  }
});

test('M259-11: the storyteller’s own ledger names the ground', async () => {
  const st = applyMutations(emptyState(), [{ type: 'place.set', name: 'the Wells kitchen' }]).state;
  assert(renderStateFacts(st).includes('The ground: the Wells kitchen.'), 'the ground rides with the hour');
  assert(!renderStateFacts(emptyState()).includes('The ground:'), 'and an unset ground adds nothing');
});

/* ---------- the second sweep: every other reader of a page ---------- */

test('M259-12: the record keeper folds every page of its batch to its end, and its auditor reads what it read', async () => {
  const { buildMemoryMessages, buildAuditMessages, passageOf } = await import('../../js/agents/memory.js');
  const pages = [];
  for (let i = 0; i < 10; i += 1) pages.push({ role: i % 2 ? 'assistant' : 'user', text: 'PAGE ' + i + ' opens. ' + 'w'.repeat(9000) + ' PAGE-' + i + '-ENDS' });
  const m = buildMemoryMessages(pages, { playerName: 'Jovan', record: '' });
  for (let i = 0; i < 10; i += 1) assert(m.user.includes('PAGE-' + i + '-ENDS'), 'page ' + i + ' is folded to its end (the last pages of a big batch were never folded)');
  const passage = passageOf(pages, 'Jovan');
  const a = buildAuditMessages(passage, 'a record line', 'OLDEST-LINE ' + 'r'.repeat(50000) + ' NEWEST-ESTABLISHED-LINE');
  for (let i = 0; i < 10; i += 1) assert(a.user.includes('PAGE-' + i + '-ENDS'), 'the detail auditor reads page ' + i + ' to its end');
  assert(a.user.includes('NEWEST-ESTABLISHED-LINE'), 'and is shown the NEWEST established lines, the ones a repeat would echo');
  /* a batch past the room shares it: each page keeps its end */
  const huge = Array.from({ length: 8 }, (_, i) => ({ role: 'assistant', text: 'H' + i + ' ' + 'z'.repeat(40000) + ' HUGE-' + i + '-ENDS' }));
  const hp = passageOf(huge, 'Jovan');
  for (let i = 0; i < 8; i += 1) assert(hp.includes('HUGE-' + i + '-ENDS'), 'an over-long batch still ends every page: ' + i);
  assert(hp.length < 140000, 'within the room: ' + hp.length);
});

test('M259-13: the mender is shown the whole page, and a mend that loses the ending is refused', async () => {
  const { mendPages } = await import('../../js/agents/continuity.js');
  const paras = [];
  for (let i = 0; i < 100; i += 1) paras.push('Paragraph ' + i + ' of the page, with Kenji at the counter and the rain outside.');
  const before = paras.join('\n') + '\nTHE LAST LINE OF THE PAGE.';
  assert(before.length > 7000, 'fixture: a page past the old 6,000 cut (' + before.length + ')');
  const run = async (answerText) => {
    const house = scriptedHouse([JSON.stringify([{ index: 0, text: answerText }])]);
    const written = [];
    const changed = await withHouse(house, () => mendPages({ connection: CONN, storyId: 'm259-mend', pages: [{ id: 'p1', role: 'assistant', text: before }],
      contradiction: 'Kenji should be Kaito', record: '', playerName: 'Jovan', apply: async (page, after) => { written.push(after); } }));
    return { house, changed, written };
  };
  /* what it handed back when it was shown 6,000 characters */
  const cut = await run(before.slice(0, 6000).replace('Kenji', 'Kaito'));
  assert(sentText(cut.house.calls[0]).includes('THE LAST LINE OF THE PAGE.'), 'the mender is sent the whole page');
  eq(cut.changed.length, 0, 'a "complete page" missing its last fifth is refused');
  eq(cut.written.length, 0, 'and nothing is written');
  /* a quieter loss: only the closing lines gone */
  const lines = before.split('\n');
  const quiet = await run(lines.slice(0, -3).join('\n').replace('Kenji', 'Kaito'));
  eq(quiet.changed.length, 0, 'a page that lost only its closing lines is refused');
  /* a mend that cuts a fifth from the MIDDLE keeps the ending and still loses the page */
  const middle = await run(lines.slice(0, 30).concat(lines.slice(52)).join('\n').replace('Kenji', 'Kaito'));
  eq(middle.changed.length, 0, 'a mend that drops a fifth of the page from its middle is refused');
  /* the true smallest edit still lands, ending and all */
  const good = await run(before.replace('Kenji', 'Kaito'));
  eq(good.changed.length, 1, 'the smallest edit lands');
  assert(good.written[0].endsWith('THE LAST LINE OF THE PAGE.'), 'with its ending');
  /* a mend that rewrites the closing line keeps the page and lands */
  const endEdit = await run(before.replace('THE LAST LINE OF THE PAGE.', 'THE LAST LINE OF THE PAGE, as Kaito left.'));
  eq(endEdit.changed.length, 1, 'an edit to the last line itself is still a mend');
  /* M259: the edit, not the page — a long page is mended by its own words */
  const swap = async (page, edits) => {
    const house = scriptedHouse([JSON.stringify(edits)]);
    const written = [];
    const changed = await withHouse(house, () => mendPages({ connection: CONN, storyId: 'm259-mend', pages: [{ id: 'p3', role: 'assistant', text: page }],
      contradiction: 'Kenji should be Kaito', record: '', playerName: 'Jovan', apply: async (pg, after) => { written.push(after); } }));
    return { house, changed, written };
  };
  const longPage = 'Kenji waits by the door. ' + 'A long line of the page that goes on.\n'.repeat(900) + 'Kenji leaves at last.\nTHE END OF THE LONG PAGE.';
  assert(longPage.length > 30000, 'fixture: a long page (' + longPage.length + ')');
  const one = await swap(longPage, [{ index: 0, find: 'Kenji waits by the door.', replace: 'Kaito waits by the door.' }, { index: 0, find: 'Kenji leaves at last.', replace: 'Kaito leaves at last.' }]);
  eq(one.changed.length, 1, 'a long page is mended by find and replace');
  eq(one.written[0], longPage.replace('Kenji waits', 'Kaito waits').replace('Kenji leaves', 'Kaito leaves'), 'exactly those words, the rest of the page untouched, ending and all');
  assert(sentText(one.house.calls[0]).includes('THE END OF THE LONG PAGE.'), 'the mender saw the whole long page');
  assert(one.house.calls[0].body.messages.map((mm) => String(mm.content || '')).join('\n').includes('"find":'), 'and was asked for the edit, not the page');
  const vague = await swap(longPage, [{ index: 0, find: 'A long line of the page', replace: 'A short line' }]);
  eq(vague.changed.length, 0, 'words that stand more than once are not a place to edit');
  const absent = await swap(longPage, [{ index: 0, find: 'Nobody wrote this', replace: 'x' }]);
  eq(absent.changed.length, 0, 'words the page does not hold change nothing');
  const gutted = await swap(before, [{ index: 0, find: lines.slice(10, 40).join('\n'), replace: '' }]);
  eq(gutted.changed.length, 0, 'an "edit" that cuts a third of the page is refused');
  const { parseMendAnswer } = await import('../../js/agents/continuity.js');
  eq(parseMendAnswer('Here [as asked]: [{"index":0,"find":"Kenji","replace":"Kaito"},]').length, 1, 'the list is found past a stray bracket, a trailing comma repaired');
});

test('M259-14: the referee’s and the director’s answers are read past thinking and a trailing comma', async () => {
  const { parseFirstObject } = await import('../../js/agents/jsonutil.js');
  eq(parseFirstObject('<think>maybe {"ok": "draft"}</think>{"ok": true, "text": "fine",}').ok, true, 'thinking skipped, trailing comma repaired');
  eq(parseFirstObject('{"scratch": 1} and then {"ok": false, "text": "x"}', (o) => 'ok' in o).ok, false, 'the object that answers is the one taken');
  eq(parseFirstObject('{"a": 1}').a, 1, 'a plain answer reads as before');
  eq(parseFirstObject('no json here'), null, 'no object is null');
  eq(parseFirstObject('[1, 2]'), null, 'an array is not an object');
  /* the director's watcher: the verdict is the object that carries "ok" */
  const { writeDirective } = await import('../../js/agents/director.js');
  const answers = ['A DRAFT DIRECTIVE', '<think>checking {"ok": true}</think>{"note": "reading it"} {"ok": false, "text": "THE WATCHER’S REWRITE"}'];
  const out = await writeDirective({ story: { brief: 'b' }, messages: [], state: emptyState(), mode: 'new', skipPolish: true,
    call: async () => ({ text: answers.shift() }) });
  eq(out.ok, true, 'the directive was written');
  eq(out.text, 'THE WATCHER’S REWRITE', 'the watcher’s verdict is read from the object that answers, past a note and the thinking');
});

test('M259-15: the standings rebuild and the ledger rebuild read the newest record and each page to its end', async () => {
  const { buildRebuildMessages } = await import('../../js/agents/auditor.js');
  const { buildReaderMessages } = await import('../../js/agents/rebuild.js');
  const record = 'OLDEST ' + 'r'.repeat(30000) + ' NEWEST-RECORD-LINE';
  const pages = [{ role: 'assistant', text: 'Opening. ' + 'q'.repeat(9000) + ' REBUILD-PAGE-END' }];
  const a = buildRebuildMessages({ state: emptyState(), brief: '', castNotes: '', record, pages, mc: 'Jovan' });
  assert(a.user.includes('NEWEST-RECORD-LINE'), 'the standings rebuild keeps the newest record (it kept the oldest 14,000)');
  assert(a.user.includes('REBUILD-PAGE-END'), 'and reads the page to its end');
  const b = buildReaderMessages({ state: emptyState(), record: 'x', pages, mc: 'Jovan' });
  assert(b.user.includes('REBUILD-PAGE-END'), 'the ledger rebuild reads the page to its end');
});

test('M259-16: the founder, the second reader and the director see the whole ledger and the page to its end', async () => {
  const { buildFounderMessages } = await import('../../js/agents/founder.js');
  const f = buildFounderMessages({ state: bigLedger(), brief: 'b' });
  for (const probe of ['The ground: the Wells kitchen', 'Thread number 8 about', 'distinct fact number 0 ', 'Yuki Ito — P:20'])
    assert(f.user.includes(probe), 'the founder sees what the ledger already says: ' + probe);

  const { checkTurn } = await import('../../js/agents/continuity.js');
  const page = 'Start. ' + 'y'.repeat(20000) + ' SECOND-READER-END';
  const house = scriptedHouse(['<think>{"findings":[{"words":"A DRAFT THOUGHT","severity":"warn"}]}</think>{"note": "reading"} {"findings":[{"words":"Kim is written here but the page says she left","severity":"warn","fix":"Kim is gone",},]}']);
  const r = await withHouse(house, () => checkTurn({ connection: CONN, state: bigLedger(), assistantText: page }));
  assert(sentText(house.calls[0]).includes('SECOND-READER-END'), 'the second reader reads the page to its end');
  eq(r.findings.length, 1, 'and its answer is read past the thinking, a stray object and trailing commas');
  eq(r.findings[0].words, 'Kim is written here but the page says she left', 'the answer, never the draft in the thinking');
  const { parseContinuityAnswer } = await import('../../js/agents/continuity.js');
  const direct = parseContinuityAnswer('<think>{"findings":[{"words":"A DRAFT THOUGHT","severity":"warn"}]}</think>{"findings":[{"words":"the real finding","severity":"note"}]}');
  eq(direct.findings.map((f) => f.words).join('|'), 'the real finding', 'raw text with the thinking inline: the answer, never the draft');

  const { saveDirector, directorStatus } = await import('../../js/agents/director.js');
  const sid = 'm259-director';
  await saveDirector(sid, { text: 'the secret episode', episode: 1 });
  await db.messages.append(sid, { role: 'user', text: 'I go on.' });
  await db.messages.append(sid, { role: 'assistant', text: 'Opening. ' + 'd'.repeat(9000) + ' DIRECTOR-PAGE-END' });
  const asked = [];
  const out = await directorStatus({ connection: CONN, storyId: sid, call: async (req) => { asked.push(req); return { text: 'it stands midway' }; } });
  eq(out.ok, true, 'the director answered');
  assert(JSON.stringify(asked[0]).includes('DIRECTOR-PAGE-END'), 'the director reads the latest page to its end');
  const { directorIdeas } = await import('../../js/agents/director.js');
  const askedIdeas = [];
  await directorIdeas({ connection: CONN, storyId: sid, story: { brief: 'b' }, call: async (req) => { askedIdeas.push(req); return { text: '1. a\n2. b\n3. c' }; } });
  assert(askedIdeas.length && JSON.stringify(askedIdeas[0]).includes('DIRECTOR-PAGE-END'), 'and so do its three doors');

  const { scribeTurn } = await import('../../js/agents/scribe.js');
  const sh = scriptedHouse(['{"deltas":[]}']);
  const s2 = emptyState(); s2.sheet = { actors: {}, playerName: 'Jovan' };
  await saveState('m259-scribe-end', s2);
  await withHouse(sh, () => scribeTurn({ connection: CONN, storyId: 'm259-scribe-end', userText: 'u', assistantText: page, stale: () => false }));
  assert(sentText(sh.calls[0]).includes('SECOND-READER-END'), 'the scribe reads the page to its end');
});

test('M259-17: a long reading gets a longer leash, and every call in the page chain gets its own minute', async () => {
  const { workerSignal } = await import('../../js/agents/status.js');
  const { chainJob } = await import('../../js/agents/queue.js');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const w = workerSignal(40);
  w.renew(260);
  await sleep(130);
  eq(w.signal.aborted, false, 'a longer leash holds past the default');
  await sleep(260);
  eq(w.signal.aborted, true, 'and still cuts a hung call off');
  w.done();
  const w2 = workerSignal(60);
  await sleep(30); w2.renew(); await sleep(45);
  eq(w2.signal.aborted, false, 'a plain renew is a fresh default leash');
  w2.done();

  /* the chain hands the leash to its workers, and keeps both staleness tests */
  let newer = false;
  const seen = {};
  const leash = () => true;
  const wrapped = chainJob(async (args) => { seen.renew = args.renew; seen.before = args.stale(); newer = true; seen.after = args.stale(); return 'done'; }, () => newer);
  eq(await wrapped({ signal: null, stale: () => false, renew: leash }), 'done', 'the job runs');
  eq(seen.renew, leash, 'the worker is handed the leash');
  eq(seen.before, false, 'fresh while the chain is current');
  eq(seen.after, true, 'stale once a newer chain starts');
  const wrapped2 = chainJob(async (args) => args.stale(), () => false);
  eq(await wrapped2({ stale: () => true }), true, 'stale when the queue says so');

  /* the auditor asks for a leash that fits what it reads, and a fresh minute for its second question */
  const leashes = [];
  const house = scriptedHouse([issuesAnswer([])]);
  await withHouse(house, () => auditLedger({ connection: CONN, storyId: 'm259-pages', stale: () => false, renew: (ms) => { leashes.push(ms); return true; } }));
  const size = house.calls[0].body.messages.reduce((n, m) => n + String(m.content || '').length, 0);
  assert(leashes[0] > 60000 + 5000, 'longer than a minute for a big reading: ' + leashes[0]);
  assert(Math.abs(leashes[0] - (60000 + Math.ceil(size / 4000) * 1000)) <= 3000, 'scaled to what it was handed: ' + leashes[0] + ' for ' + size);
  assert(leashes.slice(1).includes(undefined), 'a fresh minute before the brief’s digits are read');

  /* the extractor, the world agent and the scribe renew before every call */
  const count = { n: 0 };
  const tick = () => { count.n += 1; return true; };
  const eh = thinkingHouse({ answer: '{"mutations":[]}' });
  await withHouse(eh, () => extractTurn({ connection: CONN, state: bigLedger(), userText: 'u', assistantText: 'a page', founding: false, renew: tick }));
  eq(count.n, eh.calls.length, 'the extractor: one minute per call (' + eh.calls.length + ')');
  count.n = 0;
  await saveState('m259-renew', bigLedger());
  const wh = thinkingHouse({ answer: 'not json at all' });
  await withHouse(wh, () => worldTurn({ connection: CONN, storyId: 'm259-renew', userText: 'u', assistantText: 'a page', stale: () => false, renew: tick }).catch(() => null));
  eq(count.n, wh.calls.length, 'the world agent: one minute per call (' + wh.calls.length + ')');
  count.n = 0;
  const sh = scriptedHouse([{ text: '{"deltas":[{"name":"Rias Wells","field":"state","text":"at the sto', finish: 'length' }, '{"deltas":[]}']);
  await withHouse(sh, () => scribeTurn({ connection: CONN, storyId: 'm259-renew', userText: 'u', assistantText: 'a page', stale: () => false, renew: tick }));
  eq(sh.calls.length, 2, 'fixture: the scribe asked twice');
  eq(count.n, 2, 'the scribe: one minute per call');
});

/* ---------- looking: the view that fits, and anything else on request ---------- */

async function lookingStory(storyId) {
  const st = emptyState(); st.sheet = { actors: {}, playerName: 'Jovan' };
  st.present = [{ name: 'Jovan' }, { name: 'Rias Wells' }];
  await saveState(storyId, st);
  const ids = [];
  for (let i = 0; i < 30; i += 1) {
    let text;
    if (i % 2 === 0) text = 'PLAYER PAGE ' + (i + 1) + ': I keep going.';
    else text = 'STORY PAGE ' + (i + 1) + ' opens. ' + 'q'.repeat(20000) + ' STORY-PAGE-' + (i + 1) + '-ENDS';
    if (i === 2) text += ' The SILVER-KEY was hidden under the stair.';
    if (i === 9) text = text.replace(' opens.', ' opens. ' + 'w'.repeat(400) + ' Rias learned THE-OLD-FACT: Caleb sold the photos.');
    if (i === 27) text += ' Jovan turned the SILVER-KEY over in his hand.';
    const m = await db.messages.append(storyId, { role: i % 2 ? 'assistant' : 'user', text });
    ids.push(m.id);
  }
  await saveMemory(storyId, { window: 20, nodes: [{ id: 'node-foldA1', span: [0, 5], level: 1, text: 'FOLDED-LINE for the first six pages', at: 1 }] });
  return ids;
}
const bodyText = (call) => call.body.messages.map((mm) => String(mm.content || '')).join('\n');

test('M259-18: the auditor is shown what fits, looks for the rest, and a reading is never spent on looking', async () => {
  const storyId = 'm259-look';
  await lookingStory(storyId);
  const longBrief = 'The brief opens. ' + 'b'.repeat(45000) + ' BRIEF-FAR-TAIL: Rias owns the lake house.';
  const house = scriptedHouse([
    '<fetch>["10", "3", "find: SILVER-KEY", "brief"]</fetch>',
    issuesAnswer([{ what: 'Rias witnessed Caleb’s sale on page 10 and has no line for it', fix: 'add it', pages: false,
      mutations: [{ type: 'knowledge.add', name: 'Rias Wells', fact: 'that Caleb sold the photos' }] }]),
  ]);
  /* a small house, so not every unfolded page fits and the index is used */
  const r = await withHouse(house, () => auditLedger({ connection: { ...CONN, contextSize: 70000 }, storyId, brief: longBrief, stale: () => false }));
  const first = bodyText(house.calls[0]);
  assert(first.includes('STORY-PAGE-30-ENDS'), 'the present page is shown to its end');
  assert(!first.includes('THE-OLD-FACT'), 'an older unfolded page past the view is not shown whole…');
  assert(/\np10 #[0-9a-f]{6} the storyteller — STORY PAGE 10 opens\./.test(first), '…it stands in the index, by number: ' + (first.match(/\np10[^\n]*/) || [''])[0].slice(0, 80));
  assert(first.includes('[pages 1–6] FOLDED-LINE'), 'a record line names the pages it covers');
  assert(first.includes('fetch "brief" for all of it') && !first.includes('BRIEF-FAR-TAIL'), 'the brief past its view says so');
  assert(first.includes('YOU CAN LOOK'), 'and the auditor is told it may look');
  const second = bodyText(house.calls[1]);
  assert(second.includes('THE-OLD-FACT'), 'the page it asked for is served whole');
  assert(second.includes('STORY PAGE 4 opens') === false && second.includes('SILVER-KEY was hidden'), 'a FOLDED page is served by its number too');
  assert(/\[find: SILVER-KEY\] 2 pages/.test(second) && /p28 /.test(second) && /p3 /.test(second), 'the search names every page that holds the words, by number');
  assert(second.includes('BRIEF-FAR-TAIL'), 'the whole brief is served');
  assert(house.calls[1].body.messages.some((mm) => mm.role === 'assistant' && /<fetch>\["10"/.test(String(mm.content))), 'its own fetch rides in the conversation');
  const after = await loadState(storyId);
  assert((after.knowledge['Rias Wells'] || []).some((k) => /Caleb sold the photos/.test(k.fact)), 'what it found by looking lands');
  eq(r.looked.join('|'), '10|3|find: SILVER-KEY|brief', 'the reading says what it looked at');
  const { auditRunWords } = await import('../../js/agents/auditor.js');
  assert(/\(looked at: 2 pages; searched “SILVER-KEY”; the brief\)/.test(auditRunWords(r)), 'and the workers line says so: ' + auditRunWords(r));

  /* a connection with no room left is shown the present page alone — never every page */
  const { auditView } = await import('../../js/agents/auditor.js');
  const list = (await db.messages.list(storyId)).filter((m) => !m.hidden);
  for (const budget of [0, -5000]) {
    const v = auditView(list, 6, budget);
    eq(v.shown.map((p) => p.ordinal).join(','), '30', 'budget ' + budget + ': only the present page is shown');
    eq(v.index.length, 23, 'and every other unfolded page stands in the index');
  }

  /* an auditor that only ever fetches is told once to answer, and never comes back as a bare fetch */
  const greedy = scriptedHouse(['<fetch>["12"]</fetch>']);
  const g = await withHouse(greedy, () => auditLedger({ connection: CONN, storyId, stale: () => false }));
  assert(greedy.calls.length <= 6, 'looking is bounded: ' + greedy.calls.length + ' calls');
  assert(greedy.calls.some((c) => /no more <fetch>/.test(bodyText(c))), 'it was told to answer now');
  eq(g.note, 'unusable', 'a reading spent on looking is reported as unusable, never as a finding');
  eq(g.applied.length, 0, 'and writes nothing');
});

test('M259-19: the extractor and the world agent look for what the page leans on', async () => {
  const storyId = 'm259-look2';
  await lookingStory(storyId);
  const st = await loadState(storyId);
  const house = scriptedHouse([
    '<fetch>["10"]</fetch>',
    '{"mutations":[{"type":"knowledge.add","name":"Rias Wells","fact":"that Caleb sold the photos"},{"type":"mode.snapshot","flags":[]}]}',
  ]);
  const ticks = [];
  const out = await withHouse(house, () => extractTurn({ connection: CONN, state: st, userText: 'I ask Rias about it.', assistantText: 'Rias remembers what she learned.',
    founding: false, storyId, pageNumber: 30, renew: () => { ticks.push(1); return true; } }));
  assert(house.calls[0].body.messages.some((mm) => mm.role === 'system' && /YOU CAN LOOK/.test(mm.content)) || /YOU CAN LOOK/.test(JSON.stringify(house.calls[0].body)), 'the extractor is told it may look');
  assert(bodyText(house.calls[0]).includes('page 30 of the story'), 'and which page it is reading');
  assert(bodyText(house.calls[1]).includes('THE-OLD-FACT'), 'the page it asked for is served whole');
  assert(out.mutations.some((m) => m.type === 'knowledge.add' && /Caleb sold/.test(m.fact)), 'and its reading uses it');
  eq(ticks.length, house.calls.length, 'every call got its own minute');

  const greedy = scriptedHouse(['<fetch>["4"]</fetch>']);
  await withHouse(greedy, () => extractTurn({ connection: CONN, state: st, userText: 'u', assistantText: 'a page', founding: false, storyId, pageNumber: 30 }));
  assert(greedy.calls.length <= 5, 'the extractor’s looking is bounded: ' + greedy.calls.length);

  const wh = scriptedHouse([
    '<fetch>["find: SILVER-KEY"]</fetch>',
    '{"mutations":[],"brief":{"pressure":["the key under the stair"],"ripe":[],"twb":null,"voices":[]}}',
  ]);
  const w = await withHouse(wh, () => worldTurn({ connection: CONN, storyId, userText: 'u', assistantText: 'Jovan holds the key.', pageNumber: 30, stale: () => false }));
  assert(/YOU CAN LOOK/.test(JSON.stringify(wh.calls[0].body)), 'the world agent is told it may look');
  assert(/\[find: SILVER-KEY\] 2 pages/.test(bodyText(wh.calls[1])), 'and its search is answered');
  assert(w && w.note !== 'unusable', 'and its answer is read after the look');
});

test('M259-20: one server for everyone who looks — search, the brief, and a round that would overflow', async () => {
  const { parseFetchRefs, serveFetch, findInPages } = await import('../../js/agents/housekeeper.js');
  eq(parseFetchRefs('["12", "#a1b2c3", "find: Caleb Thorne", "brief", "cast", "rule: The Prose", "nonsense words"]').join('|'), '12|#a1b2c3|find: Caleb Thorne|brief|cast|rule: The Prose', 'the refs everyone may use');
  const pages = [
    { id: 'aaaa01', role: 'user', text: 'I ask about Caleb.' },
    { id: 'aaaa02', role: 'assistant', text: 'Caleb Thorne left early.' },
    { id: 'aaaa03', role: 'assistant', text: 'Nobody mentions him.', hidden: true },
    { id: 'aaaa04', role: 'assistant', text: 'Thorne, Caleb — the name on the envelope.' },
  ];
  const found = findInPages(pages, 'Caleb Thorne');
  assert(/2 pages/.test(found) && /\np3 #aaaa04/.test(found) && /\np2 #aaaa02/.test(found), 'the exact words, then every word of them, by visible number: ' + found);
  assert(!/aaaa03/.test(found), 'a hidden page is not searched');
  assert(/no page holds/.test(findInPages(pages, 'the lighthouse')), 'nothing found says so');
  const brief = serveFetch(['brief', 'cast'], pages, { story: { brief: 'THE WHOLE BRIEF', castNotes: '' } });
  assert(/\[the brief\] \(15 chars, COMPLETE\)\nTHE WHOLE BRIEF/.test(brief) && /There are no cast notes written/.test(brief), brief);
  const big = [{ id: 'bbbb01', role: 'assistant', text: 'x'.repeat(9000) }, { id: 'bbbb02', role: 'assistant', text: 'y'.repeat(9000) }];
  const tight = serveFetch(['1', '2'], big, { room: 12000 });
  assert(tight.includes('x'.repeat(9000)) && !tight.includes('y'.repeat(9000)), 'a round stops before it overflows the reader');
  assert(/Not served this round — no room for them all \(ask again for fewer\): 2/.test(tight), 'and names what it could not serve');

  const { askWithFetch } = await import('../../js/agents/lookup.js');
  const both = scriptedHouse(['{"issues":[]} <fetch>["1"]</fetch>']);
  const b = await withHouse(both, () => askWithFetch(CONN, { system: 's', user: 'u', maxTokens: 100, isAnswer: (t) => /"issues"/.test(t), source: { messages: big } }));
  eq(both.calls.length, 1, 'a final answer is never held up by a stray fetch');
  assert(/"issues"/.test(b.text), 'and is returned as it came');
  const garbled = scriptedHouse(['<fetch>page ten please</fetch>', '{"issues":[]}']);
  await withHouse(garbled, () => askWithFetch(CONN, { system: 's', user: 'u', maxTokens: 100, isAnswer: (t) => /"issues"/.test(t), source: { messages: big } }));
  eq(garbled.calls.length, 2, 'an unreadable fetch is answered once, plainly');
  assert(/could not be read/.test(bodyText(garbled.calls[1])), 'with how to ask');
});

/* ---------- M261: one story so far, and a ledger that does not go stale ---------- */

test('M259-21: the extractor and the world agent read the story so far whole, with room left to look; the housekeeper sees the whole ledger', async () => {
  const before = [];
  for (let i = 1; i <= 12; i += 1) before.push({ role: i % 2 ? 'user' : 'assistant', text: 'CONTEXT PAGE ' + i + ' ' + 'c'.repeat(i % 2 ? 50 : 9000) + ' END-' + i, number: i });
  const st = bigLedger();
  const eh = thinkingHouse({ answer: '{"mutations":[{"type":"mode.snapshot","flags":[]}]}' });
  await withHouse(eh, () => extractTurn({ connection: CONN, state: st, userText: 'u', assistantText: 'The new page.', founding: false, before, pageNumber: 13 }));
  const sent = bodyText(eh.calls[0]);
  const ends = (text, i) => new RegExp('END-' + i + '(?!\\d)').test(text);
  for (let i = 1; i <= 12; i += 1) assert(ends(sent, i), 'the extractor reads page ' + i + ' whole');
  assert(/ALREADY READ/.test(sent) && /ONLY THE NEW PAGE IS NEWS/.test(sent), 'and is told the pages before are not news');

  /* a small house: the newest fit, the rest stand by number, and room is kept for looking */
  const small = { ...CONN, contextSize: 20000 };
  const sh = thinkingHouse({ answer: '{"mutations":[{"type":"mode.snapshot","flags":[]}]}' });
  await withHouse(sh, () => extractTurn({ connection: small, state: emptyState(), userText: 'u', assistantText: 'The new page.', founding: false, before, pageNumber: 13 }));
  const ss = bodyText(sh.calls[0]);
  assert(ends(ss, 12) && !ends(ss, 2), 'the newest pages whole, the oldest not');
  assert(/p2 The storyteller — CONTEXT PAGE 2/.test(ss), 'the oldest stand in the index by number');
  const { roomChars, LOOK_RESERVE } = await import('../../js/agents/lookup.js');
  const size = sh.calls[0].body.messages.reduce((n, mm) => n + String(mm.content || '').length, 0);
  assert(size <= roomChars(small, 4000) * 0.7 + 2000, 'the view leaves room to look — at most 70% of the room: ' + size + ' of ' + roomChars(small, 4000));
  eq(LOOK_RESERVE, 0.3, 'three tenths of every room are kept for looking');

  const storyId = 'm259-world-window';
  await saveState(storyId, bigLedger());
  const wh = thinkingHouse({ answer: '{"mutations":[],"brief":{"pressure":[],"ripe":[],"twb":null,"voices":[]}}' });
  await withHouse(wh, () => worldTurn({ connection: CONN, storyId, userText: 'u', assistantText: 'The new page.', before, pageNumber: 13, stale: () => false }));
  const ws = bodyText(wh.calls[0]);
  for (let i = 1; i <= 12; i += 1) assert(ends(ws, i), 'the world agent reads page ' + i + ' whole');

  const { buildHousekeeperContext } = await import('../../js/agents/housekeeper.js');
  const hk = buildHousekeeperContext({ story: { title: 't', brief: 'b' }, messages: [], state: bigLedger(), modules: [], lore: [], memory: null, session: null, contextPages: 12 });
  for (const [i, n] of NAMES.entries()) assert(hk.includes(n + ' — P:' + (80 - i * 5)), 'the housekeeper sees every standing: ' + n);
  assert(hk.includes('Thread number 8 about') && hk.includes('distinct fact number 0 ') && hk.includes('The ground: the Wells kitchen.'), 'every thread, every fact, and the ground');
});

test('M259-22: nothing in the ledger goes stale by itself — the ground, the threads, the beats', async () => {
  const { undoLast } = await import('../../js/engine/apply.js');
  let st = applyMutations(emptyState(), [
    { type: 'place.set', name: 'The Wells Residence' },
    { type: 'presence.enter', name: 'Rias Wells', position: 'by the stove', attire: 'apron' },
    { type: 'presence.enter', name: 'Jovan', position: 'at the table' },
  ]).state;
  const same = applyMutations(st, [{ type: 'place.set', name: 'wells residence' }]);
  eq(same.rejected[0] && same.rejected[0].same, true, '"The Wells Residence" and "wells residence" are one place');
  eq(same.state.present[0].position, 'by the stove', 'and nobody\'s position moves');
  const moved = applyMutations(st, [{ type: 'place.set', name: 'the garden' }, { type: 'presence.update', name: 'Jovan', position: 'on the bench' }]);
  eq(moved.state.present.find((p) => p.name === 'Rias Wells').position, undefined, 'the ground moving lets "by the stove" go');
  eq(moved.state.present.find((p) => p.name === 'Rias Wells').attire, 'apron', 'dress stays');
  eq(moved.state.present.find((p) => p.name === 'Jovan').position, 'on the bench', 'and the page\'s own positions are written after it');
  const onlyMove = applyMutations(st, [{ type: 'place.set', name: 'the garden' }]).state;
  const back = undoLast(onlyMove);
  eq(JSON.stringify(back.state.present), JSON.stringify(st.present), 'a take-back puts every position back, exactly');
  eq(back.state.place.name, 'The Wells Residence', 'and the ground');

  const { threadHousekeeping, THREAD_COOL_PAGES } = await import('../../js/engine/world.js');
  const threads = [
    { title: 'Old promise of the lake trip', owner: 'Rias', heat: 'hot', atTurn: 2 },
    { title: 'Fresh quarrel', owner: 'Jovan', heat: 'hot', atTurn: 20 },
    { title: 'Already cold', heat: 'cold', atTurn: 1 },
    { title: 'Old but moved on this page', heat: 'hot', atTurn: 1 },
  ];
  const now = 2 + THREAD_COOL_PAGES;
  const cool = threadHousekeeping(threads, now, ['old but moved on this page']);
  eq(cool.map((m) => m.title + ':' + m.heat).join('|'), 'Old promise of the lake trip:cold', 'only a hot thread untouched for ' + THREAD_COOL_PAGES + ' pages cools — never one this page moves');
  eq(threadHousekeeping(threads, now - 1, []).length, 1, 'one page short of the age, the lake trip stays hot (the other old one is spared by nobody here)');
  let ts = applyMutations(emptyState(), [{ type: 'thread.set', title: 'Old promise of the lake trip', owner: 'Rias', heat: 'hot' }]).state;
  ts = { ...ts, page: 40 };
  const cooled = applyMutations(ts, threadHousekeeping(ts.threads, 41, []));
  eq(cooled.state.threads[0].heat, 'cold', 'applied, it goes cold and stays on the list');

  let rs = applyMutations(emptyState(), [{ type: 'rel.shift', name: 'Caleb', axis: 'p', delta: 5, cause: 'he brought her coffee at dawn' }]).state;
  const again = applyMutations(rs, [{ type: 'rel.shift', name: 'Caleb', axis: 'p', delta: 5, cause: 'At dawn he brought her coffee.' }]);
  eq(again.rejected[0] && again.rejected[0].same, true, 'the same beat in other order is already counted');
  eq(again.state.relationships.Caleb.p, 5, 'and the standing does not move twice');
  eq(applyMutations(rs, [{ type: 'rel.shift', name: 'Caleb', axis: 'p', delta: 5, cause: 'he stood up for her in front of Vanessa' }]).applied.length, 1, 'a new beat counts');
  eq(applyMutations(rs, [{ type: 'rel.shift', name: 'Caleb', axis: 'p', delta: -5, cause: 'he brought her coffee at dawn' }]).applied.length, 1, 'the same words the other way is a different beat');
  rs = applyMutations(emptyState(), [{ type: 'rel.shift', name: 'Aurora', axis: 'p', delta: 3, cause: 'she lent him 20 dollars' }]).state;
  eq(applyMutations(rs, [{ type: 'rel.shift', name: 'Aurora', axis: 'p', delta: 3, cause: 'she lent him 50 dollars' }]).applied.length, 1, 'a figure is never noise');
});

test('M259-23: the ledger is kept on a page the auditor does not read', async () => {
  const { ledgerUpkeep } = await import('../../js/agents/auditor.js');
  const storyId = 'm259-upkeep';
  let st = emptyState(); st.sheet = { actors: {}, playerName: 'Jovan' };
  st.characters = {
    'Old Passerby': { core: 'a cab driver', state: '', arc: '', threads: [], updatedAtTurn: 0 },
    'Rias Wells': { core: 'his sister', state: '', arc: '', threads: [], updatedAtTurn: 0 },
  };
  st = applyMutations(st, [
    { type: 'presence.enter', name: 'Jovan' },
    { type: 'rel.set', name: 'Rias Wells', p: 60, cause: 'the brief says she is his sister' },
    { type: 'offscreen.set', name: 'Cab Driver', location: 'the rank', activity: 'waiting for fares', stance: 'busy' },
  ]).state;
  st.offscreen['Cab Driver'].atTurn = 0;
  st = { ...st, page: 50 };
  await saveState(storyId, st);
  await db.messages.append(storyId, { role: 'user', text: 'I walk home.' });
  await db.messages.append(storyId, { role: 'assistant', text: 'Jovan walks home alone through the rain.' });
  const r = await ledgerUpkeep({ storyId, brief: 'Jovan and his sister.', castNotes: '' });
  const after = await loadState(storyId);
  eq(Boolean(after.characters['Old Passerby'].retired), true, 'one who passed through long ago retires');
  eq(Boolean(after.characters['Rias Wells'].retired), false, 'one with a bond stays');
  eq(Boolean(after.offscreen['Cab Driver']), false, 'a seat nothing carries is cleared');
  assert(r.applied.length >= 2 && after.log.some((l) => /Old Passerby/.test(l.words)), 'and each change is in the log, with its take-back');
  const again = await ledgerUpkeep({ storyId, brief: 'Jovan and his sister.' });
  eq(again.applied.length, 0, 'a kept ledger needs nothing the next time');
});

/* ---------- M262: the house heals what the old readers left ---------- */

test('M259-24: the lines the old keeper read in part are found and read again, whole', async () => {
  const { partlyReadLines, redoLine, loadMemory } = await import('../../js/agents/memory.js');
  const msgs = [
    { id: 'a1', role: 'user', text: 'short' }, { id: 'a2', role: 'assistant', text: 'x'.repeat(9000) + ' LONG-END' },
    { id: 'a3', role: 'user', text: 'short' }, { id: 'a4', role: 'assistant', text: 'a short page' },
  ];
  const mem = { window: 20, nodes: [
    { id: 'L1', span: [0, 1], level: 1, text: 'a line over a long page', at: 1 },
    { id: 'L2', span: [2, 3], level: 1, text: 'a line over short pages', at: 2 },
    { id: 'L3', span: [0, 1], level: 1, text: 'already read whole', at: 3, whole: true },
    { id: 'L4', span: [0, 1], level: 1, text: 'tried three times', at: 4, healTries: 3 },
  ] };
  eq(partlyReadLines(mem, msgs).join('|'), 'L1', 'only a line over a page past the old cut, never marked whole, not given up on');
  const big = Array.from({ length: 6 }, (_, i) => ({ id: 'b' + i, role: i % 2 ? 'assistant' : 'user', text: 'y'.repeat(5000) }));
  eq(partlyReadLines({ nodes: [{ id: 'B1', span: [0, 5], level: 1, text: 't', at: 1 }] }, big).join('|'), 'B1', 'and a line over a batch past the old cut');

  const sid = 'm259-heal-record';
  for (const m of msgs) await db.messages.append(sid, { role: m.role, text: m.text });
  await saveMemory(sid, { window: 20, nodes: [{ id: 'L1', span: [0, 1], level: 1, text: 'a line over a long page', at: 1 }] });
  const house = scriptedHouse(['Jovan waited; the long page ended at LONG-END.', 'NONE']);
  const r = await withHouse(house, () => redoLine({ connection: CONN, storyId: sid, nodeId: 'L1' }));
  eq(r.ok, true, 'the line is read again');
  assert(bodyText(house.calls[0]).includes('LONG-END'), 'from the whole page');
  const after = await loadMemory(sid);
  eq(after.nodes[0].whole, true, 'and marked whole');
  assert(/LONG-END/.test(after.nodes[0].text), 'with what the page\u2019s end held');
  eq(partlyReadLines(after, await db.messages.list(sid)).length, 0, 'so it is never read again');

  /* and a line the keeper folds now is marked whole from the start */
  const { maybeSummarize } = await import('../../js/agents/memory.js');
  const sid2 = 'm259-fold-whole';
  for (let i = 0; i < 20; i += 1) await db.messages.append(sid2, { role: i % 2 ? 'assistant' : 'user', text: 'fold page ' + (i + 1) + ' ' + 'z'.repeat(i % 2 ? 7000 : 20) });
  await db.settings.set('memoryWindow', 10);
  await db.settings.set('memoryBatch', 6);
  const fh = scriptedHouse(['Jovan walked the fold pages.', 'NONE']);
  await withHouse(fh, () => maybeSummarize({ connection: CONN, storyId: sid2, stale: () => false }));
  const folded = (await loadMemory(sid2)).nodes.filter((n) => n.level === 1 && !n.empty);
  assert(folded.length >= 1 && folded.every((n) => n.whole === true), 'a new line is marked whole: ' + JSON.stringify(folded.map((n) => n.whole)));
  eq(partlyReadLines(await loadMemory(sid2), await db.messages.list(sid2)).length, 0, 'and never taken for one read in part');
  await db.settings.set('memoryWindow', undefined);
  await db.settings.set('memoryBatch', undefined);
});

test('M259-25: the old auditor\u2019s mark is found, the people are re-read on the side and swapped in whole, once', async () => {
  const { rebuildPeople, oldAuditorRaised, peopleHealDue, HEAL_GEN } = await import('../../js/agents/rebuild.js');
  let st = applyMutations(emptyState(), [{ type: 'rel.set', name: 'Old Friend', p: 20, cause: 'the brief states (P:20)' }]).state;
  st = applyMutations(st, [{ type: 'rel.shift', name: 'Old Friend', axis: 'p', delta: -15, cause: 'he lied to her about the photos' }]).state;
  eq(oldAuditorRaised(st), false, 'a page beat alone is no mark');
  st = applyMutations(st, [{ type: 'rel.set', name: 'Old Friend', p: 20, cause: 'the brief says they are old friends' }]).state;
  eq(oldAuditorRaised(st), true, 'a "brief says" set after a page beat is the old auditor\u2019s mark');
  eq(peopleHealDue(st), true, 'so the story is due a re-reading');
  eq(peopleHealDue({ ...st, healedGen: HEAL_GEN }), false, 'once healed, never again');
  const fresh = applyMutations(emptyState(), [{ type: 'rel.set', name: 'Rias', p: 60, cause: 'the brief states (P:60)' }]).state;
  eq(peopleHealDue(fresh), false, 'a story without the mark is left alone');

  const sid = 'm259-heal-people';
  st.sheet = { actors: {}, playerName: 'Jovan' };
  st.characters = { 'Old Friend': { core: 'an old page written by the old scribe', state: '', arc: '', threads: [], updatedAtTurn: 0 } };
  await saveState(sid, st);
  for (let i = 0; i < 12; i += 1) await db.messages.append(sid, { role: i % 2 ? 'assistant' : 'user', text: 'page ' + (i + 1) + (i === 5 ? ' — Mira pours Jovan a drink.' : '') });
  const seen = [];
  const answer = async (body) => {
    const all = JSON.stringify(body);
    if (/reading a story/i.test(all)) {
      const live = await loadState(sid);
      seen.push(Object.keys(live.characters || {}).join(',') + '/' + ((live.relationships || {})['Old Friend'] || {}).p);
      return JSON.stringify({ deltas: [{ name: 'Mira', field: 'core', text: 'the innkeeper, read again' }], shifts: [{ name: 'Mira', axis: 'p', delta: 5, cause: 'she poured him drink number ' + seen.length }] });
    }
    return '{"standings":[]}';
  };
  const house = scriptedHouse(answer);
  const r = await withHouse(house, () => rebuildPeople({ connection: CONN, storyId: sid, brief: 'Jovan comes home.', stale: () => false }));
  assert(seen.length >= 2, 'the reader was asked batch by batch (' + seen.length + ')');
  assert(seen.every((x) => x === 'Old Friend/20'), 'and while it read, the live ledger stood whole and untouched: ' + seen.join(' | '));
  const after = await loadState(sid);
  eq(Object.keys(after.characters).join(','), 'Mira', 'then the re-read people are swapped in');
  eq(after.relationships.Mira.p, 5 * seen.length, 'with the standings the pages earned');
  eq(Boolean(after.relationships['Old Friend']), false, 'and the pushed-back standing is gone');
  assert(after.log.some((l) => /read again from the pages/.test(l.words)), 'the log says so');
  assert(r.read === 12, 'every page was read');
  assert(Number.isFinite(after.peopleRebuiltAt), 'the rebuilt world is marked as the rebuild\u2019s');
  const backup = await db.settings.get('peopleBackup:' + sid);
  eq(Object.keys(backup.characters).join(','), 'Old Friend', 'and the way back holds the world before it');
  await withHouse(scriptedHouse(answer), () => rebuildPeople({ connection: CONN, storyId: sid, brief: 'Jovan comes home.', stale: () => false }));
  eq(Object.keys((await db.settings.get('peopleBackup:' + sid)).characters).join(','), 'Old Friend', 'a second rebuild never overwrites the way back (M165)');

  /* a run cut short changes nothing */
  const sid2 = 'm259-heal-cut';
  await saveState(sid2, st);
  for (let i = 0; i < 12; i += 1) await db.messages.append(sid2, { role: i % 2 ? 'assistant' : 'user', text: 'page ' + (i + 1) });
  let renews = 0;
  const cut = await withHouse(scriptedHouse(answer), () => rebuildPeople({ connection: CONN, storyId: sid2, brief: 'b', stale: () => false, renew: () => { renews += 1; return renews < 2; } }));
  eq(cut.stalled, true, 'a run cut short says so');
  const kept = await loadState(sid2);
  eq(Object.keys(kept.characters).join(','), 'Old Friend', 'and the live people are exactly as they were');
  eq(kept.relationships['Old Friend'].p, 20, 'standings too');
});

/* ---------- M263: squeezed lines, and the writer's own words ---------- */

test('M259-26: a squeezed line over pages read in part is read again from its pages; a squeeze of whole lines is whole', async () => {
  const { partlyReadMerged, rereadMergedLine, loadMemory, maybeSummarize } = await import('../../js/agents/memory.js');
  const sid = 'm259-merged';
  for (let i = 0; i < 12; i += 1) await db.messages.append(sid, { role: i % 2 ? 'assistant' : 'user', text: 'merged page ' + (i + 1) + ' ' + (i === 3 ? 'm'.repeat(8000) + ' MERGED-TAIL' : '') });
  const msgs = await db.messages.list(sid);
  const two = [
    { id: 'node-M2', span: [0, 11], level: 2, text: 'a squeezed line of twelve pages', at: 1 },
    { id: 'node-W2', span: [0, 11], level: 2, text: 'a squeezed line of whole lines', at: 2, whole: true },
  ];
  eq(partlyReadMerged({ nodes: two }, msgs).join('|'), 'node-M2', 'a squeezed line over a long page is found; one squeezed from whole lines is not');
  await saveMemory(sid, { window: 20, nodes: [two[0]] });
  await db.settings.set('memoryBatch', 6);
  const tracker = (body) => /narrative-state tracker/i.test(JSON.stringify(body));
  const house = scriptedHouse(async (body) => {
    const t = bodyText({ body });
    if (tracker(body) && t.includes('merged page 4 ')) return 'Pages one to six; MERGED-TAIL kept.';
    if (tracker(body) && t.includes('merged page 9 ')) return 'Pages seven to twelve.';
    return 'NONE';
  });
  const r = await withHouse(house, () => rereadMergedLine({ connection: CONN, storyId: sid, lineId: 'node-M2' }));
  eq(r.ok, true, 'it is read again');
  const after = await loadMemory(sid);
  eq(after.nodes.map((n) => n.level + ':' + n.span.join('-') + ':' + (n.whole === true)).join('|'), '1:0-5:true|1:6-11:true', 'replaced in place by its pages\u2019 own lines, read whole');
  assert(/MERGED-TAIL/.test(after.nodes[0].text), 'holding what the long page\u2019s end held');
  eq(partlyReadMerged(after, msgs).length, 0, 'and never read again');

  /* a layer past its size squeezes its oldest two — whole when both were whole */
  const sq = 'm259-squeeze';
  for (let i = 0; i < 612; i += 1) await db.messages.append(sq, { role: i % 2 ? 'assistant' : 'user', text: 'p' + i });
  const lines = Array.from({ length: 101 }, (_, i) => ({ id: 'node-q' + i, span: [i * 6, i * 6 + 5], level: 1, text: 'line ' + i, at: i + 1, whole: true }));
  await saveMemory(sq, { window: 10, nodes: lines });
  await db.settings.set('memoryWindow', 10);
  await db.settings.set('memorySqueeze', 100); /* M264: the by-number way, where a layer of 101 squeezes */
  await withHouse(scriptedHouse(async (body) => (tracker(body) ? 'Lines zero and one, squeezed.' : 'NONE')), () => maybeSummarize({ connection: CONN, storyId: sq, stale: () => false }));
  const squeezed = (await loadMemory(sq)).nodes.filter((n) => n.level === 2);
  assert(squeezed.length >= 1, 'a squeeze happened (' + squeezed.length + ')');
  assert(squeezed.every((n) => n.whole === true), 'a squeeze of whole lines is whole');
  await db.settings.set('memoryBatch', undefined);
  await db.settings.set('memoryWindow', undefined);
  await db.settings.set('memorySqueeze', undefined);
});

test('M259-27: what the writer wrote by hand stands through any re-reading', async () => {
  const { rebuildPeople } = await import('../../js/agents/rebuild.js');
  let st = emptyState(); st.sheet = { actors: {}, playerName: 'Jovan' };
  st = applyMutations(st, [
    { type: 'people.set', name: 'Mira', field: 'core', text: 'MY OWN WORDS: the innkeeper who hides a letter', byHand: true },
    { type: 'people.set', name: 'Mira', field: 'state', text: 'behind the bar' },
    { type: 'people.note', name: 'Mira', field: 'thread', text: 'she still owes the ferryman', byHand: true },
    { type: 'people.set', name: 'Tomas', field: 'core', text: 'a smith, as the old scribe wrote' },
    { type: 'rel.set', name: 'Mira', p: 42, cause: 'I decide this', byHand: true },
    { type: 'rel.set', name: 'Tomas', p: 10, cause: 'the brief states (P:10)' },
  ]).state;
  eq(JSON.stringify(st.characters.Mira.hand), '{"core":true,"threads":true}', 'the mark says what the writer wrote, field by field');
  eq(st.relationships.Mira.hand, true, 'and the standing he set');
  eq(st.characters.Tomas.hand, undefined, 'a reader\u2019s page carries no mark');
  const re = applyMutations(st, [{ type: 'people.set', name: 'Mira', field: 'core', text: 'rewritten by a reader' }]).state;
  eq(JSON.stringify(re.characters.Mira.hand), '{"threads":true}', 'a reader writing the field later takes the mark off that field');
  const sid = 'm259-hand';
  await saveState(sid, st);
  for (let i = 0; i < 6; i += 1) await db.messages.append(sid, { role: i % 2 ? 'assistant' : 'user', text: 'hand page ' + (i + 1) });
  const answer = async (body) => (/reading a story/i.test(JSON.stringify(body))
    ? JSON.stringify({ deltas: [{ name: 'Mira', field: 'core', text: 'the reader\u2019s own reading' }, { name: 'Mira', field: 'state', text: 'at the door' }, { name: 'Tomas', field: 'core', text: 'a smith, read again' }],
      shifts: [{ name: 'Mira', axis: 'p', delta: 5, cause: 'she smiled at the page' }, { name: 'Tomas', axis: 'p', delta: 3, cause: 'he nodded' }] })
    : '{"standings":[]}');
  await withHouse(scriptedHouse(answer), () => rebuildPeople({ connection: CONN, storyId: sid, brief: 'b', stale: () => false }));
  const after = await loadState(sid);
  eq(after.characters.Mira.core, 'MY OWN WORDS: the innkeeper who hides a letter', 'the writer\u2019s own words stand');
  eq(after.characters.Mira.state, 'at the door', 'what he did not write is read again');
  eq((after.characters.Mira.threads || [])[0], 'she still owes the ferryman', 'his loose end stands first');
  eq(after.characters.Tomas.core, 'a smith, read again', 'a page no one wrote by hand is read again');
  eq(after.relationships.Mira.p, 42, 'the standing he set stands');
  eq(after.relationships.Tomas.p, 3, 'one he did not set is read again from the pages');

  /* a housekeeper card the writer lets land is his own writing too */
  const { applyProposal } = await import('../../js/agents/housekeeper.js');
  const hsid = 'm259-hand-card';
  await saveState(hsid, emptyState());
  const session = { turns: [{ proposals: [{ id: 'card-1', kind: 'ledit', status: 'pending', label: 'write Card Person', op: { mutations: [{ type: 'people.set', name: 'Card Person', field: 'core', text: 'FROM A CARD THE WRITER LET LAND' }] } }] }], batches: [] };
  const landed = await applyProposal(session, hsid, 'card-1');
  eq(landed.ok, true, 'the card lands: ' + landed.words);
  const carded = (await loadState(hsid)).characters['Card Person'];
  eq(carded && carded.hand && carded.hand.core, true, 'and is marked the writer\u2019s own');
});

test('M259-28: the writer chooses when the record squeezes; the record rides in the room his context leaves', async () => {
  const { cleanSqueeze, recordRoom, renderMemory, maybeSummarize, loadMemory, SLOT_BUDGET } = await import('../../js/agents/memory.js');
  eq(JSON.stringify(cleanSqueeze(undefined)), '{"mode":"auto"}', 'the house squeezes by room unless told otherwise');
  eq(JSON.stringify(cleanSqueeze('never')), '{"mode":"never"}', 'never');
  eq(JSON.stringify(cleanSqueeze(0)), '{"mode":"never"}', '0 is never, as in Summaryception');
  eq(JSON.stringify(cleanSqueeze(20)), '{"mode":"lines","lines":20}', 'a number of lines');
  eq(cleanSqueeze(1).lines, 3, 'never fewer than three');
  eq(recordRoom({ contextTokens: 300000, maxTokens: 30000, windowTokens: 60000 }), (300000 - 60000 - 40000 - 30000) * 3, 'a big context leaves the record a big room');
  eq(recordRoom({ contextTokens: 32000, maxTokens: 8000, windowTokens: 20000 }), SLOT_BUDGET, 'a small one never less than the old 30,000');

  const many = { window: 20, nodes: Array.from({ length: 120 }, (_, i) => ({ id: 'n' + i, span: [i * 6, i * 6 + 5], level: 1, text: 'RECORD-LINE-' + i + ' ' + 'r'.repeat(400), at: i + 1 })) };
  const small = renderMemory(many);
  const big = renderMemory(many, recordRoom({ contextTokens: 300000, maxTokens: 30000, windowTokens: 60000 }));
  assert(!small.includes('RECORD-LINE-0 ') && /rest beyond the budget/.test(small), 'in the old 30,000 the oldest lines were let go');
  assert(big.includes('RECORD-LINE-0 ') && !/rest beyond the budget/.test(big), 'in the room a big context leaves, every line rides');

  /* the three choices, on a real layer of 101 lines */
  const tracker = (body) => /narrative-state tracker/i.test(JSON.stringify(body));
  const squeezeWith = async (setting, room, sid) => {
    for (let i = 0; i < 612; i += 1) await db.messages.append(sid, { role: i % 2 ? 'assistant' : 'user', text: 'p' + i });
    await saveMemory(sid, { window: 10, nodes: Array.from({ length: 101 }, (_, i) => ({ id: 'node-s' + i, span: [i * 6, i * 6 + 5], level: 1, text: 'line ' + i + ' ' + 'x'.repeat(300), at: i + 1, whole: true })) });
    await db.settings.set('memoryWindow', 10);
    await db.settings.set('memorySqueeze', setting);
    await withHouse(scriptedHouse(async (body) => (tracker(body) ? 'Two old lines, squeezed.' : 'NONE')), () => maybeSummarize({ connection: CONN, storyId: sid, stale: () => false, recordRoomChars: room }));
    return (await loadMemory(sid)).nodes.filter((n) => n.level === 2).length;
  };
  eq(await squeezeWith('never', 1000, 'm259-sq-never'), 0, 'never: no squeeze, even in a tiny room');
  eq(await squeezeWith(100, 10000000, 'm259-sq-lines'), 1, 'a number: a layer past it squeezes, whatever the room');
  eq(await squeezeWith(undefined, 10000000, 'm259-sq-autobig'), 0, 'auto: the whole record fits a big room — no squeeze');
  eq(await squeezeWith(undefined, 5000, 'm259-sq-autosmall'), 1, 'auto: it would not fit — the oldest two are squeezed');
  await db.settings.set('memorySqueeze', undefined);
  await db.settings.set('memoryWindow', undefined);
});

test('M259-29: NO SILENT CUT — every reader of the record gets it whole in its room; a cut is whole lines, and says so', async () => {
  const { recordFor, storySoFar, keeperRecordCap, maybeSummarize, recordLinesBefore, CONTEXT_CAP } = await import('../../js/agents/memory.js');
  const lines = Array.from({ length: 150 }, (_, i) => ({ id: 'node-nc' + i, span: [i * 6, i * 6 + 5], level: 1, text: 'NOCUT-LINE-' + i + ' ' + 'q'.repeat(500), at: i + 1, whole: true }));
  const mem = { window: 20, nodes: lines };
  const whole = recordFor(mem, 1, Infinity);
  assert(whole.includes('NOCUT-LINE-0 ') && whole.includes('NOCUT-LINE-149 '), 'with room, every line');
  const cut = recordFor(mem, 1, 20000);
  assert(cut.length <= 20000 && cut.includes('NOCUT-LINE-149 ') && !cut.includes('NOCUT-LINE-0 '), 'without it, the newest kept');
  assert(/^\(\d+ earlier lines not shown — no room\)\n- NOCUT-LINE-\d+ /.test(cut), 'whole lines only, and a line says how many went: ' + cut.slice(0, 80));
  assert(keeperRecordCap({ contextSize: 128000 }) > 100000 && keeperRecordCap({ contextSize: 128000 }) > CONTEXT_CAP, 'the keeper is shown as much as its room holds');
  const msgs = Array.from({ length: 1000 }, (_, i) => ({ id: 'nc' + i, role: i % 2 ? 'assistant' : 'user', text: 'p' + i }));
  const told = storySoFar(msgs, mem, 'nc999');
  assert(told.record.includes('NOCUT-LINE-0 '), 'the extractor and the world agent are told the whole story so far');
  assert(recordLinesBefore(mem, 12).includes('NOCUT-LINE-1 ') && !recordLinesBefore(mem, 12).includes('NOCUT-LINE-2 '), 'a rebuild batch is told the lines before it');

  /* the world agent: no second cut */
  const sid = 'm259-nocut-world';
  await saveState(sid, bigLedger());
  const wh = thinkingHouse({ answer: '{"mutations":[],"brief":{"pressure":[],"ripe":[],"twb":null,"voices":[]}}' });
  await withHouse(wh, () => worldTurn({ connection: CONN, storyId: sid, userText: 'u', assistantText: 'a page', record: whole, stale: () => false }));
  const ws = sentText(wh.calls[0]);
  assert(ws.includes('NOCUT-LINE-0 ') && ws.includes('NOCUT-LINE-149 '), 'the world agent reads the record it is handed, first line and last');

  /* the keeper's own prior context */
  const ksid = 'm259-nocut-keeper';
  for (let i = 0; i < 930; i += 1) await db.messages.append(ksid, { role: i % 2 ? 'assistant' : 'user', text: 'keeper page ' + i });
  await saveMemory(ksid, { window: 10, nodes: lines });
  await db.settings.set('memoryWindow', 10);
  const kh = scriptedHouse(async () => 'A new line.');
  await withHouse(kh, () => maybeSummarize({ connection: CONN, storyId: ksid, stale: () => false }));
  const summarize = kh.calls.find((c) => /narrative-state tracker/i.test(JSON.stringify(c.body)));
  assert(summarize && bodyText(summarize).includes('NOCUT-LINE-0 '), 'the keeper writing a new line is shown the oldest line too');
  await db.settings.set('memoryWindow', undefined);

  /* the standings rebuild */
  const { rebuildStandings } = await import('../../js/agents/auditor.js');
  const rsid = 'm259-nocut-rebuild';
  await saveState(rsid, emptyState());
  await db.messages.append(rsid, { role: 'user', text: 'u' });
  await db.messages.append(rsid, { role: 'assistant', text: 'a' });
  await saveMemory(rsid, { window: 20, nodes: lines });
  const rh = thinkingHouse({ answer: '{"mutations":[]}' });
  await withHouse(rh, () => rebuildStandings({ connection: CONN, storyId: rsid, stale: () => false }));
  assert(rh.calls.some((c) => { const b = JSON.stringify(c.body); return b.includes('THE RECORD (what the pages established') && b.includes('NOCUT-LINE-0 '); }), 'the standings rebuild reads it whole, past the old 60,000');
});
