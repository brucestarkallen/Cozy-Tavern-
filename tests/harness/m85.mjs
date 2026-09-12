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

test('M90-1 the record’s corrections: written by the house, read last, never folded, never verified, deduplicated, capped', async () => {
  const { addCorrection, renderMemory, recordFor, wholeRecord, loadMemory, saveMemory, CORRECTIONS_MAX } = await import('../../js/agents/memory.js');
  let mem = { window: 30, nodes: [
    { id: 'a', span: [0, 2], text: 'Jovan came home; Kim texted.', level: 1, at: 1 },
    { id: 'b', span: [3, 5], text: 'Aurora arrived and called Kim his cousin.', level: 1, at: 2 },
  ] };
  mem = addCorrection(mem, 'Kim is Jovan’s sister, not his cousin (the brief establishes it).');
  mem = addCorrection(mem, 'Kim is Jovan’s sister, not his cousin (the brief establishes it).');
  eq(mem.nodes.filter((n) => n.correction).length, 1, 'said twice is one line');
  const c = mem.nodes.find((n) => n.correction);
  eq(c.span[0], -1, 'covers no page'); assert(/^\[Correction\] Kim is/.test(c.text));
  const lines = renderMemory(mem).split('\n').filter((l) => /^- /.test(l));
  assert(/Correction/.test(lines[lines.length - 1]) && /came home/.test(lines[0]), 'the correction reads LAST: ' + lines.join(' | '));
  assert(/Correction/.test(wholeRecord(mem)), 'the whole record carries it');
  /* a store round trip keeps the mark */
  await saveMemory('corr-story', mem);
  const back = await loadMemory('corr-story');
  assert(back.nodes.some((n) => n.correction === true && n.span[0] === -1), 'the mark survives the store');
  /* capped: the oldest go */
  mem.nodes.find((n) => n.correction).at = 500;
  for (let i = 0; i < CORRECTIONS_MAX + 3; i += 1) { mem = addCorrection(mem, 'correction number ' + i); mem.nodes.find((n) => n.correction && n.text.endsWith('number ' + i)).at = 1000 + i; }
  eq(mem.nodes.filter((n) => n.correction).length, CORRECTIONS_MAX, 'never more than the cap');
  assert(!mem.nodes.some((n) => /Kim is Jovan/.test(n.text)), 'the oldest correction went first');
});

test('M90-2 the auditor reads "the brief wins": a pages issue with a fix is fixable; a brief-vs-brief contradiction is only noted; the run words say what was mended', async () => {
  const { parseAuditorAnswer, auditRunWords } = await import('../../js/agents/auditor.js');
  const read = parseAuditorAnswer(JSON.stringify({ issues: [
    { what: 'the pages call Kim his cousin; the brief says sister', fix: 'Kim is Jovan’s sister', pages: true, mutations: [{ type: 'canon.lock', name: 'Kim', key: 'relation', value: 'Jovan’s sister' }] },
    { what: 'the brief says both 19 and 21 for Kim', fix: '', mutations: [] },
  ] }));
  eq(read.note, 'ok'); eq(read.issues[0].pages, true); eq(read.issues[1].pages, false);
  const words = auditRunWords({ note: 'ok', issues: read.issues, applied: [{ words: 'Kim: relation locked' }], rejected: [], mendedPages: 2 });
  assert(/found 2 things/.test(words) && /1 the brief wins — 2 pages mended, the record corrected/.test(words) && /1 seen, nothing to change/.test(words), words);
});

test('M92-1 knowledge never holds the same fact twice — quotes, full stops and clippings are one fact; a store that gathered duplicates is clean on load', async () => {
  const { addKnowledge, sameFact, dedupeKnowledge } = await import('../../js/engine/world.js');
  const { loadState, saveState } = await import('../../js/engine/state.js');
  let k = {};
  k = addKnowledge(k, 'Rias Wells', 'Jovan agreed to come to Vanessa’s party with her on Saturday.', 3);
  k = addKnowledge(k, 'Rias Wells', "Jovan agreed to come to Vanessa's party with her on Saturday", 4);
  k = addKnowledge(k, 'Rias Wells', 'Jovan agreed to come to Vanessa’s party', 5);
  k = addKnowledge(k, 'Rias Wells', 'saw the captain leave', 6);
  eq(k['Rias Wells'].length, 2, 'the party fact once, the captain once: ' + JSON.stringify(k));
  assert(!sameFact('saw him leave', 'saw him leave the hall at dusk'), 'a short fact is not a clipping of a long one');
  assert(sameFact('Jovan agreed to come to Vanessa’s party with her', 'Jovan agreed to come to Vanessa’s party with her on Saturday'), 'a clipping is the same fact');
  const st = { ...(await loadState('dupe-story')), knowledge: { Rias: [{ fact: 'Jovan agreed to come to Vanessa’s party with her on Saturday', atTurn: 1 }, { fact: 'Jovan agreed to come to Vanessa’s party with her on Saturday', atTurn: 2 }, { fact: 'other', atTurn: 3 }] } };
  await saveState('dupe-story', st);
  const back = await loadState('dupe-story');
  eq(back.knowledge.Rias.length, 2, 'the duplicate folded on load');
  eq(JSON.stringify(dedupeKnowledge({})), '{}');
});

test('M92-2 the extractor is asked again, once, when its answer forgot the mood board; the answer with the board stands', async () => {
  const { extractTurn } = await import('../../js/agents/extractor.js');
  const { withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  let calls = 0; let secondAsk = '';
  const house = { fetch: async (url, opts) => {
    calls += 1;
    const body = JSON.parse(opts.body);
    const lastMsg = body.messages[body.messages.length - 1].content;
    if (calls === 2) secondAsk = lastMsg;
    const answer = calls === 1
      ? '{"mutations":[{"type":"presence.enter","name":"Rias"}]}'
      : '{"mutations":[{"type":"presence.enter","name":"Rias"},{"type":"mode.snapshot","flags":[]}]}';
    const text = 'data: ' + JSON.stringify({ choices: [{ delta: { content: answer } }] }) + '\n\ndata: [DONE]\n\n';
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } });
    return { ok: true, status: 200, headers: new Headers(), body: stream, clone() { return this; }, async json() { return {}; }, async text() { return text; } };
  } };
  const read = await withHouse(house, () => extractTurn({ connection: HOUSES[0].conn, state: emptyState(), userText: 'I wait.', assistantText: '[X — Friday, March 14, 2025 | 14:20 | clear | hoodie | seated]\n\nRias walks in and sits.' }));
  eq(calls, 2, 'asked twice: the second time for the board');
  assert(/named no mode\.snapshot/.test(secondAsk), 'the second ask names the miss');
  assert(read.mutations.some((m) => m.type === 'mode.snapshot'), 'the answer with the board stands');
  /* an answer that carries the board goes through on the first ask */
  calls = 0;
  const once = { fetch: async (url, opts) => {
    calls += 1;
    const answer = '{"mutations":[{"type":"presence.enter","name":"Rias"},{"type":"mode.snapshot","flags":["group"]}]}';
    const text = 'data: ' + JSON.stringify({ choices: [{ delta: { content: answer } }] }) + '\n\ndata: [DONE]\n\n';
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } });
    return { ok: true, status: 200, headers: new Headers(), body: stream, clone() { return this; }, async json() { return {}; }, async text() { return text; } };
  } };
  await withHouse(once, () => extractTurn({ connection: HOUSES[0].conn, state: emptyState(), userText: 'I wait.', assistantText: 'Rias sits.' }));
  eq(calls, 1, 'one ask when the board came');
});

test('M95-1 no worker prompt names a real person or a story-like example; a placeholder never becomes a person; the leaked example family is swept unless the brief names them', async () => {
  const { readFileSync } = await import('node:fs');
  const files = ['extractor', 'world', 'auditor', 'scribe', 'founder', 'rebuild', 'housekeeper', 'continuity'];
  for (const f of files) {
    const src = readFileSync(new URL('../../js/agents/' + f + '.js', import.meta.url), 'utf8');
    const prompt = src.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    assert(!/Kris Jenner|Kendall|Kardashian|Khlo|Kourtney|Kylie|Dmitri Volkov|Aurora Sterling/.test(prompt), f + ': no real family, no old example names in the prompt text');
    assert(!/"name":"(Mira|Mara|Samantha|Liara|Aurora|Rias|Jovan)"/.test(prompt), f + ': no story-like names in the JSON examples');
  }
  for (const f of ['extractor', 'world', 'auditor', 'founder', 'scribe']) {
    const src = readFileSync(new URL('../../js/agents/' + f + '.js', import.meta.url), 'utf8');
    assert(/PLACEHOLDERS: NAME, OTHER NAME/.test(src), f + ': the placeholder law is taught');
  }
  const { applyMutations, placeholderIn } = await import('../../js/engine/apply.js');
  const { exampleLeakHousekeeping } = await import('../../js/agents/auditor.js');
  const st = emptyState();
  const { applied, rejected } = applyMutations(st, [
    { type: 'people.set', name: 'NAME', field: 'core', text: 'x' },
    { type: 'offscreen.set', name: 'Other Name', location: 'x', activity: 'y' },
    { type: 'thread.set', title: 'NAME and the letter', owner: 'NAME', next: 'z' },
    { type: 'presence.enter', name: 'Rias Wells' },
  ]);
  eq(rejected.length, 3, 'three placeholders refused: ' + rejected.map((r) => r.why).join(' | '));
  eq(applied.length, 1, 'the real name lands');
  eq(placeholderIn({ type: 'x', name: 'main character' }), 'main character');
  /* the family that leaked from an older coat is swept — unless the brief names them */
  let leaked = emptyState();
  leaked = applyMutations(leaked, [
    { type: 'people.set', name: 'Kris Jenner', field: 'core', text: 'the mother' },
    { type: 'offscreen.set', name: 'Kris Jenner', location: 'Calabasas', activity: 'calling' },
    { type: 'rel.set', name: 'Kris Jenner', p: 10, r: 0, s: 0, cause: 'x' },
    { type: 'people.set', name: 'Rias Wells', field: 'core', text: 'the neighbour' },
  ]).state;
  const sweep = exampleLeakHousekeeping(leaked, 'Jovan and Rias Wells, Elm Street.', '');
  const kinds = sweep.map((m) => m.type + ':' + m.name).sort();
  eq(kinds.join(','), 'people.forget:Kris Jenner', 'forgotten for good, once — never a tombstone (M96): ' + kinds.join(', '));
  assert(!sweep.some((m) => /Rias/.test(m.name)), 'the story’s own people stand');
  eq(exampleLeakHousekeeping(leaked, 'Jovan dates Kendall Jenner; her mother Kris Jenner disapproves.', '').length, 0, 'named in the brief, she is the story’s');
  const { state: after, applied: gone } = applyMutations(leaked, sweep);
  assert(!after.characters['Kris Jenner'] && !after.offscreen['Kris Jenner'] && !after.relationships['Kris Jenner'], 'page, seat and standing are gone — no trace');
  assert(after.characters['Rias Wells'], 'the neighbour stands');
  /* and the whole of it comes back on a take-back */
  const { undoLast } = await import('../../js/engine/apply.js');
  const back = undoLast(after);
  assert(back && back.state.characters['Kris Jenner'] && back.state.offscreen['Kris Jenner'] && back.state.relationships['Kris Jenner'].p === 10, 'forget is take-back-able whole');
  /* forget refuses a placeholder and a stranger */
  eq(applyMutations(after, [{ type: 'people.forget', name: 'NAME' }]).rejected.length, 1);
  assert(/nothing is written of/.test(applyMutations(after, [{ type: 'people.forget', name: 'Nobody Here' }]).rejected[0].why));
});

test('M98-1 the world can reach the scene by phone, text or note, and the people an absent person talks to exist from then on', async () => {
  const { buildWorldMessages } = await import('../../js/agents/world.js');
  const m = buildWorldMessages({ state: emptyState(), userText: 'I wait.', assistantText: 'The kettle clicks.' });
  assert(/a CALL, a TEXT or a[\s\S]{1,8}NOTE from an absent person with a live want/.test(m.system), 'a call or a text is a pressure');
  assert(/A person need not[\s\S]{1,8}walk to the scene to reach it/.test(m.system), 'reach without walking');
  assert(/talks to someone off the page[\s\S]*that someone exists from then on/.test(m.system), 'the friend talked to becomes a person');
});

test('M100-1 the ripple: one fact changed by an edit is made true everywhere — a name in code with word boundaries across the ledger, a value left to the mender', async () => {
  const { factChange, isNameLike, replaceWord, hasWord, renameInState } = await import('../../js/agents/ripple.js');
  const { applyMutations, undoLast } = await import('../../js/engine/apply.js');
  eq(JSON.stringify(factChange('Kim sat by the fire.', 'Kris sat by the fire.')), '{"removed":"Kim","added":"Kris"}', 'a name changed, whole words');
  eq(JSON.stringify(factChange('Her hair was black and long.', 'Her hair was silver and long.')), '{"removed":"black","added":"silver"}');
  eq(factChange('same', 'same'), null);
  eq(factChange('Kim sat by the fire and read.', 'Kris stood at the window and wept, then left the house for good.'), null, 'a rewrite is not a fact');
  assert(isNameLike('Kris') && isNameLike('Rias Wells') && isNameLike('The House on Elm') && !isNameLike('black') && !isNameLike('19'));
  eq(replaceWord('Kim, Kimberly and Kim’s coat', 'Kim', 'Kris'), 'Kris, Kimberly and Kris’s coat', 'word boundaries: Kimberly stands, the possessive follows');
  assert(hasWord('a note for Kim.', 'Kim') && !hasWord('Kimberly', 'Kim'));
  let st = emptyState();
  st = applyMutations(st, [
    { type: 'mc.set', name: 'Jovan' },
    { type: 'presence.enter', name: 'Kim', position: 'by the door' },
    { type: 'people.set', name: 'Kim', field: 'core', text: 'Jovan’s sister; Kim keeps the house' },
    { type: 'rel.shift', name: 'Kim', axis: 'p', delta: 10, cause: 'the page' },
    { type: 'canon.lock', name: 'Kim', key: 'hair', value: 'black' },
    { type: 'knowledge.add', name: 'Rias', fact: 'saw Kim leave' },
    { type: 'thread.set', title: 'Kim and the letter', owner: 'Kim', heat: 'hot', next: 'Kim will ask' },
    { type: 'offscreen.set', name: 'Rias', location: 'the porch', activity: 'waiting for Kim' },
  ]).state;
  const r = applyMutations(st, [{ type: 'people.rename', from: 'Kim', to: 'Kris', cause: 'the writer’s edit' }]);
  eq(r.rejected.length, 0, JSON.stringify(r.rejected));
  const after = r.state;
  assert(after.characters.Kris && !after.characters.Kim && /Kris keeps the house/.test(after.characters.Kris.core), 'the page moved and its words follow');
  assert(after.relationships.Kris && after.relationships.Kris.p === 10 && !after.relationships.Kim, 'the standing moved');
  assert(after.canon.Kris && !after.canon.Kim, 'the locks moved');
  assert(after.present.some((p) => p.name === 'Kris') && !after.present.some((p) => p.name === 'Kim'), 'presence moved');
  assert(/saw Kris leave/.test(after.knowledge.Rias[0].fact), 'a fact naming her follows');
  assert(after.threads[0].owner === 'Kris' && after.threads[0].title === 'Kris and the letter' && /Kris will ask/.test(after.threads[0].next), 'the thread follows');
  assert(/waiting for Kris/.test(after.offscreen.Rias.activity), 'an absent person’s note follows');
  const back = undoLast(after);
  assert(back && back.state.characters.Kim && !back.state.characters.Kris && back.state.relationships.Kim.p === 10, 'a rename is taken back whole');
  assert(/the same name/.test(applyMutations(st, [{ type: 'people.rename', from: 'Kim', to: 'kim' }]).rejected[0].why));
  assert(/nothing in the ledger/.test(applyMutations(st, [{ type: 'people.rename', from: 'Nobody', to: 'Someone' }]).rejected[0].why));
});

test('M103-1 seats have a life in code: a passer-through the world agent kept seated is cleared and retired once nothing carries them; the carried stay; the pool is capped', async () => {
  const { seatHousekeeping, SEAT_MENTION_PAGES, SEAT_FRESH_TURNS, SEAT_CAP } = await import('../../js/agents/auditor.js');
  const { applyMutations } = await import('../../js/engine/apply.js');
  let st = { ...emptyState(), turn: 40 };
  st = applyMutations(st, [
    { type: 'mc.set', name: 'Jovan' },
    { type: 'people.set', name: 'Wendell', field: 'core', text: 'a cab driver' },
    { type: 'offscreen.set', name: 'Wendell', location: 'the boardwalk', activity: 'parked', agenda: 'one clean fare', stance: 'waiting' },
    { type: 'people.set', name: 'Rias Wells', field: 'core', text: 'the neighbour' },
    { type: 'offscreen.set', name: 'Rias Wells', location: 'the kitchen', activity: 'cooking', agenda: 'feed him', stance: 'busy' },
    { type: 'rel.shift', name: 'Rias Wells', axis: 'p', delta: 12, cause: 'the page' },
    { type: 'offscreen.set', name: 'Aurora', location: 'the bus', activity: 'riding', agenda: 'reach him', stance: 'toward', etaMinutes: 20 },
    { type: 'offscreen.set', name: 'Kim', location: 'her flat', activity: 'texting', agenda: 'get an answer', stance: 'waiting' },
    { type: 'thread.set', title: 'Kim and the letter', owner: 'Kim', heat: 'hot', next: 'text again' },
    { type: 'offscreen.set', name: 'Sophie Dale', location: 'her house', activity: 'texting Emilia', agenda: 'keep Emilia out of the violin', stance: 'busy' },
    { type: 'offscreen.set', name: 'Mi-na Song', location: 'her city', activity: 'reviewing files', agenda: 'set the siblings up', stance: 'busy' },
  ]).state;
  /* the seats were made long ago */
  for (const k of Object.keys(st.offscreen)) st.offscreen[k].atTurn = 10;
  const pages = [{ role: 'assistant', text: 'Sophie texted Emilia again about the party.' }];
  const sweep = seatHousekeeping(st, { brief: 'Jovan comes home; Mi-na Song is the guardian.', castNotes: '', pages });
  const cleared = sweep.filter((m) => m.type === 'offscreen.clear').map((m) => m.name).sort();
  eq(cleared.join(','), 'Wendell', 'only the cab driver goes — the standing, the thread, the clock, the brief, and a recent mention each keep a seat: ' + JSON.stringify(sweep));
  assert(sweep.some((m) => m.type === 'people.retire' && m.name === 'Wendell'), 'and his page retires at once, not in thirty turns');
  /* a fresh seat stands even with nothing else */
  st.offscreen.Wendell.atTurn = st.turn - SEAT_FRESH_TURNS + 1;
  eq(seatHousekeeping(st, { pages }).filter((m) => m.name === 'Wendell').length, 0, 'seated just now, he stands');
  st.offscreen.Wendell.atTurn = 10;
  /* the cap: many carried seats, the least reachable go first, never the brief's people */
  let big = { ...emptyState(), turn: 40 };
  const muts = [{ type: 'mc.set', name: 'Jovan' }];
  for (let i = 0; i < SEAT_CAP + 3; i += 1) muts.push({ type: 'offscreen.set', name: 'Guest' + i, location: 'town', activity: 'waiting', agenda: 'x', stance: i < 2 ? 'toward' : 'waiting', etaMinutes: i < 2 ? 15 : undefined });
  big = applyMutations(big, muts).state;
  for (const k of Object.keys(big.offscreen)) big.offscreen[k].atTurn = 39; /* all fresh — all carried */
  const capped = seatHousekeeping(big, { brief: 'Guest14 is the landlord.', pages: [] });
  eq(capped.filter((m) => m.type === 'offscreen.clear').length, 3, 'three over the cap go');
  assert(!capped.some((m) => m.name === 'Guest0' || m.name === 'Guest1'), 'the ones on the clock stay');
  assert(!capped.some((m) => m.name === 'Guest14'), 'the brief’s person is never capped out');
  eq(SEAT_MENTION_PAGES, 12);
});

test('M104-1 carriedBy says in words why a person is carried — in the scene, the brief, a standing, a thread, on the way, a recent page, seated just now — or nothing', async () => {
  const { carriedBy } = await import('../../js/agents/auditor.js');
  const { applyMutations } = await import('../../js/engine/apply.js');
  let st = { ...emptyState(), turn: 40 };
  st = applyMutations(st, [
    { type: 'mc.set', name: 'Jovan' },
    { type: 'presence.enter', name: 'Rias Wells' },
    { type: 'rel.shift', name: 'Miranda', axis: 'r', delta: 15, cause: 'the page' },
    { type: 'thread.set', title: 'Kim and the letter', owner: 'Kim', heat: 'hot', next: 'text' },
    { type: 'offscreen.set', name: 'Aurora', location: 'the bus', activity: 'riding', agenda: 'reach him', stance: 'toward', etaMinutes: 20 },
    { type: 'offscreen.set', name: 'Wendell', location: 'the boardwalk', activity: 'parked', agenda: 'a fare', stance: 'waiting' },
  ]).state;
  st.offscreen.Wendell.atTurn = 1;
  const opts = { brief: 'Mi-na Song is the guardian.', castNotes: '', pages: [{ role: 'assistant', text: 'Sophie texted again.' }] };
  eq(carriedBy(st, 'Rias Wells', opts), 'in the scene');
  eq(carriedBy(st, 'Mi-na Song', opts), 'the brief names them');
  eq(carriedBy(st, 'Miranda', opts), 'a standing toward the main character');
  eq(carriedBy(st, 'Kim', opts), 'an open thread');
  eq(carriedBy(st, 'Aurora', opts), 'on the way to the main character');
  eq(carriedBy(st, 'Sophie', opts), 'named on a recent page');
  eq(carriedBy(st, 'Wendell', opts), '', 'nothing carries the cab driver');
  st.offscreen.Wendell.atTurn = st.turn;
  eq(carriedBy(st, 'Wendell', opts), 'seated just now');
});

test('M108-1 the world does not bend: the law is in the craft; the eye notes an accord tell and warns at two', async () => {
  const { readFileSync } = await import('node:fs');
  const craft = readFileSync(new URL('../../js/assemble/craft.js', import.meta.url), 'utf8');
  assert(/The World Does Not Bend = the main character is not the world\x27s favourite/.test(craft) && /Accord tells are banned/.test(craft), 'the law rides in the craft');
  const { lintPage } = await import('../../js/agents/lint.js');
  const one = lintPage({ assistantText: '[X — Friday, March 14, 2025 | 14:20 | clear | hoodie | seated]\n\n"You\'re right," she said, and left.', userText: 'I speak.' });
  const hit = one.findings.find((f) => /Accord tells/.test(f.words));
  assert(hit && hit.severity === 'note', 'one tell is a note: ' + JSON.stringify(one.findings));
  const two = lintPage({ assistantText: '[X — Friday, March 14, 2025 | 14:20 | clear | hoodie | seated]\n\n"You\'re absolutely right," she said. Everyone nodded.', userText: 'I speak.' });
  assert(two.findings.some((f) => /Accord tells/.test(f.words) && f.severity === 'warn'), 'two tells warn');
});

test('M110-1 the auditor reads answered turns only — a trailing writer\'s page is an attempt, never a fact; the law is taught', async () => {
  const { answeredOnly, buildAuditorMessages } = await import('../../js/agents/auditor.js');
  const list = [{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }, { role: 'user', text: 'I go downstairs.' }];
  eq(answeredOnly(list).length, 2, 'the unanswered tail is cut');
  eq(answeredOnly([{ role: 'user', text: 'x' }]).length, 0);
  eq(answeredOnly(list.slice(0, 2)).length, 2, 'a story ending on a STORY page is whole');
  const m = buildAuditorMessages({ state: emptyState(), brief: '', castNotes: '', record: '', pages: [{ role: 'assistant', text: 'b' }] });
  assert(/A PLAYER page states what the main character ATTEMPTS/.test(m.system) && /Never write a fact from a PLAYER page alone/.test(m.system), 'the attempt law');
});

test('M111-1 the hard tokens: a record line that lost a name or a figure the pages held is caught in code, whatever the model said', async () => {
  const { hardTokens, lossCheck } = await import('../../js/agents/memory.js');
  const passage = 'PLAYER (Jovan): I lay out the plan.\n\nSTORY: Captain Reyes counted forty men and set the strike for 3am at the north gate; Reyes would take the wall himself, and Mira the gate. Duke Aldric promised 200 gold if the gate fell by dawn. Reyes nodded.';
  const t = hardTokens(passage, ['Jovan', 'Mira']);
  assert(t.names.includes('Reyes') && t.names.includes('Mira') && t.names.includes('Jovan'), 'the names: ' + t.names.join(','));
  assert(t.numbers.some((n) => /^3\s*am$/i.test(n)) && t.numbers.some((n) => /^200 gold$/i.test(n)), 'the figures: ' + t.numbers.join(','));
  const gist = 'Jovan laid out a plan with Reyes to strike the north gate before dawn; the duke offered a reward.';
  const loss = lossCheck(passage, gist, '', ['Jovan', 'Mira']);
  assert(loss.missingNames.includes('Mira'), 'Mira lost: ' + JSON.stringify(loss));
  assert(loss.missingNumbers.some((n) => /3\s*am/i.test(n)) && loss.missingNumbers.some((n) => /200/.test(n)), 'the hour and the gold lost: ' + JSON.stringify(loss));
  const full = lossCheck(passage, gist, 'Mira takes the gate; strike at 3am; 40 men; 200 gold if the gate falls by dawn', ['Jovan', 'Mira']);
  eq(full.missingNames.length + full.missingNumbers.length, 0, 'with the detail beneath, nothing is lost: ' + JSON.stringify(full));
  assert(!t.numbers.includes('2025'), 'a year is not a figure');
});

test('M116-1 a rule\'s heading never rides the page; the window is written once; the eye warns on a doubled window', async () => {
  const { applyRules, BUILTIN_RULES } = await import('../../js/regex.js');
  const rule = BUILTIN_RULES.find((r) => r.id === 'builtin-rule-headings');
  const page = 'prose\n\n*** The World Beyond ***\n[The house — Thursday, 11:26]\nShe read it.\n\nThe Window Beyond the Page\n\n[The house — Thursday, 11:26]\nShe read it again.';
  const out = applyRules(page, [rule], { on: 'storyteller', mode: 'page' });
  assert(!/Window Beyond/.test(out) && /World Beyond/.test(out), 'the heading goes, the window stays: ' + out);
  const { lintPage } = await import('../../js/agents/lint.js');
  const r = lintPage({ assistantText: '[X — Friday, March 14, 2025 | 14:20 | clear | hoodie | seated]\n\n' + page, userText: 'x' });
  assert(r.findings.some((f) => /written twice/.test(f.words) && f.severity === 'warn'), JSON.stringify(r.findings));
  const { buildModulesText } = await import('../../js/assemble/modules.js').catch(() => ({}));
  const src = (await import('node:fs')).readFileSync(new URL('../../js/assemble/modules.js', import.meta.url), 'utf8');
  assert(/never write "The Window Beyond the Page" or any title/.test(src) && /Write it ONCE and only once/.test(src), 'the rule says once, and never its own heading');
});

test('M117-1 control tokens leaked into the content end the page at the first one', async () => {
  const { stripControlLeak } = await import('../../js/agents/director.js');
  const leaked = '[X — Friday | 14:20]\n\nShe sat down. "Fine," she said.<|open|>tools<|sep|><|open|>call tool="antmlThinking" index="1"<|sep|>Delivering the story turn now.<|close|>message<|sep|>';
  const r = stripControlLeak(leaked);
  assert(r.leaked && /she said\.$/.test(r.text) && !/<\|/.test(r.text), JSON.stringify(r));
  const clean = stripControlLeak('She sat down. "a < b | c > d," she said.');
  assert(!clean.leaked, 'angle brackets and pipes in prose are not control tokens');
  const src = (await import('node:fs')).readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  assert(/leakedControl = true;/.test(src) && /leakRetried: true/.test(src), 'the page ends at the leak and an emptied page is asked again once');
});

test('M118-1 a claim of change is first person or "now reads" — quoted prose and bare "set/done/fixed" never trip the house\'s nudge', async () => {
  const { claimsChange, asksForChange } = await import('../../js/agents/housekeeper.js');
  assert(!claimsChange('The TWB shows Vanessa at the pool deck, the "half-done seating chart curled under a bottle of sunscreen"; nothing is set in the ledger about it.'), 'quoted prose and a bare set are not a claim');
  assert(!claimsChange('Checking the TWB I can see. That is her looking forward.'), 'an assessment is not a claim');
  assert(claimsChange('I changed the brief line to say she is nineteen.'), 'first person is a claim');
  assert(claimsChange('The page now reads "Kris" everywhere.'), 'now reads is a claim');
  assert(claimsChange('The correction is applied.'), 'the change is applied is a claim');
  assert(!asksForChange('And the twb from previous turn also will not contradict this?'), 'a question asks for a check, not a change');
});

test('M119-1 the eye names a glitch character from another script; a loose anchor that missed its words is reported for the house to re-ask', async () => {
  const { lintPage } = await import('../../js/agents/lint.js');
  const english = 'She caught herself, deleted something structural. '.repeat(8);
  const r = lintPage({ assistantText: '[X — Friday, March 14, 2025 | 14:20 | clear | hoodie | seated]\n\n' + english + '"oh, Chloe\'s going to sh틀—" She caught herself.', userText: 'x' });
  const f = r.findings.find((x) => Array.isArray(x.stray));
  assert(f && f.severity === 'warn' && f.stray[0] === '틀', JSON.stringify(r.findings));
  const ko = lintPage({ assistantText: '[X — Friday, March 14, 2025 | 14:20 | clear | hoodie | seated]\n\n' + '그녀는 조용히 앉아 있었다. '.repeat(30), userText: 'x' });
  assert(!ko.findings.some((x) => Array.isArray(x.stray)), 'a page written in Hangul is not a glitch');
  const src = (await import('node:fs')).readFileSync(new URL('../../js/agents/housekeeper.js', import.meta.url), 'utf8');
  assert(/const missed = located\.via === 'fuzzy' && \(\(op\.find && newText\.includes\(op\.find\)\) \|\| \(op\.replace && !newText\.includes\(op\.replace\)\)\);/.test(src), 'a loose anchor is verified after landing');
  const ui = (await import('node:fs')).readFileSync(new URL('../../js/ui/housekeeper.js', import.meta.url), 'utf8');
  assert(/landed on a loose anchor and the words it meant to change are still on the page/.test(ui), 'the house re-asks once');
});

test('M120-1 a page written inside the thinking is asked again once with the plain line, then salvaged from the thinking’s last header', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  assert(/thoughtRetried: true/.test(src) && /WRITE THE PAGE AS YOUR ANSWER/.test(src), 'the re-ask and its line');
  assert(/const salvaged = at !== -1 \? lines\.slice\(at\)\.join/.test(src), 'the salvage from the last header line');
  assert(src.indexOf('const wireMessages = generateArgs.thoughtRetried') < src.indexOf('messages: wireMessages'), 'the nudged messages ride the wire');
});

test('M121-1 the second reader knows a lie from a slip and a language from a glitch; the eye notes a short foreign run for it', async () => {
  const { buildContinuityMessages } = await import('../../js/agents/continuity.js');
  const m = buildContinuityMessages({ state: emptyState(), assistantText: 'x' });
  assert(/a lie, a joke, a tease, an exaggeration, sarcasm/.test(m.system) && /the NARRATION saying she is nineteen when the ledger locks/.test(m.system), 'the joke law');
  assert(/WORDS IN ANOTHER LANGUAGE are drift only when nobody in the scene would speak them/.test(m.system), 'the language law');
  const { lintPage } = await import('../../js/agents/lint.js');
  const english = 'She caught herself, deleted something structural. '.repeat(8);
  const r = lintPage({ assistantText: '[X — Friday, March 14, 2025 | 14:20 | clear | hoodie | seated]\n\n' + english + '"你到底在说什么呢，我不明白"', userText: 'x' });
  assert(r.findings.some((f) => /A run of another script/.test(f.words) && f.severity === 'note'), JSON.stringify(r.findings));
});

test('M123-1 the moment is not the auditor\'s nor the second reader\'s: posture, position and the scene\'s hour-to-hour state are the extractor\'s; drift is against what lasts', async () => {
  const { buildAuditorMessages } = await import('../../js/agents/auditor.js');
  const a = buildAuditorMessages({ state: emptyState(), brief: '', castNotes: '', record: '', pages: [{ role: 'assistant', text: 'b' }] });
  assert(/NOT YOUR JOB — THE MOMENT: posture, position/.test(a.system) && /a reading with fifteen is a reading of the/.test(a.system), 'the auditor keeps to what lasts');
  const { buildContinuityMessages } = await import('../../js/agents/continuity.js');
  const c = buildContinuityMessages({ state: emptyState(), assistantText: 'x' });
  assert(/THE SCENE LEDGER IS THE MOMENT BEFORE/.test(c.system) && /BEFORE this page \(the moment as it stood/.test(c.user), 'the second reader reads the scene as the moment before the page');
});

test('M124-1 record handles are unique per line — the id\'s tail, never its constant head; a card lands on the line its anchor is in', async () => {
  const { recordHandle, recordNodeByHandle } = await import('../../js/agents/housekeeper.js');
  const nodes = [
    { id: 'node-mf3k1a2b-1', span: [0, 5], text: 'Jovan opened the door.' },
    { id: 'node-mf3k1a9z-2', span: [6, 11], text: 'Vanessa Reynolds said Jovan is seventeen and looks like a K-drama summoned him.' },
    { id: 'node-mf3k2c0d-3', span: [12, 17], text: 'Rias tasted the milkshake.' },
  ];
  const hs = nodes.map(recordHandle);
  eq(new Set(hs).size, 3, 'three lines, three handles: ' + hs.join(','));
  assert(hs.every((h) => /^#r[a-z0-9]{6}$/.test(h) && !/^#rnode/.test(h)), 'the tail, not "node-m": ' + hs.join(','));
  eq(recordNodeByHandle(nodes, hs[1]).id, nodes[1].id, 'a handle resolves to its own line');
  eq(recordNodeByHandle(nodes, hs[1].slice(1)).id, nodes[1].id, 'with or without the #');
  eq(recordNodeByHandle(nodes, '#rnode-m'), null, 'the old ambiguous handle answers to nothing — the anchor decides');
  const src = (await import('node:fs')).readFileSync(new URL('../../js/agents/housekeeper.js', import.meta.url), 'utf8');
  assert(/a record line by its #r… mark/.test(src) && /No record line answers to/.test(src), 'a record line can be fetched whole by its handle');
});

test('M126-1 a question anywhere is a question; a declaration asks for a change only when it contradicts; the nudge tells the model to answer the writer, never the note', async () => {
  const { asksForChange } = await import('../../js/agents/housekeeper.js');
  assert(!asksForChange('Jovan tells Vanessa she can get his number from Rias while he goes with Aurora. Is that fine narratively? does it contradict anything'), 'a question inside the message is a question');
  assert(!asksForChange('Jovan is warm with Vanessa and Rias is possessive.'), 'a thought aloud is not an order');
  assert(asksForChange('all first year students are 16, not 15'), 'a contradiction is an ask');
  assert(asksForChange('Rias isn’t his sister, she is his neighbour'), 'isn’t is an ask');
  assert(asksForChange('why is she on the porch? fix it'), 'an imperative after a question is an ask');
  const src = (await import('node:fs')).readFileSync(new URL('../../js/agents/housekeeper.js', import.meta.url), 'utf8');
  assert(/never mention this note, never say "you\\'re right"/.test(src), 'the nudge forbids answering the house');
});

test('M128-1 the header’s ground and hour land in code; the auditor’s scope drops the moment and a page for the main character', async () => {
  const { headerMutations } = await import('../../js/engine/state.js');
  const hm = headerMutations('[Lake path, dock bend — Thursday, August 20, 2026 | 16:18 | ☀ sun | dark tee | standing]\n\nProse.');
  assert(hm.some((m) => m.type === 'place.set' && m.name === 'Lake path, dock bend'), JSON.stringify(hm));
  assert(hm.some((m) => m.type === 'clock.set' && m.year === 2026 && m.month === 8 && m.day === 20 && m.hour === 16 && m.minute === 18), JSON.stringify(hm));
  eq(headerMutations('No header here.').length, 0);
  eq(headerMutations('[The room — Thursday | 09:00]').length, 1, 'a header without a full date sets the place only');
  const { auditorScope } = await import('../../js/agents/auditor.js');
  const { applyMutations } = await import('../../js/engine/apply.js');
  let st = emptyState();
  st = applyMutations(st, [{ type: 'mc.set', name: 'Jovan' }, { type: 'offscreen.set', name: 'Chloe', location: 'home', activity: 'texting', agenda: 'x' }, { type: 'thread.set', title: 'The party', owner: 'Vanessa', heat: 'hot', next: 'ask' }]).state;
  const issues = [
    { what: 'mood', fix: 'x', mutations: [{ type: 'mode.snapshot', flags: [] }] },
    { what: 'posture', fix: 'x', mutations: [{ type: 'presence.set', name: 'Rias', position: 'knee up' }] },
    { what: 'seat activity', fix: 'x', mutations: [{ type: 'offscreen.set', name: 'Chloe', location: 'home', activity: 'still texting' }] },
    { what: 'thread nudged', fix: 'x', mutations: [{ type: 'thread.set', title: 'The party', owner: 'Vanessa', next: 'wait' }] },
    { what: 'MC page', fix: 'x', mutations: [{ type: 'people.set', name: 'Jovan', field: 'core', text: 'x' }] },
    { what: 'loose end', fix: 'x', mutations: [{ type: 'people.set', name: 'Alexia', field: 'threads', text: 'x' }] },
    { what: 'a real one', fix: 'x', mutations: [{ type: 'presence.leave', name: 'Caleb' }, { type: 'presence.set', name: 'Rias', position: 'y' }] },
    { what: 'new seat', fix: 'x', mutations: [{ type: 'offscreen.set', name: 'Marcus', location: 'town', activity: 'y', agenda: 'z' }] },
  ];
  const kept = auditorScope(issues, st);
  eq(kept.map((i) => i.what).join(','), 'a real one,new seat', JSON.stringify(kept));
  eq(kept[0].mutations.length, 1, 'the moment stripped out of a real issue');
});

test('M129-1 a person who appears only inside the window is never seated present; the second reader holds the brief as written and never calls absence drift; bold marks leave at the door', async () => {
  const { buildContinuityMessages } = await import('../../js/agents/continuity.js');
  const m = buildContinuityMessages({ state: emptyState(), assistantText: 'x', brief: 'Rias Wells is Jovan’s older sister.' });
  assert(/COUNTS AS WRITTEN/.test(m.user) && /older sister/.test(m.user), 'the brief rides');
  assert(/ABSENCE IS NEVER DRIFT/.test(m.system), 'absence law');
  const src = (await import('node:fs')).readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  assert(/onlyInWindow\(m\.name\)/.test(src) && /indexOf\('\*\*\* The World Beyond \*\*\*'\)/.test(src), 'a presence.enter for a window-only name is refused in code');
  const ex = (await import('node:fs')).readFileSync(new URL('../../js/agents/extractor.js', import.meta.url), 'utf8');
  assert(/A WINDOW IS ELSEWHERE/.test(ex), 'and the extractor is told');
  const { applyRules, BUILTIN_RULES } = await import('../../js/regex.js');
  const r = BUILTIN_RULES.find((x) => x.id === 'builtin-bold-marks');
  eq(applyRules('**Bold** and *** The World Beyond *** and *tok*', [r], { on: 'storyteller', mode: 'page' }), 'Bold and *** The World Beyond *** and *tok*');
});

test('M130-1 one now per person: the scribe never writes state for a seated absent person; a recall card carries the seat', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../../js/agents/scribe.js', import.meta.url), 'utf8');
  assert(/ONLY for people IN THE SCENE/.test(src) && /seated\.has\(String\(d\.name/.test(src), 'the law and the code');
  const { renderPeopleTiers } = await import('../../js/engine/people.js');
  const { applyMutations } = await import('../../js/engine/apply.js');
  let st = emptyState();
  st = applyMutations(st, [
    { type: 'mc.set', name: 'Jovan' },
    { type: 'people.set', name: 'Vanessa', field: 'core', text: 'the loud friend' },
    { type: 'people.set', name: 'Vanessa', field: 'state', text: 'leaning on the hedge, phone in hand' },
    { type: 'offscreen.set', name: 'Vanessa', location: 'the sedan, Mariner’s Lane', activity: 'arms crossed on the roof', agenda: 'watch the reunion' },
  ]).state;
  const out = renderPeopleTiers(st, { recentPages: ['Vanessa laughed from the lane.'] });
  const text = typeof out === 'string' ? out : JSON.stringify(out);
  assert(/the sedan, Mariner’s Lane/.test(text) && !/leaning on the hedge/.test(text), 'the seat is her now on the wire: ' + text.slice(0, 300));
});

test('M131-1 OWNERSHIP OF THE LEDGER: every fact has one writer; every second writer is a named guard, never a rival', async () => {
  const fs = await import('node:fs');
  const read = (f) => fs.readFileSync(new URL('../../js/agents/' + f + '.js', import.meta.url), 'utf8');
  const chat = fs.readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  const ex = read('extractor'); const world = read('world'); const scribe = read('scribe'); const aud = read('auditor');
  /* the moment (presence position, wardrobe, mood) — the extractor only */
  assert(/mode\.snapshot/.test(ex) && !/mode\.snapshot/.test(world) && !/mode\.snapshot/.test(scribe), 'the mood board is the extractor’s');
  assert(/MOMENT_TYPES = new Set\(\['mode\.snapshot', 'presence\.set', 'people\.note'\]\)/.test(aud), 'the auditor never lands the moment');
  /* the now of an absent person — the world agent’s seat; the scribe writes state for the present only */
  assert(/seated\.has\(String\(d\.name/.test(scribe), 'the scribe drops state for the seated absent');
  /* the ground and the hour — the header, in code, over the extractor’s own guess */
  assert(/headerHas\.has\(m\.type\)/.test(chat), 'the header wins over the extractor’s place/clock');
  /* people in a window — never present */
  assert(/onlyInWindow\(m\.name\)/.test(chat), 'a window’s people are elsewhere');
  /* standings — earned on the page; the auditor may restore, never lower on judgment */
  assert(/Lowering is what you may not do/.test(aud), 'the standings guard');
  /* who keeps a seat — code (M103); the world agent is told the same */
  assert(/export function seatHousekeeping/.test(aud) && /A SEAT IS FOR SOMEONE THE SCENE COULD STILL MEET/.test(world), 'seats have a life in code and in law');
  /* the record — the keeper writes; verifier, detail auditor, hard tokens, housekeeper, ripple edit in place */
  const mem = read('memory');
  assert(/export function hardTokens/.test(mem) && /export function addCorrection/.test(mem), 'the record’s guards');
  /* the auditor reads answered turns only */
  assert(/export function answeredOnly/.test(aud), 'an unanswered writer’s page is an attempt');
});

test('M132-1 a rule that teaches a house block never rides the wire; the import engine retires the preset’s Voices Block', async () => {
  const { selectModules, housesBlock } = await import('../../js/assemble/modules.js');
  const { classify } = await import('../../js/import/v176map.js');
  assert(housesBlock({ name: 'Voices Block', text: 'Write {VOICES} … {/VOICES} after the prose when the social field is in reach.' }));
  assert(housesBlock({ name: 'My rule', text: 'End every social scene with a {VOICES} block of 2-4 lines.' }));
  assert(!housesBlock({ name: 'The world window', text: 'Never write {VOICES}; the house hears the voices.' }), 'a rule that says never is not teaching the block');
  assert(!housesBlock({ name: 'The Prose', text: 'Short sentences. No bold.' }));
  const picked = selectModules([{ id: 'v', name: 'Voices Block', custom: true, enabled: true, whenKey: 'socialField', text: 'Write {VOICES} lines.', when: () => ({ load: true, reason: 'x' }) }], emptyState());
  assert(!picked.some((c) => c && c.mod && c.mod.id === 'v'), 'the voices rule never loads: ' + JSON.stringify(picked.map((c) => [c.mod && c.mod.id, c.reason])));
  const v = classify({ name: 'Voices Block', content: 'x' });
  eq(v.bucket, 'retired', JSON.stringify(v));
});
