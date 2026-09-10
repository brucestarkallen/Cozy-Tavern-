/* M61 — Chat Assistant's fixed bugs, held against the housekeeper: served whole, anchors at arrival,
 * blind edits fetched, stale cards visible and retired, ripple sweep, malformed fetch, loose withdraw, record edits. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { formatPage, buildHousekeeperContext, parseProtocol, stageProposals, runConversation, rippleScan, removedWords, applySupersede, applyProposal, undoLatest, FULL_PAGE_CAP, FETCH_PAGE_CAP } from '../../js/agents/housekeeper.js';
import { emptyState } from '../../js/engine/state.js';
import { saveMemory, loadMemory } from '../../js/agents/memory.js';
import { db } from '../../js/store.js';

const long = 'word '.repeat(3000).trim(); /* 15k chars */

test('M61-1 (v2.72) a page is served WHOLE and stamped with its count — never a silent stump', () => {
  eq(FULL_PAGE_CAP, 0); eq(FETCH_PAGE_CAP, 0);
  const f = formatPage({ id: 'abcdef123', role: 'assistant', text: long });
  assert(f.includes('(' + long.length + ' chars, COMPLETE'), 'the count and the verdict');
  assert(f.includes(long.slice(-20)), 'the last words are there');
  const ctx = buildHousekeeperContext({ story: { title: 't' }, messages: [{ id: 'x1', role: 'assistant', text: long, ts: 1 }], state: emptyState(), modules: [], lore: [], memory: { nodes: [] }, contextPages: 8 });
  assert(ctx.includes(long.slice(-20)) && !ctx.includes('…\n"""'), 'the context serves it whole');
});

test('M61-2 the record rides in the context with handles; pending cards ride with STALE marks', () => {
  const memory = { nodes: [{ id: 'r1abcd', span: [0, 5], text: '[Day 1] Jovan came home', level: 1, at: 0 }] };
  const session = { turns: [{ role: 'housekeeper', text: 'x', proposals: [{ id: 'p1', kind: 'edit', label: 'porch fix', status: 'pending', op: { messageId: 'm1', find: 'words that are gone', replace: 'x' } }, { id: 'p2', kind: 'edit', label: 'live fix', status: 'pending', op: { messageId: 'm1', find: 'still here', replace: 'y' } }] }] };
  const ctx = buildHousekeeperContext({ story: { title: 't' }, messages: [{ id: 'm1', role: 'assistant', text: 'the words still here', ts: 1 }], state: emptyState(), modules: [], lore: [], memory, session, contextPages: 8 });
  assert(/THE RECORD[\s\S]*\[#rr1abcd pages 1–6\] \[Day 1\] Jovan came home/.test(ctx), 'the record with handles');
  assert(/“porch fix” on #m1 ⚠ STALE — its anchor no longer matches/.test(ctx), 'the dead card is marked');
  assert(/“live fix” on #m1\n/.test(ctx + '\n') && !/“live fix”[^\n]*STALE/.test(ctx), 'the live card is not');
});

test('M61-3 (v2.76) an anchor is checked at arrival: a miss is corrected in the same run, once; a still-bad card is refused at staging, never a failed Apply', async () => {
  const messages = [{ id: 'aaaaaa1', role: 'user', text: 'u', ts: 1 }, { id: 'bbbbbb2', role: 'assistant', text: 'Liara looked at Kim across the booth.', ts: 2 }];
  const answers = [
    'Fix.\n<edits>[{"id":"#bbbbbb","find":"Liara glanced at Kim","replace":"Liara looked at Kris","reason":"r"}]</edits>',
    'Fixed.\n<edits>[{"id":"#bbbbbb","find":"Liara looked at Kim","replace":"Liara looked at Kris","reason":"r"}]</edits>',
  ];
  const seen = [];
  const call = async ({ messages: wire }) => { seen.push(wire[wire.length - 1].content); return { text: answers.shift() || 'done' }; };
  const r = await runConversation({ story: { title: 't' }, messages, state: emptyState(), modules: [], lore: [], memory: { nodes: [] }, session: { turns: [] }, writerText: 'fix it', contextPages: 8, call });
  assert(r.ok);
  assert(seen.some((c) => /\[ANCHOR CHECK\][\s\S]*Liara glanced at Kim/.test(c)), 'the miss was named back');
  const staged = stageProposals(r.parsed, { messages, state: emptyState(), modules: [], lore: [] });
  eq(staged[0].status, 'pending', 'the corrected anchor stages');
  const bad = stageProposals(parseProtocol('<edits>[{"id":"#bbbbbb","find":"never there","replace":"x"}]</edits>'), { messages, state: emptyState(), modules: [], lore: [] });
  eq(bad[0].status, 'refused'); assert(/anchor does not match/.test(bad[0].words));
});

test('M61-4 (v2.80) a blind edit — a page only seen as an index line — is fetched whole and re-asked, once', async () => {
  const messages = [];
  for (let i = 0; i < 20; i += 1) messages.push({ id: 'pg' + String(i).padStart(4, '0'), role: i % 2 ? 'assistant' : 'user', text: 'page ' + i + ' words', ts: i });
  const answers = [
    'Edit an old page.\n<edits>[{"id":"#pg0000","find":"page 0 words","replace":"page zero","reason":"r"}]</edits>',
    'Now with it whole.\n<edits>[{"id":"#pg0000","find":"page 0 words","replace":"page zero","reason":"r"}]</edits>',
  ];
  const seen = [];
  const call = async ({ messages: wire }) => { seen.push(wire[wire.length - 1].content); return { text: answers.shift() || 'done' }; };
  const r = await runConversation({ story: { title: 't' }, messages, state: emptyState(), modules: [], lore: [], memory: { nodes: [] }, session: { turns: [] }, writerText: 'x', contextPages: 4, call });
  assert(r.ok);
  assert(seen.some((c) => /\[BLIND EDIT\][\s\S]*#pg0000[\s\S]*COMPLETE/.test(c)), 'served whole, then re-asked');
  eq(answers.length, 0, 'exactly one extra round');
});

test('M61-5 (v2.77) the ripple: the words an edit removes are found on every surface and handed back once', async () => {
  const messages = [{ id: 'm1aaaa', role: 'assistant', text: 'Kim is the mother. She waits.', ts: 1 }, { id: 'm2bbbb', role: 'assistant', text: 'They all knew Kim is the mother.', ts: 2 }];
  const state = emptyState(); state.characters = { Kendall: { core: 'Kim is the mother of her' } }; state.canon = { Kendall: { mother: 'Kim is the mother' } };
  const memory = { nodes: [{ id: 'rr1234', span: [0, 5], text: 'Kim is the mother, established', level: 1, at: 0 }] };
  const lore = [{ id: 'l1', name: 'Family', keys: ['family'], content: 'Kim is the mother.', enabled: true }];
  eq(removedWords('Kim is the mother', 'Kris is the mother'), 'Kim', 'only the changed word');
  eq(removedWords('Kim is the mother', 'Kris Jenner is the mother'), 'Kim');
  const leftovers = rippleScan([{ id: '#m1aaaa', find: 'Kim is the mother', replace: 'Kris is the mother' }], { messages, memory, state, lore });
  eq(leftovers.length, 1);
  const where = leftovers[0].where.join(' | ');
  assert(/#m2bbbb/.test(where) && /record line #rrr1234/.test(where) && /page of Kendall/.test(where) && /canon of Kendall/.test(where) && /lore entry “Family”/.test(where), where);
  const answers = ['One.\n<edits>[{"id":"#m1aaaa","find":"Kim is the mother","replace":"Kris is the mother","reason":"r"}]</edits>', 'Swept.\n<edits>[{"id":"#m1aaaa","find":"Kim is the mother","replace":"Kris is the mother","reason":"r"},{"id":"#m2bbbb","find":"Kim is the mother","replace":"Kris is the mother","reason":"r"}]</edits><record>[{"line":"#rrr1234","find":"Kim is the mother","replace":"Kris is the mother"}]</record>'];
  const seen = [];
  const call = async ({ messages: wire }) => { seen.push(wire[wire.length - 1].content); return { text: answers.shift() || 'done' }; };
  const r = await runConversation({ story: { title: 't' }, messages, state, modules: [], lore, memory, session: { turns: [] }, writerText: 'fix', contextPages: 8, call });
  assert(seen.some((c) => /\[RIPPLE\][\s\S]*“Kim”/.test(c)), 'the ripple was handed back');
  eq(r.parsed.edits.length, 2); eq(r.parsed.record.length, 1);
});

test('M61-6 (v2.79/v2.78) a fetch in words is told once; a withdraw in prose removes nothing, the block does, loosely matched, unmatched named', async () => {
  const messages = [{ id: 'q1aaaa', role: 'assistant', text: 'x', ts: 1 }];
  const answers = ['<fetch>the sister\'s messages</fetch>', 'Fine, no fetch.'];
  const seen = [];
  const call = async ({ messages: wire }) => { seen.push(wire[wire.length - 1].content); return { text: answers.shift() || 'done' }; };
  const r = await runConversation({ story: { title: 't' }, messages, state: emptyState(), modules: [], lore: [], memory: { nodes: [] }, session: { turns: [] }, writerText: 'x', contextPages: 8, call });
  assert(r.ok && seen.some((c) => /could not be read/.test(c)));
  const session = { turns: [{ role: 'housekeeper', text: 'x', proposals: [{ id: 'p1', kind: 'edit', label: 'Memory fix 1', status: 'pending', op: {} }] }] };
  const sup = applySupersede(session, ['memory fix #1', 'nothing like this']);
  eq(sup.count, 1); eq(sup.unmatched.join(','), 'nothing like this');
  eq(session.turns[0].proposals[0].status, 'superseded');
});

test('M61-7 a record line is edited by the smallest change and taken back; a dead-anchor pending card is retired by a newer proposal', async () => {
  const storyId = 'm61-record';
  await db.messages.append(storyId, { role: 'assistant', text: 'a page' });
  await saveMemory(storyId, { window: 30, nodes: [{ id: 'nnn111', span: [0, 5], text: '[Day 1] Kim is the mother; Jovan came home', level: 1, at: 0 }] });
  const mem = await loadMemory(storyId);
  const session = { turns: [], batches: [] };
  const staged = stageProposals(parseProtocol('<record>[{"line":"#rnnn111","find":"Kim is the mother","replace":"Kris is the mother","reason":"the brief"}]</record>'), { messages: [], state: emptyState(), modules: [], lore: [], memory: mem, session });
  eq(staged[0].kind, 'record'); eq(staged[0].status, 'pending');
  session.turns.push({ role: 'housekeeper', text: 'x', proposals: staged, ts: 1 });
  const r = await applyProposal(session, storyId, staged[0].id);
  assert(r.ok, r.words);
  eq((await loadMemory(storyId)).nodes[0].text, '[Day 1] Kris is the mother; Jovan came home');
  const u = await undoLatest(session, storyId);
  assert(u.ok); eq((await loadMemory(storyId)).nodes[0].text, '[Day 1] Kim is the mother; Jovan came home');
  /* dead anchor retired by a newer proposal on the same page */
  const messages = [{ id: 'zz1111', role: 'assistant', text: 'the text as it stands now', ts: 1 }];
  const sess2 = { turns: [{ role: 'housekeeper', text: 'x', proposals: [{ id: 'old', kind: 'edit', label: 'old', status: 'pending', op: { messageId: 'zz1111', find: 'completely different words here', replace: 'y' } }, { id: 'live', kind: 'edit', label: 'live', status: 'pending', op: { messageId: 'zz1111', find: 'as it stands', replace: 'z' } }] }] };
  stageProposals(parseProtocol('<edits>[{"id":"#zz1111","find":"stands now","replace":"stood then"}]</edits>'), { messages, state: emptyState(), modules: [], lore: [], session: sess2 });
  eq(sess2.turns[0].proposals[0].status, 'superseded', 'the dead one is retired');
  eq(sess2.turns[0].proposals[1].status, 'pending', 'the live one stands');
});
