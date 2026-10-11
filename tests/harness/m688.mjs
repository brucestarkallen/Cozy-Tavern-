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

const arrival = "Princess Alexia came in through the side gallery and sat in the third row, her woman settling two seats behind with the expression of someone who had not been consulted.";
const watching = "In the third row of the gallery, Alexia's hooked ankle had come down off the other knee. She was leaning forward now, gloves folded under her chin.";
const newPage = '[the palace salle, Ilvarren | 10:00 | cold | wool gambeson | backed to the cold stone of the salle wall]\n\n' + [arrival, COMMODUS, KERROC, CORVEN, watching, END].join('\n\n');
const absent = [{ type: 'offscreen.set', name: 'Princess Alexia', location: 'the palace salle gallery', activity: 'watching the bout' }];
const room = { roomAt: { page: 0, names: ['Jugram', 'Kelstrum', 'Kerroc', 'Corven', 'Garett'] } };
async function checkRepair(id, mutation, verify, what = 'Correct this entry from the story page.') {
  await wire(() => ({ issues: [issue(what, mutation)] }), async () => {
    const result = await auditLedger({ connection, storyId: id });
    await verify(await loadState(id), result);
  });
}

test('M688-1 the reported ankle and pronoun quote restores Alexia to the gallery', async () => {
  const id = await tale('m688-ankle', { page: newPage, mutations: absent, extra: room });
  await checkRepair(id, { type: 'presence.enter', name: 'Princess Alexia', position: 'third row of the gallery', shown: watching }, (state, result) => {
    assert(state.present.some((p) => p.name === 'Princess Alexia'), 'Alexia is in the scene');
    assert(!state.offscreen['Princess Alexia'], 'her stale absent entry is cleared');
    assert(!result.unfinished, 'the actual supported quote completes');
  });
});

test('M688-2 an exact earlier arrival remains evidence of presence after a later seated pose', async () => {
  const page = newPage.replace(watching, 'Alexia leaned forward in the third row, gloves folded under her chin.');
  const id = await tale('m688-arrival-and-pose', { page, mutations: absent, extra: room });
  await checkRepair(id, { type: 'presence.enter', name: 'Princess Alexia', shown: arrival }, (state, result) => {
    assert(state.present.some((p) => p.name === 'Princess Alexia'), 'a later pose does not undo her arrival');
    assert(!result.unfinished);
  });
});

test('M688-3 a named gallery spectator has current page evidence when the model omits shown', async () => {
  const id = await tale('m688-named-no-shown', { page: newPage, mutations: absent, extra: room });
  await checkRepair(id, { type: 'presence.enter', name: 'Princess Alexia', position: 'third row of the gallery' }, (state, result) => {
    assert(state.present.some((p) => p.name === 'Princess Alexia'), 'the page supplies her own named evidence');
    assert(!result.unfinished);
  });
});

test('M688-4 the documented presence update form validates against the person latest evidence without shown', async () => {
  const id = await tale('m688-posture-no-shown', { mutations: [{ type: 'presence.enter', name: 'Kerroc', position: 'on the witness stool, pencil moving on the margin' }] });
  await checkRepair(id, { type: 'presence.update', name: 'Kerroc', position: 'on his witness stool, ledger shut on his knees' }, (state, result) => {
    assert(state.present.find((p) => p.name === 'Kerroc').position.includes('ledger shut'), 'the latest supported posture lands');
    assert(!result.unfinished);
  });
});

test('M688-5 recovering named evidence still refuses a later departure and a quoted conversation', async () => {
  for (const page of [newPage + '\n\nPrincess Alexia left the salle for her chambers.', '[the palace salle, Ilvarren | 10:00]\n\nJugram said, "Princess Alexia is watching from the gallery."\n\n' + END]) {
    const id = await tale('m688-leave-or-talk', { page, mutations: absent, extra: room });
    await checkRepair(id, { type: 'presence.enter', name: 'Princess Alexia', position: 'third row of the gallery' }, (state) => {
      assert(!state.present.some((p) => p.name === 'Princess Alexia'), 'a departure or a mention in speech cannot restore her');
    });
  }
});

test('M688-6 deriving current evidence never restores an earlier posture over a later pronoun move', async () => {
  const page = '[the palace salle, Ilvarren | 10:00]\n\nKerroc sat on his witness stool with the ledger shut on his knees. He then stood at the rail with the ledger open again.\n\n' + END;
  const id = await tale('m688-late-pronoun', { page, mutations: [{ type: 'presence.enter', name: 'Kerroc', position: 'at the rail with the ledger open again' }] });
  await checkRepair(id, { type: 'presence.update', name: 'Kerroc', position: 'on his witness stool, ledger shut on his knees' }, (state) => {
    assert(state.present.find((p) => p.name === 'Kerroc').position.includes('rail'), 'the later current pose is retained');
  });
});

test('M688-7 an exact writer established MC persona quote clears only its false elsewhere seat', async () => {
  for (const persona of ["Jugram is Azrael's own worn persona.", "Jugram is my MC's other persona.", "My MC's other persona is Jugram."]) {
  const id = await tale('m688-persona', { page: newPage.replaceAll('Jugram', 'Azrael') });
  const state = await loadState(id);
  state.sheet.playerName = 'Azrael'; state.present = state.present.map((p) => p.name === 'Jugram' ? { ...p, name: 'Azrael' } : p);
  state.offscreen.Jugram = { location: 'the palace salle', activity: 'dueling' };
  await saveState(id, state);
  const old = globalThis.fetch;
  try {
    await wire(() => ({ issues: [issue('The MC persona cannot occupy another seat.', { type: 'offscreen.clear', name: 'Jugram', shown: persona })] }), async () => {
      const result = await auditLedger({ connection, storyId: id, brief: persona });
      const after = await loadState(id);
      assert(!after.offscreen.Jugram, 'the false persona seat clears');
      eq(after.sheet.playerName, 'Azrael', 'the main character is not renamed');
      eq(after.present.map((p) => p.name).join(','), 'Azrael', 'no separate persona is walked in');
      assert(!result.unfinished, 'the quoted identity repair settles');
    });
  } finally { globalThis.fetch = old; }
  }
});

test('M688-8 an unrelated person or a hoped for persona cannot lose their seat on the MC identity rule', async () => {
  for (const text of ["Jugram is Azrael's opponent.", 'Azrael hopes to wear a Jugram persona.', "Jugram is not Azrael's persona.", "Jugram is Azrael's brother and wears a different persona.", "Jugram is Azrael's own persona's brother.", "My other persona is Jugram's brother.", "Jugram is Azrael's persona no longer."]) {
    const id = await tale('m688-not-persona', { page: '[the palace salle, Ilvarren | 10:00]\n\nAzrael fenced in the salle.' });
    const state = await loadState(id); state.sheet.playerName = 'Azrael'; state.present = [{ name: 'Azrael' }];
    state.offscreen.Jugram = { location: 'the north barracks', activity: 'resting' }; await saveState(id, state);
    await wire(() => ({ issues: [issue('A guessed persona.', { type: 'offscreen.clear', name: 'Jugram', shown: text })] }), async () => {
      await auditLedger({ connection, storyId: id, brief: text });
      assert((await loadState(id)).offscreen.Jugram, 'the real other person remains elsewhere');
    });
  }
});

test('M688-9 a finding quotation supplies scene evidence without requiring it twice in JSON', async () => {
  const id = await tale('m688-finding-quote', { page: newPage, mutations: [{ type: 'offscreen.set', name: 'Commodus', location: 'the palace salle rail' }], extra: room });
  await checkRepair(id, { type: 'presence.enter', name: 'Commodus', position: 'at the rail beside Garett' }, (state, result) => {
    assert(state.present.some((p) => p.name === 'Commodus'), 'the exact quotation in the finding supports his presence');
    assert(!result.unfinished);
  }, "Commodus is at the salle rail: '" + COMMODUS + "'");
});

test('M688-10 a quotation about someone else cannot establish an unshown person', async () => {
  const id = await tale('m688-other-person-quote', { page: newPage, mutations: [{ type: 'people.set', name: 'Prince Caelan', field: 'core', text: 'The prince at his own castle.' }, { type: 'offscreen.set', name: 'Prince Caelan', location: 'his own castle' }], extra: room });
  await checkRepair(id, { type: 'presence.enter', name: 'Prince Caelan', position: 'at the rail beside Garett' }, (state) => {
    assert(!state.present.some((p) => p.name === 'Prince Caelan'), 'another person quotation is not his presence');
  }, "Caelan is supposedly here: '" + COMMODUS + "'");
});

test('M688-11 the singular maid continuation repairs a legacy plural role posture from the reported broom passage', async () => {
  const early = 'The salle-maids stopped her sweeping to watch, broom held still, shhk, against the flags.';
  const late = "The maid's broom lay forgotten against the wall. The nearer maid had gone still watching the bout.";
  const page = '[the palace salle, Ilvarren | 10:00]\n\n' + early + '\n\n' + late + '\n\n' + END;
  const id = await tale('m688-maid', { page, mutations: [{ type: 'people.set', name: 'salle-maids', field: 'core', text: 'The salle maid who tends the flags and broom.' }, { type: 'presence.enter', name: 'salle-maids', position: 'against the flags, broom held still' }] });
  await checkRepair(id, { type: 'presence.update', name: 'salle-maids', position: 'broom abandoned upright against the wall, nearer maid gone still watching', shown: late }, (state, result) => {
    assert(state.present.find((p) => p.name === 'salle-maids').position.includes('gone still'), 'the current maid posture replaces held broom: ' + JSON.stringify({ present: state.present, rejected: result.rejected }));
    assert(!result.unfinished, JSON.stringify(result.pending));
  });
});

test('M688-12 a later incidental mention toward Garett does not erase his own latest folded arms posture', async () => {
  const garett = 'Garett stood at the rail, wrapped in fur, arms folded beside Commodus.';
  const page = '[the palace salle, Ilvarren | 10:00]\n\n' + garett + '\n\n' + COMMODUS + '\n\n' + END;
  const id = await tale('m688-garett', { page, mutations: [{ type: 'presence.enter', name: 'Garett', position: 'at the rail, wrapped in fur' }] });
  await checkRepair(id, { type: 'presence.update', name: 'Garett', position: 'at the rail, wrapped in fur, arms folded beside Commodus', shown: garett }, (state, result) => {
    assert(state.present.find((p) => p.name === 'Garett').position.includes('arms folded'), 'his own pose remains supported');
    assert(!result.unfinished);
  });
});

test('M688-13 typographic apostrophes in a copied scene quotation do not change its evidence', async () => {
  const id = await tale('m688-apostrophe', { page: newPage, mutations: absent, extra: room });
  await checkRepair(id, { type: 'presence.enter', name: 'Princess Alexia', position: 'third row of the gallery', shown: watching.replaceAll("'", '’') }, (state, result) => {
    assert(state.present.some((p) => p.name === 'Princess Alexia'), 'the same source words establish presence');
    assert(!result.unfinished);
  });
});

test('M688-14 a role shared by two distinct maid records is not guessed from a singular mention', async () => {
  const late = "The maid's broom lay forgotten against the wall. The nearer maid had gone still watching the bout.";
  const id = await tale('m688-two-maids', { page: '[the palace salle, Ilvarren | 10:00]\n\n' + late + '\n\n' + END, mutations: [{ type: 'presence.enter', name: 'salle-maids', position: 'against the flags, broom held still' }, { type: 'people.set', name: 'the kitchen maid', field: 'core', text: 'A different maid from the kitchens.' }] });
  await checkRepair(id, { type: 'presence.update', name: 'salle-maids', position: 'broom abandoned upright against the wall, nearer maid gone still watching', shown: late }, (state) => {
    eq(state.present.find((p) => p.name === 'salle-maids').position, 'against the flags, broom held still', 'ambiguous role ownership is preserved');
  });
});

test('M688-15 the reported old persona finding with no mutation closes after the actual seat repair', async () => {
  const persona = "Jugram is Azrael's own worn persona.";
  const id = await tale('m688-old-persona-finding', { page: newPage.replaceAll('Jugram', 'Azrael') });
  const state = await loadState(id); state.sheet.playerName = 'Azrael'; state.present = [{ name: 'Azrael' }];
  state.offscreen.Jugram = { location: 'the palace salle', activity: 'dueling' };
  state.audit = { unfinished: true, unresolved: [{ what: "Jugram is seated among the absent as though he were away from the salle, but Jugram is Azrael's own persona and the man on the raked ground is Azrael himself; the persona does not take a separate seat while worn.", pendingReason: 'no repair was supplied', mutations: [] }] };
  await saveState(id, state);
  await wire(() => ({ issues: [issue('Clear the false persona seat.', { type: 'offscreen.clear', name: 'Jugram', shown: persona })] }), async () => {
    const result = await auditLedger({ connection, storyId: id, brief: persona });
    assert(!(await loadState(id)).offscreen.Jugram, 'the actual seat clears');
    assert(!result.unfinished, 'the old seat concern does not linger after the real repair: ' + JSON.stringify(result.pending));
  });
});

test('M688-16 a seat repair does not close a different old identity concern without a supplied repair', async () => {
  const persona = "Jugram is Azrael's own worn persona.";
  const id = await tale('m688-different-old-finding', { page: newPage.replaceAll('Jugram', 'Azrael') });
  const state = await loadState(id); state.sheet.playerName = 'Azrael'; state.present = [{ name: 'Azrael' }];
  state.offscreen.Jugram = { location: 'the palace salle', activity: 'dueling' };
  state.audit = { unfinished: true, unresolved: [{ what: "Jugram has the wrong birthplace in the record.", pendingReason: 'no repair was supplied', mutations: [] }] };
  await saveState(id, state);
  await wire(() => ({ issues: [issue('Clear the false persona seat.', { type: 'offscreen.clear', name: 'Jugram', shown: persona })] }), async () => {
    const result = await auditLedger({ connection, storyId: id, brief: persona });
    assert(result.unfinished && result.pending.some((p) => p.includes('birthplace')), 'the different durable concern remains');
  });
});

test('M688-17 a quote containing both poses cannot overwrite the saved later pronoun pose with its earlier half', async () => {
  const quote = 'Kerroc sat on his witness stool with the ledger shut on his knees. He then stood at the rail with the ledger open again.';
  const id = await tale('m688-whole-pose-quote', { page: '[the palace salle, Ilvarren | 10:00]\n\n' + quote + '\n\n' + END, mutations: [{ type: 'presence.enter', name: 'Kerroc', position: 'at the rail with the ledger open again' }] });
  await checkRepair(id, { type: 'presence.update', name: 'Kerroc', position: 'on his witness stool, ledger shut on his knees', shown: quote }, (state) => {
    assert(state.present.find((p) => p.name === 'Kerroc').position.includes('rail'), 'the later field remains');
  });
});

test('M688-18 the exact her woman fragment restores the established companion without renaming her', async () => {
  const id = await tale('m688-woman-fragment', { page: newPage, extra: room });
  const shown = 'her woman settling two seats behind with the expression of someone who had not been consulted';
  await checkRepair(id, { type: 'presence.enter', name: "Alexia's woman", position: 'two seats behind Alexia', shown }, (state, result) => {
    assert(state.present.some((p) => p.name === "Alexia's woman"), 'the existing companion identity is restored');
    assert(!result.unfinished, JSON.stringify(result.pending));
  });
});

test('M688-19 an old presence finding follows a completed marshal merge to the actual canonical seat', async () => {
  const identity = 'Kelstrum, the marshal of Ilvarren, stood in the middle of the raked ground.';
  const id = await tale('m688-merged-seat-finding', { page: '[the palace salle, Ilvarren | 10:00]\n\n' + identity, mutations: [
    { type: 'people.set', name: 'the marshal', field: 'core', text: 'Marshal of Ilvarren.' },
    { type: 'presence.enter', name: 'the marshal', position: 'the middle of the raked ground' },
    { type: 'presence.enter', name: 'Kelstrum', position: 'the middle of the raked ground' },
  ] });
  const state = await loadState(id);
  state.audit = { unfinished: true, unresolved: [{ what: 'The marshal has a duplicate seat.', pendingReason: 'blocked', mutations: [{ type: 'presence.update', name: 'the marshal', position: 'the middle of the raked ground' }] }] };
  await saveState(id, state);
  await checkRepair(id, { type: 'people.rename', from: 'the marshal', to: 'Kelstrum', shown: identity }, (after, result) => {
    assert(!after.present.some((p) => p.name === 'the marshal'), 'the duplicate seat actually merged');
    assert(after.present.some((p) => p.name === 'Kelstrum'), 'the canonical seat remains');
    assert(!result.unfinished, 'the old alias finding sees the actual merged seat: ' + JSON.stringify(result.pending));
  });
});

test('M688-20 malformed model names are reported without crashing the audit or changing the real posture', async () => {
  for (const name of [42, { who: 'Kerroc' }]) {
    const id = await tale('m688-malformed-name', { mutations: [{ type: 'presence.enter', name: 'Kerroc', position: 'on his witness stool, ledger shut on his knees' }] });
    await checkRepair(id, { type: 'presence.update', name, position: 'at the rail', shown: KERROC }, (state, result) => {
      eq(state.present.find((p) => p.name === 'Kerroc').position, 'on his witness stool, ledger shut on his knees', 'the real entry is preserved');
      assert(result.unfinished && result.rejected.length, 'the malformed proposal is reported for correction');
    });
  }
});

test('M688-21 another person arrival in the same quotation cannot move a watcher out of her established elsewhere room', async () => {
  const quote = 'Kiyone watched from the corridor as Renji came in.';
  const id = await tale('m688-other-arrival', { page: '[the palace salle, Ilvarren | 10:00]\n\n' + quote + '\n\n' + END, mutations: [
    { type: 'people.set', name: 'Kiyone Kotetsu', field: 'core', text: 'An established watcher.' },
    { type: 'people.set', name: 'Renji Abarai', field: 'core', text: 'The man who enters.' },
    { type: 'offscreen.set', name: 'Kiyone Kotetsu', location: 'the north barracks corridor', activity: 'watching from outside' },
  ], extra: room });
  await checkRepair(id, { type: 'presence.enter', name: 'Kiyone Kotetsu', shown: quote }, (state) => {
    assert(!state.present.some((p) => p.name === 'Kiyone Kotetsu') && state.offscreen['Kiyone Kotetsu'], 'Renji arrival is not Kiyone arrival');
  });
});

test('M688-22 a qualified People name uses its own current state quote before an incidental mention', async () => {
  const shown = 'Garett stood at the rail, wrapped in fur, arms folded beside Commodus.';
  const id = await tale('m688-qualified-state', { page: '[the palace salle, Ilvarren | 10:00]\n\n' + shown + '\n\n' + COMMODUS + '\n\n' + END, mutations: [
    { type: 'people.rename', from: 'Garett', to: 'Lord Garett' },
    { type: 'presence.enter', name: 'Lord Garett', position: 'at the rail' },
    { type: 'people.set', name: 'Lord Garett', field: 'state', text: 'Resting elsewhere.' },
  ] });
  await checkRepair(id, { type: 'people.set', name: 'Lord Garett', field: 'state', text: shown, shown }, (state, result) => {
    eq(state.characters['Lord Garett'].state, shown, 'the current source-backed now lands under the existing identity: ' + JSON.stringify({ pending: result.pending, rejected: result.rejected }));
    assert(!state.characters.Garett, 'the correction keeps the established qualified identity');
    assert(!result.unfinished, JSON.stringify(result.pending));
  });
});

test('M688-23 a whole quote with an earlier state cannot overwrite the saved later pronoun state', async () => {
  const early = 'Kerroc sat on his witness stool with the ledger shut on his knees.';
  const late = 'He then stood at the rail with the ledger open again.';
  const id = await tale('m688-later-state', { page: '[the palace salle, Ilvarren | 10:00]\n\n' + early + ' ' + late + '\n\n' + END, mutations: [
    { type: 'presence.enter', name: 'Kerroc', position: 'at the rail with the ledger open again' },
    { type: 'people.set', name: 'Kerroc', field: 'state', text: late },
  ] });
  await checkRepair(id, { type: 'people.set', name: 'Kerroc', field: 'state', text: early, shown: early + ' ' + late }, (state) => {
    eq(state.characters.Kerroc.state, late, 'the saved later current state remains');
  });
});
