/* M682: the six findings left beside the completed ledger audit. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { emptyState, foldJournal } from '../../js/engine/state.js';
import { applyMutations, undoEntry } from '../../js/engine/apply.js';
import { extractTurn } from '../../js/agents/extractor.js';
import { memoryAfterDeletion, memoryAfterInsertion, memoryTruncatedAt, memoryWithoutPage, saveMemory, loadMemory, maybeSummarize } from '../../js/agents/memory.js';
import { holdPageLayout, enqueueWork } from '../../js/agents/queue.js';

const conn = { type: 'openai', baseUrl: 'https://x.test/v1', apiKey: 'k', model: 'm', reasoning: { effort: 'off' } };
function say(content, reason = 'stop') {
  const text = 'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\n'
    + 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: reason }] }) + '\n\ndata: [DONE]\n\n';
  return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } }), clone() { return this; }, async json() { return {}; }, async text() { return text; } };
}
const answer = (mutations) => JSON.stringify({ mutations });
const board = { type: 'mode.snapshot', flags: [] };

test('M682-1 A CUT READING IS ASKED AGAIN even when its salvaged JSON includes the mood board; a whole reading outranks a longer cut one', async () => {
  const old = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls += 1; return calls === 1
    ? say(answer([board, { type: 'presence.enter', name: 'Liara' }, { type: 'presence.enter', name: 'Kim' }]), 'length')
    : say(answer([board, { type: 'presence.enter', name: 'Liara' }])); };
  try {
    const read = await extractTurn({ connection: conn, state: emptyState(), founding: false, assistantText: 'Liara sat down. Kim stayed outside.', userText: 'I wait.' });
    eq(calls, 2, 'the provider cut is not accepted as a complete reading');
    eq(read.note, 'ok');
    eq(read.mutations.filter((m) => m.type === 'presence.enter').map((m) => m.name).join(','), 'Liara', 'the whole answer wins');
  } finally { globalThis.fetch = old; }
});

test('M682-2 TWO CUT READINGS keep the useful writes and disclose that the page still needs a complete reading', async () => {
  const old = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls += 1; return say(answer([board, { type: 'presence.enter', name: 'Liara' }]), 'length'); };
  try {
    const read = await extractTurn({ connection: conn, state: emptyState(), founding: false, assistantText: 'Liara sat down.', userText: 'I wait.' });
    eq(calls, 2);
    eq(read.note, 'cut short');
    assert(read.incomplete === true, 'the caller must not mark the page completely read');
    assert(read.mutations.some((m) => m.type === 'presence.enter' && m.name === 'Liara'), 'the salvaged writes remain');
  } finally { globalThis.fetch = old; }
});

test('M682-3 THE KEEPER FAILURE MARK follows its own page through deletion, insertion, truncation and rewritten words', () => {
  const mem = { window: 20, nodes: [], stuck: { at: 5, tries: 1 } };
  eq(memoryAfterDeletion(mem, 2).stuck.at, 4, 'an earlier page gone moves the marker down');
  assert(!memoryAfterDeletion(mem, 5).stuck, 'its own page gone clears the marker');
  eq(memoryAfterInsertion(mem, 2).stuck.at, 6, 'an earlier page back moves the marker up');
  assert(!memoryTruncatedAt(mem, 5).stuck, 'a folded away page has no failed reading left');
  eq(memoryTruncatedAt(mem, 6).stuck.at, 5, 'a retained page keeps its marker');
  assert(!memoryWithoutPage(mem, 5).stuck, 'new words get their own first attempt');
  eq(mem.stuck.at, 5, 'the source memory is untouched');
});

test('M682-4 A HALF BATCH is checked only against the pages its line actually covers, and its next batch still folds', async () => {
  const st = await db.stories.create({ title: 'a split keeper reading' });
  for (let i = 0; i < 40; i += 1) await db.messages.append(st.id, { role: i % 2 ? 'assistant' : 'user', text: 'PAGE_TOKEN_' + i + ' Jovan waited beside the porch.' });
  await db.settings.set('memoryWindow', 20); await db.settings.set('memoryBatch', 6);
  await saveMemory(st.id, { window: 20, nodes: [] });
  const old = globalThis.fetch; const checks = []; let folds = 0;
  globalThis.fetch = async (url, opts) => {
    const user = JSON.parse(opts.body).messages.slice(-1)[0].content;
    if (/The pages the line was written from:|<snippet>/.test(user)) { checks.push(user); return say('NONE'); }
    folds += 1;
    return say('Jovan waited beside the porch; Liara watched the road.', folds <= 2 ? 'length' : 'stop');
  };
  try {
    await maybeSummarize({ connection: conn, storyId: st.id, renew: () => true });
    const nodes = (await loadMemory(st.id)).nodes;
    eq(nodes[0].span.join(','), '0,2', 'the line covers half the original batch');
    const firstChecks = checks.filter((u) => /PAGE_TOKEN_0\b/.test(u));
    assert(firstChecks.length >= 2, 'both verification and detail audit ran');
    assert(firstChecks.every((u) => !/PAGE_TOKEN_[345]\b/.test(u)), 'neither checker sees the other half');
    assert(nodes.some((n) => n.span[0] === 3), 'the next batch is allowed to land');
  } finally { globalThis.fetch = old; await db.settings.delete('memoryWindow'); await db.settings.delete('memoryBatch'); }
});

test('M682-5 TAKING BACK A FIGHT keeps later weighings, including changes to a fighter already on the sheet', () => {
  let st = emptyState(); st.sheet = { playerName: 'Jovan', actors: { Jovan: { default: 5 }, Liara: { default: 4 } } };
  st = applyMutations(st, [{ type: 'combat.begin', kind: 'duel', opponent: 'Liara' }]).state;
  const at = st.log.length - 1;
  st = applyMutations(st, [{ type: 'sheet.weigh', actors: { Liara: { default: 8 }, Kim: { default: 7 } }, playerName: 'Jovan' }]).state;
  const back = undoEntry(st, at);
  assert(back && back.state, 'the fight can be taken back');
  eq(back.state.duel, null);
  eq(back.state.sheet.actors.Liara.default, 8, 'the later weighing of an existing fighter stays');
  eq(back.state.sheet.actors.Kim.default, 7, 'the newcomer stays');
  const folded = foldJournal(back.state, [], 0, applyMutations);
  eq(folded.sheet.actors.Kim.default, 7, 'the reversal preserves the weighing through a replay too');
});

test('M682-6 AN OLDER SAVED FIGHT TAKE-BACK also keeps later weighings', () => {
  let st = emptyState(); st.sheet = { playerName: 'Jovan', actors: { Jovan: { default: 5 }, Liara: { default: 4 } } };
  st = applyMutations(st, [{ type: 'combat.begin', kind: 'duel', opponent: 'Liara' }]).state;
  const at = st.log.length - 1;
  delete st.log[at].undo.after; /* the payload kept by every release before this fix */
  st = applyMutations(st, [{ type: 'sheet.weigh', actors: { Liara: { default: 8 } } }]).state;
  eq(undoEntry(st, at).state.sheet.actors.Liara.default, 8, 'the original journal repairs the older payload');
});

test('M682-7 TAKING BACK THE END OF A FIGHT removes its own wound and estimate while preserving a later wound and weighing', () => {
  let st = emptyState(); st.sheet = { playerName: 'Jovan', actors: { Jovan: { default: 5 } } };
  st = applyMutations(st, [{ type: 'combat.begin', kind: 'duel', opponent: 'Liara', opponentRating: 4 }]).state;
  st.duel.player.injuries = 1;
  st = applyMutations(st, [{ type: 'combat.end' }]).state;
  const at = st.log.length - 1;
  st = applyMutations(st, [{ type: 'sheet.weigh', actors: { Liara: { default: 8 } } }, { type: 'body.injure', name: 'Jovan', what: 'a scrape on his knee', sev: 1 }]).state;
  const back = undoEntry(st, at).state;
  assert(back.duel && back.duel.active, 'the fight returns');
  eq(back.sheet.actors.Liara.default, 8, 'the later weighing wins over the estimate');
  assert(back.bodies.Jovan.injuries.some((i) => /scrape/.test(i.what)), 'the later wound stays');
  assert(!back.bodies.Jovan.injuries.some((i) => /wounds taken in the fight/.test(i.what)), 'only the fight end wound goes');
});

test('M682-8 A READING BEGUN INSIDE A PAGE REBASE is discarded; a reading after the rebase runs normally', async () => {
  const release = holdPageLayout('m682-layout'); let ran = false;
  try {
    const held = await enqueueWork('m682-layout', { name: 'extractor', run: async () => { ran = true; } });
    assert(held.stale && !ran, 'no new reading can start between the visibility change and the rebase');
    const rebuilt = await enqueueWork('m682-layout', { name: 'checkpoint', layoutRebased: true, run: async () => 'rebuilt' });
    assert(rebuilt.ok, 'the replay already rebased by chat can finish inside a multi-card hold');
  } finally { release(); }
  const later = await enqueueWork('m682-layout', { name: 'extractor', run: async () => { ran = true; return 'read'; } });
  assert(later.ok && ran, 'the finished layout does not block later work');
});

test('M682-9 AN OLDER SAVED FIGHT TAKE-BACK keeps the later weighing after the journal is folded too', () => {
  let st = emptyState(); st.sheet = { playerName: 'Jovan', actors: { Jovan: { default: 5 }, Liara: { default: 4 } } };
  st = applyMutations(st, [{ type: 'combat.begin', kind: 'duel', opponent: 'Liara' }]).state;
  const at = st.log.length - 1;
  delete st.log[at].undo.after;
  st.page = 3;
  st = applyMutations(st, [{ type: 'sheet.weigh', actors: { Liara: { default: 8 } } }]).state;
  const back = undoEntry(st, at).state;
  eq(foldJournal(back, [], 3, applyMutations).sheet.actors.Liara.default, 8, 'the saved legacy reversal has the same meaning on replay');
  eq(foldJournal(back, [], 0, applyMutations).sheet.actors.Liara.default, 4, 'a rewind before the later weighing never imports it from the future');
  const alreadySaved = JSON.parse(JSON.stringify(back));
  for (const j of alreadySaved.journal) if (j.m && j.m.type === 'undo.apply') delete j.m.undo.ofWords;
  eq(foldJournal(alreadySaved, [], 3, applyMutations).sheet.actors.Liara.default, 8, 'an older reversal already saved with of, before ofWords existed, keeps the later weighing');
  eq(foldJournal(alreadySaved, [], 0, applyMutations).sheet.actors.Liara.default, 4, 'that older saved reversal still leaves future weighings in the future');
  let samePage = emptyState(); samePage.sheet = { playerName: 'Jovan', actors: { Jovan: { default: 5 }, Liara: { default: 4 } } };
  samePage = applyMutations(samePage, [{ type: 'combat.begin', kind: 'duel', opponent: 'Liara' }]).state;
  const original = samePage.log.length - 1; delete samePage.log[original].undo.after;
  samePage = applyMutations(samePage, [{ type: 'sheet.weigh', actors: { Liara: { default: 8 } } }]).state;
  const savedSamePage = undoEntry(samePage, original).state;
  for (const j of savedSamePage.journal) if (j.m && j.m.type === 'undo.apply') delete j.m.undo.ofWords;
  eq(foldJournal(savedSamePage, [], 0, applyMutations).sheet.actors.Liara.default, 8, 'an already saved older reversal preserves a weighing made later on that very page');
});
