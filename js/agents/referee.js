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
import { isHere } from '../engine/names.js'; /* M398 */
import { pageText as wirePageText } from '../assemble/stack.js'; /* M174: the one reader of a page's words */
import { withFictionFrame } from './voice.js'; /* M21: the workers never break the fiction */
import { callWorker } from './call.js'; /* M28: the one wire path for workers */
import { applyMutations, storyTurn } from '../engine/apply.js';
import { loadState, saveState, notify } from '../engine/state.js';
import { findPersonKey, importanceOf } from '../engine/people.js'; /* M345: the seeder and the referee read who people ARE */
import { renderBodies } from '../engine/bodies.js';
import { renderCanon } from '../engine/canon.js';
import { writerText, wholePage, BRIEF_ROOM, CAST_ROOM } from '../engine/whole.js';
import { loadMemory, recordFor } from './memory.js';
import { contextOf } from '../providers/room.js';
import { db } from '../store.js';
import {
  clamp, probFromDelta, sliceOutcome, rngFloat, TIER_MEANING, presetFor,
} from '../engine/referee-math.js';
import {
  ENGINE_DEFAULTS, engineSettings, mcName, isMcAlias, samePersonName,
  findActor, findActorKey, findActorKeyExact, findActorKeySamePerson, reconcilePlayerEntries, safeKey, ratingFor, tierRating, combatDomain,
  composurePenalty, applyComposureChange,
  passiveComposureRecovery, applyConditionChange,
  duelActive, battleActive, startDuel, resolveDuelExchange, resolveDuelSequence,
  resolveBattleRound, resolveWarRound,
  buildDirective, buildDuelDirective, buildDuelSequenceDirective, buildArmedDirective,
  buildBattleDirective, buildWarDirective, buildFightOverDirective, buildLullDirective, renderFightLine,
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
/* M471: THE GATE READ THROUGH CONTRACTIONS. The port stripped '…' between straight apostrophes as if it were speech,
 * so "I don't hesitate — I lunge at him and slash low, and I won't stop" reached the gate as "I don t stop" and no
 * fight opened. Arbiter never touched straight apostrophes. As Arbiter (v0.42): a spoken run is "…" or “…” on one
 * line, four hundred characters at most (an unclosed quote can never eat the rest of the message); the curly single
 * pair ‘…’ is speech too (a right single quote alone — I’m, won’t — never opens one). */
export function stripDialogue(text) {
  return String(text || '')
    .replace(/"[^"\n]{0,400}"/g, ' ')
    .replace(/\u201C[^\u201D\n]{0,400}\u201D/g, ' ')
    .replace(/\u2018[^\u2019\n]{0,400}\u2019/g, ' ');
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

/* M345: Arbiter v0.42's rating scale, for ANY combatant — a person, a beast, a monster, a machine */
const RATING_GUIDE = [
  'Ratings are 0-10, by effective threat, for ANY kind of combatant — a person, a beast, a monster, a machine, an alien: 2 untrained, 4 trained, 5 a competent professional, 6 a veteran, 7 elite, 8 a master, 9 legendary, 10 apex.',
  'Rate a creature by how dangerous it is, not its species: a feral dog 3, a trained warhound 5, a dire beast 7, an ancient dragon or apex monster 9-10.',
  'Ruthlessly honest: most ordinary people are 3-5 at most things, and doubt means lower — but a named rival, antagonist or boss the player faces in a serious fight is a PEER of the player or stronger unless the story plainly shows otherwise.',
].join(' ');

const JSON_ONLY = 'Output one raw JSON object and nothing else. No prose, no markdown, no code fences.';

const NARRATIVE_RULES = [
  'Never talk about this adjudication. No dice, odds, DCs, or rules-speak anywhere.',
  'Never re-decide an outcome that is already settled.',
].join(' ');

/* Fields the model fills. actor is HARDENED in code to the player. */
const MC_FIELD = '"actor": the player\'s name exactly as it appears in <player>, or "you" if none is given. Always the player — never a companion, never the opposition, never the storyteller.';
const ACTION_FIELD = '"action": a short, vivid, mechanical-only description of the attempt in THIS message, 3-10 words. No outcome words.';
/* M345: Arbiter v0.34's established defenses, word for word in meaning — shared by every schema so they are judged the same */
const GUARD_FIELD = '"playerGuard": null, or an ACTIVE protection the player is MAINTAINING this beat per the ESTABLISHED story — a total or partial defense the story has already defined (an untouchable barrier, a ward, intangibility, a shield-art, armour of the world\'s own rules). State it as a CONSTRAINT, e.g. "Infinity holds: nothing physical reaches his body; only the sword\'s veil is lowered". Null when no such stated defense is up.';
const COUNTER_FIELD = '"counterPath": null, or — set ONLY with playerGuard — the ONE honest way the opposition can still harm or truly pressure the player THIS beat despite that guard, rooted in the established story (the exposed blade can be seized; the ground under him can be shattered; the veil must widen the instant he commits, and that instant can be struck). If the guard forecloses every path this beat, null — never invent one to seem fair.';
const GUARD_RULE = '- playerGuard / counterPath: read the ESTABLISHED story, not genre habit. When a maintained guard forecloses direct harm and you find NO honest counterPath, the opposition cannot land contact this beat — a bad result then means the player\'s OWN attempt failing (read, evaded, stopped), ground or tempo lost, or the guard strained, never an impossible touch. A real counterPath both licenses the opposition\'s side of the outcome AND is exactly what the telling must name. A guard the opposition has no answer to is also strong POSITIVE circumstance for the player\'s safety — though their own attack through or around it can still fail on its merits. A standing, always-on defense the story has established (an ambient barrier, a permanent ward) REMAINS playerGuard even while the player ATTACKS — set it every beat until the story shows it dropped, spent, or bypassed.';
/* M345: Arbiter v0.36 — a wound that is only narrated does nothing */
const COND_RECONCILE_RULE = '- Lasting damage MUST be registered, never merely narrated: if the recent story shows EITHER side carrying an UNREGISTERED persistent state — impaled, a maimed or unusable limb, heavy blood loss, pinned under wreckage, poisoned, disarmed — file condition_change for it NOW as a catch-up, even if it arose beats ago. A registered wound lowers that fighter\'s effective rating every beat; an unregistered one does nothing, leaving a half-dead foe fighting at full strength. NEVER pour lasting damage into circumstance: circumstance is ONLY what is transient about THIS beat beyond what registered conditions already cover — re-awarding a registered wound as circumstance counts it twice.';
const DIRTY_RULE = '- circumstance is PHYSICAL advantage only: position, momentum, surprise, preparation, an exposed target, terrain, impairment, haste. NEVER penalize a move for being illegal, a foul, dirty, dishonourable, unsporting or immoral, and never mention rules, sanctions or penalties — you do not know this world\'s rules; whether a move is allowed is the story\'s to tell, not yours to score. A dirty move that gives a real physical edge (a groin kick, sand in the eyes, a sucker punch) is POSITIVE circumstance. Judge only what works.';
const TWO_SIDED_RULE = '- circumstance is TWO-SIDED and impartial: weigh what the opposition is doing as much as the player. If the opposition has the better position, has set a trap, is pressing an advantage, or is simply the more dangerous fighter seizing control, that is NEGATIVE circumstance for the player even when the player\'s own move is sound. A good move into a worse position still nets negative. Judge as a neutral observer, never from the player\'s hopes.';
const OPPONENT_RULE = '- The opposition is WHOEVER the story says the player is up against in <recent>/<action>; use that name, with the <sheet> spelling when they are on it. Never substitute a different sheet name because it is familiar. The opposition is NEVER the player: no part of the player\'s name — given name or surname — is ever the opposition or an opponent. The opposition is a PERSON or a creature — never a place, a school, a house, a faction or an organisation.';
const OPP_RATING_FIELD = '"opponent_rating": null, or a 0-10 estimate — ONLY when a fight opens against someone NOT in <sheet>, from the scene and what is said of them. ' + RATING_GUIDE;
const TEAM_ROSTER_FIELD = (name) => '"' + name + '": array of named characters on that side THIS message puts in the fight, the player left out. Short names; "Bandit x3" style counts for unnamed groups.';
const WAR_COMMANDER_FIELD = '"enemy_commander": the enemy commander\'s name if this opens a war, else null.';
const CONDITION_FIELD = '"condition_change": null, or {"who": name, "add": short label, "mod": integer -4..+3, "domain": melee|ranged|social|intellect|stealth|craft|null, "gear": true|false, "remove": label|null} for a persistent consequence THIS beat establishes or resolves — a lasting wound, poison, a curse, exhaustion that lasts, a disarm; or gear picked up, lost or broken (a fine blade +1, a legendary weapon +2 or +3, gear:true so healing never strips it). Only what lasts beyond this scene; domain = the ONE domain it touches, null for the whole body. null otherwise.';
const COMPOSURE_FIELD = '"composure_change": null, or {"who": name, "delta": integer -3..+2} — the mental toll or relief of THIS moment: negative when someone faces horror, terror, gruesome death, dread, betrayal or crushing loss (a mild shock -1, witnessing atrocity -2, mind-shattering horror -3), or when the player\'s action frightens, awes or demoralizes an opponent; positive on safety, rest, reassurance or a grounding victory. The story\'s emotional weight, independent of any outcome; ordinary bruises are not composure.';

const SITUATION_FIELD = [
  '"situation": "task" | "opposed" | "fight_opening" | "fight_ongoing" | "war".',
  'task — unopposed feat. opposed — someone contests it. fight_opening — this message opens combat: an attack, an ambush, or squaring up with clear hostile intent.',
  'fight_ongoing — already in a fight. war — army-scale: the player commands formations.',
].join(' ');

const TIER_FIELD = '"tier": for a task, the difficulty — ' + TIER_LIST.split(', ').slice(0, 5).join(', ') + '. For opposed or a fight, the opposition — mook, trained, elite, formidable, or relative to the actor: inferior, peer, superior.';

const SCALE_FIELD = '"scale": integer -4..4 — ONLY when the two sides are CATEGORICALLY mismatched in size, mass or power (a human against a dragon, a foot soldier against a war-machine, a child against a bear), from the PLAYER\'s side: strongly negative when the player is hopelessly outmatched by something vast (a normal human attacking a dragon head-on: -3 or -4), strongly positive when the player is the vast one; 0 when both are roughly the same scale, however their skill differs. An equalizer in the story (a dragon-slaying spear, a machine of their own, an exposed weak point) shrinks it.';
const DUEL_START_FIELD = '"duel_start": null, or {"opponent": name, "domain": melee|ranged|null, "rating": 0-10|null, "allies": array of named characters fighting BESIDE the player against this opponent (empty when the player fights alone), ' + SCALE_FIELD + '} — when combat between the player and ONE named person truly OPENS: an actual strike, lunge, shot, grapple or power unleashed AT them (even a quick or lopsided one), OR both sides clearly squared up — blades drawn, stances taken, the duel accepted — though nothing has been swung yet (then check:false: the fight joins, nothing is decided). For an actual attack on a person, prefer the duel to a lone check.';
const BATTLE_START_FIELD = '"battle_start": null, or {' + TEAM_ROSTER_FIELD('allies') + ', ' + TEAM_ROSTER_FIELD('enemies') + ', "domain": melee|ranged|null, "scale": -4..4} — when MORE THAN TWO people are in the fight: several opponents at once, the player attacking a GROUP ("sweep through the guards"), OR anyone fighting BESIDE the player against even one enemy (two against one is a battle, never a duel — list the companions under allies); unnamed foes get a fitting squad with a count ("Guard x3"). Skirmish scale, a handful a side — not armies.';
const WAR_START_FIELD = '"war_start": null, or {' + TEAM_ROSTER_FIELD('allies') + ', ' + TEAM_ROSTER_FIELD('enemies') + ', ' + WAR_COMMANDER_FIELD + ', "scale": -4..4} — when the player takes COMMAND of army-scale fighting, ordering formations; name formations from the story (2-5 a side), inventing sensible ones if unnamed. Both lists must be filled.';

/* The micro-referee's whole brief — Arbiter's ADJ_SYSTEM (v0.42), in Cozy's JSON shape.
 * check:false is the honest ruling for talk, taunts, future tense, preparation, OOC, and recaps. */
export const ADJ_SYSTEM = [
  'You are the referee of a story. Read the player\'s message and decide, briefly and mechanically, what — if anything — is genuinely being risked THIS beat, and who or what stands against it. You NEVER decide success or failure — only the parameters.',
  'check:true only when THIS message commits an attempt whose outcome is genuinely uncertain RIGHT NOW: an attack, a gamble, a sneak, a leap, a press against opposition. A message that merely promises, prepares, discusses or recalls an action attempts nothing.',
  'check:false for everything else:',
  '- Dialogue, taunts, boasts, threats, banter and negotiation — talk is talk, even mid-standoff and even with a blade drawn. "I\'ll kill you" kills nobody. Routine actions with no real chance of an interesting failure; pure narration; actions by anyone other than the player.',
  '- Declarations and intent: future tense, plans, wishes and hypotheticals ("I will…", "I\'m going to…", "we should…", "if he moves I\'ll…") and negations ("I\'m not going to use my full power") describe what MAY happen — nothing is attempted now.',
  '- Preparation and posture: drawing or sheathing a weapon, taking position, a stance, sizing someone up, or powering up or readying an ability WITHOUT releasing it at anyone. These can still OPEN a fight — see duel_start.',
  '- Out-of-character or directorial text: bracketed notes, questions to the storyteller, "what would <character> do", a request to describe something, instructions about the scene.',
  '- What is already resolved: restating or recapping what earlier pages settled is not a new attempt — never rule twice on what has already happened.',
  'When in doubt, check:false. The story continues unruled far more often than it is ruled.',
  '- domain: the SKILL the act actually uses, chosen by its PHYSICAL nature — a strike, punch, kick, feint, swing or grapple is melee (never stealth just because it is a feint or sneaky); a shot or a throw is ranged; moving unseen is stealth; persuasion or intimidation is social. Prefer a domain the player has on <sheet> when it fits.',
  DIRTY_RULE,
  OPPONENT_RULE,
  GUARD_RULE,
  COND_RECONCILE_RULE,
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
  '"circumstance": integer -3..+3 for this beat\'s immediate physical tilt (positioning, surprise, exhaustion, help). 0 unless the story clearly argues otherwise,',
  '"stakes": one short phrase on what failure costs, or null,',
  '"why": one short clause on what tilts this beat — the reason behind circumstance and tier (positioning, surprise, the opponent\'s edge, help at hand), or null,',
  GUARD_FIELD,
  COUNTER_FIELD,
  OPP_RATING_FIELD,
  DUEL_START_FIELD,
  BATTLE_START_FIELD,
  WAR_START_FIELD,
  CONDITION_FIELD,
  COMPOSURE_FIELD,
  '}',
].join('\n');

/* In-fight prompts: every beat is scored; the referee only reads the move. (Arbiter's DUEL_SYSTEM, v0.42) */
export const DUEL_SYSTEM = [
  'You are the referee of a one-on-one duel already in progress. Score the player\'s move THIS beat. You NEVER decide who wins — only the parameters.',
  '- While the OPPONENT is actively attacking or pressing this beat, every player turn IS an exchange — words do not parry steel. A passive, hesitant, talking or purely defensive turn UNDER ATTACK is an exchange ("exchange": true, "move": "attack") at NEGATIVE circumstance, never exchange:false. The player cannot stall a pressing opponent by talking.',
  '- "exchange": false ONLY when NEITHER side commits an attack this beat: a mutual standoff or measuring-up, talk or terms while circling, a stance or readying without contact, a declaration of what the player WILL or WON\'T do, out-of-character or directorial text, or a recap of what earlier pages already resolved.',
  '- "combat_ended": true ONLY when the story has already clearly ended the fight this beat — a yield accepted, flight, rescue, collapse, separation, or the scene leaving combat.',
  '- "move": "attack" for strikes, grapples, shots, aggressive manoeuvres and defensive counters that still contest the opponent; "recover" when the player DISENGAGES to restore themselves — healing on themselves, catching their breath, a defensive reset, mending their own wounds (it regains footing but yields tempo: the opponent acts freely); "talk" only for a beat that is not an exchange at all.',
  '- For "recover", circumstance is how SAFELY they can recover: unopposed with a reliable method +2; snatched under pressure with the enemy closing -2. Recovery never fails into damage — at worst it barely helps.',
  '- "sequence": fill it ONLY when the player\'s single message is a genuine CHAIN of 2+ distinct offensive sub-actions meant to land in order (disrupt his spell, THEN a groin kick, THEN an elbow). Each strike gets its own circumstance, judged on its OWN footing given what came before AND the opponent reacting between strikes. A chain is HIGH-RISK: a late strike is only as good as the setup that survived to it. 2-4 strikes; null for a single action — never invent a chain the player did not write, and still fill "action"/"circumstance" for the move as a whole.',
  '- "opponent_switch": null, or the new opponent\'s name if the player disengages and squares up against someone else.',
  '- "joins": null, or {"allies": [names], "enemies": [names]} — named characters who ENTER the fight THIS beat on either side (a companion stepping in beside the player, reinforcements arriving for the opponent), the player left out. null when nobody new joins. A duel with a companion in it is a battle from then on.',
  '- "why": one short clause on what tilts this beat — the reason behind circumstance (the press, the footing, surprise, help at hand), or null.',
  DIRTY_RULE,
  TWO_SIDED_RULE,
  GUARD_RULE,
  COND_RECONCILE_RULE,
  '- condition_change is available MID-FIGHT: set it when THIS exchange establishes or resolves something persistent on EITHER fighter (a wound beyond the exchange, poison taking hold, a disarm, gear seized or broken).',
  '- composure_change works both ways: the player\'s action frightening, awing or demoralizing the opponent ("who": the opponent, negative), or terror and horror shaking the player.',
  NARRATIVE_RULES,
  JSON_ONLY,
  '{ "exchange": true|false, "combat_ended": true|false, ' + ACTION_FIELD + ' "move": "attack"|"recover"|"talk", "circumstance": -3..+3, "why": null|short clause, "sequence": null|[{"strike": short label, "circumstance": -3..+3}], "opponent_switch": null|name, "joins": null|{"allies": [names], "enemies": [names]}, ' + GUARD_FIELD + ' ' + COUNTER_FIELD + ' ' + CONDITION_FIELD + ' ' + COMPOSURE_FIELD + ' }',
].join('\n');

export const BATTLE_SYSTEM = [
  'You are the referee of a battle already in progress — a party-scale fight. Read the player\'s beat. You NEVER decide who wins — only the parameters.',
  '- "exchange": false only for talk, councils, pauses and anything that risks nothing while nobody presses; under attack, a talking or hesitant turn is still an exchange at negative circumstance. "combat_ended": true only when the story has already closed the engagement.',
  '- "move": {"kind": "attack"|"command", "target": enemy name|null, "domain": the skill the player\'s OWN act rests on this beat, "circumstance": -3..+3} — command means the player directs allies rather than striking; target is the enemy the player engages, if named or clearly meant; domain is melee or ranged when the player strikes, and for a command the skill the order rests on — summoning for summoned creatures, tactics or command for troops, a magic or power domain for a spell — ALWAYS a domain the player has on <sheet> when one fits.',
  '- AN ORDER IS A MOVE, NEVER A PAUSE: when the player sends, commands, unleashes or directs anyone on their side to attack — summons, companions, troops — that beat is "exchange": true with "move": {"kind": "command"}, even though the player swings nothing themselves. The allies act on the order this round.',
  '- "joins": null, or {"allies": [names], "enemies": [names]} — named characters who ENTER the fight THIS beat on either side, the player left out; null when nobody new joins.',
  '- "why": one short clause on what tilts this beat — the reason behind circumstance, or null.',
  DIRTY_RULE,
  TWO_SIDED_RULE,
  GUARD_RULE,
  COND_RECONCILE_RULE,
  NARRATIVE_RULES,
  JSON_ONLY,
  '{ "exchange": true|false, "combat_ended": true|false, ' + ACTION_FIELD + ' "move": {"kind": "attack"|"command", "target": null|name, "domain": null|skill, "circumstance": -3..+3}, "why": null|short clause, "joins": null|{"allies": [names], "enemies": [names]}, ' + GUARD_FIELD + ' ' + COUNTER_FIELD + ' ' + CONDITION_FIELD + ' ' + COMPOSURE_FIELD + ' }',
].join('\n');

export const WAR_SYSTEM = [
  'You are the referee of a war already in progress — the player commands formations at army scale. Read the order THIS beat. You NEVER decide who wins — only the parameters.',
  '- "exchange": false for talk, councils, pauses and anything that risks nothing on the field. "combat_ended": true only when the story has already closed the engagement.',
  '- "move": {"kind": "maneuver"|"stratagem"|"personal", "acting": allied formation|null, "target": enemy formation|null, "circumstance": -3..+3} — maneuver orders a formation; stratagem reshapes the field (fire, flood, a feigned retreat); personal means the commander fights in person. circumstance weighs how tactically sound the order is against what the enemy is doing — skill matters, but never dwarfs the units themselves.',
  DIRTY_RULE,
  TWO_SIDED_RULE,
  GUARD_RULE,
  COND_RECONCILE_RULE,
  NARRATIVE_RULES,
  JSON_ONLY,
  '{ "exchange": true|false, "combat_ended": true|false, ' + ACTION_FIELD + ' "move": {"kind": "maneuver"|"stratagem"|"personal", "acting": null|name, "target": null|name, "circumstance": -3..+3}, "why": null|short clause, ' + GUARD_FIELD + ' ' + COUNTER_FIELD + ' ' + CONDITION_FIELD + ' ' + COMPOSURE_FIELD + ' }',
].join('\n');

/* M345: THE CAST SHEET, SEEDED WITH ITS EYES OPEN. The writer's sheet had his main character missing and the paper bag
 * over Jovan's head filed under Kaelen. The seeder had been handed twelve page-tails labelled \"Player:\"/\"Story:\" and
 * asked to name the player — nobody told it who the player IS, and it saw neither the brief, the people's pages nor the
 * record — so it guessed. It is told now (<player>), shown what the ledger knows (the brief, every person's page,
 * their bodies, the record, the newest pages whole), and asked the way Arbiter v0.42 asks: the story's own hierarchy,
 * the whole named cast, the current level, people only. */
export const SEED_SYSTEM = [
  'You keep the cast sheet of a story: how capable each person is, 0-10, at the things that decide contests — and the lasting harm or gear that changes it.',
  RATING_GUIDE,
  'CALIBRATE TO THE STORY\'S OWN HIERARCHY: if the setting has ranks, tiers, classes or a pecking order (school rankings, tournament seeding, dueling classes, a military chain, a stated power scale), place each person WITHIN it — someone at or near the top belongs at 7-9 even when words like "student" or "young" make them sound junior. Read the ranking, not the job title. The brief outranks every page.',
  'Rate each person at their CURRENT level as of the newest page. If the story shows someone has trained, grown or unlocked new power since <sheet> was written, rate the new, higher level.',
  'Domains are lowercase single words — melee, ranged, stealth, social, athletics, intellect, willpower, pilot, craft; others only when the story clearly needs them. 2-4 per person is plenty.',
  '"lasting": ONLY what the story has established that changes what a person can DO in a contest — a wound still carried, an illness, a curse, exhaustion that lasts, or signature gear (a masterwork blade, enchanted armour). NEVER clothing, a disguise, a mask, a look, a mood or a habit. mod -4..+3 (harm negative, good gear positive); domain = the ONE domain it touches (a sword: melee), null for the whole body; gear true for equipment. File each on the person who actually carries it.',
  'WHO IS WHO: <player> names the main character — the person the writer plays. The writer\'s pages ARE that person acting: "I", "me" and "you" in them mean the main character, never anyone else, and anything the writer\'s pages do or wear is the main character\'s. The FIRST entry in "actors" is always the main character, under exactly the name <player> gives. Never make an entry for "you", "I", "the player" or "the writer".',
  'Include EVERY named person in <people> and <brief> — allies, rivals, mentors, family, anyone who recurs — not only those on the newest pages. A large cast is expected; nobody is dropped to save space. Merge obvious duplicates and aliases into one entry, under the name <people> uses.',
  'People and creatures ONLY: never an entry for a place, a school, a house, a clan, a faction, a team, an organisation or a title.',
  JSON_ONLY,
  '{ "player_story_name": string|null, "actors": [ { "name": string, "default": 0-10, "domains": {"melee": 0-10, …}, "lasting": [ {"name": string, "mod": int, "domain": string|null, "gear": true|false} ] } ] }',
].join('\n');

/* ==================================================================== */
/* The micro-call — worker connection, cold, small, one retry           */
/* ==================================================================== */

async function callRefereeOnce(connection, system, user, signal, maxTokens = MAX_TOKENS) {
  /* M28: the one wire path (agents/call.js) — thinking OFF per house, cold,
   * small. A refused call throws here and callReferee reads that as '' —
   * on the send path a failure means no ruling this turn, never a stall. */
  if (!connection || typeof connection !== 'object') return '';
  const { text } = await callWorker(connection, { system, user, maxTokens, signal });
  return text;
}

/* Strict JSON via the shared balanced-brace walker, then exactly ONE retry
 * on malformed output. Returns the parsed object or null. */
async function callReferee(connection, system, user, signal, callLLM, maxTokens = MAX_TOKENS, usable = null) {
  const call = callLLM || callRefereeOnce;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let raw = '';
    try {
      raw = await call(connection, system, user, signal, maxTokens);
    } catch (err) {
      raw = '';
    }
    if (signal && signal.aborted) return null;
    const parsed = parseFirstObject(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (!usable || usable(parsed))) return parsed;
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

/* M174: THE REFEREE HAS BEEN RULING BLIND. This read msg.pages[msg.page] — a
 * message shape from another house entirely. A page here carries `text` and,
 * when it has versions, `swipes`/`swipeIdx`; there is no `pages` array and no
 * `page` index, so this returned '' for EVERY message and <recent> reached
 * the referee as "Player: \nStory: \nPlayer: " — three empty labels. It was
 * asked to judge what is genuinely being risked this beat with no sight of
 * the beat before it, on every contested moment the writer has ever played.
 * The house has one reader for a page's words; it is used here now. */
const pageText = wirePageText;

/* M345: THE REFEREE READS WHAT IT RULES ON. It was shown the last six pages cut to their last 400 characters, twelve
 * sheet rows, and no word of who anyone is. Arbiter v0.42 gives its referee the player's identity spelled out, the
 * whole sheet, the character card and the memory, and a full window. Here: the player block, the whole sheet (the
 * main character first), who is in the scene with their pages' first lines and what their bodies carry, the brief,
 * and the newest pages whole — the action itself never counted twice. */
const REF_BRIEF_ROOM = 12000;
const REF_PAGES = 8;
const REF_PAGE_CAP = 3000;

function sheetBlock(state) {
  const actors = (state.sheet && state.sheet.actors) || {};
  const keys = Object.keys(actors).sort((a, b) => (isMcAlias(state, b) ? 1 : 0) - (isMcAlias(state, a) ? 1 : 0)).slice(0, 60);
  const lines = [];
  for (const name of keys) {
    const a = actors[name];
    if (!a || typeof a !== 'object') continue;
    const parts = [];
    if (Number.isFinite(a.default)) parts.push('default ' + a.default);
    const doms = a.domains && typeof a.domains === 'object' ? a.domains : {};
    for (const d of Object.keys(doms).slice(0, 8)) {
      if (Number.isFinite(doms[d])) parts.push(d + ' ' + doms[d]);
    }
    const conds = Array.isArray(a.conditions) && a.conditions.length
      ? ' | ' + a.conditions.map((c) => c.name + ' ' + (c.mod >= 0 ? '+' : '') + c.mod + (c.domain ? ' ' + c.domain : '')).join(', ')
      : '';
    lines.push(name + (isMcAlias(state, name) && mcName(state) !== 'the player' ? ' (the player)' : '') + ': ' + (parts.join(', ') || 'unrated') + conds);
  }
  return lines.length ? lines.join('\n') : '(empty — no one is rated yet)';
}

function recentBlock(history, state, userText) {
  const mc = mcName(state);
  const pages = (history || []).filter((m) => m && !m.hidden);
  const last = pages[pages.length - 1];
  const upTo = last && last.role === 'user' && userMessageHash(pageText(last)) === userMessageHash(userText) ? pages.slice(0, -1) : pages;
  return upTo.slice(-REF_PAGES).map((m) => {
    const who = m.role === 'user' ? (mc === 'the player' ? 'The player' : mc + ' (the player)') : 'Story';
    return who + ': ' + wholePage(pageText(m), REF_PAGE_CAP);
  }).join('\n\n') || '(none yet)';
}

function hereBlock(state) {
  const present = (Array.isArray(state.present) ? state.present : []).map((p) => (typeof p === 'string' ? p : p && p.name)).filter(Boolean);
  const chars = state.characters && typeof state.characters === 'object' ? state.characters : {};
  const lines = [];
  for (const name of present.slice(0, 16)) {
    if (isMcAlias(state, name)) continue;
    const key = findPersonKey(chars, name);
    const core = key && chars[key] && typeof chars[key].core === 'string' ? chars[key].core.trim().replace(/\s+/g, ' ') : '';
    lines.push(name + (core ? ' — ' + (core.length > 400 ? core.slice(0, core.lastIndexOf(' ', 400)) + '…' : core) : ''));
  }
  let bodies = '';
  try { bodies = renderBodies(state.bodies, state.clock && state.clock.minutes, storyTurn(state)); } catch (err) { bodies = ''; }
  const locked = (() => { try { return renderCanon(state.canon, present); } catch (err) { return ''; } })();
  return [lines.join('\n'), bodies && bodies.trim() ? 'What their bodies carry:\n' + bodies.slice(0, 3000) : '', locked && locked.trim() ? 'Locked true:\n' + locked.slice(0, 3000) : ''].filter(Boolean).join('\n');
}

export function buildRefereeUser({ state, userText, history, fightLine, brief = '', castNotes = '' }) {
  const mc = mcName(state);
  const player = mc === 'the player'
    ? 'The player character is not named yet. The text in <action> is written BY the player: "I" and "you" in it both mean the player acting.'
    : 'The player character is "' + mc + '". The text in <action> is written BY the player: "I" and "you" in it both mean ' + mc + ' acting. The player may appear in <recent> under a fuller name, a title or a nickname — EVERY part of the player\'s name is the player, never a separate person and never the opponent. The storyteller\'s pages are not a combatant.';
  const here = hereBlock(state);
  const material = [String(brief || '').trim() ? writerText(brief, REF_BRIEF_ROOM, 'brief') : '', String(castNotes || '').trim() ? writerText(castNotes, Math.floor(REF_BRIEF_ROOM / 2), 'cast notes') : ''].filter(Boolean).join('\n\n');
  return [
    '<player>\n' + player + '\n</player>',
    '<sheet>\n' + sheetBlock(state) + '\n</sheet>',
    here ? '<here>\n' + here + '\n</here>' : null,
    material ? '<brief>\n' + material + '\n</brief>' : null,
    fightLine ? '<fight>' + fightLine + '</fight>' : null,
    '<recent>\n' + recentBlock(history, state, userText) + '\n</recent>',
    '<action>' + clip(userText, 2000) + '</action>',
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
    /* M471: as Arbiter — a piece of gear with no modifier given is a boon (+1), a condition a handicap (-1) */
    out.mod = clampInt(v.mod, -4, 3, v.gear === true ? 1 : -1);
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
const CHECK_DOMAINS = new Set(['melee', 'ranged', 'social', 'intellect', 'stealth', 'craft']);
function checkDomain(d) {
  const x = String(d == null ? '' : d).toLowerCase().trim();
  return CHECK_DOMAINS.has(x) ? x : null;
}

export function normalizeAdj(obj, state) {
  if (!obj || typeof obj !== 'object') return null;
  const out = {
    check: obj.check === true,
    actor: mcName(state),
    action: cleanName(obj.action, 280),
    kind: obj.kind === 'actor' ? 'actor' : 'task',
    /* M470: THE DOMAIN THE REFEREE NAMED WAS THROWN AWAY. The contract asked for "the arena this attempt plays in"
     * and the normaliser never read it, so every lone check rolled on the character's DEFAULT rating — a melee 8
     * swordsman forcing a door, a social 9 diplomat persuading, all at the default. Fights took their own domain and
     * were never affected. */
    domain: checkDomain(obj.domain),
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
  out.why = cleanName(obj.why, 160); /* M470: the referee's reason, for the ledger's account */
  const ds = obj.duel_start;
  if (ds && typeof ds === 'object' && cleanName(ds.opponent, 60) && !isMcAlias(state, ds.opponent)) {
    /* M470: TWO AGAINST ONE IS A BATTLE. A duel_start that names companions beside the player is drawn up as a battle
     * with those allies and this one enemy — the duel engine has one seat a side, so an ally named there was simply
     * dropped and the writer's team fought one at a time. */
    const companions = normalizeRoster(ds.allies).filter((n) => !isMcAlias(state, n) && !samePersonName(n, ds.opponent));
    if (companions.length && !(obj.battle_start && typeof obj.battle_start === 'object')) {
      out.battle_start = {
        allies: companions,
        enemies: [cleanName(ds.opponent, 60)],
        domain: combatDomain(ds.domain),
        scale: clampInt(ds.scale, -4, 4, 0),
        scaleMismatch: clampInt(ds.scale, -4, 4, 0),
        oppEstimate: Number.isFinite(Number(ds.rating)) ? clamp(Number(ds.rating), 0, 10) : null,
      };
    } else {
      out.duel_start = {
        opponent: cleanName(ds.opponent, 60),
        domain: combatDomain(ds.domain),
        rating: Number.isFinite(Number(ds.rating)) ? clamp(Number(ds.rating), 0, 10) : null,
        scale: clampInt(ds.scale, -4, 4, 0),
        scaleMismatch: clampInt(ds.scale, -4, 4, 0), /* M176: one spelling, every fight */
      };
    }
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
        /* M176: THE ODDS THE REFEREE READ WERE THROWN AWAY. combat.begin reads
         * `scaleMismatch`; the duel path mapped it by hand but the battle and
         * the war were SPREAD straight in, carrying only `scale` — so every
         * party fight and every war was scored on an even field, however
         * badly outmatched (or overwhelming) the referee had judged the two
         * sides to be. */
        scaleMismatch: clampInt(bs.scale, -4, 4, 0),
      };
    }
  }
  const ws = obj.war_start;
  if (ws && typeof ws === 'object') {
    /* M176: THE WRITER IS NEVER ON THE OTHER SIDE. The duel refuses an MC
     * opponent and the battle filters the main character out of BOTH
     * rosters; the war filtered only its allies, so a model that listed the
     * writer's own character among the enemy formations had them build a
     * unit out of him and the writer fought himself. The hardening this file
     * calls "ported wholesale" had a hole in exactly one of the three. */
    const enemies = normalizeRoster(ws.enemies).filter((n) => !isMcAlias(state, n));
    const allies = normalizeRoster(ws.allies).filter((n) => !isMcAlias(state, n));
    if (enemies.length && allies.length) {
      out.war_start = {
        allies,
        enemies,
        enemyCommander: (() => { const c = cleanName(ws.enemy_commander, 60); return c && !isMcAlias(state, c) ? c : null; })(),
        scale: clampInt(ws.scale, -4, 4, 0),
        scaleMismatch: clampInt(ws.scale, -4, 4, 0),
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
  /* M473: the skill the player's own act rests on this beat (a sheet domain, free-form: summoning, tactics, melee) */
  const domain = typeof mv.domain === 'string' ? mv.domain.trim().toLowerCase().slice(0, 24) : '';
  if (domain) out.domain = domain;
  return out;
}

/* M472: "#p" — exactly one beat (commands.js BEAT_RE, one definition kept here for the referee's own read) */
const BEAT_RE = /^\s*#p\s*$/i;

/* M472: the last committed beat of THIS fight, to be scored again — its move and target, its words; a fight with no
 * beat yet (joined on a declaration) takes a plain attack */
function continuedBeat(state, kind) {
  const hist = Array.isArray(state.refHistory) ? state.refHistory : [];
  let last = null;
  let declared = null; /* the words the fight was joined or paused on, when no beat has been scored yet */
  for (let i = hist.length - 1; i >= 0; i -= 1) {
    const v = hist[i] && hist[i].verdict;
    if (!v || !v.account || !v.account.fight) continue;
    if (['LULL', 'ARMED', 'CLOSED'].includes(v.tier)) { if (!declared && v.account.action) declared = v.account; continue; }
    last = v.account;
    break;
  }
  /* a fight joined on an order ("orders the summons to strike") continues as that order — a command, not a swing */
  if (!last && declared && isOrder(declared.action)) last = { action: declared.action, move: { kind: 'command', target: (declared.move && declared.move.target) || null } };
  const action = last && last.action ? 'goes on with it — ' + last.action : 'presses on';
  const why = 'the last beat, continued (#p)';
  if (kind === 'duel') {
    const move = last && typeof last.move === 'string' && ['attack', 'recover'].includes(last.move) ? last.move : 'attack';
    return { exchange: true, combat_ended: false, action, move, circumstance: 0, sequence: null, opponent_switch: null, joins: null, why, playerGuard: null, counterPath: null, condition_change: null, composure_change: null, continued: true };
  }
  if (kind === 'war') {
    const mv = last && last.move && typeof last.move === 'object' ? { kind: ['maneuver', 'stratagem', 'personal'].includes(last.move.kind) ? last.move.kind : 'maneuver', acting: last.move.acting || null, target: last.move.target || null, circumstance: 0 } : { kind: 'maneuver', acting: null, target: null, circumstance: 0 };
    return { exchange: true, combat_ended: false, action, move: mv, why, condition_change: null, composure_change: null, continued: true };
  }
  const mv = last && last.move && typeof last.move === 'object' ? { kind: last.move.kind === 'command' ? 'command' : 'attack', target: last.move.target || null, circumstance: 0 } : { kind: 'attack', target: null, circumstance: 0 };
  if (last && last.move && typeof last.move === 'object' && last.move.domain) mv.domain = last.move.domain; /* M473 */
  return { exchange: true, combat_ended: false, action, move: mv, joins: null, why, playerGuard: null, counterPath: null, condition_change: null, composure_change: null, continued: true };
}

/* M472: AN ORDER IS A MOVE. The writer: "if my MC doesn't fight and just orders an attack, the referee becomes
 * stupid" — his three summons were sent to strike and the beat was ruled a lull because the player himself swung
 * nothing. When the referee's own answer names a command (move.kind "command" in a battle; an acting unit or a target
 * in a war) or the words are an order to attack, the beat is an exchange, whatever exchange said. */
const ORDER_RE = /\b(?:order|orders|ordered|command|commands|commanded|direct|directs|directed|send|sends|sent|sic|sics|unleash|unleashes|unleashed|signal|signals|tell|tells|told|let|lets)\b[^.!?\n]{0,80}\b(?:attack|strike|charge|hit|kill|engage|fight|tear|rush|maul|fire|shoot|loose|flank|take)\b/i;
function isOrder(action) { return ORDER_RE.test(String(action || '')); }

/* M470: who enters the fight this beat — names only, the player never, nobody twice */
function normalizeJoins(raw, state) {
  if (!raw || typeof raw !== 'object') return null;
  const allies = normalizeRoster(raw.allies).filter((n) => !isMcAlias(state, n));
  const enemies = normalizeRoster(raw.enemies).filter((n) => !isMcAlias(state, n) && !allies.some((a) => samePersonName(a, n)));
  return allies.length || enemies.length ? { allies, enemies } : null;
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
    joins: normalizeJoins(obj.joins, state), /* M470 */
    why: cleanName(obj.why, 160), /* M470 */
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
  /* M345: words do not parry steel — a talking beat the referee still calls an exchange (the opponent presses) is
   * fought at a disadvantage; a talking beat that is no exchange is a lull */
  if (out.move === 'talk') {
    if (obj.exchange === true) { out.move = 'attack'; out.circumstance = Math.min(out.circumstance, -1); } else out.exchange = false;
  }
  return out;
}

export function normalizeBattleAdj(obj, state) {
  if (!obj || typeof obj !== 'object') return null;
  const mv = normalizeMove(obj.move, ['attack', 'command'], 'attack');
  const action = cleanName(obj.action, 280) || 'fights on';
  /* M472: an order to the allies is a move — a command in the answer, or the words of an order, make it an exchange */
  const ordered = mv.kind === 'command' || isOrder(action);
  if (ordered && mv.kind !== 'command' && !/\b(?:i|me|my|myself)\b[^.!?\n]{0,40}\b(?:strike|attack|hit|charge|lunge|swing|stab|slash|shoot)\b/i.test(action)) mv.kind = 'command';
  return {
    exchange: obj.exchange !== false || (ordered && obj.combat_ended !== true),
    combat_ended: obj.combat_ended === true,
    action,
    move: mv,
    joins: normalizeJoins(obj.joins, state), /* M470 */
    why: cleanName(obj.why, 160), /* M470 */
    playerGuard: cleanName(obj.playerGuard, 120),
    counterPath: cleanName(obj.counterPath, 120),
    condition_change: normalizeConditionChange(obj.condition_change, state),
    composure_change: normalizeComposureChange(obj.composure_change, state),
  };
}

export function normalizeWarAdj(obj, state) {
  if (!obj || typeof obj !== 'object') return null;
  const mv = normalizeMove(obj.move, ['maneuver', 'stratagem', 'personal'], 'maneuver');
  const action = cleanName(obj.action, 280) || 'holds the line';
  /* M472: an order with a formation or a target named is a move, whatever exchange said */
  const ordered = Boolean(mv.acting || mv.target) || isOrder(action);
  return {
    exchange: obj.exchange !== false || (ordered && obj.combat_ended !== true),
    combat_ended: obj.combat_ended === true,
    action,
    move: mv,
    why: cleanName(obj.why, 160), /* M470 */
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
  /* M400: THE FIGHT STYLE IS HIS EDGE, NOT THE WORLD'S. Heroic's +1 and its wider decisive / narrower disaster bands
   * (gritty's the reverse) are the main character's — fights and battles are rolled from his side already; a lone
   * check another person makes ("Renji tries to force the door") rolls as the world is, realistic. */
  const his = isMcAlias(state, adj.actor);
  const style = his ? eng.preset : presetFor('realistic');
  const delta = clamp(aR - oR + adj.circumstance + composurePenalty(state, eng) + style.bonus, -13, 13);
  const P = probFromDelta(delta);
  const u = rngFloat();
  const tier = sliceOutcome(P, u, style.mods);
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

/* M72: what the ruling left behind — the fight state AFTER this turn's
 * adjudication, kept on the commit so a replay can put it back. TRUE
 * rollback (M21) rewinds the ledger to the boundary before a turn on every
 * swipe and regenerate; the committed verdict rode again, but the duel it
 * opened, the composure it cost and the condition it recorded did not —
 * the words said "a duel" while the ledger held none. The commit's `snap`
 * is the world BEFORE the turn (for an edit's rewind); `after` is the world
 * the same words must leave every time. The combat mode flag and the
 * actor sheet ride too (combat.begin sets one, a condition change the
 * other); nothing the chain writes later is in here, and the chain's own
 * writes are the fold's to re-apply. */
function takeAfter(state) {
  return {
    ...takeSnapshot(state),
    combat: Boolean(state.mode && state.mode.combat),
    sheet: clonePlain(state.sheet),
  };
}

function restoreAfter(state, after) {
  if (!after || typeof after !== 'object') return;
  restoreSnapshot(state, after);
  if (typeof after.combat === 'boolean') state.mode = { ...(state.mode || {}), combat: after.combat };
  if (after.sheet && typeof after.sheet === 'object') state.sheet = clonePlain(after.sheet);
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
export async function refereeStep({ connection, userText, userId, history, state, settings, signal, callLLM, brief = '', castNotes = '' } = {}) {
  try {
    if (!state || typeof state !== 'object') return { state, ruling: null, status: 'degraded', why: 'no state' };
    const eng = engineSettings(settings);
    const text = String(userText || '');
    const key = userMessageHash(text);
    state.refHistory = Array.isArray(state.refHistory) ? state.refHistory : [];
    /* M298: a HIDDEN writer's page is a page that stands — the "Go on." nudge
     * (continueTurn) is a hidden user page, and the referee rules on it like
     * any other. Counting only the visible ones read the nudge's own commit as
     * "deleted or branched away" on the very next turn and rewound the world
     * to before it: every fight that carried a "go on" lost that turn's ruling
     * and state a turn later. */
    const presentIds = new Set(
      (history || []).filter((m) => m && m.role === 'user' && m.id).map((m) => m.id)
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
      /* M72: the same words leave the same world — the fight state the
       * ruling left is put back (a rewound ledger holds the world before) */
      restoreAfter(state, committed.after);
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
    const commit = (verdict) => commitRef(state, { key, msgId: userId || null, verdict: verdict || null, snap, after: takeAfter(state), at: Date.now() });

    /* #roll / #skip — demoted to optional overrides on the gate. M85: the
     * writer's own inline forms ride too — "# no roll" / "#noroll" stand
     * the referee down, "# roll this" calls it (the preset's LO Override). */
    const forceRoll = /(?:^|\s)#\s*roll(?:\s+this)?\b/i.test(text) && !/(?:^|\s)#\s*no\s+roll\b/i.test(text);
    const forceSkip = /(?:^|\s)#\s*(?:skip|noroll|no\s+roll)\b/i.test(text) && !/(?:^|\s)#\s*skip\s+to\b/i.test(text);
    if (forceSkip && !fightOn) {
      commit(null);
      return { state, ruling: null, status: 'skipped', why: 'no roll — the writer said so' };
    }

    const gate = gatePasses(text, (settings && settings.sensitivity) || 'normal', { inFight: fightOn });
    if (!gate.pass && !forceRoll) {
      passiveComposureRecovery(state, eng);
      commit(null);
      return { state, ruling: null, status: 'no-check', why: gate.reason };
    }

    const inWar = battleActive(state) && state.battle.kind === 'war';
    const inBattle = battleActive(state) && !inWar;
    const inDuel = duelActive(state);

    /* M472: "#p" IN A FIGHT IS THE LAST BEAT AGAIN. The writer: "I'm waiting by typing #p and the referee becomes
     * stupid and confused". #p means "the main character continues his last action for exactly one beat" — the
     * micro-call read a bare "#p" as nothing happening and ruled a lull, and the fight stood still. Now a #p during a
     * fight is scored as the last committed beat once more (its move, its target, the same words), no call made;
     * with no beat committed yet (the fight joined on a declaration), a plain attack. */
    let adj = null;
    if (fightOn && BEAT_RE.test(text)) {
      adj = continuedBeat(state, inWar ? 'war' : inBattle ? 'battle' : 'duel');
    } else {
      if (!connection) {
        return { state, ruling: null, status: 'degraded', why: 'no worker connection' };
      }
      const fightLine = renderFightLine(state);
      const user = buildRefereeUser({ state, userText: text, history, fightLine, brief, castNotes });
      const system = withFictionFrame(inWar ? WAR_SYSTEM : inBattle ? BATTLE_SYSTEM : inDuel ? DUEL_SYSTEM : ADJ_SYSTEM);
      const normalize = inWar ? normalizeWarAdj : inBattle ? normalizeBattleAdj : inDuel ? normalizeDuelAdj : normalizeAdj;
      const raw = await callReferee(connection, system, user, signal, callLLM);
      if (!raw) return { state, ruling: null, status: 'degraded', why: 'no usable answer' };
      if (signal && signal.aborted) return { state, ruling: null, status: 'degraded', why: 'timed out' };
      adj = normalize(raw, state);
    }
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
            ? 'The strain is telling on ' + mcName(state) + ' now — ' + res.state + '; let it show.'
            : mcName(state) + ' steadies — ' + res.state + ' again; let it show.');
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
    /* M345: one paragraph — the side-notes join the telling, before its last line */
    const withNotes = (directive) => {
      if (!sideNotes.length) return directive;
      const notes = sideNotes.map((n) => String(n).replace(/[.\s]+$/, '') + '.').join(' ');
      const at = directive.lastIndexOf(' It’s settled');
      const at2 = directive.lastIndexOf(' Keep all of this between us.');
      const cutAt = at !== -1 ? at : at2;
      return cutAt !== -1 ? directive.slice(0, cutAt) + ' ' + notes + directive.slice(cutAt) : directive + ' ' + notes;
    };

    /* M470: THE ACCOUNT BEHIND A RULING — the writer: "why is it only success and fail, without explanation or
     * justification?" Every ruling now carries what the referee read and what the dice did: the attempt, who against
     * whom at what ratings, the tilt and the referee's reason for it, the odds, the roll, the tier — and in a battle,
     * every pairing on the field. The storyteller still hears only the words a person says (M345); the account is
     * the ledger's ("The house has ruled"). */
    const account = (what, res, extra = {}) => {
      const a = { what, action: adj.action || '', why: adj.why || '', circumstance: Number.isFinite(adj.circumstance) ? adj.circumstance : (adj.move && Number.isFinite(adj.move.circumstance) ? adj.move.circumstance : 0), ...extra };
      if (adj.move) a.move = typeof adj.move === 'string' ? adj.move : { kind: adj.move.kind || null, target: adj.move.target || null, acting: adj.move.acting || null, domain: adj.move.domain || null }; /* M472: a #p continues it */
      if (adj.move && adj.move.domain && !a.domain) a.domain = adj.move.domain; /* M473 */
      if (adj.continued) a.continued = true;
      if (res && typeof res === 'object') {
        if (Number.isFinite(res.aR)) a.actorRating = Math.round(res.aR * 10) / 10;
        if (Number.isFinite(res.oR)) a.oppositionRating = Math.round(res.oR * 10) / 10;
        if (res.oppLabel) a.opposition = res.oppLabel;
        if (Number.isFinite(res.delta)) a.delta = Math.round(res.delta * 10) / 10;
        if (Number.isFinite(res.P)) a.chance = Math.round(res.P * 100);
        if (Number.isFinite(res.u)) a.roll = Math.round(res.u * 100);
        if (res.tier) a.tier = res.tier;
        if (res.command === true) a.command = true;
        if (Array.isArray(res.reports)) a.reports = res.reports.slice(0, 12).map((rep) => (typeof rep === 'string' ? rep : (rep && rep.words) || JSON.stringify(rep)));
      }
      a.actor = mcName(state);
      if (state.duel) a.fight = { kind: 'duel', round: state.duel.round, player: { poise: state.duel.player.poise, maxPoise: state.duel.player.maxPoise, injuries: state.duel.player.injuries, momentum: state.duel.player.momentum }, opp: { name: state.duel.opp.name, poise: state.duel.opp.poise, maxPoise: state.duel.opp.maxPoise, injuries: state.duel.opp.injuries, momentum: state.duel.opp.momentum, composure: state.duel.opp.composure } };
      else if (state.battle) a.fight = { kind: state.battle.kind === 'war' ? 'war' : 'battle', round: state.battle.round, allies: (state.battle.allies || []).map((u) => ({ name: u.name, rating: u.rating, standing: u.standing !== false, injuries: u.injuries, poise: u.poise })), enemies: (state.battle.enemies || []).map((u) => ({ name: u.name, rating: u.rating, standing: u.standing !== false, injuries: u.injuries, poise: u.poise })) };
      return a;
    };
    const ruling = (kind, tier, directive, acct) => ({ kind, tier, words: TIER_MEANING[tier] || String(tier || ''), directive, account: acct || null, at: Date.now() });

    const closeFight = async (kindLabel) => {
      const applied = applyMutations(state, [{ type: 'combat.end', engine: engineForMutations(eng, settings) }]);
      state = applied.state;
      state.seedDueAfterFight = true;
      const v = ruling(kindLabel, 'CLOSED', buildFightOverDirective(adj.action), account('the fight is over — the story ended it', null));
      commit(v);
      return { state, ruling: v, status: 'ruled', why: 'combat ended by the story' };
    };

    const lull = (kindLabel) => {
      const v = ruling(kindLabel, 'LULL', buildLullDirective(state, adj.action), account('a lull — nobody pressed, nothing rolled', null));
      commit(v);
      return { state, ruling: v, status: 'ruled', why: 'a beat without risk' };
    };

    /* ---- a war in progress ---- */
    if (inWar) {
      if (adj.combat_ended) return closeFight('war');
      if (!adj.exchange) return lull('war');
      const out = resolveWarRound(state, adj.move, eng);
      const tier = out.focalRes ? out.focalRes.tier : 'STALEMATE';
      const v = ruling('war', tier, withNotes(buildWarDirective(state, adj, out)), account('war, round ' + (state.battle ? state.battle.round : ''), out.focalRes ? { ...out.focalRes, reports: out.reports } : { reports: out.reports }));
      commit(v);
      return { state, ruling: v, status: 'ruled', why: 'war round' };
    }

    /* ---- a battle in progress ---- */
    if (inBattle) {
      if (adj.combat_ended) return closeFight('battle');
      if (adj.joins) { /* M470: newcomers take the field before the round is fought */
        const applied = applyMutations(state, [{ type: 'combat.join', ...adj.joins, engine: engineForMutations(eng, settings) }]);
        state = applied.state;
      }
      if (!adj.exchange) return lull('battle');
      const out = resolveBattleRound(state, adj.move, eng);
      const tier = out.mcRes ? out.mcRes.tier : 'STALEMATE';
      const v = ruling('battle', tier, withNotes(buildBattleDirective(state, adj, out)), account('battle, round ' + (state.battle ? state.battle.round : ''), out.mcRes ? { ...out.mcRes, reports: out.reports } : { reports: out.reports }));
      commit(v);
      return { state, ruling: v, status: 'ruled', why: 'battle round' };
    }

    /* ---- a duel in progress ---- */
    if (inDuel) {
      if (adj.combat_ended) return closeFight('duel');
      if (adj.joins) {
        /* M470: a companion steps in (or reinforcements arrive) — the duel widens into a battle carrying both
         * duellists as they stand, and this beat is fought as a battle round */
        const applied = applyMutations(state, [{ type: 'combat.join', ...adj.joins, engine: engineForMutations(eng, settings) }]);
        state = applied.state;
        if (state.battle && !state.duel) {
          if (!adj.exchange) return lull('battle');
          const mv = { kind: adj.move === 'recover' ? 'attack' : 'attack', target: null, circumstance: adj.circumstance };
          const out = resolveBattleRound(state, mv, eng);
          const tier = out.mcRes ? out.mcRes.tier : 'STALEMATE';
          const v = ruling('battle', tier, withNotes(buildBattleDirective(state, { ...adj, move: mv }, out)), account('the duel widened into a battle, round ' + state.battle.round, out.mcRes ? { ...out.mcRes, reports: out.reports } : { reports: out.reports }));
          commit(v);
          return { state, ruling: v, status: 'ruled', why: 'a duel widened into a battle' };
        }
      }
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
      const v = ruling('duel', res.tier, withNotes(directive), account('duel, round ' + (state.duel ? state.duel.round : ''), res));
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
          const v = ruling('armed', 'ARMED', withNotes(buildArmedDirective(state, adj)), account('the fight is joined — armed, nothing rolled yet', null));
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
        const v = ruling('war', tier, withNotes(buildWarDirective(state, adj, out)), account('a war opens', out.focalRes ? { ...out.focalRes, reports: out.reports } : { reports: out.reports }));
        commit(v);
        return { state, ruling: v, status: 'ruled', why: 'war opens' };
      }
    }

    if (adj.battle_start) {
      const applied = applyMutations(state, [{ type: 'combat.begin', kind: 'battle', ...adj.battle_start, opponentRating: adj.battle_start.oppEstimate != null ? adj.battle_start.oppEstimate : adj.opponent_rating, engine: engineForMutations(eng, settings) }]);
      state = applied.state;
      if (state.battle) {
        const mv = { kind: 'attack', target: null, circumstance: adj.circumstance };
        const out = resolveBattleRound(state, mv, eng);
        const tier = out.mcRes ? out.mcRes.tier : 'STALEMATE';
        const v = ruling('battle', tier, withNotes(buildBattleDirective(state, adj, out)), account('a battle opens — ' + state.battle.allies.length + ' against ' + state.battle.enemies.length, out.mcRes ? { ...out.mcRes, reports: out.reports } : { reports: out.reports }));
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
        const v = ruling('duel', res.tier, withNotes(buildDuelDirective(state, adj, res)), account('a duel opens', res));
        commit(v);
        return { state, ruling: v, status: 'ruled', why: 'duel opens' };
      }
    }

    const res = resolveCheck(state, adj, eng);
    const v = ruling('check', res.tier, withNotes(buildDirective(adj, res)), account('a lone check' + (adj.kind === 'actor' ? ' against ' + (adj.opposition || 'someone') : ' — ' + (adj.tier || adj.opposition || 'moderate') + ' difficulty'), { ...res, oppLabel: adj.kind === 'actor' ? adj.opposition : (adj.tier || adj.opposition || 'moderate') }, { stakes: adj.stakes || '', domain: adj.domain || '' }));
    commit(v);
    return { state, ruling: v, status: 'ruled', why: 'a lone check' };
  } catch (err) {
    return { state, ruling: null, status: 'degraded', why: 'referee fault' };
  }
}

/* ==================================================================== */
/* Background seeding — the sheet fills itself in the quiet moments     */
/* ==================================================================== */

/* M345: the sheet's own stamp. 1 = the blind seeder (M11..M344) — a sheet it made is read again, whole, the next time
 * the seeder runs (the app repairs what it can detect). */
export const SEED_VERSION = 2;
export const SEED_EVERY = 100;        /* Arbiter's fallback timer: a long quiet stretch still refreshes growth */
export const SEED_NEW_FACE_GAP = 3;   /* pages between re-seeds called by someone in the scene the sheet does not have */
export const SEED_MAX_TOKENS = 8000;  /* a large cast needs room to answer (the old 600 cut a big sheet off mid-list) */
const SEED_MAX_ACTORS = 80;           /* runaway guard, never a size a real cast reaches */
const PLAIN_SELF = /^(?:you|i|me|myself|player|the player|writer|the writer|narrator|the narrator|storyteller|the storyteller)$/i;

const lower = (x) => String(x || '').trim().toLowerCase();
const isHandKept = (e) => Boolean(e && (e._hand || (!e._auto && !e._estimated)));

/* why the sheet wants a seeding now — '' when it does not */
export function seedDue(state, pagesTold) {
  const sheet = state && state.sheet && typeof state.sheet === 'object' ? state.sheet : { actors: {} };
  const actors = sheet.actors && typeof sheet.actors === 'object' ? sheet.actors : {};
  if ((Number(pagesTold) || 0) < 2) return '';
  const names = Object.keys(actors);
  if (!names.length) return 'first';
  if (sheet.seedVersion !== SEED_VERSION) return 'heal';
  if (state.seedDueAfterFight === true) return 'after a fight';
  const now = storyTurn(state);
  const since = now - (Number.isFinite(sheet.seededAtPage) ? sheet.seededAtPage : 0);
  const mc = mcName(state);
  if (since >= SEED_NEW_FACE_GAP) {
    if (mc !== 'the player' && !findActorKeySamePerson(state, mc)) return 'the main character';
    const present = Array.isArray(state.present) ? state.present : [];
    /* someone the last weighing already saw here and left off (a crowd, a voice) does not call it again every page */
    const seen = new Set(Array.isArray(sheet.seenPresent) ? sheet.seenPresent.map(lower) : []);
    const newFace = present.map((p) => (typeof p === 'string' ? p : p && p.name)).filter(Boolean)
      .find((n) => !isMcAlias(state, n) && !findActorKeySamePerson(state, n) && !seen.has(lower(n)));
    if (newFace) return 'a new face';
  }
  if (since >= SEED_EVERY) return 'a while since';
  return '';
}

/* every person the ledger holds a page for, the most important first, in the room given */
export function seedPeople(state, brief = '', room = 60000) {
  const chars = state && state.characters && typeof state.characters === 'object' ? state.characters : {};
  const hereSet = new Set((Array.isArray(state && state.present) ? state.present : []).map((p) => lower(typeof p === 'string' ? p : p && p.name)));
  const here = { has: (k) => hereSet.has(k) || isHere(state, k) }; /* M398: one answer to "the same person?" */
  const turn = storyTurn(state || {});
  const rows = [];
  for (const [name, c] of Object.entries(chars)) {
    if (!c || typeof c !== 'object' || c.retired) continue;
    const core = typeof c.core === 'string' ? c.core.trim().replace(/\s+/g, ' ') : '';
    const now = typeof c.state === 'string' ? c.state.trim().replace(/\s+/g, ' ') : '';
    let weight = 0;
    try { weight = importanceOf(state, name, brief, turn, { placeWords: [], lately: [] }); } catch (err) { weight = 0; }
    rows.push({ name, core, now, weight: weight + (here.has(lower(name)) ? 1000 : 0), here: here.has(lower(name)) });
  }
  rows.sort((a, b) => (b.weight - a.weight) || a.name.localeCompare(b.name));
  const lines = [];
  let used = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const who = isMcAlias(state, r.name) ? ' (the main character)' : r.here ? ' (in the scene)' : '';
    let line = r.name + who + ' — ' + ([r.core.slice(0, 900), r.now ? 'lately: ' + r.now.slice(0, 300) : ''].filter(Boolean).join(' | ') || 'no page written yet');
    if (used + line.length + 1 > room) {
      lines.push('(' + (rows.length - i) + ' more the ledger knows, the least important: ' + rows.slice(i).map((x) => x.name).join(', ') + ')');
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}

function seedSheetBlock(state) {
  const actors = (state.sheet && state.sheet.actors) || {};
  const mc = mcName(state);
  const keys = Object.keys(actors).sort((a, b) => (isMcAlias(state, b) ? 1 : 0) - (isMcAlias(state, a) ? 1 : 0));
  const lines = keys.map((name) => {
    const a = actors[name];
    if (!a || typeof a !== 'object') return '';
    const doms = a.domains && typeof a.domains === 'object' ? Object.entries(a.domains).filter(([, v]) => Number.isFinite(v)).map(([d, v]) => d + ' ' + v) : [];
    const kept = Array.isArray(a.conditions) ? a.conditions.filter((c) => c && c.name).map((c) => c.name + ' ' + (c.mod >= 0 ? '+' : '') + c.mod + (c.domain ? ' ' + c.domain : '')) : [];
    return name + (isMcAlias(state, name) && mc !== 'the player' ? ' (the main character)' : '') + ': default ' + (Number.isFinite(a.default) ? a.default : '?')
      + (doms.length ? ', ' + doms.join(', ') : '') + (kept.length ? ' | carries: ' + kept.join('; ') : '') + (isHandKept(a) ? ' — kept by the writer’s hand' : '');
  }).filter(Boolean);
  return lines.length ? lines.join('\n') : '(empty — no one is rated yet)';
}

/* the seeder's whole reading, sized to the worker's room */
export function buildSeedUser({ state, pages = [], brief = '', castNotes = '', record = '', room = 300000 } = {}) {
  const mc = mcName(state);
  const share = (part) => Math.max(4000, Math.floor(room * part));
  const player = mc === 'the player'
    ? 'The main character is not named in the ledger yet. The writer\'s pages below are the main character acting; name them as the story does (player_story_name) and put them first.'
    : 'The main character — the person the writer plays — is ' + mc + '. Every page labelled "' + mc + ' (the writer)" below is ' + mc + ' acting: "I", "me" and "you" in it are ' + mc + '. Put ' + mc + ' first in "actors", under exactly the name "' + mc + '".';
  const told = [];
  let used = 0;
  const budget = share(0.3);
  for (let i = pages.length - 1; i >= 0; i -= 1) {
    const m = pages[i];
    if (!m || m.hidden) continue;
    const words = wholePage(pageText(m), 6000);
    if (!words.trim()) continue;
    const line = (m.role === 'user' ? (mc === 'the player' ? 'The writer' : mc + ' (the writer)') : 'The story') + ':\n' + words;
    if (used + line.length > budget && told.length) break;
    told.push(line);
    used += line.length;
  }
  told.reverse();
  const bodies = (() => { try { return renderBodies(state.bodies, state.clock && state.clock.minutes, storyTurn(state)); } catch (err) { return ''; } })();
  const locked = (() => { try { return state.canon && typeof state.canon === 'object' ? renderCanon(state.canon, Object.keys(state.canon)) : ''; } catch (err) { return ''; } })();
  const cut = (t, n) => { const s = String(t || ''); return s.length > n ? s.slice(s.length - n) : s; };
  return [
    '<player>\n' + player + '\n</player>',
    '<sheet>\n' + seedSheetBlock(state) + '\n</sheet>',
    String(brief || '').trim() ? '<brief>\n' + writerText(brief, Math.min(BRIEF_ROOM, share(0.15)), 'brief') + '\n</brief>' : null,
    String(castNotes || '').trim() ? '<cast_notes>\n' + writerText(castNotes, Math.min(CAST_ROOM, share(0.08)), 'cast notes') + '\n</cast_notes>' : null,
    '<people>\n' + (seedPeople(state, String(brief || '') + '\n' + String(castNotes || ''), share(0.2)) || '(no pages written yet)') + '\n</people>',
    bodies && bodies.trim() ? '<bodies>\n' + cut(bodies, 8000) + '\n</bodies>' : null,
    locked && locked.trim() ? '<locked>\n' + cut(locked, 8000) + '\n</locked>' : null,
    String(record || '').trim() ? '<record>\n' + cut(record, share(0.2)) + '\n</record>' : null,
    '<pages>\n' + (told.join('\n\n') || '(none yet)') + '\n</pages>',
  ].filter(Boolean).join('\n\n');
}

function normalizeLasting(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 6).map((c) => ({
    name: String((c && c.name) || '').replace(/\s+/g, ' ').trim().slice(0, 50),
    mod: clampInt(c && c.mod, -4, 3, -1),
    ...(c && typeof c.domain === 'string' && c.domain.trim() ? { domain: c.domain.toLowerCase().trim().slice(0, 20) } : {}),
    ...(c && c.gear === true ? { gear: true } : {}),
    by: 'seed',
  })).filter((c) => c.name && !/\b(?:clothes|clothing|outfit|dress|shirt|hoodie|jacket|disguise|paper bag|bag over (?:his|her|their|the) head|appearance|mood|habit)\b/i.test(c.name));
}

/* a name that is a place or a faction the ledger knows is never a person */
function notAPerson(state, name) {
  const n = lower(name);
  if (!n) return true;
  if (state.place && lower(state.place.name) === n) return true;
  if (state.factions && typeof state.factions === 'object' && Object.keys(state.factions).some((k) => lower(k) === n)) return true;
  return false;
}

/* M345: the answer, folded into the sheet the way Arbiter v0.42 folds it — and the old blind seeder's work healed.
 *   - every name that means the main character lands on HIS entry (never a second one, never someone else's);
 *   - a name the ledger has a page for is filed under the page's name (one person, one name, in every book — M320);
 *   - the writer's hand is locked (only new domains are added); an estimate from a fight is replaced by a considered
 *     rating; this seeder's own entries only ever RISE (growth), and its own reading of what they carry is replaced;
 *   - what the referee filed in a beat, and what the writer set by hand, is never taken back by a seeding;
 *   - heal: a sheet the blind seeder made is re-read whole — its numbers replaced, its misfiled conditions let go, and
 *     its entries for people the ledger does not know dropped.
 * Returns {touched, mcMissing}. */
export function mergeSeed(state, parsed, { heal = false } = {}) {
  state.sheet = state.sheet && typeof state.sheet === 'object' ? state.sheet : { actors: {}, playerName: '' };
  if (!state.sheet.actors || typeof state.sheet.actors !== 'object') state.sheet.actors = {};
  const actors = state.sheet.actors;
  if (typeof parsed.player_story_name === 'string' && parsed.player_story_name.trim()) {
    const known = typeof state.sheet.playerName === 'string' ? state.sheet.playerName.trim() : '';
    const nm = parsed.player_story_name.trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!known && !PLAIN_SELF.test(nm)) state.sheet.playerName = nm; /* M28: a name the ledger knows is never clobbered */
  }
  const raw = Array.isArray(parsed.actors) ? parsed.actors
    : (parsed.actors && typeof parsed.actors === 'object' ? Object.entries(parsed.actors).map(([name, v]) => ({ ...(v && typeof v === 'object' ? v : {}), name })) : []);
  const chars = state.characters && typeof state.characters === 'object' ? state.characters : {};
  const mc = mcName(state);
  const seen = new Set();
  let touched = 0;
  for (const item of raw.slice(0, SEED_MAX_ACTORS)) {
    if (!item || typeof item !== 'object') continue;
    let name = safeKey(String(item.name || '').replace(/\s+/g, ' ').trim().slice(0, 60));
    if (!name) continue;
    if (PLAIN_SELF.test(name) || isMcAlias(state, name)) {
      if (mc === 'the player') continue;
      name = mc;
    } else {
      const pageKey = findPersonKey(chars, name);
      if (pageKey && !isMcAlias(state, pageKey)) name = pageKey;
    }
    if (notAPerson(state, name)) continue;
    const domains = {};
    if (item.domains && typeof item.domains === 'object') {
      for (const d of Object.keys(item.domains).slice(0, 8)) {
        const v = Number(item.domains[d]);
        const dk = String(d).toLowerCase().trim().slice(0, 20);
        if (dk && Number.isFinite(v)) domains[dk] = clamp(v, 0, 10);
      }
    }
    const fresh = { default: clampInt(item.default, 0, 10, ENGINE_DEFAULTS.defaultRating), domains };
    const lasting = normalizeLasting(item.lasting || item.conditions);
    const key = findActorKeyExact(state, name) || findActorKeySamePerson(state, name);
    const existing = key ? actors[key] : null;
    if (existing && typeof existing === 'object' && isHandKept(existing)) {
      existing.domains = existing.domains && typeof existing.domains === 'object' ? existing.domains : {};
      for (const [d, v] of Object.entries(fresh.domains)) if (existing.domains[d] === undefined) existing.domains[d] = v;
      seen.add(key);
      continue;
    }
    const otherHands = existing && Array.isArray(existing.conditions)
      ? existing.conditions.filter((c) => c && (c.by === 'referee' || c.by === 'hand' || (!heal && existing.seed === SEED_VERSION && c.by !== 'seed')))
      : [];
    if (existing && existing._auto && existing.seed === SEED_VERSION && !heal) {
      /* growth: a considered rating of this seeder's only ever rises */
      if (fresh.default > (Number(existing.default) || 0)) existing.default = fresh.default;
      existing.domains = existing.domains && typeof existing.domains === 'object' ? existing.domains : {};
      for (const [d, v] of Object.entries(fresh.domains)) if (existing.domains[d] === undefined || v > existing.domains[d]) existing.domains[d] = v;
      existing.conditions = [...otherHands, ...lasting].slice(-8);
      if (!existing.conditions.length) delete existing.conditions;
      seen.add(key);
      touched += 1;
      continue;
    }
    const entry = { default: fresh.default, domains: fresh.domains, _auto: true, seed: SEED_VERSION };
    const conds = [...otherHands, ...lasting].slice(-8);
    if (conds.length) entry.conditions = conds;
    if (existing && Number.isFinite(Number(existing.poise))) entry.poise = existing.poise;
    if (key && key !== name) delete actors[key];
    if (!safeKey(name)) continue; /* M471: never a magic key (__proto__ and kin) from a model's answer */
    actors[name] = entry;
    seen.add(name);
    touched += 1;
  }
  if (heal) {
    for (const [k, e] of Object.entries(actors)) {
      if (!e || typeof e !== 'object' || !e._auto || e.seed === SEED_VERSION || seen.has(k)) continue;
      if (findPersonKey(chars, k) || isMcAlias(state, k)) {
        /* a person the ledger knows keeps the old number; the blind reading of what they carry goes */
        e.seed = SEED_VERSION;
        if (Array.isArray(e.conditions)) { e.conditions = e.conditions.filter((c) => c && (c.by === 'referee' || c.by === 'hand')); if (!e.conditions.length) delete e.conditions; }
        continue;
      }
      delete actors[k];
      touched += 1;
    }
  }
  if (reconcilePlayerEntries(state)) touched += 1;
  const mcMissing = mc !== 'the player' && !findActorKeySamePerson(state, mc);
  return { touched, mcMissing };
}

/* Seed the actor sheet: on the first pages, after a fight lets go, when someone in the scene (or the main character)
 * is not on it, when the blind seeder made it, and every SEED_EVERY pages. Background only — never on the critical
 * path, never throws. */
export async function maybeSeedSheet({ connection, storyId, signal, callLLM, brief = '', castNotes = '', renew } = {}) {
  try {
    if (!connection || !storyId) return { ok: false };
    const state = await loadState(storyId);
    if (!state) return { ok: false };
    const messages = (await db.messages.list(storyId)).filter((m) => m && !m.hidden);
    const told = messages.filter((m) => m.role === 'assistant').length;
    const why = seedDue(state, told);
    if (!why) return { ok: false, why: 'not due' };
    let record = '';
    try { record = recordFor(await loadMemory(storyId), 1, 120000); } catch (err) { record = ''; }
    const room = Math.max(40000, Math.min(400000, Math.floor(contextOf(connection) * 3 * 0.55)));
    let user = buildSeedUser({ state, pages: messages.slice(-40), brief, castNotes, record, room });
    if (typeof renew === 'function') renew(240000);
    let parsed = await callReferee(connection, withFictionFrame(SEED_SYSTEM), user, signal, callLLM, SEED_MAX_TOKENS, (o) => Array.isArray(o.actors) || (o.actors && typeof o.actors === 'object'));
    if (!parsed) return { ok: false, why: 'no usable answer' };
    /* the seeding is written onto the ledger as it stands NOW — a page may have landed while the model read */
    const fresh = await loadState(storyId);
    if (!fresh) return { ok: false };
    const heal = why === 'heal';
    let result = mergeSeed(fresh, parsed, { heal });
    if (result.mcMissing) {
      /* the main character left out: asked once more, by name */
      if (typeof renew === 'function') renew(240000);
      user += '\n\nYou left out ' + mcName(fresh) + ' — the main character. Answer again with the whole sheet, ' + mcName(fresh) + ' first.';
      const again = await callReferee(connection, withFictionFrame(SEED_SYSTEM), user, signal, callLLM, SEED_MAX_TOKENS, (o) => Array.isArray(o.actors) || (o.actors && typeof o.actors === 'object'));
      if (again) result = mergeSeed(fresh, again, { heal: false });
    }
    fresh.sheet.seedVersion = SEED_VERSION;
    fresh.sheet.seededAtPage = storyTurn(fresh);
    fresh.sheet.seenPresent = (Array.isArray(fresh.present) ? fresh.present : []).map((p) => (typeof p === 'string' ? p : p && p.name)).filter(Boolean).slice(0, 40);
    fresh.seedDueAfterFight = false;
    await saveState(storyId, fresh);
    notify(storyId);
    return { ok: true, touched: result.touched, why };
  } catch (err) {
    return { ok: false };
  }
}
