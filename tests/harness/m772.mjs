/* Cozy Tavern — harness laws of M772. His (24 October 2026, 10:16): "Wtf is this are you trying to keep flex tape … the
 * auditor ran just now has unresolved findings; repeated attempts are paused until the story or ledger changes — still
 * checking: Mistress is listed as an individual by the source reading in World voice after page 16; confirm its identity or
 * correct its entity classification: identity or entity classification still needs a working repair." The Butler's voice
 * said "The mistress has returned with a guest"; the source reading listed "Mistress" as a person. The review, asked twice,
 * gave no decision for it — and the house's rule for that ("a description is kept as a person of its page only", M752
 * followup 21) took it for a NAME by its capital letter, owed for good, so the audit paused yellow. Runs the real auditor
 * with the provider scripted; fails on m771-001. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { auditLedger } from '../../js/agents/auditor.js';
import { auditSources } from '../../js/agents/auditsources.js';

const CONN = { type: 'openai', baseUrl: 'https://fixture.example/v1', apiKey: 'fixture', model: 'fixture', preset: 'custom', contextSize: 200000, reasoning: { effort: 'off' } };
const stream = (v) => new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: JSON.stringify(v) } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
async function tale(title, mention, content) {
  const { id } = await db.stories.create({ title });
  await db.messages.append(id, { role: 'user', text: 'I follow her.' });
  await db.messages.append(id, { role: 'assistant', text: 'Emilia Vermaine took three slow steps down the pale drive toward the distant gates.',
    voices: [{ icon: '🕯️', speaker: 'Butler', channel: 'the manor entry hall', content, identity: { scope: 'local', why: 'an anonymous servant of the manor' } }] });
  const docs = auditSources({ messages: await db.messages.list(id) });
  const voice = docs.find((d) => d.id.startsWith('voice:'));
  const st = applyMutations({ ...emptyState(), sheet: { actors: {}, playerName: 'Jovan Wessex', playerAliases: [] } }, [
    { type: 'people.set', name: 'Emilia Vermaine', field: 'core', text: 'Higher Vampire of the Vermaine family.' }]).state;
  st.auditSources = Object.fromEntries(docs.map((d) => [d.id, { mark: d.mark, appearanceReviewed: true, profileReviewed: 1,
    people: d === voice ? [{ name: 'Butler', kind: 'person', shown: content, facts: [], identityFacts: [], identityResolution: { kind: 'person', to: '', why: 'an anonymous servant of the manor', scope: 'local' } },
      { name: mention, kind: 'person', shown: content, facts: [], identityFacts: [] }] : [] }]));
  await saveState(id, st);
  return { id, voice };
}
/* the review as it answered him: complete, every entry checked, nothing said of the mention — asked again, the same */
async function audit(id) {
  const before = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async (_, o) => {
    const body = JSON.parse(o.body);
    const user = body.messages.find((m) => m.role === 'user').content;
    if (user.startsWith('SOURCE DOCUMENTS')) return stream({ checked: JSON.parse(user.slice('SOURCE DOCUMENTS\n'.length)).map((d) => d.id), people: [] });
    n += 1;
    return stream({ issues: [], identities: [], standings: [], review: { status: 'complete', why: 'Checked against the originals.', open: [] } });
  };
  try { return { r: await auditLedger({ connection: CONN, storyId: id, reviewSources: 'all' }), asked: n }; } finally { globalThis.fetch = before; }
}

test('M772-1 A ROLE THE ORIGINAL WRITES AS A COMMON NOUN IS A DESCRIPTION, WHATEVER CAPITAL THE READER GAVE IT: “The mistress has returned with a guest” — the review, asked again, says nothing of “Mistress”; it is kept a person of that voice only, journaled, and nothing is owed (on m771-001: owed for good, the audit paused yellow)', async () => {
  const { id, voice } = await tale('m772-1', 'Mistress', 'The mistress has returned with a guest. Prepare the guest wing.');
  const { r } = await audit(id);
  eq(r.pending.filter((p) => /Mistress/.test(p)).length, 0, 'nothing owed for it: ' + JSON.stringify(r.pending).slice(0, 400));
  const after = await loadState(id);
  const res = after.auditSources[voice.id].people.find((p) => p.name === 'Mistress').identityResolution;
  eq(res?.scope, 'local', 'a person of that voice only');
  assert((after.journal || []).some((j) => j.m && j.m.type === 'source.resolve' && j.m.name === 'Mistress'), 'journaled, so it can be taken back');
  assert(!after.characters.Mistress, 'no page opened for it');
});

test('M772-2 A NAME THE ORIGINAL WRITES AS A NAME IS STILL OWED (“Tarn”, M732): “Tarn has returned with a guest” — the review says nothing; it stays owed', async () => {
  const { id } = await tale('m772-2', 'Tarn', 'Tarn has returned with a guest. Prepare the guest wing.');
  const { r } = await audit(id);
  assert(r.pending.some((p) => p.startsWith('Tarn is listed as an individual')), 'still owed: ' + JSON.stringify(r.pending).slice(0, 300));
});
