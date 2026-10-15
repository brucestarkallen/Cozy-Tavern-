/* Cozy Tavern — harness law of M752 (followup 15): A BRANCH'S ORIGINALS ARE THE SAME ORIGINALS.
 * HIS (15 October 2026), on a branch of his long tale: "the audit is so slow" — "278 original source sections still need
 * review … ledger verification: checked 4 of 257 entries". A source section is named by its page's id, and a branch copies
 * every page under a new id: every receipt the auditor had paid for was named for the parent's pages, and the branch read
 * the whole tale again. Runs the real source review (stopped before any call: what it reuses is what it would not ask
 * about) and the real completion check. New code is reached through module namespaces, so this file loads before it. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import * as progress from '../../js/agents/auditprogress.js';
import { auditSources, reviewAuditSources } from '../../js/agents/auditsources.js';

const story = { brief: 'Jovan trains at Ravenwood.', castNotes: '' };
const page = (id, role, text) => ({ id, role, text });
const parent = [
  page('a1', 'user', 'I circle him.'), page('a2', 'assistant', 'Kaelen raised his practice sword, red hair tied back.'),
  page('a3', 'user', 'I feint low.'), page('a4', 'assistant', 'Kaelen saw the feint coming and smiled.'),
];
const copies = parent.map((p, i) => ({ ...p, id: 'b' + (i + 1) }));
const idMap = Object.fromEntries(parent.map((p, i) => [p.id, copies[i].id]));
const docsOf = (pages) => auditSources({ ...story, messages: pages });
const reused = async (state, pages) => {
  const documents = docsOf(pages);
  const r = await reviewAuditSources({ connection: { id: 'c', maxTokens: 800 }, documents, previous: state.auditSources || {}, state, stale: () => true });
  return Object.keys(r.cache).length + ' of ' + documents.length;
};
/* the parent's ledger as a completed audit leaves it: every section read, every entry approved */
function audited(pages) {
  const auditSourcesBook = Object.fromEntries(docsOf(pages).map((d) => [d.id, { mark: d.mark, appearanceReviewed: true, profileReviewed: 1, people: [] }]));
  const state = { characters: { Kaelen: { core: 'Kaelen, fourth seat of Ravenwood.', aliases: [], appearanceSources: [{ key: 'hair', value: 'red', shown: 'red hair', source: 'page:a2:0', references: ['page:a2:0'] }] } }, auditSources: auditSourcesBook };
  const rows = progress.ledgerVerificationRows(state);
  const entries = Object.fromEntries(rows.map((r) => [r.id, { print: r.print, scope: r.scope, status: 'correct', why: 'read' }]));
  const n = Object.keys(auditSourcesBook).length;
  state.audit = { coverage: { read: n, total: n, failures: [] }, verification: { source: progress.ledgerRepairInputKey({}, story, pages), ledger: progress.ledgerRepairStateKey(state), entries, profiles: {}, read: rows.length, total: rows.length, pending: [] } };
  state.audit.verifiedInput = progress.ledgerRepairInputKey(state, story, pages);
  return state;
}

test('M752-BR1 A BRANCH KEEPS WHAT THE AUDITOR PAID FOR (his branch read 278 sections of his tale again and re-checked 257 approved entries): the receipts and approvals of the pages it copies are the copies’ — no section is read again, the audit stays complete; a ledger carried from another point of the tale stays unverified', async () => {
  const state = audited(parent);
  eq(progress.ledgerAuditVerified(state, story, parent), true, 'fixture: the parent’s audit is complete');
  const ownNames = (st) => docsOf(copies).filter((d) => st.auditSources[d.id]).length + ' of 5';
  eq(ownNames(state), '1 of 5', 'as it was: the branch’s books held a receipt under its own name for the brief alone');
  eq(progress.ledgerAuditVerified(state, story, copies), false, 'as it was: the branch is unverified');
  eq(typeof progress.branchAuditBooks, 'function', 'the branch can carry the auditor’s books');
  const out = progress.branchAuditBooks(state, idMap, { story, from: parent, to: copies });
  eq(ownNames(out), '5 of 5', 'every section of the copies holds the parent’s receipt under its own name');
  eq(await reused(out, copies), '5 of 5', 'nothing read again');
  eq(out.characters.Kaelen.appearanceSources[0].source + ' ' + out.characters.Kaelen.appearanceSources[0].references.join(), 'page:b2:0 page:b2:0', 'what the ledger cites names the copy');
  eq(progress.ledgerAuditVerified(out, story, copies), true, 'its completed audit stands for the branch');
  eq(state.characters.Kaelen.appearanceSources[0].source, 'page:a2:0', 'the parent’s ledger is untouched');
  /* a ledger carried from another point (the parent's later audit, folded back) is not the branch's completed audit */
  const later = audited([...parent, page('a5', 'user', 'I bow.'), page('a6', 'assistant', 'Kaelen bowed back.')]);
  const carried = progress.branchAuditBooks(later, idMap, { story, from: parent, to: copies });
  eq(await reused(carried, copies), '5 of 5', 'its receipts for the copied pages are kept');
  eq(progress.ledgerAuditVerified(carried, story, copies), false, 'but it is not called complete for the branch');
});

test('M752-BR2 A BRANCH MADE BEFORE IT IS NOT READ AGAIN EITHER (his branch is already made, its receipts named for the parent’s pages): a receipt for the same text — kind, offset and mark — under a name this tale does not hold is reused for its section; a changed text, or a name this tale holds, is not', async () => {
  const state = audited(parent);
  eq(await reused(state, copies), '5 of 5', 'his branch as it stands: every section reused, nothing read again');
  const edited = copies.map((p, i) => (i === 1 ? { ...p, text: p.text + ' He grinned.' } : p));
  eq(await reused(state, edited), '4 of 5', 'a page whose words changed is read again');
  /* a receipt named for a page this tale still holds is that page's own, never another's */
  const twin = [...parent, { ...parent[1], id: 'a9' }];
  const r = await reviewAuditSources({ connection: { id: 'c', maxTokens: 800 }, documents: docsOf(twin), previous: state.auditSources, state, stale: () => true });
  eq(Object.keys(r.cache).filter((id) => id.startsWith('page:a9')).length, 0, 'a page’s own receipt is not lent to another page of the same tale');
});
