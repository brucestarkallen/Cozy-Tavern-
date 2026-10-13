/* Cozy Tavern — engine/offscreen.js
 * The off-screen world. Where the named souls who have stepped out of the
 * scene have gone, what they're doing there, and what they're meaning to do
 * next — so the world keeps breathing while the page looks elsewhere.
 *
 * Contract (SPEC.md M4):
 *   state.offscreen = { [name]: {location, activity, agenda?, sinceMinutes} }
 *   seat(offscreen, name, {location, activity, agenda}, clockMinutes) -> copy
 *   unseat(offscreen, name)                                          -> copy
 *   renderOffscreen(offscreen, present)  // top 6 by recency; skips anyone
 *                                        // present
 *
 * Two laws of the door:
 *   - presence.leave does NOT auto-seat — only an explicit offscreen.set
 *     (proposed by the extractor, or placed by hand) writes down where
 *     someone went. The prose has to say.
 *   - presence.enter auto-unseats: walk back into the scene and the
 *     elsewhere-note lets go of you (apply.js wires this, and its undo
 *     puts the seat back).
 *
 * Entries carry an additive atTurn (the log's length when seated, like M3's
 * undo payload) so "recency" stays true even when the story clock isn't set.
 * Pure functions: fresh copies out.
 *
 * M304: SOMEONE WHO LEAVES THE PAGE IS NEVER NOWHERE. Walking into the scene
 * lets a seat go, and walking out wrote nothing — so everyone the main
 * character had recently been WITH was the one group the world held no
 * whereabouts for, and "What's happening elsewhere" thinned to whoever a
 * worker had happened to seat that page. presence.leave (engine/apply.js) now
 * keeps the one thing the ledger knows for certain — where they were last
 * seen, and when — as a seat marked `lastSeen`. It invents nothing: it reads
 * "last seen at the Bluebird (as of 40 minutes ago)", and the world agent,
 * shown exactly those words, moves them on by the clock. A seat the prose or
 * the world agent writes replaces it whole.
 */

import { renderArrival, onTheWay } from './world.js'; /* M29: stance and arrival on the clock; M681: an approach that lapsed */
import { samePersonName, isHere, nameOnPage } from './names.js'; /* M396: one answer to "the same person?"; M752: and to "named here?" */

const RENDER_TOP = 6;

function cleanText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function copyOffscreen(offscreen) {
  const safe = offscreen && typeof offscreen === 'object' ? offscreen : {};
  const out = {};
  for (const [name, entry] of Object.entries(safe)) {
    if (!entry || typeof entry !== 'object') continue;
    out[name] = { ...entry };
  }
  return out;
}

/* ---------- the contract ---------- */

export function seat(offscreen, name, { location, activity, agenda, stance, etaMinutes, lastSeen } = {}, clockMinutes, atTurn) {
  const next = copyOffscreen(offscreen);
  const who = cleanText(name);
  if (!who) return next;
  const found = findSeat(next, who); // casing already written wins
  const entry = {
    location: cleanText(location),
    activity: cleanText(activity),
    sinceMinutes: Number.isFinite(clockMinutes) ? Math.round(clockMinutes) : null,
    atTurn: Number.isFinite(atTurn) ? atTurn : null,
    firstAtTurn: found?.entry?.firstAtTurn ?? found?.entry?.atTurn ?? (Number.isFinite(atTurn) ? atTurn : null),
  };
  const what = cleanText(agenda === undefined ? found?.entry?.agenda : agenda);
  if (what) entry.agenda = what;
  if (lastSeen === true) entry.lastSeen = true; /* M304: the house's own bookkeeping, not a worker's word */
  /* M29: a stance toward the main character, and an arrival on the clock.
   * etaMinutes is "from now"; with a clock set it becomes an absolute
   * arrivesAtMinutes (so the clock moving forward makes them nearer, never
   * the seat re-written); without one the relative figure is kept. */
  const st = cleanText(stance).toLowerCase();
  if (st) entry.stance = st;
  const eta = Number(etaMinutes);
  if (Number.isFinite(eta) && eta >= 0) {
    if (Number.isFinite(clockMinutes)) entry.arrivesAtMinutes = Math.round(clockMinutes + eta);
    else entry.etaMinutes = Math.round(eta);
  }
  next[found ? found.key : who] = entry;
  return next;
}

export function unseat(offscreen, name) {
  const next = copyOffscreen(offscreen);
  const wanted = cleanText(name).toLowerCase();
  const key = Object.keys(next).find((k) => k.trim().toLowerCase() === wanted);
  if (key) delete next[key];
  return next;
}

/* Find a seat by name, case-insensitive. Returns {key, entry} | null. */
/* M320: ONE PERSON, ONE NAME, IN EVERY BOOK. A seat was found by its EXACT name and written under whatever
 * name a worker used — while the people's pages have known since M238 that "Vanessa" IS "Vanessa Reynolds"
 * (findPersonKey: a first or last name, a name cut short, a slip of spelling — and only when exactly one
 * person answers). So the world agent seated "Rias" while her page stood as "Rias Gremory", and the two
 * never met: "What's happening elsewhere" said where she was this hour; her page in "The people" read
 * "Last seen 14 pages ago", her card told the storyteller nothing of her seat, and the world agent was
 * told she had NO SEAT and wrote another. The seat is found the way a page is. The resolver is handed in
 * by engine/people.js (which already reads this file — no circle of imports). */
let nearName = null;
export function setSeatResolver(fn) { nearName = typeof fn === 'function' ? fn : null; }
export function findSeat(offscreen, name) {
  const wanted = cleanText(name).toLowerCase();
  if (!wanted) return null;
  const safe = offscreen && typeof offscreen === 'object' ? offscreen : {};
  let key = Object.keys(safe).find((k) => k.trim().toLowerCase() === wanted);
  /* M396: the same person under another form of the name (folded letters, a first name, canon's other name) — only
   * when exactly one seat answers */
  if (!key) { const hits = Object.keys(safe).filter((k) => samePersonName(k, name)); if (hits.length === 1) key = hits[0]; }
  if (!key && nearName) { try { key = nearName(safe, cleanText(name)) || undefined; } catch (err) { key = undefined; } }
  return key ? { key, entry: safe[key] } : null;
}

/* Recency: the turn the seat was written is the truest ordering (the log
 * only ever grows); clock minutes stand in for older entries. */
function recencyKey(entry) {
  if (Number.isFinite(entry.atTurn)) return entry.atTurn;
  if (Number.isFinite(entry.sinceMinutes)) return entry.sinceMinutes;
  return -Infinity;
}

/* M300: A SEAT SAYS HOW OLD IT IS. A seat is written with the story clock
 * (sinceMinutes) and then stood as "now" for as long as nobody re-seated its
 * person — "the Bluebird, closing up" at two the next afternoon, read as the
 * present by the storyteller, the world agent and the drawer alike. Past
 * half an hour of story time the seat says when it was last reviewed. Age alone
 * never proves a departure; the world agent must decide whether to move them
 * or explicitly confirm that their activity still holds. */
export function seatAgeWords(entry, clockMinutes) {
  /* M752: a seat written before the story had a clock, then confirmed in story time, ages from that confirmation */
  if (!entry || !Number.isFinite(clockMinutes) || (!Number.isFinite(entry.sinceMinutes) && !Number.isFinite(entry.checkedMinutes))) return '';
  const checked = Number.isFinite(entry.checkedMinutes) ? Math.max(Number.isFinite(entry.sinceMinutes) ? entry.sinceMinutes : -Infinity, entry.checkedMinutes) : entry.sinceMinutes;
  const ago = Math.round(clockMinutes - checked);
  if (ago < 30) return '';
  const span = ago < 60 ? ago + ' minutes'
    : ago < 24 * 60 ? 'about ' + Math.round(ago / 60) + (Math.round(ago / 60) === 1 ? ' hour' : ' hours')
      : Math.round(ago / (24 * 60)) + (Math.round(ago / (24 * 60)) === 1 ? ' day' : ' days');
  /* M752: said as the age of what is known — "awaiting the world’s next review" (M684) named the house's own worker to the
   * storyteller and the drawer; the World is told whom to review in its own request (REVIEW REQUIRED NOW). Age alone still
   * proves no departure (M684): never "likely elsewhere by now". */
  return 'as of ' + span + ' ago in story time';
}

/* M304: one line for a seat, wherever it is read — the storyteller's state of
 * things, the world agent's list, the drawer. (The drawer had its own copy of
 * these words and never learned to say a seat's age.) */
export function seatLine(name, entry, clockMinutes) { return isDeadSeat(entry) ? 'Dead: ' + deadWords(name, entry) : seatWords(name, entry || {}, clockMinutes); } /* M680: a grave has no age and is going nowhere — never "likely elsewhere by now" */

/* where and what, as one reads it of a person: "the Bluebird, closing up",
 * or — for the house's own sighting — "last seen at the Bluebird"; then the
 * want, the approach and the age, each when asked for and when there is one. */
export function seatNowWords(entry, clockMinutes, { agenda = false, arrival = false } = {}) {
  const e = entry && typeof entry === 'object' ? entry : {};
  const where = cleanText(e.location);
  const what = cleanText(e.activity);
  let words = e.lastSeen === true
    ? 'last seen ' + (where ? 'at ' + where.replace(/^(at|in|on)\s+/i, '') : 'where the scene stood') + (what ? ', ' + what : '')
    : ([where, what].filter(Boolean).join(', ') || 'somewhere out of sight');
  /* M484: never "meaning to to". M645: nor "meaning to meaning to" — the page reader's own example writes the want as
   * "meaning to warn the abbot", and every seat a reader wrote that way was read to the storyteller doubled */
  if (agenda && cleanText(e.agenda)) words += ' (meaning to ' + cleanText(e.agenda).replace(/^(?:(?:(?:she|he|they)\s+)?(?:is|are|was|were)\s+)?(?:(?:meaning|means|meant|intending|intends|planning|plans|hoping|hopes|wanting|wants|going|trying|tries|waiting)\s+)?to\s+/i, '').replace(/\.+$/, '') + ')';
  if (arrival) { const approach = renderArrival(e, clockMinutes); if (approach) words += ' — ' + approach; }
  const age = seatAgeWords(e, clockMinutes);
  if (age) words += ' (' + age + ')';
  return words;
}

function seatWords(name, entry, clockMinutes) {
  return name + ' — ' + seatNowWords(entry, clockMinutes, { agenda: true, arrival: true });
}

/* The six most recently seated who are NOT in the scene right now.
 * `present` is state.present ([{name}] — plain strings tolerated). */
/* M484: THE DEAD ARE NOT ELSEWHERE. A seat the world agent wrote as "dead — his grave on the Kuchiki plot, gone" rode
 * the Elsewhere list like anyone's, with an arrival and "(as of 31 minutes ago)" — four graves a briefing, aged by
 * the clock. A seat whose words begin with dead, deceased, died, killed or KIA is a death: one line for all of them,
 * at the foot, where they lie, no age, no arrival — and the people list says "dead", not "away". */
export function isDeadSeat(entry) {
  const e = entry && typeof entry === 'object' ? entry : {};
  return /^\s*(?:dead|deceased|died|killed|kia|k\.i\.a\.|slain|perished)\b/i.test(cleanText(e.location)) || /^\s*(?:dead|deceased|died|killed|kia|slain|perished)\b/i.test(cleanText(e.activity));
}
function deadWords(name, entry) {
  const e = entry && typeof entry === 'object' ? entry : {};
  const rest = cleanText(e.location).replace(/^(?:dead|deceased|died|killed|kia|k\.i\.a\.|slain|perished)\b[\s—:,-]*/i, '').replace(/\bgone\b[.;,\s]*$/i, '').replace(/[;,\s]+$/, '');
  return name + (rest ? ' (' + rest + ')' : '');
}
export function renderOffscreen(offscreen, present, clockMinutes, top = RENDER_TOP, characters = {}) {
  const safe = offscreen && typeof offscreen === 'object' ? offscreen : {};
  return seatLines(awaySeats(safe, present, characters), clockMinutes, top).join('\n');
}
/* the seats of those not in the scene — under any form of their name (M396) */
function awaySeats(safe, present, characters) {
  return Object.entries(safe).filter(([name, entry]) => entry && typeof entry === 'object' && !isHere({ present, offscreen: safe, characters }, name));
}
function seatLines(pairs, clockMinutes, top = Infinity) {
  const rows = [];
  const dead = [];
  for (const [name, entry] of pairs) {
    if (isDeadSeat(entry)) { dead.push(deadWords(name, entry)); continue; } /* M484 */
    rows.push({ line: seatWords(name, entry, clockMinutes), recency: recencyKey(entry), rank: stanceRank(entry, clockMinutes) });
  }
  /* M86: the writer's ACW rotation, not recency alone — whoever is moving
   * toward the main character (nearest arrival first) outranks whoever is
   * searching, who outranks unresolved tension, then the busy, then the
   * waiting; recency breaks ties. The storyteller's six lines are the six
   * that can reach the scene, never the six most recently written. */
  rows.sort((a, b) => (a.rank - b.rank) || (b.recency - a.recency));
  const lines = rows.slice(0, top).map((r) => r.line);
  if (dead.length) lines.push('Dead: ' + dead.join('; ') + '.'); /* M484: one line, no clock */
  return lines;
}

/* M752: THE ELSEWHERE OF A LONG TALE, FITTED TO THE READING. M719 let the seats grow with the tale (the forty-seat
 * eviction went: "capacity limits belong to prompt views, never deletion of stored seats") and fitted only the world
 * agent's own view (agents/world.js worldSeatView). The whole ledger every page reader, scribe, auditor, housekeeper and
 * founder is sent (engine/whole.js), and the storyteller's whole view (engine/state.js), still listed EVERY seat: three
 * hundred seats were 46,282 characters in each of those requests (a request over its connection is refused before it is
 * sent, providers/*.js), and on a 128k storyteller the whole state of things was shed to its first line, threads and all.
 * A view holds SEATS_VIEW seats — the forty the pool itself held before M719 — chosen for what is being read: everyone
 * the reading names (never left out, however many: they are bounded by the reading, not by the tale), then those on
 * their way to the scene or due, then those tied to the people here (an open thread between them, the page of someone
 * here naming them, their own seat naming someone here), then those with an open want, then the most lately seated.
 * The rest are counted, and named where the reader can fetch them (housekeeper.js serveFetch "person: NAME" serves the
 * seat with the page). */
export const SEATS_VIEW = 40;
export const SEAT_NAMES_ROOM = 2000; /* characters for the names of the seats not shown */
export function seatsForReading(state, { offscreen = state && state.offscreen, material = '', shown = SEATS_VIEW } = {}) {
  const safe = offscreen && typeof offscreen === 'object' ? offscreen : {};
  const present = Array.isArray(state && state.present) ? state.present : [];
  const characters = (state && state.characters && typeof state.characters === 'object') ? state.characters : {};
  const away = awaySeats(safe, present, characters);
  if (!Number.isFinite(shown) || away.length <= shown) return { chosen: away, rest: [] };
  const clockMinutes = state && state.clock && Number.isFinite(state.clock.minutes) ? state.clock.minutes : null;
  const text = String(material || '');
  const hereNames = present.map((p) => (typeof p === 'string' ? p : p && p.name)).filter((n) => typeof n === 'string' && n.trim());
  const isHereName = (n) => typeof n === 'string' && n.trim() && hereNames.some((h) => h === n || samePersonName(h, n));
  const pageOf = (n) => { const key = Object.keys(characters).find((k) => k === n || samePersonName(k, n)); return key ? characters[key] : null; };
  const hereText = hereNames.map(pageOf).filter((c) => c && typeof c === 'object')
    .map((c) => [c.core, c.state, c.arc, ...(Array.isArray(c.threads) ? c.threads : [])].filter((s) => typeof s === 'string').join('\n')).join('\n');
  const threads = (Array.isArray(state && state.threads) ? state.threads : []).filter((t) => t && typeof t === 'object');
  const tied = (name, entry) => threads.some((t) => (isHereName(t.owner) && typeof t.with === 'string' && samePersonName(t.with, name)) || (isHereName(t.with) && typeof t.owner === 'string' && samePersonName(t.owner, name)))
    || (hereText && nameOnPage(hereText, name))
    || (() => { const own = [entry.agenda, entry.activity, entry.location].map(cleanText).filter(Boolean).join('\n'); return Boolean(own) && hereNames.some((h) => nameOnPage(own, h)); })();
  const due = (entry) => onTheWay(entry, clockMinutes) || (Number.isFinite(entry.arrivesAtMinutes) && Number.isFinite(clockMinutes) && entry.arrivesAtMinutes <= clockMinutes);
  const tier = (name, entry) => (text.trim() && nameOnPage(text, name) ? 0 : due(entry) ? 1 : tied(name, entry) ? 2 : cleanText(entry.agenda) ? 3 : 4);
  const ranked = away.map(([name, entry], i) => ({ name, entry, tier: tier(name, entry), recency: recencyKey(entry), i }))
    .sort((a, b) => (a.tier - b.tier) || (b.recency - a.recency) || (a.i - b.i));
  const room = Math.max(shown, ranked.filter((r) => r.tier === 0).length);
  return { chosen: ranked.slice(0, room).map((r) => [r.name, r.entry]), rest: ranked.slice(room).map((r) => r.name) };
}
/* the view itself: the chosen seats in the storyteller's own order (seatLines), and the rest counted — named, with the way
 * to fetch each, for a reader that can look (`fetchable`) */
export function renderSeatsForReading(state, { offscreen = state && state.offscreen, material = '', shown = SEATS_VIEW, fetchable = false } = {}) {
  const clockMinutes = state && state.clock && Number.isFinite(state.clock.minutes) ? state.clock.minutes : null;
  const { chosen, rest } = seatsForReading(state, { offscreen, material, shown });
  const lines = seatLines(chosen, clockMinutes);
  if (!rest.length) return lines.join('\n');
  if (!fetchable) return [...lines, '(and ' + rest.length + ' more seated elsewhere, kept in the ledger and not shown here)'].join('\n');
  let names = '';
  let listed = 0;
  for (const name of rest) {
    if (names.length + name.length + 2 > SEAT_NAMES_ROOM) break;
    names += (names ? ', ' : '') + name;
    listed += 1;
  }
  return [...lines, '(and ' + rest.length + ' more seated elsewhere — each keeps their seat in the ledger, not shown here; fetch "person: NAME" for anyone’s page and where they are now, and before writing where someone not shown here is: '
    + names + (listed < rest.length ? ', and ' + (rest.length - listed) + ' more' : '') + ')'].join('\n');
}

/* M304: the same order, as names — the drawer lists the absent the way the
 * storyteller is told of them */
export function seatOrder(offscreen, clockMinutes) {
  const safe = offscreen && typeof offscreen === 'object' ? offscreen : {};
  return Object.keys(safe)
    .filter((name) => safe[name] && typeof safe[name] === 'object')
    .map((name) => ({ name, recency: recencyKey(safe[name]), rank: stanceRank(safe[name], clockMinutes) }))
    .sort((a, b) => (a.rank - b.rank) || (b.recency - a.recency))
    .map((r) => r.name);
}

/* Lower is nearer the scene. `toward` and `seeking` carry their arrival: due
 * or overdue first, then by how soon; a stance with no clock sits behind
 * one with a clock. */
function stanceRank(entry, clockMinutes) {
  /* M681 (W5): an approach that lapsed (engine/world.js onTheWay) ranks as a seat that says nothing of reaching the scene —
   * it ranked FIRST ("due or overdue = 0"), above someone truly arriving, with no arrival left to tell */
  const st = typeof entry.stance === 'string' && !((entry.stance === 'toward' || entry.stance === 'seeking') && !onTheWay(entry, clockMinutes)) ? entry.stance : '';
  const base = st === 'toward' ? 0 : st === 'seeking' ? 100 : st === 'tense' ? 200 : st === 'busy' ? 300 : st === 'waiting' ? 400 : entry.lastSeen === true ? 600 : 500; /* M304: a bare sighting says least about who can reach the scene */
  if (st === 'toward' || st === 'seeking') {
    if (Number.isFinite(entry.arrivesAtMinutes) && Number.isFinite(clockMinutes)) {
      const left = entry.arrivesAtMinutes - clockMinutes;
      /* due or overdue = 0; then every five minutes a step, capped */
      return base + Math.min(99, Math.max(0, Math.ceil(left / 5)));
    }
    return base + 99;
  }
  return base;
}
