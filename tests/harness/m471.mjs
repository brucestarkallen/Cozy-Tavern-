/* M471 — the Arbiter audit's fixes: the gate reads through contractions; the same person the other way round; gear
 * without a modifier is a boon; a magic key never reaches the sheet. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { gatePasses, stripDialogue, normalizeAdj } from '../../js/agents/referee.js';
import { findActorKey, findActor, applyConditionChange, engineSettings } from '../../js/engine/duels.js';

test('M471-1 the gate reads through contractions: "I don’t hesitate — I lunge" opens a fight; speech in quotes is still not an attempt; an unclosed quote never eats the message', () => {
  const t = "I don't hesitate — I lunge at him and slash low, and I won't stop.";
  eq(stripDialogue(t), t, 'straight apostrophes are never speech');
  assert(gatePasses(t, 'normal', {}).pass, 'the lunge is seen');
  assert(!gatePasses('He shouts "I will punch you!" and I stay still.', 'normal', {}).pass, 'a punch inside quotes is speech');
  assert(!gatePasses('She said, “I’ll stab him,” and smiled.', 'normal', {}).pass, 'curly quotes too');
  assert(gatePasses('"Come on, I dare you — I punch him square in the jaw.', 'normal', {}).pass, 'an unclosed quote: the message is read');
  assert(gatePasses('"' + 'x'.repeat(500) + '" then I kick the door.', 'normal', {}).pass, 'a run past four hundred characters is not a quote');
});

test('M471-2 the same person the other way round: the sheet’s "Kaelen" is found by "Kaelen Stahl"; a shared surname alone is nobody', () => {
  const s = { sheet: { actors: { Kaelen: { domains: { melee: 8 } }, 'Claire Wessex': { domains: { melee: 4 } } }, playerName: 'Jovan' } };
  eq(findActorKey(s, 'Kaelen Stahl'), 'Kaelen');
  eq(findActorKey(s, 'Claire'), 'Claire Wessex');
  eq(findActorKey(s, 'Marcus Wessex'), null, 'a surname alone is never one person');
  eq(findActor(s, 'Kaelen Stahl').domains.melee, 8, 'his rating, not a stranger’s');
});

test('M471-3 a piece of gear with no modifier is a boon (+1), a condition a handicap (-1); and __proto__ never reaches the sheet', () => {
  const s = { sheet: { actors: {}, playerName: 'Jovan' }, turn: 1 };
  const gear = normalizeAdj({ check: true, kind: 'task', action: 'x', condition_change: { who: 'Kaelen', add: 'a fine blade', gear: true } }, s).condition_change;
  eq(gear.mod, 1, 'gear: +1');
  const cond = normalizeAdj({ check: true, kind: 'task', action: 'x', condition_change: { who: 'Kaelen', add: 'a limp' } }, s).condition_change;
  eq(cond.mod, -1, 'a condition: -1');
  const eng = engineSettings({});
  applyConditionChange(s, { who: '__proto__', add: 'poisoned', mod: -2 }, eng);
  assert(!Object.prototype.hasOwnProperty.call(s.sheet.actors, '__proto__') && !('poisoned' in Object.prototype), 'the magic key is refused');
  applyConditionChange(s, { who: 'constructor', add: 'poisoned', mod: -2 }, eng);
  assert(!Object.prototype.hasOwnProperty.call(s.sheet.actors, 'constructor'), 'and its kin');
});

test('M490-3 the reverse name match is one person only: a surname added or a title in front — never a different person whose name contains a short sheet name', () => {
  const s = { sheet: { playerName: 'Jovan Arden', actors: { Kaelen: {}, Red: {}, Guard: {}, 'Jovan Arden': {}, Rukia: {}, 'Claire Wessex': {} } } };
  for (const [n, want] of [['Kaelen Stahl', 'Kaelen'], ['Red Guard captain', null], ['Guard captain Holt', null], ["Jovan Arden's sister", null], ['Rukia Kuchiki', 'Rukia'], ['Captain Rukia', 'Rukia'], ['the Red', 'Red'], ['Claire', 'Claire Wessex'], ['Marcus Wessex', null]]) eq(findActorKey(s, n), want, n);
});
