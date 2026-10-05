/* M607 — the line-by-line audit, part 17: the people rebuild, the old-ledger heal, the JSON mender.
 * Every law RUNS the feature (the real rebuild through a scripted wire, the real mender, the real engine) and reads back what
 * was written. None reads source text. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { HOUSES, withHouse } from './thinkinghouse.mjs';
import { db } from '../../js/store.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const CONN = HOUSES[0].conn;

/* one answer per call, chosen by what the call is (the helper's own words in the request) */
function scriptedHouse(answer) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url: String(url), body });
    const text = await answer(JSON.stringify(body), body);
    if (body.stream) {
      const lines = 'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n'
        + 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n'
        + 'data: [DONE]\n\n';
      const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(lines)); c.close(); } });
      return { ok: true, status: 200, headers: new Headers(), body: stream, async json() { return {}; }, async text() { return lines; }, clone() { return this; } };
    }
    const obj = { choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }] };
    return { ok: true, status: 200, headers: new Headers(), async json() { return obj; }, async text() { return JSON.stringify(obj); }, clone() { return this; } };
  };
  return { calls, fetch: fetchImpl };
}

const BRIEF = 'Jovan Arden, 19, summoner. Kara Zor-El has loved Jovan since school. Alfred keeps the manor.';

/* a story under way: the founder's bond in words, a page beat on top, canon on Kara's page, a passer-through retired */
function livingLedger() {
  let st = { ...emptyState(), sheet: { actors: {}, playerName: 'Jovan Arden' } };
  st = applyMutations(st, [
    { type: 'people.set', name: 'Kara Zor-El', field: 'core', text: 'Kryptonian; Jovan’s oldest friend' },
    { type: 'people.set', name: 'Old Passer', field: 'core', text: 'a courier who came through once' },
    { type: 'people.set', name: 'Alfred', field: 'core', text: 'keeps the manor' },
    { type: 'rel.set', name: 'Kara Zor-El', p: 50, r: 65, s: 10, cause: 'the brief says Kara has loved Jovan Arden since school' },
  ]).state;
  st = applyMutations(st, [{ type: 'rel.shift', name: 'Kara Zor-El', axis: 'r', delta: 2, cause: 'she kissed Jovan Arden on the roof' }]).state;
  st = applyMutations(st, [{ type: 'people.canon', name: 'Kara Zor-El', lines: ['Superman’s cousin, sent from Krypton'] }]).state;
  st.characters['Old Passer'] = { ...st.characters['Old Passer'], retired: true, retiredAtTurn: 3 };
  return st;
}

async function storyWithPages(id, n) {
  for (let i = 0; i < n; i += 1) {
    await db.messages.append(id, { role: i % 2 ? 'assistant' : 'user', text: i % 2 ? 'Kara Zor-El laughed at Jovan Arden. The courier, Old Passer, rode past.' : 'I wave at Kara.' });
  }
}

test('M607-1 THE PEOPLE REBUILD STARTS FROM THE BRIEF — a bond the brief gives in words stands again under the pages\u2019 shifts, a person only the brief names keeps a page, canon\u2019s lines and a retired passer-through ride onto the re-read pages', async () => {
  const { rebuildPeople } = await import('../../js/agents/rebuild.js');
  const story = await db.stories.create({ title: 'Metropolis' });
  await saveState(story.id, livingLedger());
  await storyWithPages(story.id, 12);
  let reads = 0;
  const house = scriptedHouse(async (all) => {
    if (/found the ledger/i.test(all)) {
      return JSON.stringify({ mutations: [
        { type: 'people.set', name: 'Kara Zor-El', field: 'core', text: 'Kryptonian; Jovan’s oldest friend' },
        { type: 'people.set', name: 'Alfred', field: 'core', text: 'keeps the manor' },
        { type: 'rel.set', name: 'Kara Zor-El', p: 50, r: 65, s: 10, cause: 'the brief says Kara has loved Jovan Arden since school' },
      ] });
    }
    if (/states in digits/i.test(all)) return '{"standings":[]}';
    if (/reading a story/i.test(all)) {
      reads += 1;
      return JSON.stringify({ deltas: [{ name: 'Kara Zor-El', field: 'state', text: 'laughing with Jovan' }, { name: 'Old Passer', field: 'state', text: 'riding past' }],
        shifts: [{ name: 'Kara Zor-El', axis: 'r', delta: 2, cause: 'she laughed with Jovan Arden, beat ' + reads }] });
    }
    return '{}';
  });
  const r = await withHouse(house, () => rebuildPeople({ connection: CONN, storyId: story.id, brief: BRIEF, stale: () => false }));
  assert(r && !r.stalled, 'the rebuild ran to the end: ' + JSON.stringify(r));
  const after = await loadState(story.id);
  const kara = after.relationships['Kara Zor-El'];
  assert(kara, 'Kara keeps a standing');
  eq(kara.r, 65 + 2 * reads, 'the brief\u2019s love stands, the pages\u2019 shifts on top of it (' + reads + ' readings)');
  assert(after.characters.Alfred && /manor/.test(after.characters.Alfred.core), 'the person only the brief names keeps a page: ' + JSON.stringify(Object.keys(after.characters)));
  eq((after.characters['Kara Zor-El'] || {}).canon && after.characters['Kara Zor-El'].canon[0], 'Superman\u2019s cousin, sent from Krypton', 'what canon says of her stays on her page');
  eq((after.characters['Old Passer'] || {}).retired, true, 'the passer-through stays retired');
  eq(r.digits, 1, 'the words say one standing came from the brief');
});

test('M607-2 A REBUILD THAT CANNOT READ THE BRIEF AGAIN CHANGES NOTHING — it stops with its reason, the live ledger untouched', async () => {
  const { rebuildPeople, rebuildPeopleWords } = await import('../../js/agents/rebuild.js');
  const story = await db.stories.create({ title: 'Metropolis 2' });
  const live = livingLedger();
  await saveState(story.id, live);
  await storyWithPages(story.id, 6);
  const house = scriptedHouse(async (all) => (/found the ledger/i.test(all) ? 'I cannot do that in JSON.' : /reading a story/i.test(all) ? '{"deltas":[],"shifts":[]}' : '{"standings":[]}'));
  const r = await withHouse(house, () => rebuildPeople({ connection: CONN, storyId: story.id, brief: BRIEF, stale: () => false }));
  eq(r.stalled, true, 'it stops');
  assert(/brief/.test(rebuildPeopleWords(r)), 'and says why: ' + rebuildPeopleWords(r));
  const after = await loadState(story.id);
  eq(after.relationships['Kara Zor-El'].r, 67, 'the standing as it stood');
  eq(Object.keys(after.characters).sort().join(','), 'Alfred,Kara Zor-El,Old Passer', 'every page as it stood');
  assert(!after.peopleRebuiltAt, 'not marked rebuilt');
});

test('M607-3 THE OLD-LEDGER HEAL NEVER FIRES ON A LEDGER THIS HOUSE FOUND CLEAN — the auditor\u2019s own "the brief says" restore after a page beat is not the old mark once the ledger is stamped', async () => {
  const { peopleHealDue, healStampDue, HEAL_GEN } = await import('../../js/agents/rebuild.js');
  const st = livingLedger();
  eq(peopleHealDue(st), false, 'a clean story under way is not due');
  eq(healStampDue(st), true, 'and, unstamped, it is due its stamp');
  const stamped = { ...st, healedGen: HEAL_GEN };
  eq(healStampDue(stamped), false, 'stamped once, never again');
  /* the auditor restores a standing the pages had zeroed, with the cause its instructions give it */
  const restored = applyMutations(stamped, [{ type: 'rel.set', name: 'Kara Zor-El', p: 50, r: 65, s: 10, cause: 'the brief says Kara has loved Jovan Arden since school' }]).state;
  eq(peopleHealDue(restored), false, 'the stamped story is not re-read for the auditor\u2019s own restore');
  const unstamped = applyMutations(st, [{ type: 'rel.set', name: 'Kara Zor-El', p: 50, r: 65, s: 10, cause: 'the brief says Kara has loved Jovan Arden since school' }]).state;
  eq(healStampDue(unstamped), false, 'a ledger carrying the mark is never stamped clean — the heal reads it');
});

test('M607-4 A PAGE THE MENDER HANDS BACK WITH REAL LINE BREAKS KEEPS ITS PARAGRAPHS AND LANDS — and a find across a paragraph matches', async () => {
  const { mendPages } = await import('../../js/agents/continuity.js');
  const before = 'Rukia stood by the gate.\n\nKim poured the tea and smiled.\n\nThe bell rang twice.';
  const pages = [{ id: 'p1', role: 'assistant', text: before }];
  const whole = '[{"index": 0, "text": "Rukia stood by the gate.\n\nKris poured the tea and smiled.\n\nThe bell rang twice."}]';
  const landed = [];
  const house = scriptedHouse(async () => whole);
  const out = await withHouse(house, () => mendPages({ connection: CONN, storyId: 's', pages, contradiction: 'Kris is the mother', record: '', playerName: 'Jovan', apply: async (page, after) => { landed.push(after); } }));
  eq(out.length, 1, 'the mend landed');
  eq(landed[0], 'Rukia stood by the gate.\n\nKris poured the tea and smiled.\n\nThe bell rang twice.', 'with every paragraph');
  const swap = '[{"index": 0, "find": "gate.\n\nKim poured", "replace": "gate.\n\nKris poured"}]';
  const landed2 = [];
  const out2 = await withHouse(scriptedHouse(async () => swap), () => mendPages({ connection: CONN, storyId: 's', pages, contradiction: 'Kris is the mother', record: '', playerName: 'Jovan', apply: async (page, after) => { landed2.push(after); } }));
  eq(out2.length, 1, 'the find across a paragraph matched');
  assert(landed2[0] && landed2[0].includes('Kris poured') && landed2[0].split('\n\n').length === 3, 'and the page keeps its three paragraphs: ' + JSON.stringify(landed2[0]));
});

test('M607-5 THE JSON MENDER TAKES A TRAILING COMMA OUTSIDE A STRING ONLY — a value holding ", }" keeps its comma', async () => {
  const { parseLenient } = await import('../../js/agents/jsonutil.js');
  const got = parseLenient('{"fact": "she said: fine, } go", "list": [1, 2,],}');
  eq(got && got.fact, 'she said: fine, } go', 'the value as written');
  eq(got && got.list.join(','), '1,2', 'the real trailing commas went');
});

test('M607-6 THE REBUILD\u2019S NAMES HAVE ONE MEANING OR NONE — the exact name first, else the one loose match; two Karas are no match for "Kara"', async () => {
  const { oneKey, keepWritersOwn } = await import('../../js/agents/rebuild.js');
  eq(oneKey(['Kara Zor-El', 'Kara Danvers'], 'Kara'), null, 'two loose matches are none');
  eq(oneKey(['Kara Zor-El', 'Rukia Kuchiki'], 'Kara'), 'Kara Zor-El', 'one loose match is the person');
  eq(oneKey(['Kara', 'Kara Zor-El'], 'Kara'), 'Kara', 'the exact name first');
  eq(oneKey(['Kara Zor-El', 'Kara Zor-El'], 'Kara'), 'Kara Zor-El', 'the same key twice is one person');
  /* a line the writer wrote by hand for "Kara" stays on its own page, never on whichever Kara the re-reading listed first */
  const live = { characters: { Kara: { core: 'HER OWN WORDS', state: '', arc: '', threads: [], hand: { core: true } } }, relationships: {} };
  const rebuilt = { characters: { 'Kara Zor-El': { core: 'read again', state: '', arc: '', threads: [] }, 'Kara Danvers': { core: 'read again too', state: '', arc: '', threads: [] } }, relationships: {} };
  const kept = keepWritersOwn(live, rebuilt);
  eq(kept.characters.Kara && kept.characters.Kara.core, 'HER OWN WORDS', 'his words keep their own page');
  eq(kept.characters['Kara Zor-El'].core, 'read again', 'neither Kara is overwritten');
  eq(kept.characters['Kara Danvers'].core, 'read again too', 'neither');
});

test('M607-7 CANON\u2019S LENS HOLDS BACK WHAT ITS ANSWER NEVER JUDGED — a dossier answered in part lets no later state through, and the lens is asked again until it is judged whole', async () => {
  const { lensPeople, overlayFor, lensCurrent, throughLens } = await import('../../js/agents/canonlens.js');
  const entry = { name: 'Rukia Kuchiki', found: true, dossier: { identity: 'A Soul Reaper of the 13th Division.', facts: ['She is Byakuya\u2019s adopted sister.', 'She became captain of the 13th Division and married Renji.'] } };
  const meta = {};
  const premise = 'Oda is the new captain of the 13th Division; Rukia is his lieutenant and has not married Renji.';
  let answer = '{"verdicts":[{"n":1,"verdict":"holds"},{"n":2,"verdict":"holds"}]}';
  await withHouse(scriptedHouse(async () => answer), () => lensPeople({ connection: CONN, meta, entries: [entry], premise }));
  const seen = throughLens(entry, overlayFor(meta, entry));
  eq(seen.dossier.facts.join(' | '), 'She is Byakuya\u2019s adopted sister.', 'the unjudged later state is held back');
  eq(lensCurrent(meta, entry, premise), false, 'and the lens is not taken as read');
  answer = '{"verdicts":[{"n":1,"verdict":"holds"},{"n":2,"verdict":"holds"},{"n":3,"verdict":"later"}]}';
  await withHouse(scriptedHouse(async () => answer), () => lensPeople({ connection: CONN, meta, entries: [entry], premise }));
  eq(lensCurrent(meta, entry, premise), true, 'judged whole, it is read');
  eq(throughLens(entry, overlayFor(meta, entry)).dossier.facts.join(' | '), 'She is Byakuya\u2019s adopted sister.', 'and the later state stays out');
});

test('M607-8 A RENAME REACHES THE WHOLE LEDGER — the referee\u2019s cast sheet, a fight under way, a thing\u2019s owner and where it is said to be; a name only a thing holds can be changed; the take-back puts all of it back', async () => {
  let st = { ...emptyState(), sheet: { actors: { Kael: { default: 7, domains: { melee: 8 }, conditions: [] } }, playerName: 'Jovan' } };
  st = applyMutations(st, [
    { type: 'people.set', name: 'Kael', field: 'core', text: 'a swordsman' },
    { type: 'thing.set', name: 'the black car', where: 'Kael\u2019s garage', owner: 'Kael' },
  ]).state;
  st.duel = { opp: { name: 'Kael', rating: 7 }, domain: 'melee' };
  const r = applyMutations(st, [{ type: 'people.rename', from: 'Kael', to: 'Kaelen' }]);
  eq(r.applied.length, 1, 'the rename lands');
  const after = r.state;
  assert(after.sheet.actors.Kaelen && after.sheet.actors.Kaelen.domains.melee === 8, 'his measure follows him: ' + JSON.stringify(after.sheet.actors));
  assert(!after.sheet.actors.Kael, 'and no stale entry stands under the old name');
  eq(after.duel.opp.name, 'Kaelen', 'the fight under way calls him by his name');
  eq(after.things['the black car'].owner, 'Kaelen', 'the car is his');
  eq(after.things['the black car'].where, 'Kaelen\u2019s garage', 'where it is said to be follows');
  const { undoLast } = await import('../../js/engine/apply.js');
  const back = undoLast(after);
  assert(back && back.state, 'the rename can be taken back');
  assert(back.state.sheet.actors.Kael && !back.state.sheet.actors.Kaelen, 'his measure is under his old name again');
  eq(back.state.duel.opp.name, 'Kael', 'the fight calls him Kael again');
  eq(back.state.things['the black car'].owner, 'Kael', 'and the car is Kael\u2019s');
  /* a name only a thing holds */
  let only = applyMutations(emptyState(), [{ type: 'thing.set', name: 'the old bike', where: 'the shed', owner: 'Old Tom' }]).state;
  const r2 = applyMutations(only, [{ type: 'people.rename', from: 'Old Tom', to: 'Tom Brennan' }]);
  eq(r2.applied.length, 1, 'a name only a thing holds can be changed: ' + JSON.stringify(r2.rejected.map((x) => x.why)));
  eq(r2.state.things['the old bike'].owner, 'Tom Brennan', 'and is');
});

test('M607-9 THE PEOPLE REBUILD RENEWS ITS LEASH BEFORE EVERY LONG CALL — the brief\u2019s reading and each batch of six pages', async () => {
  const { rebuildPeople } = await import('../../js/agents/rebuild.js');
  const story = await db.stories.create({ title: 'Leashed' });
  await saveState(story.id, livingLedger());
  await storyWithPages(story.id, 12);
  let renews = 0;
  const house = scriptedHouse(async (all) => (/found the ledger/i.test(all) ? '{"mutations":[]}' : /reading a story/i.test(all) ? '{"deltas":[],"shifts":[]}' : '{"standings":[]}'));
  const r = await withHouse(house, () => rebuildPeople({ connection: CONN, storyId: story.id, brief: BRIEF, stale: () => false, renew: () => { renews += 1; return true; } }));
  assert(r && !r.stalled, 'it ran');
  eq(renews, 3, 'once before the brief is read, once for each of the two batches');
});
