/* M30 — the regex shelf, and the import stops asking the storyteller to run the simulation. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { applyRules, tryRule, compileRule, loadRules, saveRules, currentRules, BUILTIN_RULES, REGEX_KEY } from '../../js/regex.js';
import { buildRequest } from '../../js/assemble/stack.js';
import { parsePreset, decompose } from '../../js/import/sillytavern.js';
import { db } from '../../js/store.js';

const V177_PAGE = [
  '[Lakeside Park — Friday, March 14, 2025 | 14:30 | 🌤 partly cloudy, light breeze | gray hoodie, dark jeans | seated on bench]',
  '',
  'Liara peeled the paper from her burger and watched Jovan not eat his. [He thought about the letter.]',
  '',
  '{PULSE}',
  '[CROWD: 12 | idle | focused on: the counter | "did you see who that is?"]',
  '[IST: Liara | guarded | wary | get him to talk | P:12 R:-4 S:20]',
  '{/PULSE}',
  '{WATCHLIST}',
  '[ACW: Aurora | the 6:10 train, reading | tense | confront him | -> | r:volatile | last: read the letter]',
  '{/WATCHLIST}',
  '',
  '<details>',
  '<summary>Plot Momentum</summary>',
  '- NPC Agenda: Aurora wants answers',
  '- Selected Path: B',
  '</details>',
].join('\n');

test('M30-1 the three shipped rules clean a V177 page down to its prose, and only its prose', () => {
  const forced = BUILTIN_RULES.map((r) => ({ ...r, enabled: true, find: r.id === 'builtin-tracker-blocks' ? r.find.replace('(PULSE|WATCHLIST)', '(PULSE|WATCHLIST|VOICES)') : r.find }));
  const out = applyRules(V177_PAGE, forced, { on: 'storyteller', mode: 'page' });
  eq(out, 'Liara peeled the paper from her burger and watched Jovan not eat his. [He thought about the letter.]');
  /* a bracket without a pipe is prose and stays */
  assert(out.includes('[He thought about the letter.]'));
});

test('M30-2 rules gate on voice and moment; a bad regex is skipped, never a crash', () => {
  const rules = [
    { id: 'a', find: 'burger', flags: 'g', replace: 'sandwich', on: 'writer', mode: 'page', enabled: true },
    { id: 'b', find: 'Liara', flags: 'g', replace: 'L.', on: 'storyteller', mode: 'display', enabled: true },
    { id: 'c', find: '(unclosed', flags: 'g', replace: '', on: 'both', mode: 'page', enabled: true },
    { id: 'd', find: 'Jovan', flags: 'g', replace: 'J.', on: 'both', mode: 'wire', enabled: false },
  ];
  const page = 'Liara peeled the burger. Jovan watched.';
  eq(applyRules(page, rules, { on: 'storyteller', mode: 'page' }), page, 'a writer rule and a display rule leave the storyteller’s page alone');
  eq(applyRules(page, rules, { on: 'writer', mode: 'page' }), 'Liara peeled the sandwich. Jovan watched.');
  eq(applyRules(page, rules, { on: 'assistant', mode: 'display' }), 'L. peeled the burger. Jovan watched.', 'roles are accepted as voices');
  eq(applyRules(page, rules, { on: 'storyteller', mode: 'wire' }), page, 'a disabled rule does nothing');
  eq(compileRule({ find: '(unclosed' }), null);
  eq(compileRule({ find: 'x', flags: 'im' }).re.flags, 'gim', '"g" is always on');
  eq(applyRules('a\n\n\n\n\nb', [{ id: 'z', find: 'zzz', flags: 'g', replace: '', on: 'both', mode: 'page', enabled: true }], { on: 'writer', mode: 'page' }), 'a\n\n\n\n\nb', 'untouched pages are not tidied');
  eq(applyRules('a\n\n\nremove me\n\n\nb', [{ id: 'z', find: 'remove me', flags: 'g', replace: '', on: 'both', mode: 'page', enabled: true }], { on: 'writer', mode: 'page' }), 'a\n\nb', 'a removal’s hole is tidied');
});

test('M30-3 try it: matches and characters, and a kind word for a pattern that won’t compile', () => {
  const r = tryRule(V177_PAGE, BUILTIN_RULES[1]);
  assert(r.ok && r.matches === 1 && r.before - r.after > 40, JSON.stringify(r));
  const bad = tryRule('x', { find: '[' });
  assert(!bad.ok && /won’t compile/.test(bad.why));
});

test('M30-4 the shelf persists; builtins are seeded, a writer’s edit to one stands, a new coat seeds a missing one', async () => {
  await db.settings.delete(REGEX_KEY);
  const first = await loadRules();
  eq(first.length, BUILTIN_RULES.length, 'seeded');
  const edited = first.map((r) => (r.id === 'builtin-plot-momentum' ? { ...r, enabled: false, flags: 'g', touched: true } : r)); /* M32: the settings UI marks a writer's edit */
  await saveRules(edited);
  await db.settings.set(REGEX_KEY, (await db.settings.get(REGEX_KEY)).filter((r) => r.id !== 'builtin-tracker-blocks'));
  const again = await loadRules();
  eq(again.find((r) => r.id === 'builtin-plot-momentum').enabled, false, 'the edit stands');
  assert(again.some((r) => r.id === 'builtin-tracker-blocks'), 'the missing builtin is seeded back');
  eq(currentRules().length, again.length, 'the live shelf follows');
  const saved = await saveRules([...again, { name: 'mine', find: 'x', replace: 'y', on: 'both', mode: 'display' }]);
  assert(saved.some((r) => r.name === 'mine' && r.id.startsWith('rule-')), 'a user rule gets an id');
});

test('M30-5 wire mode shapes only what the storyteller is sent', () => {
  const pages = [{ id: 'u', role: 'user', text: 'Jovan sits.', ts: 1 }, { id: 'a', role: 'assistant', text: 'Liara watches Jovan.', ts: 2 }];
  const r = buildRequest({
    story: {}, messages: pages, settings: {}, state: {}, modules: [], memory: '', window: { keeperOn: true },
    pageFilter: (t, role) => (role === 'assistant' ? t.replace(/Jovan/g, 'J.') : t),
  });
  const hist = r.messages.filter((m) => !/^\[story-state\]/.test(m.content));
  assert(hist.some((m) => m.content === 'Liara watches J..'), 'the storyteller’s page is shaped on the wire');
  assert(hist.some((m) => m.content === 'Jovan sits.'), 'the writer’s page is not');
  eq(pages[1].text, 'Liara watches Jovan.', 'the stored page keeps its words');
});

test('M30-6 the house applies the shelf at the three moments (source law)', () => {
  const chat = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  assert(/full = applyRules\(full, currentRules\(\), \{ on: 'storyteller', mode: 'page' \}\);/.test(chat), 'page-mode on the finished page before save');
  assert(chat.indexOf("full = applyRules(full, currentRules(), { on: 'storyteller', mode: 'page' })") < chat.indexOf("role: 'assistant',\n          text: full,"), 'before the page is saved');
  assert(/applyRules\(parsed\.clean, currentRules\(\), \{ on: 'writer', mode: 'page' \}\)/.test(chat), 'page-mode on the writer’s words');
  assert(/applyRules\(pageText\(msg\), currentRules\(\), \{ on: msg\.role, mode: 'display' \}\)/.test(chat), 'display-mode in the thread');
  assert(/pageFilter: \(text, role\) => applyRules\(text, currentRules\(\), \{ on: role, mode: 'wire' \}\)/.test(chat), 'wire-mode reaches buildRequest');
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  for (const id of ['regex-list', 'regex-form', 'regex-find', 'btn-regex-try', 'btn-regex-clean', 'btn-regex-add']) assert(html.includes(`id="${id}"`), 'the shelf has ' + id);
  const sw = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
  assert(sw.includes("'js/regex.js'"), 'the shell carries regex.js');
});

test('M30-7 the import no longer hands the storyteller the header protocol or the plot-momentum module', () => {
  const preset = { prompts: [
    { identifier: 'main', name: '⚡️Main Prompt 🤖', content: 'main words', enabled: true },
    { identifier: 't', name: '⏰ Time and Place 🌅', content: 'header words', enabled: true },
    { identifier: 'b', name: '🎯Better Narrative Drive and Tracking 🤖', content: 'plot momentum words', enabled: true },
    { identifier: 'w', name: '✍🏻Writing Guidelines (Anti-Slop) 🗑️', content: 'craft words', enabled: true },
    { identifier: 'a', name: '👁️ NPC Watchlist (ACW) 👁️', content: 'acw words', enabled: true },
  ], prompt_order: [{ character_id: 100001, order: [
    { identifier: 'main', enabled: true }, { identifier: 't', enabled: true }, { identifier: 'b', enabled: true }, { identifier: 'w', enabled: true }, { identifier: 'a', enabled: true },
  ] }] };
  const plan = decompose(parsePreset(JSON.stringify(preset)).entries);
  const craftNames = plan.craft.map((c) => c.name);
  assert(craftNames.some((n) => /Main Prompt/.test(n)) && craftNames.some((n) => /Writing Guidelines/.test(n)), 'the craft keeps the craft');
  assert(!craftNames.some((n) => /Better Narrative/.test(n)), 'plot momentum is out of the craft (M31: Time and Place is craft again — the writer keeps the header and styles it)');
  const retired = plan.retired.map((r) => r.name + ' :: ' + r.why);
  assert(retired.some((r) => /Better Narrative.*world agent/.test(r)), 'plot momentum retired to the world agent');
  assert(retired.some((r) => /ACW.*world agent/.test(r)), 'ACW says the world agent keeps it');
});

test('M30-8 the offline shell carries every shipped module and sheet (the audit law)', async () => {
  const { readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = new URL('../../', import.meta.url).pathname;
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const walk = (dir) => readdirSync(join(root, dir)).flatMap((f) => {
    const rel = dir + '/' + f;
    return statSync(join(root, rel)).isDirectory() ? walk(rel) : [rel];
  });
  const shipped = [...walk('js').filter((f) => f.endsWith('.js')), ...walk('css').filter((f) => f.endsWith('.css'))];
  const missing = shipped.filter((f) => !sw.includes(`'${f}'`));
  eq(missing.length, 0, 'missing from the shell: ' + missing.join(', '));
});

test('M30-9 a window beyond the page wakes the cut-away’s craft, and the agent remembers what it opened', async () => {
  const { selectModules, WHEN_WORDS, saveModule, listModules, removeModule } = await import('../../js/assemble/modules.js');
  const { emptyState, saveState, loadState } = await import('../../js/engine/state.js');
  const { normalizeBrief } = await import('../../js/engine/world.js');
  const { worldTurn, buildWorldMessages, WORLD_SHOWN_MAX } = await import('../../js/agents/world.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  /* the real path: a saved rule gets its predicate attached by listModules */
  await saveModule({ id: 'm30-twb', name: 'The World Beyond (TWB)', text: 'cut-away craft', whenKey: 'worldWindow' });
  const mods = (await listModules()).filter((m) => m.id === 'm30-twb');
  eq(mods.length, 1, 'the rule is on the shelf');
  const closed = emptyState();
  eq(selectModules(mods, closed).length, 0, 'no window, no craft');
  const open = emptyState();
  open.worldBrief = normalizeBrief({ pressure: [], ripe: [], twb: { who: 'Aurora', where: 'the train', changed: 'she decided' } }, 1);
  const sel = selectModules(mods, open);
  assert(sel.length === 1 && /window beyond/.test(sel[0].reason), 'the window wakes the craft');
  await removeModule('m30-twb');
  assert(/window beyond the page/.test(WHEN_WORDS.worldWindow));
  /* memory of windows */
  const storyId = 'm30-shown';
  const s0 = emptyState(); s0.sheet.playerName = 'Jovan';
  await saveState(storyId, s0);
  const answer = (n) => JSON.stringify({ mutations: [], brief: { pressure: [], ripe: [], twb: { who: 'Aurora', where: 'the train', changed: 'beat ' + n } } });
  for (let n = 0; n < WORLD_SHOWN_MAX + 2; n += 1) {
    const house = thinkingHouse({ answer: answer(n) });
    await withHouse(house, () => worldTurn({ connection: HOUSES[0].conn, storyId, userText: 'u', assistantText: 'a', stale: () => false }));
  }
  const st = await loadState(storyId);
  eq(st.worldShown.length, WORLD_SHOWN_MAX, 'the last six windows are kept');
  eq(st.worldShown[WORLD_SHOWN_MAX - 1].changed, 'beat ' + (WORLD_SHOWN_MAX + 1));
  const p = buildWorldMessages({ state: st, userText: 'u', assistantText: 'a' });
  assert(/WINDOWS BEYOND THE PAGE ALREADY OPENED/.test(p.user) && p.user.includes('beat ' + (WORLD_SHOWN_MAX + 1)), 'the agent is shown them');
  assert(/Two absent people who share a place and a stake talk to/.test(p.system), 'two absent people talking is a window worth opening');
});
