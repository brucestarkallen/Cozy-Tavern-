/* Cozy Tavern — assemble/stack.js
 * The full ten-slot, cache-aware assembler. M2 replaces the M1 minimal
 * internals; the export name `buildRequest` (and the starter texts, which
 * the settings view imports) stay put.
 *
 * Contract (SPEC.md M2, extended by M6, M7 and M9):
 *   buildRequest({story, messages, settings, state, modules, memory,
 *                 cast, lore, loreFired, window, directive})
 *     -> { systemBlocks:[{text, cache:true|false}], messages:[...],
 *          receipt:ReceiptDraft }
 *   `modules` is the already-selected list from modules.selectModules():
 *   [{mod, reason}] — core-craft is always among them. `memory` is slot 7's
 *   text: what the keeper has folded of the older pages (agents/memory.js
 *   renderMemory), or '' when nothing has been remembered yet. M7: `cast`
 *   is the story's invited cast (import/cards.js castForStory — full Card
 *   objects), and `lore` is the lore shelf's answer for the latest pages
 *   (import/lorebook.js matchLore), or '' when no keys spoke. M9:
 *   `loreFired` names the entries that woke (receipt slot 7 says their
 *   names out loud); `directive` is a parsed house command's instruction
 *   (commands.js) riding just before the note; and `window` is the M9
 *   window law below. M10: `directorNote` and `editorEye` are the
 *   showrunners' standing texts (agents/director.js renderDirectorNote,
 *   agents/editor.js renderEditorNote) — each rides the dynamic tail as
 *   its own receipt-named slot ("The director's note" / "The editor's
 *   eye"), still before history; empty means the slot is omitted.
 *
 * The slot order is law — never reorder:
 *   1. The frame            (story override → global → starter)   cache:true
 *   2. The craft            (the core-craft module text)          cache:true
 *   3. The brief            (story.brief || '')                   cache:false
 *   4. Who's here           (cast notes + state.present names
 *                            + attached-present cards, budgeted)  cache:false
 *   5. The state of things  (renderStateFacts(state); omit if '') cache:false
 *   6. Active modules       (non-core selected modules)           cache:false
 *   7. What remains         (memory nodes; M6 — omitted when none;
 *                            then lore hits, M7, shared budget)
 *   8. The story so far     — the verbatim window ONLY (M9, A1)
 *   9. The note at the end  (override → global → starter; LAST message)
 *  10. The continue nudge   — only when the last user message is
 *                             empty/continue ("Go on.")
 *
 * The window law (M9, A1): slot 8 sends ONLY the verbatim window. Hidden
 * pages (the continue nudge's "Go on.") never join it. With the keeper ON,
 * the window is the story's memory window (memory.window, default 30
 * messages) — older pages exist ONLY as summary nodes in slot 7. With the
 * keeper OFF, the window is the last N pages that fit the connection's
 * estimated context budget minus the assembled prefix (estimateTokens), and
 * the receipt names the cutoff honestly ("42 pages carried word for word,
 * the rest rests"). Receipt slots 7/8 report counts.
 *
 * How slots map onto the wire (provider semantics kept simple):
 *   - Slots 1–4 join into systemBlocks. Anthropic sends them as an array
 *     with cache_control on the last cache:true block; OpenAI concatenates
 *     the cache:true blocks into one LEADING system message and lets the
 *     cache:false blocks follow as separate system messages. Empty slot
 *     texts are left out of the blocks but still appear on the receipt
 *     (0 tokens).
 *   - The cache breakpoint (M9, A4): cache_control sits on the END of
 *     slot 2 (The craft) — the frame and the craft are the stable prefix.
 *     Slots 3–4 are separate NON-cached blocks (the brief and Who's here
 *     drift with the scene; caching them would poison the prefix).
 *   - Slots 5–6 prepend as ONE user-role message marked [story-state] at
 *     the FRONT of the messages array — dynamic text is never system on the
 *     openai mapping, so the stable system prefix stays byte-for-byte. Slot
 *     7, when memory exists, rides inside that same injection after the
 *     active modules (its order in the stack, and still before history).
 *   - Slot 8 follows as plain {role, content} history — the window only.
 *   - Slot 10, when it fires, sits just before the note; a `directive`
 *     (M9, a parsed house command) rides there too; slot 9 is always the
 *     LAST message. (When the note is empty and the nudge fires, the
 *     nudge is last — there is no note to keep last.)
 *   - Slot 7 appears on the receipt ONLY when something rides it (M6 law,
 *     widened in M7): memory nodes and lore hits are listed as separate
 *     sub-parts when present, sharing the one 3200-char budget — memory
 *     first, lore in the room that's left. M9: the lore line names the
 *     entries that fired.
 *
 * M7 budgets: slot 4 stays within 1600 chars (the cast notes and who's
 * present keep their seats; invited cards join while there's room, their
 * descriptions trimmed to 400 chars each; M9 adds their personality and
 * scenario lines, 300 chars each, while room remains). Slot 7's combined
 * memory + lore stays within the keeper's 3200-char budget
 * (agents/memory.js SLOT_BUDGET).
 *
 * M11: when the referee has ruled (state.pendingVerdict), its directive
 * rides the dynamic tail as the receipt-named slot "The house has ruled"
 * (the `ruling` argument — the last tail part, closest to the history it
 * governs). The send path clears the verdict after this build
 * (consume-and-clear; see chat.js).
 *
 * Token estimate per slot = ceil(chars/4) (see assemble/receipt.js).
 */

import { relevantPeople } from '../engine/relevance.js';
import { recordId, uniqueRecords, selectWhole, requestSelection, historicalPassages, boundRecord, messageVersion } from './selection.js';
import { requestTokens, contentTokens, inputRoom, refusalRoom, ANSWER_RESERVE, CONTEXT_MARGIN, UNKNOWN_IMAGE_ALLOWANCE } from './budget.js';
import { shownText } from '../engine/pagepatch.js'; /* M576 */
import { renderStanding, standingPlans, selectStanding } from './planbook.js'; /* M510-22 */
import { estimateTokens } from './receipt.js';
import { renderStateFacts, stateView } from '../engine/state.js';
import { sceneAnchor, recallFromRecord, recallLine, recallFromPages, recallPagesLine } from './anchor.js'; /* M343, M344; M510-13 */
import { shortcutsText, attachedPart, typedWords } from '../commands.js'; /* M379; M675: a file attached to a shortcut; his own words, read back out of a page that carries one */
import { mcName as mcNameOf } from '../engine/duels.js'; /* M344: the main character's name never scores a recall */
import { withoutAuthorshipFrame, CRAFT_TEXT } from './craft.js'; /* M309; M345: today's line about a settled outcome */
import { outcomeWords } from '../agents/choices.js'; /* M548: Choices matter — what the storyteller is told */
import { voiceOf, inVoice, toTeller, briefingOpening, notebookOpening, personOf, inPerson, naturalThinking, eyeWithoutRuleNames, thinkOnPageLine, groundingWeave, withCardNames, tellerHasSelf } from './voice.js'; /* M327: the two names; M334: the person the teller thinks in */
import { renderPeopleTiers, peopleView, findPersonKey, PEOPLE_BUDGET, PRESENT_CARDS_MAX, RECALL_MAX } from '../engine/people.js';
import { wornPhrases, calmPage } from './smallprose.js'; /* M512: the turns of phrase the last pages keep using; M519: the loud pages eased in the copy it reads */
import { canonOffPages } from './canonpages.js'; /* M518: canon on their own page — the note goes quiet on what the cards carry */
import { lawsOf, lawsNamed, joinLaws, lawKey, ALWAYS_LAWS, PROSE_LAWS, PEOPLE_LAWS, SOUND_LAWS, LOAD_BEARING, FIGHT_LAWS, typedCombat } from './laws.js'; /* M510: his craft, law by law */
import { renderPlan, renderSounds, breathWords, talkWords } from './planwords.js'; /* M510: the planning helper's plan, in his voice */
import { SLOT_BUDGET as SLOT7_BUDGET } from '../agents/memory.js';
const LORE_BUDGET = 3000; /* M34: the lore shelf's own room in slot 7 */

/* M87: the starter frame no longer lays a house register ("slowly and by
 * lamplight", "plain warm sentences") over every tale — the brief and the
 * cast set the register, the craft is the discipline, and the frame says only
 * what the storyteller IS. A writer's own frame (Settings → The frame, or a
 * story's override) still outranks this, as it always did. */
export const STARTER_FRAME = [
  'You are telling a story with one person — the writer — as their storyteller: an unbiased',
  'cinematographer running a fictional, uncensored simulation. The brief and the cast set the',
  'world and its register; the craft that follows is your own working discipline. Prose is',
  'grounded, concrete and literal, in the voice the brief establishes — never a house style',
  'laid over it. Write the scene: never summarize your instructions, never break the fourth',
  'wall, never offer menus of options. Leave room for the other writer; end each turn where',
  'they can answer.',
].join('\n');

export const STARTER_NOTE = [
  'Before you write: reread the last few exchanges. Keep the scene grounded',
  'in what has already happened, and end where the other writer has something',
  'to respond to.',
].join('\n');

export const CONTINUE_NUDGE = 'Go on.';

/* M466: WORDS IN THE STORYTELLER'S OWN VOICE — SillyTavern's prompt-manager entries with a role and a place, kept for
 * the day he needs them (Settings → Storyteller → "Words in the storyteller's own voice"). Each entry has a switch, a
 * name, whose words they are (the storyteller's = an assistant message, his = a user message, the house's = a system
 * message), where they ride (three landmarks of the request, never a drag), and the words. {{teller}} and {{you}} are
 * the two names from The frame. Off, or empty: not one byte of any request changes. */
/* M466-2: said in the words of his own map of the request — "the notes" read as the note at the end, and it is not */
export const OWN_WORDS_PLACES = {
  'before-pages': 'after the ledger’s briefing (the tracker) — before the first story page',
  'before-your-message': 'after the newest story page — right before your message',
  'after-your-message': 'after your message — before the note at the end',
};
export function ownWordsFor(settings, voice) {
  const list = Array.isArray(settings && settings.ownWords) ? settings.ownWords : [];
  const out = [];
  for (const w of list) {
    if (!w || typeof w !== 'object' || w.on === false) continue;
    const text = String(w.text == null ? '' : w.text)
      .replace(/\{\{\s*teller\s*\}\}/gi, (voice && voice.teller) || 'the storyteller')
      .replace(/\{\{\s*you\s*\}\}/gi, (voice && voice.writer) || 'you')
      .trim();
    if (!text) continue;
    const role = w.role === 'you' ? 'user' : (w.role === 'house' ? 'system' : 'assistant');
    const place = Object.prototype.hasOwnProperty.call(OWN_WORDS_PLACES, w.place) ? w.place : 'after-your-message';
    out.push({ name: String(w.name || '').trim() || 'Own words', role, place, text });
  }
  return out;
}

/* M21: the frame's purpose, spoken after it (Settings → The frame). On by
 * default — the line tells the storyteller what the frame IS, so the house
 * rules of the telling outrank anything said inside the story. The writer
 * may rewrite the line or switch it off; "say it again at the end" repeats
 * the whole frame (purpose included when it's on) just before the note —
 * the anchor against long-context fade. */

/* M321: SAID, NOT TAGGED. The briefing opened with a bare bracket tag, "[story-state]" — the one real tag the
 * storyteller was ever sent, and exactly the kind of thing a model stops to puzzle over. It opens in
 * plain words now: whose notes these are, what they are for, and that none of it is the story's text
 * (which is all the tag was for — so the briefing is never mistaken for a page and echoed). Exported:
 * anything that must recognise the briefing asks for this, never for a literal. */
export { STORY_BEGINS } from '../providers/userfirst.js'; /* M510-38: the line lives with the providers that add it */
export const STATE_MARKER = 'Where things stand right now — the writer’s own notes, kept for him by his story app. They are for you alone: none of this is the story’s text, and none of it is ever quoted or mentioned on the page.';

/* M7 budgets (see header): slot 4's whole section, and each invited card's
 * description within it. M9 adds personality/scenario lines, 300 chars each,
 * while room remains. */
/* M29: a present character rides WHOLE. The old 400-char trim turned a
 * 2,000-char card into a name and a sentence — the storyteller was handed
 * less about a present person than the writer had written. Rules shrink;
 * the world the storyteller sees does not. */
const SLOT4_BUDGET = 9000;
/* M283: the characters a slot may hold in the storyteller's room (a twelfth of
 * it, as characters); 0 when the room is unknown. */
function roomChars(windowInfo) {
  const t = windowInfo && Number.isFinite(windowInfo.budgetTokens) && windowInfo.budgetTokens > 0 ? windowInfo.budgetTokens : 0;
  return Math.floor(t * 3 / 12);
}
/* a text held to a length, let go at the end of its last whole line (a word, if no line fits) */
function atLine(text, max) {
  const s = String(text || '');
  if (s.length <= max) return s;
  const head = s.slice(0, Math.max(0, max - 1));
  const nl = head.lastIndexOf('\n');
  const cut = nl > max * 0.5 ? head.slice(0, nl) : head.slice(0, Math.max(head.lastIndexOf(' '), 0) || head.length);
  return cut.trimEnd() + '…';
}
const SLOT4_CARD_DESCRIPTION = 2400;
const SLOT4_CARD_DETAIL = 900;

/* The window law (M9, A1): with the keeper ON, slot 8 carries only the last
 * `window` pages; older pages exist ONLY as summary nodes in slot 7. With
 * the keeper OFF, only the last pages that fit the connection's estimated
 * context budget minus the assembled prefix travel, and the receipt names
 * the cutoff honestly. */
export const DEFAULT_WINDOW = 30;

export function keeperWindow(memory) {
  const w = memory && Number.isFinite(memory.window) && memory.window > 0
    ? Math.floor(memory.window)
    : DEFAULT_WINDOW;
  return Math.max(2, w);
}

/* The text the wire and the thread agree on: the shown swipe when a page
 * has versions, else the plain text. Exported for the harness. */
export function pageText(msg) { return shownText(msg); } /* M576: the one rule (engine/pagepatch.js) */

const typedOf = (m) => (m && typeof m.typed === 'string' && m.typed.trim() ? m.typed.trim() : '');

/* The pages that may travel on the wire: user/assistant, never hidden — a
 * hidden "Go on." lives in the store for the audit and fires the nudge, but
 * never sits in the story-so-far. Exported for the harness. */
export function wireable(messages, pageFilter) {
  const filter = typeof pageFilter === 'function' ? pageFilter : null;
  const list = (messages || [])
    /* M379: a shortcut travels as he TYPED it ("#p", "#story a lighthouse keeper", "#continue") — even one the thread
     * keeps hidden — because its meaning now lives in the standing words, not in a second message */
    .filter((m) => m && (!m.hidden || typedOf(m)) && (m.role === 'user' || m.role === 'assistant'));
  /* M27: a picture rides the wire only on its own page's turn — later turns
   * carry a quiet note instead, so a gallery never becomes a tax. */
  let lastUserId = null;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i].role === 'user') { lastUserId = list[i].id; break; }
  }
  const sourceOrdinals = new Map((messages || []).filter(m => m && !m.hidden).map((m,i) => [m.id,i]));
  return list.map((m) => {
    /* M30: wire-mode regex rules shape only what rides the wire. */
    /* M675: A FILE ATTACHED TO A SHORTCUT TRAVELS WITH IT. A page of his that is a shortcut travels as its `typed` words —
     * and a text file he attached (M668) is only in the page's own words: "#story a tale from this outline" with
     * outline.md attached reached the storyteller as that one line, on its turn and on every turn after, while the
     * chip had said "sent with your next page" and the thread showed the file (the audit of M674; any shortcut, a
     * #question or an aside alike). The file's part of the page rides after what he typed — for the pages already
     * kept that way too, since it is read here, where the request is made. */
    const typed = m.role === 'user' ? typedOf(m) : '';
    const file = typed ? attachedPart(pageText(m)) : '';
    const said = typed ? (file && !typed.includes(file) ? typed + '\n\n' + file : typed) : pageText(m);
    const content = filter ? filter(said, m.role) : said;
    const out = { role: m.role, content, id: m.id, sourceOrdinal: sourceOrdinals.get(m.id) ?? null, transformed: content !== said };
    if (m.image && m.image.dataUrl) {
      if (m.id === lastUserId) {
        out.image = m.image;
      } else if (!out.content.includes('[a picture was shared here]')) {
        out.content = (out.content ? out.content + ' ' : '') + '[a picture was shared here]';
      }
    }
    return out;
  });
}

/* M12: the coverage law. Slot 8 may never let a page fall that no summary
 * node holds. `coveredUntil` walks the nodes' spans from the top of the
 * thread and returns one past the last page of the contiguous covered
 * prefix — pages before that mark rest in What remains; pages at or after
 * it must ride the window word for word, even when that means the window
 * reaches further back than its usual size (the keeper hasn't folded them
 * yet — say, after a quiet stretch or a stumbled worker). */
export function coveredUntil(nodes) {
  const spans = (Array.isArray(nodes) ? nodes : [])
    .filter((n) => n && Array.isArray(n.span) && n.span.length === 2)
    .map((n) => [Number(n.span[0]) || 0, Number(n.span[1]) || 0])
    .sort((a, b) => a[0] - b[0]);
  let reach = 0;
  for (const [from, to] of spans) {
    if (from <= reach && to + 1 > reach) reach = to + 1;
  }
  return reach;
}

/* The window decision, as a pure function for the harness (M9, A1).
 *   windowPlan({pages, memory, budgetTokens, prefixTokens})
 *     -> {mode:'keeper'|'budget', window, total, carried, resting, extended}
 * pages         — the full wireable history (already filtered)
 * memory        — null when the keeper is OFF for this story; when it
 *                 carries a `nodes` array, the coverage law (above) applies
 * budgetTokens  — the connection's estimated context room (keeper-off only)
 * prefixTokens  — what slots 1–7, 9 and 10 already spent (keeper-off only)
 * cost          — M752: what one page costs, in the same measure as the room and the prefix (default: the receipt's
 *                 four characters a token; buildRequest hands the final fit's own measure) */
const receiptCost = (m) => estimateTokens(pageText(m));
export function windowPlan({ pages, memory, budgetTokens, prefixTokens, cost: pageCostOf = receiptCost, keepFrom } = {}) {
  const all = Array.isArray(pages) ? pages : [];
  const total = all.length;
  if (!memory) {
    const room = Number.isFinite(budgetTokens) && budgetTokens > 0
      ? Math.max(0, budgetTokens - (Number.isFinite(prefixTokens) ? prefixTokens : 0))
      : 0;
    let used = 0;
    let start = total;
    while (start > 0) {
      const cost = pageCostOf(all[start - 1]);
      if (used + cost > room) break;
      used += cost;
      start -= 1;
    }
    /* M162: THE WINDOW IS NEVER EMPTY. With the keeper off and a small
     * context set on the connection, the prefix alone could eat the whole
     * room — `room` came out 0, no page fitted, and the storyteller was sent
     * the state block and NOT ONE LINE OF THE STORY. It wrote into the void
     * and the page came back belonging to nothing. The last exchange always
     * rides, whatever the arithmetic says; the receipt names the squeeze. */
    /* M752: and the latest exchange is what rides, whatever shape it takes — from the storyteller's latest page when an aside
     * of his stands between it and his move (buildRequest's keepFrom); the last two pages otherwise */
    const floor = Math.max(0, Math.min(total - 2, Number.isInteger(keepFrom) ? keepFrom : total - 2));
    const squeezed = start > floor;
    if (squeezed) start = floor;
    return {
      mode: 'budget',
      window: all.slice(start),
      total,
      carried: total - start,
      resting: start,
      extended: 0,
      squeezed,
    };
  }
  const windowSize = keeperWindow(memory);
  let start = Math.max(0, total - windowSize);
  /* The coverage law (M12): never drop a page no summary node covers. Only
   * computable when the caller hands the nodes over; without them the M9
   * assumption stands (the keeper has folded everything older). */
  let extended = 0;
  let uncovered = 0;
  if (Array.isArray(memory.nodes)) {
    const sourceReach = coveredUntil(memory.nodes);
    const mappedReach = all.findIndex((m,i) => (Number.isInteger(m.sourceOrdinal) ? m.sourceOrdinal : i) >= sourceReach);
    const reach = mappedReach < 0 ? all.length : mappedReach;
    if (reach < start) {
      /* M162: AS FAR BACK AS THE ROOM ALLOWS, NEVER FURTHER. M12 wrote this
       * law with no ceiling, and it had never once run (the nodes were never
       * handed over). Switched on as written, a keeper that stalls — its
       * worker connection down for a long stretch — would put EVERY unfolded
       * page on the wire: on a six-hundred-page tale, the whole story, every
       * turn. The law still holds where the room holds it; what will not fit
       * is named on the receipt as pages no line covers, and the keeper
       * refills them holes-first as soon as it can speak again. */
      const room = Number.isFinite(budgetTokens) && budgetTokens > 0
        ? Math.max(0, budgetTokens - (Number.isFinite(prefixTokens) ? prefixTokens : 0))
        : Infinity;
      let used = 0;
      for (let i = start; i < total; i += 1) used += pageCostOf(all[i]);
      let at = start;
      while (at > reach) {
        const cost = pageCostOf(all[at - 1]);
        if (used + cost > room) break;
        used += cost;
        at -= 1;
      }
      extended = start - at;
      uncovered = at - reach;
      start = at;
    }
  }
  const window = all.slice(start);
  return {
    mode: 'keeper',
    window,
    total,
    carried: window.length,
    resting: start,
    extended,
    uncovered,
  };
}

/* A present name and a card's name meet case-insensitively, with any
 * "(she/her)"-style parenthetical aside ignored — the same normalization
 * the acoustics predicate uses (modules.js). */
function bareName(raw) {
  return String(raw || '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function pickText(storyOverride, globalText, starter) {
  if (typeof storyOverride === 'string' && storyOverride.trim()) {
    return { text: storyOverride, source: 'just for this story' };
  }
  if (typeof globalText === 'string' && globalText.trim()) {
    return { text: globalText, source: 'for every story' };
  }
  return { text: starter, source: 'the starter text' };
}

/* The note resolves differently from the frame: once the user has touched
 * the global note, their word stands — even if they cleared it to nothing.
 * Only an untouched note falls back to the shipped starter. A per-story
 * override wins whenever it holds real text. */
function resolveNote(storyOverride, globalText) {
  if (typeof storyOverride === 'string' && storyOverride.trim()) {
    return { text: storyOverride, source: 'just for this story' };
  }
  if (typeof globalText === 'string') {
    return { text: globalText, source: 'for every story' };
  }
  return { text: STARTER_NOTE, source: 'the starter text' };
}

/* M622: THE HOUSE'S THINKING NOTE — his: "add a default notes CoT … the best CoT but still fast, reminds about the
 * instructions and still creative".
 * M624: REWRITTEN FROM HIS OWN PRESET — his: "are you designing the CoT on the whole instructions and my own preset, or
 * just parroting me and copying the internet? Does 'let someone interrupt' force everyone always to interrupt?" The first
 * one was written from general practice without reading his craft, and his craft already carries its own pre-write pass
 * (## The Pass: B — the beat, L — the last look). It duplicated that pass and contradicted it three times: it made an
 * NPC act EVERY page ("a quiet, textured turn is correct pacing; never manufacture one", "Hold Is Forbidden When" —
 * only whoever's core would act); it asked for a fresh detail (Unspent Material: the established serves before the new);
 * it had the state re-checked (the house already did S, C and W — "you do not redo them"). Now it is HIS pass, said at
 * the end of the request where it is heard best after a long story: the beat and the last look, in plain words, each
 * pointing at the law of his craft it keeps (by its own name), answered to itself in shorthand — never on the page, so
 * no written reasoning to wait for. {{user}} is his character's story name.
 * M631: HIS FAST PASS'S TRIGGERS, KEPT — his: "is the CoT literally the smartest and the best? Here are my old two" (the long
 * seven-task pass and the Fast Pass S/C/W/B/TRIGGERS/L). The craft's own Pass is the Fast Pass with S, C and W handed to
 * the house; it had folded the TRIGGERS line into the laws. Said again at the end, the TRIGGERS line comes back — one line
 * each, only what fires, so nothing runs that the page does not call for — with the dice left to the referee (the settled
 * outcome) and the trackers (PULSE, WATCHLIST, Plot Momentum) left out: Cozy's ledger and drawer are those. */
export const HOUSE_COT_ID = 'house-cot';
export const HOUSE_COT = `Before you write, run your pass to yourself — shorthand, a few words each, never on the page. The state, the cast and the world are already in the notes on where things stand: read them, never redo them.
B — the beat: what this turn is about, what it costs, where it stops — where the turn goes back to {{user}}: an NPC asks and waits, or acts with weight; one phase of a fight or of sex lands in full; an arrival lands. Not the last turn's shape again (Anti Repetition, Swap Test). Nothing at stake → a quiet, textured turn is the right pace; never manufacture one.
TRIGGERS — only what fires, one line each:
· someone here whose core would stop or help what {{user}} is doing → they reach for it, on the page (NPCs Can Interrupt MC);
· an attack on {{user}} that turns on a power or limit of his not yet shown → stop before contact — the reveal is his (Incoming Threshold, MC Capability Authorship);
· sex, a fight, an injury → the body's state carries and refuses what it must; a new stake is a new consent (Body Veto Root Rule, Escalation Resets Consent);
· a body on the page → its features verified against canon, never invented over it (Appearance Verification);
· a new person → made whole, from someone's life (NPC Creation);
· a line crossed for good → its vertigo, in that person's own terms (Line-Cross Vertigo);
· drift noticed → recolor going forward, never retcon (Drift Recovery).
L — the last look:
· the outcome matches the board — or the settled outcome above, exactly;
· no choice, word, thought or feeling of {{user}}'s is taken; {{user}}'s stated action reaches only its own immediate result (Intent Horizon);
· nobody acts on what they could not know — how does this one know it? (Information Quarantine);
· whoever here would oppose, refuse, flee or step in, by their own core, does it now — no one holds still for comfort — and the room keeps its own life;
· an intimate scene keeps the body's truth and the resolution floor (Intimacy);
· something already established serves before anything new is reached for (Unspent Material);
· your bans bind the words (Banned Constructs, Plain Prose, Sound as Onomatopoeia at every contact beat).
Then write the page.`;

/* M751: THE PASS SAID AGAIN, IN THE SAME VOICE AS THE CRAFT'S. The note is the craft's Pass said again at the end (M631); for a
 * teller with a self (a name, or a frame in the first person) the craft's own Pass asks for plain sentences in its own voice,
 * never shorthand or labels (M335, his: "the teller's thinking read like an auditor's") — and the note, the last thing it
 * reads, still said "shorthand". For such a teller the note asks what the craft asks; its checks are untouched. */
const HOUSE_PASS_SHORTHAND = 'run your pass to yourself — shorthand, a few words each, never on the page.';
const HOUSE_PASS_NATURAL = 'run your pass to yourself — briefly, in your own voice, a few plain words each, never on the page; never name a rule or a heading while you think.';
export function housePassFor(text, voice, person) {
  return text === HOUSE_COT && tellerHasSelf(voice, person) ? text.replace(HOUSE_PASS_SHORTHAND, HOUSE_PASS_NATURAL) : text;
}

/* M622: the house's thinking note stands in his list unless he has it already — first, on — so the notes he never touched
 * carry it, and a list he arranged keeps his order and his switch */
export function withHouseNote(list) {
  const arr = (Array.isArray(list) ? list : []).filter((n) => n && typeof n === 'object');
  if (arr.some((n) => n.id === HOUSE_COT_ID)) return arr;
  return [{ id: HOUSE_COT_ID, builtin: true, on: true, text: '' }, ...arr];
}

/* M620: the notes he added at the note at the end — the ones ticked on, with words, in the order he set them;
 * M622: the house's thinking note among them in the place he gave it, its own words unless he wrote his — and never on
 * an out-of-character turn (#question, ((…)), //…): it plans a page, and an answer to him out of the story is not one
 * (his own notes ride as his note does);
 * M623: each note stands ABOVE his note or BELOW it, and goes as a system message, a user message, or like the note at
 * the end ('' — the role "Sent after your message as" gives the closing words) */
export const NOTE_PLACES = ['above', 'below'];
export const NOTE_ROLES = ['', 'system', 'user'];
export function addedNotes(list, { ooc = false } = {}) {
  return withHouseNote(list)
    .filter((n) => !(ooc && n.id === HOUSE_COT_ID))
    .map((n) => (n.id === HOUSE_COT_ID && !(typeof n.text === 'string' && n.text.trim()) ? { ...n, text: HOUSE_COT } : n))
    .filter((n) => n && n.on !== false && typeof n.text === 'string' && n.text.trim())
    .map((n) => ({ text: n.text.trim(), place: n.place === 'below' ? 'below' : 'above', role: n.role === 'system' || n.role === 'user' ? n.role : '' }));
}

/* A turn counts as "just go on" when the last thing the other writer said
 * is empty, or a bare "continue". Only then does slot 10 speak. */
/* M675: is this turn the house's own "go on" (a hidden page with nothing of his in it) standing right after an
 * out-of-character message of his that got no answer? Then his message is not this turn's — see where the nudge is said. */
function goOnAfterAside(history) {
  const list = Array.isArray(history) ? history : [];
  let i = list.length - 1;
  while (i >= 0 && !(list[i] && list[i].role === 'user')) i -= 1;
  const turn = i >= 0 ? list[i] : null;
  if (!turn || !turn.hidden || typedOf(turn)) return false;
  for (let j = i - 1; j >= 0; j -= 1) {
    const m = list[j];
    if (!m || (m.hidden && !typedOf(m))) continue; /* an earlier nudge of the house's that never got its page */
    if (m.role !== 'user') return false; /* a page of the storyteller's stands between: "Go on." already follows it */
    return Boolean(m.ooc === true || /^\s*(?:#question|\(\(|\/\/)/.test(m.hidden ? typedOf(m) : typedWords(String(m.text || ''))));
  }
  return false;
}

function isContinueTurn(history) {
  const lastUser = [...history].reverse().find((m) => m && m.role === 'user');
  if (!lastUser) return false;
  const text = (typeof lastUser.text === 'string' ? lastUser.text : String(lastUser.content || '')).trim();
  return text === '' || /^(continue|go on|keep going)[.!…]?$/i.test(text);
}

/* M345: the craft's line about a settled outcome. A craft saved before today carries the old wording ("The house has
 * ruled = a verdict injected from outside the story…") — it is spoken as today's line; with the referee off, the line
 * is not sent at all: nothing is ever settled for the storyteller, so nothing needs teaching. */
const OLD_RULED_LINE = /^[ \t]*The house has ruled = [^\n]*\n?/m;
const NEW_RULED_LINE = /^[ \t]*An outcome already settled = [^\n]*\n?/m;
/* M510: the last `n` of the storyteller's pages with his messages between them — starting on his message, never on a
 * page of the storyteller's (a request must not open on the storyteller's own turn) */
export const SMALL_PAGES = 8;
/* M510-14: THE RECORD RIDES FOR A SMALL MODEL, up to this many characters (about 4,000 tokens), the newest folds first.
 * "The story in short" is rewritten by the helper every page, so it must stay short (a long rewrite would take minutes a
 * page and shift its details each time); the keeper's record is written once per fold and never rewritten — the long,
 * steady memory. Older lines past the cap still reach the page when his move names them (the M344 recall). */
export const SMALL_RECORD_CHARS = 16000;
export function newestLines(text, cap = SMALL_RECORD_CHARS) {
  const lines = String(text == null ? '' : text).split('\n');
  const kept = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (size + lines[i].length + 1 > cap && kept.length) break;
    kept.unshift(lines[i]);
    size += lines[i].length + 1;
  }
  return { text: kept.join('\n'), rested: lines.length - kept.length };
}
/* M510-3: IS THIS A HEATED SCENE — read from what woke, never from two built-in ids (his own imported intimacy rule wakes
 * by the same key and was not seen): any rule that woke for intimacy or a contest, the ledger's own intimate mode, a
 * live fight. A rule he pinned on for a whole arc (spectacle combat) is not a heated page by itself. */
export function heatedNow(selected, state, typed = '') {
  const woke = (Array.isArray(selected) ? selected : []).some((s) => s && s.mod && (s.mod.whenKey === 'intimate' || s.mod.whenKey === 'combat' || s.mod.id === 'nsfw' || s.mod.id === 'contested-resolution'));
  const st = state && typeof state === 'object' ? state : {};
  return woke || Boolean(st.mode && (st.mode.intimate || st.mode.combat)) || Boolean(st.duel || st.battle || st.war) || typedCombat(typed); /* M510-7: his words starting a fight */
}
/* M510-2: WHAT THE LEDGER KNOWS OF THE PEOPLE IN THE SCENE RIDES IN THE LEDGER'S OWN WORDS. M510 left a small model the
 * helper's summary alone — a hurt, a secret someone saw, a live grudge of someone standing right there reached it only
 * if the helper happened to name it (measured: Kaelen's cracked wrist, what Rukia saw at dawn and Kaelen's rematch
 * thread rode for the frontier model and not for the small one). The cards of who is here and the ledger's compact
 * view (the scene first) ride now, with anyone the latest pages NAMED (the recall tier — they are in the scene's words);
 * the rest of the absent — the roster, "away and much on the story's mind" — stay with the helper. */
export const SMALL_PEOPLE_VIEW = { budget: PEOPLE_BUDGET, cards: PRESENT_CARDS_MAX, recall: RECALL_MAX, roster: 0, important: 0 };
export function lastPagesOf(pages, n = SMALL_PAGES) {
  const list = Array.isArray(pages) ? pages : [];
  let seen = 0;
  let from = 0;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i] && list[i].role === 'assistant') seen += 1;
    if (seen === n) { from = i; break; }
  }
  while (from > 0 && list[from] && list[from].role !== 'user') from -= 1;
  return list.slice(from);
}

export function refereeCraft(text, on) {
  const s = String(text == null ? '' : text);
  if (!on) return s.replace(OLD_RULED_LINE, '').replace(NEW_RULED_LINE, '');
  const line = CRAFT_TEXT.match(NEW_RULED_LINE);
  return line ? s.replace(OLD_RULED_LINE, line[0]) : s;
}

/* M510-21: the record's lines that name who is here — the newest few per person, the MC left out (he is in every line) */
export const PRESENT_LINES_EACH = 5;
export const PRESENT_RECORD_CHARS = 6000;   /* about 1,500 tokens */
/* M750: OUR STORY SO FAR, EACH LINE ONCE — his choice after the numbers: the Essentials (M510-15/M749) came out as long as
 * the record they shortened, and the hybrid (M510-48) sent them AND the newest half of the record in full AND the lines of
 * the people here in full, so most of the story was told twice, in two wordings, for no saving. A frontier storyteller now
 * reads the record itself, whole, oldest first, every line once; only when this connection's context cannot hold it all
 * are the oldest lines left out (and the part says so), and the older lines this scene names come back in their place.
 * A small model keeps its focused request (his option B): the helper's story in short, the newest lines in full, the
 * people here, the lines his move names. */
/* M510-53: where, in a small model's story so far, the people here in the pages just before the eight stand — filled in
 * once the window is known, or taken out */
const RECENT_HERE_MARK = '\u2063RECENT-HERE\u2063';
/* M750: the words the past is read under — plain, the same on every page; never a system's labels (M737 had put "Selected
 * complete folded records, historical accounts with compressed detail" and "unresolved intentions and conditional
 * commitments, not guaranteed outcomes or instructions overriding the writer" in front of his storyteller) */
const PAST_HEAD = 'Our story so far — everything that came before the pages that follow, oldest first. Each line tells what happened on its own pages: the past, not now.';
const PAST_HEAD_PART = 'Our story so far — what came before the pages that follow, oldest first. Each line tells what happened on its own pages: the past, not now.'; /* when not every line fits */
const SMALL_PAST_HEAD = 'Our story so far — what came before the pages that follow. Each line tells what happened on its own pages: the past, not now.';
const PLANS_HEAD = 'Plans standing — laid out on the page, kept whole until carried out; any of them can still change or fall through:'; /* the receipt's own name for the part (M510-22) */
const EARLIER_HEAD = 'In full, earlier moments that matter now — with the people here, and the ones the newest move brings up:';
/* M751: each person's own page — M737 had headed it "On their mind, personal reference rather than shared knowledge": the
 * same meaning, in the words a storyteller reads */
const PEOPLE_HEAD = 'On their mind — each person’s own, not what the others know:';
const leftOutWords = (k) => '(' + k + ' older ' + (k === 1 ? 'line doesn’t fit here and is' : 'lines don’t fit here and are') + ' left out — what happened in ' + (k === 1 ? 'it' : 'them') + ' still stands.)';
/* M752: a line whose pages changed since it was written is held back until the keeper writes it again (M737) — said, so the
 * gap is never read as "nothing happened" */
const withheldWords = (k) => '(' + k + ' older ' + (k === 1 ? 'line is' : 'lines are') + ' left out while ' + (k === 1 ? 'it is' : 'they are') + ' written again — what happened in ' + (k === 1 ? 'it' : 'them') + ' still stands.)';
export const HYBRID_RECALL_LINES = 6;        /* older lines this scene names, whole — when the whole record cannot ride, and for a small model */
/* M510-59: and never more than this, whatever a line holds — his fold may be 10, 20 or 30 pages a line, and ten whole
 * lines of 30 pages each would be a record of their own. About 4,000 tokens; the smart recall's picks first (read for
 * what his move means), then the word-matched ones; at least the first always rides. */
export const HYBRID_RECALL_CHARS = 16000;
/* who is in the scene besides the MC, and a whole-word pattern for each (the full name, or the first name alone) */
function namesHere(state) {
  const mc = String(mcNameOf(state) || '').trim().toLowerCase();
  return [...new Set((Array.isArray(state && state.present) ? state.present : []).map((p) => (typeof p === 'string' ? p : p && p.name)).filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim()))]
    .filter((n) => n.toLowerCase() !== mc);
}
/* a title is not a name: "Lord Varen" is found as "Lord Varen" or "Varen" — never "Lord", which is every lord */
const TITLES = new Set(['lord', 'lady', 'sir', 'dame', 'captain', 'duke', 'duchess', 'count', 'countess', 'baron', 'baroness', 'king', 'queen', 'prince', 'princess', 'lieutenant', 'commander', 'general', 'master', 'mistress', 'mr', 'mrs', 'ms', 'miss', 'dr', 'doctor', 'father', 'mother', 'brother', 'sister', 'uncle', 'aunt', 'saint', 'emperor', 'empress', 'marquis', 'marquess', 'earl', 'viscount', 'sergeant', 'major', 'colonel', 'professor', 'elder', 'chief', 'high', 'grand', 'old', 'young', 'little', 'big', 'the']);
/* M510-63: A PERSON BY EVERY NAME THAT IS ONLY THEIRS. His question: how is "who's here, in the record" chosen — is it
 * smart? It found a person by their whole name or their first name. In his Bleach story people are called by the family
 * name — "Zaraki", "Hitsugaya", "Captain Kuchiki" — and a record line that says only "Zaraki" was never found for Kenpachi
 * Zaraki. Now each part of the name counts too (a title never: "Captain" is every captain) — but only a part no one else
 * the ledger knows shares: "Kuchiki" is Rukia's and Byakuya's both, so a line with "Kuchiki" alone is neither's. */
function nameAsWord(name, known = []) {
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const words = String(name || '').split(/\s+/).filter(Boolean);
  let k = 0;
  while (k < words.length - 1 && TITLES.has(words[k].toLowerCase().replace(/\.$/, ''))) k += 1;
  const core = words.slice(k);
  const others = (Array.isArray(known) ? known : []).filter((o) => typeof o === 'string' && o.trim() && o.toLowerCase() !== String(name).toLowerCase());
  const shared = (w) => others.some((o) => o.split(/\s+/).some((x) => x.toLowerCase() === w.toLowerCase()));
  const parts = new Set([name]);
  if (core.length && core.join(' ') !== name) parts.add(core.join(' '));
  core.forEach((w, i) => {
    if (w.length < 3 || TITLES.has(w.toLowerCase().replace(/\.$/, ''))) return;
    if (i === 0 || !shared(w)) parts.add(w); /* the first name as before; any other part only when it is theirs alone */
  });
  return new RegExp('(?<![\\p{L}\\p{N}])(?:' + [...parts].sort((a, b) => b.length - a.length).map(esc).join('|') + ')(?![\\p{L}\\p{N}])', 'u');
}
/* M511: A RECORD LINE AS IT RIDES, ONE WAY EVERYWHERE — its pages, its words, and the detail the auditor kept beneath it
 * (M12: "the detail rides with its line"). "Our story so far" (M510-51/53) wrote its lines by hand as pages and words, and
 * every detail was lost from the request while the receipt, built from the record's own text, still showed them: his
 * "on normal there's detail worth keeping but in raw none". */
export function recordLine(n) {
  const a = n.span[0] + 1; const b = n.span[1] + 1;
  /* M750: a correction belongs to no page (its span is [-1,-1]) — it read "(page 0) [Correction] …" */
  const head = (n.correction || a < 1 ? '' : b > a ? '(pages ' + a + '–' + b + ') ' : '(page ' + a + ') ') + String(n.text || '').trim();
  return typeof n.detail === 'string' && n.detail.trim() ? head + '\n  • Detail worth keeping: ' + n.detail.trim() : head;
}
/* M511: each person here, their pattern built once a call — the names the ledger knows are the same for every line */
function patternsOf(here, state) {
  const known = knownNames(state);
  return new Map(here.map((name) => [name, nameAsWord(name, known)]));
}
/* everyone the ledger knows by name — who a shared family name might belong to */
function knownNames(state) {
  const s = state || {};
  const out = new Set();
  for (const p of (Array.isArray(s.present) ? s.present : [])) { const n = typeof p === 'string' ? p : p && p.name; if (n) out.add(n); }
  for (const n of Object.keys((s.characters && typeof s.characters === 'object') ? s.characters : {})) out.add(n);
  for (const n of Object.keys((s.knowledge && typeof s.knowledge === 'object') ? s.knowledge : {})) out.add(n);
  const mc = mcNameOf(s); if (mc && mc !== 'the player') out.add(mc);
  return [...out];
}

/* M510-23: WHO'S HERE, IN THE RECENT PAGES — the pages between the eight a small model reads whole and the record's reach
 * are neither whole nor folded for it, and the record's lines of who is here cannot reach them. The storyteller's
 * paragraphs there that name each person in the scene — the newest two each, capped — ride word for word; gone when the
 * person leaves. His example: the council he interviews the day after he rode out to the two who never came. */
export const RECENT_PARAS_EACH = 2;
export const RECENT_PARAS_CHARS = 6000;   /* about 1,500 tokens */
export const RECENT_PARA_MIN = 100;        /* "Varen nodded." tells nothing */
export const RECENT_PARA_MAX = 1200;
export function pagesOfWhoIsHere(pages, state, { from = 0, to = 0, each = RECENT_PARAS_EACH, cap = RECENT_PARAS_CHARS, skip = () => false } = {}) {
  const list = Array.isArray(pages) ? pages : [];
  const here = namesHere(state);
  if (!here.length || to <= from) return { text: '', who: [], texts: [] };
  const paras = [];
  for (let i = Math.max(0, from); i < Math.min(to, list.length); i += 1) {
    const m = list[i];
    if (!m || m.role !== 'assistant' || typeof m.content !== 'string') continue;
    m.content.split(/\n\s*\n/).forEach((p, k) => {
      const t = p.replace(/^\s*\[[^\]\n]*\]\s*$/gm, '').replace(/\s+/g, ' ').trim(); /* the header row is furniture */
      if (t.length >= RECENT_PARA_MIN && !skip(t)) paras.push({ page: i + 1, k, text: t.length > RECENT_PARA_MAX ? t.slice(0, RECENT_PARA_MAX - 1).trimEnd() + '…' : t });
    });
  }
  const patterns = patternsOf(here, state);
  const picked = new Set(); const who = [];
  for (const name of here) {
    const re = patterns.get(name);
    let n = 0;
    for (let j = paras.length - 1; j >= 0 && n < each; j -= 1) if (re.test(paras[j].text)) { picked.add(paras[j]); n += 1; }
    if (n) who.push(name);
  }
  const render = (p) => '- (page ' + p.page + ') ' + p.text;
  let chosen = [...picked].sort((a, b) => (a.page - b.page) || (a.k - b.k));
  while (chosen.length && chosen.map(render).join('\n').length > cap) chosen = chosen.slice(1);
  return { text: chosen.map(render).join('\n'), who: who.filter((n) => chosen.some((p) => patterns.get(n).test(p.text))), texts: chosen.map((p) => p.text) };
}

export function recordOfWhoIsHere(nodes, state, { skip = () => false, each = PRESENT_LINES_EACH, cap = PRESENT_RECORD_CHARS } = {}) {
  const here = namesHere(state);
  const lines = (Array.isArray(nodes) ? nodes : []).filter((n) => n && !n.empty && !n.correction && typeof n.text === 'string' && n.text.trim() && Array.isArray(n.span)).sort((a, b) => a.span[0] - b.span[0]);
  const patterns = patternsOf(here, state);
  const picked = new Set(); const who = [];
  for (const name of here) {
    const re = patterns.get(name);
    let n = 0;
    for (let i = lines.length - 1; i >= 0 && n < each; i -= 1) {
      if (!re.test(lines[i].text) || skip(lines[i])) continue;
      n += 1; picked.add(lines[i]);
    }
    if (n) who.push(name);
  }
  const render = (l) => '- ' + recordLine(l);
  let chosen = [...picked].sort((a, b) => a.span[0] - b.span[0]);
  /* final audit: FAIR WHEN THE ROOM IS TIGHT. Long lines (a dense record: ~7,000 characters a line) filled the room with the
   * newest few and let the oldest go first — someone last named fifty pages back (the captain the scene turns on) lost
   * every line to people named yesterday. Now the lines go from whoever still has the most, oldest first, so each person
   * keeps their newest line as long as the room can hold one each; past that, the oldest. */
  /* M511: each line is read for its names ONCE, and its length measured once — the room was measured by joining every
   * chosen line again, and every line searched again for every person, on each pass (a dense record: ~14,000 name
   * patterns and ~250 ms a call, twice a send; ×6 on his phone) */
  const namesOfLine = new Map();
  const namedIn = (l) => { let got = namesOfLine.get(l); if (!got) { got = here.filter((name) => patterns.get(name).test(l.text)); namesOfLine.set(l, got); } return got; };
  const lengthOf = new Map(chosen.map((l) => [l, render(l).length]));
  const sizeOf = (list) => (list.length ? list.reduce((sum, l) => sum + lengthOf.get(l), 0) + list.length - 1 : 0); /* = list.map(render).join('\n').length */
  while (chosen.length && sizeOf(chosen) > cap) {
    const count = new Map();
    for (const l of chosen) for (const name of namedIn(l)) count.set(name, (count.get(name) || 0) + 1);
    const spare = chosen.find((l) => namedIn(l).every((name) => (count.get(name) || 0) > 1));
    chosen = chosen.filter((l) => l !== (spare || chosen[0]));
  }
  return { text: chosen.map(render).join('\n'), who, lines: chosen.length, nodes: chosen };
}

/* M547/M750: WHAT THE STORYTELLER READS OF THE RECORD WORD FOR WORD — chosen once, here, for the request and for the smart
 * recall alike (the recall is never offered a line the request already carries: chat.js reads the selected lines off the
 * request's own selection). A frontier storyteller: the record whole, newest first into the room, so on any context that
 * holds it, every line. A small storyteller (his option B): the newest lines up to SMALL_RECORD_CHARS, and the newest lines
 * that name each person here. */
export const SMALL_PICK_CHARS = 6000; /* about 1,500 tokens: the lines the smart recall names, whole, for a small storyteller */
export function planRecordSelection({ nodes = [], state, small = false, through = Infinity, cap = Infinity } = {}) {
  const list = uniqueRecords(nodes).filter(n => n.correction || n.span[1] < through);
  const render = n => '- ' + recordLine(n);
  const recent = selectWhole(list.filter(n => !n.correction), Math.min(cap, small ? SMALL_RECORD_CHARS : cap), render, { newest: true });
  const ids = new Set(recent.nodes.map(recordId));
  const present = small ? recordOfWhoIsHere(list, state, { skip: n => ids.has(recordId(n)), each: PRESENT_LINES_EACH, cap: Math.min(cap, PRESENT_RECORD_CHARS) }) : null;
  const corrections = list.filter(n => n.correction);
  return { list, recent, present, corrections, protectedIds: new Set([...recent.nodes,...(present?.nodes || []),...corrections].map(recordId)) };
}

/* M510-20: every part the house can send, in the order it rides — the receipt names each one every page */
/* M510-55: in the order the request is sent now — the system's blocks, then the notes (canon, our story so far, the
 * plans, the people, the state of things, the rest), the pages, his move, the closing */
export const EVERY_ROW = ['The frame', 'The craft', 'The story’s voice', 'The brief', 'The world', 'Who’s here', 'Active modules', 'Where our story began', 'What canon says', 'The story in short', 'What remains', 'Who’s here, in the recent pages', 'Earlier moments, in full', 'Plans standing', 'What your choices set in motion', 'On their mind', 'The state of things', 'The sensors’ word', 'The world’s word', 'The director’s note', 'The editor’s eye', 'The house’s eye', 'The house has ruled', 'Your choice', 'Own words', 'The pages, word for word', 'The plan for this page', 'The sounds', 'The frame, said again', 'The note at the end', 'The continue nudge'];
function emptyWhy(name, c) {
  const noPlan = 'no plan was ready for this page — it went as the full request';
  switch (name) {
    case 'The story in short': return !c.small ? 'small model only — your storyteller reads the pages themselves' : !c.planned ? noPlan : 'not written yet — the planning helper writes it with each plan';
    case 'Plans standing': return !c.small ? 'no plan standing — the plans keeper writes one down the moment a page lays it out' : !c.planned ? noPlan : 'no plan standing — the plans keeper writes one down the moment a page lays it out'; /* M510-48: every storyteller */
    case 'Who’s here, in the recent pages': return !c.small ? 'small model only — your storyteller reads those pages whole' : !c.planned ? noPlan + ', with the pages whole' : 'no one here is named in the pages between the last eight and the record (or the story is still short enough for the eight)';
    case 'Earlier moments, in full': return !c.small ? (c.recordWhole === false ? 'your storyteller reads the record itself (What remains) — ' + (c.withheld && c.recordWhole === false && !c.leftOut ? 'all but the lines being written again after their pages changed' : 'not every older line fits this connection’s context; the ones your newest move brings up ride there, in their place') : 'your storyteller reads the whole record (What remains) — every earlier moment is in it') : !c.planned ? noPlan + ', with the whole record' : 'no one here is named in the record yet, or their lines already ride above'; /* M511: was “Who’s here, in the record”; M750: the whole record rides for a frontier storyteller */
    case 'The plan for this page': return !c.small ? 'small model only — the planning helper writes one for a small storyteller' : noPlan + ', with the scene said once more';
    case 'The sounds': return !c.small ? 'small model only — on a heated page' : !c.planned ? noPlan + ', with the whole craft' : 'a calm page — no sound laws needed';
    case 'On their mind': return 'no one’s page to show — the ledger has no one in it yet';
    case 'Where our story began': return 'not a story set in an existing canon — or it began before a #story asked where (it asks once, when a #story opens the tale)';
    case 'What canon says': return 'canon verification is off';
    case 'The sensors’ word': return 'nothing from the sensors — off, or nothing slipping';
    case 'The world’s word': return 'nothing from the world agent — off, or nothing new out of sight';
    case 'The director’s note': return 'nothing from the director — off, or no episode standing';
    case 'The editor’s eye': return 'nothing from the editor — off, or no standing critique';
    case 'The house’s eye': return 'nothing from the house’s eye — off, or no slips on the last page';
    case 'The house has ruled': return 'nothing settled by the referee for this page';
    case 'Your choice': return !c.choicesOn ? 'Choices matter is off for this story (Settings → Choices matter)' : 'no choice taken on this move — your own words went as they are';
    case 'What your choices set in motion': return !c.choicesOn ? 'Choices matter is off for this story (Settings → Choices matter)' : 'nothing yet — no choice you took has left anything behind';
    case 'Own words': return 'none — nothing set under Own words in Settings';
    case 'The frame, said again': return !c.frameOn ? 'the frame is off' : 'off — “Say it again at the end” in Settings';
    /* rows that always stand, when they came empty */
    case 'The brief': return 'no brief written for this story';
    case 'Who’s here': return 'no cast notes written, and no character card for anyone here';
    case 'The world': return 'the brief is Manual — only your own words ride (Settings → This story → The brief)'; /* M517 */
    case 'The story’s voice': return !c.small ? 'small model only — your storyteller writes in its own voice' : !c.planned ? noPlan : 'no page yet older than the ones sent word for word — a passage is held up once the story has one'; /* M512 */
    case 'Active modules': return 'nothing woke besides the craft';
    case 'What remains': return !c.keeperOn ? 'the memory keeper is off for this story' : 'the record is still empty — the memory keeper folds pages once they are older than its ' + c.keeperWindow + '-page window';
    case 'The pages, word for word': return 'the first page — nothing written yet';
    case 'The state of things': return 'the ledger holds nothing yet';
    case 'The continue nudge': return 'you wrote a move — the nudge is only for when you ask it to go on';
    default: return 'nothing this page';
  }
}
/* a missing row goes in right before the next row that is there, so every row stands where its part would ride */
export function fillEveryRow(slots, c) {
  const isRow = (s, name) => s && (s.name === name || (name === 'Own words' && typeof s.name === 'string' && s.name.startsWith('Own words — ')));
  /* a row that stands empty with nothing to say for itself says why too */
  for (const s of slots) if (s && s.tokens === 0 && !s.reason && !s.source && EVERY_ROW.includes(s.name)) s.reason = emptyWhy(s.name, c);
  EVERY_ROW.forEach((name, k) => {
    if (slots.some((s) => isRow(s, name))) return;
    let at = slots.length;
    for (let j = k + 1; j < EVERY_ROW.length; j += 1) { const i = slots.findIndex((s) => isRow(s, EVERY_ROW[j])); if (i !== -1) { at = i; break; } }
    slots.splice(at, 0, { name, tokens: 0, source: '', reason: emptyWhy(name, c), text: '' });
  });
}

/* M510-55: THE RECEIPT IN THE ORDER IT WAS SENT — his word: "why does What the storyteller saw show things in an order,
 * with explanations, that don't look like the raw?" The rows stood in the order the builder happened to count them, and
 * the request had since been rebuilt around them (the notes in the system, the past before the present, the woken rules
 * their own block). Now each row that rode stands where its own words stand in the request as sent — the system's blocks
 * first, then the messages — and a row that did not ride stands beside the row it would follow. The rows only move. */
export function orderAsSent(slots, systemBlocks, messages) {
  const wire = [...(Array.isArray(systemBlocks) ? systemBlocks : []).map((b) => String((b && b.text) || '')),
    ...(Array.isArray(messages) ? messages : []).map((m) => (m && typeof m.content === 'string' ? m.content : JSON.stringify((m && m.content) || '')))].join('\n\u0001\n');
  const probeOf = (t) => {
    const lines = String(t || '').split('\n').map((l) => l.replace(/^\s*-\s*/, '').replace(/^\(pages? \d+(?:[–-]\d+)?\)\s*/, '').trim()).filter(Boolean);
    const line = lines.find((l) => l.length >= 24) || lines[0] || '';
    return line.slice(0, 60);
  };
  const rowIndex = (s) => { const n = s && s.name; const i = EVERY_ROW.indexOf(n); return i !== -1 ? i : (typeof n === 'string' && n.startsWith('Own words — ') ? EVERY_ROW.indexOf('Own words') : -1); };
  /* the closing's parts (the plan, the sounds, the frame said again, the note, the nudge) are found from the end: the frame
   * said again is the frame's own words, which the system's first block holds too (M21-B caught it) */
  const closingFrom = EVERY_ROW.indexOf('The plan for this page');
  const placed = slots.map((s) => { if (!s || !s.tokens || !s.text) return null; const p = probeOf(s.text); if (!p) return null; const i = rowIndex(s) >= closingFrom ? wire.lastIndexOf(p) : wire.indexOf(p); return i === -1 ? null : i; });
  const keys = slots.map((s, i) => {
    if (placed[i] != null) return placed[i];
    const mine = rowIndex(s);
    let before = -1;
    slots.forEach((o, j) => { if (placed[j] != null && rowIndex(o) !== -1 && mine !== -1 && rowIndex(o) < mine && placed[j] > before) before = placed[j]; });
    return before + (mine + 1) / 1000;
  });
  const ordered = slots.map((s, i) => ({ s, k: keys[i], i })).sort((a, b) => (a.k - b.k) || (a.i - b.i)).map((x) => x.s);
  slots.splice(0, slots.length, ...ordered);
}

/* M510-23: a row pushed late goes where its part rides — before the first row that comes after it in EVERY_ROW */
function placeRow(slots, name) {
  const at = slots.map((s) => s && s.name).lastIndexOf(name);
  if (at === -1) return;
  const [row] = slots.splice(at, 1);
  const k = EVERY_ROW.indexOf(name);
  const before = slots.findIndex((s) => s && EVERY_ROW.indexOf(s.name) > k);
  slots.splice(before === -1 ? slots.length : before, 0, row);
}

export function buildRequest({
  story, messages, settings, state, modules, memory, cast, lore, loreFired,
  measureOnly = false, transportMeasure = null,
  window: windowInfo, directive, directorNote, editorEye, houseEye, ruling, worldBrief, pageFilter, canonNote = '', canonOn = false, canonWhy = '', sensorNote = '', sensorOwn = '', sensorRole = '', /* M636: the same law as the storyteller's own words, and the role he chose for it */
  smallPlan = null, smallIntense = false, lastSound = null, /* M510: the small request — the helper's plan, whether the scene is heated, what the last page sounded like */
  smallPlansBook = null, /* M510-22: the plans standing, kept whole ({plans}) */
  recallPicked = [], /* M510-50: the ids of the older record lines the smart recall named for this page */
  voiceSample = null, /* M512: a passage of the story at its best ({text}) — for a small storyteller only */
  refereeWhy = '', /* M513: why the referee settled nothing this page — its receipt row says it */
  choicesOn = false, /* M548: Choices matter is on for this story (off: not one byte below changes) */
  choiceTaken = null, /* M548: the choice he took on this move — sealed before he chose (agents/choices.js takenOf) */
  choiceEchoes = '', /* M548: what his choices set in motion, as it rides (agents/choices.js echoesText) */
  canonStart = '', /* M516: where our story began in its canon, and what was true then — his note, every page */
  worldGround = '', /* M517: the automatic brief — the world of the story, beside his own brief in its seat */
  canonOnPages = false, /* M518: canon's lasting lines ride on each person's card — the note leaves out what the cards carry */
  tooLoud = false, /* M519: the last pages drowned in sounds and dashes — a small storyteller is told to breathe, and reads its pages eased */
  quietPage = false, /* M519-5: the last page, with people in it, let almost no one speak */
}) {
  const safeStory = story || {};
  const safeSettings = settings || {};
  const history = Array.isArray(messages) ? messages : [];
  const selected = Array.isArray(modules) ? modules : [];
  /* M6: slot 7's text arrives ready-made from the keeper (renderMemory) —
   * '' when nothing has been remembered, which omits the slot entirely. */
  const memoryText = typeof memory === 'string' ? memory.trim() : '';
  let loreText = typeof lore === 'string' ? lore.trim() : '';
  {
    /* M34: the record rides whole (SLOT_BUDGET is the keeper's own); the
     * lore shelf keeps a room of its own beside it, never squeezed out. */
    /* M283: and it follows the storyteller's room too, cut only at a line */
    const room = Math.max(LORE_BUDGET, SLOT7_BUDGET - memoryText.length, Math.min(60000, roomChars(windowInfo)));
    if (loreText.length > room) loreText = atLine(loreText, room);
  }
  /* M9: the lore receipt names the entries that fired (their keys). */
  const firedNames = (Array.isArray(loreFired) ? loreFired : [])
    .map((f) => (f && typeof f === 'object'
      ? (typeof f.name === 'string' && f.name ? f.name
        : (Array.isArray(f.keys) && f.keys[0]) || '')
      : String(f || '')))
    .map((s) => String(s).trim()).filter(Boolean);

  const slots = [];
  /* M347: each part keeps its words on the draft — the page keeps them in js/sent.js; the receipt itself (finalizeReceipt)
   * still keeps only names and sizes, so nothing heavy rides the page or the book sync */
  const pushSlot = (name, text, source, reason) => {
    slots.push({ name, tokens: estimateTokens(text), source: source || '', reason: reason || '', text: typeof text === 'string' ? text : '' });
  };

  /* M327: who tells, and who listens — the names the house's own words are said in (assemble/voice.js) */
  /* M510: THE FRAME SWITCHED OFF IS OFF WHOLE. The teller's name leading the house's own lines ("Tony Stark — Bruce
   * here…") and the grounding phrase are the frame's too: with the frame gone they read as a name nobody introduced. */
  const frameOn = safeSettings.frameOn !== false;
  const voice = { ...voiceOf(safeSettings), mc: mcNameOf(state), ...(frameOn ? {} : { teller: '', grounding: '' }) }; /* M361: {{user}} is the one he plays */

  /* --- 1. The frame --- */
  const framePicked = pickText(safeStory.frameOverride, safeSettings.frameText, STARTER_FRAME);
  /* M359: his grounding phrase is woven into the standing words themselves — the top, and a third of the way down */
  const frame = { ...framePicked, text: groundingWeave(inVoice(framePicked.text, voice), voice.grounding) };
  /* M334: first person or second — the writer's choice, or read off his frame's own opening words. It turns the SYSTEM-side
   * words the house wrote (purpose line, craft, woken rules); never the frame; never what is said to the teller in a
   * user-role message, which is the writer speaking. */
  const person = personOf(safeSettings, framePicked.text);
  /* M509-14: THE FRAME CAN BE SWITCHED OFF WHOLE (Settings → "Send the frame"); off, slot 1 is empty and nothing of it
   * echoes. The "purpose line" that once followed the frame is gone — he never used it. */
  const frameText = frameOn ? frame.text : '';
  pushSlot('The frame', frameText, frameOn ? frame.source : 'switched off', '');
  /* M21: "say it again at the end" — the whole frame repeats at the tail,
   * just before the note at the end: the anchor against long-context fade.
   * Off by default. */
  const echoOn = frameOn && safeSettings.frameEcho === true;

  /* --- 2. The craft --- */
  const craft = selected.find(({ mod }) => mod && mod.id === 'core-craft');
  const craftText = craft && craft.mod ? inPerson(inVoice(naturalThinking(refereeCraft(withoutAuthorshipFrame(craft.mod.text), safeSettings.refereeOn !== false), voice, person), voice), person) : ''; /* M335: a teller with a self thinks in its own voice */ /* M327: in the writer's name; M309: the house's craft no longer holds it; a copy saved before today loses it here */
  /* M379: the shortcuts are said once, here, with the rulebook — never again as a second message after his */
  const shortcuts = inPerson(inVoice(shortcutsText(), voice), person);
  /* M379: THE HOUSE'S OWN NOTE IS NOT A MESSAGE AFTER HIS. With no note of his own, the starter note ("Before you write:
   * reread the last few exchanges…") rode EVERY turn as a second user message after his — house words he never wrote,
   * sent as if he had said them again. It is said once, here, in the standing words. A note he writes himself still
   * stands at the end, where he put it. */
  /* M509-14: THE NOTE CAN BE SWITCHED OFF WHOLE (Settings → "Send the note at the end"): off, no note at the end and no
   * starter note in the standing words either */
  const noteOn = safeSettings.noteOn !== false;
  const notePickedEarly = noteOn ? resolveNote(safeStory.noteOverride, safeSettings.noteText) : { text: '', source: 'switched off' };
  const starterStanding = notePickedEarly.source === 'the starter text' ? inPerson(inVoice(notePickedEarly.text, voice), person) : '';
  /* M510: THE SMALL REQUEST (his choice B). A small model loses what stands far back in a long request — his own
   * onomatopoeia law went unheard 70,000 characters behind the page. With the storyteller a small model AND a plan in
   * hand (the planning helper read the whole story), the craft rides as the laws this scene needs, in his exact words:
   * the ones every page needs (laws.js ALWAYS_LAWS) and the ones the helper chose; the notes, the record and the older
   * pages stay with the helper who read them. No plan, or a craft that no longer holds the laws a page stands on: the
   * whole request, as before. */
  const smallLaws = safeSettings.smallModelNow === true && smallPlan && typeof smallPlan === 'object' ? lawsOf(craftText) : [];
  const smallB = smallLaws.length > 0 && LOAD_BEARING.every((n) => lawsNamed(smallLaws, [n]).length > 0);
  const soundKeys = new Set(SOUND_LAWS.map(lawKey));
  /* M510-5: AN INTIMATE SCENE CARRIES THE CRAFT'S WHOLE INTIMACY SECTION — the woken rule's own word ("the people half of
   * this law — pacing, limits, Body Veto, Erotic Momentum, Power Dynamic, Escalation Resets Consent, Line-Cross Vertigo —
   * rides in the craft on every turn"); M510 left those to the helper's twelve, and a small model could write the sound
   * without the limits, the pacing and the body's truth that keep it real */
  const intimateNow = selected.some((s) => s && s.mod && (s.mod.whenKey === 'intimate' || s.mod.id === 'nsfw')) || Boolean(state && state.mode && state.mode.intimate);
  const sceneSection = smallB && intimateNow ? smallLaws.filter((l) => l.section === 'Intimacy') : [];
  /* M510-7: a fight's page carries the craft's fight laws — the ledger's mark, a woken contest rule, a live fight, or his
   * own words starting one (the helper planned before his move) */
  const typedNow = (() => { const u = [...history].reverse().find((m) => m && m.role === 'user' && !m.hidden); return u ? typedWords(String(u.text || '')) : ''; })(); /* M675: what he typed — a notes file riding in the page starts no fight */
  const fightNow = selected.some((s) => s && s.mod && (s.mod.whenKey === 'combat' || s.mod.id === 'contested-resolution')) || Boolean(state && state.mode && state.mode.combat) || Boolean(state && (state.duel || state.battle || state.war)) || typedCombat(typedNow);
  /* M510-26/27: how a fight sounds rides as its own woken rule now (modules.js 'fight-acoustics'), for every storyteller */
  const fightSection = smallB && fightNow ? lawsNamed(smallLaws, FIGHT_LAWS) : [];
  /* M512: an out-of-character question carries his OOC law (its own law now — it was read as the tail of Story Drivers) */
  /* M675 (the second reading): THE TURN'S OWN PAGE SAYS WHAT THE TURN IS. This looked for his last message that SHOWS —
   * so a "Go on" (a hidden page of the house's, nothing of his) pressed any time after an out-of-character message was
   * taken for an out-of-character turn: the OOC law sent to a small model on a page of the story, the house's thinking
   * note held back from it. The newest page of his in the story is asked, hidden or not: a hidden nudge is no aside; a
   * hidden shortcut is read by what he typed. */
  const oocTurn = (() => {
    const u = [...history].reverse().find((m) => m && m.role === 'user');
    if (!u || (u.hidden && !typedOf(u))) return false;
    return Boolean(u.ooc === true || /^\s*(?:#question|\(\(|\/\/)/.test(u.hidden ? typedOf(u) : String(u.text || '')));
  })();
  const craftForTurn = smallB
    ? joinLaws([...lawsNamed(smallLaws, [...ALWAYS_LAWS, ...PROSE_LAWS, ...PEOPLE_LAWS, ...(oocTurn ? ['OOC'] : []), ...(Array.isArray(smallPlan.laws) ? smallPlan.laws : [])].filter((n) => !soundKeys.has(lawKey(n)))), ...sceneSection, ...fightSection]) /* M512: his prose laws on every small page */
    : craftText;
  const craftWhole = [craftForTurn, shortcuts, starterStanding].filter((t) => typeof t === 'string' && t.trim()).join('\n\n');
  pushSlot('The craft', craftWhole, smallB ? 'the laws this scene needs, your prose laws and your laws on how people react, word for word, with the shortcuts — small model' : 'the rulebook, with the shortcuts', craft ? craft.reason : '');
  /* M512: HOW OUR STORY SOUNDS AT ITS BEST — a small model writes like what it read last, and it read only its own last
   * eight pages: a slip once written was copied forward. A passage from the story's own pages (the newest a big model
   * wrote, older than the pages sent whole; else the page that repeats the rest least — smallprose.js) rides with the
   * craft, for its sound alone. Said in his voice; never for the frontier storyteller. */
  const sampleText = smallB && voiceSample && typeof voiceSample.text === 'string' ? voiceSample.text.trim() : '';
  const voiceWords = sampleText ? 'How our story sounds at its best — a passage from our own pages, here only for its sound: the rhythm, the plain concrete detail, the way people talk. It is not part of this scene; never repeat its lines.\n\n' + sampleText : '';
  pushSlot('The story’s voice', voiceWords, voiceWords ? 'a passage from your story’s own pages, for how it sounds — ' + (voiceSample.big ? 'the newest page your big storyteller wrote, older than the pages sent whole' : 'the page that repeats the others least') + ' (small model)' : '');

  /* --- 3. The brief --- */
  const ownBrief = typeof safeStory.brief === 'string' ? safeStory.brief : '';
  pushSlot('The brief', ownBrief, ownBrief.trim() ? 'this story' : '');
  /* M517: the world rides in the brief's seat, after his own words — written once, rewritten only where the world moved */
  /* M518-2: his brief is right wherever the two differ — said in the world's own opening when his brief rides above it */
  const groundText = ((g) => (g && ownBrief.trim() ? g.replace(/^The world of our story, as it stands:/, 'The world of our story, as it stands (the brief above is right wherever the two differ):') : g))(typeof worldGround === 'string' ? worldGround.trim() : '');
  const brief = [ownBrief.trim() ? ownBrief : '', groundText].filter(Boolean).join('\n\n');
  pushSlot('The world', groundText, groundText ? 'the automatic brief — the world of your story as it stands, rewritten only where it changed; Settings → This story → The brief' : '');

  /* --- 4. Who's here: the cast notes, who is in the scene right now, and
   * (M7) the invited cards of whoever is present — each description trimmed
   * to 400 chars, the whole section held to 1600. The cast notes and the
   * present names keep their seats; the cards join while there's room. --- */
  const castNotes = typeof safeStory.castNotes === 'string' ? safeStory.castNotes.trim() : '';
  const presentNames = state && Array.isArray(state.present)
    ? state.present.map((p) => p && p.name).filter(Boolean)
    : [];
  const presentBare = new Set(presentNames.map(bareName).filter(Boolean));
  const cardLines = [];
  const invited = Array.isArray(cast) ? cast : [];
  const invitedNames = [];
  for (const card of invited) {
    const cardName = card && typeof card.name === 'string' ? card.name.trim() : '';
    if (!cardName || !presentBare.has(bareName(cardName))) continue;
    let description = card && typeof card.description === 'string'
      ? withCardNames(card.description, cardName, voice).replace(/\s+/g, ' ').trim() /* M435 */
      : '';

    /* M9: personality and scenario join the card under slot 4's budget —
     * the description keeps its seat first; these ride while room remains. */
    const detail = (field, label) => {
      let text = card && typeof card[field] === 'string'
        ? withCardNames(card[field], cardName, voice).replace(/\s+/g, ' ').trim() /* M435 */
        : '';
      if (!text) return '';

      return cardName + ', ' + label + ': ' + text;
    };
    const personality = detail('personality', 'how they carry themselves');
    const scenario = detail('scenario', 'the world they bring');
    if (!description && !personality && !scenario) continue;
    if (description) cardLines.push(cardName + ' — ' + description);
    if (personality) cardLines.push(personality);
    if (scenario) cardLines.push(scenario);
    invitedNames.push(cardName);
  }
  /* M283: THE WRITER'S CAST NOTES WHOLE WHEN THE ROOM ALLOWS. They were cut at
   * 9,000 characters mid-word on any context; now the slot follows the room,
   * and a cut, if one must be made, falls at the end of a line. */
  const slot4Room = Math.max(SLOT4_BUDGET, Math.min(80000, roomChars(windowInfo)));
  /* M451: WHO IS HERE IS SAID ONCE. This block said "Here right now: …" and the notes that open the story said "Here now:
   * …" — the same names twice on every page (measured through the app). The notes keep it, with where each stands and
   * what they wear; this block keeps the cast notes and the cards of whoever is here. */
  let whosHere = [smallB ? '' : castNotes].filter(Boolean).join('\n\n'); /* M510: the helper read the cast notes */
  const cardOmissions = [];
  for (const line of cardLines) {
    const candidate = whosHere ? whosHere + '\n' + line : line;
    if (candidate.length > slot4Room) { cardOmissions.push({ reason: 'whole invited card field exceeds allocation', chars: line.length }); continue; }
    whosHere = candidate;
  }
  pushSlot(
    'Who’s here',
    whosHere,
    whosHere
      ? (invitedNames.length
        ? (smallB ? 'the cards of ' + invitedNames.join(', ') + ' (here now) — your cast notes go to the planning helper, not the small model' : 'cast notes, and the cards of ' + invitedNames.join(', ') + ' (here now)')
        : 'cast notes')
      : '',
    smallB && castNotes && !whosHere ? 'your cast notes go to the planning helper, not the small model' : ''
  );

  /* Slots 1–4 join into systemBlocks. M9 (A4): the cache breakpoint sits at
   * the END of slot 2 (The craft) — the frame and the craft are the stable
   * prefix, so only they carry cache:true; the brief and Who's here are
   * separate non-cached blocks that follow (they drift with the scene).
   * Anthropic puts cache_control on the last cache:true block, i.e. the
   * craft; OpenAI concatenates the cache:true blocks into one leading
   * system message and lets the non-cached blocks follow in order. Empty
   * slot texts are left off the wire (some storytellers refuse empty
   * blocks) but stay on the receipt above, at 0 tokens. */
  /* Positional stability: slots 1–4 always emit four blocks in law order
   * (empty text included) so receipts and tests can read them by seat;
   * the PROVIDERS drop empty blocks when they map to the wire. */
  const systemBlocks = [frameText, voiceWords ? craftWhole + '\n\n' + voiceWords : craftWhole] /* M512: the voice rides with the craft (its seat stays the second) */
    .map((text) => (typeof text === 'string' ? text : ''))
    .map((text) => ({ text, cache: true }))
    .concat(
      [brief, whosHere]
        .map((text) => (typeof text === 'string' ? text : ''))
        .map((text) => ({ text, cache: false }))
    );

  /* --- M12: the character ledger rides the slot-5 area as its own block,
   * "On their mind", just before the state of things — tiered (full cards
   * for the present, mention-recall, the rotating roster) and
   * budget-guarded inside engine/people.js. Omitted when no page of the
   * ledger has anything to say. Rotation derives from the page count, so
   * the roster steps once per turn with no writes of its own. --- */
  const recentPages = wireable(history).slice(-3).map((m) => m.content);
  const scenePages = wireable(history).slice(-10).map((m) => m.content); /* M283: who the story keeps naming */
  /* M510-12: for a small model, whoever the world's word names (on their way, at the party) is recalled like someone the
   * latest pages named — their card rides, so it knows who they are and why they come */
  const worldEarly = typeof worldBrief === 'string' ? worldBrief.trim() : '';
  /* M518: canon's lines ride on the cards only where canon's note is trimmed against them (canonOnPages) — in any other
   * mode the cards are what they always were, and a page's kept canon lines are not sent at all (M386: canon off sends
   * nothing of it) */
  /* M681 (the send's worst frame, perf_send): the state of things is rendered ONCE — the people block asked it whole only to
   * see whether "Elsewhere:" made it in, and section 5 rendered it again with the very same arguments */
  const stateFactsOptions = { ...(smallB ? {} : stateView(windowInfo && windowInfo.budgetTokens)), scenePages: recentPages, peopleNames: relevantPeople(state, recentPages.join('\n')), noFight: safeSettings.refereeOn === false };
  const stateFacts = renderStateFacts(state, stateFactsOptions); /* M345: referee off = the storyteller decides everything; no fight is kept for it */ /* M266: in the room the storyteller has; M305: what the scene is about calls back what someone here learned long ago */
  const peopleState = canonOnPages || !state || !state.characters ? state : { ...state, characters: Object.fromEntries(Object.entries(state.characters).map(([k, e]) => [k, e && typeof e === 'object' && Array.isArray(e.canon) ? (({ canon: _c, ...rest }) => rest)(e) : e])) };
  const people = renderPeopleTiers(peopleState, { recentPages: smallB && worldEarly ? [...recentPages, worldEarly] : recentPages, rotation: history.length, view: smallB ? SMALL_PEOPLE_VIEW : peopleView(windowInfo && windowInfo.budgetTokens), brief: String(safeStory.brief || '') + '\n' + String(safeStory.castNotes || ''), scenePages, seatsInState: stateView(windowInfo && windowInfo.budgetTokens).whole || /(^|\n)Elsewhere: /.test(stateFacts || '') /* M542: the seats ride in the ledger's own block whenever its "Elsewhere:" made it in — the people say a tracked person's where once, there */ }); /* M281: in the room the storyteller has; M282: the brief weighs who matters; M292: a seat said once */
  const peopleText = people ? people.text : '';
  /* M510-11: THE STORY IN SHORT — a small model reads eight pages; the rest of the tale reached it only as the plan's
   * three facts from earlier. The helper keeps the whole story the way a person remembers it (under 180 words, rewritten
   * each page from the whole record and thirty pages), and it rides at the head of the notes. */
  const storyShort = smallB && typeof smallPlan.story === 'string' ? smallPlan.story.trim() : '';
  if (storyShort) pushSlot('The story in short', storyShort, 'sent inside “Our story so far” as “In brief, as I remember it”: the planning helper keeps it every page — the whole story as a person remembers it (small model)');
  if (peopleText) {
    const t = people.tiers;
    const said = [];
    if (t.cards) said.push(t.cards + (t.cards === 1 ? ' card' : ' cards') + ' for who is here');
    if (t.also) said.push('the rest of the room in a line');
    if (t.recall) said.push(t.recall + ' named or on their way, not in the scene');
    if (t.important) said.push(t.important + ' away who matter most');
    if (t.roster) said.push('the roster of the absent');
    pushSlot('On their mind', peopleText, 'the character ledger', said.join('; '));
  }

  /* --- 5. The state of things --- */
  /* M510-2: a small model gets the ledger's own compact view (the scene first) — the whole ledger stays with the helper */
  let facts = stateFacts; /* M345: referee off = the storyteller decides everything; no fight is kept for it */ /* M266: in the room the storyteller has; M305: what the scene is about calls back what someone here learned long ago */
  pushSlot('The state of things', facts, smallB ? 'the ledger, its compact view — the scene first; the helper read the rest (small model); sent after the people, nearest the pages' : 'the ledger — sent after the people, nearest the pages');

  /* --- 6. Active modules (everything selected that isn't the craft) --- */
  const active = selected.filter(({ mod }) => mod && mod.id !== 'core-craft');
  const activeText = active
    .map(({ mod }) => mod.name + '\n\n' + inPerson(inVoice(mod.text, voice), person)) /* M327: a woken rule speaks in the same names as the craft */
    .filter((s) => s.trim())
    .join('\n\n---\n\n');
  pushSlot(
    'Active modules',
    activeText,
    '',
    active.map(({ mod, reason }) => mod.name + ' (' + reason + ')').join('; ')
  );

  /* (M510-37..52: the notes ride as the last system block — or his chosen role — after canon: our story so far, the plans,
   * the people, the state of things.) Slots 5–7 once rode together as ONE user-role message at the FRONT of the
   * messages array, marked [story-state] so the storyteller can tell it
   * apart from dialogue. All empty → no injection at all. M10: the
   * showrunners' standing texts ride in the same dynamic tail, after the
   * lore shelf, still before history. */
  /* M495: THE SIDE VOICES SPEAK AS THE WRITER'S NOTES, NEVER AS A THIRD AUTHORITY. "Episode 2 — the director's marching
   * orders:" over a screenplay form in capitals (PREMISE —, BEATS —, NPC & WORLD INITIATIVE —), and "NORTH STAR:" over
   * a numbered critique, reached the storyteller as another system issuing orders — the shape his teller's thinking
   * once called "an assistant system" (M379). They are his plan and his notes, said in his voice, through the same
   * voice pass as the craft; the ledger's own panels keep their working labels. */
  const DIRECTOR_LABELS = [[/^PREMISE\s*[—–:-]\s*/gm, 'What it is about: '], [/^QUESTION\s*[—–:-]\s*/gm, 'The question it answers: '], [/^BEATS\s*[—–:-]\s*/gm, 'The beats: '],
    [/^NPC\s*&\s*WORLD\s+INITIATIVE\s*[—–:-]\s*/gm, 'What the world does on its own: '], [/^LANDING\s*[—–:-]\s*/gm, 'How it can land: '], [/^HOOK\s*[—–:-]\s*/gm, 'The thread to plant early: '], [/^ARC\s*[—–:-]\s*/gm, 'The longer arc, one step: ']];
  const naturalDirector = (t) => {
    let out = String(t || '').trim();
    if (!out) return '';
    out = out.replace(/^Episode\s+(\d+)\s+—\s+the director[’']s marching orders:\s*/i, 'Episode $1 — where I want this episode to go (my plan; the scene still moves by what people want):\n');
    for (const [re, words] of DIRECTOR_LABELS) out = out.replace(re, words);
    return inPerson(inVoice(out, voice), person);
  };
  const naturalEditor = (t) => {
    const lines = String(t || '').trim().split('\n').filter((l) => l.trim());
    if (!lines.length) return '';
    const out = ['My notes on the telling, for the pages ahead — never something to mention on the page:'];
    for (const l of lines) {
      if (/^NORTH STAR:\s*/i.test(l)) out.push('What matters most right now: ' + l.replace(/^NORTH STAR:\s*/i, ''));
      else out.push('- ' + l.replace(/^\d+[.)]\s*/, ''));
    }
    return inPerson(inVoice(out.join('\n'), voice), person);
  };
  const directorText = typeof directorNote === 'string' ? naturalDirector(directorNote) : '';
  const editorText = typeof editorEye === 'string' ? naturalEditor(editorEye) : '';
  /* M88: the house's eye — the last page's slips against the craft's
   * mechanical laws (agents/lint.js), for this one turn's recolor. */
  const eyeText = typeof houseEye === 'string' ? houseEye.trim() : '';
  /* M11: the referee's ruling rides last in the dynamic tail — the freshest,
   * most binding word, sitting closest to the history it governs. */
  const rulingText = typeof ruling === 'string' ? ruling.trim() : '';
  /* M548: CHOICES MATTER — the choice he took, settled before he chose, rides first in the closing words where the referee's
   * ruling would (the referee does not rule on it); what his choices set in motion rides in his notes. Off: both empty. */
  const choiceText = choicesOn === true && choiceTaken ? outcomeWords(choiceTaken, mcNameOf(state)) : '';
  const echoText = choicesOn === true && typeof choiceEchoes === 'string' ? choiceEchoes.trim() : '';
  /* M29: the world agent's word — after the lore, before the showrunners:
   * it is a fact block about the world, and the director's note governs
   * what to do with it. */
  const worldText = typeof worldBrief === 'string' ? worldBrief.trim() : '';
  const stateParts = [];
  /* M346: CANON VERIFICATION'S NOTE leads the briefing — where the extension itself puts it in SillyTavern (depth 9999,
   * the player's voice: the top, before any recency), so who these canon people are is read before anything else.
   * Its label goes: here it is one part of the writer's own notes. Empty (the switch off) = nothing. */
  /* M356: the sensors' one line — what the readings noticed drifting, said as the writer would say it, once */
  const sensorLine = typeof sensorNote === 'string' && sensorNote.trim() ? toTeller(sensorNote.trim(), voice) : '';
  const canonWhole = typeof canonNote === 'string' && canonNote.trim() ? canonNote.trim().replace(/^[^\n]{0,42}'s note — /, '').replace(/^./, (c) => c.toUpperCase()) : '';
  const canonText = canonOnPages && canonWhole ? canonOffPages(canonWhole, peopleText) : canonWhole; /* M518 */
  /* M516: WHERE OUR STORY BEGAN IN CANON — the moment a #story began at, and what was true of that world then (asked
   * once, alone: agents/canonstart.js). A storyteller that knows every fact still writes each person at their strongest
   * memory ("Yuta — abroad"); this is the timestamp. It rides for every storyteller, big or small, beside canon's note. */
  const canonStartText = typeof canonStart === 'string' ? canonStart.trim() : '';
  if (canonStartText) stateParts.push(canonStartText);
  if (canonText) stateParts.push(canonText);
  /* M281: THE PEOPLE RIDE. The character ledger's block was built, and counted
   * on the receipt as "On their mind", since M12 — and never put in the
   * request: the storyteller has told every page without the people's pages.
   * It leads the story-state, just before the state of things. */
  if (peopleText) stateParts.push(PEOPLE_HEAD + '\n' + peopleText);
  if (facts) stateParts.push(facts);
  /* M510-39: the rules a scene wakes are instructions — they ride in the system, their own block after who's here, never in
   * the notes (whatever role he gives the notes) */
  /* M750: OUR STORY SO FAR — the record itself. A frontier storyteller reads it whole, each line once (planRecordSelection);
   * a small one reads its focused part (M510-14/M510-53). No second telling of the story rides beside it. */
  const recordCap = Number.isFinite(windowInfo?.recordCap) ? windowInfo.recordCap : Math.max(SMALL_RECORD_CHARS, (inputRoom(windowInfo) || 0) * 3 * 0.25);
  const sourceVisible = history.filter(m => m && !m.hidden);
  /* M752: the record's lines as the caller handed them (chat.js hands every line, mem.nodes) — null when it hands none and
   * the record comes as text alone */
  const handedNodes = Array.isArray(windowInfo?.nodes) ? windowInfo.nodes.filter(n => n && typeof n === 'object' && Array.isArray(n.span)) : null;
  const validNodes = (handedNodes || []).filter(n => n.correction || boundRecord(n, sourceVisible));
  const recordThrough = windowInfo?.recordThrough ?? Infinity;
  /* M752: A LINE WHOSE PAGES CHANGED IS WITHHELD, AND COUNTED. M737 holds back a line whose pages no longer read as they did
   * when it was written (its source binding: edited, reordered, gone) until the keeper reads it again in its place
   * (memory.js repairInvalidRecordSources). With every line held back the record's whole text rode instead (every page told
   * twice when the window reached back too), and with some held back the part still said "everything that came before".
   * They are counted here, so the part and its row say how many wait. */
  const withheldNodes = uniqueRecords((handedNodes || []).filter(n => !n.correction && n.span[1] < recordThrough && !validNodes.includes(n)));
  const recordPlan = planRecordSelection({ nodes: validNodes, state, small: Boolean(smallB), through: recordThrough, cap: memory ? recordCap : 0 });
  const recordNodes = recordPlan.list;
  /* no line handed (a caller that hands the record as text alone): the record's text, its newest within a small model's room
   * (M510-14) — as before M750. M752: lines handed and all held back is not that — the text holds those very lines. */
  const smallRecord = smallB ? handedNodes ? recordPlan.recent : { nodes: [], ...newestLines(memoryText, Math.min(recordCap, SMALL_RECORD_CHARS)) } : null;
  const presentRecord = recordPlan.present;
  const selectedRecordNodes = [...recordPlan.recent.nodes,...(presentRecord?.nodes || []),...recordPlan.corrections];
  const selectedIds = new Set(selectedRecordNodes.map(recordId));

  /* M510-48: HIS "RESEARCH IT AND INJECT IT" — the older lines this scene names (the last pages and his move: the M344
   * scoring, a name that is everywhere counting for nothing), given whole under their own pages, for the teller to weigh.
   * M750: only lines the request does not already carry are called back — with the whole record riding there are none; the
   * passages of the pages his move names still come back, word for word (excerptNodes, below). */
  let earlierRows = ''; let earlierCalled = 0; let smallSinceRows = ''; let pastRows = ''; let leftOut = 0; /* M511: each part's lines exactly as they ride — the receipt's words */
  const withheld = memoryText ? withheldNodes.length : 0; /* M752: only where the record rides at all (the probe sizes the request without it) */
  let pastGaps = []; /* M752: the words under "Our story so far" for what it does not carry (a frontier storyteller) */
  let recalledNodes = []; /* M511: the older lines called back, as the record's own lines (each rendered as it rides) */
  let excerptNodes = []; /* M750: the lines whose own pages give the passages his move brings up, word for word (M737) */
  let recallSmart = 0; /* M510-50 */
  if (smallB || memoryText) {
    const lastUserH = [...(Array.isArray(messages) ? messages : [])].reverse().find((m) => m && m.role === 'user' && !m.hidden);
    const sceneH = [...recentPages, lastUserH ? String(lastUserH.text || '') : ''].filter(Boolean);
    const namesH = [...(Array.isArray(state && state.present) ? state.present.map((p) => (typeof p === 'string' ? p : p && p.name)) : []), mcNameOf(state)].filter(Boolean);
    const older = recordNodes.filter(n => !n.correction && !selectedIds.has(recordId(n)));
    const picked = recallFromRecord(older, sceneH, { ignore: namesH, max: HYBRID_RECALL_LINES });
    const wholeOf = (hit) => (hit ? older.find((n) => recordId(n) === hit.id) || null : null); /* the recall cuts a line to a glimpse — the line itself rides whole */
    const byWords = [...new Set((Array.isArray(picked) ? picked : []).map(wholeOf).filter(Boolean))];
    /* M510-50: and the lines the smart recall named — his move read for what it means, not only its words; each the
     * record's own line, never said twice */
    const named = [...new Set((Array.isArray(recallPicked) ? recallPicked : []).map((id) => older.find((n) => recordId(n) === id)))]
      .filter((n) => n && !byWords.includes(n))
      .sort((a, b) => a.span[0] - b.span[0]);
    const within = [];
    let used = 0;
    const pickRoom = Math.min(recordCap,Math.max(smallB ? SMALL_PICK_CHARS : HYBRID_RECALL_CHARS, inputRoom(windowInfo) * 3 * (smallB ? 0.03 : 0.08)));
    for (const n of [...named, ...byWords]) {
      const size = recordLine(n).length + 1; /* measured as it rides, its detail with it (M511) */
      /* M510-59 (his: "what if my fold is every 10, 20 or 30 pages?"): the first line called back always rides, however long —
       * unless it alone is more than the whole record's room (M737's bound). M737 had dropped the first-line rule, so a long
       * fold his move named never came back at all. */
      if (within.length ? used + size > pickRoom : size > recordCap) continue;
      within.push(n);
      used += size;
    }
    recallSmart = named.filter((n) => within.includes(n)).length;
    recalledNodes = within.sort((a, b) => a.span[0] - b.span[0]);
    for (const n of recalledNodes) { selectedIds.add(recordId(n)); selectedRecordNodes.push(n); }
    /* M750: THE PASSAGES HIS MOVE BRINGS UP, WORD FOR WORD, STAY. They are read from the pages of the lines his move names
     * (M737) — under the hybrid those were the older lines it called back; now the whole record rides for a frontier
     * storyteller and nothing is called back, so the lines his move names are found among the lines it carries (the same
     * word scoring, a name that is everywhere counting for nothing). Only the original passages are added — never a line. */
    if (smallB) excerptNodes = recalledNodes;
    else {
      const told = recordNodes.filter((n) => !n.correction);
      const hits = recallFromRecord(told, sceneH, { ignore: namesH, max: HYBRID_RECALL_LINES });
      const sceneNamed = (Array.isArray(hits) ? hits : []).map((hit) => (hit ? told.find((n) => recordId(n) === hit.id) || null : null)).filter((n) => n && selectedIds.has(recordId(n)));
      excerptNodes = uniqueRecords([...recalledNodes, ...sceneNamed]);
    }
  }
  /* M750: the passages his move brings up, from the pages of the lines in excerptNodes (above). M751: made here, before the
   * part they belong to is built — they are the past, and stand inside "Our story so far" right after its lines (M737 had
   * put them after the state of things, so the storyteller read "here now" and then a page from long ago) */
  const historical = historicalPassages({ history, nodes: excerptNodes, pages: wireable(history,pageFilter), move: recentPages.at(-1) || '', cap: Math.min(6000,recordCap / 4) });
  /* M750: said plainly — the page it is from and that it is the past; a page's internal id and "authorized wire view"
   * (M737) meant nothing to a storyteller */
  const historicalText = historical.map(p => 'From page ' + (p.ordinal + 1) + ', word for word — the past, not the scene now:\n' + p.text).join('\n\n');
  let historicalPlaced = false;
  /* M510-22: THE PLANS STANDING — laid out on the page, kept whole by the plans keeper until carried out: part by part, with
   * the exact words to be said. A summary retells history; a plan is what is still to happen, and every part of it matters. */
  const plansSelected = selectStanding(smallPlansBook, { move: recentPages.at(-1) || '', scene: recentPages.join('\n'), state, through:history.filter(m => m && !m.hidden).length, cap: Math.min(recordCap,Math.max(6000,inputRoom(windowInfo) * 3 * 0.06)) });
  const standingText = renderStanding(smallPlansBook, { selected: plansSelected }).trimEnd(); /* M510-48: every storyteller, whenever a plan stands; M751: no stray blank line after it */

  /* M510-51: OUR STORY SO FAR, ONE PART, READ IN ONE WAY — his look at the raw request: "does the storyteller understand
   * 'the 54 older lines are in the essentials above, each kept whole on the device'? … even I am confused". ONE part, "Our
   * story so far", that says first how to read it, then the lines; the plans; and it stands in the order a storyteller
   * needs: after canon, the past; then the plans; then the people's minds and the state of things now — nearest the pages.
   * M750: for a frontier storyteller the part is the record itself — every line once, in the order it happened, the older
   * lines this scene names in their own place among them; when the context cannot hold every line, the part says how many
   * are left out, so a gap is never read as "nothing happened". */
  if (smallB && (storyShort || (smallRecord && smallRecord.text) || (presentRecord && presentRecord.text) || recalledNodes.length || recordPlan.corrections.length || standingText || withheld)) {
    /* M510-53: THE SMALL MODEL'S STORY SO FAR — the helper's story in short; in full, the record's newest lines (each with
     * its pages); the people here in the pages just before the eight (filled in below, once the window is known); the
     * earlier moments that matter now; the plans. Past first — the people's minds and the state of things now follow it,
     * nearest the pages. */
    const sinceNodes = smallRecord.nodes;
    const spanOf = (list) => (list.length ? 'pages ' + (list[0].span[0] + 1) + '–' + (list[list.length - 1].span[1] + 1) : '');
    /* M511: each line as it rides (recordLine: its detail beneath it), and the receipt's rows are these very words */
    /* M750: a correction reads last in the record's own list (memory.js orderedLines) — here, at the foot of the newest lines,
     * never under "earlier moments with the people here" */
    smallSinceRows = sinceNodes.length || recordPlan.corrections.length ? [...sinceNodes,...recordPlan.corrections].map((n) => '- ' + recordLine(n)).join('\n')
      : (smallRecord && smallRecord.text ? smallRecord.text.split('\n').map((l) => (/^\s*•/.test(l) ? '  ' + l.trim() : '- ' + l.replace(/^\s*-\s*/, '').trim())).filter((l) => l !== '- ').join('\n') : ''); /* the record handed over without its lines' pages: as it stands, a detail kept beneath its line */
    const earlierNodes = uniqueRecords([...(presentRecord?.nodes || []),...recalledNodes]).sort((a, b) => a.span[0] - b.span[0]);
    earlierRows = earlierNodes.map((n) => '- ' + recordLine(n)).join('\n');
    earlierCalled = earlierNodes.filter((n) => recalledNodes.includes(n)).length;
    const block = [
      withheld ? SMALL_PAST_HEAD + '\n' + withheldWords(withheld) : SMALL_PAST_HEAD, /* M752: a line held back is said, never a silent gap */
      storyShort ? 'In brief, as I remember it:\n' + storyShort : '',
      /* M751: "the newest of it" only when older lines rest — a record that fits whole is not called its newest part */
      smallSinceRows ? 'In full' + (smallRecord.rested ? ', the newest of it' : '') + (sinceNodes.length ? ' (' + spanOf(sinceNodes) + ')' : '') + ':\n' + smallSinceRows : '',
      RECENT_HERE_MARK,
      earlierRows ? EARLIER_HEAD + '\n' + earlierRows : '',
      historicalText,
      standingText ? PLANS_HEAD + '\n' + standingText : '',
    ].filter(Boolean).join('\n\n');
    historicalPlaced = Boolean(historicalText);
    const at = canonText && stateParts.includes(canonText) ? stateParts.indexOf(canonText) + 1 : 0;
    stateParts.splice(at, 0, block);
  } else if (!smallB && (memoryText || standingText)) {
    const shown = uniqueRecords([...recordPlan.recent.nodes,...recalledNodes]).sort((a, b) => a.span[0] - b.span[0]);
    const shownIds = new Set(shown.map(recordId));
    leftOut = recordNodes.filter((n) => !n.correction && !shownIds.has(recordId(n))).length;
    pastRows = [...shown,...recordPlan.corrections].map((n) => '- ' + recordLine(n)).join('\n');
    /* M752: what is missing is said under the heading — lines with no room, and lines held back while they are written again;
     * "everything that came before" only when nothing is */
    pastGaps = [leftOut ? leftOutWords(leftOut) : '', withheld ? withheldWords(withheld) : ''].filter(Boolean);
    const past = handedNodes
      ? (pastRows || pastGaps.length ? (pastGaps.length ? PAST_HEAD_PART + '\n' + pastGaps.join('\n') : PAST_HEAD) + (pastRows ? '\n' + pastRows : '') : '')
      : memoryText; /* no line handed (see smallRecord above): the record's text rides as the keeper wrote it, under its own header — as before M750 */
    if (!handedNodes) pastRows = memoryText;
    const block = [
      past,
      historicalText,
      standingText ? PLANS_HEAD + '\n' + standingText : '',
    ].filter(Boolean).join('\n\n');
    historicalPlaced = Boolean(historicalText);
    const at = canonText && stateParts.includes(canonText) ? stateParts.indexOf(canonText) + 1 : 0;
    if (block) stateParts.splice(at, 0, block);
  }
  /* the final audit: the lore is reference, as canon is — the world's standing facts, woken by the pages; it stands with
   * canon before our story so far, not between the state of things and the pages (M510-60) */
  if (loreText) {
    const lorePart = 'The lore shelf, woken by the latest pages:\n' + loreText;
    const atLore = canonText && stateParts.includes(canonText) ? stateParts.indexOf(canonText) + 1 : 0;
    stateParts.splice(atLore, 0, lorePart);
  }
  if (echoText) {
    const peopleAt = peopleText ? stateParts.indexOf(PEOPLE_HEAD + '\n' + peopleText) : -1;
    const factsAt = facts ? stateParts.indexOf(facts) : -1;
    const at = peopleAt !== -1 ? peopleAt : factsAt;
    if (at === -1) stateParts.push(echoText); else stateParts.splice(at, 0, echoText);
  }
  if (worldText) stateParts.push(worldText); /* the brief leads with its own name; M510-12: a small model reads it too */
  if (directorText) stateParts.push(directorText); /* M495: it opens in his own words ("Episode 2 — where I want this episode to go") — no third party's label */
  if (editorText) stateParts.push(editorText); /* M495: "My notes on the telling…" — his, not an editor's */
  if (eyeText) stateParts.push(toTeller(eyeWithoutRuleNames(eyeText, voice, person), voice)); /* the eye speaks its own name — M327: and the teller's */
  if (historicalText && !historicalPlaced) stateParts.push(historicalText); /* never lost: a request whose story so far was not built */
  if (historicalText) pushSlot('Historical original excerpts',historicalText,'sent inside “Our story so far”, after its lines: a passage or two from the pages of the lines your move brings up, word for word');
  const stateInjection = stateParts.length
    ? { role: 'user', content: briefingOpening(voice) + '\n\n' + stateParts.join('\n\n') }
    : null;

  /* --- 7. What remains (M6) — the newest memory nodes; then (M7) the lore
   * hits, sharing the slot's budget. The receipt lists each sub-part only
   * when it has something to say; M9 names the lore entries that fired. --- */
  /* M752: lines held back while they are written again, said on the row as on the wire */
  const withheldRow = withheld ? withheld + ' ' + (withheld === 1 ? 'line' : 'lines') + ' left out while the keeper writes ' + (withheld === 1 ? 'it' : 'them') + ' again — ' + (withheld === 1 ? 'its pages were' : 'their pages were') + ' changed after ' + (withheld === 1 ? 'it was' : 'they were') + ' written' : '';
  if (!smallB && (pastRows || pastGaps.length)) {
    /* M750: the record itself, every line once — the row holds exactly the lines of the part */
    pushSlot('What remains', pastRows, 'sent as “Our story so far”, after canon: ' + (leftOut || withheld ? 'your record, each line once, oldest first — ' + (leftOut ? 'as much of it as this connection’s context holds' : 'all but the lines being written again') : 'your whole record, each line once, oldest first'),
      [leftOut ? leftOut + ' older ' + (leftOut === 1 ? 'line' : 'lines') + ' left out — no room in this connection’s context' + (recalledNodes.length ? '; ' + recalledNodes.length + ' older ' + (recalledNodes.length === 1 ? 'line' : 'lines') + ' your newest move brings up ' + (recalledNodes.length === 1 ? 'rides' : 'ride') + ' in place' + (recallSmart ? ' (' + recallSmart + ' named by the smart recall)' : '') : '') : '', withheldRow].filter(Boolean).join('; '));
  } else if (smallB && (smallSinceRows || (smallRecord && smallRecord.text) || withheld)) {
    /* M510-14: the keeper's record rides for a small model too, its newest folds first (M510-9 held it back) */
    pushSlot('What remains', smallSinceRows || smallRecord.text, 'sent inside “Our story so far” as “In full, the newest of it”: what the keeper has folded of the older pages — the newest, up to about 4,000 tokens (small model)', [smallRecord.rested ? smallRecord.rested + ' older lines rest outside this page — read by the planning helper, and called back when your move names them' : '', withheldRow].filter(Boolean).join('; '));
  }
  if (loreText) {
    pushSlot(
      'The lore shelf',
      loreText,
      'entries whose keys were spoken in the latest pages',
      firedNames.length ? 'spoke: ' + firedNames.join(', ') : ''
    );
  }

  /* --- M10: the showrunners' slots — their own receipt names, in the
   * dynamic tail before history; empty = omitted (the slot-7 law). --- */
  /* M486: the row stands whenever canon verification is ON for the tale — with the note, or empty with the reason it
   * had nothing to say (the writer could not tell whether canon ran at all) */
  /* M752: the row names the plans that were SENT (selectStanding: at most STANDING_SHOWN, the most relevant, in the room) and
   * counts the ones still standing that were not — it listed every standing plan's title, sent or not */
  if (standingText) {
    const notSent = standingPlans(smallPlansBook).filter((p) => !plansSelected.includes(p)).length;
    pushSlot('Plans standing', standingText, 'the plans keeper — each plan laid out on the page, kept whole until it is carried out or dropped', plansSelected.map((p) => p.title).join('; ') + (notSent ? ' — ' + notSent + ' more ' + (notSent === 1 ? 'plan stands' : 'plans stand') + ', not sent this page (fewer bear on this scene, or no room); kept until carried out' : '')); /* M510-22 */
  }
  /* M510-21; M511: one row for the one part the request sends — its lines exactly as they ride */
  if (earlierRows) {
    const ofPeople = presentRecord && presentRecord.text ? 'the record’s own lines that name the people here (the newest few of each), word for word while they are here' : '';
    const called = earlierCalled ? earlierCalled + (earlierCalled === 1 ? ' older line' : ' older lines') + ' your newest move brings up' + (recallSmart ? ' (' + recallSmart + ' of them named by the smart recall for what your move means)' : '') : '';
    pushSlot('Earlier moments, in full', earlierRows, 'sent inside “Our story so far” as “In full, earlier moments that matter now”: ' + [ofPeople, called].filter(Boolean).join('; and '), presentRecord && presentRecord.who ? presentRecord.who.join(', ') : '');
  }
  if (canonStartText) pushSlot('Where our story began', canonStartText, 'the helper placed your #story in its canon — the moment, and what was true of that world then; Settings → This story to correct it');
  if (canonText) pushSlot('What canon says', canonText, 'canon verification — the series’ wiki on the canon people in this scene');
  else if (canonOn) pushSlot('What canon says', '', '', canonWhy || 'canon verification gave no note this turn');
  /* M510-12: THE WORLD'S WORD RIDES FOR A SMALL MODEL TOO. M510-2 left it to the helper — and it is the one brief of
   * what could reach THIS scene (the party across town, who is on the way, and why) and the only word a window beyond
   * the page is written from: the window rule woke and asked for a cut-away the small model had never been told about. */
  if (worldText) {
    pushSlot('The world’s word', worldText, 'the world agent’s brief — what could reach this scene, what ripened out of sight');
  }
  /* M510-13: the episode's plan, his standing notes and the last page's slips ride for a small model too — each short,
   * each his own switch, and a small model is the one that most needs to hear what its last page got wrong */
  if (directorText) {
    pushSlot('The director’s note', directorText, 'the showrunner’s marching orders for the episode that stands');
  }
  if (editorText) {
    pushSlot('The editor’s eye', editorText, 'the standing craft critique');
  }
  if (eyeText) {
    pushSlot('The house’s eye', eyeText, 'the last page’s slips against the craft, checked in code — recolored this turn');
  }
  if (echoText) pushSlot('What your choices set in motion', echoText, 'Choices matter — what the choices you took left behind, in your notes: it still stands and will come back');
  if (choiceText) pushSlot('Your choice', toTeller(choiceText, voice), 'Choices matter — what follows the choice you took, sealed before you chose; first in the closing words, where a ruling would be');
  if (rulingText && safeSettings.refereeOn !== false) {
    pushSlot('The house has ruled', rulingText, 'the referee’s settled outcome for this turn — first in the closing words, right after your page');
  } else if (safeSettings.refereeOn === false) {
    pushSlot('The house has ruled', '', '', 'the referee is off (Settings → The referee) — your storyteller decides every outcome'); /* M513: said exactly */
  } else if (typeof refereeWhy === 'string' && refereeWhy.trim()) {
    pushSlot('The house has ruled', '', '', refereeWhy.trim()); /* M513: why nothing was settled this page */
  }

  /* --- 9. The note at the end --- (resolved before slot 8 so the window
   * law's keeper-off budget can count what the prefix already spent) */
  const notePicked = notePickedEarly;
  /* M379: the starter note is in the standing words now; only a note HE wrote stands at the end */
  /* M620: HIS NOTES ABOVE IT. Each note he adds (Settings → The note at the end → Notes above it) rides in the note at the
   * end, above his own note, in the order he added them — only while the note itself is sent (noteOn, and its small-model
   * switch); one he unticks is held back. With no note of his own (the starter note lives in the standing words) they
   * stand at the end alone. */
  /* M624: "Send the note at the end" is HIS note's switch alone — his: "can I still deactivate my persona note and
   * activate the additional notes?" Each added note rides by its own tick. */
  const noteAdds = addedNotes(safeSettings.noteAdds, { ooc: oocTurn }).map((n) => ({ ...n, text: inVoice(housePassFor(n.text, voice, person), voice) })); /* M751: the house's words, in the craft's voice for a teller with a self */
  const noteOwn = notePicked.source === 'the starter text' ? '' : notePicked.text;
  /* M623: in the order they ride — the notes above his note, his note, the notes below it */
  const notesAbove = noteAdds.filter((n) => n.place !== 'below');
  const notesBelow = noteAdds.filter((n) => n.place === 'below');
  const noteOwnText = noteOwn && noteOwn.trim() ? inVoice(noteOwn, voice) : '';
  const noteWhole = [...notesAbove.map((n) => n.text), noteOwnText, ...notesBelow.map((n) => n.text)].filter((t) => typeof t === 'string' && t.trim()).join('\n\n');
  const countWords = (k, where) => (k === 1 ? 'your note ' + where + ' it' : 'your ' + k + ' notes ' + where + ' it');
  const noteSource = noteAdds.length
    ? [notesAbove.length ? countWords(notesAbove.length, 'above') : '', noteOwnText ? 'the note ' + notePicked.source : '', notesBelow.length ? countWords(notesBelow.length, 'below') : ''].filter(Boolean).join(', then ')
    : notePicked.source;
  const note = { ...notePicked, text: noteWhole, source: noteSource }; /* M327: "the other writer" is the writer, by name */
  const hasNote = Boolean(note.text && note.text.trim());

  /* --- 10. The continue nudge + M9 house commands --- */
  const nudges = isContinueTurn(history);
  /* M359: and it goes in front of a house command's law, so a turn that is mostly instruction (#time skip, #p, #q)
   * still opens in his teller's own voice rather than an assistant's */
  void directive; /* M379: a shortcut's law is no longer sent on its turn — it is in the standing words; his typed words travel */
  /* M375: the phrase is no longer glued to the front of a command's law — a quotation hanging before "#time skip" is
   * exactly what his teller's thinking started calling "the wrapper" */
  const directiveText = '';
  /* M752: THE WINDOW IS PLANNED IN THE FINAL FIT'S OWN MEASURE. M714 made the room the input room in transport tokens (three
   * characters a token, and the wrapper of every block and message) but left the window planned at the receipt's four
   * characters a token: every window cut to the room came out about a third too long, and the final fit took the rest out
   * one exchange at a time, measuring the whole request again each time — on a 600-page tale with the keeper off, 102 to
   * 170 rounds and over a second for every build of a send (four builds a send). Planned in the same measure, the window the
   * plan cuts is the window that goes; the final fit only checks it (and the step back to his move, and a small model's
   * eight pages, are measured the same way). */
  /* the blocks and messages besides the pages, each with its wrapper (budget.js requestTokens) — counted low rather than
   * high: what the plan leaves over the room the final fit takes back; what it leaves under would be pages lost unsaid */
  const ownWordsNow = ownWordsFor(safeSettings, voice);
  const prefixWrappers = 1 + [frameText, craftWhole, brief, whosHere, activeText].filter((t) => typeof t === 'string' && t.trim()).length
    + (stateParts.length ? 1 : 0) + ownWordsNow.length + (nudges ? 1 : 0) + (hasNote || rulingText || choiceText || echoOn ? 1 : 0);
  const prefixTokens = slots.reduce((sum, s) => sum + contentTokens(s.text || ''), 0)
    + contentTokens(hasNote ? note.text : '')
    + contentTokens(nudges ? CONTINUE_NUDGE : '')
    + contentTokens(directiveText)
    + contentTokens(echoOn ? frameText : '')
    + ownWordsNow.reduce((sum, ow) => sum + contentTokens(ow.text), 0)
    + 24 * prefixWrappers;
  const pageCost = (m) => contentTokens(typeof m.content === 'string' ? m.content : pageText(m)) + (m.image ? Number(m.image.estimatedTokens) || UNKNOWN_IMAGE_ALLOWANCE : 0) + 24;

  /* --- 8. The story so far — the verbatim window ONLY (M9, A1). Hidden
   * pages never join; the shown swipe's text is what rides. Keeper ON: the
   * memory window. Keeper OFF: a token-budgeted cutoff against the
   * connection's context room, with the cutoff named on the receipt. --- */
  const pages = wireable(history, pageFilter);
  /* M752: THE LATEST EXCHANGE, WHATEVER SHAPE IT TAKES. The window's floor (M162), a small model's cut and the final fit (M714)
   * each kept "the last two messages" — and when those were two of his (an aside and his move, "((who is Kara?))" then "I go
   * on"; or a move that got no answer and the next), the storyteller's latest page, the one they answer, was the first to go
   * under pressure (made to happen: a room for one page sent the aside and the move, and no page). What rides is everything
   * from the storyteller's latest page on — never less than the last two. */
  const mustKeepFrom = (list) => {
    let lastPage = -1;
    for (let i = list.length - 1; i >= 0; i -= 1) if (list[i] && list[i].role === 'assistant') { lastPage = i; break; }
    return Math.max(0, lastPage === -1 ? list.length - 2 : Math.min(list.length - 2, lastPage));
  };
  const w = windowInfo && typeof windowInfo === 'object' ? windowInfo : {};
  const win = windowPlan({
    pages,
    /* The keeper decides the window. Callers that don't say (older call
     * sites) get the keeper's law at the default window; a caller that
     * passes {keeperOn:false} gets the token-budgeted cutoff instead. */
    /* M752: THE WINDOW AND THE RECORD'S CUT AGREE. The coverage law reads every line the caller handed — the same lines the
     * send path read for the record's cut (chat.js verbatimStart → recordThrough). M737 handed only the lines still bound
     * to their pages: one old page changed under a line and the window reached back toward page 0 (358 messages where 32
     * went before), while the record still sent the lines past that page — a line and its pages together (M44). A line held
     * back while it is written again still holds its pages' place: the keeper rewrites it there, and until then its pages
     * are counted on the receipt as having no line riding. No line handed at all: the keeper's window as it stands (M9). */
    memory: w.keeperOn === false ? null : { window: w.window, nodes: handedNodes || undefined },
    budgetTokens: inputRoom(w),
    prefixTokens,
    cost: pageCost,
    keepFrom: mustKeepFrom(pages),
  });
  /* M510: the small request carries the last SMALL_PAGES of his story's pages word for word (and his message between
   * them), never opening on the storyteller's page; the planning helper read the rest */
  let smallWindow = smallB ? lastPagesOf(pages, SMALL_PAGES) : null;
  /* M510-23: who is here, in the pages between the eight and the record — added to the notes, and counted in the room */
  let recentOfHere = null;
  if (smallWindow && stateInjection) {
    /* a paragraph his move names already comes back beside his move (M510-13): not said twice */
    const zone = { from: coveredUntil(windowInfo && windowInfo.nodes), to: pages.length - smallWindow.length };
    const lastUserZ = [...(Array.isArray(messages) ? messages : [])].reverse().find((m) => m && m.role === 'user' && !m.hidden);
    const namesZ = [...(Array.isArray(state && state.present) ? state.present.map((p) => (typeof p === 'string' ? p : p && p.name)) : []), mcNameOf(state)].filter(Boolean);
    const byMove = recallFromPages(pages, [lastUserZ ? String(lastUserZ.text || '') : ''], { ignore: namesZ, ...zone }).map((r) => String(r.text || '').slice(0, 80));
    recentOfHere = pagesOfWhoIsHere(pages, state, { ...zone, skip: (t) => byMove.includes(t.slice(0, 80)) });
    if (recentOfHere.text) {
      stateInjection.content = stateInjection.content.includes(RECENT_HERE_MARK) ? stateInjection.content.replace(RECENT_HERE_MARK, 'In full, the people here in the pages just before the ones that follow:\n' + recentOfHere.text) : stateInjection.content + '\n\nIn full, the people here in the pages just before the ones that follow:\n' + recentOfHere.text; /* M751: never you here — the notes can be the storyteller's own notebook */ /* M510-53: inside the story so far */
      pushSlot('Who’s here, in the recent pages', recentOfHere.text, 'sent inside “Our story so far” as “In full, the people here in the pages just before the ones that follow”: the storyteller’s own paragraphs that name who is here, from the pages between the last eight and the record — word for word, while they are here (small model)', recentOfHere.who.join(', '));
      placeRow(slots, 'Who’s here, in the recent pages');
    }
  }
  /* M510-53: no paragraphs for the people here — the mark goes with its blank line */
  if (stateInjection && stateInjection.content.includes(RECENT_HERE_MARK)) stateInjection.content = stateInjection.content.replace('\n\n' + RECENT_HERE_MARK, '').replace(RECENT_HERE_MARK + '\n\n', '').replace(RECENT_HERE_MARK, '');
  const recentTokens = recentOfHere && recentOfHere.text ? contentTokens(recentOfHere.text) + 24 : 0; /* M752: the final fit's measure */
  /* and never past the room the connection names (M285/M343): the oldest of the eight go first, the window still
   * opening on his message; his message and the page before it always ride */
  /* M752: the room is the INPUT room (M714 made budgetTokens the whole context, the answer and a margin kept apart) — this
   * cut, and the step back to his move below, still measured against the whole context */
  const smallRoom = inputRoom(w);
  if (smallWindow && Number.isFinite(smallRoom)) {
    const cost = (list) => list.reduce((sum, m) => sum + pageCost(m), 0); /* M752: the final fit's measure */
    while (smallWindow.length > 2 && prefixTokens + recentTokens + cost(smallWindow) > smallRoom) {
      let cut = 1;
      while (cut < smallWindow.length - 1 && smallWindow[cut].role !== 'user') cut += 1;
      if (cut >= smallWindow.length - 1 || cut > mustKeepFrom(smallWindow)) break; /* M752: never past the latest exchange */
      smallWindow = smallWindow.slice(cut);
    }
  }
  /* M519: THE MIRROR EASED. A small model writes like its own last pages; once they are strung with sounds and dashes,
   * each page copies the last. While they are too loud, the copy it reads of its own pages has the strung-out sounds and
   * dash chains eased (smallprose.js calmPage: a sound said twice, not ten times; a chain of broken words kept to its
   * first two; the same asterisked sound once; a run of sound-only lines, one). His stored pages are never touched. */
  const eased = Boolean(smallWindow && tooLoud);
  if (eased) smallWindow = smallWindow.map((m) => (m && m.role === 'assistant' && typeof m.content === 'string' ? { ...m, content: calmPage(m.content) } : m));
  /* M510-37: THE STORY OPENS ON HIS PAGE. With the notes a user message in front, a window that began on the teller's
   * page still read user → assistant; with the notes above the story in the system, it would open on the storyteller —
   * and the window of thirty usually does (thirty back from his move lands on a page of the teller's). A strict house
   * refuses a conversation that opens on the assistant, and every model reads it oddly. So the window steps back to the
   * move of his that led to that page (the small window always has, lastPagesOf). A tale that opens on the teller's own
   * page opens on it here — the provider puts one line of his in front only where the house insists (M510-38,
   * providers/userfirst.js) */
  let storyWindow = smallWindow || win.window;
  if (!smallWindow && storyWindow.length && storyWindow[0] && storyWindow[0].role === 'assistant') {
    const at = pages.indexOf(storyWindow[0]);
    let from = at;
    while (from > 0 && pages[from] && pages[from].role !== 'user') from -= 1;
    /* final audit: only where his move FITS — the window was cut to the room (the budget with the keeper off, the stretch
     * with it on), and a long move of his stepped back over it would overflow the model's context. Where it does not fit,
     * the window stays as it was cut, opening on the teller's page; the provider opens it with his one line where a house
     * insists (providers/userfirst.js) */
    if (at > 0 && pages[from] && pages[from].role === 'user') {
      const tokensOf = (list) => list.reduce((sum, m) => sum + pageCost(m), 0); /* M752: the final fit's measure */
      const step = pages.slice(from, at);
      const room = inputRoom(w) - prefixTokens - tokensOf(storyWindow); /* M752: the input room (Infinity when the connection names none) */
      if (tokensOf(step) <= room) storyWindow = step.concat(storyWindow);
    }
  }
  const wire = storyWindow.map((m) => ({ ...m }));
  const historyText = wire.map((m) => m.content).join('\n');
  let historySource;
  if (win.mode === 'keeper') {
    /* M12: when the coverage law widened the window past its usual size,
     * the receipt says so plainly. M162: and when the room would not stretch
     * far enough, it names the pages still standing with no line. */
    const held = win.uncovered > 0
      ? ` — ${win.uncovered} older ${win.uncovered === 1 ? 'page has' : 'pages have'} no line yet and would not fit the room; the keeper fills those holes first`
      : '';
    if (win.extended > 0) {
      historySource = (win.resting > 0
        ? `${win.carried} of ${win.total} pages word for word — ${win.extended} past the usual window, still unfolded by the keeper; the older ${win.resting} are in Our story so far (the What remains row)`
        : `${win.carried} of ${win.total} pages word for word — ${win.extended} past the usual window, still unfolded by the keeper`) + held;
    } else if (win.uncovered > 0) {
      historySource = `the last ${win.carried} of ${win.total} pages word for word` + held;
    } else {
      historySource = win.resting > 0
        ? `the last ${win.carried} of ${win.total} pages word for word — the older ${win.resting} are in Our story so far (the What remains row)`
        : `all ${win.total} pages word for word`;
    }
  } else if (win.squeezed) {
    historySource = `${win.carried} of ${win.total} pages — the room this connection names is smaller than the house’s own words, so only the last exchange fits (raise the connection’s context size in Settings)`;
  } else {
    historySource = win.resting > 0
      ? `${win.carried} pages carried word for word, the rest rests (the keeper is off — only what fits the room)`
      : `${win.carried} pages carried word for word (the keeper is off — everything fit the room)`;
  }
  /* M466/M481: each of his own-voice entries is a row of its own, AT ITS LANDMARK in the receipt (the wire is the
   * same; the rows stood at the receipt's foot and read as if they rode last — his report: "the raw order is correct,
   * what the storyteller saw is weird") */
  const ownWords = ownWordsFor(safeSettings, voice);
  const ownRows = (place) => { for (const w of ownWords) if (w.place === place) pushSlot('Own words — ' + w.name, w.text, (w.role === 'assistant' ? 'the storyteller’s own words' : w.role === 'user' ? 'your words' : 'the house’s words') + ', ' + OWN_WORDS_PLACES[w.place]); };
  ownRows('before-pages');
  if (safeSettings.ownWordsHeldForSmall === true) pushSlot('Own words', '', '', 'not sent to the small model — its switch in Settings (“Send them to a small model”) is off'); /* M510-9 */
  if (safeSettings.noteAddsHeldForSmall === true) pushSlot('More notes', '', '', 'not sent to the small model — the note’s switch for a small model (“Send the note to a small model”) is off'); /* M629 */
  if (smallWindow) historySource = 'the last ' + smallWindow.filter((m) => m.role === 'assistant').length + ' pages word for word — small model; the planning helper read the whole story';
  pushSlot('The pages, word for word', historyText, win.total ? historySource + (eased ? ' — their strung-out sounds and dashes eased while the pages are too loud (your pages are kept as written)' : '') : '');
  ownRows('before-your-message');
  ownRows('after-your-message');

  /* The receipt rows for the echo (M21), 9 and 10 were computed above;
   * push them in law order now that slot 8 is counted. The echo's row sits
   * just before the note's, exactly where the repeated frame rides. */
  if (echoOn) {
    pushSlot('The frame, said again', frameText, 'the anchor against long-context fade');
  }
  pushSlot('The note at the end', hasNote ? note.text : '', note.source, hasNote ? '' : 'left empty — nothing slipped in');
  pushSlot('The continue nudge', nudges ? CONTINUE_NUDGE : '', '', nudges ? 'you only asked it to go on — sent as your own message, never a second one' : '');

  /* Assemble the wire in slot order: state injection first, then the
   * window, then the command directive (when spoken), then the nudge (when
   * it fires), then the M21 frame echo (when it's on — just before the
   * note), then the note — always last. */
  /* M321: ONE CLOSING WORD, NOT UP TO FOUR. The command's directive, the continue nudge, the frame's echo and
   * the note each rode as a separate user message after the writer's turn — more layers for the
   * storyteller to sort. They close the request as ONE message, in the same order, the note still last. */
  const out = [];
  /* M510-37: THE NOTES ARE ABOVE THE STORY, IN THE SYSTEM — his word: "I've never seen a preset put instructions in the
   * user role above the user's input; above it is all system. On #story, or any turn, another user message sat above
   * mine — the scene came out incoherent." The notes (what's on their mind, the state of things, the rules this scene
   * woke, the record, the plan's companions) rode as a USER message at the front: the model read the writer speaking
   * twice before the story began — on a tale's first turn, two user turns in a row, the notes and his #story. They are
   * the last system block now (never cached — the frame and the craft stay the stable prefix before them), so the wire
   * reads as a preset does: system above, then the story, then his move. */
  /* M510-39: HIS SWITCH FOR THE NOTES' ROLE — "the notes as user or assistant, but the modules as system: they are indeed
   * instructions; the notes are the brief, the tracker and the rest". Seat 4 is the woken rules, always system. The notes —
   * the brief, who's here, and everything that briefs (on their mind, the state of things, the record, canon, the
   * director's and editor's words, the eye…) — ride as he sets them: in the system (the default, seat 5, after the rules),
   * or as ONE message before the story, his (user) or the storyteller's own notebook (assistant). A request that then
   * opens on the assistant gets his one line first only where a house insists (providers/userfirst.js). */
  const notesRole = safeSettings.notesRole === 'user' || safeSettings.notesRole === 'assistant' ? safeSettings.notesRole : 'system';
  systemBlocks.push({ text: activeText || '', cache: false });
  let notesMessage = null;
  let notesBlock = null;
  let generatedStart = 0;
  /* M751: THE BRIEF AND THE CAST SAY WHAT THEY ARE, IN EVERY ROLE. Sent as user or assistant they were headed (M510-39); in
   * the system — his default — they rode bare, and an OpenAI-style house joins the system into one message: his brief stood
   * right after the shortcuts' last line ("…apply the recolor in the next story output.") as if it were part of it. One
   * heading for each, the same in all three roles. "The cast" (was "Who’s here"): his cast notes speak of people who are not
   * here too, and "Here now:" in the state of things says who is. */
  const BRIEF_HEAD = 'What this story is about:';
  const CAST_HEAD = 'The cast:';
  if (notesRole === 'system') {
    for (const [seat, head] of [[2, BRIEF_HEAD], [3, CAST_HEAD]]) {
      const t = systemBlocks[seat] && typeof systemBlocks[seat].text === 'string' ? systemBlocks[seat].text.trim() : '';
      if (t) systemBlocks[seat] = { ...systemBlocks[seat], text: head + '\n' + t };
    }
    if (stateInjection) { notesBlock = { text:stateInjection.content,cache:false }; systemBlocks.push(notesBlock); }
  } else {
    const opening = briefingOpening(voice);
    const told = stateInjection && stateInjection.content.startsWith(opening) ? stateInjection.content.slice(opening.length).replace(/^\n+/, '') : (stateInjection ? stateInjection.content : '');
    const briefText = systemBlocks[2] && typeof systemBlocks[2].text === 'string' ? systemBlocks[2].text.trim() : '';
    const hereText = systemBlocks[3] && typeof systemBlocks[3].text === 'string' ? systemBlocks[3].text.trim() : '';
    const parts = [briefText ? BRIEF_HEAD + '\n' + briefText : '', hereText ? CAST_HEAD + '\n' + hereText : '', told].filter(Boolean);
    if (parts.length) notesMessage = { role: notesRole, content: (notesRole === 'assistant' ? notebookOpening(voice) : opening) + '\n\n' + parts.join('\n\n') };
    if(notesMessage && told) generatedStart = notesMessage.content.lastIndexOf(told);
    systemBlocks[2] = { ...systemBlocks[2], text: '' };
    systemBlocks[3] = { ...systemBlocks[3], text: '' };
  }
  if (notesMessage) out.push(notesMessage);
  out.push(...wire);
  /* M379: THE CONTINUE NUDGE IS HIS OWN MESSAGE. He sent nothing (or tapped Continue): "Go on." used to ride in a second
   * message after the story, from the house; it now stands in HIS place — the one user message of this turn — and only
   * when nothing of his travels. */
  if (nudges) {
    const last = out[out.length - 1];
    /* M381: anything he TYPED travels as he typed it — "continue" and "keep going!" included; only an empty or hidden
     * message (the Continue button) has "Go on." stand in its place */
    const hisTravels = last && last.role === 'user' && String(last.content || '').trim();
    if (!hisTravels) {
      if (last && last.role === 'user') out[out.length - 1] = { ...last, content: CONTINUE_NUDGE };
      else out.push({ role: 'user', content: CONTINUE_NUDGE });
    } else if (goOnAfterAside(history)) {
      /* M675 (the second reading) — "GO ON" AFTER HIS OUT-OF-CHARACTER MESSAGE ASKS FOR THE STORY, AND SAYS SO. He asks
       * "((who is Kara?))", the answer fails or he lets it go, and he presses "go on" under the page before it: the
       * story is to go on. But what travelled was his question alone — word for word the request that ASKS the
       * question (measured: the two requests ended alike) — while the house kept whatever came back as a page of the
       * story and sent its readers to it. His question stays where it stands; "Go on." is said after it, as the one
       * message of this turn. (An unanswered MOVE of his is still answered as it stands: that page is the story.) */
      out.push({ role: 'user', content: CONTINUE_NUDGE });
    }
  }
  /* M636: THE SENSORS' WORD, IN THE ROLE HE CHOSE (Settings → The readers → The sensors → "Sent as"). As the storyteller's
   * own words it is a turn of the storyteller's own right before his message — where his own-voice entries stand (M466),
   * never the last thing in a request (a started reply) — and with no message of his to stand before, it is said in the
   * closing words like any other. As a system or a user message, or left as it ships, it rides in the closing words. */
  let sensorPlaced = false;
  if (sensorLine && sensorRole === 'assistant' && typeof sensorOwn === 'string' && sensorOwn.trim()) {
    let at = -1;
    for (let i = out.length - 1; i >= 0; i -= 1) if (out[i] && out[i].role === 'user' && out[i] !== notesMessage) { at = i; break; }
    if (at > 0 && out[at - 1] && out[at - 1].role === 'assistant') { out.splice(at, 0, { role: 'assistant', content: sensorOwn.trim() }); sensorPlaced = true; } /* beside a page of its own, or not at all */
  }
  const sensorSeg = sensorPlaced ? '' : sensorLine;
  if (sensorLine) pushSlot('The sensors’ word', sensorPlaced ? sensorOwn.trim() : sensorLine, sensorPlaced ? 'a rule of your craft the last pages slipped from — one line, as the storyteller’s own words, right before your message' : 'a rule of your craft the last pages slipped from — one line, then it rests'); /* M356; M636 */
  /* M466: HIS OWN-VOICE ENTRIES LAND AT THEIR LANDMARKS. "before-pages": right after the state message (or first of all
   * when there is none); "before-your-message": right before the last user message — his page of this turn, or the
   * "Go on." standing in its place; "after-your-message": after everything of the story, before the closing message.
   * An entry with nothing to stand before goes to the end. The pages themselves are never touched. */
  if (ownWords.length) {
    const asMessage = (w) => ({ role: w.role, content: w.text });
    const beforeYours = ownWords.filter((w) => w.place === 'before-your-message').map(asMessage);
    if (beforeYours.length) {
      let at = -1;
      for (let i = out.length - 1; i >= 0; i -= 1) if (out[i] && out[i].role === 'user' && out[i] !== notesMessage) { at = i; break; }
      /* M510-38: on a tale's first turn too, the entry stands where he put it — right before his message, even when that
       * opens the request on the teller's words; a house that insists on his turn first gets one line of his in front
       * (providers/userfirst.js), and no request ends on the teller's words (Claude would take them for a started reply) */
      if (at === -1) out.push(...beforeYours); else out.splice(at, 0, ...beforeYours);
    }
    const beforePages = ownWords.filter((w) => w.place === 'before-pages').map(asMessage);
    if (beforePages.length) {
      /* with no notes message to follow, an assistant entry would open the request — a thing strict houses refuse
       * (the first turn must be the user's); it steps behind his first page instead, ahead of any entry placed above */
      out.splice(notesMessage ? 1 : 0, 0, ...beforePages); /* M510-38: right after the briefing (the system, or the notes' own message — M510-39), before the first story page — where he put it */
    }
    out.push(...ownWords.filter((w) => w.place === 'after-your-message').map(asMessage));
  }
  /* M339: the switch's line — only when chat.js says this turn needs it (the switch ON and the connection's thinking off) */
  const thinkLine = safeSettings.thinkOnPageNow === true ? thinkOnPageLine(voice) : '';
  /* M342: NOTHING ABOUT THE PAGE'S SHAPE IS SAID TO THE STORYTELLER. M340 showed a young tale a skeleton (a nine-line form; M341 cut it
   * to one sentence). The writer: "it breaks my persona. If the repair is your doing then we don't need any format or example —
   * just normal as ever: my system instruction, then all normal, no persona-breaking words, then my first message." He is
   * right, and the repair IS the house's doing: ui/pageshape.js makes the page whole AFTER it arrives (brackets, the ledger's
   * ground, blank lines) and a header with no place wears its card — none of which needs one word in the request. */
  /* M343/M510: the small-model mode — the scene said once more, LAST (assemble/anchor.js). Only when chat.js says the
   * storyteller's connection is a small model. M510: the five plain lines are gone — one fought his #p ("several real
   * exchanges" against "exactly ONE beat"), one asked for "plain words" against his own onomatopoeia law, one said
   * "nothing else from me" right before his own instructions. */
  let anchorLine = '';
  let soundsLine = ''; /* M510: his two sound laws and this scene's sounds, right before the page — heated scenes only */
  if (smallB) {
    /* M510: the plan — the ledger's own hour, ground and who is here (never the helper's), then what the helper read */
    const lines = (renderStateFacts(state, { scenePages: recentPages }) || '').split('\n').map((l) => l.trim());
    const anchor = ['The hour: ', 'The ground: ', 'Here now: '].map((h) => lines.find((l) => l.startsWith(h)) || '').filter(Boolean);
    const chars = (state && state.characters) || {};
    const cores = {};
    for (const p of smallPlan.people || []) { const k = findPersonKey(chars, p.name) || p.name; const c = chars[k] && typeof chars[k].core === 'string' ? chars[k].core : ''; if (c) cores[p.name] = c; }
    anchorLine = renderPlan(smallPlan, { voice, anchor, cores, mc: mcNameOf(state) });
    /* M510-11: THE OLD FOLD HIS MOVE CALLS BACK — the record lines whose rare words this scene and his message speak (M344's
     * recall, each with its pages), word for word, at send time: the helper planned before his move and cannot know what
     * it will name. The small request carries no record, so every line of it is far here. */
    {
      const lastUserB = [...(Array.isArray(messages) ? messages : [])].reverse().find((m) => m && m.role === 'user' && !m.hidden);
      const sceneNowB = [...recentPages, lastUserB ? String(lastUserB.text || '') : ''].filter(Boolean);
      const namesB = [...(Array.isArray(state && state.present) ? state.present.map((p) => (typeof p === 'string' ? p : p && p.name)) : []), mcNameOf(state)].filter(Boolean);
      /* M750: the lines the smart recall names ride in "Our story so far" (their row, "Earlier moments, in full", says so) —
       * not with the plan, which the plan's row once claimed */
      /* M510-13: and the pages between the record's reach and the eight — neither whole nor folded for a small model. Called
       * back by HIS MESSAGE alone: the eight pages it already has would call back every paragraph that repeats the scene */
      const middle = recallPagesLine((recallFromPages(pages, [lastUserB ? String(lastUserB.text || '') : ''], { ignore: namesB, from: coveredUntil(windowInfo && windowInfo.nodes), to: pages.length - (smallWindow ? smallWindow.length : 0) })));
      if (middle) anchorLine += '\n' + middle;
    }
    /* M512: THE TURNS OF PHRASE THE LAST PAGES KEEP USING — a small model's old habit: the same four or five words written
     * page after page. Found in code on the pages this request carries (smallprose.js wornPhrases: four words or more, in
     * two pages or more, never a name, a place, small words alone or a stretched sound) and said once, in his voice: the
     * thing may be said, in new words, or not at all. */
    {
      const placeWords = state && typeof state.place === 'string' ? [state.place] : [];
      const worn = wornPhrases((smallWindow || []).filter((m) => m && m.role === 'assistant').map((m) => String(m.content || '')), { names: [...knownNames(state), ...placeWords] });
      if (worn.length) anchorLine += '\nA few turns of phrase keep coming back on the last pages — ' + worn.map((phrase) => '“' + phrase + '”').join(', ') + '. Say those things in new words this time, or leave them out.';
    }
    if (smallIntense === true || smallPlan.intense === true) {
      const wentQuiet = Boolean(lastSound && lastSound.intense === true && !lastSound.effects && !lastSound.voiced);
      soundsLine = renderSounds(smallPlan, { voice, laws: joinLaws(lawsNamed(smallLaws, SOUND_LAWS)), wentQuiet, tooLoud });
    } else if (tooLoud) {
      soundsLine = voice && voice.teller ? toTeller(breathWords(), voice) : breathWords(); /* M519: a calm page that drowned too */
    }
    /* M519-5: the last page, with people in it, went almost silent — said once, plainly */
    if (quietPage) soundsLine = [soundsLine, voice && voice.teller ? toTeller(talkWords(), voice) : talkWords()].filter(Boolean).join('\n');
    /* M519: and right where it writes next, a few lines of the story as it reads when it is right — the passage held up
     * with the craft (M512), its first paragraph; only while the pages are too loud */
    if (tooLoud && sampleText) {
      const first = sampleText.split(/\n\s*\n/)[0].trim().slice(0, 600);
      if (first) soundsLine = [soundsLine, 'How our story reads when it is right:\n' + first].filter(Boolean).join('\n');
    }
  } else if (safeSettings.smallModelNow === true) {
    /* M344: the scene's words = the last pages AND what the writer just wrote; the record's lines come from the window's nodes */
    const lastUser = [...(Array.isArray(messages) ? messages : [])].reverse().find((m) => m && m.role === 'user' && !m.hidden);
    const sceneNow = [...recentPages, lastUser ? String(lastUser.text || '') : ''].filter(Boolean);
    const presentNames = [...(Array.isArray(state && state.present) ? state.present.map((p) => (typeof p === 'string' ? p : p && p.name)) : []), mcNameOf(state)].filter(Boolean);
    const recall = recallLine(recallFromRecord(recordNodes, sceneNow, { ignore: presentNames }));
    anchorLine = sceneAnchor(state, { scenePages: recentPages, voice, recall });
  }
  /* M345: THE SETTLED OUTCOME RIDES FIRST IN THE CLOSING WORDS — right after the writer's page it settles, where Arbiter
   * puts it (depth 0: the most heeded spot; before the M345 fix it never reached the wire at all). It is the writer's
   * own word about his own move, said as a person says it, led by the teller's name; never through inVoice: its action
   * words are story text ("sneak into the house" is a house). With the referee off it is never here. */
  const rulingLine = rulingText && safeSettings.refereeOn !== false ? toTeller(rulingText, voice) : '';
  /* M358: the grounding phrase — the first words of its own thinking, asked for in his voice, right beside the thinking */
  /* M375: and no line at the end about the thinking — an order about how to think is what a teller narrates ("the user
   * wants me to open with…"), in the very voice the phrase is there to keep out. The phrase lives in the standing words
   * (who the teller IS) and, where the provider truly continues a thought, as the thought's own first words. */
  const groundLine = '';
  /* M384: HIS TWO ALWAYS CLOSE IT. The repeated main instructions and his note at the end are the last two things the
   * storyteller reads, in that order — whatever else rides after his message (the referee's outcome, a switch's line)
   * comes BEFORE them. The repeat stood second, ahead of the switches, so a think-on-page line or the sensors' word
   * could sit between his instructions and his note. (M21 always meant it "just before the note at the end".) */
  const choiceLine = choiceText ? toTeller(choiceText, voice) : ''; /* M548 */
  const closing = [rulingLine, choiceLine, directiveText, anchorLine, sensorSeg, groundLine, thinkLine, soundsLine, echoOn ? frameText : ''].filter((t) => typeof t === 'string' && t.trim());
  /* M380: WHAT FOLLOWS HIS MESSAGE IS A SYSTEM MESSAGE — SillyTavern's post-history instructions — unless he chooses
   * otherwise. As a user message it read as HIM writing a second message of instructions, and his teller answered it as
   * an assistant answers a user. */
  /* M510: the plan and the sounds wear receipt rows of their own, where they ride — just before his two */
  {
    const rows = [];
    if (smallB && anchorLine) rows.push({ name: 'The plan for this page', tokens: estimateTokens(anchorLine), source: 'the planning helper read the whole story and wrote what this scene needs — small model', reason: '', text: anchorLine });
    if (soundsLine) rows.push({ name: 'The sounds', tokens: estimateTokens(soundsLine), source: 'your two sound laws, word for word, and the sounds of this scene — a fight, sex or a raw peak', reason: '', text: soundsLine });
    if (rows.length) {
      let at = slots.findIndex((s) => s.name === 'The frame, said again' || s.name === 'The note at the end');
      if (at === -1) at = slots.length;
      slots.splice(at, 0, ...rows);
    }
  }
  const afterRole = safeSettings.afterRole === 'user' ? 'user' : 'system';
  /* M623: HIS NOTES, EACH IN ITS PLACE AND ITS ROLE. The closing words, then the notes above his note, his note, the
   * notes below it — each note as the system or user message he chose, or like the closing words (his "Sent after your
   * message as"); what stands next to the same role goes as one message, so the order is kept exactly and nothing is
   * split that need not be. */
  const segments = [
    ...closing.map((text) => ({ role: text === sensorSeg && (sensorRole === 'system' || sensorRole === 'user') ? sensorRole : afterRole, text })), /* M636: the sensors' word in its own role */
    ...(hasNote ? [...notesAbove.map((n) => ({ role: n.role || afterRole, text: n.text })), ...(noteOwnText ? [{ role: afterRole, text: noteOwnText }] : []), ...notesBelow.map((n) => ({ role: n.role || afterRole, text: n.text }))] : []),
  ];
  for (const seg of segments) {
    const prev = out.length && out[out.length - 1].__closing ? out[out.length - 1] : null;
    if (prev && prev.role === seg.role) prev.content += '\n\n' + seg.text;
    else out.push({ role: seg.role, content: seg.text, __closing: true });
  }
  for (const m of out) if (m.__closing) delete m.__closing;

  /* M510-20: EVERY ROW, EVERY PAGE — his word: "put all of what the storyteller saw, so I know everything that's being put,
   * even if it's empty". A part that did not ride this page stands in its place as a row of 0 tokens that says why. The
   * wire is untouched: rows only. */
  fillEveryRow(slots, {
    small: safeSettings.smallModelNow === true, planned: Boolean(smallB), frameOn, choicesOn: choicesOn === true,
    keeperOn: Boolean(windowInfo && windowInfo.keeperOn), keeperWindow: windowInfo && Number.isFinite(windowInfo.window) ? windowInfo.window : 30,
    hasRecord: Boolean(String(memoryText || '').trim()),
    recordWhole: leftOut === 0 && withheld === 0, /* M750: whether every line of the record rode (a frontier storyteller); M752: none held back either */
    withheld, leftOut,
  });

  /* Fit the FINAL wire, including closing notes, own words and the answer.
   * Earlier estimates only selected a candidate window. Never edit source pages
   * or cut the newest exchange, standing instructions or writer's current move. */
  /* M752: without the connection's own measure (a caller that hands none), an answer allowance it names is a limit; none named
   * is the house's assumed reserve, as a body with no max tokens is (budget.js bodyAccounting) */
  const transport = () => transportMeasure ? transportMeasure({ systemBlocks, messages: out }) : { inputTokens: requestTokens(systemBlocks,out), answerTokens: Number(w.answerTokens) > 0 ? Number(w.answerTokens) : ANSWER_RESERVE, answerEstimate: !(Number(w.answerTokens) > 0), estimate: 'conservative character estimate, wrappers included' };
  const replaceGenerated = (text,replacement) => { if(!text) return; if(notesBlock) notesBlock.text = notesBlock.text.replace(text,replacement); if(notesMessage) notesMessage.content = notesMessage.content.slice(0,generatedStart) + notesMessage.content.slice(generatedStart).replace(text,replacement); };
  // Knowledge dates use told pages, not visible message ordinals. Bind only
  // the final visible wire to its original ownership and selected version.
  let told = 0;
  const perspectiveSources = new Map(sourceVisible.map(m => {
    if (m.role === 'assistant') told++;
    return [m.id, { atTurn: m.role === 'assistant' ? told : told + 1, source: { id: m.id, version: messageVersion(m) } }];
  }));
  const refreshPerspective = () => {
    const evidence = [
      ...out.filter(m => wire.includes(m)).map(m => ({ text: m.content, historical: true, ...(!m.transformed ? perspectiveSources.get(m.id) : {}) })),
      ...uniqueRecords(selectedRecordNodes).map(n => ({ text: recordLine(n), historical: true })),
      ...historical.map(p => ({ text: p.text, historical: true, ...(!p.transformed ? perspectiveSources.get(p.sourceId) : {}) })),
    ];
    const revised = renderStateFacts(state, { ...stateFactsOptions, selectedTexts: evidence });
    replaceGenerated(facts,revised);
    const row = slots.find(s => s.name === 'The state of things');
    if (row) { row.text = revised; row.tokens = estimateTokens(revised); }
    facts = revised;
  };
  refreshPerspective();
  let accounting = transport();
  const room = inputRoom({ ...w, answerTokens: accounting.answerTokens });
  const carriedWire = wire.filter(m => out.includes(m));
  let inputTokens = accounting.inputTokens;
  let removed = 0;
  const omittedForFit = [];
  const removeGenerated = (text, name) => {
    replaceGenerated(text,'');
    const row = slots.find(s => s.name === name);
    if (row) { row.text = ''; row.tokens = 0; row.reason = 'optional historical material omitted to fit the final request'; }
  };
  if (inputTokens > room && historicalText) {
    removeGenerated('\n\n' + historicalText,'Historical original excerpts'); /* M751: with the blank line before it — they stand between parts now */
    historical.length = 0; omittedForFit.push('historical excerpts');
    refreshPerspective(); accounting = transport(); inputTokens = accounting.inputTokens;
  }
  const representedOriginal = m => {
    const i = sourceVisible.findIndex(p => p.id === m.id);
    return i >= 0 && selectedRecordNodes.some(n => !n.correction && n.span[0] <= i && n.span[1] >= i);
  };
  while (inputTokens > room && carriedWire.length > 2) {
    const groups = [];
    const keepAt = mustKeepFrom(carriedWire); /* M752: the latest exchange, whatever its shape — at most the last two before */
    for(let start=0;start<keepAt;) {
      let end = start + 1;
      while(end < keepAt && carriedWire[end].role !== 'user') end++;
      if(end > keepAt) break;
      groups.push({start,end}); start=end;
    }
    const group = groups.find(g => carriedWire.slice(g.start,g.end).every(representedOriginal)) || groups[0];
    if(!group) break;
    for (const m of carriedWire.splice(group.start, group.end-group.start)) {
      const at = out.indexOf(m);
      if (at >= 0) { out.splice(at, 1); removed++; }
    }
    refreshPerspective(); accounting = transport(); inputTokens = accounting.inputTokens;
  }

  /* M752: THE REFUSAL LINE. The pages above were sized against the comfortable answer reserve; a request is refused only past
   * the line the provider adapters refuse at too (budget.js refusalRoom): with no Max tokens on the connection, when not even
   * ANSWER_FLOOR would be left for the answer. Between the two it is sent, and the receipt says the answer had less room. */
  const refusal = refusalRoom({ budgetTokens: w.budgetTokens, answerTokens: accounting.answerTokens, answerEstimate: accounting.answerEstimate === true });
  if (!measureOnly && inputTokens > refusal) {
    const tooLarge = new Error('The current move, latest exchange and standing instructions exceed this connection’s context after reserving its answer. Increase the context size or shorten the current move or standing instructions. Your saved pages are intact.');
    tooLarge.name = 'RequestTooLarge'; /* M752: chat.js says it where a failed telling is said, with its Ask again */
    throw tooLarge;
  }
  const answerShort = inputTokens > room && inputTokens <= refusal;
  const answerRoom = Number(w.budgetTokens) > 0 ? Math.max(0, Number(w.budgetTokens) - CONTEXT_MARGIN - inputTokens) : null;
  if (removed) {
    const row = slots.find(s => s.name === 'The pages, word for word');
    if (row) {
      row.text = carriedWire.map(m => m.content).join('\n\n');
      row.tokens = estimateTokens(row.text);
    }
  }
  /* M752: THE PAGES ROW SAYS WHAT WAS SENT, AFTER THE FINAL FIT. The fit wrote over the window plan's words with "N of M
   * messages carried word for word; K older messages left out to fit … folded coverage is not assumed" — and lost what M162
   * had the row say: the older pages that no line holds. Measured: 44 of 300 pages carried, the row said 24 left out, while
   * some 230 pages between the record's last line and the window were neither on the wire nor in the record. The row is
   * said from what was sent: the pages carried (and how many were taken out to fit), and how many older pages no line in
   * this request tells — counted from the first page carried, against the lines that ride. */
  {
    const row = slots.find(s => s.name === 'The pages, word for word');
    if (row && win.total) {
      const pl = (n, one, many) => n + ' ' + (n === 1 ? one : many);
      const firstShown = carriedWire.find((m) => Number.isInteger(m.sourceOrdinal));
      const before = firstShown ? firstShown.sourceOrdinal : sourceVisible.length;
      let unfolded = 0; let waiting = 0; let untold = 0;
      if (handedNodes && !smallWindow && before > 0) {
        const mark = (list) => { const on = new Uint8Array(before); for (const n of list) for (let i = Math.max(0, n.span[0]); i <= Math.min(before - 1, n.span[1]); i += 1) on[i] = 1; return on; };
        const told = mark(handedNodes.filter((n) => !n.correction && (n.empty || selectedRecordNodes.includes(n)))); /* a fold that kept nothing worth a line holds its pages too */
        const lined = mark(handedNodes.filter((n) => !n.correction && !n.empty));
        const held = mark(withheldNodes);
        for (let i = 0; i < before; i += 1) { if (told[i]) continue; if (!lined[i]) unfolded += 1; else if (held[i]) waiting += 1; else untold += 1; }
      }
      const keeperMode = win.mode === 'keeper';
      /* with the keeper off, pages no line ever held are what "the rest rests" already says; only lines that exist and do not
       * ride are news */
      const noLine = (keeperMode ? unfolded : 0) + waiting + untold;
      const gap = !noLine ? ''
        : keeperMode && noLine === unfolded
          ? ' — ' + pl(noLine, 'older page has', 'older pages have') + ' no line yet and would not fit the room; the keeper fills those holes first' /* M162's words, where they are the whole truth */
          : ' — ' + pl(noLine, 'older page has', 'older pages have') + ' no line riding in this request: ' + [keeperMode && unfolded ? unfolded + ' not folded yet (the keeper fills those holes first)' : '', waiting ? waiting + ' under ' + (withheld === 1 ? 'a line' : 'lines') + ' being written again after the pages changed' : '', untold ? untold + ' whose lines are not in it (see What remains)' : ''].filter(Boolean).join(', ');
      const fitWords = removed ? pl(removed, 'older page', 'older pages') + ' taken out to fit the whole request and its answer' : '';
      let words;
      if (smallWindow) words = (removed ? 'the last ' + carriedWire.filter((m) => m.role === 'assistant').length + ' pages word for word — small model; the planning helper read the whole story' : historySource) + (fitWords ? ' — ' + fitWords : '');
      else if (!removed && !gap) words = historySource; /* the window plan's own words: what it planned is what went */
      else if (keeperMode) {
        const head = removed ? carriedWire.length + ' of ' + win.total + ' pages word for word — ' + fitWords
          : win.extended > 0 ? win.carried + ' of ' + win.total + ' pages word for word — ' + win.extended + ' past the usual window, still unfolded by the keeper'
          : 'the last ' + win.carried + ' of ' + win.total + ' pages word for word';
        const toldCount = handedNodes ? before - unfolded - waiting - untold : 0;
        words = head + (toldCount > 0 ? '; the older ' + toldCount + ' are in Our story so far (the What remains row)' : '') + gap;
      } else {
        words = (win.squeezed ? historySource : carriedWire.length + ' pages carried word for word, the rest rests' + (fitWords ? ' — ' + fitWords : '') + ' (the keeper is off — only what fits the room)') + gap;
      }
      row.source = words + (eased ? ' — their strung-out sounds and dashes eased while the pages are too loud (your pages are kept as written)' : '');
    }
  }
  const blockedRecords = (windowInfo?.nodes || []).filter(n => n && !n.empty && n.text?.trim() && Array.isArray(n.span) && !recordNodes.some(r => recordId(r) === recordId(n))).map(n => ({id:recordId(n),span:n.span,selected:false,available:false,reason:!n.correction && n.span[1] >= (windowInfo?.recordThrough ?? Infinity) ? 'outside folded source boundary; originals have their own selection' : 'source identity or visible version changed, derived entry pending',chars:n.text.length+(n.detail?.length||0)}));
  orderAsSent(slots, systemBlocks, out); /* M510-55: the rows in the order the request is sent */
  const stateSummary = facts ? facts.slice(0, 120) : '';
  const receipt = {
    slots,
    totalTokens: slots.reduce((sum, s) => sum + s.tokens, 0),
    stateSummary,
    selection: requestSelection({ story: safeStory, history, pages: carriedWire, nodes: recordNodes, selected: uniqueRecords(selectedRecordNodes), plans: standingPlans(smallPlansBook).map(p => ({ id:p.id || p.title, selected:plansSelected.includes(p), reason:plansSelected.includes(p) ? 'current move, participants, goals or conditions, recency as fallback' : 'outside detailed selection, remains unresolved in storage', chars:renderStanding(null,{selected:[p]}).length })), characters: people?.selected || [], excerpts: historical.map(({text,...p}) => ({...p, chars:text.length})) }),
    context: { estimate: accounting.estimate, imagesUncertain: accounting.imagesUncertain === true, answerEstimate: accounting.answerEstimate === true, inputTokens, inputRoom: Number.isFinite(room) ? room : null, answerTokens: accounting.answerTokens, removedHistory: removed, omittedForFit, cardOmissions,
      /* M752: sent with less than the answer reserve free — no Max tokens on the connection, so the provider's own default
       * stands; answerRoom is what the context leaves the answer (receiptview says it in words) */
      ...(answerShort ? { answerShort: true, answerRoom } : {}) },
  };

  receipt.selection.records.push(...blockedRecords);
  return { systemBlocks, messages: out, receipt, selection: receipt.selection };
}
