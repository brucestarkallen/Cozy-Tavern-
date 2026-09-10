/* M34 — the keeper keeps a record (the Summaryception principle); the keyboard stays down; the 🎨 pack. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { readFileSync } from 'node:fs';
import {
  nextBatch, overflowEnd, parseMemoryAnswer, renderMemory, recordFor, buildMemoryMessages, buildFoldMessages,
  maybeSummarize, loadMemory, saveMemory, cleanBatch, DEFAULT_BATCH, NOTES_PER_LAYER, SLOT_BUDGET, RECORD_HEADER, SHRINK_FLOOR,
} from '../../js/agents/memory.js';
import { applyRules, BUILTIN_RULES } from '../../js/regex.js';
import { STYLE_PACK } from '../../js/regex-styles.js';
import { buildRequest } from '../../js/assemble/stack.js';
import { db } from '../../js/store.js';
import { thinkingHouse, withHouse, HOUSES } from './thinkinghouse.mjs';

const pages = (n, prefix = 'page') => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, role: i % 2 ? 'assistant' : 'user', text: prefix + ' ' + i, ts: i }));

test('M34-1 the record keeps step: a batch is due as soon as it has left the window — no hysteresis', () => {
  eq(nextBatch(36, 30, 0, 6).join('-'), '0-6', '36 pages, window 30: the first six are due');
  eq(nextBatch(35, 30, 0, 6), null, 'five beyond the window is not yet a batch');
  eq(nextBatch(42, 30, 6, 6).join('-'), '6-12', 'the next batch starts where coverage ends');
  eq(overflowEnd(36, 30, 0), 6);
  eq(cleanBatch(6), 6); eq(cleanBatch(1), 2); eq(cleanBatch(99), 20); eq(cleanBatch('x'), DEFAULT_BATCH);
});

test('M34-2 one line, read whole: fences off, breaks folded, "(no new state)" kept as itself', () => {
  eq(parseMemoryAnswer('```\n[Sept 1, 08:24] Jovan ordered;\nLiara refused\n```'), '[Sept 1, 08:24] Jovan ordered; Liara refused');
  eq(parseMemoryAnswer('(no new state)'), '(no new state)');
  eq(parseMemoryAnswer('No new state.'), '(no new state)');
  eq(parseMemoryAnswer('ok'), '', 'too short to be a line');
});

test('M34-3 the prompt is Summaryception’s: the player’s name, the record as prior context, the passage with authors', () => {
  const p = buildMemoryMessages(pages(4), { playerName: 'Jovan', record: '[Day 1] Jovan arrived; Liara waited' });
  for (const k of ['ABSOLUTE PRONOUN BAN', 'HARD LIMIT: 15 phrases', '(no new state)', '[Correction]', 'STATS:', 'Information asymmetries']) assert(p.user.includes(k), 'the law: ' + k);
  assert(p.user.includes("<player_name>Jovan</player_name>") && p.user.includes("1. Jovan's decisions"), 'the name is substituted everywhere');
  assert(p.user.includes('<prior_context>[Day 1] Jovan arrived; Liara waited</prior_context>'));
  assert(p.user.includes('PLAYER (Jovan): page 0') && p.user.includes('STORY: page 1'), 'the passage carries its authors');
  assert(/precise narrative-state tracker/.test(p.system));
  const f = buildFoldMessages([{ text: 'a; b' }, { text: 'c; d' }], { playerName: 'Jovan', record: 'above', strict: true });
  assert(f.user.includes('<passage>a; b\n\nc; d</passage>') && f.user.includes('being merged into ONE line') && f.user.includes('dropped too much'));
});

test('M34-4 the record rides whole, oldest to newest, under its header; over budget the OLDEST go first', () => {
  const mem = { window: 30, nodes: [
    { id: 'b', span: [6, 11], text: 'second', level: 1, at: 2 },
    { id: 'a', span: [0, 5], text: 'first', level: 1, at: 1, detail: 'forty crowns' },
    { id: 'e', span: [12, 17], text: '', level: 1, at: 3, empty: true },
    { id: 'c', span: [18, 23], text: 'third', level: 1, at: 4 },
  ] };
  const out = renderMemory(mem);
  assert(out.startsWith(RECORD_HEADER + '\n- first\n  • Detail worth keeping: forty crowns\n- second\n- third'), out);
  assert(!/\n- \n/.test(out), 'an empty node says nothing');
  eq(recordFor(mem), 'first\nsecond\nthird');
  const big = { window: 30, nodes: Array.from({ length: 200 }, (_, i) => ({ id: 'n' + i, span: [i * 6, i * 6 + 5], text: 'line ' + i + ' ' + 'x'.repeat(220), level: 1, at: i })) };
  const trimmed = renderMemory(big);
  assert(trimmed.length <= SLOT_BUDGET + 200 && /earlier lines rest beyond the budget/.test(trimmed), 'trimmed with a word');
  assert(trimmed.includes('line 199 '), 'the newest line always rides');
  assert(!trimmed.includes('- line 0 '), 'the oldest went first');
});

test('M34-5 end to end: lines are written at the catch-up pace, "(no new state)" covers, and a layer past its size promotes with the shrink guard', async () => {
  const storyId = 'm34-e2e';
  for (const p of pages(48)) await db.messages.append(storyId, { role: p.role, text: p.text });
  await db.settings.set('memoryKeeper', true);
  await db.settings.set('memoryWindow', 30);
  await db.settings.set('memoryBatch', 6);
  let n = 0;
  const house = thinkingHouse({ answer: 'x' });
  const scripted = { ...house, fetch: async (url, opts) => {
    n += 1;
    const body = JSON.parse(opts.body);
    const user = body.messages[body.messages.length - 1].content;
    let answer;
    if (/NONE, or one DETAIL/.test(user)) answer = n % 3 === 0 ? 'DETAIL: the ferry cost forty crowns' : 'NONE';
    else if (/<passage>PLAYER \(the player\): page 6/.test(user)) answer = '(no new state)';
    else answer = '[Day 1] the player did a thing; Liara answered';
    return house.fetch(url, { ...opts, body: JSON.stringify({ ...body, __answer: answer }) }).then((res) => res);
  } };
  /* the thinking house answers with its configured text; give it ours per call */
  const origFetch = house.fetch;
  scripted.fetch = async (url, opts) => {
    n += 1;
    const body = JSON.parse(opts.body);
    const user = body.messages[body.messages.length - 1].content;
    let answer;
    if (/NONE, or one DETAIL/.test(user)) answer = 'NONE';
    else if (/PLAYER \(the player\): page 6\b/.test(user)) answer = '(no new state)';
    else answer = '[Day 1] the player did a thing; Liara answered';
    const h = thinkingHouse({ answer });
    return h.fetch(url, opts);
  };
  const conn = HOUSES[0].conn;
  const r1 = await withHouse(scripted, () => maybeSummarize({ connection: conn, storyId }));
  assert(r1, 'something was written');
  const mem = await loadMemory(storyId);
  eq(mem.nodes.length, 3, 'three lines at the catch-up pace (18 pages were due)');
  eq(mem.nodes[0].span.join('-'), '0-5');
  assert(mem.nodes[1].empty === true && mem.nodes[1].text === '', 'batch 6-11 answered (no new state): covered, no line');
  eq(mem.nodes[2].span.join('-'), '12-17');
  /* the storyteller sees the record whole, and the covered pages leave the window */
  const history = await db.messages.list(storyId);
  const r = buildRequest({ story: {}, messages: history, settings: {}, state: {}, modules: [], memory: renderMemory(mem), window: { keeperOn: true, nodes: mem.nodes, window: 30 } });
  const inj = r.messages[0].content;
  assert(inj.includes(RECORD_HEADER) && inj.includes('- [Day 1] the player did a thing'), 'the record rides');
  /* promotion: a layer past NOTES_PER_LAYER merges its oldest two; a thin merge is asked again */
  const many = { window: 30, nodes: Array.from({ length: NOTES_PER_LAYER + 1 }, (_, i) => ({ id: 'n' + i, span: [i * 6, i * 6 + 5], text: 'line ' + i + ': ' + 'fact '.repeat(20), level: 1, at: i })) };
  await saveMemory(storyId, many);
  for (const p of pages(700, 'later')) await db.messages.append(storyId, { role: p.role, text: p.text });
  let asks = 0;
  const merger = { fetch: async (url, opts) => {
    const body = JSON.parse(opts.body);
    const user = body.messages[body.messages.length - 1].content;
    let answer = '(no new state)';
    if (/being merged into ONE line/.test(user)) { asks += 1; answer = /dropped too much/.test(user) ? 'line 0 and line 1 merged: ' + 'fact '.repeat(30) : 'a thin merge line'; }
    else if (/NONE, or one DETAIL/.test(user)) answer = 'NONE';
    const h = thinkingHouse({ answer });
    return h.fetch(url, opts);
  } };
  await withHouse(merger, () => maybeSummarize({ connection: conn, storyId }));
  const after = await loadMemory(storyId);
  const l2 = after.nodes.filter((x) => x.level === 2);
  eq(l2.length, 1, 'one merged line on layer 2');
  eq(asks, 2, 'the shrink guard asked once more');
  assert(l2[0].text.startsWith('line 0 and line 1 merged'), 'the stricter merge was taken');
  eq(l2[0].span.join('-'), '0-11', 'it covers both sources');
  eq(after.nodes.filter((x) => x.level === 1 && x.text.startsWith('line 0:')).length, 0, 'the sources left');
  assert(SHRINK_FLOOR > 0 && SHRINK_FLOOR < 1);
});

test('M34-6 the keyboard stays down on a phone: the house never focuses the composer after an answer or a new tale on touch', () => {
  const chat = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  assert(/function isTouch\(\)/.test(chat) && /pointer: coarse/.test(chat), 'touch is recognized');
  const fin = chat.slice(chat.indexOf('els.btnStop.hidden = true;'), chat.indexOf('els.btnStop.hidden = true;') + 300);
  assert(/focusComposerIfDesktop\(\)/.test(fin) && !/els\.input\.focus\(\)/.test(fin), 'the finally block asks, never grabs');
  const landing = chat.slice(chat.indexOf('lastRender.ids.push(saved.id);'), chat.indexOf('lastRender.ids.push(saved.id);') + 300);
  assert(/if \(nearBottom\(\)\) scrollToBottom\(\)/.test(landing), 'the landing scroll obeys the scroll law');
});

test('M34-7 the 🎨 pack ships on: the header is a card, the cut-away boxes itself, prose after it survives', () => {
  assert(STYLE_PACK.length >= 20 && STYLE_PACK.every((r) => r.builtin && r.pack === 'styles' && r.mode === 'display'));
  assert(!STYLE_PACK.some((r) => /TWB Close/.test(r.name)), 'the dependent close rule is gone');
  const page = '[Lakeside Park — Friday, March 14, 2025 | 14:30 | 🌤 partly cloudy | gray hoodie | seated on bench]\n\nLiara watched.\n\n*** The World Beyond ***\n[Her apartment — Friday, 14:35]\nAurora decided.\n\nBack at the booth.';
  const out = applyRules(page, BUILTIN_RULES, { on: 'storyteller', mode: 'display' });
  assert(/📍 Lakeside Park/.test(out) && /🧭 seated on bench/.test(out), 'the header card');
  assert(/<details[^>]*>[\s\S]*Aurora decided\.<\/div><\/details>\n\nBack at the booth\./.test(out), 'the cut-away is boxed and closed before the prose');
  eq(applyRules(page, BUILTIN_RULES, { on: 'storyteller', mode: 'page' }), page.replace(/\n{3,}/g, '\n\n'), 'the page itself keeps its words (no page-mode builtin matches)');
  const sw = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
  assert(sw.includes("'js/regex-styles.js'"));
});
