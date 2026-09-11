/* M38 — the housekeeper keeps the lore shelf: add, edit, remove, undo; staged like everything else. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { parseProtocol, stageProposals, applyProposal, undoLatest, buildHousekeeperContext } from '../../js/agents/housekeeper.js';
import { loadLore, saveLore } from '../../js/import/lorebook.js';
import { emptyState } from '../../js/engine/state.js';

const session = () => ({ turns: [], batches: [] });

test('M38-1 the protocol reads <lore> blocks; the prompt teaches them; the context shows the shelf', () => {
  const p = parseProtocol('Here.\n<lore>[{"add":true,"name":"Aurora","keys":["Aurora","the neighbor"],"content":"Childhood friend, lives next door.","reason":"the writer asked"}]</lore>\nDone.');
  eq(p.lore.length, 1); eq(p.lore[0].name, 'Aurora'); eq(p.text.replace(/\n+/g, '\n'), 'Here.\nDone.');
  const ctx = buildHousekeeperContext({ story: { title: 't' }, messages: [], state: emptyState(), modules: [], lore: [{ id: 'l1', name: 'Kris', keys: ['Kris', 'mother'], content: 'Kendall’s mother.', enabled: true }] });
  /* M74: the shelf is shown WHOLE, entry by entry */
  assert(/THE LORE SHELF \(the entries that wake[^\n]*\n\[Kris\] keys: Kris, mother\nKendall’s mother\./.test(ctx), ctx.slice(ctx.indexOf('THE LORE'), ctx.indexOf('THE LORE') + 160));
  const empty = buildHousekeeperContext({ story: { title: 't' }, messages: [], state: emptyState(), modules: [], lore: [] });
  assert(/THE LORE SHELF is empty\./.test(empty));
});

test('M38-2 add, edit, remove land as cards; apply changes the shelf; undo restores it whole; drift refuses', async () => {
  const storyId = 'm38';
  await saveLore(storyId, [{ id: 'l1', name: 'Kris', keys: ['Kris'], content: 'the mother', enabled: true, constant: false }]);
  let lore = await loadLore(storyId);
  const s = session();
  const staged = stageProposals(parseProtocol('<lore>[{"add":true,"name":"Aurora","keys":["Aurora"],"content":"next door"},{"entry":"Kris","content":"Kendall’s mother; runs the family","constant":true},{"entry":"nobody","remove":true},{"add":true,"name":"","keys":[],"content":"x"}]</lore>'), { messages: [], state: emptyState(), modules: [], lore });
  eq(staged.length, 4);
  eq(staged[0].kind, 'lore'); eq(staged[0].status, 'pending'); assert(/add Aurora/.test(staged[0].label));
  eq(staged[1].status, 'pending'); eq(staged[1].op.patch.constant, true);
  eq(staged[2].status, 'refused'); assert(/no entry called/.test(staged[2].words));
  eq(staged[3].status, 'refused');
  s.turns.push({ role: 'housekeeper', text: 'x', proposals: staged, ts: 1 });
  const r1 = await applyProposal(s, storyId, staged[0].id);
  assert(r1.ok && r1.touched.lore, r1.words);
  lore = await loadLore(storyId);
  eq(lore.length, 2); eq(lore[1].name, 'Aurora'); eq(lore[1].keys[0], 'Aurora'); eq(lore[1].enabled, true);
  const r2 = await applyProposal(s, storyId, staged[1].id);
  assert(r2.ok, r2.words);
  lore = await loadLore(storyId);
  eq(lore[0].content, 'Kendall’s mother; runs the family'); eq(lore[0].constant, true);
  /* undo walks back the last batch (the edit), then the add */
  const u1 = await undoLatest(s, storyId);
  assert(u1.ok, u1.words);
  eq((await loadLore(storyId))[0].content, 'the mother');
  const u2 = await undoLatest(s, storyId);
  assert(u2.ok, u2.words);
  eq((await loadLore(storyId)).length, 1, 'the add is taken back');
  /* a removal, then a hand edit, then undo refuses */
  const staged2 = stageProposals(parseProtocol('<lore>[{"entry":"Kris","remove":true}]</lore>'), { messages: [], state: emptyState(), modules: [], lore: await loadLore(storyId) });
  s.turns.push({ role: 'housekeeper', text: 'y', proposals: staged2, ts: 2 });
  const r3 = await applyProposal(s, storyId, staged2[0].id);
  assert(r3.ok && (await loadLore(storyId)).length === 0, 'removed');
  await saveLore(storyId, [{ id: 'hand', name: 'By hand', keys: ['hand'], content: 'x', enabled: true }]);
  const u3 = await undoLatest(s, storyId);
  assert(!u3.ok && u3.refused && /changed since/.test(u3.words), 'drift refuses the undo');
  /* staleness: a card staged against an entry that was edited since is refused at apply */
  await saveLore(storyId, [{ id: 'l9', name: 'Old', keys: ['Old'], content: 'v1', enabled: true }]);
  const staged3 = stageProposals(parseProtocol('<lore>[{"entry":"Old","content":"v2"}]</lore>'), { messages: [], state: emptyState(), modules: [], lore: await loadLore(storyId) });
  s.turns.push({ role: 'housekeeper', text: 'z', proposals: staged3, ts: 3 });
  await saveLore(storyId, [{ id: 'l9', name: 'Old', keys: ['Old'], content: 'v1.5', enabled: true }]);
  const r4 = await applyProposal(s, storyId, staged3[0].id);
  assert(!r4.ok && r4.stale, 'stale is refused: ' + r4.words);
});
