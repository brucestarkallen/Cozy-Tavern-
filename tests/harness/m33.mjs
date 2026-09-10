/* M33 — the laws behind the field reports: a button that renders answers; a button wears the
 * house's clothes; pages are ordered by the store, never by their ids; no story without a
 * storyteller. The dom walk (tests/dom/run.mjs) proves them live; these keep the source honest. */
import { test, assert, eq } from './lib.mjs';
import { readFileSync, readdirSync } from 'node:fs';

const src = (rel) => readFileSync(new URL('../../' + rel, import.meta.url), 'utf8');

test('M33-1 every act the row renders is routed by the thread’s click listener', () => {
  const chat = src('js/ui/chat.js');
  const rowStart = chat.indexOf('function actionsNode(');
  const row = chat.slice(rowStart, chat.indexOf('\n  }\n', rowStart));
  const acts = new Set([...row.matchAll(/'(copy|edit|try again|swipe|branch|go on|delete)'/g)].map((m) => m[1]));
  assert(acts.size >= 6, 'the row names its acts: ' + [...acts].join(', '));
  let at = -1;
  for (let i = chat.indexOf("els.thread.addEventListener('click'"); i !== -1; i = chat.indexOf("els.thread.addEventListener('click'", i + 1)) {
    if (chat.slice(i, i + 400).includes('.msg-act')) { at = i; break; }
  }
  assert(at !== -1, 'the act-routing listener exists');
  const handler = chat.slice(at, chat.indexOf('\n  });', at));
  const unrouted = [...acts].filter((a) => !handler.includes("act === '" + a + "'"));
  eq(unrouted.length, 0, 'unrouted: ' + unrouted.join(', '));
  /* the long-press menu routes the same words */
  const menuStart = chat.indexOf("els.menu.addEventListener('click'");
  const menu = chat.slice(menuStart, chat.indexOf('\n  });', menuStart));
  for (const a of ['copy', 'regenerate', 'try again', 'edit', 'delete', 'go on']) assert(menu.includes("'" + a + "'"), 'menu routes ' + a);
});

test('M33-2 every button the house creates wears a class (never the browser’s own white)', () => {
  const bare = [];
  for (const f of readdirSync(new URL('../../js/ui/', import.meta.url)).filter((x) => x.endsWith('.js'))) {
    const lines = src('js/ui/' + f).split('\n');
    lines.forEach((l, i) => {
      const m = l.match(/(?:const|let)\s+(\w+)\s*=\s*document\.createElement\('button'\)/);
      if (!m) return;
      const win = lines.slice(i + 1, i + 12).join('\n');
      if (!new RegExp(m[1] + '\\.className\\s*=|' + m[1] + '\\.classList\\.add').test(win)) bare.push(f + ':' + (i + 1) + ' ' + m[1]);
    });
  }
  eq(bare.length, 0, 'bare buttons: ' + bare.join(', '));
});

test('M33-3 pages are found by the store’s order, never by comparing their ids', () => {
  const all = ['js/ui/chat.js', 'js/ui/drawer.js', 'js/ui/settings.js', 'js/ui/housekeeper.js', 'js/agents/housekeeper.js'].map(src).join('\n');
  const code = all.split('\n').filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l)).join('\n');
  eq((code.match(/\.id\s*[<>]=?\s*[A-Za-z_]/g) || []).length, 0, 'an id comparison survives');
  const chat = src('js/ui/chat.js');
  assert(/const at = msgs\.findIndex\(\(m\) => m\.id === messageId\);\s*\n\s*if \(at === -1\) return;\s*\n\s*const after = msgs\.slice\(at \+ 1\)\.find/.test(chat), 'retryUserMessage walks the order');
});

test('M33-4 no story is begun before there is a storyteller to answer it', () => {
  const chat = src('js/ui/chat.js');
  const send = chat.slice(chat.indexOf('  async function send(text) {'), chat.indexOf('  async function send(text) {') + 2500);
  assert(send.indexOf('resolveConnection(story)') < send.indexOf('db.stories.create({ title })'), 'the storyteller is looked for first');
});

test('M33-5 the dom walk exists and is wired: tests/dom with its own package.json, ignored node_modules', () => {
  assert(src('tests/dom/run.mjs').includes('DOM-4'), 'the walk presses try again');
  assert(src('tests/dom/package.json').includes('jsdom'), 'jsdom is a dev dependency of the walk only');
  assert(src('.gitignore').includes('tests/dom/node_modules'), 'never shipped, never committed');
  assert(!src('index.html').includes('node_modules'), 'the app knows nothing of npm');
});
