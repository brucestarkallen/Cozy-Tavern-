/* Cozy Tavern — harness laws of M752 (the M682–M751 audit): WHO KNOWS WHAT, HELD TO ONE RECORD A FACT. A fact written again —
 * by another worker, on a later page — is the fact already held; the page reader's receipt for a line rides in a field of
 * its own; a learned truth answers the belief it corrects, in the very words the reader is taught; "everyone here" on a page
 * that opened with nobody in it reaches the room; the readers are told each kind of knowing as the storyteller is; and the
 * views of what M713 keeps for good are held to a size. Every law runs the real modules. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { emptyState, saveState, loadState, renderStateFacts } from '../../js/engine/state.js';
import { applyMutations, storyTurn } from '../../js/engine/apply.js';
import { renderKnowledge, setThread, THREADS_VIEW } from '../../js/engine/world.js';
import { renderAllKnowledge, renderAllThreads, renderWholeLedger } from '../../js/engine/whole.js';
import { extractTurn, parseExtractorAnswer, settleWitnesses, buildExtractorMessages } from '../../js/agents/extractor.js';
import { buildWorldMessages } from '../../js/agents/world.js';
import { thinkingHouse, withHouse, HOUSES } from './thinkinghouse.mjs';
import { seat, SEATS_VIEW } from '../../js/engine/offscreen.js';

const room = (page, names, mc = 'Jovan') => applyMutations({ ...emptyState(), page }, [{ type: 'mc.set', name: mc }, { type: 'presence.enter', name: mc }, ...names.map((name) => ({ type: 'presence.enter', name }))]).state;
const lines = (st, name) => ((st.knowledge || {})[name] || []).map((k) => k.fact + ' @' + k.atTurn);
const PAGE = (text) => '[The yard — Monday, March 3, 2025 | 09:30 | clear | shihakushō | by the rail]\n\n' + text;

test('M752-K1 ONE RECORD A FACT, WHOEVER WRITES IT AGAIN: the page reader, the world agent and the auditor each sending a fact she holds — on the same page or a later one — add no line (a worker’s label was read as "another source"); the reader’s receipt rides as its own field and is kept; a book that gathered copies is clean on load and told once', async () => {
  /* three workers, two pages — `source` on a mutation is the worker's label, never a receipt */
  let st = room(4, ['Mara']);
  const fact = 'The key is in the vault';
  const first = applyMutations(st, [{ type: 'knowledge.add', name: 'Mara', fact, source: 'extractor' }]);
  eq(first.applied.length, 1, 'the first telling lands');
  const learnedOn = first.state.knowledge.Mara[0].atTurn;
  const again = applyMutations(first.state, [{ type: 'knowledge.add', name: 'Mara', fact, source: 'world' }, { type: 'knowledge.add', name: 'Mara', fact, source: 'auditor' }]);
  eq(again.applied.length, 0, 'the same page, two more workers: nothing lands');
  assert(again.rejected.length === 2 && again.rejected.every((r) => r.same === true && /already knows that/.test(r.why)), 'each is "already so", never a refusal: ' + JSON.stringify(again.rejected.map((r) => r.why)));
  const later = applyMutations({ ...again.state, page: 7 }, [{ type: 'knowledge.add', name: 'Mara', fact, source: 'extractor' }, { type: 'knowledge.add', name: 'Mara', fact: 'learned the key is in the vault', kind: 'known', source: 'world' }]);
  eq(later.applied.length, 0, 'three pages on, the reader and the world agent again: nothing lands');
  eq(lines(later.state, 'Mara').join(' | '), fact + ' @' + learnedOn, 'one line, kept from the page she learned it');
  eq(later.state.journal.length, first.state.journal.length, 'and no write was journaled for the copies');
  /* the reader's receipt ({quote, recipients} — what its vocabulary asks for), through the real page reader */
  const yard = room(9, ['Rukia', 'Renji']);
  const quote = 'Rukia’s eyes went to the fresh bandage on his hand';
  const answer = JSON.stringify({ mutations: [{ type: 'mode.snapshot', flags: [] }, { type: 'knowledge.add', who: ['Rukia'], fact: 'saw the fresh bandage on Jovan’s hand', kind: 'known', source: { quote, recipients: ['Rukia'] } }], resolved: [], here: ['Jovan', 'Rukia', 'Renji'] });
  const read = await withHouse(thinkingHouse({ answer }), () => extractTurn({ connection: HOUSES[0].conn, state: yard, userText: 'I rest my hand on the rail.', assistantText: PAGE(quote + '; nobody else looked.'), pageNumber: 10 }));
  const line = read.mutations.find((m) => m.type === 'knowledge.add');
  eq(line && line.source, 'extractor', 'the line is the page reader’s');
  eq(JSON.stringify(line && line.provenance), JSON.stringify({ quote, recipients: ['Rukia'] }), 'and its receipt rides in a field of its own');
  const kept = applyMutations(yard, read.mutations).state.knowledge.Rukia;
  eq(JSON.stringify(kept.map((k) => [k.fact, k.kind, k.source])), JSON.stringify([['saw the fresh bandage on Jovan’s hand', 'known', { quote, recipients: ['Rukia'] }]]), 'the receipt is kept with the line');
  /* a book that gathered copies (M737–M751 kept one a page, one a worker) is clean the next time it is opened, and the
   * storyteller is told the fact once — not "X; X (learned about 6 pages ago); X (learned about 7 pages ago)" */
  const party = 'Jovan agreed to come to Vanessa’s party with her on Saturday';
  const gathered = { ...room(12, ['Rias Wells']), knowledge: { 'Rias Wells': [{ fact: party, atTurn: 3 }, { fact: party, atTurn: 4, kind: 'known' }, { fact: party + '.', atTurn: 5 }, { fact: 'saw the captain leave', atTurn: 6 }] } };
  const told = renderKnowledge(gathered.knowledge, [{ name: 'Rias Wells' }], Infinity, { turn: 13 });
  eq((told.match(/Vanessa’s party/g) || []).length, 1, 'the storyteller is told it once: ' + told);
  await saveState('m752-k1', gathered);
  eq(lines(await loadState('m752-k1'), 'Rias Wells').join(' | '), party + '. @3 | saw the captain leave @6', 'folded on load — the first page, the fuller wording of the very same statement');
});

test('M752-K2 A LEARNED TRUTH ANSWERS THE BELIEF IT CORRECTS, IN THE WORDS THE READER IS TAUGHT: the page reader’s own instruction wrote the truth as a paraphrase ("…the new captain, not a recruit — …"), which never answered the belief since M738 (exact corrected truth) — so she knew the one and believed the other, every page; and a truth the whole room learned answers each one’s belief', async () => {
  let st = room(3, ['Kiyone', 'Rias']);
  st = applyMutations(st, [
    { type: 'knowledge.add', name: 'Kiyone', fact: 'believes Orrin Vale is only a recruit — untrue: Orrin Vale is the new captain of the guard' },
    { type: 'knowledge.add', name: 'Rias', fact: 'believes Orrin Vale is only a recruit — untrue: Orrin Vale is the new captain of the guard' },
    { type: 'knowledge.add', name: 'Kiyone', fact: 'believes the duke is in the capital — untrue: the duke rode for the border at dawn' },
  ]).state;
  /* the very line the reader is taught to write when the truth comes out, read from the request it is sent */
  const sent = buildExtractorMessages({ state: st, userText: 'I listen.', assistantText: 'The captain named Orrin Vale.' });
  const taught = ((sent.system + '\n' + sent.user).match(/"(learned Orrin Vale[^"]*)"/) || [])[1];
  assert(taught, 'the reader is taught the line for a truth learned');
  /* the reader says the whole room heard it, its receipt naming the room — as the reader writes it */
  const answer = JSON.stringify({ mutations: [{ type: 'mode.snapshot', flags: [] }, { type: 'knowledge.add', who: 'everyone here', fact: taught, kind: 'known', pathway: 'the captain named him before the company', source: { quote: 'Orrin Vale, captain of the guard', recipients: ['everyone here'] } }], resolved: [], here: ['Jovan', 'Kiyone', 'Rias'] });
  const read = await withHouse(thinkingHouse({ answer }), () => extractTurn({ connection: HOUSES[0].conn, state: { ...st, page: 8 }, userText: 'I listen.', assistantText: PAGE('“Orrin Vale, captain of the guard,” the captain said before the company.'), pageNumber: 9 }));
  const out = applyMutations({ ...st, page: 8 }, read.mutations).state;
  for (const who of ['Kiyone', 'Rias']) {
    const facts = (out.knowledge[who] || []).map((k) => k.fact);
    assert(!facts.some((f) => /only a recruit — untrue/.test(f)), who + '’s belief the truth answers goes: ' + JSON.stringify(facts));
    assert(facts.some((f) => f === taught), who + ' holds the truth');
  }
  assert(out.knowledge.Kiyone.some((k) => /duke is in the capital/.test(k.fact)), 'a belief it does not answer stands');
  const told = renderStateFacts(out);
  assert(!/believes: Orrin Vale is only a recruit/.test(told), 'the storyteller is not told she believes it: ' + told.slice(0, 400));
});

test('M752-K3 "EVERYONE HERE" ON A PAGE THAT OPENED EMPTY REACHES THE ROOM: on the founding page, or a page that moved the whole scene, nobody stood there as it opened — and M737 sent every "everyone here" of such a page into nobody’s book, refusing nothing; one who walks in where others stood is still the reader’s to name', () => {
  const founding = applyMutations({ ...emptyState(), page: -1 }, [{ type: 'mc.set', name: 'Jovan' }]).state;
  const read = parseExtractorAnswer(JSON.stringify({ mutations: [{ type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rias' }, { type: 'presence.enter', name: 'Tom' },
    { type: 'knowledge.add', who: 'everyone here', fact: 'saw the duke’s courier ride in under a black banner' }] }));
  const witnesses = (list) => list.filter((m) => m.type === 'knowledge.add').map((m) => m.name).sort().join(',');
  eq(witnesses(settleWitnesses(founding, read.mutations, ['Jovan', 'Rias', 'Tom'])), 'Rias,Tom', 'the founding page: the room it ends with (never the main character)');
  eq(witnesses(settleWitnesses(founding, read.mutations, null)), 'Rias,Tom', 'and with no "here" named, the walk-ins of the page');
  const moved = room(7, ['Liara']);
  const read2 = parseExtractorAnswer(JSON.stringify({ mutations: [{ type: 'presence.leave', name: 'Liara' }, { type: 'presence.enter', name: 'Captain Hale' }, { type: 'presence.enter', name: 'Sergeant Ross' },
    { type: 'knowledge.add', who: 'everyone here', fact: 'heard Jovan tell the guardroom the bridge will be blown at dawn' }] }));
  eq(witnesses(settleWitnesses(moved, read2.mutations, ['Jovan', 'Captain Hale', 'Sergeant Ross'])), 'Captain Hale,Sergeant Ross', 'a page that moved the whole scene: its new room');
  const after = applyMutations(moved, settleWitnesses(moved, read2.mutations, ['Jovan', 'Captain Hale', 'Sergeant Ross'])).state;
  eq(Object.keys(after.knowledge).sort().join(','), 'Captain Hale,Sergeant Ross', 'and that is what the ledger holds — Liara, gone before it, no line');
  /* M737's own case stands: where someone stood as the page opened, a late arrival is not "everyone here" */
  const stood = room(5, ['Mara', 'Ivo']);
  eq(witnesses(settleWitnesses(stood, [{ type: 'knowledge.add', fact: 'saw the banner rise', room: true, decided: true }, { type: 'presence.enter', name: 'Late' }], ['Mara', 'Ivo', 'Late'])), 'Ivo,Mara', 'the late arrival stays the reader’s to name');
});

test('M752-K4 THE READERS ARE TOLD EACH KIND OF KNOWING AS THE STORYTELLER IS: a stated ignorance, a suspicion and a belief were read to the page reader, the world agent, the scribe and the auditor as "Mara knows: …" while the storyteller was told "Mara has not learned: …"; a line let go is found by the words the readers are shown', () => {
  const st = { ...room(5, ['Mara']), knowledge: { Mara: [
    { fact: 'the key is in the vault', kind: 'ignorance', atTurn: 5 },
    { fact: 'Ivo is a spy', kind: 'suspicion', atTurn: 5 },
    { fact: 'believes the duke is in the capital — untrue: the duke rode for the border at dawn', atTurn: 5 },
    { fact: 'the chapel bell is cracked', atTurn: 5, pathway: 'she rang it herself' },
  ] } };
  const storyteller = renderKnowledge(st.knowledge, [{ name: 'Mara' }], Infinity, { mc: 'Jovan', turn: 6 });
  const workers = renderAllKnowledge(st.knowledge, [{ name: 'Mara' }]);
  for (const said of ['Mara knows: the chapel bell is cracked (how: she rang it herself).', 'Mara suspects: Ivo is a spy.', 'Mara has not learned: the key is in the vault.', 'Mara believes: the duke is in the capital — untrue: the duke rode for the border at dawn.']) {
    assert(storyteller.includes(said), 'the storyteller: ' + said + ' — ' + storyteller);
    assert(workers.includes(said.replace(/^Mara knows/, 'Mara (in the scene) knows')), 'the readers, in the same words: ' + said + ' — ' + workers);
  }
  assert(!/knows: [^.]*the key is in the vault/.test(workers) && !/knows: [^.]*Ivo is a spy/.test(workers), 'never "knows" what she has not learned, nor what she only suspects: ' + workers);
  for (const [who, sent] of [['the world agent', buildWorldMessages({ state: st, userText: 'u', assistantText: 'a' }).user], ['the page reader', buildExtractorMessages({ state: st, userText: 'u', assistantText: 'a' }).user], ['the whole ledger (scribe, auditor, housekeeper)', renderWholeLedger(st)]]) {
    assert(/Mara[^\n]*has not learned: the key is in the vault/.test(sent) && !/knows: [^.]*the key is in the vault/.test(sent), who + ' is told it as it is');
  }
  /* letting go by the words the readers are shown: the line "believes …" quoted as shown under "Mara believes:" */
  const gone = applyMutations(st, [{ type: 'knowledge.forget', name: 'Mara', fact: 'the duke is in the capital — untrue: the duke rode for the border at dawn' }]);
  eq(gone.applied.length, 1, 'found by its shown words: ' + JSON.stringify(gone.rejected.map((r) => r.why)));
  assert(!gone.state.knowledge.Mara.some((k) => /duke is in the capital/.test(k.fact)) && gone.state.knowledge.Mara.length === 3, 'that line, only');
  /* a bare quote that answers two kinds of knowing names neither */
  const two = { ...st, knowledge: { Mara: [{ fact: 'suspects Ivo is a spy', atTurn: 5 }, { fact: 'believes Ivo is a spy', atTurn: 5 }] } };
  eq(applyMutations(two, [{ type: 'knowledge.forget', name: 'Mara', fact: 'Ivo is a spy' }]).applied.length, 0, 'two kinds answer the bare words: neither is guessed');
  eq(applyMutations(two, [{ type: 'knowledge.forget', name: 'Mara', fact: 'Ivo is a spy', kind: 'belief' }]).state.knowledge.Mara.map((k) => k.fact).join(','), 'suspects Ivo is a spy', 'the kind named decides');
  eq(applyMutations(two, [{ type: 'knowledge.forget', name: 'Mara', fact: 'believes Ivo is a spy' }]).state.knowledge.Mara.map((k) => k.fact).join(','), 'suspects Ivo is a spy', 'and its exact line, first');
});

test('M752-K5 WHAT M713 KEEPS FOR GOOD IS SHOWN TO A SIZE: three hundred open threads stay in the ledger — and the storyteller’s whole view and every worker’s whole ledger show forty, the hot and lately touched first, and count the rest (they were shown all three hundred: a view that grew with the tale)', () => {
  let threads = [];
  /* three hundred DIFFERENT threads — titles that share all their telling words are one thread (sameThreadTitle) */
  const word = (i) => [0, 1, 2, 3].map((d) => String.fromCharCode(97 + Math.floor(i / 26 ** d) % 26)).join('');
  const title = (i) => 'The ' + word(i) + ' errand';
  for (let i = 0; i < 300; i += 1) threads = setThread(threads, { title: title(i), owner: 'Kaelen', heat: i % 3 ? 'cold' : 'hot', next: 'see the ' + word(i) + ' errand through' }, i);
  eq(threads.length, 300, 'the ledger keeps every one (M713)');
  const st = { ...room(310, ['Kaelen']), threads };
  const story = (renderStateFacts(st, { whole: true, budget: 2000000 }).split('Threads still open: ')[1] || '').split('\n').filter(Boolean);
  eq(story.length, THREADS_VIEW + 1, 'the storyteller’s whole view: forty and a count');
  eq(story[THREADS_VIEW], '(and 260 more open threads, kept in the ledger)');
  assert(story.slice(0, THREADS_VIEW).every((l) => !l.startsWith('(cold)')) && story[0].startsWith(title(297) + ' — Kaelen'), 'the hot first, the newest of them leading: ' + story[0]);
  const all = renderAllThreads(threads).split('\n');
  eq(all.length, THREADS_VIEW + 1, 'a worker’s whole ledger: forty and a count');
  assert(/^\(and 260 more open threads, untouched longest, kept in the ledger and not shown here/.test(all[THREADS_VIEW]), all[THREADS_VIEW]);
  assert(all.slice(0, THREADS_VIEW).every((l) => /^"/.test(l)), 'each shown title in quotes, as the ledger holds it');
  const world = buildWorldMessages({ state: st, userText: 'u', assistantText: 'a' }).user;
  eq((world.slice(world.indexOf('THREADS:'), world.indexOf('WHO KNOWS WHAT')).match(/^(?:\(cold\) )?"The [a-z]{4} errand"/gm) || []).length, THREADS_VIEW, 'the world agent is sent forty');
  eq(renderAllThreads(threads.slice(0, 12)).split('\n').length, 12, 'a ledger within the room is shown whole, as it was');
});

/* ---------- M752-K6…K9: THE SEATS OF A LONG TALE (the coordinator's finding 3(b)) ----------
 * M719 let the seats grow with the tale and fitted only the world agent's own view; the whole ledger the page reader, the
 * scribe, the auditor, the housekeeper and the founder are sent, and the storyteller's whole view, listed every seat.
 * A tale of three hundred seats: every name word its own (engine/names.js nameOnPage reads any word of a name). The seats
 * are written by the engine's own seat writer (engine/offscreen.js seat) — two a page, over a hundred and fifty pages. */
const PRE = ['Ka', 'Odi', 'Bra', 'Tom', 'Lu', 'Ine', 'Pie', 'Mar', 'Jos', 'Ver', 'Emi', 'San', 'Ruf', 'Gre', 'Hug', 'Len', 'Ade', 'Cor', 'Fel', 'Ilo'];
const SUF = ['lin', 'dra', 'mesk', 'vor', 'nith', 'bel', 'taro', 'quin', 'sade', 'rook', 'mira', 'dun', 'veth', 'zarn', 'pell'];
const SUR1 = ['Var', 'Kess', 'Wey', 'Brant', 'Moll', 'Daan', 'Orsk', 'Fenn', 'Lisk', 'Holt', 'Rav', 'Quist', 'Ambr', 'Cors', 'Teag'];
const SUR2 = ['ega', 'olm', 'ardt', 'ings', 'ovic', 'eaux', 'ström', 'anni', 'okoro', 'elle', 'ebrand', 'ady', 'ewicz', 'ott', 'ura', 'ales', 'imba', 'onde', 'ush', 'ayne'];
const seatedName = (i) => PRE[i % 20] + SUF[Math.floor(i / 20) % 15] + ' ' + SUR1[i % 15] + SUR2[Math.floor(i / 15) % 20];
const PLACES = ['the harbour office, second floor', 'the night market by the canal', 'the old mill on the river road', 'the infirmary on Weaver Street', 'the guild hall archive', 'a rented room above the bakery'];
const DOING = ['sorting the week’s ledgers by lamplight', 'arguing prices with a spice trader', 'mending nets with two apprentices', 'waiting out the rain with a cold supper', 'copying letters for the magistrate'];
const WANTS = ['get the sealed letter to the harbourmaster before dawn', 'find out who sold the warehouse keys', 'win back the stall the guild took', 'learn whether the ferry runs after the storm'];
function longTale(seated = 300) {
  const st = applyMutations({ ...emptyState(), page: 150 }, [
    { type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'the Lantern Inn, common room' },
    { type: 'clock.set', year: 1341, month: 6, day: 12, hour: 20, minute: 0 },
    ...['Jovan', 'Rias', 'Kim'].map((name) => ({ type: 'presence.enter', name })),
    { type: 'people.set', name: 'Rias', field: 'core', text: 'the innkeeper’s daughter' },
    { type: 'people.set', name: 'Kim', field: 'core', text: 'a courier; her brother ' + seatedName(48) + ' keeps the lighthouse' },
    { type: 'people.set', name: seatedName(250), field: 'core', text: 'the ferryman’s widow' },
    { type: 'thread.set', title: 'Rias and the debt', owner: 'Rias', with: seatedName(2), next: 'pay it before the fair' },
  ]).state;
  const clock = st.clock.minutes;
  let off = {};
  for (let i = 0; i < seated; i += 1) {
    off = seat(off, seatedName(i), i % 60 === 7 ? { location: 'dead — buried in the chapel yard' }
      : { location: PLACES[i % 6], activity: DOING[i % 5], agenda: i % 3 === 2 ? undefined : WANTS[i % 4], stance: i % 5 === 0 ? 'busy' : 'waiting' }, clock - 600, 1 + Math.floor(i / 2));
  }
  if (seated > 60) {
    off = seat(off, seatedName(40), { location: 'the river road', activity: 'riding for the inn', stance: 'toward', etaMinutes: 10 }, clock, 151); /* due within the quarter hour */
    off = seat(off, seatedName(41), { location: 'the ferry landing', activity: 'walking up from the boats', stance: 'toward', etaMinutes: 15 }, clock, 151);
    off = seat(off, seatedName(60), { location: 'the tannery yard', activity: 'counting coin', agenda: 'get Kim to carry a letter north', stance: 'waiting' }, clock, 151); /* a want that names someone here */
  }
  return { ...st, offscreen: off };
}
const TALE_USER = 'I ask Rias whether ' + seatedName(0) + ' came by tonight.';
const TALE_PAGE = 'Rias wiped the counter. “' + seatedName(0) + '? Not tonight. ' + seatedName(1) + ' was asking after her, though.” Kim looked up from her letters.';
const elsewhereOf = (text) => { const at = text.indexOf('Elsewhere —'); return at === -1 ? '' : text.slice(at, text.indexOf('\nWhat their bodies carry:', at)); };
const seatRows = (section) => section.split('\n').slice(1).filter((l) => !/^\(and \d+ more seated elsewhere/.test(l));
const seatOf = (section, name) => seatRows(section).some((l) => l.startsWith(name + ' — ') || (l.startsWith('Dead: ') && l.includes(name)));

test('M752-K6 THE SEATS OF A LONG TALE ARE FITTED TO WHAT IS READ: three hundred seats were 46,282 characters in every page reader, scribe, auditor, housekeeper and founder request (since M719 nothing lets a seat go, and a request over its connection is refused before it is sent) — each now holds forty, chosen for its reading (the people it names, those on their way or due, those tied to the people here, open wants, the lately seated), and counts the rest; the people a reading names are never left out', async () => {
  const st = longTale();
  eq(Object.keys(st.offscreen).length, 300, 'three hundred seats kept (M719: no seat is let go)');
  const { buildScribeMessages } = await import('../../js/agents/scribe.js');
  const { buildAuditorMessages } = await import('../../js/agents/auditor.js');
  const { buildHousekeeperContext } = await import('../../js/agents/housekeeper.js');
  const { buildFounderMessages } = await import('../../js/agents/founder.js');
  const readers = {
    'the page reader': buildExtractorMessages({ state: st, userText: TALE_USER, assistantText: TALE_PAGE, pageNumber: 302 }).user,
    'the scribe': buildScribeMessages({ state: st, userText: TALE_USER, assistantText: TALE_PAGE }).user,
    'the auditor': buildAuditorMessages({ state: st, pages: [{ role: 'user', text: TALE_USER, ordinal: 301 }, { role: 'assistant', text: TALE_PAGE, ordinal: 302 }] }).user,
    'the housekeeper': buildHousekeeperContext({ story: { title: 't', brief: 'Jovan keeps the Lantern Inn’s books.', castNotes: '' }, messages: [{ id: 'u1', role: 'user', text: TALE_USER }, { id: 'a1', role: 'assistant', text: TALE_PAGE }], state: st, modules: [], lore: [], memory: null, session: null, contextPages: 4, writerText: 'Where is ' + seatedName(0) + ' tonight?' }),
  };
  /* every seat, as the readers were sent them before (the same lines, none left out) */
  const { renderSeatsForReading } = await import('../../js/engine/offscreen.js');
  const all = renderSeatsForReading(st, { shown: Infinity });
  for (const [who, text] of Object.entries(readers)) {
    const section = elsewhereOf(text);
    const rows = seatRows(section);
    assert(rows.length <= SEATS_VIEW && section.length * 3 < all.length, who + ': forty seats at most, the section held to a size: ' + rows.length + ' rows, ' + section.length + ' characters of ' + all.length);
    for (const [name, why] of [[seatedName(0), 'named by the page'], [seatedName(1), 'named by the page'], [seatedName(40), 'on the way, due in ten minutes'], [seatedName(41), 'on the way, due in fifteen'],
      [seatedName(2), 'an open thread with Rias, who is here'], [seatedName(48), 'Kim’s brother, on Kim’s own page'], [seatedName(60), 'a want that names Kim']]) assert(seatOf(section, name), who + ': ' + name + ' is shown — ' + why);
    assert(!seatOf(section, seatedName(5)), who + ': an old seat nothing here bears on (no want, unnamed, untied) waits in the ledger');
    assert(new RegExp('\\n\\(and ' + (300 - rows.length) + ' more seated elsewhere — each keeps their seat in the ledger, not shown here; fetch "person: NAME" for anyone’s page and where they are now').test(section), who + ': the rest are counted, with the way to each: ' + section.slice(-300));
  }
  /* the founder cannot look: it is told how many more, never told to fetch; and the people ITS material names are shown */
  const founder = elsewhereOf(buildFounderMessages({ state: st, brief: 'Jovan keeps the Lantern Inn’s books; ' + seatedName(250) + ' owes him the rent.', castNotes: 'Kim — a courier.' }).user);
  assert(seatOf(founder, seatedName(250)) && seatRows(founder).length <= SEATS_VIEW, 'the founder: the one its brief names is shown, forty at most');
  assert(/\n\(and \d+ more seated elsewhere, kept in the ledger and not shown here\)$/.test(founder) && !/fetch/.test(founder), 'and the rest are counted, with no fetch it cannot make');
  /* a reading that names more than forty: every one it names is shown — bounded by the reading, never by the tale */
  const crowd = Array.from({ length: 45 }, (_, i) => seatedName(100 + i)).join(', ');
  const named = elsewhereOf(buildExtractorMessages({ state: st, userText: 'I read the roll.', assistantText: 'Rias read the roll: ' + crowd + '.', pageNumber: 303 }).user);
  eq(Array.from({ length: 45 }, (_, i) => seatedName(100 + i)).filter((n) => seatOf(named, n)).length, 45, 'all forty-five the page names are shown');
  eq(seatRows(named).length, 45, 'and no one else past them');
  /* a tale within the room is shown whole, as it was */
  const small = longTale(40);
  const whole = elsewhereOf(renderWholeLedger(small, { material: TALE_PAGE, fetchable: true }));
  eq(seatRows(whole).filter((l) => !l.startsWith('Dead: ')).length + (whole.match(/Dead: [^\n]*/) || [''])[0].split(';').filter(Boolean).length, 40, 'forty seats: every one shown');
  assert(!/more seated elsewhere/.test(whole), 'and nothing counted');
});

/* a wire that answers from a script, one answer a call (the last repeats) */
function scripted(answers) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url: String(url), body });
    const text = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (body.stream) {
      const lines = 'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n';
      return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(lines)); c.close(); } }), async json() { return {}; }, async text() { return lines; }, clone() { return this; } };
    }
    const obj = { choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }] };
    return { ok: true, status: 200, headers: new Headers(), async json() { return obj; }, async text() { return JSON.stringify(obj); }, clone() { return this; } };
  };
  return { calls, fetch: fetchImpl };
}

test('M752-K7 "person: NAME" SERVES WHERE THEY ARE: a seat not shown is fetched with its person — the page and the seat, or the seat alone when no page is written (it served the page only, and "No page is written" for a seat with no page: the world agent\'s own "Fetch person: NAME before changing an unshown record" could never be answered); through the page reader\'s own look', async () => {
  const st = longTale();
  const { serveFetch } = await import('../../js/agents/housekeeper.js');
  const both = serveFetch(['person: ' + seatedName(250)], [], { state: st });
  assert(new RegExp('^\\[the page of ' + seatedName(250) + '\\] \\(COMPLETE\\)\\n  CORE: the ferryman’s widow[\\s\\S]*\\n  WHERE THEY ARE NOW \\(their seat elsewhere\\): ' + seatedName(250) + ' — the guild hall archive, ').test(both), 'the page, then where they are: ' + both);
  const alone = serveFetch(['person: ' + seatedName(5)], [], { state: st });
  assert(new RegExp('^\\[the seat of ' + seatedName(5) + '\\] \\(no character page is written for them\\)\\n  WHERE THEY ARE NOW \\(their seat elsewhere\\): ' + seatedName(5) + ' — ' + PLACES[5 % 6] + ', ').test(alone), 'a seat with no page is served: ' + alone);
  assert(/WHERE THEY ARE NOW: in the scene\./.test(serveFetch(['person: Rias'], [], { state: st })), 'someone here is said to be here');
  assert(/No page is written for “Nobody Here”\./.test(serveFetch(['person: Nobody Here'], [], { state: st })), 'an unknown name still says so');
  /* the page reader looks: its request does not show the old seat; the answer to its look does */
  await saveState('m752-k7', st);
  const answer = JSON.stringify({ mutations: [{ type: 'mode.snapshot', flags: [] }], resolved: [], here: ['Jovan', 'Rias', 'Kim'] });
  const house = scripted(['<fetch>["person: ' + seatedName(5) + '"]</fetch>', answer]);
  await withHouse(house, () => extractTurn({ connection: HOUSES[0].conn, state: st, userText: TALE_USER, assistantText: TALE_PAGE, storyId: 'm752-k7', pageNumber: 302 }));
  const seatWords = seatedName(5) + ' — ' + PLACES[5 % 6];
  assert(house.calls.length >= 2 && !JSON.stringify(house.calls[0].body).includes(seatWords), 'the first request leaves the old seat out (' + house.calls.length + ' calls)');
  assert(JSON.stringify(house.calls[1].body).includes('WHERE THEY ARE NOW (their seat elsewhere): ' + seatWords), 'and the look serves it');
});

test('M752-K8 EVERY READER THAT CAN LOOK IS TOLD SO: the page reader, the scribe, the auditor and the world agent are told "person: NAME" serves where someone is, and the housekeeper likewise; the seats a reader is not shown are named with the way to them', async () => {
  const st = longTale();
  const { buildScribeMessages } = await import('../../js/agents/scribe.js');
  const { buildAuditorMessages } = await import('../../js/agents/auditor.js');
  const { runConversation } = await import('../../js/agents/housekeeper.js');
  const told = /"person: NAME" — that person's character page, whole, and where they are now \(their seat,\s+when they are elsewhere\) — anyone the ledger holds, shown here or not\./;
  for (const [who, m] of [['the page reader', buildExtractorMessages({ state: st, userText: TALE_USER, assistantText: TALE_PAGE })], ['the scribe', buildScribeMessages({ state: st, userText: TALE_USER, assistantText: TALE_PAGE })],
    ['the auditor', buildAuditorMessages({ state: st, pages: [{ role: 'assistant', text: TALE_PAGE, ordinal: 302 }] })], ['the world agent', buildWorldMessages({ state: st, userText: TALE_USER, assistantText: TALE_PAGE })]]) {
    assert(told.test(m.system), who + ' is told the look serves where someone is');
  }
  const sent = [];
  await runConversation({ connection: HOUSES[0].conn, story: { id: 'm752-k8', title: 't', brief: '', castNotes: '' }, messages: [{ id: 'a1', role: 'assistant', text: TALE_PAGE }], state: st, modules: [], lore: [], memory: null, session: { turns: [] }, writerText: 'Where is ' + seatedName(5) + '?', call: async (req) => { sent.push(req); return { text: 'Looking.' }; } });
  const hk = sent.length ? JSON.stringify(sent[0]) : '';
  assert(/a person's whole page with where they are now/.test(hk), 'the housekeeper is told the same');
  assert(/more seated elsewhere — each keeps their seat in the ledger, not shown here; fetch \\"person: NAME\\" for anyone’s page and where they are now/.test(hk), 'and its ledger names the way to the seats it does not show');
});

test('M752-K9 THE STORYTELLER\'S WHOLE VIEW KEEPS ITS PLACE ON A LONG TALE: it held a thousand seats, and three hundred shed the whole state of things on a 128k storyteller — threads, the arrivals, Elsewhere itself, down to its first line; it holds the forty this scene bears on and counts the rest; the compact view keeps its six', async () => {
  const { stateView } = await import('../../js/engine/state.js');
  const st = longTale();
  for (const tokens of [128000, 1000000]) {
    const facts = renderStateFacts(st, { ...stateView(tokens), scenePages: [TALE_USER, TALE_PAGE] });
    const at = facts.indexOf('\nElsewhere: ');
    assert(at !== -1 && /Threads still open: /.test(facts), tokens + ': Elsewhere and the threads stand (' + facts.length + ' characters)');
    const rows = facts.slice(at + 1).split('\n').slice(0, SEATS_VIEW + 1);
    for (const name of [seatedName(0), seatedName(1), seatedName(40), seatedName(41), seatedName(2)]) assert(facts.includes(name + ' — '), tokens + ': ' + name + ' is in the view');
    assert(new RegExp('\\(and \\d+ more seated elsewhere, kept in the ledger and not shown here\\)').test(facts), tokens + ': the rest are counted');
    assert(rows.length > 0 && facts.length < 12000, tokens + ': the view held to a size: ' + facts.length);
  }
  const compact = renderStateFacts(st, { scenePages: [TALE_USER, TALE_PAGE] });
  const seatedLines = compact.split('\n').map((l) => l.replace(/^Elsewhere: /, '')).filter((l) => Array.from({ length: 300 }, (_, i) => seatedName(i)).some((n) => l.startsWith(n + ' — ')));
  eq(seatedLines.length, 6, 'the compact view keeps its six: ' + seatedLines.map((l) => l.slice(0, 40)).join(' | '));
});

test('M752-K10 "EVERYONE HERE BUT NAME" — THE ONE WHO DID IT IS NO WITNESS OF THEIR OWN ACT: a line in the taught "that …" form names nobody the way "saw X…" does, so code cannot tell who did it, and "everyone here" wrote Rias\'s own announcement into her book; the reader is taught to leave her out by name — and "everyone here but Rias" was read as a PERSON of that name, with a book', async () => {
  const st = room(4, ['Rias', 'Tom', 'Mara']);
  const settle = (lines) => settleWitnesses(st, parseExtractorAnswer(JSON.stringify({ mutations: lines })).mutations, null).filter((m) => m.type === 'knowledge.add');
  const who = (lines) => settle(lines).map((m) => m.name).join(',');
  eq(who([{ type: 'knowledge.add', who: 'everyone here but Rias', fact: 'that Rias is engaged to the duke' }]), 'Tom,Mara', 'the room less the one who said it');
  eq(who([{ type: 'knowledge.add', who: ['everybody except Rias and Tom'], fact: 'that Rias is engaged to the duke' }]), 'Mara', 'less two');
  eq(who([{ type: 'knowledge.add', who: ['all of them but Rias', 'Sentaro'], fact: 'that Rias is engaged to the duke' }]), 'Tom,Mara,Sentaro', 'and one named besides');
  eq(who([{ type: 'knowledge.add', who: 'everyone here', fact: 'that the duke is coming' }]), 'Rias,Tom,Mara', '"everyone here" is still the whole room');
  eq(who([{ type: 'knowledge.add', who: ['All Might'], fact: 'f' }]), 'All Might', 'a name that merely begins like it is still a person');
  /* nothing of the mark reaches the ledger, and no "person" called "everyone here but Rias" */
  const after = applyMutations(st, settle([{ type: 'knowledge.add', who: 'everyone here but Rias', fact: 'that Rias is engaged to the duke', source: { quote: 'Rias raised her glass: “I am to marry the duke.”', recipients: ['everyone here but Rias'] } }])).state;
  eq(Object.keys(after.knowledge).sort().join(','), 'Mara,Tom', 'two books, hers not among them');
  eq(JSON.stringify(after.knowledge.Tom[0].source && after.knowledge.Tom[0].source.recipients), JSON.stringify(['Tom', 'Mara']), 'and the receipt names the ones it was written for');
  /* the reader is taught it, and its answer — through the real page reader — leaves her out */
  const taught = buildExtractorMessages({ state: st, userText: 'I listen.', assistantText: 'Rias raised her glass.' }).system;
  assert(/the one who did or said it is no witness of their own act: when they stand in the room, write "who":"everyone here but NAME"/.test(taught), 'the page reader is taught to leave the one who did it out by name');
  const answer = JSON.stringify({ mutations: [{ type: 'mode.snapshot', flags: [] }, { type: 'knowledge.add', who: 'everyone here but Rias', fact: 'that Rias is engaged to the duke', source: { quote: 'Rias raised her glass', recipients: ['everyone here but Rias'] } }], resolved: [], here: ['Jovan', 'Rias', 'Tom', 'Mara'] });
  const read = await withHouse(thinkingHouse({ answer }), () => extractTurn({ connection: HOUSES[0].conn, state: st, userText: 'I listen.', assistantText: PAGE('Rias raised her glass: “I am to marry the duke.”'), pageNumber: 5 }));
  const lines2 = read.mutations.filter((m) => m.type === 'knowledge.add');
  eq(lines2.map((m) => m.name).join(','), 'Tom,Mara', 'the reading writes it for the others');
  assert(lines2.every((m) => m.except === undefined && m.room === undefined && m.decided === undefined), 'with no mark left on the lines');
});
