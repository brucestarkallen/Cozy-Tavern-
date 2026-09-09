/* Cozy Tavern — ui/settings.js
 * Connections (add / change / test / let go, with presets), The Frame and
 * The Note at the End (global + per-story override), The Brief and Who's
 * here (per story), The rulebook (M2: pin, edit, fork, write your own),
 * Bring your engine (M5: read a SillyTavern preset, preview the shelves,
 * apply what's wanted), The workers (M3: who reads for the ledger, and
 * whether they do), appearance, backup.
 */

import { db } from '../store.js';
import { createProvider, presetById } from '../providers/index.js';
import { STARTER_FRAME, STARTER_NOTE } from '../assemble/stack.js';
import { listModules, saveModule, removeModule, WHEN_WORDS } from '../assemble/modules.js';
import { parsePreset, decompose, applyPlan, summaryWords } from '../import/sillytavern.js';

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
    btnModCancel: document.getElementById('btn-mod-cancel'),
    btnExport: document.getElementById('btn-export'),
    importFile: document.getElementById('import-file'),
    backupNote: document.getElementById('backup-note'),
    workerConn: document.getElementById('worker-connection'),
    workerExtraction: document.getElementById('worker-extraction'),
    workerStoryName: document.getElementById('worker-story-name'),
    engineFile: document.getElementById('engine-file'),
    enginePaste: document.getElementById('engine-paste'),
    btnEngineRead: document.getElementById('btn-engine-read'),
    engineNote: document.getElementById('engine-note'),
    enginePreview: document.getElementById('engine-preview'),
    engineGroups: document.getElementById('engine-groups'),
    btnEngineApply: document.getElementById('btn-engine-apply'),
    btnEngineDismiss: document.getElementById('btn-engine-dismiss'),
    engineSummary: document.getElementById('engine-summary'),
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
    els.briefStoryName.textContent = storyName;
    els.castStoryName.textContent = storyName;
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

  function openModuleForm(mod) {
    editingModuleId = mod ? mod.id : null;
    editingModulePinned = mod ? mod.pinned : true;
    els.modForm.hidden = false;
    els.modFormTitle.textContent = mod
      ? (mod.source === 'builtin' ? `Changing “${mod.name}” — your version stands in for the original` : `Changing “${mod.name}”`)
      : 'A rule of your own';
    els.modName.value = mod ? mod.name : '';
    els.modText.value = mod ? mod.text : '';
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
     * pinned on, so it joins the stack right away. */
    await saveModule({
      id: editingModuleId || undefined,
      name: els.modName.value,
      text,
      pinned: editingModulePinned,
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
  }

  els.workerConn.addEventListener('change', async () => {
    await db.settings.set('workerConnectionId', els.workerConn.value || null);
  });

  els.workerExtraction.addEventListener('change', async () => {
    const story = await activeStory();
    if (!story) return;
    await db.stories.update(story.id, { extraction: els.workerExtraction.checked });
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
    await renderRulebook();
    await renderWorkers();
    await loadTheme();
  }

  ctx.settings = { onShow };
}
