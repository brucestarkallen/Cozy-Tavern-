/* Cozy Tavern — agents/referee.js (M11)
 * The autonomous referee — a faithful port of Arbiter's adjudication
 * contract onto Cozy Tavern's own spine. It replaces the M6 referee
 * (#roll/#skip verdicts): the gate now fires on plain-English attempts, the
 * ruling is a binding injection ("The house has ruled") in the dynamic
 * tail, and every fight is a real state machine in js/engine/duels.js.
 *
 * The shape of the turn:
 *   1. GATE — local, free, instant. Out-of-character parentheticals are
 *      rejected outright; quoted dialogue is stripped before scanning; what
 *      remains needs an attempt-phrase or a gate verb (sensitivity-gated)
 *      to reach the referee. A fight in progress bypasses the gate — every
 *      beat inside a duel/battle/war is scored.
 *   2. MICRO-CALL — worker connection, ~600 tokens, temperature 0, under
 *      the caller's budget (12s), ONE retry on malformed output. Strict
 *      JSON, balanced-brace parsed (agents/jsonutil.js). Identity is
 *      hardened in code: the actor is always the player, the opposition is
 *      never an MC alias.
 *   3. MATH — all in code (engine/referee-math.js): the logistic curve,
 *      the mirrored six-tier slicing, tie remaps, the duel/battle/war
 *      economy. The model never rolls and never decides an outcome.
 *   4. COMMITTED FATE — each user message's verdict is cached by its text
 *      hash (state.refHistory, cap 12, with pre-turn world snapshots).
 *      Swipes and regenerates replay the committed verdict unchanged;
 *      edited text is a new world — the snapshot rewinds, then a fresh
 *      roll; deleted or branched-away suffixes rewind with it.
 *
 * Degrade-to-nothing is the law: any failure — no connection, network,
 * non-JSON, timeout — means NO injection, and the story simply goes on.
 * Nothing here ever throws into the chat path.
 */

import { parseFirstObject } from './jsonutil.js';
import { withFictionFrame } from './voice.js'; /* M21: the workers never break the fiction */
import { callWorker } from './call.js'; /* M28: the one wire path for workers */
import { applyMutations } from '../engine/apply.js';
import { loadState, saveState, notify } from '../engine/state.js';
import { db } from '../store.js';
import {
  clamp, probFromDelta, sliceOutcome, rngFloat, TIER_MEANING,
} from '../engine/referee-math.js';
import {
  ENGINE_DEFAULTS, engineSettings, mcName, isMcAlias, samePersonName,
  findActor, findActorKey, safeKey, ratingFor, tierRating, combatDomain,
  composurePenalty, applyComposureChange,
  passiveComposureRecovery, applyConditionChange,
  duelActive, battleActive, startDuel, resolveDuelExchange, resolveDuelSequence,
  resolveBattleRound, resolveWarRound,
  buildDirective, buildDuelDirective, buildDuelSequenceDirective, buildArmedDirective,
  buildBattleDirective, buildWarDirective, renderFightLine, RULED_HEAD,
} from '../engine/duels.js';

const MAX_TOKENS = 600; /* one small JSON object; thinking is off on the wire (M28) */
const TIMELINE_CAP = 12;

/* ==================================================================== */
/* The gate — local, free, instant                                      */
/* ==================================================================== */

/* The gate verbs: physical combat & coercion + acrobatics & athletics +
 * stealth & infiltration + perception under pressure + social under
 * pressure + vehicles & mounts + craft & powers under pressure +
 * positioning verbs ("step", "move", "reach") that only count mid-fight.
 * Arbitrary verbs like "walk" or "say" are NOT here on purpose. */
export const DEFAULT_VERBS = [
  // Physical combat & coercion
  'punch', 'kick', 'stab', 'slash', 'shoot', 'swing', 'strike', 'grapple', 'tackle', 'shove',
  'dodge', 'parry', 'block', 'counter', 'counterattack', 'charge', 'lunge', 'feint', 'disarm',
  'headbutt', 'elbow', 'knee', 'slam', 'throw', 'pin', 'choke', 'strangle', 'stomp', 'smash',
  'bash', 'clobber', 'ambush', 'attack', 'fight', 'wrestle', 'duel', 'spar',
  'fire', 'snipe', 'draw', 'aim', 'loose', 'shoot',
  'brace', 'evade', 'deflect', 'riposte', 'bind', 'clinch', 'trip', 'sweep', 'hook', 'jab',
  'uppercut', 'pummel', 'flank', 'blitz', 'skewer', 'impale', 'cleave', 'gouge', 'headlock',
  'suppress', 'grappled',
  // Acrobatics & athletics
  'climb', 'leap', 'vault', 'dive', 'roll', 'flip', 'sprint', 'balance', 'tumble',
  'somersault', 'wall-run', 'rappel', 'swim', 'hoist', 'dangle', 'squeeze', 'crawl', 'slide',
  // Stealth & infiltration
  'sneak', 'pickpocket', 'swipe', 'steal', 'pick', 'disarm', 'sabotage', 'eavesdrop',
  'shadow', 'tail', 'infiltrate', 'slip', 'hide', 'lurk', 'prowl', 'skulk', 'smuggle',
  'conceal', 'stalk', 'case', 'crack', 'spoof', 'hotwire', 'bypass', 'disable', 'cloak', 'palm',
  // Perception under pressure
  'spot', 'listen',
  // Social under pressure
  'intimidate', 'threaten', 'interrogate', 'persuade', 'deceive', 'bluff', 'bribe',
  'charm', 'seduce', 'haggle', 'negotiate', 'fast-talk', 'coerce', 'flatter', 'appeal',
  'manipulate', 'pressure', 'comfort', 'calm', 'distract', 'pacify', 'placate', 'mollify', 'beguile',
  // Vehicles & mounts
  'drive', 'pilot', 'sail', 'gallop', 'jump',
  // Craft, medicine & powers under pressure
  'forge', 'brew', 'enchant', 'conjure', 'channel', 'transmute', 'stabilize', 'suture',
  'improvise', 'pick',
  // Positioning (mid-fight only)
  'step', 'move', 'reach',
];

/* Always-on action phrases that never sit in the verb list — they double
 * as hedge words ("just in case") and would make every cautious message a
 * check. */
export const ATTEMPT_RE = /\btry(?:ing)?\s+to\b|\battempt(?:s|ing|ed)?\s+to\b|\bgo(?:es|ing)?\s+for\b|\bmake\s+a\s+(?:grab|move|run|break|dash|lunge|swing|jump|leap|feint|play)\s+for\b|\btake\s+a\s+(?:swing|shot|stab|risk|chance)\b|\bset\s+about\b/i;

/* Positioning verbs only arm the gate when a fight is live. */
export const POSITIONING_VERBS = new Set(['step', 'move', 'reach']);

/* How much of the gate vocabulary arms the referee. */
/* How readily the gate arms. Conservative hears only clear attempt-phrases;
 * normal adds the gate verbs; aggressive also hears mid-fight positioning.
 * (A fight in progress always bypasses the gate entirely.) */
export const SENSITIVITY = {
  conservative: { words: true, verbs: false, positioning: false },
  normal: { words: true, verbs: true, positioning: false },
  aggressive: { words: true, verbs: true, positioning: true },
};

/* Out-of-character rejection: any (...) or [...] group — real OOC lives
 * there, and so does OOC commentary mixed into an in-character line. The
 * message's remaining text is still scanned, but a message that is ONLY
 * meta never reaches the referee (the chat path flags those separately). */
export const OOC_RE = /\([^)]*\)|\[[^\]]*\]/g;

/* The cast's lines can't trip the gate: strip quoted dialogue before
 * scanning, so "he growls 'I could kill you'" never reads as an attempt. */
export function stripDialogue(text) {
  return String(text || '')
    .replace(/"[^"]*"/g, ' ')
    .replace(/“[^”]*”/g, ' ')
    .replace(/‘[^’]*’/g, ' ')
    .replace(/\*[^*]*\*/g, (m) => m) // asterisk action beats stay — they ARE action
    .replace(/'[^']*'/g, ' ');
}

function verbHits(text, sensitivity) {
  const s = SENSITIVITY[sensitivity] || SENSITIVITY.normal;
  if (!s.verbs) return { hit: false, verb: null };
  const words = String(text || '').toLowerCase().match(/[a-z'-]+/g) || [];
  const inFight = false; // positioning handled by caller via gatePasses opts
  for (const w of words) {
    const stem = w.replace(/(ing|ed|es|s)$/, '');
    for (const v of DEFAULT_VERBS) {
      const vstem = v.replace(/(ing|ed|es|s)$/, '');
      if (w === v || stem === vstem || w.startsWith(vstem)) {
        if (POSITIONING_VERBS.has(v)) {
          if (s.positioning) return { hit: true, verb: v };
          continue;
        }
        return { hit: true, verb: v };
      }
    }
  }
  return { hit: false, verb: null };
}

/* The gate verdict for one player message.
 *   text:        the raw message (OOC and dialogue stripped inside)
 *   sensitivity: 'conservative' | 'normal' | 'aggressive'
 *   inFight:     a duel/battle/war is live — the gate is bypassed
 * Returns {pass, reason} — reason feeds the ledger line. */
export function gatePasses(text, sensitivity, opts) {
  const inFight = Boolean(opts && opts.inFight);
  if (inFight) return { pass: true, reason: 'fight in progress — every beat is scored' };
  const raw = String(text || '');
  const meta = raw.replace(OOC_RE, ' ').trim();
  if (!meta) return { pass: false, reason: 'out of character' };
  const spoken = stripDialogue(meta);
  if (!spoken.trim()) return { pass: false, reason: 'only dialogue' };
  const s = SENSITIVITY[sensitivity] || SENSITIVITY.normal;
  if (s.words && ATTEMPT_RE.test(spoken)) return { pass: true, reason: 'attempt phrase' };
  const v = verbHits(spoken, sensitivity);
  if (v.hit) return { pass: true, reason: 'gate verb "' + v.verb + '"' };
  return { pass: false, reason: 'no attempt' };
}

/* A stable hash of the message text — the committed-fate cache key. Not
 * cryptographic; just needs to distinguish swipes from edits. */
/* A stable hash of the message text — the committed-fate cache key. Not
 * cryptographic; just needs to distinguish swipes from edits. Wording-stable
 * by design: case and whitespace differences are NOT a new world, but any
 * real change of words is (M9's wording-stability law, carried forward). */
export function userMessageHash(text) {
  const s = String(text || '').trim().replace(/\s+/g, ' ').toLowerCase();
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0;
  }
  return 'm' + h.toString(36) + 'x' + s.length;
}

/* ==================================================================== */
/* The micro-referee prompts                                            */
/* ==================================================================== */

const TIER_LIST = 'trivial, easy, moderate, hard, extreme, mook, trained, elite, formidable, inferior, peer, superior';

const RATING_GUIDE = [
  'Ratings are 0-10. Guide — untrained 2, competent 5, veteran 6, master 8, legendary 9, apex 10. Doubt means lower.',
  '1-2 clumsy, hopeless. 3-4 a hobbyist, trained mook. 5 an even chance, dependable under pressure. 6 dangerous, honed.',
  '7 famous for it. 8 among the best alive. 9 myth made flesh. 10 unbeatable — reserve it for the truly unmatched.',
  'Ruthlessly honest. Most people are 3-5 at most things.',
].join(' ');

const JSON_ONLY = 'Output one raw JSON object and nothing else. No prose, no markdown, no code fences.';

const NARRATIVE_RULES = [
  'Never talk about this adjudication. No dice, odds, DCs, or rules-speak anywhere.',
  'Never re-decide an outcome the house has already committed to.',
].join(' ');

/* Fields the model fills. actor is HARDENED in code to the player. */
const MC_FIELD = '"actor": the player\'s name exactly as it appears in <player>, or "you" if none is given. Always the player — never a companion, never the opposition.';
const ACTION_FIELD = '"action": a short, vivid, mechanical-only description of the attempt in THIS message. No outcome words.';
const SHEET_FIELD = '<sheet>: known actor ratings, 0-10. The player\'s name may appear here. Ratings are permanent.';
const RECENT_FIELD = '<recent>: recent story, oldest first. Learn who the player is from it.';
const GUARD_FIELD = '"playerGuard": null, or the specific established defense or deterrent the player is actively maintaining this beat — only when the message keeps it up. Short.';
const COUNTER_FIELD = '"counterPath": null, or one honest way the opposition could still threaten the player without breaking the playerGuard. Short.';
const GUARD_RULE = 'A guard only counts if the player\'s message maintains it. Fresh dialogue does not retire an old guard; a clearly contradictory action does.';
const OPP_RATING_FIELD = '"opponent_rating": null, or a 0-10 estimate for a NEW opponent not in <sheet>. ' + RATING_GUIDE;
const TEAM_ROSTER_FIELD = (name) => '"' + name + '": array of named characters on that side THIS message puts in the fight. Short names, "Bandit x3" style counts allowed.';
const WAR_COMMANDER_FIELD = '"enemy_commander": the enemy commander\'s name if this opens a war, else null.';
const CONDITION_FIELD = '"condition_change": null, or {"who": name, "add": short label, "mod": integer -4..+2, "domain": melee|ranged|social|intellect|stealth|craft|null, "gear": true|false, "remove": label|null} for a persistent consequence of THIS beat — a lasting wound, a curse, a gear pickup. Only what the story just established; null otherwise.';
const COMPOSURE_FIELD = '"composure_change": null, or {"who": name, "delta": integer -3..+2} for acute mental strain THIS beat causes — terror, horror, a breaking moment — or its relief. Ordinary bruises are not composure.';

const SITUATION_FIELD = [
  '"situation": "task" | "opposed" | "fight_opening" | "fight_ongoing" | "war".',
  'task — unopposed feat. opposed — someone contests it. fight_opening — this message opens combat: an attack, an ambush, or squaring up with clear hostile intent.',
  'fight_ongoing — already in a fight. war — army-scale: the player commands formations.',
].join(' ');

const TIER_FIELD = '"tier": for a task, the difficulty — ' + TIER_LIST.split(', ').slice(0, 5).join(', ') + '. For opposed or a fight, the opposition — mook, trained, elite, formidable, or relative to the actor: inferior, peer, superior.';

const DUEL_START_FIELD = '"duel_start": null, or {"opponent": name, "domain": melee|ranged|null, "rating": 0-10|null, "scale": integer -4..4 (player bigger = positive)} when a one-on-one fight opens.';
const BATTLE_START_FIELD = '"battle_start": null, or {' + TEAM_ROSTER_FIELD('allies') + ', ' + TEAM_ROSTER_FIELD('enemies') + ', "domain": melee|ranged|null} when a party-scale fight opens.';
const WAR_START_FIELD = '"war_start": null, or {' + TEAM_ROSTER_FIELD('allies') + ', ' + TEAM_ROSTER_FIELD('enemies') + ', ' + WAR_COMMANDER_FIELD + '} when an army-scale engagement opens.';

/* The micro-referee's whole brief — Arbiter's ADJ_SYSTEM, Cozy voice.
 * check:false is the honest ruling for talk, taunts, future tense,
 * preparation, OOC, and recaps: nothing is attempted, nothing is scored. */
export const ADJ_SYSTEM = [
  'You are the referee of a story. Read the player\'s message and decide, briefly and mechanically, what — if anything — is genuinely being risked THIS beat, and who or what stands against it.',
  'check:true only when the player ACTS on something chancy RIGHT NOW: an attack, a gamble, a sneak, a leap, a press against opposition. The attempt must be stated in the message, in the present.',
  'check:false for everything else:',
  '- Talk, taunts, threats, boasts, and declarations of intent — quoted or not — are not attempts. "I\'ll kill you" kills nobody.',
  '- Future tense, plans, wishes, and hypotheticals ("I\'m going to…", "we should…", "if he moves I\'ll…") are not attempts.',
  '- Preparation and positioning without risk — drawing a sword, standing up, walking over, readying — is not an attempt unless the readiness itself is contested.',
  '- Out-of-character notes, questions about the story, and recaps of what already happened are never attempts.',
  '- A request to the storyteller ("describe…", "what do I see?") is not an attempt.',
  'When in doubt, check:false. The story continues unruled far more often than it is ruled.',
  NARRATIVE_RULES,
  JSON_ONLY,
  'The JSON shape:',
  '{',
  '"check": true or false,',
  MC_FIELD,
  ACTION_FIELD,
  '"kind": "task" | "actor",',
  '"domain": melee | ranged | social | intellect | stealth | craft | null — the arena this attempt plays in,',
  '"opposition": for kind actor, the opponent\'s name; for kind task, a difficulty word — ' + TIER_LIST + ',',
  TIER_FIELD,
  '"circumstance": integer -3..+3 for this beat\'s immediate tilt (positioning, surprise, exhaustion, help). 0 unless the fiction clearly argues otherwise,',
  '"stakes": one short phrase on what failure costs, or null,',
  GUARD_FIELD,
  COUNTER_FIELD,
  GUARD_RULE,
  OPP_RATING_FIELD,
  DUEL_START_FIELD,
  BATTLE_START_FIELD,
  WAR_START_FIELD,
  CONDITION_FIELD,
  COMPOSURE_FIELD,
  '}',
].join('\n');

/* In-fight prompts: every beat is scored; the referee only reads the move. */
export const DUEL_SYSTEM = [
  'You are the referee of a one-on-one duel already in progress. Read the player\'s move THIS beat.',
  '"exchange": false when the message is talk, a taunt, a pause, a yield, an attempt to surrender or flee-talk, or anything that risks nothing in the fight. Also false when the message ends the fight by agreement or interruption.',
  '"combat_ended": true when this beat closes the duel — a yield accepted, flight, rescue, collapse, interruption. The engine also ends fights itself; only mark what the story shows.',
  '"move": "attack" for strikes, grapples, shots, and aggressive maneuvers; "recover" for disengaging to catch breath, bind a wound, or regain footing — recovering cedes tempo and invites a free counter; "talk" scores nothing.',
  '"sequence": null, or a list of 2-4 {"strike": short label, "circumstance": -3..+3} when the message commits to a described combo. A combo is ONE exchange, not free extra attacks.',
  '"opponent_switch": null, or the new opponent\'s name if the player disengages and squares up against someone else.',
  NARRATIVE_RULES,
  JSON_ONLY,
  '{ "exchange": true|false, "combat_ended": true|false, ' + ACTION_FIELD + ' "move": "attack"|"recover"|"talk", "circumstance": -3..+3, "sequence": null|[…], "opponent_switch": null|name, ' + GUARD_FIELD + ' ' + COUNTER_FIELD + ' ' + CONDITION_FIELD + ' ' + COMPOSURE_FIELD + ' }',
].join('\n');

export const BATTLE_SYSTEM = [
  'You are the referee of a battle already in progress — a party-scale fight. Read the player\'s beat.',
  '"exchange": false for talk, taunts, pauses, and anything risking nothing. "combat_ended": true when the story closes the engagement.',
  '"move": {"kind": "attack"|"command", "target": enemy name|null, "circumstance": -3..+3} — command means the player directs allies rather than striking.',
  '"target": the enemy the player engages, if named or clearly meant, else null.',
  NARRATIVE_RULES,
  JSON_ONLY,
  '{ "exchange": true|false, "combat_ended": true|false, ' + ACTION_FIELD + ' "move": {"kind": "attack"|"command", "target": null|name, "circumstance": -3..+3}, ' + CONDITION_FIELD + ' ' + COMPOSURE_FIELD + ' }',
].join('\n');

export const WAR_SYSTEM = [
  'You are the referee of a war already in progress — the player commands formations at army scale. Read the order THIS beat.',
  '"exchange": false for talk, councils, pauses, and anything that risks nothing on the field. "combat_ended": true when the story closes the engagement.',
  '"move": {"kind": "maneuver"|"stratagem"|"personal", "acting": allied formation|null, "target": enemy formation|null, "circumstance": -3..+3} — maneuver orders a formation, stratagem reshapes the field (fire, flood, feigned retreat), personal means the commander fights in person.',
  NARRATIVE_RULES,
  JSON_ONLY,
  '{ "exchange": true|false, "combat_ended": true|false, ' + ACTION_FIELD + ' "move": {"kind": "maneuver"|"stratagem"|"personal", "acting": null|name, "target": null|name, "circumstance": -3..+3}, ' + CONDITION_FIELD + ' ' + COMPOSURE_FIELD + ' }',
].join('\n');

/* The sheet seeder — background, first turns and post-fight. */
export const SEED_SYSTEM = [
  'You keep the cast sheet of a story: how everyone measures, 0-10, plus what ails them.',
  'Read the transcript. For every named character (including the player\'s), give a default rating and any clearly-shown domain ratings (melee, ranged, social, intellect, stealth, craft). ' + RATING_GUIDE,
  'Add conditions only for lasting, story-established facts — a wound still carried, a curse, signature gear — with a small modifier (-4..+2) and an optional domain tag.',
  'Also name the player character as the story shows them (player_story_name), so rulings can speak their name.',
  JSON_ONLY,
  '{ "player_story_name": string|null, "actors": [ { "name": string, "default": 0-10, "domains": {"melee": 0-10, …}, "conditions": [ {"name": string, "mod": int, "domain": string|null} ] } ] }',
].join('\n');

/* ==================================================================== */
/* The micro-call — worker connection, cold, small, one retry           */
/* ==================================================================== */

async function callRefereeOnce(connection, system, user, signal) {
  /* M28: the one wire path (agents/call.js) — thinking OFF per house, cold,
   * small. A refused call throws here and callReferee reads that as '' —
   * on the send path a failure means no ruling this turn, never a stall. */
  if (!connection || typeof connection !== 'object') return '';
  const { text } = await callWorker(connection, { system, user, maxTokens: MAX_TOKENS, effort: 'off', signal });
  return text;
}

/* Strict JSON via the shared balanced-brace walker, then exactly ONE retry
 * on malformed output. Returns the parsed object or null. */
async function callReferee(connection, system, user, signal, callLLM) {
  const call = callLLM || callRefereeOnce;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let raw = '';
    try {
      raw = await call(connection, system, user, signal);
    } catch (err) {
      raw = '';
    }
    if (signal && signal.aborted) return null;
    const parsed = parseFirstObject(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    if (attempt === 0) user = user + '\n\n' + JSON_ONLY;
  }
  return null;
}

/* ==================================================================== */
/* Prompt assembly                                                      */
/* ==================================================================== */

function clip(text, max) {
  const t = String(text || '').trim();
  return t.length > max ? t.slice(t.length - max) : t;
}

function pageText(msg) {
  const page = msg && msg.pages && msg.pages[msg.page];
  return (page && page.text) || '';
}

function sheetBlock(state) {
  const actors = (state.sheet && state.sheet.actors) || {};
  const lines = [];
  for (const name of Object.keys(actors).slice(0, 12)) {
    const a = actors[name];
    if (!a || typeof a !== 'object') continue;
    const parts = [];
    if (Number.isFinite(a.default)) parts.push('default ' + a.default);
    const doms = a.domains && typeof a.domains === 'object' ? a.domains : {};
    for (const d of Object.keys(doms).slice(0, 6)) {
      if (Number.isFinite(doms[d])) parts.push(d + ' ' + doms[d]);
    }
    const conds = Array.isArray(a.conditions) && a.conditions.length
      ? ' | ' + a.conditions.map((c) => c.name + ' ' + (c.mod >= 0 ? '+' : '') + c.mod + (c.domain ? ' ' + c.domain : '')).join(', ')
      : '';
    lines.push(name + ': ' + (parts.join(', ') || 'unrated') + conds);
  }
  return lines.length ? lines.join('\n') : '(empty — no one is rated yet)';
}

function recentBlock(history, max) {
  const tail = (history || []).filter((m) => m && !m.hidden).slice(-6);
  return tail.map((m) => {
    const who = m.role === 'user' ? 'Player' : 'Story';
    return who + ': ' + clip(pageText(m), 400);
  }).join('\n') || '(none yet)';
}

function buildRefereeUser({ state, userText, history, fightLine }) {
  return [
    '<player>' + mcName(state) + '</player>',
    '<sheet>\n' + sheetBlock(state) + '\n</sheet>',
    fightLine ? '<fight>' + fightLine + '</fight>' : null,
    '<recent>\n' + recentBlock(history) + '\n</recent>',
    '<action>' + clip(userText, 800) + '</action>',
  ].filter(Boolean).join('\n');
}

/* ==================================================================== */
/* Normalization — everything the model says is untrusted               */
/* ==================================================================== */

function clampInt(v, lo, hi, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
}

function cleanName(v, max) {
  const s = String(v || '').trim().slice(0, max || 60);
  return s || null;
}

function normalizeRoster(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => cleanName(x, 50)).filter(Boolean).slice(0, 12);
}

function normalizeConditionChange(v, state) {
  if (!v || typeof v !== 'object') return null;
  const out = { who: cleanName(v.who, 60) };
  if (!out.who) return null;
  if (v.remove) out.remove = cleanName(v.remove, 50);
  if (v.add) {
    out.add = cleanName(v.add, 50);
    out.mod = clampInt(v.mod, -4, 2, -1);
    if (v.domain && typeof v.domain === 'string') out.domain = v.domain.toLowerCase().trim().slice(0, 20);
    if (v.gear === true) out.gear = true;
  }
  if (!out.add && !out.remove) return null;
  return out;
}

function normalizeComposureChange(v, state) {
  if (!v || typeof v !== 'object') return null;
  const who = cleanName(v.who, 60);
  const delta = clampInt(v.delta, -3, 2, 0);
  if (!who || !delta) return null;
  return { who, delta };
}

/* The opening-call normalization, with the identity hardening ported
 * wholesale: the actor is ALWAYS the player, the opposition is NEVER an MC
 * alias (a self-target gets rewritten to the world). */
export function normalizeAdj(obj, state) {
  if (!obj || typeof obj !== 'object') return null;
  const out = {
    check: obj.check === true,
    actor: mcName(state),
    action: cleanName(obj.action, 280),
    kind: obj.kind === 'actor' ? 'actor' : 'task',
    opposition: cleanName(obj.opposition, 60) || 'moderate',
    tier: cleanName(obj.tier, 20) || null,
    circumstance: clampInt(obj.circumstance, -3, 3, 0),
    stakes: cleanName(obj.stakes, 120),
    playerGuard: cleanName(obj.playerGuard, 120),
    counterPath: cleanName(obj.counterPath, 120),
    opponent_rating: Number.isFinite(Number(obj.opponent_rating)) ? clamp(Number(obj.opponent_rating), 0, 10) : null,
    duel_start: null,
    battle_start: null,
    war_start: null,
    condition_change: normalizeConditionChange(obj.condition_change, state),
    composure_change: normalizeComposureChange(obj.composure_change, state),
  };
  if (!out.action) out.check = false;
  if (out.kind === 'actor' && isMcAlias(state, out.opposition)) {
    out.kind = 'task';
    out.opposition = out.tier || 'moderate';
  }
  const ds = obj.duel_start;
  if (ds && typeof ds === 'object' && cleanName(ds.opponent, 60) && !isMcAlias(state, ds.opponent)) {
    out.duel_start = {
      opponent: cleanName(ds.opponent, 60),
      domain: combatDomain(ds.domain),
      rating: Number.isFinite(Number(ds.rating)) ? clamp(Number(ds.rating), 0, 10) : null,
      scale: clampInt(ds.scale, -4, 4, 0),
    };
  }
  const bs = obj.battle_start;
  if (bs && typeof bs === 'object') {
    const enemies = normalizeRoster(bs.enemies).filter((n) => !isMcAlias(state, n));
    if (enemies.length) {
      out.battle_start = {
        allies: normalizeRoster(bs.allies).filter((n) => !isMcAlias(state, n)),
        enemies,
        domain: combatDomain(bs.domain),
        scale: clampInt(bs.scale, -4, 4, 0),
      };
    }
  }
  const ws = obj.war_start;
  if (ws && typeof ws === 'object') {
    const enemies = normalizeRoster(ws.enemies);
    const allies = normalizeRoster(ws.allies).filter((n) => !isMcAlias(state, n));
    if (enemies.length && allies.length) {
      out.war_start = {
        allies,
        enemies,
        enemyCommander: cleanName(ws.enemy_commander, 60),
        scale: clampInt(ws.scale, -4, 4, 0),
      };
    }
  }
  return out;
}

function normalizeMove(raw, kinds, fallbackKind) {
  const mv = raw && typeof raw === 'object' ? raw : {};
  const kind = kinds.includes(mv.kind) ? mv.kind : fallbackKind;
  const out = {
    kind,
    circumstance: clampInt(mv.circumstance, -3, 3, 0),
    target: cleanName(mv.target, 60),
    acting: cleanName(mv.acting, 60),
  };
  return out;
}

export function normalizeDuelAdj(obj, state) {
  if (!obj || typeof obj !== 'object') return null;
  const out = {
    exchange: obj.exchange !== false,
    combat_ended: obj.combat_ended === true,
    action: cleanName(obj.action, 280) || 'presses the fight',
    move: ['attack', 'recover', 'talk'].includes(obj.move) ? obj.move : 'attack',
    circumstance: clampInt(obj.circumstance, -3, 3, 0),
    sequence: null,
    opponent_switch: cleanName(obj.opponent_switch, 60),
    playerGuard: cleanName(obj.playerGuard, 120),
    counterPath: cleanName(obj.counterPath, 120),
    condition_change: normalizeConditionChange(obj.condition_change, state),
    composure_change: normalizeComposureChange(obj.composure_change, state),
  };
  if (Array.isArray(obj.sequence) && obj.sequence.length >= 2) {
    const seq = obj.sequence.slice(0, 4).map((s) => ({
      strike: cleanName(s && s.strike, 80) || 'a strike',
      circumstance: clampInt(s && s.circumstance, -3, 3, 0),
    }));
    if (seq.length >= 2) out.sequence = seq;
  }
  if (out.move === 'talk') out.exchange = false;
  return out;
}

export function normalizeBattleAdj(obj, state) {
  if (!obj || typeof obj !== 'object') return null;
  const mv = normalizeMove(obj.move, ['attack', 'command'], 'attack');
  return {
    exchange: obj.exchange !== false,
    combat_ended: obj.combat_ended === true,
    action: cleanName(obj.action, 280) || 'fights on',
    move: mv,
    playerGuard: cleanName(obj.playerGuard, 120),
    counterPath: cleanName(obj.counterPath, 120),
    condition_change: normalizeConditionChange(obj.condition_change, state),
    composure_change: normalizeComposureChange(obj.composure_change, state),
  };
}

export function normalizeWarAdj(obj, state) {
  if (!obj || typeof obj !== 'object') return null;
  const mv = normalizeMove(obj.move, ['maneuver', 'stratagem', 'personal'], 'maneuver');
  return {
    exchange: obj.exchange !== false,
    combat_ended: obj.combat_ended === true,
    action: cleanName(obj.action, 280) || 'holds the line',
    move: mv,
    condition_change: normalizeConditionChange(obj.condition_change, state),
    composure_change: normalizeComposureChange(obj.composure_change, state),
  };
}

/* ==================================================================== */
/* The math — lone checks (fights live in engine/duels.js)              */
/* ==================================================================== */

/* A lone check: the actor's rating against the world (a difficulty tier) or
 * an opponent (their sheet rating, the referee's estimate, or a relative
 * tier). The roll is REAL (crypto) and ties never apply — tieCheck is for
 * fighting exchanges only. */
export function resolveCheck(state, adj, eng) {
  const pEntry = findActor(state, adj.actor);
  const domain = adj.domain || null;
  const aR = ratingFor(pEntry, domain, eng.defaultRating);
  let oR;
  if (adj.kind === 'actor') {
    const oEntry = findActor(state, adj.opposition);
    if (oEntry) oR = ratingFor(oEntry, domain, eng.defaultRating);
    else if (Number.isFinite(adj.opponent_rating)) oR = clamp(adj.opponent_rating, 0, 10);
    else oR = tierRating(adj.tier || 'trained', aR);
  } else {
    oR = tierRating(adj.tier || adj.opposition || 'moderate', aR);
  }
  const delta = clamp(aR - oR + adj.circumstance + composurePenalty(state, eng) + eng.preset.bonus, -13, 13);
  const P = probFromDelta(delta);
  const u = rngFloat();
  const tier = sliceOutcome(P, u, eng.preset.mods);
  return { tier, aR, oR, delta, P, u };
}

/* ==================================================================== */
/* Escalation — opening and closing fights through apply.js, so the     */
/* mode ledger and the undo trail always know                            */
/* ==================================================================== */

function engineForMutations(eng, settings) {
  return {
    preset: (settings && settings.preset) || 'realistic',
    fightStyle: eng.style,
    duelPoise: eng.duelPoise,
    defaultRating: eng.defaultRating,
    tieBand: eng.tieBand,
    composureMax: eng.composureMax,
    warStrength: eng.warStrength,
  };
}

/* ==================================================================== */
/* The committed-fate timeline                                          */
/* ==================================================================== */

function clonePlain(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

function takeSnapshot(state) {
  return {
    duel: clonePlain(state.duel),
    battle: clonePlain(state.battle),
    composure: typeof state.composure === 'number' ? state.composure : undefined,
    turn: state.turn,
  };
}

function restoreSnapshot(state, snap) {
  if (!snap) return;
  state.duel = clonePlain(snap.duel);
  state.battle = clonePlain(snap.battle);
  state.composure = snap.composure;
  if (typeof snap.turn === 'number') state.turn = snap.turn;
}

/* Rewind the world to just before the earliest timeline entry whose message
 * is gone (deleted or branched away), then drop that entry and everything
 * after it. */
function pruneRefTimeline(state, presentIds, currentId) {
  const hist = Array.isArray(state.refHistory) ? state.refHistory : [];
  if (!hist.length) return;
  let cut = -1;
  for (let i = 0; i < hist.length; i += 1) {
    const e = hist[i];
    if (!e || typeof e !== 'object') { cut = i; break; }
    if (e.msgId && e.msgId !== currentId && !presentIds.has(e.msgId)) { cut = i; break; }
  }
  if (cut === -1) return;
  restoreSnapshot(state, hist[cut].snap);
  state.refHistory = hist.slice(0, cut);
}

function commitRef(state, entry) {
  const hist = Array.isArray(state.refHistory) ? state.refHistory : [];
  hist.push(entry);
  while (hist.length > TIMELINE_CAP) hist.shift();
  state.refHistory = hist;
}

/* ==================================================================== */
/* The turn                                                             */
/* ==================================================================== */

/* Adjudicate one player message, pre-generation. Never throws.
 *
 *   {connection}   worker connection (null → degrade)
 *   {userText}     the raw player message text
 *   {userId}       the message's id (timeline identity)
 *   {history}      the chat as it stands (for pruning and <recent>)
 *   {state}        the story state (mutated in place; caller saves)
 *   {settings}     {sensitivity, preset, fightStyle, engine knobs…}
 *   {signal}       the caller's budget
 *   {callLLM}      test seam — replaces the network call
 *
 * Returns {state, ruling, status, why}:
 *   ruling = {kind, tier, words, directive, at} or null
 *   status = 'ruled' | 'no-check' | 'replayed' | 'degraded' | 'skipped'      */
export async function refereeStep({ connection, userText, userId, history, state, settings, signal, callLLM } = {}) {
  try {
    if (!state || typeof state !== 'object') return { state, ruling: null, status: 'degraded', why: 'no state' };
    const eng = engineSettings(settings);
    const text = String(userText || '');
    const key = userMessageHash(text);
    state.refHistory = Array.isArray(state.refHistory) ? state.refHistory : [];
    const presentIds = new Set(
      (history || []).filter((m) => m && m.role === 'user' && !m.hidden && m.id).map((m) => m.id)
    );

    /* Deleted or branched-away suffixes rewind the world with them. */
    pruneRefTimeline(state, presentIds, userId);

    /* Edited text is a new world: same message, different hash — rewind to
     * before the original turn, drop the old commitment, roll fresh. */
    const editIdx = state.refHistory.findIndex((e) => e && e.msgId === userId && e.key !== key);
    if (editIdx !== -1) {
      restoreSnapshot(state, state.refHistory[editIdx].snap);
      state.refHistory = state.refHistory.slice(0, editIdx);
    }

    /* Committed fate: swipes and regenerates replay the SAME verdict. */
    const committed = state.refHistory.filter((e) => e && e.key === key && (!e.msgId || e.msgId === userId)).pop();
    if (committed) {
      return { state, ruling: committed.verdict || null, status: 'replayed', why: 'committed fate replayed' };
    }

    /* A fight the engine already declared over lets go on the next beat —
     * estimates persist, injuries move to the body ledger, mode clears. */
    if ((state.duel && state.duel.over) || (state.battle && state.battle.over)) {
      const applied = applyMutations(state, [{ type: 'combat.end', engine: engineForMutations(eng, settings) }]);
      state = applied.state;
      state.seedDueAfterFight = true;
    }

    const fightOn = duelActive(state) || battleActive(state);
    const snap = takeSnapshot(state);
    const commit = (verdict) => commitRef(state, { key, msgId: userId || null, verdict: verdict || null, snap, at: Date.now() });

    /* #roll / #skip — demoted to optional overrides on the gate. */
    const forceRoll = /(?:^|\s)#roll\b/i.test(text);
    const forceSkip = /(?:^|\s)#skip\b/i.test(text);
    if (forceSkip && !fightOn) {
      commit(null);
      return { state, ruling: null, status: 'skipped', why: '#skip' };
    }

    const gate = gatePasses(text, (settings && settings.sensitivity) || 'normal', { inFight: fightOn });
    if (!gate.pass && !forceRoll) {
      passiveComposureRecovery(state, eng);
      commit(null);
      return { state, ruling: null, status: 'no-check', why: gate.reason };
    }

    if (!connection) {
      return { state, ruling: null, status: 'degraded', why: 'no worker connection' };
    }

    const fightLine = renderFightLine(state);
    const user = buildRefereeUser({ state, userText: text, history, fightLine });
    const inWar = battleActive(state) && state.battle.kind === 'war';
    const inBattle = battleActive(state) && !inWar;
    const inDuel = duelActive(state);
    const system = withFictionFrame(inWar ? WAR_SYSTEM : inBattle ? BATTLE_SYSTEM : inDuel ? DUEL_SYSTEM : ADJ_SYSTEM);
    const normalize = inWar ? normalizeWarAdj : inBattle ? normalizeBattleAdj : inDuel ? normalizeDuelAdj : normalizeAdj;

    const raw = await callReferee(connection, system, user, signal, callLLM);
    if (!raw) return { state, ruling: null, status: 'degraded', why: 'no usable answer' };
    if (signal && signal.aborted) return { state, ruling: null, status: 'degraded', why: 'timed out' };
    const adj = normalize(raw, state);
    if (!adj) return { state, ruling: null, status: 'degraded', why: 'answer failed identity checks' };

    /* Lasting consequences the referee recorded land BEFORE the roll, so a
     * wound taken this beat already shifts this beat's math. */
    const sideNotes = [];
    if (adj.condition_change) {
      const note = applyConditionChange(state, adj.condition_change);
      if (note) sideNotes.push(note);
    }
    if (adj.composure_change) {
      const cc = adj.composure_change;
      if (isMcAlias(state, cc.who)) {
        const res = applyComposureChange(state, cc.delta, eng);
        if (res) {
          sideNotes.push(res.worsened
            ? 'The strain tells on ' + mcName(state) + ' — ' + res.state + '. Let it show, without numbers.'
            : mcName(state) + ' steadies — ' + res.state + '. Let it show, without numbers.');
        }
      } else {
        const unit = state.duel
          ? [state.duel.player, state.duel.opp]
          : state.battle ? [...(state.battle.allies || []), ...(state.battle.enemies || [])] : [];
        const hit = (unit || []).find((u) => u && u.name && samePersonName(u.name, cc.who));
        if (hit && typeof hit.composure === 'number') {
          hit.composure = clamp(hit.composure + cc.delta, 0, hit.composureMax || hit.composure);
        }
      }
    }
    const withNotes = (directive) => (sideNotes.length ? directive + '\n' + sideNotes.join('\n') : directive);

    const ruling = (kind, tier, directive) => ({ kind, tier, words: TIER_MEANING[tier] || String(tier || ''), directive, at: Date.now() });

    const closeFight = async (kindLabel) => {
      const applied = applyMutations(state, [{ type: 'combat.end', engine: engineForMutations(eng, settings) }]);
      state = applied.state;
      state.seedDueAfterFight = true;
      const v = ruling(kindLabel, 'CLOSED', [
        RULED_HEAD + ' — the fight is over: ' + adj.action + '.',
        'Tell the winding-down the story has earned, honestly, from everything that came before. Nothing further is decided for you.',
        'No rolls, no numbers, no word of this note.',
      ].join('\n'));
      commit(v);
      return { state, ruling: v, status: 'ruled', why: 'combat ended by the story' };
    };

    const lull = (kindLabel) => {
      const v = ruling(kindLabel, 'LULL', [
        fightLine || RULED_HEAD + ' — the fight stands.',
        'This beat risks nothing in the fight: ' + adj.action + '.',
        'Tell it exactly as written — but the fight itself is not decided this beat. No one lands, yields, or falls unless the words themselves already did it. End on the live tension.',
        'No rolls, no numbers, no word of this note.',
      ].join('\n'));
      commit(v);
      return { state, ruling: v, status: 'ruled', why: 'a beat without risk' };
    };

    /* ---- a war in progress ---- */
    if (inWar) {
      if (adj.combat_ended) return closeFight('war');
      if (!adj.exchange) return lull('war');
      const out = resolveWarRound(state, adj.move, eng);
      const tier = out.focalRes ? out.focalRes.tier : 'STALEMATE';
      const v = ruling('war', tier, withNotes(buildWarDirective(state, adj, out)));
      commit(v);
      return { state, ruling: v, status: 'ruled', why: 'war round' };
    }

    /* ---- a battle in progress ---- */
    if (inBattle) {
      if (adj.combat_ended) return closeFight('battle');
      if (!adj.exchange) return lull('battle');
      const out = resolveBattleRound(state, adj.move, eng);
      const tier = out.mcRes ? out.mcRes.tier : 'STALEMATE';
      const v = ruling('battle', tier, withNotes(buildBattleDirective(state, adj, out)));
      commit(v);
      return { state, ruling: v, status: 'ruled', why: 'battle round' };
    }

    /* ---- a duel in progress ---- */
    if (inDuel) {
      if (adj.combat_ended) return closeFight('duel');
      if (!adj.exchange) return lull('duel');
      if (adj.opponent_switch && !isMcAlias(state, adj.opponent_switch)) {
        startDuel(state, {
          playerName: mcName(state), oppName: adj.opponent_switch,
          domain: state.duel ? state.duel.domain : 'melee', oppEstimate: null, scaleMismatch: 0,
        }, eng);
        state.duel.round = 1;
      }
      let res;
      let directive;
      if (adj.sequence) {
        res = resolveDuelSequence(state, adj, eng);
        directive = buildDuelSequenceDirective(state, adj, res);
      } else {
        res = resolveDuelExchange(state, adj.circumstance, adj.move, eng);
        directive = buildDuelDirective(state, adj, res);
      }
      const v = ruling('duel', res.tier, withNotes(directive));
      commit(v);
      return { state, ruling: v, status: 'ruled', why: 'duel round' };
    }

    /* ---- the opening call ---- */
    if (!adj.check) {
      /* ARMED without rolling: a fight joins on a declaration — the standoff
       * binds, nothing is scored. */
      const begin = adj.war_start ? { type: 'combat.begin', kind: 'war', ...adj.war_start }
        : adj.battle_start ? { type: 'combat.begin', kind: 'battle', ...adj.battle_start }
          : adj.duel_start ? { type: 'combat.begin', kind: 'duel', ...adj.duel_start } : null;
      if (begin) {
        begin.engine = engineForMutations(eng, settings);
        const applied = applyMutations(state, [begin]);
        state = applied.state;
        if (state.duel || state.battle) {
          const v = ruling('armed', 'ARMED', withNotes(buildArmedDirective(state, adj)));
          commit(v);
          return { state, ruling: v, status: 'ruled', why: 'fight joined — armed, nothing rolled' };
        }
      }
      passiveComposureRecovery(state, eng);
      commit(null);
      return { state, ruling: null, status: 'no-check', why: 'the referee saw nothing to score' };
    }

    if (adj.war_start) {
      const applied = applyMutations(state, [{ type: 'combat.begin', kind: 'war', ...adj.war_start, engine: engineForMutations(eng, settings) }]);
      state = applied.state;
      if (state.battle) {
        const mv = { kind: 'maneuver', acting: null, target: null, circumstance: adj.circumstance };
        const out = resolveWarRound(state, mv, eng);
        const tier = out.focalRes ? out.focalRes.tier : 'STALEMATE';
        const v = ruling('war', tier, withNotes(buildWarDirective(state, adj, out)));
        commit(v);
        return { state, ruling: v, status: 'ruled', why: 'war opens' };
      }
    }

    if (adj.battle_start) {
      const applied = applyMutations(state, [{ type: 'combat.begin', kind: 'battle', ...adj.battle_start, engine: engineForMutations(eng, settings) }]);
      state = applied.state;
      if (state.battle) {
        const mv = { kind: 'attack', target: null, circumstance: adj.circumstance };
        const out = resolveBattleRound(state, mv, eng);
        const tier = out.mcRes ? out.mcRes.tier : 'STALEMATE';
        const v = ruling('battle', tier, withNotes(buildBattleDirective(state, adj, out)));
        commit(v);
        return { state, ruling: v, status: 'ruled', why: 'battle opens' };
      }
    }

    if (adj.duel_start) {
      const applied = applyMutations(state, [{
        type: 'combat.begin', kind: 'duel',
        opponent: adj.duel_start.opponent, domain: adj.duel_start.domain,
        opponentRating: adj.duel_start.rating != null ? adj.duel_start.rating : adj.opponent_rating,
        scaleMismatch: adj.duel_start.scale,
        engine: engineForMutations(eng, settings),
      }]);
      state = applied.state;
      if (state.duel) {
        const res = resolveDuelExchange(state, adj.circumstance, 'attack', eng);
        const v = ruling('duel', res.tier, withNotes(buildDuelDirective(state, adj, res)));
        commit(v);
        return { state, ruling: v, status: 'ruled', why: 'duel opens' };
      }
    }

    const res = resolveCheck(state, adj, eng);
    const v = ruling('check', res.tier, withNotes(buildDirective(adj, res)));
    commit(v);
    return { state, ruling: v, status: 'ruled', why: 'a lone check' };
  } catch (err) {
    return { state, ruling: null, status: 'degraded', why: 'referee fault' };
  }
}

/* ==================================================================== */
/* Background seeding — the sheet fills itself in the quiet moments     */
/* ==================================================================== */

/* Seed the actor sheet from the transcript: on the first turns (once the
 * story has a few beats and the sheet is still empty) and after any fight
 * lets go. Background only — never on the critical path, never throws. */
export async function maybeSeedSheet({ connection, storyId, signal, callLLM } = {}) {
  try {
    if (!connection || !storyId) return { ok: false };
    const state = await loadState(storyId);
    if (!state) return { ok: false };
    const actors = (state.sheet && state.sheet.actors) || {};
    const empty = Object.keys(actors).length === 0;
    const due = state.seedDueAfterFight === true;
    if (!empty && !due) return { ok: false, why: 'not due' };
    const messages = (await db.messages.list(storyId)).filter((m) => m && !m.hidden);
    if (messages.length < 4) return { ok: false, why: 'too early' };
    const transcript = messages.slice(-12).map((m) => {
      const who = m.role === 'user' ? 'Player' : 'Story';
      return who + ': ' + clip(pageText(m), 600);
    }).join('\n');
    const user = '<transcript>\n' + transcript + '\n</transcript>\n<sheet>\n' + sheetBlock(state) + '\n</sheet>';
    const parsed = await callReferee(connection, withFictionFrame(SEED_SYSTEM), user, signal, callLLM);
    if (!parsed || typeof parsed !== 'object') return { ok: false, why: 'no usable answer' };
    state.sheet = state.sheet && typeof state.sheet === 'object' ? state.sheet : { actors: {}, playerName: '' };
    if (!state.sheet.actors || typeof state.sheet.actors !== 'object') state.sheet.actors = {};
    if (typeof parsed.player_story_name === 'string' && parsed.player_story_name.trim()) {
      const nm = parsed.player_story_name.trim().slice(0, 60);
      /* M28: a name the ledger already knows — from the founding read
       * (mc.set) or the hand — is never clobbered by a seeder's guess. */
      const known = typeof state.sheet.playerName === 'string' ? state.sheet.playerName.trim() : '';
      if (!known) state.sheet.playerName = nm;
    }
    let touched = 0;
    const list = Array.isArray(parsed.actors) ? parsed.actors.slice(0, 16) : [];
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue;
      const name = safeKey(raw.name);
      if (!name) continue;
      const existing = state.sheet.actors[findActorKey(state, name) || name];
      /* Hand-kept entries win; the seeder only fills or refreshes its own
       * (_auto / _estimated) work. */
      if (existing && !existing._auto && !existing._estimated) continue;
      const entry = {
        default: clampInt(raw.default, 0, 10, ENGINE_DEFAULTS.defaultRating),
        domains: {},
        _auto: true,
      };
      if (raw.domains && typeof raw.domains === 'object') {
        for (const d of Object.keys(raw.domains).slice(0, 8)) {
          const v = Number(raw.domains[d]);
          if (Number.isFinite(v)) entry.domains[d.toLowerCase().trim().slice(0, 20)] = clamp(v, 0, 10);
        }
      }
      if (Array.isArray(raw.conditions) && raw.conditions.length) {
        entry.conditions = raw.conditions.slice(0, 6).map((c) => ({
          name: String(c && c.name || '').slice(0, 50),
          mod: clampInt(c && c.mod, -4, 2, -1),
          ...(c && c.domain ? { domain: String(c.domain).toLowerCase().slice(0, 20) } : {}),
        })).filter((c) => c.name);
      }
      state.sheet.actors[findActorKey(state, name) || name] = entry;
      touched += 1;
    }
    state.seedDueAfterFight = false;
    await saveState(storyId, state);
    notify(storyId);
    return { ok: true, touched };
  } catch (err) {
    return { ok: false };
  }
}
