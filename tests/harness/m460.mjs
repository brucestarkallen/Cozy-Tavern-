/* M460: the last repeats in his notes — each lacked fact said once with everyone who lacks it, and the series' own look
 * lines without the wiki's scraps or how they looked long ago. Runs the real renderers on his own lines. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { renderBlindSpots, BLIND_LINE } from '../../js/engine/world.js';
import { renderCanon, cleanWikiWords } from '../../js/engine/canon.js';

test('M460-1 A FACT THEY LACK IS SAID ONCE, WITH EVERYONE WHO LACKS IT — every name, every fact and its knower, the marker kept; far shorter', () => {
  const people = ['Zaraki', 'Hitsugaya', 'Isane Kotetsu', 'Suì-Fēng', 'Lisa Yadōmaru', 'Kensei', 'Akihide', 'Rangiku Matsumoto', 'Byakuya Kuchiki', 'Renji Abarai', 'Rukia Kuchiki', 'Iba', 'Rose', 'Shunsui Kyoraku', '1st Division runner'];
  const facts = [["watched Zaraki's second attempt to rise fail under Isane's flat hands, and heard the boss laugh through a blood-cough", 'Ikkaku'],
    ['watched Rukia Kuchiki cross the blood-dotted sand alone and stop four regulation paces from Jovan Oda', 'Rangiku Matsumoto'],
    ['heard Renji ask where Rukia was and whether today was supposed to be hers', 'Rukia Kuchiki'],
    ["that Jovan's eyes brightened past what eyes do before the red punches landed", 'Suì-Fēng']];
  const spots = people.map((name) => ({ name, lacks: facts.filter(([, from]) => from !== name).map(([fact, from]) => ({ fact, from })) }));
  const oldWay = spots.map((s) => s.name + BLIND_LINE + s.lacks.map((l) => l.fact + ' (' + l.from + ' knows)').join('; ') + '.').join('\n');
  const said = renderBlindSpots(spots);
  assert(said.length < oldWay.length * 0.45, 'far shorter: ' + oldWay.length + ' → ' + said.length);
  for (const [fact, from] of facts) eq((said.match(new RegExp(fact.slice(0, 30).replace(/[.*+?^${}()|[\]\\']/g, '\\$&'), 'g')) || []).length, 1, 'said once: ' + fact.slice(0, 30));
  for (const p of people) assert(said.includes(p), p + ' is named');
  assert(said.includes(BLIND_LINE) && /\(Ikkaku knows\)/.test(said), 'the marker and the knower');
  for (const s of spots) for (const l of s.lacks) {
    const line = said.split('\n').find((x) => x.includes(l.fact));
    assert(line.split(BLIND_LINE)[0].split(', ').includes(s.name), s.name + ' still lacks ' + l.fact.slice(0, 20));
  }
});

test('M460-2 THE SERIES’ LOOK WITHOUT THE WIKI’S SCRAPS OR THE PAST — his own truths never touched', () => {
  eq(cleanWikiWords(".]] Renji has brown eyes and long crimson hair. Even as a child, Renji's hairline was leveled. Later, he would style it in a large widow's peak."), "Renji has brown eyes and long crimson hair. Later, he would style it in a large widow's peak.");
  eq(cleanWikiWords('He has slate gray eyes and long black hair, which he keeps up in intricate white headpieces called .'), 'He has slate gray eyes and long black hair, which he keeps up in intricate white headpieces.');
  eq(cleanWikiWords("A petite woman with gray eyes. 110 years ago, Suì-Fēng's hair was shoulder-length."), 'A petite woman with gray eyes.');
  eq(cleanWikiWords('While she was lieutenant under Isshin Kurosaki, her hair was shoulder length. Rangiku has long and wavy blond hair.'), 'Rangiku has long and wavy blond hair.');
  eq(cleanWikiWords("Seventeen months after Aizen's defeat, Iba has a fuller moustache."), "Seventeen months after Aizen's defeat, Iba has a fuller moustache.", 'the latest look stays');
  const canon = { 'Renji Abarai': { facts: [{ key: 'look', value: '.]] Renji has brown eyes. Even as a child, he was loud.', source: 'canon' }] }, 'Jovan Oda': { facts: [{ key: 'look', value: '.]] as he wrote it' }] } };
  const said = renderCanon(canon, ['Renji Abarai', 'Jovan Oda']);
  assert(/Renji Abarai — look: Renji has brown eyes\./.test(said) && !/child/.test(said), 'the series cleaned: ' + said);
  assert(/Jovan Oda — look: \.\]\] as he wrote it/.test(said), 'his own, exactly as written');
});
