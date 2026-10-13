import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { auditLedger, auditRunWords } from '../../js/agents/auditor.js';
import { saveMemory } from '../../js/agents/memory.js';
import { worldTurn } from '../../js/agents/world.js';

const connection = { type: 'openai', baseUrl: 'https://custom.example/v1', apiKey: 'fixture', model: 'm', preset: 'custom', context: 64000 };
async function wire(answer, fn) {
  const old = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    const reply = await answer(body, calls.length);
    const text = typeof reply === 'string' ? reply : JSON.stringify(reply);
    if (body.stream) return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    return new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
  };
  try { return await fn(calls); } finally { globalThis.fetch = old; }
}
const sent = (b) => b.messages.map((m) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
const base = () => applyMutations({ ...emptyState(), page: 0, clock: { minutes: 600 } }, [
  { type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'the palace salon' }, { type: 'presence.enter', name: 'Jovan' },
]).state;
async function tale(title, { input = 'Princess Alexia is the Second Princess. She stands beside Jovan in the salon.', page = 'Princess Alexia offers Jovan her hand.', mutations = [] } = {}) {
  const { id } = await db.stories.create({ title });
  await db.messages.append(id, { id: id + 'u', role: 'user', text: input, ts: 1 });
  await db.messages.append(id, { id: id + 'a', role: 'assistant', text: page, ts: 2 });
  await saveState(id, applyMutations(base(), mutations).state);
  return id;
}
/* The answers the CURRENT prompts ask a model for. The audit is one combined final review (M708) whose explicit completed
 * verdict approves the required entries — an empty issues list alone is no review (M698/M709) — with standings:[] when the
 * writer states no starting digits. The source reading receives original sections as ordered passages and selects them by
 * id (M717); every row carries identityFacts and facts arrays (M699/M704). */
const reviewed = (answer = {}) => ({ scene: [], issues: [], ...answer, review: { status: 'complete', why: 'Every required entry and source decision was compared with the originals.', open: [], ...answer.review }, standings: [] });
const reading = (b) => sent(b).includes('SOURCE PEOPLE REVIEW');
const sourceDocs = (b) => JSON.parse(String(b.messages.find((m) => m.role === 'user').content).split('SOURCE DOCUMENTS\n')[1]);
const passageIn = (doc, words) => doc.passages.find((p) => p.text.includes(words));
const sourcePerson = (doc, name, words, identityFacts = []) => {
  const evidence = passageIn(doc, words).id;
  return { name, kind: 'person', source: doc.id, evidence, identityFacts: identityFacts.map((text) => ({ text, evidence })), facts: [] };
};
/* the original-source decisions the code hands to the final review, and the historical findings with their ids */
const sourceTasks = (b) => JSON.parse(sent(b).split('REQUIRED SOURCE MENTION DECISIONS:\n')[1].split('\n')[0]);
const historical = (b) => JSON.parse(sent(b).split('HISTORICAL FINDINGS WITH ACTUAL CURRENT RECORDS:\n')[1].split('\n')[0]);
/* M708 retired the separate repair reading: the one second call left is the review's completion turn, asked when its
 * reply lacks the completed verdict, and it completes the SAME review (its prompt keeps the decisions already given) */
const completing = (b) => sent(b).includes('Complete the SAME review');

test('M685-1 the auditor repairs a known missing People page even when its first answer reports no issues', async () => {
  /* M708: one combined review, no second repair reading. M719: a tracked person owes a People core when the ORIGINAL
   * sources establish identity facts — the source reading records them and the code hands them to the review itself. */
  const quote = 'Princess Alexia is the Second Princess.';
  const id = await tale('m685-known', { mutations: [{ type: 'presence.enter', name: 'Princess Alexia' }] });
  await wire((b) => {
    if (reading(b)) {
      const docs = sourceDocs(b);
      return { checked: docs.map((d) => d.id), people: docs.filter((d) => passageIn(d, quote)).map((d) => sourcePerson(d, 'Princess Alexia', quote, ['Second Princess'])) };
    }
    return reviewed({ profiles: [{ name: 'Princess Alexia', core: { text: 'Second Princess.', shown: quote } }] });
  }, async (calls) => {
    const r = await auditLedger({ connection, storyId: id, reviewSources: 'all' });
    const task = sourceTasks(calls.find((b) => !reading(b))).find((t) => t.name === 'Princess Alexia');
    assert(task?.sourceFacts && task.facts.some((f) => f.text === 'Second Princess') && task.originalPassage.includes(quote), 'the known missing identity reaches the review with its original passage, without the model having to report it');
    assert((await loadState(id)).characters['Princess Alexia']?.core.includes('Second Princess'), 'a current companion receives her missing character record');
    eq(calls.filter((b) => !reading(b)).length, 1, 'one targeted recovery, not an unbounded audit loop');
    assert(!r.unfinished, 'the recovered record completes the audit');
  });
});

test('M685-2 the auditor recovers a person absent from every ledger book by reading original folded writer introductions', async () => {
  const quote = 'Princess Alexia is the Second Princess and Prince Caelan is the Third Prince.';
  const id = await tale('m685-source', { input: quote, page: 'She smiles and opens the letter.' });
  for (let i = 0; i < 7; i++) {
    await db.messages.append(id, { role: 'user', text: 'I continue reading.', ts: 3 + i * 2 });
    await db.messages.append(id, { role: 'assistant', text: 'The fire flickers.', ts: 4 + i * 2 });
  }
  await saveMemory(id, { window: 2, nodes: [{ id: 'fold', span: [0, 5], level: 1, text: 'Jovan spent the morning reading a letter.', at: 1 }] });
  await wire((b) => {
    const t = sent(b);
    if (!reading(b)) {
      /* M699: a source reading is a repair target for the review, never a raw quotation written into core; M718: each
       * unbound original individual needs the review's identity decision — a new one is a profile plus its binding */
      const tasks = sourceTasks(b);
      return reviewed({
        profiles: [{ name: 'Princess Alexia', core: { text: 'Second Princess.', shown: quote } }, { name: 'Prince Caelan', core: { text: 'Third Prince.', shown: quote } }],
        identities: tasks.map((task) => ({ sourceId: task.sourceId, name: task.name, to: task.name, kind: 'person', why: 'The writer introduces this individual by name and rank.' })),
      });
    }
    assert(t.includes(quote), 'the original introduction is read even when the summary lost it');
    const docs = sourceDocs(b);
    const source = docs.find((d) => passageIn(d, quote));
    return { checked: docs.map((d) => d.id), people: [sourcePerson(source, 'Princess Alexia', quote, ['Second Princess']), sourcePerson(source, 'Prince Caelan', quote, ['Third Prince'])] };
  }, async (calls) => {
    await auditLedger({ connection, storyId: id, reviewSources: 'all' });
    const tasks = sourceTasks(calls.find((b) => !reading(b)));
    for (const name of ['Princess Alexia', 'Prince Caelan']) assert(tasks.some((task) => task.name === name && task.shown.includes(quote)), 'the normal auditor sees recovered identities even when summaries lost them');
    const state = await loadState(id);
    assert(state.characters['Princess Alexia']?.core.includes('Second Princess'), 'the missing princess is restored');
    assert(state.characters['Prince Caelan']?.core.includes('Third Prince'), 'the absent prince is recorded as well');
    assert(!state.present.some((p) => p.name === 'Prince Caelan'), 'an old identity does not invent current presence');
  });
});

test('M685-3 a blocked name deletion gets its reason back and is repaired by rename without losing records', async () => {
  const id = await tale('m685-recover-rename', { mutations: [
    { type: 'people.set', name: 'Alexia Woman', field: 'core', text: 'Second Princess.' },
    { type: 'presence.enter', name: 'Alexia Woman' },
    { type: 'knowledge.add', name: 'Alexia Woman', fact: 'The west stair leads to the secret passage.' },
  ] });
  /* M708: one combined review per audit, so the blocked attempt is carried as a historical finding into the next review */
  const forget = reviewed({ issues: [{ what: 'Alexia Woman is the wrong name.', mutations: [{ type: 'people.forget', name: 'Alexia Woman', cause: 'wrong name' }] }] });
  let reason = '';
  await wire(() => forget, async () => {
    const r = await auditLedger({ connection, storyId: id });
    reason = (r.pending.find((p) => p.startsWith('Alexia Woman is the wrong name: ')) || '').slice('Alexia Woman is the wrong name: '.length); /* M752: one stop, never "name.: reason" */
    assert(r.unfinished && /rename/.test(reason), 'a blocked deletion stays unfinished with its reason, even beside a completed verdict');
    assert((await loadState(id)).characters['Alexia Woman'], 'the blocked deletion lost nothing');
  });
  await wire((b) => {
    const finding = historical(b).find((f) => f.what === 'Alexia Woman is the wrong name.');
    return finding?.pendingReason === reason ? reviewed({ issues: [{ what: 'Her established name is Princess Alexia.', mutations: [{ type: 'people.rename', from: 'Alexia Woman', to: 'Princess Alexia', cause: 'the writer names her Princess Alexia' }] }] }) : forget;
  }, async (calls) => {
    const r = await auditLedger({ connection, storyId: id });
    const st = await loadState(id);
    assert(st.characters['Princess Alexia'], 'the correct name is actually restored');
    assert(st.knowledge['Princess Alexia']?.length, 'her knowledge survives');
    assert(historical(calls[0]).some((f) => f.what === 'Alexia Woman is the wrong name.' && f.pendingReason === reason), 'the model receives the actual reason its first attempt could not land');
    assert(!r.unfinished, 'successful recovery finishes the audit');
  });
});

test('M685-4 an auditor attempt using a blocked operation is not silently discarded as a clean audit', async () => {
  const id = await tale('m685-blocked');
  await wire(() => ({ issues: [{ what: 'Princess Alexia is missing.', fix: 'Restore her People page.', mutations: [{ type: 'people.note', name: 'Princess Alexia', field: 'core', text: 'Second Princess.' }] }] }), async () => {
    const r = await auditLedger({ connection, storyId: id });
    const st = await loadState(id);
    assert(st.characters['Princess Alexia']?.core || r.unfinished, 'a repair either lands or remains explicitly unfinished');
    assert(!/ledger is true/.test(auditRunWords(r)), 'an unresolved attempt is never announced as a correct ledger');
  });
});

test('M685-5 a still-missing known character stays pending after the bounded repair and never becomes a clean audit', async () => {
  /* M719: she is KNOWN to be missing an identity when the original sources establish one — the source reading records
   * "Second Princess" for her; an empty answer (no completed review) gets one completion and no more (M708) */
  const quote = 'Princess Alexia is the Second Princess.';
  const id = await tale('m685-pending', { mutations: [{ type: 'presence.enter', name: 'Princess Alexia' }] });
  await wire((b) => {
    if (!reading(b)) return { issues: [] };
    const docs = sourceDocs(b);
    return { checked: docs.map((d) => d.id), people: docs.filter((d) => passageIn(d, quote)).map((d) => sourcePerson(d, 'Princess Alexia', quote, ['Second Princess'])) };
  }, async (calls) => {
    const r = await auditLedger({ connection, storyId: id, reviewSources: 'all' });
    assert(r.unfinished && r.pending?.some((p) => p.includes('Princess Alexia')), 'the omission is retained by name');
    assert((await loadState(id)).audit?.pending?.length, 'the next audit can see the unfinished work');
    assert(!/ledger is true/.test(auditRunWords(r)), 'no false completion');
    eq(calls.filter((b) => !reading(b)).length, 2, 'the audit does not retry without limit');
  });
});

test('M685-6 a failed repair followup preserves useful first-pass corrections', async () => {
  const id = await tale('m685-followup-fails', { mutations: [{ type: 'presence.enter', name: 'Princess Alexia' }] });
  await wire((b) => {
    if (completing(b)) throw new Error('fixture network interruption');
    return { issues: [{ what: 'Her rank was missing.', mutations: [{ type: 'canon.lock', name: 'Princess Alexia', key: 'rank', value: 'Second Princess' }] }] };
  }, async (calls) => {
    const r = await auditLedger({ connection, storyId: id });
    assert(calls.some(completing), 'the reply without a verdict is asked for its completion');
    assert((await loadState(id)).canon['Princess Alexia']?.facts.some((f) => f.value === 'Second Princess'), 'valid first-pass work survives');
    assert(r.unfinished, 'failed recovery remains unfinished');
  });
});

test('M685-7 an automatic audit reuses unchanged source receipts but checks edited source text again', async () => {
  const id = await tale('m685-receipts'); let sourceCalls = 0;
  await wire((b) => {
    if (!reading(b)) return reviewed();
    sourceCalls++;
    const docs = sourceDocs(b);
    const source = docs.find((d) => passageIn(d, 'Princess Alexia is'));
    return { checked: docs.map((d) => d.id), people: source ? [sourcePerson(source, 'Princess Alexia', 'Princess Alexia is', ['Second Princess'])] : [] };
  }, async () => {
    await auditLedger({ connection, storyId: id, reviewSources: 'next' });
    eq(sourceCalls, 1);
    await auditLedger({ connection, storyId: id, reviewSources: 'next' });
    eq(sourceCalls, 1, 'no extra source call for identical pages');
    await db.messages.update(id, id + 'u', { text: 'Princess Alexia is the Second Princess. Prince Caelan is her brother.' });
    await auditLedger({ connection, storyId: id, reviewSources: 'next' });
    eq(sourceCalls, 2, 'a changed page must be read again');
  });
});

test('M685-8 invented source quotes cannot create people or complete a source review', async () => {
  const id = await tale('m685-false-source');
  await wire((b) => {
    const t = sent(b); if (!t.includes('SOURCE PEOPLE REVIEW')) return { issues: [] };
    const sources = JSON.parse(t.split('SOURCE DOCUMENTS\n')[1]);
    return { checked: sources.map((s) => s.id), people: [{ name: 'Alexia Woman', source: sources[0].id, shown: 'Alexia Woman is the Fourth Princess.' }] };
  }, async () => {
    const r = await auditLedger({ connection, storyId: id, reviewSources: 'all' });
    assert(!(await loadState(id)).characters['Alexia Woman'], 'unsupported identity rejected');
    assert(r.unfinished, 'invalid review never receives a completed receipt');
  });
});

test('M685-9 the auditor can correct a wrong current mood from the newest ending, even after a reader stamped it', async () => {
  const page = 'Princess Alexia and Jovan have arrived. They are seated together in the salon; the journey is over.';
  const id = await tale('m685-mood', { page, mutations: [{ type: 'mode.snapshot', flags: ['travel'] }] });
  await wire(() => ({ issues: [{ what: 'Travel remained on after they arrived.', mutations: [{ type: 'mode.snapshot', flags: ['group'], shown: page }] }] }), async () => {
    await auditLedger({ connection, storyId: id });
    const st = await loadState(id);
    assert(!st.mode.travel && st.mode.group, 'the mistaken board is corrected, not protected because it was recently written');
  });
});

test('M685-10 the auditor can restore a missing personal loose end that its own prompt asks it to add', async () => {
  const shown = 'Princess Alexia promises to bring the sealed letter tomorrow.';
  const id = await tale('m685-thread', { page: shown, mutations: [{ type: 'people.set', name: 'Princess Alexia', field: 'core', text: 'Second Princess.' }] });
  await wire(() => ({ issues: [{ what: 'Her promise is missing from her page.', mutations: [{ type: 'people.note', name: 'Princess Alexia', field: 'thread', text: 'Bring the sealed letter tomorrow.', shown }] }] }), async () => {
    await auditLedger({ connection, storyId: id });
    assert((await loadState(id)).characters['Princess Alexia'].threads.some((s) => /sealed letter/.test(s)), 'the missing promise is recorded');
  });
});

test('M685-11 the auditor can repair an incorrect now from exact current evidence without reviving an old moment', async () => {
  const shown = 'Princess Alexia is seated by the fire, reading the sealed letter.';
  const id = await tale('m685-now', { page: shown, mutations: [
    { type: 'presence.enter', name: 'Princess Alexia' },
    { type: 'people.set', name: 'Princess Alexia', field: 'core', text: 'Second Princess.' },
    { type: 'people.set', name: 'Princess Alexia', field: 'state', text: 'Dancing in the courtyard.' },
  ] });
  await wire(() => ({ issues: [{ what: 'Her now contradicts the newest page.', mutations: [{ type: 'people.set', name: 'Princess Alexia', field: 'state', text: shown, shown }] }] }), async () => {
    await auditLedger({ connection, storyId: id });
    eq((await loadState(id)).characters['Princess Alexia'].state, shown);
  });
});

test('M685-12 the auditor never rewinds a clock the writer advanced after the newest page', async () => {
  const id = await tale('m685-hand-clock', { page: '[The palace salon | 10:00]\nPrincess Alexia reads quietly.', mutations: [
    { type: 'clock.advance', minutes: 60, byHand: true, reason: 'one hour passes' },
  ] });
  await wire(() => ({ issues: [{ what: 'The clock disagrees with the header.', mutations: [{ type: 'clock.set', hour: 10, minute: 0 }] }] }), async () => {
    await auditLedger({ connection, storyId: id });
    eq((await loadState(id)).clock.minutes, 660, 'the optional one-hour button remains authoritative');
  });
});

test('M685-13 a source changed during the review cannot create an obsolete person', async () => {
  const id = await tale('m685-source-stale');
  await wire(async (b) => {
    if (!reading(b)) return reviewed({ profiles: [{ name: 'Princess Alexia', core: { text: 'Second Princess.', shown: 'Princess Alexia is the Second Princess.' } }] });
    const docs = sourceDocs(b);
    const source = docs.find((d) => passageIn(d, 'Princess Alexia is'));
    await db.messages.update(id, id + 'u', { text: 'I read quietly alone.' });
    await db.messages.update(id, id + 'a', { text: 'The fire flickers.' });
    return { checked: docs.map((d) => d.id), people: [sourcePerson(source, 'Princess Alexia', 'Princess Alexia is', ['Second Princess'])] };
  }, async () => {
    const r = await auditLedger({ connection, storyId: id, reviewSources: 'all' });
    eq(r, null, 'changed source abandons the obsolete answer');
    assert(!(await loadState(id)).characters['Princess Alexia']);
  });
});

test('M685-14 an unrelated followup correction cannot hide the first unresolved finding', async () => {
  const id = await tale('m685-unrelated', { mutations: [{ type: 'people.set', name: 'Princess Alexia', field: 'core', text: 'Second Princess.' }] });
  await wire((b) => completing(b)
    ? reviewed({ issues: [{ what: 'Her hair is recorded.', mutations: [{ type: 'canon.lock', name: 'Princess Alexia', key: 'hair', value: 'silver' }] }] })
    : { issues: [{ what: 'Her personal promise is missing.', mutations: [{ type: 'unknown.promise', name: 'Princess Alexia', text: 'Bring the letter.' }] }] }, async (calls) => {
    const r = await auditLedger({ connection, storyId: id });
    assert(calls.some(completing) && (await loadState(id)).canon['Princess Alexia']?.facts.some((f) => f.value === 'silver'), 'the completion and its unrelated correction land');
    assert(r.unfinished && r.pending.some((p) => /promise/.test(p)), 'fixing hair cannot make a missing promise disappear');
  });
});

test('M685-15 the world follows up an absent person with no seat, not only people with old seats', async () => {
  const id = await tale('m685-unseated', { mutations: [{ type: 'people.set', name: 'Prince Caelan', field: 'core', text: 'Third Prince, living at the northern estate.' }] });
  await wire((b) => sent(b).includes('Your answer did not review')
    ? { mutations: [{ type: 'offscreen.set', name: 'Prince Caelan', location: 'the northern estate', activity: 'reading dispatches', cause: 'he handles the estate’s morning reports' }], brief: { pressure: [], ripe: [], twb: null } }
    : { mutations: [], brief: { pressure: [], ripe: [], twb: null } }, async (calls) => {
    const r = await worldTurn({ connection, storyId: id, userText: 'I read.', assistantText: 'The fire flickers in the salon.', brief: 'Prince Caelan is the Third Prince, living at the northern estate.' });
    assert((await loadState(id)).offscreen['Prince Caelan'], 'the unseated prince is recovered by the world followup');
    assert(!r.pending?.length);
    eq(calls.length, 2);
  });
});

test('M685-16 source recovery cannot overwrite an identity written while the audit waited', async () => {
  const id = await tale('m685-concurrent-core');
  const written = 'Second Princess, keeper of the treaty and royal envoy.';
  await wire(async (b) => {
    if (reading(b)) {
      const docs = sourceDocs(b); const d = docs.find((x) => passageIn(x, 'Princess Alexia is'));
      return { checked: docs.map((x) => x.id), people: [sourcePerson(d, 'Princess Alexia', 'Princess Alexia is', ['Second Princess'])] };
    }
    /* M699: the recovery is the review's own profile write; the writer writes her identity by hand while it is out */
    await saveState(id, applyMutations(await loadState(id), [{ type: 'people.set', name: 'Princess Alexia', field: 'core', text: written, byHand: true }]).state);
    return reviewed({ profiles: [{ name: 'Princess Alexia', core: { text: 'Second Princess.', shown: 'Princess Alexia is the Second Princess.' } }],
      identities: sourceTasks(b).map((task) => ({ sourceId: task.sourceId, name: task.name, to: 'Princess Alexia', kind: 'person', why: 'The writer introduces her by name and rank.' })) });
  }, async () => {
    await auditLedger({ connection, storyId: id, reviewSources: 'all' });
    const her = (await loadState(id)).characters['Princess Alexia'];
    eq(her?.core, written, 'the new complete identity is preserved');
    assert(her.hand?.core, 'and stays the writer’s own');
  });
});

test('M685-17 a useful source recovery survives an unusable main audit answer', async () => {
  const id = await tale('m685-auditor-bad');
  await wire((b) => {
    if (!reading(b)) return 'not valid JSON';
    const docs = sourceDocs(b); const d = docs.find((x) => passageIn(x, 'Princess Alexia is'));
    return { checked: docs.map((x) => x.id), people: [sourcePerson(d, 'Princess Alexia', 'Princess Alexia is', ['Second Princess'])] };
  }, async () => {
    const r = await auditLedger({ connection, storyId: id, reviewSources: 'all' });
    /* M699: a source reading restores nobody by itself — it is verified evidence plus a repair target for the review */
    const st = await loadState(id);
    const kept = Object.values(st.auditSources || {}).flatMap((receipt) => receipt.people || []).find((p) => p.name === 'Princess Alexia');
    assert(kept?.shown.includes('Princess Alexia is the Second Princess.') && st.audit.coverage.read === st.audit.coverage.total, 'the verified source restoration is not thrown away');
    assert(r.pending.some((p) => p.includes('Princess Alexia')), 'her recovery stays owed to the next review by name');
    assert(r.unfinished, 'the remaining audit is still incomplete');
  });
});

test('M685-18 an unresolved finding survives a later empty audit and clears only when its repair lands', async () => {
  const id = await tale('m685-persistent', { page: 'Princess Alexia promises to bring the sealed letter tomorrow.', mutations: [{ type: 'people.set', name: 'Princess Alexia', field: 'core', text: 'Second Princess.' }] });
  /* M709 dropped the quotation gate, so a quote-less thread now lands; a repair the engine still refuses — an operation
   * outside the vocabulary — is what leaves this finding unresolved under the current contract */
  await wire(() => reviewed({ issues: [{ what: 'Her personal promise is missing.', mutations: [{ type: 'people.promise', name: 'Princess Alexia', text: 'Bring the sealed letter tomorrow.' }] }] }), async () => {
    assert((await auditLedger({ connection, storyId: id })).unfinished, 'the refused repair leaves the finding unresolved');
  });
  await wire(() => reviewed(), async () => {
    const r = await auditLedger({ connection, storyId: id });
    assert(r.unfinished && r.pending.some((p) => /promise/.test(p)), 'an empty subsequent answer cannot erase unfinished work');
  });
  /* the historical checklist hands the finding's id to the review, which returns its working repair by that id */
  await wire((b) => reviewed({ repairs: [{ id: historical(b).find((f) => /promise/.test(f.what)).id, status: 'repair', why: 'Restore her promise.', mutations: [{ type: 'people.note', name: 'Princess Alexia', field: 'thread', text: 'bring the sealed letter tomorrow', shown: 'Princess Alexia promises to bring the sealed letter tomorrow.' }] }] }), async () => {
    const r = await auditLedger({ connection, storyId: id });
    assert((await loadState(id)).characters['Princess Alexia'].threads.some((t) => /sealed letter/.test(t)), 'the repair lands');
    assert(!r.unfinished, 'the matching completed repair clears the earlier finding');
  });
});

test('M685-19 a disproved earlier concern can be withdrawn only with actual source evidence', async () => {
  const id = await tale('m685-withdraw', { page: 'Princess Alexia has made no promise about the letter.', mutations: [{ type: 'people.set', name: 'Princess Alexia', field: 'core', text: 'Second Princess.' }] });
  /* as in M685-18: under M709 only a repair the engine still refuses leaves the concern unresolved */
  await wire(() => reviewed({ issues: [{ what: 'Her personal promise is missing.', mutations: [{ type: 'people.promise', name: 'Princess Alexia', text: 'Bring the letter.' }] }] }), () => auditLedger({ connection, storyId: id }));
  /* the current withdrawal shape: repairs:[{id, status:"correct", shown, why}] for the checklist's finding id */
  const withdraw = (shown) => (b) => reviewed({ repairs: [{ id: historical(b).find((f) => /promise/.test(f.what)).id, status: 'correct', shown, why: 'The previous reading invented a promise.' }] });
  await wire(withdraw('She promised nothing.'), async () => assert((await auditLedger({ connection, storyId: id })).unfinished, 'an invented quotation cannot close it'));
  await wire(withdraw('Princess Alexia has made no promise about the letter.'), async () => assert(!(await auditLedger({ connection, storyId: id })).unfinished, 'a source-backed withdrawal closes the mistaken concern'));
});

test('M685-20 source recovery never overwrites a newer core written by another worker while the audit waits', async () => {
  const id = await tale('m685-worker-core');
  await wire(async (b) => {
    if (reading(b)) {
      const docs = sourceDocs(b); const d = docs.find((s) => passageIn(s, 'Princess Alexia is'));
      return { checked: docs.map((s) => s.id), people: [sourcePerson(d, 'Princess Alexia', 'Princess Alexia is', ['Second Princess'])] };
    }
    /* another worker writes a fuller core (not by hand) while the review's own profile recovery is out */
    const st = await loadState(id);
    await saveState(id, applyMutations(st, [{ type: 'people.set', name: 'Princess Alexia', field: 'core', text: 'Second Princess and keeper of the royal archives.' }]).state);
    return reviewed({ profiles: [{ name: 'Princess Alexia', core: { text: 'Second Princess.', shown: 'Princess Alexia is the Second Princess.' } }],
      identities: sourceTasks(b).map((task) => ({ sourceId: task.sourceId, name: task.name, to: 'Princess Alexia', kind: 'person', why: 'The writer introduces her by name and rank.' })) });
  }, async () => {
    await auditLedger({ connection, storyId: id, reviewSources: 'all' });
    assert((await loadState(id)).characters['Princess Alexia'].core.includes('royal archives'), 'source recovery fills gaps only');
  });
});

test('M685-21 an edited brief invalidates the audit answer still in flight', async () => {
  const id = await tale('m685-brief-stale');
  await db.stories.update(id, { brief: 'Princess Alexia is the Second Princess.' });
  await wire(async () => {
    await db.stories.update(id, { brief: 'Princess Alexia is the First Princess.' });
    return { issues: [{ what: 'Her rank is missing.', mutations: [{ type: 'canon.lock', name: 'Princess Alexia', key: 'rank', value: 'Second Princess' }] }] };
  }, async () => {
    const r = await auditLedger({ connection, storyId: id, brief: 'Princess Alexia is the Second Princess.' });
    eq(r, null, 'obsolete brief abandons the answer');
    assert(!(await loadState(id)).canon['Princess Alexia']);
  });
});

test('M685-22 a successful world placement without a story clock does not remain perpetually overdue', async () => {
  const id = await tale('m685-no-clock', { mutations: [{ type: 'people.set', name: 'Prince Caelan', field: 'core', text: 'Third Prince at the northern estate.' }] });
  await saveState(id, { ...(await loadState(id)), clock: null });
  await wire(() => ({ mutations: [{ type: 'offscreen.set', name: 'Prince Caelan', location: 'the northern estate', activity: 'reading dispatches' }], brief: { pressure: [], ripe: [], twb: null } }), async (calls) => {
    const r = await worldTurn({ connection, storyId: id, userText: 'I read.', assistantText: 'The fire flickers in the salon.', brief: 'Prince Caelan is at the northern estate.' });
    assert(!r.pending?.length, 'without a clock there is no elapsed time proving this new seat overdue');
    eq(calls.length, 1, 'a complete first answer does not earn a redundant followup');
  });
});

test('M685-23 an auditor followup cannot duplicate an already completed first-pass repair', async () => {
  const id = await tale('m685-repeat');
  await wire(() => ({ issues: [
    { what: 'Her rank is missing.', mutations: [{ type: 'people.set', name: 'Princess Alexia', field: 'core', text: 'Second Princess.' }] },
    { what: 'A promise is missing.', mutations: [{ type: 'unknown.promise', name: 'Princess Alexia' }] },
  ] }), async () => {
    const r = await auditLedger({ connection, storyId: id });
    eq(r.applied.filter((a) => a.mutation.type === 'people.set').length, 1, 'the correction lands once');
    eq((await loadState(id)).journal.filter((j) => j.m.type === 'people.set' && j.m.name === 'Princess Alexia').length, 1, 'no duplicate history');
  });
});

test('M685-24 a failed main audit preserves completed source recovery and its receipts for the next attempt', async () => {
  const id = await tale('m685-source-network'); let reads = 0;
  await wire((b) => {
    if (reading(b)) {
      reads++;
      const docs = sourceDocs(b); const d = docs.find((s) => passageIn(s, 'Princess Alexia is'));
      return { checked: docs.map((s) => s.id), people: [sourcePerson(d, 'Princess Alexia', 'Princess Alexia is', ['Second Princess'])] };
    }
    throw new Error('fixture connection lost');
  }, async () => {
    const r = await auditLedger({ connection, storyId: id, reviewSources: 'all' });
    assert(r.unfinished, 'the interrupted reading is not complete');
    /* M699: the finished source work is the saved receipt and the repair target it owes the review */
    const kept = Object.values((await loadState(id)).auditSources || {}).flatMap((receipt) => receipt.people || []).find((p) => p.name === 'Princess Alexia');
    assert(kept?.identityFacts.some((f) => f.text === 'Second Princess') && r.pending.some((p) => p.includes('Princess Alexia')), 'the finished source work survives');
  });
  await wire((b) => {
    /* counted here too: a throw inside the mock would only look like a failed transport to the source reader */
    if (reading(b)) { reads++; return { checked: sourceDocs(b).map((s) => s.id), people: [] }; }
    const tasks = sourceTasks(b);
    return reviewed({ profiles: [{ name: 'Princess Alexia', core: { text: 'Second Princess.', shown: 'Princess Alexia is the Second Princess.' } }],
      identities: tasks.map((task) => ({ sourceId: task.sourceId, name: task.name, to: 'Princess Alexia', kind: 'person', why: 'The writer introduces her by name and rank.' })) });
  }, async (calls) => {
    await auditLedger({ connection, storyId: id, reviewSources: 'all' });
    assert(!calls.some(reading), 'unchanged sources are not paid for twice');
    assert(sourceTasks(calls[0]).some((task) => task.name === 'Princess Alexia'), 'the kept receipt hands her to the next review');
    assert((await loadState(id)).characters['Princess Alexia']?.core.includes('Second Princess'), 'the next attempt completes the recovery from the kept receipts');
  });
  eq(reads, 1);
});

test('M685-25 original pages are divided to fit a small auditor context instead of remaining unread forever', async () => {
  const quote = 'Princess Alexia is the Second Princess.';
  const id = await tale('m685-small-source', { input: 'The palace is quiet. '.repeat(800) + quote, page: 'She smiles.' });
  await wire((b) => {
    if (!reading(b)) {
      /* M699/M718: the reading hands her to the review, which records the new identity with its source binding */
      const tasks = sourceTasks(b);
      return reviewed({ profiles: [{ name: 'Princess Alexia', core: { text: 'Second Princess.', shown: quote } }],
        identities: tasks.map((task) => ({ sourceId: task.sourceId, name: task.name, to: 'Princess Alexia', kind: 'person', why: 'The writer introduces her by name and rank.' })) });
    }
    const docs = sourceDocs(b);
    return { checked: docs.map((s) => s.id), people: docs.filter((s) => passageIn(s, quote)).map((s) => sourcePerson(s, 'Princess Alexia', quote, ['Second Princess'])) };
  }, async () => {
    /* M737: a request that exceeds its connection's context after reserving the answer is refused before transport, so
     * 8000 tokens can no longer carry even the combined review (about 16,500 estimated input tokens here). 27000 is a
     * small room that carries the review and one original section with its answer allowance, but not M714's packing share. */
    const r = await auditLedger({ connection: { ...connection, contextSize: 27000 }, storyId: id, reviewSources: 'all' });
    assert((await loadState(id)).characters['Princess Alexia'], 'the introduction at the end is read');
    const coverage = (await loadState(id)).audit.coverage;
    eq(coverage.read, coverage.total, 'every original section fits and receives a receipt');
    assert(!r.unfinished);
  });
});

test('M685-26 a complete audit answer never silently drops findings after the twentieth', async () => {
  const { parseAuditorAnswer } = await import('../../js/agents/auditor.js');
  const answer = { issues: Array.from({ length: 25 }, (_, i) => ({ what: 'Source correction ' + i, mutations: [{ type: 'canon.lock', name: 'Princess Alexia', key: 'fact ' + i, value: 'value ' + i }] })) };
  eq(parseAuditorAnswer(JSON.stringify(answer)).issues.length, 25, 'every complete finding reaches validation');
});

test('M685-27 a valid JSON prefix cut off by the provider is not certified as a complete audit', async () => {
  const id = await tale('m685-cut-prefix', { mutations: [{ type: 'people.set', name: 'Princess Alexia', field: 'core', text: 'Second Princess.' }] });
  const old = globalThis.fetch;
  globalThis.fetch = async () => new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: '{"issues":[]}' } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] }) + '\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  try {
    const r = await auditLedger({ connection, storyId: id });
    assert(r.unfinished && r.pending.length, 'provider truncation remains unfinished despite parseable JSON');
  } finally { globalThis.fetch = old; }
});

test('M685-28 stopping a worker that preserves partial work and returns normally is still reported as stopped', async () => {
  const { enqueueWork, stopWork, workIsRunning } = await import('../../js/agents/queue.js');
  const id = 'm685-stop-partial'; let started;
  const ready = new Promise((r) => { started = r; });
  const job = enqueueWork(id, { name: 'auditor', run: ({ signal }) => new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve({ detail: 'partial work saved', unfinished: true }), { once: true });
    started();
  }) });
  await ready; stopWork(id);
  const result = await job;
  assert(result.stopped && !result.ok, 'Stop must not become a successful completed audit');
  assert(!workIsRunning(id), 'the stopped worker releases its lane');
});

test('M685-29 an aborted original-source audit propagates the interruption instead of returning an empty success', async () => {
  const id = await tale('m685-timeout-source');
  const controller = new AbortController();
  controller.abort(new Error('timeout'));
  let failed = false;
  try { await auditLedger({ connection, storyId: id, signal: controller.signal, reviewSources: 'all' }); }
  catch (err) { failed = err.message === 'timeout'; }
  assert(failed, 'the source audit preserves the timeout for the queue and banner');
  assert(!(await loadState(id)).audit, 'an interrupted source reading is not saved as complete');
});


test('M685-30 a repeated page correction in the followup is mended and reported only once', async () => {
  const id = await tale('m685-repeat-page', { page: 'Princess Alexia is called the Fourth Princess.' });
  const findings = [
    { what: 'The page gives Alexia the wrong rank.', fix: 'Princess Alexia is the Second Princess.', pages: true, mutations: [{ type: 'canon.lock', name: 'Princess Alexia', key: 'rank', value: 'Second Princess' }] },
    { what: 'A promise is missing.', mutations: [{ type: 'unknown.promise', name: 'Princess Alexia' }] },
  ];
  /* the completion restates both findings of the reply it completes */
  await wire((b) => completing(b) ? reviewed({ issues: findings }) : { issues: findings }, async (calls) => {
    const r = await auditLedger({ connection, storyId: id });
    eq(calls.length, 2, 'the reply without a verdict is completed once, in the same review');
    eq(r.issues.filter((i) => i.pages && i.fix).length, 1, 'only one page mend is requested for the repeated correction');
    eq(r.applied.filter((a) => a.mutation.type === 'canon.lock').length, 1, 'the associated ledger repair also lands once');
    assert(r.unfinished && r.pending.some((p) => p.includes('promise')), 'deduplication does not hide the separate unresolved promise');
  });
});

test('M685-31 a completion that only adds the missing verdict keeps the repairs its reply already gave', async () => {
  /* M708: the completion prompt keeps "the sources and decisions already in this conversation"; answering only the
   * missing verdict must not drop the reply's repair and then certify the unrepaired ledger */
  const id = await tale('m685-verdict-only', { mutations: [{ type: 'presence.enter', name: 'Princess Alexia' }, { type: 'people.set', name: 'Princess Alexia', field: 'core', text: 'An established person.' }] });
  await wire((b) => completing(b) ? reviewed()
    : { issues: [{ what: 'Her rank is missing from her record.', mutations: [{ type: 'canon.lock', name: 'Princess Alexia', key: 'rank', value: 'Second Princess' }] }] }, async (calls) => {
    const r = await auditLedger({ connection, storyId: id });
    eq(calls.filter(completing).length, 1, 'one completion turn');
    assert((await loadState(id)).canon['Princess Alexia']?.facts.some((f) => f.value === 'Second Princess'), 'the repair the reply gave lands');
    assert(!r.unfinished, 'the completed verdict approves the repaired ledger, not the one without its repair');
  });
});
