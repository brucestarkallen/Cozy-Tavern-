/* M433: an imported SillyTavern lorebook's entries — numbered from 0 — can be edited, moved and removed, by his hand in
 * Settings and by the housekeeper's cards. Runs the real lorebook store and the real housekeeper staging and apply. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { parseLorebook, saveLore, loadLore, updateLoreEntry, moveLoreEntry, removeLoreEntry } from '../../js/import/lorebook.js';
import { parseProtocol, stageProposals, applyProposal } from '../../js/agents/housekeeper.js';
import { emptyState } from '../../js/engine/state.js';

const book = () => parseLorebook(JSON.stringify({ entries: {
  0: { uid: 0, key: ['Rukia'], comment: 'Rukia', content: 'Lieutenant of the 13th.' },
  1: { uid: 1, key: ['Renji'], comment: 'Renji', content: 'Lieutenant of the 6th.' },
  2: { uid: 2, key: ['Byakuya'], comment: 'Byakuya', content: 'Captain of the 6th.' },
} }));

test('M433-1 THE FIRST ENTRY OF A SILLYTAVERN LOREBOOK (id 0) IS AN ENTRY: edited, moved and removed by his hand', async () => {
  const sid = 'm433-hand';
  await saveLore(sid, book());
  eq((await loadLore(sid))[0].id, 0, 'imported as it came — the first entry is id 0');
  const edited = await updateLoreEntry(sid, 0, { content: 'Oda\u2019s lieutenant; had expected the captaincy.' });
  assert(edited && edited.content === 'Oda\u2019s lieutenant; had expected the captaincy.', 'entry 0 edited');
  const moved = await moveLoreEntry(sid, 0, 1);
  assert(moved && moved[1].id === 0, 'entry 0 moved down one');
  const left = await removeLoreEntry(sid, 0);
  assert(left && !left.some((e) => e.id === 0) && left.length === 2, 'entry 0 removed');
});

test('M433-2 THE HOUSEKEEPER\u2019S CARD ON AN IMPORTED ENTRY LANDS: numbered entries are never read as gone', async () => {
  const sid = 'm433-hk';
  await saveLore(sid, book());
  const lore = await loadLore(sid);
  const staged = stageProposals(parseProtocol('<lore>[{"entry":"Renji","content":"Lieutenant of the 6th; Rukia\u2019s oldest friend."},{"entry":"Rukia","content":"Oda\u2019s lieutenant."}]</lore>'),
    { messages: [], state: emptyState(), modules: [], lore, memory: { nodes: [] }, session: { turns: [] }, story: { id: sid, title: 't' } });
  eq(staged.length, 2, 'two cards');
  const s = { id: 1, turns: [{ role: 'housekeeper', text: 'x', proposals: staged, ts: 1 }] };
  for (const card of staged) {
    eq(card.status, 'pending', 'staged to land');
    const r = await applyProposal(s, sid, card.id);
    assert(r.ok, 'it lands — never "that lore entry is gone": ' + r.words);
  }
  const after = await loadLore(sid);
  eq(after.find((e) => e.id === 1).content, 'Lieutenant of the 6th; Rukia\u2019s oldest friend.', 'entry 1 changed');
  eq(after.find((e) => e.id === 0).content, 'Oda\u2019s lieutenant.', 'and entry 0');
  /* named by its number, as SillyTavern numbers it */
  const byNumber = stageProposals(parseProtocol('<lore>[{"entry":"2","content":"Captain of the 6th; Rukia\u2019s brother."}]</lore>'),
    { messages: [], state: emptyState(), modules: [], lore: after, memory: { nodes: [] }, session: { turns: [] }, story: { id: sid, title: 't' } });
  eq(byNumber[0].status, 'pending', 'an entry named by its number is found: ' + byNumber[0].words);
  const s2 = { id: 2, turns: [{ role: 'housekeeper', text: 'x', proposals: byNumber, ts: 2 }] };
  assert((await applyProposal(s2, sid, byNumber[0].id)).ok, 'and the card lands');
  eq((await loadLore(sid)).find((e) => e.id === 2).content, 'Captain of the 6th; Rukia\u2019s brother.', 'on entry 2');
});
