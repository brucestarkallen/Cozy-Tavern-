/* M72 — the ledger foolproof: the fold by what a snapshot holds, every
 * write journaled (the scribe, the world's word, the take-back), committed
 * fate through a rewind, the sequenced replay, the keeper's re-read. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { applyMutations, undoLast, undoEntry } from '../../js/engine/apply.js';
import { emptyState, foldJournal, journalKey, saveState, loadState } from '../../js/engine/state.js';
import { refereeStep } from '../../js/agents/referee.js';
import { scribeTurn } from '../../js/agents/scribe.js';
import { maybeSummarize, loadMemory, saveMemory, memoryWithoutPage } from '../../js/agents/memory.js';
import { thinkingHouse, withHouse, HOUSES } from './thinkinghouse.mjs';
import { db } from '../../js/store.js';

const chat = () => readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
const names = (st) => (st.present || []).map((p) => p.name).sort().join(',');
const enter = (name) => ({ type: 'presence.enter', name });
const clone = (v) => JSON.parse(JSON.stringify(v));

/* a ledger written page by page, the way the chain writes it */
function tell(pages) {
  let st = emptyState();
  for (let p = 0; p < pages.length; p += 1) { st.page = p; st = applyMutations(st, pages[p]).state; }
  return st;
}

test('M72-1 the fold re-applies what a snapshot does NOT hold — a boundary taken mid-chain no longer loses the late entries', () => {
  /* page 0 seats Ann; page 1's chain is half done (Bob landed) when the boundary for turn 2 is taken with page = 1 */
  let st = tell([[enter('Ann')]]);
  st.page = 1;
  st = applyMutations(st, [enter('Bob')]).state;
  const midChain = { id: 'u2', snap: clone(st) }; /* page 1, holds Ann and Bob */
  st = applyMutations(st, [enter('Cal')]).state; /* still page 1 — the late entry */
  st.page = 2;
  st = applyMutations(st, [enter('Dee')]).state;
  const folded = foldJournal(st, [midChain], 1, applyMutations);
  eq(names(folded), 'Ann,Bob,Cal', 'the late entry (same page, after the snapshot) is re-applied');
  eq(folded.page, 1);
  eq(folded.journal.length, 3, 'the folded journal holds exactly the three writes of pages 0–1');
  /* a held twin counts once per copy: Bob entered twice on page 1 legitimately (left between) */
  let st2 = tell([[enter('Ann')]]);
  st2.page = 1;
  st2 = applyMutations(st2, [enter('Bob')]).state;
  const snap2 = { id: 'u2', snap: clone(st2) };
  st2 = applyMutations(st2, [{ type: 'presence.leave', name: 'Bob' }, enter('Bob')]).state;
  const f2 = foldJournal(st2, [snap2], 1, applyMutations);
  eq(names(f2), 'Ann,Bob', 'the second Bob is re-applied once; the first is the snapshot’s');
  eq(f2.journal.filter((e) => journalKey(e) === journalKey({ p: 1, m: enter('Bob') })).length, 2, 'both entries stand in the folded journal');
});

test('M72-2 a fold never re-arms a consumed ruling, and carries the referee’s own timeline', () => {
  let st = tell([[enter('Ann')]]);
  const snap = { id: 'u1', snap: { ...clone(st), pendingVerdict: { words: 'a ruling', kind: 'check' }, refHistory: [{ key: 'k1', msgId: 'u1' }] } };
  st.refHistory = [{ key: 'k1', msgId: 'u1' }, { key: 'k2', msgId: 'u2' }];
  const folded = foldJournal(st, [snap], 0, applyMutations);
  eq(folded.pendingVerdict, null, 'the ruling that rode that turn does not ride again');
  eq(folded.refHistory.length, 2, 'the current timeline rides with the fold');
});

test('M72-3 the scribe’s delta is a journaled write (people.note): the fold keeps it; a take-back returns it', () => {
  let st = tell([[enter('Ann')]]);
  st.page = 1;
  const r = applyMutations(st, [{ type: 'people.note', name: 'Ann', field: 'state', text: 'at the window, uneasy' }, { type: 'people.note', name: 'Ann', field: 'thread', text: 'owes Bob an answer' }, { type: 'people.note', name: 'Ann', field: 'mood', text: 'uneasy' }]);
  eq(r.applied.length, 2, 'two notes land');
  assert(/Ann — where they are was noted: at the window, uneasy/.test(r.applied[0].words), r.applied[0].words);
  eq(r.rejected.length, 1, 'a field the ledger has no page for is refused, as the merge always did');
  assert(/isn’t a page of the ledger/.test(r.rejected[0].why), r.rejected[0].why);
  eq(r.state.characters.Ann.state, 'at the window, uneasy');
  eq(r.state.characters.Ann.threads.join('|'), 'owes Bob an answer');
  eq(r.state.journal.filter((e) => e.m.type === 'people.note').length, 2, 'both ride the journal');
  /* the fold from an empty base rebuilds the page */
  const folded = foldJournal(r.state, [], 1, applyMutations);
  eq(folded.characters.Ann.state, 'at the window, uneasy', 'a fold from nothing keeps the scribe’s page');
  /* the take-back */
  const u = undoLast(r.state);
  eq(u.state.characters.Ann.threads.length, 0, 'the loose end is taken back');
  eq(u.state.journal[u.state.journal.length - 1].m.type, 'undo.apply', 'the take-back rides the journal');
});

test('M72-4 the take-back is journaled: a fold from a base taken BEFORE the undo reverses it too', () => {
  let st = tell([[enter('Ann')], [enter('Bob')]]);
  const base = { id: 'u3', snap: clone(st) }; /* holds Ann and Bob */
  const at = st.log.findIndex((e) => /Bob/.test(e.words) && e.undo);
  const u = undoEntry(st, at);
  assert(u && u.state, 'Bob is taken back');
  eq(names(u.state), 'Ann');
  const folded = foldJournal(u.state, [base], 1, applyMutations);
  eq(names(folded), 'Ann', 'the fold from the base that still held Bob reverses him too');
  const fromNothing = foldJournal(u.state, [], 1, applyMutations);
  eq(names(fromNothing), 'Ann', 'and from nothing: applied, then taken back');
  /* the M49 refusal law still holds through the journal: a later change to the same thing.
   * (M72 found it read an entrance and a later change to the same person as two targets.) */
  const st2 = tell([[enter('Ann')], [{ type: 'presence.update', name: 'Ann', position: 'by the door' }]]);
  const first = st2.log.findIndex((e) => /Ann/.test(e.words) && e.undo);
  const refused = undoEntry(st2, first);
  assert(refused && refused.refused, 'a later change touched Ann — refused');
  const later = undoEntry(st2, st2.log.findIndex((e) => /by the door/.test(e.words)));
  assert(later && later.state, 'the later change itself can be taken back');
  eq(later.state.present[0].position, undefined, 'and Ann stands where she entered');
});

test('M72-5 the world’s word is a journaled write (world.word): a fold hands the storyteller the brief the page had', () => {
  let st = tell([[enter('Ann')]]);
  st.page = 1;
  const r = applyMutations(st, [{ type: 'world.word', brief: { pressure: ['Bob is coming up the stairs'], ripe: [], twb: { who: 'Cal', where: 'the yard', changed: 'found the gate open' } } }]);
  eq(r.applied.length, 1);
  assert(/left its word/.test(r.applied[0].words), r.applied[0].words);
  eq(r.state.worldBrief.pressure[0], 'Bob is coming up the stairs');
  eq(r.state.worldShown.length, 1, 'a window opened is remembered');
  const folded = foldJournal(r.state, [], 1, applyMutations);
  eq(folded.worldBrief.pressure[0], 'Bob is coming up the stairs', 'the fold keeps the brief');
  const u = undoLast(r.state);
  eq(u.state.worldBrief, null, 'taken back: no brief');
  eq(u.state.worldShown.length, 0);
  const empty = applyMutations(st, [{ type: 'world.word', brief: {} }]);
  assert(/no word/.test(empty.applied[0].words), 'an empty word is said as such');
});

test('M72-6 committed fate survives a rewound ledger: the replay puts back the world the ruling left', async () => {
  const conn = { type: 'openai' };
  const openLLM = async () => JSON.stringify({ check: true, kind: 'actor', action: 'I swing at Rusk', opposition: 'Rusk', circumstance: 0, duel_start: { opponent: 'Rusk', domain: 'melee', rating: 5 } });
  const m1 = { id: 'u1', role: 'user', text: 'I swing at Rusk' };
  const before = { ...emptyState(), turn: 1 };
  const first = await refereeStep({ connection: conn, userText: 'I swing at Rusk', userId: 'u1', history: [m1], state: clone(before), settings: {}, callLLM: openLLM });
  eq(first.status, 'ruled');
  assert(first.state.duel, 'a duel opened');
  eq(first.state.mode.combat, true, 'the mode says so');
  const commit = first.state.refHistory[first.state.refHistory.length - 1];
  assert(commit && commit.after && commit.after.duel, 'the commit carries the world after the ruling');
  /* TRUE rollback: the ledger before the turn, but the timeline kept (as the fold keeps it) */
  const rewound = { ...clone(before), refHistory: clone(first.state.refHistory) };
  let asked = 0;
  const replay = await refereeStep({ connection: conn, userText: 'I swing at Rusk', userId: 'u1', history: [m1], state: rewound, settings: {}, callLLM: async () => { asked += 1; return openLLM(); } });
  eq(replay.status, 'replayed', 'the same words replay');
  eq(asked, 0, 'no second roll');
  eq(JSON.stringify(replay.state.duel), JSON.stringify(first.state.duel), 'the duel the ruling opened stands again');
  eq(replay.state.mode.combat, true, 'and the mode with it');
  eq(replay.ruling.directive, first.ruling.directive, 'same ruling, word for word');
});

test('M72-7 the send path: the coming page stamps the turn, the boundary follows the referee, no chain is turned stale by a send', () => {
  const c = chat();
  const gen = c.slice(c.indexOf('async function generate('), c.indexOf('async function retryAsk('));
  assert(/state\.page = history\.filter\(\(m\) => m && m\.role === 'assistant' && !m\.hidden\)\.length;/.test(gen), 'the coming page’s index is the stamp');
  assert(gen.indexOf('state.page = history.filter') < gen.indexOf('refereeStep'), 'set before the referee');
  assert(gen.indexOf('refereeStep') < gen.indexOf('await snapshotState(story.id, lastUser.id, state)'), 'the boundary is taken after the referee commits');
  assert(!/bumpChain/.test(gen), 'a send never turns the chain generation (the previous page’s readers must land)');
  /* stopped pages are read */
  assert(/if \(!ooc\) \{\n\s*startBackgroundWork\(story, saved, userText\);/.test(gen), 'a page stopped by hand is handed to the workers');
  assert(/if \(story\.extraction !== false && !ooc && !replayAfter\) \{/.test(gen), 'a swiped page too — unless the replay reads it');
});

test('M72-8 the rewind is the fold; the replay is sequenced; a writer’s page deleted moves no stamp; the tail folds; the walk waits', () => {
  const c = chat();
  const rw = c.slice(c.indexOf('async function rewindTo('), c.indexOf('async function rewindTo(') + 1200);
  assert(/await foldTo\(story, target\);/.test(rw), 'with a journal, the rewind is a fold');
  assert(/restoreNearestSnapshot\(story\.id, order, userMsgId\)/.test(rw), 'a store from before the journal keeps its boundary');
  const ft = c.slice(c.indexOf('async function foldTo('), c.indexOf('async function foldTo(') + 900);
  assert(/bumpChain\(story\.id\);/.test(ft) && /e\.snap\.page > targetPage/.test(ft), 'a fold turns the generation and lets the later boundaries go');
  const rp = c.slice(c.indexOf('async function replayFrom('), c.indexOf('async function repairTimeline('));
  assert(rp.indexOf('await pendingWork(story.id, 120000)') < rp.indexOf('await foldTo(story, k - 1)'), 'the readers in flight land before the fold');
  assert(/enqueueWork\(story\.id, \{ name: 'checkpoint', run: async \(\) => \{/.test(rp), 'the tail is a job behind the one reading');
  assert(rp.indexOf('startBackgroundWork(story, vis[at]') < rp.indexOf("enqueueWork(story.id, { name: 'checkpoint'"), 'queued after the chain');
  assert(/const bases = \(await loadSnapshots\(story\.id\)\)\.filter\(\(e\) => e\.snap && Number\.isInteger\(e\.snap\.page\) && e\.snap\.page < k\);/.test(rp), 'the re-taken boundaries fold from the snapshots before the change, never from nothing');
  assert(/replaying = false;/.test(rp.slice(rp.indexOf('finally'))), 'the tail clears the flag');
  const del = c.slice(c.indexOf('async function deleteMessage('), c.indexOf('async function deleteMessage(') + 3600);
  assert(/if \(gone && gone\.role === 'assistant'\) \{/.test(del), 'a writer’s page let go shifts no storyteller page');
  assert(/await foldTo\(story, goneK - 1\);/.test(del), 'the tail page let go folds the ledger back now');
  assert(del.indexOf('await db.messages.remove(story.id, id);') < del.indexOf('ledgerWork = replayFrom') && del.indexOf('ledgerWork = replayFrom') < del.indexOf("querySelector(`.msg[data-id"), 'the ledger work is claimed before any rendering');
  const sw = c.slice(c.indexOf('async function swipeTo('), c.indexOf('async function swipeRegenerate('));
  assert(sw.indexOf('if (!last) replayFrom(story, msg.id, { changed: true });') < sw.indexOf('await rerenderMessage(story.id, msg.id);'), 'a walked version on an older page claims its replay before rendering');
  const sr = c.slice(c.indexOf('async function swipeRegenerate('), c.indexOf('async function swipeRegenerate(') + 3000);
  assert(/if \(landed && !lastPage\) replayFrom\(story, msg\.id, \{ changed: true \}\);/.test(sr), 'a new version on an older page replays');
  assert(sr.indexOf('replayFrom(story, msg.id, { changed: true })') < sr.indexOf('stories = await db.stories.list();'), 'claimed before any await after generate (M73-002)');
  assert(!/pendingAudit\.add\(story\.id\);\n\s*\}\n\s*\/\* M44: a swiped/.test(sr), 'no audit owed in its place');
  for (const fn of ['swipeTo', 'regenerateFrom', 'retryUserMessage', 'beginEdit', 'deleteMessage', 'swipeRegenerate']) {
    const body = c.slice(c.indexOf('async function ' + fn + '('), c.indexOf('async function ' + fn + '(') + 700);
    assert(/if \(replaying\) \{ toast\(/.test(body), fn + ' waits for a replay, and says so');
  }
  assert(/isReplaying,/.test(c), 'the walk can wait on the replay');
  const walk = readFileSync(new URL('../dom/run.mjs', import.meta.url), 'utf8');
  assert(/'swipe-new-old', 'edit-last', 'delete-user-mid', 'send', 'delete-tail', 'send'/.test(walk), 'the invariant walk drives the new cases');
  assert(/the standing ledger is the last page’s/.test(walk), 'and checks the ledger as it stands, not only the branches');
  const br = c.slice(c.indexOf('async function branchFrom('), c.indexOf('async function branchFrom(') + 8000);
  assert(/carriedNow\.refHistory = /.test(br) && /msgId: idMap\[e\.msgId\]/.test(br), 'the branch re-keys the referee’s timeline');
});

test('M72-9 every job in the chain answers to the chain generation, and the keeper is told', () => {
  const c = chat();
  const bw = c.slice(c.indexOf('function startBackgroundWork('), c.indexOf('async function gatherSettings('));
  assert(/const gen = chainGen\.get\(story\.id\) \|\| 0;/.test(bw), 'captured when queued');
  assert(/stale: \(\) => stale\(\) \|\| \(chainGen\.get\(story\.id\) \|\| 0\) !== gen/.test(bw), 'a turned counter is stale');
  for (const name of ['world', 'scribe', 'auditor']) assert(new RegExp("enqueue\\('" + name + "', async \\(\\{ signal, stale \\}\\) => \\{\\n\\s*if \\(story\\.extraction === false \\|\\| stale\\(\\)\\) return").test(bw), name + ' checks first');
  assert(/stale, \/\* M72: a keeper whose ledger was rewound under it writes nothing \*\//.test(bw), 'the keeper is told');
  assert(/enqueue\('seeder', async \(\{ signal, stale \}\) => \{\n\s*try \{\n\s*if \(stale\(\)\) return/.test(bw), 'the seeder too');
  const cont = bw.slice(bw.indexOf("enqueue('continuity'"), bw.indexOf("enqueue('auditor'"));
  assert(/if \(stale\(\)\) return \{ silent: true \};\n\s*const fresh = await loadState\(story\.id\);/.test(cont), 'the second reader checks before reading');
});

test('M72-10 the keeper re-reads the record before it writes: a hole punched during its call stays a hole; another writer’s line survives; a stale keeper writes nothing', async () => {
  const sid = 'm72-keeper';
  const saved = [];
  for (let i = 0; i < 40; i += 1) saved.push(await db.messages.append(sid, { role: i % 2 ? 'assistant' : 'user', text: 'Page ' + i + (i % 2 ? ': Ann spoke.' : ': I speak.') }));
  await db.settings.set('memoryWindow', 10);
  await db.settings.set('memoryBatch', 6);
  const conn = HOUSES[0].conn;
  /* a house whose FIRST summarizing call has a side effect on the store, as a hand would */
  const scripted = (during) => {
    let calls = 0;
    return { fetch: async (url, opts) => {
      const body = JSON.parse(opts.body);
      const user = body.messages[body.messages.length - 1].content;
      let answer;
      if (/NONE, or one DETAIL/.test(user)) answer = 'NONE';
      else if (/<snippet>/.test(user)) answer = 'NONE';
      else { calls += 1; if (calls === 1 && during) await during(); answer = '[Day 1] the player spoke; Ann spoke'; }
      return thinkingHouse({ answer }).fetch(url, opts);
    } };
  };
  /* 1. another writer adds a line while the keeper is out — the keeper's write keeps it */
  await saveMemory(sid, { window: 10, nodes: [] });
  await withHouse(scripted(async () => {
    const now = await loadMemory(sid);
    await saveMemory(sid, { ...now, nodes: [...now.nodes, { id: 'other-writer', span: [24, 29], text: 'the other writer’s line', level: 1, at: 5 }] });
  }), () => maybeSummarize({ connection: conn, storyId: sid, stale: () => false }));
  let mem = await loadMemory(sid);
  assert(mem.nodes.some((n) => n.id === 'other-writer'), 'the line written during the call survives the keeper’s save');
  assert(mem.nodes.some((n) => n.span[0] === 0 && n.text.startsWith('[Day 1]')), 'and the keeper’s own line landed');
  /* 2. the words of a page in the batch change while the keeper is out — the line is let go, the pages wait */
  await saveMemory(sid, { window: 10, nodes: [] });
  await withHouse(scripted(async () => {
    await db.messages.update(sid, saved[2].id, { text: 'Page 2: re-inked by hand.' });
  }), () => maybeSummarize({ connection: conn, storyId: sid, stale: () => false }));
  mem = await loadMemory(sid);
  assert(!mem.nodes.some((n) => n.span[0] <= 2 && 2 <= n.span[1]), 'no line covers the page whose words moved under the keeper: ' + JSON.stringify(mem.nodes.map((n) => n.span)));
  /* 3. a hole punched while the keeper is out stays a hole */
  await saveMemory(sid, { window: 10, nodes: [{ id: 'covers-0-5', span: [0, 5], text: 'a standing line', level: 1, at: 1 }] });
  await withHouse(scripted(async () => {
    await saveMemory(sid, memoryWithoutPage(await loadMemory(sid), 3));
  }), () => maybeSummarize({ connection: conn, storyId: sid, stale: () => false }));
  mem = await loadMemory(sid);
  assert(!mem.nodes.some((n) => n.id === 'covers-0-5'), 'the hole cut during the call is not filled back by the pre-call copy');
  /* 4. a stale keeper writes nothing */
  await saveMemory(sid, { window: 10, nodes: [] });
  const r = await withHouse(scripted(null), () => maybeSummarize({ connection: conn, storyId: sid, stale: () => true }));
  eq((await loadMemory(sid)).nodes.length, 0, 'a rewound ledger under the keeper: nothing written');
  eq(r, null, 'and it says so');
});

test('M72-11 the scribe writes through the journal, end to end through the mock house', async () => {
  const sid = 'm72-scribe';
  await saveState(sid, { ...emptyState(), page: 0, present: [{ name: 'Ann' }], characters: { Ann: { core: 'a quiet woman', state: '', arc: '', threads: [], updatedAtTurn: 0 } } });
  const house = thinkingHouse({ answer: JSON.stringify({ deltas: [{ name: 'Ann', field: 'state', text: 'at the window, watching the road' }] }) });
  const conn = HOUSES[0].conn;
  const r = await withHouse(house, () => scribeTurn({ connection: conn, storyId: sid, userText: 'I wait.', assistantText: 'Ann went to the window and watched the road.', stale: () => false }));
  assert(r && r.changes.length === 1, 'one change: ' + JSON.stringify(r));
  eq(r.changes[0].name, 'Ann');
  const st = await loadState(sid);
  eq(st.characters.Ann.state, 'at the window, watching the road');
  eq(st.journal.filter((e) => e.m.type === 'people.note').length, 1, 'the delta rides the journal');
  assert(st.log.some((e) => /Ann — where they are was noted/.test(e.words)), 'and the log says so');
  const folded = foldJournal(st, [], -1, applyMutations);
  assert(!folded.characters.Ann || !folded.characters.Ann.state, 'a fold to before the page has no note');
  const folded0 = foldJournal(st, [], 0, applyMutations);
  eq((folded0.characters.Ann || {}).state, 'at the window, watching the road', 'a fold to the page has it');
});

test('M72-12 the fixture: the writer’s SillyTavern regex file rides in the repo, never in /tmp', () => {
  const m31 = readFileSync(new URL('./m31.mjs', import.meta.url), 'utf8');
  assert(!/\/tmp\/st-regex\.json/.test(m31), 'no read from /tmp');
  assert(/fixtures\/st-regex\.json/.test(m31), 'the fixture is read');
  const file = JSON.parse(readFileSync(new URL('../fixtures/st-regex.json', import.meta.url), 'utf8'));
  assert(file.length >= 20 && file.every((r) => typeof r.findRegex === 'string' && r.markdownOnly === true), 'SillyTavern’s shape, display-only');
});
