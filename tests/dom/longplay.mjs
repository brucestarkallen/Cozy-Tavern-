/* Cozy Tavern — tests/dom/longplay.mjs
 * M87: the long play. The real app, booted in jsdom, played for ninety turns
 * by a scripted writer against a scripted storyteller and scripted workers
 * that behave the way good models behave (the storyteller reads the ledger's
 * hour and advances it; the extractor reads the header; the world agent
 * seats an arrival on the clock once and leaves it; the keeper folds). What
 * is measured is the house's own promise, not the models':
 *   - the context handed to the storyteller stays FLAT from turn 30 to 90
 *   - the clock advances every turn and jumps on #time skip
 *   - an arrival counts down on the clock, comes due, walks in, is seated,
 *     and leaves the elsewhere ledger — with no hand on it
 *   - the record folds and the verbatim window never exceeds the keeper's
 *   - the voices ride under the page and rotate
 *   - #q, #time skip, #Put TWB, #story reach the storyteller as their law
 *   - zero errors across the whole play
 * Run it: node tests/dom/longplay.mjs   (after: cd tests/dom && npm install)
 */
import { boot, until, type, submit, q, qa, tick } from './env.mjs';
import { test, assert, eq, runAll } from '../harness/lib.mjs';

const env = await boot();
const { document, db, house, errors } = env;
const { queuedCount } = await import('../../js/agents/queue.js');

const TURNS = 90;
const STEP = 20; /* minutes the storyteller lets pass per page */
const DAY = 24 * 60;

/* ---------- the scripted world ---------- */
const script = { turn: 0, auroraSeated: false, auroraArrived: false, windows: 0, previews: 0, skips: 0, lastHour: null, voicesSeen: [] };
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const base = Date.UTC(2025, 2, 14, 14, 0); /* Friday, March 14, 2025 14:00 */
function headerAt(minutesFromBase) {
  const d = new Date(base + minutesFromBase * 60000);
  const hh = String(d.getUTCHours()).padStart(2, '0'); const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `[The house on Elm — ${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} | ${hh}:${mm} | 🌤 clear, mild | gray hoodie, jeans | at the kitchen table]`;
}
/* the ledger's hour as the storyteller is handed it: "The hour: Friday, March 14, 2025 — 14:20." */
function ledgerMinutes(stateText) {
  const m = stateText.match(/The hour: [A-Za-z]+, ([A-Za-z]+) (\d+), (\d+) — (\d+):(\d+)\./);
  if (!m) return null;
  const d = Date.UTC(Number(m[3]), MONTHS.indexOf(m[1]), Number(m[2]), Number(m[4]), Number(m[5]));
  return Math.round((d - base) / 60000);
}
let scriptMinutes = 0;

house.state.storyAnswer = (body) => {
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const stateMsg = [...msgs].reverse().find((m) => m.role === 'user' && /\[story-state\]/.test(String(m.content)));
  const stateText = stateMsg ? String(stateMsg.content) : '';
  const tail = msgs.slice(-3).map((m) => String(m.content)).join('\n');
  const fromLedger = ledgerMinutes(stateText);
  if (fromLedger !== null) script.lastHour = fromLedger;
  let advance = STEP;
  let extra = '';
  if (/#time skip — /.test(tail)) { advance = 3 * DAY; script.skips += 1; extra = 'Three days pass in a blur of unpacking and phone calls. '; }
  if (/#q — the next scene/.test(tail)) { script.previews += 1; extra += 'PREVIEW — later today, at the corner store, Kim is arguing with the owner about a debt; it matters because the owner knows Jovan is back. '; advance = 90; }
  /* a good storyteller reads the hour it was handed and lets time pass from THERE */
  scriptMinutes = (fromLedger !== null ? fromLedger : scriptMinutes) + advance;
  const header = headerAt(scriptMinutes);
  const lines = [header, ''];
  if (extra) lines.push(extra);
  const due = /Aurora[^\n]*(due now|overdue)/.test(stateText);
  if (due && !script.auroraArrived) {
    script.auroraArrived = true;
    lines.push('The door opens without a knock. Aurora steps in, coat still on, rain in her hair. "You came back," she says, and does not sit.');
  } else if (/Aurora[^\n]*arriving in about/.test(stateText)) {
    lines.push('Jovan turns the cup in his hands. Nobody has come up the walk yet; the street outside is quiet. Kim texts twice and he does not answer.');
  } else {
    lines.push(`Person${script.turn} entered the room and sat down. ~t~*He looks tired.*~/t~ The kettle clicks off. *tk-tk* "Tea?" Person${script.turn} asks, and pours without waiting.`);
  }
  if (/A window into the world beyond is open this turn/.test(stateText) || /#Put TWB — /.test(tail)) {
    script.windows += 1;
    lines.push('', '*** The World Beyond ***', '[Kim’s flat — Friday, evening]', 'Kim reads the text again and puts the phone face down. She decides she will go over there tomorrow, and not before.');
  }
  return lines.join('\n');
};

const SPEAKERS = ['the fishwife', 'a clerk', 'Old Mattis', 'two students', 'the bus driver', 'a night nurse'];
house.state.workerAnswer = (body, sys) => {
  const user = String((body.messages || []).slice(-1)[0] && (body.messages || []).slice(-1)[0].content || '');
  if (/found the ledger/i.test(sys)) {
    return JSON.stringify({ mutations: [
      { type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'The house on Elm' },
      { type: 'clock.set', year: 2025, month: 3, day: 14, hour: 14, minute: 0 },
      { type: 'presence.enter', name: 'Jovan', position: 'at the kitchen table' },
    ] });
  }
  if (/keep the ledger/i.test(sys)) {
    /* the extractor reads the page's header for the hour, and seats whoever the page shows arriving */
    const h = user.match(/\[The house on Elm — [A-Za-z]+, ([A-Za-z]+) (\d+), (\d+) \| (\d+):(\d+) \|/);
    const muts = [];
    if (h) muts.push({ type: 'clock.set', year: Number(h[3]), month: MONTHS.indexOf(h[1]) + 1, day: Number(h[2]), hour: Number(h[4]), minute: Number(h[5]) });
    if (/Aurora steps in/.test(user)) muts.push({ type: 'presence.enter', name: 'Aurora', position: 'just inside the door', attire: 'a wet coat' });
    const p = user.match(/(Person\d+) entered the room/);
    if (p) muts.push({ type: 'presence.enter', name: p[1] });
    muts.push({ type: 'mode.snapshot', flags: script.turn % 2 ? ['group'] : ['socialField'] });
    return JSON.stringify({ mutations: muts });
  }
  if (/world beyond the page/i.test(sys)) {
    const muts = [];
    const present = /Here now:[^\n]*Aurora/.test(user);
    if (script.turn === 3 && !present) {
      script.auroraSeated = true;
      muts.push({ type: 'offscreen.set', name: 'Aurora', location: 'the 4:10 bus from the station', activity: 'watching the road', agenda: 'see him before Kim does', stance: 'toward', etaMinutes: 55 });
      muts.push({ type: 'thread.set', title: 'Aurora and the return', owner: 'Aurora', heat: 'hot', next: 'walk up to the house and knock' });
    }
    if (script.turn === 8) muts.push({ type: 'faction.set', name: 'the corner store', stance: 'watchful', agenda: 'collect what Kim owes', move: 'the owner noted the car in the drive' });
    const i = script.turn % SPEAKERS.length;
    const voices = [
      { icon: '🏪', speaker: SPEAKERS[i], channel: 'Elm Street · ' + (script.turn % 2 ? 'dusk' : 'afternoon'), content: 'Line ' + script.turn + ': the Ristic boy is back, they say.' },
      { icon: '💬', speaker: '-> ' + SPEAKERS[(i + 1) % SPEAKERS.length], content: 'Back for the funeral or the money?' },
    ];
    const twb = script.turn % 20 === 10 ? { who: 'Kim', where: 'her flat', changed: 'she read the text and decided to wait until tomorrow (turn ' + script.turn + ')' } : null;
    const pressure = script.auroraSeated && !script.auroraArrived ? ['Aurora is on the bus and could reach the house within the hour'] : [];
    return JSON.stringify({ mutations: muts, brief: { pressure, ripe: [], twb, voices } });
  }
  if (/narrative-state tracker/i.test(sys)) return 'Fold at turn ' + script.turn + ': Jovan at the kitchen table; visitors came and sat; tea poured; Kim texting; the street quiet.';
  if (/audit one record line/i.test(sys)) return 'NONE';
  if (/character pages/i.test(sys)) return '{"deltas":[]}';
  if (/continuity reader/i.test(sys)) return '{"findings":[]}';
  if (/auditor of the ledger/i.test(sys)) return '{"issues":[]}';
  if (/reading a story's past/i.test(sys)) return '{"deltas":[],"shifts":[]}';
  return '{"mutations":[],"deltas":[],"findings":[],"check":false}';
};

const assistantPages = () => qa('.msg-assistant');
const storyId = async () => db.settings.get('activeStoryId');
const idle = async (sid) => { await until(() => !env.ctx.chat.isBusy() && !env.ctx.chat.isReplaying() && queuedCount(sid) === 0 && !q('.msg-pending'), 'the house and its workers idle', 30000); await tick(60); };

async function play(text) {
  const n = assistantPages().length;
  await until(() => !env.ctx.chat.isBusy() && !q('.msg-pending'), 'the house free', 30000);
  type(q('#composer-input'), text); submit(q('#composer'));
  await until(() => assistantPages().length > n, 'a page (turn ' + script.turn + ')', 30000);
  script.turn += 1;
  await idle(await storyId());
}

const receipts = [];
let sid = null;

test('LONG-1 ninety turns of play: the house holds the world with no hand on it', async () => {
  await db.connections.add({ name: 'mock', type: 'openai', baseUrl: 'https://mock.example/v1', apiKey: 'k', model: 'm', maxTokens: 800 });
  const t0 = Date.now();
  await play('#story Jovan comes home to Elm Street after a year abroad; his sister Kim and the neighbour Aurora are there.');
  sid = await storyId();
  const opened = await db.stories.get(sid);
  assert(opened && /^Jovan comes home/.test(opened.title), '#story opened the tale from its concept: ' + opened.title);
  const moves = ['I sit with the tea.', 'I look at the window.', 'I stay where I am.', 'I turn the cup.', 'I say nothing.', 'I wait.'];
  for (let t = 1; t < TURNS; t += 1) {
    let text = moves[t % moves.length];
    if (t === 15) text = '#q';
    if (t === 30) text = '#time skip 3 days';
    if (t === 45) text = '#Put TWB Kim';
    await play(text);
    const pages = await db.messages.list(sid);
    const last = [...pages].reverse().find((m) => m.role === 'assistant');
    receipts.push({ turn: t, total: last && last.receipt ? last.receipt.totalTokens : null, slots: last && last.receipt ? last.receipt.slots : [], voices: last && last.voices ? last.voices.length : 0 });
    if (t === 6 && !script.auroraArrived) {
      /* she is on the clock: the storyteller was told she is arriving */
      const st = await db.settings.get('state:' + sid);
      assert(st.offscreen.Aurora && Number.isFinite(st.offscreen.Aurora.arrivesAtMinutes), 'Aurora sits on the clock');
    }
  }
  console.log('    ninety turns in ' + Math.round((Date.now() - t0) / 1000) + 's');
  /* the assembled requests, kept for a human read (never shipped): the #q turn and the last turn */
  try {
    const { writeFileSync } = await import('node:fs');
    const story = house.state.calls.filter((c) => !c.isWorker);
    const dump = (c) => (c.body.messages || []).map((m) => '=== ' + m.role.toUpperCase() + ' ===\n' + String(m.content)).join('\n\n');
    writeFileSync('/tmp/prompt-q.txt', dump(story[15]));
    writeFileSync('/tmp/prompt-last.txt', dump(story[story.length - 1]));
    const worldCalls = house.state.calls.filter((c) => c.isWorker && /world beyond the page/.test(JSON.stringify(c.body.messages[0])));
    writeFileSync('/tmp/prompt-world.txt', dump(worldCalls[worldCalls.length - 1]));
  } catch (err) { console.log('    (no dump: ' + err.message + ')'); }
  eq(errors.length, 0, errors.slice(0, 5).join(' | '));
});

test('LONG-2 the clock advanced every page from the hour the storyteller was handed, and jumped three days on #time skip', async () => {
  const st = await db.settings.get('state:' + sid);
  assert(st.clock && Number.isFinite(st.clock.minutes), 'the clock is set');
  const pages = (await db.messages.list(sid)).filter((m) => m.role === 'assistant');
  const hours = pages.map((m) => (m.text.match(/\| (\d+):(\d+) \|/) || []).slice(1).map(Number)).filter((a) => a.length === 2);
  eq(hours.length, pages.length, 'every page carries the header with its hour');
  /* the skip: page 30's date is three days past page 29's */
  const date = (m) => { const d = m.text.match(/([A-Za-z]+) (\d+), (\d+) \|/); return d ? Date.UTC(Number(d[3]), MONTHS.indexOf(d[1]), Number(d[2])) : null; };
  const before = date(pages[29]); const after = date(pages[30]);
  assert(after - before >= 3 * DAY * 60000, 'three days passed on the page: ' + pages[30].text.slice(0, 80));
  eq(script.skips, 1, 'the storyteller was handed the skip once');
  /* the round trip: the ledger's hour is the LAST page's header hour — the extractor read it */
  const lastHdr = pages[pages.length - 1].text.match(/([A-Za-z]+) (\d+), (\d+) \| (\d+):(\d+) \|/);
  const { renderClock } = await import('../../js/engine/clock.js');
  const spoken = renderClock(st.clock);
  assert(spoken.includes(lastHdr[1] + ' ' + lastHdr[2] + ', ' + lastHdr[3]) && spoken.includes(lastHdr[4] + ':' + lastHdr[5]), 'the ledger reads the last header: ' + spoken + ' vs ' + lastHdr[0]);
  /* and total time: ~89 pages of 20 minutes, one of 90, one of three days */
  const expectMin = 88 * STEP + 90 + 3 * DAY;
  assert(Math.abs(st.clock.minutes - (Math.round((base - Date.UTC(1970, 0, 1)) / 60000) + expectMin)) <= STEP, 'the clock kept every minute: ' + st.clock.minutes);
});

test('LONG-3 the arrival: seated once on the clock by the world agent, counted down, came due, walked in, was seated present and unseated from elsewhere — no hand on it', async () => {
  assert(script.auroraSeated, 'the world agent seated Aurora on the clock at turn 3');
  assert(script.auroraArrived, 'the storyteller saw her come due and wrote her in');
  const st = await db.settings.get('state:' + sid);
  assert(st.present.some((p) => p.name === 'Aurora'), 'Aurora is present in the ledger');
  assert(!st.offscreen.Aurora, 'her elsewhere seat was cleared when she walked in');
  const pages = (await db.messages.list(sid)).filter((m) => m.role === 'assistant');
  const arrivedAt = pages.findIndex((m) => /Aurora steps in/.test(m.text));
  assert(arrivedAt >= 5 && arrivedAt <= 8, 'she walked in when the clock said, not before: page ' + arrivedAt);
  /* the pages before her arrival were told she was coming, and did not write her early */
  const early = pages.slice(3, arrivedAt).filter((m) => /Nobody has come up the walk yet/.test(m.text));
  assert(early.length >= 1, 'the storyteller was handed the arrival on the clock before it came due');
  assert(!pages.slice(0, arrivedAt).some((m) => /Aurora steps in/.test(m.text)), 'never early');
});

test('LONG-4 the context handed to the storyteller stays flat: turns 60-89 cost no more than turns 25-45; the window never exceeds the keeper’s; the record exists', async () => {
  const total = (r) => r.total;
  const a = receipts.filter((r) => r.turn >= 25 && r.turn <= 45).map(total);
  const b = receipts.filter((r) => r.turn >= 60).map(total);
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  assert(a.length && b.length && a.every(Number.isFinite) && b.every(Number.isFinite), 'receipts on every page');
  const ma = mean(a); const mb = mean(b); const maxB = Math.max(...b);
  console.log('    tokens per turn — turns 25-45 mean ' + Math.round(ma) + ', turns 60-89 mean ' + Math.round(mb) + ', max ' + maxB);
  assert(mb <= ma * 1.15, 'flat: late turns cost no more than ' + Math.round(ma * 1.15) + ', got ' + Math.round(mb));
  assert(maxB <= ma * 1.25, 'no late turn balloons: ' + maxB);
  const win = receipts[receipts.length - 1].slots.find((s) => s.name === 'The story so far');
  const n = win && win.source ? Number((win.source.match(/the last (\d+) of/) || win.source.match(/(\d+) pages?/) || [])[1]) : NaN;
  assert(Number.isFinite(n) && n <= 30, 'the verbatim window is the keeper’s (≤30): ' + (win && win.source));
  const mem = await db.settings.get('memory:' + sid);
  assert(mem && Array.isArray(mem.nodes) && mem.nodes.length >= 3, 'the record folded the older pages: ' + (mem && mem.nodes && mem.nodes.length));
  const remains = receipts[receipts.length - 1].slots.find((s) => s.name === 'What remains');
  assert(remains && remains.tokens > 0, 'the record rides to the storyteller');
});

test('LONG-5 the voices ride under the page, rotate, and never reach the wire; the window is written when the world opens one and on #Put TWB', async () => {
  const withVoices = receipts.filter((r) => r.voices > 0).length;
  assert(withVoices >= TURNS - 5, 'nearly every page carries voices: ' + withVoices);
  const pages = (await db.messages.list(sid)).filter((m) => m.role === 'assistant' && Array.isArray(m.voices) && m.voices.length);
  const speakers = new Set(pages.slice(-6).map((m) => m.voices[0].speaker));
  assert(speakers.size >= 5, 'the speakers rotate: ' + [...speakers].join(', '));
  const folds = qa('.msg-voices');
  assert(folds.length >= 20, 'the voices are drawn under the pages: ' + folds.length);
  assert(!house.state.calls.some((c) => !c.isWorker && /\[VOICE:/.test(JSON.stringify(c.body))), 'no voice ever reached the storyteller');
  eq(script.windows, 5, 'four windows opened by the world (turns 10, 30, 50, 70) plus the #Put TWB one');
  const all = (await db.messages.list(sid)).filter((m) => m.role === 'assistant');
  assert(all.filter((m) => /\*\*\* The World Beyond \*\*\*/.test(m.text)).length === 5, 'the windows are on the pages in the exact form');
  /* the window rule rode the turn the world opened one (seeded after page 9's workers; open for page 10's request) */
  const turn10 = receipts.find((r) => r.turn === 10);
  const active = turn10.slots.find((s) => s.name === 'Active modules');
  assert(active && /window beyond the page/i.test(active.reason), 'the window rule woke: ' + (active && active.reason));
  const turn12 = receipts.find((r) => r.turn === 12).slots.find((s) => s.name === 'Active modules');
  assert(!turn12 || !/window beyond the page/i.test(turn12.reason), 'and stood down once the window closed');
  eq(script.previews, 1, '#q reached the storyteller as the director’s law');
  const q15 = receipts.find((r) => r.turn === 15).slots.find((s) => s.name === 'The house heard');
  assert(q15 && q15.tokens > 100, '#q’s whole law rode the tail on its turn only: ' + (q15 && q15.tokens));
  const q16 = receipts.find((r) => r.turn === 16).slots.find((s) => s.name === 'The house heard');
  assert(!q16 || q16.tokens === 0, 'and not the turn after');
});

test('LONG-6 the intimate rule wakes on the writer’s own words a beat before the flag, and stands down after', async () => {
  await play('I pull her onto the bed and undress her.');
  const pages = await db.messages.list(sid);
  const last = [...pages].reverse().find((m) => m.role === 'assistant');
  const active = last.receipt.slots.find((s) => s.name === 'Active modules');
  assert(active && /turns intimate/.test(active.reason) && /writer/.test(active.reason), 'woken by the words: ' + (active && active.reason));
  await play('I look at the window.');
  const pages2 = await db.messages.list(sid);
  const last2 = [...pages2].reverse().find((m) => m.role === 'assistant');
  const active2 = last2.receipt.slots.find((s) => s.name === 'Active modules');
  assert(!active2 || !/turns intimate/.test(active2.reason), 'a quiet turn carries no rendering law (the mock extractor never lit the flag)');
  eq(errors.length, 0, errors.slice(0, 5).join(' | '));
});

await runAll();
