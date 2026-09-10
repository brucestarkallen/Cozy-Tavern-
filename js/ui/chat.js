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

import { db, shelvesOf } from '../store.js';
import { createProvider } from '../providers/index.js';
import { buildRequest, pageText } from '../assemble/stack.js';
import { finalizeReceipt } from '../assemble/receipt.js';
import { listModules, selectModules } from '../assemble/modules.js';
import { loadState, saveState, notify, snapshotState, restoreSnapshot , renderMasthead} from '../engine/state.js';
import { applyMutations } from '../engine/apply.js';
import { extractTurn, noteWork, pendingWork, isYoungLedger } from '../agents/extractor.js';
import { enqueueWork } from '../agents/queue.js';
import { pickWorkerConnection } from '../agents/assign.js';
import { scribeTurn } from '../agents/scribe.js';
import { refereeStep, maybeSeedSheet } from '../agents/referee.js';
import { maybeSummarize, loadMemory, renderMemory } from '../agents/memory.js';
import { checkTurn } from '../agents/continuity.js';
import { worldTurn, worldRunWords, worldAgentOn, worldEffort } from '../agents/world.js'; /* M29: the world beyond the page */
import { renderWorldBrief } from '../engine/world.js';
import { workerSignal, noteWorkerRun } from '../agents/status.js';
import { castForStory } from '../import/cards.js';
import { loadLore, matchLoreDetailed } from '../import/lorebook.js';
import { parseCommand, commandChip } from '../commands.js';
import { openReceipt } from './receiptview.js';
/* M22: code blocks + markdown-lite in the prose (E5/E6), the shared
 * download courtesy for the per-story export (E4), and the reasoning
 * ladder's rank for the story's own say (A). */
import { renderRich } from './prose.js';
import { loadRules, currentRules, applyRules } from '../regex.js'; /* M30: the regex shelf */
import { renderHtmlProse, looksHtml } from './richhtml.js'; /* M31: display rules may dress the page in HTML */
import { download } from './download.js';
import { storyToMarkdown, storyToJsonl, storyExportBasename } from './storyexport.js';
import { EFFORT_RANK } from '../providers/effort.js';
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

/* M21: the shelf preview (the Too-Many-Chats lesson, native). A tale's row
 * shows the FIRST sentence or two of its latest page (~120 chars) — never
 * the tail. Bracketed scene-header lines ([The Wayward Lantern — a wet
 * evening]) are skipped, and the thinking voice never leaks in (the
 * preview reads pageText only, which thinking never joins). Pure and
 * exported so the harness can hold it to account. */
export function makePreview(text, max = 120) {
  const clean = String(text == null ? '' : text)
    .split('\n')
    .filter((line) => !SCENE_HEAD_RE.test(line.trim()))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';
  const sentences = clean.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*)?/g) || [clean];
  let out = '';
  let taken = 0;
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (taken >= 2) break; // the first sentence or two, never more
    if (out && (out + ' ' + sentence).length > max) break;
    out = out ? out + ' ' + sentence : sentence;
    taken += 1;
    if (out.length > max) {
      out = out.slice(0, max - 1).trimEnd() + '…';
      break;
    }
  }
  return out;
}

/* M21: the rewind law's boundary. A rewind at a page restores the snapshot
 * taken BEFORE that page's turn began — for an assistant page, the turn
 * began at the nearest user page before it; for a user page, the boundary
 * is the page itself. Pure and exported for the harness. */
export function boundaryFor(history, messageId) {
  const list = Array.isArray(history) ? history : [];
  const at = list.findIndex((m) => m && m.id === messageId);
  if (at === -1) return null;
  for (let i = at; i >= 0; i -= 1) {
    if (list[i] && list[i].role === 'user') return list[i];
  }
  return null;
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
    newShelfPick: document.getElementById('new-story-shelf'),
    btnNew: document.getElementById('btn-new-story'),
    btnCancelNew: document.getElementById('btn-cancel-story'),
    /* M16: the shelves — a new shelf begins from the sidebar. */
    btnNewShelf: document.getElementById('btn-new-shelf'),
    newShelfForm: document.getElementById('new-shelf-form'),
    newShelfName: document.getElementById('new-shelf-name'),
    btnCancelShelf: document.getElementById('btn-cancel-shelf'),
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
    /* M22-E1/E3/E4: the prompt library chips, the jump-to-latest pill,
     * the per-story export menu, and a chip's manage menu. */
    promptChips: document.getElementById('prompt-chips'),
    btnRetry: document.getElementById('btn-retry'),
    btnAttach: document.getElementById('btn-attach'),
    attachFile: document.getElementById('attach-file'),
    attachPreview: document.getElementById('attach-preview'),
    btnJump: document.getElementById('btn-jump'),
    storyMenu: document.getElementById('story-menu'),
    chipMenu: document.getElementById('chip-menu'),
  };

  let stories = [];
  let pageCounts = new Map();
  /* M16: the shelves the tales rest on, and which shelf doors stand folded
   * (persisted, so the sidebar remembers its shape between visits). */
  let projects = [];
  let shelfCollapsed = {};
  let busy = false;
  let abort = null;
  /* M22-E2: whether the resting-tales corner stands open (in-memory; a
   * fresh visit starts folded). */
  let showResting = false;
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

  /* M22-E3: the jump pill shows only while you're reading above the
   * tail — a way back down, never a drag down. */
  function updateJump() {
    if (!els.btnJump) return;
    els.btnJump.hidden = nearBottom();
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

  /* M16: which shelf doors stand folded rides one settings key — a map of
   * shelf id (or 'loose') to true. */
  const SHELF_COLLAPSED_KEY = 'shelfCollapsed';

  async function refreshStories(keepActive) {
    stories = await db.stories.list();
    /* M16: the shelves gather alongside their tales. */
    projects = await db.projects.list();
    shelfCollapsed = (await db.settings.get(SHELF_COLLAPSED_KEY)) || {};
    /* M14: page counts ride the shelf rows; the byStory index counts
     * without reading a single page. */
    const counts = await Promise.all(stories.map((s) => db.messages.count(s.id).catch(() => 0)));
    pageCounts = new Map(stories.map((s, i) => [s.id, counts[i]]));
    /* M21 backfill: a row without a preview derives it from its last page
     * on load. In-memory only — persisting through stories.update would
     * bump updatedAt and reshuffle the shelf the reader remembers. */
    await Promise.all(stories.map(async (s) => {
      if (typeof s.preview === 'string' && s.preview.trim()) return;
      if (!(pageCounts.get(s.id) > 0)) return;
      const pages = await db.messages.list(s.id).catch(() => []);
      const visible = pages.filter((m) => m && !m.hidden);
      const last = visible[visible.length - 1];
      if (last) s.preview = makePreview(pageText(last));
    }));
    if (!keepActive) {
      const id = ctx.getActiveStoryId();
      if (!id || !stories.some((s) => s.id === id)) {
        /* M22-E2: a resting tale never takes the stage on its own. */
        const firstWaking = stories.find((s) => s.archived !== true);
        ctx.setActiveStoryId(firstWaking ? firstWaking.id : null);
      }
    }
    renderStoryList();
    renderShelfPick();
  }

  /* M21: after every append/swipe/delete, the tale's row re-reads its
   * latest page (the shown swipe, hidden nudges aside) and the preview
   * follows. The ledger of previews lives on the story row itself, so it
   * rides backups like every other story field. */
  async function refreshPreview(storyId) {
    if (!storyId) return;
    const pages = await db.messages.list(storyId).catch(() => []);
    const visible = pages.filter((m) => m && !m.hidden);
    const last = visible[visible.length - 1];
    const preview = last ? makePreview(pageText(last)) : '';
    const story = stories.find((s) => s.id === storyId);
    if (story) story.preview = preview;
    await db.stories.update(storyId, { preview }).catch(() => {});
  }

  /* One tale's row — title, last-active in the reader's tense, page count.
   * M22-E2/E4: plus the export (⇩) and the archive (▦) courtesies; a
   * resting tale's row wakes instead of archiving. */
  function storyItem(story, activeId, opts = {}) {
    const li = document.createElement('li');
    li.className = 'story-item' + (story.id === activeId ? ' active' : '') + (opts.resting ? ' resting' : '');

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'story-open';
    const title = document.createElement('span');
    title.className = 'story-title';
    title.textContent = story.title;
    /* M21: the shelf preview — the first sentence or two of the latest
     * page, quiet under the title (the Too-Many-Chats lesson: the
     * beginning, never the tail). */
    const preview = typeof story.preview === 'string' ? story.preview.trim() : '';
    const previewNode = preview ? document.createElement('span') : null;
    if (previewNode) {
      previewNode.className = 'story-preview';
      previewNode.textContent = preview;
    }
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
    if (previewNode) openBtn.append(title, previewNode, meta);
    else openBtn.append(title, meta);
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

    /* M22-E4: take this tale with you — the story's own export, one tap
     * to a chooser of markdown or jsonl. */
    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'story-mini';
    exportBtn.title = 'Take this tale with you';
    exportBtn.setAttribute('aria-label', `Take “${story.title}” with you`);
    exportBtn.textContent = '⇩';
    exportBtn.addEventListener('click', (e) => openStoryMenu(e, story));

    /* M22-E2: archive — the tale rests, out of the sidebar's eye, and a
     * resting tale wakes the same way. Nothing is deleted. */
    const archiveBtn = document.createElement('button');
    archiveBtn.type = 'button';
    archiveBtn.className = 'story-mini';
    archiveBtn.title = opts.resting ? 'Wake this tale' : 'Put this tale to rest';
    archiveBtn.setAttribute('aria-label', `${opts.resting ? 'Wake' : 'Put to rest'} “${story.title}”`);
    archiveBtn.textContent = opts.resting ? '↩' : '▦';
    archiveBtn.addEventListener('click', () => toggleRest(story));

    li.append(openBtn, renameBtn, removeBtn, exportBtn, archiveBtn);
    return li;
  }

  /* M22-E2: archive — the tale rests at the foot of the sidebar (never
   * deleted); a resting tale wakes the same way. If the open tale is put
   * to rest, the next waking tale takes the stage. */
  async function toggleRest(story) {
    const resting = story.archived !== true;
    await db.stories.update(story.id, { archived: resting });
    toast(resting
      ? `“${story.title}” is resting — it waits at the foot of the shelf.`
      : `“${story.title}” is awake again.`);
    if (resting && ctx.getActiveStoryId() === story.id) {
      const all = await db.stories.list();
      const next = all.find((s) => s.archived !== true);
      ctx.setActiveStoryId(next ? next.id : null);
      await refreshStories(true);
      await renderThread({ structural: true });
    } else {
      await refreshStories(true);
    }
    if (ctx.onStoriesChanged) ctx.onStoriesChanged();
  }

  /* M22-E4: the per-story export — the pure builders live in
   * storyexport.js; the download courtesy is shared (download.js). */
  async function exportStory(story, kind) {
    const pages = await db.messages.list(story.id);
    if (!pages.filter((m) => m && !m.hidden).length) {
      toast('This tale has no pages yet — nothing to carry.');
      return;
    }
    const base = storyExportBasename(story);
    if (kind === 'jsonl') {
      download(`${base}.jsonl`, storyToJsonl(story, pages), 'application/x-ndjson');
    } else {
      download(`${base}.md`, storyToMarkdown(story, pages), 'text/markdown');
    }
    toast(`“${story.title}” is in your Downloads — as ${kind === 'jsonl' ? 'jsonl' : 'markdown'}.`);
  }

  /* The export menu is its own little popover (the message menu's
   * menuFor is the message id — these never share). */
  let storyMenuFor = null;

  function openStoryMenu(e, story) {
    e.stopPropagation();
    const menu = els.storyMenu;
    if (!menu) return;
    storyMenuFor = story.id;
    menu.hidden = false;
    menu.style.left = Math.max(8, Math.min(e.clientX, window.innerWidth - 240)) + 'px';
    menu.style.top = Math.max(8, Math.min(e.clientY, window.innerHeight - 120)) + 'px';
    const first = menu.querySelector('button[data-act]');
    if (first) first.focus();
  }

  function hideStoryMenu() {
    if (els.storyMenu) els.storyMenu.hidden = true;
    storyMenuFor = null;
  }

  /* M16: one shelf section — a collapsible .lbl header (caret, name, the
   * shelf's page-count badge) over its tales in interaction-recency order.
   * project === null is the "Loose tales" section. */
  function shelfSection(project, shelfStories, activeId) {
    const key = project ? project.id : 'loose';
    const name = project ? project.name : 'Loose tales';
    const collapsed = shelfCollapsed[key] === true;

    const section = document.createElement('li');
    section.className = 'shelf' + (collapsed ? ' collapsed' : '');

    const head = document.createElement('div');
    head.className = 'shelf-head';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'shelf-toggle lbl';
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    toggle.setAttribute('aria-label', collapsed ? `Open the shelf “${name}”` : `Fold the shelf “${name}”`);
    const caret = document.createElement('span');
    caret.className = 'shelf-caret';
    caret.textContent = collapsed ? '▸' : '▾';
    const label = document.createElement('span');
    label.className = 'shelf-name';
    label.textContent = name;
    const total = shelfStories.reduce((n, s) => n + (pageCounts.get(s.id) || 0), 0);
    const badge = document.createElement('span');
    badge.className = 'shelf-badge';
    badge.textContent = total ? total + (total === 1 ? ' page' : ' pages') : 'unwritten';
    toggle.append(caret, label, badge);
    toggle.addEventListener('click', () => toggleShelf(key));
    head.appendChild(toggle);

    if (project) {
      const renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.className = 'story-mini';
      renameBtn.title = 'Rename the shelf';
      renameBtn.setAttribute('aria-label', `Rename the shelf “${name}”`);
      renameBtn.textContent = '✎';
      renameBtn.addEventListener('click', () => beginShelfRename(head, project));

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'story-mini';
      removeBtn.title = 'Take the shelf down';
      removeBtn.setAttribute('aria-label', `Take down the shelf “${name}” — the tales stay`);
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => removeShelf(project));

      head.append(renameBtn, removeBtn);
    }
    section.appendChild(head);

    if (!collapsed) {
      const inner = document.createElement('ul');
      inner.className = 'shelf-stories';
      for (const story of shelfStories) inner.appendChild(storyItem(story, activeId));
      section.appendChild(inner);
    }
    return section;
  }

  function toggleShelf(key) {
    if (shelfCollapsed[key]) delete shelfCollapsed[key];
    else shelfCollapsed[key] = true;
    db.settings.set(SHELF_COLLAPSED_KEY, shelfCollapsed).catch(() => {});
    renderStoryList();
  }

  function beginShelfRename(head, project) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = project.name;
    input.maxLength = 60;
    input.setAttribute('aria-label', 'A new name for the shelf');
    head.replaceChildren(input);

    let done = false;
    const commit = async (keep) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (keep && name && name !== project.name) {
        await db.projects.rename(project.id, name);
        await refreshStories(true);
        toast(`The shelf is “${name}” now.`);
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

  /* Taking a shelf down NEVER deletes a tale — its stories stand loose. */
  async function removeShelf(project) {
    const ok = window.confirm(
      `Take down the shelf “${project.name}”? The tales on it stay — they simply stand loose.`
    );
    if (!ok) return;
    await db.projects.remove(project.id);
    await refreshStories(true);
    toast(`The shelf “${project.name}” is down — its tales stand loose.`);
    if (ctx.onStoriesChanged) ctx.onStoriesChanged();
  }

  /* M16: the sidebar in sections — each shelf (in shelf order) with its
   * tales, then the loose ones. shelvesOf keeps the recency order
   * stories.list() hands over. */
  function renderStoryList() {
    els.list.textContent = '';
    els.listEmpty.hidden = stories.length > 0;
    const activeId = ctx.getActiveStoryId();
    /* M22-E2: resting (archived) tales step out of the shelves; a quiet
     * row at the foot says how many rest, and taps open to visit (or
     * wake) them. */
    const waking = stories.filter((s) => s.archived !== true);
    const resting = stories.filter((s) => s.archived === true);
    const grouped = shelvesOf(waking, projects);
    for (const { project, stories: onShelf } of grouped.shelves) {
      els.list.appendChild(shelfSection(project, onShelf, activeId));
    }
    if (grouped.loose.length || !projects.length) {
      els.list.appendChild(shelfSection(null, grouped.loose, activeId));
    }
    if (resting.length) els.list.appendChild(restingRow(resting, activeId));
  }

  /* The "N resting tales" row — a collapsed corner at the foot of the
   * sidebar. */
  function restingRow(resting, activeId) {
    const li = document.createElement('li');
    li.className = 'shelf resting-shelf' + (showResting ? '' : ' collapsed');
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'shelf-head';
    const caret = document.createElement('span');
    caret.className = 'shelf-caret';
    caret.textContent = '▸';
    const name = document.createElement('span');
    name.className = 'shelf-name';
    name.textContent = resting.length === 1 ? 'One resting tale' : `${resting.length} resting tales`;
    head.append(caret, name);
    head.addEventListener('click', () => {
      showResting = !showResting;
      renderStoryList();
    });
    const ul = document.createElement('ul');
    ul.className = 'shelf-stories';
    for (const story of resting) ul.appendChild(storyItem(story, activeId, { resting: true }));
    li.append(head, ul);
    return li;
  }

  /* The new-story form's shelf pick: every shelf the house knows, plus
   * loose — defaulting to the shelf the open tale rests on. */
  function renderShelfPick() {
    if (!els.newShelfPick) return;
    const activeId = ctx.getActiveStoryId();
    const open = stories.find((s) => s.id === activeId);
    const current = open && open.projectId && projects.some((p) => p.id === open.projectId)
      ? open.projectId
      : '';
    els.newShelfPick.textContent = '';
    const looseOpt = document.createElement('option');
    looseOpt.value = '';
    looseOpt.textContent = 'Loose — no shelf';
    els.newShelfPick.appendChild(looseOpt);
    for (const project of projects) {
      const opt = document.createElement('option');
      opt.value = project.id;
      opt.textContent = project.name;
      els.newShelfPick.appendChild(opt);
    }
    els.newShelfPick.value = current;
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

  /* M22-C: the folded sources block — where the storyteller looked things
   * up. The links open in a new tab, rel-guarded; they are chrome the wire
   * handed over, never prose markup (the RP-safe subset stays link-free). */
  function sourcesNode(sources) {
    const details = document.createElement('details');
    details.className = 'sources';
    const summary = document.createElement('summary');
    summary.textContent = `where it looked things up — ${sources.length} ${sources.length === 1 ? 'source' : 'sources'}`;
    const list = document.createElement('ul');
    list.className = 'sources-list';
    for (const s of sources) {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.className = 'sources-link';
      link.href = s.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = s.title || s.url;
      li.appendChild(link);
      list.appendChild(li);
    }
    details.append(summary, list);
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
    /* M27: a reader's page can be tried again too — the house rewinds to just
     * after it and hears a fresh answer (ledger rewinds per M21 law). */
    if (msg.role === 'user') acts.push('try again');
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
    if (msg.image && msg.image.dataUrl) {
      const fig = document.createElement('button');
      fig.type = 'button';
      fig.className = 'msg-figure';
      fig.setAttribute('aria-label', 'See the picture whole');
      const im = document.createElement('img');
      im.src = msg.image.dataUrl;
      im.alt = 'A picture from this page';
      im.loading = 'lazy';
      fig.appendChild(im);
      fig.addEventListener('click', () => {
        const veil = document.createElement('div');
        veil.className = 'figure-veil';
        const big = document.createElement('img');
        big.src = msg.image.dataUrl;
        big.alt = 'The picture, whole';
        veil.appendChild(big);
        veil.addEventListener('click', () => veil.remove());
        document.body.appendChild(veil);
      });
      article.appendChild(fig);
    }
    const body = document.createElement('div');
    body.className = 'msg-body';
    if (msg.role === 'assistant') {
      /* M15: scene heads set in the whisper voice; the rest stays prose.
       * M22-E5/E6: the prose is rich — fenced code blocks render mono with
       * a copy chip, and the RP-safe inline marks (*emphasis*, **strong**,
       * `code`) carry through. Never innerHTML. */
      /* M26: the masthead — the house's own header line, pinned on pages that
       * didn't write one. Off when the reader switches it off. */
      /* M30: display-mode regex rules shape what the eye sees; the page
       * keeps its words. */
      const shown = applyRules(pageText(msg), currentRules(), { on: msg.role, mode: 'display' });
      /* M31: a display rule may have dressed the page in HTML — then the
       * whole page renders through the allowlist, and the masthead
       * decision reads the RAW page (a styled header is still a header). */
      const dressed = shown !== pageText(msg) && looksHtml(shown);
      if ((opts.mastheadOn !== false) && msg.masthead) {
        const first = parseScene(pageText(msg))[0];
        if (!(first && first.type === 'head')) {
          const mast = document.createElement('div');
          mast.className = 'scene-head lbl masthead';
          mast.textContent = msg.masthead;
          body.appendChild(mast);
        }
      }
      if (dressed) {
        body.appendChild(renderHtmlProse(shown));
      } else {
        for (const part of parseScene(shown)) {
          if (part.type === 'head') {
            const head = document.createElement('div');
            head.className = 'scene-head lbl';
            head.textContent = part.text;
            body.appendChild(head);
          } else {
            body.appendChild(renderRich(part.text));
          }
        }
      }
    } else {
      body.appendChild(renderRich(pageText(msg)));
    }
    article.appendChild(body);
    /* M22-C: where the storyteller looked things up — a folded sources
     * block under the message. */
    if (msg.role === 'assistant' && Array.isArray(msg.sources) && msg.sources.length) {
      article.appendChild(sourcesNode(msg.sources));
    }
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
    const mastheadOn = (await db.settings.get('masthead')) !== false;
    const connections = els.noConnection ? await db.connections.list() : [];
    if (!story) {
      els.thread.textContent = '';
      lastRender = { storyId: null, ids: [] };
      /* M14: never a blank center — the hearth greets instead. */
      showHearth(stories.length > 0);
      if (els.noConnection) els.noConnection.hidden = connections.length > 0;
      refreshEmber();
      refreshRetry(null);
      return;
    }
    const history = await db.messages.list(story.id);
    refreshRetry(history.filter((m) => !m.hidden));
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
        els.thread.appendChild(msgNode(msg, showThinking, { isLastAssistant: msg.id === lastAssistantId, mastheadOn }));
      }
    } else {
      /* Pages arriving onto a hearth-warmed room: the hearth steps aside. */
      if (visible.length && lastRender.ids.length === 0) hideHearth();
      for (let i = lastRender.ids.length; i < visible.length; i += 1) {
        const msg = visible[i];
        els.thread.appendChild(msgNode(msg, showThinking, { isLastAssistant: msg.id === lastAssistantId, mastheadOn }));
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
    /* M22-E3: opening a story (or a structural rebuild) lands at the
     * latest page; a quiet append while you're reading above the tail
     * never drags you down — the jump pill offers the way back instead. */
    if (structural || nearBottom()) scrollToBottom();
    updateJump();
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
  async function resolveWorkerConnection(story, worker) {
    /* M17: a worker may have hands of its own (Settings → The workers). */
    const map = (await db.settings.get('workerConnections')) || {};
    const legacy = await db.settings.get('workerConnectionId');
    const all = await db.connections.list();
    const picked = pickWorkerConnection({ map, legacy, connections: all }, worker);
    if (picked) return picked;
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
        const connection = await resolveWorkerConnection(story, 'showrunner');
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
      const connection = await resolveWorkerConnection(story, 'extractor');
      if (!connection) return { silent: true };
      const stateBefore = await loadState(story.id);
      /* M27: the founding read. A young ledger (no ground named yet, nobody
       * here yet) reads the pages just before too — the writer often sets
       * the scene in the first posts, and a one-pair read would starve it.
       * M28: the same youth switches the extractor into founding mode (it
       * writes the ground, the people, the hour and the main character down
       * instead of asking "what changed?"), and the writer's brief and cast
       * notes ride along so the names are known. */
      let before = [];
      const young = isYoungLedger(stateBefore);
      if (young) {
        /* "The pages just before this one" — the store lists pages in
         * telling order (ts). Comparing UUID strings (m.id < msg.id) picked
         * an arbitrary handful instead, starving the founding read. */
        const ordered = (await db.messages.list(story.id)).filter((m) => !m.hidden);
        const atSelf = ordered.findIndex((m) => m.id === msg.id);
        const prior = atSelf === -1 ? ordered : ordered.slice(0, atSelf);
        before = prior.slice(-4).map((m) => ({ role: m.role, text: pageText(m) }));
      }
      const { mutations, note: extractNote, failed: extractFailed, raw: extractRaw } = await extractTurn({
        connection,
        state: stateBefore,
        userText,
        assistantText: pageText(msg),
        before,
        founding: young,
        brief: story.brief || '',
        castNotes: story.castNotes || '',
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
      if (extractFailed) throw new Error('no answer reached us');
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
      /* M26: the masthead — the house writes the header line from the
       * ledger's own truth and pins it on the page just written. */
      try {
        const stNow = await loadState(story.id);
        const mast = renderMasthead(stNow);
        if (mast) await reink(story.id, msg.id, { masthead: mast });
      } catch { /* a masthead is a courtesy, never a crisis */ }
      const n = applied.length;
      const refused = rejected.length ? ` (${rejected.length} refused: ${rejected.slice(0, 3).map((r) => r.why).join('; ')})` : '';
      const detail = extractNote === 'unusable'
        ? 'its answer could not be used'
        : extractNote === 'cut short'
          ? 'its answer ran out of room'
          : n ? `wrote ${n} ${n === 1 ? 'change' : 'changes'}${refused}` : 'nothing to write down' + refused;
      return { silent: false, detail, raw: extractRaw };
    });

    /* 1b. The world agent (M29): once the page's own truth has landed,
     * advance the world beyond it by the clock — the absent, the threads,
     * who knows what, the factions, who must now exist — and leave the
     * storyteller a brief for the next turn. Off the send path; the next
     * send reads whatever brief stands (pendingWork's courtesy wait). */
    enqueue('world', async ({ signal, stale }) => {
      if (story.extraction === false) return { silent: true };
      if (!(await worldAgentOn(story))) return { silent: true };
      const connection = await resolveWorkerConnection(story, 'world');
      if (!connection) return { silent: true };
      if (!(await stillThere(story.id, msg.id))) return { silent: true };
      const ordered = (await db.messages.list(story.id)).filter((m) => !m.hidden);
      const atSelf = ordered.findIndex((m) => m.id === msg.id);
      const prior = atSelf === -1 ? ordered : ordered.slice(0, atSelf);
      /* the page before the pair, for the thread of things */
      const before = prior.slice(-3, -1).map((m) => ({ role: m.role, text: pageText(m) }));
      const result = await worldTurn({
        connection,
        storyId: story.id,
        userText,
        assistantText: pageText(msg),
        before,
        brief: story.brief || '',
        castNotes: story.castNotes || '',
        effort: await worldEffort(),
        signal,
        stale,
      });
      /* M31: a garbled answer is not a transport failure — it is said out
       * loud, with what the agent actually said kept for the drawer, and
       * never retried five times over. */
      return { silent: false, detail: worldRunWords(result), raw: result && result.raw };
    });

    /* 2. The scribe (M12): sparse deltas onto the character pages — who
     * they are, where they are, how things stand, loose ends. It answers
     * to the ledger's own switch, like the extractor. */
    enqueue('scribe', async ({ signal, stale }) => {
      if (story.extraction === false) return { silent: true };
      const connection = await resolveWorkerConnection(story, 'scribe');
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
      const connection = await resolveWorkerConnection(story, 'keeper');
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
      const connection = await resolveWorkerConnection(story, 'continuity');
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
        const connection = await resolveWorkerConnection(story, 'seeder');
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
      /* M21: the frame's purpose line (on unless switched off) and its
       * end-of-request echo (off unless switched on). */
      framePurpose: await db.settings.get('framePurpose'),
      framePurposeOn: (await db.settings.get('framePurposeOn')) !== false,
      frameEcho: (await db.settings.get('frameEcho')) === true,
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

  /* M8.5/M22-A: which thinking voice speaks this turn. The story's own
   * choice wins; otherwise the connection's; otherwise the voice stays
   * off. The full ladder is valid here — what the wire can actually SAY
   * is resolved per house inside the provider (effortFor in effort.js). */
  function effectiveReasoning(connection, story) {
    const override = story && typeof story.reasoningEffort === 'string' ? story.reasoningEffort : '';
    if (EFFORT_RANK.includes(override)) return { effort: override };
    const r = connection && connection.reasoning;
    if (r && EFFORT_RANK.includes(r.effort)) return r;
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
        if (nearBottom()) scrollToBottom();
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
      /* M21: TRUE rollback — the boundary snapshot. Before the referee and
       * the worker chain commit anything for this turn, the state as it
       * stands is keyed by this turn's user-message id, so a later rewind
       * (regenerate-from-here, swipe-creation, deleteFrom) can hand the
       * ledger back to exactly here. OOC turns do no state work and take
       * no snapshot. */
      if (!ooc && lastUser) {
        await snapshotState(story.id, lastUser.id, state);
      }
      if (!ooc && lastUser) {
        const { signal, done } = workerSignal(12000); /* the referee's 12s budget */
        try {
          const refSettings = await refereeSettings();
          if (refSettings.on) {
            const workerConnection = await resolveWorkerConnection(story, 'referee');
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
        /* M29: the world agent's word for this turn. */
        worldBrief: renderWorldBrief(state.worldBrief, state.turn),
        /* M30: wire-mode regex rules shape only what the storyteller is sent. */
        pageFilter: (text, role) => applyRules(text, currentRules(), { on: role, mode: 'wire' }),
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
      if (nearBottom()) scrollToBottom();

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
      let streamSources = null; // M22-C: the search's findings
      try {
        const result = await provider.streamChat({
          systemBlocks,
          messages,
          signal: abort.signal,
          onToken({ channel, text }) {
            /* M22-C: the note channel — a provider's live word ("Searching
             * the web…"), toasted, never part of the prose. */
            if (channel === 'note') {
              toast(text);
              return;
            }
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
            } else if (channel === 'prose') {
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
        /* M22: the provider's kind words (a refusal retried once, a
         * prefill that stayed home) reach the writer as toasts, and the
         * search's findings land on the page. */
        if (Array.isArray(result.notes)) {
          for (const note of result.notes) if (note) toast(note);
        }
        if (Array.isArray(result.sources) && result.sources.length) {
          streamSources = result.sources;
        }
        /* M10: [EPISODE_END] marks a natural close; the mark is stripped
         * from the prose BEFORE the page is saved, and the closing rituals
         * run in the background after. */
        const episodeMark = stripEpisodeEnd(full);
        if (episodeMark.ended) {
          episodeEnded = true;
          full = episodeMark.text;
        }
        /* M30: the regex shelf's page-mode rules run on the finished page
         * BEFORE it is saved — what they remove is gone from the story, the
         * history, and every worker's reading. */
        full = applyRules(full, currentRules(), { on: 'storyteller', mode: 'page' });
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
            sources: streamSources || undefined,
            cutShort: cutShort || undefined,
            stopped: stoppedByHand || undefined,
          });
          pending.remove();
          await rerenderMessage(story.id, target.id);
          /* The walker's ids still hold: the page was re-inked in place,
           * no page came or went. Emptying ids here used to make the next
           * render re-append the whole thread — every page twice, and the
           * reader thrown back up the scroll. */
          if (nearBottom()) scrollToBottom();
          await refreshPreview(story.id); // M21: the shelf hears the new version
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
          /* M22-C: where it looked things up, folded under the page. */
          sources: streamSources || undefined,
        });
        pending.replaceWith(msgNode(saved, showThinking, { isLastAssistant: true }));
        /* The pending node was never in the walker's ids; the saved page
         * takes its place at the tail. Record the id — do NOT clear the
         * list: an empty walker passes the append check and the next
         * renderThread re-appends every page, doubling the thread and
         * flinging the reader back to the top. */
        lastRender.ids.push(saved.id);
        scrollToBottom();
        await refreshPreview(story.id); // M21: the shelf hears the new page
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
  refreshRetry(null, true);
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
      /* M33: the storyteller is looked for BEFORE a tale is begun — the old
       * order begat an empty story named after the words ("Hello?") and
       * only then noticed there was no one to answer them. */
      const connection = await resolveConnection(story);
      if (!connection) {
        showComposerNote('The tavern needs a storyteller first — add a connection, and these words will still be waiting.');
        restoreComposer(text);
        return;
      }
      if (!story) {
        const oneLine = text.replace(/\s+/g, ' ').trim();
        const title = oneLine.length > 40 ? oneLine.slice(0, 40).trimEnd() + '…' : oneLine;
        story = await db.stories.create({ title });
        ctx.setActiveStoryId(story.id);
        await refreshStories(true);
        toast(`“${story.title}” is begun.`);
        if (ctx.onStoriesChanged) ctx.onStoriesChanged();
      }
      hideComposerNote();
      hideHearth();
      els.input.value = '';
      els.input.style.height = '';
      if (els.composerChip) els.composerChip.hidden = true;

      const parsed = parseCommand(text);
      /* M30: page-mode rules over the writer's own words (never a house
       * command's hidden page). */
      const cleanWords = parsed.hidden ? parsed.clean : applyRules(parsed.clean, currentRules(), { on: 'writer', mode: 'page' });
      let saved;
      try {
        const imageToSend = pendingImage;
        saved = await db.messages.append(story.id, {
          role: 'user',
          text: cleanWords,
          hidden: parsed.hidden || undefined,
          ooc: parsed.ooc || undefined,
          image: imageToSend || undefined,
        });
        if (imageToSend) setPendingImage(null);
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
        /* M21: the shelf preview follows the newest page, even before the
         * storyteller answers. */
        await refreshPreview(story.id);
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

  /* The visible retry (user law: regeneration must be findable — not only in
   * the long-press menu). Shows when the latest page is the storyteller's. */
  function refreshRetry(msgs, busyNow = false) {
    if (!els.btnRetry) return;
    const last = msgs && msgs[msgs.length - 1];
    els.btnRetry.hidden = !(last && last.role === 'assistant' && !busyNow);
  }
  if (els.btnRetry) {
    els.btnRetry.addEventListener('click', () => {
      const nodes = [...els.thread.querySelectorAll('.msg[data-id]')];
      /* The page's class is msg-assistant (msg-<role>) — looking for a bare
       * "assistant" class found nothing, and the tap died silently. */
      const lastAssistant = [...nodes].reverse().find((n) => n.classList.contains('msg-assistant'));
      if (lastAssistant) regenerateFrom(lastAssistant.dataset.id);
    });
  }

  /* M27: retrying a reader's page = rewind to just after it, then generate.
   * The ledger's M21 snapshots restore whatever the erased answers wrote. */
  /* ---------- M27: a picture for the page ---------- */
  let pendingImage = null;

  function setPendingImage(img) {
    pendingImage = img;
    if (!els.attachPreview) return;
    els.attachPreview.textContent = '';
    if (!img) { els.attachPreview.hidden = true; return; }
    const thumb = document.createElement('img');
    thumb.src = img.dataUrl;
    thumb.alt = 'The picture you are about to share';
    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'attach-drop';
    drop.textContent = '×';
    drop.setAttribute('aria-label', 'Take the picture back');
    drop.addEventListener('click', () => setPendingImage(null));
    els.attachPreview.append(thumb, drop);
    els.attachPreview.hidden = false;
  }

  function readImageFile(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const MAX = 1568;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error('the picture would not read')); return; }
          const reader = new FileReader();
          reader.onload = () => resolve({ dataUrl: reader.result, mediaType: 'image/jpeg' });
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        }, 'image/jpeg', 0.85);
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  if (els.btnAttach && els.attachFile) {
    els.btnAttach.addEventListener('click', () => els.attachFile.click());
    els.attachFile.addEventListener('change', async () => {
      const file = els.attachFile.files && els.attachFile.files[0];
      els.attachFile.value = '';
      if (!file) return;
      try {
        setPendingImage(await readImageFile(file));
      } catch {
        toast('That picture would not read — another one might.');
      }
    });
  }

  async function retryUserMessage(messageId) {
    if (busy) return;
    const story = await activeStory();
    if (!story) return;
    const msgs = await db.messages.list(story.id);
    /* M33: the store lists pages in telling order. The old `m.id > messageId`
     * compared UUID strings — meaningless — so the retry landed on an
     * arbitrary later page, or fell through and answered the tail instead
     * of this page. The first storyteller page AFTER this one, by order. */
    const at = msgs.findIndex((m) => m.id === messageId);
    if (at === -1) return;
    const after = msgs.slice(at + 1).find((m) => m.role === 'assistant' && !m.hidden);
    if (after) {
      await regenerateFrom(after.id);
      return;
    }
    /* no answer followed — the page is the tail: answer it anew. Anything
     * hidden after it (a stale nudge) goes first, so the answer is to
     * THIS page. */
    const trailing = msgs.slice(at + 1);
    if (trailing.length) await db.messages.deleteFrom(story.id, trailing[0].id);
    busy = true;
    try {
      await renderThread({ structural: true });
      await generate();
      stories = await db.stories.list();
      renderStoryList();
    } finally {
      busy = false;
    }
  }

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

      /* M21: TRUE rollback — the ledger lets go of everything the doomed
       * pages caused. Restore the boundary snapshot taken before this
       * turn's user page; the newer snapshots drop with it. The undo log
       * stays independent. */
      const boundary = boundaryFor(history, target.id);
      if (boundary) await restoreSnapshot(story.id, boundary.id);

      if (target.role === 'assistant') {
        await db.messages.deleteFrom(story.id, target.id);
      } else {
        const next = history[at + 1];
        if (next) await db.messages.deleteFrom(story.id, next.id);
      }
      await refreshPreview(story.id); // M21: the shelf re-reads what's left
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
    /* M21: the preview always reads the SHOWN version of the latest page. */
    await refreshPreview(story.id);
    renderStoryList();
    refreshEmber();
  }

  /* Write another version of this page: re-ask its turn, keep the old
   * versions, land the new one as the shown swipe. B5: the workers finish
   * first; the referee replays the same verdict for the same words. M21:
   * the ledger rewinds to the boundary before this turn first, so no
   * consequence of a version that no longer stands survives. */
  async function swipeRegenerate(msg) {
    if (busy) return;
    busy = true;
    try {
      const story = await activeStory();
      if (!story) return;
      await pendingWork(story.id, 5000);
      /* M21: TRUE rollback — swipe-creation restores the boundary too. */
      const historyNow = await db.messages.list(story.id);
      const boundary = boundaryFor(historyNow, msg.id);
      if (boundary) await restoreSnapshot(story.id, boundary.id);
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
    /* M33: it had no class — the browser's own white button in a lamplit
     * room (the "white banner"). Every button the house makes wears the
     * house's clothes (the dom harness checks). */
    saveBtn.className = 'btn';
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
        /* M21: new words on the latest page mean a new preview. */
        await refreshPreview(story.id);
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
    } else if (btn.dataset.act === 'try again') {
      retryUserMessage(id);
    } else if (btn.dataset.act === 'edit') {
      beginEdit(id);
    } else if (btn.dataset.act === 'delete') {
      deleteMessage(id);
    } else if (btn.dataset.act === 'go on') {
      continueTurn();
    }
  });

  /* M22-E4: the per-story export menu. */
  if (els.storyMenu) {
    els.storyMenu.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn || !storyMenuFor) return;
      const story = stories.find((s) => s.id === storyMenuFor);
      const act = btn.dataset.act;
      hideStoryMenu();
      if (!story) return;
      if (act === 'export-md') await exportStory(story, 'md');
      else if (act === 'export-jsonl') await exportStory(story, 'jsonl');
    });
    els.storyMenu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); hideStoryMenu(); }
    });
    document.addEventListener('click', (e) => {
      if (!els.storyMenu.hidden && !els.storyMenu.contains(e.target)) hideStoryMenu();
    });
  }

  /* M22-E5: the code block's copy chip — delegated from the thread. */
  els.thread.addEventListener('click', (e) => {
    const chip = e.target.closest('.codeblock-copy');
    if (!chip) return;
    const block = chip.closest('.codeblock');
    const code = block && block.querySelector('code');
    if (!code) return;
    navigator.clipboard.writeText(code.textContent).then(
      () => { chip.textContent = 'copied'; setTimeout(() => { chip.textContent = 'copy'; }, 1500); },
      () => { window.prompt('Copy it by hand, then:', code.textContent); }
    );
  });

  /* M22-E3: jump to latest — shows while you read above the tail. */
  if (els.btnJump) {
    els.btnJump.addEventListener('click', () => {
      scrollToBottom();
      updateJump();
      els.thread.focus({ preventScroll: true });
    });
    els.thread.addEventListener('scroll', () => updateJump(), { passive: true });
  }

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
    /* M21: with the page gone, the preview re-reads the page before it. */
    await refreshPreview(story.id);
    renderStoryList();
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
    } else if (act === 'try again') {
      /* M33: the row's "try again" was never routed here — only the
       * long-press menu knew the word. A button that renders is a button
       * that answers (the dom harness now presses every act). */
      retryUserMessage(id);
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
    renderShelfPick();
    els.newTitle.focus();
  });

  els.btnCancelNew.addEventListener('click', () => {
    els.newForm.hidden = true;
  });

  els.newForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    /* M16: the tale may begin already resting on a shelf. */
    const shelfId = els.newShelfPick ? els.newShelfPick.value : '';
    const story = await db.stories.create({ title: els.newTitle.value, projectId: shelfId || undefined });
    els.newForm.hidden = true;
    ctx.setActiveStoryId(story.id);
    await refreshStories(true);
    await renderThread({ structural: true });
    closePanel();
    els.input.focus();
    toast(`“${story.title}” is begun.`);
    if (ctx.onStoriesChanged) ctx.onStoriesChanged();
  });

  /* M16: "A new shelf" — a small inline form beside the new-story one. */
  els.btnNewShelf.addEventListener('click', () => {
    els.newShelfForm.hidden = false;
    els.newShelfName.value = '';
    els.newShelfName.focus();
  });

  els.btnCancelShelf.addEventListener('click', () => {
    els.newShelfForm.hidden = true;
  });

  els.newShelfForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const shelf = await db.projects.create({ name: els.newShelfName.value });
    els.newShelfForm.hidden = true;
    await refreshStories(true);
    toast(`A new shelf — “${shelf.name}” waits for tales.`);
    if (ctx.onStoriesChanged) ctx.onStoriesChanged();
  });

  /* ---------- M22-E1: the prompt library ----------
   * Saved one-tap starters as chips above the composer. Tap drops the
   * words into the composer (you still edit or send as-is); long-press or
   * right-click manages (change the words / let it go); the "＋" chip
   * saves what's in the composer — or, when it's empty, asks for a line
   * inline. The library rides a settings key and ships with three warm
   * defaults when it has never been touched. */
  const PROMPTS_KEY = 'promptLibrary';
  /* (The defaults carry no `label` key on purpose — the chip's name is
   * derived from its first words via promptLabel(), and the M14 hearth
   * law counts `label:` literals in this file.) */
  const PROMPT_DEFAULTS = [
    { id: 'pd-open', text: 'Open the scene slowly — where are we, and what does the air feel like?' },
    { id: 'pd-stakes', text: 'Let something go wrong now — small, but real.' },
    { id: 'pd-quiet', text: 'Slow down for a quiet beat between the two of them.' },
  ];
  let promptLib = [];

  function promptLabel(text) {
    const words = String(text || '').trim().split(/\s+/).slice(0, 4).join(' ');
    return words.length > 28 ? words.slice(0, 27) + '…' : (words || 'A starter');
  }

  async function loadPromptLib() {
    const stored = await db.settings.get(PROMPTS_KEY);
    if (Array.isArray(stored)) {
      promptLib = stored
        .filter((p) => p && typeof p.text === 'string' && p.text.trim())
        .map((p, i) => ({ id: typeof p.id === 'string' && p.id ? p.id : `p-${i}`, label: typeof p.label === 'string' && p.label ? p.label : promptLabel(p.text), text: p.text }));
    } else {
      promptLib = PROMPT_DEFAULTS.map((p) => ({ ...p }));
    }
  }

  async function savePromptLib() {
    await db.settings.set(PROMPTS_KEY, promptLib);
  }

  /* Inline word-editing in the chip row — used for a fresh starter and
   * for "change the words". commit(false) abandons. */
  function chipEditRow(existing, commit) {
    if (!els.promptChips) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'prompt-chip-input';
    input.value = existing ? existing.text : '';
    input.maxLength = 300;
    input.setAttribute('aria-label', existing ? 'New words for this starter' : 'A new starter’s words');
    const ghost = document.createElement('span');
    ghost.className = 'prompt-chip editing';
    ghost.appendChild(input);
    els.promptChips.appendChild(ghost);
    let done = false;
    const finish = (keep) => {
      if (done) return;
      done = true;
      const text = input.value.trim();
      ghost.remove();
      commit(keep && text ? text : null);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.focus();
    input.select();
  }

  function renderPromptChips() {
    if (!els.promptChips) return;
    els.promptChips.textContent = '';
    for (const p of promptLib) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'prompt-chip';
      chip.textContent = p.label;
      chip.title = p.text;
      chip.dataset.promptId = p.id;
      chip.addEventListener('click', () => seedComposer(p.text));
      /* Long-press / right-click manages. */
      chip.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openChipMenu(e.clientX, e.clientY, p.id);
      });
      chip.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        const id = p.id;
        chip._pressTimer = setTimeout(() => openChipMenu(touch.clientX, touch.clientY, id), 550);
      }, { passive: true });
      for (const evt of ['touchmove', 'touchend', 'touchcancel']) {
        chip.addEventListener(evt, () => {
          if (chip._pressTimer) { clearTimeout(chip._pressTimer); chip._pressTimer = null; }
        }, { passive: true });
      }
      els.promptChips.appendChild(chip);
    }
    /* The "save one" chip: with words in the composer it saves them;
     * empty, it asks for a line inline. */
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'prompt-chip prompt-chip-add';
    add.textContent = '＋ starter';
    add.title = 'Save a one-tap starter for later';
    add.addEventListener('click', () => {
      const typed = els.input.value.trim();
      if (typed) {
        promptLib.push({ id: `p-${Date.now()}`, label: promptLabel(typed), text: typed });
        savePromptLib();
        renderPromptChips();
        toast('Saved — it waits above the composer now.');
      } else {
        chipEditRow(null, async (text) => {
          if (text) {
            promptLib.push({ id: `p-${Date.now()}`, label: promptLabel(text), text });
            await savePromptLib();
            toast('Saved — it waits above the composer now.');
          }
          renderPromptChips();
        });
      }
    });
    els.promptChips.appendChild(add);
  }

  let chipMenuFor = null;

  function openChipMenu(x, y, promptId) {
    if (!els.chipMenu) return;
    chipMenuFor = promptId;
    els.chipMenu.hidden = false;
    els.chipMenu.style.left = Math.max(8, Math.min(x, window.innerWidth - 220)) + 'px';
    els.chipMenu.style.top = Math.max(8, Math.min(y, window.innerHeight - 120)) + 'px';
    const first = els.chipMenu.querySelector('button[data-act]');
    if (first) first.focus();
  }

  function hideChipMenu() {
    if (els.chipMenu) els.chipMenu.hidden = true;
    chipMenuFor = null;
  }

  if (els.chipMenu) {
    els.chipMenu.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn || !chipMenuFor) return;
      const p = promptLib.find((x) => x.id === chipMenuFor);
      const act = btn.dataset.act;
      hideChipMenu();
      if (!p) return;
      if (act === 'chip-del') {
        promptLib = promptLib.filter((x) => x.id !== p.id);
        await savePromptLib();
        renderPromptChips();
        toast('Let go — the starter is off the shelf.');
      } else if (act === 'chip-edit') {
        chipEditRow(p, async (text) => {
          if (text) {
            p.text = text;
            p.label = promptLabel(text);
            await savePromptLib();
          }
          renderPromptChips();
        });
      }
    });
    els.chipMenu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); hideChipMenu(); }
    });
    document.addEventListener('click', (e) => {
      if (!els.chipMenu.hidden && !els.chipMenu.contains(e.target)) hideChipMenu();
    });
  }

  /* ---------- first light ---------- */

  (async function start() {
    await loadPromptLib();
    renderPromptChips();
    await refreshStories();
    await renderThread({ structural: true });
  })();

  /* M30: the regex shelf is read once here (and again whenever settings
   * saves it), so render paths can apply it without waiting. */
  loadRules().catch(() => {});

  ctx.chat = {
    refreshStories,
    renderThread,
    continueTurn,
  };
}
