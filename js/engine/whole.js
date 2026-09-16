/* Cozy Tavern — engine/whole.js
 * M259: THE WHOLE LEDGER, FOR THE READERS WHO WRITE IT AND THE ONE WHO CHECKS IT.
 *
 * Every reader of the ledger was handed the STORYTELLER's copy of it —
 * renderStateFacts, which is built to fit a prompt: the six strongest
 * standings, five threads, the four newest things a person knows, six seats,
 * four factions, whole sections shed when it runs long, and no line at all
 * for the ground the scene stands on. That is right for the storyteller, who
 * needs the gist. It is wrong for the extractor and the world agent, who
 * WRITE those books, and it was ruinous for the auditor, who is told to hold
 * the WHOLE ledger against the pages. Measured on a ledger of thirteen
 * standings, eight threads and nine things one person knew: it was shown
 * six, five and four, and no ground. So it reported the rest as missing and
 * "set them right" — a fact re-added in new words (a duplicate, which pushed
 * another fact out of view), a standing "restored" over one the pages had
 * moved — and found the same things again the next turn.
 *
 * Nothing here is trimmed by a budget. The books are capped where they are
 * kept (eight threads, twelve facts a person, twelve seats), so the whole is
 * bounded by the ledger itself.
 */

import { renderClock } from './clock.js';
import { renderBodies } from './bodies.js';
import { renderCanon } from './canon.js';
import { renderOffscreen } from './offscreen.js';
import { renderFightLine, mcName } from './duels.js';
import { findKnowledgeKey } from './world.js';
import { storyTurn } from './apply.js';
import { firstSentence } from './sentence.js'; /* M292 */

export const MOOD_FLAGS = ['combat', 'intimate', 'travel', 'socialField', 'isolation', 'group'];

const clean = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
const clip = (v, n) => {
  const s = clean(v);
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
};
const num = (x) => (Number.isFinite(Number(x)) ? Math.round(Number(x)) : 0);

/* Every standing, zero ones included, with its numbers and the last two
 * causes that moved it — so a reader can tell a standing the PAGES moved
 * (the cause quotes a beat) from one set by hand or by the brief. */
export function renderAllStandings(relationships) {
  const rels = relationships && typeof relationships === 'object' ? relationships : {};
  const rows = [];
  for (const [name, r] of Object.entries(rels)) {
    if (!r || typeof r !== 'object') continue;
    const causes = (Array.isArray(r.history) ? r.history : [])
      .filter((h) => h && typeof h.cause === 'string' && h.cause.trim())
      .slice(-2)
      .map((h) => clip(h.cause, 400));
    rows.push(name + ' — P:' + num(r.p) + ' R:' + num(r.r) + ' S:' + num(r.s)
      + (causes.length ? ' (latest causes: ' + causes.join(' | ') + ')' : ''));
  }
  return rows.join('\n');
}

/* Every open thread, cold ones too, the title in quotes exactly as the
 * ledger holds it — a reader asked to close one must be able to name it. */
export function renderAllThreads(threads) {
  const rows = [];
  for (const t of (Array.isArray(threads) ? threads : [])) {
    if (typeof t === 'string') { if (t.trim()) rows.push('"' + clean(t) + '"'); continue; }
    if (!t || typeof t !== 'object') continue;
    const title = clean(t.title || t.label || t.name);
    if (!title) continue;
    let line = (t.heat === 'cold' ? '(cold) ' : '') + '"' + title + '"';
    if (t.owner) line += ' — ' + clean(t.owner);
    if (t.next) line += (t.owner ? ' means to ' : ' — next: ') + clean(t.next).replace(/\.+$/, '');
    rows.push(line);
  }
  return rows.join('\n');
}

/* Every line of who knows what, for everyone — the people in the scene
 * first, marked. A reader that writes knowledge must see all of it, or it
 * writes the same fact again in other words. */
export function renderAllKnowledge(knowledge, present = []) {
  const safe = knowledge && typeof knowledge === 'object' ? knowledge : {};
  const hereKeys = new Set((Array.isArray(present) ? present : [])
    .map((p) => (typeof p === 'string' ? p : p && p.name))
    .filter((n) => typeof n === 'string' && n.trim())
    .map((n) => findKnowledgeKey(safe, n))
    .filter(Boolean));
  const rows = [];
  for (const [name, list] of Object.entries(safe)) {
    if (!Array.isArray(list)) continue;
    const facts = list.filter((k) => k && typeof k.fact === 'string' && k.fact.trim()).map((k) => clean(k.fact).replace(/\.+$/, ''));
    if (!facts.length) continue;
    rows.push({ here: hereKeys.has(name), text: name + (hereKeys.has(name) ? ' (in the scene)' : '') + ' knows: ' + facts.join('; ') + '.' });
  }
  rows.sort((a, b) => Number(b.here) - Number(a.here));
  return rows.map((r) => r.text).join('\n');
}

/* Every faction, newest move first. */
export function renderAllFactions(factions) {
  const safe = factions && typeof factions === 'object' ? factions : {};
  return Object.entries(safe)
    .filter(([, f]) => f && typeof f === 'object')
    .map(([name, f]) => ({ name, f, at: Number.isFinite(f.atTurn) ? f.atTurn : -1 }))
    .sort((a, b) => b.at - a.at)
    .map(({ name, f }) => {
      const bits = [];
      if (f.stance) bits.push(clean(f.stance));
      if (f.agenda) bits.push('wants ' + clean(f.agenda).replace(/\.+$/, ''));
      if (f.move) bits.push('last move: ' + clean(f.move).replace(/\.+$/, ''));
      return name + ' — ' + (bits.join('; ') || 'stands unchanged');
    })
    .join('\n');
}

/* The whole ledger, every book, nothing shed. */
export function renderWholeLedger(state) {
  if (!state || typeof state !== 'object') return '';
  const out = [];
  const clockMinutes = state.clock && Number.isFinite(state.clock.minutes) ? state.clock.minutes : null;
  const present = Array.isArray(state.present) ? state.present : [];
  const fight = renderFightLine(state);
  if (fight) out.push(fight);
  if (Number.isFinite(state.composure)) {
    if (state.composure < 1.5) out.push(mcName(state) + ' is near breaking — the strain shows.');
    else if (state.composure < 3) out.push(mcName(state) + '\'s nerve is fraying.');
  }
  const place = state.place && clean(state.place.name);
  out.push('The ground: ' + (place || 'not set') + '.');
  const spoken = state.clock && typeof state.clock === 'object' ? (renderClock(state.clock) || state.clock.label || '') : '';
  out.push('The hour: ' + (spoken || 'not set') + '.');
  const here = present.map((p) => {
    if (!p || !p.name) return '';
    const detail = [p.position, p.attire].filter((s) => typeof s === 'string' && s.trim()).join(', ');
    return detail ? p.name + ' (' + detail + ')' : p.name;
  }).filter(Boolean);
  out.push('Here now: ' + (here.length ? here.join(', ') : 'nobody is written in') + '.');
  const mode = state.mode && typeof state.mode === 'object' ? state.mode : {};
  const moods = MOOD_FLAGS.filter((f) => mode[f]);
  out.push('Moods on the board: ' + (moods.length ? moods.join(', ') : 'none') + '.');
  const section = (head, body, empty) => out.push(head + '\n' + (body || empty));
  section('Standings toward ' + mcName(state) + ' — EVERY one written; a person not listed has none:',
    renderAllStandings(state.relationships), '(none)');
  section('Threads still open — ALL of them, each title in quotes exactly as the ledger holds it:',
    renderAllThreads(state.threads), '(none)');
  section('Who knows what — EVERY line written, for everyone:',
    renderAllKnowledge(state.knowledge, present), '(nothing written)');
  section('Elsewhere — every seat of the absent:',
    renderOffscreen(state.offscreen, present, clockMinutes, 1000), '(nobody seated)');
  section('What their bodies carry:',
    renderBodies(state.bodies, clockMinutes, storyTurn(state)), '(nothing written)');
  section('What is locked true:',
    state.canon && typeof state.canon === 'object' ? renderCanon(state.canon, Object.keys(state.canon)) : '', '(nothing locked)');
  section('Factions — all of them:', renderAllFactions(state.factions), '(none)');
  return out.join('\n');
}

export { wholePage, PAGE_CAP } from './pagecut.js'; /* M259: a page is read to its end */

/* M283: THE WRITER'S OWN MATERIAL, TO THE WORKERS. The brief was cut at 40,000
 * characters and the cast notes at 20,000 in seven workers — five of them in
 * silence, and wherever the count fell. The storyteller reads them whole; a
 * worker reads them to the same room, and past it the cut falls at a line and
 * says so (with the way to the rest, for a worker that can fetch). */
export const BRIEF_ROOM = 40000;   /* the room the workers have always had — a larger one starves a smaller context's pages and fetches */
export const CAST_ROOM = 20000;
export function writerText(text, room, label, canFetch = false) {
  const t = String(text || '').trim();
  if (!t || t.length <= room) return t;
  const head = t.slice(0, room);
  const nl = head.lastIndexOf('\n');
  const sp = head.lastIndexOf(' ');
  const cut = (nl > room * 0.6 ? head.slice(0, nl) : sp > 0 ? head.slice(0, sp) : head).trimEnd();
  const key = /cast/i.test(label) ? 'cast' : 'brief';
  return cut + '\n(the ' + label + ' continue' + (/s$/.test(label) ? '' : 's') + ' \u2014 ' + (t.length - cut.length) + ' more characters'
    + (canFetch ? '; fetch "' + key + '" for all of it' : ' not shown here') + ')';
}

/* M288: HOW MUCH OF A PERSON'S PAGE A READING HOLDS — one rule for every reader
 * that shows the character pages whole (the auditor, the housekeeper). A ledger
 * of many faces outgrew their model's room and every reading was refused; past
 * its room a reading takes these steps, one at a time:
 *   1  the passed-through: their name only;
 *   2  arcs and loose ends only for those near the story (here, seated, or
 *      bonded 20 or more);
 *   3  what they are doing now, likewise;
 *   4  those away: who they are, only;
 *   5  those away: the first clause of it.
 * Whoever is here keeps the whole page. null = the name only. */
export function firstClause(text, max = 200) {
  const first = firstSentence(text); /* M292: a title's period does not end it */
  if (first.length <= max) return first;
  const sp = first.lastIndexOf(' ', max);
  return first.slice(0, sp > max / 2 ? sp : max) + '\u2026';
}
export function nearNames(state) {
  const lower = (x) => String(x || '').trim().toLowerCase();
  const here = new Set(((state && state.present) || []).map((p) => lower(p && p.name)));
  const rels = (state && state.relationships) || {};
  const near = new Set([
    ...here,
    ...Object.keys((state && state.offscreen) || {}).map(lower),
    ...Object.keys(rels).filter((k) => { const r = rels[k] || {}; return Math.abs(r.p || 0) + Math.abs(r.r || 0) + Math.abs(r.s || 0) >= 20; }).map(lower),
  ]);
  return { here, near, lower };
}
export function leanPage(names, name, c, level) {
  if (!c || typeof c !== 'object') return null;
  if (c.retired && level >= 1) return null;
  const inScene = names.here.has(names.lower(name));
  const close = inScene || (names.near.has(names.lower(name)) && level < 4);
  const threads = Array.isArray(c.threads) ? c.threads.map((t) => (typeof t === 'string' ? t : t && t.text)).filter(Boolean) : [];
  return {
    core: c.core ? (level >= 5 && !inScene ? firstClause(c.core) : c.core) : '',
    state: c.state && (level < 3 || close) ? c.state : '',
    arc: c.arc && (level < 2 || close) ? c.arc : '',
    threads: level < 2 || close ? threads : [],
    shortened: level > 0 && !inScene,
  };
}
export const LEAN_STEPS = 5;
