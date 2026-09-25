/* M491 — Vivi stood in "Who's here" pages after she went home: a possessive ("Vivi's pants") counted as her being shown,
 * so her leave was thrown away. A possessive of a thing, or her name in dialogue, never shows her; and someone listed
 * here whose own page says they left is seated away on the next page and on opening. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { shownOnPage, goneAtTheEnd, goneByTheirOwnPage, applyMutations } from '../../js/engine/apply.js';
import { emptyState } from '../../js/engine/state.js';

const mk = () => { const s = emptyState(); s.sheet = { actors: {}, playerName: 'Jovan Arden' }; s.place = { name: "Metropolis — Jovan's apartment, living room" };
  s.present = [{ name: 'Jovan Arden' }, { name: 'Kara Zor-El' }, { name: 'Vivi' }];
  s.characters = { Vivi: { core: 'his stepsister', updatedAtTurn: 10 }, 'Kara Zor-El': { core: 'Kryptonian', updatedAtTurn: 14 } }; return s; };

test('M491-1 a possessive of a thing, or a name in dialogue, never shows a person; her body or voice does', () => {
  const s = mk();
  eq(shownOnPage(s, "Kara curls up in Vivi's rolled gray pants and steals his coffee.", 'Vivi'), false, 'her pants are not her');
  eq(shownOnPage(s, "\u201cVivi would kill you,\u201d Kara says.", 'Vivi'), false, 'her name in dialogue is not her');
  eq(shownOnPage(s, "Vivi's hand closes on his arm.", 'Vivi'), true, 'her hand is her');
  eq(shownOnPage(s, "Vivi's voice cuts through the room.", 'Vivi'), true, 'her voice is her');
  eq(shownOnPage(s, 'Vivi drops her tote on the counter.', 'Vivi'), true, 'she is');
});

test('M491-2 her leave is kept when the page goes on to name her pants — the page reader’s leave survives the gate', () => {
  const s = mk();
  const page = "[Metropolis — Jovan's apartment — Wednesday | 08:40 | sun | shirt | sofa]\n\nVivi hugs him goodbye, one-armed, and is out the door with her tote on her shoulder. The elevator chimes.\n\nKara curls up on the sofa in Vivi's rolled gray pants and steals his coffee.";
  eq(goneAtTheEnd(s, page, 'Vivi'), true, 'gone at the end');
});

test('M491-3 gone by their own page: listed here, her page says she is leaving, the newest page does not show her → taken out and seated where her page says; shown on the newest page → left alone; never the main character', () => {
  const s = mk();
  s.characters.Vivi.state = "Leaving Jovan's apartment building — Wednesday morning, tote on her shoulder, texting Mom";
  const page = "[Metropolis — Jovan's apartment — Wednesday | 09:10 | sun | shirt | sofa]\n\nKara sits beside him in Vivi's rolled gray pants and the I DID NOT PAY TUITION shirt.";
  const muts = goneByTheirOwnPage(s, page);
  eq(muts.map((m) => m.type).join(','), 'presence.leave,offscreen.set');
  const r = applyMutations(s, muts);
  assert(!r.state.present.some((p) => p.name === 'Vivi'), 'not here');
  eq(r.state.offscreen.Vivi.location, "Leaving Jovan's apartment building", 'seated where her page says');
  assert(/tote on her shoulder/.test(r.state.offscreen.Vivi.activity));
  const shown = mk(); shown.characters.Vivi.state = 'Leaving, but lingering at the door';
  eq(goneByTheirOwnPage(shown, '[X — Monday | 09:00 | sun | coat | here]\n\nVivi stops at the door and turns back.').length, 0, 'the newest page shows her: her note is old, she stays');
  const mc = mk(); mc.characters['Jovan Arden'] = { state: 'Leaving for the lab' };
  assert(!goneByTheirOwnPage(mc, '[X — Monday | 09:00 | sun | coat | here]\n\nKara reads.').some((m) => m.name === 'Jovan Arden'), 'never the main character');
});

test('M497 a departure is grammar: twelve states and five door lines — "Left arm in a sling", "Gone quiet", "Leaving her coffee untouched", an arrival through a door that shuts behind her — never take anyone out', async () => {
  const mkS = (st) => { const s = emptyState(); s.sheet = { actors: {}, playerName: 'Jovan' }; s.present = [{ name: 'Jovan' }, { name: 'Kara' }]; s.characters = { Kara: { core: 'Kryptonian', state: st } }; return s; };
  const page = '[X — Monday | 09:00 | sun | coat | here]\n\nThe rain keeps on.';
  for (const [st, want] of [['Left arm in a sling, glaring at the rain', false], ['Left alone with the kettle', false], ['Gone quiet, staring at the window', false], ['Gone pale at the news', false], ['Leaving her coffee untouched, she watches him', false], ['Left behind to guard the door', false], ['Left for the airport', true], ['Leaving Jovan’s apartment building — tote on her shoulder', true], ['Gone home to change', true], ['Headed out for groceries', true], ['Left the apartment without a word', true], ['Gone — the window open behind her', true]]) eq(goneByTheirOwnPage(mkS(st), page).length > 0, want, st);
  const { showsDeparture } = await import('../../js/engine/apply.js');
  for (const [t, want] of [['She steps in and the door shuts behind her.', false], ['Vivi lets herself in; the door clicks shut behind her.', false], ['The door shuts behind Vivi.', true], ['Vivi walks out and the door shuts behind her.', true], ['Vivi hugs him goodbye and is out the door.', true]]) eq(showsDeparture(t), want, t);
});

test('M497 a Stop keeps the line in hand only once the page has begun: stopped mid-page the half sentence stays; stopped mid-plan (before the header) nothing becomes the page', async () => {
  const { makeHeaderGate } = await import('../../js/ui/headergate.js');
  const run = (chunks) => { const handed = []; const g = makeHeaderGate({ onProse: (t) => handed.push(t), onThinking: () => {} }); chunks.forEach((c) => g.feed(c)); g.endIfOpen(); return handed.join(''); };
  eq(run(['Okay, the plan: Kara stays quiet.\n', 'I should open on the rain']), '', 'a plan is never a page');
  assert(/and the door $/.test(run(['[The kitchen — Monday, March 3, 2025 | 09:05 | clear | apron | by the stove]\n\nShe turns the handle slowly, and the door '])), 'the half page is kept');
});
