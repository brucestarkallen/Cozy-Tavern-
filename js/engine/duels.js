/* Cozy Tavern — engine/duels.js (M11)
 * The fight engines — duel, battle, and war — ported faithfully from
 * Arbiter's engine semantics, riding Cozy Tavern's own ledgers. The state
 * lives on the story's state object (state.duel / state.battle, migrated in
 * state.js v5); opening and closing a fight goes through apply.js
 * (combat.begin / combat.end) so the mode ledger and the plain-words log
 * always know. Lasting injuries the fight produces are written to the body
 * ledger (M4) when the fight lets go.
 *
 * All math stays in code (engine/referee-math.js). The model may score a
 * move — circumstance, who stands against whom — it never rolls and never
 * decides an outcome.
 *
 * Duel law (ported):
 *   - poise pools (default 5; a sheet "poise" overrides, clamped 1..20)
 *   - momentum ±0.5 per won exchange, cap 1, loser resets
 *   - openings: SETBACK hands the player +1 next round; SUCCESS_COST hands
 *     the opponent the same (symmetric fail-forward)
 *   - poise damage margin-scaled (the winner's edge bites harder, cap +3)
 *   - recovery economy: tier-scaled heal (RECOVER_EFFECTS), at most one
 *     pool's worth per fight, and the opponent takes a free swing while you
 *     disengage — floored at 0.5 whenever a standing foe rates 3+, so
 *     catching your breath is never free
 *   - styles: 'tracked' keeps the books and calls a winner; 'outcome-only'
 *     scores each exchange and tallies nothing — the story ends the fight
 *
 * The sheet (state.sheet = {actors: {name: {default, domains, conditions?,
 * poise?}}, playerName}) holds the ratings. Unlisted opponents default to
 * trained (4).
 */

import {
  clamp, probFromDelta, sliceOutcome, tieCheck, rngFloat,
  TIERS, TIER_RATINGS, EXCHANGE_EFFECTS, RECOVER_EFFECTS, STRATAGEM_EFFECTS,
  applyExchangeEffects, poiseWord, composurePenaltyOf, presetFor,
} from './referee-math.js';

/* Engine knobs that aren't writer-facing settings (Arbiter's defaults). */
export const ENGINE_DEFAULTS = {
  defaultRating: 5,   // rating when an actor/domain is unknown
  duelPoise: 5,       // default poise pool
  tieBand: 0.06,      // exchange tie window (0 disables)
  composureMax: 6,    // starting mental-strain pool
  warStrength: 10,    // default formation strength pool
};

/* Resolve the engine knobs from the writer-facing settings + defaults. */
export function engineSettings(settings) {
  const s = settings || {};
  return {
    preset: presetFor(s.preset),
    style: s.fightStyle === 'outcome' ? 'outcome' : 'tracked',
    tieBand: Number.isFinite(s.tieBand) ? s.tieBand : ENGINE_DEFAULTS.tieBand,
    duelPoise: Number.isFinite(s.duelPoise) ? s.duelPoise : ENGINE_DEFAULTS.duelPoise,
    defaultRating: Number.isFinite(s.defaultRating) ? s.defaultRating : ENGINE_DEFAULTS.defaultRating,
    composure: s.composure !== false,
    composureMax: clamp(Number.isFinite(s.composureMax) ? s.composureMax : ENGINE_DEFAULTS.composureMax, 3, 12),
    warStrength: clamp(Number.isFinite(s.warStrength) ? s.warStrength : ENGINE_DEFAULTS.warStrength, 4, 40),
  };
}

const outcomeOnly = (eng) => eng.style === 'outcome';

/* ------------------------------------------------------------------ */
/* Names and the sheet                                                 */
/* ------------------------------------------------------------------ */

/* The magic keys would invoke the prototype setter instead of storing an
 * entry — reject them at every key-injection site (ported hardening). */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export function safeKey(k) {
  const t = String(k || '').trim();
  return (t && !UNSAFE_KEYS.has(t.toLowerCase())) ? t : null;
}

/* The player's in-story name, learned by the sheet seeder (or written by
 * hand in "How they measure"). Empty falls back to the plain word. */
export function mcName(state) {
  const v = state && state.sheet && typeof state.sheet.playerName === 'string'
    ? state.sheet.playerName.trim() : '';
  return v || 'the player';
}

/* Same-person identity between two raw names: exact, or one name's tokens a
 * subset of the other's ("Kaiser" ↔ "Kaiser von Adler"). Token-based, never
 * a substring, and a merely shared surname is NOT identity. */
export function samePersonName(a, b) {
  const nrm = (x) => String(x || '').toLowerCase().trim();
  const toks = (x) => nrm(x).split(/[\s,]+/).filter(Boolean);
  const at = toks(a);
  const bt = toks(b);
  if (!at.length || !bt.length) return false;
  return nrm(a) === nrm(b) || at.every((t) => bt.includes(t)) || bt.every((t) => at.includes(t));
}

/* Every name that means "the player": the story name plus the plain
 * second-person labels the writer's messages carry. */
export function mcAliases(state) {
  const name = mcName(state);
  const out = name === 'the player' ? [] : [name];
  out.push('you', 'the player', 'player');
  return out;
}

/* M282: the plain labels are a WHOLE name — "Card Player" and "You Sung" are
 * people of the tale, not the main character; his story name keeps the loose
 * whole-word match ("Jovan Wells" is Jovan). */
const PLAIN_LABELS = new Set(['you', 'the player', 'player']);
export function isMcAlias(state, name) {
  const n = String(name || '').trim();
  if (!n) return false;
  if (PLAIN_LABELS.has(n.toLowerCase().replace(/\s+/g, ' '))) return true;
  const story = mcName(state);
  return story !== 'the player' && samePersonName(n, story);
}

/* Sheet key for a name, or null. Exact (case-insensitive) first, then a
 * loose WHOLE-WORD match so "Kaiser" resolves to "Kaiser von Adler" —
 * token-based, never a bare substring. */
export function findActorKey(state, name) {
  const actors = (state && state.sheet && state.sheet.actors) || {};
  const target = String(name || '').toLowerCase().trim();
  if (!target) return null;
  for (const key of Object.keys(actors)) {
    if (key.toLowerCase().trim() === target) return key;
  }
  const toks = target.split(/[\s,]+/).filter(Boolean);
  for (const key of Object.keys(actors)) {
    const kt = key.toLowerCase().trim().split(/[\s,]+/).filter(Boolean);
    if (toks.length && toks.every((t) => kt.includes(t))) return key;
  }
  return null;
}

export function findActorKeyExact(state, name) {
  const actors = (state && state.sheet && state.sheet.actors) || {};
  const target = String(name || '').toLowerCase().trim();
  if (!target) return null;
  for (const key of Object.keys(actors)) {
    if (key.toLowerCase().trim() === target) return key;
  }
  return null;
}

export function findActor(state, name) {
  const key = findActorKey(state, name);
  return key ? state.sheet.actors[key] : null;
}

/* M345: SEEDING-GRADE IDENTITY (Arbiter v0.31/v0.42 findActorKeySamePerson). An existing sheet key is the same person
 * only when one name's words are all in the other's ("Kaiser" <-> "Kaiser von Adler"), either way round; a shared
 * surname alone is NOT one person ("Claire Wessex" is never "Marcus Wessex"). */
export function findActorKeySamePerson(state, name) {
  const actors = (state && state.sheet && state.sheet.actors) || {};
  const nrm = (x) => String(x || '').toLowerCase().trim();
  const toks = (x) => nrm(x).split(/[\s,]+/).filter(Boolean);
  const target = nrm(name);
  if (!target) return null;
  for (const key of Object.keys(actors)) if (nrm(key) === target) return key;
  const tt = toks(name);
  if (!tt.length) return null;
  for (const key of Object.keys(actors)) {
    const kt = toks(key);
    if (kt.length && (kt.every((w) => tt.includes(w)) || tt.every((w) => kt.includes(w)))) return key;
  }
  return null;
}

/* M345: ONE ENTRY FOR THE MAIN CHARACTER (Arbiter's reconcilePlayerEntries). Any sheet entry filed under a name that
 * means him — "you", "the player", a part of his story name — is folded into his own entry: his entry's numbers win,
 * the other only fills domains it lacks and hands over its conditions. Returns true when something was folded. */
export function reconcilePlayerEntries(state) {
  const actors = state && state.sheet && state.sheet.actors;
  if (!actors || typeof actors !== 'object') return false;
  const story = mcName(state);
  if (story === 'the player') return false;
  let changed = false;
  let mcKey = findActorKeyExact(state, story) || findActorKeySamePerson(state, story);
  for (const key of Object.keys(actors)) {
    if (key === mcKey || !isMcAlias(state, key)) continue;
    const src = actors[key];
    delete actors[key];
    changed = true;
    if (!src || typeof src !== 'object') continue;
    if (!mcKey) { mcKey = story; actors[mcKey] = { ...src, domains: { ...(src.domains || {}) } }; continue; }
    const dst = actors[mcKey];
    dst.domains = dst.domains && typeof dst.domains === 'object' ? dst.domains : {};
    for (const [d, v] of Object.entries(src.domains || {})) if (dst.domains[d] === undefined) dst.domains[d] = v;
    if (Array.isArray(src.conditions) && src.conditions.length) {
      dst.conditions = Array.isArray(dst.conditions) ? dst.conditions : [];
      const have = new Set(dst.conditions.map((c) => String(c && c.name || '').toLowerCase()));
      for (const c of src.conditions) if (c && !have.has(String(c.name || '').toLowerCase())) dst.conditions.push(c);
    }
    if (Number.isFinite(Number(src.poise)) && dst.poise === undefined) dst.poise = src.poise;
  }
  /* his entry stands under his story name, not under a part of it */
  if (mcKey && mcKey !== story && !findActorKeyExact(state, story) && samePersonName(mcKey, story) && mcKey.split(/\s+/).length <= story.split(/\s+/).length) {
    actors[story] = actors[mcKey];
    delete actors[mcKey];
    changed = true;
  }
  return changed;
}

function conditionMod(actorEntry, domain) {
  if (!actorEntry || !Array.isArray(actorEntry.conditions)) return 0;
  const d = String(domain || '').toLowerCase();
  let sum = 0;
  for (const c of actorEntry.conditions) {
    const m = Number(c && c.mod);
    if (!Number.isFinite(m)) continue;
    const cd = c.domain ? String(c.domain).toLowerCase() : null;
    if (!cd || cd === d) sum += m; // untagged = all; tagged = only its domain
  }
  return clamp(sum, -6, 5);
}

export function ratingFor(actorEntry, domain, fallback) {
  if (!actorEntry || typeof actorEntry !== 'object') return fallback;
  const domains = actorEntry.domains || {};
  const d = String(domain || '').toLowerCase();
  let base = fallback;
  let found = false;
  for (const key of Object.keys(domains)) {
    if (key.toLowerCase() === d) { base = clamp(domains[key], 0, 10); found = true; break; }
  }
  if (!found && actorEntry.default !== undefined) base = clamp(actorEntry.default, 0, 10);
  return clamp(base + conditionMod(actorEntry, domain), 0, 10);
}

export function poiseFor(actorEntry, fallbackPoise) {
  if (actorEntry && Number.isFinite(Number(actorEntry.poise))) return clamp(actorEntry.poise, 1, 20);
  return clamp(fallbackPoise, 1, 20);
}

/* Resolve a tier word ("hard", "trained", "peer"…) against the actor's own
 * rating — the lone-check opposition ladder. */
export function tierRating(opposition, aR) {
  const t = TIER_RATINGS[String(opposition).toLowerCase()];
  if (t === 'A') return aR;
  if (t === 'A+2') return clamp(aR + 2, 0, 12);
  if (t === 'A-2') return clamp(aR - 2, 0, 10);
  if (typeof t === 'number') return t;
  return 5;
}

/* A duel is FOUGHT in a combat domain: an opener classified as talk must
 * never arm a social duel — the fight's weapons decide, defaulting melee. */
export function combatDomain(d) {
  const x = String(d || '').toLowerCase().trim();
  return (!x || x === 'social' || x === 'intellect' || x === 'craft' || x === 'stealth') ? 'melee' : x;
}

/* ------------------------------------------------------------------ */
/* Composure — the mind's pool, tracked on state.composure for the      */
/* player and per-combatant inside a fight                              */
/* ------------------------------------------------------------------ */

export function getComposure(state, eng) {
  const max = eng.composureMax;
  const cur = (state && typeof state.composure === 'number') ? state.composure : max;
  return { cur, max };
}

export function composurePenalty(state, eng) {
  if (!eng.composure) return 0;
  const { cur, max } = getComposure(state, eng);
  return composurePenaltyOf(cur, max);
}

export function combatantComposurePenalty(unit, eng) {
  if (!eng.composure || !unit || typeof unit.composure !== 'number') return 0;
  return composurePenaltyOf(unit.composure, unit.composureMax || unit.composure);
}

export function shiftCombatantComposure(unit, delta) {
  if (!unit || typeof unit.composure !== 'number' || !delta) return;
  unit.composure = clamp(unit.composure + delta, 0, unit.composureMax || unit.composure);
}

/* Erode/restore the player's nerve. Returns {before, now, max, worsened,
 * state} for narration, or null when nothing moved. */
export function applyComposureChange(state, delta, eng) {
  if (!eng.composure || !delta) return null;
  const max = eng.composureMax;
  if (typeof state.composure !== 'number') state.composure = max;
  const before = state.composure;
  state.composure = clamp(state.composure + delta, 0, max);
  const now = state.composure;
  if (now === before) return null;
  const words = (v) => (v >= max * 0.75 ? 'steady' : v >= max * 0.5 ? 'shaken' : v >= max * 0.25 ? 'badly rattled' : 'near breaking');
  return { before, now, max, worsened: now < before, state: words(now) };
}

/* Gentle between-scenes recovery of the player's nerve on quiet turns out
 * of combat. Slow by design — it never trivialises a horror beat. */
const PASSIVE_COMPOSURE_REGEN = 0.5;
export function passiveComposureRecovery(state, eng) {
  if (!eng.composure) return;
  const max = eng.composureMax;
  if (typeof state.composure !== 'number') { state.composure = max; return; }
  if (state.composure >= max) return;
  state.composure = clamp(state.composure + PASSIVE_COMPOSURE_REGEN, 0, max);
}

/* Post-round morale shock for battles/wars: watching same-side units fall
 * frays the survivors' nerve; a clean round with the numbers steadies it.
 * Never breaks a unit — a rattled unit merely fights worse next round. */
function applyMoraleShock(state, b, allyBreaks, enemyBreaks, eng) {
  if (!eng.composure) return;
  const allyUnits = b.allies.filter((u) => !u.isPlayer);
  const enemyUnits = b.enemies;
  const mc = playerUnit(b);
  const aStand = standing(allyUnits).length;
  const eStand = standing(enemyUnits).length;
  const nerve = (units, breaks, edge) => {
    const shock = clamp(breaks, 0, 2);
    for (const u of standing(units)) {
      if (shock > 0) shiftCombatantComposure(u, -shock);
      else if (edge) shiftCombatantComposure(u, +1);
    }
  };
  nerve(allyUnits, allyBreaks, aStand >= eStand);
  nerve(enemyUnits, enemyBreaks, eStand >= aStand);
  if (mc && mc.standing) {
    if (allyBreaks > 0) applyComposureChange(state, -clamp(allyBreaks, 0, 2), eng);
    else if (aStand >= eStand) applyComposureChange(state, +1, eng);
  }
}

/* ------------------------------------------------------------------ */
/* The sheet's conditions (lasting wounds, curses, gear)                */
/* ------------------------------------------------------------------ */

/* The live combatant record for a name inside whatever fight is running. */
export function liveCombatant(state, name) {
  const match = (u) => u && typeof u.name === 'string' && samePersonName(u.name, name);
  if (state && state.duel) {
    if (match(state.duel.player)) return state.duel.player;
    if (match(state.duel.opp)) return state.duel.opp;
  }
  if (state && state.battle) {
    for (const u of (state.battle.allies || [])) if (match(u)) return u;
    for (const u of (state.battle.enemies || [])) if (match(u)) return u;
  }
  return null;
}

/* M345: a domain in plain words, for anything the storyteller reads */
export const DOMAIN_WORDS = {
  melee: 'in close fighting', ranged: 'in anything at range', social: 'in dealing with people', intellect: 'in anything that takes thought',
  stealth: 'in moving unseen', craft: 'in anything made or mended by hand', athletics: 'in running, climbing and leaping', willpower: 'in holding firm',
  pilot: 'at the controls',
};

/* Apply a persistent condition change to the sheet, resolving "player" to
 * the story name. Creates the actor entry if needed, seeded from the LIVE
 * combatant's rating when one exists. Returns a note for narration. */
export function applyConditionChange(state, cc) {
  if (!cc) return null;
  const name = (/^(you|player|me|myself)$/i.test(String(cc.who || '')) || isMcAlias(state, cc.who))
    ? mcName(state)
    : safeKey(cc.who);
  if (!name) return null;
  state.sheet = state.sheet && typeof state.sheet === 'object' ? state.sheet : { actors: {}, playerName: '' };
  if (!state.sheet.actors || typeof state.sheet.actors !== 'object') state.sheet.actors = {};
  let entry = findActor(state, name);
  if (!entry) {
    let base = ENGINE_DEFAULTS.defaultRating;
    const live = liveCombatant(state, name);
    if (live && Number.isFinite(live.rating)) base = clamp(live.rating, 0, 10);
    entry = { default: base, domains: {}, _auto: true, conditions: [] };
    state.sheet.actors[name] = entry;
  }
  entry.conditions = Array.isArray(entry.conditions) ? entry.conditions : [];
  const notes = [];
  if (cc.remove) {
    const before = entry.conditions.length;
    const rl = cc.remove.toLowerCase();
    entry.conditions = entry.conditions.filter((c) => {
      const cn = String(c.name || '').toLowerCase();
      return !(cn === rl || cn.includes(rl) || rl.includes(cn));
    });
    if (entry.conditions.length < before) notes.push(name + ' is past ' + cc.remove + ' now');
  }
  if (cc.add) {
    const al = cc.add.toLowerCase();
    if (!entry.conditions.some((c) => String(c.name || '').toLowerCase() === al)) {
      /* M345: who filed it — the referee's own filings are never taken back by a re-seed of the sheet */
      const item = { name: cc.add, mod: cc.mod, by: cc.by || 'referee' };
      if (cc.domain) item.domain = cc.domain;
      if (cc.gear) item.gear = true;
      entry.conditions.push(item);
      if (entry.conditions.length > 8) entry.conditions.shift();
      /* M345: this note rides to the storyteller — words, never a modifier */
      notes.push(cc.gear
        ? name + ' now has ' + cc.add + ', and it helps' + (DOMAIN_WORDS[cc.domain] ? ' ' + DOMAIN_WORDS[cc.domain] : '')
        : name + ' now carries ' + cc.add + ', and it tells' + (DOMAIN_WORDS[cc.domain] ? ' ' + DOMAIN_WORDS[cc.domain] : '') + ' while it lasts');
    }
  }
  if (!entry.conditions.length) delete entry.conditions;
  /* A persistent condition lands on the LIVE fight too, not only future
   * ones — a mid-duel "broken arm" changes THIS duel's math. */
  refreshLiveRating(state, name);
  return notes.length ? notes.join('; ') : null;
}

/* Refresh a live combatant's effective rating from the just-updated sheet. */
export function refreshLiveRating(state, who) {
  const name = (/^(you|player|me|myself)$/i.test(String(who || '')) || isMcAlias(state, who))
    ? mcName(state)
    : who;
  const u = liveCombatant(state, name);
  if (!u) return;
  const entry = findActor(state, name);
  if (!entry) return;
  const domain = (state.duel && (u === state.duel.player || u === state.duel.opp))
    ? state.duel.domain
    : (state.battle ? state.battle.domain : 'melee');
  u.rating = ratingFor(entry, domain, ENGINE_DEFAULTS.defaultRating);
}

/* Persist an estimated opponent's rating as a sheet baseline, so the same
 * foe doesn't get re-estimated (and wobble) next encounter. MUST run on
 * every fight-teardown path. */
export function persistFightEstimates(state) {
  try {
    if (!state) return false;
    let wrote = false;
    const put = (name, rating, domain) => {
      const key = safeKey(name);
      if (!key || findActor(state, key)) return;
      state.sheet = state.sheet && typeof state.sheet === 'object' ? state.sheet : { actors: {}, playerName: '' };
      if (!state.sheet.actors) state.sheet.actors = {};
      state.sheet.actors[key] = {
        default: clamp(rating, 0, 10),
        domains: { [domain || 'melee']: clamp(rating, 0, 10) },
        _estimated: true,
      };
      wrote = true;
    };
    const d = state.duel;
    if (d && d.opp && d.opp.estimated && d.opp.name) put(d.opp.name, d.opp.rating, d.domain);
    const b = state.battle;
    if (b && Array.isArray(b.enemies)) {
      for (const u of b.enemies) if (u && u.estimated && u.name) put(u.name, u.rating, b.domain);
    }
    return wrote;
  } catch (err) {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* The duel                                                            */
/* ------------------------------------------------------------------ */

export function duelActive(state) {
  return Boolean(state && state.duel && state.duel.active && !state.duel.over);
}

export function battleActive(state) {
  return Boolean(state && state.battle && state.battle.active && !state.battle.over);
}

export const standing = (units) => (units || []).filter((u) => u && u.standing);
export const moraleOf = (units) => (units && units.length ? standing(units).length / units.length : 0);
export const moraleWord = (f) => (f > 0.75 ? 'steady' : f > 0.4 ? 'wavering' : f > 0 ? 'breaking' : 'broken');
const nonPlayer = (units) => (units || []).filter((u) => u && !u.isPlayer);

/* Open a duel. Mode exclusivity: exactly ONE fight can be live — any battle
 * underneath is discarded (its estimated foes keep their baseline). */
export function startDuel(state, { playerName, oppName, domain, oppEstimate, scaleMismatch }, eng) {
  const fallback = clamp(eng.defaultRating, 0, 10);
  const pEntry = findActor(state, playerName);
  const oEntry = findActor(state, oppName);
  const d = String(domain || 'melee').toLowerCase();
  const pPoise = poiseFor(pEntry, eng.duelPoise);
  const oPoise = poiseFor(oEntry, eng.duelPoise);
  /* Opponent rating priority: sheet entry > context estimate > trained. */
  const oppRating = oEntry
    ? ratingFor(oEntry, d, fallback)
    : (Number.isFinite(oppEstimate) ? clamp(oppEstimate, 0, 10) : clamp(TIER_RATINGS.trained, 0, 10));
  persistFightEstimates(state);
  state.battle = null;
  state.duel = {
    active: true,
    over: false,
    victor: null,
    round: 0,
    domain: d,
    scaleMismatch: clamp(Math.round(Number(scaleMismatch) || 0), -4, 4),
    player: { name: playerName, rating: ratingFor(pEntry, d, fallback), poise: pPoise, maxPoise: pPoise, injuries: 0, momentum: 0, opening: false },
    opp: {
      name: oppName, rating: oppRating, poise: oPoise, maxPoise: oPoise, injuries: 0, momentum: 0, opening: false,
      estimated: !oEntry && Number.isFinite(oppEstimate),
      composure: eng.composureMax, composureMax: eng.composureMax,
    },
  };
  return state.duel;
}

/* Resolve a recovery: the player disengages to restore poise, ceding tempo.
 * STAMINA IS FINITE — across one fight a fighter claws back at most one
 * pool's worth, tracked cumulatively, or recovery out-earning the free
 * swing becomes an unbounded loop. The free swing is FLOORED at 0.5 while a
 * standing foe rates 3+: favorable circumstance helps a lot but can never
 * buy total safety mid-fight (the risk-free heal loop). */
export function resolveDuelRecovery(state, circumstance, eng) {
  const duel = state.duel;
  duel.player.opening = false;
  const delta = clamp(5 - duel.opp.rating + circumstance + eng.preset.bonus, -13, 13);
  const P = probFromDelta(delta);
  const u = rngFloat();
  const tier = sliceOutcome(P, u, eng.preset.mods);
  const budget = Math.max(0, duel.player.maxPoise - (duel.recovered || 0));
  const heal = Math.min(RECOVER_EFFECTS[tier] ?? 1, budget);
  const before = duel.player.poise;
  duel.player.poise = Math.min(duel.player.maxPoise, Math.round((duel.player.poise + heal) * 2) / 2);
  duel.recovered = Math.round(((duel.recovered || 0) + (duel.player.poise - before)) * 2) / 2;
  const oppEff = duel.opp.rating - duel.opp.injuries + combatantComposurePenalty(duel.opp, eng);
  let counter = 0;
  if (oppEff >= 7) counter = 1.5;
  else if (oppEff >= 5) counter = 1;
  else if (oppEff >= 3) counter = 0.5;
  const counterFloor = counter > 0 ? 0.5 : 0;
  counter = Math.max(counterFloor, counter - circumstance * 0.5);
  if (counter > 0) {
    duel.player.poise = Math.round((duel.player.poise - counter) * 2) / 2;
  }
  const gained = Math.round((duel.player.poise - before) * 2) / 2;
  /* Ceding tempo: the opponent presses freely and gains momentum. */
  duel.opp.momentum = Math.min(1, (duel.opp.momentum || 0) + 0.5);
  duel.player.momentum = 0;
  duel.opp.opening = true; // the opening the player gave up is exploitable
  duel.round += 1;
  let over = false;
  let victor = null;
  if (duel.player.poise <= 0) {
    over = true;
    victor = 'opp';
    duel.over = true;
    duel.victor = 'opp';
  }
  return { recover: true, tier, gained, counter, delta, P, u, over, victor, aR: 5, oR: duel.opp.rating, oppLabel: duel.opp.name };
}

/* Resolve one duel exchange: consume openings, roll, apply, advance. */
export function resolveDuelExchange(state, circumstance, moveKind, eng) {
  const duel = state.duel;

  if (moveKind === 'recover' && !outcomeOnly(eng)) {
    return resolveDuelRecovery(state, circumstance, eng);
  }

  const style = outcomeOnly(eng);
  const openingBonus = (!style && duel.player.opening) ? 1 : 0;
  if (!style) duel.player.opening = false;
  const oppOpeningBonus = (!style && duel.opp.opening) ? 1 : 0;
  if (!style) duel.opp.opening = false;

  /* Captured BEFORE the exchange mutates them, so the audit describes the
   * roll that happened, not the state it produced. */
  const audit = { pBase: duel.player.rating, pInj: duel.player.injuries, oBase: duel.opp.rating, oInj: duel.opp.injuries };
  const effP = duel.player.rating - duel.player.injuries + duel.player.momentum + openingBonus;
  const effO = duel.opp.rating - duel.opp.injuries + duel.opp.momentum + oppOpeningBonus;
  const compPen = composurePenalty(state, eng);
  const oppCompPen = combatantComposurePenalty(duel.opp, eng);
  const delta = clamp(effP - effO + circumstance + (duel.scaleMismatch || 0) + compPen - oppCompPen + eng.preset.bonus, -13, 13);
  const P = probFromDelta(delta);
  const u = rngFloat();
  const tier = tieCheck(sliceOutcome(P, u, eng.preset.mods), P, u, eng.tieBand);

  if (style) {
    /* Outcome-only: the verdict IS the whole result. No poise, no forced
     * injuries, no momentum, no engine-declared end. */
    duel.round += 1;
    return { aR: effP, oR: effO, oppLabel: duel.opp.name, delta, P, u, tier, opening: false, outcome: true, ...audit };
  }
  const applied = applyExchangeEffects(duel.player, duel.opp, tier, delta);
  duel.player = { name: duel.player.name, rating: duel.player.rating, maxPoise: duel.player.maxPoise, ...applied.player };
  duel.opp = { name: duel.opp.name, rating: duel.opp.rating, maxPoise: duel.opp.maxPoise, ...applied.opp };
  duel.round += 1;
  if (applied.over) {
    duel.over = true;
    duel.victor = applied.victor;
  }
  return { aR: effP, oR: effO, oppLabel: duel.opp.name, delta, P, u, tier, opening: openingBonus > 0, ...audit };
}

/* Resolve a described COMBO (2+ strikes) as ONE exchange with per-strike
 * texture: a landed strike opens the next, a fumbled one leaves the player
 * exposed so the chain can collapse. High-risk, never a free multiplier —
 * the whole chain maps to a single, symmetric overall exchange outcome. */
export function resolveDuelSequence(state, adj, eng) {
  const duel = state.duel;
  const style = outcomeOnly(eng);
  const openingBonus = (!style && duel.player.opening) ? 1 : 0;
  if (!style) duel.player.opening = false;
  const oppOpeningBonus = (!style && duel.opp.opening) ? 1 : 0;
  if (!style) duel.opp.opening = false;
  const compPen = composurePenalty(state, eng);
  const oppCompPen = combatantComposurePenalty(duel.opp, eng);
  const effO = duel.opp.rating - duel.opp.injuries + duel.opp.momentum + oppOpeningBonus;
  const audit = { pBase: duel.player.rating, pInj: duel.player.injuries, oBase: duel.opp.rating, oInj: duel.opp.injuries };
  const scoreOf = { DECISIVE: 2, SUCCESS: 1, SUCCESS_COST: 1, TRADE: 0, STALEMATE: 0, SETBACK: -1, FAILURE: -1, DISASTER: -2 };
  const seq = adj.sequence;
  const n = seq.length;
  const steps = [];
  let carry = openingBonus;
  let net = 0;
  let lastU = 0;
  for (const st of seq) {
    const effP = duel.player.rating - duel.player.injuries + duel.player.momentum + carry;
    const delta = clamp(effP - effO + st.circumstance + (duel.scaleMismatch || 0) + compPen - oppCompPen + eng.preset.bonus, -13, 13);
    const P = probFromDelta(delta);
    const u = rngFloat();
    lastU = u;
    const tier = tieCheck(sliceOutcome(P, u, eng.preset.mods), P, u, eng.tieBand);
    const sc = scoreOf[tier] ?? 0;
    net += sc;
    if (sc > 0) carry = Math.min(2, carry + 1);
    else if (tier === 'DISASTER') carry = Math.max(-2, carry - 2);
    else if (sc < 0) carry = Math.max(-2, carry - 1);
    steps.push({ strike: st.strike, tier });
  }
  const frac = net / (2 * n);
  const overall = frac >= 0.5 ? 'DECISIVE' : frac > 0 ? 'SUCCESS' : frac === 0 ? 'TRADE' : frac > -0.5 ? 'FAILURE' : 'DISASTER';
  const avgCirc = seq.reduce((t, x) => t + x.circumstance, 0) / n;
  const margin = clamp((duel.player.rating - duel.player.injuries + duel.player.momentum) - effO + avgCirc + (duel.scaleMismatch || 0) + compPen - oppCompPen + eng.preset.bonus, -13, 13);
  if (style) {
    duel.round += 1;
    return { steps, overall, tier: overall, aR: duel.player.rating, oR: effO, delta: margin, P: probFromDelta(margin), u: lastU, combo: true, over: false, victor: null, outcome: true, ...audit };
  }
  const applied = applyExchangeEffects(duel.player, duel.opp, overall, margin);
  duel.player = { name: duel.player.name, rating: duel.player.rating, maxPoise: duel.player.maxPoise, ...applied.player };
  duel.opp = { name: duel.opp.name, rating: duel.opp.rating, maxPoise: duel.opp.maxPoise, ...applied.opp };
  duel.round += 1;
  if (applied.over) {
    duel.over = true;
    duel.victor = applied.victor;
  }
  return { steps, overall, tier: overall, aR: duel.player.rating, oR: effO, delta: margin, P: probFromDelta(margin), u: lastU, combo: true, over: applied.over, victor: applied.victor, ...audit };
}

/* ------------------------------------------------------------------ */
/* The battle — party-scale engagements                                */
/* ------------------------------------------------------------------ */

/* Expand roster names ("Bandit x3") into unit objects with sheet lookups.
 * oppEstimate binds to the first UNLISTED enemy base name — a legendary
 * foe opening a battle with minions keeps the estimate a duel would get.
 * Generic xN squads use EXACT sheet lookup only (a mook squad must never
 * inherit a named character's rating off a common-noun collision). */
function buildUnits(state, names, domain, isEnemySide, oppEstimate, eng) {
  const fallback = clamp(eng.defaultRating, 0, 10);
  const units = [];
  let estimateFor = null;
  for (const raw of names || []) {
    const m = String(raw).match(/^(.*?)(?:\s*[x×]\s*(\d{1,2}))\s*$/i);
    const base = (m ? m[1] : raw).trim();
    const count = m ? clamp(parseInt(m[2], 10), 1, 8) : 1;
    for (let i = 1; i <= count && units.length < 10; i += 1) {
      const name = count > 1 ? base + ' ' + i : base;
      const entry = count > 1
        ? (findActorKeyExact(state, base) ? state.sheet.actors[findActorKeyExact(state, base)] : null)
        : (findActor(state, base) || findActor(state, name));
      let rating;
      let estimated = false;
      if (entry) rating = ratingFor(entry, domain, fallback);
      else if (isEnemySide && Number.isFinite(oppEstimate) && (estimateFor === null || estimateFor === base)) {
        estimateFor = base;
        rating = clamp(oppEstimate, 0, 10);
        estimated = count === 1; // a count the fiction spawned is never promoted into the cast
      } else {
        rating = isEnemySide ? clamp(TIER_RATINGS.trained, 0, 10) : fallback;
      }
      const poise = poiseFor(entry, eng.duelPoise);
      const unit = {
        name, rating, poise, maxPoise: poise, injuries: 0, momentum: 0, opening: false,
        standing: true, isPlayer: false, composure: eng.composureMax, composureMax: eng.composureMax,
      };
      if (estimated) unit.estimated = true;
      units.push(unit);
    }
  }
  return units;
}

export function startBattle(state, { allies, enemies, domain, scaleMismatch, oppEstimate }, eng) {
  const d = String(domain || 'melee').toLowerCase();
  const playerName = mcName(state);
  const pEntry = findActor(state, playerName);
  const mc = {
    name: playerName,
    rating: ratingFor(pEntry, d, clamp(eng.defaultRating, 0, 10)),
    poise: poiseFor(pEntry, eng.duelPoise), maxPoise: poiseFor(pEntry, eng.duelPoise),
    injuries: 0, momentum: 0, opening: false, standing: true, isPlayer: true,
  };
  const allyUnits = buildUnits(state, (allies || []).filter((n) => !isMcAlias(state, n)), d, false, null, eng);
  /* M177: THE WRITER IS NEVER ON THE ENEMY LINE — at the ENGINE, not only in
   * the referee's normalizer. combat.begin is a mutation like any other, and
   * the housekeeper can write one by hand through <ledits>; only the ally
   * roster was ever filtered here, so a hand-written fight could still build
   * an enemy unit out of the main character and set them against themselves. */
  const enemyUnits = buildUnits(state, (enemies || []).filter((n) => !isMcAlias(state, n)), d, true, oppEstimate, eng);
  if (!enemyUnits.length) return null;
  persistFightEstimates(state); // mode exclusivity must not lose an estimated foe's baseline
  state.duel = null;
  state.battle = {
    active: true, over: false, victor: null, mcDown: false, round: 0, domain: d,
    scaleMismatch: clamp(Math.round(Number(scaleMismatch) || 0), -4, 4),
    allies: [mc].concat(allyUnits),
    enemies: enemyUnits,
  };
  return state.battle;
}

/* One ally-vs-enemy pairing, from the ally's perspective. Openings are
 * SYMMETRIC — both sides consume and spend what they earned. */
function resolvePairing(a, e, extraDelta, eng) {
  const openingBonus = a.opening ? 1 : 0;
  a.opening = false;
  const eOpeningBonus = e.opening ? 1 : 0;
  e.opening = false;
  const delta = clamp(
    (a.rating - a.injuries + a.momentum + openingBonus)
      - (e.rating - e.injuries + e.momentum + eOpeningBonus)
      + combatantComposurePenalty(a, eng) - combatantComposurePenalty(e, eng)
      + extraDelta + eng.preset.bonus,
    -13, 13
  );
  const P = probFromDelta(delta);
  const u = rngFloat();
  const tier = tieCheck(sliceOutcome(P, u, eng.preset.mods), P, u, eng.tieBand);
  const r = applyExchangeEffects(a, e, tier, delta);
  Object.assign(a, r.player);
  Object.assign(e, r.opp);
  if (a.poise <= 0) a.standing = false;
  if (e.poise <= 0) e.standing = false;
  if (!e.standing) return a.name + ' puts ' + e.name + ' out of the fight.';
  if (!a.standing) return e.name + ' takes ' + a.name + ' down.';
  const fx = EXCHANGE_EFFECTS[tier] || {};
  if (fx.winner === 'self') return a.name + ' gets the better of ' + e.name + ' (' + e.name + ' is ' + poiseWord(e.poise, e.maxPoise) + ').';
  return e.name + ' pressures ' + a.name + ' (' + a.name + ' is ' + poiseWord(a.poise, a.maxPoise) + ').';
}

/* Resolve one battle round for the player's scored move. */
/* M166: THE FIELD ALWAYS HAS THE WRITER ON IT. startBattle and startWar
 * prepend the main character's unit, but a fight read back from an older
 * save — or restored from one of the referee's own snapshots — may carry
 * allies that never wore isPlayer, and every reader here dereferenced the
 * result: `mc.rating` threw out of the whole referee step, the turn failed,
 * and the page was never written. The first ally stands in and is marked;
 * a field with no allies at all is not a fight. */
function playerUnit(b) {
  const allies = b && Array.isArray(b.allies) ? b.allies : [];
  let mc = allies.find((u) => u && u.isPlayer);
  if (!mc && allies.length) { mc = allies[0]; mc.isPlayer = true; }
  return mc || null;
}

export function resolveBattleRound(state, mv, eng) {
  const b = state.battle;
  const mAll = clamp(Math.round((moraleOf(b.allies) - moraleOf(b.enemies)) * 2) / 2, -1, 1);
  /* M166: THE FIELD ALWAYS HAS THE WRITER ON IT. startBattle prepends the
   * main character's unit, but a battle read back from an older save — or
   * from a snapshot the referee restores — may carry allies that never
   * wore isPlayer, and `mc.rating` then threw out of the whole referee
   * step: the turn failed and the page was never written. The first ally
   * stands in, and a field with no allies at all is simply not a battle. */
  const mc = playerUnit(b);
  if (!mc) { b.active = false; b.over = true; return { mcRes: null, reports: [], outcome: true }; }
  const aStand0 = standing(b.allies.filter((u) => !u.isPlayer)).length;
  const eStand0 = standing(b.enemies).length;
  const reports = [];
  let mcRes = null;
  let sideMod = 0;
  let mcTargetName = null;

  if (outcomeOnly(eng)) {
    /* Outcome-only: adjudicate the player's action alone. Casualties,
     * morale, the rest of the field, and the battle's end belong to the
     * storyteller — nothing here ticks or concludes. */
    if (mv.kind === 'command') {
      const oppLead = Math.max(3, ...standing(b.enemies).map((u) => u.rating));
      const aR = mc.rating - mc.injuries;
      const delta = clamp(aR - oppLead + mv.circumstance + eng.preset.bonus + mAll + composurePenalty(state, eng) + (b.scaleMismatch || 0), -13, 13);
      const P = probFromDelta(delta);
      const u = rngFloat();
      mcRes = { delta, P, u, tier: sliceOutcome(P, u, eng.preset.mods), command: true, aR, oR: oppLead, oppLabel: 'the enemy line' };
    } else {
      let target = standing(b.enemies).find((u) => mv.target && u.name.toLowerCase() === mv.target.toLowerCase());
      if (!target) target = standing(b.enemies).slice().sort((x, y) => y.rating - x.rating)[0];
      if (target) {
        const aR = mc.rating - mc.injuries + mc.momentum;
        const oR = target.rating - target.injuries + target.momentum;
        const delta = clamp(aR - oR + mv.circumstance + eng.preset.bonus + mAll + composurePenalty(state, eng) - combatantComposurePenalty(target, eng) + (b.scaleMismatch || 0), -13, 13);
        const P = probFromDelta(delta);
        const u = rngFloat();
        mcRes = { delta, P, u, tier: tieCheck(sliceOutcome(P, u, eng.preset.mods), P, u, eng.tieBand), command: false, aR, oR, oppLabel: target.name, pBase: mc.rating, pInj: mc.injuries, oBase: target.rating, oInj: target.injuries };
      }
    }
    b.round += 1;
    return { mcRes, reports: [], outcome: true };
  }

  if (mv.kind === 'command') {
    const oppLead = Math.max(3, ...standing(b.enemies).map((u) => u.rating));
    const openingBonus = mc.opening ? 1 : 0;
    mc.opening = false;
    const aR = mc.rating - mc.injuries + openingBonus;
    const delta = clamp(aR - oppLead + mv.circumstance + eng.preset.bonus + mAll + composurePenalty(state, eng) + (b.scaleMismatch || 0), -13, 13);
    const P = probFromDelta(delta);
    const u = rngFloat();
    const tier = sliceOutcome(P, u, eng.preset.mods);
    sideMod = ({ DECISIVE: 2, SUCCESS: 1, SUCCESS_COST: 1, SETBACK: -1, FAILURE: -1, DISASTER: -2 })[tier] || 0;
    if (tier === 'SUCCESS_COST' || tier === 'DISASTER') {
      mc.poise = Math.max(0, mc.poise - 0.5);
      if (mc.poise <= 0) mc.standing = false;
    }
    mcRes = { delta, P, u, tier, command: true, aR, oR: oppLead, oppLabel: 'the enemy line' };
  } else {
    let target = standing(b.enemies).find((u) => mv.target && u.name.toLowerCase() === mv.target.toLowerCase());
    if (!target) target = standing(b.enemies).slice().sort((x, y) => y.rating - x.rating)[0];
    if (target) {
      mcTargetName = target.name;
      const audit = { pBase: mc.rating, pInj: mc.injuries, oBase: target.rating, oInj: target.injuries };
      const openingBonus = mc.opening ? 1 : 0;
      mc.opening = false;
      const tOpeningBonus = target.opening ? 1 : 0;
      target.opening = false;
      const aR = mc.rating - mc.injuries + mc.momentum + openingBonus;
      const oR = target.rating - target.injuries + target.momentum + tOpeningBonus;
      const delta = clamp(aR - oR + mv.circumstance + eng.preset.bonus + mAll + composurePenalty(state, eng) - combatantComposurePenalty(target, eng) + (b.scaleMismatch || 0), -13, 13);
      const P = probFromDelta(delta);
      const u = rngFloat();
      const tier = tieCheck(sliceOutcome(P, u, eng.preset.mods), P, u, eng.tieBand);
      const r = applyExchangeEffects(mc, target, tier, delta);
      Object.assign(mc, r.player);
      Object.assign(target, r.opp);
      if (mc.poise <= 0) mc.standing = false;
      if (target.poise <= 0) target.standing = false;
      mcRes = { delta, P, u, tier, command: false, aR, oR, oppLabel: target.name, ...audit };
    }
  }

  /* Auto-resolve the rest of the field: pair standing allies vs enemies. */
  const freeAllies = standing(b.allies).filter((u) => !u.isPlayer);
  const freeEnemies = standing(b.enemies).filter((u) => u.name !== mcTargetName);
  const A = freeAllies.slice().sort((x, y) => y.rating - x.rating);
  const Ev = freeEnemies.slice().sort((x, y) => y.rating - x.rating);
  const pairs = Math.min(A.length, Ev.length);
  const gang = A.length === Ev.length ? 0 : (A.length > Ev.length ? 1 : -1);
  for (let i = 0; i < pairs; i += 1) {
    reports.push(resolvePairing(A[i], Ev[i], sideMod + mAll + gang + (b.scaleMismatch || 0), eng));
  }

  b.round += 1;
  if (!standing(b.enemies).length) { b.over = true; b.victor = 'allies'; } else if (!standing(b.allies).length) { b.over = true; b.victor = 'enemies'; } else if (!mc.standing) {
    /* The player is out: conclude the field fairly, without their agency. */
    b.mcDown = true;
    let guard = 0;
    while (!b.over && guard < 6) {
      guard += 1;
      const As = standing(b.allies).filter((u) => !u.isPlayer).sort((x, y) => y.rating - x.rating);
      const Es = standing(b.enemies).sort((x, y) => y.rating - x.rating);
      if (!As.length) { b.over = true; b.victor = 'enemies'; break; }
      if (!Es.length) { b.over = true; b.victor = 'allies'; break; }
      const n = Math.min(As.length, Es.length);
      const g2 = As.length === Es.length ? 0 : (As.length > Es.length ? 1 : -1);
      for (let i = 0; i < n; i += 1) reports.push(resolvePairing(As[i], Es[i], g2, eng));
      if (!standing(b.enemies).length) { b.over = true; b.victor = 'allies'; } else if (!standing(b.allies).filter((u) => !u.isPlayer).length) { b.over = true; b.victor = 'enemies'; }
    }
    if (!b.over) {
      const aSum = standing(b.allies).filter((u) => !u.isPlayer).reduce((t, u) => t + u.rating, 0);
      const eSum = standing(b.enemies).reduce((t, u) => t + u.rating, 0);
      b.over = true;
      b.victor = aSum >= eSum ? 'allies' : 'enemies';
    }
  }
  if (!b.over) {
    applyMoraleShock(state, b,
      aStand0 - standing(b.allies.filter((u) => !u.isPlayer)).length,
      eStand0 - standing(b.enemies).length, eng);
  }
  return { mcRes, reports };
}

/* ------------------------------------------------------------------ */
/* The war — the player commands formations at army scale               */
/* ------------------------------------------------------------------ */

export function startWar(state, { allies, enemies, enemyCommander, scaleMismatch }, eng) {
  const playerName = mcName(state);
  const pEntry = findActor(state, playerName);
  const fallback = clamp(eng.defaultRating, 0, 10);
  /* Commander tactics: prefer tactics/command/intellect, else default. */
  const cmdA = ratingFor(pEntry, 'tactics', ratingFor(pEntry, 'command', ratingFor(pEntry, 'intellect', fallback)));
  const ecEntry = enemyCommander ? findActor(state, enemyCommander) : null;
  const cmdE = ecEntry ? ratingFor(ecEntry, 'tactics', ratingFor(ecEntry, 'command', 5)) : 5;
  const mc = {
    name: playerName,
    rating: ratingFor(pEntry, 'melee', fallback),
    poise: poiseFor(pEntry, eng.duelPoise), maxPoise: poiseFor(pEntry, eng.duelPoise),
    injuries: 0, momentum: 0, opening: false, standing: true, isPlayer: true,
  };
  const mkUnits = (names, isEnemy) => {
    const units = [];
    for (const raw of names || []) {
      const m = String(raw).match(/^(.*?)(?:\s*[x×]\s*(\d{1,2}))\s*$/i);
      const base = (m ? m[1] : raw).trim();
      const count = m ? clamp(parseInt(m[2], 10), 1, 6) : 1;
      for (let i = 1; i <= count && units.length < 8; i += 1) {
        const name = count > 1 ? base + ' ' + i : base;
        const entry = count > 1
          ? (findActorKeyExact(state, base) ? state.sheet.actors[findActorKeyExact(state, base)] : null)
          : (findActor(state, base) || findActor(state, name));
        const rating = entry ? ratingFor(entry, 'war', ratingFor(entry, 'melee', fallback)) : (isEnemy ? 4 : fallback);
        const strength = poiseFor(entry, eng.warStrength);
        units.push({
          name, rating, poise: strength, maxPoise: strength, injuries: 0, momentum: 0, opening: false,
          standing: true, isPlayer: false, composure: eng.composureMax, composureMax: eng.composureMax,
        });
      }
    }
    return units;
  };
  const allyUnits = mkUnits((allies || []).filter((n) => !isMcAlias(state, n)), false);
  /* M177: the same law on the war's line (see startBattle). */
  const enemyUnits = mkUnits((enemies || []).filter((n) => !isMcAlias(state, n)), true);
  /* A war needs BOTH lines — an empty allied line is not a rout, it's a
   * refusal: the turn falls through to an honest check or duel instead of
   * a fabricated defeat. */
  if (!enemyUnits.length || !allyUnits.length) return null;
  persistFightEstimates(state);
  state.duel = null;
  state.battle = {
    kind: 'war', active: true, over: false, victor: null, mcDown: false, round: 0, domain: 'war',
    cmdA, cmdE, enemyCommander: enemyCommander || null,
    conditions: [],
    scaleMismatch: clamp(Math.round(Number(scaleMismatch) || 0), -4, 4),
    allies: [mc].concat(allyUnits),
    enemies: enemyUnits,
  };
  return state.battle;
}

function conditionsField(b) {
  return (b.conditions || []).reduce((t, c) => t + (c.favors === 'allies' ? c.mod : -c.mod), 0);
}

function pickUnit(units, name) {
  const st = standing(units);
  if (name) {
    const t = String(name).toLowerCase();
    const hit = st.find((u) => u.name.toLowerCase() === t)
      || st.find((u) => u.name.toLowerCase().includes(t) || t.includes(u.name.toLowerCase()));
    if (hit) return hit;
  }
  return st.slice().sort((x, y) => y.rating - x.rating)[0] || null;
}

/* Resolve one war round for the commander's scored order. */
export function resolveWarRound(state, mv, eng) {
  const b = state.battle;
  const F = conditionsField(b);
  const mAll = clamp(Math.round((moraleOf(nonPlayer(b.allies)) - moraleOf(b.enemies)) * 2) / 2, -1, 1);
  const cmdEdge = clamp(Math.round(((b.cmdA - b.cmdE) / 2) * 2) / 2, -2, 2);
  const mc = playerUnit(b);
  if (!mc) { b.active = false; b.over = true; return { focalRes: null, reports: [], outcome: true }; }
  const aStand0 = standing(nonPlayer(b.allies)).length;
  const eStand0 = standing(b.enemies).length;
  const reports = [];
  let focalRes = null;
  let condNote = null;
  let acting = null;
  let target = null;

  if (outcomeOnly(eng)) {
    /* Outcome-only: score this order and nothing else. */
    if (mv.kind === 'stratagem') {
      const delta = clamp(b.cmdA - b.cmdE + mv.circumstance + mAll + eng.preset.bonus + composurePenalty(state, eng), -13, 13);
      const P = probFromDelta(delta);
      const u = rngFloat();
      focalRes = { delta, P, u, tier: sliceOutcome(P, u, eng.preset.mods), stratagem: true, aR: b.cmdA, oR: b.cmdE, oppLabel: b.enemyCommander || 'enemy command' };
    } else if (mv.kind === 'personal' && mc) {
      target = pickUnit(b.enemies, mv.target);
      if (target) {
        const aR = mc.rating - mc.injuries + mc.momentum;
        const oR = target.rating - target.injuries + target.momentum;
        const delta = clamp(aR - oR + mv.circumstance + F + mAll + eng.preset.bonus + composurePenalty(state, eng) - combatantComposurePenalty(target, eng) + (b.scaleMismatch || 0), -13, 13);
        const P = probFromDelta(delta);
        const u = rngFloat();
        focalRes = { delta, P, u, tier: tieCheck(sliceOutcome(P, u, eng.preset.mods), P, u, eng.tieBand), personal: true, aR, oR, oppLabel: target.name, pBase: mc.rating, pInj: mc.injuries, oBase: target.rating, oInj: target.injuries };
      }
    } else {
      acting = pickUnit(nonPlayer(b.allies), mv.acting);
      target = pickUnit(b.enemies, mv.target);
      if (acting && target) {
        const aR = acting.rating - acting.injuries + acting.momentum + cmdEdge;
        const oR = target.rating - target.injuries + target.momentum;
        const delta = clamp(aR - oR + mv.circumstance + F + mAll + eng.preset.bonus + combatantComposurePenalty(acting, eng) - combatantComposurePenalty(target, eng) + (b.scaleMismatch || 0), -13, 13);
        const P = probFromDelta(delta);
        const u = rngFloat();
        focalRes = { delta, P, u, tier: tieCheck(sliceOutcome(P, u, eng.preset.mods), P, u, eng.tieBand), aR, oR, oppLabel: target.name, pBase: acting.rating, pInj: acting.injuries, oBase: target.rating, oInj: target.injuries };
      }
    }
    b.round += 1;
    return { focalRes, reports: [], condNote: null, acting, target, outcome: true };
  }

  if (mv.kind === 'stratagem') {
    const delta = clamp(b.cmdA - b.cmdE + mv.circumstance + mAll + eng.preset.bonus + composurePenalty(state, eng), -13, 13);
    const P = probFromDelta(delta);
    const u = rngFloat();
    const tier = sliceOutcome(P, u, eng.preset.mods);
    focalRes = { delta, P, u, tier, stratagem: true, aR: b.cmdA, oR: b.cmdE, oppLabel: b.enemyCommander || 'enemy command' };
    const fx = STRATAGEM_EFFECTS[tier] || {};
    if (fx.condMod > 0) {
      b.conditions = b.conditions || [];
      b.conditions.push({ name: String(mv.action).slice(0, 60), favors: fx.favors, mod: fx.condMod });
      if (b.conditions.length > 3) b.conditions.shift();
      condNote = { favors: fx.favors, mod: fx.condMod };
    }
    if (fx.selfCost) {
      const strongest = pickUnit(nonPlayer(b.allies), null);
      if (strongest) {
        strongest.poise = Math.max(0, strongest.poise - fx.selfCost);
        if (strongest.poise <= 0) strongest.standing = false;
      }
    }
    if (fx.opening && mc) mc.opening = true;
    if (fx.enemyMomentum) {
      const e = pickUnit(b.enemies, null);
      if (e) e.momentum = Math.min(1, (e.momentum || 0) + 0.5);
    }
  } else if (mv.kind === 'personal' && mc) {
    target = pickUnit(b.enemies, mv.target);
    if (target) {
      const audit = { pBase: mc.rating, pInj: mc.injuries, oBase: target.rating, oInj: target.injuries };
      const openingBonus = mc.opening ? 1 : 0;
      mc.opening = false;
      const tOpeningBonus = target.opening ? 1 : 0;
      target.opening = false;
      const aR = mc.rating - mc.injuries + mc.momentum + openingBonus;
      const oR = target.rating - target.injuries + target.momentum + tOpeningBonus;
      const delta = clamp(aR - oR + mv.circumstance + F + mAll + eng.preset.bonus + composurePenalty(state, eng) - combatantComposurePenalty(target, eng) + (b.scaleMismatch || 0), -13, 13);
      const P = probFromDelta(delta);
      const u = rngFloat();
      const tier = tieCheck(sliceOutcome(P, u, eng.preset.mods), P, u, eng.tieBand);
      const r = applyExchangeEffects(mc, target, tier, delta);
      Object.assign(mc, r.player);
      Object.assign(target, r.opp);
      if (mc.poise <= 0) mc.standing = false;
      if (target.poise <= 0) target.standing = false;
      focalRes = { delta, P, u, tier, personal: true, aR, oR, oppLabel: target.name, ...audit };
    }
  } else {
    acting = pickUnit(nonPlayer(b.allies), mv.acting);
    target = pickUnit(b.enemies, mv.target);
    if (acting && target) {
      const audit = { pBase: acting.rating, pInj: acting.injuries, oBase: target.rating, oInj: target.injuries };
      const openingBonus = acting.opening ? 1 : 0;
      acting.opening = false;
      const tOpeningBonus = target.opening ? 1 : 0;
      target.opening = false;
      const aR = acting.rating - acting.injuries + acting.momentum + openingBonus + cmdEdge;
      const oR = target.rating - target.injuries + target.momentum + tOpeningBonus;
      const delta = clamp(aR - oR + mv.circumstance + F + mAll + eng.preset.bonus + combatantComposurePenalty(acting, eng) - combatantComposurePenalty(target, eng) + (b.scaleMismatch || 0), -13, 13);
      const P = probFromDelta(delta);
      const u = rngFloat();
      const tier = tieCheck(sliceOutcome(P, u, eng.preset.mods), P, u, eng.tieBand);
      const r = applyExchangeEffects(acting, target, tier, delta);
      Object.assign(acting, r.player);
      Object.assign(target, r.opp);
      if (acting.poise <= 0) acting.standing = false;
      if (target.poise <= 0) target.standing = false;
      focalRes = { delta, P, u, tier, aR, oR, oppLabel: target.name, ...audit };
    }
  }

  /* The rest of the line clashes: remaining formations auto-pair. */
  const A = standing(nonPlayer(b.allies)).filter((u) => u !== acting).sort((x, y) => y.rating - x.rating);
  const Ev = standing(b.enemies).filter((u) => u !== target).sort((x, y) => y.rating - x.rating);
  const pairs = Math.min(A.length, Ev.length);
  const gang = A.length === Ev.length ? 0 : (A.length > Ev.length ? 1 : -1);
  for (let i = 0; i < pairs; i += 1) {
    reports.push(resolvePairing(A[i], Ev[i], F + mAll + gang + Math.round((cmdEdge / 2) * 2) / 2 + (b.scaleMismatch || 0), eng));
  }

  b.round += 1;

  /* Collapse & rout. */
  const aliveA = standing(nonPlayer(b.allies)).length;
  const aliveE = standing(b.enemies).length;
  const strength = (units) => standing(units).reduce((t, u) => t + Math.max(0, u.poise), 0);
  const maxStrength = (units) => units.reduce((t, u) => t + u.maxPoise, 0) || 1;
  if (!aliveE) { b.over = true; b.victor = 'allies'; } else if (!aliveA) { b.over = true; b.victor = 'enemies'; } else {
    const eFrac = strength(b.enemies) / maxStrength(b.enemies);
    const aFrac = strength(nonPlayer(b.allies)) / maxStrength(nonPlayer(b.allies));
    const focalLostByE = focalRes && !focalRes.stratagem && ['DECISIVE', 'SUCCESS', 'SUCCESS_COST'].includes(focalRes.tier);
    const focalLostByA = focalRes && !focalRes.stratagem && ['SETBACK', 'FAILURE', 'DISASTER'].includes(focalRes.tier);
    if (eFrac <= 0.25 && focalLostByE) { b.over = true; b.victor = 'allies'; } else if (aFrac <= 0.25 && focalLostByA) { b.over = true; b.victor = 'enemies'; }
  }
  if (mc && !mc.standing && !b.over) { b.over = true; b.victor = 'enemies'; b.mcDown = true; }
  if (!b.over) {
    applyMoraleShock(state, b,
      aStand0 - standing(nonPlayer(b.allies)).length,
      eStand0 - standing(b.enemies).length, eng);
  }
  return { focalRes, reports, condNote, acting, target };
}

/* ------------------------------------------------------------------ */
/* The binding word — directives the storyteller must honor            */
/* ------------------------------------------------------------------ */

/* M345: THE WRITER'S OWN WORD ABOUT HIS MOVE. What the storyteller is told of an outcome the house has settled used to
 * open \"The house has ruled — duel, round 3: Jovan vs Kaiser\" (and, with the names set, \"Bruce's notebook has ruled\"),
 * then a form: \"The exchange lands: SUCCESS WITH COST —\", \"After the exchange:\", \"No rolls, no poise, no numbers, no
 * word of this note\". The writer: it must be natural, never corporate — it must not break his teller's persona. So
 * every outcome is now said the way a person tells a friend how his own move went: \"About the fight between Jovan and
 * Kaiser: Jovan goes for it — a feint low, then the disarm — and it works, but at a fair price…\". No headings, no
 * labels, no tier names in capitals, no numbers, no machinery (rolls, rounds, poise, the house, a note). What is
 * decided is exactly what it was: every law of the old text (the outcome binds, proportion, the kept secret, the
 * guard and its one honest path, the lasting wound, the called winner, the fight going on) is still said — in words.
 * RULED_HEAD stays the name the WRITER sees (the drawer, the receipt); it is never sent. */
export const RULED_HEAD = 'The house has ruled';

/* how each outcome is said — the attempt is the subject, so no pronoun is ever guessed */
export const SAY = {
  DECISIVE: 'it works cleanly and decisively — better than meant',
  SUCCESS: 'it works, just as meant',
  SUCCESS_COST: 'it works, but at a fair price — a small cost that never reverses the win: ground given up, something strained or half spent, lost tempo, a minor hurt, or a sliver of unwanted notice',
  SETBACK: 'it fails, but forward — the miss opens something real: an opening, a piece of information, or partial progress, never a free win',
  FAILURE: 'it fails, and the consequences follow naturally',
  DISASTER: 'it fails badly — something serious goes wrong beyond the attempt itself',
  TRADE: 'both land — an even, clashing exchange where each takes a real hit and neither gains the upper hand',
  STALEMATE: 'neither lands cleanly — each reads and counters the other, a tense reset with no advantage either way',
};
/* the same, short — one strike of a chain */
const SAY_SHORT = {
  DECISIVE: 'lands cleanly and hard', SUCCESS: 'lands', SUCCESS_COST: 'lands, at a price', SETBACK: 'misses, but opens something',
  FAILURE: 'fails', DISASTER: 'goes badly wrong', TRADE: 'both land', STALEMATE: 'neither lands',
};
const say = (tier) => SAY[tier] || SAY.FAILURE;
const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const countWord = (n) => COUNT_WORDS[n] || 'many';
const SETTLED = 'It’s settled — tell it just that way, in the story’s own voice, and keep all of this between us.';
const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
const clause = (t) => String(t || '').trim().replace(/[.\s]+$/, '');

/* Established-defense scoping: when the player maintains a stated guard, the opponent's side of ANY outcome comes
 * through an honest path — or not at all. */
const GUARD_NEG_TIERS = { TRADE: 1, SETBACK: 1, FAILURE: 1, DISASTER: 1, SUCCESS_COST: 1 };
export function guardLines(adj, playerName, oppName, tier) {
  if (!adj || !adj.playerGuard) return [];
  const out = [playerName + '’s guard still stands, as the story set it — ' + clause(adj.playerGuard) + '.'];
  if (GUARD_NEG_TIERS[tier]) {
    if (adj.counterPath) {
      out.push('Anything this costs ' + playerName + ' comes only through that one way in — ' + clause(adj.counterPath) + ' — so show it coming that way, never through contact the guard forbids.');
    } else {
      out.push(cap(oppName) + ' has no way through that guard this time — no contact, no wound. The bad turn is ' + playerName + '’s own attempt being read, slipped or stopped, and the cost is strain, footing, a jarred grip or lost tempo. The guard holds.');
    }
  }
  return out;
}

export function sideStatus(side) {
  const p = Math.max(0, side.poise);
  let t = side.name + ' is ' + poiseWord(p, side.maxPoise);
  if (side.injuries > 0) t += ', carrying ' + (side.injuries === 1 ? 'a lasting wound' : countWord(side.injuries) + ' lasting wounds');
  if (side.momentum > 0) t += ', with the momentum';
  if (typeof side.composure === 'number' && side.composureMax) {
    const frac = side.composure / side.composureMax;
    if (frac < 0.25) t += ', and visibly breaking — panic taking hold';
    else if (frac < 0.5) t += ', and rattled, nerve fraying';
  }
  return t;
}

const secretLine = (who, onlyFailure) => (onlyFailure
  ? 'Keep every consequence in proportion to how this went. If ' + who + ' was acting in secret or under cover, this doesn’t give it away — only a real failure could; at most a faint, deniable flicker of suspicion.'
  : 'Keep every consequence in proportion. If ' + who + ' was acting in secret or under cover, a win doesn’t give it away — at most a faint, deniable flicker of suspicion.');

/* A lone check: what was tried, how it went, what rides on it. */
export function buildDirective(adj, res) {
  const stakes = adj.stakes ? ' What’s riding on it: ' + clause(adj.stakes) + '.' : '';
  return [
    'About what ' + adj.actor + ' is trying — ' + clause(adj.action) + ': ' + say(res.tier) + '.' + stakes,
    ...guardLines(adj, adj.actor, adj.kind === 'actor' ? adj.opposition : 'whatever stands against it', res.tier),
    ...(res.tier === 'SUCCESS_COST' ? [secretLine(adj.actor, true)] : []), /* the one win whose price could leak a kept secret */
    SETTLED,
  ].join(' ');
}

export function buildDuelDirective(state, adj, res) {
  const duel = state.duel;
  const me = duel.player.name;
  const foe = duel.opp.name;
  const head = 'About the fight between ' + me + ' and ' + foe + ': ';
  if (res.recover) {
    const lines = [head + me + ' breaks off to recover — ' + clause(adj.action) + ' — '
      + (res.gained > 0 ? 'and it helps: ' + me + ' steadies, noticeably refreshed, hurts and tiredness eased but not erased. Show the recovery working.' : 'but under the pressure it barely helps; little comes back.')];
    if (res.counter > 0 && !res.over) lines.push('Breaking off left a gap, and ' + foe + ' lands a real blow in it — show it connecting; the recovery was not clean.');
    if (res.over) {
      lines.push('And ' + foe + ' punishes it: ' + me + ' dropped the guard to recover and pays for it with the fight. ' + foe + ' wins. Tell the ending the story has earned — a felling blow, a blade at the throat, a collapse — and it stands; ' + me + ' can’t rally.');
      lines.push(SETTLED);
      return lines.join(' ');
    }
    lines.push('It cost the initiative: ' + foe + ' presses freely into the gap ' + me + ' gave up — show that. ' + sideStatus(duel.player) + '; ' + sideStatus(duel.opp) + '. The fight goes on — end on a live beat.');
    lines.push(SETTLED);
    return lines.join(' ');
  }
  const fx = EXCHANGE_EFFECTS[res.tier] || {};
  const lines = [head + me + ' goes for it — ' + clause(adj.action) + ' — and ' + say(res.tier) + '.'];
  lines.push(...guardLines(adj, me, foe, res.tier));
  if (res.opening) lines.push(me + ' is pressing the opening the last exchange left.');
  if (!res.outcome && fx.injureOpp) lines.push(foe + ' takes a real, lasting wound from it — name it in the telling; it weakens them from here on.');
  if (!res.outcome && fx.injureSelf && !(adj.playerGuard && !adj.counterPath)) lines.push(me + ' takes a real, lasting wound from it — name it in the telling; it weakens them from here on.');
  if (!res.outcome && res.tier === 'SETBACK' && !duel.over) lines.push(me + ' loses this exchange but sees a real opening to use next — show it.');
  if (res.outcome) {
    lines.push('Nothing is being tallied in this fight — each exchange stands on its own, and a hurt lasts only as long as the story carries it. The fight goes on until the story itself ends it: when everything so far makes a yield, a flight, an interruption or a finish the honest next beat, write that ending yourself — nobody is calling a winner.');
  } else if (duel.over) {
    if (duel.victor === 'draw') {
      lines.push('They take each other down in the same exchange — ' + me + ' and ' + foe + ' are both down. Tell the double finish the story has earned; neither wins, neither can rally, and it stands.');
    } else {
      const winner = duel.victor === 'player' ? duel.player : duel.opp;
      const loser = duel.victor === 'player' ? duel.opp : duel.player;
      lines.push(loser.name + ' is beaten — ' + winner.name + ' takes the fight. Tell the ending the story has earned (a yield, a knockout, a disarm, a retreat or a kill, whatever fits), and it stands; ' + loser.name + ' can’t rally.');
    }
  } else {
    lines.push(sideStatus(duel.player) + '; ' + sideStatus(duel.opp) + '. The fight goes on — end on a live beat, not a resolution.');
  }
  lines.push(secretLine(me, true));
  lines.push(SETTLED);
  return lines.join(' ');
}

export function buildDuelSequenceDirective(state, adj, res) {
  const duel = state.duel;
  const me = duel.player.name;
  const foe = duel.opp.name;
  const chain = res.steps.map((st, i) => (i === 0 ? 'first ' : i === res.steps.length - 1 ? 'and last ' : 'then ') + clause(st.strike) + ' — ' + (SAY_SHORT[st.tier] || SAY_SHORT.FAILURE)).join('; ');
  const lines = ['About the fight between ' + me + ' and ' + foe + ': ' + me + ' commits to a chain of strikes, and each goes exactly so, in order: ' + chain + '. Taken together, ' + say(res.overall) + '.'];
  lines.push(...guardLines(adj, me, foe, res.overall));
  if (!res.outcome && !duel.over) lines.push(sideStatus(duel.opp) + '; ' + sideStatus(duel.player) + '.');
  if (res.outcome) {
    lines.push('Nothing is being tallied in this fight — each exchange stands on its own. The fight goes on until the story itself ends it; when everything so far makes a yield, a flight, an interruption or a finish the honest next beat, write that ending yourself — nobody is calling a winner.');
  } else if (duel.over) {
    if (res.victor === 'draw') lines.push('The chain ends with both of them down — ' + me + ' and ' + foe + ' take each other out in the same flurry. Tell the double finish the story has earned; neither wins, and it stands.');
    else lines.push(res.victor === 'player'
      ? foe + ' is beaten — tell the finish the story has earned, and it stands.'
      : me + ' is beaten — tell how ' + foe + ' turns the failed chain into the finish, and it stands.');
  } else {
    lines.push('The fight goes on — end on a live beat, not a resolution.');
  }
  lines.push('A strike that misses or goes wrong really did — show ' + foe + ' reading it, slipping it or making ' + me + ' pay; never let a failed strike quietly land.');
  lines.push(secretLine(me, false));
  lines.push(SETTLED);
  return lines.join(' ');
}

/* A fight joined on a declaration or a squaring-up: the standoff binds, and nothing is decided. */
export function buildArmedDirective(state, adj) {
  const duel = state.duel;
  const who = duel ? duel.player.name + ' and ' + duel.opp.name : 'the two sides';
  const kind = duel ? 'fight' : (state.battle && state.battle.kind === 'war' ? 'war' : 'battle');
  return [
    'About ' + who + ': the ' + kind + ' is joined, but they’re only squaring up so far — ' + clause(adj.action || 'the squaring-up') + '. No blow has landed and nothing is decided yet.',
    'Tell the standoff, the words and the readying exactly as written — a declaration, a taunt or drawn steel is not an attack, and neither side gains or loses anything yet. The first real attempt is where it begins; end on the brink, not past it.',
    'Keep all of this between us.',
  ].join(' ');
}

export function buildBattleDirective(state, adj, out) {
  const b = state.battle;
  const mc = playerUnit(b);
  const lines = [];
  if (out.mcRes) {
    if (out.mcRes.command) {
      lines.push('About the battle: ' + mc.name + ' gives the order — ' + clause(adj.action) + ' — and ' + say(out.mcRes.tier) + '. Let it show in how the whole side fights now.');
    } else {
      lines.push('About the battle: ' + mc.name + ' goes for it — ' + clause(adj.action) + ' — and ' + say(out.mcRes.tier) + '.');
      lines.push(...guardLines(adj, mc.name, 'the enemy', out.mcRes.tier));
    }
    const fx = out.outcome ? {} : (EXCHANGE_EFFECTS[out.mcRes.tier] || {});
    if (fx.injureOpp && !out.mcRes.command) lines.push('Whoever ' + mc.name + ' faced takes a real, lasting wound — name it.');
    if (fx.injureSelf && !(adj.playerGuard && !adj.counterPath)) lines.push(mc.name + ' takes a real, lasting wound — name it; it weakens them from here on.');
  } else {
    lines.push('About the battle: ' + clause(adj.action) + '.');
  }
  const rep = out.reports.slice(0, 4);
  if (rep.length) lines.push('Elsewhere on the field, and true: ' + rep.join(' '));
  if (out.reports.length > 4) lines.push('The rest of the clashes hold without a decision.');
  if (out.outcome) {
    lines.push('Only ' + mc.name + '’s own part was settled. Who falls, who holds and how the nerve of each side sways follows the story, and the battle goes on until the story ends it — write the rout, the stand-down or the escape yourself when it’s earned; nobody is calling the field.');
  } else if (b.over) {
    if (b.mcDown) lines.push(mc.name + ' is taken out of the fight — tell it (downed, disarmed or dragged clear, whatever fits) — and then the field resolves: ' + (b.victor === 'allies' ? 'their side still wins the day.' : 'their side is beaten.'));
    else lines.push('It’s decisive: ' + (b.victor === 'allies' ? mc.name + '’s side has won' : 'the enemy has won') + '. Tell the ending the story has earned — a rout, a surrender, a retreat, a capture or worse — and it stands.');
  } else {
    lines.push(mc.name + '’s side is ' + moraleWord(moraleOf(b.allies)) + '; the enemy is ' + moraleWord(moraleOf(b.enemies)) + '. The battle goes on — end on a live beat, not a resolution.');
  }
  lines.push(SETTLED);
  return lines.join(' ');
}

export function buildWarDirective(state, adj, out) {
  const b = state.battle;
  const mc = playerUnit(b);
  const lines = ['About the war: ' + mc.name + ' orders it — ' + clause(adj.action) + '.'];
  if (out.focalRes) {
    if (out.focalRes.stratagem) {
      if (out.condNote && out.condNote.favors === 'allies') lines.push('The stratagem takes hold, and the field now favours ' + mc.name + '’s side' + (out.condNote.mod > 1 ? ' strongly' : '') + ' — show it reshaping the fight.');
      else if (out.condNote && out.condNote.favors === 'enemies') lines.push('The stratagem backfires — the wind turns, the ruse is seen through, the ground betrays them — and now it works against ' + mc.name + '’s side. Show the reversal.');
      else lines.push('The stratagem: ' + say(out.focalRes.tier) + '.');
    } else if (out.focalRes.personal) {
      const foe = out.target ? out.target.name : 'the enemy';
      lines.push(mc.name + ' takes the field in person against ' + foe + ', and ' + say(out.focalRes.tier) + '.');
      lines.push(...guardLines(adj, mc.name, foe, out.focalRes.tier));
    } else {
      lines.push((out.acting ? out.acting.name : 'The ordered formation') + ' carries it out against ' + (out.target ? out.target.name : 'the enemy') + ', and ' + say(out.focalRes.tier) + '.');
      if (out.target && !out.target.standing) lines.push(out.target.name + ' is broken and routs from the field.');
      if (out.acting && !out.acting.standing) lines.push(out.acting.name + ' is broken in the attempt.');
    }
  }
  const rep = out.reports.slice(0, 3);
  if (rep.length) lines.push('Along the rest of the line, and true: ' + rep.join(' '));
  if (b.conditions && b.conditions.length) {
    lines.push('Still shaping the field: ' + b.conditions.map((c) => clause(c.name) + ' (in ' + (c.favors === 'allies' ? mc.name + '’s favour' : 'the enemy’s favour') + ')').join('; ') + '.');
  }
  if (out.outcome) {
    lines.push('Only this order was settled. The losses, the tide of the line and the end of the day follow the story — the engagement goes on until the story ends it; nobody is calling the field.');
  } else if (b.over) {
    if (b.mcDown) lines.push(mc.name + ' falls in the fighting — tell it (struck down, disabled, dragged from the field, whatever fits) — and command collapses: the enemy takes the day.');
    else lines.push('It’s decisive: ' + (b.victor === 'allies' ? 'the enemy line shatters and ' + mc.name + '’s side takes the field' : 'the allied line breaks and the enemy takes the field') + '. Tell the rout, the surrender or the withdrawal the story has earned, and it stands.');
  } else {
    lines.push('A formation that falls is broken or routed, not wiped out, unless the story demands worse. The engagement goes on — end on a live beat, not a resolution.');
  }
  lines.push('It’s settled — tell it at the scale of the field, in the story’s own voice, and keep all of this between us.');
  return lines.join(' ');
}

/* the fight let go by the story itself, and a beat inside a fight that risks nothing */
export function buildFightOverDirective(action) {
  return 'About the fight: it’s over — ' + clause(action) + '. Tell the winding-down the story has earned, honestly, from everything that came before; nothing further is decided. Keep all of this between us.';
}
export function buildLullDirective(state, action) {
  const who = state && state.duel ? state.duel.player.name + ' and ' + state.duel.opp.name : 'the two sides';
  return 'About the fight between ' + who + ': this moment risks nothing in it — ' + clause(action) + '. Tell it exactly as written, but the fight itself isn’t decided now: nobody lands, yields or falls unless the words already did it. End on the live tension.'
    + ' Keep all of this between us.';
}

/* ------------------------------------------------------------------ */
/* Teardown                                                            */
/* ------------------------------------------------------------------ */

/* Close a fight: estimated foes keep their baselines, and the state lets
 * the fight go. Returns the names of the fighters carrying lasting
 * injuries, so the caller can write them into the body ledger (M4). */
export function teardownFight(state) {
  const hurt = [];
  if (state.duel) {
    for (const side of [state.duel.player, state.duel.opp]) {
      if (side && side.injuries > 0 && side.name) hurt.push({ name: side.name, injuries: side.injuries, foe: side === state.duel.player ? state.duel.opp.name : state.duel.player.name });
    }
  }
  if (state.battle) {
    for (const u of [...(state.battle.allies || []), ...(state.battle.enemies || [])]) {
      if (u && u.injuries > 0 && u.name && !u.name.match(/\s\d+$/)) hurt.push({ name: u.name, injuries: u.injuries, foe: 'the battle' });
    }
  }
  persistFightEstimates(state);
  state.duel = null;
  state.battle = null;
  return hurt;
}

/* One plain line about the fight that stands, for the state-of-things and
 * the drawer. '' when no fight is on. */
export function renderFightLine(state) {
  if (!state || typeof state !== 'object') return '';
  if (state.duel && state.duel.active) {
    const d = state.duel;
    const head = 'A duel is joined: ' + d.player.name + ' vs ' + d.opp.name
      + (d.round > 0 ? ' — round ' + d.round : ' — squared up, nothing rolled yet');
    if (d.over) {
      const end = d.victor === 'draw' ? 'both down'
        : d.victor === 'player' ? d.opp.name + ' beaten' : d.player.name + ' beaten';
      return head + '; it has ended — ' + end + '.';
    }
    return head + ' (' + poiseWord(Math.max(0, d.player.poise), d.player.maxPoise)
      + ' against ' + poiseWord(Math.max(0, d.opp.poise), d.opp.maxPoise) + ').';
  }
  if (state.battle && state.battle.active) {
    const b = state.battle;
    const kind = b.kind === 'war' ? 'A war is joined' : 'A battle is joined';
    const line = kind + ': ' + standing(b.allies).length + '/' + b.allies.length
      + ' against ' + standing(b.enemies).length + '/' + b.enemies.length
      + (b.round > 0 ? ' — round ' + b.round : ' — squared up, nothing rolled yet');
    if (b.over) return line + '; it has ended — ' + (b.victor === 'allies' ? 'the field is theirs' : 'the field is lost') + '.';
    return line + ' (allies ' + moraleWord(moraleOf(b.allies)) + ', enemies ' + moraleWord(moraleOf(b.enemies)) + ').';
  }
  return '';
}
