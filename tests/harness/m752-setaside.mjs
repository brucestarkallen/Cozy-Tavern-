/* Cozy Tavern — harness laws of M752 (followup 21): A SOURCE MENTION THE AUDITOR CANNOT TIE TO ANYONE IS SET ASIDE.
 * HIS (15 October 2026): "Isn't we already using send them back and if can't debate then it's resolve?? the auditor ran just
 * now has unresolved findings; repeated attempts are paused until the story or ledger changes — still checking: the
 * under-steward's boy is listed as an individual by the source reading in Page 122, story; confirm its identity or correct
 * its entity classification: identity or entity classification still needs a working repair; the older house-knight …; the
 * groom …". A role the page never names (the groom) was asked of the final reader on every pass; kept open, or left without
 * a decision after the same conversation asked again, it stayed pending for good, every pass sent it again, and two passes
 * that got nowhere paused the automatic audit.
 *   SA1  kept open with a reason: the mention is kept as a person of that page only (scope local), the reader's reason in
 *        its record; no profile, alias or feeling changes; the audit finishes and owes no repeat
 *   SA2  no decision even after the same conversation asked again: the same, saying so — two calls, never a third
 *   SA3  a decision the reader did give still lands as given (bound to the person it named)
 *   SA4  the house's setting-aside is journaled and taken back by undo
 * New code is reached through module namespaces, so this file loads against the tree before followup 21. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { emptyState, loadState, saveState } from '../../js/engine/state.js';
import { undoLast } from '../../js/engine/apply.js';
import { auditSources, missingSourcePeople, sourcePersonKey } from '../../js/agents/auditsources.js';
import { auditLedger } from '../../js/agents/auditor.js';
import { ledgerVerificationRows, ledgerRepairInputKey, ledgerRepairStateKey, saveAuditCheckpoint, ledgerAuditVerified, ledgerRepairNeeded } from '../../js/agents/auditprogress.js';

const connection = { type: 'openai', baseUrl: 'https://fixture.example/v1', apiKey: 'fixture', model: 'fixture', preset: 'custom', contextSize: 200000, reasoning: { effort: 'off' } };
const ROLES = ['the under-steward’s boy', 'the older house-knight', 'the groom'];
const PAGE = 'Sela crossed the stable yard. The groom led her mare out; the older house-knight watched from the gate, and the under-steward’s boy ran for the saddle.';

async function seed(title) {
  const story = await db.stories.create({ title });
  for (const [role, text] of [['user', 'Sela is the fourth princess.'], ['assistant', 'Sela waited in the hall.'], ['user', 'I follow her out.'], ['assistant', PAGE]]) await db.messages.append(story.id, { role, text });
  const history = await db.messages.list(story.id);
  const documents = auditSources({ messages: history });
  let state = { ...emptyState(), sheet: { playerName: 'Keir', playerAliases: [], actors: {} },
    characters: { Sela: { core: 'The fourth princess.', arc: 'Curious about Keir.' } }, relationships: { Sela: { p: 40, r: 20, s: 0 } },
    auditSources: Object.fromEntries(documents.map((d) => [d.id, { mark: d.mark, appearanceReviewed: true, profileReviewed: 1, people: [] }])) };
  const last = documents[documents.length - 1];
  state.auditSources[last.id].people = ROLES.map((name) => ({ name, kind: 'person', shown: PAGE, identityFacts: [], facts: [] }));
  await saveState(story.id, state);
  state = await loadState(story.id);
  const rows = ledgerVerificationRows(state);
  const verification = { source: ledgerRepairInputKey({}, story, history), ledger: ledgerRepairStateKey(state), read: rows.length, total: rows.length,
    entries: Object.fromEntries(rows.map((r) => [r.id, { print: r.print, scope: r.scope, status: 'correct', why: 'Approved before.' }])), profiles: {} };
  const findings = missingSourcePeople(state, documents.flatMap((d) => state.auditSources[d.id].people.map((p) => ({ ...p, source: d.id, label: d.label }))));
  eq(findings.length, 3, 'fixture: the three roles are owed a decision');
  state.audit = { verification, coverage: { read: documents.length, total: documents.length }, finalReview: { status: 'ok' }, unresolved: findings, unfinished: true, pending: findings.map((i) => i.what) };
  state.audit.checkpoint = saveAuditCheckpoint(state, story, documents, verification);
  await saveState(story.id, state);
  return { story, history, last, state: await loadState(story.id) };
}

/* the final reader, scripted: `answer(tasks, continued)` returns its identities and what it keeps open */
async function withReader(answer, fn) {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_, options) => {
    calls += 1;
    const body = JSON.parse(options.body);
    const request = body.messages.find((m) => m.role === 'user' && String(m.content).includes('REQUIRED SOURCE MENTION DECISIONS')).content;
    const tasks = JSON.parse(request.split('REQUIRED SOURCE MENTION DECISIONS:\n')[1].split('\n')[0]);
    const { identities = [], open = [] } = answer(tasks, body.messages.some((m) => m.role === 'assistant'));
    const content = JSON.stringify({ issues: [], identities, review: { status: 'complete', why: 'The ledger stands as the pages leave it.', open }, standings: [] });
    return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  };
  try { return await fn(() => calls); } finally { globalThis.fetch = real; }
}

const localOf = (state, last, name) => (state.auditSources[last.id].people.find((p) => p.name === name) || {}).identityResolution || null;

test('M752-SA1 A ROLE THE AUDITOR KEEPS OPEN, WITH ITS REASON, IS KEPT AS A PERSON OF THAT PAGE ONLY — the audit finishes, owes no repeat, and nothing of anyone’s page, name or feelings changes', async () => {
  const s = await seed('the groom kept open');
  const WHY = 'The page never names him, and no one the story has named works the stables.';
  await withReader((tasks) => ({ open: tasks.map((t) => ({ id: t.id, why: WHY })) }), async (calls) => {
    const r = await auditLedger({ connection, storyId: s.story.id, reviewSources: 'all' });
    assert(r, 'the audit answered');
    eq(r.unfinished, false, 'nothing is left pending: ' + JSON.stringify(r.pending));
    eq(calls(), 1, 'one call');
  });
  const landed = await loadState(s.story.id);
  for (const name of ROLES) {
    const res = localOf(landed, s.last, name);
    assert(res && res.kind === 'person' && res.scope === 'local' && !res.to, name + ': kept as a person of this page only — ' + JSON.stringify(res));
    assert(res.why.includes(WHY), name + ': with the auditor’s own reason — ' + res.why);
    eq(sourcePersonKey(landed, name), '', name + ': never a name of anyone');
  }
  eq(JSON.stringify(landed.characters), JSON.stringify(s.state.characters), 'no page made, renamed or written');
  eq(JSON.stringify(landed.relationships), JSON.stringify(s.state.relationships), 'feelings untouched');
  assert(ledgerAuditVerified(landed, s.story, s.history), 'the audit stands complete');
  assert(!ledgerRepairNeeded(landed, {}, s.story, s.history), 'and owes no repeat');
});

test('M752-SA2 A ROLE LEFT WITHOUT A DECISION EVEN AFTER THE SAME CONVERSATION ASKED AGAIN IS SET ASIDE THE SAME WAY, SAYING SO — two calls, never a third', async () => {
  const s = await seed('the groom never answered');
  await withReader(() => ({}), async (calls) => {
    const r = await auditLedger({ connection, storyId: s.story.id, reviewSources: 'all' });
    eq(r.unfinished, false, 'nothing is left pending: ' + JSON.stringify(r.pending));
    eq(calls(), 2, 'asked once more in the same conversation, then no further call');
  });
  const landed = await loadState(s.story.id);
  for (const name of ROLES) {
    const res = localOf(landed, s.last, name);
    assert(res && res.scope === 'local' && /no decision/i.test(res.why), name + ': set aside, saying the auditor gave no decision — ' + JSON.stringify(res));
  }
  assert(ledgerAuditVerified(landed, s.story, s.history), 'the audit stands complete');
});

test('M752-SA3 A DECISION THE READER GIVES STILL LANDS AS GIVEN — the groom bound to the person it names, the others set aside', async () => {
  const s = await seed('the groom is Sela’s man');
  await withReader((tasks) => ({
    identities: tasks.filter((t) => t.name === 'the groom').map((t) => ({ sourceId: t.sourceId, name: t.name, to: 'Sela', kind: 'person', why: 'fixture: the reader ties him to Sela' })),
    open: tasks.filter((t) => t.name !== 'the groom').map((t) => ({ id: t.id, why: 'Never named.' })),
  }), async () => {
    const r = await auditLedger({ connection, storyId: s.story.id, reviewSources: 'all' });
    eq(r.unfinished, false, JSON.stringify(r.pending));
  });
  const landed = await loadState(s.story.id);
  const groom = landed.auditSources[s.last.id].people.find((p) => p.name === 'the groom');
  eq(groom.ledgerName + ' | ' + groom.identityResolution.scope, 'Sela | undefined', 'the reader’s own decision stands');
  eq(localOf(landed, s.last, 'the older house-knight').scope, 'local', 'the one it kept open is set aside');
});

test('M752-SA4 THE SETTING-ASIDE IS JOURNALED AND TAKEN BACK BY UNDO — the mention is owed a decision again', async () => {
  const s = await seed('the groom taken back');
  await withReader((tasks) => ({ open: tasks.map((t) => ({ id: t.id, why: 'Never named.' })) }), () => auditLedger({ connection, storyId: s.story.id, reviewSources: 'all' }));
  const landed = await loadState(s.story.id);
  const one = undoLast(landed).state;
  eq(ROLES.map((n) => localOf(one, s.last, n)).filter(Boolean).length, 2, 'each is its own journaled decision: one undo takes one back');
  const undone = undoLast(undoLast(one).state).state;
  eq(ROLES.map((n) => localOf(undone, s.last, n)).filter(Boolean).length, 0, 'every setting-aside taken back');
  assert(!ledgerAuditVerified(undone, s.story, s.history), 'and the audit is owed again');
});

test('M752-SA5 THE SAME FOR A PERSON’S FACTS THE AUDITOR KEEPS OPEN: “Sela has source identity facts to reconcile” kept open with its reason is decided as left as it stands, with that reason — her page untouched, the audit finished, not owed on every pass', async () => {
  const s = await seed('sela’s facts kept open');
  /* Sela's own mention on the newest page carries a fact her page does not hold */
  const st = await loadState(s.story.id);
  st.auditSources[s.last.id].people = [{ name: 'Sela', kind: 'person', ledgerName: 'Sela', shown: PAGE, identityFacts: [{ text: 'a rider since childhood', shown: 'Sela crossed the stable yard' }], facts: [] }];
  st.audit = { ...st.audit, unresolved: [], pending: [] };
  await saveState(s.story.id, st);
  const WHY = 'Crossing a stable yard does not establish that she rides.';
  await withReader((tasks) => ({ open: tasks.map((t) => ({ id: t.id, why: WHY })) }), async () => {
    const r = await auditLedger({ connection, storyId: s.story.id, reviewSources: 'all' });
    eq(r.unfinished, false, 'nothing is left pending: ' + JSON.stringify(r.pending));
  });
  const landed = await loadState(s.story.id);
  const decisions = Object.values(landed.audit.sourceFactDecisions || {});
  assert(decisions.some((d) => String(d.why).includes(WHY)), 'decided with the auditor’s own reason: ' + JSON.stringify(decisions));
  eq(landed.characters.Sela.core, 'The fourth princess.', 'her page untouched');
  assert(ledgerAuditVerified(landed, s.story, s.history), 'the audit stands complete');
});
