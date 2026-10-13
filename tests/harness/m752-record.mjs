/* Cozy Tavern — harness laws of M752: THE RECORD KEEPER, THE CONTINUOUS AUDIT'S CORRECTIONS AND THE LAMP, after the review of
 * M682–M751. Each law runs the real code (the keeper's run with a provider mocked at the wire, the record's own doors, the
 * request as the storyteller is sent it, the shared health inventory) and holds what comes back:
 *   R1–R3  one line or one page the keeper cannot read never stops the record, and is asked for a bounded number of times;
 *   R4     an idle repair waiting out its pause never holds the others back;
 *   R5–R6  a squeeze across an empty marker keeps the merged line bound, and never swallows an open historical correction;
 *   R7     a line kept over pages that changed (his own, or any where the keeper is off) stands on its own words and rides —
 *          through every door (R7b), and for a keeper-off tale an older build left unbound, when it opens (R7c);
 *   R8     the Housekeeper's spelling correction and its take-back keep the record bound (a child process: see the fixture);
 *   R9     a branch's record names the branch's own pages;
 *   R10    a recovery that stepped aside for the storyteller spends no attempt;
 *   R11    the lamp is not yellow where no audit is owed, and not blue for the continuous audit reading on alone;
 *   R12    a historical correction's pages move with its line (and the page it is said of);
 *   R13    the Housekeeper's re-ink of a page under a line, in a tale whose keeper is off, leaves the line riding;
 *   R14    a squeezed line read again keeps the continuous audit's corrections, open and settled;
 *   R15    nothing in a branch names the parent's pages: the audit's notes on them, a line's provenance, its reservations;
 *   R16    a line in his own words is never read again by itself;
 *   R17    a record correction read from part of a line is still reviewed when the line shrinks to its pages.
 * New code is reached through module namespaces, so this file loads against an older tree and each law fails on its own. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { db } from '../../js/store.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { buildRequest, pageText } from '../../js/assemble/stack.js';
import { fingerprint36 } from '../../js/engine/fingerprint.js';
import * as continuous from '../../js/agents/continuous.js';
import { sourceBindings, sourceBindingIssues, boundRecord } from '../../js/assemble/selection.js';
import { loadMemory, saveMemory, renderMemory, maybeSummarize, dueRange, memoryAfterDeletion, memoryAfterInsertion, memoryTruncatedAt, memoryWithoutPage, keeperTrouble } from '../../js/agents/memory.js';
import * as memory from '../../js/agents/memory.js';
import * as health from '../../js/agents/health.js';
import { auditStretch, auditWaits, auditProgress, beginReading, endReading, pauseContinuousAudit, RECOVERY_DELAY, recoveryWords, nextStretch } from '../../js/agents/continuous.js';
import { stageProposals, applyProposal } from '../../js/agents/housekeeper.js';

const KEEPER = { id: 'm752-keeper', type: 'openai', baseUrl: 'https://m752.fixture/v1', model: 'fixture', apiKey: 'fixture', contextSize: 200000, maxTokens: 32000, reasoning: { effort: 'off' } };
const wireOf = (r) => [...(r.systemBlocks || []).map((b) => (typeof b === 'string' ? b : b.text)), ...r.messages.map((m) => String(m.content))].join('\n');
const userOf = (init) => { try { return (JSON.parse(init.body || '{}').messages || []).filter((m) => m.role === 'user').map((m) => String(m.content)).join('\n'); } catch (err) { return ''; } };
const sse = (text) => new Response([{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]
  .map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join('') + 'data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
const refusal = () => new Response(JSON.stringify({ error: { message: 'Content Exists Risk' } }), { status: 400, headers: { 'content-type': 'application/json' } });

/* a provider at the wire: `answer(user)` gives the words, or a Response; counts every call; put back after the law */
async function withWire(answer, run) {
  const was = globalThis.fetch;
  const wire = { calls: 0 };
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).startsWith('/api/relay')) return new Response('no', { status: 404 });
    wire.calls += 1;
    const said = answer(userOf(init));
    return said instanceof Response ? said : sse(said);
  };
  try { return await run(wire); } finally { globalThis.fetch = was; }
}
/* the house-wide settings a law sets are put back as they were */
async function withSettings(values, run) {
  const was = {};
  for (const k of Object.keys(values)) { was[k] = await db.settings.get(k); await db.settings.set(k, values[k]); }
  try { return await run(); } finally { for (const k of Object.keys(values)) { if (was[k] === undefined) await db.settings.delete(k); else await db.settings.set(k, was[k]); } }
}
async function tale(title, count, page = (i) => (i % 2 ? '[Dawn, chapel] Neri and Mara speak of the copper key, page ' : 'Neri asks, page ') + i, extra = {}) {
  const story = await db.stories.create({ title });
  await db.stories.update(story.id, { keeper: true, ...extra });
  for (let i = 0; i < count; i += 1) await db.messages.append(story.id, { id: story.id + ':p' + i, ts: 1000 + i, role: i % 2 ? 'assistant' : 'user', text: page(i) });
  return story;
}
const visible = async (id) => (await db.messages.list(id)).filter((m) => !m.hidden);
const request = (messages, nodes, keeperOn = true) => buildRequest({ story: { brief: 'A story.' }, messages, settings: {}, state: { ...emptyState(), page: 20 }, modules: [],
  memory: renderMemory({ nodes }, 400000), window: { keeperOn, window: 8, budgetTokens: 262000, nodes } });

/* ---------- R1–R3: the record can never stay stuck (M316), now for a line read again and for a refused page ---------- */

async function oneLineTheKeeperCannotRead(kind) {
  const story = await tale('M752-R1 ' + kind, 30);
  let pages = await visible(story.id);
  const L0 = { id: 'L0', span: [0, 5], text: '[Dawn, chapel] Neri promised Mara the copper key.', level: 1, whole: true, sourcePages: sourceBindings(pages.slice(0, 6)) };
  await saveMemory(story.id, { window: 10, nodes: [L0] });
  /* the writer edits page 4 (inside L0) into words the keeper's model will not write a line for */
  await db.messages.update(story.id, pages[3].id, { text: 'REFUSED-WORDS the edited page.' });
  pages = await visible(story.id);
  eq(JSON.stringify(sourceBindingIssues([L0], pages).map((i) => i.kind)), '["edited"]', kind + ': the edited line is unbound before the run');
  eq(JSON.stringify(dueRange(pages.length, 10, [L0], 6)), '[6,12]', kind + ': pages 7–12 are due');
  return withSettings({ memoryWindow: 10, memoryBatch: 6, memoryKeeper: true }, () => withWire((user) => {
    if (user.includes('REFUSED-WORDS')) return kind === 'refused' ? refusal() : "I'm sorry, but I can't help with that.";
    return '[Dawn, chapel] Neri promised Mara the copper key and the letter.';
  }, async (wire) => {
    const runs = [];
    for (let run = 1; run <= 4; run += 1) {
      const before = wire.calls;
      let threw = '';
      try { await maybeSummarize({ connection: KEEPER, storyId: story.id }); } catch (err) { threw = err.message; }
      const mem = await loadMemory(story.id);
      runs.push({ threw, calls: wire.calls - before, trouble: keeperTrouble(), due: dueRange(pages.length, 10, mem.nodes, 6), line: mem.nodes.find((n) => n.id === 'L0') });
    }
    return { story, pages, runs };
  }));
}
async function holdsTheRecordMovingOn(kind) {
  const { story, pages, runs } = await oneLineTheKeeperCannotRead(kind);
  eq(runs[0].threw, '', kind + ': the keeper run does not throw because one line cannot be read again (the queue tried a page\'s keeper five times over)');
  eq(runs[0].due, null, kind + ': the pages that were due are folded in the same run — nothing after the line waits on it');
  assert(/could not be read again/.test(runs[0].trouble), kind + ': the run says what it could not do: ' + runs[0].trouble);
  eq(runs[0].line.sourceTries, 1, kind + ': the failed run is counted on the line itself');
  eq(runs[1].line.sourceTries, 2, kind + ': a second run, a second count');
  assert(Array.isArray(runs[1].line.sourcePages), kind + ': still bound after two runs — it is asked for again');
  const kept = runs[2].line;
  eq(kept.sourcePages, undefined, kind + ': after ' + memory.SOURCE_TRIES + ' runs (its model answering other questions) the line stands on its own words');
  eq(kept.text, '[Dawn, chapel] Neri promised Mara the copper key.', kind + ': its words kept exactly');
  eq((kept.sourceOrigins || []).length, 6, kind + ': its old receipts are its provenance');
  eq(runs[3].calls, 0, kind + ': and it is asked for no more — a run after costs nothing');
  eq(sourceBindingIssues((await loadMemory(story.id)).nodes, pages).length, 0, kind + ': nothing in the record is left unbound');
  const mem = await loadMemory(story.id);
  assert(boundRecord(mem.nodes.find((n) => n.id === 'L0'), pages), kind + ': the line rides with the request again (selection.js boundRecord)');
  assert(wireOf(request(pages, mem.nodes)).includes('Neri promised Mara the copper key.'), kind + ': and its words are on the wire');
}

test('M752-R1 ONE LINE ITS KEEPER GIVES NO LINE FOR NEVER STOPS THE RECORD (M745 made every fold wait for it): the due pages fold in the same run, the line is asked for on three runs, counted on the line, then stands on its own words and rides; nothing more is paid for it', async () => {
  await holdsTheRecordMovingOn('no line');
});

test('M752-R2 ONE LINE WHOSE WORDS THE PROVIDER REFUSES (a 400) NEVER STOPS THE RECORD: the run does not throw (the page chain tried it five times, every page), the due pages fold, and the line is asked for at most three runs', async () => {
  await holdsTheRecordMovingOn('refused');
});

test('M752-R3 A PAGE WHOSE WORDS THE PROVIDER REFUSES, DUE TO BE FOLDED, IS M316\'S PAGE TOO: asked alone, covered without words the second run it is refused alone (its model answering a one-word question), the record folds on past it; asked again by itself at most three times, then never', async () => {
  const story = await tale('M752-R3', 30, (i) => (i === 8 ? 'REFUSED-WORDS on page nine, ' : '') + (i % 2 ? '[Dawn, chapel] the bell rang, page ' : 'Neri waits, page ') + i);
  const pages = await visible(story.id);
  await saveMemory(story.id, { window: 10, nodes: [] });
  await withSettings({ memoryWindow: 10, memoryBatch: 6, memoryKeeper: true }, () => withWire((user) => (user.includes('REFUSED-WORDS') ? refusal() : '[Dawn, chapel] Neri waited while the bell rang.'), async (wire) => {
    /* run 1 folds pages 1–8 around it (each batch that holds page 9 refused, the oldest page asked alone); runs 2 and 3 each
     * find page 9 refused alone — the second time, its model answering a one-word question, the house covers it */
    for (let run = 1; run <= 3; run += 1) {
      let threw = '';
      try { await maybeSummarize({ connection: KEEPER, storyId: story.id }); } catch (err) { threw = err.message; }
      eq(threw, '', 'a refusal of a due page is no stop for the whole record (run ' + run + ')');
    }
    let mem = await loadMemory(story.id);
    const cover = mem.nodes.find((n) => n.span[0] === 8 && n.span[1] === 8);
    assert(cover && cover.byHouse === true && cover.empty === true, 'page 9 is covered without words by the house: ' + JSON.stringify(mem.nodes.map((n) => [n.span, n.byHouse || false])));
    for (let run = 0; run < 3; run += 1) await maybeSummarize({ connection: KEEPER, storyId: story.id });
    mem = await loadMemory(story.id);
    eq(dueRange(pages.length, 10, mem.nodes, 6), null, 'every page past the window is folded');
    for (let run = 0; run < 4; run += 1) await maybeSummarize({ connection: KEEPER, storyId: story.id });
    mem = await loadMemory(story.id);
    const again = mem.nodes.find((n) => n.span[0] === 8 && n.byHouse === true);
    assert(again && (again.healTries || 0) >= memory.COVER_TRIES, 'asked again by itself, and each refusal counted: ' + JSON.stringify(again));
    const before = wire.calls;
    await maybeSummarize({ connection: KEEPER, storyId: story.id });
    eq(wire.calls - before, 0, 'a page its model truly will not read is not asked for for ever');
  }));
});

/* ---------- R4: an idle repair that is waiting never holds the others back ---------- */

test('M752-R4 THE HOUSE SENDS THE NEXT OWNER WHILE ONE WAITS OUT ITS PAUSE (M727 sent only the first): a record its keeper cannot fold yet, or a keeper with no connection, no longer holds back the ledger\'s missed pages, a failed worker or the continuous audit; the issue is still said', async () => {
  const conditions = { storyId: 'm752-r4', shelf: {}, state: {}, pages: [], recordBehind: true, ledgerBehind: true, auditRead: { done: 6, folded: 12, left: 6, open: 0, unresolved: [] }, historicalWait: 0 };
  eq(health.healthSnapshot(conditions).next, 'record', 'a record the keeper can fold now is sent first, as before');
  const waiting = health.healthSnapshot({ ...conditions, recordWait: 60000 });
  eq(waiting.next, 'ledger', 'the keeper waiting out its pause: the ledger\'s readers are sent meanwhile');
  assert(waiting.issues.some((i) => i.id === 'record-gap' && i.route === null), 'and the record gap is still said, with no one sent for it now');
  eq(health.healthSnapshot({ ...conditions, recordWait: Infinity, ledgerWait: Infinity }).next, 'historical', 'a keeper with no connection and readers waiting: the continuous audit reads on');
});

/* ---------- R5–R6: the squeeze across an empty marker ---------- */

async function squeezeTale(title, markerExtra = {}) {
  const story = await tale(title, 20, (i) => (i % 2 ? '[Dawn, chapel] Neri and Mara speak of the copper key and the letter, page ' : 'Neri asks about the key, page ') + i);
  const pages = await visible(story.id);
  const line = (id, a, b, text, extra = {}) => ({ id, span: [a, b], text, level: 1, at: 1000 + a, whole: true, sourcePages: sourceBindings(pages.slice(a, b + 1)), ...extra });
  const nodes = [
    line('A', 0, 1, '[Dawn, chapel] Neri promised Mara the copper key; Mara owes the letter.', { audited: 2, correctionReviewed: true }),
    line('E', 2, 3, '', { empty: true, audited: 2, correctionReviewed: true, ...markerExtra }),
    line('B', 4, 5, '[Dawn, chapel] Ivo watched Neri and Mara at the chapel door; the letter stays unopened.', { audited: 2, correctionReviewed: true }),
    line('C', 6, 7, '[Dawn, chapel] Mara left for the river; Neri kept the key.'),
  ];
  await saveMemory(story.id, { window: 12, nodes });
  return { story, pages, nodes };
}
const squeezeWire = (user) => (/being merged into ONE line/.test(user)
  ? '- [Dawn, chapel] (pages 1 to 6) Neri promised Mara the copper key; Mara owes Neri the unopened letter before sunset; Ivo watched them both at the chapel door.'
  : 'NONE');

test('M752-R5 A SQUEEZE ACROSS AN EMPTY MARKER IS BOUND TO EVERY PAGE IT COVERS (M737 left the marker\'s pages out: a line over six pages with four receipts was dropped from the request and read apart again, paid, losing what the continuous audit had read): the merged line rides, the next run costs nothing, its mark stays', async () => {
  const { story, pages } = await squeezeTale('M752-R5');
  await withSettings({ memoryWindow: 12, memoryBatch: 6, memoryKeeper: true, memorySqueeze: 'auto' }, () => withWire(squeezeWire, async (wire) => {
    await maybeSummarize({ connection: KEEPER, storyId: story.id, recordRoomChars: 10 });
    let mem = await loadMemory(story.id);
    const merged = mem.nodes.find((n) => n.level === 2);
    assert(merged, 'the oldest two lines and the marker between them are squeezed into one: ' + JSON.stringify(mem.nodes.map((n) => [n.id, n.span])));
    eq(JSON.stringify(merged.span), '[0,5]', 'over pages 1 to 6');
    eq((merged.sourcePages || []).length, 6, 'bound to all six pages, the marker\'s two among them');
    eq(sourceBindingIssues(mem.nodes, pages).length, 0, 'no line of the record is unbound');
    assert(boundRecord(merged, pages) && wireOf(request(pages, mem.nodes)).includes('Ivo watched them both at the chapel door'), 'the merged line rides with the request');
    eq(merged.audited, 6, 'what the continuous audit had read stays read under it');
    const before = wire.calls;
    await maybeSummarize({ connection: KEEPER, storyId: story.id, recordRoomChars: 1000000 });
    eq(wire.calls - before, 0, 'the next run reads nothing apart again');
    mem = await loadMemory(story.id);
    eq(mem.nodes.find((n) => n.id === merged.id)?.audited, 6, 'and the mark is still there');
  }));
});

test('M752-R6 AN EMPTY MARKER WITH A HISTORICAL CORRECTION OPEN ON IT IS NEVER SQUEEZED AWAY: the correction stays open, on its marker (it went with the marker, unresolved and unsaid); lines elsewhere still squeeze', async () => {
  const open = [{ issue: { target: 'unknown', what: 'Page 3 may contradict the brief about the key.' }, why: 'The fault needs grounded story versus record classification.', from: 2, to: 3 }];
  const { story, pages, nodes } = await squeezeTale('M752-R6', { auditOpen: open });
  eq(auditProgress({ nodes }, pages.length, pages).open, 1, 'one correction is open before');
  await withSettings({ memoryWindow: 12, memoryBatch: 6, memoryKeeper: true, memorySqueeze: 'auto' }, () => withWire(squeezeWire, async () => {
    await maybeSummarize({ connection: KEEPER, storyId: story.id, recordRoomChars: 10 });
    const mem = await loadMemory(story.id);
    eq(auditProgress(mem, pages.length, pages).open, 1, 'and still open after the squeeze');
    const marker = mem.nodes.find((n) => n.id === 'E');
    assert(marker && marker.auditOpen?.length === 1, 'on its own marker');
    assert(!mem.nodes.some((n) => n.level === 2 && n.span[0] <= 2 && n.span[1] >= 3), 'no merged line claims the marker\'s pages');
  }));
});

/* ---------- R7: a line kept over pages that changed stands on its own words ---------- */

test('M752-R7 A LINE THAT STAYS OVER PAGES THAT CHANGED RIDES (M680 keeps it where no keeper folds again; M737\'s receipts dropped it from the request for good): keeper off — a page let go, one brought back, a rewind, an edit; keeper on — his own line over an edited page', async () => {
  const msgs = [];
  for (let i = 0; i < 40; i += 1) msgs.push({ id: 'r7-' + i, role: i % 2 ? 'assistant' : 'user', text: (i % 2 ? '[Yard] STORY-' : 'MOVE-') + i + ' words words words.' });
  const L0 = { id: 'L0', span: [0, 5], level: 1, text: 'LINE-ZERO Rukia promised Jovan the blade.', sourcePages: sourceBindings(msgs.slice(0, 6)) };
  const L1 = { id: 'L1', span: [6, 11], level: 1, text: 'LINE-ONE Zaraki named noon for the duel.', sourcePages: sourceBindings(msgs.slice(6, 12)) };
  const nobodyFolds = { keepCovering: () => true }; /* chat.js recordCutRule, for a tale whose keeper is off */
  const rides = (label, nodes, messages, keeperOn = false) => {
    const line = nodes.find((n) => n.id === 'L1');
    assert(line, label + ': the line is kept');
    eq(sourceBindingIssues(nodes, messages).length, 0, label + ': nothing unbound');
    assert(boundRecord(line, messages), label + ': the line is not held to receipts its pages no longer match');
    assert(wireOf(request(messages, nodes, keeperOn)).includes('LINE-ONE'), label + ': its words are on the wire');
    eq((line.sourceOrigins || []).length, 6, label + ': its old receipts kept as provenance');
  };
  assert(wireOf(request(msgs, [L0, L1], false)).includes('LINE-ONE'), 'before: the line rides');
  rides('a page let go', memoryAfterDeletion({ nodes: [L0, L1] }, 8, nobodyFolds).nodes, msgs.filter((_, i) => i !== 8));
  rides('a page brought back', memoryAfterInsertion({ nodes: [L0, L1] }, 8, nobodyFolds).nodes, [...msgs.slice(0, 8), { id: 'r7-back', role: 'user', text: 'MOVE-back words.' }, ...msgs.slice(8)]);
  const cut = memoryTruncatedAt({ nodes: [L0, L1] }, 9, nobodyFolds).nodes;
  rides('a rewind', cut, msgs.slice(0, 9));
  const edited = msgs.map((m, i) => (i === 8 ? { ...m, text: 'MOVE-8 edited by the writer.' } : m));
  rides('an edit, keeper off', memoryWithoutPage({ nodes: [L0, L1] }, 8, nobodyFolds).nodes, edited);
  const his = { ...L1, verified: { at: 1, fixed: 'the writer' } };
  const kept = memoryWithoutPage({ nodes: [L0, his] }, 8).nodes;
  rides('his own line over an edited page, keeper on', kept, edited, true);
  eq(memoryWithoutPage({ nodes: [L0, L1] }, 8).nodes.some((n) => n.id === 'L1'), false, 'the keeper\'s own line over an edited page is still let go where a keeper folds it again (M675)');
});

test('M752-R7b ONE RULE FOR EVERY DOOR THAT CHANGES A PAGE\'S WORDS (memory.js recordAfterPageChange, run by every such door in chat.js): keeper off, the line stays and rides; keeper on, the keeper\'s line is let go and his own stays and rides', async () => {
  for (const keeper of [false, true]) {
    const story = await tale('M752-R7b keeper ' + (keeper ? 'on' : 'off'), 20, (i) => (i % 2 ? '[Yard] STORY-' : 'MOVE-') + i + ' words.', { keeper });
    let pages = await visible(story.id);
    const nodes = [
      { id: 'K', span: [0, 5], level: 1, text: 'KEEPER-LINE the drill began.', sourcePages: sourceBindings(pages.slice(0, 6)) },
      { id: 'H', span: [6, 11], level: 1, text: 'HIS-LINE Zaraki named noon.', verified: { at: 1, fixed: 'the writer' }, sourcePages: sourceBindings(pages.slice(6, 12)) },
    ];
    await saveMemory(story.id, { window: 10, nodes });
    await db.messages.update(story.id, pages[2].id, { text: 'MOVE-2 corrected by the writer.' });
    await db.messages.update(story.id, pages[8].id, { text: 'MOVE-8 corrected by the writer.' });
    await memory.recordAfterPageChange(story.id, 2);
    await memory.recordAfterPageChange(story.id, 8);
    pages = await visible(story.id);
    const mem = await loadMemory(story.id);
    const wire = wireOf(request(pages, mem.nodes, keeper));
    eq(sourceBindingIssues(mem.nodes, pages).length, 0, 'keeper ' + (keeper ? 'on' : 'off') + ': nothing unbound');
    eq(mem.nodes.some((n) => n.id === 'K'), !keeper, 'keeper ' + (keeper ? 'on: its own line is let go, to be folded again' : 'off: the line stays'));
    if (!keeper) assert(wire.includes('KEEPER-LINE'), 'keeper off: and rides');
    assert(mem.nodes.some((n) => n.id === 'H') && wire.includes('HIS-LINE'), 'keeper ' + (keeper ? 'on' : 'off') + ': his line stays and rides');
  }
});

test('M752-R7c A KEEPER-OFF TALE\'S LINES AN OLDER BUILD LEFT UNBOUND ARE SETTLED WHEN IT OPENS, IN CODE (nothing repaired them: no keeper runs, and the lamp was green): an edited page\'s line and a page-short line stand on their own words, a line whose pages only moved moves with them (its open correction too), a line past the end ends with it — all ride; a tale whose keeper is on is left to its keeper', async () => {
  for (const keeper of [false, true]) {
    const story = await tale('M752-R7c keeper ' + (keeper ? 'on' : 'off'), 20, (i) => (i % 2 ? '[Yard] STORY-' : 'MOVE-') + i + ' words.', { keeper });
    let pages = await visible(story.id);
    const f = { issue: { target: 'record', what: 'The captain attribution may be wrong.' }, why: 'Needs source review.', from: 14, to: 15 };
    const nodes = [
      { id: 'E', span: [0, 3], level: 1, text: 'EDITED-LINE the drill began.', sourcePages: sourceBindings(pages.slice(0, 4)) },
      { id: 'S', span: [4, 7], level: 1, text: 'SHORT-LINE a page was let go under it.', sourcePages: sourceBindings(pages.slice(4, 9)) },
      { id: 'M', span: [13, 16], level: 1, text: 'MOVED-LINE Zaraki named noon.', auditOpen: [f], sourcePages: sourceBindings(pages.slice(12, 16)) },
      { id: 'P', span: [17, 21], level: 1, text: 'PAST-LINE the night came.', sourcePages: sourceBindings(pages.slice(17, 20)) },
    ];
    await saveMemory(story.id, { window: 10, nodes });
    await db.messages.update(story.id, pages[2].id, { text: 'MOVE-2 corrected by the writer.' });
    pages = await visible(story.id);
    eq(sourceBindingIssues((await loadMemory(story.id)).nodes, pages).map((i) => i.kind).join(' '), 'edited binding-shape relocated rewound', 'four kinds of unbound line before');
    const wrote = await memory.settleRecordWithoutKeeper(story.id);
    const mem = await loadMemory(story.id);
    if (keeper) { eq(wrote, false, 'keeper on: left to its keeper (repairInvalidRecordSources)'); eq(sourceBindingIssues(mem.nodes, pages).length, 4, 'nothing settled here'); continue; }
    eq(wrote, true, 'keeper off: settled');
    eq(sourceBindingIssues(mem.nodes, pages).length, 0, 'no line unbound');
    const by = (id) => mem.nodes.find((n) => n.id === id);
    assert(by('E').sourcePages === undefined && by('E').sourceOrigins.length === 4 && by('E').text === nodes[0].text, 'the edited page\'s line stands on its own words');
    assert(by('S').sourcePages === undefined && by('S').sourceOrigins.length === 5, 'the page-short line too');
    eq(JSON.stringify(by('M').span), '[12,15]', 'the moved line moves with its pages');
    eq(JSON.stringify(by('M').auditOpen.map((x) => [x.from, x.to])), '[[13,14]]', 'and its open correction with it');
    eq(JSON.stringify(by('P').span), '[17,19]', 'the line past the end ends with the tale');
    const wire = wireOf(request(pages, mem.nodes, false));
    assert(['EDITED-LINE', 'SHORT-LINE', 'MOVED-LINE', 'PAST-LINE'].every((w) => wire.includes(w)), 'every line rides: ' + ['EDITED-LINE', 'SHORT-LINE', 'MOVED-LINE', 'PAST-LINE'].filter((w) => !wire.includes(w)).join(', '));
    eq(await memory.settleRecordWithoutKeeper(story.id), false, 'settled once: nothing written on the next open');
  }
});

/* ---------- R8: the Housekeeper's spelling correction, and its take-back ---------- */

test('M752-R8 THE HOUSEKEEPER\'S SPELLING CORRECTION KEEPS THE RECORD BOUND (it rewrote the record\'s words with the pages and left every line\'s receipts naming the old words: 3 of 3 lines unbound, dropped from the request, read again by the keeper); its take-back too, and a line folded since from the corrected words', async () => {
  const child = fileURLToPath(new URL('./fixtures/m752-spelling.mjs', import.meta.url));
  const out = spawnSync(process.execPath, [child], { encoding: 'utf8', timeout: 60000 });
  assert(out.status === 0, 'the fixture ran: ' + (out.stderr || '').slice(-600));
  const r = JSON.parse(String(out.stdout).trim().split('\n').pop());
  eq(r.applied.applied, 1, 'the correction landed: ' + r.applied.words);
  assert(/Jovan drills/.test(r.pageText) && r.afterApply.texts.every((t) => /^Jovan /.test(t)), 'pages and record both corrected');
  eq(JSON.stringify(r.afterApply.issues), '[]', 'no line unbound after the correction');
  eq(r.afterApply.bound.join(' '), 'L0 L1 L2', 'every line rides');
  eq(r.afterApply.audited.join(' '), '6 6 6', 'what the continuous audit had read stays read');
  assert(r.undo.ok, 'taken back: ' + r.undo.words);
  assert(/Jovn drills/.test(r.pageTextAfterUndo), 'the pages have their old words');
  eq(JSON.stringify(r.afterUndo.issues), '[]', 'no line unbound after the take-back');
  eq(r.afterUndo.bound.join(' '), 'L0 L1 L2 L3', 'every line rides — the one folded after the correction too');
});

/* ---------- R9: a branch's record names the branch's own pages ---------- */

test('M752-R9 A BRANCH\'S RECORD NAMES ITS OWN PAGES (its receipts named the parent\'s: every line unbound, dropped from the branch\'s requests and read again by its keeper, three a run, paid): every line rides at once, the keeper reads nothing again, and a settled correction stays settled', async () => {
  const parent = await tale('M752-R9 parent', 24);
  const pp = await visible(parent.id);
  const nodes = [0, 1, 2].map((k) => ({ id: 'B' + k, span: [k * 6, k * 6 + 5], level: 1, text: 'BRANCH-LINE-' + k + ' Neri kept the key.', whole: true, audited: 6, correctionReviewed: true, sourcePages: sourceBindings(pp.slice(k * 6, k * 6 + 6)) }));
  const page = pp[1];
  nodes[0].auditRecovery = [{ id: 'settled', outcome: 'correct', recordId: 'B0', sources: [{ id: page.id, mark: (await import('../../js/engine/fingerprint.js')).fingerprint36(page.text) }],
    evidence: [{ source: page.id, shown: 'Neri and Mara speak' }], finding: { id: 'settled', from: 0, to: 5, issue: { what: 'An allegation the original disproved.' } }, at: 1 }];
  /* the branch: every page copied whole with a new id (chat.js branchFrom, db.messages.copy), and the parent then moves on */
  const branch = await db.stories.create({ title: 'M752-R9 branch' });
  await db.stories.update(branch.id, { keeper: true });
  const idMap = {};
  for (const m of pp) { const copy = { ...m }; delete copy.id; delete copy.storyId; const saved = await db.messages.copy(branch.id, copy); idMap[m.id] = saved.id; }
  await db.messages.update(parent.id, pp[3].id, { text: 'The parent tale went on differently, page 3.' });
  await saveMemory(branch.id, memory.branchRecord({ window: 10, nodes }, idMap));
  const bp = await visible(branch.id);
  const mem = await loadMemory(branch.id);
  eq(sourceBindingIssues(mem.nodes, bp).length, 0, 'no line of the branch is unbound');
  assert(mem.nodes.every((n) => boundRecord(n, bp)), 'every line rides with the branch\'s request');
  assert([0, 1, 2].every((k) => wireOf(request(bp, mem.nodes)).includes('BRANCH-LINE-' + k)), 'their words are on the wire');
  /* (the coordinator's follow-up: the parent's receipts are no longer kept beside them as provenance — nothing in a branch
   * names the parent's pages; R15 holds the rest of the branch to it) */
  assert(!pp.some((p) => JSON.stringify(mem).includes(p.id)), 'nothing in the branch\'s record names a parent page');
  eq(auditProgress(mem, bp.length, bp).open, 0, 'a correction settled in the parent is not reopened in the branch');
  await withSettings({ memoryWindow: 10, memoryBatch: 6, memoryKeeper: true }, () => withWire(() => '[Dawn, chapel] a line.', async (wire) => {
    const r = await memory.repairInvalidRecordSources({ connection: KEEPER, storyId: branch.id });
    assert(r.ok && !r.remaining, 'the keeper finds nothing to repair: ' + JSON.stringify(r));
    eq(wire.calls, 0, 'and pays for nothing');
  }));
});

/* ---------- R10: a recovery that steps aside spends no attempt ---------- */

test('M752-R10 A HISTORICAL CORRECTION\'S RECOVERY THAT STEPS ASIDE SPENDS NO ATTEMPT (M675: a step aside for the storyteller is no failure; two sends during a recovery spent both of M723\'s attempts with no answer read, the correction stranded "at the attempt limit"); a recovery that truly fails is still counted', async () => {
  const original = 'The man in travel-dark clothing watched from the yard door. Corven knocked twice and announced Jugram.';
  const s = await db.stories.create({ title: 'M752-R10 interrupted recovery' });
  await db.messages.append(s.id, { role: 'assistant', text: original });
  const broken = { target: 'record', what: 'The captain attribution may be wrong.', record: { fixes: [] } };
  await saveMemory(s.id, { window: 12, nodes: [{ id: 'line', span: [0, 0], text: "Prince William's captain watched from the yard door; Corven knocked twice and announced Jugram.", level: 1, whole: true, audited: 1, correctionReviewed: true,
    auditOpen: [{ issue: broken, why: 'Missing replacement text.', from: 0, to: 0 }] }] });
  const was = globalThis.fetch, clock = Date.now;
  let now = clock(); Date.now = () => now;
  let calls = 0;
  globalThis.fetch = (url, init) => new Promise((resolve, reject) => {
    if (String(url).startsWith('/api/relay')) return resolve(new Response('no', { status: 404 }));
    calls += 1;
    const sig = init && init.signal; const fail = () => reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
    if (sig && sig.aborted) return fail();
    if (sig) sig.addEventListener('abort', fail, { once: true });
  });
  try {
    for (let send = 1; send <= 2; send += 1) {
      const base = calls;
      const own = beginReading(s.id, null);
      const reading = auditStretch({ connection: KEEPER, storyId: s.id, signal: own.signal });
      for (let i = 0; i < 400 && calls === base; i += 1) await new Promise((r) => setTimeout(r, 5));
      assert(calls > base, 'the recovery asked its model (send ' + send + ')');
      assert(pauseContinuousAudit(s.id), 'and stepped aside for the storyteller');
      await reading.catch(() => null);
      endReading(s.id, own);
      now += RECOVERY_DELAY + 1;
    }
    const m = await loadMemory(s.id);
    const pages = await db.messages.list(s.id);
    const f = m.nodes[0].auditOpen[0];
    assert(!f.recovery || !(f.recovery.attempts > 0), 'no attempt was spent: ' + JSON.stringify(f.recovery));
    eq(auditWaits(s.id, m, pages), 0, 'the correction can be tried now');
    const prog = auditProgress(m, pages.length, pages);
    eq(prog.pending, 1, 'and is still queued for its bounded recovery');
    assert(!/attempt limit is reached/.test(recoveryWords({ ...prog, recovery: null })), 'the lamp does not say the limit is reached');
    /* a recovery whose provider truly fails is still one attempt */
    globalThis.fetch = async (url) => (String(url).startsWith('/api/relay') ? new Response('no', { status: 404 }) : new Response('down', { status: 500 }));
    await auditStretch({ connection: KEEPER, storyId: s.id });
    const after = (await loadMemory(s.id)).nodes[0].auditOpen[0].recovery;
    eq(after && after.attempts, 1, 'a failure at the wire counts its attempt (M723\'s bound holds)');
  } finally { globalThis.fetch = was; Date.now = clock; }
});

/* ---------- R11: the lamp ---------- */

test('M752-R11 NOT YELLOW WHERE NO AUDIT IS OWED, NOT BLUE FOR THE AUDIT READING ON ALONE: the auditor or this story\'s readers off, or a page between two audits (auditEvery), owe no verification; a page the auditor reads on does; the continuous audit reading older pages alone leaves the lamp to the scene (M673, DOM-243), a scene reader or an open correction still turn it blue; its pages still to read are not trouble', async () => {
  const pages = [{ id: 'u1', role: 'user', text: 'I climb the tower.' }, { id: 'a1', role: 'assistant', text: '[Park — Friday | 14:30]\n\nThe tower creaks.' }, { id: 'u2', role: 'user', text: 'Higher.' }, { id: 'a2', role: 'assistant', text: '[Park — Friday | 14:31]\n\nIt sways.' }];
  const ok = { at: Date.now(), ok: true, unfinished: false };
  const base = { storyId: 'm752-r11', shelf: { keeper: ok, extractor: ok, scribe: ok, world: ok }, state: { ...emptyState(), page: 1 }, pages, mem: { nodes: [] }, story: { brief: 'b' } };
  const audited = { ...emptyState(), page: 1, audit: { coverage: { read: 4, total: 4 } } };
  const lamp = (extra) => health.healthSnapshot({ ...base, ...extra });
  eq(lamp({}).status, 'yellow', 'auditor on, every page: an unverified ledger is waiting for its audit');
  eq(lamp({ auditEnabled: false }).status, 'green', 'auditor (or this story\'s readers) off: nothing will ever verify it, and the lamp does not wait for it');
  eq(lamp({ auditEnabled: false, state: { ...emptyState(), page: 1, audit: { coverage: { read: 3, total: 4 } } } }).status, 'green', 'nor for an audit cut short that no auditor will finish');
  eq(lamp({ auditEvery: 3, state: audited }).status, 'green', 'auditor every 3 pages, on page 2: no audit is owed yet');
  eq(lamp({ auditEvery: 2, state: audited }).status, 'yellow', 'auditor every 2 pages, on page 2: this page\'s audit is owed');
  eq(health.verificationOwed({ ...base, auditEnabled: false }), false, 'the lamp\'s own reckoning (chat.js) agrees: none owed with the auditor off');
  eq(health.verificationOwed({ ...base, auditEvery: 3, state: audited }), false, '…nor between two audits');
  eq(health.verificationOwed({ ...base, auditEvery: 3, state: { ...emptyState(), page: 1 } }), true, '…and a ledger never audited is owed one');
  const reading = { done: 0, folded: 18, left: 18, open: 0, unresolved: [] };
  eq(health.healthLamp(lamp({ auditEnabled: false, running: ['continuous'], auditRead: reading, historicalWait: 0 })), null, 'the continuous audit reading on alone: the lamp is not turned blue');
  eq(health.healthLamp(lamp({ auditEnabled: false, auditRead: { ...reading, done: 6, left: 12 }, historicalWait: 0 })), null, 'between two of its readings: its pages still to read are not trouble');
  eq(lamp({ auditEnabled: false, auditRead: { ...reading, done: 6, left: 12 }, historicalWait: 0 }).next, 'historical', '…and it is still sent on');
  eq(health.healthLamp(lamp({ auditEnabled: false, running: ['extractor', 'continuous'] })), 'working', 'the scene\'s own readers: blue');
  eq(health.healthLamp(lamp({ auditEnabled: false, running: ['continuous'], auditRead: { done: 18, folded: 18, left: 0, open: 1, unresolved: [{ id: 'f', why: 'Needs source review.' }] }, historicalWait: 0 })), 'working', 'the audit resolving an open correction: blue, as its words say');
  eq(health.healthLamp(lamp({})), 'trouble', 'an owed audit: yellow');
});

/* ---------- R12: a historical correction's pages move with its line ---------- */

test('M752-R12 AN OPEN HISTORICAL CORRECTION\'S PAGES MOVE WITH ITS LINE: a page let go before it, one brought back, its own page let go or rewound — the correction names the line\'s own pages (it went on naming the old numbers: its recovery read the pages of the line before it)', async () => {
  const pages = []; for (let i = 0; i < 20; i += 1) pages.push({ id: 'r12-' + i, role: i % 2 ? 'assistant' : 'user', text: 'page ' + i + ' words words.' });
  const f = { issue: { target: 'record', what: 'The captain attribution may be wrong.' }, why: 'Needs source review.', from: 6, to: 7 };
  const mem = { nodes: [{ id: 'A', span: [0, 5], level: 1, text: 'Line A', audited: 6, correctionReviewed: true }, { id: 'B', span: [6, 11], level: 1, text: 'Line B', audited: 6, correctionReviewed: true, auditOpen: [f] }] };
  const findingOf = (m) => m.nodes.find((n) => n.id === 'B').auditOpen.map((x) => [x.from, x.to]);
  const del = memoryAfterDeletion(mem, 0);
  eq(JSON.stringify(findingOf(del)), '[[5,6]]', 'a page let go before the line: the correction moves down with it');
  const s1 = nextStretch(del, pages.slice(1));
  assert(s1 && s1.from >= 5 && s1.to <= 10, 'and its recovery reads the line\'s own pages: ' + JSON.stringify(s1 && [s1.from, s1.to]));
  const ins = memoryAfterInsertion(mem, 0);
  eq(JSON.stringify(findingOf(ins)), '[[7,8]]', 'a page brought back before it: up with it');
  const s2 = nextStretch(ins, [{ id: 'back', role: 'user', text: 'back' }, ...pages]);
  assert(s2 && s2.from >= 7 && s2.to <= 12, 'its recovery reads the line\'s own pages: ' + JSON.stringify(s2 && [s2.from, s2.to]));
  const his = { nodes: [mem.nodes[0], { ...mem.nodes[1], verified: { at: 1, fixed: 'the writer' }, auditOpen: [f, { ...f, what: 'later', from: 9, to: 10 }] }] };
  eq(JSON.stringify(findingOf(memoryAfterDeletion(his, 6))), '[[6,6],[8,9]]', 'his line kept over a page let go inside it: the correction on that page loses it, the one after it moves down');
  eq(JSON.stringify(findingOf(memoryTruncatedAt(his, 8))), '[[6,7]]', 'a rewind inside it: what is left of the correction stays, a correction whose pages are all gone goes with them');
  /* the page a finding is said of (issue.page, counted from 1) moves with its pages: its recovery is shown the fault on the
   * page it reads (recoverHistoricalFinding sends the issue as it stands), and the out-of-character check looks at that page */
  const story = { issue: { target: 'story', what: 'Page 8 may contradict the brief about the key.', page: 8 }, why: 'The fault needs grounded story versus record classification.', from: 6, to: 7 };
  const record = { issue: { target: 'record', what: 'The line names the wrong captain; page 7 says otherwise.', page: 7 }, why: 'Missing exact replacement text in record.fixes.', from: 6, to: 7 };
  const said = { nodes: [mem.nodes[0], { ...mem.nodes[1], verified: { at: 1, fixed: 'the writer' }, auditOpen: [story, record] }] };
  const pagesOf = (m) => m.nodes.find((n) => n.id === 'B').auditOpen.map((x) => [x.issue.target, x.from, x.to, x.issue.page]);
  eq(JSON.stringify(pagesOf(memoryAfterDeletion(said, 0))), '[["story",5,6,7],["record",5,6,6]]', 'a page let go before the line: the page each is said of moves down with it');
  eq(JSON.stringify(pagesOf(memoryAfterInsertion(said, 0))), '[["story",7,8,9],["record",7,8,8]]', 'a page brought back before it: up with it');
  eq(JSON.stringify(pagesOf(memoryAfterDeletion(said, 7))), '[["record",6,6,7]]', 'the page a story fault is said of let go: the fault goes with it; the record correction keeps its page');
  eq(JSON.stringify(pagesOf(memoryAfterDeletion(said, 6))), '[["story",6,6,7],["record",6,6,null]]', 'the page a record correction cites let go: it keeps its other page and loses the citation');
  const s3 = nextStretch(memoryAfterDeletion(said, 0), pages.slice(1));
  eq(s3 && s3.recovery && s3.recovery.issue.page, 7, 'and its recovery is sent the page as it stands');
});

/* ---------- R13: the Housekeeper's re-ink of a page, in a tale whose keeper is off ---------- */

test('M752-R13 THE HOUSEKEEPER\'S RE-INK OF A PAGE UNDER A LINE, KEEPER OFF: the line over it is kept (M296/M675: no keeper folds it again) and rides — through the one door chat.js pageReinked runs; keeper on, it is let go to be folded again', async () => {
  for (const keeper of [false, true]) {
    const story = await tale('M752-R13 keeper ' + (keeper ? 'on' : 'off'), 16, (i) => (i % 2 ? '[Yard] The kettle sang while the old dog slept, page ' : 'MOVE-') + i + '.', { keeper });
    let pages = await visible(story.id);
    await saveMemory(story.id, { window: 10, nodes: [{ id: 'R', span: [0, 5], level: 1, text: 'REINK-LINE the dog slept by the kettle.', sourcePages: sourceBindings(pages.slice(0, 6)) }] });
    const session = { turns: [], batches: [] };
    const cards = stageProposals({ edits: [{ id: pages[3].id, find: 'the old dog slept', replace: 'the old dog watched', reason: 'continuity' }], ledits: [], redits: [] }, { messages: pages, state: await loadState(story.id), modules: [] });
    session.turns.push({ role: 'housekeeper', text: 'a card', ts: Date.now(), proposals: cards });
    const result = await applyProposal(session, story.id, cards[0].id);
    assert(result.ok, 'the re-ink landed: ' + result.words);
    pages = await visible(story.id);
    const k = pages.findIndex((m) => m.id === result.edited?.[0]?.messageId);
    assert(k === 3, 'the card reports the page it re-inked');
    await memory.recordAfterPageChange(story.id, k);
    const mem = await loadMemory(story.id);
    eq(sourceBindingIssues(mem.nodes, pages).length, 0, 'keeper ' + (keeper ? 'on' : 'off') + ': nothing unbound');
    if (keeper) eq(mem.nodes.length, 0, 'keeper on: the line is let go, to be folded again from the new words (M296)');
    else assert(wireOf(request(pages, mem.nodes, false)).includes('REINK-LINE'), 'keeper off: the line stays and rides');
  }
});

/* ---------- R14: a squeezed line read again keeps the continuous audit's corrections ---------- */

const PARTIAL = 'Insufficient context: this reading did not cover the complete record source section.'; /* continuous.js PARTIAL_WHY */
const DISPROVED = 'Ivo is named as the one who kept the key.';
/* a tale of twelve long pages (past the old keeper's cut, so M263 finds its squeezed line), the squeezed line over them with
 * a story fault and a record correction open under it, and a settled one whose evidence is page 9 — whose note on page 9
 * (M727's link) it disproves */
async function squeezedTale(title) {
  const story = await tale(title, 12, (i) => (i % 2 ? '[Dawn, chapel] Neri and Mara speak of the copper key, page ' : 'Neri asks about the key, page ') + i + '. ' + 'The rain kept falling on the chapel roof. '.repeat(170));
  const pages = await visible(story.id);
  const open = [
    { issue: { target: 'story', what: 'Page 3 may contradict the brief about the key.', page: 3 }, why: 'The fault needs grounded story versus record classification.', from: 2, to: 4 },
    { issue: { target: 'record', what: 'The line says Ivo kept the key; page 9 says Neri did.', record: { fixes: [{ from: 'Ivo kept the key', to: 'Neri kept the key' }] } }, why: PARTIAL, from: 6, to: 11 },
  ];
  const settled = { id: 'settled', outcome: 'correct', recordId: 'M', sourceSpan: [0, 11], sources: pages.map((p) => ({ id: p.id, mark: fingerprint36(pageText(p)) })),
    evidence: [{ source: pages[8].id, shown: 'Neri asks about the key, page 8.' }], finding: { id: 'settled', from: 0, to: 11, issue: { what: DISPROVED } }, why: 'The original disproves it.', at: 1 };
  await saveMemory(story.id, { window: 2, nodes: [{ id: 'M', span: [0, 11], level: 2, text: '[Dawn, chapel] MERGED Neri asked about the key; Ivo kept the key at the chapel.', at: 1,
    audited: 12, correctionReviewed: true, sourcePages: sourceBindings(pages), auditOpen: open, auditRecovery: [settled] }] });
  await db.messages.update(story.id, pages[8].id, { findings: [{ kind: 'audit', severity: 'warn', words: 'The continuous audit: ' + DISPROVED,
    auditLink: { recordId: 'M', sourceId: pages[8].id, sourceMark: fingerprint36(pageText(pages[8])), allegation: DISPROVED } }] });
  return story;
}
const keeperWire = (user) => (/NONE, or one DETAIL: line\./.test(user) ? 'NONE' : '[Dawn, chapel] Neri kept the key and spoke with Mara at the chapel.');
const pageNine = async (story) => { const ps = await visible(story.id); return continuous.historicalAdvisoryView(ps[8].findings[0], ps[8], await loadMemory(story.id), ps, story); };

test('M752-R14 A SQUEEZED LINE READ AGAIN KEEPS THE CONTINUOUS AUDIT\'S CORRECTIONS (M263\'s reading of a line read in part, M745\'s repair of a promoted line whose page changed): an open correction went with the old line, unresolved and unsaid, and a settled one too — the page concern it disproved read as unresolved again, and its dismissal could not reopen when its evidence changed. Each goes to the new line over its pages; one against the old words is reviewed against the new, never cleared as said of a line with no words', async () => {
  const story = await squeezedTale('M752-R14 M263');
  let pages = await visible(story.id);
  eq(memory.partlyReadMerged(await loadMemory(story.id), await db.messages.list(story.id)).join(), 'M', 'M263 finds the squeezed line read in part');
  eq(auditProgress(await loadMemory(story.id), pages.length, pages).open, 2, 'two corrections open before');
  eq((await pageNine(story)).disposition, 'disproved', 'the page concern its receipt disproved reads so before');
  await withSettings({ memoryBatch: 6, memoryWindow: 2, memoryKeeper: true }, () => withWire(keeperWire, async () => {
    const r = await memory.rereadMergedLine({ connection: KEEPER, storyId: story.id, lineId: 'M' });
    assert(r.ok && r.lines === 2, 'read again into two lines: ' + JSON.stringify(r));
  }));
  let mem = await loadMemory(story.id);
  const [a, b] = mem.nodes.slice().sort((x, y) => x.span[0] - y.span[0]);
  eq(JSON.stringify([a.span, b.span]), '[[0,5],[6,11]]', 'two lines over its pages');
  eq(auditProgress(mem, pages.length, pages).open, 2, 'both corrections are still open after it');
  eq(JSON.stringify((a.auditOpen || []).map((f) => [f.issue.what, f.from, f.to, f.why])), JSON.stringify([['Page 3 may contradict the brief about the key.', 2, 4, 'The fault needs grounded story versus record classification.']]), 'the story fault on the line over its pages, as it was');
  eq(JSON.stringify((b.auditOpen || []).map((f) => [f.issue.target, f.from, f.to, f.recovery === undefined])), '[["record",6,11,true]]', 'the record correction on the line over its pages, to be tried afresh');
  eq((b.auditRecovery || []).map((r) => r.id).join(), 'settled', 'the settled one on the line over the page its evidence cites');
  eq((await pageNine(story)).disposition, 'disproved', 'the page concern it disproved still reads so');
  /* the record correction said of the old line's words: reviewed against the new line, with a call — not cleared as one kept
   * "for a record line that had no words when it was read" (its pages are now the whole of a line) */
  await saveMemory(story.id, { ...mem, nodes: mem.nodes.map((n) => (n.id === a.id ? { ...n, auditOpen: [], audited: 6, correctionReviewed: true } : n)) });
  await withWire(() => 'not a verdict', async (wire) => {
    const res = await auditStretch({ connection: KEEPER, storyId: story.id });
    assert(res && res.recovery !== 'cleared' && wire.calls > 0, 'reviewed with a call: ' + JSON.stringify(res && { recovery: res.recovery, calls: res.calls, cleared: res.cleared }));
  });
  eq(auditProgress(await loadMemory(story.id), pages.length, pages).open, 1, 'and open until it is settled');

  /* M745: a page under the promoted line is edited — the line is read again, its corrections kept, and the dismissal whose
   * evidence was that page is reopened for review (M727: "only changed dependencies reopen a completed dismissal") */
  const edited = await squeezedTale('M752-R14 M745');
  pages = await visible(edited.id);
  await db.messages.update(edited.id, pages[8].id, { text: 'Neri asks about the key, page 8, now in the writer\'s new words: Ivo took the key.' });
  pages = await visible(edited.id);
  eq(sourceBindingIssues((await loadMemory(edited.id)).nodes, pages).map((i) => i.kind).join(), 'edited', 'the promoted line is unbound by the edit');
  await withSettings({ memoryBatch: 6, memoryWindow: 2, memoryKeeper: true }, () => withWire(keeperWire, async () => {
    const r = await memory.repairInvalidRecordSources({ connection: KEEPER, storyId: edited.id });
    assert(r.ok && !r.remaining, 'repaired: ' + JSON.stringify(r));
  }));
  mem = await loadMemory(edited.id);
  eq(sourceBindingIssues(mem.nodes, pages).length, 0, 'nothing unbound after');
  const progress = auditProgress(mem, pages.length, pages);
  eq(progress.open, 3, 'the two open corrections, and the dismissal whose evidence changed, reopened: ' + JSON.stringify(progress.unresolved.map((f) => f.issue?.what)));

  /* a dismissal already under review (its evidence changed since; recoverHistoricalFinding took it among the open ones) goes
   * with its receipt: apart from it, it was reopened a second time on the line the receipt went to, and reviewed twice */
  const reviewed = await squeezedTale('M752-R14 under review');
  pages = await visible(reviewed.id);
  const held = await loadMemory(reviewed.id);
  const old = held.nodes[0];
  old.auditRecovery[0].sources[2] = { ...old.auditRecovery[0].sources[2], mark: 'an-older-mark' }; /* page 3 changed since it was settled */
  old.auditOpen = [{ ...old.auditRecovery[0].finding, why: 'Supporting original evidence changed; reconsider this historical disposition.', recovery: { status: 'running', attempts: 1, nextAt: Date.now() + RECOVERY_DELAY } }];
  await saveMemory(reviewed.id, held);
  eq(auditProgress(held, pages.length, pages).open, 1, 'one dismissal under review before');
  await withSettings({ memoryBatch: 6, memoryWindow: 2, memoryKeeper: true }, () => withWire(keeperWire, async () => {
    assert((await memory.rereadMergedLine({ connection: KEEPER, storyId: reviewed.id, lineId: 'M' })).ok, 'read again');
  }));
  mem = await loadMemory(reviewed.id);
  eq(auditProgress(mem, pages.length, pages).open, 1, 'and one after it, not two');
  const home = mem.nodes.find((n) => (n.auditRecovery || []).some((r) => r.id === 'settled'));
  assert(home && (home.auditOpen || []).some((f) => f.id === 'settled'), 'under review on the line its receipt is on');
});

/* ---------- R15: nothing in a branch names the parent's pages ---------- */

test('M752-R15 NOTHING IN A BRANCH NAMES THE PARENT\'S PAGES: the continuous audit\'s note on a page names the copy it stands on (the concern its receipt disproved read as unresolved in every branch), a line\'s provenance names the copies, and a correction the parent had set aside stays set aside (due again at once in every branch, and paid for again)', async () => {
  const parent = await tale('M752-R15 parent', 12);
  const pp = await visible(parent.id);
  const allegation = 'An allegation the originals disproved.';
  const settled = { id: 'settled', outcome: 'correct', recordId: 'L1', sourceSpan: [6, 11], sources: pp.slice(6, 12).map((p) => ({ id: p.id, mark: fingerprint36(pageText(p)) })),
    evidence: [{ source: pp[8].id, shown: 'Neri asks, page 8' }], finding: { id: 'settled', from: 6, to: 11, issue: { what: allegation } }, why: 'The original disproves it.', at: 1 };
  const nodes = [
    /* his line, kept over a page that has since changed: its old receipts are its provenance (M745, M752) */
    { id: 'H', span: [0, 5], level: 1, text: 'HIS-LINE Neri kept the key.', verified: { at: 1, fixed: 'the writer' }, audited: 6, correctionReviewed: true,
      sourceOrigins: sourceBindings(pp.slice(0, 6)).map((ref, i) => (i === 2 ? { ...ref, version: 'an-older-version' } : ref)) },
    { id: 'L1', span: [6, 11], level: 1, text: 'LINE-ONE Prince William\'s captain watched from the yard door.', whole: true, audited: 6, correctionReviewed: true, sourcePages: sourceBindings(pp.slice(6, 12)),
      auditRecovery: [settled], auditOpen: [{ issue: { target: 'record', what: 'The captain attribution may be wrong.', record: { fixes: [] } }, why: 'Missing replacement text.', from: 6, to: 11 }] },
  ];
  await saveMemory(parent.id, { window: 10, nodes });
  await db.messages.update(parent.id, pp[8].id, { findings: [{ kind: 'audit', severity: 'warn', words: 'The continuous audit: ' + allegation,
    auditLink: { recordId: 'L1', sourceId: pp[8].id, sourceMark: fingerprint36(pageText(pp[8])), allegation } }] });
  /* the parent's audit tries the open correction as often as it may (M723): its provider fails twice; it is set aside */
  const was = globalThis.fetch, clock = Date.now;
  let now = clock(); Date.now = () => now;
  let calls = 0;
  globalThis.fetch = async (url) => { if (String(url).startsWith('/api/relay')) return new Response('no', { status: 404 }); calls += 1; return new Response('down', { status: 500 }); };
  try {
    for (let i = 0; i < 2; i += 1) { await auditStretch({ connection: KEEPER, storyId: parent.id }); now += RECOVERY_DELAY + 1; }
    const held = await loadMemory(parent.id);
    const parentPages = await visible(parent.id);
    eq(held.nodes[1].auditOpen[0].recovery?.status, 'blocked', 'the parent set it aside');
    eq(auditWaits(parent.id, held, parentPages), -1, 'and asks nothing more of it');
    /* the branch, as chat.js branchForUpdate makes it: every page copied whole with a new id, the audit's notes on them
     * renamed, the record renamed and its reservations carried */
    const branch = await db.stories.create({ title: 'M752-R15 branch' });
    await db.stories.update(branch.id, { keeper: true });
    const idMap = {};
    for (const m of parentPages) { const copy = { ...m }; delete copy.id; delete copy.storyId; idMap[m.id] = (await db.messages.copy(branch.id, copy)).id; }
    for (const m of parentPages) { const findings = continuous.branchAdvisories(m.findings, idMap); if (findings !== m.findings) await db.messages.update(branch.id, idMap[m.id], { findings }); }
    await saveMemory(branch.id, continuous.branchRecoveries(held, memory.branchRecord(held, idMap), parentPages, await visible(branch.id)));
    const bp = await visible(branch.id);
    const mem = await loadMemory(branch.id);
    const named = parentPages.filter((p) => JSON.stringify([mem, bp]).includes(p.id)).map((p) => parentPages.indexOf(p));
    eq(named.join(), '', 'nothing in the branch\'s record or pages names a parent page');
    eq(bp[8].findings[0].auditLink.sourceId, bp[8].id, 'the note on page 9 names the copy it stands on');
    eq(continuous.historicalAdvisoryView(bp[8].findings[0], bp[8], mem, bp, branch).disposition, 'disproved', 'and the concern its receipt disproved reads so in the branch');
    eq(mem.nodes[0].sourceOrigins.map((ref) => bp.findIndex((p) => p.id === ref.id)).join(), '0,1,2,3,4,5', 'his line\'s provenance names the copies');
    eq(mem.nodes[0].sourceOrigins[2].version, 'an-older-version', 'with the versions it was read from');
    eq(auditWaits(branch.id, mem, bp), -1, 'the correction the parent set aside stays set aside in the branch');
    const before = calls;
    eq(await auditStretch({ connection: KEEPER, storyId: branch.id }), null, 'the branch\'s audit has nothing to do');
    eq(calls - before, 0, 'and pays for nothing');
    assert(mem.nodes.filter((n) => Array.isArray(n.sourcePages)).every((n) => boundRecord(n, bp)), 'its bound lines ride');
  } finally { globalThis.fetch = was; Date.now = clock; }
});

/* ---------- R16: a line in his own words is never read again by itself ---------- */

test('M752-R16 A LINE IN HIS OWN WORDS IS NEVER READ AGAIN BY ITSELF (M675): M262 and M263 took his hand-written line over long pages for one the old keeper read in part, and the keeper\'s words were written over his; the keeper\'s own such lines are still read again', async () => {
  const long = 'x'.repeat(7000);
  const msgs = Array.from({ length: 24 }, (_, i) => ({ id: 'r16-' + i, role: i % 2 ? 'assistant' : 'user', text: 'page ' + i + ' ' + long }));
  const his = { at: 1, fixed: 'the writer' };
  const mem = { nodes: [
    { id: 'HIS-1', span: [0, 5], level: 1, text: 'HIS-OWN-LINE written by hand.', verified: his },
    { id: 'KEEPER-1', span: [6, 11], level: 1, text: 'a line the old keeper read in part' },
    { id: 'HIS-2', span: [12, 17], level: 2, text: 'HIS-OWN-MERGED written by hand.', verified: { at: 1, fixed: 'the housekeeper' } },
    { id: 'KEEPER-2', span: [18, 23], level: 2, text: 'a squeezed line read in part' },
  ] };
  eq(memory.partlyReadLines(mem, msgs).join(), 'KEEPER-1', 'M262 reads again only the keeper\'s line');
  eq(memory.partlyReadMerged(mem, msgs).join(), 'KEEPER-2', 'M263 too');
});

/* ---------- R17: a correction read from part of a line that has lost its other pages is still reviewed ---------- */

test('M752-R17 A RECORD CORRECTION READ FROM PART OF A LINE IS NOT CLEARED WHEN THE LINE SHRINKS TO ITS PAGES (keeper off: the line stays over what is left, M680): its pages now all of the line, the continuous audit took it for one kept from a line with no words and cleared it with no call — it is reviewed, and stays open until settled', async () => {
  for (const cut of ['pages let go inside it', 'a rewind into it']) {
    const story = await tale('M752-R17 ' + cut, 10, (i) => 'page ' + i + ' words.', { keeper: false });
    const finding = cut === 'a rewind into it' ? { from: 0, to: 5 } : { from: 2, to: 7 };
    let mem = { window: 10, nodes: [{ id: 'L', span: [0, 7], level: 1, text: 'Ivo kept the key; the rain fell.', audited: 8, correctionReviewed: true,
      auditOpen: [{ issue: { target: 'record', what: 'The line says Ivo kept the key; page 5 says Neri did.', record: { fixes: [{ from: 'Ivo kept the key', to: 'Neri kept the key' }] } }, why: PARTIAL, ...finding }] }] };
    const all = await visible(story.id);
    const nobodyFolds = { keepCovering: () => true }; /* chat.js, for a tale whose keeper is off */
    if (cut === 'a rewind into it') { mem = memoryTruncatedAt(mem, 6, nobodyFolds); for (const m of all.slice(6)) await db.messages.remove(story.id, m.id); }
    else { for (let k = 0; k < 2; k += 1) mem = memoryAfterDeletion(mem, 0, nobodyFolds); for (const m of all.slice(0, 2)) await db.messages.remove(story.id, m.id); }
    await saveMemory(story.id, mem);
    const line = mem.nodes[0];
    eq(JSON.stringify([line.span, line.auditOpen.map((f) => [f.from, f.to])]), '[[0,5],[[0,5]]]', cut + ': the line shrank to the correction\'s pages');
    let calls = 0;
    await withWire(() => { calls += 1; return new Response('down', { status: 500 }); }, async () => {
      const r = await auditStretch({ connection: KEEPER, storyId: story.id });
      assert(r && r.recovery !== 'cleared' && calls > 0, cut + ': reviewed with a call, not cleared: ' + JSON.stringify(r && { recovery: r.recovery, cleared: r.cleared }));
    });
    const pages = await visible(story.id);
    eq(auditProgress(await loadMemory(story.id), pages.length, pages).open, 1, cut + ': and open until it is settled');
  }
});
