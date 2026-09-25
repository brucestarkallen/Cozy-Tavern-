/* M492 — THE LIVING LEDGER, SIMULATED. A fifteen-page tale in the shape of the writer's DC story is run through the real
 * engine: each page the page reader's mutations pass the real leave gate (goneAtTheEnd unless the scene moved), then the
 * real heals run (wrongWalkIns, hereByTheNewestPage, goneByTheirOwnPage) — and after every page the ledger is checked
 * against the story's truth (who is here, who is away and where) and its invariants (one person one page, nobody both
 * here and away, no crowd as a person, one wound per body part, no fact twice, the dead never here, the briefing
 * bounded). Every fault found here is a fault the models would have fed and the house kept. */
import './idb-shim.mjs';
import { test, assert } from './lib.mjs';
import { applyMutations, goneAtTheEnd, hereByTheNewestPage, goneByTheirOwnPage, wrongWalkIns, seatAtScene } from '../../js/engine/apply.js';
import { emptyState } from '../../js/engine/state.js';
import { isGroupName, renderPeopleTiers, peopleView } from '../../js/engine/people.js';
import { samePersonName } from '../../js/engine/names.js';
import { bodyPartOf } from '../../js/engine/bodies.js';
import { renderOffscreen, isDeadSeat } from '../../js/engine/offscreen.js';

const H = (place, t) => `[Metropolis — ${place} — Tuesday | ${t} | night | coat | here]\n\n`;
const PAGES = [
  { place: 'the crater', t: '17:00', text: 'Jovan stands over Kara in the crater. Varkhos looms at the rim. Marta runs to Kara\'s side.',
    muts: [{ type: 'place.set', name: 'Metropolis — the crater' }, { type: 'presence.enter', name: 'Kara Zor-El' }, { type: 'presence.enter', name: 'Varkhos' }, { type: 'presence.enter', name: 'Marta' },
      { type: 'people.set', name: 'Kara Zor-El', field: 'core', text: 'Kryptonian; Superman’s cousin' }, { type: 'people.set', name: 'Marta', field: 'core', text: 'the woman in scrubs; a clinic nurse' }, { type: 'people.set', name: 'Varkhos', field: 'core', text: 'the omega threat' }],
    here: ['Jovan Arden', 'Kara Zor-El', 'Varkhos', 'Marta'] },
  { place: 'the crater', t: '17:05', text: 'Varkhos\'s fist drives Jovan to one knee. Kara coughs blood; her ribs give.',
    muts: [{ type: 'body.injure', name: 'Kara Zor-El', what: 'broken ribs', sev: 2 }, { type: 'body.injure', name: 'Jovan Arden', what: 'right knee struck by the fist', sev: 2 }, { type: 'body.injure', name: 'Varkhos', what: 'left arm unmade by the violet technique', sev: 3 }],
    here: ['Jovan Arden', 'Kara Zor-El', 'Varkhos', 'Marta'] },
  { place: 'the crater', t: '17:10', text: 'Varkhos staggers back into the dark and is gone. Marta presses the clinic address into Jovan\'s hand.',
    muts: [{ type: 'presence.leave', name: 'Varkhos' }, { type: 'offscreen.set', name: 'Varkhos', location: 'the old cannery', activity: 'repairing' }],
    here: ['Jovan Arden', 'Kara Zor-El', 'Marta'] },
  { place: 'Jovan\'s apartment, living room', t: '17:40', text: 'Jovan lands on the balcony with Kara in his arms and lays her on the sofa.',
    muts: [{ type: 'place.set', name: 'Metropolis — Jovan\'s apartment, living room' }, { type: 'presence.leave', name: 'Marta' }, { type: 'offscreen.set', name: 'Marta', location: 'the clinic on Montgomery', activity: 'waiting by the phone' }],
    here: ['Jovan Arden', 'Kara Zor-El'] },
  { place: 'Jovan\'s apartment, living room', t: '19:00', text: 'Vivi lets herself in, tote on her shoulder, and stares at Supergirl on the sofa.',
    muts: [{ type: 'presence.enter', name: 'Vivi', attire: 'dusty rose sleep shirt' }, { type: 'people.set', name: 'Vivi', field: 'core', text: 'Jovan’s rich younger stepsister; college student' },
      { type: 'knowledge.add', name: 'Vivi', fact: 'that Supergirl is on Jovan’s sofa, bleeding' }, { type: 'knowledge.add', name: 'Kara Zor-El', fact: 'that Supergirl, bleeding, is on Jovan’s sofa as his stepsister walks in' }],
    here: ['Jovan Arden', 'Kara Zor-El', 'Vivi'] },
  { place: 'Jovan\'s apartment, living room', t: '19:30', text: 'Jovan tells them both about the cult. "The ninja told me about the cult three months ago," he says.',
    muts: [{ type: 'knowledge.add', name: 'Kara Zor-El', fact: 'that the ninja told Jovan about the cult three months ago' }, { type: 'knowledge.add', name: 'Vivi', fact: 'that the ninja told Jovan about the cult three months ago' }],
    here: ['Jovan Arden', 'Kara Zor-El', 'Vivi'] },
  { place: 'Jovan\'s apartment, living room', t: '08:40', text: 'Vivi hugs him goodbye, one-armed, and is out the door with her tote on her shoulder. The elevator chimes.\n\nKara curls up on the sofa in Vivi\'s rolled gray pants.',
    muts: [{ type: 'presence.leave', name: 'Vivi' }, { type: 'offscreen.set', name: 'Vivi', location: 'leaving Jovan’s apartment building', activity: 'texting Mom' }, { type: 'people.set', name: 'Vivi', field: 'state', text: 'Leaving Jovan’s apartment building — tote on her shoulder' }],
    here: ['Jovan Arden', 'Kara Zor-El'], away: ['Vivi'] },
  { place: 'Jovan\'s apartment, living room', t: '08:50', text: 'Kara sits beside him in Vivi\'s shirt. "Vivi would kill you," she says.',
    muts: [], here: ['Jovan Arden', 'Kara Zor-El'], away: ['Vivi'] },
  { place: 'Jovan\'s apartment, living room', t: '09:00', text: 'Claire lets herself in with a key and a garment bag, frowning at the sofa.',
    muts: [{ type: 'presence.enter', name: 'Claire' }, { type: 'people.set', name: 'Claire', field: 'core', text: 'His older sister.' }],
    here: ['Jovan Arden', 'Kara Zor-El', 'Claire'] },
  { place: 'Jovan\'s apartment, living room', t: '09:20', text: 'Claire kisses his temple, takes the garment bag and steps into the elevator.',
    muts: [{ type: 'people.set', name: 'Claire', field: 'state', text: 'Left for the airport — a board meeting in Gotham' }], /* the reader wrote her state, not her leave */
    here: ['Jovan Arden', 'Kara Zor-El'], away: ['Claire'] },
  { place: 'Jovan\'s apartment, living room', t: '09:40', text: 'The news murmurs from the kitchen. Kara reads the owl file.',
    muts: [{ type: 'offscreen.set', name: 'Dev Okafor', location: 'the news truck on Lombard', activity: 'hunting the landing spot' }, { type: 'people.set', name: 'Dev Okafor', field: 'core', text: 'news drone operator' },
      { type: 'offscreen.set', name: 'the onlookers behind the taped line', location: 'the crater', activity: 'filming' }, { type: 'people.set', name: 'the onlookers behind the taped line', field: 'core', text: 'a crowd' },
      { type: 'offscreen.set', name: 'The news drone operator', location: 'the news truck on Lombard', activity: 'bent over the map' },
      { type: 'knowledge.add', name: 'Kara Zor-El', fact: 'that the ninja told Jovan about the owls three months ago' }],
    here: ['Jovan Arden', 'Kara Zor-El'], away: ['Vivi', 'Claire', 'Dev Okafor'] },
  { place: 'Jovan\'s apartment, living room', t: '10:00', text: 'Kara winces; the ribs again. Jovan\'s knee locks on the step.',
    muts: [{ type: 'body.injure', name: 'Kara Zor-El', what: 'broken ribs, worse after the sofa', sev: 3 }, { type: 'body.injure', name: 'Jovan Arden', what: 'right knee worsened by the climb', sev: 2 }],
    here: ['Jovan Arden', 'Kara Zor-El'] },
  { place: 'Jovan\'s apartment, living room', t: '10:20', text: 'On the news, the cannery burns. Kara goes still.',
    muts: [{ type: 'offscreen.set', name: 'Varkhos', location: 'dead — destroyed at the cannery', activity: '' }],
    here: ['Jovan Arden', 'Kara Zor-El'], dead: ['Varkhos'] },
  { place: 'Jovan\'s apartment, living room', t: '11:00', text: 'Vivi is back, arms full of groceries, kicking the door shut behind her.',
    muts: [{ type: 'presence.enter', name: 'Vivi' }, { type: 'people.set', name: 'Vivi', field: 'state', text: 'back with groceries, bossing the kitchen' }],
    here: ['Jovan Arden', 'Kara Zor-El', 'Vivi'] },
  { place: 'Jovan\'s apartment, living room', t: '11:30', text: 'Vivi takes her tote and the door shuts behind Vivi. Kara laughs into her coffee.',
    muts: [{ type: 'presence.leave', name: 'Vivi' }, { type: 'offscreen.set', name: 'Vivi', location: 'home', activity: 'getting ready for the noon study' }],
    here: ['Jovan Arden', 'Kara Zor-El'], away: ['Vivi', 'Claire'] },
];

test('M492 THE LIVING LEDGER: fifteen pages through the real leave gate and the real heals — who is here matches the story on every page, the absent are seated, and every invariant holds', () => {
  let s = emptyState();
  s.sheet = { actors: {}, playerName: 'Jovan Arden' };
  s.present = [{ name: 'Jovan Arden' }];
  const told = [];
  const faults = [];
  const sizes = [];
  PAGES.forEach((pg, i) => {
    s.page = i;
    const page = H(pg.place, pg.t) + pg.text;
    const was = s.place && s.place.name;
    const ground = (pg.muts.find((m) => m.type === 'place.set') || {}).name || '';
    const moved = Boolean(was && ground && ground !== was && !seatAtScene(was, ground));
    const gated = pg.muts.filter((m) => m.type !== 'presence.leave' || (moved ? !pg.here.includes(m.name) : goneAtTheEnd(s, page, m.name)));
    s = applyMutations(s, gated).state;
    told.push({ text: page });
    const heal = [...wrongWalkIns(s, told), ...hereByTheNewestPage(s, page), ...goneByTheirOwnPage(s, page)];
    if (heal.length) s = applyMutations(s, heal).state;
    const here = (s.present || []).map((p) => p.name);
    const seats = Object.keys(s.offscreen || {});
    const P = 'page ' + (i + 1) + ': ';
    for (const want of pg.here) if (!here.some((h) => samePersonName(h, want))) faults.push(P + want + ' should be here — here: ' + here.join(', '));
    for (const h of here) if (!pg.here.some((w) => samePersonName(h, w))) faults.push(P + h + ' is here but the story has them gone');
    for (const a of pg.away || []) if (!seats.some((k) => samePersonName(k, a))) faults.push(P + a + ' left but holds no seat in Elsewhere');
    for (const h of here) if (seats.some((k) => samePersonName(k, h) && !isDeadSeat(s.offscreen[k]))) faults.push(P + h + ' is both here and seated away');
    for (const n of [...here, ...seats, ...Object.keys(s.characters || {})]) if (isGroupName(n)) faults.push(P + 'a crowd as a person: ' + n);
    const keys = Object.keys(s.characters || {});
    for (let a = 0; a < keys.length; a += 1) for (let b = a + 1; b < keys.length; b += 1) if (samePersonName(keys[a], keys[b])) faults.push(P + 'two pages for one person: ' + keys[a] + ' / ' + keys[b]);
    for (const [who, body] of Object.entries(s.bodies || {})) {
      const parts = (body.injuries || []).filter((x) => x && !x.healed).map((x) => bodyPartOf(x.what)).filter(Boolean);
      if (new Set(parts).size !== parts.length) faults.push(P + who + ' carries one wound twice: ' + parts.join(', '));
    }
    for (const [who, list] of Object.entries(s.knowledge || {})) { const f = list.map((x) => x.fact); if (new Set(f).size !== f.length) faults.push(P + who + ' holds a fact twice'); }
    for (const d of pg.dead || []) {
      if (here.some((h) => samePersonName(h, d))) faults.push(P + 'the dead ' + d + ' is here');
      const off = renderOffscreen(s.offscreen, s.present, 0, 12, s.characters);
      if (!/\nDead: |^Dead: /.test(off) || !off.includes(d)) faults.push(P + 'the dead ' + d + ' is not on the Dead line: ' + JSON.stringify(off));
    }
    sizes.push(renderPeopleTiers(s, { recentPages: told.slice(-6).map((x) => x.text), view: peopleView(200000), seatsInState: true }).text.length);
  });
  const k = (s.knowledge || {})['Kara Zor-El'] || [];
  if (!(k.some((x) => /cult/.test(x.fact)) && k.some((x) => /owls/.test(x.fact)))) faults.push('end: Kara lost a fact — the cult and the owls must both stand: ' + JSON.stringify(k.map((x) => x.fact)));
  if (Object.keys(s.offscreen || {}).some((n) => /news drone operator/i.test(n))) faults.push('end: the role "The news drone operator" holds a seat of its own beside Dev Okafor');
  console.log('      M492 briefing size by page (people): ' + sizes.join(' '));
  assert(!faults.length, faults.length + ' fault(s):\n        ' + faults.join('\n        '));
});
