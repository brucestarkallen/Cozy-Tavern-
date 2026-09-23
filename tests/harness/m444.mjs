/* M444: his Bleach story — every NPC stood in Oda's office, and Rukia, beside him on the page, was "elsewhere", then
 * "whereabouts not yet written". Four faults: another room of the same barracks counted as the scene; another Kuchiki's
 * leaving took her out; a note let go put her nowhere; and nothing restated the room, so nothing healed. Each test runs
 * the real engine, and the real page reader, world agent and auditor on a scripted model. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { HOUSES, withHouse } from './thinkinghouse.mjs';
import { db } from '../../js/store.js';
import { applyMutations, undoEntry, seatAtScene, clearsThatArrive, shownOnPage, wrongWalkIns } from '../../js/engine/apply.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { extractTurn, hereFromBoard } from '../../js/agents/extractor.js';
import { worldTurn } from '../../js/agents/world.js';
import { auditLedger, auditorScope } from '../../js/agents/auditor.js';

const ROOM = "13th Division Barracks — Captain's Office";
const streamed = (answer) => async (url, opts) => {
  const body = JSON.parse(opts.body);
  const lines = 'data: ' + JSON.stringify({ choices: [{ delta: { content: answer } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n';
  if (body.stream) return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(lines)); c.close(); } }), json: async () => ({}), text: async () => lines, clone() { return this; } };
  const obj = { choices: [{ message: { role: 'assistant', content: answer }, finish_reason: 'stop' }] };
  return { ok: true, status: 200, headers: new Headers(), json: async () => obj, text: async () => JSON.stringify(obj), clone() { return this; } };
};
/* the office as his ledger holds it: Oda, whoever is written in, and the pages of the people of both divisions */
const office = (present = ['Jovan Oda', 'Rukia Kuchiki']) => {
  const st = applyMutations({ ...emptyState(), page: 5 }, [{ type: 'mc.set', name: 'Jovan Oda' }, { type: 'place.set', name: ROOM },
    ...present.map((n) => ({ type: 'presence.enter', name: n }))]).state;
  st.characters = { ...(st.characters || {}), 'Rukia Kuchiki': { core: 'His lieutenant.', threads: [] }, 'Byakuya Kuchiki': { core: 'Captain of the 6th.', threads: [] },
    'Kiyone Kotetsu': { core: 'Third seat of the 13th.', threads: [] }, 'Sentarō Kotsubaki': { core: 'Third seat of the 13th.', threads: [] },
    'Renji Abarai': { core: 'Lieutenant of the 6th.', threads: [] }, 'Iba Tetsuzaemon': { core: 'Lieutenant of the 7th.', threads: [] } };
  return st;
};

test('M444-1 ANOTHER KUCHIKI’S LEAVING NEVER TAKES RUKIA — "Captain Kuchiki", "Kuchiki", "Kuchiki-taichō", "Lieutenant Kuchiki" take nobody out and move nobody, and say why; her own name still does', () => {
  const st = office();
  for (const form of ['Captain Kuchiki', 'Kuchiki', 'Kuchiki-taichō', 'Lieutenant Kuchiki']) {
    const r = applyMutations(st, [{ type: 'presence.leave', name: form }]);
    eq(r.applied.length, 0, form + ' takes nobody out');
    assert(r.state.present.some((p) => p.name === 'Rukia Kuchiki'), form + ': Rukia is still here');
    eq(Object.keys(r.state.offscreen || {}).length, 0, form + ': and nobody is "elsewhere"');
    assert(/could be more than one person/.test(r.rejected[0].why), form + ': and it says why — ' + r.rejected[0].why);
    eq(applyMutations(st, [{ type: 'presence.update', name: form, position: 'by the door' }]).applied.length, 0, form + ' moves nobody');
  }
  const gone = applyMutations(st, [{ type: 'presence.leave', name: 'Rukia' }]);
  eq(gone.applied.length, 1, 'her own name takes her out');
  assert(!gone.state.present.some((p) => p.name === 'Rukia Kuchiki'), 'she left');
  const both = applyMutations(office(['Jovan Oda', 'Rukia Kuchiki', 'Byakuya Kuchiki']), [{ type: 'presence.leave', name: 'Byakuya' }]).state;
  eq(both.present.map((p) => p.name).join(), 'Jovan Oda,Rukia Kuchiki', 'Byakuya by his own name goes; Rukia stays');
});

test('M444-2 ANOTHER ROOM OF THE SAME BARRACKS IS ELSEWHERE — Kiyone in the third seats’ office and Sentarō in the training yard stay out of the captain’s office; the office in any wording walks in; outside it does not', () => {
  const r = applyMutations(office(['Jovan Oda']), [
    { type: 'offscreen.set', name: 'Kiyone Kotetsu', location: "13th Division Barracks — the third seats' office", activity: 'sorting rosters', stance: 'busy' },
    { type: 'offscreen.set', name: 'Sentarō Kotsubaki', location: '13th Division Barracks, the training yard', activity: 'drilling recruits', stance: 'busy' },
    { type: 'offscreen.set', name: 'Rukia Kuchiki', location: "Captain's Office, 13th Division Barracks", activity: 'at the filing cabinet', stance: 'busy' },
    { type: 'offscreen.set', name: 'Renji Abarai', location: "13th Division Barracks — outside the captain's office", activity: 'waiting to be called in', stance: 'waiting' },
  ]);
  eq(r.state.present.map((p) => p.name).join(), 'Jovan Oda,Rukia Kuchiki', 'only the office itself walks in');
  eq(Object.keys(r.state.offscreen).sort().join(), 'Kiyone Kotetsu,Renji Abarai,Sentarō Kotsubaki', 'the rest are elsewhere, where the world put them');
  const rows = [
    [ROOM, "13th Division Barracks, Captain's Office, by the window", true],
    [ROOM, "the captain's office of the 13th Division Barracks", true],
    [ROOM, "Captain's Office in the 13th Division Barracks", true],
    [ROOM, "the third seats' office in the 13th Division Barracks", false],
    [ROOM, "13th Division Barracks — near the Captain's Office", false],
    [ROOM, "on her way to 13th Division Barracks — Captain's Office", false],
    [ROOM, "6th Division Barracks — Captain's Office", false],
    ['Tenth Division courtyard — the galleries', 'Tenth Division courtyard, the galleries', true],
    ['Tenth Division courtyard', 'Tenth Division courtyard, the galleries, watching the yard', true],
    ['Tenth Division courtyard — the galleries', 'Tenth Division courtyard, the east gate', false],
    ['Karakura Town', 'Karakura Town — Urahara Shop', false],
    ['Tokyo', 'Tokyo', false],
    ['the Bluebird', 'the Bluebird, closing up', true],
    ['the Bluebird', 'the Bluebird parking lot, outside', false],
  ];
  for (const [scene, seat, want] of rows) eq(seatAtScene(seat, scene), want, '“' + seat + '” in “' + scene + '”');
});

const PAGE = "[13th Division Barracks — Captain's Office — Monday, June 1, 2026 | 10:00 | clear | captain's haori | at the desk]\n\n"
  + 'Rukia set the report on Oda’s desk. Sentarō hovered by the window, pretending not to listen. Kuchiki-taichō studied them both, then turned and left without a word. “Renji will hear of this,” Rukia said.\n\n'
  + '*** The World Beyond ***\n\nKiyone Kotetsu sorted rosters in the third seats’ office.';

test('M444-3 THE ROOM, RESTATED ON EVERY PAGE — the page reader’s "here" writes back whoever the page shows and the ledger lost (the wrong note lets go); never someone only spoken of, only in the window, known by a shared name or ambiguous; the quiet stay', async () => {
  const st = office(['Jovan Oda', 'Rukia Kuchiki', 'Iba Tetsuzaemon']);
  /* the old fault's leavings: Sentarō "last seen" at the very office he stands in */
  st.offscreen = { 'Sentarō Kotsubaki': { location: ROOM, activity: '', lastSeen: true, sinceMinutes: null, atTurn: 3 } };
  const answer = JSON.stringify({ mutations: [{ type: 'presence.leave', name: 'Captain Kuchiki' }, { type: 'mode.snapshot', flags: ['group'] }], resolved: [],
    here: ['Jovan Oda', 'Rukia Kuchiki', 'Sentarō Kotsubaki', 'Byakuya Kuchiki', 'Renji Abarai', 'Kiyone Kotetsu', 'Kuchiki'] });
  const read = await withHouse({ fetch: streamed(answer) }, () => extractTurn({ connection: HOUSES[0].conn, state: st, userText: 'I look up from the report.', assistantText: PAGE }));
  eq(read.mutations.filter((m) => m.type === 'presence.enter').map((m) => m.name).join(), 'Sentarō Kotsubaki', 'only Sentarō is written in: ' + JSON.stringify(read.mutations));
  const after = applyMutations(st, read.mutations).state;
  eq(after.present.map((p) => p.name).sort().join(), 'Iba Tetsuzaemon,Jovan Oda,Rukia Kuchiki,Sentarō Kotsubaki', 'Rukia stays (the other Kuchiki’s leaving took nobody), Sentarō is back, quiet Iba stays');
  assert(!after.offscreen['Sentarō Kotsubaki'], 'his wrong note let go');
  assert(after.log.some((e) => /Sentarō Kotsubaki came into the scene — the page shows them here/.test(e.words)), 'said why in What changed and why');
  /* the same page with no "here" (an older answer): nothing written in, nothing lost */
  const bare = await withHouse({ fetch: streamed(JSON.stringify({ mutations: [{ type: 'mode.snapshot', flags: [] }] })) }, () => extractTurn({ connection: HOUSES[0].conn, state: st, userText: 'u', assistantText: PAGE }));
  eq(bare.mutations.filter((m) => m.type === 'presence.enter').length, 0, 'no board, no entries');
});

test('M444-4 CLEARED IS NEVER NOWHERE — the world agent lets Renji’s note go as the page shows him walk in: he is written in; Byakuya, only spoken of, is let go as it asked, never put in the room', async () => {
  const storyId = 'm444-world';
  const st = applyMutations(office(['Jovan Oda', 'Rukia Kuchiki']), [
    { type: 'offscreen.set', name: 'Renji Abarai', location: '6th Division Barracks — the training yard', activity: 'drilling', stance: 'busy' },
    { type: 'offscreen.set', name: 'Byakuya Kuchiki', location: "6th Division Barracks — Captain's Office", activity: 'reading reports', stance: 'busy' },
  ]).state;
  await saveState(storyId, st);
  const page = "[13th Division Barracks — Captain's Office]\n\nRenji Abarai shouldered through the door, grinning. “Your brother sends his regards — Byakuya never writes,” he told Rukia.";
  const answer = JSON.stringify({ mutations: [{ type: 'offscreen.clear', name: 'Renji Abarai' }, { type: 'offscreen.clear', name: 'Byakuya Kuchiki' }], brief: { pressure: [], ripe: [], twb: null, voices: [] } });
  const result = await withHouse({ fetch: streamed(answer) }, () => worldTurn({ connection: HOUSES[0].conn, storyId, userText: 'u', assistantText: page, stale: () => false }));
  const after = await loadState(storyId);
  assert(after.present.some((p) => p.name === 'Renji Abarai'), 'Renji is in the scene: ' + JSON.stringify(after.present));
  assert(!after.offscreen['Renji Abarai'], 'and not elsewhere');
  assert(!after.offscreen['Byakuya Kuchiki'] && !after.present.some((p) => /Byakuya/.test(p.name)), 'Byakuya, only spoken of, is let go — never written into the room');
  assert(result.applied.some((a) => /Renji Abarai came into the scene — the page shows them here/.test(a.words)), 'said why');
});

test('M444-5 THE AUDITOR — its letting go of a note of someone the latest page shows there is him walking in; and "Captain Kuchiki" walking in is not "Rukia, already here"', async () => {
  const s0 = await db.stories.create({ title: 'The office' });
  await db.messages.append(s0.id, { role: 'user', text: 'I look up.' });
  await db.messages.append(s0.id, { role: 'assistant', text: "[13th Division Barracks — Captain's Office]\n\nSentarō hovered by the window while Rukia filed the reports." });
  const st = office(['Jovan Oda', 'Rukia Kuchiki']);
  st.offscreen = { 'Sentarō Kotsubaki': { location: '13th Division Barracks — the training yard', activity: 'drilling', stance: 'busy', sinceMinutes: null, atTurn: 1 } };
  await saveState(s0.id, st);
  const answer = JSON.stringify({ issues: [{ what: 'the ledger has Sentarō in the yard; the page has him at the window', fix: 'he is here', pages: false, mutations: [{ type: 'offscreen.clear', name: 'Sentarō Kotsubaki' }] }] });
  const result = await withHouse({ fetch: streamed(answer) }, () => auditLedger({ connection: HOUSES[0].conn, storyId: s0.id, brief: 'A Bleach story.' }));
  const after = await loadState(s0.id);
  assert(after.present.some((p) => p.name === 'Sentarō Kotsubaki'), 'Sentarō is in the scene: ' + JSON.stringify(after.present));
  assert(!after.offscreen['Sentarō Kotsubaki'], 'not elsewhere, not nowhere');
  assert(result.applied.some((a) => a.mutation.type === 'presence.enter'), 'the report says what landed');
  const scoped = auditorScope([{ what: 'Byakuya came in and is not written', fix: 'write him in', mutations: [{ type: 'presence.enter', name: 'Captain Kuchiki' }] }], office(), { header: [] });
  eq(scoped.length === 1 && scoped[0].mutations.length, 1, '"Captain Kuchiki" walking in is not taken for Rukia already here');
});

test('M444-6 WHO WALKED IN FROM ANOTHER ROOM GOES BACK — Kiyone, pulled into the office by the old compound test and on no page since, is seated where the world had her; Sentarō, a page has shown since, stays; Isane, seated in the office itself, stays; Rukia stays', () => {
  const st = office(['Jovan Oda', 'Rukia Kuchiki']);
  const j = (id, m) => ({ id, p: 3, b: id, m });
  st.journal = [...st.journal,
    j(900, { type: 'offscreen.set', name: 'Kiyone Kotetsu', location: "13th Division Barracks — the third seats' office", activity: 'sorting rosters', stance: 'busy' }),
    j(901, { type: 'offscreen.set', name: 'Sentarō Kotsubaki', location: '13th Division Barracks, the training yard', activity: 'drilling', stance: 'busy' }),
    j(902, { type: 'offscreen.set', name: 'Isane Kotetsu', location: ROOM, activity: 'checking his arm', stance: 'busy' }),
    /* a seat under the family name two sisters share is neither sister's */
    j(903, { type: 'offscreen.set', name: 'Kotetsu', location: '4th Division relief station', activity: 'restocking', stance: 'busy' })];
  st.journalSeq = 903;
  st.present = [...st.present, { name: 'Kiyone Kotetsu' }, { name: 'Sentarō Kotsubaki' }, { name: 'Isane Kotetsu' }];
  st.characters['Isane Kotetsu'] = { core: 'Lieutenant of the 4th.', threads: [] };
  const pages = [0, 1, 2, 3].map(() => ({ text: 'Earlier.' })).concat([{ text: "[13th Division Barracks — Captain's Office]\n\nSentarō knocked a stack of files over." }, { text: 'Oda signed the report.' }]);
  const muts = wrongWalkIns(st, pages);
  eq(muts.filter((m) => m.type === 'presence.leave').map((m) => m.name).join(), 'Kiyone Kotetsu', 'only Kiyone: ' + JSON.stringify(muts));
  const after = applyMutations(st, muts).state;
  assert(!after.present.some((p) => p.name === 'Kiyone Kotetsu'), 'Kiyone is out of the office');
  eq(after.offscreen['Kiyone Kotetsu'].location, "13th Division Barracks — the third seats' office", 'seated where the world had her');
  assert(!after.offscreen['Kiyone Kotetsu'].lastSeen, 'a real seat, not a sighting at the office');
  for (const n of ['Jovan Oda', 'Rukia Kuchiki', 'Sentarō Kotsubaki', 'Isane Kotetsu']) assert(after.present.some((p) => p.name === n), n + ' stays');
  assert(after.log.some((e) => /Kiyone Kotetsu stepped out of the scene — never in it/.test(e.words)), 'said in What changed and why');
  eq(wrongWalkIns(after, pages).length, 0, 'nothing is named twice');
  const back = undoEntry(undoEntry(after, after.log.length - 1).state, after.log.length - 2).state;
  assert(back.present.some((p) => p.name === 'Kiyone Kotetsu') && !back.offscreen['Kiyone Kotetsu'], 'taken back, it is as it was');
});

test('M444-7 NAMED AS THEMSELF — "Kuchiki-taichō nodded" names Byakuya, never Rukia; "Kotetsu brought tea" names neither sister; a note let go on another’s name stays let go, on her own name she walks in', () => {
  const st = office(['Jovan Oda']);
  st.characters['Isane Kotetsu'] = { core: 'Lieutenant of the 4th.', threads: [] };
  eq(shownOnPage(st, 'Kuchiki-taichō nodded once.', 'Rukia Kuchiki'), false, 'another Kuchiki');
  eq(shownOnPage(st, 'Rukia set the file down.', 'Rukia Kuchiki'), true, 'her own name');
  eq(shownOnPage(st, 'Kotetsu brought tea.', 'Kiyone Kotetsu'), false, 'a name two sisters share');
  eq(shownOnPage(st, 'Kiyone brought tea.', 'Kiyone Kotetsu'), true, 'hers alone');
  const seated = applyMutations(st, [{ type: 'offscreen.set', name: 'Rukia Kuchiki', location: '13th Division Barracks — her own office', activity: 'filing', stance: 'busy' }]).state;
  eq(clearsThatArrive(seated, [{ type: 'offscreen.clear', name: 'Rukia Kuchiki' }], 'Kuchiki-taichō nodded once.')[0].type, 'offscreen.clear', 'no walk-in on another Kuchiki’s name');
  eq(clearsThatArrive(seated, [{ type: 'offscreen.clear', name: 'Rukia Kuchiki' }], '“Rukia will come,” he said.')[0].type, 'offscreen.clear', 'no walk-in on a spoken line');
  eq(clearsThatArrive(seated, [{ type: 'offscreen.clear', name: 'Rukia Kuchiki' }], 'Rukia set the file down.')[0].type, 'presence.enter', 'on her own name in the telling, she walks in');
  /* the room restated reads names the same way */
  eq(hereFromBoard(seated, ['Kiyone Kotetsu', 'Rukia Kuchiki'], 'Kotetsu brought tea. Kuchiki-taichō nodded once.').length, 0, 'a shared family name writes no one in');
  eq(hereFromBoard(seated, ['Kiyone Kotetsu'], 'Kiyone brought tea.').map((m) => m.name).join(), 'Kiyone Kotetsu', 'her own name does');
});

test('M444-8 THE INDEX IS PART OF THE VIEW — pages that do not fit stand as index lines inside the budget, never past it; a room that holds everything shows everything whole', async () => {
  const { windowOfPages } = await import('../../js/agents/lookup.js');
  const pages = [];
  for (let i = 1; i <= 60; i += 1) pages.push({ role: i % 2 ? 'user' : 'assistant', text: 'PAGE ' + i + ' ' + 'w'.repeat(i % 2 ? 40 : 3000), number: i });
  for (const budget of [2000, 9000, 30000, 90000]) {
    const w = windowOfPages(pages, budget);
    const used = w.shown.reduce((n, t) => n + t.length + 2, 0) + w.index.reduce((n, t) => n + t.length + 1, 0);
    assert(!w.shown.length || used <= budget, 'budget ' + budget + ': the view and its index fit in it (' + used + ')');
    assert(w.shown.length + w.index.length === 60, 'every page is either whole or on the index');
    assert(!w.shown.length || /PAGE 60 /.test(w.shown[w.shown.length - 1]), 'the newest page is the one kept whole');
  }
  eq(windowOfPages(pages, Infinity).index.length, 0, 'an unbounded room indexes nothing');
});
