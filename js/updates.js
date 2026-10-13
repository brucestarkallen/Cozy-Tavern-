/* Application updates only. No story or ledger mutations. */
import { VERSION } from './version.js';
import { workIsRunning } from './agents/queue.js';

export function startUpdates(ctx) {
  if (ctx.updates) return ctx.updates;
  let ready = false, pending = '', reloading = false, checking = false;
  let operations = 0, writes = 0, failedSave = false, touched = Date.now();
  let registration, notice, retry;
  const touch = () => { touched = Date.now(); };
  const visible = el => el && el.getClientRects().length > 0;
  const say = words => {
    if (!notice) {
      notice = document.createElement('div');
      notice.className = 'toast show'; notice.id = 'update-status'; notice.setAttribute('role', 'status');
      (document.getElementById('toasts') || document.body).append(notice);
    }
    if (notice.textContent !== words) notice.textContent = words;
  };
  // Observe durable writes without changing their values, errors or ordering.
  for (const book of [ctx.db, ctx.db.settings, ctx.db.stories, ctx.db.messages, ctx.db.connections]) {
    for (const name of Object.keys(book)) {
      if (!/^(set|delete|create|add|update|remove|append|import|clear)/.test(name) || typeof book[name] !== 'function') continue;
      const original = book[name];
      book[name] = async function (...args) {
        writes++; touch();
        try { return await original.apply(this, args); }
        // A call that refused its input before writing anything (store.js marks it) lost nothing.
        catch (err) { if (!err?.nothingWritten) failedSave = true; throw err; }
        finally { writes--; touch(); }
      };
    }
  }
  const blocked = () => !ready || operations || writes || failedSave
    || ctx.chat?.isBusy?.() || ctx.chat?.isReplaying?.() || ctx.booksStatus?.updateBlocked?.()
    || document.visibilityState !== 'visible' || Date.now() - touched < 2000
    || Boolean(document.getElementById('composer-input')?.value) || ctx.chat?.hasDraft?.()
    || visible(document.querySelector('#view-settings:not([hidden])'))
    || [...document.querySelectorAll('[role="dialog"], dialog[open], form:not(#composer), [contenteditable="true"], textarea.edit-box')].some(visible)
    // The composer's words and attachments are read above; the caret alone in an empty composer is no draft.
    || (document.activeElement?.matches('input, textarea, select, [contenteditable="true"]') && document.activeElement.id !== 'composer-input');
  async function settle() {
    if (!pending || reloading || checking) return;
    if (blocked()) {
      say(failedSave ? 'Update ready. A save failed, so this page will stay open. Keep your work before refreshing.'
        : 'Update ready. This page will refresh when writing, forms and background work are safely finished.');
      return;
    }
    checking = true;
    try {
      const stories = await ctx.db.stories.list();
      if (blocked() || stories.some(s => s.building || workIsRunning(s.id))) {
        say('Update ready. Waiting for writing and background work to finish safely.');
        return;
      }
      const mark = VERSION + ':' + pending;
      if (sessionStorage.getItem('cozy.updateAttempt') === mark) {
        say('The update did not load completely. Your work is safe here. The next available update will be checked automatically.');
        return;
      }
      sessionStorage.setItem('cozy.updateAttempt', mark);
      reloading = true;
      location.reload();
    } catch { say('Update ready. This browser could not confirm a safe refresh, so your page remains open.'); }
    finally { checking = false; }
  }
  function reconcile() {
    const worker = navigator.serviceWorker?.controller;
    if (!worker) return;
    const channel = new MessageChannel();
    const timer = setTimeout(() => channel.port1.close(), 3000);
    channel.port1.onmessage = ({ data }) => {
      clearTimeout(timer); channel.port1.close();
      if (worker !== navigator.serviceWorker.controller || !data?.version) return;
      if (data.version !== VERSION) {
        pending = data.version;
        if (!retry) retry = setInterval(settle, 3000);
        settle();
      }
    };
    worker.postMessage({ kind: 'appVersion' }, [channel.port2]);
  }
  let looking = false;
  async function look() {
    if (looking) return;
    looking = true;
    try {
      if (!registration) {
        registration = await navigator.serviceWorker.register('sw.js', { type: 'module', updateViaCache: 'none' });
        registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', reconcile));
      }
      await registration.update();
      registration.waiting?.postMessage({ kind: 'takeOver' });
    } catch { /* Offline or a restarting local server: later checks retry. */ }
    finally { looking = false; reconcile(); }
  }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.addEventListener('controllerchange', reconcile);
    reconcile();
    look();
    for (const ms of [2000, 6000, 15000, 30000]) setTimeout(look, ms);
    setInterval(look, 10 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { look(); reconcile(); settle(); } });
    window.addEventListener('online', look);
  }
  for (const event of ['input', 'change', 'pointerdown', 'keydown']) document.addEventListener(event, touch, true);
  return {
    ready() { ready = true; reconcile(); },
    async run(operation) {
      operations++; touch();
      try { return await operation(); }
      finally { operations--; touch(); }
    },
  };
}
