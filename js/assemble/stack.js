/* Cozy Tavern — assemble/stack.js
 * The M1 minimal assembler. M2 replaces the internals with a full,
 * position-aware stack — this interface must not change:
 *
 *   buildRequest({story, messages, settings}) -> {system, messages}
 *
 * M1 rules (SPEC.md):
 *   system   = The Frame (story override || global default || shipped starter)
 *   messages = story history, with The Note at the End appended as a final
 *              user-role message — only when the note text is non-empty.
 */

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

function pickText(storyOverride, globalText, starter) {
  if (typeof storyOverride === 'string' && storyOverride.trim()) return storyOverride;
  if (typeof globalText === 'string' && globalText.trim()) return globalText;
  return starter;
}

/* The note resolves differently from the frame: once the user has touched
 * the global note, their word stands — even if they cleared it to nothing.
 * Only an untouched note falls back to the shipped starter. A per-story
 * override wins whenever it holds real text. */
function resolveNote(storyOverride, globalText) {
  if (typeof storyOverride === 'string' && storyOverride.trim()) return storyOverride;
  if (typeof globalText === 'string') return globalText;
  return STARTER_NOTE;
}

export function buildRequest({ story, messages, settings }) {
  const safeStory = story || {};
  const safeSettings = settings || {};
  const history = Array.isArray(messages) ? messages : [];

  const system = pickText(safeStory.frameOverride, safeSettings.frameText, STARTER_FRAME);
  const note = resolveNote(safeStory.noteOverride, safeSettings.noteText);

  const wire = history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({ role: m.role, content: typeof m.text === 'string' ? m.text : String(m.content || '') }));

  /* The Note at the End: appended as a final user-role injection only when
   * non-empty. M1 contract placeholder — M2 makes it position-aware. */
  if (note && note.trim()) {
    wire.push({ role: 'user', content: note });
  }

  return { system, messages: wire };
}
