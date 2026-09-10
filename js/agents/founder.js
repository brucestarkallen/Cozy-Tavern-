/* Cozy Tavern — agents/founder.js
 * M45: the founder — the ledger from the ground up.
 *
 * Until M45 the ledger was founded from the first PAGE: place, who was in
 * the scene, the hour. Everything the writer had already established — the
 * brief, the cast notes, the invited character cards, the lore shelf — rode
 * to the storyteller every turn but never became ledger: no character
 * page for a person the brief names, no standing the brief sets ("she has
 * loved him since school"), no canon lock for a stated appearance, no
 * faction, no seat for the rival the brief puts across town with an
 * agenda, no thread for the premise's live want. The world agent and the
 * auditor read the brief as context, but a ledger that starts empty is a
 * ledger the first pages have to rebuild from nothing.
 *
 * The founder reads all of it and writes the world into the ledger through
 * the closed vocabulary — validated, logged, take-back-able — BEFORE the
 * first page is read (the extractor then founds the scene on top of it).
 * It runs again when the brief, the cast notes, the cards or the lore
 * change (a fingerprint on state.founded), and by hand from the drawer.
 *
 *   foundWorld({connection, storyId, brief, castNotes, cast, lore, signal, stale})
 *     -> {applied, rejected, note} | null when there is nothing to found from
 */

import { db } from '../store.js';
import { callWorker } from './call.js';
import { balancedCandidates, parseLenient } from './jsonutil.js';
import { withFictionFrame } from './voice.js';
import { loadState, saveState, notify, renderStateFacts } from '../engine/state.js';
import { applyMutations } from '../engine/apply.js';
import { mcName } from '../engine/duels.js';

const MAX_TOKENS = 6000;

const VOCABULARY = [
  'mc.set {"type":"mc.set","name":"Jovan"} — the main character, when the brief makes it plain and the ledger does not know',
  'people.set {"type":"people.set","name":"Aurora","field":"core","text":"Jovan\'s childhood friend; lives next door; ex-idol; reads rooms performatively"} — one core per named person the brief, the cast notes, the cards or the lore establish (never the main character\'s core or arc); field "arc" for how they stand with the main character when stated; field "state" for where they are in their life now when stated',
  'rel.set {"type":"rel.set","name":"Aurora","p":40,"r":25,"s":10,"cause":"the brief says Aurora has loved Jovan since school"} — a standing is how a person stands TOWARD THE MAIN CHARACTER and nothing else (AXIS LOCK): only when the brief states a bond or history between that person and the main character, and the cause names the main character. A person who has never met the main character has no standing (zero, no line). Feelings toward ANYONE ELSE (a crush on Rias, a grudge against Kris) are NOT standings — they go in that person\'s page (core or arc) as words',
  'canon.lock {"type":"canon.lock","name":"Aurora","key":"hair","value":"black, waist-length"} — the five canonical features (hair, eyes, build, height, skin tone) and scars when stated; one lock per fact',
  'faction.set {"type":"faction.set","name":"the studio","stance":"…","agenda":"…"} — every group the brief gives a stance or an agenda',
  'offscreen.set {"type":"offscreen.set","name":"Kris","location":"…","activity":"…","agenda":"…","stance":"waiting|toward|seeking|tense|busy"} — where the brief places a named person who is NOT in the opening scene',
  'thread.set {"type":"thread.set","title":"…","owner":"…","heat":"hot|cold","next":"…"} — the premise\'s live agendas: who wants what, pushing toward the main character',
  'knowledge.add {"type":"knowledge.add","name":"Aurora","fact":"…"} — what the brief says a person KNOWS (a secret they hold, a thing they witnessed) — and nothing the brief seals from them',
].join('\n');

/* M46: the scene is the extractor's. The founder founds the WORLD — never the
 * scene's ground, hour, presence or mood (it set "the scene now stands in"
 * once per place the brief mentioned). */
export const NOT_THE_FOUNDERS = new Set(['place.set', 'clock.set', 'clock.advance', 'presence.enter', 'presence.leave', 'presence.update', 'mode.set', 'mode.clear', 'body.injure', 'body.strain', 'body.heal', 'combat.begin', 'combat.end']);

function law({ mc }) {
  return [
    'You found the ledger for a slow story told between two writers. The writer has written what the',
    'world is before a single page exists: a brief, notes on the cast, character cards, a shelf of lore.',
    'Your job is to turn what is STATED there into the ledger — the house\'s memory — so the story begins',
    'with the world already standing: every named person with a page, every stated bond as a standing,',
    'every stated appearance locked, every group as a faction, everyone placed where the brief puts',
    'them, the premise\'s live wants as threads, and what each person knows or is sealed from knowing.',
    mc ? `The main character is ${mc}.` : 'The main character is the one the writer will play; if the brief makes that plain, name them with mc.set.',
    '',
    'Laws:',
    '  - STATED, NEVER INVENTED. Write down what the material says; where it is silent, write nothing —',
    '    the story will invent as it goes. A page needs at least a core; give it the substance (role,',
    '    relation to the main character, what they want, what they are like), compact.',
    '  - THE REAL RECORD: a real person or a character from an established canon is written from the',
    '    real record — true name, family, role — unless the brief says otherwise.',
    '  - SEALED IS SEALED: what the brief says nobody knows, or a person does not know, gets no',
    '    knowledge line for that person. Public records are what people work from.',
    '  - AXIS LOCK: a standing (rel.set) exists ONLY from a person toward the main character. Before any',
    '    rel.set ask: does the brief establish that THIS person and THE MAIN CHARACTER have a bond or a',
    '    history? No → no standing (they start at zero, exactly as strangers do). A feeling toward anyone',
    '    else — a crush on the sister, an ex\'s possessiveness, a rivalry — is written into that person\'s',
    '    page as words, never as numbers. A standing whose cause names another person is refused.',
    '  - The main character gets no page of their own beyond mc.set: their state and threads are the',
    '    story\'s to write.',
    '  - Do not narrate, do not summarize the brief. The SCENE is not yours: no place.set, no',
    '    clock.set, no presence, no mood — the extractor founds the scene from the first page. A',
    '    place the brief mentions is world; it needs no line. Found the WORLD: people, bonds,',
    '    appearances, factions, seats, threads, knowledge.',
    '',
    'Answer with JSON ONLY: {"mutations":[ ... ]}',
    'The only mutations that exist:',
    VOCABULARY,
    '',
    'Names keep the spelling the material uses. No commentary, no fences: the JSON only.',
  ].join('\n');
}

const FENCE = '"""';

/* M50: standings the writer states in digits, read the way the writer's
 * briefs are shaped — the M49 parser took the line's head as the person
 * and assumed every triple was toward the main character, and wrote
 * garbage (a standing for the MC toward himself, NPC-to-NPC numbers as if
 * toward the MC, duplicates). The shape:
 *
 *   Aurora Sterling                          ← a heading: the OWNER
 *   → Jovan: childhood best friend … (P:65 R:30 S:5)   ← toward Jovan
 *   → Vanessa Reynolds: … (P:70 R:0 S:0)                ← toward Vanessa (NPC↔NPC — NOT a standing)
 *   Rias Wells — devoted older sister (P:85 R:65 S:45)  ← no heading: owner is the line's head, toward the MC
 *
 * A line with a target marker (→, ->, "toward", "to") names its target;
 * only a target that IS the main character yields a standing, owned by the
 * nearest heading above (a short line with no digits and no marker). A
 * line with no target marker owns its own standing toward the MC. Arrows,
 * bullets and dashes are stripped from names. Exported for the auditor and
 * the harness. Returns [{name, p, r, s}] toward the MC only. */
const TRIPLE = /P\s*:\s*([+-]?\d+)\s*[,\/|]?\s*R\s*:\s*([+-]?\d+)\s*[,\/|]?\s*S\s*:\s*([+-]?\d+)/i;
const ARROW = /^[\s\-*•>]*(?:→|->|=>|toward|towards|to)\s*/i;
const clean = (x) => String(x || '').replace(/^[\s\-*•→>]+/, '').replace(/[\s:—–-]+$/, '').trim();
function sameName(a, b) {
  const A = clean(a).toLowerCase(); const B = clean(b).toLowerCase();
  if (!A || !B) return false;
  if (A === B) return true;
  const at = A.split(/\s+/); const bt = B.split(/\s+/);
  return at[0] === bt[0] && (at.length === 1 || bt.length === 1 || at.every((t) => bt.includes(t)) || bt.every((t) => at.includes(t)));
}
/* A line's head that is a section label, never a person: ALL CAPS, or one
 * of the words briefs use for sections. Exported for the housekeeping. */
export const LABEL_WORDS = new Set(['core', 'arc', 'state', 'now', 'notes', 'note', 'prs', 'p:r:s', 'standing', 'standings', 'relationship', 'relationships', 'stance', 'bond', 'bonds', 'toward', 'towards', 'mc', 'main character', 'appearance', 'voice', 'history', 'secret', 'secrets', 'goal', 'goals', 'want', 'wants', 'traits', 'personality', 'role']);
export function isLabel(head) {
  const h = String(head || '').trim();
  if (!h) return false;
  if (LABEL_WORDS.has(h.toLowerCase())) return true;
  return /^[A-Z0-9 :\/&'’.-]{2,}$/.test(h) && !/[a-z]/.test(h);
}
export function explicitStandings(text, mc = '') {
  const out = [];
  let owner = '';
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(TRIPLE);
    const hasArrow = ARROW.test(line) && !/^[\s\-*•]*[A-Za-z]/.test(line.replace(ARROW, '')) === false && /^[\s\-*•]*(?:→|->|=>)/.test(line);
    if (!m) {
      /* a heading: short, no digits, no marker, reads like a name */
      const head = clean(line.split(/\s+[—–-]\s+|:/)[0]);
      if (!hasArrow && head && head.length <= 40 && /^[A-Z][A-Za-z'’.\- ]*$/.test(head) && head.split(/\s+/).length <= 4) owner = head;
      continue;
    }
    const clampN = (v) => Math.max(-100, Math.min(100, Number(v)));
    const numbers = { p: clampN(m[1]), r: clampN(m[2]), s: clampN(m[3]) };
    const head = clean(line.replace(ARROW, '').split(/\s+[—–-]\s+|:/)[0]);
    if (hasArrow) {
      /* "→ Target: …": the target must be the main character, the owner the heading above */
      if (!owner || !mc || !sameName(head, mc)) continue;
      out.push({ name: owner, ...numbers });
    } else if (isLabel(head)) {
      /* "CORE: … (P R S)" under a heading: a label is never a person — the heading owns it */
      if (!owner || (mc && sameName(owner, mc))) continue;
      out.push({ name: owner, ...numbers });
    } else {
      /* "Name — … (P R S)": the head owns it, toward the MC — unless the head IS the MC */
      if (!head || (mc && sameName(head, mc))) continue;
      out.push({ name: head, ...numbers });
      owner = head;
    }
  }
  /* dedupe by person, the fuller name kept */
  const merged = [];
  for (const st of out) {
    const at = merged.findIndex((x) => sameName(x.name, st.name));
    if (at === -1) merged.push(st);
    else if (st.name.length > merged[at].name.length) merged[at] = { ...st };
  }
  return merged;
}
export { sameName as samePersonLoose };

export function founderFingerprint({ brief = '', castNotes = '', cast = [], lore = [] } = {}) {
  const parts = [
    String(brief || ''), String(castNotes || ''),
    (Array.isArray(cast) ? cast : []).map((c) => [c.name, c.description, c.personality, c.scenario].join('|')).join('\n'),
    (Array.isArray(lore) ? lore : []).map((e) => [e.name, (e.keys || []).join(','), e.content, e.enabled].join('|')).join('\n'),
  ].join('\n---\n');
  const material = String(brief || '').trim() || String(castNotes || '').trim() || (Array.isArray(cast) && cast.length) || (Array.isArray(lore) && lore.some((e) => e && e.enabled !== false));
  if (!material) return '';
  let h = 5381;
  for (let i = 0; i < parts.length; i += 1) h = ((h * 33) ^ parts.charCodeAt(i)) >>> 0;
  return 'f' + h.toString(36) + '-' + parts.length;
}

/* Exported for the harness. */
export function buildFounderMessages({ state, brief = '', castNotes = '', cast = [], lore = [] }) {
  const known = mcName(state);
  const mc = known && known !== 'the player' ? known : '';
  const cards = (Array.isArray(cast) ? cast : []).map((c) => {
    const bits = [];
    if (c.description) bits.push(String(c.description).slice(0, 3000));
    if (c.personality) bits.push('Personality: ' + String(c.personality).slice(0, 1200));
    if (c.scenario) bits.push('Scenario: ' + String(c.scenario).slice(0, 1200));
    return '## ' + c.name + '\n' + bits.join('\n');
  }).join('\n\n');
  const shelf = (Array.isArray(lore) ? lore : []).filter((e) => e && e.enabled !== false).map((e) => '- ' + (e.name || (e.keys || [])[0] || 'an entry') + ' [' + (e.keys || []).join(', ') + ']: ' + String(e.content || '').slice(0, 800)).join('\n');
  const facts = renderStateFacts(state) || 'Nothing is written in the ledger yet.';
  const user = [
    'THE BRIEF (the writer\'s own words):',
    FENCE, String(brief || '').trim().slice(0, 12000) || '(none written)', FENCE,
    '',
    'THE CAST NOTES (the writer\'s own words):',
    FENCE, String(castNotes || '').trim().slice(0, 6000) || '(none written)', FENCE,
    '',
    'THE CHARACTER CARDS INVITED TO THIS STORY:',
    FENCE, cards || '(none)', FENCE,
    '',
    'THE LORE SHELF:',
    FENCE, shelf.slice(0, 12000) || '(empty)', FENCE,
    '',
    'WHAT THE LEDGER ALREADY SAYS (found once before; write only what it lacks or gets wrong):',
    facts,
    '',
    'Found the world. JSON only.',
  ].join('\n');
  return { system: withFictionFrame(law({ mc })), user, hasMaterial: Boolean(String(brief || '').trim() || String(castNotes || '').trim() || cards || shelf) };
}

/* Exported for the harness. */
export function parseFounderAnswer(raw) {
  try {
    let text = String(raw || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/```(?:json|JSON)?/g, '');
    const candidates = balancedCandidates(text, 5);
    let parsed = null;
    for (const c of candidates) { const p = parseLenient(c); if (p && Array.isArray(p.mutations)) { parsed = p; break; } }
    if (!parsed) return { mutations: [], note: 'unusable' };
    const mutations = parsed.mutations.filter((m) => m && typeof m === 'object' && typeof m.type === 'string' && m.type.trim());
    return { mutations, note: mutations.length ? 'ok' : 'empty' };
  } catch (err) {
    return { mutations: [], note: 'unusable' };
  }
}

/* The contract. */
export async function foundWorld({ connection, storyId, brief = '', castNotes = '', cast = [], lore = [], signal, stale } = {}) {
  if (!connection || typeof connection !== 'object' || !storyId) return null;
  const state = await loadState(storyId);
  const prompt = buildFounderMessages({ state, brief, castNotes, cast, lore });
  if (!prompt.hasMaterial) return null;
  let read = null; let raw = ''; let user = prompt.user;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { text, finishReason } = await callWorker(connection, { system: prompt.system, user, maxTokens: MAX_TOKENS, effort: 'off', signal });
    raw = text;
    read = parseFounderAnswer(text);
    if (finishReason === 'length' && read.note === 'unusable') read.note = 'cut short';
    if (read.note !== 'unusable' && read.note !== 'cut short') break;
    user = prompt.user + '\n\nYour last answer was not a JSON object with a "mutations" list. Answer with the JSON object only, and keep it compact.';
  }
  if (read.note === 'unusable' || read.note === 'cut short') return { applied: [], rejected: [], note: read.note, raw };
  if (stale && stale()) return null;
  const fresh = await loadState(storyId);
  /* the main character's page: mc.set first so people.set can refuse the MC's core */
  const ordered = [...read.mutations.filter((m) => m.type === 'mc.set'), ...read.mutations.filter((m) => m.type !== 'mc.set')];
  /* AXIS LOCK, enforced in code: a standing rides only when its cause names
   * the main character (the brief's bond WITH the MC). The MC's name is the
   * one the answer's mc.set names, else the ledger's. */
  const mcFromAnswer = ordered.find((m) => m.type === 'mc.set' && typeof m.name === 'string');
  const mcKnown = (mcFromAnswer && mcFromAnswer.name.trim()) || (mcName(fresh) !== 'the player' ? mcName(fresh) : '');
  const guarded = [];
  const refusedByLock = [];
  for (const m of ordered) {
    if (NOT_THE_FOUNDERS.has(m.type)) { refusedByLock.push({ mutation: m, why: 'the scene (its ground, hour, who is in it) is the extractor’s to found from the first page, not the founder’s' }); continue; }
    if (m.type === 'rel.set' || m.type === 'rel.shift') {
      const cause = String(m.cause || '').toLowerCase();
      const namesMc = (mcKnown && cause.includes(mcKnown.toLowerCase())) || /main character/.test(cause);
      if (!namesMc) { refusedByLock.push({ mutation: m, why: 'a standing is toward the main character only — this cause does not name ' + (mcKnown || 'the main character') + '; the feeling belongs in the page as words' }); continue; }
    }
    guarded.push(m);
  }
  /* M49: the writer's digits, applied in code — a rel.set per explicit
   * standing, whether or not the model wrote one */
  const stated = explicitStandings(String(brief || '') + '\n' + String(castNotes || ''), mcKnown);
  const named = new Set(guarded.filter((m) => m.type === 'rel.set' && typeof m.name === 'string').map((m) => m.name.trim().toLowerCase()));
  for (const st of stated) {
    if (named.has(st.name.toLowerCase())) continue;
    guarded.push({ type: 'rel.set', name: st.name, p: st.p, r: st.r, s: st.s, cause: 'the brief states (P:' + st.p + ' R:' + st.r + ' S:' + st.s + ') toward ' + (mcKnown || 'the main character') });
  }
  const { state: next, applied, rejected: rejectedByApplier } = applyMutations(fresh, guarded);
  const rejected = [...rejectedByApplier, ...refusedByLock];
  const out = { ...next, founded: { at: Date.now(), print: founderFingerprint({ brief, castNotes, cast, lore }) } };
  if (stale && stale()) return null;
  await saveState(storyId, out);
  notify(storyId);
  return { applied, rejected, note: read.note, raw };
}

export function founderRunWords(result) {
  if (!result) return 'nothing to found from';
  if (result.note === 'unusable') return 'its answer could not be used';
  if (result.note === 'cut short') return 'its answer ran out of room';
  const n = result.applied.length;
  if (!n) return 'the world was already standing';
  return `founded the world in ${n} ${n === 1 ? 'way' : 'ways'}: ` + result.applied.slice(0, 5).map((a) => a.words.replace(/\.$/, '')).join(' · ') + (n > 5 ? ' · …' : '') + (result.rejected.length ? ` (${result.rejected.length} refused)` : '');
}
