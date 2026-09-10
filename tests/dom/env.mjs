/* Cozy Tavern — tests/dom/env.mjs
 * M33: the app, booted for real, in a DOM. jsdom stands in for the browser;
 * the idb shim for IndexedDB; the thinking house for the storyteller and
 * the workers. Every scenario in run.mjs drives the same modules the phone
 * runs — clicks land on the same handlers, pages land in the same store.
 *
 * Not shipped: tests/dom carries its own package.json (jsdom); the app
 * itself keeps its no-npm law.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/* A streamed answer, the way the house speaks it. */
function sse(lines) {
  const text = lines.map((l) => (typeof l === 'string' ? l : 'data: ' + JSON.stringify(l) + '\n\n')).join('');
  const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } });
  return { ok: true, status: 200, headers: new Headers(), body, clone() { return this; }, async json() { return {}; }, async text() { return text; } };
}
function jsonRes(obj, status = 200) {
  const text = JSON.stringify(obj);
  return { ok: status < 300, status, headers: new Headers(), async json() { return obj; }, async text() { return text; }, clone() { return this; } };
}

/* The house: answers the storyteller with prose, the workers with JSON, by
 * looking at what each request is for. Scenarios can override `answer`. */
export function makeHouse() {
  const state = { calls: [], storyAnswer: null, workerAnswer: null, fail: null };
  let n = 0;
  const fetchImpl = async (url, opts = {}) => {
    const u = String(url);
    if (/api\/books/.test(u)) return jsonRes({}, 404);
    if (/\/v1\/models$/.test(u)) return jsonRes({ data: [] });
    const body = opts.body ? JSON.parse(opts.body) : {};
    const sys = Array.isArray(body.messages) ? body.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n') : String(body.system || '');
    const isWorker = /keep the ledger|world beyond the page|character scribe|memory keeper|second reader|continuity reader|mend a story|narrative-state tracker|audit one record line|referee|cast sheet|Answer with JSON ONLY|JSON ONLY/i.test(sys) && !/You are telling a story/.test(sys);
    n += 1;
    state.calls.push({ url: u, body, isWorker, n });
    if (state.fail) return jsonRes({ error: { message: 'busy' } }, state.fail);
    let answer;
    if (isWorker) {
      answer = typeof state.workerAnswer === 'function' ? state.workerAnswer(body, sys) : (state.workerAnswer || '{"mutations":[],"brief":{"pressure":[],"ripe":[],"twb":null},"deltas":[],"findings":[]}');
    } else {
      answer = typeof state.storyAnswer === 'function' ? state.storyAnswer(body) : (state.storyAnswer || `[Lakeside Park — Friday, March 14, 2025 | 14:30 | 🌤 partly cloudy | gray hoodie | seated on bench]\n\nLiara watched him not eat. "You knew," she said. (answer ${n})`);
    }
    if (u.includes('/v1/messages')) {
      return sse([
        'event: content_block_start\ndata: ' + JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) + '\n\n',
        'event: content_block_delta\ndata: ' + JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: answer } }) + '\n\n',
        'event: message_delta\ndata: ' + JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }) + '\n\n',
      ]);
    }
    return sse([{ choices: [{ delta: { content: answer } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }, 'data: [DONE]\n\n']);
  };
  return { state, fetch: fetchImpl };
}

let booted = null;

/* Boot once per process: the real index.html, the real modules. Returns
 * {window, document, house, errors, db, ctx-free helpers}. */
export async function boot() {
  if (booted) return booted;
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:8080/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  const errors = [];

  /* the browser's globals the modules reach for */
  const expose = ['document', 'navigator', 'location', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'KeyboardEvent',
    'MouseEvent', 'InputEvent', 'DOMParser', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
    'HTMLTextAreaElement', 'HTMLInputElement', 'FileReader', 'Blob', 'File', 'URL', 'history', 'localStorage', 'sessionStorage'];
  for (const k of expose) {
    if (!(k in window)) continue;
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch (err) { /* a getter-only global (navigator) is defined below */ }
  }
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: window, configurable: true, writable: true });
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  globalThis.matchMedia = window.matchMedia;
  window.crypto = globalThis.crypto;
  /* jsdom has no Blob.text(); every browser does */
  if (typeof window.Blob.prototype.text !== 'function') {
    window.Blob.prototype.text = function () {
      return new Promise((resolve, reject) => {
        const r = new window.FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsText(this);
      });
    };
  }
  window.confirm = () => true;
  window.prompt = () => null;
  window.scrollTo = () => {};
  /* downloads: jsdom has no object URLs; every browser does */
  if (typeof window.URL.createObjectURL !== 'function') { window.URL.createObjectURL = () => 'blob:cozy'; window.URL.revokeObjectURL = () => {}; }
  if (typeof globalThis.URL.createObjectURL !== 'function') { globalThis.URL.createObjectURL = () => 'blob:cozy'; globalThis.URL.revokeObjectURL = () => {}; }
  window.HTMLAnchorElement.prototype.click = function () {};
  if (!window.navigator.clipboard) Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true });
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.HTMLElement.prototype.scrollTo = function () {};
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
  window.addEventListener('error', (e) => errors.push('window error: ' + (e.message || e.error)));
  const realErr = console.error;
  console.error = (...a) => { errors.push('console.error: ' + a.map(String).join(' ')); realErr(...a); };
  process.on('unhandledRejection', (r) => errors.push('unhandled: ' + (r && r.stack || r)));

  await import('../harness/idb-shim.mjs');
  const house = makeHouse();
  globalThis.fetch = house.fetch;

  await import('../../js/app.js');
  /* boot is an async IIFE — wait for the version stamp */
  for (let i = 0; i < 200 && !window.document.documentElement.dataset.version; i += 1) await tick(10);
  if (!window.document.documentElement.dataset.version) throw new Error('the app never finished booting: ' + errors.join(' | '));

  const { db } = await import('../../js/store.js');
  booted = { window, document: window.document, house, errors, db };
  return booted;
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/* Wait until fn() is truthy, polling; throws after timeout with a word. */
export async function until(fn, what, timeout = 8000) {
  const t0 = Date.now();
  for (;;) {
    let v;
    try { v = await fn(); } catch (err) { v = null; }
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error('waited too long for ' + what);
    await tick(15);
  }
}

export function click(el) {
  if (!el) throw new Error('nothing to click');
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

export function type(el, text) {
  el.value = text;
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
}

export function submit(form) {
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}

export function q(sel, root) { return (root || window.document).querySelector(sel); }

/* Settings is a hash route; open/close by state, never by blind toggle. */
export async function openSettings() {
  if (q('#view-settings').hidden) { click(q('#btn-settings')); await until(() => !q('#view-settings').hidden, 'settings to open'); }
  await tick(150);
}
export async function closeSettings() {
  if (!q('#view-settings').hidden) { click(q('#btn-settings')); await until(() => q('#view-settings').hidden, 'settings to close'); }
  await tick(50);
}
export function qa(sel, root) { return Array.from((root || window.document).querySelectorAll(sel)); }
