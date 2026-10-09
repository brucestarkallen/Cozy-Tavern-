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

import { gradeWithJudges, duelWithJudges, judgedMoment } from '../agents/benchrun.js'; /* M632/M633: the benchmark — several judges, averaged; M675: the moment a page answers, as its judge is told it */
import { benchJudgeIds } from './benchview.js'; /* M633 */
import { recordGrade, recordDuel, writerKey } from '../engine/bench.js'; /* M632 */
import { splitPrefill } from '../providers/effort.js'; /* M585: a go-on turn keeps only the thinking seed */
import { structuredPlanFor } from '../providers/openai.js'; /* M581: the opener asks only for a structured turn */
import { callWorker } from '../agents/call.js';
import { shownTextPatch, shownIndex } from '../engine/pagepatch.js'; /* M575, M576 */
import { fingerprint36 } from '../engine/fingerprint.js'; /* M575 */
import { tidyPeople, tidyDue, tidyRunWords } from '../agents/tidy.js'; /* M291: the character pages, tidied once */
import { windowCutAt } from '../engine/window.js'; /* M467 */
import { streamText } from './streamtext.js'; /* M279 */
import { db, shelvesOf } from '../store.js';
import { createProvider } from '../providers/index.js';
import { contextOf } from '../providers/room.js'; /* M285: one answer for the model's room */
import { learnContext, learnContextWithin } from '../providers/detect.js'; /* M289: the provider's own word on its room */
import { buildRequest, pageText, windowPlan, heatedNow, HYBRID_RECENT_CHARS, smallRecordWhole, addedNotes, HOUSE_COT_ID } from '../assemble/stack.js'; /* M510-50: the newest lines' room; M547: what a small storyteller reads whole */
import { beginWork, waitVisibly, bannerKnowsTales } from './workbanner.js'; /* M203: what the house is doing; M510-42: whose */
import { finalizeReceipt, estimateTokens } from '../assemble/receipt.js';
import { roomChars } from '../engine/pagecut.js'; /* M265: one measure of a room */
import { listModules, selectModules } from '../assemble/modules.js';
import { renderClock } from '../engine/clock.js'; /* M493 */
import { loadState, saveState, notify, snapshotState, restoreSnapshot, restoreNearestSnapshot, renderMasthead, headerWithGround, loadSnapshots, saveSnapshots, emptyState, foldJournal, journalReaches, saveVersionStates, loadVersionStates as loadAllVersionStates, saveOneVersion, versionStateOf, timelineAhead, headerMutations, markPageRead, oldestUnread, readMark, dropTheFuture, shareCheckpoints } from '../engine/state.js'; /* M507-6: the version ledgers' rows */
import { applyMutations, staleAfterJump, storyTurn, staleNows, duplicatePages, strayBookKeys, wrongWalkIns, hereByTheNewestPage, walkedBackOverTheWorld, lastingOnly, groundLooksStale, goneByTheirOwnPage, seatMadeCores, descriptorsThatAreNamed, descriptorsApart, noOneSpot } from '../engine/apply.js'; /* M405/M406; M419; M444; M452; M453 */
import { canonOn, canonBeforeSend, canonAfterPage, canonAction, canonSelfTest, canonSyncLedger, carryCanonMemory, canonMeta, canonRecordFor, canonWithdraw, withoutCanonTruths, canonSaveMeta, canonPremise, canonLensLedger } from '../canon/bridge.js'; /* M346/M386: canon verification */
import { canonRepeats, canonTidyPeople, canonTidyWords } from '../agents/canontidy.js'; /* M388: old pages stop repeating canon */
import { newSentId, keepSent, loadSent, pushSentToDevice, giveSentToTale } from '../sent.js'; /* M347: the words each page was sent, kept beside it; M636: read back for the sensors; M675: a tale's carried pages are given to it on the device */
import { readPageFull, readingWords, SAMPLE_READ, sensorWordForTurn, sensorRoleFor, takePageWord, keepPageWord, senseOf, sensePatch, SENSOR_LOOK } from '../agents/sensors.js'; /* M356/M357; M636: a reading lives on its page, and the one line the readings earn */
import { twinsRefused } from '../providers/userfirst.js'; /* M636: a model that takes no two turns of one role in a row */
import { onToast as onCanonToast } from '../canon/host.js';
import { canonNote as keepCanonNote, canonWhy } from '../canon/bridge.js'; /* M395: canon's own notes go to its room, never onto the screen; M486: why it had nothing to say */
import { extractTurn, noteWork, pendingWork, workInFlight, isYoungLedger } from '../agents/extractor.js'; /* M506: workInFlight */
import { loadWorkerStatus, runningWorkers, onWorkerChange } from '../agents/status.js';   /* M250/M255 */
import { enqueueWork, stopWork, workIsRunning, queuedCount, chainJob, workOut } from '../agents/queue.js';
import { pickWorkerConnection } from '../agents/assign.js';
import { scribeTurn } from '../agents/scribe.js';
import { refereeStep, maybeSeedSheet, refereeWhyWords, gatePasses, seenAndLeftOff } from '../agents/referee.js'; /* M531: the referee's own gate decides when fighters are weighed first */
import { maybeSummarize, redoLine, catchUpRecord, dueRange, coveredSet, cleanWindow, cleanBatch, recordFor, loadMemory, renderMemory, saveMemory, memoryAfterDeletion, memoryTruncatedAt, memoryWithoutPage, memoryForWindow, visiblePages, addCorrection, storySoFar, partlyReadLines, partlyReadMerged, rereadMergedLine, recordRoom, putBackMistakenMends, fixedCharsOf, keeperOnFor } from '../agents/memory.js';
import { checkTurn, mendPages } from '../agents/continuity.js';
import { lintPage, houseEyeWords } from '../agents/lint.js'; /* M88: the house's eye */
import { factChange, isNameLike, hasWord, replaceWord, againstTheBrief } from '../agents/ripple.js'; /* M100: the ripple */
import { wholeRecord, keeperTrouble, windowFor, coveredEnd, recordLinesBefore } from '../agents/memory.js'; /* M445: coveredEnd — the pages not yet folded; M673: the record before a page */
import { loadSessionRoot } from '../agents/housekeeper.js'; /* M331 */
import { voiceOf, groundingSeed } from '../assemble/voice.js'; /* M327: the two names; M358: the grounding phrase */
import { noteTellerConnection } from '../agents/call.js'; /* M328 */
import { makeHeaderGate, splitAtHeader, pageOnly } from './headergate.js';
import { tidyPage, readHeader, partParagraphs } from './pageshape.js'; /* M340: the page made whole before it is kept; M510-17 */ /* M322, M324, M325, M326 */ /* M35/M51: the whole record as the mender's canon; M315: why a keeper's run folded nothing */
import { mcName, isMcAlias, findActorKeySamePerson } from '../engine/duels.js'; /* M531: who is on the sheet already */
import { mineLeak, mineWord, mineCutAt, soundCount } from '../assemble/plain.js'; /* M510: the cut where a page began playing him; the sounds a page carried */
import { plannerAsk, runPlanner, loadPlan, planEntry, loadPlans, keepSound, keepTexture, planKey, hashText, PLAN_PAGES } from '../agents/planner.js'; /* M510: the planning helper; M519: the texture kept */
import { lawsOf } from '../assemble/laws.js'; /* M510 */
import { runEssentials, loadEssentials } from '../agents/essentials.js'; /* M510-15: the story's essentials */
import { pickRecall } from '../agents/recallpick.js'; /* M510-50: smart recall */
import { throughLens, overlayFor } from '../agents/canonlens.js'; /* M549: the wiki's lines, seen through his story */
import { wikiMaterial, worldClaims, worldWithout, claimsPrint, checkClaims } from '../agents/canoncheck.js'; /* M551: one check for what a helper wrote from memory */
import { GROUND_RULES } from '../agents/worldground.js'; /* M549 */
import { choicesOn, choiceAsk, makeChoices, offerOf, offerPatch, openOffer, takenRecord, takenOf, echoLines, echoesText, versionOf, CHOICE_PAGES } from '../agents/choices.js'; /* M548: Choices matter */
import { runPlans, loadPlansBook, pageRewritten } from '../agents/plans.js'; /* M510-22: the plans, kept whole until carried out; M528: a rewritten page read again */
import { lastPagesOf, SMALL_PAGES } from '../assemble/stack.js'; /* M510 */
import { voiceSampleOf, pageTexture, tooLoud as tooLoudNow } from '../assemble/smallprose.js'; /* M512: how the story sounds at its best, for a small storyteller; M519: the brake on sounds and dashes */
import { CANON_START_KEY, placeInCanon, canonStartWords, checkCanonStart, applyStartCheck, startCheckPrint } from '../agents/canonstart.js'; /* M516: where our story began in its canon; M550: checked against the wiki */
import { GROUND_KEY, runGround, groundWords, canonWithoutWorld } from '../agents/worldground.js'; /* M517: the automatic brief — the world, written once */
import { canonBlocks, lastingLines } from '../assemble/canonpages.js'; /* M518: canon on their own page */
const SIDE_JOBS = new Set(['keeper', 'sensors', 'essentials', 'placer', 'startcheck', 'ground', 'worldcheck', 'plans']); /* M529: the helpers that may run beside the ledger's readers */
/* M675 (the second reading) — ARE THE LEDGER'S READERS OUT? The ledger's healing on open and the finishing of a chain cut
 * short ask this before they touch the ledger. They asked "is anything queued or running for this tale?" — and the
 * opening of a tale itself sends helpers out (planAhead: the essentials, where the tale began, its world, a small
 * model's planner). So both worked only when they happened to ask before those were queued: a race the walk won until
 * M675 put the settling of out-of-character pages in front of them — and then neither ever ran on open (found by the
 * walk: DOM-105, 109, 128, 133). The helpers named here write their own books and never the ledger; anyone else out
 * for the tale is a reader. */
const OWN_BOOKS = new Set([...SIDE_JOBS, 'planner']);
const readersOut = (storyId) => workOut(storyId).some((name) => !OWN_BOOKS.has(name));
import { renderStateFacts as planFacts, stateView as planStateView, closeBy } from '../engine/state.js'; /* M510: what the helper reads; M589: who is close by */
import { renderPeopleTiers as planPeople, peopleView as planPeopleView, findPersonKey } from '../engine/people.js'; /* M510; M518: a canon block's person in the ledger */
import { worldTurn, worldRunWords, worldAgentOn, worldEffort } from '../agents/world.js'; /* M29: the world beyond the page */
import { continuousAuditOn, auditStretch, stretchWords, auditProgress, auditWaits, beginReading, endReading, pauseContinuousAudit } from '../agents/continuous.js'; /* M673: the continuous audit */
import { auditLedger, auditRunWords, auditOn, auditEvery, rebuildStandings, rebuildRunWords, AUDIT_PAGES, ledgerUpkeep } from '../agents/auditor.js'; /* M41: the ledger auditor; M50: the rebuild */
import { rebuildRecord, rebuildPeople, restoreRecord, restorePeople, rebuildRecordWords, rebuildPeopleWords, peopleHealDue, healStampDue, HEAL_GEN } from '../agents/rebuild.js'; /* M52: the gradual rebuilder */
import { foundWorld, founderRunWords, founderFingerprint } from '../agents/founder.js'; /* M45: the founder */
import { polishConcept } from '../agents/concept.js'; /* M478: a #story concept becomes the brief, its grammar set right */
import { renderWorldBrief, threadHousekeeping, voicesBeyondTheRoom } from '../engine/world.js'; /* M544 */
import { workerSignal, noteWorkerRun } from '../agents/status.js';
import { castForStory, castNamesFor } from '../import/cards.js';
import { loadLore, matchLoreDetailed, saveLore } from '../import/lorebook.js';
import { parseCommand, commandChip, asideAt, asideWho, attachedBlock, typedWords } from '../commands.js'; /* M674: asideAt — which pages are out of character; asideWho — how a request says so; M675: a file he attached, and his own words beside it */
import { openReceipt } from './receiptview.js';
/* M22: code blocks + markdown-lite in the prose (E5/E6), the shared
 * download courtesy for the per-story export (E4), and the reasoning
 * ladder's rank for the story's own say (A). */
import { renderRich } from './prose.js';
import { loadRules, currentRules, applyRules } from '../regex.js'; /* M30: the regex shelf */
import { renderHtmlProse, looksHtml } from './richhtml.js'; /* M31: display rules may dress the page in HTML */
import { download } from './download.js';
import { storyToMarkdown, storyToJsonl, storyExportBasename } from './storyexport.js';
import { EFFORT_RANK, effectiveReasoningOf, reasoningIsDown, reasonStyle, seedContinues } from '../providers/effort.js';
/* M10's showrunners ride the send path too (the episode mark is stripped
 * from the prose before the page is saved, and their standing texts join
 * the assembled tail). M15 audit found these names used below but never
 * imported — every send threw a ReferenceError before the storyteller was
 * ever asked. The imports ARE the fix; the M15 no-ghost-calls harness law
 * keeps the class from returning. */
import {
  stripEpisodeEnd, loadDirector, maybeAutoDirector, afterEpisodeEnd, renderDirectorNote, stripControlLeak } from '../agents/director.js';
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
/* M324: up to 400 — the craft's own header carries five fields and runs past 120 characters; a long header was
 * drawn as prose, and the house hung its own masthead above a page that already had one */
export const SCENE_HEAD_RE = /^\[[^\[\]\n]{2,400}\]$/;

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
    newWhere: document.getElementById('new-story-where'),
    shelfSort: document.getElementById('shelf-sort'), /* M466 */
    btnNew: document.getElementById('btn-new-story'),
    btnCancelNew: document.getElementById('btn-cancel-story'),
    /* M16: the shelves — a new shelf begins from the sidebar. */
    btnNewShelf: document.getElementById('btn-new-shelf'),
    btnBulkDelete: document.getElementById('btn-bulk-delete'), /* M621 */
    chooseBar: document.getElementById('choose-bar'),
    chooseCount: document.getElementById('choose-count'),
    btnDeleteChosen: document.getElementById('btn-delete-chosen'),
    btnChooseDone: document.getElementById('btn-choose-done'),
    btnBulkMove: document.getElementById('btn-bulk-move'), /* M630 */
    chooseMove: document.getElementById('choose-move'),
    btnNewGiant: document.getElementById('btn-new-giant'),
    newGiantForm: document.getElementById('new-giant-form'),
    newGiantName: document.getElementById('new-giant-name'),
    btnCancelGiant: document.getElementById('btn-cancel-giant'),
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
    choiceRow: document.getElementById('choice-row'), /* M548: the choices at a turning point */
    emberBar: document.getElementById('ember-bar'),
    emberFill: document.getElementById('ember-fill'),
    metaContext: document.getElementById('meta-context'),
    quickSwitch: document.getElementById('quick-switch'), /* M510 */
    quickSwitchWrap: document.getElementById('quick-switch-wrap'),
    menu: document.getElementById('msg-menu'),
    /* M22-E1/E3/E4: the prompt library chips, the jump-to-latest pill,
     * the per-story export menu, and a chip's manage menu. */
    promptChips: document.getElementById('prompt-chips'),
    btnAttach: document.getElementById('btn-attach'),
    btnImmerse: document.getElementById('btn-immerse'),
    btnImmerseShow: document.getElementById('btn-immerse-show'),
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
  /* M675 (the second reading): WHOSE PAGE IS BEING TOLD — the tale may not be the one open (he can open another while a
   * page is written), and letting a tale go asked the open one. And the tales being let go this moment: nothing new is
   * begun for them. */
  let tellingFor = null;
  const lettingGo = new Set();
  /* M22-E2: whether the resting-tales corner stands open (in-memory; a
   * fresh visit starts folded). */
  let showResting = false;
  /* M466: the resting shelves' corner, and how the shelves and tales are sorted (his choice, remembered) */
  let showRestingShelves = false;
  /* M621: BULK DELETE — his word: "add bulk delete on chat or project". "Bulk delete" opens a choosing mode: a tick on every
   * tale, and on every shelf head (a shelf ticked whole is every tale on it, resting ones too, and the shelf comes down
   * after them); "Delete the chosen" asks once, naming the count, then deletes; "Not now" leaves. */
  let choosing = false;
  const chosenTales = new Set();
  const chosenShelves = new Set();
  /* M630: what the choosing is for — "Bulk delete" or "Bulk move" (his: "add bulk change pages to another project"); one
   * button, one meaning: each opens the choosing with its own action in the bar */
  let chooseFor = 'delete';
  let giants = []; /* M630: giant projects — each holds shelves (store.js giants) */
  const SHELF_SORT_KEY = 'shelfSort';
  const SHELF_SORTS = new Set(['played', 'name', 'newest']);
  let shelfSort = 'played';
  /* B18: what the thread last rendered, so new pages can simply append. */
  let lastRender = { storyId: null, ids: [] };

  /* M574 (the audit): an id put into a selector is escaped — a page id carried in from an imported tale with a quote in
   * it broke every lookup of that page; CSS.escape where the browser has it */
  const cssId = (v) => (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function' ? CSS.escape(String(v)) : String(v).replace(/["\\]/g, '\\$&'));
  function toast(words) {
    if (ctx.toast) ctx.toast(words);
  }

  /* M395: canon verification's own notices (📍 a setting, 📖 a story position, 🔭 a wiki, a parser that failed) are kept
   * in its room — never a popup on his screen, page after page */
  onCanonToast((words) => keepCanonNote(words));

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
  let holdPlace = false; /* M364: a version being written in its page's place keeps the view at its first line */
  let lastScrollTop = 0;
  let scrollRaf = 0;
  function atTail() {
    const t = els.thread;
    return t.scrollHeight - t.scrollTop - t.clientHeight < 8;
  }
  els.thread.addEventListener('scroll', () => {
    const t = els.thread;
    if (holdPlace && busy) { following = false; lastScrollTop = t.scrollTop; updateJump(); return; } /* M364: reading a swipe from its start */
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

  /* M510-42: the banner names a tale that is not the one open — the titles are the shelf's own */
  bannerKnowsTales({ openTale: () => ctx.getActiveStoryId(), titleOf: (id) => { const t = (stories || []).find((x) => x && x.id === id); return t ? String(t.title || '') : ''; } });
  async function refreshStories(keepActive) {
    stories = (await db.stories.list()).filter((st) => !(st && st.building && typeof st.building === 'object')); /* M332: a branch still being made is not on the shelf */
    /* M311: a shelf whose row was lost is put back before the shelf is drawn — the tales still name it.
     * The device is asked once for the names it can find in its older files; without it, "Recovered shelf N". */
    try {
      const known = new Set((await db.projects.list()).map((p) => p.id));
      if (stories.some((st) => st && st.projectId && !known.has(st.projectId))) {
        let names = {};
        try {
          const res = await fetch(new URL('api/recover/projects', document.baseURI), { cache: 'no-store' });
          if (res.ok) { const r = await res.json(); if (r && r.projects && typeof r.projects === 'object') names = r.projects; }
        } catch (err) { /* no server: the shelves come back unnamed */ }
        const back = await db.projects.heal(names);
        if (back.length) toast(back.length === 1 ? 'A shelf that had gone missing is back: ' + back[0].name + '.' : back.length + ' shelves that had gone missing are back, every tale where it stood.');
      }
    } catch (err) { /* the shelf still draws */ }
    /* M16: the shelves gather alongside their tales. */
    projects = await db.projects.list();
    giants = await db.giants.list(); /* M630 */
    shelfCollapsed = (await db.settings.get(SHELF_COLLAPSED_KEY)) || {};
    { const s = await db.settings.get(SHELF_SORT_KEY); shelfSort = SHELF_SORTS.has(s) ? s : 'played'; if (els.shelfSort && els.shelfSort.value !== shelfSort) els.shelfSort.value = shelfSort; } /* M466 */
    /* M14: page counts ride the shelf rows; the byStory index counts
     * without reading a single page. */
    /* M313: a tale held here only as a shelf row has no pages to count — its row carries the number */
    const counts = await Promise.all(stories.map((s) => (s && s.shallow && Number.isFinite(s.pages) ? s.pages : db.messages.count(s.id).catch(() => 0))));
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
    li.dataset.story = story.id; /* M662: the search asks which tales stand on open shelves */
    li.className = 'story-item' + (story.id === activeId ? ' active' : '') + (opts.resting ? ' resting' : '') + (choosing && chosenTales.has(story.id) ? ' chosen' : '');

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
    if (choosing) {
      /* M621: while choosing, a tap on the row ticks it — nothing opens, and the row's own buttons step aside */
      const pick = document.createElement('input');
      pick.type = 'checkbox';
      pick.className = 'choose-pick';
      pick.checked = chosenTales.has(story.id);
      pick.setAttribute('aria-label', `Choose “${story.title}”`);
      pick.addEventListener('change', () => chooseTale(story, pick.checked));
      openBtn.addEventListener('click', () => chooseTale(story, !chosenTales.has(story.id)));
      li.append(pick, openBtn);
      return li;
    }
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
    exportBtn.addEventListener('click', (e) => openStoryMenu(e, story, 'export'));

    /* M510-33: MOVE A TALE TO ANOTHER SHELF — its own button. "Move to a shelf" lived inside the export menu behind ⇩
     * ("Take this tale with you"), where he never looked for it ("can I move a story from one project to another? I
     * can't find it"). One button, one meaning: ⇄ moves, ⇩ takes it with you. */
    const moveBtn = document.createElement('button');
    moveBtn.type = 'button';
    moveBtn.className = 'story-mini';
    moveBtn.title = 'Move to another shelf';
    moveBtn.setAttribute('aria-label', `Move “${story.title}” to another shelf`);
    moveBtn.textContent = '⇄';
    moveBtn.addEventListener('click', (e) => openStoryMenu(e, story, 'move'));

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

    li.append(openBtn, renameBtn, removeBtn, moveBtn, exportBtn, archiveBtn);
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

  async function openStoryMenu(e, story, mode = 'all') {
    e.stopPropagation();
    const menu = els.storyMenu;
    if (!menu) return;
    storyMenuFor = story.id;
    /* M510-33: ⇩ shows the ways to take it with you, ⇄ the shelves; a long press on the row shows both */
    for (const b of menu.querySelectorAll('[data-act^="export-"]')) b.hidden = mode === 'move';
    projects = await db.projects.list(); /* M56: the shelves as they stand now */
    /* M56: move the tale to a shelf — one button per shelf, and "no shelf" */
    const shelves = menu.querySelector('#story-menu-shelves');
    if (shelves) shelves.hidden = mode === 'export';
    if (shelves) {
      shelves.textContent = '';
      const head = document.createElement('div');
      head.className = 'lbl msg-menu-head';
      head.textContent = 'Move to a shelf';
      shelves.appendChild(head);
      const options = [{ id: '', name: 'No shelf (loose)' }, ...projects.filter((p) => p.archived !== true).map((p) => ({ id: p.id, name: p.name || 'a shelf' }))]; /* M466: a resting shelf is not offered */
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

  /* M466: THE SHELVES AND THE TALES IN THE ORDER HE CHOSE — last played first (stories.list() hands the tales that way;
   * a shelf stands by its most recently played tale), by name, or newest made first. One rule for shelves and tales. */
  const byName = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base', numeric: true });
  function sortTales(list) {
    const out = [...list];
    if (shelfSort === 'name') out.sort((a, b) => byName(a.title, b.title));
    else if (shelfSort === 'newest') out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return out; /* 'played': as the store hands them — last played first */
  }
  /* M630: giant projects stand in the shelves' own order — last played, by name, or newest; an empty one last */
  function sortGiants(list, inGiant) {
    const played = (g) => (inGiant.get(g.id) || []).reduce((m, sh) => Math.max(m, sh.stories.reduce((x, st) => Math.max(x, st.updatedAt || 0), 0)), 0);
    const out = [...list];
    if (shelfSort === 'name') out.sort((a, b) => byName(a.name, b.name));
    else if (shelfSort === 'newest') out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    else out.sort((a, b) => played(b) - played(a));
    return out;
  }
  function giantSection(giant, shelves, activeId) {
    const key = 'giant:' + giant.id;
    const collapsed = shelfCollapsed[key] === true;
    const section = document.createElement('li');
    section.className = 'shelf giant' + (collapsed ? ' collapsed' : '');
    section.dataset.giant = giant.id;
    const head = document.createElement('div');
    head.className = 'shelf-head';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'shelf-toggle lbl';
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    toggle.setAttribute('aria-label', collapsed ? `Open the giant project "${giant.name}"` : `Fold the giant project "${giant.name}"`);
    const caret = document.createElement('span');
    caret.className = 'shelf-caret';
    caret.textContent = collapsed ? '▸' : '▾';
    const label = document.createElement('span');
    label.className = 'shelf-name';
    label.textContent = giant.name;
    const badge = document.createElement('span');
    badge.className = 'shelf-badge';
    badge.textContent = shelves.length ? (shelves.length === 1 ? 'one shelf' : shelves.length + ' shelves') : 'no shelf yet';
    toggle.append(caret, label, badge);
    toggle.addEventListener('click', () => toggleShelf(key));
    if (choosing) {
      /* every shelf in it, whole */
      const pick = document.createElement('input');
      pick.type = 'checkbox';
      pick.className = 'choose-pick';
      pick.checked = shelves.length > 0 && shelves.every((sh) => chosenShelves.has(sh.project.id));
      pick.disabled = !shelves.length;
      pick.setAttribute('aria-label', `Choose every shelf in "${giant.name}", whole`);
      pick.addEventListener('change', () => {
        for (const sh of shelves) {
          const whole = stories.filter((st) => st.projectId === sh.project.id);
          for (const st of whole) { if (pick.checked) chosenTales.add(st.id); else chosenTales.delete(st.id); }
          if (pick.checked) chosenShelves.add(sh.project.id); else chosenShelves.delete(sh.project.id);
        }
        renderStoryList();
      });
      head.append(pick, toggle);
    } else {
      const renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.className = 'story-mini';
      renameBtn.title = 'Rename the giant project';
      renameBtn.setAttribute('aria-label', `Rename the giant project "${giant.name}"`);
      renameBtn.textContent = '✎';
      renameBtn.addEventListener('click', async () => {
        const next = typeof window.prompt === 'function' ? window.prompt('A new name for the giant project', giant.name) : null;
        if (next === null || !String(next).trim() || String(next).trim() === giant.name) return;
        await db.giants.rename(giant.id, next);
        await refreshStories(true);
      });
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'story-mini';
      removeBtn.title = 'Take the giant project down';
      removeBtn.setAttribute('aria-label', `Take down the giant project "${giant.name}" — its shelves stay`);
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', async () => {
        if (!window.confirm(`Take down the giant project "${giant.name}"? Its shelves and their tales stay — the shelves simply stand on their own.`)) return;
        await db.giants.remove(giant.id);
        await refreshStories(true);
        toast(`"${giant.name}" is taken down — its shelves stand on their own.`);
        if (ctx.onStoriesChanged) ctx.onStoriesChanged();
      });
      head.append(toggle, renameBtn, removeBtn);
    }
    section.appendChild(head);
    if (!collapsed) {
      const inner = document.createElement('ul');
      inner.className = 'giant-shelves';
      if (!shelves.length) {
        const p = document.createElement('li');
        p.className = 'quiet giant-empty';
        p.textContent = 'No shelf in it yet — "Bulk move" puts shelves in.';
        inner.appendChild(p);
      }
      for (const { project, stories: onShelf } of shelves) inner.appendChild(shelfSection(project, onShelf, activeId));
      section.appendChild(inner);
    }
    return section;
  }

  function sortShelves(shelves) {
    const played = (s) => s.stories.reduce((m, st) => Math.max(m, st.updatedAt || 0), 0);
    const out = [...shelves];
    if (shelfSort === 'name') out.sort((a, b) => byName(a.project.name, b.project.name));
    else if (shelfSort === 'newest') out.sort((a, b) => (b.project.createdAt || 0) - (a.project.createdAt || 0));
    else out.sort((a, b) => played(b) - played(a));
    return out;
  }

  /* M16: one shelf section — a collapsible .lbl header (caret, name, the
   * shelf's page-count badge) over its tales in interaction-recency order.
   * project === null is the "Loose tales" section. */
  function shelfSection(project, shelfStories, activeId, opts = {}) {
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
    if (choosing) {
      /* M621: the shelf whole — every tale on it (resting ones too), and a real shelf comes down after them */
      const whole = project ? stories.filter((s) => s.projectId === project.id) : shelfStories;
      const pick = document.createElement('input');
      pick.type = 'checkbox';
      pick.className = 'choose-pick';
      pick.checked = project ? chosenShelves.has(project.id) : (whole.length > 0 && whole.every((s) => chosenTales.has(s.id)));
      pick.disabled = !project && !whole.length;
      pick.setAttribute('aria-label', project ? `Choose the shelf “${name}” whole — every tale on it` : 'Choose every loose tale');
      pick.addEventListener('change', () => chooseShelf(project, whole, pick.checked));
      head.append(pick, toggle);
      section.appendChild(head);
      if (!collapsed) {
        const inner = document.createElement('ul');
        inner.className = 'shelf-stories';
        for (const story of sortTales(shelfStories)) inner.appendChild(storyItem(story, activeId));
        section.appendChild(inner);
      }
      return section;
    }
    head.appendChild(toggle);

    if (project && !opts.resting) {
      /* M662: the + — a new tale on THIS shelf */
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'story-mini shelf-add';
      addBtn.title = 'Start a new story on this shelf';
      addBtn.setAttribute('aria-label', `Start a new story on the shelf "${name}"`);
      addBtn.textContent = '+';
      addBtn.addEventListener('click', () => openNewStoryForm(project));
      head.appendChild(addBtn);
    }
    if (project) {
      const renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.className = 'story-mini';
      renameBtn.title = 'Rename the shelf';
      renameBtn.setAttribute('aria-label', `Rename the shelf “${name}”`);
      renameBtn.textContent = '✎';
      renameBtn.addEventListener('click', () => beginShelfRename(head, project));

      /* M466: a shelf put to rest — the whole project paused — waits in its own corner at the foot; nothing is deleted */
      const restBtn = document.createElement('button');
      restBtn.type = 'button';
      restBtn.className = 'story-mini';
      restBtn.title = opts.resting ? 'Wake this shelf' : 'Put this shelf to rest';
      restBtn.setAttribute('aria-label', `${opts.resting ? 'Wake' : 'Put to rest'} the shelf “${name}” — its tales stay on it`);
      restBtn.textContent = opts.resting ? '↩' : '☾';
      restBtn.addEventListener('click', () => restShelf(project, !opts.resting));

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'story-mini';
      removeBtn.title = 'Take the shelf down';
      removeBtn.setAttribute('aria-label', `Take down the shelf “${name}” — the tales stay`);
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => removeShelf(project));

      head.append(renameBtn, restBtn, removeBtn);
    }
    section.appendChild(head);

    if (!collapsed) {
      const inner = document.createElement('ul');
      inner.className = 'shelf-stories';
      for (const story of sortTales(shelfStories)) inner.appendChild(storyItem(story, activeId));
      section.appendChild(inner);
    }
    return section;
  }

  /* M621: choosing — a tale, a shelf whole, the bar's count, and the delete */
  function chooseTale(story, on) {
    if (on) chosenTales.add(story.id);
    else {
      chosenTales.delete(story.id);
      if (story.projectId) chosenShelves.delete(story.projectId); /* a shelf with a tale left on it is no longer chosen whole */
    }
    renderStoryList();
  }
  function chooseShelf(project, whole, on) {
    for (const s of whole) { if (on) chosenTales.add(s.id); else chosenTales.delete(s.id); }
    if (project) { if (on) chosenShelves.add(project.id); else chosenShelves.delete(project.id); }
    renderStoryList();
  }
  function drawChooseBar() {
    if (els.chooseBar) els.chooseBar.hidden = !choosing;
    if (els.btnBulkDelete) els.btnBulkDelete.hidden = choosing;
    if (els.btnBulkMove) els.btnBulkMove.hidden = choosing; /* M630 */
    const tales = stories.filter((s) => chosenTales.has(s.id)).length;
    const shelves = projects.filter((p) => chosenShelves.has(p.id)).length;
    const verb = chooseFor === 'move' ? 'move' : 'delete';
    if (els.chooseCount) {
      els.chooseCount.textContent = !tales && !shelves
        ? 'Tick the tales to ' + verb + ' — or a shelf, whole'
        : (tales === 1 ? 'One tale' : tales + ' tales') + ' chosen' + (shelves ? ' · ' + (shelves === 1 ? 'one shelf' : shelves + ' shelves') + ' whole' : '');
    }
    if (els.btnDeleteChosen) { els.btnDeleteChosen.hidden = chooseFor !== 'delete'; els.btnDeleteChosen.disabled = !tales && !shelves; }
    if (els.chooseMove) {
      els.chooseMove.hidden = chooseFor !== 'move';
      if (chooseFor === 'move' && choosing) drawMovePicker(tales, shelves);
    }
  }
  /* M630: where the chosen can go — the tales onto a shelf (or off every shelf), the shelves into a giant project (or
   * out of one); each choice says what it moves */
  function drawMovePicker(tales, shelves) {
    const sel = els.chooseMove;
    sel.textContent = '';
    const first = document.createElement('option');
    first.value = '';
    first.textContent = 'Move the chosen to…';
    sel.appendChild(first);
    const giantName = (id) => (giants.find((g) => g.id === id) || {}).name || '';
    const onto = document.createElement('optgroup');
    onto.label = tales ? 'The chosen tales, onto a shelf' : 'Tales onto a shelf (none chosen)';
    const shelfOpt = (value, words) => { const o = document.createElement('option'); o.value = value; o.textContent = words; o.disabled = !tales; onto.appendChild(o); };
    shelfOpt('shelf:', 'Off every shelf (loose)');
    for (const p of projects.filter((x) => x.archived !== true)) shelfOpt('shelf:' + p.id, (p.giantId && giantName(p.giantId) ? giantName(p.giantId) + ' › ' : '') + (p.name || 'a shelf'));
    sel.appendChild(onto);
    const into = document.createElement('optgroup');
    into.label = shelves ? 'The chosen shelves, into a giant project' : 'Shelves into a giant project (choose a shelf whole)';
    const giantOpt = (value, words) => { const o = document.createElement('option'); o.value = value; o.textContent = words; o.disabled = !shelves; into.appendChild(o); };
    giantOpt('giant:', 'Out of their giant project');
    for (const g of giants) giantOpt('giant:' + g.id, g.name);
    sel.appendChild(into);
    sel.value = '';
  }
  async function moveChosen(where) {
    const ids = stories.filter((s) => chosenTales.has(s.id)).map((s) => s.id);
    const shelves = projects.filter((p) => chosenShelves.has(p.id));
    if (where.startsWith('shelf:')) {
      const to = where.slice('shelf:'.length);
      if (!ids.length) return;
      const shelf = projects.find((p) => p.id === to);
      const there = to ? `onto the shelf "${shelf ? shelf.name : 'a shelf'}"` : 'off every shelf (loose)';
      if (!window.confirm(`Move ${ids.length === 1 ? 'one tale' : ids.length + ' tales'} ${there}?`)) return;
      let moved = 0;
      for (const id of ids) { try { await db.stories.update(id, { projectId: to || null }); moved += 1; } catch (err) { /* the rest still move */ } }
      choosing = false; chosenTales.clear(); chosenShelves.clear();
      await refreshStories(true);
      toast(`${moved === 1 ? 'One tale' : moved + ' tales'} moved ${there}.`);
    } else if (where.startsWith('giant:')) {
      const to = where.slice('giant:'.length);
      if (!shelves.length) return;
      const giant = giants.find((g) => g.id === to);
      const there = to ? `into the giant project "${giant ? giant.name : 'a giant project'}"` : 'out of their giant project';
      if (!window.confirm(`Put ${shelves.length === 1 ? 'one shelf' : shelves.length + ' shelves'} ${there}? Their tales stay on them.`)) return;
      let moved = 0;
      for (const p of shelves) { try { if (await db.projects.update(p.id, { giantId: to || null })) moved += 1; } catch (err) { /* the rest still move */ } }
      choosing = false; chosenTales.clear(); chosenShelves.clear();
      await refreshStories(true);
      toast(`${moved === 1 ? 'One shelf' : moved + ' shelves'} put ${there}.`);
    }
    if (ctx.onStoriesChanged) ctx.onStoriesChanged();
  }
  function setChoosing(on, intent = 'delete') {
    choosing = on === true;
    chooseFor = intent === 'move' ? 'move' : 'delete'; /* M630 */
    chosenTales.clear();
    chosenShelves.clear();
    renderStoryList();
  }
  async function deleteChosen() {
    const ids = stories.filter((s) => chosenTales.has(s.id)).map((s) => s.id);
    const shelves = projects.filter((p) => chosenShelves.has(p.id));
    if (!ids.length && !shelves.length) return;
    const shelfNames = shelves.map((p) => '“' + p.name + '”').join(', ');
    const ask = ids.length
      ? `Delete ${ids.length === 1 ? 'one tale' : ids.length + ' tales'} for good? Their pages will be gone.` + (shelves.length ? ` ${shelves.length === 1 ? 'The shelf' : 'The shelves'} ${shelfNames} come${shelves.length === 1 ? 's' : ''} down with them.` : '')
      : `Take down ${shelves.length === 1 ? 'the shelf' : 'the shelves'} ${shelfNames}?`;
    if (!window.confirm(ask)) return;
    let gone = 0;
    let down = 0;
    try {
      await stopTheWorkOf(ids);
      const activeId = ctx.getActiveStoryId(); /* M675: read after the wait — he may have opened another tale meanwhile */
      for (const id of ids) {
        try { await db.stories.remove(id); gone += 1; } catch (err) { /* the rest still go */ }
      }
      for (const p of shelves) { try { if (await db.projects.remove(p.id)) down += 1; } catch (err) { /* the rest still come down */ } }
      choosing = false;
      chosenTales.clear();
      chosenShelves.clear();
      if (ids.includes(activeId)) ctx.setActiveStoryId(null);
      await refreshStories(true);
      await renderThread({ structural: true, opening: true });
    } finally { doneLettingGo(ids); }
    const said = [gone ? (gone === 1 ? 'One tale' : gone + ' tales') + ' deleted' : '', down ? (down === 1 ? 'one shelf' : down + ' shelves') + ' taken down' : ''].filter(Boolean).join(' · ');
    toast((said.charAt(0).toUpperCase() + said.slice(1) || 'Nothing was deleted') + '.');
    if (ctx.onStoriesChanged) ctx.onStoriesChanged();
  }

  /* M466: a shelf rests or wakes; its tales stay where they are and the open tale stays open */
  async function restShelf(project, rest) {
    await db.projects.update(project.id, { archived: rest });
    await refreshStories(true);
    toast(rest ? `The shelf “${project.name}” rests — it waits at the foot with its tales.` : `The shelf “${project.name}” is back.`);
    if (ctx.onStoriesChanged) ctx.onStoriesChanged();
  }

  /* M466: the sort is his, remembered */
  if (els.shelfSort) {
    els.shelfSort.addEventListener('change', async () => {
      shelfSort = SHELF_SORTS.has(els.shelfSort.value) ? els.shelfSort.value : 'played';
      await db.settings.set(SHELF_SORT_KEY, shelfSort).catch(() => {});
      renderStoryList();
    });
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
    drawChooseBar(); /* M621 */
    els.list.textContent = '';
    els.listEmpty.hidden = stories.length > 0;
    const activeId = ctx.getActiveStoryId();
    /* M22-E2: resting (archived) tales step out of the shelves; a quiet
     * row at the foot says how many rest, and taps open to visit (or
     * wake) them. */
    const waking = stories.filter((s) => s.archived !== true);
    const resting = stories.filter((s) => s.archived === true);
    const grouped = shelvesOf(waking, projects);
    /* M466: shelves put to rest keep their tales and wait in their own corner; the rest stand in the chosen order */
    const shelvesUp = sortShelves(grouped.shelves.filter((s) => s.project.archived !== true));
    const shelvesResting = sortShelves(grouped.shelves.filter((s) => s.project.archived === true));
    /* M630: a shelf standing in a giant project is drawn inside it; a giant project's shelves keep the shelves' order */
    const giantIds = new Set(giants.map((g) => g.id));
    const inGiant = new Map();
    const alone = [];
    for (const sh of shelvesUp) {
      const gid = sh.project.giantId;
      if (gid && giantIds.has(gid)) { if (!inGiant.has(gid)) inGiant.set(gid, []); inGiant.get(gid).push(sh); } else alone.push(sh);
    }
    for (const g of sortGiants(giants, inGiant)) els.list.appendChild(giantSection(g, inGiant.get(g.id) || [], activeId));
    for (const { project, stories: onShelf } of alone) {
      els.list.appendChild(shelfSection(project, onShelf, activeId));
    }
    if (grouped.loose.length || !projects.length) {
      els.list.appendChild(shelfSection(null, sortTales(grouped.loose), activeId));
    }
    if (shelvesResting.length) els.list.appendChild(restingShelvesRow(shelvesResting, activeId));
    if (resting.length) els.list.appendChild(restingRow(resting, activeId));
  }

  /* M466: the "N resting shelves" corner — each resting shelf whole (name, count, its tales) with a way to wake it */
  function restingShelvesRow(shelves, activeId) {
    const li = document.createElement('li');
    li.className = 'shelf resting-shelf resting-shelves' + (showRestingShelves ? '' : ' collapsed');
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'shelf-head';
    const caret = document.createElement('span');
    caret.className = 'shelf-caret';
    caret.textContent = showRestingShelves ? '▾' : '▸';
    const name = document.createElement('span');
    name.className = 'shelf-name';
    name.textContent = shelves.length === 1 ? 'One resting shelf' : `${shelves.length} resting shelves`;
    head.append(caret, name);
    head.addEventListener('click', () => { showRestingShelves = !showRestingShelves; renderStoryList(); });
    const ul = document.createElement('ul');
    ul.className = 'shelf-stories';
    for (const { project, stories: onShelf } of shelves) ul.appendChild(shelfSection(project, onShelf, activeId, { resting: true }));
    li.append(head, ul);
    return li;
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
    caret.textContent = showResting ? '▾' : '▸'; /* M466: the caret says whether the corner stands open */
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

  /* M662 — HIS: "add plus button so I can easily add new story in project… Start new story just create new story on loose
   * tales". The form used to ASK which shelf, and offered first the shelf of whichever tale happened to be open — so
   * "Start a new story" put a new tale on a shelf he had not chosen. Where a tale starts is now the button he pressed:
   * "Start a new story" starts a loose tale; the + on a shelf starts one on that shelf. The form says which. */
  let newStoryShelf = null;
  function openNewStoryForm(project) {
    newStoryShelf = project && project.id ? project.id : null;
    if (els.newWhere) els.newWhere.textContent = project ? 'It starts on the shelf “' + project.name + '”.' : 'It starts among your loose tales.';
    els.newForm.hidden = false;
    els.newTitle.value = '';
    try { els.newForm.scrollIntoView({ block: 'nearest' }); } catch (err) { /* an old browser: the focus below brings it into view */ }
    els.newTitle.focus();
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

  /* M675 — ONE WAY TO LET A TALE GO. The shelf's "Delete" (the chosen tales) first stops a page being written for a tale
   * it deletes and lets its helpers' work go; the × on a tale's own row did neither. Let go by its × while its page
   * was still being written, the tale was deleted — and then the page landed: walked in the house, one page and nine
   * rows (ledger, checkpoints, workers…) of a tale that no longer exists were left in the store (the rows are swept
   * at the next start; nothing ever swept the page), its readers went on asking their models about it, and the screen
   * said "writing" over an empty room until the answer had come. Both doors stop the tale's work here first. */
  /* M675 (the second reading) — THE TALE BEING TOLD IS NOT ALWAYS THE ONE OPEN, AND A TELLING BEGINS BEFORE ITS REQUEST.
   * This asked the OPEN tale: with a page being written for one tale and another open, letting the first go stopped
   * nothing (the page landed in a tale that was gone, the fault this was written to end), and letting the open one go
   * stopped the other's telling. And in the seconds before a telling's request begins there was nothing to stop: it
   * waited fifteen seconds, deleted, and the page landed afterwards. Now: the tales are marked as being let go (the
   * telling looks between its calls, and begins nothing more for them); what waits and runs for them is stopped, so a
   * telling waiting for its readers waits no longer; the telling is stopped if it is THEIRS (generate says whose it
   * is, and can be stopped from its first moment); and what was begun meanwhile is stopped again. The caller takes the
   * mark off when it has finished (doneLettingGo). */
  async function stopTheWorkOf(ids) {
    if (!ids.length) return; /* (only shelves were chosen: no tale goes) */
    for (const id of ids) lettingGo.add(id);
    for (const id of ids) stopWork(id);
    /* the house is claimed and has not said for which tale yet (the moment between a send and its telling; a walk to
     * another version): in a moment it says, or lets go */
    for (let i = 0; i < 100 && busy && !tellingFor; i += 1) await new Promise((r) => setTimeout(r, 30));
    /* a page being written for a tale he is deleting is stopped first, as his Stop would, and let settle */
    if (busy && ids.includes(tellingFor || ctx.getActiveStoryId())) {
      if (abort) abort.abort();
      for (let i = 0; i < 150 && busy; i += 1) await new Promise((r) => setTimeout(r, 100));
    }
    for (const id of ids) stopWork(id); /* its helpers' waiting and running work goes with it */
  }
  function doneLettingGo(ids) { for (const id of ids) lettingGo.delete(id); }
  async function removeStory(story) {
    const ok = window.confirm(
      `Let go of “${story.title}”? The pages will be gone for good.`
    );
    if (!ok) return;
    try {
      await stopTheWorkOf([story.id]); /* M675 */
      await db.stories.remove(story.id);
      if (ctx.getActiveStoryId() === story.id) ctx.setActiveStoryId(null);
      await refreshStories();
      await renderThread({ structural: true, opening: true });
    } finally { doneLettingGo([story.id]); }
    if (ctx.onStoriesChanged) ctx.onStoriesChanged();
  }

  /* M675 — A TALE'S CARRIED PAGES ARE GIVEN TO IT ON THE DEVICE. A branch carries pages whose sent words ("what the
   * storyteller saw") the device keeps under the tale they were told in: asked under the branch's own name it had
   * nothing, and letting the first tale go deleted the only copy (the audit). When a branch is made, the parent's own
   * words go to the device first and the carried pages are copied from its archive into the branch's; and whenever a
   * tale is opened, any page of it the device does not hold under its name is looked for in every archive the device
   * keeps — a branch made before this is healed by being opened. Every version of a page has its own words. Never
   * waited for by what he is doing, never a reason to fail it (js/sent.js giveSentToTale asks once a sitting). */
  function giveCarriedWords(storyId, { parent = null } = {}) {
    (async () => {
      try {
        if (!storyId) return;
        if (parent) await pushSentToDevice(parent);
        const wanted = [];
        for (const m of await db.messages.list(storyId)) {
          if (!m || m.role !== 'assistant') continue;
          const versions = Array.isArray(m.swipes) && m.swipes.length ? m.swipes : [m];
          for (const v of versions) if (v && v.receipt && typeof v.receipt.sentId === 'string' && v.receipt.sentId) wanted.push({ id: v.receipt.sentId, ts: Number.isFinite(v.ts) ? v.ts : m.ts });
          if (m.receipt && typeof m.receipt.sentId === 'string' && m.receipt.sentId) wanted.push({ id: m.receipt.sentId, ts: m.ts });
        }
        if (wanted.length) await giveSentToTale(storyId, wanted, { from: parent || '*' });
      } catch (err) { /* asked again when the tale is next opened */ }
    })();
  }

  async function openStory(id) {
    ctx.setActiveStoryId(id);
    renderStoryList();
    /* M189: a tale whose pages are not here yet fetches them now. The shelf
     * arrives with the house book (a few kilobytes); the pages of a tale come
     * when the reader opens it, so a browser holds what it is actually read
     * in and not a copy of everything. */
    const known = await db.stories.get(id);
    if (known && known.shallow && ctx.booksStatus && typeof ctx.booksStatus.fetchStory === 'function') {
      try { await ctx.booksStatus.fetchStory(id); } catch (err) { /* the boot pull is still the backstop */ }
    } else if (known && ctx.booksStatus && typeof ctx.booksStatus.freshen === 'function') {
      /* M313: a tale held here is no longer refreshed at every open of the browser — it is looked at now */
      try { await ctx.booksStatus.freshen(id); } catch (err) { /* it opens as it stands */ }
    }
    await renderThread({ structural: true, opening: true });
    closePanel();
    if (ctx.onStoriesChanged) ctx.onStoriesChanged();
    /* M675 (the second reading) — A TALE WHOSE PAGES COULD NOT BE BROUGHT IN SAYS SO. The pages of a tale this browser holds
     * only by name are fetched when it is opened; when that fails (the tavern not answering, or not serving this
     * address, a copy brought in without its pages) the tale opened EMPTY, without a word — to the eye, a tale whose
     * pages were gone. They are where they were; the thread says so, and why. */
    try {
      const still = await db.stories.get(id);
      if (still && still.shallow && ctx.getActiveStoryId() === id && !(await db.messages.count(id).catch(() => 0))) {
        const st = ctx.booksStatus;
        const why = st && st.refused && typeof st.refusedWords === 'function' ? st.refusedWords(st.refused)
          : st && st.backed ? 'The tavern did not hand them over just now.'
            : 'The tavern’s server is not answering this browser.';
        els.thread.appendChild(noteNode('This tale’s pages are not in this browser — it holds the tale by name, and its pages are kept on the device' + (Number(still.pages) > 0 ? ' (' + still.pages + ' of them)' : '') + '. ' + why + ' Nothing is lost: open the tale again once the tavern answers, and they are brought in.'));
      }
    } catch (err) { /* the tale opens as it stands */ }
    await taleOpened(await db.stories.get(id));
  }

  /* M675 (the second reading) — WHAT THE HOUSE DOES FOR A TALE THAT HAS JUST BEEN OPENED, IN ONE PLACE. It was written
   * out in openStory alone, and the tale open when the app starts never goes through openStory: the start asked only the
   * two oldest of these (resume, heal). So for the tale he reads most — the one left open — its kept pages were never
   * looked over on a new build (the repair of what M669's finisher did, the marks), the pages after an out-of-character
   * message were never settled, and its carried pages were never given to it on the device, until he happened to open
   * another tale and come back. Both doors call this now. In order:
   *   - which pages after an out-of-character message are the story is settled before any reader looks (once a tale);
   *   - M69: a ledger from a longer telling is caught by its own stamps; M127: a chain cut short is finished; M452: the
   *     ledger heals — one after the other, handed back as `ledger` (the start waits for it, as it always did; opening
   *     from the shelf does not);
   *   - M488: the kept pages' marks are mended (once a tale a build);
   *   - M675: its carried pages are given to it on the device. */
  async function taleOpened(story) {
    if (!story || !story.id) return null;
    /* a tale this browser holds by name only (its pages are on the device, and could not be brought in): nothing of it
     * can be settled, mended or healed yet — and none of the once-a-tale marks may be set over pages that are not here
     * (they were: opened while the tavern did not answer, the tale was "settled" and "mended" with no page in hand,
     * and never looked at again once its pages came). It is opened again when they are in. */
    { const now = await db.stories.get(story.id); if (!now || now.shallow) return null; }
    try { await settleAsides(story); } catch (err) { /* asked again at the next open */ }
    const ledger = repairTimeline(story).then(() => resumeUnfinishedChain(story)).then((resumed) => (resumed ? null : healLedgerOnOpen(story))).catch(() => {});
    mendPagesOnOpen(story).catch(() => {});
    giveCarriedWords(story.id);
    return { ledger };
  }

  /* M675 — THE PAGES ALREADY KEPT THAT ARE THE STORY, THOUGH THEY FOLLOW AN OUT-OF-CHARACTER MESSAGE (see commands.js asideAt).
   * Since M674 a storyteller page with no mark of its own is out of character when the page before it is his question
   * to the storyteller. Two kinds of page stand in that place and are the story, and the house can tell both:
   *   - one it told AS THE STORY (a hidden "go on" stands between them — the reading every "ask again" uses);
   *   - one it never told at all (no receipt: brought in from another app, where "((…))" is an instruction and the
   *     reply is the story going on — read as the story until M674).
   * Each is marked ooc: false, once. And what went wrong for them since M674 is put right: in a tale begun since then,
   * the ledger's catch-up had passed the pages BROUGHT IN (no receipt) over as read — they are marked unread, and read
   * when the house is idle.
   * M675 (the second reading) — AND NOTHING ELSE IS UNDONE. This also let go every record line folded since M674 over
   * such a page ("the keeper was told the page was not the story") — it never was: the keeper's passage says nothing
   * of which pages are out of character, on purpose (memory.js; AGENTS M674), so the same request would fold the same
   * words again, and the line's Detail, the audit's repairs and marks, and any squeeze made over it since were lost
   * for nothing. The lines stand. And a page this house TOLD as the story (it has a receipt) was read in its turn by
   * its own chain, which never asked whose page it was: it is not marked unread to be read a second time. */
  const ASIDES_BY_PLACE_SINCE = Date.UTC(2026, 9, 8); /* M674 */
  async function settleAsides(story) {
    if (!story || !story.id || busy || replaying) return 0;
    const mark = 'asidesSettled:' + story.id;
    if ((await db.settings.get(mark)) === 1) return 0;
    const all = await db.messages.list(story.id);
    const settled = [];
    const broughtIn = [];
    for (let i = 0; i < all.length; i += 1) {
      const m = all[i];
      if (!m || m.hidden || m.role !== 'assistant' || m.ooc === true || m.ooc === false) continue;
      let j = i - 1;
      while (j >= 0 && all[j] && all[j].hidden) j -= 1;
      const asked = j >= 0 ? all[j] : null;
      if (!asked || asked.role === 'assistant') continue;
      if (!(asked.ooc === true || parseCommand(typedWords(String(asked.text || ''))).ooc === true)) continue; /* by its place it would be read as his question's answer */
      if (turnArgsBefore(all, i).ooc === true && m.receipt) continue; /* told by this house in answer to that question: out of character, as its place says */
      await db.messages.update(story.id, m.id, { ooc: false });
      settled.push(m.id);
      if (!m.receipt) broughtIn.push(m.id); /* never told by this house: the ledger's catch-up is the only reader it ever had */
    }
    if (settled.length) {
      try {
        const shown = visiblePages(await db.messages.list(story.id));
        if (broughtIn.length && Number(story.createdAt) >= ASIDES_BY_PLACE_SINCE) {
          const told = shown.filter((x) => x.role === 'assistant');
          const st = await loadState(story.id);
          const was = readMark(st);
          const unread = broughtIn.map((id) => told.findIndex((x) => x.id === id)).filter((k) => k !== -1 && k <= was).sort((a, b) => a - b);
          if (unread.length) {
            const ahead = new Set(Array.isArray(st.readAhead) ? st.readAhead : []);
            for (let k = unread[0] + 1; k <= was; k += 1) if (!unread.includes(k)) ahead.add(k);
            st.readTo = unread[0] - 1;
            st.readAhead = [...ahead].filter((k) => k > st.readTo).sort((a, b) => a - b);
            await saveState(story.id, st);
          }
        }
        notify(story.id);
      } catch (err) { /* the pages are marked; the record and the ledger catch up as they always do */ }
    }
    await db.settings.set(mark, 1).catch(() => {});
    return settled.length;
  }

  /* M622: A SEARCH HIT OPENS ITS TALE AT ITS PAGE — shown however far back it stands (the thread draws the newest turns;
   * "Show earlier" turns are opened to reach it), brought to the middle of the screen and marked for a moment. */
  async function jumpToPage(storyId, messageId) {
    if (!storyId || !messageId) return false;
    if (ctx.getActiveStoryId() !== storyId) await openStory(storyId);
    else closePanel();
    const pages = (await db.messages.list(storyId)).filter((m) => m && !m.hidden);
    const i = pages.findIndex((m) => m.id === messageId);
    if (i < 0) { toast('That page is no longer in the tale.'); return false; }
    const ts = Number(await db.settings.get('turnsShown'));
    const turnsShown = Number.isFinite(ts) && ts > 0 ? ts : 30;
    const need = Math.ceil((pages.length - i) / 2) - turnsShown;
    if (need > (shownExtra.get(storyId) || 0)) {
      shownExtra.set(storyId, need);
      await renderThread({ structural: true });
    }
    /* after the thread has settled its own scroll (two frames), the page is brought into view */
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 40));
    const node = [...els.thread.querySelectorAll('.msg')].find((n) => n.dataset && n.dataset.id === messageId);
    if (!node) return false;
    if (typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'center' });
    node.classList.add('search-hit');
    setTimeout(() => node.classList.remove('search-hit'), 2600);
    return true;
  }

  /* M488: THE PAGES' MARKS HEAL WHEN A STORY OPENS — nothing to press. The page repair runs when a page ARRIVES; a
   * page kept by an older build (a browser that had not taken the new coat yet) kept the marks it came with, and the
   * writer read a stray asterisk under a green light with a button he had to know about. Now, once per tale per
   * build, the same repair runs over every page already kept: marks and white space only, a page it would not change
   * is not written, the thread redraws only if something moved, a toast says how many. Never mid-turn. */
  async function mendPagesOnOpen(story) {
    if (!story || !story.id) return;
    if (busy) return; /* never mid-turn */
    const mark = 'pagesMended:' + story.id;
    if ((await db.settings.get(mark)) === VERSION) return;
    const r = await mendAllPages({ quiet: true, story });
    if (r && r.stopped) return; /* M675: he began a page meanwhile — taken up again at the next open */
    await db.settings.set(mark, VERSION).catch(() => {});
    if (r && r.mended) toast((r.mended === 1 ? 'One page’s marks were mended on opening' : r.mended + ' pages’ marks were mended on opening') + ' (the repair of ' + VERSION + ').');
  }

  /* M452: THE LEDGER HEALS WHEN A STORY OPENS — nothing to press. A ledger an older reader left (someone "elsewhere" at the
   * very place the scene stands while the newest page shows them there; someone the old compound test put in the room)
   * is mended in code, at once, before he writes: the same laws the readers keep after every page (engine/apply.js
   * hereByTheNewestPage, wrongWalkIns), journaled. Never while a page is being written or read, never over another
   * browser's readers, never on a story made a minute ago (its own chain settles it). */
  async function healLedgerOnOpen(story) {
    if (!story || !story.id || busy || isReplaying() || story.extraction === false) return false;
    if (Number.isFinite(story.createdAt) && Date.now() - story.createdAt < 60000) return false;
    if (readersOut(story.id) || otherHandAt(story.id)) return false; /* M675: the readers — not the helpers the opening itself sends out */
    const history = visiblePages(await db.messages.list(story.id));
    const told = history.filter((m) => m.role === 'assistant');
    const newest = [...told].reverse().find((m) => !m.ooc && !m.stopped && pageText(m).trim());
    if (!newest) return false;
    const state = await loadState(story.id);
    let healed = false;
    /* M455: and the hour the newest page's header gives, on the day it names — a clock a page behind is put right */
    const muts = [...headerMutations(pageText(newest), { day: state.clock && typeof state.clock.dayWords === 'string' ? state.clock.dayWords : '' }).filter((m) => m.type === 'clock.set'), ...wrongWalkIns( /* M679: and in the story's own words for the day — a clock that read "Monday" where his page said "Thornday" heals on the next opening */state, told.map((m) => ({ text: m.ooc ? '' : pageText(m) }))), ...hereByTheNewestPage(state, pageText(newest), { pageAt: told.indexOf(newest) }), ...walkedBackOverTheWorld(state, pageText(newest)), ...goneByTheirOwnPage(state, pageText(newest)), ...seatMadeCores(state), ...descriptorsThatAreNamed(state)]; /* M491: on opening too; M508: a core made of a seat is let go; M509-2: a descriptor that is a named person; M679: the newest page's own leave stands */
    if (muts.length && !busy && !isReplaying() && !readersOut(story.id)) { /* M314: a queued moment is re-checked before it writes */
      const { state: next, applied } = applyMutations(state, muts);
      if (applied.length) { await saveState(story.id, next); notify(story.id); healed = true; }
    }
    /* M453: a ground the newest page's telling never speaks of — the auditor, who reads the whole story, is asked now,
     * quietly, before he writes (its move off an echoing header is held to the telling in code) */
    if (groundLooksStale(await loadState(story.id), pageText(newest)) && (await auditOn(story))) {
      const connection = await resolveWorkerConnection(story, 'auditor');
      if (connection && !busy && !isReplaying()) {
        const promise = enqueueWork(story.id, { name: 'auditor', run: chainJob(async ({ signal, stale, renew }) => {
          let result = await auditLedger({ connection, storyId: story.id, brief: story.brief || '', castNotes: story.castNotes || '', castNames: await castNamesFor(story), signal, stale, renew, canonRecord: await canonRecordOf(story) });
          if (result && !stale()) result = await resolveBriefWins(story, connection, result, signal, renew);
          return { silent: false, detail: auditRunWords(result), raw: result && result.raw };
        }, () => false) });
        noteWork(story.id, promise);
      }
    }
    return healed;
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
    btn.addEventListener('click', () => openReceipt(receipt, extraction, findings, { storyId: ctx.getActiveStoryId() || '' }));
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

  /* M301: `text` may be a function — the live block hands one over so "Copy the
   * thinking" takes what has streamed SO FAR. The live block was made with ''
   * and its button copied that '' for as long as the page was being written. */
  function thinkingNode(text, ms) {
    const wordsNow = () => String((typeof text === 'function' ? text() : text) || '');
    const details = document.createElement('details');
    details.className = 'thinking';
    const summary = document.createElement('summary');
    /* M40: how long it weighed, like SillyTavern's "thought for 12s" */
    const took = thinkingWords(ms);
    summary.innerHTML = '<span class="thinking-arrow" aria-hidden="true">▸</span> what the storyteller weighed' + (took ? ' — thought for <span class="thinking-took">' + took + '</span>' : '');
    const body = document.createElement('div');
    body.className = 'thinking-body';
    body.textContent = typeof text === 'function' ? '' : text;
    /* M105: the thought can be taken away in one tap */
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'text-btn thinking-copy';
    copy.textContent = 'Copy the thinking';
    copy.addEventListener('click', async (e) => {
      e.preventDefault();
      try { await navigator.clipboard.writeText(wordsNow()); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy the thinking'; }, 1500); } catch (err) { copy.textContent = 'Couldn’t copy'; }
    });
    details.append(summary, body, copy);
    return details;
  }

  /* M301: THE THINKING OF A TELLING THAT LEFT NO PAGE IS KEPT. A telling
   * stopped by hand while the storyteller was still thinking (or one the wire
   * dropped there) had no prose, so nothing was saved and the pending node —
   * the thinking with it — was taken off the page. It is kept now: one row a
   * tale (`cutThinking:<tale>` — it rides the tale's book and goes with the
   * tale), drawn where it was being written, whole, with its copy button, and
   * let go when the next page lands (that page carries its own thinking).
   * It is not a page: no reader, no history, no request ever holds it. */
  const CUT_KEY = 'cutThinking:';
  function cutThinkingNode(cut, open) {
    const article = document.createElement('article');
    article.className = 'msg msg-note kept-thinking';
    article.dataset.cut = String(cut.ts);
    const label = document.createElement('div');
    label.className = 'msg-label lbl';
    label.textContent = 'the storyteller — ' + (cut.why === 'stopped' ? 'stopped while thinking'
      : cut.why === 'dropped' ? 'the wire dropped while it was thinking' : 'it thought and wrote nothing') + '; no page was written';
    const details = thinkingNode(cut.text, cut.ms);
    details.open = open === true;
    article.append(label, details);
    return article;
  }
  /* where it belongs: after the page it followed; at the tail when that page
   * has gone; nowhere when that page is above the drawn window (M136) */
  function placeCutThinking(cut, { showThinking, visible, open = false }) {
    const old = els.thread.querySelector('.kept-thinking');
    if (!cut || typeof cut.text !== 'string' || !cut.text.trim() || showThinking === false) { if (old) old.remove(); return; }
    if (old && old.dataset.cut === String(cut.ts)) return;
    if (old) old.remove();
    const node = cutThinkingNode(cut, open);
    const anchor = cut.afterId ? [...els.thread.querySelectorAll('.msg[data-id]')].find((n) => n.dataset.id === String(cut.afterId)) || null : null;
    if (anchor) { anchor.after(node); return; }
    if (cut.afterId && Array.isArray(visible) && visible.some((m) => m.id === cut.afterId)) return;
    els.thread.appendChild(node);
  }
  async function keepCutThinking(story, pending, { text, ms, why, showThinking }) {
    const visible = (await db.messages.list(story.id)).filter((m) => m && !m.hidden);
    const cut = { text, ms: Number.isFinite(ms) && ms > 0 ? ms : undefined, why, ts: Date.now(), afterId: visible.length ? visible[visible.length - 1].id : null };
    await db.settings.set(CUT_KEY + story.id, cut);
    if (pending && pending.isConnected) pending.remove();
    const now = await activeStory();
    if (now && now.id === story.id) placeCutThinking(cut, { showThinking, visible, open: true });
  }
  async function clearCutThinking(storyId) {
    if ((await db.settings.get(CUT_KEY + storyId)) !== undefined) await db.settings.delete(CUT_KEY + storyId);
    const now = await activeStory();
    const node = els.thread.querySelector('.kept-thinking');
    if (node && now && now.id === storyId) node.remove();
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
      /* M574 (the audit): only a web address opens — a source the provider handed back as "javascript:…" would have run in
       * the tavern's own page, where his connections and their keys live */
      if (!s || typeof s.url !== 'string' || !/^https?:\/\//i.test(s.url.trim())) continue;
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.className = 'sources-link';
      link.href = s.url.trim();
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
    if (msg.role === 'assistant' && !msg.ooc) acts.push('read again'); /* M113: the readers, by hand, for this page */
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
        /* M162: a page whose dressing will not render is still a page. This
         * was bare, and renderThread calls msgNode in a plain loop — one
         * unrenderable page threw and the whole room came up empty. */
        try {
          body.appendChild(renderHtmlProse(shown));
        } catch (err) {
          for (const part of parseScene(pageText(msg))) {
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
    /* M85: the voices the world agent heard elsewhere ride the page as data
     * (msg.voices). M97: they are READ in the ledger drawer ("Voices,
     * elsewhere"), never drawn on the scene — the page is the scene, and the
     * writer wants it whole. voicesNode stays for the drawer's dress. */
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

  /* M545: WHY A PAGE CAME BACK EMPTY, IN THE PROVIDER'S OWN WORD. His storyteller thought to the end ("…let's write") and
   * the house said only "The storyteller went quiet — nothing came back": every empty page got the same words, though the
   * provider says why it stopped. Out of room (length / max_tokens: the thinking spent the whole room before the page could
   * begin), blocked by the provider's filter, an answer ended with nothing in it, or a connection that closed with no stop
   * reason at all — each is named, and the page is never asked for again by itself: "Ask again" is his. */
  function emptyPageWhy(finish, thoughtText, movedByHouse = '') {
    const why = typeof finish === 'string' ? finish.trim() : '';
    const thought = typeof thoughtText === 'string' && thoughtText.trim().length > 0;
    /* M591: "Nothing was cut by the house" was said even when the house had moved every word into the thinking box (no
     * scene header ever came, and his setting reads words before the header as thinking). Said as it is now. */
    if (typeof movedByHouse === 'string' && movedByHouse.trim()) {
      return 'Everything the storyteller wrote came before any scene header, so it went into the thinking box (Settings: “Anything written before the header is thinking, not page”) — there was no page after it. Ask again when you like.';
    }
    if (/max_tokens|length/i.test(why)) {
      return thought
        ? 'The storyteller used all of its room thinking and had none left to write the page — the provider stopped it for length. A larger Max tokens on this connection, or less thinking, gives the page room. Ask again when you like.'
        : 'The provider stopped the answer for length before any page came — the room on this connection is too small for a page. Ask again when you like.';
    }
    if (/content_filter|safety|blocked|prohibited|refus|recitation|spii|policy/i.test(why)) return 'The provider blocked the page' + (thought ? ' after the thinking' : '') + ' (its reason: ' + why + '). Nothing was cut by the house. Ask again when you like.';
    if (why) return 'The provider ended its answer' + (thought ? ' after the thinking' : '') + ' with no page in it (its reason: ' + why + '). Nothing was cut by the house. Ask again when you like.';
    return 'The connection closed' + (thought ? ' after the thinking' : '') + ' before the page came — the provider gave no reason. Ask again when you like.';
  }

  /* B9: an empty completion gets a kind note AND a way to ask again. */
  function retryNoteNode(text, retry) {
    const article = noteNode(text);
    article.classList.add('msg-retry'); /* M669: found again, and cleared, when a new telling begins */
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'msg-act retry';
    btn.textContent = 'Ask again';
    /* M302: the note has said its piece once it is answered — it used to stay
     * on the page, between the writer's words and the answer that then came */
    btn.addEventListener('click', () => { if (busy) return; article.remove(); retry(); });
    article.appendChild(btn);
    return article;
  }

  /* B18: the thread re-renders incrementally — when pages have only been
   * ADDED to what is already on screen, the new ones simply append. A
   * structural change (another story, an edit, a swipe, a delete, a
   * thinking-voice toggle) rebuilds. */
  let structuralRenderToken = 0;
  const shownExtra = new Map(); /* M136: per story, how many more turns the writer asked to see */
  const shownFrom = new Map(); /* M136: per story, the index of the first drawn page */
  /* M200: WHERE THE READER WAS. A structural rebuild empties the thread and
   * builds it again, and every one of them then jumped — to the bottom by
   * intent, and in practice often to the TOP, because scrollToBottom runs
   * before the new pages have laid out and scrollHeight is still the old
   * small number. So mending a page, a swipe, a worker's write-back, an
   * audit, any of them threw the reader out of the scene they were reading
   * and made them scroll back down to find out whether it had finished.
   * A rebuild keeps the reader's place: the page that was under the top of
   * the viewport goes back under the top of the viewport. Only an OPENING
   * lands at the latest page, and only a reader already at the tail is
   * carried down with it. */
  function markPlace() {
    const t = els.thread;
    if (!t) return null;
    const top = t.getBoundingClientRect().top;
    for (const node of t.querySelectorAll('.msg')) {
      const box = node.getBoundingClientRect();
      if (box.bottom > top + 4) return { id: node.dataset.id, offset: box.top - top };
    }
    return null;
  }

  function returnToPlace(place) {
    const t = els.thread;
    if (!t || !place || !place.id) return false;
    const node = t.querySelector('.msg[data-id="' + CSS.escape(place.id) + '"]');
    if (!node) return false;
    const top = t.getBoundingClientRect().top;
    t.scrollTop += (node.getBoundingClientRect().top - top) - place.offset;
    return true;
  }

  /* M429: A PAGE HE IS RE-INKING IS NEVER REDRAWN AWAY. A whole-thread redraw that comes while his editor is open on a
   * page (a housekeeper card landing with its re-inks, a live sync from his other browser, a shelf change) would have
   * thrown the editor and his words away. It waits, and runs the moment the editor closes (his words kept or let go).
   * Opening a story is his own move away from the page, and is never held. */
  let threadRedrawOwed = null;
  /* M675: ONLY THE NEWEST PAGE WEARS THE NEWEST PAGE'S CONTROLS. "go on", and a swipe bar on a page with one telling
   * ("◂ 1 / 1 ▸" — there to write a second), belong to the last storyteller page. A page that LANDED was drawn with
   * them, and the page that had been last kept its own: through a sitting every page he read went on wearing "go on"
   * and "◂ 1 / 1 ▸" (measured in the walk: three pages, three of each) until the tale was next opened. Clutter under
   * every page — and a stray tap on such a ▸ told an OLD page again and folded the ledger back to it. Found while
   * walking M675's own scenario (two ◂ in a thread that should have had one). A page with more than one telling keeps
   * its bar, as the rule (swipeNode) always said. */
  function settleLastPageControls() {
    const pages = [...els.thread.querySelectorAll('.msg-assistant[data-id]')];
    const last = pages[pages.length - 1];
    for (const node of pages) {
      if (node === last) continue;
      for (const btn of node.querySelectorAll('.msg-actions .msg-act[data-act="go on"]')) btn.remove();
      for (const bar of node.querySelectorAll('.swipe-bar')) {
        const count = bar.querySelector('.swipe-count');
        if (count && /^\s*1\s*\/\s*1\s*$/.test(count.textContent)) bar.remove();
      }
    }
  }

  /* M483: THE PAGE'S NUMBER, WHEREVER THE NODE IS BUILT. renderThread stamps every node it draws (M466); the two other
   * builders — a page redrawn in place after a worker re-inked it, and the page that just LANDED in place of its pending
   * node — built nodes without a number, so the newest page was invisible to the page mark and the end of a tale read
   * "18 of 19" until the next full redraw. One counter, from the tale's own list. */
  function numberPage(node, msg, history) {
    if (!node || !msg) return node;
    const list = Array.isArray(history) ? history.filter((m) => m && !m.hidden) : [];
    let n = 0; let found = 0;
    for (const m of list) { if (m.role === 'assistant') { n += 1; if (m.id === msg.id) found = n; } }
    if (msg.role === 'assistant' && found) node.dataset.page = String(found); else delete node.dataset.page;
    if (n) els.thread.dataset.pages = String(n);
    return node;
  }

  async function renderThread({ structural = false, opening = false } = {}) {
    drawChoices(); /* M548: another tale, or none — its own choices or none */
    if (!opening && els.thread.querySelector('textarea.edit-box')) {
      threadRedrawOwed = { structural: Boolean(structural || (threadRedrawOwed && threadRedrawOwed.structural)) };
      return;
    }
    threadRedrawOwed = null;
    const place = structural ? markPlace() : null;
    const wasAtTail = nearBottom();
    const story = await activeStory();
    const showThinking = (await db.settings.get('showThinking')) !== false;
    const turnsShownSetting = Number(await db.settings.get('turnsShown')); /* M136 */
    const mastheadOn = (await db.settings.get('masthead')) !== false;
    const connections = els.noConnection ? await db.connections.list() : [];
    const cutThinking = story ? await db.settings.get(CUT_KEY + story.id) : null; /* M301 */
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
    /* M466: every storyteller page knows its number (1 = the first page of the tale), for the page mark at the
     * thread's edge — counted over the WHOLE tale, so the number never changes with how many turns are on screen */
    const pageOf = [];
    let pageCount = 0;
    for (const m of visible) pageOf.push(m.role === 'assistant' ? (pageCount += 1) : 0);
    els.thread.dataset.pages = String(pageCount);
    const stampPage = (node, i) => { if (pageOf[i]) node.dataset.page = String(pageOf[i]); else delete node.dataset.page; return node; };
    const canAppend = !structural
      && lastRender.storyId === story.id
      && lastRender.showThinking === showThinking
      && lastRender.ids.length <= ids.length
      && lastRender.ids.every((id, i) => id === ids[i]);

    if (!canAppend) {
      els.thread.textContent = '';
      /* M14: a story with no pages yet still gets the hearth, not a void. */
      if (!visible.length) showHearth(false);
      /* M136: TURNS ON SCREEN. Like SillyTavern's message count: only the
       * latest N turns are drawn (Settings → The house → "Turns on screen",
       * 30 by default); a quiet button above them shows thirty more each
       * press. Everything else stays in the store untouched; appends still
       * land at the tail. Replaces M114's chunked full render. */
      const turnsShown = Number.isFinite(turnsShownSetting) && turnsShownSetting > 0 ? turnsShownSetting : 30;
      const extra = shownExtra.get(story.id) || 0;
      const limit = (turnsShown + extra) * 2;
      const first = visible.length > limit ? visible.length - limit : 0;
      shownFrom.set(story.id, first);
      if (first > 0) {
        const more = document.createElement('button');
        more.type = 'button';
        more.id = 'show-earlier';
        more.className = 'text-btn show-earlier';
        const hidden = Math.ceil(first / 2);
        more.textContent = 'Show ' + Math.min(30, hidden) + ' earlier ' + (Math.min(30, hidden) === 1 ? 'turn' : 'turns') + ' (' + hidden + ' above)';
        more.addEventListener('click', () => { shownExtra.set(story.id, (shownExtra.get(story.id) || 0) + 30); renderThread({ structural: true }); });
        els.thread.appendChild(more);
      }
      for (let i = first; i < visible.length; i += 1) {
        const msg = visible[i];
        els.thread.appendChild(stampPage(msgNode(msg, showThinking, { isLastAssistant: msg.id === lastAssistantId, mastheadOn }), i));
      }
    } else {
      /* Pages arriving onto a hearth-warmed room: the hearth steps aside. */
      if (visible.length && lastRender.ids.length === 0) hideHearth();
      for (let i = lastRender.ids.length; i < visible.length; i += 1) {
        const msg = visible[i];
        const node = stampPage(msgNode(msg, showThinking, { isLastAssistant: msg.id === lastAssistantId, mastheadOn }), i);
        node.classList.add('fresh'); /* M138: only a page that just arrived rises */
        els.thread.appendChild(node);
      }
      /* A new last assistant page: the "go on" affordance moves with it (M675: and the lone swipe bar — one rule, below). */
      if (lastRender.ids.length !== ids.length) settleLastPageControls();
    }
    lastRender = { storyId: story.id, ids, showThinking };
    placeCutThinking(cutThinking, { showThinking, visible }); /* M301: the thinking of a telling that left no page */
    /* M22-E3: opening a story lands at the latest page; a quiet append while
     * you're reading above the tail never drags you down — the jump pill
     * offers the way back instead.
     * M200: and a structural REBUILD keeps the reader where they were, after
     * the new pages have laid out — never before, or scrollHeight is still
     * the old number and the thread lands at the top. */
    if (opening || (!structural && nearBottom())) {
      scrollToBottom();
    } else if (structural) {
      const settle = () => {
        if (wasAtTail) { scrollToBottom(); return; }
        if (!returnToPlace(place)) scrollToBottom();
      };
      requestAnimationFrame(() => { settle(); requestAnimationFrame(settle); });
    }
    updateJump();
    refreshEmber();
    refreshQuickSwitch(); /* M510 */
    if (opening) planAhead(); /* M510: a tale told by a small model has its plan before the first send */
    markLedgerTrouble(story.id);   /* M250 */
    /* M330: once for each tale a session: the house's own notes are taken back out of its record (nobody's hand needed) */
    if (!healedNotes.has(story.id)) { healedNotes.add(story.id); takeBackHouseNotes(story).then(() => putBackAgainstBrief(story)); }
    healInterruptedBranches(); /* M332: once per load */
    if (!healedFuture.has(story.id)) { healedFuture.add(story.id); takeOutTheFuture(story); } /* M337 */
    drawChoices(); /* M548 */
  }

  /* Re-render one page in place (an edit, a swipe, a worker's write-back). */
  /* M675 (the second reading) — WHAT HE IS TYPING IS NEVER DRAWN OVER. A page drawn again takes its node's place — and
   * with it an editor standing open on that page, and whatever he had typed in it. A whole redraw has waited for an
   * open editor since M429; this door did not: a reader writing back to the page he was correcting, or (new in M675)
   * the redraw of the newest page when another page is let go, took the editor away mid-word. A page whose editor
   * is open is left as it stands; the editor draws the page again itself when it closes (kept or not), from the
   * store as it is then — so nothing a reader wrote meanwhile is lost to the eye.
   * WHILE THE PAGE SHOWS THE TELLING THE EDITOR WAS OPENED ON (its place in the page's list: `openedIdx` — tellings are
   * only ever added at the end). A reader's notes, a mend of those very words, another page let go: the editor
   * stands, and what he keeps is written over the page as it then is (beginEdit). When ANOTHER telling of the page
   * is shown — he asked for one with ▸ or “try again”, or walked to one, with the editor still open — the page is
   * drawn again as it always was and the editor goes: left standing, it showed one telling's words over a page that
   * holds another (found reading this very change back: the editor came out from under the telling that had just
   * landed, and “Keep the new words” wrote the old telling, and the list of versions as it stood when the editor
   * opened, over the new one). */
  async function rerenderMessage(storyId, messageId, { fromItsEditor = false } = {}) {
    const story = await activeStory();
    if (!story || story.id !== storyId) return;
    const history = await db.messages.list(storyId);
    const msg = history.find((m) => m.id === messageId);
    const node = els.thread.querySelector('.msg[data-id="' + cssId((messageId)) + '"]');
    if (!msg || msg.hidden) {
      if (node) node.remove();
      return;
    }
    { const open = node && !fromItsEditor ? node.querySelector('.edit-box') : null; if (open && open.openedIdx === shownIndex(msg)) return; }
    const showThinking = (await db.settings.get('showThinking')) !== false;
    /* M160: the masthead switch is read here too. Without it, msgNode's
     * default ("on unless told otherwise") put the header line back on every
     * page a worker re-inked — the extractor's masthead write does exactly
     * that on every turn — so switching the masthead off lasted until the
     * next page landed. */
    const mastheadOn = (await db.settings.get('masthead')) !== false;
    const lastAssistant = [...history].reverse().find((m) => m && !m.hidden && m.role === 'assistant');
    const fresh = msgNode(msg, showThinking, {
      isLastAssistant: lastAssistant ? lastAssistant.id === messageId : false,
      mastheadOn,
    });
    numberPage(fresh, msg, history); /* M483: a page redrawn in place keeps its number */
    if (node) node.replaceWith(fresh);
    else {
      /* M136: a page above the drawn window stays off screen — never appended at the tail */
      const vis = history.filter((m) => m && !m.hidden);
      const at = vis.findIndex((m) => m.id === messageId);
      const from = shownFrom.get(storyId) || 0;
      if (at !== -1 && at >= from) els.thread.appendChild(fresh);
    }
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
    const size = roomOf(connection); /* M343; M285: the provider's room when none is set */
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
    let found = null;
    if (story && typeof story.connectionId === 'string' && story.connectionId) {
      found = all.find((c) => c.id === story.connectionId) || null;
    }
    if (!found) {
      const wanted = await db.settings.get('activeConnectionId');
      found = all.find((c) => c.id === wanted) || all[0] || null;
    }
    if (found) learnContext(found).catch(() => {}); /* M289: its room, asked of the provider in the background */
    return found;
  }

  /* M264: the room the storyteller's context leaves the record — the same
   * measure the send path uses, for the keeper deciding whether to squeeze */
  const warnedRecordFull = new Set(); /* M265: said once a session for each tale */
  const mendsChecked = new Set(); /* M268: mistaken mends are looked for once a session for each tale */
  async function recordRoomFor(story) {
    try {
      const conn = await resolveConnection(story);
      const mem = await loadMemory(story.id);
      const win = windowFor(mem, await db.settings.get('memoryWindow')); /* M317 */
      const pages = visiblePages(await db.messages.list(story.id));
      const windowTokens = pages.slice(-win).reduce((n, m) => n + estimateTokens(pageText(m)), 0);
      /* M287: the keeper folds against the same measured room the storyteller has — the last page's receipt */
      const lastSent = [...(await db.messages.list(story.id))].reverse().find((m) => m && m.receipt && m.receipt.totalTokens > 0);
      const fixedChars = fixedCharsOf(lastSent && lastSent.receipt);
      return recordRoom({ contextTokens: roomOf(conn), maxTokens: conn && conn.maxTokens, windowTokens, fixedChars });
    } catch (err) { return undefined; }
  }

  /* M3: the workers may use a connection of their own (Settings → The
   * workers); by default they borrow the one telling the story. */
  async function resolveWorkerConnection(story, worker) {
    /* M17: a worker may have hands of its own (Settings → The workers). */
    const map = (await db.settings.get('workerConnections')) || {};
    const legacy = await db.settings.get('workerConnectionId');
    const all = await db.connections.list();
    const picked = pickWorkerConnection({ map, legacy, connections: all }, worker);
    if (picked) { learnContext(picked).catch(() => {}); return picked; } /* M289 */
    return resolveConnection(story);
  }

  /* M548: CHOICES MATTER (agents/choices.js). OFFER: after a page lands, a helper that cannot know which he will pick seals the
   * choices of a turning point onto the page itself — outside the page chain, so no send ever waits for it, and written only
   * if the page is still the newest, at the same version, with no move of his after it and the switch still on. A quiet page
   * is kept as {turning:false}, so it is asked once. A fight under way is the referee's: nothing is offered then. */
  const choicesAsking = new Map(); /* story id → the page and version being asked about */
  async function offerChoices(storyIn) {
    const sid = storyIn && storyIn.id;
    if (!sid) return;
    let key = '';
    try {
      const story = await db.stories.get(sid);
      if (!choicesOn(story)) return;
      const told = visiblePages(await db.messages.list(sid)).filter((m) => m && !m.hidden && !m.ooc);
      const last = told[told.length - 1];
      /* M552 (the audit): a page he stopped mid-way ends nowhere — no turning point is read into half a page */
      if (!last || last.role !== 'assistant' || last.stopped || !pageText(last).trim() || offerOf(last)) return;
      /* M552 (the audit): the page is claimed BEFORE any wait — two callers at once (a page landing and a story opening) both
       * passed the check while the other was still reading the ledger, and the helper was asked twice */
      if (choicesAsking.get(sid) === last.id + ':' + versionOf(last)) return;
      key = last.id + ':' + versionOf(last);
      choicesAsking.set(sid, key);
      const state = await loadState(sid);
      if ((state.duel && state.duel.active) || (state.battle && state.battle.active) || (state.war && state.war.active)) return;
      const connection = await resolveWorkerConnection(story, 'choices');
      if (!connection) return;
      const big = 400000;
      const recentText = told.slice(-3).map((m) => pageText(m));
      const facts = planFacts(state, { ...planStateView(big), scenePages: recentText });
      const people = (planPeople(state, { recentPages: recentText, rotation: told.length, view: planPeopleView(big), brief: String(story.brief || '') + '\n' + String(story.castNotes || '') }) || {}).text || '';
      const essentials = ((await loadEssentials(sid)) || {}).text || '';
      const before = lastPagesOf(told.slice(0, -1), CHOICE_PAGES).map((m) => (m.role === 'user' ? 'The writer: ' : '') + pageText(m));
      const ask = choiceAsk({ brief: story.brief || '', essentials, facts, people, pages: before, newest: pageText(last), mc: mcName(state), echoes: echoLines(told) });
      const w = workerSignal(); /* every helper's own ceiling: a call that hangs is let go, never waited on */
      let read = null;
      try { read = await makeChoices({ connection, ask, signal: w.signal }); } finally { w.done(); }
      if (!read) return;
      const now = await db.stories.get(sid);
      if (!choicesOn(now)) return;
      const fresh = visiblePages(await db.messages.list(sid)).filter((m) => m && !m.hidden && !m.ooc);
      const tail = fresh[fresh.length - 1];
      if (!tail || tail.id !== last.id || versionOf(tail) !== versionOf(last) || offerOf(tail)) return;
      await db.messages.update(sid, last.id, offerPatch(tail, { ...read, at: Date.now() }));
      if (ctx.getActiveStoryId() === sid) drawChoices();
    } catch (err) { /* a choice is never worth a page */ } finally {
      if (key && choicesAsking.get(sid) === key) choicesAsking.delete(sid);
    }
  }
  /* M636: THE SENSORS READ THE PAGE THAT JUST LANDED (agents/sensors.js) — outside the page chain, so no helper and no
   * send ever waits for it. The checker is handed the request the page was written from (js/sent.js; else the brief and
   * the pages before it) and then the page; its answers are numbers, kept ON the page under the version read — written
   * only if that page still stands as it was read. Off: nothing is asked. */
  const sensing = new Map();
  /* one reading at a time for a story: pages that landed in quick succession are read one after the other, never at once */
  const senseTail = new Map();
  function queueSense(story, pageId) {
    const sid = story && story.id;
    if (!sid) return;
    const next = (senseTail.get(sid) || Promise.resolve()).then(() => sensePage(story, pageId)).catch(() => { /* never worth a page */ });
    senseTail.set(sid, next);
  }
  /* the page that landed (by its id) — still read when he has already played on; with no id, the newest page.
   * M638: EVERY TRY SAYS WHAT HAPPENED, in one plain sentence on the workers' line (sensors.js readingWords) — that the
   * page was read, by which model, and what it saw; or that it was not, and why — and hands it back, so Settings'
   * "Check the sensors" can say it at once. `check`: the page is read NOW whatever stands (a reading already there is
   * taken again; with the switch off nothing is kept — Off keeps nothing). */
  async function sensePage(storyIn, pageId, { check = false } = {}) {
    const sid = storyIn && storyIn.id;
    if (!sid) return null;
    let key = '';
    try {
      const on = (await db.settings.get('sensorsOn')) === true;
      if (!on && !check) return null;
      const story = await db.stories.get(sid);
      if (!story) return null;
      const all = visiblePages(await db.messages.list(sid)).filter((m) => m && !m.hidden && !m.ooc);
      const at = pageId ? all.findIndex((m) => m.id === pageId) : all.map((m) => m.role).lastIndexOf('assistant');
      const last = at >= 0 ? all[at] : null;
      if (!last || last.role !== 'assistant' || !pageText(last).trim() || (last.stopped && !check)) return null;
      const words = pageText(last);
      if (!check) {
        if (senseOf(last, versionOf(last), words)) return null; /* this version, these words: read already */
        if (sensing.get(sid) === last.id + ':' + versionOf(last)) return null;
        key = last.id + ':' + versionOf(last);
        sensing.set(sid, key);
      }
      const what = 'page ' + all.slice(0, at + 1).filter((m) => m.role === 'assistant').length;
      const connection = await resolveWorkerConnection(story, 'sensors');
      const rec = last.receipt && last.receipt.sentId ? await loadSent(last.receipt.sentId) : null;
      const kept = rec && Array.isArray(rec.requests) && rec.requests[0] ? rec.requests[0].body : null;
      const before = all.slice(Math.max(0, at - 12), at).map((m) => ({ who: m.role === 'user' ? 'writer' : 'teller', text: pageText(m) }));
      const mc = mcName(await loadState(sid));
      const w = workerSignal(); /* every helper's own ceiling: a call that hangs is let go, never waited on */
      let read = null;
      try { read = await readPageFull({ connection, kept, brief: story.brief || '', castNotes: story.castNotes || '', before, page: words, mc, signal: w.signal }); } finally { w.done(); }
      const said = readingWords(read, what);
      /* M640: what the address showed it takes in is kept for this model at this address — the next page is cut to it at once */
      if (read.learnedRoom && connection && connection.id) {
        try { await db.connections.update(connection.id, { sensesRoom: read.learnedRoom, sensesRoomFor: String(connection.model || '').trim() + '@' + String(connection.baseUrl || '').trim().replace(/\/+$/, '') }); } catch (err) { /* it is learned again on the next page */ }
      }
      if (read.ok && on) {
        const fresh = (await db.messages.list(sid)).find((m) => m && m.id === last.id);
        /* written only if the page still stands as it was read */
        if (fresh && !fresh.hidden && versionOf(fresh) === versionOf(last) && pageText(fresh) === words) await db.messages.update(sid, last.id, sensePatch(fresh, versionOf(fresh), words, read.scores));
      }
      /* a reading that failed is said as plainly as one that worked — on the workers' line, as the benchmark's judge says
       * "could not grade": the ledger's light is the ledger's, and a checker that is down is not a ledger out of step */
      await noteWorkerRun(sid, 'sensors', { ok: true, detail: said });
      return { ...read, words: said };
    } catch (err) { return null; } finally {
      if (key && sensing.get(sid) === key) sensing.delete(sid);
    }
  }
  /* M638: "CHECK THE SENSORS" (Settings → The readers → The sensors) — his question: "how can I know the sensor, especially
   * Clef, is working?" The newest page of the story in hand is read now by the sensors' model and the answer is one plain
   * sentence: it works (which model, how fast, how much a decisions address took in, what it saw), or it does not, and
   * the real reason. With no story open, or no page yet, a sample page is read instead. */
  async function checkSensors() {
    try {
      const story = await activeStory();
      if (story) {
        const told = await sensePage(story, null, { check: true });
        if (told && told.words) return told.words;
      }
      const connection = await resolveWorkerConnection(story || null, 'sensors');
      const w = workerSignal();
      let read = null;
      try { read = await readPageFull({ connection, ...SAMPLE_READ, signal: w.signal }); } finally { w.done(); }
      return readingWords(read, 'a sample page');
    } catch (err) {
      return 'Not working — the check itself failed: ' + String((err && err.message) || err) + '.';
    }
  }
  /* M549: HIS EDIT OF A PAGE WHOSE CHOICES STILL STAND OPEN — they were sealed for the page as it read; it reads otherwise
   * now, so they are let go and sealed again for it. A page whose choice he already took keeps its offer (the seal is on
   * his move; the paths taken stay in the flowchart). */
  async function choicesAfterEdit(story, pageId) {
    try {
      const open = openOffer(await db.messages.list(story.id));
      if (!open || open.page.id !== pageId) return;
      const next = { ...(open.page.choiceOffer || {}) };
      delete next[String(versionOf(open.page))];
      await db.messages.update(story.id, pageId, { choiceOffer: next });
      await drawChoices();
      offerChoices(story);
    } catch (err) { /* never worth a page */ }
  }
  /* DRAW: only their names, above where he types — on the newest page of the story, with no move of his after it, while
   * nothing is being told; everything else hides them */
  let drawingChoices = 0;
  async function drawChoices() {
    const row = els.choiceRow;
    if (!row) return;
    const ticket = (drawingChoices += 1);
    const hide = () => { if (ticket === drawingChoices) { row.hidden = true; row.textContent = ''; } };
    try {
      if (busy) return hide();
      const story = await activeStory();
      if (!story || !choicesOn(story)) return hide();
      const open = openOffer(await db.messages.list(story.id));
      if (ticket !== drawingChoices) return;
      if (!open || busy) return hide();
      row.textContent = '';
      open.offer.options.forEach((o, k) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'choice-btn';
        b.textContent = o.label;
        b.addEventListener('click', () => { takeChoice(open.page, k); });
        row.appendChild(b);
      });
      row.hidden = false;
    } catch (err) { hide(); }
  }
  /* TAKE: its move goes as his, the seal kept on his message; his own words in the composer stay where they are */
  let takingChoice = false; /* M552 (the audit): a double tap on a phone sent the move twice */
  async function takeChoice(page, pick) {
    if (takingChoice) return;
    if (busy) { toast('The storyteller is still busy — one moment.'); return; }
    takingChoice = true;
    if (els.choiceRow) els.choiceRow.hidden = true;
    try { await takeChoiceNow(page, pick); } finally { takingChoice = false; drawChoices(); }
  }
  async function takeChoiceNow(page, pick) {
    const story = await activeStory();
    if (!story || !choicesOn(story)) { drawChoices(); return; }
    const open = openOffer(await db.messages.list(story.id));
    if (!open || open.page.id !== page.id || versionOf(open.page) !== versionOf(page)) { drawChoices(); return; }
    const taken = takenRecord(open.page, open.offer, pick);
    if (!taken) return;
    const draft = els.input.value;
    await send(taken.move, { choiceTaken: taken });
    if (draft && !els.input.value) els.input.value = draft;
  }

  /* M547: THE SMART RECALL'S QUESTION (M510-50), asked for any storyteller — never throws; [] when it is off, when the
   * essentials are not made or are made over more pages than the record now covers (M527: pages taken back), when the
   * record is empty, or when the worker is slow, failing or unsure. Kept out of its index: the lines the request will
   * carry word for word anyway — the newest of the record for a frontier storyteller (M510-50); for a small one, the
   * lines since the essentials and the newest with the people here (assemble/stack.js smallRecordWhole). */
  async function smartRecallFor({ story, history, userText, state, small = false }) {
    try {
      if ((await db.settings.get('smartRecall')) === false) return [];
      const essentials = await loadEssentials(story.id);
      if (!essentials || typeof essentials.text !== 'string' || !essentials.text.trim()) return [];
      const mem = await loadMemory(story.id);
      const nodes = mem && Array.isArray(mem.nodes) ? mem.nodes : [];
      if (!nodes.length) return [];
      if (Number.isFinite(essentials.upTo)) {
        const covered = nodes.filter((n) => n && !n.empty && Array.isArray(n.span)).reduce((mx, n) => Math.max(mx, n.span[1] + 1), 0);
        if (essentials.upTo >= covered) return [];
      }
      const pickConn = await resolveWorkerConnection(story, 'recall');
      let skip;
      if (small) {
        const whole = smallRecordWhole(nodes, essentials, state);
        skip = (n) => whole.has(n);
      } else {
        const byAge = [...nodes].filter((n) => n && typeof n.text === 'string' && Array.isArray(n.span)).sort((a, b) => b.span[0] - a.span[0]);
        const newest = new Set(); let room = HYBRID_RECENT_CHARS;
        for (const n of byAge) { room -= n.text.length + 3; if (room < 0) break; newest.add(n.id); }
        skip = (n) => newest.has(n.id);
      }
      const lastA = [...(Array.isArray(history) ? history : [])].reverse().find((m) => m && m.role === 'assistant' && !m.hidden);
      const out = await pickRecall({ connection: pickConn, essentials: essentials.text, nodes, move: userText, lastPage: lastA ? pageText(lastA) : '', mc: mcName(state), skip });
      return Array.isArray(out && out.ids) ? out.ids : [];
    } catch (err) { return []; }
  }

  /* Refresh the receipt affordance on a message already on the page, so
   * late-arriving worker notes (extraction, drift findings) can speak. */
  function refreshReceiptNode(msg) {
    const node = els.thread.querySelector('.msg[data-id="' + cssId((msg.id)) + '"]');
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

  /* M203: a banner that was begun must always be finished. These hand their
   * work to the background chain and return at once, so the banner follows
   * the chain instead of the call: when the story's tracked work is done, it
   * says so. An early return finishes it too — a banner left spinning over
   * nothing is worse than no banner. */

  /* M210: a stop just stops. There is no mark to clear any more — Rebuild
   * always starts from the first page (agents/rebuild.js), so the writer
   * never has to reason about what the last run did. */
  function stoppedByHand(storyId) {
    if (storyId) stopWork(storyId);
  }



  /* M675 — A BANNER BEGUN IS A BANNER ENDED. Four actions end their banner INSIDE their job, where the job knows how far it
   * got ("Reading these pages again", "Folding what is due", "Rebuilding the record", "Rebuilding the people") — and a
   * job that ended any other way said nothing: with the keeper's model not answering, "Fold again" on a record line was
   * asked six times over a minute by the queue and then gave up, and "Reading these pages again" stood on the screen,
   * its Stop beside it, until the page was loaded again. The queue's own answer is followed: a banner its job did not
   * end is ended here, with the reason the workers' line has. */
  function bannerEndsWith(banner, promise) {
    Promise.resolve(promise).then((out) => {
      if (!banner || !banner.open()) return; /* its job said its own last word */
      const why = out && out.ok === false ? out.why : (out && out.value && out.value.detail) || '';
      banner.failed(why ? 'It stopped — ' + why : 'It stopped — the workers’ line says why');
    }, () => { /* the queue never rejects */ });
  }
  async function bannerFollows(banner, story, words, promise) {
    if (!banner) return;
    if (!story) { banner.failed('Open a story first'); return; }
    try {
      /* M205: THE BANNER MUST NOT LIE. This waited on pendingWork, which
       * resolves "settled" whether the work SUCCEEDED OR FAILED — so an
       * auditor that could not reach its connection still ended with "The
       * ledger was audited" in front of the writer. The queue's own promise
       * carries {ok, why}; that is what decides what the banner says. */
      const outcome = promise ? await promise : null;
      if (outcome && outcome.ok === false) {
        banner.failed(outcome.why ? 'It stopped — ' + outcome.why : 'It stumbled — the workers’ line says why');
        return;
      }
      if (!promise) await pendingWork(story.id, 600000);
      banner.done(words);
    } catch (err) {
      banner.failed('It stumbled — the workers’ line says why');
    }
  }

  async function rescanLedger() {
    const banner = beginWork('Reading the pages again', (tale) => { const s = tale || ctx.getActiveStoryId(); if (s) stoppedByHand(s); banner.failed('Stopped — what was folded is kept; Rebuild starts again from page one'); });
    const story = await activeStory();
    if (!story) { banner.failed('Open a story first'); return false; }
    const pages = (await db.messages.list(story.id)).filter((m) => !m.hidden);
    const last = [...pages].reverse().find((m) => m.role === 'assistant');
    if (!last) { banner.failed('No page to read yet'); return false; }
    const before = pages.slice(0, pages.indexOf(last));
    const lastUser = [...before].reverse().find((m) => m && m.role === 'user');
    startBackgroundWork(story, last, lastUser ? pageText(lastUser) : '', { deep: true });
    banner.say('the workers are reading');
    bannerFollows(banner, story, 'The pages were read again');
    return true;
  }

  /* M45: found the world, by hand — from the brief, the cast notes, the
   * cards and the lore, regardless of the fingerprint. */
  async function foundNow() {
    const banner = beginWork('Founding the world from the brief', (tale) => { const s = tale || ctx.getActiveStoryId(); if (s) stoppedByHand(s); banner.failed('Stopped — what was folded is kept; Rebuild starts again from page one'); });
    const story = await activeStory();
    if (!story) { banner.failed('Open a story first'); return false; }
    const connection = await resolveWorkerConnection(story, 'founder');
    if (!connection) { banner.failed('The founder needs a connection first'); return false; }
    const promise = enqueueWork(story.id, { name: 'founder', run: async ({ signal, stale }) => {
      const cast = await castForStory(story);
      const lore = await loadLore(story.id);
      const result = await foundWorld({ connection, storyId: story.id, brief: story.brief || '', castNotes: story.castNotes || '', cast, lore, signal, stale, canonRecord: await canonRecordOf(story) }); /* M564: the real record it is told to write canon people from */
      return { silent: false, detail: founderRunWords(result), raw: result && result.raw };
    } });
    noteWork(story.id, promise);
    banner.say('reading the brief, the cast, the cards and the lore');
    bannerFollows(banner, story, 'The world was founded from the brief', promise);
    return true;
  }

  /* M52: the gradual rebuilds — six pages at a time from turn 0, Summaryception's way. */
  /* M216: one record line, folded again from its own pages — never the whole
   * record. Summaryception has had this per snippet for years. */
  async function redoRecordLine(nodeId, detailOnly) {
    const banner = beginWork(detailOnly ? 'Reading the detail again' : 'Reading these pages again',
      (tale) => { const s = tale || ctx.getActiveStoryId(); if (s) stoppedByHand(s); banner.failed('Stopped'); });
    const story = await activeStory();
    if (!story) { banner.failed('Open a story first'); return false; }
    const connection = await resolveWorkerConnection(story, 'keeper');
    if (!connection) { banner.failed('The keeper needs a connection first'); return false; }
    const promise = enqueueWork(story.id, { name: 'keeper', run: async ({ signal, renew }) => {
      const r = await redoLine({ connection, storyId: story.id, nodeId, detailOnly, signal, renew });
      if (!r || !r.ok) { banner.failed(r && r.why ? r.why : 'the keeper gave nothing back'); return { silent: true }; }
      banner.done(detailOnly ? 'The detail was written again' : 'That line was folded again');
      if (ctx.drawer && typeof ctx.drawer.onStoriesChanged === 'function') ctx.drawer.onStoriesChanged();
      return { silent: false, detail: detailOnly ? 'read one line’s detail again' : 'folded one line again' };
    } });
    noteWork(story.id, promise);
    bannerEndsWith(banner, promise); /* M675 */
    return true;
  }

  /* M218: FOLD EVERYTHING THAT IS DUE, NOW — Summaryception's "Force
   * Summarize Now", with the three guards it has. The keeper folds three
   * batches per finished page, so a writer who stopped a run, or switched the
   * keeper on partway through a long tale, was dozens of batches behind with
   * no way to catch up but playing turn after turn. This never wipes: it
   * fills the gaps and stops. */

  /* M248: THE HOUSE FINISHES WHAT IT STARTED. A long run that stops partway —
   * the keeper unreachable for three minutes, the writer asleep — used to sit
   * there until he noticed. On by default: when a run reports itself
   * unfinished, the house waits a little and carries on from where it
   * stopped, up to three times. Nothing already done is redone. Turn it off
   * and the amber "Finish it" button is there instead. */
  const autoFinish = new Map();   // storyId+action -> attempts made
  /* M607: A RUN HE STOPPED IS STOPPED. The record rebuild and Summarize now swallow their keeper's errors into a patient
   * ladder, so his Stop came back as a run "the keeper could not be reached" for — its banner said "carrying on shortly"
   * over his own "Stopped", and fifteen seconds later the house started it again (a Rebuild, from the first page, the
   * record let go once more), three times over. A run whose signal he stopped by hand is never finished by the house. */
  const stoppedRun = (signal) => Boolean(signal && signal.aborted && signal.reason && signal.reason.message === 'stopped by hand');
  async function maybeFinish(storyId, action, result) {
    if (!storyId || !action || !result || !result.stalled || result.stopped) return;
    if ((await db.settings.get('autoFinish')) === false) return;
    const key = storyId + ':' + action;
    const tried = autoFinish.get(key) || 0;
    if (tried >= 3) return;
    autoFinish.set(key, tried + 1);
    const again = { rebuildRecordNow, rebuildPeopleNow, summarizeNow };
    setTimeout(() => {
      if (ctx.getActiveStoryId() !== storyId) return;
      if (typeof again[action] === 'function') again[action]();
    }, 15000 * (tried + 1));
  }
  const clearFinishCount = (storyId, action) => autoFinish.delete(storyId + ':' + action);


  /* M250: A WORKER FAILING QUIETLY WHILE THE WRITER PLAYS ON. A worker that
   * stumbles is written to the workers' line in the LEDGER DRAWER — and
   * nowhere else. So a writer whose keeper connection had fallen over could
   * play four scenes without a word of it, while nothing of those pages was
   * being folded, and find out only when he happened to open the ledger. The
   * ledger button carries a quiet mark the moment a worker has stumbled twice
   * running, and drops it the moment one succeeds. Nothing interrupts the
   * scene; the mark is simply there, or it is not. */
  let ledgerMark = null;
  /* M507: THE LIGHT IS LOOKED AT ONCE PER BURST. Every worker's start and settle asked for the whole check — the worker
   * shelf, the pages, a clone of the ledger, the record, the settings — twenty times a page while the readers ran, and
   * each look was fifty milliseconds on his phone: a second of the main thread per page, felt as a stutter while he
   * read. A burst of changes is one look now, a quarter second after the last of them; a change that lands while a
   * look is under way books one more. The light's four truths are unchanged — only how often they are re-read. */
  const troubleLook = new Map(); /* storyId -> { timer, running, again } */
  function markLedgerTrouble(storyId) {
    if (!storyId) return Promise.resolve();
    let look = troubleLook.get(storyId);
    if (!look) { look = { timer: null, running: false, again: false }; troubleLook.set(storyId, look); }
    if (look.running) { look.again = true; return Promise.resolve(); }
    if (look.timer) return Promise.resolve();
    return new Promise((resolve) => {
      look.timer = setTimeout(async () => {
        look.timer = null;
        look.running = true;
        try { await markLedgerTroubleNow(storyId); } finally { look.running = false; }
        if (look.again) { look.again = false; markLedgerTrouble(storyId); }
        resolve();
      }, 250);
    });
  }
  async function markLedgerTroubleNow(storyId) {
    try {
      const btn = document.getElementById('btn-ledger');
      if (!btn || !storyId) return;
      const shelf = (await loadWorkerStatus(storyId)) || {};
      /* the workers whose silence costs the writer the story itself */
      const minders = ['keeper', 'extractor', 'scribe', 'world'];
      const sore = minders.filter((n) => shelf[n] && shelf[n].ok === false);
      const part = minders.filter((n) => shelf[n] && shelf[n].ok !== false && shelf[n].unfinished);

      /* M254: GREEN MEANS SOMETHING, or it means nothing at all. The writer
       * asked for it as reassurance he can trust — "I don't need to worry and
       * just continue the story" — so it is not "no errors seen lately". It
       * is every one of these, checked fresh:
       *   · every minder that has run, ran WELL
       *   · none of them stopped partway
       *   · the LEDGER has read every page told (no gap behind state.page)
       *   · the RECORD has no page past the word-for-word window without a line
       * Anything short of all four and it is not green. A light that lies once
       * is worse than no light. */
      let behind = false;
      let recordBehind = false;
      let ledgerBehind = false;
      let unfoldedForGood = false; /* M675: pages past the window that no one will fold — this tale's keeper is off */
      let told = 0;
      let newestPageAt = 0;
      let auditRead = null; /* M673: how far the continuous audit has read, when it is on */
      try {
        const pages = visiblePages(await db.messages.list(storyId));
        const assistants = pages.filter((m) => m.role === 'assistant');
        told = assistants.length;
        newestPageAt = assistants.length ? Number(assistants[assistants.length - 1].ts) || 0 : 0;
        const st = await loadState(storyId);
        const readTo = readMark(st); /* M276: how far the ledger has READ, not the turn's stamp */
        /* M510-43: behind means a page unread — the same count the reader keeps (a page read ahead of the mark is read):
         * the light and the reader never disagree, so a run that finds nothing is never asked for again and again */
        const ahead = new Set(Array.isArray(st && st.readAhead) ? st.readAhead : []);
        let unreadPages = 0;
        for (let k = readTo + 1; k < told; k += 1) if (!ahead.has(k)) unreadPages += 1;
        ledgerBehind = told > 0 && unreadPages > 0;
        const mem = await loadMemory(storyId);
        const window = windowFor(mem, await db.settings.get('memoryWindow')); /* M317: the same window the keeper folds by */
        const batch = cleanBatch(await db.settings.get('memoryBatch'));
        /* M675 (the second reading): THE RECORD IS BEHIND ONLY WHERE SOMEONE KEEPS IT. With this tale's record keeper
         * switched off, a page past the window is not "waiting for the keeper — it folds when the house is idle": nobody
         * will fold it, ever. The light said so anyway, for good (never green, on every keeper-off tale longer than
         * its window), and because a tale that is "behind" is left to its fillers first, the continuous audit never read
         * on while the house was idle there (found by the walk: DOM-257, after a scenario that left a short window). */
        const tale = await db.stories.get(storyId);
        recordBehind = Boolean(dueRange(pages.length, window, mem.nodes, batch));
        if (recordBehind && !(await keeperOnFor(tale))) { recordBehind = false; unfoldedForGood = true; }
        behind = ledgerBehind || recordBehind;
        /* M673: only where it can read — its switch on, and this story's readers not switched off */
        if (await continuousAuditOn()) { if (tale && tale.extraction !== false) auditRead = auditProgress(mem, pages.length); }
      } catch (err) { behind = true; }   /* if it cannot be checked, it is not green */

      const ran = minders.filter((n) => shelf[n]).length;
      /* M668 — HIS: "make sure the yellow, blue and green light is not a gimmick but really saying you don't need to worry".
       * Green watched four workers. The two that CHECK the others — the second reader (each page against the ledger) and
       * the auditor (the ledger against the pages) — could fail on the page just told and the light stayed green:
       * "all is well" while the checking itself had not happened. A failure of either on or after the newest page is
       * trouble too, and the light names it. (Older than the newest page it is not counted: a worker he has since
       * switched off must not hold the light yellow for ever.)
       * THE LIGHT ONLY: these two are kept out of `trouble`, which also decides whether the house may heal a gap by itself
       * (fillRecordGap / fillLedgerGap). My first cut put them in it, and a tale carrying an old auditor's failed mark
       * stopped healing — DOM-22 caught it. */
      const guards = ['continuity', 'auditor'].filter((n) => shelf[n] && shelf[n].ok === false && newestPageAt > 0 && Number(shelf[n].at) >= newestPageAt);
      const trouble = sore.length > 0;
      const partly = !trouble && part.length > 0;
      /* M255: A THIRD LIGHT — WORKING. The writer sent a scene and watched the
       * green light sit there, then go out, with nothing to say whether the
       * house was thinking or had forgotten. Blue while any minder is reading
       * or waiting its turn; then green or amber when they have all settled.
       * So the light answers the question he actually asked: is it done? */
      const busy = runningWorkers(storyId).length > 0 || queuedCount(storyId) > 0;
      const allWell = !busy && !trouble && !partly && !behind && ran > 0 && told > 0;
      const allWellNow = allWell && !guards.length; /* M668: …and neither of the two that check the others failed on the newest page */

      /* M483: THE LIGHT IS NEVER SIMPLY GONE. Behind with nothing running — the readers held off for another hand at
       * this tale, or waiting out a failed try — showed no light at all, and the writer refreshed the page to find out.
       * A fourth state, waiting, says why in its title and comes back by itself when the wait ends. */
      const waiting = !busy && !trouble && !partly && !guards.length && behind && told > 0;
      const waitingWhy = waiting ? (otherHandAt(storyId) ? 'another browser wrote this tale a moment ago — its readers may still be at it; this one looks again in a few minutes'
        : ledgerBehind ? 'the last pages are not read into the ledger yet — the readers go at them when the house is idle'
          : 'a gap in the record is waiting for the keeper — it folds when the house is idle') : '';
      /* M673: THE CONTINUOUS AUDIT, ON THE LIGHT. Three things, and the lines above are as they were (`busy` still holds the
       * house's idle fillers back while any reader is out):
       *   - READING OLDER PAGES IS NOT "READING THIS SCENE". While the audit is the only thing at work (reading on while
       *     the house is idle, nothing queued behind it) the lamp shows what is true of the scene -- green when
       *     everything told is read and folded -- and a second, smaller light says the audit is reading on;
       *   - A READING THAT FAILED IS TROUBLE while there are folded pages it has not read (its switch on): the checking
       *     he asked for is not happening. It tries again by itself, a minute, two, four ... apart;
       *   - HOW FAR IT HAS READ is said in the lamp's words, and on its row among the workers. */
      const auditing = busy && queuedCount(storyId) === 0 && runningWorkers(storyId).every((n) => n === 'continuous');
      const sceneBusy = busy && !auditing;
      const auditSore = Boolean(auditRead && auditRead.left > 0 && shelf.continuous && shelf.continuous.ok === false && shelf.continuous.detail !== 'stopped by hand');
      const watched = guards.length > 0 || auditSore;
      const sceneWell = auditing && !trouble && !partly && !watched && !behind && ran > 0 && told > 0;
      const sceneWaiting = auditing && !trouble && !partly && !watched && behind && told > 0;
      const wellNow = (allWellNow && !auditSore) || sceneWell;
      const waitingNow = (waiting && !auditSore) || sceneWaiting;
      const guardWords = guards.map((g) => (g === 'continuity' ? 'the second reader' : 'the auditor')).join(' and ') + ' did not finish on the newest page; the story is safe, and it is asked again on the next';
      const auditSoreWords = 'the continuous audit could not finish its last reading; the story is safe, and it tries again by itself';
      const auditWords = !auditRead ? ''
        : auditRead.left > 0 ? ' The continuous audit has read ' + auditRead.done + ' of ' + auditRead.folded + ' folded pages' + (auditing ? ' and is reading on — it steps aside when you write.' : '; it reads on when the house is idle.')
          : auditRead.folded > 0 ? ' The continuous audit has read every folded page (' + auditRead.folded + ').' : '';
      btn.classList.toggle('is-working', sceneBusy);
      btn.classList.toggle('has-trouble', !sceneBusy && (trouble || partly || watched));
      btn.classList.toggle('all-well', wellNow);
      btn.classList.toggle('is-waiting', waitingNow);
      btn.classList.toggle('is-auditing', auditing);
      const lampWords = (sceneBusy
        ? 'The ledger — reading this scene now'
        : (!trouble && !partly && watched)
        ? 'The ledger — ' + (guards.length ? guardWords + (auditSore ? '. And ' + auditSoreWords : '') : auditSoreWords)
        : trouble
        ? 'The ledger — ' + sore.join(', ') + ' stumbled; the pages are safe and will be folded when it comes back'
        : partly ? 'The ledger — ' + part.join(', ') + ' stopped partway; it will carry on by itself'
          : wellNow ? (unfoldedForGood ? 'The ledger — everything is read. The record keeper is switched off for this story, so its older pages are not folded. Nothing is waiting. Write on.' : 'The ledger — everything is read and folded. Nothing is waiting. Write on.')
            : waitingNow ? 'The ledger — waiting: ' + (waitingWhy || (ledgerBehind ? 'the last pages are not read into the ledger yet — the readers go at them when the house is idle' : 'a gap in the record is waiting for the keeper — it folds when the house is idle'))
              : 'The ledger — the house’s memory of the scene and the world');
      btn.setAttribute('title', auditWords ? lampWords.replace(/[.\s]*$/, '.') + auditWords : lampWords);
      ledgerMark = sceneBusy ? 'working' : (trouble || watched) ? 'trouble' : partly ? 'partly' : wellNow ? 'well' : waitingNow ? 'waiting' : null;
      /* M275: THE HOUSE FILLS WHAT THE LIGHT SEES. A gap in the record (a line
       * let go by a mend, an edit or a delete of an old page) kept the light
       * dark until the writer's next page — detection without repair. Seen
       * while the house is idle and no worker is failing, the keeper is sent to
       * fold it, once a minute at most for each tale. */
      if (recordBehind && !busy && !trouble) fillRecordGap(storyId);
      /* M276: and the pages the ledger never read are read while the house is idle */
      if (ledgerBehind && !busy && !trouble) fillLedgerGap(storyId);
      /* M673: and the continuous audit reads its next stretch of folded pages */
      if (auditRead && auditRead.left > 0 && !busy && !trouble && !behind) continuousCatchUp(storyId);
    } catch (err) { /* a mark is never worth a thrown turn */ }
  }

  /* M293: ANOTHER HAND AT THIS TALE. A second browser holding the same tale
   * open pulled the first browser's new page the moment it landed — and its
   * light, seeing a ledger a page behind (the first browser's readers were
   * still out), sent its OWN readers at the page: two extractors on one page,
   * a standing moved twice, and each browser's whole-book push laying its
   * ledger over the other's mid-chain. The same for a record gap, and for the
   * resume on open of a last page whose readers had not finished elsewhere.
   * While another browser wrote a tale within the last ten minutes (sync.js
   * wroteElsewhereAt: a live announcement, or a pull that found the book just
   * moved), this room's idle repairs keep off it and look again when the
   * window has passed; the page chain for pages written HERE is untouched. */
  const OTHER_HAND_MS = 10 * 60000;
  const otherHandLook = new Map();
  function otherHandAt(storyId) {
    const at = ctx.booksStatus && typeof ctx.booksStatus.wroteElsewhereAt === 'function' ? ctx.booksStatus.wroteElsewhereAt(storyId) : 0;
    const left = at ? OTHER_HAND_MS - (Date.now() - at) : 0;
    if (left <= 0) return false;
    if (!otherHandLook.has(storyId)) {
      /* look again when the window has passed — for the tale on stage only; the light is its */
      otherHandLook.set(storyId, setTimeout(() => { otherHandLook.delete(storyId); if (ctx.getActiveStoryId() === storyId) markLedgerTrouble(storyId); }, left + 1000));
    }
    return true;
  }

  /* M251/M276: one page the ledger missed, read and marked. A read that finds
   * nothing to change still counts — a quiet page is a read page (it did not,
   * and the mark never passed it). */
  async function readMissedPage(story, connection, missed, k, { signal, renew, record = '', stale = () => false } = {}) {
    const all = visiblePages(await db.messages.list(story.id));
    const at = all.findIndex((m) => m.id === missed.id);
    /* M674: AN OUT-OF-CHARACTER ANSWER IS NOT A PAGE THE LEDGER MISSED. No reader is sent to one when it lands (M9: an
     * out-of-character turn teaches no state work) — so the reading mark stopped just before it, and THIS, which reads
     * whatever the mark has not passed, sent the ledger's reader to it as a page of the story: on the next page's
     * chain, or by itself when the house was idle. "Renji could arrive and take the seal", said in answer to his
     * ((what could happen next?)), was read for who is where and what happened (walked: DOM-248). It is passed over —
     * counted as read, nobody asked — whether it carries the mark or only answers a question that does (asideAt). */
    if (at !== -1 && asideAt(all, at)) {
      const passed = await loadState(story.id);
      markPageRead(passed, k);
      await saveState(story.id, passed);
      notify(story.id);
      return true;
    }
    const itsUser = at > 0 ? [...all.slice(0, at)].reverse().find((m) => m && m.role === 'user') : null;
    /* M453: a page older than the newest is read out of turn — only what lasts lands (engine/apply.js lastingOnly) */
    const newestTold = [...all].reverse().find((m) => m && m.role === 'assistant');
    const outOfTurn = Boolean(newestTold && newestTold.id !== missed.id);
    const back = await extractTurn({
      moodOwed: !outOfTurn, /* M454: no second ask for the mood of a page that is not the moment's */
      connection, state: await loadState(story.id),
      userText: itsUser ? pageText(itsUser) : '',
      assistantText: pageText(missed),
      before: [], founding: false,
      brief: story.brief || '', castNotes: story.castNotes || '',
      record, signal, renew,
      storyId: story.id, story, pageNumber: at + 1, /* M259: it may look */
    });
    if (!back || back.failed || !Array.isArray(back.mutations)) return false;
    if (stale()) return false; /* M290: a rewind let this reading go */
    const older = await loadState(story.id);
    const stampWas = Number.isInteger(older.page) ? older.page : -1;
    older.page = k; /* M69: its changes are stamped with the page they came from */
    const done = applyMutations(older, outOfTurn ? lastingOnly(back.mutations) : back.mutations);
    done.state.page = stampWas; /* the stamp is the turn's, not this old page's */
    markPageRead(done.state, k);
    await saveState(story.id, done.state);
    notify(story.id);
    return true;
  }
  const ledgerFilledAt = new Map();
  /* M583: the pause between two looks for unread pages (a minute, doubling) — as the record's own (gapBackoffMs), a walk
   * may shorten it; DOM-135 waited on the minute's chance and sometimes ran out of time */
  const ledgerBackoffMs = () => (Number(globalThis.__cozyLedgerBackoffMs) > 0 ? Number(globalThis.__cozyLedgerBackoffMs) : 60000);
  const ledgerTries = new Map();
  const ledgerLookAgain = new Map(); /* M483 */
  async function fillLedgerGap(storyId) {
    try {
      if (otherHandAt(storyId)) return; /* M293: another browser's readers may still be at it */
      const tries = ledgerTries.get(storyId) || 0;
      const waitLeft = Math.min(30 * 60000, ledgerBackoffMs() * 2 ** tries) - (Date.now() - (ledgerFilledAt.get(storyId) || 0));
      if (waitLeft > 0) {
        /* M483: the wait books its own look, as the record's gap does (M317) — the light went dark for the wait and
         * nothing looked again until a worker moved; he refreshed the page to see it green */
        clearTimeout(ledgerLookAgain.get(storyId));
        ledgerLookAgain.set(storyId, setTimeout(() => { ledgerLookAgain.delete(storyId); if (ctx.getActiveStoryId() === storyId) markLedgerTrouble(storyId); }, waitLeft + 500));
        return;
      }
      if (workIsRunning(storyId) || queuedCount(storyId) > 0) return;
      const story = await db.stories.get(storyId);
      if (!story || story.extraction === false) return;
      if (isYoungLedger(await loadState(storyId))) return; /* an unfounded ledger is founded by the page chain */
      const connection = await resolveWorkerConnection(story, 'extractor');
      if (!connection) return;
      ledgerFilledAt.set(storyId, Date.now());
      /* M675: tried once (agents/queue.js job.once) — its own wait between looks (a minute, doubling) is the retry. A reader
       * that could not reach its model threw out of this job: the queue asked again five times over a minute, each send
       * meanwhile waited its five seconds on it, and the banner begun below was never ended — "Reading the pages the
       * ledger missed" stood on the screen for good. A stumble is caught here: the banner says what happened, what was
       * read is kept, and the next look comes by itself, later each time. A READING CUT OFF BY ITS LEASH (a model that
       * never answers) IS A STUMBLE TOO — only his own Stop is a stop: the first cut of this let every aborted call
       * through to the queue, so a hung model left the banner standing exactly as before and marked the reader failed,
       * which stops the house from coming back to these pages by itself. */
      const promise = enqueueWork(storyId, { name: 'extractor', once: true, run: async ({ signal, stale, renew }) => {
        const told = visiblePages(await db.messages.list(storyId)).filter((m) => m.role === 'assistant');
        /* M454: EVERY MISSED PAGE IN ONE GO, AND THE COUNT ON SHOW. Three pages a run and a minute between runs kept the
         * light pulsing yellow for as long as a backlog lasted, with nothing to say how far it had got. The reader now
         * goes on page after page while the house is idle (it still stops the moment the storyteller is at work — M314 —
         * and carries on after), and the banner counts it to its end: "page 12 of 57 · 21%" … done. */
        const unread = (st) => { const mark = readMark(st); const ahead = new Set(Array.isArray(st && st.readAhead) ? st.readAhead : []); let c = 0; for (let k = mark + 1; k < told.length; k += 1) if (!ahead.has(k)) c += 1; return c; };
        const total = unread(await loadState(storyId));
        if (!total) return { silent: true };
        const banner = beginWork('Reading the pages the ledger missed', () => { const s = storyId; if (s) stoppedByHand(s); banner.failed('Stopped — what was read is kept; the rest are read when the house is idle again'); }, storyId); /* M510-42: this tale's readers, whichever tale is open */
        let read = 0;
        let stumbled = '';
        banner.step(0, total, 'page');
        try {
        for (let i = 0; i < 2000 && !stale(); i += 1) {
          /* M314: NEVER WHILE THE STORYTELLER IS AT WORK. The light asks for this when nothing is busy — but the
           * job is queued, and runs later. A swipe of the last page rewinds the ledger to the page before
           * it (so that page reads as "unread") and only THEN writes the new version: a repair that ran
           * in between read the page's OLD words and put back the consequences of a version that no
           * longer stood (seen in the walk: Person4 back in the room after the swipe that replaced her).
           * A page being written, swiped or replayed is read by its own chain; the repair waits. */
          if (busy || replaying) break;
          const k = oldestUnread(await loadState(storyId), told.length);
          if (k === -1) break;
          if (!(await readMissedPage(story, connection, told[k], k, { signal, renew, stale }))) break;
          read += 1;
          banner.step(Math.min(read, total), total, 'page');
        }
        } catch (err) {
          if (stoppedRun(signal)) { if (banner.open()) banner.failed('Stopped — what was read is kept'); throw err; } /* stopped by hand (his Stop has said so already; a tale let go has not): the queue says so */
          stumbled = (signal && signal.aborted) || (err && err.message === 'timeout') ? 'it took too long to answer' : String((err && err.message) || 'no answer').slice(0, 160).replace(/[.\s]+$/, '');
        }
        const still = oldestUnread(await loadState(storyId), told.length) !== -1;
        if (!still) banner.done('The ledger has read every page');
        else if (stumbled) banner.failed('Read ' + read + ' of ' + total + ' — the reader’s model did not answer (' + stumbled + '); the rest are tried again by themselves');
        else if (busy || isReplaying()) banner.paused('Paused while the storyteller writes — ' + read + ' of ' + total + ' read; the rest follow by themselves');
        else banner.failed('Read ' + read + ' of ' + total + ' — the rest are tried again by themselves shortly');
        if (!still) ledgerTries.delete(storyId);
        else if (read) ledgerTries.set(storyId, 0);
        else ledgerTries.set(storyId, tries + 1);
        if (!read && !still) return { silent: true };
        return {
          silent: false,
          detail: !still ? 'read ' + read + (read === 1 ? ' page' : ' pages') + ' the ledger had missed'
            : read ? 'read ' + read + ' of the pages the ledger missed — the rest follow'
              : 'could not read the pages the ledger missed yet' + (stumbled ? ' (' + stumbled + ')' : '') + ' — it tries again later',
          unfinished: still,
        };
      } });
      noteWork(storyId, promise);
    } catch (err) { /* the next look tries again */ }
  }

  /* M673: ONE READING OF THE CONTINUOUS AUDIT (agents/continuous.js) -- the oldest record line it has not read, its pages
   * against the story before them, the line itself and the ledger. A job in a page's chain, and sent by itself while the
   * house is idle (continuousCatchUp). THE STORYTELLER COMES FIRST: it never starts while a page is being written or
   * replayed, and a reading in flight holds a stop of its own, pulled the moment he asks for a page or anything waits for
   * the workers (pauseContinuousAudit, from generate and from pendingWork) -- its call is dropped, nothing is written,
   * and the same pages are read later. */
  async function continuousStep(story, { signal, stale, renew } = {}) {
    const isStale = () => typeof stale === 'function' && stale();
    if (!story || story.extraction === false || isStale()) return { silent: true };
    if (busy || replaying) return { silent: true };
    if (!(await continuousAuditOn())) return { silent: true };
    const connection = await resolveWorkerConnection(story, 'continuous');
    if (!connection) return { silent: true };
    /* M675 (the second reading): the reading's own stop follows the job's AND CARRIES ITS REASON (continuous.js
     * beginReading) — tied here with a bare abort(), a reading cut off by its leash could not be told from a step aside,
     * and the audit asked for the same stretch at every look, for good (law M675-B1) */
    const own = beginReading(story.id, signal);
    try {
      const result = await auditStretch({
        connection, storyId: story.id, brief: story.brief || '', castNotes: story.castNotes || '', signal: own.signal, stale, renew,
        /* the house's own mender, with his switch: that one page, the smallest edit, the record as it stood before it */
        mend: async (pageId, words) => {
          const k = visiblePages(await db.messages.list(story.id)).findIndex((m) => m.id === pageId);
          if (k === -1) return [];
          const before = recordLinesBefore(await loadMemory(story.id), k, Math.floor(roomChars(connection) * 0.35));
          return mendAround(story, connection, [pageId], words, own.signal, 0, 'The continuous audit', before);
        },
        /* M675: what it writes of an OLD page is written into the ledger each other version of the newest page keeps too —
         * walking back to another telling put that version's ledger in place whole, without the fact, while the record
         * line went on saying it had been read (agents/continuous.js) */
        alsoInto: async (mutations, page) => {
          const newest = [...visiblePages(await db.messages.list(story.id))].reverse().find((m) => m.role === 'assistant');
          if (!newest) return;
          const count = Array.isArray(newest.swipes) && newest.swipes.length ? newest.swipes.length : 1;
          for (let idx = 0; idx < count; idx += 1) {
            const kept = await versionStateFor(story.id, newest.id, idx);
            if (!kept) continue;
            const r = applyMutations({ ...kept, page }, mutations);
            if (r.applied.length) await saveVersionState(story.id, newest.id, idx, { ...r.state, page: kept.page });
          }
        },
        /* a fault it could not mend is left on the page, where the second reader's notes are */
        note: async (pageId, finding) => {
          const page = (await db.messages.list(story.id)).find((m) => m.id === pageId);
          if (!page) return;
          const had = Array.isArray(page.findings) ? page.findings : [];
          if (had.some((f) => f && f.words === finding.words)) return;
          await reink(story.id, pageId, { findings: [...had, finding] });
          notify(story.id);
        },
      });
      if (!result) return { silent: true };
      return { silent: false, detail: stretchWords(result), raw: result.raw };
    } catch (err) {
      if (own.signal.aborted && !(signal && signal.aborted)) return { silent: true }; /* stepped aside for the storyteller */
      throw err;
    } finally {
      endReading(story.id, own);
    }
  }
  /* M673: IT READS ON WHILE THE HOUSE IS IDLE. A tale already long when he switches it on has hundreds of folded pages
   * unread: one line a page would take as many pages again to reach the present. Seen by the light while nothing else
   * is running, the next reading is sent by itself -- one at a time, a breath between them, each in the readers' own
   * queue (so it never writes the ledger beside another reader) -- until every folded page is read. A reading that
   * fails waits a minute, two, four ... thirty at most before the next try. */
  const continuousPauseMs = () => (Number(globalThis.__cozyContinuousPauseMs) > 0 ? Number(globalThis.__cozyContinuousPauseMs) : 1500);
  const continuousAt = new Map();
  const continuousFails = new Map();
  const continuousLook = new Map();
  async function continuousCatchUp(storyId) {
    try {
      if (!storyId || busy || replaying || ctx.getActiveStoryId() !== storyId) return;
      if (!(await continuousAuditOn())) return;
      if (otherHandAt(storyId)) return; /* another browser's readers may be at this tale */
      if (workIsRunning(storyId) || queuedCount(storyId) > 0) return;
      const fails = continuousFails.get(storyId) || 0;
      const wait = fails ? Math.min(30 * 60000, gapBackoffMs() * 2 ** (fails - 1)) : continuousPauseMs();
      const since = Date.now() - (continuousAt.get(storyId) || 0);
      if (since < wait) {
        if (!continuousLook.has(storyId)) continuousLook.set(storyId, setTimeout(() => { continuousLook.delete(storyId); if (ctx.getActiveStoryId() === storyId) markLedgerTrouble(storyId); }, wait - since + 50));
        return;
      }
      const story = await db.stories.get(storyId);
      if (!story || story.extraction === false) return;
      /* M675: is there a stretch to read NOW? Lines the wire would not answer for are set aside for a while (continuous.js
       * `troubled`); when only those are left the next look is booked for the moment the first comes back */
      const waits = auditWaits(storyId, await loadMemory(storyId), visiblePages(await db.messages.list(storyId)));
      if (waits === -1) return; /* every folded page is read */
      if (waits > 0) {
        if (!continuousLook.has(storyId)) continuousLook.set(storyId, setTimeout(() => { continuousLook.delete(storyId); if (ctx.getActiveStoryId() === storyId) markLedgerTrouble(storyId); }, Math.min(waits, 30 * 60000) + 50));
        return;
      }
      if (!(await resolveWorkerConnection(story, 'continuous'))) return;
      if (busy || replaying || ctx.getActiveStoryId() !== storyId || workIsRunning(storyId) || queuedCount(storyId) > 0) return; /* looked again: the house moved meanwhile */
      continuousAt.set(storyId, Date.now());
      const gen = chainGen.get(storyId) || 0;
      const promise = enqueueWork(storyId, { name: 'continuous', once: true /* M675: its own wait between looks is the retry (queue.js job.once) */, run: chainJob((hooks) => continuousStep(story, hooks), () => (chainGen.get(storyId) || 0) !== gen) });
      noteWork(storyId, promise);
      promise.then((r) => {
        continuousAt.set(storyId, Date.now());
        if (r && r.ok === false && !r.stale && !r.stopped) continuousFails.set(storyId, fails + 1); else continuousFails.delete(storyId);
      }).catch(() => { /* the next look tries again */ });
    } catch (err) { /* the next look tries again */ }
  }
  const gapFilledAt = new Map();
  const gapTries = new Map(); /* fills in a row that folded nothing — each waits twice as long */
  async function recordGap(storyId) {
    const mem = await loadMemory(storyId);
    const pages = visiblePages(await db.messages.list(storyId));
    const window = windowFor(mem, await db.settings.get('memoryWindow')); /* M317: the same window the keeper folds by */
    const batch = cleanBatch(await db.settings.get('memoryBatch'));
    return Boolean(dueRange(pages.length, window, mem.nodes, batch));
  }
  const coveredCount = async (storyId) => coveredSet((await loadMemory(storyId)).nodes).size;
  /* one minute, two, four… thirty at most (read when used, so a test may shorten it for one scenario) */
  const gapBackoffMs = () => (Number(globalThis.__cozyGapBackoffMs) > 0 ? Number(globalThis.__cozyGapBackoffMs) : 60000);
  const gapLookAgain = new Map();
  async function fillRecordGap(storyId) {
    try {
      if (otherHandAt(storyId)) return; /* M293: another browser's keeper may still be folding it */
      const tries = gapTries.get(storyId) || 0;
      /* a fill that folds nothing is not tried again every minute for ever:
       * one minute, two, four … thirty at most */
      if (Date.now() - (gapFilledAt.get(storyId) || 0) < Math.min(30 * 60000, gapBackoffMs() * 2 ** tries)) return;
      if (workIsRunning(storyId) || queuedCount(storyId) > 0) return;
      const story = await db.stories.get(storyId);
      if (!story || story.keeper === false) return;
      if (story.keeper !== true && (await db.settings.get('memoryKeeper')) === false) return;
      const connection = await resolveWorkerConnection(story, 'keeper');
      if (!connection) return;
      gapFilledAt.set(storyId, Date.now());
      /* M675: THE THIRD JOB THE HOUSE STARTS BY ITSELF IS TRIED ONCE TOO (agents/queue.js job.once; the ledger's catch-up
       * and the continuous audit were, and this was not). A keeper whose model could not be reached threw out of this
       * job: the queue asked again five times over a minute — every send meanwhile waiting its five seconds on a job
       * with nothing in flight — and then marked the keeper failed, which stops the house from folding the gap by
       * itself at all until a page's own keeper has run well. A stumble is caught here, as the catch-up's is: it is
       * said on the workers' line with its reason, and the next look comes by itself — a minute, two, four … apart. */
      const promise = enqueueWork(storyId, { name: 'keeper', once: true, run: async ({ signal, stale, renew }) => {
        if (!(await recordGap(storyId))) { gapTries.delete(storyId); return { silent: true }; }
        const before = await coveredCount(storyId);
        /* a line's passage that contradicts the record is mended here too, as in the page's own chain */
        const onSourceIssue = async ({ issue, fix, span }) => {
          const ids = await pagesOfLine(storyId, span); /* M674: the line's own pages */
          await mendAround(story, connection, ids, issue + (fix ? '. It should read: ' + fix : ''), signal);
        };
        let stumbled = '';
        try {
          await maybeSummarize({ connection, storyId, signal, stale, renew, recordRoomChars: await recordRoomFor(story), onSourceIssue });
        } catch (err) {
          if (stoppedRun(signal)) throw err; /* stopped by hand: the queue says so */
          stumbled = (signal && signal.aborted) || (err && err.message === 'timeout') ? 'the keeper’s model took too long to answer' : String((err && err.message) || 'the keeper’s model did not answer').slice(0, 160).replace(/[.\s]+$/, '');
        }
        const moved = (await coveredCount(storyId)) > before;
        const still = await recordGap(storyId);
        if (!still) gapTries.delete(storyId);
        else if (moved) gapTries.set(storyId, 0); /* a backlog folding on: soon again */
        else gapTries.set(storyId, tries + 1);
        /* M317: "IT TRIES AGAIN LATER" — BY ITSELF. The light only ever looked again when a worker started or
         * settled: with the tavern open and nothing being written, no look ever came and "later" meant
         * "when you write the next page". A repair that ends unfinished now books the next look for the
         * moment its own wait is over. */
        if (still) {
          const wait = Math.min(30 * 60000, gapBackoffMs() * 2 ** (gapTries.get(storyId) || 0));
          clearTimeout(gapLookAgain.get(storyId));
          gapLookAgain.set(storyId, setTimeout(() => { gapLookAgain.delete(storyId); if (ctx.getActiveStoryId() === storyId) markLedgerTrouble(storyId); }, wait + 500));
        }
        return {
          silent: false,
          detail: (!still ? 'folded a gap in the record' : moved ? 'folded part of a gap in the record — the rest follows' : 'could not fold a gap in the record yet') + (stumbled ? ' (' + stumbled + ')' : keeperTrouble() ? ' (' + keeperTrouble() + ')' : '') + (!still || moved ? '' : ' — it tries again later'), /* M315: the reason, said; M316: also when the house had to step in; M675: also when its model could not be reached */
          unfinished: still,
        };
      } });
      noteWork(storyId, promise);
    } catch (err) { /* the next look tries again */ }
  }


  /* M255: THE LIGHT WAS ONLY EVER COMPUTED WHEN THE THREAD REDREW — which
   * happens BEFORE the background chain has finished. So after a scene the
   * light showed the state of the world as it was a second after sending,
   * and nothing ever looked again: the writer waited ten minutes and only saw
   * green after reloading the browser. The house already tells anyone who
   * asks when a worker starts or settles; the light listens now. */
  onWorkerChange(() => {
    const id = ctx.getActiveStoryId();
    if (id) markLedgerTrouble(id);
  });

  async function summarizeNow() {
    const banner = beginWork('Folding what is due', (tale) => { const s = tale || ctx.getActiveStoryId(); if (s) stoppedByHand(s); banner.failed('Stopped — press it again to carry on'); });
    const story = await activeStory();
    if (!story) { banner.failed('Open a story first'); return false; }
    if (story.keeper !== true && (await db.settings.get('memoryKeeper')) === false) { /* M674: a tale whose own keeper switch is on is folded, whatever the house-wide switch says (memory.js maybeSummarize) */
      banner.failed('The keeper is switched off — turn it on in Settings first');
      return false;
    }
    /* M675 (the second reading): "A PASS IS FINISHING" MEANS THE KEEPER'S. This turned him away whenever ANYTHING was out
     * for the tale — the readers of a page that had just landed, the helpers a tale's own opening sends out — though
     * the work is done one after the other anyway: only a fold already running or waiting must not be doubled (with
     * two helpers at once the page's own keeper folds beside the readers). Behind anything else, this waits its turn. */
    if (workIsRunning(story.id) && workOut(story.id).includes('keeper')) {
      banner.failed('A pass is finishing — try again in a moment');
      return false;
    }
    const mem = await loadMemory(story.id);
    const pages = (await db.messages.list(story.id)).filter((m) => m && !m.hidden);
    const window = windowFor(mem, await db.settings.get('memoryWindow')); /* M317: the same window the keeper folds by */
    const batch = cleanBatch(await db.settings.get('memoryBatch'));
    if (!dueRange(pages.length, window, mem.nodes, batch)) {
      banner.done('Nothing is due — every page is either word for word or already folded');
      return false;
    }
    const connection = await resolveWorkerConnection(story, 'keeper');
    if (!connection) { banner.failed('The keeper needs a connection first'); return false; }
    const promise = enqueueWork(story.id, { name: 'keeper', run: async ({ signal, stale, renew }) => {
      const r = await catchUpRecord({
        connection, storyId: story.id, signal, stale, renew, recordRoomChars: await recordRoomFor(story),
        onProgress: ({ batch: b, batches, folded, toFold }) => banner.step(b, batches, 'batch', folded + ' of ' + toFold + ' pages'),
        onRetry: ({ ms, attempt, of }) => waitVisibly(banner, ms, attempt, of),
      });
      if (stoppedRun(signal)) { clearFinishCount(story.id, 'summarizeNow'); return { silent: false, detail: 'stopped by hand' + (r && Number.isFinite(r.folded) ? ' after folding ' + r.folded + ' pages' : '') }; }
      if (!r || r.ok === false) { banner.failed(r && r.why ? r.why : 'it stumbled'); maybeFinish(story.id, 'summarizeNow', r || { stalled: true }); }
      else if (r.nothingDue) banner.done('Nothing was due');
      else banner.done('Folded ' + r.folded + ' pages into ' + r.batches + ' ' + (r.batches === 1 ? 'line' : 'lines'));
      return { silent: false, detail: r && r.ok ? 'folded ' + (r.folded || 0) + ' pages that were due' : 'the catch-up stumbled',
        unfinished: Boolean(r && (r.stalled || r.ok === false)), resume: 'summarizeNow' };
    } });
    noteWork(story.id, promise);
    bannerEndsWith(banner, promise); /* M675 */
    return true;
  }

  async function rebuildRecordNow() {
    const banner = beginWork('Rebuilding the record', (tale) => { const s = tale || ctx.getActiveStoryId(); if (s) stoppedByHand(s); banner.failed('Stopped — what was folded is kept; Rebuild starts again from page one'); });
    const story = await activeStory();
    if (!story) { banner.failed('Open a story first'); return false; }
    const connection = await resolveWorkerConnection(story, 'keeper');
    if (!connection) { banner.failed('The keeper needs a connection first'); return false; }
    const promise = enqueueWork(story.id, { name: 'keeper', run: async ({ signal, stale, renew }) => {
      const result = await rebuildRecord({
        connection, storyId: story.id, signal, stale, renew, recordRoomChars: await recordRoomFor(story),
        onProgress: ({ batch, batches, folded, toFold }) => banner.step(batch, batches, 'batch', folded + ' of ' + toFold + ' pages'),
        onRetry: ({ ms, attempt, of }) => waitVisibly(banner, ms, attempt, of),
      });
      if (stoppedRun(signal)) { clearFinishCount(story.id, 'rebuildRecordNow'); return { silent: false, detail: 'stopped by hand' + (result && Number.isFinite(result.folded) ? ' at ' + result.folded + ' of ' + result.toFold + ' pages' : '') }; }
      if (result && result.stalled) {
        banner.failed('Stopped at ' + result.folded + ' of ' + result.toFold + ' pages — carrying on shortly');
        maybeFinish(story.id, 'rebuildRecordNow', result);
      } else { banner.done(rebuildRecordWords(result)); clearFinishCount(story.id, 'rebuildRecordNow'); }
      /* M248: green only when it reached the end */
      return { silent: false, detail: rebuildRecordWords(result),
        unfinished: Boolean(result && result.stalled), resume: 'rebuildRecordNow' };
    } });
    noteWork(story.id, promise);
    bannerEndsWith(banner, promise); /* M675 */
    return true;
  }
  async function rebuildPeopleNow() {
    /* M214: the banner is opened BEFORE anything can close it. A bulk edit
     * left `banner.failed(...)` on the line ABOVE `const banner = …`, so the
     * one path that used it — "the scribe needs a connection" — threw a
     * ReferenceError out of the click instead of saying so. Lint does not
     * catch a temporal-dead-zone use inside a function body. */
    const banner = beginWork('Rebuilding the people', (tale) => { const s = tale || ctx.getActiveStoryId(); if (s) stoppedByHand(s); banner.failed('Stopped — what was folded is kept; Rebuild starts again from page one'); });
    const story = await activeStory();
    if (!story) { banner.failed('Open a story first'); return false; }
    const connection = await resolveWorkerConnection(story, 'scribe');
    if (!connection) { banner.failed('The scribe needs a connection first'); return false; }
    const promise = enqueueWork(story.id, { name: 'scribe', run: async ({ signal, stale, renew }) => {
      const result = await rebuildPeople({ connection, storyId: story.id, brief: story.brief || '', castNotes: story.castNotes || '', cast: await castForStory(story), lore: await loadLore(story.id), canonRecord: await canonRecordOf(story), signal, stale, renew, onProgress: ({ read, total }) => banner.step(read, total, 'page') });
      /* M135: the rebuilt pages also land in the LAST turn's boundary snapshot and
       * the last page's checkpoint — so a retry, a swipe or a branch at the newest
       * page starts from the rebuilt pages, not the frozen ones. Older boundaries
       * keep their history (a branch far back should carry the pages as they were). */
      try {
        const rebuilt = await loadState(story.id);
        const history = await db.messages.list(story.id);
        const vis = history.filter((m) => m && !m.hidden);
        const last = [...vis].reverse().find((m) => m.role === 'assistant');
        const lastUser = last ? [...vis.slice(0, vis.indexOf(last))].reverse().find((m) => m.role === 'user') : null;
        const snaps = await loadSnapshots(story.id);
        let touched = false;
        for (const e of snaps) {
          /* M574 (the audit): a NEW checkpoint object — changed in place, the save saw the very object it had handed out (M507's
           * "written already" test is by identity) and skipped it: the rebuilt people never reached the checkpoint */
          /* M607: and the standings with them — the rebuild swaps both in, and a retry at the newest page brought the old
           * standings back beside the new pages */
          if (e && lastUser && e.id === lastUser.id && e.snap) { e.snap = { ...e.snap, characters: JSON.parse(JSON.stringify(rebuilt.characters || {})), relationships: JSON.parse(JSON.stringify(rebuilt.relationships || {})) }; touched = true; }
        }
        if (touched) await saveSnapshots(story.id, snaps);
        if (last) {
          const idx = shownIndex(last); /* M576: the version the checkpoint step keyed (a page with versions and none chosen shows its newest) */
          const all = await loadVersionStates(story.id);
          if (all[last.id + ':' + idx]) { all[last.id + ':' + idx] = { ...all[last.id + ':' + idx], characters: JSON.parse(JSON.stringify(rebuilt.characters || {})), relationships: JSON.parse(JSON.stringify(rebuilt.relationships || {})) }; await writeVersionStates(story.id, all); } /* M574: a new object, the same reason */
        }
      } catch (err) { /* the ledger itself is rebuilt; the checkpoints follow when they can */ }
      /* M214: a stalled run is not a rebuilt one — the record rebuild has
       * checked this since M203 and the people rebuild had not, so its
       * banner closed with "The people were rebuilt" over a run the leash
       * had cut off. */
      if (stoppedRun(signal)) { clearFinishCount(story.id, 'rebuildPeopleNow'); return { silent: false, detail: 'stopped by hand — the people stand as they were' }; }
      if (result && result.stalled) {
        banner.failed('Stopped at ' + result.read + ' of ' + result.total + ' pages — carrying on shortly');
        maybeFinish(story.id, 'rebuildPeopleNow', result);
      } else { banner.done(rebuildPeopleWords(result)); clearFinishCount(story.id, 'rebuildPeopleNow'); }
      return { silent: false, detail: rebuildPeopleWords(result),
        unfinished: Boolean(result && result.stalled), resume: 'rebuildPeopleNow' };
    } });
    noteWork(story.id, promise);
    /* M214: the job closes its own banner (it knows whether the run stalled);
     * bannerFollows would paint "done" over that. */
    bannerEndsWith(banner, promise); /* M675: …and a job that ended without closing it is closed here */
    return true;
  }
  async function restoreRecordNow() {
    const banner = beginWork('Putting the old record back', (tale) => { const s = tale || ctx.getActiveStoryId(); if (s) stoppedByHand(s); banner.failed('Stopped — what was folded is kept; Rebuild starts again from page one'); });
    const story = await activeStory();
    if (!story) { banner.failed('Open a story first'); return false; }
    const ok = await restoreRecord(story.id);
    if (ok) banner.done('The old record is back'); else banner.failed('No older record is kept');
    return ok;
  }
  async function restorePeopleNow() {
    const banner = beginWork('Putting the people back', (tale) => { const s = tale || ctx.getActiveStoryId(); if (s) stoppedByHand(s); banner.failed('Stopped — what was folded is kept; Rebuild starts again from page one'); });
    const story = await activeStory();
    if (!story) { banner.failed('Open a story first'); return false; }
    const ok = await restorePeople(story.id);
    if (ok) banner.done('The old pages and standings are back'); else banner.failed('No older pages are kept');
    return ok;
  }

  /* M50: rebuild every standing by hand — from the brief, the record and the pages. */
  async function rebuildStandingsNow() {
    const banner = beginWork('Rebuilding every standing', (tale) => { const s = tale || ctx.getActiveStoryId(); if (s) stoppedByHand(s); banner.failed('Stopped — what was folded is kept; Rebuild starts again from page one'); });
    const story = await activeStory();
    if (!story) { banner.failed('Open a story first'); return false; }
    const connection = await resolveWorkerConnection(story, 'auditor');
    if (!connection) { banner.failed('The auditor needs a connection first'); return false; }
    const promise = enqueueWork(story.id, { name: 'auditor', run: async ({ signal, stale, renew }) => {
      const result = await rebuildStandings({ connection, storyId: story.id, brief: story.brief || '', castNotes: story.castNotes || '', signal, stale, renew });
      return { silent: false, detail: rebuildRunWords(result), raw: result && result.raw };
    } });
    noteWork(story.id, promise);
    banner.say('reading the brief, the record and the pages');
    bannerFollows(banner, story, 'Every standing was rebuilt', promise);
    return true;
  }

  /* M41: audit the ledger, by hand. */
  /* M90: THE BRIEF WINS, resolved by the house. An audit issue with
   * pages:true and a fix is a page that contradicted the brief: the pages
   * within reach are mended by the smallest edit (the mender; take-back
   * chips). Since M330 no [Correction] line is written — the brief itself rides every turn and the ledger holds the
   * lock. Nothing here waits for a hand. */
  /* M259: a page's number, as the page index and the fetch server count it
   * (1-based among the pages that are not hidden) */
  async function pageNumberOf(storyId, messageId) {
    try {
      return visiblePages(await db.messages.list(storyId)).findIndex((m) => m.id === messageId) + 1;
    } catch (err) { return 0; }
  }

  async function resolveBriefWins(story, connection, result, signal, renew) {
    if (!result || !Array.isArray(result.issues)) return result;
    const wins = result.issues.filter((i) => i && i.pages && i.fix);
    if (!wins.length) return result;
    let mendedPages = 0;
    const all = (await db.messages.list(story.id)).filter((m) => !m.hidden && m.role === 'assistant');
    const last = all[all.length - 1];
    for (const issue of wins) {
      if (typeof renew === 'function') renew(); /* M259: each mend is its own call */
      if (last) {
        try {
          const changed = await mendAround(story, connection, [last.id], issue.what + ' It should read: ' + issue.fix, signal, AUDIT_PAGES);
          mendedPages += changed.length;
        } catch (err) { /* a mend that fails leaves the correction to carry the truth */ }
      }
      /* M330: no "[Correction] … (the brief establishes it…)" is written any more — the brief itself rides every turn,
       * the mended pages let their record lines go to be folded again, and the ledger holds the lock */
    }
    return { ...result, mendedPages };
  }

  /* M100: THE RIPPLE — an edit that changed one fact is made true everywhere.
   * A name-like change (a person, a place) is applied in code with word
   * boundaries: the ledger (people.rename, journaled, undoable), the record's
   * lines, the brief and the cast notes, and every other storyteller page in
   * the story — each page as a mend with its take-back. Any other fact goes to
   * the mender page by page where the old words stand, with a [Correction] in
   * the record; the auditor relocks the canon on the next page. Off the send
   * path, in the workers' queue, never on the writer's hand. */
  /* M330: THE HOUSE'S OWN NOTES ARE TAKEN BACK OUT OF THE RECORD. A record written before today may hold them — the two
   * sentences the house itself composed, recognised by their own closing words (a keeper's line that tags a retcon
   * in the STORY is the story's, and stays). Removed the moment the tale is opened; the auditor is sent to hold the
   * pages and the ledger to the brief, which is how a page the ripple wrongly mended goes back. */
  const healedNotes = new Set();
  const HOUSE_NOTE = /(?:\((?:the writer|the housekeeper)[’']s edit\); what said otherwise before is in error\.|\(the brief establishes it; the pages that said otherwise were in error\)\.)\s*$/;
  async function takeBackHouseNotes(story) {
    try {
      if (!story) return 0;
      const mem = await loadMemory(story.id);
      let kept = mem.nodes.filter((n) => !(n && n.correction === true && HOUSE_NOTE.test(String(n.text || ''))));
      const gone = mem.nodes.length - kept.length;
      /* …and M316's marker: the page stays covered, its words ("(no line from the keeper… “Summarize now”…)") go */
      let unworded = 0;
      kept = kept.map((n) => (n && n.byHouse === true && String(n.text || '').trim() ? (unworded += 1, { ...n, text: '', empty: true }) : n));
      if (!gone && !unworded) return 0;
      await saveMemory(story.id, { ...mem, nodes: kept });
      if (!gone) return 0;
      pendingAudit.add(story.id);
      toast(gone + (gone === 1 ? ' note' : ' notes') + ' the house had left in this story’s record ' + (gone === 1 ? 'was' : 'were') + ' taken out — the pages, the record and the ledger carry the facts themselves, and the auditor will hold them to your brief.');
      return gone;
    } catch (err) { return 0; }
  }

  /* M344: THE OLDER-MODEL SWITCH NEVER REMOVES ANYTHING. M343 also held the request to 64,000 tokens (the oldest pages left first).
   * The writer: "never drop the notes or the summary — that is the most important thing. I asked to make it SMART, not to
   * remove details of the story; it has 200k of room and I rarely reach 150k." He is right: a page out of the request is
   * a detail the model cannot have, whatever it would have done with it. The cap is gone — the room is the provider's, as
   * ever (roomOf is contextOf). What the switch does now is only ever ADD, at the end (assemble/anchor.js). */
  /* M510: THE SMALL-MODEL MODE FOLLOWS THE STORYTELLER. It was one switch for the whole house (M343's `olderModel`), so a
   * tale told by his frontier model after a night on the small one still carried the small-model words — the very break
   * the switch existed to prevent. It is a property of the connection now: choosing the connection is choosing the mode,
   * and a connection without the tick never gets one byte of it. */
  const isSmallModel = (conn) => Boolean(conn && conn.smallModel === true);
  /* M510: THE QUICK SWITCH — who tells the story, one tap from the page. Sorted by name, as his connection list is (M301);
   * a small model wears its mark.
   * M510-8: ONE MODEL CHOICE. It first wrote this story's own storyteller (story.connectionId) while Settings' picker wrote
   * the house's (activeConnectionId): two choosers, two fields — he picked in one and the other showed another model, and
   * a story the Quick switch had touched kept telling with it whatever Settings said ("the quick switch is not syncing
   * with the main one in Settings"). Now the Quick switch, Settings' picker and "Use this one" do ONE thing
   * (useConnection): this connection tells the stories, and the story he is in follows it (its own storyteller, if one
   * was set, is let go). The switch SHOWS what the story he is in actually uses; Settings → "Who tells this story" stays
   * the one deliberate exception, and the switch shows it when it stands. */
  const connectionName = (c) => String((c && (c.label || c.model)) || 'a connection') + (isSmallModel(c) ? ' · small model' : '');
  /* M638: THE QUICK SWITCH KEEPS TO THE MODELS HE TELLS WITH. His word: "I have so many models and my quick changing model
   * is so cluttered, my whole screen full, overwhelmed." It listed EVERY connection — the storytellers he switches
   * between, the ones he tried once, his workers' hands, a decisions model. With more than seven it now shows the seven
   * he told with most lately (the one telling this story always among them), by name as before, and one last line —
   * "All models (N)…" — that puts the whole list on the same switch until he has chosen (or asks for fewer). Seven or
   * fewer connections: all of them, as it always was. What he tells with is kept from now on (settings quickRecent:
   * every choice, every page told); before the first of those it is read from what is known — who told this story's
   * pages, the house's choice, each tale's own storyteller. */
  const QUICK_SHOWN = 7;
  const QUICK_ALL = '__all';
  const QUICK_FEW = '__few';
  let quickAllFor = null; /* the story whose whole list he asked to see — until he chooses, asks for fewer, or opens another */
  async function quickRecent(story) {
    const kept = await db.settings.get('quickRecent');
    if (Array.isArray(kept)) return kept.filter((x) => typeof x === 'string' && x);
    const ids = [];
    const add = (id) => { if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id); };
    try {
      const msgs = story ? await db.messages.list(story.id) : [];
      for (let i = msgs.length - 1; i >= 0 && ids.length < 20; i -= 1) add(msgs[i] && msgs[i].receipt && msgs[i].receipt.connId);
      add(await db.settings.get('activeConnectionId'));
      for (const st of await db.stories.list()) add(st && st.connectionId);
    } catch (err) { /* what is known so far */ }
    await db.settings.set('quickRecent', ids.slice(0, 20));
    return ids;
  }
  async function noteQuickRecent(id) {
    if (typeof id !== 'string' || !id) return;
    try {
      const list = await quickRecent(await activeStory());
      if (list[0] === id) return;
      await db.settings.set('quickRecent', [id, ...list.filter((x) => x !== id)].slice(0, 20));
    } catch (err) { /* the list waits for the next choice */ }
  }
  async function refreshQuickSwitch() {
    if (!els.quickSwitch || !els.quickSwitchWrap) return;
    try {
      const story = await activeStory();
      const all = (await db.connections.list()).slice().sort((a, b) => String(a.label || '').localeCompare(String(b.label || ''), undefined, { sensitivity: 'base' }));
      if (!story || !all.length) { els.quickSwitchWrap.hidden = true; return; }
      const using = await resolveConnection(story); /* M510-8: what this story actually tells with */
      if (quickAllFor && quickAllFor !== story.id) quickAllFor = null;
      const whole = all.length <= QUICK_SHOWN || quickAllFor === story.id;
      let shown = all;
      if (!whole) {
        const ids = [];
        if (using) ids.push(using.id);
        for (const id of await quickRecent(story)) { if (ids.length >= QUICK_SHOWN) break; if (!ids.includes(id) && all.some((c) => c.id === id)) ids.push(id); }
        shown = all.filter((c) => ids.includes(c.id));
      }
      els.quickSwitch.textContent = '';
      for (const c of shown) { const o = document.createElement('option'); o.value = c.id; o.textContent = connectionName(c); els.quickSwitch.appendChild(o); }
      if (all.length > QUICK_SHOWN) {
        const o = document.createElement('option');
        o.value = whole ? QUICK_FEW : QUICK_ALL;
        o.textContent = whole ? 'Fewer — only the ones I tell with' : 'All models (' + all.length + ')…';
        els.quickSwitch.appendChild(o);
      }
      els.quickSwitch.value = using && shown.some((c) => c.id === using.id) ? using.id : shown[0].id;
      els.quickSwitchWrap.hidden = false;
    } catch (err) { /* the switch waits for the next look */ }
  }
  async function useConnection(id) {
    if (typeof id !== 'string' || !id) return;
    /* M638: the model he is leaving stays in reach (read before the choice changes) — switching between two is what the
     * switch is for */
    let leaving = null;
    try { leaving = await resolveConnection(await activeStory()); } catch (err) { leaving = null; }
    await db.settings.set('activeConnectionId', id);
    const story = await activeStory();
    if (story && typeof story.connectionId === 'string' && story.connectionId) await db.stories.update(story.id, { connectionId: null });
    quickAllFor = null; /* M638: chosen — the switch goes back to the few */
    if (leaving && leaving.id !== id) await noteQuickRecent(leaving.id);
    await noteQuickRecent(id);
    await refreshQuickSwitch();
    refreshEmber(); /* the room line is the new storyteller's */
    planAhead(); /* M510: a small model taking the tale gets its plan now, while he types */
  }
  if (els.quickSwitch) els.quickSwitch.addEventListener('change', async () => {
    /* M652: THE MODEL HE PICKED IS TAKEN AT THE PICK. The switch was read after `await activeStory()` — and the switch is
     * redrawn whenever a page lands or the story changes (refreshQuickSwitch sets it back to the model in use): a redraw
     * in that wait, and the model he had just chosen was read as the one he was leaving. Nothing switched. */
    const picked = els.quickSwitch.value;
    const story = await activeStory();
    if (!story) return;
    if (picked === QUICK_ALL || picked === QUICK_FEW) {
      /* M638: not a model — the other list. Nothing about who tells the story changes: the switch shows the storyteller
       * again, over the whole list (opened at once where the browser lets a page do that; else one more tap) or the few. */
      quickAllFor = picked === QUICK_ALL ? story.id : null;
      await refreshQuickSwitch();
      if (picked === QUICK_ALL) { try { if (typeof els.quickSwitch.showPicker === 'function') els.quickSwitch.showPicker(); } catch (err) { /* one more tap shows it */ } }
      return;
    }
    await useConnection(picked);
  });
  /* M510: THE PLANNING HELPER, READING AHEAD. After each page (the chain's last link), the moment the Quick switch or
   * Settings hands a tale to a small model, and on opening such a tale: the helper reads the whole story and keeps what
   * the next page needs, under the page it was made after. Only when this tale's storyteller is a small model — for any
   * other connection nothing is asked, nothing is kept. Noted like every reader, so a send waits for it (the M3 five
   * seconds) and otherwise goes with the whole request. */
  async function planNext(story, { signal, stale = () => false } = {}) {
    const teller = await resolveConnection(story);
    if (!isSmallModel(teller)) return { silent: true };
    const connection = await resolveWorkerConnection(story, 'planner');
    if (!connection) return { silent: true };
    const pagesAll = visiblePages(await db.messages.list(story.id));
    const lastPage = [...pagesAll].reverse().find((m) => m && m.role === 'assistant' && !m.ooc && pageText(m).trim());
    const forKey = planKey(lastPage);
    const hash = hashText(lastPage ? pageText(lastPage) : '');
    const have = await planEntry(story.id, forKey);
    if (have && have.hash === hash) return { silent: true }; /* M510-6: planned, and the page's words have not changed since */
    const state = await loadState(story.id);
    const fresh = (await db.stories.get(story.id)) || story;
    const mods = await listModules();
    const craftMod = mods.find((m) => m && m.id === 'core-craft');
    const craft = craftMod && typeof craftMod.text === 'string' ? craftMod.text : '';
    const lawNames = lawsOf(craft).filter((l) => !l.preamble).map((l) => l.name);
    const big = 400000;
    const recentText = pagesAll.slice(-3).map((m) => pageText(m));
    const facts = planFacts(state, { ...planStateView(big), scenePages: recentText });
    const people = (planPeople(state, { recentPages: recentText, rotation: pagesAll.length, view: planPeopleView(big), brief: String(fresh.brief || '') + '\n' + String(fresh.castNotes || '') }) || {}).text || '';
    const record = wholeRecord(await loadMemory(story.id), Math.min(400000, Math.max(40000, Math.floor(contextOf(connection) * 3 * 0.45)))); /* M566: what the planner's own model holds — the newest kept, the cut said */
    const lore = matchLoreDetailed(await loadLore(story.id), recentText).text || '';
    const world = renderWorldBrief(state.worldBrief, state.turn, state.page, state) || '';
    const director = renderDirectorNote(await loadDirector(story.id)) || '';
    const kept = await loadPlans(story.id);
    const ls = kept && kept.lastSound;
    const lastSound = (kept && kept.loud === true ? 'The last pages drowned in sounds and dashes — name at most two sounds this time, only at the peak. ' : '') + (ls && ls.intense ? 'The last page was a fight or a heated scene; it carried ' + (ls.effects || 0) + ' contact sounds and ' + (ls.voiced || 0) + ' voiced sounds' + (!ls.effects && !ls.voiced ? ' — it went quiet where it should have been heard.' : '.') : ''); /* M519: the loud word first, then the heated page's count */
    const pages = lastPagesOf(pagesAll, PLAN_PAGES).map((m) => (m.role === 'user' ? 'The writer: ' : '') + pageText(m)); /* thirty of the storyteller's pages, his messages between them */
    const mc = mcName(state);
    /* M589: who is close by (behind the door he is at) may be planned too — a woman behind her door answers it */
    const present = [...(Array.isArray(state.present) ? state.present : []).map((p) => (typeof p === 'string' ? p : p && p.name)).filter(Boolean), ...closeBy(state).map((n) => n.key)];
    const ask = plannerAsk({ craft, brief: fresh.brief || '', castNotes: fresh.castNotes || '', facts, people, record, lore, world, director, pages, mc, lastSound });
    if (stale()) return { silent: true };
    const { plan, raw } = await runPlanner({ connection, storyId: story.id, forKey, hash, ask, present, mc, lawNames, signal });
    if (stale()) return { silent: true };
    if (!plan) return { detail: 'its answer could not be used', raw }; /* the next page goes whole, as before a plan existed */
    return { detail: 'read the story and planned the next page' + (plan.intense ? ' — a heated one' : '') };
  }
  /* M510-15: THE ESSENTIALS KEEPER — the whole record streamlined, rebuilt when the record changed; M510-48: for every
   * storyteller (his word: the hybrid always on) */
  async function essentialsNext(story, { signal, stale = () => false, force = false } = {}) {
    const connection = await resolveWorkerConnection(story, 'essentials');
    if (!connection) return { silent: true };
    const mem = await loadMemory(story.id);
    const fresh = (await db.stories.get(story.id)) || story;
    if (stale()) return { silent: true };
    const out = await runEssentials({ connection, storyId: story.id, nodes: mem && mem.nodes, brief: fresh.brief || '', mc: mcName(await loadState(story.id)), signal, force });
    if (stale()) return { silent: true };
    if (out.wrote) return { detail: 'streamlined the whole record into the story’s essentials' };
    return out.why === 'its answer could not be used' ? { detail: 'its answer could not be used' } : { silent: true };
  }
  /* M517: THE WORLD KEEPER — for a story whose brief is Automatic: built once from everything the story has, then looked at
   * again only when the record has grown (GROUND_EVERY more pages folded), the story's position in canon moved, or its canon start
   * changed — and then only the parts of the world that changed are rewritten. His own correction stands unless he asks
   * for it to be rebuilt (force). */
  async function groundNext(story, { signal, stale = () => false, force = false } = {}) {
    const fresh = (await db.stories.get(story.id)) || story;
    if (fresh.briefMode !== 'automatic') return { silent: true };
    const connection = await resolveWorkerConnection(fresh, 'essentials');
    if (!connection) return { silent: true };
    const key = GROUND_KEY(story.id);
    const have = (await db.settings.get(key)) || null;
    const mem = await loadMemory(story.id);
    const nodes = (mem && Array.isArray(mem.nodes) ? mem.nodes : []).filter((n) => n && !n.empty && typeof n.text === 'string' && n.text.trim() && Array.isArray(n.span)).sort((a, b) => a.span[0] - b.span[0]);
    const state = await loadState(story.id);
    const pages = await db.messages.list(story.id);
    const first = pages.find((m) => m && m.role === 'user' && !m.hidden);
    const opening = first ? String(first.typed || first.text || '') : '';
    const concept = /^\s*#story\b/i.test(opening) ? opening.replace(/^\s*#story\s*/i, '').trim() : '';
    const startWords = canonStartWords(await db.settings.get(CANON_START_KEY(story.id)));
    let arc = null;
    try { if (await canonOn(story.id)) { const meta = await canonMeta(story.id); const a = meta && meta.canon_grounding_arc; if (a && typeof a === 'object' && a.summary) arc = { title: String(a.title || ''), summary: String(a.summary || '') }; } } catch (err) { arc = null; }
    const wiki = await wikiLinesFor(story.id); /* M549: who holds which seat, from the wiki — never the keeper's memory */
    const ess = await loadEssentials(story.id);
    const covered = nodes.reduce((mx, n) => Math.max(mx, n.span[1] + 1), 0); /* pages folded into the record — they only grow */ /* M575: no spread */
    const since = have && Number.isFinite(have.recordLines) ? nodes.filter((n) => n.span[1] >= have.recordLines) : nodes.slice(-12);
    const fp = (t) => fingerprint36(String(t || '')); /* M575: one fingerprint */
    const input = {
      concept, brief: String(fresh.brief || ''), canonStart: startWords, arc,
      ledger: { place: state && state.place, factions: state && state.factions, worldBrief: state && state.worldBrief },
      essentials: ess && typeof ess.text === 'string' ? ess.text : '',
      recent: since.slice(-12).map((n) => n.text),
      arcChanged: Boolean(have && arc && have.arcTitle !== arc.title),
      startChanged: Boolean(have && startWords && have.start !== fp(startWords)),
      startFingerprint: startWords ? fp(startWords) : '',
      briefChanged: Boolean(have && (have.briefFp || '') !== fp(String(fresh.brief || '').trim())), /* M518-2: he rewrote his brief */
      briefFingerprint: fp(String(fresh.brief || '').trim()),
      wiki, wikiFingerprint: fp(wiki.join('\n')), wikiChanged: Boolean(have && wiki.length && (have.wikiFp || '') !== fp(wiki.join('\n'))), /* M549 */
      foundWrong: have && Array.isArray(have.droppedWorld) ? have.droppedWorld.slice(-30) : [], /* M552: what the wiki already showed wrong is never written back */
      /* M528: A PAGE THE WORLD CAME FROM WAS REWRITTEN (his edit, a swipe of an older page): the record's lines over the pages
       * the world was last looked at no longer read the same — it looks again at what changed */
      recordPrint: fp(nodes.filter((n) => n.span[1] < covered).map((n) => n.text).join('\n')),
      recordChanged: Boolean(have && have.recordPrint && Number.isFinite(have.recordLines) && fp(nodes.filter((n) => n.span[1] < have.recordLines).map((n) => n.text).join('\n')) !== have.recordPrint && covered >= have.recordLines),
    };
    if (stale()) return { silent: true };
    const out = await runGround({ connection, have, input, recordLines: covered, force, signal });
    if (stale() || !out.wrote) return out.why === 'its answer could not be used' ? { detail: 'its answer could not be used' } : { silent: true };
    await db.settings.set(key, { ...out.ground, rules: GROUND_RULES, wikiFp: input.wikiFingerprint }); /* M549 */
    if (!have || force) return { detail: 'wrote the world of the story — the brief is automatic' };
    return out.changed ? { detail: 'the world changed — rewrote the parts that moved' } : { silent: true };
  }
  /* M527: the placing of a tale already under way — the same rules as the send path's (M516/M526): its #story line, else
   * (a SillyTavern chat brought in, a tale begun before #story) its brief and its first page; once, again when that line
   * changed, a failed ask again after six hours; never over his own correction; its own clock left alone (no canon date) */
  /* M549/M550: THE WIKI'S LINES — each canon person canon verification looked up, their identity as the wiki has it (the
   * series as it ends), seen through his story's lens (a seat his premise changed is not said); none with canon off. One
   * home, read by the world keeper (the automatic brief) and by the check of where the story began. */
  async function wikiLinesFor(storyId) {
    try {
      if (!(await canonOn(storyId))) return [];
      const meta = await canonMeta(storyId);
      const cache = meta && meta.canon_grounding_cache && typeof meta.canon_grounding_cache === 'object' ? meta.canon_grounding_cache : {};
      const lines = [];
      for (const [k, entry] of Object.entries(cache)) {
        if (!entry || !entry.found || !entry.dossier) continue;
        const seen = throughLens(entry, overlayFor(meta, entry));
        const who = String((entry.dossier && entry.dossier.name) || entry.name || k).trim();
        const id = String((seen.dossier && seen.dossier.identity) || '').replace(/\s+/g, ' ').trim();
        if (who && id) lines.push(who + ' — ' + id);
      }
      return lines.sort().slice(0, 40);
    } catch (err) { return []; }
  }
  /* M551: EVERYTHING THE WIKI SAYS OF THE PEOPLE LOOKED UP (agents/canoncheck.js wikiMaterial) — for the checks, never for the
   * storyteller: identity, summary, facts, abilities, ties, biography, through the lens; the people the claims name first */
  async function wikiFullFor(storyId, claimsText = '') {
    try {
      if (!(await canonOn(storyId))) return [];
      return wikiMaterial(await canonMeta(storyId), { claims: claimsText });
    } catch (err) { return []; }
  }
  async function canonArcOf(storyId) {
    try { const meta = await canonMeta(storyId); const a = meta && meta.canon_grounding_arc; return a && typeof a === 'object' && a.summary ? { title: String(a.title || ''), summary: String(a.summary || '') } : null; } catch (err) { return null; }
  }
  /* M550: WHERE THE STORY BEGAN, CHECKED AGAINST THE WIKI (agents/canonstart.js) — a fact the wiki shows cannot be true at the
   * story's moment is let go; never his own correction; asked only when the facts or the wiki's lines changed since */
  async function checkStartNext(story, { signal, stale = () => false } = {}) {
    const key = CANON_START_KEY(story.id);
    const start = await db.settings.get(key);
    if (!start || (typeof start.words === 'string' && start.words.trim()) || !start.series || !Array.isArray(start.facts) || !start.facts.length) return { silent: true };
    const wiki = await wikiFullFor(story.id, start.facts.join('\n')); /* M551: everything the wiki says, not one line */
    if (!wiki.length) return { silent: true };
    const print = startCheckPrint(start, wiki);
    if (start.checkedFp === print || stale()) return { silent: true };
    const fresh = (await db.stories.get(story.id)) || story;
    const connection = await resolveWorkerConnection(fresh, 'canon');
    if (!connection) return { silent: true };
    const out = await checkCanonStart({ connection, start, wiki, arc: await canonArcOf(story.id), signal });
    if (stale() || !out) return { silent: true }; /* no answer: asked again later */
    const now = await db.settings.get(key);
    if (!now || (typeof now.words === 'string' && now.words.trim()) || startCheckPrint(now, wiki) !== print) return { silent: true }; /* changed meanwhile */
    await db.settings.set(key, applyStartCheck(now, out.wrong, wiki));
    return out.wrong.length ? { detail: 'checked where the story began against the wiki — let go of ' + out.wrong.length + (out.wrong.length === 1 ? ' line' : ' lines') + ' it shows cannot be true' } : { silent: true };
  }
  /* M551: THE AUTOMATIC BRIEF, CHECKED THE SAME WAY — each sentence of the world against everything the wiki says; a sentence
   * the wiki shows cannot be true now is let go; never his own words; asked again only when the world or the wiki changed */
  async function worldCheckNext(story, { signal, stale = () => false } = {}) {
    const fresh = (await db.stories.get(story.id)) || story;
    if (fresh.briefMode !== 'automatic') return { silent: true };
    const key = GROUND_KEY(story.id);
    const ground = await db.settings.get(key);
    if (!ground || !ground.parts || ground.by === 'writer') return { silent: true };
    const claims = worldClaims(ground.parts);
    if (!claims.length) return { silent: true };
    const texts = claims.map((c) => c.text);
    const wiki = await wikiFullFor(story.id, texts.join('\n'));
    if (!wiki.length) return { silent: true };
    const print = claimsPrint(texts, wiki);
    if (ground.checkedFp === print || stale()) return { silent: true };
    const connection = await resolveWorkerConnection(fresh, 'canon');
    if (!connection) return { silent: true };
    const start = (await db.settings.get(CANON_START_KEY(story.id))) || {};
    const arc = await canonArcOf(story.id);
    const moment = [start.series, arc && arc.title ? arc.title : start.arc, arc && arc.title ? 'where the story stands now' : start.moment].filter(Boolean).join(' — ');
    const out = await checkClaims({ connection, moment, claims: texts, material: wiki, arc, label: 'THE WORLD AS THE STORY HOLDS IT NOW:', signal });
    if (stale() || !out) return { silent: true }; /* no answer: asked again later */
    const now = await db.settings.get(key);
    if (!now || !now.parts || now.by === 'writer' || claimsPrint(worldClaims(now.parts).map((c) => c.text), wiki) !== print) return { silent: true }; /* changed meanwhile */
    const parts = out.wrong.length ? worldWithout(now.parts, claims, out.wrong) : now.parts;
    const gone = out.wrong.map((n) => claims[n] && claims[n].text).filter(Boolean);
    await db.settings.set(key, { ...now, parts, checkedFp: claimsPrint(worldClaims(parts).map((c) => c.text), wiki), droppedWorld: [...(Array.isArray(now.droppedWorld) ? now.droppedWorld : []), ...gone] });
    return gone.length ? { detail: 'checked the world against the wiki — let go of ' + gone.length + (gone.length === 1 ? ' line' : ' lines') + ' it shows cannot be true' } : { silent: true };
  }
  async function placeNext(story, { signal, stale = () => false } = {}) {
    const fresh = (await db.stories.get(story.id)) || story;
    const key = CANON_START_KEY(story.id);
    const pages = await db.messages.list(story.id);
    if (!pages.some((m) => m && m.role === 'assistant')) return { silent: true };
    const first = pages.find((m) => m && m.role === 'user' && !m.hidden);
    const words = first ? String(first.typed || first.text || '') : '';
    let concept = /^\s*#story\b/i.test(words) ? words.trim().replace(/^#story\s*/i, '').trim() : '';
    if (!concept) {
      const firstPage = pages.find((m) => m && m.role === 'assistant' && !m.hidden);
      concept = [String(fresh.brief || '').trim(), firstPage ? String(pageText(firstPage) || '').slice(0, 1500) : ''].filter(Boolean).join('\n\n');
    }
    if (!concept) return { silent: true };
    const had = await db.settings.get(key);
    const moved = Boolean(had && !had.words && had.conceptFp && had.conceptFp !== hashText(concept));
    const due = !had || moved || (had.tried && !had.series && !had.words && !had.none && Date.now() - had.tried > 6 * 3600 * 1000);
    if (!due || stale()) return { silent: true };
    const placer = await resolveWorkerConnection(fresh, 'founder');
    if (!placer) return { silent: true };
    const got = await placeInCanon({ connection: placer, concept, brief: fresh.brief || '', signal });
    if (stale()) return { silent: true };
    if (got && got.start) { await db.settings.set(key, { ...got.start, when: '', conceptFp: hashText(concept), at: Date.now() }); return { detail: 'placed the story in its canon — ' + got.start.series + (got.start.arc ? ', ' + got.start.arc : '') }; }
    if (got && got.none) { await db.settings.set(key, { none: true, conceptFp: hashText(concept), at: Date.now() }); return { silent: true }; }
    if (got && got.failed) return { silent: true }; /* M536: a failed call is not an answer — the next page's chain asks again */
    await db.settings.set(key, { tried: Date.now() });
    return { silent: true };
  }
  /* M517: "Rebuild from the story" (and switching the brief to Automatic) — the world keeper asked now */
  async function remakeGround({ force = true } = {}) {
    const story = await activeStory();
    if (!story) return { ok: false };
    const promise = enqueueWork(story.id, { name: 'ground', run: async ({ signal, stale }) => groundNext(story, { signal, stale, force }) });
    noteWork(story.id, promise);
    try { await promise; } catch (err) { /* the book says what stands */ }
    return { ok: true };
  }
  /* final audit: "Make the essentials again" — the essentials keeper asked now, from the whole record, whatever it kept */
  async function remakeEssentials() {
    const story = await activeStory();
    if (!story) return { ok: false };
    const promise = enqueueWork(story.id, { name: 'essentials', run: async ({ signal, stale }) => essentialsNext(story, { signal, stale, force: true }) });
    noteWork(story.id, promise);
    try { await promise; } catch (err) { /* the book says what stands */ }
    return { ok: true };
  }
  /* M510-22: THE PLANS KEEPER — a plan laid out on the page, written down whole; M510-48: for every storyteller */
  async function plansNext(story, { signal, stale = () => false } = {}) {
    const connection = await resolveWorkerConnection(story, 'plans');
    if (!connection) return { silent: true };
    /* M674: an out-of-character page says so — "((what would be a good plan for the raid?))" and its answer were read as
     * pages on which the story's people lay out a plan, and the plan written down to be kept until it was carried out */
    const shown = visiblePages(await db.messages.list(story.id));
    const pages = shown.map((m, i) => ({ n: i + 1, who: asideAt(shown, i) ? asideWho(m.role) : (m.role === 'user' ? 'the writer' : 'the storyteller'), text: typeof m.text === 'string' ? m.text : '' }));
    const mc = mcName(await loadState(story.id));
    if (stale()) return { silent: true };
    const out = await runPlans({ connection, storyId: story.id, pages, mc, signal });
    if (stale()) return { silent: true };
    if (out.wrote && (out.fresh || out.progress || out.closed)) {
      return { detail: [out.fresh ? out.fresh + (out.fresh === 1 ? ' plan' : ' plans') + ' written down' : '', out.progress ? out.progress + ' moved on' : '', out.closed ? out.closed + ' ended' : ''].filter(Boolean).join(', ') };
    }
    return out.why === 'its answer could not be used' ? { detail: 'its answer could not be used' } : { silent: true };
  }
  function planAhead() {
    (async () => {
      const story = await activeStory();
      if (!story) return;
      /* M510-56: THE KEEPERS RUN FOR EVERY STORYTELLER. His ongoing story, told by a frontier model, never got its
       * essentials: M510-48 opened the essentials and plans keepers to every storyteller — but they were queued only from
       * here, after the small model's gate, so for a frontier storyteller they were never asked, the essentials never
       * made, and the hybrid never began. The essentials keeper is asked here for every storyteller (it asks a model only when
       * the record changed or none were made); the planning helper and the plans keeper's reading on open stay the small
       * model's — the plans keeper reads every page after it is written, for everyone. */
      const small = isSmallModel(await resolveConnection(story));
      if (small) {
        const promise = enqueueWork(story.id, { name: 'planner', run: async ({ signal, stale }) => planNext(story, { signal, stale }) });
        noteWork(story.id, promise);
      }
      const kept = enqueueWork(story.id, { name: 'essentials', run: async ({ signal, stale }) => essentialsNext(story, { signal, stale }) }); /* M510-15 */
      noteWork(story.id, kept);
      offerChoices(story); /* M548: a page that has none yet, with the switch on */
      /* M550: on open, only what is due to be REPAIRED — opening a tale to look at it otherwise asks no one: where it began,
       * checked against the wiki (asks only while unchecked); and an automatic brief written under the old rules (when a seat
       * could come from the keeper's memory) written again, once — so the very next page already reads them right */
      const checked = enqueueWork(story.id, { name: 'startcheck', run: async ({ signal, stale }) => checkStartNext(story, { signal, stale }) });
      noteWork(story.id, checked);
      const world = story.briefMode === 'automatic' ? await db.settings.get(GROUND_KEY(story.id)) : null;
      if (world && world.parts && world.by !== 'writer' && world.rules !== GROUND_RULES) {
        const ground = enqueueWork(story.id, { name: 'ground', run: async ({ signal, stale }) => groundNext(story, { signal, stale }) });
        noteWork(story.id, ground);
      }
      const worldChecked = enqueueWork(story.id, { name: 'worldcheck', run: async ({ signal, stale }) => worldCheckNext(story, { signal, stale }) }); /* M551: asks only while unchecked */
      shareCheckpoints(story.id).catch(() => {}); /* M570: a tale's older checkpoints shared once — its book shrinks; under the bank's own lock */
      noteWork(story.id, worldChecked);
      /* the plans keeper reads each page after it is written (the page chain, every storyteller); asked on open only for a
       * small model, whose helper plans before the first send — opening a story to look at it asks no one else anything */
      if (small) {
        const plans = enqueueWork(story.id, { name: 'plans', run: async ({ signal, stale }) => plansNext(story, { signal, stale }) }); /* M510-22 */
        noteWork(story.id, plans);
      }
    })().catch(() => {});
  }
  const roomOf = (connection) => contextOf(connection);

  /* M337: a ledger holding lines dated after its tale's last page is healed on open — never while a page is being written or
   * read (the stamp runs one ahead of the store then), and it says what it took out */
  const healedFuture = new Set();
  async function takeOutTheFuture(story) {
    try {
      /* (a plain look at the queue — never a wait) */
      if (!story || busy || replaying || workIsRunning(story.id) || queuedCount(story.id) > 0) { healedFuture.delete(story && story.id); return 0; }
      const pagesNow = (await db.messages.list(story.id)).filter((m) => m && m.role === 'assistant' && !m.hidden).length;
      const r = dropTheFuture(await loadState(story.id), pagesNow);
      const n = r.facts.length + r.threads + r.factions;
      if (!n && !r.journal) return 0;
      await saveState(story.id, r.state);
      notify(story.id);
      if (n) toast(n + (n === 1 ? ' line' : ' lines') + ' in this tale’s ledger ' + (n === 1 ? 'was' : 'were') + ' dated AFTER its last page — from pages this tale does not have (another branch’s future). Taken out' + (r.facts.length ? ': “' + r.facts[0] + '”' + (r.facts.length > 1 ? ' and ' + (r.facts.length - 1) + ' more' : '') : '') + '.');
      return n;
    } catch (err) { return 0; }
  }

  /* M332: A BRANCH THAT WAS INTERRUPTED IS MADE AGAIN, WHOLE. Nothing can be `building` when a page loads — anything found
   * so was cut off by a refresh. The half-made tale is cleared away (it was never on the shelf and never pushed) and
   * the branch is taken again from the tale and the page it names; if those are gone, he is told. Once per load. */
  let healedBranches = false;
  async function healInterruptedBranches() {
    if (healedBranches) return; healedBranches = true;
    try {
      const cut = (await db.stories.list()).filter((st) => st && st.building && typeof st.building === 'object');
      for (const half of cut) {
        const { from, at } = half.building;
        try { await db.stories.remove(half.id); } catch (err) { /* swept at the next open */ }
        const parent = from ? await db.stories.get(from) : null;
        const page = parent ? (await db.messages.list(from)).find((m) => m.id === at) : null;
        if (!parent || !page || parent.shallow) { toast('A branch was cut off before it was finished and has been cleared away. The tale it was taken from is untouched' + (parent && parent.shallow ? ' — open it and branch again.' : '.')); continue; }
        ctx.setActiveStoryId(from);
        await refreshStories(true);
        await renderThread({ structural: true, opening: true });
        toast('A branch was cut off before it was finished (the page was refreshed) — the house is making it again, whole.');
        await branchFrom(at);
      }
    } catch (err) { /* never a reason to fail the open */ }
  }

  /* M331: WHAT WAS ALREADY CHANGED AWAY FROM THE BRIEF IS PUT BACK — EXACTLY, IN CODE. The writer, after M330: "so should I
   * manually edit 17 back to 16, or just continue?" Neither should be his to do. Two kinds of change keep their
   * earlier words: a MEND (page.mended.before) and a HOUSEKEEPER edit (its undo shelf: batches[].items[kind:'message']
   * .before). For each, the one fact that differs between the earlier words and the page as it stands now is read
   * (factChange) — and when that change goes AGAINST the brief (the brief or cast notes state the old value, in words
   * or figures, and not the new one) the earlier words go back, to the letter. No model is asked. A page edited
   * again since (more than that one fact differs) is left alone; so is any change the brief does not settle. The
   * record line over a restored page is let go to be folded again, and the auditor is sent. */
  async function putBackAgainstBrief(story) {
    try {
      const fresh = await db.stories.get(story.id);
      const setDown = [fresh && fresh.brief, fresh && fresh.castNotes];
      if (!setDown.some((t) => String(t || '').trim())) return 0;
      const earlier = new Map(); /* page id → its earlier text, the OLDEST earlier words winning */
      const root = await loadSessionRoot(story.id);
      for (const b of (root.batches || [])) for (const it of (b.items || [])) if (it && it.kind === 'message' && it.before && typeof it.before.text === 'string' && !earlier.has(it.messageId)) earlier.set(it.messageId, it.before.text);
      const all = await db.messages.list(story.id);
      for (const m of all) if (m && m.mended && typeof m.mended.before === 'string' && !earlier.has(m.id)) earlier.set(m.id, m.mended.before);
      let back = 0; let said = '';
      for (const m of all) {
        if (!m || m.role !== 'assistant' || !earlier.has(m.id)) continue;
        const before = earlier.get(m.id); const now = pageText(m);
        const change = factChange(before, now);
        if (!change || !againstTheBrief(setDown, change.removed, change.added)) continue;
        const patch = shownTextPatch(m, before, { mended: null }); /* M575: one home */
        await db.messages.update(story.id, m.id, patch);
        /* (M44-6 counts the four moments a page's line is let go by their literal; this fifth is named apart) */
        try { const vis = visiblePages(await db.messages.list(story.id)); const holeAt = vis.findIndex((x) => x.id === m.id); if (holeAt !== -1 && (await keeperOnFor(story))) { const record = await loadMemory(story.id); await saveMemory(story.id, memoryWithoutPage(record, holeAt)); } } catch (err) { /* the keeper's next pass covers it */ }
        await rerenderMessage(story.id, m.id);
        back += 1; said = '“' + change.added + '” back to “' + change.removed + '”';
      }
      if (back) { pendingAudit.add(story.id); toast(back + (back === 1 ? ' page' : ' pages') + ' had been changed AWAY from your brief — put back, to the letter (' + said + '). Nothing for you to do.'); }
      return back;
    } catch (err) { return 0; }
  }

  async function rippleAfterEdit(story, pageId, before, after, { who = 'the writer' } = {}) {
    const change = factChange(before, after);
    if (!change) return;
    const { removed, added } = change;
    const promise = enqueueWork(story.id, { name: 'ripple', run: async ({ signal, stale }) => {
      if (stale()) return { silent: true };
      const all = await db.messages.list(story.id);
      const others = all.filter((m) => m && !m.hidden && m.role === 'assistant' && m.id !== pageId && hasWord(pageText(m), removed));
      let words = [];
      if (isNameLike(removed) && isNameLike(added)) {
        /* the ledger */
        const st = await loadState(story.id);
        /* M191: A CORRECTION IS NOT A NEW RENAME. The ripple makes one
         * changed fact true EVERYWHERE, which is right when a name was
         * simply wrong — and wrong when the writer is undoing a rename that
         * went too far. Rename the coach Alex to Wood and the sweep takes
         * Alexia's "don't call me Alex" with it; fix that one line by hand
         * and this saw a name change Wood→Alex and renamed the coach BACK,
         * so the story flipped between all-Alex and all-Wood and never
         * settled. If the journal shows this browser renaming added→removed
         * already, the writer is walking one of those back: it holds on this
         * page and goes no further. */
        const undoingRename = (Array.isArray(st.journal) ? st.journal : []).slice(-400).some((j) => {
          const m = j && j.m;
          return m && m.type === 'people.rename'
            && String(m.from || '').trim().toLowerCase() === String(added).trim().toLowerCase()
            && String(m.to || '').trim().toLowerCase() === String(removed).trim().toLowerCase();
        });
        if (undoingRename) {
          return { silent: false, detail: '“' + removed + '” is “' + added + '” on this page. The rest of the story keeps “' + removed + '” — this reads as walking back a rename, not a new one.' };
        }
        const r = applyMutations(st, [{ type: 'people.rename', from: removed, to: added, cause: who + '’s edit' }]);
        if (r.applied.length) { await saveState(story.id, r.state); notify(story.id); words.push(r.applied[0].words.replace(/\.$/, '')); }
        /* the record */
        const mem = await loadMemory(story.id);
        let touched = 0;
        const nodes = mem.nodes.map((n) => (typeof n.text === 'string' && hasWord(n.text, removed) ? (touched += 1, { ...n, text: replaceWord(n.text, removed, added) }) : n));
        if (touched) { await saveMemory(story.id, { ...mem, nodes }); words.push(touched + ' record ' + (touched === 1 ? 'line' : 'lines')); }
        /* the brief and the cast notes — the writer's own words follow the writer's newest word */
        const fresh = await db.stories.get(story.id);
        const patch = {};
        if (fresh && typeof fresh.brief === 'string' && hasWord(fresh.brief, removed)) patch.brief = replaceWord(fresh.brief, removed, added);
        if (fresh && typeof fresh.castNotes === 'string' && hasWord(fresh.castNotes, removed)) patch.castNotes = replaceWord(fresh.castNotes, removed, added);
        if (Object.keys(patch).length) { await db.stories.update(story.id, patch); words.push('the brief'); }
        /* every other page, as a mend with its take-back */
        let pages = 0;
        for (const m of others) {
          if (stale()) break;
          const text = pageText(m);
          const next = replaceWord(text, removed, added);
          if (next !== text && (await applyMend(story.id, m, next, who + ' changed “' + removed + '” to “' + added + '”'))) pages += 1; /* M675: counted when it landed */
        }
        if (pages) words.push(pages + ' other ' + (pages === 1 ? 'page' : 'pages'));
        return { silent: false, detail: '“' + removed + '” is “' + added + '” everywhere now' + (words.length ? ' — ' + words.join(', ') : '') };
      }
      /* M330: THE BRIEF WINS, HERE TOO. A value the brief or the cast notes state (in words or figures) and whose
       * replacement they do not is the writer's own canon. The housekeeper's change away from it is NOT carried to
       * the rest of the story: the auditor is sent to hold that page to the brief (M90 mends it back). The
       * writer's own hand is his newest word and ripples — and he is told his brief still says the old one. */
      const freshStory = await db.stories.get(story.id);
      const setDown = [freshStory && freshStory.brief, freshStory && freshStory.castNotes];
      if (againstTheBrief(setDown, removed, added)) {
        if (who !== 'the writer') {
          pendingAudit.add(story.id);
          return { silent: false, detail: '“' + removed + '” → “' + added + '” was NOT carried to the rest of the story: the brief says “' + removed + '”. The auditor will hold that page to the brief.' };
        }
        toast('Your brief still says “' + removed + '”. The pages now say “' + added + '” — change the brief too, or the auditor will hold the pages to it.');
      }
      /* a fact that is not a name: the mender, page by page. M330: and NO "[Correction]" in the record — see below */
      const connection = await resolveWorkerConnection(story, 'continuity');
      let mended = 0;
      if (connection && others.length) {
        const contradiction = who + ' changed “' + removed + '” to “' + added + '” on a page; everywhere else the story still says “' + removed + '”. It should read “' + added + '”.';
        try {
          const changed = await mendAround(story, connection, [others[others.length - 1].id], contradiction, signal, Math.min(20, all.length));
          mended = changed.length;
        } catch (err) { /* the correction below carries the truth forward */ }
      }
      /* M330: NO COMMENT IS LEFT IN THE RECORD. This wrote "[Correction] “sixteen” is now “seventeen” (the housekeeper's
       * edit); what said otherwise before is in error." — a note ABOUT the story, in the story's own record, read by
       * the storyteller on every turn for ever. The writer: "there should be no corrections — everything should be
       * edited already, directly, not just given a comment." It already is: a mended page lets its record line go and
       * the keeper folds it again from the corrected words (applyMend, M90); the edited page's own line goes the
       * same way (pageReinked, M296); the auditor relocks the ledger on the next page. The facts live in the pages,
       * the record and the ledger — nowhere as a remark. */
      pendingAudit.add(story.id); /* the auditor relocks the canon on the next page */
      return { silent: false, detail: '“' + removed + '” → “' + added + '”' + (mended ? ' — ' + mended + ' other ' + (mended === 1 ? 'page' : 'pages') + ' mended' : others.length ? ' — the other pages will be held to it' : '') };
    } });
    noteWork(story.id, promise);
  }

  async function auditNow() {
    const banner = beginWork('Auditing the ledger', (tale) => { const s = tale || ctx.getActiveStoryId(); if (s) stoppedByHand(s); banner.failed('Stopped — what was folded is kept; Rebuild starts again from page one'); });
    const story = await activeStory();
    if (!story) { banner.failed('Open a story first'); return false; } /* M675: an early return ends the banner too, as every other action's does */
    const connection = await resolveWorkerConnection(story, 'auditor');
    if (!connection) { banner.failed('The auditor needs a connection first'); return false; }
    const promise = enqueueWork(story.id, { name: 'auditor', run: async ({ signal, stale, renew }) => {
      let result = await auditLedger({ connection, storyId: story.id, brief: story.brief || '', castNotes: story.castNotes || '', castNames: await castNamesFor(story), signal, stale, renew, canonRecord: await canonRecordOf(story) });
      if (result && !stale()) result = await resolveBriefWins(story, connection, result, signal, renew);
      return { silent: false, detail: auditRunWords(result), raw: result && result.raw };
    } });
    noteWork(story.id, promise);
    banner.say('reading the whole ledger');
    bannerFollows(banner, story, 'The ledger was audited', promise);
    return true;
  }

  /* M474: "Weigh them again" — the writer raised a skill in the brief and asked how to refresh the measure. The seeder
   * runs now, by hand, on the brief and the pages as they stand; a considered rating of the seeder's still only rises
   * (growth), and a number he set by hand is never touched. */
  async function weighCast() {
    const banner = beginWork('Weighing the cast', (tale) => { const s = tale || ctx.getActiveStoryId(); if (s) stoppedByHand(s); banner.failed('Stopped — the sheet is as it was'); });
    const story = await activeStory();
    if (!story) { banner.failed('Open a story first'); return false; } /* M675 */
    if (!(await refereeSettings()).on) { banner.failed('The referee is off — the sheet is the referee’s'); return false; }
    const connection = await resolveWorkerConnection(story, 'referee');
    if (!connection) { banner.failed('The referee needs a connection first'); return false; }
    const promise = enqueueWork(story.id, { name: 'seeder', run: async ({ signal, renew }) => {
      const result = await maybeSeedSheet({ connection, storyId: story.id, signal, renew, force: true, brief: story.brief || '', castNotes: story.castNotes || '' });
      return { silent: false, detail: result && result.ok ? 'the cast weighed again — ' + (result.touched || 0) + ' considered' : 'the weighing brought nothing usable' };
    } });
    noteWork(story.id, promise);
    banner.say('reading the brief and the pages');
    bannerFollows(banner, story, 'The cast was weighed again', promise);
    return true;
  }

  /* M510-34: what the finisher took off, in his words for the drawer's list of mended pages */
  function tidyWhy(removed) {
    const shown = removed.slice(0, 3).map((r) => (/^(?:a World Beyond|\d+ World Beyond)/.test(r) ? r : '“' + (r.length > 90 ? r.slice(0, 89).trimEnd() + '…' : r) + '”'));
    return 'tidied — took off ' + shown.join('; ') + (removed.length > 3 ? ' and ' + (removed.length - 3) + ' more' : '') + ' (not the story)';
  }

  /* M675 — WHAT M669'S FINISHER GOT WRONG ON PAGES ALREADY KEPT IS PUT RIGHT BY THE HOUSE, FROM THE PAGE'S OWN EARLIER
   * WORDS. From M669 to M674 the finisher, taking the window's rule off the end of a paragraph, put what it kept back
   * together with a space between its sentences (a page whose paragraphs are set apart by one line break came out as a
   * single block; a letter or a verse lost its lines), and it took a few sentences of story for the rule (a place
   * called "the World Beyond"). It ran over every kept page of every tale opened in those builds. Each page it changed
   * kept its earlier words (mended.before) and says who changed it ("tidied — took off …"): such a page is finished
   * again from those words, by the rules as they stand now — when the page still says nothing the re-finished page does
   * not say, in the same order (only its line breaks differ, or the sentences wrongly taken are missing). A page whose
   * words he has changed since is his, and is left alone. Returns the patch, or null. */
  const FINISHER_OF_M669 = Date.UTC(2026, 9, 7);
  /* M675 (the second reading) — AND ONLY A PAGE NOBODY HAS TOUCHED SINCE THAT FINISHER LEFT IT. The test was "today's
   * finisher makes more of the earlier words than the page shows" — and a page whose ending HE had trimmed, or whose
   * line breaks he had set, shows exactly that: his edit was written over with the landed words (the reviewer, with
   * this function and the real finisher: a paragraph he had cut was back; his line breaks were gone), under a toast
   * that said only "marks were mended". An edit leaves no mark on a page, so the page is held to what the M669 finisher
   * ITSELF made of its earlier words (pageshape.js tidyPage `asM669`): only a page that still reads exactly so is
   * put right — one he has changed in any way is his. And the fault ended with this build: a page finished after it
   * is never looked at (FINISHER_PUT_RIGHT) — the test had no upper end, so every later page was in it at every
   * build to come. */
  const FINISHER_PUT_RIGHT = Date.UTC(2026, 9, 16);
  function refinishedFromEarlier(page, shown, mc) {
    const mend = page && page.mended;
    if (!mend || typeof mend.before !== 'string' || !/^tidied \u2014 took off /.test(String(mend.why || '')) || !(Number(mend.at) >= FINISHER_OF_M669) || !(Number(mend.at) < FINISHER_PUT_RIGHT)) return null;
    if (tidyPage(mend.before, { mc, finish: !page.ooc, asM669: true }).text !== shown) return null; /* not as that finisher left it: someone has changed it since */
    const again = tidyPage(mend.before, { mc, finish: !page.ooc });
    if (again.text === shown) return null;
    const took = Array.isArray(again.removed) && again.removed.length > 0;
    return shownTextPatch(page, again.text, { mended: took && again.text !== mend.before ? { before: mend.before, why: tidyWhy(again.removed), at: mend.at } : null });
  }

  /* M477: "Mend the pages' marks" — the page repair over every page already kept, by hand. tidyPage is marks and
   * white space only (brackets, the window's marker, a stray or open quote, an asterisk, a soft wrap); a page it would
   * not change is not written. No model, no ledger work; the readers need no re-read for a mark. */
  async function mendAllPages({ quiet = false, story: given = null } = {}) {
    const story = given || await activeStory();
    if (!story) return { mended: 0, of: 0 };
    const pages = (await db.messages.list(story.id)).filter((m) => m && m.role === 'assistant' && !m.hidden);
    const mcOfTale = mcName(await loadState(story.id));
    let mended = 0;
    /* M675 — NEVER ONE LONG HOLD OF THE SCREEN. This runs by itself the first time a tale is opened on a new build, over
     * every stored page, and each page costs a couple of milliseconds of plain computing (measured: 2.3 ms a page on a
     * desktop) with no pause between them: a tale of a thousand pages held the screen for more than two seconds — on
     * his phone several times that — right as he opened it. It works in short turns now (a dozen milliseconds, then the
     * screen has its turn); and when it runs by itself and he starts a page meanwhile it stops, to be taken up at the
     * next open (a page already repaired is passed over at once). */
    let turnBegan = Date.now();
    for (const page of pages) {
      if (Date.now() - turnBegan > 12) {
        await new Promise((r) => setTimeout(r, 0));
        turnBegan = Date.now();
        if (quiet && busy) return { mended, of: pages.length, stopped: true };
      }
      const before = String(pageText(page) || '');
      if (!before.trim()) continue;
      if (typeof page.keptText === 'string' && page.keptText === before) continue; /* M510-43: the words he put back stay as he put them */
      /* M675 (the second reading): WRITTEN FROM THE PAGE AS IT STANDS. Working in short turns (above) means the list read
       * at the start is old by the time a page is reached: a mend that landed meanwhile, a walk to another version, a
       * new telling of the page — each was written over with the words, the versions and the mend this repair had
       * read at the start (the very fault applyMend was cured of). Each write is decided on the row itself
       * (db.messages.change): a page that no longer reads as it did when it was looked at is left exactly as it is. */
      const redone = refinishedFromEarlier(page, before, mcOfTale); /* M675 */
      if (redone) {
        if (await db.messages.change(story.id, page.id, (now) => (pageText(now) !== before ? undefined : refinishedFromEarlier(now, before, mcOfTale) || undefined))) mended += 1;
        continue;
      }
      const t = tidyPage(before, { mc: mcOfTale, finish: !page.ooc }); /* M510-34: finished too — never an out-of-character answer */
      if (t.text === before) continue;
      const landed = await db.messages.change(story.id, page.id, (now) => {
        if (pageText(now) !== before || (typeof now.keptText === 'string' && now.keptText === before)) return undefined;
        const patch = shownTextPatch(now, t.text); /* M575: one home */
        if (Array.isArray(t.removed) && t.removed.length && !now.mended) patch.mended = { before, why: tidyWhy(t.removed), at: Date.now() };
        return patch;
      });
      if (landed) mended += 1;
    }
    if (mended && ctx.getActiveStoryId() === story.id && !busy) await renderThread({ structural: true }); /* M675: never a redraw of the thread under a page being told (M186) — the next draw shows them */
    if (!quiet) toast((mended ? (mended === 1 ? 'One page’s marks mended' : mended + ' pages’ marks mended') : 'Every page’s marks are whole already') + ' (the repair of ' + VERSION + ').'); /* M489-2: the build says which repair ran — "still the same" then names its cause */
    return { mended, of: pages.length };
  }

  /* M478/M479: THE BRIEF FROM A #STORY CONCEPT. The raw words are written first (this very turn's founder and seeder
   * read them), then a worker sets their spelling and grammar right — names and facts kept exactly, or the raw words
   * stand (agents/concept.js). By hand ("Write it from my #story concept") the concept is found on the tale's own
   * pages — the first #story he sent — and a brief already written is replaced only after he says so. */
  async function briefFromConcept({ story: given, concept: givenConcept, manual = false } = {}) {
    const story = given || await activeStory();
    if (!story) return { ok: false, why: 'no story' };
    let concept = String(givenConcept || '').trim();
    if (!concept) {
      const pages = await db.messages.list(story.id);
      const first = pages.find((m) => m && m.role === 'user' && /^#story\s+\S/i.test(String(m.typed || m.text || '').trim()));
      concept = first ? String(first.typed || first.text).trim().replace(/^#story\s*/i, '').trim() : '';
    }
    if (!concept) { if (manual) toast('No #story concept on this tale’s pages — write the brief by hand.'); return { ok: false, why: 'no concept' }; }
    if (manual && String(story.brief || '').trim()) {
      const yes = typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm('Replace the brief with your #story concept, its grammar set right? The brief as it stands is lost.')
        : true;
      if (!yes) return { ok: false, why: 'kept' };
    }
    try { await db.stories.update(story.id, { brief: concept }); story.brief = concept; } catch (err) { return { ok: false, why: 'the brief would not save' }; }
    if (ctx.settings && typeof ctx.settings.onStoriesChanged === 'function') ctx.settings.onStoriesChanged();
    const connection = await resolveWorkerConnection(story, 'founder');
    const r = await polishConcept({ connection, concept });
    if (r.polished && r.text && r.text !== concept) {
      const now = await db.stories.get(story.id);
      /* only if the brief is still the raw concept — never over words he wrote meanwhile */
      if (now && String(now.brief || '').trim() === concept) {
        await db.stories.update(story.id, { brief: r.text });
        story.brief = r.text;
        if (ctx.settings && typeof ctx.settings.onStoriesChanged === 'function') ctx.settings.onStoriesChanged();
        toast('Your concept is the brief now, its grammar set right — Settings → This story → The brief.');
        return { ok: true, polished: true };
      }
      return { ok: true, polished: false };
    }
    toast(r.refused ? 'Your concept is the brief now, as you typed it — the polish lost a name, so it was refused.' : 'Your concept is the brief now — Settings → This story → The brief.');
    return { ok: true, polished: false };
  }

  /* M35: the mend — the second reader (and the record's verifier) may edit
   * a storyteller page by the smallest amount so it stops contradicting the
   * record. The page remembers its earlier words (msg.mended) and shows a
   * "mended — take it back" chip. Off with the setting mendPages. */
  async function mendOn(story) {
    if (story && story.mend === false) return false;
    return (await db.settings.get('mendPages')) !== false;
  }

  /* M675 — A MEND LANDS ONLY ON THE WORDS IT MENDED (the audit of M674). `page` is the page as the mender was SHOWN it —
   * read before a model call that takes seconds, or a minute. Written back as a patch of that copy, a mend that returned
   * after he had moved on went wrong in two ways (replayed against the store before this was changed):
   *   - he walked to another version (◂ waits for nothing): the mended words of the version he left became the page's
   *     words while the other version was the one shown, wearing a mend that was never its own — and "Put the earlier
   *     words back" then wrote the left version's words over the shown one. A telling lost.
   *   - he asked for another version ("try again" keeps every version since M674): the copy's list had two tellings, the
   *     page by then three — the newest telling was written out of the list.
   * The mend is decided from the page as it stands, inside the row's own lock: the same words still shown — or nothing
   * is written at all, and the mender's work on words that no longer stand is let go. Returns whether it landed. */
  async function applyMend(storyId, page, after, why) {
    const before = String(page.text || '');
    const landed = await db.messages.change(storyId, page.id, (now) => (pageText(now) !== before ? undefined
      : shownTextPatch(now, after, { mended: { before, why: String(why || '').slice(0, 4000), at: Date.now() } }))); /* M268: the reason whole; M575: one home */
    if (!landed) return false;
    /* M90: the record line covering a mended page is let go, so the keeper
     * folds it again from the corrected words — or the record keeps narrating
     * the contradiction the page no longer contains (Summaryception's law). */
    /* M675 — NEVER A LINE IN HIS OWN WORDS, AND NEVER A LINE NOTHING WILL WRITE AGAIN. The line was let go whoever had
     * written it and whether or not anything would fold those pages again: a line he had rewritten by hand (or the
     * housekeeper changed for him) was simply gone after the house mended a page under it (the audit: a line marked
     * "the writer", one page fault under it — the page mended, his line gone from the record); and with this tale's
     * keeper switched off, the line let go was never folded again — a hole in the record where the storyteller had
     * known those pages. His line stays exactly as it is; and a line is only let go when the keeper is there to write
     * the one that takes its place. */
    try {
      const vis = visiblePages(await db.messages.list(storyId));
      const k = vis.findIndex((m) => m.id === page.id);
      /* (M675, the second reading: both halves now live where every such moment can use them — memory.js
       * memoryWithoutPage keeps his line, keeperOnFor says whether anyone will fold the hole) */
      if (k !== -1 && (await keeperOnFor(await db.stories.get(storyId)))) await saveMemory(storyId, memoryWithoutPage(await loadMemory(storyId), k));
    } catch (err) { /* the keeper's next pass covers the hole anyway */ }
    await rerenderMessage(storyId, page.id);
    return true;
  }

  /* M674: THE PAGES OF A RECORD LINE ARE COUNTED AMONG THE PAGES THAT SHOW. A line's span counts the pages of the thread
   * (memory.js visiblePages); the keeper's page faults were looked up in the store's whole list, hidden pages and all —
   * and every "Go on" leaves one hidden page behind, every page the housekeeper folds away is one. So in a tale with
   * five of them before the line, the mender was sent the pages five places EARLIER than the ones the fault was on:
   * it found nothing to mend there, or mended something else (walked: DOM-246). */
  async function pagesOfLine(storyId, span) {
    return visiblePages(await db.messages.list(storyId)).slice(span[0], span[1] + 1).map((m) => m.id);
  }

  async function mendAround(story, connection, pageIds, contradiction, signal, reach = 5, who = 'The second reader', recordBefore = null) { /* M673: who asked for the mend, and — for an old page — the record as it stood before it */
    if (!(await mendOn(story))) return [];
    /* M674: the pages handed to the mender are counted among the pages that show (the last page asked for and the
     * `reach` before it — a hidden page in between used to push one of the pages asked for out of the hand), and an
     * out-of-character page is never among them: his question to the storyteller and its answer are not the story,
     * and the mender — which may change any storyteller page it is shown — is not shown them. */
    const shown = visiblePages(await db.messages.list(story.id));
    const all = shown.filter((m, i) => !asideAt(shown, i));
    const wanted = new Set(pageIds);
    let last = -1; for (let i = 0; i < all.length; i += 1) if (wanted.has(all[i].id)) last = i; /* M575: no spread of a whole tale into Math.max */
    if (last === -1) return [];
    const pages = all.slice(Math.max(0, last - reach), last + 1);
    const mem = await loadMemory(story.id);
    const state = await loadState(story.id);
    const playerName = mcName(state) !== 'the player' ? mcName(state) : 'the player';
    const changed = await mendPages({
      connection,
      storyId: story.id,
      pages,
      contradiction,
      /* M265: it was cut at 30,000; M673: for a page long folded, the record as it stood before that page (in the same
       * room) — M675: and then the whole record is not built only to be thrown away */
      ...(typeof recordBefore === 'string' ? { record: recordBefore } : { record: wholeRecord(mem, Math.floor(roomChars(connection) * 0.35)) }),
      playerName,
      signal,
      apply: (page, after, why) => applyMend(story.id, page, after, why),
    });
    if (changed.length) toast(`${who} mended ${changed.length} ${changed.length === 1 ? 'page' : 'pages'} — the earlier words are a tap away.`);
    return changed;
  }

  async function unmend(messageId) {
    const story = await activeStory();
    if (!story) return;
    const all = await db.messages.list(story.id);
    const page = all.find((m) => m.id === messageId);
    if (!page || !page.mended) return;
    /* M510-43: HIS WORDS BACK, FOR GOOD. The mend of stored pages runs once per build on every tale (mendPagesOnOpen) and
     * by hand ("Mend the pages' marks"): a page he put back was finished again by the next build — the note he wanted
     * kept came off again, silently. The words he put back are remembered (keptText) and the stored-page mend leaves that
     * page alone while it still reads them; a new version of it (a swipe, an edit) is his to have mended again. */
    const patch = shownTextPatch(page, page.mended.before, { mended: null, keptText: page.mended.before }); /* M575: one home */
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

  /* M675 — A PAGE WHOSE READERS WERE CUT SHORT IS NOT A PAGE READ (the audit of M674). The version of the last page he
   * LEAVES keeps the ledger it earned (M40) — written down by whoever takes him away from it: a walk to another version,
   * or a new one asked for. Both wrote it down whether or not its readers had finished: "try again" a few seconds after
   * a page lands waits five seconds for them, then rewinds (which stops the rest), and the half-read ledger was kept as
   * that version's own. So:
   *   - the new telling fails, or he stops it: the page that stands got that half-read ledger "straight back", its
   *     scribe, world agent, second reader and auditor never to run — and with a checkpoint written for it, the house's
   *     own healer on open (resumeUnfinishedChain) took it for a page read whole;
   *   - it lands, and he later walks back: the same half-read ledger, for good.
   * Before M674 only ▸ went this way; "try again" does now, on every page he dislikes at first sight. What says a page was
   * read is that ITS OWN READERS have finished. They are counted here per page; while any is out, the version being left
   * earns no checkpoint (so it is read whole when it is next shown: the walk's "never read" road, and the healer on
   * open), and a telling that fails over it has the page read again instead of handing back what the cut readers left.
   * M675 (the second reading) — ITS OWN READERS, AND NO ONE ELSE. Every link up to the chain's checkpoint was counted:
   * the record keeper too (it writes the record, never the ledger — with two helpers at once it is still folding long
   * after the checkpoint is written, and a "try again" that failed then had the page read again, whole), and the
   * continuous audit with everything queued behind it (it reads OLDER pages, for up to a minute: a walk to the other
   * version in that minute left a page that had been read to its end without a checkpoint, and it was read whole again
   * on the way back). The count is the readers of this page — the founder to the auditor, on the ledger's own lane.
   * What stands after them (the audit of older pages, the once-a-tale tidies, the join, the checkpoint itself) is
   * upkeep the next chain does again; whoever takes him away from the page writes its checkpoint, as since M40. */
  const ledgerLinksOut = new Map(); /* 'tale:page' -> that page's own readers not yet settled */
  function noteLedgerLink(storyId, pageId, promise) {
    const key = storyId + ':' + pageId;
    ledgerLinksOut.set(key, (ledgerLinksOut.get(key) || 0) + 1);
    const settle = () => { const n = (ledgerLinksOut.get(key) || 1) - 1; if (n > 0) ledgerLinksOut.set(key, n); else ledgerLinksOut.delete(key); };
    promise.then(settle, settle);
  }
  const readersStillOn = (storyId, pageId) => (ledgerLinksOut.get(storyId + ':' + pageId) || 0) > 0;

  function startBackgroundWork(story, msg, userText, { deep = false, audit = false, refound = false } = {}) {
    offerChoices(story); /* M548: Choices matter — never in the chain, so no send waits for it */
    const gen = chainGen.get(story.id) || 0;
    /* M134: the clock as the chain begins — the world link measures how far this page moved it */
    const chainClock = { before: null };
    let ownReading = true; /* M675: the page's own readers — what "this page was read" means (see ledgerLinksOut) */
    const enqueue = (name, run, { once = false } = {}) => {
      /* M529: the record keeper, the sensors, the essentials, the placer, the world keeper and the plans keeper read the pages
       * and the record and write only their own books — with two workers at once they run in their own lane */
      const lane = SIDE_JOBS.has(name) ? 'side' : 'main';
      const promise = enqueueWork(story.id, { name, lane, ...(once ? { once: true } : {}), run: chainJob(run, () => (chainGen.get(story.id) || 0) !== gen) }); /* M259: the leash's renew rides through */
      noteWork(story.id, promise);
      if (ownReading && lane === 'main' && msg && msg.id) noteLedgerLink(story.id, msg.id, promise);
      return promise;
    };

    /* 0. M45: the founder — before the page is read, the world the writer
     * already wrote (brief, cast notes, cards, lore) becomes ledger, once,
     * and again whenever that material changes (a fingerprint on
     * state.founded). The extractor then founds the scene on top of it. */
    enqueue('founder', async ({ signal, stale }) => {
      if (story.extraction === false) return { silent: true };
      /* M607: the old-ledger heal's stamp, for a ledger found clean BEFORE this page's helpers write (agents/rebuild.js
       * healStampDue) — a story begun on this house is never re-read whole for a mark this house wrote itself */
      try { const was = await loadState(story.id); if (!stale() && healStampDue(was)) await saveState(story.id, { ...was, healedGen: HEAL_GEN }); } catch (err) { /* asked again on the next page */ }
      /* M478: the brief as it stands NOW — a #story concept may have been written into it while the page was told */
      try { const now = await db.stories.get(story.id); if (now) { story.brief = now.brief; story.castNotes = now.castNotes; } } catch (err) { /* the copy in hand */ }
      const cast = await castForStory(story);
      const lore = await loadLore(story.id);
      const print = founderFingerprint({ brief: story.brief || '', castNotes: story.castNotes || '', cast, lore });
      if (!print) return { silent: true };
      const st = await loadState(story.id);
      /* M606: a tale founded before the ledger kept things is founded once more for its things alone (a jet, a car, a base the
       * brief gives) — nothing else of the founding is read again */
      const thingsOnly = Boolean(st.founded && st.founded.print === print && !refound && !st.thingsFounded);
      if (st.founded && st.founded.print === print && !refound && !thingsOnly) return { silent: true };
      const connection = await resolveWorkerConnection(story, 'founder');
      if (!connection) return { silent: true };
      if (stale()) return { silent: true };
      const result = await foundWorld({ connection, storyId: story.id, brief: story.brief || '', castNotes: story.castNotes || '', cast, lore, signal, stale, canonRecord: await canonRecordOf(story), thingsOnly }); /* M564: the real record it is told to write canon people from */
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
      const notHim = Object.keys((st && st.characters) || {}).filter((n) => { try { return !isMcAlias(st, n); } catch (err) { return true; } }); /* M609: whose name words are theirs */
      const { findings } = lintPage({ mc: known && known !== 'the player' ? known : '', userText, assistantText: pageText(msg), ooc: Boolean(msg.ooc), others: notHim });
      if (stale() || !(await stillThere(story.id, msg.id))) return { silent: true };
      const current = (await db.messages.list(story.id)).find((m) => m.id === msg.id);
      const others = Array.isArray(current && current.findings) ? current.findings.filter((f) => f && f.kind !== 'craft') : [];
      await reink(story.id, msg.id, { findings: [...findings, ...others] });
      if (findings.length) notify(story.id);
      const warns = findings.filter((f) => f.severity === 'warn').length;
      /* M119: a glitch character is mended now, by the house — the stray and
       * the garbled phrase around it (a corrupted repeat often sits beside
       * it); the fewest words, with the take-back chip like any mend */
      const stray = findings.find((f) => Array.isArray(f.stray) && f.stray.length);
      if (stray) {
        const connection = await resolveWorkerConnection(story, 'continuity');
        if (connection && !stale()) {
          try {
            const contradiction = 'The page holds a stray character from another script — ' + stray.stray.map((c) => '“' + c + '”').join(', ') + ' — a glitch of the wire, not a word. Remove it and mend the phrase around it; if a garbled repeat of a sentence sits beside it, keep that sentence once. Change nothing else.';
            const changed = await mendAround(story, connection, [msg.id], contradiction, undefined, 0);
            const after = (await db.messages.list(story.id)).find((m) => m.id === msg.id);
            const still = after ? (pageText(after).match(/[\p{Script=Hangul}\p{Script=Han}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Thai}\p{Script=Hebrew}\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length : 0;
            return { silent: false, detail: (changed.length ? 'a glitch character mended' : 'a glitch character seen, the mender left it') + (still ? ' — ' + still + ' still on the page (edit it or try again)' : '') + `; ${findings.length} ${findings.length === 1 ? 'slip' : 'slips'} against the craft` };
          } catch (err) { /* the finding stands; the warn rides next turn */ }
        }
      }
      return { silent: !findings.length, detail: findings.length ? `${findings.length} ${findings.length === 1 ? 'slip' : 'slips'} against the craft` + (warns ? ` (${warns} to recolor next turn)` : '') : '' };
    });

    /* 1. The extractor (M3): read the page, propose mutations, apply and
     * save them, and write the outcome back onto the same message. */
    enqueue('extractor', async ({ signal, stale, renew }) => {
      if (story.extraction === false) return { silent: true };
      const connection = await resolveWorkerConnection(story, 'extractor');
      if (!connection) return { silent: true };
      const stateBefore = await loadState(story.id);
      chainClock.before = stateBefore && stateBefore.clock ? { ...stateBefore.clock } : null; /* M134 */
      /* M27: the founding read. A young ledger (no ground named yet, nobody
       * here yet) reads the pages just before too — the writer often sets
       * the scene in the first posts, and a one-pair read would starve it.
       * M28: the same youth switches the extractor into founding mode (it
       * writes the ground, the people, the hour and the main character down
       * instead of asking "what changed?"), and the writer's brief and cast
       * notes ride along so the names are known. */
      const young = isYoungLedger(stateBefore);
      /* M261: THE STORY SO FAR, ON EVERY PAGE. The extractor read the pages
       * before this one only on a founding or a deep read; on every other page
       * it had the page and nothing else — no idea who "she" was, what was
       * promised, which thread this page answered. It reads what the
       * storyteller read now: every page the record has not folded, whole, and
       * the record for the rest (memory.js storySoFar, M228's meeting point). */
      let before = [];
      let foldedBefore = '';
      try {
        let mem = null;
        try { mem = await loadMemory(story.id); } catch (err) { mem = null; }
        ({ before, record: foldedBefore } = storySoFar(await db.messages.list(story.id), mem, msg.id, { least: deep ? 8 : 4, recordCap: Math.floor(roomChars(connection) * 0.35) }));
      } catch (err) { before = []; foldedBefore = ''; }
      /* M251: THE LEDGER HAD NO WAY BACK. The RECORD walks to its oldest hole
       * every fold (dueRange), so an outage costs nothing. The LEDGER is
       * per-turn: it reads THIS page and no other. So a writer playing four
       * scenes through a broken connection lost every state change in them —
       * who came in, who left, what was locked, what was hurt — with nothing
       * that would ever go back for it, and the record recovering perfectly
       * beside it, which made the loss invisible.
       * state.page only ever advances when the read SUCCEEDS, so it is an
       * honest mark of how far the ledger has got. Any assistant page past it
       * and before this one was never read: the oldest is read now, first,
       * one per turn, so the ledger closes its gap while the writer plays on
       * exactly as the record does. */
      try {
        const told = visiblePages(await db.messages.list(story.id)).filter((m) => m.role === 'assistant');
        const here = told.findIndex((m) => m.id === msg.id);
        /* M276: the oldest page no read has reached — never one read already */
        /* a founding read takes in the pages before the one in hand — nothing to catch up first */
        const k0 = here === -1 || young ? -1 : oldestUnread(stateBefore, here);
        if (k0 !== -1) await readMissedPage(story, connection, told[k0], k0, { signal, renew, record: foldedBefore, stale });
      } catch (err) { /* the page in hand still gets read */ }

      const { mutations, note: extractNote, failed: extractFailed, raw: extractRaw, here: extractRoom } = await extractTurn({
        connection,
        state: stateBefore,
        userText,
        assistantText: pageText(msg),
        before,
        founding: young,
        brief: story.brief || '',
        castNotes: story.castNotes || '',
        record: foldedBefore,
        signal,
        renew,
        storyId: story.id, story, pageNumber: await pageNumberOf(story.id, msg.id), /* M259: it may look */
      });
      /* B5: a page that has gone teaches the ledger nothing. M12: nor does
       * a page of a story the writer has left. */
      if (stale()) return { silent: true };
      if (!(await stillThere(story.id, msg.id))) return { silent: true };
      /* M128: the header's ground and hour land in code, at the head of the
       * extractor's own writes — the same stamp, the same journal, the same
       * take-back — whatever the model remembered to write */
      const ledgerBefore = await loadState(story.id);
      const groundBefore = (ledgerBefore.place || {}).name || ''; /* M627: an area round it is no move */
      const dayBefore = (ledgerBefore.clock && typeof ledgerBefore.clock.dayWords === 'string') ? ledgerBefore.clock.dayWords : ''; /* M660: the story's own calendar, as the ledger keeps it */
      const fromHeader = (msg.role === 'assistant' && !msg.ooc) ? headerMutations(pageText(msg), { ground: groundBefore, day: dayBefore }) : [];
      /* M129: a person who appears ONLY inside the page's window (*** The World
       * Beyond ***) is elsewhere by definition — a presence.enter for them is
       * refused here, whatever the model wrote (the window about Chloe's
       * kitchen had seated Chloe in the scene) */
      const pageWhole = pageText(msg);
      const cutAt = windowCutAt(pageWhole); /* M467: the marker in any dressing */
      const scenePart = (cutAt === -1 ? pageWhole : pageWhole.slice(0, cutAt)).toLowerCase();
      const onlyInWindow = (name) => {
        if (cutAt === -1) return false;
        const n = String(name || '').trim().toLowerCase();
        if (!n) return false;
        const first = n.split(/\s+/)[0];
        return !scenePart.includes(n) && !(first.length >= 3 && new RegExp('(?<![\\p{L}])' + first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}])', 'u').test(scenePart));
      };
      /* M131: the header is the truth for the ground and the hour — the extractor's own
       * place.set / clock.set never override what the header line said */
      const headerHas = new Set(fromHeader.map((m) => m.type));
      /* M455: the header's hour is the page's hour — the reader's own "time passed" on top of it put the clock ahead */
      if (headerHas.has('clock.set')) headerHas.add('clock.advance');
      /* M660: a long jump of the clock lets every place-in-the-room and outfit go — before the reader's own writes, which
       * say what THIS page shows (apply.js staleAfterJump) */
      const letGo = staleAfterJump(ledgerBefore, fromHeader);
      /* M679: A HEADER THAT NAMES ONLY THE AREA DOES NOT SAY WHERE IN IT THE SCENE IS. His "[Ilvarren — …]" set the ground to the
       * city on every page and threw away the reader's own word for the street — the spot the page reader now gives for
       * exactly this (extractor.js spotBlock, held to the page there), written after the header's area */
      const headerPlace = fromHeader.find((m) => m && m.type === 'place.set');
      const areaOnly = Boolean(headerPlace && noOneSpot(String(headerPlace.name || '')));
      const overruled = (m) => Boolean(m && headerHas.has(m.type) && !(areaOnly && m.type === 'place.set' && !noOneSpot(String(m.name || m.place || ''))));
      const list = [...fromHeader, ...letGo, ...(Array.isArray(mutations) ? mutations : []).filter((m) => !overruled(m))].filter((m) => !(m && m.type === 'presence.enter' && onlyInWindow(m.name)));

      /* Re-load at apply time — the ledger may have been touched by hand
       * while the worker was reading. */
      if (extractFailed) throw new Error('no answer reached us');
      const fresh = await loadState(story.id);
      /* M69: every write from this chain is stamped with this page's index */
      /* M253: THE MARK IS A CONTIGUOUS PREFIX, NOT THE NEWEST PAGE READ.
       * M251's catch-up read the oldest missed page and marked it — and then
       * this line stamped the mark with the index of the page IN HAND, which
       * claimed every page between them had been read when none of them had.
       * So the self-heal recovered exactly ONE page and then abandoned the
       * rest, silently, which is worse than not healing at all: the gap was
       * gone from the mark but still gone from the ledger.
       * state.page means "every page up to here has been read". Reading the
       * page in hand only extends that when it is the very next one. The
       * page's own changes are written either way — this governs the MARK,
       * not the reading. */
      /* M276: the page's changes are stamped with ITS OWN index (a branch before it
       * must not carry them); the mark then takes it through markPageRead, which
       * keeps it a contiguous prefix and remembers a page read out of turn */
      const pageInHand = visiblePages(await db.messages.list(story.id)).filter((m) => m.role === 'assistant').findIndex((m) => m.id === msg.id);
      if (pageInHand !== -1) fresh.page = pageInHand;
      /* M261: A THREAD THE STORY STOPPED CARRYING COOLS BY ITSELF. Nothing
       * cooled a thread: one no page closed stayed "hot" and was read to the
       * storyteller as live every turn until eight newer ones pushed it out —
       * and the auditor closed them by hand, page after page. Untouched for
       * THREAD_COOL_PAGES pages, it goes cold (never one this page moves). */
      list.push(...threadHousekeeping(fresh.threads, storyTurn(fresh), list.filter((m) => m && (m.type === 'thread.set' || m.type === 'thread.close')).map((m) => m.title || m.name)));
      const { state: next, applied, rejected } = applyMutations(fresh, list);
      /* M679: the room this page's reader named as the page ends (its "here") — kept with the page's index, so the house's own
       * heal of who is here (apply.js hereByTheNewestPage, the next job) writes nobody in against it, as the reader's own
       * walk-ins already are not (M666) */
      if (pageInHand !== -1) {
        const room = Array.isArray(extractRoom) ? extractRoom.filter((n) => typeof n === 'string' && n.trim()).slice(0, 40) : [];
        if (room.length) next.roomAt = { page: pageInHand, names: room };
        else if (next.roomAt && next.roomAt.page === pageInHand) delete next.roomAt;
      }
      if (pageInHand !== -1) {
        if (young) {
          /* the founding read took in every page before this one: all of them are read */
          next.readTo = Math.max(readMark(next), pageInHand);
          next.readAhead = (Array.isArray(next.readAhead) ? next.readAhead : []).filter((x) => x > next.readTo);
        } else markPageRead(next, pageInHand);
      }
      /* M290: a page a rewind has let go writes nothing — not even its stamp (a Retry pressed while this
       * reader was still out could have its rewound ledger written over by the page it let go) */
      if (!applied.length) { if (stale()) return { silent: true }; await saveState(story.id, next); } /* the stamp stands even when nothing was written */
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
        /* M628: a header that named only the area is given the ground the ledger keeps — in code, now, with the take-back */
        const cur = (await db.messages.list(story.id)).find((m) => m.id === msg.id);
        const said = cur ? pageText(cur) : '';
        const given = cur && !cur.ooc && !(typeof cur.keptText === 'string' && cur.keptText === said) ? headerWithGround(said, (stNow.place || {}).name || '') : said;
        if (cur && given !== said) {
          const patch = shownTextPatch(cur, given);
          if (!cur.mended) patch.mended = { before: said, why: 'the header named only the area — the house wrote in where the ledger has the scene', at: Date.now() };
          await db.messages.update(story.id, msg.id, patch);
          await rerenderMessage(story.id, msg.id);
        }
      } catch { /* a masthead is a courtesy, never a crisis */ }
      const n = applied.length;
      const refusals = rejected.filter((r) => !(r && r.same)); /* M259: "already so" is not a refusal */
      const refused = refusals.length ? ` (${refusals.length} refused: ${refusals.slice(0, 3).map((r) => r.why).join('; ')})` : '';
      const detail = extractNote === 'unusable'
        ? 'its answer could not be used'
        : extractNote === 'cut short'
          ? 'its answer ran out of room'
          : n ? `wrote ${n} ${n === 1 ? 'change' : 'changes'}: ` + applied.slice(0, 5).map((a) => a.words.replace(/\.$/, '')).join(' · ') + (n > 5 ? ' · …' : '') + refused : 'nothing to write down' + refused;
      return { silent: false, detail, raw: extractRaw };
    });

    /* M405: A "NOW" OF A GROUND THE SCENE HAS LEFT is let go before the world agent and the scribe write the true ones —
     * a journaled change of the house's own (engine/apply.js staleNows), so a fold replays it and a take-back returns it.
     * Filed under the page reader: it is the upkeep of the ground the page reader moved. */
    enqueue('extractor', async ({ stale }) => {
      if (story.extraction === false || stale()) return { silent: true };
      let fresh = await loadState(story.id);
      /* M409: THE PAGE'S HEADER IS THE GROUND. If the ledger's ground is not the one the latest page's header names (an
       * old audit moved it; a reader missed a move), it is put right here first — a journaled change — and every now is
       * judged against the page's ground. */
      const headerGround = ((msg && msg.role === 'assistant' && !msg.ooc ? headerMutations(pageText(msg), { ground: (fresh.place || {}).name || '' }) : []).find((m) => m && m.type === 'place.set') || {}).name || ''; /* M627 */ /* this chain's own page */
      if (headerGround) { const moved = applyMutations(fresh, [{ type: 'place.set', name: headerGround }]); if (moved.applied.length) fresh = moved.state; }
      /* M406: one person, two pages — joined first, so the nows below are read on the one page */
      const pageJoins = duplicatePages(fresh);
      const pagesJoined = pageJoins.length ? applyMutations(fresh, pageJoins.map((j) => ({ type: 'people.rename', from: j.from, to: j.to, cause: 'one person, one page' }))) : { state: fresh, applied: [] };
      /* M419: and an injury, a standing or a thing known under another form of their name follows them to their page */
      const strays = strayBookKeys(pagesJoined.state);
      const straysJoined = strays.length ? applyMutations(pagesJoined.state, strays.map((j) => ({ type: 'people.rename', from: j.from, to: j.to, cause: 'one person, one name in every book' }))) : { state: pagesJoined.state, applied: [] };
      const joins = [...pageJoins, ...strays];
      const joined = { state: straysJoined.state, applied: [...pagesJoined.applied, ...straysJoined.applied] };
      const who = staleNows(joined.state, { ground: headerGround });
      const clearedNows = who.length ? applyMutations(joined.state, who.map((name) => ({ type: 'people.set', name, field: 'state', text: '', clear: true }))) : { state: joined.state, applied: [] };
      /* M444: WHO WALKED IN FROM ANOTHER ROOM — before M444 a seat anywhere in the scene's compound put its person in the
       * scene; whoever came in that way and no story page has shown since goes back where the world had them (journaled,
       * undoable; never the main character, never someone a page or his hand put there) */
      const toldPages = visiblePages(await db.messages.list(story.id)).filter((m) => m.role === 'assistant');
      const storyPages = toldPages.map((m) => ({ text: m.ooc ? '' : pageText(m) }));
      const walkIns = wrongWalkIns(clearedNows.state, storyPages);
      /* M452: and whoever a note has elsewhere at the scene's own place, whom this page shows here, is written in — M679: as
       * the page ENDS, and never someone this page's own readers took out (its index, as the chain stamps its writes) */
      const pageAt = msg ? toldPages.findIndex((m) => m.id === msg.id) : -1;
      const hereAgain = msg && msg.role === 'assistant' && !msg.ooc ? hereByTheNewestPage(clearedNows.state, pageText(msg), { pageAt: pageAt !== -1 ? pageAt : null }) : [];
      /* M491: and whoever is listed here though their own page says they left, and this page does not show, is seated away */
      const goneAway = msg && msg.role === 'assistant' && !msg.ooc ? [...goneByTheirOwnPage(clearedNows.state, pageText(msg)), ...walkedBackOverTheWorld(clearedNows.state, pageText(msg))] : []; /* M535 */
      const oneMan = descriptorsThatAreNamed(clearedNows.state); /* M509-2: "the courier" beside "Hachigorō" is one man */
      const apart = descriptorsApart(clearedNows.state); /* M509-5: the ones that stand apart, and why — so the light can say it */
      const walkedBack = walkIns.length || hereAgain.length || goneAway.length || oneMan.length ? applyMutations(clearedNows.state, [...walkIns, ...hereAgain, ...goneAway, ...oneMan]) : { state: clearedNows.state, applied: [] };
      const cleared = { state: walkedBack.state, applied: clearedNows.applied };
      const sentBack = [...new Set(walkedBack.applied.filter((a) => a.mutation.type === 'presence.leave').map((a) => a.mutation.name))];
      const writtenIn = [...new Set(walkedBack.applied.filter((a) => a.mutation.type === 'presence.enter').map((a) => a.mutation.name))];
      const groundMoved = cleared.state.place && fresh.place && cleared.state.place.name !== (await loadState(story.id)).place?.name;
      if (!joined.applied.length && !cleared.applied.length && !walkedBack.applied.length && !groundMoved && !apart.length) return { silent: true };
      if (!joined.applied.length && !cleared.applied.length && !walkedBack.applied.length && !groundMoved) return { silent: false, detail: 'standing apart: ' + apart.map((d) => d.name + ' — ' + d.why).join('; ') }; /* nothing written; the word alone */
      /* M414: M290's law, which this job alone skipped — a page a rewind (Try again, read again) let go while these
       * reads were out writes nothing: checked the moment before the save, like every other reader's save */
      if (stale() || !(await stillThere(story.id, msg.id))) return { silent: true };
      await saveState(story.id, cleared.state);
      notify(story.id);
      const oneManDone = walkedBack.applied.filter((a) => a.mutation.type === 'people.rename' && oneMan.some((m) => m.from === a.mutation.from));
      const oneManRefused = walkedBack.rejected ? walkedBack.rejected.filter((r) => r.mutation && r.mutation.type === 'people.rename' && oneMan.some((m) => m.from === r.mutation.from)) : [];
      return { silent: false, detail: [joined.applied.length ? 'joined ' + joins.map((j) => j.from + ' into ' + j.to).join(', ') : '', oneManDone.length ? 'one man, one name: ' + oneManDone.map((a) => a.mutation.from + ' is ' + a.mutation.to).join(', ') : '', oneManRefused.length ? 'could not join ' + oneManRefused.map((r) => r.mutation.from + ' (' + r.why + ')').join(', ') : '', apart.length ? 'standing apart: ' + apart.map((d) => d.name + ' — ' + d.why).join('; ') : '', cleared.applied.length ? 'let go of a “now” that named a place the scene has left: ' + who.join(', ') : '', sentBack.length ? 'put back where the world had them (never in the scene — seated in another part of the same place): ' + sentBack.join(', ') : '', writtenIn.length ? 'written back into the scene (the page shows them here; a note had them elsewhere at this very place): ' + writtenIn.join(', ') : ''].filter(Boolean).join(' · ') };
    });

    /* M394: CANON THROUGH HIS STORY, BEFORE THE WORLD AND THE SCRIBE WRITE. Everyone canon knows in this ledger with no lens
     * for this premise is read through his story here — so the world agent and the scribe (and a "read again") are
     * handed only what holds in his story, never canon's end-state and never nothing. Once per person per premise; only
     * with canon verification on. */
    enqueue('canon', async ({ stale }) => {
      try {
        if (stale() || !(await canonOn(story.id))) return { silent: true };
        const connection = await resolveWorkerConnection(story, 'canon');
        if (!connection) return { silent: true };
        const read = await canonLensLedger((await db.stories.get(story.id)) || story, { connection });
        return read.length ? { silent: false, detail: 'read ' + read.join(', ') + ' through your story — what it changed or has not reached is not said' } : { silent: true };
      } catch (err) { return { silent: true }; }
    });

    /* 1b. The world agent (M29): once the page's own truth has landed,
     * advance the world beyond it by the clock — the absent, the threads,
     * who knows what, the factions, who must now exist — and leave the
     * storyteller a brief for the next turn. Off the send path; the next
     * send reads whatever brief stands (pendingWork's courtesy wait). */
    enqueue('world', async ({ signal, stale, renew }) => {
      if (story.extraction === false || stale()) return { silent: true };
      if (!(await worldAgentOn(story))) return { silent: true };
      const connection = await resolveWorkerConnection(story, 'world');
      if (!connection) return { silent: true };
      if (!(await stillThere(story.id, msg.id))) return { silent: true };
      const ordered = (await db.messages.list(story.id)).filter((m) => !m.hidden);
      const atSelf = ordered.findIndex((m) => m.id === msg.id);
      const prior = atSelf === -1 ? ordered : ordered.slice(0, atSelf);
      /* M85: the voices the last pages carried, so the world rotates its
       * speakers and topics instead of repeating them */
      const voicesBefore = prior.filter((m) => m.role === 'assistant' && Array.isArray(m.voices) && m.voices.length).slice(-3).map((m) => m.voices);
      /* M249/M261: the story so far — every page the record has not folded,
       * whole, and the record for the rest — as the extractor reads it */
      let before = [];
      let worldRecord = '';
      try {
        let mem = null;
        try { mem = await loadMemory(story.id); } catch (err) { mem = null; }
        ({ before, record: worldRecord } = storySoFar(ordered, mem, msg.id, { least: 2, recordCap: Math.floor(roomChars(connection) * 0.35) }));
      } catch (err) { before = []; worldRecord = ''; }
      /* M134: how far the clock moved across this page (a #time skip, a night) — the
       * world agent re-seats everyone when it jumped */
      const clockNow = (await loadState(story.id)).clock;
      const clockWas = chainClock.before;
      const jumpedMinutes = clockNow && clockWas && Number.isFinite(clockNow.minutes) && Number.isFinite(clockWas.minutes) ? Math.max(0, clockNow.minutes - clockWas.minutes) : 0;
      const result = await worldTurn({
        connection,
        storyId: story.id,
        userText,
        assistantText: pageText(msg),
        before,
        record: worldRecord,   /* M249: the folded story, as the extractor gets it */
        brief: story.brief || '',
        castNotes: story.castNotes || '',
        castNames: await castNamesFor(story), /* M304: an invited card is one of the writer's own people */
        voicesBefore,
        effort: await worldEffort(),
        signal,
        stale,
        renew,
        story, pageNumber: atSelf + 1, /* M259: it may look */
        jumpedMinutes,
        canonRecord: await canonRecordOf(story), /* M386: the real record it is told to seat canon people from */
      });
      /* M85: the voices land under the page they followed (a re-ink, like
       * the masthead); a read that heard none clears a stale block from an
       * earlier version of the page. */
      if (result && result.note === 'ok' && !stale() && (await stillThere(story.id, msg.id))) {
        const voices = voicesBeyondTheRoom(result.brief && Array.isArray(result.brief.voices) ? result.brief.voices : [], await loadState(story.id)); /* M544: never a voice from someone in the room */
        await reink(story.id, msg.id, { voices });
        notify(story.id); /* M97: the drawer's "Voices, elsewhere" listens */
      }
      /* M31: a garbled answer is not a transport failure — it is said out
       * loud, with what the agent actually said kept for the drawer, and
       * never retried five times over. */
      return { silent: false, detail: worldRunWords(result), raw: result && result.raw };
    });

    /* 2. The scribe (M12): sparse deltas onto the character pages — who
     * they are, where they are, how things stand, loose ends. It answers
     * to the ledger's own switch, like the extractor. */
    enqueue('scribe', async ({ signal, stale, renew }) => {
      if (story.extraction === false || stale()) return { silent: true };
      const connection = await resolveWorkerConnection(story, 'scribe');
      if (!connection) return { silent: true };
      const kept = await scribeTurn({
        connection,
        storyId: story.id,
        userText,
        assistantText: pageText(msg),
        signal,
        stale,
        renew,
        brief: story.brief || '', /* M283: the brief outranks every page — the scribe reads it */
        castNotes: story.castNotes || '',
        canonRecord: await canonRecordOf(story), /* M386: "written from the REAL RECORD" — now it has it */
      });
      /* M259: the scribe says what it did, like every other minder */
      if (!kept) return { silent: true };
      const n = kept.changes.length;
      const detail = (n ? `wrote ${n} ${n === 1 ? 'note' : 'notes'} on the character pages` : 'nothing shifted on the character pages')
        + (kept.note === 'cut short' ? ' (its answer ran out of room twice; every note that arrived whole was kept)' : '');
      return { silent: false, detail };
    });

    /* 3. The memory keeper (M6; M12 grew the detail auditor inside it):
     * fold what has scrolled past the verbatim window into layered notes.
     * M9 (B12): its own per-story switch — the ledger's switch no longer
     * speaks for it. */
    enqueue('keeper', async ({ signal, stale, renew }) => {
      if (story.keeper === false) return { silent: true };
      if (story.keeper !== true && (await db.settings.get('memoryKeeper')) === false) return { silent: true };
      const connection = await resolveWorkerConnection(story, 'keeper');
      if (!connection) return { silent: true };
      if (stale()) return { silent: true };
      const beforeCount = (await loadMemory(story.id)).nodes.length;
      /* M268: a mend that should never have been is put back FIRST — M275: it
       * lets go of the record line over that page, and put back after the fold
       * the gap stood until the next page, and the green light with it */
      let putBack = [];
      /* once a session for each tale — M268 keeps new ones from being made, and
       * the look reads every page */
      if (!mendsChecked.has(story.id)) {
        mendsChecked.add(story.id);
        try { putBack = await putBackMistakenMends(story.id); } catch (err) { putBack = []; }
      }
      for (const id of putBack) { try { await rerenderMessage(story.id, id); } catch (err) { /* the next render shows it */ } }
      if (putBack.length) toast('The house put back ' + putBack.length + (putBack.length === 1 ? ' page it had' : ' pages it had') + ' mended by mistake — the storyteller’s own words are back.');
      /* M35: a line's passage contradicts the record → mend those pages */
      const onSourceIssue = async ({ issue, fix, span }) => {
        const ids = await pagesOfLine(story.id, span); /* M674: the line's own pages */
        await mendAround(story, connection, ids, issue + (fix ? '. It should read: ' + fix : ''), signal);
      };
      let mem = await maybeSummarize({
        connection,
        storyId: story.id,
        signal,
        renew, /* M259: every call gets its own minute (M213) — the chain never handed it over */
        recordRoomChars: await recordRoomFor(story), /* M264: squeeze only when it would not fit */
        stale, /* M72: a keeper whose ledger was rewound under it writes nothing */
        onSourceIssue,
      });
      /* M262: THE LINES THE OLD KEEPER READ IN PART are read again, two a page,
       * from whole pages — each line swaps whole, so the record is never
       * missing a line while it heals; a line that will not come back after
       * three tries is left as it is */
      let reread = 0;
      try {
        for (const nodeId of partlyReadLines(await loadMemory(story.id), await db.messages.list(story.id)).slice(0, 2)) {
          if (stale()) break;
          const r = await redoLine({ connection, storyId: story.id, nodeId, signal, renew });
          if (r && r.ok) { reread += 1; continue; }
          const held = await loadMemory(story.id);
          const node = (held.nodes || []).find((n) => n && n.id === nodeId);
          if (node) { node.healTries = (node.healTries || 0) + 1; await saveMemory(story.id, held); }
        }
        /* M263: and a squeezed line, one a page, when no first-layer line waits */
        if (!reread && !stale()) {
          for (const lineId of partlyReadMerged(await loadMemory(story.id), await db.messages.list(story.id)).slice(0, 1)) {
            const r = await rereadMergedLine({ connection, storyId: story.id, lineId, signal, renew });
            if (r && r.ok) { reread += 1; continue; }
            const held = await loadMemory(story.id);
            const node = (held.nodes || []).find((n) => n && n.id === lineId);
            if (node) { node.healTries = (node.healTries || 0) + 1; await saveMemory(story.id, held); }
          }
        }
      } catch (err) { /* the next page carries on */ }
      /* M275: A GAP THIS JOB OPENED IS FILLED IN THIS JOB. A page mended while
       * its batch was folded lets its new line go again; the record stood with a
       * hole until the next page, and the light stayed dark meanwhile. */
      let filled = false;
      try {
        if (!stale() && (await recordGap(story.id))) {
          const again = await maybeSummarize({ connection, storyId: story.id, signal, renew, recordRoomChars: await recordRoomFor(story), stale, onSourceIssue });
          if (again) { mem = again; filled = true; }
        }
      } catch (err) { /* the light asks again when the house is idle */ }
      const healed = (reread ? ` · read ${reread} older ${reread === 1 ? 'line' : 'lines'} again from whole pages` : '')
        + (filled ? ' · folded a gap in the record' : '');
      if (!mem) return { silent: false, detail: 'nothing due yet' + healed };
      const lines = mem.nodes.filter((n) => !n.empty).length;
      const added = mem.nodes.length - beforeCount;
      return { silent: false, detail: `${added > 0 ? 'wrote ' + added + (added === 1 ? ' line' : ' lines') : 'reshaped the record'} — ${lines} ${lines === 1 ? 'line' : 'lines'} on the record` + healed };
    });

    /* 4. The continuity reader (M6): advisory drift notes against canon and
     * the ledgers, stored on the same message. M9 (B12): its own per-story
     * switch too. It never touches the words. */
    enqueue('continuity', async ({ signal, stale, renew }) => {
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
      /* M450: the story so far — the record and the pages before this one, as the page reader reads them — so a telling
       * the ledger missed is never called untold (and the page mended) */
      let soFar = { before: [], record: '' };
      const msgsForTurn = await db.messages.list(story.id).catch(() => []);
      try { soFar = storySoFar(msgsForTurn, await loadMemory(story.id), msg.id, { least: 4, recordCap: Math.floor(roomChars(connection) * 0.35) }); } catch (err) { soFar = { before: [], record: '' }; }
      const { findings } = await checkTurn({
        connection,
        state: fresh,
        assistantText: pageText(msg),
        signal,
        brief: String((story && story.brief) || '') + (story && story.castNotes ? '\n\n' + story.castNotes : ''), /* M129: the brief counts as written */
        record: soFar.record,
        before: soFar.before,
        renew,
        /* M458: what he asked for on his turn — a page doing it is never drift */
        userText: (() => { const all = visiblePages(msgsForTurn || []); const at = all.findIndex((m) => m.id === msg.id); const u = at > 0 ? [...all.slice(0, at)].reverse().find((m) => m && m.role === 'user') : null; return u ? pageText(u) : ''; })(),
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
    enqueue('auditor', async ({ signal, stale, renew }) => {
      if (story.extraction === false || stale()) return { silent: true };
      /* M261: a page the auditor does not read is still kept — in code, logged
       * with its take-back; the workers line stays quiet, as the auditor did */
      const upkeepOnly = async () => {
        try { await ledgerUpkeep({ storyId: story.id, brief: story.brief || '', castNotes: story.castNotes || '', castNames: await castNamesFor(story), stale }); } catch (err) { /* the next page keeps it */ }
        return { silent: true };
      };
      if (!(await auditOn(story))) return upkeepOnly();
      const owed = pendingAudit.has(story.id);
      if (!audit && !owed) {
        const visible = (await db.messages.list(story.id)).filter((m) => !m.hidden && m.role === 'assistant').length;
        const every = await auditEvery();
        if (visible === 0 || visible % every !== 0) return upkeepOnly();
      }
      pendingAudit.delete(story.id);
      const connection = await resolveWorkerConnection(story, 'auditor');
      if (!connection) return upkeepOnly();
      if (stale()) return { silent: true };
      let result = await auditLedger({ connection, storyId: story.id, brief: story.brief || '', castNotes: story.castNotes || '', castNames: await castNamesFor(story), signal, stale, renew, canonRecord: await canonRecordOf(story) });
      if (result && !stale()) result = await resolveBriefWins(story, connection, result, signal, renew);
      return { silent: false, detail: auditRunWords(result), raw: result && result.raw };
    });

    /* 4a''. M673: THE CONTINUOUS AUDIT -- the oldest record line it has not read: its pages, whole, against the story
     * before them, the line and the ledger (agents/continuous.js). Off unless he switched it on. One line a page
     * here; the rest while the house is idle (continuousCatchUp). It stands before the checkpoint, so the page's
     * checkpoint holds what it added to the ledger. */
    /* M675: tried once — it reads OLDER pages, and nothing of this page waits on it: a reading that fails is asked again
     * by its own next look (the next page, or the house when idle), never by the queue's ladder, which held the page's
     * checkpoint — and every send — behind a minute of retries (agents/queue.js job.once) */
    ownReading = false; /* M675: the page's own readers end with the auditor — see ledgerLinksOut */
    enqueue('continuous', async ({ signal, stale, renew }) => continuousStep(story, { signal, stale, renew }), { once: true });

    /* 4a'. M291: THE CHARACTER PAGES, TIDIED ONCE — background out of "now", a household's
     * words on the right page — the standings untouched; a reading that could not be read
     * leaves the stamp for next time. */
    enqueue('scribe', async ({ signal, stale, renew }) => {
      if (story.extraction === false || stale()) return { silent: true };
      if (!tidyDue(await loadState(story.id))) return { silent: true };
      const connection = await resolveWorkerConnection(story, 'scribe');
      if (!connection) return { silent: true };
      const r = await tidyPeople({ connection, storyId: story.id, brief: story.brief || '', castNotes: story.castNotes || '', signal, stale, renew });
      if (!r) return { silent: true };
      return { silent: false, detail: tidyRunWords(r), unfinished: r.failed > 0 };
    });

    /* 4a. M262: THE HOUSE HEALS WHAT THE OLD READERS LEFT. A story that bears
     * the old auditor's mark (standings pushed back to the brief over what
     * the pages earned) is re-read once — the people and their standings,
     * built on the side and swapped in whole — then stamped. Before the
     * checkpoint, so the page's version keeps the healed ledger. */
    enqueue('scribe', async ({ signal, stale, renew }) => {
      if (story.extraction === false || stale()) return { silent: true };
      if (!peopleHealDue(await loadState(story.id))) return { silent: true };
      const connection = await resolveWorkerConnection(story, 'scribe');
      if (!connection) return { silent: true };
      const r = await rebuildPeople({ connection, storyId: story.id, brief: story.brief || '', castNotes: story.castNotes || '', cast: await castForStory(story), lore: await loadLore(story.id), canonRecord: await canonRecordOf(story), signal, stale, renew });
      if (!r || r.stalled) return { silent: false, detail: 'began reading the people again from the pages (notes the old house cut short, or standings pushed back to the brief) — it starts again on the next page' };
      if (stale()) return { silent: true }; /* M290 */
      const after = await loadState(story.id);
      await saveState(story.id, { ...after, healedGen: HEAL_GEN });
      notify(story.id);
      return { silent: false, detail: 'read the people and their standings again from the pages, once — for notes the old house had cut short, or standings the old auditor had pushed back to the brief (' + rebuildPeopleWords(r) + '; the drawer can put the old ones back)' };
    });

    /* 4a-canon. M388: THE OLD PAGES STOP REPEATING CANON — a page written before M387's division still carries what the
     * series says (its canon role, family, looks, nature), read twice every page that person is in. Once for each such
     * page, the record is taken out and what this story made of them kept — never a core his hand wrote, nothing added,
     * nothing of the story lost (both held in code: agents/canontidy.js), journaled. Only with canon verification on. */
    enqueue('scribe', async ({ signal, stale, renew }) => {
      if (story.extraction === false || stale() || !(await canonOn(story.id))) return { silent: true };
      const meta = await canonMeta(story.id);
      if (!canonRepeats(await loadState(story.id), meta).length) return { silent: true };
      const connection = await resolveWorkerConnection(story, 'scribe');
      if (!connection) return { silent: true };
      /* M445: what the story says of its people — his brief and cast notes, the record of the pages, the pages not yet
       * folded — so the tidy can tell the story's words from the series' (agents/canontidy.js cleanCoreHolds) */
      let material = String(story.brief || '') + '\n' + String(story.castNotes || '');
      try {
        const mem = await loadMemory(story.id);
        const shown = visiblePages(await db.messages.list(story.id));
        material += '\n' + wholeRecord(mem, 400000) + '\n' + shown.slice(coveredEnd(mem)).map((m) => pageText(m)).join('\n');
      } catch (err) { /* the brief and cast notes still speak for the story */ }
      const r = await canonTidyPeople({ connection, storyId: story.id, meta, keepMemo: () => canonSaveMeta(story.id), signal, stale, renew, material });
      if (!r) return { silent: true };
      return { silent: false, detail: canonTidyWords(r), unfinished: r.failed > 0 };
    });

    /* 4a''. M386: WHAT THE SERIES SAYS OF A FACE IS WRITTEN WHERE A FACE IS KEPT. Everyone in the ledger who is a canon
     * character has the series' hair, eyes, height, build, skin and distinguishing features in "What's true of them" —
     * only where nothing of the brief's, the writer's or a reader's stands, never again once he lets one go, corrected
     * when the series is looked up again, withdrawn when he blocks the name or forgets the page. Code only (the canon
     * memory and the ledger, no model, no network), before the checkpoint so this page's version keeps it. Only with its
     * switch on; the people a page brings in are looked up after it, and written on the next. */
    enqueue('canon', async ({ stale }) => {
      try {
        if (stale() || !(await canonOn(story.id))) return { silent: true };
        if (!(await stillThere(story.id, msg.id))) return { silent: true };
        const r = await canonSyncLedger((await db.stories.get(story.id)) || story, { stale });
        const n = r && Array.isArray(r.applied) ? r.applied.length : 0;
        if (!n) return { silent: true };
        const who = [...new Set(r.applied.map((a) => a.mutation.name))];
        return { silent: false, detail: 'wrote what the series says of ' + who.slice(0, 6).join(', ') + (who.length > 6 ? ', …' : '') + ' into What’s true of them (' + n + (n === 1 ? ' line' : ' lines') + ')' };
      } catch (err) { return { silent: true }; }
    });

    /* 4b. M40: the version's checkpoint — the ledger as it stands once the
     * readers have finished, kept for this version of this page. */
    /* M509-5: ONE LAST LOOK BEFORE THE CHECKPOINT. The world agent, the scribe and the auditor write after the upkeep,
     * and any of them can bring a descriptor back beside the man it is ("the courier" seated, written to, walked in);
     * the room is joined once more here, so the ledger the checkpoint keeps — and the next send reads — has one man
     * under one name. Journaled like the upkeep's own; silent when there is nothing to join. */
    enqueue('extractor', async ({ stale }) => {
      if (story.extraction === false || stale()) return { silent: true };
      const fresh = await loadState(story.id);
      const again = descriptorsThatAreNamed(fresh);
      if (!again.length) return { silent: true };
      const { state: next, applied } = applyMutations(fresh, again);
      if (!applied.length) return { silent: true };
      if (stale() || !(await stillThere(story.id, msg.id))) return { silent: true };
      await saveState(story.id, next);
      notify(story.id);
      return { silent: false, detail: 'one man, one name (after the readers): ' + applied.map((a) => a.mutation.from + ' is ' + a.mutation.to).join(', ') };
    });
    enqueue('checkpoint', async ({ stale }) => {
      if (stale()) return { silent: true };
      if (!(await stillThere(story.id, msg.id))) return { silent: true };
      const all = await db.messages.list(story.id);
      /* M67: an older page owns no checkpoint — except during a replay, when the ledger at this point IS this page's */
      if (!replaying && !isLastAssistantPage(all, msg.id)) return { silent: true };
      const fresh = all.find((m) => m.id === msg.id);
      const idx = shownIndex(fresh); /* M576: the one rule */
      await saveVersionState(story.id, msg.id, idx, await loadState(story.id));
      return { silent: true };
    });

    /* 5. The sheet seeder (M11): on the first turns and after a fight lets
     * go, the actor sheet fills itself in the background. It never blocks a
     * turn, and it keeps its own quiet ways (failures stay off the workers
     * line, as M11 shipped them). */
    enqueue('seeder', async ({ signal, stale, renew }) => {
      try {
        if (stale()) return { silent: true };
        /* M345: the sheet is the referee's — with the referee off it is not kept */
        if (!(await refereeSettings()).on) return { silent: true };
        const connection = await resolveWorkerConnection(story, 'referee'); /* M345: the sheet is weighed by the referee's own hands (Arbiter: the seeder rides the adjudicator's profile) */
        if (!connection) return { silent: true };
        await maybeSeedSheet({ connection, storyId: story.id, signal, renew, brief: story.brief || '', castNotes: story.castNotes || '' });
      } catch (err) { /* the seeder's trouble is its own */ }
      return { silent: true };
    });

    /* 7. M356, as M636 moved it: THE SENSORS are no longer a link of this chain. Their reader is handed the whole request
     * the page was written from — a long read — and a link here holds every helper behind it and the next send's wait.
     * It is started at the foot of this chain (queueSense), once the page's helpers are done, awaited by nothing. */

    /* 8. M510: THE PLANNING HELPER — last, so it reads the ledger this page just wrote. Only for a small model. */
    enqueue('planner', async ({ signal, stale }) => {
      if (stale()) return { silent: true };
      return planNext(story, { signal, stale });
    });
    /* 9. M510-15: THE ESSENTIALS KEEPER — after the keeper folded, the whole record streamlined again. Small model only. */
    enqueue('essentials', async ({ signal, stale }) => {
      if (stale()) return { silent: true };
      return essentialsNext(story, { signal, stale });
    });
    /* 9b. M527: WHERE A TALE UNDER WAY BEGAN — placed once after a page (its #story line, else its brief and first page),
     * asked again when that line changed; its answer rides from the next page. Never before the storyteller's request. */
    enqueue('placer', async ({ signal, stale }) => {
      if (stale()) return { silent: true };
      return placeNext(story, { signal, stale });
    }); /* before the world keeper: the world is written from the newest start */
    /* 9b2. M550: where it began, checked against the wiki's lines — before the world keeper reads it */
    enqueue('startcheck', async ({ signal, stale }) => {
      if (stale()) return { silent: true };
      return checkStartNext(story, { signal, stale });
    });
    /* 9c. M517: THE WORLD KEEPER — after the essentials, for a story whose brief is Automatic: the world, only if it moved */
    enqueue('ground', async ({ signal, stale }) => {
      if (stale()) return { silent: true };
      return groundNext(story, { signal, stale });
    });
    /* 9d. M551: the world, checked against everything the wiki says (asks only when the world or the wiki changed) */
    enqueue('worldcheck', async ({ signal, stale }) => {
      if (stale()) return { silent: true };
      return worldCheckNext(story, { signal, stale });
    });

    /* 10. M510-22: THE PLANS KEEPER — the page just written, read for a plan laid out, moved on or ended. Small model only. */
    enqueue('plans', async ({ signal, stale }) => {
      if (stale()) return { silent: true };
      return plansNext(story, { signal, stale });
    });

    /* 6. M346: canon verification after the page — ST's MESSAGE_RECEIVED: the people this page brought in are looked up
     * now, so the next page has them. Only with its switch on. */
    enqueue('canon', async ({ stale }) => {
      try {
        if (stale() || !(await canonOn(story.id))) return { silent: true };
        /* M566 (the audit): canon verification is one engine, one story at a time (his extension was built for SillyTavern's
         * one open chat). This step switched it to ITS tale whatever tale was open by then — he had moved on, the engine
         * reset its per-chat memory for the old tale, and a send in the open tale could run while the engine still stood in
         * the other. A tale no longer open is left alone: the next page sent in it looks up who it needs before it is written. */
        const open = await activeStory();
        if (!open || open.id !== story.id) return { silent: true };
        const connection = await resolveWorkerConnection(story, 'canon');
        await canonAfterPage({ story, state: await loadState(story.id), messages: visiblePages(await db.messages.list(story.id)), connection });
      } catch (err) { /* its trouble is its own */ }
      return { silent: true };
    });

    /* 11. M632: THE BENCHMARK — his: "which of my models performs best and writes the best, most realistic quality". With
     * "Grade every page" on, the judge he chose grades this page against the moment it answers (the page before, his move,
     * where things stand), known by the connection that wrote it (its receipt); and when this moment holds pages from two
     * storytellers (he switched and asked for another take, → on the page), the newest is read beside the last one by another, blind, both ways
     * round. Last in the chain: nothing waits for it. */
    enqueue('judge', async ({ signal, stale }) => {
      try {
        if (stale() || (await db.settings.get('benchOn')) !== true || msg.role !== 'assistant' || msg.ooc) return { silent: true };
        /* M633: every judge he ticked; none (or every one let go) — the readers' own connection */
        const ids = await benchJudgeIds();
        let judges = (await db.connections.list()).filter((c) => ids.includes(c.id));
        if (!judges.length) { const own = await resolveWorkerConnection(story, 'continuity'); if (own) judges = [own]; }
        if (!judges.length) return { silent: true };
        const all = visiblePages(await db.messages.list(story.id));
        const at = all.findIndex((m) => m.id === msg.id);
        const cur = at >= 0 ? all[at] : null;
        if (!cur || cur.ooc) return { silent: true };
        const receipt = cur.receipt || {};
        const writer = writerKey(receipt);
        if (!writer) return { silent: true };
        /* M675 — "IS THE BENCHMARK ALREADY GOOD?" Two things the judge was told were not the moment the page answered:
         *   - his move and the page before were looked for among the pages that show, by position: a "Go on" page was
         *     judged against the move of the turn before, a page after an out-of-character exchange against the
         *     storyteller's out-of-character answer, and a shortcut ("#p") went with nothing saying what it asks
         *     (judgedMoment, benchrun.js — the same reading a run's replayed page gets);
         *   - "where things stand" was the ledger as it stood AFTER this page's own readers (this step is the last of
         *     the chain): a page that got the room or the hour wrong had already taught the ledger its mistake, and was
         *     graded as true to it. It is the state the storyteller was SENT for this page — the words of that slot,
         *     kept with the page (sent.js) — as a run's replayed page always had it; the ledger as it stands only when
         *     the page kept none (its first page, or a page from before requests were kept). */
        const moment = judgedMoment(await db.messages.list(story.id), cur.id);
        let notes = '';
        try {
          const kept = receipt.sentId ? await loadSent(receipt.sentId) : null;
          notes = String((((kept && kept.slots) || []).find((sl) => sl && sl.name === 'The state of things') || {}).text || '');
        } catch (err) { notes = ''; }
        if (!notes.trim()) { try { notes = planFacts(await loadState(story.id)); } catch (err) { notes = ''; } }
        const ctxWords = { ...moment, notes };
        const page = pageText(cur);
        const grade = await gradeWithJudges(judges, ctxWords, page, signal);
        if (stale()) return { silent: true };
        let detail = '';
        if (grade && Number.isFinite(grade.overall)) {
          await recordGrade({ writer, label: receipt.label || '', model: receipt.model || '', storyId: story.id, pageKey: story.id + ':' + cur.id + ':' + (receipt.ts || cur.ts || 0), scores: grade.scores, overall: grade.overall, why: grade.why });
          detail = 'graded ' + grade.overall.toFixed(1);
        }
        /* a duel: the newest page beside the last one this moment holds from ANOTHER storyteller */
        const swipes = Array.isArray(cur.swipes) ? cur.swipes : [];
        if (swipes.length > 1) {
          const shownAt = Number.isInteger(cur.swipeIdx) ? cur.swipeIdx : swipes.length - 1;
          const shown = swipes[shownAt];
          const rival = [...swipes.slice(0, shownAt)].reverse().find((sw) => sw && writerKey(sw.receipt) && writerKey(sw.receipt) !== writer);
          if (shown && rival) {
            const y = writerKey(rival.receipt);
            const duel = await duelWithJudges(judges, ctxWords, page, String(rival.text || ''), signal);
            if (duel && !stale()) {
              await recordDuel({ x: writer, y, xLabel: receipt.label || receipt.model || '', yLabel: (rival.receipt && (rival.receipt.label || rival.receipt.model)) || '', winner: duel.winner, why: duel.why, duelKey: story.id + ':' + cur.id + ':' + (receipt.ts || 0) + ':' + ((rival.receipt && rival.receipt.ts) || rival.ts || 0) });
              detail += (detail ? ' · ' : '') + (duel.winner === 'tie' ? 'a tie' : duel.winner === 'x' ? 'won' : 'lost') + ' head to head';
            }
          }
        }
        if (ctx.bench && typeof ctx.bench.reload === 'function') ctx.bench.reload().catch(() => {});
        return detail ? { silent: false, detail } : { silent: true };
      } catch (err) {
        if (signal && signal.aborted) return { silent: true };
        return { silent: false, detail: 'could not grade: ' + (err && err.message ? err.message : String(err)) };
      }
    });
    /* M636: THE SENSORS, after every link above has been queued and once they are done — outside the chain (no send waits) */
    pendingWork(story.id, 120000).then(() => queueSense(story, msg && msg.id)).catch(() => { /* a reading is never worth a page */ });
  }

  async function gatherSettings() {
    return {
      frameText: await db.settings.get('frameText'),
      noteText: await db.settings.get('noteText'),
      noteAdds: await db.settings.get('noteAdds'), /* M620: his notes above the note at the end */
      /* M21: the frame's purpose line (on unless switched off) and its
       * end-of-request echo (off unless switched on). */
      frameOn: (await db.settings.get('frameOn')) !== false, /* M509-14 */
      noteOn: (await db.settings.get('noteOn')) !== false, /* M509-14 */
      frameEcho: (await db.settings.get('frameEcho')) === true,
      /* M327: who tells, and who listens (Settings → The frame) */
      tellerName: await db.settings.get('tellerName'),
      writerName: await db.settings.get('writerName'),
      tellerPerson: await db.settings.get('tellerPerson'), /* M334: 'first' | 'second' | unset = follow the frame */
      groundingPhrase: await db.settings.get('groundingPhrase'), /* M358: the first words of its thinking */
      afterRole: await db.settings.get('afterRole'), /* M380: what follows his message rides as system (default) or user */
      notesRole: await db.settings.get('notesRole'), /* M510-39: the notes before the story — system (default), user or assistant */
      ownWords: await db.settings.get('ownWords'), /* M466: words in the storyteller's own voice, placed where he chose */
    };
  }

  /* M345: the outcome settled for this turn — the words the storyteller reads. Only the one ruled on THIS page of the
   * writer's: never on an out-of-character turn (the referee does not rule on one), and never an outcome left over from
   * a send that stopped before it was told (it would settle a move the writer is no longer making). */
  const rulingFor = (st, userId, ooc) => (!ooc && userId && st && st.pendingVerdict && st.pendingVerdict.forUser === userId
    && typeof st.pendingVerdict.directive === 'string' ? st.pendingVerdict.directive : '');

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
  /* M326: WHAT A LATER TURN IS SENT OF AN EARLIER PAGE IS THE PAGE. Pages saved before the header gate existed (or while
   * it was unticked) still hold the model's plans, drafts and checklists — and every one of them, sent back as
   * "the story so far", teaches the model that a page is where it drafts. The saved page is never touched; what
   * rides the wire is its page part alone. */
  db.settings.get('activeConnectionId').then((id) => noteTellerConnection(id)).catch(() => {}); /* M328: before any turn is sent, the house's choice is the storyteller's */
  let cutOldPages = true;
  db.settings.get('cutBeforeHeader').then((v) => { cutOldPages = v !== false; }).catch(() => {});
  const sentPage = (text, role) => (role === 'assistant' && cutOldPages ? pageOnly(text) : text);
  function effectiveReasoning(connection, story) {
    return effectiveReasoningOf(connection, story); /* M308: pure, in effort.js — the story's level no longer drops the connection's thinking room */
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
  /* M509-8: THE HOUSE'S OWN HEALS SURVIVE A REWIND. The join of "the courier" onto Hachigorō (M509-2) and the clearing
   * of a seat-made core (M508) are written on the NEWEST page — and a Try again folds to the page before it, which
   * drops everything stamped on the page let go: the courier stood twice again in every retry's request, and the
   * page reader joined him again after every new version, and the next retry threw it away again. A heal is derived
   * from the ledger, not read from a page: the fold heals what it folds to, on that page's own stamp (healFold). */
  function healFold(folded) {
    try {
      const heals = [...seatMadeCores(folded), ...descriptorsThatAreNamed(folded)];
      if (heals.length) { const healed = applyMutations(folded, heals); if (healed.applied.length) return healed.state; }
    } catch (err) { /* the fold stands as folded */ }
    return folded;
  }
  async function foldTo(story, targetPage) {
    const current = await loadState(story.id);
    const snaps = await loadSnapshots(story.id);
    const folded = healFold(foldJournal(current, snaps, targetPage, applyMutations)); /* M509-8 */
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
  let rereadOwed = null; /* M509-10: { storyId, pageId } — the page before, to be read again by the house itself */
  /* M509-10: NO CHECKPOINT OF THAT MOMENT → THE HOUSE REBUILDS IT. The ledger folds to the page before the page before
   * (its own boundary, no check — the check is what brought us here), that page's readers run over it again, and the
   * retry waits for them: the ledger it is built from is that page's, read fresh. Nothing is asked of the writer. Done
   * inline (rereadPage steps aside while the house is busy, and its replay would read the page let go as well). */
  async function settleRereadOwed(story) {
    const owed = rereadOwed; rereadOwed = null;
    if (!owed || !story || owed.storyId !== story.id) return;
    try {
      const history = await db.messages.list(story.id);
      const msg = history.find((m) => m && m.id === owed.pageId);
      if (!msg || msg.role !== 'assistant') return;
      const boundary = boundaryFor(history, msg.id);
      if (boundary) await rewindTo(story, history, boundary.id, { checkless: true });
      const before = history.slice(0, history.indexOf(msg));
      const lastUser = [...before].reverse().find((m) => m && m.role === 'user');
      startBackgroundWork(story, msg, lastUser ? pageText(lastUser) : '');
      await pendingWork(story.id, 180000); /* the read lands before the retry is built from it */
    } catch (err) { /* the ledger stands as rewound */ }
  }
  async function rewindTo(story, history, userMsgId, { checkless = false } = {}) {
    if (!userMsgId) return false;
    const list = Array.isArray(history) ? history : [];
    const at = list.findIndex((m) => m && m.id === userMsgId);
    const current = await loadState(story.id);
    /* M509-9: the boundary checkpoint before the page let go, held before the fold lets the later boundaries go */
    let boundarySnap = null;
    try { const held = (await loadSnapshots(story.id)).find((e) => e && e.id === userMsgId); boundarySnap = held && held.snap ? JSON.parse(JSON.stringify(held.snap)) : null; } catch (err) { boundarySnap = null; }
    let rewound = false;
    if (at !== -1 && (current.journal || []).length) {
      const target = list.slice(0, at).filter((m) => m && m.role === 'assistant' && !m.hidden).length - 1;
      await foldTo(story, target);
      rewound = true;
    } else {
      const order = list.filter((m) => m && m.role === 'user').map((m) => m.id);
      bumpChain(story.id);
      const r = await restoreNearestSnapshot(story.id, order, userMsgId);
      if (!r) return false;
      if (!r.exact) pendingAudit.add(story.id);
      rewound = true;
    }
    /* M509-9: A REWIND IS CHECKED WHOLE, NEVER PATCHED. M509-7 set the hour from the previous page's header after a
     * rewind — which would have hidden a rewind that failed (the hour right, the room and the books still the page
     * let go). The header is a CHECK: if the rewound ledger's hour is not the previous page's header hour, the fold
     * did not land on that page, and the whole ledger is taken from the boundary checkpoint before the page let go
     * (M21) — the room, the books, the hour together. If that is not there either, the writer is told; nothing is
     * dressed up. */
    try {
      const prev = !checkless && at !== -1 ? [...list.slice(0, at)].reverse().find((m) => m && m.role === 'assistant' && !m.hidden && !m.ooc && pageText(m).trim()) : null;
      const headerClock = prev ? headerMutations(pageText(prev)).find((m) => m && m.type === 'clock.set' && [m.year, m.month, m.day, m.hour, m.minute].every(Number.isInteger)) : null;
      if (headerClock) {
        /* the same hour is "already so" (M259): a clock.set that changes nothing is refused with same: true. A ledger with
         * no clock at all is not a failed rewind — the page before was never read (a tale seeded by hand) — so only a
         * clock that stands and disagrees is a mismatch. */
        /* M679: the HOUR is the check — the header's own day words ride a clock.set now, and a checkpoint written before
         * they did (the same minute, the real weekday's words) is still that page's hour */
        const { dayWords: _ownDay, ...hourOnly } = headerClock;
        const sameHour = (st) => { const probe = applyMutations(st, [hourOnly]); return !probe.applied.length && probe.rejected.some((r) => r && r.same); };
        const hasClock = (st) => Boolean(st && st.clock && Number.isFinite(st.clock.minutes));
        let after = await loadState(story.id);
        if (hasClock(after) && !sameHour(after)) {
          if (boundarySnap && sameHour(boundarySnap)) {
            const restored = healFold({ ...boundarySnap, pendingVerdict: null }); /* the whole ledger of that moment, its own heals with it */
            bumpChain(story.id);
            await saveState(story.id, restored);
            notify(story.id);
            after = restored;
          }
          /* M509-10: NO CHECKPOINT OF THAT MOMENT → THE HOUSE REBUILDS IT ITSELF. The page before is read again from
           * its own boundary (what an unfinished chain gets on open, M127) once the page let go is gone — the caller
           * owes that read before it builds the retry; nothing is asked of the writer */
          if (hasClock(after) && !sameHour(after) && prev) rereadOwed = { storyId: story.id, pageId: prev.id };
        }
      }
    } catch (err) { /* the check is a courtesy over the fold, never a crisis */ }
    return rewound;
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
  /* M160: NOTHING ASKS THE READER TO TRY AGAIN. A rebuild holds `replaying`
   * from the moment history changes until the tail job lands — through the
   * readers in flight, a whole reading chain and its retries: minutes on a
   * slow wire. Every swipe, edit, retry, branch and delete in that window
   * used to be refused with "one moment, then try again", so the writer had
   * to watch the house and press the same button a second time. They wait
   * for the gate instead and then run themselves. */
  let replayWaiters = [];
  function setReplaying(v) {
    replaying = Boolean(v);
    if (!replaying && replayWaiters.length) {
      const waiting = replayWaiters;
      replayWaiters = [];
      for (const done of waiting) { try { done(); } catch (err) { /* a waiter's trouble is its own */ } }
    }
  }
  /* Resolves true once no rebuild stands (at once when none does), false if
   * one somehow outlasts the ceiling — the caller then says so plainly. */
  function afterReplay(ceilingMs = 300000) {
    if (!replaying) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => { if (!settled) { settled = true; resolve(ok); } };
      replayWaiters.push(() => finish(true));
      setTimeout(() => finish(false), ceilingMs);
    });
  }
  /* The one gate every history-changing action passes. Returns false only
   * when the rebuild never finished — the single case worth a word. */
  async function waitForRebuild() {
    if (!replaying) return true;
    toast('The ledger is finishing its rebuild — this runs the moment it’s done.');
    if (await afterReplay()) return true;
    toast('The rebuild is taking unusually long — try once more in a moment.');
    return false;
  }
  async function replayFrom(story, fromMessageId, { changed = true, shiftAfter = null, kOverride = null, atOverride = null } = {}) {
    if (replaying) return false;
    setReplaying(true);
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
      { const all = await loadVersionStates(story.id); const staleIds = new Set(vis.slice(at).map((m) => m.id)); for (const key of Object.keys(all)) if (staleIds.has(key.split(':')[0])) delete all[key]; await writeVersionStates(story.id, all); }
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
          /* M675 — THE PAGES AFTER THE CHANGE ARE AS READ AS THEY WERE. Their writes were just put back from the journal,
           * exactly — that is the whole point of a replay (M68: "read the changed page once") — but the reading mark was
           * left at the changed page, so every later page counted as unread, and the house's own catch-up then read
           * each of them again: an edit of page 2 of a tale of 300 owed 298 readings ("Reading the pages the ledger
           * missed"). Measured in the app (the audit of M674): six pages, page 2 edited — the mark stood at page 2.
           * Each later page that had been read before the replay is marked read again, at the place it now stands
           * (one down, past a page that was let go); a page that had NOT been read is still owed its reading. */
          {
            const wasMark = readMark(current);
            const wasAhead = new Set(Array.isArray(current.readAhead) ? current.readAhead : []);
            const top = Math.max(wasMark, ...wasAhead);
            for (let was = k + 1; was <= top; was += 1) {
              if (!(was <= wasMark || wasAhead.has(was))) continue;
              const now = shiftAfter !== null && was > shiftAfter ? was - 1 : was;
              if (now >= 0 && now <= lastIndex) markPageRead(st, now);
            }
          }
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
            const idx = shownIndex(fresh); /* M576: the one rule */
            if (fresh) await saveVersionState(story.id, lastA.id, idx, st);
          }
          pendingAudit.delete(story.id);
          notify(story.id);
          toast(`History changed at page ${at + 1} — the ledger was folded back and rebuilt${pages ? ' with one reading' : ''}.`);
          return { silent: true };
        } finally {
          setReplaying(false);
        }
      } });
      noteWork(story.id, tail);
      /* M293: a tail that never RUNS (dropped by the writer's Stop, or left
       * behind by a story switch) settles without its finally — the gate is
       * let go here, or every history change waits five minutes and is then
       * refused for the rest of the session. */
      tail.then((r) => { if (!r || r.ok !== true) setReplaying(false); }, () => setReplaying(false));
      return true;
    } finally {
      if (!tailQueued) setReplaying(false);
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

  /* M127: THE READERS FINISH WHAT THEY STARTED. The chain's last link writes
   * the page's version checkpoint; a story closed mid-chain has a last page
   * with no checkpoint. On open, that page is read again from its boundary
   * (what "read again" does) — each link's writes are whole or absent, so
   * nothing is applied twice. A story from before checkpoints earns one
   * read on its first open, and that is right. */
  async function resumeUnfinishedChain(story) {
    if (!story || busy || replaying) return false;
    /* a story made in the last minute — a fresh branch, a new tale — settles
     * its own ledger (branchFrom decides exact or re-read); nothing to resume */
    if (Number.isFinite(story.createdAt) && Date.now() - story.createdAt < 60000) return false;
    const history = await db.messages.list(story.id);
    const vis = visiblePages(history);
    const last = [...vis].reverse().find((m) => m.role === 'assistant');
    if (!last || last.ooc) return false;
    if (last.stopped || (typeof last.text === 'string' && !last.text.trim())) return false;
    const idx = shownIndex(last); /* M576: the key the checkpoint step wrote — read by another rule, a page with versions and none chosen was "unfinished" on every open and read again */
    if (await versionStateFor(story.id, last.id, idx)) return false;
    /* a chain still running in THIS session is not unfinished (M675: its readers — the helpers a tale's opening sends
     * out are no chain) */
    if (readersOut(story.id)) return false;
    /* M293: nor is one another browser's readers are still finishing — its
     * checkpoint comes with that browser's next whole-book push */
    if (otherHandAt(story.id)) return false;
    await rereadPage(last.id, { quiet: true });
    toast('The readers had not finished the last page — reading it now.');
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
  /* M107: pages that leave the story take their checkpoints with them — the
   * version states keyed to them and the boundary snapshots keyed to a
   * writer's page among them. A checkpoint for a page that is gone was a leak
   * the store's consistency check found after retries and deletes. */
  async function forgetCheckpoints(storyId, ids) {
    const gone = new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean));
    if (!gone.size) return;
    try {
      const all = await loadVersionStates(storyId);
      let touched = false;
      for (const key of Object.keys(all)) if (gone.has(key.split(':')[0])) { delete all[key]; touched = true; }
      if (touched) await writeVersionStates(storyId, all);
      const snaps = await loadSnapshots(storyId);
      if (snaps.some((e) => e && gone.has(e.id))) await saveSnapshots(storyId, snaps.filter((e) => !(e && gone.has(e.id))));
    } catch (err) { /* best-effort housekeeping */ }
  }

  /* M507-6: the version ledgers live one to a row (state.js); these doors keep their names */
  const loadVersionStates = (storyId) => loadAllVersionStates(storyId); /* M314: handed back whole, stored without their journals */
  const writeVersionStates = (storyId, all) => saveVersionStates(storyId, all); /* M314: stored as ledgers plus keys into the tale's bank */
  async function saveVersionState(storyId, messageId, swipeIdx, state) {
    await saveOneVersion(storyId, messageId + ':' + swipeIdx, state); /* one row and the index — never the sixty */
  }
  async function versionStateFor(storyId, messageId, swipeIdx) {
    return versionStateOf(storyId, messageId + ':' + swipeIdx);
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
    let choicesNow = false; let choiceNow = null; /* M548: Choices matter — the switch, and the choice he took on this move */
    const generateArgs = opts; /* M117: carried for the one re-ask a leak earns */
    const { directive = '', ooc = false, swipeTarget = null, replayAfter = false } = opts;
    let receipt = null;
    let landed = false; /* M40: true once a page (or a version) was written */
    /* M10: set when the prose carried [EPISODE_END] (M15 audit: this was
     * assigned below but never declared — a second ReferenceError waiting
     * behind the missing imports). */
    let episodeEnded = false;
    let leakedControl = false; /* M117: the provider let control tokens through */
    let ranPast = false; /* M469: the model ran past its end-of-turn and began the writer's next turn */
    let cutMine = false; /* M510: the small model began playing him, and the page ended there */
    let releaseCheckpoint = () => {}; /* M570: the turn's checkpoint is kept once the page is done with the main thread — released on every path */
    let checkpointPending = null; /* M570: and the next send never starts before it is kept */
    try {
      const story = await activeStory();
      if (!story) return;
      /* M675 (the second reading): THE TELLING SAYS WHOSE IT IS, AND CAN BE STOPPED FROM ITS FIRST MOMENT. Until the
       * request itself began there was nothing to stop (the controller was made just before it): a tale let go in the
       * seconds before — while the readers of the page before are waited for, the referee rules, the opener writes —
       * was deleted with the telling still on its way, and the page landed in a tale that was gone. The controller
       * stands from here; the calls made before the request are on leashes it cuts, and between them the telling looks
       * whether it has been stopped. (His own Stop button shows when the request begins, as before.) */
      tellingFor = story.id;
      const mine = new AbortController();
      abort = mine;
      const letGoNow = () => mine.signal.aborted || lettingGo.has(story.id);
      const earlyLeash = (w) => { if (mine.signal.aborted) w.abort(); else mine.signal.addEventListener('abort', () => w.abort(), { once: true }); return w; };

      let connection = await resolveConnection(story);
      noteTellerConnection(connection && connection.id); /* M328: the workers are told whose prefill is the story's */
      noteQuickRecent(connection && connection.id); /* M638: a model that tells a page is one he tells with */
      /* M289: the provider's word on its room, waited for a moment on the first page */
      if (connection) connection = await learnContextWithin(connection, 1500);
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
      /* M536: WHERE THE STORY BEGINS, CHECKED WHERE ITS FIRST PAGE IS BUILT. A #story opening a tale is placed before its first
       * page — here, not only on the send, so a Try again after a lost connection restarts the check (said, so the wait is
       * not a silence; its own ceiling; a failed call written down as nothing, so the next chance asks again). */
      if (!ooc && !history.some((m) => m && m.role === 'assistant' && !m.hidden)) {
        try {
          const firstUser = history.find((m) => m && m.role === 'user' && !m.hidden);
          const words = firstUser ? String(firstUser.typed || '') : '';
          const key = CANON_START_KEY(story.id);
          const had = await db.settings.get(key);
          const concept = /^\s*#story\b/i.test(words) ? words.trim().replace(/^#story\s*/i, '').trim() : '';
          const moved = Boolean(had && !had.words && had.conceptFp && concept && had.conceptFp !== hashText(concept));
          if (concept && (!had || moved)) {
            const placer = await resolveWorkerConnection(story, 'founder');
            const w = earlyLeash(workerSignal(30000));
            showComposerNote('Checking which series your story is from…'); /* M519-4: not "canon" — it is not canon verification */
            let got = null;
            try { got = await placeInCanon({ connection: placer, concept, brief: story.brief || '', signal: w.signal }); } finally { w.done(); hideComposerNote(); }
            if (got && got.start) { await db.settings.set(key, { ...got.start, conceptFp: hashText(concept), at: Date.now() }); toast('Your story begins in ' + got.start.series + (got.start.arc ? ' — ' + got.start.arc : '') + '.'); }
            else if (got && got.none) await db.settings.set(key, { none: true, conceptFp: hashText(concept), at: Date.now() });
            else if (!(got && got.failed)) await db.settings.set(key, { tried: Date.now() });
          }
        } catch (err) { /* the page goes on without it */ }
      }
      if (letGoNow()) return landed; /* M675 */
      const settingsValues = { ...(await gatherSettings()), refereeOn: (await db.settings.get('refereeOn')) !== false }; /* M345: the switch reaches the assembler */
      /* M339: THE SWITCH — "let a model that cannot think, think on its page". OFF (as it ships): not one byte of any request
       * changes. ON: on a turn whose connection has its thinking OFF (a story page, never an out-of-character answer) the
       * closing message asks the teller to think first inside a think-tag and then write the page. A connection that
       * thinks natively is left alone — it already has somewhere to think. */
      /* M510: the small-model mode is the storyteller connection's own (the Small model tick) — its help on story pages
       * only; what a small model is sent of the frame, the note and his own-voice words follows his three small-model
       * switches (off unless he turns them on — in his tests they made a small model dumber), on every turn it tells. */
      const smallTeller = isSmallModel(connection);
      settingsValues.smallModelNow = !ooc && smallTeller;
      if (smallTeller) {
        settingsValues.frameOn = (await db.settings.get('frameOnSmall')) === true;
        settingsValues.noteOn = (await db.settings.get('noteOnSmall')) === true;
        /* M629 (the session's audit): THE ADDED NOTES FOLLOW THE SMALL MODEL'S NOTE SWITCH TOO. M624 gave his note's switch to
         * his note alone — right for every model — but it let the added notes (the house's thinking note among them) ride
         * to a small model past "Send the note to a small model", which holds the note family back because in his tests it
         * made a small model dumber (M510). Off, they are held; the receipt says so. */
        if (!settingsValues.noteOn) {
          if (addedNotes(settingsValues.noteAdds).length) settingsValues.noteAddsHeldForSmall = true;
          settingsValues.noteAdds = [{ id: HOUSE_COT_ID, on: false }];
        }
        if ((await db.settings.get('ownWordsOnSmall')) !== true) {
          /* M510-9: held back, and the receipt says so — his own-voice words did not vanish */
          if (Array.isArray(settingsValues.ownWords) && settingsValues.ownWords.some((w) => w && w.on !== false && String(w.text || '').trim())) settingsValues.ownWordsHeldForSmall = true;
          settingsValues.ownWords = [];
        }
      }
      const thinkingOffNow = String((effectiveReasoning(connection, story) || {}).effort || 'off') === 'off';
      settingsValues.thinkOnPageNow = !ooc && thinkingOffNow && (await db.settings.get('thinkOnPage')) === true;
      /* M3 (the latency law): if the workers are still reading the previous
       * page, the send path waits for them — hard five-second ceiling on
       * each link of the chain, then we go on with last-good state — BEFORE
       * the assembler looks at anything. */
      await pendingWork(story.id, 5000);
      if (letGoNow()) return landed; /* M675 */
      let state = await loadState(story.id);
      /* M386: CANON VERIFICATION OFF SENDS NOTHING OF IT — not its note, and not the series' truths it wrote into What's
       * true of them: withdrawn from the ledger (a story page may write), or left out of this turn's copy (an
       * out-of-character turn may not). Switched on again, the next page writes them back. */
      if (!(await canonOn(story.id))) {
        if (!ooc) { try { const cleaned = await canonWithdraw(story.id); if (cleaned) state = cleaned; } catch (err) { /* the copy below still holds */ } }
        state = withoutCanonTruths(state);
      }

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
      /* M675: HIS MOVE IS WHAT HE TYPED. A text file he attached rides in the same page (M668), and everything that asks
       * "what is his character doing?" was reading the file as part of it: with a notes file attached, "I sit down next
       * to Rukia and hand her the tea." passed the referee's gate on the file's verb "strike" (a 12-second ruling held
       * the page, on a move that was his line plus the file's first lines), and a markdown heading "# Roll tables" or
       * "# Skip list" was read as his own override. The referee, its gate and the small model's "is this a fight?" read
       * his typed words; what the storyteller is sent, and what is recalled for it, still holds the file. */
      const moveText = typedWords(userText);
      /* M548: the choice he took, its seal whole (his words as sent) — none with the switch off, on an out-of-character turn,
       * or when the move is his own */
      choicesNow = !ooc && choicesOn(story);
      choiceNow = choicesNow && lastUser ? takenOf(lastUser) : null;
      /* M346: CANON VERIFICATION runs as SillyTavern runs it — its interceptor before the page, holding the turn only as
       * long as its own windows allow (it finishes in the background and the next page gets it). Beside the referee,
       * not after it. OFF (as it ships) or an out-of-character turn: never called, not one byte. */
      const canonAskedAt = Date.now(); /* M534: a canon report older than this is not this turn's */
      const canonPending = (!ooc && lastUser && (await canonOn(story.id)))
        ? (async () => {
          const canonConnection = await resolveWorkerConnection(story, 'canon');
          return canonBeforeSend({ story, state, messages: history, connection: canonConnection, type: swipeTarget ? 'swipe' : 'normal' });
        })().catch(() => '')
        : null;
      /* M547: THE SMART RECALL IS ASKED HERE, BESIDE THE REFEREE AND CANON — it reads only his move, the last page, the
       * essentials and the record, none of which they change — and its answer is taken just before the request is built
       * (below). Asked there, after them, its wait came on top of theirs; now it runs while they do. For every storyteller
       * — a small one too (M547): its helper planned before his move, and his words alone matched the old lines. */
      const recallPending = smartRecallFor({ story, history, userText, state, small: settingsValues.smallModelNow === true });
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
      let refereeWhy = ooc ? 'an out-of-character question — the referee never rules on one' : ''; /* M513: why nothing was ruled, for the receipt */
      /* M533: A #STORY IS THE PREMISE, NOT A MOVE. Written in the first person ("#story I parry Kenjaku's blow…") it passed the
       * referee's gate and could be ruled — against his own premise, before anyone was weighed. The referee rules from the
       * first move after it. */
      const premise = Boolean(lastUser && /^\s*#story\b/i.test(String(lastUser.typed || '')));
      if (premise) refereeWhy = 'your #story is the premise — the referee rules from the first move after it';
      if (choiceNow) refereeWhy = 'you took a choice — what follows it was sealed before you chose, so the referee does not rule on it (Choices matter)'; /* M548 */
      if (!ooc && lastUser && !premise && !choiceNow) {
        const { signal, done } = earlyLeash(workerSignal(12000)); /* the referee's 12s budget */
        try {
          const refSettings = await refereeSettings();
          /* M345: THE REFEREE OFF MEANS THE STORYTELLER DECIDES EVERYTHING — a fight the referee was keeping when it was
           * switched off is let go (its lasting hurts go to the body ledger, as at any fight's end), so nothing of it is
           * carried for the storyteller or left standing for the day the switch comes back */
          if (!refSettings.on && ((state.duel && state.duel.active) || (state.battle && state.battle.active))) {
            state = applyMutations(state, [{ type: 'combat.end' }]).state;
            await saveState(story.id, state);
          }
          if (refSettings.on) {
            const workerConnection = await resolveWorkerConnection(story, 'referee');
            /* M531: A FIGHT NEVER STARTS WITH AN UNWEIGHED FIGHTER. His first fight came before the sheet had ever been
             * weighed (the seeder waited for two pages, and ran after them): his main character fought as a 5 — the plain
             * rating of someone unknown. Now, when this move goes to the referee (an attempt, or a fight under way) and the
             * main character or someone here is not on the sheet, they are weighed first — once, said so the wait is not a
             * silence, within its own ceiling; a weighing that fails never holds the page. */
            try {
              const fightOn = Boolean((state.duel && state.duel.active) || (state.battle && state.battle.active) || (state.war && state.war.active));
              const goes = gatePasses(moveText, refSettings.sensitivity || 'normal', { inFight: fightOn, tense: Boolean(state.mode && state.mode.combat) }).pass; /* M616 */
              const here = (Array.isArray(state.present) ? state.present : []).map((p) => (typeof p === 'string' ? p : p && p.name)).filter(Boolean);
              /* M532: someone the last weighing already saw here and left off the sheet (a crowd, a voice, a bystander) does not
               * call a weighing before every blow; a NEW face — an enemy who just walked in — does, as a GM would */
              const seenBefore = seenAndLeftOff(state); /* M615: one answer — honest for a sheet weighed before the weighing was shown everyone here */
              /* M616: ONLY THE MAIN CHARACTER IS WEIGHED ON THE WAIT BEFORE HIS PAGE (M531's own case — his first fight before the
               * sheet was ever weighed). Anyone else not yet weighed — a summon just called, a foe just arrived — the referee rates
               * on the spot, as it always could, and the house weighs them by itself right after the page (SEED_NEW_FACE_GAP 1):
               * a weighing reads the whole story and could hold his page for most of a minute. `here` stays for the words below. */
              void here;
              const unweighed = [mcName(state)].filter((n, i, all) => n && n !== 'the player' && all.indexOf(n) === i && !findActorKeySamePerson(state, n) && !(n !== mcName(state) && seenBefore.has(String(n).toLowerCase())));
              if (goes && workerConnection && unweighed.length && history.some((m) => m && m.role === 'assistant' && !m.hidden)) {
                const w = earlyLeash(workerSignal(45000));
                showComposerNote('Weighing everyone before the fight…');
                try { await maybeSeedSheet({ connection: workerConnection, storyId: story.id, signal: w.signal, force: true, brief: story.brief || '', castNotes: story.castNotes || '' }); } finally { w.done(); hideComposerNote(); }
                const weighed = await loadState(story.id);
                if (weighed && weighed.sheet) state = { ...state, sheet: weighed.sheet, seedDueAfterFight: weighed.seedDueAfterFight };
              }
            } catch (err) { /* the fight goes on with what the sheet holds */ }
            const step = await refereeStep({
              connection: workerConnection,
              userText: moveText, /* M675 */
              pageWhole: userText, /* M675: a ruling committed when the whole page was read as his move is still this turn's */
              userId: lastUser.id,
              history,
              state,
              settings: refSettings,
              signal,
              brief: story.brief || '', castNotes: story.castNotes || '', /* M345: the referee reads who these people are */
            });
            state = (step && step.state) || state;
            refereeWhy = refereeWhyWords(step); /* M513 */
            if (step && step.ruling) {
              state = { ...state, pendingVerdict: { ...step.ruling, forUser: lastUser.id }, lastVerdict: step.ruling }; /* M345: whose page it settles */
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
          refereeWhy = refereeWhyWords({ status: 'degraded', why: err && err.message === 'timeout' ? 'timed out' : (err && err.message) || 'stumbled' }); /* M513 */
          await noteWorkerRun(story.id, 'referee', {
            ok: false,
            why: err && err.message === 'timeout' ? 'outwaited' : (err && err.message) || 'stumbled',
          });
        } finally {
          done();
        }
      }
      if (letGoNow()) return landed; /* M675 */
      /* M21: TRUE rollback — the boundary snapshot, keyed by this turn's user
       * page. M72: taken AFTER the referee, so it carries the committed fate
       * (the rewound ledger used to have no commit, and a swipe rolled the
       * die again) and this turn's page stamp; a fold never re-arms the
       * ruling it holds. OOC turns do no state work and take no snapshot. */
      /* M570: the checkpoint is TAKEN here (its copy of the ledger, before anything else moves) and KEPT while the page is
       * asked for — measured, keeping it in front of the request cost the send ~500 ms at the phone-speed test once each
       * person's page was banked by its content; the page lands only after it is kept (awaited below), so a Try again the
       * moment the page lands finds this turn's own checkpoint. */
      let checkpointing = null;
      if (!ooc && lastUser) {
        const after = new Promise((go) => { releaseCheckpoint = go; });
        checkpointing = snapshotState(story.id, lastUser.id, state, { after }).catch(() => {});
        checkpointPending = checkpointing;
      }

      const allModules = await listModules();
      /* M85-002: the writer's own words for this turn ride to the predicates
       * (the intimate rule wakes a beat before the extractor's flag). */
      /* M675 (the second reading): HIS words — what he typed, not a file riding in the same page (moveText). This was the
       * one reader of "his words" the first pass missed: a quiet line with a notes file that said "stabs … undresses"
       * woke the fight and intimate rules, and a file over 6,000 characters kept his own "I draw my sword" from waking them. */
      const selected = selectModules(allModules, { ...state, castNotes: story.castNotes || '', turnText: lastUser && !lastUser.hidden ? moveText : '' });
      /* M6: slot 7 — what the keeper has folded of the older pages. */
      const mem = await loadMemory(story.id);
      /* M9 (A1): the window law. The keeper's own switch decides whether the
       * window is the memory window or a token-budgeted cutoff against the
       * connection's context room. */
      const keeperOn = story.keeper === true
        ? true
        : story.keeper === false ? false : (await db.settings.get('memoryKeeper')) !== false;
      const memWindow = windowFor(mem, await db.settings.get('memoryWindow')); /* M317: the writer's current setting, as the keeper reads it */
      /* M162: THE COVERAGE LAW WAS DEAD ON THE WIRE. M12 said slot 8 may never
       * let a page fall that no record line holds — and windowPlan only
       * applies it when it is handed the nodes. The window built here never
       * carried them, so the law never once ran in the room: after a stumbled
       * keeper, a quiet stretch or a hole punched by an edit, a page rolled
       * out of the verbatim window before any line covered it and was simply
       * GONE from the storyteller's sight — not in the pages, not in the
       * record. The nodes ride now, and the record's own cut is taken from
       * the plan that results, so a widened window still never sends a line
       * and the page it summarizes together (M44). */
      const windowInfo = {
        keeperOn,
        /* The story's memory keeps its own window once it has one; before
         * that, the house slider (Settings → How much the story remembers)
         * speaks — the help text under it is now true (M9, §1). */
        window: memWindow,
        nodes: mem && Array.isArray(mem.nodes) ? mem.nodes : undefined,
        budgetTokens: roomOf(connection), /* M343; M285: the provider's room when none is set */
      };
      /* M44: a line and the page it summarizes never ride together — measured
       * against the window that will ACTUALLY be sent, coverage law included. */
      const verbatimStart = keeperOn
        ? windowPlan({ pages: visiblePages(history), memory: { window: memWindow, nodes: windowInfo.nodes } }).resting
        : Math.max(0, visiblePages(history).length - memWindow);
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
      /* M287: the request is built once without the record and measured; the
       * record takes what is truly left (recordRoom, fixedChars). */
      /* M517: THE AUTOMATIC BRIEF — with the story's brief on Automatic, the world rides in the brief's seat (his own brief
       * beside it); the canon start is one of its sources, so it is not said twice; canon's note stops repeating the story's
       * position in canon (the legacy switch keeps it whole) */
      const groundNow = story.briefMode === 'automatic' ? await (async () => {
        const kept = await db.settings.get(GROUND_KEY(story.id));
        /* M526: a world last looked at over more pages than the record now covers (pages taken back) is not sent — it may
         * hold what those pages did; the world keeper writes it again after this page */
        if (kept && kept.by !== 'writer' && Number.isFinite(kept.recordLines)) {
          const nodesNow = ((await loadMemory(story.id)) || {}).nodes || [];
          const coveredNow = nodesNow.filter((n) => n && !n.empty && Array.isArray(n.span)).reduce((mx, n) => Math.max(mx, n.span[1] + 1), 0);
          if (coveredNow < kept.recordLines) return '';
        }
        return groundWords(kept);
      })() : '';
      const canonLegacy = (await db.settings.get('canonLegacy')) === true;
      const canonNote = ((n) => (groundNow && !canonLegacy ? canonWithoutWorld(n) : n))(canonPending ? ((await canonPending) || '') : ''); /* M346: its windows have closed — whatever it holds rides */
      /* M518: CANON ON THEIR OWN PAGE — in the same mode, what canon says of each person that lasts (who they are, their
       * nature, how they talk) is kept on their page, replaced whenever canon's lens says otherwise; their card carries it
       * and the builder leaves out of canon's note exactly what the cards carry. Only a page that exists; never a secret,
       * never this scene's lines. The ledger is written from a fresh read, so a reader's write in the meantime stands. */
      const canonOnPages = Boolean(groundNow && !canonLegacy && canonNote);
      if (canonOnPages) {
        try {
          const chars = (state && state.characters) || {};
          const muts = [];
          for (const b of canonBlocks(canonNote)) {
            const key = findPersonKey(chars, b.name);
            if (!key) continue;
            const lasting = lastingLines(b.lines);
            const had = Array.isArray(chars[key].canon) ? chars[key].canon : [];
            if (lasting.length && !(had.length === lasting.length && had.every((l, i) => l === lasting[i]))) muts.push({ type: 'people.canon', name: key, lines: lasting });
          }
          if (muts.length) {
            state = applyMutations(state, muts).state;
            const fresh = await loadState(story.id);
            const kept = applyMutations(fresh, muts);
            if (kept.applied.length) await saveState(story.id, kept.state);
          }
        } catch (err) { /* the note then rides whole — nothing is lost */ }
      }
      /* M357: what the house saw in the last page (the small storyteller's guard), once — taken and let go.
       * M636: else the ONE law the sensors find slipping on the pages that stand — read from the pages themselves, so a
       * turn asked for again is told the same thing, a page taken back takes its part away, and with the switch off
       * nothing is read and nothing is said. */
      let sensorNote = ''; let sensorOwn = ''; let sensorRole = '';
      if (!ooc) {
        sensorNote = await takePageWord(story.id);
        if (!sensorNote && (await db.settings.get('sensorsOn')) === true) {
          const stand = visiblePages(history).filter((m) => m && m.role === 'assistant' && !m.ooc && !m.hidden && pageText(m).trim());
          const lastStand = stand[stand.length - 1];
          const due = await sensorWordForTurn(story.id, {
            pages: stand.slice(-SENSOR_LOOK).map((m) => ({ text: pageText(m), scores: senseOf(m, versionOf(m), pageText(m)) })),
            index: stand.length,
            others: (Array.isArray(state && state.present) ? state.present : []).map((p) => (typeof p === 'string' ? p : p && p.name)).some((n) => n && n !== mcName(state)),
            names: Object.keys((state && state.characters) || {}),
            /* one home for a law: what the house's eye says this turn is not said twice; and a small storyteller's talk,
             * sounds and worn phrases are its own planner's and brake's to mind (M510, M519), never asked for here */
            covered: (lastStand && Array.isArray(lastStand.findings) ? lastStand.findings : []).filter((f) => f && f.kind === 'craft' && f.severity === 'warn').map((f) => f.law),
            small: settingsValues.smallModelNow === true,
          });
          if (due) {
            sensorNote = due.word; sensorOwn = due.own;
            /* his choice — as the storyteller's own words only where that can stand (sensors.js sensorRoleFor) */
            sensorRole = sensorRoleFor(await db.settings.get('sensorsRole'), { model: connection && connection.model, twins: twinsRefused(connection), small: settingsValues.smallModelNow === true });
          }
        }
      }
      /* M510: THE SMALL REQUEST'S PLAN — the one the helper made after the page this turn follows (Try again finds the
       * plan for the page before the one it replaces); none yet → the whole request goes, as before */
      let smallPlan = null; let smallIntense = false; let lastSound = null; let smallEssentials = null; let smallPlansBook = null; let voiceSample = null; /* M512 */
      let loudNow = false; /* M519: the last pages drowned in sounds and dashes */
      let quietNow = false; /* M519-5: the last page, with people in it, let almost no one speak */
      const canonStartNow = canonStartWords(await db.settings.get(CANON_START_KEY(story.id))); /* M516: where our story began in its canon */
      if (settingsValues.smallModelNow === true) {
        const before = [...visiblePages(history)].reverse().find((m) => m && m.role === 'assistant' && !m.ooc && pageText(m).trim());
        smallPlan = await loadPlan(story.id, planKey(before)); /* M510-6: the plan of the page this follows, mended or not */
        smallIntense = heatedNow(selected, state, moveText); /* M510-3: from what woke (his own imported rules too) and the ledger's own intimate mode; M510-7: his words starting a fight */
        lastSound = ((await loadPlans(story.id)) || {}).lastSound || null;
        /* M519-2: judged from the very pages it is about to read, not only from what was measured after each new page — a story
         * whose loud pages were written before the brake existed (his, five scenes in) is braked on its very next page */
        {
          /* M527: the brake's hold is read from the pages too — walked over the last ten, as each page would have been judged —
           * so a page swiped away, deleted, or left behind by a branch holds nothing: only the pages that stand decide */
          const told = visiblePages(history).filter((m) => m && m.role === 'assistant' && !m.ooc).slice(-10);
          let held = false;
          const seen = [];
          for (const m of told) {
            const t = pageTexture(pageText(m));
            seen.push({ soundPer100: t.soundPer100, dashPer100: t.dashPer100 });
            held = tooLoudNow(seen.slice(-3), { wasLoud: held });
          }
          loudNow = held;
        }
        /* M519-5: the house's eye found the last page almost silent (its Dialogue Ratio note, under the craft's floor) while
         * someone besides him was in the scene — the next small page is told the people here talk */
        {
          const lastA = [...history].reverse().find((m) => m && m.role === 'assistant' && !m.hidden);
          const ratio = lastA && Array.isArray(lastA.findings) ? lastA.findings.find((f) => f && f.law === 'Dialogue Ratio' && /Spoken dialogue is \d+%/.test(String(f.words || ''))) : null;
          const share = ratio ? Number((String(ratio.words).match(/Spoken dialogue is (\d+)%/) || [])[1]) : NaN;
          const others = (Array.isArray(state && state.present) ? state.present : []).map((p) => (typeof p === 'string' ? p : p && p.name)).filter((n) => n && n !== mcName(state));
          quietNow = Number.isFinite(share) && share < 6 && others.length > 0;
        }
        /* M512: A PASSAGE OF THE STORY AT ITS BEST — the newest page a big storyteller wrote (older than the pages sent
         * whole); a page's receipt says which (small, from M512; before it, the model named, or the plan it rode with) */
        try {
          const smallModels = new Set(((await db.connections.list()) || []).filter((c) => c && c.smallModel === true).map((c) => String(c.model || '')).filter(Boolean));
          const bigHand = (m) => {
            const r = m && m.receipt;
            if (!r || typeof r !== 'object') return false;
            if (typeof r.small === 'boolean') return !r.small;
            if (Array.isArray(r.slots) && r.slots.some((x) => x && x.name === 'The plan for this page' && x.tokens > 0)) return false;
            return Boolean(r.model) && !smallModels.has(String(r.model));
          };
          const told = visiblePages(history).filter((m) => m && m.role === 'assistant' && !m.ooc);
          voiceSample = voiceSampleOf(told.map((m) => ({ text: pageText(m), big: bigHand(m) })), { skipNewest: SMALL_PAGES });
        } catch (err) { voiceSample = null; }
      }
      /* M510-48: the essentials and the plans ride for every storyteller (the hybrid, always on) */
      smallEssentials = await loadEssentials(story.id);
      /* M527: essentials made over more pages than the record now covers (pages taken back) may tell what those pages did —
       * not sent; the record's own lines stand in, and the essentials keeper makes them again after this page */
      if (smallEssentials && Number.isFinite(smallEssentials.upTo)) {
        const nodesNow = ((await loadMemory(story.id)) || {}).nodes || [];
        const coveredNow = nodesNow.filter((n) => n && !n.empty && Array.isArray(n.span)).reduce((mx, n) => Math.max(mx, n.span[1] + 1), 0);
        if (smallEssentials.upTo >= coveredNow) smallEssentials = null;
      }
      smallPlansBook = await loadPlansBook(story.id);
      /* M527: a plan born on a page since taken back is not standing — it is not sent (the plans keeper mends its book) */
      if (smallPlansBook && Array.isArray(smallPlansBook.plans)) {
        const standingNow = visiblePages(history).length;
        smallPlansBook = { ...smallPlansBook, plans: smallPlansBook.plans.filter((p) => !(Number.isFinite(p.from) && p.from >= standingNow)).map((p) => (Number.isFinite(p.closedAt) && p.closedAt >= standingNow ? { ...p, status: 'standing', outcome: undefined, closedAt: undefined } : p)) };
      }
      /* M510-50: SMART RECALL — with the essentials made and the switch on, a worker names the older record lines his move
       * means (they ride word for word); never more than 8 seconds; slower or unsure, none. M547: asked beside the referee
       * (smartRecallFor, above) for every storyteller; its answer is taken here. */
      const recallPicked = (await recallPending) || [];
      /* M576: ONE SET OF ARGUMENTS for the two builds — the probe (to size the record) and the request itself had the same
       * thirty arguments written out twice, differing only in the record; one added to the one and not the other would have
       * sized the record against a request that is not the one sent */
      const requestArgs = {
        story, messages: history, settings: settingsValues, state, modules: selected,
        cast: invitedCast, lore: loreText, loreFired, window: windowInfo, directive,
        directorNote: renderDirectorNote(directorState), editorEye: renderEditorNote(editorState),
        houseEye: (() => { const lastA = [...history].reverse().find((m) => m && m.role === 'assistant' && !m.hidden); return lastA ? houseEyeWords(lastA.findings) : ''; })(),
        worldBrief: renderWorldBrief(state.worldBrief, state.turn, state.page, state),
        ruling: rulingFor(state, lastUser && lastUser.id, ooc), /* M345: the room is measured with the outcome that will ride */
        canonNote, /* M346 */
        canonOn: Boolean(canonPending), canonWhy: canonPending && !canonNote ? canonWhy({ since: canonAskedAt }) : '', /* M486; M534: this turn's reason, or none */
        choicesOn: choicesNow, choiceTaken: choiceNow, choiceEchoes: choicesNow ? echoesText(choiceNow ? history.filter((m) => !(m && lastUser && m.id === lastUser.id)) : history) : '', /* M548 */
        smallPlan, smallIntense, lastSound, smallEssentials, smallPlansBook, recallPicked, voiceSample, refereeWhy, canonStart: groundNow ? '' : canonStartNow, worldGround: groundNow, canonOnPages, tooLoud: loudNow, quietPage: quietNow, /* M510; M510-15; M510-22; M510-50; M512; M513; M516; M517; M518; M519 */
        sensorNote, sensorOwn, sensorRole, /* M356; M636 */
        pageFilter: (text, role) => sentPage(applyRules(text, currentRules(), { on: role, mode: 'wire' }), role),
      };
      const probeReceipt = buildRequest({ ...requestArgs, memory: '' }).receipt;
      /* M264: the record rides in the room the storyteller's context leaves it */
      const recordCap = recordRoom({
        contextTokens: roomOf(connection),
        maxTokens: connection && connection.maxTokens,
        fixedChars: fixedCharsOf(probeReceipt),
      });
      const memoryText = renderMemory(memoryForWindow(mem, verbatimStart), recordCap);
      /* M265: A FULL ROOM IS SAID OUT LOUD. When the storyteller's room cannot
       * hold the whole record (squeezing set to never, or a small context), the
       * oldest lines rest outside this page — and the writer is told, once a
       * session for each tale, instead of finding out by losing them. */
      {
        const full = /\((\d+) earlier lines? rest beyond the budget\.\)/.exec(memoryText);
        if (full && !warnedRecordFull.has(story.id)) {
          warnedRecordFull.add(story.id);
          toast('The storyteller’s context is full: the oldest ' + full[1] + ' record ' + (full[1] === '1' ? 'line was' : 'lines were') + ' left out of this page. Squeezing “Only when the whole record would no longer fit” (Settings) folds them in instead.');
        }
      }
      const { systemBlocks, messages, receipt: receiptDraft } = buildRequest({ ...requestArgs, memory: memoryText }); /* M576: the same arguments, with the record */

      /* M6 consume-and-clear: the ruling rode into this turn's stack as a
       * fact; it clears now, so no later turn inherits it. */
      if (state.pendingVerdict) {
        try {
          await saveState(story.id, { ...state, pendingVerdict: null });
          notify(story.id);
        } catch (err) { /* the turn is already assembled; never mind */ }
      }

      const turnVoice = voiceOf(await gatherSettings()); /* M327 */
      /* M8.5: the thinking voice for this turn. */
      const reasoning = effectiveReasoning(connection, story);
      /* M328: an out-of-character answer is not a page of the story — the story's prefill (a header's first words, a
       * thinking seed in the teller's voice) stays home for it */
      /* M358: the grounding phrase is SEEDED into the thinking itself where the model takes a seed (M328's thinking
       * prefill) — his own prefill, if he has set one, always wins; an out-of-character turn is not a page and takes
       * neither. */
      /* M358/M370/M371: THE GROUNDING PHRASE OPENS EVERY TURN'S THINKING — a page, a command (#time skip, #story, #p…),
       * and an out-of-character turn alike (#question, ((…)), //): it is his teller's voice, not the page's words, and the
       * out-of-character turns are exactly where a teller slides into an assistant's register. It is planted whatever the
       * model did last time, never remembered, never announced (M370). His OWN prefill wins on a page of the story; on an
       * out-of-character turn his prefill is a page's opening and stays off (as it always has), and the phrase rides. */
      /* M510: the frame switched off takes its phrase with it */
      /* M581: THE OPENER ([[pg]] in a structured prefill) — another model writes the page's first few words; the storyteller
       * must open with them (the schema holds it to them) and carry on. A model that would refuse at the first word is past
       * that word before it begins. If the opener fails, [[pg]] is simply empty and the page goes on. */
      /* M585: "GO ON" CARRIES THE PAGE FORWARD — it is not a new page's opening. The reply's prefill (as written or
       * structured) would make the continuation begin again with his opening words; on a go-on turn only his thinking seed
       * rides. (His report of a structured page stuck at 40%: "go on" is how the rest is asked for.) */
      const goingOn = Boolean(lastUser && lastUser.hidden && String(lastUser.text || '').trim().toLowerCase() === 'continue');
      if (goingOn && String(connection.prefill || '').trim()) {
        const seedOnly = splitPrefill(String(connection.prefill)).seed;
        connection = { ...connection, prefill: seedOnly ? '<think>' + seedOnly : '' };
      }
      if (!ooc && !goingOn && structuredPlanFor(connection) && /\[\[\s*pg\s*\]\]/i.test(String(connection.prefill || ''))) {
        let opening = '';
        try {
          const openerConn = await resolveWorkerConnection(story, 'opener');
          if (openerConn) {
            showComposerNote('The opener is writing the first words…');
            const w = earlyLeash(workerSignal(45000));
            try {
              const asked = await callWorker(openerConn, {
                system: systemBlocks.map((b) => (typeof b === 'string' ? b : b && b.text) || '').join('\n\n') + '\n\nWrite ONLY the first few words of the next reply — ten to fifteen words, in the story\u2019s own voice, no preamble, nothing after them.',
                messages: messages.filter((m) => m && m.role !== 'system'), maxTokens: 120, signal: w.signal,
              });
              opening = String((asked && asked.text) || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/\[\[|\]\]/g, '').trim().split(/\n/)[0].split(/\s+/).slice(0, 15).join(' ');
            } finally { w.done(); hideComposerNote(); }
          }
        } catch (err) { opening = ''; }
        if (letGoNow()) return landed; /* M675 */
        if (!opening) toast('The opener gave no first words — the page went on without them.');
        connection = { ...connection, prefill: String(connection.prefill).replace(/\[\[\s*pg\s*\]\]/gi, opening) };
      }
      const grounding = settingsValues.frameOn === false ? '' : groundingSeed(settingsValues);
      const ownPrefill = String(connection.prefill || '').trim();
      /* M375: and only where the provider truly continues a started thought — anywhere else the seed is an empty extra
       * turn the model reads, and reasons about in an assistant's voice */
      const seeded = grounding && (ooc || !ownPrefill) && seedContinues(connection) ? { prefill: grounding } : {};
      const provider = createProvider({ ...connection, reasoning, ...seeded, ...(ooc ? { prefill: seeded.prefill || '' } : {}) });
      const showThinking = (await db.settings.get('showThinking')) !== false;
      /* M319: THE THREE SWITCHES THAT STOP THE THINKING FOR EVERY MODEL AT ONCE SAY SO, WHEN THEY DO. The writer:
       * "all my models — DeepSeek, Kimi, everything — can't think", at low, medium, high, xhigh, max. The
       * send path was run in the real app: on this code DeepSeek and Kimi ARE asked to think, and the
       * thinking is kept and shown. Only three things in the house silence it whatever the connection
       * says — and none of them said a word where he was looking: (1) the tale's OWN level ("Just for
       * this story" in Settings → The thinking voice) overrides every connection's dial for that tale;
       * (2) "Show what the storyteller weighed" unticked hides thinking that was asked for and kept;
       * (3) a connection that once answered 400 to its thinking settings rides without them. Each now
       * says so on the turn it bites — once for each cause, never a nag. */
      /* M521: NO BANNER DURING PLAY — his word: "it's so stupid and breaks my immersion". The causes above were each said in a
       * banner over his page; now the two a receipt did not yet say are said on it (M521-2), in What the storyteller saw. */
      let thinkWhy = '';
      try {
        const connLevel = connection && connection.reasoning && typeof connection.reasoning.effort === 'string' ? connection.reasoning.effort : '';
        const taleLevel = story && typeof story.reasoningEffort === 'string' && EFFORT_RANK.includes(story.reasoningEffort) ? story.reasoningEffort : '';
        if (taleLevel === 'off' && connLevel && connLevel !== 'off') thinkWhy = 'no thinking asked for — this story\u2019s own thinking level is Off';
        else if (reasoning.effort !== 'off' && reasoningIsDown(connection, reasonStyle(connection))) thinkWhy = 'thinking settings not sent — this connection refused them once';
      } catch (err) { thinkWhy = ''; }

      /* M378: A NEW TRY CLEARS THE THINKING A STOP LEFT BEHIND — AT ONCE. After a Stop mid-thinking the cut thinking is
       * kept on the page, whole and copyable (M301); it was let go only when the NEXT PAGE landed, so "Try again" showed
       * the old stopped thinking and the new one streaming together until the new page was done. The moment any new try
       * begins, the old one is gone. */
      if (letGoNow()) return landed; /* M675: stopped before the request began — nothing was asked, nothing is drawn */
      await clearCutThinking(story.id);
      const pending = document.createElement('article');
      pending.className = 'msg msg-assistant pending';
      const pendingLabel = document.createElement('div');
      pendingLabel.className = 'msg-label lbl';
      pendingLabel.textContent = 'the storyteller';
      pending.appendChild(pendingLabel);
      let thinkDetails = null;
      let thinkPaintQueued = false; /* M269 */
      let thinkLines = null; /* M279: the live thinking, drawn line by line */
      let thinkBody = null;
      const body = document.createElement('div');
      body.className = 'msg-body';
      pending.appendChild(body);
      /* M364: A NEW VERSION OF A PAGE IS WRITTEN WHERE THAT PAGE STANDS. The writer: "when I swipe for an alternative
       * answer it starts at the bottom, unlike SillyTavern". The page being written was always appended to the END of
       * the thread and the view followed it down — so a swipe grew a second copy under the first and dragged him to the
       * bottom of a long page. Now the version being written takes the page's own place (the old one hidden while it is
       * written, and back the moment the writing stops without landing), the view goes to its FIRST line and stays
       * there, and nothing drags him down. A new page, not a swipe, is written at the end exactly as before. */
      const inPlace = swipeTarget ? [...els.thread.querySelectorAll('.msg[data-id]')].find((n) => n.dataset.id === String(swipeTarget.id)) || null : null;
      holdPlace = Boolean(inPlace);
      if (inPlace) {
        inPlace.hidden = true;
        inPlace.after(pending);
        const drop = pending.remove.bind(pending);
        pending.remove = () => { inPlace.hidden = false; holdPlace = false; drop(); };
        following = false;
        requestAnimationFrame(() => { try { pending.scrollIntoView({ block: 'start' }); } catch (err) { /* a view that cannot move stays put */ } });
      } else {
        els.thread.appendChild(pending);
        if (!inPlace && nearBottom()) scrollToBottom();
      }

      /* (M675: the telling's controller stands since its first moment — see the top) */
      pauseContinuousAudit(story.id); /* M673: a reading of older pages steps aside for the telling */
      els.btnStop.hidden = false;
      els.btnSend.hidden = true;
      /* M669 — HIS: "when the provider has errors there's a red banner; when I swipe right it's not gone, it's still at the
       * bottom and I need to reload the page". The note a failed telling leaves ("…  Ask again") took itself away only when
       * ITS OWN button was pressed. Asked again any other way — a swipe, "Try again", a new page of his own — the telling
       * went ahead and the old error stood under it until the thread was drawn again. Whatever it said is answered the
       * moment a new telling begins: every such note leaves then. */
      for (const stale of els.thread.querySelectorAll('.msg-retry')) stale.remove();
      /* M15: the ember breathes while the storyteller writes. */
      if (els.emberBar) els.emberBar.classList.add('live');

      let full = '';
      /* M322: the two things a streamed piece can be — declared here so the header gate (below) and the stream's
       * own handler reach the same ones; given their bodies once the live block's variables exist */
      let takeThinking = () => {};
      let takeProse = () => {};
      /* M322: what the provider sent as thinking, and what the reply itself said before its header */
      let provThinking = '';
      let leadThinking = '';
      let providerEmptyWhy = ''; /* M596: the provider's own reading of an empty page, when it has one */
      let wholeReply = '';
      const cutLead = !ooc && (await db.settings.get('cutBeforeHeader')) !== false;
      cutOldPages = (await db.settings.get('cutBeforeHeader')) !== false;
      const gate = cutLead ? makeHeaderGate({
        onThinking: (t) => { leadThinking += t; takeThinking(t); },
        onProse: (t) => takeProse(t),
        /* M326: the model has begun the page AGAIN (the same header) — what stood as the page was a draft: it goes to the
         * thinking, and the page starts clean from the new header */
        onRestart: () => {
          if (!full) return;
          const draft = full;
          full = '';
          leadThinking += (leadThinking && !/\n$/.test(leadThinking) ? '\n' : '') + draft;
          takeThinking((thinking && !/\n$/.test(thinking) ? '\n' : '') + draft);
          paintLive();
        },
        onGiveBack: (t) => {
          /* no header came: those words are the page after all — take them back out of the thinking */
          leadThinking = leadThinking.slice(0, Math.max(0, leadThinking.length - t.length));
          thinking = thinking.slice(0, Math.max(0, thinking.length - t.length));
          if (thinkBody) { thinkBody.textContent = ''; thinkLines = null; }
          if (!thinking.trim() && thinkDetails) { thinkDetails.remove(); thinkDetails = null; thinkBody = null; thinkLines = null; stopThinkClock(); thinkStart = 0; }
        },
      }) : null;
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
      /* M39: the live paint — dressed, at most once per frame.
       * M164: AND NEVER MORE OFTEN THAN IT CAN AFFORD. Every frame re-dressed
       * the WHOLE page — every display rule over the whole text, the scene
       * re-parsed, the whole subtree rebuilt — so the cost of one paint grew
       * with the page while the paints kept coming sixty times a second.
       * Measured at 6x CPU throttle: 1.6ms at a thousand characters, 16.4ms
       * at twelve thousand — one whole frame — and the writer's storyteller
       * is set to thirty thousand tokens, some hundred and twenty thousand
       * characters. The tail of a long page was painting at a few frames a
       * second and the whole main thread was going into re-drawing words
       * that had not changed. The paint now keeps a floor of four times what
       * the last one cost, so it can never take more than a fifth of the
       * thread: a short page still paints every frame, a long one a few
       * times a second, which is far faster than anyone reads. The finished
       * page is drawn whole from the store when the stream lands. */
      let paintRaf = 0;
      let paintTimer = 0;
      let paintCostMs = 0;
      let paintedAt = 0;
      const paintNow = () => {
        paintRaf = requestAnimationFrame(() => {
          paintRaf = 0;
          const t0 = performance.now();
          try { dressInto(body, full, 'assistant'); } catch (err) { body.textContent = full; }
          paintCostMs = performance.now() - t0;
          paintedAt = performance.now();
        });
      };
      const paintLive = () => {
        if (paintRaf || paintTimer) return;
        const owed = (paintedAt + paintCostMs * 4) - performance.now();
        if (owed > 0) { paintTimer = setTimeout(() => { paintTimer = 0; paintNow(); }, owed); return; }
        paintNow();
      };
      const stopPainting = () => {
        if (paintTimer) { clearTimeout(paintTimer); paintTimer = 0; }
        if (paintRaf) { cancelAnimationFrame(paintRaf); paintRaf = 0; }
      };
      let stoppedByHand = false;
      let failedWords = ''; /* M301: the wire's own word for why no page came */
      let finishReason = null;
      let streamSources = null; // M22-C: the search's findings
      try {
        /* M377: NO SECOND TRY IS EVER SENT BY THE HOUSE. The writer: "I hate this — delete this feature. Just let me do
         * the retry button manually, because the automatic thinking breaks my persona." Every automatic ask-again
         * (M117's leak, M120's page-inside-the-thinking, M323-M339's plan with no page) handed his teller a line from the
         * house about its own last answer, and his teller answered THAT, in an assistant's voice. The messages go as they
         * are; a reply that brings no page lands as it came, and "Try again" is his. */
        const wireMessages = messages;
      takeThinking = function (text) {
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
                  thinkDetails = thinkingNode(() => thinking, 1); /* M301: its copy button takes what has streamed so far */
                  thinkBody = thinkDetails.querySelector('.thinking-body');
                  pending.insertBefore(thinkDetails, body);
                  if (!sawProse) thinkDetails.open = true;
                }
                /* M269: the thinking is drawn once a frame (it was rewritten whole on
                 * every piece); M279: line by line, the whole of it, from its first word */
                if (!thinkPaintQueued) {
                  thinkPaintQueued = true;
                  (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 16))(() => {
                    thinkPaintQueued = false;
                    if (!thinkBody) return;
                    if (!thinkLines) thinkLines = streamText(thinkBody);
                    thinkLines.append(thinking.slice(thinkLines.length));
                  });
                }
              }
        };
      takeProse = function (text) {
              if (!sawProse) {
                sawProse = true;
                stopThinkClock();
                if (thinkDetails) thinkDetails.open = false;
              }
              full += text;
              paintLive();
        };
        const result = await provider.streamChat({
          systemBlocks,
          messages: wireMessages,
          signal: mine.signal,
          onToken({ channel, text }) {
            /* M22-C: the note channel — a provider's live word ("Searching
             * the web…"), toasted, never part of the prose. */
            if (channel === 'note') {
              toast(text);
              return;
            }
            if (channel === 'thinking') {
              provThinking += text;
              takeThinking(text);
            } else if (channel === 'prose') {
              /* M322: everything before the header is thinking, not page (ui/headergate.js) */
              if (gate) gate.feed(text); else takeProse(text);
            }
            followTail();
          },
        });
        providerEmptyWhy = (result && typeof result.emptyWhy === 'string') ? result.emptyWhy : '';
        if (gate) gate.end(); /* a reply with no header at all is handed back whole, as the page */
        full = result.text;
        wholeReply = String(result.text || ''); /* M325: the reply as it came — what the repair below judges and hands back */
        /* M323: THE FINISHED TEXT IS SPLIT ONCE, HERE. `result.text` is the WHOLE reply — the words before the header
         * included — so it put back what the gate had just moved out of the page, and M322's "last look"
         * further down then found that lead a second time and APPENDED it: every page that thought aloud
         * carried its thinking twice (measured: a 2,842-character lead saved as 5,683). The gate is for
         * the eye while the words arrive; what is kept is decided here, from the finished text. */
        if (cutLead) { const cut = splitAtHeader(full); leadThinking = cut.lead; full = cut.page; }
        /* M279: the last of the thinking, drawn where the reader is (the whole of it is already there) */
        if (thinkBody) { if (!thinkLines) thinkLines = streamText(thinkBody); thinkLines.append(thinking.slice(thinkLines.length)); }
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
        /* M117: a provider that leaks the model's control tokens into the
         * content ends the page at the first one; the leak is named on the
         * page's receipt, and a page left with nothing is answered again
         * once, by the house, not the writer's hand. */
        const leak = stripControlLeak(full, { writerText: userText }); /* M469: a turn that ran past its end is cut where the next turn began */
        if (leak.leaked) {
          full = leak.text;
          leakedControl = true;
          ranPast = leak.ranPast === true;
        }
        /* M510: A PAGE THAT BEGAN PLAYING HIM ENDS WHERE IT BEGAN — the small-model mode only. The page stops at the
         * sentence that first gave him words, thoughts or a move he did not make (his own message never counted), before
         * it is kept: neither the page nor the ledger holds what he never did. A window beyond the page after the cut is
         * kept. Too little left to stand as a page (under 400 characters of scene): the page stands and the next turn
         * hears it instead (below). */
        if (settingsValues.smallModelNow === true && full.trim()) {
          try {
            const alsoKnown = Object.keys((state && state.characters) || {}).filter((n) => { try { return isMcAlias(state, n); } catch (err) { return false; } });
            const notHim = Object.keys((state && state.characters) || {}).filter((n) => !alsoKnown.includes(n)); /* M609 */
            const at = mineCutAt(full, { mc: mcName(state), also: alsoKnown, others: notHim, writerText: userText });
            const windowAt = windowCutAt(full);
            const scene = at > -1 ? full.slice(0, windowAt > -1 && windowAt < at ? windowAt : at).replace(/^\s*\[[^\]\n]*\]\s*/, '') : '';
            if (at > -1 && (windowAt === -1 || at < windowAt) && scene.trim().length >= 400) {
              full = full.slice(0, at).trimEnd() + (windowAt > at ? '\n\n' + full.slice(windowAt).trim() : '');
              cutMine = true;
            }
          } catch (err) { /* a reading of the page is never worth the page */ }
        }
        const episodeMark = stripEpisodeEnd(full);
        if (episodeMark.ended) {
          episodeEnded = true;
          full = episodeMark.text;
        }
        /* M30: the regex shelf's page-mode rules run on the finished page
         * BEFORE it is saved — what they remove is gone from the story, the
         * history, and every worker's reading. */
        full = applyRules(full, currentRules(), { on: 'storyteller', mode: 'page' });
        /* M322: the provider's own thinking, then whatever the reply said before its header. And a last look at
         * the finished text — a header the stream's gate could not see (a rule on the regex shelf moved it,
         * a page recovered whole from elsewhere) is still where the page begins. */
        /* (a rule on the regex shelf may have moved the header: whatever now stands before it is thinking too) */
        if (cutLead) { const cut = splitAtHeader(full); if (cut.lead) { leadThinking += (leadThinking ? '\n\n' : '') + cut.lead; full = cut.page; } }
        provThinking = result.thinking || provThinking; /* M323: the provider's own thinking, whole — what M120 below asks about */
        thinking = (result.thinking || provThinking) + (leadThinking ? ((result.thinking || provThinking) ? '\n\n' : '') + leadThinking : '');
        /* M351 said, in a banner over his page, when thinking was asked for and none came back (and M319 when it came back
         * hidden by his own tick). M521: his word — "it's so stupid and breaks my immersion": no banner during play; the
         * receipt keeps it (noThought, M348), in What the storyteller saw. */
        stopThinkClock();
        finishReason = result.finishReason || null;
        /* M347: what the storyteller was sent for this page, word for word — each part, and the request as the model took
         * it — kept beside the page (never in it: a request can be the size of the whole story). In the background:
         * keeping it never holds the page. */
        const sentId = newSentId();
        keepSent({
          id: sentId, storyId: story.id,
          slots: (receiptDraft && Array.isArray(receiptDraft.slots) ? receiptDraft.slots : []).map((s) => ({ name: s.name, text: s.text || '' })),
          requests: result.sent ? [result.sent] : [],
        }).catch(() => false);
        receipt = finalizeReceipt(receiptDraft, {
          sentId,
          noThought: reasoning.effort !== 'off' && !String(thinking || '').trim(), /* M348 */
          ttftMs: result.ttftMs,
          tfftMs: result.tfftMs,
          durationMs: result.durationMs,
          model: connection.model || '',
          connId: connection.id || '', /* M632 */
          label: connection.label || '',
          effort: reasoning.effort === 'off' ? '' : reasoning.effort,
          prefill: result.prefill && result.prefill.words ? result.prefill.words : '',
          small: smallTeller, /* M512 */
          thinkWhy, /* M521-2 */
        });
        /* M329: a seed that steered nothing is said once for that connection — the receipt says it every turn */
        /* M370: a banner only about a seed HE set (his own prefill). The grounding phrase is never announced — it is his
         * persona's words, and a note about its plumbing is exactly the machinery he keeps out of sight. */
        /* M521: and a seed that steered nothing is on the receipt too (its prefill line) — never a banner */
      } catch (err) {
        stopPainting(); /* M164: no frame lands into a page that is gone */
        /* M160: the thinking clock used to be stopped only when the writer
         * stopped the page by hand. A provider that fell over — a dropped
         * mobile connection, a 500, a refused key — left its one-second
         * interval ticking against a node that had already gone, for the
         * rest of the session. An hour of flaky signal left a dozen of them
         * running. Every path out stops the clock. */
        stopThinkClock();
        if (err && err.name === 'AbortError') {
          stoppedByHand = true;
          /* M496: THE LINE IN HAND IS KEPT. The header gate holds the unfinished line (it may yet be the header) and let it
           * go only on a normal finish — gate.end() after the stream returns. A Stop threw past it, so whatever was mid-line
           * when he pressed Stop was dropped from the kept page, and a model that writes a paragraph as one line lost the
           * whole paragraph. The gate hands back what it holds before the page is kept. */
          try { if (typeof gate !== 'undefined' && gate) gate.endIfOpen(); } catch (e) { /* the page as it stands */ } /* M497: never a plan written before the header */
        } else {
          /* M301: ONE word from the house, with its way to ask again. The wire's
           * own words used to stand as one note and "the storyteller went quiet"
           * as a second under it — two notes for one failure, the button on the
           * one that said less. */
          failedWords = err.message || 'The storyteller went quiet. Try again in a moment.';
          /* M301: what it had thought before the wire dropped is kept */
          if (thinking.trim()) await keepCutThinking(story, null, { text: thinking, ms: thinkMs, why: 'dropped', showThinking });
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

      /* M323: THE REPLY RAN OUT OF ROOM WHILE IT WAS STILL PLANNING — "it just stops and doesn't give the header and
       * the rest" (the writer). With thinking Off the plan is written in the reply's own room; a long plan
       * uses it up, the provider cuts the reply (finish: length) before the header ever comes, and the
       * house showed the plan as a "page cut short". Detected, so repaired (his rule): when the words before
       * the header are being kept as thinking, the reply was cut for length, and no header came — in a tale
       * whose pages open with one — the plan is kept as this page's thinking and the page itself is asked
       * for ONCE, the plan handed back so it is not planned again. A second cut lands as it always did. */
      /* M324: …OR IT IS NOTHING BUT A PLAN. A reply made only of self-labelled planning ("Planning: … Beat: …") and
       * then nothing holds no page whatever its finish reason: the same one re-ask, the plan handed back. */
      /* M325: THE WRITER, of his own screenshot: "it doesn't have a header — the text just ends with '.', planning."
       * M324 told a plan from a page by its LABELS alone, so a plan whose last paragraph carried no label
       * ("I should keep it light and end on her question.") would have had that paragraph taken for the
       * page. In a tale whose pages open with a header there is a surer sign: a reply that opens with a
       * self-labelled plan and holds NO header has no page in it, however its paragraphs are labelled.
       * The whole reply is the plan; the page is asked for, once. */
      /* M377: a reply that is all thinking-it-over, or a plan with no page, is no longer handed back and asked for again —
       * it lands as it came, and he asks again himself if he wants another. */

      /* M354/M355, as M357 changed them: WHAT THE HOUSE SAW IN THIS PAGE IS SAID BEFORE THE NEXT ONE, NOT BY SENDING
       * THIS ONE BACK. A page that has landed is the story; handing it to the model again and waiting is a stutter the
       * writer feels. So the page stands, and the house keeps ONE line — his character taken, or the same words again —
       * for the end of the next turn, in his voice. Only with the derestricted switch on; his frontier model never
       * has either check run. */
      if (settingsValues.smallModelNow === true && !stoppedByHand && full.trim()) {
        try {
          const alsoKnown = Object.keys((state && state.characters) || {}).filter((n) => { try { return isMcAlias(state, n); } catch (err) { return false; } });
          const notHim = Object.keys((state && state.characters) || {}).filter((n) => !alsoKnown.includes(n)); /* M609 */
          const took = mineLeak(full, { mc: mcName(state), also: alsoKnown, others: notHim, writerText: userText });
          /* M510: the "same words again" note is retired — it quoted the repeated phrase back to the model; the
           * connection's own repetition penalties (the dials M510 opened) do that job while the page is written */
          const word = took && !cutMine ? mineWord(took, mcName(state)) : '';
          if (word) await keepPageWord(story.id, word);
          /* M510: what the page sounded like, for the helper's next plan (a heated page that went quiet is heard) */
          const heard = soundCount(full);
          await keepSound(story.id, { intense: smallIntense === true || Boolean(smallPlan && smallPlan.intense), effects: heard.effects, voiced: heard.voiced });
          /* M519: how thick the page was with sounds and dashes — the brake the next page is built with */
          const tex = pageTexture(full);
          await keepTexture(story.id, { soundPer100: tex.soundPer100, dashPer100: tex.dashPer100 }, tooLoudNow);
        } catch (err) { /* a reading of the page is never worth the page */ }
      }

      if (cutMine) toast('The storyteller began playing your character — the page ends where it started.');
      if (leakedControl) toast(ranPast ? 'The storyteller ran past the end of its turn and began writing yours — the words before that were kept.' : 'The words before the provider’s leak were kept.');

      /* M120, as M377 changed it: the page came back INSIDE the thinking and the answer is (nearly) empty. Nothing is asked
       * again; where the thinking plainly holds the page — from its last header line on — the page is taken from it,
       * silently. Otherwise the reply lands as it came, and "Try again" is his. */
      const bodyLen = full.replace(/^\[[^\]\n]*\]\s*/, '').trim().length;
      /* M323: …the PROVIDER's thinking. Since M322 `thinking` also holds what the reply said before its header — so a
       * short page after a long plan (a nod, one line of dialogue) was taken for "the page is inside the
       * thinking". A plan on the page is not a page hidden in the thinking. */
      const modelThought = String(provThinking || '');
      if (!stoppedByHand && !cutShort && bodyLen < 160 && modelThought.trim().length > 400) {
        const lines = modelThought.split('\n');
        let at = -1;
        for (let i = lines.length - 1; i >= 0; i -= 1) if (/^\s*\[[^\]\n]{6,}\]\s*$/.test(lines[i])) { at = i; break; }
        const salvaged = at !== -1 ? lines.slice(at).join('\n').trim() : '';
        if (salvaged.replace(/^\[[^\]\n]*\]\s*/, '').trim().length >= 160) {
          full = salvaged;
          thinking = '';
        }
      }

      /* M340: THE PAGE IS MADE WHOLE BEFORE IT IS KEPT — what he reads, and what the next turn copies. Brackets round a header
       * that lost them; the ledger's ground in front of a header that lost its place; blank lines between paragraphs that
       * came with single newlines. Never a word. (Out-of-character answers are not pages.) */
      let tidyMend = null; /* M510-34 */
      if (full.trim() && !ooc) {
        try {
          const ground = state && state.place && typeof state.place.name === 'string' ? state.place.name : '';
          const untidied = full;
          /* M626: his attire and position, as the ledger holds them before this page — for a header that left them out */
          const mcEntry = (Array.isArray(state && state.present) ? state.present : []).find((p) => p && p.name && isMcAlias(state, p.name)) || {};
          const tidied = tidyPage(full, { place: ground, mc: mcName(state), attire: typeof mcEntry.attire === 'string' ? mcEntry.attire : '', position: typeof mcEntry.position === 'string' ? mcEntry.position : '' });
          full = tidied.text;
          /* M510-34: what the finisher took off (an empty window, his storyteller's note to him at the end) is kept with the
           * page as its earlier words — the drawer lists it, and a tap puts it back */
          if (Array.isArray(tidied.removed) && tidied.removed.length) tidyMend = { before: untidied, why: tidyWhy(tidied.removed), at: Date.now() };
          /* M510-17: A NEW STORY PAGE WITH NO HEADER STILL GETS ITS PARAGRAPHS — tidyPage leaves header-less text as it is
           * (it mends stored pages and out-of-character answers too), and a first page without a header kept its single
           * line breaks, or one unbroken block */
          if (!readHeader(full)) { const pp = partParagraphs(full); if (pp.changed) { full = pp.text; tidied.did.push('paragraphs'); } }
          /* the receipt, kept with the page, says what was mended (shown under "What the storyteller saw") */
          if (tidied.did.length && receipt && typeof receipt === 'object') receipt = { ...receipt, shape: tidied.did };
        } catch (err) { /* the page as it came */ }
      }
      releaseCheckpoint(); if (checkpointing) await checkpointing; /* M570: kept now — the page has streamed — and before it lands */
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
            : [{ text: pageText(target), ts: target.ts, thinking: target.thinking, thinkingMs: target.thinkingMs /* M674: how long the first telling weighed stays with it */, receipt: target.receipt }];
          /* M674: the version being left takes what was said of ITS words with it; the new one begins with its own (what
           * this telling's finisher took off, where it looked things up, a stop, a cut) and nothing of the other's */
          { const leftAt = Array.isArray(target.swipes) && target.swipes.length ? shownIndex(target) : 0;
            if (swipes[leftAt]) swipes[leftAt] = versionWithNotes(swipes[leftAt], target); }
          const newVersion = versionWithNotes(
            { text: full, ts: Date.now(), thinking: thinking || undefined, thinkingMs: thinkStart ? Math.max(1, thinkMs) : undefined, receipt },
            { stopped: stoppedByHand, cutShort, mended: tidyMend || undefined /* M510-34 */, sources: streamSources || undefined },
          );
          swipes.push(newVersion);
          const swipeIdx = swipes.length - 1;
          await db.messages.update(story.id, target.id, {
            swipes,
            swipeIdx,
            text: full,
            /* M674: THIS telling's thinking, or none. It fell back to the page's (`thinking || target.thinking`, since M9):
             * a new version that did not think wore the other version's thinking — until a swipe away and back, when
             * it showed none. What it weighed belongs to the version that weighed it; that one keeps it (above). */
            thinking: thinking || undefined,
            thinkingMs: thinkStart ? Math.max(1, thinkMs) : undefined,
            receipt,
            ...notesOfVersion(newVersion),
          });
          pending.remove();
          await clearCutThinking(story.id); /* M301: a page landed — it carries its own thinking */
          await rerenderMessage(story.id, target.id);
          /* The walker's ids still hold: the page was re-inked in place,
           * no page came or went. Emptying ids here used to make the next
           * render re-append the whole thread — every page twice, and the
           * reader thrown back up the scroll. */
          if (!inPlace && nearBottom()) scrollToBottom();
          await refreshPreview(story.id); // M21: the shelf hears the new version
          stories = await db.stories.list();
          renderStoryList();
          refreshEmber();
          /* M72: a new version of an OLDER page is read by the replay (the
           * caller folds first) — read here, on top of the latest ledger, its
           * people sat down at page N. */
          /* M674: A TELLING IS READ THE SAME WHETHER IT LANDS AS A PAGE OR AS A VERSION. This was held back whenever the
           * story's page reader was switched off (extraction) — a gate from when the chain WAS the page reader. The chain
           * has long been more (the house's eye, the keeper, the second reader, and the sensors at its foot), each with
           * its own switch, and a new PAGE has always been handed to all of them (below). So a new version in such a
           * story was never looked at by any of them — found when "Try again" became a version: the sensors never read
           * the page told again (DOM-75). Every helper still keeps its own switch. */
          if (!ooc && !replayAfter) {
            const updated = (await db.messages.list(story.id)).find((m) => m.id === target.id);
            if (updated) startBackgroundWork(story, updated, userText);
          }
          /* M10: the showrunners read a swiped close all the same. */
          if (!ooc) startShowrunnerWork(story, { episodeEnded });
          return landed; /* M68: the swipe path returned undefined — read as "nothing landed", the caller put the OLD ledger back over the new version */
        }

        /* M675: a page told AS THE STORY right after an out-of-character message of his ("go on", once that question's
         * answer failed or was let go) says so — by its place alone it would be taken for the answer (commands.js asideAt) */
        const shownBefore = ooc ? [] : visiblePages(await db.messages.list(story.id));
        const afterAnAside = !ooc && asideAt([...shownBefore, { role: 'assistant', text: full }], shownBefore.length);
        const saved = await db.messages.append(story.id, {
          role: 'assistant',
          text: full,
          thinking: thinking || undefined,
          thinkingMs: thinkStart ? Math.max(1, thinkMs) : undefined,
          receipt,
          stopped: stoppedByHand || undefined,
          cutShort: cutShort || undefined,
          ooc: ooc ? true : (afterAnAside ? false : undefined),
          /* M22-C: where it looked things up, folded under the page. */
          sources: streamSources || undefined,
          ...(tidyMend ? { mended: tidyMend } : {}), /* M510-34 */
        });
        if (ooc) {
          /* M674: an answer out of character is never read into the ledger, so it is not a page the ledger is behind on:
           * the mark passes it now. (It stayed before it — the light said "the last pages are not read into the ledger
           * yet", and what then came to read them read this answer as story: readMissedPage.) */
          try {
            const k = visiblePages(await db.messages.list(story.id)).filter((m) => m.role === 'assistant').findIndex((m) => m.id === saved.id);
            if (k !== -1) { const passed = await loadState(story.id); markPageRead(passed, k); await saveState(story.id, passed); notify(story.id); }
          } catch (err) { /* the idle look passes it (readMissedPage) */ }
        }
        const landedNode = msgNode(saved, showThinking, { isLastAssistant: true, mastheadOn: (await db.settings.get('masthead')) !== false });
        numberPage(landedNode, saved, await db.messages.list(story.id)); /* M483: the page that just landed is numbered — it was the one page the mark never saw ("18 of 19" at the end) */
        pending.replaceWith(landedNode);
        settleLastPageControls(); /* M675: the page that had been last hands its "go on" and its lone swipe bar on */
        await clearCutThinking(story.id); /* M301: a page landed — it carries its own thinking */
        /* The pending node was never in the walker's ids; the saved page
         * takes its place at the tail. Record the id — do NOT clear the
         * list: an empty walker passes the append check and the next
         * renderThread re-appends every page, doubling the thread and
         * flinging the reader back to the top. */
        lastRender.ids.push(saved.id);
        /* M34: the scroll law (M27) holds at the landing too — the thread
         * moves only if the reader was already at its tail. */
        if (!inPlace && nearBottom()) scrollToBottom();
        await refreshPreview(story.id); // M21: the shelf hears the new page
        /* M548: "Rukia will remember that." — once, when the page his choice led to lands */
        if (choiceNow && !swipeTarget) {
          const who = [...new Set((choiceNow.echoes || []).map((e) => e && e.who).filter(Boolean))];
          if (who.length) toast((who.length === 1 ? who[0] : who.slice(0, -1).join(', ') + ' and ' + who[who.length - 1]) + ' will remember that.');
        }
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
        /* B9: nothing came back — named kindly, with a way to ask again.
         * M301: what it thought before writing nothing is kept all the same
         * (an error's thinking was kept, and emptied, where the error was caught) */
        if (thinking.trim()) await keepCutThinking(story, pending, { text: thinking, ms: thinkMs, why: 'quiet', showThinking });
        pending.remove();
        /* M302: "ASK AGAIN" ASKS FOR THE SAME THING. It always ran a plain new
         * turn — so after a failed NEW VERSION of a standing page (the swipe ▸)
         * it wrote a second storyteller page under the first, the storyteller
         * answering itself (reproduced: user / assistant became user /
         * assistant / assistant). A failed version is asked for again as a
         * version, through the same door the ▸ uses. */
        els.thread.appendChild(retryNoteNode(
          failedWords || providerEmptyWhy || emptyPageWhy(finishReason, thinking, leadThinking), /* M545: the provider's own reason, never a guess; M591: and the house's own part said; M596: the house's own reading when it has one */
          async () => {
            if (!swipeTarget) { retryAsk(); return; }
            const standing = (await db.messages.list(story.id)).find((m) => m.id === swipeTarget.id);
            if (standing) swipeRegenerate(standing); else retryAsk();
          }
        ));
        scrollToBottom();
      } else if (thinking.trim()) {
        /* M301: stopped while it was still thinking — the thinking stays on the
         * page, whole and copyable, until the next page lands */
        await keepCutThinking(story, pending, { text: thinking, ms: thinkMs, why: 'stopped', showThinking });
      } else {
        pending.remove();
      }
    } finally {
      releaseCheckpoint(); /* M570: a page that failed or was stopped still keeps its turn's checkpoint — kept before the house is free again, so a Try again finds it */
      if (checkpointPending) { try { await checkpointPending; } catch (err) { /* kept or not, the house goes on */ } }
      abort = null;
      tellingFor = null;
      busy = false;
      els.btnStop.hidden = true;
      els.btnSend.hidden = false;
      if (els.emberBar) els.emberBar.classList.remove('live');
      focusComposerIfDesktop();
      drawChoices(); /* M548 */
    }
    return landed;
  }

  /* M302: A TURN ASKED AGAIN IS ASKED AS IT WAS ASKED. The first ask reads the
   * writer's words for a house command — "(ooc: …)" above all: an
   * out-of-character turn runs no referee, its answer is saved as out of
   * character, and no reader takes it for story. Every way of asking again
   * (the page's own "try again", the composer's, a new version by ▸, the
   * note's "Ask again") called generate() bare, so the second answer to an
   * out-of-character question landed as a page of the STORY and the ledger's
   * reader was sent to learn from it. The turn's own words are read again,
   * here, for every one of those doors. `at` is where the answer stands (or
   * would stand) in `history`; a hidden page ("Go on", the house's nudges)
   * carries no command of its own. */
  function turnArgsBefore(history, at) {
    for (let i = Math.min(at, history.length) - 1; i >= 0; i -= 1) {
      const m = history[i];
      if (!m || m.role !== 'user') continue;
      if (m.hidden) return {};
      const again = parseCommand(typedWords(String(m.text || ''))); /* M675: his own words — a file attached after them is not part of the command */
      return { directive: again.directive || '', ooc: again.ooc === true || m.ooc === true };
    }
    return {};
  }

  /* B9's retry: re-ask the same turn (the user's words are still last). */
  async function retryAsk() {
    if (busy) return;
    busy = true;
    let args = {};
    try {
      const story = await activeStory();
      const history = story ? await db.messages.list(story.id) : [];
      args = turnArgsBefore(history, history.length);
    } catch (err) { /* asked plainly — and the house is never left claimed by a read that failed */ }
    await generate(args);
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
  async function send(text, extra = {}) {
    const chosen = Boolean(extra && extra.choiceTaken); /* M548: a choice tapped — never his draft's place */
    /* M493: "#time" alone is no longer a turn — the header and The clock already say the hour, and it spent a page. Typed
     * out of habit it is answered here, from the ledger's clock, and nothing is sent. ("#time skip …" is a turn.) */
    if (/^\s*#time\s*$/i.test(String(text || ''))) {
      const sid = ctx.getActiveStoryId();
      const st = sid ? await loadState(sid).catch(() => null) : null;
      const hour = st ? renderClock(st.clock || st) : '';
      els.input.value = '';
      toast(hour ? 'In the story it is ' + hour + '.' : 'The story has no hour yet — the first page’s header sets it.');
      return;
    }
    /* M68: a send while the house is busy keeps the words and says so —
     * it used to drop them silently, a message that simply vanished. */
    /* M577 (the audit): a page sent while the ledger is being rebuilt (a page let go, an older page edited or walked to
     * another version) waits for the rebuild, as Try again, a version, an edit, a branch and a delete already did — sent
     * in the middle of it, the page was written over a ledger half-folded, and the rebuild's last write could land over the
     * referee's ruling for it */
    if (isReplaying() && !busy) {
      if (!chosen) els.input.value = '';
      const waited = await waitForRebuild();
      if (!waited) { if (!chosen) restoreComposer(text); return; }
    }
    if (busy) { if (!chosen) restoreComposer(text); /* M548: a tapped choice never lands in the composer */ toast('The storyteller is still busy — one moment.'); return; }
    busy = true;
    try {
      let story = await activeStory();
      /* M33: the storyteller is looked for BEFORE a tale is begun — the old
       * order begat an empty story named after the words ("Hello?") and
       * only then noticed there was no one to answer them. */
      const connection = await resolveConnection(story);
      if (!connection) {
        showComposerNote('The tavern needs a storyteller first — add a connection, and these words will still be waiting.');
        if (!chosen) restoreComposer(text); /* M548: a tapped choice never lands in the composer */
        return;
      }
      /* M391: A SHORTCUT OPENS NOTHING. "#story start the opening scene", typed in his Bleach story, opened a new tale
       * (M85's reading of #story) — the house acting on his words behind the storyteller's back. His words now go to the
       * tale he is in, exactly as typed, and the storyteller reads what #story means in the standing words. Only with no
       * tale open at all is one begun — as for any first words — named from them (a leading shortcut word left off the
       * shelf's name only; the page keeps it). */
      if (!story) {
        const oneLine = (String(text).trim() ? text : (pendingFile ? pendingFile.name : '')).replace(/\s+/g, ' ').trim().replace(/^#\S+\s+(?=\S)/, ''); /* M675: a file sent alone names the tale it begins */
        const title = oneLine.length > 40 ? oneLine.slice(0, 40).trimEnd() + '…' : oneLine;
        story = await db.stories.create({ title });
        if ((await db.settings.get('briefModeNew')) === 'automatic') { await db.stories.update(story.id, { briefMode: 'automatic' }); story.briefMode = 'automatic'; } /* M517: new stories start as he chose */
        ctx.setActiveStoryId(story.id);
        await refreshStories(true);
        toast(`“${story.title}” is begun.`);
        if (ctx.onStoriesChanged) ctx.onStoriesChanged();
      }
      hideComposerNote();
      hideHearth();
      if (!chosen) { els.input.value = ''; els.input.style.height = ''; }
      if (els.composerChip) els.composerChip.hidden = true;
      drawChoices(); /* M548: busy now — the choices stand down */

      const parsed = parseCommand(text);
      /* M30: page-mode rules over the writer's own words (never a house
       * command's hidden page). */
      const cleanWords = parsed.hidden ? parsed.clean : applyRules(parsed.clean, currentRules(), { on: 'writer', mode: 'page' });
      let saved;
      try {
        const imageToSend = pendingImage;
        /* M668: a text file he attached rides IN the page, under its name — so it is kept, sent, summed up and searched
         * like the words he typed (a picture is sent once, with its own page; a file's words stay in the story) */
        const fileToSend = pendingFile;
        const fileBlock = fileToSend ? attachedBlock(fileToSend.name, fileToSend.text) : '';
        saved = await db.messages.append(story.id, {
          role: 'user',
          text: fileBlock ? (cleanWords ? cleanWords + '\n\n' : '') + fileBlock : cleanWords,
          hidden: parsed.hidden || undefined,
          ooc: parsed.ooc || undefined,
          image: imageToSend || undefined,
          /* M379: a shortcut is kept as he TYPED it too — that is what travels to the storyteller (its meaning is in the
           * standing words); the thread still shows what it always showed. (M675: a file attached to a shortcut travels
           * with it — the wire adds it from the page's own words, stack.js wireable; this field stays what he typed.) */
          typed: parsed.kind ? String(text).trim() : undefined,
          /* M548: the choice he took, whole, with the words it went as — the seal holds while they are his words */
          choiceTaken: chosen ? { ...extra.choiceTaken, words: cleanWords } : undefined,
        });
        /* M675: let go only once the page is kept — a file was taken off the composer BEFORE the save, so a page that
         * would not save (a full shelf) gave him his words back and silently dropped the file; the picture always waited */
        if (fileToSend) setPendingFile(null);
        if (imageToSend) setPendingImage(null);
      } catch (err) {
        /* B1: a full shelf never swallows the words — the writer keeps
         * them and hears why. */
        showComposerNote(err && err.message ? err.message : 'The page wouldn’t save.');
        if (!chosen) restoreComposer(text); /* M548: a tapped choice never lands in the composer */
        return;
      }
      /* M478/M479/M480: A #STORY CONCEPT BECOMES THE BRIEF — by itself only with the switch ON (conceptToBrief, OFF by
       * default: "just pure #story for a short story, no need for a brief") and only into an EMPTY brief. */
      if (parsed.kind === 'story' && !(story.brief || '').trim() && (await db.settings.get('conceptToBrief')) === true) { /* M480: OFF unless he switched it on — a plain #story stays a plain #story */
        const concept = String(text).trim().replace(/^#story\s*/i, '').trim();
        if (concept) briefFromConcept({ story, concept, manual: false }).catch(() => {});
      }
      if (!parsed.hidden) {
        /* M383: ONE PAGE OF HIS, SHOWN ONCE. A #story opens a new tale, and opening it draws that tale — which, once his
         * words are saved, already shows them; this line then drew them a second time. Two "YOU" boxes for one message
         * (his screenshot), until a page landed and the thread was redrawn — and when no page came, they stayed. */
        const alreadyShown = [...els.thread.querySelectorAll('.msg[data-id]')].some((n) => n.dataset.id === String(saved.id));
        if (!alreadyShown) els.thread.appendChild(msgNode(saved));
        if (!lastRender.ids.includes(saved.id)) lastRender.ids.push(saved.id);
        scrollToBottom();
        /* M21: the shelf preview follows the newest page, even before the
         * storyteller answers. */
        await refreshPreview(story.id);
      }

      /* M516/M536: where a #story's tale begins in its canon is checked where its first page is built (generate() — a send,
       * a Try again or a reroll alike); a tale already under way is placed by the page chain (placeNext, M527) */

      await generate({ directive: parsed.directive, ooc: parsed.ooc });
      stories = await db.stories.list();
      renderStoryList();
      refreshEmber();
    } finally {
      busy = false;
      drawChoices(); /* M548 */
    }
  }

  /* ---------- regenerate ("rewrite from here") ---------- */

  /* M675 — HIS: "Delete all the button like try again, this story, the ledger, everything … it'll get cluttered. Especially
   * retry can be press on my input message." The footer's "Try again" (M25; M302 made it mean the newest turn, M674 made it
   * a new version) is gone with the four links beside it: it was a second door to what two controls on the page itself
   * already do — "try again" under his own message (retryUserMessage) and ▸ on the newest page (swipeRegenerate). Both
   * lead through regenerateFrom / swipeRegenerate below, so every law M302 and M674 gave the footer's button still holds
   * at those doors (the walk presses them). */

  /* M27: retrying a reader's page = rewind to just after it, then generate.
   * The ledger's M21 snapshots restore whatever the erased answers wrote. */
  /* ---------- M27: a picture for the page ---------- */
  let pendingImage = null;
  let pendingFile = null; /* M668: a text file to ride with the next page */
  /* M668 — HIS: "when I swipe and it errors and I press retry, does it retry on the second swipe, and is the previous one not
   * gone?" It did not, and it was: "Try again" on a storyteller's page let that page go, EVERY version of it, and wrote
   * one anew. M668 cured the one case he named (after a swipe that failed) by remembering the failed swipe. M674 made it
   * the rule and took the memory out: the newest page is ALWAYS told again as another version (regenerateFrom). */

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

  /* M668 — HIS: "can it also select a file like md, text, yaml or something". A text file is read as text (never a picture's
   * path): up to 300,000 characters, and nothing that is not text. */
  const FILE_MAX = 300000;
  function readTextFile(file) {
    return new Promise((resolve, reject) => {
      if (file.size > FILE_MAX * 4) { reject(new Error('That file is too large to ride in a page (' + Math.round(file.size / 1024) + ' KB) — 300 KB of text is the most.')); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || '').replace(/\r\n?/g, '\n');
        if (!text.trim()) { reject(new Error('That file is empty.')); return; }
        if (/\u0000/.test(text)) { reject(new Error('That file is not text — a picture, or a text file (.md, .txt, .yaml, .json…), is what this takes.')); return; }
        if (text.length > FILE_MAX) { reject(new Error('That file is too long to ride in a page (' + text.length + ' characters) — 300,000 is the most.')); return; }
        resolve({ name: String(file.name || 'file').slice(0, 120), text: text.trimEnd() });
      };
      reader.onerror = () => reject(new Error('That file would not read.'));
      reader.readAsText(file);
    });
  }
  function setPendingFile(f) {
    pendingFile = f;
    if (!els.attachPreview) return;
    if (f) pendingImage = null; /* one thing rides with a page: the newest chosen */
    els.attachPreview.textContent = '';
    if (!f) { els.attachPreview.hidden = true; return; }
    const chip = document.createElement('span');
    chip.className = 'attach-file-chip';
    chip.textContent = f.name + ' — ' + (f.text.length >= 1000 ? Math.round(f.text.length / 1000) + ',000' : String(f.text.length)) + ' characters, sent with your next page';
    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'attach-drop';
    drop.textContent = '×';
    drop.setAttribute('aria-label', 'Take the file back');
    drop.addEventListener('click', () => setPendingFile(null));
    els.attachPreview.append(chip, drop);
    els.attachPreview.hidden = false;
  }
  if (els.btnAttach && els.attachFile) {
    els.btnAttach.addEventListener('click', () => els.attachFile.click());
    els.attachFile.addEventListener('change', async () => {
      const file = els.attachFile.files && els.attachFile.files[0];
      els.attachFile.value = '';
      if (!file) return;
      const picture = /^image\//.test(file.type || '') || /\.(?:png|jpe?g|gif|webp|bmp|heic|heif|avif)$/i.test(file.name || '');
      if (!picture) {
        try { setPendingFile(await readTextFile(file)); } catch (err) { toast(err && err.message ? err.message : 'That file would not read.'); }
        return;
      }
      try {
        const img = await readImageFile(file);
        /* M675: the file he had chosen is let go only when the picture HAS been read — it was let go first, so a
         * picture that would not read (.heic, on a browser that cannot open one) left the file's chip standing, still
         * saying "sent with your next page", over a file that was no longer going anywhere */
        pendingFile = null;
        setPendingImage(img);
      } catch {
        toast('That picture would not read — another one might.');
      }
    });
  }

  async function retryUserMessage(messageId) {
    if (busy) return;
    if (!(await waitForRebuild())) return;
    if (busy) return;
    /* M295: CLAIMED AT ONCE. The house was claimed only after the story, the
     * pages and a delete had been awaited — a second tap in that window found
     * it idle and two turns ran on one page. Claimed here, as regenerateFrom
     * does; the answer-follows path hands the claim to regenerateFrom in the
     * same breath (no await between), which claims it again itself. */
    busy = true;
    try {
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
        busy = false;
        await regenerateFrom(after.id, { fromHisPage: true });
        return;
      }
      /* no answer followed. M675: WHAT STANDS AFTER IT DECIDES. Nothing, or only the house's own stale nudges (a "Go on"
       * that never got its page) — the turn is asked again as it stands, nothing of his let go (answerAnew). Anything
       * else — a later message of his that also got no answer, a page folded away — used to be let go right here,
       * without a word (the audit of M674: "every door asks" was not true of this one). Those go only through
       * regenerateFrom, which says what would go and asks first. */
      if (msgs.slice(at + 1).every(isStaleNudge)) { await answerAnew(story, msgs, at); return; }
      busy = false;
      await regenerateFrom(messageId, { fromHisPage: true });
    } finally {
      busy = false;
    }
  }

  /* the house's own nudge: the hidden "continue" a "Go on" leaves (continueTurn). One that stands after his unanswered
   * message never got its page — it is the house's, not his, and goes without a question. */
  function isStaleNudge(m) { return Boolean(m && m.hidden && m.role === 'user' && String(m.text || '').trim().toLowerCase() === 'continue'); }
  /* HIS MESSAGE, WITH NO ANSWER OF ITS OWN AND NOTHING OF HIS AFTER IT, ANSWERED ANEW — the one way it is done, from "try
   * again" under it and from "Rewrite from here" alike (M675: the second door folded the ledger back to the page before
   * first — which lets nothing go here, drops what he changed in the ledger by hand since the telling failed, and stops
   * the readers still on the page before). The stale nudges go first, so the answer is to THIS page. The caller holds
   * the house (busy). */
  async function answerAnew(story, msgs, at) {
    const trailing = msgs.slice(at + 1);
    if (trailing.length) { await db.messages.deleteFrom(story.id, trailing[0].id); await forgetCheckpoints(story.id, trailing.map((m) => m.id)); }
    await renderThread({ structural: true, opening: true });
    /* M674: asked as it was asked. This was the one door M302 missed — it asked plainly (generate() bare), so "try
     * again" under his own unanswered out-of-character question brought the answer in as a page of the STORY and sent
     * the ledger's reader to learn from it; a shortcut's hidden instruction was not sent again either (walked:
     * DOM-46, the fourth door). The turn's own words are read for their command, as every other door reads them. */
    await generate(turnArgsBefore(msgs, at + 1));
    stories = await db.stories.list();
    renderStoryList();
  }

  async function regenerateFrom(messageId, { fromHisPage = false } = {}) { /* M674: fromHisPage — he tapped “try again” on his own message (the question below is worded from where he tapped) */
    if (busy) return;
    if (!(await waitForRebuild())) return;
    if (busy) return;
    busy = true;
    try {
      const story = await activeStory();
      if (!story) return;
      const history = await db.messages.list(story.id);
      const at = history.findIndex((m) => m.id === messageId);
      if (at === -1) return;
      const target = history[at];

      /* M674 — HIS: "How about this? … 'Try again' on a page that landed normally still replaces it." It did worse than
       * replace: it let the page go — every version of it — and only THEN asked for a new one. A provider's error, a lost
       * line or a Stop in that moment left him with neither (made to happen in the walk: one page, Try again, a 401 —
       * no page). And the same tap on a page in the MIDDLE of a tale let go of every page after it, however many,
       * without a word. Two rules now, for every door that leads here (the "Try again" under the thread, "try again" on
       * his own page, "Rewrite from here"):
       *   - THE NEWEST PAGE IS TOLD AGAIN AS ANOTHER VERSION OF ITSELF (the swipe's own door). Nothing is let go: the
       *     earlier telling is a swipe away (◂ 1/2 ▸), and a telling that fails leaves the page exactly as it was.
       *   - A REWIND THAT LETS PAGES GO SAYS HOW MANY, AND ASKS. Told no, nothing happens. Told yes, the pages AFTER the
       *     answer go — and the answer is told again as another version, like the newest page (below). */
      const laterShown = history.slice(at + 1).filter((m) => m && !m.hidden);
      const answer = target.role === 'assistant' ? target : (laterShown[0] && laterShown[0].role === 'assistant' ? laterShown[0] : null);
      const letGo = target.role === 'assistant' ? laterShown : (answer ? laterShown.slice(1) : laterShown);
      if (answer && !letGo.length) {
        /* (a "Go on" that never got its page may still lie hidden after it: it is left where it is, as ▸ leaves it — a new
         * version reads only what came BEFORE its page, and nothing is let go on this path, not even that) */
        busy = false; /* handed over in the same breath: the swipe's door claims the house itself (as M295's does) */
        await swipeRegenerate(answer);
        return;
      }
      /* M675: WHAT GOES IS SAID AS HE WOULD COUNT IT. The question said "the 2 pages after" of one page and one message of
       * his own (every row counted as a page — the delete's question beside it counts the storyteller's pages only), and
       * a page FOLDED AWAY after the point (the housekeeper's "fold away") went with the rest uncounted — or, when it was
       * all that stood after his message, without any question at all. Counted by kind now, the folded ones among them;
       * the house's own stale nudges are not his and are not counted. */
      const folded = (answer ? history.slice(history.indexOf(answer) + 1) : history.slice(at + 1)).filter((m) => m && m.hidden && !isStaleNudge(m));
      if (!answer && !letGo.length && !folded.length) {
        /* his own message, unanswered, nothing of his after it: asked again as it stands — nothing is let go, so nothing
         * is rewound (answerAnew, the same way "try again" under it goes) */
        await answerAnew(story, history, at);
        return;
      }
      {
        const told = letGo.filter((m) => m.role === 'assistant').length;
        const his = letGo.length - told;
        const kinds = [];
        if (told) kinds.push(told === 1 ? 'the page' : 'the ' + told + ' pages');
        if (his) kinds.push(his === 1 ? 'your message' : 'your ' + his + ' messages');
        if (folded.length) kinds.push(folded.length === 1 ? 'the page folded away' : 'the ' + folded.length + ' pages folded away');
        const those = (kinds.length > 1 ? kinds.slice(0, -1).join(', ') + ' and ' + kinds[kinds.length - 1] : kinds[0]) + ' after ';
        const n = letGo.length + folded.length;
        const ok = window.confirm('Tell the story again from here? '
          + (!answer ? 'This message will be answered anew, and ' + those + 'it'
            : (target.role === 'assistant' && !fromHisPage ? 'This page' : 'The answer to this message') + ' will be told again as another version (the telling that stands stays a swipe away), and ' + those + (target.role === 'assistant' && !fromHisPage ? 'it' : 'that'))
          + ' will be let go for good. (To keep ' + (n === 1 ? 'it' : 'them') + ', use “branch” on this page instead — it begins a new telling from here and leaves this one as it is.)');
        if (!ok) return;
      }

      /* B5: wait for the workers BEFORE the rewrite — never race a page
       * the extractor is still reading. */
      await pendingWork(story.id, 5000);

      if (answer) {
        /* M674: A REWIND KEEPS THE ANSWER TOO. The pages AFTER the answer go (he was told how many, and said yes); the
         * answer itself is told again as another version, through the swipe's own door — never let go first. So the one
         * rule holds here as well: a telling that fails, or that he stops, leaves that page exactly as it was, and the
         * telling that stood is a swipe away. (Until M674 the answer went with the rest BEFORE the storyteller was
         * asked: a provider's error after "yes" left his message with no answer at all.)
         * The ledger is set to where it stood when the answer had been read — the boundary of the first page let go —
         * so the version being left keeps the ledger it earned (M40) and not the later pages'. */
        const after = history.slice(history.indexOf(answer) + 1); /* every page after the answer, a hidden one among them */
        const rewound = await rewindTo(story, history, after[0].id);
        if (!rewound) toast('Try again could not set the ledger back to where it stood after this page — no checkpoint reaches it; the later pages’ reads stayed.');
        /* M44: the record lets go of every line that reached the pages now gone */
        { const vis = visiblePages(history); const k = vis.findIndex((m) => m.id === letGo[0].id); if (k !== -1) await saveMemory(story.id, memoryTruncatedAt(await loadMemory(story.id), k)); }
        await db.messages.deleteFrom(story.id, after[0].id);
        await forgetCheckpoints(story.id, after.map((m) => m.id)); /* M107 */
        await refreshPreview(story.id); // M21: the shelf re-reads what's left
        await renderThread({ structural: true, opening: true });
        await settleRereadOwed(story); /* M509-10 */
        busy = false; /* handed over, as above */
        await swipeRegenerate(answer);
        return;
      }

      /* No answer stands to be told again: his own message, with nothing of the storyteller's right after it, and
       * something that goes with the rewind (another message of his, a page folded away — he was asked). It is answered
       * anew. (His newest message, unanswered, with nothing after it went through answerAnew above.) */
      /* M21: TRUE rollback — the ledger lets go of everything the doomed
       * pages caused. Restore the boundary snapshot taken before this
       * turn's user page; the newer snapshots drop with it. The undo log
       * stays independent. */
      const boundary = boundaryFor(history, target.id);
      const rewound = boundary ? await rewindTo(story, history, boundary.id) : false;
      /* M509-6: a Try again that could NOT set the ledger back says so — before this the page's own reads stayed in
       * silence and the retry was told the hour and the room of the page it was replacing */
      if (!rewound) toast('Try again could not set the ledger back to before this page — no checkpoint reaches it; the page’s own reads stayed.');

      /* M44: the record lets go of every line that reached the pages now gone — counted from the first of them that
       * SHOWS (M674: it was looked for at the very next page, and when that one was hidden — a page the housekeeper had
       * folded away — no line was let go at all, though the pages after it went) */
      if (letGo.length) {
        const vis = visiblePages(history);
        const k = vis.findIndex((m) => m.id === letGo[0].id);
        if (k !== -1) await saveMemory(story.id, memoryTruncatedAt(await loadMemory(story.id), k));
      }
      const next = history[at + 1];
      if (next) {
        await db.messages.deleteFrom(story.id, next.id);
        await forgetCheckpoints(story.id, history.slice(at + 1).map((m) => m.id)); /* M107 */
      }
      await refreshPreview(story.id); // M21: the shelf re-reads what's left
      await renderThread({ structural: true, opening: true });
      await settleRereadOwed(story); /* M509-10 */
      /* M302: asked again as it was asked — the turn's own words, read for their command */
      await generate(turnArgsBefore(history, at + 1));
      stories = await db.stories.list();
      renderStoryList();
    } finally {
      busy = false;
    }
  }

  /* ---------- swipes (M9) ---------- */

  /* M674: WHAT IS SAID OF A PAGE'S WORDS BELONGS TO THE VERSION THAT HAS THOSE WORDS. A page with versions kept each
   * version's words, thinking and receipt — and ONE set of everything else: "stopped by hand", "cut short", the mend and
   * its earlier words, the words he put back, the readers' notes, what the page reader wrote, the voices, the masthead,
   * where it looked things up. They stayed on the page whichever version was shown. So a new version of a MENDED page
   * still wore the mend, and "Put the earlier words back" wrote the OTHER version's words over it; a half page he had
   * stopped, a swipe back, read as a whole one; the receipt of one version listed what the readers took from another.
   * It mattered little while only ▸ made versions; it matters now that "Try again" does. Each version carries its own:
   * the one being left takes them with it (versionWithNotes), the one shown brings its own or none (notesOfVersion). */
  const VERSION_NOTES = ['stopped', 'cutShort', 'mended', 'keptText', 'findings', 'extraction', 'voices', 'masthead', 'sources'];
  const noteStands = (v) => v !== undefined && v !== null && v !== false;
  function versionWithNotes(version, page) {
    const out = { ...(version || {}) };
    for (const k of VERSION_NOTES) { if (page && noteStands(page[k])) out[k] = page[k]; else delete out[k]; }
    return out;
  }
  function notesOfVersion(version) {
    const patch = {};
    for (const k of VERSION_NOTES) patch[k] = version && noteStands(version[k]) ? version[k] : undefined;
    return patch;
  }

  async function swipeTo(messageId, dir) {
    if (busy) return;
    if (!(await waitForRebuild())) return;
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
    const idx = shownIndex(msg); /* M576: the one rule */
    const next = idx + dir;
    if (next >= msg.swipes.length) {
      /* Walking past the last version writes a new one (the old keep). */
      swipeRegenerate(msg);
      return;
    }
    if (next < 0) return;
    /* M577 (the audit): the house is claimed while the ledger moves between versions — unclaimed, a page sent in that
     * moment read the ledger half-moved (the version left saved, the version shown not yet put back) */
    busy = true;
    try { await swipeToNow(story, history, msg, idx, next); } finally { busy = false; drawChoices(); }
  }
  async function swipeToNow(story, history, msg, idx, next) {
    const shown = msg.swipes[next];
    const last = isLastAssistantPage(history, msg.id);
    /* M40: the version being left keeps the ledger it earned — the last page only (M67); M675: once it HAS earned it (its
     * readers still out: nothing is written down for it, and it is read whole when he comes back to it) */
    if (last && !readersStillOn(story.id, msg.id)) await saveVersionState(story.id, msg.id, idx, await loadState(story.id));
    /* M674: the version being left takes what was said of its words with it; the one walked to shows its own. The page
     * is read once more first, and nothing waits between that reading and the writing: a reader may have written on it
     * (a mend, its notes) since the tap, and those belong to the version being left. */
    const standing = (await db.messages.list(story.id)).find((m) => m && m.id === msg.id);
    const nowPage = standing && Array.isArray(standing.swipes) && standing.swipes.length === msg.swipes.length ? standing : msg;
    const kept = nowPage.swipes.slice();
    kept[idx] = versionWithNotes(kept[idx], nowPage);
    const updated = await db.messages.update(story.id, msg.id, {
      swipes: kept,
      swipeIdx: next,
      text: shown.text,
      thinking: shown.thinking,
      thinkingMs: shown.thinkingMs,
      receipt: shown.receipt || msg.receipt,
      ...notesOfVersion(shown),
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
      { const vis = visiblePages(history); const k = vis.findIndex((m) => m.id === msg.id); if (k !== -1 && (await keeperOnFor(story))) await saveMemory(story.id, memoryWithoutPage(await loadMemory(story.id), k)); } /* M675: see letting a line go, below (swipeRegenerate) */
      /* (M675: the tale's page-reader switch no longer stands in front of this — M674 took the same condition off the new
       * version's landing: with that switch off every other helper still has the version to read, each by its own switch) */
      if (updated && msg.role === 'assistant' && !msg.ooc) {
        const before = history.slice(0, history.findIndex((m) => m.id === msg.id));
        const lastUser = [...before].reverse().find((m) => m && m.role === 'user');
        startBackgroundWork(story, updated, lastUser ? pageText(lastUser) : '');
      }
    }
    /* M21: the preview always reads the SHOWN version of the latest page. */
    await refreshPreview(story.id);
    renderStoryList();
    refreshEmber();
    /* M510-10: the version walked to may have no plan kept any more (the last four stand) — a small model's helper reads
     * it now, so the next page is not sent whole; for any other storyteller nothing is asked */
    planAhead();
  }

  /* M675: the hidden "continue" a "Go on" leaves before its page (continueTurn), put back before a page that is the story
   * and has lost it (or never had one: a reply brought in). It stands between the page and whatever comes before it,
   * by its place in time; where there is no room for it (two pages kept at the very same instant) nothing is written
   * and the caller asks the turn as its words say. Returns whether it stands. */
  async function putBackGoOn(story, history, pageId) {
    const at = history.findIndex((m) => m && m.id === pageId);
    if (at < 1) return false;
    const lo = Number(history[at - 1].ts); const hi = Number(history[at].ts);
    if (!(Number.isFinite(lo) && Number.isFinite(hi) && hi > lo)) return false;
    await db.messages.append(story.id, { role: 'user', text: 'continue', hidden: true, ts: lo + (hi - lo) / 2 });
    return true;
  }

  /* Write another version of this page: re-ask its turn, keep the old
   * versions, land the new one as the shown swipe. B5: the workers finish
   * first; the referee replays the same verdict for the same words. M21:
   * the ledger rewinds to the boundary before this turn first, so no
   * consequence of a version that no longer stands survives. */
  async function swipeRegenerate(msg) {
    if (busy) { toast('The storyteller is still busy — one moment, then swipe.'); return; } /* M82: a dropped press says so (M62-002's law) */
    if (!(await waitForRebuild())) return;
    if (busy) { toast('The storyteller is still busy — one moment, then swipe.'); return; }
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
      const leavingIdx = shownIndex(msg); /* M576: the one rule */
      /* M675: are the readers of the page that stands STILL OUT after those five seconds? Then the rewind below cuts them
       * short, and the ledger in hand is half-read: it is not written down as this version's own (readersStillOn) */
      const cutShort = lastPage && readersStillOn(story.id, msg.id);
      if (lastPage && !cutShort) await saveVersionState(story.id, msg.id, leavingIdx, leaving);
      /* M21: TRUE rollback — swipe-creation restores the boundary too — for the
       * last page. An older page's new version never rewinds the later turns'
       * ledger (M67); the auditor reconciles after the readers see the new words. */
      if (lastPage) {
        const boundary = boundaryFor(historyNow, msg.id);
        if (boundary) await rewindTo(story, historyNow, boundary.id);
      }
      if (lastPage) await settleRereadOwed(story); /* M509-10 */
      /* M675 (the second reading) — A PAGE THAT IS THE STORY IS TOLD AGAIN AS THE STORY. How a turn is asked again is read
       * from the pages before it (turnArgsBefore): his words, unless a hidden "go on" stands between. Two kinds of page
       * are the story although his out-of-character message is the nearest thing of his before them and no "go on"
       * stands there: a reply brought in from another app (said to be the story when it was brought in), and a "go on"
       * page in a branch (a branch copies the pages that show — the hidden "go on" stayed behind). Asked again, each
       * was told OUT OF CHARACTER: "step out of the story and answer" — and the answer landed as another version of a
       * page of the story, with no reader sent to it, to be read as the story by whoever came by later. Such a page
       * is told again the way this house tells the story on after an aside: the hidden "go on" is put back before it
       * (it never travels; it is what says the page after it is the story), and the turn is asked from there. */
      let turn = turnArgsBefore(historyNow, historyNow.findIndex((m) => m.id === msg.id));
      if (turn.ooc === true) {
        const shown = visiblePages(historyNow);
        const k = shown.findIndex((m) => m.id === msg.id);
        if (k !== -1 && !asideAt(shown, k) && (await putBackGoOn(story, historyNow, msg.id))) turn = {};
      }
      const landed = await generate({ ...turn, swipeTarget: msg, replayAfter: !lastPage });
      /* M44: a swiped page's record line is let go (a hole, refilled).
       * M675 (the second reading) — LETTING A LINE GO, IN EVERY PLACE IT HAPPENS (a new version here; a walk to a version
       * never read; an edit; "read again"; a mend; a mend taken back): the first pass cured the mend alone. The line
       * went BEFORE the telling was asked for — a telling that failed, or that he stopped, left the page exactly as it
       * was and its line gone; it went whoever had written it (memory.js memoryWithoutPage keeps his own now); and it
       * went in a tale whose keeper is switched off, where nothing folds those pages again — a hole for good where the
       * storyteller had known them. Now: once the new words have landed, and only where a keeper will write the line
       * that takes its place. (Nothing of the request needs it gone sooner: a line reaching the page being told again
       * never rides with it — memoryForWindow.) */
      if (landed && (await keeperOnFor(story))) { const vis = visiblePages(historyNow); const k = vis.findIndex((m) => m.id === msg.id); if (k !== -1) await saveMemory(story.id, memoryWithoutPage(await loadMemory(story.id), k)); }
      /* M302: a new version of an out-of-character answer is out of character (turnArgsBefore) */
      /* M72: a new version on an OLDER page is history changed at that page —
       * fold back, read the new words once, re-apply the rest (it used to be
       * read on top of the latest ledger and left to the auditor). M73-002:
       * claimed the moment generate returns — its own finally has already let
       * busy go, and any await before the claim is a gap where the house
       * looks idle and a branch slips in. */
      if (landed && !lastPage) replayFrom(story, msg.id, { changed: true });
      if (!landed && lastPage) {
        const going = lettingGo.has(story.id); /* M675: nothing is begun or put back for a tale being let go */
        const standing = cutShort && !going ? (await db.messages.list(story.id)).find((m) => m && m.id === msg.id) : null;
        if (standing && standing.role === 'assistant' && !standing.ooc) {
          /* M675: no new telling came, and the readers of the page that stands were cut short by this very retry. The
           * ledger is where the retry set it — before the page — so the page is read again, whole, from there (what a
           * version never read gets when he walks to it); the half-read ledger is not handed back as if it were done. */
          const beforeIt = historyNow.slice(0, historyNow.findIndex((m) => m.id === msg.id));
          const lastUser = [...beforeIt].reverse().find((m) => m && m.role === 'user');
          startBackgroundWork(story, standing, lastUser ? pageText(lastUser) : '');
        } else if (!going) {
          await saveState(story.id, leaving);
          notify(story.id);
        }
      }
      stories = await db.stories.list();
      renderStoryList();
    } finally {
      busy = false;
    }
  }

  /* ---------- edit (M9) ---------- */

  /* M296: WHAT FOLLOWS A RE-INKED PAGE, WHOEVER RE-INKED IT. The writer's own
   * edit let the record line over the page go and read the page again (the
   * last one from its boundary; an older one by replay) — the housekeeper's
   * re-inks and its take-backs did neither: the record kept summarizing words
   * the page no longer held, and the ledger kept the old words' consequences.
   * Every re-ink passes through here now. */
  async function pageReinked(story, pageId) {
    if (!story || !pageId) return false;
    const history = await db.messages.list(story.id);
    const msg = history.find((m) => m && m.id === pageId);
    if (!msg) return false;
    { const vis = visiblePages(history); const k = vis.findIndex((m) => m.id === msg.id); if (k !== -1) { if (await keeperOnFor(story)) await saveMemory(story.id, memoryWithoutPage(await loadMemory(story.id), k)); await pageRewritten(story.id, k); } } /* M528: the plans keeper reads it again; M675: the line goes only where a keeper will fold it again */
    if (msg.role === 'assistant' && story.extraction !== false && !msg.ooc) {
      const before = history.slice(0, history.indexOf(msg));
      const lastUser = [...before].reverse().find((m) => m && m.role === 'user');
      const isLast = !history.slice(history.indexOf(msg) + 1).some((m) => m && m.role === 'assistant' && !m.hidden);
      if (isLast) {
        const boundary = boundaryFor(history, msg.id);
        if (boundary) await rewindTo(story, history, boundary.id);
        startBackgroundWork(story, msg, lastUser ? pageText(lastUser) : '');
      } else {
        replayFrom(story, msg.id, { changed: true });
      }
    } else if (msg.role === 'user') {
      pendingAudit.add(story.id);
    }
    return true;
  }

  async function beginEdit(messageId) {
    if (busy) return;
    if (!(await waitForRebuild())) return;
    if (busy) return;
    const story = await activeStory();
    if (!story) return;
    const history = await db.messages.list(story.id);
    const msg = history.find((m) => m.id === messageId);
    if (!msg) return;
    const node = els.thread.querySelector('.msg[data-id="' + cssId((messageId)) + '"]');
    if (!node) return;
    const body = node.querySelector('.msg-body');
    if (!body) return;

    const editor = document.createElement('textarea');
    editor.className = 'edit-box';
    editor.value = pageText(msg);
    const openedIdx = shownIndex(msg);
    editor.openedIdx = openedIdx; /* M675: which telling of the page this editor was opened on (rerenderMessage) */
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
      /* M577 (the audit): kept while a page is being written, the edit would set the ledger back (or replay it) under the
       * page being written — it waits, the editor still open, until the house is free */
      if (keep && (busy || isReplaying())) { toast('The storyteller is still writing — keep your new words in a moment.'); return; }
      done = true;
      if (keep) {
        const text = editor.value;
        const patch = { text };
        /* M510-61: HIS WORDS, EDITED, ARE READ AGAIN. His report: "I branch at a #q, edit the message, Try again — and it
         * keeps #q." A shortcut ("#q", the next scene) is kept as he TYPED it beside the words shown, and the typed form is
         * what the storyteller is sent (M379); an out-of-character question keeps its mark the same way. The edit changed
         * only the shown words — the typed "#q" (and a question's mark) stayed, and every Try again sent "#q" again. An
         * edited message of his is what it now says: the command is read from the new words; the typed form and the mark
         * follow them — a shortcut kept, still the shortcut; taken out, his words go; "#question …" in, out of character. */
        if (msg.role === 'user') {
          const reread = parseCommand(String(text || ''));
          patch.ooc = reread.ooc === true ? true : undefined;
          if (msg.typed !== undefined) patch.typed = reread.kind && reread.kind !== 'question' ? String(text).trim() : undefined;
        }
        /* An edited shown swipe keeps the versions in step (M576: the one rule).
         * M675 (the second reading) — HIS WORDS ARE WRITTEN OVER THE PAGE AS IT STANDS, NOT AS IT STOOD WHEN THE EDITOR
         * OPENED. `msg` is the page as it was read when he pressed ✎ — and he may type for minutes. The patch was
         * worked out from that copy (the very thing store.js change() was made to end, for the menders), and a whole
         * redraw waits for an open editor (M429): a live sync from his other browser can change the page under it
         * unseen. Replayed (DOM-270): a page that had gained a second telling meanwhile was left saying his words
         * in `text` and showing the other telling — his words kept where nothing showed them; and a page that
         * already had versions had its list written back as it stood when the editor opened — the newest telling
         * written out of it. Decided inside the row's own lock, from the row as it is:
         *   - the page shows the telling he was correcting (a mend of it, a reader's notes on it, since): his words
         *     become that telling's words — an edit, as ever;
         *   - the page shows ANOTHER telling now, one this screen never drew: nothing of it is written over. His words
         *     are kept as a telling of their own — the one he was correcting, with his words — put last and shown;
         *     every other telling stays as it is, each with what was said of it (versionWithNotes, as when a new
         *     telling lands). */
        let apart = false;
        const updated = await db.messages.change(story.id, msg.id, (now) => {
          if (!(Array.isArray(now.swipes) && now.swipes.length) || shownIndex(now) === openedIdx) return shownTextPatch(now, text, patch);
          apart = true;
          const swipes = now.swipes.slice();
          const leftAt = shownIndex(now);
          if (swipes[leftAt]) swipes[leftAt] = versionWithNotes(swipes[leftAt], now);
          const base = swipes[openedIdx];
          const mine = { ...(base && typeof base === 'object' ? base : {}), text, ts: Date.now() };
          swipes.push(mine);
          return { ...patch, text, swipes, swipeIdx: swipes.length - 1, thinking: mine.thinking, thinkingMs: mine.thinkingMs, receipt: mine.receipt, ...notesOfVersion(mine) };
        });
        /* M44: the edited page's record line is let go (a hole, refilled).
         * The LAST storyteller page is re-read from the boundary before its
         * turn (the old version's consequences must not stand); an older
         * page's edit is replayed from there (M68/M69). M72: the ledger work
         * is claimed before any rendering, so nothing finds the house idle
         * in between. M296: one door for every re-ink (pageReinked) — the
         * housekeeper's re-inks and take-backs pass through it too. */
        if (updated) await pageReinked(story, msg.id);
        /* M100: the ripple — one fact changed here is made true everywhere.
         * Queued AFTER the re-reading above, so the rename lands on the ledger
         * the re-read produced and is never rewound away. */
        if (updated && msg.role === 'assistant' && !msg.ooc) rippleAfterEdit(story, msg.id, pageText(msg), text);
        if (updated && msg.role === 'assistant' && !msg.ooc) choicesAfterEdit(story, msg.id); /* M549 */
        toast(apart ? 'This page was told again while you wrote — your words are kept as a version of their own.' : 'The page is re-inked.');
        /* M21: new words on the latest page mean a new preview. */
        await refreshPreview(story.id);
      }
      await rerenderMessage(story.id, msg.id, { fromItsEditor: true });
      /* M429: a whole redraw asked for while the editor stood open runs now */
      if (threadRedrawOwed) { const owed = threadRedrawOwed; threadRedrawOwed = null; await renderThread(owed); }
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
    'briefMode', /* M517: Manual or Automatic */
    'choices', /* M548: Choices matter — the switch goes with the tale; the choices themselves ride on its pages */
  ];

  async function branchFrom(messageId) {
    if (!(await waitForRebuild())) return;
    if (busy) { toast('The house is still writing — one moment, then branch.'); return; }
    const story = await activeStory();
    if (!story) return;
    const history = await db.messages.list(story.id);
    const at = history.findIndex((m) => m.id === messageId);
    if (at === -1) return;
    const pages = history.slice(0, at + 1).filter((m) => m && !m.hidden);
    /* M245: A BRANCH OF A BRANCH GREW ITS OWN NAME. The suffix was simply
     * appended, so the writer's shelf carried "Actually use this lol — a
     * branch — a branch — a branch — a branch — a branch — a branch — a
     * branch — a branch" — a title too long to read, in the one list he uses
     * to find a story. The stem is taken once and the branches are numbered
     * from there. */
    const stem = String(story.title || 'a tale').replace(/\s*—\s*a branch(\s*\d+)?\s*$/i, '').trim() || 'a tale';
    const taken = new Set((await db.stories.list()).map((x) => String(x.title || '')));
    let title = stem + ' — a branch';
    for (let n = 2; taken.has(title); n += 1) title = stem + ' — a branch ' + n;
    /* M332: A BRANCH IS MADE WHOLE OR NOT AT ALL. It was made in the open: the row first (on the shelf, marked for a
     * push), then its pages one by one, then — after waiting up to eight seconds for the readers — its ledger, its
     * checkpoints, its RECORD and its lore. A refresh in that time (the writer's own, Android putting the tab to
     * sleep, or the house's own late-boot reload) left a tale with some of its pages, no ledger and no record,
     * looking like any other: "I branch, the page refreshes, and all the memory records are gone."
     * The row is marked `building` — with what it is being made from — until its last row is in: a building tale is
     * not shown on the shelf, is never pushed, and one found at the next open was interrupted: it is cleared away
     * and the branch is made again from the tale and page it names (healInterruptedBranches). */
    const branch = await db.stories.create({ title, building: { from: story.id, at: messageId, startedAt: Date.now() } });
    /* (what the catch-up after the branch needs is declared out here: the block below is a `try`) */
    let exact = false;
    let chainStillRunning = false;
    let fromTheTail = false;
    let groundAnew = false; /* M523: the world is written again for a branch from an earlier page */
    try {
    const carry = {};
    for (const key of BRANCH_CARRY) {
      if (story[key] !== undefined && story[key] !== null) carry[key] = story[key];
    }
    if (Object.keys(carry).length) await db.stories.update(branch.id, carry);
    /* M516: where it began in its canon goes with the branch — the start is the same start */
    { const kept = await db.settings.get(CANON_START_KEY(story.id)); if (kept) await db.settings.set(CANON_START_KEY(branch.id), kept); }
    const idMap = {};
    for (const m of pages) {
      const page = { ...m };
      delete page.id;
      delete page.storyId;
      const saved = await db.messages.copy(branch.id, page); /* M511: the page whole — every field it carries */
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
    exact = false;
    /* M70: with a journal, ONE rule for any page: the branch's ledger is the
     * fold up to the last storyteller page the branch actually contains — for
     * a writer's first message that is none (k = -1): empty but for what the
     * founder wrote from the brief. The checkpoint reckoning below stands only
     * for a store from before the journal. */
    /* M112: the readers may still be on the newest page when the writer
     * branches. pendingWork waits eight seconds; false means the chain is
     * still running — the ledger copied now would lack that page's reads,
     * so the branch re-reads its last page itself (a light read, not the
     * deep one). The origin's own chain finishes in the origin, untouched. */
    /* M506: pendingWork says false both for "nothing was pending" and "the wait ran out" — read as "still running", a
     * settled tale's branch was marked inexact too (and re-read its last page for nothing). Still running means: the
     * wait ran out AND a reader is still out. */
    chainStillRunning = (await pendingWork(story.id, 8000)) === false && workInFlight(story.id);
    const nowState = await loadState(story.id);
    const kBranch = pages.filter((m) => m.role === 'assistant').length - 1;
    fromTheTail = isLastAssistantPage(history, target.id) || !history.slice(at + 1).some((m) => m && !m.hidden);
    /* M91: THE NEWEST PAGE CARRIES THE LEDGER AS IT STANDS — exact by
     * definition once the readers have landed, and never a re-derivation.
     * M70's fold came first here and, on a store from before the journal
     * (a journal that begins mid-story, snapshots that know no page), folded
     * from NOTHING: the writer branched from his newest page and the whole
     * ledger was gone. The fold is for OLDER pages, and only where the
     * journal reaches them. */
    /* M506: A BRANCH WHILE THE READERS ARE STILL ON THE NEWEST PAGE RE-READS IT FROM BEFORE THEM. M112 meant: the ledger
     * copied now lacks that page's reads, so mark the copy inexact and let the branch read its last page itself. Two
     * faults undid it. (1) M66's line below (exact = exact || carried) ran for this door too and overrode the mark —
     * the branch was called exact, its incomplete ledger became the page's own checkpoint (M127), and nothing ever read
     * the page again: the open finding of the m498 handoff, reproduced in DOM-127. (2) The re-read starts from the
     * ledger AS IT STANDS — which, when the origin's page reader had already written and only a later reader was still
     * out, holds that page's reads once and would take them twice. So the copy is the BOUNDARY before the page's turn
     * (M21's snapshot keyed by the page's own user message — the referee's fate in it, the page's reads not) when it
     * exists, the ledger as it stands otherwise; the branch's readers then read the page fresh. */
    let mustReread = false;
    if (fromTheTail && chainStillRunning) {
      const own = [...pages].reverse().find((m) => m && m.role === 'user' && !m.hidden);
      const boundary = own ? (await loadSnapshots(story.id)).find((e) => e.id === own.id) : null;
      carried = boundary && boundary.snap ? { ...boundary.snap, pendingVerdict: null } : nowState; /* M72: the ruling rode once */
      exact = false;
      mustReread = true;
    } else if (fromTheTail) {
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
      const idx = shownIndex(target); /* M576: the one rule */
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
    exact = (exact || Boolean(carried)) && !mustReread; /* M506: never over M112's mark */
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
    /* M337: whichever door chose this ledger (the newest page, the fold, a checkpoint, M91's as-it-stands), nothing in it
     * may be dated after the branch page */
    const carriedNow = dropTheFuture(JSON.parse(JSON.stringify(carried)), kBranch + 1).state;
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
    /* M127: the branch's last page owns the carried ledger as its checkpoint
     * (exact carries only) — so the readers' resume on open finds the page
     * finished and leaves it alone; an inexact carry re-reads and writes its
     * own checkpoint at the end of the chain */
    if (exact && carried) {
      const lastCarried = [...pages].reverse().find((m) => m && m.role === 'assistant' && !m.hidden);
      if (lastCarried) {
        const bid = idMap[lastCarried.id] || lastCarried.id;
        const idx = shownIndex(lastCarried); /* M576: the one rule */
        branchVersions[bid + ':' + idx] = JSON.parse(JSON.stringify(carried));
      }
    }
    if (Object.keys(branchVersions).length) await writeVersionStates(branch.id, branchVersions);
    const mem = await loadMemory(story.id);
    const visibleCount = pages.length;
    const nodes = mem.nodes.filter((n) => n.span[1] < visibleCount);
    await saveMemory(branch.id, { ...mem, nodes });
    const lore = await loadLore(story.id);
    if (lore.length) await saveLore(branch.id, lore.map((e) => ({ ...e })));
    /* M386: a branch keeps its canon — the series it found, the wiki he named, his pins, blocks and notes; what the
     * tracker derived from later pages (an advanced story position, the current setting) only from the newest page */
    await carryCanonMemory(story.id, branch.id, { fromTheTail });
    /* M523: THE WORLD AS IT STANDS IS THE WORLD AT THE BRANCH. Carried whole, a branch from an early page kept "what stands in
     * the world now" from pages it never had (a war won, a city fallen). It goes with the branch only from the newest page,
     * or as his own words; otherwise the branch's world is written again from the branch's own pages, once it stands. */
    { const kept = await db.settings.get(GROUND_KEY(story.id)); if (kept && (fromTheTail || kept.by === 'writer')) await db.settings.set(GROUND_KEY(branch.id), kept); else groundAnew = Boolean(kept); }
    await db.stories.update(branch.id, { building: false }); /* M332: whole — from here it is a tale like any other (and this write sends it to the device) */
    } catch (err) {
      /* M332: a branch that could not be finished is not left half-made */
      try { await db.stories.remove(branch.id); } catch (e2) { /* the next open clears it */ }
      toast('The branch could not be made (' + String((err && err.message) || err).slice(0, 120) + ') — nothing was left half-done; the tale it was taken from is untouched.');
      await refreshStories(true);
      return;
    }
    ctx.setActiveStoryId(branch.id);
    await refreshStories(true);
    giveCarriedWords(branch.id, { parent: story.id }); /* M675: the branch's carried pages are copied to it on the device */
    if (groundAnew) {
      const branchStory = (await db.stories.get(branch.id)) || branch;
      const promise = enqueueWork(branch.id, { name: 'ground', run: async ({ signal, stale }) => groundNext(branchStory, { signal, stale, force: true }) });
      noteWork(branch.id, promise);
      promise.catch(() => {});
    }
    await renderThread({ structural: true, opening: true });
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
        if (fromTheTail && chainStillRunning) {
          startBackgroundWork(branchStory, last, lastUser ? pageText(lastUser) : '', { deep: false, audit: true });
          toast('The readers were still on the newest page — the branch is reading it now.');
        } else {
          startBackgroundWork(branchStory, last, lastUser ? pageText(lastUser) : '', { deep: true, audit: true });
          toast('No exact checkpoint for this page — the workers are re-reading the branch from the brief and its pages.');
        }
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
    /* M114: on a touch screen a long press IS the reader's way to select and
     * copy words; the house never takes it (the action row under every page
     * already holds copy, edit, branch, read again, delete). The menu stays
     * for a mouse's right click. */
    if (isTouch()) return;
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

  /* M114: no long-press timer on the pages — it raced the native selection
   * and won, so nothing on a page could be highlighted or copied. */
  void pressTimer;

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
    } else if (btn.dataset.act === 'read again') {
      rereadPage(id);
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
    if (!(await waitForRebuild())) return;
    if (busy) return;
    /* M635: HIS MESSAGE GOES WITH THE PAGE THAT ANSWERED IT — his: "when I delete my message, the output should be gone
     * too". The × on his message let only his words go and left the storyteller's answer standing under the page before
     * it. A message of his now goes with everything that answered it — the storyteller's page (every version of it), a
     * page that carried on from it, and a hidden "go on" between them — up to his next message; the × on a storyteller's
     * page still lets that one page go. */
    const allNow = await db.messages.list(story.id);
    const target = allNow.find((m) => m.id === id);
    const answers = [];
    if (target && target.role === 'user' && !target.hidden) {
      for (let i = allNow.indexOf(target) + 1; i < allNow.length; i += 1) {
        const m = allNow[i];
        if (m.role === 'user' && !m.hidden) break;
        answers.push(m);
      }
    }
    const told = answers.filter((m) => m.role === 'assistant' && !m.hidden).length;
    const ok = window.confirm(told
      ? (told === 1 ? 'Let your message go, and the page that answered it?' : 'Let your message go, and the ' + told + ' pages that answered it?') + ' The pages around them stay exactly as written.'
      : 'Let this page go? The ones around it stay exactly as written.');
    if (!ok) return;
    /* the answers first, the last of them first (a storyteller page let go folds the ledger back to the page before it,
     * exactly — so the newest goes first); his own words last (a writer's page let go moves no storyteller page) */
    for (const m of [...answers].reverse()) await letOnePageGo(story, m.id);
    await letOnePageGo(story, id);
    /* M21: with the page gone, the preview re-reads the page before it. */
    await refreshPreview(story.id);
    renderStoryList();
    refreshEmber();
    toast(told ? (told === 1 ? 'Your message and its answer are gone.' : 'Your message and the pages that answered it are gone.') : 'The page is gone.');
  }
  /* One page lets go — never conflated with rewrite-from-here. */
  /* M675 (the second reading) — EACH PAGE LET GO WAITS FOR THE ONE BEFORE IT TO BE SETTLED IN THE LEDGER. His message goes
   * with every page that answered it (M635), one after the other — and a page let go in the middle of a tale has the
   * ledger rebuilt behind it (replayFrom), whose last step waits its turn among the tale's work. The next page did
   * not wait for it: its own rebuild found one still standing and did nothing at all — that page's writes stayed in
   * the ledger and the later pages' stamps were never moved down (a message with a page and its "go on", let go in
   * the middle of a tale). */
  async function letOnePageGo(story, id) {
    await afterReplay();
    /* M44: the record slides with the pages -- the line covering this page
     * is let go, the lines above it move down one */
    const allBefore = await db.messages.list(story.id);
    const visBefore = visiblePages(allBefore);
    const kGone = visBefore.findIndex((m) => m.id === id);
    const after = kGone !== -1 ? visBefore.slice(kGone + 1).find((m) => m) : null;
    const goneBoundary = boundaryFor(allBefore, id); /* the turn the page belonged to */
    void goneBoundary;
    if (kGone !== -1) await saveMemory(story.id, memoryAfterDeletion(await loadMemory(story.id), kGone));
    await db.messages.remove(story.id, id);
    await forgetCheckpoints(story.id, [id]); /* M107 */
    const gone = visBefore[kGone];
    /* M72: the ledger work is claimed right after the store write, before any
     * rendering. A WRITER'S page let go moves no storyteller page -- the
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
        setReplaying(true);
        ledgerWork = (async () => {
          try {
            await pendingWork(story.id, 120000);
            await foldTo(story, goneK - 1);
            const all = await loadVersionStates(story.id);
            for (const key of Object.keys(all)) if (key.split(':')[0] === id) delete all[key];
            await writeVersionStates(story.id, all);
            pendingAudit.delete(story.id);
          } finally { setReplaying(false); }
        })();
      }
    }
    const node = els.thread.querySelector('.msg[data-id="' + cssId((id)) + '"]');
    if (node) node.remove();
    lastRender.ids = lastRender.ids.filter((x) => x !== id);
    /* M675: THE PAGE THAT IS NOW THE NEWEST WEARS THE NEWEST PAGE'S CONTROLS. "go on" and the lone ◂ 1 / 1 ▸ are taken off
     * every page but the newest when a page lands (settleLastPageControls) — so with the newest page let go here (its
     * node simply removed), the page before it stood as the newest with neither: no way to tell it again or go on from
     * it until the thread was next drawn whole. It is drawn again, as the newest. */
    /* (M675, the second reading: only when the page let go WAS the newest — any storyteller page let go drew the newest
     * one again, for nothing; and never over an editor standing open on it — rerenderMessage) */
    if (gone && gone.role === 'assistant' && !visBefore.slice(kGone + 1).some((m) => m && m.role === 'assistant')) {
      try { const lastNow = [...visiblePages(await db.messages.list(story.id))].reverse().find((m) => m.role === 'assistant'); if (lastNow) await rerenderMessage(story.id, lastNow.id); } catch (err) { /* the next draw of the thread shows them */ }
    }
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
    } else if (act === 'read again') {
      rereadPage(id);
    }
  });

  /* M113: READ AGAIN — the readers run over this page by hand. The last page:
   * the ledger rewinds to its boundary and the chain runs (what an edit does).
   * An older page: the journal folds to the page before it, the page is read
   * fresh, and every later page's writes replay above it (M72's replay). Its
   * record line is let go and refolded from the page's words. Off the send
   * path; the workers' line says what landed. */
  async function rereadPage(id, { quiet = false } = {}) {
    if (busy) return;
    /* M577 (the audit): "read again" waits for a rebuild in progress, as every other action does — its rewind bumps the
     * chain, and a replay's last step that finds the chain bumped stands down without putting the later pages' readings
     * back (an older page edited, then "read again" pressed on the newest: those pages' effects were lost) */
    if (!(await waitForRebuild())) return;
    const story = await activeStory();
    if (!story || busy) return;
    const history = await db.messages.list(story.id);
    const msg = history.find((m) => m && m.id === id);
    if (!msg || msg.role !== 'assistant' || msg.ooc) return;
    const vis = visiblePages(history);
    const k = vis.findIndex((m) => m.id === id);
    if (k !== -1 && (await keeperOnFor(story))) await saveMemory(story.id, memoryWithoutPage(await loadMemory(story.id), k)); /* M675: only where a keeper will fold it again */
    const isLast = !history.slice(history.indexOf(msg) + 1).some((m) => m && m.role === 'assistant' && !m.hidden);
    if (isLast) {
      const before = history.slice(0, history.indexOf(msg));
      const lastUser = [...before].reverse().find((m) => m && m.role === 'user');
      const boundary = boundaryFor(history, msg.id);
      if (boundary) await rewindTo(story, history, boundary.id);
      startBackgroundWork(story, msg, lastUser ? pageText(lastUser) : '');
    } else {
      replayFrom(story, msg.id, { changed: true });
    }
    if (!quiet) toast('The readers are on this page again.');
  }

  /* ---------- story panel (mobile slide-over) ---------- */

  /* B3: the scrim belongs to the narrow (slide-over) mode only. On a wide
   * screen the panel sits in the flow — no scrim over the story. */
  function isNarrow() {
    return window.matchMedia('(max-width: 899px)').matches;
  }

  let panelPlaceHandle = null;
  /* M105/M109: the shelf can be dragged wider — a handle on its right edge, the
   * width remembered (storyPanelWidth). */
  (function panelResize() {
    if (!els.panel) return;
    /* M109: the handle lives OUTSIDE the shelf. Inside it (M105) the shelf's
     * own overflow clipped and scrolled it, and a finger could not find it —
     * the writer asked twice. Now it is fixed to the shelf's right edge,
     * placed from the shelf's rectangle whenever that can change, with
     * touch-action none so the browser never takes the drag for a scroll. */
    const handle = document.createElement('div');
    handle.className = 'panel-resize';
    handle.setAttribute('aria-hidden', 'true');
    handle.title = 'Drag to widen the shelf; double-tap to put it back';
    document.body.appendChild(handle);
    const limits = () => ({ min: 220, max: Math.floor(window.innerWidth * (isNarrow() ? 0.92 : 0.5)) });
    const place = () => {
      const r = els.panel.getBoundingClientRect();
      const shown = r.width > 0 && r.right > 8 && (!isNarrow() || els.panel.classList.contains('open'));
      handle.hidden = !shown;
      if (!shown) return;
      handle.style.left = Math.round(r.right - handle.offsetWidth / 2) + 'px';
      handle.style.top = Math.round(r.top) + 'px';
      handle.style.height = Math.round(r.height) + 'px';
    };
    const applyWidth = (w) => {
      const { min, max } = limits();
      const width = Math.min(max, Math.max(min, Math.round(w)));
      els.panel.style.width = width + 'px';
      els.panel.style.maxWidth = 'none';
      place();
      return width;
    };
    db.settings.get('storyPanelWidth').then((w) => { if (Number.isFinite(w) && w > 0) applyWidth(w); place(); }).catch(place);
    let dragging = false;
    let startX = 0;
    let startW = 0;
    const move = (e) => {
      if (!dragging) return;
      const x = e.touches ? e.touches[0].clientX : e.clientX;
      applyWidth(startW + (x - startX));
      e.preventDefault();
    };
    const end = async () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('panel-resizing');
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', end);
      window.removeEventListener('touchmove', move); window.removeEventListener('touchend', end); window.removeEventListener('touchcancel', end);
      const w = parseInt(els.panel.style.width, 10);
      if (Number.isFinite(w)) await db.settings.set('storyPanelWidth', w).catch(() => {});
    };
    const start = (e) => {
      dragging = true;
      startX = e.touches ? e.touches[0].clientX : e.clientX;
      startW = els.panel.getBoundingClientRect().width;
      document.body.classList.add('panel-resizing');
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
      window.addEventListener('touchmove', move, { passive: false }); window.addEventListener('touchend', end); window.addEventListener('touchcancel', end);
      e.preventDefault();
    };
    handle.addEventListener('mousedown', start);
    handle.addEventListener('touchstart', start, { passive: false });
    handle.addEventListener('dblclick', async () => { els.panel.style.width = ''; els.panel.style.maxWidth = ''; await db.settings.delete('storyPanelWidth').catch(() => {}); place(); });
    window.addEventListener('resize', place);
    /* the shelf slides open and shut on a phone; the handle follows */
    if (typeof MutationObserver === 'function') new MutationObserver(() => setTimeout(place, 260)).observe(els.panel, { attributes: true, attributeFilter: ['class', 'style'] });
    else els.panel.addEventListener('transitionend', place);
    setTimeout(place, 0);
    panelPlaceHandle = place;
  })();

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
    if (busy) return;
    /* M675: A FILE IS SENT WITH NO WORDS OF HIS — the page is the file, under its name (M668 wrote the page that way;
     * this guard never let it be sent, and said nothing). A picture alone still needs a word to go with: said, not
     * left as a button that answers nothing. */
    if (!text && !pendingFile) {
      if (pendingImage) showComposerNote('Add a few words to go with the picture \u2014 it rides with a message of yours.');
      return;
    }
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

  /* M668: THE TOP BAR, HIDDEN AND BROUGHT BACK. One switch (kept: it is hidden again when he comes back); the small
   * button that brings it back wears the ledger button's light, whatever it shows, with its words. */
  const setImmersed = (on, keep = true) => {
    document.body.classList.toggle('immersed', Boolean(on));
    if (els.btnImmerseShow) els.btnImmerseShow.hidden = !on;
    if (keep) db.settings.set('immersed', Boolean(on)).catch(() => {});
  };
  if (els.btnImmerse) els.btnImmerse.addEventListener('click', () => setImmersed(true));
  if (els.btnImmerseShow) els.btnImmerseShow.addEventListener('click', () => setImmersed(false));
  db.settings.get('immersed').then((on) => { if (on === true) setImmersed(true, false); }).catch(() => {});
  function mirrorLamp() {
    const lamp = document.getElementById('btn-ledger');
    const tiny = document.getElementById('btn-immerse-show');
    if (!lamp || !tiny) return;
    for (const c of ['is-working', 'has-trouble', 'all-well', 'is-waiting', 'is-auditing']) tiny.classList.toggle(c, lamp.classList.contains(c)); /* M673: and the audit's own light */
    const says = lamp.getAttribute('title') || '';
    tiny.setAttribute('title', 'Show the top bar' + (says ? ' — ' + says : ''));
  }
  {
    /* whenever the ledger button's light or its words change, by whatever hand */
    const lamp = document.getElementById('btn-ledger');
    const Observer = typeof MutationObserver === 'function' ? MutationObserver : (document.defaultView && document.defaultView.MutationObserver);
    if (lamp && typeof Observer === 'function') new Observer(mirrorLamp).observe(lamp, { attributes: true, attributeFilter: ['class', 'title'] });
    mirrorLamp();
  }
  /* The "no connection yet" empty state: one tap to the settings floor. */
  if (els.btnAddFirstConnection) {
    els.btnAddFirstConnection.addEventListener('click', () => {
      location.hash = '#/settings';
      const target = document.getElementById('section-connections');
      const nav = document.getElementById('settings-quicknav');
      if (nav && typeof nav.openRoomFor === 'function') nav.openRoomFor('section-connections');
      if (target) setTimeout(() => target.scrollIntoView({ block: 'start' }), 80);
    });
  }

  els.btnNew.addEventListener('click', () => openNewStoryForm(null));

  els.btnCancelNew.addEventListener('click', () => {
    els.newForm.hidden = true;
  });

  els.newForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    /* M16: the tale may begin already resting on a shelf. M662: the shelf whose + he pressed — never one that is gone or resting */
    const shelfId = newStoryShelf && projects.some((p) => p.id === newStoryShelf && p.archived !== true) ? newStoryShelf : '';
    newStoryShelf = null;
    const story = await db.stories.create({ title: els.newTitle.value, projectId: shelfId || undefined });
    if ((await db.settings.get('briefModeNew')) === 'automatic') { await db.stories.update(story.id, { briefMode: 'automatic' }); story.briefMode = 'automatic'; } /* M517: new stories start as he chose */
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
  /* M621: bulk delete */
  if (els.btnBulkDelete) els.btnBulkDelete.addEventListener('click', () => setChoosing(true, 'delete'));
  /* M630: bulk move, and a giant project */
  if (els.btnBulkMove) els.btnBulkMove.addEventListener('click', () => setChoosing(true, 'move'));
  if (els.chooseMove) els.chooseMove.addEventListener('change', () => { const v = els.chooseMove.value; if (v) moveChosen(v).catch((err) => toast('The move stopped: ' + (err && err.message ? err.message : String(err)))).finally(() => { if (els.chooseMove) els.chooseMove.value = ''; }); });
  if (els.btnNewGiant) els.btnNewGiant.addEventListener('click', () => { els.newGiantForm.hidden = false; els.newGiantName.value = ''; els.newGiantName.focus(); });
  if (els.btnCancelGiant) els.btnCancelGiant.addEventListener('click', () => { els.newGiantForm.hidden = true; });
  if (els.newGiantForm) els.newGiantForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const giant = await db.giants.create({ name: els.newGiantName.value });
    els.newGiantForm.hidden = true;
    await refreshStories(true);
    toast(`"${giant.name}" stands — "Bulk move" puts shelves in it.`);
  });
  if (els.btnChooseDone) els.btnChooseDone.addEventListener('click', () => setChoosing(false));
  if (els.btnDeleteChosen) els.btnDeleteChosen.addEventListener('click', () => { deleteChosen().catch((err) => toast('The delete stopped: ' + (err && err.message ? err.message : String(err)))); });

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

  /* M386: THE REAL RECORD, FOR THE WORKERS TOLD TO WRITE FROM IT. The scribe, the world agent and the auditor are told a
   * canon character is written from the real record — and were never handed it. What the series says of the canon
   * people in this ledger (who they are, family and ties, the facts), from the story's own canon memory; nothing when
   * canon verification is off or nobody here is canon. */
  async function canonRecordOf(story) {
    try {
      if (!story || !(await canonOn(story.id))) return '';
      const st = await loadState(story.id);
      const names = [...(Array.isArray(st.present) ? st.present : []).map((p) => (typeof p === 'string' ? p : p && p.name)), ...Object.keys(st.characters || {})].filter(Boolean);
      return canonRecordFor(await canonMeta(story.id), names, { premise: await canonPremise(story) }); /* M392: only what holds in his story */
    } catch (err) { return ''; }
  }

  /* M386: canon verification's own levers for the open story — the ledger room and Settings call these. The extension's
   * functions run with this story as its chat: its pages, its ledger, the canon worker's connection (the same one its
   * turn uses). Nothing when no story is open. */
  async function canonAct(action, arg) {
    const story = await activeStory();
    if (!story) return null;
    const connection = await resolveWorkerConnection(story, 'canon');
    return canonAction({ story, state: await loadState(story.id), messages: await db.messages.list(story.id), connection }, action, arg);
  }
  async function canonTest() {
    const story = await activeStory();
    if (!story) return { ok: false, ms: 0, error: 'open a story first — the test asks through its worker connection' };
    const connection = await resolveWorkerConnection(story, 'canon');
    if (!connection) return { ok: false, ms: 0, error: 'no connection to ask' };
    return canonSelfTest({ story, state: await loadState(story.id), messages: await db.messages.list(story.id), connection });
  }

  /* M633: the readers' own connection — the benchmark's judge when he ticked none */
  ctx.readersConnection = async () => resolveWorkerConnection((await activeStory()) || {}, 'continuity');
  ctx.chat = {
    openStory, /* M189: so a fetch-on-open can be exercised by a test */
    jumpToPage, /* M622: a search hit opens its tale at its page */
    canonAct, /* M386 */
    canonTest, /* M386 */
    isBusy: () => Boolean(busy),
    choicesChanged: async () => { const st = await activeStory(); if (st) offerChoices(st); await drawChoices(); }, /* M548: Settings → Choices matter */
    /* M673: Settings → Continuous audit. Off: a reading in flight is let go. Either way the light looks again (on, it sends the first reading). */
    continuousAuditChanged: async () => { const id = ctx.getActiveStoryId(); if (!id) return; if (!(await continuousAuditOn())) pauseContinuousAudit(id); markLedgerTrouble(id); },
    isReplaying,
    repairTimeline,
    taleOpened, /* M675 */
    rescanLedger,
    auditNow,
    weighCast, /* M474 */
    mendAllPages, /* M477 */
    rerenderMessage, /* M483: the walk proves a re-ink keeps the page's number */
    briefFromConcept, /* M478/M479 */
    rippleAfterEdit,
    refreshQuickSwitch, /* M510: Settings tells the main screen when a storyteller or a connection changes */
    checkSensors, /* M638: Settings' "Check the sensors" */
    useConnection, /* M510-8: the one model choice — the Quick switch, Settings' picker and "Use this one" */
    planAhead, /* M510: Settings hands a tale to a small model → the helper reads ahead */
    pageReinked, /* M296 */
    resumeUnfinishedChain,
    showTopBar: () => setImmersed(false, false), /* M675: "Reset every setting" brings the top bar back (the setting itself is the reset's to delete) */
    healLedgerOnOpen, /* M452 */
    foundNow,
    rebuildStandingsNow,
    redoRecordLine,
    summarizeNow,
    rebuildRecordNow,
    rebuildPeopleNow,
    restoreRecordNow,
    restorePeopleNow,
    unmend,
    remakeEssentials, /* final audit */
    remakeGround, /* M517 */
    renderPromptChips,
    refreshStories,
    renderThread,
    continueTurn,
  };
}
