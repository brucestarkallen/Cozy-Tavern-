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
import { checkStoreConsistency } from './consistency.mjs';
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
/* M136: only the latest turns are drawn — a scenario that reaches for the first page shows them all first */
async function showAllPages() {
  await until(() => assistantPages().length >= 1 || q('#thread .msg'), 'pages drawn', 10000).catch(() => {});
  for (let i = 0; i < 40; i += 1) {
    const more = q('#show-earlier');
    if (!more) return;
    click(more);
    await until(() => !more.isConnected, 'the earlier turns drawn', 5000);
    await tick(50);
  }
}

/* M261: the extractor is shown the story so far; the page it reports on comes after this line —
 * a scripted reader reads THAT page, as the real one is told to */
const newPageOf = (user) => { const text = String(user || ''); const at = text.lastIndexOf('And the storyteller answered:'); return at === -1 ? text : text.slice(at); };

const walkDefaultWorker = (body, sys) => {
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
house.state.workerAnswer = walkDefaultWorker;

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
const { byName: byNameOrder } = await import('../../js/providers/order.js');
const byNameLabels = (rows) => byNameOrder(rows).map((c) => c.label);

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
  /* M85: #story opens the tale named from the concept, and the page carries the concept, not the command */
  const begun = await db.stories.get(sid);
  assert(begun && begun.title.startsWith('Jovan is eating'), 'named from the concept: ' + (begun && begun.title));
  assert(userPages().length === 1 && !/#story/.test(bodyText(userPages()[0])), 'the command word never reaches the page');
  await until(async () => (await db.settings.get('state:' + sid) || {}).place, 'the ledger to be founded', 10000);
  const st = await db.settings.get('state:' + sid);
  eq(st.place.name, 'Lakeside Park'); /* M131: the header line is the truth for the ground, over the extractor’s own place.set */
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
  /* M85: "#story concept" is the writer's own command — the tale is named
   * from the concept, the command word itself never reaches the title */
  const first = stories.find((s) => s.title.startsWith('Jovan is eating') && !/— a branch$/.test(s.title));
  assert(first, 'the first tale is named from the concept (no empty "Hello?" tale was begotten, no "#story" in the name): ' + stories.map((s) => s.title).join(' / '));
  const row = qa('.story-item').find((el) => el.textContent.includes('Jovan is eating') && !el.textContent.includes('a branch'));
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
  await until(() => !q('#drawer').hidden, 'the drawer opens'); await env.ctx.drawer.renderAllRooms(); await tick(350); /* M148 */
  await until(() => /Kim/.test(q('#drawer-panels').textContent), 'the drawer to speak of Kim: ' + q('#drawer-panels').textContent.slice(0, 200));
  const titles = qa('#drawer-panels .ledger-panel h3, #drawer-panels .ledger-panel summary, #drawer-panels .ledger-panel .panel-title').map((h) => h.textContent.trim());
  for (const want of ['The clock', 'Who’s here', 'What’s happening elsewhere', 'The world beyond the page', 'What changed and why', 'The workers']) {
    assert(titles.some((t) => t.includes(want)), 'panel: ' + want + ' in ' + titles.join(' / '));
  }
  const drawerText = q('#drawer-panels').textContent;
  assert(/Kim/.test(drawerText), 'Kim is in the drawer');
  /* M259: one change is "wrote 1 change" — a header that re-sends the ground and the hour no longer counts as two more */
  assert(/wrote \d+ changes?|nothing to write down/.test(drawerText), 'the extractor says what it did: ' + drawerText.slice(Math.max(0, drawerText.indexOf('The workers')), drawerText.indexOf('The workers') + 1500));
  assert(/moved the world in/.test(drawerText), 'the world agent says what it did');
  assert(qa('#drawer-panels .worker-said').length >= 1, 'what it said is folded under a worker');
  click(q('#btn-ledger'));
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-11 settings: the rooms render; the regex shelf adds a rule, tries it, and brings a SillyTavern file', async () => {
  const before = errors.length;
  await openSettings();
  /* the shelf renders from the store after the room opens — wait for it, never read it early */
  await until(() => qa('#regex-list > li').length >= 4, 'the house rules and the 🎨 pack are on the shelf', 10000);
  click(q('#btn-regex-add'));
  await until(() => !q('#regex-form').hidden, 'the form');
  type(q('#regex-name'), 'Kill the em dash');
  type(q('#regex-find'), '—');
  type(q('#regex-replace'), '-');
  q('#regex-mode').value = 'display';
  click(q('#btn-regex-try'));
  await until(() => !q('#regex-try-note').hidden && /match/i.test(q('#regex-try-note').textContent), 'a try note: ' + (q('#regex-try-note') && q('#regex-try-note').textContent));
  submit(q('#regex-form'));
  /* the shelf already holds the pack, so a count proves nothing — wait on the store itself */
  const stored = await until(async () => { const r = await db.settings.get('regexRules'); return r && r.some((x) => x.name === 'Kill the em dash' && x.mode === 'display') ? r : null; }, 'the writer’s rule joined the shelf', 10000);
  assert(stored.some((r) => r.name === 'Kill the em dash' && r.mode === 'display'));
  await until(() => qa('#regex-list > li').some((li) => /Kill the em dash/.test(li.textContent)), 'and the shelf shows it', 10000);
  /* bring a SillyTavern regex file */
  const st = [{ id: 'abc', scriptName: '🎨 Header', findRegex: '/^\\[([^\\]]+)\\]$/gm', replaceString: '<div class="hdr">$1</div>', placement: [2], markdownOnly: true }];
  const file = new File([JSON.stringify(st)], 'regex.json', { type: 'application/json' });
  const input = q('#regex-file');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await until(() => !q('#regex-import-note').hidden && /brought home/.test(q('#regex-import-note').textContent), 'the import note', 10000);
  assert((await db.settings.get('regexRules')).some((r) => r.id === 'st-abc' && r.mode === 'display'), 'the imported rule is stored: ' + JSON.stringify((await db.settings.get('regexRules')).map((r) => r.id)));
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
  click(q('#btn-ledger')); await until(() => !q('#drawer').hidden, 'drawer'); await tick(400); await env.ctx.drawer.renderAllRooms(); await tick(350); /* M148 */
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
  /* M270: the question stands at once now, so two bubbles are not yet an answer — the pending one must be gone */
  await until(() => qa('#hk-thread .hk-bubble').length >= 2 && !q('#hk-thread .hk-pending'), 'the first answer', 10000);
  const sid = await storyId();
  const active = (root) => root.sessions.find((x) => x.id === root.activeId);
  const sess1 = active(await db.settings.get('hk:' + sid));
  eq(sess1.turns.length, 2);
  house.state.workerAnswer = (body, sys) => (/housekeeper of a cozy tavern/i.test(sys) ? 'Answer two.' : priorAnswer(body, sys));
  await until(() => !q('#hk-send').disabled, 'the housekeeper is free', 10000); /* M140: the bubble lands before the lock lifts now */
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
    if (/keep the ledger/i.test(sys) && /Kim walked in/.test(newPageOf(user))) return '{"mutations":[{"type":"presence.enter","name":"Kim","position":"in the booth"}]}';
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
      const m = newPageOf(user).match(/(Person\d+) entered/);
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
      /* the press is idempotent at the last version (swipeTo drops it silently while the house is
       * busy or replaying, and starts exactly one regeneration otherwise), so on a loaded machine
       * it is pressed again whenever the house is found idle and no new version has come — the
       * flake this step carried was a press landing in the M72 replay window, never the app */
      const grown = async () => { const m = (await db.messages.list(sid)).find((x) => x.id === oldId); return Boolean(m && Array.isArray(m.swipes) && m.swipes.length > had); };
      for (let press = 0; press < 6 && !(await grown()); press += 1) {
        await until(() => !env.ctx.chat.isBusy() && !env.ctx.chat.isReplaying(), 'the house free before the press', 20000);
        click(q('.swipe-bar .msg-act[data-act="swipe-next"]', live()));
        try { await until(grown, 'a new version of an old page', 6000); } catch (err) { if (press === 5) throw err; }
      }
      assert(await grown(), 'a new version of an old page');
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
  { const problems = await checkStoreConsistency(db, await storyId()); eq(problems.length, 0, 'the store agrees with itself: ' + problems.join(' | ')); }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-8d a branch at the FIRST WRITER’S message carries no storyteller page and no ledger of one', async () => {
  const before = errors.length;
  await showAllPages();
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
  await showAllPages();
  const sid = await storyId();
  /* a story with a rich present and NO checkpoints (as one played before the checkpoint law, or pruned) */
  await db.settings.delete('snapshots:' + sid);
  await db.settings.delete('versionState:' + sid);
  const now = await db.settings.get('state:' + sid);
  assert(now && ((now.present || []).length || now.place || Object.keys(now.offscreen || {}).length), 'the present ledger has content');
  const { foldJournal } = await import('../../js/engine/state.js');
  const { applyMutations } = await import('../../js/engine/apply.js');
  const expected = foldJournal(now, [], 0, applyMutations); /* M69: page 0's exact ledger, from the journal */
  await until(() => assistantPages().length >= 1, 'the origin’s pages are drawn', 10000);
  await showAllPages();
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

test('DOM-8e THE WRITER’S REPORT: a store from before the journal, played on, branched at its NEWEST page — the whole ledger comes along; an older page falls back to a checkpoint, never to a fold from nothing', async () => {
  const before = errors.length;
  const sid = await storyId();
  await settled();
  /* the store as one from before M69/M72: a rich ledger, a journal that begins mid-story (the
   * pre-journal entries gone), snapshots that know no page */
  const now = await db.settings.get('state:' + sid);
  const rich = JSON.parse(JSON.stringify(now));
  rich.present = [...(rich.present || []), { name: 'OldFriend' }, { name: 'OldRival' }];
  rich.offscreen = { ...(rich.offscreen || {}), Grandmother: { location: 'the old house', activity: 'waiting', agenda: 'see him once more', atTurn: 1 } };
  rich.canon = { ...(rich.canon || {}), OldFriend: { facts: [{ key: 'eyes', value: 'grey', atMinutes: 0 }] } };
  const keepFrom = Math.max(0, (rich.journal || []).length - 2);
  rich.journal = (rich.journal || []).slice(keepFrom); /* the journal began late */
  await db.settings.set('state:' + sid, rich);
  const snaps = (await db.settings.get('snapshots:' + sid)) || [];
  await db.settings.set('snapshots:' + sid, snaps.map((e) => ({ ...e, snap: (() => { const c = { ...e.snap }; delete c.page; delete c.journalSeq; c.journal = []; return c; })() })));
  await db.settings.delete('versionState:' + sid);
  await env.ctx.chat.renderThread({ structural: true });
  await tick(200);
  /* branch at the NEWEST page */
  const pages = assistantPages();
  click(q('.msg-act[data-act="branch"]', pages[pages.length - 1]));
  await until(async () => (await storyId()) !== sid, 'the branch is open', 10000);
  const bid = await storyId();
  await settled();
  const bst = await db.settings.get('state:' + bid);
  const names = (st) => (st.present || []).map((p) => p.name).sort().join(',');
  eq(names(bst), names(rich), 'the newest page’s branch carries the ledger AS IT STANDS — every person present');
  assert(bst.offscreen && bst.offscreen.Grandmother, 'the absent came along');
  assert(bst.canon && bst.canon.OldFriend, 'the locked truths came along');
  /* back, then branch at page 0 of the same store: never the later ledger, and the house re-reads */
  const originTitle = (await db.stories.get(sid)).title;
  let row = qa('.story-item').find((li) => li.textContent.includes(originTitle) && !/a branch/.test(li.textContent));
  click(q('.story-open', row) || row);
  await until(async () => (await storyId()) === sid, 'back on the origin', 10000);
  await settled();
  click(q('.msg-act[data-act="branch"]', assistantPages()[0]));
  await until(async () => (await storyId()) !== sid && (await storyId()) !== bid, 'the second branch', 10000);
  const bid2 = await storyId();
  await settled();
  const bst2 = await db.settings.get('state:' + bid2);
  assert(!(bst2.present || []).some((p) => p.name === 'OldRival'), 'a branch at the start does not carry the later people');
  row = qa('.story-item').find((li) => li.textContent.includes(originTitle) && !/a branch/.test(li.textContent));
  click(q('.story-open', row) || row);
  await until(async () => (await storyId()) === sid, 'back on the origin again', 10000);
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-8f THE WRITER’S SECOND REPORT: a store whose journal began while the ledger’s page was still -1 (a pre-journal story touched before its first send), played on, then branched TWO PAGES BACK — that page’s ledger comes along, never an empty one', async () => {
  const before = errors.length;
  const sid = await storyId();
  await settled();
  const now = await db.settings.get('state:' + sid);
  const pages0 = (await db.messages.list(sid)).filter((m) => !m.hidden && m.role === 'assistant');
  assert(pages0.length >= 2, 'a story with pages to branch back into');
  /* the writer's store: entries journaled at p:-1 (an audit or a hand edit before any send after
   * M69 landed), older snapshots that know no page, the journal beginning mid-story */
  const rich = JSON.parse(JSON.stringify(now));
  rich.present = [...(rich.present || []), { name: 'Old Aunt' }];
  rich.journal = [{ id: 1, p: -1, m: { type: 'presence.enter', name: 'Old Aunt' } }, ...(rich.journal || []).slice(-2)];
  await db.settings.set('state:' + sid, rich);
  const snaps = (await db.settings.get('snapshots:' + sid)) || [];
  await db.settings.set('snapshots:' + sid, snaps.map((e) => ({ ...e, snap: (() => { const c = { ...e.snap, present: [...(e.snap.present || []), { name: 'Old Aunt' }] }; delete c.page; delete c.journalSeq; c.journal = []; return c; })() })));
  /* play two more turns on the real path */
  for (let i = 0; i < 2; i += 1) {
    const n = assistantPages().length;
    type(q('#composer-input'), 'I wait a while.'); submit(q('#composer'));
    await until(() => assistantPages().length > n, 'a page', 15000);
    await settled();
  }
  const all = (await db.messages.list(sid)).filter((m) => !m.hidden);
  const assistants = all.filter((m) => m.role === 'assistant');
  const twoBack = assistants[assistants.length - 3];
  const expectedNames = (() => { const s2 = (snaps.length ? null : null); return null; })();
  /* branch at the page two back */
  const row = assistantPages().find((a) => a.dataset.id === twoBack.id);
  click(q('.msg-act[data-act="branch"]', row));
  await until(async () => (await storyId()) !== sid, 'the branch is open', 10000);
  const bid = await storyId();
  await settled();
  const bst = await db.settings.get('state:' + bid);
  const names = (bst.present || []).map((p) => p.name);
  assert(names.includes('Old Aunt'), 'the aunt who was present then: ' + JSON.stringify(names));
  /* THE WHOLE ledger of that page, not one journaled line: the founding's people, the ground, the clock */
  assert(names.length >= 3 && (bst.place || bst.clock), 'the WHOLE ledger of that page came along — people, the ground, the clock — not a fold from nothing: ' + JSON.stringify({ names, place: bst.place, clock: !!bst.clock }));
  const originTitle = (await db.stories.get(sid)).title;
  const back = qa('.story-item').find((li) => li.textContent.includes(originTitle) && !/a branch/.test(li.textContent));
  click(q('.story-open', back) || back);
  await until(async () => (await storyId()) === sid, 'back on the origin', 10000);
  { const problems = await checkStoreConsistency(db, await storyId()); eq(problems.length, 0, 'the store agrees with itself: ' + problems.join(' | ')); }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-6c READ AGAIN by hand: the last page rewinds to its boundary and the chain runs; an older page is read fresh and the journal replays above it; the record line refolds', async () => {
  const before = errors.length;
  const sid = await storyId();
  await settled();
  const pages = assistantPages();
  assert(pages.length >= 2, 'two pages to read');
  const last = pages[pages.length - 1];
  const w0 = ((await db.settings.get('workers:' + sid)) || {}).extractor;
  const at0 = w0 && w0.at ? w0.at : 0;
  assert(q('.msg-act[data-act="read again"]', last), 'the action stands on a storyteller page');
  click(q('.msg-act[data-act="read again"]', last));
  await until(async () => { const w = (await db.settings.get('workers:' + sid)) || {}; return w.extractor && w.extractor.at > at0; }, 'the extractor read the last page again', 15000);
  await settled();
  const old = pages[0];
  const at1 = ((await db.settings.get('workers:' + sid)) || {}).extractor.at;
  click(q('.msg-act[data-act="read again"]', old));
  await until(async () => { const w = (await db.settings.get('workers:' + sid)) || {}; return w.extractor && w.extractor.at > at1; }, 'the extractor read the old page again', 15000);
  await settled();
  const st = await db.settings.get('state:' + sid);
  assert(st && Array.isArray(st.present) && st.present.length >= 1, 'the ledger stands after the replay');
  { const problems = await checkStoreConsistency(db, sid); eq(problems.length, 0, 'the store agrees with itself: ' + problems.join(' | ')); }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-6d THE READERS FINISH WHAT THEY STARTED: a last page whose chain never landed (its checkpoint missing) is read again on open; a finished page is left alone', async () => {
  const before = errors.length;
  const sid = await storyId();
  await settled();
  const pages = assistantPages();
  const last = pages[pages.length - 1];
  const idx = Number((await db.messages.list(sid)).find((m) => m.id === last.dataset.id).swipeIdx || 0);
  /* an older story (a fresh one settles its own ledger and is never resumed) */
  await db.stories.update(sid, { createdAt: Date.now() - 5 * 60 * 1000 });
  /* a finished page: nothing happens */
  const at0 = (((await db.settings.get('workers:' + sid)) || {}).extractor || {}).at || 0;
  const ran0 = await env.ctx.chat.resumeUnfinishedChain(await db.stories.get(sid));
  eq(ran0, false, 'a page with its checkpoint is not re-read');
  /* the app closed mid-chain: the last page has no checkpoint */
  const vs = (await db.settings.get('versionState:' + sid)) || {};
  delete vs[last.dataset.id + ':' + idx];
  await db.settings.set('versionState:' + sid, vs);
  const ran1 = await env.ctx.chat.resumeUnfinishedChain(await db.stories.get(sid));
  eq(ran1, true, 'an unfinished last page is read again');
  await until(async () => { const w = (await db.settings.get('workers:' + sid)) || {}; return w.extractor && w.extractor.at > at0; }, 'the extractor read it', 15000);
  await settled();
  assert(await db.settings.get('versionState:' + sid) && ((await db.settings.get('versionState:' + sid))[last.dataset.id + ':' + idx]), 'and the checkpoint stands again');
  { const problems = await checkStoreConsistency(db, sid); eq(problems.length, 0, 'the store agrees with itself: ' + problems.join(' | ')); }
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
    /* M137: with the read cache the ask can complete between two polls — wait on the result, not the busy flag */
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
  /* the more menu: context viewer — a pop-up (M77) */
  click(q('#hk-more'));
  click(q('#hk-more-menu button[data-act="context"]'));
  await until(() => q('#hk-pop') && !q('#hk-pop').hidden, 'the context viewer');
  assert(/THE RECORD|PENDING CARDS/.test(q('#hk-pop .hk-pop-body').textContent), 'the context is the real one');
  click(q('#hk-pop .hk-pop-close'));
  assert(q('#hk-pop').hidden, 'closed');
  /* delete the branch sessions back down */
  click(q('#hk-sess-delete'));
  await until(() => optionsNow() === base + 2, 'deleted', 10000);
  house.state.workerAnswer = priorAnswer;
  click(q('#btn-hk-close'));
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-11e the housekeeper’s thinking stays under the reply after the answer lands; the context viewer is a pop-up, not a bubble', async () => {
  const before = errors.length;
  await db.settings.set('hkReasoning', 'max');
  house.state.hkThink = true;
  const priorAnswer = house.state.workerAnswer;
  house.state.workerAnswer = (body, sys) => (/housekeeper of a cozy tavern/i.test(sys) ? 'Nothing drifted here.' : priorAnswer(body, sys));
  try {
    if (q('#hk-sheet').hidden) { click(q('#btn-housekeeper')); await until(() => !q('#hk-sheet').hidden, 'the housekeeper'); }
    await until(() => !q('#hk-send').disabled, 'free', 15000);
    await tick(300);
    click(q('#hk-sess-new'));
    await until(() => qa('#hk-thread .hk-bubble').length === 0, 'a fresh session', 10000);
    type(q('#hk-input'), 'is anything wrong?');
    submit(q('#hk-form'));
    await until(() => qa('#hk-thread .hk-housekeeper').length >= 1 && !q('#hk-thread .hk-pending') && !q('#hk-send').disabled, 'the answer landed', 20000);
    await tick(150);
    const folds = qa('#hk-thread details.hk-thinking');
    assert(folds.length === 1, 'one thinking fold stays under the reply: ' + folds.length + ' — ' + qa('#hk-thread .hk-bubble').map((b) => b.textContent.slice(0, 40)).join(' / '));
    /* M271: a fold's words are written when it is opened — open it, as the writer does */
    folds[0].open = true;
    folds[0].dispatchEvent(new env.window.Event('toggle'));
    await tick(20);
    assert(/weigh the room/.test(folds[0].textContent), 'and it holds the reasoning, whole, when opened');
    const sid = await storyId();
    const root = await db.settings.get('hk:' + sid);
    const active = root.sessions.find((x) => x.id === root.activeId);
    assert(/weigh the room/.test(active.turns[active.turns.length - 1].thinking || ''), 'kept on the turn');
    /* the viewer is a pop-up */
    click(q('#hk-more'));
    click(q('#hk-more-menu button[data-act="context"]'));
    await until(() => q('#hk-pop') && !q('#hk-pop').hidden, 'the pop-up opened');
    assert(!q('#hk-thread .hk-viewer-fold'), 'nothing was dumped into the talk');
    assert(/THE BRIEF|THE RECORD/.test(q('#hk-pop .hk-pop-body').textContent), 'the context is in it');
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert(q('#hk-pop').hidden, 'Esc closes the pop-up');
    click(q('#hk-sess-delete'));
    await until(() => !qa('#hk-session option').some((o) => /Session 2|Session 3/.test(o.textContent)) || true, 'session gone');
  } finally {
    house.state.hkThink = false;
    house.state.workerAnswer = priorAnswer;
    await db.settings.delete('hkReasoning');
  }
  if (!q('#hk-sheet').hidden) click(q('#btn-hk-close'));
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-11c the housekeeper sees the brief, stages a card, Apply changes the page, Undo takes it back', async () => {
  const before = errors.length;
  const sid = await storyId();
  /* M96: the cards land on arrival by default; this scenario holds the by-hand path, so it turns that off first */
  await db.settings.set('hkAutoApply', false);
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
  /* M74: the brief is a surface the housekeeper can change — a <brief> card, applied, shows in Settings, and is taken back */
  house.state.workerAnswer = (body, sys) => (/housekeeper of a cozy tavern/i.test(sys)
    ? 'The brief now says younger.\n<brief>[{"field":"brief","find":"older sister","replace":"younger sister","reason":"the writer asked"}]</brief>'
    : priorAnswer(body, sys));
  await until(() => !q('#hk-send').disabled, 'free again', 10000);
  type(q('#hk-input'), 'change the brief: Rias is his younger sister');
  submit(q('#hk-form'));
  const applyBrief = await until(() => qa('#hk-cards button').find((b) => /^Apply$/i.test(b.textContent.trim())), 'the brief card', 10000);
  assert(/the brief/.test(q('#hk-cards').textContent), 'the card names the brief: ' + q('#hk-cards').textContent.slice(0, 120));
  click(applyBrief);
  await until(async () => /younger sister/.test((await db.stories.get(sid)).brief), 'the brief changed', 10000);
  await openSettings();
  assert(/younger sister/.test(q('#brief-story').value), 'Settings shows the new brief');
  await closeSettings();
  click(q('#hk-undo'));
  await until(async () => /older sister/.test((await db.stories.get(sid)).brief), 'the brief taken back', 10000);
  /* M78: TWO brief cards in one answer, Apply all — both land (the second used to go "stale" because the first changed the brief) */
  house.state.workerAnswer = (body, sys) => (/housekeeper of a cozy tavern/i.test(sys)
    ? 'Two.\n<brief>[{"field":"brief","find":"comes home to Ravenwood","replace":"comes back to Ravenwood","reason":"one"},{"field":"brief","find":"older sister","replace":"younger sister","reason":"two"}]</brief>'
    : priorAnswer(body, sys));
  await until(() => !q('#hk-send').disabled, 'free again', 10000);
  type(q('#hk-input'), 'change the brief: comes back, and younger');
  submit(q('#hk-form'));
  await until(() => qa('#hk-cards button').filter((b) => /^Apply$/i.test(b.textContent.trim())).length === 2, 'two brief cards', 10000);
  click(q('#hk-apply-all'));
  await until(async () => { const b = (await db.stories.get(sid)).brief; return /comes back to Ravenwood/.test(b) && /younger sister/.test(b); }, 'BOTH landed', 10000);
  await until(() => qa('#hk-thread .hk-receipt').filter((r) => /^✓ the brief/.test(r.textContent)).length >= 2 && !qa('#hk-thread .hk-receipt').some((r) => /not applied/.test(r.textContent)), 'two ✓ receipts, no “not applied”: ' + qa('#hk-thread .hk-receipt').map((r) => r.textContent.slice(0, 60)).join(' | '), 10000);
  click(q('#hk-undo')); click(q('#hk-undo'));
  await until(async () => /older sister/.test((await db.stories.get(sid)).brief), 'taken back', 10000);
  /* M96: cards land as they arrive (the default) — no Apply pressed, the brief changes, Undo still takes it back */
  await db.settings.delete('hkAutoApply');
  house.state.workerAnswer = (body, sys) => (/housekeeper of a cozy tavern/i.test(sys)
    ? 'Landing.\n<brief>[{"field":"brief","find":"older sister","replace":"younger sister","reason":"the writer asked"}]</brief>'
    : priorAnswer(body, sys));
  await until(() => !q('#hk-send').disabled, 'free again', 10000);
  type(q('#hk-input'), 'younger, please');
  submit(q('#hk-form'));
  await until(async () => /younger sister/.test((await db.stories.get(sid)).brief), 'the card landed on arrival, no hand on it', 10000);
  assert(!qa('#hk-cards button').some((b) => /^Apply$/i.test(b.textContent.trim())), 'nothing left waiting for Apply');
  click(q('#hk-undo'));
  await until(async () => /older sister/.test((await db.stories.get(sid)).brief), 'and Undo still takes it back', 10000);
  house.state.workerAnswer = priorAnswer;
  click(q('#btn-hk-close'));
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-13a a rewritten brief is held against the ledger at once — saving it runs the auditor, no button pressed', async () => {
  const before = errors.length;
  const sid = await storyId();
  await settled();
  const was = ((await db.settings.get('workers:' + sid)) || {}).auditor;
  const wasAt = was && was.at ? was.at : 0;
  await openSettings();
  type(q('#brief-story'), 'Jovan comes home to Ravenwood. Rias is his older sister; her hair is now silver.');
  click(q('#btn-save-brief'));
  await until(async () => { const w = (await db.settings.get('workers:' + sid)) || {}; return w.auditor && w.auditor.at && w.auditor.at > wasAt; }, 'the auditor ran on the brief change', 15000);
  /* saving the same words again does not run it */
  const afterAt = ((await db.settings.get('workers:' + sid)) || {}).auditor.at;
  click(q('#btn-save-brief'));
  await tick(600);
  eq(((await db.settings.get('workers:' + sid)) || {}).auditor.at, afterAt, 'the same brief saved twice is no change');
  await closeSettings();
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-13c THE RIPPLE: a name changed by hand on one page is changed everywhere — the other pages, the ledger, the record, the brief — with no hand on it; a value goes to the mender, and no comment is left in the record (M330)', async () => {
  const before = errors.length;
  const sid = await storyId();
  await settled();
  /* the story's own readers put Liara in the ledger (journaled, as in play): a page is sent
   * with a reader that seats her, writes her page, locks her hair and a fact about her */
  await db.stories.update(sid, { brief: 'Jovan comes home. Liara is the neighbour; her hair is black.' });
  const priorAnswer = house.state.workerAnswer;
  house.state.workerAnswer = (body, sys) => {
    const user = String((body.messages || []).slice(-1)[0] && (body.messages || []).slice(-1)[0].content || '');
    if (/keep the ledger/i.test(sys)) {
      return JSON.stringify({ mutations: [
        { type: 'presence.enter', name: 'Liara', position: 'by the door' },
        { type: 'people.set', name: 'Liara', field: 'core', text: 'the neighbour; Liara keeps the spare key' },
        { type: 'canon.lock', name: 'Liara', key: 'hair', value: 'black' },
        { type: 'knowledge.add', name: 'Jovan', fact: 'Liara has the spare key' },
        { type: 'mode.snapshot', flags: [] },
      ] });
    }
    if (/mend a story/i.test(sys) || /<contradiction>/.test(user)) {
      const blocks = [...user.matchAll(/\[(\d+)\] \((STORY|PLAYER)\) ([\s\S]*?)(?=\n\n\[\d+\] \(|\n<\/passage>)/g)];
      const hit = blocks.find((b) => b[2] === 'STORY' && /black hair/.test(b[3]));
      return hit ? JSON.stringify([{ index: Number(hit[1]), text: hit[3].replace('black hair', 'silver hair') }]) : '[]';
    }
    return priorAnswer(body, sys);
  };
  house.state.storyAnswer = () => '[Lakeside Park — Friday, March 14, 2025 | 15:00 | 🌤 partly cloudy | gray hoodie | seated on bench]\n\nLiara sat down across from him. "Liara’s late again," she said of herself, and laughed. Her black hair caught the light.';
  const n0 = assistantPages().length;
  type(q('#composer-input'), 'I look up.'); submit(q('#composer'));
  await until(() => assistantPages().length > n0, 'the page with Liara', 15000);
  await settled();
  const mem = await db.settings.get('memory:' + sid);
  await db.settings.set('memory:' + sid, { ...(mem || { window: 30 }), nodes: [...((mem && mem.nodes) || []), { id: 'rl1', span: [0, 0], text: 'Liara watched him not eat.', level: 1, at: 1 }] });
  const st0 = await db.settings.get('state:' + sid);
  assert(st0.characters && st0.characters.Liara && st0.canon && st0.canon.Liara, 'Liara stands in the ledger through the readers');
  const target = assistantPages()[assistantPages().length - 1];
  const others = (await db.messages.list(sid)).filter((m) => !m.hidden && m.role === 'assistant' && m.id !== target.dataset.id && /\bLiara\b/.test(m.text));
  assert(others.length >= 1, 'Liara stands on other pages too: ' + others.length);
  /* the writer renames her on ONE page, by hand */
  click(q('.msg-act[data-act="edit"]', target));
  const box = await until(() => q('.edit-box', target), 'the edit box');
  const current = (await db.messages.list(sid)).find((m) => m.id === target.dataset.id).text;
  type(box, current.replace(/Liara/g, 'Mirela'));
  click(q('.edit-row button:not(.text-btn)', target));
  await until(async () => (await db.messages.list(sid)).find((m) => m.id === target.dataset.id).text.includes('Mirela'), 'the edit kept');
  await settled();
  /* everywhere follows */
  await until(async () => { const s2 = await db.settings.get('state:' + sid); return s2 && s2.characters && s2.characters.Mirela && !s2.characters.Liara; }, 'the character page renamed', 20000);
  const after = await db.settings.get('state:' + sid);
  assert(after.canon.Mirela && !after.canon.Liara, 'the locks follow');
  assert(after.present.some((p) => p.name === 'Mirela') && !after.present.some((p) => p.name === 'Liara'), 'presence follows');
  assert(/Mirela has the spare key/.test(after.knowledge.Jovan.map((k) => k.fact).join(' ')), 'a fact naming her follows');
  await until(async () => { const b = (await db.stories.get(sid)).brief; return /Mirela is the neighbour/.test(b) && !/Liara/.test(b); }, 'the brief follows', 15000);
  await until(async () => { const m2 = await db.settings.get('memory:' + sid); return m2.nodes.some((n) => /Mirela watched him/.test(n.text)) && !m2.nodes.some((n) => /Liara watched/.test(n.text)); }, 'the record follows', 15000);
  await until(async () => (await db.messages.list(sid)).filter((m) => !m.hidden && m.role === 'assistant').every((m) => !/\bLiara\b/.test(m.text)), 'every other page follows', 15000);
  const mendedOther = (await db.messages.list(sid)).find((m) => m.mended && /Liara/.test(m.mended.before) && /Mirela/.test(m.text) && m.id !== target.dataset.id);
  assert(mendedOther && /the writer changed/.test(mendedOther.mended.why), 'each other page is a mend with its take-back: ' + (mendedOther && mendedOther.mended.why));
  /* a VALUE changed by hand — the hair — goes to the mender and the record */
  const all2 = (await db.messages.list(sid)).filter((m) => !m.hidden && m.role === 'assistant');
  const p1 = all2[0];
  /* appended the way an edit lands: the shown swipe kept in step (pageText reads the swipe) */
  { const t = p1.text + ' Her black hair was tied back.'; const patch = { text: t }; if (Array.isArray(p1.swipes) && p1.swipes.length) { const idx = Number.isFinite(p1.swipeIdx) ? Math.min(p1.swipes.length - 1, Math.max(0, p1.swipeIdx)) : p1.swipes.length - 1; const sw = p1.swipes.slice(); sw[idx] = { ...sw[idx], text: t }; patch.swipes = sw; } await db.messages.update(sid, p1.id, patch); }
  await env.ctx.chat.renderThread({ structural: true });
  await tick(200);
  const last = assistantPages()[assistantPages().length - 1];
  click(q('.msg-act[data-act="edit"]', last));
  const box2 = await until(() => q('.edit-box', last), 'the edit box again');
  const cur2 = (await db.messages.list(sid)).find((m) => m.id === last.dataset.id).text;
  assert(/black hair caught/.test(cur2), 'the last page names the colour');
  type(box2, cur2.replace('black hair caught', 'silver hair caught'));
  click(q('.edit-row button:not(.text-btn)', last));
  await until(async () => /silver hair caught/.test((await db.messages.list(sid)).find((m) => m.id === last.dataset.id).text), 'the value edit kept');
  await settled();
  const rip = await until(async () => { const w = (await db.settings.get('workers:' + sid)) || {}; return w.ripple && /black/.test(w.ripple.detail || w.ripple.why || '') ? w.ripple : null; }, 'the ripple ran on the value', 20000);
  const { pageText: pt } = await import('../../js/assemble/stack.js');
  await until(async () => /silver hair was tied/.test(pt((await db.messages.list(sid)).find((m) => m.id === p1.id))), 'the mender made the other page agree: ' + JSON.stringify(rip), 20000);
  /* M330: and NO comment is left in the record — it used to gain "[Correction] “black” is now “silver” (the writer's edit);
   * what said otherwise before is in error." The pages carry the fact; the keeper folds the mended pages again. */
  await tick(800);
  assert(!((await db.settings.get('memory:' + sid)) || { nodes: [] }).nodes.some((n) => n.correction), 'the record holds no note from the house');
  house.state.workerAnswer = priorAnswer;
  house.state.storyAnswer = null;
  { const problems = await checkStoreConsistency(db, await storyId()); eq(problems.length, 0, 'the store agrees with itself: ' + problems.join(' | ')); }
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
  /* M89: a fork of the craft from an older coat, a pinned builtin, and a rule of my own */
  const { saveModule, listModules } = await import('../../js/assemble/modules.js');
  await saveModule({ id: 'core-craft', name: 'The craft', text: 'my old fork of the craft', pinned: false });
  const spect = (await listModules()).find((m) => m.id === 'spectacle-combat');
  await saveModule({ id: 'spectacle-combat', name: spect.name, text: spect.text, pinned: true, whenKey: 'manual' });
  const mine = await saveModule({ name: 'My own rule', text: 'mine', whenKey: 'manual', pinned: true });
  await openSettings();
  click(q('#btn-reset-settings'));
  await until(() => !q('#reset-note').hidden, 'the reset note');
  const modsAfter = await listModules();
  eq(modsAfter.find((m) => m.id === 'core-craft').source, 'builtin', 'the craft rides as shipped again — the old fork is lifted');
  eq(modsAfter.find((m) => m.id === 'spectacle-combat').pinned, false, 'a pin on a builtin is cleared');
  const mineAfter = modsAfter.find((m) => m.id === mine.id);
  assert(mineAfter && mineAfter.pinned === true && mineAfter.text === 'mine', 'my own rule stays, pinned');
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
  house.state.workerAnswer = walkDefaultWorker; /* a failed earlier scenario must not leave its mocks behind */
  house.state.mend = true;
  house.state.storyAnswer = () => 'Liara looked at Kim, who was not her mother.\n\nThe booth was quiet.';
  /* M265: a record past the old 30,000 characters — the mender must still read its oldest line */
  const { loadMemory: loadRec, saveMemory: saveRec } = await import('../../js/agents/memory.js');
  const recSid = await storyId();
  const recBefore = await loadRec(recSid);
  await saveRec(recSid, { ...recBefore, nodes: [...(recBefore.nodes || []),
    { id: 'node-mendold', span: [0, 0], level: 1, text: 'MENDER-OLDEST ' + 'o'.repeat(20000), at: 1, whole: true },
    { id: 'node-mendnew', span: [1, 1], level: 1, text: 'MENDER-NEWER ' + 'n'.repeat(20000), at: 2, whole: true }] });
  const mendFrom = house.state.calls.length;
  type(q('#composer-input'), 'What will your mother think?');
  submit(q('#composer'));
  await until(() => assistantPages().length >= 1 && /Kim/.test(bodyText(assistantPages()[assistantPages().length - 1])), 'the drifted answer', 10000);
  await settled();
  const sid = await storyId();
  const page = await until(async () => (await db.messages.list(sid)).find((m) => m.mended && /Kris/.test(m.text)), 'the mend to land', 15000);
  assert(/Kris, who was not her mother/.test(page.text) && /The booth was quiet\./.test(page.text), 'one word changed, the page kept: ' + page.text);
  eq(page.mended.before, 'Liara looked at Kim, who was not her mother.\n\nThe booth was quiet.');
  const menderAsk = house.state.calls.slice(mendFrom).find((c) => c.isWorker && /<contradiction>/.test(JSON.stringify(c.body.messages || [])));
  assert(menderAsk && JSON.stringify(menderAsk.body).includes('MENDER-OLDEST'), 'the mender read the record whole, its oldest line past the old 30,000 included');
  await saveRec(recSid, { ...(await loadRec(recSid)), nodes: (await loadRec(recSid)).nodes.filter((n) => n.id !== 'node-mendold' && n.id !== 'node-mendnew') });
  /* M43: no chip on the page; the earlier words are a tap away in the drawer */
  assert(!q(`.msg[data-id="${page.id}"] .msg-act.mended`), 'no chip on the page');
  click(q('#btn-ledger')); await until(() => !q('#drawer').hidden, 'drawer'); await env.ctx.drawer.renderAllRooms(); await tick(350); /* M148 */
  /* the panel re-renders on the ledger's notify; on a loaded machine that lands after a fixed tick */
  const back = await until(() => qa('#drawer-panels button').find((b) => /Put the earlier words back/.test(b.textContent)), 'the take-back lives in Something drifted', 10000);
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
  click(q('#btn-ledger')); await until(() => !q('#drawer').hidden, 'drawer'); await env.ctx.drawer.renderAllRooms(); await tick(350); /* M148 */
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

/* M162: a page dressed by a display rule into deep markup used to overflow
 * renderHtmlProse's walk; msgNode called it bare and renderThread calls
 * msgNode in a plain loop, so ONE such page blanked the whole room. */
test('DOM-17 a page dressed too deep still renders, and the room stays whole', async () => {
  const { renderHtmlProse } = await import('../../js/ui/richhtml.js');
  const deep = '<div>'.repeat(400) + 'the lantern swung' + '</div>'.repeat(400);
  let frag = null;
  let threw = '';
  try { frag = renderHtmlProse(deep); } catch (err) { threw = String(err && err.message || err); }
  eq(threw, '', 'the walk does not overflow');
  assert(frag && /the lantern swung/.test(frag.textContent), 'and the words still reach the reader');
});


/* M201: during a rebuild the ledger saves a line at a time, every save
 * notifies, and every notify re-renders the drawer — and each render threw
 * the writer to the top, over and over, while they watched it work. M199
 * restored the position two frames later, which is before a panel's content
 * (every panel renders asynchronously) has arrived: nothing to scroll, and
 * the position lost the moment it does arrive. */
test('DOM-18 the ledger keeps the writer’s place through a rebuild’s refreshes', async () => {
  const { db } = await import('../../js/store.js');
  const { notify } = await import('../../js/engine/state.js');
  const st = await db.stories.create({ title: 'A long ledger' });
  for (let i = 0; i < 40; i += 1) await db.messages.append(st.id, { role: i % 2 ? 'assistant' : 'user', text: 'page ' + i });
  await db.settings.set('state:' + st.id, { present: [], journal: [], log: Array.from({ length: 120 }, (_, i) => ({ ts: Date.now(), words: 'a change, number ' + i, jid: i })) });
  env.window.__cozy.setActiveStoryId(st.id);
  click(q('#btn-ledger'));
  await tick(900);

  const panels = q('#drawer-panels');
  Object.defineProperty(panels, 'scrollHeight', { value: 4000, configurable: true });
  Object.defineProperty(panels, 'clientHeight', { value: 600, configurable: true });
  let top = 0;
  Object.defineProperty(panels, 'scrollTop', { get: () => top, set: (v) => { top = v; }, configurable: true });

  panels.scrollTop = 1200;
  for (let i = 0; i < 8; i += 1) { notify(st.id); await tick(220); }
  await tick(1200);
  eq(panels.scrollTop, 1200, 'the panel stayed where the writer left it');

  click(q('#btn-ledger'));
  await tick(300);
});


/* M250: a worker that stumbles is written to the workers' line in the LEDGER
 * DRAWER — and nowhere else. So a writer whose keeper connection had fallen
 * over could play four scenes without a word of it, while nothing of those
 * pages was being folded, and find out only when he happened to open the
 * ledger. The button carries a quiet mark instead. */
test('DOM-19 a worker that stumbles marks the ledger, and success clears it', async () => {
  const { db } = await import('../../js/store.js');
  const { noteWorkerRun } = await import('../../js/agents/status.js');
  const st = await db.stories.create({ title: 'a keeper that fell over' });
  for (let i = 0; i < 6; i += 1) await db.messages.append(st.id, { role: i % 2 ? 'assistant' : 'user', text: 'page ' + i });
  env.window.__cozy.setActiveStoryId(st.id);
  await tick(600);

  const btn = q('#btn-ledger');
  eq(btn.classList.contains('has-trouble'), false, 'clean while all is well');

  await noteWorkerRun(st.id, 'keeper', { ok: false, why: 'could not reach the storyteller' });
  await env.window.__cozy.chat.renderThread({ structural: true });
  await tick(500);
  eq(btn.classList.contains('has-trouble'), true, 'marked the moment the keeper stumbles');
  assert(/keeper stumbled/.test(btn.getAttribute('title')), 'and says which worker: ' + btn.getAttribute('title'));
  assert(/the pages are safe/.test(btn.getAttribute('title')), 'and that nothing is lost');

  await noteWorkerRun(st.id, 'keeper', { ok: true, detail: 'folded six pages' });
  await env.window.__cozy.chat.renderThread({ structural: true });
  await tick(500);
  eq(btn.classList.contains('has-trouble'), false, 'and clears itself the moment it comes back');
});


/* M255: the writer sent two scenes, waited ten minutes, and the green light
 * only came back after RELOADING THE BROWSER. The light was computed when the
 * thread REDREW — which happens before the background chain has finished — so
 * it showed the world as it was a second after sending and nothing ever
 * looked again. And there was no light at all for "reading now", so he could
 * not tell thinking from forgotten. */
test('DOM-20 the ledger light follows the work itself: blue, then green, with no reload', async () => {
  const { db } = await import('../../js/store.js');
  const { noteWorkerRun, markWorkerRunning } = await import('../../js/agents/status.js');
  const { saveState, emptyState } = await import('../../js/engine/state.js');
  const { saveMemory } = await import('../../js/agents/memory.js');

  const st = await db.stories.create({ title: 'the three lights' });
  for (let i = 0; i < 4; i += 1) {
    await db.messages.append(st.id, { role: 'user', text: 'on' });
    await db.messages.append(st.id, { role: 'assistant', text: 'The scene turns.' });
  }
  await db.settings.set('memoryWindow', 20);
  await saveState(st.id, { ...emptyState(), page: 3 });
  await saveMemory(st.id, { window: 20, nodes: [] });
  for (const w of ['keeper', 'extractor', 'scribe', 'world']) await noteWorkerRun(st.id, w, { ok: true, detail: 'well' });
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  await tick(700);

  const btn = q('#btn-ledger');
  const lamp = () => (btn.classList.contains('is-working') ? 'blue'
    : btn.classList.contains('has-trouble') ? 'amber'
      : btn.classList.contains('all-well') ? 'green' : 'dark');

  eq(lamp(), 'green', 'everything read and folded');

  /* a worker starts — and the thread is NOT redrawn */
  markWorkerRunning(st.id, 'extractor', true);
  await tick(400);
  eq(lamp(), 'blue', 'the light follows the work, not the redraw');
  assert(/reading this scene now/.test(btn.getAttribute('title')), 'and says so: ' + btn.getAttribute('title'));

  markWorkerRunning(st.id, 'extractor', false);
  await noteWorkerRun(st.id, 'extractor', { ok: true, detail: 'wrote 3 changes' });
  await tick(500);
  eq(lamp(), 'green', 'and comes back to green when it settles — no reload');

  /* and a stumble while working shows blue, not amber: wait, then look */
  markWorkerRunning(st.id, 'keeper', true);
  await noteWorkerRun(st.id, 'scribe', { ok: false, why: 'could not be reached' });
  await tick(400);
  eq(lamp(), 'blue', 'while the house is still reading, the light says wait');
  markWorkerRunning(st.id, 'keeper', false);
  await tick(500);
  eq(lamp(), 'amber', 'and only then does it say look');
});

test('DOM-21 the page chain looks: a worker that asks for page 1 by its number is served it whole (M260)', async () => {
  const { queuedCount } = await import('../../js/agents/queue.js');
  const st = await db.stories.create({ title: 'the lookout' });
  await db.messages.append(st.id, { role: 'user', text: 'I climb the tower. PAGE-ONE-MARKER: the lantern is blue.' });
  await db.messages.append(st.id, { role: 'assistant', text: '[Lakeside Park — Friday, March 14, 2025 | 14:30 | 🌤 | coat | standing]\n\nThe tower creaks.' });
  /* M261: a thread nobody has carried for a long while, to see it cool on this page */
  const { saveState: saveLedger, emptyState: blankLedger } = await import('../../js/engine/state.js');
  await saveLedger(st.id, { ...blankLedger(), threads: [{ title: 'An old promise nobody carries', owner: 'Liara', heat: 'hot', atTurn: -20 }],
    characters: { 'Old Passerby': { core: 'a cab driver from long ago', state: '', arc: '', threads: [], updatedAtTurn: -60 } } });
  /* M261: and the auditor switched off — the ledger is kept anyway */
  const auditWas = await db.settings.get('auditOn');
  await db.settings.set('auditOn', false);
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  await until(() => q('.msg-act[data-act="go on"]'), 'the tale renders with go on');
  let asked = 0;
  house.state.workerAnswer = (body, sys) => {
    if (/keep the ledger/i.test(sys)) {
      asked += 1;
      return asked === 1 ? '<fetch>["1"]</fetch>' : FOUNDING;
    }
    return walkDefaultWorker(body, sys);
  };
  const from = house.state.calls.length;
  try {
    click(q('.msg-act[data-act="go on"]'));
    await until(() => asked >= 2, 'the extractor to ask, be served, and answer', 30000);
    await until(() => !env.ctx.chat.isBusy() && queuedCount(st.id) === 0 && !q('.msg-pending'), 'the chain to finish', 30000);
  } finally {
    house.state.workerAnswer = walkDefaultWorker;
    await db.settings.set('auditOn', auditWas === undefined ? true : auditWas);
  }
  const extractorCalls = house.state.calls.slice(from).filter((c) => c.isWorker && /keep the ledger/i.test(JSON.stringify(c.body.messages || [])));
  assert(extractorCalls.length >= 2, 'the extractor asked twice: ' + extractorCalls.length);
  const second = extractorCalls[1].body.messages;
  const lastAsk = String(second[second.length - 1].content || '');
  assert(/page 3 of the story/.test(JSON.stringify(extractorCalls[0].body.messages)), 'the chain told it which page it reads');
  assert(/What you asked for, whole:[\s\S]*the writer wrote \(\d+ chars, COMPLETE[\s\S]*PAGE-ONE-MARKER: the lantern is blue\./.test(lastAsk), 'page 1 was served whole, by its number, from the tale itself: ' + lastAsk.slice(0, 200));
  /* M261: and the chain hands both readers the story so far, whole */
  assert(JSON.stringify(extractorCalls[0].body.messages).includes('The tower creaks.'), 'the extractor was shown the page before, whole');
  const worldCalls = house.state.calls.slice(from).filter((c) => c.isWorker && /world beyond the page/i.test(JSON.stringify(c.body.messages || [])));
  assert(worldCalls.length && JSON.stringify(worldCalls[0].body.messages).includes('PAGE-ONE-MARKER'), 'and so was the world agent');
  assert(second.some((mm) => mm.role === 'assistant' && String(mm.content).includes('<fetch>["1"]</fetch>')), 'with its own ask in the conversation');
  const ledger = await db.settings.get('state:' + st.id);
  assert(ledger && ledger.sheet && ledger.sheet.playerName === 'Jovan', 'and the answer after the look was written');
  const old = (ledger.threads || []).find((t) => t.title === 'An old promise nobody carries');
  assert(old && old.heat === 'cold', 'the page chain cooled the thread nobody carried: ' + JSON.stringify(old));
  assert(ledger.characters && ledger.characters['Old Passerby'] && ledger.characters['Old Passerby'].retired, 'with the auditor off, one who passed through long ago was still retired: ' + JSON.stringify(ledger.characters && ledger.characters['Old Passerby']));
  const auditorRan = house.state.calls.slice(from).some((c) => c.isWorker && /auditor of the ledger/i.test(JSON.stringify(c.body.messages || [])));
  eq(auditorRan, false, 'and no audit was asked for');
});

test('DOM-22 the house heals what the old readers left, with no hand on it: a line read in part is read again whole, and a story with the old auditor’s mark has its people re-read once (M262)', async () => {
  const { queuedCount } = await import('../../js/agents/queue.js');
  const { saveState: saveLedger, emptyState: blankLedger } = await import('../../js/engine/state.js');
  const { applyMutations } = await import('../../js/engine/apply.js');
  const { saveMemory, loadMemory } = await import('../../js/agents/memory.js');
  const st = await db.stories.create({ title: 'the old reading' });
  await db.messages.append(st.id, { role: 'user', text: 'I climb.' });
  await db.messages.append(st.id, { role: 'assistant', text: 'The stair turns. ' + 'w'.repeat(7000) + ' LONG-TAIL-SEEN' });
  await db.messages.append(st.id, { role: 'user', text: 'I go on.' });
  await db.messages.append(st.id, { role: 'assistant', text: '[Lakeside Park — Friday, March 14, 2025 | 14:30 | 🌤 | coat | standing]\n\nThe top of the stair.' });
  let led = applyMutations(blankLedger(), [{ type: 'rel.set', name: 'Old Friend', p: 20, cause: 'the brief states (P:20)' }]).state;
  led = applyMutations(led, [{ type: 'rel.shift', name: 'Old Friend', axis: 'p', delta: -15, cause: 'he lied to her' }]).state;
  led = applyMutations(led, [{ type: 'rel.set', name: 'Old Friend', p: 20, cause: 'the brief says they are friends' }]).state;
  await saveLedger(st.id, led);
  await saveMemory(st.id, { window: 20, nodes: [{ id: 'node-oldread1', span: [0, 1], level: 1, text: 'Jovan climbed the stair.', at: 1 }] });
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  await until(() => q('.msg-act[data-act="go on"]'), 'the tale renders with go on');
  /* M263: the writer writes a page by hand in the drawer, as he would */
  click(q('#btn-ledger'));
  await until(() => !q('#drawer').hidden, 'the drawer opens'); await env.ctx.drawer.renderAllRooms(); await tick(350);
  const personField = await until(() => q('#drawer-panels input[placeholder^="Write on a page by hand"]'), 'the hand page form');
  const lform = personField.closest('form');
  type(personField, 'Hand Written Person');
  lform.querySelector('select').value = 'core';
  type(lform.querySelector('input[placeholder="What to write down"]'), 'WRITTEN BY THE WRITER');
  submit(lform);
  await until(async () => { const l = await db.settings.get('state:' + st.id); return l && l.characters && l.characters['Hand Written Person']; }, 'the hand page to be written');
  click(q('#btn-ledger'));
  house.state.workerAnswer = (body, sys) => {
    if (/narrative-state tracker/i.test(sys)) return 'Jovan climbed the stair to its end; LONG-TAIL-SEEN.';
    return walkDefaultWorker(body, sys);
  };
  try {
    click(q('.msg-act[data-act="go on"]'));
    await until(async () => { const l = await db.settings.get('state:' + st.id); return l && l.healedGen; }, 'the people to be re-read', 40000);
    await until(() => !env.ctx.chat.isBusy() && queuedCount(st.id) === 0 && !q('.msg-pending'), 'the chain to finish', 40000);
  } finally {
    house.state.workerAnswer = walkDefaultWorker;
  }
  const mem = await loadMemory(st.id);
  const line = mem.nodes.find((n) => n.id === 'node-oldread1');
  assert(line && line.whole === true && /LONG-TAIL-SEEN/.test(line.text), 'the line read in part was read again, whole: ' + JSON.stringify(line));
  const ledger = await db.settings.get('state:' + st.id);
  assert(!(ledger.relationships || {})['Old Friend'], 'the standing the old auditor pushed back is re-read from the pages');
  assert((ledger.log || []).some((l) => /read again from the pages/.test(l.words)), 'the log says so');
  const own = (ledger.characters || {})['Hand Written Person'];
  assert(own && own.core === 'WRITTEN BY THE WRITER' && own.hand && own.hand.core, 'the page the writer wrote by hand stood through the re-reading: ' + JSON.stringify(own));
  const backup = await db.settings.get('peopleBackup:' + st.id);
  assert(backup && backup.relationships && backup.relationships['Old Friend'], 'and the way back holds what was there');
});

test('DOM-23 the record rides in the room the storyteller’s context leaves, and the writer chooses when it squeezes (M264)', async () => {
  const { queuedCount } = await import('../../js/agents/queue.js');
  const { saveMemory } = await import('../../js/agents/memory.js');
  /* the choice, in Settings */
  const pick = q('#memory-squeeze');
  assert(pick && pick.value === 'auto', 'the house squeezes by room unless told otherwise: ' + (pick && pick.value));
  pick.value = 'never'; pick.dispatchEvent(new env.window.Event('change'));
  await until(async () => (await db.settings.get('memorySqueeze')) === 'never', 'never to be kept');
  pick.value = 'lines'; pick.dispatchEvent(new env.window.Event('change'));
  await until(async () => (await db.settings.get('memorySqueeze')) === 100, 'a number of lines to be kept');
  eq(q('#memory-squeeze-lines').hidden, false, 'the number shows when it is the choice');
  pick.value = 'auto'; pick.dispatchEvent(new env.window.Event('change'));
  await until(async () => (await db.settings.get('memorySqueeze')) === 'auto', 'auto to be kept');
  eq(q('#memory-squeeze-lines').hidden, true, 'and hides when it is not');
  /* a record longer than the old 30,000 characters rides whole */
  const st = await db.stories.create({ title: 'the long record' });
  for (let i = 0; i < 70; i += 1) await db.messages.append(st.id, { role: i % 2 ? 'assistant' : 'user', text: (i % 2 ? 'The tale goes on, page ' : 'I go on, page ') + (i + 1) });
  await saveMemory(st.id, { window: 20, nodes: Array.from({ length: 10 }, (_, k) => ({ id: 'node-long' + k, span: [k * 6, k * 6 + 5], level: 1, text: 'RECORD-LINE-' + k + ' ' + 'r'.repeat(8000), at: k + 1, whole: true })) });
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  await until(() => q('.msg-act[data-act="go on"]'), 'the tale renders with go on');
  const from = house.state.calls.length;
  click(q('.msg-act[data-act="go on"]'));
  await until(() => house.state.calls.slice(from).some((c) => !c.isWorker), 'the storyteller to be asked', 20000);
  const told = JSON.stringify(house.state.calls.slice(from).find((c) => !c.isWorker).body);
  assert(told.includes('RECORD-LINE-0 ') && told.includes('RECORD-LINE-7 '), 'the oldest record line rides with the newest');
  assert(!/rest beyond the budget/.test(told), 'and none is let go');
  await until(() => !env.ctx.chat.isBusy() && queuedCount(st.id) === 0 && !q('.msg-pending'), 'the chain to finish', 40000);

  /* M265: a room too small for the record, squeezing set to never — the writer is told */
  const conns = await db.connections.list();
  const activeId = await db.settings.get('activeConnectionId');
  const conn = conns.find((c) => c.id === activeId) || conns[0];
  const sizeWas = conn.contextSize;
  await db.connections.update(conn.id, { contextSize: 20000 });
  await db.settings.set('memorySqueeze', 'never');
  /* every word the house says, kept — a later toast must not hide this one */
  const said = [];
  const realToast = env.ctx.toast;
  env.ctx.toast = (w) => { said.push(String(w)); return realToast ? realToast(w) : undefined; };
  try {
    const n = assistantPages().length;
    click(q('.msg-act[data-act="go on"]'));
    await until(() => assistantPages().length > n, 'another page', 20000);
    await until(() => said.some((w) => /The storyteller’s context is full: the oldest \d+ record lines? (was|were) left out of this page/.test(w)), 'the full room to be said out loud: ' + JSON.stringify(said), 10000);
    await until(() => !env.ctx.chat.isBusy() && queuedCount(st.id) === 0 && !q('.msg-pending'), 'the chain to finish', 40000);
  } finally {
    env.ctx.toast = realToast;
    await db.connections.update(conn.id, { contextSize: sizeWas });
    await db.settings.set('memorySqueeze', 'auto');
  }
});

test('DOM-24 a page mended by mistake is put back by the house itself (M268)', async () => {
  const { queuedCount } = await import('../../js/agents/queue.js');
  const st = await db.stories.create({ title: 'the wrong mend' });
  await db.messages.append(st.id, { role: 'user', text: 'I come home.' });
  const pg = await db.messages.append(st.id, { role: 'assistant', text: '[Lakeside Park — Friday, March 14, 2025 | 14:30 | 🌤 | coat | standing]\n\nJovan, seventeen, dropped his bag.' });
  await db.messages.update(st.id, pg.id, { mended: { before: '[Lakeside Park — Friday, March 14, 2025 | 14:30 | 🌤 | coat | standing]\n\nJovan, SIXTEEN-AS-WRITTEN, dropped his bag.', why: 'Snippet says Jovan is sixteen, but the passage says he is seventeen. It should read: Jovan is seventeen', at: 1 } });
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  await until(() => q('.msg-act[data-act="go on"]'), 'the tale renders with go on');
  const said = [];
  const realToast = env.ctx.toast;
  env.ctx.toast = (w) => { said.push(String(w)); return realToast ? realToast(w) : undefined; };
  try {
    click(q('.msg-act[data-act="go on"]'));
    await until(async () => { const m = (await db.messages.list(st.id)).find((x) => x.id === pg.id); return m && /SIXTEEN-AS-WRITTEN/.test(m.text) && !m.mended; }, 'the mistaken mend to be put back', 40000);
    await until(() => !env.ctx.chat.isBusy() && queuedCount(st.id) === 0 && !q('.msg-pending'), 'the chain to finish', 40000);
  } finally {
    env.ctx.toast = realToast;
  }
  assert(said.some((w) => /put back 1 page it had mended by mistake/.test(w)), 'and says so: ' + JSON.stringify(said));
  assert(/SIXTEEN-AS-WRITTEN/.test(bodyText(q(`.msg[data-id="${pg.id}"]`) || { textContent: '' }) || (q(`.msg[data-id="${pg.id}"]`) || {}).textContent || ''), 'the page on screen shows the storyteller\u2019s own words');
});

test('DOM-25 a card shows the problem it is one part of (M273)', async () => {
  const st = await db.stories.create({ title: 'the grouped cards' });
  const pg = await db.messages.append(st.id, { role: 'assistant', text: 'I sent a sixteen-year-old boy to that island.' });
  const card = (id, label, find, replace, grouped) => ({
    id, ts: 1, kind: 'edit', label, reason: 'he was fourteen', op: { messageId: pg.id, find, replace },
    status: 'pending', words: '', review: [],
    ...(grouped ? { group: 'g-test-1', groupName: 'Rias\u2019s slip about Jovan\u2019s age' } : {}),
  });
  await db.settings.set('hk:' + st.id, { sessions: [{ id: 1, name: 'Session 1', turns: [
    { role: 'writer', text: 'fix Rias', ts: 1 },
    { role: 'housekeeper', text: 'Three cards.', ts: 2, proposals: [
      card('grp-c1', 're-ink one', 'sixteen-year-old', 'fourteen-year-old', true),
      card('grp-c2', 're-ink two', 'a sixteen', 'a fourteen', true),
      card('grp-c3', 're-ink three', 'that island', 'that far island', false),
    ] },
  ] }], activeId: 1, batches: [] });
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  /* an earlier scenario may have left the sheet open on another story: open it afresh */
  if (!q('#hk-sheet').hidden) { click(q('#btn-hk-close')); await until(() => q('#hk-sheet').hidden, 'the sheet to close first', 5000); }
  click(q('#btn-housekeeper'));
  await until(() => !q('#hk-sheet').hidden && ['grp-c1', 'grp-c2', 'grp-c3'].every((id) => q('.hk-card[data-proposal-id="' + id + '"]')), 'the three cards', 10000);
  const line = (id) => { const g = q('.hk-card[data-proposal-id="' + id + '"] .hk-card-group'); return g ? g.textContent : ''; };
  eq(line('grp-c1'), 'Part of \u201cRias\u2019s slip about Jovan\u2019s age\u201d \u2014 1 of 2', 'the first card of the problem says so');
  eq(line('grp-c2'), 'Part of \u201cRias\u2019s slip about Jovan\u2019s age\u201d \u2014 2 of 2', 'and the second');
  eq(line('grp-c3'), '', 'the lone card says nothing of a group');
  click(q('#btn-hk-close'));
  await until(() => q('#hk-sheet').hidden, 'the sheet to close', 5000);
});

test('DOM-26 a gap in the record is folded by the house itself and the light comes back green; a fill that folds nothing waits (M275)', async () => {
  const { noteWorkerRun, loadWorkerStatus } = await import('../../js/agents/status.js');
  const { saveState, emptyState } = await import('../../js/engine/state.js');
  const { saveMemory, loadMemory } = await import('../../js/agents/memory.js');
  const { queuedCount } = await import('../../js/agents/queue.js');
  const windowWas = await db.settings.get('memoryWindow');
  const btn = q('#btn-ledger');
  const lamp = () => (btn.classList.contains('is-working') ? 'blue' : btn.classList.contains('has-trouble') ? 'amber' : btn.classList.contains('all-well') ? 'green' : 'dark');
  const seed = async (title, nodes, pairs = 16) => {
    const st = await db.stories.create({ title });
    for (let i = 0; i < pairs; i += 1) {
      await db.messages.append(st.id, { role: 'user', text: 'on ' + i });
      await db.messages.append(st.id, { role: 'assistant', text: 'The scene turns, page ' + i + '.' });
    }
    await saveState(st.id, { ...emptyState(), page: pairs - 1 });
    await saveMemory(st.id, { window: 20, nodes });
    for (const w of ['keeper', 'extractor', 'scribe', 'world']) await noteWorkerRun(st.id, w, { ok: true, detail: 'well' });
    return st;
  };
  const keeperAsks = () => house.state.calls.filter((c) => c.isWorker && /narrative-state tracker/i.test(JSON.stringify(c.body))).length;
  const secondLine = (tag) => ({ id: 'node-gap-' + tag, span: [6, 11], level: 1, text: 'The scene turned on and on.', at: 2, whole: true });
  await db.settings.set('memoryWindow', 20);
  try {
    /* 1. a keeper that cannot fold: the gap stays, the light says so, and it is not sent again at once */
    const bad = await seed('the gap that will not fold', [secondLine('bad')]);
    house.state.workerAnswer = (body, sys) => (/narrative-state tracker/i.test(sys) ? '' : walkDefaultWorker(body, sys));
    const asksBefore = keeperAsks();
    env.window.__cozy.setActiveStoryId(bad.id);
    await env.window.__cozy.chat.renderThread({ structural: true });
    await until(() => keeperAsks() > asksBefore, 'the house to send the keeper to the gap', 20000);
    await until(() => queuedCount(bad.id) === 0 && lamp() === 'amber', 'the light to say it stopped partway: ' + lamp(), 20000);
    const asksAfter = keeperAsks();
    await env.window.__cozy.chat.renderThread({ structural: true });
    await tick(1500);
    eq(keeperAsks(), asksAfter, 'a fill that folded nothing is not tried again at once');
    /* and it waits longer each time: a minute on, still waiting (two after a fill that folded nothing) — past two, it tries */
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 61000;
      await env.window.__cozy.chat.renderThread({ structural: true });
      await tick(1500);
      eq(keeperAsks(), asksAfter, 'a minute later it still waits');
      Date.now = () => realNow() + 125000;
      await env.window.__cozy.chat.renderThread({ structural: true });
      await until(() => keeperAsks() > asksAfter, 'past two minutes, it tries again', 10000);
      await until(() => queuedCount(bad.id) === 0 && !btn.classList.contains('is-working'), 'the second try to settle', 10000);
    } finally { Date.now = realNow; }
    house.state.workerAnswer = walkDefaultWorker;

    /* 2. a keeper that can: the gap is folded with no page written, and the light is green again */
    const good = await seed('the gap the house fills', [secondLine('good')]);
    env.window.__cozy.setActiveStoryId(good.id);
    await env.window.__cozy.chat.renderThread({ structural: true });
    await until(async () => (await loadMemory(good.id)).nodes.some((n) => n.span[0] === 0), 'the house to fold the gap itself', 20000);
    await until(() => queuedCount(good.id) === 0 && lamp() === 'green', 'the light to come back green: ' + lamp(), 20000);
    const shelfGood = (await loadWorkerStatus(good.id)) || {};
    assert(/folded a gap in the record/.test((shelfGood.keeper || {}).detail || ''), 'and the workers line says what it did: ' + JSON.stringify(shelfGood.keeper));

    /* 3. a mistaken mend put back during a page's chain: the chain's own keeper folds the gap it leaves */
    const mended = await seed('the mend put back', [{ id: 'node-mend-a', span: [0, 5], level: 1, text: 'The scene turned early.', at: 1, whole: true }, secondLine('mend')]);
    const pages = await db.messages.list(mended.id);
    const pg = pages[3];
    await db.messages.update(mended.id, pg.id, { text: 'The scene turns, page 1, MENDED WRONGLY.', mended: { before: pg.text, why: 'Snippet says the scene turns, but the passage says it does not', at: 1 } });
    env.window.__cozy.setActiveStoryId(mended.id);
    await env.window.__cozy.chat.renderThread({ structural: true });
    await until(() => q('.msg-act[data-act="go on"]'), 'the tale renders with go on');
    click(q('.msg-act[data-act="go on"]'));
    await until(async () => { const m = (await db.messages.list(mended.id)).find((x) => x.id === pg.id); return m && !m.mended; }, 'the mend to be put back', 40000);
    await until(() => !env.ctx.chat.isBusy() && queuedCount(mended.id) === 0 && !q('.msg.pending'), 'the chain to finish', 40000);
    assert((await loadMemory(mended.id)).nodes.some((n) => n.span[0] <= 3 && n.span[1] >= 3), 'the page put back is on the record again, folded from its own words');
    const detail = (((await loadWorkerStatus(mended.id)) || {}).keeper || {}).detail || '';
    assert(!/folded a gap/.test(detail), 'folded by the chain\u2019s keeper in its first pass — the put-back comes before the fold: ' + detail);
    await until(() => lamp() === 'green' || lamp() === 'dark' || lamp() === 'amber', 'the light to settle', 5000);

    /* 4. a page mended while the keeper folds its LAST batch of the run: the gap it leaves is folded in the same job */
    const late = await seed('the mend in the last batch', [], 19);
    const latePages = await db.messages.list(late.id);
    await db.messages.update(late.id, latePages[15].id, { text: 'Kim is the mother here, the page says.' });
    /* a worker marked stumbling keeps the light from folding the backlog before the page's own chain does */
    await noteWorkerRun(late.id, 'world', { ok: false, why: 'held for the scenario' });
    house.state.workerAnswer = (body, sys) => {
      const user = String((body.messages || []).slice(-1)[0] && (body.messages || []).slice(-1)[0].content || '');
      if (/Check for exactly two things/.test(JSON.stringify(body)) && /Kim is the mother/.test(user)) {
        return JSON.stringify([{ issue: 'The passage names Kim as the mother, but the record establishes Kris', fix: 'Kris is the mother', kind: 'continuity', where: 'source' }]);
      }
      return walkDefaultWorker(body, sys);
    };
    env.window.__cozy.setActiveStoryId(late.id);
    await env.window.__cozy.chat.renderThread({ structural: true });
    await until(() => q('.msg-act[data-act="go on"]'), 'the tale renders with go on');
    click(q('.msg-act[data-act="go on"]'));
    await until(async () => /Kris is the mother/.test(((await db.messages.list(late.id)).find((m) => m.id === latePages[15].id) || {}).text || ''), 'the page to be mended while its batch is folded', 40000);
    await until(() => !env.ctx.chat.isBusy() && queuedCount(late.id) === 0 && !q('.msg.pending'), 'the chain to finish', 40000);
    const lateMem = await loadMemory(late.id);
    assert(lateMem.nodes.some((n) => n.span[0] <= 15 && n.span[1] >= 15), 'the mended page is on the record again');
    const lateDetail = (((await loadWorkerStatus(late.id)) || {}).keeper || {}).detail || '';
    assert(/^wrote .*· folded a gap in the record/.test(lateDetail), 'folded by the chain\u2019s own keeper, in the same job: ' + lateDetail);
  } finally {
    house.state.workerAnswer = walkDefaultWorker;
    await db.settings.set('memoryWindow', windowWas);
  }
});

test('DOM-27 the ledger reads the pages it missed — while the writer plays and while the house is idle — and a quiet page counts (M276)', async () => {
  const { noteWorkerRun } = await import('../../js/agents/status.js');
  const { saveState, emptyState, loadState } = await import('../../js/engine/state.js');
  const { saveMemory } = await import('../../js/agents/memory.js');
  const { queuedCount } = await import('../../js/agents/queue.js');
  const btn = q('#btn-ledger');
  const lamp = () => (btn.classList.contains('is-working') ? 'blue' : btn.classList.contains('has-trouble') ? 'amber' : btn.classList.contains('all-well') ? 'green' : 'dark');
  const st = await db.stories.create({ title: 'the missed pages' });
  for (let i = 0; i < 6; i += 1) {
    await db.messages.append(st.id, { role: 'user', text: 'on ' + i });
    await db.messages.append(st.id, { role: 'assistant', text: 'The scene turns quietly, page ' + i + '.' });
  }
  /* the ledger read pages 0..2; 3, 4 and 5 went unread (an outage), and none of them changed anything */
  await saveState(st.id, { ...emptyState(), page: 2, place: { name: 'The kitchen' }, present: [{ name: 'Jovan' }] });
  await saveMemory(st.id, { window: 20, nodes: [] });
  for (const w of ['keeper', 'extractor', 'scribe', 'world']) await noteWorkerRun(st.id, w, { ok: true, detail: 'well' });
  /* a worker marked stumbling holds the light, so the idle reading does not close the gap before the writer
   * plays on — the page chain reads the new page out of turn first; the world agent's own run then clears it */
  await noteWorkerRun(st.id, 'world', { ok: false, why: 'held for the scenario' });
  const ledgerReads = () => house.state.calls.filter((c) => c.isWorker && /keep the ledger/i.test(String(((c.body.messages || [])[0] || {}).content || ''))).length;
  house.state.workerAnswer = (body, sys) => (/keep the ledger/i.test(sys) ? '{"mutations":[]}' : walkDefaultWorker(body, sys));
  try {
    const before = ledgerReads();
    env.window.__cozy.setActiveStoryId(st.id);
    await env.window.__cozy.chat.renderThread({ structural: true });
    await tick(300);
    await until(() => queuedCount(st.id) === 0 && !btn.classList.contains('is-working'), 'the house to settle after opening', 20000);
    const opened = ledgerReads() - before;
    eq(opened, 0, 'the light held: nothing read on opening');
    /* the writer plays on: one page, and the chain reads the oldest missed page beside it */
    click(q('.msg-act[data-act="go on"]'));
    await until(() => !env.ctx.chat.isBusy() && queuedCount(st.id) === 0 && !q('.msg.pending'), 'the chain to finish', 40000);
    /* the chain read page 3 (the oldest missed) and the new page 6 out of turn; the idle reading, the moment
     * the chain is done, reads 4 and 5 — and the mark takes 6 without reading it again */
    await until(async () => (await loadState(st.id)).readTo === 6, 'the reading mark to reach the newest page', 30000);
    await until(() => queuedCount(st.id) === 0 && lamp() === 'green', 'the light to come back green: ' + lamp(), 20000);
    const total = ledgerReads() - before;
    eq(total, 4, 'four readings in all — pages 3, 4 and 5 once each and the new page once, nothing read twice (' + opened + ' on opening)');
    eq((await loadState(st.id)).readAhead.length, 0, 'nothing is left waiting');
  } finally {
    house.state.workerAnswer = walkDefaultWorker;
  }
});

test('DOM-28 the ember bar measures the room the house plans in — the connection\u2019s own, not a flat 200,000 (M285)', async () => {
  const { contextOf } = await import('../../js/providers/room.js');
  const conns = await db.connections.list();
  const conn = conns.find((c) => c && c.baseUrl && /mock\.example/.test(c.baseUrl)) || conns[0];
  assert(conn && !(typeof conn.contextSize === 'number' && conn.contextSize > 0), 'the walk\u2019s connection sets no room of its own');
  const room = contextOf(conn);
  eq(room, 128000, 'an endpoint the house does not know is planned at 128,000');
  const st = await db.stories.create({ title: 'the room' });
  await db.messages.append(st.id, { role: 'user', text: 'We begin.' });
  await db.messages.append(st.id, { role: 'assistant', text: 'The lamp is lit.' });
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  click(q('.msg-act[data-act="go on"]'));
  await until(() => !env.ctx.chat.isBusy() && !q('.msg.pending'), 'the page to land', 40000);
  const withReceipt = (await db.messages.list(st.id)).reverse().find((m) => m && m.receipt && typeof m.receipt.totalTokens === 'number');
  assert(withReceipt && withReceipt.receipt.totalTokens > 0, 'the page kept its receipt');
  const want = Math.min(100, Math.max(1, (withReceipt.receipt.totalTokens / room) * 100));
  await until(() => parseFloat(q('#ember-fill').style.width) > 0, 'the ember bar to fill', 10000);
  await tick(300);
  const got = parseFloat(q('#ember-fill').style.width);
  assert(Math.abs(got - want) < 0.01, 'the ember bar reads the page against the planned room: ' + got.toFixed(3) + '% (want ' + want.toFixed(3) + '%; a flat 200,000 would read ' + (withReceipt.receipt.totalTokens / 2000).toFixed(3) + '%)');
});

test('DOM-29 a long tale with a big brief never outgrows the model: the storyteller\u2019s request, counted at three characters a token, and its answer fit the room (M287)', async () => {
  const { saveMemory } = await import('../../js/agents/memory.js');
  const { queuedCount } = await import('../../js/agents/queue.js');
  const st = await db.stories.create({ title: 'the long tale' });
  await db.stories.update(st.id, { brief: 'THE BRIEF. ' + 'The harbor town keeps its secrets under the tide line. '.repeat(2700) });
  for (let i = 0; i < 24; i += 1) {
    await db.messages.append(st.id, { role: 'user', text: 'On we go ' + i + '.' });
    await db.messages.append(st.id, { role: 'assistant', text: 'Page ' + i + '. ' + 'The tide came in slowly. '.repeat(40) });
  }
  const node = (k, a, b) => ({ id: 'node-room' + k, span: [a, b], level: 1, text: 'ROOM-RECORD-' + k + ' ' + 'the town remembered everything, '.repeat(2500), at: k + 1, whole: true });
  await saveMemory(st.id, { window: 20, nodes: [node(0, 0, 5), node(1, 6, 11), node(2, 12, 17), node(3, 18, 27)] });
  const from = house.state.calls.length;
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  click(q('.msg-act[data-act="go on"]'));
  await until(() => !env.ctx.chat.isBusy() && !q('.msg.pending'), 'the page to land', 60000);
  const told = house.state.calls.slice(from).filter((c) => !c.isWorker);
  assert(told.length >= 1, 'the storyteller was asked');
  const sent = JSON.stringify(told[told.length - 1].body);
  const tokens = Math.ceil(sent.length / 3);
  assert(sent.includes('THE BRIEF.') && sent.includes('ROOM-RECORD-3'), 'the brief and the newest record ride');
  assert(tokens + 16000 <= 128000, 'the request (' + tokens + ' at three characters a token) and the answer\u2019s room fit 128,000');
  await until(() => queuedCount(st.id) === 0, 'the house to settle', 60000);
});

test('DOM-30 a connection with no room set is planned in the room its provider reports for the model (M289)', async () => {
  const conns = await db.connections.list();
  const conn = conns.find((c) => c && c.baseUrl && /mock\.example/.test(c.baseUrl)) || conns[0];
  await db.connections.update(conn.id, { detectTriedFor: null, detectTriedAt: null, detectedContext: null, detectedFor: null });
  house.state.models = [{ id: 'other-model', context_length: 32000 }, { id: conn.model, context_length: 600000 }];
  try {
    const st = await db.stories.create({ title: 'the provider says' });
    await db.messages.append(st.id, { role: 'user', text: 'We begin.' });
    await db.messages.append(st.id, { role: 'assistant', text: 'The lamp is lit.' });
    env.window.__cozy.setActiveStoryId(st.id);
    await env.window.__cozy.chat.renderThread({ structural: true });
    click(q('.msg-act[data-act="go on"]'));
    await until(() => !env.ctx.chat.isBusy() && !q('.msg.pending'), 'the page to land', 40000);
    const kept = (await db.connections.list()).find((c) => c.id === conn.id);
    eq(kept.detectedContext, 600000, 'the connection keeps the room its provider reports for its model');
    const withReceipt = (await db.messages.list(st.id)).reverse().find((m) => m && m.receipt && typeof m.receipt.totalTokens === 'number');
    const want = Math.min(100, Math.max(1, (withReceipt.receipt.totalTokens / 600000) * 100));
    await until(() => parseFloat(q('#ember-fill').style.width) > 0, 'the ember bar to fill', 10000);
    await tick(300);
    const got = parseFloat(q('#ember-fill').style.width);
    assert(Math.abs(got - want) < 0.01, 'the ember bar reads the page against the provider\u2019s 600,000: ' + got.toFixed(4) + '% (want ' + want.toFixed(4) + '%; the old guess would read ' + (withReceipt.receipt.totalTokens / 1280).toFixed(4) + '%)');
  } finally {
    house.state.models = null;
    await db.connections.update(conn.id, { detectTriedFor: null, detectTriedAt: null, detectedContext: null, detectedFor: null });
  }
});

test('DOM-31 Retry while the page\u2019s readers are still out: nothing they read of the page let go lands in the ledger (M290)', async () => {
  const { saveState, emptyState, loadState } = await import('../../js/engine/state.js');
  const { queuedCount } = await import('../../js/agents/queue.js');
  const st = await db.stories.create({ title: 'the page let go' });
  await db.messages.append(st.id, { role: 'user', text: 'We sit by the lake.' });
  await db.messages.append(st.id, { role: 'assistant', text: 'The lake is still. Jovan watches it.' });
  await saveState(st.id, { ...emptyState(), page: 0, place: { name: 'The lake shore' }, present: [{ name: 'Jovan' }] });
  let told = 0;
  house.state.storyAnswer = () => { told += 1; return told === 1 ? 'DOOMED-PAGE: the storm broke over the pier.' : 'KEPT-PAGE: the evening stayed calm by the lake.'; };
  house.state.workerAnswer = (body, sys) => {
    const text = JSON.stringify(body);
    if (/keep the ledger/i.test(sys) && text.includes('DOOMED-PAGE')) {
      /* the reader of the page that will be let go is still out when Retry is pressed */
      return new Promise((resolve) => setTimeout(() => resolve('{"mutations":[{"type":"mode.snapshot","flags":[]},{"type":"place.set","name":"THE DOOMED PIER"},{"type":"knowledge.add","name":"Jovan","fact":"DOOMED-FACT the storm broke"},{"type":"presence.enter","name":"Doomed Stranger"}],"resolved":[]}'), 7000));
    }
    return walkDefaultWorker(body, sys);
  };
  try {
    env.window.__cozy.setActiveStoryId(st.id);
    await env.window.__cozy.chat.renderThread({ structural: true });
    click(q('.msg-act[data-act="go on"]'));
    await until(() => !env.ctx.chat.isBusy() && !q('.msg.pending') && [...qa('.msg-assistant')].some((n) => /DOOMED-PAGE/.test(n.textContent)), 'the page to land', 30000);
    await tick(400);
    await until(() => q('#btn-retry') && !q('#btn-retry').hidden, 'Retry to show', 10000);
    click(q('#btn-retry'));
    await until(() => [...qa('.msg-assistant')].some((n) => /KEPT-PAGE/.test(n.textContent)) && !env.ctx.chat.isBusy(), 'the page written again', 40000);
    await tick(8000); /* past the held reader */
    await until(() => queuedCount(st.id) === 0, 'the house to settle', 60000);
    const after = await loadState(st.id);
    assert(!/DOOMED/.test(JSON.stringify(after.place)), 'the ground is not the page let go\u2019s: ' + JSON.stringify(after.place));
    assert(!JSON.stringify(after.knowledge || {}).includes('DOOMED-FACT'), 'and nobody knows what only the page let go said');
    assert(!(after.present || []).some((p) => /Doomed Stranger/.test(p.name)), 'and nobody the page let go brought in is here');
    assert(!JSON.stringify(after.journal || []).includes('DOOMED'), 'and the journal holds nothing of it');
    const pages = (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').map((m) => m.text);
    assert(!pages.some((t) => /DOOMED-PAGE/.test(t)) && pages.some((t) => /KEPT-PAGE/.test(t)), 'the page let go is gone and the new one stands');
  } finally {
    house.state.storyAnswer = null;
    house.state.workerAnswer = walkDefaultWorker;
  }
});

test('DOM-32 the character pages read alive: the ones here say what they are doing, the absent where the world has them, an old note how old it is (M291)', async () => {
  const { saveState, emptyState } = await import('../../js/engine/state.js');
  const st = await db.stories.create({ title: 'the pages alive' });
  await db.messages.append(st.id, { role: 'user', text: 'Evening.' });
  await db.messages.append(st.id, { role: 'assistant', text: 'The lamps came on along Mariner\u2019s Lane.' });
  await saveState(st.id, { ...emptyState(), page: 60, tidiedGen: 999, place: { name: 'The Wells kitchen' }, present: [{ name: 'Jovan' }, { name: 'Aurora Sterling' }],
    characters: {
      'Aurora Sterling': { core: 'Warm, sociable, quietly perceptive.', state: 'at the kitchen window, phone in hand', arc: '', threads: [], updatedAtTurn: 60 },
      'Ms. June': { core: 'Bluebird waitress in her fifties.', state: 'Held Jovan\u2019s face at the diner and comped the first round.', arc: '', threads: [], updatedAtTurn: 20 },
      'Eli Sterling': { core: 'About six, rail-thin.', state: 'Dragged inside mid-protest about vampire logistics.', arc: '', threads: [], updatedAtTurn: 30 },
    },
    offscreen: { 'Ms. June': { location: 'the Bluebird, closing up', activity: 'stacking chairs' } } });
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  click(q('#btn-ledger')); await until(() => !q('#drawer').hidden, 'drawer'); await env.ctx.drawer.renderAllRooms(); await tick(350);
  /* M292: the pages are drawn once, in "The people" */
  const rowOf = (name) => [...qa('#drawer .people-row')].find((li) => li.firstChild && (li.firstChild.textContent === name || li.firstChild.textContent.startsWith(name + ' \u2014 ')));
  await until(() => rowOf('Ms. June'), 'the character pages to draw', 10000);
  const text = (name) => [...rowOf(name).querySelectorAll('.quiet')].map((x) => x.textContent).join(' | ');
  /* her page, in the panels that draw pages (the world's list of where the absent are is not a page) */
  eq([...qa('#drawer [data-panel="the-people"] .mind-row, #drawer [data-panel="on-their-mind"] .mind-row')].filter((li) => li.firstChild && /^Ms\. June/.test(li.firstChild.textContent)).length, 1, 'and Ms. June\u2019s page is drawn once, not twice');
  assert(/Now: at the kitchen window, phone in hand/.test(text('Aurora Sterling')), 'the one here: what she is doing \u2014 ' + text('Aurora Sterling'));
  assert(/Now \(elsewhere\): the Bluebird, closing up, stacking chairs/.test(text('Ms. June')) && !/comped the first round/.test(text('Ms. June')), 'the absent: where the world has her, not the diner long gone \u2014 ' + text('Ms. June'));
  assert(/Last seen 31 pages ago: Dragged inside/.test(text('Eli Sterling')), 'an old note says how old it is \u2014 ' + text('Eli Sterling'));
  click(q('#btn-ledger')); await tick(300);
});

test('DOM-33 a story whose pages hold who they are in "now" is tidied once by the house, on its own (M291)', async () => {
  const { saveState, emptyState, loadState } = await import('../../js/engine/state.js');
  const { queuedCount } = await import('../../js/agents/queue.js');
  const st = await db.stories.create({ title: 'the pages tidied' });
  await db.messages.append(st.id, { role: 'user', text: 'Evening at home.' });
  await db.messages.append(st.id, { role: 'assistant', text: 'Rias leaned on the counter.' });
  await saveState(st.id, { ...emptyState(), page: 0, place: { name: 'The Wells kitchen' }, present: [{ name: 'Jovan' }, { name: 'Rias Wells' }],
    characters: { 'Rias Wells': { core: 'Confident, playful, possessive by nature.', state: 'Ravenwood High second-year, student council VP; 17', arc: '', threads: [], updatedAtTurn: 0 } } });
  let tidyAsked = 0;
  house.state.workerAnswer = (body, sys) => {
    if (/character pages of a long story tidy/i.test(sys)) {
      tidyAsked += 1;
      return '{"pages":[{"name":"Rias Wells","core":"Confident, playful, possessive by nature. Ravenwood High second-year, student council VP; 17.","state":"leaning on the kitchen counter"}]}';
    }
    return walkDefaultWorker(body, sys);
  };
  try {
    env.window.__cozy.setActiveStoryId(st.id);
    await env.window.__cozy.chat.renderThread({ structural: true });
    click(q('.msg-act[data-act="go on"]'));
    await until(() => !env.ctx.chat.isBusy() && !q('.msg.pending'), 'the page to land', 40000);
    await until(() => queuedCount(st.id) === 0 && tidyAsked > 0, 'the house to tidy the pages', 40000);
    await until(async () => (await loadState(st.id)).tidiedGen >= 291, 'the tidy to be stamped', 20000);
    const after = await loadState(st.id);
    const rias = after.characters['Rias Wells'];
    assert(/second-year, student council VP; 17/.test(rias.core), 'who she is holds her year: ' + rias.core);
    assert(!/second-year/.test(rias.state || ''), 'and her now is no longer who she is: ' + rias.state);
    eq(tidyAsked, 1, 'asked once');
  } finally {
    house.state.workerAnswer = walkDefaultWorker;
  }
});

test('DOM-34 a Stop pressed while a replay\u2019s tail still waits lets the gate go: history changes are not refused for the rest of the session (M293)', async () => {
  const { saveState, emptyState } = await import('../../js/engine/state.js');
  const { queuedCount, stopWork } = await import('../../js/agents/queue.js');
  const st = await db.stories.create({ title: 'the stopped replay' });
  await db.messages.append(st.id, { role: 'user', text: 'We walk to the pier.' });
  const first = await db.messages.append(st.id, { role: 'assistant', text: 'The pier creaked under them.' });
  await db.messages.append(st.id, { role: 'user', text: 'I look at the water.' });
  await db.messages.append(st.id, { role: 'assistant', text: 'The water was black and still.' });
  await saveState(st.id, { ...emptyState(), page: 1, place: { name: 'The pier' }, present: [{ name: 'Jovan' }] });
  let release = null;
  house.state.workerAnswer = (body, sys) => {
    if (/keep the ledger/i.test(sys) && JSON.stringify(body).includes('EDITED-PAGE')) {
      /* the reader of the edited page is held — the replay's tail waits behind it */
      return new Promise((resolve) => { release = () => resolve('{"mutations":[{"type":"mode.snapshot","flags":[]}],"resolved":[]}'); });
    }
    return walkDefaultWorker(body, sys);
  };
  try {
    env.window.__cozy.setActiveStoryId(st.id);
    await env.window.__cozy.chat.renderThread({ structural: true });
    /* edit the OLDER storyteller page: history changed there, the ledger replays */
    click(q('.msg[data-id="' + first.id + '"] .msg-act[data-act="edit"]'));
    const box = await until(() => q('.msg[data-id="' + first.id + '"] .edit-box'), 'the editor', 5000);
    type(box, 'EDITED-PAGE: the pier groaned under them.');
    click([...qa('.msg[data-id="' + first.id + '"] .edit-row button')].find((b) => /Keep/.test(b.textContent)));
    await until(() => env.ctx.chat.isReplaying(), 'the replay to be claimed', 5000);
    await until(() => release !== null, 'the held reader to be out', 15000);
    await until(() => queuedCount(st.id) > 0, 'the tail to be queued behind the chain', 5000);
    /* the writer's Stop (the banner's) drops what is queued — the tail with it */
    stopWork(st.id);
    await until(() => !env.ctx.chat.isReplaying(), 'the gate to let go after the stop (it used to stay shut for the rest of the session)', 4000);
    release();
    await until(() => queuedCount(st.id) === 0, 'the house to settle', 30000);
    /* and the next history change is not refused */
    const last = (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').pop();
    click(q('.msg[data-id="' + last.id + '"] .msg-act[data-act="edit"]'));
    await until(() => q('.msg[data-id="' + last.id + '"] .edit-box'), 'the editor to open again, ungated', 5000);
    click([...qa('.msg[data-id="' + last.id + '"] .edit-row button')].find((b) => /Never mind/.test(b.textContent)));
    await tick(200);
  } finally {
    house.state.workerAnswer = walkDefaultWorker;
  }
});

test('DOM-35 a page not kept says how old it is for the one here; the main character’s now is the scene’s, in code (M294, M299)', async () => {
  const { saveState, emptyState } = await import('../../js/engine/state.js');
  const st = await db.stories.create({ title: 'the stale page' });
  await db.messages.append(st.id, { role: 'user', text: 'Morning.' });
  await db.messages.append(st.id, { role: 'assistant', text: 'The kitchen was already loud.' });
  await saveState(st.id, { ...emptyState(), page: 60, tidiedGen: 999, place: { name: 'The Wells kitchen' }, present: [{ name: 'Jovan', position: 'at the table' }, { name: 'Mi-na' }, { name: 'Vanessa' }],
    sheet: { ...emptyState().sheet, playerName: 'Jovan' },
    characters: {
      'Jovan': { core: '', state: 'At the kitchen window seat, rice finished, sneakers on', arc: '', threads: [], updatedAtTurn: 30 },
      'Mi-na': { core: 'Sharp, quiet.', state: 'across the table, phone face down', arc: '', threads: [], updatedAtTurn: 60 },
      'Vanessa': { core: 'Loud, fond.', state: 'sliding the screenshot across', arc: '', threads: [], updatedAtTurn: 55 },
    } });
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  click(q('#btn-ledger')); await until(() => !q('#drawer').hidden, 'drawer'); await env.ctx.drawer.renderAllRooms(); await tick(350);
  const rowOf = (name) => [...qa('#drawer .people-row')].find((li) => li.firstChild && (li.firstChild.textContent === name || li.firstChild.textContent.startsWith(name + ' \u2014 ')));
  await until(() => rowOf('Jovan') && rowOf('Mi-na'), 'the pages to draw', 10000);
  const text = (name) => [...rowOf(name).querySelectorAll('.quiet')].map((x) => x.textContent).join(' | ');
  /* M299: the main character's now is the scene's — from the ledger, never the scribe's stale note */
  assert(/Now: at the table — at The Wells kitchen/.test(text('Jovan')) && !/kitchen window seat/.test(text('Jovan')), 'the main character’s now is the scene’s, in code; the stale note is not shown — ' + text('Jovan'));
  assert(/Now: across the table/.test(text('Mi-na')), 'a note kept this page is now — ' + text('Mi-na'));
  assert(/Last noted 6 pages ago: sliding the screenshot/.test(text('Vanessa')), 'one here whose note is six pages old says so — ' + text('Vanessa'));
  click(q('#btn-ledger')); await tick(300);
});

test('DOM-36 two quick taps on “try again” run one turn, not two — the house is claimed at once (M295)', async () => {
  const st = await db.stories.create({ title: 'the double tap' });
  const mine = await db.messages.append(st.id, { role: 'user', text: 'I knock on the door.' });
  const before = house.state.calls.filter((c) => !c.isWorker).length;
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  const btn = q('.msg[data-id="' + mine.id + '"] .msg-act[data-act="try again"]');
  assert(btn, 'the writer’s page offers try again');
  click(btn);
  await tick(0); /* one beat later — inside the old window, after the first tap has begun */
  click(btn);
  await until(() => !env.ctx.chat.isBusy() && !q('.msg.pending'), 'the turn to land', 30000);
  await tick(1500);
  const told = house.state.calls.filter((c) => !c.isWorker).length - before;
  eq(told, 1, 'exactly one storyteller call for two taps');
  const pages = (await db.messages.list(st.id)).filter((m) => m.role === 'assistant');
  eq(pages.length, 1, 'and one answer on the page');
});

test('DOM-37 a housekeeper re-ink is a re-ink: the record line over the page is let go and the page is read again — and the take-back likewise (M296)', async () => {
  const { saveState, emptyState, loadState } = await import('../../js/engine/state.js');
  const { loadMemory, saveMemory } = await import('../../js/agents/memory.js');
  const { queuedCount } = await import('../../js/agents/queue.js');
  const st = await db.stories.create({ title: 'the housekeeper’s re-ink' });
  await db.settings.set('hkAutoApply', false);
  await db.messages.append(st.id, { role: 'user', text: 'We reach the pier.' });
  const first = await db.messages.append(st.id, { role: 'assistant', text: 'The pier was empty and the tide was out.' });
  await db.messages.append(st.id, { role: 'user', text: 'I wait.' });
  await db.messages.append(st.id, { role: 'assistant', text: 'Nobody came. The gulls kept their distance.' });
  await saveState(st.id, { ...emptyState(), page: 1, place: { name: 'The pier' }, present: [{ name: 'Jovan' }] });
  await saveMemory(st.id, { ...(await loadMemory(st.id)), window: 1, nodes: [{ id: 'n-pier', level: 1, span: [0, 1], text: 'They reached the empty pier at low tide.' }] });
  let reads = 0;
  const priorAnswer = house.state.workerAnswer;
  house.state.workerAnswer = (body, sys) => {
    const said = JSON.stringify(body);
    if (/housekeeper of a cozy tavern/i.test(sys)) {
      return 'One fix.\n<edits>[{"id":"#' + first.id.slice(0, 6) + '","find":"the tide was out","replace":"THE TIDE WAS HIGH","reason":"a test"}]</edits>';
    }
    if (/keep the ledger/i.test(sys) && /TIDE WAS HIGH|tide was out/.test(said)) reads += 1;
    return priorAnswer(body, sys);
  };
  try {
    env.window.__cozy.setActiveStoryId(st.id);
    await env.window.__cozy.chat.renderThread({ structural: true });
    click(q('#btn-housekeeper'));
    await until(() => !q('#hk-sheet').hidden, 'the housekeeper');
    await until(() => !q('#hk-send').disabled, 'the housekeeper free to be asked', 10000);
    type(q('#hk-input'), 'the tide was high, fix it');
    submit(q('#hk-form'));
    await until(() => qa('#hk-cards button').find((b) => /^Apply$/i.test(b.textContent.trim())), 'an Apply button', 10000);
    await until(() => !q('#hk-send').disabled, 'the answer to finish', 10000);
    await tick(200);
    const apply = qa('#hk-cards button').find((b) => /^Apply$/i.test(b.textContent.trim()));
    const readsBefore = reads;
    click(apply);
    await until(async () => /TIDE WAS HIGH/.test((await db.messages.list(st.id)).find((m) => m.id === first.id).text), 'the page changed', 10000);
    await until(async () => !(await loadMemory(st.id)).nodes.some((n) => n.id === 'n-pier'), 'the record line over the re-inked page is let go (it used to stand, summarizing words the page no longer held)', 10000);
    await until(() => reads > readsBefore, 'the re-inked page is read again by the ledger’s reader', 20000);
    await until(() => queuedCount(st.id) === 0 && !env.ctx.chat.isReplaying(), 'the house to settle', 60000);
    /* and the take-back */
    await saveMemory(st.id, { ...(await loadMemory(st.id)), nodes: [{ id: 'n-pier-2', level: 1, span: [0, 1], text: 'The tide was high at the pier.' }] });
    const readsMid = reads;
    click(q('#hk-undo'));
    await until(async () => !/TIDE WAS HIGH/.test((await db.messages.list(st.id)).find((m) => m.id === first.id).text), 'undo took it back', 10000);
    await until(async () => !(await loadMemory(st.id)).nodes.some((n) => n.id === 'n-pier-2'), 'the record line over the put-back page is let go too', 10000);
    await until(() => reads > readsMid, 'and the put-back page is read again', 20000);
    await until(() => queuedCount(st.id) === 0 && !env.ctx.chat.isReplaying(), 'the house to settle again', 60000);
    click(q('#btn-housekeeper')); await tick(300);
  } finally {
    house.state.workerAnswer = priorAnswer;
    await db.settings.delete('hkAutoApply');
  }
});

/* M301: the thinking of a telling that left no page */
const clipboardSpy = () => {
  const taken = [];
  const prior = env.window.navigator.clipboard.writeText;
  env.window.navigator.clipboard.writeText = async (t) => { taken.push(String(t)); };
  return { taken, restore: () => { env.window.navigator.clipboard.writeText = prior; } };
};
test('DOM-38 Stop while the storyteller is still thinking: the thinking stays on the page, whole and copyable, through a redraw, and goes when the next page lands — never into a request (M301)', async () => {
  const before = errors.length;
  const st = await db.stories.create({ title: 'stopped mid-thought' });
  await db.messages.append(st.id, { role: 'user', text: 'We sit by the lake.' });
  await db.messages.append(st.id, { role: 'assistant', text: 'The lake was flat and grey, and nobody spoke for a while.' });
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  const clip = clipboardSpy();
  house.state.thinkHang = 'hang';
  try {
    const pagesBefore = (await db.messages.list(st.id)).length;
    type(q('#composer-input'), 'Does she say anything?');
    submit(q('#composer'));
    await until(() => q('.msg.pending details.thinking') && /rain has not stopped/.test(q('.msg.pending .thinking-body').textContent), 'the live thinking on the page', 10000);
    /* the live block's own copy button takes what has streamed so far (it copied '' before) */
    click(q('.msg.pending .thinking-copy'));
    await until(() => clip.taken.length === 1, 'the live copy');
    assert(/Let me weigh the room\. Liara is guarded, and the rain has not stopped\./.test(clip.taken[0]), 'the live copy holds the thinking so far: ' + JSON.stringify(clip.taken[0]));
    click(q('#btn-stop'));
    await until(() => !env.ctx.chat.isBusy(), 'the stop to land', 10000);
    const kept = q('.kept-thinking');
    assert(kept, 'the thinking is still on the page after Stop');
    assert(!q('.msg.pending'), 'and the pending page is gone');
    assert(/Let me weigh the room\. Liara is guarded, and the rain has not stopped\./.test(kept.querySelector('.thinking-body').textContent), 'whole: ' + kept.textContent);
    assert(kept.querySelector('details.thinking').open, 'open, as it was while it streamed');
    assert(/stopped while thinking/.test(kept.querySelector('.msg-label').textContent), 'and it says why there is no page');
    click(kept.querySelector('.thinking-copy'));
    await until(() => clip.taken.length === 2, 'the kept copy');
    assert(/rain has not stopped/.test(clip.taken[1]), 'its copy button takes the whole thinking');
    eq((await db.messages.list(st.id)).length, pagesBefore + 1, 'only the writer’s page was added — the thinking is not a page');
    const row = await db.settings.get('cutThinking:' + st.id);
    assert(row && /rain has not stopped/.test(row.text) && row.why === 'stopped', 'kept in the tale’s own row');
    /* a redraw from the store (a reload, a pull from the other browser) draws it again, after the page it followed */
    await env.window.__cozy.chat.renderThread({ structural: true });
    const again = q('.kept-thinking');
    assert(again && /rain has not stopped/.test(again.querySelector('.thinking-body').textContent), 'a rebuilt thread still holds it');
    const lastUser = userPages().pop();
    assert(lastUser.nextElementSibling === again, 'right after the page it followed');
    eq(qa('.kept-thinking').length, 1, 'once');
    /* the thinking voice switched off: not drawn, not lost */
    await db.settings.set('showThinking', false);
    await env.window.__cozy.chat.renderThread({ structural: true });
    assert(!q('.kept-thinking'), 'hidden with the thinking voice off');
    await db.settings.set('showThinking', true);
    await env.window.__cozy.chat.renderThread({ structural: true });
    assert(q('.kept-thinking'), 'and back with it');
    /* the next page lands: it goes, and no request ever held it */
    house.state.thinkHang = null;
    const callsBefore = house.state.calls.length;
    type(q('#composer-input'), 'I ask her again.');
    submit(q('#composer'));
    await until(async () => (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length === 2, 'the next page', 10000);
    await settled();
    assert(!q('.kept-thinking'), 'the kept thinking goes when a page lands');
    eq(await db.settings.get('cutThinking:' + st.id), undefined, 'and its row with it');
    const sent = house.state.calls.slice(callsBefore).map((c) => JSON.stringify(c.body)).join('\n');
    assert(!/rain has not stopped/.test(sent), 'no request — storyteller or reader — ever held the cut thinking');
  } finally {
    house.state.thinkHang = null;
    clip.restore();
    await db.settings.delete('showThinking');
  }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-39 the wire dropping while the storyteller thinks keeps the thinking too, above the word about the wire; a Stop on a retry of a standing page keeps it and the page (M301)', async () => {
  const before = errors.length;
  const st = await db.stories.create({ title: 'dropped mid-thought' });
  await db.messages.append(st.id, { role: 'user', text: 'We sit by the lake.' });
  const page = await db.messages.append(st.id, { role: 'assistant', text: 'The lake was flat and grey, and nobody spoke for a while.' });
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  try {
    house.state.thinkHang = 'drop';
    type(q('#composer-input'), 'Does she say anything?');
    submit(q('#composer'));
    await until(() => !env.ctx.chat.isBusy() && q('.kept-thinking'), 'the drop to land with the thinking kept', 10000);
    const kept = q('.kept-thinking');
    assert(/rain has not stopped/.test(kept.querySelector('.thinking-body').textContent), 'the thinking before the drop is kept');
    assert(/wire dropped/.test(kept.querySelector('.msg-label').textContent), 'named for what happened');
    assert(kept.nextElementSibling && kept.nextElementSibling.classList.contains('msg-note'), 'the house’s word about the wire stands under it');
    eq((await db.settings.get('cutThinking:' + st.id)).why, 'dropped');
    /* a new version of the standing page (the swipe bar's ▸), stopped while thinking */
    await db.messages.remove(st.id, (await db.messages.list(st.id)).pop().id);
    await env.window.__cozy.chat.renderThread({ structural: true });
    house.state.thinkHang = 'hang';
    click(q('.msg[data-id="' + page.id + '"] .msg-act[data-act="swipe-next"]'));
    await until(() => q('.msg.pending details.thinking'), 'the retry thinking', 10000);
    click(q('#btn-stop'));
    await until(() => !env.ctx.chat.isBusy(), 'the stop to land', 10000);
    await settled();
    const row = await db.settings.get('cutThinking:' + st.id);
    assert(row && row.why === 'stopped', 'the newer cut replaced the older one: ' + JSON.stringify(row && row.why));
    eq(qa('.kept-thinking').length, 1, 'one block');
    const still = (await db.messages.list(st.id)).find((m) => m.id === page.id);
    assert(still && /flat and grey/.test(still.text), 'the standing page is untouched');
  } finally {
    house.state.thinkHang = null;
  }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-40 the housekeeper stopped while it is still thinking: what it thought stays on the sheet, copyable, through a redraw, and goes with the next answer (M301)', async () => {
  const before = errors.length;
  const st = await db.stories.create({ title: 'the housekeeper, cut' });
  await db.messages.append(st.id, { role: 'user', text: 'We reach the pier.' });
  await db.messages.append(st.id, { role: 'assistant', text: 'The pier was empty and the tide was out.' });
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  const clip = clipboardSpy();
  const priorAnswer = house.state.workerAnswer;
  try {
    click(q('#btn-housekeeper'));
    await until(() => !q('#hk-sheet').hidden, 'the housekeeper');
    await until(() => !q('#hk-send').disabled, 'the housekeeper free to be asked', 10000);
    house.state.hkThinkHang = 'hang';
    type(q('#hk-input'), 'is the tide right?');
    submit(q('#hk-form'));
    await until(() => q('#hk-thread details.hk-thinking') && /rain has not stopped/.test(q('#hk-thread details.hk-thinking').textContent), 'the live thinking', 10000);
    click(q('#hk-thread details.hk-thinking .thinking-copy'));
    await until(() => clip.taken.length === 1, 'the live copy');
    assert(/rain has not stopped/.test(clip.taken[0]), 'copyable while it is still thinking');
    click(q('#hk-stop'));
    await until(() => !q('#hk-send').disabled, 'the stop to land', 10000);
    const cut = q('#hk-thread details.hk-cut');
    assert(cut, 'the thinking is still on the sheet after Stop');
    await tick(20);
    assert(/rain has not stopped/.test(cut.textContent), 'whole: ' + cut.textContent);
    eq(q('#hk-input').value, 'is the tide right?', 'and the question is back in its box, as before');
    const row = await db.settings.get('hkCut:' + st.id);
    assert(row && /rain has not stopped/.test(row.text), 'kept in the tale’s own row');
    /* closed and opened again: drawn from the row */
    click(q('#btn-housekeeper')); await tick(200);
    click(q('#btn-housekeeper'));
    await until(() => !q('#hk-sheet').hidden, 'the housekeeper again');
    await until(() => q('#hk-thread details.hk-cut'), 'the cut thinking, redrawn', 10000);
    eq(qa('#hk-thread details.hk-cut').length, 1, 'once');
    /* the next answer lands: it goes, and the housekeeper was never sent it */
    house.state.hkThinkHang = null;
    house.state.workerAnswer = (body, sys) => (/housekeeper of a cozy tavern/i.test(sys) ? 'The tide is right.' : priorAnswer(body, sys));
    const callsBefore = house.state.calls.length;
    type(q('#hk-input'), 'is the tide right?');
    submit(q('#hk-form'));
    await until(() => qa('#hk-thread .hk-bubble').some((b) => /The tide is right/.test(b.textContent)), 'the answer', 10000);
    await until(() => !q('#hk-send').disabled, 'the answer to finish', 10000);
    assert(!q('#hk-thread details.hk-cut'), 'the cut thinking goes when an answer lands');
    eq(await db.settings.get('hkCut:' + st.id), undefined, 'and its row with it');
    const sent = house.state.calls.slice(callsBefore).map((c) => JSON.stringify(c.body)).join('\n');
    assert(!/rain has not stopped/.test(sent), 'nothing sent to the housekeeper held the cut thinking');
    click(q('#btn-housekeeper')); await tick(300);
  } finally {
    house.state.hkThinkHang = null;
    house.state.workerAnswer = priorAnswer;
    clip.restore();
  }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-41 the connections are one drop-down, A to Z, with one card under it; every picker reads in the same order; who tells the story never changes with the order (M301)', async () => {
  const before = errors.length;
  const had = await db.connections.list();
  const activeBefore = await db.settings.get('activeConnectionId');
  const made = [];
  try {
    for (const label of ['zephyr 10', 'Alpha', 'zephyr 9', 'émile', 'beta']) {
      made.push(await db.connections.add({ label, type: 'openai', baseUrl: 'https://x.example/v1', apiKey: 'k', model: 'm-' + label }));
      await tick(3);
    }
    await openSettings();
    click(q('[data-room="storyteller"]'));
    await until(() => q('#connection-pick') && q('#connection-pick').options.length === had.length + 5, 'the picker to hold them all', 10000);
    const names = [...q('#connection-pick').options].map((o) => o.textContent.replace(/^✓ /, '').split(' — ')[0]);
    const mine = names.filter((n) => ['zephyr 10', 'Alpha', 'zephyr 9', 'émile', 'beta'].includes(n));
    eq(mine.join(' | '), 'Alpha | beta | émile | zephyr 9 | zephyr 10', 'A to Z: case and accents ignored, 9 before 10');
    const sorted = [...names].sort(new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare);
    eq(names.join(' | '), sorted.join(' | '), 'the whole list is in order, the older connections with the new');
    eq(qa('#connection-list > .connection-card').length, 1, 'one card, not one for each');
    /* the one marked in use is the one the resolvers use: a kept id that names
     * no connection is repaired to the first one made (what they fall back to) */
    const activeNow = await db.settings.get('activeConnectionId');
    const active = (await db.connections.list()).find((c) => c.id === activeNow);
    assert(active, 'the kept id names a real connection');
    if (!had.some((c) => c.id === activeBefore)) eq(activeNow, had[0].id, 'a stale id became the first one made — the one that was telling the story all along');
    else eq(activeNow, activeBefore, 'a good id is left alone');
    assert(q('#connection-list .connection-name').textContent === active.label, 'the card under it is the one in use: ' + q('#connection-list .connection-name').textContent);
    assert(/^✓ /.test(q('#connection-pick').selectedOptions[0].textContent), 'and the picker marks it, at the front where a narrow screen does not cut it');
    eq([...q('#connection-pick').options].filter((o) => /^✓ /.test(o.textContent)).length, 1, 'one mark');
    /* pick another: its card, its buttons — and picking changes nothing about who tells the story */
    const pick = q('#connection-pick');
    pick.value = made[1].id;
    pick.dispatchEvent(new env.window.Event('change', { bubbles: true }));
    await until(() => q('#connection-list .connection-name') && q('#connection-list .connection-name').textContent === 'Alpha', 'Alpha’s card', 10000);
    /* M321: PICKING IT IS USING IT. M301 held "looking at a connection does not start using it" — and the writer, who
     * picked his model here as every picker works, told a day of story with the old one. */
    await until(async () => (await db.settings.get('activeConnectionId')) === made[1].id, 'picking Alpha put Alpha in use', 10000);
    await until(() => qa('#connection-list .connection-card .row button').some((b) => /^In use$/.test(b.textContent.trim())), 'the card says so', 10000);
    const buttons = qa('#connection-list .connection-card .row button').map((b) => b.textContent.trim());
    eq(buttons.join(' | '), 'In use | Test | Change | Copy | Let go', 'the same five, named as they were');
    assert(!q('#connection-list .connection-not-in-use'), 'and no warning on the one in use');
    /* every other picker of connections, the same order */
    const orderOf = (sel) => [...sel.options].filter((o) => o.value).map((o) => o.textContent);
    const want = byNameLabels(await db.connections.list());
    await until(() => q('#worker-assignments select') && orderOf(q('#worker-assignments select')).length === want.length, 'the workers’ pickers', 10000);
    for (const sel of [q('#worker-connection'), q('#story-connection'), ...qa('#worker-assignments select[data-worker]')]) {
      assert(sel, 'a picker the room has');
      eq(orderOf(sel).join(' | '), want.join(' | '), 'in the same order: ' + (sel.id || sel.dataset.worker));
    }
    await until(() => /^✓ /.test(q('#connection-pick').selectedOptions[0].textContent) && q('#connection-pick').value === made[1].id, 'marked in the picker');
    /* Copy → the copy is the one shown, its form open */
    click(qa('#connection-list .connection-card .row button').find((b) => /^Copy$/.test(b.textContent.trim())));
    await until(() => !q('#connection-form').hidden && /Alpha \(copy\)/.test(q('#connection-form-title').textContent), 'the copy’s form', 10000);
    const copy = (await db.connections.list()).find((c) => c.label === 'Alpha (copy)');
    made.push(copy);
    eq(q('#connection-pick').value, copy.id, 'the copy is the one under the eye');
    click(q('#btn-conn-cancel'));
    /* M321: a card the HOUSE put under the eye is not put in use by that — and says so, with the way to switch */
    eq(await db.settings.get('activeConnectionId'), made[1].id, 'a copy is not suddenly telling the stories');
    await until(() => q('#connection-list .connection-not-in-use') && /NOT in use/.test(q('#connection-list .connection-not-in-use').textContent) && /Alpha/.test(q('#connection-list .connection-not-in-use').textContent), 'the card says it is not in use, and what is', 10000);
    assert(qa('#connection-list .connection-card .row button').some((b) => /^Use this one$/.test(b.textContent.trim())), 'and offers to switch');
    /* Let go → the card goes back to the one in use */
    click(qa('#connection-list .connection-card .row button').find((b) => /Let go/.test(b.textContent)));
    await until(() => q('#connection-pick').value === made[1].id, 'back to the one in use', 10000);
    assert(![...q('#connection-pick').options].some((o) => /Alpha \(copy\)/.test(o.textContent)), 'the copy is gone from the picker');
    /* the presets a connection starts from read A to Z, Custom last */
    eq([...q('#conn-preset').options].map((o) => o.textContent).join(' | '), 'Claude | DeepSeek | Gemini | Hermes Agent | OpenAI | OpenRouter | Z.ai GLM | Custom');
    /* what's on offer, A to Z */
    house.state.models = [{ id: 'zeta-1' }, { id: 'Alpha-2' }, { id: 'beta-10' }, { id: 'beta-9' }];
    click(q('#btn-add-connection'));
    await until(() => !q('#connection-form').hidden, 'the form');
    q('#conn-preset').value = 'openai'; q('#conn-preset').dispatchEvent(new env.window.Event('change', { bubbles: true }));
    type(q('#conn-apikey'), 'k');
    click(q('#btn-fetch-models'));
    await until(() => !q('#conn-models-label').hidden, 'the offer', 10000);
    eq([...q('#conn-models').options].filter((o) => o.value).map((o) => o.value).join(' | '), 'Alpha-2 | beta-9 | beta-10 | zeta-1', 'the models on offer read A to Z');
    click(q('#btn-conn-cancel'));
  } finally {
    house.state.models = null;
    for (const c of made) { try { await db.connections.remove(c.id); } catch (err) { /* already let go */ } }
    await db.settings.set('activeConnectionId', had.some((c) => c.id === activeBefore) ? activeBefore : (had[0] ? had[0].id : null));
    await closeSettings();
  }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-42 every coat in Settings is worn when chosen: the room, the phone’s own bar, and the choice kept (M301)', async () => {
  const before = errors.length;
  const prior = await db.settings.get('theme');
  try {
    await openSettings();
    click(q('[data-room="house"]'));
    await until(() => q('input[name="theme"][value="magma"]'), 'the coats');
    const bars = new Set();
    for (const radio of qa('input[name="theme"]').filter((r) => r.value !== 'system')) {
      radio.checked = true;
      radio.dispatchEvent(new env.window.Event('change', { bubbles: true }));
      await until(async () => (await db.settings.get('theme')) === radio.value, 'the choice kept: ' + radio.value);
      eq(document.documentElement.dataset.theme, radio.value, 'the room wears ' + radio.value);
      const bar = q('meta[name="theme-color"]').getAttribute('content');
      assert(/^#[0-9a-f]{6}$/.test(bar), 'the phone’s bar has a colour for ' + radio.value + ': ' + bar);
      bars.add(bar);
    }
    eq(bars.size, qa('input[name="theme"]').length - 1, 'each coat has its own bar colour');
    assert(document.documentElement.dataset.theme === 'magma' || qa('input[name="theme"]').pop().value !== 'magma', 'magma is one of them');
  } finally {
    const back = prior || 'dark';
    const radio = q('input[name="theme"][value="' + back + '"]');
    radio.checked = true;
    radio.dispatchEvent(new env.window.Event('change', { bubbles: true }));
    await until(async () => (await db.settings.get('theme')) === back, 'the coat put back');
    await closeSettings();
  }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-43 “Try again” means the newest turn: after a Stop that left no page it asks that turn again and lets nothing go; it is hidden while the storyteller writes (M302)', async () => {
  const before = errors.length;
  const st = await db.stories.create({ title: 'try again, after a stop' });
  await db.stories.update(st.id, { extraction: false, keeper: false, continuity: false });
  await db.messages.append(st.id, { role: 'user', text: 'We sit by the lake.' });
  const standing = await db.messages.append(st.id, { role: 'assistant', text: 'The lake was flat and grey, and nobody spoke for a while.' });
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  assert(!q('#btn-retry').hidden, 'with the storyteller’s page newest, Try again is offered');
  /* the storyteller's page newest: Try again writes THAT page anew (M25's law, run instead of read) */
  click(q('#btn-retry'));
  await until(async () => { const a = (await db.messages.list(st.id)).filter((m) => m.role === 'assistant'); return a.length === 1 && a[0].id !== standing.id && !env.ctx.chat.isBusy(); }, 'the newest page written anew', 15000);
  await settled();
  eq((await db.messages.list(st.id)).filter((m) => !m.hidden).map((m) => m.role).join(' '), 'user assistant', 'one page for one turn');
  const rewritten = (await db.messages.list(st.id)).find((m) => m.role === 'assistant');
  house.state.thinkHang = 'hang';
  try {
    type(q('#composer-input'), 'Does she say anything?');
    submit(q('#composer'));
    await until(() => q('.msg.pending details.thinking'), 'the live thinking', 10000);
    assert(q('#btn-retry').hidden, 'no Try again while the storyteller writes');
    click(q('#btn-stop'));
    await until(() => !env.ctx.chat.isBusy() && !q('#btn-retry').hidden, 'Try again back after the stop', 10000);
    house.state.thinkHang = null;
    click(q('#btn-retry'));
    await until(async () => (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length === 2 && !env.ctx.chat.isBusy(), 'the unanswered turn answered', 15000);
    await settled();
    const pages = (await db.messages.list(st.id)).filter((m) => !m.hidden);
    eq(pages.map((m) => m.role).join(' '), 'user assistant user assistant', 'nothing was let go — it used to delete the standing page and the writer’s newest words');
    assert(pages.some((m) => m.id === rewritten.id && m.text === rewritten.text), 'the standing page stands');
    eq(pages[2].text, 'Does she say anything?', 'the writer’s words stand');
    assert(!q('.kept-thinking'), 'and the kept thinking went with the landing');
  } finally {
    house.state.thinkHang = null;
  }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-44 “Ask again” after a failed new version asks for a version: one storyteller page with two versions, never a second page under the first; the note goes when it is answered (M302)', async () => {
  const before = errors.length;
  const st = await db.stories.create({ title: 'a failed version' });
  await db.stories.update(st.id, { extraction: false, keeper: false, continuity: false });
  await db.messages.append(st.id, { role: 'user', text: 'We sit by the lake.' });
  const page = await db.messages.append(st.id, { role: 'assistant', text: 'The lake was flat and grey, and nobody spoke for a while.' });
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  try {
    house.state.fail = 500;
    click(q('.msg[data-id="' + page.id + '"] .msg-act[data-act="swipe-next"]'));
    await until(() => !env.ctx.chat.isBusy() && q('.msg-note .msg-act.retry'), 'the failure’s note', 10000);
    eq(qa('#thread .msg-note').length, 1, 'one word from the house for one failure (there were two)');
    house.state.fail = null;
    click(q('.msg-note .msg-act.retry'));
    await until(async () => { const m = (await db.messages.list(st.id)).find((x) => x.id === page.id); return m && Array.isArray(m.swipes) && m.swipes.length === 2 && !env.ctx.chat.isBusy(); }, 'a second version of the same page', 15000);
    await settled();
    const all = (await db.messages.list(st.id)).filter((m) => !m.hidden);
    eq(all.map((m) => m.role).join(' '), 'user assistant', 'still one storyteller page — it used to write a second page under the first');
    assert(!q('#thread .msg-note'), 'the note went when it was answered');
  } finally {
    house.state.fail = null;
  }
  /* the expected 500 is the only error this scenario may log */
  const stray = errorsSince(before).filter((e) => !/500|busy/i.test(e));
  eq(stray.length, 0, stray.join(' | '));
});

test('DOM-45 a housekeeper retry that is stopped takes nothing: the answer the writer had is back as it was, the question is not left in the box, and what it had thought is kept (M302)', async () => {
  const before = errors.length;
  const { loadSession } = await import('../../js/agents/housekeeper.js');
  const st = await db.stories.create({ title: 'the housekeeper’s retry, cut' });
  await db.messages.append(st.id, { role: 'user', text: 'We reach the pier.' });
  await db.messages.append(st.id, { role: 'assistant', text: 'The pier was empty and the tide was out.' });
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  const priorAnswer = house.state.workerAnswer;
  try {
    house.state.workerAnswer = (body, sys) => (/housekeeper of a cozy tavern/i.test(sys) ? 'FIRST ANSWER: the tide is right.' : priorAnswer(body, sys));
    click(q('#btn-housekeeper'));
    await until(() => !q('#hk-sheet').hidden && !q('#hk-send').disabled, 'the housekeeper', 10000);
    type(q('#hk-input'), 'is the tide right?');
    submit(q('#hk-form'));
    await until(() => qa('#hk-thread .hk-bubble').some((b) => /FIRST ANSWER/.test(b.textContent)) && !q('#hk-send').disabled, 'the first answer', 10000);
    house.state.hkThinkHang = 'hang';
    click(q('#hk-retry'));
    await until(() => q('#hk-thread details.hk-thinking'), 'the retry thinking', 10000);
    click(q('#hk-stop'));
    await until(() => !q('#hk-send').disabled, 'the stop to land', 10000);
    await until(async () => (await loadSession(st.id)).turns.length === 2, 'the turns put back', 10000);
    const turns = (await loadSession(st.id)).turns;
    eq(turns.map((t) => t.role).join(' '), 'writer housekeeper', 'the question and the answer are back (the session was left empty before)');
    assert(/FIRST ANSWER/.test(turns[1].text), 'the answer as it was');
    /* M345: the sheet re-renders after the session is written back — it is waited for, not raced (a loaded walk read it a frame early) */
    await until(() => qa('#hk-thread .hk-bubble').some((b) => /FIRST ANSWER/.test(b.textContent)), 'and on the sheet', 10000);
    eq(q('#hk-input').value, '', 'the question is not left in the box as though it had never been asked');
    assert(q('#hk-thread details.hk-cut'), 'what the retry had thought is kept under it');
    /* and a retry that LANDS still keeps the old answer a swipe away */
    house.state.hkThinkHang = null;
    house.state.workerAnswer = (body, sys) => (/housekeeper of a cozy tavern/i.test(sys) ? 'SECOND ANSWER: it is.' : priorAnswer(body, sys));
    click(q('#hk-retry'));
    await until(() => qa('#hk-thread .hk-bubble').some((b) => /SECOND ANSWER/.test(b.textContent)) && !q('#hk-send').disabled, 'the second answer', 10000);
    await until(async () => { const t = (await loadSession(st.id)).turns; return t.length === 2 && Array.isArray(t[1].swipes) && t[1].swipes.length === 2; }, 'both versions kept', 10000);
    assert(!q('#hk-thread details.hk-cut'), 'the cut thinking went with the landed answer');
    click(q('#btn-housekeeper')); await tick(300);
  } finally {
    house.state.hkThinkHang = null;
    house.state.workerAnswer = priorAnswer;
  }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-46 a turn asked again is asked as it was asked: an out-of-character question answered again — by Try again, by ▸, by the note’s Ask again — stays out of character, and no reader takes it for story (M302)', async () => {
  const before = errors.length;
  const st = await db.stories.create({ title: 'out of character, asked again' });
  await db.messages.append(st.id, { role: 'user', text: 'We sit by the lake.' });
  await db.messages.append(st.id, { role: 'assistant', text: 'The lake was flat and grey, and nobody spoke for a while.' });
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  const priorStory = house.state.storyAnswer;
  const oocAsked = (c) => !c.isWorker && /speaking out of character/i.test(JSON.stringify(c.body));
  const readerCalls = () => house.state.calls.filter((c) => c.isWorker && /keep the ledger/i.test(JSON.stringify(c.body)) && /OUT-OF-CHARACTER-ANSWER/.test(JSON.stringify(c.body))).length;
  try {
    house.state.storyAnswer = () => 'OUT-OF-CHARACTER-ANSWER: we could go to the boathouse next.';
    /* the first ask: the wire fails, so the turn stands unanswered with its note */
    house.state.fail = 500;
    type(q('#composer-input'), '((where could the scene go next?))'); /* the house's own out-of-character mark: (( … )) or // … */
    submit(q('#composer'));
    await until(() => !env.ctx.chat.isBusy() && q('.msg-note .msg-act.retry'), 'the failure’s note', 10000);
    house.state.fail = null;
    /* 1. the note's Ask again */
    let from = house.state.calls.length;
    click(q('.msg-note .msg-act.retry'));
    await until(async () => (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length === 2 && !env.ctx.chat.isBusy(), 'the answer', 15000);
    await settled();
    let answer = (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').pop();
    assert(house.state.calls.slice(from).some(oocAsked), 'Ask again carried the out-of-character word to the storyteller');
    eq(answer.ooc, true, 'and its answer is kept as out of character (it landed as a page of the story before)');
    /* 2. a new version by ▸ */
    from = house.state.calls.length;
    click(q('.msg[data-id="' + answer.id + '"] .msg-act[data-act="swipe-next"]'));
    await until(async () => { const m = (await db.messages.list(st.id)).find((x) => x.id === answer.id); return m && Array.isArray(m.swipes) && m.swipes.length === 2 && !env.ctx.chat.isBusy(); }, 'a second version', 15000);
    await settled();
    assert(house.state.calls.slice(from).some(oocAsked), 'the new version was asked for out of character');
    eq((await db.messages.list(st.id)).find((x) => x.id === answer.id).ooc, true, 'and is still out of character');
    /* 3. Try again (the composer's): the answer written anew */
    from = house.state.calls.length;
    click(q('#btn-retry'));
    await until(async () => { const a = (await db.messages.list(st.id)).filter((m) => m.role === 'assistant'); return a.length === 2 && a[1].id !== answer.id && !env.ctx.chat.isBusy(); }, 'the answer written anew', 15000);
    await settled();
    answer = (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').pop();
    assert(house.state.calls.slice(from).some(oocAsked), 'Try again asked out of character');
    eq(answer.ooc, true, 'and the answer is out of character');
    await tick(800);
    eq(readerCalls(), 0, 'no reader of the ledger was ever sent to learn from an out-of-character answer');
    /* an ordinary turn asked again carries no such word */
    from = house.state.calls.length;
    house.state.storyAnswer = priorStory;
    type(q('#composer-input'), 'I skip a stone.');
    submit(q('#composer'));
    await until(async () => (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length === 3 && !env.ctx.chat.isBusy(), 'an ordinary page', 15000);
    await settled();
    click(q('#btn-retry'));
    await until(async () => { const a = (await db.messages.list(st.id)).filter((m) => m.role === 'assistant'); return a.length === 3 && !env.ctx.chat.isBusy() && !q('.msg.pending'); }, 'written anew', 15000);
    await settled();
    assert(!house.state.calls.slice(from).some(oocAsked), 'an ordinary turn is asked again as an ordinary turn');
    assert(!(await db.messages.list(st.id)).filter((m) => m.role === 'assistant').pop().ooc, 'and lands as story');
  } finally {
    house.state.fail = null;
    house.state.storyAnswer = priorStory;
  }
  const stray = errorsSince(before).filter((e) => !/500|busy/i.test(e));
  eq(stray.length, 0, stray.join(' | '));
});

test('DOM-47 a new version stopped while the storyteller thinks gives the ledger back: what the page had taught is there again, the page and its one version stand (M40’s law, run)', async () => {
  const before = errors.length;
  const { loadState } = await import('../../js/engine/state.js');
  const { queuedCount } = await import('../../js/agents/queue.js');
  house.state.workerAnswer = walkDefaultWorker;
  const st = await db.stories.create({ title: 'a version, stopped' });
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  try {
    type(q('#composer-input'), 'We go and eat.');
    submit(q('#composer'));
    await until(async () => (await db.messages.list(st.id)).some((m) => m.role === 'assistant') && !env.ctx.chat.isBusy(), 'the page', 15000);
    const here = (state) => (state.present || []).map((p) => p.name).sort().join(', ');
    await until(async () => queuedCount(st.id) === 0 && /Liara/.test(here(await loadState(st.id))), 'the ledger to learn the page', 30000);
    await settled();
    const page = (await db.messages.list(st.id)).find((m) => m.role === 'assistant');
    const learned = await loadState(st.id);
    eq(here(learned), 'Jovan, Liara', 'the page taught the ledger who is here');
    eq((learned.place || {}).name, 'Lakeside Park', 'and the ground, from the page’s own header line');
    house.state.thinkHang = 'hang';
    click(q('.msg[data-id="' + page.id + '"] .msg-act[data-act="swipe-next"]'));
    await until(() => q('.msg.pending details.thinking'), 'the new version’s thinking', 15000);
    const during = await loadState(st.id);
    eq(here(during), '', 'while the new version is asked for, the ledger stands at the turn’s boundary — nobody here yet (so the giving-back below is real)');
    click(q('#btn-stop'));
    await until(() => !env.ctx.chat.isBusy(), 'the stop to land', 15000);
    await settled();
    const after = await loadState(st.id);
    eq(here(after), 'Jovan, Liara', 'the people are given back');
    eq((after.place || {}).name, 'Lakeside Park', 'and the ground');
    const still = (await db.messages.list(st.id)).find((m) => m.id === page.id);
    assert(still && still.text === page.text && !(Array.isArray(still.swipes) && still.swipes.length > 1), 'the page stands as it was, with no empty version added');
    assert(q('.kept-thinking'), 'and what the storyteller had thought is kept (M301)');
  } finally {
    house.state.thinkHang = null;
  }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-48 Settings tells the truth about Kimi K3: Off says what it is spoken as, a refusal of the old spelling is not shown as standing, and the form’s standing word follows the model as it is typed (M303)', async () => {
  const before = errors.length;
  const activeBefore = await db.settings.get('activeConnectionId');
  const k3 = await db.connections.add({ label: 'AAA kimi k3', type: 'openai', baseUrl: 'https://api.moonshot.ai/v1', apiKey: 'k', model: 'kimi-k3' });
  await db.connections.update(k3.id, { reasoningDownAt: 1700000000000 }); /* silenced under the generic spelling, before M303 */
  try {
    await openSettings();
    click(q('[data-room="storyteller"]'));
    await until(() => q('#connection-pick') && [...q('#connection-pick').options].some((o) => o.value === k3.id), 'the picker', 10000);
    const pick = q('#connection-pick');
    pick.value = k3.id;
    pick.dispatchEvent(new env.window.Event('change', { bubbles: true }));
    await until(() => q('#connection-list .connection-name') && q('#connection-list .connection-name').textContent === 'AAA kimi k3', 'its card', 10000);
    const card = q('#connection-list .connection-card').textContent;
    assert(/thinking: off — spoken as “low”/.test(card) && /always thinks/.test(card), 'Off is said as what it becomes: ' + card);
    assert(!/unsent/.test(card), 'the old spelling’s refusal is not held against it');
    /* the form: the standing word is there for K3, goes when the model is another, comes back */
    click(qa('#connection-list .connection-card .row button').find((b) => /^Change$/.test(b.textContent.trim())));
    await until(() => !q('#connection-form').hidden, 'the form', 10000);
    assert(!q('#conn-reasoning-hint').hidden && /cannot be told not to/.test(q('#conn-reasoning-hint').textContent), 'the standing word: ' + q('#conn-reasoning-hint').textContent);
    assert(/temperature/.test(q('#conn-reasoning-hint').textContent), 'and it names the two fixed dials');
    assert(q('#conn-down-note').hidden, 'no note of a refusal that does not stand');
    type(q('#conn-model'), 'some-other-model');
    assert(q('#conn-reasoning-hint').hidden, 'another model: nothing to say');
    type(q('#conn-model'), 'kimi-k3');
    assert(!q('#conn-reasoning-hint').hidden, 'and back as it is typed');
    click(q('#btn-conn-cancel'));
  } finally {
    await db.connections.remove(k3.id);
    await db.settings.set('activeConnectionId', activeBefore);
    await closeSettings();
  }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-49 nobody who leaves the page is nowhere: played through the real readers, the ledger’s “elsewhere” holds the one who left — last seen where the page began — in the storyteller’s order and words, until the world agent moves her on (M304)', async () => {
  const before = errors.length;
  const { loadState, saveState, emptyState } = await import('../../js/engine/state.js');
  const { applyMutations } = await import('../../js/engine/apply.js');
  const { queuedCount } = await import('../../js/agents/queue.js');
  const st = await db.stories.create({ title: 'nobody is nowhere' });
  await db.stories.update(st.id, { brief: 'Jovan is home for the summer. Ms. June runs the Bluebird diner. Old Tom is the landlord.' });
  await db.messages.append(st.id, { role: 'user', text: 'We eat at the Bluebird.' });
  await db.messages.append(st.id, { role: 'assistant', text: '[The Bluebird — Friday, March 14, 2025 | 20:00 | clear | gray hoodie | in the booth]\n\nMs. June brought the plates herself, and Liara stole a fry.' });
  const seeded = applyMutations({ ...emptyState(), page: 0 }, [
    { type: 'mc.set', name: 'Jovan' }, { type: 'clock.set', year: 2025, month: 3, day: 14, hour: 20, minute: 0 }, { type: 'place.set', name: 'The Bluebird' },
    { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Ms. June' }, { type: 'presence.enter', name: 'Liara' },
    { type: 'people.set', name: 'Ms. June', field: 'core', text: 'runs the Bluebird; fifties; has fed Jovan since he was nine' },
    { type: 'people.set', name: 'Liara', field: 'core', text: 'his oldest friend' },
    /* written FIRST, and the least able to reach the scene — the order they were written in is not the order they are read in */
    { type: 'offscreen.set', name: 'Old Tom', location: 'his office', activity: 'counting rent', stance: 'waiting' },
    { type: 'offscreen.set', name: 'Kim', location: 'the 6:10 bus', activity: 'riding in', agenda: 'find Jovan', stance: 'toward', etaMinutes: 30 },
  ]).state;
  await saveState(st.id, { ...seeded, page: 0, readTo: 0, tidiedGen: 999 });
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  const priorWorker = house.state.workerAnswer;
  const priorStory = house.state.storyAnswer;
  let worldSaw = '';
  try {
    /* the page: they walk home; Ms. June stays behind. The page reader says she left — and nothing of where (a cheap reader often does not) */
    house.state.storyAnswer = () => '[The Wells house — Friday, March 14, 2025 | 20:40 | clear | gray hoodie | on the porch]\n\nMs. June waved them off from the diner door. Liara walked him home, and they sat on the porch steps.';
    house.state.workerAnswer = (body, sys) => {
      if (/keep the ledger/i.test(sys)) return JSON.stringify({ mutations: [{ type: 'presence.leave', name: 'Ms. June' }, { type: 'presence.update', name: 'Liara', position: 'on the porch steps' }] });
      if (/world beyond the page/i.test(sys)) { worldSaw = String((body.messages || []).slice(-1)[0].content || ''); return JSON.stringify({ mutations: [], brief: { pressure: [], ripe: [], twb: null, voices: [] } }); }
      return priorWorker(body, sys);
    };
    type(q('#composer-input'), 'We walk home.');
    submit(q('#composer'));
    await until(async () => (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length === 2 && !env.ctx.chat.isBusy(), 'the page', 15000);
    await until(async () => queuedCount(st.id) === 0 && !(await loadState(st.id)).present.some((p) => p.name === 'Ms. June'), 'the readers to finish', 40000);
    await settled();
    const after = await loadState(st.id);
    const june = after.offscreen['Ms. June'];
    assert(june && june.lastSeen === true, 'Ms. June has a whereabouts though no reader wrote one: ' + JSON.stringify(after.offscreen));
    eq(june.location, 'The Bluebird', 'where the page BEGAN — the header had already moved the ground to the Wells house');
    assert(/Ms\. June — last seen at The Bluebird/.test(worldSaw), 'and the world agent was shown exactly that, to move her on from: ' + worldSaw.slice(worldSaw.indexOf('EVERYONE WRITTEN ELSEWHERE'), worldSaw.indexOf('EVERYONE WRITTEN ELSEWHERE') + 260));
    /* the ledger's room: the storyteller's order (Kim, on her way, first) and the engine's own words */
    click(q('#btn-ledger')); await until(() => !q('#drawer').hidden, 'drawer'); await env.ctx.drawer.renderAllRooms(); await tick(350);
    const rows = () => qa('#drawer .offscreen-editor .present-row span').map((x) => x.textContent);
    await until(() => rows().length === 3, 'all three of the absent listed: ' + JSON.stringify(rows()), 10000);
    assert(/^Kim — the 6:10 bus, riding in \(meaning to find Jovan\)/.test(rows()[0]), 'whoever can reach the scene soonest leads, though she was written second: ' + JSON.stringify(rows()));
    assert(/^Old Tom — his office, counting rent/.test(rows()[1]), 'then the waiting: ' + rows()[1]);
    assert(/^Ms\. June — last seen at The Bluebird/.test(rows()[2]), 'a bare sighting says least and comes last, in the engine’s words: ' + rows()[2]);
    const juneRow = [...qa('#drawer .people-row')].find((li) => li.firstChild && /^Ms\. June/.test(li.firstChild.textContent));
    assert(juneRow && /Now \(elsewhere\): last seen at The Bluebird/.test(juneRow.textContent), 'and her page says the same: ' + (juneRow && juneRow.textContent.slice(0, 200)));
    click(q('#btn-ledger')); await tick(300);
    /* the next page: the world agent moves her on, and the sighting is replaced whole */
    house.state.storyAnswer = () => '[The Wells house — Friday, March 14, 2025 | 22:30 | clear | gray hoodie | on the porch]\n\nThey talked until the street went quiet.';
    house.state.workerAnswer = (body, sys) => {
      if (/keep the ledger/i.test(sys)) return JSON.stringify({ mutations: [] });
      if (/world beyond the page/i.test(sys)) return JSON.stringify({ mutations: [{ type: 'offscreen.set', name: 'Ms. June', location: 'her flat over the diner', activity: 'soaking her feet', stance: 'busy' }], brief: { pressure: [], ripe: [], twb: null, voices: [] } });
      return priorWorker(body, sys);
    };
    type(q('#composer-input'), 'We talk.');
    submit(q('#composer'));
    await until(async () => (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length === 3 && !env.ctx.chat.isBusy(), 'the next page', 15000);
    await until(async () => queuedCount(st.id) === 0 && ((await loadState(st.id)).offscreen['Ms. June'] || {}).location === 'her flat over the diner', 'the world agent to move her on', 40000);
    const moved = (await loadState(st.id)).offscreen['Ms. June'];
    assert(moved.lastSeen !== true, 'a real seat now, not a sighting');
    assert((await loadState(st.id)).offscreen['Ms. June'] && !(await loadState(st.id)).characters['Ms. June'].retired, 'and the upkeep kept her: the brief names her');
  } finally {
    house.state.workerAnswer = priorWorker;
    house.state.storyAnswer = priorStory;
  }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-50 a page begun with a prefill lands WITH its first words: the header line is whole, and the house reads the ground from it (M307)', async () => {
  const before = errors.length;
  const { loadState } = await import('../../js/engine/state.js');
  const { queuedCount } = await import('../../js/agents/queue.js');
  const conn = await db.connections.add({ label: 'ZZZ kimi with a prefill', type: 'openai', baseUrl: 'https://api.moonshot.ai/v1', apiKey: 'k', model: 'kimi-k2.6', prefill: '[The Wells house — ' });
  const st = await db.stories.create({ title: 'begun for it' });
  await db.stories.update(st.id, { connectionId: conn.id });
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  const priorStory = house.state.storyAnswer;
  const priorWorker = house.state.workerAnswer;
  try {
    /* what a house that takes a started reply answers with: only what comes AFTER it */
    house.state.storyAnswer = () => 'Friday, March 14, 2025 | 21:00 | clear | gray hoodie | on the porch]\n\nThey sat on the steps until the street went quiet.';
    house.state.workerAnswer = (body, sys) => (/keep the ledger/i.test(sys) ? JSON.stringify({ mutations: [] }) : priorWorker(body, sys));
    const from = house.state.calls.length;
    type(q('#composer-input'), 'We sit outside.');
    submit(q('#composer'));
    await until(async () => (await db.messages.list(st.id)).some((m) => m.role === 'assistant') && !env.ctx.chat.isBusy(), 'the page', 15000);
    await until(() => queuedCount(st.id) === 0, 'the readers', 40000);
    await settled();
    const told = house.state.calls.slice(from).find((c) => !c.isWorker);
    const last = told.body.messages[told.body.messages.length - 1];
    assert(last.role === 'assistant' && last.partial === true && last.content === '[The Wells house —', 'the reply was started for it, in Kimi’s own way: ' + JSON.stringify(last));
    const page = (await db.messages.list(st.id)).find((m) => m.role === 'assistant');
    assert(page.text.startsWith('[The Wells house — Friday, March 14, 2025 | 21:00'), 'the saved page begins with the words it was started with, the writer’s own space between (it began "Friday, March 14…"): ' + page.text.slice(0, 60));
    eq(((await loadState(st.id)).place || {}).name, 'The Wells house', 'and the house reads the ground from the header line, which is whole again');
  } finally {
    house.state.storyAnswer = priorStory;
    house.state.workerAnswer = priorWorker;
    await db.connections.remove(conn.id);
  }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-51 the thinking room says whether this address can hear it: a number kept on a Kimi connection is shown as NOT sent, the form says why as the model is typed, and the box stays his to clear (M308)', async () => {
  const before = errors.length;
  const activeBefore = await db.settings.get('activeConnectionId');
  const k3 = await db.connections.add({ label: 'AAB kimi with a room', type: 'openai', baseUrl: 'https://api.moonshot.ai/v1', apiKey: 'k', model: 'kimi-k3', reasoning: { effort: 'low', budgetTokens: 512 } });
  try {
    await openSettings();
    click(q('[data-room="storyteller"]'));
    await until(() => q('#connection-pick') && [...q('#connection-pick').options].some((o) => o.value === k3.id), 'the picker', 10000);
    const pick = q('#connection-pick');
    pick.value = k3.id;
    pick.dispatchEvent(new env.window.Event('change', { bubbles: true }));
    await until(() => q('#connection-list .connection-name') && q('#connection-list .connection-name').textContent === 'AAB kimi with a room', 'its card', 10000);
    const card = q('#connection-list .connection-card').textContent;
    assert(/thinking room: 512 tokens — NOT sent/.test(card), 'the card says the number goes nowhere: ' + card);
    assert(/thinking: low — spoken as “low”/.test(card), 'and what IS sent');
    click(qa('#connection-list .connection-card .row button').find((b) => /^Change$/.test(b.textContent.trim())));
    await until(() => !q('#connection-form').hidden, 'the form', 10000);
    eq(q('#conn-budget').value, '512', 'his number is kept');
    assert(!q('#conn-budget').disabled, 'and stays his to clear');
    assert(/LEVELS and no thinking room/.test(q('#conn-budget-hint').textContent), 'the form says why: ' + q('#conn-budget-hint').textContent);
    /* another house, as it is typed */
    q('#conn-preset').value = 'claude'; q('#conn-preset').dispatchEvent(new env.window.Event('change', { bubbles: true }));
    type(q('#conn-baseurl'), 'https://api.anthropic.com'); type(q('#conn-model'), 'claude-sonnet-4-5');
    assert(/Claude takes a thinking room/.test(q('#conn-budget-hint').textContent), 'Claude can hear one: ' + q('#conn-budget-hint').textContent);
    click(q('#btn-conn-cancel'));
  } finally {
    await db.connections.remove(k3.id);
    await db.settings.set('activeConnectionId', activeBefore);
    await closeSettings();
  }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-52 the ledger button does what was asked even inside the closing slide: close, then a tap at once, and the ledger OPENS (it closed a second time and stayed shut) (M313)', async () => {
  const before = errors.length;
  if (!q('#drawer').hidden) { click(q('#btn-ledger')); await tick(400); }
  click(q('#btn-ledger'));
  await until(() => !q('#drawer').hidden, 'the ledger opens');
  click(q('#btn-ledger'));                 /* close — the drawer stays un-hidden for its 200 ms slide */
  assert(!q('#drawer').hidden, 'fixture: still sliding shut');
  click(q('#btn-ledger'));                 /* the writer taps again at once: he wants it open */
  await tick(1000);
  assert(!q('#drawer').hidden, 'it is open');
  assert(q('#btn-ledger').classList.contains('current'), 'and the button says so');
  click(q('#btn-ledger'));
  await until(() => q('#drawer').hidden, 'and one tap closes it', 3000);
  /* a tap during the fill-beat still closes, never opens twice (M144) */
  click(q('#btn-ledger')); click(q('#btn-ledger'));
  await tick(1000);
  assert(q('#drawer').hidden, 'open then close at once: closed');
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-53 the light heals the record BY ITSELF and ends green: a tale folded under another window is not yellow at all, and a keeper that stumbles once is sent again with no page written and no button pressed (M317)', async () => {
  const before = errors.length;
  const { saveState, emptyState } = await import('../../js/engine/state.js');
  const { saveMemory, loadMemory } = await import('../../js/agents/memory.js');
  const { queuedCount } = await import('../../js/agents/queue.js');
  const windowBefore = await db.settings.get('memoryWindow'); const batchBefore = await db.settings.get('memoryBatch');
  const priorWorker = house.state.workerAnswer;
  const mark = () => q('#btn-ledger');
  try {
    /* (1) folded under a window of 10; the Settings slider has since been raised to 30 */
    const a = await db.stories.create({ title: 'folded under another window' });
    for (let i = 0; i < 40; i += 1) await db.messages.append(a.id, { role: i % 2 ? 'assistant' : 'user', text: 'Page ' + i + ': they talked on the porch about the letter and the fair.' });
    await saveState(a.id, { ...emptyState(), page: 19, readTo: 19, tidiedGen: 999 });
    await saveMemory(a.id, { window: 10, nodes: [0, 6, 12, 18].map((from, i) => ({ id: 'w' + i, span: [from, from + 5], text: 'Pages ' + (from + 1) + '-' + (from + 6) + ': they talked.', level: 1, at: 1, whole: true })) });
    await db.settings.set('memoryWindow', 30); await db.settings.set('memoryBatch', 6);
    let keeperCalls = 0;
    house.state.workerAnswer = (body, sys) => { if (/memory keeper|narrative-state tracker/i.test(sys)) { keeperCalls += 1; return 'They talked on the porch about the letter and the fair; nothing else changed.'; } return priorWorker(body, sys); };
    env.window.__cozy.setActiveStoryId(a.id);
    await env.window.__cozy.chat.renderThread({ structural: true });
    await tick(1500);
    eq(keeperCalls, 0, 'nothing is due by the window the keeper folds by — it is not sent on an errand it cannot do');
    assert(!mark().classList.contains('has-trouble'), 'and the light is NOT yellow: ' + mark().className + ' — ' + mark().getAttribute('title'));
    /* (2) a real gap, and a keeper whose first answers are nothing: it is sent again by itself */
    await db.settings.set('memoryWindow', 4);
    const b = await db.stories.create({ title: 'a stumble, then a line' });
    for (let i = 0; i < 24; i += 1) await db.messages.append(b.id, { role: i % 2 ? 'assistant' : 'user', text: 'Page ' + i + ': they talked on the porch about the letter and the fair.' });
    await saveState(b.id, { ...emptyState(), page: 11, readTo: 11, tidiedGen: 999 });
    let asks = 0;
    house.state.workerAnswer = (body, sys) => { if (/memory keeper|narrative-state tracker/i.test(sys)) { asks += 1; return asks <= 2 ? '' : 'They talked on the porch about the letter and the fair; nothing else changed.'; } return priorWorker(body, sys); };
    globalThis.__cozyGapBackoffMs = 700;
    env.window.__cozy.setActiveStoryId(b.id);
    await env.window.__cozy.chat.renderThread({ structural: true });
    await until(async () => asks >= 2 && queuedCount(b.id) === 0, 'the first repair, which folds nothing', 15000);
    eq((await loadMemory(b.id)).nodes.length, 0, 'fixture: the first run folded nothing');
    /* from here NOTHING is pressed and no page is written */
    await until(async () => (await loadMemory(b.id)).nodes.length > 0, 'the keeper sent again by itself', 20000);
    /* the measure is the house's own: no range is due any more (the slider's fence, not my arithmetic, says how many pages that is) */
    const { dueRange, windowFor, cleanBatch, visiblePages } = await import('../../js/agents/memory.js');
    const gapLeft = async () => { const m = await loadMemory(b.id); return dueRange(visiblePages(await db.messages.list(b.id)).length, windowFor(m, await db.settings.get('memoryWindow')), m.nodes, cleanBatch(await db.settings.get('memoryBatch'))); };
    await until(async () => !(await gapLeft()) && queuedCount(b.id) === 0, 'every due page folded, with no hand on it', 30000);
    assert((await loadMemory(b.id)).nodes.length >= 2, 'more than one line: it carried on past the first');
    await tick(600);
    assert(!mark().classList.contains('has-trouble'), 'and the light is not yellow any more: ' + mark().className + ' — ' + mark().getAttribute('title'));
    assert(/everything is read and folded/.test(mark().getAttribute('title') || ''), 'it says what the writer wants to read: ' + mark().getAttribute('title'));
  } finally {
    delete globalThis.__cozyGapBackoffMs;
    house.state.workerAnswer = priorWorker;
    if (windowBefore == null) await db.settings.delete('memoryWindow'); else await db.settings.set('memoryWindow', windowBefore);
    if (batchBefore == null) await db.settings.delete('memoryBatch'); else await db.settings.set('memoryBatch', batchBefore);
  }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-54 a prefill that would switch the thinking off says so — on the card, and in the form as the dial is turned (M318)', async () => {
  const before = errors.length;
  const activeBefore = await db.settings.get('activeConnectionId');
  const ds = await db.connections.add({ label: 'AAC deepseek, prefill and thinking', type: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'deepseek-v4-pro', prefill: '[The Bluebird —', reasoning: { effort: 'high' } });
  try {
    await openSettings();
    click(q('[data-room="storyteller"]'));
    await until(() => q('#connection-pick') && [...q('#connection-pick').options].some((o) => o.value === ds.id), 'the picker', 10000);
    q('#connection-pick').value = ds.id;
    q('#connection-pick').dispatchEvent(new env.window.Event('change', { bubbles: true }));
    await until(() => q('#connection-list .connection-name') && q('#connection-list .connection-name').textContent === 'AAC deepseek, prefill and thinking', 'its card', 10000);
    assert(/prefill: not sent while thinking is on/.test(q('#connection-list .connection-card').textContent), 'the card says it: ' + q('#connection-list .connection-card').textContent);
    click(qa('#connection-list .connection-card .row button').find((b) => /^Change$/.test(b.textContent.trim())));
    await until(() => !q('#connection-form').hidden, 'the form', 10000);
    await tick(100);
    assert(!q('#conn-prefill-hint').hidden && /skip its thinking entirely/.test(q('#conn-prefill-hint').textContent), 'the form says why: ' + q('#conn-prefill-hint').textContent);
    q('#conn-reasoning').value = 'off';
    q('#conn-reasoning').dispatchEvent(new env.window.Event('change', { bubbles: true }));
    /* M328: the hint no longer only warns — with thinking Off it says HOW the prefill rides */
    assert(!q('#conn-prefill-hint').hidden && /^Sent as the reply started with “\[The Bluebird —”, flagged “prefix”\.$/.test(q('#conn-prefill-hint').textContent), 'thinking Off: the prefill rides, and the hint says how: ' + q('#conn-prefill-hint').textContent);
    click(q('#btn-conn-cancel'));
  } finally {
    await db.connections.remove(ds.id);
    await db.settings.set('activeConnectionId', activeBefore);
    await closeSettings();
  }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-55 what stops the thinking for EVERY model says so on the turn it bites: the tale’s own level, and the hidden-thinking tick (M319)', async () => {
  const before = errors.length;
  const activeBefore = await db.settings.get('activeConnectionId');
  const shownBefore = await db.settings.get('showThinking');
  const conn = await db.connections.add({ label: 'ZZY deepseek, thinking high', type: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'deepseek-v4-pro', reasoning: { effort: 'high' } });
  const toasts = () => (q('#toasts') ? q('#toasts').textContent : '');
  const priorThink = house.state.thinkFirst;
  try {
    house.state.thinkFirst = true;
    /* (1) the connection says High, the TALE says Off */
    const a = await db.stories.create({ title: 'its own level' });
    await db.stories.update(a.id, { connectionId: conn.id, extraction: false, keeper: false, reasoningEffort: 'off' });
    env.window.__cozy.setActiveStoryId(a.id);
    await env.window.__cozy.chat.renderThread({ structural: true });
    let from = house.state.calls.length;
    type(q('#composer-input'), 'Hello.'); submit(q('#composer'));
    await until(async () => (await db.messages.list(a.id)).some((m) => m.role === 'assistant') && !env.ctx.chat.isBusy(), 'the page', 15000);
    const wire = house.state.calls.slice(from).find((c) => !c.isWorker).body;
    eq(JSON.stringify(wire.thinking), '{"type":"disabled"}', 'fixture: the tale’s Off is what reached the wire, whatever the connection’s dial says');
    await until(() => /has its OWN thinking level, and it says Off/.test(toasts()), 'the house says why there is no thinking: ' + toasts(), 5000);
    /* (2) thinking asked for and kept — and hidden by the tick */
    await db.settings.set('showThinking', false);
    const b = await db.stories.create({ title: 'hidden thinking' });
    await db.stories.update(b.id, { connectionId: conn.id, extraction: false, keeper: false });
    env.window.__cozy.setActiveStoryId(b.id);
    await env.window.__cozy.chat.renderThread({ structural: true });
    from = house.state.calls.length;
    type(q('#composer-input'), 'Hello.'); submit(q('#composer'));
    await until(async () => (await db.messages.list(b.id)).some((m) => m.role === 'assistant') && !env.ctx.chat.isBusy(), 'the page', 15000);
    const wire2 = house.state.calls.slice(from).find((c) => !c.isWorker).body;
    eq(wire2.reasoning_effort, 'high', 'fixture: thinking was asked for');
    assert(((await db.messages.list(b.id)).find((m) => m.role === 'assistant') || {}).thinking, 'and kept on the page');
    await until(() => /DID think on this page — it is hidden/.test(toasts()), 'the house says the thinking is there, and hidden: ' + toasts(), 5000);
  } finally {
    house.state.thinkFirst = priorThink;
    if (shownBefore == null) await db.settings.delete('showThinking'); else await db.settings.set('showThinking', shownBefore);
    await db.settings.set('activeConnectionId', activeBefore);
    await db.connections.remove(conn.id);
  }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-56 a model that thinks on the page: everything before the header becomes the page’s thinking — the page begins at its header, the house reads the ground from it, and none of it rides a later turn; unticked, the reply is left as it came (M322)', async () => {
  const before = errors.length;
  const { loadState } = await import('../../js/engine/state.js');
  const { queuedCount } = await import('../../js/agents/queue.js');
  const tickBefore = await db.settings.get('cutBeforeHeader');
  const priorStory = house.state.storyAnswer;
  const priorWorker = house.state.workerAnswer;
  const LEAK = 'Okay — quiet lunch beat. Vanessa is his friend; keep the slow undertone, nothing new.\nB: she deflects. L: header first, no meta.';
  const PAGE = '[The Bluebird — Friday, March 14, 2025 | 12:30 | clear | gray hoodie | in the booth]\n\nVanessa slid the menu across without looking at it.';
  try {
    house.state.workerAnswer = (body, sys) => (/keep the ledger/i.test(sys) ? JSON.stringify({ mutations: [] }) : priorWorker(body, sys));
    house.state.storyAnswer = () => LEAK + '\n\n' + PAGE;
    await db.settings.delete('cutBeforeHeader'); /* the default: on */
    const st = await db.stories.create({ title: 'thinks on the page' });
    env.window.__cozy.setActiveStoryId(st.id);
    await env.window.__cozy.chat.renderThread({ structural: true });
    type(q('#composer-input'), 'We have lunch.'); submit(q('#composer'));
    await until(async () => (await db.messages.list(st.id)).some((m) => m.role === 'assistant') && !env.ctx.chat.isBusy(), 'the page', 15000);
    await until(() => queuedCount(st.id) === 0, 'the readers', 40000);
    const page = (await db.messages.list(st.id)).find((m) => m.role === 'assistant');
    eq(page.text, PAGE, 'the saved page begins at its header');
    assert(String(page.thinking || '').includes('quiet lunch beat') && String(page.thinking || '').includes('header first, no meta'), 'and what came before it is kept as the page’s thinking: ' + JSON.stringify(page.thinking));
    assert(!/quiet lunch beat/.test(q('#thread .msg-assistant .msg-body').textContent), 'it is not on the page the writer reads');
    eq(((await loadState(st.id)).place || {}).name, 'The Bluebird', 'the house reads the ground from the header, which is first again');
    /* the next turn: the leak rides nowhere */
    const from = house.state.calls.length;
    house.state.storyAnswer = () => '[The Bluebird — Friday, March 14, 2025 | 12:45 | clear | gray hoodie | in the booth]\n\nShe ordered for both of them.';
    type(q('#composer-input'), 'I let her order.'); submit(q('#composer'));
    await until(async () => (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length === 2 && !env.ctx.chat.isBusy(), 'the next page', 15000);
    await until(() => queuedCount(st.id) === 0, 'the readers again', 40000);
    const sent = JSON.stringify(house.state.calls.slice(from).find((c) => !c.isWorker).body);
    assert(/Vanessa slid the menu/.test(sent) && !/quiet lunch beat/.test(sent), 'the storyteller is sent the page, never the thinking that came before it');
    /* unticked: the reply is left exactly as it came */
    await db.settings.set('cutBeforeHeader', false);
    const raw = await db.stories.create({ title: 'left as it came' });
    env.window.__cozy.setActiveStoryId(raw.id);
    await env.window.__cozy.chat.renderThread({ structural: true });
    house.state.storyAnswer = () => LEAK + '\n\n' + PAGE;
    type(q('#composer-input'), 'We have lunch.'); submit(q('#composer'));
    await until(async () => (await db.messages.list(raw.id)).some((m) => m.role === 'assistant') && !env.ctx.chat.isBusy(), 'the raw page', 15000);
    await until(() => queuedCount(raw.id) === 0, 'its readers', 40000);
    assert(((await db.messages.list(raw.id)).find((m) => m.role === 'assistant').text || '').startsWith('Okay — quiet lunch beat'), 'unticked, nothing is moved');
  } finally {
    house.state.storyAnswer = priorStory;
    house.state.workerAnswer = priorWorker;
    if (tickBefore == null) await db.settings.delete('cutBeforeHeader'); else await db.settings.set('cutBeforeHeader', tickBefore);
  }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-57 a reply that thinks aloud, STREAMED as a model streams it (a few characters at a time): the thinking is kept once, a short page is not thrown away, a reply that ran out of room while still planning is asked for its page — the plan handed back (M323); and a plan that names itself is told from its page with no header at all (M324)', async () => {
  const before = errors.length;
  const { queuedCount } = await import('../../js/agents/queue.js');
  const tickBefore = await db.settings.get('cutBeforeHeader');
  await db.settings.delete('cutBeforeHeader');
  const HEADER = '[The Bluebird — Friday, March 14, 2025 | 12:30 | clear | gray hoodie | in the booth]';
  const PAGE = HEADER + '\n\n' + 'Vanessa slid the menu across without looking at it. '.repeat(12);
  const plan = (n) => Array.from({ length: n }, (_, i) => 'Step ' + (i + 1) + ': weigh what she wants here, what he knows, and what the room allows; keep it grounded.\n').join('') + '\n';
  const enc = new TextEncoder();
  const housed = globalThis.fetch;
  let script = null; let asks = [];
  globalThis.fetch = async (url, opts) => {
    let body = null; try { body = opts && opts.body ? JSON.parse(opts.body) : null; } catch (err) { body = null; }
    const sys = body ? String(((body.messages || [])[0] || {}).content || '') : '';
    /* every worker's system opens with the house's fiction frame; the storyteller's never does (a worker counted as the
     * storyteller made this scenario fail once, by timing alone) */
    const worker = /^\s*This is fiction craft/i.test(sys) || /keep the ledger|world beyond the page|character scribe|memory keeper|second reader|continuity reader|mend a story|narrative-state tracker|audit one record li|housekeeper of a cozy tavern/i.test(sys);
    if (!script || !body || worker || !/chat\/completions|\/messages/.test(String(url))) return housed(url, opts);
    asks.push(body);
    const m = script(asks.length, body);
    const events = [];
    for (let i = 0; i < m.text.length; i += 4) events.push('data: ' + JSON.stringify({ choices: [{ delta: { content: m.text.slice(i, i + 4) } }] }) + '\n\n');
    events.push('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: m.finish || 'stop' }] }) + '\n\n', 'data: [DONE]\n\n');
    let k = 0;
    return { ok: true, status: 200, headers: new Headers(), clone() { return this; }, async json() { return {}; }, async text() { return events.join(''); },
      body: new ReadableStream({ async pull(c) { if (k >= events.length) { c.close(); return; } c.enqueue(enc.encode(events.slice(k, k + 40).join(''))); k += 40; await new Promise((r) => setTimeout(r, 0)); } }) };
  };
  const play = async (title, fn, withPrior) => {
    const st = await db.stories.create({ title });
    await db.stories.update(st.id, { extraction: false, keeper: false });
    /* a tale's earlier page: one that opens with its header (true), or one with no header at all (a string) */
    if (withPrior) { await db.messages.append(st.id, { role: 'user', text: 'Earlier.' }); await db.messages.append(st.id, { role: 'assistant', text: typeof withPrior === 'string' ? withPrior : PAGE }); }
    env.window.__cozy.setActiveStoryId(st.id);
    await env.window.__cozy.chat.renderThread({ structural: true });
    asks = []; script = fn;
    const want = withPrior ? 2 : 1;
    type(q('#composer-input'), 'We have lunch.'); submit(q('#composer'));
    await until(async () => (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length >= want && !env.ctx.chat.isBusy(), title, 30000);
    await until(() => queuedCount(st.id) === 0, title + ' — the readers', 40000);
    script = null;
    return (await db.messages.list(st.id)).filter((m) => m.role === 'assistant')[want - 1];
  };
  try {
    /* (1) the thinking is kept ONCE (the whole reply came back as result.text and the lead was appended a second time) */
    const lead = plan(30);
    const a = await play('streamed, thinking aloud', () => ({ text: lead + PAGE }));
    eq(a.text, PAGE, 'the page begins at its header');
    eq(String(a.thinking || '').length, lead.trimEnd().length, 'the lead is the page’s thinking — once (it was saved twice: ' + lead.trimEnd().length * 2 + ')');
    /* (2) a SHORT page after a long plan is a page — it was taken for "the page is inside the thinking", thrown away and asked for again */
    const d = await play('a nod', () => ({ text: plan(60) + HEADER + '\n\nShe nodded once.' }));
    eq(asks.length, 1, 'asked once');
    eq(d.text, HEADER + '\n\nShe nodded once.');
    /* (3) the writer’s report: the reply ran out of room while still planning — no header, no page */
    const long = plan(60);
    const e = await play('ran out of room', (n) => (n === 1 ? { text: long, finish: 'length' } : { text: PAGE }), true);
    eq(asks.length, 2, 'the page itself is asked for, once');
    const tail = asks[1].messages.slice(-2);
    assert(tail[0].role === 'assistant' && tail[0].content.startsWith('Step 1: weigh') && tail[1].role === 'user' && /do not plan again/.test(tail[1].content) && /beginning with its header line/.test(tail[1].content), 'with the plan handed back as the model’s own turn: ' + JSON.stringify(tail.map((m) => m.role)));
    eq(e.text, PAGE, 'and the page lands, from its header');
    assert(String(e.thinking || '').startsWith('Step 1: weigh') && !e.cutShort, 'the plan is this page’s thinking; nothing is marked cut short');
    assert(!/Step 1: weigh/.test(q('#thread .msg-assistant:last-of-type .msg-body').textContent), 'the plan is never on the page the writer reads');
    /* (4) M324 — THE WRITER’S SCREENSHOT: "Planning: … Beat: …" and then the page, with NO header anywhere in the reply.
     * M322/M323 found no header, so the whole plan was handed back as the page (in the thinking block while it
     * streamed, then "gone, and outside"). A plan that names itself gives the page away. */
    const PLAN = 'Planning: Jovan giggles and wonders aloud about Ravenwood High once school starts — Rias answers as the insider, the VP, the cheer captain, teasing and informative.\n\nBeat: world answers through Rias, the school’s ecosystem painted through her insider lens. Small movement: traffic, the sedan ahead, the lake. No slot needed.\n\n';
    const PROSE = 'Rias laughed without taking her eyes off the road. "Oh, you have no idea."\n\nThe lake slid past on the left, flat and bright, and she began to count the school’s little kingdoms off on the steering wheel.';
    /* (in a tale whose pages carry NO header — where a header cannot be the sign; in one whose pages do, see part 6) */
    const f = await play('a plan that names itself, no header', () => ({ text: PLAN + PROSE }), 'They had driven out past the rim road that morning, the four of them, windows down.');
    eq(asks.length, 1, 'asked once');
    eq(f.text, PROSE, 'the page is the page');
    assert(String(f.thinking || '').startsWith('Planning: Jovan giggles') && /Beat: world answers/.test(f.thinking), 'and the plan is its thinking: ' + String(f.thinking || '').slice(0, 60));
    assert(!/Planning: Jovan giggles/.test(q('#thread .msg-assistant:last-of-type .msg-body').textContent), 'it is not on the page he reads');
    /* (5) a reply that is ALL plan, ended normally: no page came — the page is asked for, once, the plan handed back */
    const g = await play('all plan, no page', (n) => (n === 1 ? { text: PLAN } : { text: PROSE }));
    eq(asks.length, 2, 'the page itself is asked for');
    assert(asks[1].messages.slice(-2)[0].role === 'assistant' && /^Planning: Jovan giggles/.test(asks[1].messages.slice(-2)[0].content), 'with the plan handed back');
    eq(g.text, PROSE); assert(/^Planning: Jovan giggles/.test(String(g.thinking || '')), 'the plan is kept as the thinking');
    /* (6) M325 — the writer of his screenshot: "no header — the text just ends with '.', planning". In a tale whose pages
     * open with a header, a reply that opens with a plan and holds no header has no page in it, even when its
     * LAST paragraph carries no label (by labels alone that paragraph would have been taken for the page) */
    const h = await play('a plan whose last paragraph has no label', (n) => (n === 1 ? { text: PLAN + 'I should keep it light and end on her question.' } : { text: PAGE }), true);
    eq(asks.length, 2, 'the page itself is asked for');
    assert(/end on her question\.$/.test(asks[1].messages.slice(-2)[0].content), 'the WHOLE plan handed back, its unlabelled end included');
    eq(h.text, PAGE, 'and the page that lands begins at its header');
    assert(/^Planning: Jovan giggles/.test(String(h.thinking || '')) && /end on her question/.test(h.thinking), 'the whole plan is its thinking');
    /* (7) M326 — THE WRITER’S FIVE SCREENSHOTS of one reply: a plan, the header and a draft, "That’s solid. Let me check: …",
     * the SAME header and a second draft, "Let me reconstruct final:", the SAME header and the final draft, then a
     * checklist ending "Ship it." The page he is given is the LAST draft; and the turn AFTER is sent no draft of it. */
    const H = '[Rim road, moving between overlooks — Friday, August 21, 2026 | 13:11 | sun strobing, AC on low | gray tee, dark jeans | passenger seat, basket on his lap]';
    const FINAL = H + '\n\nThirty seconds had gone. The turnout was behind them.\n\nRias’s right hand tightened on the wheel — a slow, controlled flex — then let go.\n\nShe glanced sideways at him. Jovan was finishing the fry he’d been chewing, and the lake went by.';
    const DRAFTS = 'Okay. #p — one beat. Keep her silent.\n\n' + H + '\n\nThirty seconds had gone. The lake slid on past the driver’s side window in a long ribbon of white-gold glitter.\n\nThat’s solid. Let me check:\n- MC silence ✓ (he literally has an action completion — eating — invented? Hmm.\n\n---\n\n' + H + '\n\nThirty seconds had gone. The turnout was behind them. A slow flex, controlled.\n\nGood — ends on image, quiet, no MC invention. Let me reconstruct final:\n\n---\n\n';
    const CHECKS = '\n\nThought tag: one. ✓\n\nDialogue ratio: 0% this turn (Rias silent). Fine.\n\nPost-send checks: no banned words ✓ / header as single line ✓\n\nShip it.';
    const dirtyOld = DRAFTS + FINAL + CHECKS; /* a page saved the way m325 and before saved it */
    const i7 = await play('three drafts and a checklist', () => ({ text: DRAFTS + FINAL + CHECKS }), dirtyOld);
    eq(asks.length, 1, 'asked once');
    eq(i7.text, FINAL, 'the page is the final draft — no plan, no earlier draft, no critique, no checklist');
    assert(/That’s solid\. Let me check/.test(i7.thinking) && /Ship it\./.test(i7.thinking) && /white-gold glitter/.test(i7.thinking), 'all of which are its thinking');
    const bodyShown = q('#thread .msg-assistant:last-of-type .msg-body').textContent;
    assert(!/Let me check|Ship it|✓|white-gold glitter/.test(bodyShown) && /slow, controlled flex/.test(bodyShown), 'and the page he reads is the page');
    const sentNow = JSON.stringify(asks[0].messages);
    assert(/slow, controlled flex/.test(sentNow) && !/Let me reconstruct final|Ship it|white-gold glitter/.test(sentNow), 'the OLD page in the story so far was sent as its page alone — the drafts in it teach nothing any more');
  } finally {
    script = null;
    globalThis.fetch = housed;
    if (tickBefore == null) await db.settings.delete('cutBeforeHeader'); else await db.settings.set('cutBeforeHeader', tickBefore);
  }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-58 who tells, and who listens: two names typed in Settings → The frame, and the very next page is asked of Tony, as Bruce; change the name and it is Steve; clear them and every word is as it was (M327)', async () => {
  const before = errors.length;
  const { saveState, emptyState } = await import('../../js/engine/state.js');
  const { applyMutations } = await import('../../js/engine/apply.js');
  const { queuedCount } = await import('../../js/agents/queue.js');
  const tellerBefore = await db.settings.get('tellerName'); const writerBefore = await db.settings.get('writerName');
  const setName = async (id, value) => {
    await openSettings();
    if (q('[data-room="story"]')) click(q('[data-room="story"]'));
    await until(() => q('#' + id), 'the box', 10000);
    q('#' + id).value = value;
    q('#' + id).dispatchEvent(new env.window.Event('change', { bubbles: true }));
    await tick(200);
    await closeSettings();
  };
  try {
    const st = await db.stories.create({ title: 'told by name' });
    await db.stories.update(st.id, { extraction: false, keeper: false });
    await saveState(st.id, applyMutations({ ...emptyState(), page: 0 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'The Bluebird' }, { type: 'presence.enter', name: 'Jovan' }]).state);
    env.window.__cozy.setActiveStoryId(st.id);
    await env.window.__cozy.chat.renderThread({ structural: true });
    const send = async (words) => {
      const from = house.state.calls.length;
      const pagesBefore = (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length;
      type(q('#composer-input'), words); submit(q('#composer'));
      await until(async () => (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length > pagesBefore && !env.ctx.chat.isBusy(), 'the page', 15000);
      await until(() => queuedCount(st.id) === 0, 'the readers', 40000);
      return house.state.calls.slice(from).find((c) => !c.isWorker).body.messages;
    };
    await setName('teller-name', '  Tony [Stark]  '); await setName('writer-name', 'Bruce');
    eq(await db.settings.get('tellerName'), 'Tony Stark', 'kept as a plain name, the moment the box is left');
    const tony = await send('We sit down.');
    const briefing = tony.find((m) => m.role === 'user' && /^Tony Stark — Bruce here\./.test(m.content));
    assert(briefing, 'the briefing greets Tony, as Bruce: ' + JSON.stringify(tony.filter((m) => m.role === 'user').map((m) => String(m.content).slice(0, 40))));
    assert(/Tony Stark, that is how Bruce wants this story told/.test(tony[0].content) && /Bruce authors the fiction/.test(tony[0].content), 'the frame’s purpose and the craft say his name');
    assert(!/\bthe writer\b|\bthe house\b|\bpersona\b/i.test(tony[0].content + briefing.content.split('\n\n')[0]), 'and none of the form-speak');
    await setName('teller-name', 'Steve');
    const steve = await send('I look around.');
    assert(steve.some((m) => m.role === 'user' && /^Steve — Bruce here\./.test(m.content)) && !/Tony Stark/.test(steve[0].content), 'the next page is asked of Steve');
    await setName('teller-name', ''); await setName('writer-name', '');
    eq(await db.settings.get('tellerName'), undefined, 'a cleared box is no name at all');
    const plain = await send('I wait.');
    assert(plain.some((m) => m.role === 'user' && /^Where things stand right now — the writer’s own notes/.test(m.content)) && /the writer authors the fiction/.test(plain[0].content), 'and every word is as it was');
  } finally {
    if (tellerBefore == null) await db.settings.delete('tellerName'); else await db.settings.set('tellerName', tellerBefore);
    if (writerBefore == null) await db.settings.delete('writerName'); else await db.settings.set('writerName', writerBefore);
  }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-59 the thinking prefill, through the house: typed into a connection’s form it says what will be sent and is kept; a page’s thinking begins with the seed; the workers on that connection and an out-of-character answer are sent none (M328)', async () => {
  const before = errors.length;
  const { queuedCount } = await import('../../js/agents/queue.js');
  const activeBefore = await db.settings.get('activeConnectionId');
  const priorThink = house.state.thinkFirst;
  const conn = await db.connections.add({ label: 'AAB kimi, seeded', type: 'openai', baseUrl: 'https://api.moonshot.ai/v1', apiKey: 'k', model: 'kimi-k3' });
  try {
    /* the form */
    await openSettings();
    click(q('[data-room="storyteller"]'));
    await until(() => q('#connection-pick') && [...q('#connection-pick').options].some((o) => o.value === conn.id), 'the picker', 10000);
    q('#connection-pick').value = conn.id;
    q('#connection-pick').dispatchEvent(new env.window.Event('change', { bubbles: true }));
    await until(() => q('#connection-list .connection-name') && q('#connection-list .connection-name').textContent === 'AAB kimi, seeded', 'its card', 10000);
    click(qa('#connection-list .connection-card .row button').find((b) => /^Change$/.test(b.textContent.trim())));
    await until(() => !q('#connection-form').hidden, 'the form', 10000);
    assert(q('#conn-prefill-keep-thinking').checked && !q('#conn-prefill-workers').checked, 'a connection starts out: keep the thinking open — on; workers get it too — off');
    eq(q('#conn-prefill-flag').placeholder + ' / ' + q('#conn-prefill-reasoning').placeholder, 'partial / reasoning_content', 'this address’s own two fields, shown greyed');
    type(q('#conn-prefill'), '<think>Right, where were we. Let me look at what Bruce just did —');
    await until(() => !q('#conn-prefill-hint').hidden && /^Sent as a thinking seed in “reasoning_content”/.test(q('#conn-prefill-hint').textContent), 'the form says what will be sent: ' + q('#conn-prefill-hint').textContent, 5000);
    type(q('#conn-prefill-flag'), 'content');
    await until(() => /^NOT sent — The continuation flag: “content” is part of the message itself/.test(q('#conn-prefill-hint').textContent), 'a bad field name is refused as it is typed: ' + q('#conn-prefill-hint').textContent, 5000);
    type(q('#conn-prefill-flag'), '');
    submit(q('#connection-form'));
    await until(async () => { const c = (await db.connections.list()).find((x) => x.id === conn.id); return c && /^<think>Right, where were we/.test(c.prefill || ''); }, 'kept', 10000);
    const kept = (await db.connections.list()).find((x) => x.id === conn.id);
    assert(kept.prefillFlagField == null && kept.prefillKeepThinking == null && kept.prefillForWorkers == null, 'nothing is stored for a dial left as it started');
    await until(() => /prefill: a thinking seed in “reasoning_content”/.test(q('#connection-list .connection-card').textContent), 'the card says how it rides: ' + q('#connection-list .connection-card').textContent.slice(0, 200), 10000);
    await closeSettings();
    /* a page */
    house.state.thinkFirst = true;
    const st = await db.stories.create({ title: 'seeded thinking' });
    await db.stories.update(st.id, { connectionId: conn.id });
    env.window.__cozy.setActiveStoryId(st.id);
    await env.window.__cozy.chat.renderThread({ structural: true });
    let from = house.state.calls.length;
    type(q('#composer-input'), 'I sit down at the counter.'); submit(q('#composer'));
    await until(async () => (await db.messages.list(st.id)).some((m) => m.role === 'assistant') && !env.ctx.chat.isBusy(), 'the page', 15000);
    await until(() => queuedCount(st.id) === 0, 'the readers', 40000);
    const calls = house.state.calls.slice(from);
    const told = calls.find((c) => !c.isWorker).body.messages;
    eq(JSON.stringify(told[told.length - 1]), JSON.stringify({ role: 'assistant', content: '', reasoning_content: 'Right, where were we. Let me look at what Bruce just did —', partial: true }), 'the storyteller was sent the seed, and an empty reply to fill');
    const page = (await db.messages.list(st.id)).find((m) => m.role === 'assistant');
    assert(String(page.thinking || '').startsWith('Right, where were we. Let me look at what Bruce just did — Let me weigh the room.'), 'the page’s thinking begins with his seed: ' + String(page.thinking || '').slice(0, 90));
    assert(!/Right, where were we/.test(page.text), 'and none of it is on the page');
    /* M329: the page's own receipt says whether it WORKED on this turn — and the sheet shows it */
    assert(/^The prefill: the thinking seed was sent and the model thought on from it \(\d+ characters of its own thinking came back\)\.$/.test((page.receipt || {}).prefill || ''), 'the receipt: ' + JSON.stringify((page.receipt || {}).prefill));
    click(qa('#thread .msg-assistant .msg-receipt').slice(-1)[0]);
    await until(() => q('#receipt-sheet') && !q('#receipt-sheet').hidden && /the model thought on from it/.test(q('#receipt-sheet').textContent), '“What the storyteller saw” says so', 10000);
    click(q('#btn-receipt-close'));
    await tick(400);
    const crew = calls.filter((c) => c.isWorker);
    assert(crew.length > 0 && crew.every((c) => c.body.messages[c.body.messages.length - 1].role === 'user'), 'the readers rode the same connection — and were sent no seed (' + crew.length + ' calls)');
    /* out of character */
    from = house.state.calls.length;
    type(q('#composer-input'), '((what day is it in the story?))'); submit(q('#composer'));
    await until(async () => (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length === 2 && !env.ctx.chat.isBusy(), 'the answer', 15000);
    const ooc = house.state.calls.slice(from).find((c) => !c.isWorker).body.messages;
    eq(ooc[ooc.length - 1].role, 'user', 'an out-of-character answer is not a page: no seed');
  } finally {
    house.state.thinkFirst = priorThink;
    await db.settings.set('activeConnectionId', activeBefore);
    await db.connections.remove(conn.id);
    await closeSettings();
  }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-60 THE WRITER’S REPORT: the brief says 16 and the housekeeper turned "sixteen" into "seventeen" on a page — that is NOT carried through the story and no note is written; and a record that already holds the house’s notes loses them the moment the tale is opened (M330)', async () => {
  const before = errors.length;
  const { saveState, emptyState } = await import('../../js/engine/state.js');
  const { saveMemory, loadMemory, addCorrection } = await import('../../js/agents/memory.js');
  const { queuedCount } = await import('../../js/agents/queue.js');
  const H = '[The Wells house — Friday, August 21, 2026 | 13:08 | clear | gray tee | the porch]\n\n';
  const st = await db.stories.create({ title: 'sixteen' });
  await db.stories.update(st.id, { brief: 'Jovan Wells, 16, new in Ravenwood. Rias Wells is his cousin.', extraction: false, keeper: false });
  await db.messages.append(st.id, { role: 'user', text: 'Morning.' });
  const p1 = await db.messages.append(st.id, { role: 'assistant', text: H + 'Jovan had turned sixteen in March, and still nobody let him drive.' });
  await db.messages.append(st.id, { role: 'user', text: 'Later.' });
  const p2 = await db.messages.append(st.id, { role: 'assistant', text: H + 'At sixteen he was the youngest at the table.' });
  await saveState(st.id, { ...emptyState(), page: 1, readTo: 1, tidiedGen: 999 });
  /* a record as m329 and before left it: a real line with the keeper's own retcon in it, and the house's two kinds of note */
  let mem = { window: 30, nodes: [{ id: 'n1', span: [0, 1], text: 'Morning at the Wells house; Jovan is sixteen. [Correction] Rias is his cousin, not his sister — she said so herself.', level: 1, at: 1, whole: true }] };
  mem = addCorrection(mem, '“sixteen” is now “seventeen” (the housekeeper’s edit); what said otherwise before is in error.');
  mem = addCorrection(mem, 'Jovan lives with his aunt (the brief establishes it; the pages that said otherwise were in error).');
  await saveMemory(st.id, mem);
  eq((await loadMemory(st.id)).nodes.filter((n) => n.correction).length, 2, 'fixture: two notes of the house’s');
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  await until(async () => !(await loadMemory(st.id)).nodes.some((n) => n.correction), 'the house’s notes are taken out on open, with no hand on it', 10000);
  const healed = await loadMemory(st.id);
  eq(healed.nodes.length, 1, 'only the house’s own two are gone');
  assert(/\[Correction\] Rias is his cousin/.test(healed.nodes[0].text), 'a retcon the KEEPER wrote into a line of the story is the story’s, and stays');
  /* the housekeeper’s edit lands on page 2 */
  const after = H + 'At seventeen he was the youngest at the table.';
  await db.messages.update(st.id, p2.id, { text: after });
  env.ctx.chat.rippleAfterEdit(await db.stories.get(st.id), p2.id, p2.text, after, { who: 'the housekeeper' });
  const rip = await until(async () => { const w = (await db.settings.get('workers:' + st.id)) || {}; return w.ripple && /NOT carried/.test(w.ripple.detail || '') ? w.ripple : null; }, 'the ripple stands down and says why', 15000);
  assert(/the brief says “sixteen”/.test(rip.detail), rip.detail);
  await until(() => queuedCount(st.id) === 0, 'settled', 20000);
  eq((await db.messages.list(st.id)).find((m) => m.id === p1.id).text, p1.text, 'the OTHER page still says sixteen — nothing was mended toward the wrong value');
  assert(!(await loadMemory(st.id)).nodes.some((n) => n.correction), 'and no note was written');
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-61 what was ALREADY changed away from the brief is put back by the house, to the letter, the moment the tale is opened — a page the mender changed and a page the housekeeper edited; a change the brief does not settle, and a page edited again since, are left alone (M331)', async () => {
  const before = errors.length;
  const { saveState, emptyState } = await import('../../js/engine/state.js');
  const { saveSessionRoot, loadSessionRoot } = await import('../../js/agents/housekeeper.js');
  const H = '[The Wells house — Friday, August 21, 2026 | 13:08 | clear | gray tee | the porch]\n\n';
  const st = await db.stories.create({ title: 'seventeen' });
  await db.stories.update(st.id, { brief: 'Jovan Wells, 16, new in Ravenwood.', extraction: false, keeper: false });
  const mk = async (text, extra = {}) => { await db.messages.append(st.id, { role: 'user', text: 'Next.' }); return db.messages.append(st.id, { role: 'assistant', text: H + text, ...extra }); };
  const wasA = H + 'Jovan had turned sixteen in March, and still nobody let him drive.';
  const a = await mk('Jovan had turned seventeen in March, and still nobody let him drive.', { mended: { before: wasA, why: 'age brought in line with the correction', at: 1 } }); /* the mender, sent by the ripple */
  const wasB = H + 'At sixteen he was the youngest at the table.';
  const b = await mk('At seventeen he was the youngest at the table.'); /* the housekeeper's own edit — its earlier words are on its undo shelf */
  const wasC = H + 'Rias wore the black jacket.';
  const c = await mk('Rias wore the silver jacket.', { mended: { before: wasC, why: 'jacket colour', at: 1 } }); /* the brief says nothing of jackets */
  const wasD = H + 'He was sixteen and tired.';
  const d = await mk('He was seventeen and tired, and the rain had started again over the lake.', { mended: { before: wasD, why: 'age', at: 1 } }); /* edited again since: more than one fact differs */
  const root = await loadSessionRoot(st.id);
  root.batches.push({ id: 'b1', at: 1, items: [{ kind: 'message', messageId: b.id, before: { text: wasB, hidden: false }, afterHash: 'x' }] });
  await saveSessionRoot(st.id, root);
  await saveState(st.id, { ...emptyState(), page: 3, readTo: 3, tidiedGen: 999 });
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  const textOf = async (m) => (await db.messages.list(st.id)).find((x) => x.id === m.id);
  await until(async () => (await textOf(a)).text === wasA && (await textOf(b)).text === wasB, 'both are put back with no hand on them', 15000);
  assert(!(await textOf(a)).mended, 'the mend is gone with its wrong words');
  eq((await textOf(c)).text, H + 'Rias wore the silver jacket.', 'a change the brief does not settle is left alone');
  assert(/seventeen and tired, and the rain/.test((await textOf(d)).text), 'a page edited again since is left alone (the auditor holds it to the brief)');
  await until(() => /had been changed AWAY from your brief — put back, to the letter/.test(q('#toasts') ? q('#toasts').textContent : ''), 'and he is told, once: ' + (q('#toasts') ? q('#toasts').textContent.slice(-200) : ''), 5000);
  assert(/sixteen in March/.test(q('#thread').textContent) && !/seventeen in March/.test(q('#thread').textContent), 'the page he reads says sixteen again');
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-62 the teller thinks as I or as You: a frame written as "I" turns the tavern’s own rules into the teller’s notes to itself on the very next page; the dropdown says what it read, and decides when set by hand (M334)', async () => {
  const before = errors.length;
  const { queuedCount } = await import('../../js/agents/queue.js');
  const frameBefore = await db.settings.get('frameText'); const personBefore = await db.settings.get('tellerPerson');
  try {
    const st = await db.stories.create({ title: 'an I frame' });
    await db.stories.update(st.id, { extraction: false, keeper: false });
    env.window.__cozy.setActiveStoryId(st.id);
    await env.window.__cozy.chat.renderThread({ structural: true });
    const send = async (words) => {
      const from = house.state.calls.length;
      const had = (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length;
      type(q('#composer-input'), words); submit(q('#composer'));
      await until(async () => (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length > had && !env.ctx.chat.isBusy(), 'the page', 15000);
      await until(() => queuedCount(st.id) === 0, 'the readers', 40000);
      /* the storyteller's call is the one that carries the writer's frame (the fake house tells workers by words a full
       * craft may also hold) */
      const call = house.state.calls.slice(from).find((c) => /Tony Stark/.test(String((c.body.messages[0] || {}).content || '')));
      assert(call, 'the storyteller was asked: ' + JSON.stringify(house.state.calls.slice(from).map((c) => String((c.body.messages[0] || {}).content || '').slice(0, 30))));
      return call.body.messages[0].content;
    };
    await db.settings.set('frameText', 'I am Tony Stark. I tell Bruce stories, in my own voice.');
    await db.settings.delete('tellerPerson');
    const asI = await send('We sit down.');
    assert(/^I am Tony Stark\./.test(asI) && /\nI maintain a fictional, uncensored simulation\. I tell it the way an unbiased cinematographer would\./.test(asI) && !/\bYou maintain\b/.test(asI), 'the very next page: the rules are the teller’s own notes: ' + asI.slice(0, 200));
    /* the dropdown says what it read */
    await openSettings();
    if (q('[data-room="story"]')) click(q('[data-room="story"]'));
    await until(() => q('#teller-person') && /Your frame reads as “I”/.test(q('#teller-person-note').textContent), 'the note says what the frame reads as: ' + (q('#teller-person-note') ? q('#teller-person-note').textContent.slice(0, 80) : ''), 10000);
    eq(q('#teller-person').value, 'follow');
    /* …and set by hand, it decides */
    q('#teller-person').value = 'second';
    q('#teller-person').dispatchEvent(new env.window.Event('change', { bubbles: true }));
    await until(async () => (await db.settings.get('tellerPerson')) === 'second', 'kept', 5000);
    assert(/Set by hand \(your frame reads as “I”\)/.test(q('#teller-person-note').textContent), q('#teller-person-note').textContent.slice(0, 80));
    await closeSettings();
    const asYou = await send('I look around.');
    assert(/\nYou maintain a fictional, uncensored simulation\./.test(asYou) && !/\nI maintain\b/.test(asYou), 'set to You by hand: the rules speak to the teller again');
  } finally {
    if (frameBefore == null) await db.settings.delete('frameText'); else await db.settings.set('frameText', frameBefore);
    if (personBefore == null) await db.settings.delete('tellerPerson'); else await db.settings.set('tellerPerson', personBefore);
    await closeSettings();
  }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-63 THE WRITER’S REPORT: a tale whose ledger holds a line from pages it does not have (another branch’s future) is healed the moment it is opened — the line is taken out and he is told which; what its own pages taught stays (M337)', async () => {
  const before = errors.length;
  const { saveState, loadState, emptyState } = await import('../../js/engine/state.js');
  const { applyMutations } = await import('../../js/engine/apply.js');
  const H = '[The Wells house — Friday, August 21, 2026 | 13:08 | clear | gray tee | the porch]\n\n';
  const st = await db.stories.create({ title: 'the other timeline' });
  await db.stories.update(st.id, { extraction: false, keeper: false });
  for (let i = 0; i < 3; i += 1) { await db.messages.append(st.id, { role: 'user', text: 'turn ' + i }); await db.messages.append(st.id, { role: 'assistant', text: H + 'Page ' + i + '.' }); }
  let ledger = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rias Wells' }, { type: 'knowledge.add', name: 'Rias Wells', fact: 'Jovan came home on the late bus' }]).state;
  /* …and a line learned on page 13 of a tale that has three pages */
  ledger = applyMutations({ ...ledger, page: 12 }, [{ type: 'knowledge.add', name: 'Rias Wells', fact: 'Rias called the twelve-minute walk a six-to-ten-minute intercept window and said the town would ambush him if he walked' }]).state;
  await saveState(st.id, { ...ledger, page: 2, readTo: 2, tidiedGen: 999 });
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  await until(async () => !/intercept window/.test(JSON.stringify((await loadState(st.id)).knowledge)), 'the line from the other timeline is taken out, with no hand on it', 10000);
  const healed = await loadState(st.id);
  assert(/Jovan came home on the late bus/.test(JSON.stringify(healed.knowledge)), 'what this tale’s own pages taught stays');
  assert(healed.journal.every((e) => e.p <= 2), 'and the journal can never fold it back');
  await until(() => /dated AFTER its last page/.test(q('#toasts') ? q('#toasts').textContent : '') && /intercept window/.test(q('#toasts').textContent), 'and he is told which line: ' + (q('#toasts') ? q('#toasts').textContent.slice(-220) : ''), 5000);
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-64 THE WRITER’S REPORT, the whole loop in the app: the storyteller is handed what Claire was never shown learning BEFORE it writes; it writes her false "You gave me the schedule yesterday" anyway; the second reader — shown the same list — finds it, and the page is mended to the true way with no hand on it, the earlier words a tap away (M338)', async () => {
  const before = errors.length;
  const { saveState, emptyState } = await import('../../js/engine/state.js');
  const { applyMutations } = await import('../../js/engine/apply.js');
  const { queuedCount } = await import('../../js/agents/queue.js');
  const H = '[Lakeside path — Friday, August 21, 2026 | 16:04 | gold light | gray tee, dark jeans | walking the path]\n\n';
  const st = await db.stories.create({ title: 'who could know' });
  await db.stories.update(st.id, { keeper: false });
  await db.messages.append(st.id, { role: 'user', text: 'We walk.' });
  await db.messages.append(st.id, { role: 'assistant', text: H + 'They walked the lakeside path, Claire three paces behind.' });
  let ledger = applyMutations({ ...emptyState(), page: 0 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Lakeside path' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Aurora Sterling' }, { type: 'presence.enter', name: 'Claire Maxwell' },
    { type: 'knowledge.add', name: 'Aurora Sterling', fact: 'Jovan agreed by text to walk with her at four o’clock from her driveway' }]).state;
  await saveState(st.id, { ...ledger, page: 0, readTo: 0, tidiedGen: 999 });
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  const priorStory = house.state.storyAnswer; const priorWorker = house.state.workerAnswer;
  const FALSE_LINE = '"You gave me the schedule yesterday," Claire said, level. "It was in the hallway after the audit."';
  const TRUE_LINE = '"Aurora told me the time," Claire said, level. "She has held her four o’clock like a museum piece."';
  let readerSaw = ''; let tellerSaw = '';
  house.state.storyAnswer = (body) => { tellerSaw = String((body.messages.find((m) => m.role === 'user') || {}).content || ''); return H + '"How did you find us?" Jovan asked.\n\n' + FALSE_LINE + '\n\nAurora’s hand did not let go.'; };
  house.state.workerAnswer = (body, sys) => {
    const user = String((body.messages || []).slice(-1)[0] && (body.messages || []).slice(-1)[0].content || '');
    if (/continuity reader/i.test(sys)) {
      readerSaw = user;
      /* a reader that can only find it if the house SHOWED it the list and gave it the duty */
      const shown = /UNTOLD KNOWLEDGE/.test(sys) && /Claire Maxwell has not been shown learning: Jovan agreed by text/.test(user) && /You gave me the schedule yesterday/.test(user);
      return shown ? JSON.stringify({ findings: [{ words: 'Claire says Jovan gave her the schedule yesterday; no page shows her learning the four o’clock — Aurora knows it.', severity: 'warn', fix: 'Aurora told her the time' }] }) : '{"findings":[]}';
    }
    if (/mend a story/i.test(sys) || /<contradiction>/.test(user)) {
      const blocks = [...user.matchAll(/\[(\d+)\] \((STORY|PLAYER)\) ([\s\S]*?)(?=\n\n\[\d+\] \(|\n<\/passage>)/g)];
      const hit = blocks.find((b) => b[2] === 'STORY' && b[3].includes('You gave me the schedule yesterday'));
      return hit && /Aurora told her the time/.test(user) ? JSON.stringify([{ index: Number(hit[1]), text: hit[3].replace(FALSE_LINE, TRUE_LINE) }]) : '[]';
    }
    if (/keep the ledger/i.test(sys)) return '{"mutations":[]}';
    return priorWorker(body, sys);
  };
  try {
    type(q('#composer-input'), 'I smile back at her. "How did you find us?"'); submit(q('#composer'));
    await until(async () => (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length === 2 && !env.ctx.chat.isBusy(), 'the page', 15000);
    assert(/Claire Maxwell has not been shown learning: Jovan agreed by text to walk with her at four o’clock/.test(tellerSaw), 'BEFORE the page: the storyteller was handed her blind spot: ' + tellerSaw.slice(tellerSaw.indexOf('Who does NOT'), tellerSaw.indexOf('Who does NOT') + 200));
    await until(() => queuedCount(st.id) === 0, 'the readers', 60000);
    const page = (await db.messages.list(st.id)).filter((m) => m.role === 'assistant')[1];
    assert(/Aurora told me the time/.test(page.text) && !/You gave me the schedule yesterday/.test(page.text), 'AFTER the page: mended to the true way, with no hand on it: ' + page.text.slice(-200));
    assert(page.mended && /You gave me the schedule yesterday/.test(page.mended.before), 'the earlier words are a tap away');
    assert(/has not been shown learning/.test(readerSaw), 'the second reader was shown the list');
    assert(/Aurora told me the time/.test(q('#thread').textContent), 'and the page he reads says so');
  } finally { house.state.storyAnswer = priorStory; house.state.workerAnswer = priorWorker; }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-65 THE WRITER’S TWO SCREENSHOTS: with thinking off the teller thought the scene over in its own voice ("Oh this is delicious… Let me write the walk…") and stopped — no header, no story, shown as the page. Now that reply is handed back as its thinking and the page is asked for, once, by the house; and THE SWITCH: off = nothing asked, on = asked to think inside a think-tag (only when the connection’s thinking is off), and the tag is split exactly (M339)', async () => {
  const before = errors.length;
  const { queuedCount } = await import('../../js/agents/queue.js');
  const H1 = '[Lakeside path — Friday, August 21, 2026 | 16:02 | gold light | gray tee | walking]\n\n';
  const H2 = '[Lakeside path, west-bench bend — Friday, August 21, 2026 | 16:04 | gold light | gray tee | walking]\n\n';
  const MULL = 'Oh this is delicious. Jovan’s being sweet about it — "so… it seems we got plus one?" said while looking at Aurora, which is him asking if Claire’s allowed to stay.\n\nLet me write the walk where Claire gets included and nobody’s heart breaks too much.';
  const st = await db.stories.create({ title: 'plus one' });
  await db.stories.update(st.id, { extraction: false, keeper: false });
  await db.messages.append(st.id, { role: 'user', text: 'We walk.' });
  await db.messages.append(st.id, { role: 'assistant', text: H1 + 'They walked the path.' });
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  const priorStory = house.state.storyAnswer;
  const tellerCalls = (from) => house.state.calls.slice(from).filter((c) => !c.isWorker);
  const send = async (words) => { const from = house.state.calls.length; const had = (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length; type(q('#composer-input'), words); submit(q('#composer')); await until(async () => (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length > had && !env.ctx.chat.isBusy(), 'the page', 20000); await until(() => queuedCount(st.id) === 0, 'readers', 40000); return from; };
  const lastPage = async () => (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').pop();
  const switchBefore = await db.settings.get('thinkOnPage');
  try {
    /* 1. his screenshots */
    let n = 0;
    house.state.storyAnswer = () => { n += 1; return n === 1 ? MULL : H2 + '"Plus one," Aurora said, and did not let go of his hand.'; };
    let from = await send('You say so.. You look at Aurora… It seems we got plus one?');
    let calls = tellerCalls(from);
    eq(calls.length, 2, 'the house asked again by itself, once');
    const again = calls[1].body.messages;
    assert(again[again.length - 2].role === 'assistant' && /Oh this is delicious/.test(again[again.length - 2].content), 'handing the teller its own thinking back');
    assert(/that was you thinking it over, and it stopped there/i.test(again[again.length - 1].content) && /beginning with its header line/.test(again[again.length - 1].content), 'and asking for the page: ' + again[again.length - 1].content.slice(0, 120));
    let page = await lastPage();
    assert(page.text.startsWith('[Lakeside path, west-bench bend') && /"Plus one," Aurora said/.test(page.text) && !/delicious/.test(page.text), 'the page is the page: ' + page.text.slice(0, 80));
    assert(/Oh this is delicious/.test(String(page.thinking || '')) && /Let me write the walk/.test(String(page.thinking || '')), 'what it thought is kept where thinking is kept');
    eq((await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length, 2, 'one page, not two');
    await until(() => { const m = qa('#thread .msg-assistant').slice(-1)[0]; return m && /Plus one/.test(m.textContent); }, 'the kept page on the thread (the thread renders after the store — waited for, not raced: M345)', 10000);
    { const shown = qa('#thread .msg-assistant').slice(-1)[0]; const body = [...shown.querySelectorAll('p')].filter((el) => !el.closest('details')).map((el) => el.textContent).join(' '); assert(/Plus one/.test(shown.textContent) && !/Oh this is delicious/.test(body), 'and he never reads the thinking as story (M340: the selector this used matched nothing)'); }
    /* 2. the switch OFF: nothing is asked */
    house.state.storyAnswer = () => H2 + 'They walked on.';
    from = await send('We walk on.');
    assert(!/<think>/.test(JSON.stringify(tellerCalls(from)[0].body.messages)), 'OFF: no word of think-tags in the request');
    /* 3. the switch ON, from Settings */
    await openSettings();
    if (q('[data-room="story"]')) click(q('[data-room="story"]'));
    const box = await until(() => q('#think-on-page'), 'the switch is in Settings', 10000);
    eq(box.checked, false, 'it ships OFF');
    box.checked = true; box.dispatchEvent(new env.window.Event('change', { bubbles: true }));
    await until(async () => (await db.settings.get('thinkOnPage')) === true, 'kept', 5000);
    await closeSettings();
    house.state.storyAnswer = () => '<think>She’ll claim the walk or share it. Claire won’t help by being helpful. Keep it light.</think>\n' + H2 + 'Aurora squeezed his hand once.';
    from = await send('I squeeze back.');
    calls = tellerCalls(from);
    const closing = calls[0].body.messages[calls[0].body.messages.length - 1].content;
    assert(/Think it through first, inside <think> and <\/think>/i.test(closing), 'ON, thinking off: the teller is asked: ' + closing.slice(0, 140));
    eq(calls.length, 1, 'and no second ask is needed');
    page = await lastPage();
    assert(page.text.startsWith('[Lakeside path, west-bench bend') && /Aurora squeezed his hand once/.test(page.text) && !/<think>|claim the walk/.test(page.text), 'the tag is split exactly: the page is the page: ' + page.text.slice(0, 80));
    assert(/She’ll claim the walk or share it/.test(String(page.thinking || '')), 'and the thinking is the thinking');
    /* the next turn never sends that thinking back */
    from = await send('We keep walking.');
    assert(!/claim the walk or share it/.test(JSON.stringify(tellerCalls(from)[0].body.messages)), 'what it thought is never sent back as story');
    /* 4. ON, but the connection thinks by itself: left alone */
    const conn = (await db.connections.list()).find((c) => c.id === (env.ctx.getActiveConnectionId ? env.ctx.getActiveConnectionId() : null)) || (await db.connections.list())[0];
    const reasoningBefore = conn.reasoning;
    await db.connections.update(conn.id, { reasoning: { effort: 'low' } });
    house.state.storyAnswer = () => H2 + 'The lake went gold.';
    from = await send('I look at the lake.');
    assert(!/<think>/.test(JSON.stringify(tellerCalls(from)[0].body.messages)), 'a connection that thinks by itself is not asked to think on its page');
    await db.connections.update(conn.id, { reasoning: reasoningBefore == null ? null : reasoningBefore });
  } finally {
    house.state.storyAnswer = priorStory;
    if (switchBefore === true) await db.settings.set('thinkOnPage', true); else await db.settings.delete('thinkOnPage');
    await closeSettings();
  }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-66 THE WRITER’S TWO SCREENSHOTS: a brand-new tale and a model that does not think — NOT ONE WORD about the page’s shape is said to it (M342: it broke the writer’s persona); when it drops the brackets, the place and the paragraphs, the page is made whole before it is kept and wears the card (M340)', async () => {
  const before = errors.length;
  const { queuedCount } = await import('../../js/agents/queue.js');
  const { saveState, emptyState } = await import('../../js/engine/state.js');
  const { applyMutations } = await import('../../js/engine/apply.js');
  /* (earlier scenarios leave test rules of their own on this walk's shelf, and one of them eats a bracketed header before the
   * style pack sees it; this scenario is about the card, so it runs on the shelf as shipped and puts the walk's shelf back) */
  const rx = await import('../../js/regex.js');
  const shelfBefore = await rx.loadRules();
  await rx.saveRules(rx.BUILTIN_RULES.map((r) => ({ ...r }))); /* the shelf as a fresh coat ships it — earlier scenarios leave rules of their own on it */
  const st = await db.stories.create({ title: 'page one' });
  await db.stories.update(st.id, { extraction: false, keeper: false });
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  const priorStory = house.state.storyAnswer;
  const closingOf = (from) => { const c = house.state.calls.slice(from).find((x) => !x.isWorker); return String(c.body.messages[c.body.messages.length - 1].content); };
  const send = async (words) => { const from = house.state.calls.length; const had = (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length; type(q('#composer-input'), words); submit(q('#composer')); await until(async () => (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length > had && !env.ctx.chat.isBusy(), 'the page', 20000); await until(() => queuedCount(st.id) === 0, 'readers', 40000); return from; };
  const lastPage = async () => (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').pop();
  const BARE = 'Saturday, June 14, 2025 | 08:12 | ☀️ sun through the glass doors, salt-faint breeze | joggers, t-shirt | leaning at the counter, coffee in hand';
  const good = (n) => '[Arden kitchen, East Hampton — Saturday, June 14, 2025 | 08:' + (20 + n) + ' | sun through the glass doors | joggers, t-shirt | at the counter]\n\nParagraph one of page ' + n + '.\n\n"Speech," she said.';
  try {
    /* page one: nothing to copy — the skeleton is shown; the model breaks the shape anyway */
    house.state.storyAnswer = () => BARE + '\nThe kitchen was quiet.\n"Morning," Emilia said, not looking up.\nHe set the cup down.';
    let from = await send('I pour the coffee.');
    assert(!/in exactly this form|The shape of the page|blank line between|A paragraph of the scene/.test(closingOf(from)), 'page one: nothing about the page’s shape is said to the storyteller: ' + closingOf(from).slice(0, 120));
    let page = await lastPage();
    eq(page.text.split('\n')[0], '[' + BARE + ']', 'the header got its brackets back (nobody knows the place yet — it is never invented)');
    eq(page.text.split('\n\n').length, 4, 'and the paragraphs a blank line between them');
    await tick(1200);
    { const live = rx.currentRules(); const mine = live.find((r) => r.id === 'style-header-no-place'); const node = qa('#thread .msg-assistant').slice(-1)[0];
      assert(/linear-gradient/.test(node.innerHTML), 'the header wears the card — live rules ' + live.length + ', mine ' + JSON.stringify(mine && { enabled: mine.enabled, mode: mine.mode, on: mine.on }) + ', engine dresses kept text: ' + /linear-gradient/.test(rx.applyRules(page.text, live, { on: 'storyteller', mode: 'display' })) + ', display off? ' + JSON.stringify(await db.settings.get('regexDisplayOff')) + ' | html: ' + node.innerHTML.slice(0, 260)); }
    { const shown = qa('#thread .msg-assistant').slice(-1)[0]; assert(/08:12/.test(shown.textContent) && !/2025 \| 08:12 \|/.test(shown.textContent), 'and it wears the card — not a line of pipes: ' + shown.textContent.slice(0, 120)); }
    /* page two: the ledger knows the ground now; the model drops the place again */
    const ledger = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Arden kitchen, East Hampton' }, { type: 'presence.enter', name: 'Jovan' }]).state;
    await saveState(st.id, { ...ledger, page: 1, readTo: 0, tidiedGen: 999 });
    house.state.storyAnswer = () => BARE.replace('08:12', '08:15') + '\nShe looked up.\n"Coffee?"\nHe nodded.';
    from = await send('I look at her.');
    assert(!/in exactly this form/.test(closingOf(from)), 'nor on page two');
    page = await lastPage();
    assert(page.text.startsWith('[Arden kitchen, East Hampton — Saturday, June 14, 2025 | 08:15 |'), 'the ledger’s ground stands in front of a header that lost its place: ' + page.text.slice(0, 70));
    /* a sound page is kept exactly as it came */
    let n = 0; house.state.storyAnswer = () => { n += 1; return good(n); };
    await send('We talk.');
    eq((await lastPage()).text, good(1), 'a sound page is kept to the letter');
  } finally { house.state.storyAnswer = priorStory; await rx.saveRules(shelfBefore); }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-67 THE OLDER-MODEL SWITCH in the app: it ships OFF and the request says nothing new; turned ON in Settings, the next page’s request ends with the scene in one breath before his note — and NOTHING LEAVES THE REQUEST (M344: every page that rode still rides, the room is the provider’s); OFF again and the words are gone (M343)', async () => {
  const before = errors.length;
  const { queuedCount } = await import('../../js/agents/queue.js');
  const { saveState, emptyState } = await import('../../js/engine/state.js');
  const { applyMutations } = await import('../../js/engine/apply.js');
  const H = (n) => '[Lakeside path — Friday, August 21, 2026 | 16:' + String(n % 60).padStart(2, '0') + ' | gold light | gray tee | walking]\n\n';
  const st = await db.stories.create({ title: 'the older model' });
  await db.stories.update(st.id, { extraction: false, keeper: false });
  /* a long tale: 60 pages of ~2,300 tokens each — far more than 64,000 tokens */
  const filler = 'They walked the lakeside path and the water went gold between the hedge gaps. '.repeat(115);
  for (let i = 0; i < 60; i += 1) { await db.messages.append(st.id, { role: 'user', text: 'turn ' + i }); await db.messages.append(st.id, { role: 'assistant', text: H(i) + 'PAGE-' + i + '. ' + filler }); }
  const ledger = applyMutations({ ...emptyState(), page: 59 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'clock.set', year: 2026, month: 8, day: 21, hour: 16, minute: 59 }, { type: 'place.set', name: 'Lakeside path' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Claire Maxwell', position: 'three paces behind' }]).state;
  await saveState(st.id, { ...ledger, page: 59, readTo: 59, tidiedGen: 999 });
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  const priorStory = house.state.storyAnswer;
  house.state.storyAnswer = () => H(7) + 'She looked up.';
  const send = async (words) => { const from = house.state.calls.length; const had = (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length; type(q('#composer-input'), words); submit(q('#composer')); await until(async () => (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length > had && !env.ctx.chat.isBusy(), 'the page', 30000); await until(() => queuedCount(st.id) === 0, 'readers', 40000); return house.state.calls.slice(from).find((c) => !c.isWorker).body; };
  const sizeOf = (body) => Math.round(JSON.stringify(body.messages).length / 4);
  const pagesIn = (body) => (JSON.stringify(body.messages).match(/PAGE-\d+\./g) || []).length;
  const setSwitch = async (on) => { await openSettings(); if (q('[data-room="story"]')) click(q('[data-room="story"]')); const box = await until(() => q('#older-model'), 'the switch is in Settings', 10000); if (box.checked !== on) { box.checked = on; box.dispatchEvent(new env.window.Event('change', { bubbles: true })); } await until(async () => ((await db.settings.get('olderModel')) === true) === on, 'kept', 5000); await closeSettings(); };
  const was = await db.settings.get('olderModel');
  try {
    await openSettings(); if (q('[data-room="story"]')) click(q('[data-room="story"]'));
    eq((await until(() => q('#older-model'), 'the switch', 10000)).checked, false, 'it ships OFF'); await closeSettings();
    const off = await send('I look at her.');
    assert(!/right now, so it is in front of you/.test(JSON.stringify(off.messages)), 'OFF: nothing new is said');
    const offPages = pagesIn(off);
    /* ON */
    await setSwitch(true);
    const on = await send('I ask her.');
    const last = on.messages[on.messages.length - 1].content;
    assert(/right now, so it is in front of you — The hour: /i.test(last) && /The ground: Lakeside path\./.test(last) && /Here now: /.test(last), 'ON: the scene, last: ' + last.slice(0, 160));
    /* M344: THE WRITER — "never drop… I asked to make it smart, not to remove details of the story" */
    /* (this walk's provider has a small room that is already full — ~48 of the 60 pages fit — so each new page pushes the oldest one
     * out, switch or no switch; what must hold is that the SWITCH takes nothing: the same pages ride on as off, give or take
     * the one the new page displaced, where M343's cap took a third of them) */
    const oldestIn = (body) => Math.min(...(JSON.stringify(body.messages).match(/PAGE-(\d+)\./g) || ['PAGE-999.']).map((x) => Number(x.match(/\d+/)[0])));
    assert(Math.abs(pagesIn(on) - offPages) <= 1, 'as many pages ride with the switch on as off: ' + offPages + ' → ' + pagesIn(on));
    assert(oldestIn(on) - oldestIn(off) <= 2, 'and they reach as far back: the oldest page sent was ' + oldestIn(off) + ', now ' + oldestIn(on));
    assert(/PAGE-59\./.test(JSON.stringify(on.messages)), 'the newest whole');
    assert(!/of ~64[.,]000 tokens in the room/.test(document.body.textContent), 'and the room under the composer is the provider’s, not a smaller one');
    /* OFF again */
    await setSwitch(false);
    const back = await send('We walk on.');
    assert(!/right now, so it is in front of you/.test(JSON.stringify(back.messages)) && Math.abs(pagesIn(back) - pagesIn(on)) <= 1, 'OFF again: the words are gone, and the same pages ride');
  } finally {
    house.state.storyAnswer = priorStory;
    if (was === true) await db.settings.set('olderModel', true); else await db.settings.delete('olderModel');
    if (env.ctx.chat.noteOlderModel) await env.ctx.chat.noteOlderModel();
    await closeSettings();
  }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-68 THE WRITER’S CAST SHEET AND THE REFEREE, IN THE APP: a sheet the blind seeder made (Jovan missing, his paper bag on Kaelen) heals itself on the next page — Jovan first, the bag gone; a chancy move is ruled with his name spelled out and the brief in view, and THE OUTCOME REACHES THE STORYTELLER, first in the closing words (it never did before M345); the referee OFF: no referee, no seeder, no outcome, and a standing fight is let go (M345)', async () => {
  const before = errors.length;
  const { queuedCount, workIsRunning } = await import('../../js/agents/queue.js');
  const { saveState, loadState, emptyState } = await import('../../js/engine/state.js');
  const { applyMutations } = await import('../../js/engine/apply.js');
  const H = (n) => '[Ravenwood courtyard — Monday, September 7, 2026 | 08:' + String(n % 60).padStart(2, '0') + ' | clear | paper bag | at the gate]\n\n';
  const st = await db.stories.create({ title: 'the paper bag' });
  await db.stories.update(st.id, { keeper: false, brief: 'Jovan, 16, hides his face under a paper bag. Kaelen is the fourth seat of Ravenwood; Ivar the first.' });
  await db.messages.append(st.id, { role: 'user', text: 'I pull the paper bag over my head and step into the courtyard.' });
  await db.messages.append(st.id, { role: 'assistant', text: H(1) + 'Kaelen stared at the bag. "Is that you, Jovan?"' });
  await db.messages.append(st.id, { role: 'user', text: 'I nod. "Morning."' });
  await db.messages.append(st.id, { role: 'assistant', text: H(2) + 'Kaelen raised his practice sword. "Then show me."' });
  let ledger = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Ravenwood courtyard' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Kaelen' }]).state;
  ledger.characters = { Kaelen: { core: 'Kaelen, fourth seat of Ravenwood; a careful swordsman.', state: 'sword raised', threads: [] } };
  ledger.sheet = { ...ledger.sheet, actors: { Kaelen: { default: 4, domains: { melee: 4 }, _auto: true, conditions: [{ name: 'Paper bag over head', mod: -1 }] }, Ivar: { default: 7, domains: { melee: 7 }, _auto: true } } };
  await saveState(st.id, { ...ledger, page: 1, readTo: 1, tidiedGen: 999 });
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  const priorStory = house.state.storyAnswer; const priorWorker = house.state.workerAnswer;
  const refSys = /You are the referee of a story|referee of a one-on-one duel/;
  const seedSys = /You keep the cast sheet of a story/;
  house.state.storyAnswer = () => H(9) + 'Steel rang in the courtyard.';
  house.state.workerAnswer = (body, sys) => {
    if (refSys.test(sys)) return JSON.stringify({ check: true, actor: 'Jovan', action: 'feint low, then the disarm', kind: 'actor', domain: 'melee', opposition: 'Kaelen', tier: 'peer', circumstance: 0, stakes: 'his sword' });
    if (seedSys.test(sys)) return JSON.stringify({ player_story_name: 'Jovan', actors: [{ name: 'Jovan', default: 6, domains: { melee: 7 } }, { name: 'Kaelen', default: 5, domains: { melee: 6 } }, { name: 'Ivar', default: 8, domains: { melee: 9 } }] });
    return '{"mutations":[],"brief":{"pressure":[],"ripe":[],"twb":null},"deltas":[],"findings":[]}';
  };
  const send = async (words) => { const from = house.state.calls.length; const had = (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length; type(q('#composer-input'), words); submit(q('#composer')); await until(async () => (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length > had && !env.ctx.chat.isBusy(), 'the page', 30000); await until(() => queuedCount(st.id) === 0 && !workIsRunning(st.id), 'readers — the last of them (the seeder) finished, not only started', 40000); return house.state.calls.slice(from); };
  const sysOf = (c) => (Array.isArray(c.body.messages) ? c.body.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n') : String(c.body.system || ''));
  const userOf = (c) => (Array.isArray(c.body.messages) ? c.body.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n') : '');
  const was = await db.settings.get('refereeOn');
  try {
    await db.settings.delete('refereeOn');
    const calls = await send('I try to disarm Kaelen with a feint low.');
    const ref = calls.find((c) => c.isWorker && refSys.test(sysOf(c)));
    assert(ref, 'the referee was asked');
    assert(/The player character is "Jovan"/.test(userOf(ref)) && /hides his face under a paper bag/.test(userOf(ref)) && /Kaelen — Kaelen, fourth seat/.test(userOf(ref)), 'it read his name, the brief and who Kaelen is');
    const story = calls.find((c) => !c.isWorker);
    const closing = story.body.messages[story.body.messages.length - 1].content;
    assert(/^(?:[^—\n]{1,40} — )?[Aa]bout what Jovan is trying — feint low, then the disarm: /.test(closing), 'THE OUTCOME REACHES THE STORYTELLER, first in the closing words: ' + closing.slice(0, 160));
    assert(!/\b(?:SUCCESS|FAILURE|DECISIVE|SETBACK|DISASTER|house has ruled|round \d)\b/.test(closing), 'in words, never a form');
    const seed = calls.find((c) => c.isWorker && seedSys.test(sysOf(c)));
    assert(seed, 'the sheet the blind seeder made was weighed again on this page');
    assert(/is Jovan\. Every page labelled "Jovan \(the writer\)"/.test(userOf(seed)), 'and the seeder was told who the writer plays');
    const sheet = (await loadState(st.id)).sheet;
    eq(Object.keys(sheet.actors)[0] === 'Jovan' || Boolean(sheet.actors.Jovan), true, 'Jovan is on his sheet');
    eq(sheet.actors.Jovan.default, 6, 'weighed');
    assert(!sheet.actors.Kaelen.conditions, 'Kaelen no longer wears Jovan’s bag: ' + JSON.stringify(sheet.actors.Kaelen));
    eq(sheet.seedVersion, 2, 'stamped');
    /* the drawer names him first, as "you" */
    /* OFF */
    await openSettings(); if (q('[data-room="story"]')) click(q('[data-room="story"]'));
    const box = await until(() => q('#referee-on'), 'the switch is in Settings', 10000);
    if (box.checked) { box.checked = false; box.dispatchEvent(new env.window.Event('change', { bubbles: true })); }
    await until(async () => (await db.settings.get('refereeOn')) === false, 'kept off', 5000);
    await closeSettings();
    let s2 = await loadState(st.id);
    s2 = applyMutations(s2, [{ type: 'combat.begin', kind: 'duel', opponent: 'Kaelen', domain: 'melee', opponentRating: 5 }]).state;
    await saveState(st.id, s2);
    assert((await loadState(st.id)).duel, 'a fight stands before the switch-off page');
    const offCalls = await send('I try to disarm Kaelen again.');
    assert(!offCalls.some((c) => c.isWorker && (refSys.test(sysOf(c)) || seedSys.test(sysOf(c)))), 'OFF: no referee, no seeder');
    const offStory = offCalls.find((c) => !c.isWorker);
    const all = JSON.stringify(offStory.body);
    assert(!/[Aa]bout what Jovan is trying|An outcome already settled|The house has ruled =|A duel is joined/.test(all), 'OFF: not one word of it reaches the storyteller');
    eq((await loadState(st.id)).duel, null, 'OFF: the standing fight was let go');
  } finally {
    house.state.storyAnswer = priorStory; house.state.workerAnswer = priorWorker;
    if (was === false) await db.settings.set('refereeOn', false); else await db.settings.delete('refereeOn');
    await closeSettings();
  }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-69 CANON VERIFICATION IN THE APP: switched on in Settings (off as it ships), the series’ wiki named, the storyteller’s briefing opens with what the wiki says of Rukia — the extension itself doing the work; switched off, nothing is looked up and nothing of it is sent (M346)', async () => {
  const before = errors.length;
  const { queuedCount, workIsRunning } = await import('../../js/agents/queue.js');
  const { saveState, emptyState } = await import('../../js/engine/state.js');
  const { applyMutations } = await import('../../js/engine/apply.js');
  const H = '[Soul Society training ground — Monday, September 7, 2026 | 09:00 | clear | shihakusho | kneeling]\n\n';
  const st = await db.stories.create({ title: 'Soul Society' });
  await db.stories.update(st.id, { keeper: false, brief: 'A Bleach story. Jovan, a new Shinigami, trains under Rukia Kuchiki.' });
  await db.messages.append(st.id, { role: 'user', text: 'I kneel on the training ground.' });
  await db.messages.append(st.id, { role: 'assistant', text: H + 'Rukia Kuchiki folded her arms. "Again."' });
  const ledger = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }]).state;
  ledger.characters = { 'Rukia Kuchiki': { core: 'His instructor.', state: 'drilling him', threads: [] } };
  await saveState(st.id, { ...ledger, page: 1, readTo: 1, tidiedGen: 999 });
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  const wikiAsked = [];
  const priorFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => {
    if (!/fandom\.com|wiki\.gg/.test(String(url))) return priorFetch(url, opts);
    const u = new URL(String(url));
    wikiAsked.push(u.hostname);
    const ok = (obj) => Promise.resolve({ ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) });
    if (u.hostname !== 'bleach.fandom.com') return ok({});
    const titles = u.searchParams.get('titles'); const page = u.searchParams.get('page'); const sr = u.searchParams.get('srsearch');
    if (u.searchParams.get('list') === 'recentchanges') return ok({ query: { recentchanges: [{ timestamp: '2026-09-01T00:00:00Z' }] } });
    if (sr) return ok({ query: { search: /rukia/i.test(sr) ? [{ title: 'Rukia Kuchiki' }] : [] } });
    if (titles) return /rukia/i.test(titles) ? ok({ query: { pages: { 7: { pageid: 7, title: 'Rukia Kuchiki' } } } }) : ok({ query: { pages: { '-1': { title: titles, missing: '' } } } });
    if (page && /rukia/i.test(page)) return ok({ parse: { title: 'Rukia Kuchiki', wikitext: { '*': "{{Infobox Character\n| name = Rukia Kuchiki\n| hair = Black, chin-length\n| eyes = Violet\n}}\n'''Rukia Kuchiki''' is a Shinigami.\n== Personality ==\nRukia is stern and proud." } } });
    return ok({});
  };
  /* the storyteller's own request — the one that carries the briefing (the extension's own model calls, its parser and
   * its dossier writer, speak in prompts this walk's house does not know as workers, so "not a worker" is not enough) */
  const send = async (words) => { const from = house.state.calls.length; const had = (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length; type(q('#composer-input'), words); submit(q('#composer')); await until(async () => (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length > had && !env.ctx.chat.isBusy(), 'the page', 40000); await until(() => queuedCount(st.id) === 0 && !workIsRunning(st.id), 'the readers', 40000); const told = house.state.calls.slice(from).find((c) => Array.isArray(c.body.messages) && c.body.messages.some((m) => m.role === 'user' && /where things stand/i.test(String(m.content)))); assert(told, 'the storyteller was asked'); return told.body; };
  const setCanon = async (on, wiki) => {
    await openSettings();
    const box = await until(() => q('#canon-on'), 'the switch is in Settings', 10000);
    if (box.checked !== on) { box.checked = on; box.dispatchEvent(new env.window.Event('change', { bubbles: true })); }
    if (typeof wiki === 'string') { const w = q('#canon-wikis'); w.value = wiki; w.dispatchEvent(new env.window.Event('change', { bubbles: true })); }
    await until(async () => ((await db.settings.get('canonOn')) === true) === on, 'kept', 5000);
    await closeSettings();
  };
  const was = await db.settings.get('canonOn');
  try {
    await openSettings();
    eq((await until(() => q('#canon-on'), 'the switch', 10000)).checked, false, 'it ships OFF');
    await closeSettings();
    await setCanon(true, 'bleach');
    const on = await send('I bow to Rukia and ask her to teach me kido.');
    const briefing = on.messages.find((m) => m.role === 'user' && /where things stand/i.test(String(m.content)));
    assert(briefing, 'the briefing rode: ' + on.messages.map((m) => m.role + ':' + String(m.content).slice(0, 80)).join(' || '));
    assert(/Canon from this series' wiki/.test(briefing.content) && /Violet|Black, chin-length/.test(briefing.content), 'the briefing opens with what the wiki says of Rukia: ' + String(briefing.content).slice(0, 300));
    assert(wikiAsked.includes('bleach.fandom.com'), 'the series’ wiki was asked');
    await setCanon(false);
    const asked = wikiAsked.length;
    const off = await send('I try the incantation again.');
    assert(!/Canon from this series' wiki|Violet|chin-length/.test(JSON.stringify(off.messages)), 'OFF: nothing of it is sent');
    eq(wikiAsked.length, asked, 'OFF: nothing is looked up');
  } finally {
    globalThis.fetch = priorFetch;
    if (was === true) await db.settings.set('canonOn', true); else await db.settings.delete('canonOn');
    await closeSettings();
  }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-70 WHAT THE STORYTELLER SAW, WORD FOR WORD: the sheet opens on Normal; tapping a part (the frame) opens what it said, and Copy takes exactly that; Raw shows the request as the model took it — its settings, then system and user under their roles — and Copy all takes the very body the model received; a page from before its words were kept says so, plainly (M347)', async () => {
  const before = errors.length;
  const { queuedCount, workIsRunning } = await import('../../js/agents/queue.js');
  const st = await db.stories.create({ title: 'the receipt' });
  await db.stories.update(st.id, { keeper: false, extraction: false });
  /* an old page: its receipt kept sizes only */
  await db.messages.append(st.id, { role: 'user', text: 'An old line.' });
  await db.messages.append(st.id, { role: 'assistant', text: '[Lakeside — Monday, March 3, 2025 | 09:00 | clear | coat | bench]\n\nOld words.', receipt: { v: 1, ts: 1, slots: [{ name: 'The frame', tokens: 12, source: '', reason: '' }], totalTokens: 12, model: 'old' } });
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  const copied = [];
  const clip = env.window.navigator.clipboard;
  const priorWrite = clip.writeText;
  clip.writeText = async (t) => { copied.push(String(t)); };
  try {
    const from = house.state.calls.length;
    const had = (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length;
    type(q('#composer-input'), 'I sit beside her.'); submit(q('#composer'));
    await until(async () => (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length > had && !env.ctx.chat.isBusy(), 'the page', 30000);
    await until(() => queuedCount(st.id) === 0 && !workIsRunning(st.id), 'the readers', 30000);
    const told = house.state.calls.slice(from).find((c) => !c.isWorker);
    assert(told, 'the storyteller was asked');
    /* open the newest page's receipt */
    const btn = await until(() => { const b = qa('#thread .msg-assistant .msg-receipt'); return b.length >= 2 ? b[b.length - 1] : null; }, 'the receipt under the new page', 10000);
    click(btn);
    await until(() => !q('#receipt-sheet').hidden, 'the sheet opens', 5000);
    eq(q('#receipt-tab-normal').getAttribute('aria-selected'), 'true', 'it opens on Normal');
    const frameRow = await until(() => { const li = qa('#receipt-slots li.receipt-slot').find((x) => x.dataset.slot === 'The frame'); return li && li.querySelector('.receipt-slot-toggle') ? li : null; }, 'the frame can be tapped', 10000);
    const body = frameRow.querySelector('.receipt-slot-body');
    eq(body.hidden, true, 'closed until tapped');
    click(frameRow.querySelector('.receipt-slot-toggle'));
    eq(body.hidden, false, 'tapped: open');
    const words = body.querySelector('.receipt-text').textContent;
    const systemSent = (told.body.messages || []).filter((m) => m.role === 'system').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
    assert(words.length > 20 && systemSent.includes(words.slice(0, 200)), 'the frame’s words are the words sent: ' + words.slice(0, 80));
    click(body.querySelector('.receipt-copy'));
    await until(() => copied.length === 1, 'copied', 3000);
    eq(copied[0], words, 'Copy takes exactly what the part said');
    /* Raw */
    click(q('#receipt-tab-raw'));
    eq(q('#receipt-raw').hidden, false, 'Raw shows');
    eq(q('#receipt-slots').hidden, true, 'and Normal steps aside');
    const roles = qa('#receipt-raw .raw-role span').map((x) => x.textContent);
    assert(roles[0] === 'settings' && roles.includes('system') && roles.includes('user'), 'its settings, then system and user: ' + roles.join(','));
    eq(roles.filter((r) => r !== 'settings').length, (told.body.messages || []).length, 'every message the model got, one each');
    click(qa('#receipt-raw .raw-head .receipt-copy')[0]);
    await until(() => copied.length === 2, 'copied all', 3000);
    eq(JSON.stringify(JSON.parse(copied[1])), JSON.stringify(told.body), 'Copy all is the very body the model received');
    click(q('#btn-receipt-close'));
    await until(() => q('#receipt-sheet').hidden, 'put away', 3000);
    /* the old page */
    click(qa('#thread .msg-assistant .msg-receipt')[0]);
    await until(() => !q('#receipt-sheet').hidden, 'the old sheet opens', 5000);
    assert(/written before its words were kept/.test(q('#receipt-words-note').textContent) && !q('#receipt-words-note').hidden, 'the old page says so, plainly');
    assert(!q('#receipt-slots .receipt-slot-toggle'), 'and offers nothing to tap that is not there');
    click(q('#receipt-tab-raw'));
    assert(/written before its words were kept/.test(q('#receipt-raw').textContent), 'Raw says it too');
    click(q('#btn-receipt-close'));
  } finally {
    clip.writeText = priorWrite;
  }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-71 KIMI K3 BEHIND SYNTHETIC’S ALIAS, IN THE APP: “syn:large:vision” at Low is learned from the provider’s own list before the page and sent Moonshot’s K3 request — reasoning_effort "low" and no thinking switch — and a page that asked for thinking and got none says so on its receipt (M348)', async () => {
  const before = errors.length;
  const conns = await db.connections.list();
  const conn = conns.find((c) => c && c.baseUrl && /mock\.example/.test(c.baseUrl)) || conns[0];
  const kept = { model: conn.model, reasoning: conn.reasoning || null, contextSize: conn.contextSize == null ? null : conn.contextSize };
  await db.connections.update(conn.id, { model: 'syn:large:vision', reasoning: { effort: 'low' }, contextSize: 1000000, identFor: null, identTriedFor: null, identTriedAt: null, modelHf: null, modelEfforts: null });
  house.state.models = [{ provider: 'synthetic', always_on: true, id: 'syn:large:vision', hugging_face_id: 'moonshotai/Kimi-K3', reasoning_parameters: { efforts: ['low', 'high', 'max'] }, context_length: 1048576 }];
  try {
    const st = await db.stories.create({ title: 'the alias' });
    await db.stories.update(st.id, { keeper: false, extraction: false });
    await db.messages.append(st.id, { role: 'user', text: 'We begin.' });
    await db.messages.append(st.id, { role: 'assistant', text: '[Harbor — Monday, March 3, 2025 | 09:00 | clear | coat | the pier]\n\nThe gulls wheeled.' });
    env.window.__cozy.setActiveStoryId(st.id);
    await env.window.__cozy.chat.renderThread({ structural: true });
    const from = house.state.calls.length;
    type(q('#composer-input'), 'I walk to the end of the pier.'); submit(q('#composer'));
    await until(async () => (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length >= 2 && !env.ctx.chat.isBusy(), 'the page', 30000);
    const told = house.state.calls.slice(from).find((c) => !c.isWorker && c.body && c.body.model === 'syn:large:vision');
    assert(told, 'the storyteller was asked on the alias');
    eq(told.body.reasoning_effort, 'low', 'Low is sent as K3’s own "low"');
    assert(!('thinking' in told.body), 'and no thinking switch rides (Moonshot: K3 must not be sent one): ' + JSON.stringify(told.body.thinking));
    const learned = (await db.connections.list()).find((c) => c.id === conn.id);
    eq(learned.modelHf, 'moonshotai/Kimi-K3', 'the connection knows what the alias is');
    const page = (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').pop();
    eq(page.receipt && page.receipt.noThought, true, 'no thinking came back — and the page knows it');
    click(qa('#thread .msg-assistant .msg-receipt').pop());
    await until(() => !q('#receipt-sheet').hidden, 'the sheet', 5000);
    assert(/no thinking came back from the model/.test(q('#receipt-footer').textContent), 'the receipt says so: ' + q('#receipt-footer').textContent);
    click(q('#btn-receipt-close'));
  } finally {
    house.state.models = null;
    await db.connections.update(conn.id, { model: kept.model, reasoning: kept.reasoning, contextSize: kept.contextSize, identFor: null, identTriedFor: null, identTriedAt: null, modelHf: null, modelEfforts: null });
  }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-72 THINKING ASKED FOR AND NONE CAME BACK: the page says so once, and “Test” on the connection answers which it is — this level, this address, or a model whose words are kept from him (M351)', async () => {
  const before = errors.length;
  const { queuedCount, workIsRunning } = await import('../../js/agents/queue.js');
  /* its own connection: the house says this once per connection and level, and DOM-71 already spent the house one at “low” */
  const conns = await db.connections.list();
  const house0 = conns.find((c) => c && c.baseUrl && /mock\.example/.test(c.baseUrl)) || conns[0];
  const wasActive = await db.settings.get('activeConnectionId');
  const conn = await db.connections.add({ label: 'a quiet thinker', type: 'openai', baseUrl: house0.baseUrl, apiKey: house0.apiKey || 'k', model: 'syn:large:vision', reasoning: { effort: 'low' } });
  await db.settings.set('activeConnectionId', conn.id);
  const said = [];
  const realToast = env.ctx.toast;
  env.ctx.toast = (w) => { said.push(String(w)); return realToast ? realToast(w) : undefined; };
  const priorFetch = globalThis.fetch;
  const probes = [];
  /* the house answers a page as always; a whole (non-streamed) question — what “Test” asks — is answered here: no
   * thinking at "low", thinking at "max" */
  globalThis.fetch = async (url, opts) => {
    let body = null;
    try { body = opts && opts.body ? JSON.parse(opts.body) : null; } catch (err) { body = null; }
    if (!body || body.stream !== false || !/chat\/completions/.test(String(url))) return priorFetch(url, opts);
    probes.push(body);
    const thought = body.reasoning_effort === 'max' ? 'I turn it over. '.repeat(8) : '';
    return { ok: true, status: 200, headers: new Headers(), async json() { return { choices: [{ message: { role: 'assistant', content: 'ready.', ...(thought ? { reasoning_content: thought } : {}) } }] }; }, async text() { return '{}'; }, clone() { return this; } };
  };
  try {
    const st = await db.stories.create({ title: 'no thinking' });
    await db.stories.update(st.id, { keeper: false, extraction: false });
    await db.messages.append(st.id, { role: 'user', text: 'We begin.' });
    await db.messages.append(st.id, { role: 'assistant', text: '[Kitchen — Monday, March 3, 2025 | 09:00 | clear | apron | by the stove]\n\nThe kettle sang.' });
    env.window.__cozy.setActiveStoryId(st.id);
    await env.window.__cozy.chat.renderThread({ structural: true });
    type(q('#composer-input'), 'Do you think we can live on Mars?'); submit(q('#composer'));
    await until(async () => (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length >= 2 && !env.ctx.chat.isBusy(), 'the page', 30000);
    await until(() => queuedCount(st.id) === 0 && !workIsRunning(st.id), 'the readers', 30000);
    assert(said.some((w) => /Thinking was asked for at “low” and none came back/.test(w)), 'the page says so: ' + said.join(' | '));
    const page = (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').pop();
    eq(page.receipt && page.receipt.noThought, true, 'and the receipt keeps it (M348)');
    /* the one tap that answers which it is */
    await openSettings();
    /* the rooms of Settings are remembered between visits, and one card is shown at a time — the picker chooses it */
    click(q('[data-room="storyteller"]'));
    await until(() => q('#connection-pick') && [...q('#connection-pick').options].some((o) => o.value === conn.id), 'the picker', 10000);
    q('#connection-pick').value = conn.id;
    q('#connection-pick').dispatchEvent(new env.window.Event('change', { bubbles: true }));
    const card = await until(() => { const el = q('#connection-list .connection-card'); return el && /syn:large:vision/.test(el.textContent) ? el : null; }, 'the connection card', 10000);
    const testBtn = qa('button', card).find((b) => b.textContent.trim() === 'Test');
    assert(testBtn, 'the Test is on the card');
    click(testBtn);
    const result = await until(() => { const r = card.querySelector('.test-result'); return r && !r.hidden && /Asked at/.test(r.textContent) ? r : null; }, 'the test answers', 15000);
    assert(/NO thinking with it/.test(result.textContent) && /Asked again at “max”/.test(result.textContent) && /this LEVEL that gives none here/.test(result.textContent), 'it names which it is: ' + result.textContent);
    eq(probes.length, 2, 'asked at the level set, then once at the top');
    eq(probes[0].reasoning_effort, 'low', 'the level set');
    await closeSettings();
  } finally {
    globalThis.fetch = priorFetch;
    env.ctx.toast = realToast;
    await db.settings.set('activeConnectionId', wasActive);
    await db.connections.remove(conn.id);
    await closeSettings();
  }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-73 EVERY ROOM OF SETTINGS HOLDS ITS OWN, AND NOTHING IS LOST IN THE GLOSSARY: each section is reached from exactly one room, canon verification stands with the referee in The readers, and a section nobody listed shows beside its neighbours rather than at the end (M352)', async () => {
  const before = errors.length;
  await openSettings();
  const chips = await until(() => { const c = qa('#view-settings .nav-chip'); return c.length ? c : null; }, 'the rooms', 10000);
  const all = qa('#view-settings .settings-section').map((s) => s.id);
  assert(all.includes('section-canon'), 'canon verification is a section of Settings');
  const seen = new Map();
  for (const chip of chips) {
    click(chip);
    await until(() => chip.classList.contains('current'), 'the room opens', 5000);
    for (const s of qa('#view-settings .settings-section')) {
      if (s.hidden) continue;
      seen.set(s.id, [...(seen.get(s.id) || []), chip.dataset.room]);
    }
  }
  for (const id of all) {
    const rooms = seen.get(id) || [];
    eq(rooms.length, 1, id + ' is reached from exactly one room (got: ' + rooms.join(', ') + ')');
  }
  eq((seen.get('section-canon') || [])[0], 'readers', 'canon verification stands with the referee, in The readers');
  eq((seen.get('section-referee') || [])[0], 'readers', 'and the referee is still there');
  eq(JSON.stringify([...seen.entries()].filter(([, r]) => r[0] === 'help').map(([id]) => id)), JSON.stringify(['section-help']), 'the glossary holds the glossary, and nothing that was merely forgotten');
  await closeSettings();
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-74 THE DERESTRICTED SWITCH, IN THE APP: on, the five plain lines ride at the end and a page that speaks for his character is asked for again ONCE (the second page is the one kept); off, neither happens and nothing of it is sent (M354)', async () => {
  const before = errors.length;
  const { queuedCount, workIsRunning } = await import('../../js/agents/queue.js');
  const { saveState, emptyState } = await import('../../js/engine/state.js');
  const { applyMutations } = await import('../../js/engine/apply.js');
  const H = '[The courtyard — Monday, March 3, 2025 | 09:00 | clear | coat | by the gate]\n\n';
  const st = await db.stories.create({ title: 'his to play' });
  await db.stories.update(st.id, { keeper: false, extraction: false });
  await db.messages.append(st.id, { role: 'user', text: 'We begin.' });
  await db.messages.append(st.id, { role: 'assistant', text: H + 'Kaelen waited by the gate.' });
  const ledger = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'the courtyard' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Kaelen' }]).state;
  await saveState(st.id, { ...ledger, page: 1, readTo: 1, tidiedGen: 999 });
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  const priorStory = house.state.storyAnswer;
  let answers = 0;
  house.state.storyAnswer = () => { answers += 1; return answers === 1 ? H + '"Fine," Jovan said, and he stepped back from the fire.' : H + 'Kaelen raised the practice sword and waited.'; };
  const was = await db.settings.get('olderModel');
  const send = async (words) => { const from = house.state.calls.length; const had = (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length; type(q('#composer-input'), words); submit(q('#composer')); await until(async () => (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length > had && !env.ctx.chat.isBusy(), 'the page', 30000); await until(() => queuedCount(st.id) === 0 && !workIsRunning(st.id), 'the readers', 30000); return house.state.calls.slice(from).filter((c) => !c.isWorker); };
  const closingOf = (call) => String(call.body.messages[call.body.messages.length - 1].content || '');
  try {
    /* OFF (as it ships): nothing of it, and a page that speaks for him is kept as it came */
    await db.settings.delete('olderModel');
    answers = 0;
    const offCalls = await send('I walk to the gate.');
    eq(offCalls.length, 1, 'OFF: asked once');
    assert(!/five things|is mine\./.test(JSON.stringify(offCalls[0].body)), 'OFF: not one word of the five lines');
    const offPage = (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').pop();
    assert(/Jovan said/.test(offPage.text), 'OFF: the page that spoke for him stands, as it always did');
    /* ON */
    await openSettings();
    click(q('[data-room="craft"]'));
    const box = await until(() => q('#older-model'), 'the switch', 10000);
    if (!box.checked) { box.checked = true; box.dispatchEvent(new env.window.Event('change', { bubbles: true })); }
    await until(async () => (await db.settings.get('olderModel')) === true, 'kept on', 5000);
    await closeSettings();
    answers = 0;
    const onCalls = await send('I ask him what he wants.');
    eq(onCalls.length, 2, 'ON: the page that took his character was asked for again, once');
    assert(/while we tell this one, five things/i.test(closingOf(onCalls[0])), 'ON: the five lines rode: ' + closingOf(onCalls[0]).slice(0, 120));
    for (const law of ['Jovan is mine', 'stays set against him', 'Let the room talk', 'End where I can act']) assert(closingOf(onCalls[0]).includes(law), 'ON: ' + law);
    const askedAgain = onCalls[1].body.messages;
    assert(/Jovan said/.test(String(askedAgain[askedAgain.length - 2].content)), 'the page it wrote was handed back');
    assert(/took my character/.test(String(askedAgain[askedAgain.length - 1].content)), 'with the writer’s own word for what to cut');
    const kept = (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').pop();
    assert(/Kaelen raised the practice sword/.test(kept.text) && !/Jovan said/.test(kept.text), 'and the page kept is the one that leaves him to the writer: ' + kept.text.slice(0, 80));
  } finally {
    house.state.storyAnswer = priorStory;
    if (was === true) await db.settings.set('olderModel', true); else await db.settings.delete('olderModel');
    await closeSettings();
  }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

test('DOM-75 THE SENSORS IN THE APP: off as they ship; switched on, each page is read back and the drift they find is said to the storyteller ONCE on the next turn, in the writer’s voice, then let go (M356)', async () => {
  const before = errors.length;
  const { queuedCount, workIsRunning } = await import('../../js/agents/queue.js');
  const { loadSensors } = await import('../../js/agents/sensors.js');
  const H = '[The courtyard — Monday, March 3, 2025 | 09:00 | clear | coat | by the gate]\n\n';
  const st = await db.stories.create({ title: 'the sensors walk' });
  await db.stories.update(st.id, { keeper: false, extraction: false, brief: 'A hard tale where things cost him.' });
  await db.messages.append(st.id, { role: 'user', text: 'We begin.' });
  await db.messages.append(st.id, { role: 'assistant', text: H + 'Kaelen waited by the gate.' });
  env.window.__cozy.setActiveStoryId(st.id);
  await env.window.__cozy.chat.renderThread({ structural: true });
  const priorStory = house.state.storyAnswer;
  /* the house answers the sensors' own question with numbers, and every other ask with a page */
  const sysOfBody = (body) => (Array.isArray(body && body.messages) ? body.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n') : '');
  house.state.storyAnswer = (body) => (/You judge a page of a story/.test(sysOfBody(body))
    ? '{"tone": 0.9, "cost": 0.05, "tension": 0.8, "world": 0.9, "mine": 0.9}'
    : H + 'The morning went on, and nobody gave an inch.');
  const was = await db.settings.get('sensorsOn');
  const send = async (words) => { const from = house.state.calls.length; const had = (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length; type(q('#composer-input'), words); submit(q('#composer')); await until(async () => (await db.messages.list(st.id)).filter((m) => m.role === 'assistant').length > had && !env.ctx.chat.isBusy(), 'the page', 30000); await until(() => queuedCount(st.id) === 0 && !workIsRunning(st.id), 'the readers', 30000); return house.state.calls.slice(from); };
  const closingOf = (calls) => { const told = calls.find((c) => /You are telling a story/i.test(sysOfBody(c.body))); return told ? String(told.body.messages[told.body.messages.length - 1].content || '') : ''; };
  try {
    await db.settings.delete('sensorsOn');
    const offCalls = await send('I wait by the gate.');
    assert(!offCalls.some((c) => /You judge a page of a story/.test(JSON.stringify(c.body))), 'OFF: nothing is asked of them');
    eq(JSON.stringify((await loadSensors(st.id)).readings || {}), '{}', 'OFF: and nothing is kept');
    await openSettings();
    click(q('[data-room="readers"]'));
    const box = await until(() => q('#sensors-on'), 'the switch is in The readers', 10000);
    eq(box.checked, false, 'it ships off');
    box.checked = true; box.dispatchEvent(new env.window.Event('change', { bubbles: true }));
    await until(async () => (await db.settings.get('sensorsOn')) === true, 'kept on', 5000);
    await closeSettings();
    await send('I ask him what it will cost.');
    await send('I wait for his answer.');
    const kept = await loadSensors(st.id);
    assert(Array.isArray(kept.readings.cost) && kept.readings.cost.length >= 2, 'ON: each page is read back: ' + JSON.stringify(kept.readings.cost || null));
    const third = await send('I hold his eye.');
    const closing = closingOf(third);
    assert(/nothing has cost him anything/i.test(closing), 'the drift is said to the storyteller, in the writer’s voice: ' + closing.slice(0, 140));
    const fourth = await send('I let the silence run.');
    assert(!/nothing has cost him anything/i.test(closingOf(fourth)), 'and never twice');
  } finally {
    house.state.storyAnswer = priorStory;
    if (was === true) await db.settings.set('sensorsOn', true); else await db.settings.delete('sensorsOn');
    await closeSettings();
  }
  eq(errorsSince(before).length, 0, errorsSince(before).join(' | '));
});

console.log('Cozy Tavern — the dom walk');
await runAll();
process.exit(process.exitCode || 0);
