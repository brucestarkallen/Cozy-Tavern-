/* M31 — the ledger says what it saw; the regex dresses the page instead of undressing it. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { repairJson, parseLenient } from '../../js/agents/jsonutil.js';
import { parseExtractorAnswer, extractTurn } from '../../js/agents/extractor.js';
import { parseWorldAnswer, worldTurn, worldRunWords } from '../../js/agents/world.js';
import { noteWorkerRun, loadWorkerStatus, RAW_CAP } from '../../js/agents/status.js';
import { importSillyTavernRegex, splitFindRegex, replaceHasHtml, applyRules, BUILTIN_RULES, loadRules, saveRules, REGEX_KEY } from '../../js/regex.js';
import { looksHtml, scrubStyle, ALLOWED_TAGS } from '../../js/ui/richhtml.js';
import { parsePreset, decompose } from '../../js/import/sillytavern.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { thinkingHouse, withHouse, HOUSES } from './thinkinghouse.mjs';
import { db } from '../../js/store.js';

test('M31-1 the repair pass mends what cheap models break: comments, trailing commas, raw newlines in strings', () => {
  const broken = '{ // the ledger\n "mutations": [ {"type":"place.set","name":"a booth\nat McDonald’s",}, ], /* done */ }';
  assert(parseLenient(broken), 'lenient parse succeeds');
  eq(parseLenient(broken).mutations[0].name, 'a booth at McDonald’s', 'the raw newline became a space');
  eq(parseLenient('{"a":1}').a, 1, 'strict still first');
  eq(parseLenient('not json'), null);
  const r = parseExtractorAnswer('Here you go:\n```json\n{"mutations":[{"type":"presence.enter","name":"Liara"},]}\n```');
  eq(r.mutations.length, 1, 'the extractor reads a trailing-comma answer');
  const w = parseWorldAnswer('{"mutations":[],"brief":{"pressure":["x",],"ripe":[],"twb":null,},}');
  eq(w.brief.pressure[0], 'x', 'the world agent reads one too');
  assert(/"a": 1/.test(repairJson('{"a": 1,}')) && !/,\s*}/.test(repairJson('{"a": 1,}')));
});

test('M31-2 the extractor asks ONCE more with a sharper word when the answer is unusable, or empty on a founding', async () => {
  const conn = HOUSES[0].conn;
  let calls = 0;
  const twice = { fetch: async (url, opts) => {
    calls += 1;
    const body = JSON.parse(opts.body);
    const second = /Your last answer was not a JSON object/.test(body.messages[body.messages.length - 1].content);
    const answer = second ? '{"mutations":[{"type":"presence.enter","name":"Liara"}]}' : 'Sorry, I cannot produce that.';
    const text = 'data: ' + JSON.stringify({ choices: [{ delta: { content: answer } }] }) + '\n\ndata: [DONE]\n\n';
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } });
    return { ok: true, status: 200, headers: new Headers(), body: stream, clone() { return this; }, async json() { return {}; }, async text() { return text; } };
  } };
  const r = await withHouse(twice, () => extractTurn({ connection: conn, state: emptyState(), userText: 'u', assistantText: 'Liara sat down.' }));
  eq(calls, 2, 'exactly two asks');
  eq(r.mutations.length, 1, 'the second answer is used');
  assert(typeof r.raw === 'string' && r.raw.includes('presence.enter'), 'the raw answer rides out');
  /* founding: an empty answer earns the founding nudge, once */
  calls = 0;
  const empties = { fetch: async (url, opts) => {
    calls += 1;
    const body = JSON.parse(opts.body);
    const nudged = /Write the founding/.test(body.messages[body.messages.length - 1].content);
    const answer = nudged ? '{"mutations":[{"type":"place.set","name":"McDonald’s"}]}' : '{"mutations":[]}';
    const text = 'data: ' + JSON.stringify({ choices: [{ delta: { content: answer } }] }) + '\n\ndata: [DONE]\n\n';
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } });
    return { ok: true, status: 200, headers: new Headers(), body: stream, clone() { return this; }, async json() { return {}; }, async text() { return text; } };
  } };
  const f = await withHouse(empties, () => extractTurn({ connection: conn, state: emptyState(), userText: 'u', assistantText: 'Liara sat down.' }));
  eq(calls, 2, 'the founding nudge fired once');
  eq(f.mutations[0].type, 'place.set');
  /* settled ledger: an empty answer is accepted at once */
  calls = 0;
  const settled = emptyState(); settled.place = { name: 'x' }; settled.present = [{ name: 'Liara' }];
  const e = await withHouse(empties, () => extractTurn({ connection: conn, state: settled, userText: 'u', assistantText: 'a' }));
  eq(calls, 1, 'no nudge on a settled ledger');
  eq(e.note, 'empty');
});

test('M31-3 the world agent says "could not be used" out loud, keeps what it said, and never retries five times', async () => {
  const storyId = 'm31-world';
  await saveState(storyId, emptyState());
  let calls = 0;
  const garbage = { fetch: async () => {
    calls += 1;
    const text = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'I would rather not.' } }] }) + '\n\ndata: [DONE]\n\n';
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } });
    return { ok: true, status: 200, headers: new Headers(), body: stream, clone() { return this; }, async json() { return {}; }, async text() { return text; } };
  } };
  const r = await withHouse(garbage, () => worldTurn({ connection: HOUSES[0].conn, storyId, userText: 'u', assistantText: 'a', stale: () => false }));
  eq(calls, 2, 'one sharper second ask, then it stops');
  eq(r.note, 'unusable');
  eq(r.raw, 'I would rather not.');
  eq(worldRunWords(r), 'its answer could not be used');
  const st = await loadState(storyId);
  eq(st.worldBrief, null, 'nothing written on a garbled read');
  const chat = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  assert(!/throw new Error\('its answer could not be used'\)/.test(chat), 'a garbled answer no longer throws into the queue’s five retries');
});

test('M31-4 the workers’ shelf keeps detail AND what the worker said, capped', async () => {
  await noteWorkerRun('m31-shelf', 'extractor', { ok: true, detail: 'wrote 3 changes', raw: 'x'.repeat(RAW_CAP + 500) });
  await noteWorkerRun('m31-shelf', 'world', { ok: false, why: 'stumbled', raw: '{"half":' });
  const shelf = await loadWorkerStatus('m31-shelf');
  eq(shelf.extractor.detail, 'wrote 3 changes', 'detail survives the round trip (it used to be dropped)');
  eq(shelf.extractor.raw.length, RAW_CAP, 'capped');
  eq(shelf.world.raw, '{"half":');
  const drawer = readFileSync(new URL('../../js/ui/drawer.js', import.meta.url), 'utf8');
  assert(/what it said/.test(drawer), 'the drawer folds it open');
});

test('M31-5 the writer’s SillyTavern regex file lands on the shelf as display rules that dress the page', () => {
  const file = readFileSync('/tmp/st-regex.json', 'utf8');
  const { rules, skipped } = importSillyTavernRegex(file);
  eq(skipped.length, 0);
  assert(rules.length >= 20, rules.length + ' rules');
  assert(rules.every((r) => r.on === 'storyteller' && r.mode === 'display'), 'placement 2 + markdownOnly → the storyteller’s pages, thread only');
  assert(rules.every((r) => replaceHasHtml(r.replace)), 'they are 🎨 rules');
  const header = rules.find((r) => /5-field: Location — Date/.test(r.name));
  assert(header, 'the 5-field header rule is there');
  eq(header.flags, 'gm');
  const page = '[Lakeside Park — Friday, March 14, 2025 | 14:30 | 🌤 partly cloudy | gray hoodie | seated on bench]\n\nLiara watched him not eat.';
  const shown = applyRules(page, rules, { on: 'assistant', mode: 'display' });
  assert(/<div style=/.test(shown) && /📍 Lakeside Park/.test(shown) && /🧭 seated on bench/.test(shown), 'the header is dressed: ' + shown.slice(0, 120));
  assert(shown.includes('Liara watched him not eat.'), 'the prose is untouched');
  eq(applyRules(page, rules, { on: 'assistant', mode: 'page' }), page, 'the stored page keeps its words');
  eq(splitFindRegex('/a|b/gi').flags, 'gi');
  eq(splitFindRegex('plain').find, 'plain');
  /* the mapping laws */
  const both = importSillyTavernRegex(JSON.stringify([{ scriptName: 'x', findRegex: '/a/g', replaceString: 'b', placement: [1, 2], markdownOnly: true, promptOnly: true }]));
  eq(both.rules.length, 2, 'markdownOnly + promptOnly → a display rule and a wire rule');
  eq(both.rules[0].on, 'both');
  const plain = importSillyTavernRegex(JSON.stringify([{ scriptName: 'x', findRegex: '/a/g', replaceString: 'b', placement: [2] }]));
  eq(plain.rules[0].mode, 'page', 'neither flag → the page itself, as SillyTavern does');
  const off = importSillyTavernRegex(JSON.stringify([{ scriptName: 'x', findRegex: '/a/g', replaceString: 'b', placement: [5] }]));
  eq(off.rules.length, 0); eq(off.skipped.length, 1);
});

test('M31-6 the thread’s HTML allowlist: styles that reach out are dropped; scripts are never tags', () => {
  assert(looksHtml('<div style="x">y</div>'));
  assert(!looksHtml('he said 3 < 4 and 5 > 2'), 'a lone bracket is prose');
  assert(!looksHtml('<script>alert(1)</script>'), 'a script tag is not a reason to render HTML');
  assert(!ALLOWED_TAGS.has('script') && !ALLOWED_TAGS.has('iframe') && !ALLOWED_TAGS.has('img') && !ALLOWED_TAGS.has('a'));
  eq(scrubStyle('color:#c9a24e;font-size:0.78em;'), 'color:#c9a24e;font-size:0.78em;');
  eq(scrubStyle('background:url(http://x/y.png)'), '', 'url() reaches out');
  eq(scrubStyle('width:expression(alert(1))'), '');
  eq(scrubStyle('behavior: url(x.htc)'), '');
  const chat = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  assert(/renderHtmlProse\(shown\)/.test(chat), 'a dressed page renders through the allowlist');
  assert(/parseScene\(pageText\(msg\)\)\[0\]/.test(chat), 'the masthead decision reads the raw page');
});

test('M31-7 the defaults: the header is kept (styled by the writer), state blocks go, Voices stays; Time and Place is craft again', async () => {
  const header = BUILTIN_RULES.find((r) => r.id === 'builtin-preset-header');
  eq(header.enabled, false, 'header removal ships OFF');
  const state = BUILTIN_RULES.find((r) => r.id === 'builtin-tracker-blocks');
  const page = 'prose\n{PULSE}\n[IST: x]\n{/PULSE}\n{VOICES}\n[VOICE: a | b | c]\n{/VOICES}\n{WATCHLIST}\n[ACW: y]\n{/WATCHLIST}\nmore';
  const out = applyRules(page, [state], { on: 'storyteller', mode: 'page' });
  assert(!/PULSE|WATCHLIST/.test(out) && /VOICES/.test(out) && /VOICE: a/.test(out), out);
  /* an existing shelf where the header rule was on (m30) is left as the writer had it — only a missing builtin is seeded */
  await db.settings.set(REGEX_KEY, [{ id: 'builtin-preset-header', name: 'x', find: 'y', flags: 'g', replace: '', on: 'storyteller', mode: 'page', enabled: true, builtin: true }]);
  const rules = await loadRules();
  eq(rules.find((r) => r.id === 'builtin-preset-header').enabled, true, 'the writer’s own switch stands');
  eq(rules.length, BUILTIN_RULES.length, 'the other builtins were seeded');
  const preset = { prompts: [
    { identifier: 't', name: '⏰ Time and Place 🌅', content: 'header words', enabled: true },
    { identifier: 'main', name: '⚡️Main Prompt 🤖', content: 'main', enabled: true },
  ], prompt_order: [{ character_id: 100001, order: [{ identifier: 't', enabled: true }, { identifier: 'main', enabled: true }] }] };
  const plan = decompose(parsePreset(JSON.stringify(preset)).entries);
  assert(plan.craft.some((c) => /Time and Place/.test(c.name)), 'Time and Place is craft — the storyteller writes the header the writer styles');
});
