/* M316 — the record can never stay stuck on a page (a NON-thinking keeper whose model answers one page with nothing). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { maybeSummarize, loadMemory, keeperTrouble, dueRange, cleanWindow, cleanBatch, visiblePages } from '../../js/agents/memory.js';

const sse = (pieces) => { const t = pieces.map((p) => 'data: ' + JSON.stringify(p) + '\n\n').join('') + 'data: [DONE]\n\n'; return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(t)); c.close(); } }), clone() { return this; }, async json() { return {}; }, async text() { return t; } }; };
const say = (text) => sse([{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]);
const nothing = () => sse([{ choices: [{ delta: { content: '' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]);
/* thinking OFF, as the writer has it: a plain model that writes a line for any pages — except any batch holding the one page it will not touch */
function house({ dead = false } = {}) {
  const asked = [];
  const f = async (url, opts) => {
    const body = JSON.parse(opts.body);
    const user = String(body.messages[body.messages.length - 1].content || '');
    asked.push(user.slice(0, 60));
    if (dead) return nothing();
    if (/single word: ready/.test(user)) return say('ready');
    if (/THE FORBIDDEN PAGE/.test(user)) return nothing();
    return say('Jovan and Liara talked on the porch; the street went quiet; she asked him to stay for the fair.');
  };
  return { asked, f };
}
const DS = { type: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'deepseek-chat', reasoning: { effort: 'off' } };
async function tale(title) {
  const st = await db.stories.create({ title });
  for (let i = 0; i < 20; i += 1) await db.messages.append(st.id, { role: i % 2 ? 'assistant' : 'user', text: i === 1 ? '[The Wells house — Friday | 20:40]\n\nTHE FORBIDDEN PAGE: what happened on the porch that night, told in full. ' + 'The street went quiet. '.repeat(30) : 'Page ' + i + ': Jovan and Liara talked on the porch about the letter and the fair. ' + 'The street went quiet. '.repeat(6) });
  return st;
}
const gap = async (id) => { const mem = await loadMemory(id); return dueRange(visiblePages(await db.messages.list(id)).length, cleanWindow(4), mem.nodes, cleanBatch(6)); };

test('M316-1 THE WRITER’S YELLOW LIGHT, thinking OFF: one page the keeper’s model answers with nothing held the record for ever — now the run after next moves past it, the page marked in the record, and says so', async () => {
  await db.settings.set('memoryWindow', 4); await db.settings.set('memoryBatch', 6);
  const st = await tale('stuck on a page');
  const h = house(); const prior = globalThis.fetch; globalThis.fetch = h.f;
  try {
    await maybeSummarize({ connection: { ...DS }, storyId: st.id, stale: () => false, renew: () => true });
    let mem = await loadMemory(st.id);
    /* run 1: page 0 alone was folded (the batch held the forbidden page, so the oldest page was asked alone); then page 1 is met and fails once */
    eq(mem.nodes.map((n) => n.span.join('-')).join(','), '0-0', 'the oldest page was asked ALONE and folded: ' + JSON.stringify(mem.nodes.map((n) => n.span)));
    eq(JSON.stringify(mem.stuck), JSON.stringify({ at: 1, tries: 1 }), 'and the page that gave nothing is remembered');
    assert(/nothing it could use for page 2/.test(keeperTrouble()), 'the note says which page: ' + keeperTrouble());
    assert(await gap(st.id), 'fixture: still a gap — the light is yellow');
    /* run 2: the same page fails again; the keeper proves it is alive; the house keeps the page's own words and the record moves on */
    await maybeSummarize({ connection: { ...DS }, storyId: st.id, stale: () => false, renew: () => true });
    mem = await loadMemory(st.id);
    const houseNode = mem.nodes.find((n) => n.span[0] === 1);
    assert(houseNode && houseNode.byHouse === true && houseNode.span[1] === 1, 'one page only, marked as the house’s: ' + JSON.stringify(houseNode && houseNode.span));
    /* M330: the mark carries NO words — M316 wrote "(no line from the keeper… “Summarize now” on this line…)" into the record,
     * the house talking about its own buttons inside what the storyteller reads as the story so far */
    eq(houseNode.text, '', 'a wordless cover'); assert(houseNode.empty === true);
    const { recordFor } = await import('../../js/agents/memory.js');
    assert(!/keeper|Summarize|no line/i.test(recordFor(mem, 1, 100000)), 'and nothing of it rides to the storyteller: ' + recordFor(mem, 1, 100000).slice(0, 200));
    assert(h.asked.some((u) => /single word: ready/.test(u)), 'only after the keeper proved it answers at all');
    assert(mem.nodes.some((n) => n.span[0] === 2 && !n.byHouse), 'and the SAME run went on to fold the pages after it: ' + JSON.stringify(mem.nodes.map((n) => n.span)));
    assert(!mem.stuck, 'nothing is stuck any more');
    /* a few more runs: the gap closes — green */
    for (let i = 0; i < 4 && (await gap(st.id)); i += 1) await maybeSummarize({ connection: { ...DS }, storyId: st.id, stale: () => false, renew: () => true });
    eq(await gap(st.id), null, 'no gap is left: the light goes green');
    eq((await loadMemory(st.id)).nodes.filter((n) => n.byHouse).length, 1, 'and only the one page is the house’s');
  } finally { globalThis.fetch = prior; }
});

test('M316-2 a keeper that answers NOTHING AT ALL is never papered over: no house lines, and the note says the keeper is not answering', async () => {
  const st = await tale('a dead keeper');
  const h = house({ dead: true }); const prior = globalThis.fetch; globalThis.fetch = h.f;
  try {
    for (let i = 0; i < 4; i += 1) await maybeSummarize({ connection: { ...DS }, storyId: st.id, stale: () => false, renew: () => true });
    eq((await loadMemory(st.id)).nodes.length, 0, 'not one line was written for it');
    assert(/not answering at all/.test(keeperTrouble()), 'and the writer is told what is wrong: ' + keeperTrouble());
  } finally { globalThis.fetch = prior; await db.settings.delete('memoryWindow'); await db.settings.delete('memoryBatch'); }
});
