/* Cozy Tavern — harness laws of M675. His four asks: the footer's buttons gone, the page number no longer on the words,
 * the benchmark checked and its judge folded, and the audit of everything the session before had changed. What is the
 * thread's doing is walked (tests/dom/run.mjs) and what is the screen's is measured in a real browser (tests/pagemark.py);
 * these are the parts that are engines and readers. Every law here RUNS the code and asserts on what came back. */
import './idb-shim.mjs';
import { refereeStep } from '../../js/agents/referee.js';
import { test, assert, eq } from './lib.mjs';
import { db, dropCaches } from '../../js/store.js';
import { judgedMoment, pickMoment } from '../../js/agents/benchrun.js';
import { gradeMessages, duelMessages } from '../../js/agents/judge.js';
import { shortcutsText, shortcutLaw } from '../../js/commands.js';
import { keepSent } from '../../js/sent.js';
import { emptyState, loadState, saveState, snapshotState, loadSnapshots, foldJournal, readMark, markPageRead, oldestUnread, journalReaches } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { wireable } from '../../js/assemble/stack.js';
import { finishPage, tidyPage, isRuleEcho, cutRuleEchoTail } from '../../js/ui/pageshape.js';
import { attachedBlock, typedWords, attachedPart, parseCommand, asideAt } from '../../js/commands.js';
import { enqueueWork, setSleepForHarness, MAX_RETRIES, workIsRunning, stopWork, queuedCount } from '../../js/agents/queue.js';
import { loadWorkerStatus } from '../../js/agents/status.js';
import { noteWork, pendingWork } from '../../js/agents/extractor.js';
import {
  loadMemory, saveMemory, applyAuditFixes, buildFoldMessages, lineWithDetail, redoLine, maybeSummarize, memoryWithoutPage, keeperOnFor,
} from '../../js/agents/memory.js';
import {
  nextStretch, auditStretch, auditWaits, forgetAuditTrouble, buildStretchMessages, ledgerForPages, stretchWords, auditProgress, STRETCH_CHARS, UNREADABLE_TRIES,
} from '../../js/agents/continuous.js';
import { isHouseTidy } from '../../js/engine/pagepatch.js';
import { partLookAlikes } from '../../js/engine/people.js';
import { lineIsHis } from '../../js/agents/continuous.js';
import { applyProposal, undoLatest } from '../../js/agents/housekeeper.js';
import { parseSTChat } from '../../js/import/chats.js';

const H = (min) => '[The gate — Monday, March 3, 2025 | 09:' + String(min).padStart(2, '0') + ' | clear]\n\n';

test('M675-1 THE JUDGE IS TOLD THE MOMENT THE PAGE ANSWERED (his: “the benchmark, is it already good? Please check it”): a page that answers a shortcut is judged with what that shortcut asks; a “Go on” page with “Go on.” — never the move of the turn before; a page after an out-of-character exchange against the last page of the STORY; an opening page against no move at all', () => {
  const all = [
    { id: 'a0', role: 'assistant', text: H(0) + 'OPENING: the gate stood open.' },
    { id: 'u1', role: 'user', text: 'I walk through the gate.' },
    { id: 'a1', role: 'assistant', text: H(5) + 'STORY-ONE: the yard was empty.' },
    { id: 'u2', role: 'user', text: '#p', typed: '#p' },
    { id: 'a2', role: 'assistant', text: H(6) + 'STORY-TWO: he kept walking; a door opened.' },
    { id: 'n3', role: 'user', text: 'continue', hidden: true },
    { id: 'a3', role: 'assistant', text: H(8) + 'STORY-THREE: Kara stepped out.' },
    { id: 'u4', role: 'user', text: '((who is Kara?))', ooc: true },
    { id: 'a4', role: 'assistant', text: 'ASIDE-ANSWER: she is the steward; she could betray him later.', ooc: true },
    { id: 'u5', role: 'user', text: 'I greet her.' },
    { id: 'a5', role: 'assistant', text: H(9) + 'STORY-FOUR: Kara bowed.' },
    { id: 'u6', role: 'user', text: '#time skip to dusk', typed: '#time skip to dusk' },
    { id: 'a6', role: 'assistant', text: H(59) + 'STORY-FIVE: dusk came.' },
  ];
  /* a plain move: his words, nothing added */
  let m = judgedMoment(all, 'a1');
  eq(m.move, 'I walk through the gate.'); eq(m.asks, '', 'a plain move asks nothing more than it says');
  assert(/OPENING/.test(m.before), 'the page before: ' + m.before);
  /* a shortcut: the judge is handed its own line of the standing words */
  m = judgedMoment(all, 'a2');
  eq(m.move, '#p', 'his move, as he typed it');
  assert(/^#p — exactly ONE beat: MC continues his last action/.test(m.asks), 'and what #p asks: ' + m.asks.slice(0, 80));
  assert(shortcutsText().includes(m.asks), 'the very line the storyteller’s standing words carry');
  /* "Go on": the hidden nudge is the move — it used to be the move of the turn before ("#p"), already answered */
  m = judgedMoment(all, 'a3');
  eq(m.move, 'Go on.', 'a page told by “Go on” answers “Go on.”');
  assert(/^#continue, or a bare “Go on\.” — play the CURRENT situation forward/.test(m.asks), 'with what going on asks: ' + m.asks.slice(0, 80));
  assert(/STORY-TWO/.test(m.before), 'against the page before it');
  /* after an out-of-character exchange: the page before is the last page of the STORY */
  m = judgedMoment(all, 'a5');
  eq(m.move, 'I greet her.');
  assert(/STORY-THREE/.test(m.before) && !/ASIDE-ANSWER/.test(m.before), 'the out-of-character answer is not “the page before”: ' + m.before);
  /* a shortcut with words after it: the line says where its words are, and does not repeat them */
  m = judgedMoment(all, 'a6');
  eq(m.move, '#time skip to dusk');
  assert(/^#time skip — jump to the time or moment named after the shortcut/.test(m.asks) && !/dusk/.test(m.asks), m.asks.slice(0, 120));
  /* an opening: nothing of his stands before it */
  m = judgedMoment(all, 'a0');
  eq(JSON.stringify(m), JSON.stringify({ before: '', move: '', asks: '' }), 'an opening page answers no move');
  /* a page of the storyteller's right after its own page (an import, a nudge long gone): he said nothing there */
  eq(judgedMoment([...all, { id: 'a7', role: 'assistant', text: H(59) + 'STORY-SIX.' }], 'a7').move, '', 'no move of his between two of its pages');
  /* one of his own messages folded away is not the move */
  { const folded = all.map((x) => (x.id === 'u5' ? { ...x, hidden: true } : x));
    const got = judgedMoment(folded, 'a5');
    assert(got.move !== 'I greet her.', 'a message folded away is not handed to the judge as his move: ' + got.move); }
  /* shortcutLaw: only the shortcuts have a line */
  for (const t of ['I walk in.', '#roll', '#unknown word', '((slow down))', '#question why']) eq(shortcutLaw(t), '', JSON.stringify(t) + ' has no line');
  /* and the judge is sent it — with the rule that says what it is */
  const sent = gradeMessages({ before: 'B', move: '#p', asks: shortcutLaw('#p'), notes: 'N', page: 'P' });
  assert(/<his move>\n#p\n<\/his move>\n\n<what his shortcut asks of the storyteller>\n#p — exactly ONE beat/.test(sent.user), 'in the judge’s request, right after his move: ' + sent.user.slice(0, 200));
  assert(/never hold against the page what the shortcut itself asked for/.test(sent.system), 'and the judge is told how to read it');
  const plain = gradeMessages({ before: 'B', move: 'I walk in.', notes: 'N', page: 'P' });
  assert(!/what his shortcut asks/.test(plain.user), 'a plain move carries no such part');
  const duel = duelMessages({ before: 'B', move: 'Go on.', asks: shortcutLaw('#continue'), notes: 'N', first: 'X', second: 'Y' });
  assert(/<what his shortcut asks of the storyteller>\n#continue, or a bare/.test(duel.user) && /never hold against the page/.test(duel.system), 'head to head is told the same');
});

test('M675-2 A RUN NAMES THE PAGE BY ITS OWN NUMBER, AND HANDS THE JUDGE THE SAME MOMENT: a tale whose first pages kept no request (an import) — the replayed page is called by the number the thread shows it under, not its place among the pages that kept one; an out-of-character answer is never the page replayed', async () => {
  await dropCaches();
  for (const s of await db.stories.list()) await db.stories.remove(s.id).catch(() => {});
  const st = await db.stories.create({ title: 'An imported tale, played on' });
  /* three exchanges brought in from elsewhere: no receipt, no kept request */
  for (let i = 1; i <= 3; i += 1) {
    await db.messages.append(st.id, { role: 'user', text: 'Old move ' + i + '.' });
    await db.messages.append(st.id, { role: 'assistant', text: H(i) + 'OLD-PAGE ' + i + '.' });
  }
  /* an out-of-character exchange whose answer kept its request and carries no mark of its own (one from before the mark was kept) */
  await db.messages.append(st.id, { role: 'user', text: '((where could this go?))' });
  await keepSent({ id: 'snt_aside', storyId: st.id, slots: [{ name: 'The state of things', text: 'ASIDE-STATE' }], requests: [{ url: 'u', body: { messages: [{ role: 'system', content: 'S' }, { role: 'user', content: '((where could this go?))' }] } }] });
  await db.messages.append(st.id, { role: 'assistant', text: 'ASIDE-ANSWER: to the docks, perhaps.', receipt: { sentId: 'snt_aside', connId: 'c1', totalTokens: 10, slots: [] } });
  /* then one page told here, by a shortcut, its request kept */
  await db.messages.append(st.id, { role: 'user', text: '#p', typed: '#p' });
  await keepSent({ id: 'snt_story', storyId: st.id, slots: [{ name: 'The state of things', text: 'STATE-AS-SENT: the yard, 09:03.' }], requests: [{ url: 'u', body: { messages: [{ role: 'system', content: 'S' }, { role: 'user', content: '#p' }] } }] });
  const page = await db.messages.append(st.id, { role: 'assistant', text: H(4) + 'NEW-PAGE: he kept walking.', receipt: { sentId: 'snt_story', connId: 'c1', totalTokens: 10, slots: [] } });
  for (let i = 0; i < 12; i += 1) {
    const picked = await pickMoment({ rnd: Math.random });
    assert(picked, 'a page is found');
    eq(picked.sentId, 'snt_story', 'the page of the STORY — never the out-of-character answer');
    /* the thread numbers every storyteller page that shows: three old ones, the aside's answer, then this one */
    eq(picked.pageNumber, 5, 'called by its own number in the tale (it was “page 2”: its place among the pages that kept a request)');
    eq(picked.context.move, '#p'); assert(/^#p — exactly ONE beat/.test(picked.context.asks), 'the judge gets what #p asks');
    assert(/OLD-PAGE 3/.test(picked.context.before) && !/ASIDE-ANSWER/.test(picked.context.before), 'and the last page of the story as the page before: ' + picked.context.before);
    eq(picked.context.notes, 'STATE-AS-SENT: the yard, 09:03.', 'where things stood, as the storyteller was sent it');
  }
  assert(page && page.id, 'fixture');
  await db.stories.remove(st.id);
});

test('M675-3 WHAT HE TYPED TRAVELS WHOLE, AND A FILE ATTACHED TO A SHORTCUT TRAVELS WITH IT: a “#story” with a long concept reaches the storyteller entire (it was cut at 4,000 characters — the page showed all of it); a shortcut with a text file attached is sent with the file, for a page kept before this build too; a shortcut alone still travels exactly as typed, and a plain message with a file exactly as its page', async () => {
  await dropCaches();
  const st = await db.stories.create({ title: 'what travels' });
  /* a long concept: kept whole, sent whole */
  const concept = '#story ' + 'A keeper of a northern light finds a door beneath the lamp room, and what is behind it. '.repeat(72).trim();
  assert(concept.length > 6000, 'fixture: a concept longer than the old limit (' + concept.length + ')');
  const long = await db.messages.append(st.id, { role: 'user', text: concept, typed: concept });
  await dropCaches();
  const back = (await db.messages.list(st.id)).find((m) => m.id === long.id);
  eq(back.typed.length, concept.length, 'kept whole');
  eq(wireable([back])[0].content, concept, 'and sent whole — the storyteller reads the concept he wrote, to its last word');
  /* a shortcut with a file: the file's part of the page rides after what he typed */
  const FILE = 'OUTLINE-MARK the keeper finds a door.\nHe does not open it.';
  const withFile = { id: 'u1', role: 'user', text: '#p\n\n' + attachedBlock('outline.md', FILE), typed: '#p' };
  eq(wireable([withFile])[0].content, '#p\n\n[Attached file: outline.md]\n' + FILE, 'the shortcut and the file (it was “#p” alone)');
  /* a question out of character, and an aside, alike */
  for (const typed of ['#question what does this outline leave out?', '((read this first))', '// see the notes']) {
    const got = wireable([{ id: 'u2', role: 'user', text: typed + '\n\n' + attachedBlock('notes.md', FILE), typed, ooc: true }])[0].content;
    assert(got.startsWith(typed + '\n\n[Attached file: notes.md]\n') && got.endsWith(FILE), typed + ': sent with its file');
  }
  /* unchanged: a shortcut alone travels exactly as typed; a plain message with a file exactly as its page; the file is never sent twice */
  eq(wireable([{ id: 'u3', role: 'user', text: '#p', typed: '#p' }])[0].content, '#p', 'a shortcut alone: as typed, nothing after it');
  const plain = { id: 'u4', role: 'user', text: 'Read my notes.\n\n' + attachedBlock('notes.md', FILE) };
  eq(wireable([plain])[0].content, plain.text, 'a plain message with a file: its page, as before');
  const already = { id: 'u5', role: 'user', text: '#p\n\n' + attachedBlock('outline.md', FILE), typed: '#p\n\n' + attachedBlock('outline.md', FILE) };
  eq(wireable([already])[0].content.split('OUTLINE-MARK').length - 1, 1, 'a page whose typed words already hold the file is not given it twice');
  /* his own words, read back out of a page that carries a file — and its command with them */
  eq(typedWords(withFile.text), '#p'); eq(attachedPart(withFile.text), '[Attached file: outline.md]\n' + FILE);
  eq(typedWords('No file here.'), 'No file here.'); eq(attachedPart('No file here.'), '');
  eq(typedWords(attachedBlock('alone.txt', 'x')), '', 'a file sent alone: no words of his');
  eq(parseCommand(typedWords(withFile.text)).kind, 'beat', 'the command is read from his words');
  eq(parseCommand(withFile.text).kind, null, '(read from the whole page it was no command at all — which is why “try again” asked it plainly)');
  /* M675 (the second reading): the NAME is his, and a name may hold a bracket — "notes [v2].md" ended the mark at its
   * first "]", so the page was not seen to carry a file: the shortcut travelled alone, the file's lines were his move */
  for (const name of ['notes [v2].md', 'a].txt', '[draft] ch1 [final].md', 'odd\nname.md', 'x'.repeat(120) + '].md']) {
    const page = '#p\n\n' + attachedBlock(name, FILE);
    eq(typedWords(page), '#p', JSON.stringify(name) + ': his words are what stands before the file');
    assert(attachedPart(page).startsWith('[Attached file: ') && attachedPart(page).endsWith(']\n' + FILE), JSON.stringify(name) + ': and the file is the rest: ' + JSON.stringify(attachedPart(page).slice(0, 60)));
    eq(wireable([{ id: 'b1', role: 'user', text: page, typed: '#p' }])[0].content, page, JSON.stringify(name) + ': the shortcut travels with its file');
    eq(typedWords(attachedBlock(name, FILE)), '', JSON.stringify(name) + ': sent alone, no words of his');
  }
  eq(attachedBlock('odd\nname.md', 'x'), '[Attached file: odd name.md]\nx', 'a name stands on one line');
  eq(attachedBlock('', 'x'), '[Attached file: file]\nx'); eq(attachedBlock('   ', 'x'), '[Attached file: file]\nx');
  eq(typedWords('He reads the sign: [Attached file: none] it says.\nAnd goes on.'), 'He reads the sign: [Attached file: none] it says.\nAnd goes on.', 'words that only mention the mark are his words');
  /* an aside with a file, on a page that carries no mark of its own (an import): still an aside */
  const pages = [{ id: 'q', role: 'user', text: '((where next?))\n\n' + attachedBlock('map.md', 'the docks') }, { id: 'a', role: 'assistant', text: 'To the docks, perhaps.' }];
  assert(asideAt(pages, 0) && asideAt(pages, 1), 'an out-of-character question with a file attached, and its answer, are out of character');
  await db.stories.remove(st.id);
});

test('M675-4 THE WINDOW’S RULE SAID BACK COMES OFF A PAGE — AND NOTHING ELSE DOES (the audit of M669): a page that tells of a place called “the World Beyond” keeps every sentence of it (four were taken for the rule); and when the rule does close a paragraph, the paragraph keeps its own line breaks — a page whose paragraphs stand one line apart is still three paragraphs (it came out one block), a note keeps its lines', () => {
  const HEAD = '[Yard — Monday, June 2, 2025 | 08:00 | rain | coat | standing]';
  const filler = 'The rain kept on over the yard and the lamps along the wall burned low. '.repeat(5).trim();
  const page = HEAD + '\n\n' + filler;
  /* story that names the place — as a page's last paragraph, and as the last sentence of one */
  const STORY = [
    'The World Beyond is over there, past the ridge, and the old man pointed at it with his cane.',
    'The World Beyond is closed to the living, the priest had told her once.',
    'She thought of the World Beyond, where nothing follows a soul but its own name.',
    'In the World Beyond the river stops there and the dead wait.',
    'The World Beyond lay where the cut in the hills opened onto the sea.',
    'The World Beyond stays here, in the telling, for as long as anyone tells it.',
    'Nothing follows the World Beyond into the daylight but its cold.',
    'Past the gate was what they called the World Beyond; she reached it at dusk, and nothing follows.',
  ];
  for (const told of STORY) {
    eq(isRuleEcho(told), false, 'story: ' + told);
    eq(finishPage(page + '\n\n' + told).text, page + '\n\n' + told, 'kept as the page’s last paragraph: ' + told);
    eq(finishPage(page + ' ' + told).text, page + ' ' + told, 'and as its last sentence: ' + told);
    eq(cutRuleEchoTail(filler + ' ' + told), null, 'nothing is cut from that paragraph: ' + told);
  }
  /* the rule said back, in the turns it takes */
  const ECHO = [
    'The World Beyond stays where it cut — nothing follows it, and nobody in 1-D learns anything from it.',
    'The Window Beyond the Page sits where the cut happens, and nothing follows it.',
    'The World Beyond ends where the cut is.',
    'The World Beyond is closed. Nothing follows it.',
    'The World Beyond ends here.',
    'Nothing follows The World Beyond.',
    '*The World Beyond stays where it cut, and nothing follows.*',
  ];
  for (const echo of ECHO) {
    eq(isRuleEcho(echo), true, 'the rule said back: ' + echo);
    eq(finishPage(page + '\n\n' + echo).text, page, 'comes off as the last paragraph: ' + echo);
  }
  /* closing a paragraph whose lines stand one break apart: the lines stay */
  const single = HEAD + '\nRukia crossed the yard. She did not look back.\nRenji waited by the gate. He said nothing at all.\n' + filler;
  const withEcho = single + ' The World Beyond stays where it cut. Nothing follows it.';
  eq(finishPage(withEcho).text, single, 'the paragraph is cut where the rule begins, and is otherwise as it was written');
  eq(tidyPage(withEcho, {}).text, tidyPage(single, {}).text, 'so the page is the page it would have been without the rule on it');
  eq(tidyPage(withEcho, {}).text.split('\n\n').length, 4, 'a header and three paragraphs (it came out a header and one block)');
  const note = page + '\n\nHe read the note twice.\nCome at dusk.\nBring no one.';
  eq(finishPage(note + '\nThe World Beyond stays where it cut — nothing follows it.').text, note, 'a note keeps its lines');
  const cut = cutRuleEchoTail('He read the note twice.\nCome at dusk.\nBring no one. The World Beyond stays where it cut. Nothing follows it.');
  eq(JSON.stringify(cut), JSON.stringify({ kept: 'He read the note twice.\nCome at dusk.\nBring no one.', cut: 'The World Beyond stays where it cut. Nothing follows it.' }), 'what is kept, and what is cut');
  /* a window under the story, the rule said back under the window's own prose */
  const windowed = page + '\n\n*** The World Beyond ***\n[The staff room — Monday, April 7 | 08:41]\nThe vice-principal counted the registers twice.\nHe found one too many.';
  eq(finishPage(windowed + ' The World Beyond stays where it cut — nothing follows it.').text, windowed, 'the window keeps its marker, its line of place and hour, and the lines of its prose');
});

test('M675-5 A LEDGER FOLDED BACK TO A PAGE HAS READ THAT PAGE (the audit of M674: every “try again” sent the page reader to the page BEFORE the one told again): folded to page T from the checkpoint made when he sent the message after it, the mark stands at T — its writes are back from the journal — and nothing before T+1 is owed a reading; a page that had not been read before the fold is still owed one; pages read out of turn stay so up to T; a fold the journal cannot reach keeps the checkpoint’s own mark', async () => {
  /* turns as a send and its page reader make them: the stamp set to the coming page and a checkpoint taken at the send (the
   * mark still where it stood), then — when the reader got through — the page read and marked */
  const play = async (sid, reads) => {
    await saveState(sid, emptyState());
    for (let k = 0; k < reads.length; k += 1) {
      const st = await loadState(sid);
      st.page = k;
      await snapshotState(sid, 'u' + k, st);
      await saveState(sid, st);
      if (!reads[k]) continue;
      const fresh = await loadState(sid);
      const { state: next } = applyMutations(fresh, [{ type: 'clock.set', year: 2025, month: 6, day: 2, hour: 8 + k, minute: 0 }, { type: 'place.set', name: 'Yard ' + k }]);
      markPageRead(next, k);
      await saveState(sid, next);
    }
    return { now: await loadState(sid), snaps: await loadSnapshots(sid) };
  };
  const sid = 'm675-fold';
  await play(sid, [true, true, true]);
  const now = await loadState(sid);
  const snaps = await loadSnapshots(sid);
  eq(readMark(now), 2, 'fixture: three pages read');
  eq(snaps.map((e) => e.snap.page + ':' + e.snap.readTo).join(' '), '0:-1 1:0 2:1', 'fixture: each checkpoint was made before its own page was read');
  for (const target of [2, 1, 0]) {
    const f = foldJournal(now, snaps, target, applyMutations);
    eq(f.place && f.place.name, 'Yard ' + target, 'fixture: the fold put page ' + (target + 1) + '’s writes back');
    eq(readMark(f), target, 'folded to page ' + (target + 1) + ', the ledger has read page ' + (target + 1) + ' (it said ' + target + ': the page before)');
    eq(oldestUnread(f, target + 1), -1, 'and no page up to it is owed a reading');
  }
  /* a page that had NOT been read when the fold was asked for is still owed its reading */
  { const behind = { ...JSON.parse(JSON.stringify(now)), readTo: 0, readAhead: [], journal: now.journal.filter((e) => e.p < 1) };
    const f = foldJournal(behind, snaps, 1, applyMutations);
    eq(readMark(f), 0, 'a page the reader never reached is not called read by a fold');
    eq(oldestUnread(f, 2), 1, 'it is the next one owed'); }
  /* pages read out of turn (the reader failed on page 2, then read page 3) stay read, up to the page folded to */
  { const { now: gap, snaps: gapSnaps } = await play('m675-fold-gap', [true, false, true]);
    eq(readMark(gap) + '|' + (gap.readAhead || []).join(','), '0|2', 'fixture: page 2 was never read, page 3 was');
    eq(gapSnaps.map((e) => e.snap.page + ':' + e.snap.readTo).join(' '), '0:-1 1:0 2:0', 'fixture: the checkpoints of that tale');
    const f = foldJournal(gap, gapSnaps, 2, applyMutations);
    eq(readMark(f) + '|' + f.readAhead.join(','), '0|2', 'page 3, read out of turn, is still read; page 2 is still owed');
    eq(oldestUnread(f, 3), 1, 'the next reading owed is page 2');
    const g = foldJournal(gap, gapSnaps, 1, applyMutations);
    eq(readMark(g) + '|' + g.readAhead.join(','), '0|', 'and nothing past the page folded to is kept'); }
  /* a fold the journal cannot reach — the journal was capped and no longer holds every write made after the checkpoint the fold
   * starts from: the pages past that checkpoint cannot be put back, so they are owed a reading — the checkpoint's own mark, as before */
  { const capped = { ...emptyState(), page: 5, readTo: 5, readAhead: [], journalSeq: 10, journal: [{ id: 10, p: 4, m: { type: 'place.set', name: 'Late' } }] };
    const old = [{ id: 'u1', snap: { ...emptyState(), page: 1, readTo: 0, readAhead: [], journal: [], journalSeq: 2 } }];
    const f = foldJournal(capped, old, 3, applyMutations);
    eq(f.page + '|' + readMark(f) + '|' + f.readAhead.length, '3|0|0', 'pages whose writes the journal no longer holds are not called read');
    eq(oldestUnread(f, 4), 1, 'they are read again, from the first one lost'); }
  /* M675 (the second reading): AND A PAGE THE LEDGER HAS MARKED UNREAD ON PURPOSE STAYS OWED ACROSS A FOLD. The mark is
   * lowered on purpose in more than one place (the pages settleAsides finds were passed over as asides; a page edited
   * mid-story). The fold took the HIGHER of the checkpoint's mark and the ledger's own: a "try again" before the idle
   * catch-up had read those pages put the old mark back — nothing owed, the light green, the pages never read. */
  { const { now: all, snaps: allSnaps } = await play('m675-fold-unread', [true, true, true, true, true, true]);
    eq(readMark(all), 5, 'fixture: six pages read');
    const st = JSON.parse(JSON.stringify(all)); st.readTo = 0; st.readAhead = [2, 4, 5]; /* pages 2 and 4 marked unread */
    eq(oldestUnread(st, 6), 1, 'fixture: page 2 is owed a reading');
    assert(journalReaches(st, allSnaps, 4), 'fixture: the fold to page 5 is exact');
    const f = foldJournal(st, allSnaps, 4, applyMutations); /* "try again" on the newest page */
    eq(readMark(f) + '|' + f.readAhead.join(','), '0|2,4', 'the pages marked unread are still unread after the fold (it said mark 4, nothing owed)');
    eq(oldestUnread(f, 5), 1, 'page 2 is still the next reading owed');
    /* and when the fold cannot be exact: the checkpoint's mark is no better than the ledger's own */
    const capped = { ...emptyState(), page: 5, readTo: 0, readAhead: [2, 4, 5], journalSeq: 10, journal: [{ id: 10, p: 4, m: { type: 'place.set', name: 'Late' } }] };
    const old = [{ id: 'u3', snap: { ...emptyState(), page: 3, readTo: 3, readAhead: [], journal: [], journalSeq: 2 } }];
    assert(!journalReaches(capped, old, 4), 'fixture: this fold cannot be exact');
    const g = foldJournal(capped, old, 4, applyMutations);
    eq(readMark(g) + '|' + g.readAhead.join(','), '0|2', 'a fold from a checkpoint keeps what the ledger had marked unread too (it said mark 3)');
    eq(oldestUnread(g, 5), 1, 'page 2 first, then page 4'); }
});

/* ---------- the readers (the audit of M672-M674, slice B) ---------- */
const CONN = { type: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'deepseek-chat', reasoning: { effort: 'off' } };
const sse = (pieces) => { const t = pieces.map((p) => 'data: ' + JSON.stringify(p) + '\n\n').join('') + 'data: [DONE]\n\n'; return { ok: true, status: 200, headers: new Headers(), body: new Response(t).body, text: async () => t }; };
const say = (text) => sse([{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]);
const refuse = (status, words) => ({ ok: false, status, headers: new Headers(), text: async () => JSON.stringify({ error: { message: words } }), json: async () => ({ error: { message: words } }) });
const bodyOf = (opts) => { const b = JSON.parse(opts.body); return { system: String((b.messages.find((m) => m.role === 'system') || {}).content || ''), user: String(b.messages.slice(-1)[0].content || '') }; };
const withFetch = async (impl, fn) => { const prior = globalThis.fetch; globalThis.fetch = impl; try { return await fn(); } finally { globalThis.fetch = prior; } };
const pg = (i, text) => ({ role: i % 2 ? 'assistant' : 'user', text });
const ledgerOf = () => ({ ...applyMutations({ ...emptyState() }, [
  { type: 'mc.set', name: 'Jovan' },
  { type: 'people.set', name: 'Rukia', field: 'core', text: 'a shinigami of the Thirteenth Division' },
  { type: 'people.set', name: 'Renji', field: 'core', text: 'a lieutenant, posted at the gate' },
]).state, page: 19 });
const SIX = [
  'I show Rukia the seal.',
  '[Thirteenth Division barracks — Monday | 09:10]\n\nJovan drew the seal of the Thirteenth from his coat. Rukia stared at it. "You carry the seal," she said. Renji was nowhere near; he had left for the gate at dawn.',
  'I ask her to keep it hidden.',
  'Rukia promised Jovan she would keep the seal hidden from the captains. Her grey eyes did not leave his.',
  'I thank her.',
  'Renji came back from the gate before noon and found them in the yard. He asked nothing.',
];
async function auditTale(title, lines) {
  const st = await db.stories.create({ title: title + ' ' + Math.random() });
  for (let i = 0; i < 6; i += 1) await db.messages.append(st.id, pg(i, SIX[i]));
  for (let i = 6; i < 44; i += 1) await db.messages.append(st.id, pg(i, i % 2 ? 'The yard was quiet that hour, and Rukia swept it. Page ' + i + '.' : 'I wait. ' + i));
  await saveState(st.id, ledgerOf());
  await saveMemory(st.id, { window: 30, nodes: lines || [
    { id: 'a', span: [0, 5], text: 'Jovan showed Rukia the seal of the Thirteenth; Renji came back from the gate before noon.', level: 1, at: 1, whole: true },
    { id: 'b', span: [6, 11], text: 'Rukia swept the yard; nothing else moved.', level: 1, at: 2, whole: true },
    { id: 'c', span: [12, 17], text: 'Rukia swept the yard again.', level: 1, at: 3, whole: true },
  ] });
  return st;
}
const CLEAN = '{"issues":[]}';

test('M675-6 A JOB THE HOUSE STARTED BY ITSELF IS TRIED ONCE, AND NEVER HOLDS A SEND (the audit: a send landing while the continuous audit’s failed call slept out the queue’s ladder waited 1.7 s, then 5 s — its whole ceiling): a job marked `once` that fails is settled at once — no wait, one try, the failure said; the same job without the mark is tried again as a page’s reader is; and whoever waits for the workers right after is not held', async () => {
  const sid = 'm675-once';
  const slept = [];
  setSleepForHarness(async (ms) => { slept.push(ms); });
  try {
    let runs = 0;
    const began = Date.now();
    const idle = enqueueWork(sid, { name: 'continuous', once: true, run: async () => { runs += 1; throw Object.assign(new Error('The house said no (500).'), { status: 500 }); } });
    noteWork(sid, idle);
    const settled = await idle;
    eq(runs + ' | ' + slept.length + ' | ' + settled.ok + ' | ' + /500/.test(String(settled.why)), '1 | 0 | false | true', 'tried once, no wait in the queue, settled as failed with the reason');
    assert(Date.now() - began < 1000, 'settled at once (' + (Date.now() - began) + ' ms)');
    const t0 = Date.now();
    await pendingWork(sid, 5000);
    assert(Date.now() - t0 < 200, 'a send that waits for the workers right after is not held (' + (Date.now() - t0) + ' ms; it was up to 5,000)');
    /* a page's own reader is still tried again, as it always was */
    runs = 0; slept.length = 0;
    const chain = await enqueueWork(sid, { name: 'extractor', run: async () => { runs += 1; throw new Error('The house said no (500).'); } });
    eq(runs + ' | ' + slept.length + ' | ' + chain.ok, (MAX_RETRIES + 1) + ' | ' + MAX_RETRIES + ' | false', 'a job of the page’s own chain keeps its ' + MAX_RETRIES + ' retries');
  } finally { setSleepForHarness(null); }
});

test('M675-7 A STRETCH THE WIRE WILL NOT ANSWER FOR NEVER STOPS THE REST, AND NOTHING IS MARKED READ THAT WAS NOT (the audit: a provider answering 400 for pages 1–6 — eight looks, 96 requests, none for any later line, 0 of 12 read, for good): the first refusal asks for the same pages one at a time; a page refused alone is set aside and the lines after it are read; refused three times while the provider answers for other pages, that one page is passed by and said; a provider that refuses EVERYTHING passes nothing by', async () => {
  const st = await auditTale('refused');
  const prior = globalThis.__cozyAuditAsideMs;
  globalThis.__cozyAuditAsideMs = 40; /* half an hour in the house */
  forgetAuditTrouble();
  const asked = [];
  const poison = (user) => /\[p2\] STORY: /.test(user); /* the provider will not answer for page 2 */
  const impl = async (url, opts) => {
    const { user } = bodyOf(opts);
    const from = (/THE PAGES \(pages (\d+)-(\d+)/.exec(user) || []).slice(1, 3).join('-');
    asked.push(from);
    if (poison(user)) return refuse(400, 'Content Exists Risk');
    return say(CLEAN);
  };
  const look = async () => { try { const r = await auditStretch({ connection: CONN, storyId: st.id }); return r ? (r.passedBy ? 'passed ' : 'read ') + (r.from + 1) + '-' + (r.to + 1) : 'nothing'; } catch (err) { return 'threw ' + (err.status || err.message); } };
  const pagesNow = async () => (await db.messages.list(st.id));
  try {
    await withFetch(impl, async () => {
      eq(await look(), 'threw 400', 'the six pages asked for together are refused');
      eq(await look(), 'read 1-1', 'the same line is then asked for one page at a time: page 1 is read');
      eq(await look(), 'threw 400', 'page 2, alone, is refused');
      eq(await look(), 'read 7-12', 'page 2 is set aside — and the NEXT line is read (it never was: the same six pages were asked for again, for good)');
      eq(auditWaits(st.id, await loadMemory(st.id), await pagesNow()), 0, 'there is more to read now');
      eq(await look(), 'read 13-18', 'and the one after it');
      const waits = auditWaits(st.id, await loadMemory(st.id), await pagesNow());
      assert(waits > 0 && waits <= 200, 'only the page set aside is left: the house is told how long until it comes back (' + waits + ' ms), not asked every breath');
      eq(await look(), 'nothing', 'and a look before then asks for nothing');
      const mid = auditProgress(await loadMemory(st.id), 44);
      eq(mid.done + ' of ' + mid.folded, '13 of 18', 'what was read is counted; the refused page and the four behind it in its line are not');
      await new Promise((r) => setTimeout(r, 60));
      eq(await look(), 'threw 400', 'its wait over, page 2 is asked for again — refused a second time');
      await new Promise((r) => setTimeout(r, 120));
      const third = await auditStretch({ connection: CONN, storyId: st.id });
      eq(third && third.passedBy + ' | ' + (third.from + 1) + '-' + (third.to + 1), 'true | 2-2', 'refused a third time, with other pages answered for meanwhile: that ONE page is passed by');
      assert(/refused it 3 times/.test(stretchWords(third)) && /Content Exists Risk/.test(stretchWords(third)), 'and the workers’ line says so, with the provider’s own reason: ' + stretchWords(third).slice(0, 160));
      eq(await look(), 'read 3-6', 'and the rest of its line is read as any other — together again');
      const end = auditProgress(await loadMemory(st.id), 44);
      eq(end.done + ' of ' + end.folded + ', left ' + end.left, '18 of 18, left 0', 'and the audit reaches the end of what is folded');
    });
    /* a provider that refuses everything: nothing is ever passed by */
    const st2 = await auditTale('all refused');
    forgetAuditTrouble();
    let calls = 0;
    await withFetch(async () => { calls += 1; return refuse(400, 'unsupported parameter: temperature'); }, async () => {
      for (let i = 0; i < 12; i += 1) { try { await auditStretch({ connection: CONN, storyId: st2.id }); } catch (err) { /* refused */ } await new Promise((r) => setTimeout(r, 45)); }
    });
    const none = auditProgress(await loadMemory(st2.id), 44);
    eq(none.done, 0, 'a connection that refuses every request (' + calls + ' asked) passes NOTHING by — not one page is marked read');
    assert(calls >= 6, 'and it went on to the other lines while each waited (' + calls + ' requests)');
    /* a page the server stumbles on (500) while it answers for the others is set aside each time — never passed by: only a
     * refusal of the request's own words is */
    const st3 = await auditTale('stumbles');
    forgetAuditTrouble();
    await withFetch(async (url, opts) => (poison(bodyOf(opts).user) ? refuse(500, 'upstream error') : say(CLEAN)), async () => {
      for (let i = 0; i < 14; i += 1) { try { await auditStretch({ connection: CONN, storyId: st3.id }); } catch (err) { /* stumbled */ } await new Promise((r) => setTimeout(r, 45)); }
    });
    const some = auditProgress(await loadMemory(st3.id), 44);
    eq(some.done + ' of ' + some.folded, '13 of 18', 'a page the server only stumbles on is never passed by — it waits, and is asked for again (everything else is read)');
  } finally {
    if (prior === undefined) delete globalThis.__cozyAuditAsideMs; else globalThis.__cozyAuditAsideMs = prior;
    forgetAuditTrouble();
  }
});

test('M675-8 WHAT THE RECORD KEEPS IS KEPT RIGHT (the audit): two fixes that swap, or chain, repair the line instead of corrupting it; a wrong fact in a line’s Detail is repaired there; a squeeze is shown the Detail beneath its lines; “Detail again” is read by the continuous audit once more; two faults on one page are one mend; a page the finisher only tidied can still be mended; the brief is read to the room every reader gives it; a person’s cut list shows what was learned near the pages read; a line’s pages are read whole when the model has the room', async () => {
  /* 1. fixes read against the line as it stood */
  const pages = 'Rukia handed Renji the seal of the Thirteenth. Byakuya left at dawn; Renji kept the seal.';
  eq(applyAuditFixes('Renji handed Rukia the seal.', [{ from: 'Renji', to: 'Rukia' }, { from: 'Rukia', to: 'Renji' }], pages).text, 'Rukia handed Renji the seal.', 'two fixes that swap: each is read against the line as it stood (it gave “Renji handed Renji the seal.”)');
  eq(applyAuditFixes('Marcus kept the seal; Renji left at dawn.', [{ from: 'Marcus', to: 'Renji' }, { from: 'Renji', to: 'Byakuya' }], pages).text, 'Renji kept the seal; Byakuya left at dawn.', 'a chain: the second fix never sees the first one’s words (it gave “Byakuya kept the seal; Byakuya left”)');
  eq(applyAuditFixes('Marcus kept the seal.', [{ from: 'Marcus kept', to: 'Renji kept' }, { from: 'Marcus', to: 'Byakuya' }], pages).text, 'Renji kept the seal.', 'two fixes of the same words: the first stands, the second is left out whole');
  eq(JSON.stringify(applyAuditFixes('Marcus kept the seal.', [{ from: 'Marcus', to: 'Ichigo' }, { from: 'the seal', to: 'the seal of the Thirteenth' }], pages)), JSON.stringify({ text: 'Marcus kept the seal of the Thirteenth.', used: [{ from: 'the seal', to: 'the seal of the Thirteenth' }] }), 'the keeper’s own rule holds: right words that are not in the pages are not written');
  eq(applyAuditFixes('He left; he left again.', [{ from: 'he left', to: 'Byakuya left' }], pages).text, 'He left; Byakuya left again.', 'every place a fix’s words stand in the line is repaired, as before');
  /* 2. a wrong fact in the Detail; one mend for two faults; a tidied page; the reading end to end */
  const st = await auditTale('kept right', [
    { id: 'a', span: [0, 5], text: 'Jovan showed Rukia the seal of the Thirteenth; Renji came back from the gate before noon.', detail: 'Rukia has green eyes', level: 1, at: 1, whole: true },
  ]);
  { const all = await db.messages.list(st.id); await db.messages.update(st.id, all[1].id, { mended: { before: all[1].text + ' *', why: 'tidied — took off a stray mark', at: 5 } }); }
  forgetAuditTrouble();
  const mends = [];
  const answer = JSON.stringify({ issues: [
    { what: 'The detail gives Rukia green eyes; the pages say grey.', record: { fixes: [{ from: 'green eyes', to: 'grey eyes' }] } },
    { what: 'Page 2 has Renji leave at dawn, though he had been at the gate since the night before.', pages: true, page: 2, fix: 'Renji had been at the gate since the night before.' },
    { what: 'Page 2 calls the seal the seal of the Tenth.', pages: true, page: 2, fix: 'It is the seal of the Thirteenth.' },
  ] });
  let request = '';
  const first = await withFetch(async (url, opts) => { request = bodyOf(opts).user; return say(answer); }, () => auditStretch({ connection: CONN, storyId: st.id, mend: async (id, words) => { mends.push({ id, words }); return [id]; } }));
  eq(mends.length, 1, 'two faults found on one page: the mender is sent to it ONCE (it was sent twice, the second time over its own words)');
  assert(/gate since the night before/.test(mends[0].words) && /seal of the Thirteenth/.test(mends[0].words), 'with both faults said together: ' + mends[0].words.slice(0, 200));
  eq(first.mendedPages, 1, 'and one page is counted as mended — though the landing finisher had already tidied it (a tidy is not a mend of what the page says)');
  /* M675 (the second reading): what becomes of the line over the mended page is said as it is */
  eq(first.lineKept, true, 'fixture: this mender left the line where it stood (as the house does for a line in his own words, or with the keeper off)');
  assert(/the record line over it stands as it is/.test(stretchWords(first)) && !/the keeper folds the mended words/.test(stretchWords(first)), 'the workers’ line does not say the keeper folds a line that was kept: ' + stretchWords(first));
  assert(/the keeper folds the mended words, and they are read once more/.test(stretchWords({ ...first, lineKept: false })), 'and it says so when the line was let go');
  eq(isHouseTidy({ why: 'tidied — took off a stray mark' }) + ' | ' + isHouseTidy({ why: 'the header named only the area — the house wrote in where the ledger has the scene' }) + ' | ' + isHouseTidy({ why: 'Renji cannot have left at dawn' }) + ' | ' + isHouseTidy(null), 'true | true | false | false', 'which mends are only the house tidying');
  /* the same answer with no mender: the detail is repaired, the page faults noted */
  const again = await withFetch(async () => say(answer), () => auditStretch({ connection: CONN, storyId: st.id }));
  const line = (await loadMemory(st.id)).nodes.find((n) => n.id === 'a');
  eq(line.detail + ' | ' + again.lineMended, 'Rukia has grey eyes | 1', 'a wrong fact in the Detail beneath the line is repaired there (it was dropped without a word)');
  /* 3. the brief, to the room */
  const brief = 'The brief opens. ' + 'x'.repeat(19970) + ' Jovan is sixteen. ' + 'y'.repeat(10000);
  const mem = await loadMemory(st.id);
  const shown = (await db.messages.list(st.id));
  const built = buildStretchMessages({ state: ledgerOf(), brief, castNotes: '', mem: { ...mem, nodes: [{ ...line, audited: 0 }] }, pages: shown, stretch: nextStretch({ nodes: [{ ...line, audited: 0 }] }, shown), room: 369000 });
  assert(built.user.includes('Jovan is sixteen'), 'a 30,000-character brief in a large room is read whole (it was cut at 12,000: “Jovan is sixteen” at 20,000 was not in the request)');
  const small = buildStretchMessages({ state: ledgerOf(), brief, castNotes: '', mem: { ...mem, nodes: [{ ...line, audited: 0 }] }, pages: shown, stretch: nextStretch({ nodes: [{ ...line, audited: 0 }] }, shown), room: 60000 });
  assert(!small.user.includes('Jovan is sixteen') && /the brief continues — \d+ more characters not shown here/.test(small.user), 'in a small room it is cut to its share, and the cut says so');
  /* 4. a person's cut list: what was learned near the pages read */
  let long = ledgerOf();
  for (let t = 1; t <= 60; t += 1) long = applyMutations({ ...long, page: t * 10 }, [{ type: 'knowledge.add', name: 'Rukia', fact: 'the thing learned on turn ' + (t * 10 + 1) + ' is number ' + t + ' ' + 'w'.repeat(180) }]).state;
  const near = ledgerForPages(long, 'Rukia stood in the yard.', 2500, 11);
  assert(/is number 1 /.test(near) && !/is number 60 /.test(near), 'a reading of the first pages is shown what Rukia learned NEAR them, not her newest lines (it was shown pages 481-591 for a reading of pages 1-6): ' + near.slice(0, 90));
  assert(/lines from other parts of the story not shown/.test(near), 'and the cut says what it is');
  /* 5. a line's pages read whole when the model has the room */
  const longPages = Array.from({ length: 12 }, (_, i) => pg(i, 'p' + i + ' ' + 'z'.repeat(7000)));
  const one = { nodes: [{ id: 'l', span: [0, 5], text: 'a line', level: 1 }] };
  eq(JSON.stringify([nextStretch(one, longPages).to, nextStretch(one, longPages).lineWhole]), JSON.stringify([4, false]), 'fixture: six pages of 7,000 characters are past the fixed ' + STRETCH_CHARS + ' — read in parts, and a line read in parts is never repaired');
  eq(JSON.stringify([nextStretch(one, longPages, { room: 110000 }).to, nextStretch(one, longPages, { room: 110000 }).lineWhole]), JSON.stringify([5, true]), 'with room for them, the line’s six pages are read whole');
  /* 6. a squeeze is shown the Detail beneath its lines */
  const fold = buildFoldMessages([{ text: 'Jovan showed Rukia the seal.', detail: 'Rukia promised to keep the seal hidden from the captains' }, { text: 'Renji came back before noon.' }]);
  assert(fold.user.includes('• Detail worth keeping: Rukia promised to keep the seal hidden from the captains'), 'the merge is shown what is kept beneath each line (it saw the lines alone, and the merged line had no detail)');
  eq(lineWithDetail({ text: ' a line ', detail: '' }) + ' | ' + lineWithDetail({ text: 'a line', detail: 'kept' }), 'a line | a line\n• Detail worth keeping: kept', 'a line with nothing beneath it is shown as it is');
});

test('M675-9 TWO NAMES A LETTER FROM ONE PAGE ARE BOTH PARTED FROM IT (the audit of M672: the claim “order cannot change who is parted” was false for this case, and no law held the new behaviour): page Kara; “Lara” and “Mara” were each written, on two pages, onto it — each gets a page of her own with what was written for her, and Kara keeps hers', async () => {
  const asWritten = (st, page, muts, forName) => {
    const before = st.journal.length;
    const r = applyMutations({ ...st, page }, muts.map((m) => ({ ...m, name: 'Kara' })));
    if (forName) r.state.journal.slice(before).forEach((e) => { if (e.m && e.m.name === 'Kara') e.m.name = forName; });
    return r.state;
  };
  let st = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Bruce' }, { type: 'place.set', name: 'The Batcave' }, { type: 'presence.enter', name: 'Bruce' }]).state;
  st = asWritten(st, 2, [{ type: 'people.set', field: 'core', text: 'Supergirl; bright, nosy, quick to laugh' }]);
  st = asWritten(st, 3, [{ type: 'knowledge.add', fact: 'Bruce keeps a cave under the house' }]);
  st = asWritten(st, 4, [{ type: 'knowledge.add', fact: 'the crystal holds a map of Krypton' }], 'Lara');
  st = asWritten(st, 5, [{ type: 'knowledge.add', fact: 'Clark was sent away as a baby' }], 'Lara');
  st = asWritten(st, 6, [{ type: 'knowledge.add', fact: 'the lighthouse keeper owes her a favour' }], 'Mara');
  st = asWritten(st, 7, [{ type: 'knowledge.add', fact: 'the tide gate opens at midnight' }], 'Mara');
  eq(Object.keys(st.characters).filter((n) => n !== 'Bruce').join(), 'Kara', 'fixture: one page, and six things written onto it');
  const knows = (s, who) => ((s.knowledge || {})[who] || []).map((k) => k.fact).sort().join(' / ');
  const healed = partLookAlikes(JSON.parse(JSON.stringify(st)));
  eq(knows(healed, 'Lara'), 'Clark was sent away as a baby / the crystal holds a map of Krypton', 'Lara has what was written for her');
  eq(knows(healed, 'Mara'), 'the lighthouse keeper owes her a favour / the tide gate opens at midnight', 'and so has Mara — the second look-alike is parted too (she was left mixed into Kara’s for good)');
  eq(knows(healed, 'Kara'), 'Bruce keeps a cave under the house', 'and Kara keeps only her own');
  eq(JSON.stringify((healed.parted || []).map((x) => x.from + '->' + x.to).sort()), '["Kara->Lara","Kara->Mara"]', 'the state says who was parted');
  eq(JSON.stringify(partLookAlikes(JSON.parse(JSON.stringify(healed))).parted || []), '[]', 'and a second look finds nothing left to part');
});

test('M675-10 A PAGE SAID TO BE THE STORY IS THE STORY (the audit: “go on” after an out-of-character question with no answer was told as the story and then read as that question’s answer; a chat brought in from another app, where “((…))” is an instruction, had every reply after one taken for out of character): ooc false overrules the place; the store keeps it; a brought-over reply carries it; an answer the house told out of character is still out of character', async () => {
  const pages = [
    { role: 'user', text: 'I walk in.' },
    { role: 'assistant', text: 'The hall was quiet.' },
    { role: 'user', text: '((who is Kara?))' },
    { role: 'assistant', text: 'The story went on: Kara stepped out of the shadow.', ooc: false },
    { role: 'user', text: '((and Renji?))' },
    { role: 'assistant', text: 'He is the steward. He could betray him later.', ooc: true },
    { role: 'user', text: '// make it rain' },
    { role: 'assistant', text: 'An old answer with no mark of its own.' },
  ];
  eq(pages.map((_, i) => (asideAt(pages, i) ? 'aside' : 'story')).join(' '), 'story story aside story aside aside aside aside', 'the page said to be the story is the story, though it follows his question; the marked answer and the unmarked old one are out of character, as before');
  const st = await db.stories.create({ title: 'said to be the story' });
  await db.messages.append(st.id, { role: 'user', text: '((who is Kara?))' });
  const told = await db.messages.append(st.id, { role: 'assistant', text: 'Kara stepped out.', ooc: false });
  const his = await db.messages.append(st.id, { role: 'user', text: 'hello', ooc: false });
  const kept = await db.messages.list(st.id);
  eq(kept.find((m) => m.id === told.id).ooc + ' | ' + ('ooc' in kept.find((m) => m.id === his.id)), 'false | false', 'the store keeps the word on a storyteller page (and writes nothing on his own)');
  eq(asideAt(kept, 1), false, 'and every reader that asks is told it is the story');
  const chat = parseSTChat([
    JSON.stringify({ user_name: 'Jovan', character_name: 'Rukia', chat_metadata: {} }),
    JSON.stringify({ name: 'Jovan', is_user: true, mes: '((make her angrier))', send_date: 1 }),
    JSON.stringify({ name: 'Rukia', is_user: false, mes: 'Rukia slammed the door.', send_date: 2 }),
  ].join('\n'));
  eq(chat.messages.map((m) => m.role + ':' + m.ooc).join(' '), 'user:undefined assistant:false', 'a reply brought in from another app is said to be the story');
  const brought = await db.stories.create({ title: 'brought in' });
  await db.messages.appendAll(brought.id, chat.messages);
  const there = await db.messages.list(brought.id);
  eq(there[1].ooc + ' | ' + asideAt(there, 1), 'false | false', 'kept so in the store: the reply after “((make her angrier))” is a page of the story to every reader');
});

test('M675-11 WHAT IS KEPT BENEATH A RECORD LINE SURVIVES THE KEEPER’S OWN WORK (the audit: two lines with kept details squeezed into one — detail: null, and the mark that says “read” carried on to it, for good): the merge is asked with each line’s Detail, and so is the check of the merged line; a detail written again by “Detail again” is read by the continuous audit once more; a fact a stretch before the story’s first page adds is dated with that page', async () => {
  const kept = { w: await db.settings.get('memoryWindow'), b: await db.settings.get('memoryBatch'), s: await db.settings.get('memorySqueeze') };
  await db.settings.set('memoryWindow', 10); await db.settings.set('memoryBatch', 6); await db.settings.set('memorySqueeze', 3);
  const st = await db.stories.create({ title: 'kept beneath ' + Math.random() });
  for (let i = 0; i < 34; i += 1) await db.messages.append(st.id, pg(i, i % 2 ? 'Rukia swept the yard and Renji mended the gate. Page ' + i + '.' : 'I wait. ' + i));
  await saveState(st.id, ledgerOf());
  const line = (id, a, extra = {}) => ({ id, span: [a, a + 5], text: 'Rukia swept the yard; Renji mended the gate; pages ' + a + ' on.', level: 1, at: a + 1, whole: true, ...extra });
  await saveMemory(st.id, { window: 10, nodes: [
    line('a', 0, { audited: 6, detail: 'Rukia promised Jovan to keep the seal hidden from the captains' }),
    line('b', 6, { audited: 6, detail: 'Renji owes the gatekeeper forty ryo' }),
    line('c', 12, { audited: 6 }), line('d', 18, { audited: 6, detail: 'an old detail' }),
  ] });
  const asked = [];
  try {
    await withFetch(async (url, opts) => {
      const { user } = bodyOf(opts);
      asked.push(user);
      if (/NONE, or one DETAIL/.test(user)) return say('DETAIL: Rukia promised Jovan to keep the seal hidden from the captains; Renji owes the gatekeeper forty ryo');
      return say('Rukia swept the yard through the morning; Renji mended the gate; the yard stayed quiet; nothing else moved.');
    }, async () => {
      await maybeSummarize({ connection: { ...CONN }, storyId: st.id, stale: () => false, renew: () => true });
      const mem = await loadMemory(st.id);
      const merged = mem.nodes.find((n) => n.level === 2);
      assert(merged && merged.span.join() === '0,11', 'fixture: the two oldest lines were squeezed into one: ' + JSON.stringify(mem.nodes.map((n) => [n.id, n.level, n.span])));
      const mergeAsk = asked.find((u) => /being merged into ONE line of the record/.test(u)) || '';
      assert(mergeAsk.includes('• Detail worth keeping: Rukia promised Jovan to keep the seal hidden from the captains') && mergeAsk.includes('• Detail worth keeping: Renji owes the gatekeeper forty ryo'), 'the merge is asked with what is kept beneath each line (it was shown the lines alone)');
      const checkAsk = asked.find((u) => /NONE, or one DETAIL/.test(u)) || '';
      assert(checkAsk.includes('Renji owes the gatekeeper forty ryo') && checkAsk.includes('keep the seal hidden from the captains'), 'and the check of the merged line holds it against the lines WITH their details');
      assert(/forty ryo/.test(String(merged.detail || '')) && /seal hidden/.test(String(merged.detail || '')), 'so what was kept is kept beneath the line they became: ' + JSON.stringify(merged.detail));
      /* "Detail again" writes the detail anew: the continuous audit reads that line once more */
      await redoLine({ connection: { ...CONN }, storyId: st.id, nodeId: 'd', detailOnly: true });
      const d = (await loadMemory(st.id)).nodes.find((n) => n.id === 'd');
      eq(JSON.stringify([d.detail !== 'an old detail', d.audited === undefined]), '[true,true]', 'a detail written again is read by the continuous audit once more (its mark stayed, over a detail it had never seen)');
    });
    /* a stretch that ends before the story's first page dates its fact with that page */
    const early = await db.stories.create({ title: 'before the first page ' + Math.random() });
    /* (a tale that opens with three messages of his before the storyteller's first page, and a line for those alone) */
    await db.messages.append(early.id, { role: 'user', text: 'Rukia, I tell you plainly: Jovan carries the seal of the Thirteenth.' });
    await db.messages.append(early.id, { role: 'user', text: 'And I add a second thing before you answer.' });
    await db.messages.append(early.id, { role: 'user', text: 'And a third.' });
    for (let i = 3; i < 30; i += 1) await db.messages.append(early.id, pg(i, i % 2 ? 'Rukia nodded. Page ' + i + '.' : 'I wait. ' + i));
    let busyLedger = ledgerOf();
    for (let t = 0; t < 300; t += 1) busyLedger = applyMutations({ ...busyLedger, page: 10 }, [{ type: 'clock.advance', minutes: 1 }]).state;
    await saveState(early.id, { ...busyLedger, page: 14 });
    await saveMemory(early.id, { window: 10, nodes: [{ id: 'z', span: [0, 2], text: 'Jovan told Rukia of the seal.', level: 1, at: 1, whole: true }] });
    forgetAuditTrouble();
    const r = await withFetch(async () => say(JSON.stringify({ issues: [{ what: 'Rukia learned of the seal.', mutations: [{ type: 'knowledge.add', name: 'Rukia', fact: 'Jovan carries the seal of the Thirteenth' }] }] })), () => auditStretch({ connection: CONN, storyId: early.id }));
    eq(r && (r.from + '-' + r.to) + ' | ' + r.applied.length, '0-2 | 1', 'fixture: his opening words alone are the stretch, and the fact is written');
    const fact = ((await loadState(early.id)).knowledge.Rukia || []).find((k) => /carries the seal/.test(k.fact));
    eq(fact && fact.atTurn, 1, 'dated with the story’s first page (it was dated with the ledger’s count of writes — “turn 302” in a tale of 15 pages)');
  } finally { for (const [k, v] of [['memoryWindow', kept.w], ['memoryBatch', kept.b], ['memorySqueeze', kept.s]]) { if (v === undefined) await db.settings.delete(k); else await db.settings.set(k, v); } forgetAuditTrouble(); }
});

test('M675-12 A TALE’S WORK IS RUNNING WHILE A JOB IS, AND NOT A MOMENT LONGER — AND HIS STOP REACHES A JOB THAT IS WAITING TO TRY AGAIN (found running down a breakage no test caught: the queue went on saying a tale’s work was running after a job had failed for good, so “Summarize now” answered “A pass is finishing — try again in a moment” to every press and the house’s own healers, which ask first, never came back by themselves; and a Stop pressed in the wait between two tries stopped nothing — the job woke and asked its model again)', async () => {
  /* 1. a job that failed for good holds nothing */
  setSleepForHarness(async () => {});
  try {
    const once = await enqueueWork('m675-held-a', { name: 'continuous', once: true, run: async () => { throw new Error('unreachable'); } });
    eq(once.ok + ' | ' + workIsRunning('m675-held-a') + ' | ' + queuedCount('m675-held-a'), 'false | false | 0', 'tried once, failed: the tale’s work is not running (it said “running” until some later job ran well)');
    const six = await enqueueWork('m675-held-b', { name: 'extractor', run: async () => { throw new Error('unreachable'); } });
    eq(six.ok + ' | ' + workIsRunning('m675-held-b'), 'false | false', 'and the same after six tries');
  } finally { setSleepForHarness(null); }
  /* 2. a job waiting to try again still holds its lane — and his Stop ends the wait */
  let runs = 0;
  let fellAsleep = () => {};
  const asleep = new Promise((r) => { fellAsleep = r; });
  setSleepForHarness(() => { fellAsleep(); return new Promise((r) => { const t = setTimeout(r, 3000); if (t.unref) t.unref(); }); }); /* a wait far longer than the Stop takes */
  try {
    const job = enqueueWork('m675-held-c', { name: 'extractor', run: async () => { runs += 1; throw new Error('unreachable'); } });
    await asleep;
    eq(runs + ' | ' + workIsRunning('m675-held-c'), '1 | true', 'its first try failed and it waits for the second: the lane is still its own');
    const t0 = Date.now();
    assert(stopWork('m675-held-c'), 'there is work to stop');
    const out = await job;
    eq(out.ok + ' | ' + out.stopped + ' | ' + runs + ' | ' + workIsRunning('m675-held-c'), 'false | true | 1 | false', 'stopped in the wait: settled as stopped, never run again (it woke and ran — five more times), the lane free');
    assert(Date.now() - t0 < 500, 'and at once (' + (Date.now() - t0) + ' ms)');
    const row = (await loadWorkerStatus('m675-held-c')).extractor;
    eq(row && row.detail, 'stopped by hand', 'the workers’ line says whose doing it was');
  } finally { setSleepForHarness(null); }
  /* 3. the lane takes the next job as ever */
  const later = await enqueueWork('m675-held-c', { name: 'extractor', run: async () => ({ silent: true }) });
  eq(later.ok + ' | ' + workIsRunning('m675-held-c'), 'true | false', 'a later job on that lane runs and settles');
  /* 4. and a Stop while a call is in flight is what it always was (M208) */
  let reason = '';
  let flying = () => {};
  const inFlight = new Promise((r) => { flying = r; });
  const call = enqueueWork('m675-held-d', { name: 'extractor', run: ({ signal }) => new Promise((resolve, reject) => { signal.addEventListener('abort', () => { reason = String(signal.reason && signal.reason.message); reject(signal.reason); }); flying(); }) });
  await inFlight;
  eq(workIsRunning('m675-held-d'), true, 'a call in flight holds the lane');
  stopWork('m675-held-d');
  const cut = await call;
  eq(cut.stopped + ' | ' + reason + ' | ' + workIsRunning('m675-held-d'), 'true | stopped by hand | false', 'the call is cut off, as his');
});

test('M675-13 A RECORD LINE THE HOUSEKEEPER CHANGED AND GAVE BACK IS WHOSE IT WAS BEFORE (the audit: a card taken back left the line marked “fixed by the housekeeper” — and the continuous audit, which never writes over a line changed for him, left that line alone for good though nothing of the housekeeper’s stood in it any more): a line nobody had touched carries no mark after the take-back; a line he had rewritten by hand is his again, with his own mark; a card kept from before this build is taken back as it always was', async () => {
  const st = await db.stories.create({ title: 'a card taken back' });
  const his = { at: 1234, fixed: 'the writer' };
  await saveMemory(st.id, { window: 30, nodes: [
    { id: 'n1', span: [0, 3], level: 1, at: 1, text: 'Jovan met Rukia at the gate; she wore the blue scarf.' },
    { id: 'n2', span: [4, 7], level: 1, at: 2, text: 'Renji kept the blue lamp lit.', verified: his },
    { id: 'n3', span: [8, 11], level: 1, at: 3, text: 'The blue door stayed shut.' },
  ] });
  const card = (id, nodeId, find, replace) => ({ id, kind: 'record', status: 'pending', label: id, op: { nodeId, find, replace }, review: [{ target: 'anchor:record:' + nodeId, find }] });
  const line = async (id) => (await loadMemory(st.id)).nodes.find((n) => n.id === id);
  /* 1. a line nobody had touched */
  let session = { turns: [{ proposals: [card('c1', 'n1', 'blue scarf', 'red scarf')] }], batches: [] };
  assert((await applyProposal(session, st.id, 'c1')).ok, 'fixture: the card lands');
  eq((await line('n1')).text + ' | ' + lineIsHis(await line('n1')), 'Jovan met Rukia at the gate; she wore the red scarf. | true', 'changed for him: the line is marked, and the audit leaves it alone');
  assert((await undoLatest(session, st.id)).ok, 'fixture: taken back');
  eq((await line('n1')).text + ' | ' + lineIsHis(await line('n1')) + ' | ' + JSON.stringify((await line('n1')).verified), 'Jovan met Rukia at the gate; she wore the blue scarf. | false | undefined', 'taken back: the keeper’s words again, and no mark (it stayed “the housekeeper” — the audit never read that line again)');
  /* 2. a line he had rewritten by hand */
  session = { turns: [{ proposals: [card('c2', 'n2', 'blue lamp', 'red lamp')] }], batches: [] };
  assert((await applyProposal(session, st.id, 'c2')).ok, 'fixture: the card lands on his line');
  eq((await line('n2')).verified.fixed, 'the housekeeper', 'fixture: the housekeeper’s mark while its change stands');
  assert((await undoLatest(session, st.id)).ok, 'fixture: taken back');
  eq((await line('n2')).text + ' | ' + JSON.stringify((await line('n2')).verified), 'Renji kept the blue lamp lit. | ' + JSON.stringify(his), 'taken back: his words, and his own mark again');
  /* 3. a card kept from before this build has no note of whose the line was: the line’s mark is left as it is */
  session = { turns: [{ proposals: [card('c3', 'n3', 'blue door', 'red door')] }], batches: [] };
  assert((await applyProposal(session, st.id, 'c3')).ok, 'fixture: the card lands');
  for (const b of session.batches) for (const item of b.items) delete item.verifiedBefore;
  assert((await undoLatest(session, st.id)).ok, 'fixture: taken back');
  eq((await line('n3')).text + ' | ' + (await line('n3')).verified.fixed, 'The blue door stayed shut. | the housekeeper', 'the words go back; with no note to go by the mark stays (as it did)');
});

test('M675-14 A RECORD LINE IN HIS OWN WORDS IS NEVER LET GO, AND WHETHER A TALE’S KEEPER IS ON IS ASKED ONE WAY (the second reading: the first pass taught the mend alone; an edit, a new version, a walk and “read again” let his line go like any other): the record without the line over a changed page keeps a line he wrote by hand, and one the housekeeper changed for him — the keeper’s own lines over that page go, lines elsewhere stay; a tale’s own keeper switch decides when it has one, the house’s otherwise', async () => {
  const mem = { window: 4, nodes: [
    { id: 'his', span: [0, 3], text: 'His own words.', verified: { at: 1, fixed: 'the writer' } },
    { id: 'hk', span: [2, 5], text: 'Changed for him.', verified: { at: 1, fixed: 'the housekeeper' } },
    { id: 'kept', span: [0, 5], text: 'The keeper’s line.' },
    { id: 'fixed', span: [3, 3], text: 'The keeper’s line, once corrected by the checker.', verified: { at: 1, fixed: 'Jovan is sixteen, not seventeen' } },
    { id: 'far', span: [6, 9], text: 'Another stretch.' },
  ] };
  eq(memoryWithoutPage(mem, 3).nodes.map((n) => n.id).join(' '), 'his hk far', 'his lines stand over the changed page; the keeper’s go (his went with them)');
  eq(memoryWithoutPage(mem, 7).nodes.map((n) => n.id).join(' '), 'his hk kept fixed', 'a line over another page is the only one that goes');
  eq(memoryWithoutPage(mem, 3).window, 4, 'the rest of the record is as it was');
  eq(JSON.stringify(mem.nodes.map((n) => n.id)), JSON.stringify(['his', 'hk', 'kept', 'fixed', 'far']), 'and what it was handed is not changed');
  const was = await db.settings.get('memoryKeeper');
  try {
    await db.settings.delete('memoryKeeper');
    eq([await keeperOnFor({ keeper: true }), await keeperOnFor({ keeper: false }), await keeperOnFor({}), await keeperOnFor(null)].join(' '), 'true false true true', 'the house’s keeper on (as it ships)');
    await db.settings.set('memoryKeeper', false);
    eq([await keeperOnFor({ keeper: true }), await keeperOnFor({ keeper: false }), await keeperOnFor({}), await keeperOnFor(null)].join(' '), 'true false false false', 'the house’s keeper off: a tale switched on is still kept');
  } finally { if (was === undefined) await db.settings.delete('memoryKeeper'); else await db.settings.set('memoryKeeper', was); }
});

test('M675-15 “GO ON” ASKS FOR THE STORY, AND THE TURN’S OWN PAGE SAYS WHAT THE TURN IS (the second reading; measured: “go on” pressed after his unanswered out-of-character message sent the very request that asks that message — and whatever came back was kept as a page of the story): after his unanswered “((…))” the request ends with his message and then “Go on.”; an unanswered MOVE of his is still answered as it stands; a turn that only goes on is never taken for an out-of-character turn because such a message stands somewhere before it; a hidden shortcut is read by what he typed', async () => {
  const { buildRequest } = await import('../../js/assemble/stack.js');
  const HEAD = '[The hall — Monday, March 3, 2025 | 09:01 | clear | coat | by the door]\n\n';
  const base = [{ id: 'u1', role: 'user', text: 'I walk in.' }, { id: 'a1', role: 'assistant', text: HEAD + 'The hall was quiet.' }];
  const ASIDE = { id: 'u2', role: 'user', text: '((who is Kara?))' };
  const GO = { id: 'h', role: 'user', text: 'continue', hidden: true };
  const ask = (history) => buildRequest({ story: { id: 's', title: 't' }, messages: history, settings: {}, state: emptyState(), modules: [] }).messages;
  const his = (msgs) => msgs.filter((m) => m.role === 'user').map((m) => String(m.content)).slice(-2).join(' | ');
  const noteRides = (msgs) => msgs.some((m) => /Then write the page\./.test(String(m.content)));
  /* fixture: the house's thinking note rides on a page of the story and is held back from an out-of-character turn */
  eq(noteRides(ask([...base, { id: 'u2', role: 'user', text: 'I sit.' }])) + ' | ' + noteRides(ask([...base, ASIDE])), 'true | false', 'fixture: how a story turn and an out-of-character turn differ in the request');
  /* his question, asked: it is the last thing of his, as ever */
  eq(his(ask([...base, ASIDE])), 'I walk in. | ((who is Kara?))');
  /* “go on” after it, unanswered: the story is asked for — after his message, not instead of it */
  { const msgs = ask([...base, ASIDE, GO]);
    eq(his(msgs), '((who is Kara?)) | Go on.', '“Go on.” is said after his out-of-character message (it was his message alone: the request that asks the question)');
    eq(noteRides(msgs), true, 'and the turn is a page of the story (it was dressed as an out-of-character turn)'); }
  /* “go on” after the question was answered: “Go on.” follows the answer, as it did — and the turn is the story’s */
  { const msgs = ask([...base, ASIDE, { id: 'a2', role: 'assistant', text: 'She is the steward.', ooc: true }, GO]);
    eq(his(msgs), '((who is Kara?)) | Go on.');
    eq(String(msgs.filter((m) => m.role !== 'system').slice(-2)[0].content), 'She is the steward.', '“Go on.” follows the answer');
    eq(noteRides(msgs), true, 'a “go on” somewhere after an out-of-character message is a page of the story (it was taken for an out-of-character turn)'); }
  /* an unanswered MOVE of his, then “go on”: his move is what is answered — nothing is said after it */
  eq(his(ask([...base, { id: 'u2', role: 'user', text: 'I open the door.' }, GO])), 'I walk in. | I open the door.', 'an unanswered move is answered as it stands');
  /* “continue” typed by him travels as he typed it */
  eq(his(ask([...base, ASIDE, { id: 'u3', role: 'user', text: 'continue' }])), '((who is Kara?)) | continue');
  /* an earlier “go on” that never got its page does not hide his question from this one */
  eq(his(ask([...base, ASIDE, { ...GO, id: 'h0' }, GO])), '((who is Kara?)) | Go on.');
  /* a hidden shortcut is read by what he typed */
  eq(noteRides(ask([...base, { id: 'u2', role: 'user', text: 'the house’s own words for it', hidden: true, typed: '#question why is the hall cold?', ooc: true }])), false, 'a hidden out-of-character shortcut is still an out-of-character turn');
  eq(noteRides(ask([...base, ASIDE, { id: 'a2', role: 'assistant', text: 'She is the steward.', ooc: true }, { id: 'u3', role: 'user', text: 'the house’s own words for it', hidden: true, typed: '#p' }])), true, 'a hidden story shortcut after an out-of-character message is a page of the story');
});

test('M675-16 A TURN RULED BEFORE HIS WORDS WERE READ APART FROM A FILE KEEPS ITS FATE (the second reading: the referee is handed what he typed since M675 — a commit made when the whole page, file and all, was read as his move no longer matched, and the turn’s next swipe rolled the die again): the same message, asked again with his typed words and what the page holds whole, replays the committed verdict — no second roll; a message he really changed is still a new world', async () => {
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const conn = { type: 'openai' };
  const openLLM = async () => JSON.stringify({ check: true, kind: 'actor', action: 'I swing at Rusk', opposition: 'Rusk', circumstance: 0, duel_start: { opponent: 'Rusk', domain: 'melee', rating: 5 } });
  const TYPED = 'I swing at Rusk';
  const WHOLE = TYPED + '\n\n' + attachedBlock('notes.md', 'Rusk fights dirty. He will strike first.');
  const page = { id: 'u1', role: 'user', text: WHOLE };
  const before = { ...emptyState(), turn: 1 };
  /* as the build before M675 ruled it: the whole page handed over as his move */
  const first = await refereeStep({ connection: conn, userText: WHOLE, userId: 'u1', history: [page], state: clone(before), settings: {}, callLLM: openLLM });
  eq(first.status, 'ruled', 'fixture: the turn was ruled, and committed under the whole page');
  const rewound = () => ({ ...clone(before), refHistory: clone(first.state.refHistory) });
  /* the swipe on this build: his typed words, and what the page holds whole */
  let asked = 0;
  const replay = await refereeStep({ connection: conn, userText: typedWords(WHOLE), pageWhole: WHOLE, userId: 'u1', history: [page], state: rewound(), settings: {}, callLLM: async () => { asked += 1; return openLLM(); } });
  eq(replay.status + ' | ' + asked, 'replayed | 0', 'the committed verdict is replayed — no second roll (it was taken for an edit: the world rewound, the die rolled again)');
  eq(JSON.stringify(replay.state.duel), JSON.stringify(first.state.duel), 'the duel the ruling opened stands again');
  /* and again, now that the commit is kept under his typed words */
  const again = await refereeStep({ connection: conn, userText: typedWords(WHOLE), pageWhole: WHOLE, userId: 'u1', history: [page], state: { ...clone(before), refHistory: clone(replay.state.refHistory) }, settings: {}, callLLM: async () => { asked += 1; return openLLM(); } });
  eq(again.status + ' | ' + asked, 'replayed | 0', 'and on every swipe after');
  /* a message he really changed is a new world, as ever */
  const EDITED = 'I step back from Rusk and lower my blade';
  const edited = await refereeStep({ connection: conn, userText: EDITED, pageWhole: EDITED + '\n\n' + attachedBlock('notes.md', 'Rusk fights dirty. He will strike first.'), userId: 'u1', history: [{ ...page, text: EDITED }], state: rewound(), settings: {}, callLLM: async () => { asked += 1; return JSON.stringify({ check: false }); } });
  assert(edited.status !== 'replayed' && !(edited.state.refHistory || []).some((e) => e && e.msgId === 'u1' && e.verdict && e.key === first.state.refHistory[0].key), 'changed words are not the committed turn: ' + edited.status);
});
