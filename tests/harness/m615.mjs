/* M615 — his report: the referee "suddenly stupid" — the summon he called was never weighed. Laws RUN the real weighing door. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';

function scene({ shows = false } = {}) {
  return {
    sheet: { playerName: 'Jovan Oda', actors: { 'Jovan Oda': { default: 8, domains: { summoning: 9 }, conditions: [] }, Sukuna: { default: 10, domains: {}, conditions: [] } },
      seedVersion: undefined, seededAtPage: 0, seenPresent: ['Jovan Oda', 'Sukuna', 'Mahoraga'], ...(shows ? { seenShowsHere: true } : {}) },
    characters: { 'Jovan Oda': { core: 'a summoner', state: '', arc: '', threads: [] }, Sukuna: { core: 'the King of Curses', state: '', arc: '', threads: [] } },
    present: [{ name: 'Jovan Oda' }, { name: 'Sukuna' }, { name: 'Mahoraga' }],
    page: 40, log: [], journal: [],
  };
}

test('M615-1 THE SUMMON HE CALLED IS WEIGHED — shown to the weighing though it has no page, and never taken as "seen and left off" by a weighing that was never shown it', async () => {
  const R = await import('../../js/agents/referee.js');
  const st = scene();
  st.sheet.seedVersion = R.SEED_VERSION;
  assert(/Mahoraga \(in the scene\) — no page written yet/.test(R.seedPeople(st, '')), 'the weighing is shown Mahoraga: ' + R.seedPeople(st, ''));
  eq(R.seenAndLeftOff(st).has('mahoraga'), false, 'a weighing before this was never shown him — he is not "seen"');
  eq(R.seedDue(st, 40), 'a new face', 'so the house weighs him by itself');
  const honest = scene({ shows: true });
  honest.sheet.seedVersion = R.SEED_VERSION;
  eq(R.seenAndLeftOff(honest).has('mahoraga'), true, 'a weighing that WAS shown him and left him off is believed');
});
