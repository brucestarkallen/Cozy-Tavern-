/* M36 — the craft core: the writer's law distilled, bound to the house's truth. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { CRAFT_TEXT, looksLikeImportedCraft, IMPORTED_CRAFT_MARKS } from '../../js/assemble/craft.js';
import { listModules, selectModules, saveModule, removeModule } from '../../js/assemble/modules.js';
import { parsePreset, decompose } from '../../js/import/sillytavern.js';
import { emptyState } from '../../js/engine/state.js';
import { db } from '../../js/store.js';

test('M36-1 the core is bounded, keeps the laws, and emits nothing the house now keeps', () => {
  assert(CRAFT_TEXT.length > 40000 && CRAFT_TEXT.length < 90000, 'about 20k tokens (M85 restored the NSFW law, the commands, the page): ' + CRAFT_TEXT.length);
  for (const law of ['Symmetry Law', 'No Moral Parachutes', 'Ghost Dialogue', 'Stop At The Slot', 'The 3 Part Trace', 'Secret Identity Quarantine',
    'Ledger Law', 'Tone Is Output Never Input', 'Invention Is The Default', 'Intervention Windows', 'One Significant Beat', 'Sound As Onomatopoeia',
    'Voice Fingerprints', 'Banned Words', 'Header Protocol', 'NPC Private Thoughts', 'Real People, Real Record', 'A Turn Moves The World']) {
    assert(CRAFT_TEXT.includes(law), 'the law survives: ' + law);
  }
  for (const gone of ['{PULSE}', '{WATCHLIST}', 'Plot Momentum', 'Emit Order', '<details>', 'ACW Active Character Watchlist', 'TWB the World Beyond']) {
    assert(!CRAFT_TEXT.includes(gone), 'the storyteller is no longer asked to emit: ' + gone);
  }
  /* the binding section: the truth the house hands over, and how to use it */
  assert(/## The House's Truth/.test(CRAFT_TEXT));
  for (const bound of ['[story-state]', 'Who Knows What', 'arriving in about N minutes', "Our story so far", "The world's word", 'The house has ruled', 'A mended page']) {
    assert(CRAFT_TEXT.includes(bound), 'bound to: ' + bound);
  }
  /* the pass keeps only B and L */
  assert(/## The Pass[\s\S]*B — BEAT[\s\S]*L — LAST LOOK/.test(CRAFT_TEXT) && /that is your S, C, and W, and you do not redo them/.test(CRAFT_TEXT));
  assert(!looksLikeImportedCraft(CRAFT_TEXT), 'the core is not mistaken for the old import');
  assert(looksLikeImportedCraft('x'.repeat(41000) + IMPORTED_CRAFT_MARKS[0] + IMPORTED_CRAFT_MARKS[2]), 'the old import is recognized');
});

test('M36-2 the core is the house’s craft; an old imported fork is retired on sight, words kept, once', async () => {
  const mods = await listModules();
  const core = mods.find((m) => m.id === 'core-craft');
  eq(core.text, CRAFT_TEXT, 'the builtin craft is the distilled core');
  /* seed an old wholesale-import fork */
  await saveModule({ id: 'core-craft', text: 'x'.repeat(45000) + '\n## Simulation Principle\n## Epistemic Law\n', pinned: false });
  const before = await listModules();
  const coreAfter = before.find((m) => m.id === 'core-craft');
  eq(coreAfter.source, 'builtin', 'the fork was retired; the house’s craft rides');
  const retired = before.filter((m) => m.custom && /old imported craft/.test(m.name));
  eq(retired.length, 1, 'the words moved to one manual rule');
  eq(retired[0].whenKey, 'manual');
  await listModules();
  eq((await listModules()).filter((m) => m.custom && /old imported craft/.test(m.name)).length, 1, 'no duplicate on a second read');
  await removeModule(retired[0].id);
  /* a hand-edited fork (small, no marks) is left alone */
  await saveModule({ id: 'core-craft', text: 'my own craft', pinned: false });
  eq((await listModules()).find((m) => m.id === 'core-craft').source, 'user');
  await removeModule('core-craft');
});

test('M36-3 the writer’s own rule for a moment shadows the house’s condensed one; never the core', async () => {
  const mine = await saveModule({ name: 'My NSFW', text: 'mine', whenKey: 'intimate' });
  const state = emptyState(); state.mode.intimate = true;
  const sel = selectModules(await listModules(), state);
  assert(sel.some((s) => s.mod.id === mine.id), 'mine rides');
  assert(!sel.some((s) => s.mod.id === 'nsfw'), 'the builtin for the same moment stands down');
  assert(sel.some((s) => s.mod.id === 'core-craft'), 'the core always rides');
  await removeModule(mine.id);
  const again = selectModules(await listModules(), state);
  assert(again.some((s) => s.mod.id === 'nsfw'), 'with mine gone, the builtin rides again');
});

test('M36-4 the import distills the known preset: nothing of it forks the core', () => {
  const preset = { prompts: [
    { identifier: 'a', name: '🖋️ Authorship Frame (persona ownership) 🖋️', content: 'x', enabled: true },
    { identifier: 'main', name: '⚡️Main Prompt 🤖', content: 'x', enabled: true },
    { identifier: 's', name: '🎯 Simulation Core', content: 'x', enabled: true },
    { identifier: 'q', name: '🔒 Information Quarantine', content: 'x', enabled: true },
    { identifier: 'w', name: '✍🏻Writing Guidelines (Anti-Slop) 🗑️', content: 'x', enabled: true },
    { identifier: 'n', name: '🔞NSFW Mode ❤️💋', content: 'x', enabled: true },
    { identifier: 't', name: '💭 NPC Private Thoughts 💭', content: 'x', enabled: true },
  ], prompt_order: [{ character_id: 100001, order: ['a', 'main', 's', 'q', 'w', 'n', 't'].map((identifier) => ({ identifier, enabled: true })) }] };
  const plan = decompose(parsePreset(JSON.stringify(preset)).entries);
  eq(plan.craft.length, 0, 'no craft fork');
  assert(plan.modules.some((m) => /NSFW/.test(m.name) && m.whenKey === 'intimate'), 'the situational module still lands');
  const retiredNames = plan.retired.map((r) => r.name);
  for (const n of ['Authorship Frame', 'Main Prompt', 'Simulation Core', 'Information Quarantine', 'Writing Guidelines', 'NPC Private Thoughts']) {
    assert(retiredNames.some((x) => x.includes(n)), n + ' retired into the craft');
  }
});
