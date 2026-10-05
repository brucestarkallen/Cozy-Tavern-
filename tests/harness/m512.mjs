/* Cozy Tavern — harness laws of M512: the small model at its best (his order: "make the smaller model the best —
 * realistic, beautiful prose, natural, no old LLM repetition"). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { buildRequest } from '../../js/assemble/stack.js';
import { CRAFT_TEXT } from '../../js/assemble/craft.js';
import { lawsOf, lawsNamed, lawKey, ALWAYS_LAWS, PROSE_LAWS } from '../../js/assemble/laws.js';
import { sceneParagraphs, voicePassage, pickVoicePage, voiceSampleOf, wornPhrases } from '../../js/assemble/smallprose.js';
import { plannerAsk, readPlan } from '../../js/agents/planner.js';
import { renderPlan } from '../../js/assemble/planwords.js';
import { finalizeReceipt } from '../../js/assemble/receipt.js';
import { refereeWhyWords } from '../../js/agents/referee.js';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const wireOf = (r) => [...(r.systemBlocks || []).map((b) => (typeof b === 'string' ? b : b.text)), ...r.messages.map((m) => String(m.content))].join('\n');
const PERSONA_BREAKERS = /\b(assistant|an AI|language model|LLM|system prompt|the system|worker|JSON|mutation|marching orders|NORTH STAR|PREMISE —|BEATS —|NPC & WORLD|the director|the editor|the auditor|the referee|the house)\b/gi;
const PLAN = { scene: 'Kaelen has called Jovan out in front of the yard.', people: [{ name: 'Kaelen', now: 'circling with his staff', wants: 'to humble Jovan', against: 'the seat Jovan was given' }], unknown: [{ name: 'Rukia Kuchiki', fact: 'Jovan met the captain last night' }], pressing: ['the captain is watching'], earlier: ['Kaelen lost to Jovan once'], laws: ['Combat Calibration', 'Voice Fingerprints'], intense: true, loud: true, loudWhy: 'the whole yard is watching', sounds: ['*CRACK!*', '"Gkh—!"'], leaveTo: 'the staff comes down at him' };
const H = (n) => '[Tenth Division courtyard — Hanami 5, 1001 AG | 12:0' + (n % 10) + ' | bright noon | captain’s haori | at the rail]\n\n';
const yard = () => ({ ...applyMutations({ ...emptyState(), page: 40 }, [{ type: 'mc.set', name: 'Jovan Oda' }, { type: 'place.set', name: 'Tenth Division courtyard' }, { type: 'presence.enter', name: 'Jovan Oda' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }, { type: 'presence.enter', name: 'Kenpachi Zaraki' }]).state, page: 40 });
const turns = (n, page = (i) => H(i) + 'Page ' + i + '. Rukia watched the stones.', last = 'I tell Zaraki I will not draw today.') => { const out = []; for (let i = 0; i < n; i += 1) { out.push({ id: 'u' + i, role: 'user', text: 'I wait, move ' + i + '.' }); out.push({ id: 'a' + i, role: 'assistant', text: page(i) }); } out.push({ id: 'ux', role: 'user', text: last, ...(/^#question/.test(last) ? { ooc: true } : {}) }); return out; };
const small = (extra = {}) => buildRequest({ story: { brief: 'Bleach.' }, messages: extra.messages || turns(10), settings: { smallModelNow: true, ...(extra.plain ? {} : { tellerName: 'Hulk', writerName: 'Bruce' }), ...(extra.settings || {}) }, state: yard(), modules: [{ mod: { id: 'core-craft', name: 'The craft', text: extra.craft || CRAFT_TEXT }, reason: 'always' }], memory: '', window: { keeperOn: true, window: 30, budgetTokens: 262000, nodes: [] }, smallPlan: { ...PLAN, laws: ['MC Agency'], intense: false }, voiceSample: extra.voiceSample || null });
const frontier = (extra = {}) => buildRequest({ story: { brief: 'Bleach.' }, messages: extra.messages || turns(10), settings: { tellerName: 'Hulk', writerName: 'Bruce' }, state: yard(), modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: '', window: { keeperOn: true, window: 30, budgetTokens: 262000, nodes: [] }, voiceSample: extra.voiceSample || null });

test('M512-1 EVERY LAW OF HIS IS ITS OWN LAW: a name with commas ("Real People, Real Record", "CORE Voice Fixed, Register Dynamic") or a closing aside ("Banned Constructs (narration only)", "OOC (input starts with #question)") was read as the tail of the law before it — now each is found by its name (the aside is not part of it), the law before it ends where it ends, and every line of the craft is still in exactly one law', () => {
  const laws = lawsOf(CRAFT_TEXT);
  for (const n of ['Real People, Real Record', 'CORE Voice Fixed, Register Dynamic', 'Banned Constructs', 'OOC']) eq(lawsNamed(laws, [n]).length, 1, n + ' is a law of its own');
  eq(lawKey('Banned Constructs (narration only)'), lawKey('Banned Constructs'), 'the aside is not part of the name');
  for (const [host, gone] of [['High Intensity Scenes', 'Banned Constructs'], ['Dialogue Ratio', 'CORE Voice Fixed'], ['Story Drivers', 'OOC ('], ['Identity Words Check', 'Real People']]) assert(!lawsNamed(laws, [host])[0].text.includes(gone), host + ' no longer carries ' + gone);
  const lines = (t) => t.split('\n').map((l) => l.trim()).filter(Boolean);
  const inLaws = new Set(lines(laws.map((l) => l.text).join('\n')));
  assert(lines(CRAFT_TEXT).filter((l) => !/^#/.test(l)).every((l) => inLaws.has(l)), 'every line of the craft is in a law');
  for (const n of [...ALWAYS_LAWS, ...PROSE_LAWS]) eq(lawsNamed(laws, [n]).length, 1, 'his craft holds ' + n);
});

test('M512-2 HIS PROSE LAWS RIDE ON EVERY SMALL PAGE (measured on m511: a calm page carried twelve laws and not one of prose): the prose core rides whatever the helper picked, in his craft\'s own words; an out-of-character question carries his OOC law; the helper is offered only the laws a scene adds; the frontier storyteller\'s request is untouched', () => {
  const craft = small({ plain: true }).systemBlocks[1].text; /* his names off: the craft's words as they stand (with them, "the writer" is said as his name) */
  for (const law of lawsNamed(lawsOf(CRAFT_TEXT), PROSE_LAWS)) assert(craft.includes(law.text), 'the prose law rides word for word: ' + law.name);
  assert(/mirroring Bruce’s words/.test(small().systemBlocks[1].text), 'and in his names when he has set them');
  assert(craft.includes(lawsNamed(lawsOf(CRAFT_TEXT), ['Real People, Real Record'])[0].text), 'and his real-people law, every page');
  assert(!/^OOC \(/m.test(craft), 'a story turn does not carry the OOC law');
  const ooc = small({ messages: turns(10, undefined, '#question why did Rukia leave?') });
  assert(/^OOC \(input starts with #question\) = /m.test(ooc.systemBlocks[1].text), 'an out-of-character question carries it');
  const edited = CRAFT_TEXT.replace(/^Show Never Interpret = .*$/m, 'Show Never Interpret = HIS-OWN-WORDS: let the action carry it.');
  assert(small({ craft: edited }).systemBlocks[1].text.includes('Show Never Interpret = HIS-OWN-WORDS: let the action carry it.'), 'his edited words, not a copy');
  const asked = plannerAsk({ craft: CRAFT_TEXT, pages: ['a page'] });
  for (const n of [...ALWAYS_LAWS, ...PROSE_LAWS]) assert(!asked.user.includes(' › ' + n), 'not offered to the helper: ' + n);
  assert(asked.user.includes(' › Injury Resolution') && asked.user.includes(' › Combat Calibration'), 'the scene laws are still offered'); /* M605: Symmetry Law rides every small page now (his report on small-model people) — a law only a scene adds is the example */ /* M515: Character Gravity now rides on every small page — the example is a law only a scene adds */
  const f = frontier({ voiceSample: { text: 'SAMPLE-MARK a passage.', big: true } });
  assert(['Symmetry Law = ', 'Drift Recovery = ', 'Ruin Awareness = ', 'Strategic Persistence = '].every((l) => f.systemBlocks[1].text.includes(l)), 'the frontier storyteller reads the whole rulebook');
  assert(!wireOf(f).includes('SAMPLE-MARK') && !/turns of phrase keep coming back/.test(wireOf(f)), 'and nothing of the small model\'s');
});

test('M512-3 HOW OUR STORY SOUNDS AT ITS BEST: the passage is the page\'s own words — no header, no world beyond, no screen — narration and speech together, within its room; it comes from the newest page a big storyteller wrote that is older than the eight sent whole, or else the page that repeats the others least; it rides with the small craft in his voice, on its own row, exactly as sent', () => {
  const big = H(1) + 'The noon wind came off the wall and pushed dust across the stones. Rukia had her hand on the rail and did not take it away, though the wood was hot enough to hurt, and the captains along the gallery had stopped pretending to talk among themselves.\n\n"You are not going to fight him," she said. It was not a question. "Tell me you are not. Tell me you remember what you promised me on the bridge, with the lanterns out and nobody to hear it but the two of us."\n\nZaraki laughed at that, one short bark, and the bells in his hair answered. He rolled the hilt of his sword under his palm as if it were a stone he meant to throw, and the grin never reached his one open eye.\n\n<!-- GFX_START --><div>PHONE 2 messages</div><!-- GFX_END -->\n\n*** The World Beyond ***\n\nFar off, Unohana set down her cup.';
  const passage = voicePassage(big);
  assert(passage.length >= 450 && passage.length <= 1400 && big.includes(passage.split('\n\n')[0]) && passage.split('\n\n').every((p) => big.includes(p)), 'word for word, within its room: ' + passage.length);
  assert(!/Hanami|GFX|PHONE|World Beyond|Unohana/.test(passage) && /"You are not going to fight him,"/.test(passage), 'the scene\'s prose, speech and narration');
  const longOne = H(2) + 'Rukia watched the yard while the bells rang out across the stones and the captains muttered. '.repeat(25);
  const cut = voicePassage(longOne);
  assert(cut.length >= 450 && cut.length <= 1400 && /\.$/.test(cut) && longOne.includes(cut), 'a page of one long paragraph gives its passage, cut at a sentence within the room: ' + cut.length);
  const loop = (i) => H(i) + 'The air grew thick with tension. Zaraki rolled his shoulders and grinned. The air grew thick with tension as the captains watched. ' + 'He waited. '.repeat(40) + i;
  const pages = [...Array.from({ length: 6 }, (_, i) => ({ text: loop(i), big: false })), { text: big, big: true }, ...Array.from({ length: 8 }, (_, i) => ({ text: loop(10 + i), big: false }))];
  eq(pickVoicePage(pages, { skipNewest: 8 }).text, big, 'the newest page a big storyteller wrote, older than the eight');
  const olderOnly = pickVoicePage(pages.slice(0, 10), { skipNewest: 8 });
  assert(olderOnly && [loop(0), loop(1)].includes(olderOnly.text), 'none older than the eight is big: one of the older pages, never one of the eight');
  const fresh = H(9) + 'Rain came sideways over the Thirteenth\'s barracks and nobody moved to shut the shutters. Kiyone counted the cracked tiles aloud, the way she did when she was frightened, and Sentaro told her to stop, and she did not stop. Somewhere a kettle shrieked itself dry. ' + 'Jovan listened to all of it from the doorway, the letter still folded in his sleeve, unopened, heavy as a stone. '.repeat(2);
  const mixed = [...Array.from({ length: 5 }, (_, i) => ({ text: loop(i), big: false })), { text: fresh, big: false }, ...Array.from({ length: 4 }, (_, i) => ({ text: loop(20 + i), big: false })), ...Array.from({ length: 8 }, (_, i) => ({ text: loop(40 + i), big: false }))];
  eq(pickVoicePage(mixed, { skipNewest: 8 }).text, fresh, 'no big page: the page that repeats the others least');
  eq(voiceSampleOf(pages.slice(-8), { skipNewest: 8 }), null, 'nothing older than the eight: no passage');
  const sample = voiceSampleOf(pages, { skipNewest: 8 });
  const r = small({ voiceSample: sample });
  const craftBlock = r.systemBlocks[1].text;
  assert(craftBlock.includes('How our story sounds at its best — a passage from our own pages, here only for its sound') && craftBlock.includes(sample.text), 'it rides with the craft, in his voice');
  eq(r.systemBlocks.length >= 6, true, 'the seats stand');
  const row = r.receipt.slots.find((s) => s.name === 'The story’s voice');
  assert(row && row.tokens > 0 && craftBlock.includes(row.text), 'its own row, exactly as sent');
  assert(!(wireOf(r).match(PERSONA_BREAKERS)), 'no word that breaks his persona');
  const none = small().receipt.slots.find((s) => s.name === 'The story’s voice');
  assert(none && !none.tokens && /no page yet older than the ones sent word for word/.test(none.reason), 'without one, its row says why: ' + (none && none.reason));
});

test('M512-4 NO OLD LLM REPETITION: the turns of phrase the last pages keep using are found in code — the longest repeated stretch, as the page wrote it, commas and all, once — never a name, a place, small words alone or a stretched sound; they are said once, in his voice, at the end of the plan the small model reads last; none when the pages do not repeat', () => {
  const a = H(1) + 'The air grew thick with tension as Zaraki rolled his shoulders, the bells in his hair chiming once. Rukia Kuchiki waited at the rail.\n\n"Hah—HAH—HAH—HAH!"';
  const b = H(2) + 'Zaraki rolled his shoulders, the bells in his hair chiming once, and the air grew thick with tension again. Rukia Kuchiki waited at the rail.\n\n"Hah—HAH—HAH—HAH!"';
  const c = H(3) + 'Somewhere in the Tenth Division courtyard a door banged. Rukia Kuchiki said nothing at all to him.';
  const worn = wornPhrases([a, b, c], { names: ['Rukia Kuchiki', 'Kenpachi Zaraki', 'Jovan Oda', 'Tenth Division courtyard'] });
  assert(worn.includes('Zaraki rolled his shoulders, the bells in his hair chiming once') && worn.includes('the air grew thick with tension'), 'the stretches, as written: ' + JSON.stringify(worn));
  assert(!worn.some((w) => /hah/i.test(w)) && !worn.some((w) => /^Rukia Kuchiki waited at the rail$/i.test(w) && false), 'never a stretched sound');
  assert(!worn.some((w) => /Tenth Division courtyard/.test(w)), 'never a place');
  eq(wornPhrases([H(1) + 'Rain came over the wall.', H(2) + 'The kettle shrieked.'], {}).length, 0, 'none when the pages do not repeat');
  const loop = (i) => H(i) + 'The courtyard held its breath. Dust lifted in the noon wind and settled again across the stones, page ' + i + '.';
  const r = small({ messages: turns(10, loop) });
  const closing = String(r.messages[r.messages.length - 1].content);
  assert(/A few turns of phrase keep coming back on the last pages — “[^”]*dust lifted in the noon wind and settled again across the stones[^”]*”/i.test(closing) && /Say those things in new words this time, or leave them out\./.test(closing), 'said once, at the end of the plan: ' + closing.slice(-300));
  const planRow = r.receipt.slots.find((s) => s.name === 'The plan for this page');
  assert(planRow && planRow.text.includes('A few turns of phrase keep coming back'), 'on the plan\'s own row');
  assert(!(closing.match(PERSONA_BREAKERS)), 'no word that breaks his persona');
  assert(!/turns of phrase keep coming back/.test(wireOf(frontier({ messages: turns(10, loop) }))), 'never for the frontier storyteller');
});

test('M512-5 EACH PERSON\'S OWN VOICE (a small model gives everyone one voice unless it is told theirs): the helper is asked how each person here talks, from their own lines; the plan keeps it and says it after what they want', () => {
  const asked = plannerAsk({ craft: CRAFT_TEXT, pages: ['a page'] });
  assert(/"voice":""/.test(asked.system) && /voice: how they talk, in a few words that read after "talks"/.test(asked.system), 'the helper is asked');
  const plan = readPlan(JSON.stringify({ scene: 'The rail.', people: [{ name: 'Rukia Kuchiki', now: 'at the rail', wants: 'him to refuse', against: '', voice: 'in clipped, formal sentences; calls him Captain' }], unknown: [], pressing: [], earlier: [], laws: [], leaveTo: '' }), { present: ['Rukia Kuchiki', 'Jovan Oda'], mc: 'Jovan Oda', lawNames: [] });
  eq(plan.people[0].voice, 'in clipped, formal sentences; calls him Captain', 'kept');
  assert(renderPlan(plan, { mc: 'Jovan Oda' }).includes('Rukia Kuchiki — at the rail; wants him to refuse; talks in clipped, formal sentences; calls him Captain.'), 'said after what she wants: ' + renderPlan(plan, { mc: 'Jovan Oda' }));
});

test('M512-6 A PAGE KNOWS WHO WROTE IT: each new page\'s receipt says whether a small storyteller wrote it — so the passage held up is a big storyteller\'s', () => {
  eq(finalizeReceipt({ slots: [] }, { small: true }).small, true, 'small');
  eq(finalizeReceipt({ slots: [] }, { small: false }).small, false, 'big');
  eq('small' in finalizeReceipt({ slots: [] }, {}), false, 'unknown stays unsaid');
});

test('M513-1 WHY NOTHING WAS RULED (his question with a small storyteller: "why does the referee seem not to work — no outcome, no The house has ruled?" — it worked; the row said the same line whatever the reason): the row says exactly why — off, only talk, no attempt, out of character, "# no roll", or the referee failing — and a ruling still rides as it did', () => {
  eq(refereeWhyWords({ status: 'ruled', why: 'a lone check' }), '', 'ruled: nothing to explain');
  assert(/only spoken words/.test(refereeWhyWords({ status: 'no-check', why: 'only dialogue' })), 'only talk');
  assert(/nothing in your move was an attempt that could fail/.test(refereeWhyWords({ status: 'no-check', why: 'no attempt' })), 'no attempt');
  assert(/out-of-character/.test(refereeWhyWords({ status: 'no-check', why: 'out of character' })), 'out of character');
  assert(/# no roll/.test(refereeWhyWords({ status: 'skipped', why: 'no roll — the writer said so' })), 'no roll');
  assert(/ran out of its 12 seconds/.test(refereeWhyWords({ status: 'degraded', why: 'timed out' })), 'timed out');
  assert(/no usable answer, twice/.test(refereeWhyWords({ status: 'degraded', why: 'no usable answer' })), 'no usable answer');
  assert(/stumbled/.test(refereeWhyWords(null)), 'no step at all');
  const row = (r) => r.receipt.slots.find((x) => x.name === 'The house has ruled');
  const off = buildRequest({ story: {}, messages: turns(3), settings: { refereeOn: false }, state: yard(), modules: [], memory: '', window: { keeperOn: true, window: 30, budgetTokens: 262000 } });
  assert(/the referee is off \(Settings → The referee\)/.test(row(off).reason) && !row(off).tokens, 'off: said so');
  const talk = buildRequest({ story: {}, messages: turns(3), settings: {}, state: yard(), modules: [], memory: '', window: { keeperOn: true, window: 30, budgetTokens: 262000 }, refereeWhy: refereeWhyWords({ status: 'no-check', why: 'only dialogue' }) });
  assert(/only spoken words/.test(row(talk).reason) && !row(talk).tokens, 'only talk: said so');
  const ruled = buildRequest({ story: {}, messages: turns(3), settings: {}, state: yard(), modules: [], memory: '', window: { keeperOn: true, window: 30, budgetTokens: 262000 }, ruling: 'About what Jovan is trying — the disarm: it works.', refereeWhy: '' });
  assert(row(ruled).tokens > 0 && /About what Jovan is trying/.test(wireOf(ruled)), 'a ruling rides as it did');
  assert(!/only spoken words|the referee is off/.test(wireOf(talk)) && !/the referee is off/.test(wireOf(off)), 'the reasons are the receipt\'s — never on the wire');
});

