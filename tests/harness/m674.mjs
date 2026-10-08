/* Cozy Tavern — harness laws of M674. “Try again” itself is the thread’s doing and is walked there (tests/dom/run.mjs,
 * DOM-244 and DOM-245). These two are what was found on the way: every reader that asks “is this person named here?”
 * folded the whole text again for each person asked about (measured, a ledger of 100 people: 384 ms over the 36,000
 * characters the continuous audit reads at a time), and a reading cut short to fit a small room worked the ledger’s
 * part out again for every room it tried. Every law here RUNS the code and asserts on what came back. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { nameOnPage } from '../../js/engine/names.js';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { buildStretchMessages, nextStretch, scopeStretch, auditStretch, stretchWords } from '../../js/agents/continuous.js';
import { asideAt, asideLabel, asideWho } from '../../js/commands.js';
import { storySoFar } from '../../js/agents/memory.js';
import { windowOfPages } from '../../js/agents/lookup.js';
import { auditView, buildAuditorMessages, rebuildStandings } from '../../js/agents/auditor.js';
import { rebuildPeople } from '../../js/agents/rebuild.js';
import { plansAsk } from '../../js/agents/plans.js';
import { db, dropCaches } from '../../js/store.js';
import { loadState, saveState } from '../../js/engine/state.js';
import { loadMemory, saveMemory, auditedOf, maybeSummarize } from '../../js/agents/memory.js';
import { stageProposals, applyProposal, undoLatest } from '../../js/agents/housekeeper.js';

const NAMES = ["O'Brien", 'Suì-Fēng', 'Ed', 'Lieutenant Rukia Kuchiki', 'The bartender', "Jovan's mother", 'Jovan', 'Jean-Luc Picard', 'Momo Hinamori', "Sean O'Brien"];
/* words that name nobody on that list — and long enough that a text ending in them is one the matcher remembers */
const FILL = ' Lanterns were lit along a low wall, as on each evening of that long summer; rain came late, and nobody minded it at all.'.repeat(4);
/* each of these is SHORT (two hundred characters or fewer): asked alone it is answered as it always was, nothing
 * remembered — which makes it the measure for the same words at the head of a long text */
const CORES = [
  "O'Brien said so, and Sui-Feng nodded. Ed grinned at the lieutenant.",
  "Jovan's mother set down the tray. Captain Kuchiki did not look up; Jean-Luc did.",
  'The bartender wiped the counter. Momo had not come, and nobody asked after her.',
  'Nobody at all was in the yard that morning.',
];

test('M674-1 A TEXT IS FOLDED ONCE, AND THE ANSWER IS THE SAME ANSWER: whoever is asked about, in whatever order, a long text says of each name what its own words say — two texts alike but for one word are never taken for each other, nor a text asked about again after more texts than are remembered, nor one longer than all that is kept; and asking about everyone the ledger keeps costs one folding of the text, not one for each of them', () => {
  assert(FILL.length > 200 && CORES.every((c) => c.length <= 200), 'fixture: the cores are short, the texts long');
  const texts = CORES.map((c) => c + FILL);
  const want = CORES.map((c) => NAMES.map((n) => nameOnPage(c, n)));
  /* the measure itself, checked by hand against M414’s rule: it says yes and no, and differently of each text */
  eq(JSON.stringify(want[0]), JSON.stringify([true, true, true, false, false, false, false, false, false, true]), 'O’Brien, Sui-Feng and Ed — “the lieutenant” is not Rukia — and Sean O’Brien by his family name, which only the fold that keeps “O’Brien” one word can find');
  eq(JSON.stringify(want[1]), JSON.stringify([false, false, false, true, false, true, true, true, false, false]), 'a family name, a possessive and its owner, a first name');
  eq(JSON.stringify(want[2]), JSON.stringify([false, false, false, false, true, false, false, false, true, false]), 'the bartender, and Momo');
  eq(JSON.stringify(want[3]), JSON.stringify(NAMES.map(() => false)), 'nobody');
  const ask = (i) => NAMES.map((n) => nameOnPage(texts[i], n));
  /* text by text, in every order, and one text again and again between the others */
  for (const order of [[0, 1, 2, 3], [3, 2, 1, 0], [0, 0, 1, 0, 2, 0, 3, 0, 1, 1]]) {
    for (const i of order) eq(JSON.stringify(ask(i)), JSON.stringify(want[i]), 'text ' + i + ', asked in the order ' + order.join(''));
  }
  /* and the other way round: one name, every text */
  NAMES.forEach((n, k) => texts.forEach((t, i) => eq(nameOnPage(t, n), want[i][k], n + ' in text ' + i)));
  /* the same words in another string are the same text */
  eq(JSON.stringify(NAMES.map((n) => nameOnPage((' ' + texts[1]).slice(1), n))), JSON.stringify(want[1]), 'a copy of the text');

  /* alike but for one word, deep in the middle: the same length, the same beginning, the same end */
  const twin = (who) => 'The yard was empty.' + FILL + ' ' + who + ' came in at last.' + FILL;
  const t1 = twin('Rukia'); const t2 = twin('Momo!');
  eq(t1.length, t2.length, 'fixture: the twins are the same length');
  for (let round = 0; round < 3; round += 1) {
    eq(nameOnPage(t1, 'Rukia Kuchiki'), true, 'Rukia is in the first twin');
    eq(nameOnPage(t2, 'Rukia Kuchiki'), false, 'and not in the second');
    eq(nameOnPage(t2, 'Momo Hinamori'), true, 'Momo is in the second');
    eq(nameOnPage(t1, 'Momo Hinamori'), false, 'and not in the first');
  }

  /* more texts than are remembered, each asked about — and then the first ones again */
  const many = Array.from({ length: 130 }, (_, k) => 'Page ' + k + '. ' + (k % 2 ? 'Rukia swept the yard.' : 'Momo read by the window.') + FILL);
  many.forEach((t, k) => {
    eq(nameOnPage(t, 'Rukia Kuchiki'), k % 2 === 1, 'Rukia, page ' + k);
    eq(nameOnPage(t, 'Momo Hinamori'), k % 2 === 0, 'Momo, page ' + k);
  });
  for (const i of [0, 1, 2, 3]) eq(JSON.stringify(ask(i)), JSON.stringify(want[i]), 'text ' + i + ' after a hundred and thirty others');
  many.slice(0, 6).forEach((t, k) => eq(nameOnPage(t, 'Rukia Kuchiki'), k % 2 === 1, 'and the first of the many again, page ' + k));

  /* one text longer than everything that is kept, and whatever is asked next */
  const giant = 'Rukia waited. ' + 'The rain fell on and on. '.repeat(14000);
  assert(giant.length > 300000, 'fixture: a giant');
  eq(nameOnPage(giant, 'Rukia Kuchiki'), true, 'the giant names Rukia');
  eq(nameOnPage(giant, 'Momo Hinamori'), false, 'and not Momo');
  eq(JSON.stringify(ask(1)), JSON.stringify(want[1]), 'the text asked about after the giant');
  eq(nameOnPage(giant, 'Rukia'), true, 'and the giant once more');

  /* nothing to read, nobody to look for */
  eq(nameOnPage('', 'Rukia'), false, 'no text');
  eq(nameOnPage(null, 'Rukia'), false, 'no text at all');
  eq(nameOnPage(' \n\t' + ' '.repeat(400), 'Rukia'), false, 'a long blank');
  eq(nameOnPage(' \n\t' + ' '.repeat(400), 'Rukia'), false, 'a long blank, again');
  eq(nameOnPage(texts[0], ''), false, 'no name');

  /* THE COST. Forty people asked about over ONE text never seen before, against forty texts never seen before with one
   * person asked about over each: the first is one folding and the second forty. (Before M674 they cost the same.) */
  const page = (tag) => ('Page ' + tag + '.' + FILL).repeat(42); /* about 20,000 characters, no two alike */
  const people = Array.from({ length: 40 }, (_, k) => (k % 2 ? 'Rukia' : 'Person' + k) + ' Family' + k);
  let seq = 0;
  const least = (fn) => Math.min(...[0, 1, 2].map(() => { const from = performance.now(); fn(); return performance.now() - from; }));
  const oneText = least(() => { seq += 1; const t = page('a' + seq); for (const p of people) nameOnPage(t, p); });
  const fortyTexts = least(() => { for (const p of people) { seq += 1; nameOnPage(page('b' + seq), p); } });
  assert(oneText * 5 < fortyTexts, 'forty people over one text cost ' + oneText.toFixed(1) + ' ms; forty texts, ' + fortyTexts.toFixed(1) + ' ms — the one text was folded for each of them');
});

test('M674-2 A READING CUT SHORT TO FIT SHOWS THE LEDGER OF THE PEOPLE ITS OWN PAGES NAME: the ledger’s part is worked out for the pages a request ends on — someone named only on a page that was left out is not listed, the pages it says it read are the pages it shows, and the whole stretch in a room that holds it lists everyone', () => {
  const state = applyMutations({ ...emptyState() }, [
    { type: 'mc.set', name: 'Jovan' },
    { type: 'people.set', name: 'Rukia', field: 'core', text: 'a shinigami of the Thirteenth Division' },
    { type: 'people.set', name: 'Momo', field: 'core', text: 'a lieutenant of the Fifth' },
    { type: 'knowledge.add', name: 'Rukia', fact: 'Jovan is the heir of the Wells house' },
    { type: 'knowledge.add', name: 'Momo', fact: 'the council meets on Friday' },
  ]).state;
  const pad = ' ' + 'word '.repeat(900); /* six pages of 4,500 characters: one stretch (36,000 is the most it reads at a time) */
  const pages = [
    { role: 'user', text: 'I show Rukia the seal.' + pad },
    { role: 'assistant', text: 'Rukia stared at the seal.' + pad },
    { role: 'user', text: 'I ask her to keep it hidden.' + pad },
    { role: 'assistant', text: 'Rukia promised she would.' + pad },
    { role: 'user', text: 'I thank her.' + pad },
    { role: 'assistant', text: 'Momo came in from the gate and saw nothing of it.' + pad },
  ];
  const mem = { nodes: [{ id: 'a', span: [0, 5], text: 'Jovan showed Rukia the seal; Momo came in from the gate.', level: 1 }] };
  const stretch = nextStretch(mem, pages);
  eq([stretch.from, stretch.to].join(), '0,5', 'fixture: one line, six pages');
  const ledgerPart = (b) => b.user.slice(b.user.indexOf('WHAT THE LEDGER HOLDS TODAY'));
  /* a room that holds all six */
  const whole = buildStretchMessages({ state, brief: 'A story of the Thirteenth Division.', mem, pages, stretch, room: 400000 });
  eq(whole.to, 5, 'all six pages');
  assert(/Rukia\n {2}knows: Jovan is the heir of the Wells house/.test(ledgerPart(whole)) && /Momo\n {2}knows: the council meets on Friday/.test(ledgerPart(whole)), 'both are named, both are listed: ' + ledgerPart(whole).slice(0, 300));
  /* a small one: several rooms are tried for the record, then pages are left out from the end */
  for (const room of [30000, 20000, 12000]) {
    const small = buildStretchMessages({ state, brief: 'A story of the Thirteenth Division.', mem, pages, stretch, room });
    assert(small.to >= 0 && small.to < 5 && small.lineWhole === false, 'room ' + room + ': fewer pages, and the line is not judged whole: ' + small.to);
    eq(small.sourceText, pages.slice(0, small.to + 1).map((p) => p.text).join('\n\n'), 'room ' + room + ': the pages it says it read are the pages it shows');
    for (let k = 0; k <= 5; k += 1) eq(small.user.includes('[p' + (k + 1) + '] '), k <= small.to, 'room ' + room + ': page ' + (k + 1) + (k <= small.to ? ' is shown' : ' is left out'));
    assert(!small.user.includes('Momo came in from the gate and saw nothing of it'), 'room ' + room + ': the page left out is not shown');
    assert(/Rukia\n {2}knows: Jovan is the heir of the Wells house/.test(ledgerPart(small)), 'room ' + room + ': Rukia, whom these pages name, is listed');
    assert(!/Momo\n|council meets on Friday/.test(ledgerPart(small)), 'room ' + room + ': Momo, named only on the page left out, is not: ' + ledgerPart(small).slice(0, 300));
  }
  /* and asked again for the whole stretch afterwards, everyone is back (nothing of the small rooms was kept) */
  const again = buildStretchMessages({ state, brief: 'A story of the Thirteenth Division.', mem, pages, stretch, room: 400000 });
  eq(again.user, whole.user, 'the same request as before');
});

test('M674-3 A VERSION’S NOTES GO WHERE THE PAGE GOES: every version of a page, with what was said of its words (a mend and its earlier words, the words he put back, the readers’ notes, a stop, a cut, where it looked things up), is in a backup as it stands in the store, comes back from the tale’s own book exactly as it was, and is carried whole into a branch', async () => {
  const st = await db.stories.create({ title: 'versions travel whole' });
  await db.messages.append(st.id, { role: 'user', text: 'What will your mother think?' });
  const page = await db.messages.append(st.id, { role: 'assistant', text: 'Liara said nothing at all.', receipt: { slots: [{ name: 'The story so far', chars: 12 }] } });
  /* the page as the thread keeps it once it has versions: the shown one's notes on the page, the others' on themselves */
  const swipes = [
    { text: 'Liara looked at Kris, who was not her mother.', ts: 1, thinking: 'Let me weigh the room.', thinkingMs: 1200, receipt: { slots: [{ name: 'The story so far', chars: 10 }] },
      mended: { before: 'Liara looked at Kim, who was not her mother.', why: 'Kim is written as the mother', at: 5 }, findings: [{ words: 'Kim is written as the mother', severity: 'warn' }],
      extraction: { appliedWords: ['Liara is wary'], rejectedCount: 0 }, masthead: 'The booth — Monday, March 3 | 09:05', voices: [{ icon: '💬', speaker: 'Renji', channel: 'by letter', content: 'The gate is watched.' }] },
    { text: 'Liara said nothing at all.', ts: 2, receipt: { slots: [{ name: 'The story so far', chars: 12 }] } },
    { text: 'She turns the handle, and the door', ts: 3, stopped: true, cutShort: true, keptText: 'She turns the handle, and the door', sources: [{ title: 'A map of the booth', url: 'https://example.org/booth' }] },
  ];
  await db.messages.update(st.id, page.id, { swipes, swipeIdx: 1, keptText: 'Liara said nothing at all.' });
  const stored = (await db.messages.list(st.id)).find((m) => m.id === page.id);
  eq(JSON.stringify(stored.swipes), JSON.stringify(swipes), 'fixture: the store holds every version with its notes');
  const whole = JSON.stringify(await db.messages.list(st.id));
  /* a backup holds the page as it stands */
  const inBackup = JSON.parse(await db.exportAll()).messages.find((m) => m.id === page.id);
  eq(JSON.stringify(inBackup), JSON.stringify(stored), 'the backup’s copy of the page');
  /* the tale’s own book (what is pushed to the device and pulled back): the page is changed here, the book put back */
  const book = await db.exportStory(st.id);
  await db.messages.update(st.id, page.id, { swipes: [{ text: 'something else', ts: 9 }], swipeIdx: 0, text: 'something else', keptText: undefined });
  assert(JSON.stringify(await db.messages.list(st.id)) !== whole, 'fixture: the page was changed');
  await db.importStory(book);
  /* (this harness’s stand-in database calls a transaction complete before the request inside it has answered — a real
   * one never does — so the pages are written a tick after importStory returns here: wait for it, and read afresh) */
  await new Promise((resolve) => setTimeout(resolve, 0));
  dropCaches();
  eq(JSON.stringify(await db.messages.list(st.id)), whole, 'the tale’s book put back: every page as it was');
  /* a branch copies the page whole */
  const branch = await db.stories.create({ title: 'a branch of it' });
  const source = (await db.messages.list(st.id)).find((m) => m.id === page.id);
  await db.messages.copy(branch.id, source);
  const copied = (await db.messages.list(branch.id))[0];
  assert(copied.id !== source.id && copied.storyId === branch.id, 'the copy is the branch’s own page');
  eq(JSON.stringify({ ...copied, id: '', storyId: '' }), JSON.stringify({ ...source, id: '', storyId: '' }), 'and everything else of it is the same');
  await db.stories.remove(st.id); await db.stories.remove(branch.id);
});

/* a card that re-inks the newest page, staged the way the housekeeper’s own answer stages it */
async function reinkByCard(session, story, find, replace) {
  const all = await db.messages.list(story.id);
  const op = { id: all[all.length - 1].id, find, replace, reason: 'because' };
  const cards = stageProposals({ edits: [op], ledits: [], redits: [] }, { messages: all, state: await loadState(story.id), modules: [] });
  session.turns.push({ role: 'housekeeper', text: 'a card', ts: Date.now(), proposals: cards });
  return applyProposal(session, story.id, cards[0].id);
}

test('M674-4 THE HOUSEKEEPER’S TAKE-BACK PUTS BACK ITS OWN WORDS AND NOTHING ELSE: a page it re-inked that was told again since (another version) and walked back to — taken back, that version reads as it did before the card and the other telling is still there; while the other telling is shown it refuses, as it always did; a page that had versions when the card landed comes back exactly as it was', async () => {
  const T0 = 'The kettle sang while the old dog slept.';
  const T1 = 'The kettle sang while the old dog watched.';
  const T2 = 'A second telling: the kitchen was cold, and nobody had lit the stove.';
  const pageOf = async (story, id) => (await db.messages.list(story.id)).find((m) => m.id === id);
  /* 1. no versions when the card landed; "Try again" since */
  {
    const story = await db.stories.create({ title: 'a take-back keeps the versions' });
    await db.messages.append(story.id, { role: 'user', text: 'I wait in the kitchen.' });
    const page = await db.messages.append(story.id, { role: 'assistant', text: T0 });
    const session = { turns: [], batches: [] };
    const landed = await reinkByCard(session, story, 'the old dog slept', 'the old dog watched');
    assert(landed.ok && (await pageOf(story, page.id)).text === T1, 'fixture: the card re-inked the page: ' + landed.words);
    /* told again: the page as the thread keeps it — the edited telling first, the new one shown */
    await db.messages.update(story.id, page.id, { swipes: [{ text: T1, ts: 1 }, { text: T2, ts: 2, findings: [{ words: 'a note on the second telling', severity: 'warn' }] }], swipeIdx: 1, text: T2 });
    const other = await undoLatest(session, story.id);
    assert(!other.ok && other.refused && /Not taken back/.test(other.words), 'while the other telling is shown, it refuses: ' + other.words);
    eq(JSON.stringify((await pageOf(story, page.id)).swipes.map((v) => v.text)), JSON.stringify([T1, T2]), 'and nothing is touched');
    /* walked back to the telling the card re-inked */
    await db.messages.update(story.id, page.id, { swipeIdx: 0, text: T1 });
    const back = await undoLatest(session, story.id);
    assert(back.ok, 'taken back: ' + back.words);
    const after = await pageOf(story, page.id);
    eq(after.text, T0, 'the words from before the card');
    assert(Array.isArray(after.swipes) && after.swipes.length === 2, 'the other telling is still there: ' + JSON.stringify(after.swipes));
    eq(after.swipes[0].text, T0, 'the version it re-inked reads as before');
    eq(JSON.stringify(after.swipes[1]), JSON.stringify({ text: T2, ts: 2, findings: [{ words: 'a note on the second telling', severity: 'warn' }] }), 'the other telling is exactly as it was, its notes with it');
    eq(after.swipeIdx, 0, 'and the page still shows the version he was on');
    assert(back.edited.length === 1 && back.edited[0].messageId === page.id && back.edited[0].before === T1 && back.edited[0].after === T0, 'the room is told which page was put back: ' + JSON.stringify(back.edited));
    await db.stories.remove(story.id);
  }
  /* 2. versions already there when the card landed, nothing since: back exactly as it was */
  {
    const story = await db.stories.create({ title: 'a take-back on a page with versions' });
    await db.messages.append(story.id, { role: 'user', text: 'I wait in the kitchen.' });
    const page = await db.messages.append(story.id, { role: 'assistant', text: T0 });
    await db.messages.update(story.id, page.id, { swipes: [{ text: T2, ts: 1 }, { text: T0, ts: 2 }], swipeIdx: 1 });
    const was = JSON.stringify(await pageOf(story, page.id));
    const session = { turns: [], batches: [] };
    const landed = await reinkByCard(session, story, 'the old dog slept', 'the old dog watched');
    const mid = await pageOf(story, page.id);
    assert(landed.ok && mid.text === T1 && mid.swipes[1].text === T1 && mid.swipes[0].text === T2, 'fixture: the card re-inked the shown version only');
    const back = await undoLatest(session, story.id);
    assert(back.ok, 'taken back: ' + back.words);
    eq(JSON.stringify(await pageOf(story, page.id)), was, 'the page is exactly as it was before the card');
    await db.stories.remove(story.id);
  }
  /* 3. a page with no versions, nothing since: the plain case still comes back plain */
  {
    const story = await db.stories.create({ title: 'a plain take-back' });
    const page = await db.messages.append(story.id, { role: 'assistant', text: T0 });
    const was = JSON.stringify(await pageOf(story, page.id));
    const session = { turns: [], batches: [] };
    assert((await reinkByCard(session, story, 'the old dog slept', 'the old dog watched')).ok, 'fixture: re-inked');
    assert((await undoLatest(session, story.id)).ok, 'taken back');
    const after = await pageOf(story, page.id);
    eq(after.text, T0, 'the old words');
    assert(!Array.isArray(after.swipes) || !after.swipes.length, 'and no versions were invented: ' + JSON.stringify(after.swipes));
    eq(JSON.stringify({ ...after, swipes: undefined, swipeIdx: undefined, hidden: undefined }), JSON.stringify({ ...JSON.parse(was), swipes: undefined, swipeIdx: undefined, hidden: undefined }), 'nothing else of the page moved');
    await db.stories.remove(story.id);
  }
});

/* the stand-in for the reader's model, as the laws of M673 stand it in */
const CONN = { type: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'deepseek-chat', reasoning: { effort: 'off' } };
const sse = (pieces) => { const t = pieces.map((x) => 'data: ' + JSON.stringify(x) + '\n\n').join('') + 'data: [DONE]\n\n'; return { ok: true, status: 200, headers: new Headers(), body: new Response(t).body, text: async () => t, json: async () => ({}), clone() { return this; } }; };
const say = (text) => sse([{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]);
const bodyOf = (opts) => { const b = JSON.parse(opts.body); return { system: String((b.messages.find((m) => m.role === 'system') || {}).content || ''), user: String(b.messages.slice(-1)[0].content || '') }; };
const withFetch = async (impl, fn) => { const prior = globalThis.fetch; globalThis.fetch = impl; try { return await fn(); } finally { globalThis.fetch = prior; } };

test('M674-5 OUT OF CHARACTER IS NOT THE STORY: the continuous audit is told which pages are the two writers talking about the story — his question by its mark or its flag, and the storyteller’s answer to it even where that answer carries no mark of its own — and holds every finding to the story’s own pages: nothing “learned” on such a page is written to the ledger, nothing from it is kept beneath the record line, nobody named only there is listed, and such a page is never mended or noted; what the story’s pages do say still lands', async () => {
  /* which pages are out of character */
  const P = [
    { role: 'user', text: 'I show Rukia the seal.' },
    { role: 'assistant', text: 'Jovan drew the seal of the Thirteenth from his coat. Rukia stared at it.' },
    { role: 'user', text: '((does Renji know about the seal? what could he do if he found out?))', ooc: true },
    { role: 'assistant', text: 'No — Renji knows nothing of the seal yet. He could find out at the gate and tell the captains; then Renji learned that Jovan carries the seal.', ooc: true },
    { role: 'user', text: '#question should Rukia betray him?' }, /* by its mark alone */
    { role: 'assistant', text: 'She could: Rukia could sell the seal to the captains for a pardon.' }, /* no mark of its own: it answers the page before it */
    { role: 'assistant', text: 'Rukia said nothing, and the lamp burned low.' }, /* the story going on (a “Go on”) */
    { role: 'user', text: '// note to self: bring the lamp back later' },
    { role: 'user', text: '#p' },
    { role: 'assistant', text: 'The lamp guttered.' },
  ];
  eq(JSON.stringify(P.map((_, i) => asideAt(P, i))), JSON.stringify([false, false, true, true, true, true, false, true, false, false]), 'his question by flag or mark, the answer to it, never the story going on, never a shortcut that asks for story');
  eq(asideAt(P, 99), false, 'no such page');

  /* one reading over such a stretch */
  const st = await db.stories.create({ title: 'out of character, read by the audit ' + Math.random() });
  for (const pg of P.slice(0, 6)) await db.messages.append(st.id, pg);
  for (let i = 6; i < 44; i += 1) await db.messages.append(st.id, { role: i % 2 ? 'assistant' : 'user', text: i % 2 ? 'The yard was quiet that hour. Page ' + i + '.' : 'I wait. ' + i });
  const ledger = applyMutations({ ...emptyState() }, [
    { type: 'mc.set', name: 'Jovan' },
    { type: 'people.set', name: 'Rukia', field: 'core', text: 'a shinigami of the Thirteenth Division' },
    { type: 'people.set', name: 'Renji', field: 'core', text: 'a lieutenant, posted at the gate' },
    { type: 'knowledge.add', name: 'Renji', fact: 'the gate is watched at night' },
    { type: 'knowledge.add', name: 'Rukia', fact: 'the lamp oil is kept in the cellar' },
  ]).state;
  await saveState(st.id, { ...ledger, page: 19 });
  await saveMemory(st.id, { window: 30, nodes: [{ id: 'a', span: [0, 5], text: 'Jovan showed Rukia the seal of the Thirteenth.', level: 1, at: 1, whole: true }] });
  const ANSWER = JSON.stringify({ issues: [
    { what: 'Renji learned of the seal.', mutations: [{ type: 'knowledge.add', name: 'Renji', fact: 'Jovan carries the seal' }] },
    { what: 'Rukia means to sell the seal.', mutations: [{ type: 'knowledge.add', name: 'Rukia', fact: 'Rukia could sell the seal to the captains for a pardon' }] },
    { what: 'Rukia saw the seal.', mutations: [{ type: 'knowledge.add', name: 'Rukia', fact: 'Jovan carries the seal of the Thirteenth' }] },
    { what: 'Page 4 says Renji knows nothing, but the story has him told.', pages: true, page: 4, fix: 'Renji already knew of the seal by then.' },
    { what: 'Page 6 has Rukia selling the seal.', pages: true, page: 6, fix: 'Rukia would never sell the seal to anyone.' },
    { what: 'What lasts.', record: { fixes: [], detail: 'Renji could tell the captains at the gate; Rukia stared at the seal of the Thirteenth' } },
  ] });
  const calls = []; const mends = []; const notes = [];
  await withFetch(async (url, opts) => { const b = bodyOf(opts); calls.push(b); return say(ANSWER); }, async () => {
    const r = await auditStretch({ connection: { ...CONN }, storyId: st.id, brief: 'A story of the Thirteenth Division.', stale: () => false, renew: () => true,
      mend: async (id, words) => { mends.push({ id, words }); return [{ id }]; }, note: async (id, finding) => { notes.push({ id, finding }); } });
    eq(calls.length, 1, 'one call');
    const asked = calls[0];
    assert(/A page marked OUT OF CHARACTER is the two writers talking ABOUT the story/.test(asked.system) && /Never\s+report such a page as a fault, and write no knowledge\.add and no "detail" from it\./.test(asked.system), 'the reader is told what such a page is');
    assert(/A background fact the WRITER\s+states there is the writer's own word, as the brief is: a record line that holds it is not wrong for holding it\./.test(asked.system), 'and that the writer’s own word, said out of character, is still his word (the keeper’s own rule for the record)');
    assert(asked.user.includes('[p1] PLAYER: I show Rukia the seal.') && asked.user.includes('[p2] STORY: Jovan drew the seal'), 'the story’s pages, as they always were');
    assert(asked.user.includes('[p3] OUT OF CHARACTER (the writer asking the storyteller -- not a page of the story): ((does Renji know'), 'his question, by its flag: ' + asked.user.slice(asked.user.indexOf('[p3]'), asked.user.indexOf('[p3]') + 120));
    assert(asked.user.includes('[p4] OUT OF CHARACTER (the storyteller answering the writer -- not a page of the story): No — Renji knows nothing'), 'its answer');
    assert(asked.user.includes('[p5] OUT OF CHARACTER (the writer asking the storyteller -- not a page of the story): #question should Rukia betray him?'), 'a question by its mark alone');
    assert(asked.user.includes('[p6] OUT OF CHARACTER (the storyteller answering the writer -- not a page of the story): She could:'), 'and the answer that carries no mark of its own');
    const part = asked.user.slice(asked.user.indexOf('WHAT THE LEDGER HOLDS TODAY'));
    assert(/Rukia\n {2}knows: the lamp oil is kept in the cellar/.test(part), 'Rukia, whom the story’s pages name, is listed: ' + part.slice(0, 300));
    assert(!/Renji\n|the gate is watched at night/.test(part), 'Renji, named only out of character, is not');
    /* what was written */
    eq([r.ok, r.sealed, r.mendedPages].join(), 'true,true,0');
    const led = await loadState(st.id);
    eq(JSON.stringify(led.knowledge.Rukia.map((k) => k.fact)), JSON.stringify(['the lamp oil is kept in the cellar', 'Jovan carries the seal of the Thirteenth']), 'what the STORY showed her is written — and what was only talked about is not');
    eq(JSON.stringify(led.knowledge.Renji.map((k) => k.fact)), JSON.stringify(['the gate is watched at night']), 'nothing is written for someone the story’s pages never name');
    eq(r.applied.length, 1, 'one thing written');
    eq(JSON.stringify(r.refused.map((x) => x.why)), JSON.stringify(['these pages do not name Renji', 'these pages do not say that']), 'and the two that were only talked about, refused for what they are');
    eq(mends.length, 0, 'the mender is never sent to an out-of-character page');
    eq(notes.length, 0, 'and nothing is noted on one');
    eq((r.faults || []).length, 0, 'no page fault is carried at all');
    const line = (await loadMemory(st.id)).nodes.find((n) => n.id === 'a');
    eq(line.detail, 'Rukia stared at the seal of the Thirteenth', 'what the story’s pages hold is kept beneath the line; an idea talked about is not');
    eq(auditedOf(line), 6, 'the line is marked read, out-of-character pages and all');
    assert(/set 2 things right/.test(stretchWords(r)) && !/page fault/.test(stretchWords(r)), stretchWords(r));
  });
  /* the scope alone: a page fault against a story page of the same reading still stands */
  const scoped = scopeStretch([
    { what: 'a', pages: true, page: 4, fix: 'Renji already knew of the seal by then.', record: null, mutations: [] },
    { what: 'b', pages: true, page: 2, fix: 'Rukia looked away from the seal at once.', record: null, mutations: [] },
  ], { state: ledger, pagesText: P[0].text + '\n\n' + P[1].text, from: 0, to: 5, lineWhole: true, turn: 3, asides: [3, 4, 5, 6] });
  eq(JSON.stringify(scoped.pageFixes.map((f) => f.page)), '[2]', 'only the story page’s fault is carried');
  await db.stories.remove(st.id);
});

test('M674-6 A TALE’S OWN KEEPER SWITCH IS THE TALE’S: switched on for this tale while the house-wide switch is off, the keeper folds its pages (it was sent, and wrote nothing — “could not fold a gap in the record yet”, for ever); left to the house, or switched off for this tale, with the house-wide switch off nothing is asked of anyone', async () => {
  const kept = { k: await db.settings.get('memoryKeeper'), w: await db.settings.get('memoryWindow'), b: await db.settings.get('memoryBatch'), s: await db.settings.get('memorySqueeze') };
  await db.settings.set('memoryKeeper', false); await db.settings.set('memoryWindow', 10); await db.settings.set('memoryBatch', 6); await db.settings.set('memorySqueeze', 100);
  const tale = async (keeper) => {
    const st = await db.stories.create({ title: 'the tale’s own keeper switch ' + Math.random() });
    if (keeper !== undefined) await db.stories.update(st.id, { keeper });
    for (let i = 0; i < 34; i += 1) await db.messages.append(st.id, { role: i % 2 ? 'assistant' : 'user', text: i % 2 ? 'Rukia swept the yard and Renji mended the gate. Page ' + i + '.' : 'I wait. ' + i });
    await saveMemory(st.id, { window: 10, nodes: [] });
    return st;
  };
  let asks = 0;
  const keeper = async (url, opts) => { asks += 1; const { user } = bodyOf(opts); return say(/NONE, or one DETAIL/.test(user) ? 'NONE' : 'Rukia swept the yard through the morning; Renji mended the gate; the yard stayed quiet; nothing else moved.'); };
  try {
    await withFetch(keeper, async () => {
      /* on for this tale, off for the house */
      const mine = await tale(true);
      await maybeSummarize({ connection: { ...CONN }, storyId: mine.id, stale: () => false, renew: () => true });
      const lines = (await loadMemory(mine.id)).nodes.filter((n) => Array.isArray(n.span) && n.span[0] >= 0);
      assert(lines.length >= 1 && lines[0].span[0] === 0 && /Rukia swept the yard/.test(lines[0].text), 'the keeper folded this tale: ' + JSON.stringify(lines.map((n) => [n.span, n.text.slice(0, 30)])));
      assert(asks > 0, 'its model was asked');
      /* left to the house, and off for this tale: the house-wide switch is off, so nothing is asked */
      for (const own of [undefined, null, false]) {
        const before = asks;
        const st = await tale(own);
        eq(await maybeSummarize({ connection: { ...CONN }, storyId: st.id, stale: () => false, renew: () => true }), null, 'nothing is folded with the tale’s switch ' + String(own));
        eq(asks, before, 'and nobody is asked');
        eq((await loadMemory(st.id)).nodes.length, 0, 'the record is as it was');
        await db.stories.remove(st.id);
      }
      await db.stories.remove(mine.id);
    });
  } finally { for (const [k, v] of [['memoryKeeper', kept.k], ['memoryWindow', kept.w], ['memoryBatch', kept.b], ['memorySqueeze', kept.s]]) { if (v === undefined) await db.settings.delete(k); else await db.settings.set(k, v); } }
});

test('M674-7 OUT OF CHARACTER IS SAID WHERE THE PAGE IS, TO EVERY READER THAT WRITES FROM PAGES: the pages shown beside the newest one (the page reader’s, the second reader’s, the world agent’s), the auditor’s view of the pages not yet folded, the two rebuilds from the pages and the plans keeper’s pages all name his question to the storyteller and its answer as out of character — by the mark or by what the page answers — and every page of the story as they always did', async () => {
  const st = await db.stories.create({ title: 'out of character, said to every reader ' + Math.random() });
  const told = [
    { role: 'user', text: 'I show Rukia the seal.' },
    { role: 'assistant', text: 'Rukia stared at the seal.' },
    { role: 'user', text: '((what would be a good plan for the raid?))', ooc: true },
    { role: 'assistant', text: 'A plan, then: Renji holds the gate while Rukia takes the east road.', ooc: true },
    { role: 'user', text: '#question should Rukia betray him?' },
    { role: 'assistant', text: 'She could; it would cost her the Division.' }, /* no mark of its own */
    { role: 'user', text: 'I thank her.' },
    { role: 'assistant', text: 'Rukia nodded once.' },
  ];
  for (const pg of told) await db.messages.append(st.id, pg);
  const all = await db.messages.list(st.id);
  const HIS = 'out of character — asking the storyteller, not a page of the story';
  const ITS = 'out of character — answering the writer, not a page of the story';
  eq(asideWho('user'), 'the writer, ' + HIS); eq(asideWho('assistant'), 'the storyteller, ' + ITS);
  eq(asideLabel('user'), 'OUT OF CHARACTER (the writer asking the storyteller — not a page of the story)');
  eq(asideLabel('assistant'), 'OUT OF CHARACTER (the storyteller answering the writer — not a page of the story)');

  /* 1. the pages beside the newest one */
  const soFar = storySoFar(all, { nodes: [] }, all[7].id, { least: 4 });
  eq(JSON.stringify(soFar.before.map((b) => [b.number, Boolean(b.aside)])), JSON.stringify([[1, false], [2, false], [3, true], [4, true], [5, true], [6, true]]), 'which of them are out of character');
  const beside = windowOfPages(soFar.before).shown;
  eq(beside[0], '[p1] The writer: I show Rukia the seal.'); eq(beside[1], '[p2] The storyteller: Rukia stared at the seal.');
  eq(beside[2], '[p3] The writer, ' + HIS + ': ((what would be a good plan for the raid?))');
  eq(beside[3], '[p4] The storyteller, ' + ITS + ': A plan, then: Renji holds the gate while Rukia takes the east road.');
  eq(beside[4], '[p5] The writer, ' + HIS + ': #question should Rukia betray him?');
  eq(beside[5], '[p6] The storyteller, ' + ITS + ': She could; it would cost her the Division.');
  /* a page too long for the room stands as one line of the index, and says so too */
  const tight = windowOfPages(soFar.before, 200);
  assert(tight.index.some((l) => l.startsWith('p4 The storyteller, ' + ITS + ' — A plan, then')), 'the index line of an out-of-character page: ' + JSON.stringify(tight.index));

  /* 2. the auditor's view */
  const view = auditView(all, 0, 1e6);
  eq(JSON.stringify(view.shown.map((p) => [p.ordinal, Boolean(p.aside)])), JSON.stringify([[1, false], [2, false], [3, true], [4, true], [5, true], [6, true], [7, false], [8, false]]));
  const state = applyMutations({ ...emptyState() }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'people.set', name: 'Rukia', field: 'core', text: 'a shinigami' }]).state;
  const audit = buildAuditorMessages({ state, brief: 'A story.', castNotes: '', record: '', pages: view.shown, index: view.index, pageCount: all.length, room: 400000 });
  assert(/\[p3[^\]]*\] OUT OF CHARACTER \(the writer asking the storyteller — not a page of the story\): \(\(what would be a good plan/.test(audit.user), 'his question, in the auditor’s pages');
  assert(/\[p4[^\]]*\] OUT OF CHARACTER \(the storyteller answering the writer — not a page of the story\): A plan, then/.test(audit.user), 'its answer');
  assert(/\[p6[^\]]*\] OUT OF CHARACTER \(the storyteller answering the writer — not a page of the story\): She could;/.test(audit.user), 'the answer with no mark of its own');
  assert(/\[p2[^\]]*\] STORY: Rukia stared at the seal\./.test(audit.user) && /\[p7[^\]]*\] PLAYER: I thank her\./.test(audit.user) && /\[p8[^\]]*\] STORY: Rukia nodded once\./.test(audit.user), 'the story’s pages as they always were');

  /* 3 and 4. the two rebuilds from the pages, as they are run */
  await saveState(st.id, state);
  const sent = [];
  await withFetch(async (url, opts) => {
    const b = bodyOf(opts); sent.push(b);
    if (/found the ledger/i.test(b.system + b.user)) return say('{"mutations":[]}');
    if (/reading a story/i.test(b.system)) return say('{"deltas":[],"shifts":[]}');
    return say('{"standings":[]}');
  }, async () => {
    await rebuildStandings({ connection: { ...CONN }, storyId: st.id, brief: 'A story.', stale: () => false, renew: () => true });
    await rebuildPeople({ connection: { ...CONN }, storyId: st.id, brief: 'A story.', stale: () => false, renew: () => true });
  });
  const standings = sent.find((b) => /THE LATEST PAGES:/.test(b.user));
  assert(standings, 'the standings were read again from the pages');
  assert(standings.user.includes('OUT OF CHARACTER (the storyteller answering the writer — not a page of the story): A plan, then') && standings.user.includes('OUT OF CHARACTER (the writer asking the storyteller — not a page of the story): #question should Rukia betray him?'), 'out of character, in the standings’ pages');
  assert(standings.user.includes('STORY: Rukia nodded once.') && standings.user.includes('PLAYER: I show Rukia the seal.'), 'and the story’s pages as they were');
  const people = sent.filter((b) => /THE NEXT PAGES:/.test(b.user)).map((b) => b.user).join('\n=====\n');
  assert(people.includes('OUT OF CHARACTER (the writer asking the storyteller — not a page of the story): ((what would be a good plan') && people.includes('OUT OF CHARACTER (the storyteller answering the writer — not a page of the story): She could;'), 'out of character, in the pages the people are read again from');
  assert(people.includes('STORY: Rukia stared at the seal.') && people.includes('PLAYER: I thank her.'), 'and the story’s pages as they were');

  /* 5. the plans keeper's pages */
  /* (a longer tale: the standings are read from its LAST pages — the ones out of character are still the right ones) */
  {
    const long = await db.stories.create({ title: 'out of character, late in a longer tale ' + Math.random() });
    for (let i = 0; i < 14; i += 1) await db.messages.append(long.id, { role: i % 2 ? 'assistant' : 'user', text: i % 2 ? 'The yard was quiet. Page ' + i + '.' : 'I wait. ' + i });
    await db.messages.append(long.id, { role: 'user', text: '((what could happen next?))', ooc: true });
    await db.messages.append(long.id, { role: 'assistant', text: 'Renji could arrive and take the seal.', ooc: true });
    await db.messages.append(long.id, { role: 'user', text: 'I skip a stone.' });
    await db.messages.append(long.id, { role: 'assistant', text: 'The stone skipped twice.' });
    await saveState(long.id, state);
    const late = [];
    await withFetch(async (url, opts) => { late.push(bodyOf(opts)); return say('{"standings":[]}'); }, async () => {
      await rebuildStandings({ connection: { ...CONN }, storyId: long.id, brief: 'A story.', stale: () => false, renew: () => true });
    });
    const asked = late.find((b) => /THE LATEST PAGES:/.test(b.user));
    const pagesPart = asked.user.slice(asked.user.indexOf('THE LATEST PAGES:'), asked.user.indexOf('THE PEOPLE THE LEDGER KNOWS'));
    eq((pagesPart.match(/OUT OF CHARACTER/g) || []).length, 2, 'two pages are out of character there, no more: ' + pagesPart);
    assert(pagesPart.includes('OUT OF CHARACTER (the writer asking the storyteller — not a page of the story): ((what could happen next?))') && pagesPart.includes('OUT OF CHARACTER (the storyteller answering the writer — not a page of the story): Renji could arrive'), 'and they are the right two');
    assert(pagesPart.includes('PLAYER: I skip a stone.') && pagesPart.includes('STORY: The stone skipped twice.') && pagesPart.includes('STORY: The yard was quiet. Page 13.'), 'the story’s pages beside them as they were');
    await db.stories.remove(long.id);
  }

  const plans = plansAsk({ standing: [], mc: 'Jovan', pages: [{ n: 3, who: asideWho('user'), text: told[2].text }, { n: 4, who: asideWho('assistant'), text: told[3].text }, { n: 8, who: 'the storyteller', text: told[7].text }] });
  assert(plans.user.includes('Page 4 (the storyteller, ' + ITS + '):\nA plan, then') && plans.user.includes('Page 3 (the writer, ' + HIS + '):') && plans.user.includes('Page 8 (the storyteller):\nRukia nodded once.'), plans.user);
  await db.stories.remove(st.id);
});
