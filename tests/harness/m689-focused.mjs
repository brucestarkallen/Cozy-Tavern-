/* One focused milestone check; run directly without the bulk harness. */
import './idb-shim.mjs';
import assert from 'node:assert/strict';
import { db } from '../../js/store.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { auditLedger, standingsHousekeeping } from '../../js/agents/auditor.js';
import { extractTurn } from '../../js/agents/extractor.js';
import { buildScribeMessages } from '../../js/agents/scribe.js';
import { foundWorld } from '../../js/agents/founder.js';
import { ledgerRepairInputKey } from '../../js/agents/auditprogress.js';
const connection = { type: 'openai', baseUrl: 'https://fixture.example/v1', apiKey: 'fixture', model: 'm', preset: 'custom', context: 64000 };
const quote = "In the third row, Alexia's hooked ankle settled. She leaned forward with gloves beneath her chin.";
const page = '[palace salle | 10:00]\n' + quote + '\nJugram continued the bout in the salle.';
const brief = 'Princess Alexia: P:60 R:50 S:0 toward Jugram.';
const { id } = await db.stories.create({ title: 'M689 disposable milestone', brief });
await db.messages.append(id, { role: 'user', text: 'I continue.', ts: 1 });
await db.messages.append(id, { role: 'assistant', text: page, ts: 2 });
const baseline = applyMutations({ ...emptyState(), page: 0 }, [
  { type: 'mc.set', name: 'Jugram' }, { type: 'place.set', name: 'palace salle' },
  { type: 'presence.enter', name: 'Jugram' },
  { type: 'people.set', name: 'Princess Alexia', field: 'core', text: 'Princess of the realm, a proud observer.' },
  { type: 'rel.set', name: 'Princess Alexia', p: 40, r: 30, s: 0, cause: 'the founder stated her bond' },
]).state;
await saveState(id, baseline);
let reply;
const oldFetch = globalThis.fetch;
globalThis.fetch = async (_, options) => {
  const b = JSON.parse(options.body);
  const text = JSON.stringify(b.messages.some(m => String(m.content).includes('Find every place the writer STATES'))
    ? { standings: [{ name: 'Princess Alexia', p: 60, r: 50, s: 0 }] } : reply);
  return new Response(b.stream
    ? 'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n'
    : JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }),
    { headers: { 'Content-Type': b.stream ? 'text/event-stream' : 'application/json' } });
};
try {
  reply = { mutations: [{ type: 'mode.snapshot', flags: ['combat'] }], here: [{ name: 'Jugram' }, { name: 'Princess Alexia', at: 'leaning forward in the third row', shown: quote }] };
  const scene = await extractTurn({ connection, storyId: id, state: baseline, userText: 'I continue.', assistantText: page, brief });
  const sceneState = applyMutations(baseline, scene.mutations).state;
  assert(sceneState.present.some(p => p.name === 'Princess Alexia' && p.position === 'leaning forward in the third row'));
  console.log('PASS Scene saves the supported spectator and posture.');
  reply = { issues: [{ what: 'Alexia is missing despite the gallery passage.', fix: 'Restore her presence.', shown: quote, mutations: [{ type: 'presence.enter', name: 'Princess Alexia', position: 'leaning forward in the third row' }] }] };
  const result = await auditLedger({ connection, storyId: id, brief });
  const repaired = await loadState(id);
  assert(repaired.present.some(p => p.name === 'Princess Alexia'));
  assert.equal(result.unfinished, false);
  assert.equal(repaired.relationships['Princess Alexia'].p, 60);
  assert.equal(repaired.relationships['Princess Alexia'].r, 50);
  assert.equal((await db.messages.list(id)).find(m => m.role === 'assistant').text, page);
  console.log('PASS Auditor saves the repair and explicit starting values, closes the finding, preserves prose.');
  const earned = applyMutations(repaired, [{ type: 'rel.shift', name: 'Princess Alexia', axis: 'p', delta: 3, cause: 'Jugram kept her confidence' }]).state;
  const preserved = applyMutations(earned, standingsHousekeeping(earned, brief, '', 'Jugram', [{ name: 'Princess Alexia', p: 60, r: 50 }])).state;
  assert.equal(preserved.relationships['Princess Alexia'].p, earned.relationships['Princess Alexia'].p);
  const hand = applyMutations(repaired, [{ type: 'rel.set', name: 'Princess Alexia', p: 17, cause: 'writer override', byHand: true }]).state;
  assert(!standingsHousekeeping(hand, brief, '', 'Jugram', [{ name: 'Princess Alexia', p: 60 }]).some(m => m.type === 'rel.set'));
  console.log('PASS Earned scores and explicit manual values remain intact.');
  const story = await db.stories.get(id), pages = await db.messages.list(id);
  const key = ledgerRepairInputKey(repaired, story, pages);
  assert.equal(key, ledgerRepairInputKey({ ...repaired, audit: { pausedInput: key }, log: [], journal: [], turn: 999 }, story, pages));
  assert.notEqual(key, ledgerRepairInputKey(earned, story, pages));
  assert.notEqual(key, ledgerRepairInputKey(repaired, { ...story, brief: 'changed evidence' }, pages));
  const prompt = buildScribeMessages({ state: repaired, userText: '', assistantText: page, record: 'EARLIER HISTORY', pages: [{ role: 'assistant', text: 'PRIOR PROMISE', number: 1 }] });
  assert(prompt.user.includes('EARLIER HISTORY') && prompt.user.includes('PRIOR PROMISE') && prompt.system.includes('YOU CAN LOOK'));
  console.log('PASS Retry fingerprint tracks real changes; People receives history and lookup.');
  const freshId = (await db.stories.create({ title: 'M689 founder', brief })).id;
  await saveState(freshId, applyMutations(emptyState(), [{ type: 'mc.set', name: 'Jugram' }]).state);
  reply = { mutations: [{ type: 'rel.set', name: 'Princess Alexia', p: 40, r: 30, s: 0, cause: 'the brief gives her a bond toward Jugram' }] };
  await foundWorld({ connection, storyId: freshId, brief });
  const founded = await loadState(freshId);
  assert.equal(founded.relationships['Princess Alexia'].p, 60);
  assert.equal(founded.relationships['Princess Alexia'].r, 50);
  console.log('PASS Founder respects explicit digits over its own initial estimate.');
} finally { globalThis.fetch = oldFetch; }
