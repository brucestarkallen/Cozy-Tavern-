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
} from '../agents/housekeeper.js';
import { noteWorkerRun } from '../agents/status.js';
import {
  loadDirector, saveDirector, runDirector, renderDirectorNote,
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
  let workerCtl = null;
  let session = { turns: [], batches: [] };
  let sessionStoryId = null;

  const toast = (words) => { if (ctx.toast) ctx.toast(words); };

  /* The worker connection, exactly as chat.js resolves it. */
  async function resolveWorkerConnection(story) {
    const wanted = await db.settings.get('workerConnectionId');
    const all = await db.connections.list();
    if (wanted) {
      const found = all.find((c) => c.id === wanted);
      if (found) return found;
    }
    if (story && typeof story.connectionId === 'string' && story.connectionId) {
      const own = all.find((c) => c.id === story.connectionId);
      if (own) return own;
    }
    const active = await db.settings.get('activeConnectionId');
    return all.find((c) => c.id === active) || all[0] || null;
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

  function bubble(role, text) {
    const div = document.createElement('div');
    div.className = 'hk-bubble ' + (role === 'writer' ? 'hk-writer' : 'hk-housekeeper');
    div.textContent = text;
    return div;
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
      : 'A page change';
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

    if (p.reason) {
      const reason = document.createElement('p');
      reason.className = 'hk-card-reason';
      reason.textContent = p.reason;
      card.append(reason);
    }

    const op = p.op || {};
    if (p.kind === 'edit' && !op.bulk && op.hide !== undefined) {
      const words = document.createElement('p');
      words.className = 'hk-card-words';
      words.textContent = op.hide ? 'Fold this page away from the story.' : 'Bring this page back to the story.';
      card.append(words);
    } else if (p.kind === 'edit' || p.kind === 'redit') {
      card.append(diffBlock('del', op.find || ''));
      card.append(diffBlock('add', op.replace || ''));
      if (op.bulk) {
        const where = document.createElement('p');
        where.className = 'hk-card-words';
        where.textContent = 'Across ' + ((op.ids || []).length) + ' named pages.';
        card.append(where);
      }
    } else if (p.kind === 'ledit') {
      const list = document.createElement('p');
      list.className = 'hk-card-words';
      list.textContent = (op.mutations || []).map(mutationLine).join('\n');
      list.style.whiteSpace = 'pre-wrap';
      card.append(list);
    }

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

      /* Edit by hand: the replace text becomes editable; keeping it
       * applies the hand-tuned words. (For page and rulebook cards.) */
      if ((p.kind === 'edit' && !op.bulk && op.hide === undefined) || p.kind === 'redit') {
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'text-btn';
        editBtn.textContent = 'Edit by hand';
        editBtn.addEventListener('click', () => {
          const area = document.createElement('textarea');
          area.rows = 4;
          area.value = op.replace || '';
          const keep = document.createElement('button');
          keep.type = 'button';
          keep.className = 'text-btn';
          keep.textContent = 'Keep & apply';
          keep.addEventListener('click', () => {
            p.op = { ...p.op, replace: area.value };
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
    for (const turn of session.turns) {
      if (turn.text) thread.append(bubble(turn.role, turn.text));
      if (turn.thinking) thread.append(thinkingFold(turn.thinking));
      for (const p of (turn.proposals || [])) thread.append(renderCard(p));
    }
    const pending = pendingProposals();
    if (pending.length > 1) {
      const row = document.createElement('div');
      row.className = 'hk-batch-actions';
      const all = document.createElement('button');
      all.type = 'button';
      all.className = 'text-btn';
      all.textContent = 'Apply all that still stand (' + pending.length + ')';
      all.addEventListener('click', () => { applyAll(); });
      row.append(all);
      thread.append(row);
    }
    thread.scrollTop = thread.scrollHeight;
  }

  function setBusy(next, words) {
    busy = next;
    sendBtn.disabled = next;
    input.disabled = next;
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
  }

  /* ---------- applying and undoing ---------- */

  async function applyOne(proposalId) {
    if (busy) return;
    const story = await ensureSession();
    if (!story) return;
    setBusy(true, 'Applying…');
    try {
      const result = await applyProposal(session, story.id, proposalId);
      await persistSession();
      if (result.words) toast(result.words);
      refreshStoryFloor(result.touched);
      render();
    } catch (err) {
      toast((err && err.message) || 'It wouldn’t hold — nothing was changed.');
    } finally {
      setBusy(false, '');
    }
  }

  async function applyAll() {
    if (busy) return;
    const story = await ensureSession();
    if (!story) return;
    setBusy(true, 'Applying…');
    try {
      const result = await applyAllPending(session, story.id);
      await persistSession();
      if (result.words) toast(result.words);
      refreshStoryFloor(result.touched);
      render();
    } catch (err) {
      toast((err && err.message) || 'It wouldn’t hold — nothing was changed.');
    } finally {
      setBusy(false, '');
    }
  }

  async function undo() {
    if (busy) return;
    const story = await ensureSession();
    if (!story) return;
    setBusy(true, 'Taking it back…');
    try {
      const result = await undoLatest(session, story.id);
      await persistSession();
      toast(result.words || (result.ok ? 'Taken back.' : 'Nothing was taken back.'));
      if (result.ok) refreshStoryFloor({ messages: true });
      render();
    } catch (err) {
      toast((err && err.message) || 'It wouldn’t come back — nothing was touched.');
    } finally {
      setBusy(false, '');
    }
  }

  /* ---------- the talk ---------- */

  async function send(writerText) {
    const text = String(writerText || '').trim();
    if (!text || busy) return;
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

    workerCtl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    try {
      const [director, editor] = await Promise.all([loadDirector(story.id), loadEditor(story.id)]);
      const { renderDirectorNote } = await import('../agents/director.js');
      const { renderEditorNote } = await import('../agents/editor.js');
      const result = await housekeeperTurn({
        storyId: story.id,
        writerText: text,
        connection,
        signal: workerCtl ? workerCtl.signal : undefined,
        directorText: renderDirectorNote(director),
        editorText: renderEditorNote(editor),
        onToken: (tok) => {
          if (tok && tok.channel === 'prose' && typeof tok.text === 'string') {
            pendingBubble.textContent += tok.text;
            pendingBubble.textContent = pendingBubble.textContent.replace(/^…/, '');
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
    } catch (err) {
      pendingBubble.remove();
      input.value = text;
      statusLine.textContent = 'It stumbled: ' + ((err && err.message) || 'unknown') + '. Nothing was changed.';
    } finally {
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
  seedForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const seed = seedInput.value.trim();
    if (!seed) return;
    seedInput.value = '';
    seedForm.hidden = true;
    directorAction('seed', seed);
  });

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
    sheet.hidden = false;
    scrim.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('open'));
    /* M14: the header keeps the ember on the room that's open. */
    const btn = document.getElementById('btn-housekeeper');
    if (btn) btn.classList.add('current');
    await ensureSession();
    render();
    await Promise.all([loadRules(), refreshStatusLine()]);
    input.focus();
  }

  function closeSheet() {
    if (!open) return;
    open = false;
    if (workerCtl) { try { workerCtl.abort(); } catch (err) { /* still */ } }
    sheet.classList.remove('open');
    scrim.hidden = true;
    setTimeout(() => { sheet.hidden = true; }, 220);
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
