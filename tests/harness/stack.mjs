/* A1 window law, A4 cache breakpoint, hidden pages, directives, lore names. */
import { test, assert, eq } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { buildRequest, windowPlan, wireable, pageText, DEFAULT_WINDOW } from '../../js/assemble/stack.js';

function pages(n) {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push({ role: i % 2 ? 'assistant' : 'user', text: 'page ' + i + ' lorem ipsum dolor sit amet' });
  return out;
}
const slot = (r, name) => r.receipt.slots.find((s) => s.name === name);

test('A1: keeper on — slot 8 carries ONLY the last 30 pages', () => {
  const r = buildRequest({ story: {}, messages: pages(45), settings: {}, state: {}, modules: [], memory: '', window: { keeperOn: true } });
  const hist = r.messages.filter((m) => String(m.content).startsWith('page '));
  eq(hist.length, 30, 'window is 30');
  assert(hist[0].content.startsWith('page 15'), 'window starts at page 15');
  assert(/last 30 of 45/.test(slot(r, 'The story so far').source), 'receipt reports counts');
});

test('A1: window boundary holds under the size; custom window honored', () => {
  const r = buildRequest({ story: {}, messages: pages(10), settings: {}, state: {}, modules: [], memory: '', window: { keeperOn: true, window: 4 } });
  const hist = r.messages.filter((m) => String(m.content).startsWith('page '));
  eq(hist.length, 4, 'custom window of 4');
  assert(slot(r, 'The story so far').source.startsWith('the last 4 of 10'), 'receipt names cutoff');
});

test('A1: keeper off — token-budgeted cutoff with an honest receipt line', () => {
  /* M379: the room is sized from the house's own words (they grew by the shortcuts), plus a little for pages — so the law
   * tested is the honest cutoff line, never a guess at how big the standing words are */
  const whole = buildRequest({ story: {}, messages: pages(40), settings: {}, state: {}, modules: [], memory: '', window: { keeperOn: false, budgetTokens: 10000000 } });
  const fixed = whole.receipt.slots.filter((x) => x.name !== 'The story so far').reduce((n, x) => n + x.tokens, 0);
  const r = buildRequest({ story: {}, messages: pages(40), settings: {}, state: {}, modules: [], memory: '', window: { keeperOn: false, budgetTokens: fixed + 120 } });
  const s = slot(r, 'The story so far');
  assert(/pages carried word for word, the rest rests/.test(s.source), 'honest cutoff line: ' + s.source);
  const carried = parseInt(s.source, 10);
  assert(carried > 0 && carried < 40, 'a budgeted subset rides');
});

test('A1: hidden pages never join the wire but still fire the nudge', () => {
  const msgs = pages(6);
  msgs.push({ role: 'user', text: 'continue', hidden: true, id: 'h1' });
  const r = buildRequest({ story: {}, messages: msgs, settings: {}, state: {}, modules: [], memory: '', window: { keeperOn: true } });
  assert(!r.messages.some((m) => m.content === 'continue'), 'hidden page excluded from history');
  assert(r.messages.some((m) => /(^|\n\n)Go on\.(\n\n|$)/.test(m.content)), 'the nudge fires from the hidden page'); /* M321: inside the one closing message */
  assert(wireable(msgs).length === 6, 'wireable strips hidden');
});

test('A1: pageText reads the shown swipe', () => {
  eq(pageText({ text: 'old', swipes: [{ text: 'a' }, { text: 'b' }], swipeIdx: 1 }), 'b', 'shown swipe text');
  eq(pageText({ text: 'plain' }), 'plain', 'plain text');
});

test('A4: cache breakpoint sits at the END of slot 2, slots 3-4 non-cached', () => {
  const story = { brief: 'a brief' };
  const modules = [{ mod: { id: 'core-craft', text: 'the craft text' }, reason: 'the rulebook' }];
  const r = buildRequest({ story, messages: pages(2), settings: { frameText: 'frame words' }, state: { present: [{ name: 'Mira' }] }, modules, memory: '', cast: [], window: { keeperOn: true } });
  eq(r.systemBlocks.length, 4, 'four system blocks');
  assert(r.systemBlocks[0].cache === true && r.systemBlocks[1].cache === true, 'slots 1-2 cached');
  assert(r.systemBlocks[2].cache === false && r.systemBlocks[3].cache === false, 'slots 3-4 NOT cached');
});

test('M9 (as M379 changed it): a house command’s law is never sent as a second message on its turn — the shortcuts are said once, in the standing words, and his typed words are the last message', () => {
  const msgs = [...pages(3), { id: 'cmd', role: 'user', text: '#p', typed: '#p' }];
  const r = buildRequest({ story: {}, messages: msgs, settings: {}, state: {}, modules: [], memory: '', directive: 'Write a single beat only.', window: { keeperOn: true } });
  assert(!JSON.stringify(r.messages).includes('Write a single beat only.'), 'the law is not on the wire');
  eq(r.messages[r.messages.length - 1].content, '#p', 'his own typed words are the last message');
  assert(/SHORTCUTS\. When the writer/.test(r.systemBlocks[1].text) && /#p — exactly ONE beat/.test(r.systemBlocks[1].text), 'the shortcut is explained in the standing words');
  assert(!slot(r, 'The house heard'), 'and the receipt names no second message');
});

test('M9: lore receipt names which entries fired', () => {
  const r = buildRequest({ story: {}, messages: pages(2), settings: {}, state: {}, modules: [], memory: '', lore: 'Dragon text', loreFired: [{ keys: ['dragon'] }], window: { keeperOn: true } });
  assert(/dragon/.test(slot(r, 'The lore shelf').reason), 'fired entries named');
});

test('M9: card personality + scenario join slot 4 under budget', () => {
  const cast = [{ name: 'Mira', description: 'a cartographer', personality: 'wry and watchful', scenario: 'a drowned coast' }];
  const r = buildRequest({ story: {}, messages: pages(2), settings: {}, state: { present: [{ name: 'Mira' }] }, modules: [], memory: '', cast, window: { keeperOn: true } });
  const wh = r.systemBlocks[3].text;
  assert(wh.includes('wry and watchful') && wh.includes('a drowned coast'), 'personality + scenario ride');
  assert(wh.length <= 9000, 'slot 4 budget kept (M29: 9000)');
});

test('windowPlan pure: keeper vs budget', () => {
  const w = windowPlan({ pages: pages(50), memory: { window: DEFAULT_WINDOW } });
  eq(w.window.length, 30); eq(w.resting, 20);
  const b = windowPlan({ pages: pages(50), memory: null, budgetTokens: 60, prefixTokens: 0 });
  assert(b.window.length < 50 && b.resting === 50 - b.window.length, 'budget cutoff');
});

/* M162: THE COVERAGE LAW WAS DEAD ON THE WIRE. windowPlan applies it only
 * when handed the nodes, and the window chat.js built never carried them —
 * so a page that rolled past the verbatim window before any record line
 * covered it was gone from the storyteller's sight entirely: not in the
 * pages, not in the record. */
test('M162: the send path hands the record’s nodes to the window, and cuts the record by the plan', () => {
  const chat = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  const build = chat.slice(chat.indexOf('const windowInfo = {'), chat.indexOf('const invitedCast'));
  assert(/nodes: mem && Array\.isArray\(mem\.nodes\) \? mem\.nodes : undefined,/.test(build), 'the record’s nodes ride into the window plan');
  assert(/windowPlan\(\{ pages: visiblePages\(history\), memory: \{ window: memWindow, nodes: windowInfo\.nodes \} \}\)\.resting/.test(build), 'the record’s cut is taken from the plan that will actually be sent');
  assert(chat.indexOf('const verbatimStart') > chat.indexOf('const windowInfo = {'), 'the cut is measured after the plan, never before it');
});

test('M162: a page no line covers never falls out of the window', () => {
  const pages = [];
  for (let i = 0; i < 40; i += 1) pages.push({ role: i % 2 ? 'assistant' : 'user', content: 'page ' + i });
  /* the keeper folded pages 0..9 and then stumbled: 10..29 are uncovered */
  const nodes = [{ id: 'n1', span: [0, 9], text: 'the early pages', level: 1 }];
  const plan = windowPlan({ pages, memory: { window: 10, nodes } });
  eq(plan.resting, 10, 'the window reaches back to the first uncovered page');
  eq(plan.carried, 30, 'every uncovered page rides word for word');
  assert(plan.extended === 20, 'and the receipt knows how far past the usual window it went');
  /* with the nodes withheld — the old behaviour — twenty pages simply vanish */
  const blind = windowPlan({ pages, memory: { window: 10 } });
  eq(blind.resting, 30, 'without the nodes the plan drops them (the bug M162 fixes)');
});

/* M162: with the keeper off and a small context, the prefix could eat the
 * whole room and the storyteller was sent no story at all. */
test('M162: the budget window is never empty — the last exchange always rides', () => {
  const pages = [];
  for (let i = 0; i < 12; i += 1) pages.push({ role: i % 2 ? 'assistant' : 'user', content: 'a long page of prose. '.repeat(80) });
  const plan = windowPlan({ pages, memory: null, budgetTokens: 4000, prefixTokens: 9000 });
  assert(plan.carried >= 2, 'the last exchange rides even when the arithmetic says nothing fits (carried ' + plan.carried + ')');
  eq(plan.squeezed, true, 'and the squeeze is marked, so the receipt can say so');
  const roomy = windowPlan({ pages, memory: null, budgetTokens: 200000, prefixTokens: 1000 });
  eq(roomy.carried, 12, 'a roomy connection still carries everything');
  assert(!roomy.squeezed, 'and is never marked squeezed');
});

/* M162: the coverage law had no ceiling. Switched on as M12 wrote it, a
 * keeper whose worker connection is down would put EVERY unfolded page on
 * the wire — on a six-hundred-page tale, the whole story, every turn. */
test('M162: the coverage law reaches back only as far as the room allows', () => {
  const pages = [];
  for (let i = 0; i < 300; i += 1) pages.push({ role: i % 2 ? 'assistant' : 'user', content: 'a page of prose. '.repeat(60) });
  /* the keeper folded the first ten and then went silent for the rest */
  const nodes = [{ id: 'n1', span: [0, 9], text: 'the early pages', level: 1 }];

  const roomy = windowPlan({ pages, memory: { window: 30, nodes }, budgetTokens: 2000000, prefixTokens: 0 });
  eq(roomy.resting, 10, 'with room to spare the law holds whole — nothing uncovered falls');
  eq(roomy.uncovered, 0, 'and nothing is left without a line');

  const tight = windowPlan({ pages, memory: { window: 30, nodes }, budgetTokens: 20000, prefixTokens: 4000 });
  assert(tight.carried >= 30, 'the keeper’s own window always rides (' + tight.carried + ')');
  assert(tight.carried < 290, 'but a stalled keeper never puts the whole tale on the wire (' + tight.carried + ')');
  assert(tight.uncovered > 0, 'and the pages still without a line are counted, not hidden');
  eq(tight.resting, 10 + tight.uncovered, 'the arithmetic closes');

  /* the receipt says so in plain words */
  const r = buildRequest({
    story: {}, messages: pages.map((p, i) => ({ id: 'm' + i, role: p.role, text: p.content })),
    settings: {}, state: {}, modules: [], memory: 'the record',
    window: { keeperOn: true, window: 30, nodes, budgetTokens: 20000 },
  });
  const slot8 = r.receipt.slots.find((s) => s.name === 'The story so far');
  assert(/no line yet and would not fit the room/.test(slot8.source), 'the receipt names them: ' + slot8.source);
});
