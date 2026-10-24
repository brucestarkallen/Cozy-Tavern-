/* Cozy Tavern — harness laws of M752: the ledger auditor's completion, storage and upkeep (the review of every update since
 * M681). Each law runs the real auditor, store and checkpoint code with the provider's answers scripted; each failed at
 * 5ff1a5e. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { emptyState, saveState, loadState, snapshotState, loadSnapshots, saveSnapshots, restoreSnapshot, saveOneVersion, versionStateOf, forgetBankCache } from '../../js/engine/state.js';
import { applyMutations, undoEntry } from '../../js/engine/apply.js';
import { emptyPerson } from '../../js/engine/people.js';
import { auditLedger, auditFindingId } from '../../js/agents/auditor.js';
import { auditSources, peopleSourceIndex, sourcePersonKey, sourceFactScope } from '../../js/agents/auditsources.js';
import { exactNameIn } from '../../js/engine/evidence.js';
import { isMc, isGroupName, personAliases } from '../../js/engine/people.js';
import { ledgerAuditVerified, ledgerRepairNeeded, ledgerRepairInputKey, ledgerRepairStateKey, ledgerVerificationRows, repairRetryCheckpoint, saveAuditCheckpoint, LEDGER_REPAIR_POLICY } from '../../js/agents/auditprogress.js';
import { healthSnapshot } from '../../js/agents/health.js';
import { visiblePages } from '../../js/agents/memory.js';
import { worldOwed } from '../../js/agents/world.js';
import { fingerprint36 } from '../../js/engine/fingerprint.js';
import { pageText } from '../../js/assemble/stack.js';

const CONN = { type: 'openai', baseUrl: 'https://fixture.example/v1', apiKey: 'fixture', model: 'fixture', preset: 'custom', contextSize: 200000, reasoning: { effort: 'off' } };
const stream = (value) => new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: typeof value === 'string' ? value : JSON.stringify(value) } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
/* the provider: a source reading gets `source(docs)`, the final review `review(user, calls, messages)`; calls are counted by kind */
async function onWire({ source = () => [], review = () => ({}) }, fn) {
  const calls = { source: 0, review: 0, sent: [] };
  const before = globalThis.fetch;
  globalThis.fetch = async (_, options) => {
    const user = JSON.parse(options.body).messages.find((m) => m.role === 'user').content;
    if (user.startsWith('SOURCE DOCUMENTS')) {
      calls.source += 1;
      const docs = JSON.parse(user.slice('SOURCE DOCUMENTS\n'.length));
      calls.sent.push(...docs.map((d) => d.id));
      return stream({ checked: docs.map((d) => d.id), people: await source(docs) });
    }
    calls.review += 1;
    return stream({ issues: [], review: { status: 'complete', why: 'Every entry was compared with the originals.', open: [] }, standings: [], scene: [], ...(await review(user, calls, JSON.parse(options.body).messages)) });
  };
  try { return await fn(calls); } finally { globalThis.fetch = before; }
}
const person = (name, d, text) => ({ name, kind: 'person', source: d.id, evidence: d.passages.find((p) => p.text.includes(text || name))?.id || d.passages[0].id, identityFacts: [], facts: [] });
const keir = (more = {}) => ({ ...emptyState(), sheet: { actors: {}, playerName: 'Keir', playerAliases: [] }, ...more });
async function tale(title, pages, { brief, castNotes } = {}) {
  const { id } = await db.stories.create({ title });
  if (brief !== undefined || castNotes !== undefined) await db.stories.update(id, { ...(brief !== undefined ? { brief } : {}), ...(castNotes !== undefined ? { castNotes } : {}) });
  for (const [role, text] of pages) await db.messages.append(id, { role, text });
  return id;
}
/* a ledger compared section by section (the journal and log ride the bank by their own M314 rule, not under test here) */
const sorted = (x) => JSON.stringify(Object.fromEntries(Object.keys(x || {}).filter((k) => k !== 'journal' && k !== 'log').sort().map((k) => [k, x[k]])));

test('M752-A1 A SOURCE FINDING WHOSE MENTION IS GONE CLOSES: his edit took the warden out of the page; while the page waits to be read again the finding stays open, once it is read at its new text the finding closes with no extra call, and the next unchanged audit costs nothing and is green', async () => {
  const id = await tale('m752-a1', [['user', 'Keir walks to the bridge.'], ['assistant', 'Captain Rhee led the guards across the bridge. The bridge warden, a stooped old man, waved them through without a word.']]);
  await saveState(id, keir({ characters: { 'Captain Rhee': { ...emptyPerson(), core: 'Captain of the city guard.' } } }));
  const source = (docs) => docs.flatMap((d) => [...(/Captain Rhee/.test(JSON.stringify(d)) ? [person('Captain Rhee', d)] : []), ...(/bridge warden/.test(JSON.stringify(d)) ? [person('the bridge warden', d, 'bridge warden')] : [])]);
  /* M752 (followup 21): a description the reader keeps open is set aside now (M752-SA1); what stays owed is a decision the
   * review could not finish — no decision, and the turn that asked again failed on the wire */
  const keepOpen = (user, calls, messages) => { if (messages.some((m) => m.role === 'assistant')) throw new Error('the provider is too busy'); return { review: { status: 'complete', why: 'Reviewed.', open: [] } }; };
  await onWire({ source, review: keepOpen }, () => auditLedger({ connection: CONN, storyId: id, reviewSources: 'all' }));
  const warden = (await loadState(id)).audit.unresolved.find((i) => i.sourceName === 'the bridge warden');
  assert(warden, 'the warden stays owed while its review could not finish');
  const page = (await db.messages.list(id)).find((m) => m.role === 'assistant');
  await db.messages.update(id, page.id, { text: 'Captain Rhee led the guards across the bridge.' });
  /* not read at its new text yet (an audit that reads no sources): still open, never closed on an old receipt */
  await onWire({ source, review: keepOpen }, () => auditLedger({ connection: CONN, storyId: id }));
  assert((await loadState(id)).audit.unresolved.some((i) => auditFindingId(i) === auditFindingId(warden)), 'open while the page waits to be read at its new text');
  /* read again: the reading has no warden — nothing is left to decide */
  const r = await onWire({ source }, async (calls) => { const out = await auditLedger({ connection: CONN, storyId: id, reviewSources: 'all' }); assert(calls.review <= 1, 'no continuation asking about a mention that is gone: ' + calls.review + ' review calls'); return out; });
  eq(r.unfinished, false, 'nothing is pending: ' + JSON.stringify(r.pending));
  assert(!(await loadState(id)).audit.unresolved.some((i) => i.sourceName === 'the bridge warden'), 'the finding closed');
  await onWire({ source }, async (calls) => {
    await auditLedger({ connection: CONN, storyId: id, reviewSources: 'all' });
    eq(calls.source + calls.review, 0, 'an unchanged ledger costs nothing');
  });
  const pages = await db.messages.list(id);
  assert(ledgerAuditVerified(await loadState(id), await db.stories.get(id), pages), 'and the lamp can be green');
});

test('M752-A2 A CHECKPOINT ROW HOLDS THE AUDITOR’S SOURCE RECEIPTS ONCE PER TALE, NOT WHOLE IN EVERY ROW: two checkpoints after a completed audit share them through the bank, and a rewind, a version, a branch and a book exported and read back each hand back exactly the ledger that was saved', async () => {
  const cast = ['Mira Vale', 'Captain Rhee', 'Old Tomas'];
  const pages = [];
  for (let i = 0; i < 12; i += 1) {
    pages.push(['user', 'Keir asks about the harbour, turn ' + i + '.']);
    pages.push(['assistant', Array.from({ length: 12 }, (_, k) => `${cast[(i + k) % 3]} crossed the square on day ${i}, dark hair loose in the wind, and spoke of the tide.`).join(' ')]);
  }
  const id = await tale('m752-a2', pages);
  await saveState(id, keir({ characters: Object.fromEntries(cast.map((n) => [n, { ...emptyPerson(), core: n + ' of the harbour.' }])) }));
  await onWire({ source: (docs) => docs.flatMap((d) => cast.filter((n) => JSON.stringify(d).includes(n)).map((n) => ({ ...person(n, d), facts: [{ key: 'hair', value: 'dark', evidence: d.passages[0].id }] }))) },
    () => auditLedger({ connection: CONN, storyId: id, reviewSources: 'all' }));
  const saved = await loadState(id);
  const receipts = JSON.stringify(saved.auditSources).length;
  assert(Object.keys(saved.auditSources).length === 24 && receipts > 20000, 'a real set of receipts: ' + receipts);
  const turns = (await db.messages.list(id)).filter((m) => m.role === 'user');
  await snapshotState(id, turns[10].id, saved);
  await snapshotState(id, turns[11].id, saved);
  const rows = [];
  for (const t of [turns[10], turns[11]]) {
    const row = await db.settings.get('snap:' + t.id + ':' + id);
    assert(row.pk && row.pk.auditSources && !row.auditSources, 'the row names its receipts by key, it does not hold them');
    assert(JSON.stringify(row.pk.auditSources).length < receipts / 10, 'their names are small: ' + JSON.stringify(row.pk.auditSources).length + ' bytes against ' + receipts + ' of receipts');
    rows.push(row);
  }
  eq(JSON.stringify(rows[0].pk.auditSources), JSON.stringify(rows[1].pk.auditSources), 'both rows name the same receipts, kept once in the tale’s bank');
  forgetBankCache(id);
  const list = await loadSnapshots(id);
  eq(sorted(list.find((e) => e.id === turns[11].id).snap), sorted(saved), 'a checkpoint hands back the whole ledger it was');
  await saveState(id, keir());
  await restoreSnapshot(id, turns[11].id);
  const back = await loadState(id);
  eq(JSON.stringify(back.auditSources), JSON.stringify(saved.auditSources), 'a rewind gives back every receipt');
  eq(JSON.stringify(back.audit), JSON.stringify(saved.audit), 'and the audit as it was');
  const last = (await db.messages.list(id)).filter((m) => m.role === 'assistant').at(-1);
  await saveOneVersion(id, last.id + ':0', saved);
  forgetBankCache(id);
  eq(sorted(await versionStateOf(id, last.id + ':0')), sorted(saved), 'a version ledger too');
  const { id: branch } = await db.stories.create({ title: 'm752-a2 branch' });
  await saveSnapshots(branch, (await loadSnapshots(id)).map((e) => ({ ...e })));
  forgetBankCache(branch);
  eq(JSON.stringify((await loadSnapshots(branch)).find((e) => e.id === turns[11].id).snap.auditSources), JSON.stringify(saved.auditSources), 'a branch carries them into its own bank');
  const book = await db.exportStory(id);
  for (const key of (await db.settings.keys()).filter((k) => k.endsWith(':' + id) && /^(?:snap|ckptBank|ckptBankPart|ver):/.test(k))) await db.settings.delete(key);
  await db.importStory(book);
  /* (the in-memory IndexedDB of the harness completes a transaction before its requests, so a getMany straight after
   * the import's dropCaches reads nothing — each row the book wrote is read once by key first, as the browser would) */
  for (const key of (await db.settings.keys()).filter((k) => k.endsWith(':' + id))) await db.settings.get(key);
  forgetBankCache(id);
  eq(JSON.stringify((await loadSnapshots(id)).find((e) => e.id === turns[10].id).snap.auditSources), JSON.stringify(saved.auditSources), 'and a book read back');
});

test('M752-A3 THE HOUSE’S UPKEEP RUNS ON THE PAGES THE AUDITOR READS: the house’s own example name is let go and a long-quiet passer-through retired, journaled with their take-backs, before the reading — its verdict covers the kept ledger; a seat the World still owes a decision on (an arrival come due) is left to the World', async () => {
  const id = await tale('m752-a3', [['user', 'Keir walks to the bridge.'], ['assistant', 'Keir crossed the bridge alone.']], { brief: 'Keir crosses a bridge.' });
  await saveState(id, keir({ turn: 80, characters: { 'Kris Jenner': { ...emptyPerson(), core: 'an example name an old worker echoed', updatedAtTurn: 79 }, 'Old Passerby': { ...emptyPerson(), core: 'a cab driver', updatedAtTurn: 1 } } }));
  await onWire({ source: () => [] }, () => auditLedger({ connection: CONN, storyId: id, brief: 'Keir crosses a bridge.', reviewSources: 'all' }));
  const kept = await loadState(id);
  assert(!kept.characters['Kris Jenner'], 'the example name is let go (M95)');
  assert(kept.characters['Old Passerby']?.retired, 'the passer-through is retired (M57)');
  assert(kept.log.some((l) => /Old Passerby/.test(l.words) && l.undo), 'journaled, with its take-back');
  assert(ledgerAuditVerified(kept, await db.stories.get(id), await db.messages.list(id)), 'the verdict covers the ledger as kept');
  /* a page-less rider due four hours ago: no longer on the way (M681 W5), but the World owes a decision on the journey
   * (M684/M719) — the upkeep the audit now runs first does not let his seat go before the World has decided */
  const t = await tale('m752-a3 owed', [['user', 'Keir waits at the gate.'], ['assistant', 'Keir waited at the gate while the rain came down.']]);
  let st = applyMutations({ ...keir(), page: 1, clock: { minutes: 600 } }, [{ type: 'mc.set', name: 'Keir' }, { type: 'presence.enter', name: 'Keir' },
    { type: 'offscreen.set', name: 'Tobias Wren', location: 'the north road', activity: 'riding hard', stance: 'toward', etaMinutes: 20 }]).state;
  st = { ...st, clock: { minutes: 600 + 20 + 240 }, turn: 40, page: 40 };
  eq(worldOwed(st, {}).includes('Tobias Wren'), true, 'the World owes a decision on the journey that came due');
  await saveState(t, st);
  await onWire({ source: () => [] }, () => auditLedger({ connection: CONN, storyId: t, reviewSources: 'all' }));
  const after = await loadState(t);
  assert(after.offscreen['Tobias Wren'], 'the upkeep leaves his seat to the World');
  eq(worldOwed(after, {}).includes('Tobias Wren'), true, 'and the World is still asked');
});

test('M752-A4 HIS PAGE WAITING FOR ITS REPLY DOES NOT UNVERIFY THE LEDGER: a failed send leaves his page with “try again”; the audit reads answered pages, and the lamp, the repair loop and an older completed review read the same cut', async () => {
  const id = await tale('m752-a4', [['user', 'Keir walks to the bridge.'], ['assistant', 'Captain Rhee led the guards across the bridge while Keir watched.']]);
  await saveState(id, keir({ characters: { 'Captain Rhee': { ...emptyPerson(), core: 'Captain of the city guard.' } } }));
  const source = (docs) => docs.filter((d) => /Captain Rhee/.test(JSON.stringify(d))).map((d) => person('Captain Rhee', d));
  await onWire({ source }, () => auditLedger({ connection: CONN, storyId: id, reviewSources: 'all' }));
  const story = await db.stories.get(id);
  const answered = visiblePages(await db.messages.list(id));
  await db.messages.append(id, { role: 'user', text: 'Keir draws his sword.' });
  const pages = visiblePages(await db.messages.list(id));
  const st = await loadState(id);
  assert(ledgerAuditVerified(st, story, pages), 'still verified with his page waiting');
  eq(ledgerRepairNeeded(st, {}, story, pages, 1), false, 'no repair is owed');
  eq(healthSnapshot({ storyId: id, state: st, story, pages, shelf: {} }).status, 'green', 'the lamp agrees');
  eq(ledgerRepairInputKey(st, story, pages), ledgerRepairInputKey(st, story, answered), 'one key for the same answered pages');
  await onWire({ source }, async (calls) => {
    const r = await auditLedger({ connection: CONN, storyId: id, reviewSources: 'all' });
    eq(calls.source + calls.review, 0, 'a repair pass over the same answered pages costs nothing');
    eq(r.unfinished, false);
  });
  /* an M713 completion (its keys another formula) over the same pages, his page waiting */
  const legacy = structuredClone(await loadState(id));
  const docs = auditSources({ messages: answered });
  legacy.audit.checkpoint = saveAuditCheckpoint(legacy, story, docs, legacy.audit.verification);
  delete legacy.audit.checkpoint.source;
  legacy.audit.verification.source = fingerprint36(JSON.stringify(['m713-001', story.brief, story.castNotes, story.connections,
    answered.map((p) => [p.id, p.role, p.ooc, pageText(p), p.voices || []]), fingerprint36(JSON.stringify(Array(20).fill(null)))]));
  legacy.audit.verifiedInput = 'old version key'; legacy.audit.verification.ledger = 'old raw ledger key';
  assert(ledgerAuditVerified(legacy, story, answered), 'the M713 completion migrates (M715)');
  assert(ledgerAuditVerified(legacy, story, pages), 'and his waiting page does not undo it');
});

test('M752-A5 A ROW TAKEN OUT AFTER A COMPLETED AUDIT IS NOT VERIFIED: a thread closed (or a seat let go) after the verdict leaves the lamp yellow until the auditor has read the ledger as it is; an unchanged older completion still stands', async () => {
  const id = await tale('m752-a5', [['user', 'Keir walks to the bridge.'], ['assistant', 'Captain Rhee led the guards across the bridge while Keir watched. Mira was at the harbour, waiting for the tide.']]);
  let st = keir({ characters: { 'Captain Rhee': { ...emptyPerson(), core: 'Captain of the city guard.' }, Mira: { ...emptyPerson(), core: 'A sailor.' } } });
  st = applyMutations(st, [{ type: 'thread.set', title: 'Who paid the warden', owner: 'Captain Rhee', heat: 'hot', next: 'ask at the gate' },
    { type: 'thread.set', title: 'The missing ledger', owner: 'Mira', heat: 'cold', next: 'search the harbour' }]).state;
  await saveState(id, st);
  await onWire({ source: (docs) => docs.flatMap((d) => (/Captain Rhee/.test(JSON.stringify(d)) ? [person('Captain Rhee', d), person('Mira', d)] : [])) },
    () => auditLedger({ connection: CONN, storyId: id, reviewSources: 'all' }));
  const story = await db.stories.get(id);
  const pages = await db.messages.list(id);
  const audited = await loadState(id);
  assert(ledgerAuditVerified(audited, story, pages), 'verified as audited');
  const closed = applyMutations(audited, [{ type: 'thread.close', title: 'The missing ledger', source: 'world' }]);
  eq(closed.applied.length, 1);
  assert(ledgerRepairStateKey(closed.state) !== audited.audit.verification.ledger, 'the ledger changed');
  eq(ledgerAuditVerified(closed.state, story, pages), false, 'a removed row is not verified');
  eq(healthSnapshot({ storyId: id, state: closed.state, story, pages, shelf: {} }).status, 'yellow');
  /* the M715 promise: an unchanged completion with another formula's keys is not restarted */
  const legacy = structuredClone(audited);
  legacy.audit.verifiedInput = 'old version key'; legacy.audit.verification.ledger = 'old raw ledger key'; legacy.audit.verification.source = 'old source key';
  assert(ledgerAuditVerified(legacy, story, pages), 'every row and every approved entry still match');
});

test('M752-A6 SOURCE READINGS ALREADY PAID FOR SURVIVE A READING THAT WENT STALE: a send in the middle of the scan writes nothing, and the next audit reads only what was not read — a page changed meanwhile is read again', async () => {
  const pages = [];
  for (let i = 0; i < 12; i += 1) {
    pages.push(['user', 'Keir asks about the tide, turn ' + i + '. ' + 'The harbour is grey. '.repeat(60)]);
    pages.push(['assistant', 'Mira Vale answered on day ' + i + '. ' + 'The gulls cried over the grain barges. '.repeat(60)]);
  }
  const id = await tale('m752-a6', pages);
  await saveState(id, keir({ characters: { 'Mira Vale': { ...emptyPerson(), core: 'A harbour clerk.' } } }));
  const small = { ...CONN, contextSize: 16000, maxTokens: 6000 };
  const source = (docs) => docs.filter((d) => JSON.stringify(d).includes('Mira Vale')).map((d) => person('Mira Vale', d));
  const before = await loadState(id);
  let firstRead = [];
  await onWire({ source }, async (calls) => {
    eq(await auditLedger({ connection: small, storyId: id, reviewSources: 'all', stale: () => calls.source >= 2 }), null, 'the stale reading lands nothing');
    firstRead = [...calls.sent];
  });
  assert(firstRead.length >= 4 && firstRead.length < 24, 'two batches were read before the send: ' + firstRead.length);
  const stale = await loadState(id);
  eq(JSON.stringify([stale.auditSources, stale.audit]), JSON.stringify([before.auditSources, before.audit]), 'nothing was written while it was stale');
  const changed = (await db.messages.list(id)).find((m) => firstRead[0].startsWith('page:' + m.id + ':'));
  await db.messages.update(id, changed.id, { text: changed.text + ' Mira Vale laughed.' });
  await onWire({ source }, async (calls) => {
    await auditLedger({ connection: small, storyId: id, reviewSources: 'all' });
    const again = calls.sent.filter((d) => firstRead.includes(d));
    eq(JSON.stringify(again), JSON.stringify([firstRead[0]]), 'only the page changed meanwhile is read again');
    eq(calls.sent.length, 24 - firstRead.length + 1, 'the rest were not paid for twice');
  });
  const after = await loadState(id);
  eq(after.audit.coverage.read, 24, 'every section has its receipt');
  for (const d of firstRead.slice(1)) assert(after.auditSources[d], 'kept and saved: ' + d);
});

test('M752-A7 HIS TAKE-BACK OF A SOURCE DECISION MADE WHILE THE AUDIT READS STANDS: the commit no longer writes every receipt back as it was when the audit began', async () => {
  const id = await tale('m752-a7', [['user', 'Keir walks to the bridge.'], ['assistant', 'Captain Rhee led the guards across the bridge. The bridge warden, a stooped old man, waved them through without a word.']]);
  const pages = await db.messages.list(id);
  const docs = auditSources({ messages: pages });
  const doc = docs.find((d) => d.id.startsWith('page:' + pages[1].id));
  let st = keir({ characters: { 'Captain Rhee': { ...emptyPerson(), core: 'Captain of the city guard.' } },
    auditSources: Object.fromEntries(docs.map((d) => [d.id, { mark: d.mark, appearanceReviewed: true, profileReviewed: 1, people: d === doc ? [
      { name: 'Captain Rhee', kind: 'person', shown: 'Captain Rhee led the guards across the bridge.', facts: [], identityFacts: [] },
      { name: 'the bridge warden', kind: 'person', shown: 'The bridge warden, a stooped old man, waved them through without a word.', facts: [], identityFacts: [] }] : [] }])) });
  st = applyMutations(st, [{ type: 'source.resolve', sourceId: doc.id, name: 'the bridge warden', kind: 'person', scope: 'local', cause: 'A distinct gate keeper on this page.', source: 'auditor', auditorApproved: true }]).state;
  await saveState(id, st);
  let taken = '';
  const r = await onWire({ source: () => { throw new Error('no reading: the receipts are current'); }, review: async () => {
    if (!taken) { const fresh = await loadState(id); const at = fresh.log.findIndex((e) => /bridge warden/.test(e.words) && !e.undone); const u = undoEntry(fresh, at); await saveState(id, u.state); taken = u.words; }
    return {};
  } }, () => auditLedger({ connection: CONN, storyId: id, reviewSources: 'all' }));
  assert(/Taken back/.test(taken), 'he took it back while the review was out');
  const after = await loadState(id);
  const warden = after.auditSources[doc.id].people.find((p) => p.name === 'the bridge warden');
  eq(warden.identityResolution, undefined, 'the decision he took back stays taken back');
  assert(after.log.find((e) => /bridge warden/.test(e.words)).undone, 'as the log says');
  eq(r.unfinished, true, 'and the mention is asked about again');
  eq(ledgerAuditVerified(after, await db.stories.get(id), pages), false);
});

test('M752-A8 A BRIEF HE SAVED WHILE THE PAGE’S READERS WORKED IS NOT MARKED VERIFIED UNREAD: the chain’s audit holds the brief its page was sent with and keys its verdict to that brief; the audit his save sends reads and reviews the new one', async () => {
  const OLD = 'Mira Vale is a harbour clerk.', NEW = 'Mira Vale is a smuggler who owns the grey barge.';
  const id = await tale('m752-a8', [['user', 'Keir asks Mira about the barge.'], ['assistant', 'Mira Vale shrugged and said nothing about the barge.']], { brief: OLD });
  await saveState(id, keir({ characters: { 'Mira Vale': { ...emptyPerson(), core: 'A harbour clerk.' } } }));
  const sent = await db.stories.get(id); /* the story as the page was sent */
  await db.stories.update(id, { brief: NEW });
  const source = (docs) => docs.filter((d) => JSON.stringify(d).includes('Mira Vale')).map((d) => person('Mira Vale', d));
  const pages = await db.messages.list(id);
  await onWire({ source }, () => auditLedger({ connection: CONN, storyId: id, brief: sent.brief, reviewSources: 'next' }));
  const now = await db.stories.get(id);
  eq(ledgerAuditVerified(await loadState(id), now, pages), false, 'not verified against a brief it never read');
  assert(ledgerAuditVerified(await loadState(id), sent, pages), 'its verdict names the brief it read');
  let saw = '';
  await onWire({ source, review: (user) => { saw = user; return {}; } }, async (calls) => {
    await auditLedger({ connection: CONN, storyId: id, brief: now.brief, reviewSources: 'all' });
    eq(calls.review, 1, 'the new brief is reviewed, not retained unread');
  });
  assert(saw.includes(NEW), 'the reviewer was handed the brief he saved');
  assert(ledgerAuditVerified(await loadState(id), now, pages), 'then verified');
});

test('M752-A9 THE PEOPLE SOURCE INDEX IS BUILT ONCE PER AUDIT, NOT ONCE PER NAME: the same answer as its definition, and 300 pages with 60 people take well under the seconds they took', async () => {
  const reference = (state, documents, people) => { /* the index as it is defined (M717; M752: a recorded description is no alias to search for): every name, its aliases, its sections */
    people = people.filter((p) => !p.kind || p.kind === 'person');
    const names = new Set([...Object.keys(state.characters || {}), ...people.map((p) => sourcePersonKey(state, p.name, p.ledgerName, p.identityResolution) || p.name)]);
    return [...names].filter((name) => name && !isMc(state, name) && !isGroupName(name)).map((name) => {
      const mentions = people.filter((p) => (sourcePersonKey(state, p.name, p.ledgerName, p.identityResolution) || p.name) === name);
      const aliases = [...new Set([name, ...personAliases(state.characters?.[name]), ...mentions.map((p) => p.name)])];
      const selected = new Set(mentions.map((p) => p.source));
      return { name, aliases, sources: documents.filter((d) => selected.has(d.id) || aliases.some((a) => exactNameIn(d.text, a))).map((d) => ({ id: d.id, label: d.label })) };
    });
  };
  const names = Array.from({ length: 40 }, (_, i) => ['Person' + i + ' Vale', 'Lady Serin', 'the bridge warden', 'Captain Rhee', 'Mira'][i % 5] + (i >= 5 ? ' ' + i : ''));
  const messages = Array.from({ length: 60 }, (_, i) => ({ id: 'm' + i, role: i % 2 ? 'assistant' : 'user', text: names[i % 40] + ' walked past. The bridge warden waved. Rías Wells met Mira at the gate — “Mira!” Captain Rhee’s sister arrived. ' + names[(i * 7) % 40] }));
  const documents = auditSources({ messages });
  const state = keir({ sheet: { playerName: 'Keir', playerAliases: [], actors: {} }, characters: Object.fromEntries(names.slice(0, 25).map((n, i) => [n, { ...emptyPerson(), core: 'x', aliases: i % 3 ? [n.split(' ')[0]] : [] }])), journal: [{ m: { type: 'people.rename', from: 'Mira', to: 'Mira Vale' } }] });
  const people = documents.flatMap((d, j) => [names[j % 40], 'the bridge warden', 'Mira', 'Keir'].map((n, k) => ({ name: n, kind: j % 7 === 0 && k === 1 ? 'place' : 'person', source: d.id, label: d.label, ...(k === 1 && j % 2 ? { identityResolution: { kind: 'person', to: 'Captain Rhee', why: 'x' }, ledgerName: 'Captain Rhee' } : {}) })));
  eq(JSON.stringify(peopleSourceIndex(state, documents, people)), JSON.stringify(reference(state, documents, people)), 'the same names, aliases and sections, in the same order');
  const many = Array.from({ length: 60 }, (_, i) => 'Person' + i + ' Vale');
  const long = auditSources({ messages: Array.from({ length: 300 }, (_, i) => ({ id: 'n' + i, role: i % 2 ? 'assistant' : 'user', text: Array.from({ length: 60 }, (_, k) => many[(i + k) % 60] + ' walked past the market stall and spoke quietly about the weather and the tide.').join(' ') })) });
  const big = keir({ characters: Object.fromEntries(many.map((n) => [n, { ...emptyPerson(), core: 'x', aliases: [n.split(' ')[0]] }])) });
  const mentions = long.flatMap((d) => many.slice(0, 5).map((n) => ({ name: n, kind: 'person', source: d.id, label: d.label })));
  const t0 = performance.now();
  const index = peopleSourceIndex(big, long, mentions);
  const took = performance.now() - t0;
  eq(index.length, 60);
  assert(took < 1500, '300 pages and 60 people in ' + Math.round(took) + ' ms (it took 3,600 ms and more on a desktop)');
});

test('M752-A10 THE REPAIR LOOP PAUSES WHEN A REFUSED REPAIR IS ONLY SPELLED ANOTHER WAY: “Mira Vale”, “mira vale”, “MIRA VALE” is one target (M776: “hair”, “hair colour”, “Hair color” on a lock his hand set is no longer owed at all); a model that respells it each pass no longer counts as progress, and two such passes pause the loop; a refusal for another person is still new work', async () => {
  const id = await tale('m752-a10', [['user', 'Keir asks Mira about the barge.'], ['assistant', 'Mira Vale shrugged and said nothing about the barge.']]);
  await saveState(id, applyMutations(keir({ characters: { 'Mira Vale': { ...emptyPerson(), core: 'A clerk.' }, 'Old Tomas': { ...emptyPerson(), core: 'A ferryman.' } } }),
    [{ type: 'canon.lock', name: 'Mira Vale', key: 'hair', value: 'black', byHand: true }, { type: 'canon.lock', name: 'Old Tomas', key: 'hair', value: 'white', byHand: true }]).state);
  const story = await db.stories.get(id);
  const pages = visiblePages(await db.messages.list(id));
  const pass = async (who, key) => {
    const before = await loadState(id);
    /* M776: a write his hand holds is no longer owed (it is left as he wrote it), so the refusal that stays owed here is
     * the ledger's own — a page with records is never let go ("preserve established records") — its target the person,
     * spelled another way each pass */
    await onWire({ source: () => [], review: () => ({ issues: [{ what: 'The ledger keeps a page for her it should not', fix: 'let it go', mutations: [{ type: 'people.forget', name: who, cause: key, shown: 'Mira Vale shrugged' }] }] }) },
      () => auditLedger({ connection: CONN, storyId: id, reviewSources: 'all' }));
    const after = await loadState(id);
    assert(ledgerRepairNeeded(after, {}, story, pages, 1), 'the ledger refuses the write: repair is still owed');
    const cp = repairRetryCheckpoint(before, after, story, pages);
    await saveState(id, { ...after, audit: { ...after.audit, retryProgress: cp, pausedInput: cp.stalled >= 2 ? ledgerRepairInputKey(after, story, pages) : null, pausedPolicy: LEDGER_REPAIR_POLICY } });
    return cp;
  };
  const first = await pass('Mira Vale', 'a passer-through');
  assert(first.progress, 'the first refusal is new work');
  const second = await pass('mira vale', 'never the story’s');
  eq(second.progress, false, 'the same person spelled another way is not');
  const third = await pass('MIRA VALE', 'gone');
  eq(third.stalled, 2, 'two stalled passes');
  eq(ledgerRepairNeeded(await loadState(id), {}, story, pages, 1), false, 'and the loop pauses');
  const other = await pass('Old Tomas', 'a passer-through');
  assert(other.progress, 'a refusal about someone else is new work (M743)');
});

test('M752-A11 A LEDGER LARGER THAN ONE READING IS VERIFIED OVER READINGS, NEVER REFUSED AND NEVER APPROVED UNREAD: the entries are sent lean and as many as the request can carry; the rest stay open with the reason and are read next time, their progress kept; a review the provider refuses says why', async () => {
  const para = (chars, tag) => (tag + ' ' + 'the lamp burned low over the ledger, '.repeat(Math.ceil(chars / 37))).slice(0, chars);
  const st = keir({ page: 800, characters: {} });
  for (let i = 0; i < 40; i += 1) st.characters['Person ' + i + ' Vale'] = { ...emptyPerson(), core: 'Person ' + i + ' Vale keeps a secret. ' + para(4000, 'core'), state: para(1500, 'state'), arc: para(4000, 'arc'), threads: [para(300, 't1')], updatedAtTurn: 790, ...(i >= 34 ? { retired: true } : {}) };
  st.relationships = Object.fromEntries(Object.keys(st.characters).map((k, i) => [k, { p: i, r: i, s: 0, history: [] }]));
  st.present = Object.keys(st.characters).slice(0, 4).map((name) => ({ name }));
  const pages = [];
  for (let i = 0; i < 30; i += 1) { pages.push(['user', 'u' + i]); pages.push(['assistant', para(3000, 'page ' + i)]); }
  const id = await tale('m752-a11', pages);
  await saveState(id, st);
  const conn = { ...CONN, contextSize: 128000 };
  let sent = [], size = 0;
  const review = (user) => { sent = JSON.parse(user.split('REQUIRED CURRENT LEDGER CHECKS:\n')[1].split('\n')[0]).map((r) => r.id); return {}; };
  const total = ledgerVerificationRows(st).length;
  const r1 = await onWire({ source: () => [], review: (user) => { size = user.length; return review(user); } }, () => auditLedger({ connection: conn, storyId: id, reviewSources: 'all' }));
  const one = await loadState(id);
  assert(size > 0 && size < 360000, 'the reading was sent, inside its connection: ' + size);
  assert(sent.length > 0 && sent.length < total, 'it carried part of the entries: ' + sent.length + ' of ' + total);
  const approved = Object.keys(one.audit.verification.entries);
  assert(approved.length >= sent.length && approved.every((x) => sent.includes(x)), 'only the entries it was sent are approved');
  eq(r1.unfinished, true, 'the rest are still owed');
  assert(r1.pending.some((p) => /not read yet: the ledger is larger than one reading/.test(p)), 'and say why: ' + JSON.stringify(r1.pending).slice(0, 300));
  eq(ledgerAuditVerified(one, await db.stories.get(id), await db.messages.list(id)), false, 'not green yet');
  const story = await db.stories.get(id);
  const visible = visiblePages(await db.messages.list(id));
  let cp = null;
  const r2 = await onWire({ source: () => [], review }, async () => {
    const out = await auditLedger({ connection: conn, storyId: id, reviewSources: 'all' });
    cp = repairRetryCheckpoint(one, await loadState(id), story, visible);
    return out;
  });
  assert(!sent.some((x) => approved.includes(x)), 'the next reading reads the rest, not what was approved');
  assert(cp.progress, 'and the repair loop sees progress, never a stall');
  eq(r2.unfinished, false, 'every entry is read: ' + JSON.stringify(r2.pending).slice(0, 200));
  assert(ledgerAuditVerified(await loadState(id), story, await db.messages.list(id)), 'green');
  /* a changed ledger on a connection that cannot carry even the reading itself: refused before it is sent, and the reason is kept */
  const changed = await loadState(id);
  await saveState(id, { ...changed, characters: { ...changed.characters, 'Person 0 Vale': { ...changed.characters['Person 0 Vale'], core: 'Person 0 Vale keeps two secrets now.' } } });
  const tiny = await onWire({ source: () => [] }, () => auditLedger({ connection: { ...CONN, contextSize: 24000 }, storyId: id, reviewSources: 'all' }));
  assert(tiny.unfinished && tiny.pending.some((p) => /did not finish: The complete provider request exceeds this connection/.test(p)), 'the refusal says why: ' + JSON.stringify(tiny.pending).slice(0, 300));
});

test('M752-A12 ONE FIELD, ONE VALUE: two values for one appearance field are finished in the same conversation — the completion’s choice is written alone, whatever form the first answer wrote them in; a contradiction still standing after it is written by neither, and its entry stays open with the reason, never certified, until a later review settles it', async () => {
  const setup = async (title) => {
    const id = await tale(title, [['user', 'Keir asks Mira about the barge.'], ['assistant', 'Mira Vale shrugged and said nothing about the barge.']]);
    await saveState(id, applyMutations(keir({ characters: { 'Mira Vale': { ...emptyPerson(), core: 'A clerk.' } } }), [{ type: 'canon.lock', name: 'Mira Vale', key: 'hair', value: 'black' }]).state);
    return id;
  };
  const lock = (value) => ({ type: 'canon.lock', name: 'Mira Vale', key: 'hair', value, shown: 'Mira Vale shrugged' });
  const hair = (st) => (st.canon['Mira Vale']?.facts || []).find((f) => f.key === 'hair')?.value;
  const wrote = (st, value) => (st.log || []).some((l) => new RegExp('hair[^.]*' + value).test(l.words || ''));
  /* asked once to choose — the first answer wrote one value as an issue and another as a profile fact ("hair colour") */
  const settled = await setup('m752-a12 settled');
  let completion = '';
  const one = await onWire({ source: () => [], review: (user, calls, messages) => {
    if (calls.review === 1) return { issues: [{ what: 'Her hair is red', mutations: [lock('red')] }], profiles: [{ name: 'Mira Vale', facts: [{ key: 'hair colour', value: 'brown', shown: 'Mira Vale shrugged' }] }] };
    completion = String(messages.at(-1).content);
    return { issues: [{ what: 'Her hair, settled', mutations: [lock('auburn')] }] };
  } }, async (calls) => { const r = await auditLedger({ connection: CONN, storyId: settled, reviewSources: 'all' }); eq(calls.review, 2, 'one completion turn'); return r; });
  assert(/Conflicting writes for one appearance field/.test(completion), 'the completion is asked to choose');
  const a = await loadState(settled);
  eq(hair(a), 'auburn', 'its choice is written');
  assert(!wrote(a, 'red') && !wrote(a, 'brown'), 'and neither value it settled is written first');
  eq(one.unfinished, false, 'settled: ' + JSON.stringify(one.pending));
  /* still two values after the completion: neither is written, the entry stays open with the reason */
  const torn = await setup('m752-a12 torn');
  const two = await onWire({ source: () => [], review: () => ({ issues: [{ what: 'Her hair is two colours', mutations: [lock('red'), lock('brown')] }] }) },
    async (calls) => { const r = await auditLedger({ connection: CONN, storyId: torn, reviewSources: 'all' }); eq(calls.review, 2, 'asked once more, never a third time'); return r; });
  const b = await loadState(torn);
  eq(hair(b), 'black', 'neither value is written');
  assert(!wrote(b, 'red') && !wrote(b, 'brown'), 'nothing in the journal');
  eq(two.unfinished, true, 'the review is not finished');
  assert(two.pending.some((p) => /two different values were proposed for Mira Vale’s hair \(“red”, “brown”\); neither is saved/.test(p)), 'and says why: ' + JSON.stringify(two.pending).slice(0, 400));
  assert(!b.audit.verification.entries['characters:Mira Vale'] && !b.audit.verification.entries['canon:Mira Vale'], 'her entries are not certified');
  eq(ledgerAuditVerified(b, await db.stories.get(torn), await db.messages.list(torn)), false, 'never green');
  /* a later review that settles on one value closes it */
  const three = await onWire({ source: () => [], review: () => ({ issues: [{ what: 'Her hair is red', mutations: [lock('red')] }] }) }, () => auditLedger({ connection: CONN, storyId: torn, reviewSources: 'all' }));
  const c = await loadState(torn);
  eq(hair(c), 'red', 'the value it settles on is written');
  eq(three.unfinished, false, 'closed: ' + JSON.stringify(three.pending).slice(0, 300));
  assert(ledgerAuditVerified(c, await db.stories.get(torn), await db.messages.list(torn)), 'green');
});

const historical = (user) => JSON.parse(user.split('HISTORICAL FINDINGS WITH ACTUAL CURRENT RECORDS:\n')[1].split('\n')[0]);
test('M752-A13 A REFUSED REPAIR STAYS OPEN HOWEVER ITS WORDS ARE PHRASED: named or not, its person’s entries are not certified around it (M709), a later empty review does not erase it (M685), and it closes when its repair lands', async () => {
  const promise = { type: 'people.promise', name: 'Princess Alexia', text: 'Bring the sealed letter tomorrow.' }; /* outside the vocabulary: the engine refuses it */
  for (const what of ['Her personal promise is missing.', 'Princess Alexia’s personal promise is missing.']) {
    const id = await tale('m752-a13 ' + what, [['user', 'I wait.'], ['assistant', 'Princess Alexia promises to bring the sealed letter tomorrow.']]);
    await saveState(id, applyMutations(keir(), [{ type: 'people.set', name: 'Princess Alexia', field: 'core', text: 'Second Princess.' }]).state);
    const r1 = await onWire({ source: () => [], review: () => ({ issues: [{ what, mutations: [promise] }] }) }, () => auditLedger({ connection: CONN, storyId: id, reviewSources: 'all' }));
    eq(r1.unfinished, true, what + ' — the refused repair leaves it open');
    assert(!(await loadState(id)).audit.verification.entries['characters:Princess Alexia'], what + ' — her entry is not certified around it');
    const r2 = await onWire({ source: () => [] }, () => auditLedger({ connection: CONN, storyId: id, reviewSources: 'all' }));
    assert(r2.unfinished && r2.pending.some((x) => /promise/.test(x)), what + ' — an empty later review does not erase it: ' + JSON.stringify(r2.pending).slice(0, 200));
    const r3 = await onWire({ source: () => [], review: (user) => ({ repairs: [{ id: historical(user).find((f) => /promise/.test(f.what)).id, status: 'repair', why: 'Restore her promise.',
      mutations: [{ type: 'people.note', name: 'Princess Alexia', field: 'thread', text: 'bring the sealed letter tomorrow', shown: 'Princess Alexia promises to bring the sealed letter tomorrow.' }] }] }) },
    () => auditLedger({ connection: CONN, storyId: id, reviewSources: 'all' }));
    assert((await loadState(id)).characters['Princess Alexia'].threads.some((t) => /sealed letter/.test(t)), what + ' — the repair lands');
    eq(r3.unfinished, false, what + ' — and closes it: ' + JSON.stringify(r3.pending).slice(0, 200));
  }
});

test('M752-A14 THE REPAIR LOOP PAUSES WHEN WORK ONLY TAKES TURNS: a refused repair withdrawn and proposed again, pass after pass, beside one that never lands, is progress once — the second time round it is a stall, and the loop pauses', async () => {
  const id = await tale('m752-a14', [['user', 'Keir asks Mira about the barge.'], ['assistant', 'Mira Vale shrugged and said nothing about the barge.']]);
  await saveState(id, applyMutations(keir({ characters: { 'Mira Vale': { ...emptyPerson(), core: 'A clerk.' }, 'Old Tomas': { ...emptyPerson(), core: 'A ferryman.' } } }),
    [{ type: 'canon.lock', name: 'Mira Vale', key: 'hair', value: 'black', byHand: true }, { type: 'canon.lock', name: 'Old Tomas', key: 'hair', value: 'white', byHand: true }]).state);
  const story = await db.stories.get(id);
  const pages = visiblePages(await db.messages.list(id));
  /* M776: owed by the ledger's own refusal (a page with records is never let go), as a write his hand holds no longer is */
  const red = { what: 'The ledger keeps a page for her it should not', mutations: [{ type: 'people.forget', name: 'Mira Vale', cause: 'a passer-through', shown: 'Mira Vale shrugged' }] };
  const grey = { what: 'The ferryman’s page should go', mutations: [{ type: 'people.forget', name: 'Old Tomas', cause: 'a passer-through', shown: 'Mira Vale shrugged' }] };
  const pass = async (withdraw) => {
    const before = await loadState(id);
    await onWire({ source: () => [], review: (user) => withdraw
      ? { issues: [grey], repairs: [{ id: historical(user).find((f) => f.what === red.what).id, status: 'correct', shown: 'Mira Vale shrugged and said nothing about the barge.', why: 'Nothing on the page is about her hair.' }] }
      : { issues: [red, grey] } }, () => auditLedger({ connection: CONN, storyId: id, reviewSources: 'all' }));
    const after = await loadState(id);
    assert(ledgerRepairNeeded(after, {}, story, pages, 1), 'the ledger refuses the ferryman’s write: repair is still owed');
    const cp = repairRetryCheckpoint(before, after, story, pages);
    await saveState(id, { ...after, audit: { ...after.audit, retryProgress: cp, pausedInput: cp.stalled >= 2 ? ledgerRepairInputKey(after, story, pages) : null, pausedPolicy: LEDGER_REPAIR_POLICY } });
    return { cp, after };
  };
  const one = await pass(false);
  assert(one.cp.progress, 'the first refusals are new work');
  const two = await pass(true);
  assert(!two.after.audit.unresolved.some((f) => f.what === red.what), 'her finding is withdrawn with its source');
  assert(two.cp.progress, 'and that is progress, once');
  const three = await pass(false);
  eq(three.cp.progress, false, 'proposed again, it is no new work');
  const four = await pass(true);
  eq(four.cp.stalled, 2, 'withdrawn again, no progress either: two stalled passes');
  eq(ledgerRepairNeeded(await loadState(id), {}, story, pages, 1), false, 'and the loop pauses');
});

test('M752-A15 THE AUDIT KEEPS ONLY THE DECISIONS IT CAN STILL READ: a source-fact decision for a section and core as they stand is kept, one for a page since changed is let go, and the identity history drops a section that is gone — the audit is copied into every checkpoint', async () => {
  const text = 'Mira Vale is a clerk with ink on her fingers.';
  const id = await tale('m752-a15', [['user', 'I wait.'], ['assistant', text]]);
  const doc = auditSources({ messages: await db.messages.list(id) }).find((d) => d.text.includes('ink'));
  const mention = { name: 'Mira Vale', kind: 'person', shown: text, identityFacts: [{ text: 'a clerk with ink on her fingers', shown: text }], facts: [] };
  const st = keir({ characters: { 'Mira Vale': { ...emptyPerson(), core: 'A clerk with ink on her fingers.' } },
    auditSources: { [doc.id]: { mark: doc.mark, appearanceReviewed: true, profileReviewed: 1, people: [mention] } } });
  const live = sourceFactScope(st, { ...mention, source: doc.id });
  const dead = sourceFactScope({ ...st, auditSources: { [doc.id]: { ...st.auditSources[doc.id], mark: 'an older text' } } }, { ...mention, source: doc.id });
  st.audit = { sourceFactDecisions: { [live]: { why: 'Her core says so.' }, [dead]: { why: 'Read at the page’s older text.', shown: 'an older passage' } },
    identityDispositionHistory: [{ id: 'here', sourceId: doc.id, name: 'Mira Vale' }, { id: 'gone', sourceId: 'page:a-page-since-deleted:0', name: 'Mira Vale' }] };
  await saveState(id, st);
  const r = await onWire({ source: () => [] }, () => auditLedger({ connection: CONN, storyId: id, reviewSources: 'all' }));
  const after = (await loadState(id)).audit;
  eq(r.unfinished, false, 'the audit completes: ' + JSON.stringify(r.pending).slice(0, 200));
  assert(after.sourceFactDecisions[live], 'the decision it can still read is kept');
  assert(!after.sourceFactDecisions[dead], 'the one for the older text is let go');
  eq(after.identityDispositionHistory.map((e) => e.id).join(','), 'here', 'and the history keeps only sections that exist');
});
