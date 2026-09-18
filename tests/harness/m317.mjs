/* M317 — one window for a tale: the light and the keeper measure the same gap. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { maybeSummarize, loadMemory, saveMemory, dueRange, cleanBatch, cleanWindow, visiblePages, windowFor, keeperTrouble } from '../../js/agents/memory.js';

const line = () => { const t = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Jovan and Liara talked on the porch; the street went quiet; she asked him to stay for the fair.' } }] }) + '\n\ndata: [DONE]\n\n'; return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(t)); c.close(); } }), clone() { return this; }, async json() { return {}; }, async text() { return t; } }; };
const DS = { type: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'deepseek-chat', reasoning: { effort: 'off' } };

test('M317-1 THE WRITER’S YELLOW LIGHT, for real: a tale folded under a window of 10, the Settings slider since raised to 30 — the light saw a gap the keeper would never fold. Now both read the same window', async () => {
  const st = await db.stories.create({ title: 'folded under another window' });
  for (let i = 0; i < 40; i += 1) await db.messages.append(st.id, { role: i % 2 ? 'assistant' : 'user', text: 'Page ' + i + ': Jovan and Liara talked on the porch about the letter and the fair. ' + 'The street went quiet. '.repeat(6) });
  await db.settings.set('memoryBatch', 6);
  /* folded while the window was 10: pages 0..23 are lines, 24..29 are the next batch due */
  await saveMemory(st.id, { window: 10, nodes: [0, 6, 12, 18].map((from, i) => ({ id: 'n' + i, span: [from, from + 5], text: 'Pages ' + (from + 1) + '-' + (from + 6) + ': they talked.', level: 1, at: 1, whole: true })) });
  await db.settings.set('memoryWindow', 30); /* the writer raises the slider */
  const mem = await loadMemory(st.id);
  const pages = visiblePages(await db.messages.list(st.id)).length;
  const setting = await db.settings.get('memoryWindow');
  /* what the light did (the tale's stamp first) against what the keeper does (the setting) */
  const lightSawBefore = Boolean(dueRange(pages, cleanWindow(mem.window || setting), mem.nodes, cleanBatch(6)));
  let calls = 0; const prior = globalThis.fetch; globalThis.fetch = async () => { calls += 1; return line(); };
  try { await maybeSummarize({ connection: { ...DS }, storyId: st.id, stale: () => false, renew: () => true }); } finally { globalThis.fetch = prior; }
  assert(lightSawBefore, 'fixture: by the tale’s old stamp there IS a gap — this is what turned the light yellow');
  eq(calls, 0, 'fixture: and the keeper, reading the setting, has nothing to fold — it never even asks its model');
  eq(keeperTrouble(), '', 'so it had no reason to give either: "could not fold a gap yet", after every page, for twenty pages');
  /* the fix: everyone asks windowFor */
  eq(windowFor(mem, setting), 30, 'the writer’s current setting is the window');
  eq(dueRange(pages, windowFor(mem, setting), mem.nodes, cleanBatch(6)), null, 'so the light sees what the keeper sees: nothing due — green');
  eq(windowFor({ window: 10 }, undefined), 10, 'the tale’s stamp stands in only when Settings has none');
  /* and the other way round — the slider LOWERED: both see the gap, and the keeper folds it */
  await db.settings.set('memoryWindow', 4);
  assert(dueRange(pages, windowFor(await loadMemory(st.id), 4), (await loadMemory(st.id)).nodes, cleanBatch(6)), 'a lower window: pages are due');
  globalThis.fetch = async () => line();
  try { for (let i = 0; i < 3; i += 1) await maybeSummarize({ connection: { ...DS }, storyId: st.id, stale: () => false, renew: () => true }); } finally { globalThis.fetch = prior; }
  const after = await loadMemory(st.id);
  eq(dueRange(pages, windowFor(after, 4), after.nodes, cleanBatch(6)), null, 'and they are folded: no gap by the one measure everyone uses');
  await db.settings.delete('memoryWindow'); await db.settings.delete('memoryBatch');
});
