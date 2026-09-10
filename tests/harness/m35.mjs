/* M35 — the record is verified and mended (Summaryception's auditor); relations and the real record. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { parseVerifyAnswer, buildVerifyMessages, buildRewriteMessages, maybeSummarize, loadMemory, saveMemory } from '../../js/agents/memory.js';
import { parseContinuityAnswer, parseMendAnswer, buildMendMessages, mendPages, editDistanceRatio } from '../../js/agents/continuity.js';
import { buildWorldMessages } from '../../js/agents/world.js';
import { buildScribeMessages } from '../../js/agents/scribe.js';
import { emptyState } from '../../js/engine/state.js';
import { db } from '../../js/store.js';
import { thinkingHouse, withHouse, HOUSES } from './thinkinghouse.mjs';

const pages = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, role: i % 2 ? 'assistant' : 'user', text: 'page ' + i, ts: i }));

test('M35-1 the verifier’s answers: NONE, a snippet drift, a source contradiction; fences and prose survived', () => {
  eq(parseVerifyAnswer('NONE').length, 0);
  const list = parseVerifyAnswer('Here:\n```json\n[{"issue":"snippet says train","fix":"she stayed","kind":"drift","where":"snippet"},{"issue":"passage puts her on the train","fix":"she is at the academy","kind":"continuity","where":"source"},{"nope":1}]\n```');
  eq(list.length, 2);
  eq(list[0].where, 'snippet'); eq(list[1].where, 'source'); eq(list[1].kind, 'continuity');
  const v = buildVerifyMessages({ playerName: 'Jovan', record: 'rec', passage: 'pass', snippet: 'snip' });
  assert(v.user.includes('<snippet>snip</snippet>') && v.user.includes('"where": "snippet"'.replace(': ', ':')) || v.user.includes('"where":"snippet"'));
  const r = buildRewriteMessages({ playerName: 'Jovan', record: 'rec', snippet: 'snip', correction: 'fix it' });
  assert(r.user.includes('<correction>fix it</correction>') && /changing only what is needed/.test(r.user));
});

test('M35-2 a line that misreads its page is rewritten; a page that contradicts the record reaches the mender', async () => {
  const storyId = 'm35-verify';
  for (const p of pages(36)) await db.messages.append(storyId, { role: p.role, text: p.text });
  await db.settings.set('memoryKeeper', true); await db.settings.set('memoryWindow', 30); await db.settings.set('memoryBatch', 6);
  const seen = [];
  const scripted = { fetch: async (url, opts) => {
    const body = JSON.parse(opts.body);
    const user = body.messages[body.messages.length - 1].content;
    let answer = '(no new state)';
    if (/<snippet>/.test(user) && /Check for exactly two things/.test(user)) answer = '[{"issue":"the line says Liara left","fix":"Liara stayed","kind":"drift","where":"snippet"},{"issue":"the page says Kim is the mother","fix":"Kris is the mother","kind":"continuity","where":"source"}]';
    else if (/<correction>/.test(user)) answer = '[Day 1] Jovan sat; Liara stayed';
    else if (/NONE, or one DETAIL/.test(user)) answer = 'NONE';
    else if (/Write ONE line recording/.test(user)) answer = '[Day 1] Jovan sat; Liara left';
    seen.push(answer.slice(0, 20));
    const h = thinkingHouse({ answer });
    return h.fetch(url, opts);
  } };
  const issues = [];
  await withHouse(scripted, () => maybeSummarize({ connection: HOUSES[0].conn, storyId, onSourceIssue: async (i) => { issues.push(i); } }));
  const mem = await loadMemory(storyId);
  eq(mem.nodes.length, 1);
  eq(mem.nodes[0].text, '[Day 1] Jovan sat; Liara stayed', 'the drifted line was rewritten');
  assert(mem.nodes[0].verified && /Liara stayed/.test(mem.nodes[0].verified.fixed));
  eq(issues.length, 1); eq(issues[0].fix, 'Kris is the mother'); eq(issues[0].span.join('-'), '0-5');
});

test('M35-3 the mend: the smallest edit to a storyteller page only; a rewrite is refused; the player’s page never', async () => {
  const list = parseMendAnswer('```json\n[{"index":1,"text":"fixed page"},{"index":"x","text":"no"},{"index":0,"text":"player"}]\n```');
  eq(list.length, 2);
  const m = buildMendMessages({ record: 'R', contradiction: 'C', pages: [{ role: 'user', text: 'u' }, { role: 'assistant', text: 'a' }], playerName: 'Jovan' });
  assert(m.user.includes('[0] (PLAYER) u') && m.user.includes('[1] (STORY) a') && /Never edit a \(PLAYER\) page/.test(m.user));
  eq(editDistanceRatio('a\nb\nc', 'a\nb\nc'), 0); eq(editDistanceRatio('a\nb', 'x\ny'), 1);
  const applied = [];
  const answer = JSON.stringify([
    { index: 0, text: 'PLAYER EDITED' },
    { index: 1, text: 'Liara looked at Kris.\nShe smiled.' },
    { index: 2, text: 'completely different page with none of the old words' },
  ]);
  const house = thinkingHouse({ answer });
  const changed = await withHouse(house, () => mendPages({
    connection: HOUSES[0].conn, storyId: 's', contradiction: 'Kim is not the mother; Kris is',
    record: 'R', playerName: 'Jovan',
    pages: [{ id: 'u', role: 'user', text: 'PLAYER' }, { id: 'a', role: 'assistant', text: 'Liara looked at Kim.\nShe smiled.' }, { id: 'b', role: 'assistant', text: 'a long page\nof many lines\nthat stays' }],
    apply: async (page, after) => { applied.push([page.id, after]); },
  }));
  eq(changed.length, 1, 'one small mend');
  eq(changed[0].id, 'a');
  eq(applied[0][1], 'Liara looked at Kris.\nShe smiled.');
  assert(!applied.some(([id]) => id === 'u'), 'the player’s page is never touched');
  assert(!applied.some(([id]) => id === 'b'), 'a rewrite is refused');
});

test('M35-4 the second reader’s findings carry a fix on a warn; the house mends on it, on by default, with a take-back', () => {
  const f = parseContinuityAnswer('{"findings":[{"words":"Kim is written as the mother; the record says Kris.","severity":"warn","fix":"Kris is the mother"},{"words":"x","severity":"note","fix":"ignored"}]}');
  eq(f.findings[0].fix, 'Kris is the mother'); assert(!f.findings[1].fix, 'a note carries no fix');
  const chat = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  assert(/async function mendAround/.test(chat) && /async function unmend/.test(chat));
  assert(/act === 'unmend'/.test(chat), 'the chip is routed');
  assert(/\(await db\.settings\.get\('continuityCheck'\)\) !== false/.test(chat), 'the second reader is on unless switched off');
  assert(/onSourceIssue: async \(\{ issue, fix, span \}\)/.test(chat), 'the keeper hands source issues to the mender');
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert(html.includes('id="mend-pages"'));
  const settings = readFileSync(new URL('../../js/ui/settings.js', import.meta.url), 'utf8');
  assert(/db\.settings\.set\('mendPages'/.test(settings));
});

test('M35-5 a person by relation exists; a real person’s relations and core come from the real record', () => {
  const w = buildWorldMessages({ state: emptyState(), userText: 'u', assistantText: 'a' });
  assert(/referred to only by[\s\S]*RELATION[\s\S]*"your mother" said to Kendall/.test(w.system), 'relation references');
  assert(/THE REAL RECORD/.test(w.system) && /Kris Jenner/.test(w.system) && /Never rename a real person/.test(w.system), 'the real record');
  const sc = buildScribeMessages({ state: emptyState(), userText: 'u', assistantText: 'a' });
  assert(/REAL RECORD/.test(sc.system), 'the scribe writes real people from the record');
});
