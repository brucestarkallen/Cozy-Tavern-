/* Cozy Tavern — harness laws of M518: canon on their own page (his design, the per-person half: "each person stays on
 * their own page — canon writes them onto it once, then only speaks for what the page is missing"). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { canonBlocks, lastingLines, canonOffPages } from '../../js/assemble/canonpages.js';
import { buildRequest } from '../../js/assemble/stack.js';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const NOTE = ['What canon says about the people here:', 'Yuki Tsukumo:', '  - Identity: A special grade sorcerer who wanders abroad.', '  - Appearance: Tall, long blonde hair.', '  - Facts: Wields Bonbaye.', '  - Voice: "So, what kind of woman is your type?"', '  - With Choso: Wary allies.', '  - Secret (unrevealed in-story — keep it hidden): SECRET-TEXT.', 'Choso:', '  - Identity: A Death Painting Womb.'].join('\n');
const wireOf = (r) => [...r.systemBlocks.map((b) => b.text), ...r.messages.map((m) => String(m.content))].join('\n');
const count = (hay, needle) => hay.split(needle).length - 1;

test('M518-1 A BLOCK\'S LASTING LINES — who they are, how they talk, their nature and history — never this scene\'s lines (appearance, facts in play, abilities in play, who else is here) and never a secret', () => {
  const b = canonBlocks(NOTE);
  eq(b.map((x) => x.name).join(' | '), 'What canon says about the people here | Yuki Tsukumo | Choso', 'the blocks');
  eq(lastingLines(b[1].lines).join('\n'), '  - Identity: A special grade sorcerer who wanders abroad.\n  - Voice: "So, what kind of woman is your type?"', 'Yuki\'s lasting lines');
  eq(lastingLines(['  A prose briefing of who she is.', '  - Facts: x']).join('|'), '  A prose briefing of who she is.', 'the curator\'s prose brief is who they are');
});

test('M518-2 THE NOTE LEAVES OUT EXACTLY WHAT THE CARDS CARRY — a lasting line only when that exact line rides in the people section; this scene\'s lines and the secret stay; a person with nothing left loses their name line; no card, nothing left out', () => {
  const people = 'Yuki Tsukumo — A special grade.\nNow: at the barrier.\nFrom canon:\n  - Identity: A special grade sorcerer who wanders abroad.\n  - Voice: "So, what kind of woman is your type?"\nChoso — A Death Painting.\nFrom canon:\n  - Identity: A Death Painting Womb.';
  const t = canonOffPages(NOTE, people);
  assert(!t.includes('Identity: A special grade sorcerer') && !t.includes('what kind of woman'), 'her lasting lines left out');
  for (const keep of ['Yuki Tsukumo:', 'Appearance: Tall', 'Facts: Wields Bonbaye', 'With Choso: Wary allies', 'SECRET-TEXT']) assert(t.includes(keep), 'kept: ' + keep);
  assert(!/^Choso:$/m.test(t), 'Choso: nothing left — his name goes too');
  eq(canonOffPages(NOTE, 'Yuki Tsukumo — A special grade.\nNow: here.'), NOTE, 'no canon on the cards: the note whole');
});

test('M518-3 IN THE REQUEST: with canon on their pages, each lasting line is said once (on the card); the secret and this scene\'s lines in the note; in any other mode the cards are as they always were and a page\'s kept lines are not sent; no page keeps nothing; the same lines again write nothing', () => {
  let st = applyMutations({ ...emptyState(), page: 5 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'the barrier' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Yuki Tsukumo' }, { type: 'people.note', name: 'Yuki Tsukumo', field: 'core', text: 'A special grade.' }]).state;
  st = applyMutations(st, [{ type: 'people.canon', name: 'Yuki Tsukumo', lines: lastingLines(canonBlocks(NOTE)[1].lines) }]).state;
  const msgs = [{ id: 'u1', role: 'user', text: 'I raise my blade.' }];
  const build = (canonOnPages) => buildRequest({ story: { brief: 'JJK.' }, messages: msgs, settings: {}, state: st, modules: [], memory: '', window: { keeperOn: true, window: 30, budgetTokens: 262000, nodes: [] }, canonNote: NOTE, canonOn: true, canonOnPages });
  const smart = wireOf(build(true));
  eq(count(smart, 'Identity: A special grade sorcerer who wanders abroad.'), 1, 'said once');
  eq(count(smart, 'what kind of woman is your type'), 1, 'her voice once');
  assert(/From canon:/.test(smart) && smart.includes('SECRET-TEXT') && smart.includes('With Choso: Wary allies'), 'on her card; the secret and the scene in the note');
  const manual = wireOf(build(false));
  assert(!/From canon:/.test(manual), 'another mode: the card as it always was');
  eq(count(manual, 'Identity: A special grade sorcerer who wanders abroad.'), 1, 'and the note whole — once');
  const refused = applyMutations(st, [{ type: 'people.canon', name: 'Nobody', lines: ['  - Identity: x'] }]);
  assert(refused.rejected && refused.rejected.length === 1, 'no page, nothing kept');
  const same = applyMutations(st, [{ type: 'people.canon', name: 'Yuki Tsukumo', lines: lastingLines(canonBlocks(NOTE)[1].lines) }]);
  eq(same.applied.length, 0, 'the same lines again: nothing written');
});
