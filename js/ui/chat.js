/* Cozy Tavern — ui/chat.js
 * Story list, message thread, composer. Streaming renders token by token.
 * One generation call per user turn — the send path is sacred (see SPEC.md
 * performance laws).
 */

import { db } from '../store.js';
import { createProvider } from '../providers/index.js';
import { buildRequest } from '../assemble/stack.js';
import { finalizeReceipt } from '../assemble/receipt.js';
import { listModules, selectModules } from '../assemble/modules.js';
import { loadState } from '../engine/state.js';
import { openReceipt } from './receiptview.js';

export function initChat(ctx) {
  const els = {
    panel: document.getElementById('story-panel'),
    scrim: document.getElementById('story-scrim'),
    list: document.getElementById('story-list'),
    listEmpty: document.getElementById('story-list-empty'),
    newForm: document.getElementById('new-story-form'),
    newTitle: document.getElementById('new-story-title'),
    btnNew: document.getElementById('btn-new-story'),
    btnCancelNew: document.getElementById('btn-cancel-story'),
    thread: document.getElementById('thread'),
    threadEmpty: document.getElementById('thread-empty'),
    composer: document.getElementById('composer'),
    input: document.getElementById('composer-input'),
    btnSend: document.getElementById('btn-send'),
    btnStop: document.getElementById('btn-stop'),
    menu: document.getElementById('msg-menu'),
  };

  let stories = [];
  let busy = false;
  let abort = null;

  /* ---------- helpers ---------- */

  function fmtWhen(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return sameDay
      ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function nearBottom() {
    const t = els.thread;
    return t.scrollHeight - t.scrollTop - t.clientHeight < 120;
  }

  function scrollToBottom() {
    els.thread.scrollTop = els.thread.scrollHeight;
  }

  async function activeStory() {
    const id = ctx.getActiveStoryId();
    return id ? db.stories.get(id) : undefined;
  }

  /* ---------- story list ---------- */

  async function refreshStories(keepActive) {
    stories = await db.stories.list();
    if (!keepActive) {
      const id = ctx.getActiveStoryId();
      if (!id || !stories.some((s) => s.id === id)) {
        ctx.setActiveStoryId(stories.length ? stories[0].id : null);
      }
    }
    renderStoryList();
  }

  function renderStoryList() {
    els.list.textContent = '';
    els.listEmpty.hidden = stories.length > 0;
    const activeId = ctx.getActiveStoryId();
    for (const story of stories) {
      const li = document.createElement('li');
      li.className = 'story-item' + (story.id === activeId ? ' active' : '');

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'story-open';
      const title = document.createElement('span');
      title.className = 'story-title';
      title.textContent = story.title;
      const when = document.createElement('span');
      when.className = 'story-when';
      when.textContent = fmtWhen(story.updatedAt);
      openBtn.append(title, when);
      openBtn.addEventListener('click', () => openStory(story.id));

      const renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.className = 'story-mini';
      renameBtn.title = 'Rename';
      renameBtn.setAttribute('aria-label', `Rename “${story.title}”`);
      renameBtn.textContent = '✎';
      renameBtn.addEventListener('click', () => beginRename(li, story));

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'story-mini';
      removeBtn.title = 'Let go';
      removeBtn.setAttribute('aria-label', `Let go of “${story.title}”`);
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => removeStory(story));

      li.append(openBtn, renameBtn, removeBtn);
      els.list.appendChild(li);
    }
  }

  function beginRename(li, story) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = story.title;
    input.maxLength = 80;
    input.setAttribute('aria-label', 'A new name for the tale');
    li.replaceChildren(input);

    let done = false;
    const commit = async (keep) => {
      if (done) return;
      done = true;
      const title = input.value.trim();
      if (keep && title && title !== story.title) {
        await db.stories.update(story.id, { title });
        await refreshStories(true);
        if (ctx.onStoriesChanged) ctx.onStoriesChanged();
      } else {
        renderStoryList();
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit(true);
      if (e.key === 'Escape') commit(false);
    });
    input.addEventListener('blur', () => commit(true));
    input.focus();
    input.select();
  }

  async function removeStory(story) {
    const ok = window.confirm(
      `Let go of “${story.title}”? The pages will be gone for good.`
    );
    if (!ok) return;
    await db.stories.remove(story.id);
    if (ctx.getActiveStoryId() === story.id) ctx.setActiveStoryId(null);
    await refreshStories();
    await renderThread();
    if (ctx.onStoriesChanged) ctx.onStoriesChanged();
  }

  async function openStory(id) {
    ctx.setActiveStoryId(id);
    renderStoryList();
    await renderThread();
    closePanel();
    if (ctx.onStoriesChanged) ctx.onStoriesChanged();
  }

  /* ---------- thread ---------- */

  /* The small receipt line under an assistant message: opens "What the
   * storyteller saw this turn". Only messages that carry a receipt get it. */
  function receiptNode(receipt) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'msg-receipt';
    btn.textContent = 'What the storyteller saw';
    btn.addEventListener('click', () => openReceipt(receipt));
    return btn;
  }

  function msgNode(msg) {
    const article = document.createElement('article');
    article.className = `msg msg-${msg.role}`;
    article.dataset.id = msg.id;
    const body = document.createElement('div');
    body.className = 'msg-body';
    body.textContent = msg.text;
    article.appendChild(body);
    if (msg.role === 'assistant' && msg.receipt) {
      article.appendChild(receiptNode(msg.receipt));
    }
    return article;
  }

  function noteNode(text) {
    const article = document.createElement('article');
    article.className = 'msg msg-note';
    const body = document.createElement('div');
    body.className = 'msg-body';
    body.textContent = text;
    article.appendChild(body);
    return article;
  }

  async function renderThread() {
    els.thread.textContent = '';
    const story = await activeStory();
    if (!story) {
      els.threadEmpty.hidden = false;
      els.threadEmpty.textContent = stories.length
        ? 'Pick a tale from the shelf, or start a new one.'
        : 'No tales yet. Start a new story and the tavern will open its doors.';
      return;
    }
    const history = await db.messages.list(story.id);
    els.threadEmpty.hidden = history.length > 0;
    els.threadEmpty.textContent = 'Nothing on the page yet. Say something to begin.';
    for (const msg of history) els.thread.appendChild(msgNode(msg));
    scrollToBottom();
  }

  /* ---------- the send path (one call per turn, nothing else) ---------- */

  async function resolveConnection() {
    const wanted = await db.settings.get('activeConnectionId');
    const all = await db.connections.list();
    return all.find((c) => c.id === wanted) || all[0] || null;
  }

  async function gatherSettings() {
    return {
      frameText: await db.settings.get('frameText'),
      noteText: await db.settings.get('noteText'),
    };
  }

  /* busy is set synchronously by callers before the first await, so two
   * quick submits can't slip both sends through the door. Every path out
   * of generate() sets it false again. */
  async function generate() {
    const story = await activeStory();
    if (!story) { busy = false; return; }

    const connection = await resolveConnection();
    if (!connection) {
      els.thread.appendChild(noteNode(
        'There’s no connection yet. Add one in Settings and the tavern can open its doors.'
      ));
      scrollToBottom();
      busy = false;
      return;
    }

    const history = await db.messages.list(story.id);
    const settingsValues = await gatherSettings();
    /* M2: the assembler also wants the ledger state and the rulebook. The
     * acoustics predicate reads the story's cast notes, so they ride along
     * on the state copy handed to selectModules (see modules.js). */
    const state = await loadState(story.id);
    const allModules = await listModules();
    const selected = selectModules(allModules, { ...state, castNotes: story.castNotes || '' });
    const { systemBlocks, messages, receipt: receiptDraft } = buildRequest({
      story,
      messages: history,
      settings: settingsValues,
      state,
      modules: selected,
    });
    const provider = createProvider(connection);

    const pending = document.createElement('article');
    pending.className = 'msg msg-assistant pending';
    const body = document.createElement('div');
    body.className = 'msg-body';
    pending.appendChild(body);
    els.thread.appendChild(pending);
    scrollToBottom();

    abort = new AbortController();
    els.btnStop.hidden = false;
    els.btnSend.disabled = true;

    let full = '';
    let receipt = null;
    try {
      const result = await provider.streamChat({
        systemBlocks,
        messages,
        signal: abort.signal,
        onToken(piece) {
          full += piece;
          const stick = nearBottom();
          body.textContent = full;
          if (stick) scrollToBottom();
        },
      });
      full = result.text;
      receipt = finalizeReceipt(receiptDraft, {
        ttftMs: result.ttftMs,
        durationMs: result.durationMs,
        model: connection.model || '',
      });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        /* stopped by hand — keep whatever arrived; no receipt, the turn
         * never finished telling itself */
      } else {
        pending.replaceWith(noteNode(err.message || 'The storyteller went quiet. Try again in a moment.'));
        full = '';
      }
    } finally {
      abort = null;
      busy = false;
      els.btnStop.hidden = true;
      els.btnSend.disabled = false;
      els.input.focus();
    }

    pending.classList.remove('pending');
    if (full.trim()) {
      const saved = await db.messages.append(story.id, { role: 'assistant', text: full, receipt });
      pending.dataset.id = saved.id;
      if (saved.receipt) pending.appendChild(receiptNode(saved.receipt));
      stories = await db.stories.list();
      renderStoryList();
      if (ctx.onStoriesChanged) ctx.onStoriesChanged();
    } else {
      pending.remove();
    }
  }

  async function send(text) {
    if (busy) return;
    busy = true;
    const story = await activeStory();
    if (!story) { busy = false; return; }
    els.threadEmpty.hidden = true;

    const saved = await db.messages.append(story.id, { role: 'user', text });
    els.thread.appendChild(msgNode(saved));
    scrollToBottom();

    await generate();
    stories = await db.stories.list();
    renderStoryList();
  }

  /* ---------- regenerate ("rewrite from here") ---------- */

  async function regenerateFrom(messageId) {
    if (busy) return;
    busy = true;
    const story = await activeStory();
    if (!story) { busy = false; return; }
    const history = await db.messages.list(story.id);
    const at = history.findIndex((m) => m.id === messageId);
    if (at === -1) { busy = false; return; }
    const target = history[at];

    if (target.role === 'assistant') {
      await db.messages.deleteFrom(story.id, target.id);
    } else {
      const next = history[at + 1];
      if (next) await db.messages.deleteFrom(story.id, next.id);
    }
    await renderThread();
    await generate();
    stories = await db.stories.list();
    renderStoryList();
  }

  /* ---------- message menu (long-press / right-click) ---------- */

  let menuFor = null;
  let pressTimer = null;

  function showMenu(x, y, messageId) {
    menuFor = messageId;
    els.menu.hidden = false;
    const rect = els.menu.getBoundingClientRect();
    els.menu.style.left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)) + 'px';
    els.menu.style.top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) + 'px';
  }

  function hideMenu() {
    els.menu.hidden = true;
    menuFor = null;
  }

  els.thread.addEventListener('contextmenu', (e) => {
    const msg = e.target.closest('.msg');
    if (!msg || !msg.dataset.id) return;
    e.preventDefault();
    showMenu(e.clientX, e.clientY, msg.dataset.id);
  });

  els.thread.addEventListener('touchstart', (e) => {
    const msg = e.target.closest('.msg');
    if (!msg || !msg.dataset.id) return;
    const touch = e.touches[0];
    const id = msg.dataset.id;
    pressTimer = setTimeout(() => showMenu(touch.clientX, touch.clientY, id), 550);
  }, { passive: true });

  for (const evt of ['touchmove', 'touchend', 'touchcancel']) {
    els.thread.addEventListener(evt, () => {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    }, { passive: true });
  }

  document.addEventListener('click', (e) => {
    if (!els.menu.hidden && !els.menu.contains(e.target)) hideMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideMenu();
  });

  els.menu.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn || !menuFor) return;
    const id = menuFor;
    hideMenu();
    if (btn.dataset.act === 'copy') {
      const story = await activeStory();
      const history = story ? await db.messages.list(story.id) : [];
      const msg = history.find((m) => m.id === id);
      if (msg) {
        try {
          await navigator.clipboard.writeText(msg.text);
        } catch (err) {
          window.prompt('Copy it by hand, then:', msg.text);
        }
      }
    } else if (btn.dataset.act === 'regenerate') {
      regenerateFrom(id);
    }
  });

  /* ---------- story panel (mobile slide-over) ---------- */

  function openPanel() {
    els.panel.classList.add('open');
    els.scrim.hidden = false;
    document.getElementById('btn-stories').setAttribute('aria-expanded', 'true');
  }

  function closePanel() {
    els.panel.classList.remove('open');
    els.scrim.hidden = true;
    document.getElementById('btn-stories').setAttribute('aria-expanded', 'false');
  }

  document.getElementById('btn-stories').addEventListener('click', () => {
    if (els.panel.classList.contains('open')) closePanel(); else openPanel();
  });
  els.scrim.addEventListener('click', closePanel);

  /* ---------- composer & new-story form ---------- */

  els.composer.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = els.input.value.trim();
    if (!text || busy) return;
    els.input.value = '';
    els.input.style.height = '';
    send(text);
  });

  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      els.composer.requestSubmit();
    }
  });

  els.input.addEventListener('input', () => {
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(els.input.scrollHeight, window.innerHeight * 0.4) + 'px';
  });

  els.btnStop.addEventListener('click', () => {
    if (abort) abort.abort();
  });

  els.btnNew.addEventListener('click', () => {
    els.newForm.hidden = false;
    els.newTitle.value = '';
    els.newTitle.focus();
  });

  els.btnCancelNew.addEventListener('click', () => {
    els.newForm.hidden = true;
  });

  els.newForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const story = await db.stories.create({ title: els.newTitle.value });
    els.newForm.hidden = true;
    ctx.setActiveStoryId(story.id);
    await refreshStories(true);
    await renderThread();
    closePanel();
    els.input.focus();
    if (ctx.onStoriesChanged) ctx.onStoriesChanged();
  });

  /* ---------- first light ---------- */

  (async function start() {
    await refreshStories();
    await renderThread();
  })();

  ctx.chat = { refreshStories, renderThread };
}
