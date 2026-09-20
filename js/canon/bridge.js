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
 * OFF (the default): it is never loaded, never called, and not one byte of it is sent. */
import { db } from '../store.js';
import { callWorker } from '../agents/call.js';
import { workerSignal } from '../agents/status.js';
import { contextOf } from '../providers/room.js';
import { pageText } from '../assemble/stack.js';
import { mcName } from '../engine/duels.js';
import {
  extension_settings, setContext, injectionSetter, injectionFor, eventSource, event_types, runBoot, onSettingsSave, flushSettings,
} from './host.js';

export const CANON_SETTINGS_KEY = 'canonGroundingSettings';
export const canonMetaKey = (storyId) => 'canonMeta:' + storyId;

export async function canonOn() { return (await db.settings.get('canonOn')) === true; }

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
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
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

/* Cozy's people ledger, in the shape the extension reads Summaryception's: every person a page stands for, and him */
export function ledgerOf(state) {
  const out = {};
  const chars = state && state.characters && typeof state.characters === 'object' ? state.characters : {};
  for (const [name, c] of Object.entries(chars)) {
    if (!c || typeof c !== 'object' || c.retired) continue;
    out[name] = { whereabouts: typeof c.state === 'string' ? c.state.slice(0, 200) : '' };
  }
  for (const p of (Array.isArray(state && state.present) ? state.present : [])) {
    const n = typeof p === 'string' ? p : p && p.name;
    if (n && !out[n]) out[n] = { whereabouts: 'here' };
  }
  const mc = mcName(state);
  if (mc !== 'the player' && !out[mc]) out[mc] = { whereabouts: 'the main character' };
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

function contextFor({ story, state, messages, connection, meta }) {
  const mc = mcName(state);
  const card = { name: story.title || '', description: story.brief || '', personality: '', scenario: story.castNotes || '', first_mes: '', mes_example: '' };
  card.data = { ...card };
  meta.summaryception = { ledger: ledgerOf(state) };
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

/* Before a page is written: the story becomes the extension's chat, and its interceptor runs as ST runs it — with its
 * own time windows (it releases the turn when they close and finishes in the background). Returns the note it holds
 * for this story now. */
export async function canonBeforeSend({ story, state, messages, connection, type = 'normal' } = {}) {
  if (!story || !story.id) return '';
  await canonReady();
  const meta = await loadMeta(story.id);
  const ctx = contextFor({ story, state, messages, connection, meta });
  setContext(ctx);
  if (lastStory !== story.id) {
    lastStory = story.id;
    await eventSource.emit(event_types.CHAT_CHANGED); /* a new chat for it: its per-chat memory resets, the wiki is checked */
  }
  const intercept = globalThis.CanonGrounding_intercept;
  if (typeof intercept === 'function') {
    try { await intercept(ctx.chat.slice(), contextOf(connection), () => {}, type); } catch (err) { /* never breaks a turn */ }
  }
  /* kept now, not only on its own 400 ms timer — a phone that reloads the page would lose what it just found */
  try { await saveMeta(story.id, meta); } catch (err) { /* its own timer still saves */ }
  return injectionFor(story.id);
}

/* After the storyteller's page lands: the extension grounds the people the page brought in, for the next one. */
export async function canonAfterPage({ story, state, messages, connection } = {}) {
  if (!story || !story.id || !ready) return;
  await ready;
  const meta = await loadMeta(story.id);
  setContext(contextFor({ story, state, messages, connection, meta }));
  if (lastStory !== story.id) { lastStory = story.id; await eventSource.emit(event_types.CHAT_CHANGED); }
  await eventSource.emit(event_types.MESSAGE_RECEIVED, Math.max(0, (messages || []).length - 1));
  try { await saveMeta(story.id, meta); } catch (err) { /* its own timer still saves */ }
}

/* the series' wiki(s), as the writer names them (the extension's own "Wiki subdomains"; empty = it discovers) */
export async function canonWikis() {
  const s = extension_settings.canon_grounding || (await db.settings.get(CANON_SETTINGS_KEY)) || {};
  return typeof s.wikis === 'string' ? s.wikis : '';
}
export async function setCanonWikis(value) {
  const v = String(value || '').split(',').map((w) => w.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\.fandom\.com.*$/, '')).filter(Boolean).join(',');
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
