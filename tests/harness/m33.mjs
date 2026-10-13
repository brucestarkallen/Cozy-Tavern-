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

/* The scanner, kept apart so it can be held to both directions. A class set later in the creating line itself counts —
 * js/ui/auditscratchbook.js makes its Close button in one line of several statements, and the scanner, which looked only
 * at the lines after, called that button bare. Its name is matched whole (`tab.className` is not `b`'s class), and a
 * button made by a plain assignment (`back = document.createElement('button')`) is read as well. */
function bareButtons(text, file) {
  const bare = [];
  const lines = String(text).split('\n');
  lines.forEach((l, i) => {
    const m = l.match(/(?<![\w$.])(\w+)\s*=\s*document\.createElement\(['"]button['"]\)/);
    if (!m) return;
    const rest = l.slice(m.index + m[0].length) + '\n' + lines.slice(i + 1, i + 12).join('\n');
    if (!new RegExp('(?<![\\w$.])' + m[1] + '\\.(?:className\\s*=|classList\\.add\\()').test(rest)) bare.push(file + ':' + (i + 1) + ' ' + m[1]);
  });
  return bare;
}

test('M33-2 every button the house creates wears a class (never the browser’s own white)', () => {
  /* the scanner itself, both ways, on words written for it */
  eq(bareButtons("const close=document.createElement('button');close.type='button';close.className='text-btn';close.textContent='Close';", 'x').length, 0, 'a class set in the creating line is worn');
  eq(bareButtons("const b = document.createElement('button');\nb.type = 'button';\nb.className = 'text-btn';", 'x').length, 0, 'a class set on a line after is worn');
  eq(bareButtons("let chip = document.createElement('button');\nchip.classList.add('chip');", 'x').length, 0, 'classList.add is worn');
  eq(bareButtons("const close=document.createElement('button');close.type='button';close.textContent='Close';", 'x').length, 1, 'one line and no class: bare');
  eq(bareButtons("const b = document.createElement('button');\nb.textContent = 'Go';\ntab.className = 'quiet';", 'x').length, 1, 'another name’s class is not this button’s');
  eq(bareButtons("back = document.createElement('button');\nback.textContent = 'Back';", 'x').length, 1, 'a button made by a plain assignment is read too');
  const bare = [];
  for (const f of readdirSync(new URL('../../js/ui/', import.meta.url)).filter((x) => x.endsWith('.js'))) bare.push(...bareButtons(src('js/ui/' + f), f));
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
  const at = chat.indexOf('  async function send(text'); /* M548: send gained a second, optional parameter (the choice he took) — the law is about the order inside, not the signature */
  assert(at !== -1, 'the send is found');
  /* M675: the whole of send, to where the next function begins — a fixed 3,200 characters stopped twelve short of the line
   * being looked for once send gained the title taken from an attached file (the order had not changed; walk DOM-1 runs it) */
  const end = chat.indexOf('\n  async function ', at + 10);
  const send = chat.slice(at, end === -1 ? at + 6000 : end);
  assert(send.indexOf('resolveConnection(story)') < send.indexOf('db.stories.create({ title })'), 'the storyteller is looked for first');
});

test('M33-5 the dom walk exists and is wired: tests/dom with its own package.json, ignored node_modules', () => {
  assert(src('tests/dom/run.mjs').includes('DOM-4'), 'the walk presses try again');
  assert(src('tests/dom/package.json').includes('jsdom'), 'jsdom is a dev dependency of the walk only');
  assert(src('.gitignore').includes('tests/dom/node_modules'), 'never shipped, never committed');
  assert(!src('index.html').includes('node_modules'), 'the app knows nothing of npm');
});
