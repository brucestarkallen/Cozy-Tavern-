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
 *  - Commands: #question/#p/#pp/#continue/#q/#time/#time skip/#story/#Put TWB and ((…)) / // asides are
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
import { loadState, saveState, notify, snapshotState, restoreSnapshot, restoreNearestSnapshot, renderMasthead, loadSnapshots, saveSnapshots, emptyState, foldJournal, journalReaches, timelineAhead } from '../engine/state.js';
import { applyMutations } from '../engine/apply.js';
import { extractTurn, noteWork, pendingWork, isYoungLedger } from '../agents/extractor.js';
import { enqueueWork } from '../agents/queue.js';
import { pickWorkerConnection } from '../agents/assign.js';
import { scribeTurn } from '../agents/scribe.js';
import { refereeStep, maybeSeedSheet } from '../agents/referee.js';
import { maybeSummarize, loadMemory, renderMemory, saveMemory, memoryAfterDeletion, memoryTruncatedAt, memoryWithoutPage, memoryForWindow, visiblePages, addCorrection } from '../agents/memory.js';
import { checkTurn, mendPages } from '../agents/continuity.js';
import { lintPage, houseEyeWords } from '../agents/lint.js'; /* M88: the house's eye */
import { wholeRecord } from '../agents/memory.js'; /* M35/M51: the whole record as the mender's canon */
import { mcName } from '../engine/duels.js';
import { worldTurn, worldRunWords, worldAgentOn, worldEffort } from '../agents/world.js'; /* M29: the world beyond the page */
import { auditLedger, auditRunWords, auditOn, auditEvery, rebuildStandings, rebuildRunWords, AUDIT_PAGES } from '../agents/auditor.js'; /* M41: the ledger auditor; M50: the rebuild */
import { rebuildRecord, rebuildPeople, restoreRecord, restorePeople, rebuildRecordWords, rebuildPeopleWords } from '../agents/rebuild.js'; /* M52: the gradual rebuilder */
import { foundWorld, founderRunWords, founderFingerprint } from '../agents/founder.js'; /* M45: the founder */
import { renderWorldBrief, renderVoicesBlock } from '../engine/world.js'; /* M85: the voices under the page */
import { workerSignal, noteWorkerRun } from '../agents/status.js';
import { castForStory } from '../import/cards.js';
import { loadLore, matchLoreDetailed, saveLore } from '../import/lorebook.js';
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

  /* M34: a touch device raises its keyboard when the composer is focused,
   * the viewport shrinks, the whole page reflows and the thread jumps — so
   * the house never focuses the composer on its own there. The reader's
   * finger does. (Field report: "after every output it pulls up the keyboard
   * and bounces around the screen.") */
  function isTouch() {
    try {
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
    } catch (err) { /* no matchMedia — a desktop-shaped world */ }
    return 'ontouchstart' in window && (navigator.maxTouchPoints || 0) > 0;
  }
  function focusComposerIfDesktop() {
    if (!isTouch()) els.input.focus();
  }

  function nearBottom() {
    const t = els.thread;
    return t.scrollHeight - t.scrollTop - t.clientHeight < 120;
  }

  /* M37: the follow law (SillyTavern's). While a page streams the thread
   * follows the tail ONLY until the hand moves it up; from then on it stays
   * exactly where the reader put it, and follows again only when the hand
   * brings it back to the tail. The old test — "within 120px" — snapped a
   * reader back down on every token the moment they scrolled a little. */
  let following = true;
  let lastScrollTop = 0;
  let scrollRaf = 0;
  function atTail() {
    const t = els.thread;
    return t.scrollHeight - t.scrollTop - t.clientHeight < 8;
  }
  els.thread.addEventListener('scroll', () => {
    const t = els.thread;
    if (t.scrollTop < lastScrollTop - 2 && !atTail()) following = false; /* the hand went up */
    else if (atTail()) following = true;                                   /* the hand came back */
    lastScrollTop = t.scrollTop;
    updateJump();
  }, { passive: true });
  for (const ev of ['wheel', 'touchmove']) {
    els.thread.addEventListener(ev, () => { if (!atTail()) following = false; }, { passive: true });
  }
  function followTail() {
    if (!following) return;
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; if (following) els.thread.scrollTop = els.thread.scrollHeight; });
  }

  function scrollToBottom() {
    following = true;
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
    /* M55: ▦ drew as a white tile on Android (a "prison bar"); a moon reads
     * as rest and renders as text everywhere. */
    archiveBtn.textContent = opts.resting ? '↩' : '☾';
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

  async function openStoryMenu(e, story) {
    e.stopPropagation();
    const menu = els.storyMenu;
    if (!menu) return;
    storyMenuFor = story.id;
    projects = await db.projects.list(); /* M56: the shelves as they stand now */
    /* M56: move the tale to a shelf — one button per shelf, and "no shelf" */
    const shelves = menu.querySelector('#story-menu-shelves');
    if (shelves) {
      shelves.textContent = '';
      const head = document.createElement('div');
      head.className = 'lbl msg-menu-head';
      head.textContent = 'Move to a shelf';
      shelves.appendChild(head);
      const options = [{ id: '', name: 'No shelf (loose)' }, ...projects.map((p) => ({ id: p.id, name: p.name || 'a shelf' }))];
      for (const opt of options) {
        if ((story.projectId || '') === opt.id) continue;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'menu-item';
        b.setAttribute('role', 'menuitem');
        b.dataset.act = 'move-shelf';
        b.dataset.shelf = opt.id;
        b.textContent = opt.name;
        shelves.appendChild(b);
      }
    }
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
    /* M69: a ledger from a longer telling is caught by its own stamps on open */
    const story = await db.stories.get(id);
    if (story) repairTimeline(story).catch(() => {});
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
  function thinkingWords(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '';
    if (ms < 500) return 'under a second';
    const sec = ms / 1000;
    return sec < 60 ? Math.round(sec) + 's' : Math.floor(sec / 60) + 'm ' + Math.round(sec % 60) + 's';
  }

  function thinkingNode(text, ms) {
    const details = document.createElement('details');
    details.className = 'thinking';
    const summary = document.createElement('summary');
    /* M40: how long it weighed, like SillyTavern's "thought for 12s" */
    const took = thinkingWords(ms);
    summary.innerHTML = '<span class="thinking-arrow" aria-hidden="true">▸</span> what the storyteller weighed' + (took ? ' — thought for <span class="thinking-took">' + took + '</span>' : '');
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
  /* M40: the swipe bar — ◀ n/N ▶ at the foot of the page. Shown on the
   * last storyteller page always (▶ past the last version writes a new
   * one), and on any earlier page that has versions to walk. */
  function swipeNode(msg, { isLastAssistant = false } = {}) {
    const swipes = Array.isArray(msg.swipes) && msg.swipes.length ? msg.swipes : [{ text: msg.text }];
    if (swipes.length < 2 && !isLastAssistant) return null;
    const idx = Array.isArray(msg.swipes) && msg.swipes.length
      ? (Number.isFinite(msg.swipeIdx) ? Math.min(swipes.length - 1, Math.max(0, msg.swipeIdx)) : swipes.length - 1)
      : 0;
    const wrap = document.createElement('div');
    wrap.className = 'swipe-bar';
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
    /* M40: the swipe lives on its own bar (◀ 1/3 ▶) at the page's foot,
     * the SillyTavern way — the word "swipe" left the row. */
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
    return row;
  }

  /* M39: one way to dress a page — the display regex, then the allowlisted
   * HTML or the scene heads + rich prose. msgNode paints a finished page
   * with it; the stream paints every frame with it, so the header card, the
   * spoken colour, the thoughts and the 🎨 styles appear as the words
   * arrive (the SillyTavern way), never only when the page is done. */
  function dressInto(host, text, role) {
    const raw = String(text || '');
    const shown = applyRules(raw, currentRules(), { on: role, mode: 'display' });
    const dressed = shown !== raw && looksHtml(shown);
    const frag = document.createDocumentFragment();
    if (dressed) {
      frag.appendChild(renderHtmlProse(shown));
    } else {
      for (const part of parseScene(shown)) {
        if (part.type === 'head') {
          const head = document.createElement('div');
          head.className = 'scene-head lbl';
          head.textContent = part.text;
          frag.appendChild(head);
        } else {
          frag.appendChild(renderRich(part.text));
        }
      }
    }
    host.replaceChildren(frag);
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
      article.appendChild(thinkingNode(msg.thinking, msg.thinkingMs));
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
    /* M85: the voices the world agent heard elsewhere — the writer's Voices
     * Block, dressed by the 🎨 pack, under the page it followed. */
    if (msg.role === 'assistant') {
      const voices = voicesNode(msg);
      if (voices) article.appendChild(voices);
    }
    /* M22-C: where the storyteller looked things up — a folded sources
     * block under the message. */
    if (msg.role === 'assistant' && Array.isArray(msg.sources) && msg.sources.length) {
      article.appendChild(sourcesNode(msg.sources));
    }
    if (msg.role === 'assistant') {
      const bar = swipeNode(msg, { isLastAssistant: Boolean(opts.isLastAssistant) });
      if (bar) article.appendChild(bar);
    }
    /* M43: a mended page carries no chip on the page — the writer trusts
     * the reader. The mend stays recorded (msg.mended) and the earlier
     * words are a tap away in the drawer's "Something drifted". */
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
  /* M85: the voices fold. The block is written in the preset's own shape
   * ({VOICES} … [VOICE: …] … {/VOICES}) and dressed by the display rules —
   * the writer's SillyTavern styles, shipped as the 🎨 pack — so the reader
   * sees the fold they know; with the styles off it reads as plain lines. */
  function voicesNode(msg) {
    if (!msg || !Array.isArray(msg.voices) || !msg.voices.length) return null;
    const text = renderVoicesBlock(msg.voices);
    if (!text) return null;
    const wrap = document.createElement('div');
    wrap.className = 'msg-voices';
    const shown = applyRules(text, currentRules(), { on: 'storyteller', mode: 'display' });
    if (shown !== text && looksHtml(shown)) {
      wrap.appendChild(renderHtmlProse(shown));
    } else {
      const lbl = document.createElement('div');
      lbl.className = 'lbl';
      lbl.textContent = 'voices, elsewhere';
      wrap.appendChild(lbl);
      for (const v of msg.voices) {
        const line = document.createElement('div');
        line.className = 'voice-line';
        line.textContent = (v.icon ? v.icon + ' ' : '') + v.speaker + (v.channel ? ' · ' + v.channel : '') + ' — ' + v.content;
        wrap.appendChild(line);
      }
    }
    return wrap;
  }

  function refreshVoicesNode(msg) {
    const node = els.thread.querySelector(`.msg[data-id="${msg.id}"]`);
    if (!node) return;
    const old = node.querySelector('.msg-voices');
    if (old) old.remove();
    const fresh = voicesNode(msg);
    if (!fresh) return;
    const body = node.querySelector('.msg-body');
    if (body && body.parentNode === node) body.insertAdjacentElement('afterend', fresh);
    else node.appendChild(fresh);
  }

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

  /* M40: read the pages again. The workers read the last storyteller page
   * with a founding-deep look behind it (the last eight pages), so a
   * ledger that missed something — a worker that ran out of room, a
   * connection that was wrong at the time — can be caught up by hand. */
  async function rescanLedger() {
    const story = await activeStory();
    if (!story) return false;
    const pages = (await db.messages.list(story.id)).filter((m) => !m.hidden);
    const last = [...pages].reverse().find((m) => m.role === 'assistant');
    if (!last) return false;
    const before = pages.slice(0, pages.indexOf(last));
    const lastUser = [...before].reverse().find((m) => m && m.role === 'user');
    startBackgroundWork(story, last, lastUser ? pageText(lastUser) : '', { deep: true });
    toast('The workers are reading the pages again.');
    return true;
  }

  /* M45: found the world, by hand — from the brief, the cast notes, the
   * cards and the lore, regardless of the fingerprint. */
  async function foundNow() {
    const story = await activeStory();
    if (!story) return false;
    const connection = await resolveWorkerConnection(story, 'founder');
    if (!connection) { toast('The founder needs a connection first.'); return false; }
    const promise = enqueueWork(story.id, { name: 'founder', run: async ({ signal, stale }) => {
      const cast = await castForStory(story);
      const lore = await loadLore(story.id);
      const result = await foundWorld({ connection, storyId: story.id, brief: story.brief || '', castNotes: story.castNotes || '', cast, lore, signal, stale });
      return { silent: false, detail: founderRunWords(result), raw: result && result.raw };
    } });
    noteWork(story.id, promise);
    toast('The founder is reading the brief, the cast, the cards and the lore.');
    return true;
  }

  /* M52: the gradual rebuilds — six pages at a time from turn 0, Summaryception's way. */
  async function rebuildRecordNow() {
    const story = await activeStory();
    if (!story) return false;
    const connection = await resolveWorkerConnection(story, 'keeper');
    if (!connection) { toast('The keeper needs a connection first.'); return false; }
    const promise = enqueueWork(story.id, { name: 'keeper', run: async ({ signal, stale }) => {
      const result = await rebuildRecord({ connection, storyId: story.id, signal, stale, onProgress: ({ folded, toFold }) => toast(`Re-folding the record — ${folded} of ${toFold} pages…`) });
      return { silent: false, detail: rebuildRecordWords(result) };
    } });
    noteWork(story.id, promise);
    toast('Re-folding the record from the first page, six pages at a time.');
    return true;
  }
  async function rebuildPeopleNow() {
    const story = await activeStory();
    if (!story) return false;
    const connection = await resolveWorkerConnection(story, 'scribe');
    if (!connection) { toast('The scribe needs a connection first.'); return false; }
    const promise = enqueueWork(story.id, { name: 'scribe', run: async ({ signal, stale }) => {
      const result = await rebuildPeople({ connection, storyId: story.id, brief: story.brief || '', castNotes: story.castNotes || '', signal, stale, onProgress: ({ read, total }) => toast(`Re-reading the people — ${read} of ${total} pages…`) });
      return { silent: false, detail: rebuildPeopleWords(result) };
    } });
    noteWork(story.id, promise);
    toast('Re-reading the people from the first page, six pages at a time.');
    return true;
  }
  async function restoreRecordNow() {
    const story = await activeStory();
    if (!story) return false;
    const ok = await restoreRecord(story.id);
    toast(ok ? 'The old record is back.' : 'No older record is kept.');
    return ok;
  }
  async function restorePeopleNow() {
    const story = await activeStory();
    if (!story) return false;
    const ok = await restorePeople(story.id);
    toast(ok ? 'The old pages and standings are back.' : 'No older pages are kept.');
    return ok;
  }

  /* M50: rebuild every standing by hand — from the brief, the record and the pages. */
  async function rebuildStandingsNow() {
    const story = await activeStory();
    if (!story) return false;
    const connection = await resolveWorkerConnection(story, 'auditor');
    if (!connection) { toast('The auditor needs a connection first.'); return false; }
    const promise = enqueueWork(story.id, { name: 'auditor', run: async ({ signal, stale }) => {
      const result = await rebuildStandings({ connection, storyId: story.id, brief: story.brief || '', castNotes: story.castNotes || '', signal, stale });
      return { silent: false, detail: rebuildRunWords(result), raw: result && result.raw };
    } });
    noteWork(story.id, promise);
    toast('Rebuilding every standing from the brief, the record and the pages.');
    return true;
  }

  /* M41: audit the ledger, by hand. */
  /* M90: THE BRIEF WINS, resolved by the house. An audit issue with
   * pages:true and a fix is a page that contradicted the brief: the pages
   * within reach are mended by the smallest edit (the mender; take-back
   * chips), and a [Correction] line joins the record so every later fold and
   * every later turn carries the brief's truth even where no safe edit was
   * found (the storyteller recolors forward — Canon Definition, Drift
   * Recovery). Nothing here waits for a hand. */
  async function resolveBriefWins(story, connection, result, signal) {
    if (!result || !Array.isArray(result.issues)) return result;
    const wins = result.issues.filter((i) => i && i.pages && i.fix);
    if (!wins.length) return result;
    let mendedPages = 0;
    const all = (await db.messages.list(story.id)).filter((m) => !m.hidden && m.role === 'assistant');
    const last = all[all.length - 1];
    for (const issue of wins) {
      if (last) {
        try {
          const changed = await mendAround(story, connection, [last.id], issue.what + ' It should read: ' + issue.fix, signal, AUDIT_PAGES);
          mendedPages += changed.length;
        } catch (err) { /* a mend that fails leaves the correction to carry the truth */ }
      }
      try {
        const mem = await loadMemory(story.id);
        await saveMemory(story.id, addCorrection(mem, issue.fix + ' (the brief establishes it; the pages that said otherwise were in error).'));
      } catch (err) { /* the record is best-effort; the ledger already holds the lock */ }
    }
    return { ...result, mendedPages };
  }

  async function auditNow() {
    const story = await activeStory();
    if (!story) return false;
    const connection = await resolveWorkerConnection(story, 'auditor');
    if (!connection) { toast('The auditor needs a connection first.'); return false; }
    const promise = enqueueWork(story.id, { name: 'auditor', run: async ({ signal, stale }) => {
      let result = await auditLedger({ connection, storyId: story.id, brief: story.brief || '', castNotes: story.castNotes || '', signal, stale });
      if (result && !stale()) result = await resolveBriefWins(story, connection, result, signal);
      return { silent: false, detail: auditRunWords(result), raw: result && result.raw };
    } });
    noteWork(story.id, promise);
    toast('The auditor is reading the whole ledger.');
    return true;
  }

  /* M35: the mend — the second reader (and the record's verifier) may edit
   * a storyteller page by the smallest amount so it stops contradicting the
   * record. The page remembers its earlier words (msg.mended) and shows a
   * "mended — take it back" chip. Off with the setting mendPages. */
  async function mendOn(story) {
    if (story && story.mend === false) return false;
    return (await db.settings.get('mendPages')) !== false;
  }

  async function applyMend(storyId, page, after, why) {
    const before = String(page.text || '');
    const patch = { text: after, mended: { before, why: String(why || '').slice(0, 300), at: Date.now() } };
    if (Array.isArray(page.swipes) && page.swipes.length) {
      const idx = Number.isFinite(page.swipeIdx) ? Math.min(page.swipes.length - 1, Math.max(0, page.swipeIdx)) : page.swipes.length - 1;
      const swipes = page.swipes.slice();
      swipes[idx] = { ...swipes[idx], text: after };
      patch.swipes = swipes;
    }
    await db.messages.update(storyId, page.id, patch);
    /* M90: the record line covering a mended page is let go, so the keeper
     * folds it again from the corrected words — or the record keeps narrating
     * the contradiction the page no longer contains (Summaryception's law). */
    try {
      const vis = visiblePages(await db.messages.list(storyId));
      const k = vis.findIndex((m) => m.id === page.id);
      if (k !== -1) await saveMemory(storyId, memoryWithoutPage(await loadMemory(storyId), k));
    } catch (err) { /* the keeper's next pass covers the hole anyway */ }
    await rerenderMessage(storyId, page.id);
  }

  async function mendAround(story, connection, pageIds, contradiction, signal, reach = 5) {
    if (!(await mendOn(story))) return [];
    const all = await db.messages.list(story.id);
    const wanted = new Set(pageIds);
    const last = Math.max(...all.map((m, i) => (wanted.has(m.id) ? i : -1)));
    if (last === -1) return [];
    const pages = all.slice(Math.max(0, last - reach), last + 1).filter((m) => !m.hidden);
    const mem = await loadMemory(story.id);
    const state = await loadState(story.id);
    const playerName = mcName(state) !== 'the player' ? mcName(state) : 'the player';
    const changed = await mendPages({
      connection,
      storyId: story.id,
      pages,
      contradiction,
      record: wholeRecord(mem),
      playerName,
      signal,
      apply: (page, after, why) => applyMend(story.id, page, after, why),
    });
    if (changed.length) toast(`The second reader mended ${changed.length} ${changed.length === 1 ? 'page' : 'pages'} — the earlier words are a tap away.`);
    return changed;
  }

  async function unmend(messageId) {
    const story = await activeStory();
    if (!story) return;
    const all = await db.messages.list(story.id);
    const page = all.find((m) => m.id === messageId);
    if (!page || !page.mended) return;
    const patch = { text: page.mended.before, mended: null };
    if (Array.isArray(page.swipes) && page.swipes.length) {
      const idx = Number.isFinite(page.swipeIdx) ? Math.min(page.swipes.length - 1, Math.max(0, page.swipeIdx)) : page.swipes.length - 1;
      const swipes = page.swipes.slice();
      swipes[idx] = { ...swipes[idx], text: page.mended.before };
      patch.swipes = swipes;
    }
    await db.messages.update(story.id, page.id, patch);
    await rerenderMessage(story.id, page.id);
    toast('The earlier words are back.');
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
  /* M72: THE CHAIN GENERATION. The queue's stale() answers only a story
   * switch (never wired, M33), so a reader still working on the OLD words of
   * a page kept writing after an edit, a swipe or a rewind had moved the
   * ledger out from under it — and its checkpoint job saved the rewound
   * ledger under the NEW version's key. Every rewind and fold now turns this
   * counter; a job captures it when queued and treats a turned counter as
   * stale: its reading is let go, never written. A new page's chain does
   * NOT turn it — the previous page's readers must still land. */
  const chainGen = new Map();
  function bumpChain(storyId) {
    const n = (chainGen.get(storyId) || 0) + 1;
    chainGen.set(storyId, n);
    return n;
  }

  function startBackgroundWork(story, msg, userText, { deep = false, audit = false, refound = false } = {}) {
    const gen = chainGen.get(story.id) || 0;
    const enqueue = (name, run) => {
      const promise = enqueueWork(story.id, { name, run: ({ signal, stale }) => run({ signal, stale: () => stale() || (chainGen.get(story.id) || 0) !== gen }) });
      noteWork(story.id, promise);
      return promise;
    };

    /* 0. M45: the founder — before the page is read, the world the writer
     * already wrote (brief, cast notes, cards, lore) becomes ledger, once,
     * and again whenever that material changes (a fingerprint on
     * state.founded). The extractor then founds the scene on top of it. */
    enqueue('founder', async ({ signal, stale }) => {
      if (story.extraction === false) return { silent: true };
      const cast = await castForStory(story);
      const lore = await loadLore(story.id);
      const print = founderFingerprint({ brief: story.brief || '', castNotes: story.castNotes || '', cast, lore });
      if (!print) return { silent: true };
      const st = await loadState(story.id);
      if (st.founded && st.founded.print === print && !refound) return { silent: true };
      const connection = await resolveWorkerConnection(story, 'founder');
      if (!connection) return { silent: true };
      if (stale()) return { silent: true };
      const result = await foundWorld({ connection, storyId: story.id, brief: story.brief || '', castNotes: story.castNotes || '', cast, lore, signal, stale });
      return { silent: false, detail: founderRunWords(result), raw: result && result.raw };
    });

    /* 0b. M88: the house's eye — the page against the craft's mechanical
     * laws, in code, no call: ghost dialogue, echo, the dead phrases, marks
     * on the page, the header. Its findings land on the page (kind 'craft')
     * and its warns ride the storyteller's NEXT turn as the recolor. */
    enqueue('eye', async ({ stale }) => {
      if (stale() || msg.ooc) return { silent: true };
      const st = await loadState(story.id);
      const known = mcName(st);
      const { findings } = lintPage({ mc: known && known !== 'the player' ? known : '', userText, assistantText: pageText(msg), ooc: Boolean(msg.ooc) });
      if (stale() || !(await stillThere(story.id, msg.id))) return { silent: true };
      const current = (await db.messages.list(story.id)).find((m) => m.id === msg.id);
      const others = Array.isArray(current && current.findings) ? current.findings.filter((f) => f && f.kind !== 'craft') : [];
      await reink(story.id, msg.id, { findings: [...findings, ...others] });
      if (findings.length) notify(story.id);
      const warns = findings.filter((f) => f.severity === 'warn').length;
      return { silent: !findings.length, detail: findings.length ? `${findings.length} ${findings.length === 1 ? 'slip' : 'slips'} against the craft` + (warns ? ` (${warns} to recolor next turn)` : '') : '' };
    });

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
      if (young || deep) {
        /* "The pages just before this one" — the store lists pages in
         * telling order (ts). Comparing UUID strings (m.id < msg.id) picked
         * an arbitrary handful instead, starving the founding read. */
        const ordered = (await db.messages.list(story.id)).filter((m) => !m.hidden);
        const atSelf = ordered.findIndex((m) => m.id === msg.id);
        const prior = atSelf === -1 ? ordered : ordered.slice(0, atSelf);
        before = prior.slice(deep ? -8 : -4).map((m) => ({ role: m.role, text: pageText(m) }));
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
      if (extractFailed) throw new Error('no answer reached us');
      const fresh = await loadState(story.id);
      /* M69: every write from this chain is stamped with this page's index */
      { const k = visiblePages(await db.messages.list(story.id)).filter((m) => m.role === 'assistant').findIndex((m) => m.id === msg.id); fresh.page = k === -1 ? fresh.page : k; }
      const { state: next, applied, rejected } = applyMutations(fresh, list);
      if (!applied.length) { await saveState(story.id, next); } /* the stamp stands even when nothing was written */
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
          : n ? `wrote ${n} ${n === 1 ? 'change' : 'changes'}: ` + applied.slice(0, 5).map((a) => a.words.replace(/\.$/, '')).join(' · ') + (n > 5 ? ' · …' : '') + refused : 'nothing to write down' + refused;
      return { silent: false, detail, raw: extractRaw };
    });

    /* 1b. The world agent (M29): once the page's own truth has landed,
     * advance the world beyond it by the clock — the absent, the threads,
     * who knows what, the factions, who must now exist — and leave the
     * storyteller a brief for the next turn. Off the send path; the next
     * send reads whatever brief stands (pendingWork's courtesy wait). */
    enqueue('world', async ({ signal, stale }) => {
      if (story.extraction === false || stale()) return { silent: true };
      if (!(await worldAgentOn(story))) return { silent: true };
      const connection = await resolveWorkerConnection(story, 'world');
      if (!connection) return { silent: true };
      if (!(await stillThere(story.id, msg.id))) return { silent: true };
      const ordered = (await db.messages.list(story.id)).filter((m) => !m.hidden);
      const atSelf = ordered.findIndex((m) => m.id === msg.id);
      const prior = atSelf === -1 ? ordered : ordered.slice(0, atSelf);
      /* the page before the pair, for the thread of things */
      const before = prior.slice(-3, -1).map((m) => ({ role: m.role, text: pageText(m) }));
      /* M85: the voices the last pages carried, so the world rotates its
       * speakers and topics instead of repeating them */
      const voicesBefore = prior.filter((m) => m.role === 'assistant' && Array.isArray(m.voices) && m.voices.length).slice(-3).map((m) => m.voices);
      const result = await worldTurn({
        connection,
        storyId: story.id,
        userText,
        assistantText: pageText(msg),
        before,
        brief: story.brief || '',
        castNotes: story.castNotes || '',
        voicesBefore,
        effort: await worldEffort(),
        signal,
        stale,
      });
      /* M85: the voices land under the page they followed (a re-ink, like
       * the masthead); a read that heard none clears a stale block from an
       * earlier version of the page. */
      if (result && result.note === 'ok' && !stale() && (await stillThere(story.id, msg.id))) {
        const voices = result.brief && Array.isArray(result.brief.voices) ? result.brief.voices : [];
        const latest = await reink(story.id, msg.id, { voices });
        if (latest) refreshVoicesNode(latest);
      }
      /* M31: a garbled answer is not a transport failure — it is said out
       * loud, with what the agent actually said kept for the drawer, and
       * never retried five times over. */
      return { silent: false, detail: worldRunWords(result), raw: result && result.raw };
    });

    /* 2. The scribe (M12): sparse deltas onto the character pages — who
     * they are, where they are, how things stand, loose ends. It answers
     * to the ledger's own switch, like the extractor. */
    enqueue('scribe', async ({ signal, stale }) => {
      if (story.extraction === false || stale()) return { silent: true };
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
      const beforeCount = (await loadMemory(story.id)).nodes.length;
      const mem = await maybeSummarize({
        connection,
        storyId: story.id,
        signal,
        stale, /* M72: a keeper whose ledger was rewound under it writes nothing */
        /* M35: a line's passage contradicts the record → mend those pages */
        onSourceIssue: async ({ issue, fix, span }) => {
          const all = await db.messages.list(story.id);
          const ids = all.slice(span[0], span[1] + 1).map((m) => m.id);
          await mendAround(story, connection, ids, issue + (fix ? '. It should read: ' + fix : ''), signal);
        },
      });
      if (!mem) return { silent: false, detail: 'nothing due yet' };
      const lines = mem.nodes.filter((n) => !n.empty).length;
      const added = mem.nodes.length - beforeCount;
      return { silent: false, detail: `${added > 0 ? 'wrote ' + added + (added === 1 ? ' line' : ' lines') : 'reshaped the record'} — ${lines} ${lines === 1 ? 'line' : 'lines'} on the record` };
    });

    /* 4. The continuity reader (M6): advisory drift notes against canon and
     * the ledgers, stored on the same message. M9 (B12): its own per-story
     * switch too. It never touches the words. */
    enqueue('continuity', async ({ signal, stale }) => {
      /* M35: the second reader is ON by default now — the writer asked for
       * no continuity issues, and a reader that only speaks when asked
       * cannot keep that promise. */
      const on = story.continuity === true
        || (story.continuity !== false && (await db.settings.get('continuityCheck')) !== false);
      if (!on) return { silent: true };
      const connection = await resolveWorkerConnection(story, 'continuity');
      if (!connection) return { silent: true };
      if (stale()) return { silent: true };
      const fresh = await loadState(story.id);
      const { findings } = await checkTurn({
        connection,
        state: fresh,
        assistantText: pageText(msg),
        signal,
      });
      const list = Array.isArray(findings) ? findings : [];
      if (stale()) return { silent: true };
      if (!list.length) return { silent: false };
      if (!(await stillThere(story.id, msg.id))) return { silent: true };
      /* M88: the house's eye wrote its craft findings first — keep them */
      const current = (await db.messages.list(story.id)).find((m) => m.id === msg.id);
      const craft = Array.isArray(current && current.findings) ? current.findings.filter((f) => f && f.kind === 'craft') : [];
      await reink(story.id, msg.id, { findings: [...craft, ...list] });
      notify(story.id); // the drawer's "Something drifted" listens
      /* M35: a warn that carries a fix mends the page by the smallest edit */
      const fixes = list.filter((f) => f.severity === 'warn' && f.fix);
      let mended = 0;
      if (fixes.length) {
        const contradiction = fixes.map((f) => f.words + ' It should read: ' + f.fix).join(' ');
        const changed = await mendAround(story, connection, [msg.id], contradiction, signal);
        mended = changed.length;
      }
      return { silent: false, detail: `${list.length} ${list.length === 1 ? 'finding' : 'findings'}` + (mended ? `, mended ${mended} ${mended === 1 ? 'page' : 'pages'}` : '') };
    });

    /* 4a. M41: the auditor — every few turns (or by hand), the whole ledger
     * against the brief, the pages and the record; what is wrong is set
     * right through the closed vocabulary, what cannot be is noted. */
    enqueue('auditor', async ({ signal, stale }) => {
      if (story.extraction === false || stale()) return { silent: true };
      if (!(await auditOn(story))) return { silent: true };
      const owed = pendingAudit.has(story.id);
      if (!audit && !owed) {
        const visible = (await db.messages.list(story.id)).filter((m) => !m.hidden && m.role === 'assistant').length;
        const every = await auditEvery();
        if (visible === 0 || visible % every !== 0) return { silent: true };
      }
      pendingAudit.delete(story.id);
      const connection = await resolveWorkerConnection(story, 'auditor');
      if (!connection) return { silent: true };
      if (stale()) return { silent: true };
      let result = await auditLedger({ connection, storyId: story.id, brief: story.brief || '', castNotes: story.castNotes || '', signal, stale });
      if (result && !stale()) result = await resolveBriefWins(story, connection, result, signal);
      return { silent: false, detail: auditRunWords(result), raw: result && result.raw };
    });

    /* 4b. M40: the version's checkpoint — the ledger as it stands once the
     * readers have finished, kept for this version of this page. */
    enqueue('checkpoint', async ({ stale }) => {
      if (stale()) return { silent: true };
      if (!(await stillThere(story.id, msg.id))) return { silent: true };
      const all = await db.messages.list(story.id);
      /* M67: an older page owns no checkpoint — except during a replay, when the ledger at this point IS this page's */
      if (!replaying && !isLastAssistantPage(all, msg.id)) return { silent: true };
      const fresh = all.find((m) => m.id === msg.id);
      const idx = fresh && Array.isArray(fresh.swipes) && fresh.swipes.length
        ? (Number.isFinite(fresh.swipeIdx) ? Math.min(fresh.swipes.length - 1, Math.max(0, fresh.swipeIdx)) : fresh.swipes.length - 1)
        : 0;
      await saveVersionState(story.id, msg.id, idx, await loadState(story.id));
      return { silent: true };
    });

    /* 5. The sheet seeder (M11): on the first turns and after a fight lets
     * go, the actor sheet fills itself in the background. It never blocks a
     * turn, and it keeps its own quiet ways (failures stay off the workers
     * line, as M11 shipped them). */
    enqueue('seeder', async ({ signal, stale }) => {
      try {
        if (stale()) return { silent: true };
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

  /* M44: rewind the ledger to the boundary before a turn — the exact
   * checkpoint when it stands, else the nearest earlier one (sparse
   * retention keeps old ones), and then the auditor is asked to set the
   * ledger right against the pages, since a nearest checkpoint is close,
   * not exact. Returns true when something was restored. */
  const pendingAudit = new Set();

  /* M72: THE FOLD IS THE ONLY REWIND. The ledger at the end of storyteller
   * page `targetPage`, rebuilt from the journal (foldJournal: the nearest
   * snapshot as base, every later entry re-applied in page order, no model
   * call), saved; the boundary snapshots that belong to the pages beyond it
   * are let go; the chain generation turns so any reader still working on
   * the pages beyond writes nothing. Returns the folded ledger. */
  async function foldTo(story, targetPage) {
    const current = await loadState(story.id);
    const snaps = await loadSnapshots(story.id);
    const folded = foldJournal(current, snaps, targetPage, applyMutations);
    bumpChain(story.id);
    await saveState(story.id, folded);
    await saveSnapshots(story.id, snaps.filter((e) => !(e.snap && Number.isInteger(e.snap.page) && e.snap.page > targetPage)));
    notify(story.id);
    return folded;
  }

  /* The ledger as it stood BEFORE the turn that answers `userMsgId`: with a
   * journal, the fold to the storyteller page before it (exact under a
   * mid-chain snapshot, M72); for a store from before the journal, the
   * boundary snapshot itself (M21/M44), with an audit owed when only a
   * nearer one survived. */
  async function rewindTo(story, history, userMsgId) {
    if (!userMsgId) return false;
    const list = Array.isArray(history) ? history : [];
    const at = list.findIndex((m) => m && m.id === userMsgId);
    const current = await loadState(story.id);
    if (at !== -1 && (current.journal || []).length) {
      const target = list.slice(0, at).filter((m) => m && m.role === 'assistant' && !m.hidden).length - 1;
      await foldTo(story, target);
      return true;
    }
    const order = list.filter((m) => m && m.role === 'user').map((m) => m.id);
    bumpChain(story.id);
    const r = await restoreNearestSnapshot(story.id, order, userMsgId);
    if (!r) return false;
    if (!r.exact) pendingAudit.add(story.id);
    return true;
  }

  /* M68: THE REPLAY. When history changes at an older page — a version walked
   * or written, an edit kept, a middle page let go — the ledger is rebuilt
   * from there: fold to the page before the change, read the changed page
   * once, re-apply the later pages' writes exactly from the journal, re-take
   * every boundary after. Summaryception rewinds its ledger by replaying a
   * journal; the house replays the pages.
   *
   * M72: THE REPLAY IS SEQUENCED. It used to await the whole queue after
   * queuing one chain, on the UI thread, while a send could slip in and a
   * second history change was silently refused. Now: the fold is immediate
   * (after the readers in flight have landed — their entries must be in the
   * journal before it is folded), the one reading is a chain like any other,
   * and the tail — the later pages' writes, the boundaries, the last page's
   * checkpoint — is a job queued BEHIND that chain, so it always runs after
   * it and before any newer page's readers. A send during the replay behaves
   * as under the latency law (one turn with the ledger as far as it got);
   * a second history change waits for `replaying` to clear. */
  let replaying = false;
  function isReplaying() { return replaying; }
  async function replayFrom(story, fromMessageId, { changed = true, shiftAfter = null, kOverride = null, atOverride = null } = {}) {
    if (replaying) return false;
    replaying = true;
    let tailQueued = false;
    try {
      /* the readers in flight land first — their writes belong to the timeline being folded */
      await pendingWork(story.id, 120000);
      const history = await db.messages.list(story.id);
      const vis = visiblePages(history);
      const at = atOverride !== null ? atOverride : vis.findIndex((m) => m.id === fromMessageId);
      if (at === -1) return false;
      const assistantIndex = (id) => vis.filter((m) => m.role === 'assistant').findIndex((m) => m.id === id);
      const k = kOverride !== null ? kOverride : assistantIndex(fromMessageId); /* storyteller-page index of the change */
      const current = await loadState(story.id);
      /* the writes that come after the change: after page k when its words changed (k is re-read); from page k on when page k was let go (they shift down) */
      const later = (current.journal || []).filter((e) => e.p > k);
      /* 1. fold to the page before the change */
      await foldTo(story, k - 1);
      const gen = chainGen.get(story.id) || 0;
      await saveMemory(story.id, memoryTruncatedAt(await loadMemory(story.id), at));
      { const all = await loadVersionStates(story.id); const staleIds = new Set(vis.slice(at).map((m) => m.id)); for (const key of Object.keys(all)) if (staleIds.has(key.split(':')[0])) delete all[key]; await db.settings.set('versionState:' + story.id, all); }
      /* 2. one reading for the page whose words changed */
      let pages = 0;
      if (changed && vis[at] && vis[at].role === 'assistant' && !vis[at].ooc) {
        const lastUser = [...vis.slice(0, at)].reverse().find((x) => x.role === 'user');
        startBackgroundWork(story, vis[at], lastUser ? pageText(lastUser) : '');
        pages = 1;
      }
      /* 3. the tail, queued behind that chain */
      tailQueued = true;
      const tail = enqueueWork(story.id, { name: 'checkpoint', run: async () => {
        try {
          if ((chainGen.get(story.id) || 0) !== gen) return { silent: true }; /* a rewind cut in — the fold that did it is the truth now */
          let st = await loadState(story.id);
          const groups = new Map();
          for (const e of later) { const p = shiftAfter !== null && e.p > shiftAfter ? e.p - 1 : e.p; if (!groups.has(p)) groups.set(p, []); groups.get(p).push(e); }
          for (const p of [...groups.keys()].sort((a, b) => a - b)) { st.page = p; st = applyMutations(st, groups.get(p).sort((a, b) => a.id - b.id).map((e) => e.m)).state; }
          const lastIndex = vis.filter((m) => m.role === 'assistant').length - 1;
          st.page = Math.max(st.page, lastIndex);
          await saveState(story.id, st);
          /* the boundaries after the change are re-taken from the folded timeline — the
           * snapshots before it are the bases (never an empty ledger, M72) */
          const bases = (await loadSnapshots(story.id)).filter((e) => e.snap && Number.isInteger(e.snap.page) && e.snap.page < k);
          for (let i = at; i < vis.length; i += 1) {
            if (vis[i].role !== 'user') continue;
            const nextA = vis.slice(i).find((m) => m.role === 'assistant');
            const upto = nextA ? assistantIndex(nextA.id) - 1 : lastIndex;
            await snapshotState(story.id, vis[i].id, foldJournal(st, bases, upto, applyMutations));
          }
          /* M67: the last page's shown version owns the present */
          const lastA = [...vis].reverse().find((m) => m.role === 'assistant');
          if (lastA) {
            const fresh = (await db.messages.list(story.id)).find((m) => m.id === lastA.id);
            const idx = fresh && Array.isArray(fresh.swipes) && fresh.swipes.length
              ? (Number.isFinite(fresh.swipeIdx) ? Math.min(fresh.swipes.length - 1, Math.max(0, fresh.swipeIdx)) : fresh.swipes.length - 1)
              : 0;
            if (fresh) await saveVersionState(story.id, lastA.id, idx, st);
          }
          pendingAudit.delete(story.id);
          notify(story.id);
          toast(`History changed at page ${at + 1} — the ledger was folded back and rebuilt${pages ? ' with one reading' : ''}.`);
          return { silent: true };
        } finally {
          replaying = false;
        }
      } });
      noteWork(story.id, tail);
      return true;
    } finally {
      if (!tailQueued) replaying = false;
    }
  }

  /* M69: judge the ledger by its own stamps when a story opens (Summaryception's
   * repairIfBranched) — a page stamp past the end means another timeline's
   * ledger; fold it back to the last page that exists. M72: never while the
   * house is writing (a page's stamp is ahead of the store by design until
   * the page lands) and never during a replay. */
  async function repairTimeline(story) {
    if (!story || busy || replaying) return false;
    const history = await db.messages.list(story.id);
    const vis = visiblePages(history);
    const pages = vis.filter((m) => m.role === 'assistant').length;
    const state = await loadState(story.id);
    const why = timelineAhead(state, pages);
    if (!why.length) return false;
    await foldTo(story, pages - 1);
    await saveMemory(story.id, memoryTruncatedAt(await loadMemory(story.id), vis.length));
    toast('The ledger belonged to a longer telling (' + why[0] + ') — folded back to this one.');
    return true;
  }

  /* M67: a version checkpoint belongs to the LAST storyteller page only. An
   * older page's versions never own a ledger — the ledger standing now is
   * the later turns', not theirs — so walking or re-writing an older page
   * changes its words, lets its record line go, and asks the auditor; it
   * never rewinds, restores, or saves a checkpoint. (The turn-10 ledger was
   * being saved under page 0's key by a swipe walked on page 0, and a branch
   * at page 0 then carried it faithfully.) */
  function isLastAssistantPage(history, messageId) {
    const list = Array.isArray(history) ? history : [];
    const at = list.findIndex((m) => m && m.id === messageId);
    if (at === -1) return false;
    return !list.slice(at + 1).some((m) => m && m.role === 'assistant' && !m.hidden);
  }

  /* M40: every VERSION of a page keeps the ledger as it stood after its
   * workers finished — Summaryception's per-swipe checkpoint. Walking back
   * to a version restores its ledger; a version with none yet gets the
   * boundary and a fresh reading. Store: versionState:<storyId> = {
   * '<msgId>:<swipeIdx>': state }, capped at 60. */
  async function loadVersionStates(storyId) {
    const saved = await db.settings.get('versionState:' + storyId);
    return saved && typeof saved === 'object' ? saved : {};
  }
  async function saveVersionState(storyId, messageId, swipeIdx, state) {
    const all = await loadVersionStates(storyId);
    all[messageId + ':' + swipeIdx] = JSON.parse(JSON.stringify(state));
    const keys = Object.keys(all);
    if (keys.length > 60) for (const k of keys.slice(0, keys.length - 60)) delete all[k];
    await db.settings.set('versionState:' + storyId, all);
  }
  async function versionStateFor(storyId, messageId, swipeIdx) {
    const all = await loadVersionStates(storyId);
    return all[messageId + ':' + swipeIdx] || null;
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
    const { directive = '', ooc = false, swipeTarget = null, replayAfter = false } = opts;
    let receipt = null;
    let landed = false; /* M40: true once a page (or a version) was written */
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
      /* M72: the coming page's index is the stamp for everything this turn
       * writes before the page lands — the referee's opening call above all.
       * Stamped with the previous page, a branch at that page carried a fight
       * begun by a message the branch does not contain. (The stamp runs ahead
       * of the store until the page lands; repairTimeline stays out of a
       * busy house, and a page that never lands is folded back on open.) */
      if (!ooc && lastUser) {
        state.page = history.filter((m) => m && m.role === 'assistant' && !m.hidden).length;
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
      /* M21: TRUE rollback — the boundary snapshot, keyed by this turn's user
       * page. M72: taken AFTER the referee, so it carries the committed fate
       * (the rewound ledger used to have no commit, and a swipe rolled the
       * die again) and this turn's page stamp; a fold never re-arms the
       * ruling it holds. OOC turns do no state work and take no snapshot. */
      if (!ooc && lastUser) {
        await snapshotState(story.id, lastUser.id, state);
      }

      const allModules = await listModules();
      /* M85-002: the writer's own words for this turn ride to the predicates
       * (the intimate rule wakes a beat before the extractor's flag). */
      const selected = selectModules(allModules, { ...state, castNotes: story.castNotes || '', turnText: lastUser && !lastUser.hidden ? pageText(lastUser) : '' });
      /* M6: slot 7 — what the keeper has folded of the older pages. */
      const mem = await loadMemory(story.id);
      /* M44: a line and the page it summarizes never ride together */
      const verbatimStart = Math.max(0, visiblePages(history).length - (mem && Number.isFinite(mem.window) && mem.window > 0 ? mem.window : ((await db.settings.get('memoryWindow')) || 30)));
      const memoryText = renderMemory(memoryForWindow(mem, verbatimStart));
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
        /* M88: the house's eye — the LAST page's slips against the craft,
         * for this one turn's silent recolor (never a standing nag). */
        houseEye: (() => { const lastA = [...history].reverse().find((m) => m && m.role === 'assistant' && !m.hidden); return lastA ? houseEyeWords(lastA.findings) : ''; })(),
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
      /* M40: the thinking clock — starts at the first thought, stops at the
       * first word of prose (or the end); shown live, kept on the page. */
      let thinkStart = 0;
      let thinkMs = 0;
      let thinkTimer = 0;
      const stopThinkClock = () => {
        if (thinkStart && !thinkMs) thinkMs = Math.max(1, Date.now() - thinkStart);
        if (thinkTimer) { clearInterval(thinkTimer); thinkTimer = 0; }
        if (thinkDetails) {
          const took = thinkDetails.querySelector('.thinking-took');
          if (took) took.textContent = thinkingWords(thinkMs);
        }
      };
      /* M39: the live paint — dressed, at most once per frame */
      let paintRaf = 0;
      const paintLive = () => {
        if (paintRaf) return;
        paintRaf = requestAnimationFrame(() => {
          paintRaf = 0;
          try { dressInto(body, full, 'assistant'); } catch (err) { body.textContent = full; }
        });
      };
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
              if (!thinkStart) {
                thinkStart = Date.now();
                thinkTimer = setInterval(() => {
                  const took = thinkDetails && thinkDetails.querySelector('.thinking-took');
                  if (took) took.textContent = thinkingWords(Date.now() - thinkStart) + '…';
                }, 1000);
              }
              if (showThinking) {
                if (!thinkDetails) {
                  thinkDetails = thinkingNode('', 1);
                  thinkBody = thinkDetails.querySelector('.thinking-body');
                  pending.insertBefore(thinkDetails, body);
                }
                thinkBody.textContent = thinking;
                if (!sawProse) thinkDetails.open = true;
              }
            } else if (channel === 'prose') {
              if (!sawProse) {
                sawProse = true;
                stopThinkClock();
                if (thinkDetails) thinkDetails.open = false;
              }
              full += text;
              paintLive();
            }
            followTail();
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
        stopThinkClock();
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
          stopThinkClock();
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
        landed = true;
        if (swipeTarget) {
          /* Swipe mode: the new words become a new version of the SAME
           * page. The old versions are never lost. */
          const fresh = await db.messages.list(story.id);
          const target = fresh.find((m) => m.id === swipeTarget.id);
          if (!target) {
            pending.replaceWith(noteNode('That page went away while the storyteller was writing — the new words were kept nowhere. Ask again and they’ll come as their own page.'));
            return false;
          }
          const swipes = Array.isArray(target.swipes) && target.swipes.length
            ? target.swipes.slice()
            : [{ text: pageText(target), ts: target.ts, thinking: target.thinking, receipt: target.receipt }];
          swipes.push({ text: full, ts: Date.now(), thinking: thinking || undefined, thinkingMs: thinkStart ? Math.max(1, thinkMs) : undefined, receipt });
          const swipeIdx = swipes.length - 1;
          await db.messages.update(story.id, target.id, {
            swipes,
            swipeIdx,
            text: full,
            thinking: thinking || target.thinking,
            thinkingMs: thinkStart ? Math.max(1, thinkMs) : undefined,
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
          /* M72: a new version of an OLDER page is read by the replay (the
           * caller folds first) — read here, on top of the latest ledger, its
           * people sat down at page N. */
          if (story.extraction !== false && !ooc && !replayAfter) {
            const updated = (await db.messages.list(story.id)).find((m) => m.id === target.id);
            if (updated) startBackgroundWork(story, updated, userText);
          }
          /* M10: the showrunners read a swiped close all the same. */
          if (!ooc) startShowrunnerWork(story, { episodeEnded });
          return landed; /* M68: the swipe path returned undefined — read as "nothing landed", the caller put the OLD ledger back over the new version */
        }

        const saved = await db.messages.append(story.id, {
          role: 'assistant',
          text: full,
          thinking: thinking || undefined,
          thinkingMs: thinkStart ? Math.max(1, thinkMs) : undefined,
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
        /* M34: the scroll law (M27) holds at the landing too — the thread
         * moves only if the reader was already at its tail. */
        if (nearBottom()) scrollToBottom();
        await refreshPreview(story.id); // M21: the shelf hears the new page
        stories = await db.stories.list();
        renderStoryList();
        if (ctx.onStoriesChanged) ctx.onStoriesChanged();
        refreshEmber();

        /* M3/M6: the page is finished — hand it to the workers. M9: three
         * separate per-story switches (B12), and an OOC turn teaches no
         * state work at all. M72: a page stopped by hand is read too — its
         * words stand in the story and the storyteller sees them; a page cut
         * short by the provider always was. A retry folds the reading away. */
        if (!ooc) {
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
      focusComposerIfDesktop();
    }
    return landed;
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
    /* M68: a send while the house is busy keeps the words and says so —
     * it used to drop them silently, a message that simply vanished. */
    if (busy) { restoreComposer(text); toast('The storyteller is still busy — one moment.'); return; }
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
      /* M85: #story — the writer's own command for a new tale: a fresh
       * story, named from the concept, opened before the words are sent;
       * the storyteller writes the first scene at once (the craft's
       * No Proposals). The old tale keeps its ledger untouched. */
      const early = parseCommand(text);
      if (early.kind === 'story') {
        story = await db.stories.create({ title: early.name || 'A new tale' });
        ctx.setActiveStoryId(story.id);
        await refreshStories(true);
        toast(`“${story.title}” is begun.`);
        if (ctx.onStoriesChanged) ctx.onStoriesChanged();
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
    if (replaying) { toast('The ledger is still being rebuilt — one moment, then try again.'); return; }
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
    if (replaying) { toast('The ledger is still being rebuilt — one moment, then try again.'); return; }
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
      if (boundary) await rewindTo(story, history, boundary.id);

      /* M44: the record lets go of every line that reached the pages now gone */
      const firstGone = target.role === 'assistant' ? target : history[at + 1];
      if (firstGone) {
        const vis = visiblePages(history);
        const k = vis.findIndex((m) => m.id === firstGone.id);
        if (k !== -1) await saveMemory(story.id, memoryTruncatedAt(await loadMemory(story.id), k));
      }
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
    if (replaying) { toast('The ledger is still being rebuilt — one moment.'); return; }
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
    const last = isLastAssistantPage(history, msg.id);
    /* M40: the version being left keeps the ledger it earned — the last page only (M67) */
    if (last) await saveVersionState(story.id, msg.id, idx, await loadState(story.id));
    const updated = await db.messages.update(story.id, msg.id, {
      swipeIdx: next,
      text: shown.text,
      thinking: shown.thinking,
      thinkingMs: shown.thinkingMs,
      receipt: shown.receipt || msg.receipt,
    });
    /* M68: an older page's shown version changed — history changed; replay
     * from here. M72: claimed the moment the store holds the new version —
     * before any rendering — so nothing can slip in between and find the
     * house idle. */
    if (!last) replayFrom(story, msg.id, { changed: true });
    await rerenderMessage(story.id, msg.id);
    if (!last) {
      await refreshPreview(story.id);
      renderStoryList();
      refreshEmber();
      return;
    }
    /* M40: the version walked to gets ITS ledger back — or, never read, the
     * boundary before the turn and a fresh reading by the workers. */
    const known = await versionStateFor(story.id, msg.id, next);
    if (known) {
      bumpChain(story.id); /* M72: the version being left may still have readers in flight */
      await saveState(story.id, known);
      notify(story.id);
    } else {
      const boundary = boundaryFor(history, msg.id);
      if (boundary) await rewindTo(story, history, boundary.id);
      { const vis = visiblePages(history); const k = vis.findIndex((m) => m.id === msg.id); if (k !== -1) await saveMemory(story.id, memoryWithoutPage(await loadMemory(story.id), k)); }
      if (updated && msg.role === 'assistant' && story.extraction !== false && !msg.ooc) {
        const before = history.slice(0, history.findIndex((m) => m.id === msg.id));
        const lastUser = [...before].reverse().find((m) => m && m.role === 'user');
        startBackgroundWork(story, updated, lastUser ? pageText(lastUser) : '');
      }
    }
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
    if (busy) { toast('The storyteller is still busy — one moment, then swipe.'); return; } /* M82: a dropped press says so (M62-002's law) */
    if (replaying) { toast('The ledger is still being rebuilt — one moment, then swipe.'); return; }
    busy = true;
    try {
      const story = await activeStory();
      if (!story) return;
      await pendingWork(story.id, 5000);
      /* M40: the ledger as it stands — the version being left keeps it, and
       * a cancelled or empty swipe gives it straight back (the ledger used
       * to vanish when the writer stopped a swipe halfway). */
      const historyNow = await db.messages.list(story.id);
      const leaving = await loadState(story.id);
      const lastPage = isLastAssistantPage(historyNow, msg.id);
      const leavingIdx = Array.isArray(msg.swipes) && msg.swipes.length
        ? (Number.isFinite(msg.swipeIdx) ? Math.min(msg.swipes.length - 1, Math.max(0, msg.swipeIdx)) : msg.swipes.length - 1)
        : 0;
      if (lastPage) await saveVersionState(story.id, msg.id, leavingIdx, leaving);
      /* M21: TRUE rollback — swipe-creation restores the boundary too — for the
       * last page. An older page's new version never rewinds the later turns'
       * ledger (M67); the auditor reconciles after the readers see the new words. */
      if (lastPage) {
        const boundary = boundaryFor(historyNow, msg.id);
        if (boundary) await rewindTo(story, historyNow, boundary.id);
      }
      /* M44: a swiped page's record line is let go (a hole, refilled) */
      { const vis = visiblePages(historyNow); const k = vis.findIndex((m) => m.id === msg.id); if (k !== -1) await saveMemory(story.id, memoryWithoutPage(await loadMemory(story.id), k)); }
      const landed = await generate({ swipeTarget: msg, replayAfter: !lastPage });
      /* M72: a new version on an OLDER page is history changed at that page —
       * fold back, read the new words once, re-apply the rest (it used to be
       * read on top of the latest ledger and left to the auditor). M73-002:
       * claimed the moment generate returns — its own finally has already let
       * busy go, and any await before the claim is a gap where the house
       * looks idle and a branch slips in. */
      if (landed && !lastPage) replayFrom(story, msg.id, { changed: true });
      if (!landed && lastPage) {
        await saveState(story.id, leaving);
        notify(story.id);
      }
      stories = await db.stories.list();
      renderStoryList();
    } finally {
      busy = false;
    }
  }

  /* ---------- edit (M9) ---------- */

  async function beginEdit(messageId) {
    if (busy) return;
    if (replaying) { toast('The ledger is still being rebuilt — one moment, then edit.'); return; }
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
        /* M44: the edited page's record line is let go (a hole, refilled).
         * The LAST storyteller page is re-read from the boundary before its
         * turn (the old version's consequences must not stand); an older
         * page's edit is replayed from there (M68/M69). M72: the ledger work
         * is claimed before any rendering, so nothing finds the house idle
         * in between. */
        { const vis = visiblePages(history); const k = vis.findIndex((m) => m.id === msg.id); if (k !== -1) await saveMemory(story.id, memoryWithoutPage(await loadMemory(story.id), k)); }
        if (updated && msg.role === 'assistant' && story.extraction !== false && !msg.ooc) {
          const before = history.slice(0, history.indexOf(msg));
          const lastUser = [...before].reverse().find((m) => m && m.role === 'user');
          const isLast = !history.slice(history.indexOf(msg) + 1).some((m) => m && m.role === 'assistant' && !m.hidden);
          if (isLast) {
            const boundary = boundaryFor(history, msg.id);
            if (boundary) await rewindTo(story, history, boundary.id);
            startBackgroundWork(story, updated, lastUser ? pageText(lastUser) : '');
          } else {
            replayFrom(story, updated.id, { changed: true });
          }
        } else if (updated && msg.role === 'user') {
          pendingAudit.add(story.id);
        }
        toast('The page is re-inked.');
        /* M21: new words on the latest page mean a new preview. */
        await refreshPreview(story.id);
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
    'projectId', /* M55: a branch stays on its project's shelf */
    'workerConnections', 'mend', 'audit', 'worldAgent',
  ];

  async function branchFrom(messageId) {
    if (busy || replaying) { toast('The house is still writing — one moment, then branch.'); return; }
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
    const idMap = {};
    for (const m of pages) {
      const page = { ...m };
      delete page.id;
      delete page.storyId;
      const saved = await db.messages.append(branch.id, page);
      if (saved && saved.id) idMap[m.id] = saved.id;
    }
    /* M43: the branch carries its checkpoint (Summaryception's law). The
     * ledger as it stood after the branch page: that page's version
     * checkpoint when the readers have finished it; else the boundary
     * before the NEXT turn (which is the state after this page's chain);
     * else, branching from the tail, the ledger as it stands now. With it:
     * the snapshots up to the branch point (so a rewind in the branch
     * lands right), the version checkpoints of carried pages, the record's
     * lines that cover carried pages, and the lore shelf. Nothing of the
     * old telling's later turns crosses over. */
    const target = history[at];
    let carried = null;
    let exact = false;
    /* M70: with a journal, ONE rule for any page: the branch's ledger is the
     * fold up to the last storyteller page the branch actually contains — for
     * a writer's first message that is none (k = -1): empty but for what the
     * founder wrote from the brief. The checkpoint reckoning below stands only
     * for a store from before the journal. */
    await pendingWork(story.id, 8000);
    const nowState = await loadState(story.id);
    const kBranch = pages.filter((m) => m.role === 'assistant').length - 1;
    const fromTheTail = isLastAssistantPage(history, target.id) || !history.slice(at + 1).some((m) => m && !m.hidden);
    /* M91: THE NEWEST PAGE CARRIES THE LEDGER AS IT STANDS — exact by
     * definition once the readers have landed, and never a re-derivation.
     * M70's fold came first here and, on a store from before the journal
     * (a journal that begins mid-story, snapshots that know no page), folded
     * from NOTHING: the writer branched from his newest page and the whole
     * ledger was gone. The fold is for OLDER pages, and only where the
     * journal reaches them. */
    if (fromTheTail) {
      carried = nowState;
      exact = true;
    } else if ((nowState.journal || []).length && journalReaches(nowState, await loadSnapshots(story.id), kBranch)) {
      carried = foldJournal(nowState, await loadSnapshots(story.id), kBranch, applyMutations);
      exact = true;
    }
    /* M71: a WRITER'S page, no journal (a story from before it): the checkpoint
     * keyed to that very message — the ledger before its turn — never the one
     * after the page that answered it */
    if (!carried && target.role === 'user') {
      const snaps = await loadSnapshots(story.id);
      const hit = snaps.find((e) => e.id === target.id);
      if (hit) { carried = hit.snap; exact = true; }
    }
    if (!carried && target.role === 'assistant') {
      const idx = Array.isArray(target.swipes) && target.swipes.length
        ? (Number.isFinite(target.swipeIdx) ? Math.min(target.swipes.length - 1, Math.max(0, target.swipeIdx)) : target.swipes.length - 1)
        : 0;
      carried = await versionStateFor(story.id, target.id, idx);
    }
    if (!carried) {
      const nextUser = history.slice(at + 1).find((m) => m && m.role === 'user' && !m.hidden);
      if (nextUser) {
        const snaps = await loadSnapshots(story.id);
        const hit = snaps.find((e) => e.id === nextUser.id);
        if (hit) carried = hit.snap;
      }
    }
    /* M66: never a LATER state. With no checkpoint after the branch page, the
     * nearest checkpoint at or BEFORE it (sparse retention keeps old ones);
     * with none at all, a CLEAN ledger — the founder and a deep re-reading
     * of the carried pages rebuild it in the branch. The old fallback was
     * the ledger as it stands now, which for a branch at the start carried
     * everything that happened afterwards. */
    exact = exact || Boolean(carried);
    if (!carried) {
      const snaps = await loadSnapshots(story.id);
      const carriedOrder = pages.filter((m) => m.role === 'user').map((m) => m.id);
      for (let i = carriedOrder.length - 1; i >= 0 && !carried; i -= 1) {
        const hit = snaps.find((e) => e.id === carriedOrder[i]);
        if (hit) carried = hit.snap;
      }
    }
    if (!carried) {
      /* M69: the FOLD — the ledger at the end of the branch page, from the journal, no model.
       * M91: near the tail of a store the journal does not reach, the ledger as it stands
       * is nearer the truth than a fold from nothing; either way an inexact carry is
       * caught up below (the founder, a deep re-reading, an audit). */
      const now = await loadState(story.id);
      const snaps = await loadSnapshots(story.id);
      const k = pages.filter((m) => m.role === 'assistant').findIndex((m) => m.id === target.id);
      const reaches = journalReaches(now, snaps, k === -1 ? -1 : k);
      /* near the tail = the last three storyteller pages, and past the story's midpoint — a
       * four-page tale's first page is its start, never its tail */
      const laterPages = history.slice(at + 1).filter((m) => m && !m.hidden && m.role === 'assistant').length;
      const nearTail = laterPages <= 3 && at >= history.length / 2;
      carried = (!reaches && nearTail) ? now : foldJournal(now, snaps, k === -1 ? -1 : k, applyMutations);
      exact = reaches;
    }
    /* M72: the referee's committed-fate timeline speaks in message ids — the
     * branch's pages have new ones. Entries for carried messages are
     * remapped; the rest (later turns) are let go. Unmapped, every entry
     * was foreign to the branch and the referee pruned its whole timeline on
     * the next turn, rewinding the fight state up to twelve turns. */
    const carriedNow = JSON.parse(JSON.stringify(carried));
    carriedNow.refHistory = (Array.isArray(carriedNow.refHistory) ? carriedNow.refHistory : [])
      .filter((e) => e && (!e.msgId || idMap[e.msgId]))
      .map((e) => (e.msgId ? { ...e, msgId: idMap[e.msgId] } : e));
    await saveState(branch.id, carriedNow);
    const carriedIds = new Set(pages.map((m) => m.id));
    const snaps = (await loadSnapshots(story.id)).filter((e) => carriedIds.has(e.id)).map((e) => ({ ...e, id: idMap[e.id] }));
    if (snaps.length) await saveSnapshots(branch.id, snaps);
    const versions = await loadVersionStates(story.id);
    const branchVersions = {};
    for (const [key, st] of Object.entries(versions)) {
      const [oldId, idx] = key.split(':');
      if (idMap[oldId]) branchVersions[idMap[oldId] + ':' + idx] = st;
    }
    if (Object.keys(branchVersions).length) await db.settings.set('versionState:' + branch.id, branchVersions);
    const mem = await loadMemory(story.id);
    const visibleCount = pages.length;
    const nodes = mem.nodes.filter((n) => n.span[1] < visibleCount);
    await saveMemory(branch.id, { ...mem, nodes });
    const lore = await loadLore(story.id);
    if (lore.length) await saveLore(branch.id, lore.map((e) => ({ ...e })));
    ctx.setActiveStoryId(branch.id);
    await refreshStories(true);
    await renderThread({ structural: true });
    closePanel();
    toast(`The tale forks here — “${branch.title}” waits on the shelf.`);
    if (ctx.onStoriesChanged) ctx.onStoriesChanged();
    /* M66: an inexact carry is caught up at once — the founder (the branch has no
     * founding print), a deep re-reading of the carried pages, and an audit */
    if (!exact) {
      const branchStory = await db.stories.get(branch.id);
      const bpages = (await db.messages.list(branch.id)).filter((m) => !m.hidden);
      const last = [...bpages].reverse().find((m) => m.role === 'assistant');
      if (branchStory && last) {
        const before = bpages.slice(0, bpages.indexOf(last));
        const lastUser = [...before].reverse().find((m) => m && m.role === 'user');
        startBackgroundWork(branchStory, last, lastUser ? pageText(lastUser) : '', { deep: true, audit: true });
        toast('No exact checkpoint for this page — the workers are re-reading the branch from the brief and its pages.');
      }
    }
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
      else if (act === 'move-shelf') {
        /* M56: the tale moves shelves; nothing inside it changes */
        await db.stories.update(story.id, { projectId: btn.dataset.shelf || undefined });
        stories = await db.stories.list();
        renderStoryList();
        const to = btn.dataset.shelf ? (projects.find((p) => p.id === btn.dataset.shelf) || {}).name : null;
        toast(to ? `“${story.title}” is on the shelf “${to}” now.` : `“${story.title}” is loose now.`);
      }
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
    if (replaying) { toast('The ledger is still being rebuilt — one moment, then let it go.'); return; }
    /* One page lets go — never conflated with rewrite-from-here. */
    const ok = window.confirm('Let this page go? The ones around it stay exactly as written.');
    if (!ok) return;
    /* M44: the record slides with the pages — the line covering this page
     * is let go, the lines above it move down one */
    const allBefore = await db.messages.list(story.id);
    const visBefore = visiblePages(allBefore);
    const kGone = visBefore.findIndex((m) => m.id === id);
    const after = kGone !== -1 ? visBefore.slice(kGone + 1).find((m) => m) : null;
    const goneBoundary = boundaryFor(allBefore, id); /* the turn the page belonged to */
    if (kGone !== -1) await saveMemory(story.id, memoryAfterDeletion(await loadMemory(story.id), kGone));
    await db.messages.remove(story.id, id);
    const gone = visBefore[kGone];
    /* M72: the ledger work is claimed right after the store write, before any
     * rendering. A WRITER'S page let go moves no storyteller page — the
     * ledger's stamps stand (the record slid above; the referee prunes its
     * own timeline by message id); replaying from k = -1 used to shift every
     * stamp down by one. A storyteller page in the middle replays from the
     * next page (M68; later stamps shift down by one). The LAST storyteller
     * page let go folds the ledger back to the page before it, exactly, now
     * (it used to keep the gone page's people and hour until the story was
     * next opened). */
    let ledgerWork = null;
    if (gone && gone.role === 'assistant') {
      const goneK = visBefore.filter((m) => m.role === 'assistant').findIndex((m) => m.id === id);
      if (after) {
        ledgerWork = replayFrom(story, after.id, { changed: false, shiftAfter: goneK, kOverride: goneK, atOverride: kGone });
      } else {
        replaying = true;
        ledgerWork = (async () => {
          try {
            await pendingWork(story.id, 120000);
            await foldTo(story, goneK - 1);
            const all = await loadVersionStates(story.id);
            for (const key of Object.keys(all)) if (key.split(':')[0] === id) delete all[key];
            await db.settings.set('versionState:' + story.id, all);
            pendingAudit.delete(story.id);
          } finally { replaying = false; }
        })();
      }
    }
    const node = els.thread.querySelector(`.msg[data-id="${id}"]`);
    if (node) node.remove();
    lastRender.ids = lastRender.ids.filter((x) => x !== id);
    /* M21: with the page gone, the preview re-reads the page before it. */
    await refreshPreview(story.id);
    renderStoryList();
    refreshEmber();
    toast('The page is gone.');
    if (ledgerWork) await ledgerWork.catch(() => {});
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
    } else if (act === 'unmend') {
      unmend(id);
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
    focusComposerIfDesktop();
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

  async function renderPromptChips() {
    if (!els.promptChips) return;
    els.promptChips.textContent = '';
    /* M40: the starter row is hidden unless the writer asks for it
     * (Settings → Appearance) — it filled the screen for nothing. */
    if ((await db.settings.get('showStarters')) !== true) { els.promptChips.hidden = true; return; }
    els.promptChips.hidden = false;
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
    isBusy: () => busy,
    isReplaying,
    repairTimeline,
    rescanLedger,
    auditNow,
    foundNow,
    rebuildStandingsNow,
    rebuildRecordNow,
    rebuildPeopleNow,
    restoreRecordNow,
    restorePeopleNow,
    unmend,
    renderPromptChips,
    refreshStories,
    renderThread,
    continueTurn,
  };
}
