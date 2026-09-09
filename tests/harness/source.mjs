/* Source contracts for the DOM-bound fixes — the harness reads the shipped
 * code and holds it to the audit's letter. Contrast tokens are COMPUTED
 * (B19), not grepped. */
import { readFileSync } from 'node:fs';
import { test, assert, eq } from './lib.mjs';

const root = new URL('../../', import.meta.url);
const src = (p) => readFileSync(new URL(p, root), 'utf8');

test('B1: generate() body sits in try/finally; quota keeps the typed words', () => {
  const chat = src('js/ui/chat.js');
  assert(/async function generate[\s\S]*?finally \{[\s\S]*?busy = false/.test(chat), 'busy clears in a finally');
  assert(chat.includes('QUOTA_MESSAGE') || /catch \(err\)[\s\S]{0,400}restoreComposer/.test(chat), 'quota keeps the typed text');
  assert(src('js/store.js').includes('0.8'), 'the 80% shelf warning lives in store.js');
});

test('B2: no connection keeps the typed text (locked in)', () => {
  const chat = src('js/ui/chat.js');
  assert(/needs a storyteller first/.test(chat) && chat.includes('restoreComposer(text)'), 'the words come back to the composer');
});

test('B3: the scrim only shows in the narrow drawer mode', () => {
  const chat = src('js/ui/chat.js');
  assert(/matchMedia\('\(max-width: 899px\)'\)/.test(chat), 'scrim gated by width');
  assert(/scrim\.hidden = !isNarrow\(\)/.test(chat), 'desktop gets no scrim');
});

test('B4: findings reach the receipt sheet on the first render', () => {
  assert(/msg\.receipt, msg\.extraction, msg\.findings/.test(src('js/ui/chat.js')), 'msgNode passes findings');
});

test('B5: rewrites wait for the workers; worker write-backs never resurrect', () => {
  const chat = src('js/ui/chat.js');
  const regen = chat.slice(chat.indexOf('async function regenerateFrom'), chat.indexOf('/* ---------- swipes'));
  assert(regen.indexOf('pendingWork') < regen.indexOf('deleteFrom'), 'pendingWork BEFORE deleteFrom');
  assert(!/messages\.append\(story\.id, msg\)/.test(chat), 'no full-message worker re-append');
  assert(chat.includes('db.messages.update(storyId, messageId, patch)'), 'workers reink by patch');
});

test('B6/B7/B8: drawer render guard, stories-changed wiring, close-timer generations', () => {
  const drawer = src('js/ui/drawer.js');
  assert(drawer.includes('latestWins'), 'panels render latest-wins');
  assert(/closeGeneration/.test(drawer) && /closeGeneration/.test(src('js/ui/receiptview.js')), 'close timers carry generations');
  const app = src('js/app.js');
  assert(/ctx\.onStoriesChanged = /.test(app) && /drawer\.onStoriesChanged/.test(app) && /settings\.onStoriesChanged/.test(app), 'B7 wiring');
});

test('B9: empty and cut-short completions are named and offered a next step', () => {
  const chat = src('js/ui/chat.js');
  assert(chat.includes('cut short — the reply ran out of room'), 'cut-short label');
  assert(chat.includes('Ask again'), 'retry affordance');
  assert(/max_tokens\|length/.test(chat), 'both providers’ cut reasons mapped');
});

test('B10 + continue: the hidden nudge never renders, does ride once', () => {
  const chat = src('js/ui/chat.js');
  assert(chat.includes("role: 'user', text: 'continue', hidden: true"), 'hidden continue page');
  assert(chat.includes('.filter((m) => m && !m.hidden)'), 'hidden never renders');
});

test('B13: pages focusable; the menu answers to arrows and focus return', () => {
  const chat = src('js/ui/chat.js');
  assert(chat.includes('article.tabIndex = 0'), 'pages focusable');
  assert(chat.includes("e.key === 'ArrowDown'"), 'menu arrow navigation');
  assert(chat.includes('menuReturnFocus'), 'focus returns after the menu');
  assert(chat.includes('ContextMenu'), 'keyboard menu key');
});

test('B12: settings copy says exactly what the ledger switch gates', () => {
  const html = src('index.html');
  assert(/gates the extractor only/.test(html), 'the copy names the gate');
  assert(html.includes('id="worker-keeper"') && html.includes('id="worker-continuity"'), 'separate per-story switches');
  assert(html.includes('id="story-connection"'), 'per-story connection override');
  assert(html.includes('id="spend-line"'), 'spend totals row');
});

test('B18: the thread appends when pages are only added', () => {
  const chat = src('js/ui/chat.js');
  assert(chat.includes('canAppend'), 'append-only path exists');
  assert(/structural/.test(chat), 'structural rebuild path exists');
  assert(src('js/ui/drawer.js').includes('slice(-100)'), 'drift panel windowed to 100');
});

test('§2: swipes model + edit re-extraction hook', () => {
  const chat = src('js/ui/chat.js');
  assert(chat.includes('swipe-prev') && chat.includes('swipe-next'), 'swipe walker');
  assert(chat.includes('swipeRegenerate'), 'regenerate into a NEW swipe');
  const edit = chat.slice(chat.indexOf('async function beginEdit'), chat.indexOf('/* ---------- message menu'));
  assert(edit.includes('startBackgroundWork'), 'edited assistant pages go back to the extractor');
});

test('A5: every background worker call gets a 60s hard timeout', () => {
  const chat = src('js/ui/chat.js');
  assert((chat.match(/workerSignal\(\)/g) || []).length >= 3, 'extractor, keeper, reader all timed');
  assert(chat.includes('workerSignal()'), 'referee timed too');
  assert(src('js/agents/status.js').includes('60000'), 'the ceiling is 60s');
});

test('A8: one VERSION, the sw cache derives from it, harnesses shipped', () => {
  assert(/export const VERSION = 'm9-/.test(src('js/version.js')), 'single source of version');
  assert(src('sw.js').includes("import { VERSION } from './js/version.js'"), 'sw imports it');
  assert(src('sw.js').includes("'cozytavern-shell-' + VERSION"), 'cache name derives');
  assert(src('js/app.js').includes("{ type: 'module' }"), 'module worker registration');
});

test('B19: the quiet/accent text tokens meet AA (4.5:1) on their grounds', () => {
  const css = src('css/base.css');
  const grab = (block, name) => (block.match(new RegExp(name + ':\\s*(#[0-9a-f]{6})')) || [])[1];
  const dark = css.slice(css.indexOf(':root'), css.indexOf("html[data-theme='light']"));
  const light = css.slice(css.indexOf("html[data-theme='light']"));
  const lum = (hex) => {
    const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const n = [1, 3, 5].map((i) => f(parseInt(hex.slice(i, i + 2), 16) / 255));
    return 0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2];
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const [block, bg] of [[dark, '#16120f'], [dark, '#241e1a']]) {
    assert(ratio(grab(block, '--muted'), bg) >= 4.5, 'dark muted AA: ' + ratio(grab(block, '--muted'), bg).toFixed(2));
  }
  for (const bg of ['#f5efe4', '#fffdf8']) {
    for (const tok of ['--muted', '--ember', '--ok', '--danger']) {
      const r = ratio(grab(light, tok), bg);
      assert(r >= 4.5, `light ${tok} AA on ${bg}: ${r.toFixed(2)}`);
    }
  }
});

test('B20: the manifest no longer locks orientation', () => {
  const manifest = JSON.parse(src('manifest.webmanifest'));
  assert(!('orientation' in manifest), 'orientation removed');
});

test('B15: the docs carry the M9 contracts', () => {
  assert(/M9/.test(src('tests/smoke.md')), 'smoke.md updated');
  assert(/M9/.test(src('AGENTS.md')), 'AGENTS.md updated');
});
