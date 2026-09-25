/* Cozy Tavern — engine/bodies.js
 * The body ledger. Who is hurt, how badly, since when, and whether anyone
 * has seen to it. Injuries persist until they heal on the story clock;
 * strain is the lesser weariness — the long climb, the sleepless night —
 * noted while it's fresh.
 *
 * Contract (SPEC.md M4):
 *   state.bodies = { [name]: { injuries:[{what, sev:1|2|3, atMinutes,
 *                                          treated:boolean, healed:boolean}],
 *                              strain:[{what, atMinutes}] } }
 *   addInjury(bodies, name, {what, sev, treated}, clockMinutes) -> fresh copy
 *   addStrain(bodies, name, {what}, clockMinutes)               -> fresh copy
 *   healInjury(bodies, name, what)   // marks healed (kept in record,
 *                                    // rendered gone)
 *   renderBodies(bodies, clockMinutes)  // "Mara — left forearm fractured
 *                                       //  (a real wound, 2h, untreated)"
 *
 * Age renders from the story clock when set (clockMinutes − atMinutes); when
 * no clock is set, entries fall back to the turn count — each entry also
 * carries atTurn (the log's length when it was written; an additive field,
 * like M3's undo payload) and renderBodies takes an optional third argument.
 * Healed entries stop rendering but stay in the data — scars of record.
 *
 * Pure functions, like the clock: fresh copies out, never a mutation in
 * place. apply.js is the only caller that turns these into logged, undoable
 * mutations.
 */

/* Severity speaks in three plain words (SPEC.md M4). */
export const SEV_WORDS = {
  1: 'a graze/bruise-class',
  2: 'a real wound',
  3: 'severe',
};

const MAX_STRAIN_KEPT = 12;

/* ---------- small helpers ---------- */

function cleanText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function clampSev(sev) {
  const n = Number(sev);
  if (!Number.isFinite(n)) return 1; // unspecified harm is small until shown worse
  return Math.min(3, Math.max(1, Math.round(n)));
}

function minutesOrNull(clockMinutes) {
  if (clockMinutes === null || clockMinutes === undefined) return null;
  const n = Number(clockMinutes);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function copyBodies(bodies) {
  const safe = bodies && typeof bodies === 'object' ? bodies : {};
  const out = {};
  for (const [name, body] of Object.entries(safe)) {
    if (!body || typeof body !== 'object') continue;
    out[name] = {
      ...body,
      injuries: Array.isArray(body.injuries) ? body.injuries.map((i) => ({ ...i })) : [],
      strain: Array.isArray(body.strain) ? body.strain.map((s) => ({ ...s })) : [],
    };
  }
  return out;
}

/* The key a name lives under — case-insensitive matching; the casing
 * already written in the ledger wins (the M3 name rule). */
export function findBodyKey(bodies, name) {
  const wanted = cleanText(name).toLowerCase();
  if (!wanted || !bodies || typeof bodies !== 'object') return null;
  return Object.keys(bodies).find((k) => k.trim().toLowerCase() === wanted) || null;
}

function findBody(bodies, name) {
  const key = findBodyKey(bodies, name);
  return key ? bodies[key] : null;
}

/* Find an unhealed injury answering to `what` — exact words first, then a
 * looser "the words are in there" match, so "forearm" finds "left forearm
 * fractured". Returns the injury object or null. */
export function findInjury(body, what) {
  if (!body || !Array.isArray(body.injuries)) return null;
  const wanted = cleanText(what).toLowerCase();
  if (!wanted) return null;
  const unhealed = body.injuries.filter((i) => i && !i.healed);
  return (
    unhealed.find((i) => cleanText(i.what).toLowerCase() === wanted) ||
    unhealed.find((i) => {
      const have = cleanText(i.what).toLowerCase();
      return have.includes(wanted) || wanted.includes(have);
    }) ||
    null
  );
}

/* ---------- the contract ---------- */

/* M484: ONE WOUND PER PLACE. The page reader wrote a wound on every page that showed it — "left shoulder run through",
 * "left shoulder wound torn wider", "left shoulder wound torn wider by the shock" — and the referee's math counted every
 * line: six wounds on one man, six points off his rating, and the briefing read like a butcher's list. A new wound on
 * a body part that already carries an unhealed one is that wound GONE WORSE: the newer words (they say what it is
 * now), the higher severity, the first hour it was taken, treated only if the new line says so. A wound with no
 * body part named ("a graze"), or on another part, is its own. */
const BODY_PARTS = ['forehead', 'temple', 'skull', 'head', 'face', 'cheekbone', 'cheek', 'jaw', 'chin', 'nose', 'eye', 'ear', 'lip', 'mouth', 'teeth', 'neck', 'throat', 'collarbone', 'shoulder', 'upper arm', 'forearm', 'elbow', 'wrist', 'hand', 'palm', 'knuckle', 'finger', 'thumb', 'chest', 'breast', 'rib', 'sternum', 'back', 'spine', 'flank', 'side', 'stomach', 'belly', 'abdomen', 'gut', 'kidney', 'liver', 'lung', 'hip', 'pelvis', 'groin', 'thigh', 'knee', 'shin', 'calf', 'ankle', 'foot', 'heel', 'toe', 'arm', 'leg', 'torso', 'scalp', 'brow'];
export function bodyPartOf(what) {
  const w = String(what || '').toLowerCase();
  const side = /\b(left|right)\b/.exec(w);
  /* the part the words LEAD with ("kidney struck twice through the back" is a kidney wound) */
  let part = ''; let at = Infinity;
  for (const p of BODY_PARTS) { const m = new RegExp('\\b' + p + 's?\\b').exec(w); if (m && m.index < at) { at = m.index; part = p; } }
  if (!part) return '';
  return (side && side.index < at + 24 ? side[1] + ' ' : '') + part;
}
export function addInjury(bodies, name, { what, sev, treated } = {}, clockMinutes, atTurn) {
  const next = copyBodies(bodies);
  const who = cleanText(name);
  if (!who) return next;
  const key = findBodyKey(next, who) || who;
  if (!next[key]) next[key] = { injuries: [], strain: [] };
  const words = cleanText(what);
  const part = bodyPartOf(words);
  if (part) {
    const same = next[key].injuries.find((i) => i && !i.healed && bodyPartOf(i.what) === part);
    if (same) {
      same.what = words || same.what;
      same.sev = Math.max(clampSev(same.sev), clampSev(sev));
      same.treated = Boolean(treated);
      same.worsenedAtTurn = Number.isFinite(atTurn) ? atTurn : same.worsenedAtTurn;
      return next;
    }
  }
  next[key].injuries.push({
    what: words,
    sev: clampSev(sev),
    atMinutes: minutesOrNull(clockMinutes),
    atTurn: Number.isFinite(atTurn) ? atTurn : null,
    treated: Boolean(treated),
    healed: false,
  });
  return next;
}

/* M485: THE WOUNDS ALREADY WRITTEN, FOLDED ON LOAD — the same law as addInjury's (M484), for a ledger that gathered
 * six lines for three wounds before it: the oldest unhealed line of a body part keeps its hour and takes the newest
 * words and the highest severity; the others go. Healed lines are history and stay as they are. */
export function dedupeInjuries(bodies) {
  const next = copyBodies(bodies);
  for (const body of Object.values(next)) {
    if (!body || !Array.isArray(body.injuries)) continue;
    const kept = [];
    const byPart = new Map();
    for (const inj of body.injuries) {
      if (!inj || inj.healed) { kept.push(inj); continue; }
      const part = bodyPartOf(inj.what);
      if (!part) { kept.push(inj); continue; }
      const first = byPart.get(part);
      if (!first) { byPart.set(part, inj); kept.push(inj); continue; }
      first.what = inj.what || first.what;
      first.sev = Math.max(clampSev(first.sev), clampSev(inj.sev));
      first.treated = Boolean(inj.treated);
      if (Number.isFinite(inj.atTurn)) first.worsenedAtTurn = inj.atTurn;
    }
    body.injuries = kept;
  }
  return next;
}

export function addStrain(bodies, name, { what } = {}, clockMinutes, atTurn) {
  const next = copyBodies(bodies);
  const who = cleanText(name);
  if (!who) return next;
  /* M162: THE CASING ALREADY WRITTEN WINS — for strain too. addInjury looked
   * the key up case-insensitively and addStrain did not, so a ledger holding
   * "Mara" from a wound and handed "mara" for a strain grew a SECOND body,
   * and the same person stood twice in the drawer and in the state of things
   * — one of them invisible to findBodyKey, findInjury and body.heal. Today
   * apply.js resolves the key before it calls in, so the room was spared;
   * the function was still lying about its own law. */
  const key = findBodyKey(next, who) || who;
  if (!next[key]) next[key] = { injuries: [], strain: [] };
  next[key].strain.push({
    what: cleanText(what),
    atMinutes: minutesOrNull(clockMinutes),
    atTurn: Number.isFinite(atTurn) ? atTurn : null,
  });
  if (next[key].strain.length > MAX_STRAIN_KEPT) {
    next[key].strain = next[key].strain.slice(next[key].strain.length - MAX_STRAIN_KEPT);
  }
  return next;
}

/* Marks the injury healed — the record stays (scars of record), the render
 * lets it go. No match: the copy comes back unchanged, and the applier will
 * have rejected the proposal before ever calling this. */
export function healInjury(bodies, name, what) {
  const next = copyBodies(bodies);
  const body = findBody(next, name);
  const injury = findInjury(body, what);
  if (injury) injury.healed = true;
  return next;
}

/* ---------- rendering ---------- */

/* Age in compact words: 40m, 2h, 3d — or, when the clock was never set and
 * the entry only knows its turn, "3 turns on". '' when neither is known. */
function ageWords(entry, clockMinutes, turnCount) {
  const nowMin = minutesOrNull(clockMinutes);
  if (nowMin !== null && Number.isFinite(entry.atMinutes)) {
    const age = Math.max(0, nowMin - entry.atMinutes);
    if (age < 1) return 'just now';
    if (age < 60) return Math.round(age) + 'm';
    if (age < 60 * 24) {
      const h = Math.round(age / 60);
      return h + 'h';
    }
    return Math.round(age / (60 * 24)) + 'd';
  }
  if (Number.isFinite(turnCount) && Number.isFinite(entry.atTurn)) {
    const turns = Math.max(0, turnCount - entry.atTurn);
    if (turns === 0) return 'just now';
    return turns + (turns === 1 ? ' turn on' : ' turns on');
  }
  return '';
}

function injuryWords(injury, clockMinutes, turnCount) {
  const parts = [SEV_WORDS[injury.sev] || SEV_WORDS[1]];
  const age = ageWords(injury, clockMinutes, turnCount);
  if (age) parts.push(age);
  parts.push(injury.treated ? 'treated' : 'untreated');
  return injury.what + ' (' + parts.join(', ') + ')';
}

/* One line per character who carries anything unhealed — injuries when there
 * are any, else the strain that still shows. Most recent first. '' when no
 * one carries anything. The clock minutes (or, without a clock, the turn
 * count) give the ages; either may be left out. */
export function renderBodies(bodies, clockMinutes, turnCount) {
  const safe = bodies && typeof bodies === 'object' ? bodies : {};
  const rows = [];
  for (const [name, body] of Object.entries(safe)) {
    if (!body || typeof body !== 'object') continue;
    const injuries = (Array.isArray(body.injuries) ? body.injuries : [])
      .filter((i) => i && !i.healed && cleanText(i.what));
    const strain = (Array.isArray(body.strain) ? body.strain : [])
      .filter((s) => s && cleanText(s.what));
    let line = '';
    let recency = -Infinity;
    if (injuries.length) {
      line = name + ' — ' + injuries.map((i) => injuryWords(i, clockMinutes, turnCount)).join('; ');
      recency = Math.max(...injuries.map((i) => recencyKey(i)));
    } else if (strain.length) {
      const recent = strain.slice(-3);
      line = name + ' — worn: ' + recent
        .map((s) => {
          const age = ageWords(s, clockMinutes, turnCount);
          return age ? s.what + ' (' + age + ')' : s.what;
        })
        .join('; ');
      recency = Math.max(...strain.map((s) => recencyKey(s)));
    }
    if (line) rows.push({ line, recency });
  }
  rows.sort((a, b) => b.recency - a.recency);
  return rows.map((r) => r.line).join('\n');
}

/* Recency for sorting: clock minutes when known, else the turn it was
 * written. Entries with neither sink to the bottom. */
function recencyKey(entry) {
  if (Number.isFinite(entry.atMinutes)) return entry.atMinutes;
  if (Number.isFinite(entry.atTurn)) return entry.atTurn;
  return -Infinity;
}
