/* Cozy Tavern — ui/settings.js
 * Connections (add / change / test / let go, with presets), The Frame and
 * The Note at the End (global + per-story override), The Brief and Who's
 * here (per story), The rulebook (M2: pin, edit, fork, write your own),
 * Bring your engine (M5: read a SillyTavern preset, preview the shelves,
 * apply what's wanted), The workers (M3: who reads for the ledger, and
 * whether they do), How much the story remembers (M6: the keeper's switch
 * and window, and the second reader), Bring your people / Bring your lore /
 * Bring your old chats (M7: cards, lorebooks, chat exports), The thinking
 * voice (M8.5: the story's own reasoning effort, and whether the weighing
 * shows at all), appearance, backup. M8 grew the connection editor: model
 * fetch ("Fetch what's on offer"), the sampling dials (temperature, top-p,
 * longest reply), the model's room (context size, feeding the ember bar),
 * and the real thinking control — no placeholders.
 */

import { db } from '../store.js';
import { createProvider, presetById } from '../providers/index.js';
import { STARTER_FRAME, STARTER_NOTE } from '../assemble/stack.js';
import { listModules, saveModule, removeModule, WHEN_WORDS } from '../assemble/modules.js';
import { parsePreset, decompose, applyPlan, summaryWords } from '../import/sillytavern.js';
import { parseCard, listCast, saveCastMember, removeCastMember } from '../import/cards.js';
/* M15 audit: the lore shelf's hand controls (toggle, mark constant, edit,
 * reorder, let go) called updateLoreEntry/moveLoreEntry/removeLoreEntry
 * without importing them — every one of those clicks threw. */
import {
  parseLorebook, saveLore, loadLore, updateLoreEntry, moveLoreEntry, removeLoreEntry,
} from '../import/lorebook.js';
import { parseSTChat, importAsStory } from '../import/chats.js';
import { cleanWindow } from '../agents/memory.js';

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
    btnFetchModels: document.getElementById('btn-fetch-models'),
    modelsNote: document.getElementById('conn-models-note'),
    modelsLabel: document.getElementById('conn-models-label'),
    modelsPick: document.getElementById('conn-models'),
    connReasoning: document.getElementById('conn-reasoning'),
    connBudget: document.getElementById('conn-budget'),
    connTemperature: document.getElementById('conn-temperature'),
    connTopP: document.getElementById('conn-topp'),
    connMaxTokens: document.getElementById('conn-maxtokens'),
    connContextSize: document.getElementById('conn-contextsize'),
    btnCancel: document.getElementById('btn-conn-cancel'),
    frameGlobal: document.getElementById('frame-global'),
    frameStory: document.getElementById('frame-story'),
    frameStoryName: document.getElementById('frame-story-name'),
    noteGlobal: document.getElementById('note-global'),
    noteStory: document.getElementById('note-story'),
    noteStoryName: document.getElementById('note-story-name'),
    briefStory: document.getElementById('brief-story'),
    briefStoryName: document.getElementById('brief-story-name'),
    castStory: document.getElementById('cast-story'),
    castStoryName: document.getElementById('cast-story-name'),
    moduleList: document.getElementById('module-list'),
    btnAddModule: document.getElementById('btn-add-module'),
    modForm: document.getElementById('module-form'),
    modFormTitle: document.getElementById('module-form-title'),
    modName: document.getElementById('mod-name'),
    modText: document.getElementById('mod-text'),
    modWhen: document.getElementById('mod-when'),
    modNote: document.getElementById('mod-note'),
    modWhenLabel: document.getElementById('mod-when-label'),
    btnModCancel: document.getElementById('btn-mod-cancel'),
    btnExport: document.getElementById('btn-export'),
    importFile: document.getElementById('import-file'),
    backupNote: document.getElementById('backup-note'),
    workerConn: document.getElementById('worker-connection'),
    workerExtraction: document.getElementById('worker-extraction'),
    workerStoryName: document.getElementById('worker-story-name'),
    storyConn: document.getElementById('story-connection'),
    storyConnName: document.getElementById('story-conn-name'),
    workerKeeper: document.getElementById('worker-keeper'),
    workerContinuity: document.getElementById('worker-continuity'),
    spendLine: document.getElementById('spend-line'),
    memoryKeeper: document.getElementById('memory-keeper'),
    memoryWindow: document.getElementById('memory-window'),
    memoryWindowValue: document.getElementById('memory-window-value'),
    continuityCheck: document.getElementById('continuity-check'),
    refereeOn: document.getElementById('referee-on'),
    refereeSensitivity: document.getElementById('referee-sensitivity'),
    refereePreset: document.getElementById('referee-preset'),
    refereeFightStyle: document.getElementById('referee-fightstyle'),
    engineFile: document.getElementById('engine-file'),
    enginePaste: document.getElementById('engine-paste'),
    btnEngineRead: document.getElementById('btn-engine-read'),
    engineNote: document.getElementById('engine-note'),
    enginePreview: document.getElementById('engine-preview'),
    engineGroups: document.getElementById('engine-groups'),
    btnEngineApply: document.getElementById('btn-engine-apply'),
    btnEngineDismiss: document.getElementById('btn-engine-dismiss'),
    engineSummary: document.getElementById('engine-summary'),
    cardFile: document.getElementById('card-file'),
    cardNote: document.getElementById('card-note'),
    castList: document.getElementById('cast-list'),
    castListEmpty: document.getElementById('cast-list-empty'),
    cardForm: document.getElementById('card-form'),
    cardFormTitle: document.getElementById('card-form-title'),
    cardEditName: document.getElementById('card-edit-name'),
    cardEditDescription: document.getElementById('card-edit-description'),
    cardEditPersonality: document.getElementById('card-edit-personality'),
    cardEditScenario: document.getElementById('card-edit-scenario'),
    cardEditFirstMes: document.getElementById('card-edit-firstmes'),
    cardEditNotes: document.getElementById('card-edit-notes'),
    btnCardCancel: document.getElementById('btn-card-cancel'),
    loreFile: document.getElementById('lore-file'),
    loreNote: document.getElementById('lore-note'),
    loreCount: document.getElementById('lore-count'),
    loreList: document.getElementById('lore-list'),
    loreStoryName: document.getElementById('lore-story-name'),
    btnLoreClear: document.getElementById('btn-lore-clear'),
    chatFile: document.getElementById('chat-file'),
    chatImportNote: document.getElementById('chat-import-note'),
    thinkingStory: document.getElementById('thinking-story'),
    thinkingStoryName: document.getElementById('thinking-story-name'),
    showThinking: document.getElementById('show-thinking'),
  };

  let editingId = null;

  /* M14: the house's small warm words — settings answers with a toast as
   * well as its inline notes, so the writer hears it even mid-scroll. */
  const toast = (words) => { if (ctx.toast) ctx.toast(words); };

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
        toast(ok
          ? `“${conn.label}” answered — the connection works.`
          : 'No answer came back — the address, key, or model may be off.');
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

    /* keep the workers' picker in step with who's available */
    renderWorkers();
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

  function hideModelPicker() {
    els.modelsLabel.hidden = true;
    els.modelsNote.hidden = true;
    els.modelsPick.textContent = '';
  }

  function openForm(conn) {
    editingId = conn ? conn.id : null;
    els.form.hidden = false;
    els.formTitle.textContent = conn ? `Changing “${conn.label}”` : 'A new connection';
    hideModelPicker();
    if (conn) {
      els.preset.value = presetFor(conn);
      els.label.value = conn.label;
      els.baseUrl.value = conn.baseUrl;
      els.apiKey.value = conn.apiKey;
      els.model.value = conn.model;
      const r = conn.reasoning && typeof conn.reasoning === 'object' ? conn.reasoning : {};
      els.connReasoning.value = typeof r.effort === 'string' ? r.effort : 'off';
      els.connBudget.value = typeof r.budgetTokens === 'number' && r.budgetTokens > 0 ? String(r.budgetTokens) : '';
      els.connTemperature.value = typeof conn.temperature === 'number' ? String(conn.temperature) : '';
      els.connTopP.value = typeof conn.topP === 'number' ? String(conn.topP) : '';
      els.connMaxTokens.value = typeof conn.maxTokens === 'number' ? String(conn.maxTokens) : '';
      els.connContextSize.value = typeof conn.contextSize === 'number' ? String(conn.contextSize) : '';
    } else {
      els.preset.value = 'claude';
      els.apiKey.value = '';
      els.label.value = '';
      els.label.dataset.autofill = '1';
      els.connReasoning.value = 'off';
      els.connBudget.value = '';
      els.connTemperature.value = '';
      els.connTopP.value = '';
      els.connMaxTokens.value = '';
      els.connContextSize.value = '';
      fillFromPreset();
    }
    els.label.focus();
  }

  /* "Fetch what's on offer" (M8): ask the provider for its models and offer
   * them as a picker that fills the model field. A refusal never breaks the
   * form — the hand-typed name stays. */
  els.btnFetchModels.addEventListener('click', async () => {
    const p = presetById(els.preset.value);
    const draft = {
      type: p.type,
      baseUrl: els.baseUrl.value.trim() || p.baseUrl || '',
      apiKey: els.apiKey.value.trim(),
    };
    els.btnFetchModels.disabled = true;
    hideModelPicker();
    els.modelsNote.hidden = false;
    els.modelsNote.textContent = 'Asking what’s on offer…';
    try {
      const models = await createProvider(draft).listModels();
      if (!models.length) {
        els.modelsNote.textContent = 'The list came back empty — the model name above still stands.';
        return;
      }
      els.modelsNote.textContent = `${models.length} on offer. Pick one and it fills the model field.`;
      els.modelsPick.textContent = '';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Choose one…';
      els.modelsPick.appendChild(placeholder);
      for (const m of models) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.label === m.id ? m.id : `${m.label} (${m.id})`;
        els.modelsPick.appendChild(opt);
      }
      els.modelsLabel.hidden = false;
    } catch (err) {
      els.modelsNote.textContent = err.message || 'The offer wouldn’t come through — the model name above still stands.';
    } finally {
      els.btnFetchModels.disabled = false;
    }
  });

  els.modelsPick.addEventListener('change', () => {
    if (els.modelsPick.value) els.model.value = els.modelsPick.value;
  });

  els.btnAdd.addEventListener('click', () => openForm(null));
  els.btnCancel.addEventListener('click', () => { els.form.hidden = true; editingId = null; });

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = presetById(els.preset.value);
    /* A dial left empty stays unset — the providers then send nothing for
     * it and the storyteller's own defaults rule (M8). */
    const numOrUnset = (input) => {
      const n = parseFloat(input.value);
      return input.value.trim() !== '' && Number.isFinite(n) ? n : undefined;
    };
    const fields = {
      label: els.label.value.trim() || p.label,
      type: p.type,
      baseUrl: els.baseUrl.value.trim(),
      apiKey: els.apiKey.value.trim(),
      model: els.model.value.trim(),
      temperature: numOrUnset(els.connTemperature),
      topP: numOrUnset(els.connTopP),
      maxTokens: numOrUnset(els.connMaxTokens),
      contextSize: numOrUnset(els.connContextSize),
    };
    /* M8.5: the thinking voice — kept only when it's on. */
    const effort = els.connReasoning.value;
    if (effort === 'low' || effort === 'medium' || effort === 'high') {
      fields.reasoning = { effort };
      const budget = numOrUnset(els.connBudget);
      if (budget) fields.reasoning.budgetTokens = budget;
    } else {
      fields.reasoning = undefined;
    }
    if (editingId) {
      /* update() treats null as "let the dial go" (store.js, M8). */
      const patch = { ...fields };
      for (const key of ['temperature', 'topP', 'maxTokens', 'contextSize', 'reasoning']) {
        if (patch[key] === undefined) patch[key] = null;
      }
      await db.connections.update(editingId, patch);
    } else {
      const saved = await db.connections.add(fields);
      if (!(await activeConnectionId())) {
        await db.settings.set('activeConnectionId', saved.id);
      }
    }
    els.form.hidden = true;
    editingId = null;
    hideModelPicker();
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
    els.briefStoryName.textContent = storyName;
    els.castStoryName.textContent = storyName;
    els.loreStoryName.textContent = storyName;
    els.thinkingStoryName.textContent = storyName;
    els.frameStory.value = (story && story.frameOverride) || '';
    els.noteStory.value = (story && story.noteOverride) || '';
    els.briefStory.value = (story && story.brief) || '';
    els.castStory.value = (story && story.castNotes) || '';
    const hasStory = Boolean(story);
    els.frameStory.disabled = !hasStory;
    els.noteStory.disabled = !hasStory;
    els.briefStory.disabled = !hasStory;
    els.castStory.disabled = !hasStory;
    document.getElementById('btn-save-frame-story').disabled = !hasStory;
    document.getElementById('btn-save-note-story').disabled = !hasStory;
    document.getElementById('btn-save-brief').disabled = !hasStory;
    document.getElementById('btn-save-cast').disabled = !hasStory;
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
  document.getElementById('btn-save-brief').addEventListener('click', async () => {
    const story = await activeStory();
    if (!story) return;
    await db.stories.update(story.id, { brief: els.briefStory.value });
    flash('brief-saved');
  });
  document.getElementById('btn-save-cast').addEventListener('click', async () => {
    const story = await activeStory();
    if (!story) return;
    await db.stories.update(story.id, { castNotes: els.castStory.value });
    flash('cast-saved');
  });

  /* ---------- the rulebook (M2) ---------- */

  let editingModuleId = null;
  let editingModulePinned = false;

  /* M9: the when-picker speaks the builtins' own words (WHEN_WORDS). A rule
   * of your own may choose when it wakes; a builtin keeps its own ears, so
   * for forks the picker rests, showing what it hears. */
  function fillWhenPicker(mod) {
    els.modWhen.textContent = '';
    const keys = ['always', 'intimate', 'combat', 'acoustics', 'socialField', 'manual'];
    for (const key of keys) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = WHEN_WORDS[key] || key;
      els.modWhen.appendChild(opt);
    }
    const isBuiltin = mod && mod.source === 'builtin';
    els.modWhen.value = mod && mod.whenKey && keys.includes(mod.whenKey) ? mod.whenKey : 'manual';
    els.modWhen.disabled = Boolean(isBuiltin);
    els.modWhenLabel.title = isBuiltin ? 'A builtin keeps its own ears — fork it and the words change, the waking doesn’t.' : '';
    els.modNote.value = mod && typeof mod.note === 'string' ? mod.note : '';
  }

  function openModuleForm(mod) {
    editingModuleId = mod ? mod.id : null;
    editingModulePinned = mod ? mod.pinned : true;
    els.modForm.hidden = false;
    els.modFormTitle.textContent = mod
      ? (mod.source === 'builtin' ? `Changing “${mod.name}” — your version stands in for the original` : `Changing “${mod.name}”`)
      : 'A rule of your own';
    els.modName.value = mod ? mod.name : '';
    els.modText.value = mod ? mod.text : '';
    fillWhenPicker(mod || null);
    els.modName.focus();
  }

  els.btnAddModule.addEventListener('click', () => openModuleForm(null));
  els.btnModCancel.addEventListener('click', () => { els.modForm.hidden = true; editingModuleId = null; });

  els.modForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = els.modText.value.trim();
    if (!text) return;
    /* Editing a builtin forks it: the saved copy shadows the original,
     * which stays restorable (see modules.js). A rule of your own starts
     * pinned on, so it joins the stack right away. M9: its when-key and
     * quiet note are kept too. */
    await saveModule({
      id: editingModuleId || undefined,
      name: els.modName.value,
      text,
      pinned: editingModulePinned,
      whenKey: els.modWhen.disabled ? undefined : els.modWhen.value,
      note: els.modNote.value.trim(),
    });
    els.modForm.hidden = true;
    editingModuleId = null;
    renderRulebook();
  });

  async function renderRulebook() {
    const modules = await listModules();
    els.moduleList.textContent = '';

    for (const mod of modules) {
      const li = document.createElement('li');
      li.className = 'connection-card' + (mod.pinned ? ' active' : '');

      const top = document.createElement('div');
      top.className = 'connection-top';
      const name = document.createElement('span');
      name.className = 'connection-name';
      name.textContent = mod.name;
      const when = document.createElement('span');
      when.className = 'connection-kind';
      when.textContent = mod.whenWords || 'on when you pin it';
      top.append(name, when);
      if (mod.overridden) {
        const tag = document.createElement('span');
        tag.className = 'connection-active-tag';
        tag.textContent = '— your version';
        top.appendChild(tag);
      }
      li.appendChild(top);

      /* A quiet line some rules carry — manual rules brought over by the
       * importer say "you choose when this walks in" (M5). */
      if (mod.note) {
        const note = document.createElement('p');
        note.className = 'quiet module-note';
        note.textContent = mod.note;
        li.appendChild(note);
      }

      const pinRow = document.createElement('label');
      pinRow.className = 'radio-row';
      const pin = document.createElement('input');
      pin.type = 'checkbox';
      pin.checked = mod.pinned;
      pin.addEventListener('change', async () => {
        await saveModule({ id: mod.id, name: mod.name, text: mod.text, pinned: pin.checked });
        toast(pin.checked
          ? `“${mod.name}” is pinned on — it rides every turn.`
          : `“${mod.name}” rests until its moment comes.`);
        renderRulebook();
      });
      const pinLabel = document.createElement('span');
      pinLabel.textContent = 'Pinned on — in the stack every turn';
      pinRow.append(pin, pinLabel);
      li.appendChild(pinRow);

      const row = document.createElement('div');
      row.className = 'row';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'text-btn';
      editBtn.textContent = 'Read & change the words';
      editBtn.addEventListener('click', () => openModuleForm(mod));
      row.appendChild(editBtn);

      if (mod.overridden) {
        const restoreBtn = document.createElement('button');
        restoreBtn.type = 'button';
        restoreBtn.className = 'text-btn';
        restoreBtn.textContent = 'Put back the original';
        restoreBtn.addEventListener('click', async () => {
          await removeModule(mod.id);
          renderRulebook();
        });
        row.appendChild(restoreBtn);
      }

      if (mod.custom) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'text-btn';
        removeBtn.textContent = 'Let go';
        removeBtn.addEventListener('click', async () => {
          const sure = window.confirm(`Let go of “${mod.name}”? The rule leaves the book for good.`);
          if (!sure) return;
          await removeModule(mod.id);
          renderRulebook();
        });
        row.appendChild(removeBtn);
      }

      li.appendChild(row);
      els.moduleList.appendChild(li);
    }
  }

  /* ---------- the workers (M3) ---------- */

  /* Who reads each finished page for the ledger. '' means "the same one
   * telling the story". The per-story toggle defaults on; a story with
   * extraction:false keeps its ledger by hand alone. */
  async function renderWorkers() {
    const all = await db.connections.list();
    const wanted = await db.settings.get('workerConnectionId');
    els.workerConn.textContent = '';
    const same = document.createElement('option');
    same.value = '';
    same.textContent = 'The same one telling the story';
    els.workerConn.appendChild(same);
    for (const conn of all) {
      const opt = document.createElement('option');
      opt.value = conn.id;
      opt.textContent = conn.label;
      els.workerConn.appendChild(opt);
    }
    els.workerConn.value = wanted && all.some((c) => c.id === wanted) ? wanted : '';

    const story = await activeStory();
    els.workerStoryName.textContent = story ? `“${story.title}”` : 'this story';
    els.workerExtraction.checked = story ? story.extraction !== false : true;
    els.workerExtraction.disabled = !story;

    /* M9: the story's own storyteller (per-story connection override) —
     * '' follows the house's active connection. */
    els.storyConnName.textContent = story ? `“${story.title}”` : 'this story';
    els.storyConn.textContent = '';
    const house = document.createElement('option');
    house.value = '';
    house.textContent = 'The same as the house';
    els.storyConn.appendChild(house);
    for (const conn of all) {
      const opt = document.createElement('option');
      opt.value = conn.id;
      opt.textContent = conn.label;
      els.storyConn.appendChild(opt);
    }
    els.storyConn.value = story && typeof story.connectionId === 'string'
      && all.some((c) => c.id === story.connectionId) ? story.connectionId : '';
    els.storyConn.disabled = !story;

    /* M9 (B12): three separate switches. The keeper's and the second
     * reader's per-story say ('' follows the house, below). */
    els.workerKeeper.value = story
      ? (story.keeper === true ? 'on' : story.keeper === false ? 'off' : '')
      : '';
    els.workerKeeper.disabled = !story;
    els.workerContinuity.value = story
      ? (story.continuity === true ? 'on' : story.continuity === false ? 'off' : '')
      : '';
    els.workerContinuity.disabled = !story;

    /* M9 (§5): what the tale has spent — the sum of its receipts. */
    if (story) {
      const history = await db.messages.list(story.id);
      let tokens = 0;
      let turns = 0;
      for (const msg of history) {
        if (msg && msg.receipt && typeof msg.receipt.totalTokens === 'number') {
          tokens += msg.receipt.totalTokens;
          turns += 1;
        }
      }
      if (turns) {
        els.spendLine.textContent = `This tale has spent ~${tokens.toLocaleString()} tokens across ${turns} ${turns === 1 ? 'turn' : 'turns'}.`;
        els.spendLine.hidden = false;
      } else {
        els.spendLine.hidden = true;
      }
    } else {
      els.spendLine.hidden = true;
    }
  }

  els.workerConn.addEventListener('change', async () => {
    await db.settings.set('workerConnectionId', els.workerConn.value || null);
  });

  els.storyConn.addEventListener('change', async () => {
    const story = await activeStory();
    if (!story) return;
    await db.stories.update(story.id, { connectionId: els.storyConn.value || null });
  });

  els.workerKeeper.addEventListener('change', async () => {
    const story = await activeStory();
    if (!story) return;
    const v = els.workerKeeper.value;
    await db.stories.update(story.id, { keeper: v === 'on' ? true : v === 'off' ? false : null });
  });

  els.workerContinuity.addEventListener('change', async () => {
    const story = await activeStory();
    if (!story) return;
    const v = els.workerContinuity.value;
    await db.stories.update(story.id, { continuity: v === 'on' ? true : v === 'off' ? false : null });
  });

  els.workerExtraction.addEventListener('change', async () => {
    const story = await activeStory();
    if (!story) return;
    await db.stories.update(story.id, { extraction: els.workerExtraction.checked });
  });

  /* ---------- how much the story remembers (M6) ---------- */

  /* The keeper's switch (default on), the verbatim window (10–100, default
   * 30), and the second reader's switch (default off — it only ever notes
   * drift, and some stories don't want the extra reading). */
  async function renderMemory() {
    const keeperOn = await db.settings.get('memoryKeeper');
    els.memoryKeeper.checked = keeperOn !== false;
    const window = cleanWindow(await db.settings.get('memoryWindow'));
    els.memoryWindow.value = String(window);
    els.memoryWindowValue.textContent = String(window);
    els.continuityCheck.checked = Boolean(await db.settings.get('continuityCheck'));
  }

  els.memoryKeeper.addEventListener('change', async () => {
    await db.settings.set('memoryKeeper', els.memoryKeeper.checked);
  });

  els.memoryWindow.addEventListener('input', () => {
    els.memoryWindowValue.textContent = els.memoryWindow.value;
  });
  els.memoryWindow.addEventListener('change', async () => {
    await db.settings.set('memoryWindow', cleanWindow(els.memoryWindow.value));
  });

  els.continuityCheck.addEventListener('change', async () => {
    await db.settings.set('continuityCheck', els.continuityCheck.checked);
  });

  /* ---------- the referee's dials (M11) ----------
   * M15 audit: onShow() called renderReferee() but no such function lived
   * here — the throw cut off every section below the memory room (cast,
   * lore, the thinking say, the theme) and the four dials themselves had
   * no listeners at all. Now they render and they write. */
  async function renderReferee() {
    els.refereeOn.checked = (await db.settings.get('refereeOn')) !== false;
    els.refereeSensitivity.value = (await db.settings.get('refereeSensitivity')) || 'normal';
    els.refereePreset.value = (await db.settings.get('refereePreset')) || 'realistic';
    els.refereeFightStyle.value = (await db.settings.get('refereeFightStyle')) || 'tracked';
  }

  els.refereeOn.addEventListener('change', async () => {
    await db.settings.set('refereeOn', els.refereeOn.checked);
  });
  els.refereeSensitivity.addEventListener('change', async () => {
    await db.settings.set('refereeSensitivity', els.refereeSensitivity.value);
  });
  els.refereePreset.addEventListener('change', async () => {
    await db.settings.set('refereePreset', els.refereePreset.value);
  });
  els.refereeFightStyle.addEventListener('change', async () => {
    await db.settings.set('refereeFightStyle', els.refereeFightStyle.value);
  });

  /* ---------- bring your engine (M5) ---------- */

  /* The plan currently on the table, or null when nothing has been read.
   * Checkboxes in the preview flip `include` on this very object, so what
   * you see is exactly what applyPlan acts on. */
  let pendingPlan = null;

  function engineSay(message) {
    els.engineNote.hidden = !message;
    els.engineNote.textContent = message || '';
  }

  function hideEnginePreview() {
    pendingPlan = null;
    els.enginePreview.hidden = true;
    els.engineGroups.textContent = '';
  }

  /* One checkbox row for a craft/module item — everything starts included,
   * and unticking simply leaves that piece behind. */
  function includeRow(item, detailText) {
    const li = document.createElement('li');
    li.className = 'connection-card';
    const label = document.createElement('label');
    label.className = 'radio-row';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = item.include !== false;
    box.addEventListener('change', () => { item.include = box.checked; });
    const words = document.createElement('span');
    words.textContent = item.name;
    label.append(box, words);
    li.appendChild(label);
    if (item.guessed) {
      const guess = document.createElement('p');
      guess.className = 'quiet engine-why';
      guess.textContent = '— a guess, from how it reads';
      li.appendChild(guess);
    }
    if (detailText) {
      const detail = document.createElement('p');
      detail.className = 'quiet engine-why';
      detail.textContent = detailText;
      li.appendChild(detail);
    }
    return li;
  }

  function group(title, intro) {
    const wrap = document.createElement('section');
    wrap.className = 'engine-group';
    const h = document.createElement('h4');
    h.textContent = title;
    wrap.appendChild(h);
    if (intro) {
      const p = document.createElement('p');
      p.className = 'quiet';
      p.textContent = intro;
      wrap.appendChild(p);
    }
    const list = document.createElement('ul');
    list.className = 'connection-list';
    wrap.appendChild(list);
    return { wrap, list };
  }

  async function copyWords(text, doneWords) {
    try {
      await navigator.clipboard.writeText(text);
      engineSay(doneWords);
    } catch (err) {
      engineSay('The copy didn’t take — your device said no. The words stand just above; you can take them by hand.');
    }
  }

  function renderEnginePreview(plan, warnings) {
    els.engineGroups.textContent = '';
    els.engineSummary.hidden = true;

    if (plan.craft.length) {
      const { wrap, list } = group(
        'The craft',
        'Standing guidance, always with the storyteller. What you keep here joins The craft as your own version — the shipped original stays underneath, restorable from the rulebook.'
      );
      for (const item of plan.craft) {
        list.appendChild(includeRow(item, `${item.text.split(/\s+/).filter(Boolean).length.toLocaleString()} words`));
      }
      els.engineGroups.appendChild(wrap);
    }

    if (plan.modules.length) {
      const { wrap, list } = group(
        'The rulebook',
        'Rules that load when the scene calls for them — or when you pin them on. Each says when it wakes.'
      );
      for (const item of plan.modules) {
        const when = WHEN_WORDS[item.whenKey] || item.why || 'on when you pin it';
        list.appendChild(includeRow(item, when));
      }
      els.engineGroups.appendChild(wrap);
    }

    if (plan.frameSeeds.length) {
      const { wrap, list } = group(
        'Seeds for the frame & the note',
        'These read like opening and closing words, so they aren’t brought in on their own. Take a copy and paste it into The frame or The note at the end, if you like.'
      );
      for (const item of plan.frameSeeds) {
        const li = document.createElement('li');
        li.className = 'connection-card';
        const top = document.createElement('div');
        top.className = 'connection-top';
        const name = document.createElement('span');
        name.className = 'connection-name';
        name.textContent = item.name;
        top.appendChild(name);
        if (item.guessed) {
          const tag = document.createElement('span');
          tag.className = 'connection-active-tag';
          tag.textContent = '— a guess';
          top.appendChild(tag);
        }
        const row = document.createElement('div');
        row.className = 'row';
        /* A taste of the words, so the seeds can be read (and taken by
         * hand) even where the clipboard is refused. */
        const excerpt = document.createElement('p');
        excerpt.className = 'quiet engine-why';
        const plain = item.text.replace(/\s+/g, ' ').trim();
        excerpt.textContent = plain.length > 160 ? plain.slice(0, 160).trimEnd() + '…' : plain;
        const frameBtn = document.createElement('button');
        frameBtn.type = 'button';
        frameBtn.className = 'text-btn';
        frameBtn.textContent = 'Copy for the frame';
        frameBtn.addEventListener('click', () => copyWords(item.text, 'Copied — paste it into The frame above, if it suits.'));
        const noteBtn = document.createElement('button');
        noteBtn.type = 'button';
        noteBtn.className = 'text-btn';
        noteBtn.textContent = 'Copy for the note';
        noteBtn.addEventListener('click', () => copyWords(item.text, 'Copied — paste it into The note at the end above, if it suits.'));
        row.append(frameBtn, noteBtn);
        li.append(top, excerpt, row);
        list.appendChild(li);
      }
      els.engineGroups.appendChild(wrap);
    }

    if (plan.retired.length) {
      const { wrap, list } = group(
        'Retired into the house',
        'These blocks did work the house and its engines now do themselves. They rest here, with the reason why — nothing to bring home.'
      );
      for (const item of plan.retired) {
        const li = document.createElement('li');
        li.className = 'connection-card';
        const top = document.createElement('div');
        top.className = 'connection-top';
        const name = document.createElement('span');
        name.className = 'connection-name';
        name.textContent = item.name;
        top.appendChild(name);
        const why = document.createElement('p');
        why.className = 'quiet engine-why';
        why.textContent = item.why;
        li.append(top, why);
        list.appendChild(li);
      }
      els.engineGroups.appendChild(wrap);
    }

    if (plan.skipped.length) {
      const p = document.createElement('p');
      p.className = 'quiet';
      p.textContent = `${plan.skipped.length} ${plan.skipped.length === 1 ? 'block was' : 'blocks were'} left behind — markers, off-switches, and empty husks the house keeps for itself.`;
      els.engineGroups.appendChild(p);
    }

    els.enginePreview.hidden = false;
    const counted = plan.craft.length + plan.modules.length + plan.frameSeeds.length
      + plan.retired.length + plan.skipped.length;
    const warnText = warnings && warnings.length ? ' (' + warnings.join(' ') + ')' : '';
    engineSay(`Read ${counted} ${counted === 1 ? 'block' : 'blocks'} from the preset.${warnText} Untick anything you'd rather leave behind, then bring it home.`);
  }

  function readEngine(text) {
    hideEnginePreview();
    els.engineSummary.hidden = true;
    try {
      const { entries, warnings } = parsePreset(text);
      pendingPlan = decompose(entries);
      renderEnginePreview(pendingPlan, warnings);
    } catch (err) {
      engineSay(err.message || 'That file wouldn’t open. Is it a preset export?');
    }
  }

  els.engineFile.addEventListener('change', async () => {
    const file = els.engineFile.files && els.engineFile.files[0];
    els.engineFile.value = '';
    if (!file) return;
    try {
      readEngine(await file.text());
    } catch (err) {
      engineSay('That file wouldn’t open — the device couldn’t read it. Try pasting its words instead.');
    }
  });

  els.btnEngineRead.addEventListener('click', () => {
    const text = els.enginePaste.value.trim();
    if (!text) {
      engineSay('Paste the preset’s words first — or choose the file just above.');
      return;
    }
    readEngine(text);
  });

  els.btnEngineDismiss.addEventListener('click', () => {
    hideEnginePreview();
    engineSay('Left as it was. The preset waits whenever you want to look again.');
  });

  els.btnEngineApply.addEventListener('click', async () => {
    if (!pendingPlan) return;
    els.btnEngineApply.disabled = true;
    try {
      const summary = await applyPlan(pendingPlan);
      hideEnginePreview();
      engineSay('');
      els.engineSummary.hidden = false;
      els.engineSummary.textContent = summaryWords(summary);
      await renderRulebook();
    } catch (err) {
      engineSay('Something went wrong while writing it down — nothing was brought home. The preset is unchanged.');
    } finally {
      els.btnEngineApply.disabled = false;
    }
  });

  /* ---------- bring your people / lore / old chats (M7) ---------- */

  function say(el, message) {
    el.hidden = !message;
    el.textContent = message || '';
  }

  /* The cast library shelf: every card that has come home, with a quiet
   * note of how it arrived and a way to let it go (which un-invites it
   * from every story — see cards.js). */
  async function renderCast() {
    const cards = await listCast();
    els.castList.textContent = '';
    els.castListEmpty.hidden = cards.length > 0;
    for (const card of cards) {
      const li = document.createElement('li');
      li.className = 'connection-card';

      const top = document.createElement('div');
      top.className = 'connection-top';
      const name = document.createElement('span');
      name.className = 'connection-name';
      name.textContent = card.name;
      const kind = document.createElement('span');
      kind.className = 'connection-kind';
      const bits = [card.source === 'png' ? 'from a picture' : 'from a JSON card'];
      if (card.alternateGreetings && card.alternateGreetings.length) {
        bits.push(`${card.alternateGreetings.length} other ${card.alternateGreetings.length === 1 ? 'greeting' : 'greetings'}`);
      }
      kind.textContent = bits.join(' · ');
      top.append(name, kind);
      li.appendChild(top);

      if (card.description) {
        const excerpt = document.createElement('p');
        excerpt.className = 'quiet engine-why';
        const plain = card.description.replace(/\s+/g, ' ').trim();
        excerpt.textContent = plain.length > 160 ? plain.slice(0, 160).trimEnd() + '…' : plain;
        li.appendChild(excerpt);
      }

      const row = document.createElement('div');
      row.className = 'row';
      /* M9: read & change what the card brought. */
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'text-btn';
      editBtn.textContent = 'Read & change';
      editBtn.addEventListener('click', () => openCardForm(card));
      row.appendChild(editBtn);
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'text-btn';
      removeBtn.textContent = 'Let go';
      removeBtn.addEventListener('click', async () => {
        const sure = window.confirm(`Let go of “${card.name}”? They’ll step out of every story’s cast.`);
        if (!sure) return;
        await removeCastMember(card.id);
        say(els.cardNote, `“${card.name}” has been let go.`);
        renderCast();
      });
      row.appendChild(removeBtn);
      li.appendChild(row);
      els.castList.appendChild(li);
    }
  }

  /* M9: the card editor — every field the card brought, re-inkable. The
   * maker's notes stay home (they never ride the wire). */
  let editingCardId = null;

  function openCardForm(card) {
    editingCardId = card ? card.id : null;
    if (!card) return;
    els.cardForm.hidden = false;
    els.cardFormTitle.textContent = `“${card.name}” — the card’s words`;
    els.cardEditName.value = card.name || '';
    els.cardEditDescription.value = card.description || '';
    els.cardEditPersonality.value = card.personality || '';
    els.cardEditScenario.value = card.scenario || '';
    els.cardEditFirstMes.value = card.firstMes || '';
    els.cardEditNotes.value = card.creatorNotes || '';
    els.cardEditName.focus();
  }

  els.btnCardCancel.addEventListener('click', () => {
    els.cardForm.hidden = true;
    editingCardId = null;
  });

  els.cardForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!editingCardId) return;
    const cards = await listCast();
    const card = cards.find((c) => c.id === editingCardId);
    if (!card) { els.cardForm.hidden = true; return; }
    const next = {
      ...card,
      name: els.cardEditName.value.trim() || card.name,
      description: els.cardEditDescription.value,
      personality: els.cardEditPersonality.value,
      scenario: els.cardEditScenario.value,
      firstMes: els.cardEditFirstMes.value,
      creatorNotes: els.cardEditNotes.value,
    };
    await saveCastMember(next);
    els.cardForm.hidden = true;
    editingCardId = null;
    say(els.cardNote, `“${next.name}” is re-inked.`);
    renderCast();
  });

  els.cardFile.addEventListener('change', async () => {
    const file = els.cardFile.files && els.cardFile.files[0];
    els.cardFile.value = '';
    if (!file) return;
    try {
      const card = await parseCard(file);
      await saveCastMember(card);
      say(els.cardNote, `${card.name} has come home — a story can invite them in from the ledger’s Who’s here.`);
      await renderCast();
    } catch (err) {
      say(els.cardNote, err.message || 'That card wouldn’t open.');
    }
  });

  /* The lore shelf: one per story, for whichever story is open. M9: the
   * entries themselves are listed — each can be switched off, marked
   * constant (always rides), re-keyed, re-worded, moved, or let go. */
  function loreEntryRow(storyId, entry, index, total) {
    const li = document.createElement('li');
    li.className = 'connection-card lore-entry';

    const top = document.createElement('div');
    top.className = 'connection-top';
    const name = document.createElement('span');
    name.className = 'connection-name';
    const title = (entry.name && String(entry.name).trim())
      || (Array.isArray(entry.keys) && entry.keys.length ? entry.keys.join(', ') : 'an unnamed entry');
    name.textContent = title;
    const kind = document.createElement('span');
    kind.className = 'connection-kind';
    const bits = [];
    if (entry.constant === true) bits.push('always rides');
    if (Array.isArray(entry.secondaryKeys) && entry.secondaryKeys.length) bits.push('needs a second key too');
    bits.push(`scans the last ${Number.isFinite(entry.depth) ? entry.depth : 2} pages`);
    kind.textContent = bits.join(' · ');
    top.append(name, kind);
    li.appendChild(top);

    const toggles = document.createElement('div');
    toggles.className = 'row';
    const enabledLabel = document.createElement('label');
    enabledLabel.className = 'radio-row';
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = entry.enabled !== false;
    enabled.addEventListener('change', async () => {
      await updateLoreEntry(storyId, entry.id, { enabled: enabled.checked });
    });
    enabledLabel.append(enabled, document.createTextNode(' On the shelf'));
    const constantLabel = document.createElement('label');
    constantLabel.className = 'radio-row';
    const constant = document.createElement('input');
    constant.type = 'checkbox';
    constant.checked = entry.constant === true;
    constant.addEventListener('change', async () => {
      await updateLoreEntry(storyId, entry.id, { constant: constant.checked });
      renderLore();
    });
    constantLabel.append(constant, document.createTextNode(' Always rides'));
    toggles.append(enabledLabel, constantLabel);
    li.appendChild(toggles);

    const keysInput = document.createElement('input');
    keysInput.type = 'text';
    keysInput.className = 'lore-keys';
    keysInput.value = Array.isArray(entry.keys) ? entry.keys.join(', ') : '';
    keysInput.placeholder = 'Words that wake it, comma-parted';
    keysInput.setAttribute('aria-label', `Words that wake “${title}”`);
    li.appendChild(keysInput);

    const content = document.createElement('textarea');
    content.className = 'lore-content';
    content.rows = 3;
    content.spellcheck = false;
    content.value = typeof entry.content === 'string' ? entry.content : '';
    content.setAttribute('aria-label', `What “${title}” says`);
    li.appendChild(content);

    const row = document.createElement('div');
    row.className = 'row';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'text-btn';
    saveBtn.textContent = 'Keep it';
    saveBtn.addEventListener('click', async () => {
      await updateLoreEntry(storyId, entry.id, {
        keys: keysInput.value.split(',').map((k) => k.trim()).filter(Boolean),
        content: content.value,
      });
      say(els.loreNote, 'The entry is kept.');
    });
    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'text-btn';
    upBtn.textContent = '↑';
    upBtn.title = 'Earlier on the shelf';
    upBtn.setAttribute('aria-label', `Move “${title}” earlier on the shelf`);
    upBtn.disabled = index === 0;
    upBtn.addEventListener('click', async () => {
      await moveLoreEntry(storyId, entry.id, -1);
      renderLore();
    });
    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'text-btn';
    downBtn.textContent = '↓';
    downBtn.title = 'Later on the shelf';
    downBtn.setAttribute('aria-label', `Move “${title}” later on the shelf`);
    downBtn.disabled = index === total - 1;
    downBtn.addEventListener('click', async () => {
      await moveLoreEntry(storyId, entry.id, 1);
      renderLore();
    });
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'text-btn';
    removeBtn.textContent = 'Let it go';
    removeBtn.addEventListener('click', async () => {
      const sure = window.confirm(`Let “${title}” leave the shelf?`);
      if (!sure) return;
      await removeLoreEntry(storyId, entry.id);
      renderLore();
    });
    row.append(saveBtn, upBtn, downBtn, removeBtn);
    li.appendChild(row);
    return li;
  }

  async function renderLore() {
    const story = await activeStory();
    const entries = story ? await loadLore(story.id) : [];
    els.loreFile.disabled = !story;
    els.loreCount.hidden = !entries.length;
    els.btnLoreClear.hidden = !entries.length;
    els.loreList.textContent = '';
    if (entries.length) {
      els.loreCount.textContent = `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} on the shelf.`;
      entries.forEach((entry, index) => {
        els.loreList.appendChild(loreEntryRow(story.id, entry, index, entries.length));
      });
    } else {
      els.loreCount.textContent = '';
    }
  }

  els.loreFile.addEventListener('change', async () => {
    const file = els.loreFile.files && els.loreFile.files[0];
    els.loreFile.value = '';
    if (!file) return;
    const story = await activeStory();
    if (!story) {
      say(els.loreNote, 'Open a story first — lore shelves itself per tale.');
      return;
    }
    try {
      const entries = parseLorebook(await file.text());
      await saveLore(story.id, entries);
      say(els.loreNote, `The shelf is stocked for “${story.title}” — entries wake when their words are spoken in the latest pages.`);
      await renderLore();
    } catch (err) {
      say(els.loreNote, err.message || 'That lorebook wouldn’t open.');
    }
  });

  els.btnLoreClear.addEventListener('click', async () => {
    const story = await activeStory();
    if (!story) return;
    const sure = window.confirm(`Take the lore shelf down for “${story.title}”? The entries will be gone.`);
    if (!sure) return;
    await saveLore(story.id, []);
    say(els.loreNote, 'The shelf is bare again.');
    await renderLore();
  });

  els.chatFile.addEventListener('change', async () => {
    const file = els.chatFile.files && els.chatFile.files[0];
    els.chatFile.value = '';
    if (!file) return;
    try {
      const parsed = parseSTChat(await file.text());
      const storyId = await importAsStory(parsed);
      say(els.chatImportNote, `“${parsed.title}” is on the shelf now — ${parsed.messages.length} ${parsed.messages.length === 1 ? 'page' : 'pages'} carried over, every word as written.`);
      if (ctx.chat) {
        ctx.setActiveStoryId(storyId);
        await ctx.chat.refreshStories(true);
        await ctx.chat.renderThread();
      }
      if (ctx.onStoriesChanged) ctx.onStoriesChanged();
    } catch (err) {
      say(els.chatImportNote, err.message || 'That export wouldn’t open.');
    }
  });

  /* ---------- the thinking voice (M8.5) ---------- */

  /* The story's own say over its connection's reasoning effort ('' follows
   * the connection), and the house-wide choice of whether the folded
   * weighing shows at all (default: it shows). */
  async function renderThinking() {
    const story = await activeStory();
    els.thinkingStory.value = story && typeof story.reasoningEffort === 'string'
      ? story.reasoningEffort
      : '';
    els.thinkingStory.disabled = !story;
    els.showThinking.checked = (await db.settings.get('showThinking')) !== false;
  }

  els.thinkingStory.addEventListener('change', async () => {
    const story = await activeStory();
    if (!story) return;
    await db.stories.update(story.id, { reasoningEffort: els.thinkingStory.value });
  });

  els.showThinking.addEventListener('change', async () => {
    await db.settings.set('showThinking', els.showThinking.checked);
    if (ctx.chat) await ctx.chat.renderThread();
  });

  /* ---------- appearance ---------- */

  async function loadTheme() {
    const mode = (await db.settings.get('theme')) || 'dark';
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
    toast('The tavern’s words are folded into one file — a copy is in your downloads.');
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
    await renderRulebook();
    await renderWorkers();
    await renderMemory();
    await renderReferee();
    await renderCast();
    await renderLore();
    await renderThinking();
    await loadTheme();
  }

  /* B7 (M9): when the shelf of stories changes while Settings stands open,
   * the per-story blocks (frame/note/brief/cast names, the workers'
   * switches, the spend line, the lore shelf, the thinking say) refresh
   * with it. */
  function onStoriesChanged() {
    if (document.getElementById('view-settings').hidden) return;
    loadPromptSlots();
    renderWorkers();
    renderMemory();
    renderLore();
    renderThinking();
  }

  ctx.settings = { onShow, onStoriesChanged };
}
