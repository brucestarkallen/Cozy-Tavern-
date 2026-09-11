/* M10 — the housekeeper: locate()'s exact/normalized/fuzzy/ambiguity
 * contract and minimalDiff; the hostile-tolerant protocol parser; the
 * apply engine riding apply.js; drift-guarded undo; supersede. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { loadState, emptyState, saveState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { listModules } from '../../js/assemble/modules.js';
import {
  locate, minimalDiff, parseProtocol, tolerantJson,
  stageProposals, applySupersede, applyProposal, undoLatest,
  resolveMessageRef,
} from '../../js/agents/housekeeper.js';

/* ---------- locate() ---------- */

test('M10 locate: exact hit, once', () => {
  const r = locate('The rain came down. Mira closed the door.', 'Mira closed the door.');
  assert(r.ok && r.via === 'exact', 'exact: ' + JSON.stringify(r));
  eq(r.start, 20, 'the span starts where the words do');
});

test('M10 locate: exact ambiguity refuses, never guesses', () => {
  const r = locate('she said no. Then she said no again.', 'she said no');
  assert(!r.ok, 'two landings must refuse');
  assert(/times/.test(r.reason), 'the refusal says why: ' + r.reason);
});

test('M10 locate: quote/whitespace normalization finds through curled quotes', () => {
  const hay = 'He said “go home now.”  She\n\ndid not.';
  const r = locate(hay, '"go home now." She did not.');
  assert(r.ok && r.via === 'normalized', 'normalized: ' + JSON.stringify(r));
  eq(hay.slice(r.start, r.end), '“go home now.”  She\n\ndid not.', 'the span maps back to the true words');
});

test('M10 locate: fuzzy word-Levenshtein lands a near match', () => {
  const hay = 'The kettle sang on the hob while the old dog slept beneath the table.';
  const r = locate(hay, 'the kettle sang on the hearth while the old dog slept under the table');
  assert(r.ok && r.via === 'fuzzy', 'fuzzy: ' + JSON.stringify(r));
  assert(r.similarity >= 0.78, 'similarity over the floor: ' + r.similarity);
});

test('M10 locate: fuzzy refuses when two passages read alike', () => {
  /* two near-identical passages, and a needle a word off both — each
   * window scores the same, well within the 0.05 ambiguity bar */
  const hay = 'The lantern burned low over the oak table. Much later, the lantern burned low over the oak table again.';
  const r = locate(hay, 'a lantern burned low over the oak table');
  assert(!r.ok, 'a twin passage must refuse');
  assert(/alike/.test(r.reason), 'the refusal names the twin: ' + r.reason);
});

test('M10 locate: fuzzy refuses when nothing reads close', () => {
  const r = locate('The rain came down all evening.', 'a ship crested the western ridge at dawn');
  assert(!r.ok, 'no near passage must refuse');
});

test('M10 minimalDiff: common prefix and suffix strip once', () => {
  const md = minimalDiff('the old door creaked open', 'the old door swung open');
  eq(md.find, 'creaked', 'only the true change remains as find');
  eq(md.replace, 'swung', 'only the true change remains as replace');
  const same = minimalDiff('unchanged words', 'unchanged words');
  eq(same.find, '', 'identical sides strip to nothing');
  eq(same.replace, '', 'identical sides strip to nothing');
});

/* ---------- the protocol parser, hostile input ---------- */

test('M10 protocol: trailing commas and control chars in strings are tolerated', () => {
  const raw = 'Here is what I found.\n<edits>[{"id":"#abc123","find":"a line\nbroken raw","replace":"a line made whole",}]</edits>';
  const p = parseProtocol(raw);
  eq(p.edits.length, 1, 'one op parsed');
  eq(p.edits[0].find, 'a line\nbroken raw', 'the raw newline survived as an escape');
  eq(p.text, 'Here is what I found.', 'the display text keeps only the words');
});

test('M10 protocol: prose-embedded blocks — the LAST balanced array wins', () => {
  const raw = 'Let me try. <edits>[{"id":"#bad", broken json here]</edits> hmm, again: <edits>[{"id":"#good1","find":"a","replace":"b"}]</edits>';
  const p = parseProtocol(raw);
  eq(p.edits.length, 1, 'one sound op');
  eq(p.edits[0].id, '#good1', 'the good (last) block is the one kept');
});

test('M10 protocol: <edits> blocks embedded mid-prose, display text cleaned', () => {
  const raw = 'I looked twice. <edits>[{"id":"#x12345","find":"old","replace":"new","reason":"tidying"}]</edits> That should do it.';
  const p = parseProtocol(raw);
  eq(p.edits.length, 1, 'the block parsed');
  assert(!p.text.includes('<edits>'), 'no protocol tags remain in the shown words');
  assert(/I looked twice/.test(p.text) && /That should do it/.test(p.text), 'the prose around it stays');
});

test('M10 protocol: fetch refs and supersede labels read tolerantly', () => {
  const raw = '<fetch>["#a1b2c3", 4, #d5e6f7]</fetch> <supersede>first try, second try</supersede>';
  const p = parseProtocol(raw);
  eq(p.fetch.length, 3, 'three refs');
  assert(p.fetch.includes('#a1b2c3') && p.fetch.includes('#d5e6f7'), 'bare #codes read');
  eq(p.supersede.length, 2, 'two labels');
});

test('M10 protocol: bent JSON resolves null, never throws', () => {
  eq(tolerantJson('[{unclosed'), null, 'unparseable resolves null');
  eq(tolerantJson('no json at all'), null, 'no candidate resolves null');
});

/* ---------- staging + refs ---------- */

test('M10 refs: a page answers to its #code and its ordinal', async () => {
  const story = await db.stories.create({ title: 'Refs' });
  const m1 = await db.messages.append(story.id, { role: 'user', text: 'one' });
  const m2 = await db.messages.append(story.id, { role: 'assistant', text: 'two' });
  const all = await db.messages.list(story.id);
  eq(resolveMessageRef(all, m2.id).id, m2.id, 'the full id resolves');
  eq(resolveMessageRef(all, '#' + m1.id.slice(0, 6)).id, m1.id, 'the served #code resolves');
  eq(resolveMessageRef(all, '2').id, m2.id, 'the ordinal resolves (1-based, visible)');
  eq(resolveMessageRef(all, '#zzzzzz'), null, 'nothing answers to a strange name');
});

test('M10 staging: cards carry review hashes; a lost page refuses at the door', async () => {
  const story = await db.stories.create({ title: 'Stage' });
  await db.messages.append(story.id, { role: 'user', text: 'The door stood open.' });
  const all = await db.messages.list(story.id);
  const state = await loadState(story.id);
  const modules = await listModules();
  const p = parseProtocol('<edits>[{"id":"1","find":"stood open","replace":"stood ajar","reason":"truer"}]</edits>'
    + '<edits>[{"id":"#nope99","find":"x","replace":"y"}]</edits>');
  const cards = stageProposals(p, { messages: all, state, modules });
  eq(cards.length, 2, 'two cards staged');
  eq(cards[0].status, 'pending', 'the sound card waits');
  assert(cards[0].review.length === 1 && cards[0].review[0].target.startsWith('anchor:') && cards[0].review[0].find, 'the anchor is the review (M78)');
  eq(cards[1].status, 'refused', 'the lost page refuses at the door');
});

/* ---------- apply + undo, drift-guarded ---------- */

async function storyWithPage(text) {
  const story = await db.stories.create({ title: 'Apply' });
  const msg = await db.messages.append(story.id, { role: 'assistant', text });
  const session = { turns: [], batches: [] };
  return { story, msg, session };
}

async function stageEdit(session, story, find, replace, label) {
  const all = await db.messages.list(story.id);
  const state = await loadState(story.id);
  const op = { id: all[all.length - 1].id, find, replace, reason: 'because', ...(label ? { label } : {}) };
  const cards = stageProposals({ edits: [op], ledits: [], redits: [] }, { messages: all, state, modules: [] });
  session.turns.push({ role: 'housekeeper', text: 'a card', ts: Date.now(), proposals: cards });
  return cards[0];
}

/* Cards live on the housekeeper turn they came from; applyProposal finds
 * them there. */
function stageInto(session, cards) {
  session.turns.push({ role: 'housekeeper', text: 'cards', ts: Date.now(), proposals: cards });
  return cards;
}

test('M10 apply: a page edit lands and undo takes it back', async () => {
  const { story, session } = await storyWithPage('The kettle sang while the old dog slept.');
  const card = await stageEdit(session, story, 'the old dog slept', 'the old dog watched');
  const result = await applyProposal(session, story.id, card.id);
  assert(result.ok, 'applied: ' + result.words);
  let all = await db.messages.list(story.id);
  assert(all[0].text.includes('the old dog watched'), 'the words changed');
  eq(session.batches.length, 1, 'one undo batch landed');

  const back = await undoLatest(session, story.id);
  assert(back.ok, 'taken back: ' + back.words);
  all = await db.messages.list(story.id);
  assert(all[0].text.includes('the old dog slept'), 'the old words returned');
  assert(session.batches[0].undone === true, 'the batch is marked');
});

test('M10 undo: drift REFUSES loudly and touches nothing', async () => {
  const { story, session } = await storyWithPage('Mira kept the ledger by the hearth.');
  const card = await stageEdit(session, story, 'kept the ledger', 'kept the books');
  const applied = await applyProposal(session, story.id, card.id);
  assert(applied.ok, 'applied');

  /* The target drifts: a hand re-inks the page after the card landed. */
  const all = await db.messages.list(story.id);
  await db.messages.update(story.id, all[0].id, { text: all[0].text + ' Outside, the rain.' });

  const back = await undoLatest(session, story.id);
  assert(!back.ok && back.refused, 'the drift refuses');
  assert(/Not taken back/.test(back.words), 'loud words: ' + back.words);
  const after = await db.messages.list(story.id);
  assert(after[0].text.includes('the rain.'), 'the drifted page was NOT clobbered');
  assert(after[0].text.includes('kept the books'), 'the card’s change stands');
});

test('M10 apply: staleness — a target changed since staging refuses, offered again', async () => {
  const { story, session } = await storyWithPage('The north road ran wet.');
  const card = await stageEdit(session, story, 'ran wet', 'ran dry');
  /* the page moves between staging and apply — and the words the card looked for are gone (M78: a page that
   * merely GAINED words keeps the anchor, and the card still lands) */
  const all = await db.messages.list(story.id);
  await db.messages.update(story.id, all[0].id, { text: 'The north road ran dry.' });
  const result = await applyProposal(session, story.id, card.id);
  assert(!result.ok && result.stale, 'stale card refuses');
  eq(card.status, 'stale', 'the card reads stale');
  eq(session.batches.length, 0, 'no batch was written');
});

test('M10 apply: a second claim on one card refuses (claim-then-apply)', async () => {
  const { story, session } = await storyWithPage('The same page.');
  const card = await stageEdit(session, story, 'same page', 'other page');
  const first = await applyProposal(session, story.id, card.id);
  assert(first.ok, 'the first claim lands');
  const second = await applyProposal(session, story.id, card.id);
  assert(!second.ok, 'the second claim refuses');
  const all = await db.messages.list(story.id);
  eq(all[0].text, 'The other page.', 'the change landed exactly once');
});

/* ---------- supersede ---------- */

test('M10 supersede: a later answer retires pending cards; applying refuses', async () => {
  const { story, session } = await storyWithPage('The window stood open.');
  const card = await stageEdit(session, story, 'stood open', 'stood shut', 'window-fix');
  eq(card.status, 'pending', 'pending before the answer');
  const retired = applySupersede(session, ['Window Fix']); /* M61: labels match loosely */
  eq(retired.count, 1, 'one card retired');
  eq(retired.unmatched.length, 0);
  eq(card.status, 'superseded', 'the card reads superseded');
  const result = await applyProposal(session, story.id, card.id);
  assert(!result.ok, 'a superseded card cannot apply');
  const all = await db.messages.list(story.id);
  eq(all[0].text, 'The window stood open.', 'the page never moved');
});

/* ---------- ledger + rulebook ops ride the real stores ---------- */

test('M10 ledits: ledger ops ride apply.js (validated, logged, undoable)', async () => {
  const story = await db.stories.create({ title: 'Ledger' });
  await saveState(story.id, emptyState());
  const session = { turns: [], batches: [] };
  const state = await loadState(story.id);
  const cards = stageProposals({
    edits: [], redits: [],
    ledits: [
      { type: 'presence.enter', name: 'Mira', position: 'by the hearth' },
      { type: 'clock.set', year: 1341, month: 6, day: 12, hour: 9, minute: 0 },
      { type: 'clock.advance', minutes: 30, reason: 'the walk' },
      { type: 'nonsense.type', name: 'X' },
    ],
  }, { messages: [], state, modules: [] });
  stageInto(session, cards);
  eq(cards.length, 1, 'one ledger card for the block');
  const result = await applyProposal(session, story.id, cards[0].id);
  assert(result.ok, 'applied: ' + result.words);
  assert(/Declined/.test(result.words), 'the unknown type is rejected in plain words');
  const after = await loadState(story.id);
  eq(after.present.length, 1, 'Mira entered');
  assert(after.log.length >= 3, 'the log carries the applied lines');
  assert(/half an hour|30/.test(after.log[after.log.length - 1].words)
    || after.log.some((l) => /clock|hour|minute|walk/i.test(l.words)),
    'the clock wrote a plain-words line');

  const back = await undoLatest(session, story.id);
  assert(back.ok, 'the ledger batch comes back: ' + back.words);
  const restored = await loadState(story.id);
  eq(restored.present.length, 0, 'the presence left again');
});

test('M10 ledits: module.pin toggles a rule and comes back', async () => {
  const story = await db.stories.create({ title: 'Pins' });
  await saveState(story.id, emptyState());
  const session = { turns: [], batches: [] };
  const state = await loadState(story.id);
  const modules = await listModules();
  const name = modules[0].name;
  const cards = stageProposals({
    edits: [], redits: [],
    ledits: [{ type: 'module.pin', module: name, pinned: true }],
  }, { messages: [], state, modules });
  stageInto(session, cards);
  const result = await applyProposal(session, story.id, cards[0].id);
  assert(result.ok, 'pinned: ' + result.words);
  let mods = await listModules();
  assert(mods.find((m) => m.name === name).pinned === true, 'the rule is pinned on');

  const back = await undoLatest(session, story.id);
  assert(back.ok, 'the pin comes back');
  mods = await listModules();
  assert(mods.find((m) => m.name === name).pinned !== true, 'the rule rests again');
});

test('M10 redits: a rule’s text is re-inked and restored', async () => {
  const story = await db.stories.create({ title: 'Redits' });
  const session = { turns: [], batches: [] };
  const modules = await listModules();
  const mod = modules[0];
  const find = mod.text.split(/\s+/).slice(0, 5).join(' ');
  const state = await loadState(story.id);
  const cards = stageProposals({
    edits: [], ledits: [],
    redits: [{ module: mod.name, find, replace: find + ' gently', reason: 'softening' }],
  }, { messages: [], state, modules });
  stageInto(session, cards);
  eq(cards[0].status, 'pending', 'the card waits');
  const result = await applyProposal(session, story.id, cards[0].id);
  assert(result.ok, 'applied: ' + result.words);
  let mods = await listModules();
  assert(mods.find((m) => m.id === mod.id).text.includes(' gently'), 'the rule reads differently');

  const back = await undoLatest(session, story.id);
  assert(back.ok, 'the rule’s words come back');
  mods = await listModules();
  assert(!mods.find((m) => m.id === mod.id).text.includes(' gently'), 'the old words returned');
});

test('M10 edits: hide folds a page away; bulk re-inks across pages', async () => {
  const story = await db.stories.create({ title: 'Hide' });
  await db.messages.append(story.id, { role: 'user', text: 'Mira came in.' });
  await db.messages.append(story.id, { role: 'assistant', text: 'Mira sat down.' });
  const session = { turns: [], batches: [] };
  const all = await db.messages.list(story.id);
  const state = await loadState(story.id);
  const cards = stageProposals({
    edits: [
      { id: '1', hide: true, reason: 'let it rest' },
      { bulk_replace: true, find: 'Mira', replace: 'Mara', range: '1-2', reason: 'the name changed' },
    ],
    ledits: [], redits: [],
  }, { messages: all, state, modules: [] });
  stageInto(session, cards);
  eq(cards.length, 2, 'two cards');
  /* the bulk card first: hiding a page shifts its fingerprint, which would
   * rightly stale a bulk card staged over it */
  let r = await applyProposal(session, story.id, cards[1].id);
  assert(r.ok, 'bulk: ' + r.words);
  /* the bulk re-inked the pages, so the hide card staged over them is
   * rightly stale — the housekeeper stages it fresh, as it would in life */
  const fresh = await db.messages.list(story.id);
  const hideCards = stageProposals({
    edits: [{ id: '1', hide: true, reason: 'let it rest' }], ledits: [], redits: [],
  }, { messages: fresh, state, modules: [] });
  stageInto(session, hideCards);
  r = await applyProposal(session, story.id, hideCards[0].id);
  assert(r.ok, 'hidden: ' + r.words);
  /* M78: a hide needs only the page to exist — the bulk re-ink before it changes nothing; the
   * page is already folded away by the fresh card, so the older hide is refused for THAT reason */
  const staleTry = await applyProposal(session, story.id, cards[0].id);
  assert(!staleTry.ok && /already folded away/.test(staleTry.words), 'the second hide says why: ' + staleTry.words);
  eq(cards[0].status, 'refused', 'and reads refused, not stale');
  const after = await db.messages.list(story.id);
  eq(after[0].hidden, true, 'the first page is folded away');
  assert(after[1].text.includes('Mara sat down.'), 'the name was re-inked on the visible page');

  const back = await undoLatest(session, story.id);
  assert(back.ok, 'the newest batch (the hide) comes back');
  const restored = await db.messages.list(story.id);
  eq(restored[0].hidden === true, false, 'the first page shows again');
  assert(restored[1].text.includes('Mara sat down.'), 'the bulk batch still stands until its own undo');
});

test('M10 undo: the batch shelf caps at 50', async () => {
  const { story, session } = await storyWithPage('A page. The mill wheel turned slowly.');
  for (let i = 0; i < 55; i += 1) {
    const all = await db.messages.list(story.id);
    const state = await loadState(story.id);
    const cards = stageProposals({
      edits: [{ id: all[0].id, find: 'slowly', replace: 'slowly (' + i + ')', reason: 'counting' }],
      ledits: [], redits: [],
    }, { messages: all, state, modules: [] });
    stageInto(session, cards);
    const r = await applyProposal(session, story.id, cards[0].id);
    assert(r.ok, 'applied ' + i + ': ' + r.words);
    const cur = (await db.messages.list(story.id))[0];
    await db.messages.update(story.id, cur.id, { text: cur.text.replace(' (' + i + ')', '') });
  }
  assert(session.batches.length <= 50, 'the shelf caps: ' + session.batches.length);
});
