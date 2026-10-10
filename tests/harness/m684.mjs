import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { applyMutations, undoEntry } from '../../js/engine/apply.js';
import { extractTurn } from '../../js/agents/extractor.js';
import { auditLedger, auditLineWords } from '../../js/agents/auditor.js';
import { worldTurn } from '../../js/agents/world.js';
import { seatAgeWords } from '../../js/engine/offscreen.js';

const connection = { type: 'openai', baseUrl: 'https://custom.example/v1', apiKey: 'fixture', model: 'm', preset: 'custom', context: 64000 };
async function wire(answer, fn) {
  const old = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    const reply = typeof answer === 'function' ? await answer(body, calls.length) : answer;
    const text = typeof reply === 'string' ? reply : JSON.stringify(reply);
    if (body.stream) return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    return new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
  };
  try { return await fn(calls); } finally { globalThis.fetch = old; }
}
const base = () => applyMutations({ ...emptyState(), page: 0, clock: { minutes: 600 } }, [
  { type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'the palace salon' }, { type: 'presence.enter', name: 'Jovan' },
]).state;
const reader = (state, userText, assistantText, reply) => wire({ mutations: [{ type: 'mode.snapshot', flags: ['group'] }], ...reply }, () => extractTurn({ connection, state, userText, assistantText, founding: false }));

test('M684-1 the writer introduces nearby people and a pronoun-only reply does not erase the room board', async () => {
  const state = base();
  const r = await reader(state, 'Princess Alexia and Prince Caelan stand beside me in the salon. I greet them.', 'She smiles while her brother pulls out a chair.', { here: ['Jovan', 'Princess Alexia', 'Prince Caelan'] });
  const next = applyMutations(state, r.mutations).state;
  assert(next.present.some((p) => p.name === 'Princess Alexia'), 'Alexia is here from the writer’s scene');
  assert(next.present.some((p) => p.name === 'Prince Caelan'), 'Caelan is here too');
});

test('M684-2 explicit introductions make People pages without invented surnames or ranks', async () => {
  const state = base(); const quote = 'Prince Caelan is the Third Prince and lives at the northern estate.';
  const r = await reader(state, quote, 'The conversation turns to the weather.', { people: [{ name: 'Prince Caelan', shown: quote }] });
  const next = applyMutations(state, r.mutations).state;
  assert(next.characters['Prince Caelan']?.core.includes('Third Prince'), 'the writer’s exact identity is kept even while absent');
  assert(!next.present.some((p) => p.name === 'Prince Caelan'), 'a biography does not place someone nearby');
});

test('M684-3 a seated person introduced here in the writer input is allowed back, but a departure in the reply wins', async () => {
  const state = applyMutations(base(), [{ type: 'offscreen.set', name: 'Princess Alexia', location: 'the north tower', activity: 'reading' }]).state;
  const input = 'Princess Alexia walks into the salon and stands beside me.';
  const yes = await reader(state, input, 'She takes the offered chair.', { here: ['Jovan', 'Princess Alexia'] });
  assert(applyMutations(state, yes.mutations).state.present.some((p) => p.name === 'Princess Alexia'), 'her old seat cannot overrule the writer');
  const no = await reader(state, input, 'Princess Alexia leaves the salon and goes back to the north tower.', { here: ['Jovan', 'Princess Alexia'] });
  assert(!applyMutations(state, no.mutations).state.present.some((p) => p.name === 'Princess Alexia'), 'the later departure still wins');
});

test('M684-4 introductions reject invented names and unquoted facts', async () => {
  const state = base(); const quote = 'Princess Alexia is the Second Princess.';
  const r = await reader(state, quote, 'She sits down.', { people: [{ name: 'Alexia Woman', shown: quote }, { name: 'Princess Alexia', shown: 'Princess Alexia is the Fourth Princess.' }] });
  eq(Object.keys(applyMutations(state, r.mutations).state.characters).length, 0, 'neither invented identity is stored');
});

async function auditFixture(id, issue) {
  await db.stories.create({ id, title: id });
  await db.messages.append(id, { id: id + 'u', role: 'user', text: 'Princess Alexia is the Second Princess. She stands beside Jovan in the salon.', ts: 1 });
  await db.messages.append(id, { id: id + 'a', role: 'assistant', text: 'Princess Alexia offers Jovan her hand.', ts: 2 });
  const state = applyMutations(base(), [
    { type: 'people.set', name: 'Alexia Woman', field: 'core', text: 'Fourth Princess; an accomplished diplomat.' },
    { type: 'presence.enter', name: 'Alexia Woman' },
    { type: 'knowledge.add', name: 'Alexia Woman', fact: 'The secret passage opens behind the tapestry.' },
    { type: 'rel.set', name: 'Alexia Woman', p: 20, cause: 'she helped Jovan escape' },
  ]).state;
  await saveState(id, state);
  const result = await wire({ issues: [issue] }, () => auditLedger({ connection, storyId: id, stale: () => false }));
  return { result, state: await loadState(id) };
}
test('M684-5 the actual auditor renames a mistaken identity and preserves her presence and knowledge', async () => {
  const { state } = await auditFixture('m684-rename', { what: 'Alexia Woman is Princess Alexia, the Second Princess.', fix: 'Correct her name and title.', mutations: [
    { type: 'people.rename', from: 'Alexia Woman', to: 'Princess Alexia', cause: 'the writer names her Princess Alexia' },
    { type: 'people.set', name: 'Princess Alexia', field: 'core', text: 'Second Princess; an accomplished diplomat.' },
  ] });
  assert(!state.characters['Alexia Woman'], 'wrong key is gone');
  assert(state.characters['Princess Alexia']?.core.includes('Second Princess'), 'right identity remains');
  assert(state.present.some((p) => p.name === 'Princess Alexia'), 'she did not disappear from the scene');
  assert(state.knowledge['Princess Alexia']?.some((f) => f.fact.includes('secret passage')), 'what she knew is preserved');
  eq(state.relationships['Princess Alexia']?.p, 20, 'her bond follows her');
});
test('M684-6 an auditor deletion cannot erase a source-backed person while claiming to correct her name', async () => {
  const { state, result } = await auditFixture('m684-forget', { what: 'Alexia Woman is a mistaken name for Princess Alexia.', fix: 'Use Princess Alexia.', mutations: [{ type: 'people.forget', name: 'Alexia Woman', cause: 'wrong name' }] });
  assert(state.characters['Alexia Woman'] || state.characters['Princess Alexia'], 'a name correction preserves the person');
  assert(result.issues.some((i) => i.refused?.length), 'a blocked deletion is explained');
});
test('M684-7 a partly rejected correction is never reported as entirely set right', () => {
  const line = auditLineWords({ what: 'Wrong identity and title', fix: 'Rename and correct title', landed: 1, refused: ['the name was not grounded in the pages'], fixable: true });
  assert(/part/i.test(line.text) && line.text.includes('the name was not grounded'), line.text);
});

test('M684-8 the world explicitly revisits an overdue seat, including a reasoned decision to stay', async () => {
  const id = 'm684-world'; const old = applyMutations(base(), [{ type: 'offscreen.set', name: 'Mira', location: 'the infirmary', activity: 'recovering from a broken leg' }]).state;
  await saveState(id, { ...old, page: 1, clock: { minutes: 1380 } });
  await wire({ mutations: [{ type: 'offscreen.confirm', name: 'Mira', cause: 'Her broken leg keeps her in bed through the night.' }], brief: { pressure: [], ripe: [], twb: null } }, () => worldTurn({ connection, storyId: id, userText: 'I wait until night.', assistantText: 'Night settles over the salon.', pageAt: 1 }));
  const state = await loadState(id);
  eq(state.offscreen.Mira.location, 'the infirmary');
  eq(seatAgeWords(state.offscreen.Mira, state.clock.minutes), '', 'a reviewed present decision is current');
  assert(state.log.some((l) => l.words.includes('broken leg keeps her')), 'the cause is visible in the change record');
  const back = undoEntry(state, state.log.findIndex((l) => l.words.includes('broken leg keeps her')));
  assert(back && seatAgeWords(back.state.offscreen.Mira, state.clock.minutes), 'undo restores the actual old freshness');
});
test('M684-9 a world answer omitting a stale person gets one targeted followup and reports an unresolved omission honestly', async () => {
  const id = 'm684-omission'; const old = applyMutations(base(), [{ type: 'offscreen.set', name: 'Mira', location: 'the infirmary', activity: 'resting' }]).state;
  await saveState(id, { ...old, page: 1, clock: { minutes: 1380 } });
  await wire({ mutations: [], brief: { pressure: [], ripe: [], twb: null } }, async (calls) => {
    const r = await worldTurn({ connection, storyId: id, userText: 'I wait.', assistantText: 'Night falls.', pageAt: 1 });
    eq(calls.length, 2, 'one bounded followup for the omitted person');
    assert(r.pending?.includes('Mira'), 'omission is reported');
    assert(seatAgeWords((await loadState(id)).offscreen.Mira, 1380), 'no false freshness stamp');
  });
});
test('M684-10 stale information describes a missed update, never invents a likely departure', () => {
  const words = seatAgeWords({ sinceMinutes: 600 }, 1380);
  assert(/13 hours/.test(words) && /story/.test(words) && !/likely elsewhere/.test(words), words);
});

test('M684-11 many quiet pages in the same room are not evidence that a companion left', async () => {
  const id = 'm684-quiet';
  const state = applyMutations(base(), [{ type: 'presence.enter', name: 'Mira' }, { type: 'people.set', name: 'Mira', field: 'core', text: 'Jovan’s sister and travelling companion.' }]).state;
  await saveState(id, state);
  await db.messages.append(id, { role: 'user', text: 'Mira takes a seat beside me in the palace salon.', ts: 1 });
  await db.messages.append(id, { role: 'assistant', text: 'Mira sits down in the salon.', ts: 2 });
  for (let n = 0; n < 5; n++) {
    await db.messages.append(id, { role: 'user', text: 'I continue reading my letter in the salon.', ts: n * 2 + 3 });
    await db.messages.append(id, { role: 'assistant', text: 'Jovan reads another paragraph. The fire burns quietly in the palace salon.', ts: n * 2 + 4 });
  }
  await wire({ issues: [{ what: 'Mira has not been mentioned recently.', mutations: [{ type: 'presence.leave', name: 'Mira' }] }] }, () => auditLedger({ connection, storyId: id }));
  assert((await loadState(id)).present.some((p) => p.name === 'Mira'), 'quiet company stays in the room');
});

test('M684-12 a duplicate identity merge keeps more than eight loose ends and updates the current room identity', () => {
  const state = applyMutations(base(), [{ type: 'people.set', name: 'Alexia Woman', field: 'core', text: 'A diplomat.' }]).state;
  state.characters['Princess Alexia'] = { ...state.characters['Alexia Woman'], core: 'Second Princess.', threads: [] }; // a legacy/imported duplicate, before names were unified
  state.characters['Alexia Woman'].threads = Array.from({ length: 10 }, (_, n) => 'Promise ' + n);
  state.characters['Princess Alexia'].threads = ['A separate promise'];
  state.roomAt = { page: 0, names: ['Jovan', 'Alexia Woman'] };
  const renamed = applyMutations(state, [{ type: 'people.rename', from: 'Alexia Woman', to: 'Princess Alexia' }]).state;
  eq(renamed.characters['Princess Alexia'].threads.length, 11, 'every open promise follows her');
  assert(renamed.roomAt.names.includes('Princess Alexia') && !renamed.roomAt.names.includes('Alexia Woman'), 'the scene reader’s identity follows too');
  const back = undoEntry(renamed, renamed.log.length - 1).state;
  eq(back.roomAt.names[1], 'Alexia Woman', 'undo restores the original room identity');
});

test('M684-13 a dead person is not revived by an erroneous room board', async () => {
  const state = applyMutations(base(), [{ type: 'offscreen.set', name: 'Mira', location: 'dead, in the family crypt', activity: 'buried' }]).state;
  const r = await reader(state, 'I recall Mira sitting beside me.', 'Mira had loved the fire in this room.', { here: ['Jovan', 'Mira'] });
  assert(!applyMutations(state, r.mutations).state.present.some((p) => p.name === 'Mira'), 'the board is not a resurrection');
});

test('M684-14 the writer’s physical departure is kept when the reply only uses her pronoun', async () => {
  const state = applyMutations(base(), [{ type: 'presence.enter', name: 'Mira' }]).state;
  const r = await reader(state, 'Mira leaves the salon and walks to the infirmary.', 'Her footsteps fade down the corridor.', { mutations: [{ type: 'mode.snapshot', flags: [] }, { type: 'presence.leave', name: 'Mira', to: 'the infirmary' }], here: ['Jovan'] });
  assert(!applyMutations(state, r.mutations).state.present.some((p) => p.name === 'Mira'), 'both sides of the turn count');
});

test('M684-15 an overdue journey cannot be rubber-stamped and a failed followup keeps the useful first decisions', async () => {
  const id = 'm684-world-wire';
  const old = applyMutations(base(), [{ type: 'offscreen.set', name: 'Mira', location: 'the north road', activity: 'riding', stance: 'toward', etaMinutes: 20 }, { type: 'offscreen.set', name: 'Nella', location: 'the inn', activity: 'sleeping' }]).state;
  const state = { ...old, clock: { minutes: 1380 } };
  eq(applyMutations(state, [{ type: 'offscreen.confirm', name: 'Mira', cause: 'still riding' }]).applied.length, 0, 'an overdue trip needs an actual decision');
  await saveState(id, state);
  await wire((body, n) => { if (n > 1) throw new Error('wire failed'); return { mutations: [{ type: 'offscreen.set', name: 'Nella', location: 'the market', activity: 'buying food', cause: 'She woke and went to buy breakfast.' }], brief: { pressure: [], ripe: [], twb: null } }; }, async () => {
    const result = await worldTurn({ connection, storyId: id, userText: 'I wait.', assistantText: 'Night falls.' });
    eq((await loadState(id)).offscreen.Nella.location, 'the market', 'useful first decision is saved');
    assert(result.pending?.includes('Mira'), 'the unfinished journey remains visibly owed');
  });
});

test('M684-16 new change explanations survive saving and identify the reason and story page', async () => {
  const next = applyMutations({ ...base(), page: 6 }, [{ type: 'people.note', name: 'Mira', field: 'core', text: 'She is a physician.', source: 'scribe', cause: 'She introduced herself as the physician.', evidence: 'I am the physician.' }]).state;
  await saveState('m684-explanation', next);
  const entry = (await loadState('m684-explanation')).log.at(-1);
  eq(entry.source, 'scribe', 'the applied record preserves who wrote it');
  eq(entry.page, 6, 'the applied record preserves its source page');
  const { changeExplanation } = await import('../../js/ui/ledgerexplain.js');
  const words = changeExplanation(entry).join('\n');
  assert(words.includes('Story page 7') && words.includes('Character writer') && words.includes('Why: She introduced') && words.includes('I am the physician.'), words);
});

test('M684-17 the direct page-reader door cannot invent Alexia Woman from Princess Alexia', async () => {
  const state = base();
  const r = await reader(state, 'Princess Alexia stands beside me.', 'She smiles.', { mutations: [{ type: 'mode.snapshot', flags: [] }, { type: 'presence.enter', name: 'Alexia Woman' }], here: ['Jovan', 'Princess Alexia'] });
  const next = applyMutations(state, r.mutations).state;
  assert(next.present.some((p) => p.name === 'Princess Alexia') && !next.present.some((p) => p.name === 'Alexia Woman'), 'the exact established name is the one written');
});

test('M684-18 an intended page repair is not presented as an applied correction', () => {
  const pending = auditLineWords({ what: 'Wrong royal title on the story page', pages: true, fix: 'Second Princess', landed: 0, refused: [] });
  assert(pending.warn && /pending/i.test(pending.text), pending.text);
  const done = auditLineWords({ what: 'Wrong royal title on the story page', pages: true, fix: 'Second Princess', landed: 0, mendedPages: 1, refused: [] });
  assert(!done.warn && /applied/i.test(done.text), done.text);
});

test('M684-19 the auditor can recover a writer-established companion from a pronoun-only reply, but never undo a later departure', async () => {
  for (const departed of [false, true]) {
    const id = 'm684-audit-writer-' + departed;
    const shown = 'Princess Alexia walks into the salon and stands beside Jovan.';
    await db.messages.append(id, { role: 'user', text: shown });
    await db.messages.append(id, { role: 'assistant', text: departed ? 'Princess Alexia leaves the salon and goes back to the tower.' : 'She draws a chair beside him. ' + 'The fire crackles while the conversation continues. '.repeat(10) });
    await saveState(id, applyMutations(base(), [{ type: 'people.set', name: 'Princess Alexia', field: 'core', text: 'Second Princess.' }, { type: 'offscreen.set', name: 'Princess Alexia', location: 'the tower', activity: 'reading' }]).state);
    await wire({ issues: [{ what: 'The writer brought her into the room.', mutations: [{ type: 'presence.enter', name: 'Princess Alexia', shown }] }] }, () => auditLedger({ connection, storyId: id }));
    eq((await loadState(id)).present.some((p) => p.name === 'Princess Alexia'), !departed, 'the latest action decides');
  }
});

test('M684-20 the auditor repairs a missed departure after out-of-character pages without miscounting the latest arrival', async () => {
  const id = 'm684-audit-indices';
  const pages = ['Jovan waits in the salon.', 'An out-of-character discussion.', 'Another out-of-character note.', 'Mira walks into the salon.', 'Mira leaves the salon and goes home.', ...Array(5).fill('Jovan continues reading his letter by the fire.')];
  for (let n = 0; n < pages.length; n++) {
    await db.messages.append(id, { role: 'user', text: 'Continue.', ooc: n === 1 || n === 2 });
    await db.messages.append(id, { role: 'assistant', text: pages[n], ooc: n === 1 || n === 2 });
  }
  await saveState(id, applyMutations({ ...base(), page: 3 }, [{ type: 'presence.enter', name: 'Mira' }]).state);
  await wire({ issues: [{ what: 'Mira went home several pages ago.', mutations: [{ type: 'presence.leave', name: 'Mira', to: 'her home' }] }] }, () => auditLedger({ connection, storyId: id }));
  assert(!(await loadState(id)).present.some((p) => p.name === 'Mira'), 'a real departure after the arrival is repaired');
});

test('M684-21 identity validation preserves the main character introduced by the same reader answer', async () => {
  const r = await reader(emptyState(), 'We go and eat.', 'You sit beside Liara at the table.', { mutations: [{ type: 'mc.set', name: 'Jovan' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Liara' }, { type: 'mode.snapshot', flags: ['group'] }] });
  const next = applyMutations(emptyState(), r.mutations).state;
  assert(next.present.some((p) => p.name === 'Jovan') && next.present.some((p) => p.name === 'Liara'), 'the main character’s own identity and the sourced companion both remain');
});
