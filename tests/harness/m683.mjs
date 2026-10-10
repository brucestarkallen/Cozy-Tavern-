/* M683: real prompt and housekeeper doors, including unsuccessful and unrelated corrections. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { db } from '../../js/store.js';
import { CRAFT_TEXT } from '../../js/assemble/craft.js';
import { listModules, saveModule } from '../../js/assemble/modules.js';
import { buildRequest } from '../../js/assemble/stack.js';
import { emptyState } from '../../js/engine/state.js';
import { autoSupersede, applySupersede, housekeeperTurn, saveSession, loadSession } from '../../js/agents/housekeeper.js';
const oldVoice = readFileSync(new URL('../fixtures/retired_voice_line.txt', import.meta.url), 'utf8').trimEnd();
const bad = (id, tag = 'brief') => ({ id, kind: 'unreadable', status: 'refused', label: id, op: { tag }, words: 'Could not read the block.' });
const replacement = { id: 'valid', kind: 'brief', status: 'pending', op: { field: 'brief', find: 'twenty', replace: 'nineteen' } };

test('M683-1 the actual storyteller request has no female voice ban; edited rules keep all other words and their stored original', async () => {
  const saved = await db.settings.get('modules');
  try {
    const original = CRAFT_TEXT.includes(oldVoice) ? CRAFT_TEXT : CRAFT_TEXT.replace('Shape Follows Spine =', oldVoice + '\nShape Follows Spine =');
    await saveModule({ id: 'core-craft', text: original, pinned: true });
    let craft = (await listModules()).find((m) => m.id === 'core-craft');
    assert(!craft.overridden, 'an untouched older pinned copy follows the builtin');
    assert(!craft.text.includes('Female Vocal Acoustics'), 'the active old pin has no restriction');
    const mine = 'MY WORDS: her voice is deep because the story established it.\n' + original;
    await saveModule({ id: 'core-craft', text: mine, pinned: true });
    craft = (await listModules()).find((m) => m.id === 'core-craft');
    assert(craft.overridden && craft.text.startsWith('MY WORDS:'), 'his edited rule remains his');
    eq(craft.text, mine.split(oldVoice).join(''), 'only the exact retired factory line is removed from the read');
    eq((await db.settings.get('modules')).find((m) => m.id === 'core-craft').text, mine, 'the stored original is untouched');
    const request = buildRequest({ story: { title: 't' }, messages: [{ id: 'u', role: 'user', text: 'I wait.' }], settings: {}, state: emptyState(), modules: [{ mod: craft, reason: 'always' }], memory: '', lore: '', loreFired: [], window: { mode: 'keeper', window: 30, budgetTokens: 200000 } });
    const wire = JSON.stringify({ s: request.systemBlocks, m: request.messages });
    assert(!wire.includes('Female Vocal Acoustics'), 'the wire has no factory voice restriction');
    assert(wire.includes('MY WORDS: her voice is deep'), 'the storyteller receives his own instruction');
  } finally { if (saved === undefined) await db.settings.delete('modules'); else await db.settings.set('modules', saved); }
});

test('M683-2 a malformed block clears only after an explicitly requested, readable correction of that kind', () => {
  const a = bad('retry-me'), unrelated = bad('leave-me'), otherKind = bad('other-kind', 'lore');
  const session = { turns: [{ proposals: [a, unrelated, otherKind] }] };
  eq(autoSupersede(session, [replacement], {}), 0, 'an unrelated new question does not clear old failures');
  eq(autoSupersede(session, [{ ...replacement, status: 'refused' }], { repairIds: [a.id] }), 0, 'another failure does not clear the banner');
  eq(autoSupersede(session, [replacement], { repairIds: [a.id, otherKind.id] }), 1, 'the readable requested block replaces its warning');
  eq(a.status, 'superseded'); eq(unrelated.status, 'refused'); eq(otherKind.status, 'refused');
});

test('M683-3 withdrawing a failed group retires refusals and stale cards, and keeps already applied changes', () => {
  const cards = ['pending', 'refused', 'stale', 'applied', 'skipped'].map((status) => ({ id: status, label: status, status, group: 'g', groupName: 'one correction', op: {} }));
  const session = { turns: [{ proposals: cards }] };
  eq(applySupersede(session, ['group: one correction']).count, 3);
  eq(cards[1].status, 'superseded'); eq(cards[2].status, 'superseded'); eq(cards[3].status, 'applied'); eq(cards[4].status, 'skipped');
});

test('M683-4 the real housekeeper resend passes its repair scope through staging and persists the retired warning', async () => {
  const story = await db.stories.create({ title: 'M683 repair', brief: 'Alexia is twenty.' });
  await db.stories.update(story.id, { brief: 'Alexia is twenty.' });
  const old = bad('resend-this');
  await saveSession(story.id, { id: 1, name: 'Session 1', turns: [{ role: 'housekeeper', text: 'A block could not be read.', raw: '<brief>not JSON</brief>', proposals: [old], ts: 1 }], batches: [] });
  const result = await housekeeperTurn({ storyId: story.id, writerText: 'Please correct the failed brief card.', repairIds: [old.id], call: async () => ({ text: 'A corrected proposal.\n<brief>[{"field":"brief","find":"twenty","replace":"nineteen","reason":"the writer requested it"}]</brief>' }) });
  assert(result.ok, result.error);
  const session = await loadSession(story.id);
  eq(session.turns[0].proposals[0].status, 'superseded', 'the actual door retires the old warning');
  eq(session.turns[0].raw, '<brief>not JSON</brief>', 'the original raw answer remains saved');
  assert(session.turns.at(-1).proposals.some((p) => p.kind === 'brief' && p.status === 'pending'), 'the valid correction stands for review');
});
