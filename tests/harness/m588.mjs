/* Cozy Tavern — harness laws of M588: who is here, and where everyone else is (his reports: "she's not at my location, why
 * is she still here?"; "I walked to her door and she's gone from the world and from who's here"). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

test('M588-1 A PERSON IS ALWAYS SOMEWHERE: an elsewhere note is never let go while she is not in the scene (she would be nowhere); a new place moves it, walking in lets it go, and a note of someone here is still let go', () => {
  const st = applyMutations({ ...emptyState() }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Academy courtyard' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'people.set', name: 'Rukia', field: 'core', text: 'a shinigami of the Thirteenth' }, { type: 'offscreen.set', name: 'Rukia', location: 'her quarters in the east wing' }, { type: 'offscreen.set', name: 'a stray porter', location: 'the gate' }]).state;
  eq(applyMutations(st, [{ type: 'offscreen.clear', name: 'a stray porter' }]).applied.length, 1, 'a note nobody\u2019s page carries may still be let go');
  const r = applyMutations(st, [{ type: 'offscreen.clear', name: 'Rukia' }]);
  eq(r.applied.length, 0, 'refused');
  assert(/leave them nowhere/.test(r.rejected[0].why), r.rejected[0].why);
  eq(r.state.offscreen.Rukia.location, 'her quarters in the east wing', 'she is still somewhere');
  eq(applyMutations(st, [{ type: 'offscreen.set', name: 'Rukia', location: 'behind her door' }]).state.offscreen.Rukia.location, 'behind her door', 'a new place moves the note');
  const inScene = applyMutations(st, [{ type: 'presence.enter', name: 'Rukia' }]).state;
  assert(inScene.present.some((p) => p.name === 'Rukia') && !inScene.offscreen.Rukia, 'walking in lets it go');
});

test('M588-2 HE WALKS AWAY, SHE STAYS: the reader\'s leave stands when the page ends on the main character going (it was thrown away unless SHE went); and a move inside a compound (the academy\'s courtyard to its dormitory) is a move — whoever the new room does not hold stays behind', async () => {
  const { extractTurn } = await import('../../js/agents/extractor.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const st = applyMutations({ ...emptyState(), page: 20 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Academy courtyard' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rukia' }]).state;
  const h = HOUSES[0];
  const same = '[Academy courtyard — Monday, March 3, 2025 | 09:30 | clear | uniform | by the fountain]\n\nRukia stayed by the fountain. Jovan turned his back on her and walked away toward the far gate, leaving the courtyard behind.';
  const leave = JSON.stringify({ mutations: [{ type: 'presence.leave', name: 'Rukia', cause: 'he walked away; she stayed by the fountain' }], brief: { pressure: [], ripe: [], twb: null }, deltas: [] });
  const read = await withHouse(thinkingHouse({ answer: leave }), () => extractTurn({ connection: h.conn, state: st, userText: 'I walk away.', assistantText: same, pageNumber: 20 }));
  assert(read.mutations.some((m) => m.type === 'presence.leave' && m.name === 'Rukia'), 'his walking off: her leave stands: ' + JSON.stringify(read.mutations));
  const after = applyMutations(st, read.mutations).state;
  assert(!after.present.some((p) => p.name === 'Rukia') && after.offscreen.Rukia, 'not here, and seated where he left her: ' + JSON.stringify(after.offscreen.Rukia));
  const dorm = '[Academy dormitory — Monday, March 3, 2025 | 09:40 | clear | uniform | in the hall]\n\nJovan pushed open the dormitory door. The hall was empty.';
  const roomOnlyHim = JSON.stringify({ mutations: [], here: ['Jovan'], brief: { pressure: [], ripe: [], twb: null }, deltas: [] });
  const read2 = await withHouse(thinkingHouse({ answer: roomOnlyHim }), () => extractTurn({ connection: h.conn, state: st, userText: 'I go to the dormitory.', assistantText: dorm, pageNumber: 21 }));
  assert(read2.mutations.some((m) => m.type === 'presence.leave' && m.name === 'Rukia' && /left behind at Academy courtyard/.test(m.cause)), 'left behind in the courtyard: ' + JSON.stringify(read2.mutations));
});

test('M588-3 A STATED FEELING SETS ITS LEVEL, AND WHO IS CLOSE BY IS SHOWN: the page reader and the founder carry the levels (in love is R 55–75, never P alone; a feeling revealed is a rel.set, not an inch); the storyteller is shown who is behind the door he is at — and the attempt rule reaches them', async () => {
  const ex = await import('../../js/agents/extractor.js');
  const fo = await import('../../js/agents/founder.js');
  const st0 = applyMutations({ ...emptyState() }, [{ type: 'mc.set', name: 'Jovan' }]).state;
  const exMsgs = ex.buildExtractorMessages({ state: st0, userText: 'x', assistantText: 'y' });
  const exSys = String(exMsgs.system || (exMsgs.messages ? exMsgs.messages[0].content : ''));
  assert(/REVEALED, NOT EARNED/.test(exSys) && /in love 55–75/.test(exSys) && /Romantic love is R — never P alone/.test(exSys), 'the page reader carries the levels');
  const foMsgs = fo.buildFounderMessages({ state: st0, brief: 'Rukia has loved Jovan since school.' });
  const foSys = String(foMsgs.system || (foMsgs.messages ? foMsgs.messages[0].content : '')) + JSON.stringify(foMsgs);
  assert(/in\s+love 55–75/.test(foSys) && /"r":65/.test(foSys), 'and the founder');
  const { renderStateFacts } = await import('../../js/engine/state.js');
  const st = applyMutations(st0, [{ type: 'place.set', name: 'Rukia’s quarters' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'offscreen.set', name: 'Rukia', location: 'Rukia’s quarters', activity: 'behind the door' }, { type: 'offscreen.set', name: 'Renji', location: 'the training yard' }]).state;
  const facts = renderStateFacts(st);
  assert(/Close by — not in the scene, but right here[\s\S]*Rukia — Rukia’s quarters \(behind the door\)/.test(facts), 'who is behind the door is shown: ' + facts.slice(0, 300));
  assert(/Elsewhere:[\s\S]*Renji/.test(facts) && !/Elsewhere:[\s\S]*Rukia/.test(facts), 'once, never also among Elsewhere');
  const { CRAFT_TEXT } = await import('../../js/assemble/craft.js');
  assert(/or one Close by \(behind the door he is at/.test(CRAFT_TEXT) && /Walking through someone's door is walking into THEIR space/.test(CRAFT_TEXT), 'the attempt rule reaches them');
});

test('M588-4 THE AUDITOR RESTORES A WRONG STANDING AT ITS LEVEL: a lover at P+2 with R at 0 is a standing to restore, with the same levels the reader and the founder carry', async () => {
  const au = await import('../../js/agents/auditor.js');
  const st0 = applyMutations({ ...emptyState() }, [{ type: 'mc.set', name: 'Jovan' }]).state;
  const build = au.buildAuditorMessages || au.buildAuditMessages;
  const msgs = build({ state: st0, brief: 'Rukia loves Jovan.', pages: [], record: '' });
  const sys = String(msgs.system || (msgs.messages ? msgs.messages[0].content : '')) + JSON.stringify(msgs);
  assert(/in love R 55–75/.test(sys) && /A lover at P\+2 with R at 0 is a wrong standing to restore/.test(sys), 'the auditor carries the levels');
});

test('M588-5 THE STANDINGS REBUILD CARRIES THE LEVELS TOO — every helper that writes a standing reads the same scale', async () => {
  const au = await import('../../js/agents/auditor.js');
  const st0 = applyMutations({ ...emptyState() }, [{ type: 'mc.set', name: 'Jovan' }]).state;
  const msgs = au.buildRebuildMessages({ state: st0, brief: 'Rukia loves Jovan.', castNotes: '', record: '', pages: [], mc: 'Jovan' });
  const all = JSON.stringify(msgs);
  assert(/in love 55–75/.test(all) && /Romantic love is r, never p alone/.test(all), 'the rebuild carries the levels');
});

test('M589 THE MAIN CHARACTER NEVER STEPS OUT OF HIS OWN SCENE; and who is close by is one reading — the storyteller\'s facts and the small storyteller\'s planner alike may plan the woman behind the door', async () => {
  const st = applyMutations({ ...emptyState() }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Rukia’s quarters' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'people.set', name: 'Rukia', field: 'core', text: 'x' }, { type: 'offscreen.set', name: 'Rukia', location: 'Rukia’s quarters', activity: 'behind the door' }]).state;
  const out = applyMutations(st, [{ type: 'presence.leave', name: 'Jovan' }]);
  eq(out.applied.length, 0, 'refused');
  assert(out.state.present.some((p) => p.name === 'Jovan'), 'he is still in his scene');
  const { closeBy } = await import('../../js/engine/state.js');
  eq(closeBy(st).map((n) => n.key).join(','), 'Rukia', 'close by');
  const { readPlan } = await import('../../js/agents/planner.js');
  const plan = readPlan(JSON.stringify({ story: 's', scene: 'he knocks', people: [{ name: 'Rukia', now: 'hears his knock, heart racing', wants: 'to open it' }] }), { present: ['Jovan', 'Rukia'], mc: 'Jovan' });
  eq(plan.people.map((p) => p.name).join(','), 'Rukia', 'the planner may plan her answer to the door');
});

test('M594 EVERY HELPER IS TOLD THE PRESENCE RULES THE LEDGER KEEPS: his walking away leaves her behind (the page reader writes it), and an elsewhere note is let go only for someone in the scene — anyone else is moved to where they are now', async () => {
  const st0 = applyMutations({ ...emptyState() }, [{ type: 'mc.set', name: 'Jovan' }]).state;
  const ex = (await import('../../js/agents/extractor.js')).buildExtractorMessages({ state: st0, userText: 'x', assistantText: 'y' });
  const exSys = JSON.stringify(ex);
  assert(/OR he walks away and leaves them behind/.test(exSys) && !/ONLY when the page SHOWS them leaving/.test(exSys), 'the page reader');
  assert(/only for someone who is in the scene now/.test(exSys), 'its clear rule');
  const wSrc = JSON.stringify((await import('../../js/agents/world.js')));
  const all = [
    JSON.stringify((await import('../../js/agents/auditor.js')).buildAuditorMessages({ state: st0, brief: '', pages: [], record: '' })),
  ];
  assert(all.every((t) => /a person the story keeps is always somewhere/.test(t)), 'the auditor');
});

test('M594-2 HE LEAVES WITHOUT A WORD: when the page ends on him going, the reader\'s leave of someone the page never names still stands — the room is left behind him', async () => {
  const { extractTurn } = await import('../../js/agents/extractor.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const st = applyMutations({ ...emptyState(), page: 20 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'the mess hall' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Renji' }]).state;
  const page = '[the mess hall — Monday, March 3, 2025 | 12:30 | clear | uniform | by the door]\n\nThe argument had gone on long enough. Jovan pushed back his chair and walked out without a word.';
  const answer = JSON.stringify({ mutations: [{ type: 'presence.leave', name: 'Renji', cause: 'he walked out; Renji stayed at the table' }], brief: { pressure: [], ripe: [], twb: null }, deltas: [] });
  const read = await withHouse(thinkingHouse({ answer }), () => extractTurn({ connection: HOUSES[0].conn, state: st, userText: 'I leave.', assistantText: page, pageNumber: 20 }));
  assert(read.mutations.some((m) => m.type === 'presence.leave' && m.name === 'Renji'), 'Renji, never named on the page, is left behind: ' + JSON.stringify(read.mutations));
});

test('M597 CLOSE BY READS A ROOM WITHIN REACH, NOT ONLY THE SCENE\'S EXACT NAME: "Rukia’s quarters — behind the door", "— the bedroom", "the next room" are close by and shown so; another part of a big place ("Seireitei — the 6th Division") or the same compound\'s yard is not', async () => {
  const { closeBy, renderStateFacts } = await import('../../js/engine/state.js');
  const st = applyMutations({ ...emptyState() }, [
    { type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Rukia’s quarters' }, { type: 'presence.enter', name: 'Jovan' },
    { type: 'people.set', name: 'Rukia', field: 'core', text: 'x' }, { type: 'offscreen.set', name: 'Rukia', location: 'Rukia’s quarters — the bedroom', activity: 'behind the closed door, reading' },
    { type: 'people.set', name: 'Kiyone', field: 'core', text: 'x' }, { type: 'offscreen.set', name: 'Kiyone', location: 'the next room', activity: 'sorting reports' },
    { type: 'people.set', name: 'Renji', field: 'core', text: 'x' }, { type: 'offscreen.set', name: 'Renji', location: 'Seireitei — the 6th Division barracks' },
  ]).state;
  eq(closeBy(st).map((n) => n.key).sort().join(','), 'Kiyone,Rukia', 'the two within reach');
  const facts = renderStateFacts(st);
  assert(/Close by[\s\S]*Rukia — Rukia’s quarters — the bedroom/.test(facts) && /Elsewhere:[\s\S]*Renji/.test(facts) && !/Elsewhere:[\s\S]*Rukia/.test(facts), 'shown where they are: ' + facts.slice(0, 260));
});

test('M598 A PASSER-THROUGH STILL PASSES OUT OF THE STORY: the house\'s upkeep retires one nothing carries and then lets the seat go — the always-somewhere rule (M588) never keeps a seat for someone who has left the story', async () => {
  const { seatHousekeeping } = await import('../../js/agents/auditor.js');
  let st = applyMutations({ ...emptyState(), page: 200 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'the yard' }, { type: 'presence.enter', name: 'Jovan' },
    { type: 'people.set', name: 'Hideo the porter', field: 'core', text: 'a porter who carried one crate' }, { type: 'offscreen.set', name: 'Hideo the porter', location: 'the east gate', activity: 'unloading' }]).state;
  st.offscreen['Hideo the porter'].atTurn = 1;
  const muts = seatHousekeeping(st, { brief: '', castNotes: '', pages: [], castNames: [] });
  assert(muts.findIndex((m) => m.type === 'people.retire') < muts.findIndex((m) => m.type === 'offscreen.clear'), 'retired first: ' + JSON.stringify(muts));
  const r = applyMutations(st, muts);
  assert(!r.state.offscreen['Hideo the porter'], 'the seat is let go: ' + JSON.stringify(r.rejected));
  /* a kept person (not retired) still keeps hers */
  const kept = applyMutations(st, [{ type: 'people.set', name: 'Rukia', field: 'core', text: 'x' }, { type: 'offscreen.set', name: 'Rukia', location: 'her quarters' }, { type: 'offscreen.clear', name: 'Rukia' }]).state;
  assert(kept.offscreen.Rukia, 'a kept person is still never left nowhere');
});

test('M598-2 THE AUDITOR\'S LEAVE STANDS WHEN THE PAGE ENDS ON HIM GOING, as the page reader\'s does — and the walk-off test is one reading for both', async () => {
  const { mcWalksOff } = await import('../../js/engine/apply.js');
  const ex = await import('../../js/agents/extractor.js');
  eq(ex.mcWalksOff, mcWalksOff, 'one reading');
  assert(mcWalksOff('Rukia stayed by the fountain. Jovan turned his back on her and walked away toward the far gate.', 'Jovan'), 'he goes');
  assert(!mcWalksOff('Kuchiki-taichō nodded to Oda, then left without a word.', 'Jovan Oda'), 'the captain goes, not him');
});

test('M599 THE AUDITOR CAN RESTORE WHAT IT IS TOLD TO: a lover the brief names, at P+2 (moved by a page) with R at 0 — its R is restored at the brief\'s level, and the P the page earned is left exactly as it stands; lowering an earned axis is still refused', async () => {
  const { auditLedger } = await import('../../js/agents/auditor.js');
  const { saveState, loadState } = await import('../../js/engine/state.js');
  const { db } = await import('../../js/store.js');
  const story = await db.stories.create({ title: 'the lover' });
  await db.stories.update(story.id, { brief: 'Rukia has loved Jovan since they were children; she has never said it.' });
  await db.messages.append(story.id, { role: 'user', text: 'I nod to her.' });
  await db.messages.append(story.id, { role: 'assistant', text: '[The yard — Monday, March 3, 2025 | 09:00 | clear | uniform | by the rail]\n\nRukia smiled at him, a little too long.' });
  let st = applyMutations({ ...emptyState(), page: 3 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'The yard' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rukia' },
    { type: 'rel.shift', name: 'Rukia', axis: 'p', delta: 2, cause: 'she smiled at him across the yard' }]).state;
  await saveState(story.id, st);
  const answer = JSON.stringify({ issues: [{ what: 'Rukia loves Jovan per the brief, but her standing reads P+2 with R at 0', fix: 'R at the brief\u2019s level', pages: false,
    mutations: [{ type: 'rel.set', name: 'Rukia', p: 40, r: 65, cause: 'the brief says Rukia has loved Jovan since they were children' }] }] });
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  await withHouse(thinkingHouse({ answer }), () => auditLedger({ connection: HOUSES[0].conn, storyId: story.id, brief: 'Rukia has loved Jovan since they were children; she has never said it.' }));
  const rel = (await loadState(story.id)).relationships.Rukia;
  eq(rel.r, 65, 'R restored at the brief\u2019s level');
  eq(rel.p, 2, 'the P the page earned is left exactly as it stands (not raised to 40)');
});

/* M641 — his report: "How they feel toward you, after #story — twenty scenes and it keeps being empty… sometimes it's fine". */
test('M641-1 WHO HAS NO STANDING YET: the people in the scene with him, by name — never him, never one who has a standing, never a face with no name', async () => {
  const { unwrittenStandings, buildExtractorMessages } = await import('../../js/agents/extractor.js');
  const st = applyMutations({ ...emptyState(), page: 3 }, [
    { type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'The ramen stall' },
    { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Yuki Tsukumo' }, { type: 'presence.enter', name: 'Maki' }, { type: 'presence.enter', name: 'the waitress' },
    { type: 'rel.set', name: 'Maki', p: 30, cause: 'they trained together for a year' },
  ]).state;
  eq(JSON.stringify(unwrittenStandings(st)), JSON.stringify(['Yuki Tsukumo']), 'only the named one whose standing was never written');
  const page = '[The ramen stall — Monday, December 4, 2018 | 12:10 | cold | haori | at the counter]\n\nYuki pushed her bowl across to him. “Eat. You look like death.”';
  const asked = buildExtractorMessages({ state: st, userText: 'I sit down.', assistantText: page, pageNumber: 4 });
  eq(JSON.stringify(asked.standingsFor), JSON.stringify(['Yuki Tsukumo']), 'and the reader’s message carries who it was asked about');
  assert(/NO STANDING IS WRITTEN YET for these people[^\n]*\n1\. Yuki Tsukumo\n/.test(asked.user), 'she is named to the reader, to be decided');
  /* someone he deals with from afar: known to the people's book, named on this page, never "in the scene" */
  const afar = applyMutations(st, [{ type: 'people.set', name: 'Mei Mei', field: 'core', text: 'a grade-one sorcerer who counts every yen' }, { type: 'people.set', name: 'Gojo', field: 'core', text: 'the strongest, and knows it' }]).state;
  const call = page + '\n\nHis phone buzzed: Mei Mei, asking what the job had paid.';
  eq(JSON.stringify(unwrittenStandings(afar, call)), JSON.stringify(['Yuki Tsukumo', 'Mei Mei']), 'the one in the scene, and the one this page names from afar — not Gojo, whom the page does not name');
  eq(JSON.stringify(unwrittenStandings(afar, page)), JSON.stringify(['Yuki Tsukumo']), 'a page that names nobody else asks about nobody else');
  assert(/\n2\. Mei Mei\n/.test(buildExtractorMessages({ state: afar, userText: 'I answer it.', assistantText: call, pageNumber: 5 }).user), 'and the reader is handed her too');
  assert(!/^\d+\. Maki$/m.test(asked.user) && !/^\d+\. the waitress$/m.test(asked.user) && !/^\d+\. Jovan$/m.test(asked.user), 'nobody else is');
  assert(/FOR THIS, the pages already read count/.test(asked.user) && /strangers stay at nothing, and nothing is guessed/.test(asked.user), 'the pages already read count for this, and a stranger stays at nothing');
  assert(asked.user.indexOf('NO STANDING IS WRITTEN YET') > asked.user.indexOf('And the storyteller answered:'), 'asked after the page, with the other things to decide');
  /* everyone decided: the reader is asked nothing of the kind, and its message is what it always was */
  const done = applyMutations(st, [{ type: 'rel.set', name: 'Yuki Tsukumo', p: 55, cause: 'she feeds him and scolds him like family' }]).state;
  eq(unwrittenStandings(done).length, 0, 'none left');
  const plain = buildExtractorMessages({ state: done, userText: 'I sit down.', assistantText: page, pageNumber: 4 });
  assert(!/NO STANDING IS WRITTEN YET/.test(plain.user) && !/"standings"/.test(plain.user), 'nothing is asked when nothing is unwritten');
  /* a young ledger is founded by its own law (M532) — no list */
  const young = buildExtractorMessages({ state: { ...emptyState() }, userText: '#story a duel', assistantText: page, pageNumber: 1 });
  assert(!/NO STANDING IS WRITTEN YET/.test(young.user) && young.standingsFor.length === 0, 'the opening is read by the founding law');
  /* someone the story let go is not asked about */
  const retired = JSON.parse(JSON.stringify(st)); retired.characters['Yuki Tsukumo'] = { core: 'a special grade', state: '', arc: '', threads: [], updatedAtTurn: 1, retired: true };
  eq(unwrittenStandings(retired).length, 0, 'a person the story has let go');
});

test('M641-2 EACH ONE DECIDED: a feeling the pages show is written where it stands, with its cause; "none" writes nothing; nothing is taken for a name that was not asked, nor without a cause, nor twice', async () => {
  const { parseExtractorAnswer, unwrittenStandings } = await import('../../js/agents/extractor.js');
  const st = applyMutations({ ...emptyState(), page: 3 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'The ramen stall' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Yuki Tsukumo' }, { type: 'presence.enter', name: 'Todo' }]).state;
  const asked = unwrittenStandings(st);
  eq(asked.join(','), 'Yuki Tsukumo,Todo', 'two to decide');
  const answer = (standings, mutations = []) => JSON.stringify({ mutations, resolved: [], here: ['Jovan', 'Yuki Tsukumo', 'Todo'], standings });
  const read = parseExtractorAnswer(answer([
    { name: 'Yuki', p: 55, r: 20, s: 0, cause: 'she has fed him and scolded him like family for three pages' },
    { name: 'Todo', none: 'he has not looked up from his bowl' },
    { name: 'A Stranger', p: 10, cause: 'made up' },
  ]), { standingsFor: asked });
  eq(JSON.stringify(read.mutations), JSON.stringify([{ type: 'rel.set', name: 'Yuki Tsukumo', p: 55, r: 20, cause: 'she has fed him and scolded him like family for three pages' }]), 'hers is written, under the name the ledger uses, the zero axis left out; his “none” and the stranger write nothing');
  eq(read.note, 'ok', 'and that is a reading');
  const after = applyMutations(st, read.mutations).state;
  eq(after.relationships['Yuki Tsukumo'].p + '/' + after.relationships['Yuki Tsukumo'].r, '55/20', 'it stands in the ledger');
  assert(/^set — she has fed him/.test(after.relationships['Yuki Tsukumo'].history[0].cause), 'with what showed it');
  eq(unwrittenStandings(after).join(','), 'Todo', 'she is decided; he is asked about again when the pages have more to show');
  eq(parseExtractorAnswer(answer([{ name: 'Todo', none: 'nothing yet' }]), { standingsFor: asked }).mutations.length, 0, 'none: nothing written');
  eq(parseExtractorAnswer(answer([{ name: 'Todo', p: 15 }]), { standingsFor: asked }).mutations.length, 0, 'no cause: nothing written');
  eq(parseExtractorAnswer(answer([{ name: 'Todo', p: 0, r: 0, s: 0, cause: 'neutral' }]), { standingsFor: asked }).mutations.length, 0, 'all at zero: nothing is kept at zero');
  eq(parseExtractorAnswer(answer([{ name: 'Todo', p: 15, cause: 'x' }, { name: 'Todo', p: 40, cause: 'y' }]), { standingsFor: asked }).mutations.length, 1, 'one standing a person');
  const both = parseExtractorAnswer(answer([{ name: 'Todo', p: 15, cause: 'x' }], [{ type: 'rel.shift', name: 'Todo', axis: 'p', delta: 5, cause: 'he laughed at his joke' }]), { standingsFor: asked });
  eq(both.mutations.filter((m) => /^rel\./.test(m.type)).length, 1, 'a standing the page itself moved is not also set');
  eq(parseExtractorAnswer(answer([{ name: 'Todo', p: 15, cause: 'x' }])).mutations.length, 0, 'a reader that was asked nothing has no such slot');
});

test('M641-3 THROUGH THE READER ITSELF: on a later page the reader is sent the names, and what it decides is in its reading', async () => {
  const { extractTurn } = await import('../../js/agents/extractor.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const st = applyMutations({ ...emptyState(), page: 19 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'The ramen stall' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Yuki Tsukumo' }]).state;
  const page = '[The ramen stall — Monday, December 4, 2018 | 12:10 | cold | haori | at the counter]\n\nYuki pushed her bowl across to him. “Eat. You look like death.”';
  const house = thinkingHouse({ answer: JSON.stringify({ mutations: [{ type: 'mode.snapshot', modes: [] }], resolved: [], here: ['Jovan', 'Yuki Tsukumo'], standings: [{ name: 'Yuki Tsukumo', p: 50, cause: 'twenty scenes at his side, feeding him and scolding him' }] }) });
  const read = await withHouse(house, () => extractTurn({ connection: HOUSES[0].conn, state: st, userText: 'I sit down.', assistantText: page, pageNumber: 20 }));
  const sent = JSON.stringify(house.calls[0].body.messages);
  assert(/NO STANDING IS WRITTEN YET/.test(sent) && /1\. Yuki Tsukumo/.test(sent), 'the reader was sent her name to decide, on page twenty');
  assert(read.mutations.some((m) => m.type === 'rel.set' && m.name === 'Yuki Tsukumo' && m.p === 50), 'and its decision is in the reading: ' + JSON.stringify(read.mutations));
  eq(applyMutations(st, read.mutations).state.relationships['Yuki Tsukumo'].p, 50, 'the ledger holds it');
});

/* M642 — his question: "why, most of the time, 'no longer knows' — it needs the auditor to make things right? Why not from
 * their own worker?" */
test('M642-1 WHO SAW IT IS THE READER’S OWN ANSWER: a fact with its "who" is written for exactly those people — a line each; "everyone here" is the room the page opened with and still holds; the main character never; the one who did it never; a line written the old way is left as it was', async () => {
  const { parseExtractorAnswer, settleWitnesses, broadcastPublicMoments } = await import('../../js/agents/extractor.js');
  const st = applyMutations({ ...emptyState(), page: 9 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'The Thirteenth’s yard' },
    ...['Jovan', 'Rukia', 'Renji', 'Captain Ukitake', 'Sentaro'].map((name) => ({ type: 'presence.enter', name }))]).state;
  const here = ['Jovan', 'Rukia', 'Renji', 'Captain Ukitake', 'Kiyone'];
  const answer = JSON.stringify({ mutations: [
    { type: 'presence.enter', name: 'Kiyone' },                                                                                   /* she walks in at the end */
    { type: 'presence.leave', name: 'Sentaro', cause: 'he went for the tea after the captain spoke' },
    { type: 'knowledge.add', who: ['everyone here', 'Sentaro'], fact: 'heard Captain Ukitake announce that Jovan leads the patrol' }, /* said to the yard; Sentaro heard it before he went */
    { type: 'knowledge.add', who: ['Rukia'], fact: 'saw the fresh bandage on Jovan’s hand' },                                      /* only she noticed */
    { type: 'knowledge.add', who: ['Rukia', 'Jovan'], fact: 'heard Renji mutter that he does not trust the new man' },             /* he is never written for */
    { type: 'knowledge.add', who: 'everyone here', fact: 'watched Kiyone hand the captain a sealed message' },                     /* her own act; she came in for it */
    { type: 'knowledge.add', name: 'Renji', fact: 'was told the east gate is unguarded tonight' },                                 /* the old way: one name */
  ], resolved: [], here });
  const read = parseExtractorAnswer(answer);
  const settled = broadcastPublicMoments(st, settleWitnesses(st, read.mutations, read.here), read.here);
  const books = {};
  for (const m of settled) if (m.type === 'knowledge.add') (books[m.name] = books[m.name] || []).push(m.fact);
  const knows = (name) => (books[name] || []).map((f) => f.split(' ').slice(0, 3).join(' ')).sort().join(' | ');
  eq(knows('Rukia'), 'heard Captain Ukitake | heard Renji mutter | saw the fresh | watched Kiyone hand', 'Rukia: all four she was there for');
  eq(knows('Renji'), 'heard Captain Ukitake | was told the | watched Kiyone hand', 'Renji: what the yard heard and saw, and what he alone was told — not the bandage only Rukia noticed, not his own mutter');
  eq(knows('Captain Ukitake'), 'watched Kiyone hand', 'the captain: not his own announcement; the message he was handed, yes');
  eq(knows('Sentaro'), 'heard Captain Ukitake', 'Sentaro, who left after it: the announcement, by name');
  eq(knows('Kiyone'), '', 'Kiyone, who walked in at the end: nothing she was not there for, and not her own act');
  eq(knows('Jovan'), '', 'the main character is never written for');
  assert(settled.filter((m) => m.type === 'knowledge.add').every((m) => typeof m.name === 'string' && m.name && m.room === undefined), 'every line has its one person; no “everyone” is left unsettled');
  const after = applyMutations(st, settled).state;
  eq(Object.keys(after.knowledge).sort().join(','), 'Captain Ukitake,Renji,Rukia,Sentaro', 'and that is what the ledger holds');
  /* the same page read the old way — one name a fact — is shared by the old rule, as it always was (nothing regresses for a reader that has not learned the new word) */
  const old = broadcastPublicMoments(st, settleWitnesses(st, [{ type: 'knowledge.add', name: 'Rukia', fact: 'saw the fresh bandage on Jovan’s hand' }], here), here);
  assert(old.filter((m) => m.type === 'knowledge.add').length > 1, 'the old rule copies a “saw…” line round the room — the guess the reader’s own “who” replaces');
  /* shapes a reader may give */
  eq(parseExtractorAnswer(JSON.stringify({ mutations: [{ type: 'knowledge.add', name: 'Rukia', who: [{ name: 'Renji' }, 'rukia'], fact: 'f' }] })).mutations.map((m) => m.name).join(','), 'Rukia,Renji', 'a name beside the list joins it once; a witness given as an object is read');
  eq(parseExtractorAnswer(JSON.stringify({ mutations: [{ type: 'knowledge.add', who: 'Everyone here', fact: 'f' }] })).mutations[0].room, true, '“everyone here” waits for the room');
  for (const phrase of ['everyone', 'Everybody here', 'everyone present', 'all here', 'all of them', 'everyone in the yard']) eq(parseExtractorAnswer(JSON.stringify({ mutations: [{ type: 'knowledge.add', who: phrase, fact: 'f' }] })).mutations[0].room, true, '“' + phrase + '” is the room');
  eq(parseExtractorAnswer(JSON.stringify({ mutations: [{ type: 'knowledge.add', who: ['All Might', 'Allen', 'Everyone Else Inc'], fact: 'f' }] })).mutations.map((m) => m.name + (m.room ? '!' : '')).join(','), 'All Might,Allen,Everyone Else Inc', 'a name that merely begins like it is a person');
  eq(JSON.stringify(parseExtractorAnswer(JSON.stringify({ mutations: [{ type: 'knowledge.add', name: 'Rukia', fact: 'f' }] })).mutations), JSON.stringify([{ type: 'knowledge.add', name: 'Rukia', fact: 'f' }]), 'a line with no “who” is untouched');
});

test('M642-2 THROUGH THE READER ITSELF: it is told that who saw it is its own to decide, and what it decides is the reading — a thing one person noticed stays that person’s', async () => {
  const { extractTurn } = await import('../../js/agents/extractor.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const st = applyMutations({ ...emptyState(), page: 9 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'The Thirteenth’s yard' }, ...['Jovan', 'Rukia', 'Renji', 'Captain Ukitake'].map((name) => ({ type: 'presence.enter', name })), { type: 'rel.set', name: 'Rukia', p: 30, cause: 'x' }, { type: 'rel.set', name: 'Renji', p: -10, cause: 'x' }, { type: 'rel.set', name: 'Captain Ukitake', p: 20, cause: 'x' }]).state;
  const page = '[The Thirteenth’s yard — Monday, March 3, 2025 | 09:30 | clear | shihakushō | by the rail]\n\nRukia’s eyes went to the fresh bandage on his hand; nobody else looked.';
  const house = thinkingHouse({ answer: JSON.stringify({ mutations: [{ type: 'mode.snapshot', modes: [] }, { type: 'knowledge.add', who: ['Rukia'], fact: 'saw the fresh bandage on Jovan’s hand' }], resolved: [], here: ['Jovan', 'Rukia', 'Renji', 'Captain Ukitake'] }) });
  const read = await withHouse(house, () => extractTurn({ connection: HOUSES[0].conn, state: st, userText: 'I rest my hand on the rail.', assistantText: page, pageNumber: 10 }));
  const told = JSON.stringify(house.calls[0].body.messages);
  assert(/WHO IS YOURS TO DECIDE, FROM THE PAGE/.test(told) && /\\"who\\":\[\\"NAME\\",\\"OTHER NAME\\"\]/.test(told) && /never someone who came in after it, had gone before it, or from whom it was kept/.test(told), 'the reader is told that who saw it is its own to decide, and how');
  eq(read.mutations.filter((m) => m.type === 'knowledge.add').map((m) => m.name).join(','), 'Rukia', 'what only she noticed is hers alone — not copied round the room by its first word');
  eq(JSON.stringify(read.mutations.find((m) => m.type === 'knowledge.add')), JSON.stringify({ type: 'knowledge.add', fact: 'saw the fresh bandage on Jovan’s hand', name: 'Rukia' }), 'and the line that goes to the ledger is the line as it has always been written — no mark left on it');
  eq(Object.keys(applyMutations(st, read.mutations).state.knowledge).join(','), 'Rukia', 'and that is what the ledger holds');
});

/* M643 — his report: the page ends "Then she was gone, footsteps measured up the stairs…" and her page reads "Now (elsewhere):
 * last seen at Wells house kitchen, 8 Mariner's Lane". */
test('M643-1 WHERE THEY WENT, WHEN THE PAGE SAID: a leaving that says "to" seats the person THERE (a real whereabouts, with what they went to do); with no "to", a "to" that is only the scene’s own ground, or one that says nothing, the house notes where they were last seen, as before', async () => {
  const { seatNowWords } = await import('../../js/engine/offscreen.js');
  const base = applyMutations({ ...emptyState(), page: 12 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Wells house kitchen, 8 Mariner\u2019s Lane' },
    ...['Jovan', 'Aunt Vera', 'Rias', 'Tom'].map((name) => ({ type: 'presence.enter', name }))]).state;
  const after = (m) => applyMutations(base, [m]);
  const told = after({ type: 'presence.leave', name: 'Aunt Vera', to: 'upstairs in the Wells house', doing: 'going up to bed' });
  const seat = told.state.offscreen['Aunt Vera'];
  eq(seat.location + ' | ' + seat.activity + ' | ' + (seat.lastSeen === true), 'upstairs in the Wells house | going up to bed | false', 'she is seated where the page showed her going');
  eq(seatNowWords(seat, null), 'upstairs in the Wells house, going up to bed', 'and that is how her page reads — not “last seen at” the kitchen');
  assert(!told.state.present.some((p) => p.name === 'Aunt Vera') && told.state.present.length === 3, 'she is out of the scene; the three others stay');
  assert(/Aunt Vera stepped out of the scene — to upstairs in the Wells house\./.test(told.applied[0].words), 'the ledger’s own line says where: ' + told.applied[0].words);
  const bare = after({ type: 'presence.leave', name: 'Aunt Vera' });
  eq(seatNowWords(bare.state.offscreen['Aunt Vera'], null), 'last seen at Wells house kitchen, 8 Mariner\u2019s Lane', 'no “to”: the house’s own sighting, as it always was');
  eq(bare.state.offscreen['Aunt Vera'].lastSeen, true, 'marked as a sighting (the world agent moves her on from it)');
  for (const to of ['Wells house kitchen, 8 Mariner\u2019s Lane', 'away', 'out', 'Gone.', '']) eq(after({ type: 'presence.leave', name: 'Aunt Vera', to }).state.offscreen['Aunt Vera'].lastSeen, true, 'a “to” that names no other place (“' + to + '”) is no whereabouts');
  eq(after({ type: 'presence.leave', name: 'Aunt Vera', to: 'the car outside the gate' }).state.offscreen['Aunt Vera'].activity, '', 'a place with nothing said of what she went to do');
  /* the main character is never seated, whatever the leaving says */
  eq(after({ type: 'presence.leave', name: 'Jovan', to: 'upstairs' }).applied.length, 0, 'he never steps out of his own scene');
});

test('M643-2 THROUGH THE READER ITSELF: it is told that where they went is its to say, and a leaving read from his own page carries it into the ledger', async () => {
  const { extractTurn } = await import('../../js/agents/extractor.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const st = applyMutations({ ...emptyState(), page: 12 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Wells house kitchen, 8 Mariner\u2019s Lane' },
    ...['Jovan', 'Aunt Vera', 'Rias', 'Tom'].map((name) => ({ type: 'presence.enter', name })),
    ...['Aunt Vera', 'Rias', 'Tom'].map((name) => ({ type: 'rel.set', name, p: 20, cause: 'family' }))]).state;
  const page = '[Wells house kitchen, 8 Mariner\u2019s Lane — Monday, March 3, 2025 | 21:40 | rain | sweater | at the table]\n\nAunt Vera set her cup in the sink and looked at each of them in turn. “Lock the back door.” Then she was gone, footsteps measured up the stairs, and the kitchen rearranged its weather around three of them.';
  const house = thinkingHouse({ answer: JSON.stringify({ mutations: [{ type: 'mode.snapshot', modes: [] }, { type: 'presence.leave', name: 'Aunt Vera', to: 'upstairs in the Wells house', doing: 'going up to bed' }], resolved: [], here: ['Jovan', 'Rias', 'Tom'] }) });
  const read = await withHouse(house, () => extractTurn({ connection: HOUSES[0].conn, state: st, userText: 'I say goodnight.', assistantText: page, pageNumber: 13 }));
  const sent = JSON.stringify(house.calls[0].body.messages);
  assert(/WHERE THEY WENT IS YOURS TO SAY, FROM THE PAGE/.test(sent) && /never just \\"out\\" or \\"away\\"/.test(sent), 'the reader is told that where they went is its to say');
  const leave = read.mutations.find((m) => m.type === 'presence.leave');
  eq(leave && leave.to, 'upstairs in the Wells house', 'the leaving read from his page keeps where she went: ' + JSON.stringify(read.mutations));
  const done = applyMutations(st, read.mutations).state;
  eq(done.offscreen['Aunt Vera'].location, 'upstairs in the Wells house', 'and the ledger has her upstairs');
  eq(done.present.map((p) => p.name).sort().join(','), 'Jovan,Rias,Tom', 'the kitchen holds the three of them');
});

test('M643-3 GONE AT THE END OF THE PAGE, AS A PAGE TELLS IT: the going told by a pronoun after her name — past a spoken line, behind “Then” — is her going; a walk across the room is not, and neither is someone else’s leaving', async () => {
  const { goneAtTheEnd } = await import('../../js/engine/apply.js');
  const st = applyMutations({ ...emptyState(), page: 12 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Wells house kitchen, 8 Mariner\u2019s Lane' }, ...['Jovan', 'Aunt Vera', 'Rias', 'Tom'].map((name) => ({ type: 'presence.enter', name }))]).state;
  const H = '[Wells house kitchen, 8 Mariner\u2019s Lane — Monday, March 3, 2025 | 21:40 | rain | sweater | at the table]\n\n';
  const his = 'Then she was gone, footsteps measured up the stairs, and the kitchen rearranged its weather around three of them.';
  const gone = (text) => goneAtTheEnd(st, H + text, 'Aunt Vera');
  eq(gone('Aunt Vera set her cup in the sink and looked at each of them in turn. “Lock the back door.” ' + his), true, 'his page: her name, a spoken line, then “Then she was gone… up the stairs”');
  eq(gone('Aunt Vera set her cup in the sink. ' + his), true, 'the same with nothing spoken between');
  eq(gone('Aunt Vera set her cup in the sink. A moment later she was on the stairs, and then she left them to it.'), true, 'behind a longer lead-in');
  eq(gone('Aunt Vera set her cup in the sink. She left the kitchen and went up the stairs.'), true, 'the plain way, as before');
  eq(gone('Then Aunt Vera was gone, footsteps measured up the stairs.'), true, 'her name in the sentence itself, as before');
  eq(gone('Aunt Vera set her cup in the sink. Then she crossed to the window and stood there.'), false, 'she only crosses the room: she is here');
  eq(gone('Aunt Vera set her cup in the sink. Tom pushed back his chair. Then he was gone, footsteps up the stairs.'), false, 'someone else’s leaving after her name is not hers');
  eq(gone('Aunt Vera set her cup in the sink. “I’m off,” Rias said. Then she was gone.'), false, 'nor a going that follows another woman’s line');
  eq(gone('Aunt Vera left the kitchen. Then Aunt Vera came back with the kettle and sat down.'), false, 'out and back: the last word on her is that she is here');
});

/* M644 — the audit of "who is here": the rule that decides whether a page shows someone going. */
test('M644-1 A GOING, AS PAGES SAY IT: the old word list knows the past tense and the common ways out, and takes no staying for a going', async () => {
  const { showsDeparture } = await import('../../js/engine/apply.js');
  const gone = ['She left.', 'Then she was gone.', 'She disappeared down the hall.', 'The door closed behind her.', 'The door slammed behind her.', 'She slipped out without a word.',
    'She excused herself and went up to bed.', 'She went upstairs.', 'She headed for the stairs.', 'Her footsteps faded up the stairs.', 'She stormed off.', 'She walked away.',
    'She vanished into the crowd.', 'She stepped outside to take the call.', 'She took her leave.', 'She fled.', 'She went home.', 'She drove off.',
    'She climbed into the cab and it pulled away.', 'She let herself out.', 'She ducked out the back.', 'She hurried off toward the gate.', 'She made her exit.', 'She strode out of the room.',
    'She swept from the room.', 'She departed.', 'She teleported away.', 'She closed the door behind her on the way out.'];
  for (const s of gone) eq(showsDeparture(s), true, 'a going: ' + s);
  const here = ['She turned away.', 'She walked to the window.', 'She stepped closer.', 'She raised her left hand.', 'She left the cup on the table.', 'She stood up.', 'She looked away.',
    'She leaned back in her chair.', 'She crossed the room and sat beside him.', 'She came back with the kettle.', 'She went quiet.', 'She went pale.', 'She left the question hanging.',
    'She was gone for a moment in thought, then looked up.', 'She backed away a step.', 'She moved to the door and stood there, blocking it.', 'She walked him to the door.',
    'She turned to go, then stopped.', 'She almost left.', 'She nearly left then and there, and stayed.', 'She did not leave.', 'The colour fled her face.', 'She pulled away from his touch.',
    'She swept the floor.', 'She drove the point home.', 'She stepped in and the door closed behind her.', 'Her smile was gone quiet and small.', 'She went to the stove.'];
  for (const s of here) eq(showsDeparture(s), false, 'a staying: ' + s);
});

test('M644-2 THE PAGE’S OWN WORDS FOR THE GOING: a leaving the reader backs with words that ARE in the page’s telling stands, however the page said it — never words that are only spoken, only in a window, not on the page, or followed by that person’s name again', async () => {
  const { quotedGoing, goneAtTheEnd } = await import('../../js/engine/apply.js');
  const st = applyMutations({ ...emptyState(), page: 12 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Wells house kitchen, 8 Mariner\u2019s Lane' }, ...['Jovan', 'Aunt Vera', 'Rias', 'Tom'].map((name) => ({ type: 'presence.enter', name }))]).state;
  const H = '[Wells house kitchen, 8 Mariner\u2019s Lane — Monday, March 3, 2025 | 21:40 | rain | sweater | at the table]\n\n';
  const ways = [['She returned to her room.', 'returned to her room'], ['She retreated to the pantry and shut herself in.', 'retreated to the pantry'], ['She was carried out on a stretcher.', 'carried out on a stretcher'],
    ['She was already halfway down the corridor, and then out of sight.', 'and then out of sight'], ['Her chair was empty before anyone looked up; the back door stood open on the rain.', 'the back door stood open on the rain']];
  for (const [sentence, shown] of ways) {
    const page = H + 'Aunt Vera set her cup in the sink. ' + sentence;
    eq(goneAtTheEnd(st, page, 'Aunt Vera'), false, 'the word list does not know this way out: ' + sentence);
    eq(quotedGoing(st, page, 'Aunt Vera', shown), true, 'the page’s own words carry it: “' + shown + '”');
  }
  const page = H + 'Aunt Vera set her cup in the sink. She returned to her room.';
  eq(quotedGoing(st, page, 'Aunt Vera', '“Returned to her room…”'), true, 'quote marks, case and trailing dots around the words do not matter');
  eq(quotedGoing(st, page, 'Aunt Vera', 'went back to her room'), false, 'words that are not the page’s are no evidence');
  eq(quotedGoing(st, page, 'Aunt Vera', 'left'), false, 'one word is not a quotation');
  eq(quotedGoing(st, page, 'Aunt Vera', ''), false, 'nor is nothing');
  eq(quotedGoing(st, H + 'Aunt Vera set her cup in the sink. “She returned to her room,” Rias said.', 'Aunt Vera', 'returned to her room'), false, 'words someone only SAYS are not the telling');
  eq(quotedGoing(st, H + 'Aunt Vera set her cup in the sink.\n\n*** The World Beyond ***\n\nAcross town a woman returned to her room.', 'Aunt Vera', 'returned to her room'), false, 'nor words in the window beyond the page');
  eq(quotedGoing(st, H + 'Aunt Vera returned to her room. A minute later Aunt Vera came back with the kettle and sat down.', 'Aunt Vera', 'returned to her room'), false, 'named again after the going: she may be back — the old rule decides, and it keeps her here');
  eq(goneAtTheEnd(st, H + 'Aunt Vera returned to her room. A minute later Aunt Vera came back with the kettle and sat down.', 'Aunt Vera'), false, 'as it does');
});

test('M644-3 THROUGH THE READER ITSELF: a leaving in words the list does not know is kept when the reader hands over the page’s words for it — and thrown away, as before, when it does not', async () => {
  const { extractTurn } = await import('../../js/agents/extractor.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const st = applyMutations({ ...emptyState(), page: 12 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Wells house kitchen, 8 Mariner\u2019s Lane' },
    ...['Jovan', 'Aunt Vera', 'Rias', 'Tom'].map((name) => ({ type: 'presence.enter', name })), ...['Aunt Vera', 'Rias', 'Tom'].map((name) => ({ type: 'rel.set', name, p: 20, cause: 'family' }))]).state;
  const page = '[Wells house kitchen, 8 Mariner\u2019s Lane — Monday, March 3, 2025 | 21:40 | rain | sweater | at the table]\n\nAunt Vera set her cup in the sink. “Goodnight, all of you.” She returned to her room, and the house settled.';
  const reading = (leave) => withHouse(thinkingHouse({ answer: JSON.stringify({ mutations: [{ type: 'mode.snapshot', modes: [] }, leave], resolved: [], here: ['Jovan', 'Rias', 'Tom'] }) }), () => extractTurn({ connection: HOUSES[0].conn, state: st, userText: 'I say goodnight.', assistantText: page, pageNumber: 13 }));
  const backed = await reading({ type: 'presence.leave', name: 'Aunt Vera', shown: 'She returned to her room', to: 'her room upstairs in the Wells house' });
  assert(backed.mutations.some((m) => m.type === 'presence.leave' && m.name === 'Aunt Vera'), 'backed by the page’s words: the leaving stands — ' + JSON.stringify(backed.mutations));
  const done = applyMutations(st, backed.mutations).state;
  eq(done.present.map((p) => p.name).sort().join(',') + ' | ' + done.offscreen['Aunt Vera'].location, 'Jovan,Rias,Tom | her room upstairs in the Wells house', 'she is out of the kitchen and in her room');
  const bare = await reading({ type: 'presence.leave', name: 'Aunt Vera' });
  assert(!bare.mutations.some((m) => m.type === 'presence.leave'), 'with no words for it the old list decides, and does not know “returned to her room” — which is why the reader is asked for them');
  const told = JSON.stringify(thinkingHouse({ answer: '{}' }) && (await (async () => { const h = thinkingHouse({ answer: '{"mutations":[]}' }); await withHouse(h, () => extractTurn({ connection: HOUSES[0].conn, state: st, userText: 'x', assistantText: page, pageNumber: 13 })); return h.calls[0].body.messages; })()));
  assert(/\\"shown\\" is the page\\\\'s own words that show them going, COPIED EXACTLY|"shown\\" is the page/.test(told) || /COPIED EXACTLY from its telling/.test(told), 'the reader is told to hand over the page’s own words');
});

test('M644-4 THE AUDITOR’S LEAVING, THE SAME WAY: backed by the page’s words it stands and seats her where she went; unbacked, in words the list does not know, it is refused as before', async () => {
  const { auditLedger } = await import('../../js/agents/auditor.js');
  const { saveState, loadState } = await import('../../js/engine/state.js');
  const { db } = await import('../../js/store.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const run = async (leave) => {
    const story = await db.stories.create({ title: 'the aunt ' + (leave.shown ? 'quoted' : 'bare') });
    await db.messages.append(story.id, { role: 'user', text: 'I say goodnight.' });
    await db.messages.append(story.id, { role: 'assistant', text: '[Wells house kitchen, 8 Mariner\u2019s Lane — Monday, March 3, 2025 | 21:40 | rain | sweater | at the table]\n\nAunt Vera set her cup in the sink. “Goodnight, all of you.” She returned to her room, and the house settled.' });
    await saveState(story.id, applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Wells house kitchen, 8 Mariner\u2019s Lane' }, ...['Jovan', 'Aunt Vera', 'Rias'].map((name) => ({ type: 'presence.enter', name }))]).state);
    const answer = JSON.stringify({ issues: [{ what: 'Aunt Vera went to her room and is still listed in the kitchen', fix: 'take her out', pages: false, mutations: [leave] }] });
    await withHouse(thinkingHouse({ answer }), () => auditLedger({ connection: HOUSES[0].conn, storyId: story.id, brief: '' }));
    return loadState(story.id);
  };
  const quoted = await run({ type: 'presence.leave', name: 'Aunt Vera', shown: 'She returned to her room', to: 'her room upstairs in the Wells house' });
  eq(quoted.present.some((p) => p.name === 'Aunt Vera') + ' | ' + ((quoted.offscreen['Aunt Vera'] || {}).location || ''), 'false | her room upstairs in the Wells house', 'backed by the page: out of the scene, and where she went');
  const bare = await run({ type: 'presence.leave', name: 'Aunt Vera' });
  eq(bare.present.some((p) => p.name === 'Aunt Vera'), true, 'unbacked: refused, as before');
});

test('M644-5 SOMEONE WHO WALKS IN IS IN THE SCENE, HOWEVER THE TELLING NAMES HER: “his aunt came in”, a nickname, a name only in someone’s mouth while the telling says “she came in” — backed by the page’s own words the walk-in stands and her elsewhere note is let go; talked about is still not here', async () => {
  const { extractTurn } = await import('../../js/agents/extractor.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const st = applyMutations({ ...emptyState(), page: 12 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Wells house kitchen, 8 Mariner\u2019s Lane' },
    ...['Jovan', 'Rias', 'Tom'].map((name) => ({ type: 'presence.enter', name })),
    { type: 'people.set', name: 'Aunt Vera', field: 'core', text: 'his mother\u2019s sister; runs the house' }, { type: 'offscreen.set', name: 'Aunt Vera', location: 'upstairs in the Wells house', activity: 'asleep' },
    ...['Rias', 'Tom', 'Aunt Vera'].map((name) => ({ type: 'rel.set', name, p: 20, cause: 'family' }))]).state;
  const H = '[Wells house kitchen, 8 Mariner\u2019s Lane — Tuesday, March 4, 2025 | 07:10 | rain | sweater | at the table]\n\n';
  const after = async (text, enter) => {
    const read = await withHouse(thinkingHouse({ answer: JSON.stringify({ mutations: [{ type: 'mode.snapshot', modes: [] }, enter], resolved: [], here: ['Jovan', 'Rias', 'Tom', 'Aunt Vera'] }) }), () => extractTurn({ connection: HOUSES[0].conn, state: st, userText: 'I look up.', assistantText: H + text, pageNumber: 13 }));
    const led = applyMutations(st, read.mutations).state;
    return (led.present.some((p) => p.name === 'Aunt Vera') ? 'here' : 'not here') + ' / ' + (led.offscreen['Aunt Vera'] ? 'still seated upstairs' : 'no elsewhere note');
  };
  const enter = (shown) => ({ type: 'presence.enter', name: 'Aunt Vera', ...(shown ? { shown } : {}), position: 'at the back door' });
  eq(await after('The back door opened and Aunt Vera came in, shaking rain from her coat.', enter()), 'here / no elsewhere note', 'named in the telling: as before, no words needed');
  eq(await after('The back door opened and his aunt came in, shaking rain from her coat.', enter('his aunt came in, shaking rain from her coat')), 'here / no elsewhere note', '“his aunt came in”, backed by the page’s words');
  eq(await after('The back door opened and Auntie came in, shaking rain from her coat.', enter('Auntie came in')), 'here / no elsewhere note', 'a nickname');
  eq(await after('The back door opened. “Aunt Vera, you’re soaked,” Rias said, and went for a towel as she came in.', enter('went for a towel as she came in')), 'here / no elsewhere note', 'named only in someone’s mouth; the telling says she came in');
  eq(await after('The back door opened and his aunt came in, shaking rain from her coat.', enter()), 'not here / still seated upstairs', 'with no words for it the name must be in the telling, as before — which is why the reader is asked for them');
  eq(await after('Rias poured the tea. “Aunt Vera will be down soon,” she said.', enter('Aunt Vera will be down soon')), 'not here / still seated upstairs', 'talked about is not here: spoken words are not the telling');
  eq(await after('Rias poured the tea and said nothing.', enter('his aunt came in')), 'not here / still seated upstairs', 'words that are not on the page are no evidence');
  eq(await after('The back door opened and his aunt came in. She took one look at them, turned, and went back up the stairs; then she was gone.', enter('his aunt came in')), 'here / no elsewhere note', 'in and out again told only by “she” after no name of hers: the house cannot see whose going it is, and the walk-in stands');
});

/* M645 — the ledger audit, part two: the header's place and hour. */
test('M645-1 THE HEADER, AS A STORYTELLER DRAWS IT: a twelve-hour clock is read as its hour, a date written 2025-03-03 is a date, 21.40 and 21h40 are an hour; the line’s dress (pins, other brackets, bold) is not its words; and it is found after a line of chatter or with the prose run on behind it', async () => {
  const { headerMutations } = await import('../../js/engine/state.js');
  const { tidyPage } = await import('../../js/ui/pageshape.js');
  const read = (header, { arrive = false } = {}) => {
    let text = header + '\n\nShe looked up from the stove.';
    if (arrive) { const r = tidyPage(text, { place: 'Wells house kitchen', mc: 'Jovan' }); text = typeof r === 'string' ? r : r.text; }
    const m = headerMutations(text);
    const p = m.find((x) => x.type === 'place.set'); const c = m.find((x) => x.type === 'clock.set');
    return (p ? p.name : '—') + ' @ ' + (c ? (c.year ? [c.year, c.month, c.day].join('-') + ' ' : '') + String(c.hour).padStart(2, '0') + ':' + String(c.minute).padStart(2, '0') : '—');
  };
  const rest = ' | rain | sweater | at the table]';
  eq(read('[Wells house kitchen, 8 Mariner\u2019s Lane — Monday, March 3, 2025 | 21:40' + rest), 'Wells house kitchen, 8 Mariner\u2019s Lane @ 2025-3-3 21:40', 'his own header, as it always read');
  eq(read('[Wells house kitchen — Monday, March 3, 2025 | 9:40 PM' + rest), 'Wells house kitchen @ 2025-3-3 21:40', '9:40 PM is twenty to ten at night');
  eq(read('[Wells house kitchen — Monday, March 3, 2025 | 9:40 p.m.' + rest), 'Wells house kitchen @ 2025-3-3 21:40', 'however it writes p.m.');
  eq(read('[Wells house kitchen — Monday, March 3, 2025 | 9:40 AM' + rest), 'Wells house kitchen @ 2025-3-3 09:40', 'the morning stays the morning');
  eq(read('[Wells house kitchen — Tuesday, March 4, 2025 | 12:15 AM' + rest), 'Wells house kitchen @ 2025-3-4 00:15', 'a quarter past midnight is not a quarter past noon');
  eq(read('[Wells house kitchen — Monday, March 3, 2025 | 12:15 PM' + rest), 'Wells house kitchen @ 2025-3-3 12:15', 'and noon is noon');
  eq(read('[Wells house kitchen — 2025-03-03 | 21:40' + rest), 'Wells house kitchen @ 2025-3-3 21:40', 'a date written year-month-day');
  eq(read('[Wells house kitchen — Monday, March 3, 2025 | 21.40' + rest), 'Wells house kitchen @ 2025-3-3 21:40', '21.40');
  eq(read('[Wells house kitchen — Monday, March 3, 2025 | 21h40' + rest), 'Wells house kitchen @ 2025-3-3 21:40', '21h40');
  eq(read('[Wells house kitchen — Monday, March 3, 2025 | Late evening' + rest), 'Wells house kitchen @ —', 'an hour only in words sets no hour (and the place still stands)');
  eq(read('[📍 Wells house kitchen — 🗓 Monday, March 3, 2025 | 🕘 21:40 | 🌧 rain | 👕 sweater | 🧍 at the table]'), 'Wells house kitchen @ 2025-3-3 21:40', 'a pin and a clock drawn before the parts are not the ground’s name');
  eq(read('[10th Division HQ — training courtyard — Monday, June 1, 2026 | 10:40' + rest), '10th Division HQ — training courtyard @ 2026-6-1 10:40', 'a place that begins with a number is still a place (M409, M410)');
  /* as the page arrives (the house's own repair first), in the shapes a model draws the line */
  for (const drawn of ['**[Wells house kitchen — Monday, March 3, 2025 | 21:40' + rest + '**', 'Wells house kitchen — Monday, March 3, 2025 | 21:40' + rest.slice(0, -1), '【Wells house kitchen — Monday, March 3, 2025 | 21:40' + rest.slice(0, -1) + '】', '(Wells house kitchen — Monday, March 3, 2025 | 21:40' + rest.slice(0, -1) + ')', '### [Wells house kitchen — Monday, March 3, 2025 | 21:40' + rest]) {
    eq(read(drawn, { arrive: true }), 'Wells house kitchen @ 2025-3-3 21:40', 'drawn as ' + drawn.slice(0, 26) + '…');
  }
  eq(headerMutations('Sure — here is the next page.\n\n[Wells house kitchen — Monday, March 3, 2025 | 21:40' + rest + '\n\nShe looked up.').map((m) => m.type).join(','), 'place.set,clock.set', 'a line of chatter before it: found on the next line');
  eq(headerMutations('[Wells house kitchen — Monday, March 3, 2025 | 21:40' + rest + ' She looked up from the stove at once.').map((m) => m.type).join(','), 'place.set,clock.set', 'the prose run on behind its bracket: still read');
  eq(headerMutations('[A bell rang.] She looked up.').length, 0, 'a bracketed aside with no bars in it, run on into prose, is not a header');
  eq(headerMutations('She looked up.\n\n[Later that night]\n\nThe house was dark.').length, 0, 'nor is a bare bracketed line further down the page');
});

test('M645-2 THE SAME GROUND IN OTHER WORDS IS NO MOVE: reordered, less fully said, with its street and town, or with its number written out — while another room, outside, or another number is a move as before', async () => {
  const { samePlace, seatAtScene, sameSpot, broaderPlace, withinGround } = await import('../../js/engine/apply.js');
  const moves = (was, now) => Boolean(!samePlace(now, was) && !seatAtScene(was, now) && !sameSpot(now, was) && !broaderPlace(now, was) && !withinGround(now, was));
  const K = 'Wells house kitchen, 8 Mariner\u2019s Lane';
  for (const now of [K, 'Wells house kitchen', 'The Wells house kitchen', 'Kitchen, Wells house', 'Wells House Kitchen — 8 Mariner\u2019s Lane', '8 Mariner\u2019s Lane', 'Mariner\u2019s Lane, Ravenwood', 'Ravenwood', 'Wells house']) eq(moves(K, now), false, 'no move: ' + now);
  for (const now of ['Wells house living room, 8 Mariner\u2019s Lane', 'Wells house, upstairs hallway', 'Wells house back porch', 'Mariner\u2019s Lane, outside the Wells house', 'The Bluebird Diner, Harbor Street', 'Jovan\u2019s car, Mariner\u2019s Lane']) eq(moves(K, now), true, 'a move: ' + now);
  const T = '10th Division HQ — training courtyard';
  eq(moves(T, 'Tenth Division HQ, training courtyard'), false, 'the number written out is the same number');
  eq(samePlace('The Tenth Division HQ training courtyard', '10th Division HQ — training courtyard'), true, 'one place, by the ledger’s own measure');
  eq(moves(T, '10th Division HQ'), false, 'the compound alone names no other spot');
  eq(moves(T, '10th Division HQ — captain\u2019s office'), true, 'another room of it is');
  eq(moves(T, '13th Division HQ — training courtyard'), true, 'another division is another place');
  eq(moves(T, 'Thirteenth Division HQ — training courtyard'), true, 'in words too');
  eq(moves('Jovan\u2019s bedroom', 'New York City'), false, 'a city round a room is no move (M627)');
  eq(moves('Jovan\u2019s bedroom', 'Jovan\u2019s bathroom'), true, 'the next room is');
  /* on the ledger: a header naming the street and the town over the kitchen sets no new ground, and keeps where everyone stands */
  const { headerMutations } = await import('../../js/engine/state.js');
  const st = applyMutations({ ...emptyState(), page: 5 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: K }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rias', position: 'at the stove' }]).state;
  const muts = headerMutations('[Mariner\u2019s Lane, Ravenwood — Thu, Aug 20, 2026 | 11:15 | clear | sweater | at the table]\n\nRias stirred the pot.', { ground: K });
  eq(muts.filter((m) => m.type === 'place.set').map((m) => m.name).join(' | '), K, 'the header’s place is only where the kitchen stands: what it hands on is the ledger’s own name for the ground (so the page still “names its ground” to whoever asks)');
  eq(applyMutations(st, muts.filter((m) => m.type === 'place.set')).applied.length, 0, 'and at the ledger’s door that is no change');
  const after = applyMutations(st, [...muts, { type: 'place.set', name: 'Kitchen, Wells house' }]).state;
  eq(after.place.name + ' | ' + after.present.find((p) => p.name === 'Rias').position, K + ' | at the stove', 'the ground keeps its fuller name, and Rias is still at the stove');
});

test('M645-3 NOBODY IS LEFT BEHIND BY A HEADER’S WORDING: the number written out, or the street and town in place of the room — through the page reader’s whole call, the room stands as it was', async () => {
  const { extractTurn } = await import('../../js/agents/extractor.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const yard = '10th Division HQ — training courtyard';
  const st = applyMutations({ ...emptyState(), page: 30 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: yard }, ...['Jovan', 'Rukia', 'Renji', 'Hitsugaya', 'Matsumoto'].map((name) => ({ type: 'presence.enter', name })),
    ...['Rukia', 'Renji', 'Hitsugaya', 'Matsumoto'].map((name) => ({ type: 'rel.set', name, p: 10, cause: 'comrades' }))]).state;
  for (const header of ['[Tenth Division HQ, training courtyard — Monday, June 1, 2026 | 10:40 | clear | shihakushō | by the rail]', '[Seireitei — Monday, June 1, 2026 | 10:40 | clear | shihakushō | by the rail]']) {
    const page = header + '\n\nRukia tightened her grip on the hilt and said nothing.';
    /* a reader that names only the two the page shows — as cheap readers do */
    const read = await withHouse(thinkingHouse({ answer: JSON.stringify({ mutations: [{ type: 'mode.snapshot', modes: [] }], resolved: [], here: ['Jovan', 'Rukia'] }) }), () => extractTurn({ connection: HOUSES[0].conn, state: st, userText: 'I wait.', assistantText: page, pageNumber: 31 }));
    eq(read.mutations.filter((m) => m.type === 'presence.leave').length, 0, 'no one is taken out: ' + header.slice(0, 40));
    const led = applyMutations(st, [...(await import('../../js/engine/state.js')).headerMutations(page, { ground: yard }), ...read.mutations]).state;
    eq(led.place.name + ' | ' + led.present.length, yard + ' | 5', 'the ground and the five of them stand as they were');
  }
});

test('M645-4 ELSEWHERE, AS THE STORYTELLER READS IT: a want is said once (never “meaning to meaning to…”), and an approach that never landed stops being said three hours past its hour — the note’s own age says the rest', async () => {
  const { seatNowWords } = await import('../../js/engine/offscreen.js');
  let st = applyMutations({ ...emptyState(), page: 5 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Wells house kitchen' }, { type: 'clock.set', year: 2025, month: 3, day: 3, hour: 21, minute: 0 }, { type: 'presence.enter', name: 'Jovan' },
    { type: 'offscreen.set', name: 'Rias', location: 'the Bluebird Diner', activity: 'closing up', agenda: 'meaning to walk home', etaMinutes: 20, stance: 'toward' }]).state;
  const line = () => seatNowWords(st.offscreen.Rias, st.clock.minutes, { agenda: true, arrival: true });
  eq(line(), 'the Bluebird Diner, closing up (meaning to walk home) — moving toward the main character, arriving in about 20 minutes', 'as she is seated: the want said once');
  for (const [agenda, want] of [['to walk home', 'walk home'], ['walk home', 'walk home'], ['means to warn the abbot', 'warn the abbot'], ['She is planning to leave at dawn.', 'leave at dawn'], ['hoping to see him', 'see him']]) {
    const s2 = applyMutations(st, [{ type: 'offscreen.set', name: 'Rias', location: 'the diner', agenda }]).state;
    assert(seatNowWords(s2.offscreen.Rias, s2.clock.minutes, { agenda: true }).includes('(meaning to ' + want + ')'), '“' + agenda + '” is read as (meaning to ' + want + ')');
  }
  const at = (h, m, day = 3) => { st = applyMutations(st, [{ type: 'clock.set', year: 2025, month: 3, day, hour: h, minute: m }]).state; return line(); };
  assert(/arriving in about 5 minutes/.test(at(21, 15)), 'nearer by the clock');
  assert(/overdue by about 10 minutes — likely already here or delayed/.test(at(21, 30)), 'a little late is said');
  assert(/overdue by about 2\.5 hours/.test(at(23, 50)), 'and for a while after');
  const stale = at(8, 0, 4);
  assert(!/overdue|toward|arriving/.test(stale) && /as of about 11 hours ago; likely elsewhere by now/.test(stale), 'half a day on, the approach is not said — only how old the note is: ' + stale);
  assert(!/overdue|toward/.test(at(8, 0, 7)), 'nor three days on');
});

/* M646 — the ledger audit, part three: bodies, and a thread's own words. */
test('M646-1 A HURT IS HEALED BY THE PART IT IS ON: “her forearm”, “the left forearm”, “her arm” find the wound on the left forearm; the other side, another part, or a word that merely sits inside another (“ear” in “forearm”) do not', async () => {
  const base = applyMutations({ ...emptyState(), page: 5 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'clock.set', year: 2025, month: 3, day: 3, hour: 21, minute: 0 }, { type: 'presence.enter', name: 'Rias' },
    { type: 'body.injure', name: 'Rias', what: 'left forearm cut to the bone', sev: 2, treated: true }, { type: 'body.injure', name: 'Rias', what: 'two ribs cracked', sev: 2, treated: false }]).state;
  const heal = (what) => { const r = applyMutations(base, [{ type: 'body.heal', name: 'Rias', what }]); return r.applied.length ? r.state.bodies.Rias.injuries.filter((i) => i.healed).map((i) => i.what).join('|') : 'refused'; };
  for (const what of ['forearm', 'her forearm', 'the left forearm', 'Left forearm', 'her arm', 'the cut', 'cut to the bone', 'left forearm cut to the bone']) eq(heal(what), 'left forearm cut to the bone', '“' + what + '” heals the forearm');
  for (const what of ['her ribs', 'rib', 'the cracked ribs']) eq(heal(what), 'two ribs cracked', '“' + what + '” heals the ribs');
  for (const what of ['right forearm', 'her right arm', 'her ankle', 'her ear', 'her leg', '']) eq(heal(what), 'refused', '“' + what + '” heals nothing she carries');
  /* a limb named whole heals nothing when it carries two wounds — the ledger cannot tell which */
  const two = applyMutations(base, [{ type: 'body.injure', name: 'Rias', what: 'left wrist sprained', sev: 1, treated: false }]).state;
  eq(applyMutations(two, [{ type: 'body.heal', name: 'Rias', what: 'her arm' }]).applied.length, 0, 'two wounds on the arm: “her arm” names neither');
  eq(applyMutations(two, [{ type: 'body.heal', name: 'Rias', what: 'her wrist' }]).applied.length, 1, 'the part itself still does');
});

test('M646-2 WEARINESS DOES NOT OUTLAST A STORY DAY: it is said the same night and the next evening, and no longer two days on — a wound keeps its age and is never let go by time', async () => {
  const { renderBodies } = await import('../../js/engine/bodies.js');
  const clock = (d, h) => ({ type: 'clock.set', year: 2025, month: 3, day: d, hour: h, minute: 0 });
  let st = applyMutations({ ...emptyState(), page: 5 }, [{ type: 'mc.set', name: 'Jovan' }, clock(3, 21), { type: 'body.strain', name: 'Tom', what: 'the long climb up the cliff path' }, { type: 'body.injure', name: 'Rias', what: 'left forearm cut to the bone', sev: 2, treated: true }]).state;
  const said = (c) => { st = applyMutations(st, [c]).state; return renderBodies(st.bodies, st.clock.minutes, st.page); };
  assert(/Tom — worn: the long climb up the cliff path \(5h\)/.test(said(clock(4, 2))), 'the same night');
  assert(/Tom — worn: the long climb/.test(said(clock(4, 20))), 'the next evening, within the day');
  const later = said(clock(5, 22));
  assert(!/Tom/.test(later), 'two days on, it is not said: ' + later);
  assert(/Rias — left forearm cut to the bone \(a real wound, 2d, treated\)/.test(later), 'her wound is, with its age');
  assert(/Rias — left forearm cut to the bone \(a real wound, 27d, treated\)/.test(said(clock(30, 21))), 'and a month on, still — only a healing lets a wound go');
  eq(st.bodies.Tom.strain.length, 1, 'the ledger still holds what was written (a take-back, a rebuild); it is only no longer said');
});

test('M646-3 A THREAD’S CLOSING IS WORDED CLEANLY: a title that ends in a question mark is not given a full stop after it', () => {
  const st = applyMutations({ ...emptyState(), page: 5 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'thread.set', title: 'Who broke into the boathouse?', owner: 'Jovan', heat: 'hot', next: 'ask the harbourmaster' }, { type: 'thread.set', title: 'Rias and the letter from the bank', owner: 'Rias', heat: 'hot', next: 'open it' }]).state;
  eq(applyMutations(st, [{ type: 'thread.close', title: 'Who broke into the boathouse' }]).applied[0].words, 'A thread closed: Who broke into the boathouse?', 'no “?.”');
  eq(applyMutations(st, [{ type: 'thread.close', title: '2. Rias and the letter from the bank (Rias)' }]).applied[0].words, 'A thread closed: Rias and the letter from the bank.', 'and a plain title ends as it did');
});

test('M646-4 ONE PERSON, ONE PAGE — AND TWO PEOPLE, TWO: a short name one letter off is another person (Mira is not Mina, Jon is not John, Kara is not Lara); a slip inside a long name, folded letters, a first name or a title before a name still find their person', async () => {
  const { findPersonKey } = await import('../../js/engine/people.js');
  const lands = (held, said) => findPersonKey(Object.fromEntries((Array.isArray(held) ? held : [held]).map((k) => [k, { core: 'x', state: '', arc: '', threads: [] }])), said) || 'a new page';
  for (const [said, held] of [['Mira', 'Mina'], ['Tom', 'Tim'], ['Jon', 'John'], ['Rias', 'Ria'], ['Jovan', 'Jovana'], ['Kara', 'Lara'], ['Maria', 'Mario'], ['Jason', 'Mason'], ['Tim Wells', 'Tom Wells']]) eq(lands(held, said), 'a new page', said + ' is not ' + held);
  for (const [said, held] of [['Hitsugayo', 'Hitsugaya'], ['Bartolomew', 'Bartholomew'], ['Rukia Kuchiky', 'Rukia Kuchiki'], ['Hachigoro', 'Hachigorō'], ['Sui-Feng', 'Suì-Fēng'], ['O\'Brien', 'O’Brien'], ['Rias', 'Rias Gremory'], ['Kara', 'Kara Zor-El'], ['Vera', 'Aunt Vera'], ['Captain Ukitake', 'Ukitake'], ['Mr. Wells', 'Tom Wells']]) eq(lands(held, said), held, said + ' is ' + held);
  eq(lands(['Jon Kent', 'John Stewart'], 'Jon'), 'Jon Kent', 'with a Jon and a John both in the tale, “Jon” is Jon');
  eq(lands(['Kara Zor-El', 'Lara Lor-Van'], 'Lara'), 'Lara Lor-Van', 'and “Lara” is Lara');
  /* through the ledger's own door: the first note for Mira opens HER page and leaves Mina's as it was */
  const st = applyMutations({ ...emptyState(), page: 3 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'people.set', name: 'Mina', field: 'core', text: 'the harbourmaster’s daughter; counts everything' }]).state;
  const after = applyMutations(st, [{ type: 'people.set', name: 'Mira', field: 'core', text: 'a ferry pilot from the north shore' }, { type: 'knowledge.add', name: 'Mira', fact: 'that the ferry was late' }, { type: 'rel.set', name: 'Mira', p: 20, cause: 'he paid her fare' }]).state;
  eq(Object.keys(after.characters).sort().join(','), 'Mina,Mira', 'two pages');
  eq(after.characters.Mina.core, 'the harbourmaster’s daughter; counts everything', 'Mina’s page is untouched');
  eq(Object.keys(after.knowledge).join(',') + ' | ' + Object.keys(after.relationships).join(','), 'Mira | Mira', 'and what Mira knows and feels is hers, not Mina’s');
});

/* M647 — the ledger audit, part four: things. */
test('M647-1 ONE THING, NAMED MORE OR LESS FULLY, IS ONE THING: a letter named three ways is in one place at a time; a second letter is a second thing; a short name clears the one thing it can mean, and never one of two on a guess', () => {
  let st = applyMutations({ ...emptyState(), page: 5 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Wells house kitchen' }]).state;
  const go = (m) => { const r = applyMutations(st, [m]); st = r.state; return r; };
  const things = () => Object.entries(st.things || {}).map(([k, v]) => k + ' @ ' + v.where + (v.note ? ' {' + v.note + '}' : '')).join(' || ');
  go({ type: 'thing.set', name: 'the sealed letter from the bank', where: 'in Rias’s apron pocket', owner: 'Rias' });
  go({ type: 'thing.set', name: 'the letter', where: 'on the kitchen table', owner: 'Rias', note: 'opened' });
  eq(things(), 'the sealed letter from the bank @ on the kitchen table {opened}', 'named shorter: the same letter, moved — under the name the ledger holds');
  go({ type: 'thing.set', name: 'Sealed letter', where: 'in the stove, burning' });
  eq(things(), 'the sealed letter from the bank @ in the stove, burning {opened}', 'named a third way: still one letter, in one place');
  go({ type: 'thing.set', name: 'the boathouse key', where: 'on the nail by the back door', owner: 'Tom' });
  go({ type: 'thing.set', name: 'the letter from Claire', where: 'under Jovan’s pillow', owner: 'Jovan' });
  eq(Object.keys(st.things).join(' | '), 'the sealed letter from the bank | the boathouse key | the letter from Claire', 'a letter with a word of its own is a second letter');
  /* two letters now: "the letter" alone names neither… */
  const guess = go({ type: 'thing.clear', name: 'the letter', cause: 'burned' });
  eq(guess.applied.length, 0, 'not let go on a guess');
  assert(/could be more than one thing the ledger holds — the sealed letter from the bank; the letter from Claire/.test(guess.rejected[0].why), 'and the ledger says which two: ' + guess.rejected[0].why);
  /* …unless whose it is settles it */
  go({ type: 'thing.set', name: 'the letter', where: 'ash in the grate', owner: 'Rias' });
  eq(st.things['the sealed letter from the bank'].where + ' | ' + Object.keys(st.things).length, 'ash in the grate | 3', '“the letter”, Rias’s: the bank’s — no fourth thing');
  eq(go({ type: 'thing.clear', name: 'the key', cause: 'dropped in the harbour' }).applied.length, 1, '“the key” is the boathouse key, the only key there is');
  assert(!st.things['the boathouse key'], 'and it is gone');
  eq(go({ type: 'thing.clear', name: 'the oar', cause: 'snapped' }).applied.length, 0, 'a thing the ledger never held is not cleared');
  /* M605's own cases stand: an article or a possessor is not the name; two owners are two things */
  let b = applyMutations({ ...emptyState(), page: 2 }, [{ type: 'thing.set', name: 'the Batwing', where: 'on the roof of the GCPD', owner: 'Bruce' }, { type: 'thing.set', name: 'Bruce’s Batwing', where: 'over the harbour' },
    { type: 'thing.set', name: 'Gordon’s case file', where: 'on his desk' }, { type: 'thing.set', name: 'Barbara’s case file', where: 'in her bag' }]).state;
  eq(Object.keys(b.things).join(' | ') + ' @ ' + b.things['the Batwing'].where, 'the Batwing | Gordon’s case file | Barbara’s case file @ over the harbour', 'one Batwing; two case files');
  eq(applyMutations(b, [{ type: 'thing.clear', name: 'the case file', cause: 'shredded' }]).applied.length, 0, '“the case file” names neither of two');
});

test('M647-2 ELSEWHERE IS NEVER THE ROOM THE SCENE STANDS IN — for a ground written with its street address too: a seat that names the room is her walking in; another room, the porch, outside the window, the house at large are elsewhere; a compound’s other room still is (M444)', async () => {
  const { seatAtScene } = await import('../../js/engine/apply.js');
  const K = 'Wells house kitchen, 8 Mariner\u2019s Lane';
  for (const seat of ['Wells house kitchen', 'the Wells house kitchen, by the stove', 'the kitchen of the Wells house, 8 Mariner\u2019s Lane', 'in the Wells house kitchen']) eq(seatAtScene(seat, K), true, 'the scene’s own room: ' + seat);
  for (const seat of ['upstairs in the Wells house', 'her room, Wells house', 'the back porch of the Wells house', 'outside the Wells house kitchen', 'the Wells house', '8 Mariner\u2019s Lane', 'the Bluebird Diner, Harbor Street', 'the kitchen of the Bluebird Diner']) eq(seatAtScene(seat, K), false, 'elsewhere: ' + seat);
  const office = '13th Division Barracks — Captain\u2019s Office';
  eq(seatAtScene('13th Division Barracks — Captain\u2019s Office, by the window', office), true, 'a compound and its room, both named: the scene');
  for (const seat of ['13th Division Barracks', '13th Division Barracks — the third seats\u2019 office', '13th Division Barracks, the training yard']) eq(seatAtScene(seat, office), false, 'the compound alone, or another room of it, is elsewhere: ' + seat);
  /* at the ledger's door: the world seats her in the scene's own room — she is in the scene, with no elsewhere note */
  const st = applyMutations({ ...emptyState(), page: 5 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: K }, { type: 'presence.enter', name: 'Jovan' }, { type: 'people.set', name: 'Aunt Vera', field: 'core', text: 'runs the house' }]).state;
  const inRoom = applyMutations(st, [{ type: 'offscreen.set', name: 'Aunt Vera', location: 'Wells house kitchen', activity: 'waiting' }]).state;
  eq(inRoom.present.some((p) => p.name === 'Aunt Vera') + ' | ' + Boolean((inRoom.offscreen || {})['Aunt Vera']), 'true | false', 'seated where the scene is: in the scene, not “elsewhere” in the same room');
  const up = applyMutations(st, [{ type: 'offscreen.set', name: 'Aunt Vera', location: 'upstairs in the Wells house', activity: 'asleep' }]).state;
  eq(up.present.some((p) => p.name === 'Aunt Vera') + ' | ' + up.offscreen['Aunt Vera'].location, 'false | upstairs in the Wells house', 'another room of the house: elsewhere, as written');
});

/* M648 — the ledger audit, part five: the record keeper's door. */
test('M648-1 WHAT THE KEEPER STORES IS THE LINE, AND ONLY A LINE: a refusal in words or a question back is no line at all (never a line of “Our story so far”); a good line loses its wrapping — a preamble, a label, quotation marks, bullets, chatter after it', async () => {
  const { parseMemoryAnswer } = await import('../../js/agents/memory.js');
  const line = 'Jovan reached the Wells house in rain; Aunt Vera took the bank letter from Rias and locked it in the dresser; Tom swore to mend the roof before the storm; Rias owes the ferryman two coppers.';
  eq(parseMemoryAnswer(line), line, 'a clean line is kept as it is');
  for (const [how, raw] of [['a preamble', 'Here is the summary of the passage:\n\n' + line], ['“Sure, here’s…”', 'Sure, here’s the line: ' + line], ['a label', 'Summary: ' + line], ['quotation marks', '"' + line + '"'], ['curly quotation marks', '“' + line + '”'],
    ['thinking in front', '<think>The passage covers the arrival.</think>\n' + line], ['a code fence', '```\n' + line + '\n```'], ['chatter after it', line + '\n\nLet me know if you would like a shorter version!'], ['talk about itself', 'As an AI language model, I will now summarize: ' + line]]) {
    eq(parseMemoryAnswer(raw), line, how + ' is taken off');
  }
  eq(parseMemoryAnswer('- Jovan reached the Wells house in rain\n- Aunt Vera took the bank letter from Rias\n- Tom swore to mend the roof before the storm'), 'Jovan reached the Wells house in rain; Aunt Vera took the bank letter from Rias; Tom swore to mend the roof before the storm.', 'a bullet list is the line, its phrases joined');
  for (const refusal of ['I’m sorry, but I can’t help with summarizing this content.', 'I\'m sorry, but I can\'t help with that.', 'I cannot continue with this request as it involves explicit material. Is there something else I can help with?', 'Sorry, I can’t assist with that request.',
    'I am unable to summarize this passage.', 'As an AI, I must decline to process this content.', 'Unfortunately, I can’t summarize this.', 'Could you provide the passage you would like me to summarize?', 'Please provide the text you want summarized.', 'There is no passage to summarize.']) {
    eq(parseMemoryAnswer(refusal), '', 'no line: ' + refusal.slice(0, 44));
  }
  eq(parseMemoryAnswer('(no new state)'), '(no new state)', 'its own word for nothing new stands');
  eq(parseMemoryAnswer('Day 3: Jovan reached the Wells house in rain; Aunt Vera took the letter; Tom swore to mend the roof.'), 'Day 3: Jovan reached the Wells house in rain; Aunt Vera took the letter; Tom swore to mend the roof.', 'a line that opens with its own words and a colon is not a label');
  eq(parseMemoryAnswer('“Lock the back door,” Aunt Vera told them; Jovan stayed up with Rias; Tom went for the tar.'), '“Lock the back door,” Aunt Vera told them; Jovan stayed up with Rias; Tom went for the tar.', 'a line that opens with someone’s words keeps its quotation marks');
  eq(parseMemoryAnswer('Sorry Tom had broken the oar; Rias forgave him by supper; Aunt Vera docked his pay; the ferry ran late.'), 'Sorry Tom had broken the oar; Rias forgave him by supper; Aunt Vera docked his pay; the ferry ran late.', 'a real line of phrases is never taken for an apology');
});

test('M648-2 WHO SOMEONE IS, IS ADDED TO — NEVER THINNED BY A WORKER: the page-keeping worker’s “a girl”, or a nature turned gentle, does not replace the core that stands (and the run says so); the same and more, or a fuller rewrite, is written; her “now” on the same answer is kept', async () => {
  const { thinsCore } = await import('../../js/engine/people.js');
  const rich = 'the ferryman’s niece; quick, proud, counts every coin; will not be pitied; lies badly and knows it';
  eq(thinsCore(rich, 'a girl'), true, 'thinned to two words');
  eq(thinsCore(rich, 'gentle and trusting, eager to please'), true, 'another nature, in fewer words');
  eq(thinsCore(rich, rich + '; hums when she is afraid'), false, 'the same and more');
  eq(thinsCore(rich, 'The ferryman’s niece — quick and proud, a counter of every coin who will not be pitied; she lies badly, knows it, and hums when she is afraid of the water.'), false, 'a fuller rewrite that keeps who she is');
  eq(thinsCore('', 'a ferry pilot from the north shore'), false, 'a first core thins nothing');
  eq(thinsCore(rich, ''), false, 'nothing offered is nothing to judge');
  const { scribeTurn } = await import('../../js/agents/scribe.js');
  const { saveState, loadState } = await import('../../js/engine/state.js');
  const { db } = await import('../../js/store.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const page = '[Wells house kitchen — Monday, March 3, 2025 | 21:40 | rain | sweater | at the table]\n\nRias stirred the pot and did not look up. “You’re dripping on my floor.”';
  const run = async (deltas) => {
    const story = await db.stories.create({ title: 'who she is ' + deltas.length + Math.random() });
    await saveState(story.id, applyMutations({ ...emptyState(), page: 9 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Wells house kitchen' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rias' }, { type: 'people.set', name: 'Rias', field: 'core', text: rich }]).state);
    const out = await withHouse(thinkingHouse({ answer: JSON.stringify({ deltas }) }), () => scribeTurn({ connection: HOUSES[0].conn, storyId: story.id, userText: 'I come in from the rain.', assistantText: page }));
    return { out, page: (await loadState(story.id)).characters.Rias };
  };
  const thin = await run([{ name: 'Rias', field: 'core', text: 'a girl' }, { name: 'Rias', field: 'state', text: 'At the stove, stirring, not looking up.' }]);
  eq(thin.page.core, rich, 'her nature stands as written');
  eq(thin.page.state, 'At the stove, stirring, not looking up.', 'and her now, sent beside it, is kept');
  assert(thin.out.dropped.some((d) => d.delta.field === 'core' && /a nature is added to, never thinned to “a girl”/.test(d.why)), 'the run says what it did not write, and why: ' + JSON.stringify(thin.out.dropped));
  const drift = await run([{ name: 'Rias', field: 'core', text: 'gentle and trusting, eager to please' }]);
  eq(drift.page.core, rich, 'a nature turned gentle in fewer words does not replace her');
  const more = await run([{ name: 'Rias', field: 'core', text: rich + '; hums when she is afraid' }]);
  eq(more.page.core, rich + '; hums when she is afraid', 'the same and more is written');
});

test('M648-3 THE WORLD’S WORD KEEPS ONLY WHAT IS A LINE: one string is a list of one; “nothing new”, “none”, “N/A”, “…” are not pressures; no line twice; no line or window still carrying the prompt’s placeholders; a window that is an apology is no window', async () => {
  const { normalizeBrief } = await import('../../js/engine/world.js');
  const twb = { who: 'the harbour clerk', where: 'the harbour office', changed: 'counted the day’s tickets twice and found one too many' };
  const kept = (brief) => { const b = normalizeBrief(brief, 10, 9); return b.pressure.join(' | ') + ' // ' + b.ripe.join(' | ') + ' // ' + (b.twb ? b.twb.who : '—') + (b.empty ? ' // EMPTY' : ''); };
  eq(kept({ pressure: ['the storm is a day off', 'the bank wants its letter back'], ripe: ['Tom has the tar and no ladder'], twb }), 'the storm is a day off | the bank wants its letter back // Tom has the tar and no ladder // the harbour clerk', 'as asked: kept as it was');
  eq(kept({ pressure: 'the storm is a day off', ripe: 'Tom has the tar and no ladder', twb }), 'the storm is a day off // Tom has the tar and no ladder // the harbour clerk', 'a string where a list belongs is a list of one — not thrown away');
  eq(kept({ pressure: ['nothing new', 'No change.'], ripe: ['none', 'N/A', '…', '-', 'unchanged'], twb: { who: 'none', where: '', changed: '' } }), ' //  // — // EMPTY', '“nothing new” and its kin are nothing');
  eq(kept({ pressure: ['the storm is a day off', 'The storm is a day off.'], ripe: [], twb: null }), 'the storm is a day off //  // —', 'the same line twice is one line');
  eq(kept({ pressure: ['NAME wants OTHER NAME gone', 'the ferry is late'], ripe: ['MAIN CHARACTER owes NEW NAME'], twb: { who: 'NAME', where: 'somewhere', changed: 'did something' } }), 'the ferry is late //  // —', 'a line or a window still carrying a placeholder names no one');
  eq(kept({ pressure: [], ripe: [], twb: { who: 'the clerk', where: 'the office', changed: 'I’m sorry, but I can’t continue this scene.' } }), ' //  // — // EMPTY', 'a window that is the worker excusing itself is no window');
  eq(kept({ pressure: ['Rias will not name the man who paid her', 'Nothing in the harbour moves without the clerk’s stamp'], ripe: [], twb: null }), 'Rias will not name the man who paid her | Nothing in the harbour moves without the clerk’s stamp //  // —', 'real lines that merely hold those words are kept');
});

/* M649 — the ledger audit, part six: the books' doors, and what the storyteller is told. */
test('M649-1 THE ESSENTIALS KEEP THE LIST AND NOTHING AFTER IT: a refusal or a list that never starts is nothing; a preamble before it and chatter after it are not lines of it', async () => {
  const { readEssentials } = await import('../../js/agents/essentials.js');
  const list = ['(pages 1–6) Jovan reached the Wells house in rain and Aunt Vera took the bank letter from Rias.', '(pages 7–12) Tom swore to mend the roof before the storm; Rias owes the ferryman two coppers.'];
  const want = list.map((l) => '- ' + l).join('\n');
  eq(readEssentials(list.join('\n')), want, 'the list, as it is');
  eq(readEssentials('Here are the essentials:\n\n' + list.join('\n')), want, 'a preamble before it is not a line of it');
  eq(readEssentials(list.join('\n') + '\n\nLet me know if you’d like more detail on any of these!'), want, 'nor is chatter after it');
  eq(readEssentials('- ' + list.join('\n- ') + '\n\nWould you like me to continue?'), want, 'bulleted, with a question after it');
  eq(readEssentials('I’m sorry, but I can’t help with summarizing this content.'), '', 'a refusal is nothing');
  eq(readEssentials('Could you provide the record you would like condensed?'), '', 'a question back is nothing');
  eq(readEssentials('<think>[the list should start with pages]</think>\n' + list.join('\n')), want, 'its thinking is not its answer (M608)');
});

test('M649-2 WHAT THE STORYTELLER IS TOLD HOLDS NO BROKEN WORD: a ledger as a tale leaves it — full books, with the ragged edges real data has (an empty core, a seat with no place, a thread with no owner or next step, a standing on one axis) — is worded with no “undefined”, “null”, “NaN”, “[object Object]”, empty brackets or doubled dashes', async () => {
  const { renderStateFacts, renderMasthead } = await import('../../js/engine/state.js');
  const { renderWholeLedger } = await import('../../js/engine/whole.js');
  const { renderPeopleTiers } = await import('../../js/engine/people.js');
  const { renderWorldBrief } = await import('../../js/engine/world.js');
  const st = applyMutations({ ...emptyState(), page: 40 }, [{ type: 'mc.set', name: 'Jovan Arden' }, { type: 'place.set', name: 'Wells house kitchen, 8 Mariner\u2019s Lane' }, { type: 'clock.set', year: 2025, month: 3, day: 3, hour: 21, minute: 40 },
    { type: 'presence.enter', name: 'Jovan Arden', position: 'at the table', attire: 'a wet sweater' }, { type: 'presence.enter', name: 'Rias', position: 'at the stove' }, { type: 'presence.enter', name: 'Tom' },
    { type: 'people.set', name: 'Rias', field: 'core', text: 'the ferryman\u2019s niece; quick, proud, counts every coin' }, { type: 'people.set', name: 'Rias', field: 'state', text: 'At the stove, stirring.' },
    { type: 'people.set', name: 'Aunt Vera', field: 'core', text: 'runs the house' }, { type: 'people.note', name: 'Rias', field: 'thread', text: 'She still owes the ferryman two coppers.' },
    { type: 'offscreen.set', name: 'Aunt Vera', location: 'upstairs in the Wells house', activity: '' }, { type: 'offscreen.set', name: 'Claire', location: '', activity: 'driving north' },
    { type: 'rel.set', name: 'Rias', p: 30, r: 0, s: 0, cause: 'he paid her fare' }, { type: 'rel.shift', name: 'Tom', axis: 'p', delta: -5, cause: 'he broke the oar' },
    { type: 'knowledge.add', name: 'Rias', fact: 'that Jovan carries a sealed letter from the bank' },
    { type: 'thread.set', title: 'Who broke into the boathouse?', owner: 'Jovan Arden', heat: 'hot' }, { type: 'thread.set', title: 'The letter from the bank', owner: '', heat: 'cold', next: '' },
    { type: 'body.injure', name: 'Jovan Arden', what: 'left hand cut', sev: 1, treated: true }, { type: 'body.strain', name: 'Tom', what: 'hauling nets since dawn' },
    { type: 'thing.set', name: 'the sealed letter from the bank', where: 'in the dresser, locked', owner: 'Aunt Vera' }, { type: 'thing.set', name: 'the boathouse key', where: 'on the nail by the back door' },
    { type: 'mode.snapshot', flags: [] }, { type: 'world.word', brief: { pressure: ['the storm is a day off'], ripe: [], twb: { who: 'the harbour clerk', where: '', changed: 'counted the tickets twice' } } }]).state;
  const people = renderPeopleTiers(st, {});
  const blocks = { 'the state of things': renderStateFacts(st, {}), 'the masthead': renderMasthead(st), 'the people': typeof people === 'string' ? people : JSON.stringify(people), 'the world’s word': renderWorldBrief(st.worldBrief, st.turn, st.page, st), 'the whole ledger': renderWholeLedger(st) };
  for (const [name, text] of Object.entries(blocks)) {
    const t = String(text == null ? '' : text);
    assert(t.length > 40, name + ' is worded at all');
    const broken = t.match(/undefined|\bnull\b|\bNaN\b|\[object Object\]|\(\s*\)|—\s*—|,\s*,|\(\s*,|,\s*\)/);
    assert(!broken, name + ' holds a broken word: “' + (broken ? t.slice(Math.max(0, broken.index - 40), broken.index + 30) : '') + '”');
  }
  /* and the things the audit set right read as they should */
  assert(/Close by[^\n]*\n- Aunt Vera — upstairs in the Wells house/.test(blocks['the state of things']), 'Aunt Vera, upstairs, is close by — not in the room');
  assert(/Elsewhere: Claire — driving north/.test(blocks['the state of things']), 'a seat with no place says what it knows');
  assert(/- the sealed letter from the bank \(Aunt Vera’s\) — in the dresser, locked/.test(blocks['the state of things']), 'the letter, where it is and whose');
});

test('M649-3 THE AUDITOR’S WALK-IN, HELD TO THE PAGE THE SAME WAY: someone seated elsewhere whom the newest page brings in as “his aunt” is walked in when the auditor hands over the page’s words for it — and still not on a name the page only speaks, nor on words that are not there', async () => {
  const { auditLedger } = await import('../../js/agents/auditor.js');
  const { saveState, loadState } = await import('../../js/engine/state.js');
  const { db } = await import('../../js/store.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const run = async (text, enter) => {
    const story = await db.stories.create({ title: 'the aunt comes in ' + Math.random() });
    await db.messages.append(story.id, { role: 'user', text: 'I look up.' });
    await db.messages.append(story.id, { role: 'assistant', text: '[Wells house kitchen — Tuesday, March 4, 2025 | 07:10 | rain | sweater | at the table]\n\n' + text });
    await saveState(story.id, applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Wells house kitchen' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rias' },
      { type: 'people.set', name: 'Aunt Vera', field: 'core', text: 'runs the house' }, { type: 'offscreen.set', name: 'Aunt Vera', location: 'upstairs in the Wells house', activity: 'asleep' }]).state);
    const answer = JSON.stringify({ issues: [{ what: 'Aunt Vera came into the kitchen and is still listed upstairs', fix: 'write her in', pages: false, mutations: [enter] }] });
    await withHouse(thinkingHouse({ answer }), () => auditLedger({ connection: HOUSES[0].conn, storyId: story.id, brief: '' }));
    const led = await loadState(story.id);
    return (led.present.some((p) => p.name === 'Aunt Vera') ? 'here' : 'not here') + ' / ' + ((led.offscreen || {})['Aunt Vera'] ? 'still seated upstairs' : 'no elsewhere note');
  };
  const came = 'The back door opened and his aunt came in, shaking rain from her coat.';
  eq(await run(came, { type: 'presence.enter', name: 'Aunt Vera', shown: 'his aunt came in, shaking rain from her coat' }), 'here / no elsewhere note', 'backed by the page’s words: she is in the kitchen');
  eq(await run(came, { type: 'presence.enter', name: 'Aunt Vera' }), 'not here / still seated upstairs', 'unbacked, and not named in the telling: refused, as before');
  eq(await run('Rias poured the tea. “Aunt Vera will be down soon,” she said.', { type: 'presence.enter', name: 'Aunt Vera', shown: 'Aunt Vera will be down soon' }), 'not here / still seated upstairs', 'talked about is not here');
  eq(await run('Rias poured the tea and said nothing.', { type: 'presence.enter', name: 'Aunt Vera', shown: 'his aunt came in' }), 'not here / still seated upstairs', 'words that are not on the page are no evidence');
});

test('M649-4 A FINDING THAT FINDS NOTHING IS NOT A FINDING: the second reader’s “no issues”, “none”, “the page is consistent”, “nothing drifted” are not shown as something that drifted; the same finding twice is one; a real finding that begins with “No” is kept', async () => {
  const { parseContinuityAnswer } = await import('../../js/agents/continuity.js');
  const kept = (findings) => parseContinuityAnswer(JSON.stringify({ findings })).findings.map((f) => f.words);
  for (const words of ['No continuity issues found.', 'None', 'none.', 'N/A', 'Nothing drifted on this page.', 'Nothing to report', 'No issues', 'No contradictions were found on this page', 'The page is consistent with the ledger and the brief.', 'Everything is consistent.', 'All consistent', 'It checks out.']) eq(kept([{ words, severity: 'note' }]).length, 0, 'finds nothing: ' + words);
  const real = ['Rias speaks of the bank letter though no page shows her learning of it', 'No page shows Aunt Vera coming downstairs, yet she pours the tea', 'Nothing explains how Tom got down from the roof between two lines', 'Tom is at the stove though the ledger has him on the roof', 'The page is consistent about the hour but puts the scene in the parlour, not the kitchen'];
  for (const words of real) eq(kept([{ words, severity: 'warn' }]).join(''), words, 'a real finding: ' + words.slice(0, 40));
  eq(kept([{ words: 'N/A', severity: 'note' }, { words: real[3], severity: 'warn' }, { words: real[3] + '.', severity: 'warn' }, { words: 'No issues found', severity: 'note' }]).join(' | '), real[3], 'one real finding among nothings and its own echo: one finding');
  eq(parseContinuityAnswer('I’m sorry, but I can’t review this content.').findings.length, 0, 'a refusal in words is no finding');
});

/* M650 — the ledger audit, part seven: the referee's gate, and a sighting handed to the world agent by name. */
test('M650-1 THE GATE HEARS VERBS, NOT LETTERS: in a calm scene every real attempt reaches the referee — in whatever form its verb takes, and the violence the list had no word for — and a quiet move does not (a word that merely begins like a gate verb, an everyday phrase)', async () => {
  const { gatePasses } = await import('../../js/agents/referee.js');
  const sent = (t) => gatePasses(t, 'normal', {}).pass;
  const attempts = ['I slit his throat.', 'I drive my knee into his stomach.', 'I slam him against the wall.', 'I put a bullet in him.', 'I knock him out cold.', 'I headbutt him.', 'I tackle him to the floor.', 'I snap her wrist.',
    'I blast him with a bolt of fire.', 'I bring the bottle down on his head.', 'I grab his collar and throw him out.', 'I choke him.', 'I pull the trigger.', 'I swing at him.', 'I sneak past the guard.', 'I pick his pocket.',
    'I lie and say I was home all night.', 'I hack the terminal.', 'I climb the drainpipe.', 'I leap across the gap.', 'I pick the lock.', 'I wrestle the gun out of his hand.', 'I outrun them.', 'I forge his signature.',
    'I slip the vial into her drink.', 'I shove past him and run.', 'I disarm her.', 'I pin him down.', 'I cut the rope.', 'I catch the falling vase.', 'I dodge.', 'I teleport behind him and strike.', 'I unleash Mahoraga on him.',
    /* in other forms, and the second battery (none of them used to shape the rule) */
    'I stabbed him twice.', 'I’m strangling her with the cord.', 'I shot the lock off.', 'I threw the knife at his back.', 'I kick the door in.', 'I tripped him as he ran.', 'I poison the wine.', 'I steal the ledger from his desk.',
    'I chase the thief down the alley.', 'I summon my shikigami.', 'I blackmail the clerk.', 'I bite his hand.', 'I flee through the back window.', 'I ram the gate with the truck.', 'I slapped him.', 'I parried and countered.',
    'I vault the fence.', 'I intimidate the guard into letting us pass.', 'I wrestle him off her.', 'I hurl the lamp at the window.', 'I break his nose.', 'I knocked the guard unconscious.', 'I kidnap the envoy.', 'I cast a barrier over the door.',
    'I teleport us out.', 'I escape the handcuffs.', 'I kill him.'];
  for (const t of attempts) eq(sent(t), true, 'an attempt: ' + t);
  const quiet = ['I sit down and pour the tea.', 'I ask her what the crossing costs.', 'I nod.', 'I kiss her.', 'I walk to the window.', 'I laugh.', 'I tell him about the letter.', 'I go to bed.', 'I hit the showers.', 'I kill time until noon.',
    'I strike up a conversation with the barman.', 'I shoot her a look.', 'I punch in the door code.', 'I pick up the cup.', 'I throw on a jacket.', 'I take a seat by the fire.', 'I beat the eggs.', 'I cut the bread.', 'I run a hand through my hair.',
    'I grab my keys.', 'I break the silence.', 'I catch her eye.', '“I’ll kill him,” I say.',
    'I open the drawer and take out a pen.', 'I order a pint and wait.', 'I calmly fold the letter.', 'I get comfortable on the couch.', 'I put on my slippers.', 'I loosen my tie.', 'I rolled my eyes at him.', 'I squeeze Rias’s hand.',
    'I lean on the counter and wait.', 'I warm my hands by the fire.', 'I pick up the phone.', 'I threw on a coat and left.', 'I crack a smile.', 'I draw the curtains.', 'I charge my phone.', 'I sweep the floor.', 'I slip into bed beside her.',
    'I knock on the door.', 'I snap my fingers.', 'I lie down on the bed.', 'I cut the cake.', 'I catch the bus.', 'I break for lunch.', 'I read the casebook.', 'I check the spare room.', 'I hang the picture.', 'I pass the pink salt.',
    'I thank the driver.', 'I watch the sailboats.', 'I pet the dog.', 'I say goodnight and head upstairs.', 'I sit on the counter stool and order coffee.', 'I light the fire.'];
  for (const t of quiet) eq(sent(t), false, 'a quiet move: ' + t);
  /* what was always so still is */
  eq(gatePasses('I sit down.', 'normal', { inFight: true }).pass, true, 'in a fight every beat is scored');
  eq(gatePasses('I sit down.', 'normal', { tense: true }).pass, true, 'with a fight in the air the referee reads every move (M616)');
  eq(gatePasses('(brb, phone)', 'normal', {}).pass, false, 'out of character is not an act');
  eq(gatePasses('I try to open the window without waking her.', 'conservative', {}).pass, true, 'an attempt phrase arms even the conservative gate');
  eq(gatePasses('I stab him.', 'conservative', {}).pass, false, 'which hears no bare verbs, as before');
});

test('M650-2 A SIGHTING IS HANDED TO THE WORLD AGENT BY NAME: someone who stepped off the page with nowhere said to go is marked for it at once — not someone the leaving placed, not someone seated, not someone in the scene', async () => {
  const { peopleForWorld } = await import('../../js/agents/world.js');
  const st = applyMutations({ ...emptyState(), page: 12 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Wells house kitchen, 8 Mariner\u2019s Lane' }, { type: 'clock.set', year: 2025, month: 3, day: 3, hour: 21, minute: 40 },
    ...['Jovan', 'Rias', 'Aunt Vera', 'Tom'].map((name) => ({ type: 'presence.enter', name })),
    ...['Rias', 'Aunt Vera', 'Tom', 'Claire'].map((name) => ({ type: 'people.set', name, field: 'core', text: 'someone the story keeps' })), ...['Rias', 'Aunt Vera', 'Tom', 'Claire'].map((name) => ({ type: 'rel.set', name, p: 30, cause: 'family' })),
    { type: 'presence.leave', name: 'Aunt Vera' }, { type: 'presence.leave', name: 'Tom', to: 'the roof of the Wells house', doing: 'mending it' }, { type: 'offscreen.set', name: 'Claire', location: 'the Bluebird Diner', activity: 'closing up' }]).state;
  const out = peopleForWorld(st, {});
  const text = typeof out === 'string' ? out : JSON.stringify(out);
  const lineOf = (name) => (text.split(/\n|\\n/).find((l) => l.includes(name + ' ')) || '');
  assert(/Aunt Vera \[ONLY LAST SEEN — where did they go\?\]/.test(lineOf('Aunt Vera')), 'she left with no word of where: marked, the same page — ' + lineOf('Aunt Vera'));
  assert(!/ONLY LAST SEEN/.test(lineOf('Tom')) && !/ONLY LAST SEEN/.test(lineOf('Claire')), 'Tom (placed by his leaving) and Claire (seated) are not');
  assert(/Rias \[in the scene\]/.test(lineOf('Rias')), 'Rias is in the scene');
});

/* M651 — the ledger audit, part eight: how they measure. */
test('M651-1 A RATING IS READ AS ITS NUMBER, HOWEVER IT IS WRITTEN: “9/10”, “8 (first grade, elite)”, “9+”, “8 out of 10”, “85/100” are ratings — a special grade is not filed as an average fighter, and a foe the referee rates in a beat is not “unknown”; words with no number are no rating', async () => {
  const { ratingOf, mergeSeed, normalizeAdj } = await import('../../js/agents/referee.js');
  for (const [said, want] of [[9, 9], ['9', 9], ['9/10', 9], ['8 (first grade, elite)', 8], ['9+', 9], ['8 out of 10', 8], ['~7', 7], ['7-8', 7], ['7.5', 7.5], ['85/100', 8.5], ['85%', 8.5], ['rating: 6', 6]]) eq(ratingOf(said), want, 'read “' + said + '”');
  for (const said of ['high', '', null, undefined, {}, 'very strong', true]) assert(Number.isNaN(ratingOf(said)), 'no number in ' + JSON.stringify(said));
  const st = applyMutations({ ...emptyState(), page: 5 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'presence.enter', name: 'Jovan' },
    ...['Kenjaku', 'Yuki Tsukumo', 'Todo', 'Maki'].flatMap((name) => [{ type: 'people.set', name, field: 'core', text: 'a sorcerer' }, { type: 'presence.enter', name }])]).state;
  mergeSeed(st, { actors: [
    { name: 'Kenjaku', default: 9, domains: { melee: 8, sorcery: 10 } },
    { name: 'Yuki Tsukumo', default: '9/10', domains: { melee: '9/10', sorcery: '8 out of 10' } },
    { name: 'Todo', default: '8 (first grade, elite)', domains: { melee: '9+' } },
    { name: 'Maki', default: 'high', domains: { melee: 'very high' } }] });
  const a = st.sheet.actors;
  eq(a.Kenjaku.default + ' ' + JSON.stringify(a.Kenjaku.domains), '9 {"melee":8,"sorcery":10}', 'plain numbers, as always');
  eq(a['Yuki Tsukumo'].default + ' ' + JSON.stringify(a['Yuki Tsukumo'].domains), '9 {"melee":9,"sorcery":8}', 'a special grade written “9/10” is a nine — not the default five, her domains kept');
  eq(a.Todo.default + ' ' + JSON.stringify(a.Todo.domains), '8 {"melee":9}', '“8 (first grade, elite)” and “9+”');
  eq(a.Maki.default + ' ' + JSON.stringify(a.Maki.domains), '5 {}', 'words with no number are no rating: the default, as before');
  /* in a beat: the referee's own estimate of a foe */
  const adj = normalizeAdj({ check: true, action: 'I cut at him', kind: 'actor', opposition: 'Kenjaku', opponent_rating: '9/10', duel_start: { opponent: 'Kenjaku', domain: 'melee', rating: '9 (special grade)' } }, st);
  eq(adj.opponent_rating, 9, 'the opponent’s rating in a beat');
  eq((adj.duel_start || adj.battle_start || {}).rating ?? (adj.battle_start || {}).oppEstimate, 9, 'and at the start of a duel');
  eq(normalizeAdj({ check: true, action: 'I cut at him', opponent_rating: 'unknown' }, st).opponent_rating, null, 'no number: unknown, as before');
});

/* M653 — the ledger audit, part ten: threads at the ledger's door. */
test('M653-1 ONE THREAD, HOWEVER IT IS WORDED AGAIN: the same promise sent in other words, shorter, in another case or with a new next step MOVES the thread it is — never a second, third and fourth copy; two different threads stay two; “None” is no thread', () => {
  let st = applyMutations({ ...emptyState(), page: 5 }, [{ type: 'mc.set', name: 'Jovan' }]).state;
  const go = (m) => { const r = applyMutations({ ...st, page: st.page + 1 }, [m]); st = r.state; return r.applied[0] ? r.applied[0].words : 'refused: ' + r.rejected[0].why; };
  assert(/^A thread opened/.test(go({ type: 'thread.set', title: 'Tom’s promise to fix the roof before the storm', owner: 'Tom', heat: 'hot', next: 'buy the tar' })), 'it opens');
  for (const [title, next] of [['Tom promised to fix the roof before the storm', 'find a ladder'], ['Tom and the roof', 'borrow a ladder'], ['tom’s promise to fix the roof before the storm.', 'climb up before dark'], ['“Tom’s promises to fix the roof before the storms”', 'start at the chimney']]) {
    assert(/^A thread moved/.test(go({ type: 'thread.set', title, owner: 'Tom', heat: 'hot', next })), 'the same thread, moved: ' + title);
    eq(st.threads.length, 1, 'still one thread');
  }
  eq(st.threads[0].title + ' → ' + st.threads[0].next, 'Tom’s promise to fix the roof before the storm → start at the chimney', 'under the title it was opened with, at its newest step');
  assert(/^A thread opened/.test(go({ type: 'thread.set', title: 'Rias and the letter from the bank', owner: 'Rias', heat: 'hot', next: 'open it' })), 'another thread opens');
  assert(/^A thread opened/.test(go({ type: 'thread.set', title: 'Rias and the letter from Claire', owner: 'Rias', heat: 'hot', next: 'hide it' })), 'and a third, with a word of its own');
  assert(/^A thread opened/.test(go({ type: 'thread.set', title: 'Rias and the letter', owner: 'Rias', heat: 'hot' })), 'a title that could be either of two is neither — its own thread, as before');
  eq(st.threads.length, 4, 'four threads: the roof, two letters, and the one that named neither');
  for (const title of ['None', 'N/A', 'nothing new', 'No thread', 'TBD']) assert(/is no thread/.test(go({ type: 'thread.set', title, heat: 'cold' })), '“' + title + '” is no thread');
  eq(st.threads.length, 4, 'and none of them was written');
  /* copies made before this was mended: a new wording moves the oldest of them instead of making one more */
  let old = applyMutations({ ...emptyState(), page: 5 }, [{ type: 'mc.set', name: 'Jovan' }]).state;
  old.threads = [{ title: 'Tom’s promise to fix the roof before the storm', owner: 'Tom', heat: 'hot', next: 'buy the tar', atTurn: 3 }, { title: 'Tom promised to fix the roof before the storm', owner: 'Tom', heat: 'hot', next: 'find a ladder', atTurn: 4 }, { title: 'Tom and the roof', owner: 'Tom', heat: 'hot', next: 'x', atTurn: 5 }];
  const r = applyMutations(old, [{ type: 'thread.set', title: 'Tom fixing the roof', owner: 'Tom', heat: 'hot', next: 'up the ladder at last' }]);
  eq(r.state.threads.length + ' | ' + r.state.threads[0].next, '3 | up the ladder at last', 'the oldest copy is the thread that moves; no fourth is made');
  assert(/A thread closed/.test(applyMutations(st, [{ type: 'thread.close', title: 'Tom promised to fix the roof' }]).applied[0].words), 'and closing it in other words closes it');
});

test('M653-2 A KEEPER THAT REFUSES IN WORDS, END TO END (M648’s door, through the keeper’s whole run): the page its model will only apologise for is never recorded as that apology — it is asked alone, the keeper is proven alive, the page is covered without words, and the record moves on; nothing of the apology reaches the storyteller', async () => {
  const { maybeSummarize, loadMemory, dueRange, cleanWindow, cleanBatch, visiblePages, recordFor } = await import('../../js/agents/memory.js');
  const { db } = await import('../../js/store.js');
  const sse = (pieces) => { const t = pieces.map((p) => 'data: ' + JSON.stringify(p) + '\n\n').join('') + 'data: [DONE]\n\n'; return { ok: true, status: 200, headers: new Headers(), body: new Response(t).body, text: async () => t }; };
  const say = (text) => sse([{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]);
  const SORRY = 'I’m sorry, but I can’t help with summarizing this content.';
  const asked = [];
  const f = async (url, opts) => {
    const body = JSON.parse(opts.body);
    const user = String(body.messages[body.messages.length - 1].content || '');
    asked.push(user.slice(0, 60));
    if (/single word: ready/.test(user)) return say('ready');
    if (/THE FORBIDDEN PAGE/.test(user)) return say(SORRY);                      /* a refusal in words, not a blank */
    return say('Jovan and Liara talked on the porch; the street went quiet; she asked him to stay for the fair.');
  };
  const DS = { type: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'deepseek-chat', reasoning: { effort: 'off' } };
  const keptWindow = await db.settings.get('memoryWindow'); const keptBatch = await db.settings.get('memoryBatch');
  await db.settings.set('memoryWindow', 4); await db.settings.set('memoryBatch', 6);
  const st = await db.stories.create({ title: 'a keeper that says sorry' });
  for (let i = 0; i < 20; i += 1) await db.messages.append(st.id, { role: i % 2 ? 'assistant' : 'user', text: i === 1 ? '[The Wells house — Friday | 20:40]\n\nTHE FORBIDDEN PAGE: what happened on the porch.' : (i % 2 ? '[The Wells house — Friday | 20:4' + (i % 10) + ']\n\nLiara leaned on the rail and the street went quiet. Page ' + i + '.' : 'I stay a while longer. ' + i) });
  const gap = async () => { const mem = await loadMemory(st.id); return dueRange(visiblePages(await db.messages.list(st.id)).length, cleanWindow(4), mem.nodes, cleanBatch(6)); };
  const prior = globalThis.fetch; globalThis.fetch = f;
  try {
    for (let i = 0; i < 8 && (await gap()); i += 1) await maybeSummarize({ connection: { ...DS }, storyId: st.id, stale: () => false, renew: () => true });
    const mem = await loadMemory(st.id);
    eq(await gap(), null, 'no gap is left: the record moved past the page');
    assert(!mem.nodes.some((n) => /sorry|can’t help|can't help|summariz/i.test(String(n.text || ''))), 'no line of the record is the apology: ' + JSON.stringify(mem.nodes.map((n) => String(n.text || '').slice(0, 40))));
    const covered = mem.nodes.find((n) => n.span[0] <= 1 && n.span[1] >= 1);
    assert(covered && covered.byHouse === true && covered.text === '', 'the page it would only apologise for is covered by the house, without words: ' + JSON.stringify(covered));
    assert(asked.some((u) => /single word: ready/.test(u)), 'only after the keeper was proven to answer at all');
    assert(mem.nodes.filter((n) => !n.byHouse).length >= 2 && mem.nodes.filter((n) => n.byHouse).length === 1, 'every other page has its own line: ' + JSON.stringify(mem.nodes.map((n) => n.span)));
    assert(!/sorry|can’t help|summariz/i.test(recordFor(mem, 1, 100000)), 'and nothing of it rides to the storyteller');
  } finally { globalThis.fetch = prior; if (keptWindow === undefined) await db.settings.delete('memoryWindow'); else await db.settings.set('memoryWindow', keptWindow); if (keptBatch === undefined) await db.settings.delete('memoryBatch'); else await db.settings.set('memoryBatch', keptBatch); }
});

test('M653-3 A THREAD’S COPIES CLOSE WITH IT: where one thread stood as several (made before the door was mended), closing it closes them all — and leaves every other thread open', () => {
  const st = applyMutations({ ...emptyState(), page: 5 }, [{ type: 'mc.set', name: 'Jovan' }]).state;
  st.threads = [{ title: 'Tom’s promise to fix the roof before the storm', owner: 'Tom', heat: 'hot', next: 'buy the tar', atTurn: 3 }, { title: 'Tom promised to fix the roof before the storm', owner: 'Tom', heat: 'hot', next: 'find a ladder', atTurn: 4 },
    { title: 'Tom and the roof', owner: 'Tom', heat: 'hot', next: 'x', atTurn: 5 }, { title: 'Who broke into the boathouse?', owner: 'Jovan', heat: 'hot', next: 'ask the harbourmaster', atTurn: 5 }, { title: 'Rias and the letter from the bank', owner: 'Rias', heat: 'hot', atTurn: 6 }];
  const r = applyMutations(st, [{ type: 'thread.close', title: 'Tom’s promise to fix the roof before the storm' }]);
  eq(r.state.threads.map((t) => t.title).join(' | '), 'Who broke into the boathouse? | Rias and the letter from the bank', 'the roof is closed whole; the boathouse and the letter stand');
  assert(/A thread closed: Tom’s promise to fix the roof before the storm \(with 2 copies of it\)\./.test(r.applied[0].words), 'and the ledger says so: ' + r.applied[0].words);
  const one = applyMutations(st, [{ type: 'thread.close', title: 'Who broke into the boathouse' }]);
  eq(one.state.threads.length + ' | ' + one.applied[0].words, '4 | A thread closed: Who broke into the boathouse?', 'a thread with no copies closes alone, worded as before');
});

/* M654 — the ledger audit, part eleven: a yes is a yes and a number is its number, as models write them. */
test('M654-1 THE REFEREE’S RULING, AS MODELS WRITE IT: “check”:"true" is a check, “combat_ended”:"true" ends the fight; “+2 (high ground)”, “−1” with a real minus sign, “-2: wounded leg” are their numbers — for the circumstance, a composure blow, a condition, a duel’s scale', async () => {
  const { normalizeAdj, normalizeDuelAdj, truthOf, signedOf } = await import('../../js/agents/referee.js');
  for (const v of [true, 1, 'true', 'True', ' yes ', 'Y', '1']) eq(truthOf(v), true, 'a yes: ' + JSON.stringify(v));
  for (const v of [false, 0, 'false', 'no', '', null, undefined, 'maybe', {}, 2]) eq(truthOf(v), false, 'not a yes: ' + JSON.stringify(v));
  for (const [said, want] of [[2, 2], ['2', 2], ['+2', 2], ['+2 (high ground)', 2], ['−1', -1], ['–3', -3], ['-2: wounded leg', -2], ['- 2', -2], ['minus', NaN], ['', NaN], [null, NaN]]) { const got = signedOf(said); assert(Number.isNaN(want) ? Number.isNaN(got) : got === want, 'read ' + JSON.stringify(said) + ' as ' + want + ' (got ' + got + ')'); }
  const st = applyMutations({ ...emptyState(), page: 5 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Kenjaku' }, { type: 'people.set', name: 'Kenjaku', field: 'core', text: 'a sorcerer' }]).state;
  const base = { action: 'I cut at his neck', kind: 'actor', opposition: 'Kenjaku', domain: 'melee', stakes: 'his head' };
  for (const check of [true, 'true', 'yes', 1]) eq(normalizeAdj({ ...base, check }, st).check, true, 'a check, written ' + JSON.stringify(check));
  for (const check of [false, 'false', 'no', undefined]) eq(normalizeAdj({ ...base, check }, st).check, false, 'no check, written ' + JSON.stringify(check));
  eq(normalizeAdj({ ...base, check: true, circumstance: '+2 (high ground)' }, st).circumstance, 2, 'the circumstance with its reason beside it');
  eq(normalizeAdj({ ...base, check: true, circumstance: '−1' }, st).circumstance, -1, 'and with a real minus sign');
  eq(JSON.stringify(normalizeAdj({ ...base, check: true, composure_change: { who: 'Kenjaku', delta: '−1 (rattled)' } }, st).composure_change), JSON.stringify({ who: 'Kenjaku', delta: -1 }), 'a composure blow is not dropped');
  eq(normalizeAdj({ ...base, check: true, condition_change: { who: 'Kenjaku', add: 'blinded in one eye', mod: '−2 (severe)' } }, st).condition_change.mod, -2, 'a condition weighs what the referee said, not the default');
  eq(normalizeAdj({ ...base, check: true, condition_change: { who: 'Jovan', add: 'the inverted spear', gear: 'true', mod: '+2' } }, st).condition_change.gear, true, 'gear written "true" is gear');
  eq(normalizeAdj({ ...base, check: true, duel_start: { opponent: 'Kenjaku', domain: 'melee', rating: '9/10', scale: '+2 (outclassed)' } }, st).duel_start.scale, 2, 'a duel’s scale');
  const duel = { engaged: true, opponent: 'Kenjaku' };
  const stFight = { ...st, duel };
  eq(normalizeDuelAdj({ move: 'attack', combat_ended: 'true' }, stFight).combat_ended, true, 'the fight is over when the referee says so in a word');
  eq(normalizeDuelAdj({ move: 'attack', combat_ended: 'false' }, stFight).combat_ended, false, 'and not when it says it is not');
});

test('M654-2 A NUMBER A WORKER WRITES IS READ AS ITS NUMBER AT THE LEDGER’S DOOR: a feeling’s fall written with a real minus sign, or with its reason beside it, lands as its rises do; a standing set, minutes moved on, the same; words with no number are refused as before', () => {
  const st = applyMutations({ ...emptyState(), page: 5 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'clock.set', year: 2025, month: 3, day: 3, hour: 21, minute: 0 }, { type: 'presence.enter', name: 'Rias' }, { type: 'rel.set', name: 'Rias', p: 30, cause: 'he paid her fare' }]).state;
  const p = (m) => { const r = applyMutations(st, [m]); return r.applied.length ? r.state.relationships.Rias.p : 'refused'; };
  eq(p({ type: 'rel.shift', name: 'Rias', axis: 'p', delta: 3, cause: 'he kept his word about the letter' }), 33, 'a rise, plain');
  eq(p({ type: 'rel.shift', name: 'Rias', axis: 'p', delta: '+3', cause: 'he kept his word about the roof' }), 33, 'a rise, written "+3"');
  eq(p({ type: 'rel.shift', name: 'Rias', axis: 'p', delta: '-4', cause: 'he lied about the key' }), 26, 'a fall, written "-4"');
  eq(p({ type: 'rel.shift', name: 'Rias', axis: 'p', delta: '−4', cause: 'he lied about the ferry' }), 26, 'a fall with a real minus sign lands — it was refused, while every rise landed');
  eq(p({ type: 'rel.shift', name: 'Rias', axis: 'p', delta: '-4 (he lied)', cause: 'he lied about the oar' }), 26, 'a fall with its reason beside the number');
  eq(p({ type: 'rel.shift', name: 'Rias', axis: 'p', delta: 'a little', cause: 'x' }), 'refused', 'words with no number move nothing');
  const set = applyMutations(st, [{ type: 'rel.set', name: 'Rias', p: '45', r: '−10', cause: 'the pages show her fond and wary' }]).state.relationships.Rias;
  eq(set.p + '/' + set.r, '45/-10', 'a standing set, both axes read');
  const later = applyMutations(st, [{ type: 'clock.advance', minutes: '20 minutes' }]).state;
  eq(later.clock.minutes - st.clock.minutes, 20, 'the clock moves on “20 minutes”');
});

test('M654-3 THE SAME READING IN THE AUDITOR AND THE PLANS BOOK: a fault on the pages flagged “pages”:"true" is kept (it was dropped as no finding); a plan’s part reported done as “part 2” is done', async () => {
  const { parseAuditorAnswer } = await import('../../js/agents/auditor.js');
  const issue = (pages) => parseAuditorAnswer(JSON.stringify({ issues: [{ what: 'Page 12 has Rias at the stove though she left for the ferry on page 11', fix: 'she is gone; Tom stirs the pot', pages, mutations: [] }] })).issues[0];
  for (const pages of [true, 'true', 'yes', 1, 'True']) eq(issue(pages).pages, true, 'a fault on the pages, flagged ' + JSON.stringify(pages));
  for (const pages of [false, 'false', 'no', undefined, 0, '']) eq(issue(pages).pages, false, 'not one, flagged ' + JSON.stringify(pages));
  const { readPlansAnswer } = await import('../../js/agents/plans.js');
  const plan = { title: 'Mend the roof before the storm', by: 'Tom', goal: 'a dry kitchen', page: 'page 12', parts: [{ who: 'Tom', does: 'buys the tar' }, { who: 'Tom', does: 'borrows a ladder' }, { who: 'Tom', does: 'mends the roof' }] };
  const read = readPlansAnswer(JSON.stringify({ new: [plan], progress: [{ title: 'Mend the roof before the storm', done: [1, 'part 2', '#3', 'done', 0], changed: [{ part: 'part 3', who: 'Tom', does: 'mends the roof with Jovan holding the ladder' }] }], closed: [] }));
  eq(read.fresh[0].page, 12, 'the page a plan was made on, written “page 12”');
  eq(read.progress[0].done.join(','), '1,2,3', 'parts reported done as 1, “part 2” and “#3” are done; a word and a zero are not');
  eq(read.progress[0].changed[0].part, 3, 'and a changed part written “part 3” is part three');
  eq(readPlansAnswer('I’m sorry, but I can’t help with that.'), null, 'a refusal is no answer, as before');
});

/* M655 — the ledger audit, part twelve: the world agent's whole call. */
test('M655-1 THE WORLD AGENT, END TO END: it is handed by name the one only last seen and the one with no whereabouts; what it answers lands as the audit left each door — a sighting replaced, a seat in the scene’s own room walked in, a thread in other words moved, a thinner nature dropped, “nothing new” not kept — and minutes on a road that is not to him are no arrival', async () => {
  const { worldTurn } = await import('../../js/agents/world.js');
  const { saveState, loadState } = await import('../../js/engine/state.js');
  const { seatNowWords } = await import('../../js/engine/offscreen.js');
  const { db } = await import('../../js/store.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const rich = 'the ferryman\u2019s niece; quick, proud, counts every coin; will not be pitied';
  const st = applyMutations({ ...emptyState(), page: 12 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Wells house kitchen, 8 Mariner\u2019s Lane' }, { type: 'clock.set', year: 2025, month: 3, day: 3, hour: 21, minute: 40 },
    ...['Jovan', 'Rias', 'Aunt Vera'].map((name) => ({ type: 'presence.enter', name })),
    { type: 'people.set', name: 'Rias', field: 'core', text: rich }, { type: 'people.set', name: 'Aunt Vera', field: 'core', text: 'runs the house; brisk, unsentimental' },
    { type: 'people.set', name: 'Tom', field: 'core', text: 'his cousin; slow to speak, quick to fix things' }, { type: 'people.set', name: 'Claire', field: 'core', text: 'drives the north road; owes nobody' },
    ...['Rias', 'Aunt Vera', 'Tom', 'Claire'].map((name) => ({ type: 'rel.set', name, p: 30, cause: 'family and friends' })),
    { type: 'presence.leave', name: 'Aunt Vera' }, { type: 'offscreen.set', name: 'Claire', location: 'the Bluebird Diner', activity: 'closing up' },
    { type: 'thread.set', title: 'Tom\u2019s promise to fix the roof before the storm', owner: 'Tom', heat: 'hot', next: 'buy the tar' }]).state;
  const story = await db.stories.create({ title: 'the world, end to end ' + Math.random() });
  await saveState(story.id, st);
  const answer = { mutations: [
    { type: 'offscreen.set', name: 'Aunt Vera', location: 'upstairs in the Wells house', activity: 'asleep' },
    { type: 'offscreen.set', name: 'Tom', location: 'Wells house kitchen', activity: 'waiting by the stove' },
    { type: 'thread.set', title: 'Tom promised to fix the roof before the storm', owner: 'Tom', heat: 'hot', next: 'find a ladder' },
    { type: 'people.set', name: 'Rias', field: 'core', text: 'a girl' },
    { type: 'knowledge.add', name: 'Claire', fact: 'that the ferry was cancelled' },
    { type: 'offscreen.set', name: 'Claire', location: 'the north road', activity: 'driving home', agenda: 'meaning to be back by dawn', etaMinutes: '45 minutes', stance: 'away' },
  ], brief: { pressure: 'the storm is a day off', ripe: ['nothing new'], twb: { who: 'the harbour clerk', where: 'the harbour office', changed: 'counted the day\u2019s tickets twice and found one too many' }, voices: [] } };
  const house = thinkingHouse({ answer: JSON.stringify(answer) });
  await withHouse(house, () => worldTurn({ connection: HOUSES[0].conn, storyId: story.id, userText: 'I wait by the stove.', assistantText: '[Wells house kitchen, 8 Mariner\u2019s Lane — Monday, March 3, 2025 | 21:45 | rain | sweater | at the table]\n\nRias stirred the pot and said nothing.', stale: () => false }));
  const sent = JSON.stringify(house.calls[0].body.messages);
  assert(/Aunt Vera \[ONLY LAST SEEN — where did they go\?\]/.test(sent), 'she is handed over by name as only last seen');
  assert(/Tom \[NO SEAT — seat them\]/.test(sent), 'and Tom as someone with no whereabouts');
  const led = await loadState(story.id);
  const seat = (n) => (led.offscreen[n] ? seatNowWords(led.offscreen[n], led.clock.minutes, { agenda: true, arrival: true }) : '(no note)');
  eq(seat('Aunt Vera'), 'upstairs in the Wells house, asleep', 'the sighting is replaced by where she went');
  eq(led.present.map((p) => p.name).join(', ') + ' / ' + seat('Tom'), 'Jovan, Rias, Tom / (no note)', 'Tom, seated in the scene’s own room, is in the scene — not elsewhere in it');
  eq(led.threads.map((t) => t.title + ' → ' + t.next).join(' || '), 'Tom\u2019s promise to fix the roof before the storm → find a ladder', 'the thread said in other words is the thread, moved');
  eq(led.characters.Rias.core, rich, 'who Rias is stands');
  eq(JSON.stringify((led.knowledge.Claire || []).map((k) => k.fact)), JSON.stringify(['that the ferry was cancelled']), 'what an absent person learned is hers');
  eq(JSON.stringify({ pressure: led.worldBrief.pressure, ripe: led.worldBrief.ripe, twb: led.worldBrief.twb.who }), JSON.stringify({ pressure: ['the storm is a day off'], ripe: [], twb: 'the harbour clerk' }), 'the world’s word: the one pressure, no “nothing new”, the window');
  eq(seat('Claire'), 'the north road, driving home (meaning to be back by dawn)', 'driving home is not “arriving in about 45 minutes”');
  /* a road to him still has its arrival; minutes with no stance at all are an arrival, as M29 made them */
  const toward = applyMutations(led, [{ type: 'offscreen.set', name: 'Claire', location: 'the north road', activity: 'driving back', stance: 'toward', etaMinutes: '45 minutes' }]).state;
  assert(/moving toward the main character, arriving in about 45 minutes/.test(seatNowWords(toward.offscreen.Claire, toward.clock.minutes, { arrival: true })), 'on her way to him: said, with its minutes read from “45 minutes”');
  const bare = applyMutations(led, [{ type: 'offscreen.set', name: 'Claire', location: 'the north road', activity: 'driving', etaMinutes: 20 }]).state;
  assert(/arriving in about 20 minutes/.test(seatNowWords(bare.offscreen.Claire, bare.clock.minutes, { arrival: true })), 'minutes and no stance: an arrival, as before');
});

/* M656 — the ledger audit, part thirteen: the page-keeping worker's and the auditor's whole calls. */
test('M656-1 THE PAGE-KEEPING WORKER, END TO END, WITH EVERYTHING A MODEL GETS WRONG AT ONCE: a field in another case is read; a loose end closes when said as what happened; the same loose end twice is one; a thinner nature is dropped; a new person one letter off another gets her OWN page; a “now” for someone upstairs is not written; a note for “you” is his; a placeholder and a field that does not exist are refused with their reasons', async () => {
  const { scribeTurn } = await import('../../js/agents/scribe.js');
  const { saveState, loadState } = await import('../../js/engine/state.js');
  const { db } = await import('../../js/store.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const rich = 'the ferryman\u2019s niece; quick, proud, counts every coin; will not be pitied';
  const st = applyMutations({ ...emptyState(), page: 12 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Wells house kitchen, 8 Mariner\u2019s Lane' }, { type: 'clock.set', year: 2025, month: 3, day: 3, hour: 21, minute: 40 },
    ...['Jovan', 'Rias', 'Tom', 'Mira'].map((name) => ({ type: 'presence.enter', name })),
    { type: 'people.set', name: 'Rias', field: 'core', text: rich }, { type: 'people.set', name: 'Tom', field: 'core', text: 'his cousin; slow to speak, quick to fix things' },
    { type: 'people.set', name: 'Mina', field: 'core', text: 'the harbourmaster\u2019s daughter; counts everything' }, { type: 'offscreen.set', name: 'Mina', location: 'the harbour office', activity: 'counting tickets' },
    { type: 'people.set', name: 'Aunt Vera', field: 'core', text: 'runs the house' }, { type: 'offscreen.set', name: 'Aunt Vera', location: 'upstairs in the Wells house', activity: 'asleep' },
    { type: 'people.note', name: 'Rias', field: 'thread', text: 'She still owes the ferryman two coppers.' }]).state;
  const story = await db.stories.create({ title: 'the page keeper, end to end ' + Math.random() });
  await saveState(story.id, st);
  const page = '[Wells house kitchen, 8 Mariner\u2019s Lane — Monday, March 3, 2025 | 21:45 | rain | sweater | at the table]\n\nRias counted two coppers into the ferryman\u2019s jar on the sill and did not look at anyone. Tom set the tar bucket by the door. Mira, the ferry pilot, shook rain from her coat and asked for tea.';
  const deltas = [
    { name: 'Rias', field: 'State', text: 'At the sill, paying the ferryman\u2019s jar, not looking at anyone.' },
    { name: 'Rias', field: 'unthread', text: 'She paid the ferryman his two coppers.' },
    { name: 'Rias', field: 'core', text: 'a girl' },
    { name: 'Tom', field: 'state', text: 'By the door, tar bucket at his feet.' },
    { name: 'Tom', field: 'thread', text: 'Means to mend the roof before the storm.' },
    { name: 'Tom', field: 'thread', text: 'He means to mend the roof before the storm' },
    { name: 'Mira', field: 'core', text: 'a ferry pilot from the north shore; blunt, tired, kind' },
    { name: 'Mira', field: 'state', text: 'In the doorway, shaking rain from her coat.' },
    { name: 'Aunt Vera', field: 'state', text: 'In the kitchen, pouring tea.' },
    { name: 'you', field: 'thread', text: 'Still has not told Rias about the letter.' },
    { name: 'NAME', field: 'state', text: 'Standing by.' },
    { name: 'Tom', field: 'mood', text: 'cheerful' }];
  const out = await withHouse(thinkingHouse({ answer: JSON.stringify({ deltas }) }), () => scribeTurn({ connection: HOUSES[0].conn, storyId: story.id, userText: 'I pour the tea.', assistantText: page }));
  const c = (await loadState(story.id)).characters;
  eq(c.Rias.core + ' | ' + c.Rias.state + ' | ' + c.Rias.threads.length, rich + ' | At the sill, paying the ferryman\u2019s jar, not looking at anyone. | 0', 'Rias: who she is stands; her now is written though the field came as “State”; her debt is closed by what happened');
  eq(c.Tom.state + ' | ' + JSON.stringify(c.Tom.threads), 'By the door, tar bucket at his feet. | ["Means to mend the roof before the storm."]', 'Tom: his now, and his loose end once');
  eq(c.Mira.core + ' | ' + c.Mira.state, 'a ferry pilot from the north shore; blunt, tired, kind | In the doorway, shaking rain from her coat.', 'Mira has her own page');
  eq(c.Mina.core + ' | ' + c.Mina.state, 'the harbourmaster\u2019s daughter; counts everything | ', 'and Mina’s is untouched');
  eq(c['Aunt Vera'].state, '', 'no “now” in the kitchen for someone upstairs');
  eq(JSON.stringify(c.Jovan.threads) + ' | ' + c.Jovan.core, '["Still has not told Rias about the letter."] | ', 'a note for “you” is on his record — and nothing defines him');
  const why = out.dropped.map((d) => d.delta.name + '.' + d.delta.field + ': ' + d.why).join(' || ');
  assert(/NAME\.state: “NAME” is a placeholder/.test(why) && /Tom\.mood: “mood” isn’t a page of the ledger/.test(why) && /Rias\.core: who Rias is stands as written/.test(why) && /Tom\.thread: that loose end is already written down/.test(why), 'the run says what it did not write, and why: ' + why);
});

test('M656-2 THE AUDITOR, END TO END, WITH A MESSY ANSWER: a leave and a walk-in backed by the page’s words land (and she is seated where she went); a thread closes in other words; a wound heals by the part it is on; a fault on the pages flagged "true" is kept; “No issues found.” is not a finding; a standing is left to the page reader, as designed', async () => {
  const { auditLedger, saysAllIsWell } = await import('../../js/agents/auditor.js');
  const { saveState, loadState } = await import('../../js/engine/state.js');
  const { seatNowWords } = await import('../../js/engine/offscreen.js');
  const { db } = await import('../../js/store.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const st = applyMutations({ ...emptyState(), page: 2 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Wells house kitchen, 8 Mariner\u2019s Lane' }, { type: 'clock.set', year: 2025, month: 3, day: 3, hour: 21, minute: 40 },
    ...['Jovan', 'Rias', 'Tom', 'Aunt Vera'].map((name) => ({ type: 'presence.enter', name })),
    ...['Rias', 'Tom', 'Aunt Vera', 'Mira'].map((name) => ({ type: 'people.set', name, field: 'core', text: 'someone the story keeps' })),
    { type: 'offscreen.set', name: 'Mira', location: 'the ferry landing', activity: 'tying up' }, { type: 'rel.set', name: 'Rias', p: 30, cause: 'he paid her fare' },
    { type: 'thread.set', title: 'Tom\u2019s promise to fix the roof before the storm', owner: 'Tom', heat: 'hot', next: 'buy the tar' },
    { type: 'body.injure', name: 'Rias', what: 'left forearm cut to the bone', sev: 2, treated: true }]).state;
  const story = await db.stories.create({ title: 'the auditor, end to end ' + Math.random() });
  await db.messages.append(story.id, { role: 'user', text: 'I say goodnight.' });
  await db.messages.append(story.id, { role: 'assistant', text: '[Wells house kitchen, 8 Mariner\u2019s Lane — Monday, March 3, 2025 | 21:45 | rain | sweater | at the table]\n\nAunt Vera set her cup in the sink. “Lock the back door.” She returned to her room, and the house settled. The back door opened and the ferry pilot came in, shaking rain from her coat. Tom mended the last of the roof by lamplight and came down grinning. Rias flexed her healed forearm and laughed at him.' });
  await saveState(story.id, st);
  const issues = [
    { what: 'Aunt Vera went to her room and is still listed in the kitchen', fix: 'take her out', pages: 'false', mutations: [{ type: 'presence.leave', name: 'Aunt Vera', shown: 'She returned to her room', to: 'her room upstairs in the Wells house' }] },
    { what: 'Mira came into the kitchen and is still seated at the landing', fix: 'write her in', pages: false, mutations: [{ type: 'presence.enter', name: 'Mira', shown: 'the ferry pilot came in, shaking rain from her coat' }] },
    { what: 'Tom finished the roof; the thread is still open', fix: 'close it', pages: false, mutations: [{ type: 'thread.close', title: 'Tom promised to fix the roof' }] },
    { what: 'Rias\u2019s forearm has healed on the page; the wound still stands', fix: 'heal it', pages: false, mutations: [{ type: 'body.heal', name: 'Rias', what: 'her forearm' }] },
    { what: 'Rias has warmed to him further than the ledger shows', fix: 'raise it', pages: false, mutations: [{ type: 'rel.shift', name: 'Rias', axis: 'p', delta: '+5 (she laughed with him)', cause: 'she laughed at Tom with him, at ease' }] },
    { what: 'The page says Tom came down from the roof though page 1 has him in the kitchen all evening', fix: 'he went up after supper', pages: 'true', mutations: [] },
    { what: 'No issues found.', fix: '', pages: false, mutations: [] }];
  const out = await withHouse(thinkingHouse({ answer: JSON.stringify({ issues }) }), () => auditLedger({ connection: HOUSES[0].conn, storyId: story.id, brief: '' }));
  const led = await loadState(story.id);
  eq(led.present.map((p) => p.name).join(', '), 'Jovan, Rias, Tom, Mira', 'Aunt Vera is out of the kitchen and Mira is in it');
  eq(seatNowWords(led.offscreen['Aunt Vera'], null) + ' | ' + Boolean(led.offscreen.Mira), 'her room upstairs in the Wells house | false', 'she is seated where she went; Mira’s elsewhere note is let go');
  eq(led.threads.length, 0, 'the roof is closed, though the auditor worded it its own way');
  eq(led.bodies.Rias.injuries.filter((i) => !i.healed).length, 0, 'her forearm is healed, said as “her forearm”');
  eq(led.relationships.Rias.p, 30, 'a standing is not the auditor’s to move (one writer a fact) — left, as designed');
  const said = out.issues.map((i) => i.what);
  assert(said.some((w) => /came down from the roof/.test(w)) && out.issues.find((i) => /came down from the roof/.test(i.what)).pages === true, 'the fault on the pages, flagged "true", is kept as one');
  assert(!said.some((w) => /No issues found/.test(w)), '“No issues found.” is not among the findings: ' + said.join(' || '));
  for (const what of ['No issues found.', 'None', 'Nothing to report', 'The ledger is consistent with the pages.', 'Everything is in order.']) eq(saysAllIsWell({ what, fix: '', mutations: [] }), true, 'finds nothing: ' + what);
  for (const what of ['No page shows Mira leaving the landing', 'The ledger is consistent about the hour but has Tom in two places', 'Nothing explains how the letter left the dresser']) eq(saysAllIsWell({ what, fix: 'set it right', mutations: [] }), false, 'a real issue: ' + what);
});

/* M657 — the ledger audit, part fourteen: the page reader's whole call (walk DOM-239), and the keeper's merge against a refusal. */
test('M657-1 A MERGE THAT IS REFUSED IN WORDS IS NO PROMOTION (M648’s door, at the keeper’s fold): a layer past its size asks for its two oldest lines to be merged — an apology for an answer leaves both lines standing, with nothing of it in the record; a real merged line replaces them, as before', async () => {
  const { maybeSummarize, loadMemory, saveMemory, NOTES_PER_LAYER } = await import('../../js/agents/memory.js');
  const { db } = await import('../../js/store.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const kept = { squeeze: await db.settings.get('memorySqueeze'), keeper: await db.settings.get('memoryKeeper'), window: await db.settings.get('memoryWindow'), batch: await db.settings.get('memoryBatch') };
  await db.settings.set('memorySqueeze', 100); await db.settings.set('memoryKeeper', true); await db.settings.set('memoryWindow', 30); await db.settings.set('memoryBatch', 6);
  const setUp = async (storyId) => {
    for (let i = 0; i < 700; i += 1) await db.messages.append(storyId, { role: i % 2 ? 'assistant' : 'user', text: 'page ' + i, ts: i });
    await saveMemory(storyId, { window: 30, nodes: Array.from({ length: NOTES_PER_LAYER + 1 }, (_, i) => ({ id: 'n' + i, span: [i * 6, i * 6 + 5], text: 'line ' + i + ': ' + 'fact '.repeat(20), level: 1, at: i })) });
  };
  const run = async (storyId, mergeAnswer) => {
    let asks = 0;
    const house = { fetch: async (url, opts) => {
      const body = JSON.parse(opts.body);
      const user = body.messages[body.messages.length - 1].content;
      let answer = '(no new state)';
      if (/being merged into ONE line/.test(user)) { asks += 1; answer = mergeAnswer; }
      else if (/NONE, or one DETAIL/.test(user)) answer = 'NONE';
      return thinkingHouse({ answer }).fetch(url, opts);
    } };
    await withHouse(house, () => maybeSummarize({ connection: HOUSES[0].conn, storyId }));
    return { mem: await loadMemory(storyId), asks };
  };
  try {
    await setUp('m657-refused');
    const refused = await run('m657-refused', 'I’m sorry, but I can’t help with summarizing this content.');
    assert(refused.asks >= 1, 'fixture: the merge was asked for');
    eq(refused.mem.nodes.filter((n) => n.level === 2).length, 0, 'no merged line was made of an apology');
    assert(refused.mem.nodes.some((n) => n.level === 1 && n.text.startsWith('line 0:')) && refused.mem.nodes.some((n) => n.level === 1 && n.text.startsWith('line 1:')), 'both lines it was asked to merge still stand');
    assert(!refused.mem.nodes.some((n) => /sorry|can’t help|summariz/i.test(String(n.text || ''))), 'and nothing of the apology is in the record');
    await setUp('m657-merged');
    const merged = await run('m657-merged', 'line 0 and line 1 merged: ' + 'fact '.repeat(30));
    const l2 = merged.mem.nodes.filter((n) => n.level === 2);
    eq(l2.length + ' | ' + (l2[0] ? l2[0].span.join('-') : ''), '1 | 0-11', 'a real merged line is the promotion, covering both');
    eq(merged.mem.nodes.filter((n) => n.level === 1 && /^line [01]:/.test(n.text)).length, 0, 'and its two sources leave');
  } finally {
    for (const [key, v] of [['memorySqueeze', kept.squeeze], ['memoryKeeper', kept.keeper], ['memoryWindow', kept.window], ['memoryBatch', kept.batch]]) { if (v === undefined) await db.settings.delete(key); else await db.settings.set(key, v); }
  }
});

test('M657-2 THE HEADER AGREES ON WHAT THE HEADER SAYS: in a tale that keeps its own calendar the auditor may bring the clock to the header’s hour (it was refused — a missing year equals nothing); another hour, or a date the header does not give, is still not its to set; a real-dated header is held to whole, as before', async () => {
  const { auditorScope } = await import('../../js/agents/auditor.js');
  const { headerMutations } = await import('../../js/engine/state.js');
  const st = applyMutations({ ...emptyState(), page: 5 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Tenth Division Courtyard' }, { type: 'clock.set', year: 1001, month: 3, day: 5, hour: 8, minute: 0 }, { type: 'presence.enter', name: 'Jovan' }]).state;
  const kept = (page, m) => { const header = headerMutations(page, { ground: st.place.name }); const out = auditorScope([{ what: 'the clock is behind the page', fix: 'set it', pages: false, mutations: [m] }], st, { header, page }); const list = Array.isArray(out) ? out : (out && (out.issues || out.kept)) || []; return Boolean(list[0] && list[0].mutations.length); };
  const own = '[Tenth Division Courtyard — Sunday, Hanami 5, 1001 AG | 09:20 | clear | shihakushō | by the rail]\n\nThe bell rang.';
  const real = '[Tenth Division Courtyard — Monday, March 3, 2025 | 09:20 | clear | shihakushō | by the rail]\n\nThe bell rang.';
  eq(kept(own, { type: 'clock.set', hour: 9, minute: 20 }), true, 'his own calendar: the header’s own hour is the auditor’s to set');
  eq(kept(own, { type: 'clock.set', hour: '9', minute: '20' }), true, 'written as words of figures too');
  eq(kept(own, { type: 'clock.set', hour: 11, minute: 0 }), false, 'another hour is not');
  eq(kept(own, { type: 'clock.set', year: 1001, month: 3, day: 6, hour: 9, minute: 20 }), false, 'nor a date the header does not give');
  eq(kept(real, { type: 'clock.set', year: 2025, month: 3, day: 3, hour: 9, minute: 20 }), true, 'a real-dated header: the same date and hour');
  eq(kept(real, { type: 'clock.set', year: 2025, month: 3, day: 4, hour: 9, minute: 20 }), false, 'another day is not');
  eq(kept(real, { type: 'clock.set', hour: 9, minute: 20 }), false, 'nor the hour alone, where the header gives the whole date (as before)');
});

/* M658 — the ledger audit, part fifteen: the keeper's check of its own lines. */
test('M658-1 A DETAIL THAT SAYS THERE IS NONE IS NONE: “DETAIL: none”, “N/A”, “nothing missing”, “None — the line is complete.” and an apology after the label are not kept beneath a record line; a real detail is, even one that begins with “Nothing”; and a fix is applied only when its wrong words are in the line and its right words in the pages', async () => {
  const { parseAuditAnswer, parseAuditFixes, applyAuditFixes } = await import('../../js/agents/memory.js');
  eq(parseAuditAnswer('DETAIL: the ferry cost forty crowns; Tom is left-handed'), 'the ferry cost forty crowns; Tom is left-handed', 'a real detail is kept');
  eq(parseAuditAnswer('DETAIL: Nothing in the harbour moves without the clerk’s stamp'), 'Nothing in the harbour moves without the clerk’s stamp', 'a real detail that begins with “Nothing”');
  eq(parseAuditAnswer('DETAIL: No one but Rias knows where the key is'), 'No one but Rias knows where the key is', 'and one that begins with “No one”');
  for (const raw of ['NONE', 'DETAIL: none', 'DETAIL: None.', 'DETAIL: N/A', 'DETAIL: nothing missing', 'DETAIL: Nothing to add', 'DETAIL: None — the line is complete.', 'detail: no additional detail', 'DETAIL: no further details needed', 'DETAIL: I’m sorry, but I can’t review this content.', 'I’m sorry, but I can’t help with that.', 'The line is right and complete.', '']) eq(parseAuditAnswer(raw), '', 'no detail: ' + JSON.stringify(raw));
  const line = 'Jovan is seventeen; Rias owes the ferryman two coppers.';
  const pages = 'Jovan, sixteen that spring, watched Rias count two coppers into the jar.';
  eq(applyAuditFixes(line, parseAuditFixes('FIX: seventeen -> sixteen'), pages).text, 'Jovan is sixteen; Rias owes the ferryman two coppers.', 'a fix proven by the line and the pages is made');
  eq(applyAuditFixes(line, parseAuditFixes('FIX: seventeen -> eighteen'), pages).text, line, 'a “fix” the pages do not bear out is not');
  eq(applyAuditFixes(line, parseAuditFixes('I’m sorry, I can’t help with that.'), pages).text, line, 'an apology fixes nothing');
});

/* M659 — the ledger audit, part sixteen: what canon says. */
test('M659-1 THE CANON EXTENSION’S ANSWERS, AS MODELS WRITE THEM: a wrong fact numbered “fact 3” or “#4” is that fact; a verdict “Holds”, “LATER.”, “changed (…)” is its verdict and “statement 3” its statement; “canon”:"true" is a yes and “canon”:"no" a no', async () => {
  const { readClaimsCheck } = await import('../../js/agents/canoncheck.js');
  const { parseLens } = await import('../../js/agents/canonlens.js');
  const { readCanonStart } = await import('../../js/agents/canonstart.js');
  eq(JSON.stringify(readClaimsCheck(JSON.stringify({ wrong: [1, '2', 'fact 3', '#4', '5.', 'none', 9, 0] }), 6).wrong), '[0,1,2,3,4]', 'the five facts it pointed at, however it numbered them; a word, a nine of six and a zero point at none');
  eq(JSON.stringify(readClaimsCheck(JSON.stringify({ wrong: [] }), 6).wrong), '[]', 'none wrong is none wrong');
  eq(readClaimsCheck('I’m sorry, but I can’t check this.', 6), null, 'a refusal is no answer, as before');
  const lens = parseLens(JSON.stringify({ verdicts: [{ n: 1, verdict: 'holds' }, { n: '2', verdict: 'Holds' }, { n: 'statement 3', verdict: 'changed (he was promoted later)', keep: 'a captain' }, { n: 4, verdict: 'LATER.' }, { n: 5, verdict: 'unchanged' }, { n: 6, verdict: 'maybe' }, { n: 'x', verdict: 'holds' }] }));
  eq(lens.map((v) => v.n + ':' + v.verdict).join(' '), '1:holds 2:holds 3:changed 4:later', 'four verdicts read; “unchanged”, “maybe” and a statement with no number are none');
  eq(lens[2].keep, 'a captain', 'and what a changed statement keeps comes with it');
  const start = { series: 'Bleach', arc: 'after the war', moment: 'ten years after the Thousand-Year Blood War', when: 'spring', facts: ['Kyōraku is the Captain-Commander'] };
  for (const canon of [true, 'true', 'Yes', 1]) assert(readCanonStart(JSON.stringify({ canon, ...start })), 'a story in a canon, said ' + JSON.stringify(canon));
  for (const canon of [false, 'false', 'no', 0, 'maybe']) eq(readCanonStart(JSON.stringify({ canon, ...start })), null, 'not one, said ' + JSON.stringify(canon));
});

test('M659-2 THE HOUSEKEEPER’S OPERATIONS AND THE PLANNER’S FLAG, AS MODELS WRITE A YES: a lore card whose “add” is "true" is an add (with “constant”:"yes" kept), one whose “remove” is "true" is a removal — neither is refused or taken for another kind of card', async () => {
  const { stageProposals } = await import('../../js/agents/housekeeper.js');
  const lore = [{ id: 'L1', name: 'The Bluebird Diner', keys: ['Bluebird'], content: 'A diner on Harbor Street.', enabled: true }];
  const staged = stageProposals({ lore: [
    { add: 'true', name: 'The ferry', keys: ['ferry'], content: 'Runs at nine and at five; forty crowns.', constant: 'yes', reason: 'the story keeps asking' },
    { entry: 'The Bluebird Diner', remove: 'true', reason: 'it burned down on page 40' },
    { add: true, name: 'The harbour office', keys: ['harbour office'], content: 'Where the clerk counts the tickets.', reason: 'new place' },
  ] }, { messages: [], state: {}, modules: [], lore, memory: null, session: {}, story: { id: 's1' } });
  const cards = (Array.isArray(staged) ? staged : (staged && (staged.proposals || staged.cards)) || []).filter((c) => c.kind === 'lore');
  eq(cards.length, 3, 'three lore cards');
  eq(cards.map((c) => c.status + ':' + (c.op.add ? 'add' : c.op.remove ? 'remove' : 'other')).join(' '), 'pending:add pending:remove pending:add', 'the add written "true", the removal written "true", and the add written true — each what it was meant to be, none refused');
  eq(cards[0].op.constant, true, 'and “constant”:"yes" is kept');
});

/* M660 — his reports: a fantasy date read as a wrong date; stale clothes and places the auditor kept finding; a line on a
 * phone call credited to the wrong woman. */
test('M660-1 A STORY’S OWN CALENDAR IS ITS DATE: “Hanami 5, 1001 AG”, “Tirdas, 17th of Last Seed, 4E 201”, “Day 47, Year 3 of the Long Winter”, “Hanami 5” after the place, or in a cell of its own — each is the ledger’s day, with the header’s hour; a numbered place is still a place; a real date is read as before', async () => {
  const { headerMutations } = await import('../../js/engine/state.js');
  const R = ' | clear | cloak | by the rail]';
  const run = (headers) => { let st = applyMutations({ ...emptyState() }, [{ type: 'mc.set', name: 'Jovan' }]).state; const out = []; for (const h of headers) { st = applyMutations(st, headerMutations(h + '\n\nShe looked up.', { ground: st.place && st.place.name, day: st.clock && st.clock.dayWords })).state; out.push((st.place ? st.place.name : '—') + ' || ' + st.clock.label); } return out; };
  eq(run(['[Tenth Division Courtyard — Hanami 5, 1001 AG | 09:20' + R, '[Tenth Division Courtyard — Hanami 5, 1001 AG | 18:45' + R, '[Tenth Division Courtyard — Hanami 6, 1001 AG | 07:10' + R]).join(' ## '),
    'Tenth Division Courtyard || Hanami 5, 1001 AG — 09:20 ## Tenth Division Courtyard || Hanami 5, 1001 AG — 18:45 ## Tenth Division Courtyard || Hanami 6, 1001 AG — 07:10', 'no English weekday: his calendar’s own day (it read “Saturday, January 1, 2000”)');
  eq(run(['[Dragonsreach, Whiterun — Tirdas, 17th of Last Seed, 4E 201 | 14:30' + R])[0], 'Dragonsreach, Whiterun || Tirdas, 17th of Last Seed, 4E 201 — 14:30', 'a weekday and a month of its own');
  eq(run(['[The Wall — Day 47, Year 3 of the Long Winter | 06:15' + R])[0], 'The Wall || Day 47, Year 3 of the Long Winter — 06:15', 'a count of days');
  eq(run(['[Tenth Division Courtyard — Hanami 5 | 09:20' + R])[0], 'Tenth Division Courtyard || Hanami 5 — 09:20', 'month and day alone, in his own line “[Place — Date | hour | …]”');
  eq(run(['[Tenth Division Courtyard | Hanami 5, 1001 AG | 09:20' + R])[0], 'Tenth Division Courtyard || Hanami 5, 1001 AG — 09:20', 'the date in a cell of its own');
  eq(run(['[Seireitei — Tenth Division Courtyard — Hanami 5, 1001 AG | 09:20' + R, '[Seireitei — Tenth Division Courtyard — Hanami 6 | 07:10' + R])[1], 'Seireitei — Tenth Division Courtyard || Hanami 6 — 07:10', 'a month the ledger already keeps is known again, in a longer line');
  eq(run(['[Tenth Division Courtyard — Sunday, Hanami 5, 1001 AG | 09:20' + R])[0], 'Tenth Division Courtyard || Sunday, Hanami 5, 1001 AG — 09:20', 'with an English weekday, as before (M455)');
  eq(run(['[Wells house kitchen, 8 Mariner\u2019s Lane — Monday, March 3, 2025 | 21:40' + R])[0], 'Wells house kitchen, 8 Mariner\u2019s Lane || Monday, March 3, 2025 — 21:40', 'a real date, as before');
  for (const h of ['[10th Division HQ — training courtyard | 10:40' + R, '[Harbour District — Pier 7 | 09:20' + R, '[Sector 7 — Reactor Level 2 | 03:00' + R, '[Wayne Tower — Floor 40 | 11:00' + R]) {
    const m = headerMutations(h + '\n\nShe looked up.', {}).find((x) => x.type === 'clock.set');
    assert(m && m.dayWords === undefined, 'a numbered place is not a date: ' + h.slice(0, 40) + ' → ' + JSON.stringify(m));
  }
});

test('M660-2 A LONG JUMP OF THE CLOCK LETS EVERY PLACE-IN-THE-ROOM AND OUTFIT GO, AND THE READER RESTATES THE ROOM: the night’s batsuit is not read as the morning’s; fifteen minutes on, only a real change is written — never the same thing in other words, never words the page does not hold', async () => {
  const { headerMutations } = await import('../../js/engine/state.js');
  const { staleAfterJump } = await import('../../js/engine/apply.js');
  const { extractTurn } = await import('../../js/agents/extractor.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const G = 'Wayne Manor — the stairway bend';
  const night = applyMutations({ ...emptyState(), page: 30 }, [{ type: 'mc.set', name: 'Bruce' }, { type: 'place.set', name: G }, { type: 'clock.set', year: 2027, month: 1, day: 2, hour: 23, minute: 30 },
    { type: 'presence.enter', name: 'Bruce', position: 'at the stairway bend', attire: 'the batsuit, armored, cowl on' }, { type: 'presence.enter', name: 'Barbara', position: 'in the entrance hall, by the door', attire: 'a heavy coat still on' }, { type: 'rel.set', name: 'Barbara', p: 60, cause: 'years' }]).state;
  const room = (s) => s.present.map((p) => p.name + ' (' + [p.position, p.attire].filter(Boolean).join('; ') + ')').join(' | ');
  const reading = (state, page, here) => withHouse(thinkingHouse({ answer: JSON.stringify({ mutations: [{ type: 'mode.snapshot', modes: [] }], resolved: [], here }) }), () => extractTurn({ connection: HOUSES[0].conn, state, userText: 'I wait.', assistantText: page, pageNumber: 31 }));
  /* the morning after */
  const morning = '[Wayne Manor — the stairway bend — Sunday, January 3, 2027 | 09:10 | low winter sun | dark sweater | at the bend]\n\nBarbara stood three steps above the bend in jeans and a dark sweater, her coat hung by the door. Bruce, out of the cowl and armor, wore a dark sweater and the night still written on him.';
  const header = headerMutations(morning, { ground: G });
  const letGo = staleAfterJump(night, header);
  eq(letGo.map((m) => m.name).join(','), 'Bruce,Barbara', 'nine hours on: both are let go of where they stood and what they wore');
  const afterJump = applyMutations(night, [...header, ...letGo]).state;
  eq(room(afterJump), 'Bruce () | Barbara ()', 'nothing stale is left to be read as true');
  /* as the app does it: the reader is handed the ledger as it stood BEFORE the page; the house applies the header, the
   * letting-go, then the reader's writes */
  const read = await reading(night, morning, [{ name: 'Bruce', at: 'at the stairway bend', wears: 'a dark sweater' }, { name: 'Barbara', at: 'three steps above the bend', wears: 'jeans and a dark sweater' }]);
  eq(room(applyMutations(night, [...header, ...letGo, ...read.mutations]).state), 'Bruce (at the stairway bend; a dark sweater) | Barbara (three steps above the bend; jeans and a dark sweater)', 'and the room is as the morning’s page shows it — his place at the bend written again, though it is where he stood the night before');
  /* the same evening */
  const same = '[Wayne Manor — the stairway bend — Saturday, January 2, 2027 | 23:45 | cold | batsuit | at the bend]\n\nAlfred took her coat at the door and hung it. Barbara, in jeans and a dark sweater, stood by the door of the entrance hall. Bruce had not moved from the stairway bend, armored still.';
  eq(staleAfterJump(night, headerMutations(same, { ground: G })).length, 0, 'fifteen minutes on, nothing is let go');
  const read2 = await reading(night, same, [{ name: 'Bruce', at: 'still at the stairway bend', wears: 'armored still' }, { name: 'Barbara', at: 'by the door of the entrance hall', wears: 'jeans and a dark sweater' }, { name: 'Barbara', wears: 'a crown of gold' }, 'Alfred']);
  eq(JSON.stringify(read2.mutations.filter((m) => m.type === 'presence.update')), JSON.stringify([{ type: 'presence.update', name: 'Barbara', attire: 'jeans and a dark sweater' }]), 'only her coat coming off is written: not the same place or the same armour in other words, not a crown the page never showed');
  /* a scene that runs past midnight is not a jump; a ledger with no clock lets nothing go */
  const late = applyMutations(night, [{ type: 'clock.set', year: 2027, month: 1, day: 2, hour: 23, minute: 50 }]).state;
  eq(staleAfterJump(late, [{ type: 'clock.set', year: 2027, month: 1, day: 3, hour: 0, minute: 10 }]).length, 0, 'ten to midnight to ten past: the same scene');
  eq(staleAfterJump({ ...emptyState(), present: [{ name: 'Bruce', attire: 'the batsuit' }] }, [{ type: 'clock.set', hour: 9, minute: 0 }]).length, 0, 'no clock yet: nothing to measure a jump by');
});

test('M660-3 SOMEONE SEATED ELSEWHERE HAS NO “NOW” IN THE ROOM, AND THE WORLD AGENT IS HANDED THE CAST OF THE PAGE: the readers and the auditor are not shown Alfred “in the kitchen” and “in the entrance hall” at once; a phone call’s voices are named as not in the room', async () => {
  const { buildWorldMessages, castFromAfar } = await import('../../js/agents/world.js');
  const { renderWholeLedger } = await import('../../js/engine/whole.js');
  const st = applyMutations({ ...emptyState(), page: 30 }, [{ type: 'mc.set', name: 'Bruce Wayne' }, { type: 'place.set', name: 'The Batcave — the main console' }, { type: 'clock.set', year: 2027, month: 1, day: 2, hour: 23, minute: 30 },
    { type: 'presence.enter', name: 'Bruce Wayne' }, { type: 'presence.enter', name: 'Barbara Gordon' }, { type: 'presence.enter', name: 'Alfred Pennyworth' },
    ...['Barbara Gordon', 'Clark Kent', 'Kara Zor-El', 'Alfred Pennyworth', 'Dick Grayson'].map((name) => ({ type: 'people.set', name, field: 'core', text: 'keeps faith with the cave' })),
    { type: 'people.set', name: 'Alfred Pennyworth', field: 'state', text: 'In the entrance hall below the bend, coat over his arm.' }, { type: 'people.set', name: 'Barbara Gordon', field: 'state', text: 'Leaning on the console beside him.' },
    { type: 'offscreen.set', name: 'Clark Kent', location: 'the Kent apartment, Metropolis', activity: 'washing up' }, { type: 'offscreen.set', name: 'Kara Zor-El', location: 'the Kent apartment, Metropolis', activity: 'on the couch' },
    { type: 'offscreen.set', name: 'Dick Grayson', location: 'Blüdhaven', activity: 'on patrol' },
    { type: 'presence.leave', name: 'Alfred Pennyworth', to: 'the Wayne Manor kitchen, at the blue pot on the stove', doing: 'ladling broth' }]).state;
  const whole = renderWholeLedger(st);
  assert(/Alfred Pennyworth — the Wayne Manor kitchen, at the blue pot on the stove/.test(whole), 'his seat is shown');
  /* the people's pages as the auditor (and the housekeeper) are shown them */
  const { leanPage, nearNames } = await import('../../js/engine/whole.js');
  const names = nearNames(st);
  const alfred = leanPage(names, 'Alfred Pennyworth', st.characters['Alfred Pennyworth'], 0);
  eq(alfred.state + ' | ' + alfred.core, ' | keeps faith with the cave', 'the “now” he had in the room is not shown beside his seat; who he is, is');
  eq(st.characters['Alfred Pennyworth'].state, 'In the entrance hall below the bend, coat over his arm.', '(it is still kept on his page — only not shown as where he is)');
  eq(leanPage(names, 'Barbara Gordon', st.characters['Barbara Gordon'], 0).state, 'Leaning on the console beside him.', 'someone in the room keeps her “now”');
  const page = '[The Batcave — the main console — Saturday, January 2, 2027 | 23:35 | cold | batsuit | at the console]\n\nBruce thumbed the speaker. Barbara leaned on the console beside him, close enough to hear. “Clark.” A pause on the line, then a second voice behind his, bright and nosy: “Is that Bruce?” Kara, somewhere in the Metropolis apartment. Barbara’s mouth twitched.';
  eq(castFromAfar(st, page).join(', '), 'Clark Kent, Kara Zor-El', 'named on the page, not in the room — not Dick, whom the page does not name, nor Alfred');
  const told = buildWorldMessages({ state: st, userText: 'I call Clark.', assistantText: page, before: [] }).user;
  assert(/THE CAST OF THIS PAGE\. In the room: Bruce Wayne, Barbara Gordon\. NOT in the room, though the page names them[^\n]*: Clark Kent, Kara Zor-El\./.test(told), 'the world agent is handed who is in the room and who is only a voice');
  assert(/never credit one person with another’s words|never credit one person with another's words/.test(told), 'and told whose a line is before it writes of it');
  const quiet = buildWorldMessages({ state: st, userText: 'I wait.', assistantText: '[The Batcave — the main console — Saturday, January 2, 2027 | 23:40 | cold | batsuit | at the console]\n\nBarbara said nothing.', before: [] }).user;
  assert(!/THE CAST OF THIS PAGE/.test(quiet), 'a page that names nobody from afar says nothing of the kind');
});

/* M661 — the same audit of his, two repairs more: the header's own cells for the main character; the auditor's own repair. */
test('M661-1 THE MAIN CHARACTER’S DRESS AND PLACE ARE READ FROM THE HEADER’S OWN CELLS when the page’s telling bears them out — with a reader that names the room and says no more; never from a cell the telling does not bear out, never the same thing in other words', async () => {
  const { headerDress } = await import('../../js/engine/state.js');
  const { headerMutations } = await import('../../js/engine/state.js');
  const { staleAfterJump } = await import('../../js/engine/apply.js');
  const { extractTurn } = await import('../../js/agents/extractor.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  eq(JSON.stringify(headerDress('[Wayne Manor — the stairway bend — Sunday, January 3, 2027 | 09:10 | low winter sun | dark sweater | at the bend]\n\nx')), JSON.stringify({ attire: 'dark sweater', position: 'at the bend' }), 'the fourth and fifth cells of his header');
  eq(headerDress('[Wayne Manor — Sunday, January 3, 2027 | 09:10 | low winter sun]\n\nx'), null, 'a header of three cells has none');
  eq(headerDress('[Wayne Manor — Sunday, January 3, 2027 | 09:10 | sun | — | —]\n\nx'), null, 'dashes are no dress');
  const G = 'Wayne Manor — the stairway bend';
  const night = applyMutations({ ...emptyState(), page: 30 }, [{ type: 'mc.set', name: 'Bruce' }, { type: 'place.set', name: G }, { type: 'clock.set', year: 2027, month: 1, day: 2, hour: 23, minute: 30 },
    { type: 'presence.enter', name: 'Bruce', position: 'at the stairway bend', attire: 'the batsuit, armored, cowl on' }, { type: 'presence.enter', name: 'Barbara' }, { type: 'rel.set', name: 'Barbara', p: 60, cause: 'years' }]).state;
  const bruce = async (page) => {
    const read = await withHouse(thinkingHouse({ answer: JSON.stringify({ mutations: [{ type: 'mode.snapshot', modes: [] }], resolved: [], here: ['Bruce', 'Barbara'] }) }), () => extractTurn({ connection: HOUSES[0].conn, state: night, userText: 'I wait.', assistantText: page, pageNumber: 31 }));
    const header = headerMutations(page, { ground: G });
    const p = applyMutations(night, [...header, ...staleAfterJump(night, header), ...read.mutations]).state.present.find((x) => x.name === 'Bruce');
    return [p.position, p.attire].filter(Boolean).join('; ');
  };
  eq(await bruce('[Wayne Manor — the stairway bend — Sunday, January 3, 2027 | 09:10 | low winter sun | dark sweater | at the bend]\n\nBarbara stood three steps above the bend. Bruce, out of the cowl and armor, wore a dark sweater and the night still written on him.'), 'at the bend; dark sweater', 'the morning after: his header’s cells, borne out by the telling — the reader said nothing of him');
  eq(await bruce('[Wayne Manor — the stairway bend — Saturday, January 2, 2027 | 23:45 | cold | dark sweater | at the bend]\n\nBarbara waited. Bruce had not moved, armored still.'), 'at the stairway bend; the batsuit, armored, cowl on', 'a cell the telling does not bear out (“dark sweater” while the page says armored) changes nothing');
  eq(await bruce('[Wayne Manor — the stairway bend — Saturday, January 2, 2027 | 23:45 | cold | the batsuit | at the bend]\n\nBarbara waited. Bruce stood at the bend in the batsuit.'), 'at the stairway bend; the batsuit, armored, cowl on', 'the same dress and place in other words is no change');
});

test('M661-2 THE AUDITOR CAN SET A PLACE OR AN OUTFIT RIGHT ITSELF, HELD TO THE NEWEST PAGE: “still in a heavy coat” against a page that shows jeans and a dark sweater is repaired by its own change; words the page does not hold are refused, as before', async () => {
  const { auditLedger } = await import('../../js/agents/auditor.js');
  const { saveState, loadState } = await import('../../js/engine/state.js');
  const { db } = await import('../../js/store.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const run = async (update) => {
    const story = await db.stories.create({ title: 'her coat ' + Math.random() });
    await db.messages.append(story.id, { role: 'user', text: 'I look up.' });
    await db.messages.append(story.id, { role: 'assistant', text: '[Wayne Manor — the stairway bend — Sunday, January 3, 2027 | 09:10 | low winter sun | dark sweater | at the bend]\n\nBarbara stood three steps above the bend in jeans and a dark sweater, her coat hung by the door.' });
    await saveState(story.id, applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Bruce' }, { type: 'place.set', name: 'Wayne Manor — the stairway bend' }, { type: 'presence.enter', name: 'Bruce' }, { type: 'presence.enter', name: 'Barbara', position: 'in the entrance hall, by the door', attire: 'a heavy coat still on' }]).state);
    const answer = JSON.stringify({ issues: [{ what: 'the presence list still has Barbara in a heavy coat; the latest page shows her coat hung and her in jeans and a dark sweater', fix: 'her dress and place as the page shows them', pages: false, mutations: [update] }] });
    await withHouse(thinkingHouse({ answer }), () => auditLedger({ connection: HOUSES[0].conn, storyId: story.id, brief: '' }));
    const p = (await loadState(story.id)).present.find((x) => x.name === 'Barbara');
    return [p.position, p.attire].filter(Boolean).join('; ');
  };
  eq(await run({ type: 'presence.update', name: 'Barbara', position: 'three steps above the bend', attire: 'jeans and a dark sweater' }), 'three steps above the bend; jeans and a dark sweater', 'the auditor’s own change lands: her place and her dress as the newest page shows them');
  eq(await run({ type: 'presence.update', name: 'Barbara', attire: 'a ballgown and a tiara' }), 'in the entrance hall, by the door; a heavy coat still on', 'a dress the page does not show is not written');
});

/* M662 — his: "once it's mentioned anatomy or appearance it should be saved because sometimes I see it's missing". */
test('M662-1 HOW SOMEONE LOOKS, ONCE A PAGE SHOWS IT, IS KEPT: hair, a scar, a height, anatomy the page (or his own message) shows are locked among what is true of that person — never over a truth already written, never dress or mood, never words the page does not hold, never a face the story does not know', async () => {
  const { extractTurn } = await import('../../js/agents/extractor.js');
  const { renderCanon } = await import('../../js/engine/canon.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const st = applyMutations({ ...emptyState(), page: 12 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Wells house kitchen' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rias' }, { type: 'presence.enter', name: 'Tom' },
    { type: 'people.set', name: 'Rias', field: 'core', text: 'the ferryman’s niece' }, { type: 'people.set', name: 'Mira', field: 'core', text: 'a ferry pilot' }, { type: 'offscreen.set', name: 'Mira', location: 'the landing', activity: 'tying up' },
    { type: 'canon.lock', name: 'Rias', key: 'eyes', value: 'grey' }]).state;
  const page = '[Wells house kitchen — Monday, March 3, 2025 | 21:45 | rain | sweater | at the table]\n\nRias pushed her copper hair, cut to the jaw, behind one ear; a thin white scar ran through her left eyebrow. She was a head shorter than Jovan, broad in the shoulder from the oars, and she was furious, in her blue apron. Her green eyes did not leave him.\n\nTom kept his back to the stove and said nothing.';
  const looks = [
    { name: 'Rias', key: 'hair', value: 'copper, cut to the jaw' },
    { name: 'Rias', key: 'scar', value: 'a thin white scar through her left eyebrow' },
    { name: 'Rias', key: 'build', value: 'a head shorter than Jovan, broad in the shoulder from the oars' },
    { name: 'Rias', key: 'eyes', value: 'green' },                                   /* already written as grey: never written over */
    { name: 'Rias', key: 'outfit', value: 'a blue apron' },                            /* dress has its own place */
    { name: 'Rias', key: 'mood', value: 'furious' },                                   /* so has a mood */
    { name: 'Rias', key: 'tattoo', value: 'a black anchor on her wrist' },             /* not on the page */
    { name: 'The ferryman', key: 'beard', value: 'copper' },                           /* nobody the story knows */
    { name: 'Jovan', key: 'height', value: 'six foot one, lean' },                     /* his own message says so */
    { name: 'Mira', key: 'hair', value: 'copper, cut to the jaw' },                    /* known to the story, but the paragraph that shows it is about Rias */
    { name: 'Tom', key: 'eyes', value: 'green' },                                      /* in the room, named elsewhere on the page — the paragraph with green eyes is hers */
  ];
  const read = await withHouse(thinkingHouse({ answer: JSON.stringify({ mutations: [{ type: 'mode.snapshot', modes: [] }], resolved: [], here: ['Jovan', 'Rias'], looks }) }), () => extractTurn({ connection: HOUSES[0].conn, state: st, userText: 'I stand — six foot one, lean — and look down at her.', assistantText: page, pageNumber: 13 }));
  const locks = read.mutations.filter((m) => m.type === 'canon.lock').map((m) => m.name + ' — ' + m.key + ': ' + m.value);
  eq(locks.filter((l) => /^Rias/.test(l)).join(' | '), 'Rias — hair: copper, cut to the jaw | Rias — scar: a thin white scar through her left eyebrow | Rias — build: a head shorter than Jovan, broad in the shoulder from the oars', 'her hair, her scar and her build are kept; her eyes (already grey), her apron, her mood and a tattoo the page never showed are not');
  assert(locks.includes('Jovan — height: six foot one, lean'), 'what he says of his own character in his message is kept: ' + locks.join(' | '));
  assert(!locks.some((l) => /ferryman/i.test(l)), 'nobody the story does not know');
  assert(!locks.some((l) => /^Mira|^Tom/.test(l)), 'and never one person’s looks under another’s name — the paragraph that shows them names Rias: ' + locks.join(' | '));
  const led = applyMutations(st, read.mutations).state;
  eq(led.canon.Rias.facts.find((f) => f.key === 'eyes').value, 'grey', 'the truth already written stands');
  assert(/Rias — eyes: grey; hair: copper, cut to the jaw; scar: a thin white scar through her left eyebrow; build:/.test(renderCanon(led.canon, ['Jovan', 'Rias'])), 'and it is told to the storyteller for who is in the scene: ' + renderCanon(led.canon, ['Jovan', 'Rias']));
  assert(!/Mira/.test(renderCanon(led.canon, ['Jovan', 'Rias'])), 'never for someone who is not');
  /* the same page read again writes nothing twice */
  const again = await withHouse(thinkingHouse({ answer: JSON.stringify({ mutations: [{ type: 'mode.snapshot', modes: [] }], resolved: [], here: ['Jovan', 'Rias'], looks }) }), () => extractTurn({ connection: HOUSES[0].conn, state: led, userText: 'I stand — six foot one, lean — and look down at her.', assistantText: page, pageNumber: 13 }));
  eq(again.mutations.filter((m) => m.type === 'canon.lock').length, 0, 'a second reading locks nothing again');
});

test('M662-2 SMART, NOT BLOATED (his: “knows what to inject, what to rotate”): what someone in the scene has on them is told however long ago it was touched, while a far-away stranger’s old trinket is not; a person’s truths beyond the six that fit take their turn page by page — every one reaches the storyteller, and no page carries more than six', async () => {
  const { renderThings } = await import('../../js/engine/state.js');
  const { renderCanon } = await import('../../js/engine/canon.js');
  let st = applyMutations({ ...emptyState(), page: 10 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Wells house kitchen' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rias' },
    { type: 'people.set', name: 'Rias', field: 'core', text: 'the ferryman’s niece' }, { type: 'people.set', name: 'Claire', field: 'core', text: 'drives the north road' }, { type: 'offscreen.set', name: 'Claire', location: 'the north road', activity: 'driving' },
    { type: 'thing.set', name: 'the sealed letter from the bank', where: 'in Rias’s apron pocket', owner: 'Rias' },
    { type: 'thing.set', name: 'the brass compass', where: 'in the glovebox of Claire’s truck', owner: 'Claire' },
    { type: 'thing.set', name: 'the spare oar', where: 'the boathouse loft', owner: 'Tom' },
    { type: 'thing.set', name: 'the bread knife', where: 'Wells house kitchen, on the board' }]).state;
  st = { ...st, page: 80 }; /* seventy pages on: nothing of these was touched since */
  const told = renderThings(st);
  assert(/the bread knife/.test(told), 'what lies at this place is told');
  assert(/the sealed letter from the bank \(Rias’s\) — in Rias’s apron pocket/.test(told), 'what Rias has on her is told while she stands in the room: ' + told);
  assert(!/brass compass/.test(told) && !/spare oar/.test(told), 'what belongs to people far away, untouched for seventy pages, is not');
  /* her looks: eight written, six told a page, all told within a few pages */
  const facts = [['hair', 'copper, cut to the jaw'], ['eyes', 'grey-green'], ['build', 'broad in the shoulder'], ['height', 'a head shorter than Jovan'], ['scar', 'through the left eyebrow'], ['voice', 'low, a little hoarse'], ['hands', 'rope-burned palms'], ['tattoo', 'an anchor inside the wrist']];
  const canon = applyMutations(st, facts.map(([key, value]) => ({ type: 'canon.lock', name: 'Rias', key, value }))).state.canon;
  const seen = new Set();
  for (let turn = 80; turn < 86; turn += 1) {
    const line = renderCanon(canon, ['Jovan', 'Rias'], undefined, turn);
    const keys = facts.map(([k]) => k).filter((k) => new RegExp('(?:— |; )' + k + ': ').test(line));
    eq(keys.length, 6, 'six a page, never more (page ' + turn + '): ' + line);
    for (const k of ['hair', 'eyes', 'build', 'height']) assert(keys.includes(k), 'the first four every page: ' + k);
    for (const k of keys) seen.add(k);
  }
  eq([...seen].sort().join(','), facts.map(([k]) => k).sort().join(','), 'and every one of the eight was told within six pages (the seventh and eighth were never told before)');
  eq(renderCanon(canon, ['Jovan', 'Rias']).split('; ').length, 6, 'with no page number it is the first six, as before');
  eq(renderCanon(canon, ['Jovan']), '', 'and nothing of someone who is not in the scene');
});

/* M663 — the audit he asked for ("auditor is final defense, not necessary defense"): the auditor's checklist, each kind held
 * against who is asked first. */
test('M663-1 THE OPEN WOUNDS ARE HANDED TO THE PAGE READER BY NAME, EACH TO BE DECIDED: the wounds of the people of this page (in the scene, or named on it) are listed; the ones it answers as healed are healed on that page — not left for the auditor; a wound the page does not touch stays; nobody else’s is asked about', async () => {
  const { extractTurn, buildExtractorMessages, openWoundsBlock } = await import('../../js/agents/extractor.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const st = applyMutations({ ...emptyState(), page: 12 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Wells house kitchen' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rias' },
    ...['Rias', 'Tom', 'Mira'].map((name) => ({ type: 'people.set', name, field: 'core', text: 'someone the story keeps' })),
    { type: 'offscreen.set', name: 'Tom', location: 'the boathouse', activity: 'mending nets' }, { type: 'offscreen.set', name: 'Mira', location: 'the landing', activity: 'tying up' },
    { type: 'body.injure', name: 'Rias', what: 'left forearm cut to the bone', sev: 2, treated: true }, { type: 'body.injure', name: 'Rias', what: 'a split lip', sev: 1 },
    { type: 'body.injure', name: 'Tom', what: 'a cracked rib', sev: 2 }, { type: 'body.injure', name: 'Mira', what: 'a burned hand', sev: 1 }]).state;
  const page = '[Wells house kitchen — Monday, March 24, 2025 | 21:45 | rain | sweater | at the table]\n\nThree weeks on, Rias flexed her forearm — healed to a pale seam — and laughed. Somewhere out on the landing Mira was still swearing at the ropes.';
  const block = openWoundsBlock(st, page).join('\n');
  assert(/OPEN WOUNDS — decide each against THIS page/.test(block) && /Rias — left forearm cut to the bone \(treated\)/.test(block) && /Rias — a split lip/.test(block) && /Mira — a burned hand/.test(block), 'the wounds of who is here, and of who the page names: ' + block);
  assert(!/Tom/.test(block), 'never of someone the page does not touch');
  assert(/OPEN WOUNDS — decide each/.test(buildExtractorMessages({ state: st, userText: 'I watch her.', assistantText: page }).user), 'and it rides in what the page reader is sent');
  eq(openWoundsBlock(applyMutations(st, [{ type: 'body.heal', name: 'Rias', what: 'left forearm cut to the bone' }, { type: 'body.heal', name: 'Rias', what: 'a split lip' }, { type: 'body.heal', name: 'Mira', what: 'a burned hand' }]).state, page).length, 0, 'no open wound on this page’s people: nothing is asked');
  const read = await withHouse(thinkingHouse({ answer: JSON.stringify({ mutations: [{ type: 'mode.snapshot', modes: [] }, { type: 'body.heal', name: 'Rias', what: 'left forearm cut to the bone' }], resolved: [], healed: [{ name: 'Rias', what: 'left forearm cut to the bone' }, { name: 'Rias', what: 'her split lip' }], here: ['Jovan', 'Rias'] }) }), () => extractTurn({ connection: HOUSES[0].conn, state: st, userText: 'I watch her.', assistantText: page, pageNumber: 13 }));
  eq(read.mutations.filter((m) => m.type === 'body.heal').map((m) => m.name + ': ' + m.what).join(' | '), 'Rias: left forearm cut to the bone | Rias: her split lip', 'each wound it answered is one healing — the forearm, said twice, once');
  const led = applyMutations(st, read.mutations).state;
  eq(led.bodies.Rias.injuries.filter((i) => !i.healed).length + ' | ' + led.bodies.Mira.injuries.filter((i) => !i.healed).length + ' | ' + led.bodies.Tom.injuries.filter((i) => !i.healed).length, '0 | 1 | 1', 'Rias is whole on the page that showed it; Mira’s hand and Tom’s rib stand');
});

/* M664 — his: "so the ledger is compatible in very long play?" — measured at the size of a 2,000-page tale. */
test('M664-1 A WORKER’S VIEW FITS ITS ROOM IN A VERY LONG TALE: a hundred people who each know thirty things — a worker of 64,000 tokens is sent a page reader’s, a world agent’s and an auditor’s request it can hold (they were past it), the people in the scene keeping their twelve lines and the absent shown fewer, each counted; a worker with room to spare is shown exactly what it was', async () => {
  const { renderAllKnowledge, knowledgeRoomFor, ALL_KNOWLEDGE_ROOM } = await import('../../js/engine/whole.js');
  const { roomChars } = await import('../../js/engine/pagecut.js');
  const { buildExtractorMessages } = await import('../../js/agents/extractor.js');
  const { buildWorldMessages } = await import('../../js/agents/world.js');
  const { buildAuditorMessages } = await import('../../js/agents/auditor.js');
  const syl = ['ka', 'ri', 'to', 'me', 'su', 'na', 'vo', 'li', 'de', 'ra'];
  const names = Array.from({ length: 100 }, (_, i) => { const w = syl[i % 10] + syl[Math.floor(i / 10) % 10] + 'n' + syl[(i * 3 + 1) % 10]; return w[0].toUpperCase() + w.slice(1); });
  eq(new Set(names).size, 100, 'fixture: a hundred different people');
  const knowledge = Object.fromEntries(names.map((n, i) => [n, Array.from({ length: 30 }, (_, k) => ({ fact: 'that matter number ' + k + ' of the harbour office and its ferry tickets came to person ' + i + ' in the autumn', atTurn: k }))]));
  const here = names.slice(0, 6);
  const linesOf = (text, n) => { const line = text.split('\n').find((l) => l.startsWith(n + ' ') || l.startsWith(n + ' (')); return line ? (line.match(/that matter number/g) || []).length : -1; };
  /* as it always was: the room is 60,000 and the cap stops at twelve a person — a hundred people overflow it */
  const before = renderAllKnowledge(knowledge, here);
  assert(before.length > ALL_KNOWLEDGE_ROOM * 1.5 && names.every((n) => linesOf(before, n) === 12), 'unfitted: twelve lines for every one of a hundred people, ' + before.length + ' characters');
  /* fitted to a small worker's room */
  const fitted = renderAllKnowledge(knowledge, here, undefined, { fitRoom: 60000 });
  assert(fitted.length <= 60000, 'fitted, it is within its room: ' + fitted.length);
  assert(here.every((n) => linesOf(fitted, n) === 12), 'the people in the scene keep their twelve');
  const away = names.slice(6).map((n) => linesOf(fitted, n));
  assert(away.every((c) => c >= 0 && c < 12) && new Set(away).size === 1, 'the absent are shown fewer, all alike: ' + [...new Set(away)].join(','));
  assert(names.slice(6).every((n) => /already known; never write them again/.test(fitted.split('\n').find((l) => l.startsWith(n + ' ')))), 'and each line says the rest are already known');
  const tight = renderAllKnowledge(knowledge, here, undefined, { fitRoom: 12000 });
  assert(/ knows 30 things — already known; never write them again \(look them up by name/.test(tight) && here.every((n) => linesOf(tight, n) === 12), 'tighter still: the absent are counted only; the scene keeps its lines');
  eq(renderAllKnowledge(knowledge, here, undefined, { fitRoom: 5000000 }), before, 'a worker with room to spare is shown exactly what it was — never more');
  eq(knowledgeRoomFor(roomChars({ type: 'openai', model: 'x', contextSize: 64000 }, 6000)) + ' / ' + knowledgeRoomFor(roomChars({ type: 'openai', model: 'x', contextSize: 1000000 }, 6000)) + ' / ' + knowledgeRoomFor(NaN), '60000 / 744000 / 60000', 'the room for it comes from the worker’s own connection');
  /* and the three requests themselves, for a 64k worker */
  const st = applyMutations({ ...emptyState(), page: 2000 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Wells house kitchen' }, { type: 'presence.enter', name: 'Jovan' }, ...here.map((name) => ({ type: 'presence.enter', name }))]).state;
  st.knowledge = knowledge;
  const room = roomChars({ type: 'openai', model: 'x', contextSize: 64000 }, 6000);
  const page = '[Wells house kitchen — Monday, March 3, 2025 | 21:45 | rain | sweater | at the table]\n\n' + here[0] + ' stirred the pot.';
  const size = (m) => m.system.length + m.user.length;
  const kr = knowledgeRoomFor(room);
  const sizes = {
    reader: [size(buildExtractorMessages({ state: st, userText: 'I wait.', assistantText: page, pageNumber: 2001 })), size(buildExtractorMessages({ state: st, userText: 'I wait.', assistantText: page, pageNumber: 2001, knowledgeRoom: kr }))],
    world: [size(buildWorldMessages({ state: st, userText: 'I wait.', assistantText: page, pageNumber: 2001 })), size(buildWorldMessages({ state: st, userText: 'I wait.', assistantText: page, pageNumber: 2001, knowledgeRoom: kr }))],
    auditor: [size(buildAuditorMessages({ state: st, brief: '', pages: [], index: [], pageCount: 2001 })), size(buildAuditorMessages({ state: st, brief: '', pages: [], index: [], pageCount: 2001, room }))],
  };
  for (const [who, [was, now]] of Object.entries(sizes)) assert(now < was && now <= room * 0.6, 'the ' + who + '’s request for a 64k worker: ' + now + ' characters (it was ' + was + '); its room is ' + room);
});

/* M665 — his: "can it be done smartly, safely and autonomous or not?" (the old damage I had said the house does not repair). */
test('M665-1 TWO PEOPLE WRITTEN AS ONE ARE PARTED WHEN THE STORY IS OPENED: what the journal shows was written for “Lara” and still stands, in the same words, on Kara’s page — her nature, a loose end, what she knows, what is true of her, a wound, her seat — goes to a page of her own, and Kara’s own nature is put back; a single slip, a name written once, and anything rewritten since are left alone; a second opening changes nothing', async () => {
  const { partLookAlikes } = await import('../../js/engine/people.js');
  const { saveState, loadState } = await import('../../js/engine/state.js');
  /* the ledger as the old slip-rule left it: what was written for Lara landed on Kara's page; the journal kept her name */
  const asWritten = (st, page, muts, forName) => {
    const before = st.journal.length;
    const r = applyMutations({ ...st, page }, muts.map((m) => (forName ? { ...m, name: 'Kara' } : m)));
    if (forName) r.state.journal.slice(before).forEach((e) => { if (e.m && e.m.name === 'Kara') e.m.name = forName; });
    return r.state;
  };
  let st = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Bruce' }, { type: 'place.set', name: 'The Batcave' }, { type: 'presence.enter', name: 'Bruce' }]).state;
  st = asWritten(st, 2, [{ type: 'people.set', name: 'Kara', field: 'core', text: 'Supergirl; bright, nosy, quick to laugh' }, { type: 'rel.set', name: 'Kara', p: 40, cause: 'years of trust' }, { type: 'canon.lock', name: 'Kara', key: 'hair', value: 'blonde, long' }]);
  st = asWritten(st, 3, [{ type: 'knowledge.add', name: 'Kara', fact: 'that Bruce called Clark at midnight' }, { type: 'people.note', name: 'Kara', field: 'thread', text: 'Wants to know why Bruce called.' }]);
  st = asWritten(st, 4, [{ type: 'people.set', name: 'Kara', field: 'core', text: 'Clark’s mother; calm, exact, a scientist of Krypton' }, { type: 'knowledge.add', name: 'Kara', fact: 'that the crystal holds Jor-El’s last message' }, { type: 'canon.lock', name: 'Kara', key: 'eyes', value: 'dark brown' }], 'Lara');
  st = asWritten(st, 5, [{ type: 'people.note', name: 'Kara', field: 'thread', text: 'Means to tell Clark about the crystal.' }, { type: 'body.injure', name: 'Kara', what: 'a burned left hand', sev: 1 }, { type: 'offscreen.set', name: 'Kara', location: 'the Fortress archive', activity: 'reading the crystal' }], 'Lara');
  eq(st.characters.Kara.core + ' | ' + Boolean(st.characters.Lara), 'Clark’s mother; calm, exact, a scientist of Krypton | false', 'fixture: Lara’s nature stands on Kara’s page and Lara has none');
  const healed = partLookAlikes(JSON.parse(JSON.stringify(st)));
  eq(healed.characters.Lara.core + ' | ' + JSON.stringify(healed.characters.Lara.threads), 'Clark’s mother; calm, exact, a scientist of Krypton | ["Means to tell Clark about the crystal."]', 'Lara has her own page: her nature and her loose end');
  eq(healed.characters.Kara.core + ' | ' + JSON.stringify(healed.characters.Kara.threads), 'Supergirl; bright, nosy, quick to laugh | ["Wants to know why Bruce called."]', 'Kara’s own nature is put back, and her own loose end stays');
  eq(JSON.stringify((healed.knowledge.Lara || []).map((k) => k.fact)) + ' | ' + JSON.stringify((healed.knowledge.Kara || []).map((k) => k.fact)), '["that the crystal holds Jor-El’s last message"] | ["that Bruce called Clark at midnight"]', 'each knows what was written for her');
  eq(healed.canon.Lara.facts.map((f) => f.key + ': ' + f.value).join('; ') + ' | ' + healed.canon.Kara.facts.map((f) => f.key + ': ' + f.value).join('; '), 'eyes: dark brown | hair: blonde, long', 'each has her own looks');
  eq((healed.bodies.Lara.injuries || []).map((i) => i.what).join() + ' | ' + ((healed.bodies.Kara && healed.bodies.Kara.injuries) || []).length, 'a burned left hand | 0', 'the wound is Lara’s');
  eq(healed.offscreen.Lara.location + ' | ' + Boolean(healed.offscreen.Kara), 'the Fortress archive | false', 'the seat written last was hers; Kara has none (the world agent is asked for it by name)');
  eq(healed.relationships.Kara.p + ' | ' + Boolean(healed.relationships.Lara), '40 | false', 'the standing is not parted — Kara keeps her number, Lara is asked for on her next page');
  eq(JSON.stringify(healed.parted.map((p) => p.from + '→' + p.to)), '["Kara→Lara"]', 'and the state says who was parted');
  const again = partLookAlikes(JSON.parse(JSON.stringify(healed)));
  eq(JSON.stringify(again.characters) + JSON.stringify(again.knowledge) + JSON.stringify(again.canon), JSON.stringify(healed.characters) + JSON.stringify(healed.knowledge) + JSON.stringify(healed.canon), 'a second opening changes nothing');
  /* through the door a story is really opened by */
  await saveState('m665-parted', st);
  const opened = await loadState('m665-parted');
  eq(Boolean(opened.characters.Lara) + ' | ' + opened.characters.Kara.core, 'true | Supergirl; bright, nosy, quick to laugh', 'it happens when the story is opened');
  /* left alone: a name written on one page only; a long name's slip; something rewritten since */
  let once = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Bruce' }]).state;
  once = asWritten(once, 2, [{ type: 'people.set', name: 'Kara', field: 'core', text: 'Supergirl; bright, nosy' }]);
  once = asWritten(once, 3, [{ type: 'people.note', name: 'Kara', field: 'thread', text: 'Wants to know why.' }]);
  once = asWritten(once, 4, [{ type: 'people.set', name: 'Kara', field: 'arc', text: 'Came to trust him.' }], 'Lara');
  eq(Boolean(partLookAlikes(JSON.parse(JSON.stringify(once))).characters.Lara), false, 'a name the workers wrote on one page only is a slip, not a second person');
  let rewritten = asWritten(st, 6, [{ type: 'people.set', name: 'Kara', field: 'core', text: 'Supergirl; bright, nosy, quick to laugh — and worried for Bruce' }]);
  const kept = partLookAlikes(JSON.parse(JSON.stringify(rewritten)));
  eq(kept.characters.Kara.core + ' | ' + (kept.characters.Lara ? kept.characters.Lara.core : 'no page'), 'Supergirl; bright, nosy, quick to laugh — and worried for Bruce | ', 'a nature rewritten since is left as it is (and Lara’s page, made from the rest, has none yet)');
  let long = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Bruce' }]).state;
  for (const [page, name] of [[2, 'Barbara'], [3, 'Barbara'], [4, 'Barbra'], [5, 'Barbra']]) long = applyMutations({ ...long, page }, [{ type: 'people.note', name, field: 'thread', text: 'Loose end of page ' + page + '.' }]).state;
  eq(Object.keys(partLookAlikes(JSON.parse(JSON.stringify(long))).characters).join(), 'Barbara', 'a slip in a long name is one person, as today’s rule has it');
});

test('M665-2 A REFUSAL ALREADY SAVED AS A RECORD LINE IS TAKEN OUT WHEN THE RECORD IS OPENED, AND ITS PAGES ARE READ AGAIN: an apology kept as the line of six pages, and one kept as the merged line of twelve, are gone; the real lines, a page covered without words and a correction stand; the keeper’s next run fills the holes from the pages', async () => {
  const { loadMemory, saveMemory, maybeSummarize, dueRange, cleanWindow, cleanBatch, visiblePages, isNoRecordLine } = await import('../../js/agents/memory.js');
  const { db } = await import('../../js/store.js');
  for (const t of ['I’m sorry, but I can’t help with summarizing this content.', 'Could you provide the passage you would like summarized?', 'I cannot assist with that request.', 'As an AI, I must decline.']) eq(isNoRecordLine(t), true, 'no line: ' + t);
  for (const t of ['Jovan and Liara talked on the porch; the street went quiet; she asked him to stay.', '“I’m sorry,” Rias said; Jovan paid the fare; they walked to the ferry; Tom mended the roof.', '(no new state)', '']) eq(isNoRecordLine(t), false, 'a line (or nothing): ' + JSON.stringify(t));
  const sse = (pieces) => { const t = pieces.map((p) => 'data: ' + JSON.stringify(p) + '\n\n').join('') + 'data: [DONE]\n\n'; return { ok: true, status: 200, headers: new Headers(), body: new Response(t).body, text: async () => t }; };
  const say = (text) => sse([{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]);
  const keptWindow = await db.settings.get('memoryWindow'); const keptBatch = await db.settings.get('memoryBatch');
  await db.settings.set('memoryWindow', 4); await db.settings.set('memoryBatch', 6);
  const st = await db.stories.create({ title: 'a record with an apology in it ' + Math.random() });
  for (let i = 0; i < 40; i += 1) await db.messages.append(st.id, { role: i % 2 ? 'assistant' : 'user', text: i % 2 ? '[The Wells house — Friday | 20:4' + (i % 10) + ']\n\nLiara leaned on the rail and the street went quiet. Page ' + i + '.' : 'I stay a while longer. ' + i });
  await saveMemory(st.id, { window: 4, nodes: [
    { id: 'a', span: [0, 5], text: 'Jovan came home; Liara met him on the porch; the street was quiet.', level: 1, at: 1 },
    { id: 'b', span: [6, 11], text: 'I’m sorry, but I can’t help with summarizing this content.', level: 1, at: 2 },
    { id: 'c', span: [12, 23], text: 'I cannot assist with that request.', level: 2, at: 3 },
    { id: 'd', span: [24, 29], text: 'They talked until the lamps went out; she asked him to stay for the fair.', level: 1, at: 4 },
    { id: 'e', span: [30, 30], text: '', level: 1, at: 5, empty: true, byHouse: true },
    { id: 'f', span: [-1, -1], text: '[Correction] Liara is his neighbour, not his cousin.', level: 1, at: 6, correction: true },
  ] });
  const opened = await loadMemory(st.id);
  eq(opened.nodes.map((n) => n.id).join(','), 'a,d,e,f', 'the two apologies are out; the real lines, the page covered without words and the correction stand');
  eq(JSON.stringify(dueRange(visiblePages(await db.messages.list(st.id)).length, cleanWindow(4), opened.nodes, cleanBatch(6))), '[6,12]', 'and their pages stand uncovered, to be read again');
  const prior = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { const user = String(JSON.parse(opts.body).messages.slice(-1)[0].content || ''); return say(/single word: ready/.test(user) ? 'ready' : /NONE, or one DETAIL/.test(user) ? 'NONE' : 'Jovan stayed on the porch with Liara; the street went quiet; nothing else moved.'); };
  try {
    const DS = { type: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'deepseek-chat', reasoning: { effort: 'off' } };
    for (let i = 0; i < 10; i += 1) { const mem = await loadMemory(st.id); if (!dueRange(visiblePages(await db.messages.list(st.id)).length, cleanWindow(4), mem.nodes, cleanBatch(6))) break; await maybeSummarize({ connection: { ...DS }, storyId: st.id, stale: () => false, renew: () => true }); }
    const mem = await loadMemory(st.id);
    eq(dueRange(visiblePages(await db.messages.list(st.id)).length, cleanWindow(4), mem.nodes, cleanBatch(6)), null, 'the keeper’s own run fills the holes: no gap is left');
    assert(!mem.nodes.some((n) => /sorry|cannot assist/i.test(String(n.text || ''))), 'and no apology is anywhere in the record');
    assert(mem.nodes.some((n) => n.id === 'a') && mem.nodes.some((n) => n.correction), 'the lines that were real are the same lines');
  } finally { globalThis.fetch = prior; if (keptWindow === undefined) await db.settings.delete('memoryWindow'); else await db.settings.set('memoryWindow', keptWindow); if (keptBatch === undefined) await db.settings.delete('memoryBatch'); else await db.settings.set('memoryBatch', keptBatch); }
});

/* M666 — his pasted audits: Salla and the old campaigner "still here" in the alley, twice; a hood pushed back, refused. */
test('M666-1 THE TAVERN DOES NOT WALK INTO THE ALLEY: on a near move, when the page names its room, whoever stood in the old room and is not in the new one is left behind; someone seated elsewhere is not written back in against that room; the reader is handed by name whoever the page names from afar; and a real change inside a long description (a hood pushed back) is written', async () => {
  const { headerMutations } = await import('../../js/engine/state.js');
  const { staleAfterJump, restatedPresence } = await import('../../js/engine/apply.js');
  const { extractTurn, namedFromAfarBlock, buildExtractorMessages } = await import('../../js/agents/extractor.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  let st = applyMutations({ ...emptyState(), page: 20 }, [{ type: 'mc.set', name: 'Jovan Wayne' }, { type: 'place.set', name: 'The Gilded Eel' }, { type: 'clock.set', year: 1001, month: 3, day: 5, hour: 21, minute: 0 },
    { type: 'presence.enter', name: 'Jovan Wayne', position: 'at the rear table' }, { type: 'presence.enter', name: 'the hooded girl', position: 'across the rear table', attire: 'a deliberately crude grey wool servant\u2019s cloak, hood up' },
    { type: 'presence.enter', name: 'Salla', position: 'behind the ale casks' }, { type: 'presence.enter', name: 'the one-armed old campaigner', position: 'at the next table' },
    ...['the hooded girl', 'Salla', 'the one-armed old campaigner'].map((name) => ({ type: 'people.set', name, field: 'core', text: 'someone the story keeps' }))]).state;
  const play = async (page, answer) => {
    const read = await withHouse(thinkingHouse({ answer: JSON.stringify(answer) }), () => extractTurn({ connection: HOUSES[0].conn, state: st, userText: 'I lead her out.', assistantText: page, pageNumber: st.page + 1 }));
    const header = headerMutations(page, { ground: st.place.name });
    st = applyMutations({ ...st, page: st.page + 1 }, [...header, ...staleAfterJump(st, header), ...read.mutations]).state;
    return read;
  };
  const here = () => st.present.map((p) => p.name).join(' | ');
  /* out of the tavern into the lane outside it — a NEAR move: the new place is named by its neighbour, every word of
   * "The Gilded Eel" in it. (By the far-move rule alone this left nobody behind.) */
  await play('[The lane outside the Gilded Eel — Hanami 5, 1001 AG | 21:10 | drizzle | black coat | at the door]\n\nJovan Wayne held the door and the hooded girl went out ahead of him into the lane. Behind the casks Salla called past them to the campaigner, “—and that’s the LAST of the cheap, granddad!” The door swung shut on the noise.',
    { mutations: [{ type: 'mode.snapshot', modes: [] }], resolved: [], here: ['Jovan Wayne', 'the hooded girl'] });
  eq(st.place.name + ' / ' + here(), 'The lane outside the Gilded Eel / Jovan Wayne | the hooded girl', 'the two who went out are in the lane — Salla and the campaigner did not ride along');
  assert(/Gilded Eel/.test(JSON.stringify(st.offscreen.Salla)) && /Gilded Eel/.test(JSON.stringify(st.offscreen['the one-armed old campaigner'])), 'they are kept at the tavern they were left in');
  /* the next page names them from afar: the reader is handed each by name, with where the ledger has them */
  const alley = '[The service alley off the lane — Hanami 5, 1001 AG | 21:15 | drizzle | black coat | two paces inside the gate]\n\nTwo paces inside the gate the hooded girl stopped, up against Jovan Wayne, his wrist in one hand. She pushed her hood back off her head for him alone, the deliberately crude grey wool servant\u2019s cloak dark with rain. Behind them at the lane\u2019s dogleg the old campaigner\u2019s silhouette appeared, unhurried, settled against the far wall. Back at the Eel, Salla called past the door to nobody.';
  const block = namedFromAfarBlock(st, alley).join('\n');
  assert(/NAMED ON THIS PAGE BUT NOT IN THE SCENE AS IT OPENS/.test(block) && /\d\. Salla \[[^\]]*Gilded Eel[^\]]*\]/.test(block) && /face to face with Jovan Wayne/.test(block), 'handed over by name, with her place and the one question: ' + block.slice(0, 200));
  assert(/NAMED ON THIS PAGE BUT NOT IN THE SCENE/.test(buildExtractorMessages({ state: st, userText: 'x', assistantText: alley }).user), 'and it rides in what the reader is sent');
  eq(namedFromAfarBlock(st, '[The service alley off the lane — Hanami 5, 1001 AG | 21:20]\n\nThe girl said nothing.').length, 0, 'a page that names nobody from afar asks nothing');
  /* into the alley: the reader walks Salla back in (the telling names her) though its own room does not hold her */
  await play(alley, { mutations: [{ type: 'mode.snapshot', modes: [] }, { type: 'presence.enter', name: 'Salla', shown: 'Salla called past the door to nobody' }], resolved: [],
    here: [{ name: 'Jovan Wayne', at: 'two paces inside the gate' }, { name: 'the hooded girl', at: 'two paces inside the gate, up against Jovan', wears: 'a deliberately crude grey wool servant\u2019s cloak, hood pushed back off her head' }] });
  eq(here(), 'Jovan Wayne | the hooded girl', 'Salla is not written back in against the page’s own room');
  eq(st.present.find((p) => p.name === 'the hooded girl').attire, 'a deliberately crude grey wool servant\u2019s cloak, hood pushed back off her head', 'the hood pushed back is written (it was refused as “the same thing in other words”)');
  /* the rule itself: something the ledger does not say is a change; the same in fewer or reordered words is not */
  const one = (old, neu, page) => restatedPresence({ ...st, present: [{ name: 'Rias', attire: old }] }, [{ name: 'Rias', wears: neu }], [], '[x — Hanami 5, 1001 AG | 21:20]\n\n' + page).length;
  eq(one('a grey cloak, hood up', 'a grey cloak, hood pushed back', 'Rias pushed the hood of her grey cloak back.') + ' ' + one('the batsuit, armored, cowl on', 'armored still', 'She stood armored still.') + ' ' + one('a grey cloak, hood up', 'hood up, a cloak of grey', 'Her grey cloak, its hood up.'), '1 0 0', 'new words are a change; fewer or reordered words are not');
  /* the same place said more fully is no move, and nobody is left behind for it (M509-13b's own case, and an address) */
  const still = applyMutations({ ...emptyState(), page: 5 }, [{ type: 'mc.set', name: 'Jovan Wayne' }, { type: 'place.set', name: 'The Gilded Eel' }, { type: 'presence.enter', name: 'Jovan Wayne' }, { type: 'presence.enter', name: 'Salla' }, { type: 'presence.enter', name: 'the hooded girl' }]).state;
  for (const header of ['[The Gilded Eel, off Harbor Street — Hanami 5, 1001 AG | 21:05]', '[The Gilded Eel tavern — Hanami 5, 1001 AG | 21:05]']) {
    const r = await withHouse(thinkingHouse({ answer: JSON.stringify({ mutations: [], resolved: [], here: ['Jovan Wayne', 'the hooded girl'] }) }), () => extractTurn({ connection: HOUSES[0].conn, state: still, userText: 'x', assistantText: header + '\n\nThe hooded girl said nothing.', pageNumber: 6 }));
    eq(r.mutations.filter((m) => m.type === 'presence.leave').length, 0, 'no move, nobody left behind: ' + header);
  }
  /* someone NEW (no seat) whom the reader walks in but leaves off its room is still written in */
  const fresh = await withHouse(thinkingHouse({ answer: JSON.stringify({ mutations: [{ type: 'presence.enter', name: 'Oriana’s maid', shown: 'a maid slipped in through the gate' }], resolved: [], here: ['Jovan Wayne', 'the hooded girl'] }) }), () => extractTurn({ connection: HOUSES[0].conn, state: st, userText: 'x', assistantText: '[The service alley off the lane — Hanami 5, 1001 AG | 21:25]\n\nA maid slipped in through the gate and stood by the hooded girl.', pageNumber: 23 }));
  assert(fresh.mutations.some((m) => m.type === 'presence.enter' && /maid/.test(m.name)), 'a newcomer with no seat is not caught by the rule');
});

test('M666-2 AN ANSWER THAT IS NOT A SUMMARY IS ASKED FOR AGAIN, IN THE SAME RUN (his: “gibberish, or the AI breaking character, or ‘I can’t help with this’ — automatically try again, same as the other workers”): the keeper’s line for a batch, its merge of two lines, and the plot essentials each take three asks to get a real one; what is not a summary is never kept', async () => {
  const { notASummary, KEEPER_TRIES, maybeSummarize, loadMemory, saveMemory, NOTES_PER_LAYER } = await import('../../js/agents/memory.js');
  const { runEssentials, loadEssentials, ESSENTIALS_TRIES } = await import('../../js/agents/essentials.js');
  const { db } = await import('../../js/store.js');
  const pagesText = 'Liara leaned on the rail and the street went quiet. Jovan stayed on the porch a while longer; she asked him to stay for the fair on Friday.';
  eq(notASummary('Jovan stayed on the porch with Liara; the street went quiet; she asked him to stay for the fair.', pagesText), '', 'a line of the record is a summary');
  eq(notASummary('(no new state)', pagesText), '', 'and so is “nothing new”');
  assert(/speaks as an assistant/.test(notASummary('As an AI language model, I’d be happy to continue the story for you.', pagesText)), 'an assistant talking about itself is not');
  assert(/page of story/.test(notASummary('[The Wells house — Friday | 20:50 | clear | coat | on the porch]\n\nLiara turned from the rail. “Stay,” she said.', pagesText)), 'a page of story written on is not');
  assert(/not words/.test(notASummary('@@## $$%% ^^&& **(( ))__ ++== ~~`` ||\\\\ <<>> ??// ;;::', pagesText)), 'noise is not');
  assert(/nothing of what it was asked/.test(notASummary('The quarterly revenue forecast exceeded analyst expectations across European markets despite currency headwinds.', pagesText)), 'words about something else are not');
  eq(KEEPER_TRIES + ' / ' + ESSENTIALS_TRIES, '3 / 3', 'three asks for each');
  const sse = (pieces) => { const t = pieces.map((p) => 'data: ' + JSON.stringify(p) + '\n\n').join('') + 'data: [DONE]\n\n'; return { ok: true, status: 200, headers: new Headers(), body: new Response(t).body, text: async () => t }; };
  const say = (text) => sse([{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]);
  const DS = { type: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'deepseek-chat', reasoning: { effort: 'off' } };
  const kept = { window: await db.settings.get('memoryWindow'), batch: await db.settings.get('memoryBatch'), squeeze: await db.settings.get('memorySqueeze'), keeper: await db.settings.get('memoryKeeper') };
  const prior = globalThis.fetch;
  try {
    /* the keeper's line for a batch: a page of story, then noise about something else, then the line */
    await db.settings.set('memoryWindow', 4); await db.settings.set('memoryBatch', 6);
    const st = await db.stories.create({ title: 'a keeper that breaks character ' + Math.random() });
    for (let i = 0; i < 40; i += 1) await db.messages.append(st.id, { role: i % 2 ? 'assistant' : 'user', text: i % 2 ? '[The Wells house — Friday | 20:4' + (i % 10) + ']\n\nLiara leaned on the rail and the street went quiet. Page ' + i + '.' : 'I stay on the porch a while longer. ' + i });
    let asks = 0; const prompts = [];
    const bad = ['[The Wells house — Friday | 20:50 | clear | coat | on the porch]\n\nLiara turned from the rail. “Stay,” she said, and the street held its breath.', 'The quarterly revenue forecast exceeded analyst expectations across European markets despite currency headwinds.'];
    globalThis.fetch = async (url, opts) => { const user = String(JSON.parse(opts.body).messages.slice(-1)[0].content || ''); if (/single word: ready/.test(user)) return say('ready'); if (/NONE, or one DETAIL/.test(user)) return say('NONE'); asks += 1; prompts.push(user); return say(asks <= bad.length ? bad[asks - 1] : 'Jovan stayed on the porch with Liara; the street went quiet; nothing else moved.'); };
    await maybeSummarize({ connection: { ...DS }, storyId: st.id, stale: () => false, renew: () => true });
    const mem = await loadMemory(st.id);
    assert(asks >= 3 && prompts[0] === prompts[1] && prompts[1] === prompts[2], 'the same batch was asked for three times in ONE run of the keeper (asks: ' + asks + ')');
    const lines = mem.nodes.filter((n) => n.text).map((n) => n.text);
    assert(lines.length >= 1 && lines.every((t) => t === 'Jovan stayed on the porch with Liara; the street went quiet; nothing else moved.'), 'what was kept is the summary — not the page of story, not the forecast: ' + JSON.stringify(lines.map((t) => t.slice(0, 40))));
    eq(mem.nodes.some((n) => n.span[0] === 0 && n.text), true, 'and the first pages have their line from that same run');
    /* the fold: an assistant talking, then the merged line — the promotion happens in the same run */
    await db.settings.set('memorySqueeze', 100); await db.settings.set('memoryKeeper', true); await db.settings.set('memoryWindow', 30);
    for (let i = 0; i < 700; i += 1) await db.messages.append('m666-fold', { role: i % 2 ? 'assistant' : 'user', text: 'page ' + i, ts: i });
    await saveMemory('m666-fold', { window: 30, nodes: Array.from({ length: NOTES_PER_LAYER + 1 }, (_, i) => ({ id: 'n' + i, span: [i * 6, i * 6 + 5], text: 'Jovan and Liara on the porch, evening ' + i + '; the street quiet; she asks him to stay; he says he will think on it; the lamps go out one by one.', level: 1, at: i })) });
    let merges = 0;
    globalThis.fetch = async (url, opts) => { const user = String(JSON.parse(opts.body).messages.slice(-1)[0].content || ''); if (/NONE, or one DETAIL/.test(user)) return say('NONE'); if (/being merged into ONE line/.test(user)) { merges += 1; return say(merges === 1 ? 'As an AI language model, I’d be happy to help you merge these lines! Here is my attempt.' : 'Jovan and Liara spend two evenings on the porch; the street quiet; she asks him to stay and he says he will think on it; the lamps go out one by one both nights.'); } return say('(no new state)'); };
    await maybeSummarize({ connection: { ...DS }, storyId: 'm666-fold' });
    const folded = (await loadMemory('m666-fold')).nodes.filter((n) => n.level === 2);
    eq(merges + ' | ' + folded.length + ' | ' + /two evenings on the porch/.test(folded[0] ? folded[0].text : ''), '2 | 1 | true', 'the merge was asked for again at once, and the real merged line is the promotion');
    assert(!(await loadMemory('m666-fold')).nodes.some((n) => /As an AI/.test(String(n.text || ''))), 'the assistant’s chatter is nowhere in the record');
    /* the plot essentials: two answers that are not them, then the essentials */
    let tells = 0;
    const good = '[Friday evening, the Wells house porch] Jovan comes home and Liara meets him; they talk until the lamps go out.\n[Saturday, the fair] She asks him to stay for the fair; he says he will think on it.';
    const out = await runEssentials({ connection: { ...DS }, storyId: 'm666-essentials', nodes: [{ id: 'a', span: [0, 5], text: 'Jovan came home; Liara met him on the porch; the street was quiet; they talked until the lamps went out.', level: 1, at: 1 }, { id: 'b', span: [6, 11], text: 'She asked him to stay for the fair; he said he would think on it; the ferry was late.', level: 1, at: 2 }], brief: 'A harbour town story.', mc: 'Jovan', force: true,
      callLLM: async () => { tells += 1; return tells === 1 ? 'I’m sorry, but I can’t help with that.' : tells === 2 ? 'asdf qwer zxcv uiop hjkl' : good; } });
    eq(tells + ' | ' + out.wrote, '3 | true', 'the essentials were asked for three times and written');
    assert(/Friday evening, the Wells house porch/.test((await loadEssentials('m666-essentials')).text), 'and what is kept is the essentials');
  } finally {
    globalThis.fetch = prior;
    for (const [key, v] of [['memoryWindow', kept.window], ['memoryBatch', kept.batch], ['memorySqueeze', kept.squeeze], ['memoryKeeper', kept.keeper]]) { if (v === undefined) await db.settings.delete(key); else await db.settings.set(key, v); }
  }
});

/* M667 — the two findings M666 left open ("is everything done or not?"): where a thing lies; what someone close by overheard. */
test('M667-1 THE THINGS A PAGE NAMES AND THE PEOPLE WITHIN EARSHOT ARE HANDED TO THE PAGE READER BY NAME: the rose is written where the page leaves it (the page’s own words, never an invented place, never the same place again); the old campaigner at the alley’s mouth learns what the page shows him overhear — and neither is asked about when the page gives no cause', async () => {
  const { extractTurn, buildExtractorMessages, thingsOnPageBlock, withinEarshotBlock } = await import('../../js/agents/extractor.js');
  const { movedThings } = await import('../../js/engine/apply.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const G = 'The service alley off the lane';
  const st = applyMutations({ ...emptyState(), page: 22 }, [{ type: 'mc.set', name: 'Jovan Wayne' }, { type: 'place.set', name: G }, { type: 'clock.set', year: 1001, month: 3, day: 5, hour: 21, minute: 15 },
    { type: 'presence.enter', name: 'Jovan Wayne' }, { type: 'presence.enter', name: 'the hooded girl' },
    ...['the hooded girl', 'Salla', 'the one-armed old campaigner'].map((name) => ({ type: 'people.set', name, field: 'core', text: 'someone the story keeps' })),
    { type: 'offscreen.set', name: 'Salla', location: 'the Gilded Eel, at the ale casks', activity: 'pouring' },
    { type: 'offscreen.set', name: 'the one-armed old campaigner', location: 'the lane’s dogleg outside the service alley mouth', activity: 'leaning on the wall with his cup' },
    { type: 'thing.set', name: 'the rose', where: 'in Jovan’s hand, held out to her', owner: 'Jovan Wayne' },
    { type: 'thing.set', name: 'the brass key', where: 'on a cord round Salla’s neck', owner: 'Salla' }]).state;
  const page = '[' + G + ' — Hanami 5, 1001 AG | 21:20 | drizzle | black coat | two paces inside the gate]\n\nShe pricked her thumb on the rose and set it down between them on the wet stone. “Oriana,” she said. “Princess Oriana — the King’s daughter.” At the alley’s mouth the old campaigner had stopped with his cup halfway; he had heard every word.';
  const earshot = withinEarshotBlock(st).join('\n');
  assert(/WITHIN EARSHOT/.test(earshot) && /\d\. the one-armed old campaigner \[the lane’s dogleg outside the service alley mouth\]/.test(earshot) && !/Salla/.test(earshot), 'the one at the alley’s mouth is within earshot; Salla, back at the tavern, is not: ' + earshot.slice(0, 220));
  const things = thingsOnPageBlock(st, page).join('\n');
  assert(/THINGS THE LEDGER KEEPS THAT THIS PAGE NAMES/.test(things) && /\d\. the rose \(Jovan Wayne’s\) — in Jovan’s hand, held out to her/.test(things) && !/brass key/.test(things), 'the rose is on the page, the key is not: ' + things.slice(0, 260));
  const sent = buildExtractorMessages({ state: st, userText: 'I hold out the rose.', assistantText: page }).user;
  assert(/WITHIN EARSHOT/.test(sent) && /THINGS THE LEDGER KEEPS THAT THIS PAGE NAMES/.test(sent), 'both ride in what the reader is sent');
  const quiet = '[' + G + ' — Hanami 5, 1001 AG | 21:25]\n\nShe said nothing more.';
  eq(thingsOnPageBlock(st, quiet).length, 0, 'a page that names no kept thing asks about none');
  const read = await withHouse(thinkingHouse({ answer: JSON.stringify({ mutations: [{ type: 'mode.snapshot', modes: [] }, { type: 'knowledge.add', who: ['the one-armed old campaigner', 'the hooded girl'], fact: 'that the hooded girl named herself Oriana, the King’s daughter, to Jovan in the alley' }], resolved: [], here: ['Jovan Wayne', 'the hooded girl'],
    things: [{ name: 'the rose', where: 'between them on the wet stone' }, { name: 'the brass key', where: 'in the hooded girl’s pocket' }, { name: 'a silver locket', where: 'on the wet stone' }] }) }), () => extractTurn({ connection: HOUSES[0].conn, state: st, userText: 'I hold out the rose.', assistantText: page, pageNumber: 23 }));
  eq(JSON.stringify(read.mutations.filter((m) => m.type === 'thing.set')), JSON.stringify([{ type: 'thing.set', name: 'the rose', where: 'between them on the wet stone' }]), 'the rose is moved to where the page leaves it; a key moved to a pocket the page never showed is not; a locket the ledger does not keep is not made');
  const led = applyMutations({ ...st, page: 23 }, read.mutations).state;
  eq(led.things['the rose'].where + ' | ' + led.things['the brass key'].where, 'between them on the wet stone | on a cord round Salla’s neck', 'the ledger has the rose on the stone; the key where it was');
  assert((led.knowledge['the one-armed old campaigner'] || []).some((k) => /named herself Oriana/.test(k.fact)), 'the old campaigner, close by, now knows what he overheard: ' + JSON.stringify(led.knowledge));
  assert(!(led.knowledge.Salla || []).some((k) => /Oriana/.test(k.fact)), 'Salla, out of earshot and not named, does not');
  eq(movedThings(led, [{ name: 'the rose', where: 'on the wet stone, between them' }], page).length, 0, 'the same place in other words is not written again');
});


/* M669 — his: a stray "The World Beyond stays where it cut — nothing follows it, and nobody in 1-D learns anything from it"
 * at the end of a page. */
test('M669-1 THE WINDOW’S RULE SAID BACK IS NOT STORY: at a page’s end it comes off — as its own paragraph, with a line that goes on about “it”, or as the last sentence of a paragraph of story (only that sentence) — and is kept with the page; the window itself, speech, and story that only sounds like it are never touched', async () => {
  const { finishPage, isRuleEcho, cutRuleEchoTail } = await import('../../js/ui/pageshape.js');
  const story = '[Class 1-D — Monday, April 7 | 08:40 | clear | uniform | by the window]\n\nThe bell had not rung yet. Jovan set his bag down by the window and watched the yard fill, row by row, with first-years who did not know where to stand. Somebody laughed at the back and was hushed.\n\nMina slid into the seat beside him without a word.';
  const windowed = story + '\n\n*** The World Beyond ***\n[The staff room — Monday, April 7 | 08:41]\nThe vice-principal counted the registers twice and found one too many.';
  const stray = 'The World Beyond stays where it cut — nothing follows it, and nobody in 1-D learns anything from it.';
  const one = finishPage(windowed + '\n\n' + stray, { mc: 'Jovan' });
  eq(one.text, windowed, 'his own line, as the page’s last paragraph, comes off — the window and the story stand whole');
  assert(one.removed.some((r) => r.includes('nothing follows it')), 'and what came off is kept with the page: ' + JSON.stringify(one.removed));
  const two = finishPage(windowed + '\n\nThe World Beyond stays where it cut — nothing follows it.\n\nAnd nobody in 1-D learns anything from it.', { mc: 'Jovan' });
  eq(two.text, windowed, 'said in two lines, both come off');
  const closing = finishPage(story + ' The yard went quiet. The World Beyond stays where it cut — nothing follows it.', { mc: 'Jovan' });
  eq(closing.text, story + ' The yard went quiet.', 'closing a paragraph of story, only its own sentence comes off');
  for (const echo of [stray, 'The Window Beyond the Page sits where the cut happens, and nothing follows it.', 'The World Beyond is closed. Nothing follows it.']) eq(isRuleEcho(echo), true, 'the rule said back: ' + echo);
  for (const told of ['The world beyond the mountains stays quiet, as it always has.', 'Nothing follows it but the rain.', '“The World Beyond stays where it cut,” she read aloud, and laughed.', '*** The World Beyond ***', 'Nobody in 1-D learns anything from it.', 'The window beyond the stairs stays shut all winter.']) eq(isRuleEcho(told), false, 'story, or the window’s own marker: ' + told);
  eq(finishPage(story + '\n\nThe world beyond the mountains stays quiet, as it always has.', { mc: 'Jovan' }).text, story + '\n\nThe world beyond the mountains stays quiet, as it always has.', 'a closing line of story that only sounds like it is kept');
  eq(finishPage(story + '\n\nNobody in 1-D learns anything from it.', { mc: 'Jovan' }).text, story + '\n\nNobody in 1-D learns anything from it.', 'and the second half alone, with no rule above it, is story');
  eq(cutRuleEchoTail('The yard went quiet.'), null, 'a paragraph with no echo is not cut');
  eq(finishPage(windowed, { mc: 'Jovan' }).text, windowed, 'a clean page is returned as it came');
});
