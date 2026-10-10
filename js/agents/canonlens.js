/* Cozy Tavern — js/agents/canonlens.js
 * M392: CANON THROUGH HIS STORY.
 *
 * His Bleach story: Oda is the new captain of the 13th Division, Rukia his lieutenant (she had expected the captaincy),
 * and she has not married Renji. The wiki describes canon's END — "She is the current Captain of the 13th Division …
 * married to Renji Abarai … a daughter named Ichika" — and canon verification handed that to the storyteller as fact,
 * every page. A storyteller told she is married cannot let his MC grow close to her; told she is captain, it argues with
 * his premise. He asked for canon's context kept, but never as current fact and never as prophecy.
 *
 * So, once per canon person per premise, a worker reads HIS STORY (the brief, the cast notes, his canon notes for this
 * story and for every story, where the story stands in canon) and every canon statement about who they are — identity,
 * brief, facts, secrets, dynamics, the per-pair lines, the fallback's identity/relationship/biography — and says of each:
 *   holds   — true in this story too (her origins, her sister, her sword, her modesty) — it rides;
 *   changed — this story says otherwise (the captaincy, the marriage) — it is not said at all;
 *   later   — a canon event or state this story has not reached or established (a rank, a marriage, a child, a death,
 *             an alliance) — not a fact here and not destined — not said at all.
 * A statement that only partly holds may be KEPT IN PART — in its own words only, checked in code (no word it did not
 * have). Canon's own memory stays canon (the extension's cache); the lens is this story's, kept in its canon memory
 * (cozy_lens) and applied where the note is written (Canon Grounding v0.67.0's host lens), where the workers are handed
 * the record, and in the room — which shows what was held back, and why. */
import { lengthKey } from '../engine/fingerprint.js'; /* M575 */
import { callWorker } from './call.js';
import { balancedCandidates, parseLenient } from './jsonutil.js';
import { withFictionFrame } from './voice.js';

const MAX_TOKENS = 3000;
const FENCE = '"' + '"' + '"';
export const LENS_KEY = 'cozy_lens';

const clip = (t, n) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const sentences = (t) => String(t || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/).map((x) => x.trim()).filter(Boolean);
const words = (t) => new Set(String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2));
function hash(s) { return lengthKey(String(s || '')); } /* M575: one fingerprint */

/* Every canon statement about who this person is — what the note (and the workers' record) could say of them. */
export function lensStatements(entry) {
  const out = [];
  if (!entry || typeof entry !== 'object') return out;
  const d = entry.dossier && typeof entry.dossier === 'object' ? entry.dossier : null;
  const s = entry.sections && typeof entry.sections === 'object' ? entry.sections : {};
  const add = (field, key, text) => { const t = clip(text, 500); if (t) out.push({ n: out.length + 1, field, key, text: t }); };
  if (d) {
    if (d.identity) add('identity', null, d.identity);
    sentences(d.brief).forEach((t, i) => add('brief', i, t));
    (Array.isArray(d.facts) ? d.facts : []).forEach((t, i) => add('facts', i, t));
    (Array.isArray(d.secrets) ? d.secrets : []).forEach((t, i) => add('secrets', i, t));
    if (d.dynamics && typeof d.dynamics === 'object') for (const [who, t] of Object.entries(d.dynamics)) add('dynamics', who, t);
    /* M394: powers and the world around them are timeline too ("Ōken Clothing" from the last arc; the 13th Division's
     * why, "her current captaincy") */
    (Array.isArray(d.abilities) ? d.abilities : []).forEach((t, i) => add('abilities', i, t));
    (Array.isArray(d.related) ? d.related : []).forEach((r, i) => { if (r && r.name && r.why) add('related', i, r.name + ': ' + r.why); });
  }
  for (const f of ['identity', 'relationship', 'biography']) sentences(s[f]).forEach((t, i) => add('s.' + f, i, t));
  if (entry.rel && typeof entry.rel === 'object') for (const [who, t] of Object.entries(entry.rel)) if (t) add('pairs', who, t);
  /* M681 — THE FACE IS READ THROUGH HIS STORY TOO (the people audit's P8). The face was never a statement here, so the
   * series' hair, eyes, build and its Appearance prose went into "What's true of them" (bridge.js canonLocks) and into the
   * note's Appearance line exactly as the wiki's END has them — the captain's haori of a rank his story never gave her,
   * the look his canon notes changed — while every other word canon says of her was judged first. Each feature ("hair:
   * black") and each sentence of the look is one statement, judged like the rest; the overlay carries what holds, and
   * every reader of a face (the ledger's locks, the note, the room's card) reads it through the lens. */
  physicalParts(s.physical).forEach((t, i) => add('s.physical', i, t));
  sentences(s.look).forEach((t, i) => add('s.look', i, t));
  return out;
}

/* The extension's own "physical" line ("hair: …; eyes: …; notably: …"), feature by feature — a ";" splits only before
 * the next "label:". One reading for the lens and for the ledger's locks (bridge.js canonFeatures). */
export function physicalParts(physical) {
  return String(typeof physical === 'string' ? physical : '').split(/;\s*(?=[A-Za-z][\w ()'-]{0,40}:)/).map((p) => p.trim()).filter(Boolean);
}

/* What canon says of them, as a fingerprint — a lens is for these words only */
const printOf = (statements) => hash(statements.map((x) => x.field + '|' + x.key + '|' + x.text).join('\n'));
export function lensFingerprint(entry) {
  return printOf(lensStatements(entry));
}
/* M681: the same words without the face — the fingerprint every lens made before the face was judged carries. Such a lens
 * still applies to the words it judged (it is not current, so it is asked again, face and all): with every lens of every
 * story gone stale at once, the next page's note would have ridden on canon's END — the marriage, the captaincy — for
 * every person whose new lens was not back within the page's wait. */
const FACE_FIELDS = new Set(['s.physical', 's.look']);
function heldFor(meta, entry) {
  const store = meta && meta[LENS_KEY] && typeof meta[LENS_KEY] === 'object' ? meta[LENS_KEY] : {};
  const held = store[nameKey(entry)];
  if (!held || (held.fp !== lensFingerprint(entry) && held.fp !== printOf(lensStatements(entry).filter((x) => !FACE_FIELDS.has(x.field))))) return null;
  return held;
}

/* His story, as the lens reads it: the brief, the cast notes, his canon notes (this story's and every story's), and
 * where the story stands in canon. The judge of what holds. */
export function premiseOf(story, meta, { globalNotes = '' } = {}) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const arc = m.canon_grounding_arc && typeof m.canon_grounding_arc === 'object' && m.canon_grounding_arc.title ? m.canon_grounding_arc : null;
  return [
    String((story && story.brief) || '').trim(),
    String((story && story.castNotes) || '').trim(),
    typeof m.canon_grounding_pin === 'string' ? m.canon_grounding_pin.trim() : '',
    String(globalNotes || '').trim(),
    arc ? 'Where the story stands in canon: ' + arc.title + (arc.mode === 'begun' ? ' (just beginning)' : '') : '',
  ].filter(Boolean).join('\n\n');
}

/* M393: A STORY WITH NOTHING WRITTEN IS STILL ITS OWN STORY. With no premise at all the lens used to stand down and
 * canon's END rode as fact — the opposite of his law (canon's later states are never assumed). The lens now always
 * reads; when he has written nothing, this is what it reads. */
export const NO_PREMISE = 'The writer has written no premise for this story: the story is only what its own pages show, and nothing of canon\u2019s later states (a rank or title, a marriage, a child, a death, an alliance) is established in it.';
export function lensPremise(story, meta, opts = {}) {
  return premiseOf(story, meta, opts) || NO_PREMISE;
}

export function lensKey(entry, premise) { return lensFingerprint(entry) + '|' + hash(premise); }

const nameKey = (entry) => String((entry && entry.name) || '').trim().toLowerCase();

/* The lens this story holds for this person — only for the canon words it was made from (a page looked up again is
 * lensed again). A lens made under an older premise still applies until the new one lands: better his last word than
 * none. */
export function overlayFor(meta, entry) {
  const held = heldFor(meta, entry);
  return held && held.overlay ? held.overlay : null;
}
export function lensHeld(meta, entry) {
  const held = heldFor(meta, entry);
  return held && Array.isArray(held.held) ? held.held : [];
}
export function lensCurrent(meta, entry, premise) {
  const store = meta && meta[LENS_KEY] && typeof meta[LENS_KEY] === 'object' ? meta[LENS_KEY] : {};
  const held = store[nameKey(entry)];
  return Boolean(held && held.key === lensKey(entry, premise));
}

/* The same person, seen through an overlay — for the workers' record and the room (the note's own is the extension's) */
export function throughLens(entry, overlay) {
  if (!overlay || !entry) return entry;
  const e = { ...entry };
  if (entry.dossier) {
    const d = { ...entry.dossier };
    for (const k of ['identity', 'brief', 'facts', 'secrets', 'dynamics', 'abilities', 'related']) if (overlay[k] !== undefined) d[k] = overlay[k];
    e.dossier = d;
  }
  if (overlay.sections && entry.sections) e.sections = { ...entry.sections, ...overlay.sections };
  if (overlay.pairs) e.rel = { ...(entry.rel || {}), ...overlay.pairs };
  return e;
}

/* M394: the canon people of this ledger (everyone here, every page's person) that have no lens for this premise yet */
export function lensDueIn(meta, names, premise, match) {
  const cache = meta && meta.canon_grounding_cache && typeof meta.canon_grounding_cache === 'object' ? meta.canon_grounding_cache : {};
  const out = [];
  const seen = new Set();
  for (const n of (Array.isArray(names) ? names : [])) {
    const hit = typeof match === 'function' ? match(cache, n, names) : null;
    if (!hit || !hit.entry || !hit.entry.found || hit.entry.kind === 'place' || seen.has(hit.key)) continue;
    seen.add(hit.key);
    if (!lensCurrent(meta, hit.entry, premise) && lensStatements(hit.entry).length) out.push(hit.entry);
  }
  return out;
}

export function buildLensMessages(entry, statements, premise) {
  const system = withFictionFrame([
    'You keep a canon character true to ONE story. THE STORY is the writer\'s own premise: where it and canon differ, the',
    'story is right. Canon is a timeline, and what you are shown is canon\'s END (the wiki\'s present). For every numbered',
    'statement about the character, say whether it is true IN THIS STORY:',
    '  "holds"   — true here too (who they are, their past before the story, their family of origin, powers, nature, tastes,',
    '              their looks);', /* M681: the face is a statement now too — it holds unless his story changed it or has not reached it */
    '  "changed" — the story says otherwise, outright or by plain implication (another holds the post; a marriage that',
    '              did not happen; a relationship the story made different);',
    '  "later"   — a canon event or state this story has NOT reached or established — a rank or title, a marriage, a',
    '              child, a death, an alliance, a betrayal, a move — never a fact here, and never destined.',
    'When only part of a statement holds, add "keep": that part in the statement\'s OWN words (cut, never add or change',
    'a word). SILENCE IS NOT ESTABLISHMENT: a rank or title, a marriage, a child, a death or an alliance holds only where',
    'the story itself establishes it (or plainly sets itself where canon had it). Anything else the story is silent on holds.',
    'Answer with JSON only: {"verdicts":[{"n":1,"verdict":"holds"},{"n":2,"verdict":"changed","keep":"<the part that holds>"}]}',
  ].join('\n'));
  const user = [
    'THE STORY:', FENCE, clip(premise, 6000), FENCE, '',
    'WHAT CANON SAYS OF ' + String(entry.name || '').toUpperCase() + ':',
    ...statements.map((x) => x.n + '. ' + x.text),
    '', 'Every statement, judged. JSON only.',
  ].join('\n');
  return { system, user };
}

export function parseLens(raw) {
  try {
    const text = String(raw || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/```(?:json|JSON)?/g, '');
    for (const c of balancedCandidates(text, 5)) {
      const p = parseLenient(c);
      if (p && Array.isArray(p.verdicts)) {
        /* M659: A VERDICT IS READ AS A MODEL WRITES IT. It had to be exactly "holds" / "changed" / "later" and its number a
         * bare number: "Holds", "holds.", "changed (he was promoted later)", "statement 3" were no verdict at all — and a
         * statement with no verdict is held back from the storyteller and the lens asked again (M607), page after page. */
        const numberOf = (n) => (typeof n === 'number' ? n : Number((String(n == null ? '' : n).match(/\d+/) || [NaN])[0]));
        const verdictOf = (t) => ((String(t || '').trim().toLowerCase().match(/^(holds|changed|later)\b/) || [])[1] || '');
        return p.verdicts.filter((v) => v && Number.isInteger(numberOf(v.n)) && verdictOf(v.verdict))
          .map((v) => ({ n: numberOf(v.n), verdict: verdictOf(v.verdict), keep: typeof v.keep === 'string' ? v.keep.trim() : '' }));
      }
    }
  } catch (err) { /* unreadable */ }
  return null;
}

/* A kept part is the statement's own words — nothing it did not say. */
export function keepHolds(statement, keep) {
  const k = String(keep || '').trim();
  if (!k || k.length >= String(statement || '').length) return false;
  const mine = words(statement);
  return [...words(k)].every((w) => mine.has(w));
}

/* The overlay the verdicts make, and what was held back (and why). A statement with no verdict holds. */
export function overlayFrom(entry, statements, verdicts) {
  const by = new Map((verdicts || []).map((v) => [v.n, v]));
  const held = [];
  let unjudged = 0;
  const kept = statements.map((x) => {
    const v = by.get(x.n);
    if (v && v.verdict === 'holds') return { ...x, out: x.text };
    /* M607: A STATEMENT THE ANSWER NEVER JUDGED IS HELD BACK, NOT PASSED. It rode as "holds" — so a long dossier answered
     * in part let canon's later states through (a rank not reached, a marriage his story never made), and the lens was
     * kept as read for good. What it did not judge is silent until it is judged; the lens is asked again. */
    if (!v) { unjudged += 1; held.push({ text: x.text, why: 'unjudged' }); return { ...x, out: '' }; }
    const part = keepHolds(x.text, v.keep) ? v.keep : '';
    held.push({ text: x.text, why: v.verdict, ...(part ? { kept: part } : {}) });
    return { ...x, out: part };
  });
  const of = (field) => kept.filter((x) => x.field === field);
  const overlay = {};
  const d = entry.dossier && typeof entry.dossier === 'object' ? entry.dossier : null;
  if (d) {
    if (d.identity !== undefined) overlay.identity = (of('identity')[0] || { out: '' }).out;
    if (d.brief !== undefined) overlay.brief = of('brief').map((x) => x.out).filter(Boolean).join(' ');
    if (Array.isArray(d.facts)) overlay.facts = of('facts').map((x) => x.out).filter(Boolean);
    if (Array.isArray(d.secrets)) overlay.secrets = of('secrets').map((x) => x.out).filter(Boolean);
    if (d.dynamics && typeof d.dynamics === 'object') overlay.dynamics = Object.fromEntries(of('dynamics').filter((x) => x.out).map((x) => [x.key, x.out]));
    if (Array.isArray(d.abilities)) overlay.abilities = of('abilities').map((x) => x.out).filter(Boolean);
    /* the world around them stays (the 13th is still hers to serve in); only a why his story changed goes */
    if (Array.isArray(d.related)) {
      overlay.related = d.related.map((r, i) => {
        const x = of('related').find((y) => y.key === i);
        if (!x) return r;
        const why = x.out ? String(x.out).replace(new RegExp('^' + String(r.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\s*'), '') : '';
        return { ...r, why };
      });
    }
  }
  const s = entry.sections && typeof entry.sections === 'object' ? entry.sections : null;
  if (s) {
    const sec = {};
    for (const f of ['identity', 'relationship', 'biography', 'look']) if (s[f]) sec[f] = of('s.' + f).map((x) => x.out).filter(Boolean).join(' ');
    if (s.physical) sec.physical = of('s.physical').map((x) => x.out).filter(Boolean).join('; '); /* M681: the features that hold, as the extension writes them */
    if (Object.keys(sec).length) overlay.sections = sec;
  }
  if (entry.rel && typeof entry.rel === 'object') overlay.pairs = Object.fromEntries(Object.keys(entry.rel).map((who) => [who, ((of('pairs').find((x) => x.key === who)) || { out: '' }).out]));
  return { overlay, held, unjudged };
}

/* Lens these people for this story, now: one worker call each (at most `parallel` at once), each held to `deadlineMs`.
 * Answers that come back after the deadline still land in the story's canon memory for the next page. Returns the
 * names lensed in time. */
export async function lensPeople({ connection, meta, entries, premise, deadlineMs = 15000, parallel = 4, onKept } = {}) {
  if (!connection || !meta || !Array.isArray(entries) || !entries.length || !String(premise || '').trim()) return [];
  const store = meta[LENS_KEY] && typeof meta[LENS_KEY] === 'object' ? meta[LENS_KEY] : (meta[LENS_KEY] = {});
  const done = [];
  const one = async (entry) => {
    const statements = lensStatements(entry);
    if (!statements.length) return;
    const prompt = buildLensMessages(entry, statements, premise);
    let res = null;
    try { res = await callWorker(connection, { system: prompt.system, user: prompt.user, maxTokens: MAX_TOKENS }); } catch (err) { return; }
    const verdicts = parseLens(res && res.text);
    if (!verdicts) return;
    const { overlay, held, unjudged } = overlayFrom(entry, statements, verdicts);
    /* M607: a lens with a statement left unjudged is kept (what it judged applies, the rest held back) but never current —
     * the next canon turn asks it again whole */
    store[nameKey(entry)] = { fp: lensFingerprint(entry), key: unjudged ? '' : lensKey(entry, premise), overlay, held, at: Date.now() };
    done.push(entry.name);
    if (typeof onKept === 'function') { try { await onKept(); } catch (err) { /* kept on the next save */ } }
  };
  const queue = entries.slice();
  const workers = Array.from({ length: Math.max(1, Math.min(parallel, queue.length)) }, async () => {
    while (queue.length) await one(queue.shift());
  });
  await Promise.race([Promise.all(workers), new Promise((r) => setTimeout(r, deadlineMs))]);
  return done.slice();
}
