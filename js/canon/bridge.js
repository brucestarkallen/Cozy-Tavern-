/* Cozy Tavern — js/canon/bridge.js
 * M346: CANON VERIFICATION, WHOLE, BEHIND ITS OWN SWITCH. The writer's extension (Canon Grounding) keeps canon
 * characters true to their source — it reads who is in the scene, looks each of them up once on the series' wiki,
 * keeps what it finds, and briefs the storyteller before it writes. Here it runs as itself (js/canon/grounding.js,
 * vendored whole) on the stand-in of SillyTavern in host.js, and this bridge hands it what ST would:
 *   - the story's pages, as ST's chat (the SHOWN version of each page; a hidden page is a system line it skips);
 *   - its per-story memory (ST's chat metadata), kept in the store under canonMeta:<story>;
 *   - the story itself as the card (the title, the brief, the cast notes) — what it discovers the wiki from;
 *   - Cozy's people ledger as its cast list (the slot Summaryception's ledger fills in ST: useLedger, on by default);
 *   - the writer's worker connection for its model calls (the parser, the dossiers, the auditor, the composer);
 *   - the main character's story name as the player's name.
 * What it injects is read back at assembly (assemble/stack.js puts it in the briefing, where its own default —
 * depth 9999, the player's voice — puts it in ST: the top, before any recency).
 * OFF (the default): it is never loaded, never called, and not one byte of it is sent.
 *
 * M386: THE WHOLE EXTENSION, AND THE LEDGER BESIDE IT. M346 ran the engine and showed one switch and one box; the
 * writer: "it's literally just one box". Now:
 *   - WHO'S HERE IS THE CAST. Everyone the ledger has standing in the scene is marked present in the ledger it is lent
 *     (Canon Grounding v0.64.0 hears the mark): they ride every page, named or not, and their pairs are resolved.
 *   - ITS OPENING WORDS ARE HIS (canonHeaderDefault): no wiki, no note, no storyteller — what a teller needs, said once.
 *   - EVERY LEVER OF ITS PANEL, run through its own host surface (CanonGrounding_api) for the story in hand: the ledger
 *     room "What canon says" (canonAction) and Settings (canonSettings / setCanonSetting).
 *   - WHAT CANON SAYS OF A FACE GOES INTO "WHAT'S TRUE OF THEM" (canonLocks → canonSyncLedger): the series' hair, eyes,
 *     height, build, skin and marks, locked for everyone in the ledger who is a canon character — never over the brief,
 *     the writer's hand or a reader's truth, never again once he lets one go, corrected when the series is looked up
 *     again, withdrawn when he blocks the name or forgets the page.
 *   - A BRANCH KEEPS ITS CANON (carryCanonMemory), as ST copies chat metadata on a branch.
 *   - THE WORKERS THAT WRITE FROM "THE REAL RECORD" ARE HANDED IT (canonRecordFor). */
import { db } from '../store.js';
import { callWorker } from '../agents/call.js';
import { workerSignal } from '../agents/status.js';
import { contextOf } from '../providers/room.js';
import { pageText } from '../assemble/stack.js';
import { mcName } from '../engine/duels.js';
import { findPersonKey } from '../engine/people.js';
import { findCanonKey, findFact, FACTS_SHOWN } from '../engine/canon.js';
import { applyMutations, letGoMark } from '../engine/apply.js';
import { loadState, saveState, notify } from '../engine/state.js';
import { overlayFor, throughLens, lensPremise, lensCurrent, lensPeople } from '../agents/canonlens.js'; /* M392/M393: canon through his story */
import {
  extension_settings, setContext, injectionSetter, injectionFor, eventSource, event_types, runBoot, onSettingsSave, flushSettings,
} from './host.js';

export const CANON_SETTINGS_KEY = 'canonGroundingSettings';
export const canonMetaKey = (storyId) => 'canonMeta:' + storyId;

export async function canonOn() { return (await db.settings.get('canonOn')) === true; }

/* M386: THE WORDS THAT OPEN WHAT CANON SAYS, in the writer's voice to his teller (the briefing is his own notes, a
 * user-role message: "you" to the teller, never the house's machinery). What the extension's own framing teaches, kept:
 * canon is sharper than memory; nobody in the story knows more of it than they have lived and a hidden identity stays
 * hidden; it is how someone tends to be, never a script; a pair's line is how they are with that one person; quotes are
 * cadence. Not kept: "wiki", "the note", "the storyteller", "portrayal error" — the words his teller would start thinking
 * in. The writer may write his own in Settings (the extension's "Injection header"); empty = these. */
export const CANON_HEADER = 'What canon says about the people here — sharper than anyone’s memory, so where it differs from what you recall (a face, a tie, something in their past), this is right; where our story has made something otherwise, our story wins. Nobody in the story knows more of it than they’ve lived, and a hidden identity stays hidden. It’s how someone tends to be, never a script: the moment, the company and the pressure bend them, a “With …” line is how they are around that one person, and their quoted lines are only there so you hear how they talk.';

/* M389: ONE reader of a wiki name for every box that takes one — a bare name, a pasted Fandom address, a wiki.gg host;
 * protocol and page path dropped, several with commas */
export function wikiName(value) {
  return String(value || '').split(',').map((w) => w.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.fandom\.com$/, ''))
    .filter(Boolean).join(',');
}

/* the extension's shipped example wiki (its author's own ST default) — never a choice the writer made here */
const SHIPPED_WIKI = 'the-eminence-in-shadow';

let ready = null;
let lastStory = null;
/* Load it once: its settings (the wiki facts it has kept live in them, as in ST), then the extension, then its boot
 * (which starts its own settings and listens for the events Cozy sends). */
export function canonReady() {
  if (!ready) {
    ready = (async () => {
      const saved = await db.settings.get(CANON_SETTINGS_KEY);
      if (saved && typeof saved === 'object') extension_settings.canon_grounding = saved;
      onSettingsSave((s) => (s && typeof s === 'object' ? db.settings.set(CANON_SETTINGS_KEY, s) : null));
      await import('./grounding.js');
      await runBoot();
      const s = extension_settings.canon_grounding;
      /* Cozy always has a worker to ask: the model reads the scene (the extension's recommended way) rather than a
       * capital-letter guess — set once, on the first run; the writer's own choice stands after that. */
      if (!saved && s && typeof s === 'object') { s.llmParser = true; await flushSettings(); }
      /* M386: the extension ships its author's example wiki as the global default — here every story finds its own, so a
       * new story would have searched the wrong universe first. Cleared once; a wiki he names himself stands. */
      if (s && typeof s === 'object' && !s.cozyStamp386) {
        if (String(s.wikis || '').trim().toLowerCase() === SHIPPED_WIKI) s.wikis = '';
        s.cozyStamp386 = true;
        await flushSettings();
      }
      /* one switch: Cozy's. The extension's own "enabled" (a SillyTavern panel control, never shown here) stays on. */
      if (s && typeof s === 'object' && s.enabled === false) { s.enabled = true; await flushSettings(); }
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

/* the extension's own lever board, once it is loaded */
function api() {
  const a = globalThis.CanonGrounding_api;
  if (!a) throw new Error('canon verification is not loaded');
  return a;
}

/* the shown page's words, as ST's chat line */
export function stChat(messages, { mc = 'the player', title = '' } = {}) {
  return (Array.isArray(messages) ? messages : []).filter(Boolean).map((m) => ({
    mes: pageText(m),
    is_user: m.role === 'user',
    is_system: Boolean(m.hidden),
    name: m.role === 'user' ? (mc !== 'the player' ? mc : 'You') : (title || 'Story'),
  }));
}

/* a truth that is part of a face (the founder's five and scars, canon's features and look, a hand's "appearance") */
const FACE_KEY = /hair|eye|height|tall|build|body|figure|skin|complexion|scar|mark|tattoo|feature|look|appearance|face/i;

/* Cozy's people ledger, in the shape the extension reads Summaryception's: every person a page stands for, and him.
 * M386: WHO'S HERE IS MARKED. Everyone the ledger has standing in the scene (state.present — the extractor's reading of
 * the page, the ground truth of the room) carries `present: true`, under the name their page stands under (M320) — the
 * extension puts them in the scene with no name on the page. */
export function ledgerOf(state, { brief = '' } = {}) {
  const out = {};
  const chars = state && state.characters && typeof state.characters === 'object' ? state.characters : {};
  const present = (Array.isArray(state && state.present) ? state.present : [])
    .map((p) => (typeof p === 'string' ? p : p && p.name)).filter((n) => typeof n === 'string' && n.trim());
  const here = new Set(present.map((n) => findPersonKey(chars, n) || n));
  /* M386: ONE HOME FOR A FACE. A face "What's true of them" shows the storyteller this turn — someone here, with a face
   * on their shelf, all of it inside what the shelf shows — is the ledger's to say: the note is told (holds), and says
   * who they are instead. Anyone else keeps their Appearance line in the note, so a face is never said twice or not at all. */
  const canon = state && state.canon && typeof state.canon === 'object' ? state.canon : {};
  const faceShown = (name) => {
    const k = findCanonKey(canon, name);
    const facts = k && canon[k] && Array.isArray(canon[k].facts) ? canon[k].facts : [];
    return facts.length > 0 && facts.length <= FACTS_SHOWN && facts.some((f) => f && FACE_KEY.test(String(f.key || '')));
  };
  /* M389: a face HIS brief describes is his from the very first page — canon's Appearance would contradict it before
   * the founder has locked his version (the brief rides in the frame; the note must not argue with it) */
  const everyone = [...new Set([...Object.entries(chars).filter(([, c]) => c && typeof c === 'object' && !c.retired).map(([n]) => n), ...present, mcName(state)])]; /* the same people canonLocks weighs */
  const briefFace = (name) => Boolean(brief) && ['hair', 'eyes', 'height', 'build', 'skin', 'distinguishing features'].some((k) => briefSpeaks(brief, name, k, everyone));
  const mark = (name) => (here.has(name) ? { present: true, ...(faceShown(name) || briefFace(name) ? { holds: ['appearance'] } : {}) } : {});
  for (const [name, c] of Object.entries(chars)) {
    if (!c || typeof c !== 'object' || c.retired) continue;
    out[name] = { whereabouts: typeof c.state === 'string' ? c.state.slice(0, 200) : '', ...mark(name) };
  }
  for (const n of present) {
    const key = findPersonKey(chars, n);
    if (key && out[key]) continue; /* their page speaks for them */
    if (!out[n]) out[n] = { whereabouts: 'here', ...mark(n) };
  }
  const mc = mcName(state);
  if (mc !== 'the player' && !out[mc]) out[mc] = { whereabouts: 'the main character', ...mark(mc) };
  return out;
}


/* the story's canon memory, without the ledger Cozy lends it each time */
async function saveMeta(storyId, meta) {
  const { summaryception, ...kept } = meta || {};
  await db.settings.set(canonMetaKey(storyId), kept);
}

/* ONE live object per story, as ST keeps one chat_metadata per open chat: the extension's background work (a dossier
 * written after the turn was released) holds the object it was given and saves it later — a second copy loaded for the
 * next call would diverge, and whichever saved last would erase the other's finds. */
const metas = new Map();
async function loadMeta(storyId) {
  if (metas.has(storyId)) return metas.get(storyId);
  const m = await db.settings.get(canonMetaKey(storyId));
  const meta = m && typeof m === 'object' ? m : {};
  if (!metas.has(storyId)) metas.set(storyId, meta);
  return metas.get(storyId);
}
/* what a reader of the room sees — the live object when it is loaded, else what is kept */
export async function canonMeta(storyId) {
  if (!storyId) return {};
  return loadMeta(storyId);
}
/* M392: his story's premise as the lens reads it — the brief, the cast notes, his canon notes (this story's and every
 * story's), where the story stands in canon */
export async function canonPremise(story) {
  if (!story || !story.id) return '';
  const meta = await loadMeta(story.id);
  const s = extension_settings.canon_grounding || (await db.settings.get(CANON_SETTINGS_KEY)) || {};
  return lensPremise(story, meta, { globalNotes: typeof s.pinnedGlobal === 'string' ? s.pinnedGlobal : '' }); /* M393: never empty */
}

/* keep the story's live canon memory now (a worker that wrote into it — M388's memo) */
export async function canonSaveMeta(storyId) {
  if (!storyId || !metas.has(storyId)) return;
  await saveMeta(storyId, metas.get(storyId));
}

function contextFor({ story, state, messages, connection, meta }) {
  const mc = mcName(state);
  const card = { name: story.title || '', description: story.brief || '', personality: '', scenario: story.castNotes || '', first_mes: '', mes_example: '' };
  card.data = { ...card };
  meta.summaryception = { ledger: ledgerOf(state, { brief: String(story.brief || '') + '\n' + String(story.castNotes || '') }) };
  return {
    chat: stChat(messages, { mc, title: story.title || '' }),
    chatMetadata: meta,
    saveMetadata: () => saveMeta(story.id, meta),
    name1: mc !== 'the player' ? mc : '',
    name2: story.title || '',
    characters: [card],
    characterId: 0,
    extensionSettings: {},
    extension_prompt_types: { IN_PROMPT: 0, IN_CHAT: 1, BEFORE_PROMPT: 2 },
    extension_prompt_roles: { SYSTEM: 0, USER: 1, ASSISTANT: 2 },
    setExtensionPrompt: injectionSetter(story.id),
    canonHeaderDefault: CANON_HEADER, /* M386 */
    canonLens: (entry) => overlayFor(meta, entry), /* M392: what of canon holds in HIS story */
    /* ST's generateRaw({prompt, systemPrompt, responseLength}) — through the writer's worker connection */
    generateRaw: async (opts) => {
      const o = opts && typeof opts === 'object' ? opts : { prompt: String(opts || '') };
      if (!connection) return '';
      const { signal, done } = workerSignal(90000);
      try {
        const { text } = await callWorker(connection, { system: String(o.systemPrompt || ''), user: String(o.prompt || ''), maxTokens: Number(o.responseLength) || 1024, signal });
        return text || '';
      } catch (err) {
        return '';
      } finally {
        done();
      }
    },
  };
}

/* The story becomes the extension's chat: its context set, and — a different story than the last one it saw — the chat
 * changed (its per-chat memory resets, the wiki is checked). Returns the live metadata object. */
async function enterStory(bundle) {
  const { story } = bundle;
  await canonReady();
  const meta = await loadMeta(story.id);
  setContext(contextFor({ ...bundle, meta }));
  if (lastStory !== story.id) {
    lastStory = story.id;
    await eventSource.emit(event_types.CHAT_CHANGED); /* a new chat for it: its per-chat memory resets, the wiki is checked */
  }
  return meta;
}

/* how long a page may wait for the lenses of people met this page (once per person per premise) */
const LENS_WAIT_MS = 15000;

/* Before a page is written: the story becomes the extension's chat, and its interceptor runs as ST runs it — with its
 * own time windows (it releases the turn when they close and finishes in the background). Returns the note it holds
 * for this story now. */
export async function canonBeforeSend({ story, state, messages, connection, type = 'normal' } = {}) {
  if (!story || !story.id) return '';
  const meta = await enterStory({ story, state, messages, connection });
  const intercept = globalThis.CanonGrounding_intercept;
  if (typeof intercept === 'function') {
    try { await intercept(stChat(messages, { mc: mcName(state), title: story.title || '' }), contextOf(connection), () => {}, type); } catch (err) { /* never breaks a turn */ }
  }
  /* M392: CANON THROUGH HIS STORY. Whoever rode without a lens made for this premise (someone met this page, a brief he
   * just changed) is lensed now — what of canon holds in his story, what it changed, what it has not reached — and the
   * turn's note is built again through it, the same turn and the same inputs. A lens not back in time lands for the
   * next page; the note built without it still carries his opening words (our story wins). */
  try {
    const premise = lensPremise(story, meta, { globalNotes: (extension_settings.canon_grounding || {}).pinnedGlobal || '' }); /* M393: never empty */
    if (connection) {
      const due = entriesInNote(injectionFor(story.id), meta).filter((e) => !lensCurrent(meta, e, premise));
      if (due.length) {
        const done = await lensPeople({ connection, meta, entries: due, premise, deadlineMs: LENS_WAIT_MS, onKept: () => saveMeta(story.id, meta) });
        if (done.length) await api().rebuild();
      }
    }
  } catch (err) { /* the note stands as built */ }
  /* kept now, not only on its own 400 ms timer — a phone that reloads the page would lose what it just found */
  try { await saveMeta(story.id, meta); } catch (err) { /* its own timer still saves */ }
  return injectionFor(story.id);
}

/* The canon people a built note carries — its blocks open with "Name:" on a line of its own */
function entriesInNote(note, meta) {
  const cache = meta && meta.canon_grounding_cache && typeof meta.canon_grounding_cache === 'object' ? meta.canon_grounding_cache : {};
  const heads = new Set([...String(note || '').matchAll(/^([^\n:]{1,80}):$/gm)].map((m) => m[1].trim().toLowerCase()));
  const seen = new Set();
  return Object.values(cache).filter((e) => {
    if (!e || !e.found || e.kind === 'place' || !heads.has(String(e.name || '').toLowerCase())) return false;
    const k = String(e.name).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* After the storyteller's page lands: the extension grounds the people the page brought in, for the next one. */
export async function canonAfterPage({ story, state, messages, connection } = {}) {
  if (!story || !story.id || !ready) return;
  const meta = await enterStory({ story, state, messages, connection });
  await eventSource.emit(event_types.MESSAGE_RECEIVED, Math.max(0, (messages || []).length - 1));
  try { await saveMeta(story.id, meta); } catch (err) { /* its own timer still saves */ }
}

/* ---------- M386: the levers of the ledger room, for the story in hand ---------- */

const pinList = (csv) => String(csv || '').split(',').map((n) => n.trim()).filter(Boolean);
const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/* One lever of the extension's own panel, run with this story as its chat (its pages, its ledger, the canon worker's
 * connection) — exactly the function its SillyTavern panel calls. What the lever changed is kept at once, the ledger's
 * copy of the series' faces follows (canonSyncLedger), and the room is told. */
export async function canonAction(bundle, action, arg) {
  const { story } = bundle || {};
  if (!story || !story.id) return null;
  const meta = await enterStory(bundle);
  const a = api();
  let out = null;
  switch (action) {
    case 'wiki': {
      /* this story's wiki: named = a decree for this story (the extension's own manual binding, which also lets go of
       * another universe's finds); cleared = it finds the story's wiki itself again, now */
      const v = wikiName(arg);
      if (v) a.bindWiki(v);
      else {
        delete meta.canon_grounding_wiki;
        delete meta.canon_grounding_wiki_ok;
        await a.discoverWiki({ force: true });
      }
      out = a.wiki();
      break;
    }
    case 'discover': await a.discoverWiki({ force: true }); out = a.wiki(); break;
    case 'ask': out = await a.ask(String(arg || '')); break;
    case 'arc': out = await a.setArc(String(arg || '')); break;
    case 'clearArc': a.clearArc(); out = true; break;
    case 'clearSetting': a.clearSetting(); out = true; break;
    case 'note': a.setPins({ text: String(arg || '') }); out = true; break;
    case 'always': case 'never': {
      /* "Always here" and "Never" are one list each (the extension's always-present and never-inject names); a name moved
       * into one leaves the other — both at once is no decree at all */
      const { name, key, on } = arg || {};
      if (!name) break;
      /* the list may hold them under another of their names ("Rukia" for Rukia Kuchiki) — every name the extension's own
       * resolver takes to them leaves, or "Not always here" would leave them always here */
      const store = meta.canon_grounding_cache && typeof meta.canon_grounding_cache === 'object' ? meta.canon_grounding_cache : {};
      const isThem = (n) => sameName(n, name) || (key && (a.entryIn(store, n) || {}).key === key);
      const p = a.pins();
      let always = p.names.filter((n) => !isThem(n));
      let never = p.block.filter((n) => !isThem(n));
      if (on && action === 'always') always = [...always, name];
      if (on && action === 'never') never = [...never, name];
      a.setPins({ names: always, block: never });
      out = a.pins();
      break;
    }
    case 'scan': out = await a.scan(); break;
    case 'preview': out = await a.preview(); break;
    case 'forget': out = a.forget(String(arg || '')); break;
    case 'lookAgain': out = await a.lookAgain(String(arg || '')); break;
    case 'clearAll': a.clearCache(); out = true; break;
    default: return null;
  }
  try { await saveMeta(story.id, meta); } catch (err) { /* kept on the next save */ }
  try { await canonSyncLedger(story); } catch (err) { /* the next page syncs it */ }
  notify(story.id);
  return out;
}

/* Which of this story's decrees name whom — resolved by the extension's own resolver (a pinned "Rukia" IS Rukia Kuchiki,
 * exactly as the note decides). Read-only: no context is entered, nothing is saved. */
export async function canonPinnedKeys(storyId) {
  await canonReady();
  const meta = await loadMeta(storyId);
  const store = meta.canon_grounding_cache && typeof meta.canon_grounding_cache === 'object' ? meta.canon_grounding_cache : {};
  const resolve = (n) => { const hit = api().entryIn(store, n); return hit ? hit.key : null; };
  return {
    always: pinList(meta.canon_grounding_pin_names).map(resolve).filter(Boolean),
    never: pinList(meta.canon_grounding_block).map(resolve).filter(Boolean),
  };
}

/* the wikis the extension has used — offered in each story's room */
export async function canonSavedWikis() {
  const s = extension_settings.canon_grounding || (await db.settings.get(CANON_SETTINGS_KEY)) || {};
  return Array.isArray(s.savedWikis) ? s.savedWikis.filter((w) => typeof w === 'string' && w.trim()) : [];
}

/* what went with the last page of THIS story (the extension keeps one chat's worth of it) — the note and why each rode */
export function canonLast(storyId) {
  if (!ready || lastStory !== storyId || !globalThis.CanonGrounding_api) return null;
  try { return api().last(); } catch (err) { return null; }
}

/* ---------- M386: Settings — the extension's own settings object, live ---------- */

export async function canonSettings() {
  await canonReady();
  return api().settings();
}
export async function setCanonSetting(key, value) {
  await canonReady();
  const s = api().settings();
  s[key] = value;
  await flushSettings();
  return s[key];
}
export async function canonDefaults() {
  await canonReady();
  return api().defaultSettings();
}
/* the built-in text of an instruction — for the header, Cozy's own words above (the extension reads them from the
 * context; with no story entered yet this is the same text) */
export async function canonPromptDefault(key) {
  await canonReady();
  if (key === 'promptHeader') return CANON_HEADER + '\n';
  return api().promptDefault(key);
}
export async function canonResetKeywords() { await canonReady(); api().resetKeywords(); await flushSettings(); return api().settings(); }
export async function canonResetAll() {
  await canonReady();
  api().resetAll();
  const s = api().settings();
  s.llmParser = true; /* Cozy always has a worker to read the scene — the same choice its first run makes */
  s.cozyStamp386 = true;
  if (String(s.wikis || '').trim().toLowerCase() === SHIPPED_WIKI) s.wikis = '';
  await flushSettings();
  return s;
}
export async function canonSelfTest(bundle) {
  if (!bundle || !bundle.story) return { ok: false, ms: 0, error: 'open a story first' };
  await enterStory(bundle);
  return api().selfTest();
}

/* where a story that has not found its own wiki looks first (the extension's global wiki field) */
export async function canonWikis() {
  const s = extension_settings.canon_grounding || (await db.settings.get(CANON_SETTINGS_KEY)) || {};
  const v = typeof s.wikis === 'string' ? s.wikis : '';
  return v.trim().toLowerCase() === SHIPPED_WIKI && !s.cozyStamp386 ? '' : v;
}
export async function setCanonWikis(value) {
  const v = wikiName(value);
  if (extension_settings.canon_grounding) { extension_settings.canon_grounding.wikis = v; await flushSettings(); return v; }
  const saved = (await db.settings.get(CANON_SETTINGS_KEY)) || {};
  await db.settings.set(CANON_SETTINGS_KEY, { ...saved, wikis: v });
  return v;
}

/* what it knows of a story — its cache is the story's own (the extension keeps it per chat: each story its own universe) */
export async function canonKnown(storyId) {
  const meta = await loadMeta(storyId);
  const cache = meta.canon_grounding_cache && typeof meta.canon_grounding_cache === 'object' ? meta.canon_grounding_cache : {};
  return Object.entries(cache).map(([key, e]) => ({ key, name: (e && e.name) || key, found: Boolean(e && e.found), wiki: (e && e.wiki) || '' }));
}
export async function canonForget(storyId, key) {
  const meta = await loadMeta(storyId); /* the live object — the next page does not bring it back */
  const cache = meta.canon_grounding_cache;
  if (!cache || !cache[key]) return false;
  delete cache[key];
  await saveMeta(storyId, meta);
  return true;
}

/* ---------- M386: which canon page is which person of the ledger ---------- */

const normTok = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[‘’´`]/g, "'");
const tokensOf = (s) => normTok(s).replace(/\(.*?\)/g, ' ').split(/[^\p{L}\p{N}']+/u).filter((t) => t.length >= 2);

/* The canon entry for one person of the ledger, or null. The whole name (or an alias) first; then a name whose every
 * word the entry's name or aliases carry ("Rias" → "Rias Gremory") — but only when exactly one entry answers AND no other
 * person of this ledger shares that word: "Rias Wells" (his own) and "Rias Gremory" (canon) are two people, and a bare
 * "Rias" between them is nobody's. */
export function canonEntryFor(cache, name, ledgerNames = []) {
  const store = cache && typeof cache === 'object' ? cache : {};
  const found = Object.entries(store).filter(([, e]) => e && e.found && e.sections && e.kind !== 'place');
  const want = normTok(name).trim();
  if (!want) return null;
  /* the series' own name for them — certain */
  for (const [key, e] of found) if (normTok(e.name).trim() === want) return { key, entry: e };
  /* a shorter name (an alias, the words the story used, one word of the name) — only when nobody else in this ledger
   * could be meant by it */
  const mine = tokensOf(name).filter((t) => t.length >= 3);
  const others = (Array.isArray(ledgerNames) ? ledgerNames : []).filter((n) => !sameName(n, name));
  const rivalled = mine.length === 1 && others.some((n) => tokensOf(n).includes(mine[0]));
  if (rivalled) return null;
  for (const [key, e] of found) {
    if ([key, ...(Array.isArray(e.aliases) ? e.aliases : [])].some((n) => normTok(n).trim() === want)) return { key, entry: e };
  }
  if (!mine.length) return null;
  const covers = found.filter(([, e]) => {
    const theirs = new Set([e.name, ...(Array.isArray(e.aliases) ? e.aliases : [])].flatMap(tokensOf));
    return mine.every((t) => theirs.has(t));
  });
  return covers.length === 1 ? { key: covers[0][0], entry: covers[0][1] } : null;
}

/* ---------- M386: the series' faces in "What's true of them" ---------- */

/* the features a face is held to, and the words that say the brief speaks to one */
const FEATURE_OF = [
  ['hair', /hair/],
  ['eyes', /eye/],
  ['height', /height/],
  ['build', /build|body|figure/],
  ['skin', /skin|complexion/],
  /* the extension's "notably: …" — the sentences of the Appearance section that carry a mole, a scar, a tattoo or the
   * shape of someone (its own DISTINGUISH list) */
  ['distinguishing features', /notably|feature|mark|scar|tattoo/],
];
const BRIEF_SAYS = {
  hair: /\bhair(?:ed)?\b|\b(?:blonde?|brunette|redhead)\b/i,
  eyes: /\beyes?\b/i,
  height: /\b(?:tall|short|height|\d+\s*(?:cm|ft|foot|feet|inches?))\b/i,
  build: /\b(?:build|slender|slim|muscular|petite|curvy|curvaceous|lean|stocky|athletic|lithe|voluptuous)\b/i,
  skin: /\b(?:skin|complexion|tanned|dark-skinned|pale-skinned)\b/i,
  'distinguishing features': /\b(?:scars?|moles?|tattoos?|birthmarks?|freckles?|beauty mark|slender|petite|muscular|voluptuous|curvaceous)\b/i,
};

/* What the series says of one face, feature by feature (the extension's own "physical" line: "hair: …; eyes: …") */
export function canonFeatures(entry) {
  const out = {};
  const physical = entry && entry.sections && typeof entry.sections.physical === 'string' ? entry.sections.physical : '';
  for (const part of physical.split(/;\s*(?=[A-Za-z][\w ()'-]{0,40}:)/)) {
    const i = part.indexOf(':');
    if (i <= 0) continue;
    const label = part.slice(0, i).trim().toLowerCase();
    const value = part.slice(i + 1).trim().replace(/\s+/g, ' ');
    if (!value) continue;
    const hit = FEATURE_OF.find(([, re]) => re.test(label));
    if (!hit) continue;
    const key = hit[0];
    out[key] = out[key] ? out[key] + '; ' + value : value;
  }
  for (const k of Object.keys(out)) if (out[k].length > 400) out[k] = out[k].slice(0, 399).replace(/\s+\S*$/, '') + '…';
  return out;
}

/* Does the writer's own material (the brief, the cast notes) speak to this person's feature? A line that names them and
 * the feature is his — the founder locks it from there, and the series never writes over it. */
function briefSpeaks(material, name, key, others = []) {
  const toks = tokensOf(name).filter((t) => t.length >= 3);
  if (!toks.length) return false;
  /* a word only THIS person has names them alone; with none, it takes all of their name ("Rias Wells has black hair"
   * says nothing of Rias Gremory) */
  const shared = new Set((Array.isArray(others) ? others : []).filter((n) => !sameName(n, name)).flatMap(tokensOf));
  const own = toks.filter((t) => !shared.has(t));
  const word = (t) => new RegExp('(^|[^\\p{L}\\p{N}])' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\p{L}\\p{N}])', 'u');
  const re = BRIEF_SAYS[key];
  return String(material || '').split(/[\n.!?;]+/).some((line) => {
    if (!re.test(line)) return false;
    const lc = normTok(line);
    return own.length ? own.some((t) => word(t).test(lc)) : toks.every((t) => word(t).test(lc));
  });
}

/* The changes that make "What's true of them" hold what the series says of every canon face in the ledger — and only
 * that: a lock only where nothing of anyone else's stands; its own lock corrected when the series' answer changed; its
 * own lock withdrawn when the name is blocked, the page forgotten, or the brief now speaks to it. A truth he let go is
 * never written again (state.canonLetGo). Pure: the same ledger and memory give the same changes. */
export function canonLocks({ state, meta, brief = '', resolve = null, physical = true } = {}) {
  const st = state && typeof state === 'object' ? state : {};
  const m = meta && typeof meta === 'object' ? meta : {};
  const cache = m.canon_grounding_cache && typeof m.canon_grounding_cache === 'object' ? m.canon_grounding_cache : {};
  const blocked = pinList(m.canon_grounding_block);
  const letGo = new Set(Array.isArray(st.canonLetGo) ? st.canonLetGo : []);
  const canon = st.canon && typeof st.canon === 'object' ? st.canon : {};
  const chars = st.characters && typeof st.characters === 'object' ? st.characters : {};
  const people = new Map(); /* ledger name -> the name its truths stand under */
  for (const [n, c] of Object.entries(chars)) if (c && typeof c === 'object' && !c.retired) people.set(n, n);
  for (const p of (Array.isArray(st.present) ? st.present : [])) {
    const n = typeof p === 'string' ? p : p && p.name;
    if (!n) continue;
    const key = findPersonKey(chars, n);
    if (!key || !people.has(key)) people.set(n, n);
  }
  const mc = mcName(st);
  if (mc !== 'the player' && !people.has(mc)) people.set(mc, mc);
  const names = [...people.keys()];
  const out = [];
  for (const name of names) {
    const hit = canonEntryFor(cache, name, names);
    /* never = the extension's own reading of his block list (a blocked "Byakuya" blocks Byakuya Kuchiki); with no
     * resolver at hand, the names as written */
    const isBlocked = hit && blocked.some((b) => (resolve ? (resolve(cache, b) || {}).key === hit.key : false)
      || [hit.entry.name, hit.key, name, ...(hit.entry.aliases || [])].some((x) => sameName(x, b)));
    /* "How they look" off in its settings: the series writes no face at all, and takes back what it wrote */
    const want = hit && !isBlocked && physical !== false ? canonFeatures(hit.entry) : {};
    let briefSaid = false;
    for (const k of Object.keys(want)) if (briefSpeaks(brief, name, k, names) || (hit && briefSpeaks(brief, hit.entry.name, k, names))) { delete want[k]; briefSaid = true; }
    const shelfKey = findCanonKey(canon, name);
    const shelf = shelfKey ? canon[shelfKey] : null;
    /* the rest of the look (the Appearance prose — "a single bang hanging between her eyes") lives with the face, so the
     * note can leave the face to the ledger whole — but only where neither his brief nor his hand has spoken to any of
     * that face (a canon look beside his blonde hair would contradict him in one line) */
    const hisFace = shelf && Array.isArray(shelf.facts) && shelf.facts.some((f) => f && f.source !== 'canon' && FACE_KEY.test(String(f.key || '')));
    const look = hit && !isBlocked && physical !== false && hit.entry.sections && typeof hit.entry.sections.look === 'string' ? hit.entry.sections.look.trim() : '';
    if (look && !briefSaid && !hisFace && !['hair', 'eyes', 'height', 'build', 'skin', 'distinguishing features'].some((k) => briefSpeaks(brief, name, k, names))
      && !letGo.has(letGoMark(shelfKey || name, 'look'))) {
      want.look = look.length > 400 ? look.slice(0, 399).replace(/\s+\S*$/, '') + '…' : look;
      /* said once: a feature the look already states in its own words ("violet eyes") is not a second line of its own —
       * the extension's own rule for its Appearance line, applied where the face now lives */
      const lookLc = normTok(want.look);
      for (const k of Object.keys(want)) {
        if (k === 'look') continue;
        const val = normTok(want[k]).replace(/[.;]+$/, '').trim();
        if (val && new RegExp('(^|[^\\p{L}\\p{N}])' + val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\p{L}\\p{N}])', 'u').test(lookLc)) delete want[k];
      }
    }
    for (const [key, value] of Object.entries(want)) {
      const held = shelf ? findFact(shelf, key) : null;
      if (held && held.entry.source !== 'canon') continue; /* the brief's, the writer's or a reader's */
      if (held && String(held.entry.value || '').trim().toLowerCase() === value.trim().toLowerCase()) continue;
      if (letGo.has(letGoMark(shelfKey || name, key))) continue;
      out.push({ type: 'canon.lock', name: shelfKey || name, key, value, source: 'canon' });
    }
    if (shelf && Array.isArray(shelf.facts)) {
      for (const f of shelf.facts) {
        if (f && f.source === 'canon' && !Object.prototype.hasOwnProperty.call(want, String(f.key || '').toLowerCase())) {
          out.push({ type: 'canon.unlock', name: shelfKey, key: f.key, source: 'canon' });
        }
      }
    }
  }
  return out;
}

/* The ledger made to hold what the series says of its faces — now (a lever in the room) or after a page (the chain). */
export async function canonSyncLedger(story, { stale = () => false } = {}) {
  if (!story || !story.id) return { applied: [] };
  const meta = await loadMeta(story.id);
  const fresh = await loadState(story.id);
  await canonReady();
  const changes = canonLocks({ state: fresh, meta, brief: String(story.brief || '') + '\n' + String(story.castNotes || ''), resolve: (store, n) => api().entryIn(store, n), physical: api().settings().physical !== false });
  if (!changes.length || stale()) return { applied: [] };
  const { state: next, applied } = applyMutations(fresh, changes);
  if (!applied.length || stale()) return { applied: [] };
  await saveState(story.id, next);
  notify(story.id);
  return { applied };
}

/* M386: OFF SENDS NOTHING OF IT. The series' truths it wrote into "What's true of them" are its own doing — switched
 * off, they are withdrawn (journaled, the series' own taking-back: no letting-go of his, so switched on again the next
 * page writes them back). canonWithdraw keeps the ledger so; withoutCanonTruths is the same ledger for a turn that may
 * not write (an out-of-character turn), never saved. */
export function withoutCanonTruths(state) {
  if (!state || typeof state !== 'object' || !state.canon || typeof state.canon !== 'object') return state;
  let touched = false;
  const canon = {};
  for (const [name, shelf] of Object.entries(state.canon)) {
    const facts = shelf && Array.isArray(shelf.facts) ? shelf.facts : [];
    const kept = facts.filter((f) => !(f && f.source === 'canon'));
    if (kept.length !== facts.length) touched = true;
    if (kept.length) canon[name] = { ...shelf, facts: kept };
    else if (!facts.length) canon[name] = shelf;
  }
  return touched ? { ...state, canon } : state;
}
export async function canonWithdraw(storyId) {
  if (!storyId) return null;
  const fresh = await loadState(storyId);
  const changes = [];
  for (const [name, shelf] of Object.entries(fresh.canon || {})) {
    for (const f of (shelf && Array.isArray(shelf.facts) ? shelf.facts : [])) if (f && f.source === 'canon') changes.push({ type: 'canon.unlock', name, key: f.key, source: 'canon' });
  }
  if (!changes.length) return null;
  const { state: next, applied } = applyMutations(fresh, changes);
  if (!applied.length) return null;
  await saveState(storyId, next);
  notify(storyId);
  return next;
}

/* ---------- M386: a branch keeps its canon ---------- */

/* What the story's canon memory holds is the series (universal) and the writer's decrees (the wiki he named, his pins,
 * his blocks, his notes, a story position he set) — a branch keeps all of it, as SillyTavern copies chat metadata on a
 * branch. What the auto-tracker derived FROM the pages (a story position it advanced to, the positions it passed, the
 * current setting) belongs to the timeline: a branch from an older page lets it go and the tracker finds it again as
 * the branch's own story moves. */
export async function carryCanonMemory(fromId, toId, { fromTheTail = false } = {}) {
  if (!fromId || !toId) return false;
  const live = metas.get(fromId);
  const saved = live || (await db.settings.get(canonMetaKey(fromId)));
  if (!saved || typeof saved !== 'object' || !Object.keys(saved).length) return false;
  const { summaryception, ...copy } = JSON.parse(JSON.stringify(saved));
  if (!fromTheTail) {
    const arc = copy.canon_grounding_arc;
    if (arc && typeof arc === 'object' && arc.mode === 'begun') delete copy.canon_grounding_arc;
    delete copy.canon_grounding_arc_reached;
    delete copy.canon_grounding_setting;
  }
  await db.settings.set(canonMetaKey(toId), copy);
  metas.delete(toId); /* the branch's own live object is read from what was just kept */
  return true;
}

/* ---------- M386: the real record, for the workers told to write from it ---------- */

/* The scribe ("a character from an established canon is written from the REAL RECORD"), the world agent and the auditor
 * were told to use the real record and never handed it — a worker told to use what it never receives invents it. For the
 * people these pages carry, what the series says: who they are, their family and ties, the facts a narrator must not get
 * wrong. Empty when nobody here is canon (or canon verification is off: the caller asks only then). */
export function canonRecordFor(meta, names, { cap = 6000, premise = '' } = {}) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const cache = m.canon_grounding_cache && typeof m.canon_grounding_cache === 'object' ? m.canon_grounding_cache : {};
  const list = [...new Set((Array.isArray(names) ? names : []).filter((n) => typeof n === 'string' && n.trim()))];
  const lines = [];
  const seen = new Set();
  const clip = (t, n) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
  for (const name of list) {
    const hit = canonEntryFor(cache, name, list);
    if (!hit || seen.has(hit.key)) continue;
    seen.add(hit.key);
    /* M392: the record as it holds in HIS story. With a premise to hold it to, a person not yet read through it is not
     * handed to the workers at all — the scribe told "keep every page true to the record" would otherwise write canon's
     * end-state (a marriage his story never had) into the ledger; they are read the page they first ride. */
    const lens = overlayFor(m, hit.entry);
    if (String(premise || '').trim() && !lens) continue;
    const e = throughLens(hit.entry, lens);
    const d = e.dossier && typeof e.dossier === 'object' ? e.dossier : {};
    const who = clip(d.identity || e.sections.identity || '', 300);
    const ties = clip(e.sections.relationship || '', 300);
    const facts = (Array.isArray(d.facts) ? d.facts : []).slice(0, 4).map((f) => clip(f, 160)).filter(Boolean);
    const end = (t) => (/[.!?…]$/.test(t) ? t : t + '.');
    const parts = [who, ties ? 'Family and ties: ' + ties : '', facts.length ? 'Also: ' + facts.join('; ') : ''].filter(Boolean).map(end);
    if (!parts.length) continue;
    const label = sameName(name, e.name) ? e.name : name + ' (' + e.name + ')';
    lines.push(label + ' — ' + parts.join(' '));
  }
  let text = lines.join('\n');
  if (text.length > cap) text = text.slice(0, cap).replace(/\n[^\n]*$/, '');
  return text;
}
