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

export function addInjury(bodies, name, { what, sev, treated } = {}, clockMinutes, atTurn) {
  const next = copyBodies(bodies);
  const who = cleanText(name);
  if (!who) return next;
  const key = findBodyKey(next, who) || who;
  if (!next[key]) next[key] = { injuries: [], strain: [] };
  next[key].injuries.push({
    what: cleanText(what),
    sev: clampSev(sev),
    atMinutes: minutesOrNull(clockMinutes),
    atTurn: Number.isFinite(atTurn) ? atTurn : null,
    treated: Boolean(treated),
    healed: false,
  });
  return next;
}

export function addStrain(bodies, name, { what } = {}, clockMinutes, atTurn) {
  const next = copyBodies(bodies);
  const who = cleanText(name);
  if (!who) return next;
  if (!next[who]) next[who] = { injuries: [], strain: [] };
  next[who].strain.push({
    what: cleanText(what),
    atMinutes: minutesOrNull(clockMinutes),
    atTurn: Number.isFinite(atTurn) ? atTurn : null,
  });
  if (next[who].strain.length > MAX_STRAIN_KEPT) {
    next[who].strain = next[who].strain.slice(next[who].strain.length - MAX_STRAIN_KEPT);
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
