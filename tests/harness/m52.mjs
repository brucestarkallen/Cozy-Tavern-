/* M52 — the gradual rebuilder: six pages at a time from turn 0, the record-so-far as context, never the whole story at once. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { rebuildRecord, rebuildPeople, restoreRecord, restorePeople, buildReaderMessages, parseReaderAnswer, rebuildPeopleWords } from '../../js/agents/rebuild.js';
import { loadMemory, saveMemory } from '../../js/agents/memory.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { db } from '../../js/store.js';
import { thinkingHouse, withHouse, HOUSES } from './thinkinghouse.mjs';

test('M52-1 the record is re-folded from the first page, batch by batch, and the old one can be put back', async () => {
  const storyId = 'm52-record';
  for (let i = 0; i < 48; i += 1) await db.messages.append(storyId, { role: i % 2 ? 'assistant' : 'user', text: 'page ' + i });
  await db.settings.set('memoryKeeper', true); await db.settings.set('memoryWindow', 30); await db.settings.set('memoryBatch', 6);
  await saveMemory(storyId, { window: 30, nodes: [{ id: 'bad', span: [0, 5], text: 'a bad old line', level: 1, at: 0 }] });
  const seen = [];
  const house = { fetch: async (url, opts) => {
    const body = JSON.parse(opts.body); const user = body.messages[body.messages.length - 1].content;
    let answer = 'NONE';
    if (/Write ONE line recording/.test(user)) { const m = user.match(/PLAYER \(the player\): page (\d+)/); seen.push(m ? Number(m[1]) : -1); answer = 'line from ' + (m ? m[1] : '?'); }
    const h = thinkingHouse({ answer }); return h.fetch(url, opts);
  } };
  const progress = [];
  const r = await withHouse(house, () => rebuildRecord({ connection: HOUSES[0].conn, storyId, onProgress: (p) => progress.push(p.folded) }));
  eq(seen.join(','), '0,6,12', 'the pages were read six at a time from the first');
  const mem = await loadMemory(storyId);
  eq(mem.nodes.length, 3); assert(!mem.nodes.some((n) => n.text === 'a bad old line'), 'the bad line is gone');
  eq(r.folded, 18); eq(r.toFold, 18);
  assert(progress.length >= 1);
  await restoreRecord(storyId);
  eq((await loadMemory(storyId)).nodes[0].text, 'a bad old line', 'the old record can be put back');
});

test('M52-2 the people are re-read six pages at a time with the record-so-far; digits are the origin; only toward the MC; restorable', async () => {
  const storyId = 'm52-people';
  let s = emptyState(); s.sheet.playerName = 'Jovan';
  s.characters = { Old: { core: 'stale' } };
  await saveState(storyId, s);
  for (let i = 0; i < 14; i += 1) await db.messages.append(storyId, { role: i % 2 ? 'assistant' : 'user', text: (i % 2 ? 'STORY ' : 'PLAYER ') + 'page ' + i });
  await saveMemory(storyId, { window: 30, nodes: [{ id: 'n0', span: [0, 5], text: '[Day 1] Rias hugged Jovan on the porch', level: 1, at: 0 }] });
  const contexts = [];
  const house = { fetch: async (url, opts) => {
    const body = JSON.parse(opts.body); const user = body.messages[body.messages.length - 1].content;
    contexts.push(user);
    const first = /PLAYER page 0/.test(user);
    const answer = JSON.stringify({ deltas: [{ name: 'Rias', field: 'state', text: first ? 'at the door' : 'in the kitchen' }, { name: 'Jovan', field: 'core', text: 'should be refused' }], shifts: first ? [{ name: 'Rias', axis: 'p', delta: 5, cause: 'she hugged him' }, { name: 'Jovan', axis: 'p', delta: 9, cause: 'no' }] : [] });
    const h = thinkingHouse({ answer }); return h.fetch(url, opts);
  } };
  const r = await withHouse(house, () => rebuildPeople({ connection: HOUSES[0].conn, storyId, brief: 'Rias Wells — sister (P:85 R:65 S:45)', stale: () => false }));
  const batches = contexts.filter((c) => /THE NEXT PAGES:/.test(c)); /* M58: one more call reads the brief's digits */
  eq(batches.length, 3, 'fourteen pages, three batches');
  assert(/THE RECORD SO FAR[\s\S]*first pages/.test(batches[0]), 'the first batch has no record before it');
  assert(/Rias hugged Jovan on the porch/.test(batches[1]), 'the second batch sees the record covering the pages before it');
  assert(/THE STANDINGS AS THEY STAND[\s\S]*Rias/.test(batches[1]), 'and the standings so far');
  const st = await loadState(storyId);
  assert(!st.characters.Old, 'the stale page is gone');
  const riasKey = Object.keys(st.characters).find((k) => /^Rias/.test(k));
  eq(st.characters[riasKey].state, 'in the kitchen', 'the last batch’s state stands, on the person the ledger knows (' + riasKey + ')');
  assert(!st.characters.Jovan, 'the MC gets no page');
  eq(st.relationships['Rias Wells'].p, 90, 'the digits are the origin (85) and the page moved her +5 — on the same person');
  assert(!st.relationships.Rias, 'no second entry for the same person');
  assert(!st.relationships.Jovan, 'no standing for the MC');
  assert(/read 14 of 14 pages six at a time/.test(rebuildPeopleWords(r)), rebuildPeopleWords(r));
  await restorePeople(storyId);
  assert((await loadState(storyId)).characters.Old, 'the old pages can be put back');
});

test('M52-3 the reader’s answers and the house wiring', () => {
  const a = parseReaderAnswer('```json\n{"deltas":[{"name":"R","field":"arc","text":"x"}],"shifts":[{"name":"R","axis":"r","delta":"4","cause":"c"},{"name":"R","axis":"q","delta":1,"cause":"c"}]}\n```');
  eq(a.deltas.length, 1); eq(a.shifts.length, 1);
  const p = buildReaderMessages({ state: emptyState(), record: '', pages: [{ role: 'user', text: 'u' }], mc: 'Jovan' });
  assert(/six pages at a time/.test(p.system) && /THE NEXT PAGES:/.test(p.user));
  const chat = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  assert(/async function rebuildRecordNow\(\)/.test(chat) && /async function rebuildPeopleNow\(\)/.test(chat) && /restoreRecordNow,/.test(chat));
  const drawer = readFileSync(new URL('../../js/ui/drawer.js', import.meta.url), 'utf8');
  assert(/Rebuild the record from the pages/.test(drawer) && /Rebuild the people from the pages/.test(drawer) && /Put the old record back/.test(drawer));
});
