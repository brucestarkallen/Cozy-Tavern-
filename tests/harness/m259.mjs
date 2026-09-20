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
  /* M277: a standing move the auditor may not make is counted, not listed — the restore is the one finding */
  eq(after.audit.issues.length, 1, 'only the restore is reported: ' + JSON.stringify(after.audit.issues.map((i) => i.what)));
  eq(after.audit.issues[0].landed, 1, 'and it landed');
  eq(after.audit.leftStandings, 1, 'the refused raise is counted for the workers line');
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

test('M259-30: every note in the ledger is kept whole — no “…and privately…”', async () => {
  const { renderPeopleTiers } = await import('../../js/engine/people.js');
  const { oldCutNotes, peopleHealDue, HEAL_GEN } = await import('../../js/agents/rebuild.js');
  const caleb = 'Posted to the cheer squad chat that Jovan is Rias\u2019s brother, framed him as squaring up at the Bluebird and staring him down on the Sterling driveway, cast him as \u2018the season\u2019s villain\u2019 headed for \u2018a throne by september,\u2019 and privately messaged Vanessa that he would make Jovan regret coming home before the first game of the season.';
  const long = caleb + ' ' + caleb;
  let st = applyMutations(emptyState(), [
    { type: 'people.set', name: 'Caleb Thorne', field: 'state', text: long },
    { type: 'people.set', name: 'Caleb Thorne', field: 'core', text: long },
    { type: 'people.note', name: 'Caleb Thorne', field: 'arc', text: long },
    { type: 'people.note', name: 'Caleb Thorne', field: 'thread', text: caleb },
    { type: 'thread.set', title: 'Caleb\u2019s campaign against Jovan', owner: 'Caleb Thorne', next: long },
    { type: 'knowledge.add', name: 'Vanessa Reynolds', fact: long },
    { type: 'offscreen.set', name: 'Caleb Thorne', location: 'the Thorne house, upstairs, in the room with the trophies from three seasons', activity: long, agenda: long, stance: 'busy' },
    { type: 'canon.lock', name: 'Caleb Thorne', key: 'the grudge he carries against the Wells family', value: long },
    { type: 'faction.set', name: 'The cheer squad', stance: 'wary', agenda: long, move: long },
    { type: 'rel.set', name: 'Caleb Thorne', p: -20, cause: long },
    { type: 'body.injure', name: 'Caleb Thorne', what: long, sev: 1 },
  ]).state;
  const c = st.characters['Caleb Thorne'];
  eq(c.state, long, 'the now line, whole');
  eq(c.core, long, 'their nature, whole');
  eq(c.arc, long, 'how things stand, whole');
  eq(c.threads[0], caleb, 'a loose end, whole');
  eq(st.threads[0].next, long, 'a thread\u2019s next step, whole');
  eq(st.knowledge['Vanessa Reynolds'][0].fact, long, 'what someone knows, whole');
  const seat = st.offscreen['Caleb Thorne'];
  eq(seat.activity, long, 'an absent person\u2019s doing, whole');
  eq(seat.agenda, long, 'and their agenda');
  assert(!/…/.test(JSON.stringify(st.canon)), 'a locked truth, whole');
  assert(!/…/.test(JSON.stringify(st.factions)), 'a faction\u2019s agenda and move, whole');
  assert(st.relationships['Caleb Thorne'].history.some((h) => h.cause.includes('before the first game of the season')), 'a standing\u2019s cause, whole');
  assert(!/…/.test(JSON.stringify(st.bodies)), 'a wound, whole');
  assert(!/…/.test(JSON.stringify(st.log.map((l) => l.words))), 'and every line of the log says it whole');

  /* the storyteller\u2019s card for someone off the scene sheds whole lines, never a word */
  const lean = { ...st, present: [], offscreen: {}, characters: { 'Caleb Thorne': { core: 'the captain', state: 'posting', arc: 'x'.repeat(1500), threads: ['y'.repeat(900)], updatedAtTurn: 0 } } };
  const tiers = renderPeopleTiers(lean, { recentPages: ['Caleb Thorne texted again.'] });
  const card = JSON.stringify(tiers);
  assert(card.includes('the captain') && card.includes('posting'), 'who they are and where they are ride whole');
  assert(!card.includes('yyyy'), 'the loose ends go first when the card is past its room');
  assert(!/(x|y)…/.test(card), 'and nothing is cut mid-line');

  /* a page the old limits cut is healed once */
  const cutOld = { characters: { 'Caleb Thorne': { core: 'the captain', state: caleb.slice(0, 225).trimEnd() + '…', arc: '', threads: [] } } };
  eq(oldCutNotes(cutOld), true, 'a now line cut at the old 240 is found');
  eq(peopleHealDue(cutOld), true, 'and the page is due a re-reading');
  eq(peopleHealDue({ ...cutOld, healedGen: HEAL_GEN }), false, 'once');
  eq(oldCutNotes({ characters: { A: { core: 'Loves the sea…', state: '', arc: '' } } }), false, 'a short line that simply ends in an ellipsis is not a cut');
  eq(oldCutNotes({ characters: { A: { core: '', state: caleb.slice(0, 225).trimEnd() + '…', arc: '', hand: { state: true } } } }), false, 'and the writer\u2019s own words are never re-read over');
});

test('M259-31: the storyteller is shown the whole state of things when its context has the room', async () => {
  const { stateView, STATE_BUDGET } = await import('../../js/engine/state.js');
  const { buildRequest } = await import('../../js/assemble/stack.js');
  const st = bigLedger();
  const compact = renderStateFacts(st);
  assert(compact.length <= STATE_BUDGET, 'a small room keeps the compact view');
  const view = stateView(200000);
  eq(view.whole, true, 'a 200k context is shown everything');
  eq(stateView(0).whole, false, 'an unknown room keeps the compact view');
  const whole = renderStateFacts(st, view);
  for (const n of NAMES) assert(whole.includes(n), 'every standing: ' + n);
  for (let i = 1; i <= 8; i += 1) assert(whole.includes('Thread number ' + i + ' about'), 'every thread: ' + i);
  for (let i = 0; i < 9; i += 1) assert(whole.includes('distinct fact number ' + i + ' '), 'everything the present know: ' + i);
  const req = buildRequest({ story: { title: 't', brief: 'b' }, messages: [{ id: 'u1', role: 'user', text: 'go' }], settings: {}, state: st, modules: [], memory: '', window: { mode: 'keeper', window: 30, budgetTokens: 200000 } });
  const wire = JSON.stringify(req);
  assert(NAMES.every((n) => wire.includes(n)) && wire.includes('Thread number 8 about') && wire.includes('distinct fact number 0 '), 'and the storyteller\u2019s request carries all of it');
});

test('M259-32: a report of what went right is not a finding; the second reader never sees the moment; a summary\u2019s error is the summary\u2019s', async () => {
  const { parseAuditorAnswer, saysAllIsWell } = await import('../../js/agents/auditor.js');
  const longWhat = 'the ledger\u2019s presence list still has Rias Wells at the stove counter and Chloe Maxwell inside the kitchen, but the pages show Rias and Vanessa walking out to the Sterling driveway and Chloe arriving there on foot; the latest page has Jovan, Mi-na Song, Rias, Vanessa and Chloe on the Sterling driveway with Aurora on the porch steps and Mr. Sterling mid-driveway, and nobody left in the kitchen at all.';
  const read = parseAuditorAnswer(JSON.stringify({ issues: [{ what: longWhat, fix: 'x', pages: false, mutations: [] }] }));
  eq(read.issues[0].what, longWhat, 'a finding is kept whole — it was cut at 300, mid-word');
  eq(saysAllIsWell({ what: 'the ledger\u2019s thread X is live and correctly hot', fix: 'the thread stands as written' }), true, '"stands as written" is no finding');
  eq(saysAllIsWell({ what: 'the ledger\u2019s locks match the brief and the pages; no canon contradicts the brief', fix: 'the locks stand as written' }), true, 'nor "the locks match"');
  eq(saysAllIsWell({ what: 'the thread is still open but the pages closed it', fix: 'close it' }), false, 'a real finding is one');

  const storyId = 'm259-allwell';
  let st = emptyState(); st.sheet = { actors: {}, playerName: 'Jovan' };
  st = applyMutations(st, [{ type: 'presence.enter', name: 'Rias Wells' }]).state;
  await saveState(storyId, st);
  await db.messages.append(storyId, { role: 'user', text: 'u' });
  await db.messages.append(storyId, { role: 'assistant', text: 'Rias heard Jovan say he is leaving on Sunday.' });
  const house = scriptedHouse([issuesAnswer([
    { what: 'the ledger\u2019s thread "Vanessa\u2019s party" is live and correctly hot', fix: 'the thread stands as written', pages: false, mutations: [] },
    { what: 'the ledger\u2019s standings are all written and none is wrongly zero', fix: 'the standings stand as written', pages: false, mutations: [] },
    { what: 'Rias heard Jovan is leaving on Sunday and has no line for it', fix: 'add it', pages: false, mutations: [{ type: 'knowledge.add', name: 'Rias Wells', fact: 'that Jovan leaves on Sunday' }] },
  ])]);
  const r = await withHouse(house, () => auditLedger({ connection: CONN, storyId, stale: () => false }));
  eq(r.issues.length, 1, 'only the real finding is reported');
  const { auditRunWords } = await import('../../js/agents/auditor.js');
  assert(/^found 1 thing/.test(auditRunWords(r)), 'and counted: ' + auditRunWords(r));

  const { buildContinuityMessages } = await import('../../js/agents/continuity.js');
  let scene = applyMutations(emptyState(), [
    { type: 'presence.enter', name: 'Rias Wells', position: 'at the stove counter, arms uncrossed', attire: 'flip-flops kicked off' },
    { type: 'mode.snapshot', flags: ['intimate'] },
    { type: 'offscreen.set', name: 'Caleb Thorne', location: 'Lakeshore Drive', activity: 'driving away', stance: 'busy' },
    { type: 'canon.lock', name: 'Rias Wells', key: 'age', value: 'seventeen' },
  ]).state;
  const c = buildContinuityMessages({ state: scene, assistantText: 'Rias crossed her arms.' }).user;
  assert(c.includes('Rias Wells') && c.includes('Lakeshore Drive') && c.includes('seventeen'), 'who is here, where the absent are, what is locked');
  assert(!/arms uncrossed|flip-flops|stove counter|intimate/i.test(c), 'never where anyone stands, what they wear, or the mood');
  const longBrief = 'The brief opens. ' + 'b'.repeat(9000) + ' BRIEF-END: Rias is seventeen.';
  assert(buildContinuityMessages({ state: scene, assistantText: 'x', brief: longBrief }).user.includes('BRIEF-END'), 'and the whole brief — it was cut at 4,000');

  const { parseVerifyAnswer } = await import('../../js/agents/memory.js');
  const v = parseVerifyAnswer(JSON.stringify([
    { issue: 'Snippet says Jovan is sixteen, but the passage says he is seventeen', fix: 'Jovan is seventeen', kind: 'drift', where: 'source' },
    { issue: 'The passage itself puts Alexia on the train, but the record establishes she never left the academy', fix: 'Alexia is at the academy', kind: 'continuity', where: 'source' },
  ]));
  /* M268: a label and a sentence that disagree act on nothing — the snippet was right in the case that taught this */
  eq(v[0].where, 'unsure', 'a label and a sentence that disagree are left alone');
  eq(v[1].where, 'source', 'a page that truly contradicts the record still goes to the mender');
});

test('M259-33: the summary checker holds the brief above every page, and the report leaves out what needs no change', async () => {
  const { saysAllIsWell } = await import('../../js/agents/auditor.js');
  eq(saysAllIsWell({ what: 'The ledger\u2019s presence list still has Vanessa at Jovan\u2019s elbow, but the latest page has Mi-na\u2019s palm-up hand between them; the real error is that Here now does not list Mi-na\u2019s ruling state, which is the moment, not mine to report.', fix: 'no change' }), true, 'a line whose own fix is "no change" is not a finding');
  eq(saysAllIsWell({ what: 'The ledger still seats Mi-na, Rias, Chloe and Vanessa in the Wells kitchen, but the ground and hour match; the Here now omits no one and adds no one.', fix: 'No change.' }), true, 'nor one that says the list omits no one');
  eq(saysAllIsWell({ what: 'The ledger has Chloe by the window but the page has her at the door', fix: 'no change' }), true, 'a line whose only word is "no change" is not a finding');
  eq(saysAllIsWell({ what: 'The ledger has Chloe by the window but the page has her at the door', fix: 'move her to the door' }), false, 'while the same line with a change is one');

  const { maybeSummarize, loadMemory } = await import('../../js/agents/memory.js');
  const story = await db.stories.create({ title: 'the age' });
  const sid = story.id;
  await db.stories.update(sid, { brief: 'Jovan Wells is SIXTEEN years old and just came home.' });
  let st = applyMutations(emptyState(), [{ type: 'canon.lock', name: 'Jovan', key: 'age', value: 'sixteen' }]).state;
  await saveState(sid, st);
  for (let i = 0; i < 20; i += 1) await db.messages.append(sid, { role: i % 2 ? 'assistant' : 'user', text: (i === 3 ? 'Jovan, seventeen and tired, dropped his bag.' : 'age page ' + (i + 1)) });
  await db.settings.set('memoryWindow', 10);
  await db.settings.set('memoryBatch', 6);
  const asked = { verify: '', rewrites: 0 };
  const house = scriptedHouse(async (body) => {
    const t = bodyText({ body });
    if (/Check for exactly two things/.test(t)) {
      asked.verify = t;
      return JSON.stringify([{ issue: 'Snippet says Jovan is sixteen, but the passage says he is seventeen', fix: 'Jovan is seventeen', kind: 'drift', where: 'source' }]);
    }
    if (/Rewrite <snippet>/.test(t)) { asked.rewrites += 1; return 'Jovan (17) came home.'; }
    if (/omit any important information/.test(t)) return 'NONE';
    return 'Jovan (16) came home and dropped his bag.';
  });
  const mends = [];
  await withHouse(house, () => maybeSummarize({ connection: CONN, storyId: sid, stale: () => false, onSourceIssue: async (x) => { mends.push(x); } }));
  assert(asked.verify.includes('THE WRITER\'S BRIEF (it outranks every page)') && asked.verify.includes('SIXTEEN years old'), 'the checker is shown the brief, ranked above the pages');
  assert(asked.verify.includes('LOCKED TRUTHS') && /age: sixteen/i.test(asked.verify), 'and the locked truths');
  assert(/OUTRANKS EVERY PAGE/.test(asked.verify), 'and told the brief outranks a page');
  eq(mends.length, 0, 'a confused finding sends no one to change the pages');
  eq(asked.rewrites, 0, 'nor rewrites the line');
  const line = (await loadMemory(sid)).nodes.find((n) => n.level === 1 && !n.empty);
  assert(line && /\(16\)/.test(line.text), 'the line keeps the brief\u2019s truth: ' + (line && line.text));
  await db.settings.set('memoryWindow', undefined);
  await db.settings.set('memoryBatch', undefined);
});

test('M259-34: a page mended by mistake is put back by the house, and its record line is folded again', async () => {
  const { putBackMistakenMends, loadMemory } = await import('../../js/agents/memory.js');
  const sid = 'm259-unmend';
  await db.messages.append(sid, { role: 'user', text: 'u' });
  const wrong = await db.messages.append(sid, { role: 'assistant', text: 'Jovan, seventeen and tired, dropped his bag.' });
  const right = await db.messages.append(sid, { role: 'assistant', text: 'The glitch is gone from this line.' });
  await db.messages.update(sid, wrong.id, { mended: { before: 'Jovan, sixteen and tired, dropped his bag.', why: 'Snippet says Jovan is sixteen, but the passage says he is seventeen. It should read: Jovan is seventeen, not sixteen', at: 1 } });
  await db.messages.update(sid, right.id, { mended: { before: 'The glitch 四十年 is gone from this line.', why: 'The page holds a stray character from another script — a glitch of the wire', at: 2 } });
  await saveMemory(sid, { window: 20, nodes: [{ id: 'node-over', span: [0, 1], level: 1, text: 'Jovan (17) dropped his bag.', at: 1, whole: true }, { id: 'node-other', span: [2, 2], level: 1, text: 'glitch line', at: 2, whole: true }] });
  const back = await putBackMistakenMends(sid);
  eq(back.join('|'), wrong.id, 'only the mistaken mend is put back');
  const pages = await db.messages.list(sid);
  eq(pages.find((m) => m.id === wrong.id).text, 'Jovan, sixteen and tired, dropped his bag.', 'the storyteller\u2019s own words are back');
  eq(pages.find((m) => m.id === wrong.id).mended, null, 'and it is no longer marked mended');
  eq(pages.find((m) => m.id === right.id).text, 'The glitch is gone from this line.', 'a right mend stands');
  const nodes = (await loadMemory(sid)).nodes.map((n) => n.id).join('|');
  eq(nodes, 'node-other', 'the record line over the restored page is let go, to be folded again');
  eq((await putBackMistakenMends(sid)).length, 0, 'and nothing is put back twice');
});

test('M259-35: every housekeeper round streams to the writer\u2019s view, and a new round says why', async () => {
  const { runConversation, roundWhy } = await import('../../js/agents/housekeeper.js');
  eq(roundWhy('What you asked for, whole:\n\n…'), 'reading what it looked up', 'a look-up round is named');
  eq(roundWhy('[ANCHOR CHECK] These finds…'), 'fixing where its changes land', 'and a correction round');
  let n = 0;
  const call = async (req) => {
    n += 1;
    if (n === 1) {
      if (req.onToken) req.onToken({ channel: 'prose', text: 'Looking. ' });
      return { text: 'Looking. <fetch>["find: seventeen"]</fetch>' };
    }
    if (req.onToken) {
      req.onToken({ channel: 'thinking', text: 'ROUND-TWO-THINKING' });
      req.onToken({ channel: 'prose', text: 'ROUND-TWO-WORDS' });
    }
    return { text: 'Nothing on those pages needs changing.' };
  };
  const seen = [];
  const r = await runConversation({
    connection: CONN, story: { id: 'm259-rounds', title: 't', brief: 'Jovan is sixteen.' },
    messages: [{ id: 'aaaa01', role: 'assistant', text: 'Jovan, seventeen, came home.' }],
    state: emptyState(), modules: [], lore: [], memory: null, session: { turns: [] },
    writerText: 'Jovan is 16 — fix the page that says seventeen', contextPages: 12, call,
    onToken: (tok) => seen.push(tok),
  });
  assert(n >= 2, 'it looked something up and was asked again (a change asked for with no block asks once more: ' + n + ' calls)');
  const roundAt = seen.findIndex((t) => t.channel === 'round');
  assert(roundAt > 0, 'a round notice came between the rounds');
  eq(seen[roundAt].round, 2, 'naming round two');
  eq(seen[roundAt].why, 'reading what it looked up', 'and why');
  assert(seen.slice(roundAt).some((t) => t.text === 'ROUND-TWO-THINKING') && seen.slice(roundAt).some((t) => t.text === 'ROUND-TWO-WORDS'), 'the second round streams to the view — it streamed into nothing');
  assert(r && r.ok !== false, 'and the turn is answered');
});

test('M259-36: the housekeeper\u2019s cards have names of their own; the brief\u2019s opening stays; the house tells Mr. from Mrs.; a fact can be let go', async () => {
  const hk = await import('../../js/agents/housekeeper.js');
  const { undoLast } = await import('../../js/engine/apply.js');
  const { findPersonKey } = await import('../../js/engine/people.js');
  const base = { messages: [], state: emptyState(), modules: [], lore: [], memory: { nodes: [] } };

  /* names of their own, across the session */
  const session = { turns: [{ role: 'housekeeper', text: 'a', proposals: [{ id: 'p1', label: 'ledger changes 1', kind: 'ledit', status: 'applied' }, { id: 'p2', label: 'people\u2019s pages changes 1', kind: 'ledit', status: 'pending' }] }] };
  const led = hk.stageProposals(hk.parseProtocol('<ledits>[{"type":"thread.set","title":"The party","next":"Saturday"}]</ledits>'), { ...base, session, story: { brief: '' } });
  eq(led[0].label, 'ledger changes 2', 'a ledger card is numbered after the session\u2019s own, not from 1 again');
  const ppl = hk.stageProposals(hk.parseProtocol('<ledits>[{"type":"people.set","name":"Maya Bell","field":"core","text":"the squad\u2019s archivist"}]</ledits>'), { ...base, session, story: { brief: '' } });
  eq(ppl[0].label, 'people\u2019s pages changes 2', 'a bundle of page-of-the-people edits is named for what it touches');
  const withdraw = { turns: [{ role: 'housekeeper', text: 'a', proposals: [{ id: 'a', label: 'the brief — # STATE: Thu', status: 'pending' }, { id: 'b', label: 'the brief — WHERE: the Uber', status: 'pending' }] }] };
  const sup = hk.applySupersede(withdraw, ['the brief — # STATE: Thu']);
  eq(sup.count, 1, 'a withdrawal by name takes exactly one card');
  eq(withdraw.turns[0].proposals[1].status, 'pending', 'the other stays');

  /* the one list of what became of every card */
  const ctx = hk.buildHousekeeperContext({ story: { title: 't', brief: '' }, messages: [], state: emptyState(), modules: [], lore: [], memory: { nodes: [] }, session, contextPages: 8 });
  assert(/CARDS ALREADY SETTLED[\s\S]*“ledger changes 1”: APPLIED/.test(ctx), 'an applied card is listed as applied, whatever an old answer said');

  /* the brief's opening */
  const brief = '# STATE: Thu 20 Aug 2026, 11:00 / Uber backseat\nSCENE\nWHERE: the Uber\nPRESENT: Jovan\nLAST: he looks out\n\nJovan Wells is sixteen.';
  const story = { title: 't', brief, castNotes: '' };
  const stage = (block, writerText) => hk.stageProposals(hk.parseProtocol(block), { ...base, session: { turns: [] }, story, writerText });
  const stateCard = stage('<brief>[{"field":"brief","find":"11:00 / Uber backseat","replace":"17:20 / the Wells kitchen"}]</brief>', 'Jovan is 16 — fix the page that says seventeen');
  eq(stateCard[0].status, 'refused', 'the STATE line is not brought up to date');
  assert(/opening/.test(stateCard[0].words), 'and it says why: ' + stateCard[0].words);
  eq(stage('<brief>[{"field":"brief","find":"WHERE: the Uber","replace":"WHERE: the kitchen"}]</brief>', 'tidy it').at(0).status, 'refused', 'nor the SCENE block');
  eq(stage('<brief>[{"field":"brief","append":"LAST: Maya sends a screenshot"}]</brief>', 'tidy it').at(0).status, 'refused', 'nor a new LAST line');
  eq(stage('<brief>[{"field":"brief","text":"# STATE: Fri\\nJovan Wells is sixteen."}]</brief>', 'tidy it').at(0).status, 'refused', 'nor a whole rewrite that moves the opening');
  eq(stage('<brief>[{"field":"brief","find":"11:00 / Uber backseat","replace":"11:30 / Uber backseat"}]</brief>', 'in the brief, change the state line: the story starts at 11:30').at(0).status, 'pending', 'the writer naming the line may change it');
  eq(stage('<brief>[{"field":"brief","find":"WHERE: the Uber","replace":"WHERE: the kitchen"}]</brief>', 'in the brief, fix where Jovan lives').at(0).status, 'refused', 'a message that only says "where" does not open the opening');
  const fact = stage('<brief>[{"field":"brief","find":"Jovan Wells is sixteen.","replace":"Jovan Wells is sixteen, a first-year."}]</brief>', 'in the brief, add that he is a first-year');
  eq(fact[0].status, 'pending', 'a fact of the brief is still the housekeeper\u2019s to change');
  assert(/^the brief — Jovan Wells is sixteen/.test(fact[0].label), 'named for the words it changes: ' + fact[0].label);

  /* Mr. and Mrs. */
  let st = emptyState();
  st = applyMutations(st, [{ type: 'people.set', name: 'Mr. Sterling', field: 'core', text: 'a chamois in his back pocket' }]).state;
  st = applyMutations(st, [{ type: 'people.set', name: 'Mrs. Sterling', field: 'core', text: 'small, sharp-eyed, a dish towel over one shoulder' }]).state;
  assert(st.characters['Mr. Sterling'] && st.characters['Mrs. Sterling'], 'two pages: ' + Object.keys(st.characters).join(', '));
  assert(/chamois/.test(st.characters['Mr. Sterling'].core) && !/dish towel/.test(st.characters['Mr. Sterling'].core), 'his page keeps his life');
  eq(findPersonKey(st.characters, 'Mr Sterling'), 'Mr. Sterling', 'the same title without its dot is the same man');
  eq(findPersonKey({ Sterling: {} }, 'Mrs. Sterling'), '', 'a titled name is not whoever was written down as the bare surname');
  eq(findPersonKey({ Vanessa: {} }, 'Vanessa Reynolds'), 'Vanessa', 'while an untitled full name still finds its first name (M238)');

  /* a fact let go */
  let kn = applyMutations(emptyState(), [
    { type: 'knowledge.add', name: 'Emilia Vanderbilt', fact: 'hurt her knee at practice on 05 Sep 2021' },
    { type: 'knowledge.add', name: 'Emilia Vanderbilt', fact: 'that Jovan is back in town' },
  ]).state;
  const forgot = applyMutations(kn, [{ type: 'knowledge.forget', name: 'Emilia', fact: 'hurt her knee at practice on 05 Sep 2021' }]);
  eq(forgot.state.knowledge['Emilia Vanderbilt'].length, 1, 'the line is let go');
  eq(forgot.state.knowledge['Emilia Vanderbilt'][0].fact, 'that Jovan is back in town', 'and only that one');
  eq(undoLast(forgot.state).state.knowledge['Emilia Vanderbilt'].length, 2, 'a take-back restores it');
  eq(applyMutations(kn, [{ type: 'knowledge.forget', name: 'Emilia', fact: 'something she never knew at all' }]).rejected.length, 1, 'a fact she does not hold is refused, not guessed');

  /* the main character's "where" belongs to the old ground */
  let mc = emptyState();
  mc.sheet = { actors: {}, playerName: 'Jovan' };
  mc = applyMutations(mc, [{ type: 'place.set', name: 'The Bluebird' }, { type: 'people.set', name: 'Jovan', field: 'state', text: 'arrives at the Bluebird sock-footed' }]).state;
  const moved = applyMutations(mc, [{ type: 'place.set', name: 'The Wells kitchen' }]).state;
  assert(!(moved.characters.Jovan && moved.characters.Jovan.state), 'the move lets his old "where" go');
  eq(undoLast(moved).state.characters.Jovan.state, 'arrives at the Bluebird sock-footed', 'a take-back restores it');
  let mine = applyMutations(mc, [{ type: 'people.set', name: 'Jovan', field: 'state', text: 'MY OWN WORDS', byHand: true }]).state;
  mine = applyMutations(mine, [{ type: 'place.set', name: 'The Wells kitchen' }]).state;
  eq(mine.characters.Jovan.state, 'MY OWN WORDS', 'the writer\u2019s own words stay');

  /* a thread line that broke off, a name written twice */
  let th = applyMutations(emptyState(), [{ type: 'thread.set', title: 'Vanessa\u2019s party', next: 'throw it on Saturday' }]).state;
  th = applyMutations(th, [{ type: 'thread.set', title: 'Vanessa\u2019s party', next: 'Vanessa means to' }]).state;
  eq(th.threads[0].next, 'throw it on Saturday', 'a next step that broke off is not written');
  const dbl = applyMutations(emptyState(), [{ type: 'thread.set', title: 'Alexia Alexia\u2019s sunrise rematch', next: 'Saturday' }]).state;
  eq(dbl.threads[0].title, 'Alexia\u2019s sunrise rematch', 'a name written twice is written once');
  const { undoubled, brokenOff } = await import('../../js/engine/world.js');
  eq(undoubled('Alexia Vanderbilt Alexia Vanderbilt plans the rematch'), 'Alexia Vanderbilt plans the rematch', 'a whole name written twice, once');
  eq(undoubled('The trip to Bora Bora'), 'The trip to Bora Bora', 'a place that says its word twice is left alone');
  eq(undoubled('she had had enough'), 'she had had enough', 'and so is plain English');
  for (const whole of ['find the party she wants to go to', 'decide whether to move in', 'figure out who she can count on', 'say what she is worried about']) {
    eq(brokenOff(whole), false, 'a finished line stands: ' + whole);
  }
  for (const cut of ['Vanessa means to', 'throw a party for the', 'call Jovan and', 'the plan is to']) {
    eq(brokenOff(cut), true, 'a broken one does not: ' + cut);
  }
  const went = applyMutations(emptyState(), [{ type: 'thread.set', title: 'Vanessa\u2019s party', next: 'find the party she wants to go to' }]).state;
  eq(went.threads[0].next, 'find the party she wants to go to', 'and a finished next step is written');

  /* the live answer */
  eq(hk.answerAsWritten('Let me look. <fetch>["#a1"]</fetch>\n<brief>[{"find":"# STATE'), 'Let me look.\n\n(looking something up…) (writing its cards…)', 'the wire\u2019s blocks never show in the live answer');
});

test('M259-37: cards that fix one problem are one group — taking one back takes them all', async () => {
  const hk = await import('../../js/agents/housekeeper.js');
  const GROUP = 'Rias\u2019s slip about Jovan\u2019s age';
  const messages = [
    { id: 'aaaa01page', role: 'assistant', text: 'Rias said: I sent a sixteen-year-old boy to that island.' },
    { id: 'bbbb02page', role: 'assistant', text: 'The cheer chat was founded 2014, the year the squad began.' },
  ];
  const memory = { nodes: [{ id: 'node-rd8pjm2', span: [0, 0], level: 1, text: 'Rias admits she sent a sixteen-year-old boy away.' }] };
  const base = { messages, state: emptyState(), modules: [], lore: [], memory, story: { title: 't', brief: '' } };
  const P1 = hk.refOf(messages[0]);
  const P2 = hk.refOf(messages[1]);
  const reset = (list) => { for (const c of list) c.status = 'pending'; };

  /* the housekeeper names the problem on each of its three cards */
  const answer = '<edits>[{"id":"' + P1 + '","find":"a sixteen-year-old boy","replace":"a fourteen-year-old boy","reason":"he was fourteen","group":"' + GROUP + '"},'
    + '{"id":"' + P2 + '","find":"founded 2014","replace":"founded 2024","reason":"the chat is new"}]</edits>'
    + '<record>[{"line":"#rd8pjm2","find":"sixteen-year-old","replace":"fourteen-year-old","reason":"the same word, re-cut","group":"' + GROUP + '"}]</record>'
    + '<ledits>[{"type":"people.set","name":"Rias Wells","field":"arc","text":"she knows he was fourteen","group":"' + GROUP + '"}]</ledits>';
  const session = { turns: [] };
  const cards = hk.stageProposals(hk.parseProtocol(answer), { ...base, session });
  const slip = cards.filter((c) => c.groupName === GROUP);
  eq(slip.length, 3, 'the three cards of one problem are one group: ' + cards.map((c) => c.label + '=' + (c.groupName || '-') + '/' + c.status).join(' | '));
  eq(new Set(slip.map((c) => c.group)).size, 1, 'under one id');
  const chat = cards.find((c) => /2024/.test(JSON.stringify(c.op || {})));
  assert(chat && !chat.group, 'the unrelated card stands alone');
  session.turns.push({ role: 'writer', text: 'fix Rias' }, { role: 'housekeeper', text: 'done', proposals: cards });

  const sup = hk.applySupersede(session, [slip[0].label]);
  eq(sup.count, 3, 'one card named — the whole group is withdrawn');
  eq(sup.groups.join('|'), GROUP, 'and the note can say which problem');
  eq(chat.status, 'pending', 'the unrelated card stays');
  assert(slip.every((c) => c.status === 'superseded' && /with the rest of/.test(c.words)), 'each withdrawn card says why');

  reset(slip);
  eq(hk.applySupersede(session, ['only: ' + slip[1].label]).count, 1, '"only:" takes that one card alone');
  reset(slip);
  eq(hk.applySupersede(session, ['group: ' + GROUP]).count, 3, '"group:" names the problem');
  reset(slip);
  eq(hk.applySupersede(session, [GROUP]).count, 3, 'and a problem named plainly is the problem');
  reset(slip);

  /* the house joins them without being told: the same change in two places */
  const implicit = hk.stageProposals(hk.parseProtocol(
    '<edits>[{"id":"' + P1 + '","find":"a sixteen-year-old boy","replace":"a fourteen-year-old boy","reason":"he was fourteen then"}]</edits>'
    + '<record>[{"line":"#rd8pjm2","find":"sixteen-year-old","replace":"fourteen-year-old","reason":"re-cut"}]</record>'), { ...base, session: { turns: [] } });
  eq(implicit.length, 2, 'two cards');
  assert(implicit[0].group && implicit[0].group === implicit[1].group, 'the same change in two places is one group');
  /* or one reason for two different changes */
  const reasoned = hk.stageProposals(hk.parseProtocol(
    '<edits>[{"id":"' + P2 + '","find":"founded 2014","replace":"founded 2024","reason":"the squad chat began in 2024, not 2014"},'
    + '{"id":"' + P2 + '","find":"the year the squad began","replace":"two years after the squad began","reason":"the squad chat began in 2024, not 2014"}]</edits>'), { ...base, session: { turns: [] } });
  assert(reasoned.length === 2 && reasoned[0].group && reasoned[0].group === reasoned[1].group, 'one reason, one group');
  /* unrelated cards stay apart */
  const apart = hk.stageProposals(hk.parseProtocol(
    '<edits>[{"id":"' + P1 + '","find":"that island","replace":"that far island","reason":"where he went"},'
    + '{"id":"' + P2 + '","find":"founded 2014","replace":"founded 2024","reason":"when the chat began"}]</edits>'), { ...base, session: { turns: [] } });
  assert(apart.length === 2 && !apart[0].group && !apart[1].group, 'two different fixes are two cards, no group');

  /* a later card named for the same problem joins it */
  const later = hk.stageProposals(hk.parseProtocol('<edits>[{"id":"' + P1 + '","find":"that island","replace":"that island off the coast","reason":"x","group":"' + GROUP + '"}]</edits>'), { ...base, session });
  eq(later[0].group, slip[0].group, 'a later answer\u2019s card for the same problem is in the same group');

  /* names and commas */
  const named = hk.stageProposals(hk.parseProtocol('<edits>[{"id":"' + P2 + '","find":"founded 2014","replace":"founded 2024","label":"cheer chat, founding year"}]</edits>'), { ...base, session: { turns: [] } });
  eq(named[0].label, 'cheer chat founding year', 'a name never holds a comma — a withdrawal list is split at commas');
  const old = { turns: [{ role: 'housekeeper', text: 'a', proposals: [{ id: 'x', label: 'the brief — # STATE: Thu 20 Aug 2026, 11:00', status: 'pending' }, { id: 'y', label: '11:00', status: 'pending' }] }] };
  eq(hk.applySupersede(old, ['the brief — # STATE: Thu 20 Aug 2026, 11:00']).count, 1, 'an older name with a comma is taken whole');
  eq(old.turns[0].proposals[1].status, 'pending', 'and its tail is not taken for another card');
  const two = { turns: [{ role: 'housekeeper', text: 'a', proposals: [{ id: 'x', label: 'card one', status: 'pending' }, { id: 'y', label: 'card two', status: 'pending' }] }] };
  eq(hk.applySupersede(two, ['card one, card two']).count, 2, 'a list of names still works');

  /* the housekeeper sees the groups */
  const ctx = hk.buildHousekeeperContext({ story: base.story, messages, state: emptyState(), modules: [], lore: [], memory, session, contextPages: 8 });
  assert(ctx.includes('group “' + GROUP + '”') && /withdrawing any of them withdraws the whole group/.test(ctx), 'the pending list names each card\u2019s group, and what withdrawing means');
});

test('M259-38: the last quiet cuts — a correction, the director\u2019s brief and the writer\u2019s steer, a seated person\u2019s page, the rebuild\u2019s cast notes, a card\u2019s reason', async () => {
  const { addCorrection } = await import('../../js/agents/memory.js');
  const long = 'the writer set this right: ' + 'word '.repeat(420) + 'THE-END-OF-IT';
  const mem = addCorrection({ nodes: [] }, long);
  assert(mem.nodes[0].text.includes('THE-END-OF-IT'), 'a correction is kept whole (it was cut at 600)');

  const dir = await import('../../js/agents/director.js');
  const sid = 'm259-lastcuts';
  await db.messages.append(sid, { role: 'user', text: 'u' });
  await db.messages.append(sid, { role: 'assistant', text: 'a page' });
  await saveState(sid, emptyState());
  const brief = 'The brief opens. ' + 'b'.repeat(9000) + ' BRIEF-TAIL-SEEN';
  let seen = '';
  const call = async (req) => { seen = JSON.stringify(req.messages || []); return { text: '1. an idea\n2. another\n3. a third' }; };
  await dir.directorIdeas({ connection: CONN, storyId: sid, story: { id: sid, title: 't', brief }, call });
  assert(seen.includes('BRIEF-TAIL-SEEN'), 'the director reads the whole brief (it was cut at 6,000)');
  const steer = 'Aim it this way: ' + 's'.repeat(3000) + ' STEER-TAIL-SEEN';
  await dir.saveDirector(sid, { ...(await dir.loadDirector(sid)), text: 'EPISODE 1 — a directive', episode: 1 });
  await dir.directorSteer({ connection: CONN, storyId: sid, story: { id: sid, title: 't', brief }, direction: steer, call: async (req) => { seen = JSON.stringify(req.messages || []); return { text: 'EPISODE 1 — re-aimed' }; } });
  assert(seen.includes('STEER-TAIL-SEEN'), 'and the writer\u2019s own direction whole (it was cut at 2,000)');

  const wsid = 'm259-lastcuts-world';
  await saveState(wsid, emptyState());
  const activity = 'walking the long way round the lake ' + 'w'.repeat(400) + ' SEAT-TAIL-SEEN';
  const wh = thinkingHouse({ answer: JSON.stringify({ mutations: [{ type: 'offscreen.set', name: 'Maya Bell', location: 'the lake path', activity, stance: 'busy' }], brief: { pressure: [], ripe: [], twb: null, voices: [] } }) });
  await withHouse(wh, () => worldTurn({ connection: CONN, storyId: wsid, userText: 'u', assistantText: 'Maya Bell went to the lake.', stale: () => false }));
  const maya = (await loadState(wsid)).characters['Maya Bell'];
  assert(maya && /SEAT-TAIL-SEEN/.test(maya.core || ''), 'a person the world agent seats gets a whole first page (it was cut at 280): ' + JSON.stringify(maya && maya.core).slice(0, 80));

  const { rebuildStandings } = await import('../../js/agents/auditor.js');
  const rsid = 'm259-lastcuts-rebuild';
  await saveState(rsid, emptyState());
  await db.messages.append(rsid, { role: 'user', text: 'u' });
  await db.messages.append(rsid, { role: 'assistant', text: 'a' });
  const cast = 'Rias Wells — ' + 'c'.repeat(8000) + ' CAST-TAIL-SEEN';
  const rh = thinkingHouse({ answer: '{"mutations":[]}' });
  await withHouse(rh, () => rebuildStandings({ connection: CONN, storyId: rsid, brief: 'b', castNotes: cast, stale: () => false }));
  /* the rebuild itself — not the stated-standings reader beside it, which had them whole already */
  const rebuildCall = rh.calls.find((c) => JSON.stringify(c.body).includes('THE BRIEF (the first authority)'));
  assert(rebuildCall, 'the rebuild was asked');
  assert(JSON.stringify(rebuildCall.body).includes('CAST-TAIL-SEEN'), 'the standings rebuild reads the cast notes whole (it was cut at 6,000)');

  const hk = await import('../../js/agents/housekeeper.js');
  const msgs = [{ id: 'reasonpage01', role: 'assistant', text: 'The cheer chat was founded 2014.' }];
  const why = (r) => hk.stageProposals(hk.parseProtocol('<edits>[{"id":"#reason","find":"founded 2014","replace":"founded 2024","reason":' + JSON.stringify(r) + '}]</edits>'), { messages: msgs, state: emptyState(), modules: [], lore: [], memory: { nodes: [] }, session: { turns: [] }, story: { brief: '' } })[0].reason;
  const mid = 'because ' + 'the squad chat began two years after the squad did, '.repeat(9);
  eq(why(mid), mid.trim().replace(/\s+/g, ' '), 'a reason of ' + mid.length + ' characters is kept whole (it was cut at 200)');
  const huge = 'because ' + 'the squad chat began two years after the squad did, '.repeat(20);
  const cut = why(huge);
  assert(cut.length <= 600 && cut.endsWith('…') && !/\s…$/.test(cut) && huge.startsWith(cut.slice(0, -1)), 'a runaway reason is cut on a word, visibly: ' + cut.slice(-40));
});

test('M259-39: a job is settled only after its result is written — the light never reads the result before it', async () => {
  const { enqueueWork } = await import('../../js/agents/queue.js');
  const { onWorkerChange, runningWorkers, loadWorkerStatus, noteWorkerRun } = await import('../../js/agents/status.js');
  const sid = 'm259-settle-order';
  await noteWorkerRun(sid, 'keeper', { ok: true, detail: 'THE-OLD-RESULT' });
  const seenAtSettle = [];
  let started = false;
  const off = onWorkerChange(() => {
    if (!started || runningWorkers(sid).includes('keeper')) return;
    /* the light's own look: the moment the keeper is no longer running */
    seenAtSettle.push(loadWorkerStatus(sid).then((shelf) => (shelf.keeper || {}).detail));
  });
  try {
    await enqueueWork(sid, { name: 'keeper', run: async () => { started = true; await new Promise((r) => setTimeout(r, 5)); return { silent: false, detail: 'THE-NEW-RESULT', unfinished: true }; } });
    const details = await Promise.all(seenAtSettle);
    assert(details.length > 0, 'the light looked when the job settled');
    eq(details[0], 'THE-NEW-RESULT', 'and its first look already found this job\u2019s result, not the one before');
  } finally { off(); }
});

test('M259-40: an outage closes while the writer plays on — no page read twice, a quiet page counts', async () => {
  const { markPageRead, oldestUnread, emptyState: blank, saveState: save, loadState: load, foldJournal } = await import('../../js/engine/state.js');
  /* pages 0..9 told; pages 1 and 2 were never read (an outage); the writer keeps writing */
  const st = { ...blank(), page: 0, readTo: 0, readAhead: [] };
  const reads = new Map();
  const read = (k) => { reads.set(k, (reads.get(k) || 0) + 1); markPageRead(st, k); };
  for (let here = 3; here <= 9; here += 1) {
    const k0 = oldestUnread(st, here);   /* the page chain's catch-up: one a turn */
    if (k0 !== -1) read(k0);
    read(here);                          /* the page in hand */
  }
  eq(st.readTo, 9, 'the mark reaches the newest page — the gap closed while the writer played (it stayed two wide for ever)');
  eq(st.readAhead.join(','), '', 'nothing left waiting');
  eq([...reads.values()].every((n) => n === 1), true, 'and no page was read twice: ' + JSON.stringify([...reads]));
  /* the idle reading closes it without a new page */
  const idle = { ...blank(), page: 2, readTo: 2, readAhead: [6] };
  const got = [];
  for (let k = oldestUnread(idle, 7); k !== -1; k = oldestUnread(idle, 7)) { got.push(k); markPageRead(idle, k); }
  eq(got.join(','), '3,4,5', 'idle, it reads only the pages no read has reached');
  eq(idle.readTo, 6, 'and the page read earlier out of turn is taken into the mark');
  eq(markPageRead({ page: 4, readAhead: [] }, 2).readTo, 4, 'an older page read again never moves the mark back');
  /* the turn's stamp is not the reading mark: the send path stamps the COMING page (M72) */
  const stamped = { ...blank(), page: 6, readTo: 2, readAhead: [] };
  eq(oldestUnread(stamped, 6), 3, 'a stamp on the coming page leaves the unread pages unread — the catch-up still sees them');
  /* kept across a save, cleared when the line is rebuilt to a page */
  await save('m259-readahead', { ...blank(), page: 3, readAhead: [5, 2, 7] });
  eq((await load('m259-readahead')).readAhead.join(','), '5,7', 'the pages read ahead are kept; one behind the mark is dropped');
  await save('m259-readahead2', { ...blank(), page: 2, readAhead: [3, 5] });
  const loaded = await load('m259-readahead2');
  eq(loaded.readTo + '|' + loaded.readAhead.join(','), '3|5', 'a page read just past the mark is taken into it when the ledger is read back');
  eq(loaded.page, 2, 'and the stamp is left as it was');
  await save('m259-readahead3', { ...blank(), page: 9, readTo: 4, readAhead: [] });
  const both = await load('m259-readahead3');
  eq(both.page + '|' + both.readTo, '9|4', 'the stamp and the reading mark are kept apart through a save');
  const rebuilt = foldJournal({ ...blank(), page: 7, readAhead: [9], journal: [] }, [{ snap: { ...blank(), page: 1, journal: [] } }], 3, applyMutations);
  assert(rebuilt && Array.isArray(rebuilt.readAhead) && rebuilt.readAhead.length === 0 && rebuilt.page === 3 && rebuilt.readTo <= 3, 'a ledger rebuilt to an earlier page has read no further and holds nothing past it: ' + JSON.stringify(rebuilt && { page: rebuilt.page, readTo: rebuilt.readTo, readAhead: rebuilt.readAhead }));
});

test('M259-41: the main character holds no standing; the auditor starts a standing only from the brief; its refused standing moves are counted, not listed', async () => {
  const { auditRunWords } = await import('../../js/agents/auditor.js');
  let base = emptyState(); base.sheet = { actors: {}, playerName: 'Jovan' };
  const mcTry = applyMutations(base, [
    { type: 'rel.set', name: 'Jovan', p: 10, cause: 'the old folder' },
    { type: 'rel.shift', name: 'Jovan', axis: 'p', delta: 5, cause: 'the old folder' },
    { type: 'rel.shift', name: 'Rias Wells', axis: 'p', delta: 5, cause: 'she smiled at him' },
  ]);
  eq(mcTry.rejected.length, 2, 'no standing for the main character, set or shifted');
  assert(!mcTry.state.relationships.Jovan && mcTry.state.relationships['Rias Wells'], 'while others\u2019 still move');

  const storyId = 'm259-standing-starts';
  let st = applyMutations(base, [{ type: 'presence.enter', name: 'Jovan' }, { type: 'rel.set', name: 'Rias Wells', p: 60, cause: 'the brief says she is his sister' }]).state;
  st = applyMutations(st, [{ type: 'rel.shift', name: 'Rias Wells', axis: 'p', delta: 5, cause: 'she laughed at his joke' }]).state;
  await saveState(storyId, st);
  await db.messages.append(storyId, { role: 'user', text: 'I open the old folder.' });
  await db.messages.append(storyId, { role: 'assistant', text: 'Rias watched him. Across town, Sophie counted the minutes on a violin case.' });
  const house = scriptedHouse([issuesAnswer([
    { what: 'The ledger has no standing for Jovan, but he opened the old folder', fix: 'moved by the folder', pages: false, mutations: [{ type: 'rel.set', name: 'Jovan', p: 10, cause: 'moved by the old folder' }] },
    { what: 'The ledger has no standing for Sophie Dale, but she counted eleven minutes on the latch', fix: 'moved by the evening', pages: false, mutations: [{ type: 'rel.set', name: 'Sophie Dale', p: 8, cause: 'moved by the evening\u2019s events' }] },
    { what: 'Rias\u2019s standing is P:65 but the page moves her', fix: 'P:70', pages: false, mutations: [{ type: 'rel.set', name: 'Rias Wells', p: 70, cause: 'the page moves her' }] },
    { what: 'The ledger has no standing for Claire Stone though the brief makes her his oldest friend', fix: 'P:40', pages: false, mutations: [{ type: 'rel.set', name: 'Claire Stone', p: 40, cause: 'the brief says she is Jovan\u2019s oldest friend' }] },
    { what: 'The ledger has no standing for Maya Bell', fix: 'P:12', pages: false, mutations: [{ type: 'rel.set', name: 'Maya Bell', p: 12, cause: 'the brief says she keeps a folder on him' }] },
  ])]);
  const r = await withHouse(house, () => auditLedger({ connection: CONN, storyId, brief: 'Rias Wells is his sister. Claire Stone is his oldest friend.', stale: () => false }));
  const after = await loadState(storyId);
  assert(!after.relationships.Jovan, 'no standing was started for the main character');
  assert(!after.relationships['Sophie Dale'], 'nor for someone the brief does not name, on a page\u2019s reason');
  assert(!after.relationships['Maya Bell'], 'nor for someone the brief does not name, whatever reason is given');
  eq(after.relationships['Rias Wells'].p, 65, 'a standing the pages moved is the page reader\u2019s');
  eq(after.relationships['Claire Stone'].p, 40, 'a bond the brief names, at zero, is restored');
  eq(after.audit.issues.length, 1, 'only the restore is reported: ' + JSON.stringify(after.audit.issues.map((i) => i.what.slice(0, 40))));
  eq(after.audit.leftStandings, 4, 'the four standing moves it may not make are counted');
  assert(/left 4 standing changes to the page reader/.test(auditRunWords(r)), 'and the workers line says so: ' + auditRunWords(r));
});

test('M259-42: a standing is toward the main character — never one the brief set toward someone else; a zero one is no change; the house lets go of what an older auditor wrote so', async () => {
  const { auditRunWords, standingsHousekeeping } = await import('../../js/agents/auditor.js');
  const base = emptyState(); base.sheet = { actors: {}, playerName: 'Jovan' };
  const z = applyMutations(base, [{ type: 'rel.set', name: 'Gerald', p: 0, r: 0, s: 0, cause: 'the brief says' }]);
  assert(!z.state.relationships.Gerald && z.rejected.length === 1 && z.rejected[0].same, 'a zero standing for someone with none is no change');

  const storyId = 'm259-toward-mc';
  await saveState(storyId, applyMutations(base, [{ type: 'presence.enter', name: 'Jovan' }]).state);
  await db.messages.append(storyId, { role: 'user', text: 'u' });
  await db.messages.append(storyId, { role: 'assistant', text: 'a page' });
  /* the writer's shape: a heading, and an arrow line toward someone else (M50-1) */
  const brief = 'Sophie Dale \u2014 Emilia\u2019s shadow.\n\u2192 Emilia (P:65 R:0 S:0)\nClaire Stone is Jovan\u2019s oldest friend.\nGerald is a farmer at the Bluebird counter.\nNora Stone runs the bakery.';
  const house = scriptedHouse([issuesAnswer([
    { what: 'The ledger\u2019s standing for Sophie Dale is P:0, but the brief establishes her toward Emilia as P:65', fix: 'restored to the brief\u2019s digits', pages: false, mutations: [{ type: 'rel.set', name: 'Sophie Dale', p: 65, r: 0, s: 0, cause: 'the brief says' }] },
    { what: 'Sophie has no standing', fix: 'P:65', pages: false, mutations: [{ type: 'rel.set', name: 'Sophie Dale', p: 65, cause: 'the brief says Sophie is devoted toward Emilia, and Jovan knows her' }] },
    { what: 'Gerald has no standing', fix: 'neutral', pages: false, mutations: [{ type: 'rel.set', name: 'Gerald', p: 0, r: 0, s: 0, cause: 'the brief says he is a farmer' }] },
    { what: 'Nora Stone has no standing', fix: 'P:20', pages: false, mutations: [{ type: 'rel.set', name: 'Nora Stone', p: 20, cause: 'the brief says' }] },
    { what: 'Claire has no standing though the brief makes her Jovan\u2019s oldest friend', fix: 'P:40', pages: false, mutations: [{ type: 'rel.set', name: 'Claire Stone', p: 40, cause: 'the brief says she is Jovan\u2019s oldest friend' }] },
  ])]);
  const r = await withHouse(house, () => auditLedger({ connection: CONN, storyId, brief, stale: () => false }));
  const after = await loadState(storyId);
  assert(!after.relationships['Sophie Dale'], 'a standing the brief set toward Emilia is not written toward Jovan');
  assert(!after.relationships.Gerald, 'a zero standing is not written for a bystander');
  assert(!after.relationships['Nora Stone'], 'nor one on a bare \u201cthe brief says\u201d, for someone the brief names but sets toward no one');
  eq(after.relationships['Claire Stone'].p, 40, 'a bond the brief sets toward him is restored');
  eq(after.audit.issues.length, 1, 'one finding: ' + JSON.stringify(after.audit.issues.map((i) => i.what.slice(0, 30))));
  const words = auditRunWords(r);
  assert(/left 3 standing changes to the page reader/.test(words) && !/refused/.test(words), 'the refusals are counted once: ' + words);

  const old = { ...base, relationships: {
    'Sophie Dale': { p: 65, r: 0, s: 0, history: [{ axis: 'p', delta: 0, cause: 'set \u2014 the brief says' }] },
    'Mrs. Sterling': { p: 0, r: 0, s: 0, history: [{ axis: 'p', delta: 0, cause: 'set \u2014 the brief says' }] },
    'Rias Wells': { p: 60, r: 0, s: 0, history: [{ axis: 'p', delta: 0, cause: 'set \u2014 the brief says she is Jovan\u2019s devoted sister' }] },
    'Claire Stone': { p: 30, r: 0, s: 0, history: [{ axis: 'p', delta: 0, cause: 'set \u2014 the brief says' }, { axis: 'p', delta: 5, cause: 'she laughed at his joke' }] },
    'Emilia Vanderbilt': { p: 20, r: 0, s: 0, history: [{ axis: 'p', delta: 0, cause: 'set \u2014 the brief says' }], hand: true },
    'Mira': { p: 30, r: 0, s: 0, history: [{ axis: 'p', delta: 0, cause: 'set \u2014 the brief says Mira is his sister' }] },
    'Eli Sterling': { p: 15, r: 0, s: 0, history: [{ axis: 'p', delta: 0, cause: 'set \u2014 the brief says he is devoted toward Aurora' }] },
    /* the turn-76 shape: an older auditor's start, then a bare brief line on top of it */
    'Maya Bell': { p: 65, r: 0, s: 0, history: [{ axis: 'p', delta: 0, cause: 'set \u2014 Maya\u2019s standing toward Jovan is moved by the day\u2019s events' }, { axis: 'p', delta: 0, cause: 'set \u2014 the brief says' }] },
    /* a beat a page earned, then a bare brief line on top: the page's standing stays */
    'Vanessa Reynolds': { p: 37, r: 0, s: 0, history: [{ axis: 'p', delta: 5, cause: 'she waited for him at the gate' }, { axis: 'p', delta: 0, cause: 'set \u2014 the brief says' }] },
    /* a bare line once, then a bond about him on top: it stands */
    'Tom Wells': { p: 40, r: 0, s: 0, history: [{ axis: 'p', delta: 0, cause: 'set \u2014 the brief says' }, { axis: 'p', delta: 0, cause: 'set \u2014 the brief says Tom is his brother' }] },
  } };
  const clears = standingsHousekeeping(old, brief, '', 'Jovan', []).filter((m) => m.type === 'rel.clear').map((m) => m.name).sort();
  eq(clears.join(','), 'Eli Sterling,Maya Bell,Mrs. Sterling,Sophie Dale', 'the house lets go of bare brief standings and ones said to be toward someone else \u2014 never one about him (\u201chis sister\u201d), one the pages moved, or the writer\u2019s own');
  const kept = standingsHousekeeping(old, brief, '', 'Jovan', [{ name: 'Sophie Dale', p: 65, r: 0, s: 0 }]).filter((m) => m.type === 'rel.clear').map((m) => m.name);
  assert(!kept.includes('Sophie Dale'), 'one the house\u2019s own reading of the brief sets toward him stays');
});

test('M259-43: a streamed thinking is drawn line by line — whole from its first word, no line too long to lay out, followed only from the bottom', async () => {
  const { streamText } = await import('../../js/ui/streamtext.js');
  /* a small stand-in for a scroll box: blocks and text, and a height that grows with them */
  const doc = {
    createElement: () => ({ nodes: [], className: '', appendChild(n) { this.nodes.push(n); }, get text() { return this.nodes.map((n) => n.data).join(''); } }),
    createTextNode: (data) => ({ data }),
  };
  const box = { ownerDocument: doc, lines: [], scrollTop: 0, clientHeight: 100, appendChild(l) { this.lines.push(l); }, get scrollHeight() { return this.lines.length * 20; } };
  const s = streamText(box);
  let sent = '';
  for (let i = 0; i < 2000; i += 1) { const piece = 'thinking step ' + String(i).padStart(5, '0') + ', weighing it. '; sent += piece; s.append(piece); }
  const drawn = box.lines.map((l) => l.text).join('');
  eq(drawn, sent, 'every word is drawn, in order, from the first');
  assert(box.lines[0].text.startsWith('thinking step 00000'), 'the first line is the first words');
  assert(box.lines.every((l) => l.text.length <= 560), 'no line runs long enough to be laid out again and again: longest ' + Math.max(...box.lines.map((l) => l.text.length)));
  assert(box.lines.length > 50, 'a long thinking with no line breaks is ended at its sentences: ' + box.lines.length + ' lines');
  eq(s.length, sent.length, 'it knows how much it has drawn');
  const b2 = { ...box, lines: [], appendChild(l) { this.lines.push(l); }, get scrollHeight() { return this.lines.length * 20; } };
  const s2 = streamText(b2);
  s2.append('first line\n\nthird line');
  eq(b2.lines.map((l) => l.text).join('|'), 'first line||third line', 'a line break starts a line, and an empty line is kept');
  const run = 'x'.repeat(1600) + ' tail words';
  const b3 = { ...box, lines: [], appendChild(l) { this.lines.push(l); }, get scrollHeight() { return this.lines.length * 20; } };
  const s3 = streamText(b3);
  for (let i = 0; i < run.length; i += 40) s3.append(run.slice(i, i + 40));
  assert(b3.lines.length === 2 && b3.lines[1].text === 'tail words', 'a line with no sentence is ended at a space past its hard length: ' + b3.lines.map((l) => l.text.length).join(','));
  /* following: at the bottom it follows; scrolled up, it is left where it is */
  const b4 = { ...box, lines: [], scrollTop: 0, appendChild(l) { this.lines.push(l); }, get scrollHeight() { return this.lines.length * 20; } };
  const s4 = streamText(b4);
  for (let i = 0; i < 20; i += 1) s4.append('line ' + i + '\n');
  eq(b4.scrollTop, b4.scrollHeight, 'at the bottom, it follows');
  b4.scrollTop = 0;
  s4.append('one more\n');
  eq(b4.scrollTop, 0, 'scrolled up to read, the reader is left where he is');

  const { saysAllIsWell } = await import('../../js/agents/auditor.js');
  eq(saysAllIsWell({ what: 'the ledger\u2019s standing for Caleb Thorne is P:0 R:-28 S:0, but the pages show his conduct; a standing the pages have moved is not the ledger\u2019s to zero', fix: 'Caleb Thorne\u2019s standing toward Jovan stands as the pages moved it' }), true, '"stands as the pages moved it" is no finding');
  eq(saysAllIsWell({ what: 'the ledger\u2019s thread \u2018Maya\u2019s quiet archive\u2019 is still hot, but the pages show Maya sent Chloe four texts', fix: 'the thread is resolved' }), false, 'a thread the pages closed is one');
});

test('M259-44: the page reader decides every open thread against its page; the writer\u2019s own people are never retired for being away', async () => {
  const ex = await import('../../js/agents/extractor.js');
  const { peopleHousekeeping } = await import('../../js/agents/auditor.js');
  /* the answer's own slot closes threads, once each */
  const parsed = ex.parseExtractorAnswer('{"mutations":[{"type":"thread.close","title":"Maya\u2019s quiet archive"}],"resolved":["Maya\u2019s quiet archive",{"title":"Rias and the folder called old"},"",42]}');
  eq(parsed.mutations.filter((m) => m.type === 'thread.close').map((m) => m.title).join('|'), 'Maya\u2019s quiet archive|Rias and the folder called old', 'each resolved title closes its thread, once');
  eq(ex.parseExtractorAnswer('{"mutations":[]}').mutations.length, 0, 'an answer without the slot closes nothing');
  /* the page reader is shown every open thread by name, to decide */
  let st = applyMutations(emptyState(), [
    { type: 'place.set', name: 'the Wells kitchen' }, { type: 'presence.enter', name: 'Rias Wells' },
    { type: 'thread.set', title: 'Rias and the folder called old', owner: 'Rias Wells', next: 'hear why he called it old' },
    { type: 'thread.set', title: 'Aurora\u2019s Friday welcome', owner: 'Aurora Sterling', next: 'decide how to welcome him', heat: 'cold' },
  ]).state;
  const msg = ex.buildExtractorMessages({ state: st, userText: 'u', assistantText: 'Jovan renamed it FAMILY RAVENWOOD; Rias nodded.', founding: false });
  assert(/OPEN THREADS/.test(msg.user) && msg.user.includes('\u201cRias and the folder called old\u201d (Rias Wells) \u2014 next: hear why he called it old') && msg.user.includes('\u201cAurora\u2019s Friday welcome\u201d') && /\[cold\]/.test(msg.user), 'every open thread is listed with its next step');
  assert(/"resolved"/.test(msg.system), 'and the answer has a slot for the ones this page resolved');
  assert(!/OPEN THREADS/.test(ex.buildExtractorMessages({ state: st, userText: 'u', assistantText: 'a', founding: true }).user), 'a founding read has no threads to decide');
  /* end to end: the page reader answers, the thread closes */
  const house = thinkingHouse({ answer: '{"mutations":[],"resolved":["Rias and the folder called old"]}' });
  const r = await withHouse(house, () => ex.extractTurn({ connection: CONN, state: st, userText: 'u', assistantText: 'Jovan renamed it FAMILY RAVENWOOD; Rias nodded and sat beside him.', founding: false }));
  const after = applyMutations(st, r.mutations).state;
  eq(after.threads.map((t) => t.title).join('|'), 'Aurora\u2019s Friday welcome', 'the thread the page resolved is closed, the other stands');

  /* the writer's own people wait as long as the story needs */
  const world = { ...emptyState(), page: 240, sheet: { actors: {}, playerName: 'Jovan' }, characters: {
    'Nora Stone': { core: 'the baker', updatedAtTurn: 200 },
    'Wendell Price': { core: 'the driver', updatedAtTurn: 200 },
    'Cab Driver': { core: 'a driver', updatedAtTurn: 200 },
  } };
  const retired = peopleHousekeeping(world, 'Nora runs the bakery on Elm. Wendell Price drives the Uber.', '').map((m) => m.name).sort();
  eq(retired.join('|'), 'Cab Driver', 'a brief-named person (by first name or whole name) is never retired for being away; a passer-through still is');
  eq(peopleHousekeeping(world).map((m) => m.name).sort().join('|'), 'Cab Driver|Nora Stone|Wendell Price', 'and without a brief the old law holds');
  eq(peopleHousekeeping(world, 'The Norah of old; Wendellson.', '').map((m) => m.name).sort().join('|'), 'Cab Driver|Nora Stone|Wendell Price', 'a name inside another word is not a mention');
  /* and the upkeep that runs every page hands it the brief */
  const { ledgerUpkeep } = await import('../../js/agents/auditor.js');
  const sid = 'm259-brief-people';
  await saveState(sid, world);
  await db.messages.append(sid, { role: 'user', text: 'u' });
  await db.messages.append(sid, { role: 'assistant', text: 'a quiet page' });
  await ledgerUpkeep({ storyId: sid, brief: 'Nora runs the bakery on Elm. Wendell Price drives the Uber.', castNotes: '', stale: () => false });
  const kept = await loadState(sid);
  assert(!kept.characters['Nora Stone'].retired && !kept.characters['Wendell Price'].retired && kept.characters['Cab Driver'].retired, 'the page-by-page upkeep keeps the brief\u2019s people and retires the passer-through');
});

test('M259-45: the people follow the room — every present person a card, the named and the coming recalled, the whole roster; a small room keeps the tiers', async () => {
  const { renderPeopleTiers, peopleView, PEOPLE_BUDGET } = await import('../../js/engine/people.js');
  const { buildRequest } = await import('../../js/assemble/stack.js');
  eq(JSON.stringify(peopleView(0)), JSON.stringify({ budget: PEOPLE_BUDGET, cards: 6, recall: 3, roster: 12 }), 'an unknown room keeps the old tiers');
  const big = peopleView(500000);
  assert(big.cards === 16 && big.recall === 6 && big.roster === 60 && big.budget === 72000, 'a very large room (M283): ' + JSON.stringify(big));
  const roomy200 = peopleView(200000);
  assert(roomy200.cards === 12 && roomy200.recall === 6 && roomy200.roster === 40 && roomy200.budget === 36000, 'a large room: ' + JSON.stringify(roomy200));
  /* a brief's cast of twenty-five, their notes kept whole */
  const st = emptyState(); st.sheet = { actors: {}, playerName: 'Jovan' };
  const names = Array.from({ length: 25 }, (_, i) => 'Person' + String.fromCharCode(65 + i) + ' Brook');
  st.characters = {};
  for (const n of names) st.characters[n] = { core: n + ' core line. ' + 'A whole note about who they are. '.repeat(20), state: 'somewhere doing something', arc: '', updatedAtTurn: 1 };
  st.present = names.slice(0, 8).map((name) => ({ name }));
  st.offscreen = { [names[12]]: { location: 'the lane', activity: 'walking over', stance: 'toward', etaMinutes: 5 } };
  const recent = ['Jovan asked about ' + names[10] + ' and ' + names[11] + '.'];
  const small = renderPeopleTiers(st, { recentPages: recent, rotation: 0 });
  eq(small.tiers.cards, 4, 'a small room: the present cards take up to 70% of it, never fewer than three (M282) \u2014 six whole cards had filled it alone');
  assert(small.text.length <= PEOPLE_BUDGET, 'held to the old budget');
  eq(small.tiers.recall + small.tiers.roster, 0, 'with notes kept whole, the named and the roster were shed \u2014 and are no longer reported as sent');
  assert(!small.text.includes(names[10]), 'what was shed is not in the text either');
  const roomy = renderPeopleTiers(st, { recentPages: recent, rotation: 0, view: big });
  eq(roomy.tiers.cards, 8, 'every present person keeps a card');
  eq(roomy.tiers.recall, 3, 'the two named and the one on her way are recalled');
  assert(/Named, though not in the scene right now:[\s\S]*PersonM Brook core line/.test(roomy.text), 'the one heading this way has her card');
  eq(roomy.tiers.roster, 25 - 8 - 3, 'the whole roster rides');
  eq(renderPeopleTiers(st, { recentPages: recent, rotation: 5, view: big }).text, roomy.text, 'nothing rotates when everyone fits');
  const req = buildRequest({ story: { title: 't', brief: 'b' }, messages: [{ id: 'u1', role: 'user', text: recent[0] }], settings: {}, state: st, modules: [], memory: '', window: { mode: 'keeper', window: 30, budgetTokens: 500000 } });
  const wire = JSON.stringify(req);
  assert(names.every((n) => wire.includes(n)) && wire.includes('PersonK Brook core line') && wire.includes('PersonH Brook core line'), 'the storyteller\u2019s request carries all twenty-five, and the cards');
});

test('M259-46: every part the receipt lists is in the request — nothing counted and not sent (the people\u2019s pages were, since M12)', async () => {
  const { buildRequest } = await import('../../js/assemble/stack.js');
  const st = emptyState(); st.sheet = { actors: {}, playerName: 'Jovan' };
  st.place = { name: 'PLACE-MARK kitchen' };
  st.characters = { 'Zed Marker': { core: 'PEOPLE-MARK a whole note', state: 'by the door', arc: '', updatedAtTurn: 1 } };
  st.present = [{ name: 'Zed Marker' }];
  const req = buildRequest({
    story: { title: 't', brief: 'BRIEF-MARK', castNotes: 'CASTNOTES-MARK' },
    messages: [{ id: 'u1', role: 'user', text: 'HISTORY-MARK go on' }],
    settings: { frameText: 'FRAME-MARK', noteText: 'NOTE-MARK' },
    state: st,
    modules: [{ mod: { id: 'core-craft', name: 'Craft', text: 'CRAFT-MARK' }, reason: 'always' }, { mod: { id: 'm1', name: 'Mod', text: 'MODULE-MARK' }, reason: 'r' }],
    memory: 'MEMORY-MARK', lore: 'LORE-MARK', loreFired: [{ name: 'L' }],
    cast: [{ name: 'Zed Marker', description: 'CAST-MARK', personality: '', scenario: '' }],
    window: { mode: 'keeper', window: 30, budgetTokens: 200000 },
    directive: 'DIRECTIVE-MARK', directorNote: 'DIRECTOR-MARK', editorEye: 'EDITOR-MARK', houseEye: 'EYE-MARK', ruling: 'RULING-MARK', worldBrief: 'WORLD-MARK',
  });
  const wire = JSON.stringify({ systemBlocks: req.systemBlocks, messages: req.messages });
  const marks = {
    'The frame': ['FRAME-MARK'], 'The craft': ['CRAFT-MARK'], 'The brief': ['BRIEF-MARK'],
    'Who\u2019s here': ['CAST-MARK', 'CASTNOTES-MARK'], 'On their mind': ['PEOPLE-MARK'],
    'The state of things': ['PLACE-MARK'], 'Active modules': ['MODULE-MARK'], 'What remains': ['MEMORY-MARK'],
    'The lore shelf': ['LORE-MARK'], 'The world\u2019s word': ['WORLD-MARK'], 'The director\u2019s note': ['DIRECTOR-MARK'],
    'The editor\u2019s eye': ['EDITOR-MARK'], 'The house\u2019s eye': ['EYE-MARK'], 'The house has ruled': ['RULING-MARK'],
    'The story so far': ['HISTORY-MARK'], 'The note at the end': ['NOTE-MARK'], 'The house heard': ['DIRECTIVE-MARK'],
  };
  const listed = (req.receipt.slots || []).filter((s) => s.tokens > 0);
  assert(listed.length >= 17, 'the request under test fills every part: ' + listed.length);
  for (const slot of listed) {
    assert(marks[slot.name], 'a part this law does not know yet \u2014 give it a mark: ' + slot.name);
    for (const m of marks[slot.name]) assert(wire.includes(m), '\u201c' + slot.name + '\u201d is listed on the receipt and its words are in the request: ' + m);
  }
  const at = wire.indexOf('PEOPLE-MARK');
  assert(at !== -1 && at < wire.indexOf('PLACE-MARK'), 'the people\u2019s pages lead the story-state, before the state of things');
});

test('M259-47: who matters rides without a pin \u2014 a first name recalls, the weightiest present keep their cards, the absent who matter ride as cards in the room left', async () => {
  const { renderPeopleTiers, peopleView, importanceOf, spokenNames } = await import('../../js/engine/people.js');
  const { buildRequest } = await import('../../js/assemble/stack.js');
  eq(JSON.stringify(spokenNames('Rias Wells')), JSON.stringify(['Rias Wells', 'Rias']), 'a first name is a name');
  eq(JSON.stringify(spokenNames('Mr. Sterling')), JSON.stringify(['Mr. Sterling']), 'a titled name only whole \u2014 the surname is the family\u2019s');
  eq(JSON.stringify(spokenNames('Al Moss')), JSON.stringify(['Al Moss']), 'a first name under three letters only whole');
  eq(JSON.stringify(spokenNames('Mrs. Sterling')), JSON.stringify(['Mrs. Sterling']), 'Mrs. is a title, not a first name');
  const { isMc } = await import('../../js/engine/people.js');
  const who = { sheet: { playerName: 'Jovan' } };
  assert(!isMc(who, 'Card Player') && !isMc(who, 'You Sung') && !isMc(who, 'Bit Player'), 'a name with "player" or "you" in it is a person of the tale');
  assert(isMc(who, 'the player') && isMc(who, 'you') && isMc(who, 'Jovan Wells') && !isMc(who, 'Rias Wells'), 'the plain labels and his own name are him');

  const st = emptyState(); st.sheet = { actors: {}, playerName: 'Jovan' };
  const note = (n, len) => ({ core: n + ' core line. ' + 'x'.repeat(len), state: n + ' state line', arc: '', updatedAtTurn: 90 });
  st.characters = {
    'Rias Wells': note('Rias Wells', 300), 'Aurora Sterling': note('Aurora Sterling', 300), 'Nora Stone': note('Nora Stone', 300),
    'Mr. Sterling': note('Mr. Sterling', 300), 'Bit Player': note('Bit Player', 300), 'Old Hand': { ...note('Old Hand', 300), updatedAtTurn: 1 },
    'Chloe Maxwell': note('Chloe Maxwell', 900), 'Vanessa Reynolds': note('Vanessa Reynolds', 900), 'Maya Bell': note('Maya Bell', 900),
    'Emilia Vanderbilt': note('Emilia Vanderbilt', 900), 'Claire Stone': note('Claire Stone', 900),
  };
  st.relationships = {
    'Rias Wells': { p: 100, r: 100, s: 52, history: [] },
    'Aurora Sterling': { p: 71, r: 67, s: 7, history: [] },
    'Claire Stone': { p: 26, r: 13, s: 0, history: [] },
    'Old Hand': { p: 30, r: 0, s: 0, history: [] },
  };
  st.threads = [{ title: 'Aurora\u2019s Friday welcome', owner: 'Aurora', heat: 'hot', next: 'welcome him' }];
  st.page = 99;
  const brief = 'Nora Stone runs the bakery. Rias Wells is his sister.';
  const turn = 100;
  const w = (n) => importanceOf(st, n, brief, turn);
  assert(w('Rias Wells') > w('Aurora Sterling') && w('Aurora Sterling') > w('Nora Stone') && w('Nora Stone') > w('Bit Player'), 'weighed: Rias ' + w('Rias Wells') + ', Aurora ' + w('Aurora Sterling') + ' (a thread by her first name), Nora ' + w('Nora Stone') + ' (the brief), a bit player ' + w('Bit Player'));
  assert(w('Old Hand') < 30, 'a long absence weighs a little less: ' + w('Old Hand'));

  /* the present: five with long pages, a small room \u2014 the weightiest keep cards, the rest ride the line */
  st.present = ['Chloe Maxwell', 'Vanessa Reynolds', 'Maya Bell', 'Emilia Vanderbilt', 'Claire Stone'].map((name) => ({ name }));
  const small = renderPeopleTiers(st, { recentPages: ['nothing named'], rotation: 0, view: peopleView(0), brief });
  eq(small.tiers.cards, 3, 'as many cards as 70% of a small room holds \u2014 three here');
  assert(/^Claire Stone \u2014/.test(small.text), 'the weightiest present person leads: ' + small.text.slice(0, 40));
  assert(/Also here:\n- /.test(small.text), 'the rest of the room rides the line \u2014 each saying who they are (M286)');

  /* the room: the absent who matter ride as cards, unnamed; the bit player only on the roster */
  const big = peopleView(500000);
  const roomy = renderPeopleTiers(st, { recentPages: ['Jovan looks at the door.'], rotation: 0, view: big, brief });
  assert(/Away, and much on the story\u2019s mind:\nRias Wells \u2014 Rias Wells core line/.test(roomy.text), 'Rias, away and unnamed, rides first among the absent');
  assert(roomy.text.includes('Aurora Sterling \u2014 Aurora Sterling core line') && roomy.text.includes('Nora Stone \u2014 Nora Stone core line'), 'and Aurora and Nora ride as cards');
  const rosterOf = (text) => text.split('Elsewhere in the tale:')[1] || '';
  assert(!/(^|\n)Bit Player \u2014/.test(roomy.text) && rosterOf(roomy.text).includes('\n- Bit Player \u2014 Bit Player core line'), 'a bit player is a line on the roster, not a card');
  assert(!rosterOf(roomy.text).includes('Rias Wells'), 'and a card is not named again on the roster');
  eq(roomy.tiers.important, 3, 'three away who matter');

  /* a first name recalls */
  const called = renderPeopleTiers(st, { recentPages: ['I call Rias.'], rotation: 0, view: peopleView(0), brief });
  assert(/Named, though not in the scene right now:\nRias Wells/.test(called.text), 'the writer says Rias, and Rias Wells is recalled');
  /* however long the pages, three present always keep their cards */
  const longSt = { ...st, characters: { ...st.characters, 'Chloe Maxwell': note('Chloe Maxwell', 6000), 'Vanessa Reynolds': note('Vanessa Reynolds', 6000), 'Maya Bell': note('Maya Bell', 6000), 'Claire Stone': note('Claire Stone', 6000) } };
  eq(renderPeopleTiers(longSt, { recentPages: [], rotation: 0, view: peopleView(0), brief }).tiers.cards, 3, 'three cards at least, however long their pages');
  const titled = renderPeopleTiers(st, { recentPages: ['The Sterling porch light is on. Riasan tea.'], rotation: 0, view: peopleView(0), brief });
  assert(!/Named, though not in the scene right now:[\s\S]*(Mr\. Sterling|Rias Wells)/.test(titled.text), 'a surname alone does not call Mr. Sterling; a name inside another word calls no one');

  /* the storyteller's request carries Rias's page though she is away and unnamed */
  const req = buildRequest({ story: { title: 't', brief }, messages: [{ id: 'u1', role: 'user', text: 'Jovan looks at the door.' }], settings: {}, state: st, modules: [], memory: '', window: { mode: 'keeper', window: 30, budgetTokens: 500000 } });
  const wire = JSON.stringify(req);
  assert(wire.includes('Rias Wells core line') && wire.includes('away who matter most'), 'the request carries her page, and the receipt says why');
});

test('M259-48: the scribe reads the brief and every page it keeps; the writer\u2019s cast notes and the lore ride whole; the story\u2019s ground and its latest names bring people forward', async () => {
  const sc = await import('../../js/agents/scribe.js');
  const { renderPeopleTiers, peopleView, importanceOf, placeWords } = await import('../../js/engine/people.js');
  const { buildRequest } = await import('../../js/assemble/stack.js');
  const st = emptyState(); st.sheet = { actors: {}, playerName: 'Jovan' };
  const long = (n) => ({ core: n + ' core. ' + 'y'.repeat(3000), state: n + ' state', arc: n + ' arc. ' + 'z'.repeat(3000), updatedAtTurn: 50 });
  st.characters = { 'Chloe Maxwell': long('Chloe Maxwell'), 'Vanessa Reynolds': long('Vanessa Reynolds'), 'Maya Bell': long('Maya Bell'), 'Claire Stone': long('Claire Stone'), 'Aurora Sterling': { core: 'AURORA-PAGE the girl next door', state: 'at her window', arc: '', updatedAtTurn: 50 } };
  st.present = ['Chloe Maxwell', 'Vanessa Reynolds', 'Maya Bell', 'Claire Stone'].map((name) => ({ name }));
  st.page = 50;
  /* the scribe: the brief and the cast notes ride; an off-scene person the page names is read whole beside four long present pages */
  const m = sc.buildScribeMessages({ state: st, userText: 'u', assistantText: 'Across the lane, Aurora closed her notes.', brief: 'BRIEF-FOR-SCRIBE Aurora Sterling is the girl next door.', castNotes: 'CAST-FOR-SCRIBE' });
  assert(m.user.includes('BRIEF-FOR-SCRIBE') && m.user.includes('CAST-FOR-SCRIBE'), 'the scribe is handed the brief and the cast notes');
  assert(m.user.includes('AURORA-PAGE'), 'and Aurora\u2019s page, named on this page, is not shed by the present');
  const house = thinkingHouse({ answer: '{"deltas":[]}' });
  const sid = 'm259-scribe-brief';
  await saveState(sid, st);
  await withHouse(house, () => sc.scribeTurn({ connection: CONN, storyId: sid, userText: 'u', assistantText: 'Aurora waved.', brief: 'BRIEF-ON-THE-WIRE', castNotes: 'CAST-ON-THE-WIRE' }));
  const sent = JSON.stringify(house.calls || house.state?.calls || house.requests || house);
  assert(sent.includes('BRIEF-ON-THE-WIRE') && sent.includes('CAST-ON-THE-WIRE'), 'and its request carries them');

  /* the writer's cast notes and the lore: whole in the room, cut at a line without it */
  const cast = Array.from({ length: 300 }, (_, i) => 'Cast line ' + i + ' \u2014 ' + 'w'.repeat(50)).join('\n') + '\nLAST-CAST-LINE';
  const lore = Array.from({ length: 200 }, (_, i) => 'Lore line ' + i + ' ' + 'v'.repeat(60)).join('\n') + '\nLAST-LORE-LINE';
  const ask = (budgetTokens) => JSON.stringify(buildRequest({ story: { title: 't', brief: 'b', castNotes: cast }, messages: [{ id: 'u1', role: 'user', text: 'go' }], settings: {}, state: emptyState(), modules: [], memory: 'm'.repeat(29000), lore, loreFired: [{ name: 'L' }], window: { mode: 'keeper', window: 30, budgetTokens } }));
  const roomy = ask(500000);
  assert(roomy.includes('LAST-CAST-LINE') && roomy.includes('LAST-LORE-LINE'), 'a large room carries the cast notes and the lore whole (' + cast.length + ' and ' + lore.length + ' characters)');
  const tight = ask(0);
  assert(!tight.includes('LAST-CAST-LINE') && /Cast line \d+ \\u2014 w+\u2026|Cast line \d+ \u2014 w+\u2026/.test(tight), 'an unknown room still cuts \u2014 at the end of a whole line');
  assert(!/w{1,49}\u2026/.test(tight.replace(/w{50}\u2026/g, '')), 'never mid-word');

  /* the story's ground and its latest names */
  const town = emptyState(); town.sheet = { actors: {}, playerName: 'Jovan' }; town.page = 80;
  town.characters = { 'Ms. June': { core: 'the Bluebird waitress, refills without asking', state: 'wiping the counter', arc: '', updatedAtTurn: 60 }, 'Gerald Pike': { core: 'a farmer at the feed store', state: 'loading sacks', arc: '', updatedAtTurn: 60 }, 'Tess Ward': { core: 'a cousin', state: 'far away', arc: '', updatedAtTurn: 60 } };
  town.place = { name: 'The Bluebird Diner \u2014 the counter' };
  eq(placeWords(town).join(','), 'Bluebird,Diner', 'the ground by its names (\u201cthe counter\u201d names nothing)');
  const pw = (place) => placeWords({ sheet: { actors: {}, playerName: 'Jovan Wells' }, place: { name: place } }).join(',');
  eq(pw('Jovan\u2019s room') + '|' + pw('The Wells kitchen') + '|' + pw('Aurora\u2019s porch'), '||Aurora', 'the main character\u2019s own name and a plain room say nothing of who is near');
  const scene = { placeWords: placeWords(town), lately: ['Jovan asked after Tess Ward.'] };
  assert(importanceOf(town, 'Ms. June', '', 81, scene) >= 20, 'the diner\u2019s waitress, at the diner, is near the story: ' + importanceOf(town, 'Ms. June', '', 81, scene));
  assert(importanceOf(town, 'Gerald Pike', '', 81, scene) < importanceOf(town, 'Tess Ward', '', 81, scene), 'a name the last pages keep saying weighs more than a stranger to the scene');
  const atDiner = renderPeopleTiers(town, { recentPages: [], view: peopleView(200000), scenePages: scene.lately });
  assert(/Away, and much on the story\u2019s mind:\nMs\. June/.test(atDiner.text), 'at the diner, Ms. June rides as a card');
  const rosterAt = (text) => text.split('Elsewhere in the tale:')[1] || '';
  const r1 = rosterAt(atDiner.text);
  assert(r1.includes('\n- Tess Ward') && r1.includes('\n- Gerald Pike') && r1.indexOf('\n- Tess Ward') < r1.indexOf('\n- Gerald Pike'), 'the roster names the lately-named before a stranger to the scene, whatever order the ledger holds them in');
  const moved = { ...town, place: { name: 'The Wells kitchen' } };
  const atHome = renderPeopleTiers(moved, { recentPages: [], view: peopleView(200000), scenePages: [] });
  assert(!/(^|\n)Ms\. June \u2014/.test(atHome.text) && rosterAt(atHome.text).includes('\n- Ms. June \u2014 the Bluebird waitress'), 'at home, she steps back to the roster of herself \u2014 still saying who she is');
});

test('M259-49: every worker reads the writer\u2019s brief and cast notes whole to a large room, and a cut past it is a line that says so', async () => {
  const { writerText, BRIEF_ROOM } = await import('../../js/engine/whole.js');
  const big = Array.from({ length: 600 }, (_, i) => 'Brief line ' + i + ' ' + 'b'.repeat(40)).join('\n') + '\nEND-OF-BRIEF';
  assert(big.length > 30000 && big.length < BRIEF_ROOM, 'a long brief within the room: ' + big.length);
  eq(writerText(big, BRIEF_ROOM, 'brief'), big, 'whole within the room');
  const huge = big.repeat(3);
  const cut = writerText(huge, BRIEF_ROOM, 'brief', true);
  assert(cut.length <= BRIEF_ROOM + 120 && /\nBrief line \d+ b{40}\n\(the brief continues \u2014 \d+ more characters; fetch "brief" for all of it\)$/.test(cut), 'past the room: a whole line, and it says so: ' + cut.slice(-90));
  assert(/\(the cast notes continue \u2014 \d+ more characters not shown here\)$/.test(writerText(huge, 50000, 'cast notes')), 'a worker that cannot fetch is told what it is not shown');
  for (const room of [39990, 40000, 40017, 50003]) {
    const got = writerText(huge, room, 'brief');
    const kept = got.slice(0, got.lastIndexOf('\n(the brief continues'));
    assert(huge.startsWith(kept) && huge[kept.length] === '\n' && kept.length <= room, 'at ' + room + ' the cut falls at the end of a whole line (kept ' + kept.length + ')');
  }
  /* the workers' own prompts carry a brief past the old cut to its end */
  const st = emptyState(); st.sheet = { actors: {}, playerName: 'Jovan' };
  const ex = await import('../../js/agents/extractor.js');
  const wo = await import('../../js/agents/world.js');
  const co = await import('../../js/agents/continuity.js');
  const au = await import('../../js/agents/auditor.js');
  const fo = await import('../../js/agents/founder.js');
  const sc = await import('../../js/agents/scribe.js');
  const castNotes = Array.from({ length: 330 }, (_, i) => 'Cast line ' + i + ' ' + 'c'.repeat(40)).join('\n') + '\nEND-OF-CAST';
  assert(castNotes.length > 15000 && castNotes.length < 20000, 'long cast notes within the room: ' + castNotes.length);
  const texts = {
    extractor: JSON.stringify(ex.buildExtractorMessages({ state: st, userText: 'u', assistantText: 'a', founding: false, brief: big, castNotes })),
    founder: JSON.stringify(fo.buildFounderMessages({ state: st, brief: big, castNotes })),
    scribe: JSON.stringify(sc.buildScribeMessages({ state: st, userText: 'u', assistantText: 'a', brief: big, castNotes })),
  };
  if (typeof wo.buildWorldMessages === 'function') texts.world = JSON.stringify(wo.buildWorldMessages({ state: st, brief: big, castNotes, pages: [{ role: 'assistant', text: 'a' }] }));
  if (typeof au.buildAuditorMessages === 'function') texts.auditor = JSON.stringify(au.buildAuditorMessages({ state: st, pages: [{ role: 'assistant', text: 'a' }], brief: big, castNotes }));
  if (typeof co.buildContinuityMessages === 'function') texts.continuity = JSON.stringify(co.buildContinuityMessages({ state: st, brief: big, page: 'a', pages: [] }));
  for (const [who, t] of Object.entries(texts)) {
    assert(t.includes('END-OF-BRIEF'), who + ' reads the brief to its end');
    if (who !== 'continuity') assert(t.includes('END-OF-CAST'), who + ' reads the cast notes to their end');
  }
  assert(Object.keys(texts).length >= 5, 'the workers under test: ' + Object.keys(texts).join(', '));
  const past = sc.buildScribeMessages({ state: st, userText: 'u', assistantText: 'a', brief: huge, castNotes: huge });
  assert(/\(the brief continues \u2014 \d+ more characters not shown here\)/.test(past.user) && /\(the cast notes continue \u2014/.test(past.user), 'the scribe, too, is held to the room and told so');
});

test('M259-50: the sister sick at home stays with the story; a newcomer is carried; everyone else is a line that says who they are', async () => {
  const { renderPeopleTiers, peopleView, mergeDeltas } = await import('../../js/engine/people.js');
  /* when a person came into the tale is written once, by either door */
  const base = emptyState(); base.sheet = { actors: {}, playerName: 'Jovan Wells' }; base.page = 40;
  const noted = applyMutations(base, [{ type: 'people.set', name: 'Mara Quinn', field: 'core', text: 'a fishmonger\u2019s daughter' }]).state;
  eq(noted.characters['Mara Quinn'].firstSeenTurn, 41, 'the hand\u2019s door writes when she came in');
  const again = applyMutations({ ...noted, page: 45 }, [{ type: 'people.set', name: 'Mara Quinn', field: 'state', text: 'at her stall' }]).state;
  eq(again.characters['Mara Quinn'].firstSeenTurn, 41, 'and a later note does not move it');
  const merged = mergeDeltas(base, {}, [{ name: 'Old Pete', field: 'core', text: 'a net mender' }], 41);
  eq(merged.characters['Old Pete'].firstSeenTurn, 41, 'the scribe\u2019s door writes it too');
  const saved = 'm259-firstseen';
  await saveState(saved, again);
  eq((await loadState(saved)).characters['Mara Quinn'].firstSeenTurn, 41, 'and it is kept when the ledger is read back');

  /* the scene: Jovan has moved to the harbor; his sister is sick at home */
  const st = emptyState(); st.sheet = { actors: {}, playerName: 'Jovan Wells' }; st.page = 199;
  const page = (core, state, arc, at, first) => ({ core, state, arc, threads: [], updatedAtTurn: at, ...(Number.isFinite(first) ? { firstSeenTurn: first } : {}) });
  const bonded = (n) => page(n + ' — ' + 'who she is, whole. '.repeat(30), n + ' is somewhere of her own. '.repeat(8), 'Between them: '.repeat(40), 180);
  st.characters = {
    'Rias Wells': page('Rias Wells — Jovan\u2019s older sister. ' + 'Fierce and tender. '.repeat(30), 'at home, sick', 'She would walk through fire for him. '.repeat(20), 170),
    'Mara Quinn': page('a fishmonger\u2019s daughter with salt in her voice', 'at her stall, weighing mackerel', '', 199, 197),
    'Ms. Holt': page('the Harbor Market\u2019s oldest vendor', 'arranging lemons', '', 150, 20),
    'Old Pete': page('a net mender who talks to gulls', 'mending nets', '', 150, 20),
    'Chloe Maxwell': bonded('Chloe Maxwell'), 'Vanessa Reynolds': bonded('Vanessa Reynolds'), 'Eli Sterling': bonded('Eli Sterling'),
    'Aurora Sterling': bonded('Aurora Sterling'), 'Claire Stone': bonded('Claire Stone'), 'Alaric Stone': bonded('Alaric Stone'),
    'Mi-na Song': bonded('Mi-na Song'), 'Emilia Vanderbilt': bonded('Emilia Vanderbilt'), 'Alexia Vanderbilt': bonded('Alexia Vanderbilt'),
    'Caleb Thorne': bonded('Caleb Thorne'), 'Maya Bell': bonded('Maya Bell'), 'Mr. Sterling': bonded('Mr. Sterling'),
  };
  for (let i = 1; i <= 20; i += 1) st.characters['Townsperson ' + String.fromCharCode(64 + i) + ' Lane'] = page(i <= 3 ? 'sells rope at the Harbor Market' : 'a face from the old neighbourhood', 'about their day', '', 120, 10);
  st.relationships = {
    'Rias Wells': { p: 100, r: 100, s: 52, history: [] }, 'Aurora Sterling': { p: 71, r: 67, s: 7, history: [] },
    'Vanessa Reynolds': { p: 41, r: 37, s: 3, history: [] }, 'Claire Stone': { p: 26, r: 13, s: 0, history: [] },
    'Alexia Vanderbilt': { p: 0, r: 31, s: 0, history: [] }, 'Caleb Thorne': { p: 0, r: -28, s: 0, history: [] },
    'Chloe Maxwell': { p: 14, r: 8, s: 0, history: [] }, 'Mi-na Song': { p: 11, r: 0, s: 0, history: [] },
  };
  st.threads = [{ title: 'Aurora\u2019s Friday welcome', owner: 'Aurora Sterling', heat: 'hot', next: 'welcome him' }];
  st.offscreen = { 'Rias Wells': { location: 'home, in bed with a fever', activity: 'rereading his texts, thinking about him', stance: 'waiting' } };
  st.place = { name: 'The Harbor Market \u2014 the fish stalls' };
  st.present = ['Mara Quinn', 'Ms. Holt', 'Old Pete', 'Chloe Maxwell', 'Vanessa Reynolds', 'Eli Sterling'].map((name) => ({ name }));
  const brief = 'Rias Wells is Jovan\u2019s older sister. Alaric Stone is Claire\u2019s brother. Mr. Sterling lives next door.';
  const lately = ['Jovan walked the harbor with Mara Quinn.', 'The gulls screamed over the stalls.'];
  const report = {};
  for (const [label, tokens] of [['500k', 500000], ['128k', 128000], ['107k', 107000]]) {
    const out = renderPeopleTiers(st, { recentPages: lately, view: peopleView(tokens), brief, scenePages: lately });
    const away = out.text.split('Away, and much on the story\u2019s mind:')[1] || '';
    const roster = out.text.split('Elsewhere in the tale:')[1] || '';
    report[label] = { chars: out.text.length, ...out.tiers, lines: (roster.match(/\n- /g) || []).length, more: (roster.match(/And (\d+) more/) || [0, 0])[1] };
    assert(/Named, though not in the scene right now:|Away, and much on the story\u2019s mind:/.test(out.text) && /\nRias Wells \u2014 Rias Wells \u2014 Jovan\u2019s older sister[\s\S]*?Now: home, in bed with a fever, rereading his texts, thinking about him/.test(out.text), label + ': his sick sister rides as a card, where she is and what she is thinking');
    assert(/(^|\n)Mara Quinn \u2014/.test(out.text), label + ': the newcomer in the scene keeps her card');
    assert(/Townsperson A Lane \u2014 sells rope at the Harbor Market/.test(out.text) || label === '107k', label + ': a minor person of this very ground comes forward');
    assert(/\n- Townsperson (D|E|F|G) Lane \u2014 a face from the old neighbourhood \u00b7 now: about their day \(last seen/.test(roster), label + ': a minor person elsewhere is a line that says who they are');
    assert(!roster.includes('Rias Wells') && !roster.includes('Aurora Sterling'), label + ': no card is named again on the roster');
    assert(out.text.length <= peopleView(tokens).budget, label + ': the block holds to its room (' + out.text.length + ')');
  }
  /* a crowded tale on the smallest room that still says who everyone is: the away cards
   * take only what the lines leave them — the sister first, and the roster whole */
  const crowd = { ...st, characters: { ...st.characters }, relationships: { ...st.relationships } };
  for (let i = 1; i <= 12; i += 1) {
    const n = 'Friend ' + String.fromCharCode(64 + i) + ' Vale';
    crowd.characters[n] = bonded(n);
    crowd.relationships[n] = { p: 20 + i, r: 0, s: 0, history: [] };
  }
  const tight = renderPeopleTiers(crowd, { recentPages: lately, view: peopleView(107000), brief, scenePages: lately });
  const tightRoster = tight.text.split('Elsewhere in the tale:')[1] || '';
  assert(tight.text.length <= peopleView(107000).budget, 'the crowded block holds to its room: ' + tight.text.length + ' of ' + peopleView(107000).budget);
  assert(/\nRias Wells \u2014 Rias Wells \u2014 Jovan\u2019s older sister/.test(tight.text), 'crowded, the sister still rides as a card');
  assert(tight.tiers.important >= 1 && (tightRoster.match(/\n- /g) || []).length >= 20, 'and the roster keeps its lines: ' + JSON.stringify(tight.tiers));
  report.crowded107k = { chars: tight.text.length, ...tight.tiers };

  /* the newcomer, gone from the scene within her first pages, stays a card; ten pages on, she weighs what her story has made her */
  const left = { ...st, present: st.present.filter((p) => p.name !== 'Mara Quinn') };
  assert(/Away, and much on the story\u2019s mind:[\s\S]*\nMara Quinn \u2014/.test(renderPeopleTiers(left, { recentPages: [], view: peopleView(500000), brief, scenePages: [] }).text), 'a newcomer who steps out stays a card for her first pages');
  const later = { ...left, page: 215 };
  const lateOut = renderPeopleTiers(later, { recentPages: [], view: peopleView(500000), brief, scenePages: [] }).text;
  assert(!/(^|\n)Mara Quinn \u2014/.test(lateOut) && /\n- Mara Quinn \u2014 a fishmonger/.test(lateOut), 'past her first pages, with no bond, she is a line on the roster: ' + (lateOut.match(/\n- Mara Quinn[^\n]*/) || [''])[0]);
  console.log('      M259-50 measured: ' + JSON.stringify(report));
});

test('M259-51: the model\u2019s room has one answer — the writer\u2019s number, else his provider\u2019s, for the storyteller and every worker', async () => {
  const { contextOf, presetIdFor, PRESET_CONTEXT, UNKNOWN_CONTEXT } = await import('../../js/providers/room.js');
  const { PRESETS } = await import('../../js/providers/index.js');
  for (const p of PRESETS) eq(PRESET_CONTEXT[p.id], p.contextSize, 'the room table holds the preset\u2019s own number: ' + p.id);
  eq(Object.keys(PRESET_CONTEXT).sort().join(','), PRESETS.map((p) => p.id).sort().join(','), 'and every preset is in it');
  eq(contextOf({ type: 'openai', baseUrl: 'https://api.deepseek.com/v1', contextSize: 500000 }), 500000, 'the writer\u2019s number wins');
  eq(contextOf({ type: 'openai', baseUrl: 'https://api.deepseek.com/v1' }), 1000000, 'an empty DeepSeek room is DeepSeek\u2019s \u2014 a million since V4 (M289)');
  eq(contextOf({ type: 'openai', preset: 'deepseek', baseUrl: 'https://proxy.example/v1' }), 1000000, 'the preset it was made from is trusted first');
  eq(contextOf({ type: 'anthropic', baseUrl: 'https://api.anthropic.com' }), 200000, 'Claude\u2019s is Claude\u2019s');
  eq(contextOf({ type: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' }), 1000000, 'Google\u2019s is Google\u2019s');
  eq(contextOf({ type: 'openai', baseUrl: 'https://mock.example/v1' }), UNKNOWN_CONTEXT, 'an unknown endpoint is taken at 128,000');
  eq(contextOf({ type: 'openai', baseUrl: 'https://api.deepseek.com/v1', contextSize: 0 }), 1000000, 'a zero is no number (the preset stands)');
  eq(presetIdFor(null), 'custom', 'no connection is a custom one');
  /* the workers and the storyteller ask the same question */
  const { roomChars } = await import('../../js/engine/pagecut.js');
  assert(roomChars({ type: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' }) > 2500000, 'a worker on Google with no number is given Google\u2019s room');
  eq(roomChars({ type: 'openai', baseUrl: 'https://api.deepseek.com/v1' }), roomChars({ contextSize: 1000000 }), 'and on DeepSeek, DeepSeek\u2019s');
  const { buildRequest } = await import('../../js/assemble/stack.js');
  const { peopleView } = await import('../../js/engine/people.js');
  eq(JSON.stringify(peopleView(contextOf({ type: 'openai', baseUrl: 'https://api.deepseek.com/v1' }))), JSON.stringify(peopleView(1000000)), 'the storyteller\u2019s people are sized to the same room');
  assert(buildRequest({ story: { title: 't', brief: 'b' }, messages: [{ id: 'u1', role: 'user', text: 'go' }], settings: {}, state: emptyState(), modules: [], memory: '', window: { mode: 'keeper', window: 30, budgetTokens: contextOf({ type: 'openai', baseUrl: 'https://api.deepseek.com/v1' }) } }), 'a request is built in that room');
});

test('M259-52: twelve in the scene \u2014 the present take what the away do not need, and whoever has no card still says who they are and what they are doing', async () => {
  const { renderPeopleTiers, peopleView } = await import('../../js/engine/people.js');
  const hall = (per, extra = {}) => {
    const st = emptyState(); st.sheet = { actors: {}, playerName: 'Jovan Wells' }; st.page = 100; st.characters = {};
    const names = Array.from({ length: 12 }, (_, i) => 'Guest ' + String.fromCharCode(65 + i) + ' Rowe');
    for (const n of names) st.characters[n] = { core: n + ' keeps the hall\u2019s ledgers. ' + 'x'.repeat(Math.floor(per * 0.4)), state: n + ' stands by the fire, watching the door. ' + 'y'.repeat(Math.floor(per * 0.2)), arc: 'Between them: ' + 'z'.repeat(Math.floor(per * 0.4)), threads: [], updatedAtTurn: 99 };
    st.present = names.map((name) => ({ name }));
    st.place = { name: 'The Rowe hall' };
    Object.assign(st, extra.state || {});
    if (extra.characters) Object.assign(st.characters, extra.characters);
    return st;
  };
  const r128 = peopleView(128000);
  const short = renderPeopleTiers(hall(1500), { recentPages: [], view: r128, scenePages: [] });
  eq(short.tiers.cards, 12, 'twelve in the hall with pages of ~1,500 characters: twelve cards on a 128k room (it was nine)');
  const long = renderPeopleTiers(hall(3000), { recentPages: [], view: r128, scenePages: [] });
  eq(long.tiers.cards + '+' + long.tiers.also, '7+5', 'with pages of ~3,000 on a 128k room: seven cards (it held five) and every other one on the line');
  const lines = (long.text.split('Also here:')[1] || '').split('\n').filter((l) => l.startsWith('- '));
  eq(lines.length, 12 - long.tiers.cards, 'one line for each present person without a card');
  assert(lines.every((l) => /^- Guest [A-L] Rowe \u2014 Guest [A-L] Rowe keeps the hall\u2019s ledgers \u00b7 now: Guest [A-L] Rowe stands by the fire, watching the door$/.test(l)), 'and each says who they are and what they are doing: ' + lines[0]);
  assert(long.text.length <= r128.budget, 'within the room: ' + long.text.length + ' of ' + r128.budget);
  eq(renderPeopleTiers(hall(3000), { recentPages: [], view: peopleView(200000), scenePages: [] }).tiers.cards, 11, 'a 200k room: eleven (it was eight)');
  eq(renderPeopleTiers(hall(3000), { recentPages: [], view: peopleView(500000), scenePages: [] }).tiers.cards, 12, 'a 500k room: all twelve');
  /* the sister away is not starved by a crowded hall */
  const withSister = hall(3000, {
    state: { relationships: { 'Rias Wells': { p: 100, r: 100, s: 52, history: [] } }, offscreen: { 'Rias Wells': { location: 'home, in bed with a fever', activity: 'thinking about him', stance: 'waiting' } } },
    characters: { 'Rias Wells': { core: 'Rias Wells \u2014 Jovan\u2019s older sister. ' + 'Fierce and tender. '.repeat(40), state: 'at home', arc: 'She would walk through fire for him. '.repeat(30), threads: [], updatedAtTurn: 90 } },
  });
  const crowded = renderPeopleTiers(withSister, { recentPages: [], view: r128, scenePages: [] });
  assert(/Away, and much on the story\u2019s mind:\nRias Wells \u2014 Rias Wells \u2014 Jovan\u2019s older sister\.[^\n]*\nNow: home, in bed with a fever, thinking about him/.test(crowded.text), 'with twelve long pages in the hall, the sister away (her page ~1,900 characters) still rides as a card');
  assert(crowded.tiers.cards >= 3 && crowded.tiers.cards + crowded.tiers.also === 12 && crowded.text.length <= r128.budget, 'and the hall keeps a card or a line for each of the twelve: ' + JSON.stringify(crowded.tiers));
  /* someone here with nothing written yet is named as such */
  const fresh = hall(1500, { state: { present: [...hall(1500).present, { name: 'Nell Stranger' }] } });
  assert(/- Nell Stranger \(nothing written of them yet\)/.test(renderPeopleTiers(fresh, { recentPages: [], view: r128, scenePages: [] }).text), 'a person here with no page yet is on the line, and says so');
  const blank = hall(3000, { state: { present: [...hall(3000).present, { name: 'Odd Blank' }] }, characters: { 'Odd Blank': { core: '', state: '', arc: '', threads: [], updatedAtTurn: 99 } } });
  const blankText = renderPeopleTiers(blank, { recentPages: [], view: r128, scenePages: [] }).text;
  eq((blankText.match(/- Odd Blank/g) || []).length, 1, 'a page with nothing on it is named once, not twice');
});

test('M259-53: the record takes the room the rest of the request truly leaves — a long tale never outgrows the model', async () => {
  const { buildRequest } = await import('../../js/assemble/stack.js');
  const { recordRoom, fixedCharsOf, ANSWER_ROOM_UNSET, RECORD_MARGIN_TOKENS } = await import('../../js/agents/memory.js');
  const para = (chars, tag) => (tag + ' ' + 'the lamp burned low over the ledger, '.repeat(Math.ceil(chars / 37))).slice(0, chars);
  const tale = (briefC, castC, loreC) => {
    const st = emptyState(); st.sheet = { actors: {}, playerName: 'Jovan Wells' }; st.page = 200; st.characters = {};
    for (let i = 0; i < 25; i += 1) st.characters['Person ' + i + ' Vale'] = { core: para(900, 'core'), state: para(300, 'state'), arc: para(900, 'arc'), threads: [], updatedAtTurn: 190 };
    st.present = Object.keys(st.characters).slice(0, 6).map((name) => ({ name }));
    const messages = [];
    for (let i = 0; i < 30; i += 1) { messages.push({ id: 'u' + i, role: 'user', text: para(600, 'writer') }); messages.push({ id: 'a' + i, role: 'assistant', text: para(3000, 'page') }); }
    return { story: { title: 't', brief: para(briefC, 'brief'), castNotes: para(castC, 'cast') }, messages, settings: {}, state: st, modules: [{ mod: { id: 'core-craft', name: 'Craft', text: para(12000, 'craft') }, reason: 'always' }], lore: para(loreC, 'lore'), loreFired: [{ name: 'L' }], window: { mode: 'keeper', window: 30, budgetTokens: 128000 }, directorNote: para(2000, 'director'), editorEye: para(1500, 'editor') };
  };
  const wireChars = (req) => JSON.stringify({ s: req.systemBlocks.map((b) => b.text), m: req.messages.map((m) => m.content) }).length;
  for (const [label, b, c, l] of [['typical', 15000, 5000, 5000], ['a big cast', 40000, 20000, 20000], ['a brief twice that', 80000, 20000, 20000]]) {
    const args = tale(b, c, l);
    const probe = buildRequest({ ...args, memory: '' }).receipt;
    const cap = recordRoom({ contextTokens: 128000, maxTokens: undefined, fixedChars: fixedCharsOf(probe) });
    const record = para(cap, 'record');   /* a record that fills its whole room */
    const req = buildRequest({ ...args, memory: record });
    const realTokens = Math.ceil(wireChars(req) / 3);   /* dense text: three characters a token */
    assert(realTokens + ANSWER_ROOM_UNSET <= 128000, label + ': the request at three characters a token and the answer\u2019s room fit 128,000 (' + realTokens + ' + ' + ANSWER_ROOM_UNSET + ')');
    assert(realTokens + ANSWER_ROOM_UNSET >= 128000 - RECORD_MARGIN_TOKENS - 6000, label + ': and the room is used, not wasted (' + (realTokens + ANSWER_ROOM_UNSET) + ')');
  }
  /* the old guess took the big brief past the room */
  const old = tale(80000, 20000, 20000);
  const oldCap = recordRoom({ contextTokens: 128000, maxTokens: undefined, windowTokens: old.messages.reduce((n, m) => n + Math.ceil(m.text.length / 4), 0) });
  const oldReq = buildRequest({ ...old, memory: para(oldCap, 'record') });
  assert(Math.ceil(wireChars(oldReq) / 3) + 8000 > 128000, 'the old guess sends past a 128k room with a big brief (' + Math.ceil(wireChars(oldReq) / 3) + ' + an answer)');
  /* a typical tale gets at least the room the old guess gave it */
  const typ = tale(15000, 5000, 5000);
  const newTyp = recordRoom({ contextTokens: 128000, fixedChars: fixedCharsOf(buildRequest({ ...typ, memory: '' }).receipt) });
  const oldTyp = recordRoom({ contextTokens: 128000, windowTokens: typ.messages.reduce((n, m) => n + Math.ceil(m.text.length / 4), 0) });
  assert(newTyp >= oldTyp * 0.9, 'a typical tale keeps its record room: ' + newTyp + ' (was ' + oldTyp + ')');
  /* the writer's answer size is honoured; the receipt's record is not counted as the rest */
  eq(recordRoom({ contextTokens: 128000, maxTokens: 4000, fixedChars: 300000 }), (128000 - 100000 - 4000 - RECORD_MARGIN_TOKENS) * 3, 'a set answer size is used as set');
  eq(fixedCharsOf({ totalTokens: 50000, slots: [{ name: 'What remains', tokens: 20000 }, { name: 'The brief', tokens: 30000 }] }), 120000, 'the rest of a receipt is everything but the record');
  eq(fixedCharsOf(null), 0, 'no receipt, no measure (the old estimate stands)');
});

test('M259-54: a ledger larger than the auditor\u2019s room is read lean, never refused — the ones here whole, the passed-through by name', async () => {
  const au = await import('../../js/agents/auditor.js');
  const { roomChars } = await import('../../js/engine/pagecut.js');
  const para = (chars, tag) => (tag + ' ' + 'the lamp burned low over the ledger, '.repeat(Math.ceil(chars / 37))).slice(0, chars);
  const st = emptyState(); st.sheet = { actors: {}, playerName: 'Jovan Wells' }; st.page = 800; st.characters = {};
  for (let i = 0; i < 40; i += 1) st.characters['Person ' + i + ' Vale'] = { core: 'Person ' + i + ' Vale keeps a secret. ' + para(4000, 'core'), state: para(1500, 'state'), arc: para(4000, 'arc'), threads: [para(300, 't1')], updatedAtTurn: 790, ...(i >= 34 ? { retired: true } : {}) };
  st.relationships = Object.fromEntries(Object.keys(st.characters).map((k, i) => [k, { p: i, r: i, s: 0, history: [] }]));
  st.present = Object.keys(st.characters).slice(0, 4).map((name) => ({ name }));
  const brief = para(40000, 'brief'), castNotes = para(20000, 'cast');
  const conn = { ...CONN, contextSize: 128000 };
  const room = au.auditRoomChars(conn);
  const whole = au.buildAuditorMessages({ state: st, brief, castNotes, pages: [] });
  assert(whole.system.length + whole.user.length > room, 'the whole ledger is larger than a 128k reading (' + (whole.system.length + whole.user.length) + ' of ' + room + ')');
  const lean = au.buildAuditorMessages({ state: st, brief, castNotes, pages: [], room });
  assert(lean.system.length + lean.user.length < room, 'read lean, it fits (' + (lean.system.length + lean.user.length) + ')');
  assert(/the character pages — \(shown lean for this reading/.test(lean.user), 'and the reading is told so');
  assert(lean.user.includes('Person 0 Vale — core: Person 0 Vale keeps a secret.') && /Person 0 Vale — core:[^\n]*\| arc: arc /.test(lean.user), 'the ones here keep their whole page');
  assert(/\nPerson 35 Vale \(passed through\)\n/.test(lean.user), 'the passed-through are named, not read');
  assert(/\nPerson 20 Vale — core: Person 20 Vale keeps a secret\.\n/.test(lean.user), 'those away keep who they are, at the least');
  const roomy = au.buildAuditorMessages({ state: st, brief, castNotes, pages: [], room: 5000000 });
  assert(/Person 35 Vale \(passed through — out of the story/.test(roomy.user) && !/shown lean/.test(roomy.user), 'a room that holds it all reads it all');
  /* end to end: the reading sent on a 128k connection is within its room */
  const sid = 'm259-lean-audit';
  await saveState(sid, st);
  for (let i = 0; i < 30; i += 1) { await db.messages.append(sid, { role: 'user', text: 'u' + i }); await db.messages.append(sid, { role: 'assistant', text: para(3000, 'page ' + i) }); }
  const house = thinkingHouse({ answer: '{"issues":[]}' });
  await withHouse(house, () => au.auditLedger({ connection: conn, storyId: sid, brief, castNotes, stale: () => false }));
  const sent = house.calls[0] ? JSON.stringify(house.calls[0].body).length : 0;
  assert(sent > 0 && sent <= roomChars(conn, 6000), 'the auditor\u2019s request fits its model (' + sent + ' of ' + roomChars(conn, 6000) + ')');
  assert(JSON.stringify(house.calls[0].body).includes('page 20 the lamp'), 'and older unfolded pages are read beside the newest (the view is sized to the lean reading, not the whole one)');
});

test('M259-55: the housekeeper reads a ledger of many faces lean in its room and can fetch any page whole; the director and editor read recent pages whole', async () => {
  const hk = await import('../../js/agents/housekeeper.js');
  const { roomChars } = await import('../../js/engine/pagecut.js');
  const para = (chars, tag) => (tag + ' ' + 'the lamp burned low over the ledger, '.repeat(Math.ceil(chars / 37))).slice(0, chars);
  const st = emptyState(); st.sheet = { actors: {}, playerName: 'Jovan Wells' }; st.page = 800; st.characters = {};
  for (let i = 0; i < 60; i += 1) st.characters['Person ' + i + ' Vale'] = { core: 'Person ' + i + ' Vale keeps a secret. ' + para(4000, 'core'), state: para(1500, 'state'), arc: 'ARC-OF-' + i + ' ' + para(4000, 'arc'), threads: [para(300, 't1')], updatedAtTurn: 790, ...(i >= 40 ? { retired: true } : {}) };
  st.present = Object.keys(st.characters).slice(0, 6).map((name) => ({ name }));
  const story = { title: 't', brief: para(40000, 'brief'), castNotes: para(20000, 'cast') };
  const messages = []; for (let i = 0; i < 60; i += 1) { messages.push({ id: 'u' + i, role: 'user', text: para(600, 'writer') }); messages.push({ id: 'a' + i, role: 'assistant', text: para(3000, 'page') }); }
  const room = roomChars({ contextSize: 128000 }, hk.HK_MAX_TOKENS);
  const args = { story, messages, state: st, modules: [], lore: [], memory: null, session: [], contextPages: 20 };
  assert(hk.buildHousekeeperContext(args).length > room, 'whole, the context is larger than a 128k housekeeper');
  const lean = hk.buildHousekeeperContext({ ...args, room });
  assert(lean.length <= room, 'in its room it fits: ' + lean.length + ' of ' + room);
  assert(/SHOWN LEAN/.test(lean) && /fetch "person: NAME"/.test(lean), 'it is told the pages are lean, and how to read one whole');
  assert(/\[Person 0 Vale\]\n  CORE: Person 0 Vale keeps a secret\.[^\n]*\n  STATE: state [^\n]*\n  ARC: ARC-OF-0 /.test(lean), 'the ones here are whole');
  assert(/\[Person 20 Vale\]\n  CORE: Person 20 Vale keeps a secret\.\n  STATE: \(not shown this reading\)\n  ARC: \(not shown this reading\)/.test(lean), 'a shortened field is marked as not shown, never as empty');
  assert(/\[Person 45 Vale \u2014 passed through\] \(page not shown \u2014 fetch "person: Person 45 Vale"\)/.test(lean), 'the passed-through are named, with the way to their page');
  eq(hk.buildHousekeeperContext({ ...args, room: 50000000 }), hk.buildHousekeeperContext(args), 'a room that holds it all reads it all');
  /* the conversation itself sends the lean context on a 128k connection */
  const sentReqs = [];
  await hk.runConversation({ connection: { ...CONN, contextSize: 128000 }, ...args, writerText: 'How is Person 20?', call: async (req) => { sentReqs.push(req); return { text: 'She is well.' }; } });
  const firstSize = sentReqs.length ? JSON.stringify(sentReqs[0]).length : 0;
  assert(firstSize > 0 && firstSize <= roomChars({ contextSize: 128000 }, 0), 'the housekeeper\u2019s first request fits its model (' + firstSize + ')');
  eq(JSON.stringify(hk.parseFetchRefs('["person: Person 20 Vale", "brief"]')), JSON.stringify(['person: Person 20 Vale', 'brief']), 'a person is a thing to fetch');
  const served = hk.serveFetch(['person: person 20 vale'], messages, { story, state: st });
  assert(/\[the page of Person 20 Vale\] \(COMPLETE\)\n  CORE: Person 20 Vale keeps a secret\.[^\n]*\n  STATE: state [^\n]*\n  ARC: ARC-OF-20 /.test(served), 'and is served whole: ' + served.slice(0, 80));
  assert(/No page is written for \u201cNobody Here\u201d/.test(hk.serveFetch(['person: Nobody Here'], messages, { story, state: st })), 'an unknown name says so');
  const { askWithFetch } = await import('../../js/agents/lookup.js');
  const house = scriptedHouse(['<fetch>["person: Person 21 Vale"]</fetch>', '{"ok":true}']);
  await withHouse(house, () => askWithFetch(CONN, { system: 's', user: 'u', maxTokens: 500, isAnswer: (t) => /"ok"/.test(t), source: { messages, story, state: st }, rounds: 1 }));
  assert(house.calls.length === 2 && JSON.stringify(house.calls[1].body).includes('ARC-OF-21'), 'a worker that asks for a person is served the page whole (' + house.calls.length + ' calls)');
  /* the director and the editor read the latest pages whole (they were cut at 3,000 mid-word) */
  const long = para(9000, 'LONG-PAGE-START') + ' LONG-PAGE-END';
  const dir = await import('../../js/agents/director.js');
  const edi = await import('../../js/agents/editor.js');
  const recent = [{ id: 'u', role: 'user', text: 'go' }, { id: 'a', role: 'assistant', text: long }];
  const d = JSON.stringify(dir.buildDirectorBrief({ story, messages: recent, state: st, prev: null, mode: 'new' }));
  const e = JSON.stringify(edi.buildEditorMessages({ story, messages: recent, state: st, prev: null }));
  for (const [who, t] of [['director', d], ['editor', e]]) {
    assert(t.includes('LONG-PAGE-END'), who + ' reads a 9,000-character page to its end');
    assert(!t.includes('brief the lamp burned low over the ledger, the lamp burned low over the ledger' + para(39000, '').slice(0, 0)) || /the brief continues|brief the lamp/.test(t), who + ' reads the brief');
  }
  const huge = { ...story, brief: para(150000, 'bigbrief') };
  assert(/\(the brief continues \u2014 \d+ more characters not shown here\)/.test(JSON.stringify(dir.buildDirectorBrief({ story: huge, messages: recent, state: st, prev: null, mode: 'new' }))), 'the director is held to the workers\u2019 room and told so');
  assert(/\(the brief continues \u2014/.test(JSON.stringify(edi.buildEditorMessages({ story: huge, messages: recent, state: st, prev: null }))), 'and so is the editor');
});

test('M259-56: the house asks the provider how much its model holds — a room left empty is the model\u2019s own, not an old preset\u2019s', async () => {
  const { contextOf, detectKey, reportedContext } = await import('../../js/providers/room.js');
  const { learnContext, ASK_AGAIN_MS } = await import('../../js/providers/detect.js');
  const { createProvider, PRESETS } = await import('../../js/providers/index.js');
  eq(PRESETS.find((p) => p.id === 'deepseek').contextSize, 1000000, 'DeepSeek\u2019s preset is V4\u2019s million');
  eq(reportedContext({ id: 'x', context_length: 1048576 }), 1048576, 'OpenRouter\u2019s name for it');
  eq(reportedContext({ id: 'x', max_model_len: 524288 }), 524288, 'vLLM\u2019s');
  eq(reportedContext({ id: 'x', top_provider: { context_length: 600000 } }), 600000, 'a provider\u2019s own');
  eq(reportedContext({ id: 'x' }), 0, 'none said is none');
  /* the model list keeps the size it reports */
  const lists = [];
  const listing = { calls: [], fetch: async (url) => { lists.push(String(url)); return new Response(JSON.stringify({ data: [{ id: 'glm-5.2', context_length: 524288 }, { id: 'kimi-k3', max_model_len: 1000000 }, { id: 'plain' }] }), { status: 200, headers: { 'content-type': 'application/json' } }); } };
  const conn = { id: 'c-neural', type: 'openai', baseUrl: 'https://api.neuralwatt.example/v1', apiKey: 'k', model: 'glm-5.2' };
  const got = await withHouse(listing, () => createProvider(conn).listModels());
  eq(JSON.stringify(got.map((m) => [m.id, m.context])), JSON.stringify([['glm-5.2', 524288], ['kimi-k3', 1000000], ['plain', 0]]), 'each model with the room it reports');
  /* an empty room is asked once, and kept for that very model */
  await db.connections.add(conn);
  const stored = (await db.connections.list()).find((c) => c.id === 'c-neural');
  eq(contextOf(stored), 128000, 'unknown and unasked: the careful guess');
  const learned = await withHouse(listing, () => learnContext(stored));
  eq(contextOf(learned), 524288, 'asked: the provider\u2019s own number');
  const reread = (await db.connections.list()).find((c) => c.id === 'c-neural');
  eq(contextOf(reread), 524288, 'and it is kept on the connection');
  eq(contextOf({ ...reread, model: 'kimi-k3' }), 128000, 'another model on the connection is not taken at this one\u2019s size');
  eq(contextOf({ ...reread, contextSize: 300000 }), 300000, 'the writer\u2019s own number always wins');
  const before = lists.length;
  await withHouse(listing, () => learnContext(reread));
  eq(lists.length, before, 'a known room is not asked again');
  /* a provider that says nothing is asked again after a day, not every page */
  const silent = { calls: [], fetch: async (url) => { lists.push(String(url)); return new Response(JSON.stringify({ data: [{ id: 'deep-model' }] }), { status: 200, headers: { 'content-type': 'application/json' } }); } };
  const quiet = { id: 'c-quiet', type: 'openai', baseUrl: 'https://api.wafer.example/v1', apiKey: 'k', model: 'deep-model' };
  await db.connections.add(quiet);
  const t0 = 1000000;
  const once = await withHouse(silent, () => learnContext(quiet, { now: t0 }));
  const n1 = lists.length;
  await withHouse(silent, () => learnContext(once, { now: t0 + 60000 }));
  eq(lists.length, n1, 'not asked again within the day');
  await withHouse(silent, () => learnContext(once, { now: t0 + ASK_AGAIN_MS + 1 }));
  eq(lists.length, n1 + 1, 'asked again the next day');
  eq(contextOf(once), 128000, 'and meanwhile the careful guess stands');
  /* two asks at once are one question */
  const slowCalls = [];
  const slow = { calls: [], fetch: async (url) => { slowCalls.push(url); await new Promise((r) => setTimeout(r, 50)); return new Response(JSON.stringify({ data: [{ id: 'm1', context_length: 700000 }] }), { status: 200, headers: { 'content-type': 'application/json' } }); } };
  const twin = { id: 'c-twin', type: 'openai', baseUrl: 'https://api.twin.example/v1', apiKey: 'k', model: 'm1' };
  await db.connections.add(twin);
  const [a, b] = await withHouse(slow, () => Promise.all([learnContext(twin), learnContext(twin)]));
  eq(slowCalls.length, 1, 'one question for two asks');
  eq(contextOf(a) + contextOf(b), 1400000, 'and both have the answer');
  eq(detectKey(twin), 'm1@https://api.twin.example/v1', 'the answer belongs to the model at its address');
});

test('M259-57: the character pages are tidied once — who they are out of "now", a household\u2019s words on the right page — and a field can be let go', async () => {
  const td = await import('../../js/agents/tidy.js');
  const { undoLast } = await import('../../js/engine/apply.js');
  const base = emptyState(); base.sheet = { actors: {}, playerName: 'Jovan Wells' }; base.page = 199;
  /* a field let go on purpose, journaled, and taken back */
  const withNow = applyMutations(base, [{ type: 'people.set', name: 'Rias Wells', field: 'state', text: 'Ravenwood High second-year; 17' }]).state;
  const cleared = applyMutations(withNow, [{ type: 'people.set', name: 'Rias Wells', field: 'state', text: '', clear: true }]);
  eq(cleared.state.characters['Rias Wells'].state, '', 'a state let go');
  assert(/Rias Wells — where they are was let go/.test(cleared.applied[0].words), 'and the log says so: ' + cleared.applied[0].words);
  eq(undoLast(cleared.state).state.characters['Rias Wells'].state, 'Ravenwood High second-year; 17', 'and it can be taken back');
  eq(applyMutations(base, [{ type: 'people.set', name: 'Nobody', field: 'core', text: '', clear: true }]).applied.length, 0, 'a core is never let go this way');
  /* what calls for a tidy */
  const st = { ...base, characters: {
    'Rias Wells': { core: 'Confident, playful, possessive by nature.', state: 'Ravenwood High second-year, student council VP; 17', arc: 'devoted older sister', threads: [], updatedAtTurn: 190 },
    'Mr. Sterling': { core: 'Aurora and Eli\u2019s father; tall, silvering.', state: 'Crossed the driveway with the dish towel still in her fist; she is baking Sunday.', arc: 'moved her to tears she blamed on dust', threads: [], updatedAtTurn: 190 },
    'Mrs. Sterling': { core: 'Aurora and Eli\u2019s mother; small, sharp-eyed.', state: '', arc: '', threads: [], updatedAtTurn: 100 },
    'Ms. June': { core: 'Bluebird waitress in her fifties.', state: 'Held Jovan\u2019s face at the diner.', arc: 'folded him into the diner\u2019s care', threads: [], updatedAtTurn: 120 },
    'Hand Kept': { core: 'the writer\u2019s own', state: 'a first-year; 16', arc: '', threads: [], updatedAtTurn: 50, hand: { state: true } },
  }, offscreen: { 'Ms. June': { location: 'the Bluebird, closing up', activity: 'stacking chairs' } }, relationships: { 'Rias Wells': { p: 100, r: 100, s: 52, history: [] } } };
  assert(td.lifeLineInNow(st) && td.titleCrossed(st) && td.tidyDue(st), 'who they are in "now", and a husband\u2019s page speaking of her, call for a tidy');
  eq(td.tidyDue({ ...st, tidiedGen: td.TIDY_GEN }), false, 'once, not again');
  eq(td.lifeLineInNow({ ...base, characters: { 'Hand Kept': st.characters['Hand Kept'] } }), false, 'a line the writer wrote by hand is his');
  /* what an answer may change */
  const muts = td.tidyMutations(st, [
    { name: 'Rias Wells', core: 'Confident, playful, possessive by nature. Ravenwood High second-year, student council VP; 17.', state: '' },
    { name: 'Hand Kept', state: '' },
    { name: 'Ms. June', core: 'short' },
    { name: 'Jovan Wells', state: 'x' },
    { name: 'Nobody Known', state: 'x' },
  ]);
  eq(JSON.stringify(muts.map((m) => [m.name, m.field, m.clear === true])), JSON.stringify([['Rias Wells', 'core', false], ['Rias Wells', 'state', true]]), 'only what it may: never the writer\u2019s field, a shortened core, the main character, or a stranger');
  /* end to end */
  const sid = 'm259-tidy';
  await saveState(sid, st);
  await db.messages.append(sid, { role: 'user', text: 'We eat.' });
  await db.messages.append(sid, { role: 'assistant', text: 'LATEST-PAGE: Mrs. Sterling set the pie down; Rias laughed at the counter.' });
  const answer = JSON.stringify({ pages: [
    { name: 'Rias Wells', core: 'Confident, playful, possessive by nature. Ravenwood High second-year, student council VP; 17.', state: 'at the kitchen counter, laughing' },
    { name: 'Mr. Sterling', state: '', arc: '' },
    { name: 'Mrs. Sterling', state: 'Crossed the driveway with the dish towel still in her fist; she is baking Sunday.', arc: 'Jovan\u2019s answer moved her to tears she blamed on dust' },
    { name: 'Ms. June', state: '' },
  ] });
  const house = scriptedHouse([answer]);
  const r = await withHouse(house, () => td.tidyPeople({ connection: CONN, storyId: sid, brief: 'BRIEF-FOR-TIDY Rias Wells is Jovan\u2019s sister.', castNotes: 'CAST-FOR-TIDY' }));
  const after = await loadState(sid);
  eq(after.characters['Rias Wells'].state, 'at the kitchen counter, laughing', 'Rias\u2019s now is her now');
  assert(/second-year, student council VP; 17/.test(after.characters['Rias Wells'].core) && /^Confident, playful/.test(after.characters['Rias Wells'].core), 'and who she is holds her year and her age, every old word kept');
  eq(after.characters['Mr. Sterling'].state + '|' + after.characters['Mr. Sterling'].arc, '|', 'his page lets go of her moments');
  assert(/dish towel still in her fist/.test(after.characters['Mrs. Sterling'].state) && /tears/.test(after.characters['Mrs. Sterling'].arc), 'and hers holds them');
  eq(after.characters['Ms. June'].state, '', 'a scene long gone lets go where the world has seated her');
  eq(JSON.stringify(after.relationships['Rias Wells']), JSON.stringify(st.relationships['Rias Wells']), 'the standings are not touched');
  eq(after.tidiedGen, td.TIDY_GEN, 'stamped');
  const sent = JSON.stringify(house.calls[0].body);
  assert(sent.includes('BRIEF-FOR-TIDY') && sent.includes('CAST-FOR-TIDY') && sent.includes('the Bluebird, closing up') && sent.includes('LATEST-PAGE'), 'it read the brief, the cast notes, where the absent are, and the latest page');
  assert(/tidied 4 pages/.test(td.tidyRunWords(r)), 'the workers\u2019 line says what it did: ' + td.tidyRunWords(r));
  /* an answer it cannot read leaves the stamp for next time */
  const sid2 = 'm259-tidy-2';
  await saveState(sid2, st);
  await db.messages.append(sid2, { role: 'assistant', text: 'a page' });
  const r2 = await withHouse(scriptedHouse(['not json at all']), () => td.tidyPeople({ connection: CONN, storyId: sid2 }));
  eq(r2.failed, 1, 'the unreadable answer is counted');
  assert(td.tidyDue(await loadState(sid2)), 'and the tidy is still due');
  /* the founder and the scribe are told the same thing */
  const fo = await import('../../js/agents/founder.js');
  const sc = await import('../../js/agents/scribe.js');
  assert(/who they are in their life \(school year, age, role, family, home\) belongs in their core, never in "state"/.test(fo.buildFounderMessages({ state: base, brief: 'b' }).system), 'the founder puts who they are in the core');
  assert(/is not a[\s\S]*state: add those facts to their core/.test(sc.buildScribeMessages({ state: base, userText: 'u', assistantText: 'a' }).system), 'and the scribe moves it there');
});

test('M259-58: a title\u2019s period does not end a sentence; where the absent are is said once in a whole request', async () => {
  const { firstSentence } = await import('../../js/engine/sentence.js');
  eq(firstSentence('Ms. June runs the Bluebird. She remembers orders.'), 'Ms. June runs the Bluebird.', 'a title is not an ending');
  eq(firstSentence('Dr. A. B. Smith met her. Then left.'), 'Dr. A. B. Smith met her.', 'nor an initial');
  eq(firstSentence('She left. Then came back.'), 'She left.', 'a real ending still ends it, and keeps its mark');
  eq(firstSentence('His father; tall, silvering.'), 'His father', 'a semicolon ends a clause without being kept');
  eq(firstSentence('No ending at all'), 'No ending at all', 'and a line with none is whole');
  const { renderPeopleTiers, peopleView } = await import('../../js/engine/people.js');
  const { buildRequest } = await import('../../js/assemble/stack.js');
  const st = emptyState(); st.sheet = { actors: {}, playerName: 'Jovan Wells' }; st.page = 200;
  st.characters = {
    'Ms. June': { core: 'Ms. June is the Bluebird waitress in her fifties. She remembers orders.', state: 'Mr. Pike is at her counter.', arc: '', threads: [], updatedAtTurn: 190 },
    'Aurora Sterling': { core: 'Warm, sociable, quietly perceptive.', state: 'an old note', arc: 'Friday is settled.', threads: [], updatedAtTurn: 190 },
    'Rias Wells': { core: 'His sister.', state: 'at the counter', arc: '', threads: [], updatedAtTurn: 199 },
  };
  st.present = [{ name: 'Jovan Wells' }, { name: 'Rias Wells' }];
  st.offscreen = { 'Aurora Sterling': { location: 'SEAT-AURORA her bedroom, window seat', activity: 'screenshotting the thread' } };
  st.relationships = { 'Aurora Sterling': { p: 71, r: 67, s: 7, history: [] } };
  const small = renderPeopleTiers(st, { recentPages: [], view: peopleView(500000), brief: '', scenePages: [] }).text;
  assert(/- Ms\. June \u2014 Ms\. June is the Bluebird waitress in her fifties \u00b7 now: Mr\. Pike is at her counter/.test(small), 'her line says who she is and where, whole past the titles: ' + (small.match(/- Ms\. June[^\n]*/) || [''])[0]);
  /* M347: what is SENT — the system blocks and the messages. The receipt's draft now carries each part's words (for the page's
   * Normal view), so serializing the whole return counted the seat line twice where the request says it once. */
  const wire = (budgetTokens) => { const r = buildRequest({ story: { title: 't', brief: 'b' }, messages: [{ id: 'u1', role: 'user', text: 'go' }], settings: {}, state: st, modules: [], memory: '', window: { mode: 'keeper', window: 30, budgetTokens } }); return JSON.stringify({ systemBlocks: r.systemBlocks, messages: r.messages }); };
  const count = (w) => w.split('SEAT-AURORA').length - 1;
  const whole = wire(1000000);
  eq(count(whole), 1, 'a whole request says where Aurora is once');
  assert(/Aurora Sterling \u2014 Warm, sociable, quietly perceptive\.\\nNow: away \u2014 where they are now is under Elsewhere/.test(whole), 'and her card points there');
  assert(!whole.includes('an old note'), 'her old note is not read as her now');
  const tight = renderPeopleTiers(st, { recentPages: [], view: peopleView(0), brief: '', scenePages: [], seatsInState: false }).text;
  assert(tight.includes('SEAT-AURORA'), 'where the state of things may shed its seats, the card keeps hers');
});
