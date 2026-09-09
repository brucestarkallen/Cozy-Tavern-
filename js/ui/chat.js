/* Cozy Tavern — ui/chat.js
 * Story list, message thread, composer. Streaming renders token by token.
 * One generation call per user turn — the send path is sacred (see SPEC.md
 * performance laws).
 *
 * M8 (the hearth): sender labels in the whisper voice, hover/focus message
 * actions, the ember bar measuring the room the last turn took, and the
 * composer's meta row with deep links into Settings. The composer never
 * swallows words: with no story it starts one from the first words; with no
 * connection it says so kindly and hands the text back. Stopping a stream
 * keeps the partial page, plainly labeled.
 *
 * M8.5 (the thinking voice): the reasoning channel streams beside the
 * prose, folded into "what the storyteller weighed" — open while it
 * thinks, folding itself away when the first word lands, re-openable
 * after. It's kept on the message (msg.thinking); pages from before the
 * voice woke render exactly as they always did.
 *
 * M9 (the interaction loop & truth fixes):
 *  - Swipes: an assistant page may carry every version of itself
 *    (msg.swipes[] + swipeIdx); ◂ ▸ walk them, and walking past the end
 *    writes a NEW version — the old ones are never lost.
 *  - Edit: any page can be re-inked in place; an edited assistant page is
 *    handed back to the extractor so the ledger re-reads the new words.
 *  - "Go on": a control on the last assistant page sends the hidden
 *    continue nudge — on the wire once, never rendered, never in history.
 *  - Truth fixes: B1 (busy finally + quota guard + 80% shelf warning),
 *    B3 (scrim only in the narrow drawer mode), B4 (findings reach the
 *    receipt), B5 (workers wait before a rewrite; worker write-backs
 *    no-op when their page has gone), B9 (empty or cut-short completions
 *    are named and offered a next step), B12 (the three workers answer to
 *    three separate per-story switches), B18 (the thread re-renders
 *    incrementally — append-only when pages have only been added).
 *  - Commands: #question/#p/#pp/#continue/#time and ((…)) / // asides are
 *    parsed in the composer (commands.js), shown as a chip, and ride the
 *    request as a hidden directive. OOC turns do no state work.
 *  - Committed fate (M11): the referee fires pre-generation when its local
 *    gate passes; a swipe or rewrite replays the SAME verdict unless the
 *    writer's words changed — then the world rewinds and the die rolls
 *    fresh (referee.refereeStep).
 */

import { db } from '../store.js';
import { createProvider } from '../providers/index.js';
import { buildRequest, pageText } from '../assemble/stack.js';
import { finalizeReceipt } from '../assemble/receipt.js';
import { listModules, selectModules } from '../assemble/modules.js';
import { loadState, saveState, notify } from '../engine/state.js';
import { applyMutations } from '../engine/apply.js';
import { extractTurn, noteWork, pendingWork } from '../agents/extractor.js';
import { enqueueWork } from '../agents/queue.js';
import { scribeTurn } from '../agents/scribe.js';
import { refereeStep, maybeSeedSheet } from '../agents/referee.js';
import { maybeSummarize, loadMemory, renderMemory } from '../agents/memory.js';
import { checkTurn } from '../agents/continuity.js';
import { workerSignal, noteWorkerRun } from '../agents/status.js';
import { castForStory } from '../import/cards.js';
import { loadLore, matchLoreDetailed } from '../import/lorebook.js';
import { parseCommand, commandChip } from '../commands.js';
import { openReceipt } from './receiptview.js';
/* M10's showrunners ride the send path too (the episode mark is stripped
 * from the prose before the page is saved, and their standing texts join
 * the assembled tail). M15 audit found these names used below but never
 * imported — every send threw a ReferenceError before the storyteller was
 * ever asked. The imports ARE the fix; the M15 no-ghost-calls harness law
 * keeps the class from returning. */
import {
  stripEpisodeEnd, loadDirector, maybeAutoDirector, afterEpisodeEnd, renderDirectorNote,
} from '../agents/director.js';
import { loadEditor, maybeRunEditor, renderEditorNote } from '../agents/editor.js';
import { VERSION } from '../version.js';

/* ---------- M14: THE HEARTH — the empty room is never a void ----------
 * When no tale is open (or the open one has no pages yet), the thread area
 * shows the hearth: the open-book mark, a lamplight greeting, and a few
 * starter chips whose seed lines drop into the composer (the writer edits
 * or sends as-is — the auto-create flow does the rest). All copy lives
 * here, at the top, editable. */
export const HEARTH_GREETING = 'The lamps are lit. What story tonight?';
export const HEARTH_PICKUP = '…or pick up a tale from the left.';
export const HEARTH_CHIPS = [
  {
    label: 'Begin a slow-burn fantasy',
    seed: 'Begin a slow-burn fantasy — a small village at the edge of an old forest, and a stranger who arrives at dusk.',
  },
  {
    label: 'A mystery in the rain',
    seed: 'A mystery in the rain — a city street shining wet at night, and a knock at the wrong door.',
  },
  {
    label: 'Just start — I’ll follow',
    seed: 'Just start — open on any scene you like, and I’ll follow.',
  },
];

/* The hearth's DOM, built here so the harness can hold it to account
 * without booting the whole chat view. onSeed(chip.seed) is how a tapped
 * chip reaches the composer. */
export function buildHearth({ hasStories = false, onSeed } = {}) {
  const hearth = document.createElement('div');
  hearth.className = 'hearth';

  const mark = document.createElement('img');
  mark.src = 'assets/icon.svg';
  mark.alt = '';
  mark.className = 'hearth-mark';
  mark.setAttribute('aria-hidden', 'true');

  const greeting = document.createElement('p');
  greeting.className = 'hearth-greeting';
  greeting.textContent = HEARTH_GREETING;

  const chips = document.createElement('div');
  chips.className = 'hearth-chips';
  for (const chip of HEARTH_CHIPS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hearth-chip';
    btn.textContent = chip.label;
    btn.addEventListener('click', () => { if (onSeed) onSeed(chip.seed); });
    chips.appendChild(btn);
  }

  hearth.append(mark, greeting, chips);
  if (hasStories) {
    const pickup = document.createElement('p');
    pickup.className = 'hearth-pickup quiet';
    pickup.textContent = HEARTH_PICKUP;
    hearth.appendChild(pickup);
  }
  return hearth;
}

/* M15: the tracker line becomes typography. A whole bracketed line of
 * assistant prose — [The Wayward Lantern — a wet evening] — is lifted out
 * of the flow and set in the whisper voice above the paragraph it opens.
 * Pure and exported so the harness can hold it to account. */
export const SCENE_HEAD_RE = /^\[[^\[\]\n]{2,120}\]$/;

export function parseScene(text) {
  const lines = String(text == null ? '' : text).split('\n');
  const parts = [];
  let prose = [];
  const flush = () => {
    if (!prose.length) return;
    parts.push({ type: 'prose', text: prose.join('\n') });
    prose = [];
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (SCENE_HEAD_RE.test(trimmed)) {
      flush();
      parts.push({ type: 'head', text: trimmed.slice(1, -1).trim() });
    } else {
      prose.push(line);
    }
  }
  flush();
  return parts;
}

/* Which workers wake for this story, as one pure decision (M9, B12) —
 * exported so the harness can hold it to account. Each worker answers to
 * its own per-story switch; an unset per-story switch falls back to the
 * house-wide one for the keeper and the second reader. */
export function workerPlan({ story, settings } = {}) {
  const s = story || {};
  const g = settings || {};
  return {
    extraction: s.extraction !== false,
    keeper: s.keeper === true ? true : s.keeper === false ? false : g.memoryKeeper !== false,
    continuity: s.continuity === true ? true : s.continuity === false ? false : Boolean(g.continuityCheck),
  };
}

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
    noConnection: document.getElementById('no-connection'),
    btnAddFirstConnection: document.getElementById('btn-add-first-connection'),
    composer: document.getElementById('composer'),
    input: document.getElementById('composer-input'),
    btnSend: document.getElementById('btn-send'),
    btnStop: document.getElementById('btn-stop'),
    composerNote: document.getElementById('composer-note'),
    composerChip: document.getElementById('composer-chip'),
    emberBar: document.getElementById('ember-bar'),
    emberFill: document.getElementById('ember-fill'),
    metaContext: document.getElementById('meta-context'),
    menu: document.getElementById('msg-menu'),
  };

  let stories = [];
  let pageCounts = new Map();
  let busy = false;
  let abort = null;
  /* B18: what the thread last rendered, so new pages can simply append. */
  let lastRender = { storyId: null, ids: [] };

  function toast(words) {
    if (ctx.toast) ctx.toast(words);
  }

  /* M9 (B1): the shelf warns once per crossing of the 80% line. */
  db.onStorageWarning(() => {
    toast('The shelf is four-fifths full. Export a backup from Settings before the pages run out of room.');
  });

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

  /* M14: the shelf speaks in relative time — "an hour ago", "yesterday" —
   * the way a reader remembers, not a database. */
  function fmtRelative(ts) {
    if (!ts) return '';
    const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return mins === 1 ? 'a minute ago' : mins + ' minutes ago';
    const hours = Math.round(mins / 60);
    if (hours < 24) return hours === 1 ? 'an hour ago' : hours + ' hours ago';
    const days = Math.round(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 30) return days + ' days ago';
    return fmtWhen(ts);
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

  /* ---------- the hearth (M14): warmth in the empty room ---------- */

  /* A tapped chip drops its seed line into the composer — the writer edits
   * or sends as-is; the auto-create flow opens a story from the words. */
  function seedComposer(seed) {
    els.input.value = seed;
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(els.input.scrollHeight, 190) + 'px';
    if (els.composerChip) {
      const chip = commandChip(els.input.value);
      els.composerChip.textContent = chip;
      els.composerChip.hidden = !chip;
    }
    els.input.focus();
  }

  function showHearth(hasStories) {
    hideHearth();
    els.thread.appendChild(buildHearth({ hasStories, onSeed: seedComposer }));
  }

  function hideHearth() {
    const node = els.thread.querySelector('.hearth');
    if (node) node.remove();
    els.threadEmpty.hidden = true;
  }

  /* ---------- story list ---------- */

  async function refreshStories(keepActive) {
    stories = await db.stories.list();
    /* M14: page counts ride the shelf rows; the byStory index counts
     * without reading a single page. */
    const counts = await Promise.all(stories.map((s) => db.messages.count(s.id).catch(() => 0)));
    pageCounts = new Map(stories.map((s, i) => [s.id, counts[i]]));
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
      const meta = document.createElement('span');
      meta.className = 'story-when';
      /* M14: last-active in the reader's own tense, then the page count
       * in the whisper voice. */
      const when = document.createElement('span');
      when.textContent = fmtRelative(story.updatedAt);
      const pages = document.createElement('span');
      pages.className = 'lbl story-pages';
      const count = pageCounts.get(story.id) || 0;
      pages.textContent = count ? count + (count === 1 ? ' page' : ' pages') : 'unwritten';
      meta.append(when, pages);
      openBtn.append(title, meta);
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
    await renderThread({ structural: true });
    if (ctx.onStoriesChanged) ctx.onStoriesChanged();
  }

  async function openStory(id) {
    ctx.setActiveStoryId(id);
    renderStoryList();
    await renderThread({ structural: true });
    closePanel();
    if (ctx.onStoriesChanged) ctx.onStoriesChanged();
  }

  /* ---------- thread ---------- */

  /* The small receipt line under an assistant message: opens "What the
   * storyteller saw this turn". M9 (B4): the drift findings ride along too —
   * the sheet's "Something drifted" only ever heard them on the refresh
   * path before. */
  function receiptNode(receipt, extraction, findings) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'msg-receipt';
    btn.textContent = 'What the storyteller saw';
    btn.addEventListener('click', () => openReceipt(receipt, extraction, findings));
    return btn;
  }

  /* The folded reasoning block (M8.5): "what the storyteller weighed",
   * dashed and quiet, above the prose. */
  function thinkingNode(text) {
    const details = document.createElement('details');
    details.className = 'thinking';
    const summary = document.createElement('summary');
    summary.innerHTML = '<span class="thinking-arrow" aria-hidden="true">▸</span> what the storyteller weighed';
    const body = document.createElement('div');
    body.className = 'thinking-body';
    body.textContent = text;
    details.append(summary, body);
    return details;
  }

  /* The swipe walker (M9): ◂ n / m ▸ — keyboard-reachable buttons. Walking
   * past the last version writes a new one (the old ones keep). */
  function swipeNode(msg) {
    const swipes = Array.isArray(msg.swipes) ? msg.swipes : [];
    if (!swipes.length) return null;
    const idx = Number.isFinite(msg.swipeIdx)
      ? Math.min(swipes.length - 1, Math.max(0, msg.swipeIdx))
      : swipes.length - 1;
    const wrap = document.createElement('span');
    wrap.className = 'msg-swipes';
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'msg-act swipe';
    prev.dataset.act = 'swipe-prev';
    prev.dataset.id = msg.id;
    prev.setAttribute('aria-label', 'An earlier version of this page');
    prev.textContent = '◂';
    prev.disabled = idx === 0;
    const count = document.createElement('span');
    count.className = 'swipe-count';
    count.textContent = `${idx + 1} / ${swipes.length}`;
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'msg-act swipe';
    next.dataset.act = 'swipe-next';
    next.dataset.id = msg.id;
    next.setAttribute('aria-label', idx === swipes.length - 1
      ? 'Write another version of this page'
      : 'A later version of this page');
    next.textContent = '▸';
    wrap.append(prev, count, next);
    return wrap;
  }

  /* Hover/focus actions (M8; M9 wired edit, swipe, delete — and "go on"
   * lives on the last assistant page). */
  function actionsNode(msg, { isLastAssistant = false } = {}) {
    const row = document.createElement('div');
    row.className = 'msg-actions';
    const acts = ['copy', 'edit'];
    if (msg.role === 'assistant') acts.push('swipe');
    /* M15: branch — the tale forks from this page into a new telling
     * (the M8 row promised it; this wave makes it real). */
    acts.push('branch');
    if (isLastAssistant) acts.push('go on');
    acts.push('delete');
    for (const act of acts) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'msg-act';
      btn.dataset.act = act;
      btn.dataset.id = msg.id;
      btn.textContent = act;
      row.appendChild(btn);
    }
    if (msg.role === 'assistant') {
      const swipes = swipeNode(msg);
      if (swipes) row.appendChild(swipes);
    }
    return row;
  }

  function msgNode(msg, showThinking, opts = {}) {
    const article = document.createElement('article');
    article.className = `msg msg-${msg.role}` + (msg.ooc ? ' msg-ooc' : '');
    article.dataset.id = msg.id;
    /* B13: every page can hold keyboard focus, so its action row (which
     * appears on focus-within) is reachable without a mouse. */
    article.tabIndex = 0;
    const label = document.createElement('div');
    label.className = 'msg-label lbl';
    label.textContent = msg.role === 'user'
      ? (msg.ooc ? 'you, out of character' : 'you')
      : (msg.ooc ? 'the storyteller, out of character' : 'the storyteller');
    article.appendChild(label);
    if (msg.thinking && showThinking !== false) {
      article.appendChild(thinkingNode(msg.thinking));
    }
    const body = document.createElement('div');
    body.className = 'msg-body';
    if (msg.role === 'assistant') {
      /* M15: scene heads set in the whisper voice; the rest stays prose. */
      for (const part of parseScene(pageText(msg))) {
        if (part.type === 'head') {
          const head = document.createElement('div');
          head.className = 'scene-head lbl';
          head.textContent = part.text;
          body.appendChild(head);
        } else {
          const p = document.createElement('div');
          p.className = 'msg-prose';
          p.textContent = part.text;
          body.appendChild(p);
        }
      }
    } else {
      body.textContent = pageText(msg);
    }
    article.appendChild(body);
    if (msg.stopped) {
      const stopped = document.createElement('div');
      stopped.className = 'msg-stopped lbl';
      stopped.textContent = 'stopped mid-sentence';
      article.appendChild(stopped);
    }
    if (msg.cutShort) {
      /* B9: the reply ran out of room — named, with the next step offered. */
      const cut = document.createElement('div');
      cut.className = 'msg-stopped lbl';
      cut.textContent = 'cut short — the reply ran out of room';
      article.appendChild(cut);
    }
    if (msg.role === 'assistant' && msg.receipt) {
      article.appendChild(receiptNode(msg.receipt, msg.extraction, msg.findings));
    }
    article.appendChild(actionsNode(msg, opts));
    return article;
  }

  function noteNode(text) {
    const article = document.createElement('article');
    article.className = 'msg msg-note';
    const label = document.createElement('div');
    label.className = 'msg-label lbl';
    label.textContent = 'a word from the house';
    const body = document.createElement('div');
    body.className = 'msg-body';
    body.textContent = text;
    article.append(label, body);
    return article;
  }

  /* B9: an empty completion gets a kind note AND a way to ask again. */
  function retryNoteNode(text, retry) {
    const article = noteNode(text);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'msg-act retry';
    btn.textContent = 'Ask again';
    btn.addEventListener('click', retry);
    article.appendChild(btn);
    return article;
  }

  /* B18: the thread re-renders incrementally — when pages have only been
   * ADDED to what is already on screen, the new ones simply append. A
   * structural change (another story, an edit, a swipe, a delete, a
   * thinking-voice toggle) rebuilds. */
  async function renderThread({ structural = false } = {}) {
    const story = await activeStory();
    const showThinking = (await db.settings.get('showThinking')) !== false;
    const connections = els.noConnection ? await db.connections.list() : [];
    if (!story) {
      els.thread.textContent = '';
      lastRender = { storyId: null, ids: [] };
      /* M14: never a blank center — the hearth greets instead. */
      showHearth(stories.length > 0);
      if (els.noConnection) els.noConnection.hidden = connections.length > 0;
      refreshEmber();
      return;
    }
    const history = await db.messages.list(story.id);
    /* Hidden pages (the continue nudge) never render — they live in the
     * store for the audit and nowhere else. */
    const visible = history.filter((m) => m && !m.hidden);
    if (els.noConnection) {
      els.noConnection.hidden = connections.length > 0 || visible.length > 0;
    }

    const lastAssistantId = (() => {
      for (let i = visible.length - 1; i >= 0; i -= 1) {
        if (visible[i].role === 'assistant') return visible[i].id;
      }
      return null;
    })();

    const ids = visible.map((m) => m.id);
    const canAppend = !structural
      && lastRender.storyId === story.id
      && lastRender.showThinking === showThinking
      && lastRender.ids.length <= ids.length
      && lastRender.ids.every((id, i) => id === ids[i]);

    if (!canAppend) {
      els.thread.textContent = '';
      /* M14: a story with no pages yet still gets the hearth, not a void. */
      if (!visible.length) showHearth(false);
      for (const msg of visible) {
        els.thread.appendChild(msgNode(msg, showThinking, { isLastAssistant: msg.id === lastAssistantId }));
      }
    } else {
      /* Pages arriving onto a hearth-warmed room: the hearth steps aside. */
      if (visible.length && lastRender.ids.length === 0) hideHearth();
      for (let i = lastRender.ids.length; i < visible.length; i += 1) {
        const msg = visible[i];
        els.thread.appendChild(msgNode(msg, showThinking, { isLastAssistant: msg.id === lastAssistantId }));
      }
      /* A new last assistant page: the "go on" affordance moves with it. */
      if (lastRender.ids.length !== ids.length) {
        const rows = els.thread.querySelectorAll('.msg-actions .msg-act[data-act="go on"]');
        rows.forEach((btn) => {
          const host = btn.closest('.msg');
          if (host && host.dataset.id !== lastAssistantId) btn.remove();
        });
      }
    }
    lastRender = { storyId: story.id, ids, showThinking };
    scrollToBottom();
    refreshEmber();
  }

  /* Re-render one page in place (an edit, a swipe, a worker's write-back). */
  async function rerenderMessage(storyId, messageId) {
    const story = await activeStory();
    if (!story || story.id !== storyId) return;
    const history = await db.messages.list(storyId);
    const msg = history.find((m) => m.id === messageId);
    const node = els.thread.querySelector(`.msg[data-id="${messageId}"]`);
    if (!msg || msg.hidden) {
      if (node) node.remove();
      return;
    }
    const showThinking = (await db.settings.get('showThinking')) !== false;
    const lastAssistant = [...history].reverse().find((m) => m && !m.hidden && m.role === 'assistant');
    const fresh = msgNode(msg, showThinking, {
      isLastAssistant: lastAssistant ? lastAssistant.id === messageId : false,
    });
    if (node) node.replaceWith(fresh);
    else els.thread.appendChild(fresh);
  }

  /* ---------- the ember bar & composer meta (M8) ---------- */

  async function refreshEmber() {
    if (!els.emberFill) return;
    const story = await activeStory();
    let receipt = null;
    if (story) {
      const history = await db.messages.list(story.id);
      const last = [...history].reverse().find((m) => m && m.receipt && typeof m.receipt.totalTokens === 'number');
      receipt = last ? last.receipt : null;
    }
    const connection = await resolveConnection(story);
    const size = connection && typeof connection.contextSize === 'number' && connection.contextSize > 0
      ? connection.contextSize
      : 200000;
    const total = receipt ? receipt.totalTokens : 0;
    const pct = total ? Math.min(100, Math.max(1, (total / size) * 100)) : 0;
    els.emberFill.style.width = pct + '%';
    els.emberBar.classList.toggle('hot', pct > 72);
    if (els.metaContext) {
      /* M14: at 0% the bar still says what it is, quietly — never blank. */
      els.metaContext.textContent = total
        ? '~' + total.toLocaleString() + ' of ~' + size.toLocaleString() + ' tokens in the room'
        : 'the ember line — how much of the room the last turn took';
      els.metaContext.classList.toggle('hot', pct > 85);
    }
  }

  /* ---------- the send path (one call per turn, nothing else) ---------- */

  /* M9: a story may name its own storyteller (Settings → per-story "Who
   * tells this story"); by default the house connection tells them all. */
  async function resolveConnection(story) {
    const all = await db.connections.list();
    if (story && typeof story.connectionId === 'string' && story.connectionId) {
      const own = all.find((c) => c.id === story.connectionId);
      if (own) return own;
    }
    const wanted = await db.settings.get('activeConnectionId');
    return all.find((c) => c.id === wanted) || all[0] || null;
  }

  /* M3: the workers may use a connection of their own (Settings → The
   * workers); by default they borrow the one telling the story. */
  async function resolveWorkerConnection(story) {
    const wanted = await db.settings.get('workerConnectionId');
    if (wanted) {
      const all = await db.connections.list();
      const found = all.find((c) => c.id === wanted);
      if (found) return found;
    }
    return resolveConnection(story);
  }

  /* Refresh the receipt affordance on a message already on the page, so
   * late-arriving worker notes (extraction, drift findings) can speak. */
  function refreshReceiptNode(msg) {
    const node = els.thread.querySelector(`.msg[data-id="${msg.id}"]`);
    if (node && msg.receipt) {
      const old = node.querySelector('.msg-receipt');
      if (old) old.remove();
      node.appendChild(receiptNode(msg.receipt, msg.extraction, msg.findings));
    }
  }

  /* B5: write worker results back onto the page they were reading — a
   * PATCH, never a resurrection. If the page has gone (deleted, or the
   * whole thread rewritten), the write simply doesn't happen. The page's
   * current words and swipes are never touched by the workers. */
  async function reink(storyId, messageId, patch) {
    const latest = await db.messages.update(storyId, messageId, patch);
    if (!latest) return undefined; // the page has gone — the write is a no-op
    refreshReceiptNode(latest);
    return latest;
  }

  /* Whether the page the workers are reading still exists — checked before
   * the ledger learns from it, so a deleted page teaches nothing. */
  async function stillThere(storyId, messageId) {
    const all = await db.messages.list(storyId);
    return all.some((m) => m.id === messageId);
  }

  /* M3/M6: once a page is finished, the workers read it — never awaited by
   * the turn that fired them. The fan-out order is law (SPEC.md M6): the
   * extractor first, then the memory keeper, then the continuity reader.
   * Each link gets a 60-second hard timeout (M9, A5) and records its last
   * run for the drawer's "The workers" line (M9, §5). Every link fails
   * quietly: the chat path never hears about it. */
  /* M10: the showrunners' background work. Deliberately OUTSIDE the
   * tracked worker chain — the M10 latency law says housekeeper work must
   * never delay a story turn, so pendingWork never awaits any of this.
   * Everything here fails quietly and reports to the workers' ledger line. */
  function startShowrunnerWork(story, { episodeEnded = false } = {}) {
    (async () => {
      try {
        const connection = await resolveWorkerConnection(story);
        if (!connection) return;
        const { signal, done } = workerSignal();
        try {
          if (episodeEnded) {
            /* close the episode: editor review, then auto-next */
            const rituals = await afterEpisodeEnd({ connection, storyId: story.id, story, signal });
            await noteWorkerRun(story.id, 'director', {
              ok: !(rituals && rituals.director && rituals.director.ok === false),
              why: (rituals && rituals.director && rituals.director.error) || '',
            });
            if (rituals && rituals.editor) {
              await noteWorkerRun(story.id, 'editor', {
                ok: rituals.editor.ok !== false,
                why: rituals.editor.error || '',
              });
            }
          } else {
            /* auto mode fills an empty board, in the background */
            const ran = await maybeAutoDirector({ connection, storyId: story.id, story, signal });
            if (ran) {
              await noteWorkerRun(story.id, 'director', {
                ok: ran.ok !== false,
                why: ran.error || '',
              });
            }
            /* the editor's cadence, when it's on */
            const edited = await maybeRunEditor({
              connection, story, storyId: story.id, reason: 'cadence', signal,
            });
            if (edited) {
              await noteWorkerRun(story.id, 'editor', {
                ok: edited.ok !== false,
                why: edited.error || '',
              });
            }
          }
        } finally {
          done();
        }
        /* the panel shows what the showrunners settled, if it's open */
        if (ctx.housekeeper && typeof ctx.housekeeper.onStoriesChanged === 'function') {
          ctx.housekeeper.onStoriesChanged();
        }
      } catch (err) {
        await noteWorkerRun(story.id, 'director', {
          ok: false,
          why: (err && err.message) || 'stumbled',
        });
      }
    })();
  }

  /* M3/M6/M12: once a page is finished, the workers read it — never awaited
   * by the turn that fired them. M12 routes every link through the workers'
   * channel (agents/queue.js): jobs run SEQUENTIALLY in queue order — the
   * extractor, then the scribe, then the keeper, then the second reader,
   * then the seeder — each with a 60-second call ceiling, up to five
   * retries on the 2s→60s backoff (Retry-After honored), and every settled
   * run written on the drawer's workers line. A story switch purges the
   * channel; each job also checks stale() before committing anything, so a
   * left-behind story is never written into. noteWork still tracks each
   * link, so the send path's courtesy wait (pendingWork, 5s a link) holds. */
  function startBackgroundWork(story, msg, userText) {
    const enqueue = (name, run) => {
      const promise = enqueueWork(story.id, { name, run });
      noteWork(story.id, promise);
      return promise;
    };

    /* 1. The extractor (M3): read the page, propose mutations, apply and
     * save them, and write the outcome back onto the same message. */
    enqueue('extractor', async ({ signal, stale }) => {
      if (story.extraction === false) return { silent: true };
      const connection = await resolveWorkerConnection(story);
      if (!connection) return { silent: true };
      const stateBefore = await loadState(story.id);
      const { mutations } = await extractTurn({
        connection,
        state: stateBefore,
        userText,
        assistantText: pageText(msg),
        signal,
      });
      /* B5: a page that has gone teaches the ledger nothing. M12: nor does
       * a page of a story the writer has left. */
      if (stale()) return { silent: true };
      if (!(await stillThere(story.id, msg.id))) return { silent: true };
      const list = Array.isArray(mutations) ? mutations : [];

      /* Re-load at apply time — the ledger may have been touched by hand
       * while the worker was reading. */
      const fresh = await loadState(story.id);
      const { state: next, applied, rejected } = applyMutations(fresh, list);
      if (applied.length) {
        if (stale()) return { silent: true };
        await saveState(story.id, next);
        notify(story.id);
      }

      await reink(story.id, msg.id, {
        extraction: {
          appliedWords: applied.map((a) => a.words),
          rejectedCount: rejected.length,
        },
      });
      return { silent: false };
    });

    /* 2. The scribe (M12): sparse deltas onto the character pages — who
     * they are, where they are, how things stand, loose ends. It answers
     * to the ledger's own switch, like the extractor. */
    enqueue('scribe', async ({ signal, stale }) => {
      if (story.extraction === false) return { silent: true };
      const connection = await resolveWorkerConnection(story);
      if (!connection) return { silent: true };
      await scribeTurn({
        connection,
        storyId: story.id,
        userText,
        assistantText: pageText(msg),
        signal,
        stale,
      });
      return { silent: false };
    });

    /* 3. The memory keeper (M6; M12 grew the detail auditor inside it):
     * fold what has scrolled past the verbatim window into layered notes.
     * M9 (B12): its own per-story switch — the ledger's switch no longer
     * speaks for it. */
    enqueue('keeper', async ({ signal, stale }) => {
      if (story.keeper === false) return { silent: true };
      if (story.keeper !== true && (await db.settings.get('memoryKeeper')) === false) return { silent: true };
      const connection = await resolveWorkerConnection(story);
      if (!connection) return { silent: true };
      if (stale()) return { silent: true };
      await maybeSummarize({ connection, storyId: story.id, signal });
      return { silent: false };
    });

    /* 4. The continuity reader (M6): advisory drift notes against canon and
     * the ledgers, stored on the same message. M9 (B12): its own per-story
     * switch too. It never touches the words. */
    enqueue('continuity', async ({ signal, stale }) => {
      const on = story.continuity === true
        ? true
        : story.continuity === false ? false : Boolean(await db.settings.get('continuityCheck'));
      if (!on) return { silent: true };
      const connection = await resolveWorkerConnection(story);
      if (!connection) return { silent: true };
      const fresh = await loadState(story.id);
      const { findings } = await checkTurn({
        connection,
        state: fresh,
        assistantText: pageText(msg),
        signal,
      });
      const list = Array.isArray(findings) ? findings : [];
      if (!list.length) return { silent: false };
      if (stale()) return { silent: true };
      if (!(await stillThere(story.id, msg.id))) return { silent: true };
      await reink(story.id, msg.id, { findings: list });
      notify(story.id); // the drawer's "Something drifted" listens
      return { silent: false };
    });

    /* 5. The sheet seeder (M11): on the first turns and after a fight lets
     * go, the actor sheet fills itself in the background. It never blocks a
     * turn, and it keeps its own quiet ways (failures stay off the workers
     * line, as M11 shipped them). */
    enqueue('seeder', async ({ signal }) => {
      try {
        const connection = await resolveWorkerConnection(story);
        if (!connection) return { silent: true };
        await maybeSeedSheet({ connection, storyId: story.id, signal });
      } catch (err) { /* the seeder's trouble is its own */ }
      return { silent: true };
    });
  }

  async function gatherSettings() {
    return {
      frameText: await db.settings.get('frameText'),
      noteText: await db.settings.get('noteText'),
    };
  }

  /* M11: the referee's dials (Settings → The referee). `on` is the master
   * switch; the rest shape the gate and the engine. */
  async function refereeSettings() {
    return {
      on: (await db.settings.get('refereeOn')) !== false,
      sensitivity: (await db.settings.get('refereeSensitivity')) || 'normal',
      preset: (await db.settings.get('refereePreset')) || 'realistic',
      fightStyle: (await db.settings.get('refereeFightStyle')) || 'tracked',
    };
  }

  /* M8.5: which thinking voice speaks this turn. The story's own choice
   * wins; otherwise the connection's; otherwise the voice stays off. */
  function effectiveReasoning(connection, story) {
    const override = story && typeof story.reasoningEffort === 'string' ? story.reasoningEffort : '';
    if (override === 'low' || override === 'medium' || override === 'high') return { effort: override };
    if (override === 'off') return { effort: 'off' };
    const r = connection && connection.reasoning;
    if (r && (r.effort === 'low' || r.effort === 'medium' || r.effort === 'high')) return r;
    return { effort: 'off' };
  }

  /* The kind inline note under the composer (M8): says what the tavern
   * needs and keeps every typed word. */
  function showComposerNote(words) {
    if (!els.composerNote) return;
    els.composerNote.textContent = words;
    els.composerNote.hidden = false;
  }

  function hideComposerNote() {
    if (els.composerNote) els.composerNote.hidden = true;
  }

  function restoreComposer(text) {
    els.input.value = text;
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(els.input.scrollHeight, 190) + 'px';
    els.input.focus();
  }

  /* busy is set synchronously by callers before the first await, so two
   * quick submits can't slip both sends through the door. M9 (B1): the
   * whole body sits in try/finally — no path out can leave busy set.
   *
   * opts.directive — a house command's hidden instruction (slot 9/10 area)
   * opts.ooc       — an out-of-character turn: no referee, no state work
   * opts.swipeTarget — write the completion in as a NEW SWIPE of this page
   *                    (history reads only what came before it)
   * opts.continueId — the hidden "Go on." user page this turn answers
   *                    (the nudge fires from it; it never renders) */
  async function generate(opts = {}) {
    const { directive = '', ooc = false, swipeTarget = null } = opts;
    let receipt = null;
    /* M10: set when the prose carried [EPISODE_END] (M15 audit: this was
     * assigned below but never declared — a second ReferenceError waiting
     * behind the missing imports). */
    let episodeEnded = false;
    try {
      const story = await activeStory();
      if (!story) return;

      const connection = await resolveConnection(story);
      if (!connection) {
        els.thread.appendChild(noteNode(
          'There’s no connection yet. Add one in Settings and the tavern can open its doors.'
        ));
        showComposerNote('The tavern needs a storyteller first — add a connection.');
        scrollToBottom();
        return;
      }
      hideComposerNote();

      const fullHistory = await db.messages.list(story.id);
      /* Swipe mode re-asks the turn that produced the target page: the
       * history the assembler sees ends BEFORE the target. */
      let history = fullHistory;
      if (swipeTarget) {
        const at = fullHistory.findIndex((m) => m.id === swipeTarget.id);
        if (at === -1) {
          toast('That page has gone — nothing to rewrite.');
          return;
        }
        history = fullHistory.slice(0, at);
      }
      const settingsValues = await gatherSettings();
      /* M3 (the latency law): if the workers are still reading the previous
       * page, the send path waits for them — hard five-second ceiling on
       * each link of the chain, then we go on with last-good state — BEFORE
       * the assembler looks at anything. */
      await pendingWork(story.id, 5000);
      let state = await loadState(story.id);

      /* M11: the autonomous referee — the ONLY agent call allowed before
       * the story generation, and only when its local gate passes (a fight
       * in progress bypasses the gate). Committed fate: the same words
       * replay the same verdict — a swipe or rewrite never re-rolls;
       * changed words rewind the world to before the old turn and roll
       * fresh; deleted or branched-away suffixes rewind with them. OOC
       * turns never see the referee. On ANY failure it degrades to
       * nothing: no injection, and the story simply goes on. */
      const lastUser = [...history].reverse().find((m) => m && m.role === 'user');
      const userText = lastUser ? pageText(lastUser) : '';
      if (!ooc && lastUser) {
        const { signal, done } = workerSignal(12000); /* the referee's 12s budget */
        try {
          const refSettings = await refereeSettings();
          if (refSettings.on) {
            const workerConnection = await resolveWorkerConnection(story);
            const step = await refereeStep({
              connection: workerConnection,
              userText,
              userId: lastUser.id,
              history,
              state,
              settings: refSettings,
              signal,
            });
            state = (step && step.state) || state;
            if (step && step.ruling) {
              state = { ...state, pendingVerdict: step.ruling, lastVerdict: step.ruling };
            }
            /* The referee's timeline and fight state move even on quiet
             * turns — save whatever the step settled. */
            await saveState(story.id, state);
            notify(story.id); // the drawer's "The house has ruled" listens
            await noteWorkerRun(story.id, 'referee', {
              ok: !step || step.status !== 'degraded',
              why: (step && step.why) || '',
            });
          }
        } catch (err) {
          /* a failed ruling never blocks the turn */
          await noteWorkerRun(story.id, 'referee', {
            ok: false,
            why: err && err.message === 'timeout' ? 'outwaited' : (err && err.message) || 'stumbled',
          });
        } finally {
          done();
        }
      }

      const allModules = await listModules();
      const selected = selectModules(allModules, { ...state, castNotes: story.castNotes || '' });
      /* M6: slot 7 — what the keeper has folded of the older pages. */
      const mem = await loadMemory(story.id);
      const memoryText = renderMemory(mem);
      /* M9 (A1): the window law. The keeper's own switch decides whether the
       * window is the memory window or a token-budgeted cutoff against the
       * connection's context room. */
      const keeperOn = story.keeper === true
        ? true
        : story.keeper === false ? false : (await db.settings.get('memoryKeeper')) !== false;
      const windowInfo = {
        keeperOn,
        /* The story's memory keeps its own window once it has one; before
         * that, the house slider (Settings → How much the story remembers)
         * speaks — the help text under it is now true (M9, §1). */
        window: mem && Number.isFinite(mem.window) && mem.window > 0
          ? mem.window
          : (await db.settings.get('memoryWindow')),
        budgetTokens: connection && typeof connection.contextSize === 'number' && connection.contextSize > 0
          ? connection.contextSize
          : 200000,
      };
      /* M7: slot 4 — the story's invited cast. Slot 7 — the lore shelf's
       * answer for the latest pages, each entry scanning its own depth;
       * the receipt names which entries woke. */
      const invitedCast = await castForStory(story);
      const loreEntries = await loadLore(story.id);
      let loreText = '';
      let loreFired = [];
      if (loreEntries.length) {
        const recent = history.slice(-6).map((m) => pageText(m));
        const matched = matchLoreDetailed(loreEntries, recent);
        loreText = matched.text;
        loreFired = matched.fired;
      }
      /* M10: the showrunners' standing states, read fresh each turn so the
       * dynamic tail carries what stands right now. */
      const [directorState, editorState] = await Promise.all([
        loadDirector(story.id),
        loadEditor(story.id),
      ]);
      const { systemBlocks, messages, receipt: receiptDraft } = buildRequest({
        story,
        messages: history,
        settings: settingsValues,
        state,
        modules: selected,
        memory: memoryText,
        cast: invitedCast,
        lore: loreText,
        loreFired,
        window: windowInfo,
        directive,
        /* M10: the showrunners' standing texts — their own receipt-named
         * slots in the dynamic tail, before history; empty = omitted. */
        directorNote: renderDirectorNote(directorState),
        editorEye: renderEditorNote(editorState),
      });

      /* M6 consume-and-clear: the ruling rode into this turn's stack as a
       * fact; it clears now, so no later turn inherits it. */
      if (state.pendingVerdict) {
        try {
          await saveState(story.id, { ...state, pendingVerdict: null });
          notify(story.id);
        } catch (err) { /* the turn is already assembled; never mind */ }
      }

      /* M8.5: the thinking voice for this turn. */
      const reasoning = effectiveReasoning(connection, story);
      const provider = createProvider({ ...connection, reasoning });
      const showThinking = (await db.settings.get('showThinking')) !== false;

      const pending = document.createElement('article');
      pending.className = 'msg msg-assistant pending';
      const pendingLabel = document.createElement('div');
      pendingLabel.className = 'msg-label lbl';
      pendingLabel.textContent = 'the storyteller';
      pending.appendChild(pendingLabel);
      let thinkDetails = null;
      let thinkBody = null;
      const body = document.createElement('div');
      body.className = 'msg-body';
      pending.appendChild(body);
      els.thread.appendChild(pending);
      scrollToBottom();

      abort = new AbortController();
      els.btnStop.hidden = false;
      els.btnSend.hidden = true;
      /* M15: the ember breathes while the storyteller writes. */
      if (els.emberBar) els.emberBar.classList.add('live');

      let full = '';
      let thinking = '';
      let sawProse = false;
      let stoppedByHand = false;
      let finishReason = null;
      try {
        const result = await provider.streamChat({
          systemBlocks,
          messages,
          signal: abort.signal,
          onToken({ channel, text }) {
            if (channel === 'thinking') {
              thinking += text;
              if (showThinking) {
                if (!thinkDetails) {
                  thinkDetails = thinkingNode('');
                  thinkBody = thinkDetails.querySelector('.thinking-body');
                  pending.insertBefore(thinkDetails, body);
                }
                thinkBody.textContent = thinking;
                if (!sawProse) thinkDetails.open = true;
              }
            } else {
              if (!sawProse) {
                sawProse = true;
                if (thinkDetails) thinkDetails.open = false;
              }
              full += text;
              body.textContent = full;
            }
            const stick = nearBottom();
            if (stick) scrollToBottom();
          },
        });
        full = result.text;
        /* M10: [EPISODE_END] marks a natural close; the mark is stripped
         * from the prose BEFORE the page is saved, and the closing rituals
         * run in the background after. */
        const episodeMark = stripEpisodeEnd(full);
        if (episodeMark.ended) {
          episodeEnded = true;
          full = episodeMark.text;
        }
        thinking = result.thinking || thinking;
        finishReason = result.finishReason || null;
        receipt = finalizeReceipt(receiptDraft, {
          ttftMs: result.ttftMs,
          tfftMs: result.tfftMs,
          durationMs: result.durationMs,
          model: connection.model || '',
          effort: reasoning.effort === 'off' ? '' : reasoning.effort,
        });
      } catch (err) {
        if (err && err.name === 'AbortError') {
          stoppedByHand = true;
        } else {
          pending.replaceWith(noteNode(err.message || 'The storyteller went quiet. Try again in a moment.'));
          full = '';
          thinking = '';
        }
      }

      pending.classList.remove('pending');
      /* B9: the reply ran out of room — the page is labeled, and "go on"
       * is the offered next step. */
      const cutShort = !stoppedByHand
        && typeof finishReason === 'string'
        && /max_tokens|length/i.test(finishReason);

      if (full.trim()) {
        if (swipeTarget) {
          /* Swipe mode: the new words become a new version of the SAME
           * page. The old versions are never lost. */
          const fresh = await db.messages.list(story.id);
          const target = fresh.find((m) => m.id === swipeTarget.id);
          if (!target) {
            pending.replaceWith(noteNode('That page went away while the storyteller was writing — the new words were kept nowhere. Ask again and they’ll come as their own page.'));
            return;
          }
          const swipes = Array.isArray(target.swipes) && target.swipes.length
            ? target.swipes.slice()
            : [{ text: pageText(target), ts: target.ts, thinking: target.thinking, receipt: target.receipt }];
          swipes.push({ text: full, ts: Date.now(), thinking: thinking || undefined, receipt });
          const swipeIdx = swipes.length - 1;
          await db.messages.update(story.id, target.id, {
            swipes,
            swipeIdx,
            text: full,
            thinking: thinking || target.thinking,
            receipt,
            cutShort: cutShort || undefined,
            stopped: stoppedByHand || undefined,
          });
          pending.remove();
          await rerenderMessage(story.id, target.id);
          lastRender.ids = []; // the walker changed; next render reconciles
          scrollToBottom();
          stories = await db.stories.list();
          renderStoryList();
          refreshEmber();
          if (story.extraction !== false && !stoppedByHand && !ooc) {
            const updated = (await db.messages.list(story.id)).find((m) => m.id === target.id);
            if (updated) startBackgroundWork(story, updated, userText);
            /* M10: the showrunners read a swiped close all the same. */
            if (!ooc) startShowrunnerWork(story, { episodeEnded });
          }
          return;
        }

        const saved = await db.messages.append(story.id, {
          role: 'assistant',
          text: full,
          thinking: thinking || undefined,
          receipt,
          stopped: stoppedByHand || undefined,
          cutShort: cutShort || undefined,
          ooc: ooc || undefined,
        });
        pending.replaceWith(msgNode(saved, showThinking, { isLastAssistant: true }));
        lastRender.ids = [];
        scrollToBottom();
        stories = await db.stories.list();
        renderStoryList();
        if (ctx.onStoriesChanged) ctx.onStoriesChanged();
        refreshEmber();

        /* M3/M6: the page is finished — hand it to the workers. M9: three
         * separate per-story switches (B12), and an OOC turn teaches no
         * state work at all. */
        if (!ooc && !stoppedByHand) {
          startBackgroundWork(story, saved, userText);
          /* M10: the showrunners run after, off the story path — episode
           * rituals when the mark was struck, auto-director and the
           * editor's cadence otherwise. */
          startShowrunnerWork(story, { episodeEnded });
        }
      } else if (!stoppedByHand) {
        /* B9: nothing came back — named kindly, with a way to ask again. */
        pending.remove();
        els.thread.appendChild(retryNoteNode(
          'The storyteller went quiet — nothing came back. Say the word and I’ll ask again.',
          () => retryAsk()
        ));
        scrollToBottom();
      } else {
        pending.remove();
      }
    } finally {
      abort = null;
      busy = false;
      els.btnStop.hidden = true;
      els.btnSend.hidden = false;
      if (els.emberBar) els.emberBar.classList.remove('live');
      els.input.focus();
    }
  }

  /* B9's retry: re-ask the same turn (the user's words are still last). */
  async function retryAsk() {
    if (busy) return;
    busy = true;
    await generate();
    stories = await db.stories.list();
    renderStoryList();
    refreshEmber();
  }

  /* M9: "Go on" — the continue control. A hidden user page carries the
   * nudge: on the wire once (slot 10 fires from it), never rendered,
   * excluded from history. */
  async function continueTurn() {
    if (busy) return;
    busy = true;
    try {
      const story = await activeStory();
      if (!story) { busy = false; return; }
      const connection = await resolveConnection(story);
      if (!connection) {
        showComposerNote('The tavern needs a storyteller first — add a connection.');
        busy = false;
        return;
      }
      await db.messages.append(story.id, { role: 'user', text: 'continue', hidden: true });
      await generate();
      stories = await db.stories.list();
      renderStoryList();
      refreshEmber();
    } finally {
      busy = false;
    }
  }

  /* M8: the composer never swallows words. M9: the words are parsed for a
   * house command first (commands.js) — the chip says what the house
   * understood; the instruction rides the request hidden. */
  async function send(text) {
    if (busy) return;
    busy = true;
    try {
      let story = await activeStory();
      if (!story) {
        const oneLine = text.replace(/\s+/g, ' ').trim();
        const title = oneLine.length > 40 ? oneLine.slice(0, 40).trimEnd() + '…' : oneLine;
        story = await db.stories.create({ title });
        ctx.setActiveStoryId(story.id);
        await refreshStories(true);
        toast(`“${story.title}” is begun.`);
        if (ctx.onStoriesChanged) ctx.onStoriesChanged();
      }
      const connection = await resolveConnection(story);
      if (!connection) {
        showComposerNote('The tavern needs a storyteller first — add a connection, and these words will still be waiting.');
        restoreComposer(text);
        return;
      }
      hideComposerNote();
      hideHearth();
      els.input.value = '';
      els.input.style.height = '';
      if (els.composerChip) els.composerChip.hidden = true;

      const parsed = parseCommand(text);
      let saved;
      try {
        saved = await db.messages.append(story.id, {
          role: 'user',
          text: parsed.clean,
          hidden: parsed.hidden || undefined,
          ooc: parsed.ooc || undefined,
        });
      } catch (err) {
        /* B1: a full shelf never swallows the words — the writer keeps
         * them and hears why. */
        showComposerNote(err && err.message ? err.message : 'The page wouldn’t save.');
        restoreComposer(text);
        return;
      }
      if (!parsed.hidden) {
        els.thread.appendChild(msgNode(saved));
        lastRender.ids.push(saved.id);
        scrollToBottom();
      }

      await generate({ directive: parsed.directive, ooc: parsed.ooc });
      stories = await db.stories.list();
      renderStoryList();
      refreshEmber();
    } finally {
      busy = false;
    }
  }

  /* ---------- regenerate ("rewrite from here") ---------- */

  async function regenerateFrom(messageId) {
    if (busy) return;
    busy = true;
    try {
      const story = await activeStory();
      if (!story) return;
      const history = await db.messages.list(story.id);
      const at = history.findIndex((m) => m.id === messageId);
      if (at === -1) return;
      const target = history[at];

      /* B5: wait for the workers BEFORE the rewrite — never race a page
       * the extractor is still reading. */
      await pendingWork(story.id, 5000);

      if (target.role === 'assistant') {
        await db.messages.deleteFrom(story.id, target.id);
      } else {
        const next = history[at + 1];
        if (next) await db.messages.deleteFrom(story.id, next.id);
      }
      await renderThread({ structural: true });
      await generate();
      stories = await db.stories.list();
      renderStoryList();
    } finally {
      busy = false;
    }
  }

  /* ---------- swipes (M9) ---------- */

  async function swipeTo(messageId, dir) {
    if (busy) return;
    const story = await activeStory();
    if (!story) return;
    const history = await db.messages.list(story.id);
    const msg = history.find((m) => m.id === messageId);
    if (!msg) return;
    /* M15 audit: with no versions yet, the early return below swallowed
     * the plain "swipe" action whole — a dead button on every fresh page.
     * Swiping right with nothing after writes the first new version. */
    if (!Array.isArray(msg.swipes) || !msg.swipes.length) {
      if (dir > 0 && msg.role === 'assistant') swipeRegenerate(msg);
      return;
    }
    const idx = Number.isFinite(msg.swipeIdx)
      ? Math.min(msg.swipes.length - 1, Math.max(0, msg.swipeIdx))
      : msg.swipes.length - 1;
    const next = idx + dir;
    if (next >= msg.swipes.length) {
      /* Walking past the last version writes a new one (the old keep). */
      swipeRegenerate(msg);
      return;
    }
    if (next < 0) return;
    const shown = msg.swipes[next];
    await db.messages.update(story.id, msg.id, {
      swipeIdx: next,
      text: shown.text,
      thinking: shown.thinking,
      receipt: shown.receipt || msg.receipt,
    });
    await rerenderMessage(story.id, msg.id);
    refreshEmber();
  }

  /* Write another version of this page: re-ask its turn, keep the old
   * versions, land the new one as the shown swipe. B5: the workers finish
   * first; the referee replays the same verdict for the same words. */
  async function swipeRegenerate(msg) {
    if (busy) return;
    busy = true;
    try {
      const story = await activeStory();
      if (!story) return;
      await pendingWork(story.id, 5000);
      await generate({ swipeTarget: msg });
      stories = await db.stories.list();
      renderStoryList();
    } finally {
      busy = false;
    }
  }

  /* ---------- edit (M9) ---------- */

  async function beginEdit(messageId) {
    if (busy) return;
    const story = await activeStory();
    if (!story) return;
    const history = await db.messages.list(story.id);
    const msg = history.find((m) => m.id === messageId);
    if (!msg) return;
    const node = els.thread.querySelector(`.msg[data-id="${messageId}"]`);
    if (!node) return;
    const body = node.querySelector('.msg-body');
    if (!body) return;

    const editor = document.createElement('textarea');
    editor.className = 'edit-box';
    editor.value = pageText(msg);
    editor.rows = Math.min(18, Math.max(3, editor.value.split('\n').length + 1));
    editor.setAttribute('aria-label', 'Re-ink this page');
    const row = document.createElement('div');
    row.className = 'edit-row';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = 'Keep the new words';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'text-btn';
    cancelBtn.textContent = 'Never mind';
    row.append(saveBtn, cancelBtn);
    body.replaceChildren(editor, row);
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);

    let done = false;
    const finish = async (keep) => {
      if (done) return;
      done = true;
      if (keep) {
        const text = editor.value;
        const patch = { text };
        /* An edited shown swipe keeps the versions in step. */
        if (Array.isArray(msg.swipes) && msg.swipes.length) {
          const idx = Number.isFinite(msg.swipeIdx)
            ? Math.min(msg.swipes.length - 1, Math.max(0, msg.swipeIdx))
            : msg.swipes.length - 1;
          const swipes = msg.swipes.slice();
          swipes[idx] = { ...swipes[idx], text };
          patch.swipes = swipes;
        }
        const updated = await db.messages.update(story.id, msg.id, patch);
        toast('The page is re-inked.');
        /* An edited assistant page goes back to the extractor — the ledger
         * re-reads the new words. */
        if (updated && msg.role === 'assistant' && story.extraction !== false && !msg.ooc) {
          const before = history.slice(0, history.indexOf(msg));
          const lastUser = [...before].reverse().find((m) => m && m.role === 'user');
          startBackgroundWork(story, updated, lastUser ? pageText(lastUser) : '');
        }
      }
      await rerenderMessage(story.id, msg.id);
    };
    saveBtn.addEventListener('click', () => finish(true));
    cancelBtn.addEventListener('click', () => finish(false));
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); finish(true); }
    });
  }

  /* ---------- branch (M15): the tale forks from this page ----------

   * A new story is shelved carrying every visible page up to and including
   * this one (hidden nudges stay behind), along with the story's own ways
   * (overrides, cast, connections, switches). The ledger starts clean for
   * the new telling — the engine's checkpoints belong to the old thread. */
  const BRANCH_CARRY = [
    'frameOverride', 'noteOverride', 'brief', 'castNotes', 'connectionId',
    'reasoningEffort', 'extraction', 'keeper', 'continuity', 'castIds',
  ];

  async function branchFrom(messageId) {
    if (busy) return;
    const story = await activeStory();
    if (!story) return;
    const history = await db.messages.list(story.id);
    const at = history.findIndex((m) => m.id === messageId);
    if (at === -1) return;
    const pages = history.slice(0, at + 1).filter((m) => m && !m.hidden);
    const branch = await db.stories.create({ title: story.title + ' — a branch' });
    const carry = {};
    for (const key of BRANCH_CARRY) {
      if (story[key] !== undefined && story[key] !== null) carry[key] = story[key];
    }
    if (Object.keys(carry).length) await db.stories.update(branch.id, carry);
    for (const m of pages) {
      const page = { ...m };
      delete page.id;
      delete page.storyId;
      await db.messages.append(branch.id, page);
    }
    ctx.setActiveStoryId(branch.id);
    await refreshStories(true);
    await renderThread({ structural: true });
    closePanel();
    toast(`The tale forks here — “${branch.title}” waits on the shelf.`);
    if (ctx.onStoriesChanged) ctx.onStoriesChanged();
  }

  /* ---------- message menu (long-press / right-click) ---------- */

  let menuFor = null;
  let pressTimer = null;
  let menuReturnFocus = null;

  function showMenu(x, y, messageId) {
    menuFor = messageId;
    menuReturnFocus = document.activeElement;
    els.menu.hidden = false;
    const rect = els.menu.getBoundingClientRect();
    els.menu.style.left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)) + 'px';
    els.menu.style.top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) + 'px';
    /* B13: the menu answers to the keyboard — first item focused on open,
     * arrows walk, Escape closes and hands the focus back. */
    const first = els.menu.querySelector('button[data-act]');
    if (first) first.focus();
  }

  function hideMenu() {
    els.menu.hidden = true;
    menuFor = null;
    if (menuReturnFocus && typeof menuReturnFocus.focus === 'function') {
      menuReturnFocus.focus();
    }
    menuReturnFocus = null;
  }

  els.menu.addEventListener('keydown', (e) => {
    if (els.menu.hidden) return;
    const items = [...els.menu.querySelectorAll('button[data-act]')];
    const at = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const next = items[(at + step + items.length) % items.length];
      if (next) next.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hideMenu();
    }
  });

  els.thread.addEventListener('contextmenu', (e) => {
    const msg = e.target.closest('.msg');
    if (!msg || !msg.dataset.id) return;
    e.preventDefault();
    showMenu(e.clientX, e.clientY, msg.dataset.id);
  });

  /* B13: Shift+F10 / the context-menu key opens the menu from the
   * keyboard, at the focused page's corner. */
  els.thread.addEventListener('keydown', (e) => {
    const msg = e.target.closest('.msg');
    if (!msg || !msg.dataset.id) return;
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      const rect = msg.getBoundingClientRect();
      showMenu(rect.left + 24, rect.top + 24, msg.dataset.id);
    }
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
    if (e.key === 'Escape' && !els.menu.hidden) hideMenu();
  });

  els.menu.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn || !menuFor) return;
    const id = menuFor;
    hideMenu();
    if (btn.dataset.act === 'copy') {
      copyMessage(id);
    } else if (btn.dataset.act === 'regenerate') {
      regenerateFrom(id);
    } else if (btn.dataset.act === 'edit') {
      beginEdit(id);
    } else if (btn.dataset.act === 'delete') {
      deleteMessage(id);
    } else if (btn.dataset.act === 'go on') {
      continueTurn();
    }
  });

  /* ---------- hover/focus message actions (M8) ---------- */

  async function copyMessage(id) {
    const story = await activeStory();
    const history = story ? await db.messages.list(story.id) : [];
    const msg = history.find((m) => m.id === id);
    if (!msg) return;
    try {
      await navigator.clipboard.writeText(pageText(msg));
      toast('Copied.');
    } catch (err) {
      window.prompt('Copy it by hand, then:', pageText(msg));
    }
  }

  async function deleteMessage(id) {
    const story = await activeStory();
    if (!story || busy) return;
    /* One page lets go — never conflated with rewrite-from-here. */
    const ok = window.confirm('Let this page go? The ones around it stay exactly as written.');
    if (!ok) return;
    await db.messages.remove(story.id, id);
    const node = els.thread.querySelector(`.msg[data-id="${id}"]`);
    if (node) node.remove();
    lastRender.ids = lastRender.ids.filter((x) => x !== id);
    refreshEmber();
    toast('The page is gone.');
  }

  els.thread.addEventListener('click', async (e) => {
    const btn = e.target.closest('.msg-act');
    if (!btn) return;
    const act = btn.dataset.act;
    const id = btn.dataset.id;
    if (act === 'copy') {
      copyMessage(id);
    } else if (act === 'delete') {
      deleteMessage(id);
    } else if (act === 'edit') {
      beginEdit(id);
    } else if (act === 'swipe-prev') {
      swipeTo(id, -1);
    } else if (act === 'swipe-next') {
      swipeTo(id, 1);
    } else if (act === 'swipe') {
      /* The plain "swipe" button walks to the next version — or writes
       * one when there is none yet. */
      swipeTo(id, 1);
    } else if (act === 'branch') {
      branchFrom(id);
    } else if (act === 'go on') {
      continueTurn();
    }
  });

  /* ---------- story panel (mobile slide-over) ---------- */

  /* B3: the scrim belongs to the narrow (slide-over) mode only. On a wide
   * screen the panel sits in the flow — no scrim over the story. */
  function isNarrow() {
    return window.matchMedia('(max-width: 899px)').matches;
  }

  function openPanel() {
    els.panel.classList.add('open');
    els.scrim.hidden = !isNarrow();
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

  /* M15: the shelf's quiet colophon — "the shelves" and the house's
   * version word, at the foot of the sidebar. */
  const panelFoot = document.createElement('p');
  panelFoot.className = 'story-panel-foot lbl';
  panelFoot.textContent = 'the shelves · ' + VERSION;
  els.panel.appendChild(panelFoot);

  /* ---------- composer & new-story form ---------- */

  /* The words stay in the composer until send() knows they can fly —
   * nothing typed is ever lost (M8). */
  els.composer.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = els.input.value.trim();
    if (!text || busy) return;
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
    els.input.style.height = Math.min(els.input.scrollHeight, 190) + 'px';
    /* M9: the command chip — what the house understood, live as you type. */
    if (els.composerChip) {
      const chip = commandChip(els.input.value);
      els.composerChip.textContent = chip;
      els.composerChip.hidden = !chip;
    }
  });

  els.btnStop.addEventListener('click', () => {
    if (abort) abort.abort();
  });

  /* The composer's quiet meta links — deep links into Settings. */
  document.querySelectorAll('.composer-meta [data-goto]').forEach((btn) => {
    btn.addEventListener('click', () => {
      location.hash = '#/settings';
      const target = document.getElementById(btn.dataset.goto);
      if (target) setTimeout(() => target.scrollIntoView({ block: 'start' }), 80);
    });
  });

  /* The "no connection yet" empty state: one tap to the settings floor. */
  if (els.btnAddFirstConnection) {
    els.btnAddFirstConnection.addEventListener('click', () => {
      location.hash = '#/settings';
      const target = document.getElementById('section-connections');
      if (target) setTimeout(() => target.scrollIntoView({ block: 'start' }), 80);
    });
  }

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
    await renderThread({ structural: true });
    closePanel();
    els.input.focus();
    toast(`“${story.title}” is begun.`);
    if (ctx.onStoriesChanged) ctx.onStoriesChanged();
  });

  /* ---------- first light ---------- */

  (async function start() {
    await refreshStories();
    await renderThread({ structural: true });
  })();

  ctx.chat = {
    refreshStories,
    renderThread,
    continueTurn,
  };
}
