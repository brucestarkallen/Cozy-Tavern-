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
