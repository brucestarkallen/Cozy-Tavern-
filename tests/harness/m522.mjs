/* Cozy Tavern — harness laws of M522: the auditor can set a shared line right (his report: "Seen; its change did not hold
 * (the hero already knows that)… (no line of what the paladin knows answers to 'heard the demon prince…')… 6 refused"). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const party = ['the hero', 'the priestess', 'the paladin', 'the assassin', 'the mage'];
const OLD = 'heard the demon prince offer all of them a place at his side';
const NEW = 'heard the demon prince offer all of them a place at his side if they kneel and give up the paladin';
const ledger = () => {
  let st = applyMutations({ ...emptyState(), page: 40 }, [{ type: 'mc.set', name: 'Jovan' }, ...party.map((n) => ({ type: 'presence.enter', name: n }))]).state;
  return applyMutations(st, party.filter((n) => n !== 'the paladin').map((n) => ({ type: 'knowledge.add', name: n, fact: OLD }))).state;
};
const books = (st) => party.map((n) => (st.knowledge[n] || []).map((k) => (k.fact === NEW ? 'NEW' : k.fact === OLD ? 'OLD' : k.fact)).join('+') || '—').join(' | ');

test('M522-1 THE AUDITOR SETS A SHARED LINE RIGHT, IN EITHER ORDER: letting go of the old wording and writing the corrected one for each of five — every book ends with the corrected line (the paladin, who had none, too) and nothing is lost (on m521: all five kept the wrong line, or all five forgot the moment)', () => {
  const byPerson = applyMutations(ledger(), party.flatMap((n) => [{ type: 'knowledge.forget', name: n, fact: OLD }, { type: 'knowledge.add', name: n, fact: NEW }]));
  eq(books(byPerson.state), 'NEW | NEW | NEW | NEW | NEW', 'let go, then write, person by person');
  const writesFirst = applyMutations(ledger(), [...party.map((n) => ({ type: 'knowledge.add', name: n, fact: NEW })), ...party.map((n) => ({ type: 'knowledge.forget', name: n, fact: OLD }))]);
  eq(books(writesFirst.state), 'NEW | NEW | NEW | NEW | NEW', 'all the writes, then all the letting go');
  eq(writesFirst.applied.filter((a) => a.mutation.type === 'knowledge.add').length, 5, 'each correction landed — a fuller line in place is a change, not "already knows that"');
});

test('M522-2 ONE WORDING HOUSE-WIDE, BUT THE LONGER STAYS: a shorter or paraphrased line takes the wording others hold (M484); a fuller line keeps its own', () => {
  let st = applyMutations({ ...emptyState(), page: 12 }, [{ type: 'knowledge.add', name: 'Rukia', fact: 'heard the demon prince offer all of them a place at his side if they kneel' }]).state;
  st = applyMutations({ ...st, page: 12 }, [{ type: 'knowledge.add', name: 'Renji', fact: 'heard the demon prince offer all of them a place at his side' }]).state;
  eq(st.knowledge.Renji[0].fact, 'heard the demon prince offer all of them a place at his side if they kneel', 'the shorter takes the fuller wording already held');
  st = applyMutations({ ...st, page: 12 }, [{ type: 'knowledge.add', name: 'Ichigo', fact: 'heard the demon prince offer all of them a place at his side if they kneel before dawn' }]).state;
  eq(st.knowledge.Ichigo[0].fact, 'heard the demon prince offer all of them a place at his side if they kneel before dawn', 'a fuller line keeps its own words');
});

test('M522-3 LETTING GO TAKES THE LINE MEANT: the exact line first; a clipped quote still lets go of the line it mostly covers; a fuller line that merely contains the words stays', () => {
  const st = applyMutations({ ...emptyState(), page: 12 }, [{ type: 'knowledge.add', name: 'Rukia', fact: NEW }]).state;
  const r1 = applyMutations(st, [{ type: 'knowledge.forget', name: 'Rukia', fact: OLD }]);
  eq((r1.state.knowledge.Rukia || []).length, 1, 'the fuller line stays when the shorter words are let go');
  const r2 = applyMutations(st, [{ type: 'knowledge.forget', name: 'Rukia', fact: NEW.slice(0, NEW.length - 8) }]);
  eq((r2.state.knowledge.Rukia || []).length, 0, 'a quote clipped at its end still lets go of its line');
  const r3 = applyMutations(st, [{ type: 'knowledge.forget', name: 'Rukia', fact: NEW }]);
  eq((r3.state.knowledge.Rukia || []).length, 0, 'the exact line');
});
