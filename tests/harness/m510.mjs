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
  /* kept in the same millisecond, the newest still stands (a clock tie once let it go) */
  const realNow = Date.now; Date.now = () => 1700000000000;
  try { for (const k of ['t1', 't2', 't3', 't4', 't5']) await keepPlan('s-tie', k, PLAN); } finally { Date.now = realNow; }
  assert(await loadPlan('s-tie', 't5') && await loadPlan('s-tie', 't2') && !(await loadPlan('s-tie', 't1')), 'the newest four by order, whatever the clock says');
  /* M510-6: a plan follows its page, not its exact words — a mended page keeps its plan and is read again */
  const { planEntry, hashText } = await import('../../js/agents/planner.js');
  eq(planKey({ id: 'a1', swipeIdx: 1 }), planKey({ id: 'a1', swipeIdx: 1 }), 'the same page, whatever its words');
  assert(planKey({ id: 'a1', swipeIdx: 1 }) !== planKey({ id: 'a1', swipeIdx: 2 }), 'another version is another page');
  await keepPlan('s-mend', planKey({ id: 'a1', swipeIdx: 0 }), PLAN, hashText('the words as read'));
  const entry = await planEntry('s-mend', planKey({ id: 'a1', swipeIdx: 0 }));
  assert(entry && entry.plan && entry.hash === hashText('the words as read') && entry.hash !== hashText('the words, mended'), 'the send still has its plan after a mend, and the helper can see the words changed');
});

test('M510-6 THE SMALL REQUEST (B): the laws this scene needs in his words, the last eight pages, the plan in his voice last — the notes, the record and the older pages stay with the helper; a heated scene hears his two sound laws right before the page', () => {
  const full = build({});
  const small = build({ smallModelNow: true, frameOn: false, noteOn: false }, { smallPlan: { ...PLAN, intense: false }, smallIntense: false });
  const wire = wireOf(small);
  const craftOf = (r) => r.receipt.slots.find((s) => s.name === 'The craft').tokens;
  assert(craftOf(small) * 3 < craftOf(full), 'the craft is the scene’s laws: ' + craftOf(full) + ' → ' + craftOf(small));
  assert(small.receipt.totalTokens * 2 < full.receipt.totalTokens, 'the whole request is far smaller: ' + full.receipt.totalTokens + ' → ' + small.receipt.totalTokens);
  for (const line of ['Header Protocol = every story response begins with one line', 'MC Agency = ', 'Marks On The Page = prose renders as plain text', 'Combat Calibration = ', 'Voice Fingerprints = ']) assert(wire.includes(line), 'rides, in his words: ' + line);
  for (const gone of ['Pathway Laundering = ', 'CASTNOTES-MARK', 'PAGE-0.', 'PAGE-11.']) assert(!wire.includes(gone), 'stays with the helper: ' + gone);
  assert(wire.includes('RECORD-MARK'), 'M510-14: the record rides');
  assert(wire.includes('WORLD-MARK'), 'M510-12: the world’s word rides');
  for (const kept of ['PAGE-12.', 'PAGE-19.', 'I raise my staff.']) assert(wire.includes(kept), 'the last eight pages and his message: ' + kept);
  eq(small.messages.filter((m) => m.role === 'assistant').length, 8, 'eight of the storyteller’s pages');
  const last = small.messages[small.messages.length - 1].content;
  assert(/^What I have in mind for this page — how things stood before my move above, so it is in front of you\./.test(last) && /Right now — The hour: /.test(last) && /Kaelen \(fourth seat, proud, fights with a staff\) — circling with his staff; wants to humble Jovan\. Set against Jovan: the seat Jovan was given — and that holds this page\./.test(last), 'the plan, in his voice, the ledger’s own hour: ' + last.slice(0, 400));
  assert(/Leave off where Jovan has the next choice — before my move, that looked like: the staff comes down at him\. Jovan’s choices are mine to make\./.test(last), 'the page stops at his choice, his move above governing');
  assert(!/Sound As Onomatopoeia/.test(last), 'a calm scene hears no sound laws');
  const bad = wire.match(/\b(assistant|an AI|language model|LLM|system prompt|the system|worker|JSON|mutation|marching orders|NORTH STAR|the director|the editor|the auditor|the referee|the house|helper)\b/gi);
  assert(!bad, 'no third authority on the wire (M495): ' + JSON.stringify(bad));
  const hot = build({ smallModelNow: true, frameOn: false, noteOn: false }, { smallPlan: { ...PLAN, intense: false }, smallIntense: true, lastSound: { intense: true, effects: 0, voiced: 0 } });
  const tail = hot.messages[hot.messages.length - 1].content;
  const planAt = tail.indexOf('What I have in mind'); const soundAt = tail.indexOf('The last page went quiet'); const lawAt = tail.indexOf('Sound As Onomatopoeia = two lanes, never mixed');
  assert(planAt > -1 && soundAt > planAt && lawAt > soundAt && tail.includes('High Intensity Scenes = ') && tail.includes('This one is loud — the whole yard is watching') && tail.includes('The sounds here: *CRACK!*, "Gkh—!".'), 'heated: the plan, then the sounds and his two laws, last: ' + tail.slice(soundAt, soundAt + 300));
  assert(tail.includes('Every paragraph: a voiced line that stretches or repeats'), 'a heated page ends on what every paragraph carries');
  const hushed = build({ smallModelNow: true, frameOn: false, noteOn: false }, { smallPlan: { ...PLAN, loud: false, loudWhy: 'her sister is in the next room' }, smallIntense: true });
  const hTail = hushed.messages[hushed.messages.length - 1].content;
  assert(hTail.includes('This one has to stay muffled — her sister is in the next room: the sounds are still continuous and still long — muffled, never shortened, never missing.') && !/bitten back|half-escaped/.test(hTail), 'muffled is the same continuous sound, muffled: ' + hTail.slice(hTail.indexOf('This one'), hTail.indexOf('This one') + 160));
  const withNote = build({ smallModelNow: true, noteOn: true }, { smallPlan: PLAN, smallIntense: true });
  assert(withNote.messages[withNote.messages.length - 1].content.trimEnd().endsWith('MY NOTE.'), 'his note, switched on for a small model, still has the last word');
  assert(small.receipt.slots.some((s) => s.name === 'The plan for this page') && hot.receipt.slots.some((s) => s.name === 'The sounds'), 'each wears its own receipt row');
  /* M510-9: what a small model is not sent still stands on the receipt, with why */
  const held = (r, name) => r.receipt.slots.find((s) => s.name === name);
  assert(held(full, 'What remains') && held(full, 'What remains').tokens > 0, 'the frontier model’s receipt carries the folded record');
  const wr = held(small, 'What remains');
  assert(wr && wr.tokens > 0 && /the newest, up to about 4,000 tokens/.test(wr.source), 'M510-14: the record rides for the small model, with its row: ' + JSON.stringify(wr));
  const ww = held(small, 'The world’s word');
  assert(ww && ww.tokens > 0, 'M510-12: the world’s word is sent to the small model, with its row');
  const who = held(small, 'Who’s here');
  assert(who && /your cast notes go to the planning helper/.test(who.source + ' ' + who.reason), 'and who is here says where the cast notes went: ' + JSON.stringify(who));
  const ow = held(build({ smallModelNow: true, frameOn: false, noteOn: false, ownWordsHeldForSmall: true }, { smallPlan: PLAN }), 'Own words');
  assert(ow && ow.tokens === 0 && /Send them to a small model/.test(ow.reason), 'and his own-voice words say they were held back, and where the switch is');
  assert(!held(full, 'Own words'), 'a frontier page never shows that row');
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

test('M510-10 A HEATED PAGE IS NEVER SILENT: the intimacy rule that wakes in a sex scene now asks for a continuous soundtrack — no longer "porn volume is slop", "quiet is hotter", "wall-to-wall moaning is noise" — for every storyteller; a copy of that rule he pinned but never edited follows it, one he edited keeps his words; and a heated scene is read from what woke, his own intimacy rule too', async () => {
  const { listModules, saveModule } = await import('../../js/assemble/modules.js');
  const { heatedNow } = await import('../../js/assemble/stack.js');
  const { readFileSync } = await import('node:fs');
  const KEY = 'modules';
  const was = await db.settings.get(KEY);
  try {
    await db.settings.set(KEY, []);
    const nsfw = (await listModules()).find((m) => m.id === 'nsfw');
    /* on the wire, for the frontier model: the woken rule as it rides */
    const r = buildRequest({ story: {}, messages: pages(3), settings: {}, state: yard(), modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }, { mod: nsfw, reason: 'the scene has turned intimate' }], memory: '', window: { keeperOn: true, window: 30, budgetTokens: 262000 } });
    const w = wireOf(r);
    for (const gone of ['Porn volume as baseline is slop', 'hotter than screaming', 'wall-to-wall moaning', 'characters talk through intimacy', 'bites the pillow', 'no sound repeats three beats running']) assert(!w.includes(gone), 'no longer said: ' + gone);
    for (const said of ['A lone "Ah—" or "Mmf—" is a failed voiced line', 'Narrating a sound instead of writing it', 'muffling changes the sound, never shortens or removes it', 'Repetition inside a sound IS the sound', 'never a whole passage of the act without a word']) assert(w.includes(said), 'said: ' + said);
    /* a copy he pinned before M510-3 — the old words, never edited — follows the built-in as it stands */
    const OLD = readFileSync(new URL('./fixtures/nsfw-as-shipped-to-m510.txt', import.meta.url), 'utf8');
    assert(/Porn volume as baseline is slop/.test(OLD), 'the fixture is the old rule');
    await db.settings.set(KEY, [{ id: 'nsfw', name: nsfw.name, text: OLD, pinned: true, whenKey: 'intimate', note: '', custom: false }]);
    const pinned = (await listModules()).find((m) => m.id === 'nsfw');
    assert(pinned.text === nsfw.text && pinned.pinned === true && pinned.overridden === false, 'the pinned old copy rides the rule as it stands now, still pinned');
    const OLD3 = readFileSync(new URL('./fixtures/nsfw-as-shipped-at-m510-3.txt', import.meta.url), 'utf8');
    await db.settings.set(KEY, [{ id: 'nsfw', name: nsfw.name, text: OLD3, pinned: true, whenKey: 'intimate', note: '', custom: false }]);
    eq((await listModules()).find((m) => m.id === 'nsfw').text, nsfw.text, 'and so does a copy pinned at M510-3');
    const OLD4 = readFileSync(new URL('./fixtures/nsfw-as-shipped-at-m510-4.txt', import.meta.url), 'utf8');
    await db.settings.set(KEY, [{ id: 'nsfw', name: nsfw.name, text: OLD4, pinned: true, whenKey: 'intimate', note: '', custom: false }]);
    eq((await listModules()).find((m) => m.id === 'nsfw').text, nsfw.text, 'and one pinned at M510-4');
    /* a copy he EDITED keeps his words */
    await db.settings.set(KEY, [{ id: 'nsfw', name: nsfw.name, text: OLD + '\nMY-OWN-LINE', pinned: true, whenKey: 'intimate', note: '', custom: false }]);
    const edited = (await listModules()).find((m) => m.id === 'nsfw');
    assert(edited.text.endsWith('MY-OWN-LINE') && edited.overridden === true, 'his edit stands');
    /* pinning now stores no copy: the row keeps no words, the rule follows the built-in */
    await db.settings.set(KEY, []);
    await saveModule({ id: 'nsfw', name: nsfw.name, text: nsfw.text, pinned: true, whenKey: 'intimate', note: '' });
    const row = (await db.settings.get(KEY)).find((x) => x.id === 'nsfw');
    assert(row && row.pinned === true && row.text === null, 'a pin keeps no copy of the words: ' + JSON.stringify(row && row.text).slice(0, 40));
    eq((await listModules()).find((m) => m.id === 'nsfw').text, nsfw.text, 'and it rides the built-in');
  } finally { if (was === undefined || was === null) await db.settings.delete(KEY); else await db.settings.set(KEY, was); }
  /* a heated scene: from what woke — his own imported intimacy rule included — or the ledger's own mode */
  eq(heatedNow([{ mod: { id: 'mod-his-nsfw', whenKey: 'intimate' } }], {}), true, 'his own intimacy rule woke');
  eq(heatedNow([], { mode: { intimate: true } }), true, 'the ledger says the scene is intimate');
  eq(heatedNow([{ mod: { id: 'contested-resolution', whenKey: 'combat' } }], {}), true, 'a contest woke');
  eq(heatedNow([{ mod: { id: 'spectacle-combat', whenKey: 'manual' } }], {}), false, 'a register pinned for a whole arc is not a heated page by itself');
  eq(heatedNow([], {}), false, 'a calm page is calm');
});

test('M510-11 AN INTIMATE SCENE ON A SMALL MODEL CARRIES THE CRAFT’S WHOLE INTIMACY SECTION — pacing, limits, the body’s veto, the power dynamic, the crossing that lands — whatever the helper picked; a calm scene does not', async () => {
  const { listModules } = await import('../../js/assemble/modules.js');
  const nsfw = (await listModules()).find((m) => m.id === 'nsfw');
  const plan = { ...PLAN, laws: ['Voice Fingerprints'], intense: true };
  const mk = (mods, st) => wireOf(buildRequest({ story: {}, messages: pages(12), settings: { smallModelNow: true, frameOn: false, noteOn: false }, state: st, modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }, ...mods], memory: '', window: { keeperOn: true, window: 30, budgetTokens: 262000 }, smallPlan: plan, smallIntense: true }));
  const hot = mk([{ mod: nsfw, reason: 'the scene has turned intimate' }], yard());
  for (const law of ['Pacing = ', 'Limits Are Real = ', 'Body Veto Root Rule = ', 'Erotic Momentum Is Not A Filter = ', 'Power Dynamic = ', 'Line-Cross Vertigo = ', 'Rendering At Full Resolution = ']) assert(hot.includes(law), 'rides with the scene: ' + law);
  assert(hot.includes('Acoustics Are Simulation = ') && hot.includes('Voice Fingerprints = '), 'beside the woken rule and the helper’s pick');
  const ledgerSays = mk([], { ...yard(), mode: { intimate: true } });
  assert(ledgerSays.includes('Body Veto Root Rule = '), 'the ledger’s own intimate mode brings it too');
  const calm = mk([], yard());
  assert(!calm.includes('Body Veto Root Rule = ') && !calm.includes('Limits Are Real = '), 'a calm scene carries none of it');
});

test('M510-12 A FIGHT HE STARTS IN HIS OWN WORDS IS A FIGHT ON THAT PAGE for a small model — the craft’s fight laws and the sounds ride before the ledger has marked it; a deal struck or a question asked is not a fight', async () => {
  const { typedCombat } = await import('../../js/assemble/laws.js');
  const { heatedNow } = await import('../../js/assemble/stack.js');
  for (const t of ['I draw my zanpakuto and lunge at Kaelen.', 'I punch him in the jaw.', 'I swing my staff low.', 'Bankai.', 'I fight back.']) eq(typedCombat(t), true, 'a fight: ' + t);
  for (const t of ['I strike a deal with the merchant.', 'I kiss her.', '(( is Kaelen stronger than Jovan? ))', 'The punchline lands and everyone laughs.', 'I hit the road at dawn.']) eq(typedCombat(t), false, 'not a fight: ' + t);
  eq(heatedNow([], {}, 'I draw my sword and attack Kaelen.'), true, 'his words make the page heated');
  eq(heatedNow([], { mode: { combat: true } }), true, 'so does the ledger’s own combat mark');
  const calmPlan = { ...PLAN, intense: false, laws: ['Voice Fingerprints'] };
  const mk = (typed) => { const msgs = pages(12); msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], text: typed }; return build({ smallModelNow: true, frameOn: false, noteOn: false }, { messages: msgs, smallPlan: calmPlan, smallIntense: heatedNow([], yard(), typed) }); };
  const fight = mk('I draw my zanpakuto and lunge at Kaelen.');
  const fw = wireOf(fight);
  for (const law of ['Combat Calibration = ', 'Injury Resolution = ', 'Symmetry Law = ']) assert(fw.includes(law), 'rides on the fight’s page: ' + law);
  assert(fight.messages[fight.messages.length - 1].content.includes('Sound As Onomatopoeia = two lanes, never mixed'), 'and the sounds ride before the page');
  const calm = mk('I nod and say good morning.');
  const cw = wireOf(calm);
  assert(!cw.includes('Combat Calibration = ') && !calm.messages[calm.messages.length - 1].content.includes('Sound As Onomatopoeia = '), 'a calm page carries neither');
});

test('M510-13 A SMALL MODEL REMEMBERS THE WHOLE STORY: the helper keeps it short, the way a person remembers it, at the head of the notes; and the old fold his move names comes back word for word, with its pages — the others stay out', async () => {
  const lawNames = lawsOf(CRAFT_TEXT).filter((l) => !l.preamble).map((l) => l.name);
  const plan = readPlan(JSON.stringify({ ...PLAN, story: 'Jovan came to the Seireitei a stranger. ' + 'x '.repeat(2000) }), { present: ['Kaelen'], mc: 'Jovan', lawNames });
  assert(plan.story.startsWith('Jovan came to the Seireitei a stranger.') && plan.story.length <= 1600, 'the story in short is kept, and kept short: ' + plan.story.length);
  const STORY = 'Jovan came to the Seireitei a stranger and took the fourth seat Kaelen had trained for; Kaelen has not forgiven it.';
  const nodes = [
    { span: [0, 5], text: 'Kaelen swore an oath on the broken lantern at the mountain shrine, and hid the lantern under the stair.' },
    { span: [6, 11], text: 'Rukia drilled the recruits with wooden practice spears until the bell.' },
    { span: [12, 17], text: 'The captain named the new seat at the autumn review before the whole division.' },
    { span: [18, 23], text: 'A storm flooded the lower barracks and the recruits bailed water all night.' },
    { span: [24, 29], text: 'Kaelen walked the wall alone after the review.' },
  ];
  const msgs = pages(12);
  msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], text: 'I set the broken lantern from the mountain shrine on the table between us.' };
  const r = buildRequest({ story: {}, messages: msgs, settings: { smallModelNow: true, frameOn: false, noteOn: false }, state: yard(), modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: '', window: { keeperOn: true, window: 30, budgetTokens: 262000, nodes }, smallPlan: { ...PLAN, intense: false, story: STORY } });
  const notes = String(r.messages[0].content);
  assert(notes.includes('Our story so far, the way I remember it:\n' + STORY), 'the story in short heads the notes: ' + notes.slice(0, 200));
  assert(r.receipt.slots.some((s) => s.name === 'The story in short' && s.tokens > 0), 'with its own receipt row');
  const last = String(r.messages[r.messages.length - 1].content);
  assert(/And from our story so far, each from its own time — \(pages 1–6\) Kaelen swore an oath on the broken lantern at the mountain shrine/.test(last), 'the fold his move names, word for word, with its pages: ' + last.slice(last.indexOf('And from'), last.indexOf('And from') + 160));
  assert(!/drilled the recruits|flooded the lower barracks/.test(last), 'the folds nothing named stay out');
  const calm = buildRequest({ story: {}, messages: pages(12), settings: { smallModelNow: true, frameOn: false, noteOn: false }, state: yard(), modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: '', window: { keeperOn: true, window: 30, budgetTokens: 262000, nodes }, smallPlan: { ...PLAN, intense: false } });
  assert(!/And from our story so far/.test(String(calm.messages[calm.messages.length - 1].content)) && !calm.receipt.slots.some((s) => s.name === 'The story in short'), 'nothing named, nothing called back; no story kept, no row');
});

test('M510-14 THE WORLD ELSEWHERE REACHES A SMALL MODEL: the world’s word — what could reach this scene and why, what ripened out of sight — rides, whoever it names comes with their card, and an open window beyond the page has the word it is written from', async () => {
  const { renderWorldBrief } = await import('../../js/engine/world.js');
  const { listModules } = await import('../../js/assemble/modules.js');
  const st0 = applyMutations({ ...emptyState(), page: 20 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Training yard' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Kaelen' },
    { type: 'people.set', name: 'Renji Abarai', field: 'core', text: 'RENJI-CARD lieutenant of the sixth division, loud, loyal' }, { type: 'people.set', name: 'Byakuya Kuchiki', field: 'core', text: 'captain of the sixth division, cold' }]).state;
  const st = { ...st0, page: 20 };
  const brief = { pressure: ['Renji Abarai is on his way from the party at the Kuchiki manor to fetch Jovan — Byakuya wants the new seat seen by the other captains tonight'], ripe: ['The party began at dusk; half the captains are there'], twb: { who: 'Byakuya Kuchiki', where: 'the Kuchiki manor', changed: 'he raised a cup to the new seat before the other captains' }, atPage: 20 };
  const world = renderWorldBrief(brief, 20, 20);
  assert(/Renji Abarai is on his way from the party at the Kuchiki manor/.test(world) && /A window into the world beyond is open this turn/.test(world), 'the world’s word says where, who and why');
  const windowRule = (await listModules()).find((m) => m.id === 'world-window');
  const r = buildRequest({ story: {}, messages: pages(12), settings: { smallModelNow: true, frameOn: false, noteOn: false }, state: st, modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }, { mod: windowRule, reason: 'a window is open' }], memory: '', window: { keeperOn: true, window: 30, budgetTokens: 262000 }, worldBrief: world, smallPlan: { ...PLAN, intense: false } });
  const w = wireOf(r);
  assert(w.includes('Renji Abarai is on his way from the party at the Kuchiki manor to fetch Jovan — Byakuya wants the new seat seen'), 'the party, who comes, and why reach the small model');
  assert(w.includes('RENJI-CARD'), 'the one the world’s word names comes with his card, though away');
  assert(w.includes('he raised a cup to the new seat before the other captains') && w.includes('The Window Beyond The Page'), 'an open window has its rule AND the word it is written from');
});

test('M510-15 NO GAP BETWEEN THE EIGHT PAGES AND THE RECORD: a move that names something from the pages in between (neither whole nor folded for a small model) brings that paragraph back word for word, with its page; and the episode plan, his standing notes and the last page’s slips reach a small model too', async () => {
  const { renderDirectorNote } = await import('../../js/agents/director.js');
  const { renderEditorNote } = await import('../../js/agents/editor.js');
  const { houseEyeWords } = await import('../../js/agents/lint.js');
  const msgs = [];
  for (let i = 0; i < 40; i += 1) {
    msgs.push({ id: 'u' + i, role: 'user', text: 'turn ' + i });
    const body = i === 25 ? 'Rukia knelt by the koi pond and hid the silver comb inside the lacquered box, then set the box under the stone lantern where nobody would look.' : 'Kaelen circled the yard again while the recruits drilled with their spears until the evening bell.';
    msgs.push({ id: 'a' + i, role: 'assistant', text: H(i) + 'PAGE-' + i + '. ' + body + '\n\nThe dust settled over the packed earth of the yard.' });
  }
  msgs.push({ id: 'u-last', role: 'user', text: 'I lift the stone lantern and open the lacquered box.' });
  const nodes = Array.from({ length: 15 }, (_, k) => ({ span: [k * 2, k * 2 + 1], text: 'Record ' + k + ': drills in the yard, the captain watching.' })); /* the record reaches page 30 of 81 */
  const r = buildRequest({ story: {}, messages: msgs, settings: { smallModelNow: true, frameOn: false, noteOn: false }, state: yard(), modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: '', window: { keeperOn: true, window: 30, budgetTokens: 262000, nodes },
    smallPlan: { ...PLAN, intense: false },
    directorNote: renderDirectorNote({ episode: 3, text: 'PREMISE — DIRECTOR-MARK the comb comes back to Rukia.' }),
    editorEye: renderEditorNote({ enabled: true, critique: { northStar: 'EDITOR-MARK keep it close.', notes: ['Let Rukia drive one beat.'] } }),
    houseEye: houseEyeWords([{ kind: 'craft', severity: 'warn', words: 'EYE-MARK a dead phrase is on the page.', law: 'Dead Phrases' }]) });
  const last = String(r.messages[r.messages.length - 1].content);
  assert(/And from the pages in between, word for word — \(page 52\) PAGE-25\. Rukia knelt by the koi pond and hid the silver comb inside the lacquered box/.test(last), 'the paragraph his move names, with its page: ' + last.slice(last.indexOf('And from the pages'), last.indexOf('And from the pages') + 200));
  assert(!/PAGE-3[5-9]\. Kaelen circled/.test(last.slice(last.indexOf('And from the pages'))), 'nothing from the eight pages it already has');
  const w = wireOf(r);
  for (const mark of ['DIRECTOR-MARK', 'EDITOR-MARK', 'EYE-MARK']) assert(w.includes(mark), 'rides for a small model: ' + mark);
  const calmMsgs = msgs.slice(0, -1).concat([{ id: 'u-last', role: 'user', text: 'I nod to Kaelen.' }]);
  const calm = buildRequest({ story: {}, messages: calmMsgs, settings: { smallModelNow: true, frameOn: false, noteOn: false }, state: yard(), modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: '', window: { keeperOn: true, window: 30, budgetTokens: 262000, nodes }, smallPlan: { ...PLAN, intense: false } });
  assert(!/And from the pages in between/.test(String(calm.messages[calm.messages.length - 1].content)), 'nothing named, nothing brought back');
});

test('M510-16 THE RECORD RIDES FOR A SMALL MODEL — the keeper’s folds, written once and never rewritten, up to about 4,000 tokens, the newest first; older lines past the cap are said to rest, and still come back when his move names them', async () => {
  const { newestLines, SMALL_RECORD_CHARS } = await import('../../js/assemble/stack.js');
  const lines = Array.from({ length: 400 }, (_, i) => 'LINE-' + i + ' the yard, the drills, the captain watching from the gallery, nothing more.');
  const cut = newestLines(lines.join('\n'), SMALL_RECORD_CHARS);
  assert(cut.text.length <= SMALL_RECORD_CHARS && cut.text.endsWith('LINE-399 the yard, the drills, the captain watching from the gallery, nothing more.') && !cut.text.includes('LINE-0 ') && cut.rested > 0, 'the newest within the cap, the oldest resting: ' + cut.rested);
  eq(newestLines('A\nB', 100).rested, 0, 'a short record rides whole');
  const r = build({ smallModelNow: true, frameOn: false, noteOn: false }, { smallPlan: { ...PLAN, intense: false }, memory: lines.join('\n') });
  const w = wireOf(r);
  assert(w.includes('LINE-399 ') && !w.includes('LINE-0 ') && /What remains of the older pages \(the newest of them; \d+ older lines rest outside this page\):/.test(w), 'the newest folds ride, the oldest said to rest');
  const row = r.receipt.slots.find((s) => s.name === 'What remains');
  assert(row && row.tokens > 3000 && row.tokens <= 4100 && /older lines rest outside this page/.test(row.reason), 'about 4,000 tokens, and the receipt says the rest rests: ' + (row && row.tokens));
  const bad = w.match(/\b(the house|helper|worker|JSON)\b/gi);
  assert(!bad, 'said in the writer’s words: ' + JSON.stringify(bad));
});


test('M510-17 THE STORY’S ESSENTIALS (his design): the whole record streamlined, rebuilt only when the record changes and always from the record itself, always in front of a small model; the detailed lines ride only when named, or when folded since', async () => {
  const { recordOf, runEssentials, loadEssentials, essentialsAsk } = await import('../../js/agents/essentials.js');
  const nodes = [
    { span: [0, 5], text: 'OLDEST-LINE Jovan arrived at the Seireitei; Kaelen swore an oath on the broken lantern at the mountain shrine.', level: 1, at: 1 },
    { span: [6, 11], text: 'Rukia saw Jovan leave the captain’s quarters at dawn and told no one.', level: 1, at: 2 },
    { span: [12, 17], text: 'NEWEST-LINE The captain named Jovan fourth seat; Kaelen walked the wall alone.', level: 1, at: 3 },
  ];
  const rec = recordOf(nodes);
  assert(rec.text.indexOf('OLDEST-LINE') < rec.text.indexOf('NEWEST-LINE') && rec.upTo === 17 && /\(pages 1–6\)/.test(rec.text), 'the whole record, oldest first, with its pages');
  const ESS = 'Who they are to each other:\nKaelen resents Jovan for the seat.\nWhat has happened, in order:\nJovan arrived; Kaelen swore on the lantern; Jovan was named fourth seat.\nWhat still stands:\nRukia knows about the dawn.\nWhere things were left:\nKaelen alone on the wall.';
  const house = thinkingHouse({ answer: ESS });
  const out = await withHouse(house, () => runEssentials({ connection: CONN, storyId: 's-ess', nodes, brief: 'Bleach.', mc: 'Jovan' }));
  assert(out.wrote && house.calls.length === 1, 'made once');
  const sent = JSON.stringify(house.calls[0].body);
  assert(sent.includes('OLDEST-LINE') && sent.includes('NEWEST-LINE'), 'from the WHOLE record — its beginning too');
  const kept = await loadEssentials('s-ess');
  assert(kept.text.startsWith('Who they are to each other:') && kept.upTo === 17, 'kept, with how far the record reached');
  const again = await withHouse(house, () => runEssentials({ connection: CONN, storyId: 's-ess', nodes, mc: 'Jovan' }));
  assert(!again.wrote && again.why === 'unchanged' && house.calls.length === 1, 'the record unchanged: nothing asked');
  const grown = [...nodes, { span: [18, 23], text: 'Kaelen challenged Jovan to a duel at the autumn review.', level: 1, at: 4 }];
  await withHouse(house, () => runEssentials({ connection: CONN, storyId: 's-ess', nodes: grown, mc: 'Jovan' }));
  assert(house.calls.length === 2 && JSON.stringify(house.calls[1].body).includes('OLDEST-LINE') && (await loadEssentials('s-ess')).upTo === 23, 'the record grew: made again from the whole record, never from the last essentials');
  const bad = thinkingHouse({ answer: '{"sorry": true}' });
  const failed = await withHouse(bad, () => runEssentials({ connection: CONN, storyId: 's-ess', nodes: [...grown, { span: [24, 29], text: 'A new fold.', level: 1, at: 5 }], mc: 'Jovan' }));
  assert(!failed.wrote && bad.calls.length === 2 && (await loadEssentials('s-ess')).upTo === 23, 'an unusable answer: asked once more, then the essentials already kept stand');
  assert(/Where things were left:/.test(essentialsAsk({ record: 'x' }).system) && /At most 2,000 words/.test(essentialsAsk({ record: 'x' }).system), 'the four lines are asked for, in the room the record’s newest lines had');
  const { readEssentials, ESSENTIALS_MAX_CHARS } = await import('../../js/agents/essentials.js');
  eq(ESSENTIALS_MAX_CHARS, 16000);
  const long = readEssentials('Who they are to each other:\n' + 'Kaelen resents Jovan. '.repeat(1500));
  assert(long.length === ESSENTIALS_MAX_CHARS && long.endsWith('…'), 'a longer answer is kept to about 4,000 tokens: ' + long.length);
  /* the small request: the essentials in front, the detailed lines only when named or folded since */
  const withLater = [...grown, { span: [24, 29], text: 'LATER-LINE Jovan trained with Rukia at night.', level: 1, at: 5 }];
  const msgs = pages(40);
  msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], text: 'I show Kaelen the broken lantern from the mountain shrine.' };
  const r = buildRequest({ story: {}, messages: msgs, settings: { smallModelNow: true, frameOn: false, noteOn: false }, state: yard(), modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: withLater.map((n) => '- ' + n.text).join('\n'), window: { keeperOn: true, window: 30, budgetTokens: 262000, nodes: withLater }, smallPlan: { ...PLAN, intense: false }, smallEssentials: { text: ESS, upTo: 23 } });
  const notes = String(r.messages[0].content);
  assert(notes.includes('What our story holds, in essentials:\n' + ESS), 'the essentials are in front');
  assert(!notes.includes('NEWEST-LINE') && !notes.includes('Rukia saw Jovan leave'), 'the lines the essentials stand for do not ride as they are');
  assert(/Folded since the essentials were made:\n- LATER-LINE/.test(notes), 'what was folded since rides as it is');
  const last = String(r.messages[r.messages.length - 1].content);
  assert(/\(pages 1–6\) OLDEST-LINE Jovan arrived at the Seireitei; Kaelen swore an oath on the broken lantern/.test(last), 'a line his move names comes back in detail, word for word');
  assert(r.receipt.slots.some((s) => s.name === 'Story essentials' && s.tokens > 0) && r.receipt.slots.some((s) => s.name === 'What remains' && /folded since the essentials/.test(s.source)), 'each with its receipt row');
});
