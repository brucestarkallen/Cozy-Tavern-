/* A1 window law, A4 cache breakpoint, hidden pages, directives, lore names. */
import { test, assert, eq } from './lib.mjs';
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
  const r = buildRequest({ story: {}, messages: pages(40), settings: {}, state: {}, modules: [], memory: '', window: { keeperOn: false, budgetTokens: 400 } });
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
  assert(r.messages.some((m) => m.content === 'Go on.'), 'the nudge fires from the hidden page');
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

test('M9: a house command rides just before the note, named on the receipt', () => {
  const r = buildRequest({ story: {}, messages: pages(3), settings: {}, state: {}, modules: [], memory: '', directive: 'Write a single beat only.', window: { keeperOn: true } });
  const idx = r.messages.findIndex((m) => m.content === 'Write a single beat only.');
  assert(idx === r.messages.length - 2, 'directive sits before the note');
  assert(slot(r, 'The house heard'), 'receipt names the command');
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
  assert(wh.length <= 1600, 'slot 4 budget kept');
});

test('windowPlan pure: keeper vs budget', () => {
  const w = windowPlan({ pages: pages(50), memory: { window: DEFAULT_WINDOW } });
  eq(w.window.length, 30); eq(w.resting, 20);
  const b = windowPlan({ pages: pages(50), memory: null, budgetTokens: 60, prefixTokens: 0 });
  assert(b.window.length < 50 && b.resting === 50 - b.window.length, 'budget cutoff');
});
