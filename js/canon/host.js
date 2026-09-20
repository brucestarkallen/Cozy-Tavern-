/* Cozy Tavern — js/canon/host.js
 * M346: the SillyTavern surface the writer's canon verification extension (Canon Grounding, vendored whole as
 * js/canon/grounding.js) runs on — the same stand-in its own simulation (test/sim.mjs) gives it: its settings, the
 * active story as ST's context, the events, a callable stub for jQuery's panel code (Cozy draws its own), and its
 * toasts routed to Cozy's. The canon note it injects is kept per story, the way ST keeps an extension prompt until
 * it is set again. */
export const extension_settings = {};
export let chat_metadata = {};

const EMPTY = { chat: [], chatMetadata: {}, extensionSettings: {} };
let ctx = null;
export function getContext() { return ctx || EMPTY; }
export function setContext(next) {
  ctx = next || null;
  chat_metadata = (next && next.chatMetadata) || {};
}

/* the note, per story — set when the extension sets it, read when a page is assembled */
const notes = new Map();
export function injectionSetter(storyId) {
  return (key, text) => { if (key === 'CANON_GROUNDING') notes.set(storyId, String(text || '')); };
}
export function injectionFor(storyId) { return notes.get(storyId) || ''; }
export function forgetInjection(storyId) { notes.delete(storyId); }

let saveHook = null;
let saveTimer = null;
export function onSettingsSave(fn) { saveHook = fn; }
export function saveSettingsDebounced() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; if (saveHook) Promise.resolve(saveHook(extension_settings.canon_grounding)).catch(() => {}); }, 400);
}
export async function flushSettings() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (saveHook) await saveHook(extension_settings.canon_grounding);
}

export const event_types = { MESSAGE_RECEIVED: 'message_received', CHAT_CHANGED: 'chat_id_changed' };
const handlers = {};
export const eventSource = {
  on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
  async emit(name, ...args) {
    for (const fn of handlers[name] || []) { try { await fn(...args); } catch (err) { /* the extension's trouble is its own */ } }
  },
};

/* The extension boots inside jQuery(fn); Cozy runs that boot when the switch is first on. */
let boot = null;
export function jQuery(fn) { boot = fn; }
export async function runBoot() { const fn = boot; boot = null; if (typeof fn === 'function') await fn(); }

/* Its settings-panel code draws into ST's DOM; here every call on it is inert. */
const inert = new Proxy(function inertStub() {}, {
  get(target, key) {
    if (key === 'length') return 0;
    if (key === 'then') return undefined;
    if (key === Symbol.iterator) return [][Symbol.iterator].bind([]);
    if (key === Symbol.toPrimitive) return () => '';
    return inert;
  },
  apply() { return inert; },
});
export const $ = inert;

/* Its toasts (a wiki not found, a parse that failed) reach the writer through Cozy's own. */
let toastHook = null;
export function onToast(fn) { toastHook = fn; }
const unescape = (t) => String(t || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const say = (kind) => (msg) => { if (toastHook) { try { toastHook(unescape(msg), kind); } catch (err) { /* never */ } } };
export const toastr = { info: say('info'), success: say('success'), warning: say('warning'), error: say('error') };
