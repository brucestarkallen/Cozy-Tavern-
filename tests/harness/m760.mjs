/* Cozy Tavern — harness laws of M760: the review the auditor sends fits its connection with every owed source fact. His
 * (23 October 2026, 00:12): "What's this why the auditor still do this kind of thing Manual yellow check: the auditor was
 * given a fresh try; still yellow — Current ledger verification is incomplete; Ledger entry receipts are incomplete; Vanessa
 * Langley has source identity facts to reconcile: … no review answer for it — the review did not finish this pass" — a
 * dozen of them. Each law runs the real auditor and store with the provider scripted, and failed on m759-001. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { emptyPerson } from '../../js/engine/people.js';
import { auditLedger } from '../../js/agents/auditor.js';
import { auditSources } from '../../js/agents/auditsources.js';

const stream = (v) => new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: JSON.stringify(v) } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
const filler = (n, tag) => (tag + ' ' + 'The rain worked at the tall windows of Blackwood Manor while the deputies argued in low voices about the county paperwork. ').repeat(Math.ceil(n / 120)).slice(0, n);
const quoteOf = (i) => 'Vanessa Langley turned to the room, turn ' + i + ', and gave her orders.';

/* his tale's shape: forty long pages, Vanessa read with an identity fact on `withFacts` of them, ten people on the ledger */
async function blackwood(title, withFacts) {
  const { id } = await db.stories.create({ title });
  for (let i = 0; i < 40; i += 1) {
    await db.messages.append(id, { role: 'user', text: 'I look around the ballroom, turn ' + i + '.' });
    await db.messages.append(id, { role: 'assistant', text: (i < withFacts ? quoteOf(i) + ' ' : '') + filler(6800, 'Page ' + i) });
  }
  const docs = auditSources({ messages: await db.messages.list(id) });
  const st = { ...emptyState(), sheet: { actors: {}, playerName: 'Jovan Wessex', playerAliases: [] }, page: 40, characters: {} };
  st.characters['Vanessa Langley'] = { ...emptyPerson(), core: 'FBI special agent in charge at Blackwood Manor; cold and professional. ' + filler(1500, 'core'), state: filler(600, 'state'), arc: filler(1200, 'arc'), threads: [filler(200, 't')] };
  for (const n of ['Claire Ashford', 'Sheriff Odell Cray', 'Deputy Pruitt', 'Dr. Hollis Rennick', 'Deputy Vance', 'Marcus Hale', 'Tobin Reyes', 'Ada Blackwood', 'the photographer']) st.characters[n] = { ...emptyPerson(), core: n + ' — ' + filler(1500, 'core'), state: filler(500, 'state'), arc: filler(800, 'arc') };
  st.relationships = Object.fromEntries(Object.keys(st.characters).map((k, i) => [k, { p: i, r: 0, s: 0, history: [] }]));
  st.present = [{ name: 'Jovan Wessex' }, { name: 'Vanessa Langley' }, { name: 'Claire Ashford' }];
  st.auditSources = {};
  for (const d of docs) {
    const m = /turn (\d+), and gave her orders/.exec(d.text);
    st.auditSources[d.id] = { mark: d.mark, appearanceReviewed: true, profileReviewed: 1,
      people: m && Number(m[1]) < withFacts ? [{ name: 'Vanessa Langley', kind: 'person', shown: m[0], facts: [], identityFacts: [{ text: 'Commands the scene at Blackwood Manor, turn ' + m[1], shown: quoteOf(m[1]) }] }] : [] };
  }
  await saveState(id, st);
  return id;
}
async function onWire(review, fn) {
  const calls = { review: 0, sizes: [], tasks: [] };
  const before = globalThis.fetch;
  globalThis.fetch = async (_, o) => {
    const body = JSON.parse(o.body);
    const user = body.messages.find((m) => m.role === 'user').content;
    if (user.startsWith('SOURCE DOCUMENTS')) return stream({ checked: JSON.parse(user.slice('SOURCE DOCUMENTS\n'.length)).map((d) => d.id), people: [] });
    if (user.startsWith('REQUIRED CURRENT LEDGER CHECKS')) { const ids = JSON.parse(user.split('\n')[1]).map((r) => r.id); return stream({ checks: ids.map((x) => ({ id: x, status: 'correct', why: 'read' })), issues: [], review: { status: 'complete', why: 'read', open: [] } }); }
    calls.review += 1;
    calls.sizes.push(body.messages.reduce((n, m) => n + String(m.content).length, 0));
    if (user.includes('REQUIRED SOURCE MENTION DECISIONS:\n')) calls.tasks = JSON.parse(user.split('REQUIRED SOURCE MENTION DECISIONS:\n')[1].split('\n')[0]);
    return stream({ issues: [], standings: [], scene: [], ...review });
  };
  try { return await fn(calls); } finally { globalThis.fetch = before; }
}
const CONN = { type: 'openai', baseUrl: 'https://fixture.example/v1', apiKey: 'fixture', model: 'fixture', preset: 'custom', contextSize: 128000, reasoning: { effort: 'off' } };
const owedFacts = (r) => r.pending.filter((p) => /Vanessa Langley has source identity facts/.test(p));

test('M760-1 TWELVE OF VANESSA’S FACTS AND THE WHOLE LEDGER IN ONE REVIEW THAT FITS: on a 128k connection the review is sent — each fact with the passage around its quote, her record once — and every fact and every entry is decided; on m759-001 the request was refused before it left, every pass ("did not finish", none of 51 entries verified)', async () => {
  const id = await blackwood('m760-1', 12);
  const r = await onWire({ review: { status: 'complete', why: 'Every entry and source fact was compared with the originals.', open: [] } }, async (calls) => {
    const out = await auditLedger({ connection: CONN, storyId: id, reviewSources: 'all' });
    eq(calls.review, 1, 'the review was sent');
    assert(calls.sizes[0] < 360000, 'inside its connection: ' + calls.sizes[0]);
    const facts = calls.tasks.filter((t) => t.sourceFacts);
    eq(facts.length, 12, 'all twelve facts carried');
    assert(facts.every((t, i) => t.originalPassage.length <= 2600 && t.originalPassage.includes(t.facts[0].shown)), 'each with the passage around its own quote, not its whole section');
    eq(facts.filter((t) => Array.isArray(t.currentEntries)).length, 1, 'her record once');
    assert(facts.slice(1).every((t) => t.currentEntries === 'the same current records as task ' + facts[0].id), 'the rest point at it');
    return out;
  });
  eq(owedFacts(r).length, 0, 'no fact owed: ' + JSON.stringify(r.pending).slice(0, 300));
  const after = await loadState(id);
  eq(after.audit.verification.read, after.audit.verification.total, 'every entry verified');
  eq(r.unfinished, false, 'green');
});

test('M760-2 MORE FACTS THAN ONE REVIEW HAS ROOM FOR WAIT, AND SAY SO: forty of them — the review still fits and carries what it can; the rest are not asked (so never counted as asked), and each says it waits for the next review', async () => {
  const id = await blackwood('m760-2', 40);
  let carried = 0;
  const r = await onWire({ review: { status: 'open', why: 'I could not finish this reading.', open: [] } }, async (calls) => {
    const out = await auditLedger({ connection: CONN, storyId: id, reviewSources: 'all' });
    eq(calls.review, 1, 'sent');
    assert(calls.sizes[0] < 360000, 'inside its connection: ' + calls.sizes[0]);
    carried = calls.tasks.filter((t) => t.sourceFacts).length;
    return out;
  });
  assert(carried > 0 && carried < 40, 'it carried part of them: ' + carried);
  const waiting = owedFacts(r).filter((p) => p.includes('waits for the next review — this one had room for ' + carried + ' of the source tasks'));
  eq(waiting.length, 40 - carried, 'the rest say they wait');
  eq(Object.keys((await loadState(id)).audit.sourceFactAsks || {}).length, carried, 'only the facts it was asked about count as asked');
});
