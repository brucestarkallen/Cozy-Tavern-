/* Cozy Tavern — agents/worldground.js (M517)
 * THE AUTOMATIC BRIEF — THE WORLD, WRITTEN ONCE. His design: "instead of injecting the wiki every page like a madman — a
 * brief button: Manual is my own brief; Automatic is AI-curated ground, built from canon verification, the ledger, the
 * folds and the essentials… and it works without canon too." One home per fact:
 *   the WORLD (the setting, where in canon the story stands, how power works, the factions, the places that matter,
 *     what stands in the world now) — here, in the brief's seat, the same on every page;
 *   the STORY (what happened, who is what to whom) — the record and the essentials, never retold here;
 *   each PERSON — their own page in the ledger, never listed here.
 * Rewritten only where the world itself changed: checked after a page when the record has grown, only the parts that
 * changed are asked for and replaced (never a whole rewrite from its own last version), and the whole is held to its room.
 * His own brief, when he wrote one, rides beside it untouched — the ground never repeats it. His own correction of the
 * ground stands as he wrote it until he asks for it to be rebuilt.
 * Pure but for runGround (one worker call). */
import { callWorker } from './call.js';
import { withFictionFrame } from './voice.js';

export const GROUND_KEY = (storyId) => 'worldGround:' + storyId;
export const GROUND_PART_CHARS = 700;      /* one part, at most */
export const GROUND_MAX_CHARS = 4200;      /* the whole, about 1,000 tokens — it cannot grow without end */
export const GROUND_EVERY = 24;            /* pages folded into the record since the last look before the world is looked at again
                                              (pages, not lines: the record's lines merge as it layers, its pages only grow) */

/* the six parts, in the order they ride, and the words that open each */
export const GROUND_PARTS = [
  ['world', 'The setting'],
  ['where', 'Where in canon'],
  ['powers', 'How power works'],
  ['factions', 'Who holds power'],
  ['places', 'The places that matter'],
  ['standing', 'What stands in the world now'],
];

const clip = (v, n = GROUND_PART_CHARS) => {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return (stop > n * 0.5 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, '') + '…').trim();
};

const RULES = [
  'The WORLD only. Never a person\u2019s page (who someone is, how they feel, how they talk — each person has their own page),',
  'never the story\u2019s events told again (the story has its own record) — only what those events LEFT standing in the world',
  '(a city fallen, a war begun, a treaty, a seal, a clan destroyed). Never the writer\u2019s own character\u2019s inner life.',
  'Only what the material establishes; where it is silent, leave the part empty rather than invent.',
  'For a story set in an existing canon: nothing canon holds AFTER the story\u2019s present — no later event, no hint of it.',
  'His own brief is already in front of the storyteller: never repeat it — add only what it does not say.',
  'Each part a few plain lines, at most seven hundred characters; "" for a part with nothing to say.',
].join('\n');

const SHAPE = '{"world":"","where":"","powers":"","factions":"","places":"","standing":""}';

const PART_WORDS = [
  'world — the setting: the kind of world, its era and its frame, as this story has it.',
  'where — for a story in an existing canon: where in it the story stands now (the arc, and the state of that world at this point); "" for an original story.',
  'powers — how power works here (magic, techniques, technology, rank), as established.',
  'factions — the groups that hold power, who leads them, who stands against whom — as it stands now.',
  'places — the places that matter and what they are.',
  'standing — what stands in the world now because of what happened: wars, treaties, seals, the fallen and the risen.',
].join('\n');

function material({ concept = '', brief = '', canonStart = '', arc = null, ledger = {}, essentials = '', recent = [] } = {}) {
  const out = [];
  if (String(concept).trim()) out.push('HOW HE BEGAN THE STORY (his #story line):', String(concept).trim(), '');
  if (String(brief).trim()) out.push('HIS OWN BRIEF (already in front of the storyteller — do not repeat it):', String(brief).trim(), '');
  if (String(canonStart).trim()) out.push('WHERE THE STORY BEGAN IN ITS CANON:', String(canonStart).trim(), '');
  if (arc && arc.summary) out.push('WHERE THE STORY STANDS IN CANON NOW (' + clip(arc.title || '', 80) + '):', clip(arc.summary, 3000), '');
  const l = ledger && typeof ledger === 'object' ? ledger : {};
  const facts = [];
  if (l.place) facts.push('The scene is at: ' + clip(l.place, 120));
  if (l.factions && typeof l.factions === 'object' && Object.keys(l.factions).length) facts.push('Factions in the ledger: ' + clip(JSON.stringify(l.factions), 1200));
  if (l.worldBrief) facts.push('The world beyond the scene: ' + clip(typeof l.worldBrief === 'string' ? l.worldBrief : JSON.stringify(l.worldBrief), 1200));
  if (facts.length) out.push('THE LEDGER (the story\u2019s own record of its world):', ...facts, '');
  if (String(essentials).trim()) out.push('THE STORY SO FAR, IN BRIEF (for what it LEFT standing in the world — never to retell):', clip(essentials, 6000), '');
  const lines = (Array.isArray(recent) ? recent : []).map((t) => clip(t, 500)).filter(Boolean);
  if (lines.length) out.push('WHAT HAPPENED MOST RECENTLY:', ...lines.map((t) => '- ' + t), '');
  return out.join('\n');
}

/* the first build: the world from everything the story has */
export function groundAsk(input = {}) {
  return {
    system: ['You keep the world of a story: the few lines the storyteller holds about the WORLD itself, on every page.', '', RULES, '', 'Answer with ONE JSON object and nothing else:', SHAPE, '', PART_WORDS].join('\n'),
    user: [material(input), 'Write the world of this story. JSON only.'].join('\n'),
  };
}

/* a later look: only the parts the world changed, from what happened since */
export function groundUpdateAsk({ ground = null, ...input } = {}) {
  const now = GROUND_PARTS.map(([k, label]) => label + ' — ' + ((ground && ground.parts && ground.parts[k]) || '(empty)')).join('\n');
  return {
    system: ['You keep the world of a story: the few lines the storyteller holds about the WORLD itself, on every page. You are',
      'told what they say now and what happened since. Change a part ONLY if the world itself changed (a new place that',
      'matters, a faction risen or fallen, a war, a seal broken, the story crossing into a new arc) — never because the story',
      'moved on in the ordinary way.', '', RULES, '',
      'Answer with ONE JSON object and nothing else: {"changed":{}} when nothing in the world changed, or',
      '{"changed":{"standing":"the whole new part"}} — only the parts that changed, each written whole.', '', PART_WORDS].join('\n'),
    user: ['WHAT THE WORLD PARTS SAY NOW:', now, '', material(input), 'Which parts of the world changed? JSON only.'].join('\n'),
  };
}

function parseObject(raw) {
  if (raw && typeof raw === 'object') return raw;
  const t = String(raw || '');
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a === -1 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

/* the parts, clipped, and the whole held to its room (the last parts give way first) */
function fit(parts) {
  const out = {};
  let used = 0;
  for (const [k] of GROUND_PARTS) {
    const v = clip(parts[k] || '');
    if (!v) continue;
    if (used + v.length > GROUND_MAX_CHARS) break;
    out[k] = v;
    used += v.length;
  }
  return out;
}

export function readGround(raw) {
  const o = parseObject(raw);
  if (!o || typeof o !== 'object') return null;
  const parts = fit(o);
  return Object.keys(parts).length >= 2 ? parts : null; /* a world of one line is not a world — the answer is not used */
}

export function readGroundPatch(raw) {
  const o = parseObject(raw);
  if (!o || typeof o !== 'object' || !o.changed || typeof o.changed !== 'object') return null;
  const changed = {};
  for (const [k] of GROUND_PARTS) if (Object.prototype.hasOwnProperty.call(o.changed, k)) changed[k] = clip(o.changed[k] || '');
  return changed;
}

/* what rides, in his notebook's voice — his own correction as he wrote it */
export function groundWords(ground) {
  if (!ground || typeof ground !== 'object') return '';
  if (typeof ground.words === 'string' && ground.words.trim()) return ground.words.trim();
  const parts = ground.parts && typeof ground.parts === 'object' ? ground.parts : {};
  const lines = GROUND_PARTS.filter(([k]) => parts[k]).map(([k, label]) => label + ' — ' + parts[k]);
  return lines.length ? ['The world of our story, as it stands:', ...lines].join('\n') : '';
}

/* build it, or look at it again when the record grew; his own correction is never overwritten unless he asked (force) */
export async function runGround({ connection, have = null, input = {}, recordLines = 0, force = false, signal } = {}) {
  if (!connection) return { wrote: false, why: 'no connection' };
  if (have && have.by === 'writer' && !force) return { wrote: false, why: 'his own words stand' };
  /* M526: THE STORY WENT BACK. Pages taken back (a rewind, a deleted page, a swipe that undid a fold) leave the record
   * covering fewer pages than the world was last looked at — the world may hold what those pages did. It is written
   * again from the story as it now stands (never his own words). */
  const rolledBack = Boolean(have && have.parts && Number.isFinite(have.recordLines) && recordLines < have.recordLines);
  const fresh = !have || !have.parts || force || rolledBack;
  if (!fresh && recordLines - (Number(have.recordLines) || 0) < GROUND_EVERY && !input.arcChanged && !input.startChanged && !input.briefChanged && !input.recordChanged) return { wrote: false, why: 'the world has not moved' }; /* M528: or a page it was built from was rewritten */ /* M518-2: his brief changed — the world looks again, so it never repeats or contradicts what he just wrote */
  const ask = fresh ? groundAsk(input) : groundUpdateAsk({ ground: have, ...input });
  let text = '';
  try { ({ text } = await callWorker(connection, { system: withFictionFrame(ask.system), user: ask.user, maxTokens: 2200, signal })); } catch (err) { throw err; }
  if (fresh) {
    const parts = readGround(text);
    if (!parts) return { wrote: false, why: 'its answer could not be used' };
    return { wrote: true, ground: { parts, recordLines, arcTitle: (input.arc && input.arc.title) || '', start: input.startFingerprint || '', briefFp: input.briefFingerprint || '', recordPrint: input.recordPrint || '', by: 'helper', at: Date.now() } };
  }
  const changed = readGroundPatch(text);
  if (!changed) return { wrote: false, why: 'its answer could not be used' };
  const parts = fit({ ...have.parts, ...changed });
  const moved = Object.keys(changed).some((k) => (have.parts[k] || '') !== (parts[k] || ''));
  return { wrote: true, changed: moved, ground: { ...have, parts, recordLines, arcTitle: (input.arc && input.arc.title) || have.arcTitle || '', start: input.startFingerprint || have.start || '', briefFp: input.briefFingerprint || '', recordPrint: input.recordPrint || '', at: Date.now() } };
}

/* M517: with the world in the brief's seat, canon's per-page note stops repeating the story's position in canon (its
 * summary is one of the world's sources) — the rest of the note stands: the people on screen, his pinned words, what the
 * wiki does not know. The legacy switch keeps the note whole. A note the extension shaped differently is left as it is. */
export function canonWithoutWorld(note) {
  const text = String(note || '');
  if (!/^Where our story is — /m.test(text)) return text;
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^Where our story is — /.test(lines[i])) {
      if (i + 1 < lines.length && /^\((?:Only events up to this point|The story is at the START of this arc)/.test(lines[i + 1])) i += 1;
      continue;
    }
    out.push(lines[i]);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
