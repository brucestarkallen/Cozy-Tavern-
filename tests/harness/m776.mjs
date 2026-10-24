/* Cozy Tavern — harness laws of M776, the auditor. His (24 October 2026), with his debug report: "Why it's still like this
 * wtf is this the auditor ran 2 minutes ago has unresolved findings; repeated attempts are paused … presence:Emilia
 * Vermaine: the auditor did not approve this entry; characters:Emilia Vermaine: the auditor did not approve this entry".
 * The reading before had proposed adding to Emilia's nature — a field his own hand wrote — refused "the writer explicitly
 * controls this field" and kept OWED; the final review, handed a repair no write can make, answered twice without a
 * verdict (284 characters) and the audit paused. Each law runs the real auditLedger against a scripted house and reads the
 * ledger back; each fails on m775-001. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const CORE = 'Higher Vampire of the Vermaine family; ancient, proprietary. Jovan Wessex is the only vampire she has ever made.';
const PAGE = '[The Vermaine manor, the long hall — Sunday, October 13, 2024 | 01:12 | fire and candlelight | black field kit | at the table]\n\n'
  + 'Emilia Vermaine stood at the table and watched the color come back into him, a maker watching her own blood finish its work in another body.\n\n'
  + '"First meals," she said.';
const ADD_MAKER = { what: 'The ledger’s character page for Emilia Vermaine is missing the fact that she is a maker watching her own blood finish its work', fix: 'add it',
  pages: false, mutations: [{ type: 'people.note', name: 'Emilia Vermaine', field: 'core', text: 'a maker watching her own blood finish its work in another body', shown: 'a maker watching her own blood finish its work in another body' }] };
async function seed(storyId, extra = {}) {
  const st = applyMutations({ ...emptyState(), page: 0, sheet: { actors: {}, playerName: 'Jovan Wessex' } }, [
    { type: 'mc.set', name: 'Jovan Wessex' }, { type: 'place.set', name: 'The Vermaine manor, the long hall' },
    { type: 'presence.enter', name: 'Jovan Wessex' }, { type: 'presence.enter', name: 'Emilia Vermaine', position: 'standing at the table' },
    { type: 'people.set', name: 'Emilia Vermaine', field: 'core', text: CORE, byHand: true }]).state;
  await saveState(storyId, { ...st, readTo: 1, ...extra });
  await db.messages.append(storyId, { role: 'user', text: 'I drink.' });
  await db.messages.append(storyId, { role: 'assistant', text: PAGE });
}
/* as m679's auditorHouse: streamed when the request streams */
const say = (text, stream) => {
  if (stream) {
    const lines = 'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n' + 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n' + 'data: [DONE]\n\n';
    const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(lines)); c.close(); } });
    return { ok: true, status: 200, headers: new Headers(), body, async json() { return {}; }, async text() { return lines; }, clone() { return this; } };
  }
  const obj = { choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }] };
  return { ok: true, status: 200, headers: new Headers(), async json() { return obj; }, async text() { return JSON.stringify(obj); }, clone() { return this; } };
};
const COMPLETE = { scene: [], issues: [], review: { status: 'complete', why: 'every entry read against the newest page, to its end', open: [] }, standings: [] };
/* a house: the auditor's reading answers `first`; its final review answers each of `finals` in turn (the last repeats) */
function house(first, finals) {
  const calls = []; let n = 0;
  return { calls, fetch: async (url, opts) => {
    const body = JSON.parse(opts.body); calls.push(body);
    const sys = String(((body.messages || [])[0] || {}).content || '');
    if (!/auditor of the ledger/i.test(sys)) return say('{"standings":[],"mutations":[],"people":[]}', body.stream);
    const words = body.messages.map((m) => String(m.content || '')).join('\n');
    if (!/FINAL REVIEW CONTRACT/.test(words)) return say(JSON.stringify(first), body.stream);
    const answer = finals[Math.min(n++, finals.length - 1)];
    return say(typeof answer === 'string' ? answer : JSON.stringify(answer), body.stream);
  } };
}
const reviewCalls = (h) => h.calls.filter((b) => b.messages.some((m) => /FINAL REVIEW CONTRACT/.test(String(m.content || ''))));

test('M776-1 A REPAIR TO A FIELD HIS HAND WROTE SETTLES ITS FINDING BY HIS WORDS: Emilia’s nature stands as he wrote it, the run says so, and nothing is kept owed to hold her entries', async () => {
  const { auditLedger } = await import('../../js/agents/auditor.js');
  const { withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const id = 'm776-1-emilia';
  await seed(id);
  const h = house({ ...COMPLETE, issues: [ADD_MAKER] }, [{ ...COMPLETE, issues: [ADD_MAKER] }]);
  const r = await withHouse(h, () => auditLedger({ connection: HOUSES[0].conn, storyId: id, stale: () => false }));
  assert(r && r.note === 'ok', 'read: ' + JSON.stringify(r && r.note));
  const after = await loadState(id);
  eq(after.characters['Emilia Vermaine'].core, CORE, 'his words stand');
  eq(r.leftWriter, 1, 'counted as left as he wrote it');
  assert(!r.issues.some((i) => /maker watching/.test(i.what)), 'no finding owed: ' + JSON.stringify(r.issues.map((i) => i.what)));
  assert(!(after.audit?.unresolved || []).some((f) => /maker watching/.test(f.what)), 'nothing saved owed: ' + JSON.stringify(after.audit?.unresolved));
});

test('M776-2 A FINDING SAVED OWED BEFORE, ONLY BECAUSE HIS HAND HOLDS ITS FIELD, IS NEVER HANDED TO THE REVIEW AGAIN', async () => {
  const { auditLedger, WRITER_OWNS } = await import('../../js/agents/auditor.js');
  const { withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const id = 'm776-2-emilia';
  const owed = { what: ADD_MAKER.what, fix: ADD_MAKER.fix, pages: false, pendingReason: WRITER_OWNS, mutations: ADD_MAKER.mutations };
  await seed(id, { audit: { unresolved: [owed], pending: [owed.what + ': ' + WRITER_OWNS] } });
  const h = house(COMPLETE, [COMPLETE]);
  const r = await withHouse(h, () => auditLedger({ connection: HOUSES[0].conn, storyId: id, stale: () => false }));
  assert(r && r.note === 'ok', 'read');
  const sent = reviewCalls(h).map((b) => b.messages.map((m) => String(m.content || '')).join('\n')).join('\n');
  const at = sent.indexOf('missing the fact that she is a maker');
  assert(sent && at === -1, 'the review is not handed it: …' + sent.slice(Math.max(0, at - 400), at + 100));
  assert(!((await loadState(id)).audit?.unresolved || []).some((f) => /maker watching/.test(f.what)), 'and it is not kept');
});

test('M776-3 A FINAL REVIEW THAT ANSWERS WITHOUT A VERDICT IS TOLD EXACTLY WHAT IS MISSING, WITH THE IDS IT MUST USE — and the reply is kept for his report', async () => {
  const { auditLedger, finalReviewDefects, parseAuditorAnswer } = await import('../../js/agents/auditor.js');
  const { withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const { id } = await db.stories.create({ title: 'M776-3' }); /* a story his report can open */
  await seed(id);
  const NO_VERDICT = '{"scene":[{"name":"Emilia Vermaine","repair":false}],"issues":[],"standings":[]}';
  const h = house(COMPLETE, [NO_VERDICT, COMPLETE]);
  const r = await withHouse(h, () => auditLedger({ connection: HOUSES[0].conn, storyId: id, stale: () => false }));
  assert(r && r.note === 'ok', 'read');
  const calls = reviewCalls(h);
  assert(calls.length >= 2, 'asked again: ' + calls.length);
  const again = String(calls[1].messages.at(-1).content || '');
  assert(/there is no review object and no verdict for/.test(again) && /presence:Emilia Vermaine/.test(again), 'the exact defect and its ids: ' + again.slice(0, 600));
  const st = await loadState(id);
  assert(/"scene":\[\{"name":"Emilia Vermaine"/.test(String(st.audit?.finalReview?.reply || '')), 'the reply kept: ' + JSON.stringify(st.audit?.finalReview));
  const { ledgerDebugReport } = await import('../../js/ui/ledgerdebug.js');
  const report = await ledgerDebugReport(id);
  const line = report.slice(report.indexOf('Latest final review reply'));
  assert(/^Latest final review reply\n[^\n]*Emilia Vermaine/.test(line), 'his report carries it: ' + line.slice(0, 300));
  const rows = [{ id: 'characters:Emilia Vermaine' }];
  const foreign = finalReviewDefects(parseAuditorAnswer('{"review":{"status":"open","why":"x","open":[{"id":"canon:Emilia Vermaine","why":"skin"}]}}'), '', rows);
  assert(foreign.some((d) => /canon:Emilia Vermaine.*not entries of this reading.*characters:Emilia Vermaine.*decided under their characters: entry/.test(d)), JSON.stringify(foreign));
});

test('M776-4 THE SAME FAULT, EVERY THING THAT IS HIS: a repair to the main character’s own arc (“the player arc belongs to the writer”) is left as he wrote it too, never owed', async () => {
  const { auditLedger } = await import('../../js/agents/auditor.js');
  const { withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const id = 'm776-4-arc';
  await seed(id);
  const ARC = { what: 'Jovan Wessex’s arc does not say he has been turned', fix: 'write it', pages: false,
    mutations: [{ type: 'people.set', name: 'Jovan Wessex', field: 'arc', text: 'a hunter turned by the thing he hunted', shown: 'watched the color come back into him' }] };
  const h = house({ ...COMPLETE, issues: [ARC] }, [{ ...COMPLETE, issues: [ARC] }]);
  const r = await withHouse(h, () => auditLedger({ connection: HOUSES[0].conn, storyId: id, stale: () => false }));
  assert(r && r.note === 'ok', 'read');
  eq(r.leftWriter, 1, 'left as he wrote it');
  assert(!((await loadState(id)).audit?.unresolved || []).some((f) => /arc does not say/.test(f.what)), 'never owed');
});
