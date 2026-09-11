/* M78 — staleness is the anchor: many cards on one surface land in one
 * "Apply all"; a card that truly cannot land says what it looked for. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { emptyState, saveState } from '../../js/engine/state.js';
import { saveLore, loadLore } from '../../js/import/lorebook.js';
import { parseProtocol, stageProposals, applyAllPending, applyProposal, loadSession, saveSession } from '../../js/agents/housekeeper.js';

const stageIn = async (storyId, props) => { const session = await loadSession(storyId); session.turns.push({ role: 'housekeeper', text: 'x', ts: Date.now(), proposals: props }); await saveSession(storyId, session); return session; };

test('M78-1 the writer’s case: six <brief> cards from one answer, one per sixteen-year-old — Apply all lands all six', async () => {
  const story = await db.stories.create({ title: 'Ravenwood' });
  const brief = ['Jovan (16) — first year at Ravenwood High', 'Aurora (16) — first year at Ravenwood High', 'Alexia (15), the eldest', 'Claire (16) — the neighbor', 'Mina (16) — the quiet one', 'Theo (16) — the cousin', 'Rias (24) — keeps the shop', 'Vale (16) — the newcomer'].join('\n');
  await db.stories.update(story.id, { brief });
  const st = await db.stories.get(story.id);
  const answer = '<brief>[' + [
    '{"field":"brief","find":"Alexia (15), the eldest","replace":"Alexia (16) — first year at Ravenwood High, the eldest","reason":"the writer set her age"}',
    '{"field":"brief","find":"Claire (16) — the neighbor","replace":"Claire (16) — first year at Ravenwood High, the neighbor","reason":"every 16-year-old is a first-year"}',
    '{"field":"brief","find":"Mina (16) — the quiet one","replace":"Mina (16) — first year at Ravenwood High, the quiet one","reason":"same"}',
    '{"field":"brief","find":"Theo (16) — the cousin","replace":"Theo (16) — first year at Ravenwood High, the cousin","reason":"same"}',
    '{"field":"brief","find":"Vale (16) — the newcomer","replace":"Vale (16) — first year at Ravenwood High, the newcomer","reason":"same"}',
    '{"field":"cast","append":"Every sixteen-year-old is a first-year at Ravenwood High.","reason":"the standing rule"}',
  ].join(',') + ']</brief>';
  const props = stageProposals(parseProtocol(answer), { messages: [], state: emptyState(), modules: [], lore: [], memory: { nodes: [] }, session: { turns: [] }, story: st });
  eq(props.length, 6); assert(props.every((p) => p.status === 'pending'), props.map((p) => p.status + ':' + p.words).join(' | '));
  const session = await stageIn(story.id, props);
  const r = await applyAllPending(session, story.id);
  assert(r.ok, r.words);
  eq(props.filter((p) => p.status === 'applied').length, 6, 'ALL SIX applied: ' + props.map((p) => p.status + (p.words ? ' (' + p.words + ')' : '')).join(' | '));
  const after = await db.stories.get(story.id);
  for (const name of ['Alexia (16)', 'Claire (16)', 'Mina (16)', 'Theo (16)', 'Vale (16)']) assert(after.brief.includes(name + ' — first year at Ravenwood High'), name + ' is a first-year now');
  assert(after.brief.includes('Rias (24) — keeps the shop'), 'the others stand');
  assert(/Every sixteen-year-old/.test(after.castNotes), 'the append landed');
});

test('M78-2 two edits to the same page, two to the same record line, two lore adds, and a content edit beside a switch on one entry — all land; a destroyed anchor says what it looked for', async () => {
  const story = await db.stories.create({ title: 'Pages' });
  const m = await db.messages.append(story.id, { role: 'assistant', text: 'Kim sat by the window. Kim was tired.' });
  const messages = await db.messages.list(story.id);
  const ref = '#' + m.id.slice(0, 6);
  const memory = { nodes: [{ id: 'n1', span: [0, 5], text: 'Kim met Bob; Kim left early.', level: 1, at: 1 }] };
  await db.settings.set('memory:' + story.id, memory);
  await saveLore(story.id, [{ id: 'l1', name: 'Kris', keys: ['Kris'], content: 'Kendall’s mother.', enabled: true }]);
  const lore = await loadLore(story.id);
  const parsed = parseProtocol([
    '<edits>[{"id":"' + ref + '","find":"sat by the window","replace":"stood by the window","reason":"a"},{"id":"' + ref + '","find":"Kim was tired","replace":"Kim was awake","reason":"b"}]</edits>',
    '<record>[{"line":"#rn1","find":"met Bob","replace":"met Ann","reason":"c"},{"line":"#rn1","find":"left early","replace":"stayed late","reason":"d"}]</record>',
    '<lore>[{"add":true,"name":"Ann","keys":["Ann"],"content":"the sister","reason":"e"},{"add":true,"name":"Bob","keys":["Bob"],"content":"the brother","reason":"f"},{"entry":"Kris","content":"Kendall’s mother, Kris Jenner.","reason":"g"},{"entry":"Kris","enabled":false,"reason":"h"}]</lore>',
  ].join('\n'));
  const props = stageProposals(parsed, { messages, state: emptyState(), modules: [], lore, memory, session: { turns: [] }, story: await db.stories.get(story.id) });
  eq(props.filter((p) => p.status === 'pending').length, 8, props.map((p) => p.kind + ':' + p.status + ' ' + p.words).join(' | '));
  const session = await stageIn(story.id, props);
  const r = await applyAllPending(session, story.id);
  assert(r.ok, r.words);
  eq(props.filter((p) => p.status === 'applied').length, 8, 'all eight landed: ' + props.map((p) => p.kind + ':' + p.status + (p.words ? ' (' + p.words + ')' : '')).join(' | '));
  eq((await db.messages.list(story.id))[0].text, 'Kim stood by the window. Kim was awake.');
  eq((await db.settings.get('memory:' + story.id)).nodes[0].text, 'Kim met Ann; Kim stayed late.');
  const shelf = await loadLore(story.id);
  eq(shelf.length, 3); eq(shelf.find((e) => e.name === 'Kris').content, 'Kendall’s mother, Kris Jenner.'); eq(shelf.find((e) => e.name === 'Kris').enabled, false);
  /* a destroyed anchor: the card says what it looked for and where, and points at Re-propose */
  const p2 = stageProposals(parseProtocol('<edits>[{"id":"' + ref + '","find":"stood by the window","replace":"sat down","reason":"x"}]</edits>'), { messages: await db.messages.list(story.id), state: emptyState(), modules: [], lore: [], memory: { nodes: [] }, session: { turns: [] }, story: {} });
  const s2 = await stageIn(story.id, p2);
  await db.messages.update(story.id, m.id, { text: 'Kim knelt by the window. Kim was awake.' });
  const rr = await applyProposal(s2, story.id, p2[0].id);
  assert(!rr.ok && rr.stale && /the words it looked for, “stood by the window”, are not in page #/.test(rr.words) && /Re-propose/.test(rr.words), rr.words);
  /* an add whose name is already on the shelf is refused for that reason */
  const p3 = stageProposals(parseProtocol('<lore>[{"add":true,"name":"Ann","keys":["Ann"],"content":"again"}]</lore>'), { messages: [], state: emptyState(), modules: [], lore: await loadLore(story.id), memory: { nodes: [] }, session: { turns: [] }, story: {} });
  const s3 = await stageIn(story.id, p3);
  const r3 = await applyProposal(s3, story.id, p3[0].id);
  assert(!r3.ok && /already holds “Ann”/.test(r3.words), r3.words);
});
