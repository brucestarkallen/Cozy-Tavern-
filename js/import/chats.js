/* Cozy Tavern — import/chats.js
 * Bring your old chats: a SillyTavern chat export (JSONL) becomes a new
 * story on the shelf — pages in order, roles as they were, prose verbatim
 * (nothing stripped, nothing rephrased). Then the tale can simply continue.
 *
 * Everything happens on this device; the file is read and parsed here.
 *
 * Contract (SPEC.md M7):
 *   parseSTChat(jsonlText) -> {title, messages:[{role:'user'|'assistant',
 *                              text, ts}]}
 *                             (throws kind, human Errors on the wrong shape)
 *   importAsStory(parsed)    -> storyId (creates the story, appends pages)
 *
 * The format: the first line is metadata ({chat_metadata, character_name,
 * user_name, …}); every line after is one message —
 * {name, is_user, mes, send_date}. is_user true → user, anything else →
 * assistant.
 */

import { db } from '../store.js';

const NOT_A_CHAT = 'That file doesn’t read like a SillyTavern chat export — no chat metadata up top.';

export function parseSTChat(jsonlText) {
  const lines = String(jsonlText || '')
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (!lines.length) {
    throw new Error('That file is empty — no chat pages inside.');
  }

  let head;
  try {
    head = JSON.parse(lines[0]);
  } catch (err) {
    throw new Error(NOT_A_CHAT);
  }
  if (!head || typeof head !== 'object' || Array.isArray(head)
    || !head.chat_metadata || typeof head.chat_metadata !== 'object') {
    throw new Error(NOT_A_CHAT);
  }

  /* A name for the shelf: who the tale was with, when the export says. */
  const charName = typeof head.character_name === 'string' ? head.character_name.trim() : '';
  const title = charName ? `With ${charName}` : 'An old tale, brought home';

  const messages = [];
  for (let i = 1; i < lines.length; i += 1) {
    const lineNo = i + 1;
    let row;
    try {
      row = JSON.parse(lines[i]);
    } catch (err) {
      throw new Error(`Line ${lineNo} of that export wouldn’t read — the file may be damaged. Nothing was brought over.`);
    }
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`Line ${lineNo} of that export doesn’t hold a message. Nothing was brought over.`);
    }
    if (typeof row.mes !== 'string') {
      throw new Error(`Line ${lineNo} of that export has no words in it. Nothing was brought over.`);
    }
    /* The send date keeps the pages honest; when a line lacks one, fall
     * back to a steady sequence so the order still holds. */
    const parsed = Date.parse(row.send_date);
    const ts = Number.isFinite(parsed) ? parsed : Date.now() + i;
    messages.push({
      role: row.is_user === true ? 'user' : 'assistant',
      text: row.mes,
      ts,
    });
  }
  if (!messages.length) {
    throw new Error('That export holds no pages — just a cover.');
  }
  return { title, messages };
}

export async function importAsStory(parsed) {
  if (!parsed || !Array.isArray(parsed.messages) || !parsed.messages.length) {
    throw new Error('There’s nothing to bring over.');
  }
  const story = await db.stories.create({ title: parsed.title });
  for (const msg of parsed.messages) {
    await db.messages.append(story.id, msg);
  }
  return story.id;
}
