/* M345: the writer's cast sheet had his main character missing and the paper bag over Jovan's head filed under Kaelen;
 * and the referee's outcome never reached the storyteller at all. These laws run the product: the seeder's real
 * reading and merge (through the store and back), the heal of a sheet the blind seeder made, the referee's reading,
 * every outcome's words, and where the outcome rides on the wire — and that OFF sends nothing of it. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import {
  seedDue, buildSeedUser, mergeSeed, maybeSeedSheet, buildRefereeUser, SEED_VERSION, SEED_SYSTEM,
} from '../../js/agents/referee.js';
import {
  engineSettings, startDuel, buildDirective, buildDuelDirective, buildDuelSequenceDirective, buildArmedDirective,
  buildBattleDirective, buildWarDirective, buildFightOverDirective, buildLullDirective, startBattle, startWar,
  findActorKeySamePerson, applyConditionChange,
} from '../../js/engine/duels.js';
import { applyMutations } from '../../js/engine/apply.js';
import { emptyState, saveState, loadState, renderStateFacts } from '../../js/engine/state.js';
import { buildRequest, STATE_MARKER, refereeCraft } from '../../js/assemble/stack.js';
import { CRAFT_TEXT } from '../../js/assemble/craft.js';
import { db } from '../../js/store.js';

const ledger = () => {
  let st = applyMutations({ ...emptyState(), page: 12 }, [
    { type: 'mc.set', name: 'Jovan' },
    { type: 'place.set', name: 'Ravenwood Academy courtyard' },
    { type: 'presence.enter', name: 'Jovan' },
    { type: 'presence.enter', name: 'Kaelen' },
    { type: 'presence.enter', name: 'Ivar' },
  ]).state;
  st.characters = {
    Kaelen: { core: 'Kaelen Ashford, a third-year of Ravenwood and the academy’s fourth seat; a careful swordsman.', state: 'watching Jovan', threads: [] },
    Ivar: { core: 'Ivar, the first seat of Ravenwood, a shadow-blade prodigy who has never lost a duel.', state: '', threads: [] },
    Vladilena: { core: 'Vladilena Milizé, a handler — sharp, strategic, no fighter.', state: '', threads: [] },
    Drakon: { core: 'Drakon, the academy’s brawler, second seat.', state: '', threads: [] },
  };
  st.factions = { 'Ravenwood Academy': { note: 'the school' } };
  return st;
};
const PAGES = [
  { id: 'u1', role: 'user', text: 'I pull the paper bag over my head, poke two eye-holes through it, and step into the courtyard.' },
  { id: 'a1', role: 'assistant', text: '[Ravenwood Academy courtyard — Monday | 08:00 | clear | paper bag | at the gate]\n\nKaelen stared at the bag. "Is that… you, Jovan?" Ivar did not look up from his blade.' },
  { id: 'u2', role: 'user', text: 'I nod, the bag rustling. "Morning."' },
  { id: 'a2', role: 'assistant', text: '[Ravenwood Academy courtyard — Monday | 08:02 | clear | paper bag | beside Kaelen]\n\nDrakon laughed so hard he had to sit down.' },
];

test('M345-1 THE SEEDER IS TOLD WHO THE WRITER PLAYS: <player> names Jovan, his pages are labelled with his name, and the ledger’s people, bodies and brief are in its reading', () => {
  const user = buildSeedUser({ state: ledger(), pages: PAGES, brief: 'Jovan, 16, hides his face under a paper bag. Ivar is first seat.', castNotes: 'Kaelen — fourth seat.', record: 'Page 3: Jovan beat Drakon at arm-wrestling.' });
  assert(/<player>\nThe main character — the person the writer plays — is Jovan\./.test(user), 'the main character is named: ' + user.slice(0, 200));
  assert(user.includes('Jovan (the writer):\nI pull the paper bag over my head'), 'his page is his, by name');
  assert(!/(^|\n)Player:/.test(user), 'no page is labelled a nameless "Player"');
  for (const name of ['Kaelen (in the scene) — Kaelen Ashford', 'Ivar (in the scene) — Ivar, the first seat', 'Vladilena — Vladilena Milizé', 'Drakon — Drakon, the academy']) assert(user.includes(name), 'the people’s pages ride: ' + name);
  assert(user.includes('<brief>\nJovan, 16, hides his face under a paper bag.'), 'the brief rides');
  assert(user.includes('<record>\nPage 3: Jovan beat Drakon'), 'the record rides');
  assert(user.includes('two eye-holes through it, and step into the courtyard.'), 'a page is read whole, not its last 600 characters');
  assert(/FIRST entry in "actors" is always the main character/.test(SEED_SYSTEM) && /NEVER clothing, a disguise/.test(SEED_SYSTEM), 'the seeder’s rules: him first; a disguise is not a condition');
});

test('M345-2 THE WRITER’S SHEET, THROUGH THE STORE: the model’s answer lands on the right people — Jovan first and whole, no paper bag on Kaelen, no entry for "you" or for the academy — and the stamp survives a reload', async () => {
  const st = await db.stories.create({ title: 'the paper bag' });
  for (const m of PAGES) await db.messages.append(st.id, { role: m.role, text: m.text });
  await saveState(st.id, ledger());
  let seen = '';
  const model = async (conn, system, user) => {
    seen = user;
    return JSON.stringify({ player_story_name: 'Jovan', actors: [
      { name: 'Jovan', default: 6, domains: { melee: 7, stealth: 6 }, lasting: [{ name: 'paper bag over his head', mod: -1 }] },
      { name: 'Kaelen Ashford', default: 5, domains: { melee: 6 } },
      { name: 'Ivar', default: 8, domains: { melee: 9 }, lasting: [{ name: 'shadow-wreathed blade', mod: 1, domain: 'melee', gear: true }] },
      { name: 'you', default: 3 },
      { name: 'Ravenwood Academy', default: 7 },
    ] });
  };
  const r = await maybeSeedSheet({ connection: { type: 'openai', contextSize: 128000 }, storyId: st.id, callLLM: model, brief: 'Jovan is the lead.' });
  eq(r.ok, true, 'it seeded: ' + JSON.stringify(r));
  assert(seen.includes('is Jovan.'), 'the model was told who the writer plays');
  const back = await loadState(st.id);
  const a = back.sheet.actors;
  eq(Object.keys(a)[0] === 'Jovan' || Boolean(a.Jovan), true, 'Jovan is on his sheet');
  eq(a.Jovan.default, 6, 'with his own rating');
  assert(!a.Jovan.conditions, 'a paper bag is a disguise, not a handicap: ' + JSON.stringify(a.Jovan.conditions));
  assert(a.Kaelen && !a['Kaelen Ashford'], 'Kaelen stands under the name his page stands under: ' + Object.keys(a).join(', '));
  assert(!a.Kaelen.conditions, 'and carries nothing of Jovan’s');
  eq(a.Ivar.conditions[0].name, 'shadow-wreathed blade', 'Ivar keeps his blade');
  eq(a.Ivar.conditions[0].by, 'seed', 'marked as the seeder’s reading');
  assert(!a.you && !a['Ravenwood Academy'], 'no entry for "you", none for a school: ' + Object.keys(a).join(', '));
  eq(back.sheet.seedVersion, SEED_VERSION, 'the stamp survives the store');
  eq(seedDue(back, 2), '', 'and nothing is due again straight away');
});

test('M345-3 THE BLIND SEEDER’S SHEET HEALS ITSELF: Kaelen’s misfiled paper bag goes, a stranger no ledger knows goes, the referee’s own filing stays, the stamp is set', () => {
  const st = ledger();
  st.sheet.actors = {
    Kaelen: { default: 4, domains: { melee: 4 }, _auto: true, conditions: [{ name: 'Paper bag over head', mod: -1 }] },
    Ivar: { default: 7, domains: { melee: 7 }, _auto: true, conditions: [{ name: 'Shadow-wreathed blade', mod: 1 }, { name: 'cracked rib', mod: -1, by: 'referee' }] },
    'Masked stranger': { default: 5, domains: {}, _auto: true },
  };
  eq(seedDue(st, 10), 'heal', 'a sheet with no stamp is the blind seeder’s — due at once');
  const r = mergeSeed(st, { actors: [{ name: 'Jovan', default: 6, domains: { melee: 7 } }, { name: 'Ivar', default: 8, domains: { melee: 9 } }] }, { heal: true });
  const a = st.sheet.actors;
  assert(a.Jovan && a.Jovan.default === 6, 'Jovan is on the sheet');
  assert(a.Kaelen && !a.Kaelen.conditions, 'Kaelen keeps his place and loses the bag that was never his: ' + JSON.stringify(a.Kaelen));
  eq(a.Ivar.default, 8, 'Ivar re-read with the ledger in view');
  eq(JSON.stringify((a.Ivar.conditions || []).map((c) => c.name)), JSON.stringify(['cracked rib']), 'the referee’s rib stays; the blind reading goes');
  assert(!a['Masked stranger'], 'a name no page stands for, not named again, goes');
  eq(r.mcMissing, false, 'nothing missing');
});

test('M345-4 GROWTH AND THE WRITER’S HAND: this seeder’s numbers only rise; a hand-kept entry is locked (new domains only); an estimate from a fight gives way to a considered rating', () => {
  const st = ledger();
  st.sheet.seedVersion = SEED_VERSION;
  st.sheet.actors = {
    Jovan: { default: 6, domains: { melee: 6 }, _auto: true, seed: SEED_VERSION },
    Drakon: { default: 3, domains: { melee: 3 }, _hand: true },
    Ivar: { default: 5, domains: { melee: 5 }, _estimated: true },
  };
  mergeSeed(st, { actors: [{ name: 'Jovan', default: 4, domains: { melee: 8 } }, { name: 'Drakon', default: 9, domains: { melee: 9, athletics: 7 } }, { name: 'Ivar', default: 8, domains: { melee: 9 } }] });
  const a = st.sheet.actors;
  eq(a.Jovan.default, 6, 'never lowered');
  eq(a.Jovan.domains.melee, 8, 'raised where he grew');
  eq(a.Drakon.default, 3, 'the hand stands');
  eq(a.Drakon.domains.athletics, 7, 'only a new domain joins it');
  eq(a.Ivar.default, 8, 'the estimate gives way');
  assert(!a.Ivar._estimated && a.Ivar._auto, 'and is the seeder’s now');
});

test('M345-5 HIM LEFT OUT = ASKED ONCE MORE, BY NAME: an answer without the main character is asked again, and the second answer puts him on', async () => {
  const st = await db.stories.create({ title: 'left out' });
  for (const m of PAGES) await db.messages.append(st.id, { role: m.role, text: m.text });
  await saveState(st.id, ledger());
  let calls = 0; let last = '';
  const model = async (conn, system, user) => { calls += 1; last = user; return JSON.stringify({ actors: calls === 1 ? [{ name: 'Kaelen', default: 5 }] : [{ name: 'Jovan', default: 6 }, { name: 'Kaelen', default: 5 }] }); };
  await maybeSeedSheet({ connection: { type: 'openai', contextSize: 128000 }, storyId: st.id, callLLM: model });
  eq(calls, 2, 'asked twice');
  assert(/You left out Jovan — the main character/.test(last), 'the second ask names him');
  const back = await loadState(st.id);
  eq(back.sheet.actors.Jovan.default, 6, 'he is on the sheet');
});

test('M345-6 WHEN THE SHEET IS WEIGHED: first pages, after a fight, a new face in the scene, the main character missing, and every hundred pages — never on a whim', () => {
  const st = ledger();
  eq(seedDue(st, 1), '', 'too early');
  eq(seedDue(st, 2), 'first', 'the first weighing');
  st.sheet.actors = { Jovan: { default: 6, _auto: true, seed: SEED_VERSION }, Kaelen: { default: 5, _auto: true, seed: SEED_VERSION }, Ivar: { default: 8, _auto: true, seed: SEED_VERSION } };
  st.sheet.seedVersion = SEED_VERSION;
  st.sheet.seededAtPage = 12;
  eq(seedDue(st, 20), '', 'nothing new — nothing due');
  st.present.push({ name: 'Drakon' });
  eq(seedDue(st, 20), '', 'a new face within three pages of the last weighing waits');
  st.sheet.seededAtPage = 9;
  eq(seedDue(st, 20), 'a new face', 'a new face in the scene is weighed');
  st.sheet.seenPresent = ['Drakon'];
  eq(seedDue(st, 20), '', 'but one the last weighing already saw here and left off does not call it again, page after page');
  st.sheet.seenPresent = [];
  st.present = st.present.filter((p) => p.name !== 'Drakon');
  delete st.sheet.actors.Jovan;
  eq(seedDue(st, 20), 'the main character', 'the main character missing is weighed');
  st.sheet.actors.Jovan = { default: 6, _auto: true, seed: SEED_VERSION };
  st.seedDueAfterFight = true;
  eq(seedDue(st, 20), 'after a fight', 'after a fight');
  st.seedDueAfterFight = false;
  st.sheet.seededAtPage = 12 - 100;
  eq(seedDue(st, 200), 'a while since', 'a hundred pages on');
});

test('M345-7 THE REFEREE READS WHAT IT RULES ON: his name spelled out, the whole sheet, who is here and who they are, the brief, whole pages — and the action once', () => {
  const st = ledger();
  st.sheet.actors = {};
  for (let i = 0; i < 20; i += 1) st.sheet.actors['Student ' + String.fromCharCode(65 + i)] = { default: 4, _auto: true };
  st.sheet.actors.Jovan = { default: 6, domains: { melee: 7 }, _auto: true };
  const long = 'Kaelen raised his practice sword at the start of it all. ' + 'The courtyard held its breath. '.repeat(120) + 'He waited.';
  const action = 'I try to disarm Kaelen with a feint low.';
  const hist = [{ id: 'a0', role: 'assistant', text: long }, { id: 'u9', role: 'user', text: action }];
  const user = buildRefereeUser({ state: st, userText: action, history: hist, fightLine: '', brief: 'Jovan fights bare-handed; Ivar is untouchable.' });
  assert(/<player>\nThe player character is "Jovan"/.test(user), 'his name spelled out');
  assert(user.startsWith('<player>') && user.indexOf('Jovan (the player): default 6') < user.indexOf('Student A'), 'the main character leads the sheet');
  assert(user.includes('Student T'), 'the whole sheet — all twenty-one, not twelve');
  assert(user.includes('Kaelen — Kaelen Ashford, a third-year'), 'who is here, and who they are');
  assert(user.includes('Jovan fights bare-handed'), 'the brief');
  assert(user.includes('raised his practice sword at the start of it all'), 'a page’s opening, not only its last 400 characters');
  eq(user.split(action).length - 1, 1, 'the action rides once');
});

const BANNED = /\d|\b(?:DECISIVE|SUCCESS|FAILURE|SETBACK|DISASTER|TRADE|STALEMATE|round|poise|rolls?|house|referee|ruling|verdict|adjudicat\w*)\b|\bnote\b/;
test('M345-8 EVERY OUTCOME IS SAID THE WAY A PERSON SAYS IT: no tier in capitals, no numbers, no machinery (rounds, poise, rolls, the house, a note) — and every law of the old words still said', () => {
  const eng = engineSettings({});
  const checks = [];
  for (const tier of ['DECISIVE', 'SUCCESS', 'SUCCESS_COST', 'SETBACK', 'FAILURE', 'DISASTER']) {
    checks.push(['check ' + tier, buildDirective({ actor: 'Jovan', action: 'leap the courtyard wall', kind: 'task', stakes: 'being seen', playerGuard: 'his ward holds', counterPath: null }, { tier })]);
  }
  const st = ledger();
  startDuel(st, { playerName: 'Jovan', oppName: 'Kaelen', domain: 'melee', oppEstimate: 5, scaleMismatch: 0 }, eng);
  st.duel.round = 3; st.duel.opp.injuries = 2;
  for (const tier of ['DECISIVE', 'SUCCESS', 'SUCCESS_COST', 'SETBACK', 'FAILURE', 'DISASTER', 'TRADE', 'STALEMATE']) {
    checks.push(['duel ' + tier, buildDuelDirective(st, { action: 'feint low, then the disarm', playerGuard: 'nothing reaches him', counterPath: 'the ground can be broken' }, { tier, opening: true })]);
  }
  checks.push(['duel outcome-only', buildDuelDirective(st, { action: 'feint low' }, { tier: 'SUCCESS', outcome: true })]);
  checks.push(['duel recover', buildDuelDirective(st, { action: 'falls back to breathe' }, { recover: true, gained: 1, counter: 1 })]);
  checks.push(['duel sequence', buildDuelSequenceDirective(st, { action: 'a chain' }, { steps: [{ strike: 'disrupt the spell', tier: 'SUCCESS' }, { strike: 'a groin kick', tier: 'FAILURE' }, { strike: 'an elbow', tier: 'DECISIVE' }], overall: 'SUCCESS_COST' })]);
  st.duel.over = true; st.duel.victor = 'player';
  checks.push(['duel won', buildDuelDirective(st, { action: 'the last cut' }, { tier: 'DECISIVE' })]);
  st.duel.victor = 'draw';
  checks.push(['duel draw', buildDuelDirective(st, { action: 'both swing' }, { tier: 'TRADE' })]);
  st.duel.over = false;
  checks.push(['armed', buildArmedDirective(st, { action: 'squaring up' })]);
  checks.push(['lull', buildLullDirective(st, 'they circle')]);
  checks.push(['over', buildFightOverDirective('Kaelen yields')]);
  const bs = ledger();
  startBattle(bs, { allies: ['Drakon'], enemies: ['Guard x3'], domain: 'melee', scaleMismatch: 0 }, eng);
  checks.push(['battle', buildBattleDirective(bs, { action: 'sweep through the guards' }, { mcRes: { tier: 'SUCCESS' }, reports: ['Drakon gets the better of Guard 2 (Guard 2 is pressed).'], outcome: false })]);
  const ws = ledger();
  startWar(ws, { allies: ['Left Flank', 'Zero Squadron'], enemies: ['Iron Legion'], enemyCommander: 'Ivar', scaleMismatch: 0 }, eng);
  checks.push(['war', buildWarDirective(ws, { action: 'flank their right' }, { focalRes: { tier: 'SUCCESS' }, reports: [], outcome: false })]);
  for (const [what, text] of checks) {
    assert(/^About /.test(text), what + ' opens the way a person opens: ' + text.slice(0, 60));
    const bad = text.replace(/Guard 2|Guard x3/g, '').match(BANNED);
    assert(!bad, what + ' says "' + (bad && bad[0]) + '": ' + text);
  }
  const txt = (k) => checks.find(([w]) => w === k)[1];
  assert(/it works, but at a fair price — a small cost that never reverses the win/.test(txt('check SUCCESS_COST')) && /was acting in secret or under cover, this doesn’t give it away/.test(txt('check SUCCESS_COST')), 'the price of a costly win, and the kept secret');
  eq(txt('duel SUCCESS_COST').split('deniable flicker').length - 1, 1, 'the kept secret said once, not twice');
  assert(/has no way through that guard/.test(txt('check FAILURE')), 'the guard with no way in');
  assert(/only through that one way in — the ground can be broken/.test(txt('duel FAILURE')), 'the guard’s one honest path');
  assert(/lasting wound/.test(txt('duel DECISIVE')) && /carrying two lasting wounds/.test(txt('duel SUCCESS')), 'wounds, in words');
  assert(/Kaelen is beaten — Jovan takes the fight/.test(txt('duel won')) && /both down/.test(txt('duel draw')), 'the called end, and the draw');
  assert(/nobody is calling a winner/.test(txt('duel outcome-only')), 'the fight the story ends');
  assert(/first disrupt the spell — lands; then a groin kick — fails; and last an elbow — lands cleanly and hard/.test(txt('duel sequence')), 'the chain strike by strike');
  assert(/nothing is decided yet/.test(txt('armed')), 'the standoff binds');
});

test('M345-9 THE SETTLED OUTCOME RIDES FIRST IN THE CLOSING WORDS, in the writer’s voice led by the teller’s name, never through the notebook swap; OFF: not one byte of it — no outcome, no craft line, no fight kept', () => {
  const ruling = 'About what Jovan is trying — sneak into the house: it works, just as meant. It’s settled — tell it just that way, in the story’s own voice, and keep all of this between us.';
  const craft = { mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' };
  const build = (settings, st) => buildRequest({
    story: { brief: '' }, messages: [{ id: 'u1', role: 'user', text: 'I try to sneak into the house.' }], settings, state: st || ledger(),
    modules: [craft], memory: '', cast: [], lore: '', loreFired: [], window: { keeperOn: false, window: 30, budgetTokens: 100000 },
    directive: '', directorNote: '', editorEye: '', ruling,
  });
  const on = build({ tellerName: 'Iron Man', writerName: 'Bruce', noteText: 'Keep it tight.' });
  const last = on.messages[on.messages.length - 1];
  eq(last.role, 'user', 'the closing words');
  assert(last.content.startsWith('Iron Man — about what Jovan is trying — sneak into the house: it works'), 'first, led by the teller’s name: ' + last.content.slice(0, 120));
  assert(last.content.indexOf('Keep it tight.') > last.content.indexOf('keep all of this between us'), 'the note still last');
  assert(!/Bruce’s notebook/.test(last.content), 'the action’s own words are story text — "the house" stays a house');
  const brief = on.messages.find((m) => typeof m.content === 'string' && m.content.includes(STATE_MARKER) || /Bruce here/.test(m.content));
  assert(!brief || !brief.content.includes('sneak into the house: it works'), 'not in the briefing any more');
  const sys = JSON.stringify(on.systemBlocks);
  assert(/An outcome already settled = /.test(sys) && !/The house has ruled = /.test(sys), 'the craft teaches the words the outcome really opens with');
  const withDuel = ledger();
  startDuel(withDuel, { playerName: 'Jovan', oppName: 'Kaelen', domain: 'melee', oppEstimate: 5, scaleMismatch: 0 }, engineSettings({}));
  const off = build({ refereeOn: false, tellerName: 'Iron Man', writerName: 'Bruce' }, withDuel);
  const all = JSON.stringify(off.messages) + JSON.stringify(off.systemBlocks);
  assert(!all.includes('sneak into the house: it works'), 'OFF: no outcome rides');
  assert(!/An outcome already settled|The house has ruled =/.test(all), 'OFF: the craft says nothing of settled outcomes');
  assert(!/A duel is joined/.test(all), 'OFF: no fight is kept for the storyteller');
  assert(!(off.receipt.slots || []).some((s) => s.name === 'The house has ruled'), 'OFF: no slot on the receipt');
  const onDuel = build({}, withDuel);
  assert(/A duel is joined/.test(JSON.stringify(onDuel.messages)), 'ON: the fight that stands rides as before');
  /* a craft saved before today speaks today's line */
  const oldCraft = CRAFT_TEXT.replace(/^[ \t]*An outcome already settled = [^\n]*$/m, '    The house has ruled = a verdict injected from outside the story REPLACES your own outcome assignment.');
  assert(/The house has ruled = /.test(oldCraft), 'the old copy carries the old line');
  const healed = refereeCraft(oldCraft, true);
  assert(!/The house has ruled = /.test(healed) && /An outcome already settled = /.test(healed), 'a stored copy speaks the new line');
});

test('M345-10 A CONDITION IS SPOKEN IN WORDS AND KNOWS WHO FILED IT: the referee’s filing is tagged (a re-seed never takes it back) and what rides to the storyteller carries no modifier', () => {
  const st = ledger();
  st.sheet.actors = { Jovan: { default: 6, _auto: true, seed: SEED_VERSION } };
  const note = applyConditionChange(st, { who: 'you', add: 'broken left arm', mod: -2, domain: 'melee' });
  assert(/^Jovan now carries broken left arm, and it tells in close fighting while it lasts$/.test(note), note);
  eq(st.sheet.actors.Jovan.conditions[0].by, 'referee', 'tagged');
  mergeSeed(st, { actors: [{ name: 'Jovan', default: 7, domains: {} }] });
  eq(st.sheet.actors.Jovan.conditions[0].name, 'broken left arm', 'a re-seed keeps it');
  eq(findActorKeySamePerson({ sheet: { actors: { 'Claire Wessex': {} } } }, 'Marcus Wessex'), null, 'a shared surname is not one person');
  eq(findActorKeySamePerson({ sheet: { actors: { 'Kaiser von Adler': {} } } }, 'Kaiser'), 'Kaiser von Adler', 'a short name finds the long one');
});
