/* Cozy Tavern — engine/referee-math.js (M11)
 * The referee's mathematics — a faithful port of Arbiter's engine semantics
 * (SillyTavern-Arbiter-Fight-and-Battle), with all of its SillyTavern glue
 * left behind. PURE functions: no store, no DOM, no fetch. Everything here
 * is code — the model never rolls and never decides an outcome.
 *
 *   probFromDelta(delta)      logistic curve 1/(1+10^(-delta/4)), the edge
 *                             delta is clamped to ±13 by callers
 *   sliceOutcome(P, u, mods)  mirrored 6-tier slicing of [0,1): DECISIVE /
 *                             SUCCESS / SUCCESS_COST / SETBACK / FAILURE /
 *                             DISASTER — provably identical under
 *                             (u,P) -> (1-u, 1-P) (mirror fairness)
 *   tieCheck(tier, P, u, band) |u-P| <= band (0.06) remaps a marginal
 *                             exchange to TRADE / STALEMATE — never the
 *                             extremes, and callers apply it only to
 *                             exchanges, never to lone checks
 *   rngFloat()                one uniform [0,1) from real (crypto) RNG
 *   TIER_RATINGS              task tiers (trivial 1 … extreme 9), opponent
 *                             tiers (mook 2 / trained 4 / elite 6 /
 *                             formidable 8), guide vocabulary (… apex 10),
 *                             and relative tiers resolved against the actor
 *   PRESETS                   gritty / realistic / heroic
 *   EXCHANGE_EFFECTS          margin-scaled poise damage, momentum ±0.5
 *                             (cap 1), symmetric openings
 *   RECOVER_EFFECTS           tier-scaled recovery amounts
 *   composurePenaltyOf        0 above half the pool, down to -3 at empty
 */

export function clamp(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/* Logistic (Elo-style) probability of success for an edge delta. */
export function probFromDelta(delta) {
  return 1 / (1 + Math.pow(10, -delta / 4));
}

/* Slice the [0,1) interval into outcome tiers around the success threshold
 * P. Slice widths depend on P so that experts win clean and rarely botch,
 * underdogs who win mostly win narrow and costly, and failures near the
 * threshold become fail-forward setbacks. u near 0 = best, u near 1 = worst.
 *
 * MIRROR SYMMETRY (ported law): each band pair uses ONE formula applied to
 * the acting side's P and the opposing side's F=1-P, so the distribution is
 * provably identical under (u,P) -> (1-u, 1-P): two evenly matched fighters
 * are a coin flip at ANY fight length. The constants are the midpoints of
 * Arbiter's old asymmetric pairs, which preserves each pair's even-odds mass
 * exactly (0.1075 extremes, 0.3625 middles) — the shape is unchanged, only
 * the tilt is gone. */
export function sliceOutcome(P, u, mods) {
  const m = mods || { dec: 1, cost: 1, sb: 1, dis: 1 };
  const F = 1 - P;
  const XA = 0.04, XB = 0.135;   // extremes: DECISIVE / DISASTER
  const MA = 0.225, MB = 0.275;  // middles:  SUCCESS_COST / SETBACK
  let decisiveW = P * (XA + XB * P) * m.dec;             // deepest success
  let costW = P * (MA + MB * F) * m.cost;                // scraped-by success
  let setbackW = F * (MA + MB * P) * m.sb;               // fail-forward (mirror of cost)
  let disasterW = F * (XA + XB * F) * m.dis;             // far tail (mirror of decisive)
  /* Safety rails, mirrored: a middle band can never eat its extreme's slice. */
  costW = Math.min(costW, Math.max(0, P - decisiveW));
  setbackW = Math.min(setbackW, Math.max(0, F - disasterW));

  if (u < P) {
    if (u < decisiveW) return 'DECISIVE';
    if (u >= P - costW) return 'SUCCESS_COST';
    return 'SUCCESS';
  }
  if (u < P + setbackW) return 'SETBACK';
  if (u >= 1 - disasterW) return 'DISASTER';
  return 'FAILURE';
}

/* Exchange tie detection. When an exchange lands genuinely even (the roll u
 * sits within `band` of the win/lose boundary P), remap the directional tier
 * to a tie: a very-near miss becomes a TRADE (both land, both bleed), a
 * deeper-but-still-near one a STALEMATE (both whiff, tense reset). band=0
 * disables ties. Only ever applied to fighting exchanges — never lone
 * checks. Decisive/disaster extremes never tie. */
export const TIE_BAND = 0.06;

export function tieCheck(tier, P, u, band) {
  if (!band || band <= 0) return tier;
  if (tier === 'DECISIVE' || tier === 'DISASTER') return tier; // clear extremes stand
  if (Math.abs(u - P) > band) return tier;                     // not close enough
  const veryClose = Math.abs(u - P) <= band * 0.5;
  return veryClose ? 'TRADE' : 'STALEMATE';
}

/* One uniform sample from real (crypto) RNG, [0,1). */
export function rngFloat() {
  try {
    const a = new Uint32Array(1);
    (globalThis.crypto || window.crypto).getRandomValues(a);
    return a[0] / 4294967296;
  } catch (err) {
    return Math.random();
  }
}

/* The tiers and what they mean for the telling. `text` is the binding
 * instruction the directive hands the storyteller. */
export const TIERS = {
  DECISIVE: {
    name: 'DECISIVE SUCCESS',
    text: 'It succeeds decisively and cleanly — better than intended.',
  },
  SUCCESS: {
    name: 'SUCCESS',
    text: 'It succeeds as intended.',
  },
  SUCCESS_COST: {
    name: 'SUCCESS WITH COST',
    text: 'It works, but with a proportionate price — a small tax on the win, never a reversal of it: a ceded position, a strained or half-spent resource, lost tempo, minor harm, or a sliver of unwanted notice. Keep it contained. A price at this level never undoes what the player deliberately achieved — don\'t blow a secret, cover, or concealment they took pains to protect; at most a faint, deniable flicker of suspicion they can still manage. Fully exposing a guarded secret is a setback-or-worse beat, earned by a bad result, not invented off a success.',
  },
  SETBACK: {
    name: 'SETBACK',
    text: 'It fails, but fail forward: the failed attempt yields an opening, information, or partial progress — never a free win.',
  },
  FAILURE: {
    name: 'FAILURE',
    text: 'It fails. Let consequences follow naturally.',
  },
  DISASTER: {
    name: 'DISASTER',
    text: 'It fails badly. Escalate with a serious consequence beyond the immediate attempt.',
  },
  TRADE: {
    name: 'TRADE',
    text: 'Both land — an even, clashing exchange where each fighter takes a hit. Neither gains the upper hand; show the mutual toll.',
  },
  STALEMATE: {
    name: 'STALEMATE',
    text: 'Neither lands cleanly — the exchange is read and countered, a tense reset with no clear advantage. Show the deadlock, not a winner.',
  },
};

/* One-line plain meaning per verdict, for the ledger line and the drawer —
 * so a bare tier name is never a mystery. */
export const TIER_MEANING = {
  DECISIVE: 'clean success — better than intended',
  SUCCESS: 'succeeds as intended',
  SUCCESS_COST: 'succeeds, but with a proportionate cost',
  TRADE: 'both land real hits — mutual damage',
  STALEMATE: 'neither side gains — the exchange resolves nothing',
  SETBACK: 'fails, but forward — the loss opens a real next move',
  FAILURE: 'fails as attempted',
  DISASTER: 'fails badly — it backfires',
  ARMED: 'fight joined — nothing rolled yet',
};

/* Difficulty / opposition tiers (unopposed tasks + unnamed foes), plus the
 * rating-guide vocabulary the prompts teach, plus relative tiers resolved
 * against the actor's own rating ('A' = the actor's rating). */
export const TIER_RATINGS = {
  trivial: 1, easy: 3, moderate: 5, hard: 7, extreme: 9,
  mook: 2, trained: 4, elite: 6, formidable: 8,
  untrained: 2, competent: 5, veteran: 6, master: 8, legendary: 9, apex: 10,
  inferior: 'A-2', peer: 'A', superior: 'A+2',
};

/* Difficulty presets: a flat player edge plus tier-width modifiers. */
export const PRESETS = {
  gritty: { bonus: 0, mods: { dec: 0.8, cost: 1.3, sb: 1.0, dis: 1.5 } },
  realistic: { bonus: 0, mods: { dec: 1, cost: 1, sb: 1, dis: 1 } },
  heroic: { bonus: 1, mods: { dec: 1.25, cost: 1.0, sb: 1.0, dis: 0.5 } },
};

export function presetFor(name) {
  return PRESETS[name] || PRESETS.realistic;
}

/* Duel exchange effects, from the PLAYER's roll perspective. opp/self =
 * poise damage dealt; injuries are persistent -1 rating tags; SETBACK grants
 * the player a fail-forward "opening" (+1 next round), and SUCCESS_COST
 * grants the opponent the mirror of it. */
export const EXCHANGE_EFFECTS = {
  DECISIVE: { opp: 2, self: 0, injureOpp: true, winner: 'self' },
  SUCCESS: { opp: 1.5, self: 0, winner: 'self' },
  SUCCESS_COST: { opp: 1, self: 0.5, winner: 'self' },
  /* SETBACK is the exact mirror of SUCCESS_COST: the opponent won the
   * exchange but left themselves exposed doing it — precisely what "fail
   * FORWARD" means. Poise is footing, breath and control, not flesh, so a
   * failed lunge that forces an overextension legitimately costs the foe. */
  SETBACK: { opp: 0.5, self: 1, winner: 'opp', opening: true },
  FAILURE: { opp: 0, self: 1.5, winner: 'opp' },
  DISASTER: { opp: 0, self: 2, injureSelf: true, winner: 'opp' },
  TRADE: { opp: 1, self: 1, winner: 'none' },      // both land; both bleed
  STALEMATE: { opp: 0, self: 0, winner: 'none' },  // both whiff; tense reset
};

/* Pure: apply one exchange tier to (player, opponent) side states.
 * Side shape: {poise, injuries, momentum, opening}. Returns new sides plus
 * over/victor. Momentum: exchange winner +0.5 (cap 1), loser resets; a TRADE
 * bleeds both, a STALEMATE holds both.
 *
 * Margin scaling (ported law): a lopsided exchange lands HARDER, not just
 * more often — the bigger the winner's edge, the more poise their blow
 * strips, symmetric for both fighters. Close fights (|margin| ≤ 2) are
 * unchanged, so the even-odds attrition economy is preserved; the bonus is
 * capped so no single blow is unbounded. */
export function applyExchangeEffects(pl, op, tier, margin) {
  const fx = EXCHANGE_EFFECTS[tier] || EXCHANGE_EFFECTS.FAILURE;
  const p = { ...pl };
  const o = { ...op };
  const m = Number(margin) || 0;
  let selfDmg = fx.self;
  let oppDmg = fx.opp;
  if (fx.winner === 'self' && oppDmg > 0) oppDmg += clamp(m - 2, 0, 3);
  else if (fx.winner === 'opp' && selfDmg > 0) selfDmg += clamp(-m - 2, 0, 3);
  p.poise = Math.round((p.poise - selfDmg) * 2) / 2;
  o.poise = Math.round((o.poise - oppDmg) * 2) / 2;
  if (fx.injureOpp) o.injuries = (o.injuries || 0) + 1;
  if (fx.injureSelf) p.injuries = (p.injuries || 0) + 1;
  if (fx.winner === 'self') {
    p.momentum = Math.min(1, (p.momentum || 0) + 0.5);
    o.momentum = 0;
  } else if (fx.winner === 'opp') {
    o.momentum = Math.min(1, (o.momentum || 0) + 0.5);
    p.momentum = 0;
  } else if (fx.self > 0 || fx.opp > 0) {
    p.momentum = 0;
    o.momentum = 0;
  }
  p.opening = !!fx.opening; // player fail-forward (SETBACK): exploitable next round
  /* Symmetric fail-forward: on SUCCESS_COST the player wins but leaves
   * themselves exposed, so the opponent earns the same +1 opening. */
  if (tier === 'SUCCESS_COST') o.opening = true;
  else if (fx.winner === 'self') o.opening = false; // a clean win closes any prior opening
  let over = false;
  let victor = null;
  if (p.poise <= 0 || o.poise <= 0) {
    over = true;
    if (p.poise <= 0 && o.poise <= 0) victor = fx.winner === 'self' ? 'player' : (fx.winner === 'opp' ? 'opp' : 'draw');
    else victor = o.poise <= 0 ? 'player' : 'opp';
  }
  return { player: p, opp: o, over, victor };
}

/* Narration-safe condition word for a poise fraction — the duel speaks in
 * words, never numbers. */
export function poiseWord(cur, max) {
  const r = max > 0 ? cur / max : 0;
  if (r > 0.8) return 'fresh';
  if (r > 0.5) return 'pressed';
  if (r > 0.2) return 'staggered';
  if (r > 0) return 'breaking';
  return 'beaten';
}

/* Recovery amounts by tier (poise regained). Recovery can't backfire into
 * damage — the worst outcome is a small gain. Capped at maxPoise, and at
 * one pool's worth per fight, by the resolver (duels.js). */
export const RECOVER_EFFECTS = {
  DECISIVE: 2.5, SUCCESS: 2, SUCCESS_COST: 1.5, SETBACK: 1, FAILURE: 0.5, DISASTER: 0.5,
  TRADE: 1, STALEMATE: 1,
};

/* War stratagem outcomes ("burn the woods", "feign retreat"): the commander
 * roll's tier becomes a battlefield condition. Mirrored — a botched
 * stratagem hands the ENEMY the same kind of standing advantage a good one
 * hands you. */
export const STRATAGEM_EFFECTS = {
  DECISIVE: { condMod: 2, favors: 'allies' },
  SUCCESS: { condMod: 1, favors: 'allies' },
  SUCCESS_COST: { condMod: 1, favors: 'allies', selfCost: 0.5 },
  SETBACK: { condMod: 1, favors: 'enemies', opening: true },
  FAILURE: { condMod: 1, favors: 'enemies', enemyMomentum: true },
  DISASTER: { condMod: 2, favors: 'enemies' },
};

/* The composure penalty schedule: nothing while the pool is at half or
 * better, then a slope to -3 as it empties. */
export function composurePenaltyOf(cur, max) {
  if (typeof cur !== 'number' || typeof max !== 'number' || max <= 0) return 0;
  const half = max / 2;
  if (cur >= half) return 0;
  const frac = (half - cur) / half;
  return -Math.round(frac * 3);
}
