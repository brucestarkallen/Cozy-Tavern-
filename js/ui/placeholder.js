/* Cozy Tavern — js/ui/placeholder.js
 * M382: one repair, run once. From m379 to m381 the store dropped the `typed` field and a bare "#story" was saved as
 * the house's placeholder "A new tale — you choose it." — which the storyteller was then sent as his message. Every
 * such page is put back to what he typed. Exact text only; nothing else is touched. */
import { db } from '../store.js';

export const STORY_PLACEHOLDER = 'A new tale — you choose it.';
const DONE_KEY = 'm382PlaceholderRepaired';

export async function repairStoryPlaceholder({ force = false } = {}) {
  if (!force && (await db.settings.get(DONE_KEY)) === true) return 0;
  let fixed = 0;
  const tales = (await db.stories.list()) || [];
  for (const tale of tales) {
    if (!tale || !tale.id) continue;
    const pages = (await db.messages.list(tale.id)) || [];
    for (const m of pages) {
      if (!m || m.role !== 'user' || String(m.text || '').trim() !== STORY_PLACEHOLDER) continue;
      await db.messages.update(tale.id, m.id, { text: '#story', typed: '#story' });
      fixed += 1;
    }
  }
  await db.settings.set(DONE_KEY, true);
  return fixed;
}
