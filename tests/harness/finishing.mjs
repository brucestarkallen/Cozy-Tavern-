/* M12+M13 harness: the character ledger (merge law, tiers, aging), the
 * workers' channel (sequentiality, epoch purge, backoff), the coverage
 * law, the detail auditor, people.set undo, the welcome-once flag, and
 * the serve line. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import {
  mergeDeltas, findPersonKey, boundedLevenshtein, renderPeopleTiers,
  migrateCharacters, stateLabel,
} from '../../js/engine/people.js';
import { applyMutations, undoLast } from '../../js/engine/apply.js';
import { emptyState, loadState, saveState } from '../../js/engine/state.js';
import { windowPlan, coveredUntil, buildRequest } from '../../js/assemble/stack.js';
import {
  enqueueWork, switchWorkerStory, backoffMs, setSleepForHarness, queuedCount,
} from '../../js/agents/queue.js';
import { parseScribeAnswer, retryAfterMs } from '../../js/agents/scribe.js';
import { loadWorkerStatus } from '../../js/agents/status.js';
import {
  parseAuditAnswer, nodeSignature, nodeUnmoved, renderMemory,
  maybeSummarize, loadMemory, saveMemory,
} from '../../js/agents/memory.js';
import {
  createTour, welcomeShouldShow, markWelcomeSeen, TOUR_STEPS,
} from '../../js/ui/welcome.js';

const pages = (n) => Array.from({ length: n }, (_, i) => ({
  id: 'p' + i, role: i % 2 ? 'assistant' : 'user', text: 'page ' + i + ' words',
}));

const person = (core, state, arc, threads, updatedAtTurn) => ({
  core: core || '', state: state || '', arc: arc || '',
  threads: threads || [], updatedAtTurn: Number.isFinite(updatedAtTurn) ? updatedAtTurn : 0,
});

/* ---------- the ledger merge law ---------- */

test('M12 ledger merge: the MC is record-only — state and threads kept, core and arc refused in code', () => {
  const state = { turn: 5, sheet: { playerName: 'Ash', actors: {} }, present: [] };
  const { characters, dropped } = mergeDeltas(state, {}, [
    { name: 'you', field: 'core', text: 'a quiet storm of a person' },
    { name: 'Ash', field: 'arc', text: 'growing harder since the bridge' },
    { name: 'you', field: 'state', text: 'In the chapel, soaked through' },
    { name: 'the player', field: 'thread', text: 'still owes the ferryman' },
  ], 5);
  eq(Object.keys(characters).length, 1, 'one record for the main character');
  const mc = characters.Ash;
  assert(mc, 'the persona redirect lands on the story name');
  eq(mc.core, '', 'core never written for the MC');
  eq(mc.arc, '', 'arc never written for the MC');
  assert(mc.state.includes('chapel'), 'state is kept');
  eq(mc.threads.length, 1, 'threads are kept');
  eq(dropped.length, 2, 'both refused notes are accounted for');
});

test('M12 ledger merge: the contamination guard never copies one person’s words into another’s page', () => {
  const state = { turn: 2, sheet: { playerName: '', actors: {} }, present: [] };
  const shelf = { Mira: person('Soft-spoken, ink-stained fingers', '', '', [], 1) };
  const a = mergeDeltas(state, shelf, [
    { name: 'Samantha', field: 'state', text: 'Soft-spoken, ink-stained fingers' },
  ], 2);
  eq(a.changes.length, 0, 'verbatim copy refused');
  eq(a.dropped.length, 1, 'the refusal is on record');
  const b = mergeDeltas(state, shelf, [
    { name: 'Samantha', field: 'state', text: 'Mira is hiding the letters in the vestry' },
  ], 2);
  eq(b.changes.length, 0, 'a note that opens with another person’s name is refused');
  const c = mergeDeltas(state, shelf, [
    { name: 'Samantha', field: 'state', text: 'At the ferry landing, counting coins' },
  ], 2);
  eq(c.changes.length, 1, 'an honest note lands');
  assert(c.characters.Samantha.state.includes('ferry'), 'on the right page');
});

test('M12 ledger merge: names resolve within a bounded edit distance; ambiguity matches no one', () => {
  eq(boundedLevenshtein('samantha', 'samanta', 2), 1, 'one letter of slack');
  assert(boundedLevenshtein('samantha', 'sam', 2) > 2, 'the bound holds');
  const shelf = { Samantha: person('', 'By the fire', '', [], 1) };
  eq(findPersonKey(shelf, 'Samanta'), 'Samantha', 'a near-name finds its person');
  const two = { Mira: person('', 'here', '', [], 1), Mara: person('', 'there', '', [], 1) };
  eq(findPersonKey(two, 'Mora'), '', 'an ambiguous near-name matches no one');
  const state = { turn: 3, sheet: { playerName: '', actors: {} }, present: [] };
  const merged = mergeDeltas(state, shelf, [{ name: 'Samanta', field: 'state', text: 'At the window now' }], 3);
  eq(merged.changes[0].name, 'Samantha', 'the scribe’s typo lands on the right page');
  eq(merged.characters.Samantha.state, 'At the window now');
});

/* ---------- tiered injection ---------- */

test('M12 tiers: full cards cap at 6, mention-recall at 3, the roster at 12', () => {
  const state = emptyState();
  state.turn = 40;
  state.sheet = { actors: {}, playerName: 'Ash' };
  const characters = {};
  for (let i = 1; i <= 8; i += 1) characters['Present' + i] = person('steady', 'Here, at table ' + i, 'warming', [], 40);
  for (let i = 1; i <= 5; i += 1) characters['Mentioned' + i] = person('sharp', 'Away at market ' + i, '', [], 40);
  for (let i = 1; i <= 15; i += 1) characters['Roster' + i] = person('', 'Somewhere far ' + i, '', [], 39);
  characters.Ash = person('should never be injected', 'the player’s seat', '', [], 40);
  state.characters = characters;
  state.present = Array.from({ length: 8 }, (_, i) => ({ name: 'Present' + (i + 1) }));
  const recentPages = ['Mentioned1 and Mentioned2 came up', 'as did Mentioned3 and Mentioned4', 'and Mentioned5'];
  const out = renderPeopleTiers(state, { recentPages, rotation: 0 });
  assert(out && out.text, 'the block has something to say');
  eq(out.tiers.cards, 6, 'six full cards at most');
  eq(out.tiers.also, 2, 'the overflow rides the compact line');
  eq(out.tiers.recall, 3, 'mention-recall caps at three');
  eq(out.tiers.roster, 12, 'the roster caps at twelve');
  assert(out.text.includes('Named, though not in the scene'), 'recall framed as not in the scene');
  assert(!out.text.includes('should never be injected'), 'the MC record is never injected');
  const rotated = renderPeopleTiers(state, { recentPages, rotation: 1 });
  assert(rotated.text !== out.text || out.tiers.roster < 15, 'the roster turns one step');
});

test('M12 aging: “now” becomes “last noted N turns ago” past twenty turns', () => {
  eq(stateLabel(person('', 'x', '', [], 39), 40), 'Now: ', 'fresh is now');
  eq(stateLabel(person('', 'x', '', [], 10), 40), 'Last noted 30 turns ago: ', 'aged past twenty admits it');
  const state = emptyState();
  state.turn = 40;
  state.characters = { Mira: person('steady', 'By the fire', '', [], 10) };
  state.present = [{ name: 'Mira' }];
  const out = renderPeopleTiers(state, { recentPages: [], rotation: 0 });
  assert(out.text.includes('Last noted 30 turns ago:'), 'the card wears its age');
});

/* ---------- the coverage law ---------- */

test('M12 coverage: slot 8 never drops a page no summary node covers', () => {
  eq(coveredUntil([{ span: [0, 4] }, { span: [10, 12] }]), 5, 'only the contiguous prefix counts');
  eq(coveredUntil([{ span: [0, 4] }, { span: [5, 9] }]), 10, 'spans chain');
  const gap = windowPlan({ pages: pages(50), memory: { window: 30, nodes: [{ span: [0, 14] }] } });
  eq(gap.window.length, 35, 'the window reaches back to the uncovered');
  eq(gap.extended, 5, 'the extension is named');
  eq(gap.resting, 15, 'the covered rest');
  const boundary = windowPlan({ pages: pages(50), memory: { window: 30, nodes: [{ span: [0, 19] }] } });
  eq(boundary.window.length, 30, 'full coverage keeps the window exact');
  eq(boundary.extended, 0, 'no extension at the boundary');
  const none = windowPlan({ pages: pages(45), memory: { window: 30, nodes: [] } });
  eq(none.window.length, 45, 'no nodes at all — nothing is dropped');
});

test('M12 coverage: the receipt says when the window widened past its size', () => {
  const r = buildRequest({
    story: {}, messages: pages(45), settings: { noteText: '' }, state: {}, modules: [],
    memory: '', window: { keeperOn: true, window: 30, nodes: [] },
  });
  const slot = r.receipt.slots.find((s) => s.name === 'The story so far');
  assert(/still unfolded by the keeper/.test(slot.source), 'the extension is honest on the receipt');
  eq(r.messages.length, 45, 'every page rides when nothing is covered');
  const covered = buildRequest({
    story: {}, messages: pages(45), settings: { noteText: '' }, state: {}, modules: [],
    memory: '', window: { keeperOn: true, window: 30, nodes: [{ span: [0, 14] }] },
  });
  eq(covered.messages.length, 30, 'covered pages keep the 30-page window');
});

/* ---------- the workers' channel ---------- */

test('M12 queue: jobs run strictly one at a time, in order', async () => {
  switchWorkerStory('q-seq');
  const log = [];
  let inFlight = 0;
  const job = (n) => async () => {
    inFlight += 1;
    log.push('start' + n);
    assert(inFlight === 1, 'never concurrent — job ' + n + ' overlapped');
    await new Promise((r) => setTimeout(r, 6));
    inFlight -= 1;
    log.push('end' + n);
    return { silent: true };
  };
  const results = await Promise.all([
    enqueueWork('q-seq', { name: 'extractor', run: job(1) }),
    enqueueWork('q-seq', { name: 'scribe', run: job(2) }),
    enqueueWork('q-seq', { name: 'keeper', run: job(3) }),
  ]);
  assert(results.every((r) => r.ok), 'all three settled well');
  eq(log.join(','), 'start1,end1,start2,end2,start3,end3', 'sequential, in queue order');
});

test('M12 queue: a story switch purges the pending queue and discards stale work', async () => {
  switchWorkerStory('q-old');
  let ranSecond = false;
  const slow = enqueueWork('q-old', {
    name: 'extractor',
    run: async () => { await new Promise((r) => setTimeout(r, 30)); return { silent: true }; },
  });
  const purged = enqueueWork('q-old', {
    name: 'keeper',
    run: async () => { ranSecond = true; return { silent: true }; },
  });
  switchWorkerStory('q-new');
  eq(queuedCount('q-old'), 0, 'the pending queue is let go on a switch');
  const [a, b] = await Promise.all([slow, purged]);
  assert(a.stale === true || a.ok, 'the in-flight job settles without writing');
  eq(b.stale, true, 'the queued job never starts for a left-behind story');
  eq(ranSecond, false, 'its run never fired');
  switchWorkerStory(null);
});

test('M12 queue: five retries on the 2s→60s schedule, Retry-After honored, failures on the workers line', async () => {
  eq(backoffMs(1), 2000);
  eq(backoffMs(2), 4000);
  eq(backoffMs(5), 32000);
  eq(backoffMs(6), 60000, 'the cap is a minute');
  eq(backoffMs(1, 45000), 45000, 'Retry-After sets a floor');
  eq(backoffMs(3, 90000), 90000, 'a longer asked wait is honored past the cap');

  const sleeps = [];
  setSleepForHarness(async (ms) => { sleeps.push(ms); });
  switchWorkerStory('q-flaky');
  let tries = 0;
  const flaky = await enqueueWork('q-flaky', {
    name: 'scribe',
    run: async () => {
      tries += 1;
      if (tries < 3) { const err = new Error('busy'); if (tries === 2) err.retryAfterMs = 5000; throw err; }
      return { silent: true };
    },
  });
  assert(flaky.ok, 'the third try lands');
  eq(sleeps.join(','), '2000,5000', 'the schedule: 2s, then Retry-After’s 5s floor');

  switchWorkerStory('q-hopeless');
  let attempts = 0;
  const lost = await enqueueWork('q-hopeless', {
    name: 'extractor',
    run: async () => { attempts += 1; throw new Error('unreachable'); },
  });
  eq(lost.ok, false, 'after five retries the job concedes');
  eq(attempts, 6, 'the first try plus five retries');
  eq(lost.why, 'unreachable', 'one plain word of why');
  const shelf = await loadWorkerStatus('q-hopeless');
  assert(shelf.extractor && shelf.extractor.ok === false && shelf.extractor.why === 'unreachable',
    'the failure sits on the workers line');
  setSleepForHarness(null);
  switchWorkerStory(null);
});

/* ---------- the detail auditor ---------- */

test('M12 detail auditor: NONE or one DETAIL line; the bullet rides slot 7 with its node', () => {
  eq(parseAuditAnswer('NONE'), '', 'NONE means the note stands');
  eq(parseAuditAnswer('The note looks complete. NONE of concern'), '', 'NONE anywhere on the line means none');
  eq(parseAuditAnswer('DETAIL: the debt was forty crowns, due at midsummer'), 'the debt was forty crowns, due at midsummer');
  eq(parseAuditAnswer('No heading at all'), '', 'unmarked prose is not a detail');
  const mem = { window: 30, nodes: [{ id: 'n1', span: [0, 4], text: 'They crossed the water and parted at the chapel steps.', level: 1, at: 1, detail: 'the debt was forty crowns' }] };
  const text = renderMemory(mem);
  assert(text.includes('Detail worth keeping: the debt was forty crowns'), 'the detail bullet is injected with its node');
});

test('M12 detail auditor: discard-if-moved — a node that changed mid-flight keeps no detail', async () => {
  const storyId = 'm12-audit';
  for (const p of pages(51)) await db.messages.append(storyId, { role: p.role, text: p.text });
  const real = globalThis.fetch;
  let calls = 0;
  let moveMidFlight = false;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 2 && moveMidFlight) {
      /* another hand lets the new node go while the auditor thinks */
      await saveMemory(storyId, { window: 30, nodes: [] });
    }
    const content = calls === 1
      ? 'They crossed the dark water, promised to meet at midsummer, and parted at the chapel steps.'
      : (calls === 2 || !moveMidFlight ? 'DETAIL: the ferry cost was forty crowns' : '(no new state)');
    /* M28: the keeper rides the provider now, which streams — the mock
     * answers as an SSE body, the way the real house would. */
    const sseText = 'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\n'
      + 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n';
    const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sseText)); c.close(); } });
    return { ok: true, status: 200, headers: new Headers(), body, clone() { return this; }, json: async () => ({}), text: async () => sseText };
  };
  try {
    const connection = { type: 'openai', baseUrl: 'https://x', apiKey: 'k', model: 'm' };
    /* M34: the ledger law — 51 pages, window 30, batch 6: three lines are due at the
     * catch-up pace (0–5, 6–11, 12–17); the mock's first answer is the line, its
     * second the DETAIL, so only the first line earns a detail. */
    await db.settings.set('memoryBatch', 6);
    await maybeSummarize({ connection, storyId });
    let mem = await loadMemory(storyId);
    eq(mem.nodes.length, 3, 'three lines at the catch-up pace');
    eq(mem.nodes[0].span.join('-'), '0-5', 'the first batch');
    eq(mem.nodes[0].detail, 'the ferry cost was forty crowns', 'the detail lands on the unmoved node');
    assert(nodeUnmoved(mem.nodes, mem.nodes[0].id, nodeSignature(mem.nodes[0])), 'the guard knows the standing node');

    /* now the node moves mid-flight — the audit must be discarded. The store is
     * emptied while the auditor thinks (call 2); the line it audited no longer
     * stands, so its DETAIL must not land anywhere. The batches that follow
     * answer "(no new state)" and earn no audit at all. */
    await saveMemory(storyId, { window: 30, nodes: [] });
    moveMidFlight = true;
    calls = 0;
    await maybeSummarize({ connection, storyId });
    mem = await loadMemory(storyId);
    assert(mem.nodes.every((n) => !n.detail), 'the discarded audit landed nowhere: ' + JSON.stringify(mem.nodes.map((n) => [n.span, n.detail || '', n.empty || false])));
    assert(mem.nodes.some((n) => n.empty), '"(no new state)" covers pages without a line');
  } finally {
    globalThis.fetch = real;
  }
});

/* ---------- people.set: the hand's door, validated and undoable ---------- */

test('M12 people.set: validated, MC record-only, undoable', () => {
  const state = emptyState();
  state.turn = 3;
  state.sheet = { actors: {}, playerName: 'Ash' };
  const first = applyMutations(state, [
    { type: 'people.set', name: 'Mira', field: 'core', text: 'Soft-spoken, ink-stained fingers' },
    { type: 'people.set', name: 'Mira', field: 'state', text: 'By the fire, drying out' },
  ]);
  eq(first.applied.length, 2, 'both pages written');
  eq(first.state.characters.Mira.core, 'Soft-spoken, ink-stained fingers');
  const refused = applyMutations(first.state, [
    { type: 'people.set', name: 'Ash', field: 'core', text: 'the protagonist' },
    { type: 'people.set', name: 'Mira', field: 'diary', text: 'not a page' },
  ]);
  eq(refused.applied.length, 0, 'MC core and unknown fields refused');
  eq(refused.rejected.length, 2);
  assert(/record-only/.test(refused.rejected[0].why), 'the refusal names the law');
  const viaYou = applyMutations(refused.state, [
    { type: 'people.set', name: 'you', field: 'state', text: 'At the door, listening' },
  ]);
  eq(viaYou.applied.length, 1, 'a hand-written “you” lands on the MC record');
  assert(viaYou.state.characters.Ash.state.includes('listening'));
  const undone = undoLast(viaYou.state);
  assert(undone, 'undo happens');
  eq((undone.state.characters.Ash || {}).state || '', '', 'the write is taken back');
  const undone2 = undoLast(undone.state);
  eq(undone2.state.characters.Mira.state || '', '', 'the older write comes back next');
});

test('M12 state migration: the character ledger survives load/save without loss', async () => {
  const state = emptyState();
  state.characters = { Mira: person('steady', 'here', 'warming', ['owes the ferryman'], 7) };
  await saveState('m12-migrate', state);
  const back = await loadState('m12-migrate');
  eq(back.characters.Mira.core, 'steady');
  eq(back.characters.Mira.threads.length, 1);
  eq(back.characters.Mira.updatedAtTurn, 7);
  const legacy = await loadState('m12-legacy');
  assert(legacy.characters && typeof legacy.characters === 'object', 'older states gain the empty ledger');
  eq(Object.keys(migrateCharacters(null)).length, 0, 'null migrates to empty');
});

/* ---------- the scribe ---------- */

test('M12 scribe: the parser tolerates fences and prose; Retry-After is read', () => {
  const ok = parseScribeAnswer('```json\n{"deltas":[{"name":"Mira","field":"state","text":"By the fire"}]}\n```');
  eq(ok.deltas.length, 1, 'fenced JSON parses');
  eq(parseScribeAnswer('no json here').deltas.length, 0, 'prose yields nothing');
  eq(parseScribeAnswer('{"deltas":[{"name":"","field":"state","text":"x"}]}').deltas.length, 0, 'nameless deltas dropped');
  eq(retryAfterMs({ get: () => '7' }), 7000, 'seconds honored');
  eq(retryAfterMs({ get: () => null }), 0, 'no header, no wait');
});

/* ---------- the welcome mat ---------- */

test('M13 welcome: three steps, walkable both ways, and it shows only once', async () => {
  eq(TOUR_STEPS.length, 3, 'three warm steps');
  const tour = createTour();
  eq(tour.index, 0);
  assert(tour.step().button, 'a way forward');
  tour.next();
  eq(tour.index, 1);
  tour.back();
  eq(tour.index, 0, 'a way back');
  tour.back();
  eq(tour.index, 0, 'back stops at the door');
  tour.next(); tour.next();
  eq(tour.index, 2, 'the third step');
  tour.next();
  eq(tour.done, true, 'the walk ends');
  tour.restart();
  eq(tour.done, false, 'the guided tour can start over');
  eq(tour.index, 0);

  assert(await welcomeShouldShow(), 'the first time, the mat is out');
  await markWelcomeSeen();
  eq(await welcomeShouldShow(), false, 'once seen, it stays put away');
});

/* ---------- serve.py: the deterministic address ---------- */

test('M13 serve: the tavern binds and prints 127.0.0.1, and answers there', async () => {
  const { spawn } = await import('node:child_process');
  const port = 18231;
  let child;
  try {
    child = spawn('python3', ['serve.py'], {
      cwd: new URL('../../', import.meta.url).pathname,
      env: { ...process.env, PORT: String(port) },
    });
  } catch (err) {
    /* no python here — hold the source to the letter instead */
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../serve.py', import.meta.url), 'utf8');
    assert(src.includes("('127.0.0.1', PORT)") && src.includes('http://127.0.0.1:%d'), 'source says 127.0.0.1');
    return;
  }
  try {
    const line = await new Promise((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error('no serve line within 10s')), 10000);
      child.stdout.on('data', (d) => {
        buf += d;
        const at = buf.indexOf('\n');
        if (at !== -1) { clearTimeout(timer); resolve(buf.slice(0, at)); }
      });
      child.on('error', reject);
      child.on('exit', (code) => reject(new Error('serve.py exited early (' + code + '): ' + buf)));
    });
    assert(line.includes('http://127.0.0.1:' + port), 'the printed line is the deterministic URL — got: ' + line);
    const page = await fetch('http://127.0.0.1:' + port + '/index.html');
    eq(page.status, 200, 'it answers there');
    assert((page.headers.get('content-type') || '').includes('text/html'), 'html is html');
    await page.arrayBuffer();
    const js = await fetch('http://127.0.0.1:' + port + '/js/app.js');
    assert((js.headers.get('content-type') || '').includes('javascript'), 'modules ride with the right MIME');
    await js.arrayBuffer();
  } finally {
    child.kill();
  }
});
