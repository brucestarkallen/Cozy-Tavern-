/* Cozy Tavern — M752: identity, persona, aliases and the people's core (the review of M682–M751, group g8).
 * Every law runs the feature: real ledgers, real workers behind a mocked provider, real writes and take-backs. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { applyMutations, undoLast, mcPageOnlyHis, duplicatePages, lockedLooks } from '../../js/engine/apply.js';
import { isMc, findPersonKey } from '../../js/engine/people.js';
import { isMcAlias, sourcePersonaMutations, explicitMcPersona } from '../../js/engine/duels.js';
import { relevantPeople } from '../../js/engine/relevance.js';
import { thinkingHouse, withHouse, HOUSES } from './thinkinghouse.mjs';

const connection = { type: 'openai', baseUrl: 'https://custom.example/v1', apiKey: 'fixture', model: 'm', preset: 'custom', context: 64000 };
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
const PAGE = '[Sixth Division barracks — Monday, March 3, 2025 | 21:40 | rain | uniform | at the gate]\n\nThe guards at the gate exchanged a look and let Renji pass.';
const readerSaysNothing = JSON.stringify({ mutations: [{ type: 'mode.snapshot', flags: [] }], resolved: [], here: ['Renji Abarai'] });
async function readTurn(state, { userText, brief = '', castNotes = '', answer = readerSaysNothing, assistantText = PAGE }) {
  const { extractTurn } = await import('../../js/agents/extractor.js');
  return withHouse(thinkingHouse({ answer }), () => extractTurn({ connection: HOUSES[0].conn, state, userText, assistantText, brief, castNotes, pageNumber: 13 }));
}
const sixth = () => applyMutations({ ...emptyState(), page: 12 }, [{ type: 'mc.set', name: 'Renji Abarai' }, { type: 'place.set', name: 'Sixth Division barracks' },
  { type: 'presence.enter', name: 'Renji Abarai' }, { type: 'people.set', name: 'Byakuya Kuchiki', field: 'core', text: 'Captain of the Sixth Division' },
  { type: 'people.set', name: 'Rukia', field: 'core', text: 'A Shinigami of the Thirteenth Division' }, { type: 'people.set', name: 'Talin', field: 'core', text: 'An adventurer of the north road' },
  { type: 'offscreen.set', name: 'Byakuya Kuchiki', location: 'the Kuchiki manor', activity: 'reading reports' },
  { type: 'offscreen.set', name: 'Rukia', location: 'the Thirteenth Division barracks', activity: 'training' },
  { type: 'offscreen.set', name: 'Talin', location: 'the north road', activity: 'travelling' }]).state;

test('M752-P1 WHAT THE WRITER SAYS IN THE FIRST PERSON NEVER MAKES SOMEONE ELSE HIS PERSONA: a possessive, a song played for someone, "the one who found X is me", a bluff in quotation marks — single or double — leave every person their own seat, loose ends and standing; an explicit own-persona statement still registers, and a persona answers only to its own name', async () => {
  const st = sixth();
  const ordinary = "I am Byakuya Kuchiki's lieutenant, and I won't stand aside while they take her. I play Rukia's favourite song on the shamisen. I play Rukia a song. The one who found Rukia is me. I am Rukia and Ichigo's friend.\n"
    + '"I am Byakuya Kuchiki," I tell the guard at the gate. \'I am Rukia,\' I say to the second one. “I came from the north. I am Talin,” I lie to the third.';
  const read = await readTurn(st, { userText: ordinary });
  eq(read.mutations.filter((m) => m.type === 'mc.alias').map((m) => m.name).join(','), '', 'the page reader registers no persona from ordinary first-person lines or speech');
  const led = applyMutations(st, read.mutations).state;
  for (const name of ['Byakuya Kuchiki', 'Rukia', 'Talin']) {
    assert(!isMc(led, name), name + ' is not the main character');
    assert(led.offscreen[name], name + ' keeps their own seat');
  }
  const later = applyMutations({ ...led, page: 13 }, [{ type: 'people.note', name: 'Byakuya Kuchiki', field: 'thread', text: 'must answer to Central 46 for the execution order' },
    { type: 'rel.shift', name: 'Byakuya Kuchiki', axis: 'r', delta: 5, cause: 'Renji defied him openly' }]);
  eq(later.rejected.length, 0, 'his loose end and his standing are his: ' + JSON.stringify(later.rejected.map((r) => r.why)));
  assert(later.state.characters['Byakuya Kuchiki'].threads.some((t) => /Central 46/.test(t)) && !(later.state.characters['Renji Abarai']?.threads || []).some((t) => /Central 46/.test(t)), 'the loose end is on Byakuya\'s page, not Renji\'s');
  eq(later.state.relationships['Byakuya Kuchiki']?.r, 5, 'the standing moved');
  /* the writer's own explicit statements still register — the brief's line, and the story's narration */
  const told = await readTurn(st, { userText: 'I walk on.', brief: 'Renji is the player. Talin is my own persona.' });
  eq(told.mutations.filter((m) => m.type === 'mc.alias').map((m) => m.name).join(','), 'Talin', 'an explicit own-persona statement in the brief registers');
  const withTalin = applyMutations(st, told.mutations).state;
  assert(isMc(withTalin, 'Talin') && !withTalin.offscreen.Talin && withTalin.offscreen['Byakuya Kuchiki'], 'Talin is his own persona; only Talin\'s separate seat is let go');
  eq(sourcePersonaMutations(st, [{ text: 'Mara was given an escort today. Renji Abarai walks the palace as Talin, and that public identity carries his dealings at court.' }]).map((m) => m.name).join(','), 'Talin', 'the story\'s narration that he walks as Talin still registers');
  eq(sourcePersonaMutations(st, [{ text: 'Renji Abarai goes to the gate as Rukia watches from the wall.' }]).length, 0, 'an "as" that is "while" is no persona');
  assert(explicitMcPersona(st, 'Talin', 'My persona is "Talin".'), 'a quotation holding only the persona\'s name is not speech');
  /* a model's own proposal is held to the same statement — speech is never the writer's identity statement */
  eq(applyMutations(st, [{ type: 'mc.alias', name: 'Byakuya Kuchiki', shown: '"I am Byakuya Kuchiki," I tell the guard at the gate.', source: 'extractor' }]).applied.length, 0, 'a bluff quoted as evidence is refused');
  /* a persona answers to its own name: "Kira" is not "Kira Yamato" or "Lacus Kira" */
  const kira = applyMutations({ ...emptyState(), page: 3 }, [{ type: 'mc.set', name: 'Jovan Oda' }, { type: 'offscreen.set', name: 'Kira Yamato', location: 'the hangar', activity: 'tuning his machine' },
    { type: 'offscreen.set', name: 'Lacus Kira', location: 'the chapel', activity: 'singing' }, { type: 'offscreen.set', name: 'Kira', location: 'nowhere', activity: 'unworn' },
    { type: 'mc.alias', name: 'Kira', byHand: true }]).state;
  assert(isMcAlias(kira, 'Kira') && isMcAlias(kira, 'Sir Kira') && isMcAlias(kira, 'Jovan'), 'the persona, with a rank, and his story name\'s loose match are his');
  assert(!isMcAlias(kira, 'Kira Yamato') && !isMcAlias(kira, 'Lacus Kira'), 'other people who share a word of the persona are not him');
  assert(kira.offscreen['Kira Yamato'] && kira.offscreen['Lacus Kira'] && !kira.offscreen.Kira, 'registering the persona lets go only of its own seat');
});

test('M752-P2 HIS WRITER BIOGRAPHY OUTLIVES A NAME CHANGING INSIDE IT: an automatic join ("Vivi" into "Vivi Hart"), a Housekeeper spelling correction, and his own new name each rewrite the core and its proof together, so opening the story keeps it; a core that was never writer-proven is still let go', () => {
  const proven = (s) => applyMutations(s, mcPageOnlyHis(s)).state.characters[findPersonKey(s.characters, s.sheet.playerName)]?.core || '';
  let s = applyMutations({ ...emptyState(), page: 6 }, [{ type: 'mc.set', name: 'Jovan Oda' },
    { type: 'people.set', name: 'Jovan Oda', field: 'core', text: 'A transfer student from Osaka who lives with Vivi and her mother; Jovan Oda keeps a ledger of debts.', source: 'founder', writerEstablished: true, shown: 'Jovan lives with Vivi and her mother' }]).state;
  /* one person on two pages, as two readers wrote them before the house joined them */
  s = { ...s, characters: { ...s.characters, Vivi: { core: 'a café barista', state: '', arc: '', threads: [] }, 'Vivi Hart': { core: "Jovan's stepsister", state: '', arc: '', threads: [] } } };
  eq(mcPageOnlyHis(s).length, 0, 'a writer-proven core is kept on opening');
  const joins = duplicatePages(s);
  eq(JSON.stringify(joins), JSON.stringify([{ from: 'Vivi', to: 'Vivi Hart' }]), 'the automatic join');
  s = applyMutations(s, joins.map((j) => ({ type: 'people.rename', from: j.from, to: j.to, cause: 'one person, one page' }))).state;
  eq(s.characters['Jovan Oda'].core, 'A transfer student from Osaka who lives with Vivi Hart and her mother; Jovan Oda keeps a ledger of debts.', 'the join rewrote the name inside his core');
  eq(proven(s), s.characters['Jovan Oda'].core, 'and the next opening keeps his biography');
  s = applyMutations(s, [{ type: 'people.rename', from: 'Vivi Hart', to: 'Vivienne Hart', spelling: true, coordinated: true, story: true, byHand: true, cause: 'spelling' }]).state;
  assert(/Vivienne Hart/.test(s.characters['Jovan Oda'].core), 'the spelling correction reached his core');
  eq(proven(s), s.characters['Jovan Oda'].core, 'and the next opening keeps it');
  s = applyMutations(s, [{ type: 'people.rename', from: 'Jovan Oda', to: 'Jovan Wells', byHand: true, cause: 'his own new name' }]).state;
  eq(s.sheet.playerName, 'Jovan Wells');
  assert(/Jovan Wells keeps a ledger/.test(s.characters['Jovan Wells'].core), 'his own name changed inside his core');
  eq(proven(s), s.characters['Jovan Wells'].core, 'and the next opening keeps it');
  const unproven = { ...s, characters: { ...s.characters, 'Jovan Wells': { ...s.characters['Jovan Wells'], coreOrigin: undefined } } };
  eq(proven(unproven), '', 'a core with no writer proof is still let go (M681 P12)');
});

test('M752-P3 A FORMER NAME IS ONE MORE CANDIDATE, AND A DESCRIPTION IS NEVER A NAME: after "Kuchiki" joined Rukia Kuchiki, a bare "Kuchiki" once Byakuya Kuchiki exists names nobody (his loose end never lands on her); "the girl" merged into Vivi on page 3 never takes another girl\'s core forty pages later; the merge stays on record for an old finding, and a renamed proper name still finds its person', async () => {
  const { formerNameOwner } = await import('../../js/engine/people.js');
  let s = applyMutations({ ...emptyState(), page: 3 }, [{ type: 'mc.set', name: 'Ichigo' }]).state;
  s = { ...s, characters: { ...s.characters, Kuchiki: { core: 'A small Shinigami with a sword.', state: '', arc: '', threads: [] }, 'Rukia Kuchiki': { core: 'Shinigami of the 13th Division.', state: '', arc: '', threads: [] } } };
  s = applyMutations(s, duplicatePages(s).map((j) => ({ type: 'people.rename', from: j.from, to: j.to, cause: 'one person, one page' }))).state;
  assert(!s.characters.Kuchiki && s.characters['Rukia Kuchiki'], 'the automatic join');
  eq(findPersonKey(s.characters, 'Kuchiki'), 'Rukia Kuchiki', 'while she is the only Kuchiki, the former name finds her');
  s = applyMutations({ ...s, page: 9 }, [{ type: 'people.set', name: 'Byakuya Kuchiki', field: 'core', text: "Captain of the Sixth Division, Rukia's adoptive brother." }]).state;
  eq(findPersonKey(s.characters, 'Kuchiki'), '', 'two Kuchikis: the bare name names nobody');
  s = applyMutations({ ...s, page: 10 }, [{ type: 'people.note', name: 'Kuchiki', field: 'thread', text: 'owes Kenpachi a rematch at the Sixth Division grounds' }]).state;
  assert(!(s.characters['Rukia Kuchiki'].threads || []).some((t) => /Kenpachi/.test(t)), 'his loose end never lands on Rukia');
  let v = applyMutations({ ...emptyState(), page: 3 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'people.set', name: 'Vivi', field: 'core', text: "Jovan's stepsister" },
    { type: 'people.set', name: 'the girl', field: 'core', text: 'a girl at the café counter' }]).state;
  v = applyMutations(v, [{ type: 'people.rename', from: 'the girl', to: 'Vivi', source: 'auditor', cause: 'page 3: the girl at the counter was Vivi' }]).state;
  eq(formerNameOwner(v.characters, 'the girl'), 'Vivi', 'the merge stays on record, for following an old finding');
  /* an audit finding written before the merge still follows it to the merged seat (M688-19's rule, kept for descriptions) */
  const { findingSettled } = await import('../../js/agents/auditor.js');
  let m = applyMutations({ ...emptyState(), page: 0 }, [{ type: 'mc.set', name: 'Jugram' }, { type: 'place.set', name: 'the palace salle' },
    { type: 'people.set', name: 'the marshal', field: 'core', text: 'Marshal of Ilvarren.' }, { type: 'presence.enter', name: 'the marshal', position: 'the middle of the raked ground' },
    { type: 'presence.enter', name: 'Kelstrum', position: 'the middle of the raked ground' }]).state;
  m = applyMutations(m, [{ type: 'people.rename', from: 'the marshal', to: 'Kelstrum', source: 'auditor', cause: 'one man' }]).state;
  const oldFinding = { what: 'The marshal has a duplicate seat.', mutations: [{ type: 'presence.update', name: 'the marshal', position: 'the middle of the raked ground' }] };
  assert(findingSettled(oldFinding, { out: m, applied: [], rejected: [] }, [], [], null), 'the old finding about the marshal is settled by Kelstrum\'s seat');
  eq(findPersonKey(m.characters, 'the marshal'), '', 'while a new mention of "the marshal" is nobody\'s name');
  v = applyMutations({ ...v, page: 40 }, [{ type: 'people.note', name: 'the girl', field: 'thread', text: 'owes the baker three coins' }, { type: 'people.note', name: 'the girl', field: 'core', text: 'a flower seller from the docks' }]).state;
  eq(v.characters.Vivi.core, "Jovan's stepsister", 'Vivi\'s core is hers alone');
  eq((v.characters.Vivi.threads || []).length, 0, 'and no stranger\'s loose end is on her page');
  assert(/flower seller/.test(v.characters['the girl']?.core || ''), 'the other girl has a page of her own');
  assert(!relevantPeople({ ...v, characters: { Vivi: v.characters.Vivi } }, 'The girl at the counter smiled.').includes('Vivi'), 'a recorded description does not make Vivi the one a page mentions');
  let k = applyMutations({ ...emptyState(), page: 2 }, [{ type: 'mc.set', name: 'Neri' }, { type: 'people.set', name: 'the king', field: 'core', text: 'King of the coast' },
    { type: 'people.set', name: 'Orren', field: 'core', text: 'King Orren of the coast' }]).state;
  k = applyMutations(k, [{ type: 'people.rename', from: 'Orren', to: 'the king', source: 'auditor', cause: 'one king' }]).state;
  eq(findPersonKey(k.characters, 'Orren'), 'the king', 'a renamed proper name still finds its person');
});

test('M752-P4 A LOOKS QUOTE PROVES THE WORDS ARE THE PAGE\'S, NOT WHOSE THEY ARE: Rias\'s "copper hair, cut to the jaw" is never locked as absent Mira\'s, nor "Her green eyes" (Rias\'s) as Tom\'s; the same quotes for Rias, a pronoun paragraph that names nobody else, and his own message still lock', () => {
  const st = applyMutations({ ...emptyState(), page: 12 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rias' }, { type: 'presence.enter', name: 'Tom' },
    { type: 'people.set', name: 'Rias', field: 'core', text: 'the ferryman’s niece' }, { type: 'people.set', name: 'Mira', field: 'core', text: 'a ferry pilot' }]).state;
  const page = '[Wells house kitchen — Monday, March 3, 2025 | 21:45 | rain | sweater | at the table]\n\nRias pushed her copper hair, cut to the jaw, behind one ear. Her green eyes did not leave him.\n\nTom kept his back to the stove and said nothing.\n\nHis grey eyes were tired.';
  const his = 'I rub the scar across my left palm and look at her.';
  const locked = (look) => lockedLooks(st, [look], page, his).map((m) => m.name + ':' + m.key).join(',');
  eq(locked({ name: 'Mira', key: 'hair', value: 'copper, cut to the jaw', shown: 'Rias pushed her copper hair, cut to the jaw' }), '', 'not the absent Mira\'s hair');
  eq(locked({ name: 'Tom', key: 'eyes', value: 'green', shown: 'Her green eyes did not leave him' }), '', 'not Tom\'s eyes');
  eq(locked({ name: 'Rias', key: 'hair', value: 'copper, cut to the jaw', shown: 'Rias pushed her copper hair, cut to the jaw' }), 'Rias:hair', 'Rias\'s hair');
  eq(locked({ name: 'Rias', key: 'eyes', value: 'green', shown: 'Her green eyes did not leave him' }), 'Rias:eyes', 'Rias\'s eyes, by her paragraph');
  eq(locked({ name: 'Tom', key: 'eyes', value: 'grey', shown: 'His grey eyes were tired.' }), 'Tom:eyes', 'a paragraph that names nobody belongs to the page\'s people');
  eq(locked({ name: 'Jovan', key: 'scar', value: 'a scar across his left palm', shown: 'I rub the scar across my left palm' }), 'Jovan:scar', 'his own message is his');
});

test('M752-P5 A WRITER FACT ADDED UNDER "you", "the player", HIS PERSONA OR A DESCRIPTION IS ADDED TO THE PAGE IT LANDS ON — the biography that stood is never replaced by the one new fact', () => {
  const biography = "A 19-year-old transfer student from Osaka; Vivi's stepbrother.";
  const base = applyMutations({ ...emptyState(), page: 6 }, [{ type: 'mc.set', name: 'Jovan Oda' },
    { type: 'people.set', name: 'Jovan Oda', field: 'core', text: biography, source: 'founder', writerEstablished: true, shown: biography },
    { type: 'people.set', name: 'Vivi', field: 'core', text: "Jovan's stepsister, a café barista." }, { type: 'mc.alias', name: 'Shadow', byHand: true }]).state;
  for (const name of ['you', 'the player', 'Shadow', 'Jovan Oda']) {
    const r = applyMutations(base, [{ type: 'people.set', name, field: 'core', text: 'He has a scar on his left palm from a kitchen accident.', source: 'scribe', writerEstablished: true, append: true, shown: 'I have a scar on my left palm from a kitchen accident.' }]);
    eq(r.state.characters['Jovan Oda'].core, biography + ' He has a scar on his left palm from a kitchen accident.', 'under "' + name + '" the biography stands and the fact joins it');
  }
  const sister = applyMutations(base, [{ type: 'people.set', name: 'his stepsister', field: 'core', text: 'She plays violin at the Bluebird on Fridays.', source: 'auditor', append: true, shown: 'Vivi plays violin at the Bluebird on Fridays.' }]);
  eq(sister.state.characters.Vivi.core, "Jovan's stepsister, a café barista. She plays violin at the Bluebird on Fridays.", 'a description that resolves to Vivi adds to Vivi\'s core');
});

test('M752-P6 SOMEONE WHO MATTERS, LAST SEEN WALKING OFF, HAS ONE ANSWER THE WORLD IS TOLD AND THE LEDGER TAKES: the request asks for her placement with offscreen.set as a simulated development (never "unknown whereabouts remain unknown" for her, never a confirmation), the followup asks for exactly that, and once placed she is owed nothing', async () => {
  let st = applyMutations({ ...emptyState(), page: 5 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'clock.set', year: 2025, month: 3, day: 3, hour: 9, minute: 0 }, { type: 'place.set', name: 'the yard' },
    { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Mira' }, { type: 'people.set', name: 'Mira', field: 'core', text: 'his sister' },
    { type: 'rel.shift', name: 'Mira', axis: 'p', delta: 10, cause: 'she hugged him' }]).state;
  st = applyMutations({ ...st, page: 6 }, [{ type: 'presence.leave', name: 'Mira', cause: 'walked off' }]).state;
  const { worldTurn, worldOwed } = await import('../../js/agents/world.js');
  eq(JSON.stringify(worldOwed(st, {})), '["Mira"]', 'she is owed a World decision');
  eq(applyMutations({ ...st, page: 7 }, [{ type: 'offscreen.confirm', name: 'Mira', cause: 'nothing says she moved' }]).applied.length, 0, 'a last sighting cannot be confirmed (M684)');
  eq(applyMutations({ ...st, page: 7 }, [{ type: 'people.retire', name: 'Mira', cause: 'involvement ended' }]).applied.length, 0, 'nor is a sister with a standing retired');
  const id = 'm752-owed';
  await saveState(id, { ...st, page: 6 });
  await wire((body, n) => (n === 1
    ? { mutations: [{ type: 'offscreen.confirm', name: 'Mira', cause: 'nothing says she moved' }], brief: { pressure: [], ripe: [], twb: null } }
    : { mutations: [{ type: 'offscreen.set', name: 'Mira', location: 'the family kitchen', activity: 'making tea', cause: 'twenty minutes after walking off she went home' }], brief: { pressure: [], ripe: [], twb: null } }), async (calls) => {
    const r = await worldTurn({ connection, storyId: id, userText: 'I watch her go.', assistantText: 'Mira walked off across the yard without a word.', pageAt: 1 });
    const first = sent(calls[0]);
    assert(!/Unknown whereabouts remain unknown/.test(first) && !/Never invent current whereabouts from an old sighting/.test(first), 'no instruction forbids the only answer the ledger takes');
    assert(/\[ONLY LAST SEEN …\][^\n]*is placed in THIS answer with offscreen\.set and its cause: a simulated development/.test(first), 'the World law asks for her placement as a simulated development');
    assert(/Mira \[ONLY LAST SEEN — where did they go\?\]/.test(first), 'and her line says she is only last seen');
    eq(calls.length, 2, 'the refused confirmation earns the one followup');
    const followup = sent(calls[1]);
    assert(/Place Mira with offscreen\.set and a cause/.test(followup) && !/For Mira use offscreen\.set with current whereabouts or offscreen\.confirm/.test(followup), 'the followup asks only for the answer the ledger takes: ' + followup.split('Your answer did not review')[1]);
    eq((r.pending || []).length, 0, 'placed, she is owed nothing');
    eq((await loadState(id)).offscreen.Mira.location, 'the family kitchen');
    eq(worldOwed(await loadState(id), {}).length, 0, 'and the world run is finished');
  });
});

test('M752-P7 A SECOND RECLASSIFY ADDS TO THE ARCHIVE: the material a later reader wrote under the name is archived beside the first batch, never only in the 200-line log, and the take-back restores the archive exactly', () => {
  let s = applyMutations({ ...emptyState(), page: 3 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'people.set', name: 'Ilvarren', field: 'core', text: 'a proud city' }]).state;
  s = applyMutations(s, [{ type: 'people.reclassify', name: 'Ilvarren', kind: 'place', cause: 'a city', auditorApproved: true, source: 'auditor' }]).state;
  const first = JSON.stringify(s.entityCorrections.Ilvarren);
  eq(s.entityCorrections.Ilvarren.records.page.value.core, 'a proud city');
  s = applyMutations({ ...s, page: 9 }, [{ type: 'people.set', name: 'Ilvarren', field: 'core', text: 'harbour quarter where Kel keeps the stolen ledger' }, { type: 'knowledge.add', name: 'Ilvarren', fact: 'the ledger is under the third pier' }]).state;
  s = applyMutations({ ...s, page: 10 }, [{ type: 'people.reclassify', name: 'Ilvarren', kind: 'place', cause: 'still a city', auditorApproved: true, source: 'auditor' }]).state;
  const archive = s.entityCorrections.Ilvarren;
  eq(archive.records.page.value.core, 'a proud city', 'the first batch stays');
  eq(archive.laterRecords?.[0]?.page?.value?.core, 'harbour quarter where Kel keeps the stolen ledger', 'the second batch\'s page is archived');
  eq(archive.laterRecords?.[0]?.know?.value?.[0]?.fact, 'the ledger is under the third pier', 'and what it knew');
  assert(!s.characters.Ilvarren && !s.knowledge.Ilvarren, 'the live ledger holds no person Ilvarren');
  const back = undoLast(s).state;
  eq(JSON.stringify(back.entityCorrections.Ilvarren), first, 'the take-back restores the archive exactly');
  eq(back.characters.Ilvarren.core, 'harbour quarter where Kel keeps the stolen ledger', 'and the records it archived');
  eq(back.knowledge.Ilvarren[0].fact, 'the ledger is under the third pier');
});

test('M752-P8 A WORKER\'S ANSWER NEVER GRANTS ITSELF THE WRITER\'S HAND OR THE AUDITOR\'S APPROVAL: a page reader\'s "byHand" makes nobody his persona and writes no invented core over his biography, its "auditorApproved" archives nobody; a World answer\'s "byHand" retires no one who still matters; the auditor\'s own stamp still works', async () => {
  const st = applyMutations({ ...emptyState(), page: 12 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'the kitchen' }, { type: 'presence.enter', name: 'Jovan' },
    { type: 'people.set', name: 'Jovan', field: 'core', text: 'A transfer student from Osaka.', source: 'founder', writerEstablished: true, shown: 'Jovan is a transfer student from Osaka.' },
    { type: 'people.set', name: 'Mira', field: 'core', text: 'his sister, a nurse' }, { type: 'rel.shift', name: 'Mira', axis: 'p', delta: 20, cause: 'she hugged Jovan' },
    { type: 'offscreen.set', name: 'Mira', location: 'the hospital', activity: 'on shift' }]).state;
  const answer = JSON.stringify({ mutations: [{ type: 'mode.snapshot', flags: [] }, { type: 'mc.alias', name: 'Mira', shown: 'The kettle sang.', byHand: true },
    { type: 'people.set', name: 'Jovan', field: 'core', text: 'A brooding assassin with a secret past.', byHand: true },
    { type: 'people.reclassify', name: 'Mira', kind: 'place', cause: 'Mira is a town', auditorApproved: true },
    { type: 'source.resolve', sourceId: 'page:1', name: 'Mira', kind: 'place', cause: 'a town', auditorApproved: true }], here: ['Jovan'] });
  const read = await readTurn(st, { userText: 'I make tea.', answer, assistantText: '[the kitchen — Monday, March 3, 2025 | 21:40 | rain | sweater | at the stove]\n\nThe kettle sang.' });
  const after = applyMutations(st, read.mutations).state;
  assert(!isMc(after, 'Mira') && after.offscreen.Mira, 'Mira is not his persona and keeps her seat');
  eq(after.characters.Jovan.core, 'A transfer student from Osaka.', 'his writer biography stands');
  assert(!after.characters.Jovan.hand?.core, 'and no reader made it his own hand');
  assert(after.characters.Mira && after.relationships.Mira?.p === 20, 'Mira is not archived as a place');
  const { parseWorldAnswer } = await import('../../js/agents/world.js');
  const world = parseWorldAnswer(JSON.stringify({ mutations: [{ type: 'people.retire', name: 'Mira', cause: 'done', byHand: true }], brief: null }));
  eq(applyMutations(st, world.mutations.map((m) => ({ ...m, source: 'world' }))).applied.length, 0, 'the World cannot retire a sister with a standing by claiming the writer\'s hand');
  const { parseFounderAnswer } = await import('../../js/agents/founder.js');
  const founded = parseFounderAnswer(JSON.stringify({ mutations: [{ type: 'people.rename', from: 'Mira', to: 'Mirabel', spelling: true, coordinated: true, story: true }] }));
  eq(applyMutations(st, founded.mutations).state.spellingCorrections?.Mira, undefined, 'the founder\'s answer cannot install a spelling correction that rewrites every later write');
  const { stageProposals } = await import('../../js/agents/housekeeper.js');
  const card = stageProposals({ ledits: [{ type: 'people.reclassify', name: 'Mira', kind: 'place', cause: 'a town', source: 'auditor', auditorApproved: true, reason: 'tidy' }] },
    { messages: [], state: st, modules: [], lore: [], memory: null, session: null, story: { id: 'm752-hk' } }).find((x) => x.kind === 'ledit');
  eq(card.status, 'refused', 'a Housekeeper card cannot claim the final reader\'s stamp: ' + JSON.stringify(card.op.preview));
  eq(applyMutations(st, [{ type: 'people.reclassify', name: 'Mira', kind: 'place', cause: 'Mira is a town', auditorApproved: true }]).applied.length, 0, 'an approval flag without the auditor\'s own stamp archives nobody, whoever passes it on');
  eq(applyMutations(st, [{ type: 'people.reclassify', name: 'Mira', kind: 'place', cause: 'reviewed', source: 'auditor', auditorApproved: true }]).applied.length, 1, 'the final reader\'s own stamp still corrects an entity');
});

test('M752-P9 THE FOUNDER, READ AGAIN AFTER A BRIEF EDIT, ADDS TO WHO SOMEONE IS AND NEVER SETS AN EARNED ARC BACK; a standing the brief states for one axis says only that axis in its cause', async () => {
  const { foundWorld } = await import('../../js/agents/founder.js');
  const { id } = await db.stories.create({ title: 'M752 founder' });
  let st = applyMutations({ ...emptyState(), page: 0 }, [{ type: 'mc.set', name: 'Jovan' },
    { type: 'people.set', name: 'Mira', field: 'core', text: "Jovan's sister, a nurse at the city hospital.", source: 'founder' },
    { type: 'people.set', name: 'Mira', field: 'arc', text: 'Has adored her brother since they were children.', source: 'founder' },
    { type: 'people.set', name: 'Kel', field: 'arc', text: 'Owes Jovan a favour.', source: 'founder' }]).state;
  st = applyMutations({ ...st, page: 9 }, [{ type: 'people.note', name: 'Mira', field: 'core', text: 'Plays violin at the Bluebird on Fridays.', source: 'scribe' },
    { type: 'people.note', name: 'Mira', field: 'arc', text: "Furious with Jovan since he sold their mother's ring.", source: 'scribe' }]).state;
  await saveState(id, st);
  await wire((body) => (sent(body).includes('Find every place the writer STATES') ? { standings: [{ name: 'Mira', p: 40 }] }
    : { mutations: [{ type: 'people.set', name: 'Mira', field: 'core', text: "Jovan's sister, a nurse at the city hospital who works the night shift, sleeps through the mornings and hates the hospital coffee." },
      { type: 'people.set', name: 'Mira', field: 'arc', text: 'Has adored her brother since they were children.' },
      { type: 'people.set', name: 'Kel', field: 'arc', text: 'Owes Jovan a favour and resents it.' }] }), async () => {
    await foundWorld({ connection, storyId: id, brief: "Jovan is the player. Mira is Jovan's sister, a nurse at the city hospital who works the night shift, sleeps through the mornings and hates the hospital coffee; P:40 toward Jovan. Kel owes Jovan a favour and resents it.", stale: () => false });
  });
  const now = await loadState(id);
  assert(/Plays violin at the Bluebird on Fridays/.test(now.characters.Mira.core), 'what the pages added stays: ' + JSON.stringify(now.characters.Mira.core));
  assert(/works the night shift/.test(now.characters.Mira.core), 'beside what the edited brief now says: ' + JSON.stringify(now.characters.Mira.core));
  eq(now.characters.Mira.arc, "Furious with Jovan since he sold their mother's ring.", 'an arc the pages moved is not set back to the opening');
  eq(now.characters.Kel.arc, 'Owes Jovan a favour and resents it.', 'the founder\'s own arc follows the edited brief');
  eq(now.relationships.Mira.history.at(-1).cause, 'set — the brief states (P:40) toward Jovan', 'only the stated digits are said');
});

test('M752-P10 THE WORLD\'S DEBT IS A DECISION, NOT A CLOCK THAT NEVER STOPS: a seat placed before the story had a clock is settled by a confirmation in story time; and on a long cast the audit owes the World only missing decisions — the routine half-hour reviews a budgeted reading defers stay the ordinary readings\' work (M719)', async () => {
  const { worldOwed, worldDecisionsMissing, worldReviewPlan } = await import('../../js/agents/world.js');
  let st = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'people.set', name: 'Mira', field: 'core', text: 'his sister' },
    { type: 'rel.shift', name: 'Mira', axis: 'p', delta: 10, cause: 'Jovan hugged her' }, { type: 'offscreen.set', name: 'Mira', location: 'the hospital', activity: 'on shift' }]).state;
  st = applyMutations({ ...st, page: 2 }, [{ type: 'clock.set', year: 2025, month: 3, day: 3, hour: 9, minute: 0 }]).state;
  eq(JSON.stringify(worldOwed(st, {})), '["Mira"]', 'a seat never reviewed in story time is owed once the story has a clock');
  st = applyMutations({ ...st, page: 3 }, [{ type: 'offscreen.confirm', name: 'Mira', cause: 'her shift runs until noon' }]).state;
  eq(worldOwed(st, {}).length, 0, 'the confirmation settles it');
  st = applyMutations({ ...st, page: 4 }, [{ type: 'clock.advance', minutes: 45, reason: 'time passes' }]).state;
  eq(JSON.stringify(worldOwed(st, {})), '["Mira"]', 'and she is due again half an hour of story later, as every seat is');
  const muts = [{ type: 'mc.set', name: 'Jovan' }, { type: 'clock.set', year: 2025, month: 3, day: 3, hour: 9, minute: 0 }, { type: 'place.set', name: 'the yard' }, { type: 'presence.enter', name: 'Jovan' }];
  for (let i = 0; i < 40; i++) { const n = 'Guildmate ' + String.fromCharCode(65 + (i % 26)) + i; muts.push({ type: 'people.set', name: n, field: 'core', text: 'a friend of Jovan from the guild' }, { type: 'rel.shift', name: n, axis: 'p', delta: 10, cause: 'Jovan helped them' }, { type: 'offscreen.set', name: n, location: 'the guild hall, room ' + i, activity: 'working the ledgers', cause: 'their job' }); }
  let cast = applyMutations({ ...emptyState(), page: 1 }, muts).state;
  for (let turn = 2; turn <= 4; turn++) {
    cast = applyMutations({ ...cast, page: turn }, [{ type: 'clock.advance', minutes: 45, reason: 'time passes' }]).state;
    const plan = worldReviewPlan(cast, {});
    assert(plan.deferred.length > 0, 'a long cast is more than one reading can review');
    cast = applyMutations({ ...cast, page: turn }, plan.selected.map((n) => ({ type: 'offscreen.confirm', name: n, cause: 'their shift keeps them there', source: 'world' }))).state;
    assert(worldOwed(cast, {}).length > 0, 'the deferred stay due for the ordinary readings');
    eq(worldDecisionsMissing(cast, {}).length, 0, 'and the audit owes the World nothing after a complete reading');
  }
  cast = applyMutations({ ...cast, page: 5 }, [{ type: 'presence.enter', name: 'Guildmate A0' }]).state;
  cast = applyMutations({ ...cast, page: 6 }, [{ type: 'presence.leave', name: 'Guildmate A0', cause: 'walked off' }]).state;
  assert(worldDecisionsMissing(cast, {}).includes('Guildmate A0'), 'a last sighting is a missing decision the audit still owes');
});
