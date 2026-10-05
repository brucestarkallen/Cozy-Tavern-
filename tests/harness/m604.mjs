/* Cozy Tavern — harness laws of M604: things the story keeps, and competence kept (his report: the Batwing parked on the roof,
 * then an ambulance, a bribable medic and Gordon at the door with a folder — "do you think Barbara is that stupid?"). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { emptyState, renderStateFacts, renderThings } from '../../js/engine/state.js';
import { applyMutations, undoEntry } from '../../js/engine/apply.js';

const gotham = () => applyMutations({ ...emptyState(), page: 2 }, [
  { type: 'mc.set', name: 'Bruce Wayne' }, { type: 'place.set', name: 'the Royal Hotel roof' }, { type: 'presence.enter', name: 'Bruce Wayne' },
]).state;

test('M604-1 A THING IS KEPT WHERE IT STANDS: written, moved, owned, cleared — each one undoable; a new thing needs where it is; the same words twice change nothing', () => {
  let st = gotham();
  const a = applyMutations(st, [{ type: 'thing.set', name: 'the Batwing', where: 'on the Royal Hotel roof, fifty yards from the ledge', owner: 'Bruce Wayne', note: 'engines cooling' }]);
  eq(a.applied.length, 1);
  st = a.state;
  eq(st.things['the Batwing'].where, 'on the Royal Hotel roof, fifty yards from the ledge');
  eq(applyMutations(st, [{ type: 'thing.set', name: 'the Batwing', where: 'on the Royal Hotel roof, fifty yards from the ledge', owner: 'Bruce Wayne', note: 'engines cooling' }]).applied.length, 0, 'the same words change nothing');
  eq(applyMutations(st, [{ type: 'thing.set', name: 'a crowbar' }]).applied.length, 0, 'a new thing needs where it is');
  const moved = applyMutations(st, [{ type: 'thing.set', name: 'The Batwing', where: 'in the Batcave, on its pad' }]).state;
  eq(Object.keys(moved.things).join(','), 'the Batwing', 'one page per thing, whatever the capitals');
  eq(moved.things['the Batwing'].where, 'in the Batcave, on its pad');
  eq(moved.things['the Batwing'].owner, 'Bruce Wayne', 'whose it is stays');
  const back = undoEntry(moved, moved.log.length - 1);
  eq(back.state.things['the Batwing'].where, 'on the Royal Hotel roof, fifty yards from the ledge', 'the move taken back');
  const gone = applyMutations(st, [{ type: 'thing.clear', name: 'the Batwing', cause: 'shot down over the bay' }]).state;
  assert(!gone.things['the Batwing'], 'cleared');
  eq(undoEntry(gone, gone.log.length - 1).state.things['the Batwing'].owner, 'Bruce Wayne', 'and back whole');
});

test('M604-2 THE STORYTELLER IS SHOWN WHAT THEY HAVE: the things at the scene first, his own wherever they are, lately touched ones after — kept as long as who is here; a rename carries whose a thing is', () => {
  const st = applyMutations(gotham(), [
    { type: 'thing.set', name: 'the Batwing', where: 'the Royal Hotel roof — the far end', owner: 'Bruce Wayne' },
    { type: 'thing.set', name: 'the Batmobile', where: 'in the Batcave', owner: 'Bruce Wayne' },
    { type: 'thing.set', name: 'Gordon’s case file', where: 'on Gordon’s desk at the GCPD', owner: 'James Gordon' },
  ]).state;
  const lines = renderThings(st).split('\n');
  assert(/^- the Batwing \(Bruce Wayne’s\) — the Royal Hotel roof — the far end/.test(lines[0]), 'the thing at the scene first: ' + lines[0]);
  assert(/the Batmobile/.test(lines[1]), 'then his own');
  const facts = renderStateFacts(st);
  assert(/Things that matter — where each stands now[\s\S]*the Batwing/.test(facts), 'in what the storyteller reads');
  const renamed = applyMutations(st, [{ type: 'people.rename', from: 'Bruce Wayne', to: 'Bruce Thomas Wayne' }]).state;
  eq(renamed.things['the Batwing'].owner, 'Bruce Thomas Wayne', 'whose it is follows the name');
});

test('M604-3 EVERY READER IS TOLD: the page reader writes things, the housekeeper and the auditor can correct them, the craft keeps competence (what they HAVE before any logistics; a trail must predate its discovery), the world helper aims agendas only from what their owner knows', async () => {
  const st0 = gotham();
  const ex = JSON.stringify((await import('../../js/agents/extractor.js')).buildExtractorMessages({ state: st0, userText: 'x', assistantText: 'y' }));
  assert(/thing\.set/.test(ex) && /a jet parked on the roof/.test(ex), 'the page reader');
  const au = await import('../../js/agents/auditor.js');
  assert(au.AUDITOR_TYPES.has('thing.set') && au.AUDITOR_TYPES.has('thing.clear'), 'the auditor may');
  assert(/thing\.set/.test(JSON.stringify(au.buildAuditorMessages({ state: st0, brief: '', pages: [], record: '' }))), 'and is told how');
  const hk = await import('../../js/agents/housekeeper.js');
  eq(hk.ledgerTargetKey({ type: 'thing.set', name: 'the Batwing' }), 'thing:the batwing', 'the housekeeper reviews a thing by its slice');
  const withThing = applyMutations(st0, [{ type: 'thing.set', name: 'the Batwing', where: 'roof' }]).state;
  assert(hk.ledgerSliceHash(withThing, 'thing:the batwing') !== hk.ledgerSliceHash(st0, 'thing:the batwing'), 'and its slice moves when it moves');
  const { CRAFT_TEXT } = await import('../../js/assemble/craft.js');
  assert(/Competence Is Kept = never make a capable person careless/.test(CRAFT_TEXT) && /must already exist on an EARLIER page/.test(CRAFT_TEXT), 'the craft');
  const { buildWorldMessages } = await import('../../js/agents/world.js');
  const w = buildWorldMessages ? JSON.stringify(buildWorldMessages({ state: st0, pageText: 'x', userText: 'y' })) : '';
  if (w) assert(/WHAT AN AGENDA MAY AIM AT/.test(w) && /never invent the witness, the paper or the slip/.test(w), 'the world helper');
  else assert(/WHAT AN AGENDA MAY AIM AT/.test((await import('fs')).readFileSync(new URL('../../js/agents/world.js', import.meta.url), 'utf8')), 'the world helper');
});

test('M604-4 A THING WRITTEN NEVER TOUCHES THE LEDGER IT WAS WRITTEN FROM — the earlier ledger (a checkpoint, a dry run, a fold) keeps its own things', () => {
  const st0 = applyMutations(gotham(), [{ type: 'thing.set', name: 'the Batwing', where: 'the roof' }]).state;
  const moved = applyMutations(st0, [{ type: 'thing.set', name: 'the Batwing', where: 'the Batcave' }]).state;
  eq(st0.things['the Batwing'].where, 'the roof', 'the earlier ledger keeps its own');
  eq(moved.things['the Batwing'].where, 'the Batcave');
  const cleared = applyMutations(st0, [{ type: 'thing.clear', name: 'the Batwing' }]).state;
  assert(st0.things['the Batwing'] && !cleared.things['the Batwing'], 'a clear too');
});

test('M605-1 ONE THING, ONE PAGE: "Batwing", "the Batwing" and "Bruce’s Batwing" are the same page; "Gordon’s case file" and "Barbara’s case file" are two; with two case files, "the case file" names neither', () => {
  let st = applyMutations(gotham(), [{ type: 'thing.set', name: 'the Batwing', where: 'the roof', owner: 'Bruce Wayne' }]).state;
  st = applyMutations(st, [{ type: 'thing.set', name: 'Bruce’s Batwing', where: 'the Batcave' }]).state;
  st = applyMutations(st, [{ type: 'thing.set', name: 'Batwing', where: 'the Batcave pad', note: 'refuelling' }]).state;
  eq(Object.keys(st.things).join(','), 'the Batwing', 'one page');
  eq(st.things['the Batwing'].where, 'the Batcave pad');
  st = applyMutations(st, [{ type: 'thing.set', name: 'Gordon’s case file', where: 'on Gordon’s desk' }, { type: 'thing.set', name: 'Barbara’s case file', where: 'in the Clocktower' }]).state;
  assert(st.things['Gordon’s case file'] && st.things['Barbara’s case file'], 'two files, two pages');
  const r = applyMutations(st, [{ type: 'thing.clear', name: 'the case file' }]);
  eq(r.applied.length, 0, 'ambiguous — neither is cleared');
});

test('M605-2 THE SMALL STORYTELLER ALWAYS CARRIES THE LAWS ON SECRETS, PATHWAYS AND HOW PEOPLE TAKE A STRANGER — his report: on the small model NPCs knew a masked hero\'s real name, and people cursed one-sidedly or were polite beyond any human', async () => {
  const { ALWAYS_LAWS, PEOPLE_LAWS, lawsOf, lawsNamed } = await import('../../js/assemble/laws.js');
  const { CRAFT_TEXT } = await import('../../js/assemble/craft.js');
  const all = lawsOf(CRAFT_TEXT);
  for (const n of ['Secret Identity Quarantine', 'Not Pathways Ever', 'NPCs Are Not Sherlock Holmes', 'Content Beyond Perception', 'Competence Is Kept']) {
    assert(ALWAYS_LAWS.includes(n), n + ' rides every small page');
    eq(lawsNamed(all, [n]).length, 1, n + ' is a law the craft holds by that name');
  }
  for (const n of ['Default Stance To Strangers', 'Symmetry Law', 'Affection Is Not Anesthesia']) {
    assert(PEOPLE_LAWS.includes(n), n + ' rides every small page');
    eq(lawsNamed(all, [n]).length, 1, n + ' is a law the craft holds by that name');
  }
  const { plannerAsk } = await import('../../js/agents/planner.js');
  assert(/a hidden identity \(a mask, a codename, a disguise\)/.test(plannerAsk({}).system), 'the planner writes a hidden identity down as unknown');
});

test('M606 A TALE FOUNDED BEFORE THINGS GETS ITS BRIEF\'S THINGS ONCE — and only those: the founder\'s other writes are not read again, the founding mark stands, the once-only mark is kept', async () => {
  const { foundWorld } = await import('../../js/agents/founder.js');
  const { saveState, loadState } = await import('../../js/engine/state.js');
  const { db } = await import('../../js/store.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const story = await db.stories.create({ title: 'Gotham' });
  const founded = { ...gotham(), founded: { at: 1, print: 'BRIEF-PRINT' } };
  await saveState(story.id, founded);
  const answer = JSON.stringify({ mutations: [
    { type: 'people.set', name: 'Alfred Pennyworth', field: 'core', text: 'a rewritten core that must not land' },
    { type: 'thing.set', name: 'the Batwing', where: 'the Batcave hangar', owner: 'Bruce Wayne' },
    { type: 'thing.set', name: 'the Batmobile', where: 'the Batcave', owner: 'Bruce Wayne' },
  ] });
  await withHouse(thinkingHouse({ answer }), () => foundWorld({ connection: HOUSES[0].conn, storyId: story.id, brief: 'Bruce Wayne is Batman; his Batwing and Batmobile wait in the Batcave beneath Wayne Manor.', thingsOnly: true }));
  const st = await loadState(story.id);
  eq(Object.keys(st.things).sort().join(','), 'the Batmobile,the Batwing', 'the brief\u2019s things');
  assert(!st.characters || !st.characters['Alfred Pennyworth'], 'nothing else of the founding written');
  eq(st.founded.print, 'BRIEF-PRINT', 'the founding mark stands');
  eq(st.thingsFounded, true, 'once');
  /* the director, as it is asked: its system words, caught on the way to the model */
  const { writeDirective } = await import('../../js/agents/director.js');
  let asked = '';
  await writeDirective({ story: { title: 'Gotham', brief: '' }, messages: [], state: gotham(), mode: 'new', skipPolish: true, skipWatch: true, call: async (req) => { asked = String(req.system || ''); return { text: 'PREMISE — x' }; } });
  assert(/No beat needs someone to learn what no page has given them/.test(asked), 'the director plans pressure through what the pages hold');
});
