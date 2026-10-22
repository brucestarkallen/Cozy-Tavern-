/* Cozy Tavern — harness laws of M758: the audit of the laptop's m755-001 … m757-001 (22 October 2026). Each runs the real
 * readers, auditor and store with the provider's answers scripted, and each failed on d962b86 (m757-001). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { applyMutations, mcWalksOff, mcGoesOut, walkInFromPage } from '../../js/engine/apply.js';
import { emptyPerson } from '../../js/engine/people.js';
import { auditLedger } from '../../js/agents/auditor.js';
import { auditSources, missingSourcePeople } from '../../js/agents/auditsources.js';
import { ledgerVerificationRows } from '../../js/agents/auditprogress.js';

const HEAD = '[Ashford Manor — Monday, October 20, 2026 | 20:12 | rain | a dark coat | in the drawing room]\n\nClaire poured the tea while the rain went on. ';

test('M758-G1 HE TAKES OUT HIS PHONE, NOT HIMSELF: the going verbs m755-001 added read only when they carry a PERSON, or run with the direction straight after them — "took out his phone", "pulled out a chair", "drew her into his arms", "ran a hand through his hair", "watched as the guard led her outside", "watched the two of them leave" are no going; the goings it was made for still are', () => {
  const stays = [
    'Jovan took out his phone and showed Vanessa the message.', 'Jovan pulled out a chair for her and sat down across from Claire.',
    'Jovan ran a hand through his hair.', 'Jovan took a sip from his cup.', 'Jovan drew his sword from its sheath.',
    'Jovan brought the cup up to his lips.', 'Jovan followed her gaze to the window.', 'Jovan took her hand and pulled her into a hug.',
    'Jovan drew her into his arms.', 'Jovan watched as the guard led her outside.', 'Jovan watched the two of them leave.',
    'Jovan nodded to Claire and Tobin, and they left together.', 'Jovan’s eyes went to the door.', 'Jovan’s gaze followed her out.',
    'Jovan pulled her coat off the hook and handed it to her.', 'Jovan took something out of his pocket.',
    'Jovan took them out of the box one by one.', 'Jovan pulled her out of the way of the cart.', 'Jovan rushed to her side.',
    'Jovan told the guard to take her out.', 'Jovan let the guard lead her out.', 'Jovan wanted to take her out to dinner someday.',
  ];
  for (const t of stays) assert(!mcWalksOff(HEAD + t, 'Jovan') && !mcGoesOut(HEAD + t, 'Jovan'), 'no going: ' + t);
  /* the outward word that is a thing's, for the reading that empties the room */
  for (const t of ['Jovan slipped off his coat and hung it by the door.', 'Jovan stepped out of the way to let her pass.', 'Jovan left the cup on the table, untouched.']) assert(!mcGoesOut(HEAD + t, 'Jovan'), 'not his going out: ' + t);
  const goes = [
    'Vanessa set down her teacup and asked Jovan to walk with her. He nodded, and the two of them went out into the garden, the door clicking shut behind them.',
    'Vanessa asked Jovan to walk with her, and they went out into the night together.', 'Vanessa took Jovan’s hand and led him outside, into the rain.',
    'Jovan followed her out into the corridor and pulled the door shut.', 'Jovan ran out into the rain.', 'Jovan hurried outside after her.',
    'Jovan took Vanessa out to the car.', 'Jovan led the way out of the hall.', 'Vanessa grabbed Jovan’s sleeve and pulled him out of the room.',
    'Vanessa led Jovan out onto the terrace.', 'Jovan nodded and followed her out.', 'Jovan walked out without a word.', 'Jovan went upstairs to bed.',
    'Jovan stood and followed her out.', 'Jovan asked Vanessa to walk with him, and they went out.', 'Jovan stood, and the two of them went out.',
  ];
  for (const t of goes) assert(mcWalksOff(HEAD + t, 'Jovan') && mcGoesOut(HEAD + t, 'Jovan'), 'his going: ' + t);
});

async function readPage(st, page, here, more = {}) {
  const { extractTurn } = await import('../../js/agents/extractor.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const said = JSON.stringify({ mutations: [], here, brief: { pressure: [], ripe: [], twb: null }, deltas: [], ...more });
  return withHouse(thinkingHouse({ answer: said }), () => extractTurn({ connection: HOUSES[0].conn, state: st, userText: 'I show her.', assistantText: page, pageNumber: 3 }));
}
const drawingRoom = () => applyMutations({ ...emptyState(), page: 2 }, [
  { type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Ashford Manor' },
  { type: 'clock.set', year: 2026, month: 10, day: 20, hour: 20, minute: 10 },
  { type: 'presence.enter', name: 'Jovan', position: 'in the drawing room' }, { type: 'presence.enter', name: 'Claire', position: 'beside Jovan' },
  { type: 'presence.enter', name: 'Vanessa', position: 'at the window' }, { type: 'presence.enter', name: 'Tobin', position: 'by the hearth' },
]).state;

test('M758-G2 THE QUIET ONE STAYS WHEN HE ONLY SHOWS HER A MESSAGE: a page ending "Jovan took out his phone and showed Vanessa the message" with Tobin quiet by the hearth — Tobin is still in the room whether the reader named the room without him or named nobody, and an arrival the page ends on is not refused as "the page ends on him walking off"', async () => {
  const page = HEAD + 'Jovan took out his phone and showed Vanessa the message.';
  for (const here of [['Jovan', 'Claire', 'Vanessa'], []]) {
    const st = drawingRoom();
    const read = await readPage(st, page, here);
    eq(read.mutations.filter((m) => m.type === 'presence.leave').map((m) => m.name).join(','), '', 'nobody is left behind (here ' + JSON.stringify(here) + ')');
    eq(applyMutations(st, read.mutations).state.present.map((p) => p.name).join(','), 'Jovan,Claire,Vanessa,Tobin', 'the room keeps all four');
  }
  const seated = applyMutations(drawingRoom(), [{ type: 'presence.leave', name: 'Vanessa', to: 'Ashford Manor' }]).state;
  eq(walkInFromPage(seated, ['Vanessa'], { page: HEAD + 'Vanessa came back in from the hall. Jovan took out his phone and showed Vanessa the message.' }), '', 'she walks back in');
});

test('M758-G3 A STREET OF THE CITY IS NOT ANOTHER PLACE ALTOGETHER (walk DOM-271, his turn 7, in the harness): from "Ilvarren" to "Cooper’s Row, Ilvarren" the reader names its room without the quiet raven — the raven is not taken out for silence; with no room named, the page decides (M755-5 keeps its own)', async () => {
  const city = () => applyMutations({ ...emptyState(), page: 2 }, [
    { type: 'mc.set', name: 'Azrael' }, { type: 'place.set', name: 'Ilvarren' },
    { type: 'clock.set', year: 1247, month: 10, day: 14, hour: 15, minute: 40 },
    { type: 'presence.enter', name: 'Azrael' }, { type: 'presence.enter', name: 'Roska', position: 'at the no-sign door' },
    { type: 'presence.enter', name: 'the raven', position: 'above the rooftops' },
  ]).state;
  const page = '[Ilvarren — Thornday, October 14, 1247 | 15:58 | grey | travel cloak | Cooper’s Row, at the no-sign door]\n\nRoska had her knuckles up to the no-sign door when Azrael’s shadow fell across it. She let her hand drop and fell in beside him.';
  const named = await readPage(city(), page, ['Azrael', 'Roska'], { spot: 'Cooper’s Row' });
  assert(named.mutations.some((m) => m.type === 'place.set' && /Cooper’s Row, Ilvarren/.test(m.name)), 'the ground is the street: ' + JSON.stringify(named.mutations));
  assert(!named.mutations.some((m) => m.type === 'presence.leave' && m.name === 'the raven'), 'the quiet raven stays: ' + JSON.stringify(named.mutations.filter((m) => m.type === 'presence.leave')));
  const unnamed = await readPage(city(), page, [], { spot: 'Cooper’s Row' });
  assert(unnamed.mutations.some((m) => m.type === 'presence.leave' && m.name === 'the raven'), 'with no room named, the page decides — it never shows the raven');
});

/* ——— the auditor ——— */
const CONN = { type: 'openai', baseUrl: 'https://fixture.example/v1', apiKey: 'fixture', model: 'fixture', preset: 'custom', contextSize: 200000, reasoning: { effort: 'off' } };
const stream = (value) => new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: typeof value === 'string' ? value : JSON.stringify(value) } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
/* the provider: the whole-ledger review gets `review(user, n)`, a reading of the entries left over `alone(user, n)`; a
 * function that throws is a provider that fails */
async function onWire({ review = () => ({}), alone = () => ({}) }, fn) {
  const calls = { review: 0, alone: 0, users: [] };
  const before = globalThis.fetch;
  globalThis.fetch = async (_, options) => {
    const user = JSON.parse(options.body).messages.find((m) => m.role === 'user').content;
    calls.users.push(user);
    if (user.startsWith('SOURCE DOCUMENTS')) return stream({ checked: JSON.parse(user.slice('SOURCE DOCUMENTS\n'.length)).map((d) => d.id), people: [] });
    if (user.startsWith('REQUIRED CURRENT LEDGER CHECKS')) { calls.alone += 1; return stream(await alone(user, calls.alone)); } /* a reading of the entries left over opens with them */
    calls.review += 1;
    return stream({ issues: [], review: { status: 'complete', why: 'Every entry was compared with the originals.', open: [] }, standings: [], scene: [], ...(await review(user, calls.review)) });
  };
  try { return await fn(calls); } finally { globalThis.fetch = before; }
}

const AFFAIR = 'Having a secret affair with Jovan Wessex that nobody knows';
const ORIGINAL = 'Vanessa Langley gave the deputies their orders. Later, alone with him, it was plain she was having a secret affair with Jovan Wessex that nobody knows about.';
async function vanessa(title, core) {
  const { id } = await db.stories.create({ title });
  await db.messages.append(id, { role: 'user', text: 'I wait for her.' });
  await db.messages.append(id, { role: 'assistant', text: ORIGINAL });
  const d = auditSources({ messages: await db.messages.list(id) }).find((x) => x.text.includes('secret affair'));
  const st = { ...emptyState(), sheet: { actors: {}, playerName: 'Jovan Wessex', playerAliases: [] }, characters: { 'Vanessa Langley': { ...emptyPerson(), core } } };
  st.auditSources = { [d.id]: { mark: d.mark, appearanceReviewed: true, profileReviewed: 1, people: [{ name: 'Vanessa Langley', kind: 'person', shown: ORIGINAL, facts: [], identityFacts: [{ text: AFFAIR, shown: ORIGINAL }] }] } };
  await saveState(id, st);
  return { id, d };
}
const owedAffair = (r) => r.pending.some((p) => /Vanessa Langley has source identity facts to reconcile: Having a secret affair/.test(p));

test('M758-F1 A FACT HER PROFILE DOES NOT HOLD IS OWED, WHATEVER WORDS IT SHARES: "Having a secret affair with Jovan Wessex that nobody knows" against a profile that only calls Jovan "Wessex" and knows "the secret of the bodies" — m756-001 counted half its long words and waved it through, and it was never asked about again', () => {
  const core = 'FBI agent; calls Jovan by his surname, Wessex; knows the secret of the bodies';
  const st = applyMutations({ ...emptyState(), page: 4 }, [{ type: 'mc.set', name: 'Jovan Wessex' }, { type: 'people.set', name: 'Vanessa Langley', field: 'core', text: core }]).state;
  const owed = missingSourcePeople(st, [{ name: 'Vanessa Langley', source: 'page:1', label: 'page 1', shown: 'x', identityFacts: [{ text: AFFAIR, shown: 'x' }] }]);
  eq(owed.length, 1, 'still owed to the review');
});

test('M758-F2 A REVIEW THAT SAYS IT DID NOT FINISH APPROVES NO FACT IT DID NOT NAME: the first such answer leaves the affair owed, saying the review did not finish; a second such answer sets it aside in a line that says so (M756-004) — and a finished review decides it at once, in its own words', async () => {
  const { id } = await vanessa('m758-f2', 'An FBI agent who gives the deputies their orders.');
  const unfinished = () => ({ review: { status: 'open', why: 'I could not get through every entry this time.', open: [] } });
  const one = await onWire({ review: unfinished }, () => auditLedger({ connection: CONN, storyId: id, reviewSources: 'all' }));
  assert(owedAffair(one), 'owed after an unfinished review: ' + JSON.stringify(one.pending).slice(0, 400));
  assert(one.pending.some((p) => /Having a secret affair[^]*no review answer for it — the review did not finish this pass/.test(p)), 'and the light says why');
  assert(!Object.values((await loadState(id)).audit.sourceFactDecisions || {}).length, 'no decision was recorded for it');
  const two = await onWire({ review: unfinished }, () => auditLedger({ connection: CONN, storyId: id, reviewSources: 'all' }));
  assert(!owedAffair(two), 'asked twice and never decided: set aside');
  assert(Object.values((await loadState(id)).audit.sourceFactDecisions || {}).some((x) => /Asked twice and never decided/.test(x.why)), 'in a line that says so');
  const { id: done } = await vanessa('m758-f2 done', 'An FBI agent who gives the deputies their orders.');
  const r = await onWire({}, () => auditLedger({ connection: CONN, storyId: done, reviewSources: 'all' }));
  assert(!owedAffair(r), 'a finished review decides it');
  assert(Object.values((await loadState(done)).audit.sourceFactDecisions || {}).some((x) => /compared with the originals/.test(x.why)), 'with its own verdict');
});

test('M758-F3 A PROVIDER THAT FAILS HAS ASKED NOTHING: two audits whose review never answers leave the affair owed — never "asked twice and never decided" — and the next review that answers decides it in its own words', async () => {
  const { id } = await vanessa('m758-f3', 'An FBI agent who gives the deputies their orders.');
  const down = () => { throw new Error('the provider is down'); };
  for (let i = 0; i < 2; i += 1) {
    const r = await onWire({ review: down }, () => auditLedger({ connection: CONN, storyId: id, reviewSources: 'all' }));
    assert(owedAffair(r), 'still owed after failure ' + (i + 1) + ': ' + JSON.stringify(r.pending).slice(0, 300));
  }
  assert(!Object.values((await loadState(id)).audit.sourceFactDecisions || {}).some((x) => /Asked twice/.test(x.why)), 'not set aside by failures');
  const r = await onWire({}, () => auditLedger({ connection: CONN, storyId: id, reviewSources: 'all' }));
  assert(!owedAffair(r), 'the review that answers decides it');
  assert(Object.values((await loadState(id)).audit.sourceFactDecisions || {}).some((x) => /compared with the originals/.test(x.why)), 'in its own words');
});

/* the M752-A11 ledger: 40 people, long pages — larger than one whole-ledger reading of a 128k connection */
async function bigLedger(title) {
  const para = (chars, tag) => (tag + ' ' + 'the lamp burned low over the ledger, '.repeat(Math.ceil(chars / 37))).slice(0, chars);
  const st = { ...emptyState(), sheet: { actors: {}, playerName: 'Keir', playerAliases: [] }, page: 800, characters: {} };
  for (let i = 0; i < 40; i += 1) st.characters['Person ' + i + ' Vale'] = { ...emptyPerson(), core: 'Person ' + i + ' Vale keeps a secret. ' + para(4000, 'core'), state: para(1500, 'state'), arc: para(4000, 'arc'), threads: [para(300, 't1')], updatedAtTurn: 790, ...(i >= 34 ? { retired: true } : {}) };
  st.relationships = Object.fromEntries(Object.keys(st.characters).map((k, i) => [k, { p: i, r: i, s: 0, history: [] }]));
  st.present = Object.keys(st.characters).slice(0, 4).map((name) => ({ name }));
  const { id } = await db.stories.create({ title });
  for (let i = 0; i < 30; i += 1) { await db.messages.append(id, { role: 'user', text: 'u' + i }); await db.messages.append(id, { role: 'assistant', text: para(3000, 'page ' + i) }); }
  await saveState(id, st);
  return { id, st, conn: { ...CONN, contextSize: 128000 } };
}
const idsIn = (user, head) => JSON.parse(user.split(head)[1].split('\n')[0]).map((r) => r.id);
const aloneIds = (user) => JSON.parse(user.split('\n')[1]).map((r) => r.id);

test('M758-A1 THE ENTRIES THAT DID NOT FIT ARE READ AND APPROVED IN THE SAME PASS: the whole reading carries part of a long ledger; the rest go in readings of their own that fit the connection, and every entry a reading checks is approved — m757-001 paid for its reading and approved none (“checked 63 of 142”)', async () => {
  const { id, st, conn } = await bigLedger('m758-a1');
  const total = ledgerVerificationRows(st).length;
  let main = [];
  const sentAlone = [];
  const r = await onWire({
    review: (user) => { main = idsIn(user, 'REQUIRED CURRENT LEDGER CHECKS:\n'); return {}; },
    alone: (user) => { const ids = aloneIds(user); sentAlone.push(...ids); return { checks: ids.map((x) => ({ id: x, status: 'correct', why: 'compared with the originals' })), issues: [], review: { status: 'complete', why: 'read', open: [] } }; },
  }, async (calls) => {
    const out = await auditLedger({ connection: conn, storyId: id, reviewSources: 'all' });
    assert(calls.users.every((u) => u.length < 360000), 'every request inside its connection: ' + calls.users.map((u) => u.length).join(','));
    return out;
  });
  assert(main.length > 0 && main.length < total, 'the whole reading carried part: ' + main.length + ' of ' + total);
  eq(new Set([...main, ...sentAlone]).size, main.length + sentAlone.length, 'no entry sent twice');
  const after = await loadState(id);
  const approved = Object.keys(after.audit.verification.entries);
  assert(sentAlone.length > 0 && sentAlone.every((x) => approved.includes(x)), 'the entries read on their own are approved: ' + sentAlone.filter((x) => approved.includes(x)).length + ' of ' + sentAlone.length);
  assert(approved.every((x) => main.includes(x) || sentAlone.includes(x)), 'and nothing unread is');
  eq(r.unfinished, false, 'the whole ledger is read in one pass: ' + JSON.stringify(r.pending).slice(0, 300));
  eq(after.audit.finalReview.deferredRead, sentAlone.length, 'the count says what was approved');
});

test('M758-A2 A READING OF THE LEFT-OVER ENTRIES APPROVES ONLY WHAT IT CHECKED, ON THE VALUE IT WAS SHOWN: an entry it keeps open stays open with its reason; an entry the whole reading’s own repair changed is not sent to it; a reading that answers for nothing is asked once, not again and again', async () => {
  const { id, conn } = await bigLedger('m758-a2');
  let main = [], alone = [];
  let changed = '';
  await onWire({
    review: (user) => {
      main = idsIn(user, 'REQUIRED CURRENT LEDGER CHECKS:\n');
      changed = Array.from({ length: 34 }, (_, i) => 'Person ' + i + ' Vale').find((n) => !main.includes('characterState:' + n));
      return { issues: [{ what: changed + ' is asleep upstairs now', mutations: [{ type: 'people.set', name: changed, field: 'state', text: 'Asleep upstairs, the lamp out.' }] }] };
    },
    alone: (user, n) => {
      const ids = aloneIds(user);
      if (n === 1) alone = ids;
      return { checks: ids.map((x, i) => ({ id: x, status: i === 0 ? 'open' : 'correct', why: i === 0 ? 'her arc says the opposite of page 12' : 'compared with the originals' })), issues: [], review: { status: 'complete', why: 'read', open: [] } };
    },
  }, () => auditLedger({ connection: conn, storyId: id, reviewSources: 'all' }));
  const after = await loadState(id);
  eq(after.characters[changed].state, 'Asleep upstairs, the lamp out.', 'the whole reading’s repair landed');
  assert(changed && !alone.includes('characterState:' + changed), 'the entry the repair changed was not sent to the reading that could not see the repair');
  assert(!after.audit.verification.entries['characterState:' + changed], 'and is not approved');
  assert(!after.audit.verification.entries[alone[0]], 'the entry it kept open is not approved');
  assert((after.audit.verification.pending || []).some((p) => p === alone[0] + ': her arc says the opposite of page 12'), 'its reason is kept: ' + JSON.stringify((after.audit.verification.pending || []).slice(0, 3)));
  /* a reading that answers for nothing: asked once */
  const { id: quiet, conn: c2 } = await bigLedger('m758-a2 quiet');
  await onWire({ alone: () => ({ checks: [], issues: [], review: { status: 'complete', why: 'read', open: [] } }) }, async (calls) => {
    const r = await auditLedger({ connection: c2, storyId: quiet, reviewSources: 'all' });
    eq(calls.alone, 1, 'one reading that answers nothing ends the readings for this pass');
    assert(r.pending.some((p) => /not read yet: the ledger is larger than one reading/.test(p)), 'the rest wait, open, and say why');
  });
});
