/* Cozy Tavern — harness laws of M752: THE HOUSEKEEPER'S SPELLING CORRECTION, HELD TO THE NAME (the audit of M730).
 * Each defect was made to happen at m751 first. A correction matched its old spelling in any case: May to Mae rewrote
 * "You may go" and "the first of May" in the prose and in every later ledger write. A correction onto a fuller name
 * rewrote its own result again ("Renji Abarai Abarai") on the shown version and on every later write and fold, so it
 * always failed its own check; an ordinary rename did the same ("Rukia Kuchiki Kuchiki"). And its take-back was refused
 * once the ledger log's newest 200 lines no longer held it. The laws run the real Housekeeper and the real engine. The
 * spelling card's apply and take-back are one atomic story edit each (store.js editStoryAtomically), which the harness's
 * own IndexedDB stand-in cannot run: those laws hold what fixtures/m752-spelling-card.mjs saw over fake-indexeddb in a
 * child process. */
import './idb-shim.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { emptyState, loadState, saveState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import * as hk from '../../js/agents/housekeeper.js';

/* the real Housekeeper over fake-indexeddb: one scenario of the fixture, its observations as JSON */
function card(scenario) {
  const out = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/m752-spelling-card.mjs', import.meta.url)), scenario], { encoding: 'utf8', timeout: 120000 });
  assert(out.status === 0, 'the fixture ran (' + scenario + '): ' + String(out.stderr || '').slice(-800));
  return JSON.parse(String(out.stdout).trim().split('\n').pop());
}
async function tale({ brief = '', pages = [], state }) {
  const story = await db.stories.create({ title: 'M752 spelling' });
  if (brief) await db.stories.update(story.id, { brief });
  let ts = 1000;
  for (const p of pages) await db.messages.append(story.id, { ts: ts++, ...p });
  await saveState(story.id, state);
  return story.id;
}
async function contentOf(id) {
  const st = await loadState(id);
  return JSON.stringify({ brief: (await db.stories.get(id)).brief, pages: (await db.messages.list(id)).map((m) => [m.text, (m.swipes || []).map((v) => v.text)]), record: (await db.settings.get('memory:' + id))?.nodes, characters: st.characters, knowledge: st.knowledge, threads: st.threads, corrections: st.spellingCorrections || {} });
}
const ledger = (people, more = []) => applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Jovan' }, ...people.map((p) => ({ type: 'people.set', field: 'core', byHand: true, ...p })), ...more]).state;
/* the ledger's half of a spelling card, exactly as the Housekeeper writes it inside its atomic edit */
const spelled = (state, from, to) => applyMutations(state, [{ type: 'people.rename', from, to, spelling: true, coordinated: true, story: true, byHand: true, cause: 'the writer: the name is spelled ' + to }]);
/* pages of play that never touch the corrected person: four ledger lines each, so the log (its newest 200) rolls over */
async function playOn(id, pages) {
  let st = await loadState(id);
  const start = st.page + 1;
  for (let i = 0; i < pages; i += 1) st = applyMutations({ ...st, page: start + i }, [
    { type: 'clock.advance', minutes: 10, reason: 'time passes' },
    { type: 'knowledge.add', name: 'Jovan', fact: 'Passing fact ' + i },
    { type: 'presence.enter', name: 'Passerby ' + i },
    { type: 'presence.leave', name: 'Passerby ' + i },
  ]).state;
  await saveState(id, st);
  return st;
}

test('M752-S1 A NAME THAT IS ALSO A WORD IS NOT CORRECTED STORY-WIDE: May to Mae (a month), Rose to Roze (“she rose” on a storyteller page), Will to Wil (“you will rest” in the brief of a tale with no page yet) and a lowercase old spelling are refused before anything changes, with the reason; the brief, every page, the record and the ledger stay exactly as they were', () => {
  const r = card('ordinary');
  eq(r.may.result.rejected, 1, 'the May card is refused'); eq(r.may.result.applied, 0, 'nothing applied');
  eq(r.may.card.status, 'refused', 'the saved card says refused');
  assert(/“May” is also the name of a month/.test(r.may.card.words) && /Nothing was changed/.test(r.may.card.words), 'the reason, in plain words — ' + r.may.card.words);
  assert(r.may.unchanged, 'brief, pages, versions, record and ledger untouched');
  eq(r.rose.result.rejected, 1, 'the Rose card is refused');
  assert(/“Rose” is also an ordinary word in this story/.test(r.rose.card.words) && /Rose rose from her seat/.test(r.rose.card.words), 'the word is quoted where the storyteller used it — ' + r.rose.card.words);
  assert(r.rose.unchanged, 'nothing changed');
  eq(r.young.result.rejected, 1, 'a tale with no storyteller page yet: the brief’s own “will” refuses it');
  assert(/the brief: “….*You will rest here/.test(r.young.card.words), 'quoted from the brief — ' + r.young.card.words);
  assert(r.young.unchanged, 'nothing changed');
  eq(r.typed.result.rejected, 1, 'an old spelling given in lower case is refused'); assert(/written in lower case/.test(r.typed.card.words), r.typed.card.words);
  assert(r.typed.unchanged, 'nothing changed');
});

test('M752-S2 THE NAME IS CORRECTED AS A NAME: Aakeno to Akeno changes the name as written and in capitals (AAKENO → AKENO, the capitals kept) in the brief, the writer’s page, every version, the record and the ledger; every “may” and the lowercase “aakeno” he typed stay as they were; the card is verified', () => {
  const r = card('name');
  eq(r.result.applied, 1, 'applied — ' + r.result.words); eq(r.card.verification, 'verified', 'verified from the saved rows');
  eq(r.brief, 'Akeno may come. AKENO is the name on the gate.', 'the brief');
  eq(r.page0, 'I greet Akeno; you may sit. aakeno, I typed.', 'his page: the name as a name, his ordinary words and his lowercase typing kept');
  eq(r.page1, '“AKENO!” she called. Akeno’s book lay open; you may read it.', 'the shown version, capitals kept');
  eq(JSON.stringify(r.versions), JSON.stringify(['Akeno waits.', '“AKENO!” she called. Akeno’s book lay open; you may read it.']), 'every version');
  eq(r.record, 'Akeno arrived. He may stay.', 'the record');
  eq(r.core, 'Akeno may be a scholar.', 'the ledger page'); assert(!r.oldPage, 'no page under the old spelling');
  eq(r.fact, 'AKENO is carved on the gate', 'a fact in capitals');
});

test('M752-S3 LATER WRITES FOLLOW THE NAME, NEVER THE WORD: after a correction the readers’ writes are corrected where the old spelling stands as the name (as written, or in capitals), and an ordinary word that shares its letters is written as the reader wrote it — even under a May to Mae correction already in a ledger', () => {
  const corrected = spelled(ledger([{ name: 'Aakeno', text: 'A scholar.' }]), 'Aakeno', 'Akeno');
  eq(corrected.applied.length, 1, 'the correction’s ledger half lands');
  const later = applyMutations(corrected.state, [{ type: 'people.note', name: 'Aakeno', field: 'thread', text: 'Aakeno may leave the inn tonight' }, { type: 'knowledge.add', name: 'Jovan', fact: 'AAKENO may flood the road' }]);
  eq(later.rejected.length, 0, 'both writes land');
  eq(JSON.stringify(later.state.characters.Akeno.threads), JSON.stringify(['Akeno may leave the inn tonight']), 'the name corrected, “may” kept');
  eq(later.state.knowledge.Jovan.at(-1).fact, 'AKENO may flood the road', 'capitals corrected in capitals, “may” kept');
  assert(!later.state.characters.Aakeno, 'the old spelling never makes a page again');
  /* a correction map holding a word (one saved before M752 refused such cards) no longer rewrites the word in what the readers write */
  const st = spelled(ledger([{ name: 'May', text: 'A healer from the north.' }]), 'May', 'Mae').state;
  eq(JSON.stringify(st.spellingCorrections), JSON.stringify({ May: 'Mae' }), 'the correction map');
  const reader = applyMutations(st, [{ type: 'people.note', name: 'Mae', field: 'thread', text: 'She may leave the inn tonight' }, { type: 'knowledge.add', name: 'Jovan', fact: 'May says the road may flood' }]);
  eq(JSON.stringify(reader.state.characters.Mae.threads), JSON.stringify(['She may leave the inn tonight']), 'a thread with “may” is stored as written');
  eq(reader.state.knowledge.Jovan.at(-1).fact, 'Mae says the road may flood', 'the name follows, the word stays');
});

test('M752-S4 A CORRECTION ONTO A FULLER NAME IS SAID ONCE: Renji to Renji Abarai lands and is verified; each version and each line is rewritten once and “Renji Abarai” already written stays as it is (no “Renji Abarai Abarai” on the page, in the record or the ledger); a later write, a fold and a story write laid again over an older ledger change nothing more', () => {
  const r = card('fuller');
  eq(r.result.applied, 1, 'applied, not “incomplete” — ' + r.result.words); eq(r.card.verification, 'verified', 'verified');
  eq(r.page, 'Renji Abarai smiled. Renji Abarai bowed to the captain.', 'the shown version once');
  eq(r.version, 'Renji Abarai smiled. Renji Abarai bowed to the captain.', 'the version once');
  eq(r.record, 'Renji Abarai bowed; Renji Abarai smiled.', 'the record');
  eq(r.core, 'Renji Abarai is lieutenant of the Sixth Division.', 'the ledger page');
  eq(JSON.stringify(r.threadsAfter), JSON.stringify(['owes Renji Abarai’s captain a report']), 'a line already in the full name stays');
  eq(JSON.stringify(r.laterRejected), '[]', 'every later write lands');
  const threads = JSON.stringify(['owes Renji Abarai’s captain a report', 'will meet Renji Abarai’s sister at the gate', 'Renji Abarai lost his sword at the river']);
  eq(JSON.stringify(r.threadsLater), threads, 'a later write in the full name stays once; one in the short name follows once');
  eq(JSON.stringify(r.relationships), JSON.stringify(['Renji Abarai']), 'the short name lands on the corrected page');
  assert(r.foldSame, 'a fold rebuilds the same page');
  eq(JSON.stringify(r.foldTwiceThreads), threads, 'a second fold adds nothing');
  eq(r.laidCore, 'Renji Abarai is lieutenant of the Sixth Division.', 'the correction laid over an older ledger, once');
  eq(JSON.stringify(r.laidThreads), JSON.stringify(['owes Renji Abarai’s captain a report']), 'and its full-name line untouched');
});

test('M752-S5 THE SAME FAULT IN AN ORDINARY RENAME: the page join “Rukia” → “Rukia Kuchiki” (M419) leaves every line already in her full name as it is, renames the short one, and counts only the places that changed', () => {
  const st = applyMutations({ ...emptyState(), page: 5 }, [{ type: 'mc.set', name: 'Ichigo' }, { type: 'people.set', name: 'Rukia', field: 'core', text: 'Rukia Kuchiki is a shinigami of the Thirteenth.' }, { type: 'people.note', name: 'Rukia', field: 'thread', text: 'Rukia owes Ichigo a favour' }, { type: 'knowledge.add', name: 'Ichigo', fact: 'Rukia Kuchiki gave him her powers' }]).state;
  const r = applyMutations(st, [{ type: 'people.rename', from: 'Rukia', to: 'Rukia Kuchiki', cause: 'one person, one name in every book' }]);
  eq(r.applied.length, 1, 'the join lands');
  const page = r.state.characters['Rukia Kuchiki'];
  eq(page.core, 'Rukia Kuchiki is a shinigami of the Thirteenth.', 'her full name stays once');
  eq(JSON.stringify(page.threads), JSON.stringify(['Rukia Kuchiki owes Ichigo a favour']), 'the short name follows');
  eq(r.state.knowledge.Ichigo[0].fact, 'Rukia Kuchiki gave him her powers', 'a fact in her full name stays once');
  assert(/ 2 places in the ledger follow/.test(r.applied[0].words), 'two places changed (her page’s key and one line) — ' + r.applied[0].words);
});

test('M752-S6 A CORRECTION CAN STILL BE TAKEN BACK WHEN ITS LOG LINE IS GONE: seventy pages on (the log keeps its newest 200 lines), the Housekeeper’s undo takes Riass back everywhere from its own receipt — the brief, the page, the record, her page, her standing, what Jovan knows, the correction map — keeps every later write, journals the take-back under the correction’s page, and a fold rebuilds the same ledger', () => {
  const r = card('rollover');
  eq(r.result.applied, 1, 'applied — ' + r.result.words); eq(r.card.verification, 'verified', 'verified');
  assert(r.lineStood, 'the correction stands, with its log line');
  assert(r.lineGone, 'seventy pages on, its line has left the log');
  assert(r.undo.ok, 'taken back — ' + r.undo.words);
  eq(r.undo.words, 'The spelling correction was taken back.', 'said plainly');
  eq(r.brief, 'Riass leads the club.', 'the brief'); eq(r.page, 'Riass smiled at him.', 'the page'); eq(r.record, 'Riass smiled.', 'the record');
  assert(r.pageBack, 'her page is under the old spelling again'); assert(r.coreBack, 'her page as it was'); assert(r.standingBack, 'her standing');
  eq(r.firstFact, 'Riass keeps a chess set', 'what Jovan knew of her');
  assert(r.laterFactsKept, 'every later fact kept, as written'); assert(r.laterPagesKept, 'every later page kept');
  eq(JSON.stringify(r.map), '{}', 'the correction map lets the old spelling be');
  eq(r.journalBack.type, 'undo.apply', 'the take-back is journaled'); eq(r.journalBack.p, r.journalBack.linePage, 'under the correction’s own page'); assert(r.journalBack.story, 'and outlives a fold as the correction does');
  assert(r.logBack, 'the log says what was taken back');
  assert(r.foldSame, 'a fold rebuilds her page, her standing and what Jovan knows'); eq(JSON.stringify(r.foldMap), '{}', 'and the map');
  assert(r.receiptUndone, 'the receipt is marked taken back');
});

test('M752-S7 WHAT CANNOT BE TAKEN BACK IS SAID, AND NOTHING IS GUESSED: her page changed after the correction — the take-back from the receipt is refused, naming it, and nothing moves; a receipt saved before M752 (no copy of the ledger’s half) takes back the brief, the page and the record and says plainly that the ledger keeps the new spelling', () => {
  const r = card('refusals');
  eq(r.driftApplied, 1, 'the correction landed');
  assert(!r.drift.ok && r.drift.refused, 'refused');
  eq(r.drift.words, 'Not taken back: ledger.characters.Rias changed after the correction.', 'the part that moved, named');
  assert(r.drift.unchanged, 'nothing moved');
  eq(r.older.applied, 1, 'the older correction landed');
  assert(r.older.ok, r.older.words);
  assert(/^Taken back in the brief, one page and the record\. The ledger keeps the new spelling/.test(r.older.words), 'what was and was not taken back, plainly — ' + r.older.words);
  eq(r.older.brief, 'Riass leads the club.', 'the brief'); eq(r.older.page, 'Riass smiled at him.', 'the page'); eq(r.older.record, 'Riass smiled.', 'the record');
  assert(r.older.ledgerKept, 'the ledger is left as it stands');
  eq(JSON.stringify(r.older.map), JSON.stringify({ Riass: 'Rias' }), 'and keeps routing the old spelling to the name it holds');
});

test('M752-S8 THE SAME LOG, ANY LEDGER CARD: a card’s ledger change whose log line has left the ledger’s log is not reported as taken back — its take-back is refused, saying why, and nothing moves (it said “Taken back” and the change stayed)', async () => {
  const id = await tale({ pages: [{ id: 'm752s8a', role: 'assistant', text: 'Akeno smiled.' }], state: ledger([{ name: 'Akeno', text: 'A shrine maiden.' }]) });
  const turn = await hk.housekeeperTurn({ storyId: id, writerText: 'Akeno is the vice president of the club.', call: async () => ({ text: 'Set. <ledits>[{"type":"people.set","name":"Akeno","field":"core","text":"A shrine maiden and the vice president of the Occult Research Club."}]</ledits>' }) });
  assert(turn.ok, turn.error);
  const applied = await hk.applyAllPending(turn.session, id);
  eq(applied.applied, 1, 'the card lands — ' + applied.words);
  const changed = 'A shrine maiden and the vice president of the Occult Research Club.';
  eq((await loadState(id)).characters.Akeno.core, changed, 'the card’s change');
  await playOn(id, 70);
  const held = await contentOf(id);
  const undone = await hk.undoLatest(await hk.loadSession(id), id);
  assert(!undone.ok && undone.refused, 'not reported as taken back — ' + undone.words);
  assert(/has left the ledger’s log/.test(undone.words) && /The change stands/.test(undone.words), 'the reason, plainly — ' + undone.words);
  eq((await loadState(id)).characters.Akeno.core, changed, 'the change stands, as said');
  eq(await contentOf(id), held, 'nothing moved');
  assert(!(await hk.loadSession(id)).batches.at(-1).undone, 'the receipt is not marked taken back');
});

test('M752-S9 A LATER PAGE THAT REPEATS THE OLD SPELLING IS CORRECTED BY THE SAME CARD AGAIN: the ledger already follows the correction, which is already so — never “nothing in the ledger is called Aakeno” — so the new page is corrected, verified, and its take-back puts back only that page', () => {
  const r = card('repeat');
  eq(r.first.applied, 1, 'the first correction — ' + r.first.words);
  eq(r.again.applied, 1, 'the second correction lands — ' + r.again.words); eq(r.card.verification, 'verified', 'verified');
  eq(JSON.stringify(r.pages), JSON.stringify(['Akeno waits.', 'Akeno came back at dusk.']), 'the new page corrected');
  assert(r.ledgerSame, 'the ledger, already right, untouched');
  assert(r.undo.ok, r.undo.words);
  eq(JSON.stringify(r.pagesAfterUndo), JSON.stringify(['Akeno waits.', 'Aakeno came back at dusk.']), 'its take-back puts back only the page it corrected');
  assert(r.ledgerSameAfterUndo, 'and leaves the ledger as the first correction made it');
});
