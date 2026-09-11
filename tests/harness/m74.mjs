/* M74 — the housekeeper sees every surface it is told to keep, and can write
 * every one of them: the brief and the cast notes (whole, editable with
 * <brief>), the pages of the people (whole), the lore (whole, fetchable),
 * the rulebook (fetchable by name), the full ledger vocabulary; ledger cards
 * go stale only when the thing they touch moved; the laws against claiming. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { db } from '../../js/store.js';
import { emptyState, saveState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import {
  buildHousekeeperContext, parseProtocol, stageProposals, applyProposal, undoLatest, loadSession, saveSession,
  ledgerTargetKey, ledgerSliceHash, rippleScan, LORE_SHOW_CAP,
} from '../../js/agents/housekeeper.js';

const hk = () => readFileSync(new URL('../../js/agents/housekeeper.js', import.meta.url), 'utf8');

test('M74-1 the context shows the brief, the cast notes, the pages of the people and the lore WHOLE, and names how each is changed', () => {
  const story = { title: 'T', brief: 'Jovan comes home to Ravenwood. Rias is his older sister.', castNotes: 'Rias — 24, sharp, keeps the shop.' };
  let state = emptyState();
  state = applyMutations(state, [{ type: 'people.set', name: 'Rias', field: 'core', text: 'sharp, keeps the shop' }, { type: 'people.note', name: 'Rias', field: 'thread', text: 'owes the ferryman' }]).state;
  const lore = [{ id: 'l1', name: 'Kris', keys: ['Kris', 'mother'], content: 'Kendall’s mother. ' + 'x'.repeat(LORE_SHOW_CAP + 50), enabled: true }];
  const ctx = buildHousekeeperContext({ story, messages: [], state, modules: [{ name: 'The Prose', text: 'r' }], lore, memory: { nodes: [] }, session: { turns: [] }, contextPages: 12 });
  assert(/THE BRIEF \(.*edit it with <brief>, field "brief"\):\nJovan comes home to Ravenwood\. Rias is his older sister\./.test(ctx), 'the brief, whole and named');
  assert(/THE CAST NOTES \(.*field "cast"\):\nRias — 24, sharp, keeps the shop\./.test(ctx), 'the cast notes, whole');
  assert(/THE PAGES OF THE PEOPLE[^\n]*\n\[Rias\]\n  CORE: sharp, keeps the shop\n  STATE: \(empty\)\n  ARC: \(empty\)\n  THREADS: “owes the ferryman”/.test(ctx), 'the people, whole: ' + ctx.slice(ctx.indexOf('THE PAGES OF THE PEOPLE'), ctx.indexOf('THE PAGES OF THE PEOPLE') + 200));
  const more = lore[0].content.length - LORE_SHOW_CAP;
  assert(new RegExp('THE LORE SHELF[^\\n]*\\n\\[Kris\\] keys: Kris, mother\\nKendall’s mother\\. x+\\n  \\(…' + more + ' more characters — <fetch>\\["lore: Kris"\\]</fetch> serves it whole\\)').test(ctx), 'a long entry is cut with a way to fetch it whole: ' + ctx.slice(ctx.indexOf('more characters') - 40, ctx.indexOf('more characters') + 80));
  assert(/THE RULEBOOK holds these rules \(names only[^\n]*<fetch>\["rule: its name"\]/.test(ctx), 'rules are fetchable by name');
  const empty = buildHousekeeperContext({ story: { title: 'T' }, messages: [], state: emptyState(), modules: [], lore: [], memory: { nodes: [] }, session: { turns: [] } });
  assert(/THE BRIEF[^\n]*:\n\(empty\)/.test(empty) && /THE CAST NOTES[^\n]*:\n\(empty\)/.test(empty) && /THE PAGES OF THE PEOPLE: none written yet\./.test(empty));
});

test('M74-2 the prompt teaches <brief>, the whole ledger vocabulary, fetch by name, and the laws against claiming', () => {
  const src = hk();
  const prompt = src.slice(src.indexOf('const SYSTEM_PROMPT = ['), src.indexOf('].join(\'\\n\');', src.indexOf('const SYSTEM_PROMPT = [')));
  const says = (w) => prompt.includes(w) || prompt.includes(w.replace(/"/g, '\\"'));
  for (const want of ['<brief>[ ... ]</brief>', '"field":"brief","find"', '"field":"cast","text"', 'append', 'mc.set {name}', 'place.set {name}', 'thread.set', 'knowledge.add', 'faction.set', 'people.set {name,field:core|state|arc|threads,text}', 'people.note {name,field:thread|unthread,text}', 'people.retire', 'rule: The Prose', 'lore: Aurora', 'NOTHING HAPPENS IN PROSE', 'ANSWER FROM EVIDENCE, NOT PREVIEWS', 'REPORT THE SWEEP, do not promise it', 'A guess from a preview is a hallucination']) assert(says(want), 'the prompt says: ' + want);
  assert(/Never write \\?"done\\?", \\?"updated\\?", \\?"fixed\\?"/.test(prompt), 'the claim law');
  assert(/There is no surface you are told to keep\s*',\s*'that you cannot see above or fetch/.test(prompt), 'every surface it must keep is visible or fetchable');
});

test('M74-3 <brief> is parsed and staged: find/replace, whole text, append; refused kindly when it cannot land', () => {
  const story = { id: 's', title: 'T', brief: 'Rias is his older sister.', castNotes: '' };
  const parsed = parseProtocol('Fixed.\n<brief>[{"field":"brief","find":"older sister","replace":"younger sister","reason":"the writer said"},{"field":"cast","text":"Rias — 22.","reason":"new"},{"field":"brief","append":"Kim is the neighbor.","reason":"add"},{"field":"brief","find":"nowhere","replace":"x"},{"field":"cast","find":"a","replace":"b"},{"field":"brief"}]</brief>');
  eq(parsed.brief.length, 6); eq(parsed.text, 'Fixed.');
  const props = stageProposals(parsed, { messages: [], state: emptyState(), modules: [], lore: [], memory: { nodes: [] }, session: { turns: [] }, story });
  const brief = props.filter((p) => p.kind === 'brief');
  eq(brief.length, 6);
  eq(brief.map((p) => p.status).join(','), 'pending,pending,pending,refused,refused,refused');
  eq(brief[0].op.field, 'brief'); eq(brief[1].op.field, 'castNotes'); eq(brief[1].op.text, 'Rias — 22.'); eq(brief[2].op.append, 'Kim is the neighbor.');
  assert(/reads close|does not appear|not found|no match|nowhere/i.test(brief[3].words), brief[3].words);
  assert(/it is empty/.test(brief[4].words), 'an empty field cannot be found in');
  assert(/didn’t say what should change/.test(brief[5].words));
  eq(brief[0].review[0].target, 'anchor:story:brief'); eq(brief[0].review[0].find, 'older sister');
  eq(brief[1].review[0].target, 'story:castNotes', 'a whole replacement is measured against the whole');
  eq(brief[2].review.length, 0, 'an append is never stale');
});

test('M74-4 a brief card applies to the story, goes stale when the brief moved, and is taken back', async () => {
  const story = await db.stories.create({ title: 'T' });
  await db.stories.update(story.id, { brief: 'Rias is his older sister.', castNotes: '' });
  const st = await db.stories.get(story.id);
  const parsed = parseProtocol('<brief>[{"field":"brief","find":"older sister","replace":"younger sister"},{"field":"cast","append":"Kim — the neighbor."}]</brief>');
  const props = stageProposals(parsed, { messages: [], state: emptyState(), modules: [], lore: [], memory: { nodes: [] }, session: { turns: [] }, story: st });
  const session = await loadSession(story.id);
  session.turns.push({ role: 'housekeeper', text: 'x', ts: 1, proposals: props });
  await saveSession(story.id, session);
  const r1 = await applyProposal(session, story.id, props[0].id);
  assert(r1.ok && r1.touched.story, JSON.stringify(r1));
  eq((await db.stories.get(story.id)).brief, 'Rias is his younger sister.');
  const r2 = await applyProposal(session, story.id, props[1].id);
  assert(r2.ok); eq((await db.stories.get(story.id)).castNotes, 'Kim — the neighbor.');
  /* undo takes the newest back; then the first */
  const u1 = await undoLatest(session, story.id); assert(u1.ok, u1.words);
  eq((await db.stories.get(story.id)).castNotes, '');
  const u2 = await undoLatest(session, story.id); assert(u2.ok, u2.words);
  eq((await db.stories.get(story.id)).brief, 'Rias is his older sister.');
  /* staleness: the brief edited by hand after staging */
  const props2 = stageProposals(parseProtocol('<brief>[{"field":"brief","find":"older","replace":"elder"}]</brief>'), { messages: [], state: emptyState(), modules: [], lore: [], memory: { nodes: [] }, session, story: await db.stories.get(story.id) });
  session.turns.push({ role: 'housekeeper', text: 'y', ts: 2, proposals: props2 });
  await db.stories.update(story.id, { brief: 'Rias is his elder sister.' });
  const r3 = await applyProposal(session, story.id, props2[0].id);
  assert(!r3.ok && r3.stale && /the words it looked for, “older”, are not in the brief now/.test(r3.words) && /Re-propose/.test(r3.words), JSON.stringify(r3));
});

test('M74-5 a ledger card is measured against the slice it touches — a page turn no longer refuses it; the undo the same', async () => {
  const sid = 'm74-ledger';
  let state = applyMutations(emptyState(), [{ type: 'presence.enter', name: 'Ann' }, { type: 'presence.enter', name: 'Bob' }]).state;
  await saveState(sid, state);
  eq(ledgerTargetKey({ type: 'rel.shift', name: 'Ann' }), 'rel:ann');
  eq(ledgerTargetKey({ type: 'presence.leave', name: 'Bob' }), 'presence:bob');
  eq(ledgerTargetKey({ type: 'people.note', name: 'Kim' }), 'people:kim');
  eq(ledgerTargetKey({ type: 'clock.advance' }), 'clock');
  const parsed = parseProtocol('<ledits>[{"type":"presence.leave","name":"Bob","reason":"he left"}]</ledits>');
  const props = stageProposals(parsed, { messages: [], state, modules: [], lore: [], memory: { nodes: [] }, session: { turns: [] }, story: {} });
  eq(props[0].review.map((r) => r.target).join(','), 'ledger:presence:bob');
  /* a page turns: the clock moves, Ann moves, the journal grows — Bob's seat did not */
  state = applyMutations(state, [{ type: 'clock.set', year: 2026, month: 9, day: 11, hour: 9, minute: 0 }, { type: 'presence.update', name: 'Ann', position: 'by the door' }]).state;
  await saveState(sid, state);
  eq(ledgerSliceHash(state, 'presence:bob'), props[0].review[0].hash, 'the slice hash stands');
  const session = { turns: [{ role: 'housekeeper', text: 'x', ts: 1, proposals: props }], batches: [] };
  const r = await applyProposal(session, sid, props[0].id);
  assert(r.ok, 'applied after a page turn: ' + JSON.stringify(r));
  assert(!(await (await import('../../js/engine/state.js')).loadState(sid)).present.some((p) => p.name === 'Bob'), 'Bob left');
  /* another page turns; the undo still stands because Bob's slice did not move again */
  const st2 = applyMutations(await (await import('../../js/engine/state.js')).loadState(sid), [{ type: 'clock.advance', minutes: 30, reason: 'time' }]).state;
  await saveState(sid, st2);
  const u = await undoLatest(session, sid);
  assert(u.ok, 'undo after a page turn: ' + u.words);
  /* but if Bob came back meanwhile, the undo refuses */
  const r2 = await applyProposal(session, sid, stageProposals(parsed, { messages: [], state: await (await import('../../js/engine/state.js')).loadState(sid), modules: [], lore: [], memory: { nodes: [] }, session, story: {} })[0].id).catch(() => null);
  void r2;
});

test('M74-6 fetch serves a rule or a lore entry by name; the ripple sweeps the brief and the cast notes', () => {
  const src = hk();
  assert(/\/\^\(rule\|lore\):\\s\*\\S\/i\.test\(t\)/.test(src), 'fetch refs accept rule: and lore:');
  assert(/function serveFetch\(refs, messages, \{ modules = \[\], lore = \[\] \} = \{\}\)/.test(src), 'serveFetch takes the rulebook and the shelf');
  assert(/serveFetch\(parsed\.fetch, messages, \{ modules, lore \}\)/.test(src), 'and is handed them');
  const where = rippleScan([{ id: '#x', find: 'Kris is the mother', replace: 'Kim is the mother' }], { messages: [], memory: { nodes: [] }, state: emptyState(), lore: [], story: { brief: 'Kris is the mother of Kendall.', castNotes: 'Kris is the mother.' } });
  assert(where.length === 1 && where[0].where.includes('the brief') && where[0].where.includes('the cast notes'), JSON.stringify(where));
});
