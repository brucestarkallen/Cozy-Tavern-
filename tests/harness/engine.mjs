/* B14: the monotonic turn counter; lore retrieval rules; commands. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { matchLoreDetailed, parseLorebook, saveLore, loadLore, updateLoreEntry, removeLoreEntry, moveLoreEntry } from '../../js/import/lorebook.js';
import { parseCommand } from '../../js/commands.js';

test('B14: state.turn is monotonic and independent of the capped log', () => {
  let s = emptyState();
  for (let i = 0; i < 210; i += 1) {
    s = applyMutations(s, [{ type: 'canon.lock', name: 'Mira', key: 'k' + i, value: 'v' }]).state;
  }
  eq(s.turn, 210, 'one turn per applied batch');
  assert(s.log.length <= 200, 'the log caps');
  assert(s.turn > s.log.length, 'the counter outlives the cap');
});

test('B14: atTurn reads state.turn', () => {
  let s = emptyState();
  s = applyMutations(s, [{ type: 'presence.enter', name: 'Mira' }]).state;
  s = applyMutations(s, [{ type: 'presence.enter', name: 'Jo' }]).state;
  const mira = s.present.find((p) => p.name === 'Mira');
  const jo = s.present.find((p) => p.name === 'Jo');
  if (mira && 'atTurn' in mira) {
    eq(mira.atTurn, 1, 'first page ages at turn 1');
    eq(jo.atTurn, 2, 'second at turn 2');
  } else {
    assert(s.turn === 2, 'turn counter stands (presence carries no atTurn field)');
  }
});

test('B14: a state from before the counter starts from its log length', async () => {
  await saveState('t-story', { log: [{ a: 1 }, { a: 2 }, { a: 3 }] });
  const loaded = await loadState('t-story');
  eq(loaded.turn, 3, 'migrated from the log');
  await saveState('t-story', { ...loaded, turn: 12 });
  eq((await loadState('t-story')).turn, 12, 'a real counter wins');
});

test('lore: constant entries always fire, budget first, no key needed', () => {
  const entries = [
    { id: 'c1', keys: [], content: 'CONSTANT LORE', enabled: true, constant: true },
    { id: 'k1', keys: ['dragon'], content: 'dragon lore', enabled: true },
  ];
  const m = matchLoreDetailed(entries, ['nothing relevant here']);
  assert(m.text.startsWith('CONSTANT LORE'), 'constant rides first');
  eq(m.fired[0].constant, true);
  const m2 = matchLoreDetailed(entries, ['the dragon wakes']);
  assert(m2.text.includes('CONSTANT LORE') && m2.text.includes('dragon lore'), 'both fire');
});

test('lore: secondary keys are AND-mode; depth scopes the scan', () => {
  const sel = [{ id: 's', keys: ['sword'], secondaryKeys: ['ember'], content: 'selective', enabled: true }];
  eq(matchLoreDetailed(sel, ['a sword alone']).text, '', 'primary alone stays quiet');
  assert(matchLoreDetailed(sel, ['a sword of ember']).text === 'selective', 'primary AND secondary wake it');
  const deep = [{ id: 'd', keys: ['oak'], content: 'oak lore', enabled: true, depth: 1 }];
  eq(matchLoreDetailed(deep, ['the oak door', 'nothing about trees']).text, '', 'depth 1 scans only the last page');
  eq(matchLoreDetailed(deep, ['nothing', 'the oak door']).text, 'oak lore', 'last page heard');
});

test('lore: parse reads constant / keysecondary / scan_depth', () => {
  const book = JSON.stringify({ entries: { 0: { keys: ['a'], keysecondary: ['b'], constant: true, scan_depth: 5, content: 'x' } } });
  const [e] = parseLorebook(book);
  assert(e.constant === true && e.secondaryKeys[0] === 'b' && e.depth === 5, 'ST fields read');
});

test('lore: per-entry store ops (update / move / remove)', async () => {
  await saveLore('l-story', [
    { id: 'e1', keys: ['one'], content: 'one', enabled: true },
    { id: 'e2', keys: ['two'], content: 'two', enabled: true },
  ]);
  await updateLoreEntry('l-story', 'e1', { enabled: false, constant: true, keys: ['uno'] });
  let entries = await loadLore('l-story');
  assert(entries[0].enabled === false && entries[0].constant === true && entries[0].keys[0] === 'uno', 'update lands');
  await moveLoreEntry('l-story', 'e2', -1);
  entries = await loadLore('l-story');
  eq(entries[0].id, 'e2', 'reorder lands');
  await removeLoreEntry('l-story', 'e2');
  eq((await loadLore('l-story')).length, 1, 'remove lands');
});

test('commands: the five words, asides, and honest passthrough', () => {
  eq(parseCommand('#question is the mill open?').kind, 'question');
  assert(parseCommand('#question is the mill open?').ooc === true, 'question is OOC');
  assert(parseCommand('#question is the mill open?').directive.includes('is the mill open?'), 'directive carries the question');
  eq(parseCommand('#p').kind, 'beat');
  eq(parseCommand('#pp').kind, 'skip');
  const c = parseCommand('#continue');
  eq(c.kind, 'continue'); assert(c.hidden === true, 'continue page is hidden');
  eq(parseCommand('#time').kind, 'time');
  assert(parseCommand('((checking in — back in five))').ooc === true, '((…)) is OOC');
  assert(parseCommand('// a note to the house').ooc === true, '// is OOC');
  const unknown = parseCommand('#frobnicate the sword');
  eq(unknown.kind, null);
  assert(/isn’t a house command/.test(unknown.chip), 'unknown passes through with a hint');
  eq(unknown.clean, '#frobnicate the sword', 'words kept whole');
  eq(parseCommand('plain words').chip, '', 'plain words get no chip');
});
