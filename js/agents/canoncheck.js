/* Cozy Tavern — agents/canoncheck.js (M551)
 * ONE CHECK FOR WHAT A HELPER WROTE FROM MEMORY ABOUT A CANON. His question after M550: "does this only fix the hierarchy, or
 * everything that could go wrong? I can't have flex tape each time." M550 checked the note "where our story began" against
 * one line per person — who they are — so mostly titles and seats. The class is wider: two texts ride with every page and
 * are written from a model's memory of the canon — where the story began (the founder), and the automatic brief's world
 * (the world keeper). Any kind of claim in them can be wrong: who is alive or dead, who is where, who is tied to whom, what
 * someone can do, what has happened by then — not only who holds which seat.
 * So every claim in both is checked against EVERYTHING the series' wiki says of the people canon verification looked up
 * (their identity, summary, facts, abilities, ties, biography — seen through his story's lens where it has been read) and
 * the wiki's own summary of where the story stands: a claim the wiki shows cannot be true at the story's moment is let go
 * — silently, nothing asserted in its place. The wiki tells the series as it ENDS, so a claim about an earlier moment that
 * differs from the end is not wrong; a claim the wiki does not mention is never wrong. His own words are never checked.
 * Checked again whenever the claims or the wiki's material change (a person looked up later brings them in).
 * Pure but for checkClaims (one worker call). */
import { callWorker } from './call.js';
import { withFictionFrame } from './voice.js';
import { lensStatements, throughLens, overlayFor } from './canonlens.js';

export const PERSON_CHARS = 1600;   /* what the wiki says of one person, at most */
export const MATERIAL_CHARS = 24000; /* all of it, about 6,000 tokens — the people the claims name first */

const clip = (t, n) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const fpOf = (t) => { let h = 5381; const x = String(t || ''); for (let i = 0; i < x.length; i += 1) h = ((h << 5) + h + x.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const fold = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/* EVERYTHING THE WIKI SAYS OF THE PEOPLE LOOKED UP — one line each, "Name — what it says; …", through the lens; the people
 * the claims name first (by a name of theirs four letters or longer, said in the claims), then the rest, within the room */
export function wikiMaterial(meta, { claims = '', room = MATERIAL_CHARS } = {}) {
  const cache = meta && meta.canon_grounding_cache && typeof meta.canon_grounding_cache === 'object' ? meta.canon_grounding_cache : {};
  const said = fold(claims);
  const people = [];
  for (const [k, entry] of Object.entries(cache)) {
    if (!entry || !entry.found || !entry.dossier) continue;
    const seen = throughLens(entry, overlayFor(meta, entry));
    const who = String((entry.dossier && entry.dossier.name) || entry.name || k).trim();
    const lines = lensStatements(seen).map((x) => x.text).filter(Boolean);
    if (!who || !lines.length) continue;
    const named = fold(who).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4).some((w) => new RegExp('(^|[^\\p{L}\\p{N}])' + w + '($|[^\\p{L}\\p{N}])', 'u').test(said));
    people.push({ who, named, line: clip(who + ' — ' + [...new Set(lines)].join('; '), PERSON_CHARS) });
  }
  people.sort((a, b) => (a.named === b.named ? a.who.localeCompare(b.who) : a.named ? -1 : 1));
  const out = [];
  let used = 0;
  for (const p of people) {
    if (used + p.line.length + 3 > room) break;
    out.push(p.line);
    used += p.line.length + 3;
  }
  return out;
}

export function claimsPrint(claims, material) {
  return fpOf((Array.isArray(claims) ? claims : []).join('\n') + '\n--\n' + (Array.isArray(material) ? material : []).join('\n'));
}

export const CHECK_SYSTEM = [
  'You check facts a helper wrote down from memory about a story set in an existing canon, against what the series\u2019 wiki says.',
  'Every kind of fact: who someone is, their rank or seat, who leads what, who is alive or dead, who is where, who is tied to or allied with whom, what someone can do, what has happened by then.',
  'The wiki\u2019s lines tell the series as it ENDS (a biography in them may say when things changed). Titles, seats, lives and ties change over a series: a fact about an earlier moment can be true then and differ from the wiki\u2019s end — that is NOT wrong.',
  'Mark a fact wrong only when the wiki\u2019s lines show it cannot be true at the story\u2019s moment: the moment is at or after the point the wiki describes and the wiki says otherwise; or the fact gives someone a seat, a tie, a power or a deed the wiki shows they never had at any point.',
  'Never mark a fact wrong because the wiki does not mention it.',
  'Answer with ONLY this JSON: {"wrong":[the numbers of the wrong facts]} — {"wrong":[]} when none is.',
].join('\n');

/* the question: the story's moment, the facts numbered, the wiki's material */
export function claimsAsk({ moment = '', claims = [], material = [], arc = null, label = 'THE FACTS WRITTEN DOWN FOR THAT MOMENT:' } = {}) {
  const user = [
    'WHERE THE STORY BEGINS: ' + String(moment || '').trim(),
    ...(arc && arc.summary ? ['', 'WHERE THE STORY STANDS IN CANON, AS THE WIKI TELLS IT (' + clip(arc.title || '', 80) + '):', clip(arc.summary, 3000)] : []),
    '',
    label,
    ...(Array.isArray(claims) ? claims : []).map((f, i) => (i + 1) + '. ' + f),
    '',
    'WHAT THE SERIES\u2019 WIKI SAYS OF THE PEOPLE IN IT (the series as it ends):',
    ...(Array.isArray(material) ? material : []).map((w) => '- ' + w),
    '',
    'Which facts are wrong? JSON only.',
  ].join('\n');
  return { system: CHECK_SYSTEM, user };
}

/* its answer, read strictly: numbers of facts that exist, each once — anything else is no answer (nothing changes) */
export function readClaimsCheck(raw, count) {
  let obj = raw;
  if (typeof raw === 'string') {
    const a = raw.indexOf('{'); const b = raw.lastIndexOf('}');
    if (a === -1 || b <= a) return null;
    try { obj = JSON.parse(raw.slice(a, b + 1)); } catch { return null; }
  }
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.wrong)) return null;
  const wrong = [];
  for (const n of obj.wrong) {
    const k = Number(n);
    if (!Number.isInteger(k) || k < 1 || k > count) continue;
    if (!wrong.includes(k - 1)) wrong.push(k - 1);
  }
  return { wrong: wrong.sort((x, y) => x - y) };
}

/* never throws: { wrong } or null when it could not be had (nothing changes; it is asked again later) */
export async function checkClaims({ connection, moment = '', claims = [], material = [], arc = null, label, signal, callLLM = callWorker } = {}) {
  const list = Array.isArray(claims) ? claims.filter((c) => String(c || '').trim()) : [];
  if (!connection || !list.length || !Array.isArray(material) || !material.length) return null;
  try {
    const ask = claimsAsk({ moment, claims: list, material, arc, label });
    const answer = await callLLM(connection, { system: withFictionFrame(ask.system), user: ask.user, maxTokens: 800, signal });
    return readClaimsCheck(typeof answer === 'string' ? answer : (answer && answer.text) || '', list.length);
  } catch (err) { return null; }
}

/* THE WORLD'S SENTENCES — the automatic brief's parts as numbered facts, and the parts again without the wrong ones */
export function sentencesOf(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?…])\s+(?=[A-Z0-9"“(])/).map((s) => s.trim()).filter(Boolean);
}
export function worldClaims(parts) {
  const out = [];
  for (const [k, v] of Object.entries(parts && typeof parts === 'object' ? parts : {})) if (typeof v === 'string') sentencesOf(v).forEach((s, i) => out.push({ part: k, i, text: s })); /* M568: only text is checked */
  return out;
}
export function worldWithout(parts, claims, wrong) {
  const drop = new Set((Array.isArray(wrong) ? wrong : []).map((n) => claims[n]).filter(Boolean).map((c) => c.part + '|' + c.i));
  const next = {};
  for (const [k, v] of Object.entries(parts && typeof parts === 'object' ? parts : {})) {
    if (typeof v !== 'string') { next[k] = v; continue; } /* M568: not text — left as it lay, for groundWords to leave out */
    const kept = sentencesOf(v).filter((s, i) => !drop.has(k + '|' + i));
    if (kept.length) next[k] = kept.join(' ');
  }
  return next;
}
