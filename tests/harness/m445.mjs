/* M445: one home for a canon fact — the canon tidy, handed the story's own words, can take the series out of his pages at
 * last (his real Rukia and Kyōraku cores were refused even for a right answer, and a refusal was never looked at again).
 * Runs the real tidy on a scripted worker. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { HOUSES, withHouse } from './thinkinghouse.mjs';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';

const streamed = (answer) => async (url, opts) => {
  const body = JSON.parse(opts.body);
  const lines = 'data: ' + JSON.stringify({ choices: [{ delta: { content: answer } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n';
  if (body.stream) return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(lines)); c.close(); } }), json: async () => ({}), text: async () => lines, clone() { return this; } };
  const obj = { choices: [{ message: { role: 'assistant', content: answer }, finish_reason: 'stop' }] };
  return { ok: true, status: 200, headers: new Headers(), json: async () => obj, text: async () => JSON.stringify(obj), clone() { return this; } };
};

test('M445-1 THE CANON TIDY CAN CLEAN HIS PAGES AT LAST — canon’s own details the record’s summary leaves out may go, what his story says of them stays; a refusal is looked at again (three times), and an old refusal no longer blocks it', async () => {
  const { cleanCoreHolds, canonRepeats, canonTidyPeople } = await import('../../js/agents/canontidy.js');
  const BRIEF = 'A Bleach story after the war. Jovan Oda is the new captain of the 13th Division; Rukia Kuchiki is his lieutenant — she had expected the captaincy herself.';
  const RUKIA = { name: 'Rukia Kuchiki', found: true, kind: 'character', aliases: ['Rukia'], rel: {}, ts: Date.now(),
    sections: { identity: 'Rukia Kuchiki is a Shinigami, lieutenant of the 13th Division.', physical: 'hair: black; eyes: violet', look: 'A petite young woman with black hair and large violet eyes.' },
    dossier: { identity: 'Lieutenant of the 13th Division, adopted sister of Byakuya Kuchiki', brief: 'A proud noble of the Kuchiki clan.', facts: ['Her Zanpakutō is Sode no Shirayuki.'], abilities: ['Sode no Shirayuki'] } };
  const CORE = 'Lieutenant of the 13th Division, 150+; petite, slender, black hair, large violet eyes, standard shihakushō with the lieutenant’s badge; a proud Kuchiki noble, Byakuya’s adopted sister; wields Sode no Shirayuki; expected the captaincy and was passed over for Oda.';
  const CLEAN = 'Lieutenant of the 13th Division; expected the captaincy and was passed over for Oda.';
  eq(cleanCoreHolds(CORE, CLEAN, RUKIA, 'Rukia Kuchiki').ok, false, 'the old law: canon details the summary leaves out counted as the story, so even this was refused');
  eq(cleanCoreHolds(CORE, CLEAN, RUKIA, 'Rukia Kuchiki', BRIEF).ok, true, 'with the story’s own words: the series out, the story kept');
  const lost = cleanCoreHolds(CORE, 'Lieutenant of the 13th Division.', RUKIA, 'Rukia Kuchiki', BRIEF);
  assert(!lost.ok && /captaincy|expected|oda/.test(lost.why), 'what his story says of her is still never lost: ' + lost.why);
  eq(cleanCoreHolds(CORE, CLEAN + ' She secretly loves him.', RUKIA, 'Rukia Kuchiki', BRIEF).ok, false, 'and nothing is added');

  /* end to end, on a scripted worker: an old M388 refusal memo does not block, a refusal is tried again, an answer lands */
  const storyId = 'm444-tidy';
  const st = { ...emptyState(), sheet: { actors: {}, playerName: 'Jovan Oda' }, characters: { 'Rukia Kuchiki': { core: CORE, threads: [] } } };
  await saveState(storyId, st);
  const { coreKeyOf } = { coreKeyOf: (c) => { let h = 5381; for (let i = 0; i < c.length; i += 1) h = ((h << 5) + h + c.charCodeAt(i)) >>> 0; return c.length + ':' + h.toString(36); } };
  const meta = { canon_grounding_cache: { rukia: RUKIA }, cozy_canon_tidied: { 'Rukia Kuchiki': coreKeyOf(CORE) } };
  eq(canonRepeats(st, meta).map((x) => x.name).join(), 'Rukia Kuchiki', 'the old memo of a refusal does not keep her from a fresh look');
  const answer = (core) => JSON.stringify({ pages: [{ name: 'Rukia Kuchiki', core }] });
  let r = await withHouse({ fetch: streamed(answer('Lieutenant of the 13th Division.')) }, () => canonTidyPeople({ connection: HOUSES[0].conn, storyId, meta, material: BRIEF }));
  eq(r.applied.length, 0, 'a bad answer lands nothing');
  eq(canonRepeats(await loadState(storyId), meta).length, 1, 'and she is looked at again next time');
  r = await withHouse({ fetch: streamed(answer(CLEAN)) }, () => canonTidyPeople({ connection: HOUSES[0].conn, storyId, meta, material: BRIEF }));
  eq(r.applied.length, 1, 'a good answer lands');
  eq((await loadState(storyId)).characters['Rukia Kuchiki'].core, CLEAN, 'her page holds what the story made of her');
  eq(canonRepeats(await loadState(storyId), meta).length, 0, 'and she is done');
  /* three refusals, and the house stops asking about those words */
  await saveState(storyId, st);
  const meta2 = { canon_grounding_cache: { rukia: RUKIA } };
  for (let i = 0; i < 3; i += 1) await withHouse({ fetch: streamed(answer('Lieutenant.')) }, () => canonTidyPeople({ connection: HOUSES[0].conn, storyId, meta: meta2, material: BRIEF }));
  eq(canonRepeats(await loadState(storyId), meta2).length, 0, 'after three refusals it stops asking');
});
