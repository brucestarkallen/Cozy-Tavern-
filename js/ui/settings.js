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
import { createProvider, presetById, normalizeBaseUrl, wouldNormalize } from '../providers/index.js';
import { EFFORT_RANK, effortFor, reasonStyle } from '../providers/effort.js';
import { download } from './download.js';
import { STARTER_FRAME, STARTER_NOTE, FRAME_PURPOSE } from '../assemble/stack.js';
import { listModules, saveModule, removeModule, WHEN_WORDS } from '../assemble/modules.js';
import { parsePreset, decompose, applyPlan, summaryWords } from '../import/sillytavern.js';
import { parseCard, listCast, saveCastMember, removeCastMember } from '../import/cards.js';
/* M15 audit: the lore shelf's hand controls (toggle, mark constant, edit,
 * reorder, let go) called updateLoreEntry/moveLoreEntry/removeLoreEntry
 * without importing them — every one of those clicks threw. */
import {
  parseLorebook, saveLore, loadLore, updateLoreEntry, moveLoreEntry, removeLoreEntry,
  loreToWorldbook, worldbookFilename,
} from '../import/lorebook.js';
import { parseSTChat, importAsStory } from '../import/chats.js';
import { cleanWindow } from '../agents/memory.js';
import { WORKER_ROWS } from '../agents/assign.js';
/* M16: the house's version word stands in the header line. */
import { VERSION } from '../version.js';
import { loadRules, saveRules, tryRule, applyRules, builtinOriginal, importSillyTavernRegex, MODE_WORDS, VOICE_WORDS } from '../regex.js'; /* M30: the regex shelf; M31: bring your SillyTavern regex */
import { pageText } from '../assemble/stack.js';

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
    /* M22-B/C/D: the address courtesy, the model hint, the search row,
     * and the prefill with its probe. */
    urlhint: document.getElementById('conn-urlhint'),
    urlhintText: document.getElementById('conn-urlhint-text'),
    addv1: document.getElementById('conn-addv1'),
    modelHint: document.getElementById('conn-model-hint'),
    apiKey: document.getElementById('conn-apikey'),
    model: document.getElementById('conn-model'),
    searchRow: document.getElementById('conn-search-row'),
    search: document.getElementById('conn-search'),
    searchCountLabel: document.getElementById('conn-search-count-label'),
    searchCount: document.getElementById('conn-search-count'),
    searchNote: document.getElementById('conn-search-note'),
    prefill: document.getElementById('conn-prefill'),
    btnPrefillTest: document.getElementById('btn-prefill-test'),
    prefillVerdict: document.getElementById('conn-prefill-verdict'),
    downNote: document.getElementById('conn-down-note'),
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
    /* M21: the frame's purpose line and its end-of-request echo. */
    framePurpose: document.getElementById('frame-purpose'),
    framePurposeOn: document.getElementById('frame-purpose-on'),
    frameEcho: document.getElementById('frame-echo'),
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
    booksLive: document.getElementById('books-live'),
    workerConn: document.getElementById('worker-connection'),
    workerAssignments: document.getElementById('worker-assignments'),
    workerExtraction: document.getElementById('worker-extraction'),
    workerStoryName: document.getElementById('worker-story-name'),
    storyConn: document.getElementById('story-connection'),
    storyConnName: document.getElementById('story-conn-name'),
    workerKeeper: document.getElementById('worker-keeper'),
    workerContinuity: document.getElementById('worker-continuity'),
    spendLine: document.getElementById('spend-line'),
    /* M30: the regex shelf */
    regexList: document.getElementById('regex-list'),
    regexForm: document.getElementById('regex-form'),
    regexName: document.getElementById('regex-name'),
    regexFind: document.getElementById('regex-find'),
    regexFlags: document.getElementById('regex-flags'),
    regexReplace: document.getElementById('regex-replace'),
    regexOn: document.getElementById('regex-on'),
    regexMode: document.getElementById('regex-mode'),
    btnRegexTry: document.getElementById('btn-regex-try'),
    btnRegexSave: document.getElementById('btn-regex-save'),
    btnRegexCancel: document.getElementById('btn-regex-cancel'),
    regexTryNote: document.getElementById('regex-try-note'),
    btnRegexAdd: document.getElementById('btn-regex-add'),
    btnRegexClean: document.getElementById('btn-regex-clean'),
    regexFile: document.getElementById('regex-file'),
    regexImportNote: document.getElementById('regex-import-note'),
    regexCleanNote: document.getElementById('regex-clean-note'),
    memoryKeeper: document.getElementById('memory-keeper'),
    memoryWindow: document.getElementById('memory-window'),
    memoryWindowValue: document.getElementById('memory-window-value'),
    continuityCheck: document.getElementById('continuity-check'),
    worldAgent: document.getElementById('world-agent'),
    worldEffort: document.getElementById('world-effort'),
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
    /* M22-E7: the shelf walks back to SillyTavern. */
    btnLoreExport: document.getElementById('btn-lore-export'),
    chatFile: document.getElementById('chat-file'),
    chatImportNote: document.getElementById('chat-import-note'),
    thinkingStory: document.getElementById('thinking-story'),
    thinkingStoryName: document.getElementById('thinking-story-name'),
    showThinking: document.getElementById('show-thinking'),
    /* M16: the version line, and the shelf a story sits on. */
    versionLine: document.getElementById('settings-version'),
    /* M18: the chip row that carries you straight to any room. */
    quicknav: document.getElementById('settings-quicknav'),
    storyShelf: document.getElementById('story-shelf'),
    shelfStoryName: document.getElementById('shelf-story-name'),
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
      /* M22-A: what the thinking level is actually SPOKEN as on this wire
       * (the alias-down made visible) — only when it's on. */
      const effort = conn.reasoning && typeof conn.reasoning.effort === 'string' ? conn.reasoning.effort : 'off';
      if (effort !== 'off') {
        const spoken = document.createElement('span');
        spoken.className = 'connection-kind';
        const said = conn.reasoningDownAt
          ? 'unsent — the wire refused it once'
          : `spoken as “${effortFor(reasonStyle(conn), effort)}”`;
        spoken.textContent = `thinking: ${effort} — ${said}`;
        top.appendChild(spoken);
      }
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
    /* M22-B: the model's-room placeholder and the hint under the model
     * field follow the preset's proven numbers. */
    els.connContextSize.placeholder = String(p.contextSize || 200000);
    if (els.modelHint) {
      els.modelHint.textContent = p.hint || '';
      els.modelHint.hidden = !p.hint;
    }
    if (!editingId) {
      els.baseUrl.value = p.baseUrl;
      els.model.value = p.model;
      if (!els.label.value || els.label.dataset.autofill === '1') {
        els.label.value = p.label;
        els.label.dataset.autofill = '1';
      }
    }
    refreshAddressHint();
    refreshSearchRow();
  }

  /* M22-B: the live address courtesy. Claude's address is left as-is;
   * everywhere else the hint says "Usually ends in /v1", and when the
   * typed address is a known house missing its version segment, the
   * one-tap "add /v1" offers itself. */
  function refreshAddressHint() {
    if (!els.urlhintText) return;
    const p = presetById(els.preset.value);
    if (p.type === 'anthropic') {
      els.urlhintText.textContent = 'Leave as-is unless you know otherwise.';
      els.addv1.hidden = true;
      return;
    }
    els.urlhintText.textContent = 'Usually ends in /v1';
    const typed = els.baseUrl.value.trim();
    els.addv1.hidden = !(typed && wouldNormalize(typed));
  }

  /* M22-C: "let it look things up" is offered only where the house has a
   * native tool for it — Claude connections and OpenRouter. Elsewhere the
   * row rests, hidden, with a kind note on hover. */
  function searchOffered() {
    const p = presetById(els.preset.value);
    if (p.type === 'anthropic') return true;
    if (p.id === 'openrouter') return true;
    return /\bopenrouter\.ai\b/.test(els.baseUrl.value.trim());
  }

  function refreshSearchRow() {
    if (!els.searchRow) return;
    const offered = searchOffered();
    els.searchRow.hidden = !offered;
    els.searchCountLabel.hidden = !offered;
    if (els.searchNote) {
      els.searchNote.hidden = offered;
      if (!offered) {
        els.searchNote.textContent = 'This address has no looking-things-up of its own — the switch rests.';
        els.searchNote.title = 'Web search rides a storyteller’s own tool: Claude’s native search, or OpenRouter’s web plugin. A plain OpenAI-compatible address has neither, so the switch stays home rather than pretend.';
      }
    }
  }

  /* Which preset a saved connection most resembles, so "Change" opens the
   * form on familiar footing. */
  function presetFor(conn) {
    /* M22: the form stores the preset it started from — trust it first. */
    if (conn.preset && typeof conn.preset === 'string') return conn.preset;
    if (conn.type === 'anthropic') return 'claude';
    const base = (conn.baseUrl || '').toLowerCase();
    if (base.includes('openrouter.ai')) return 'openrouter';
    if (base.includes('api.openai.com')) return 'openai';
    if (base.includes('api.z.ai')) return 'zai';
    if (base.includes('generativelanguage.googleapis.com')) return 'google';
    if (base.includes('api.deepseek.com')) return 'deepseek';
    if (base.includes('127.0.0.1:8642')) return 'hermes';
    return 'custom';
  }

  els.preset.addEventListener('change', fillFromPreset);
  els.label.addEventListener('input', () => { els.label.dataset.autofill = '0'; });
  /* M22-B: the address courtesy is live as you type. */
  els.baseUrl.addEventListener('input', () => { refreshAddressHint(); refreshSearchRow(); });
  els.addv1.addEventListener('click', () => {
    els.baseUrl.value = normalizeBaseUrl(els.baseUrl.value);
    refreshAddressHint();
    refreshSearchRow();
  });

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
      /* M22-C/D: the search switch, its ceiling, and the prefill. */
      els.search.checked = conn.searchOn === true;
      els.searchCount.value = typeof conn.searchMaxUses === 'number' ? String(conn.searchMaxUses) : '';
      els.prefill.value = typeof conn.prefill === 'string' ? conn.prefill : '';
      /* The refusal memories speak plainly while they stand. */
      if (els.downNote) {
        const bits = [];
        if (conn.reasoningDownAt) bits.push('it once refused the thinking settings, so they ride unsent');
        if (conn.prefillDownAt) bits.push('it once refused a started reply, so the prefill rides unsent');
        els.downNote.hidden = !bits.length;
        els.downNote.textContent = bits.length
          ? `A note from the wire: ${bits.join('; and ')} — until the model changes. Saving with a new model tries again.`
          : '';
      }
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
      els.search.checked = false;
      els.searchCount.value = '';
      els.prefill.value = '';
      if (els.downNote) els.downNote.hidden = true;
      fillFromPreset();
    }
    if (els.prefillVerdict) els.prefillVerdict.hidden = true;
    refreshAddressHint();
    refreshSearchRow();
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

  /* M22-D: "Test it" — the prefill probe. Sends a tiny exchange with the
   * prefill applied per this house's rules and reports plainly: took it,
   * or won't take a prefill (which also marks the connection's memory, so
   * no real turn is ever spent on it). */
  els.btnPrefillTest.addEventListener('click', async () => {
    const p = presetById(els.preset.value);
    const draft = {
      id: editingId || undefined,
      type: p.type,
      preset: p.id,
      baseUrl: p.type === 'anthropic'
        ? els.baseUrl.value.trim().replace(/\/+$/, '')
        : normalizeBaseUrl(els.baseUrl.value),
      apiKey: els.apiKey.value.trim(),
      model: els.model.value.trim(),
      prefill: els.prefill.value,
    };
    els.btnPrefillTest.disabled = true;
    els.prefillVerdict.hidden = false;
    els.prefillVerdict.className = 'quiet';
    els.prefillVerdict.textContent = 'Asking, just a whisper of a request…';
    try {
      const { ok, detail } = await createProvider(draft).testPrefill();
      els.prefillVerdict.textContent = detail;
      els.prefillVerdict.className = ok ? 'quiet test-result ok' : 'quiet test-result bad';
      toast(ok ? 'The prefill took.' : 'The prefill wouldn’t take — the words above say why.');
      if (ok && editingId) {
        /* A fresh yes lifts an old refusal — the model behind the address
         * may have changed. */
        await db.connections.update(editingId, { prefillDownAt: null });
        if (els.downNote) els.downNote.hidden = true;
      }
    } finally {
      els.btnPrefillTest.disabled = false;
    }
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
    /* M22-B: the SillyTavern courtesy — the address is normalized as it's
     * kept (trailing slashes stripped, a known house's missing /v1 added).
     * Claude's address is left exactly as typed. */
    const address = p.type === 'anthropic'
      ? els.baseUrl.value.trim().replace(/\/+$/, '')
      : normalizeBaseUrl(els.baseUrl.value);
    const fields = {
      label: els.label.value.trim() || p.label,
      type: p.type,
      preset: p.id,
      baseUrl: address,
      apiKey: els.apiKey.value.trim(),
      model: els.model.value.trim(),
      temperature: numOrUnset(els.connTemperature),
      topP: numOrUnset(els.connTopP),
      maxTokens: numOrUnset(els.connMaxTokens),
      contextSize: numOrUnset(els.connContextSize),
    };
    /* M22-C/D: the search switch and its ceiling, and the prefill —
     * kept only when they're on/filled. */
    fields.searchOn = searchOffered() && els.search.checked ? true : undefined;
    fields.searchMaxUses = fields.searchOn ? numOrUnset(els.searchCount) : undefined;
    fields.prefill = els.prefill.value.trim() ? els.prefill.value : undefined;
    /* M8.5/M22-A: the thinking voice — the full ladder, kept only when on.
     * What the wire can actually say is resolved per house at send time
     * (effort.js). */
    const effort = els.connReasoning.value;
    if (EFFORT_RANK.includes(effort) && effort !== 'off') {
      fields.reasoning = { effort };
      const budget = numOrUnset(els.connBudget);
      if (budget) fields.reasoning.budgetTokens = budget;
    } else {
      fields.reasoning = undefined;
    }
    if (editingId) {
      /* update() treats null as "let the dial go" (store.js, M8). */
      const patch = { ...fields };
      for (const key of ['temperature', 'topP', 'maxTokens', 'contextSize', 'reasoning', 'searchOn', 'searchMaxUses', 'prefill']) {
        if (patch[key] === undefined) patch[key] = null;
      }
      /* M22-A/D: the refusal memories stand until the model field
       * changes — a new model (or a new address) tries again. */
      const stored = await db.connections.list().then((all) => all.find((c) => c.id === editingId));
      if (stored && (stored.model !== fields.model || stored.baseUrl !== fields.baseUrl)) {
        patch.reasoningDownAt = null;
        patch.prefillDownAt = null;
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
    /* M21: the frame's purpose line (?? — a cleared line stays cleared) and
     * the two toggles: purpose on by default, the echo off by default. */
    if (els.framePurpose) els.framePurpose.value = (await db.settings.get('framePurpose')) ?? FRAME_PURPOSE;
    if (els.framePurposeOn) els.framePurposeOn.checked = (await db.settings.get('framePurposeOn')) !== false;
    if (els.frameEcho) els.frameEcho.checked = (await db.settings.get('frameEcho')) === true;

    const story = await activeStory();
    const storyName = story ? `“${story.title}”` : 'this story';
    els.frameStoryName.textContent = storyName;
    els.noteStoryName.textContent = storyName;
    els.briefStoryName.textContent = storyName;
    els.castStoryName.textContent = storyName;
    els.loreStoryName.textContent = storyName;
    els.thinkingStoryName.textContent = storyName;
    els.shelfStoryName.textContent = storyName;
    els.frameStory.value = (story && story.frameOverride) || '';
    els.noteStory.value = (story && story.noteOverride) || '';
    els.briefStory.value = (story && story.brief) || '';
    els.castStory.value = (story && story.castNotes) || '';
    const hasStory = Boolean(story);
    els.frameStory.disabled = !hasStory;
    els.noteStory.disabled = !hasStory;
    els.briefStory.disabled = !hasStory;
    els.castStory.disabled = !hasStory;
    /* M16: the shelf picker — every shelf the house knows, plus loose. */
    if (els.storyShelf) {
      const shelves = await db.projects.list();
      els.storyShelf.textContent = '';
      const looseOpt = document.createElement('option');
      looseOpt.value = '';
      looseOpt.textContent = 'Loose — no shelf';
      els.storyShelf.appendChild(looseOpt);
      for (const shelf of shelves) {
        const opt = document.createElement('option');
        opt.value = shelf.id;
        opt.textContent = shelf.name;
        els.storyShelf.appendChild(opt);
      }
      const onShelf = story && story.projectId && shelves.some((p) => p.id === story.projectId);
      els.storyShelf.value = onShelf ? story.projectId : '';
      els.storyShelf.disabled = !hasStory;
    }
    document.getElementById('btn-save-frame-story').disabled = !hasStory;
    document.getElementById('btn-save-note-story').disabled = !hasStory;
    document.getElementById('btn-save-brief').disabled = !hasStory;
    document.getElementById('btn-save-cast').disabled = !hasStory;
  }

  document.getElementById('btn-save-frame').addEventListener('click', async () => {
    await db.settings.set('frameText', els.frameGlobal.value);
    /* M21: the purpose line keeps with the frame — one "Keep it" for both. */
    if (els.framePurpose) await db.settings.set('framePurpose', els.framePurpose.value);
    flash('frame-saved');
  });
  /* M21: the two frame toggles save the moment they're touched. */
  if (els.framePurposeOn) {
    els.framePurposeOn.addEventListener('change', async () => {
      await db.settings.set('framePurposeOn', els.framePurposeOn.checked);
    });
  }
  if (els.frameEcho) {
    els.frameEcho.addEventListener('change', async () => {
      await db.settings.set('frameEcho', els.frameEcho.checked);
    });
  }
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

  /* M16: moving a tale to another shelf (or letting it stand loose). The
   * sidebar re-gathers itself the moment the move lands. */
  if (els.storyShelf) {
    els.storyShelf.addEventListener('change', async () => {
      const story = await activeStory();
      if (!story) return;
      const shelfId = els.storyShelf.value || null;
      await db.stories.update(story.id, { projectId: shelfId });
      const shelfName = shelfId
        ? (els.storyShelf.selectedOptions[0] ? els.storyShelf.selectedOptions[0].textContent : 'its shelf')
        : null;
      toast(shelfName
        ? `“${story.title}” rests on ${shelfName} now.`
        : `“${story.title}” stands loose now.`);
      if (ctx.chat && typeof ctx.chat.refreshStories === 'function') {
        await ctx.chat.refreshStories(true);
      }
      if (ctx.onStoriesChanged) ctx.onStoriesChanged();
    });
  }

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

    /* M17: per-worker hands — each quiet helper may ride a connection of its own */
    const assignMap = (await db.settings.get('workerConnections')) || {};
    els.workerAssignments.textContent = '';
    for (const [key, words] of WORKER_ROWS) {
      const row = document.createElement('label');
      row.className = 'stack-label worker-assign-row';
      const sel = document.createElement('select');
      sel.dataset.worker = key;
      const dflt = document.createElement('option');
      dflt.value = '';
      dflt.textContent = 'The house choice';
      sel.appendChild(dflt);
      for (const conn of all) {
        const opt = document.createElement('option');
        opt.value = conn.id;
        opt.textContent = conn.label;
        sel.appendChild(opt);
      }
      sel.value = assignMap[key] && all.some((c) => c.id === assignMap[key]) ? assignMap[key] : '';
      sel.addEventListener('change', async () => {
        const next = (await db.settings.get('workerConnections')) || {};
        if (sel.value) next[key] = sel.value; else delete next[key];
        await db.settings.set('workerConnections', next);
        toast(sel.value ? `${words.split(' — ')[0]} has hands of its own now.` : `${words.split(' — ')[0]} follows the house again.`);
      });
      const labelText = document.createElement('span');
      labelText.textContent = words;
      row.appendChild(labelText);
      row.appendChild(sel);
      els.workerAssignments.appendChild(row);
    }

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
    /* M29: the world agent — on by default; its effort, off by default. */
    els.worldAgent.checked = (await db.settings.get('worldAgent')) !== false;
    const eff = await db.settings.get('worldEffort');
    els.worldEffort.value = ['off', 'low', 'medium', 'high'].includes(eff) ? eff : 'off';
  }

  els.worldAgent.addEventListener('change', async () => {
    await db.settings.set('worldAgent', els.worldAgent.checked);
  });
  els.worldEffort.addEventListener('change', async () => {
    await db.settings.set('worldEffort', els.worldEffort.value);
  });

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

  /* ---------- M30: the regex shelf ---------- */

  let regexEditing = null; /* the id being edited, or null for a new rule */

  function regexRow(rule, rules) {
    const li = document.createElement('li');
    li.className = 'connection-card';
    const top = document.createElement('div');
    top.className = 'connection-top';
    const name = document.createElement('span');
    name.className = 'connection-name';
    name.textContent = rule.name;
    const kind = document.createElement('span');
    kind.className = 'connection-kind';
    kind.textContent = (VOICE_WORDS[rule.on] || rule.on) + ' · ' + (rule.mode === 'page' ? 'the page itself' : rule.mode === 'display' ? 'the thread only' : 'the wire only');
    top.append(name, kind);
    li.appendChild(top);
    if (rule.note) {
      const note = document.createElement('p');
      note.className = 'quiet';
      note.textContent = rule.note;
      li.appendChild(note);
    }
    const find = document.createElement('p');
    find.className = 'quiet mono';
    find.textContent = '/' + rule.find + '/' + rule.flags + (rule.replace ? ' → ' + rule.replace : ' → (removed)');
    li.appendChild(find);

    const row = document.createElement('div');
    row.className = 'row';
    const onLabel = document.createElement('label');
    onLabel.className = 'radio-row';
    const on = document.createElement('input');
    on.type = 'checkbox';
    on.checked = rule.enabled !== false;
    on.addEventListener('change', async () => {
      const next = rules.map((r) => (r.id === rule.id ? { ...r, enabled: on.checked } : r));
      await saveRules(next);
      afterRegexChange();
    });
    onLabel.append(on, document.createTextNode(' On'));
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'text-btn';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => openRegexForm(rule));
    row.append(onLabel, edit);
    if (rule.builtin) {
      const orig = builtinOriginal(rule.id);
      if (orig && (orig.find !== rule.find || orig.flags !== rule.flags || orig.replace !== rule.replace || orig.on !== rule.on || orig.mode !== rule.mode)) {
        const restore = document.createElement('button');
        restore.type = 'button';
        restore.className = 'text-btn';
        restore.textContent = 'Restore the original';
        restore.addEventListener('click', async () => {
          await saveRules(rules.map((r) => (r.id === rule.id ? { ...orig, enabled: r.enabled } : r)));
          afterRegexChange();
        });
        row.appendChild(restore);
      }
    } else {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'text-btn';
      remove.textContent = 'Let it go';
      remove.addEventListener('click', async () => {
        await saveRules(rules.filter((r) => r.id !== rule.id));
        afterRegexChange();
      });
      row.appendChild(remove);
    }
    li.appendChild(row);
    return li;
  }

  async function renderRegex() {
    const rules = await loadRules();
    els.regexList.textContent = '';
    for (const rule of rules) els.regexList.appendChild(regexRow(rule, rules));
  }

  function openRegexForm(rule) {
    regexEditing = rule ? rule.id : null;
    els.regexName.value = rule ? rule.name : '';
    els.regexFind.value = rule ? rule.find : '';
    els.regexFlags.value = rule ? rule.flags : 'g';
    els.regexReplace.value = rule ? rule.replace : '';
    els.regexOn.value = rule ? rule.on : 'storyteller';
    els.regexMode.value = rule ? rule.mode : 'page';
    els.regexTryNote.hidden = true;
    els.regexForm.hidden = false;
    els.regexName.focus();
  }

  function regexFromForm() {
    return {
      id: regexEditing || undefined,
      name: els.regexName.value.trim() || 'A rule',
      find: els.regexFind.value,
      flags: els.regexFlags.value.trim() || 'g',
      replace: els.regexReplace.value,
      on: els.regexOn.value,
      mode: els.regexMode.value,
      enabled: true,
    };
  }

  async function afterRegexChange() {
    await renderRegex();
    /* display-mode rules change what the eye sees right now */
    if (ctx.chat && typeof ctx.chat.renderThread === 'function') ctx.chat.renderThread({ structural: true });
  }

  els.btnRegexAdd.addEventListener('click', () => openRegexForm(null));

  /* M31: bring your SillyTavern regex — a rule already on the shelf (same id)
   * is replaced by the file's version; the rest join. */
  els.regexFile.addEventListener('change', async () => {
    const file = els.regexFile.files && els.regexFile.files[0];
    els.regexFile.value = '';
    if (!file) return;
    try {
      const { rules: incoming, skipped } = importSillyTavernRegex(await file.text());
      if (!incoming.length) { say(els.regexImportNote, 'Nothing in that file could be read as a regex script.'); return; }
      const have = await loadRules();
      const ids = new Set(incoming.map((r) => r.id));
      const next = [...have.filter((r) => !ids.has(r.id)), ...incoming];
      await saveRules(next);
      say(els.regexImportNote, `${incoming.length} ${incoming.length === 1 ? 'rule' : 'rules'} brought home` + (skipped.length ? ` — ${skipped.length} skipped (not over the storyteller’s or the writer’s words).` : '.'));
      afterRegexChange();
    } catch (err) {
      say(els.regexImportNote, err.message || 'That file wouldn’t open.');
    }
  });
  els.btnRegexCancel.addEventListener('click', () => { els.regexForm.hidden = true; regexEditing = null; });

  els.regexForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const draft = regexFromForm();
    if (!draft.find) { say(els.regexTryNote, 'A rule needs something to find.'); return; }
    const probe = tryRule('', draft);
    if (!probe.ok) { say(els.regexTryNote, probe.why); return; }
    const rules = await loadRules();
    let next;
    if (regexEditing) {
      next = rules.map((r) => (r.id === regexEditing ? { ...r, ...draft, id: r.id, builtin: r.builtin, note: r.note, enabled: r.enabled } : r));
    } else {
      next = [...rules, draft];
    }
    await saveRules(next);
    els.regexForm.hidden = true;
    regexEditing = null;
    afterRegexChange();
  });

  els.btnRegexTry.addEventListener('click', async () => {
    const draft = regexFromForm();
    const story = await activeStory();
    const pages = story ? (await db.messages.list(story.id)).filter((m) => !m.hidden) : [];
    const want = draft.on === 'writer' ? 'user' : (draft.on === 'both' ? null : 'assistant');
    const latest = [...pages].reverse().find((m) => !want || m.role === want);
    if (!latest) { say(els.regexTryNote, 'No page of that voice to try it on yet.'); return; }
    const r = tryRule(pageText(latest), draft);
    if (!r.ok) { say(els.regexTryNote, r.why); return; }
    say(els.regexTryNote, r.matches
      ? `It matches ${r.matches} ${r.matches === 1 ? 'time' : 'times'} on the latest page — ${r.before - r.after} characters would go.`
      : 'It matches nothing on the latest page.');
  });

  /* Run the page-mode rules over every page already written in the open
   * story. Swipes are rewritten too, so the shown version stays in step. */
  els.btnRegexClean.addEventListener('click', async () => {
    const story = await activeStory();
    if (!story) { say(els.regexCleanNote, 'Open a story first.'); return; }
    if (!window.confirm(`Rewrite every page of “${story.title}” with the page-mode rules? There is no take-back.`)) return;
    const rules = await loadRules();
    const pages = await db.messages.list(story.id);
    let changed = 0;
    for (const m of pages) {
      if (m.hidden || (m.role !== 'assistant' && m.role !== 'user')) continue;
      const patch = {};
      const cleanText = applyRules(typeof m.text === 'string' ? m.text : '', rules, { on: m.role, mode: 'page' });
      if (cleanText !== m.text) patch.text = cleanText;
      if (Array.isArray(m.swipes) && m.swipes.length) {
        const swipes = m.swipes.map((sw) => (sw && typeof sw.text === 'string'
          ? { ...sw, text: applyRules(sw.text, rules, { on: m.role, mode: 'page' }) } : sw));
        if (swipes.some((sw, i) => sw && m.swipes[i] && sw.text !== m.swipes[i].text)) patch.swipes = swipes;
      }
      if (Object.keys(patch).length) {
        await db.messages.update(story.id, m.id, patch);
        changed += 1;
      }
    }
    say(els.regexCleanNote, changed ? `${changed} ${changed === 1 ? 'page' : 'pages'} rewritten.` : 'Nothing on these pages matched — they were clean already.');
    if (ctx.chat && typeof ctx.chat.renderThread === 'function') ctx.chat.renderThread({ structural: true });
    if (ctx.onStoriesChanged) ctx.onStoriesChanged();
  });

  async function renderLore() {
    const story = await activeStory();
    const entries = story ? await loadLore(story.id) : [];
    els.loreFile.disabled = !story;
    els.loreCount.hidden = !entries.length;
    els.btnLoreClear.hidden = !entries.length;
    /* M22-E7: the shelf walks back — the export shows whenever lore does. */
    els.btnLoreExport.hidden = !entries.length;
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

  /* M22-E7: lore walks both ways — the shelf folds back into a valid
   * SillyTavern World Info file and downloads. */
  els.btnLoreExport.addEventListener('click', async () => {
    const story = await activeStory();
    if (!story) return;
    const entries = await loadLore(story.id);
    if (!entries.length) {
      say(els.loreNote, 'The shelf is bare — nothing to carry over.');
      return;
    }
    const book = loreToWorldbook(entries, story.title);
    download(worldbookFilename(story.title), JSON.stringify(book, null, 2), 'application/json');
    toast(`The lore of “${story.title}” is folded as a SillyTavern worldbook — in your Downloads.`);
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

  /* M16: the version, visible — the header line carries the house's one
   * version word, set once when the view wakes. */
  if (els.versionLine) els.versionLine.textContent = 'the shelves · ' + VERSION;

  /* M18: the quick-nav — one chip per room that actually stands in the
   * column, named by the room's own heading. Built from the DOM, so a
   * section added to the page grows its own chip with no second edit. A
   * tap carries you there (smoothly, unless the device asks for stillness)
   * and the room's left edge glows ember a breath so the eye lands. */
  function buildQuickNav() {
    const nav = els.quicknav;
    if (!nav) return;
    nav.textContent = '';
    document.querySelectorAll('#view-settings .settings-section').forEach((section) => {
      const head = section.querySelector('h3');
      if (!section.id || !head) return;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'nav-chip';
      chip.textContent = head.textContent;
      chip.addEventListener('click', () => {
        const still = window.matchMedia
          && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        section.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
        /* Re-add on the next frame so a repeat tap flashes the room again. */
        section.classList.remove('ember-flash');
        requestAnimationFrame(() => section.classList.add('ember-flash'));
        setTimeout(() => section.classList.remove('ember-flash'), 1800);
      });
      nav.appendChild(chip);
    });
  }

  buildQuickNav();

  /* ---------- shown each time the view opens ---------- */

  async function onShow() {
    if (els.booksLive && ctx.booksStatus) els.booksLive.textContent = 'Where the tales live: ' + ctx.booksStatus.words + '.';
    await renderConnections();
    await loadPromptSlots();
    await renderRulebook();
    await renderWorkers();
    await renderMemory();
    await renderReferee();
    await renderCast();
    await renderLore();
    await renderRegex();
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
