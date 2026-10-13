/* Cozy Tavern — a child process of tests/harness/m752-spelling.mjs (laws M752-S1, S2, S4, S6, S7, S9), never a law by itself.
 * The Housekeeper's spelling correction and its take-back are one atomic story edit each (store.js editStoryAtomically). The
 * harness's own IndexedDB stand-in (idb-shim.mjs) ends a transaction before its requests answer, so such an edit cannot run
 * in the harness process: this runs the real modules over fake-indexeddb and prints what came back, as one line of JSON, for
 * the law to hold. Usage: node m752-spelling-card.mjs <scenario>. */
import { createRequire } from 'node:module';
createRequire(new URL('../../dom/package.json', import.meta.url))('fake-indexeddb/auto');
const { db } = await import('../../../js/store.js');
const { emptyState, loadState, saveState, foldJournal, withStoryWrites } = await import('../../../js/engine/state.js');
const { applyMutations } = await import('../../../js/engine/apply.js');
const hk = await import('../../../js/agents/housekeeper.js');

async function tale({ brief = '', pages = [], record = null, state }) {
  const story = await db.stories.create({ title: 'M752 spelling' });
  if (brief) await db.stories.update(story.id, { brief });
  let ts = 1000;
  for (const p of pages) await db.messages.append(story.id, { ts: ts++, ...p });
  if (record) await db.settings.set('memory:' + story.id, { nodes: record });
  await saveState(story.id, state);
  return story.id;
}
/* the writer asks; the Housekeeper answers with one name.spelling card (its model is a stub); Apply all lands it */
async function correct(id, from, to) {
  const turn = await hk.housekeeperTurn({ storyId: id, writerText: 'Correct ' + from + ' to ' + to + ' everywhere.', call: async () => ({ text: 'One correction. <corrections>[{"type":"name.spelling","from":"' + from + '","to":"' + to + '","scope":"story","reason":"the writer: the name is spelled ' + to + '"}]</corrections>' }) });
  if (!turn.ok) throw new Error('the housekeeper did not answer: ' + turn.error);
  const r = await hk.applyAllPending(turn.session, id);
  const card = hk.findProposal(await hk.loadSession(id), turn.proposals[0].id);
  return { result: { applied: r.applied, rejected: r.rejected, partial: r.partial, words: r.words }, card: { status: card.status, words: card.words, verification: card.verification || null } };
}
async function contentOf(id) {
  const st = await loadState(id);
  return JSON.stringify({ brief: (await db.stories.get(id)).brief, pages: (await db.messages.list(id)).map((m) => [m.text, (m.swipes || []).map((v) => v.text)]), record: (await db.settings.get('memory:' + id))?.nodes, characters: st.characters, knowledge: st.knowledge, threads: st.threads, corrections: st.spellingCorrections || {} });
}
const texts = async (id) => (await db.messages.list(id)).map((m) => m.text);
const ledger = (people, more = []) => applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Jovan' }, ...people.map((p) => ({ type: 'people.set', field: 'core', byHand: true, ...p })), ...more]).state;
/* pages of play that never touch the corrected person: four ledger lines each, so the log (its newest 200) rolls over */
async function playOn(id, pages) {
  let st = await loadState(id);
  const start = st.page + 1;
  for (let i = 0; i < pages; i += 1) st = applyMutations({ ...st, page: start + i }, [
    { type: 'clock.advance', minutes: 10, reason: 'time passes' },
    { type: 'knowledge.add', name: 'Jovan', fact: 'Passing fact ' + i },
    { type: 'presence.enter', name: 'Passerby ' + i },
    { type: 'presence.leave', name: 'Passerby ' + i },
  ]).state;
  await saveState(id, st);
  return st;
}

const scenarios = {
  /* S1: names that are also words, refused before anything changes */
  async ordinary() {
    const out = {};
    const cases = {
      may: { from: 'May', to: 'Mae', tale: { brief: 'May is a healer. You may rest here.', pages: [
        { id: 'm752s1u', role: 'user', text: 'I tell May she may leave whenever she likes.' },
        { id: 'm752s1a', role: 'assistant', text: '“You may go,” May said. It was the first of May.', swipes: [{ text: '“You may go,” May said. It was the first of May.' }] },
      ], record: [{ id: 'n1', span: [0, 1], text: 'May says he may stay.' }], state: ledger([{ name: 'May', text: 'A healer from the north.' }], [{ type: 'people.note', name: 'May', field: 'thread', text: 'May may leave the inn tonight' }]) } },
      rose: { from: 'Rose', to: 'Roze', tale: { pages: [{ id: 'm752s1r', role: 'assistant', text: 'Rose rose from her seat and crossed to the window.' }], state: ledger([{ name: 'Rose', text: 'A gardener.' }]) } },
      young: { from: 'Will', to: 'Wil', tale: { brief: 'Will keeps the gate. You will rest here until the snow melts.', pages: [{ id: 'm752s1w', role: 'user', text: 'I ask Will for a room.' }], state: ledger([{ name: 'Will', text: 'The gatekeeper.' }]) } },
      typed: { from: 'aakeno', to: 'Akeno', tale: { pages: [{ id: 'm752s1t', role: 'assistant', text: 'Aakeno waits.' }], state: ledger([{ name: 'Aakeno', text: 'A scholar.' }]) } },
    };
    for (const [key, c] of Object.entries(cases)) {
      const id = await tale(c.tale);
      const before = await contentOf(id);
      const { result, card } = await correct(id, c.from, c.to);
      out[key] = { result, card, unchanged: (await contentOf(id)) === before };
    }
    return out;
  },
  /* S2: the name as written and in capitals; every word that only shares its letters kept */
  async name() {
    const id = await tale({ brief: 'Aakeno may come. AAKENO is the name on the gate.', pages: [
      { id: 'm752s2u', role: 'user', text: 'I greet Aakeno; you may sit. aakeno, I typed.' },
      { id: 'm752s2a', role: 'assistant', text: '“AAKENO!” she called. Aakeno’s book lay open; you may read it.', swipes: [{ text: 'Aakeno waits.' }, { text: '“AAKENO!” she called. Aakeno’s book lay open; you may read it.' }], swipeIdx: 1 },
    ], record: [{ id: 'n2', span: [0, 1], text: 'Aakeno arrived. He may stay.' }], state: ledger([{ name: 'Aakeno', text: 'Aakeno may be a scholar.' }], [{ type: 'knowledge.add', name: 'Jovan', fact: 'AAKENO is carved on the gate' }]) });
    const { result, card } = await correct(id, 'Aakeno', 'Akeno');
    const pages = await db.messages.list(id);
    const st = await loadState(id);
    return { result, card, brief: (await db.stories.get(id)).brief, page0: pages[0].text, page1: pages[1].text, versions: pages[1].swipes.map((v) => v.text),
      record: (await db.settings.get('memory:' + id)).nodes[0].text, core: st.characters.Akeno?.core ?? null, oldPage: Boolean(st.characters.Aakeno), fact: st.knowledge.Jovan[0].fact };
  },
  /* S4: a correction onto a fuller name, said once — then a later write, two folds and a story write laid over an older ledger */
  async fuller() {
    const id = await tale({ pages: [
      { id: 'm752s4a', role: 'assistant', text: 'Renji smiled. Renji Abarai bowed to the captain.', swipes: [{ text: 'Renji smiled. Renji Abarai bowed to the captain.' }] },
    ], record: [{ id: 'n4', span: [0, 0], text: 'Renji Abarai bowed; Renji smiled.' }], state: ledger([{ name: 'Renji', text: 'Renji is lieutenant of the Sixth Division.' }], [{ type: 'people.note', name: 'Renji', field: 'thread', text: 'owes Renji Abarai’s captain a report' }]) });
    const older = await loadState(id);
    const { result, card } = await correct(id, 'Renji', 'Renji Abarai');
    if (result.applied !== 1) return { result, card }; /* the law says why */
    const page = (await db.messages.list(id))[0];
    let st = await loadState(id);
    const out = { result, card, page: page.text, version: page.swipes[0].text, record: (await db.settings.get('memory:' + id)).nodes[0].text,
      core: st.characters['Renji Abarai']?.core ?? null, threadsAfter: st.characters['Renji Abarai']?.threads ?? null };
    const later = applyMutations({ ...st, page: 2 }, [{ type: 'people.note', name: 'Renji Abarai', field: 'thread', text: 'will meet Renji Abarai’s sister at the gate' }, { type: 'people.note', name: 'Renji', field: 'thread', text: 'Renji lost his sword at the river' }, { type: 'rel.shift', name: 'Renji', axis: 'p', delta: 5, cause: 'Ichigo saved him' }]);
    st = later.state;
    out.laterRejected = later.rejected.map((x) => x.why);
    out.threadsLater = st.characters['Renji Abarai'].threads;
    out.relationships = Object.keys(st.relationships);
    const fold = foldJournal(st, [], 2, applyMutations);
    out.foldSame = JSON.stringify(fold.characters['Renji Abarai']) === JSON.stringify(st.characters['Renji Abarai']);
    out.foldTwiceThreads = foldJournal(fold, [], 2, applyMutations).characters['Renji Abarai'].threads;
    const laid = withStoryWrites(older, st, applyMutations);
    out.laidCore = laid.characters['Renji Abarai']?.core ?? null;
    out.laidThreads = laid.characters['Renji Abarai']?.threads ?? null;
    return out;
  },
  /* S6: seventy pages on, the log line gone, the take-back from the receipt */
  async rollover() {
    const id = await tale({ brief: 'Riass leads the club.', pages: [{ id: 'm752s6a', role: 'assistant', text: 'Riass smiled at him.', swipes: [{ text: 'Riass smiled at him.' }] }], record: [{ id: 'n6', span: [0, 0], text: 'Riass smiled.' }],
      state: ledger([{ name: 'Riass', text: 'Riass is the heiress of the Gremory house.' }], [{ type: 'rel.shift', name: 'Riass', axis: 'p', delta: 5, cause: 'she trusts him' }, { type: 'knowledge.add', name: 'Jovan', fact: 'Riass keeps a chess set' }]) });
    const before = await loadState(id);
    const { result, card } = await correct(id, 'Riass', 'Rias');
    if (result.applied !== 1) return { result, card }; /* the law says why */
    const corrected = await loadState(id);
    const line = corrected.log.find((e) => e.undo && e.undo.coordinated);
    const played = await playOn(id, 70);
    const out = { result, card, lineStood: Boolean(line && corrected.characters.Rias), lineGone: !played.log.some((e) => e.jid === line.jid) };
    const undone = await hk.undoLatest(await hk.loadSession(id), id);
    const st = await loadState(id);
    const back = st.journal.at(-1);
    const fold = foldJournal(st, [], st.page, applyMutations);
    return { ...out, undo: { ok: undone.ok, words: undone.words }, brief: (await db.stories.get(id)).brief, page: (await texts(id))[0], record: (await db.settings.get('memory:' + id)).nodes[0].text,
      pageBack: Boolean(st.characters.Riass && !st.characters.Rias), coreBack: st.characters.Riass?.core === before.characters.Riass.core,
      standingBack: JSON.stringify(st.relationships.Riass) === JSON.stringify(before.relationships.Riass), firstFact: st.knowledge.Jovan[0].fact,
      laterFactsKept: JSON.stringify(st.knowledge.Jovan.slice(1)) === JSON.stringify(played.knowledge.Jovan.slice(1)) && st.knowledge.Jovan.length === played.knowledge.Jovan.length,
      laterPagesKept: JSON.stringify(Object.keys(st.characters).filter((k) => k !== 'Riass')) === JSON.stringify(Object.keys(played.characters).filter((k) => k !== 'Rias')),
      map: st.spellingCorrections || {}, journalBack: { type: back.m.type, p: back.p, story: back.m.story === true, linePage: line.page },
      logBack: st.log.at(-1).words === 'Taken back — ' + line.words,
      foldSame: ['characters', 'relationships', 'knowledge'].every((b) => JSON.stringify(fold[b]) === JSON.stringify(st[b])), foldMap: fold.spellingCorrections || {},
      receiptUndone: Boolean((await hk.loadSession(id)).batches.at(-1).undone) };
  },
  /* S7: a corrected part that moved since refuses, named; a receipt from before M752 says what it could not take back */
  async refusals() {
    const fresh = async (pageId) => {
      const id = await tale({ brief: 'Riass leads the club.', pages: [{ id: pageId, role: 'assistant', text: 'Riass smiled at him.', swipes: [{ text: 'Riass smiled at him.' }] }], record: [{ id: 'n7', span: [0, 0], text: 'Riass smiled.' }],
        state: ledger([{ name: 'Riass', text: 'Riass is the heiress of the Gremory house.' }]) });
      const { result } = await correct(id, 'Riass', 'Rias');
      return { id, applied: result.applied };
    };
    const drifted = await fresh('m752s7a');
    const st = await loadState(drifted.id);
    await saveState(drifted.id, applyMutations({ ...st, page: st.page + 1 }, [{ type: 'people.set', name: 'Rias', field: 'state', text: 'Rias is playing chess.' }]).state);
    await playOn(drifted.id, 70);
    const held = await contentOf(drifted.id);
    const refused = await hk.undoLatest(await hk.loadSession(drifted.id), drifted.id);
    const out = { driftApplied: drifted.applied, drift: { ok: refused.ok, refused: refused.refused === true, words: refused.words, unchanged: (await contentOf(drifted.id)) === held } };
    const older = await fresh('m752s7b');
    const root = await db.settings.get('hk:' + older.id);
    for (const b of root.batches) for (const item of b.items) delete item.ledger; /* a receipt as M730 saved it */
    await db.settings.set('hk:' + older.id, root);
    await playOn(older.id, 70);
    const ledgerBefore = JSON.stringify((await loadState(older.id)).characters);
    const partial = await hk.undoLatest(await hk.loadSession(older.id), older.id);
    const kept = await loadState(older.id);
    out.older = { applied: older.applied, ok: partial.ok, words: partial.words, brief: (await db.stories.get(older.id)).brief, page: (await texts(older.id))[0], record: (await db.settings.get('memory:' + older.id)).nodes[0].text,
      ledgerKept: JSON.stringify(kept.characters) === ledgerBefore, map: kept.spellingCorrections || {} };
    return out;
  },
  /* S9: a later page repeating the old spelling, corrected by the same card again; its take-back */
  async repeat() {
    const id = await tale({ pages: [{ id: 'm752s9a', role: 'assistant', text: 'Aakeno waits.' }], state: ledger([{ name: 'Aakeno', text: 'A scholar.' }]) });
    const first = await correct(id, 'Aakeno', 'Akeno');
    await db.messages.append(id, { id: 'm752s9b', role: 'assistant', text: 'Aakeno came back at dusk.', ts: 5000 });
    const ledgerBefore = JSON.stringify((await loadState(id)).characters);
    const again = await correct(id, 'Aakeno', 'Akeno');
    const out = { first: first.result, again: again.result, card: again.card, pages: await texts(id), ledgerSame: JSON.stringify((await loadState(id)).characters) === ledgerBefore };
    const undone = await hk.undoLatest(await hk.loadSession(id), id);
    return { ...out, undo: { ok: undone.ok, words: undone.words }, pagesAfterUndo: await texts(id), ledgerSameAfterUndo: JSON.stringify((await loadState(id)).characters) === ledgerBefore };
  },
};

const which = process.argv[2];
if (!scenarios[which]) throw new Error('no such scenario: ' + which);
console.log(JSON.stringify(await scenarios[which]()));
