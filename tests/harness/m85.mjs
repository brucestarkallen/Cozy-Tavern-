/* M85 — the writer's preset, held against the tavern whole: the NSFW law
 * always on, the command table, the voices, the marks a page may carry, the
 * window's format, readable media, and the laws the old reasoning pass
 * alone had carried. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { CRAFT_TEXT, looksLikeImportedCraft } from '../../js/assemble/craft.js';
import { listModules, selectModules, saveModule, removeModule, typedIntimacy } from '../../js/assemble/modules.js';
import { parseCommand, commandChip } from '../../js/commands.js';
import { normalizeBrief, normalizeVoices, renderVoicesBlock, renderWorldBrief, VOICES_MAX } from '../../js/engine/world.js';
import { buildWorldMessages, parseWorldAnswer } from '../../js/agents/world.js';
import { applyMutations } from '../../js/engine/apply.js';
import { emptyState } from '../../js/engine/state.js';
import { applyRules, BUILTIN_RULES } from '../../js/regex.js';
import { looksHtml } from '../../js/ui/richhtml.js';
import { db } from '../../js/store.js';
import { refereeStep } from '../../js/agents/referee.js';

const mkUser = (id, text) => ({ id, role: 'user', pages: [{ text }], page: 0 });
const pageTextOf = (m) => m.pages[m.page].text;
const checkLLM = async () => JSON.stringify({ check: true, kind: 'task', action: 'try the risky thing', tier: 'moderate', circumstance: 0 });

test('M85-1 the people half of the NSFW law rides in the craft always; the rendering half in the intimate rule — never in a SFW prefix', async () => {
  assert(/## Intimacy/.test(CRAFT_TEXT), 'the section exists');
  for (const law of ['Body Veto Root Rule', 'Erotic Momentum Is Not A Filter', 'First Time Realism', 'Power Dynamic', 'Ruin Awareness',
    'Escalation Resets Consent', 'Precedent Compounds', 'Line-Cross Vertigo', 'Limits Are Real', 'Post Scene Continuity', 'Inexperience']) {
    assert(CRAFT_TEXT.includes(law), 'the people half rides always: ' + law);
  }
  /* the break types the old reasoning pass carried */
  assert(/the fighter claws, shoves/.test(CRAFT_TEXT) && /the freezer goes rigid/.test(CRAFT_TEXT) && /the pleaser cries/.test(CRAFT_TEXT), 'character-specific break');
  /* the rendering half is the intimate rule's — situational, out of the cached prefix (M85-002) */
  for (const law of ['Anatomy And Movement =', 'Unique Per Body =', 'Categorical Is Not A Specification =', 'Resolution Floor =', 'Critical Anatomy =', 'Precision Is Not Detachment =', 'Acoustics Are Simulation =', 'Sound Carries =', 'Intimate Dialogue =', 'Sensory Focus =']) {
    assert(!CRAFT_TEXT.includes(law), 'not in the prefix: ' + law);
  }
  const nsfw = (await listModules()).find((m) => m.id === 'nsfw');
  for (const law of ['Anatomy And Movement', 'Unique Per Body', 'Categorical Is Not A Specification', 'Resolution Floor', 'Critical Anatomy', 'Precision Is Not Detachment', 'Acoustics Are Simulation', 'Sound Carries', 'Intimate Dialogue', 'crude first, precise second, euphemism never', 'areola', 'labia']) {
    assert(nsfw.text.includes(law), 'the intimate rule carries: ' + law);
  }
  assert(nsfw.text.length > 4000 && nsfw.text.length < 9000, 'about 1-2k tokens: ' + nsfw.text.length);
  /* the core is bounded — ~17k tokens: what governs EVERY turn — and not mistaken for the old import */
  assert(CRAFT_TEXT.length > 60000 && CRAFT_TEXT.length < 75000, 'about 17k tokens: ' + CRAFT_TEXT.length);
  assert(!looksLikeImportedCraft(CRAFT_TEXT));
  for (const gone of ['{PULSE}', '{WATCHLIST}', 'Plot Momentum', 'Emit Order', '<details>', 'Rendering Markers']) {
    assert(!CRAFT_TEXT.includes(gone), 'still not asked to emit: ' + gone);
  }
});

test('M85-2 the page’s marks, readable media, the laws the pass alone had carried — and what is situational stays OUT of the prefix', async () => {
  /* the craft says only that a command's law arrives with its turn */
  assert(/The Commands = /.test(CRAFT_TEXT) && /arrives with its own law as the house's directive for THAT turn/.test(CRAFT_TEXT), 'the pointer');
  for (const gone of ['Q The Next Scene = ', 'Party Gate = ', 'RIGHT NOW (MC walks into it)', 'Complexity Ratchet', 'Cut Away Quarantine = ', '[Location — Day, Time]']) {
    assert(!CRAFT_TEXT.includes(gone), 'situational law is not in the prefix: ' + gone);
  }
  assert(/## The Page/.test(CRAFT_TEXT) && /Marks On The Page = /.test(CRAFT_TEXT), 'the page’s marks');
  assert(/The Window Beyond The Page = written only when the house opens one/.test(CRAFT_TEXT), 'the window: only when open, in the form the window rule hands over');
  assert(/Readable Media = /.test(CRAFT_TEXT) && /GFX_START/.test(CRAFT_TEXT) && /GFX_END/.test(CRAFT_TEXT), 'readable media as objects');
  /* the window rule: a builtin that wakes when a window is open */
  const mods = await listModules();
  const win = mods.find((m) => m.id === 'world-window');
  assert(win && win.whenKey === 'worldWindow' && /\*\*\* The World Beyond \*\*\*/.test(win.text) && /\[Location — Day, Time\]/.test(win.text) && /Cut Away Quarantine/.test(win.text), 'the window rule carries the exact form and the quarantine');
  const closed = emptyState();
  assert(!selectModules(mods, closed).some((x) => x.mod.id === 'world-window'), 'no window, no rule');
  const open = emptyState(); open.worldBrief = { pressure: [], ripe: [], twb: { who: 'Aurora', where: 'the platform', changed: 'she saw the car' }, atTurn: 3 };
  assert(selectModules(mods, open).some((x) => x.mod.id === 'world-window'), 'a window open, the rule rides');
  /* the laws the old reasoning pass alone had carried */
  for (const law of ['Every MC Action Is An Attempt', 'ASSIST', 'No Hovering', 'Peak Trigger', 'MC Dialogue Is Literal', 'Bodies Feel The Header', 'Anti Melodrama']) {
    assert(CRAFT_TEXT.includes(law), 'restored: ' + law);
  }
  assert(/Therapy speak, psychoanalysis, emotional validation/.test(CRAFT_TEXT), 'no therapy speak');
  assert(/nobody has ever, nobody just, ruin you, don't you dare/.test(CRAFT_TEXT), 'the dead phrases joined the list');
  assert(/never another NPC's private observation as their own/.test(CRAFT_TEXT), 'the dialogue pre-check');
  /* the pass reads the command and the page's marks */
  assert(/B — BEAT: which command's law governs this turn/.test(CRAFT_TEXT) && /the page carries no mark but the header/.test(CRAFT_TEXT));
});

test('M85-3 the intimate rule wakes a beat early on the writer’s own words; spectacle combat is optional and never wakes on its own', async () => {
  const mods = await listModules();
  const nsfw = mods.find((m) => m.id === 'nsfw');
  assert(!/Some welcome, some tolerate, some refuse/.test(nsfw.text), 'the people half lives in the craft, not twice');
  /* the typed-intent read: unambiguous words only */
  for (const yes of ['I pull her onto the bed and undress her', 'I slide between her thighs', 'We have sex', 'I strip him naked', 'he cums']) assert(typedIntimacy(yes), 'intent: ' + yes);
  for (const no of ['fuck off, I tell him', 'I draw my naked blade', 'I kiss her softly', '#question is she naked?', '((is she naked?))', 'I look out at the rain']) assert(!typedIntimacy(no), 'not intent: ' + no);
  const sfw = emptyState();
  assert(!selectModules(mods, sfw).some((x) => x.mod.id === 'nsfw'), 'a SFW turn carries no rendering law');
  const early = { ...emptyState(), turnText: 'I pull her onto the bed and undress her' };
  const sel0 = selectModules(mods, early);
  assert(sel0.some((x) => x.mod.id === 'nsfw' && /writer/.test(x.reason)), 'the writer’s words wake it before the extractor’s flag');
  const flagged = emptyState(); flagged.mode.intimate = true;
  assert(selectModules(mods, flagged).some((x) => x.mod.id === 'nsfw' && /turned intimate/.test(x.reason)), 'the flag wakes it as before');
  const spect = mods.find((m) => m.id === 'spectacle-combat');
  assert(spect && spect.whenKey === 'manual' && /Symmetry Law/.test(spect.text) && /Cornered NPCs/.test(spect.text), 'spectacle sits under the craft’s laws');
  const state = emptyState(); state.mode.combat = true;
  let sel = selectModules(mods, state);
  assert(!sel.some((s) => s.mod.id === 'spectacle-combat'), 'combat alone does not wake it');
  await saveModule({ id: 'spectacle-combat', text: spect.text, name: spect.name, pinned: true, whenKey: 'manual' });
  sel = selectModules(await listModules(), state);
  assert(sel.some((s) => s.mod.id === 'spectacle-combat'), 'pinned, it rides');
  await removeModule('spectacle-combat');
  sel = selectModules(await listModules(), state);
  assert(!sel.some((s) => s.mod.id === 'spectacle-combat'), 'unpinned, it stands down');
});

test('M85-4 the command parser hears the writer’s whole table', () => {
  eq(parseCommand('#q').kind, 'nextScene'); assert(/director/.test(parseCommand('#q').directive) && /RIGHT NOW/.test(parseCommand('#q').directive));
  eq(parseCommand('#Q ').kind, 'nextScene', 'case and trailing space');
  const skip = parseCommand('#time skip 3 days');
  eq(skip.kind, 'timeSkip'); assert(/3 days$/.test(skip.directive) && /Party Gate/.test(skip.directive) && skip.clean === '#time skip 3 days');
  eq(parseCommand('#timeskip').kind, 'timeSkip'); assert(/the next morning$/.test(parseCommand('#timeskip').directive), 'a bare skip goes to the next morning');
  eq(parseCommand('#skip to the tournament finals').kind, 'timeSkip');
  eq(parseCommand('#time').kind, 'time', 'the bare #time still asks the hour');
  const story = parseCommand('#story A mecha tournament in Tokyo, 2037, and a boy who lost his sister to the last one');
  eq(story.kind, 'story'); assert(/No proposals|no proposals/i.test(story.directive)); eq(story.clean, 'A mecha tournament in Tokyo, 2037, and a boy who lost his sister to the last one');
  assert(story.name.length <= 41 && story.name.startsWith('A mecha tournament'), 'the new tale’s title: ' + story.name);
  const win = parseCommand('#Put TWB Aurora');
  eq(win.kind, 'window'); eq(win.name, 'Aurora'); assert(/\*\*\* The World Beyond \*\*\*/.test(win.directive) && /Cut Away Quarantine/.test(win.directive), 'the window’s format and quarantine ride with the turn');
  /* each command carries its WHOLE law on its own turn (M85-002) */
  const q = parseCommand('#q').directive;
  assert(/RIGHT NOW \(MC walks into it\), LATER TODAY/.test(q) && /Complexity Ratchet/.test(q) && /Party Gate/.test(q) && /hot thread agenda -> cold thread returning/.test(q), 'the director’s whole law rides on #q');
  assert(/Party Gate/.test(parseCommand('#time skip 3 days').directive), 'the gate rides with a time skip');
  eq(parseCommand('#twb Kim Kardashian').name, 'Kim Kardashian');
  const pp = parseCommand('#pp');
  eq(pp.kind, 'skip'); assert(/Party Gate/.test(pp.directive) && /cross-cut/.test(pp.directive) && /quarantine holds/.test(pp.directive), '#pp carries the arc-transit law');
  const cont = parseCommand('#continue');
  eq(cont.kind, 'continue'); eq(cont.hidden, true); assert(/no time skip/.test(cont.directive), '#continue plays it forward, hidden as before');
  assert(/No proactive MC/.test(parseCommand('#p').directive));
  assert(/trace, the root cause and the corrected line/.test(parseCommand('#question why did she know?').directive), '#question carries the callout protocol');
  /* the referee's words are recognized, never called unknown */
  eq(parseCommand('#roll I swing').kind, 'referee'); eq(parseCommand('#roll I swing').clean, '#roll I swing', 'the words ride as typed');
  eq(parseCommand('I leave the hall # no roll').chip, 'the referee stands down this turn');
  eq(parseCommand('I leave the hall # roll this').chip, 'the referee rolls this turn');
  eq(parseCommand('I step back # play her as suspicious').kind, null); eq(commandChip('I step back # play her as suspicious'), 'an inline direction — absorbed silently');
  assert(/isn’t a house command/.test(parseCommand('#foo bar').chip), 'an unknown # still passes through, named');
  eq(parseCommand('Hello there').chip, '');
});

test('M85-5 the referee honours "# no roll" and "# roll this" (the preset’s LO Override)', async () => {
  const conn = { type: 'openai' };
  const mk = () => ({ ...emptyState(), turn: 1 });
  const m1 = mkUser('u1', 'I try to force the gate # no roll');
  const down = await refereeStep({ connection: conn, userText: pageTextOf(m1), userId: 'u1', history: [m1], state: mk(), settings: {}, callLLM: checkLLM });
  eq(down.status, 'skipped', '"# no roll" stands the referee down');
  const m2 = mkUser('u2', '#noroll I try to force the gate');
  eq((await refereeStep({ connection: conn, userText: pageTextOf(m2), userId: 'u2', history: [m2], state: mk(), settings: {}, callLLM: checkLLM })).status, 'skipped');
  const m3 = mkUser('u3', 'I look out at the rain # roll this');
  eq((await refereeStep({ connection: conn, userText: pageTextOf(m3), userId: 'u3', history: [m3], state: mk(), settings: {}, callLLM: checkLLM })).status, 'ruled', '"# roll this" asks for a ruling on a quiet beat');
  const m4 = mkUser('u4', '#skip to the next morning');
  const notSkip = await refereeStep({ connection: conn, userText: pageTextOf(m4), userId: 'u4', history: [m4], state: mk(), settings: {}, callLLM: checkLLM });
  assert(notSkip.status !== 'skipped', 'a time skip is not the referee’s #skip');
});

test('M85-6 the voices: the brief’s shape, the block in the writer’s own form, never on the wire', () => {
  const raw = { pressure: [], ripe: [], twb: null, voices: [
    { icon: '🍺', speaker: 'Old Mattis', channel: 'the Drowned Bell · dusk', content: 'Prices up again, and the captain drinking on credit.' },
    { speaker: '-> Renna', content: 'He always pays. Eventually.' },
    { speaker: '', content: 'no speaker — dropped' },
    { speaker: 'A clerk', channel: 'the dispatch office', content: 'x'.repeat(400) },
    { speaker: 'Fourth', content: 'four' }, { speaker: 'Fifth', content: 'a fifth is noise' },
  ] };
  const b = normalizeBrief(raw, 7);
  eq(b.voices.length, VOICES_MAX, 'four at most, the empty speaker dropped');
  eq(b.voices[1].icon, '💬', 'a missing icon is the DM glyph');
  assert(b.voices[2].content.length <= 280, 'content is capped');
  eq(b.empty, undefined, 'a brief with only voices is not empty');
  const block = renderVoicesBlock(b.voices);
  assert(block.startsWith('{VOICES}\n[VOICE: 🍺 | Old Mattis | the Drowned Bell · dusk | Prices up again') && block.endsWith('{/VOICES}'), block);
  assert(block.includes('[VOICE: 💬 | -> Renna | He always pays. Eventually.]'), 'a reply stands on three fields');
  eq(renderWorldBrief(b, 8), '', 'voices alone say nothing to the storyteller');
  const withPressure = normalizeBrief({ pressure: ['Kim could reach the door in ten minutes'], voices: raw.voices }, 7);
  const wire = renderWorldBrief(withPressure, 8);
  assert(/Kim could reach/.test(wire) && !/Old Mattis/.test(wire) && !/VOICE/.test(wire), 'the pressure rides; the voices never do');
  eq(normalizeVoices(null).length, 0);
  /* the 🎨 pack dresses the block the way SillyTavern did */
  const shown = applyRules(block, BUILTIN_RULES, { on: 'storyteller', mode: 'display' });
  assert(shown !== block && looksHtml(shown) && /Voices/.test(shown), 'the fold is dressed');
});

test('M85-7 the world agent asks for the voices, sees the ones already spoken, and its word remembers them', () => {
  const state = { ...emptyState(), turn: 4 };
  const msgs = buildWorldMessages({ state, userText: 'I walk into the market.', assistantText: 'The market is loud.', voicesBefore: [
    [{ icon: '🏪', speaker: 'a fishwife', channel: 'the east market · noon', content: 'Three coppers, not two.' }],
  ] });
  assert(/voices — THE WORLD TALKING TO ITSELF/.test(msgs.system) && /"voices":\[ \.\.\. \]/.test(msgs.system), 'the law and the shape');
  assert(/WORTH REPEATING/.test(msgs.system) && /Bystanders/.test(msgs.system) && /NEAR-ALWAYS/.test(msgs.system), 'the preset’s own rules');
  assert(/VOICES ALREADY SPOKEN/.test(msgs.user) && /a fishwife \(the east market · noon\): Three coppers/.test(msgs.user), 'rotation against what was heard');
  const read = parseWorldAnswer(JSON.stringify({ mutations: [], brief: { pressure: [], ripe: [], twb: null, voices: [{ icon: '🏪', speaker: 'a fishwife', channel: 'the east market · noon', content: 'Three coppers.' }] } }));
  eq(read.note, 'ok');
  const { state: next, applied } = applyMutations(state, [{ type: 'world.word', brief: read.brief }]);
  eq(next.worldBrief.voices.length, 1, 'the word carries the voices');
  assert(/1 voice heard elsewhere/.test(applied[0].words), applied[0].words);
});

test('M85-8 a page keeps the voices it was given; readable media unwraps for the thread through the allowlist', async () => {
  const story = await db.stories.create({ title: 'the voices' });
  const page = await db.messages.append(story.id, { role: 'assistant', text: 'A page.', voices: [{ icon: '🍺', speaker: 'Mattis', channel: 'the bar', content: 'Hm.' }, { speaker: 'x', content: '' }] });
  eq(page.voices.length, 1, 'a voice without content is dropped; the rest ride');
  const updated = await db.messages.update(story.id, page.id, { voices: [] });
  eq(updated.voices.length, 0, 'a later read that heard nothing clears them');
  await db.stories.remove(story.id);
  const rule = BUILTIN_RULES.find((r) => r.id === 'style-readable-media');
  assert(rule && rule.mode === 'display' && rule.on === 'storyteller' && rule.enabled === true, 'the rule ships on');
  const text = 'He unlocks the phone.\n<!-- GFX_START -->\n<div style="background:#121212;color:#fff;border-radius:20px;"><b>Kim</b><div>where r u</div></div>\n<!-- GFX_END -->\nHe pockets it.';
  const shown = applyRules(text, BUILTIN_RULES, { on: 'storyteller', mode: 'display' });
  assert(!/GFX_START|GFX_END/.test(shown) && /where r u/.test(shown) && looksHtml(shown), 'the marks are gone, the object stays, the thread draws it');
  const page2 = applyRules(text, BUILTIN_RULES, { on: 'storyteller', mode: 'page' });
  assert(/GFX_START/.test(page2), 'the page itself keeps its words — the media is canon');
});

test('M86-1 the absent are ranked by who can reach the scene (the writer’s ACW rotation), never by recency alone; the living world is not the first thing the budget drops', async () => {
  const { seat, renderOffscreen } = await import('../../js/engine/offscreen.js');
  const { renderStateFacts, STATE_BUDGET } = await import('../../js/engine/state.js');
  let o = {};
  o = seat(o, 'Old Neighbor', { location: 'his porch', activity: 'smoking', agenda: 'complain', stance: 'waiting' }, 600, 9);
  o = seat(o, 'Kim', { location: 'the highway', activity: 'driving', agenda: 'find him', stance: 'seeking', etaMinutes: 40 }, 600, 8);
  o = seat(o, 'Aurora', { location: 'the platform', activity: 'walking', agenda: 'reach him', stance: 'toward', etaMinutes: 12 }, 600, 3);
  o = seat(o, 'Renna', { location: 'the hall', activity: 'arguing', agenda: 'win', stance: 'busy' }, 600, 10);
  o = seat(o, 'Volkov', { location: 'his office', activity: 'on the phone', agenda: 'confront him', stance: 'tense' }, 600, 7);
  const lines = renderOffscreen(o, [], 605).split('\n');
  assert(/^Aurora/.test(lines[0]) && /^Kim/.test(lines[1]) && /^Volkov/.test(lines[2]) && /^Renna/.test(lines[3]) && /^Old Neighbor/.test(lines[4]), lines.join(' | '));
  /* seven seated, six shown: the one left out is the least able to reach the scene, not the oldest */
  o = seat(o, 'Far Cousin', { location: 'another city', activity: 'sleeping', agenda: 'nothing yet', stance: 'waiting' }, 600, 1);
  o = seat(o, 'Runner', { location: 'the stairs', activity: 'running', agenda: 'warn him', stance: 'toward', etaMinutes: 2 }, 600, 0);
  const six = renderOffscreen(o, [], 605).split('\n');
  eq(six.length, 6); assert(/^Runner/.test(six[0]) && !six.some((l) => /^Far Cousin/.test(l)), six.join(' | '));
  /* the budget's knife: with the ledger overfull, the arrivals outlive the standings and the factions */
  const st = emptyState();
  st.clock = { calendar: 'gregorian', minutes: 605, label: '' };
  st.offscreen = o;
  st.factions = { 'the studio': { stance: 'furious', agenda: 'bury it', move: 'sent a lawyer', atTurn: 1 } };
  for (let i = 0; i < 6; i += 1) st.relationships['Person' + i] = { p: 40 - i, r: 0, s: 0 };
  st.threads = [{ title: 'the letter', owner: 'Kim', heat: 'hot', next: 'corner him before Liara leaves the party tonight', atTurn: 2 }, { title: 'the money', owner: 'Volkov', heat: 'hot', next: 'call the studio and name a number he cannot refuse', atTurn: 2 }];
  for (let i = 0; i < 16; i += 1) st.present.push({ name: 'Guest' + i, position: 'standing at the long table by the far window', attire: 'a dark coat' });
  for (let i = 0; i < 16; i += 1) {
    st.canon['Guest' + i] = { facts: [{ key: 'eyes', value: 'grey, one clouded from a childhood fever', atMinutes: 0 }, { key: 'home', value: 'the tenements past the east gate', atMinutes: 0 }] };
    st.knowledge['Guest' + i] = [{ fact: 'saw the captain leave with the ledger under his coat', atTurn: 3 }];
  }
  const facts = renderStateFacts(st);
  assert(facts.length <= STATE_BUDGET, 'the budget holds: ' + facts.length);
  /* the crowd-scaling sections were trimmed, not the living world shed */
  assert(/more present, not written here/.test(facts), 'the crowd was trimmed: ' + facts.length);
  assert(/Elsewhere:/.test(facts) && /Runner/.test(facts) && /Aurora/.test(facts), 'the arrivals survive');
  assert(/Threads still open:/.test(facts) && /Factions:/.test(facts), 'the threads and the factions survive');
  assert(/Guest0 — eyes/.test(facts) && !/Guest15 — eyes/.test(facts), 'the first present keep their facts; the sixteenth is counted, not written');
  /* still overfull after trimming: the factions go before the arrivals */
  for (let i = 0; i < 12; i += 1) st.offscreen = seat(st.offscreen, 'Traveler' + i, { location: 'the long road past the mill and the drowned fields', activity: 'walking with the mule and the cart', agenda: 'sell the winter grain at the market before the frost', stance: 'busy' }, 600, 20 + i);
  for (let i = 0; i < 6; i += 1) st.threads.push({ title: 'thread ' + i, owner: 'Traveler' + i, heat: 'hot', next: 'do the long thing they were going to do before the frost comes to the fields', atTurn: 2 });
  const tight = renderStateFacts(st);
  assert(tight.length <= STATE_BUDGET, 'the budget still holds: ' + tight.length);
  assert(/Runner/.test(tight), 'the arrival outlives the knife: ' + tight.slice(0, 200));
  assert(!/Factions:/.test(tight), 'the factions went first');
});

test('M88-1 the house’s eye: the craft’s mechanical laws checked in code — ghost dialogue, echo, the dead phrases, the marks, the header; clean pages pass', async () => {
  const { lintPage, houseEyeWords } = await import('../../js/agents/lint.js');
  const hdr = '[The house on Elm — Friday, March 14, 2025 | 14:20 | 🌤 clear | hoodie | at the table]\n\n';
  const ghost = lintPage({ mc: 'Jovan', userText: 'I shrug.', assistantText: hdr + '"You came back," she says. "Yeah, I guess I did," Jovan says, and shrugs.' });
  assert(ghost.findings.some((f) => f.law === 'Ghost Dialogue' && /Yeah, I guess I did/.test(f.words)), 'a line put in MC’s mouth is caught');
  const typed = lintPage({ mc: 'Jovan', userText: '"I am not leaving," I tell her.', assistantText: hdr + '"I am not leaving," Jovan says. She stares. "Then sit," she says.' });
  assert(!typed.findings.some((f) => f.law === 'Ghost Dialogue'), 'the writer’s own line is not a ghost');
  assert(!typed.findings.some((f) => f.law === 'Header Protocol'), 'the header is seen');
  const echo = lintPage({ mc: 'Jovan', userText: '"I am not leaving."', assistantText: hdr + '"I am not leaving," Jovan says. She hears it: "I am not leaving," and the words hang.' });
  assert(echo.findings.some((f) => f.law === 'No Echo'), 'the typed line rendered twice is caught');
  const marks = lintPage({ mc: 'Jovan', userText: 'I wait.', assistantText: '## The Kitchen\n\n**He waits.** *he steps closer to her* Her breath hitching. ~t~*never*' });
  const laws = marks.findings.map((f) => f.law);
  for (const law of ['Header Protocol', 'Marks On The Page', 'Sound As Onomatopoeia', 'Banned Words', 'NPC Private Thoughts']) assert(laws.includes(law), 'caught: ' + law);
  assert(!marks.findings.some((f) => /SLAP/.test(f.words)), 'a sound in asterisks is never an action');
  const sound = lintPage({ mc: 'Jovan', userText: 'I wait.', assistantText: hdr + 'She hits him. *SLAP!* Then *thud thud thud* on the stairs. ~t~*He will not stay.*~/t~ She turns.' });
  eq(sound.findings.length, 0, 'a clean page passes: ' + JSON.stringify(sound.findings));
  const ooc = lintPage({ mc: 'Jovan', userText: '#question why?', assistantText: 'Because she saw him leave.', ooc: true });
  eq(ooc.findings.length, 0, 'an OOC answer is not a page');
  const eye = houseEyeWords(ghost.findings);
  assert(/recolor forward THIS turn/.test(eye) && /Ghost Dialogue/.test(eye) && /Never lampshade/.test(eye), 'the eye’s words carry the preset’s callout law');
  eq(houseEyeWords(sound.findings), '', 'a clean page says nothing');
  eq(houseEyeWords([{ words: 'x', severity: 'note', kind: 'craft' }]), '', 'a note never nags');
});

test('M88-2 the eye rides the storyteller’s next turn as its own receipt-named slot, and only then', async () => {
  const { buildRequest } = await import('../../js/assemble/stack.js');
  const { listModules, selectModules } = await import('../../js/assemble/modules.js');
  const state = emptyState();
  const mods = selectModules(await listModules(), state);
  const base = { story: { id: 's', title: 't' }, messages: [{ role: 'user', text: 'I wait.' }, { role: 'assistant', text: 'A page.' }], settings: {}, state, modules: mods, memory: '', cast: [], lore: '', window: { keeperOn: true, window: 30 } };
  const withEye = buildRequest({ ...base, houseEye: 'The house\'s eye on the last page — slips: ghost dialogue.' });
  const slot = withEye.receipt.slots.find((s) => s.name === 'The house’s eye');
  assert(slot && slot.tokens > 0, 'the slot rides');
  const injected = withEye.messages.find((m) => m.role === 'user' && /\[story-state\]/.test(m.content));
  assert(injected && /The house's eye on the last page/.test(injected.content), 'it rides the dynamic tail, never the cached prefix');
  assert(!withEye.systemBlocks.some((b) => /house's eye on the last page/.test(b.text)), 'not in the system blocks');
  const without = buildRequest({ ...base, houseEye: '' });
  assert(!without.receipt.slots.some((s) => s.name === 'The house’s eye'), 'a clean last page: no slot at all');
});
