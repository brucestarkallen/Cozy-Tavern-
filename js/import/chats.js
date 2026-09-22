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
import { canonMetaKey } from '../canon/bridge.js';

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
  const looksLikeMessage = (row) => row && typeof row === 'object' && !Array.isArray(row)
    && (typeof row.mes === 'string' || typeof row.message === 'string');

  let title = 'An old tale, brought home';
  let firstMessageLine = 1;
  let canon = null;
  if (head && typeof head === 'object' && !Array.isArray(head)
    && head.chat_metadata && typeof head.chat_metadata === 'object') {
    /* A name for the shelf: who the tale was with, when the export says. */
    const charName = typeof head.character_name === 'string' ? head.character_name.trim() : '';
    if (charName) title = `With ${charName}`;
    /* M390: A CHAT PLAYED WITH CANON GROUNDING COMES HOME WITH ITS CANON. The extension keeps its memory in the chat's own
     * metadata (canon_grounding_*: everyone it looked up, the wiki it was bound to, the pins, the blocks, the notes, the
     * story position) — the very keys Cozy's canon memory is made of. Dropped, the tale re-looked-up everyone, found its
     * wiki again, and lost every decree he had made. */
    for (const [k, v] of Object.entries(head.chat_metadata)) {
      if (k.startsWith('canon_grounding_') && v !== undefined && v !== null) (canon || (canon = {}))[k] = v;
    }
  } else if (looksLikeMessage(head)) {
    /* M9 leniency: some exports come home without the metadata line —
     * every line is a page then, and the shelf name waits for the telling. */
    firstMessageLine = 0;
  } else {
    throw new Error(NOT_A_CHAT);
  }

  const messages = [];
  let lastTs = 0; /* M297 */
  for (let i = firstMessageLine; i < lines.length; i += 1) {
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
    const mes = typeof row.mes === 'string' ? row.mes
      : (typeof row.message === 'string' ? row.message : null);
    if (mes === null) {
      throw new Error(`Line ${lineNo} of that export has no words in it. Nothing was brought over.`);
    }
    /* The send date keeps the pages honest; when a line lacks one, fall
     * back to a steady sequence so the order still holds.
     * M297: AND THE ORDER IS THE FILE'S. SillyTavern's send_date has minute
     * resolution — a question and its answer in the same minute shared a
     * stamp, and the store sorts pages by stamp, so the pair came up in
     * whichever order their ids fell: the answer before the question. And a
     * line with no date landed at "now", after every dated page. Every page
     * is stamped strictly after the one before it; a date only moves a page
     * forward, never back. */
    const raw = typeof row.send_date === 'number' ? row.send_date : Date.parse(row.send_date);
    let ts = Number.isFinite(raw) ? raw : (lastTs ? lastTs + 1 : Date.now());
    if (ts <= lastTs) ts = lastTs + 1;
    lastTs = ts;
    messages.push({
      role: row.is_user === true ? 'user' : 'assistant',
      text: mes,
      ts,
    });
  }
  if (!messages.length) {
    throw new Error('That export holds no pages — just a cover.');
  }
  return canon ? { title, messages, canon } : { title, messages };
}

export async function importAsStory(parsed) {
  if (!parsed || !Array.isArray(parsed.messages) || !parsed.messages.length) {
    throw new Error('There’s nothing to bring over.');
  }
  const story = await db.stories.create({ title: parsed.title });
  /* M9 (B17): the pages land in ONE transaction — the import is atomic per
   * story; a full shelf or a bent row can't leave half a tale behind. If
   * the write fails, the empty cover goes too. */
  try {
    await db.messages.appendAll(story.id, parsed.messages);
    /* M390: its canon memory, as the extension kept it — part of the same all-or-nothing import */
    if (parsed.canon && typeof parsed.canon === 'object' && Object.keys(parsed.canon).length) {
      await db.settings.set(canonMetaKey(story.id), JSON.parse(JSON.stringify(parsed.canon)));
    }
  } catch (err) {
    try { await db.stories.remove(story.id); } catch (e) { /* the cover stays, empty */ }
    throw err;
  }
  return story.id;
}
