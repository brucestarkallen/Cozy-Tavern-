/* M28 — the workers speak through the wire, and the ledger is founded.
 *
 * The field report this closes: first message of a story ("Jovan, a rich
 * handsome celebrity, eating at McDonald's with Liara"), the storyteller
 * answers, the ledger stays empty. Root causes proved here:
 *   1. five workers carried their own fetches that never told a thinking
 *      model to stop thinking — the budget went to thought, the answer was
 *      empty, the parser said "unusable";
 *   2. the extractor asked "what changed?" of a page that IS the world so far,
 *      and was told the empty list is the most common honest answer;
 *   3. nobody told any worker who the main character is.
 */
import { test, assert, eq } from './lib.mjs';
import { thinkingHouse, withHouse, thinkingOff, HOUSES } from './thinkinghouse.mjs';
import { extractTurn, buildExtractorMessages, isYoungLedger } from '../../js/agents/extractor.js';
import { scribeTurn } from '../../js/agents/scribe.js';
import { checkTurn } from '../../js/agents/continuity.js';
import { callWorker, workerConnection } from '../../js/agents/call.js';
import { retryAfterMs, transportError } from '../../js/providers/wire.js';
import { applyMutations, undoLast } from '../../js/engine/apply.js';
import { emptyState } from '../../js/engine/state.js';
import { mcName } from '../../js/engine/duels.js';
import { readFileSync } from 'node:fs';

const FOUNDING = JSON.stringify({ mutations: [
  { type: 'mc.set', name: 'Jovan' },
  { type: 'place.set', name: 'a booth at McDonald’s' },
  { type: 'presence.enter', name: 'Jovan', position: 'in the booth' },
  { type: 'presence.enter', name: 'Liara', position: 'across from him' },
  { type: 'mode.set', flag: 'socialField', reason: 'a crowded McDonald’s' },
] });
const userText = '#story Jovan a rich handsome celebrity. He’s currently eating at McDonald’s with Liara.';
const assistantText = 'The fluorescent hum pressed down on the booth. Liara peeled the paper from her burger and watched Jovan not eat his.';

test('M28-1: every house is told to stop thinking, in its own spelling, and the ledger gets its founding', async () => {
  for (const h of HOUSES) {
    const house = thinkingHouse({ answer: FOUNDING });
    const r = await withHouse(house, () => extractTurn({ connection: h.conn, state: emptyState(), userText, assistantText }));
    eq(r.mutations.length, 5, `${h.name}: five founding mutations`);
    const sent = house.calls[0].body;
    assert(thinkingOff(sent, house.calls[0].anthropic), `${h.name}: thinking is off on the wire`);
    eq(sent.temperature, 0, `${h.name}: cold`);
    eq(sent.max_tokens, 2400, `${h.name}: the worker budget, not the storyteller’s (M37: 2400)`);
    assert(!('top_p' in sent), `${h.name}: no storyteller dials`);
  }
});

test('M28-1b: the shapes the field runs — Z.ai / OpenRouter / Qwen each get their house’s knob', async () => {
  const want = { 'Z.ai (GLM)': (b) => b.thinking && b.thinking.type === 'disabled',
    'OpenRouter': (b) => b.reasoning && b.reasoning.enabled === false,
    'custom (Qwen)': (b) => b.enable_thinking === false,
    'Claude': (b) => !b.thinking };
  for (const h of HOUSES) {
    const house = thinkingHouse({ answer: FOUNDING });
    await withHouse(house, () => extractTurn({ connection: h.conn, state: emptyState(), userText, assistantText }));
    assert(want[h.name](house.calls[0].body), `${h.name}: the right spelling`);
  }
});

test('M28-2: the scribe, the second reader, and the raw call all ride the same path', async () => {
  const zai = HOUSES[0].conn;
  /* scribe: answers deltas JSON; we only need to see the wire */
  const h1 = thinkingHouse({ answer: '{"deltas":[]}' });
  await withHouse(h1, () => scribeTurn({ connection: zai, storyId: 'none', userText, assistantText, stale: () => false }).catch(() => null));
  assert(h1.calls.length >= 1 && thinkingOff(h1.calls[0].body, false), 'scribe: thinking off');
  const h2 = thinkingHouse({ answer: '{"findings":[]}' });
  const r2 = await withHouse(h2, () => checkTurn({ connection: zai, state: emptyState(), assistantText }));
  assert(thinkingOff(h2.calls[0].body, false), 'second reader: thinking off');
  eq(r2.findings.length, 0);
  const h3 = thinkingHouse({ answer: 'plain words' });
  const r3 = await withHouse(h3, () => callWorker(zai, { system: 's', user: 'u', maxTokens: 77 }));
  eq(r3.text, 'plain words');
  eq(h3.calls[0].body.max_tokens, 77);
});

test('M28-2b: a worker may still ask for thought — the ladder decides the spelling', async () => {
  const h = thinkingHouse({ answer: 'x' });
  await withHouse(h, () => callWorker(HOUSES[0].conn, { system: 's', user: 'u', effort: 'high' }).catch(() => null));
  const b = h.calls[0].body;
  eq(b.thinking && b.thinking.type, 'enabled', 'asked for, granted, in Z.ai’s spelling');
  const c = workerConnection({ prefill: 'never', searchOn: true, topP: 0.9, temperature: 1.2 }, {});
  assert(!c.prefill && !c.searchOn && !('topP' in c), 'the storyteller’s dials never reach a worker');
  eq(c.temperature, 0);
  eq(c.reasoning.effort, 'off');
});

test('M28-3: no fetch() survives in any worker — one wire path in the house', () => {
  for (const f of ['extractor', 'scribe', 'memory', 'continuity', 'referee']) {
    const src = readFileSync(new URL(`../../js/agents/${f}.js`, import.meta.url), 'utf8');
    assert(!/\bfetch\(/.test(src), `${f}.js carries no fetch of its own`);
    assert(/from '\.\/call\.js'/.test(src), `${f}.js imports the shared call`);
  }
  const sw = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
  assert(sw.includes("'js/agents/call.js'"), 'the shell list carries call.js');
});

test('M28-4: a refused call throws with the house’s wait, so the queue can back off honestly', async () => {
  const house = thinkingHouse({ status: 429, headers: { 'retry-after': '9' } });
  let err = null;
  await withHouse(house, () => callWorker(HOUSES[1].conn, { system: 's', user: 'u' }).catch((e) => { err = e; }));
  assert(err, 'it threw');
  eq(err.status, 429);
  eq(err.retryAfterMs, 9000, 'Retry-After rode out of the provider');
  /* the extractor no longer swallows it into a silent empty list */
  let err2 = null;
  await withHouse(house, () => extractTurn({ connection: HOUSES[1].conn, state: emptyState(), userText, assistantText }).catch((e) => { err2 = e; }));
  assert(err2 && err2.retryAfterMs === 9000, 'extractTurn throws the transport error through');
  eq(retryAfterMs({ get: () => 'Thu, 01 Jan 2099 00:00:00 GMT' }) > 0, true, 'an HTTP date is honored too');
  eq(transportError({ status: 503, headers: new Headers() }, 'no').status, 503);
});

test('M28-5: the founding prompt names the main character, or asks for one, and never calls empty honest', () => {
  const young = buildExtractorMessages({ state: emptyState(), userText, assistantText });
  assert(young.founding, 'a young ledger founds');
  assert(/THE LEDGER IS YOUNG/.test(young.system), 'founding law present');
  assert(/mc\.set/.test(young.system), 'mc.set is in the vocabulary');
  assert(/does not yet know the main character/.test(young.system), 'asks who the main character is');
  assert(!/most common/.test(young.system), 'the empty-is-common line is gone from the founding');
  const st = emptyState();
  st.sheet.playerName = 'Jovan';
  st.place = { name: 'McDonald’s' };
  st.present = [{ name: 'Liara' }];
  const settled = buildExtractorMessages({ state: st, userText, assistantText, brief: 'A celebrity and a friend.', castNotes: 'Liara — his oldest friend.' });
  assert(!settled.founding, 'a settled ledger does not found');
  assert(/is Jovan\./.test(settled.system), 'the main character is named to the worker');
  assert(/Be conservative/.test(settled.system), 'the conservatism law stands on a settled ledger');
  assert(settled.user.includes('A celebrity and a friend.') && settled.user.includes('his oldest friend'), 'brief and cast notes ride');
  eq(isYoungLedger(emptyState()), true);
  eq(isYoungLedger(st), false);
});

test('M28-6: mc.set names the main character once, refuses a second guess, and takes back cleanly', () => {
  const s0 = emptyState();
  const r1 = applyMutations(s0, [{ type: 'mc.set', name: 'Jovan' }]);
  eq(r1.applied.length, 1);
  eq(mcName(r1.state), 'Jovan');
  eq(mcName(s0), 'the player', 'the caller’s state is untouched');
  const r2 = applyMutations(r1.state, [{ type: 'mc.set', name: 'Someone Else' }]);
  eq(r2.applied.length, 0, 'a known name is never overwritten by a worker');
  assert(/already known as Jovan/.test(r2.rejected[0].why));
  const r3 = applyMutations(r1.state, [{ type: 'mc.set', name: 'jovan' }]);
  eq(r3.applied.length, 0, 'the same name again is not a change');
  const u = undoLast(r1.state);
  assert(u, 'take-back exists');
  eq(mcName(u.state), 'the player', 'taken back');
});

test('M28-7: the referee’s seeder never clobbers a known main-character name', () => {
  const src = readFileSync(new URL('../../js/agents/referee.js', import.meta.url), 'utf8');
  assert(/if \(!known\) state\.sheet\.playerName = nm;/.test(src), 'seeder sets the name only when none is known');
});
