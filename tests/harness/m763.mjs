/* Cozy Tavern — harness laws of M763: a forget that loses nothing is the final review's to make. His (23 October 2026,
 * 12:17): "Why it's still yellow for auditor wtf the auditor ran just now has unresolved findings; repeated attempts are
 * paused until the story or ledger changes — still checking: Convenience Store Clerk is listed as an individual by the source
 * reading in World voice after page 14; confirm its identity or correct its entity classification: identity or entity
 * classification still needs a working repair; The ledger lists 'Convenience Store Clerk' as a People record, but the source
 * text identifies them as a temporary speaker by role at a location with no continuing identity or biography: preserve
 * established records; correct identity with a rename; … : no repair was supplied." The clerk had no People page: the world
 * kept the speaker a voice of that page. Asked to decide the mention, the review let the name go (people.forget), which its
 * vocabulary offers and its own scope refused every time, whatever the ledger held; asked again it kept the finding without
 * the repair. Each law runs the real auditor with the provider scripted, and failed on m762-001. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { auditLedger } from '../../js/agents/auditor.js';
import { auditSources } from '../../js/agents/auditsources.js';
import { fingerprint36 } from '../../js/engine/fingerprint.js';

const CONN = { type: 'openai', baseUrl: 'https://fixture.example/v1', apiKey: 'fixture', model: 'fixture', preset: 'custom', contextSize: 200000, reasoning: { effort: 'off' } };
const stream = (v) => new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: JSON.stringify(v) } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
const CLERK = 'Convenience Store Clerk';
const WHAT = "The ledger lists 'Convenience Store Clerk' as a People record, but the source text identifies them as a temporary speaker by role at a location with no continuing identity or biography";

async function tale(title, { written = false } = {}) {
  const { id } = await db.stories.create({ title });
  await db.messages.append(id, { role: 'user', text: 'I stop for gas.' });
  await db.messages.append(id, { role: 'assistant', text: 'Jovan filled the tank under the buzzing lights and went in to pay.',
    voices: [{ icon: '🏪', speaker: CLERK, channel: 'the Gas-N-Go counter · 23:40', content: 'Pump four, forty even. You want the receipt?' }] });
  const docs = auditSources({ messages: await db.messages.list(id) });
  const voice = docs.find((d) => d.id.startsWith('voice:'));
  let st = applyMutations({ ...emptyState(), sheet: { actors: {}, playerName: 'Jovan Wessex', playerAliases: [] } }, [
    { type: 'people.set', name: CLERK, field: 'core', open: true, source: 'world' }, /* the world agent opened it for the voice */
    ...(written ? [{ type: 'people.set', name: CLERK, field: 'core', text: 'Night clerk at the Gas-N-Go who knows every trucker on Route 9 by name.' }] : []),
  ]).state;
  st.auditSources = Object.fromEntries(docs.map((d) => [d.id, { mark: d.mark, appearanceReviewed: true, profileReviewed: 1,
    people: d === voice ? [{ name: CLERK, kind: 'person', shown: 'Pump four, forty even.', facts: [], identityFacts: [] }] : [] }]));
  await saveState(id, st);
  return { id, voice };
}
/* his tale: the voice and its mention, and no People page for the clerk at all */
async function bare(title) {
  const { id } = await db.stories.create({ title });
  await db.messages.append(id, { role: 'user', text: 'I stop for gas.' });
  await db.messages.append(id, { role: 'assistant', text: 'Jovan filled the tank under the buzzing lights and went in to pay.',
    voices: [{ icon: '🏪', speaker: CLERK, channel: 'the Gas-N-Go counter · 23:40', content: 'Pump four, forty even. You want the receipt?', identity: { scope: 'local', why: 'a speaker of this stop only' } }] });
  const docs = auditSources({ messages: await db.messages.list(id) });
  const voice = docs.find((d) => d.id.startsWith('voice:'));
  const st = { ...emptyState(), sheet: { actors: {}, playerName: 'Jovan Wessex', playerAliases: [] } };
  st.auditSources = Object.fromEntries(docs.map((d) => [d.id, { mark: d.mark, appearanceReviewed: true, profileReviewed: 1,
    people: d === voice ? [{ name: CLERK, kind: 'person', shown: 'Pump four, forty even.', facts: [], identityFacts: [] }] : [] }]));
  return { id, voice, st };
}
const FORGET = { type: 'people.forget', name: CLERK, cause: 'a temporary speaker by role with no continuing identity' };
/* his review, as it answered: the page is a temporary speaker's, let it go — and the mention is that speaker's, local */
const forgetIt = (voice) => (user, n, continued) => ({
  issues: continued ? [] : [{ what: WHAT, mutations: [{ type: 'people.forget', name: CLERK, cause: 'a temporary speaker by role with no continuing identity' }] }],
  identities: [{ sourceId: voice.id, name: CLERK, kind: 'person', scope: 'local', why: 'A one-time voice at the store counter; no continuing identity is established.' }],
  review: { status: 'complete', why: 'The ledger stands as the pages leave it, the clerk aside.', open: [] }, standings: [],
});
async function audit(id, review) {
  const before = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async (_, o) => {
    const body = JSON.parse(o.body);
    const user = body.messages.find((m) => m.role === 'user').content;
    if (user.startsWith('SOURCE DOCUMENTS')) return stream({ checked: JSON.parse(user.slice('SOURCE DOCUMENTS\n'.length)).map((d) => d.id), people: [] });
    n += 1;
    return stream(review(user, n, body.messages.some((m) => m.role === 'assistant')));
  };
  try { return await auditLedger({ connection: CONN, storyId: id, reviewSources: 'all' }); } finally { globalThis.fetch = before; }
}

test('M763-1 HIS CLERK: NO PEOPLE PAGE, A VOICE’S MENTION TO DECIDE, AND THE REVIEW LETS THE NAME GO — nothing of the clerk is written in the ledger, so the forget is already so, never refused; the review’s cause decides the mention (a person of that voice only, journaled); one answer, nothing owed (on m762-001: refused twice in the same review — "preserve established records; correct identity with a rename" — the mention still owed, every pass)', async () => {
  const { id, voice, st } = await bare('m763-1');
  await saveState(id, st);
  let calls = 0;
  const r = await audit(id, () => { calls += 1; return { issues: [{ what: WHAT, mutations: [FORGET] }], identities: [], review: { status: 'complete', why: 'Checked against the originals.', open: [] }, standings: [] }; });
  eq(r.pending.length, 0, 'nothing owed: ' + JSON.stringify(r.pending).slice(0, 500));
  eq(calls, 1, 'answered once — never asked again over a refusal');
  const after = await loadState(id);
  const mention = after.auditSources[voice.id].people[0];
  eq(mention.identityResolution?.scope, 'local', 'the voice is the clerk’s alone');
  eq(mention.identityResolution?.why, FORGET.cause, 'for the cause the review gave');
  assert((after.journal || []).some((j) => j.m && j.m.type === 'source.resolve' && j.m.name === CLERK), 'journaled, so it can be taken back');
  eq(after.characters[CLERK], undefined, 'no page was made');
});

test('M763-2 HIS TALE AS THE PAUSED AUDIT LEFT IT — the mention owed and the finding saved with no repair ("no repair was supplied"): the resumed review answers that finding by its id with the same forget and decides the voice — both close, nothing owed (on m762-001 the forget was refused again and the finding stood)', async () => {
  const { id, voice, st } = await bare('m763-2');
  const owedMention = { what: CLERK + ' is listed as an individual by the source reading in World voice after page 2; confirm its identity or correct its entity classification.',
    name: CLERK, sourceId: voice.id, sourceName: CLERK, profileRecovery: true, shown: 'Pump four, forty even.', fix: 'Resolve this mention in its original source.', pages: false, mutations: [] };
  const savedBare = { what: WHAT, fix: '', pages: false, pendingReason: 'no repair was supplied', mutations: [] };
  st.audit = { ...(st.audit || {}), unresolved: [owedMention, savedBare], unfinished: true };
  await saveState(id, st);
  const r = await audit(id, () => ({ issues: [], standings: [],
    repairs: [{ id: 'finding:' + fingerprint36(WHAT), status: 'repair', what: WHAT, mutations: [{ ...FORGET }] }],
    identities: [{ sourceId: voice.id, name: CLERK, kind: 'person', scope: 'local', why: 'A one-time voice at the store counter.' }],
    review: { status: 'complete', why: 'Checked against the originals.', open: [] } }));
  eq(r.pending.length, 0, 'nothing owed: ' + JSON.stringify(r.pending).slice(0, 500));
  eq((await loadState(id)).auditSources[voice.id].people[0].identityResolution?.why, 'A one-time voice at the store counter.', 'the review’s own decision for the voice stands, never overruled by the forget');
});

test('M763-3 AN EMPTY PAGE OPENED FOR A ONE-TIME VOICE, NOTHING EVER WRITTEN ON IT — the review that lets it go is taken at its word: the page goes (journaled), the voice is the clerk’s alone, and nothing is left owed (on m762-001 the same answer was refused every pass); a page with anything written on it is still kept, with the reason', async () => {
  const { id, voice } = await tale('m763-3');
  const r = await audit(id, forgetIt(voice));
  const st = await loadState(id);
  eq(st.characters[CLERK], undefined, 'the empty page is let go: ' + JSON.stringify(r.pending).slice(0, 300));
  assert((st.journal || []).some((j) => j.m && j.m.type === 'people.forget' && j.m.name === CLERK), 'journaled, so it can be taken back');
  eq(st.auditSources[voice.id].people[0].identityResolution?.scope, 'local', 'the voice is the clerk’s alone');
  assert(!r.pending.some((p) => /Convenience Store Clerk/.test(p)), 'nothing about the clerk is owed: ' + JSON.stringify(r.pending).slice(0, 400));
  /* …and a page with anything written on it is still kept: the same answer for a clerk the story wrote a nature for is
   * refused as before, with the reason that says to correct the identity with a rename */
  const kept = await tale('m763-3 written', { written: true });
  const r2 = await audit(kept.id, forgetIt(kept.voice));
  const st2 = await loadState(kept.id);
  assert(st2.characters[CLERK] && /Gas-N-Go/.test(st2.characters[CLERK].core), 'the written page and its nature stand');
  assert(r2.pending.some((p) => p.includes(WHAT) && /preserve established records; correct identity with a rename/.test(p)), 'refused, said why: ' + JSON.stringify(r2.pending).slice(0, 400));
});

/* The final audit of M763-M765 (an independent review, 23 October 2026), two holes in M763 itself */
test('M763-4 AN ALREADY-SO REPAIR ANSWERS ONLY WHAT ITS FINDING SPEAKS OF: his saved bare finding about the clerk, answered by its id with a forget of a name the finding never mentions ("Gas-N-Go night clerk", nothing of it in the ledger) — the finding stays owed; the same answer with the clerk\'s own name closes it (M763-2)', async () => {
  const { id, voice, st } = await bare('m763-4');
  st.audit = { ...(st.audit || {}), unresolved: [{ what: WHAT, fix: '', pages: false, pendingReason: 'no repair was supplied', mutations: [] }], unfinished: true };
  await saveState(id, st);
  const r = await audit(id, () => ({ issues: [], standings: [],
    repairs: [{ id: 'finding:' + fingerprint36(WHAT), status: 'repair', what: WHAT, mutations: [{ type: 'people.forget', name: 'Gas-N-Go night clerk', cause: 'temporary speaker' }] }],
    identities: [{ sourceId: voice.id, name: CLERK, kind: 'person', scope: 'local', why: 'A one-time voice at the store counter.' }],
    review: { status: 'complete', why: 'Checked against the originals.', open: [] } }));
  assert(r.pending.some((p) => p.startsWith(WHAT)), 'still owed: ' + JSON.stringify(r.pending).slice(0, 300));
});

test('M763-5 A PAGE THE SAME ANSWER WRITES ON IS NOT LET GO: an empty page, and one review answer that writes Pruitt\'s now and forgets him — the forget is refused with why, his now stands', async () => {
  const { id } = await db.stories.create({ title: 'm763-5' });
  await db.messages.append(id, { role: 'user', text: 'I look around.' });
  await db.messages.append(id, { role: 'assistant', text: 'Deputy Pruitt was in the cellar of Blackwood Manor, finishing the sweep.' });
  const docs = auditSources({ messages: await db.messages.list(id) });
  const st = applyMutations({ ...emptyState(), sheet: { actors: {}, playerName: 'Jovan Wessex', playerAliases: [] } }, [{ type: 'people.set', name: 'Deputy Pruitt', field: 'core', open: true, source: 'world' }]).state;
  st.auditSources = Object.fromEntries(docs.map((d) => [d.id, { mark: d.mark, appearanceReviewed: true, profileReviewed: 1, people: [] }]));
  await saveState(id, st);
  const r = await audit(id, () => ({ standings: [], identities: [], review: { status: 'complete', why: 'ok', open: [] },
    issues: [{ what: 'Pruitt\'s now is missing', mutations: [{ type: 'people.set', name: 'Deputy Pruitt', field: 'state', text: 'In the cellar of Blackwood Manor, finishing the sweep.', shown: 'Deputy Pruitt was in the cellar of Blackwood Manor, finishing the sweep.' }] },
      { what: 'Pruitt is a one-time role', mutations: [{ type: 'people.forget', name: 'Deputy Pruitt', cause: 'one-time role' }] }] }));
  const after = await loadState(id);
  assert(after.characters['Deputy Pruitt'], 'his page stands: ' + JSON.stringify(r.pending).slice(0, 300));
  assert(r.pending.some((p) => /this answer also writes to their record/.test(p)), 'refused, said why: ' + JSON.stringify(r.pending).slice(0, 300));
});

/* M767 — his (18:01): "Night Shift Cook is listed as an individual by the source reading in World voice after page 76; confirm
 * its identity … identity or entity classification still needs a working repair … DO I NEED TO KEEP IT DOING FLEX TAPE" */
test('M767-1 A WORLD VOICE\'S SPEAKER THE WORLD KEPT LOCAL STANDS WHEN THE REVIEW SAYS NOTHING ELSE — "Night Shift Cook", a role in capitals: the review answers complete and never decides it; the mention is kept a person of that voice only, with the world\'s own reason, journaled, nothing owed (on m766-001 it was owed for good, as a name); a speaker the world gave no decision for is still owed', async () => {
  const COOK = 'Night Shift Cook';
  async function cook(title, identity) {
    const { id } = await db.stories.create({ title });
    await db.messages.append(id, { role: 'user', text: 'I order coffee.' });
    await db.messages.append(id, { role: 'assistant', text: 'Jovan took the corner booth at the diner.',
      voices: [{ icon: '🍳', speaker: COOK, channel: 'the diner kitchen · 02:10', content: 'Order up, two eggs over easy.', ...(identity ? { identity } : {}) }] });
    const docs = auditSources({ messages: await db.messages.list(id) });
    const voice = docs.find((d) => d.id.startsWith('voice:'));
    const st = { ...emptyState(), sheet: { actors: {}, playerName: 'Jovan Wessex', playerAliases: [] } };
    st.auditSources = Object.fromEntries(docs.map((d) => [d.id, { mark: d.mark, appearanceReviewed: true, profileReviewed: 1,
      people: d === voice ? [{ name: COOK, kind: 'person', shown: 'Order up, two eggs over easy.', facts: [], identityFacts: [] }] : [] }]));
    await saveState(id, st);
    const r = await audit(id, () => ({ issues: [], identities: [], standings: [], review: { status: 'complete', why: 'Checked against the originals.', open: [] } }));
    return { r, voice, after: await loadState(id) };
  }
  const { r, voice, after } = await cook('m767-1', { scope: 'local', why: 'a cook heard through the kitchen hatch this once' });
  eq(r.pending.length, 0, 'nothing owed: ' + JSON.stringify(r.pending).slice(0, 300));
  const res = after.auditSources[voice.id].people[0].identityResolution;
  eq(res?.scope, 'local', 'a person of that voice only');
  assert(/the world agent that wrote this voice kept its speaker a person of this voice only: a cook heard through the kitchen hatch this once/i.test(res?.why || ''), 'with the world’s own reason: ' + res?.why);
  assert((after.journal || []).some((j) => j.m && j.m.type === 'source.resolve' && j.m.name === COOK), 'journaled');
  const none = await cook('m767-1 none', null);
  assert(none.r.pending.some((p) => p.startsWith(COOK + ' is listed as an individual')), 'no word from the world: still owed');
});
