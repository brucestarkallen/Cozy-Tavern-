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

test('M685-1 the auditor repairs a known missing People page even when its first answer reports no issues', async () => {
  const id = await tale('m685-known', { mutations: [{ type: 'presence.enter', name: 'Princess Alexia' }] });
  await wire((b) => sent(b).includes('REPAIR FOLLOWUP') ? { issues: [{ what: 'Princess Alexia has no People page.', mutations: [{ type: 'people.set', name: 'Princess Alexia', field: 'core', text: 'Second Princess.' }] }] } : { issues: [] }, async (calls) => {
    await auditLedger({ connection, storyId: id });
    assert((await loadState(id)).characters['Princess Alexia']?.core.includes('Second Princess'), 'a current companion receives her missing character record');
    eq(calls.length, 2, 'one targeted recovery, not an unbounded audit loop');
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
    if (!t.includes('SOURCE PEOPLE REVIEW')) {
      assert(t.includes('IDENTITIES RECOVERED FROM ORIGINAL SOURCES') && t.includes('core: ' + quote), 'the normal auditor sees recovered identities even when summaries lost them');
      return { issues: [] };
    }
    assert(t.includes(quote), 'the original introduction is read even when the summary lost it');
    const sources = JSON.parse(t.split('SOURCE DOCUMENTS\n')[1]);
    const source = sources.find((s) => s.text.includes(quote));
    return { checked: sources.map((s) => s.id), people: [{ name: 'Princess Alexia', source: source.id, shown: quote }, { name: 'Prince Caelan', source: source.id, shown: quote }] };
  }, async () => {
    await auditLedger({ connection, storyId: id, reviewSources: 'all' });
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
  await wire((b) => sent(b).includes('REPAIR FOLLOWUP') ? { issues: [{ what: 'Her established name is Princess Alexia.', mutations: [{ type: 'people.rename', from: 'Alexia Woman', to: 'Princess Alexia', cause: 'the writer names her Princess Alexia' }] }] } : { issues: [{ what: 'Alexia Woman is the wrong name.', mutations: [{ type: 'people.forget', name: 'Alexia Woman', cause: 'wrong name' }] }] }, async (calls) => {
    const r = await auditLedger({ connection, storyId: id });
    const st = await loadState(id);
    assert(st.characters['Princess Alexia'], 'the correct name is actually restored');
    assert(st.knowledge['Princess Alexia']?.length, 'her knowledge survives');
    assert(sent(calls[1]).includes('correct their name'), 'the model receives the actual reason its first attempt could not land');
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
  const id = await tale('m685-pending', { mutations: [{ type: 'presence.enter', name: 'Princess Alexia' }] });
  await wire(() => ({ issues: [] }), async (calls) => {
    const r = await auditLedger({ connection, storyId: id });
    assert(r.unfinished && r.pending?.some((p) => p.includes('Princess Alexia')), 'the omission is retained by name');
    assert((await loadState(id)).audit?.pending?.length, 'the next audit can see the unfinished work');
    assert(!/ledger is true/.test(auditRunWords(r)), 'no false completion');
    eq(calls.length, 2, 'the audit does not retry without limit');
  });
});

test('M685-6 a failed repair followup preserves useful first-pass corrections', async () => {
  const id = await tale('m685-followup-fails', { mutations: [{ type: 'presence.enter', name: 'Princess Alexia' }] });
  await wire((b) => {
    if (sent(b).includes('REPAIR FOLLOWUP')) throw new Error('fixture network interruption');
    return { issues: [{ what: 'Her rank was missing.', mutations: [{ type: 'canon.lock', name: 'Princess Alexia', key: 'rank', value: 'Second Princess' }] }] };
  }, async () => {
    const r = await auditLedger({ connection, storyId: id });
    assert((await loadState(id)).canon['Princess Alexia']?.facts.some((f) => f.value === 'Second Princess'), 'valid first-pass work survives');
    assert(r.unfinished, 'failed recovery remains unfinished');
  });
});

test('M685-7 an automatic audit reuses unchanged source receipts but checks edited source text again', async () => {
  const id = await tale('m685-receipts'); let sourceCalls = 0;
  await wire((b) => {
    const t = sent(b); if (!t.includes('SOURCE PEOPLE REVIEW')) return { issues: [] };
    sourceCalls++;
    const sources = JSON.parse(t.split('SOURCE DOCUMENTS\n')[1]);
    const source = sources.find((s) => s.text.includes('Princess Alexia'));
    return { checked: sources.map((s) => s.id), people: source ? [{ name: 'Princess Alexia', source: source.id, shown: 'Princess Alexia is the Second Princess.' }] : [] };
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
    const t = sent(b); if (!t.includes('SOURCE PEOPLE REVIEW')) return { issues: [] };
    const sources = JSON.parse(t.split('SOURCE DOCUMENTS\n')[1]);
    const source = sources.find((s) => s.text.includes('Princess Alexia is'));
    await db.messages.update(id, id + 'u', { text: 'I read quietly alone.' });
    await db.messages.update(id, id + 'a', { text: 'The fire flickers.' });
    return { checked: sources.map((s) => s.id), people: [{ name: 'Princess Alexia', source: source.id, shown: 'Princess Alexia is the Second Princess.' }] };
  }, async () => {
    const r = await auditLedger({ connection, storyId: id, reviewSources: 'all' });
    eq(r, null, 'changed source abandons the obsolete answer');
    assert(!(await loadState(id)).characters['Princess Alexia']);
  });
});

test('M685-14 an unrelated followup correction cannot hide the first unresolved finding', async () => {
  const id = await tale('m685-unrelated', { mutations: [{ type: 'people.set', name: 'Princess Alexia', field: 'core', text: 'Second Princess.' }] });
  await wire((b) => sent(b).includes('REPAIR FOLLOWUP')
    ? { issues: [{ what: 'Her hair is recorded.', mutations: [{ type: 'canon.lock', name: 'Princess Alexia', key: 'hair', value: 'silver' }] }] }
    : { issues: [{ what: 'Her personal promise is missing.', mutations: [{ type: 'unknown.promise', name: 'Princess Alexia', text: 'Bring the letter.' }] }] }, async () => {
    const r = await auditLedger({ connection, storyId: id });
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
  await wire(async (b) => {
    const t = sent(b);
    if (t.includes('SOURCE PEOPLE REVIEW')) {
      const docs = JSON.parse(t.split('SOURCE DOCUMENTS\n')[1]); const d = docs.find((x) => x.text.includes('Princess Alexia is'));
      return { checked: docs.map((x) => x.id), people: [{ name: 'Princess Alexia', source: d.id, shown: 'Princess Alexia is the Second Princess.' }] };
    }
    await saveState(id, applyMutations(await loadState(id), [{ type: 'people.set', name: 'Princess Alexia', field: 'core', text: 'Second Princess, keeper of the treaty and royal envoy.', byHand: true }]).state);
    return { issues: [] };
  }, async () => {
    await auditLedger({ connection, storyId: id, reviewSources: 'all' });
    assert((await loadState(id)).characters['Princess Alexia'].core.includes('royal envoy'), 'the new complete identity is preserved');
  });
});

test('M685-17 a useful source recovery survives an unusable main audit answer', async () => {
  const id = await tale('m685-auditor-bad');
  await wire((b) => {
    const t = sent(b); if (!t.includes('SOURCE PEOPLE REVIEW')) return 'not valid JSON';
    const docs = JSON.parse(t.split('SOURCE DOCUMENTS\n')[1]); const d = docs.find((x) => x.text.includes('Princess Alexia is'));
    return { checked: docs.map((x) => x.id), people: [{ name: 'Princess Alexia', source: d.id, shown: 'Princess Alexia is the Second Princess.' }] };
  }, async () => {
    const r = await auditLedger({ connection, storyId: id, reviewSources: 'all' });
    assert((await loadState(id)).characters['Princess Alexia'], 'the verified source restoration is not thrown away');
    assert(r.unfinished, 'the remaining audit is still incomplete');
  });
});

test('M685-18 an unresolved finding survives a later empty audit and clears only when its repair lands', async () => {
  const id = await tale('m685-persistent', { page: 'Princess Alexia promises to bring the sealed letter tomorrow.', mutations: [{ type: 'people.set', name: 'Princess Alexia', field: 'core', text: 'Second Princess.' }] });
  await wire(() => ({ issues: [{ what: 'Her personal promise is missing.', mutations: [{ type: 'people.note', name: 'Princess Alexia', field: 'thread', text: 'Bring the sealed letter tomorrow.' }] }] }), () => auditLedger({ connection, storyId: id }));
  await wire(() => ({ issues: [] }), async () => {
    const r = await auditLedger({ connection, storyId: id });
    assert(r.unfinished && r.pending.some((p) => /promise/.test(p)), 'an empty subsequent answer cannot erase unfinished work');
  });
  await wire(() => ({ issues: [{ what: 'Restore her promise.', mutations: [{ type: 'people.note', name: 'Princess Alexia', field: 'thread', text: 'bring the sealed letter tomorrow', shown: 'Princess Alexia promises to bring the sealed letter tomorrow.' }] }] }), async () => {
    const r = await auditLedger({ connection, storyId: id });
    assert(!r.unfinished, 'the matching completed repair clears the earlier finding');
  });
});

test('M685-19 a disproved earlier concern can be withdrawn only with actual source evidence', async () => {
  const id = await tale('m685-withdraw', { page: 'Princess Alexia has made no promise about the letter.', mutations: [{ type: 'people.set', name: 'Princess Alexia', field: 'core', text: 'Second Princess.' }] });
  await wire(() => ({ issues: [{ what: 'Her personal promise is missing.', mutations: [{ type: 'people.note', name: 'Princess Alexia', field: 'thread', text: 'Bring the letter.' }] }] }), () => auditLedger({ connection, storyId: id }));
  await wire(() => ({ issues: [], resolved: [{ what: 'Her personal promise is missing.', shown: 'She promised nothing.', why: 'The previous reading invented a promise.' }] }), async () => assert((await auditLedger({ connection, storyId: id })).unfinished, 'an invented quotation cannot close it'));
  await wire(() => ({ issues: [], resolved: [{ what: 'Her personal promise is missing.', shown: 'Princess Alexia has made no promise about the letter.', why: 'The previous reading invented a promise.' }] }), async () => assert(!(await auditLedger({ connection, storyId: id })).unfinished, 'a source-backed withdrawal closes the mistaken concern'));
});

test('M685-20 source recovery never overwrites a newer core written by another worker while the audit waits', async () => {
  const id = await tale('m685-worker-core');
  await wire(async (b) => {
    const t = sent(b);
    if (t.includes('SOURCE PEOPLE REVIEW')) {
      const docs = JSON.parse(t.split('SOURCE DOCUMENTS\n')[1]); const d = docs.find((s) => s.text.includes('Princess Alexia is'));
      return { checked: docs.map((s) => s.id), people: [{ name: 'Princess Alexia', source: d.id, shown: 'Princess Alexia is the Second Princess.' }] };
    }
    const st = await loadState(id);
    await saveState(id, applyMutations(st, [{ type: 'people.set', name: 'Princess Alexia', field: 'core', text: 'Second Princess and keeper of the royal archives.' }]).state);
    return { issues: [] };
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
    const t = sent(b);
    if (t.includes('SOURCE PEOPLE REVIEW')) {
      reads++;
      const docs = JSON.parse(t.split('SOURCE DOCUMENTS\n')[1]); const d = docs.find((s) => s.text.includes('Princess Alexia is'));
      return { checked: docs.map((s) => s.id), people: [{ name: 'Princess Alexia', source: d.id, shown: 'Princess Alexia is the Second Princess.' }] };
    }
    throw new Error('fixture connection lost');
  }, async () => {
    const r = await auditLedger({ connection, storyId: id, reviewSources: 'all' });
    assert(r.unfinished, 'the interrupted reading is not complete');
    assert((await loadState(id)).characters['Princess Alexia'], 'the finished source work survives');
  });
  await wire((b) => { assert(!sent(b).includes('SOURCE PEOPLE REVIEW'), 'unchanged sources are not paid for twice'); return { issues: [] }; }, () => auditLedger({ connection, storyId: id, reviewSources: 'all' }));
  eq(reads, 1);
});

test('M685-25 original pages are divided to fit a small auditor context instead of remaining unread forever', async () => {
  const quote = 'Princess Alexia is the Second Princess.';
  const id = await tale('m685-small-source', { input: 'The palace is quiet. '.repeat(800) + quote, page: 'She smiles.' });
  await wire((b) => {
    const t = sent(b); if (!t.includes('SOURCE PEOPLE REVIEW')) return { issues: [] };
    const docs = JSON.parse(t.split('SOURCE DOCUMENTS\n')[1]);
    return { checked: docs.map((s) => s.id), people: docs.filter((s) => s.text.includes(quote)).map((s) => ({ name: 'Princess Alexia', source: s.id, shown: quote })) };
  }, async () => {
    const r = await auditLedger({ connection: { ...connection, contextSize: 8000 }, storyId: id, reviewSources: 'all' });
    assert((await loadState(id)).characters['Princess Alexia'], 'the introduction at the end is read');
    const coverage = (await loadState(id)).audit.coverage;
    eq(coverage.read, coverage.total, 'every original section fits and receives a receipt');
    assert(!r.unfinished);
  });
});
