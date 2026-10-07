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
