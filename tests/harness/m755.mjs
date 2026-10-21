/* Cozy Tavern — harness laws of M755: he walks out with her, and the one who stayed is left behind.
 * His report (20 October 2026): "in my supernatural story… turn 3 there's mc Jovan, Claire and Vanessa. Turn 4 Vanessa asks
 * Jovan to walk with her. Turn 5 they're outside, turn 6 they're talking. But in the scene and the people Claire is still
 * stuck standing beside Jovan as in turn 3." The page's header kept naming the manor while the two of them walked out into
 * its garden: no move was read, the reader's own leave of Claire (the page never names her) was thrown away by M594's name
 * gate, and nobody was left behind. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations, mcGoesOut, mcWalksOff } from '../../js/engine/apply.js';

const MANOR = '[Ashford Manor — Monday, October 20, 2026 | 20:10 | rain | a dark coat | in the drawing room]\n\nVanessa set down her teacup and asked Jovan to walk with her. He nodded, and the two of them went out into the garden, the door clicking shut behind them.';
const GARDEN = '[Ashford Manor — Monday, October 20, 2026 | 20:20 | rain | a dark coat | in the garden]\n\nThe garden was dark and wet. Vanessa walked beside him, talking softly about the letter.';

function manor() {
  return applyMutations({ ...emptyState(), page: 2 }, [
    { type: 'mc.set', name: 'Jovan' },
    { type: 'place.set', name: 'Ashford Manor' },
    { type: 'clock.set', year: 2026, month: 10, day: 20, hour: 20, minute: 10 },
    { type: 'presence.enter', name: 'Jovan', position: 'in the drawing room' },
    { type: 'presence.enter', name: 'Claire', position: 'beside Jovan' },
    { type: 'presence.enter', name: 'Vanessa', position: 'at the window' },
  ]).state;
}
const answer = (mutations, here) => JSON.stringify({ mutations, here, brief: { pressure: [], ripe: [], twb: null }, deltas: [] });

async function turn(st, page, said, pageNumber) {
  const { extractTurn } = await import('../../js/agents/extractor.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  return withHouse(thinkingHouse({ answer: said }), () => extractTurn({ connection: HOUSES[0].conn, state: st, userText: 'I go with her.', assistantText: page, pageNumber }));
}

test('M755-1 HE WALKS OUT WITH HER AND THE ONE WHO STAYED IS LEFT: the page ends on the two of them going out into the garden, the page never names Claire, the header’s place does not change — the reader’s own leave of her stands (M594’s gate reads the company’s going), and she is not “here — beside Jovan” any more', async () => {
  const st = manor();
  const read = await turn(st, MANOR, answer([{ type: 'presence.leave', name: 'Claire', shown: 'the door clicking shut behind them', to: 'the drawing room of Ashford Manor' }], ['Jovan', 'Vanessa']), 3);
  assert(read.mutations.some((m) => m.type === 'presence.leave' && m.name === 'Claire'), 'her leave stands: ' + JSON.stringify(read.mutations));
  const after = applyMutations(st, read.mutations).state;
  assert(!after.present.some((p) => p.name === 'Claire'), 'not in the scene');
  eq(after.present.find((p) => p.name === 'Jovan').position, 'in the drawing room', 'Jovan keeps his own place (no move was read)');
  assert(after.offscreen && after.offscreen.Claire && /Ashford Manor/.test(after.offscreen.Claire.location), 'and she is somewhere: ' + JSON.stringify(after.offscreen));
});

test('M755-2 A READER THAT FORGOT THE LEAVE: the house writes it itself — whoever the page’s room does not hold is left where they were when the page ends on him going out (a step to the window leaves nobody behind)', async () => {
  const st = manor();
  const read = await turn(st, MANOR, answer([], ['Jovan', 'Vanessa']), 3);
  assert(read.mutations.some((m) => m.type === 'presence.leave' && m.name === 'Claire' && /went out/.test(m.cause)), 'left behind by the house: ' + JSON.stringify(read.mutations));
  const after = applyMutations(st, read.mutations).state;
  eq(after.present.map((p) => p.name).join(','), 'Jovan,Vanessa', 'the two who went out');
  assert(after.offscreen && after.offscreen.Claire, 'Claire is seated, not lost');
  /* …and a page that ends on him stepping to the window is no leaving: the room keeps everyone */
  const window = '[Ashford Manor — Monday, October 20, 2026 | 20:15 | rain | a dark coat | in the drawing room]\n\nJovan walked to the window and looked out at the rain.';
  assert(!mcGoesOut(window, 'Jovan'), 'a step inside the room is not going out');
  assert(mcWalksOff(window, 'Jovan'), 'though the older reading still counts it as his going (kept as it was)');
  const still = await turn(manor(), window, answer([], ['Jovan', 'Claire', 'Vanessa']), 3);
  eq(still.mutations.filter((m) => m.type === 'presence.leave').length, 0, 'nobody is left behind by it');
});

test('M755-3 THE GOING IS READ AS THE PAGES TELL IT: the company’s going ("the two of them went out", "they went out" with him named on the ending) and the carrying hand ("she led Jovan outside") are his going; another pair going, or "they" on a page that never names him, is not', async () => {
  eq(mcGoesOut(MANOR, 'Jovan'), true, 'the two of them went out into the garden');
  eq(mcGoesOut('Vanessa asked Jovan to walk with her, and they went out into the night together.', 'Jovan'), true, 'they went out, with him named in it');
  eq(mcGoesOut('Vanessa took Jovan’s hand and led him outside, into the rain.', 'Jovan'), true, 'led him outside');
  eq(mcGoesOut('Jovan followed her out into the corridor and pulled the door shut.', 'Jovan'), true, 'followed her out');
  eq(mcGoesOut('Vanessa and Claire went out into the garden.', 'Jovan'), false, 'another pair goes; he stays');
  eq(mcGoesOut('They went out into the night.', 'Jovan'), false, '“they” on a page that never names him is anyone’s');
  eq(mcGoesOut('Jovan stayed at the table, watching the fire.', 'Jovan'), false, 'a quiet page');
  eq(mcGoesOut('Kuchiki-taichō nodded to Oda, then left without a word.', 'Jovan Oda'), false, 'the captain goes, not him');
  eq(mcGoesOut('“Walk with me,” Vanessa said. Jovan shook his head.', 'Jovan'), false, 'what someone says is not a going');
});

test('M755-4 THE HOUSE KEEPS WHAT THE PAGE BRINGS: the two who went out stay in the scene and keep their places; a third the page shows at the door stays too', async () => {
  const page = '[Ashford Manor — Monday, October 20, 2026 | 20:10 | rain | a dark coat | in the drawing room]\n\nVanessa asked Jovan to walk with her. Claire handed him his coat and he followed Vanessa out into the garden.';
  const read = await turn(manor(), page, answer([], ['Jovan', 'Vanessa', 'Claire']), 3);
  eq(read.mutations.filter((m) => m.type === 'presence.leave').length, 0, 'the room the page names keeps all three');
  const after = applyMutations(manor(), read.mutations).state;
  eq(after.present.map((p) => p.name).join(','), 'Jovan,Claire,Vanessa', 'nobody moved who the page did not take');
});

test('M755-5 A NEW SCENE NEXT DOOR, THE READER NAMED NOBODY: on a near move ("the garden of Ashford Manor" from "Ashford Manor") the page decides who is there — the one it never shows is left behind, named room or not', async () => {
  const page = '[the garden of Ashford Manor — Monday, October 20, 2026 | 20:40 | rain | a dark coat | on the gravel]\n\nJovan walked the gravel path alone. The garden was empty and dark.';
  const read = await turn(manor(), page, answer([], []), 3);
  const leaves = read.mutations.filter((m) => m.type === 'presence.leave').map((m) => m.name).sort();
  eq(leaves.join(','), 'Claire,Vanessa', 'the two the page never shows stay at the manor: ' + JSON.stringify(read.mutations));
  const after = applyMutations(manor(), read.mutations).state;
  eq(after.present.map((p) => p.name).join(','), 'Jovan', 'the garden holds him alone');
});

test('M755-6 THE CLOCK MOVED HOURS ON: the page opens a new scene on the same ground — whoever it does not show is not in the room it opens, and whoever it shows is kept', async () => {
  const next = '[Ashford Manor — Tuesday, October 21, 2026 | 09:10 | clear | a dark coat | in the drawing room]\n\nMorning came grey and quiet. Jovan sat alone at the long table with his coffee going cold.';
  const read = await turn(manor(), next, answer([], ['Jovan']), 4);
  const leaves = read.mutations.filter((m) => m.type === 'presence.leave').map((m) => m.name).sort();
  eq(leaves.join(','), 'Claire,Vanessa', 'the night before is over: ' + JSON.stringify(read.mutations));
  const after = applyMutations(manor(), read.mutations).state;
  eq(after.present.map((p) => p.name).join(','), 'Jovan', 'the new morning holds him alone');
  /* …and a page that shows her keeps her, even hours on */
  const withHer = '[Ashford Manor — Tuesday, October 21, 2026 | 09:10 | clear | a dark coat | in the drawing room]\n\nClaire poured his coffee and set the pot down without a word.';
  const kept = await turn(manor(), withHer, answer([], []), 4);
  assert(kept.mutations.some((m) => m.type === 'presence.leave' && m.name === 'Vanessa'), 'the one the page never shows is still left behind');
  assert(!kept.mutations.some((m) => m.type === 'presence.leave' && m.name === 'Claire'), 'the one it shows is kept: ' + JSON.stringify(kept.mutations));
});
