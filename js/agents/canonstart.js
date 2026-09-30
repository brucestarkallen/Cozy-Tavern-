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
  const facts = (start.facts || []).map((f) => '- ' + f.replace(/^[-•]\s*/, ''));
  return [head, ...(facts.length ? ['By then, in canon:', ...facts] : []), 'Nothing in canon after this moment has happened here — from it on, only our own pages decide.'].join('\n');
}

/* the question, asked once: { start } when the story sits in a canon, { none: true } when it does not, null when the helper
 * could not be asked or gave nothing usable (the page goes on without it — a missing note never blocks a page) */
export async function placeInCanon({ connection, concept, brief = '', signal } = {}) {
  if (!connection || !String(concept || '').trim()) return null;
  const ask = canonStartAsk({ concept, brief });
  let text = '';
  try { ({ text } = await callWorker(connection, { system: withFictionFrame(ask.system), user: ask.user, maxTokens: 1600, signal })); } catch (err) { return null; }
  if (/"canon"\s*:\s*false/.test(String(text || ''))) return { none: true };
  const start = readCanonStart(text);
  return start ? { start } : null;
}

