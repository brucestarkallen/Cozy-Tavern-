/* Cozy Tavern — a child process of tests/harness/m752-record.mjs (law M752-R8), never a law by itself.
 * The Housekeeper's spelling correction and its take-back are one atomic story edit each (store.js editStoryAtomically). The
 * harness's own IndexedDB stand-in (idb-shim.mjs) ends a transaction before its requests answer, so such an edit cannot run
 * in the harness process: this runs the real modules over fake-indexeddb (as tests/harness/m745-source-repair.mjs does) and
 * prints what came back, as one line of JSON, for the law to hold. */
import { createRequire } from 'node:module';
createRequire(new URL('../../dom/package.json', import.meta.url))('fake-indexeddb/auto');
const { db, dropCaches } = await import('../../../js/store.js');
const { emptyState, saveState } = await import('../../../js/engine/state.js');
const { sourceBindings, sourceBindingIssues, boundRecord } = await import('../../../js/assemble/selection.js');
const { loadMemory, saveMemory } = await import('../../../js/agents/memory.js');
const hk = await import('../../../js/agents/housekeeper.js');

const story = await db.stories.create({ title: 'A spelling correction under the record' });
const id = story.id;
await db.stories.update(id, { brief: 'Jovn trains with Rukia.' });
const state = emptyState();
state.characters = { Jovn: { core: 'Jovn is a recruit of the Thirteenth.' }, Rukia: { core: 'Rukia is his officer.' } };
await saveState(id, state);
for (let i = 0; i < 24; i += 1) {
  await db.messages.append(id, { id: 'p' + i, role: i % 2 ? 'assistant' : 'user', ts: 1000 + i,
    text: i % 2 ? '[Yard — Monday | 09:' + String(10 + i).padStart(2, '0') + '] Jovn drills with Rukia, page ' + i + '.' : 'Jovn asks Rukia about the drill, page ' + i + '.' });
}
const visible = async () => (await db.messages.list(id)).filter((m) => !m.hidden);
let pages = await visible();
const nodes = [0, 1, 2].map((k) => ({ id: 'L' + k, span: [k * 6, k * 6 + 5], level: 1, at: 1000 + k, whole: true,
  text: 'Jovn trained with Rukia; line ' + k, detail: 'what lasts ' + k, audited: 6, correctionReviewed: true, sourcePages: sourceBindings(pages.slice(k * 6, k * 6 + 6)) }));
await saveMemory(id, { window: 10, nodes });
const look = async () => {
  dropCaches();
  const mem = await loadMemory(id), now = await visible();
  return { issues: sourceBindingIssues(mem.nodes, now).map((i) => [i.id, i.kind]), bound: mem.nodes.filter((n) => boundRecord(n, now)).map((n) => n.id),
    texts: mem.nodes.map((n) => n.text), audited: mem.nodes.map((n) => n.audited ?? null) };
};
const out = { before: await look() };
const answer = await hk.housekeeperTurn({ storyId: id, writerText: 'Change Jovn to Jovan everywhere.',
  call: async () => ({ text: 'Proposed correction. <corrections>[{"type":"name.spelling","from":"Jovn","to":"Jovan","scope":"story","reason":"writer requested spelling correction"}]</corrections>' }) });
if (!answer.ok) throw new Error('the housekeeper did not answer: ' + answer.error);
const applied = await hk.applyAllPending(answer.session, id);
out.applied = { applied: applied.applied, words: applied.words };
out.afterApply = await look();
pages = await visible();
out.pageText = pages[1].text;
/* a line folded after the correction, from the corrected words (as the keeper writes it) */
const mem = await loadMemory(id);
mem.nodes.push({ id: 'L3', span: [18, 23], level: 1, at: 2000, whole: true, text: 'Jovan kept drilling; line 3', sourcePages: sourceBindings(pages.slice(18, 24)) });
await saveMemory(id, mem);
out.withLater = await look();
const undone = await hk.undoLatest(answer.session, id);
out.undo = { ok: undone.ok, words: undone.words };
out.afterUndo = await look();
out.pageTextAfterUndo = (await visible())[1].text;
console.log(JSON.stringify(out));
