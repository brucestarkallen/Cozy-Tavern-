/* Cozy Tavern — ui/housekeeper.js
 * The housekeeper's panel (M10): a full right-side sheet where the writer
 * talks to the one intelligence that sees the whole story. The talk is a
 * session per story (agents/housekeeper.js keeps it); protocol blocks in a
 * reply become proposal cards under its bubble — each with the red-washed
 * find, the green-washed replace, a reason, and Apply / Edit by hand /
 * Skip; the batch footer offers Apply-all; the Undo quick button walks the
 * drift-guarded batches back (agents/housekeeper.js undoLatest).
 *
 * Everything runs on the worker connection (default: the story's own),
 * never on the story-generation path, and nothing here throws into the
 * chat path. The quick buttons: Audit (a standing ask), New episode /
 * Next / Seed (the director's modes), Critique (the editor, on demand),
 * Undo (take back the newest batch that still stands).
 */

import { db } from '../store.js';
import {
  housekeeperTurn, loadSession, saveSession,
  applyProposal, applyAllPending, undoLatest,
  cleanContextPages, DEFAULT_CONTEXT_PAGES,
  listSessions, switchSession, newSession, branchSession, renameSession, deleteSession, clearSession, deleteLastExchange,
  editTurnAt, deleteTurnAt, truncateForRetry, keepVersions, walkVersion, versionsOf, /* M73: the bubble row */
  expandCommand, COMMANDS, buildHousekeeperContext, callModel,
} from '../agents/housekeeper.js';
import { loadState, renderStateFacts } from '../engine/state.js';
import { loadMemory, wholeRecord } from '../agents/memory.js';
import { loadLore } from '../import/lorebook.js';
import { listModules } from '../assemble/modules.js';
import { noteWorkerRun } from '../agents/status.js';
import {
  loadDirector, saveDirector, runDirector, renderDirectorNote,
  directorStatus, directorIdeas, directorSteer, directorOff,
} from '../agents/director.js';
import {
  loadEditor, saveEditor, maybeRunEditor, diffCritique, renderEditorNote,
} from '../agents/editor.js';

const AUDIT_ASK = [
  'Read the whole house — the pages, the ledger, the rulebook — and audit:',
  'what has drifted, what contradicts itself, what the ledger says that the',
  'pages no longer do (or the other way round). Where a fix is clear,',
  'propose it. Where it isn’t, say so plainly.',
].join(' ');

export function initHousekeeper(ctx) {
  const sheet = document.getElementById('hk-sheet');
  const scrim = document.getElementById('hk-scrim');
  const closeBtn = document.getElementById('btn-hk-close');
  const thread = document.getElementById('hk-thread');
  const form = document.getElementById('hk-form');
  const input = document.getElementById('hk-input');
  const sendBtn = document.getElementById('hk-send');
  const statusLine = document.getElementById('hk-status');
  const seedForm = document.getElementById('hk-seed-form');
  const seedInput = document.getElementById('hk-seed-input');
  const pagesInput = document.getElementById('hk-pages');
  const autoBox = document.getElementById('hk-director-auto');
  const editorBox = document.getElementById('hk-editor-on');
  const editorN = document.getElementById('hk-editor-n');
  if (!sheet || !form || !thread) return;

  let open = false;
  let busy = false;
  let applying = false; /* M64: applying and undoing never wait on the model's lock */
  let workerCtl = null;
  let session = { turns: [], batches: [] };
  let sessionStoryId = null;

  const toast = (words) => { if (ctx.toast) ctx.toast(words); };

  /* The worker connection, exactly as chat.js resolves it. */
  async function resolveWorkerConnection(story) {
    /* M17: the housekeeper may have hands of its own. M75: with none set, it
     * rides the STORYTELLER's connection — the one you talk to needs the
     * brains, and Chat Assistant ran on the main model. It used to fall to
     * the workers' connection (the cheap reader) and answered like one. */
    const map = (await db.settings.get('workerConnections')) || {};
    const all = await db.connections.list();
    if (map.housekeeper) {
      const found = all.find((c) => c.id === map.housekeeper);
      if (found) return found;
    }
    if (story && typeof story.connectionId === 'string' && story.connectionId) {
      const own = all.find((c) => c.id === story.connectionId);
      if (own) return own;
    }
    const active = await db.settings.get('activeConnectionId');
    if (active) {
      const teller = all.find((c) => c.id === active);
      if (teller) return teller;
    }
    const workers = await db.settings.get('workerConnectionId');
    if (workers) {
      const found = all.find((c) => c.id === workers);
      if (found) return found;
    }
    return all[0] || null;
  }

  async function activeStory() {
    const id = ctx.getActiveStoryId && ctx.getActiveStoryId();
    if (!id) return null;
    return db.stories.get(id);
  }

  async function ensureSession() {
    const story = await activeStory();
    if (!story) return null;
    if (sessionStoryId !== story.id) {
      session = await loadSession(story.id);
      sessionStoryId = story.id;
    }
    return story;
  }

  /* ---------- rendering ---------- */

  function bubble(role, text, turnIndex, turn) {
    const div = document.createElement('div');
    div.className = 'hk-bubble ' + (role === 'writer' ? 'hk-writer' : 'hk-housekeeper');
    const body = document.createElement('div');
    body.className = 'hk-bubble-text';
    body.textContent = text;
    div.append(body);
    /* M73: Chat Assistant's bubble row (attachMsgIcons), whole, on BOTH
     * voices — M62 had put a lone "branch here" on the writer's bubble only.
     * Writer: ✎ Edit and continue from here · ⧉ Copy · ⑂ Branch · ✕ Delete.
     * Answer: ◂ n/N ▸ (its versions, on the last answer) · ↻ Ask again from
     * here · ⧉ Copy · ⑂ Branch · ✕ Delete. */
    if (Number.isInteger(turnIndex)) {
      const row = document.createElement('div');
      row.className = 'hk-acts';
      const mk = (label, title, act, cls = '') => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'text-btn hk-act' + (cls ? ' ' + cls : '');
        b.dataset.act = act;
        b.dataset.turn = String(turnIndex);
        b.textContent = label;
        b.title = title;
        b.addEventListener('click', async (e) => { e.stopPropagation(); await turnAct(act, turnIndex); });
        row.append(b);
        return b;
      };
      if (role === 'writer') mk('✎ Edit', 'Edit these words and continue from here — everything after this turn is let go', 'edit-at', 'hk-edit-here');
      else {
        const versions = versionsOf(turn);
        const isLast = session && session.turns && turnIndex === lastAnswerIndex(session.turns);
        /* M73-002: the LAST answer always wears the story's swipe bar — ◂ n/N ▸ —
         * and ▸ past the last version writes another answer (the old one
         * stays); an older answer keeps ↻ (ask again from here). */
        if (isLast) {
          const at = Number.isInteger(turn.swipeIdx) ? turn.swipeIdx : versions.length - 1;
          mk('◂', 'The version before', 'swipe-prev', 'hk-swipe-prev' + (at <= 0 ? ' hk-dim' : ''));
          const n = document.createElement('span');
          n.className = 'hk-swipe-count';
          n.textContent = (at + 1) + '/' + versions.length;
          row.append(n);
          mk('▸', at >= versions.length - 1 ? 'Another answer — a new version; this one stays' : 'The version after', 'swipe-next', 'hk-swipe-next');
        } else {
          mk('↻ Retry', 'Ask this question again from here — the answers after it are let go', 'retry-at', 'hk-retry-here');
        }
      }
      mk('⧉ Copy', 'Copy these words', 'copy-at', 'hk-copy-here');
      mk('⑂ Branch', 'A new session with the talk up to here; this one stands', 'branch-at', 'hk-branch-here');
      mk('✕ Delete', 'Let this one turn go — the ones around it stay', 'delete-at', 'hk-delete-here');
      div.append(row);
    }
    return div;
  }
  function lastAnswerIndex(turns) {
    for (let i = (turns || []).length - 1; i >= 0; i -= 1) if (turns[i].role === 'housekeeper') return i;
    return -1;
  }

  /* M73: the bubble row's acts */
  async function turnAct(act, index) {
    if (busy) { toast('Wait for the housekeeper to finish.'); return; }
    const story = await ensureSession();
    if (!story) return;
    const turn = session.turns[index];
    if (!turn) return;
    if (act === 'copy-at') {
      try { await navigator.clipboard.writeText(String(turn.text || '')); toast('Copied.'); } catch (err) { window.prompt('Copy it by hand, then:', String(turn.text || '')); }
      return;
    }
    if (act === 'branch-at') { await sessionAct('branch-at', index); return; }
    if (act === 'delete-at') {
      if (!window.confirm('Let this turn go? The ones around it stay.')) return;
      const next = await deleteTurnAt(story.id, index);
      if (next) { session = next; render(); }
      return;
    }
    if (act === 'edit-at') {
      if (index < session.turns.length - 1 && !window.confirm('Edit these words? Everything after this turn in the session is let go.')) return;
      const r = await editTurnAt(story.id, index);
      if (!r) return;
      session = r.session;
      render();
      input.value = r.text;
      input.focus();
      statusLine.textContent = 'Editing — send to continue from here.';
      return;
    }
    if (act === 'swipe-prev' || act === 'swipe-next') {
      /* ▸ past the last version asks for another answer */
      if (act === 'swipe-next') {
        const versions = versionsOf(turn);
        const at = Number.isInteger(turn.swipeIdx) ? turn.swipeIdx : versions.length - 1;
        if (at >= versions.length - 1) { await turnAct('retry-at', index); return; }
      }
      const next = await walkVersion(story.id, index, act === 'swipe-prev' ? -1 : 1);
      if (next) { session = next; render(); }
      return;
    }
    if (act === 'retry-at') {
      const wasLast = index === lastAnswerIndex(session.turns);
      const r = await truncateForRetry(story.id, index);
      if (!r) { toast('That answer had no question to ask again.'); return; }
      session = r.session;
      render();
      const landed = await send(r.question);
      /* the last answer keeps its old versions beside the new one (a swipe);
       * an older answer's retry lets the answers after it go, as Chat
       * Assistant's edit-and-continue does */
      if (landed && wasLast) {
        const at = lastAnswerIndex(session.turns);
        if (at !== -1) { const kept = await keepVersions(story.id, at, r.dropped); if (kept) { session = kept; render(); } }
      }
    }
  }

  /* M62: a viewer for the full context, the raw ledger, the notes */
  function viewer(title, text) {
    const det = document.createElement('details');
    det.className = 'hk-viewer-fold';
    det.open = true;
    const sum = document.createElement('summary');
    sum.textContent = title;
    const pre = document.createElement('pre');
    pre.className = 'hk-viewer';
    pre.textContent = text;
    det.append(sum, pre);
    thread.append(det);
    thread.scrollTop = thread.scrollHeight;
  }

  /* M62: the session shelf */
  const sessionPick = document.getElementById('hk-session');
  async function renderSessions() {
    if (!sessionPick || !sessionStoryId) return;
    const { sessions, activeId } = await listSessions(sessionStoryId);
    sessionPick.textContent = '';
    for (const x of sessions) {
      const o = document.createElement('option');
      o.value = String(x.id);
      o.textContent = x.name + (x.turns ? ' (' + x.turns + ')' : '');
      sessionPick.appendChild(o);
    }
    sessionPick.value = String(activeId);
  }
  async function sessionAct(act, arg) {
    if (busy) { toast('Wait for the housekeeper to finish.'); return; }
    const story = await ensureSession();
    if (!story) return;
    if (act === 'switch') session = await switchSession(story.id, arg);
    else if (act === 'new') session = await newSession(story.id);
    else if (act === 'branch') session = await branchSession(story.id);
    else if (act === 'branch-at') session = await branchSession(story.id, arg);
    else if (act === 'rename') { const name = window.prompt('A name for this session:', session.name || ''); if (name && name.trim()) session = await renameSession(story.id, name); }
    else if (act === 'delete') { if (!window.confirm('Delete this session? The story and every applied change stay.')) return; session = await deleteSession(story.id); }
    else if (act === 'clear') { if (!window.confirm('Clear this session’s talk? Applied changes stay.')) return; session = await clearSession(story.id); }
    else if (act === 'del-last') session = await deleteLastExchange(story.id);
    await renderSessions();
    render();
    if (act === 'branch') toast('Copied — the new session is its own; the original stands.');
    if (act === 'branch-at') toast('Branched — the new session is its own; the original stands.');
  }

  function thinkingFold(text) {
    const det = document.createElement('details');
    det.className = 'hk-thinking';
    const sum = document.createElement('summary');
    sum.textContent = 'How it weighed it';
    const body = document.createElement('div');
    body.textContent = text;
    det.append(sum, body);
    return det;
  }

  function diffBlock(kind, text) {
    const pre = document.createElement('pre');
    pre.className = 'hk-diff ' + (kind === 'del' ? 'hk-del' : 'hk-add');
    pre.textContent = text;
    return pre;
  }

  function mutationLine(m) {
    const parts = [m.type];
    for (const key of ['name', 'module', 'key', 'flag', 'what', 'location', 'value', 'cause', 'reason']) {
      if (typeof m[key] === 'string' && m[key]) parts.push(m[key]);
      else if (typeof m[key] === 'number') parts.push(String(m[key]));
    }
    return parts.join(' — ');
  }

  function cardKindWords(p) {
    return p.kind === 'ledit' ? 'A ledger change'
      : p.kind === 'redit' ? 'A rulebook change'
      : p.kind === 'brief' ? (p.op && p.op.field === 'castNotes' ? 'A change to the cast notes' : 'A change to the brief')
      : p.kind === 'record' ? 'A record change'
      : p.kind === 'lore' ? 'A lore change'
      : p.kind === 'unreadable' ? 'A block that could not be read'
      : 'A page change';
  }
  /* M76: the card's diff — Chat Assistant's before (red) and after (green) halves,
   * on EVERY kind (it used to draw them for page and rule cards only, so a card
   * for the brief, the record or the lore showed a label and nothing else) */
  function appendDiff(card, p) {
    const op = p.op || {};
    if (p.kind === 'edit' && !op.bulk && op.hide !== undefined) {
      const words = document.createElement('p');
      words.className = 'hk-card-words';
      words.textContent = op.hide ? 'Fold this page away from the story.' : 'Bring this page back to the story.';
      card.append(words);
      return;
    }
    if (p.kind === 'edit' || p.kind === 'redit' || p.kind === 'record') {
      card.append(diffBlock('del', op.find || ''));
      card.append(diffBlock('add', op.replace || ''));
      if (op.bulk) {
        const where = document.createElement('p');
        where.className = 'hk-card-words';
        where.textContent = 'Across ' + ((op.ids || []).length) + ' named pages.';
        card.append(where);
      }
      return;
    }
    if (p.kind === 'brief') {
      if (typeof op.text === 'string') {
        card.append(diffBlock('del', op.before || '(empty)'));
        card.append(diffBlock('add', op.text));
      } else if (typeof op.append === 'string') {
        const words = document.createElement('p');
        words.className = 'hk-card-words';
        words.textContent = 'Added at the end' + (op.before ? ', after “…' + op.before.slice(-80).replace(/\s+/g, ' ') + '”' : '') + ':';
        card.append(words);
        card.append(diffBlock('add', op.append));
      } else {
        card.append(diffBlock('del', op.find || ''));
        card.append(diffBlock('add', op.replace || ''));
      }
      return;
    }
    if (p.kind === 'lore') {
      if (op.add) {
        const words = document.createElement('p');
        words.className = 'hk-card-words';
        words.textContent = 'A new entry' + (op.name ? ' “' + op.name + '”' : '') + ' with keys ' + ((op.keys || []).join(', ') || '(none)') + (op.constant ? ', always riding' : '') + ':';
        card.append(words, diffBlock('add', op.content || ''));
      } else if (op.remove) {
        const words = document.createElement('p');
        words.className = 'hk-card-words';
        words.textContent = 'The entry leaves the shelf' + (op.entryName ? ' — “' + op.entryName + '”' : '') + '.';
        card.append(words);
        if (op.beforeContent) card.append(diffBlock('del', op.beforeContent));
      } else {
        const pch = op.patch || {};
        const before = op.before || {};
        if (typeof pch.content === 'string') { card.append(diffBlock('del', before.content || '')); card.append(diffBlock('add', pch.content)); }
        const other = [];
        if (Array.isArray(pch.keys)) other.push('keys: ' + (before.keys || []).join(', ') + ' → ' + pch.keys.join(', '));
        if (typeof pch.name === 'string') other.push('name: ' + (before.name || '') + ' → ' + pch.name);
        if (typeof pch.enabled === 'boolean') other.push(pch.enabled ? 'switched on' : 'switched off');
        if (typeof pch.constant === 'boolean') other.push(pch.constant ? 'always rides now' : 'rides on its keys now');
        if (other.length) { const words = document.createElement('p'); words.className = 'hk-card-words'; words.textContent = other.join(' · '); card.append(words); }
      }
      return;
    }
    if (p.kind === 'ledit') {
      const list = document.createElement('p');
      list.className = 'hk-card-words';
      const pv = op.preview;
      list.textContent = pv && pv.words && pv.words.length
        ? 'The ledger will say:\n' + pv.words.map((w) => '• ' + w).join('\n') + (pv.refused && pv.refused.length ? '\nRefused by the ledger: ' + pv.refused.join('; ') : '')
        : (op.mutations || []).map(mutationLine).join('\n');
      list.style.whiteSpace = 'pre-wrap';
      card.append(list);
    }
  }

  function cardStatusWords(p) {
    switch (p.status) {
      case 'applied': return p.words || 'Applied.';
      case 'skipped': return 'Passed by.';
      case 'superseded': return p.words || 'Set aside — a later answer replaced it.';
      case 'stale': return p.words || 'Gone stale — the page moved since this was staged.';
      case 'refused': return p.words ? 'Refused — ' + p.words : 'Refused.';
      case 'applying': return 'Being applied…';
      default: return '';
    }
  }

  function renderCard(p) {
    const card = document.createElement('div');
    card.className = 'hk-card hk-' + p.status;
    card.dataset.proposalId = p.id;

    const head = document.createElement('div');
    head.className = 'hk-card-head';
    const label = document.createElement('span');
    label.textContent = p.label;
    const kind = document.createElement('span');
    kind.className = 'hk-card-kind';
    kind.textContent = cardKindWords(p);
    head.append(label, kind);
    card.append(head);

    /* M76: the reason at the top, always — its absence is shown, not hidden */
    if (p.kind !== 'unreadable') {
      const reason = document.createElement('p');
      reason.className = 'hk-card-reason' + (p.reason ? '' : ' hk-card-noreason');
      reason.textContent = p.reason || '(no reason given)';
      card.append(reason);
    }

    const op = p.op || {};
    appendDiff(card, p);

    const wordsText = cardStatusWords(p);
    if (wordsText) {
      const words = document.createElement('p');
      words.className = 'hk-card-words';
      words.textContent = wordsText;
      card.append(words);
    }

    if (p.status === 'pending') {
      const actions = document.createElement('div');
      actions.className = 'hk-card-actions';
      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'text-btn';
      applyBtn.textContent = 'Apply';
      applyBtn.addEventListener('click', () => { applyOne(p.id); });
      actions.append(applyBtn);

      /* Edit by hand: the new words become editable; keeping them applies
       * the hand-tuned words. M76: on every card that carries words — page,
       * rule, record, brief (replace / text / append), lore (content). */
      const handField = (p.kind === 'edit' && !op.bulk && op.hide === undefined) || p.kind === 'redit' || p.kind === 'record' ? 'replace'
        : p.kind === 'brief' ? (typeof op.text === 'string' ? 'text' : typeof op.append === 'string' ? 'append' : 'replace')
        : p.kind === 'lore' && !op.remove ? (op.add ? 'content' : 'patch.content')
        : null;
      if (handField) {
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'text-btn';
        editBtn.textContent = 'Edit by hand';
        editBtn.addEventListener('click', () => {
          const area = document.createElement('textarea');
          area.rows = 4;
          area.value = handField === 'patch.content' ? ((op.patch && op.patch.content) || '') : (op[handField] || '');
          const keep = document.createElement('button');
          keep.type = 'button';
          keep.className = 'text-btn';
          keep.textContent = 'Keep & apply';
          keep.addEventListener('click', () => {
            p.op = handField === 'patch.content' ? { ...p.op, patch: { ...(p.op.patch || {}), content: area.value } } : { ...p.op, [handField]: area.value };
            applyOne(p.id);
          });
          actions.replaceWith(area, keep);
        });
        actions.append(editBtn);
      }

      const skipBtn = document.createElement('button');
      skipBtn.type = 'button';
      skipBtn.className = 'text-btn';
      skipBtn.textContent = 'Skip';
      skipBtn.addEventListener('click', async () => {
        p.status = 'skipped';
        p.words = 'Passed by.';
        await persistSession();
        render();
      });
      actions.append(skipBtn);
      card.append(actions);
    }
    return card;
  }

  function pendingProposals() {
    const out = [];
    for (const turn of session.turns) {
      for (const p of (turn.proposals || [])) if (p.status === 'pending') out.push(p);
    }
    return out;
  }

  function render() {
    thread.textContent = '';
    if (!sessionStoryId) {
      const note = document.createElement('p');
      note.className = 'quiet';
      note.textContent = 'Open a story, and the housekeeper will keep it with you.';
      thread.append(note);
      return;
    }
    if (!session.turns.length) {
      const note = document.createElement('p');
      note.className = 'quiet';
      note.textContent = 'Nothing asked yet. The housekeeper has already read the house.';
      thread.append(note);
    }
    session.turns.forEach((turn, i) => {
      if (turn.text) thread.append(bubble(turn.role, turn.text, i, turn));
      if (turn.thinking) thread.append(thinkingFold(turn.thinking));
      /* M75-003: what it said, whole — the blocks the talk hides, and the rounds it took */
      if (turn.role === 'housekeeper' && turn.raw) {
        const det = document.createElement('details');
        det.className = 'hk-raw';
        const sum = document.createElement('summary');
        sum.textContent = 'What it said, whole' + (turn.rounds ? ' (' + turn.rounds + (turn.rounds === 1 ? ' round' : ' rounds') + ' of back-and-forth first)' : '');
        const pre = document.createElement('pre');
        pre.className = 'hk-viewer';
        pre.textContent = turn.raw;
        det.append(sum, pre);
        thread.append(det);
      }
      /* M64: done cards leave a one-line receipt in the talk; the live ones stand in the cards box */
      for (const p of (turn.proposals || [])) {
        if (p.status === 'pending' || p.status === 'refused') continue;
        const r = document.createElement('div');
        r.className = 'hk-receipt';
        r.textContent = (p.status === 'applied' ? '✓ ' : '– ') + p.label + ' — ' + (p.words || cardStatusWords(p));
        thread.append(r);
      }
    });
    renderCardsBox();
    thread.scrollTop = thread.scrollHeight;
  }
  let cardsFolded = false;
  const cardsBox = document.getElementById('hk-cards');
  const cardsList = document.getElementById('hk-cards-list');
  const cardsCount = document.getElementById('hk-cards-count');
  /* M64: the cards box exists only while a card is pending or refused (Chat Assistant's renderEditCards) */
  function renderCardsBox() {
    if (!cardsBox) return;
    const live = session.turns.flatMap((t) => (t.proposals || []).filter((p) => p.status === 'pending' || p.status === 'refused'));
    cardsBox.hidden = !live.length;
    if (!live.length) { cardsList.textContent = ''; return; }
    const pending = live.filter((p) => p.status === 'pending').length;
    const failed = live.length - pending;
    cardsCount.textContent = pending + (pending === 1 ? ' card' : ' cards') + (failed ? ', ' + failed + ' refused' : '');
    document.getElementById('hk-apply-all').hidden = pending < 2;
    document.getElementById('hk-dismiss-all').hidden = pending < 1;
    document.getElementById('hk-repropose').hidden = failed < 1;
    cardsBox.classList.toggle('folded', cardsFolded);
    document.getElementById('hk-toggle-cards').textContent = cardsFolded ? 'Show' : 'Hide';
    cardsList.textContent = '';
    for (const p of live) cardsList.append(renderCard(p));
  }

  function setBusy(next, words) {
    busy = next;
    sendBtn.disabled = next;
    input.disabled = next;
    const stopBtn = document.getElementById('hk-stop');
    if (stopBtn) stopBtn.hidden = !next;
    if (typeof words === 'string') statusLine.textContent = words;
  }

  async function persistSession() {
    if (sessionStoryId) {
      await saveSession(sessionStoryId, session).catch(() => {});
    }
  }

  /* Refresh the chat floor after pages were re-inked. */
  function refreshStoryFloor(touched) {
    if (touched && touched.messages && ctx.chat && typeof ctx.chat.renderThread === 'function') {
      ctx.chat.renderThread({ structural: true });
    }
    /* M38: a lore change shows in Settings' shelf at once; M74: so does a
     * change to the brief or the cast notes (and the story room hears it) */
    if (touched && (touched.lore || touched.story) && ctx.settings && typeof ctx.settings.onStoriesChanged === 'function') {
      ctx.settings.onStoriesChanged();
    }
    if (touched && touched.story && typeof ctx.onStoriesChanged === 'function') ctx.onStoriesChanged();
  }

  /* ---------- applying and undoing ---------- */

  async function applyOne(proposalId) {
    if (applying) { toast('One moment — a change is still landing.'); return; }
    applying = true;
    try {
    const story = await ensureSession();
    if (!story) return;
    statusLine.textContent = 'Applying…';
    try {
      const result = await applyProposal(session, story.id, proposalId);
      await persistSession();
      if (result.words) toast(result.words);
      refreshStoryFloor(result.touched);
      render();
    } catch (err) {
      toast((err && err.message) || 'It wouldn’t hold — nothing was changed.');
    } finally {
      statusLine.textContent = '';
    }
    } finally { applying = false; }
  }

  async function applyAll() {
    if (applying) { toast('One moment — a change is still landing.'); return; }
    applying = true;
    try {
    const story = await ensureSession();
    if (!story) return;
    statusLine.textContent = 'Applying…';
    try {
      const result = await applyAllPending(session, story.id);
      await persistSession();
      if (result.words) toast(result.words);
      refreshStoryFloor(result.touched);
      render();
    } catch (err) {
      toast((err && err.message) || 'It wouldn’t hold — nothing was changed.');
    } finally {
      statusLine.textContent = '';
    }
    } finally { applying = false; }
  }

  async function undo() {
    if (applying) { toast('One moment — a change is still landing.'); return; }
    applying = true;
    try {
    const story = await ensureSession();
    if (!story) return;
    statusLine.textContent = 'Taking it back…';
    try {
      const result = await undoLatest(session, story.id);
      await persistSession();
      toast(result.words || (result.ok ? 'Taken back.' : 'Nothing was taken back.'));
      if (result.ok) refreshStoryFloor({ messages: true });
      render();
    } catch (err) {
      toast((err && err.message) || 'It wouldn’t come back — nothing was touched.');
    } finally {
      statusLine.textContent = '';
    }
    } finally { applying = false; }
  }

  /* ---------- the talk ---------- */

  async function retryLast() {
    if (busy) return;
    const story = await ensureSession();
    if (!story) return;
    const i = lastAnswerIndex(session.turns);
    if (i < 0) { toast('Nothing to ask again yet.'); return; }
    /* M73: the toolbar's ↻ is the bubble's ↻ on the last answer — a new
     * version; the old one stays a swipe away (its pending cards with it) */
    await turnAct('retry-at', i);
  }

  async function send(writerText) {
    const raw = String(writerText || '').trim();
    if (!raw) return;
    if (busy) { toast('The housekeeper is still busy — press ⏹ Stop, or wait.'); return; }
    /* M62: the shortcut commands — #d steers the director, #e seeds it, the rest expand to a standing request */
    const cmd = expandCommand(raw);
    if (cmd.tag === 'd' || cmd.tag === 'e') {
      const rest = raw.replace(/^#(d|e)\s*/i, '').trim();
      if (cmd.tag === 'e') { input.value = ''; directorAction('seed', rest); return; }
      input.value = '';
      await directorTool('steer', rest);
      return;
    }
    const text = cmd.text;
    const story = await ensureSession();
    if (!story) { toast('Open a story first — the housekeeper keeps one at a time.'); return; }
    const connection = await resolveWorkerConnection(story);
    if (!connection) { toast('No connection yet — the housekeeper has no one to be.'); return; }

    setBusy(true, 'The housekeeper is looking…');
    input.value = '';
    const pendingBubble = bubble('housekeeper', '…');
    pendingBubble.classList.add('hk-pending');
    thread.append(pendingBubble);
    thread.scrollTop = thread.scrollHeight;
    /* M76: the thinking, live — Chat Assistant's ticker (elapsed, answer chars,
     * thinking chars) on the status line, and the reasoning itself in a fold
     * that opens while it thinks and folds when the first word of the answer
     * lands; kept on the turn as "How it weighed it" */
    const t0 = Date.now();
    let answerChars = 0;
    let thinkChars = 0;
    let thinkFold = null;
    let thinkBody = null;
    const tick = () => { statusLine.textContent = 'The housekeeper is ' + (thinkChars && !answerChars ? 'weighing it' : 'looking') + ' · ' + Math.floor((Date.now() - t0) / 1000) + 's' + (answerChars ? ' · ' + answerChars + ' chars' : '') + (thinkChars ? ' (+' + thinkChars + ' thinking)' : '') + (!answerChars && !thinkChars ? ' · waiting for the first word…' : ''); };
    const ticker = setInterval(tick, 1000);

    workerCtl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    try {
      const [director, editor] = await Promise.all([loadDirector(story.id), loadEditor(story.id)]);
      const { renderDirectorNote } = await import('../agents/director.js');
      const { renderEditorNote } = await import('../agents/editor.js');
      const result = await housekeeperTurn({
        storyId: story.id,
        writerText: text,
        shownText: raw,
        connection,
        signal: workerCtl ? workerCtl.signal : undefined,
        directorText: renderDirectorNote(director),
        editorText: renderEditorNote(editor),
        onToken: (tok) => {
          if (tok && tok.channel === 'thinking' && typeof tok.text === 'string') {
            thinkChars += tok.text.length;
            if (!thinkFold) {
              thinkFold = document.createElement('details');
              thinkFold.className = 'hk-thinking';
              thinkFold.open = true;
              const sum = document.createElement('summary');
              sum.textContent = 'How it’s weighing it…';
              thinkBody = document.createElement('div');
              thinkBody.className = 'hk-thinking-body';
              thinkFold.append(sum, thinkBody);
              pendingBubble.before(thinkFold);
            }
            thinkBody.textContent += tok.text;
            tick();
            thread.scrollTop = thread.scrollHeight;
          } else if (tok && tok.channel === 'prose' && typeof tok.text === 'string') {
            if (!answerChars && thinkFold) { thinkFold.open = false; thinkFold.querySelector('summary').textContent = 'How it weighed it'; }
            answerChars += tok.text.length;
            pendingBubble.textContent += tok.text;
            pendingBubble.textContent = pendingBubble.textContent.replace(/^…/, '');
            tick();
            thread.scrollTop = thread.scrollHeight;
          }
        },
      });
      await noteWorkerRun(story.id, 'housekeeper', {
        ok: result.ok === true,
        why: result.error || '',
      });
      if (!result.ok) {
        pendingBubble.remove();
        statusLine.textContent = result.error
          ? 'It went quiet: ' + result.error + '. Your words are still in the box — ask again when you like.'
          : 'It went quiet — ask again when you like.';
        input.value = text;
        return;
      }
      session = result.session; // staged cards, supersede, and caps already settled
      render();
      statusLine.textContent = '';
      await refreshStatusLine();
      return true;
    } catch (err) {
      pendingBubble.remove();
      input.value = text;
      statusLine.textContent = 'It stumbled: ' + ((err && err.message) || 'unknown') + '. Nothing was changed.';
    } finally {
      clearInterval(ticker);
      if (thinkFold && thinkFold.isConnected) thinkFold.remove(); /* render() draws the kept thinking from the turn */
      workerCtl = null;
      setBusy(false);
    }
  }

  /* ---------- the quick buttons ---------- */

  async function directorAction(mode, seedText) {
    if (busy) return;
    const story = await ensureSession();
    if (!story) { toast('Open a story first.'); return; }
    const connection = await resolveWorkerConnection(story);
    if (!connection) { toast('No connection yet.'); return; }
    setBusy(true, mode === 'restart' ? 'Clearing the board…' : 'The director is sketching…');
    workerCtl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    try {
      const result = await runDirector({
        connection, storyId: story.id, story, mode, seedText,
        signal: workerCtl ? workerCtl.signal : undefined,
      });
      await noteWorkerRun(story.id, 'director', { ok: result.ok === true, why: result.error || '' });
      if (result.ok) {
        toast(result.words || 'Done.');
      } else {
        statusLine.textContent = 'The director went quiet: ' + (result.error || 'unknown') + '.';
      }
    } catch (err) {
      statusLine.textContent = 'The director stumbled: ' + ((err && err.message) || 'unknown') + '.';
    } finally {
      workerCtl = null;
      setBusy(false);
      await refreshStatusLine();
    }
  }

  async function critiqueAction() {
    if (busy) return;
    const story = await ensureSession();
    if (!story) { toast('Open a story first.'); return; }
    const connection = await resolveWorkerConnection(story);
    if (!connection) { toast('No connection yet.'); return; }
    setBusy(true, 'The editor is reading…');
    workerCtl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    try {
      const before = await loadEditor(story.id);
      const result = await maybeRunEditor({
        connection, story, storyId: story.id, reason: 'manual',
        signal: workerCtl ? workerCtl.signal : undefined,
      });
      await noteWorkerRun(story.id, 'editor', {
        ok: Boolean(result && result.ok),
        why: (result && result.error) || '',
      });
      if (result && result.ok) {
        const diff = diffCritique(before.critique, result.critique);
        const news = diff.added.length + (diff.northStarChanged ? 1 : 0);
        toast(news
          ? 'The editor has ' + news + ' new thing' + (news === 1 ? '' : 's') + ' to say.'
          : 'The editor stands by what it said.');
      } else {
        statusLine.textContent = 'The editor went quiet: ' + ((result && result.error) || 'unknown') + '.';
      }
    } catch (err) {
      statusLine.textContent = 'The editor stumbled: ' + ((err && err.message) || 'unknown') + '.';
    } finally {
      workerCtl = null;
      setBusy(false);
      await refreshStatusLine();
    }
  }

  /* ---------- the house rules row + status line ---------- */

  async function refreshStatusLine() {
    const story = await activeStory();
    if (!story) { statusLine.textContent = ''; return; }
    const [director, editor] = await Promise.all([loadDirector(story.id), loadEditor(story.id)]);
    const bits = [];
    if (director.text) {
      bits.push('Episode ' + (director.episode || 1) + (director.concluded ? ' — concluded' : ' — on the march')
        + (director.auto ? ' · auto' : ''));
    } else {
      bits.push('No episode stands' + (director.auto ? ' (the director will write one)' : ''));
    }
    bits.push(editor.enabled
      ? 'The editor’s eye is on — every ' + editor.everyN + ' turns'
        + (editor.critique ? ', and it has spoken' : ', and it has not spoken yet')
      : 'The editor’s eye rests');
    statusLine.textContent = bits.join('. ') + '.';
  }

  async function loadRules() {
    const story = await activeStory();
    const pages = await db.settings.get('hkContextPages');
    pagesInput.value = String(cleanContextPages(pages == null ? DEFAULT_CONTEXT_PAGES : pages));
    if (!story) { autoBox.checked = false; editorBox.checked = false; editorN.value = '8'; return; }
    const [director, editor] = await Promise.all([loadDirector(story.id), loadEditor(story.id)]);
    autoBox.checked = director.auto === true;
    editorBox.checked = editor.enabled === true;
    editorN.value = String(editor.everyN);
  }

  pagesInput.addEventListener('change', async () => {
    await db.settings.set('hkContextPages', cleanContextPages(pagesInput.value));
    pagesInput.value = String(cleanContextPages(pagesInput.value));
    toast('The housekeeper will read that many pages in full.');
  });
  autoBox.addEventListener('change', async () => {
    const story = await activeStory();
    if (!story) return;
    await saveDirector(story.id, { auto: autoBox.checked });
    toast(autoBox.checked ? 'The director will write episodes on its own.' : 'The director waits to be asked.');
    refreshStatusLine();
  });
  editorBox.addEventListener('change', async () => {
    const story = await activeStory();
    if (!story) return;
    await saveEditor(story.id, { enabled: editorBox.checked });
    toast(editorBox.checked ? 'The editor keeps its eye on the telling.' : 'The editor’s eye rests.');
    refreshStatusLine();
  });
  editorN.addEventListener('change', async () => {
    const story = await activeStory();
    if (!story) return;
    const n = Math.max(2, Math.min(50, Math.round(Number(editorN.value) || 8)));
    editorN.value = String(n);
    await saveEditor(story.id, { everyN: n });
    refreshStatusLine();
  });

  /* ---------- wiring ---------- */

  document.getElementById('hk-audit').addEventListener('click', () => { send(AUDIT_ASK); });
  document.getElementById('hk-new').addEventListener('click', () => { directorAction('new'); });
  document.getElementById('hk-next').addEventListener('click', () => { directorAction('next'); });
  document.getElementById('hk-seed').addEventListener('click', () => {
    seedForm.hidden = !seedForm.hidden;
    if (!seedForm.hidden) seedInput.focus();
  });
  document.getElementById('hk-critique').addEventListener('click', () => { critiqueAction(); });
  document.getElementById('hk-undo').addEventListener('click', () => { undo(); });
  /* M60: ↻ Retry — Chat Assistant's retryLast: the last answer and its cards
   * are let go, the last question is asked again. */
  document.getElementById('hk-retry').addEventListener('click', () => { retryLast(); });

  /* M60: fullscreen (Esc leaves it first, before closing) and a draggable top
   * bar on a desk — Chat Assistant's panel, in the sheet. */
  const head = sheet.querySelector('.hk-head');
  const fullBtn = document.getElementById('btn-hk-full');
  function setFullscreen(on) {
    sheet.classList.toggle('fullscreen', on);
    if (on) { sheet.classList.remove('floating'); sheet.style.left = ''; sheet.style.top = ''; sheet.style.right = ''; sheet.style.bottom = ''; sheet.style.width = ''; }
    fullBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    fullBtn.title = on ? 'Leave fullscreen (Esc)' : 'Fullscreen (Esc leaves it)';
  }
  fullBtn.addEventListener('click', () => setFullscreen(!sheet.classList.contains('fullscreen')));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheet.hidden && sheet.classList.contains('fullscreen')) { e.preventDefault(); e.stopPropagation(); setFullscreen(false); }
  }, true);
  (function makeDraggable(panel, handle) {
    let sx = 0; let sy = 0; let ox = 0; let oy = 0; let dragging = false;
    handle.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || e.target.closest('button')) return;
      if (panel.classList.contains('fullscreen')) return;
      dragging = true; sx = e.clientX; sy = e.clientY;
      const r = panel.getBoundingClientRect(); ox = r.left; oy = r.top;
      if (handle.setPointerCapture) handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const nx = Math.min(Math.max(0, ox + e.clientX - sx), window.innerWidth - 80);
      const ny = Math.min(Math.max(0, oy + e.clientY - sy), window.innerHeight - 40);
      panel.classList.add('floating');
      panel.style.left = nx + 'px'; panel.style.top = ny + 'px'; panel.style.right = 'auto'; panel.style.bottom = 'auto';
    });
    const stop = () => { dragging = false; };
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
    handle.addEventListener('dblclick', () => { panel.classList.remove('floating'); panel.style.left = ''; panel.style.top = ''; panel.style.right = ''; panel.style.bottom = ''; });
  })(sheet, head);
  seedForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const seed = seedInput.value.trim();
    if (!seed) return;
    seedInput.value = '';
    seedForm.hidden = true;
    directorAction('seed', seed);
  });

  /* M62: the director's tools */
  async function directorTool(which, arg) {
    if (busy) return;
    const story = await ensureSession();
    if (!story) { toast('Open a story first.'); return; }
    if (which === 'peek') { const d = await loadDirector(story.id); viewer(d.text ? 'The directive for episode ' + d.episode + ' (spoiler)' : 'No episode stands', d.text || '—'); return; }
    if (which === 'off') { const r = await directorOff(story.id); thread.append(bubble('housekeeper', r.words)); refreshStatusLine(); return; }
    const connection = await resolveWorkerConnection(story);
    if (!connection) { toast('No connection yet.'); return; }
    setBusy(true, which === 'status' ? 'Checking the episode…' : which === 'ideas' ? 'Sketching three doors…' : 'Re-aiming the episode…');
    workerCtl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    try {
      const signal = workerCtl ? workerCtl.signal : undefined;
      const r = which === 'status' ? await directorStatus({ connection, storyId: story.id, signal })
        : which === 'ideas' ? await directorIdeas({ connection, storyId: story.id, story, signal })
        : await directorSteer({ connection, storyId: story.id, story, direction: arg, signal });
      thread.append(bubble('housekeeper', r.ok ? r.words : 'The director could not: ' + r.error));
      thread.scrollTop = thread.scrollHeight;
      if (which === 'steer') refreshStatusLine();
    } finally {
      setBusy(false, '');
      workerCtl = null;
    }
  }

  /* M62: auto-name / rename the story */
  async function nameStory(auto) {
    const story = await ensureSession();
    if (!story) return;
    if (!auto) { const name = window.prompt('A title for this story:', story.title || ''); if (name && name.trim()) { await db.stories.update(story.id, { title: name.trim().slice(0, 80) }); if (ctx.chat && ctx.chat.refreshStories) await ctx.chat.refreshStories(); toast('Renamed.'); } return; }
    const connection = await resolveWorkerConnection(story);
    if (!connection) { toast('No connection yet.'); return; }
    setBusy(true, 'Reading the tale for a name…');
    try {
      const pages = (await db.messages.list(story.id)).filter((m) => !m.hidden).slice(-8).map((m) => String(m.text || '').slice(0, 1500)).join('\n\n');
      const r = await callModel(connection, { system: 'You name stories. Read the pages and answer with ONE distinctive title of two to six words — no quotes, no punctuation at the end, nothing else.', messages: [{ role: 'user', content: pages || story.title || 'an untitled tale' }], maxTokens: 40 });
      const title = String((r && r.text) || '').replace(/^["“']+|["”']+$/g, '').split('\n')[0].trim().slice(0, 80);
      if (title) { await db.stories.update(story.id, { title }); if (ctx.chat && ctx.chat.refreshStories) await ctx.chat.refreshStories(); toast('Named: “' + title + '”'); }
      else toast('No name came back.');
    } finally { setBusy(false, ''); }
  }

  /* M62: the More menu */
  const moreBtn = document.getElementById('hk-more');
  const moreMenu = document.getElementById('hk-more-menu');
  moreBtn.addEventListener('click', () => { moreMenu.hidden = !moreMenu.hidden; });
  moreMenu.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    moreMenu.hidden = true;
    const act = btn.dataset.act;
    const story = await ensureSession();
    if (!story) { toast('Open a story first.'); return; }
    /* M63: the useful asks as named tools — the tags still work quietly */
    if (act === 'ask-i') { await send('#i'); return; }
    if (act === 'ask-br') { await send('#br'); return; }
    if (act === 'ask-opt') { await send('#opt'); return; }
    if (act === 'ask-cl') { await send('#cl'); return; }
    if (act === 'ask-p') { const who = window.prompt('Whose psychology? (leave empty for the most present person)', ''); if (who === null) return; await send('#p ' + who.trim()); return; }
    if (act === 'context') {
      const [messages, state, modules, lore, mem] = await Promise.all([db.messages.list(story.id), loadState(story.id), listModules(), loadLore(story.id), loadMemory(story.id)]);
      const text = buildHousekeeperContext({ story, messages, state, modules, lore, memory: mem, session, contextPages: await db.settings.get('hkContextPages') });
      viewer('The full context the housekeeper reads — ' + text.length.toLocaleString() + ' chars ≈ ' + Math.round(text.length / 3.6).toLocaleString() + ' tokens (its rules and this talk ride on top)', text);
    } else if (act === 'raw') {
      const [state, mem] = await Promise.all([loadState(story.id), loadMemory(story.id)]);
      viewer('The ledger and the record, raw', JSON.stringify({ ledger: state, record: mem.nodes }, null, 2));
    } else if (act === 'dir-status') await directorTool('status');
    else if (act === 'dir-peek') await directorTool('peek');
    else if (act === 'dir-ideas') await directorTool('ideas');
    else if (act === 'dir-off') { if (window.confirm('Stand the director down and clear the episode?')) await directorTool('off'); }
    else if (act === 'crit-peek') { const ed = await loadEditor(story.id); viewer('The editor’s standing notes', renderEditorNote(ed) || '(none yet)'); }
    else if (act === 'name-story') await nameStory(true);
    else if (act === 'rename-story') await nameStory(false);
    else if (act === 'rules') { const r = document.getElementById('hk-rules'); r.hidden = !r.hidden; if (!r.hidden) r.open = true; }
    else if (act === 'commands') viewer('Shortcuts for the ask box (or just say it in words)', [
      '#i — four directions the story could go', '#p <name> — a psychology read', '#br — a handoff paragraph',
      '#opt — compress the record without loss', '#cl — clean the record like a showrunner',
      '#d <direction> — steer the current episode', '#e <premise> — seed the next episode',
      '', 'The house does these on its own, every turn: fixing continuity (the second reader mends pages; the auditor reads the whole ledger every three turns), checking the record against its pages (the verifier), keeping OOC out of the story. #f, #s, #a and #o still answer, but you should never need them.',
    ].join('\n'));
  });
  document.addEventListener('click', (e) => { if (!moreMenu.hidden && !moreMenu.contains(e.target) && e.target !== moreBtn) moreMenu.hidden = true; });

  /* M64: the cards box */
  document.getElementById('hk-apply-all').addEventListener('click', () => { applyAll(); });
  document.getElementById('hk-dismiss-all').addEventListener('click', async () => {
    for (const p of pendingProposals()) { p.status = 'skipped'; p.words = 'Set aside by the writer.'; }
    await persistSession(); render();
  });
  document.getElementById('hk-toggle-cards').addEventListener('click', () => { cardsFolded = !cardsFolded; renderCardsBox(); });
  document.getElementById('hk-clear').addEventListener('click', () => sessionAct('clear'));
  document.getElementById('hk-del-last').addEventListener('click', () => sessionAct('del-last'));
  document.getElementById('hk-dir-status').addEventListener('click', () => directorTool('status'));
  document.getElementById('hk-repropose').addEventListener('click', () => {
    const failed = session.turns.flatMap((t) => (t.proposals || []).filter((p) => p.status === 'refused' || p.status === 'stale'));
    if (!failed.length) { toast('No failed cards to re-propose.'); return; }
    send('These cards could not be applied: ' + failed.map((p) => '“' + p.label + '” (' + (p.words || 'refused') + ')').join('; ') + '. Re-read the CURRENT text of each target (fetch the pages you do not hold whole) and send corrected versions — anchors copied exactly — or withdraw the ones no longer needed with <supersede>.');
  });

  /* M62: sessions */
  sessionPick.addEventListener('change', () => { sessionAct('switch', Number(sessionPick.value)); });
  document.getElementById('hk-sess-new').addEventListener('click', () => sessionAct('new'));
  document.getElementById('hk-sess-branch').addEventListener('click', () => sessionAct('branch'));
  document.getElementById('hk-sess-rename').addEventListener('click', () => sessionAct('rename'));
  document.getElementById('hk-sess-delete').addEventListener('click', () => sessionAct('delete'));

  /* M62: stop */
  document.getElementById('hk-stop').addEventListener('click', () => { if (workerCtl) { try { workerCtl.abort(new Error('stopped by hand')); } catch (err) { /* already gone */ } } });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    send(input.value);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send(input.value);
    }
  });

  async function openSheet() {
    if (open) return;
    open = true;
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = 0; }
    sheet.hidden = false;
    scrim.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('open'));
    /* M14: the header keeps the ember on the room that's open. */
    const btn = document.getElementById('btn-housekeeper');
    if (btn) btn.classList.add('current');
    await ensureSession();
    await renderSessions();
    render();
    await Promise.all([loadRules(), refreshStatusLine()]);
    input.focus();
  }

  let closeTimer = 0;
  function closeSheet() {
    if (!open) return;
    open = false;
    if (workerCtl) { try { workerCtl.abort(); } catch (err) { /* still */ } }
    sheet.classList.remove('open');
    scrim.hidden = true;
    /* M62: an open that comes before the close's timer fires must win —
     * the stale timer used to hide a sheet the writer had just reopened */
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { closeTimer = 0; if (!open) sheet.hidden = true; }, 220);
    const btn = document.getElementById('btn-housekeeper');
    if (btn) btn.classList.remove('current');
  }

  closeBtn.addEventListener('click', closeSheet);
  scrim.addEventListener('click', closeSheet);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) closeSheet();
  });

  ctx.housekeeper = {
    open: openSheet,
    close: closeSheet,
    toggle() { if (open) closeSheet(); else openSheet(); },
    isOpen() { return open; },
    /* When stories settle (a turn landed, the showrunners wrote, another
     * tab moved), re-read the world — but only while open. */
    onStoriesChanged() {
      if (!open) return;
      sessionStoryId = null; // re-read the session fresh
      ensureSession().then(() => { render(); return refreshStatusLine(); }).catch(() => {});
    },
  };
}
