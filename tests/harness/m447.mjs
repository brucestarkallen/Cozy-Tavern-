/* M447: who is where is never mended. The second reader was told "a person present who the ledger says is elsewhere" is
 * drift, was shown every seat, and its warn MENDED THE PAGE — a wrong ledger could write Rukia out of the very page that
 * shows her in the office. Runs the real second reader on a scripted model. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { HOUSES, withHouse } from './thinkinghouse.mjs';
import { applyMutations } from '../../js/engine/apply.js';
import { emptyState } from '../../js/engine/state.js';
import { buildContinuityMessages, checkTurn, whereFinding } from '../../js/agents/continuity.js';

const streamed = (answer) => async (url, opts) => {
  const body = JSON.parse(opts.body);
  const lines = 'data: ' + JSON.stringify({ choices: [{ delta: { content: answer } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n';
  if (body.stream) return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(lines)); c.close(); } }), json: async () => ({}), text: async () => lines, clone() { return this; } };
  const obj = { choices: [{ message: { role: 'assistant', content: answer }, finish_reason: 'stop' }] };
  return { ok: true, status: 200, headers: new Headers(), json: async () => obj, text: async () => JSON.stringify(obj), clone() { return this; } };
};
const ledger = () => applyMutations({ ...emptyState(), page: 4 }, [{ type: 'mc.set', name: 'Jovan Oda' }, { type: 'place.set', name: "13th Division Barracks — Captain's Office" },
  ...['Jovan Oda', 'Byakuya Kuchiki'].map((n) => ({ type: 'presence.enter', name: n })),
  { type: 'offscreen.set', name: 'Rukia Kuchiki', location: '13th Division Barracks — her own office', activity: 'filing', stance: 'busy' },
  { type: 'canon.lock', name: 'Rukia Kuchiki', key: 'eyes', value: 'violet' }]).state;
const PAGE = "[13th Division Barracks — Captain's Office]\n\nRukia set the rosters on Oda’s desk while Byakuya read.";

test('M447-1 THE SECOND READER IS NEVER SHOWN WHERE THE ABSENT ARE, AND IS TOLD WHO IS WHERE IS THE PAGE’S — what is locked still binds', () => {
  const m = buildContinuityMessages({ state: ledger(), assistantText: PAGE });
  assert(!/her own office|filing/.test(m.user), 'her seat is not shown: ' + m.user.slice(0, 300));
  assert(/violet/.test(m.user), 'what is locked still is');
  assert(/WHO IS WHERE IS THE PAGE/.test(m.system) && !/a person present who the ledger says/.test(m.system), 'the law says so');
});

test('M447-2 A FINDING THAT HOLDS THE PAGE TO THE LEDGER’S WHEREABOUTS IS LET GO — never mended; one about who could know, and a locked truth, stand', async () => {
  const answer = JSON.stringify({ findings: [
    { words: 'Rukia is in the captain’s office, but the ledger has her elsewhere, in her own office.', severity: 'warn', fix: 'Rukia should not be in the scene' },
    { words: 'Byakuya cannot be here; the record puts him at the 6th.', severity: 'warn', fix: 'remove him' },
    { words: 'Kiyone could not know of the transfer — she was elsewhere when Oda told Rukia.', severity: 'warn', fix: 'she asks instead' },
    { words: 'The narration gives Rukia blue eyes; locked violet.', severity: 'warn', fix: 'violet eyes' },
  ] });
  const r = await withHouse({ fetch: streamed(answer) }, () => checkTurn({ connection: HOUSES[0].conn, state: ledger(), assistantText: PAGE }));
  eq(r.findings.map((f) => f.words.slice(0, 12)).join(' | '), 'Kiyone could | The narratio', 'only who-could-know and the locked eyes remain');
  eq(whereFinding({ words: 'She was elsewhere when he said it.' }), false, 'being away when something was said is who could know, not whereabouts');
  eq(whereFinding({ words: 'The record shows Kiyone was away when the plan was made, yet she speaks of it as if told.', fix: 'she asks' }), false, 'who could know, even beside the record, stands');
});
