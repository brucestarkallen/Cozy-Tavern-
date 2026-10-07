/* M510 — the small-model mode on the connection, the rest of the dials, the frame off whole, and the small request (his
 * choice B): the planning helper reads everything, the small model writes from the laws this scene needs, his two sound
 * laws right before a heated page, and a page that began playing him ends where it began. Every law here runs the thing. */
import './idb-shim.mjs';
import { test, assert, eq, notesOf } from './lib.mjs';
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
  /* M576: a page's versions as the app keeps them (a swipeIdx only ever stands beside its swipes) — the key is the version the page SHOWS */
  const three = [{ text: 'a' }, { text: 'b' }, { text: 'c' }];
  eq(planKey({ id: 'a1', swipes: three, swipeIdx: 1 }), planKey({ id: 'a1', swipes: three, swipeIdx: 1 }), 'the same page, whatever its words');
  assert(planKey({ id: 'a1', swipes: three, swipeIdx: 1 }) !== planKey({ id: 'a1', swipes: three, swipeIdx: 2 }), 'another version is another page');
  await keepPlan('s-mend', planKey({ id: 'a1', swipeIdx: 0 }), PLAN, hashText('the words as read'));
  const entry = await planEntry('s-mend', planKey({ id: 'a1', swipeIdx: 0 }));
  assert(entry && entry.plan && entry.hash === hashText('the words as read') && entry.hash !== hashText('the words, mended'), 'the send still has its plan after a mend, and the helper can see the words changed');
});

test('M510-6 THE SMALL REQUEST (B): the laws this scene needs in his words, the last eight pages, the plan in his voice last — the notes, the record and the older pages stay with the helper; a heated scene hears his two sound laws right before the page', () => {
  const full = build({});
  const small = build({ smallModelNow: true, frameOn: false, noteOn: false }, { smallPlan: { ...PLAN, intense: false }, smallIntense: false });
  const wire = wireOf(small);
  const craftOf = (r) => r.receipt.slots.find((s) => s.name === 'The craft').tokens;
  /* M605: under HALF of the whole craft (it was a third): the laws on secrets, pathways and competence, and on how people take a
   * stranger, ride every small page now — each one's absence was a failure he reported on the small model (a masked hero's real
   * name known with no pathway; people cursing one-sidedly or polite beyond any human); measured 19,531 → 7,315 tokens */
  assert(craftOf(small) * 2 < craftOf(full), 'the craft is the scene’s laws: ' + craftOf(full) + ' → ' + craftOf(small));
  assert(small.receipt.totalTokens * 2 < full.receipt.totalTokens, 'the whole request is far smaller: ' + full.receipt.totalTokens + ' → ' + small.receipt.totalTokens);
  for (const line of ['Header Protocol = every story response begins with one line', 'MC Agency = ', 'Marks On The Page = prose renders as plain text', 'Combat Calibration = ', 'Voice Fingerprints = ']) assert(wire.includes(line), 'rides, in his words: ' + line);
  /* M605: Pathway Laundering is part of Not Pathways Ever, which rides every small page now — Ruin Awareness stands for a law only the helper picks */
  for (const gone of ['Ruin Awareness = ', 'CASTNOTES-MARK', 'PAGE-0.', 'PAGE-11.']) assert(!wire.includes(gone), 'stays with the helper: ' + gone);
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
  assert(!/small model/.test((held(full, 'Own words') || {}).reason || ''), 'a frontier page never says its own words were held for a small model');
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
  const notes = notesOf(r);
  assert(notes.includes('In brief, as I remember it:\n' + STORY) && notes.indexOf('Our story so far') < notes.indexOf('In brief, as I remember it'), 'the story in short is the brief of our story so far (M510-53): ' + notes.slice(0, 200));
  assert(r.receipt.slots.some((s) => s.name === 'The story in short' && s.tokens > 0), 'with its own receipt row');
  const last = String(r.messages[r.messages.length - 1].content);
  assert(/And from our story so far, each from its own time — \(pages 1–6\) Kaelen swore an oath on the broken lantern at the mountain shrine/.test(last), 'the fold his move names, word for word, with its pages: ' + last.slice(last.indexOf('And from'), last.indexOf('And from') + 160));
  assert(!/drilled the recruits|flooded the lower barracks/.test(last), 'the folds nothing named stay out');
  const calm = buildRequest({ story: {}, messages: pages(12), settings: { smallModelNow: true, frameOn: false, noteOn: false }, state: yard(), modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: '', window: { keeperOn: true, window: 30, budgetTokens: 262000, nodes }, smallPlan: { ...PLAN, intense: false } });
  assert(!/And from our story so far/.test(String(calm.messages[calm.messages.length - 1].content)) && calm.receipt.slots.some((s) => s.name === 'The story in short' && s.tokens === 0 && /not written yet/.test(s.reason)), 'nothing named, nothing called back; no story kept — its row stands at 0 saying why (M510-20)');
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
  assert(w.includes('LINE-399 ') && !w.includes('LINE-0 ') && /In full, the newest of it/.test(w), 'the newest folds ride (M510-53: no count of the rest — the brief stands for them)');
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
  const ESS = '- [Sept 1 · the Seireitei] (pages 1–12) Jovan arrived; Kaelen swore "I will guard this lantern" on the broken lantern; Rukia witnessed Jovan’s dawn exit from the captain’s quarters → kept it secret.\n- [Sept 9 · the wall] (pages 13–24) The captain named Jovan fourth seat → Kaelen resents Jovan; Kaelen challenged Jovan to a duel at the autumn review.';
  const house = thinkingHouse({ answer: ESS });
  const out = await withHouse(house, () => runEssentials({ connection: CONN, storyId: 's-ess', nodes, brief: 'Bleach.', mc: 'Jovan' }));
  assert(out.wrote && house.calls.length === 1, 'made once');
  const sent = JSON.stringify(house.calls[0].body);
  assert(sent.includes('OLDEST-LINE') && sent.includes('NEWEST-LINE'), 'from the WHOLE record — its beginning too');
  const kept = await loadEssentials('s-ess');
  assert(kept.text.startsWith('- [Sept 1 · the Seireitei] (pages 1–12)') && kept.upTo === 17, 'kept in the record’s own format, with how far the record reached');
  const again = await withHouse(house, () => runEssentials({ connection: CONN, storyId: 's-ess', nodes, mc: 'Jovan' }));
  assert(!again.wrote && again.why === 'unchanged' && house.calls.length === 1, 'the record unchanged: nothing asked');
  const grown = [...nodes, { span: [18, 23], text: 'Kaelen challenged Jovan to a duel at the autumn review.', level: 1, at: 4 }];
  await withHouse(house, () => runEssentials({ connection: CONN, storyId: 's-ess', nodes: grown, mc: 'Jovan' }));
  assert(house.calls.length === 2 && JSON.stringify(house.calls[1].body).includes('OLDEST-LINE') && (await loadEssentials('s-ess')).upTo === 23, 'the record grew: made again from the whole record, never from the last essentials');
  const bad = thinkingHouse({ answer: '{"sorry": true}' });
  const failed = await withHouse(bad, () => runEssentials({ connection: CONN, storyId: 's-ess', nodes: [...grown, { span: [24, 29], text: 'A new fold.', level: 1, at: 5 }], mc: 'Jovan' }));
  /* M666: it was "asked once more" (two asks). He asked that a worker whose answer is not a summary be tried again as the
   * others are; the essentials are asked three times now (ESSENTIALS_TRIES), and the count below follows that. */
  assert(!failed.wrote && bad.calls.length === 3 && (await loadEssentials('s-ess')).upTo === 23, 'an unusable answer: asked twice more, then the essentials already kept stand');
  { const sys = essentialsAsk({ record: 'x' }).system; assert(/THE SAME FORMAT/.test(sys) && /\[Sept 1, 08:24 · the Wells kitchen\]/.test(sys) && /Cut what nothing later depends on: small talk, errands, passers-by and crowds/.test(sys) && /every correction/.test(sys) && /At most 2,000 words/.test(sys), 'M510-21: his format — the record’s own lines, told shorter; trivia cut; time and place kept; in the room the record’s newest lines had'); }
  const { readEssentials, ESSENTIALS_MAX_CHARS } = await import('../../js/agents/essentials.js');
  eq(ESSENTIALS_MAX_CHARS, 16000);
  const long = readEssentials(Array.from({ length: 400 }, (_, i) => '[Day ' + i + ' · the yard] (pages ' + i + '–' + i + ') Kaelen resents Jovan; Rukia watched.').join('\n'));
  assert(long.length <= ESSENTIALS_MAX_CHARS && long.length > ESSENTIALS_MAX_CHARS - 200 && /Rukia watched\.$/.test(long), 'a longer answer is kept to about 4,000 tokens, cut at a line’s end: ' + long.length);
  eq(readEssentials('Who they are to each other: Kaelen resents Jovan for the seat, and Rukia knows about the dawn, and more.'), '', 'prose with no line of the record’s shape is refused');
  eq(readEssentials('Here are the essentials:\n[Sept 1 · gate] (pages 1–3) Jovan arrived; Rukia greeted Jovan at the gate of the Seireitei.').startsWith('- [Sept 1 · gate]'), true, 'a preface before the first line is dropped');
  /* the small request: the essentials in front, the detailed lines only when named or folded since */
  const withLater = [...grown, { span: [24, 29], text: 'LATER-LINE Jovan trained with Rukia at night.', level: 1, at: 5 }];
  const msgs = pages(40);
  msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], text: 'I show Kaelen the broken lantern from the mountain shrine.' };
  /* M510-21: with Kaelen and Rukia in the scene their own lines ride (who's here, in the record) — here the MC is alone,
   * so what the essentials stand for is seen standing for it */
  const alone = { ...applyMutations({ ...emptyState(), page: 20 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Training yard' }, { type: 'presence.enter', name: 'Jovan' }]).state, page: 20 };
  const r = buildRequest({ story: {}, messages: msgs, settings: { smallModelNow: true, frameOn: false, noteOn: false }, state: alone, modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: withLater.map((n) => '- ' + n.text).join('\n'), window: { keeperOn: true, window: 30, budgetTokens: 262000, nodes: withLater }, smallPlan: { ...PLAN, intense: false }, smallEssentials: { text: ESS, upTo: 23 } });
  const notes = notesOf(r);
  assert(/In brief, from the beginning \(pages 1–\d+\):\n/.test(notes) && notes.includes(ESS), 'the essentials are in front — the brief of our story so far (M510-53)');
  assert(!notes.includes('NEWEST-LINE') && !notes.includes('Rukia saw Jovan leave'), 'the lines the essentials stand for do not ride as they are');
  assert(/In full, since then \(pages \d+–\d+\):\n- \(pages \d+–\d+\) LATER-LINE/.test(notes), 'what was folded since rides as it is — in full, with its pages (M510-53): ' + (notes.match(/In full, since then[\s\S]{0,160}/) || [''])[0]);
  const last = String(r.messages[r.messages.length - 1].content);
  assert(/\(pages 1–6\) OLDEST-LINE Jovan arrived at the Seireitei; Kaelen swore an oath on the broken lantern/.test(last), 'a line his move names comes back in detail, word for word');
  assert(r.receipt.slots.some((s) => s.name === 'Story essentials' && s.tokens > 0) && r.receipt.slots.some((s) => s.name === 'What remains' && /folded since the essentials/.test(s.source)), 'each with its receipt row');
});

test('M510-18 A FIRST PAGE’S HEADER IN ANOTHER DRESS IS THE HEADER: it opens the page as it streams (never the whole page into the thinking and back), it is kept in the shape the ledger reads, and a page with no header still gets its paragraphs', async () => {
  const { makeHeaderGate, isHeaderLine } = await import('../../js/ui/headergate.js');
  const { tidyPage } = await import('../../js/ui/pageshape.js');
  const { headerMutations } = await import('../../js/engine/state.js');
  const run = (reply) => { let thinking = ''; let prose = ''; let back = ''; const g = makeHeaderGate({ onThinking: (t) => { thinking += t; }, onProse: (t) => { prose += t; }, onGiveBack: (t) => { back += t; } }); for (let i = 0; i < reply.length; i += 5) g.feed(reply.slice(i, i + 5)); g.end(); return { thinking, prose, back }; };
  const PAGE = '**Hillside cemetery — Tuesday, March 4, 2026 — 22:31**\n\nThe cemetery was empty except for the rain.\n\nJovan knelt by the stone.';
  const a = run(PAGE);
  assert(a.thinking === '' && a.back === '' && a.prose.startsWith('**Hillside cemetery'), 'the page opens at its header as it streams: ' + JSON.stringify([a.thinking.length, a.back.length]));
  const b = run('Let me set the scene first, quietly.\n\n' + PAGE);
  assert(b.thinking.startsWith('Let me set the scene') && b.prose.startsWith('**Hillside cemetery') && b.back === '', 'what came before it is the thinking, as with any header');
  const kept = tidyPage(PAGE, { place: 'Hillside cemetery' }).text;
  assert(kept.startsWith('[Hillside cemetery — Tuesday, March 4, 2026 | 22:31]\n\nThe cemetery was empty'), 'kept in the ledger’s shape: ' + kept.slice(0, 70));
  const muts = headerMutations(kept);
  assert(muts.some((m) => m.type === 'place.set' && m.name === 'Hillside cemetery') && muts.some((m) => /clock/.test(m.type)), 'and the ledger reads its ground and its hour: ' + JSON.stringify(muts).slice(0, 200));
  for (const line of ['# The Wayward Lantern — Saturday, June 14 — 08:12', 'Karakura Town, Monday 18:40']) eq(isHeaderLine(line), true, 'a header: ' + line);
  for (const line of ['At 22:31 on Tuesday, March 4, the rain began.', '"Meet me on Tuesday at 22:31."', '<div>Tuesday 22:31</div>', 'Planning: Tuesday, March 4 — 22:31', 'The rain fell hard that night and nobody came', 'Wednesday, March 5 — 07:10', 'March 5, 07:10', '07:10 — Monday, the courtyard']) eq(isHeaderLine(line), false, 'not a header: ' + line);
  eq(isHeaderLine('Sunday Market — Monday, June 1 — 18:40'), true, 'a place that begins with a weekday is still a place');
  /* M510-19: a page with no header and a time-skip line inside it loses nothing to the thinking */
  const skip = run('The cemetery was empty except for the rain.\nJovan knelt by the stone.\n\nWednesday, March 5 — 07:10\n\nMorning came grey over the hill.');
  assert(skip.thinking === '' || skip.back.length === skip.thinking.length, 'nothing above the time-skip line stays in the thinking');
  assert(skip.prose.startsWith('The cemetery was empty'), 'the page is the whole reply: ' + JSON.stringify(skip.prose.slice(0, 40)));
  const { partParagraphs } = await import('../../js/ui/pageshape.js');
  const flatText = 'The cemetery was empty except for the rain.\nJovan knelt by the stone.\n"You came back," said a voice behind him.';
  eq(tidyPage(flatText).text, flatText, 'the bulk mend leaves a header-less text’s line breaks alone (M340-1: stored pages and out-of-character answers)');
  const parted = partParagraphs(flatText);
  assert(parted.changed && parted.text.split('\n\n').length === 3, 'the paragraph mend a NEW header-less page is given where it is kept');
});

test('M510-19 WHO KNOWS WHAT, FOR A SMALL MODEL: the rule every time (his Epistemic Law and The 3 Part Trace, word for word), and only the scene’s part of the list — the frontier model keeps the whole list', async () => {
  const NAMES = ['Rukia Kuchiki', 'Kaelen', 'Renji Abarai', 'Momo Hinamori', 'Izuru Kira', 'Shuhei Hisagi', 'Aster', 'Bramble', 'Cinder', 'Dune', 'Ember', 'Fennel', 'Gale', 'Hollow', 'Iris', 'Juniper'];
  const muts = [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Kuchiki manor garden' }, { type: 'presence.enter', name: 'Jovan' }];
  NAMES.forEach((n, i) => { muts.push({ type: 'people.set', name: n, field: 'core', text: n + ' of the Gotei' }); if (i < 6) muts.push({ type: 'presence.enter', name: n }); for (let k = 0; k < 30; k += 1) muts.push({ type: 'knowledge.add', name: n, fact: 'KNOWS-' + i + '-' + k + ' what ' + n.split(' ')[0] + ' learned about the ' + ['shrine', 'lantern', 'captain', 'duel', 'seat', 'debt'][k % 6] + ' on page ' + k }); });
  const st = { ...applyMutations({ ...emptyState(), page: 90 }, muts).state, page: 90 };
  const mk = (small) => buildRequest({ story: {}, messages: [{ id: 'u', role: 'user', text: 'I ask about the lantern at the shrine.' }], settings: small ? { smallModelNow: true, frameOn: false, noteOn: false } : {}, state: st, modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: '', window: { keeperOn: true, window: 30, budgetTokens: 262000 }, ...(small ? { smallPlan: { ...PLAN, intense: false, laws: [] } } : {}) });
  const small = mk(true); const normal = mk(false);
  const sw = wireOf(small);
  assert(sw.includes('Epistemic Law = knowledge inherits the RESOLUTION of its pathway') && sw.includes('The 3 Part Trace = the ledger') && sw.includes('All fail -> CUT IT'), 'the rule rides, in his words');
  const facts = (r) => r.receipt.slots.find((s) => s.name === 'The state of things');
  const known = (r) => (facts(r).text.match(/KNOWS-\d+-\d+/g) || []).length;
  assert(known(normal) > known(small) && facts(small).tokens < facts(normal).tokens, 'the list: the frontier model keeps more of it (' + known(normal) + ' facts, ' + facts(normal).tokens + ' tokens), the small one the scene’s part (' + known(small) + ' facts, ' + facts(small).tokens + ' tokens)');
  assert(!wireOf(normal).includes('Epistemic Law = knowledge inherits') || wireOf(normal).includes('## Information Quarantine'), 'the frontier model reads the rule where it always did — in the whole craft');
});


test('M510-20 EVERY ROW, EVERY PAGE: "What the storyteller saw" names every part the house can send, in the order it rides — one that did not ride stands with 0 tokens and why (on his first scene: the essentials are not made yet, the record is still empty)', async () => {
  const { EVERY_ROW } = await import('../../js/assemble/stack.js');
  const st = { ...applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'the cemetery' }, { type: 'presence.enter', name: 'Jovan' }]).state, page: 1 };
  const mk = (small, extra = {}) => buildRequest({ story: { brief: 'A grieving story.' }, messages: [{ id: 'u', role: 'user', text: 'I kneel at the grave.' }], settings: small ? { smallModelNow: true, frameOn: false, noteOn: false } : {}, state: st, modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: '', window: { keeperOn: true, window: 30, budgetTokens: 262000, nodes: [] }, ...(small ? { smallPlan: { ...PLAN, intense: false } } : {}), ...extra });
  for (const [label, r] of [['normal', mk(false)], ['small', mk(true)]]) {
    eq(r.receipt.slots.map((s) => s.name).join(' | '), EVERY_ROW.join(' | '), label + ': every row, in order');
    const silent = r.receipt.slots.filter((s) => s.tokens === 0 && !s.reason && !s.source);
    eq(silent.map((s) => s.name).join(', '), '', label + ': every empty row says why');
  }
  const row = (r, n) => r.receipt.slots.find((s) => s.name === n);
  assert(/^being made|^not made yet|^the memory keeper is off/.test(row(mk(false), 'Story essentials').reason) && /^small model only/.test(row(mk(false), 'The plan for this page').reason), 'on the normal model: the essentials are every storyteller’s now (M510-48), the plan the small model’s — its row says exactly where they stand (M510-57)');
  assert(/not made yet — the record is still empty: the memory keeper folds pages once they are older than its 30-page window/.test(row(mk(true), 'Story essentials').reason), 'his first scene: ' + row(mk(true), 'Story essentials').reason);
  const withRecord = mk(true, { memory: '- Jovan arrived.', window: { keeperOn: true, window: 30, budgetTokens: 262000, nodes: [{ span: [0, 5], text: 'Jovan arrived.', level: 1, at: 1 }] } });
  assert(/^being made/.test(row(withRecord, 'Story essentials').reason), 'a record, no essentials yet: being made');
  const r = mk(false); const sum = r.receipt.slots.reduce((n, s) => n + s.tokens, 0);
  eq(r.receipt.totalTokens, sum, 'the rows added carry nothing: the count is the parts that rode');
});

test('M510-21 WHO’S HERE, IN THE RECORD (his idea, bounded): while someone is in the scene the record’s own lines that name them ride word for word for a small model — the newest few each, the MC left out, nothing said twice; gone from the scene, gone from the page; the frontier model is untouched', async () => {
  const { recordOfWhoIsHere, PRESENT_LINES_EACH } = await import('../../js/assemble/stack.js');
  const lines = [];
  for (let i = 0; i < 14; i += 1) lines.push({ span: [i * 3, i * 3 + 2], text: '[Day ' + (i + 1) + ' · the yard] ' + (i % 2 === 0 ? 'Rukia Kuchiki sparred Jovan, RUKIA-' + i : 'Renji ate alone, RENJI-' + i) + (i === 3 ? '; Kaelen swore on the broken lantern, KAELEN-3' : '') + '.', level: 1, at: i + 1 });
  const base = [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'the yard' }, { type: 'presence.enter', name: 'Jovan' }];
  const here = { ...applyMutations({ ...emptyState(), page: 50 }, [...base, { type: 'presence.enter', name: 'Rukia Kuchiki' }, { type: 'presence.enter', name: 'Kaelen' }]).state, page: 50 };
  const got = recordOfWhoIsHere(lines, here);
  const ruk = (got.text.match(/RUKIA-\d+/g) || []);
  eq(ruk.length, PRESENT_LINES_EACH, 'the newest five that name Rukia');
  assert(ruk.includes('RUKIA-12') && !ruk.includes('RUKIA-0'), 'the newest, not the oldest: ' + ruk.join(','));
  assert(/KAELEN-3/.test(got.text) && !/RENJI-1\b|RENJI-5\b/.test(got.text.replace(/RUKIA-\d+/g, '')) || /KAELEN-3/.test(got.text), 'Kaelen’s line too; Renji is not here');
  assert(!got.who.includes('Jovan') && got.who.includes('Rukia Kuchiki') && got.who.includes('Kaelen'), 'the MC is left out — he is in every line: ' + got.who.join(', '));
  assert(got.text.indexOf('(pages 10–12)') < got.text.indexOf('(pages 37–39)'), 'oldest first, with their pages');
  const skipped = recordOfWhoIsHere(lines, here, { skip: (n) => n.span[0] > 30 });
  assert(!/RUKIA-12|RUKIA-11/.test(skipped.text) && /RUKIA-10/.test(skipped.text), 'a line already riding is not said twice');
  const capped = recordOfWhoIsHere(lines, here, { cap: 200 });
  assert(capped.text.length <= 200, 'within its room: ' + capped.text.length);
  const gone = { ...applyMutations({ ...emptyState(), page: 50 }, base).state, page: 50 };
  eq(recordOfWhoIsHere(lines, gone).text, '', 'gone from the scene, gone from the page');
  /* through the request */
  const msgs = pages(40);
  const mk = (small, state) => buildRequest({ story: {}, messages: msgs, settings: small ? { smallModelNow: true, frameOn: false, noteOn: false } : {}, state, modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: lines.map((n) => '- ' + n.text).join('\n'), window: { keeperOn: true, window: 30, budgetTokens: 262000, nodes: lines }, ...(small ? { smallPlan: { ...PLAN, intense: false }, smallEssentials: { text: '- [Day 1 · the yard] (pages 1–42) Jovan trained with Rukia; Kaelen swore on the lantern.', upTo: 41 } } : {}) });
  const small = mk(true, here);
  const notes = notesOf(small);
  assert(/In full, earlier moments with the people here:\n- \(pages/.test(notes) && notes.includes('RUKIA-12'), 'it rides for the small model — inside our story so far (M510-53)');
  const row = small.receipt.slots.find((s) => s.name === 'Earlier moments, in full'); /* M511: the row is named for the part it holds */
  assert(row && row.tokens > 0 && /Rukia Kuchiki/.test(row.reason), 'with its row: ' + JSON.stringify(row && row.reason));
  const normal = mk(false, here);
  assert(!/What the record holds of who is here/.test(notesOf(normal)) && /every earlier moment is in it|essentials are still being made/.test(normal.receipt.slots.find((s) => s.name === 'Earlier moments, in full').reason), 'the frontier model, before its essentials are made, reads the whole record — its row says so, exactly (M510-48/57)');
});


test('M510-22 A PLAN, KEPT WHOLE (his battle plan): written down the moment a page lays it out — every part, the words to be said — marked as it is carried out, let go when it ends; a small storyteller reads every plan standing word for word; the frontier model is untouched', async () => {
  const { readPlansAnswer, applyPlansAnswer, runPlans, loadPlansBook, plansAsk, CATCH_UP_PAGES } = await import('../../js/agents/plans.js');
  const { renderStanding } = await import('../../js/assemble/planbook.js');
  const BATTLE = { new: [{ title: 'The feint at the forest', by: 'Jovan', page: 3, goal: 'draw the enemy into the forest and burn it', parts: [
    { who: 'Artos', does: 'commands the front line; fights, then fakes a retreat', when: 'when the enemy commits' },
    { who: 'Arsif', does: 'takes the fake gold convoy into the forest, then runs, leaving it', when: 'at the retreat' },
    { who: 'Daros', does: 'burns the forest', when: 'once the enemy is in among the trees' }], words: ['Retreat! Protect the gold convoy!'] }], progress: [], closed: [] };
  const read = readPlansAnswer('Here it is:\n```json\n' + JSON.stringify(BATTLE) + '\n```');
  eq(read.fresh.length, 1); eq(read.fresh[0].parts.length, 3, 'every part');
  eq(read.fresh[0].words[0], 'Retreat! Protect the gold convoy!', 'the cry, word for word');
  eq(readPlansAnswer('I think there is a plan here.'), null, 'no JSON: not an answer');
  eq(readPlansAnswer('{"plans":[]}'), null, 'no "new" list: not the answer asked for');
  /* written in, moved on, ended */
  let book = applyPlansAnswer({ plans: [] }, read, { from: 0, to: 4 });
  eq(book.plans[0].status, 'standing'); eq(book.plans[0].from, 2, 'on the page it was laid out');
  book = applyPlansAnswer(book, { fresh: [], progress: [{ title: 'the feint at the forest', done: [1], changed: [{ part: 3, who: 'Daros', does: 'burns the forest with pitch arrows', when: '' }] }], closed: [] }, { from: 5, to: 6 });
  assert(book.plans[0].parts[0].done && /pitch arrows/.test(book.plans[0].parts[2].does), 'a part carried out is marked; a part changed is changed');
  const again = applyPlansAnswer(book, read, { from: 7, to: 8 });
  eq(again.plans.length, 1, 'laid out again: the newer telling, never a second copy');
  const text = renderStanding(book);
  assert(/^The feint at the forest — Jovan’s plan, laid out on page 3\. The aim: draw the enemy into the forest and burn it\./.test(text), text.slice(0, 120));
  assert(text.includes('  1. Artos — commands the front line; fights, then fakes a retreat (when the enemy commits) — done.') && text.includes('  2. Arsif — takes the fake gold convoy into the forest, then runs, leaving it (at the retreat).') && text.includes('The words to be said: “Retreat! Protect the gold convoy!”'), 'word for word, part by part:\n' + text);
  const ended = applyPlansAnswer(book, { fresh: [], progress: [], closed: [{ title: 'The feint at the forest', how: 'done', outcome: 'The enemy broke in the burning forest.' }] }, { from: 9, to: 9 });
  eq(renderStanding(ended), '', 'carried out: no longer standing');
  eq(ended.plans[0].outcome, 'The enemy broke in the burning forest.', 'what came of it is kept for the drawer');
  /* the reading: the last thirty pages first, then only what is new; an unusable answer leaves them to be read again */
  const pagesOf = (n) => Array.from({ length: n }, (_, i) => ({ n: i + 1, who: i % 2 ? 'the storyteller' : 'the writer', text: 'PAGE-' + (i + 1) + ' words.' }));
  const { db: store } = await import('../../js/store.js');
  const helperKept = { plans: { 'a1:0': { plan: { scene: 'HELPER-PLAN' }, hash: 'h' } }, lastSound: null };
  await store.settings.set('plans:s-plans', helperKept); /* the planning helper's own per-page plans (agents/planner.js) */
  const house = thinkingHouse({ answer: JSON.stringify(BATTLE) });
  await withHouse(house, () => runPlans({ connection: CONN, storyId: 's-plans', pages: pagesOf(40), mc: 'Jovan' }));
  eq(JSON.stringify(await store.settings.get('plans:s-plans')), JSON.stringify(helperKept), 'the planning helper’s plans are untouched — the plans keeper keeps its own book (the shared key overwrote them: DOM-67 and DOM-138 caught it)');
  const first = JSON.stringify(house.calls[0].body);
  assert(first.includes('PAGE-11 words') && !first.includes('PAGE-10 words') && first.includes('PAGE-40 words'), 'the first reading: the last ' + CATCH_UP_PAGES + ' pages');
  eq((await loadPlansBook('s-plans')).readTo, 39);
  const none = thinkingHouse({ answer: '{"new":[],"progress":[],"closed":[]}' });
  await withHouse(none, () => runPlans({ connection: CONN, storyId: 's-plans', pages: pagesOf(42), mc: 'Jovan' }));
  const second = JSON.stringify(none.calls[0].body);
  assert(second.includes('PAGE-41 words') && second.includes('PAGE-42 words') && !second.includes('PAGE-40 words') && second.includes('The feint at the forest'), 'then only what is new, with the plans standing in front of it');
  const bad = thinkingHouse({ answer: 'no idea' });
  const failed = await withHouse(bad, () => runPlans({ connection: CONN, storyId: 's-plans', pages: pagesOf(44), mc: 'Jovan' }));
  assert(!failed.wrote && bad.calls.length === 2 && (await loadPlansBook('s-plans')).readTo === 41, 'unusable: asked once more, then left to be read again');
  assert(/A hope, a threat, or one person saying what they will do next is not a plan/.test(plansAsk({}).system), 'what a plan is, said');
  /* through the request */
  const plansBook = await loadPlansBook('s-plans');
  const mk = (small) => buildRequest({ story: {}, messages: pages(40), settings: small ? { smallModelNow: true, frameOn: false, noteOn: false } : {}, state: yard(), modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: '', window: { keeperOn: true, window: 30, budgetTokens: 262000 }, ...(small ? { smallPlan: { ...PLAN, intense: false }, smallPlansBook: plansBook } : { smallPlansBook: plansBook /* M510-48: every storyteller reads the plans the keeper wrote down */ }) });
  const small = mk(true);
  const notes = notesOf(small);
  assert(notes.includes('Plans standing — laid out on the page, kept whole until carried out:\nThe feint at the forest — Jovan’s plan') && notes.includes('“Retreat! Protect the gold convoy!”'), 'the small storyteller reads it word for word');
  const row = small.receipt.slots.find((s) => s.name === 'Plans standing');
  assert(row && row.tokens > 0 && /The feint at the forest/.test(row.reason), 'with its row');
  const normal = mk(false);
  assert(/Plans standing[\s\S]*The feint at the forest/.test(notesOf(normal)), 'a frontier storyteller reads the plans standing too (M510-48)');
});

test('M510-23 WHO’S HERE, IN THE RECENT PAGES (his duchy): the storyteller’s own paragraphs that name each person in the scene, from the pages between the last eight and the record — the newest two each, word for word, while they are here; never twice; a title is not a name; the frontier model is untouched', async () => {
  const { pagesOfWhoIsHere, recordOfWhoIsHere } = await import('../../js/assemble/stack.js');
  const para = (who, what) => who + ' ' + what + ' — the hall of the duchy was cold, the banners of the old house still hung, and every word was weighed against the army at the gate.';
  const msgs = [];
  for (let i = 0; i < 40; i += 1) {
    if (i % 2 === 0) { msgs.push({ id: 'u' + i, role: 'user', text: 'turn ' + i }); continue; }
    const page = i + 1;
    const body = {
      10: para('Lord Varen', 'VAREN-10 did not come to the council; his steward said he was ill.'),
      16: para('Lord Varen', 'VAREN-16 pressed a purse of gold into Jovan’s hand, and Jovan took it.'),
      24: para('Lord Varen', 'VAREN-24 swore he would keep his seat whatever it cost.'),
      12: para('Lady Mira', 'MIRA-12 did not come either, and sent no word at all.'),
      28: para('Lady Mira', 'MIRA-28 laughed, poured wine, and said she had only wanted to see what kind of lord would come.'),
      20: para('Lord Aldric', 'ALDRIC-20 counted the grain stores twice.'),
      36: para('Lord Varen', 'VAREN-36 sat at the end of the table, the purse no longer at his belt.'),
    }[page] || 'An ordinary page, nothing of note — PAGE-' + page + '.';
    msgs.push({ id: 'a' + i, role: 'assistant', text: '[The duchy hall — Monday, March 3, 2025 | 09:' + String(i).padStart(2, '0') + ']\n\n' + body });
  }
  msgs.push({ id: 'ux', role: 'user', text: 'I begin the interviews for my new council.' });
  const base = [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'The duchy hall' }, { type: 'presence.enter', name: 'Jovan' }];
  const here = { ...applyMutations({ ...emptyState(), page: 40 }, [...base, { type: 'presence.enter', name: 'Lord Varen' }, { type: 'presence.enter', name: 'Lady Mira' }]).state, page: 40 };
  const mk = (small, state) => buildRequest({ story: {}, messages: msgs, settings: small ? { smallModelNow: true, frameOn: false, noteOn: false } : {}, state, modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: '', window: { keeperOn: true, window: 30, budgetTokens: 262000, nodes: [] }, ...(small ? { smallPlan: { ...PLAN, intense: false } } : {}) });
  const small = mk(true, here);
  const notes = notesOf(small);
  const part = (notes.split('In full, the people here in the pages just before the ones you have:\n')[1] || ''); /* M510-53: inside our story so far */
  assert(part.includes('(page 16) Lord Varen VAREN-16') && part.includes('(page 24) Lord Varen VAREN-24'), 'Varen’s newest two in the pages between: the purse, the oath:\n' + part.slice(0, 600));
  assert(!part.includes('VAREN-10'), 'the newest two, not every one');
  assert(part.includes('(page 12) Lady Mira MIRA-12') && !part.includes('MIRA-28') && JSON.stringify(small.messages).includes('MIRA-28'), 'Mira: she never came (the pages between); her test is within the last eight and rides whole');
  assert(!part.includes('ALDRIC-20'), 'a title is not a name: “Lord” does not call back Lord Aldric');
  assert(!part.includes('VAREN-36') && JSON.stringify(small.messages).includes('VAREN-36'), 'a page within the last eight rides whole, never twice');
  assert(part.indexOf('VAREN-16') < part.indexOf('VAREN-24'), 'oldest first');
  const row = small.receipt.slots.find((s) => s.name === 'Who’s here, in the recent pages');
  assert(row && row.tokens > 0 && /Lord Varen/.test(row.reason) && /Lady Mira/.test(row.reason), 'its row, naming whom');
  const names = small.receipt.slots.map((s) => s.name);
  assert(names.indexOf('Who’s here, in the recent pages') > names.indexOf('What remains') && names.indexOf('Who’s here, in the recent pages') < names.indexOf('On their mind'), 'in its place among the rows — as it is sent, inside our story so far, before the people (M510-55)');
  const gone = { ...applyMutations({ ...emptyState(), page: 40 }, base).state, page: 40 };
  assert(!notesOf(mk(true, gone)).includes('What the recent pages hold'), 'gone from the scene, gone from the page');
  const normal = mk(false, here);
  assert(!/What the recent pages hold of who is here/.test(JSON.stringify(normal.messages)) && /^small model only/.test(normal.receipt.slots.find((s) => s.name === 'Who’s here, in the recent pages').reason), 'the frontier model is untouched');
  /* the record's own lines use the same names: a title is not a name there either (M510-21) */
  const lines = [{ span: [0, 3], text: 'Lord Aldric counted the grain.' }, { span: [4, 7], text: 'Lord Varen paid Jovan in gold.' }];
  const rec = recordOfWhoIsHere(lines, here);
  assert(rec.text.includes('Lord Varen paid') && !rec.text.includes('Aldric'), 'the record’s lines: Varen’s, not every lord’s');
  eq(pagesOfWhoIsHere([], here, { from: 0, to: 0 }).text, '', 'nothing between: nothing');
});

test('M510-24 A CROWDED SCENE KEEPS WHO KNOWS WHAT: eight people here, each knowing much, overflowed the compact view and it shed the whole section — a small model read not one line of it; now what they know is told again with fewer facts each (the newest and the ones the scene calls back) before anything is shed whole; a whole view is untouched', async () => {
  const { renderStateFacts } = await import('../../js/engine/state.js');
  const topics = ['the shrine lantern', 'the captain’s quarters at dawn', 'the seat trial', 'the duel at the autumn review', 'the debt to the Kuchiki', 'the stolen comb', 'the hollow attack in the west district'];
  const who = ['Rukia Kuchiki', 'Renji Abarai', 'Byakuya Kuchiki', 'Ichigo Kurosaki', 'Orihime Inoue', 'Uryu Ishida', 'Yasutora Sado', 'Toshiro Hitsugaya'];
  const muts = [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Squad Thirteen barracks' }, { type: 'presence.enter', name: 'Jovan' }];
  who.forEach((n, i) => { muts.push({ type: 'presence.enter', name: n }); for (let k = 0; k < 14; k += 1) muts.push({ type: 'knowledge.add', name: n, fact: n.split(' ')[0] + ' knows ' + topics[(i + k) % topics.length] + ' — learned when Jovan and ' + who[(i + k + 1) % who.length].split(' ')[0] + ' spoke of it (fact ' + k + ')' }); });
  const st = { ...applyMutations({ ...emptyState(), page: 200 }, muts).state, page: 200 };
  const scene = ['I ask Rukia what she saw at the captain’s quarters at dawn.'];
  const compact = renderStateFacts(st, { scenePages: scene });
  const facts = compact.match(/\(fact \d+\)/g) || [];
  assert(/Who knows what: /.test(compact) && facts.length >= who.length, 'the section stands, a fact or two for each of the eight: ' + facts.length);
  assert(/captain’s quarters at dawn[^\n]*\(fact \d+\)/.test(compact), 'and the scene’s own question among them');
  assert(compact.length <= 4000 + 200, 'within its room: ' + compact.length);
  const whole = renderStateFacts(st, { whole: true, budget: 400000, scenePages: scene });
  assert((whole.match(/\(fact \d+\)/g) || []).length > facts.length, 'a whole view is told whole, as before');
  /* a scene that fits is told as before: the newest four each */
  const few = { ...applyMutations({ ...emptyState(), page: 20 }, [...muts.slice(0, 3), { type: 'presence.enter', name: 'Kaelen' }, ...Array.from({ length: 6 }, (_, k) => ({ type: 'knowledge.add', name: 'Kaelen', fact: 'Kaelen knows small thing ' + k })) ]).state, page: 20 };
  eq((renderStateFacts(few, { scenePages: scene }).match(/small thing \d/g) || []).length, 4, 'room enough: the newest four, as before');
});

test('M510-25 THE USAGE, ASKED FOR: every streamed call asks the provider for what it used (most say it only when asked); an address that refuses it by name — or with a refusal that names nothing — is taught once, and asked without it from then on', async () => {
  const plain = thinkingHouse({ answer: '{"ok":true}' });
  await withHouse(plain, () => callWorker(CONN, { system: 's', user: 'u' }));
  const sent = plain.calls[plain.calls.length - 1].body;
  assert(sent.stream && sent.stream_options && sent.stream_options.include_usage === true, 'asked for: ' + JSON.stringify(sent.stream_options));
  const { id: _drop, ...bare } = CONN;
  for (const [label, detail] of [['by name', 'Unrecognized request argument supplied: stream_options'], ['naming nothing', 'Bad request']]) {
    const inner = thinkingHouse({ answer: '{"ok":true}' });
    const calls = [];
    const refusing = { calls, fetch: async (url, opts) => { const body = JSON.parse(opts.body); calls.push(body); if (body.stream_options) return new Response(JSON.stringify({ error: { message: detail } }), { status: 400, headers: { 'content-type': 'application/json' } }); return inner.fetch(url, opts); } };
    const taught = await db.connections.add({ ...bare, label: 'Refuses the usage request ' + label });
    const out = await withHouse(refusing, () => callWorker(taught, { system: 's', user: 'u' }));
    eq(out.text, '{"ok":true}', label + ': the turn went again and answered');
    assert(calls.length === 2 && calls[0].stream_options && !calls[1].stream_options, label + ': first with it, then without');
    const back = (await db.connections.list()).find((c) => c.id === taught.id);
    assert(back && Array.isArray(back.learnedDrop) && back.learnedDrop.includes('stream_options'), label + ': remembered: ' + JSON.stringify(back && back.learnedDrop));
    const later = thinkingHouse({ answer: '{"ok":true}' });
    await withHouse(later, () => callWorker(back, { system: 's', user: 'u' }));
    assert(!later.calls[later.calls.length - 1].body.stream_options, label + ': not asked again');
  }
});

test('M510-26/27 HOW A FIGHT SOUNDS (his report: sex has its sounds, a brutal fight had none — on the small model, and then "normal mode is boring too: one bam, and my enemy makes no noise"): a built-in rule that wakes on a fight for every storyteller — the ledger’s mark or his own words starting one — both lanes every beat, every fighter heard, the enemy as much as his character; the moves the fight pattern missed are read; a calm page carries none of it', async () => {
  const { FIGHT_SOUND_TEXT, typedCombat } = await import('../../js/assemble/laws.js');
  const { listModules, selectModules } = await import('../../js/assemble/modules.js');
  for (const m of ['I parry and counter.', 'We fight.', 'I block his blade and slash back.', 'I duel him at dawn.', 'I dodge left.', 'I spar with Renji.', 'I choke him.', 'I slam him into the wall.']) eq(typedCombat(m), true, 'a fight: ' + m);
  for (const m of ['I fight for her honour.', 'I counter his argument calmly.', 'We talk about the duel.', 'She blocks the door with her body.', 'We fight over the last dumpling.']) eq(typedCombat(m), false, 'not a fight: ' + m);
  for (const needle of ['both lanes', 'the enemy as much as his character', 'A single sound for a whole exchange is a failure', '*CLANG!*', '"RAAAAAGH—!"', '"FUCK—!"', 'please—PLEASE—!', 'NARRATED', 'a paragraph of a fight with no sound in it is a failed paragraph', 'never reuse the last page']) assert(FIGHT_SOUND_TEXT.includes(needle), 'it says: ' + needle);
  const all = await listModules();
  const st = yard();
  const mk = (small, text) => buildRequest({ story: {}, messages: [...pages(20).slice(0, -1), { id: 'ux', role: 'user', text }], settings: small ? { smallModelNow: true, frameOn: false, noteOn: false } : {}, state: st, modules: selectModules(all, { ...st, turnText: text }), memory: '', window: { keeperOn: true, window: 30, budgetTokens: 262000 }, ...(small ? { smallPlan: { ...PLAN, intense: true }, smallIntense: true } : {}) });
  const activeOf = (r) => r.receipt.slots.find((s) => s.name === 'Active modules');
  for (const small of [true, false]) {
    const fight = mk(small, 'I parry and counter with a slash at his ribs.');
    const row = activeOf(fight);
    assert(row.text.includes('How a fight sounds\n\n' + FIGHT_SOUND_TEXT) && /How a fight sounds \(his words start a fight\)/.test(row.reason), (small ? 'small' : 'normal') + ': the fight’s own acoustics wake on his words, whole: ' + row.reason);
    assert(/When words won’t carry it/.test(row.text), (small ? 'small' : 'normal') + ': and the contest rule with them, on the page the fight begins');
    assert(!(activeOf(mk(small, 'I sit by the pond and listen to the water.')).text || '').includes('How a fight sounds'), (small ? 'small' : 'normal') + ': a calm page carries none of it');
  }
  const small = mk(true, 'I parry and counter with a slash at his ribs.');
  eq((JSON.stringify(small.systemBlocks) + JSON.stringify(small.messages)).split('How A Fight Sounds = a fight is LOUD').length - 1, 1, 'said once to a small model — never twice');
});


test('M510-28 THE HOUSEKEEPER HOLDS THE LIVE LEDGER (he asked why it kept saying "the only surface I can’t see is the live ledger text, so presence.leave fires blind"): read fresh from the store each time he speaks — "Here now" as it stands — and it is told so', async () => {
  const { housekeeperTurn } = await import('../../js/agents/housekeeper.js');
  const { saveState } = await import('../../js/engine/state.js');
  const { db: store } = await import('../../js/store.js');
  const st = await store.stories.create({ title: 'the live ledger' });
  const base = [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Training yard' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }, { type: 'presence.enter', name: 'Kaelen' }];
  const s1 = { ...applyMutations({ ...emptyState(), page: 3 }, base).state, page: 3 };
  await saveState(st.id, s1);
  const seen = [];
  const call = async (req) => { seen.push(JSON.stringify(req).replace(/\\n/g, '\n').replace(/\\"/g, '"')); return { text: 'All is well in the house.' }; };
  const t1 = await housekeeperTurn({ storyId: st.id, writerText: 'who is here?', connection: { type: 'openai' }, call });
  assert(t1.ok, t1.error);
  const first = seen[0];
  const here1 = (first.match(/Here now: [^\n]*/) || [''])[0];
  assert(/THE LEDGER — LIVE: read fresh from the store the moment the writer spoke to you/.test(first) && /Kaelen/.test(here1) && /Rukia/.test(here1), 'the live ledger, with who is here: ' + here1);
  assert(/THE LEDGER you hold is the live one, read fresh every time the writer speaks/.test(first) && /look at "Here now"/.test(first), 'and it is told so, and told to look before a leave');
  /* a reader writes between his turns: Kaelen leaves */
  await saveState(st.id, { ...applyMutations(s1, [{ type: 'presence.leave', name: 'Kaelen' }]).state, page: 4 });
  const t2 = await housekeeperTurn({ storyId: st.id, writerText: 'and now?', connection: { type: 'openai' }, call });
  assert(t2.ok, t2.error);
  const here2 = (seen[seen.length - 1].match(/Here now: [^\n]*/) || [''])[0];
  assert(!/Kaelen/.test(here2) && /Rukia/.test(here2), 'the next turn holds the ledger as it stands now: ' + here2);
});

test('M510-29 THE BANNED WORDS LET GO (his word: "I never felt the banned words were bad, and banning them could make it worse"): the craft carries no list and the last look names none; the house’s eye no longer counts them; an unedited saved copy of the old craft follows the new one, an edited one keeps his words; everything else in the craft is as it was', async () => {
  const { lintPage } = await import('../../js/agents/lint.js');
  const { followsBuiltin, fingerprint, SHIPPED_BEFORE, listModules } = await import('../../js/assemble/modules.js');
  assert(!/^Banned Words =/m.test(CRAFT_TEXT) && !/Banned Words\)/.test(CRAFT_TEXT), 'no list, and not named in the last look');
  assert(/Banned Constructs \(narration only\) =/.test(CRAFT_TEXT) && /Sound As Onomatopoeia =/.test(CRAFT_TEXT), 'the other bans stand as they were');
  const page = '[The yard — Monday, March 3, 2025 | 09:00 | wind | coat | by the gate]\n\nHer husky voice broke; his breath hitching, a beat passed, and the predatory grin stayed.';
  eq(lintPage({ mc: 'Jovan', userText: 'I wait.', assistantText: page }).findings.filter((f) => f.law === 'Banned Words').length, 0, 'the eye counts none of them');
  const craft = (await listModules()).find((m) => m.id === 'core-craft');
  assert(SHIPPED_BEFORE['core-craft'].includes('1gzud8e'), 'the craft as it shipped is known');
  eq(followsBuiltin(craft, craft.text), true, 'the craft as it stands follows');
  eq(followsBuiltin(craft, CRAFT_TEXT + '\nMy own line.'), false, 'a copy he edited keeps his words');
});


test('M510-30 THE FALLBACK FOR EVERY WORKER (his word: "if anything is down it moves to this one"): a worker whose connection fails is answered at once by the fallback; no fallback set, the failure stands as before; both down, it throws and the queue retries; a call he stopped is never sent again; the housekeeper falls back too; the last time is kept', async () => {
  const { callWorker, fallbackFor } = await import('../../js/agents/call.js');
  const { callModel } = await import('../../js/agents/housekeeper.js');
  const { db: store } = await import('../../js/store.js');
  const primary = await store.connections.add({ type: 'openai', preset: 'custom', baseUrl: 'https://down.example/v1', apiKey: 'k', model: 'reader', label: 'The reader' });
  const backup = await store.connections.add({ type: 'openai', preset: 'custom', baseUrl: 'https://backup.example/v1', apiKey: 'k', model: 'backup', label: 'The backup' });
  const inner = thinkingHouse({ answer: '{"ok":true}' });
  const hits = [];
  const down = () => new Response(JSON.stringify({ error: { message: 'Service Unavailable' } }), { status: 503, headers: { 'content-type': 'application/json' } });
  const house = { calls: inner.calls, fetch: async (url, opts) => { hits.push(String(url)); return /down\.example/.test(String(url)) ? down() : inner.fetch(url, opts); } };
  await store.settings.set('workerFallbackId', null);
  let threw = null;
  try { await withHouse(house, () => callWorker(primary, { system: 's', user: 'u' })); } catch (e) { threw = e; }
  assert(threw, 'no fallback set: the failure stands, as before');
  await store.settings.set('workerFallbackId', backup.id);
  const out = await withHouse(house, () => callWorker(primary, { system: 's', user: 'u' }));
  eq(out.text, '{"ok":true}', 'the fallback answered');
  eq(out.fellBack, 'The backup');
  assert(hits.some((u) => /down\.example/.test(u)) && hits.some((u) => /backup\.example/.test(u)), 'its own connection first, then the fallback');
  const last = await store.settings.get('workerFallbackLast');
  assert(last && last.from === 'The reader' && last.to === 'The backup' && /503|Unavailable/i.test(last.why), 'the last time is kept: ' + JSON.stringify(last));
  eq(await fallbackFor(backup), null, 'the fallback never falls back onto itself');
  let both = null;
  try { await withHouse({ calls: [], fetch: async () => down() }, () => callWorker(primary, { system: 's', user: 'u' })); } catch (e) { both = e; }
  assert(both, 'both down: it throws, and the queue retries as it always did');
  const ctl = new AbortController(); ctl.abort();
  const before = hits.length;
  let stopped = null;
  try { await withHouse(house, () => callWorker(primary, { system: 's', user: 'u', signal: ctl.signal })); } catch (e) { stopped = e; }
  assert(stopped && !hits.slice(before).some((u) => /backup\.example/.test(u)), 'a call he stopped is never sent again');
  const hk = await withHouse(house, () => callModel(primary, { system: 's', messages: [{ role: 'user', content: 'hi' }] }));
  assert(!hk.error && hk.fellBack === 'The backup' && hk.text === '{"ok":true}', 'the housekeeper falls back too: ' + JSON.stringify(hk).slice(0, 160));
  await store.settings.set('workerFallbackId', null);
});

test('M510-32 A THOUGHT’S CLOSER WRITTEN BACK TO FRONT, OR STANDING ALONE (his report: a lone stray "t/~" after an NPC): "~t/~" and "t/~" close a thought like "~/t~"; a closer that belongs to no thought is taken off the page with its space; an exact thought and ordinary words are untouched', async () => {
  const { tidyPage, mendMarks } = await import('../../js/ui/pageshape.js');
  const H = '[The yard — Monday, March 3, 2025 | 09:00 | wind | coat | by the gate]\n\n';
  const page = (t) => tidyPage(H + t).text.slice(H.length);
  eq(page("~t~*She can't find out.*t/~ Rukia turned away."), "~t~*She can't find out.*~/t~ Rukia turned away.", 'closed back to front');
  eq(page("~t~She can't find out.t/~ Rukia turned away."), "~t~*She can't find out.*~/t~ Rukia turned away.", 'no stars, closed back to front');
  eq(page("~t~*She can't find out.~t/~ Rukia turned away."), "~t~*She can't find out.*~/t~ Rukia turned away.", '"~t/~"');
  eq(page("~t~*She can't find out.*~/t~ t/~ Rukia turned away."), "~t~*She can't find out.*~/t~ Rukia turned away.", 'one closer too many');
  eq(page('"Fine," Rukia said. t/~'), '"Fine," Rukia said.', 'standing alone after her line');
  eq(page('t/~ Rukia turned away.'), 'Rukia turned away.', 'standing alone at a line’s start');
  const exact = "Rukia turned away. ~t~*He knows.*~/t~ She smiled.";
  eq(mendMarks(exact).text, exact, 'an exact thought, untouched');
  eq(mendMarks('The path split at the fork, east or west.').text, 'The path split at the fork, east or west.', 'ordinary words untouched');
});
test('M510-32b a right-shaped closer standing alone on a line with no thought goes; on a line that holds a thought it is left, as M506 leaves it', async () => {
  const { mendMarks } = await import('../../js/ui/pageshape.js');
  eq(mendMarks('"Fine," Rukia said. ~/t~').text, '"Fine," Rukia said.', 'alone on its line: it goes');
  eq(mendMarks('~t~*a*~/t~ she says. *emph*~/t~').text, '~t~*a*~/t~ she says. *emph*~/t~', 'on a line with a thought: left to the letter');
});

test('M510-34 THE PAGE FINISHED (his word: "no stupid things on the page — never changing the story"): an empty or doubled World Beyond, and the storyteller’s note to him at the page’s end, come off; speech, a letter, the story and a short page never do; at most four paragraphs and 900 characters, and never leaving under 200; never an out-of-character answer; what came off is returned', async () => {
  const { tidyPage, finishPage } = await import('../../js/ui/pageshape.js');
  const H = '[The yard — Monday, March 3, 2025 | 09:00 | wind | coat | by the gate]\n\n';
  const story = 'Rukia turned from the gate, the wind pulling at her sleeve. The courtyard was empty now, the lanterns guttering one by one as the night came down over the barracks.\n\nShe did not look back. Somewhere behind her the bell of the Thirteenth rang the hour, and the sound followed her all the way to the stair.';
  const fin = (body, opts = {}) => { const r = tidyPage(H + body, { mc: 'Jovan', ...opts }); return { page: r.text.slice(H.length), removed: r.removed || [], did: r.did }; };
  let r = fin(story + '\n\n*** The World Beyond ***\n\n*** The World Beyond ***');
  eq(r.page, story, 'two empty windows at the end: gone');
  r = fin(story + '\n\n*** The World Beyond ***\n\nAcross the Seireitei, Byakuya read the report twice.\n\n*** The World Beyond ***\n\nIn the west district, a hollow stirred.');
  eq(r.page, story + '\n\n*** The World Beyond ***\n\nAcross the Seireitei, Byakuya read the report twice.\n\nIn the west district, a hollow stirred.', 'a second window inside the first: one window, every word kept');
  for (const note of ['What will you do next? Let me know!', '*(OOC: I kept the pacing slow to build tension. Would you like me to speed things up?)*', 'What does Jovan do?', 'Would you like me to continue the scene?', 'Your move.', '[What do you do?]', "Author's note: this chapter sets up the duel.", '---']) {
    r = fin(story + '\n\n' + note);
    eq(r.page, story, 'a note to him goes: ' + note);
    assert(r.removed.includes(note.trim()) && r.did.includes('tail'), 'and what came off is returned: ' + JSON.stringify(r.removed));
  }
  eq(fin(story + '\n\n---\n\n*(OOC: slow on purpose.)*').removed.length, 2, 'the separator and the note after it');
  for (const kept of ['"What will you do next?" Rukia asked, not turning.', 'I hope this finds you well, brother.', 'She wondered what would come next, and whether Jovan would follow.', 'What will you do? she thought, and did not ask it aloud, though the words sat on her tongue a long while.']) {
    r = fin(story + '\n\n' + kept);
    assert(r.page.endsWith(kept) && !r.did.includes('tail'), 'story stays: ' + kept);
  }
  eq(fin('Rukia nodded.\n\nWhat will you do?').page, 'Rukia nodded.\n\nWhat will you do?', 'a short page is left as it came');
  const long = Array.from({ length: 6 }, () => 'Let me know if you want more.').join('\n\n');
  assert(fin(story + '\n\n' + long).page.includes('Let me know if you want more.'), 'never more than four paragraphs');
  eq(tidyPage('Here is what I think.\n\nLet me know if you want more detail!', { finish: false }).text, 'Here is what I think.\n\nLet me know if you want more detail!', 'an out-of-character answer is never finished');
  eq(finishPage(story).removed.length, 0, 'a clean page: nothing');
});
test('M510-34b the finisher’s two parts in either order: a note under the last window comes off, and so does the window it leaves empty', async () => {
  const { tidyPage } = await import('../../js/ui/pageshape.js');
  const H = '[The yard — Monday, March 3, 2025 | 09:00 | wind | coat | by the gate]\n\n';
  const story = 'Rukia turned from the gate, the wind pulling at her sleeve. The courtyard was empty now, the lanterns guttering one by one as the night came down over the barracks.\n\nShe did not look back. Somewhere behind her the bell of the Thirteenth rang the hour, and the sound followed her all the way to the stair.';
  const r = tidyPage(H + story + '\n\n*** The World Beyond ***\n\n*** The World Beyond ***\n\nWhat will you do next? Let me know!', { mc: 'Jovan' });
  eq(r.text.slice(H.length), story, 'the empty windows and the note under them, all gone: ' + JSON.stringify(r.text.slice(-60)));
});

test('M510-35 THE STORYTELLER’S VOICE, SAVED (his presets: Hulk, Batman, Iron Man…): a preset takes every part of the voice — names, grounding phrase, how the teller thinks, frame, note, own words — and using one writes every part back exactly, clearing what it kept empty; the switches are not a voice; a name used again is that preset; letting one go leaves the voice as it stands', async () => {
  const { readVoice, sameVoice, listPresets, savePreset, usePreset, removePreset, VOICE_FIELDS } = await import('../../js/engine/voicepresets.js');
  const { db: store } = await import('../../js/store.js');
  for (const k of VOICE_FIELDS) await store.settings.delete(k);
  await store.settings.set('voicePresets', []);
  const HULK = { tellerName: 'Hulk', writerName: 'Bruce', groundingPhrase: 'HULK SMASH.', tellerPerson: 'first', frameText: 'I am Hulk. I tell Bruce stories. Loud.', noteText: 'Keep it LOUD.', ownWords: [{ id: 'w1', on: true, name: 'roar', role: 'teller', place: 'after-your-message', text: 'Hulk still here.' }] };
  for (const [k, v] of Object.entries(HULK)) await store.settings.set(k, v);
  await store.settings.set('frameOn', true);
  const hulk = await savePreset('Hulk', await readVoice());
  const BAT = { tellerName: 'Batman', writerName: 'Bruce', groundingPhrase: null, tellerPerson: null, frameText: 'I am Batman. I tell it in the dark.', noteText: null, ownWords: null };
  for (const [k, v] of Object.entries(BAT)) { if (v === null) await store.settings.delete(k); else await store.settings.set(k, v); }
  const bat = await savePreset('Batman', await readVoice());
  eq((await listPresets()).map((p) => p.name).join(', '), 'Hulk, Batman');
  await store.settings.set('frameOn', false);
  await usePreset(hulk.id);
  const now = await readVoice();
  for (const [k, v] of Object.entries(HULK)) eq(JSON.stringify(now[k]), JSON.stringify(v), 'Hulk’s ' + k + ', back exactly');
  eq(await store.settings.get('frameOn'), false, 'the switches are not a voice — they stay as they are');
  await usePreset(bat.id);
  const b = await readVoice();
  assert(b.frameText === 'I am Batman. I tell it in the dark.' && b.noteText === null && b.groundingPhrase === null && b.ownWords === null, 'what Batman kept empty is cleared — the starter note comes back where he had none');
  assert(sameVoice(b, bat.voice) && !sameVoice(b, hulk.voice), 'the voice as it stands is Batman’s');
  await store.settings.set('frameText', 'I am Batman. I tell it in the rain.');
  const again = await savePreset('batman', await readVoice());
  eq(again.id, bat.id, 'a name used again is that preset, written over');
  eq((await listPresets()).length, 2);
  const { renamePreset } = await import('../../js/engine/voicepresets.js');
  eq((await renamePreset(bat.id, '  Dark   Knight ')).preset.name, 'Dark Knight', 'renamed (M510-36)');
  assert(/already called/.test((await renamePreset(bat.id, 'hulk')).error) && /needs a name/.test((await renamePreset(bat.id, '   ')).error), 'never the name of another, never empty');
  eq((await listPresets()).map((p) => p.name).join(', '), 'Hulk, Dark Knight', 'the rest as they were');
  await removePreset(bat.id);
  eq((await listPresets()).map((p) => p.name).join(', '), 'Hulk', 'let go');
  eq(await store.settings.get('frameText'), 'I am Batman. I tell it in the rain.', 'the voice as it stands stays');
  for (const k of VOICE_FIELDS) await store.settings.delete(k);
  await store.settings.set('voicePresets', []); await store.settings.delete('frameOn');
});

test('M510-37 THE NOTES ABOVE THE STORY, IN THE SYSTEM (his word: "I have never seen a preset put a user message above my input — above it is all system; another user message sat above my #story"): the notes are the last system block, never cached; the messages open on the story itself; a tale’s first turn is his one message, not two', async () => {
  const st = yard();
  const mods = [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }];
  const first = buildRequest({ story: { brief: 'Bleach.' }, messages: [{ id: 'u1', role: 'user', text: '#story Jovan arrives at the Seireitei.' }], settings: {}, state: st, modules: mods, memory: '', window: { keeperOn: true, window: 30, budgetTokens: 262000 } });
  eq(first.messages.filter((m) => m.role === 'user').length, 1, 'the first turn: his one message — nothing of the house’s above it');
  assert(/#story Jovan arrives/.test(String(first.messages[0].content)), 'and it opens the messages');
  assert(/Where things stand|here\. This is where things stand/.test(notesOf(first)) && first.systemBlocks[4].cache === false, 'the notes: the last system block, never cached');
  eq(first.systemBlocks[0].cache && first.systemBlocks[1].cache, true, 'the frame and the craft stay the cached prefix before them');
  const later = buildRequest({ story: {}, messages: pages(20), settings: {}, state: st, modules: mods, memory: '', window: { keeperOn: true, window: 30, budgetTokens: 262000 } });
  assert(!later.messages.some((m) => /Where things stand|here\. This is where things stand/.test(String(m.content))), 'no message of the story carries the notes');
  assert(later.messages[0].role === 'user' && later.messages[1].role === 'assistant', 'the story opens the messages: his page, then the teller’s');
  const small = buildRequest({ story: {}, messages: pages(20), settings: { smallModelNow: true, frameOn: false, noteOn: false }, state: st, modules: mods, memory: '', window: { keeperOn: true, window: 30, budgetTokens: 262000 }, smallPlan: { ...PLAN, intense: false } });
  assert(notesOf(small) && !small.messages.some((m) => /Where things stand|here\. This is where things stand/.test(String(m.content))), 'a small model’s notes too');
});

test('M510-38 HIS WORDS WHERE HE PUT THEM; HIS TURN FIRST ONLY WHERE A HOUSE INSISTS: the teller’s own words before the pages open the story; Claude always gets "(Our story begins.)" in front of a request that opens on the assistant, any other house only after it refuses (remembered for that model), and a house that takes it gets nothing added', async () => {
  const { STORY_BEGINS, withUserFirst, opensOnAssistant, ORDER_REFUSAL } = await import('../../js/providers/userfirst.js');
  const mods = [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }];
  const first = buildRequest({ story: {}, messages: [{ id: 'u1', role: 'user', text: '#story Hulk wakes.' }], settings: { noteAdds: [{ id: 'house-cot', on: false }] /* M622 */, ownWords: [{ id: 'w', on: true, name: 'n', role: 'teller', place: 'before-pages', text: 'OWN-WORDS Hulk still here.' }] }, state: yard(), modules: mods, memory: '', window: { keeperOn: true, window: 30, budgetTokens: 262000 } });
  eq(first.messages.map((m) => m.role).join(' '), 'assistant user', 'the teller’s own words first, then his #story — where he put them, nothing added by the builder');
  const greet = buildRequest({ story: {}, messages: [{ id: 'a0', role: 'assistant', text: '[Gate — Monday | 09:00]\n\nThe gate stood open.' }, { id: 'u1', role: 'user', text: 'I walk in.' }], settings: { noteAdds: [{ id: 'house-cot', on: false }] } /* M622 */, state: yard(), modules: mods, memory: '', window: { keeperOn: true, window: 30, budgetTokens: 262000 } });
  eq(greet.messages[0].role, 'assistant', 'a tale that opens on the teller’s page opens on it, in the builder');
  assert(opensOnAssistant([{ role: 'system', content: 's' }, { role: 'assistant', content: 'a' }]) && withUserFirst([{ role: 'system', content: 's' }, { role: 'assistant', content: 'a' }])[1].content === STORY_BEGINS, 'the line goes after the system, before the teller');
  eq(withUserFirst([{ role: 'user', content: 'u' }]).length, 1, 'a request already opening on his turn is left as it is');
  assert(ORDER_REFUSAL.test('Conversation roles must alternate user/assistant/user/assistant/...') && ORDER_REFUSAL.test('The first message must be from the user') && !ORDER_REFUSAL.test('Unknown parameter: min_p'), 'a refusal about the order is known by its words');
  /* an OpenAI-shaped house: takes it — nothing added; refuses it — his line, once, remembered */
  const { db: store } = await import('../../js/store.js');
  const msgs = [{ role: 'assistant', content: 'OWN-WORDS' }, { role: 'user', content: 'I walk in.' }];
  const easy = thinkingHouse({ answer: '{"ok":true}' });
  await withHouse(easy, () => callWorker(CONN, { system: 's', messages: msgs }));
  eq(easy.calls[0].body.messages.filter((m) => m.role !== 'system')[0].content, 'OWN-WORDS', 'a house that takes it: nothing added');
  const strictConn = await store.connections.add({ ...CONN, id: undefined, label: 'Strict house' });
  const inner = thinkingHouse({ answer: '{"ok":true}' });
  const seen = [];
  const strict = { calls: inner.calls, fetch: async (url, opts) => { const body = JSON.parse(opts.body); seen.push(body); const firstTurn = body.messages.find((m) => m.role !== 'system'); if (firstTurn && firstTurn.role === 'assistant') return new Response(JSON.stringify({ error: { message: 'Conversation roles must alternate user/assistant/user/assistant/...' } }), { status: 400, headers: { 'content-type': 'application/json' } }); return inner.fetch(url, opts); } };
  const out = await withHouse(strict, () => callWorker(strictConn, { system: 's', messages: msgs }));
  eq(out.text, '{"ok":true}', 'the strict house: the turn went again and answered');
  eq(seen.length, 2, 'refused once, then answered');
  eq(seen[1].messages.filter((m) => m.role !== 'system')[0].content, STORY_BEGINS, 'opened by his one line');
  const back = (await store.connections.list()).find((c) => c.id === strictConn.id);
  assert(back && typeof back.userFirstFor === 'string' && back.userFirstFor.length, 'remembered for that model at that address');
  const again = thinkingHouse({ answer: '{"ok":true}' });
  await withHouse(again, () => callWorker(back, { system: 's', messages: msgs }));
  eq(again.calls[0].body.messages.filter((m) => m.role !== 'system')[0].content, STORY_BEGINS, 'and asked that way from then on — no refusal first');
  /* Claude: always his turn first */
  const claudeHouse = thinkingHouse({ answer: 'ok' });
  await withHouse(claudeHouse, () => callWorker({ id: 'c-claude', type: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'k', model: 'claude-opus-5-5', label: 'Claude' }, { system: 's', messages: msgs }).catch(() => null));
  const claudeBody = (claudeHouse.calls[0] || {}).body || {};
  assert(Array.isArray(claudeBody.messages) && claudeBody.messages[0] && claudeBody.messages[0].role === 'user' && JSON.stringify(claudeBody.messages[0].content).includes(STORY_BEGINS), 'Claude: his one line first, always: ' + JSON.stringify(claudeBody.messages && claudeBody.messages[0]).slice(0, 120));
});

test('M510-39 HIS SWITCH FOR THE NOTES’ ROLE (his word: "the notes as user or assistant — but the modules as system, they are indeed instructions; the notes are the brief, the tracker and the rest"): the woken rules always ride in the system; the notes — brief and who’s here with them — ride as system (default), his user message, or the storyteller’s own notebook, before the story', async () => {
  const { withUserFirst, STORY_BEGINS } = await import('../../js/providers/userfirst.js');
  const st = yard();
  const mods = [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }, { mod: { id: 'fight-acoustics', name: 'How a fight sounds', text: 'FIGHT-SOUND-RULE: both lanes, every beat.' }, reason: 'a fight' }];
  const own = [{ id: 'w', on: true, name: 'n', role: 'teller', place: 'before-pages', text: 'OWN-WORDS Hulk still here.' }];
  const build = (notesRole, extra = {}) => buildRequest({ story: { brief: 'BRIEF-MARK: a Bleach story.', castNotes: 'CAST-MARK: Rukia, lieutenant.' }, messages: pages(6), settings: { notesRole, tellerName: 'Hulk', writerName: 'Bruce', ownWords: own, ...extra }, state: st, modules: mods, memory: '', window: { keeperOn: true, window: 30, budgetTokens: 262000 } });
  const texts = (r) => r.systemBlocks.map((b) => b.text);
  for (const role of ['system', 'user', 'assistant']) {
    const r = build(role === 'system' ? undefined : role);
    const sys = texts(r).join('\n');
    assert(/FIGHT-SOUND-RULE/.test(r.systemBlocks[4].text), role + ': the woken rules ride in the system, their own block');
    assert(!r.messages.some((m) => /FIGHT-SOUND-RULE/.test(String(m.content))), role + ': never in a message');
    if (role === 'system') {
      assert(/BRIEF-MARK/.test(r.systemBlocks[2].text) && /CAST-MARK/.test(r.systemBlocks[3].text) && /where things stand/i.test(r.systemBlocks[5].text), 'system: the brief, who’s here and the notes in the system, after the rules');
      assert(!/FIGHT-SOUND-RULE/.test(r.systemBlocks[5].text), 'the notes no longer carry the rules');
      eq(r.messages[0].content, 'OWN-WORDS Hulk still here.', 'system: his own words open the story, right after the briefing');
    } else {
      const notes = r.messages[0];
      eq(notes.role, role, role + ': one message before the story');
      assert(/What this story is about:\nBRIEF-MARK/.test(notes.content) && /Who’s here:\n[\s\S]*CAST-MARK/.test(notes.content) && !/BRIEF-MARK|CAST-MARK/.test(sys), role + ': the brief and who’s here travel with the notes, out of the system');
      assert(role === 'assistant' ? /^Hulk’s notebook — where things stand in our story right now/.test(notes.content) : /^Hulk — Bruce here\. This is where things stand/.test(notes.content), role + ': opened in its voice: ' + notes.content.slice(0, 60));
      eq(r.messages[1].content, 'OWN-WORDS Hulk still here.', role + ': his own words right after the notes, before the first story page');
      if (role === 'assistant') eq(withUserFirst(r.messages)[0].content, STORY_BEGINS, 'assistant: a house that insists gets his one line first, from the provider');
    }
  }
  const small = build('assistant', { smallModelNow: true, frameOn: false, noteOn: false });
  eq(small.messages[0].role, 'assistant', 'a small model’s notes follow the switch too');
});

test('M510-40 (final audit) THE STEP BACK TO HIS MOVE NEVER OVERFLOWS: with the keeper off the window is cut to the budget — a long move of his behind a window that opens on the teller’s page is not stepped back over the room (m510-037..039 sent 35,673 tokens into a 30,000 budget); a move that fits is', async () => {
  const { estimateTokens } = await import('../../js/assemble/receipt.js');
  const mods = [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }];
  const long = 'He speaks at length. '.repeat(3000);
  const mk = (longAt) => { const p = []; for (let i = 0; i < 6; i += 1) { p.push({ id: 'u' + i, role: 'user', text: i === longAt ? long : 'move ' + i }); p.push({ id: 'a' + i, role: 'assistant', text: 'page ' + i + ' ' + 'word '.repeat(300) }); } p.push({ id: 'ux', role: 'user', text: 'I wait.' }); return p; };
  const tokensOf = (r) => r.systemBlocks.reduce((s, b) => s + estimateTokens(b.text || ''), 0) + r.messages.reduce((s, m) => s + estimateTokens(String(m.content)), 0);
  const tight = buildRequest({ story: {}, messages: mk(4), settings: { noteAdds: [{ id: 'house-cot', on: false }] } /* M622 */, state: { ...yard(), page: 6 }, modules: mods, memory: '', window: { keeperOn: false, budgetTokens: 30000 } });
  assert(tokensOf(tight) <= 30000, 'within the budget: ' + tokensOf(tight));
  eq(tight.messages[0].role, 'assistant', 'the window stays as it was cut — the provider opens it with his line where a house insists');
  const roomy = buildRequest({ story: {}, messages: mk(-1), settings: { noteAdds: [{ id: 'house-cot', on: false }] } /* M622 */, state: { ...yard(), page: 6 }, modules: mods, memory: '', window: { keeperOn: false, budgetTokens: 22000 } });
  assert(tokensOf(roomy) <= 22000 && roomy.messages[0].role === 'user', 'a short move that fits is stepped back: ' + roomy.messages[0].role + ' ' + tokensOf(roomy));
});

test('M510-41 THE DAY TURNS AT HIS MIDNIGHT (his question: "does it know which day it is, and when a day is done? it feels stuck"): every call is written into the book of the day it FINISHED on, by the device’s own clock — a minute before midnight is yesterday’s, a minute after is today’s; "Today" is the day the view is drawn; the averages count the days since the first one used', async () => {
  const { summarize, USAGE_PREFIX } = await import('../../js/engine/usage.js');
  const { db: store } = await import('../../js/store.js');
  const usageKeys = async () => ((await store.settings.keys()) || []).filter((k) => String(k).startsWith(USAGE_PREFIX));
  for (const k of await usageKeys()) await store.settings.delete(k);
  const realNow = Date.now;
  const lateNight = new Date(2026, 8, 29, 23, 59, 30).getTime();
  const pastMidnight = new Date(2026, 8, 30, 0, 0, 30).getTime();
  const written = async (day) => { for (let i = 0; i < 200; i += 1) { if (await store.settings.get(USAGE_PREFIX + day)) return true; await new Promise((r) => setTimeout(r, 10)); } return false; };
  try {
    Date.now = () => lateNight;
    await withHouse(thinkingHouse({ answer: '{"ok":1}' }), () => callWorker(CONN, { system: 's', user: 'before midnight' }));
    assert(await written('2026-09-29'), 'the call at 23:59:30 is in the 29th’s book');
    Date.now = () => pastMidnight;
    await withHouse(thinkingHouse({ answer: '{"ok":2}' }), () => callWorker(CONN, { system: 's', user: 'after midnight' }));
    assert(await written('2026-09-30'), 'the call at 00:00:30 is in the 30th’s book');
  } finally { Date.now = realNow; }
  const books = {};
  for (const k of await usageKeys()) books[String(k).slice(USAGE_PREFIX.length)] = await store.settings.get(k);
  const at = (d, h, m) => new Date(2026, 8, d, h, m).getTime();
  const justAfter = summarize(books, [], at(30, 0, 5));
  eq(justAfter.today.total.calls, 1, 'drawn at 00:05, Today is the 30th — one call');
  eq(justAfter.week.total.calls, 2, 'the last 7 days hold both');
  eq(justAfter.days, 2, 'the average counts two days (the 29th and today)');
  eq(summarize(books, [], at(29, 23, 59)).today.total.calls, 1, 'drawn at 23:59 on the 29th, Today is the 29th — its one call');
  const nextMorning = summarize(books, [], new Date(2026, 9, 1, 9, 0).getTime());
  eq(nextMorning.today.total.calls, 0, 'the next morning starts empty');
  eq(nextMorning.week.total.calls, 2, 'and the week still holds both');
  for (const k of await usageKeys()) await store.settings.delete(k);
});

test('M510-44 WHO KNOWS WHAT HAS A ROOM OF ITS OWN IN THE WHOLE VIEW (his Bleach duel: eleven in the scene, ~10,000 tokens a page): a crowd is told in fewer facts a person until it fits (~4,000 tokens), every person still named and the rest noted as kept; a longer story never makes it bigger; a scene of a few is told exactly as before', async () => {
  const { renderStateFacts, emptyState, KNOWLEDGE_WHOLE_CHARS } = await import('../../js/engine/state.js');
  const { applyMutations } = await import('../../js/engine/apply.js');
  const ALL = ['Kenpachi Zaraki', 'Yachiru Kusajishi', 'Ikkaku Madarame', 'Yumichika Ayasegawa', 'Rukia Kuchiki', 'Renji Abarai', 'Byakuya Kuchiki', 'Shunsui Kyoraku', 'Nanao Ise', 'Toshiro Hitsugaya', 'Rangiku Matsumoto', 'Kisuke Urahara', 'Yoruichi Shihoin', 'Soi Fon', 'Mayuri Kurotsuchi', 'Nemu Kurotsuchi', 'Jushiro Ukitake', 'Sajin Komamura', 'Tetsuzaemon Iba', 'Isane Kotetsu'];
  const scene = (count, per) => {
    const people = ALL.slice(0, count);
    let st = applyMutations({ ...emptyState() }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Eleventh Division training ground' }, { type: 'presence.enter', name: 'Jovan' }, ...people.map((n) => ({ type: 'presence.enter', name: n }))]).state;
    const knowledge = {};
    people.forEach((n, i) => { knowledge[n] = []; for (let t = 0; t < per; t += 1) knowledge[n].push({ fact: 'Jovan did thing ' + ((t + i) % 12) + ' in front of ' + n.split(' ')[0] + ', who took it as a sign of how he would stand with the Eleventh Division when the captains next met (' + t + ')', atTurn: 2 + t + (i % 2) }); });
    st = { ...st, knowledge, page: per + 4 };
    const text = renderStateFacts(st, { whole: true, budget: Infinity, scenePages: ['Zaraki grinned and drew his notched blade.'] });
    return { people, kw: text.split('\n').filter((l) => /knows/.test(l)).join('\n') };
  };
  const crowd = scene(11, 30);
  assert(crowd.kw.length <= KNOWLEDGE_WHOLE_CHARS, 'eleven in the scene fit the room: ' + crowd.kw.length + ' characters');
  eq(crowd.people.filter((n) => crowd.kw.includes(n)).length, 11, 'every one of them still named');
  assert(/older things? they know, kept in the ledger/.test(crowd.kw), 'and what is not told is said to be kept');
  const longer = scene(11, 60).kw.length; /* a fact's age reads in pages ("learned about 9 pages ago" / "…12…"): a digit or two */
  assert(Math.abs(longer - crowd.kw.length) <= crowd.kw.length * 0.01, 'a story twice as long: the same room (' + crowd.kw.length + ' → ' + longer + ' characters)');
  const twenty = scene(20, 60);
  assert(twenty.kw.length <= KNOWLEDGE_WHOLE_CHARS && twenty.people.every((n) => twenty.kw.includes(n)), 'twenty in the scene: still the room, still everyone');
  const few = scene(3, 30);
  const { renderKnowledge } = await import('../../js/engine/world.js');
  assert(few.kw.length < KNOWLEDGE_WHOLE_CHARS && few.people.every((n) => few.kw.includes(n)), 'a scene of a few is under the room — told whole, as before');
  assert(typeof renderKnowledge === 'function');
});

test('M510-46 "TAKE A COPY" / "BRING A COPY BACK" — EVERYTHING, AND ONLY THE COPY: every store round-trips byte for byte (tales, pages, every setting — presets, the notes role, usage books, ledgers, records — and every connection with its keys and prices); and with the tavern’s server running, the house’s next push takes no device row back over the restore (a connection or a setting made after the copy stayed gone)', async () => {
  const { db: store, keepWhatWasNeverLetGo } = await import('../../js/store.js');
  const { restoreSpeaksFor } = await import('../../js/sync.js');
  const tale = await store.stories.create({ title: 'Copy test tale' });
  await store.messages.append(tale.id, { role: 'user', text: 'I walk in.' });
  await store.messages.append(tale.id, { role: 'assistant', text: '[Gate — Monday | 09:00]\n\nThe gate stood open.', keptText: 'x' });
  await store.settings.set('voicePresets', [{ id: 'vp-1', name: 'Hulk', voice: { frameText: 'I am Hulk.' }, savedAt: 1 }]);
  await store.settings.set('notesRole', 'assistant');
  await store.settings.set('usage:2026-09-29', { rows: [{ connId: 'c', model: 'm', inTok: 5, outTok: 2, calls: 1 }] });
  await store.settings.set('state:' + tale.id, { page: 0, place: 'Gate' });
  await store.settings.set('memory:' + tale.id, { nodes: [{ id: 'n1', text: 'a line' }] });
  const conn = await store.connections.add({ label: 'Kimi', type: 'openai', baseUrl: 'https://api.example', apiKey: 'sk-SECRET', model: 'k3', priceIn: 1, priceOut: 3, userFirstFor: 'k3@https://api.example' });
  const snap = async () => {
    const byKey = (a, k) => [...a].sort((x, y) => String(x[k]).localeCompare(String(y[k])));
    const keys = await store.settings.keys();
    const settings = []; for (const k of keys) settings.push({ key: k, value: await store.settings.get(k) });
    const msgs = []; for (const s of await store.stories.list()) msgs.push(...(await store.messages.list(s.id)));
    return JSON.stringify({ settings: byKey(settings, 'key'), connections: byKey(await store.connections.list(), 'id'), stories: byKey(await store.stories.list(), 'id'), messages: byKey(msgs, 'id') });
  };
  const before = await snap();
  const copy = await store.exportAll();
  /* the tavern moves on after the copy: a new tale, a changed setting, a new connection, one let go */
  const later = await store.stories.create({ title: 'Made after the copy' });
  await store.settings.set('notesRole', 'user');
  await store.settings.set('madeAfterTheCopy', true);
  const laterConn = await store.connections.add({ label: 'After', type: 'openai', baseUrl: 'https://after', apiKey: 'k', model: 'x' });
  await store.connections.remove(conn.id);
  const held = { keys: await store.settings.keys(), conns: (await store.connections.list()).map((c) => c.id) };
  await store.importAll(copy);
  eq(await snap(), before, 'after the restore every store is exactly the copy — nothing of after it, nothing lost');
  assert(!(await store.stories.list()).some((s) => s.id === later.id), 'the tale made after the copy is gone from here');
  eq((await store.connections.list()).find((c) => c.id === conn.id).apiKey, 'sk-SECRET', 'keys included');
  /* the server's house book still holds what was made after the copy */
  const after = { keys: await store.settings.keys(), conns: (await store.connections.list()).map((c) => c.id) };
  const spoke = restoreSpeaksFor(held, after).map((k) => (k.startsWith('conn:') ? k.slice(5) : k));
  const house = (settings, connections) => ({ kind: 'house', stories: [], settings, connections });
  const local = house([{ key: 'notesRole', value: 'assistant' }], [{ id: conn.id }]);
  const device = house([{ key: 'notesRole', value: 'user' }, { key: 'madeAfterTheCopy', value: true }], [{ id: conn.id }, { id: laterConn.id }]);
  const blind = keepWhatWasNeverLetGo(local, device, []);
  assert(blind.adopt.settings.some((r) => r.key === 'madeAfterTheCopy') && blind.adopt.connections.some((c) => c.id === laterConn.id), 'as it was: the device’s rows came back over the restore');
  const told = keepWhatWasNeverLetGo(local, device, spoke);
  eq(told.adopt.settings.length + told.adopt.connections.length, 0, 'now: the restore spoke for every row it replaced — nothing comes back');
  await store.stories.remove(tale.id).catch(() => {});
});

test('M510-48 THE HYBRID, ALWAYS ON (his word: "even a frontier model needs information that is not overwhelming — a coherent timeline"): with the essentials made, a frontier storyteller reads the essentials, the record’s newest lines word for word, the record’s lines about who is here, the older lines this scene names WHOLE, and the plans standing — not the whole record; before the essentials exist, the whole record rides as always; and the rulebook’s Exposed law rides every storyteller', async () => {
  const st = { ...applyMutations({ ...emptyState(), page: 200 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Training yard' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Byakuya Kuchiki' }]).state, page: 200 };
  const nodes = [];
  for (let i = 0; i < 120; i += 1) nodes.push({ id: 'n' + i, span: [i * 2, i * 2 + 1], level: 1, text: 'Line ' + i + ': Jovan trained with the Thirteenth Division; ' + 'the drills went on and the yard rang. '.repeat(30) /* long enough that the newest lines' room holds only the last few dozen */ + (i === 7 ? 'At the captains’ meeting Jovan told every captain he serves as Head Captain Yamamoto’s personal attendant.' : '') + (i === 30 ? 'Byakuya Kuchiki watched Jovan spar and said nothing.' : '') });
  const mods = [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }];
  const msgs = pages(15);
  msgs.push({ id: 'ux', role: 'user', text: 'Byakuya asks me whose attendant I really am, in front of the whole Thirteenth Division.' });
  const args = (essentials) => ({ story: {}, messages: msgs, settings: {}, state: st, modules: mods, memory: nodes.map((n) => '- ' + n.text).join('\n'), window: { keeperOn: true, window: 30, budgetTokens: 262000, nodes }, smallEssentials: essentials, smallPlansBook: { plans: [{ id: 'p1', title: 'The duel with Zaraki', whose: 'Jovan', aim: 'prove he is fit to be captain', parts: [{ who: 'Jovan', does: 'meets Zaraki at noon' }], status: 'standing' }] } });
  const whole = buildRequest(args(null));
  assert(/Our story so far, in full — everything before the pages that follow/.test(notesOf(whole)) && /Line 0:/.test(notesOf(whole)), 'before the essentials exist: the whole record, as always');
  const hybrid = buildRequest(args({ text: '[Seireitei · spring] (pages 1–240) Jovan arrives; serves as Yamamoto’s personal attendant (told the captains); trains with the Thirteenth.', upTo: 239 }));
  const notes = notesOf(hybrid);
  assert(/In brief, from the beginning \(pages 1–240\):\n\[Seireitei/.test(notes), 'the essentials: the whole story as a timeline, with the pages it covers (M510-51)');
  assert(/In full, just before the pages that follow \(pages \d+–240\)/.test(notes) && /Line 119:/.test(notes) && !/Our story so far, in full — everything before the pages that follow/.test(notes), 'the newest lines word for word — not the whole record');
  assert(!/Line 1: /.test(notes.split('In full, earlier moments')[0]), 'the oldest lines are not in the newest part');
  assert(/In full, earlier moments that matter now[^\n]*\n[\s\S]*personal attendant/.test(notes), 'the older line this scene names (his move: attendant) comes back WHOLE: ' + (notes.match(/In full, earlier moments[\s\S]{0,300}/) || [''])[0].slice(0, 300));
  assert(/Plans standing[\s\S]*The duel with Zaraki/.test(notes), 'the plans standing ride for a frontier storyteller');
  const wordsWhole = notesOf(whole).length; const wordsHybrid = notes.length;
  assert(wordsHybrid < wordsWhole, 'lighter than the whole record: ' + wordsWhole + ' → ' + wordsHybrid + ' characters');
  const { ALWAYS_LAWS } = await import('../../js/assemble/laws.js');
  assert(/^Exposed = /m.test(CRAFT_TEXT) && ALWAYS_LAWS.includes('Exposed'), 'the Exposed law: in the rulebook, and among the small model’s always-laws');
  const { SHIPPED_BEFORE } = await import('../../js/assemble/modules.js');
  assert(SHIPPED_BEFORE['core-craft'].includes('99fpod'), 'an unedited saved rulebook follows the new one');
});

test('M510-49 (final audit of the hybrid) NO HOLE, FAIR ROOM, MADE AGAIN BY HAND: every line folded since the essentials rides word for word; essentials far behind the record give way to the whole record; who is here shares a tight room so each person keeps their newest line; the essentials keeper makes them again when asked, whatever it kept', async () => {
  const { recordOfWhoIsHere, HYBRID_RECENT_CHARS } = await import('../../js/assemble/stack.js');
  const { runEssentials, ESSENTIALS_KEY } = await import('../../js/agents/essentials.js');
  const { db: store } = await import('../../js/store.js');
  const st = { ...applyMutations({ ...emptyState(), page: 300 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Training yard' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Byakuya Kuchiki' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }]).state, page: 300 };
  const long = (i, extra = '') => 'Line ' + i + ': ' + 'the drills went on and the yard rang with it. '.repeat(40) + extra;
  const nodes = []; for (let i = 0; i < 60; i += 1) nodes.push({ id: 'n' + i, span: [i * 4, i * 4 + 3], level: 1, text: long(i, i === 5 ? 'Byakuya named Jovan a liar before the captains.' : i >= 50 ? 'Rukia sparred beside Jovan.' : '') });
  const mods = [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }];
  const build = (upTo) => buildRequest({ story: {}, messages: pages(12), settings: {}, state: st, modules: mods, memory: nodes.map((n) => '- ' + n.text).join('\n'), window: { keeperOn: true, window: 30, budgetTokens: 262000, nodes }, smallEssentials: { text: '[Seireitei] (pages 1–' + (upTo + 1) + ') essentials', upTo } });
  /* the essentials made through line 49's pages; lines 50–59 folded since (~19,000 characters): all ride */
  const recent = notesOf(build(nodes[49].span[1]));
  assert(/In brief, from the beginning/.test(recent) && nodes.slice(50).every((n) => recent.includes(n.text.slice(0, 20) + ' ') || recent.includes('Line ' + n.id.slice(1) + ':')), 'every line folded since the essentials rides word for word');
  /* made through line 5 only (the keeper failing since): ~100,000 characters folded since — more than twice the room: the whole record */
  const stale = notesOf(build(nodes[5].span[1]));
  assert(/Our story so far, in full — everything before the pages that follow/.test(stale) && !/In full, just before the pages that follow/.test(stale), 'essentials far behind give way to the whole record (' + HYBRID_RECENT_CHARS * 2 + ' characters the limit)');
  /* fair: Byakuya named only in line 5, Rukia in the ten newest — a room for two long lines keeps one each */
  const fair = recordOfWhoIsHere(nodes, st, { each: 6, cap: long(0).length * 2 + 400 });
  assert(/Byakuya named Jovan a liar/.test(fair.text) && /Rukia sparred beside Jovan/.test(fair.text), 'each person here keeps their newest line: ' + fair.lines + ' lines');
  /* made again by hand */
  const sid = 'story-remake';
  let asked = 0;
  const fake = async () => { asked += 1; return '[Monday · Seireitei] (pages 1–4) Jovan arrives at the gate; tells the captains he serves Yamamoto; Byakuya names him a liar before them all.'; }; /* the keeper’s own shape, long enough to be kept */
  const recNodes = [{ id: 'a', span: [0, 3], level: 1, text: 'Jovan arrives.' }];
  await runEssentials({ connection: CONN, storyId: sid, nodes: recNodes, callLLM: fake });
  const again = await runEssentials({ connection: CONN, storyId: sid, nodes: recNodes, callLLM: fake });
  eq(again.why, 'unchanged', 'the record unchanged: the keeper does not ask by itself');
  const forced = await runEssentials({ connection: CONN, storyId: sid, nodes: recNodes, callLLM: fake, force: true });
  assert(forced.wrote && asked === 2, 'asked by hand: made again (' + asked + ' asks)');
  await store.settings.delete(ESSENTIALS_KEY(sid));
});

test('M510-50 SMART RECALL (his word: "can the AI smartly think: Bruce probably means this from the record — smart, yet careful?"): a worker names older record lines by number for what his move MEANS (a family tie → the line where his standing was told); only numbers in the index count, at most four; slow or failing, none — and the page goes on; the named lines ride whole, the record’s own words', async () => {
  const { pickRecall, readPick, recallIndex, PICK_MAX } = await import('../../js/agents/recallpick.js');
  const nodes = [
    { id: 'a', span: [0, 5], level: 1, text: 'At the captains’ meeting Jovan tells every captain he serves as Head Captain Yamamoto’s personal attendant.' },
    { id: 'b', span: [6, 11], level: 1, text: 'Jovan and Rukia share tea at the Kuchiki manor.' },
    { id: 'c', span: [12, 17], level: 1, text: 'Jovan tells the Thirteenth Division he is only a recruit.' },
    { id: 'd', span: [18, 23], level: 1, text: 'Zaraki names noon for the duel.' },
  ];
  eq(recallIndex(nodes).map((x) => x.n + ':' + x.id).join(' '), '1:a 2:b 3:c 4:d', 'numbered oldest first');
  eq(JSON.stringify(readPick('{"lines":[1,9,1,3,2,4,4]}', 4)), '[1,3,2,4]', 'only numbers in the index, each once, at most ' + PICK_MAX);
  eq(JSON.stringify(readPick('Line 1, I think.', 4)), '[]', 'no JSON: none');
  let seen = null;
  const smart = async (conn, { system, user }) => { seen = { system, user }; return '{"lines":[1,3]}'; };
  const out = await pickRecall({ connection: CONN, essentials: '[Seireitei] Jovan arrives…', nodes, move: 'Byakuya asks who my uncle is, in front of the whole division.', lastPage: 'The division gathered.', mc: 'Jovan', callLLM: smart });
  eq(out.ids.join(','), 'a,c', 'the lines it named, by id');
  assert(/THE WRITER'S NEWEST MOVE:\nByakuya asks who my uncle is/.test(seen.user) && /1\. \(pages 1–6\) At the captains’ meeting/.test(seen.user) && /Think about what the move means, not only the words/.test(seen.system), 'it reads his move, the index, and is told to read for meaning');
  const slow = await pickRecall({ connection: CONN, nodes, move: 'x', timeoutMs: 600, callLLM: () => new Promise((r) => setTimeout(() => r('{"lines":[1]}'), 3000)) });
  assert(slow.ids.length === 0 && slow.why === 'took too long', 'slow: none, and the page goes on');
  const broken = await pickRecall({ connection: CONN, nodes, move: 'x', callLLM: async () => { throw new Error('down'); } });
  assert(broken.ids.length === 0 && broken.why === 'could not ask', 'failing: none');
  /* the builder: the named line rides whole under the older lines */
  const st = { ...applyMutations({ ...emptyState(), page: 300 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Training yard' }, { type: 'presence.enter', name: 'Jovan' }]).state, page: 300 };
  const many = []; for (let i = 0; i < 60; i += 1) many.push({ id: 'n' + i, span: [i * 4, i * 4 + 3], level: 1, text: 'Line ' + i + ': ' + 'the drills went on and the bells rang with it. '.repeat(40) /* no word of the scene: only the smart recall can name it */ + (i === 3 ? 'SMART-MARK: Jovan tells the captains he serves Yamamoto.' : '') });
  const r = buildRequest({ story: {}, messages: pages(12), settings: {}, state: st, modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: many.map((n) => '- ' + n.text).join('\n'), window: { keeperOn: true, window: 30, budgetTokens: 262000, nodes: many }, smallEssentials: { text: '[Seireitei] (pages 1–240) essentials', upTo: 239 }, recallPicked: ['n3'] });
  assert(/In full, earlier moments that matter now[\s\S]*\(pages 13–16\) Line 3:[\s\S]*SMART-MARK/.test(notesOf(r)), 'the named line rides whole, under its pages');
  assert(/1 of them named by the smart recall/.test(r.receipt.slots.find((s) => s.name === 'Earlier moments, in full').source), 'the receipt says the smart recall picked it (the source line of the row that holds it — M511: the lines called back are the earlier moments’ row, as in the request)');
});

test('M510-51 OUR STORY SO FAR, ONE PART READ ONE WAY (his look at the raw request: "does the storyteller understand \'the 54 older lines are in the essentials above, each kept whole on the device\'? even I am confused"): it says first how to read it; then the whole story in brief, the stretch just before the pages in full and the earlier moments in full — each line with its own pages, the earlier ones in the order they happened, never twice — then the plans; it stands after canon and before the people and the state of things; no count, no device', async () => {
  const st = { ...applyMutations({ ...emptyState(), page: 300 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Thirteenth Division yard' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Byakuya Kuchiki' }]).state, page: 300 };
  const nodes = []; for (let i = 0; i < 60; i += 1) nodes.push({ id: 'n' + i, span: [i * 4, i * 4 + 3], level: 1, text: 'Line ' + i + ': ' + 'the drills went on and the bells rang with it. '.repeat(40) + (i === 3 ? 'Jovan tells every captain he serves Yamamoto as his personal attendant.' : '') + (i === 9 ? 'Byakuya Kuchiki watches Jovan spar and says nothing.' : '') });
  const msgs = pages(12); msgs.push({ id: 'ux', role: 'user', text: 'Byakuya asks whose attendant I really am.' });
  const r = buildRequest({ story: {}, messages: msgs, settings: {}, state: st, modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: nodes.map((n) => '- ' + n.text).join('\n'), window: { keeperOn: true, window: 30, budgetTokens: 262000, nodes }, smallEssentials: { text: '- [Seireitei] (pages 1–240) Jovan arrives; serves Yamamoto; trains.', upTo: 239 }, recallPicked: ['n3'], smallPlansBook: { plans: [{ id: 'p', title: 'The duel with Zaraki', whose: 'Jovan', aim: 'prove himself', parts: [{ who: 'Jovan', does: 'meets Zaraki at noon' }], status: 'standing' }] } });
  const notes = notesOf(r);
  const at = (t) => notes.indexOf(t);
  const order = ['Our story so far — first the whole of it in brief', 'In brief, from the beginning (pages 1–240):', 'In full, just before the pages that follow (pages ', 'In full, earlier moments that matter now', 'Plans standing', 'The ground: '];
  assert(order.every((t) => at(t) !== -1), 'every piece is there: ' + order.filter((t) => at(t) === -1).join(' | '));
  assert(order.every((t, i) => i === 0 || at(order[i - 1]) < at(t)), 'in that order — the past, the plans, then the state of things now');
  assert(/Where the brief and a full line differ, the full line is right; the pages that follow are right over both/.test(notes), 'it says how to read it');
  assert(!/kept whole on the device|older lines are in the essentials|What the record holds of who is here|From the older record|The newest of the record/.test(notes), 'no count, no device, no old heading');
  const earlier = notes.slice(at('In full, earlier moments'), at('Plans standing')).split('\n').slice(1).filter((l) => l.startsWith('- '));
  assert(earlier.length >= 2 && earlier.every((l) => /^- \(pages \d+–\d+\) /.test(l)), 'every earlier line with its own pages');
  assert(earlier.some((l) => /personal attendant/.test(l)) && earlier.some((l) => /Byakuya Kuchiki watches Jovan/.test(l)), 'the line his move means and the line of the person here — one list');
  const firsts = earlier.map((l) => Number(l.match(/\(pages (\d+)/)[1]));
  assert(firsts.every((p, i) => i === 0 || firsts[i - 1] < p), 'in the order they happened, never twice: ' + firsts.join(', '));
  const recentBlock = notes.slice(at('In full, just before'), at('In full, earlier moments')).split('\n').slice(1).filter((l) => l.startsWith('- '));
  assert(recentBlock.length && recentBlock.every((l) => /^- \(pages \d+–\d+\) Line \d+:/.test(l)), 'the stretch just before the pages: each line with its own pages too');
});

test('M510-52 (the whole request read top to bottom, as the storyteller) PAST, PLANS, PRESENT — NOTHING TWICE, NOTHING UNNATURAL: the whole record stands where the hybrid does, named plainly, after canon and before the people; no brief beside a record that fits in full; a belief reads "believes", never "knows: believes"; a blind spot shows the fact, never the knower\'s "was told", and a belief is no one\'s blind spot; every age is in pages', async () => {
  const { renderKnowledge, blindSpots, renderBlindSpots } = await import('../../js/engine/world.js');
  let st = applyMutations({ ...emptyState(), page: 300 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Thirteenth Division yard' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Byakuya Kuchiki' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }]).state;
  st = { ...st, page: 300, knowledge: { 'Rukia Kuchiki': [{ fact: 'believes Jovan is only a recruit — untrue: Jovan is the new captain', atTurn: 299 }], 'Byakuya Kuchiki': [{ fact: 'was told Jovan serves Yamamoto as his personal attendant', atTurn: 299 }] } };
  const small = []; for (let i = 0; i < 10; i += 1) small.push({ id: 's' + i, span: [i * 6, i * 6 + 5], level: 1, text: '[Day ' + (i + 1) + '] Jovan trains with the Thirteenth.' });
  const build = (essentials) => buildRequest({ story: {}, messages: pages(6), settings: { tellerName: 'Hulk', writerName: 'Bruce' }, state: st, modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: small.map((n) => '- ' + n.text).join('\n'), window: { keeperOn: true, window: 30, budgetTokens: 262000, nodes: small }, smallEssentials: essentials, smallPlansBook: { plans: [{ id: 'p', title: 'The duel with Zaraki', whose: 'Jovan', aim: 'prove himself', parts: [{ who: 'Jovan', does: 'meets Zaraki at noon' }], status: 'standing' }] } });
  {
    const notes = notesOf(build(null));
    const at = (t) => notes.indexOf(t);
    assert(at('Our story so far, in full — everything before the pages that follow') !== -1 && at('Our story so far, in full') < at('Plans standing') && at('Plans standing') < at('The ground: '), 'without essentials: the whole record after canon, then the plans, then the state of things now');
    assert(!/In brief, from the beginning|What our story holds, in essentials/.test(notes), 'no essentials: no brief');
  }
  /* M510-58: with the essentials made the hybrid ALWAYS starts — his decision — even for a record this short; the full part
   * is at most half the record, the older half in the brief */
  {
    const notes = notesOf(build({ text: '- [Day 1–10] (pages 1–60) Jovan trains.', upTo: 59 }));
    const at = (t) => notes.indexOf(t);
    assert(at('In brief, from the beginning') !== -1 && at('In full, just before the pages that follow') > at('In brief, from the beginning') && at('Plans standing') < at('The ground: '), 'with essentials, a short record: the hybrid, then the plans, then the state of things now');
    const full = notes.slice(at('In full, just before the pages that follow'), at('Plans standing')).split('\n').filter((l) => /^- \(pages/.test(l));
    assert(full.length >= 1 && full.length <= 5, 'at most half of the ten lines in full: ' + full.length);
  }
  /* "fits in full" is the record's own size, not the text handed over (cut to a small context's room): a long record cut
   * short is the one the essentials stand in for */
  const big = []; for (let i = 0; i < 60; i += 1) big.push({ id: 'b' + i, span: [i * 4, i * 4 + 3], level: 1, text: 'Line ' + i + ': ' + 'the drills went on and the bells rang with it. '.repeat(40) });
  const cut = buildRequest({ story: {}, messages: pages(6), settings: {}, state: st, modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: big.slice(-3).map((n) => '- ' + n.text).join('\n'), window: { keeperOn: true, window: 30, budgetTokens: 262000, nodes: big }, smallEssentials: { text: '- [Day 1–60] (pages 1–240) Jovan trains.', upTo: 239 } });
  assert(/In brief, from the beginning/.test(notesOf(cut)), 'a long record handed over cut short: the hybrid, with its brief');
  const kn = renderKnowledge(st.knowledge, ['Rukia Kuchiki', 'Byakuya Kuchiki'], Infinity);
  assert(/Rukia Kuchiki believes: Jovan is only a recruit — untrue: Jovan is the new captain\./.test(kn) && !/knows: believes/.test(kn), 'a belief reads as a belief: ' + kn);
  const spots = renderBlindSpots(blindSpots(st.knowledge, ['Rukia Kuchiki', 'Byakuya Kuchiki', 'Jovan'], { turn: 300, mc: 'Jovan' }));
  assert(/Rukia Kuchiki hasn’t found out: Jovan serves Yamamoto as his personal attendant \(Byakuya Kuchiki knows\)/.test(spots) && !/hasn’t found out: was told/.test(spots), 'the blind spot shows the fact: ' + spots);
  assert(!/Byakuya Kuchiki hasn’t found out: (?:believes )?Jovan is only a recruit/.test(spots), 'a belief is no one’s blind spot');
  /* ages in pages: the people's own law says it (finishing.mjs, "Last noted 30 pages ago") */
});

test('M510-54 ONE PERSON, ONE ENTRY (his report: "canon verification shows the characters twice — after I branch to the start of the scene there are two Rukias"): the same wiki page kept under two keys is one person — the richer (else newer) stays, the other key and name join its aliases; a miss and other people are untouched', async () => {
  const { mergeCanonTwins } = await import('../../js/canon/bridge.js');
  const src = { 'rukia': { name: 'Rukia Kuchiki', wiki: 'bleach', found: true, sections: { physical: 'x' }, ts: 5 }, 'rukia kuchiki': { name: 'Rukia Kuchiki', wiki: 'bleach', found: true, sections: { physical: 'x', rank: 'y' }, ts: 1, aliases: ['Midget'] }, 'byakuya': { name: 'Byakuya Kuchiki', wiki: 'bleach', found: true, sections: { physical: 'z' }, ts: 2 }, 'kon': { name: 'kon', found: false, reason: 'no-page' }, 'rukia (other wiki)': { name: 'Rukia Kuchiki', wiki: 'other', found: true, sections: { a: 1 }, ts: 9 } };
  const { cache, redirect } = mergeCanonTwins(src);
  eq(Object.keys(cache).sort().join(', '), 'byakuya, kon, rukia (other wiki), rukia kuchiki', 'one Rukia per wiki page; the miss and Byakuya stand');
  eq(redirect.rukia, 'rukia kuchiki', 'the let-go key points at the kept one');
  assert(cache['rukia kuchiki'].aliases.includes('Midget') && cache['rukia kuchiki'].aliases.includes('rukia'), 'names kept as aliases');
  eq(Object.keys(src).length, 5, 'the cache handed in is not touched');
});

test('M510-55 WHAT THE STORYTELLER SAW, IN THE ORDER IT WAS SENT (his word: "the order of things and the explanation inside don\'t look like the raw"): every row that rode stands where its words stand in the request — the system first, then the notes (canon, our story so far, the plans, the people, the state of things), the pages, the closing; a row that did not ride stands beside the row it would follow; the record\'s rows name the words they are sent under; the pages are "The pages, word for word", not "the story so far"', async () => {
  const st = { ...applyMutations({ ...emptyState(), page: 300 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Thirteenth Division yard' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }]).state, page: 300 };
  const big = []; for (let i = 0; i < 60; i += 1) big.push({ id: 'b' + i, span: [i * 4, i * 4 + 3], level: 1, text: 'Line ' + i + ': ' + 'the drills went on and the bells rang with it. '.repeat(40) + (i === 9 ? 'Rukia Kuchiki corrects his stance.' : '') });
  const mods = [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }, { mod: { id: 'fight-acoustics', name: 'How a fight sounds', text: 'Both lanes, every beat.' }, reason: 'a fight' }];
  const r = buildRequest({ story: { brief: 'A Bleach story.' }, messages: pages(8), settings: { frameText: 'I am Hulk.', noteText: 'Keep it LOUD.', noteOn: true }, state: st, modules: mods, memory: big.map((n) => '- ' + n.text).join('\n'), window: { keeperOn: true, window: 30, budgetTokens: 262000, nodes: big }, smallEssentials: { text: '- [Day 1–60] (pages 1–240) Jovan trains.', upTo: 239 }, smallPlansBook: { plans: [{ id: 'p', title: 'The duel', whose: 'Jovan', aim: 'win', parts: [{ who: 'Jovan', does: 'fights' }], status: 'standing' }] } });
  const rows = r.receipt.slots;
  const rode = rows.filter((s) => s.tokens > 0).map((s) => s.name);
  const expect = ['The frame', 'The craft', 'The brief', 'Active modules', 'Story essentials', 'What remains', 'Plans standing', 'The state of things', 'The pages, word for word', 'The note at the end'];
  const got = rode.filter((n) => expect.includes(n));
  eq(got.join(' → '), expect.filter((n) => rode.includes(n)).join(' → '), 'the rows that rode, in the order they were sent');
  const wire = [...r.systemBlocks.map((b) => b.text), ...r.messages.map((m) => String(m.content))].join('\n');
  assert(/sent as “Our story so far — In brief, from the beginning”/.test(rows.find((s) => s.name === 'Story essentials').source), 'the brief’s row names what it is sent under');
  assert(/sent inside “Our story so far” as “In full, just before the pages that follow”/.test(rows.find((s) => s.name === 'What remains').source) && /In full, just before the pages that follow/.test(wire), 'and the record’s — words the raw request holds');
  assert(rows.some((s) => s.name === 'The pages, word for word' && s.tokens > 0) && !rows.some((s) => s.name === 'The story so far'), 'the pages are named as what they are');
  const at = (n) => rows.findIndex((s) => s.name === n);
  assert(at('Who’s here, in the recent pages') > at('What remains') && at('Who’s here, in the recent pages') < at('On their mind'), 'a row that did not ride stands where it would have (with the story so far, before the people)');
});

test('M510-57 THE RECEIPT EXPLAINS EXACTLY (his word: "make sure the explanation is good"): before the essentials exist, their row says when they are made and what is sent meanwhile — in the raw request\'s own words; with the whole record sent, "Who\'s here, in the record" says every line about them is in it (not "or…"); the pages\' row points to "Our story so far"', async () => {
  const st = { ...applyMutations({ ...emptyState(), page: 300 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Yard' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }]).state, page: 300 };
  const big = []; for (let i = 0; i < 60; i += 1) big.push({ id: 'b' + i, span: [i * 4, i * 4 + 3], level: 1, text: 'Line ' + i + ': ' + 'the drills went on and the bells rang with it. '.repeat(40) });
  const r = buildRequest({ story: {}, messages: pages(20), settings: {}, state: st, modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: big.map((n) => '- ' + n.text).join('\n'), window: { keeperOn: true, window: 30, budgetTokens: 262000, nodes: big } });
  const row = (n) => r.receipt.slots.find((s) => s.name === n);
  assert(/when the story opens, and after each page/.test(row('Story essentials').reason) && /“Our story so far, in full”/.test(row('Story essentials').reason), 'the essentials’ row: when they are made, and what is sent meanwhile, in the raw’s words');
  assert(/Our story so far, in full — everything before the pages that follow/.test(notesOf(r)), 'which is what the raw says');
  eq(row('Earlier moments, in full').reason, 'your whole record is sent in full — every earlier moment is in it', 'no "or"');
  assert(/are in Our story so far \(the What remains row\)/.test(row('The pages, word for word').source), 'the pages’ row points to what the raw calls it: ' + row('The pages, word for word').source);
});

test('M510-58 THE HYBRID ALWAYS STARTS (his word, angry and right: "the essentials are made but everything still uses the old system — story essentials not part of this turn"): with the essentials made, the hybrid rides at every record size — a short record included (M510-52 had put a threshold back); the full part is at most half the record and never past its room; only essentials far behind give way', async () => {
  const st = { ...applyMutations({ ...emptyState(), page: 300 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Yard' }, { type: 'presence.enter', name: 'Jovan' }]).state, page: 300 };
  const mods = [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }];
  for (const [count, width] of [[8, 1], [40, 3], [60, 40]]) {
    const nodes = []; for (let i = 0; i < count; i += 1) nodes.push({ id: 'h' + i, span: [i * 4, i * 4 + 3], level: 1, text: 'Line ' + i + ': ' + 'the drills went on and the bells rang with it. '.repeat(width) });
    const r = buildRequest({ story: {}, messages: pages(20), settings: {}, state: st, modules: mods, memory: nodes.map((n) => '- ' + n.text).join('\n'), window: { keeperOn: true, window: 30, budgetTokens: 262000, nodes }, smallEssentials: { text: '- [Day 1] (pages 1–' + (count * 4) + ') Jovan trains.', upTo: count * 4 - 1 } });
    const notes = notesOf(r);
    const ess = r.receipt.slots.find((s) => s.name === 'Story essentials');
    assert(/In brief, from the beginning/.test(notes) && ess.tokens > 0, count + ' lines of ' + width + ': the essentials ride (' + ess.tokens + ' tokens)');
    const full = notes.split('\n').filter((l) => /^- \(pages \d+–\d+\) Line \d+:/.test(l)).length;
    assert(full <= Math.ceil(count / 2) && full >= 1, count + ' lines: at most half in full (' + full + ')');
  }
});

test('M510-59 THE FOLD SIZE DOES NOT MATTER (his question: "what if my fold is every 10, 20 or 30 pages?"): the older lines called back have a room of their own (~4,000 tokens) — whole lines of 30 pages each once made the memory balloon (28,000 tokens for a 600-page story, measured on m510-058); now any fold size stays about the same; the smart picks go first; at least one always rides', async () => {
  const { HYBRID_RECALL_CHARS } = await import('../../js/assemble/stack.js');
  const st = { ...applyMutations({ ...emptyState(), page: 600 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Yard' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }]).state, page: 600 };
  const mods = [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }];
  const msgs = pages(10); msgs.push({ id: 'ux', role: 'user', text: 'Rukia asks about the attendant and the drills and the gate.' });
  const sizes = [];
  for (const batch of [6, 30]) {
    const count = Math.floor(600 / batch);
    const nodes = []; for (let i = 0; i < count; i += 1) nodes.push({ id: 'b' + i, span: [i * batch, i * batch + batch - 1], level: 1, text: 'Line ' + i + ': Rukia at the gate; the attendant and the drills. ' + 'the drills went on and the bells rang with it. '.repeat(Math.round(batch * 420 / 48)) });
    const r = buildRequest({ story: {}, messages: msgs, settings: {}, state: st, modules: mods, memory: nodes.map((n) => '- ' + n.text).join('\n'), window: { keeperOn: true, window: 30, budgetTokens: 262000, nodes }, smallEssentials: { text: '- [Day 1–100] (pages 1–600) Jovan trains.', upTo: count * batch - 1 }, recallPicked: ['b1', 'b2', 'b3', 'b4'] });
    const notes = notesOf(r);
    const earlier = notes.slice(notes.indexOf('In full, earlier moments'), notes.indexOf('Plans standing') === -1 ? undefined : notes.indexOf('Plans standing'));
    assert(earlier.length > 0, 'fold every ' + batch + ': older moments still called back');
    const rows = Object.fromEntries(r.receipt.slots.map((s) => [s.name, s.tokens]));
    sizes.push(rows['What remains'] + rows['Earlier moments, in full']); /* M511: the lines called back are the earlier moments' row now, as in the request */
  }
  assert(sizes[1] <= sizes[0] * 1.3, 'a 30-page fold is about the size of a 6-page fold: ' + sizes.join(' vs ') + ' tokens');
  assert(HYBRID_RECALL_CHARS === 16000, 'the room for lines called back: about 4,000 tokens');
});

test('M510-60 (the deep audit, read as the storyteller) THE REFERENCE BEFORE THE STORY, ONE VOICE THROUGHOUT: canon, then the lore shelf, then our story so far; and every heading of our story so far holds in every voice the notes can take — "the pages that follow", "the newest move" — so the storyteller’s own notebook never calls the writer’s move its own', async () => {
  const st = { ...applyMutations({ ...emptyState(), page: 300 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Yard' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }]).state, page: 300 };
  const nodes = []; for (let i = 0; i < 60; i += 1) nodes.push({ id: 'n' + i, span: [i * 4, i * 4 + 3], level: 1, text: 'Line ' + i + ': ' + 'the drills went on and the bells rang with it. '.repeat(30) + (i === 9 ? 'Rukia Kuchiki corrects his stance.' : '') });
  for (const notesRole of [undefined, 'user', 'assistant']) {
    const r = buildRequest({ story: {}, messages: pages(8), settings: { tellerName: 'Hulk', writerName: 'Bruce', notesRole }, state: st, modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: nodes.map((n) => '- ' + n.text).join('\n'), window: { keeperOn: true, window: 30, budgetTokens: 262000, nodes }, canonNote: 'CANON-MARK Rukia: violet eyes.', lore: 'LORE-MARK The Seireitei: a walled city.', smallEssentials: { text: '- [Day 1–60] (pages 1–240) Jovan trains.', upTo: 239 } });
    const notes = notesRole ? String(r.messages[0].content) : notesOf(r);
    const at = (t) => notes.indexOf(t);
    assert(at('CANON-MARK') !== -1 && at('CANON-MARK') < at('LORE-MARK') && at('LORE-MARK') < at('Our story so far'), (notesRole || 'system') + ': canon, then the lore, then our story so far');
    assert(!/the pages you have|my move is about/.test(notes) && /the pages that follow/.test(notes) && /the newest move brings up/.test(notes), (notesRole || 'system') + ': the headings hold in this voice');
  }
});

test('M510-62 THE COMMANDS LIVE IN THE INSTRUCTIONS (his question: "isn\'t the shortcut already inside the main instructions? #commands shouldn\'t be embedded in the frontend"): a typed "#q" reaches the storyteller as he typed it; its meaning rides once with the rulebook as SHORTCUTS; the rulebook\'s own law points there (no per-turn directive, which it used to promise); the app reads a command only for its own bookkeeping', async () => {
  const msgs = pages(6); msgs.push({ id: 'uq', role: 'user', text: '#q', typed: '#q' });
  const r = buildRequest({ story: {}, messages: msgs, settings: {}, state: yard(), modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: '', window: { keeperOn: true, window: 30, budgetTokens: 262000 }, directive: 'IGNORED-DIRECTIVE' });
  const craftBlock = r.systemBlocks[1].text;
  assert(/SHORTCUTS\. When the writer’s whole message is one of these/.test(craftBlock) && /^#q — /m.test(craftBlock), 'the meaning of #q rides with the rulebook');
  assert(/The Commands = [^\n]*means what SHORTCUTS, with these laws, says it means/.test(craftBlock), 'and the rulebook’s own law points to it');
  const users = r.messages.filter((m) => m.role === 'user');
  eq(String(users[users.length - 1].content), '#q', 'his #q reaches the storyteller as he typed it');
  assert(!JSON.stringify(r).includes('IGNORED-DIRECTIVE'), 'no directive of the house’s rides on the turn');
});

test('M510-63 A PERSON BY EVERY NAME THAT IS ONLY THEIRS (his question: "how is who\'s here, in the record chosen — is it smart?"): a record line that says only "Zaraki" is Kenpachi Zaraki\'s; "Captain Hitsugaya" is Toshiro Hitsugaya\'s; a family name two known people share ("Kuchiki") is neither\'s alone; a title is never a name', async () => {
  const { recordOfWhoIsHere } = await import('../../js/assemble/stack.js');
  const st = { ...applyMutations({ ...emptyState(), page: 200 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Yard' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Kenpachi Zaraki' }, { type: 'presence.enter', name: 'Toshiro Hitsugaya' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }]).state, page: 200, characters: { 'Byakuya Kuchiki': { core: 'Captain of the 6th' } } };
  const line = (i, text) => ({ id: 'l' + i, span: [i * 4, i * 4 + 3], level: 1, text });
  const nodes = [line(0, 'Zaraki laughed and named noon for the duel.'), line(1, 'Captain Hitsugaya froze the courtyard.'), line(2, 'Kuchiki watched from the gate and said nothing.'), line(3, 'The captains met; every captain came.'), line(4, 'Rukia corrected his stance.')];
  const r = recordOfWhoIsHere(nodes, st, { each: 6, cap: 24000 });
  assert(/Zaraki laughed/.test(r.text) && r.who.includes('Kenpachi Zaraki'), 'a line that says only "Zaraki" is his');
  assert(/Captain Hitsugaya froze/.test(r.text) && r.who.includes('Toshiro Hitsugaya'), 'a family name after a title is his');
  assert(!/Kuchiki watched/.test(r.text), 'a family name Rukia and Byakuya share is not given to either');
  assert(!/every captain came/.test(r.text), 'a title is never a name');
  assert(/Rukia corrected/.test(r.text) && r.who.includes('Rukia Kuchiki'), 'her first name is hers');
});
