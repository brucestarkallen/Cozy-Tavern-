/* M508 — the state of things, leaner and truer: the main character's book is the writer's; a core made of a seat is
 * let go; a blind spot names a long fact in its first words. */
import { test, assert, eq } from './lib.mjs';
import { applyMutations, seatMadeCores, descriptorsThatAreNamed } from '../../js/engine/apply.js';
import { emptyState, renderStateFacts } from '../../js/engine/state.js';
import { renderKnowledge, KNOWLEDGE_MC, BLIND_CLIP, renderBlindSpots, blindSpots } from '../../js/engine/world.js';
import { renderPeopleTiers } from '../../js/engine/people.js';

const H = (present) => applyMutations({ ...emptyState(), page: 30 }, [{ type: 'mc.set', name: 'Jovan Oda' }, { type: 'place.set', name: 'the courtyard' }, { type: 'presence.enter', name: 'Jovan Oda' }, ...present.map((n) => ({ type: 'presence.enter', name: n }))]).state;

test('M508-1 the main character never stands in "Everyone here but …": a public moment the reader left out of his book is still everyone’s, and his own list is his newest few, nothing older called back', () => {
  let st = H(['Rukia', 'Renji', 'Byakuya', 'Kensei']);
  const fact = 'saw Jovan Oda stop the cut with a bare palm and stab Zaraki in the kidney';
  st = applyMutations(st, ['Rukia', 'Renji', 'Byakuya', 'Kensei'].map((n) => ({ type: 'knowledge.add', name: n, fact })).concat(Array.from({ length: 9 }, (_, i) => ({ type: 'knowledge.add', name: 'Jovan Oda', fact: 'was told thing number ' + i + ' by someone at the rail' })))).state;
  const out = renderKnowledge(st.knowledge, st.present, Infinity, { pages: ['the courtyard and the kidney and the palm'], ignore: ['Jovan Oda'], mc: 'Jovan Oda', turn: 31 });
  assert(/^Everyone here knows: saw Jovan Oda stop the cut/m.test(out), 'everyone, not "everyone but Jovan Oda": ' + out);
  assert(!/but Jovan Oda/.test(out), out);
  const his = out.split('\n').find((l) => l.startsWith('Jovan Oda knows'));
  assert(his && (his.match(/thing number/g) || []).length === KNOWLEDGE_MC && /and 5 older things/.test(his) && !/From much earlier/.test(his), 'his newest ' + KNOWLEDGE_MC + ', the rest counted, none called back: ' + his);
});

test('M508-2 a core made of a seat is let go on opening — Renji at the rail no longer "at the Sixth’s training ground"; a real core, and one the writer wrote by hand, stay', () => {
  let st = H(['Renji Abarai']);
  st = applyMutations(st, [
    { type: 'people.set', name: 'Renji Abarai', field: 'core', text: 'pushing the forms hard, his mind on Rukia; wants find Rukia after the assembly; at 6th Division training ground, running forms' },
    { type: 'people.set', name: 'Iba', field: 'core', text: 'signing requisitions with a blunt brush; at 7th Division barracks' },
    { type: 'people.set', name: 'Momo Hinamori', field: 'core', text: 'lieutenant of the 5th Division under Shinji Hirako; still carrying the war’s weight' },
    { type: 'people.set', name: 'Byhand', field: 'core', text: 'a courier; wants gold; at the gate' },
  ]).state;
  st.characters.Byhand.hand = { core: true };
  const muts = seatMadeCores(st);
  eq(muts.map((m) => m.name).sort().join(','), 'Iba,Renji Abarai', 'the seat-shaped cores, and only those');
  const next = applyMutations(st, muts).state;
  eq(next.characters['Renji Abarai'].core, '');
  eq(next.characters['Momo Hinamori'].core, 'lieutenant of the 5th Division under Shinji Hirako; still carrying the war’s weight', 'a real core stays');
  eq(next.characters.Byhand.core, 'a courier; wants gold; at the gate', 'his hand is his');
  const block = renderPeopleTiers(next, { recentPages: [], rotation: 0, brief: '', scenePages: [] }).text;
  assert(/Renji Abarai/.test(block) && !/training ground/.test(block), 'the block no longer says he is at the yard: ' + block);
  const before = renderPeopleTiers(st, { recentPages: [], rotation: 0, brief: '', scenePages: [] }).text;
  assert(/training ground/.test(before), 'fixture: it did say so before the heal');
  eq(seatMadeCores(next).length, 0, 'nothing left to let go');
});

test('M508-3 a page the world agent opens for someone it seats is EMPTY, and never touches a page that exists', () => {
  let st = H([]);
  let r = applyMutations(st, [{ type: 'people.set', name: 'Kim', field: 'core', open: true }]);
  eq(r.applied.length, 1); eq(r.state.characters.Kim.core, '');
  st = r.state;
  r = applyMutations(st, [{ type: 'people.set', name: 'Kim', field: 'core', text: 'the mother' }]); st = r.state;
  r = applyMutations(st, [{ type: 'people.set', name: 'Kim', field: 'core', open: true }]);
  eq(r.applied.length, 0); eq(r.state.characters.Kim.core, 'the mother', 'an open over a real core changes nothing');
  eq(r.rejected[0] && r.rejected[0].why, 'they have a page already');
});

test('M508-4 a blind spot names a long fact in its first words; the whole fact stands above under whoever knows it', () => {
  let st = H(['Rukia', 'Renji']);
  const long = 'heard Nanao Ise report that the roster acceptance for the Thirteenth Division was penned Sunday the twenty-seventh of Hatsuharu, one original and two sealed copies dispatched the same day from the First’s out-box, one to the Thirteenth’s records desk and one to the Second Division, with no routing entries after the out-box';
  st = applyMutations(st, [{ type: 'knowledge.add', name: 'Renji', fact: long }]).state;
  const spots = blindSpots(st.knowledge, st.present, { scenePages: ['the roster acceptance and the out-box'], turn: 31, mc: 'Jovan Oda' });
  const said = renderBlindSpots(spots);
  assert(/Rukia hasn’t found out: heard Nanao Ise report that the roster acceptance/.test(said), said);
  assert(said.includes('… (Renji knows)') && !said.includes('no routing entries'), 'clipped, with the knower: ' + said);
  assert(said.length < long.length, 'shorter than the fact');
  const facts = renderStateFacts(st, { whole: true, budget: 60000, scenePages: ['the roster acceptance and the out-box'] });
  assert(facts.includes(long), 'the whole fact stands under Renji');
  assert(BLIND_CLIP >= 120, 'a blind spot still says what the fact is about');
});

test('M509-1 the shorter list names a shared fact ("Everyone here but" eight, not "Known to" twelve); a fact that stands as a shared line is not said again as a blind spot; a word in most facts calls nothing back', () => {
  const present = Array.from({ length: 20 }, (_, i) => 'Person' + String.fromCharCode(65 + i) + ' Vale');
  let st = H(present);
  const fact = 'heard Jovan Oda thank the courtyard and promise to do his duty and his best to serve, and saw him run out of the Tenth’s ground';
  st = applyMutations(st, present.slice(0, 12).map((n) => ({ type: 'knowledge.add', name: n, fact }))).state;
  const facts = renderStateFacts(st, { whole: true, budget: 60000, scenePages: ['The courtyard watched him run.'] });
  const line = facts.split('\n').find((l) => l.includes('thank the courtyard')).replace(/^Who knows what: /, '');
  assert(/^Everyone here but /.test(line) && (line.match(/Vale/g) || []).length === 8, 'eight named, not twelve: ' + line);
  assert(!/hasn’t found out: heard Jovan Oda thank the courtyard/.test(facts), 'the eight are out of it by the line above — not again as a blind spot: ' + facts.split('\n').filter((l) => /hasn’t found out/.test(l)).join(' | '));
  /* a private word to one person is still a blind spot for the rest */
  st = applyMutations(st, [{ type: 'knowledge.add', name: present[0], fact: 'heard Hitsugaya say, close, that whatever he just remembered stays out of the stones' }]).state;
  const facts2 = renderStateFacts(st, { whole: true, budget: 60000, scenePages: ['The stones and the courtyard.'] });
  assert(/hasn’t found out: heard Hitsugaya say, close/.test(facts2), 'a private word stays a blind spot');
});

test('M509-2 a word that is in most facts is not what makes an old fact bear on the scene: a 46-page-old report is called back for "post station", never for "courtyard"', () => {
  let st = H(['Rukia Kuchiki']);
  const old = 'heard Nanao Ise report that the roster acceptance was penned at the post station, five days in transit, in the Tenth’s courtyard before the captain';
  st = applyMutations({ ...st, page: 2 }, [{ type: 'knowledge.add', name: 'Rukia Kuchiki', fact: old }]).state;
  for (let p = 3; p < 48; p += 1) st = applyMutations({ ...st, page: p }, [{ type: 'knowledge.add', name: 'Rukia Kuchiki', fact: 'saw the captain in the Tenth’s courtyard on page ' + p }]).state;
  st.page = 48;
  const byPlace = renderKnowledge(st.knowledge, st.present, Infinity, { pages: ['The captain stood in the Tenth’s courtyard and looked at the bench.'], ignore: ['Jovan Oda'], mc: 'Jovan Oda', turn: 49 });
  assert(!/Nanao Ise report/.test(byPlace), '"courtyard", "captain", "Tenth" are in every fact — they call nothing back: ' + byPlace.slice(0, 200));
  const byWord = renderKnowledge(st.knowledge, st.present, Infinity, { pages: ['A runner came from the post station with word of the transit.'], ignore: ['Jovan Oda'], mc: 'Jovan Oda', turn: 49 });
  assert(/From much earlier[^\n]*Nanao Ise report/.test(byWord), 'its own words still call it back, dated: ' + byWord.slice(0, 300));
});

test('M509-3 an episode or a chapter page is never a person: its cast list is not a face, its lead says what it is', async () => {
  const { isEpisodeOrChapterPage } = await import('../../js/canon/grounding.js');
  const ep = "{{Episode\n| title = Muguruma's 9th Division, Moves Out\n| number = 313\n| airdate = March 8, 2011\n| appearance = [[Shinji Hirako]] [[Sōsuke Aizen]] [[Hiyori Sarugaki]] [[Kisuke Urahara]]\n}}\n'''Muguruma's 9th Division, Moves Out''' is the three hundred thirteenth episode of the ''[[Bleach (anime)|Bleach]]'' anime.\n\n==Summary==\nShinji Hirako carries himself with a casual air…";
  const person = "{{Infobox character\n| name = Kensei Muguruma\n| gender = Male\n| hair = Silver\n| eyes = Brown\n}}\n'''Kensei Muguruma''' is the captain of the [[9th Division]].\n\n==Appearance==\nA tall, muscular man…";
  const chapter = "{{Chapter\n| number = 214\n}}\n'''Immanent God Blues''' is the two hundred fourteenth chapter of the ''Bleach'' manga.";
  const plain = "'''Kensei Muguruma''' is a captain.\n\n==Personality==\nDecisive, serious.";
  eq(isEpisodeOrChapterPage(ep), true); eq(isEpisodeOrChapterPage(chapter), true);
  eq(isEpisodeOrChapterPage(person), false); eq(isEpisodeOrChapterPage(plain), false);
});

test('M509-4 "the courier" is Hachigorō: a role the ledger names in apposition resolves to the named page (unicode names too), the descriptor walks in as him, and one already standing beside him is joined on the next look', () => {
  let st = H(['Hachigorō']);
  st = applyMutations(st, [
    { type: 'people.set', name: 'Hachigorō', field: 'core', text: 'sitting with his back to the wall, a borrowed straw hat low over his face, turning a folded paper over in his hands' },
    { type: 'thread.set', title: 'Suì-Fēng and the intercepted mail', owner: 'Suì-Fēng', next: 'take custody of the paper and the courier Hachigorō before the trail goes cold' },
    { type: 'knowledge.add', name: 'Byakuya', fact: 'saw the courier Hachigorō ride into the Tenth’s courtyard and call out' },
  ]).state;
  const r = applyMutations(st, [{ type: 'presence.enter', name: 'the courier', position: 'hauled along the path' }]);
  eq(r.state.present.map((p) => p.name).join(','), 'Jovan Oda,Hachigorō', 'the descriptor is the man: ' + r.applied.map((a) => a.words).join(' | '));
  /* a store where both already stand */
  const both = { ...st, present: [...st.present, { name: 'the courier', position: 'on the path' }] };
  both.characters = { ...both.characters, 'the courier': { core: 'road-beaten', state: 'hauled along', arc: '', threads: [] } };
  const muts = descriptorsThatAreNamed(both);
  eq(muts.map((m) => m.type + ' ' + m.from + ' → ' + m.to).join(','), 'people.rename the courier → Hachigorō');
  const joined = applyMutations(both, muts).state;
  eq(joined.present.map((p) => p.name).join(','), 'Jovan Oda,Hachigorō');
  assert(!joined.characters['the courier'] && joined.characters['Hachigorō'], 'one page');
  eq(descriptorsThatAreNamed(joined).length, 0, 'nothing left to join');
  /* a role nobody is named for stays a person of their own; a short role ("the cook") is never resolved */
  const lone = applyMutations(st, [{ type: 'presence.enter', name: 'the postmaster', position: 'at the counter' }]).state;
  assert(lone.present.some((p) => p.name === 'the postmaster'), 'a postmaster the ledger names no one for is his own man');
  eq(descriptorsThatAreNamed(lone).length, 0);
});

test('M509-5 a cached canon entry that is an episode (its look a cast list) is poison, and its page read again is let go', async () => {
  const { isCastListLook, isEpisodeOrChapterPage } = await import('../../js/canon/grounding.js');
  eq(isCastListLook('Shinji Hirako Sousuke Aizen Hiyori Sarugaki Kisuke Urahara Mayuri Kurotsuchi Kensei Muguruma Heizō Kasaki Kaname Tōsen Izaemon Tōdō Shinobu Eishima Mashiro Kuna Shūhei Hisagi Torahiko Gyūji Akon'), true);
  eq(isCastListLook('A tall, muscular man with sharp features, short light-gray/silver hair and brown eyes. He has a tattoo of the number "69" on his chest.'), false);
  eq(isCastListLook('Silver hair, brown eyes'), false);
  eq(isEpisodeOrChapterPage("{{Episode\n| number = 313\n| airdate = March 8, 2011\n}}\n'''Muguruma's 9th Division, Moves Out''' is the three hundred thirteenth episode of the ''Bleach'' anime."), true);
});

test('M509-11 the ledger says which page it belongs to: even with the story, behind it (a rebuild moving page by page), or with no page yet', async () => {
  const { ledgerStandingWords, emptyState, markPageRead } = await import('../../js/engine/state.js');
  let st = { ...emptyState() };
  eq(ledgerStandingWords(st, 0), 'The ledger has no page yet.');
  eq(ledgerStandingWords(st, 3), 'The ledger has read none of the 3 pages yet — the readers are on them.');
  markPageRead(st, 0);
  eq(ledgerStandingWords(st, 3), 'The ledger stands at page 1 of 3 — the readers are on the rest.');
  markPageRead(st, 1); markPageRead(st, 2);
  eq(ledgerStandingWords(st, 3), 'The ledger stands at page 3 of 3 — even with the story.');
  eq(ledgerStandingWords(st, 2), 'The ledger stands at page 2 of 2 — even with the story.', 'a page let go: never "3 of 2"');
});

test('M509-12 the crowd does not ride to the new ground: when the page moves the ground and names who is in the new room, everyone else in the old room is left behind there; the dress is not said twice in a position', async () => {
  const { extractTurn } = await import('../../js/agents/extractor.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const { withoutAttire } = await import('../../js/engine/apply.js');
  let st = applyMutations({ ...emptyState(), page: 50 }, [{ type: 'mc.set', name: 'Jovan Oda' }, { type: 'place.set', name: 'Tenth Division courtyard' }, { type: 'presence.enter', name: 'Jovan Oda' }, ...['Rukia Kuchiki', 'Renji Abarai', 'Byakuya', 'the cook', 'Hachigorō'].map((n) => ({ type: 'presence.enter', name: n }))]).state;
  const H = '[the approach road to the Thirteenth — Sunday, Hanami 5, 1001 | 12:16 | clear | shihakushō | on the road]\n\n';
  const page = H + 'Jovan ran. Rukia walked ahead of him on the approach road. The runner skidded to a halt before them.';
  const answer = JSON.stringify({ mutations: [{ type: 'presence.enter', name: 'the runner', position: 'in the road' }], here: ['Jovan Oda', 'Rukia Kuchiki', 'the runner'], brief: { pressure: [], ripe: [], twb: null }, deltas: [] });
  const h = HOUSES[0];
  const house = thinkingHouse({ answer });
  const read = await withHouse(house, () => extractTurn({ connection: h.conn, state: st, userText: 'I run.', assistantText: page, pageNumber: 50 }));
  const leaves = read.mutations.filter((m) => m.type === 'presence.leave').map((m) => m.name).sort();
  eq(leaves.join(','), 'Byakuya,Hachigorō,Renji Abarai,the cook', 'the four the page’s room does not name are left behind; Rukia (named) and Jovan (the main character) are not: ' + JSON.stringify(read.mutations.map((m) => m.type + ' ' + (m.name || ''))));
  const after = applyMutations(st, read.mutations).state;
  eq(after.present.map((p) => p.name).sort().join(','), 'Jovan Oda,Rukia Kuchiki,the runner', 'the road holds three');
  assert(after.offscreen['the cook'] && /courtyard/i.test(after.offscreen['the cook'].location || ''), 'the cook is seated where he was left: ' + JSON.stringify(after.offscreen['the cook']));
  /* the same page with NO room named leaves nobody behind — a reader that said nothing */
  const mute = JSON.stringify({ mutations: [], brief: { pressure: [], ripe: [], twb: null }, deltas: [] });
  const read2 = await withHouse(thinkingHouse({ answer: mute }), () => extractTurn({ connection: h.conn, state: st, userText: 'I run.', assistantText: page, pageNumber: 50 }));
  eq(read2.mutations.filter((m) => m.type === 'presence.leave').length, 0, 'no room named, no leaves written');
  /* the dress */
  eq(withoutAttire('at the inner gate shadow, black, headband dark with sweat', 'black, headband dark with sweat'), 'at the inner gate shadow');
  eq(withoutAttire('at the veranda rail, hands on the wood', 'the Tenth’s armband'), 'at the veranda rail, hands on the wood');
  const moved = applyMutations(st, [{ type: 'presence.update', name: 'Renji Abarai', attire: 'black, headband dark with sweat' }, { type: 'presence.update', name: 'Renji Abarai', position: 'at the inner gate shadow, black, headband dark with sweat' }]).state;
  const renji = moved.present.find((p) => p.name === 'Renji Abarai');
  eq(renji.position, 'at the inner gate shadow'); eq(renji.attire, 'black, headband dark with sweat');
});
