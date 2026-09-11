/* Cozy Tavern — tests/dom/run.mjs
 * M33: the walk-through, done by a machine, every commit. Run it:
 *   node tests/dom/run.mjs           (after: cd tests/dom && npm install)
 * It boots the real app in jsdom (env.mjs) and presses what a person
 * presses: sends, tries again, edits, swipes, branches, deletes, goes on;
 * opens the drawer, the settings, the regex shelf; brings a regex file.
 * Every scenario ends with the same question: any errors? An app that
 * renders a button that answers nothing, or a button in the browser's own
 * clothes, fails here — that is the field report that founded this file.
 */
import { boot, until, click, type, submit, q, qa, tick, openSettings, closeSettings } from './env.mjs';
import { test, assert, eq, runAll } from '../harness/lib.mjs';
import { readFileSync, existsSync } from 'node:fs';

const env = await boot();
const { document, db, house, errors } = env;

const FOUNDING = JSON.stringify({ mutations: [
  { type: 'mc.set', name: 'Jovan' },
  { type: 'place.set', name: 'McDonald’s' },
  { type: 'clock.set', year: 2025, month: 3, day: 14, hour: 14, minute: 30 },
  { type: 'presence.enter', name: 'Jovan', position: 'in the booth' },
  { type: 'presence.enter', name: 'Liara' },
] });
const WORLD = JSON.stringify({ mutations: [
  { type: 'offscreen.set', name: 'Kim', location: 'her apartment', activity: 'scrolling', agenda: 'find out who Jovan is with', stance: 'seeking', etaMinutes: 40 },
  { type: 'thread.set', title: 'Kim and the sighting', owner: 'Kim', next: 'text Liara' },
], brief: { pressure: ['Kim could reach the restaurant in about forty minutes'], ripe: [], twb: null } });

/* the workers answer by what they were asked */
house.state.mend = false;
house.state.workerAnswer = (body, sys) => {
  const user = String((body.messages || []).slice(-1)[0] && (body.messages || []).slice(-1)[0].content || '');
  if (/mend a story/i.test(sys) || /<contradiction>/.test(user)) {
    /* the mender: change the one word, keep the page */
    const blocks = [...user.matchAll(/\[(\d+)\] \((STORY|PLAYER)\) ([\s\S]*?)(?=\n\n\[\d+\] \(|\n<\/passage>)/g)];
    const hit = blocks.find((b) => b[2] === 'STORY' && /Kim/.test(b[3]));
    return hit ? JSON.stringify([{ index: Number(hit[1]), text: hit[3].replace('Kim', 'Kris') }]) : '[]';
  }
  if (/keep the ledger/i.test(sys)) return FOUNDING;
  if (/world beyond the page/i.test(sys)) return WORLD;
  if (/character scribe/i.test(sys)) return '{"deltas":[]}';
  if (/continuity reader/i.test(sys)) return house.state.mend ? '{"findings":[{"words":"Kim is written as the mother; the record says Kris.","severity":"warn","fix":"Kris is the mother"}]}' : '{"findings":[]}';
  if (/auditor of the ledger/i.test(sys)) return '{"issues":[]}';
  if (/found the ledger/i.test(sys)) return '{"mutations":[]}';
  if (/reading a story's past/i.test(sys)) return '{"deltas":[],"shifts":[]}';
  return '{"mutations":[],"deltas":[],"findings":[]}';
};

const errorsSince = (n) => errors.slice(n);
const assistantPages = () => qa('.msg-assistant');
const userPages = () => qa('.msg-user');
const bodyText = (node) => node.querySelector('.msg-body').textContent;
/* M72: settled means the stream, the house's busy flag AND a replay in
 * progress — a history change on an older page now rebuilds the ledger in
 * the queue, and a walk that presses on before it finishes is racing it. */
const settled = async () => {
  await until(() => !q('.msg-pending') && !q('.msg.streaming'), 'the stream to settle');
  await until(() => !(env.ctx && env.ctx.chat && (env.ctx.chat.isBusy() || env.ctx.chat.isReplaying())), 'the house and its replay to settle', 20000);
  await tick(120);
};
const storyId = async () => (await db.settings.get('activeStoryId'));

test('DOM-1 the app boots with no errors and no connection prompts a kind note on send', async () => {
  eq(errors.length, 0, errors.join(' | '));
  eq(document.documentElement.dataset.version.length > 0, true);
  const input = q('#composer-input');
  type(input, 'Hello?');
  submit(q('#composer'));
  await tick(100);
  assert(!q('.msg-user'), 'no page without a connection');
  assert(input.value === 'Hello?', 'the words are kept');
  eq(errors.length, 0, errors.join(' | '));
});

test('DOM-2 a turn: send → the storyteller answers → the ledger is founded → the world agent speaks', async () => {
  await db.connections.add({ name: 'mock', type: 'openai', baseUrl: 'https://mock.example/v1', apiKey: 'k', model: 'm', maxTokens: 800 });
  await db.settings.set('memoryKeeper', false);
  const before = errors.length;
  type(q('#composer-input'), '#story Jovan is eating at McDonald’s with Liara.');
  submit(q('#composer'));
  await until(() => assistantPages().length === 1, 'the answer');
  await settled();
  const sid = await storyId();
  assert(sid, 'a story was begun from the first words');
  await until(async () => (await db.settings.get('state:' + sid) || {}).place, 'the ledger to be founded', 10000);
  const st = await db.settings.get('state:' + sid);
  eq(st.place.name, 'McDonald’s');
  eq(st.sheet.playerName, 'Jovan');
  eq(st.present.length, 2);
  await until(async () => (await db.settings.get('state:' + sid) || {}).worldBrief, 'the world’s word', 10000);
  const st2 = await db.settings.get('state:' + sid);
  eq(st2.worldBrief.pressure.length, 1);
  assert(st2.offscreen.Kim && st2.offscreen.Kim.stance === 'seeking', 'Kim is seated');
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-3 every act rendered under a page is one the thread answers', async () => {
  const u = userPages()[0];
  const a = assistantPages()[0];
  const acts = [...new Set([...qa('.msg-actions .msg-act', u), ...qa('.msg-actions .msg-act', a)].map((b) => b.dataset.act).filter(Boolean))];
  const chat = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  /* the thread has more than one click listener (code-copy chips first) — the
   * one that routes acts is the one that reads .msg-act */
  let handlerStart = -1;
  for (let i = chat.indexOf("els.thread.addEventListener('click'"); i !== -1; i = chat.indexOf("els.thread.addEventListener('click'", i + 1)) {
    if (chat.slice(i, i + 400).includes('.msg-act')) { handlerStart = i; break; }
  }
  assert(handlerStart !== -1, 'the act-routing listener exists');
  const handler = chat.slice(handlerStart, chat.indexOf('\n  });', handlerStart));
  const unrouted = acts.filter((act) => !new RegExp("act === '" + act.replace(/[-\\]/g, '\\$&') + "'").test(handler));
  eq(unrouted.length, 0, 'unrouted acts: ' + unrouted.join(', '));
});

test('DOM-4 "try again" under the writer’s page hears a fresh answer to THAT page (field report)', async () => {
  const before = errors.length;
  const first = bodyText(assistantPages()[0]);
  const tryBtn = q('.msg-user .msg-act[data-act="try again"]');
  assert(tryBtn, 'the row has try again');
  click(tryBtn);
  await until(() => assistantPages().length === 1 && bodyText(assistantPages()[0]) !== first, 'a fresh answer replacing the old', 10000);
  await settled();
  const sid = await storyId();
  const pages = (await db.messages.list(sid)).filter((m) => !m.hidden);
  eq(pages.length, 2, 'still one exchange');
  eq(pages[1].role, 'assistant');
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-5 "try again" on a page in the middle rewinds to just after it', async () => {
  const before = errors.length;
  type(q('#composer-input'), 'She looked away.');
  submit(q('#composer'));
  await until(() => assistantPages().length === 2, 'the second answer', 10000);
  await settled();
  const firstUser = userPages()[0];
  const secondAnswerText = bodyText(assistantPages()[1]);
  click(q('.msg-act[data-act="try again"]', firstUser));
  await until(() => assistantPages().length === 1, 'the tale rewound to the first exchange', 10000);
  await settled();
  const sid = await storyId();
  const pages = (await db.messages.list(sid)).filter((m) => !m.hidden);
  eq(pages.length, 2, 'u1 + a fresh a1; u2/a2 are gone');
  assert(bodyText(assistantPages()[0]) !== secondAnswerText);
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-6 edit: the buttons wear the house’s clothes, and the new words are kept (field report)', async () => {
  const before = errors.length;
  const a = assistantPages()[0];
  click(q('.msg-act[data-act="edit"]', a));
  const box = await until(() => q('.edit-box', a), 'the edit box');
  const keep = q('.edit-row button:not(.text-btn)', a);
  assert(keep && /Keep the new words/.test(keep.textContent), 'the keep button');
  assert(keep.classList.contains('btn'), 'the keep button is the house’s (was a bare browser button — the white banner)');
  assert(q('.edit-row .text-btn', a), 'never mind is a text button');
  type(box, 'Liara set the cup down. "You knew," she said.');
  click(keep);
  await until(() => !q('.edit-box', a) || !a.isConnected, 'the page re-inked');
  await tick(100);
  const sid = await storyId();
  const pages = (await db.messages.list(sid)).filter((m) => !m.hidden);
  eq(pages[1].text, 'Liara set the cup down. "You knew," she said.');
  const node = assistantPages()[0];
  assert(node.querySelector('.spoken'), 'the spoken line is coloured');
  /* the writer's own page edits too */
  const u = userPages()[0];
  click(q('.msg-act[data-act="edit"]', u));
  const ubox = await until(() => q('.edit-box', u), 'the writer’s edit box');
  type(ubox, 'Jovan is eating with Liara.');
  click(q('.edit-row .btn', u));
  await until(async () => (await db.messages.list(sid))[0].text === 'Jovan is eating with Liara.', 'the writer’s page kept');
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-7 swipe writes a second version and the counter says so; swipe-prev walks back', async () => {
  const before = errors.length;
  const a = assistantPages()[0];
  const first = bodyText(a);
  /* M40: the swipe bar — ▶ past the last version writes a new one */
  click(q('.swipe-bar .msg-act[data-act="swipe-next"]', a));
  await until(() => q('.swipe-count') && /2\s*\/\s*2/.test(q('.swipe-count').textContent), 'the counter at 2/2', 10000);
  await settled();
  assert(bodyText(assistantPages()[0]) !== first, 'a new version is shown');
  click(q('.msg-act[data-act="swipe-prev"]'));
  await until(() => /1\s*\/\s*2/.test(q('.swipe-count').textContent), 'walked back to 1/2');
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-8 branch shelves a new tale with the pages up to here; delete lets a page go', async () => {
  /* M55: the origin sits on a shelf, so the branch must too */
  { const sid0 = await storyId(); await db.stories.update(sid0, { projectId: 'shelf-m55' }); }
  const before = errors.length;
  const sid = await storyId();
  const storiesBefore = (await db.stories.list()).length;
  click(q('.msg-act[data-act="branch"]', assistantPages()[0]));
  await until(async () => (await db.stories.list()).length === storiesBefore + 1, 'a new tale on the shelf');
  await until(async () => (await storyId()) !== sid, 'the branch is open');
  const bid = await storyId();
  const pages = (await db.messages.list(bid)).filter((m) => !m.hidden);
  eq(pages.length, 2, 'the branch carries the exchange');
  /* M55: a branch stays on its project's shelf */
  const branchStory = await db.stories.get(bid);
  eq(branchStory.projectId, 'shelf-m55', 'the branch is on the same shelf as its origin');
  /* M43: the branch carries its checkpoint — the ledger, not a blank one */
  const bst = await db.settings.get('state:' + bid);
  assert(bst && (bst.place || (bst.present || []).length || Object.keys(bst.offscreen || {}).length), 'the branch has the ledger as it stood: ' + JSON.stringify(bst && { place: bst.place, present: bst.present }));
  await until(() => assistantPages().length === 1 && pages.some((p) => p.id === assistantPages()[0].dataset.id), 'the branch renders its own pages');
  click(q('.msg-act[data-act="delete"]', assistantPages()[0]));
  await until(async () => (await db.messages.list(bid)).filter((m) => !m.hidden).length === 1, 'the page is gone');
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-9 "go on" asks for more without a page of the writer’s', async () => {
  const before = errors.length;
  /* back to the first tale */
  const stories = await db.stories.list();
  const first = stories.find((s) => s.title.startsWith('#story') && !/— a branch$/.test(s.title));
  assert(first, 'the first tale is named from its first words (no empty "Hello?" tale was begotten): ' + stories.map((s) => s.title).join(' / '));
  const row = qa('.story-item').find((el) => el.textContent.includes('#story') && !el.textContent.includes('a branch'));
  assert(row, 'the first tale is on the shelf');
  click(q('.story-open', row) || row);
  await until(async () => (await storyId()) === first.id, 'the first tale is open');
  await until(() => assistantPages().length >= 1 && assistantPages()[0].dataset.id && (assistantPages()[0].dataset.id !== undefined), 'the first tale renders');
  await tick(150);
  const answers = assistantPages().length;
  const go = q('.msg-act[data-act="go on"]');
  assert(go, 'the last storyteller page offers go on');
  click(go);
  await until(() => assistantPages().length === answers + 1, 'one more answer', 10000);
  await settled();
  eq(userPages().length, 1, 'no visible page of the writer’s was added');
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-10 the drawer: every panel renders, the world beyond the page speaks, the workers say what they did and what they said', async () => {
  const before = errors.length;
  /* the workers are still writing after "go on" — wait for the world agent's seat before reading the drawer */
  const sid = await storyId();
  await until(async () => { const st = await db.settings.get('state:' + sid); return st && st.offscreen && st.offscreen.Kim; }, 'Kim to be seated by the world agent', 15000);
  click(q('#btn-ledger'));
  await until(() => !q('#drawer').hidden, 'the drawer opens');
  await until(() => /Kim/.test(q('#drawer-panels').textContent), 'the drawer to speak of Kim: ' + q('#drawer-panels').textContent.slice(0, 200));
  const titles = qa('#drawer-panels .ledger-panel h3, #drawer-panels .ledger-panel summary, #drawer-panels .ledger-panel .panel-title').map((h) => h.textContent.trim());
  for (const want of ['The clock', 'Who’s here', 'What’s happening elsewhere', 'The world beyond the page', 'What changed and why', 'The workers']) {
    assert(titles.some((t) => t.includes(want)), 'panel: ' + want + ' in ' + titles.join(' / '));
  }
  const drawerText = q('#drawer-panels').textContent;
  assert(/Kim/.test(drawerText), 'Kim is in the drawer');
  assert(/wrote \d+ changes|nothing to write down/.test(drawerText), 'the extractor says what it did: ' + drawerText.slice(-300));
  assert(/moved the world in/.test(drawerText), 'the world agent says what it did');
  assert(qa('#drawer-panels .worker-said').length >= 1, 'what it said is folded under a worker');
  click(q('#btn-ledger'));
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-11 settings: the rooms render; the regex shelf adds a rule, tries it, and brings a SillyTavern file', async () => {
  const before = errors.length;
  await openSettings();
  assert(qa('#regex-list > li').length >= 4, 'the house rules and the 🎨 pack are on the shelf');
  click(q('#btn-regex-add'));
  await until(() => !q('#regex-form').hidden, 'the form');
  type(q('#regex-name'), 'Kill the em dash');
  type(q('#regex-find'), '—');
  type(q('#regex-replace'), '-');
  q('#regex-mode').value = 'display';
  click(q('#btn-regex-try'));
  await until(() => !q('#regex-try-note').hidden && /match/i.test(q('#regex-try-note').textContent), 'a try note: ' + (q('#regex-try-note') && q('#regex-try-note').textContent));
  submit(q('#regex-form'));
  await until(() => qa('#regex-list > li').length >= 5, 'the rule joined the shelf');
  const stored = await db.settings.get('regexRules');
  assert(stored.some((r) => r.name === 'Kill the em dash' && r.mode === 'display'));
  /* bring a SillyTavern regex file */
  const st = [{ id: 'abc', scriptName: '🎨 Header', findRegex: '/^\\[([^\\]]+)\\]$/gm', replaceString: '<div class="hdr">$1</div>', placement: [2], markdownOnly: true }];
  const file = new File([JSON.stringify(st)], 'regex.json', { type: 'application/json' });
  const input = q('#regex-file');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await until(() => !q('#regex-import-note').hidden && /brought home/.test(q('#regex-import-note').textContent), 'the import note', 10000);
  assert((await db.settings.get('regexRules')).some((r) => r.id === 'st-abc' && r.mode === 'display'));
  /* the workers room and the world switch */
  assert(q('#world-agent').checked, 'the world agent is on by default');
  assert(q('#colour-speech').checked, 'speech colour is on by default');
  await closeSettings();
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-12 a dressed page renders through the allowlist: the header becomes a styled box, the prose stays', async () => {
  const before = errors.length;
  await until(() => assistantPages().length >= 1, 'pages');
  /* the imported 🎨 rule dresses the bracketed line on the next render */
  await openSettings(); await closeSettings();
  await tick(200);
  /* M34: the 🎨 pack dresses the header first (shelf order), as a card with a 📍 */
  const dressed = qa('.msg-assistant .msg-body div').filter((d) => /📍/.test(d.textContent) && d.getAttribute('style'));
  assert(dressed.length >= 1, 'the header rendered as the 🎨 card through the allowlist');
  assert(!qa('.msg-assistant .msg-body').some((b) => /^\s*\[Lakeside Park/.test(b.textContent)), 'the bracketed line itself is no longer shown raw');
  assert(!q('.msg-body script'), 'no script ever');
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-13 the housekeeper and the welcome tour open and close without a sound', async () => {
  const before = errors.length;
  click(q('#btn-housekeeper'));
  await tick(100);
  click(q('#btn-housekeeper'));
  await tick(50);
  await openSettings();
  const tour = q('#btn-tour-again') || qa('#view-settings button').find((b) => /tour/i.test(b.textContent));
  if (tour) { click(tour); await tick(100); const next = q('#welcome-next') || qa('#welcome-overlay button').find((b) => /next|begin|start/i.test(b.textContent)); if (next) { click(next); await tick(50); } const done = qa('#welcome-overlay button').find((b) => /begin|done|start|close|Not now/i.test(b.textContent)); if (done) click(done); }
  await closeSettings();
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-14 a refused house is said out loud, the words are kept, and the next send works', async () => {
  const before = errors.length;
  house.state.fail = 500;
  type(q('#composer-input'), 'Does it hold?');
  submit(q('#composer'));
  await until(() => q('.msg-note') || /went quiet|said no|couldn’t|wouldn’t/i.test(q('#thread').textContent), 'the kind note', 10000);
  house.state.fail = null;
  await settled();
  const answers = assistantPages().length;
  const retry = q('.msg-act[data-act="try again"]', userPages()[userPages().length - 1]);
  if (retry) click(retry); else { type(q('#composer-input'), 'Again.'); submit(q('#composer')); }
  await until(() => assistantPages().length >= answers + 1, 'an answer after the refusal', 10000);
  await settled();
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-7b a version keeps its own ledger: walking back restores it; the people panel shows everyone seated; rescan works', async () => {
  const before = errors.length;
  const sid = await storyId();
  await until(async () => ((await db.settings.get('versionState:' + sid)) || {}) && Object.keys((await db.settings.get('versionState:' + sid)) || {}).length >= 1, 'a version checkpoint exists', 15000);
  const a = assistantPages()[0];
  const counter = q('.swipe-count', a);
  const idxBefore = counter.textContent;
  const dir = /^\s*1\s*\//.test(idxBefore) ? 'swipe-next' : 'swipe-prev';
  click(q(`.swipe-bar .msg-act[data-act="${dir}"]`, a));
  await until(() => q('.swipe-count', assistantPages()[0]).textContent !== idxBefore, 'walked to another version');
  await tick(300);
  const st = await db.settings.get('state:' + sid);
  assert(st && (st.place || (st.present || []).length), 'the ledger stands after walking versions');
  click(q('#btn-ledger')); await until(() => !q('#drawer').hidden, 'drawer'); await tick(400);
  assert(/The people/.test(q('#drawer-panels').textContent), 'the people panel is there');
  assert(/Kim/.test(q('#drawer-panels').textContent), 'Kim, seated by the world agent, has a page');
  const rescan = qa('#drawer-panels button').find((b) => /Read the pages again/.test(b.textContent));
  assert(rescan, 'the rescan button');
  click(rescan); await tick(400);
  click(q('#btn-ledger'));
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-12b a tale moves to a shelf from its menu, and back to loose', async () => {
  const before = errors.length;
  const shelf = await db.projects.create({ name: 'Summer tales' });
  const sid = await storyId();
  const row = await until(() => qa('.story-item').find((li) => li.classList.contains('active')), 'the active row');
  const menuBtn = qa('.story-mini', row).find((b) => /Take this tale with you/.test(b.title));
  assert(menuBtn, 'the row’s menu button: ' + qa('.story-mini', row).map((b) => b.title).join(' | '));
  click(menuBtn);
  await until(() => !q('#story-menu').hidden, 'the story menu');
  const move = qa('#story-menu button[data-act="move-shelf"]').find((b) => /Summer tales/.test(b.textContent));
  assert(move, 'the shelf is offered');
  click(move);
  await until(async () => (await db.stories.get(sid)).projectId === shelf.id, 'moved to the shelf');
  click(menuBtn);
  await until(() => !q('#story-menu').hidden, 'the story menu again');
  const loose = qa('#story-menu button[data-act="move-shelf"]').find((b) => /No shelf/.test(b.textContent));
  click(loose);
  await until(async () => !(await db.stories.get(sid)).projectId, 'loose again');
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-11b the housekeeper: fullscreen (Esc leaves it), a draggable top bar, and ↻ Retry asks the last question again', async () => {
  const before = errors.length;
  click(q('#btn-housekeeper'));
  await until(() => !q('#hk-sheet').hidden, 'the housekeeper');
  const sheet = q('#hk-sheet');
  click(q('#btn-hk-full'));
  assert(sheet.classList.contains('fullscreen'), 'fullscreen on');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert(!sheet.classList.contains('fullscreen') && !sheet.hidden, 'Esc leaves fullscreen first, the sheet stays open');
  /* a desk drag: pointer events on the head */
  const head = q('.hk-head');
  const PE = window.PointerEvent || window.MouseEvent;
  head.dispatchEvent(new PE('pointerdown', { clientX: 300, clientY: 20, pointerType: 'mouse', bubbles: true }));
  head.dispatchEvent(new PE('pointermove', { clientX: 200, clientY: 60, pointerType: 'mouse', bubbles: true }));
  head.dispatchEvent(new PE('pointerup', { clientX: 200, clientY: 60, pointerType: 'mouse', bubbles: true }));
  assert(sheet.classList.contains('floating') && sheet.style.top === '40px', 'dragged: ' + sheet.style.top + ' ' + sheet.style.left);
  head.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  assert(!sheet.classList.contains('floating'), 'a double tap docks it again');
  /* retry: ask, then ask again */
  const priorAnswer = house.state.workerAnswer;
  house.state.workerAnswer = (body, sys) => (/housekeeper of a cozy tavern/i.test(sys) ? 'Answer one.' : priorAnswer(body, sys));
  type(q('#hk-input'), 'is anything wrong?');
  submit(q('#hk-form'));
  await until(() => qa('#hk-thread .hk-bubble').length >= 2, 'the first answer', 10000);
  const sid = await storyId();
  const active = (root) => root.sessions.find((x) => x.id === root.activeId);
  const sess1 = active(await db.settings.get('hk:' + sid));
  eq(sess1.turns.length, 2);
  house.state.workerAnswer = (body, sys) => (/housekeeper of a cozy tavern/i.test(sys) ? 'Answer two.' : priorAnswer(body, sys));
  click(q('#hk-retry'));
  await until(async () => { const s2 = active(await db.settings.get('hk:' + sid)); return s2 && s2.turns.length === 2 && /Answer two/.test(s2.turns[1].text); }, 'the question asked again, the old answer gone', 10000);
  house.state.workerAnswer = priorAnswer;
  click(q('#btn-hk-close'));
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-8a branch 0→0 keeps the ledger; branch N→0 carries page 0’s ledger and nothing later, even after an old page was swiped', async () => {
  const before = errors.length;
  const startSid = await storyId();
  /* the reader seats Kim when a page says she walked in */
  const priorWorker = house.state.workerAnswer;
  house.state.workerAnswer = (body, sys) => {
    const user = String((body.messages || []).slice(-1)[0] && (body.messages || []).slice(-1)[0].content || '');
    if (/keep the ledger/i.test(sys) && /Kim walked in/.test(user)) return '{"mutations":[{"type":"presence.enter","name":"Kim","position":"in the booth"}]}';
    return priorWorker(body, sys);
  };
  /* a fresh story: one exchange, then branch at its only page → the present ledger comes along */
  click(q('#btn-new-story'));
  await until(() => !q('#new-story-form').hidden, 'the new-story form');
  type(q('#new-story-title'), 'Checkpoints');
  submit(q('#new-story-form'));
  const sid = await until(async () => { const id = await storyId(); const s0 = id && (await db.stories.get(id)); return s0 && s0.title === 'Checkpoints' ? id : null; }, 'the story is open');
  await until(() => assistantPages().length === 0, 'the new story’s empty thread');
  type(q('#composer-input'), 'I walk in.');
  submit(q('#composer'));
  await until(() => assistantPages().length >= 1, 'page 0', 10000);
  await settled();
  const at0 = await db.settings.get('state:' + sid);
  assert(at0 && (at0.place || (at0.present || []).length), 'turn 0 founded a ledger');
  click(q('.msg-act[data-act="branch"]', assistantPages()[0]));
  await until(async () => (await storyId()) !== sid, 'branch 0→0 is open', 10000);
  const b1 = await storyId();
  const b1st = await db.settings.get('state:' + b1);
  eq(JSON.stringify({ p: b1st.place, pr: b1st.present }), JSON.stringify({ p: at0.place, pr: at0.present }), '0→0 keeps the ledger');
  /* back to the origin; two more turns; swipe an OLD page; then branch at page 0 */
  const row = qa('.story-item').find((li) => /Checkpoints/.test(li.textContent) && !/a branch/.test(li.textContent));
  click(q('.story-open', row) || row);
  await until(async () => (await storyId()) === sid, 'back on the origin', 10000);
  house.state.storyAnswer = () => 'Later, Kim walked in and sat down.\n\nThe booth was quiet.';
  type(q('#composer-input'), 'Later.'); submit(q('#composer'));
  await until(() => assistantPages().length >= 2, 'page 1', 10000);
  await settled();
  type(q('#composer-input'), 'And later.'); submit(q('#composer'));
  await until(() => assistantPages().length >= 3, 'page 2', 10000);
  await settled();
  house.state.storyAnswer = null;
  const atN = await db.settings.get('state:' + sid);
  const present = (atN.present || []).map((p) => p.name);
  assert(present.some((n) => /Kim/.test(n)), 'turn N has Kim present: ' + present.join(','));
  /* walk a swipe on page 0 (an old page) — this used to save the turn-N ledger under page 0 */
  const first = assistantPages()[0];
  click(q('.swipe-bar .msg-act[data-act="swipe-next"]', first) || q('.msg-act[data-act="swipe"]', first));
  await until(() => q('.swipe-count', assistantPages()[0]) && /2/.test(q('.swipe-count', assistantPages()[0]).textContent), 'a second version of page 0', 15000);
  await settled();
  const versions = (await db.settings.get('versionState:' + sid)) || {};
  const page0 = assistantPages()[0].dataset.id;
  for (const [key, st] of Object.entries(versions)) {
    if (key.startsWith(page0 + ':')) assert(!(st.present || []).some((p) => /Kim/.test(p.name)), 'page 0’s checkpoint never holds the later Kim: ' + key);
  }
  click(q('.msg-act[data-act="branch"]', assistantPages()[0]));
  await until(async () => { const id = await storyId(); return id !== sid && id !== b1; }, 'branch N→0 is open', 10000);
  const b2 = await storyId();
  const b2st = await db.settings.get('state:' + b2);
  assert(!(b2st.present || []).some((p) => /Kim/.test(p.name)), 'N→0 does not carry Kim: ' + JSON.stringify(b2st.present));
  await settled();
  house.state.workerAnswer = priorWorker;
  /* back to the story the walk began with, for the scenarios that follow */
  const startTitle = (await db.stories.get(startSid)).title;
  const row2 = qa('.story-item').find((li) => li.textContent.includes(startTitle) && !/a branch|Checkpoints/.test(li.textContent));
  click(q('.story-open', row2) || row2);
  await until(async () => (await storyId()) === startSid, 'back on the first story', 10000);
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

/* THE CHECKPOINT INVARIANT (M68). For every storyteller page i, at any moment, a branch
 * at page i carries exactly the people who had entered by page i — no one later, no one
 * missing. The reader seats Person<i> on page i (the mock), so the expected set is known.
 * A random but seeded sequence of everything the writer does — send, swipe the last page,
 * walk a swipe on an old page, retry, edit an old page, delete a middle page — and after
 * each action the invariant is checked at every page by branching there. */
test('DOM-8c the checkpoint invariant holds under a random sequence of sends, swipes (last and old, walked and written), retries, edits (old and last) and deletes (mid, a writer’s page, the tail)', async () => {
  const before = errors.length;
  const startSid = await storyId();
  const { queuedCount } = await import('../../js/agents/queue.js');
  const idle = async (sid) => { await until(() => !env.ctx.chat.isBusy() && !env.ctx.chat.isReplaying() && queuedCount(sid) === 0 && !q('.msg-pending'), 'the house and its workers idle', 20000); await tick(150); };
  let seed = 20260911;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const priorWorker = house.state.workerAnswer;
  const priorStory = house.state.storyAnswer;
  let turnNo = 0;
  house.state.storyAnswer = () => { turnNo += 1; return 'Person' + turnNo + ' entered the room and sat down.'; };
  house.state.workerAnswer = (body, sys) => {
    const user = String((body.messages || []).slice(-1)[0] && (body.messages || []).slice(-1)[0].content || '');
    if (/keep the ledger/i.test(sys)) {
      const m = user.match(/(Person\d+) entered/);
      return m ? '{"mutations":[{"type":"presence.enter","name":"' + m[1] + '"}]}' : '{"mutations":[]}';
    }
    return priorWorker(body, sys);
  };
  click(q('#btn-new-story'));
  await until(() => !q('#new-story-form').hidden, 'the new-story form');
  type(q('#new-story-title'), 'Invariant');
  submit(q('#new-story-form'));
  const sid = await until(async () => { const id = await storyId(); const s0 = id && (await db.stories.get(id)); return s0 && s0.title === 'Invariant' ? id : null; }, 'the story is open');
  await until(() => assistantPages().length === 0, 'the new story’s empty thread');
  let stepName = 'start';
  const send = async () => {
    await until(() => !env.ctx.chat.isBusy() && !q('.msg-pending'), 'the house free', 20000);
    const n = assistantPages().length;
    type(q('#composer-input'), 'go'); submit(q('#composer'));
    try {
      await until(() => assistantPages().length > n, 'a page', 15000);
    } catch (err) {
      const inDb = (await db.messages.list(sid)).map((m) => m.role + ':' + String(m.text || '').slice(0, 24) + (m.hidden ? '(h)' : ''));
      const tail = [...q('#thread').children].slice(-3).map((el) => el.className + '::' + el.textContent.slice(0, 60));
      const note = q('#composer-note') ? q('#composer-note').textContent : '(no note el)';
      const conns = (await db.connections.list()).length;
      const active = await db.settings.get('activeConnectionId');
      const st = await db.stories.get(sid);
      const notes = qa('#thread .msg-note').map((n) => n.textContent.slice(0, 120));
      const lastCall = house.state.calls[house.state.calls.length - 1];
      throw new Error('a page at step ' + stepName + ' — dom pages=' + assistantPages().length + ' db=' + JSON.stringify(inDb) + ' notes=' + JSON.stringify(notes) + ' errors=' + JSON.stringify(errorsSince(before)) + ' toast=' + JSON.stringify(q('#toast') && q('#toast').textContent) + ' lastCall=' + JSON.stringify(lastCall && lastCall.url) + ' conns=' + conns + ' active=' + active);
    }
    await idle(sid);
  };
  const personsOnPage = (p) => { const m = bodyText(p).match(/(Person\d+) entered/); return m ? m[1] : null; };
  const expectedAt = (i) => { const pages = assistantPages().slice(0, i + 1); return new Set(pages.map(personsOnPage).filter(Boolean)); };
  const presentNames = (st) => new Set((st.present || []).map((p) => p.name).filter((n) => /^Person\d+$/.test(n)));
  const checkAll = async (label) => {
    const n = assistantPages().length;
    /* M72: the ledger as it STANDS is the last page's — not only every branch's */
    await idle(sid);
    eq([...presentNames(await db.settings.get('state:' + sid))].sort().join(','), [...expectedAt(n - 1)].sort().join(','), label + ' — the standing ledger is the last page’s');
    for (let i = 0; i < n; i += 1) {
      const want = expectedAt(i);
      const page = assistantPages()[i];
      click(q('.msg-act[data-act="branch"]', page));
      const bid = await until(async () => { const id = await storyId(); return id !== sid ? id : null; }, 'the branch', 15000);
      await idle(bid);
      const got = presentNames(await db.settings.get('state:' + bid));
      eq([...got].sort().join(','), [...want].sort().join(','), label + ' — a branch at page ' + i + ' carries exactly that page’s people');
      /* back, and let the branch go so the shelf stays small */
      const row = qa('.story-item').find((li) => /Invariant/.test(li.textContent) && !/a branch/.test(li.textContent));
      click(q('.story-open', row) || row);
      await until(async () => (await storyId()) === sid, 'back', 10000);
      await db.stories.remove(bid);
    }
  };
  try {
  for (let t = 0; t < 4; t += 1) await send();
  await checkAll('after four sends');
  const actions = ['swipe-last', 'send', 'swipe-old', 'retry', 'edit-old', 'send', 'delete-mid', 'send', 'swipe-new-old', 'edit-last', 'delete-user-mid', 'send', 'delete-tail', 'send'];
  for (let step = 0; step < actions.length; step += 1) {
    const act = actions[step];
    stepName = act;
    const pages = assistantPages();
    try {
    if (act === 'send') await send();
    else if (act === 'swipe-last') {
      const last = pages[pages.length - 1];
      click(q('.swipe-bar .msg-act[data-act="swipe-next"]', last));
      await until(() => q('.swipe-count', assistantPages()[assistantPages().length - 1]) && /2/.test(q('.swipe-count', assistantPages()[assistantPages().length - 1]).textContent), 'a new version of the last page', 15000);
      await idle(sid);
    } else if (act === 'swipe-old') {
      /* an old page only WALKS versions it already has (the page that was swiped while it was last) */
      const old = pages.find((p) => q('.swipe-bar', p) && !p.isSameNode(pages[pages.length - 1]));
      assert(old, 'an old page with versions to walk');
      const oldId = old.dataset.id;
      const live = () => assistantPages().find((p) => p.dataset.id === oldId);
      const was = q('.swipe-count', old).textContent;
      click(q('.swipe-bar .msg-act[data-act="swipe-prev"]', old));
      await until(() => live() && q('.swipe-count', live()) && q('.swipe-count', live()).textContent !== was, 'walked to the other version of an old page', 15000);
      await idle(sid);
    } else if (act === 'swipe-new-old') {
      /* M72: a NEW version written on an old page — its people belong to that page, and the pages after keep theirs */
      const old = pages.find((p) => q('.swipe-bar', p) && !p.isSameNode(pages[pages.length - 1]));
      assert(old, 'an old page with a swipe bar');
      const oldId = old.dataset.id;
      const live = () => assistantPages().find((p) => p.dataset.id === oldId);
      const versions = (await db.messages.list(sid)).find((m) => m.id === oldId);
      const had = Array.isArray(versions.swipes) ? versions.swipes.length : 1;
      /* walk to the last version first, then past it */
      for (let g = 0; g < 4; g += 1) {
        const m = (await db.messages.list(sid)).find((x) => x.id === oldId);
        const idx = Array.isArray(m.swipes) && m.swipes.length ? (Number.isFinite(m.swipeIdx) ? m.swipeIdx : m.swipes.length - 1) : 0;
        if (!Array.isArray(m.swipes) || idx >= m.swipes.length - 1) break;
        click(q('.swipe-bar .msg-act[data-act="swipe-next"]', live()));
        await idle(sid);
      }
      click(q('.swipe-bar .msg-act[data-act="swipe-next"]', live()));
      await until(async () => { const m = (await db.messages.list(sid)).find((x) => x.id === oldId); return m && Array.isArray(m.swipes) && m.swipes.length > had; }, 'a new version of an old page', 15000);
      await idle(sid);
    } else if (act === 'edit-last') {
      const last = pages[pages.length - 1];
      const lastId = last.dataset.id;
      const wasText = (await db.messages.list(sid)).find((m) => m.id === lastId).text;
      click(q('.msg-act[data-act="edit"]', last));
      const ta = await until(() => q('textarea.edit-box', last), 'the editor');
      ta.value = wasText.replace(/Person\d+/, 'Person99'); ta.dispatchEvent(new window.Event('input', { bubbles: true }));
      click(qa('button', last).find((b) => /keep the new words/i.test(b.textContent)));
      await until(async () => { const m = (await db.messages.list(sid)).find((x) => x.id === lastId); return m && /Person99/.test(m.text) && !q('textarea.edit-box'); }, 'the edit kept', 15000);
      await idle(sid);
    } else if (act === 'delete-user-mid') {
      /* M72: a writer's page let go in the middle moves no storyteller page — the stamps stand */
      const users = qa('.msg-user'); const u = users[1];
      const priorConfirm = window.confirm; window.confirm = () => true;
      click(q('.msg-act[data-act="delete"]', u));
      await until(() => !qa('.msg-user').some((p) => p.dataset.id === u.dataset.id), 'the writer’s page gone');
      window.confirm = priorConfirm;
      await idle(sid);
    } else if (act === 'delete-tail') {
      /* M72: the LAST storyteller page let go — the ledger folds back to the page before it, now */
      const last = pages[pages.length - 1];
      const priorConfirm = window.confirm; window.confirm = () => true;
      click(q('.msg-act[data-act="delete"]', last));
      await until(() => !assistantPages().some((p) => p.dataset.id === last.dataset.id), 'the tail page gone');
      window.confirm = priorConfirm;
      await idle(sid);
    } else if (act === 'retry') {
      const users = qa('.msg-user'); const u = users[users.length - 1];
      click(q('.msg-act[data-act="try again"]', u));
      await until(() => q('.msg-pending') || q('.msg.streaming') || true, 'the retry began');
      await settled(); await idle(sid);
    } else if (act === 'edit-old') {
      const old = pages[Math.floor(rnd() * (pages.length - 1))];
      const oldId = old.dataset.id;
      const wasText = (await db.messages.list(sid)).find((m) => m.id === oldId).text;
      click(q('.msg-act[data-act="edit"]', old));
      const ta = await until(() => q('textarea.edit-box', old), 'the editor');
      ta.value = wasText.replace(' and sat down', ' and stood'); ta.dispatchEvent(new window.Event('input', { bubbles: true }));
      click(qa('button', old).find((b) => /keep the new words/i.test(b.textContent)));
      await until(async () => { const m = (await db.messages.list(sid)).find((x) => x.id === oldId); return m && /and stood/.test(m.text) && !q('textarea.edit-box'); }, 'the edit kept', 15000);
      await idle(sid);
    } else if (act === 'delete-mid') {
      const mid = pages[1];
      const priorConfirm = window.confirm; window.confirm = () => true;
      click(q('.msg-act[data-act="delete"]', mid));
      await until(() => !assistantPages().some((p) => p.dataset.id === mid.dataset.id), 'the page gone');
      window.confirm = priorConfirm;
      await idle(sid);
    }
    } catch (err) { throw new Error('at step ' + act + ' (pages=' + pages.length + '): ' + (err && err.message)); }
    await checkAll('after ' + act);
  }
  } finally { house.state.workerAnswer = priorWorker; house.state.storyAnswer = priorStory; }
  const startTitle = (await db.stories.get(startSid)).title;
  const row = qa('.story-item').find((li) => li.textContent.includes(startTitle) && !/a branch|Invariant|Checkpoints/.test(li.textContent));
  click(q('.story-open', row) || row);
  await until(async () => (await storyId()) === startSid, 'back on the first story', 10000);
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-8d a branch at the FIRST WRITER’S message carries no storyteller page and no ledger of one', async () => {
  const before = errors.length;
  const sid = await storyId();
  const now = await db.settings.get('state:' + sid);
  assert((now.present || []).length || now.place, 'the story has a ledger to leave behind');
  const { queuedCount } = await import('../../js/agents/queue.js');
  await until(() => !env.ctx.chat.isBusy() && queuedCount(sid) === 0 && !q('.msg-pending'), 'the house free', 30000);
  await tick(300);
  click(q('.msg-act[data-act="branch"]', userPages()[0]));
  await until(async () => (await storyId()) !== sid, 'the branch is open', 10000);
  const bid = await storyId();
  await settled();
  const bst = await db.settings.get('state:' + bid);
  const pages = (await db.messages.list(bid)).filter((m) => !m.hidden);
  eq(pages.filter((m) => m.role === 'assistant').length, 0, 'no storyteller page in the branch');
  eq((bst.present || []).length, 0, 'no one present: ' + JSON.stringify(bst.present));
  eq(bst.place, null, 'no ground');
  eq(bst.clock, null, 'no clock — not even the old date');
  eq(Object.keys(bst.offscreen || {}).length, 0, 'no seats');
  const originTitle = (await db.stories.get(sid)).title;
  const row = qa('.story-item').find((li) => li.textContent.includes(originTitle) && !/a branch/.test(li.textContent));
  click(q('.story-open', row) || row);
  await until(async () => (await storyId()) === sid, 'back on the origin', 10000);
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-8b a branch at the start never carries a later ledger: no checkpoint → a clean ledger and a re-reading', async () => {
  const before = errors.length;
  const sid = await storyId();
  /* a story with a rich present and NO checkpoints (as one played before the checkpoint law, or pruned) */
  await db.settings.delete('snapshots:' + sid);
  await db.settings.delete('versionState:' + sid);
  const now = await db.settings.get('state:' + sid);
  assert(now && ((now.present || []).length || now.place || Object.keys(now.offscreen || {}).length), 'the present ledger has content');
  const { foldJournal } = await import('../../js/engine/state.js');
  const { applyMutations } = await import('../../js/engine/apply.js');
  const expected = foldJournal(now, [], 0, applyMutations); /* M69: page 0's exact ledger, from the journal */
  click(q('.msg-act[data-act="branch"]', assistantPages()[0]));
  await until(async () => (await storyId()) !== sid, 'the branch is open', 10000);
  const bid = await storyId();
  await settled();
  const bst = await db.settings.get('state:' + bid);
  const names = (st) => (st.present || []).map((p) => p.name).sort().join(',');
  eq(names(bst), names(expected), 'the branch at page 0 carries page 0’s exact ledger (the fold), never the later one');
  assert(names(bst) !== names(now) || (now.present || []).length <= (expected.present || []).length, 'and the later people are not there');
  /* back to the origin (rows carry no id; find it by title) */
  const originTitle = (await db.stories.get(sid)).title;
  const row = qa('.story-item').find((li) => li.textContent.includes(originTitle) && !/a branch/.test(li.textContent));
  click(q('.story-open', row) || row);
  await until(async () => (await storyId()) === sid, 'back on the origin', 10000);
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-11d the housekeeper’s sessions, commands, tools and cards bar work through the real UI', async () => {
  const before = errors.length;
  click(q('#btn-housekeeper'));
  await until(() => !q('#hk-sheet').hidden, 'the housekeeper');
  const sid = await storyId();
  const priorAnswer = house.state.workerAnswer;
  house.state.workerAnswer = (body, sys) => (/housekeeper of a cozy tavern/i.test(sys) ? 'Nothing drifted.' : priorAnswer(body, sys));
  /* a command expands on the wire but the talk shows what was typed */
  const optionsNow = () => qa('#hk-session option').length;
  const base = optionsNow();
  await until(() => !q('#hk-send').disabled, 'the housekeeper free to be asked', 10000);
  type(q('#hk-input'), '#s');
  submit(q('#hk-form'));
  await until(() => qa('#hk-thread .hk-writer').some((b) => /#s/.test(b.textContent)) && !q('#hk-thread .hk-pending'), 'the typed command is what the talk shows, and the answer landed', 10000);
  const firstId = q('#hk-session').value;
  await until(() => !q('#hk-send').disabled, 'the housekeeper free again', 10000);
  /* new session, branch, switch back */
  click(q('#hk-sess-new'));
  await until(() => optionsNow() === base + 1, 'a second session', 10000);
  eq(qa('#hk-thread .hk-bubble').length, 0, 'the new session is empty');
  q('#hk-session').value = firstId; q('#hk-session').dispatchEvent(new window.Event('change', { bubbles: true }));
  await until(() => qa('#hk-thread .hk-writer').some((b) => /#s/.test(b.textContent)), 'back to the first');
  click(q('#hk-sess-branch'));
  await until(() => optionsNow() === base + 2, 'a branch', 10000);
  assert(/branch/.test(q('#hk-session').selectedOptions[0].textContent));
  /* branch here — on the writer's bubble AND on the answer (M73: the row is on both) */
  assert(qa('#hk-thread .hk-writer .hk-branch-here').length >= 1 && qa('#hk-thread .hk-housekeeper .hk-branch-here').length >= 1, 'branch on both voices');
  click(q('#hk-thread .hk-housekeeper .hk-branch-here'));
  await until(() => optionsNow() === base + 3, 'branched at an answer', 10000);
  /* M73: the rest of the row — retry as a version of the last answer, the versions walked, edit-and-continue, delete one turn */
  const answers = () => qa('#hk-thread .hk-housekeeper');
  const priorConfirm2 = window.confirm; window.confirm = () => true;
  try {
    const nAnswers = answers().length;
    const countNow = () => { const c = q('#hk-thread .hk-swipe-count'); return c ? c.textContent : '1/1'; };
    const had = Number(countNow().split('/')[1]); /* the answer may already have versions (the toolbar's ↻ above made two) */
    /* M73-002: ▸ on the last answer, past its versions, asks for another answer */
    assert(!q('.hk-retry-here', answers()[answers().length - 1]) && q('.hk-swipe-next', answers()[answers().length - 1]), 'the last answer wears the swipe bar, not ↻');
    click(q('.hk-swipe-next', answers()[answers().length - 1]));
    await until(() => q('#hk-send').disabled, 'another answer was asked for');
    await until(() => !q('#hk-send').disabled && countNow() === (had + 1) + '/' + (had + 1), 'a new version of the last answer beside the old: ' + countNow(), 15000);
    eq(answers().length, nAnswers, 'the retry replaced the last answer, no more answers');
    await tick(60);
    click(q('#hk-thread .hk-swipe-prev'));
    await until(() => countNow() === had + '/' + (had + 1), 'walked to the version before');
    await tick(60);
    click(q('#hk-thread .hk-swipe-next'));
    await until(() => countNow() === (had + 1) + '/' + (had + 1), 'and back');
    await tick(60);
    const bubblesBefore = qa('#hk-thread .hk-bubble').length;
    click(q('.hk-delete-here', answers()[answers().length - 1]));
    await until(() => qa('#hk-thread .hk-bubble').length === bubblesBefore - 1, 'one turn let go');
    const writers = () => qa('#hk-thread .hk-writer');
    const firstWriter = writers()[0];
    const words = q('.hk-bubble-text', firstWriter).textContent;
    click(q('.hk-edit-here', firstWriter));
    await until(() => q('#hk-input').value === words && qa('#hk-thread .hk-bubble').length === 0, 'edit-and-continue: the turns from here on are let go, the words are in the box');
    q('#hk-input').value = '';
  } finally { window.confirm = priorConfirm2; }
  /* the more menu: context viewer */
  click(q('#hk-more'));
  click(q('#hk-more-menu button[data-act="context"]'));
  await until(() => q('#hk-thread .hk-viewer'), 'the context viewer');
  assert(/THE RECORD|PENDING CARDS/.test(q('#hk-thread .hk-viewer').textContent), 'the context is the real one');
  /* delete the branch sessions back down */
  click(q('#hk-sess-delete'));
  await until(() => optionsNow() === base + 2, 'deleted', 10000);
  house.state.workerAnswer = priorAnswer;
  click(q('#btn-hk-close'));
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-11c the housekeeper sees the brief, stages a card, Apply changes the page, Undo takes it back', async () => {
  const before = errors.length;
  const sid = await storyId();
  await db.stories.update(sid, { brief: 'Jovan comes home to Ravenwood. Rias is his older sister.' });
  const pages = (await db.messages.list(sid)).filter((m) => !m.hidden && m.role === 'assistant');
  const target = pages[pages.length - 1];
  const ref = '#' + target.id.slice(0, 6);
  const words = target.text.split(/\s+/).slice(0, 3).join(' ');
  let sawBrief = false;
  const priorAnswer = house.state.workerAnswer;
  house.state.workerAnswer = (body, sys) => {
    if (/housekeeper of a cozy tavern/i.test(sys)) {
      const user = String((body.messages || []).map((m) => m.content).join('\n'));
      sawBrief = /Rias is his older sister/.test(user);
      return 'One fix.\n<edits>[{"id":"' + ref + '","find":' + JSON.stringify(words) + ',"replace":"MENDED WORDS","reason":"a test"}]</edits>';
    }
    return priorAnswer(body, sys);
  };
  click(q('#btn-housekeeper'));
  await until(() => !q('#hk-sheet').hidden, 'the housekeeper');
  await until(() => !q('#hk-send').disabled, 'the housekeeper free to be asked', 10000);
  type(q('#hk-input'), 'fix the first words of the last page');
  submit(q('#hk-form'));
  const apply = await until(() => qa('#hk-cards button').find((b) => /^Apply$/i.test(b.textContent.trim())), 'an Apply button on a card, in the cards box', 10000);
  assert(!q('#hk-cards').hidden, 'the cards box shows only now that a card stands');
  assert(sawBrief, 'the housekeeper was shown the brief');
  click(apply);
  await until(async () => /MENDED WORDS/.test((await db.messages.list(sid)).find((m) => m.id === target.id).text), 'the page changed', 10000);
  await until(() => q('#hk-cards').hidden && qa('#hk-thread .hk-receipt').length >= 1, 'the box folds away, a receipt stays in the talk', 10000);
  click(q('#hk-undo'));
  await until(async () => !/MENDED WORDS/.test((await db.messages.list(sid)).find((m) => m.id === target.id).text), 'undo took it back', 10000);
  house.state.workerAnswer = priorAnswer;
  click(q('#btn-hk-close'));
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-13b reset to the house’s defaults: settings go back, connections and stories stay, my own regex rules stay', async () => {
  const before = errors.length;
  await db.settings.set('memoryWindow', 55);
  await db.settings.set('auditEvery', 9);
  await db.settings.set('colourSpeech', false);
  await db.settings.set('theme', 'light');
  const conns = (await db.connections.list()).length;
  const stories = (await db.stories.list()).length;
  const sid = await storyId();
  const stateBefore = await db.settings.get('state:' + sid);
  await openSettings();
  click(q('#btn-reset-settings'));
  await until(() => !q('#reset-note').hidden, 'the reset note');
  eq(await db.settings.get('memoryWindow'), undefined, 'the window is back at its default');
  eq(await db.settings.get('auditEvery'), undefined);
  eq(await db.settings.get('colourSpeech'), undefined);
  eq((await db.connections.list()).length, conns, 'connections stay');
  eq((await db.stories.list()).length, stories, 'stories stay');
  assert(JSON.stringify(await db.settings.get('state:' + sid)) === JSON.stringify(stateBefore), 'the ledger stays');
  const rules = await db.settings.get('regexRules');
  assert(rules.some((r) => r.name === 'Kill the em dash'), 'my own rule stays');
  assert(rules.find((r) => r.id === 'builtin-preset-header').enabled === false, 'a builtin is back at its shipped switch');
  assert(q('#colour-speech').checked && !document.body.classList.contains('plain-speech'), 'the rooms re-read their defaults');
  await closeSettings();
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-14a a thinking storyteller: the thought is kept, and how long it took is shown on the finished page', async () => {
  const before = errors.length;
  house.state.thinkFirst = true;
  type(q('#composer-input'), 'Does she say anything?');
  submit(q('#composer'));
  await until(() => assistantPages().length >= 1 && q('.msg-assistant:last-of-type details.thinking'), 'a thinking block on the finished page', 10000);
  await settled();
  house.state.thinkFirst = false;
  const sid = await storyId();
  const last = (await db.messages.list(sid)).filter((m) => !m.hidden && m.role === 'assistant').pop();
  assert(last.thinking && /weigh the room/.test(last.thinking), 'the thought is kept');
  assert(Number.isFinite(last.thinkingMs) && last.thinkingMs >= 1, 'how long it took is kept: ' + last.thinkingMs);
  const node = q(`.msg[data-id="${last.id}"] details.thinking summary`);
  assert(node && /what the storyteller weighed/.test(node.textContent), 'the block');
  assert(node.querySelector('.thinking-took'), 'the time is on the finished page: ' + node.textContent);
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-14b the second reader mends a drifted page by the smallest edit, and the chip takes it back', async () => {
  const before = errors.length;
  house.state.mend = true;
  house.state.storyAnswer = () => 'Liara looked at Kim, who was not her mother.\n\nThe booth was quiet.';
  type(q('#composer-input'), 'What will your mother think?');
  submit(q('#composer'));
  await until(() => assistantPages().length >= 1 && /Kim/.test(bodyText(assistantPages()[assistantPages().length - 1])), 'the drifted answer', 10000);
  await settled();
  const sid = await storyId();
  const page = await until(async () => (await db.messages.list(sid)).find((m) => m.mended && /Kris/.test(m.text)), 'the mend to land', 15000);
  assert(/Kris, who was not her mother/.test(page.text) && /The booth was quiet\./.test(page.text), 'one word changed, the page kept: ' + page.text);
  eq(page.mended.before, 'Liara looked at Kim, who was not her mother.\n\nThe booth was quiet.');
  /* M43: no chip on the page; the earlier words are a tap away in the drawer */
  assert(!q(`.msg[data-id="${page.id}"] .msg-act.mended`), 'no chip on the page');
  click(q('#btn-ledger')); await until(() => !q('#drawer').hidden, 'drawer'); await tick(400);
  const back = qa('#drawer-panels button').find((b) => /Put the earlier words back/.test(b.textContent));
  assert(back, 'the take-back lives in Something drifted');
  click(back);
  await until(async () => { const m = (await db.messages.list(sid)).find((x) => x.id === page.id); return m && !m.mended && /Kim/.test(m.text); }, 'the earlier words back');
  click(q('#btn-ledger'));
  house.state.mend = false;
  house.state.storyAnswer = null;
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

/* The sweep: press every button the eye can reach, in every room, once.
 * A button that throws, a handler that reaches for an element that isn't
 * there, a menu act with no route — all of it lands here as an error with
 * the button's own words. Runs LAST: it presses destructive things too. */
const visible = (el) => !el.closest('[hidden]') && !el.disabled;
const words = (el) => (el.textContent || el.getAttribute('aria-label') || el.id || el.className).trim().replace(/\s+/g, ' ').slice(0, 40);
const swept = { rooms: {} };
async function sweep(rootSel, { skip = /reload|start over|wipe|forget everything|let the tale go|take the shelf down/i, before } = {}) {
  const found = [];
  let pressed = 0;
  for (const btn of qa(rootSel + ' button')) {
    if (!visible(btn) || skip.test(words(btn))) continue;
    pressed += 1;
    swept.rooms[rootSel] = pressed;
    const label = words(btn);
    const n = errors.length;
    try { click(btn); } catch (err) { errors.push('threw on click: ' + label + ' — ' + err.message); }
    await tick(40);
    if (errors.length > n) found.push(label + ' → ' + errors.slice(n).join(' | '));
  }
  return found;
}

test('DOM-15 the sweep: every button in the story room, the drawer, the settings rooms, the housekeeper and the message menu answers without a sound', async () => {
  /* the message menu (long-press / right-click) */
  const page = assistantPages()[0] || userPages()[0];
  page.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
  await tick(50);
  const menuAll = [];
  if (!q('#msg-menu').hidden) {
    for (const btn of qa('#msg-menu button[data-act]')) {
      if (/regenerate|delete|go on|try again/.test(btn.dataset.act)) continue; /* each proven above; they generate */
      const n = errors.length; click(btn); await tick(40);
      if (errors.length > n) menuAll.push(btn.dataset.act + ' → ' + errors.slice(n).join(' | '));
      page.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      await tick(30);
    }
    if (!q('#msg-menu').hidden) document.body.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  }
  eq(menuAll.length, 0, 'menu: ' + menuAll.join(' || '));
  /* the drawer, every panel's hand controls (empty forms just return) */
  click(q('#btn-ledger')); await until(() => !q('#drawer').hidden, 'drawer');
  await tick(400); /* the panels render async (latestWins) — let every form unhide */
  for (const d of qa('#drawer-panels details')) d.open = true;
  const drawerHits = await sweep('#drawer-panels', { skip: /take it back|let it go|let it rest|un-invite|×/i });
  eq(drawerHits.length, 0, 'drawer: ' + drawerHits.join(' || '));
  if (!q('#drawer').hidden) click(q('#btn-ledger'));
  /* the housekeeper */
  click(q('#btn-housekeeper')); await tick(300);
  const hkHits = await sweep('#housekeeper, .hk-body, [id^="hk-"]', { skip: /send|ask/i });
  eq(hkHits.length, 0, 'housekeeper: ' + hkHits.join(' || '));
  click(q('#btn-housekeeper')); await tick(40);
  /* the story room: panel, shelf, composer chips */
  const roomHits = await sweep('#view-chat', { skip: /send|go on|try again|swipe|branch|delete|regenerate|the ledger|the housekeeper|settings/i });
  eq(roomHits.length, 0, 'story room: ' + roomHits.join(' || '));
  /* settings, every room, every control */
  await openSettings();
  const settingsHits = await sweep('#view-settings', { skip: /bring a copy back|back to the story|let it go|remove|take the shelf down|forget|start over|reload|test it/i });
  eq(settingsHits.length, 0, 'settings: ' + settingsHits.join(' || '));
  await closeSettings();
  const total = Object.values(swept.rooms).reduce((a, b) => a + b, 0);
  console.log('     pressed', JSON.stringify(swept.rooms), 'total', total);
  assert(total >= 60, 'the sweep pressed enough buttons to mean something: ' + total);
});

test('DOM-16 nothing leaked: zero errors across the whole walk', () => {
  eq(errors.length, 0, errors.join(' | '));
});

console.log('Cozy Tavern — the dom walk');
await runAll();
process.exit(process.exitCode || 0);
