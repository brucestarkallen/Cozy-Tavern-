/* Cozy Tavern — agents/canonstart.js (M516)
 * WHERE OUR STORY BEGAN IN CANON. His word: "#story jujutsu kaisen — Jovan Oda… he sees Yuki going to die, parries it,
 * and stands in front of her. It confuses every timeline: Yuta abroad, the Zenin clan not destroyed by Maki." The same
 * storyteller answers "who does Yuta fight in Sendai?" rightly: the fact is known, its moment is not — a true fact with
 * the wrong timestamp. A model asked the timeline question alone gets it right; writing a scene, it reaches for its
 * strongest memory of each person instead ("Yuta — studying abroad"), and the ledger then writes that down as canon.
 * So the question is asked ONCE, alone, when a #story opens a tale: which series, which arc, which moment, and what is
 * true of that world at that moment — nothing after it. The answer rides as his own note from then on, every page; he
 * can correct it in Settings (This story).
 * Pure: the question, the reader, the words. The call is chat.js's. */

import { callWorker } from './call.js';
import { withFictionFrame } from './voice.js';
import { claimsAsk, readClaimsCheck, checkClaims } from './canoncheck.js'; /* M551: one check */

export const CANON_START_KEY = (storyId) => 'canonStart:' + storyId;
const MAX_FACTS = 20;

const SYSTEM = [
  'You place a story in its canon. A writer is starting a story with one line of his own. Decide whether it is set in an',
  'existing canon (an anime, manga, novel, game, film or series), and if it is, WHERE in that canon\u2019s timeline it',
  'begins — and what is true of that world at that exact moment.',
  '',
  'Answer with ONE JSON object and nothing else:',
  '{"canon":true,"series":"","arc":"","moment":"","when":"","facts":["",""]}',
  'or {"canon":false} when the story is not set in an existing canon.',
  '',
  'series — the work\u2019s name as fans write it. arc — the arc or part the moment belongs to, as the series\u2019 fans name it.',
  'moment — the canon moment the story begins at, in one plain line (the event, where, who is there).',
  'when — the canon date or season at that moment, if canon gives one; "" if it does not.',
  'facts — up to twenty short lines of what is TRUE AT THAT MOMENT: where the main people are, who is alive, dead,',
  'sealed, captured, abroad or back, who leads what, what has already happened (the great battles, the deaths, the',
  'factions destroyed or risen), and who knows what. Above all, the states that CHANGED earlier in the series and a',
  'storyteller might still picture the old way — someone who was abroad and has since come back, a clan already wiped',
  'out, a seal already broken or set, a death already happened — each said as it stands AT THIS MOMENT.',
  '',
  'Never anything that happens AFTER the moment — no later event, no hint of it, not the fate of anyone in the scene.',
  'The writer\u2019s own character is not part of canon: never describe them, and never add them to the facts.',
  'Only what canon itself establishes; where canon is silent, leave it out rather than guess.',
].join('\n');

export function canonStartAsk({ concept = '', brief = '' } = {}) {
  const user = [
    'The writer\u2019s opening line:',
    String(concept || '').trim(),
    ...(String(brief || '').trim() ? ['', 'His brief for the story:', String(brief).trim()] : []),
    '',
    'Where in its canon does this story begin, and what is true of that world at that moment? JSON only.',
  ].join('\n');
  return { system: SYSTEM, user };
}

const line = (v, max = 240) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

/* the helper's answer, read strictly: null unless it places the story in a named canon with a moment */
export function readCanonStart(raw) {
  let obj = raw;
  if (typeof raw === 'string') {
    const t = raw.replace(/^[\s\S]*?(\{)/, '$1').replace(/\}[^}]*$/, '}');
    try { obj = JSON.parse(t); } catch { return null; }
  }
  if (!obj || typeof obj !== 'object' || obj.canon !== true) return null;
  const series = line(obj.series, 80);
  const moment = line(obj.moment, 300);
  if (!series || !moment) return null;
  const facts = (Array.isArray(obj.facts) ? obj.facts : []).map((f) => line(f, 220)).filter(Boolean).slice(0, MAX_FACTS);
  return { series, arc: line(obj.arc, 80), moment, when: line(obj.when, 80), facts };
}

/* the note, in the writer's own voice — what rides with every page */
export function canonStartWords(start) {
  if (!start || typeof start !== 'object') return '';
  if (typeof start.words === 'string' && start.words.trim()) return start.words.trim(); /* his own correction stands as he wrote it */
  if (!start.series || !start.moment) return '';
  const head = 'Where our story began in ' + start.series + ': ' + (start.arc ? start.arc + ' — ' : '') + start.moment.replace(/[.]+$/, '') + (start.when ? ' (' + start.when + ')' : '') + '.';
  const facts = (Array.isArray(start.facts) ? start.facts : []).filter((f) => typeof f === 'string' && f.trim()).map((f) => '- ' + f.replace(/^[-•]\s*/, '')); /* M553: a fact of the wrong kind never breaks the note */
  return [head, ...(facts.length ? ['By then, in canon:', ...facts] : []), 'Nothing in canon after this moment has happened here — from it on, only our own pages decide.'].join('\n');
}

/* the question, asked once: { start } when the story sits in a canon, { none: true } when it does not, null when the helper
 * could not be asked or gave nothing usable (the page goes on without it — a missing note never blocks a page) */
export async function placeInCanon({ connection, concept, brief = '', signal } = {}) {
  if (!connection || !String(concept || '').trim()) return null;
  const ask = canonStartAsk({ concept, brief });
  let text = '';
  /* M536: A CALL THAT FAILED IS NOT AN ANSWER. With his connection lost mid-check, the failure was written down as "tried" and
   * nothing asked again for six hours — Try again did not restart it. A failed call (no network, an error, the ceiling
   * reached) comes back as { failed: true } and is written down as nothing, so the next chance asks again. */
  try { ({ text } = await callWorker(connection, { system: withFictionFrame(ask.system), user: ask.user, maxTokens: 1600, signal })); } catch (err) { return { failed: true }; }
  if (/"canon"\s*:\s*false/.test(String(text || ''))) return { none: true };
  const start = readCanonStart(text);
  return start ? { start } : null;
}


/* M550: WHERE OUR STORY BEGAN, CHECKED AGAINST THE WIKI. The facts above are a model's memory of a canon, written once, never
 * looked up — and they ride with every page. His Bleach tale, after the war: "Zaraki is the Captain-Commander". When canon
 * verification has looked people up, those facts are checked against the wiki's own lines for them: a fact the wiki shows
 * cannot be true at the story's moment is let go (silence — nothing is asserted in its place). The wiki tells the series as
 * it ENDS, so a fact about an earlier moment that differs from the end is NOT wrong (seats change over a series). Never his
 * own correction: his words stand as he wrote them. Checked again only when the facts or the wiki's lines change. */
const fpOf = (t) => { let h = 5381; const x = String(t || ''); for (let i = 0; i < x.length; i += 1) h = ((h << 5) + h + x.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
export function startCheckPrint(start, wiki) {
  const facts = start && Array.isArray(start.facts) ? start.facts : [];
  return fpOf(facts.join('\n') + '\n--\n' + (Array.isArray(wiki) ? wiki : []).join('\n'));
}
/* M551: ONE CHECK (agents/canoncheck.js) — the note's facts are asked about exactly as the world's are: every kind of fact,
 * against everything the wiki says of the people looked up */
export function startCheckAsk({ start, wiki = [] } = {}) {
  return claimsAsk({ moment: [start && start.series, start && start.arc, start && start.moment].filter(Boolean).join(' — '), claims: start && Array.isArray(start.facts) ? start.facts : [], material: wiki });
}
export function readStartCheck(raw, count) { return readClaimsCheck(raw, count); }
/* the start without what the wiki shows wrong — his own words never touched */
export function applyStartCheck(start, wrong, wiki) {
  if (!start || typeof start !== 'object' || (typeof start.words === 'string' && start.words.trim())) return start;
  const facts = Array.isArray(start.facts) ? start.facts : [];
  const drop = new Set(Array.isArray(wrong) ? wrong : []);
  const kept = facts.filter((_, i) => !drop.has(i));
  const gone = facts.filter((_, i) => drop.has(i));
  const next = { ...start, facts: kept, dropped: [...(Array.isArray(start.dropped) ? start.dropped : []), ...gone] };
  next.checkedFp = startCheckPrint(next, wiki);
  return next;
}
/* never throws: { wrong } or null when it could not be had (nothing changes; it is asked again later) */
export async function checkCanonStart({ connection, start, wiki = [], arc = null, signal, callLLM } = {}) {
  return checkClaims({ connection, moment: [start && start.series, start && start.arc, start && start.moment].filter(Boolean).join(' — '), claims: start && Array.isArray(start.facts) ? start.facts : [], material: wiki, arc, signal, ...(callLLM ? { callLLM } : {}) });
}
