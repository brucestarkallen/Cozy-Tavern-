import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { applyMutations, undoLast } from '../../js/engine/apply.js';
import { auditLedger } from '../../js/agents/auditor.js';

const connection = { type: 'openai', baseUrl: 'https://custom.example/v1', apiKey: 'fixture', model: 'm', preset: 'custom', context: 64000 };
const ALEXIA = 'Princess Alexia came in through the side gallery and sat in the third row, her woman settling two seats behind her.';
const COMMODUS = 'At the rail, Commodus turned his head toward Garett without troubling to lower his voice.';
const KERROC = 'Kerroc sat on his witness stool with the ledger shut on his knees.';
const CORVEN = 'Corven took the other witness stool, his cloak still cold from the yard.';
const END = 'The marshal reached the middle of the raked ground and came again head high, the full width of his shoulders behind the blunted blade. Jugram gave ground six steps to the cold stone wall, still watching the point rather than the hands. The steel beat once against the guard, loud enough for every bench to hear. Gravel dragged beneath the planted boot. The measured distance between the two fighters closed again as the next attack began, with neither leaving the salle and no change of scene.';
const PAGE = '[the palace salle, Ilvarren | 10:00]\n\n' + [ALEXIA, COMMODUS, KERROC, CORVEN, END].join('\n\n');
const sent = (body) => body.messages.map((m) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
async function wire(answer, run) {
  const old = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    const reply = await answer(body, calls.length);
    const text = typeof reply === 'string' ? reply : JSON.stringify(reply);
    const choices = body.stream ? [{ delta: { content: text } }] : [{ message: { content: text }, finish_reason: 'stop' }];
    return body.stream
      ? new Response('data: ' + JSON.stringify({ choices }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
      : new Response(JSON.stringify({ choices }), { headers: { 'Content-Type': 'application/json' } });
  };
  try { return await run(calls); } finally { globalThis.fetch = old; }
}
async function tale(title, { page = PAGE, input = 'I continue the bout.', mutations = [], extra = {} } = {}) {
  const { id } = await db.stories.create({ title });
  await db.messages.append(id, { id: id + 'u', role: 'user', text: input, ts: 1 });
  await db.messages.append(id, { id: id + 'a', role: 'assistant', text: page, ts: 2 });
  let state = applyMutations({ ...emptyState(), page: 0, readTo: 0 }, [
    { type: 'mc.set', name: 'Jugram' }, { type: 'place.set', name: 'the palace salle, Ilvarren' },
    { type: 'presence.enter', name: 'Jugram' },
    ...['Princess Alexia', "Alexia's woman", 'Commodus', 'Kerroc', 'Corven', 'Garett', 'Kelstrum'].map((name) => ({ type: 'people.set', name, field: 'core', text: 'An established person in this story.' })),
    ...mutations,
  ]).state;
  await saveState(id, { ...state, ...extra });
  return id;
}
const issue = (what, mutation) => ({ what, fix: 'Correct the ledger from the newest page.', mutations: [mutation] });

test('M687-1 the full auditor restores gallery spectators shown before a long bout ending, even when the reader omitted them', async () => {
  const id = await tale('m687-spectators', { mutations: [
    { type: 'offscreen.set', name: 'Princess Alexia', location: 'the palace salle gallery', activity: 'watching the bout' },
    { type: 'offscreen.set', name: 'Commodus', location: 'the palace salle rail', activity: 'with Garett' },
  ], extra: { roomAt: { page: 0, names: ['Jugram', 'Kelstrum', 'Kerroc', 'Corven', 'Garett'] } } });
  await wire(() => ({ issues: [
    issue('Alexia is missing from the scene.', { type: 'presence.enter', name: 'Princess Alexia', position: 'third row of the gallery', shown: ALEXIA }),
    issue('Her woman is also missing.', { type: 'presence.enter', name: "Alexia's woman", position: 'two seats behind Alexia', shown: ALEXIA }),
    issue('Commodus is incorrectly absent.', { type: 'presence.enter', name: 'Commodus', position: 'at the rail beside Garett', shown: COMMODUS }),
  ] }), async () => {
    const result = await auditLedger({ connection, storyId: id }); const state = await loadState(id);
    for (const name of ['Princess Alexia', "Alexia's woman", 'Commodus']) assert(state.present.some((p) => p.name === name), name + ' restored');
    assert(!state.offscreen['Princess Alexia'] && !state.offscreen.Commodus, 'arrival clears their old elsewhere records');
    assert(!result.unfinished, 'the supported repairs complete');
  });
});

test('M687-2 a posture and now repair uses the last evidence about its person rather than only the final fight paragraph', async () => {
  const id = await tale('m687-postures', { mutations: [
    { type: 'presence.enter', name: 'Kerroc', position: 'on the witness stool, pencil moving on the margin' },
    { type: 'presence.enter', name: 'Corven', position: 'in the yard' },
    { type: 'people.set', name: 'Corven', field: 'state', text: 'Filing a retreat in the yard.' },
  ] });
  await wire(() => ({ issues: [
    issue('Kerroc closed the ledger.', { type: 'presence.update', name: 'Kerroc', position: 'on his witness stool, ledger shut on his knees', shown: KERROC }),
    issue('Corven took his seat.', { type: 'presence.update', name: 'Corven', position: 'on the other witness stool', shown: CORVEN }),
    issue('Corven is not filing a retreat.', { type: 'people.set', name: 'Corven', field: 'state', text: CORVEN, shown: CORVEN }),
  ] }), async () => {
    const result = await auditLedger({ connection, storyId: id }); const state = await loadState(id);
    assert(state.present.find((p) => p.name === 'Kerroc').position.includes('shut'), 'the actual current posture is saved');
    assert(state.present.find((p) => p.name === 'Corven').position.includes('stool'), 'the other stool is saved');
    eq(state.characters.Corven.state, CORVEN, 'the supported current state is saved');
    assert(!result.unfinished);
  });
});

test('M687-3 a stale main character elsewhere record is removed without requiring an arrival in the final paragraph', async () => {
  const id = await tale('m687-mc-seat');
  const state = await loadState(id); state.offscreen.Jugram = { location: 'the palace salle', activity: 'dueling' }; await saveState(id, state);
  await wire(() => ({ issues: [issue('The main character cannot be elsewhere.', { type: 'offscreen.clear', name: 'Jugram' })] }), async () => {
    const result = await auditLedger({ connection, storyId: id });
    assert(!(await loadState(id)).offscreen.Jugram, 'the corrupt old main character seat is cleared');
    assert(!result.unfinished);
  });
});

test('M687-4 an already cleared elsewhere note is satisfied work rather than a permanent missing-seat refusal', async () => {
  const id = await tale('m687-already-clear', { mutations: [{ type: 'presence.enter', name: 'Kelstrum' }] });
  await wire(() => ({ issues: [issue('Kelstrum should not be elsewhere.', { type: 'offscreen.clear', name: 'Kelstrum' })] }), async () => {
    const result = await auditLedger({ connection, storyId: id });
    assert(!result.unfinished && !result.pending.length, 'no phantom repair remains when the note is already absent');
  });
});

test('M687-5 source recovery does not recreate a titled identity that the auditor already merged into its established name', async () => {
  const quote = 'Lord Marshal Kelstrum is the Marshal of Ilvarren.';
  const id = await tale('m687-merged-source', { input: quote, page: 'Kelstrum watches Jugram.', mutations: [
    { type: 'people.set', name: 'Lord Marshal Kelstrum', field: 'core', text: quote },
    { type: 'people.rename', from: 'Lord Marshal Kelstrum', to: 'Kelstrum', source: 'auditor', shown: quote },
  ] });
  let sources = 0;
  await wire((body) => {
    if (sent(body).includes('SOURCE PEOPLE REVIEW')) {
      sources++; const docs = JSON.parse(sent(body).split('SOURCE DOCUMENTS\n')[1]); const source = docs.find((d) => d.text.includes(quote));
      return { checked: docs.map((d) => d.id), people: [{ name: 'Lord Marshal Kelstrum', source: source.id, shown: quote }] };
    }
    return { issues: [] };
  }, async () => {
    for (let i = 0; i < 3; i++) {
      const result = await auditLedger({ connection, storyId: id, reviewSources: 'all' });
      assert(!(await loadState(id)).characters['Lord Marshal Kelstrum'], 'old source name does not recreate the merged page');
      eq(result.applied.filter((a) => a.mutation.sourceRecovery).length, 0, 'no repeated restoration');
      assert(!result.unfinished);
    }
    eq(sources, 1, 'source receipts still avoid repeated provider readings');
  });
});

test('M687-6 reworded reports of the same rejected target do not grow the saved repair backlog', async () => {
  const id = await tale('m687-duplicates');
  await wire((body, count) => ({ issues: [issue('Alexia missing, wording ' + count, { type: 'unknown.presence', name: 'Princess Alexia' })] }), async () => {
    for (let i = 0; i < 4; i++) await auditLedger({ connection, storyId: id });
    const state = await loadState(id);
    eq(state.audit.unresolved.length, 1, 'one repair target stays one saved concern across wording changes');
    assert(state.audit.unfinished, 'deduplication never hides an unresolved repair');
  });
});

test('M687-7 a successful alternate presence operation clears saved enter and update findings for the same arrival', async () => {
  const id = await tale('m687-alternate-repair', { page: 'Princess Alexia sits beside Jugram.' });
  const state = await loadState(id); state.audit = { unresolved: [
    { what: 'Alexia is missing.', pendingReason: 'blocked', mutations: [{ type: 'presence.enter', name: 'Princess Alexia' }] },
    { what: 'Her seat could not be updated.', pendingReason: 'blocked', mutations: [{ type: 'presence.update', name: 'Princess Alexia', position: 'beside Jugram' }] },
  ], unfinished: true, pending: ['old failed arrival'] }; await saveState(id, state);
  await wire(() => ({ issues: [issue('Restore her arrival.', { type: 'presence.enter', name: 'Princess Alexia', position: 'beside Jugram' })] }), async () => {
    const result = await auditLedger({ connection, storyId: id });
    assert(!result.unfinished, 'actual saved presence and position settle both older proposals');
  });
});

test('M687-8 a proposal about an early pose cannot overwrite a later change for that same person', async () => {
  const later = 'Kerroc stood and opened the ledger again at the rail.';
  const id = await tale('m687-later-pose', { page: PAGE.replace(CORVEN, CORVEN + '\n\n' + later), mutations: [{ type: 'presence.enter', name: 'Kerroc', position: 'at the rail, ledger open again' }] });
  await wire(() => ({ issues: [issue('The early closed ledger pose.', { type: 'presence.update', name: 'Kerroc', position: 'on his witness stool, ledger shut on his knees', shown: KERROC })] }), async () => {
    await auditLedger({ connection, storyId: id });
    eq((await loadState(id)).present.find((p) => p.name === 'Kerroc').position, 'at the rail, ledger open again', 'later action wins');
  });
});

test('M687-9 old merges from M686 are followed without recreating their source identity', async () => {
  const quote = 'Lord Marshal Kelstrum is the Marshal of Ilvarren.';
  const id = await tale('m687-old-alias', { input: quote, page: 'Kelstrum watches Jugram.', mutations: [
    { type: 'people.set', name: 'Lord Marshal Kelstrum', field: 'core', text: quote },
    { type: 'people.rename', from: 'Lord Marshal Kelstrum', to: 'Kelstrum' },
  ] });
  const state = await loadState(id); delete state.characters.Kelstrum.aliases;
  state.audit = { unfinished: true, unresolved: [{ what: 'The old titled page is a duplicate.', pendingReason: 'blocked', mutations: [{ type: 'people.rename', from: 'Lord Marshal Kelstrum', to: 'Kelstrum' }] }] };
  await saveState(id, state);
  await wire((body) => {
    if (!sent(body).includes('SOURCE PEOPLE REVIEW')) return { issues: [] };
    const docs = JSON.parse(sent(body).split('SOURCE DOCUMENTS\n')[1]); const source = docs.find((d) => d.text.includes(quote));
    return { checked: docs.map((d) => d.id), people: [{ name: 'Lord Marshal Kelstrum', source: source.id, shown: quote }] };
  }, async () => {
    await auditLedger({ connection, storyId: id, reviewSources: 'all' });
    const after = await loadState(id); assert(!after.characters['Lord Marshal Kelstrum'], 'the previous release merge remains respected');
    assert(!after.audit.unfinished, 'the completed old merge also closes its saved finding');
    after.journal = []; await saveState(id, after);
    await auditLedger({ connection, storyId: id, reviewSources: 'all' });
    assert(!(await loadState(id)).characters['Lord Marshal Kelstrum'], 'the source receipt retains the merge when the old journal ages out');
  });
});

test('M687-10 an explicitly named role merges through the auditor without losing its knowledge or undo', async () => {
  const quote = 'Kelstrum, the marshal of Ilvarren, watched Jugram on the raked ground.';
  const id = await tale('m687-role-merge', { page: quote, mutations: [
    { type: 'people.set', name: 'the marshal', field: 'core', text: 'Marshal of Ilvarren.' },
    { type: 'knowledge.add', name: 'the marshal', fact: 'He knows the agreed rules of the bout.' },
  ] });
  await wire(() => ({ issues: [issue('The marshal and Kelstrum are one man.', { type: 'people.rename', from: 'the marshal', to: 'Kelstrum' })] }), async () => {
    const result = await auditLedger({ connection, storyId: id }); const state = await loadState(id);
    assert(!state.characters['the marshal'] && state.characters.Kelstrum, 'the source apposition supports the merge');
    assert(state.knowledge.Kelstrum?.length, 'the role knowledge remains');
    assert(!result.unfinished, 'the merge settles');
    const undo = undoLast(state);
    assert(undo.state.characters['the marshal'], 'the complete merge can still be taken back');
    assert(!undo.state.characters.Kelstrum.aliases?.includes('the marshal'), 'undo also removes the new alias');
  });
});

test('M687-11 knowing two marshals prevents a guessed role merge', async () => {
  const page = 'Kelstrum, the marshal of Ilvarren, met Lorian, the marshal of the coast.';
  const id = await tale('m687-ambiguous-marshal', { page, mutations: [
    { type: 'people.set', name: 'Kelstrum', field: 'core', text: 'Marshal of Ilvarren.' },
    { type: 'people.set', name: 'Lorian', field: 'core', text: 'Marshal of the coast.' },
    { type: 'people.set', name: 'the marshal', field: 'core', text: 'An unresolved marshal identity.' },
  ] });
  await wire(() => ({ issues: [issue('A proposed role merge.', { type: 'people.rename', from: 'the marshal', to: 'Kelstrum' })] }), async () => {
    await auditLedger({ connection, storyId: id });
    assert((await loadState(id)).characters['the marshal'], 'ambiguous identity is preserved');
  });
});

test('M687-12 evidence for a gallery arrival never overrides a later departure, a death or a scene move', async () => {
  for (const [label, page, mutations, extra] of [
    ['departure', PAGE.replace(COMMODUS, "Princess Alexia left the salle and returned to her rooms.\n\n" + COMMODUS), [], {}],
    ['death', PAGE, [{ type: 'offscreen.set', name: 'Princess Alexia', location: 'dead, buried in the royal crypt' }], {}],
    ['move', PAGE.replace(END, 'Jugram turned and walked away down the passage to the council room.'), [{ type: 'offscreen.set', name: 'Princess Alexia', location: 'the palace salle gallery' }], { groundWas: { page: 0, name: 'the palace salle' } }],
  ]) {
    const id = await tale('m687-guard-' + label, { page, mutations, extra });
    await wire(() => ({ issues: [issue('Earlier gallery arrival.', { type: 'presence.enter', name: 'Princess Alexia', position: 'third row of the gallery', shown: ALEXIA })] }), async () => {
      await auditLedger({ connection, storyId: id });
      assert(!(await loadState(id)).present.some((p) => p.name === 'Princess Alexia'), label + ' is never undone');
    });
  }
});

test('M687-13 saved findings close after another worker completed the repair, even if the next auditor answer is empty', async () => {
  const id = await tale('m687-other-reader', { page: 'Princess Alexia sits beside Jugram.', mutations: [{ type: 'presence.enter', name: 'Princess Alexia', position: 'beside Jugram' }] });
  const state = await loadState(id); state.audit = { unfinished: true, pending: ['Old arrival failed.'], unresolved: [
    { what: 'Old arrival failed.', pendingReason: 'blocked', mutations: [{ type: 'presence.enter', name: 'Princess Alexia' }] },
    { what: 'Old seat update failed.', pendingReason: 'blocked', mutations: [{ type: 'presence.update', name: 'Princess Alexia', position: 'beside Jugram' }] },
    { what: 'Old elsewhere clear failed.', pendingReason: 'blocked', mutations: [{ type: 'offscreen.clear', name: 'Princess Alexia' }] },
  ] }; await saveState(id, state);
  await wire(() => ({ issues: [] }), async (calls) => {
    const result = await auditLedger({ connection, storyId: id });
    assert(!result.unfinished && !result.pending.length, 'the saved successful repair closes all three old findings');
    eq(calls.length, 1, 'no pointless repair followup');
  });
});

test('M687-14 a dress correction cannot close an unrelated blocked posture repair', async () => {
  const page = 'Kerroc wears a blue cloak and sits by the rail.';
  const id = await tale('m687-fields', { page, mutations: [{ type: 'presence.enter', name: 'Kerroc', position: 'on the witness stool', attire: 'red cloak' }] });
  const state = await loadState(id); state.audit = { unfinished: true, unresolved: [
    { what: 'Kerroc has a wrong posture.', pendingReason: 'blocked', mutations: [{ type: 'presence.update', name: 'Kerroc', position: 'by the rail' }] },
  ] }; await saveState(id, state);
  await wire(() => ({ issues: [issue('His cloak is blue.', { type: 'presence.update', name: 'Kerroc', attire: 'blue cloak', shown: page })] }), async () => {
    const result = await auditLedger({ connection, storyId: id });
    assert(result.unfinished && result.pending.some((p) => p.includes('posture')), 'unrelated field repair cannot erase the uncorrected posture');
  });
});

test('M687-15 an earlier named pose does not override a later pronoun continuation', async () => {
  const early = 'Kerroc sat at the rail with the ledger open.';
  const page = '[the palace salle, Ilvarren | 10:00]\n\n' + early + ' He moved to the witness stool and shut the ledger on his knees.\n\n' + END;
  const id = await tale('m687-pronoun-posture', { page, mutations: [{ type: 'presence.enter', name: 'Kerroc', position: 'the witness stool, ledger shut on his knees' }] });
  await wire(() => ({ issues: [issue('An outdated posture.', { type: 'presence.update', name: 'Kerroc', position: 'at the rail with the ledger open', shown: early })] }), async () => {
    await auditLedger({ connection, storyId: id });
    eq((await loadState(id)).present.find((p) => p.name === 'Kerroc').position, 'the witness stool, ledger shut on his knees', 'the later pose remains');
  });
});

test('M687-16 compacting repeated reports retains distinct posture and attire repairs', async () => {
  const id = await tale('m687-separate-fields', { mutations: [{ type: 'presence.enter', name: 'Kerroc', position: 'the witness stool', attire: 'red cloak' }] });
  const state = await loadState(id); state.audit = { unfinished: true, unresolved: [
    { what: 'His posture needs repair.', pendingReason: 'blocked', mutations: [{ type: 'presence.update', name: 'Kerroc', position: 'at the rail' }] },
    { what: 'His attire needs repair.', pendingReason: 'blocked', mutations: [{ type: 'presence.update', name: 'Kerroc', attire: 'blue cloak' }] },
  ] }; await saveState(id, state);
  await wire(() => ({ issues: [] }), async () => {
    await auditLedger({ connection, storyId: id });
    eq((await loadState(id)).audit.unresolved.length, 2, 'both genuinely separate fields stay visible');
  });
});
