/* M466 — words in the storyteller's own voice: each entry rides at its landmark with its role; off or empty, not one
 * byte moves; a model named reasoner takes no two of a role in a row. And the shelves' new row field. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { buildRequest, ownWordsFor, OWN_WORDS_PLACES } from '../../js/assemble/stack.js';
import { emptyState } from '../../js/engine/state.js';
import { createProvider } from '../../js/providers/index.js';
import { thinkingHouse, withHouse } from './thinkinghouse.mjs';
import { db } from '../../js/store.js';

const story = { title: 't', brief: 'a brief', castNotes: '' };
const pages = [
  { id: 'u1', role: 'user', text: 'I walk in.' },
  { id: 'a1', role: 'assistant', text: '[The Lantern — Tuesday | 21:00] The door swung.' },
  { id: 'u2', role: 'user', text: 'I sit down and wait.' },
];
const build = (settings) => buildRequest({
  story, messages: pages, settings, state: emptyState(), modules: [{ mod: { id: 'core-craft', name: 'Craft', text: 'CRAFT' }, reason: 'always' }],
  memory: '', cast: [], lore: '', loreFired: [], window: { mode: 'keeper', window: 30, budgetTokens: 200000 },
});
const roles = (req) => req.messages.map((m) => m.role).join(' ');
const at = (req, text) => req.messages.findIndex((m) => String(m.content).includes(text));

test('M466-1 ownWordsFor: off, empty and malformed entries send nothing; the names are filled in; the roles map', () => {
  const voice = { teller: 'Iron Man', writer: 'Bruce' };
  eq(ownWordsFor({}, voice).length, 0, 'nothing written → nothing');
  eq(ownWordsFor({ ownWords: 'junk' }, voice).length, 0, 'a wrong shape → nothing');
  eq(ownWordsFor({ ownWords: [{ on: false, text: 'x' }, { text: '   ' }, null, 'junk'] }, voice).length, 0, 'off, blank, null, junk → nothing');
  const [w] = ownWordsFor({ ownWords: [{ name: '  Stay me ', role: 'teller', place: 'before-pages', text: '{{teller}} here — {{you}}, I stay myself.' }] }, voice);
  eq(w.name, 'Stay me'); eq(w.role, 'assistant'); eq(w.place, 'before-pages');
  eq(w.text, 'Iron Man here — Bruce, I stay myself.', 'the two names from The frame');
  const [n] = ownWordsFor({ ownWords: [{ text: '{{teller}} and {{you}}' }] }, { teller: '', writer: '' });
  eq(n.text, 'the storyteller and you', 'no names set: plain words stand in');
  eq(n.role, 'assistant', 'the storyteller’s own words by default'); eq(n.place, 'after-your-message', 'after his message by default');
  eq(ownWordsFor({ ownWords: [{ role: 'you', text: 'a' }] }, voice)[0].role, 'user');
  eq(ownWordsFor({ ownWords: [{ role: 'house', text: 'a' }] }, voice)[0].role, 'system');
  eq(ownWordsFor({ ownWords: [{ role: 'nonsense', place: 'nowhere', text: 'a' }] }, voice)[0].place, 'after-your-message', 'an unknown place is the default one');
  assert(Object.keys(OWN_WORDS_PLACES).length === 3, 'three landmarks, never a fourth (the last spot is the prefill’s)');
});

test('M466-2 the request without any entry is byte for byte the request with none written, off, or empty', () => {
  const bare = JSON.stringify(build({ frameText: 'F', noteText: 'N' }).messages);
  eq(JSON.stringify(build({ frameText: 'F', noteText: 'N', ownWords: [] }).messages), bare, 'an empty list');
  eq(JSON.stringify(build({ frameText: 'F', noteText: 'N', ownWords: [{ on: false, text: 'STAY-MARK' }] }).messages), bare, 'switched off');
  eq(JSON.stringify(build({ frameText: 'F', noteText: 'N', ownWords: [{ text: '  ' }] }).messages), bare, 'blank words');
});

test('M466-3 each entry lands at its landmark, with its role, and the pages themselves are untouched', () => {
  const req = build({ frameText: 'F', noteText: 'NOTE-MARK', ownWords: [
    { name: 'front', role: 'teller', place: 'before-pages', text: 'FRONT-MARK' },
    { name: 'mid', role: 'teller', place: 'before-your-message', text: 'MID-MARK' },
    { name: 'tail', role: 'you', place: 'after-your-message', text: 'TAIL-MARK' },
  ] });
  const front = at(req, 'FRONT-MARK'); const mid = at(req, 'MID-MARK'); const tail = at(req, 'TAIL-MARK');
  const firstPage = at(req, 'I walk in.'); const lastPage = at(req, 'I sit down and wait.'); const note = at(req, 'NOTE-MARK');
  assert(front !== -1 && mid !== -1 && tail !== -1, 'all three ride: ' + roles(req));
  assert(front < at(req, 'The door swung.') && front === firstPage + 1, 'with no notes message, behind his first page and before the first storyteller page (an assistant message never opens a request): ' + roles(req));
  eq(req.messages[front].role, 'assistant', 'the storyteller’s own words are an assistant message');
  eq(req.messages[mid].role, 'assistant');
  eq(mid, lastPage - 1, 'right before his message of this turn');
  eq(req.messages[tail].role, 'user', 'his words are a user message');
  assert(tail > lastPage && tail < note, 'after his message, before the closing words: ' + roles(req));
  eq(req.messages[0].role, 'user', 'a user message opens the request');
  eq(req.messages[lastPage].content, 'I sit down and wait.', 'his page is his page');
  eq(req.messages[firstPage].content, 'I walk in.');
  /* every entry is a receipt row of its own, naming its place, and is in the request (M259-46) */
  const rows = req.receipt.slots.filter((s) => s.name.startsWith('Own words — '));
  eq(rows.map((r) => r.name).join('|'), 'Own words — front|Own words — mid|Own words — tail');
  for (const r of rows) assert(req.messages.some((m) => m.content === r.text), r.name + ' is sent as listed');
  assert(rows[0].source.includes('before the first story page'), 'the row says where: ' + rows[0].source);
});

test('M466-4 an entry with nothing to stand before goes last, never before the notes; a first turn with no state message still takes the front one', () => {
  const req = buildRequest({ story, messages: [{ id: 'u1', role: 'user', text: 'First words.' }], settings: { frameText: 'F', ownWords: [{ place: 'before-your-message', text: 'MID-MARK' }, { place: 'before-pages', text: 'FRONT-MARK' }] },
    state: emptyState(), modules: [], memory: '', cast: [], lore: '', loreFired: [], window: { mode: 'keeper', window: 30, budgetTokens: 200000 } });
  const first = at(req, 'First words.');
  eq(first, 0, 'his one page opens the request: ' + roles(req));
  eq(at(req, 'FRONT-MARK'), 1, 'the front entry steps behind it (never an assistant message first)');
  eq(at(req, 'MID-MARK'), 2, 'the one meant to stand before his message has nothing to stand before — it follows');
});

test('M466-5 a model named reasoner takes no two of a role in a row — folded, order kept; deepseek-chat is left as built', async () => {
  const wire = [
    { role: 'user', content: 'notes' }, { role: 'user', content: 'I walk in.' },
    { role: 'assistant', content: 'The door swung.' }, { role: 'assistant', content: 'STAY-MARK' },
    { role: 'user', content: 'I sit.' }, { role: 'system', content: 'closing' },
  ];
  const sent = async (model) => {
    const house = thinkingHouse({ answer: 'a page' });
    await withHouse(house, () => createProvider({ type: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k', model }).streamChat({ system: 's', messages: wire, onToken() {} }).catch(() => null));
    return house.calls[0].body.messages;
  };
  const r = await sent('deepseek-reasoner');
  eq(r.map((m) => m.role).join(' '), 'system user assistant user system', 'reasoner: neighbours of one role folded');
  eq(r[1].content, 'notes\n\nI walk in.', 'a blank line between, order kept');
  eq(r[2].content, 'The door swung.\n\nSTAY-MARK', 'his own-voice words still ride, inside the page’s message');
  const c = await sent('deepseek-chat');
  eq(c.map((m) => m.role).join(' '), 'system user user assistant assistant user system', 'deepseek-chat takes them as built');
});

test('M466-6 a shelf put to rest keeps its id, name and tales; woken, it is as it was', async () => {
  const shelf = await db.projects.create({ name: 'Paused tales' });
  const tale = await db.stories.create({ title: 'on the paused shelf' });
  await db.stories.update(tale.id, { projectId: shelf.id });
  const rested = await db.projects.update(shelf.id, { archived: true });
  eq(rested.id, shelf.id); eq(rested.name, 'Paused tales'); eq(rested.archived, true);
  eq((await db.projects.list()).find((p) => p.id === shelf.id).archived, true, 'kept');
  eq((await db.stories.get(tale.id)).projectId, shelf.id, 'the tale stays on it');
  const woken = await db.projects.update(shelf.id, { archived: false });
  eq(woken.archived, false);
  eq(await db.projects.update('no-such-shelf', { archived: true }), undefined, 'an unknown shelf is left alone');
  await db.projects.remove(shelf.id); await db.stories.remove(tale.id);
});

test('M481 the receipt shows each own-voice row AT ITS LANDMARK — before "The story so far" for the front one, after it for the two that ride behind the pages; the wire is unchanged', () => {
  const req = build({ frameText: 'F', noteText: 'NOTE-MARK', ownWords: [
    { name: 'front', role: 'teller', place: 'before-pages', text: 'FRONT-MARK' },
    { name: 'mid', role: 'teller', place: 'before-your-message', text: 'MID-MARK' },
    { name: 'tail', role: 'you', place: 'after-your-message', text: 'TAIL-MARK' },
  ] });
  const names = req.receipt.slots.map((s) => s.name);
  const at = (n) => names.indexOf(n);
  assert(at('Own words — front') !== -1 && at('Own words — front') < at('The story so far'), 'the front row before the pages: ' + names.join(' | '));
  assert(at('Own words — mid') > at('The story so far') && at('Own words — mid') < at('The note at the end'), 'the mid row after the pages, before the note');
  assert(at('Own words — tail') > at('Own words — mid') && at('Own words — tail') < at('The note at the end'), 'the tail row after the mid, before the note');
  const msgs = req.messages;
  eq(msgs.findIndex((m) => /FRONT-MARK/.test(m.content)), msgs.findIndex((m) => /I walk in\./.test(m.content)) + 1, 'the wire as M466-3 holds (no notes message here: the front entry steps behind his first page)');
});
