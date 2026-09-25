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
  assert(sameFact('that Jovan Oda treats her as a child — rubbed her hair and asked her age in front of the whole courtyard', 'that Jovan Oda rubbed Rukia Kuchiki\'s hair and asked her age in front of the courtyard'));
  assert(sameFact('Jovan Oda said he is not here to replace anyone but to continue Captain Ukitake\'s legacy, so that when their times come they can smile', 'that Jovan Oda intends to tell the Thirteenth Division he is not there to replace anyone but to continue Captain Ukitake\'s legacy'));
  assert(!sameFact('heard the intercom buzzer go off twice, then a third time, while Kara was kneeling at the sofa', 'that her name is Kara Zor-El, offered plainly as an introduction'));
  assert(!sameFact('that Jovan lives in the Arden tower with a sun panel', 'that Jovan kept his stepsister\'s sun panel and turned it on'), 'a shared subject is not the same fact');
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
