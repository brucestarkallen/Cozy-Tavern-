/* Shared interpretation contract for the ledger readers. No model call. */
import { loadEssentials } from './essentials.js';
import { loadMemory } from './memory.js';

// Shared reading procedure, executed inside the existing worker call.
// This is not another auditor or a source-certificate requirement.
export const SCENE_ENDING_TASK = `
DERIVE THE COMPLETED SCENE BEFORE COMPARING WITH THE NOTEBOOK:
Start with the header as opening context, then follow the narration in order. For each person whose position, clothes or physical condition is established or changed, track the actor, recipient and resulting state. Resolve pronouns from the action and viewpoint, not from the nearest proper name. A blow delivered by one person can hurt the other person.
Discard intermediate states replaced later in the sequence. A retreat followed by a stop leaves the person at the stopping point; an outfit removed later is no longer worn. A quiet person's last established state continues while others act. Read the whole scene, not only its final paragraph. People in a separate World Beyond window remain elsewhere.
Only after deriving those ending states compare them with the saved ledger. Earlier wording appearing anywhere on the page does not make it current. Do not invent motion, injury, recovery or a change in feelings. Preserve facts the scene did not change.
`;

export const LEDGER_READER_RULES = `
SHARED LEDGER CONTRACT:
Read the whole completed scene, including quiet spectators and the writer's established identities. Follow each person's actions chronologically. Silence is not departure; mentioning a remote person is not presence. Resolve pronouns and titles in context, not by keyword matching.
The opening header is not an ending position. For every physical position select the person's LAST established movement or stopping point, including pronoun actions, then check that no later action changes it. A subsequent paragraph about another person does not move this person. Preserve clothing unless later evidence changes it. Apply this chronology to Scene extraction before saving, not only to the auditor.
The brief supplies explicit starting facts and constraints. Starting feelings and locations can develop through the story unless the writer explicitly locks them. Never reset earned developments to the opening values.
Preserve valid judgments by the responsible worker. Different plausible feelings, motives or offscreen choices are not errors. Correct factual contradictions or explicit rule violations, not personal preferences.
People core answers WHO the person is: established role/rank, family, background, enduring nature, voice and preferences. A sentence about an escort assignment or a single action is evidence, not a complete identity. Recover missing established details even when core is nonempty. Lasting physical facts such as hair, eyes, build and scars belong in canon locks (What's true of them); current clothes and pose belong in Scene. Compare both stores with original sources, fetch earlier pages when needed, and never invent an unstated trait or rank. A model-written summary is not a source quotation.
An explicitly stated own persona is the same main character, not an absent NPC. Use mc.alias with the writer's exact identity statement when newly established; all workers share those aliases. Never infer identity from roles or imagined impersonation.
The main character belongs to the writer. The housekeeper may record their explicitly written identity and biography from the original brief, cast notes or writer pages into core, preserving existing writer facts. This is a factual record, never permission to invent their personality or arc. Other workers maintain their state and threads and leave factual biography recovery to the housekeeper. Never demand an invented biography to finish an audit.
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
