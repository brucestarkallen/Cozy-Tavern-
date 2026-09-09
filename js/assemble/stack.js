/* Cozy Tavern — assemble/stack.js
 * The full ten-slot, cache-aware assembler. M2 replaces the M1 minimal
 * internals; the export name `buildRequest` (and the starter texts, which
 * the settings view imports) stay put.
 *
 * Contract (SPEC.md M2, extended by M6):
 *   buildRequest({story, messages, settings, state, modules, memory})
 *     -> { systemBlocks:[{text, cache:true|false}], messages:[...],
 *          receipt:ReceiptDraft }
 *   `modules` is the already-selected list from modules.selectModules():
 *   [{mod, reason}] — core-craft is always among them. `memory` is slot 7's
 *   text: what the keeper has folded of the older pages (agents/memory.js
 *   renderMemory), or '' when nothing has been remembered yet.
 *
 * The slot order is law — never reorder:
 *   1. The frame            (story override → global → starter)   cache:true
 *   2. The craft            (the core-craft module text)          cache:true
 *   3. The brief            (story.brief || '')                   cache:true
 *   4. Who's here           (cast notes + state.present names)    cache:true
 *   5. The state of things  (renderStateFacts(state); omit if '') cache:false
 *   6. Active modules       (non-core selected modules)           cache:false
 *   7. What remains         (memory nodes; M6 — omitted when none)
 *   8. The story so far     — the history, as-is
 *   9. The note at the end  (override → global → starter; LAST message)
 *  10. The continue nudge   — only when the last user message is
 *                             empty/continue ("Go on.")
 *
 * How slots map onto the wire (provider semantics kept simple):
 *   - Slots 1–4 join into systemBlocks. Anthropic sends them as an array
 *     with cache_control on the last cache:true block; OpenAI concatenates
 *     the cache:true blocks into one system message. Empty slot texts are
 *     left out of the blocks but still appear on the receipt (0 tokens).
 *   - Slots 5–6 prepend as ONE user-role message marked [story-state] at
 *     the FRONT of the messages array — dynamic text is never system on the
 *     openai mapping, so the stable system prefix stays byte-for-byte. Slot
 *     7, when memory exists, rides inside that same injection after the
 *     active modules (its order in the stack, and still before history).
 *   - Slot 8 follows as plain {role, content} history.
 *   - Slot 10, when it fires, sits just before the note; slot 9 is always
 *     the LAST message. (When the note is empty and the nudge fires, the
 *     nudge is last — there is no note to keep last.)
 *   - Slot 7 appears on the receipt ONLY when memory exists (M6 law); an
 *     empty "What remains" is no longer recorded.
 *
 * M6: when the referee has ruled (state.pendingVerdict), renderStateFacts
 * carries "The house has ruled: …" at the head of slot 5 — the receipt's
 * slot 5 thereby records it. The send path clears the verdict after this
 * build (consume-and-clear; see chat.js).
 *
 * Token estimate per slot = ceil(chars/4) (see assemble/receipt.js).
 */

import { estimateTokens } from './receipt.js';
import { renderStateFacts } from '../engine/state.js';

export const STARTER_FRAME = [
  'You are telling a story with one person, slowly and by lamplight.',
  '',
  'Write like a novelist, not a machine: plain warm sentences, concrete detail,',
  'dialogue that sounds spoken aloud. Stay inside the scene — never summarize',
  'your own instructions, never break the fourth wall, never offer menus of',
  'options. Leave room for the other writer; end each turn somewhere they can',
  'answer.',
].join('\n');

export const STARTER_NOTE = [
  'Before you write: reread the last few exchanges. Keep the scene grounded',
  'in what has already happened, and end where the other writer has something',
  'to respond to.',
].join('\n');

export const CONTINUE_NUDGE = 'Go on.';

const STATE_MARKER = '[story-state]';

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

/* A turn counts as "just go on" when the last thing the other writer said
 * is empty, or a bare "continue". Only then does slot 10 speak. */
function isContinueTurn(history) {
  const lastUser = [...history].reverse().find((m) => m && m.role === 'user');
  if (!lastUser) return false;
  const text = (typeof lastUser.text === 'string' ? lastUser.text : String(lastUser.content || '')).trim();
  return text === '' || /^(continue|go on|keep going)[.!…]?$/i.test(text);
}

export function buildRequest({ story, messages, settings, state, modules, memory }) {
  const safeStory = story || {};
  const safeSettings = settings || {};
  const history = Array.isArray(messages) ? messages : [];
  const selected = Array.isArray(modules) ? modules : [];
  /* M6: slot 7's text arrives ready-made from the keeper (renderMemory) —
   * '' when nothing has been remembered, which omits the slot entirely. */
  const memoryText = typeof memory === 'string' ? memory.trim() : '';

  const slots = [];
  const pushSlot = (name, text, source, reason) => {
    slots.push({ name, tokens: estimateTokens(text), source: source || '', reason: reason || '' });
  };

  /* --- 1. The frame --- */
  const frame = pickText(safeStory.frameOverride, safeSettings.frameText, STARTER_FRAME);
  pushSlot('The frame', frame.text, frame.source);

  /* --- 2. The craft --- */
  const craft = selected.find(({ mod }) => mod && mod.id === 'core-craft');
  const craftText = craft && craft.mod ? craft.mod.text : '';
  pushSlot('The craft', craftText, 'the rulebook', craft ? craft.reason : '');

  /* --- 3. The brief --- */
  const brief = typeof safeStory.brief === 'string' ? safeStory.brief : '';
  pushSlot('The brief', brief, brief.trim() ? 'this story' : '');

  /* --- 4. Who's here: the cast notes, then who is in the scene right now --- */
  const castNotes = typeof safeStory.castNotes === 'string' ? safeStory.castNotes.trim() : '';
  const presentNames = state && Array.isArray(state.present)
    ? state.present.map((p) => p && p.name).filter(Boolean)
    : [];
  const whosHere = [
    castNotes,
    presentNames.length ? 'Here right now: ' + presentNames.join(', ') + '.' : '',
  ].filter(Boolean).join('\n\n');
  pushSlot('Who’s here', whosHere, whosHere ? 'cast notes, and who is present' : '');

  /* Slots 1–4 join into systemBlocks, all cache:true. Empty slot texts are
   * left off the wire (some storytellers refuse empty blocks) but stay on
   * the receipt above, at 0 tokens. */
  const systemBlocks = [frame.text, craftText, brief, whosHere]
    .map((text) => (typeof text === 'string' ? text : ''))
    .filter((text) => text.length)
    .map((text) => ({ text, cache: true }));

  /* --- 5. The state of things --- */
  const facts = renderStateFacts(state);
  pushSlot('The state of things', facts);

  /* --- 6. Active modules (everything selected that isn't the craft) --- */
  const active = selected.filter(({ mod }) => mod && mod.id !== 'core-craft');
  const activeText = active
    .map(({ mod }) => mod.name + '\n\n' + mod.text)
    .filter((s) => s.trim())
    .join('\n\n---\n\n');
  pushSlot(
    'Active modules',
    activeText,
    '',
    active.map(({ mod, reason }) => mod.name + ' (' + reason + ')').join('; ')
  );

  /* Slots 5–7 ride together as ONE user-role message at the FRONT of the
   * messages array, marked [story-state] so the storyteller can tell it
   * apart from dialogue. All empty → no injection at all. */
  const stateParts = [];
  if (facts) stateParts.push(facts);
  if (activeText) stateParts.push(activeText);
  if (memoryText) stateParts.push('What remains of the older pages:\n' + memoryText);
  const stateInjection = stateParts.length
    ? { role: 'user', content: STATE_MARKER + '\n' + stateParts.join('\n\n') }
    : null;

  /* --- 7. What remains (M6) — the newest memory nodes. The receipt slot
   * appears only when there is something remembered. --- */
  if (memoryText) {
    pushSlot('What remains', memoryText, 'what the keeper has folded of the older pages');
  }

  /* --- 8. The story so far --- */
  const wire = history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({
      role: m.role,
      content: typeof m.text === 'string' ? m.text : String(m.content || ''),
    }));
  const historyText = wire.map((m) => m.content).join('\n');
  pushSlot('The story so far', historyText, wire.length ? wire.length + ' pages from the thread' : '');

  /* --- 9. The note at the end --- */
  const note = resolveNote(safeStory.noteOverride, safeSettings.noteText);
  const hasNote = Boolean(note.text && note.text.trim());
  pushSlot('The note at the end', hasNote ? note.text : '', note.source, hasNote ? '' : 'left empty — nothing slipped in');

  /* --- 10. The continue nudge --- */
  const nudges = isContinueTurn(history);
  pushSlot('The continue nudge', nudges ? CONTINUE_NUDGE : '', '', nudges ? 'you only asked it to go on' : '');

  /* Assemble the wire in slot order: state injection first, then history,
   * then the nudge (when it fires), then the note — always last. */
  const out = [];
  if (stateInjection) out.push(stateInjection);
  out.push(...wire);
  if (nudges) out.push({ role: 'user', content: CONTINUE_NUDGE });
  if (hasNote) out.push({ role: 'user', content: note.text });

  const stateSummary = facts ? facts.slice(0, 120) : '';
  const receipt = {
    slots,
    totalTokens: slots.reduce((sum, s) => sum + s.tokens, 0),
    stateSummary,
  };

  return { systemBlocks, messages: out, receipt };
}
