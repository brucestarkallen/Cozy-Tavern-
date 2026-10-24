/* Cozy Tavern — harness laws of M769: the final audit of the scene, the people, the world and the book. His (24 October 2026):
 * "make sure each ledger the scene the people the world the book and everything is working and not gimmick and intended
 * according to best". Four readers who had not seen the code before read each part and made its faults happen; each law
 * below runs the real reader, applier or keeper on the shape that went wrong and fails on m768-001. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { emptyState, headerMutations, saveState, loadState } from '../../js/engine/state.js';
import { applyMutations, undoEntry, strayBookKeys } from '../../js/engine/apply.js';
import { extractTurn } from '../../js/agents/extractor.js';
import { worldTurn, worldRunState } from '../../js/agents/world.js';
import { voicesBeyondTheRoom, publicMoment } from '../../js/engine/world.js';
import { buildRequest, windowPlan } from '../../js/assemble/stack.js';
import { CRAFT_TEXT } from '../../js/assemble/craft.js';
import { sourceBindings } from '../../js/assemble/selection.js';
import { renderMemory, memoryForWindow, visiblePages, loadMemory, saveMemory, memoryAfterDeletion, memoryWithoutPage, maybeSummarize, redoLine, applyAuditFixes, auditedOf, lineIsHis } from '../../js/agents/memory.js';
import { auditStretch, nextStretch } from '../../js/agents/continuous.js';
import { measureTransport } from '../../js/providers/measure.js';
import { contextOf } from '../../js/providers/room.js';

const CONN = { type: 'openai', baseUrl: 'https://fixture.example/v1', apiKey: 'fixture', model: 'fixture', preset: 'custom', contextSize: 200000, reasoning: { effort: 'off' } };
const sse = (text) => new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: typeof text === 'string' ? text : JSON.stringify(text) } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
async function scripted(answer, fn) {
  const was = globalThis.fetch; const asked = [];
  globalThis.fetch = async (_, o) => { const body = JSON.parse(o.body); asked.push(body); return sse(answer(body, asked.length)); };
  try { return { out: await fn(), asked }; } finally { globalThis.fetch = was; }
}
const seed = (muts, page = 10) => applyMutations({ ...emptyState(), page }, muts).state;
/* the real page reader over one page, the provider scripted at the wire; then the page's header and the reader's writes
 * applied together, the header first (as the send path lays them) */
async function readPage(st, text, a) {
  const { out: read } = await scripted(() => ({ brief: { pressure: [], ripe: [], twb: null }, deltas: [], here: [], ...a, mutations: [{ type: 'mode.snapshot', flags: [] }, ...((a && a.mutations) || [])] }),
    () => extractTurn({ connection: CONN, state: st, userText: 'I go on.', assistantText: text, pageNumber: (st.page || 10) + 1, before: [] }));
  const header = headerMutations(text, { ground: st.place ? st.place.name : '', day: '' });
  return { read, after: applyMutations({ ...st, page: (st.page || 10) + 1 }, [...header, ...read.mutations]).state };
}
const here = (st) => (st.present || []).map((p) => p.name);
const run = (st, ms) => applyMutations(st, ms).state;
const ledger = (mc = 'Jovan') => ({ ...emptyState(), sheet: { actors: {}, playerName: mc, playerAliases: [] } });

/* ---------- the scene ---------- */

test('M769-S1 A DEATH ON THE PAGE TAKES THEM OUT OF THE ROOM (Old Hesk shot through the chest stood in Here now): the reader’s leave “dead — on the taproom floor”, told in any of three ways, is kept', async () => {
  const base = () => seed([{ type: 'mc.set', name: 'Azrael' }, { type: 'place.set', name: 'the Bent Kettle taproom' }, { type: 'clock.set', year: 1247, month: 10, day: 14, hour: 22, minute: 0 },
    { type: 'presence.enter', name: 'Azrael' }, { type: 'presence.enter', name: 'Old Hesk', position: 'behind the counter' }, { type: 'presence.enter', name: 'Roska' }, { type: 'people.set', name: 'Old Hesk', field: 'core', text: 'Tavern keeper.' }]);
  const told = [['His eyes went glassy, and the light went out of them.\n\nRoska knelt by Hesk and closed his eyes with two fingers.', 'the light went out of them'],
    ['He gave one rattling breath, then went still, and stayed still.\n\nRoska knelt beside Hesk.', 'then went still, and stayed still'],
    ['His heart stopped under Roska\'s hands as she pressed the wound.\n\nAzrael stared at Hesk\'s body.', 'His heart stopped under Roska']];
  for (const [words, shown] of told) {
    const { after } = await readPage(base(), '[The Bent Kettle taproom — Monday, October 14, 1247 | 22:05 | wind | leathers | by the hearth]\n\nThe crossbow bolt took Old Hesk through the chest. ' + words,
      { mutations: [{ type: 'presence.leave', name: 'Old Hesk', to: 'dead — on the taproom floor', shown }], here: [{ name: 'Azrael' }, { name: 'Roska' }] });
    assert(!here(after).includes('Old Hesk'), 'he is out of the room: ' + here(after).join(', ') + ' — ' + shown);
  }
});

test('M769-S2 SOMEONE WHO WALKS OUT ON THE PAGE IS OUT, THOUGH THE PAGE THINKS OF THEM AFTER (Marta walked into the rain and stayed in the room)', async () => {
  const st = seed([{ type: 'mc.set', name: 'Jovan Wessex' }, { type: 'place.set', name: 'the Gilded Eel taproom' }, { type: 'clock.set', year: 2025, month: 11, day: 8, hour: 21, minute: 0 },
    { type: 'presence.enter', name: 'Jovan Wessex' }, { type: 'presence.enter', name: 'Marta Kell' }, { type: 'presence.enter', name: 'Tobin Hale' }, { type: 'people.set', name: 'Marta Kell', field: 'core', text: 'Innkeeper’s sister.' }]);
  const PAGE = '[The Gilded Eel taproom — Saturday, November 8, 2025 | 21:10 | rain on the shutters | coat | at the corner table]\n\nMarta Kell finished her cider, pulled the green shawl tight and walked out into the rain without another word.\n\nTobin wiped the bar in long slow strokes.\n\nJovan turned the empty cup in his fingers and thought about what Marta had said about the ledger.';
  const { after } = await readPage(st, PAGE, { mutations: [{ type: 'presence.leave', name: 'Marta Kell', to: 'out into the rain', shown: 'walked out into the rain without another word' }],
    here: [{ name: 'Jovan Wessex', ending: { position: 'at the corner table', shown: 'Jovan turned the empty cup in his fingers' } }, { name: 'Tobin Hale', ending: { position: 'behind the bar', shown: 'Tobin wiped the bar' } }] });
  eq(here(after).includes('Marta Kell'), false, 'Marta is out: ' + here(after).join(', '));
  assert(here(after).includes('Tobin Hale'), 'and Tobin is still behind the bar');
});

test('M769-S3 A PLACE THAT CARRIES SOMEONE’S NAME DOES NOT KEEP THEM IN THE ROOM (Claire Ashford stood in the drawing room the next morning — “Ashford Manor” was her name on the page)', async () => {
  const st = seed([{ type: 'mc.set', name: 'Jovan Wessex' }, { type: 'place.set', name: 'Ashford Manor' }, { type: 'clock.set', year: 2026, month: 10, day: 20, hour: 21, minute: 0 },
    { type: 'presence.enter', name: 'Jovan Wessex' }, { type: 'presence.enter', name: 'Claire Ashford', position: 'at the piano' }, { type: 'people.set', name: 'Claire Ashford', field: 'core', text: 'Jovan’s cousin.' }]);
  const { read } = await readPage(st, '[Ashford Manor — Tuesday, October 21, 2026 | 09:10 | clear | a dark coat | in the drawing room]\n\nMorning came grey and quiet. Jovan sat alone at the long table with his coffee going cold.', { newScene: true });
  assert(read.mutations.some((m) => m.type === 'presence.leave' && m.name === 'Claire Ashford'), 'she is let go with the scene that ended: ' + read.mutations.map((m) => m.type + ':' + (m.name || '')).join(', '));
});

test('M769-S4 A SEAT IN A ROOM OF THE HOUSE HIS HEADER DOES NOT STAND IN IS NOT A WALK-IN (Claire at the piano in the drawing room walked into the garden with him)', async () => {
  const st = seed([{ type: 'mc.set', name: 'Jovan Wessex' }, { type: 'place.set', name: 'Ashford Manor' }, { type: 'clock.set', year: 2026, month: 10, day: 20, hour: 20, minute: 10 },
    { type: 'presence.enter', name: 'Jovan Wessex' }, { type: 'presence.enter', name: 'Vanessa' }, { type: 'presence.enter', name: 'Claire' }, { type: 'presence.leave', name: 'Claire', to: 'the drawing room of Ashford Manor' }]);
  assert(!here(st).includes('Claire'), 'fixture: she stayed in the drawing room when they went out');
  const GARDEN = '[Ashford Manor — Monday, October 20, 2026 | 20:20 | rain | a dark coat | in the garden]\n\nThe garden was dark and wet. Vanessa walked beside him. Through the lit window of the drawing room Jovan could see Claire bent over the piano keys.';
  const { after } = await readPage(st, GARDEN, { mutations: [{ type: 'offscreen.set', name: 'Claire', location: 'the drawing room of Ashford Manor', activity: 'playing the piano' }] });
  eq(here(after).includes('Claire'), false, 'she stays at the piano: ' + here(after).join(', '));
});

test('M769-S5 “THE LIBRARY AT ASHFORD MANOR” IS “ASHFORD MANOR, THE LIBRARY” (the same room said another way was written as a new ground — the scene read as moved)', async () => {
  for (const said of ['The library at Ashford Manor', 'The library of Ashford Manor', 'Ashford Manor library', 'Library, Ashford Manor']) {
    const st = seed([{ type: 'mc.set', name: 'Jovan Wessex' }, { type: 'place.set', name: 'Ashford Manor, the library' }, { type: 'clock.set', year: 2025, month: 11, day: 9, hour: 19, minute: 0 },
      { type: 'presence.enter', name: 'Jovan Wessex' }, { type: 'presence.enter', name: 'Vanessa Langley' }, { type: 'presence.enter', name: 'Claire Ashford', position: 'on the window seat, reading' }]);
    const { after } = await readPage(st, `[${said} — Sunday, November 9, 2025 | 19:15 | sleet | charcoal suit | at the long table]\n\nVanessa turned another page. "Start with the ledger," she said, and Jovan reached for it across the long table.`, {});
    eq(after.place.name, 'Ashford Manor, the library', 'one room, one name, under “' + said + '”');
    assert(here(after).includes('Claire Ashford'), 'Claire is still on the window seat under “' + said + '”: ' + here(after).join(', '));
  }
});

test('M769-S6 WORDS IN SINGLE QUOTATION MARKS ARE SPEECH (‘Vera will be down soon’ walked Vera into the kitchen from her bed upstairs)', async () => {
  for (const [open, close] of [['\'', '\''], ['‘', '’']]) {
    const st = seed([{ type: 'mc.set', name: 'Jovan Wessex' }, { type: 'place.set', name: 'the Wells house kitchen' }, { type: 'clock.set', year: 2025, month: 11, day: 8, hour: 20, minute: 0 },
      { type: 'presence.enter', name: 'Jovan Wessex' }, { type: 'presence.enter', name: 'Tobin Wells' }, { type: 'people.set', name: 'Vera Wells', field: 'core', text: 'Aunt.' },
      { type: 'offscreen.set', name: 'Vera Wells', location: 'upstairs in the Wells house', activity: 'asleep' }]);
    const { after } = await readPage(st, `[The Wells house kitchen — Saturday, November 8, 2025 | 20:10 | rain | sweater | at the kitchen table]\n\nTobin stirred the pot without looking round. ${open}Vera will be down soon, she always is when there's soup${close} he said.\n\nJovan nodded and reached for the bread.`,
      { mutations: [{ type: 'presence.enter', name: 'Vera Wells', position: 'coming down for soup', shown: 'Vera will be down soon' }], here: ['Jovan Wessex', 'Tobin Wells', 'Vera Wells'] });
    eq(here(after).includes('Vera Wells'), false, 'Vera is still upstairs (' + open + '…' + close + '): ' + here(after).join(', '));
  }
});

/* ---------- the people ---------- */

test('M769-P1 “MRS. ARDEN” IS NOT JOVAN ARDEN (his mother’s nature, standing, knowledge and truths were written onto the main character’s own page)', () => {
  let s = run(ledger('Jovan Arden'), [{ type: 'people.note', name: 'Jovan Arden', field: 'state', text: 'Home, at the kitchen table.' }]);
  s = run(s, [{ type: 'people.note', name: 'Mrs. Arden', field: 'core', text: 'His mother, a retired surgeon.' }, { type: 'people.note', name: 'Mrs. Arden', field: 'state', text: 'In the kitchen, slicing apples.' },
    { type: 'rel.shift', name: 'Mrs. Arden', axis: 'p', delta: 5, cause: 'he hugged her' }, { type: 'knowledge.add', name: 'Mrs. Arden', fact: 'Her son skipped school.' }, { type: 'canon.lock', name: 'Mrs. Arden', key: 'hair', value: 'grey' }]);
  eq(s.characters['Jovan Arden'].state, 'Home, at the kitchen table.', 'his page is his');
  eq(s.characters['Mrs. Arden'].core, 'His mother, a retired surgeon.', 'hers is hers');
  assert(s.relationships['Mrs. Arden'] && !s.relationships['Jovan Arden'], 'her standing is hers');
  assert(s.knowledge['Mrs. Arden'] && !s.knowledge['Jovan Arden'], 'what she knows is hers');
  assert(s.canon['Mrs. Arden'] && !s.canon['Jovan Arden'], 'and what is true of her');
});

test('M769-P2 “SILAS’ BROTHER” IS NOT SILAS (the s’ possessive): a page of his own', () => {
  const s = run(ledger(), [{ type: 'people.note', name: 'Silas', field: 'core', text: 'Blacksmith of the lower ward.' }, { type: 'people.note', name: "Silas' brother", field: 'core', text: 'A sailor, long gone to sea.' }]);
  eq(s.characters.Silas.core, 'Blacksmith of the lower ward.', 'Silas keeps his own nature');
  eq(s.characters["Silas' brother"].core, 'A sailor, long gone to sea.', 'his brother has a page of his own');
});

test('M769-P3 A RANK TELLS TWO PEOPLE APART IN EVERY BOOK (“Lieutenant Kuchiki” wrote into Byakuya Kuchiki’s page, standing, knowledge and truths — the Captain of the Sixth)', () => {
  const t = run(ledger('Ichigo Kurosaki'), [{ type: 'people.note', name: 'Lieutenant Kuchiki', field: 'core', text: 'Lieutenant of the Thirteenth; gave Ichigo her powers.' }]);
  const t2 = run(t, [{ type: 'people.note', name: 'Byakuya Kuchiki', field: 'core', text: 'Captain of the Sixth; head of the clan.' }]);
  eq(t2.characters['Lieutenant Kuchiki'].core, 'Lieutenant of the Thirteenth; gave Ichigo her powers.', 'her page holds only her');
  eq((t2.characters['Byakuya Kuchiki'] || {}).core, 'Captain of the Sixth; head of the clan.', 'he has his own');
  let k = run(ledger('Ichigo Kurosaki'), [{ type: 'people.note', name: 'Byakuya Kuchiki', field: 'core', text: 'Captain of the Sixth.' }, { type: 'knowledge.add', name: 'Byakuya Kuchiki', fact: 'Hisana asked him to find her sister.' }]);
  k = run(k, [{ type: 'knowledge.add', name: 'Lieutenant Kuchiki', fact: 'Ichigo is alive.' }, { type: 'rel.shift', name: 'Lieutenant Kuchiki', axis: 'p', delta: 5, cause: 'she trusted him' }, { type: 'canon.lock', name: 'Lieutenant Kuchiki', key: 'eyes', value: 'violet' }]);
  eq(k.knowledge['Byakuya Kuchiki'].length, 1, 'his book holds only what he knows');
  assert(!k.relationships['Byakuya Kuchiki'] && !k.canon['Byakuya Kuchiki'], 'her standing and her eyes are not his');
  const c = run(ledger('Ichigo Kurosaki'), [{ type: 'people.note', name: 'Kuchiki', field: 'state', text: 'At the gate.' }]);
  const c2 = run(c, [{ type: 'people.note', name: 'Captain Kuchiki', field: 'core', text: 'Captain of the Sixth.' }, { type: 'people.note', name: 'Lieutenant Kuchiki', field: 'core', text: 'Lieutenant of the Thirteenth.' }]);
  eq(c2.characters['Lieutenant Kuchiki'].core, 'Lieutenant of the Thirteenth.', 'a page that already says Captain is not the Lieutenant’s');
});

test('M769-P4 A NAME TWO PEOPLE ANSWER TO WRITES INTO NEITHER ONE’S BOOK (“Vanessa” beside Vanessa Langley and Vanessa Cole: her knowledge went into Langley’s)', () => {
  let s = run(ledger(), [{ type: 'people.note', name: 'Vanessa Langley', field: 'core', text: 'Journalist.' }, { type: 'people.note', name: 'Vanessa Cole', field: 'core', text: 'The sheriff.' }, { type: 'knowledge.add', name: 'Vanessa Langley', fact: 'The mayor took the bribe.' }]);
  s = run(s, [{ type: 'knowledge.add', name: 'Vanessa', fact: 'The deputy lied about the alibi.' }]);
  eq(s.knowledge['Vanessa Langley'].length, 1, 'Langley knows only what she learned: ' + JSON.stringify(s.knowledge));
});

test('M769-P5 A FAMILY’S TITLE WITH THE SURNAME ALONE IS NOT A WHOLE NAME (“Mrs. Sterling … His wife, a florist” was written onto the banker John Sterling’s page) — and is still kept from raising the dead', () => {
  const s = run(ledger(), [{ type: 'people.note', name: 'John Sterling', field: 'core', text: 'The banker.' }, { type: 'people.note', name: 'Mrs. Sterling', field: 'core', text: 'His wife, a florist.' }]);
  eq(s.characters['John Sterling'].core, 'The banker.', 'the banker’s page is his');
  eq(s.characters['Mrs. Sterling'].core, 'His wife, a florist.', 'hers is her own');
  const dead = run(ledger(), [{ type: 'people.note', name: 'Marcus Blackwood', field: 'core', text: 'The heir.' }, { type: 'offscreen.set', name: 'Marcus Blackwood', location: 'dead — under a sheet in the ballroom' }]);
  const r = applyMutations(dead, [{ type: 'offscreen.set', name: 'Mr. Blackwood', location: 'the cellar', activity: 'searching', source: 'world' }]);
  eq(r.applied.length, 0, 'a seat for “Mr. Blackwood” beside dead Marcus Blackwood is not written: ' + r.rejected.map((x) => x.why).join('; '));
});

test('M769-P6 A RENAME TAKEN BACK PUTS BACK WHAT IT CHANGED, AND AN OLDER WRITE IS NOT TAKEN BACK PAST IT', () => {
  let s = run(ledger(), [{ type: 'people.note', name: 'Tobin Hale', field: 'core', text: 'Deputy.' }]);
  s = run(s, [{ type: 'people.rename', from: 'Tobin Hale', to: 'Tobin Hales', byHand: true, cause: 'typo' }]);
  const r = undoEntry(s, s.log.findIndex((e) => e.undo && e.undo.kind === 'people.renamed'));
  assert(r.state.characters['Tobin Hale'] && !r.state.characters['Tobin Hales'], 'the page stands under its old name again: ' + Object.keys(r.state.characters));
  eq(r.state.characters['Tobin Hale'].core, 'Deputy.', 'with what it held');
  let v = run(ledger(), [{ type: 'people.note', name: 'Vanessa', field: 'state', text: 'At the bar, nursing a gin.' }]);
  v = run(v, [{ type: 'people.rename', from: 'Vanessa', to: 'Vanessa Langley', byHand: true }]);
  v = run(v, [{ type: 'people.note', name: 'Vanessa Langley', field: 'core', text: 'Journalist.' }]);
  const back = undoEntry(v, 0);
  assert(back.refused && /later change/.test(back.refused), 'the first write is not taken back over the rename: ' + (back.refused || back.words));
});

test('M769-P7 A STRAY SURNAME FOLDED INTO ITS PERSON TAKES ONLY ITS OWN WORDS (“Kuchiki” → Rukia Kuchiki rewrote “Captain Byakuya Kuchiki” and “the Kuchiki clan” in Renji’s page and a thread)', () => {
  let s = run(ledger(), [{ type: 'people.note', name: 'Renji Abarai', field: 'core', text: 'Lieutenant of the Sixth, serving under Captain Byakuya Kuchiki.' },
    { type: 'rel.shift', name: 'Kuchiki', axis: 'p', delta: 5, cause: 'she shared her rations with him' }, { type: 'thread.set', title: 'The Kuchiki clan elders want the adoption annulled', owner: 'Renji Abarai' }]);
  s = run(s, [{ type: 'people.note', name: 'Rukia Kuchiki', field: 'core', text: 'Adopted daughter of the Kuchiki clan.' }]);
  s = run(s, strayBookKeys(s).map((j) => ({ type: 'people.rename', from: j.from, to: j.to, cause: 'one person, one name in every book' })));
  eq(s.characters['Renji Abarai'].core, 'Lieutenant of the Sixth, serving under Captain Byakuya Kuchiki.', 'Renji’s page says what it said');
  eq(s.threads[0].title, 'The Kuchiki clan elders want the adoption annulled', 'and the thread');
  assert(s.relationships['Rukia Kuchiki'] && !s.relationships.Kuchiki, 'the stray standing is hers');
});

test('M769-P8 A FORGET TAKEN BACK BRINGS BACK ONLY ITS OWN LOOSE ENDS, AND A FORGET OF A SURNAME FORGETS NOBODY ELSE', () => {
  let s = run(ledger(), [{ type: 'people.note', name: 'Gregor', field: 'core', text: 'A name leaked from an example.' }, { type: 'thread.set', title: 'Gregor wants the ledger', owner: 'Gregor' }]);
  s = run(s, [{ type: 'people.forget', name: 'Gregor', cause: 'never the story’s' }]);
  s = run(s, [{ type: 'thread.set', title: 'Claire must find the cellar key before dawn', owner: 'Claire Ashford' }]);
  const r = undoEntry(s, s.log.findIndex((e) => e.undo && e.undo.kind === 'people.forgotten'));
  eq(r.state.threads.map((t) => t.title).sort().join(' | '), ['Claire must find the cellar key before dawn', 'Gregor wants the ledger'].sort().join(' | '), 'his own loose end back, the later one kept');
  const u = applyMutations(run(ledger(), [{ type: 'people.note', name: 'Rukia Kuchiki', field: 'core', text: 'Lieutenant.' }, { type: 'rel.shift', name: 'Rukia Kuchiki', axis: 'p', delta: 10, cause: 'she saved him' }]), [{ type: 'people.forget', name: 'Kuchiki' }]);
  assert(u.state.characters['Rukia Kuchiki'] && u.state.relationships['Rukia Kuchiki'], 'Rukia is not forgotten for a surname');
});

test('M769-P9 A DESCRIPTOR IS ITS PERSON AT EVERY DOOR, A GROUP IS NOBODY, AND IT HOLDS AFTER SAVING', async () => {
  let s = run(ledger(), [{ type: 'people.set', name: 'Vivi', field: 'core', text: "Jovan's stepsister; sharp-tongued." }]);
  s = run(s, [{ type: 'people.note', name: "Jovan's stepsister", field: 'state', text: 'On the stairs.' }, { type: 'people.note', name: 'several guards', field: 'state', text: 'At the gate.' }]);
  eq(Object.keys(s.characters).join(','), 'Vivi', 'one page, hers; no page for a group');
  eq(s.characters.Vivi.state, 'On the stairs.', 'the note is on it');
  const { id } = await db.stories.create({ title: 'M769-P9' });
  await saveState(id, s);
  eq(Object.keys((await loadState(id)).characters).join(','), 'Vivi', 'and after saving');
});

/* ---------- the world ---------- */
async function world({ state, text = 'Vanessa waited at the foot of the stairs.', answer }) {
  const story = await db.stories.create({ title: 'M769 world ' + Math.random() });
  await db.messages.append(story.id, { role: 'assistant', text });
  await saveState(story.id, { ...emptyState(), sheet: { playerName: 'Jovan', actors: {} }, ...state });
  const { out: result, asked } = await scripted((body, n) => answer(n, body), () => worldTurn({ connection: CONN, storyId: story.id, userText: 'I wait.', assistantText: text, story, pageAt: 0 }));
  return { result, asked, after: await loadState(story.id) };
}

test('M769-W1 THE WORLD’S SECOND ASK KEEPS THE FIRST ONE’S WORD (asked again for the people it owed, its brief was replaced by the second answer’s empty one)', async () => {
  const state = { clock: { minutes: 1200 }, place: { name: 'Blackwood Manor, the foyer' }, present: [{ name: 'Vanessa' }], characters: { Vanessa: { core: 'heiress', state: 'at the stairs' }, Claire: { core: 'detective' }, Marco: { core: 'fence' } },
    threads: [{ title: 'Claire and the missing ledger', owner: 'Claire', heat: 'hot', atTurn: 0 }, { title: 'Marco wants his money back', owner: 'Marco', heat: 'hot', atTurn: 0 }] };
  const { result, asked, after } = await world({ state, answer: (n) => (n === 1
    ? { mutations: [{ type: 'offscreen.set', name: 'Marco', location: 'the docks', activity: 'counting' }], brief: { pressure: ['Claire could call within the hour'], ripe: [], twb: null, voices: [] } }
    : { mutations: [{ type: 'offscreen.set', name: 'Claire', location: 'the precinct', activity: 'reading files' }], brief: { pressure: [], ripe: [], twb: null, voices: [] } }) });
  eq(asked.length, 2, 'asked twice');
  assert((result.brief.pressure || []).includes('Claire could call within the hour'), 'the first answer’s word stands: ' + JSON.stringify(result.brief));
  eq(Object.keys(after.offscreen).sort().join(','), 'Claire,Marco', 'and both seats');
});

test('M769-W2 A VOICE THE WORLD SAYS IS SOMEONE IN THE ROOM IS NOT A VOICE FROM BEYOND IT (“The Sheriff”, tied to Odell Cray standing on the stairs)', async () => {
  const state = { clock: { minutes: 1200 }, place: { name: 'Blackwood Manor, the foyer' }, present: [{ name: 'Deputy Vance' }, { name: 'Odell Cray' }], characters: { 'Deputy Vance': { core: 'deputy' }, 'Odell Cray': { core: 'the sheriff' } } };
  const V = [{ icon: '📻', speaker: 'The Sheriff', channel: 'county radio', content: 'All units hold the gate.', identity: { scope: 'tracked', to: 'Odell Cray', why: 'the sheriff is Odell Cray' } },
    { icon: '🍺', speaker: 'Old Tom', channel: 'the tavern', content: 'Storm took the bridge.', identity: { scope: 'local', why: 'temp' } }];
  const { result, after } = await world({ state, text: 'Vance and Cray stood by the foyer door.', answer: () => ({ mutations: [], brief: { pressure: [], ripe: [], twb: null, voices: V } }) });
  eq(voicesBeyondTheRoom(result.brief.voices, after).map((v) => v.speaker).join(','), 'Old Tom', 'only the voice from beyond the room');
  const b = await world({ state, text: 'Cray stood on the stairs.', answer: () => ({ mutations: [], brief: { pressure: [], ripe: [], twb: null, voices: [{ icon: '📻', speaker: 'Deputy Vance', channel: 'the radio', content: 'Gate is clear.' }] } }) });
  eq(b.result.identityPending.length, 0, 'a voice of someone in the room is not waited on for who it is');
  eq(worldRunState(b.result).unfinished, false, 'and the world’s run is not left unfinished for it');
});

test('M769-W3 THE LAW’S AND THE TOWN’S TITLES ARE TITLES (“Sheriff Odell Cray” in the room, and a seat for “Odell Cray” in the cellar was written)', () => {
  for (const [present, seat] of [['Sheriff Odell Cray', 'Odell Cray'], ['Deputy Mark Pruitt', 'Mark Pruitt'], ['Inspector Lestrade', 'Lestrade'], ['Nurse Joy Kim', 'Joy Kim'], ['Mayor Ada Finch', 'Ada Finch'], ['Reverend Hale', 'Hale']]) {
    const s = { ...ledger(), clock: { minutes: 1200 }, place: { name: 'Blackwood Manor, the foyer' }, present: [{ name: present }], characters: { [present]: { core: 'x' } } };
    const out = applyMutations(s, [{ type: 'offscreen.set', name: seat, location: 'the cellar', activity: 'x', source: 'world' }]);
    eq(out.applied.length, 0, seat + ' is ' + present + ', in the room');
  }
});

test('M769-W4 A WORKER’S FIELD IN CAPITALS IS THE SAME FIELD (“Core” wrote over his hand-written core that “core” could not)', async () => {
  const mk = () => ({ clock: { minutes: 1200 }, place: { name: 'Blackwood Manor, the foyer' }, present: [{ name: 'Vanessa' }], characters: { Vanessa: { core: 'heiress to the Blackwood estate', state: 'at the stairs', hand: { core: true } } } });
  for (const field of ['core', 'Core', 'CORE']) {
    const { after } = await world({ state: mk(), answer: () => ({ mutations: [{ type: 'people.set', name: 'Vanessa', field, text: 'a thief' }], brief: null }) });
    eq(after.characters.Vanessa.core, 'heiress to the Blackwood estate', 'his words stand under “' + field + '”');
  }
});

test('M769-W5 A LOOSE END IS FOUND BY WHOSE IT IS (Jovan’s “wants his money from Marco” wrote over Marco’s “wants his money”) AND A CLOSE NAMES THE ONE IT CLOSES', () => {
  const s = { ...ledger(), threads: [{ title: 'Marco wants his money', owner: 'Marco', with: 'Jovan', heat: 'hot', next: 'send two men to the flat', atTurn: 0 }] };
  const out = applyMutations(s, [{ type: 'thread.set', title: 'Jovan wants his money from Marco', owner: 'Jovan', with: 'Marco', heat: 'hot', next: 'corner Marco at the docks', source: 'world' }]);
  eq(out.state.threads.length, 2, 'two loose ends, one each');
  eq(out.state.threads.find((t) => t.owner === 'Marco').next, 'send two men to the flat', 'Marco’s stands as it was');
  const s2 = { ...ledger(), threads: [{ title: 'Vanessa and the police', owner: 'Vanessa', heat: 'hot', atTurn: 0 }, { title: 'Claire suspects the butler', owner: 'Claire', heat: 'hot', atTurn: 0 }] };
  const out2 = applyMutations(s2, [{ type: 'thread.close', title: 'Vanessa hides the letter from the police', source: 'world' }]);
  eq(out2.state.threads.length, 2, 'a close of another loose end closes none: ' + out2.rejected.map((r) => r.why).join('; '));
});

test('M769-W6 WHAT EVERYONE SAW IS PUBLIC; A PRIVATE LOOK OR A SLIP OF THE FOOT IS NOT A SECRET', () => {
  eq(publicMoment('saw Jovan slip and fall on the ballroom stairs'), true, 'a fall in the ballroom');
  eq(publicMoment('heard Cray announce aloud that the gate would close at nine'), true, 'an announcement');
  eq(publicMoment('saw Vanessa hide her face in her hands'), false, 'a private moment');
});

/* ---------- the book ---------- */
const craft = [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }];
test('M769-K1 A HOLE DEEP IN THE RECORD LOSES ONLY ITS OWN PAGES (one old line let go: 118 pages of a 201-page tale were in neither the lines nor the pages)', () => {
  const words = 'The rain kept falling on the old roofs. '.repeat(60);
  const msgs = []; for (let i = 0; i < 100; i++) { msgs.push({ id: 'u' + i, role: 'user', text: 'I do thing ' + i + '.' }); msgs.push({ id: 'a' + i, role: 'assistant', text: 'Page ' + i + ' prose. ' + words }); }
  msgs.push({ id: 'ux', role: 'user', text: 'I wait.' });
  const vis = visiblePages(msgs);
  const nodes = []; for (let s = 0; s + 10 <= vis.length - 31; s += 10) if (s !== 50) nodes.push({ id: 'n' + s, span: [s, s + 9], level: 1, at: s, text: 'LINE-' + s + ' things happened.', sourcePages: sourceBindings(vis.slice(s, s + 10)) });
  const conn = { type: 'openai', model: 'm', baseUrl: 'https://x.example', contextSize: 60000 };
  const recordThrough = windowPlan({ pages: vis, memory: { window: 30, nodes } }).resting; /* the send path's own cut (chat.js verbatimStart) */
  const r = buildRequest({ story: {}, messages: msgs, settings: {}, state: {}, modules: craft, memory: renderMemory(memoryForWindow({ nodes }, recordThrough), 400000),
    window: { keeperOn: true, window: 30, nodes, budgetTokens: contextOf(conn), answerTokens: measureTransport(conn, { systemBlocks: [], messages: [] }).answerTokens, recordThrough, recordCap: 400000 },
    transportMeasure: (req) => measureTransport(conn, req) });
  const wire = [...r.systemBlocks.map((b) => b.text || ''), ...r.messages.map((m) => String(m.content))].join('\n');
  const told = new Set();
  for (const n of nodes) if (wire.includes(n.text)) for (let i = n.span[0]; i <= n.span[1]; i++) told.add(i);
  vis.forEach((m, i) => { if (r.messages.some((x) => x.id === m.id)) told.add(i); });
  const missing = vis.map((_, i) => i).filter((i) => !told.has(i));
  eq(missing.join(','), [50, 51, 52, 53, 54, 55, 56, 57, 58, 59].join(','), 'only the hole’s own pages are missing');
  assert(/10 older pages have no line yet; the keeper fills those holes first/.test(r.receipt.slots.find((s) => s.name === 'The pages, word for word').source), 'and the receipt names them');
});

const fixtureConn = { id: 'x', type: 'openai', baseUrl: 'https://x.fixture/v1', model: 'f', apiKey: 'k', contextSize: 200000, maxTokens: 32000, reasoning: { effort: 'off' } };
test('M769-K2 A CORRECTION SET ASIDE STAYS SET ASIDE WHEN AN OLDER PAGE IS LET GO (its line only slid down one, and it was asked again: three calls)', async () => {
  const s = await db.stories.create({ title: 'M769-K2' });
  const texts = ['I walk in.', 'The hall was cold.', 'I ask who the captain is.', 'The captain, a tall woman named Ilse, nodded once at the gate.', 'I salute.', 'Ilse turned away.'];
  for (let i = 0; i < 6; i++) await db.messages.append(s.id, { role: i % 2 ? 'assistant' : 'user', text: texts[i], ts: 1000 + i });
  await saveMemory(s.id, { window: 12, nodes: [{ id: 'A', span: [0, 1], level: 1, text: 'Jovan walked into the cold hall.', whole: true, audited: 2, correctionReviewed: true },
    { id: 'B', span: [2, 5], level: 1, text: 'Captain Ilse Varga nodded at the gate; Jovan saluted.', whole: true, audited: 4, correctionReviewed: true,
      auditOpen: [{ id: 'f1', from: 2, to: 5, issue: { what: 'The surname Varga is not on these pages.', target: 'unknown' }, why: 'The fault needs grounded story versus record classification.' }] }] });
  const verdict = { sourceFidelity: { status: 'genuinelyAmbiguous', claim: 'Captain Ilse Varga', sameReferent: null, sameEvent: null, assertion: 'unclear', relation: 'unclear', preservesAssertion: false, why: 'The pages never give a surname.', conflicts: [], uncertainty: 'No original gives or denies the surname Varga.' }, allegation: 'unknown', outcome: 'blocked', why: 'No original gives or denies the surname.', evidence: [{ source: 'p4', shown: 'The captain, a tall woman named Ilse, nodded once at the gate.' }] };
  const first = await scripted(() => verdict, () => auditStretch({ connection: fixtureConn, storyId: s.id, stale: () => false, renew: () => true }));
  eq(first.out && first.out.recovery, 'blocked', 'set aside');
  const pages = visiblePages(await db.messages.list(s.id));
  await db.messages.remove(s.id, pages[1].id);
  await saveMemory(s.id, memoryAfterDeletion(await loadMemory(s.id), 1, { keepCovering: () => true }));
  const again = await scripted(() => verdict, () => auditStretch({ connection: fixtureConn, storyId: s.id, stale: () => false, renew: () => true }));
  eq(again.asked.length, 0, 'not asked again after the slide');
  eq(nextStretch(await loadMemory(s.id), visiblePages(await db.messages.list(s.id))), null, 'nothing due');
});

test('M769-K3 AN EDIT UNDER A LINE THAT STAYS IS READ AGAIN FROM THE EDITED PAGE (its reading mark said the new words were read)', () => {
  const pages = Array.from({ length: 8 }, (_, i) => ({ id: 'p' + i, role: i % 2 ? 'assistant' : 'user', text: 'page ' + i }));
  const edited = memoryWithoutPage({ nodes: [{ id: 'L', span: [0, 5], level: 1, text: 'Ilse nodded; Jovan saluted.', audited: 6, correctionReviewed: true }] }, 3, { keepCovering: () => true });
  eq(auditedOf(edited.nodes[0]), 3, 'read up to the edited page');
  eq(nextStretch(edited, pages.map((p, i) => (i === 3 ? { ...p, text: 'EDITED' } : p))).from, 3, 'and read again from it');
});

test('M769-K4 A LINE IN HIS OWN WORDS IS NEVER SQUEEZED (“Ilse is my sister, not my cousin” merged into the keeper’s “his cousin Ilse”)', async () => {
  const s = await db.stories.create({ title: 'M769-K4' });
  for (let i = 0; i < 16; i++) await db.messages.append(s.id, { role: i % 2 ? 'assistant' : 'user', text: 'Page ' + i + ' Ilse and Jovan at the gate of Karst.', ts: 1000 + i });
  const was = { squeeze: await db.settings.get('memorySqueeze'), window: await db.settings.get('memoryWindow') };
  await db.settings.set('memorySqueeze', 3); await db.settings.set('memoryWindow', 10);
  const HIS = 'Ilse is my sister, not my cousin — Jovan swore the oath at Karst gate.';
  await saveMemory(s.id, { window: 10, nodes: [{ id: 'his', span: [0, 1], level: 1, text: HIS, whole: true, verified: { at: 1, fixed: 'the writer' } },
    { id: 'b', span: [2, 3], level: 1, text: 'Ilse and Jovan walked to the gate of Karst.', whole: true }, { id: 'c', span: [4, 5], level: 1, text: 'Jovan and Ilse waited at the Karst gate.', whole: true },
    { id: 'd', span: [6, 7], level: 1, text: 'The gate of Karst opened for Ilse and Jovan.', whole: true }] });
  try {
    await scripted((body) => (/two earlier record lines/.test(body.messages.map((m) => m.content).join('\n')) ? 'Ilse and Jovan reached Karst gate; Jovan swore an oath to his cousin Ilse.' : 'NONE'),
      () => maybeSummarize({ connection: fixtureConn, storyId: s.id, stale: () => false, renew: () => true }));
  } finally {
    if (was.squeeze === undefined) await db.settings.delete('memorySqueeze'); else await db.settings.set('memorySqueeze', was.squeeze);
    if (was.window === undefined) await db.settings.delete('memoryWindow'); else await db.settings.set('memoryWindow', was.window);
  }
  const mine = (await loadMemory(s.id)).nodes.find((n) => n.id === 'his');
  assert(mine && mine.text === HIS && lineIsHis(mine), 'his line stands, in his words');
});

test('M769-K5 A LINE WRITTEN AGAIN HAS ITS OPEN CORRECTIONS RECONSIDERED AGAINST ITS NEW WORDS (one set aside held the lamp for words no longer in it)', async () => {
  const s = await db.stories.create({ title: 'M769-K5' });
  const texts = ['I walk in.', 'The hall was cold.', 'I ask who the captain is.', 'The captain, a tall woman named Ilse, nodded once at the gate.', 'I salute.', 'Ilse turned away.'];
  for (let i = 0; i < 6; i++) await db.messages.append(s.id, { role: i % 2 ? 'assistant' : 'user', text: texts[i], ts: 1000 + i });
  const pages = visiblePages(await db.messages.list(s.id));
  await saveMemory(s.id, { window: 12, nodes: [{ id: 'B', span: [2, 5], level: 1, text: 'Captain Ilse Varga nodded at the gate; Jovan saluted.', whole: true, sourcePages: sourceBindings(pages.slice(2, 6)),
    auditOpen: [{ id: 'f1', from: 2, to: 5, issue: { what: 'The surname Varga is not on these pages.', target: 'record', record: { fixes: [{ from: 'Ilse Varga', to: 'Ilse', shown: 'a tall woman named Ilse', why: 'no surname' }] } }, why: 'Missing supporting original quotation or interpretation.', recovery: { status: 'blocked', attempts: 2, input: 'x' } }] }] });
  await scripted((body) => (/Check for exactly two things|audit one record line/.test(body.messages.map((m) => m.content).join(' ')) ? 'NONE' : 'Captain Ilse nodded once at the gate; Jovan saluted.'),
    () => redoLine({ connection: fixtureConn, storyId: s.id, nodeId: 'B', renew: () => true }));
  const f = (await loadMemory(s.id)).nodes.find((n) => n.id === 'B').auditOpen[0];
  assert(!f.recovery && /written again from its pages/.test(f.why), 'reconsidered, its recovery afresh: ' + JSON.stringify(f));
});

test('M769-K6 A RECORD FIX NAMES ONE PLACE, IN WHOLE WORDS (“Renji” → “Byakuya” rewrote both Renjis in the line; “Ren” reached into “Renewed”)', () => {
  const pages = 'Byakuya handed Rukia the seal of the Sixth. Renji left the hall without a word.';
  eq(applyAuditFixes('Renji handed Rukia the seal of the Sixth; Renji left the hall.', [{ from: 'Renji', to: 'Byakuya' }], pages).used.length, 0, 'words that stand twice are not a fix');
  eq(applyAuditFixes('Renewed, Rukia took the seal.', [{ from: 'Ren', to: 'Renji' }], 'Renji renewed the oath; Rukia took the seal.').used.length, 0, 'nor the inside of a word');
  eq(applyAuditFixes('Renji handed Rukia the seal of the Sixth; he left the hall.', [{ from: 'Renji handed', to: 'Byakuya handed' }], pages).text, 'Byakuya handed Rukia the seal of the Sixth; he left the hall.', 'one place, in whole words, is made');
});

test('M769-K7 THE CONTINUOUS AUDIT LOOKS BACK, NEVER AHEAD (a line for pages 1-3 was read against page 6, where the surname is first given)', async () => {
  const s = await db.stories.create({ title: 'M769-K7' });
  const texts = ['I meet the captain.', 'The captain, a woman named Ilse, said nothing.', 'I wait.', 'Night fell.', 'I ask her name again.', 'FUTURE PAGE: She finally gave her whole name: Ilse Varga.'];
  for (let i = 0; i < 6; i++) await db.messages.append(s.id, { role: i % 2 ? 'assistant' : 'user', text: texts[i], ts: 1000 + i });
  await saveMemory(s.id, { window: 12, nodes: [{ id: 'A', span: [0, 2], level: 1, text: 'Jovan met Captain Ilse Varga, who said nothing.', whole: true }] });
  const { asked } = await scripted((body) => (body.messages.length > 2 ? '{"issues":[]}' : '<fetch>["6"]</fetch>'), () => auditStretch({ connection: fixtureConn, storyId: s.id, stale: () => false, renew: () => true }));
  assert(asked.length >= 2, 'it looked');
  assert(!asked.some((b) => b.messages.some((m) => String(m.content).includes('FUTURE PAGE'))), 'the page after the line was not served');
});
