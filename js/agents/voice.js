/* Cozy Tavern — agents/voice.js
 * M21: the one standing line every worker prompt carries. The workers —
 * extractor, scribe, keeper, continuity reader, referee, housekeeper, and
 * the showrunners — all read pages of a shared fiction; their task is only
 * ever their own small job, never a judgment of the tale itself. This frame
 * is prepended to every worker system prompt so no worker ever steps out of
 * the fiction to refuse or moralize at it (SPEC.md M21 §D — the workers
 * never break the fiction).
 */
export const FICTION_FRAME = 'This is fiction craft for a tale being written together; your work is only the task below — never judgment of the tale.';

/* The frame, joined ahead of a worker's own system prompt. */
export function withFictionFrame(system) {
  return FICTION_FRAME + '\n\n' + String(system || '');
}
