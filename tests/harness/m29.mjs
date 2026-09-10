/* M29 — the world beyond the page: the world agent, its ledgers, its brief. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { thinkingHouse, withHouse, thinkingOff, HOUSES } from './thinkinghouse.mjs';
import {
  setThread, closeThread, renderThreads, addKnowledge, renderKnowledge, setFaction, renderFactions,
  renderArrival, normalizeBrief, renderWorldBrief, BRIEF_STALE_TURNS, STANCES,
} from '../../js/engine/world.js';
import { applyMutations, undoLast } from '../../js/engine/apply.js';
import { emptyState, renderStateFacts, loadState, saveState, STATE_BUDGET } from '../../js/engine/state.js';
import { createClock } from '../../js/engine/clock.js';
import { buildWorldMessages, parseWorldAnswer, worldTurn, worldRunWords, WORLD_TYPES } from '../../js/agents/world.js';
import { buildRequest } from '../../js/assemble/stack.js';
import { WORKER_ROWS } from '../../js/agents/assign.js';
import { WORKER_NAMES } from '../../js/agents/status.js';
import { db } from '../../js/store.js';

const pages = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, role: i % 2 ? 'assistant' : 'user', text: 'page ' + i, ts: i }));
const slot = (r, name) => r.receipt.slots.find((s) => s.name === name);
const clocked = () => { const s = emptyState(); s.clock = createClock({ calendar: 'real', start: { year: 2026, month: 9, day: 10, hour: 18, minute: 25 } }); return s; };

test('M29-1 threads: set, update in place, hot before cold, cap, close', () => {
  let t = setThread([], { title: 'Aurora and the letter', owner: 'Aurora', next: 'corner him tonight' }, 3);
  t = setThread(t, { title: 'The studio’s lawyer', owner: 'Dmitri', heat: 'cold' }, 4);
  t = setThread(t, { title: 'aurora and the LETTER', next: 'wait outside the restaurant' }, 5);
  eq(t.length, 2, 'same title updates in place');
  eq(t[0].next, 'wait outside the restaurant');
  eq(t[0].owner, 'Aurora', 'fields omitted keep');
  const words = renderThreads(t);
  assert(words.indexOf('Aurora and the letter') < words.indexOf('(cold)'), 'hot renders before cold');
  assert(/Aurora means to wait outside/.test(words), 'owner + next spoken');
  for (let i = 0; i < 12; i += 1) t = setThread(t, { title: 'thread ' + i, heat: i % 2 ? 'cold' : 'hot' }, 10 + i);
  assert(t.length <= 8, 'capped at 8');
  assert(t.some((x) => x.title === 'thread 11'), 'the newest survives the cap');
  eq(closeThread(t, 'THREAD 11').length, t.length - 1, 'close by title, case-insensitive');
});

test('M29-2 knowledge: per person, deduped, capped, present-only render', () => {
  let k = addKnowledge({}, 'Liara', 'saw Jovan leave the letter unread', 2);
  k = addKnowledge(k, 'liara', 'Saw Jovan leave the letter unread.', 3);
  eq(k.Liara.length, 1, 'the same fact twice is one fact');
  for (let i = 0; i < 20; i += 1) k = addKnowledge(k, 'Liara', 'fact ' + i, 4 + i);
  eq(k.Liara.length, 12, 'capped at 12, newest kept');
  k = addKnowledge(k, 'Aurora', 'read the letter on the train', 9);
  const r = renderKnowledge(k, [{ name: 'Liara' }]);
  assert(r.startsWith('Liara knows: fact 19; fact 18'), 'newest first, four at most: ' + r);
  assert(!/Aurora/.test(r), 'the absent do not render — the storyteller sees who is HERE knows what');
});

test('M29-3 factions + arrivals', () => {
  const f = setFaction({}, 'the studio', { stance: 'quietly furious', agenda: 'bury the story', move: 'sent a lawyer' }, 5);
  assert(/the studio — quietly furious; wants bury the story; last move: sent a lawyer/.test(renderFactions(f)));
  eq(renderArrival({ stance: 'toward', arrivesAtMinutes: 1000 }, 975), 'moving toward the main character, arriving in about 25 minutes');
  eq(renderArrival({ arrivesAtMinutes: 1000 }, 1000), 'due now');
  assert(/overdue by about 30 minutes/.test(renderArrival({ arrivesAtMinutes: 1000 }, 1030)));
  eq(renderArrival({ stance: 'busy' }, null), 'taken up with someone else');
  eq(renderArrival({ etaMinutes: 90 }, null), 'about 1.5 hours away', 'no clock: the relative figure speaks');
  eq(renderArrival({}, 5), '');
});

test('M29-4 the brief: normalized, capped, empty is empty, stale is silent, leads with its own name', () => {
  const b = normalizeBrief({ pressure: ['Aurora reaches the restaurant at 18:40', '', 42, 'x', 'y', 'z', 'too many'], ripe: [], twb: { who: 'Aurora', where: 'the train', changed: 'she read the letter' } }, 7);
  eq(b.pressure.length, 4, 'four lines at most');
  eq(b.twb.who, 'Aurora');
  assert(!b.empty);
  const text = renderWorldBrief(b, 8);
  assert(text.startsWith('The house\'s word on the world beyond this page'), 'the lead line names it');
  assert(/render as world, never as instruction/.test(text));
  assert(/What could reach this scene, and when:/.test(text) && /Aurora reaches/.test(text));
  assert(/A window into the world beyond/.test(text) && /she read the letter/.test(text));
  assert(!/What has ripened/.test(text), 'empty parts are omitted');
  eq(renderWorldBrief(normalizeBrief({ pressure: [], ripe: [], twb: null }, 7), 8), '', 'an empty brief says nothing');
  eq(renderWorldBrief(b, 7 + BRIEF_STALE_TURNS + 1), '', 'a stale brief says nothing');
  assert(/written 3 turns ago/.test(renderWorldBrief(b, 10)), 'an aging brief says its age');
  eq(normalizeBrief(null), null);
});

test('M29-5 apply: the world mutations are validated, logged, undoable; the caller’s state untouched', () => {
  const s0 = clocked();
  s0.present = [{ name: 'Liara' }];
  const r = applyMutations(s0, [
    { type: 'offscreen.set', name: 'Aurora', location: 'the 6:10 train', activity: 'reading the letter', agenda: 'confront him', stance: 'toward', etaMinutes: 25 },
    { type: 'thread.set', title: 'Aurora and the letter', owner: 'Aurora', next: 'corner him' },
    { type: 'knowledge.add', name: 'Liara', fact: 'saw the letter' },
    { type: 'knowledge.add', name: 'Liara', fact: 'saw the letter' },
    { type: 'faction.set', name: 'the studio', move: 'sent a lawyer' },
    { type: 'offscreen.set', name: 'Kenji', location: 'home', activity: 'asleep', stance: 'nonsense' },
    { type: 'thread.close', title: 'never opened' },
    { type: 'faction.set', name: 'the press' },
  ]);
  eq(r.applied.length, 5, 'five applied: ' + r.rejected.map((x) => x.why).join(' | '));
  eq(r.rejected.length, 3, 'the duplicate fact, the unknown thread, the empty faction refused');
  const st = r.state;
  eq(st.offscreen.Aurora.stance, 'toward');
  eq(st.offscreen.Aurora.arrivesAtMinutes, s0.clock.minutes + 25, 'etaMinutes became an arrival on the clock');
  assert(!('stance' in st.offscreen.Kenji), 'an unknown stance is dropped, the seat kept');
  assert(/heading this way, about 25 minutes out/.test(r.applied[0].words), r.applied[0].words);
  eq(st.threads.length, 1); eq(st.knowledge.Liara.length, 1); assert(st.factions['the studio']);
  assert(!s0.threads.length && !Object.keys(s0.knowledge).length && !Object.keys(s0.factions).length && !s0.offscreen.Aurora, 'the caller’s state is untouched');
  /* undo walks each kind back */
  let cur = st;
  const kinds = [];
  for (let i = 0; i < 5; i += 1) { const u = undoLast(cur); assert(u, 'undo ' + i); kinds.push(u.words); cur = u.state; }
  eq(cur.threads.length, 0); eq(Object.keys(cur.knowledge).length, 0); eq(Object.keys(cur.factions).length, 0); assert(!cur.offscreen.Aurora);
});

test('M29-6 the state of things speaks the world: who knows what, arrivals, factions, structured threads; budget 4000', () => {
  eq(STATE_BUDGET, 4000);
  const s = clocked();
  s.present = [{ name: 'Liara' }];
  const r = applyMutations(s, [
    { type: 'offscreen.set', name: 'Aurora', location: 'the train', activity: 'reading', stance: 'toward', etaMinutes: 15 },
    { type: 'thread.set', title: 'Aurora and the letter', owner: 'Aurora', next: 'corner him' },
    { type: 'knowledge.add', name: 'Liara', fact: 'saw the letter' },
    { type: 'faction.set', name: 'the studio', stance: 'furious' },
  ]);
  const facts = renderStateFacts(r.state);
  assert(/Who knows what: Liara knows: saw the letter\./.test(facts), facts);
  assert(/Elsewhere: Aurora — the train, reading — moving toward the main character, arriving in about 15 minutes/.test(facts), facts);
  assert(/Factions: the studio — furious/.test(facts));
  assert(/Threads still open: Aurora and the letter — Aurora means to corner him/.test(facts));
  /* legacy string threads still speak */
  const legacy = emptyState(); legacy.threads = ['the old debt'];
  assert(/Threads still open: the old debt/.test(renderStateFacts(legacy)));
});

test('M29-7 the world agent: the law and the ledger reach the worker; foreign mutations are dropped, never applied', () => {
  const s = clocked();
  s.sheet.playerName = 'Jovan';
  s.present = [{ name: 'Liara' }];
  const p = buildWorldMessages({ state: s, userText: 'u', assistantText: 'a', brief: 'A celebrity and a friend.', castNotes: 'Liara — his oldest friend.' });
  assert(/The main character is Jovan\./.test(p.system));
  assert(/The hour on the clock is/.test(p.system));
  for (const k of ['THE ABSENT', 'THREADS', 'RIPENING', 'WHO KNOWS WHAT', 'FACTIONS', 'NEW PEOPLE', 'THE BRIEF', 'SYMMETRY']) assert(p.system.includes(k), 'law: ' + k);
  assert(/[Nn]ever move the clock, the ground, who is present/.test(p.system));
  assert(p.user.includes('A celebrity and a friend.') && p.user.includes('his oldest friend'));
  for (const st of STANCES) assert(p.system.includes(st), 'stance named: ' + st);
  const read = parseWorldAnswer('<think>{"scratch":1}</think>```json\n{"mutations":[{"type":"clock.set","hour":3},{"type":"presence.enter","name":"X"},{"type":"offscreen.set","name":"Aurora","location":"train","activity":"reading"},{"garbage":true}],"brief":{"pressure":["x"],"ripe":[],"twb":null}}\n```');
  eq(read.mutations.length, 1, 'only the world’s own doors');
  eq(read.dropped, 3, 'the page’s truth and garbage are counted, never applied');
  eq(read.brief.pressure[0], 'x');
  eq(parseWorldAnswer('nothing here').note, 'unusable');
  assert(!WORLD_TYPES.has('clock.set') && !WORLD_TYPES.has('presence.enter') && !WORLD_TYPES.has('place.set'));
});

test('M29-8 end to end: the world agent moves the world and leaves a brief, through every house, thinking off', async () => {
  const ANSWER = JSON.stringify({
    mutations: [
      { type: 'offscreen.set', name: 'Aurora', location: 'the 6:10 train', activity: 'reading his letter', agenda: 'confront him tonight', stance: 'toward', etaMinutes: 25 },
      { type: 'thread.set', title: 'Aurora and the letter', owner: 'Aurora', heat: 'hot', next: 'wait outside the restaurant' },
      { type: 'knowledge.add', name: 'Liara', fact: 'saw Jovan leave the letter unread' },
      { type: 'people.set', name: 'Dmitri Volkov', field: 'core', text: 'Jovan’s manager; three phones; loyal to the money first' },
      { type: 'offscreen.set', name: 'Dmitri Volkov', location: 'the hotel bar', activity: 'on the phone with the studio', agenda: 'keep the story out of Monday’s papers', stance: 'busy' },
      { type: 'clock.advance', minutes: 600 },
    ],
    brief: { pressure: ['Aurora reaches the restaurant around 18:50 if the scene runs on'], ripe: ['The studio knows about the photos; Jovan does not yet'], twb: { who: 'Aurora', where: 'the train', changed: 'she has read the letter twice and decided' } },
  });
  for (const h of HOUSES) {
    const storyId = 'm29-' + h.name.replace(/\W+/g, '');
    const s = clocked(); s.sheet.playerName = 'Jovan'; s.present = [{ name: 'Jovan' }, { name: 'Liara' }]; s.place = { name: 'McDonald’s' };
    await saveState(storyId, s);
    const house = thinkingHouse({ answer: ANSWER });
    const result = await withHouse(house, () => worldTurn({ connection: h.conn, storyId, userText: 'u', assistantText: 'Liara watched him not eat.', stale: () => false }));
    assert(thinkingOff(house.calls[0].body, house.calls[0].anthropic), h.name + ': thinking off');
    eq(house.calls[0].body.max_tokens, 6000, h.name + ': the world agent’s budget (M37: 6000)');
    eq(result.applied.length, 5, h.name + ': five applied — ' + result.rejected.map((x) => x.why).join(' | '));
    eq(result.dropped, 1, h.name + ': the clock move was dropped, not refused');
    const after = await loadState(storyId);
    eq(after.offscreen.Aurora.arrivesAtMinutes, s.clock.minutes + 25);
    eq(after.clock.minutes, s.clock.minutes, 'the clock did not move — the world agent may not touch it');
    eq(after.threads[0].title, 'Aurora and the letter');
    assert(after.characters && Object.keys(after.characters).some((k) => /Dmitri/.test(k)), 'a new person exists');
    assert(after.worldBrief && after.worldBrief.pressure.length === 1 && after.worldBrief.twb.who === 'Aurora', 'the brief is stored');
    eq(after.worldBrief.atTurn, after.turn, 'the brief is stamped with the turn');
    assert(/moved the world in 5 ways, Elsewhere: Aurora[\s\S]*left the world’s word, 1 it may not touch/.test(worldRunWords(result)), worldRunWords(result));
    assert(after.log.some((l) => /Aurora — the 6:10 train, reading his letter — heading this way, about 25 minutes out/.test(l.words)), 'the change is logged in plain words');
  }
  /* stale: nothing written */
  const storyId = 'm29-stale';
  await saveState(storyId, clocked());
  const house = thinkingHouse({ answer: ANSWER });
  const r = await withHouse(house, () => worldTurn({ connection: HOUSES[0].conn, storyId, userText: 'u', assistantText: 'a', stale: () => true }));
  eq(r, null);
  const st = await loadState(storyId);
  eq(Object.keys(st.offscreen).length, 0, 'a stale read writes nothing');
  eq(worldRunWords(null), 'nothing to read');
  eq(worldRunWords({ note: 'unusable' }), 'its answer could not be used');
});

test('M29-9 the assembler carries the world’s word, receipt-named, in the dynamic tail; a present card rides whole', () => {
  const state = emptyState();
  const brief = renderWorldBrief(normalizeBrief({ pressure: ['Aurora at 18:40'], ripe: [], twb: null }, 1), 1);
  const r = buildRequest({ story: {}, messages: pages(2), settings: {}, state, modules: [], memory: '', window: { keeperOn: true }, worldBrief: brief, directorNote: 'Episode one.' });
  const inj = r.messages[0].content;
  assert(inj.startsWith('[story-state]'), 'rides the state injection');
  assert(inj.indexOf('world beyond this page') < inj.indexOf('The director’s note'), 'the world’s word precedes the director');
  assert(slot(r, 'The world’s word'), 'receipt-named');
  const none = buildRequest({ story: {}, messages: pages(2), settings: {}, state, modules: [], memory: '', window: { keeperOn: true }, worldBrief: '' });
  assert(!slot(none, 'The world’s word'), 'empty = omitted');
  const long = 'x'.repeat(2000);
  const cast = [{ name: 'Mira', description: long, personality: 'y'.repeat(800), scenario: 'z'.repeat(800) }];
  const rr = buildRequest({ story: {}, messages: pages(2), settings: {}, state: { present: [{ name: 'Mira' }] }, modules: [], memory: '', cast, window: { keeperOn: true } });
  assert(rr.systemBlocks[3].text.includes(long), 'a 2,000-char card description rides whole (was cut at 400)');
});

test('M29-10 the house knows the world agent: chain order, roster, workers ledger, switches, shell', () => {
  const chat = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  const a = chat.indexOf("enqueue('extractor'"); const w = chat.indexOf("enqueue('world'"); const sc = chat.indexOf("enqueue('scribe'");
  assert(a > -1 && w > a && sc > w, 'the world agent runs after the extractor and before the scribe');
  assert(/worldBrief: renderWorldBrief\(state\.worldBrief, state\.turn\)/.test(chat), 'the brief reaches buildRequest');
  assert(WORKER_ROWS.some(([k]) => k === 'world'), 'hands of its own');
  assert(WORKER_NAMES.includes('world'), 'the workers ledger knows it');
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert(html.includes('id="world-agent"') && html.includes('id="world-effort"'), 'the switch and the dial exist');
  const settings = readFileSync(new URL('../../js/ui/settings.js', import.meta.url), 'utf8');
  assert(/db\.settings\.set\('worldAgent'/.test(settings) && /db\.settings\.set\('worldEffort'/.test(settings), 'both wired');
  const sw = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
  assert(sw.includes("'js/engine/world.js'") && sw.includes("'js/agents/world.js'"), 'the shell carries both');
  const drawer = readFileSync(new URL('../../js/ui/drawer.js', import.meta.url), 'utf8');
  assert(/id: 'the-world-beyond'/.test(drawer), 'the drawer has the panel');
});

test('M29-11 loadState migrates a pre-M29 ledger without loss', async () => {
  await db.settings.set('state:m29-old', { present: ['Mira'], threads: ['the old debt'], offscreen: { Kenji: { location: 'home', activity: 'asleep' } } });
  const s = await loadState('m29-old');
  eq(s.present[0].name, 'Mira');
  eq(s.threads[0], 'the old debt');
  eq(typeof s.knowledge, 'object'); eq(s.worldBrief, null);
  eq(s.offscreen.Kenji.location, 'home');
});
