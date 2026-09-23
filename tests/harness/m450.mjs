/* M450: who could know this is read against the story, not only the ledger. The second reader's untold-knowledge warn
 * MENDS the page, and its blind spots come from the ledger's knowledge lines — a line the page reader missed made a true
 * telling look untold. It is handed the story so far (the record, the pages before this one) now. Runs the real reader. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { HOUSES, withHouse } from './thinkinghouse.mjs';
import { applyMutations } from '../../js/engine/apply.js';
import { emptyState } from '../../js/engine/state.js';
import { buildContinuityMessages, checkTurn } from '../../js/agents/continuity.js';

const ledger = () => applyMutations({ ...emptyState(), page: 6 }, [{ type: 'mc.set', name: 'Jovan Oda' },
  ...['Jovan Oda', 'Rukia Kuchiki', 'Kiyone Kotetsu'].map((n) => ({ type: 'presence.enter', name: n })),
  { type: 'knowledge.add', name: 'Rukia Kuchiki', fact: 'the transfer order came from the Captain-Commander' }]).state;
const BEFORE = [{ role: 'user', text: 'I tell them both about the transfer.', number: 5 }, { role: 'assistant', text: 'Oda told Kiyone and Rukia the transfer order came from the Captain-Commander. TELLING-MARK', number: 6 }];
const PAGE = 'Kiyone frowned. “If the Captain-Commander signed the transfer, we can’t refuse it.”';

test('M450-1 THE SECOND READER IS HANDED THE STORY SO FAR — the record and the pages before this one — and told a telling there is a telling', () => {
  const m = buildContinuityMessages({ state: ledger(), assistantText: PAGE, record: 'Oda took the 13th. RECORD-MARK', before: BEFORE });
  assert(/RECORD-MARK/.test(m.user) && /TELLING-MARK/.test(m.user), 'the record and the earlier page ride');
  assert(/THE STORY SO FAR/.test(m.system) && /can miss a telling/.test(m.system), 'the law says the ledger can miss one');
});

test('M450-2 ON THE WIRE — checkTurn sends the earlier telling to the reader, whole', async () => {
  let sent = '';
  const fetchImpl = async (url, opts) => {
    sent = String(opts.body || '');
    const lines = 'data: ' + JSON.stringify({ choices: [{ delta: { content: '{"findings":[]}' } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n';
    return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(lines)); c.close(); } }), json: async () => ({}), text: async () => lines, clone() { return this; } };
  };
  const r = await withHouse({ fetch: fetchImpl }, () => checkTurn({ connection: HOUSES[0].conn, state: ledger(), assistantText: PAGE, record: 'RECORD-MARK', before: BEFORE }));
  eq(r.findings.length, 0, 'read');
  assert(/TELLING-MARK/.test(sent) && /RECORD-MARK/.test(sent), 'the earlier page and the record were sent');
});
