/* Cozy Tavern — harness laws of M752: THE STORYTELLER'S REQUEST — ITS SIZE, ITS FIT, ITS RECEIPTS. After M714 measured the
 * whole request (three characters a token, every wrapper, the answer kept free) and M737 bound the record to its pages, the
 * window was planned in one measure and fitted in another, a changed page dragged the window back toward page 0 while its
 * lines still rode, a request that would have been answered was refused for an answer the connection never asked for, the
 * pages row lost the pages no line tells, the helpers' prompts were sized in a share of the context their own calls are
 * refused past, and every page's receipt carried every record line. Every law builds the real request, runs the real
 * helper, or reads the real receipt. (The refusal said in the thread and the recall beside the referee live in generate():
 * the walk holds them — DOM-M752-1, DOM-M752-2.) */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { buildRequest } from '../../js/assemble/stack.js';
import { CRAFT_TEXT } from '../../js/assemble/craft.js';
import { requestTokens, inputRoom, refusalRoom, ANSWER_RESERVE, ANSWER_FLOOR, CONTEXT_MARGIN } from '../../js/assemble/budget.js';
import { finalizeReceipt, selectionForSent } from '../../js/assemble/receipt.js';
import { sourceBindings } from '../../js/assemble/selection.js';
import { renderMemory, memoryForWindow, visiblePages, wholeRecord } from '../../js/agents/memory.js';
import { windowPlan } from '../../js/assemble/stack.js';
import { measureTransport } from '../../js/providers/measure.js';
import { createOpenAIProvider } from '../../js/providers/openai.js';
import { callWorker, workerConnection, workerRoom } from '../../js/agents/call.js';
import { maybeSeedSheet, SEED_MAX_TOKENS } from '../../js/agents/referee.js';
import { plannerAsk, plannerAskFitted, PLAN_MAX_TOKENS } from '../../js/agents/planner.js';
import { contextOf } from '../../js/providers/room.js';
import { emptyState, saveState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { db } from '../../js/store.js';

const craft = [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }];
const row = (r, name) => r.receipt.slots.find((s) => s.name === name);
const wireOf = (r) => [...r.systemBlocks.map((b) => b.text || ''), ...r.messages.map((m) => String(m.content))].join('\n');
const tale = (n, words = 'The rain kept falling on the old roofs. '.repeat(60)) => {
  const out = [];
  for (let i = 0; i < n; i += 1) { out.push({ id: 'u' + i, role: 'user', text: 'I do thing ' + i + '.' }); out.push({ id: 'a' + i, role: 'assistant', text: 'Page ' + i + ' prose. ' + words }); }
  out.push({ id: 'ux', role: 'user', text: 'I wait.' });
  return out;
};
/* a record bound to its pages, as the keeper writes it now: a line every ten pages, up to the thirty sent word for word */
const boundRecord = (msgs, every = 10) => {
  const vis = visiblePages(msgs); const nodes = [];
  for (let s = 0; s + every <= vis.length - 31; s += every) nodes.push({ id: 'n' + s, span: [s, s + every - 1], level: 1, at: s, text: 'LINE-' + s + ' things happened on pages ' + (s + 1) + '–' + (s + every) + '.', sourcePages: sourceBindings(vis.slice(s, s + every)) });
  return nodes;
};
/* the request as chat.js builds it: the record's cut taken from the window plan over every line (M162/M44) */
const sendLike = (msgs, nodes, conn, extra = {}) => {
  const vis = visiblePages(msgs);
  const recordThrough = windowPlan({ pages: vis, memory: { window: 30, nodes } }).resting;
  return buildRequest({ story: {}, messages: msgs, settings: {}, state: {}, modules: craft, memory: renderMemory(memoryForWindow({ nodes }, recordThrough), 400000),
    window: { keeperOn: true, window: 30, nodes, budgetTokens: contextOf(conn), answerTokens: measureTransport(conn, { systemBlocks: [], messages: [] }).answerTokens, recordThrough, recordCap: 400000 },
    transportMeasure: (req) => measureTransport(conn, req), ...extra });
};

test('M752-Q1 THE ANSWER FLOOR: with no Max tokens set nothing is asked for the answer — a request whose house words, latest exchange and move fit with ANSWER_FLOOR left is sent (by the house and by the provider adapter), its receipt saying the answer had less room; a Max tokens he set stays a hard limit', async () => {
  const moves = tale(3, 'Rukia watched the yard. '.repeat(20));
  const mk = (conn) => buildRequest({ story: {}, messages: moves, settings: {}, state: {}, modules: craft, memory: '', window: { keeperOn: true, window: 30, budgetTokens: contextOf(conn), answerTokens: measureTransport(conn, { systemBlocks: [], messages: [] }).answerTokens }, transportMeasure: (req) => measureTransport(conn, req) });
  const unset = { type: 'openai', model: 'local-32k', baseUrl: 'https://local.example', contextSize: 0 };
  /* a context the house words fit with the floor left, not with the reserve */
  const words = requestTokens(mk({ ...unset, contextSize: 1000000 }).systemBlocks, mk({ ...unset, contextSize: 1000000 }).messages);
  const ctx = words + ANSWER_FLOOR + CONTEXT_MARGIN + 1500;
  assert(ctx < words + ANSWER_RESERVE + CONTEXT_MARGIN, 'fixture: the reserve would not fit');
  const conn = { ...unset, contextSize: ctx };
  const r = mk(conn);
  eq(r.receipt.context.answerShort, true, 'sent, and the receipt says the answer had less room than usual');
  assert(r.receipt.context.answerRoom >= ANSWER_FLOOR && r.receipt.context.answerRoom < ANSWER_RESERVE, 'with the room it really had: ' + r.receipt.context.answerRoom);
  assert(r.messages.some((m) => m.content === 'I wait.') && r.messages.some((m) => /^Page 2 prose/.test(String(m.content))), 'his move and the latest page ride');
  /* the provider adapter refuses at the same line — it sends this very body */
  let sent = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { sent += 1; return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: 'A page.' } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n'); };
  try { await createOpenAIProvider({ ...conn, apiKey: 'k' }).streamChat({ systemBlocks: r.systemBlocks, messages: r.messages }); } finally { globalThis.fetch = realFetch; }
  eq(sent, 1, 'the provider sends what the house built');
  /* his own Max tokens is a limit: that answer must fit beside the request */
  let refused = '';
  try { mk({ ...conn, maxTokens: 8000 }); } catch (err) { refused = err.message; }
  assert(/exceed this connection’s context/.test(refused), 'a set Max tokens that does not fit is refused, in words: ' + refused);
  /* and the line itself: the floor only where nothing was asked for */
  eq(refusalRoom({ budgetTokens: 50000, answerTokens: 16000, answerEstimate: true }), 50000 - ANSWER_FLOOR - CONTEXT_MARGIN, 'no Max tokens: the floor');
  eq(refusalRoom({ budgetTokens: 50000, answerTokens: 16000, answerEstimate: false }), inputRoom({ budgetTokens: 50000, answerTokens: 16000 }), 'a Max tokens: the whole of it');
});

test('M752-Q2 THE PAGES ROW IS SAID AFTER THE FINAL FIT: when the fit takes pages out, the row counts them, and still names the older pages no line tells (M162) — from the first page carried, against the lines that ride', () => {
  const pages = [];
  for (let i = 0; i < 300; i += 1) pages.push({ id: 'm' + i, role: i % 2 ? 'assistant' : 'user', text: 'a page of prose. '.repeat(60) });
  const nodes = [{ id: 'n1', span: [0, 9], text: 'the early pages', level: 1 }];
  /* the provider's own measure reads more than the plan expected (a schema, a prefill): the fit takes pages out */
  const heavier = (req) => ({ inputTokens: requestTokens(req.systemBlocks, req.messages) + 2500, answerTokens: ANSWER_RESERVE, answerEstimate: true, estimate: 'test' });
  const r = buildRequest({ story: {}, messages: pages, settings: {}, state: {}, modules: [], memory: 'the record', window: { keeperOn: true, window: 30, nodes, budgetTokens: 20000 + ANSWER_RESERVE + CONTEXT_MARGIN }, transportMeasure: heavier });
  const removed = r.receipt.context.removedHistory;
  assert(removed > 0, 'fixture: the fit took pages out (' + removed + ')');
  const carried = r.messages.filter((m) => /^a page of prose/.test(String(m.content))).length;
  const first = r.messages.find((m) => /^a page of prose/.test(String(m.content)));
  const firstAt = pages.findIndex((p) => p.id === first.id);
  const src = row(r, 'The pages, word for word').source;
  assert(src.startsWith(carried + ' of 300 pages word for word — ' + removed + ' older pages taken out to fit the whole request and its answer'), 'carried and taken out, counted: ' + src);
  assert(src.includes((firstAt - 10) + ' older pages have no line yet and would not fit the room; the keeper fills those holes first'), 'the pages between the record and the first page carried are named (' + (firstAt - 10) + '): ' + src);
  assert(src.includes('the older 10 are in Our story so far'), 'and the ones a riding line tells: ' + src);
  assert(!/folded coverage|messages carried/.test(src), 'in plain words');
});

test('M752-Q3 A LINE WHOSE PAGES CHANGED IS WITHHELD AND COUNTED, AND THE WINDOW HOLDS: one old page edited under its line — the window stays the keeper’s thirty, no line rides beside its own pages (M44), the line held back is said under the heading and on its row; every line held back — none of the record’s text rides', () => {
  const msgs = tale(200);
  const nodes = boundRecord(msgs);
  const conn = { type: 'openai', model: 'x', baseUrl: 'https://api.example', contextSize: 200000 };
  const clean = sendLike(msgs, nodes, conn);
  const edited = msgs.map((m) => (m.id === 'a3' ? { ...m, text: m.text.replace('Page 3 prose.', 'Page 3 prose, edited.') } : m));
  const r = sendLike(edited, nodes, conn);
  eq(r.messages.length, clean.messages.length, 'the window is the one an untouched record gives (' + clean.messages.length + ' messages), not a reach back toward page 0');
  const vis = visiblePages(edited);
  const onWire = new Set(r.messages.map((m) => vis.findIndex((p) => p.id === m.id)).filter((i) => i >= 0));
  const wire = wireOf(r);
  const riding = nodes.filter((n) => wire.includes(n.text));
  assert(riding.length === nodes.length - 1 && !wire.includes(nodes[0].text), 'every line but the held one rides (' + riding.length + ' of ' + nodes.length + ')');
  assert(riding.every((n) => ![...onWire].some((i) => i >= n.span[0] && i <= n.span[1])), 'no line rides beside its own pages');
  assert(wire.includes('(1 older line is left out while it is written again — what happened in it still stands.)'), 'the held line is said under the heading');
  assert(!wire.includes('everything that came before the pages that follow'), 'and the part does not say "everything"');
  assert(/1 line left out while the keeper writes it again/.test(row(r, 'What remains').reason), 'its row says so: ' + row(r, 'What remains').reason);
  assert(row(r, 'The pages, word for word').source.includes('10 older pages have no line riding in this request: 10 under a line being written again'), 'and the pages row counts its pages: ' + row(r, 'The pages, word for word').source);
  /* every line's pages changed (a spelling put right across the tale before its lines were stamped again) */
  const respelled = msgs.map((m) => ({ ...m, text: m.text.replace('prose', 'prose.') }));
  const all = sendLike(respelled, nodes, conn);
  const allWire = wireOf(all);
  eq(nodes.filter((n) => allWire.includes(n.text)).length, 0, 'no line held back rides — not even as the record’s text');
  eq(all.messages.length, clean.messages.length, 'and the window still holds');
  assert(allWire.includes('(' + nodes.length + ' older lines are left out while they are written again — what happened in them still stands.)'), 'all of them said');
  const heldPages = nodes.length * 10;
  assert(row(all, 'The pages, word for word').source.includes(heldPages + ' older pages have no line riding in this request: ' + heldPages + ' under lines being written again'), 'and every page under them counted: ' + row(all, 'The pages, word for word').source);
});

test('M752-Q4 THE RECEIPT KEEPS WHAT IS READ OF THE SELECTION: the page keeps its source gaps (receiptview), not every record line; the sent store keeps the counts, the story and the small parts, not a list of every message and line', () => {
  const msgs = tale(600, 'The rain fell. '.repeat(30));
  const vis = visiblePages(msgs);
  const nodes = [];
  for (let s = 0; s + 4 <= vis.length - 31; s += 4) nodes.push({ id: 'node-' + s, span: [s, s + 3], text: 'LINE ' + s + ' things happened.', level: 1, at: s, sourcePages: sourceBindings(vis.slice(s, s + 4)) });
  const conn = { type: 'openai', model: 'x', baseUrl: 'https://api.example', contextSize: 1000000 };
  const r = sendLike(msgs, nodes, conn, { story: { id: 'tale-q4' } });
  eq(r.selection.records.filter((x) => x.selected).length, nodes.length, 'fixture: the request carries every line');
  const page = finalizeReceipt(r.receipt, {});
  eq(JSON.stringify(Object.keys(page.selection)), '["gaps"]', 'the page keeps the gaps alone');
  assert(JSON.stringify(page.selection).length < 200, 'a few bytes, not the record: ' + JSON.stringify(page.selection).length);
  const kept = selectionForSent(r.selection, { recall: { ids: [], why: 'disabled' } });
  eq(kept.storyId, 'tale-q4', 'the story it was sent for');
  eq(kept.records.selected, nodes.length, 'how many lines rode');
  eq(kept.messages.total, msgs.length, 'how many messages the tale had');
  assert(!Array.isArray(kept.records) && !Array.isArray(kept.messages), 'counts, not lists');
  assert(JSON.stringify(kept).length < 2000, 'under two kilobytes for a 600-page tale: ' + JSON.stringify(kept).length);
  eq(kept.recall.why, 'disabled', 'with what the caller adds');
});

test('M752-Q5 THE PLANS ROW NAMES THE PLANS THAT WERE SENT: with eight plans standing the request carries at most six — the row names those six and counts the rest', () => {
  const plans = Array.from({ length: 8 }, (_, i) => ({ id: 'p' + i, title: 'PLAN-TITLE-' + i, status: 'standing', parts: [{ who: 'Rukia', does: 'goes to gate ' + i }] }));
  const r = buildRequest({ story: {}, messages: tale(3), settings: {}, state: {}, modules: [], memory: '', smallPlansBook: { plans }, window: { keeperOn: true } });
  const wire = wireOf(r);
  const sent = plans.filter((p) => wire.includes(p.title));
  eq(sent.length, 6, 'fixture: six plans ride');
  const reason = row(r, 'Plans standing').reason;
  for (const p of plans) eq(reason.includes(p.title), sent.includes(p), 'the row names ' + p.title + ' exactly when it rode');
  assert(/2 more plans stand, not sent this page/.test(reason), 'and counts the others: ' + reason);
});

test('M752-Q6 THE CAST IS WEIGHED IN THE ROOM ITS OWN CALL IS MEASURED BY: a 64k connection that thinks (its answer room raised to 16,000) weighs a long tale — the weighing is sent, not refused before sending; a context too small for it is said, not sent', async () => {
  const sid = 'm752-weigh';
  const long = 'The rain fell on the yard and the duel went on. '.repeat(40);
  for (let i = 0; i < 600; i += 1) await db.messages.append(sid, { role: i % 2 ? 'assistant' : 'user', text: 'Page ' + i + ' ' + long });
  const st = applyMutations({ ...emptyState(), page: 300 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Kaelen' }]).state;
  await saveState(sid, st);
  const conn = { id: 'w64', type: 'openai', model: 'w', baseUrl: 'https://api.example', apiKey: 'k', contextSize: 64000, reasoning: { effort: 'high' } };
  const bodies = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { bodies.push(JSON.parse(opts.body)); return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ player_story_name: 'Jovan', actors: { Jovan: { default: 6, domains: { melee: 7 } }, Kaelen: { default: 5 } } }) } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n'); };
  let result;
  try { result = await maybeSeedSheet({ connection: conn, storyId: sid, force: true, brief: 'A Bleach story.' }); } finally { globalThis.fetch = realFetch; }
  eq(bodies.length >= 1, true, 'the weighing was sent');
  const w = workerConnection(conn, { maxTokens: SEED_MAX_TOKENS });
  const acc = measureTransport(w, { system: bodies[0].messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n'), messages: bodies[0].messages.filter((m) => m.role !== 'system') });
  assert(acc.inputTokens <= refusalRoom({ budgetTokens: 64000, answerTokens: acc.answerTokens, answerEstimate: acc.answerEstimate }), 'within the line its call is refused at: ' + acc.inputTokens);
  assert(acc.inputTokens > 0.8 * refusalRoom({ budgetTokens: 64000, answerTokens: acc.answerTokens, answerEstimate: false }), 'and the room is used: ' + acc.inputTokens);
  eq(result && result.ok, true, 'and the cast was weighed');
  const tiny = await maybeSeedSheet({ connection: { ...conn, contextSize: 24000 }, storyId: sid, force: true, brief: 'A Bleach story.', callLLM: async () => { throw new Error('never asked'); } });
  eq(tiny.why, 'the model’s context is too small to weigh the cast', 'too small a context is said');
});

test('M752-Q7 THE PLANNER’S RECORD TAKES THE ROOM ITS OWN CALL LEAVES: on a 128k model that thinks, the ask with a long record fits the line its call is refused at — the 45%-of-context record did not; a model too small for the craft and the pages is said, not sent', () => {
  const nodes = []; for (let i = 0; i < 300; i += 1) nodes.push({ id: 'n' + i, span: [i * 2, i * 2 + 1], level: 1, at: i, text: 'Line ' + i + ': ' + 'Rukia and Jovan crossed the yard and argued about the captain. '.repeat(9) });
  const pages = []; for (let i = 0; i < 31; i += 1) { pages.push('The writer: I do thing ' + i + '.'); pages.push('Page ' + i + ' ' + 'The rain kept falling on the old roofs of the division. '.repeat(45)); }
  const parts = { craft: CRAFT_TEXT, brief: 'A Bleach story. '.repeat(400), castNotes: 'Rukia — lieutenant. '.repeat(200), facts: 'The hour: noon\n'.repeat(400), people: 'Rukia: '.repeat(2000), pages, mc: 'Jovan' };
  const conn = { type: 'openai', model: 'w', baseUrl: 'https://api.example', contextSize: 128000, reasoning: { effort: 'high' } };
  const measure = (ask) => { const w = workerConnection(conn, { maxTokens: PLAN_MAX_TOKENS }); const acc = measureTransport(w, { system: ask.system, messages: [{ role: 'user', content: ask.user + '\n\nYour last answer was not the JSON object asked for. Answer with that one JSON object only — no words before or after it.' }] }); return { input: acc.inputTokens, limit: refusalRoom({ budgetTokens: contextOf(w), answerTokens: acc.answerTokens, answerEstimate: acc.answerEstimate }) }; };
  const old = measure(plannerAsk({ ...parts, record: wholeRecord({ nodes }, Math.floor(contextOf(conn) * 3 * 0.45)) }));
  assert(old.input > old.limit, 'fixture: the old share is refused (' + old.input + ' over ' + old.limit + ')');
  const ask = plannerAskFitted(conn, parts, (cap) => wholeRecord({ nodes }, cap));
  const now = measure(ask);
  assert(now.input <= now.limit, 'the fitted ask goes, its retry line too: ' + now.input + ' within ' + now.limit);
  assert(/The story so far \(the older pages, folded into notes\):/.test(ask.user) && ask.user.includes('Line 299:'), 'with the record, its newest kept');
  eq(plannerAskFitted({ ...conn, contextSize: 32000 }, parts, () => 'x'), null, 'a model too small for the rest of the ask is not asked');
  assert(workerRoom({ ...conn, contextSize: 32000 }, { system: 'x', user: '', maxTokens: PLAN_MAX_TOKENS }) < workerRoom(conn, { system: 'x', user: '', maxTokens: PLAN_MAX_TOKENS }), 'the room follows the model');
});

test('M752-Q8 A HELPER ASKED AGAIN WITH ROOM TO ANSWER IS GIVEN ONLY THE ROOM THE CONTEXT LEAVES: a first answer that was all thinking is asked again with an answer room that fits beside its prompt — not refused before sending', async () => {
  const conn = { id: 'w', type: 'openai', model: 'w', baseUrl: 'https://api.example', apiKey: 'k', contextSize: 40000 };
  const user = 'u'.repeat(3 * 26000); /* about 26,000 tokens: an 8,000 answer fits beside it, 16,000 does not */
  const bodies = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body); bodies.push(body);
    const events = bodies.length === 1 ? [{ choices: [{ delta: { reasoning_content: 'thinking it over' } }] }, { choices: [{ delta: {}, finish_reason: 'length' }] }] : [{ choices: [{ delta: { content: '{"ok":1}' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }];
    return new Response(events.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join('') + 'data: [DONE]\n\n');
  };
  let out;
  try { out = await callWorker(conn, { system: 'You answer with JSON.', user, maxTokens: 8000 }); } finally { globalThis.fetch = realFetch; }
  eq(bodies.length, 2, 'asked again');
  assert(bodies[1].max_tokens > 8000 && bodies[1].max_tokens < 16000, 'with the room the context leaves: ' + bodies[1].max_tokens);
  eq(out.text, '{"ok":1}', 'and its answer came back');
});

test('M752-Q9 THE LATEST EXCHANGE RIDES WHATEVER ITS SHAPE: an aside of his between the storyteller’s latest page and his move — in a room for about one page, the page rides with the aside and the move (it went first, under the last-two rule)', () => {
  const page = (i) => 'PAGE-' + i + ' ' + 'The rain fell on the courtyard and nobody moved. '.repeat(40);
  const msgs = []; for (let i = 0; i < 10; i += 1) { msgs.push({ id: 'u' + i, role: 'user', text: 'move ' + i }); msgs.push({ id: 'a' + i, role: 'assistant', text: page(i) }); }
  msgs.push({ id: 'q', role: 'user', text: '((who is Kara?))', ooc: true }, { id: 'm', role: 'user', text: 'LAST-MOVE I go on.' });
  const whole = buildRequest({ story: {}, messages: msgs, settings: {}, state: {}, modules: [], memory: '', window: { keeperOn: false, budgetTokens: 10000000 } });
  const fixed = requestTokens(whole.systemBlocks, whole.messages.filter((m) => !/^PAGE-|^move |^\(\(|^LAST/.test(String(m.content))));
  for (const keeperOn of [false, true]) {
    const r = buildRequest({ story: {}, messages: msgs, settings: {}, state: {}, modules: [], memory: '', window: { keeperOn, budgetTokens: fixed + 700 + ANSWER_RESERVE + CONTEXT_MARGIN }, measureOnly: true });
    const said = r.messages.map((m) => String(m.content));
    assert(said.some((t) => t.startsWith('PAGE-9 ')), (keeperOn ? 'keeper on (the final fit)' : 'keeper off (the window’s floor)') + ': the latest page rides: ' + said.map((t) => t.slice(0, 10)).join(' | '));
    assert(said.includes('((who is Kara?))') && said.includes('LAST-MOVE I go on.'), 'with the aside and his move');
    assert(!said.some((t) => t.startsWith('PAGE-8 ')), 'and the older pages go first');
  }
});

test('M752-Q10 THE WINDOW IS PLANNED IN THE FINAL FIT’S OWN MEASURE: a long tale with the keeper off fills the room in one plan — the final fit takes nothing out (it took 100 to 170 exchanges out, one measure of the whole request at a time)', () => {
  const msgs = tale(600);
  for (const ctx of [128000, 200000]) {
    const conn = { type: 'openai', model: 'x', baseUrl: 'https://api.example', contextSize: ctx };
    const r = buildRequest({ story: {}, messages: msgs, settings: {}, state: {}, modules: craft, memory: '', window: { keeperOn: false, window: 30, budgetTokens: ctx, answerTokens: 16000 }, transportMeasure: (req) => measureTransport(conn, req) });
    eq(r.receipt.context.removedHistory, 0, ctx + ': nothing taken out by the fit');
    assert(r.receipt.context.inputTokens <= r.receipt.context.inputRoom && r.receipt.context.inputTokens > r.receipt.context.inputRoom - 1500, ctx + ': and the room is filled: ' + r.receipt.context.inputTokens + ' of ' + r.receipt.context.inputRoom);
  }
});

test('M752-Q11 A SMALL STORYTELLER’S EIGHT PAGES ARE CUT TO THE INPUT ROOM: the answer and the margin are kept apart (M714) — the cut leaves the request within the room, the final fit takes nothing more out', () => {
  const scene = applyMutations({ ...emptyState(), page: 30 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Yard' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }]).state;
  const PLAN = { scene: 'Rukia waits.', people: [{ name: 'Rukia Kuchiki', now: 'at the rail', wants: 'an answer', against: '' }], unknown: [], pressing: [], earlier: [], laws: ['MC Agency'], intense: false, sounds: [], leaveTo: 'what Jovan says', story: 'Jovan serves the Tenth.' };
  const msgs = tale(20, 'Rukia watched the yard while the drills went on. '.repeat(60));
  const conn = { type: 'openai', model: 'small', baseUrl: 'https://api.example', smallModel: true };
  const build = (ctx) => buildRequest({ story: {}, messages: msgs, settings: { smallModelNow: true }, state: { ...scene, page: 30 }, modules: craft, memory: '', smallPlan: PLAN, window: { keeperOn: true, window: 30, budgetTokens: ctx, answerTokens: 16000 }, transportMeasure: (req) => measureTransport({ ...conn, contextSize: ctx }, req) });
  const roomy = build(400000);
  const eight = roomy.messages.filter((m) => /^Page \d+ prose/.test(String(m.content))).length;
  eq(eight, 8, 'fixture: a small request carries its eight pages when the room holds them');
  const words = requestTokens(roomy.systemBlocks, roomy.messages) - roomy.messages.filter((m) => /^Page \d+ prose/.test(String(m.content))).reduce((n, m) => n + Math.ceil(String(m.content).length / 3) + 24, 0);
  const ctx = words + 4 * 1050 + ANSWER_RESERVE + CONTEXT_MARGIN; /* room for about four of the eight pages beside the answer */
  const r = build(ctx);
  const carried = r.messages.filter((m) => /^Page \d+ prose/.test(String(m.content))).length;
  assert(carried >= 2 && carried < 8, 'cut to the room: ' + carried + ' of the eight');
  eq(r.receipt.context.removedHistory, 0, 'by the cut itself — the final fit takes nothing more out');
  assert(r.receipt.context.inputTokens <= inputRoom({ budgetTokens: ctx, answerTokens: 16000 }), 'within the input room');
});

/* M752-Q12: A WORKER'S ROOM IS THE ROOM ITS CALL IS SENT IN. roomChars (engine/pagecut.js) sized every worker's view and
 * look-up rounds as (context − the asked answer − 2,000) × 3, while the adapters refuse a body past budget.js refusalRoom —
 * wrappers counted, a 3,000 margin, and the answer room the call really carries (raised to 16,000 for a worker whose
 * connection thinks). A prompt filled to the old room was refused before sending on every size measured. */
test('M752-Q12 a worker prompt filled to roomChars is never refused by the adapters — thinking or not, OpenAI or Anthropic, small or large', async () => {
  const { roomChars } = await import('../../js/engine/pagecut.js');
  const { workerConnection } = await import('../../js/agents/call.js');
  const { measureTransport } = await import('../../js/providers/measure.js');
  const { refusalRoom } = await import('../../js/assemble/budget.js');
  const accepted = (conn, maxTokens, chars, split) => {
    const c = workerConnection(conn, { maxTokens });
    const sys = Math.floor(chars * split);
    const m = measureTransport(c, { system: 'x'.repeat(sys), messages: [{ role: 'user', content: 'y'.repeat(chars - sys) }] });
    return m.inputTokens <= refusalRoom({ budgetTokens: conn.contextSize, answerTokens: m.answerTokens, answerEstimate: m.answerEstimate });
  };
  for (const [contextSize, think, type, maxTokens] of [[64000, false, 'openai', 6000], [64000, true, 'openai', 6000], [128000, true, 'anthropic', 3000], [200000, false, 'anthropic', 6000], [32000, false, 'openai', 4000]]) {
    const conn = { type, model: 'm', contextSize, ...(think ? { reasoning: { effort: 'high' } } : {}) };
    const room = roomChars(conn, maxTokens);
    for (const split of [0, 0.5]) assert(accepted(conn, maxTokens, room, split), contextSize + (think ? ' thinking ' : ' ') + type + ': a prompt filled to its room (' + room + ' characters) is sent');
    assert(!accepted(conn, maxTokens, room + 12000, 0.5), contextSize + ': and the room is no smaller than it needs to be — 12,000 characters more would be refused');
    if (think) assert(room <= Math.floor((contextSize - 16000 - 3000) * 3), 'a thinking worker’s room leaves its raised answer free: ' + room);
  }
});
