/* Cozy Tavern — ui/settings.js
 * Connections (add / change / test / let go, with presets), The Frame and
 * The Note at the End (global + per-story override), appearance, backup.
 */

import { db } from '../store.js';
import { createProvider, presetById } from '../providers/index.js';
import { STARTER_FRAME, STARTER_NOTE } from '../assemble/stack.js';

export function initSettings(ctx) {
  const els = {
    connList: document.getElementById('connection-list'),
    connEmpty: document.getElementById('connection-list-empty'),
    btnAdd: document.getElementById('btn-add-connection'),
    form: document.getElementById('connection-form'),
    formTitle: document.getElementById('connection-form-title'),
    preset: document.getElementById('conn-preset'),
    label: document.getElementById('conn-label'),
    baseUrl: document.getElementById('conn-baseurl'),
    apiKey: document.getElementById('conn-apikey'),
    model: document.getElementById('conn-model'),
    btnCancel: document.getElementById('btn-conn-cancel'),
    frameGlobal: document.getElementById('frame-global'),
    frameStory: document.getElementById('frame-story'),
    frameStoryName: document.getElementById('frame-story-name'),
    noteGlobal: document.getElementById('note-global'),
    noteStory: document.getElementById('note-story'),
    noteStoryName: document.getElementById('note-story-name'),
    btnExport: document.getElementById('btn-export'),
    importFile: document.getElementById('import-file'),
    backupNote: document.getElementById('backup-note'),
  };

  let editingId = null;

  function flash(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.hidden = false;
    setTimeout(() => { el.hidden = true; }, 1600);
  }

  /* ---------- connections ---------- */

  async function activeConnectionId() {
    return db.settings.get('activeConnectionId');
  }

  async function renderConnections() {
    const all = await db.connections.list();
    const activeId = await activeConnectionId();
    els.connList.textContent = '';
    els.connEmpty.hidden = all.length > 0;

    for (const conn of all) {
      const li = document.createElement('li');
      li.className = 'connection-card' + (conn.id === activeId ? ' active' : '');

      const top = document.createElement('div');
      top.className = 'connection-top';
      const name = document.createElement('span');
      name.className = 'connection-name';
      name.textContent = conn.label;
      const kind = document.createElement('span');
      kind.className = 'connection-kind';
      kind.textContent = `${conn.type === 'anthropic' ? 'Claude' : 'OpenAI-compatible'} · ${conn.model || 'no model named'}`;
      top.append(name, kind);
      if (conn.id === activeId) {
        const tag = document.createElement('span');
        tag.className = 'connection-active-tag';
        tag.textContent = '— the one you’re using';
        top.appendChild(tag);
      }

      const result = document.createElement('p');
      result.className = 'test-result';
      result.hidden = true;

      const row = document.createElement('div');
      row.className = 'row';

      const useBtn = document.createElement('button');
      useBtn.type = 'button';
      useBtn.className = 'text-btn';
      useBtn.textContent = conn.id === activeId ? 'In use' : 'Use this one';
      useBtn.disabled = conn.id === activeId;
      useBtn.addEventListener('click', async () => {
        await db.settings.set('activeConnectionId', conn.id);
        renderConnections();
      });

      const testBtn = document.createElement('button');
      testBtn.type = 'button';
      testBtn.className = 'text-btn';
      testBtn.textContent = 'Test';
      testBtn.addEventListener('click', async () => {
        testBtn.disabled = true;
        result.hidden = false;
        result.className = 'test-result';
        result.textContent = 'Listening for an answer…';
        const { ok, detail } = await createProvider(conn).test();
        result.className = 'test-result ' + (ok ? 'ok' : 'bad');
        result.textContent = detail;
        testBtn.disabled = false;
      });

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'text-btn';
      editBtn.textContent = 'Change';
      editBtn.addEventListener('click', () => openForm(conn));

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'text-btn';
      removeBtn.textContent = 'Let go';
      removeBtn.addEventListener('click', async () => {
        const sure = window.confirm(`Let go of “${conn.label}”? The key on this device goes with it.`);
        if (!sure) return;
        await db.connections.remove(conn.id);
        if ((await activeConnectionId()) === conn.id) {
          const rest = await db.connections.list();
          await db.settings.set('activeConnectionId', rest.length ? rest[0].id : null);
        }
        renderConnections();
      });

      row.append(useBtn, testBtn, editBtn, removeBtn);
      li.append(top, result, row);
      els.connList.appendChild(li);
    }
  }

  function fillFromPreset() {
    const p = presetById(els.preset.value);
    els.baseUrl.placeholder = p.baseUrl || 'https://example.com/api';
    els.model.placeholder = p.model || 'the model’s name';
    if (!editingId) {
      els.baseUrl.value = p.baseUrl;
      els.model.value = p.model;
      if (!els.label.value || els.label.dataset.autofill === '1') {
        els.label.value = p.label;
        els.label.dataset.autofill = '1';
      }
    }
  }

  /* Which preset a saved connection most resembles, so "Change" opens the
   * form on familiar footing. */
  function presetFor(conn) {
    if (conn.type === 'anthropic') return 'claude';
    const base = conn.baseUrl || '';
    if (base.includes('openrouter.ai')) return 'openrouter';
    if (base.includes('api.openai.com')) return 'openai';
    return 'custom';
  }

  els.preset.addEventListener('change', fillFromPreset);
  els.label.addEventListener('input', () => { els.label.dataset.autofill = '0'; });

  function openForm(conn) {
    editingId = conn ? conn.id : null;
    els.form.hidden = false;
    els.formTitle.textContent = conn ? `Changing “${conn.label}”` : 'A new connection';
    if (conn) {
      els.preset.value = presetFor(conn);
      els.label.value = conn.label;
      els.baseUrl.value = conn.baseUrl;
      els.apiKey.value = conn.apiKey;
      els.model.value = conn.model;
    } else {
      els.preset.value = 'claude';
      els.apiKey.value = '';
      els.label.value = '';
      els.label.dataset.autofill = '1';
      fillFromPreset();
    }
    els.label.focus();
  }

  els.btnAdd.addEventListener('click', () => openForm(null));
  els.btnCancel.addEventListener('click', () => { els.form.hidden = true; editingId = null; });

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = presetById(els.preset.value);
    const fields = {
      label: els.label.value.trim() || p.label,
      type: p.type,
      baseUrl: els.baseUrl.value.trim(),
      apiKey: els.apiKey.value.trim(),
      model: els.model.value.trim(),
    };
    if (editingId) {
      await db.connections.update(editingId, fields);
    } else {
      const saved = await db.connections.add(fields);
      if (!(await activeConnectionId())) {
        await db.settings.set('activeConnectionId', saved.id);
      }
    }
    els.form.hidden = true;
    editingId = null;
    renderConnections();
  });

  /* ---------- the frame & the note ---------- */

  async function activeStory() {
    const id = ctx.getActiveStoryId();
    return id ? db.stories.get(id) : undefined;
  }

  async function loadPromptSlots() {
    els.frameGlobal.value = (await db.settings.get('frameText')) ?? STARTER_FRAME;
    els.noteGlobal.value = (await db.settings.get('noteText')) ?? STARTER_NOTE;

    const story = await activeStory();
    const storyName = story ? `“${story.title}”` : 'this story';
    els.frameStoryName.textContent = storyName;
    els.noteStoryName.textContent = storyName;
    els.frameStory.value = (story && story.frameOverride) || '';
    els.noteStory.value = (story && story.noteOverride) || '';
    const hasStory = Boolean(story);
    els.frameStory.disabled = !hasStory;
    els.noteStory.disabled = !hasStory;
    document.getElementById('btn-save-frame-story').disabled = !hasStory;
    document.getElementById('btn-save-note-story').disabled = !hasStory;
  }

  document.getElementById('btn-save-frame').addEventListener('click', async () => {
    await db.settings.set('frameText', els.frameGlobal.value);
    flash('frame-saved');
  });
  document.getElementById('btn-save-note').addEventListener('click', async () => {
    await db.settings.set('noteText', els.noteGlobal.value);
    flash('note-saved');
  });
  document.getElementById('btn-save-frame-story').addEventListener('click', async () => {
    const story = await activeStory();
    if (!story) return;
    await db.stories.update(story.id, { frameOverride: els.frameStory.value });
    flash('frame-story-saved');
  });
  document.getElementById('btn-save-note-story').addEventListener('click', async () => {
    const story = await activeStory();
    if (!story) return;
    await db.stories.update(story.id, { noteOverride: els.noteStory.value });
    flash('note-story-saved');
  });

  /* ---------- appearance ---------- */

  async function loadTheme() {
    const mode = (await db.settings.get('theme')) || 'system';
    const radio = document.querySelector(`input[name="theme"][value="${mode}"]`);
    if (radio) radio.checked = true;
  }

  document.querySelectorAll('input[name="theme"]').forEach((radio) => {
    radio.addEventListener('change', async () => {
      if (!radio.checked) return;
      await db.settings.set('theme', radio.value);
      ctx.setTheme(radio.value);
    });
  });

  /* ---------- backup ---------- */

  els.btnExport.addEventListener('click', async () => {
    const json = await db.exportAll();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `cozy-tavern-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    els.backupNote.hidden = false;
    els.backupNote.textContent = 'A copy is in your downloads. Keep it somewhere warm.';
  });

  els.importFile.addEventListener('change', async () => {
    const file = els.importFile.files && els.importFile.files[0];
    els.importFile.value = '';
    if (!file) return;
    const sure = window.confirm(
      'Bringing a copy back replaces everything currently here — stories, words, connections. Carry on?'
    );
    if (!sure) return;
    try {
      const text = await file.text();
      await db.importAll(text);
      els.backupNote.hidden = false;
      els.backupNote.textContent = 'Everything is back where it belongs. Welcome home.';
      await onShow();
      if (ctx.chat) {
        await ctx.chat.refreshStories();
        await ctx.chat.renderThread();
      }
      ctx.applyStoredTheme();
    } catch (err) {
      els.backupNote.hidden = false;
      els.backupNote.textContent = err.message || 'That file wouldn’t open. Is it a Cozy Tavern copy?';
    }
  });

  /* ---------- shown each time the view opens ---------- */

  async function onShow() {
    await renderConnections();
    await loadPromptSlots();
    await loadTheme();
  }

  ctx.settings = { onShow };
}
