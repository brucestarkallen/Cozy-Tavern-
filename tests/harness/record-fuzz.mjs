/* M425: THE RECORD MUST SPEAK OF THE PAGES IT CLAIMS. The story-so-far is lines, each claiming a run of pages (its span).
 * Pages are deleted (the record slides), edited or swiped (the line over them is let go, a hole the keeper reads again),
 * taken back from a point (every line reaching past it goes), and lines are squeezed two into one. If a span ever came
 * to claim pages its words were not written from — an off-by-one in a slide, a squeeze across a hole or another
 * layer — the storyteller would read a story-so-far that is quietly not the story. This walks random stories through
 * all of it with the REAL keeper (maybeSummarize) on a scripted model that writes, into every line, exactly which pages
 * it was shown — and holds every line to the pages under its span, after every step. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { maybeSummarize, loadMemory, saveMemory, memoryAfterDeletion, memoryWithoutPage, memoryTruncatedAt, visiblePages } from '../../js/agents/memory.js';
import { db } from '../../js/store.js';
import { thinkingHouse, withHouse, HOUSES } from './thinkinghouse.mjs';

let seed = 20260923;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
let tok = 0;
const toks = (s) => (String(s).match(/tok\d+/g) || []);
/* the keeper writes, into every line, the tokens of the pages it read; a merge writes both lines' tokens */
const house = { fetch: async (url, opts) => {
  const body = JSON.parse(opts.body);
  const user = String(body.messages[body.messages.length - 1].content || '');
  const passage = (user.match(/<passage>([\s\S]*?)<\/passage>/) || [])[1] || '';
  let answer = 'NONE';
  if (/being merged into ONE line/.test(user)) answer = 'merged: ' + toks(passage).join(' ');
  else if (/Write ONE line recording/.test(user)) answer = 'read: ' + toks(passage).join(' ');
  return thinkingHouse({ answer }).fetch(url, opts);
} };

async function check(storyId, where, bad) {
  const pages = visiblePages(await db.messages.list(storyId));
  const mem = await loadMemory(storyId);
  const count = new Map();
  for (const n of mem.nodes) {
    if (!n || !Array.isArray(n.span) || n.correction) continue;
    if (n.span[0] < 0 || n.span[1] >= pages.length || n.span[0] > n.span[1]) { bad.push(where + ': a span outside the story ' + n.span.join('-') + ' of ' + pages.length); continue; }
    for (let p = n.span[0]; p <= n.span[1]; p += 1) count.set(p, (count.get(p) || 0) + 1);
    if (n.empty) continue;
    const want = pages.slice(n.span[0], n.span[1] + 1).flatMap((m) => toks(m.text)).join(' ');
    const has = toks(n.text).join(' ');
    if (want !== has) bad.push(where + ': line ' + n.span.join('-') + ' L' + n.level + ' speaks of [' + has + '] over pages [' + want + ']');
  }
  for (const [p, c] of count) if (c > 1) bad.push(where + ': page ' + p + ' covered ' + c + ' times');
}

test('M425-4 FUZZ: every line of the record speaks of exactly the pages under it — through additions, deletions, edits, take-backs and squeezes, on the real keeper', async () => {
  const prior = { k: await db.settings.get('memoryKeeper'), w: await db.settings.get('memoryWindow'), b: await db.settings.get('memoryBatch'), s: await db.settings.get('memorySqueeze') };
  const bad = []; let steps = 0; let lines = 0;
  try {
    await db.settings.set('memoryKeeper', true); await db.settings.set('memoryWindow', 6); await db.settings.set('memoryBatch', 3); await db.settings.set('memorySqueeze', 3);
    for (let trial = 0; trial < 60 && bad.length < 4; trial += 1) {
      const storyId = 'record-fuzz-' + trial;
      for (let i = 0; i < 14; i += 1) await db.messages.append(storyId, { role: i % 2 ? 'assistant' : 'user', text: 'page tok' + (tok += 1) });
      for (let step = 0; step < 30 && bad.length < 4; step += 1) {
        steps += 1;
        const pages = visiblePages(await db.messages.list(storyId));
        const r = rnd();
        if (r < 0.34 || pages.length < 8) {
          for (let i = 0, n = 1 + Math.floor(rnd() * 4); i < n; i += 1) await db.messages.append(storyId, { role: (pages.length + i) % 2 ? 'assistant' : 'user', text: 'page tok' + (tok += 1) });
        } else if (r < 0.52) {                                      /* a page deleted: the record slides */
          const k = Math.floor(rnd() * pages.length);
          await db.messages.remove(storyId, pages[k].id);
          await saveMemory(storyId, memoryAfterDeletion(await loadMemory(storyId), k));
        } else if (r < 0.7) {                                       /* a page edited or swiped: its line goes */
          const k = Math.floor(rnd() * pages.length);
          await db.messages.update(storyId, pages[k].id, { text: 'page tok' + (tok += 1) });
          await saveMemory(storyId, memoryWithoutPage(await loadMemory(storyId), k));
        } else if (r < 0.8) {                                       /* taken back from a point: the pages after go */
          const k = Math.max(4, Math.floor(rnd() * pages.length));
          for (const m of pages.slice(k)) await db.messages.remove(storyId, m.id);
          await saveMemory(storyId, memoryTruncatedAt(await loadMemory(storyId), k));
        }
        await withHouse(house, () => maybeSummarize({ connection: HOUSES[0].conn, storyId }));
        await check(storyId, 'trial ' + trial + ' step ' + step, bad);
        lines = Math.max(lines, (await loadMemory(storyId)).nodes.length);
      }
    }
  } finally {
    for (const [k, v] of [['memoryKeeper', prior.k], ['memoryWindow', prior.w], ['memoryBatch', prior.b], ['memorySqueeze', prior.s]]) { if (v === undefined) await db.settings.delete(k); else await db.settings.set(k, v); }
  }
  assert(steps > 250 && lines >= 4, 'the fuzz really ran (' + steps + ' steps, up to ' + lines + ' lines)');
  eq(bad.length, 0, bad.join('\n      '));
});
