/* M754 — HIS (18 October 2026): "Why it's still stupid!! It keeps stuck on yellow the auditor ran just now has unresolved
 * findings; repeated attempts are paused until the story or ledger changes — still checking: Jugram's loose end 'first bell
 * tomorrow: he must show Marshal Kelstrum what fourth place at Angmar looks like on Ilvarren flags, blunted steel and
 * witnesses' was answered when the duel was fought at first bell on Freeday: no such loose end is written for them."
 * A loose end closed already (the page that answered it was read by its readers, who closed it) was still owed by the
 * auditor's old finding: the close of a loose end that is not open was refused, the finding was never counted as already so,
 * and the review was shown no loose ends to see it by — every pass asked the same close again and paused, yellow for good. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { auditLedger, auditFindingId, auditRepairChecklist } from '../../js/agents/auditor.js';

const BELL = 'first bell tomorrow: he must show Marshal Kelstrum what fourth place at Angmar looks like on Ilvarren flags, blunted steel and witnesses';
const DUEL = 'At first bell on Freeday Jugram took the Ilvarren flags in the yard, blunted steel in hand, and Marshal Kelstrum watched every pass with the witnesses beside him.';

/* a model that answers every request with the same review, as his did pass after pass */
function scriptedFetch(reply, seen) {
  return async (_url, opts) => {
    const body = JSON.parse(opts.body);
    seen.push(body.messages.map((m) => String(m.content)).join('\n'));
    const text = JSON.stringify(reply(seen.length));
    return new Response(body.stream
      ? 'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n'
      : JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }));
  };
}
const CONN = { type: 'openai', baseUrl: 'https://fixture.example/v1', apiKey: 'fixture', model: 'm', preset: 'custom', context: 64000 };

async function hisTale(title, characters, { sheet = { actors: {}, playerName: 'Azrael' } } = {}) {
  const { id } = await db.stories.create({ title });
  await db.messages.append(id, { role: 'user', text: 'I meet him in the yard at first bell.', ts: 1 });
  await db.messages.append(id, { role: 'assistant', text: '[The yard — Freeday | first bell | cold]\n\n' + DUEL, ts: 2 });
  let st = { ...emptyState(), sheet, place: { name: 'The yard' }, characters };
  st = applyMutations(st, [{ type: 'presence.enter', name: sheet.playerName }, { type: 'presence.enter', name: 'Jugram' }]).state;
  return { id, st };
}

test('M754-1 HIS STUCK FINDING: the loose end the duel answered was closed already; the auditor\'s old finding to close it is already so — it settles on the next pass, nothing is refused, nothing is left pending, and his other loose end stays', async () => {
  const F = { what: 'Jugram’s loose end ‘' + BELL + '’ was answered when the duel was fought at first bell on Freeday', fix: 'close it', pages: false,
    mutations: [{ type: 'people.note', name: 'Jugram', field: 'unthread', text: BELL }], pendingReason: 'no such loose end is written for them' };
  const { id, st } = await hisTale('M754 his stuck loose end', {
    Azrael: { core: '', state: 'in the yard', arc: '', threads: [] },
    Jugram: { core: 'A knight of Ilvarren, sworn to the Marshal.', state: 'in the yard, the bout done', arc: '', threads: ['owes Melisende an answer about her sister'] },
  });
  await saveState(id, { ...st, audit: { coverage: { read: 1, total: 1 }, pending: [F.what + ': ' + F.pendingReason], unresolved: [F] } });
  const seen = [];
  const oldFetch = globalThis.fetch;
  /* the model asks the same close again (his did, every pass) and calls the review complete */
  globalThis.fetch = scriptedFetch(() => ({ repairs: [{ id: auditFindingId(F), status: 'repair', shown: DUEL, why: 'The duel answered it.', mutations: [{ type: 'people.note', name: 'Jugram', field: 'unthread', text: BELL, shown: DUEL }] }],
    issues: [], review: { status: 'complete', why: 'checked', open: [] }, standings: [] }), seen);
  try {
    const result = await auditLedger({ storyId: id, connection: CONN, stale: () => false });
    const after = await loadState(id);
    eq(JSON.stringify(result.pending || []), '[]', 'nothing is left pending: ' + JSON.stringify(result.pending));
    assert(!(after.audit.unresolved || []).length, 'no unresolved finding is kept: ' + JSON.stringify(after.audit.unresolved));
    assert(!after.audit.unfinished, 'the audit is not unfinished');
    eq(JSON.stringify(after.characters.Jugram.threads), JSON.stringify(['owes Melisende an answer about her sister']), 'his other loose end stays');
  } finally { globalThis.fetch = oldFetch; }
});

test('M754-2 THE CLOSE OF A LOOSE END THAT IS NOT OPEN IS ALREADY SO — for every reader (the auditor, the page reader, the scribe go through one door); one written on a page of his kept under another of his names is closed there; a close that is near another of their loose ends but not it is still refused, and the refusal says what is written', () => {
  const base = { ...emptyState(), sheet: { actors: {}, playerName: 'Azrael', playerAliases: ['Lord Vael'] } };
  /* closed already: already so, nothing written, no refusal */
  const s1 = { ...base, characters: { Jugram: { core: 'A knight.', state: '', arc: '', threads: ['owes Melisende an answer about her sister'] } } };
  const r1 = applyMutations(s1, [{ type: 'people.note', name: 'Jugram', field: 'unthread', text: BELL }]);
  eq(r1.applied.length, 0, 'nothing to close');
  eq(r1.rejected.length, 1, 'answered once');
  assert(r1.rejected[0].same === true, 'already so, not a refusal: ' + JSON.stringify(r1.rejected[0]));
  /* written: closed, by sense */
  const s2 = { ...base, characters: { Jugram: { core: 'A knight.', state: '', arc: '', threads: [BELL, 'owes Melisende an answer about her sister'] } } };
  const r2 = applyMutations(s2, [{ type: 'people.note', name: 'Jugram', field: 'unthread', text: 'First bell tomorrow — he must show Marshal Kelstrum fourth place at Angmar on Ilvarren flags, with blunted steel and witnesses' }]);
  eq(r2.applied.length, 1, 'closed');
  eq(JSON.stringify(r2.state.characters.Jugram.threads), JSON.stringify(['owes Melisende an answer about her sister']), 'that one only');
  /* his page kept under another of his names (written before the name was his): closed where it is written */
  const s3 = { ...base, characters: { Azrael: { core: '', state: '', arc: '', threads: [] }, 'Lord Vael': { core: '', state: '', arc: '', threads: ['must answer the Marshal at first bell'] } } };
  const r3 = applyMutations(s3, [{ type: 'people.note', name: 'Lord Vael', field: 'unthread', text: 'must answer the Marshal at first bell' }]);
  eq(r3.applied.length, 1, 'closed on the page it is written on: ' + JSON.stringify(r3.rejected));
  eq(JSON.stringify(r3.state.characters['Lord Vael'].threads), '[]', 'gone from that page');
  /* near another of theirs, but not it: refused, and the refusal says what is written */
  const s4 = { ...base, characters: { Mira: { core: 'the innkeeper', state: '', arc: '', threads: ['owes the ferryman', 'the debt to the ferryman'] } } };
  const r4 = applyMutations(s4, [{ type: 'people.note', name: 'Mira', field: 'unthread', text: 'the ferryman' }]);
  eq(r4.applied.length, 0, 'nothing closed on a guess');
  assert(r4.rejected[0] && r4.rejected[0].same !== true && /owes the ferryman/.test(r4.rejected[0].why), 'refused, with what is written: ' + JSON.stringify(r4.rejected[0]));
});

test('M754-3 THE REVIEW IS SHOWN THE LOOSE ENDS AN OLD CLOSE WAS ABOUT — the checklist showed the person\'s field "unthread", which no page has, so the reviewer never saw that the loose end was gone', () => {
  const state = { ...emptyState(), sheet: { actors: {}, playerName: 'Azrael' }, characters: { Jugram: { core: 'A knight.', state: '', arc: '', threads: ['owes Melisende an answer about her sister'] } } };
  const F = { what: 'Jugram’s loose end was answered', fix: 'close it', mutations: [{ type: 'people.note', name: 'Jugram', field: 'unthread', text: BELL }] };
  const [item] = auditRepairChecklist([F], state);
  const person = item.targets[0].current.person;
  eq(JSON.stringify(person.threads), JSON.stringify(['owes Melisende an answer about her sister']), 'the loose ends as they stand: ' + JSON.stringify(person));
});

test('M754-4 THE SAME FOR EVERY CLOSE THE AUDITOR MAKES — an old finding to close a thread, let go of a line of what someone knows, clear a faction, unlock a truth, heal a wound, take someone out of the scene or clear a thing is settled once its door finds nothing left to close; while the thing still stands it is not, nor when two could answer', async () => {
  const { findingSettled } = await import('../../js/agents/auditor.js');
  const settled = (state, m) => findingSettled({ what: 'an old close', fix: 'x', mutations: [m] }, { out: state, issues: [], applied: [], rejected: [] }, [], []);
  const base = { ...emptyState(), sheet: { actors: {}, playerName: 'Azrael' } };
  const built = applyMutations(base, [
    { type: 'thread.set', title: 'Caleb and the missing frame', owner: 'Caleb', next: 'find the frame' },
    { type: 'knowledge.add', name: 'Mira', fact: 'the ferryman lied about the crossing' },
    { type: 'faction.set', name: 'The Ninth', stance: 'wary', agenda: 'hold the gate' },
    { type: 'canon.lock', name: 'Mira', key: 'hair', value: 'black' },
    { type: 'body.injure', name: 'Mira', what: 'cut forearm', sev: 1 },
    { type: 'presence.enter', name: 'Mira' },
    { type: 'thing.set', name: 'the boathouse key', where: 'on the hook', owner: 'Mira' },
  ]).state;
  const closes = [
    { type: 'thread.close', title: 'Caleb and the missing frame' },
    { type: 'knowledge.forget', name: 'Mira', fact: 'the ferryman lied about the crossing' },
    { type: 'faction.clear', name: 'The Ninth' },
    { type: 'canon.unlock', name: 'Mira', key: 'hair' },
    { type: 'body.heal', name: 'Mira', what: 'cut forearm' },
    { type: 'presence.leave', name: 'Mira' },
    { type: 'thing.clear', name: 'the boathouse key', cause: 'burned' },
  ];
  for (const m of closes) assert(!settled(built, m), m.type + ': still standing — not settled');
  const gone = applyMutations(built, closes).state;
  for (const m of closes) assert(settled(gone, m), m.type + ': closed already — settled');
  /* two threads that both answer to the title: neither is closed on a guess, and the finding is not settled */
  const two = applyMutations(base, [{ type: 'thread.set', title: 'Chloe’s clip of Jovan at the Wells house', owner: 'Chloe', next: 'x' }, { type: 'thread.set', title: 'Chloe’s clip of Jovan at the pier', owner: 'Chloe', next: 'y' }]).state;
  assert(!settled(two, { type: 'thread.close', title: 'Chloe’s clip of Jovan' }), 'two that could answer: not settled');
  /* a loose end: open → not settled; closed → settled; to open one, it is settled once written */
  const loose = { ...base, characters: { Jugram: { core: 'A knight.', state: '', arc: '', threads: [BELL] } } };
  assert(!settled(loose, { type: 'people.note', name: 'Jugram', field: 'unthread', text: BELL }), 'a loose end still open: not settled');
  assert(settled({ ...base, characters: { Jugram: { core: 'A knight.', state: '', arc: '', threads: [] } } }, { type: 'people.note', name: 'Jugram', field: 'unthread', text: BELL }), 'closed already: settled');
  assert(settled(loose, { type: 'people.note', name: 'Jugram', field: 'thread', text: BELL }), 'one to open, written: settled');
});
