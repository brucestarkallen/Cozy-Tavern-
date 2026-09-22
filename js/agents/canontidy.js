/* Cozy Tavern — js/agents/canontidy.js
 * M388: THE OLD PAGES STOP REPEATING CANON.
 *
 * M387 divided who says what: what the series says of a canon person rides in canon's own section; what THIS story
 * made of them lives on their page. Pages written before it still carry the record — "Rukia Kuchiki, a Shinigami of
 * the Gotei 13 and Byakuya's adopted sister; petite, black hair, violet eyes; stern and proud" — and the storyteller
 * read it twice on every page she was in. The writer asked what "left alone" meant; the honest answer was that the
 * house could tell his own words from a reader's (M263's hand mark, field by field) and had simply not done the work.
 * So, once for each page that repeats it:
 *   - only with canon verification on, only for someone canon knows, only a core no hand wrote (his is his);
 *   - a worker takes the record out and keeps everything the story made of them;
 *   - IN CODE, not on trust: nothing may be ADDED (every word of the new core was in the old one) and nothing of the
 *     story may be LOST (every word of the old core that the record does not say is still there) — an answer that
 *     breaks either is refused and the page stays as it was;
 *   - journaled like any change ("What changed and why" takes it back); each core is asked about once — a memo in the
 *     story's canon memory, by the core's own words, so a core written afresh is looked at afresh. */
import { callWorker } from './call.js';
import { balancedCandidates, parseLenient } from './jsonutil.js';
import { withFictionFrame } from './voice.js';
import { loadState, saveState, notify } from '../engine/state.js';
import { applyMutations } from '../engine/apply.js';
import { isMc } from '../engine/people.js';
import { canonEntryFor } from '../canon/bridge.js';

const MAX_TOKENS = 4000;
const BATCH = 6;
const FENCE = '"' + '"' + '"';
const MEMO = 'cozy_canon_tidied';

/* the small words that say nothing of anyone — never counted either way */
const LITTLE = new Set(('the and but with for from her his its their she him they them who whom whose has have had was were are '
  + 'not this that these those into onto over under very still just also only when then than what where which while after '
  + 'before about around between because being been one ever never always often any some all each most more much many '
  + 'own same such too can could would should will shall may might must does did doing done yet nor per via upon out off '
  + 'here there now how why our your you yours ours hers theirs himself herself itself themselves').split(/\s+/));

const words = (text) => String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !LITTLE.has(w));

/* every word the series says of them (the page, the curated dossier) */
function recordWords(entry) {
  const s = entry && entry.sections && typeof entry.sections === 'object' ? entry.sections : {};
  const d = entry && entry.dossier && typeof entry.dossier === 'object' ? entry.dossier : {};
  const text = [s.identity, s.physical, s.look, s.personality, s.relationship, s.biography, s.abilities, s.trivia,
    d.identity, d.brief, ...(Array.isArray(d.facts) ? d.facts : []), ...(Array.isArray(d.abilities) ? d.abilities : [])].filter(Boolean).join(' ');
  return new Set(words(text));
}

/* the record, as the worker is shown it */
function recordText(entry) {
  const s = entry.sections || {};
  const d = entry.dossier && typeof entry.dossier === 'object' ? entry.dossier : {};
  return [d.identity || s.identity, s.physical, s.look, s.personality, s.relationship, ...(Array.isArray(d.facts) ? d.facts.slice(0, 6) : [])]
    .filter(Boolean).map((t) => String(t).replace(/\s+/g, ' ').trim()).join(' | ').slice(0, 1600);
}

/* a core's own words, as the memo knows it */
function coreKey(core) {
  let h = 5381;
  const s = String(core || '');
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return s.length + ':' + h.toString(36);
}

/* The pages that repeat the record, for one ledger and its canon memory: someone canon knows, a core no hand wrote, at
 * least four of its words and two in five of them the series' own — and not already asked about in these words. */
export function canonRepeats(state, meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const cache = m.canon_grounding_cache && typeof m.canon_grounding_cache === 'object' ? m.canon_grounding_cache : {};
  const memo = m[MEMO] && typeof m[MEMO] === 'object' ? m[MEMO] : {};
  const chars = state && state.characters && typeof state.characters === 'object' ? state.characters : {};
  const names = Object.keys(chars);
  const out = [];
  for (const [name, c] of Object.entries(chars)) {
    if (!c || typeof c !== 'object' || c.retired || isMc(state, name)) continue;
    const core = typeof c.core === 'string' ? c.core.trim() : '';
    if (!core || (c.hand && c.hand.core)) continue;
    if (memo[name] === coreKey(core)) continue;
    const hit = canonEntryFor(cache, name, names);
    if (!hit) continue;
    const own = new Set([...words(name), ...words(hit.entry.name), ...(hit.entry.aliases || []).flatMap(words)]);
    const mine = [...new Set(words(core))].filter((w) => !own.has(w));
    if (!mine.length) continue;
    const rec = recordWords(hit.entry);
    const shared = mine.filter((w) => rec.has(w));
    if (shared.length >= 4 && shared.length / mine.length >= 0.4) out.push({ name, core, record: recordText(hit.entry), entry: hit.entry });
  }
  return out;
}

/* The answer holds the page, or the page stays: nothing added, nothing of the story lost, shorter than it was. */
export function cleanCoreHolds(oldCore, newCore, entry, name) {
  const next = String(newCore || '').trim();
  if (!next || next === String(oldCore || '').trim() || next.length >= String(oldCore || '').trim().length) return { ok: false, why: 'nothing taken out' };
  const before = new Set(words(oldCore));
  const after = new Set(words(next));
  const added = [...after].filter((w) => !before.has(w));
  if (added.length) return { ok: false, why: 'it added words the page never had (' + added.slice(0, 4).join(', ') + ')' };
  const own = new Set([...words(name), ...words(entry && entry.name), ...((entry && entry.aliases) || []).flatMap(words)]);
  const rec = recordWords(entry);
  const story = [...before].filter((w) => !rec.has(w) && !own.has(w));
  const lost = story.filter((w) => !after.has(w));
  if (lost.length) return { ok: false, why: 'it dropped what the story made of them (' + lost.slice(0, 4).join(', ') + ')' };
  return { ok: true };
}

export function buildCanonTidyMessages(items) {
  const system = withFictionFrame([
    'You tidy character pages of a story. For each person below you get what the series itself says of them (THE',
    'RECORD) and their page\'s core (who they are, as the page has it). The storyteller already reads the record on',
    'every page they are in, so the page must not repeat it: write the core again WITHOUT what the record says —',
    'their canon role, family, looks, nature — and KEEP, word for word where you can, everything this story has made',
    'of them (how they stand with the other people here, what happened between them in this story, where this story',
    'departs from the record). Use only words the old core already has; add nothing. If nothing but the record is',
    'there, keep the fewest of its words that say who they are to this story. Never leave a core empty.',
    'Answer with JSON only: {"pages":[{"name":"<name exactly as given>","core":"<the core, rewritten>"}]}',
  ].join('\n'));
  const user = items.map((it) => [
    'PERSON: ' + it.name,
    'THE RECORD:', FENCE, it.record, FENCE,
    'THE PAGE\'S CORE NOW:', FENCE, it.core, FENCE,
  ].join('\n')).join('\n\n') + '\n\nThe cores again, without the record. JSON only.';
  return { system, user };
}

export function parseCanonTidy(raw) {
  try {
    const text = String(raw || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/```(?:json|JSON)?/g, '');
    for (const c of balancedCandidates(text, 5)) {
      const p = parseLenient(c);
      if (p && Array.isArray(p.pages)) {
        return p.pages.filter((x) => x && typeof x.name === 'string' && typeof x.core === 'string' && x.name.trim() && x.core.trim())
          .map((x) => ({ name: x.name.trim(), core: x.core.trim() }));
      }
    }
  } catch (err) { /* unreadable: nothing */ }
  return null;
}

/* Clean the pages that repeat the record, once each. `meta` is the story's live canon memory (the memo is kept there);
 * `keepMemo` keeps it. Returns {applied, refused, asked, failed} — or null when the story moved on underneath it. */
export async function canonTidyPeople({ connection, storyId, meta, keepMemo = async () => {}, signal, stale = () => false, renew } = {}) {
  if (!connection || !storyId || !meta) return null;
  const start = await loadState(storyId);
  const due = canonRepeats(start, meta);
  if (!due.length) return { applied: [], refused: [], asked: 0, failed: 0 };
  const answers = [];
  let failed = 0;
  for (let i = 0; i < due.length; i += BATCH) {
    if (stale()) return null;
    const batch = due.slice(i, i + BATCH);
    const prompt = buildCanonTidyMessages(batch);
    if (typeof renew === 'function') renew();
    let read = null;
    try {
      const res = await callWorker(connection, { system: prompt.system, user: prompt.user, maxTokens: MAX_TOKENS, signal });
      read = parseCanonTidy(res && res.text);
    } catch (err) {
      if (err && (err.name === 'AbortError' || (signal && signal.aborted))) return null;
      throw err;
    }
    if (!read) { failed += 1; continue; }
    answers.push(...read);
  }
  if (stale()) return null;
  /* judged against the page as it stands now — a reader may have written it while this one read */
  const fresh = await loadState(storyId);
  const memo = meta[MEMO] && typeof meta[MEMO] === 'object' ? meta[MEMO] : {};
  const changes = [];
  const refused = [];
  for (const item of due) {
    const a = answers.find((x) => x.name.toLowerCase() === item.name.toLowerCase());
    const now = fresh.characters && fresh.characters[item.name];
    if (!a || !now || String(now.core || '').trim() !== item.core || (now.hand && now.hand.core)) continue;
    const verdict = cleanCoreHolds(item.core, a.core, item.entry, item.name);
    if (!verdict.ok) { refused.push({ name: item.name, why: verdict.why }); memo[item.name] = coreKey(item.core); continue; }
    changes.push({ type: 'people.set', name: item.name, field: 'core', text: a.core });
    memo[item.name] = coreKey(a.core);
  }
  meta[MEMO] = memo;
  const { state: next, applied } = applyMutations(fresh, changes);
  if (applied.length) {
    if (stale()) return null;
    await saveState(storyId, next);
    notify(storyId);
  }
  try { await keepMemo(); } catch (err) { /* asked again next time */ }
  return { applied, refused, asked: due.length, failed };
}

export function canonTidyWords(r) {
  if (!r) return 'left behind';
  const who = [...new Set(r.applied.map((a) => a.mutation.name))];
  return (who.length
    ? 'took what the series already says out of ' + who.length + (who.length === 1 ? ' page' : ' pages') + ' (' + who.slice(0, 6).join(', ') + (who.length > 6 ? ', …' : '') + ') — what this story made of them stays'
    : 'read the pages that repeated canon; none could be shortened without losing the story')
    + (r.refused.length ? ' — ' + r.refused.length + ' left as they were (' + r.refused.map((x) => x.name + ': ' + x.why).slice(0, 2).join('; ') + ')' : '')
    + (r.failed ? ' — ' + r.failed + (r.failed === 1 ? ' answer' : ' answers') + ' could not be read; asked again next time' : '');
}
