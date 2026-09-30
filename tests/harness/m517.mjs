/* Cozy Tavern — harness laws of M517: the automatic brief (his design: "Manual is my own brief; Automatic is AI-curated
 * ground — the world — from canon, the ledger, the folds and the essentials; without canon too; no redundancy, no mountain
 * of tokens; the old canon kept as a legacy switch"). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { groundAsk, groundUpdateAsk, readGround, readGroundPatch, groundWords, runGround, canonWithoutWorld, GROUND_MAX_CHARS, GROUND_PART_CHARS, GROUND_EVERY } from '../../js/agents/worldground.js';
import { buildRequest } from '../../js/assemble/stack.js';
import { CRAFT_TEXT } from '../../js/assemble/craft.js';

const PARTS = { world: 'Modern Japan with a hidden world of jujutsu sorcerers.', where: 'The Culling Game arc: Gojo sealed, Yuta back from abroad and through Sendai, the Zenin clan destroyed.', powers: 'Cursed energy, innate techniques, domain expansion.', factions: 'The higher-ups; Tokyo Jujutsu High; Kenjaku and his players.', places: 'Tengen\'s barrier beneath Jujutsu High; the colonies.', standing: 'The Culling Game is underway across ten colonies.' };
const wireOf = (r) => [...r.systemBlocks.map((b) => b.text), ...r.messages.map((m) => String(m.content))].join('\n');

test('M517-1 THE WORLD, ASKED FROM EVERYTHING THE STORY HAS — his #story line, his brief (never repeated), the canon start, where it stands in canon now, the ledger\'s place, factions and world, the essentials; the world only: never a person\'s page, never the story told again, nothing after the present, nothing invented', () => {
  const a = groundAsk({ concept: 'jujutsu kaisen Jovan saves Yuki', brief: 'HIS-BRIEF-WORDS', canonStart: 'Where our story began in Jujutsu Kaisen: …', arc: { title: 'Culling Game arc', summary: 'ARC-SUMMARY' }, ledger: { place: 'Tengen\'s barrier', factions: { 'Jujutsu High': { lead: 'Yaga' } }, worldBrief: 'WORLD-BRIEF' }, essentials: 'ESSENTIALS-TEXT', recent: ['RECENT-LINE'] });
  for (const w of ['jujutsu kaisen Jovan saves Yuki', 'HIS-BRIEF-WORDS', 'Where our story began in Jujutsu Kaisen', 'ARC-SUMMARY', 'Tengen\'s barrier', 'Jujutsu High', 'WORLD-BRIEF', 'ESSENTIALS-TEXT', 'RECENT-LINE']) assert(a.user.includes(w), 'a source rides: ' + w);
  assert(/Never a person’s page/.test(a.system) && /never the story’s events told again/.test(a.system) && /nothing canon holds AFTER the story’s present/.test(a.system) && /never repeat it/.test(a.system) && /rather than invent/.test(a.system), 'the rules');
  const plain = groundAsk({ concept: 'a medieval war between two kingdoms' });
  assert(!/WHERE THE STORY BEGAN IN ITS CANON|WHERE THE STORY STANDS IN CANON/.test(plain.user) && /"" for an original story/.test(plain.system), 'without canon it is the same ask, from the story alone');
});

test('M517-2 READ STRICTLY, HELD TO ITS ROOM, SAID IN ORDER: each part at most ' + GROUND_PART_CHARS + ' characters, the whole at most ' + GROUND_MAX_CHARS + ' (the last parts give way); one line is not a world; his own words stand as he wrote them', () => {
  const g = readGround('Sure: ' + JSON.stringify(PARTS));
  eq(Object.keys(g).join(','), 'world,where,powers,factions,places,standing', 'all six, in order');
  const words = groundWords({ parts: g });
  assert(words.startsWith('The world of our story, as it stands:\nThe setting — Modern Japan') && words.includes('\nWhere in canon — The Culling Game arc') && words.includes('\nWhat stands in the world now — The Culling Game is underway'), words.slice(0, 200));
  const huge = readGround(JSON.stringify(Object.fromEntries(Object.keys(PARTS).map((k) => [k, 'word '.repeat(400)]))));
  assert(Object.values(huge).every((v) => v.length <= GROUND_PART_CHARS) && Object.values(huge).join('').length <= GROUND_MAX_CHARS, 'held to its room');
  eq(readGround(JSON.stringify({ world: 'only one line' })), null, 'one line is not a world');
  eq(groundWords({ words: 'HIS OWN WORLD.', parts: PARTS }), 'HIS OWN WORLD.', 'his words stand');
});

test('M517-3 ONLY WHAT MOVED: a later look asks only for the parts the world changed and replaces only those; nothing changed is nothing; his own correction is never overwritten unless he rebuilds; with fewer than ' + GROUND_EVERY + ' more pages folded into the record the world is not looked at', async () => {
  const u = groundUpdateAsk({ ground: { parts: PARTS }, recent: ['Kenjaku fell at the barrier.'] });
  assert(/Change a part ONLY if the world itself changed/.test(u.system) && u.user.includes('What stands in the world now — The Culling Game is underway') && u.user.includes('Kenjaku fell at the barrier.'), 'the ask');
  eq(JSON.stringify(readGroundPatch('{"changed":{"standing":"The Culling Game ended when Kenjaku fell."}}')), JSON.stringify({ standing: 'The Culling Game ended when Kenjaku fell.' }), 'only the part that moved');
  eq(JSON.stringify(readGroundPatch('{"changed":{}}')), '{}', 'nothing moved');
  eq(readGroundPatch('no'), null, 'no answer');
  const conn = { id: 'x' };
  eq((await runGround({ connection: conn, have: { by: 'writer', words: 'his', parts: PARTS }, recordLines: 99 })).why, 'his own words stand', 'his words are not overwritten');
  eq((await runGround({ connection: conn, have: { parts: PARTS, recordLines: 10 }, recordLines: 10 + GROUND_EVERY - 1, input: {} })).why, 'the world has not moved', 'not looked at before the record grew enough');
});

test('M517-4 IN THE BRIEF\'S SEAT, AFTER HIS WORDS — for the big and the small storyteller alike, on its own row exactly as sent; Manual (no world) sends nothing of it and the row says why', () => {
  const words = groundWords({ parts: readGround(JSON.stringify(PARTS)) });
  const msgs = [{ id: 'u1', role: 'user', text: 'I raise my blade.' }];
  for (const settings of [{}, { tellerName: 'Hulk', writerName: 'Bruce' }]) {
    const r = buildRequest({ story: { brief: 'HIS-OWN-BRIEF.' }, messages: msgs, settings, state: null, modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: '', window: { keeperOn: false }, worldGround: words });
    eq(r.systemBlocks[2].text, 'HIS-OWN-BRIEF.\n\n' + words.replace('The world of our story, as it stands:', 'The world of our story, as it stands (the brief above is right wherever the two differ):'), 'his words, then the world, in the brief seat — his brief named right where they differ (M518-2)');
    const row = r.receipt.slots.find((s) => s.name === 'The world');
    assert(row && row.tokens > 0 && wireOf(r).includes(row.text), 'its own row, as sent');
    eq(r.receipt.slots.find((s) => s.name === 'The brief').text, 'HIS-OWN-BRIEF.', 'the brief row is his words alone');
  }
  const noBrief = buildRequest({ story: {}, messages: msgs, settings: {}, state: null, modules: [], memory: '', window: { keeperOn: false }, worldGround: words });
  eq(noBrief.systemBlocks[2].text, words, 'no brief of his: the world alone, its plain opening');
  const manual = buildRequest({ story: { brief: 'HIS-OWN-BRIEF.' }, messages: msgs, settings: {}, state: null, modules: [], memory: '', window: { keeperOn: false } });
  eq(manual.systemBlocks[2].text, 'HIS-OWN-BRIEF.', 'Manual: his words only');
  assert(/the brief is Manual/.test(manual.receipt.slots.find((s) => s.name === 'The world').reason), 'and the row says why');
});

test('M517-5 CANON STOPS REPEATING THE WORLD: with the world riding, canon\'s note loses only the story\'s position in canon (both of its shapes) — the header, his pinned words, the people and what the wiki does not know stay; a note shaped otherwise is left whole', () => {
  const note = ['Canon for this scene:', 'Where our story is — Culling Game arc: ARC SUMMARY TEXT.', '(Only events up to this point have happened. Later canon events, reveals, and identities are unknown to every character — never foreshadow or use them.)', 'My standing notes — I wrote these, they always apply:', 'HIS PIN', 'Yuki Tsukumo:', '  A special grade sorcerer.', 'Not found in this story\'s canon sources: "Jovan"'].join('\n');
  const t = canonWithoutWorld(note);
  assert(!/ARC SUMMARY TEXT|Only events up to this point/.test(t), 'the position is gone');
  for (const w of ['Canon for this scene:', 'HIS PIN', 'Yuki Tsukumo:', 'A special grade sorcerer.', 'Not found in this story']) assert(t.includes(w), 'kept: ' + w);
  const begun = 'Where our story is — Culling Game arc (just beginning): SUMMARY.\n(The story is at the START of this arc: the summary above is your map…)\nYuki Tsukumo:\n  x';
  eq(canonWithoutWorld(begun), 'Yuki Tsukumo:\n  x', 'the "just beginning" shape too');
  eq(canonWithoutWorld('Yuki Tsukumo:\n  x'), 'Yuki Tsukumo:\n  x', 'no position: untouched');
});

test('M518-2 HIS BRIEF CHANGED, THE WORLD LOOKS AGAIN: a rewritten brief is a reason to look (like a new arc or a new start), not only pages folded — the world then takes out what his new words say; nothing changed and too few pages, it is not looked at', async () => {
  const conn = { id: 'x' };
  const have = { parts: PARTS, recordLines: 10, briefFp: 'old' };
  eq((await runGround({ connection: conn, have, recordLines: 11, input: { briefChanged: false } })).why, 'the world has not moved', 'same brief, too few pages: not looked at');
  let looked = false;
  try { const r = await runGround({ connection: conn, have, recordLines: 11, input: { briefChanged: true, briefFingerprint: 'new' } }); looked = r.why !== 'the world has not moved'; } catch (err) { looked = true; /* it went to ask — this harness has no model to answer */ }
  assert(looked, 'a rewritten brief: it looks again');
});

