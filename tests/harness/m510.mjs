/* M510 — the small-model mode on the connection, the rest of the dials, the frame off whole, and the small request (his
 * choice B): the planning helper reads everything, the small model writes from the laws this scene needs, his two sound
 * laws right before a heated page, and a page that began playing him ends where it began. Every law here runs the thing. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { thinkingHouse, withHouse } from './thinkinghouse.mjs';
import { knobsOf, KNOB_FIELDS } from '../../js/providers/knobs.js';
import { callWorker, workerConnection } from '../../js/agents/call.js';
import { createProvider } from '../../js/providers/index.js';
import { buildRequest } from '../../js/assemble/stack.js';
import { CRAFT_TEXT } from '../../js/assemble/craft.js';
import { lawsOf, lawsNamed, joinLaws, ALWAYS_LAWS, SOUND_LAWS } from '../../js/assemble/laws.js';
import { plannerAsk, readPlan, runPlanner, loadPlan, keepPlan, planKey } from '../../js/agents/planner.js';
import { mineCutAt, soundCount } from '../../js/assemble/plain.js';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { db } from '../../js/store.js';

const CONN = { id: 'c-small', type: 'openai', preset: 'custom', baseUrl: 'https://small.example/v1', apiKey: 'k', model: 'hemmingway-27b', label: 'Hemmingway' };
const wireOf = (r) => [...(r.systemBlocks || []).map((b) => (typeof b === 'string' ? b : b.text)), ...r.messages.map((m) => String(m.content))].join('\n');
const H = (n) => '[Training yard — Monday, September 7, 2026 | 09:' + String(n % 60).padStart(2, '0') + ' | clear | gi | by the posts]\n\n';
function yard() {
  const st = applyMutations({ ...emptyState(), page: 20 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'clock.set', year: 2026, month: 9, day: 7, hour: 9, minute: 20 }, { type: 'place.set', name: 'Training yard' },
    { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Kaelen' }, { type: 'presence.enter', name: 'Rukia Kuchiki' },
    { type: 'people.set', name: 'Kaelen', field: 'core', text: 'fourth seat, proud, fights with a staff' }]).state;
  return { ...st, page: 20 };
}
const pages = (n) => { const out = []; for (let i = 0; i < n; i += 1) { out.push({ id: 'u' + i, role: 'user', text: 'turn ' + i }); out.push({ id: 'a' + i, role: 'assistant', text: H(i) + 'PAGE-' + i + '. Kaelen circled.' }); } out.push({ id: 'u-last', role: 'user', text: 'I raise my staff.' }); return out; };
const PLAN = { scene: 'Kaelen has called Jovan out in front of the yard.', people: [{ name: 'Kaelen', now: 'circling with his staff', wants: 'to humble Jovan', against: 'the seat Jovan was given' }], unknown: [{ name: 'Rukia Kuchiki', fact: 'Jovan met the captain last night' }], pressing: ['the captain is watching'], earlier: ['Kaelen lost to Jovan once'], laws: ['Combat Calibration', 'Voice Fingerprints'], intense: true, loud: true, loudWhy: 'the whole yard is watching', sounds: ['*CRACK!*', '"Gkh—!"'], leaveTo: 'the staff comes down at him' };
const build = (settings, extra = {}) => buildRequest({ story: { brief: 'Jovan, a new seat in the Gotei.', castNotes: 'CASTNOTES-MARK Kaelen is proud.' }, messages: pages(20), settings: { noteText: 'MY NOTE.', frameText: 'I am Iron Man, and I tell this story.', tellerName: 'Iron Man', writerName: 'Bruce', groundingPhrase: 'Jarvis, spin it up.', ...settings }, state: yard(), modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: 'RECORD-MARK the old pages.', window: { keeperOn: true, window: 30, budgetTokens: 500000 }, worldBrief: 'WORLD-MARK Hitsugaya is in the barracks.', ...extra });

test('M510-1 THE REST OF THE DIALS: each is sent only when he set it, spelled as the wire spells it; nothing set sends nothing; a refusal names the one dial it refuses', async () => {
  eq(JSON.stringify(knobsOf({})), '{}', 'nothing set, nothing sent');
  eq(JSON.stringify(knobsOf({ topK: 20.4, minP: 0.05, presencePenalty: 0, frequencyPenalty: 0.3, repetitionPenalty: 1.05, stop: ['\nJovan:', ''], seed: 7.2 })),
    JSON.stringify({ top_k: 20, min_p: 0.05, presence_penalty: 0, frequency_penalty: 0.3, repetition_penalty: 1.05, stop: ['\nJovan:'], seed: 7 }), 'every dial, a zero kept as the zero he typed');
  eq(KNOB_FIELDS.length, 7);
  const { knobRefused } = await import('../../js/providers/knobs.js');
  eq(knobRefused('Unrecognized request argument supplied: min_p', ['top_k', 'min_p']), 'min_p');
  eq(knobRefused("Extra inputs are not permitted: 'repetition_penalty'", ['repetition_penalty']), 'repetition_penalty');
  eq(knobRefused('top_k is not supported for this model', ['top_k']), 'top_k');
  eq(knobRefused('Rate limit reached for top_k users', ['top_k']), '', 'a sentence that does not refuse it names nothing');
  eq(knobRefused('Unknown parameter: top_p', ['top_k']), '', 'a field it did not send is never blamed');
});

test('M510-2 THROUGH THE REAL PROVIDER: a worker rides his top-k, min-p and seed but never a penalty or a stop text (they corrupt its JSON); a dial a house refuses is learned and left out, the turn goes again', async () => {
  const conn = { ...CONN, topK: 20, minP: 0.05, seed: 3, presencePenalty: 1.5, repetitionPenalty: 1.1, stop: ['}'] };
  const w = workerConnection(conn, {});
  assert(!('presencePenalty' in w) && !('repetitionPenalty' in w) && !('stop' in w) && w.topK === 20 && w.minP === 0.05 && w.seed === 3, 'the worker keeps the safe dials only');
  const house = thinkingHouse({ answer: '{"ok":true}' });
  await withHouse(house, () => callWorker(conn, { system: 's', user: 'u' }));
  const sent = house.calls[house.calls.length - 1].body;
  assert(sent.top_k === 20 && sent.min_p === 0.05 && sent.seed === 3, 'the safe dials ride: ' + JSON.stringify(sent).slice(0, 200));
  assert(!('presence_penalty' in sent) && !('repetition_penalty' in sent) && !('stop' in sent), 'no penalty, no stop on a worker');
  /* a house that refuses min_p says so; the house learns it and asks again without it */
  const inner = thinkingHouse({ answer: '{"ok":true}' });
  const calls = [];
  const refusing = { calls, fetch: async (url, opts) => { const body = JSON.parse(opts.body); calls.push(body); if ('min_p' in body) return new Response(JSON.stringify({ error: { message: 'Unrecognized request argument supplied: min_p' } }), { status: 400, headers: { 'content-type': 'application/json' } }); return inner.fetch(url, opts); } };
  const { id: _drop, ...bare } = CONN;
  const taught = await db.connections.add({ ...bare, label: 'Refuses min-p', topK: 20, minP: 0.05 });
  const out = await withHouse(refusing, () => callWorker(taught, { system: 's', user: 'u' }));
  eq(out.text, '{"ok":true}', 'the turn went again and answered');
  assert(calls.length === 2 && 'min_p' in calls[0] && !('min_p' in calls[1]) && calls[1].top_k === 20, 'first with min-p, then without it — top-k still rides: ' + JSON.stringify(calls.map((c) => [c.min_p, c.top_k])));
  const back = (await db.connections.list()).find((c) => c.id === taught.id);
  assert(back && Array.isArray(back.learnedDrop) && back.learnedDrop.includes('min_p'), 'remembered on the stored connection: ' + JSON.stringify(back && back.learnedDrop));
  const later = thinkingHouse({ answer: '{"ok":true}' });
  await withHouse(later, () => callWorker(back, { system: 's', user: 'u' }));
  const next = later.calls[later.calls.length - 1].body;
  assert(!('min_p' in next) && next.top_k === 20, 'and the next call never sends it, top-k still rides: ' + JSON.stringify(next).slice(0, 160));
  /* THE STORYTELLER'S OWN STREAM, thinking on: a refusal that names a dial takes the dial, never his thinking */
  const thinker = await db.connections.add({ ...bare, label: 'Thinks', preset: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', topK: 40, presencePenalty: 0.2, reasoning: { effort: 'high' } });
  const inner2 = thinkingHouse({ answer: 'The page.' });
  const seen = [];
  const strict = { fetch: async (url, opts) => { const body = JSON.parse(opts.body); seen.push(body); if ('top_k' in body) return new Response(JSON.stringify({ error: { message: 'top_k is not supported when reasoning is enabled' } }), { status: 400, headers: { 'content-type': 'application/json' } }); return inner2.fetch(url, opts); } };
  const stored = (await db.connections.list()).find((c) => c.id === thinker.id);
  const told = await withHouse(strict, () => createProvider(stored).streamChat({ system: 's', messages: [{ role: 'user', content: 'u' }], onToken() {} }));
  assert(told && typeof told === 'object', 'the turn went again and came back (this test house answers a thinking request with its thinking only)');
  assert(seen.length === 2 && seen[1].reasoning && seen[1].reasoning.effort === 'high' && !('top_k' in seen[1]) && seen[1].presence_penalty === 0.2, 'the second ask keeps his thinking and his penalty, without top-k: ' + JSON.stringify(seen[1]).slice(0, 200));
  const after = (await db.connections.list()).find((c) => c.id === thinker.id);
  assert(!after.reasoningDownAt && after.learnedDrop.includes('top_k'), 'his thinking is not marked refused; top-k is: ' + JSON.stringify([after.reasoningDownAt, after.learnedDrop]));
});

test('M510-3 THE FRAME SWITCHED OFF IS OFF WHOLE: no teller name leading the house’s lines, no grounding phrase, no raw macro — and with the frame on, all of it as before', () => {
  const on = wireOf(build({}));
  assert(/Iron Man/.test(on) && /Jarvis, spin it up/.test(on), 'frame on: the teller and his phrase ride');
  const off = wireOf(build({ frameOn: false }));
  assert(!/Iron Man/.test(off), 'frame off: the teller’s name is nowhere: ' + (off.match(/.{0,40}Iron Man.{0,40}/) || [''])[0]);
  assert(!/Jarvis, spin it up/.test(off) && !/\{\{\s*char\s*\}\}/.test(off), 'no phrase, no raw macro');
  assert(/Bruce here\./.test(off), 'the writer still opens his notes by his own name');
});

test('M510-4 HIS CRAFT, LAW BY LAW, NEVER REWORDED: every law a small page stands on is found, and every law’s words stand in the craft exactly as written', () => {
  const laws = lawsOf(CRAFT_TEXT);
  assert(laws.length > 100, 'the craft is cut into its laws: ' + laws.length);
  for (const name of [...ALWAYS_LAWS, ...SOUND_LAWS]) eq(lawsNamed(laws, [name]).length >= 1, true, 'found: ' + name);
  for (const law of laws) for (const line of law.text.split('\n').map((l) => l.trim()).filter(Boolean)) assert(CRAFT_TEXT.includes(line), 'verbatim: ' + law.name + ' — ' + line.slice(0, 60));
  const sound = joinLaws(lawsNamed(laws, SOUND_LAWS));
  assert(/^## The Prose\nSound As Onomatopoeia = two lanes, never mixed/.test(sound) && /High Intensity Scenes = /.test(sound) && /a sex, combat, or action output with zero effects is a failed draft/.test(sound), 'his two sound laws, whole, under their heading');
});

test('M510-5 THE PLANNING HELPER READS EVERYTHING, AND ITS ANSWER IS DATA: present people only (never him), the craft’s own law names only, a name shortened to its first word found, nonsense refused', async () => {
  const ask = plannerAsk({ craft: CRAFT_TEXT, brief: 'BRIEF-MARK', castNotes: 'CAST-MARK', facts: 'FACTS-MARK', people: 'PEOPLE-MARK', record: 'RECORD-MARK', lore: 'LORE-MARK', world: 'WORLD-MARK', director: 'DIRECTOR-MARK', pages: ['PAGE-A', 'The writer: I nod.'], mc: 'Jovan', lastSound: 'SOUND-MARK' });
  for (const mark of ['BRIEF-MARK', 'CAST-MARK', 'FACTS-MARK', 'PEOPLE-MARK', 'RECORD-MARK', 'LORE-MARK', 'WORLD-MARK', 'DIRECTOR-MARK', 'PAGE-A', 'I nod.', 'SOUND-MARK', 'Sound As Onomatopoeia = two lanes', 'The Prose › Sound As Onomatopoeia']) assert(ask.user.includes(mark), 'it is given: ' + mark);
  const lawNames = lawsOf(CRAFT_TEXT).filter((l) => !l.preamble).map((l) => l.name);
  const raw = 'Here you go: ' + JSON.stringify({ ...PLAN, people: [...PLAN.people, { name: 'Jovan', now: 'grins' }, { name: 'Ghost', now: 'watches' }], unknown: [{ name: 'Rukia', fact: 'Jovan met the captain' }], laws: ['The Prose › Voice Fingerprints', 'Made Up Law', 'Combat Calibration'] });
  const plan = readPlan(raw, { present: ['Jovan', 'Kaelen', 'Rukia Kuchiki'], mc: 'Jovan', lawNames });
  eq(plan.people.map((p) => p.name).join(','), 'Kaelen', 'never him, never someone absent');
  eq(plan.unknown[0].name, 'Rukia Kuchiki', 'a first name finds its person');
  eq(plan.laws.join(','), 'Voice Fingerprints,Combat Calibration', 'only the craft’s own laws');
  eq(readPlan('no json here', { lawNames }), null, 'nonsense is refused');
  const house = thinkingHouse({ answer: JSON.stringify(PLAN) });
  await withHouse(house, () => runPlanner({ connection: CONN, storyId: 's-plan', forKey: 'p1', ask, present: ['Kaelen', 'Rukia Kuchiki'], mc: 'Jovan', lawNames }));
  eq((await loadPlan('s-plan', 'p1')).people[0].name, 'Kaelen', 'kept under the page it was made after');
  eq(await loadPlan('s-plan', 'p2'), null, 'and only there');
  /* an answer it cannot use: asked once more with a word about why, then let go — never thrown into the queue's minute of retries */
  const bad = thinkingHouse({ answer: 'Sure! Here is the plan: the scene is tense.' });
  const out = await withHouse(bad, () => runPlanner({ connection: CONN, storyId: 's-plan', forKey: 'p-bad', ask, present: ['Kaelen'], mc: 'Jovan', lawNames }));
  eq(out.plan, null, 'nothing usable, nothing kept');
  eq(bad.calls.length, 2, 'asked twice, not more');
  assert(/was not the JSON object asked for/.test(JSON.stringify(bad.calls[1].body)), 'the second ask says why');
  eq(await loadPlan('s-plan', 'p-bad'), null, 'and nothing was kept for that page');
  for (let i = 2; i <= 6; i += 1) await keepPlan('s-plan', 'p' + i, PLAN);
  assert(await loadPlan('s-plan', 'p3') && !(await loadPlan('s-plan', 'p1')), 'the last four are kept (Try again finds the one before)');
  assert(planKey({ id: 'a1', swipeIdx: 1 }, 'x') !== planKey({ id: 'a1', swipeIdx: 1 }, 'y'), 'an edited page is a new page to plan after');
});

test('M510-6 THE SMALL REQUEST (B): the laws this scene needs in his words, the last eight pages, the plan in his voice last — the notes, the record and the older pages stay with the helper; a heated scene hears his two sound laws right before the page', () => {
  const full = build({});
  const small = build({ smallModelNow: true, frameOn: false, noteOn: false }, { smallPlan: { ...PLAN, intense: false }, smallIntense: false });
  const wire = wireOf(small);
  const craftOf = (r) => r.receipt.slots.find((s) => s.name === 'The craft').tokens;
  assert(craftOf(small) * 3 < craftOf(full), 'the craft is the scene’s laws: ' + craftOf(full) + ' → ' + craftOf(small));
  assert(small.receipt.totalTokens * 2 < full.receipt.totalTokens, 'the whole request is far smaller: ' + full.receipt.totalTokens + ' → ' + small.receipt.totalTokens);
  for (const line of ['Header Protocol = every story response begins with one line', 'MC Agency = ', 'Marks On The Page = prose renders as plain text', 'Combat Calibration = ', 'Voice Fingerprints = ']) assert(wire.includes(line), 'rides, in his words: ' + line);
  for (const gone of ['Pathway Laundering = ', 'CASTNOTES-MARK', 'RECORD-MARK', 'WORLD-MARK', 'PAGE-0.', 'PAGE-11.']) assert(!wire.includes(gone), 'stays with the helper: ' + gone);
  for (const kept of ['PAGE-12.', 'PAGE-19.', 'I raise my staff.']) assert(wire.includes(kept), 'the last eight pages and his message: ' + kept);
  eq(small.messages.filter((m) => m.role === 'assistant').length, 8, 'eight of the storyteller’s pages');
  const last = small.messages[small.messages.length - 1].content;
  assert(/^What I have in mind for this page, so it is in front of you\./.test(last) && /Right now — The hour: /.test(last) && /Kaelen \(fourth seat, proud, fights with a staff\) — circling with his staff; wants to humble Jovan\. Set against Jovan: the seat Jovan was given — and that holds this page\./.test(last), 'the plan, in his voice, the ledger’s own hour: ' + last.slice(0, 400));
  assert(/Leave off where the staff comes down at him — Jovan’s choice is mine to make\./.test(last), 'the page stops at his choice');
  assert(!/Sound As Onomatopoeia/.test(last), 'a calm scene hears no sound laws');
  const bad = wire.match(/\b(assistant|an AI|language model|LLM|system prompt|the system|worker|JSON|mutation|marching orders|NORTH STAR|the director|the editor|the auditor|the referee|the house|helper)\b/gi);
  assert(!bad, 'no third authority on the wire (M495): ' + JSON.stringify(bad));
  const hot = build({ smallModelNow: true, frameOn: false, noteOn: false }, { smallPlan: { ...PLAN, intense: false }, smallIntense: true, lastSound: { intense: true, effects: 0, voiced: 0 } });
  const tail = hot.messages[hot.messages.length - 1].content;
  const planAt = tail.indexOf('What I have in mind'); const soundAt = tail.indexOf('The last page went quiet'); const lawAt = tail.indexOf('Sound As Onomatopoeia = two lanes, never mixed');
  assert(planAt > -1 && soundAt > planAt && lawAt > soundAt && tail.includes('High Intensity Scenes = ') && tail.includes('This one is loud — the whole yard is watching') && tail.includes('The sounds here: *CRACK!*, "Gkh—!".'), 'heated: the plan, then the sounds and his two laws, last: ' + tail.slice(soundAt, soundAt + 300));
  const withNote = build({ smallModelNow: true, noteOn: true }, { smallPlan: PLAN, smallIntense: true });
  assert(withNote.messages[withNote.messages.length - 1].content.trimEnd().endsWith('MY NOTE.'), 'his note, switched on for a small model, still has the last word');
  assert(small.receipt.slots.some((s) => s.name === 'The plan for this page') && hot.receipt.slots.some((s) => s.name === 'The sounds'), 'each wears its own receipt row');
});

test('M510-7 OFF IS BYTE FOR BYTE: a storyteller that is not a small model gets exactly the request it always did, plan or no plan; a small model with no plan yet gets the whole request with the scene said once more', () => {
  const plain = JSON.stringify(build({}));
  eq(JSON.stringify(build({ smallModelNow: false }, { smallPlan: PLAN, smallIntense: true })), plain, 'a plan in hand changes nothing for a frontier model');
  const noPlan = build({ smallModelNow: true });
  const w = wireOf(noPlan);
  assert(w.includes('Pathway Laundering = ') && w.includes('RECORD-MARK') && /right now, so it is in front of you/i.test(w), 'no plan yet: the whole request, and the scene said once more (A)');
});

test('M510-8 WHERE THE PAGE BEGAN PLAYING HIM: the sentence that gave him words, thoughts or a move is where it ends; what his own message said never counts; the header never does', () => {
  const head = H(1);
  const scene = 'Kaelen came around low and the staff whistled past. The yard held its breath as the dust rose. ';
  const page = head + scene.repeat(3) + 'Jovan stepped inside the swing. "Too slow," Jovan said. Kaelen snarled.';
  const at = mineCutAt(page, { mc: 'Jovan', writerText: 'I watch him.' });
  assert(at > -1 && page.slice(at).startsWith('"Too slow," Jovan said.'), 'ends where it put words in his mouth: ' + page.slice(at, at + 40));
  eq(mineCutAt(page, { mc: 'Jovan', writerText: 'I step inside the swing and say "too slow".' }), -1, 'what he wrote himself is his page told back');
  eq(mineCutAt(head + scene.repeat(3) + 'Jovan stepped inside the swing and Kaelen snarled.', { mc: 'Jovan', writerText: 'I dodge in.' }), -1, 'a move is his typed move told in other words, or a note for next turn — never a cut');
  const thought = head + scene.repeat(3) + 'Jovan realized the feint was a lie. Kaelen snarled.';
  const tAt = mineCutAt(thought, { mc: 'Jovan', writerText: 'I watch him.' });
  assert(tAt > -1 && thought.slice(tAt).startsWith('Jovan realized the feint'), 'a thought that is his is where it ends');
  eq(mineCutAt(head + scene.repeat(3) + 'Jovan felt the blade bite his arm.', { mc: 'Jovan', writerText: 'I block.' }), -1, 'the world reaching him is not his mind');
  eq(mineCutAt(head + scene.repeat(3), { mc: 'Jovan' }), -1, 'a page that leaves him alone is left alone');
  eq(mineCutAt('[Jovan stepped | 09:00]\n\n' + scene, { mc: 'Jovan' }), -1, 'the header row is furniture');
  const heard = soundCount(head + 'The staff hit. *CRACK!* "Gkh—!" He spat. *drip… drip…* "Hah… hah…" *He swings the sword at the post.* "Fine," she said.');
  eq(JSON.stringify(heard), JSON.stringify({ effects: 2, voiced: 2 }), 'two contact sounds, two voiced — an asterisked sentence and a spoken word are not sounds');
});

test('M510-9 WHAT THE LEDGER KNOWS OF THE PEOPLE IN THE SCENE REACHES A SMALL MODEL IN THE LEDGER’S OWN WORDS — their hurts, what they saw, their live threads — whatever the helper chose to say; the absent crowd stays with the helper, and the ledger’s part stays small', () => {
  const muts = [{ type: 'mc.set', name: 'Jovan' }, { type: 'clock.set', year: 2026, month: 9, day: 7, hour: 9, minute: 20 }, { type: 'place.set', name: 'Training yard' },
    { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Kaelen' }, { type: 'presence.enter', name: 'Rukia Kuchiki' },
    { type: 'people.set', name: 'Kaelen', field: 'core', text: 'fourth seat, proud, fights with a staff' },
    { type: 'body.injure', name: 'Kaelen', what: 'WOUND-MARK cracked left wrist from the spar two days ago' },
    { type: 'knowledge.add', name: 'Rukia Kuchiki', fact: 'KNOWS-MARK saw Jovan leave the captain’s quarters at dawn' },
    { type: 'thread.set', name: 'Kaelen', title: 'THREAD-MARK wants a public rematch before the seat trial', heat: 3 }];
  for (let i = 0; i < 30; i += 1) muts.push({ type: 'people.set', name: ['Aster','Bramble','Cinder','Dune','Ember','Fennel','Gale','Hollow','Iris','Juniper','Kestrel','Lark','Moss','Nettle','Onyx','Pike','Quill','Reed','Sorrel','Thorn','Umber','Vale','Wren','Yarrow','Zinnia','Birch','Cedar','Flint','Hazel','Rook'][i], field: 'core', text: 'AWAY-MARK-' + i + ' a clerk of the ninth division who keeps the ledgers of the barracks and remembers every debt owed to him' }, { type: 'thread.set', name: ['Aster','Bramble','Cinder','Dune','Ember','Fennel','Gale','Hollow','Iris','Juniper','Kestrel','Lark','Moss','Nettle','Onyx','Pike','Quill','Reed','Sorrel','Thorn','Umber','Vale','Wren','Yarrow','Zinnia','Birch','Cedar','Flint','Hazel','Rook'][i], title: 'AWAYTHREAD-' + i + ' chasing a debt across the Rukongai', heat: 2 });
  const st = { ...applyMutations({ ...emptyState(), page: 20 }, muts).state, page: 20 };
  const calm = { ...PLAN, people: [], unknown: [], pressing: [], earlier: [], intense: false }; /* a helper that named none of it */
  const msgs = pages(20);
  msgs[msgs.length - 2] = { ...msgs[msgs.length - 2], text: msgs[msgs.length - 2].text + ' Aster called his name from the gate.' }; /* one absent person, named on the latest page */
  const r = buildRequest({ story: { brief: 'Bleach.' }, messages: msgs, settings: { smallModelNow: true, frameOn: false, noteOn: false }, state: st, modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: '', window: { keeperOn: true, window: 30, budgetTokens: 262000 }, smallPlan: calm });
  const w = wireOf(r);
  for (const mark of ['WOUND-MARK cracked left wrist', 'KNOWS-MARK saw Jovan leave', 'THREAD-MARK wants a public rematch', 'fourth seat, proud']) assert(w.includes(mark), 'the ledger’s own words ride: ' + mark);
  assert(w.includes('AWAY-MARK-0 '), 'someone the latest page named rides, though away (the recall tier)');
  eq((w.match(/AWAY-MARK-\d+/g) || []).filter((m) => m !== 'AWAY-MARK-0').length, 0, 'the rest of the absent crowd stays with the helper');
  const facts = r.receipt.slots.find((s) => s.name === 'The state of things');
  const minds = r.receipt.slots.find((s) => s.name === 'On their mind');
  assert(facts && facts.tokens > 0 && facts.tokens <= 1100 && minds && minds.tokens <= 1300, 'and the ledger’s part stays small: ' + (facts && facts.tokens) + ' + ' + (minds && minds.tokens) + ' tokens');
});
