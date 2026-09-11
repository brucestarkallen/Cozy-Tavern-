/* M82 — Chat Assistant's auto-supersede: a second wave retires the first
 * wave's cards it replaces (identical, refined, dead, failed), never an
 * independent fix; twins within one answer merge; the talk says so. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { emptyState } from '../../js/engine/state.js';
import { parseProtocol, stageProposals, supersededByNew, cardTarget } from '../../js/agents/housekeeper.js';

const story = { title: 'T', brief: 'Alexia (15), the eldest\nClaire (16) — the neighbor\nMina (16) — the quiet one', castNotes: '' };
const messages = [{ id: 'aaaaaa1', role: 'assistant', text: 'Kim sat by the window. Kim was tired.' }];
const world = (session) => ({ messages, state: emptyState(), modules: [], lore: [], memory: { nodes: [{ id: 'n1', span: [0, 3], text: 'Kim met Bob.', level: 1, at: 1 }] }, session, story });

test('M82-1 the second wave: an identical re-proposal, a refinement, and a new card on a FAILED target retire the old ones; an independent fix on the same page stays', () => {
  const session = { turns: [], batches: [] };
  const wave1 = stageProposals(parseProtocol([
    '<brief>[{"field":"brief","find":"Alexia (15)","replace":"Alexia (16)","reason":"a"},{"field":"brief","find":"Claire (16) — the neighbor","replace":"Claire (16) — first year, the neighbor","reason":"b"}]</brief>',
    '<edits>[{"id":"#aaaaaa","find":"sat by the window","replace":"stood by the window","reason":"c"},{"id":"#aaaaaa","find":"Kim was sleepy","replace":"Kim was awake","reason":"d"}]</edits>',
    '<record>[{"line":"#rn1","find":"met Bob","replace":"met Ann","reason":"e"}]</record>',
  ].join('\n')), world(session));
  session.turns.push({ role: 'housekeeper', text: 'wave one', ts: 1, proposals: wave1 });
  const by = (find) => wave1.find((p) => p.op && p.op.find === find);
  const a = by('Alexia (15)'); const b = by('Claire (16) — the neighbor'); const c = by('sat by the window'); const d = by('Kim was sleepy'); const e = by('met Bob');
  eq([a, b, c, e].map((p) => p.status).join(','), 'pending,pending,pending,pending', wave1.map((p) => p.status + ':' + p.words).join(' | '));
  eq(d.status, 'refused', 'the bad anchor was refused at the door');
  /* the writer asks again without applying: (a) identical, (b) refined (same anchor, new words),
   * (c′) a DIFFERENT fix on the same page whose old anchor still stands, (d′) a corrected anchor for the failed d,
   * (e) untouched */
  const wave2 = stageProposals(parseProtocol([
    '<brief>[{"field":"brief","find":"Alexia (15)","replace":"Alexia (16)","reason":"a again"},{"field":"brief","find":"Claire (16) — the neighbor","replace":"Claire (16) — first year at Ravenwood High, the neighbor","reason":"b refined"}]</brief>',
    '<edits>[{"id":"#aaaaaa","find":"Kim was tired","replace":"Kim was awake","reason":"d corrected"}]</edits>',
  ].join('\n')), world(session));
  eq(wave2.setAside, 3, 'three set aside');
  eq(a.status, 'superseded'); assert(/superseded by the newest answer/.test(a.words));
  eq(b.status, 'superseded', 'the refinement retires the old one');
  eq(c.status, 'pending', 'the independent page fix (c) stands');
  eq(d.status, 'superseded'); assert(/replaced after it could not land/.test(d.words), d.words);
  eq(e.status, 'pending', 'the record card, untouched, stands');
  eq(wave2.filter((p) => p.status === 'pending').length, 3);
});

test('M82-2 a pending card whose anchor died (the page moved) is retired by ANY new card on that page; twins within one answer merge; the laws', () => {
  const session = { turns: [], batches: [] };
  const w1 = stageProposals(parseProtocol('<edits>[{"id":"#aaaaaa","find":"sat by the window","replace":"stood by the window","reason":"c"}]</edits>'), world(session));
  session.turns.push({ role: 'housekeeper', text: 'x', ts: 1, proposals: w1 });
  const moved = [{ id: 'aaaaaa1', role: 'assistant', text: 'Kim knelt by the window. Kim was tired.' }];
  const w2 = stageProposals(parseProtocol('<edits>[{"id":"#aaaaaa","find":"Kim was tired","replace":"Kim was awake","reason":"z"},{"id":"#aaaaaa","find":"Kim was tired","replace":"Kim was awake","reason":"z twin"}]</edits>'), { ...world(session), messages: moved });
  eq(w1[0].status, 'superseded'); assert(/anchor no longer matches/.test(w1[0].words));
  eq(w2.length, 1, 'the twin within the answer merged'); eq(w2.intraDups, 1);
  eq(cardTarget({ kind: 'brief', op: { field: 'castNotes' } }), 'story:castNotes');
  eq(cardTarget({ kind: 'lore', op: { add: true } }), null, 'an add has no one target');
  assert(!supersededByNew({ kind: 'ledit', op: { mutations: [{ type: 'a' }] } }, { kind: 'ledit', op: { mutations: [{ type: 'b' }] } }), 'two ledger cards are two changes');
  assert(!supersededByNew({ kind: 'edit', op: { messageId: 'm', hide: true } }, { kind: 'edit', op: { messageId: 'm', find: 'x', replace: 'y' } }), 'a hide is not refined by an edit');
});
