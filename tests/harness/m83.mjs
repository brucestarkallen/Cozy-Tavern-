/* M83 — Chat Assistant's list, held whole: the prompt teaches every block
 * (the <edits> teaching had vanished in M79's slice); a ledger undo is
 * node-scoped and refusal-first; a whole-page rewrite; STALE marks on every
 * anchor kind; the ripple reaches the people's threads; the stall watchdog;
 * the reply lands in the session that asked; the absence and deliberation laws. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { db } from '../../js/store.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { parseProtocol, stageProposals, applyProposal, undoLatest, buildHousekeeperContext, rippleScan, undoJournalEntries } from '../../js/agents/housekeeper.js';

const promptOf = () => { const src = readFileSync(new URL('../../js/agents/housekeeper.js', import.meta.url), 'utf8'); return src.slice(src.indexOf('const SYSTEM_PROMPT = ['), src.indexOf("].join('\\n');", src.indexOf('const SYSTEM_PROMPT = ['))); };

test('M83-1 THE PROMPT TEACHES EVERY BLOCK — a guard, because M79’s slice silently removed the <edits> teaching', () => {
  const p = promptOf();
  for (const block of ['<brief>[ ... ]</brief>', '<edits>[ ... ]</edits>', '<ledits>[ ... ]</ledits>', '<redits>[ ... ]</redits>', '<record>[ ... ]</record>', '<lore>[ ... ]</lore>', '<fetch>[', '<supersede>']) assert(p.includes(block), 'the prompt teaches ' + block);
  for (const w of ['"hide":true', 'bulk_replace', 'no find: the whole page is re-inked', 'ABSENCE IS A CLAIM YOU MUST EARN', 'A page folded away is READABLE by fetch', 'DELIBERATE EFFICIENTLY']) assert(p.includes(w), 'the prompt says: ' + w);
});

test('M83-2 a ledger undo takes back exactly what the card wrote (refusal-first, journaled) — a later page’s writes stand', async () => {
  const sid = 'm83-ledger';
  await saveState(sid, applyMutations(emptyState(), [{ type: 'presence.enter', name: 'Ann' }]).state);
  const props = stageProposals(parseProtocol('<ledits>[{"type":"presence.enter","name":"Bob","reason":"x"},{"type":"place.set","name":"the hall","reason":"x"}]</ledits>'), { messages: [], state: await loadState(sid), modules: [], lore: [], memory: { nodes: [] }, session: { turns: [] }, story: {} });
  const session = { turns: [{ role: 'housekeeper', text: 'x', ts: 1, proposals: props }], batches: [] };
  const r = await applyProposal(session, sid, props[0].id);
  assert(r.ok, r.words);
  eq(session.batches[0].items[0].jids.length, 2, 'two journal ids on the batch');
  /* a later page writes elsewhere: Cal enters, the clock moves */
  await saveState(sid, applyMutations(await loadState(sid), [{ type: 'presence.enter', name: 'Cal' }, { type: 'clock.set', year: 2026, month: 9, day: 11, hour: 9, minute: 0 }]).state);
  const u = await undoLatest(session, sid);
  assert(u.ok, 'undo after a later page: ' + u.words);
  const st = await loadState(sid);
  eq(st.present.map((p) => p.name).sort().join(','), 'Ann,Cal', 'Bob went; Cal (later) stands; the old whole-state restore would have wiped Cal');
  eq(st.place, null, 'the hall went');
  assert(st.clock && st.clock.minutes, 'the later clock stands');
  assert(st.journal.filter((e) => e.m.type === 'undo.apply').length === 2, 'the take-backs ride the journal');
  /* refusal-first: a later change to the same thing refuses the whole undo, nothing touched */
  const props2 = stageProposals(parseProtocol('<ledits>[{"type":"presence.enter","name":"Dee","reason":"x"}]</ledits>'), { messages: [], state: await loadState(sid), modules: [], lore: [], memory: { nodes: [] }, session, story: {} });
  session.turns.push({ role: 'housekeeper', text: 'y', ts: 2, proposals: props2 });
  assert((await applyProposal(session, sid, props2[0].id)).ok);
  await saveState(sid, applyMutations(await loadState(sid), [{ type: 'presence.update', name: 'Dee', position: 'by the door' }]).state);
  const u2 = await undoLatest(session, sid);
  assert(!u2.ok && u2.refused && /a later change touched the same thing/.test(u2.words), u2.words);
  assert((await loadState(sid)).present.some((p) => p.name === 'Dee' && p.position === 'by the door'), 'nothing was touched');
  eq(undoJournalEntries(await loadState(sid), [999999]).state.present.length, 3, 'an unknown id is skipped');
});

test('M83-3 a whole-page rewrite (no find) stages, shows, applies and undoes; STALE marks on every anchor kind; the ripple reaches threads', async () => {
  const story = await db.stories.create({ title: 'Whole' });
  const m = await db.messages.append(story.id, { role: 'assistant', text: 'Kim sat by the window.' });
  const messages = await db.messages.list(story.id);
  const ref = '#' + m.id.slice(0, 6);
  const props = stageProposals(parseProtocol('<edits>[{"id":"' + ref + '","replace":"Kim stood by the door, listening.","reason":"a rewrite"}]</edits>'), { messages, state: emptyState(), modules: [], lore: [], memory: { nodes: [] }, session: { turns: [] }, story });
  eq(props.length, 1); eq(props[0].status, 'pending'); assert(props[0].op.whole && props[0].op.before === 'Kim sat by the window.');
  const session = { turns: [{ role: 'housekeeper', text: 'x', ts: 1, proposals: props }], batches: [] };
  const r = await applyProposal(session, story.id, props[0].id);
  assert(r.ok && /re-inked whole/.test(r.words), r.words);
  eq((await db.messages.list(story.id))[0].text, 'Kim stood by the door, listening.');
  const u = await undoLatest(session, story.id); assert(u.ok, u.words);
  eq((await db.messages.list(story.id))[0].text, 'Kim sat by the window.');
  /* STALE marks: a brief card whose anchor died is marked in the pending list */
  const st = { title: 'T', brief: 'Alexia (15), the eldest', castNotes: '' };
  const bp = stageProposals(parseProtocol('<brief>[{"field":"brief","find":"Alexia (15)","replace":"Alexia (16)","reason":"a"}]</brief>'), { messages: [], state: emptyState(), modules: [], lore: [], memory: { nodes: [] }, session: { turns: [] }, story: st });
  const sess = { turns: [{ role: 'housekeeper', text: 'x', ts: 1, proposals: bp }], batches: [] };
  const ctx = buildHousekeeperContext({ story: { ...st, brief: 'Alexia (16), the eldest' }, messages: [], state: emptyState(), modules: [], lore: [], memory: { nodes: [] }, session: sess, contextPages: 8 });
  assert(/“the brief”.*⚠ STALE — its anchor no longer matches/.test(ctx), 'the brief card is marked stale in the pending list: ' + ctx.slice(ctx.indexOf('PENDING CARDS'), ctx.indexOf('PENDING CARDS') + 200));
  /* the ripple reaches a person's threads */
  const state = applyMutations(emptyState(), [{ type: 'people.note', name: 'Ann', field: 'thread', text: 'owes the ferryman' }]).state;
  const where = rippleScan([{ id: ref, find: 'owes the ferryman', replace: 'owes the boatman' }], { messages: [], memory: { nodes: [] }, state, lore: [], story: {} });
  assert(where.length === 1 && where[0].where.includes('the page of Ann'), JSON.stringify(where));
});

test('M83-4 the stall watchdog and the session-that-asked law are wired in the UI; the whole-page card draws its diff', () => {
  const ui = readFileSync(new URL('../../js/ui/housekeeper.js', import.meta.url), 'utf8');
  assert(/hkStallSec/.test(ui) && /workerCtl\.abort\(\)/.test(ui) && /lastBeat = Date\.now\(\);/.test(ui) && /went silent for/.test(ui), 'the watchdog');
  assert(/sessionStoryId !== story\.id \|\|/.test(ui) && /answered in the session that asked/.test(ui), 'a reply for another story or session is not drawn here');
  assert(/The whole page, re-inked:/.test(ui), 'the whole-page card');
});
