/* M425: a squeeze never covers a hole. The record's lines are squeezed two at a time (the oldest two of a layer) — and
 * a merged line spans from the first one's first page to the second one's last. With a hole between them (a page
 * edited or swiped, its line let go, not yet read again), the merged line claimed the hole's pages: the keeper never
 * read them again (a covered page is not due), and the storyteller's story-so-far lost them for good. Runs the real
 * keeper (maybeSummarize) on a scripted model and the real store. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { maybeSummarize, loadMemory, saveMemory, memoryWithoutPage, coveredSet, dueRange } from '../../js/agents/memory.js';
import { db } from '../../js/store.js';
import { thinkingHouse, withHouse, HOUSES } from './thinkinghouse.mjs';

const line = (a, b, text) => ({ id: 'n' + a, span: [a, b], text, level: 1, at: a, whole: true });

test('M425-1 A SQUEEZE NEVER SPANS A HOLE: with page 6\u201311\u2019s line let go and the keeper unable to read them this run, the oldest two lines are NOT merged across the hole — the hole stays due and is read again', async () => {
  const storyId = 'm425-hole';
  for (let i = 0; i < 60; i += 1) await db.messages.append(storyId, { role: i % 2 ? 'assistant' : 'user', text: 'page ' + i });
  const prior = { k: await db.settings.get('memoryKeeper'), w: await db.settings.get('memoryWindow'), b: await db.settings.get('memoryBatch'), s: await db.settings.get('memorySqueeze') };
  try {
    await db.settings.set('memoryKeeper', true); await db.settings.set('memoryWindow', 30); await db.settings.set('memoryBatch', 6); await db.settings.set('memorySqueeze', 3);
    let mem = { window: 30, nodes: [line(0, 5, 'first six'), line(6, 11, 'second six'), line(12, 17, 'third six'), line(18, 23, 'fourth six'), line(24, 29, 'fifth six')] };
    mem = memoryWithoutPage(mem, 8); /* page 8 edited: its line goes, pages 6..11 are a hole */
    await saveMemory(storyId, mem);
    const house = { fetch: async (url, opts) => {
      const body = JSON.parse(opts.body); const user = String(body.messages[body.messages.length - 1].content || '');
      let answer = 'NONE';
      if (/Write ONE line recording/.test(user)) answer = ''; /* the keeper cannot read the hole this run */
      else if (/being merged into ONE line/.test(user)) answer = 'first six, then third six — merged';
      return thinkingHouse({ answer }).fetch(url, opts);
    } };
    await withHouse(house, () => maybeSummarize({ connection: HOUSES[0].conn, storyId }));
    const after = await loadMemory(storyId);
    const spans = after.nodes.map((n) => n.span.join('-'));
    const covered = coveredSet(after.nodes);
    for (const p of [6, 7, 8, 9, 10, 11]) assert(!covered.has(p), 'page ' + p + ' is still a hole, never claimed by a merged line: ' + spans.join(' '));
    eq(JSON.stringify(dueRange(60, 30, after.nodes, 6)), JSON.stringify([6, 12]), 'and it is the next thing due');
    for (const n of after.nodes) {
      for (let p = n.span[0]; p <= n.span[1]; p += 1) assert(p < 6 || p > 11, 'no line covers the hole: ' + n.span.join('-'));
    }
  } finally {
    for (const [k, v] of [['memoryKeeper', prior.k], ['memoryWindow', prior.w], ['memoryBatch', prior.b], ['memorySqueeze', prior.s]]) { if (v === undefined) await db.settings.delete(k); else await db.settings.set(k, v); }
  }
});

const lvl = (a, b, level, text, extra = {}) => ({ id: 'n' + a + 'L' + level, span: [a, b], text, level, at: a, whole: true, ...extra });
async function squeezeRun(storyId, nodes) {
  for (let i = 0; i < 90; i += 1) await db.messages.append(storyId, { role: i % 2 ? 'assistant' : 'user', text: 'page ' + i });
  const prior = { k: await db.settings.get('memoryKeeper'), w: await db.settings.get('memoryWindow'), b: await db.settings.get('memoryBatch'), s: await db.settings.get('memorySqueeze') };
  try {
    await db.settings.set('memoryKeeper', true); await db.settings.set('memoryWindow', 30); await db.settings.set('memoryBatch', 6); await db.settings.set('memorySqueeze', 3);
    await saveMemory(storyId, { window: 30, nodes });
    const house = { fetch: async (url, opts) => { const body = JSON.parse(opts.body); const user = String(body.messages[body.messages.length - 1].content || ''); return thinkingHouse({ answer: /being merged into ONE line/.test(user) ? 'the two lines, merged, every fact of both kept' : 'NONE' }).fetch(url, opts); } };
    await withHouse(house, () => maybeSummarize({ connection: HOUSES[0].conn, storyId }));
    return await loadMemory(storyId);
  } finally {
    for (const [k, v] of [['memoryKeeper', prior.k], ['memoryWindow', prior.w], ['memoryBatch', prior.b], ['memorySqueeze', prior.s]]) { if (v === undefined) await db.settings.delete(k); else await db.settings.set(k, v); }
  }
}
const coverCount = (nodes) => { const c = new Map(); for (const n of nodes) if (n.span[0] >= 0) for (let p = n.span[0]; p <= n.span[1]; p += 1) c.set(p, (c.get(p) || 0) + 1); return c; };

test('M425-2 A SQUEEZE NEVER SPANS ANOTHER LAYER\u2019S LINES: with pages 12\u201323 re-read as two first-layer lines after an edit, the second layer\u2019s oldest NEIGHBOURS are squeezed — never 0\u201311 with 24\u201335 over them; no page covered twice', async () => {
  const after = await squeezeRun('m425-layers', [lvl(0, 11, 2, 'A'), lvl(12, 17, 1, 'b1'), lvl(18, 23, 1, 'b2'), lvl(24, 35, 2, 'C'), lvl(36, 47, 2, 'D'), lvl(48, 59, 2, 'E')]);
  const twice = [...coverCount(after.nodes)].filter(([, c]) => c > 1).map(([p]) => p);
  eq(twice.length, 0, 'no page covered twice: ' + after.nodes.map((n) => 'L' + n.level + ':' + n.span.join('-')).join(' '));
  assert(after.nodes.some((n) => n.level === 3 && n.span[0] === 24 && n.span[1] === 47), 'the neighbours 24\u201335 and 36\u201347 were squeezed: ' + after.nodes.map((n) => 'L' + n.level + ':' + n.span.join('-')).join(' '));
});

test('M425-3 AN EMPTY MARKER BETWEEN TWO LINES IS TAKEN IN: lines 0\u20135 and 7\u201312 around an empty page 6 are squeezed into 0\u201312, the marker gone with them — never covered twice', async () => {
  const after = await squeezeRun('m425-marker', [lvl(0, 5, 1, 'a'), lvl(6, 6, 1, '', { empty: true }), lvl(7, 12, 1, 'b'), lvl(13, 18, 1, 'c'), lvl(19, 24, 1, 'd'), lvl(25, 29, 1, 'e')]);
  const spans = after.nodes.map((n) => 'L' + n.level + ':' + n.span.join('-')).join(' ');
  assert(after.nodes.some((n) => n.level === 2 && n.span[0] === 0 && n.span[1] === 12), 'squeezed across the empty page: ' + spans);
  eq([...coverCount(after.nodes)].filter(([, c]) => c > 1).length, 0, 'no page covered twice: ' + spans);
});
