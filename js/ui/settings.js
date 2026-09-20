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

import { loadSensors, sensorLine } from '../agents/sensors.js'; /* M356 */
import { canonWikis, setCanonWikis } from '../canon/bridge.js'; /* M346 */
import { db } from '../store.js';
import { createProvider, presetById, normalizeBaseUrl, wouldNormalize } from '../providers/index.js';
import { presetIdFor, detectKey } from '../providers/room.js'; /* M285; M289 */
import { learnContext } from '../providers/detect.js'; /* M289 */
import { byName } from '../providers/order.js'; /* M301: every list of names the writer picks from, A to Z */
import { EFFORT_RANK, reasonStyle, reasoningIsDown, spokenAs, thinkingHint, prefillIsDown, budgetFor, prefillSilencesThinking, describePrefill, prefillFields, alwaysThinks, learnedFacts } from '../providers/effort.js';
import { download } from './download.js';
import { STARTER_FRAME, STARTER_NOTE, FRAME_PURPOSE } from '../assemble/stack.js';
import { cleanName, framePerson } from '../assemble/voice.js'; /* M327, M334 */
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
import { cleanWindow, cleanBatch, cleanSqueeze } from '../agents/memory.js';
import { WORKER_ROWS } from '../agents/assign.js';
/* M16: the house's version word stands in the header line. */
import { VERSION } from '../version.js';
import { loadRules, saveRules, tryRule, applyRules, builtinOriginal, importSillyTavernRegex, MODE_WORDS, VOICE_WORDS } from '../regex.js'; /* M30: the regex shelf; M31: bring your SillyTavern regex */
import { pageText } from '../assemble/stack.js';

let workerRowsGeneration = 0;

/* M352: THE ROOMS OF SETTINGS, AND WHERE A SECTION NOBODY LISTED GOES. Canon verification (M346) was in no room's list,
 * and the rule was "anything unlisted belongs to the LAST room" — the glossary. So its switch sat under “The glossary”
 * for two releases and the writer went looking for it. A section nobody listed now shows beside its NEIGHBOURS on the
 * page (the room of the section after it, else the one before it), where a writer looks for it; the last room is only
 * ever the fallback of a page that has no rooms at all. */
export const SETTINGS_ROOMS = [
  ['storyteller', 'Storyteller', ['section-connections', 'section-workers', 'section-thinking']],
  ['story', 'This story', ['section-brief', 'section-cast', 'section-frame', 'section-note', 'section-shelf']],
  ['craft', 'The craft', ['section-rulebook', 'section-engine', 'section-regex']],
  ['world', 'People & lore', ['section-people', 'section-lore', 'section-oldchats']],
  ['readers', 'The readers', ['section-memory', 'section-referee', 'section-canon', 'section-sensors']], /* M356 */
  ['house', 'The house', ['section-appearance', 'section-welcome', 'section-backup']],
  ['help', 'The glossary', ['section-help']],
];
export function roomForSection(id, orderedIds = []) {
  const listed = (x) => (SETTINGS_ROOMS.find(([, , ids]) => ids.includes(x)) || [null])[0];
  const own = listed(id);
  if (own) return own;
  const at = orderedIds.indexOf(id);
  if (at >= 0) {
    for (let i = at + 1; i < orderedIds.length; i += 1) { const r = listed(orderedIds[i]); if (r) return r; }
    for (let i = at - 1; i >= 0; i -= 1) { const r = listed(orderedIds[i]); if (r) return r; }
  }
  return SETTINGS_ROOMS[SETTINGS_ROOMS.length - 1][0];
}

export function initSettings(ctx) {
  const els = {
    connList: document.getElementById('connection-list'),
    connPick: document.getElementById('connection-pick'),
    connPickLabel: document.getElementById('connection-pick-label'),
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
    reasoningHint: document.getElementById('conn-reasoning-hint'),
    budgetHint: document.getElementById('conn-budget-hint'),
    prefillHint: document.getElementById('conn-prefill-hint'),
    prefillKeepThinking: document.getElementById('conn-prefill-keep-thinking'),
    prefillWorkers: document.getElementById('conn-prefill-workers'),
    prefillFlag: document.getElementById('conn-prefill-flag'),
    prefillReasoning: document.getElementById('conn-prefill-reasoning'),
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
    tellerName: document.getElementById('teller-name'),
    tellerPerson: document.getElementById('teller-person'),
    tellerPersonNote: document.getElementById('teller-person-note'),
    writerName: document.getElementById('writer-name'),
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
    btnPullBooks: document.getElementById('btn-pull-books'), /* M154 */
    btnResetSettings: document.getElementById('btn-reset-settings'),
    resetNote: document.getElementById('reset-note'),
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
    colourSpeech: document.getElementById('colour-speech'),
    showStarters: document.getElementById('show-starters'),
    memoryKeeper: document.getElementById('memory-keeper'),
    memoryWindow: document.getElementById('memory-window'),
    memoryBatch: document.getElementById('memory-batch'),
    memorySqueeze: document.getElementById('memory-squeeze'),
    memorySqueezeLines: document.getElementById('memory-squeeze-lines'),
    memoryBatchValue: document.getElementById('memory-batch-value'),
    memoryWindowValue: document.getElementById('memory-window-value'),
    continuityCheck: document.getElementById('continuity-check'),
    mendPages: document.getElementById('mend-pages'),
    worldAgent: document.getElementById('world-agent'),
    auditOn: document.getElementById('audit-on'),
    auditEvery: document.getElementById('audit-every'),
    auditEveryValue: document.getElementById('audit-every-value'),
    worldEffort: document.getElementById('world-effort'),
    refereeOn: document.getElementById('referee-on'),
    canonOn: document.getElementById('canon-on'), /* M346 */
    sensorsOn: document.getElementById('sensors-on'), /* M356 */
    sensorReadings: document.getElementById('sensors-readings'),
    canonWikis: document.getElementById('canon-wikis'),
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
    cutBeforeHeader: document.getElementById('cut-before-header'),
    thinkOnPage: document.getElementById('think-on-page'), /* M339 */
    olderModel: document.getElementById('older-model'), /* M343 */
    turnsShown: document.getElementById('turns-shown'), /* M136 */
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

  /* M301: ONE PICKER, ONE CARD. Every connection used to stand here as a whole
   * card with its five buttons, in the order they were made — a dozen
   * connections was a wall to scroll and nothing in it could be found. The
   * room is a drop-down now, A to Z, the one in use marked, and under it the
   * one card of the connection picked. `shownConnId` is only which card is
   * under the eye; it changes nothing about who tells the story. */
  let shownConnId = null;
  let connRenderGeneration = 0;
  async function renderConnections() {
    const mine = ++connRenderGeneration;
    const made = await db.connections.list();
    const all = byName(made);
    let activeId = await activeConnectionId();
    /* M301: THE ONE MARKED "IN USE" IS THE ONE IN USE. With the kept id naming
     * no connection (let go in another browser, a brought-back copy), every
     * resolver falls to the first one made — and this room marked none of
     * them, so the writer could not see who was telling the story. The room
     * keeps what the resolvers already do; nobody's storyteller changes. */
    if (made.length && !made.some((c) => c.id === activeId)) {
      activeId = made[0].id;
      await db.settings.set('activeConnectionId', activeId);
    }
    if (mine !== connRenderGeneration) return; /* a newer render has the room (M245's race) */
    els.connList.textContent = '';
    els.connEmpty.hidden = all.length > 0;
    const shown = all.find((c) => c.id === shownConnId) || all.find((c) => c.id === activeId) || all[0] || null;
    shownConnId = shown ? shown.id : null;
    if (els.connPick) {
      els.connPick.textContent = '';
      for (const conn of all) {
        const opt = document.createElement('option');
        opt.value = conn.id;
        /* the mark leads: a closed drop-down on a phone cuts a long line at its END,
         * which is where "in use" stood (seen in Chromium at 412px: "…model-7 · in") */
        opt.textContent = (conn.id === activeId ? '✓ ' : '') + conn.label + (conn.model ? ' — ' + conn.model : '');
        els.connPick.appendChild(opt);
      }
      if (shown) els.connPick.value = shown.id;
      els.connPick.hidden = all.length === 0;
      if (els.connPickLabel) {
        els.connPickLabel.hidden = all.length === 0;
        els.connPickLabel.textContent = all.length === 1 ? 'Your connection' : 'Your ' + all.length + ' connections, A to Z';
      }
    }

    for (const conn of (shown ? [shown] : [])) {
      const li = document.createElement('li');
      li.className = 'connection-card' + (conn.id === activeId ? ' active' : '');
      li.dataset.id = conn.id;

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
      /* M303: a house that cannot be told "off" (Kimi K3 always thinks) says
       * what Off is spoken as, too — the writer who chose Off was getting max
       * and the card said nothing; and a refusal of a spelling this
       * connection no longer speaks is not shown as standing. */
      const style = reasonStyle(conn);
      if (effort !== 'off' || alwaysThinks(conn)) { /* M349: any model that cannot be told off says what its Off is */
        const spoken = document.createElement('span');
        spoken.className = 'connection-kind';
        const said = reasoningIsDown(conn, style)
          ? 'unsent — the wire refused it once'
          : `spoken as ${spokenAs(conn, effort)}`;
        spoken.textContent = `thinking: ${effort} — ${said}`;
        top.appendChild(spoken);
      }
      /* M350: what the model itself taught the house — said where the writer looks */
      const taught = learnedFacts(conn);
      if (taught && (taught.efforts || taught.drop.length || taught.offThinks)) {
        const bits = [];
        if (taught.efforts) bits.push('takes ' + taught.efforts.join(', '));
        if (taught.drop.length) bits.push('does not take ' + taught.drop.map((f) => '“' + f + '”').join(', '));
        if (taught.offThinks) bits.push('Off does not stop it, so Off asks for its least');
        const learnedLine = document.createElement('span');
        learnedLine.className = 'connection-kind';
        learnedLine.textContent = 'learned from the model: ' + bits.join(' · ');
        top.appendChild(learnedLine);
      }
      /* M318: a prefill that will not ride says so; M328: and one that will says how */
      if (prefillSilencesThinking(conn)) {
        const pf = document.createElement('span');
        pf.className = 'connection-kind';
        pf.textContent = 'prefill: not sent while thinking is on (it would switch the thinking off)';
        top.appendChild(pf);
      } else if (describePrefill(conn)) {
        const pf = document.createElement('span');
        pf.className = 'connection-kind';
        pf.textContent = 'prefill: ' + describePrefill(conn).replace(/^Sent as /, '').replace(/^NOT sent — /, 'NOT sent — ');
        top.appendChild(pf);
      }
      /* M308: a thinking room that is set says whether it is sent */
      if (conn.reasoning && typeof conn.reasoning.budgetTokens === 'number' && conn.reasoning.budgetTokens > 0 && effort !== 'off') {
        const b = budgetFor(conn);
        const room = document.createElement('span');
        room.className = 'connection-kind';
        room.textContent = b.sent
          ? `thinking room: ${b.tokens.toLocaleString()} tokens — sent in place of the level`
          : `thinking room: ${conn.reasoning.budgetTokens.toLocaleString()} tokens — NOT sent: this address has levels only`;
        top.appendChild(room);
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

      /* M321: a card that is NOT the one telling the stories says so where the eye lands */
      let notInUse = null;
      if (conn.id !== activeId) {
        const inUse = all.find((c) => c.id === activeId);
        const warn = document.createElement('p');
        warn.className = 'quiet connection-not-in-use';
        warn.textContent = 'NOT in use — stories are being told with “' + ((inUse && inUse.label) || 'another connection') + '”. “Use this one” switches to this.';
        notInUse = warn; /* placed under the card's top line, below */
      }
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

      /* M97: the same provider and key, a different model — a copy, opened for
       * its edit, so the writer never types a key or a base URL twice */
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'text-btn';
      copyBtn.textContent = 'Copy';
      copyBtn.title = 'A second connection with this one’s provider, key, base URL and dials — change its model and name.';
      copyBtn.addEventListener('click', async () => {
        const { id, createdAt, ...rest } = conn;
        const copy = await db.connections.add({ ...rest, label: conn.label + ' (copy)' });
        shownConnId = copy.id; /* M301: the copy is the one under the eye */
        await renderConnections();
        const fresh = (await db.connections.list()).find((c) => c.id === copy.id) || copy;
        openForm(fresh);
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'text-btn';
      removeBtn.textContent = 'Let go';
      removeBtn.addEventListener('click', async () => {
        const sure = window.confirm(`Let go of “${conn.label}”? The key on this device goes with it.`);
        if (!sure) return;
        await db.connections.remove(conn.id);
        shownConnId = null; /* M301: back to the one in use */
        if ((await activeConnectionId()) === conn.id) {
          const rest = await db.connections.list();
          await db.settings.set('activeConnectionId', rest.length ? rest[0].id : null);
        }
        renderConnections();
      });

      row.append(useBtn, testBtn, editBtn, copyBtn, removeBtn);
      li.append(top, ...(notInUse ? [notInUse] : []), result, row);
      els.connList.appendChild(li);
    }

    /* keep the workers' picker in step with who's available */
    renderWorkers();
  }
  if (els.connPick) {
    /* M321: PICKING IT IS USING IT. M301 made this picker a viewer — "looking at a connection does not start using
     * it" — with the choosing left to a small "Use this one" on the card. The writer picked his model
     * here, as every picker he has ever used works, wrote on for a day with the OLD connection still
     * telling the story, and took the missing thinking for a fault of the house. The picker chooses.
     * (A card shown by the house itself — a fresh copy, a new connection — is not put in use by that;
     * it says so plainly and keeps its "Use this one".) */
    els.connPick.addEventListener('change', async () => {
      shownConnId = els.connPick.value || null;
      if (shownConnId) {
        const was = await db.settings.get('activeConnectionId');
        if (was !== shownConnId) {
          await db.settings.set('activeConnectionId', shownConnId);
          const picked = (await db.connections.list()).find((c) => c.id === shownConnId);
          toast('Stories are now told with “' + ((picked && picked.label) || 'this connection') + '”.');
        }
      }
      renderConnections();
    });
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
  /* M303: the standing word under the thinking dial, for a house that has one
   * (Kimi K3 cannot be told "off"; its temperature and top-p are fixed) — read
   * from what the form holds NOW, so it follows the model as it is typed */
  let offeredModels = []; /* M348 */
  let editingConn = null; /* M348 */
  /* M348: what the model in the form IS — from the provider's list just fetched, or from what the house already learned
   * for this model at this address — so the hint and the saved connection speak for Kimi K3 behind "syn:large:vision" */
  function knownFacts(draft) {
    const key = detectKey(draft);
    const row = offeredModels.find((m) => m && m.id === draft.model);
    if (row && (row.hf || row.efforts)) return { identFor: key, modelHf: row.hf || '', modelEfforts: row.efforts || null };
    if (editingConn && editingConn.identFor === key) return { identFor: key, modelHf: editingConn.modelHf || '', modelEfforts: editingConn.modelEfforts || null };
    return {};
  }

  function refreshReasoningHint() {
    if (!els.reasoningHint) return;
    const p = presetById(els.preset.value);
    /* M318: the prefill box says when it will NOT be used — a started reply makes these houses skip their thinking,
     * so with thinking on, the thinking is what is sent */
    if (els.prefillHint && els.prefill && els.connReasoning) {
      const draft = { type: p.type, preset: els.preset.value, baseUrl: els.baseUrl.value.trim() || p.baseUrl || '', model: els.model.value.trim() || p.model || '', prefill: els.prefill.value, reasoning: { effort: els.connReasoning.value } };
      /* M328: what WOULD be sent for the box as it stands — the turn, "Test it" and the card read the same plan */
      if (els.prefillFlag) { draft.prefillFlagField = els.prefillFlag.value; draft.prefillReasoningField = els.prefillReasoning.value; draft.prefillKeepThinking = els.prefillKeepThinking.checked; }
      const auto = prefillFields({ ...draft, prefillFlagField: '', prefillReasoningField: '' });
      if (els.prefillFlag) { els.prefillFlag.placeholder = auto.flag || 'none'; els.prefillReasoning.placeholder = auto.reasoning || 'none'; }
      const clash = prefillSilencesThinking(draft);
      const said = clash ? '' : describePrefill(draft);
      els.prefillHint.hidden = !clash && !said;
      if (!clash) els.prefillHint.textContent = said;
      if (clash) els.prefillHint.textContent = 'Not used while thinking is on: on this address a started reply makes the model skip its thinking entirely, so with thinking at “' + els.connReasoning.value + '” the thinking is sent and these words stay home. Set thinking to Off to use them.';
    }
    const hintDraft = { type: p.type, preset: els.preset.value, baseUrl: els.baseUrl.value.trim() || p.baseUrl || '', model: els.model.value.trim() || p.model || '' };
    const words = thinkingHint({ ...hintDraft, ...knownFacts(hintDraft) });
    els.reasoningHint.textContent = words;
    els.reasoningHint.hidden = !words;
    /* M308: the thinking room says, for THIS address and model, whether the number can be sent at all —
     * it was taken in silence on houses that have no such thing, and did nothing */
    if (els.budgetHint && els.connBudget) {
      const draft = { type: p.type, preset: els.preset.value, baseUrl: els.baseUrl.value.trim() || p.baseUrl || '', model: els.model.value.trim() || p.model || '', reasoning: { effort: 'high', budgetTokens: 2048 } };
      const b = budgetFor(draft);
      els.budgetHint.textContent = b.words;
      /* never disabled: a number already kept there must stay his to clear. (The box also asked the
       * browser for multiples of 512 from 512 — so 2,000 could not be saved at all; any whole number now.) */
      els.connBudget.placeholder = b.sent ? 'Leave empty to follow the level' : 'Not used by this address';
    }
  }

  function refreshAddressHint() {
    refreshReasoningHint();
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
    /* M22: the form stores the preset it started from — trust it first.
     * M285: one reading of it for the whole house (providers/room.js). */
    return presetIdFor(conn);
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
    rememberPlace();
    els.form.hidden = false;
    els.formTitle.textContent = conn ? `Changing “${conn.label}”` : 'A new connection';
    hideModelPicker();
    editingConn = conn || null; /* M348 */
    offeredModels = [];
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
      /* M289: left empty, the room the provider reports for this model is what the house plans in — say it */
      if (typeof conn.contextSize !== 'number' && Number(conn.detectedContext) > 0 && conn.detectedFor === detectKey(conn)) {
        els.connContextSize.placeholder = String(conn.detectedContext) + ' (the provider says)';
      }
      /* M22-C/D: the search switch, its ceiling, and the prefill. */
      els.search.checked = conn.searchOn === true;
      els.searchCount.value = typeof conn.searchMaxUses === 'number' ? String(conn.searchMaxUses) : '';
      els.prefill.value = typeof conn.prefill === 'string' ? conn.prefill : '';
      if (els.prefillKeepThinking) els.prefillKeepThinking.checked = conn.prefillKeepThinking !== false;
      if (els.prefillWorkers) els.prefillWorkers.checked = conn.prefillForWorkers === true;
      if (els.prefillFlag) els.prefillFlag.value = typeof conn.prefillFlagField === 'string' ? conn.prefillFlagField : '';
      if (els.prefillReasoning) els.prefillReasoning.value = typeof conn.prefillReasoningField === 'string' ? conn.prefillReasoningField : '';
      /* The refusal memories speak plainly while they stand. */
      if (els.downNote) {
        const bits = [];
        if (reasoningIsDown(conn, reasonStyle(conn))) bits.push('it once refused the thinking settings, so they ride unsent');
        if (prefillIsDown(conn)) bits.push('it once refused a started reply, so the prefill rides unsent'); /* M307: only a refusal from an address that can take one */
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
      if (els.prefillKeepThinking) els.prefillKeepThinking.checked = true;
      if (els.prefillWorkers) els.prefillWorkers.checked = false;
      if (els.prefillFlag) els.prefillFlag.value = '';
      if (els.prefillReasoning) els.prefillReasoning.value = '';
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
      offeredModels = Array.isArray(models) ? models : []; /* M348: what each model is, as its provider says */
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
      for (const m of byName(models, (x) => (x && (x.label || x.id)))) { /* M301: hundreds on offer, A to Z */
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
    refreshReasoningHint();
  });
  els.model.addEventListener('input', refreshReasoningHint);
  if (els.prefill) els.prefill.addEventListener('input', refreshReasoningHint); /* M318 */
  for (const el of [els.prefillFlag, els.prefillReasoning]) if (el) el.addEventListener('input', refreshReasoningHint); /* M328 */
  if (els.prefillKeepThinking) els.prefillKeepThinking.addEventListener('change', refreshReasoningHint);
  if (els.connReasoning) els.connReasoning.addEventListener('change', refreshReasoningHint);

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
      /* M328: the probe carries what the turn would — the thinking dial, the two field names, the keep-open tick */
      reasoning: EFFORT_RANK.includes(els.connReasoning.value) && els.connReasoning.value !== 'off' ? { effort: els.connReasoning.value } : undefined,
      prefillKeepThinking: els.prefillKeepThinking ? els.prefillKeepThinking.checked : true,
      prefillFlagField: els.prefillFlag ? els.prefillFlag.value : '',
      prefillReasoningField: els.prefillReasoning ? els.prefillReasoning.value : '',
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

  /* M234: CLOSING THE CONNECTION FORM THREW THE WRITER DOWN THE PAGE. The
   * form is hidden inline, so a tall panel collapses to nothing and the page
   * gets shorter — and the browser clamps the scroll to the new height,
   * landing wherever that happens to be. It is not a new position the writer
   * chose; it is the old one having nowhere to be. The connection being
   * edited is brought back under the eye instead. */
  let cameFrom = 0;
  const scroller = () => els.form.closest('.settings-panels, .drawer-panels, .sheet-body') || document.scrollingElement || document.documentElement;
  const rememberPlace = () => { const sc = scroller(); cameFrom = sc ? sc.scrollTop : 0; };
  const returnToPlace = () => {
    const sc = scroller();
    if (!sc) return;
    requestAnimationFrame(() => {
      const row = editingId ? document.querySelector('#connection-list [data-id="' + CSS.escape(editingId) + '"]') : null;
      if (row && typeof row.scrollIntoView === 'function') { row.scrollIntoView({ block: 'nearest' }); return; }
      sc.scrollTop = Math.min(cameFrom, Math.max(0, sc.scrollHeight - sc.clientHeight));
    });
  };

  els.btnCancel.addEventListener('click', () => {
    const was = editingId;
    els.form.hidden = true;
    returnToPlace();
    editingId = was;
    returnToPlace();
    editingId = null;
  });

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = presetById(els.preset.value);
    /* A dial left empty stays unset — the providers then send nothing for
     * it and the storyteller's own defaults rule (M8). */
    /* M234: A COMMA IS A DECIMAL POINT IN MOST OF THE WORLD. These are
     * <input type="number">, so a browser handed "0,3" gives back either an
     * EMPTY string or something parseFloat reads as 0 — and the writer's
     * temperature was silently thrown away or silently set to zero, with
     * "Test connection" passing merrily because nothing was being sent at
     * all. He typed a perfectly sensible number and had no way to know it
     * had not been kept. A comma is read as the point it is. */
    const numOrUnset = (input) => {
      const raw = String((input && input.value) || '').trim().replace(',', '.');
      const n = parseFloat(raw);
      return raw !== '' && Number.isFinite(n) ? n : undefined;
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
    /* M328: the prefill's own dials — kept only when they differ from how a connection starts out */
    fields.prefillKeepThinking = els.prefillKeepThinking && !els.prefillKeepThinking.checked ? false : undefined;
    fields.prefillForWorkers = els.prefillWorkers && els.prefillWorkers.checked ? true : undefined;
    fields.prefillFlagField = els.prefillFlag && els.prefillFlag.value.trim() ? els.prefillFlag.value.trim() : undefined;
    fields.prefillReasoningField = els.prefillReasoning && els.prefillReasoning.value.trim() ? els.prefillReasoning.value.trim() : undefined;
    /* M8.5/M22-A: the thinking voice — the full ladder, kept only when on.
     * What the wire can actually say is resolved per house at send time
     * (effort.js). */
    /* M348: a model picked from the provider's own list is kept with what it is */
    Object.assign(fields, { identFor: undefined, modelHf: undefined, modelEfforts: undefined }, knownFacts({ model: fields.model, baseUrl: fields.baseUrl }));
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
      for (const key of ['temperature', 'topP', 'maxTokens', 'contextSize', 'reasoning', 'searchOn', 'searchMaxUses', 'prefill', 'prefillKeepThinking', 'prefillForWorkers', 'prefillFlagField', 'prefillReasoningField']) { /* M328: an unticked box or an emptied field lets its dial go too */
        if (patch[key] === undefined) patch[key] = null;
      }
      /* M22-A/D: the refusal memories stand until the model field
       * changes — a new model (or a new address) tries again. */
      const stored = await db.connections.list().then((all) => all.find((c) => c.id === editingId));
      if (stored && (stored.model !== fields.model || stored.baseUrl !== fields.baseUrl)) {
        patch.reasoningDownAt = null;
        patch.reasoningDownShape = null;
        patch.prefillDownShape = null;
        patch.prefillDownAt = null;
      }
      await db.connections.update(editingId, patch);
      /* M289: an empty room is asked of the provider now, in the background */
      db.connections.list().then((all) => { const c = all.find((x) => x.id === editingId); if (c) learnContext(c).catch(() => {}); }).catch(() => {});
    } else {
      const saved = await db.connections.add(fields);
      shownConnId = saved.id; /* M301: the new one is the one under the eye */
      learnContext(saved).catch(() => {}); /* M289: its room, asked of the provider */
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

  /* M327: who tells, and who listens — kept the moment a box is left (no button to forget) */
  const keepName = async (key, el) => {
    const v = cleanName(el.value);
    el.value = v;
    if (v) await db.settings.set(key, v); else await db.settings.delete(key);
  };
  if (els.tellerName) els.tellerName.addEventListener('change', () => keepName('tellerName', els.tellerName));
  if (els.writerName) els.writerName.addEventListener('change', () => keepName('writerName', els.writerName));
  /* M334: first person or second. "Follow my frame" reads it off the frame's own opening words, and says what it read. */
  const sayPerson = async () => {
    if (!els.tellerPersonNote || !els.tellerPerson) return;
    const story = await activeStory();
    const frame = (story && typeof story.frameOverride === 'string' && story.frameOverride.trim()) ? story.frameOverride : (els.frameGlobal ? els.frameGlobal.value : '');
    const read = framePerson(frame) === 'first' ? 'I' : 'You';
    const chosen = els.tellerPerson.value;
    els.tellerPersonNote.textContent = (chosen === 'follow' ? 'Your frame reads as “' + read + '” — so the tavern’s own rules are written that way too. ' : 'Set by hand (your frame reads as “' + read + '”). ')
      + (((chosen === 'follow' ? (read === 'I' ? 'first' : 'second') : chosen) === 'first') ? 'The craft and the rules become the teller’s own notes to itself: “I maintain… I render it… my craft.”' : 'The craft and the rules speak to the teller: “You maintain… you render it… your craft.”')
      + ' What YOU say to the teller — the briefing, your note — always says “you”, the way you would to a friend.';
  };
  if (els.tellerPerson) els.tellerPerson.addEventListener('change', async () => {
    const v = els.tellerPerson.value;
    if (v === 'first' || v === 'second') await db.settings.set('tellerPerson', v); else await db.settings.delete('tellerPerson');
    sayPerson();
  });
  if (els.frameGlobal) els.frameGlobal.addEventListener('input', () => sayPerson());

  async function loadPromptSlots() {
    if (els.tellerName) els.tellerName.value = cleanName(await db.settings.get('tellerName'));
    if (els.writerName) els.writerName.value = cleanName(await db.settings.get('writerName'));
    if (els.tellerPerson) { const p = await db.settings.get('tellerPerson'); els.tellerPerson.value = p === 'first' || p === 'second' ? p : 'follow'; }
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
    sayPerson(); /* M334 */
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
  /* M99: a changed brief or cast is held against the ledger at once — the
   * auditor runs (the brief wins: a changed hair colour relocks the canon,
   * mends the recent pages, corrects the record), so the writer never has to
   * remember a button after rewriting the brief. */
  async function briefChanged(story, before, after) {
    if (String(before || '').trim() === String(after || '').trim()) return;
    if (ctx.chat && typeof ctx.chat.auditNow === 'function') {
      const ran = await ctx.chat.auditNow();
      if (ran) toast('The brief changed — the auditor is holding the ledger to it.');
    }
  }
  document.getElementById('btn-save-brief').addEventListener('click', async () => {
    const story = await activeStory();
    if (!story) return;
    const before = story.brief || '';
    await db.stories.update(story.id, { brief: els.briefStory.value });
    flash('brief-saved');
    await briefChanged(story, before, els.briefStory.value);
  });
  document.getElementById('btn-save-cast').addEventListener('click', async () => {
    const story = await activeStory();
    if (!story) return;
    const before = story.castNotes || '';
    await db.stories.update(story.id, { castNotes: els.castStory.value });
    flash('cast-saved');
    await briefChanged(story, before, els.castStory.value);
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
        /* M175: the whole rule, not the four fields the toggle happens to
         * know — a pin must never be able to change what a rule IS. */
        await saveModule({ id: mod.id, name: mod.name, text: mod.text, pinned: pin.checked, whenKey: mod.whenKey, note: mod.note });
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
    const all = byName(await db.connections.list()); /* M301: every picker reads A to Z */
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
    /* M245: AN ASYNC RENDER RACE PUT THE SAME DIAL ON THE PAGE TWICE. The list
     * is cleared once, then EVERY row awaits (the assignment map, the
     * housekeeper's own thinking setting). Two renders overlapping — and this
     * panel re-renders on a good many things — both clear, both wait, and
     * both append: the writer saw "How much the housekeeper thinks before it
     * answers" listed twice, with two selects that set the same setting. A
     * render that has been overtaken stops appending. */
    const assignMap = (await db.settings.get('workerConnections')) || {};
    const mine = ++workerRowsGeneration;
    els.workerAssignments.textContent = '';
    for (const [key, words] of WORKER_ROWS) {
      if (mine !== workerRowsGeneration) return;
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
      if (mine !== workerRowsGeneration) return;
      els.workerAssignments.appendChild(row);
      /* M76: the housekeeper thinks — its own effort, never the connection's "off" */
      if (key === 'housekeeper') {
        const think = document.createElement('label');
        think.className = 'stack-label worker-assign-row';
        const tsel = document.createElement('select');
        tsel.id = 'hk-reasoning';
        for (const [v, w] of [['', 'as the connection says (the house’s choice)'], ['off', 'no thinking, whatever the connection says'], ['low', 'a little thinking'], ['medium', 'some thinking'], ['high', 'thinks it through'], ['max', 'thinks as long as it likes']]) {
          const opt = document.createElement('option'); opt.value = v; opt.textContent = w; tsel.appendChild(opt);
        }
        tsel.value = (await db.settings.get('hkReasoning')) || '';
        tsel.addEventListener('change', async () => { await db.settings.set('hkReasoning', tsel.value); toast(tsel.value === '' ? 'The housekeeper thinks as its connection says.' : tsel.value === 'off' ? 'The housekeeper answers without thinking first.' : 'The housekeeper thinks before it answers, whatever its connection says.'); });
        const tw = document.createElement('span');
        tw.textContent = 'How much the housekeeper thinks before it answers — its connection’s own switch unless you set it here; the reasoning shows under each reply';
        think.appendChild(tw);
        think.appendChild(tsel);
        if (mine !== workerRowsGeneration) return;
        els.workerAssignments.appendChild(think);
      }
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
    /* M35: the second reader is on by default, and may mend */
    els.continuityCheck.checked = (await db.settings.get('continuityCheck')) !== false;
    els.mendPages.checked = (await db.settings.get('mendPages')) !== false;
    /* M34: the record's pace */
    const batch = cleanBatch(await db.settings.get('memoryBatch'));
    els.memoryBatch.value = String(batch);
    els.memoryBatchValue.textContent = String(batch);
    /* M264: when the record's oldest lines are squeezed */
    const squeeze = cleanSqueeze(await db.settings.get('memorySqueeze'));
    els.memorySqueeze.value = squeeze.mode;
    els.memorySqueezeLines.value = String(squeeze.mode === 'lines' ? squeeze.lines : 100);
    els.memorySqueezeLines.hidden = squeeze.mode !== 'lines';
    /* M29: the world agent — on by default; its effort, off by default. */
    els.worldAgent.checked = (await db.settings.get('worldAgent')) !== false;
    /* M41: the auditor */
    els.auditOn.checked = (await db.settings.get('auditOn')) !== false;
    const ae = Math.round(Number(await db.settings.get('auditEvery')));
    const everyV = Number.isFinite(ae) && ae >= 1 ? Math.min(20, ae) : 1;
    els.auditEvery.value = String(everyV);
    els.auditEveryValue.textContent = String(everyV);
    const eff = await db.settings.get('worldEffort');
    els.worldEffort.value = ['off', 'low', 'medium', 'high'].includes(eff) ? eff : 'off';
  }

  els.auditOn.addEventListener('change', async () => {
    await db.settings.set('auditOn', els.auditOn.checked);
  });
  els.auditEvery.addEventListener('input', () => { els.auditEveryValue.textContent = els.auditEvery.value; });
  els.auditEvery.addEventListener('change', async () => {
    await db.settings.set('auditEvery', Math.round(Number(els.auditEvery.value)) || 1);
  });

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

  els.memoryBatch.addEventListener('input', () => {
    els.memoryBatchValue.textContent = els.memoryBatch.value;
  });
  els.memoryBatch.addEventListener('change', async () => {
    await db.settings.set('memoryBatch', cleanBatch(els.memoryBatch.value));
  });
  /* M264: one control, one meaning — the choice, and its number when it has one */
  const saveSqueeze = async () => {
    const mode = els.memorySqueeze.value;
    els.memorySqueezeLines.hidden = mode !== 'lines';
    await db.settings.set('memorySqueeze', mode === 'lines' ? cleanSqueeze(els.memorySqueezeLines.value).lines : mode);
  };
  els.memorySqueeze.addEventListener('change', saveSqueeze);
  els.memorySqueezeLines.addEventListener('change', saveSqueeze);

  els.continuityCheck.addEventListener('change', async () => {
    await db.settings.set('continuityCheck', els.continuityCheck.checked);
  });
  els.mendPages.addEventListener('change', async () => {
    await db.settings.set('mendPages', els.mendPages.checked);
  });

  /* ---------- the referee's dials (M11) ----------
   * M15 audit: onShow() called renderReferee() but no such function lived
   * here — the throw cut off every section below the memory room (cast,
   * lore, the thinking say, the theme) and the four dials themselves had
   * no listeners at all. Now they render and they write. */
  async function renderReferee() {
    els.refereeOn.checked = (await db.settings.get('refereeOn')) !== false;
    /* M346: canon verification — its own switch (off as it ships) and, only to be sure, the series' wiki */
    if (els.canonOn) els.canonOn.checked = (await db.settings.get('canonOn')) === true;
    /* M356: the sensors — off as they ship, and what they have read so far, for the story in hand */
    if (els.sensorsOn) els.sensorsOn.checked = (await db.settings.get('sensorsOn')) === true;
    if (els.sensorReadings) {
      const story = await activeStory();
      const kept = story ? await loadSensors(story.id) : null;
      const line = kept ? sensorLine(kept) : '';
      els.sensorReadings.textContent = line ? 'This story so far — ' + line : 'No readings yet.';
    }
    if (els.canonWikis) els.canonWikis.value = await canonWikis();
    els.refereeSensitivity.value = (await db.settings.get('refereeSensitivity')) || 'normal';
    els.refereePreset.value = (await db.settings.get('refereePreset')) || 'realistic';
    els.refereeFightStyle.value = (await db.settings.get('refereeFightStyle')) || 'tracked';
  }

  if (els.canonOn) els.canonOn.addEventListener('change', async () => { await db.settings.set('canonOn', els.canonOn.checked); });
  if (els.sensorsOn) els.sensorsOn.addEventListener('change', async () => { await db.settings.set('sensorsOn', els.sensorsOn.checked); }); /* M356 */
  if (els.canonWikis) els.canonWikis.addEventListener('change', async () => { await setCanonWikis(els.canonWikis.value); });
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
      const next = rules.map((r) => (r.id === rule.id ? { ...r, enabled: on.checked, touched: true } : r));
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
          await saveRules(rules.map((r) => (r.id === rule.id ? { ...orig, enabled: r.enabled, touched: true } : r)));
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
    /* M34: the 🎨 pack folds under one heading so the shelf stays short */
    const pack = rules.filter((r) => r.pack === 'styles');
    const rest = rules.filter((r) => r.pack !== 'styles');
    for (const rule of rest) els.regexList.appendChild(regexRow(rule, rules));
    if (pack.length) {
      const li = document.createElement('li');
      li.className = 'connection-card';
      const fold = document.createElement('details');
      const sum = document.createElement('summary');
      sum.className = 'connection-name';
      const on = pack.filter((r) => r.enabled !== false).length;
      sum.textContent = `The 🎨 styles — ${on} of ${pack.length} on: the header card, the folded trackers, thoughts, the cut-away`;
      fold.appendChild(sum);
      const inner = document.createElement('ul');
      inner.className = 'connection-list';
      for (const rule of pack) inner.appendChild(regexRow(rule, rules));
      fold.appendChild(inner);
      li.appendChild(fold);
      els.regexList.appendChild(li);
    }
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
      next = rules.map((r) => (r.id === regexEditing ? { ...r, ...draft, id: r.id, builtin: r.builtin, note: r.note, enabled: r.enabled, touched: true } : r));
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
    if (els.cutBeforeHeader) els.cutBeforeHeader.checked = (await db.settings.get('cutBeforeHeader')) !== false; /* M322: on unless the writer says otherwise */
    if (els.thinkOnPage) els.thinkOnPage.checked = (await db.settings.get('thinkOnPage')) === true; /* M339: off unless he turns it on */
    if (els.olderModel) els.olderModel.checked = (await db.settings.get('olderModel')) === true; /* M343: off unless he turns it on */
    if (els.turnsShown) { const ts = Number(await db.settings.get('turnsShown')); els.turnsShown.value = String(Number.isFinite(ts) && ts > 0 ? ts : 30); }
  }

  els.thinkingStory.addEventListener('change', async () => {
    const story = await activeStory();
    if (!story) return;
    await db.stories.update(story.id, { reasoningEffort: els.thinkingStory.value });
  });

  if (els.cutBeforeHeader) els.cutBeforeHeader.addEventListener('change', async () => {
    await db.settings.set('cutBeforeHeader', els.cutBeforeHeader.checked);
  });
  /* M339: the switch — off unless he turns it on; unset again when he turns it off */
  if (els.thinkOnPage) els.thinkOnPage.addEventListener('change', async () => { if (els.thinkOnPage.checked) await db.settings.set('thinkOnPage', true); else await db.settings.delete('thinkOnPage'); });
  /* M343: the older-model switch — a whole line of its own (M339's lesson), and the thread is told at once so the room line is true */
  if (els.olderModel) els.olderModel.addEventListener('change', async () => { if (els.olderModel.checked) await db.settings.set('olderModel', true); else await db.settings.delete('olderModel'); if (ctx.chat && typeof ctx.chat.noteOlderModel === 'function') await ctx.chat.noteOlderModel(); });

  els.showThinking.addEventListener('change', async () => {
    await db.settings.set('showThinking', els.showThinking.checked);
    if (ctx.chat) await ctx.chat.renderThread();
  });
  if (els.turnsShown) els.turnsShown.addEventListener('change', async () => {
    const v = Math.max(5, Math.min(500, Math.round(Number(els.turnsShown.value)) || 30));
    els.turnsShown.value = String(v);
    await db.settings.set('turnsShown', v);
    if (ctx.chat) await ctx.chat.renderThread({ structural: true });
  });

  /* ---------- appearance ---------- */

  async function loadTheme() {
    const mode = (await db.settings.get('theme')) || 'dark';
    const radio = document.querySelector(`input[name="theme"][value="${mode}"]`);
    if (radio) radio.checked = true;
    /* M32: the speech colour switch, on by default */
    const on = (await db.settings.get('colourSpeech')) !== false;
    els.colourSpeech.checked = on;
    els.showStarters.checked = (await db.settings.get('showStarters')) === true;
    document.body.classList.toggle('plain-speech', !on);
  }

  els.showStarters.addEventListener('change', async () => {
    await db.settings.set('showStarters', els.showStarters.checked);
    if (ctx.chat && typeof ctx.chat.renderPromptChips === 'function') ctx.chat.renderPromptChips();
  });

  els.colourSpeech.addEventListener('change', async () => {
    await db.settings.set('colourSpeech', els.colourSpeech.checked);
    document.body.classList.toggle('plain-speech', !els.colourSpeech.checked);
  });

  document.querySelectorAll('input[name="theme"]').forEach((radio) => {
    radio.addEventListener('change', async () => {
      if (!radio.checked) return;
      await db.settings.set('theme', radio.value);
      ctx.setTheme(radio.value);
    });
  });

  /* ---------- M42: reset to the house's defaults ----------
   * The recommended settings are the ABSENCE of a stored value — every
   * room reads its default when the key is missing — so a reset is a
   * delete of the app-wide preference keys. Connections, worker
   * assignments, stories and every per-story store stay untouched; the
   * regex shelf's built-ins go back to their shipped words and switches
   * while the writer's own rules stay. */
  const RESET_KEYS = [
    'theme', 'colourSpeech', 'showStarters', 'masthead', 'showThinking',
    'memoryKeeper', 'memoryWindow', 'memoryBatch', 'memorySqueeze', 'continuityCheck', 'mendPages',
    'worldAgent', 'worldEffort', 'auditOn', 'auditEvery', 'hkContextPages', 'hkAutoApply', 'hkReasoning', 'turnsShown',
    'refereeOn', 'refereeSensitivity', 'refereePreset', 'refereeFightStyle', 'canonOn', 'sensorsOn',
    'frameText', 'noteText', 'framePurposeOn', 'framePurpose', 'frameEcho',
    'shelfCollapsed',
  ];
  async function resetSettings() {
    for (const key of RESET_KEYS) {
      try { await db.settings.delete(key); } catch (err) { /* a key that isn't there is already at its default */ }
    }
    /* the regex shelf: built-ins back to shipped, the writer's own rules kept */
    const rules = await loadRules();
    const kept = rules.filter((r) => !r.builtin);
    await saveRules(kept);
    await loadRules(); /* re-seeds every builtin untouched */
    /* M89: the rulebook, by the same law — a fork of a builtin (the craft, the
     * intimate rule, the window rule) is lifted so the SHIPPED text rides again
     * (a fork from an older coat would otherwise shadow every law since); pins
     * on builtins are cleared; the writer's own rules stay, pins and all. */
    try {
      const mods = await listModules();
      for (const m of mods) {
        if (!m.custom && (m.overridden || m.pinned)) await removeModule(m.id);
      }
    } catch (err) { /* a rulebook that will not read is left as it is */ }
    ctx.setTheme('dark');
    document.body.classList.remove('plain-speech');
    await onShow({ all: true });
    if (ctx.chat && typeof ctx.chat.renderPromptChips === 'function') ctx.chat.renderPromptChips();
    if (ctx.chat && typeof ctx.chat.renderThread === 'function') ctx.chat.renderThread({ structural: true });
  }

  els.btnResetSettings.addEventListener('click', async () => {
    if (!window.confirm('Reset every setting to the house’s defaults? Connections, stories and everything in them stay; your own rules stay; the shipped craft and rules come back as shipped.')) return;
    await resetSettings();
    say(els.resetNote, 'Every setting is back at the house’s recommended default; the shipped craft and rules ride as shipped. Connections, worker assignments, stories and your own rules were not touched.');
  });

  /* ---------- backup ---------- */

  if (els.btnPullBooks) els.btnPullBooks.addEventListener('click', async () => {
    const st = ctx.booksStatus;
    if (!st || typeof st.pullNow !== 'function') { toast('No server here — the books cannot be read on this device. Start serve.py and refresh.'); return; }
    toast('Reading the device’s books…');
    const r = await st.pullNow();
    if (!(r && r.ok)) toast('The books could not be read: ' + ((r && r.why) || 'the server did not answer') + '.');
  });
  els.btnExport.addEventListener('click', async () => {
    /* M310: THE DEVICE MAKES THE COPY, FROM ITS OWN FILES. This button folded the WHOLE store into one
     * JSON string inside the browser — every tale, every page, every checkpoint. On a library of
     * thousands of pages a phone cannot hold that string: the button did nothing, said nothing, and
     * the writer could not back up. With serve.py there, the server zips its books folder (no browser
     * memory at all) and hands the zip over as an ordinary download; the copy also stays on the
     * device, in the backups folder. Only with no server does the browser fold its own — and a
     * failure is SAID, never swallowed. */
    els.backupNote.hidden = false;
    els.backupNote.textContent = 'Making a copy…';
    try {
      const res = await fetch(new URL('api/backup/now', document.baseURI), { cache: 'no-store' });
      if (res.ok) {
        const r = await res.json();
        if (r && r.ok) {
          const a = document.createElement('a');
          a.href = new URL('api/backup/file', document.baseURI).href;
          a.download = r.name || 'cozytavern-backup.zip';
          document.body.appendChild(a);
          a.click();
          a.remove();
          const mb = (Number(r.bytes || 0) / 1048576).toFixed(1);
          els.backupNote.textContent = `A copy of every book on this device (${r.files} files, ${mb} MB) is in your downloads as ${r.name} — and kept on the device in ${r.folder}. The device also makes one by itself every day it is started, and keeps the newest ${Array.isArray(r.copies) ? Math.max(r.copies.length, 1) : 1}.`;
          toast('A copy of every book is in your downloads.');
          return;
        }
        if (r && r.why) { els.backupNote.textContent = 'The device could not make a copy: ' + r.why + '.'; return; }
      }
    } catch (err) { /* no server here — the browser folds its own, below */ }
    let json = '';
    try {
      json = await db.exportAll();
    } catch (err) {
      els.backupNote.textContent = 'This browser could not fold its stories into one file (' + ((err && err.message) || 'it ran out of room') + '). Start the tavern with serve.py — the device then makes the copy from its own files, whatever the size.';
      return;
    }
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
      await onShow({ all: true });
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
    /* M105: the rooms of settings, one at a time — a tab strip instead of one long scroll. Every section keeps its id;
     * a room that is not open is hidden, not moved. The open room is remembered. The list and the rule that places a
     * section in a room are module-level (M352), so they can be held to a law. */
    const ROOMS = SETTINGS_ROOMS;
    const sections = [...document.querySelectorAll('#view-settings .settings-section')];
    const roomOf = (id) => roomForSection(id, sections.map((x) => x.id));
    const show = async (room, remember = true) => {
      for (const section of sections) section.hidden = roomOf(section.id) !== room;
      for (const chip of nav.querySelectorAll('.nav-chip')) chip.classList.toggle('current', chip.dataset.room === room);
      if (remember) await db.settings.set('settingsRoom', room).catch(() => {});
    };
    for (const [room, words] of ROOMS) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'nav-chip';
      chip.dataset.room = room;
      chip.textContent = words;
      chip.addEventListener('click', () => { show(room); document.querySelector('#view-settings').scrollTo({ top: 0 }); });
      nav.appendChild(chip);
    }
    db.settings.get('settingsRoom').then((room) => show(ROOMS.some(([r]) => r === room) ? room : 'storyteller', false)).catch(() => show('storyteller', false));
    /* a jump by id (the drawer's "Settings → …" links) opens the right room */
    nav.openRoomFor = (sectionId) => show(roomOf(sectionId));
  }

  buildQuickNav();

  /* ---------- shown each time the view opens ---------- */

  /* M142: THE OPEN ROOM FIRST. Settings rendered every section on every
   * open — the rulebook's long textareas, the regex shelf, the cast, the
   * lore, the old chats — before the view could answer a tap; a second tap
   * waited on the first. Now the sections of the OPEN room render at once and
   * the rest follow on idle ticks, one section per tick, so the view is
   * interactive the moment it appears. A room the writer switches to renders
   * whatever is still pending for it first. */
  const ROOM_RENDERS = {
    storyteller: () => [renderConnections, renderWorkers, renderThinking],
    story: () => [loadPromptSlots],
    craft: () => [renderRulebook, renderRegex],
    world: () => [renderCast, renderLore],
    readers: () => [renderMemory, renderReferee],
    house: () => [loadTheme],
    help: () => [],
  };
  let showToken = 0;
  async function onShow({ all = false } = {}) {
    const token = ++showToken;
    if (all) {
      for (const r of Object.keys(ROOM_RENDERS)) for (const fn of ROOM_RENDERS[r]()) { try { await fn(); } catch (err) { /* left */ } }
      return;
    }
    if (els.booksLive && ctx.booksStatus) els.booksLive.textContent = 'Where the tales live: ' + ctx.booksStatus.words + '.';
    const room = (await db.settings.get('settingsRoom')) || 'storyteller';
    const first = (ROOM_RENDERS[room] || ROOM_RENDERS.storyteller)();
    for (const fn of first) { try { await fn(); } catch (err) { /* a section that will not draw is left */ } }
    const rest = Object.keys(ROOM_RENDERS).filter((r) => r !== room).flatMap((r) => ROOM_RENDERS[r]());
    let i = 0;
    const step = async () => {
      if (token !== showToken || i >= rest.length) return;
      try { await rest[i](); } catch (err) { /* left */ }
      i += 1;
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
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
