import './idb-shim.mjs';
import assert from 'node:assert/strict';
import { db } from '../../js/store.js';
import { perspectiveConveyed, beliefAnswered, renderKnowledge, blindSpots, renderBlindSpots } from '../../js/engine/world.js';
import { emptyState, foldJournal, loadState, saveState } from '../../js/engine/state.js';
import { applyMutations, undoLast } from '../../js/engine/apply.js';
import { buildRequest, SMALL_PAGES } from '../../js/assemble/stack.js';
import { CRAFT_TEXT } from '../../js/assemble/craft.js';
import { renderMemory } from '../../js/agents/memory.js';
import { buildOpenAIRequest } from '../../js/providers/openai.js';
import { measureTransport } from '../../js/providers/measure.js';
import { bodyAccounting } from '../../js/assemble/budget.js';

const proposition = 'The key is hidden in the chapel';
const legacyBelief = 'believes the key is in the vault, untrue: the key is hidden in the chapel';
const typedBelief = { fact: legacyBelief.replace(/^believes /, ''), kind: 'belief', atTurn: 3, pathway: 'Sera told Mara', source: { quote: 'Sera said the key was in the vault.', recipients: ['Mara'], id: 'disclosure', version: 'v1' } };
const seraBelief = { ...typedBelief, source: { ...typedBelief.source, recipients: ['Sera'] } };
const { kind: omittedKind, ...legacyRecord } = { ...typedBelief, fact: legacyBelief };
const history = Array.from({ length: 41 }, (_, i) => ({ id: 'page' + i, role: i % 2 ? 'assistant' : 'user', text: 'ORIGINAL_PAGE_' + i + '.' }));
history.at(-2).text = 'LATEST_EXCHANGE_KEEP. Mara believes: ' + proposition + '.';
history.at(-1).text = 'CURRENT_MOVE_KEEP. I ask Mara about the chapel key and her conditional promise.';
const nodes = [
  { id: 'old', span: [0, 3], text: 'Mara made a conditional promise at the chapel.', detail: 'DETAIL_ONCE_KEEP. She must say exactly "Tap twice and wait for me."' },
  { id: 'bridge', span: [4, 23], text: 'The intervening journey reached the chapel without resolving the promise.' },
];
const plans = { plans: [{ id: 'conditional', title: 'Open the chapel chest', status: 'standing', from: 2, parts: [
  { who: 'Mara', does: 'Bring the key', when: 'only after her brother was released', done: false },
  { who: 'Ivo', does: 'Keep watch', when: 'after Mara taps twice', done: true },
], words: ['Tap twice and wait for me.'] }] };
const state = { ...emptyState(), page: 20, sheet: { playerName: 'Neri', actors: {} }, place: { name: 'chapel' }, present: [{ name: 'Mara' }, { name: 'Sera' }], characters: { Mara: { core: 'An exacting locksmith.', threads: [] }, Sera: { core: 'A patient scholar.', threads: [] } }, knowledge: {
  Mara: [{ fact: proposition, kind: 'known', atTurn: 20 }],
  Sera: [{ fact: proposition, kind: 'suspicion', atTurn: 20 }, { fact: 'The key is in the vault', kind: 'belief', atTurn: 20 }],
} };
const connection = { type: 'openai', baseUrl: 'https://fixture.invalid/v1', model: 'fixture', preset: 'custom', contextSize: 200000, maxTokens: 1000, reasoning: { effort: 'low' }, prefill: 'The chapel ' };
const settings = { frameText: 'CUSTOM_FRAME_KEEP', noteText: 'CUSTOM_CLOSING_KEEP', notesRole: 'user', afterRole: 'user', refereeOn: false, smallModelNow: true, ownWords: [{ name: 'Writer words', role: 'house', place: 'after-your-message', text: 'CUSTOM_OWN_WORDS_KEEP' }] };
const smallPlan = { people: [], unknown: [], pressing: ['The promise remains conditional.'], earlier: [], laws: [], sounds: [], story: 'The chapel story.', scene: 'PLANNED_SCENE_KEEP.', intense: false };
const base = { story: { id: 'm738', brief: 'WRITER_PREMISE_KEEP', castNotes: 'CUSTOM_CAST_KEEP' }, state, messages: history, settings, modules: [], memory: renderMemory({ nodes }, Infinity), recallPicked: ['old'], smallPlansBook: plans, smallPlan, window: { keeperOn: true, window: 5, nodes, recordThrough: 24, budgetTokens: 200000, answerTokens: 16000 }, transportMeasure: r => measureTransport(connection, r) };
const textOf = r => [...r.systemBlocks.map(b => b.text), ...r.messages.map(m => m.content)].join('\n');
const planRow = r => r.receipt.slots.find(s => s.name === 'The plan for this page');
const original = structuredClone({ state, history, nodes, plans, settings, smallPlan });
const originalFetch = globalThis.fetch;
let modelCalls = 0;
globalThis.fetch = async () => { modelCalls++; throw Error('This deterministic correction must not request a model.'); };

const negative = ['known', 'suspicion', 'ignorance'].map((kind, i) => perspectiveConveyed('Mara', { fact: proposition, kind }, ['Mara ' + (i ? 'knows' : 'believes') + ': ' + proposition + '.']));
const legacyStart = { ...state, knowledge: { Mara: [legacyRecord], Sera: [seraBelief] } };
const typedStart = { ...state, knowledge: { Mara: [typedBelief], Sera: [seraBelief] } };
const learn = { type: 'knowledge.add', name: 'Mara', fact: 'learned the key is hidden in the chapel', kind: 'known', pathway: 'Ivo showed Mara', source: { quote: 'Ivo showed Mara the key in the chapel.', recipients: ['Mara'], id: 'truth', version: 'v2' } };
const baseline = {
  incompatibleSuppressed: negative,
  legacyBeliefRemaining: applyMutations(legacyStart, [learn]).state.knowledge.Mara.some(k => k.fact === legacyBelief),
  metadataBeliefRemaining: applyMutations(typedStart, [learn]).state.knowledge.Mara.some(k => k.fact === typedBelief.fact),
  emptyCraftPlanTokens: planRow(buildRequest(base)).tokens,
  requestInputEstimate: buildRequest(base).receipt.context.inputTokens,
};
if (process.argv.includes('--baseline')) {
  assert.deepEqual(negative, [true, true, true]);
  assert.equal(baseline.legacyBeliefRemaining, false);
  assert.equal(baseline.metadataBeliefRemaining, true);
  assert.equal(baseline.emptyCraftPlanTokens, 0);
  console.log(JSON.stringify({ result: 'baseline reproduced', ...baseline }));
} else {
  assert.deepEqual(negative, [false, false, false]);
  assert.equal(baseline.legacyBeliefRemaining, false);
  assert.equal(baseline.metadataBeliefRemaining, false);
  const stances = [
    ['known', '', 'knows'], ['belief', 'believes ', 'believes'], ['suspicion', 'suspects ', 'suspects'],
    ['rumor', 'heard a rumor that ', 'rumor:'], ['ignorance', 'has not learned ', 'has not learned'],
  ];
  // Expected meanings are assigned explicitly, independently of the matcher.
  for (const [kind, prefix, verb] of stances) {
    for (const [otherKind, , otherVerb] of stances) {
      const line = 'Mara ' + otherVerb + ' ' + proposition + '.';
      assert.equal(perspectiveConveyed('Mara', { fact: proposition, kind }, [line]), kind === otherKind, kind + '/' + otherKind);
      assert.equal(perspectiveConveyed('Mara', prefix + proposition, [line]), kind === otherKind, 'legacy ' + kind + '/' + otherKind);
    }
    const matching = 'Mara ' + verb + ' ' + proposition + '.';
    assert.equal(renderKnowledge({ Mara: [{ fact: proposition, kind }] }, ['Mara'], undefined, { selectedTexts: [matching] }), '');
    const incompatible = kind === 'known' ? 'Mara believes: ' + proposition + '.' : 'Mara knows: ' + proposition + '.';
    const kept = renderKnowledge({ Mara: [{ fact: proposition, kind }] }, ['Mara'], undefined, { selectedTexts: [incompatible] });
    assert(kept.includes(verb), kept);
  }
  const knows = 'Mara knows: ' + proposition + '.';
  const quoted = { fact: proposition, kind: 'known', source: { quote: 'Mara believes: ' + proposition + '.', recipients: ['Mara'] } };
  assert.equal(perspectiveConveyed('Mara', quoted, [quoted.source.quote]), false);
  for (const text of ['"' + knows + '"', 'If ' + knows, 'Ivo said "' + knows + '"', 'Ivo read a hypothetical example:\n' + knows, 'Earlier, ' + knows, 'Mara was told: ' + proposition + '.', 'Sera knows: ' + proposition + '.']) {
    assert.equal(perspectiveConveyed('Mara', { fact: proposition, kind: 'known' }, [text]), false, text);
  }
  for (const different of ['The key is not hidden in the chapel', proposition + ' only after the bell', 'Two keys are hidden in the chapel']) {
    assert.equal(perspectiveConveyed('Mara', { fact: different, kind: 'known' }, [knows]), false);
  }
  const bound = { fact: proposition, kind: 'known', atTurn: 20, pathway: 'Ivo showed Mara', source: { id: 'page39', version: 'v2', recipients: ['Mara'] } };
  const evidence = { text: knows, atTurn: 20, pathway: bound.pathway, source: structuredClone(bound.source), historical: true };
  assert(perspectiveConveyed('Mara', bound, [evidence]));
  assert.equal(perspectiveConveyed('Sera', bound, [{ ...evidence, text: 'Sera knows: ' + proposition + '.' }]), false, 'source belongs to Mara even when wording names Sera');
  for (const altered of [{ atTurn: 10 }, { atTurn: 21 }, { pathway: 'Sera told Mara' }, { source: { ...bound.source, version: 'v1' } }, { source: { ...bound.source, id: 'other' } }, { source: { ...bound.source, recipients: ['Sera'] } }]) {
    assert.equal(perspectiveConveyed('Mara', bound, [{ ...evidence, ...altered }]), false, JSON.stringify(altered));
  }
  assert.equal(perspectiveConveyed('Mara', bound, [knows]), false, 'unknown ownership cannot suppress a bound record');
  assert.equal(perspectiveConveyed('Mara', { fact: proposition }, [{ text: knows, historical: true }]), false, 'undated legacy history remains uncertain');
  for (const source of [{}, { quote: knows, recipients: ['Mara'] }]) {
    assert.equal(perspectiveConveyed('Mara', { fact: proposition, source }, [{ text: knows, source, historical: true }]), false, 'quote or empty source is not chronology');
  }
  for (const [kind, legacy] of [['belief', 'believes that '], ['suspicion', 'suspects that '], ['rumor', 'rumor '], ['ignorance', 'does not know that ']]) {
    const verb = stances.find(s => s[0] === kind)[2];
    assert(perspectiveConveyed('Mara', legacy + proposition, ['Mara ' + verb + ' ' + proposition]));
  }
  const conflict = { fact: 'believes ' + proposition, kind: 'known' };
  assert.equal(perspectiveConveyed('Mara', conflict, [knows, 'Mara believes ' + proposition]), false);
  assert(renderKnowledge({ Mara: [conflict] }, ['Mara']).includes('Mara may know, or may only believe: ' + proposition.replace(/\.+$/, ''))); /* M751: still shown as unresolved, in plain words */
  assert.equal(beliefAnswered(legacyBelief, 'learned the key is hidden in the chapel'), true);
  assert.equal(beliefAnswered(typedBelief, { fact: 'learned the key is hidden in the chapel', kind: 'known', atTurn: 4 }), true);
  assert.equal(beliefAnswered(typedBelief, { fact: 'learned the key is hidden in the chapel', kind: 'known', atTurn: 2 }), false);

  // Blind spot comparisons retain the source record and cannot promote a
  // typed suspicion or rumor into someone else's established knowledge.
  const uncertainBooks = { Mara: [{ fact: proposition, kind: 'suspicion', atTurn: 20 }], Sera: [] };
  assert.deepEqual(blindSpots(uncertainBooks, ['Sera'], { turn: 21 }), []);
  const spots = blindSpots({ Mara: [bound], Sera: [] }, ['Sera'], { turn: 21 });
  assert.equal(spots[0].lacks[0].record.kind, 'known');
  assert(renderBlindSpots(spots, { selectedTexts: ['Mara believes: ' + proposition + '.'] }).includes(proposition));
  assert(renderBlindSpots(spots, { selectedTexts: [evidence] }).includes(proposition.replace(/\.+$/, '').slice(0, 40)) && renderBlindSpots(spots).includes('(Mara knows)')); /* M751: the fact itself, and its knower — never only a pointer at history */
  assert(!renderBlindSpots(spots).includes('hasn’t found out'));

  const unrelated = { fact: 'Mara believes the guard is asleep', kind: 'belief', atTurn: 3, source: { id: 'other' } };
  const mutationEvidence = [];
  for (const representation of [legacyRecord, typedBelief]) {
    const story = await db.stories.create({ title: 'Disposable knowledge correction' });
    const start = { ...state, page: 3, knowledge: { Mara: [representation, unrelated], Sera: [seraBelief] } };
    await saveState(story.id, start);
    const stored = await loadState(story.id);
    const before = structuredClone(stored.knowledge);
    const changed = applyMutations({ ...stored, page: 4 }, [learn]);
    assert.equal(changed.applied.length, 1);
    assert.equal(changed.state.knowledge.Mara.length, 2);
    assert.deepEqual(changed.state.knowledge.Mara[0], unrelated);
    assert.deepEqual(changed.state.knowledge.Sera, before.Sera);
    const acquired = changed.state.knowledge.Mara[1];
    assert.equal(acquired.kind, 'known'); assert.equal(acquired.pathway, learn.pathway); assert.deepEqual(acquired.source, learn.source);
    assert.deepEqual(changed.state.log.at(-1).undo.before, before.Mara);
    await saveState(story.id, changed.state);
    const persisted = await loadState(story.id);
    assert.deepEqual(persisted.knowledge, changed.state.knowledge);
    const undone = undoLast(persisted).state;
    assert.deepEqual(undone.knowledge, before, 'exact original belief, source and pathway restored');
    await saveState(story.id, undone);
    assert.deepEqual((await loadState(story.id)).knowledge, before);
    const replayed = foldJournal(persisted, [{ snap: stored }], 4, applyMutations);
    assert.deepEqual(replayed.knowledge, persisted.knowledge, 'replay preserves the learned recipient and metadata');
    assert.deepEqual(foldJournal(persisted, [{ snap: stored }], 3, applyMutations).knowledge, before, 'earlier boundary has no future truth');
    assert.deepEqual(foldJournal(undone, [{ snap: stored }], 4, applyMutations).knowledge, before, 'undo survives replay');
    assert.deepEqual(stored.knowledge, before, 'mutation does not rewrite its input');
    mutationEvidence.push({ representation: representation.kind || 'legacy', recipientFacts: persisted.knowledge.Mara.length, otherRecipientUnchanged: true, exactUndo: true, replay: true });
  }
  for (const incoming of [
    { fact: 'the key is hidden in the chapel', kind: 'rumor' },
    { fact: 'the key is hidden in the chapel', kind: 'suspicion' },
    { fact: 'the key is hidden in the chapel', kind: 'ignorance' },
    { fact: 'heard a rumor that the key is hidden in the chapel' },
    { fact: 'rumor the key is hidden in the chapel' },
    { fact: 'learned the key is hidden in the chapel', kind: 'belief' },
    { fact: 'learned the key is hidden in the chapel only after the bell', kind: 'known' },
    { fact: 'learned the key is hidden in the chapel', source: { recipients: ['Sera'] } },
  ]) {
    const result = applyMutations(typedStart, [{ type: 'knowledge.add', name: 'Mara', ...incoming }]);
    assert(result.state.knowledge.Mara.some(k => k.fact === typedBelief.fact), JSON.stringify(incoming));
    assert.deepEqual(result.state.knowledge.Sera, typedStart.knowledge.Sera);
  }
  const unsupported = { ...typedStart, knowledge: { Mara: [{ fact: 'the key is in the vault', kind: 'belief' }] } };
  assert.equal(applyMutations(unsupported, [learn]).state.knowledge.Mara.length, 2, 'no guessed contradiction without explicit correction relationship');

  const plannedConnection = { ...connection, prefillFlagField: 'partial' };
  const windowControl = { ...base, window: { ...base.window, window: 30 }, transportMeasure: r => measureTransport(plannedConnection, r) };
  const fallback = buildRequest(windowControl);
  assert.equal(planRow(fallback).tokens, 0);
  assert.equal(planRow(fallback).text, '');
  const planned = buildRequest({ ...windowControl, modules: [{ mod: { id: 'core-craft', text: CRAFT_TEXT }, reason: 'fixture core craft' }] });
  assert(planRow(planned).tokens > 0);
  assert(planRow(planned).text.includes('PLANNED_SCENE_KEEP'));
  assert(textOf(planned).includes(planRow(planned).text));
  // 20 told pages: the last SMALL_PAGES start at user page24, followed by
  // assistant page25. This explicit identity assertion detects fallback.
  const firstPlanned = 2 * (20 - SMALL_PAGES);
  const plannedIds = planned.selection.messages.filter(m => m.selected).map(m => m.id);
  assert.deepEqual(plannedIds, history.slice(firstPlanned).map(m => m.id));
  assert.equal(planned.messages.filter(m => m.id && m.role === 'assistant').length, SMALL_PAGES);
  assert.deepEqual(fallback.selection.messages.filter(m => m.selected).map(m => m.id), history.slice(10).map(m => m.id));
  assert(fallback.selection.messages.filter(m => m.selected).length > plannedIds.length);
  for (const request of [fallback, planned]) {
    const text = textOf(request);
    for (const word of ['LATEST_EXCHANGE_KEEP', 'CURRENT_MOVE_KEEP', 'DETAIL_ONCE_KEEP', 'only after her brother was released', 'Tap twice and wait for me.', 'CUSTOM_FRAME_KEEP', 'CUSTOM_CLOSING_KEEP', 'CUSTOM_OWN_WORDS_KEEP', 'WRITER_PREMISE_KEEP']) assert(text.includes(word), word);
    assert.equal(text.split('DETAIL_ONCE_KEEP').length - 1, 1);
    assert.equal(request.selection.records.filter(r => r.selected && r.id === 'old').length, 1);
    assert(request.selection.plans.some(p => p.id === 'conditional' && p.selected));
    assert(text.includes('Ivo — Keep watch (after Mara taps twice) — done.'), 'the finished step remains distinct from unfinished conditions');
    for (const originalPage of history.slice(-2)) {
      assert(request.messages.some(m => m.id === originalPage.id && m.content === originalPage.text), 'latest exchange and current move remain whole original messages');
    }
    const knowledgeRow = request.receipt.slots.find(s => s.name === 'The state of things').text;
    assert(knowledgeRow.includes('Mara knows: ' + proposition));
    assert(knowledgeRow.includes('Sera believes: The key is in the vault'));
    assert(knowledgeRow.includes('suspects: ' + proposition));
    const body = buildOpenAIRequest(plannedConnection, request);
    const account = bodyAccounting(body);
    assert.equal(request.receipt.context.inputTokens, account.inputTokens);
    assert.equal(request.receipt.context.answerTokens, 16000);
    assert.equal(body.max_tokens, 16000);
    assert(account.inputTokens <= request.receipt.context.inputRoom);
    assert.match(request.receipt.context.estimate, /estimate/);
    assert(body.messages.some(m => m.role === 'user' && String(m.content).includes('CUSTOM_CLOSING_KEEP')));
    assert.equal(body.messages.at(-1).content, 'The chapel', 'prefill reaches the serialized body');
    assert.equal(body.messages.at(-1).partial, true);
  }
  // A current exact knowledge statement removes its generated duplicate;
  // belief about the same words must retain the knowledge distinction.
  const safeHistory = structuredClone(history);
  safeHistory.at(-2).text = knows;
  const safe = buildRequest({ ...base, messages: safeHistory });
  assert(!safe.receipt.slots.find(s => s.name === 'The state of things').text.includes('Mara knows: ' + proposition));
  assert.equal(textOf(safe).split(knows).length - 1, 1);
  const staleHistory = structuredClone(safeHistory);
  staleHistory[37].text = knows; staleHistory.at(-2).text = 'LATEST_EXCHANGE_KEEP.';
  const stale = buildRequest({ ...base, messages: staleHistory });
  assert(stale.receipt.slots.find(s => s.name === 'The state of things').text.includes('Mara knows: ' + proposition));
  const transformed = buildRequest({ ...base, messages: safeHistory, pageFilter: t => t === knows ? t.toUpperCase() : t });
  assert(transformed.receipt.slots.find(s => s.name === 'The state of things').text.includes('Mara knows: ' + proposition), 'transformed prose cannot borrow the original source version');
  assert.deepEqual(safe.systemBlocks.slice(0, 2), fallback.systemBlocks.slice(0, 2), 'stable custom instruction prefix');
  assert.deepEqual({ state, history, nodes, plans, settings, smallPlan }, original);
  assert.equal(modelCalls, 0);
  console.log(JSON.stringify({ result: 'pass', ...baseline, mutationEvidence, planned: { planTokens: planRow(planned).tokens, messageIds: plannedIds, inputEstimate: planned.receipt.context.inputTokens, answerTokens: planned.receipt.context.answerTokens }, fallback: { planTokens: planRow(fallback).tokens, messageIds: fallback.selection.messages.filter(m => m.selected).map(m => m.id) }, safeDuplicate: { inputEstimate: safe.receipt.context.inputTokens, exactStatements: 1 }, helperCalls: modelCalls, liveProviderCalls: 0 }));
}
globalThis.fetch = originalFetch;
