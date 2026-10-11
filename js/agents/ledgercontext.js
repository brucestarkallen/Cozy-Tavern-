/* Shared interpretation contract for the ledger readers. No model call. */
import { loadEssentials } from './essentials.js';
import { loadMemory } from './memory.js';

export const LEDGER_READER_RULES = `
SHARED LEDGER CONTRACT:
Read the whole completed scene, including quiet spectators and the writer's established identities. Follow each person's actions chronologically. Silence is not departure; mentioning a remote person is not presence. Resolve pronouns and titles in context, not by keyword matching.
The brief supplies explicit starting facts and constraints. Starting feelings and locations can develop through the story unless the writer explicitly locks them. Never reset earned developments to the opening values.
Preserve valid judgments by the responsible worker. Different plausible feelings, motives or offscreen choices are not errors. Correct factual contradictions or explicit rule violations, not personal preferences.
Scene owns physical presence, posture and event-driven relationship scores. People owns character records and interpretation of character arcs. World owns authorized offscreen simulation and quiet characters' ongoing activity. Keep those views consistent without replaying the same event or overwriting another worker's valid judgment.
For changes retain the cause and supporting quotation when available. Distinguish extracted facts from simulated developments. Retrieve missing evidence rather than inventing history. Unknown whereabouts are not permission to assert an observed location.
Before answering, reconcile your proposed changes with the current ledger and the complete turn. Keep exact established identities, titles and relationships; register an explicitly introduced person even when quiet or absent. Do not erase existing facts to make a shorter record.
`;

export async function sharedStoryContext(storyId) {
  if (!storyId) return '';
  const [ess, mem] = await Promise.all([loadEssentials(storyId), loadMemory(storyId)]);
  const end = Math.max(-1, ...(mem?.nodes || []).filter(n => Array.isArray(n.span)).map(n => n.span[1]));
  if (!ess?.text || !Number.isFinite(ess.upTo) || ess.upTo > end) return '';
  return '\nSTORY ESSENTIALS, through page ' + (ess.upTo + 1) + '. A summary, not a replacement for later evidence or the detailed record:\n' + ess.text + '\n';
}
