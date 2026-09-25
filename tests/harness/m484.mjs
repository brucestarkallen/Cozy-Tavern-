/* M484 — what the storyteller saw, without the bloat: one wound per body part; one fact in one wording, house-wide;
 * a role is its holder; a group is not a person. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { addInjury, bodyPartOf } from '../../js/engine/bodies.js';
import { sameFact, addKnowledge } from '../../js/engine/world.js';
import { resolveDescriptor, isGroupName } from '../../js/engine/people.js';
import { applyMutations } from '../../js/engine/apply.js';
import { emptyState } from '../../js/engine/state.js';

test('M484-1 one wound per body part: a wound written again on the same part is that wound gone worse — the newer words, the higher severity, the first hour; another part, or no part, is its own', () => {
  let b = {};
  const lines = [['left shoulder run through by Kaiten, bleeding freely', 2], ['left shoulder wound torn wider by the missed intercept swing', 2], ['left shoulder wound torn wider by the shock of the stopped downswing, bleeding freely', 1], ['thin line opened across the cheekbone by the displaced wind', 1], ['kidney struck twice through the back by a red-glowing fist', 2], ['kidney struck three more times by the red-glowing fist, torso folded', 2]];
  lines.forEach(([w, s], i) => { b = addInjury(b, 'Zaraki', { what: w, sev: s }, 100 + i, i + 1); });
  eq(b.Zaraki.injuries.length, 3, 'six lines, three wounds: ' + b.Zaraki.injuries.map((i) => bodyPartOf(i.what)).join(','));
  const shoulder = b.Zaraki.injuries.find((i) => bodyPartOf(i.what) === 'left shoulder');
  eq(shoulder.what, 'left shoulder wound torn wider by the shock of the stopped downswing, bleeding freely', 'the newer words');
  eq(shoulder.sev, 2, 'the higher severity stays'); eq(shoulder.atMinutes, 100, 'the first hour'); eq(shoulder.worsenedAtTurn, 3);
  b = addInjury(b, 'Zaraki', { what: 'a graze', sev: 1 }, 200, 9);
  b = addInjury(b, 'Zaraki', { what: 'a graze', sev: 1 }, 201, 10);
  eq(b.Zaraki.injuries.length, 5, 'no part named: its own line each time (M92’s exact-duplicate rule is not this one)');
  eq(bodyPartOf('right knee struck by Varkhos’s descending fist'), 'right knee'); eq(bodyPartOf('kidney struck twice through the back'), 'kidney'); eq(bodyPartOf('broken ribs'), 'rib');
});

test('M484-2 one fact in one wording: paraphrases are one fact (the longer stays); a fact someone else holds is written for the next person in those very words; two facts that merely share a subject stay two', () => {
  assert(sameFact('that Jovan Oda treats her as a child — rubbed her hair and asked her age in front of the whole courtyard', 'that Jovan Oda rubbed Rukia Kuchiki\'s hair and asked her age in front of the courtyard', { fuzzy: true }));
  assert(sameFact('Jovan Oda said he is not here to replace anyone but to continue Captain Ukitake\'s legacy, so that when their times come they can smile', 'that Jovan Oda intends to tell the Thirteenth Division he is not there to replace anyone but to continue Captain Ukitake\'s legacy', { fuzzy: true }));
  assert(!sameFact('heard the intercom buzzer go off twice, then a third time, while Kara was kneeling at the sofa', 'that her name is Kara Zor-El, offered plainly as an introduction', { fuzzy: true }));
  assert(!sameFact('that Jovan lives in the Arden tower with a sun panel', 'that Jovan kept his stepsister\'s sun panel and turned it on', { fuzzy: true }), 'a shared subject is not the same fact');
  let k = {};
  k = addKnowledge(k, 'Rukia', 'that Jovan Oda rubbed Rukia Kuchiki\'s hair and asked her age in front of the courtyard', 3);
  k = addKnowledge(k, 'Renji', 'that Jovan Oda rubbed Rukia\'s hair and asked her age in front of the whole courtyard', 3);
  k = addKnowledge(k, 'Rangiku', 'that Jovan Oda rubbed Rukia Kuchiki\'s hair and asked her age in front of two hundred officers', 3);
  eq(k.Renji[0].fact, k.Rukia[0].fact, 'Renji holds it in Rukia’s words'); eq(k.Rangiku[0].fact, k.Rukia[0].fact);
  k = addKnowledge(k, 'Rukia', 'that Jovan Oda treats her as a child — rubbed her hair and asked her age in front of the whole courtyard', 4);
  eq(k.Rukia.length, 1, 'a paraphrase adds no line');
});

test('M484-3 a role is its holder; a group is not a person — at every door', () => {
  const s = emptyState(); s.sheet = { actors: {}, playerName: 'Jovan Arden' };
  s.characters = { 'Dev Okafor': { core: 'news drone operator; flew the drone over the crater and captured the wings clip', updatedAtTurn: 1 }, Marta: { core: 'the woman in scrubs who broke the taped line', updatedAtTurn: 1 } };
  eq(resolveDescriptor(s, 'The news drone operator'), 'Dev Okafor'); eq(resolveDescriptor(s, 'the woman in scrubs'), 'Marta');
  eq(resolveDescriptor(s, 'the first officer'), null, 'nobody holds it: a page of its own may stand');
  const r = applyMutations(s, [
    { type: 'offscreen.set', name: 'The news drone operator', location: 'the rented truck on Lombard', activity: 'bent over the telemetry map' },
    { type: 'thread.set', title: 'the changed map', owner: 'the news drone operator', heat: 'hot', next: 'send the corrected tower placement' },
    { type: 'people.set', name: 'the onlookers behind the taped line', field: 'core', text: 'crowd behind the tape' },
    { type: 'offscreen.set', name: 'The two police officers at the barricade', location: 'the barricade gap', activity: 'on the radio' },
    { type: 'presence.enter', name: 'the crowd' },
    { type: 'faction.set', name: 'the onlookers behind the taped line', stance: 'shifting attention north', agenda: 'get the roar clip up', move: 'phones aimed at the far skyline' },
  ]);
  assert(r.state.offscreen['Dev Okafor'] && !r.state.offscreen['The news drone operator'], 'the role’s seat is Dev’s');
  assert(!Object.keys(r.state.characters).some((k) => /onlookers/i.test(k)), 'no page for a crowd');
  assert(!Object.keys(r.state.offscreen).some((k) => /officers/i.test(k)), 'no seat for a crowd');
  assert(!r.state.present.some((p) => /crowd/i.test(p.name)), 'a crowd never walks in as a person');
  assert(Object.keys(r.state.factions || {}).some((k) => /onlookers/i.test(k)), 'a crowd is a faction');
  for (const n of ['the onlookers behind the taped line', 'The two police officers at the barricade', 'a few villagers', 'Onmitsukidō runners', 'The rest']) assert(isGroupName(n), n);
  for (const n of ['the first officer', 'The man whose knees buckled', 'the woman in scrubs', 'Old Pell', 'Kara Zor-El', '1st Division runner']) assert(!isGroupName(n), n + ' is one person');
});

test('M484-4 the dead are one line at the foot of Elsewhere, no clock; the people list says dead; a bare card is a name; "meaning to" never doubles', async () => {
  const { renderOffscreen } = await import('../../js/engine/offscreen.js');
  const off = { Ukitake: { location: 'dead — his grave on the Kuchiki family plot, gone', activity: '', atTurn: 1, sinceMinutes: 100 }, Komamura: { location: 'the eastern passes', activity: 'asleep', agenda: 'to put distance between himself and every voice', atTurn: 2, sinceMinutes: 120, stance: 'busy' } };
  const out = renderOffscreen(off, [], 200, 6, {});
  assert(/^Komamura — /m.test(out) && !/Ukitake —/.test(out), 'the living listed, the dead not among them');
  assert(/\nDead: Ukitake \(his grave on the Kuchiki family plot\)\.$/.test(out), 'one line at the foot, no clock: ' + JSON.stringify(out));
  assert(out.includes('(meaning to put distance'), 'never "meaning to to": ' + out);
  const { renderPeopleTiers, peopleView } = await import('../../js/engine/people.js');
  const s = emptyState(); s.sheet = { actors: {}, playerName: 'Jovan' }; s.turn = 30;
  s.characters = { Ukitake: { core: 'Former Captain of the 13th Division; killed in the war', updatedAtTurn: 1 }, Ikkaku: { updatedAtTurn: 1 }, Rukia: { core: 'Lieutenant of the 13th', state: 'at his shoulder', updatedAtTurn: 29 } };
  s.offscreen = { Ukitake: { location: 'dead — his grave on the Kuchiki family plot, gone', atTurn: 1 }, Ikkaku: { location: 'the west road', activity: 'walking fast', atTurn: 20 } };
  s.present = [{ name: 'Rukia' }];
  const text = JSON.stringify(renderPeopleTiers(s, { recentPages: ['Ukitake and Ikkaku were spoken of.'], view: peopleView(200000), seatsInState: true }));
  assert(/Ukitake[^"]*Now: dead/.test(text), 'the dead are dead, not away: ' + text.slice(0, 400));
  assert(!/Ikkaku — Now: away/.test(text), 'a bare card never reads "Now: away" under a name');
});

test('M485 the ledger heals itself on load: six wound lines fold to three; a role’s page folds into its holder (seat, loose ends, knowledge, standing carried); a crowd’s page and seat go and a faction of its name stands', async () => {
  const { dedupeInjuries } = await import('../../js/engine/bodies.js');
  const { healGhosts } = await import('../../js/engine/people.js');
  const { saveState, loadState } = await import('../../js/engine/state.js');
  const { db } = await import('../../js/store.js');
  const bodies = { Zaraki: { injuries: [
    { what: 'left shoulder run through by Kaiten', sev: 2, atMinutes: 100, atTurn: 1, treated: false, healed: false },
    { what: 'left shoulder wound torn wider by the shock', sev: 1, atMinutes: 103, atTurn: 3, treated: false, healed: false },
    { what: 'kidney struck twice through the back', sev: 2, atMinutes: 104, atTurn: 4, treated: false, healed: false },
    { what: 'kidney struck three more times', sev: 2, atMinutes: 105, atTurn: 5, treated: false, healed: false },
    { what: 'old cut on the left shoulder', sev: 1, atMinutes: 1, atTurn: 0, treated: true, healed: true },
  ], strain: [] } };
  const d = dedupeInjuries(bodies);
  eq(d.Zaraki.injuries.filter((i) => !i.healed).length, 2, 'two unhealed wounds');
  eq(d.Zaraki.injuries.length, 3, 'the healed line is history and stays');
  eq(d.Zaraki.injuries[0].what, 'left shoulder wound torn wider by the shock'); eq(d.Zaraki.injuries[0].atMinutes, 100); eq(d.Zaraki.injuries[0].sev, 2);
  const s = emptyState(); s.sheet = { actors: {}, playerName: 'Jovan Arden' }; s.turn = 20;
  s.characters = {
    'Dev Okafor': { core: 'news drone operator; flew the drone over the crater', threads: ['post the wings clip'], updatedAtTurn: 12 },
    'The news drone operator': { core: 'news drone operator', state: 'bent over the telemetry map', threads: ['send the corrected tower placement'], updatedAtTurn: 14 },
    Vivi: { core: 'Jovan’s rich younger stepsister', updatedAtTurn: 12 },
    "Jovan's stepsister": { core: 'his stepsister', state: 'furious', threads: ['a full explanation tomorrow'], updatedAtTurn: 13 },
    'the onlookers behind the taped line': { core: 'crowd behind the tape', state: 'shifting north', updatedAtTurn: 14 },
    Marta: { core: 'the woman in scrubs', updatedAtTurn: 10 },
  };
  s.offscreen = { 'The news drone operator': { location: 'the rented truck on Lombard', activity: 'bent over the map', agenda: 'confirm the tower', atTurn: 14 }, 'the onlookers behind the taped line': { location: 'the buckled sidewalk', activity: 'recording the north skyline', agenda: 'upload the roar clip', atTurn: 14 } };
  s.knowledge = { 'The news drone operator': [{ fact: 'that the wings landed on a tower by the water', atTurn: 12 }], "Jovan's stepsister": [{ fact: 'that Jovan answered after fourteen missed calls', atTurn: 13 }] };
  s.relationships = { "Jovan's stepsister": { p: 8, r: 0, s: 0, history: [] } };
  const h = healGhosts(s);
  assert(!h.characters['The news drone operator'] && !h.characters["Jovan's stepsister"] && !h.characters['the onlookers behind the taped line'], 'the ghosts are gone: ' + Object.keys(h.characters).join(','));
  assert(h.characters['Dev Okafor'].threads.includes('send the corrected tower placement'), 'the role’s loose end is Dev’s');
  eq(h.offscreen['Dev Okafor'].location, 'the rented truck on Lombard', 'his seat carried'); assert(!h.offscreen['The news drone operator']);
  assert(h.knowledge['Dev Okafor'].some((f) => /wings landed/.test(f.fact)), 'his knowledge carried');
  eq(h.relationships.Vivi.p, 8, 'her standing carried'); eq(h.characters.Vivi.state, 'furious', 'her state carried');
  assert(h.factions['the onlookers behind the taped line'] && /shifting north/.test(h.factions['the onlookers behind the taped line'].stance), 'a crowd stands as a faction');
  assert(!h.offscreen['the onlookers behind the taped line'], 'and holds no seat');
  /* and through the store: a saved ledger comes back healed */
  const st = await db.stories.create({ title: 'ghosts' });
  const raw = emptyState(); raw.sheet = { actors: {}, playerName: 'Jovan Arden' }; raw.characters = { Vivi: { core: 'Jovan’s stepsister', updatedAtTurn: 1 }, "Jovan's stepsister": { core: 'his stepsister', threads: ['the call'], updatedAtTurn: 2 } }; raw.bodies = bodies;
  await saveState(st.id, raw);
  const back = await loadState(st.id);
  assert(!back.characters["Jovan's stepsister"] && back.characters.Vivi.threads.includes('the call'), 'healed on load');
  eq(back.bodies.Zaraki.injuries.filter((i) => !i.healed).length, 2, 'the wounds folded on load');
  await db.stories.remove(st.id);
});

test('M486 the receipt says what canon did: the row stands whenever canon is on — with its note, or empty with the reason; off, no row', async () => {
  const { buildRequest } = await import('../../js/assemble/stack.js');
  const story = { title: 't', brief: 'a brief', castNotes: '' };
  const pages = [{ id: 'u1', role: 'user', text: 'I walk in.' }, { id: 'a1', role: 'assistant', text: '[The Lantern — Tuesday | 21:00] The door swung.' }, { id: 'u2', role: 'user', text: 'I sit.' }];
  const base = { story, messages: pages, settings: { frameText: 'F' }, state: emptyState(), modules: [], memory: '', cast: [], lore: '', loreFired: [], window: { mode: 'keeper', window: 30, budgetTokens: 200000 } };
  const row = (req) => req.receipt.slots.find((s) => s.name === 'What canon says');
  assert(!row(buildRequest({ ...base })), 'off: no row');
  const empty = row(buildRequest({ ...base, canonOn: true, canonWhy: 'canon found no canon face to speak of in the latest pages (scene scan)' }));
  assert(empty && empty.text === '' && /no canon face/.test(empty.reason), 'on, empty: the row with the reason — ' + JSON.stringify(empty));
  const full = row(buildRequest({ ...base, canonOn: true, canonNote: 'Rukia Kuchiki:\nLieutenant of the 13th, petite, violet eyes.' }));
  assert(full && /Rukia/.test(full.text) && !full.reason, 'on, with a note: the note rides');
  assert(buildRequest({ ...base, canonOn: true, canonNote: 'Rukia Kuchiki:\nLieutenant.' }).messages.some((m) => /Rukia Kuchiki:/.test(String(m.content))), 'and it is in the request');
});

test('M487 canon reads clean: a template keeps its display text (the walker dropped it whole — "The is one of the Gotei 13"); a dead face is one sentence; a cut block ends at a whole sentence', async () => {
  const { cleanWikitext } = await import('../../js/canon/grounding.js');
  const { trimCanonNote } = await import('../../js/canon/bridge.js');
  eq(cleanWikitext("The {{Translation|'''Tenth Division'''|十番隊|jūbantai}} is one of the [[Gotei 13]], headed by Captain [[Tōshirō Hitsugaya]]."), 'The Tenth Division is one of the Gotei 13, headed by Captain Tōshirō Hitsugaya.');
  eq(cleanWikitext('composed of a white {{tt|[[shitagi]]|下着}}, a black {{Nihongo|kosode|小袖}}, and {{tt|waraji|草鞋}}.'), 'composed of a white shitagi, a black kosode, and waraji.', 'tt keeps its first parameter, the word, not the tooltip');
  eq(cleanWikitext('{{Character|name=Rukia|division=13th}}\nRukia is the lieutenant. {{Main|Elsewhere}}{{Quote|Long words|Speaker}}'), 'Rukia is the lieutenant.', 'an infobox, a hatnote and a quote still drop whole');
  eq(cleanWikitext("The '''Tenth Division''' (十番隊, ''jūbantai'') is one of the [[Gotei 13]]."), 'The Tenth Division (十番隊, jūbantai) is one of the Gotei 13.', 'plain markup as before');
  const note = 'What canon says about the people here.\nJūshirō Ukitake:\n  A tall, emaciated captain, Ukitake carries himself with courtesy. His illness forces him to rely on Reiatsu.\n  - With Yamamoto: Respects him.\nKiyone Kotetsu:\n  Open and excitable, Kiyone serves as lieutenant. At ease she is bubbly; under strain, especially when…\nSentarō Kotsubaki:\n  Loud and loyal.\n  - With Kiyone Kotetsu: He argues with her.';
  const t = trimCanonNote(note, { offscreen: { Ukitake: { location: 'dead — his grave on the Kuchiki plot', atTurn: 1 } }, characters: {} });
  assert(/Jūshirō Ukitake:\n  A tall, emaciated captain, Ukitake carries himself with courtesy\. \(Dead, in our story\.\)\n/.test(t), 'the dead face: one sentence, marked: ' + JSON.stringify(t));
  assert(!/With Yamamoto/.test(t), 'no With lines for the dead');
  assert(/Kiyone serves as lieutenant\.\nSentarō/.test(t), 'a cut block ends at its last whole sentence: ' + JSON.stringify(t));
  assert(/- With Kiyone Kotetsu: He argues with her\./.test(t), 'the living untouched');
  eq(trimCanonNote('', {}), '', 'nothing stays nothing');
});

test('M490-3 a crowd is grammar, not a word: nineteen people shaped like crowds stay people (M485 would have deleted their pages on load); eleven crowds are crowds; a canon face and the main character are never folded', async () => {
  const { healGhosts } = await import('../../js/engine/people.js');
  for (const n of ['Tōma of the guards', 'Captain of the guards', 'Squad Leader Hayes', 'Team Rocket Jessie', 'Band Captain Ito', 'Head of the servants', 'Mob Boss Carmine', 'Unit 01', 'Rest', 'Gang leader Vex', 'Pair of Hands', 'Couple Counselor Ann', 'the first officer', 'The man whose knees buckled', 'the woman in scrubs', 'Old Pell', 'Kara Zor-El', '1st Division runner', "Kiyone's runners"]) assert(!isGroupName(n), n + ' is a person');
  for (const n of ['the onlookers behind the taped line', 'The two police officers at the barricade', 'Onmitsukidō runners', 'the Onmitsukidō runners', 'a few villagers', 'the crowd', 'the people of Karakura', 'The rest', 'several guards', 'Men of the North', 'the guests watching from the rail']) assert(isGroupName(n), n + ' is a crowd');
  const s = emptyState(); s.sheet = { actors: {}, playerName: 'Jovan' };
  s.characters = { 'Captain of the guards': { core: 'a stern woman', updatedAtTurn: 1 }, 'Squad Leader Hayes': { core: 'leads the squad', updatedAtTurn: 1 }, 'the crowd': { core: 'people watching', updatedAtTurn: 1 } };
  s.canon = { 'the crowd': { facts: [] } };
  const h = healGhosts(s);
  assert(h.characters['Captain of the guards'] && h.characters['Squad Leader Hayes'], 'people keep their pages');
  assert(h.characters['the crowd'], 'a name canon knows is never folded, even crowd-shaped');
});

test('M490-3 the identity doors match who someone IS, exactly one or nobody: a word in someone’s state never makes a new person them; an ambiguous relation is nobody', () => {
  const s = emptyState(); s.sheet = { actors: {}, playerName: 'Jovan Arden' };
  s.characters = { Vivi: { core: 'Jovan’s rich younger stepsister; college student', state: 'says her driver is William’s spy', updatedAtTurn: 1 }, 'Kara Zor-El': { core: 'Kryptonian; Superman’s cousin', state: 'his friend now', updatedAtTurn: 1 }, 'Dev Okafor': { core: 'news drone operator; flew the drone', updatedAtTurn: 1 }, Marta: { core: 'the woman in scrubs who broke the line', updatedAtTurn: 1 }, Rukia: { core: 'Lieutenant of the 13th Division; his lieutenant', updatedAtTurn: 1 }, Claire: { core: 'His older sister.', updatedAtTurn: 1 }, Mara: { core: 'the innkeeper; her sister runs the ferry', updatedAtTurn: 1 } };
  for (const [n, want] of [['the driver', null], ['his friend', null], ["Jovan's stepsister", 'Vivi'], ['his stepsister', 'Vivi'], ["Superman's cousin", 'Kara Zor-El'], ['The news drone operator', 'Dev Okafor'], ['the woman in scrubs', 'Marta'], ['the lieutenant', 'Rukia'], ['the older sister', 'Claire'], ["Jovan's sister", null], ['his sister', null], ['the innkeeper', 'Mara']]) eq(resolveDescriptor(s, n), want, n);
});

test('M490-3 the paraphrase fold is the same moment only, and never the default: two facts one word apart from different pages stay two; knowledge.forget erases only the fact named', () => {
  let k = {};
  k = addKnowledge(k, 'Kara', 'that the ninja told Jovan about the cult three months ago', 3);
  k = addKnowledge(k, 'Kara', 'that the ninja told Jovan about the owls three months ago', 9);
  eq(k.Kara.length, 2, 'cult and owls are two facts');
  assert(!sameFact('that the ninja told Jovan about the cult three months ago', 'that the ninja told Jovan about the owls three months ago'), 'not the same by default');
  const r = applyMutations({ knowledge: { Kara: k.Kara } }, [{ type: 'knowledge.forget', name: 'Kara', fact: 'that the ninja told Jovan about the owls three months ago' }]);
  eq(r.state.knowledge.Kara.length, 1); assert(/cult/.test(r.state.knowledge.Kara[0].fact), 'forget took only the owls');
  let h = {};
  h = addKnowledge(h, 'Rukia', "that Jovan Oda rubbed Rukia Kuchiki's hair and asked her age in front of the courtyard", 3);
  h = addKnowledge(h, 'Renji', "that Jovan Oda rubbed Rukia's hair and asked her age in front of the whole courtyard", 3);
  eq(h.Renji[0].fact, h.Rukia[0].fact, 'the same moment for another person: one wording');
});

test('M490-3 the canon trim takes death only from the world’s own word (a dead seat) — a living face whose past holds a death keeps her canon whole', async () => {
  const { trimCanonNote } = await import('../../js/canon/bridge.js');
  const note = 'What canon says.\nKara Zor-El:\n  Kara is Superman\'s cousin, sent to Earth as a girl. She hides her powers behind a lab job.\n  - With Clark Kent: She trusts him.';
  const living = trimCanonNote(note, { offscreen: {}, characters: { 'Kara Zor-El': { core: 'Kryptonian; her parents died in the explosion of Krypton' } } });
  eq(living, note, 'kept whole');
  const dead = trimCanonNote(note, { offscreen: { 'Kara Zor-El': { location: 'dead — fell in the crater', atTurn: 1 } }, characters: {} });
  assert(/\(Dead, in our story\.\)/.test(dead), 'a dead seat still trims');
});

test('M490-3 the canon template reader keeps a term, never a file, a link, a reference or a spoiler (a spoiler is canon’s later events)', async () => {
  const { cleanWikitext } = await import('../../js/canon/grounding.js');
  eq(cleanWikitext('She stands. {{Image|Rukia portrait.png|thumb|left}} She waits.'), 'She stands. She waits.');
  eq(cleanWikitext('See {{Link|https://bleach.fandom.com/wiki/Rukia}} there.'), 'See there.');
  eq(cleanWikitext('Fact.{{Ref|Chapter 50}} More.'), 'Fact. More.');
  eq(cleanWikitext('{{Spoiler|She becomes captain.}} Now.'), 'Now.');
  eq(cleanWikitext('A {{Translation|Tenth Division|十番隊}} captain.'), 'A Tenth Division captain.');
  eq(cleanWikitext('An {{Unknown|thing.png|real words}} end.'), 'An real words end.', 'a file skipped, the words kept');
});
