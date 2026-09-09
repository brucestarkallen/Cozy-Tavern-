/* Cozy Tavern — import/cards.js
 * Bring your people: read a SillyTavern character card — a PNG with the
 * character tucked inside a tEXt/iTXt chunk, or a plain JSON card — and
 * shelve it in the cast library. Stories then invite cast members in from
 * the ledger's Who's here (story.castIds).
 *
 * Everything happens on this device. The file is read here, parsed here,
 * and — only when you say so — written into the local store. Nothing
 * uploads.
 *
 * Contract (SPEC.md M7):
 *   parseCard(fileOrText)  -> Card   (throws kind, human Errors)
 *   Card = {id, name, description, personality, scenario, firstMes,
 *           creatorNotes, alternateGreetings:[], source:'png'|'json',
 *           importedAt}
 *   listCast() / saveCastMember(card) / removeCastMember(id)
 *   attachToStory(storyId, cardId) / detachFromStory(storyId, cardId)
 *
 * The cast library is app-wide (one settings key per card, `cast:<id>`, so
 * backups carry it). Stories hold only the ids of who they've invited;
 * letting go of a cast member un-invites them everywhere.
 */

import { db } from '../store.js';

const KEY_PREFIX = 'cast:';

function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/* ---------- the PNG chunk walker ---------- */

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(bytes) {
  return bytes.length >= 8 && PNG_SIG.every((b, i) => bytes[i] === b);
}

/* The PNG CRC (over the chunk's type and data), table-built once. A card
 * chunk whose numbers don't add up is a damaged page — we say so kindly
 * rather than read it half-blind. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function ascii(bytes, from, to) {
  let out = '';
  for (let i = from; i < to; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

const DAMAGED = 'That picture’s character page is damaged — it wouldn’t read whole.';
const NO_CHARACTER = 'That picture doesn’t carry a character.';

/* Walk the chunks looking for a tEXt or iTXt chunk whose keyword is
 * 'chara'. Returns the chunk's text as bytes, or null when the picture
 * simply doesn't carry a character. Throws the damaged error when the
 * file is cut short, or when the chara chunk's own CRC disagrees. */
async function findCharaText(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const len = view.getUint32(offset);
    const type = ascii(bytes, offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > bytes.length) throw new Error(DAMAGED); // cut short mid-chunk

    if (type === 'tEXt' || type === 'iTXt') {
      const data = bytes.subarray(dataStart, dataEnd);
      const nul = data.indexOf(0);
      const keyword = nul === -1 ? '' : ascii(data, 0, nul);
      if (keyword === 'chara') {
        /* This is the page we came for — hold it to its word (CRC). */
        if (crc32(bytes.subarray(offset + 4, dataEnd)) !== view.getUint32(dataEnd)) {
          throw new Error(DAMAGED);
        }
        if (type === 'tEXt') {
          return data.subarray(nul + 1);
        }
        /* iTXt: keyword NUL, compression flag, compression method,
         * language NUL, translated keyword NUL, then the text (UTF-8,
         * zlib-compressed when the flag says so). */
        const flag = data[nul + 1] || 0;
        let rest = data.subarray(nul + 3); // flag + method bytes, then the language tag
        const langEnd = rest.indexOf(0);
        rest = rest.subarray(langEnd + 1);
        const translatedEnd = rest.indexOf(0);
        rest = rest.subarray(translatedEnd + 1);
        if (flag === 1) {
          rest = await inflate(rest);
        }
        return rest;
      }
    }
    if (type === 'IEND') break;
    offset = dataEnd + 4;
  }
  return null;
}

/* Compressed iTXt, when a card writer bothered. DecompressionStream is
 * there in browsers and modern Node; if it can't manage, the page reads
 * as damaged rather than guessed at. */
async function inflate(bytes) {
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  } catch (err) {
    throw new Error(DAMAGED);
  }
}

/* ---------- base64 → JSON → Card ---------- */

function b64ToText(b64) {
  const clean = String(b64).replace(/\s+/g, '');
  const bin = atob(clean); // throws on anything that isn't base64
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/* v2 cards wrap the real fields in `data` (spec: chara_card_v2); older
 * cards keep them at the top. Either way we read the same six shelves. */
const CARD_FIELDS = ['name', 'description', 'personality', 'scenario', 'first_mes',
  'creator_notes', 'creatornotes', 'alternate_greetings', 'spec'];

function cardFromPayload(payload, source) {
  let data = payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)
    && payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    data = payload.data;
  }
  if (!data || typeof data !== 'object'
    || (data === payload && !CARD_FIELDS.some((f) => f in payload))) {
    throw new Error(source === 'png'
      ? 'The character tucked into that picture wouldn’t read — it doesn’t look like a card.'
      : 'That file doesn’t read like a character card.');
  }
  const greetings = Array.isArray(data.alternate_greetings)
    ? data.alternate_greetings.filter((g) => typeof g === 'string' && g.trim()).map((g) => g.trim())
    : [];
  return {
    id: uid(),
    name: asText(data.name) || 'An unnamed soul',
    description: asText(data.description),
    personality: asText(data.personality),
    scenario: asText(data.scenario),
    firstMes: asText(data.first_mes),
    creatorNotes: asText(data.creator_notes != null ? data.creator_notes : data.creatornotes),
    alternateGreetings: greetings,
    source,
    importedAt: Date.now(),
  };
}

function cardFromJsonText(text) {
  let payload;
  try {
    payload = JSON.parse(String(text || ''));
  } catch (err) {
    throw new Error('That file wouldn’t open — it doesn’t read like JSON. Is it a character card?');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('That file doesn’t read like a character card.');
  }
  return cardFromPayload(payload, 'json');
}

async function cardFromPng(bytes) {
  const textBytes = await findCharaText(bytes);
  if (!textBytes) throw new Error(NO_CHARACTER);
  let payload;
  try {
    payload = JSON.parse(b64ToText(new TextDecoder('utf-8').decode(textBytes)));
  } catch (err) {
    if (err && err.message === DAMAGED) throw err;
    throw new Error('The character tucked into that picture wouldn’t read — the words inside aren’t whole.');
  }
  return cardFromPayload(payload, 'png');
}

/* Accepts a browser File (PNG or JSON), a JSON text string, or — for the
 * harness — raw bytes (ArrayBuffer / Uint8Array). What a thing IS is read
 * from its contents, not its name. */
export async function parseCard(fileOrText) {
  if (typeof fileOrText === 'string') return cardFromJsonText(fileOrText);
  let bytes = null;
  if (fileOrText && typeof fileOrText.arrayBuffer === 'function') {
    bytes = new Uint8Array(await fileOrText.arrayBuffer());
  } else if (fileOrText instanceof ArrayBuffer) {
    bytes = new Uint8Array(fileOrText);
  } else if (ArrayBuffer.isView(fileOrText)) {
    bytes = new Uint8Array(fileOrText.buffer, fileOrText.byteOffset, fileOrText.byteLength);
  }
  if (!bytes) {
    throw new Error('That file wouldn’t open — choose a card picture (PNG) or a JSON card.');
  }
  if (!isPng(bytes)) {
    /* Perhaps a .json card chosen from the picker — the bytes are text. */
    return cardFromJsonText(new TextDecoder().decode(bytes));
  }
  return cardFromPng(bytes);
}

/* ---------- the cast library (app-wide; stories hold castIds) ---------- */

export async function listCast() {
  const keys = await db.settings.keys();
  const castKeys = keys.filter((k) => typeof k === 'string' && k.startsWith(KEY_PREFIX));
  const cards = [];
  for (const key of castKeys) {
    const card = await db.settings.get(key);
    if (card && typeof card === 'object' && typeof card.name === 'string') cards.push(card);
  }
  /* Steadiest shelf order: whoever arrived first sits leftmost. */
  return cards.sort((a, b) => (a.importedAt || 0) - (b.importedAt || 0));
}

export async function saveCastMember(card) {
  if (!card || typeof card !== 'object' || !card.id) return null;
  await db.settings.set(KEY_PREFIX + card.id, card);
  return card;
}

export async function removeCastMember(id) {
  if (!id) return;
  await db.settings.delete(KEY_PREFIX + id);
  /* …and un-invite them everywhere — stories hold only the id. */
  const all = await db.stories.list();
  for (const story of all) {
    const ids = Array.isArray(story.castIds) ? story.castIds : [];
    if (ids.includes(id)) {
      await db.stories.update(story.id, { castIds: ids.filter((c) => c !== id) });
    }
  }
}

export async function attachToStory(storyId, cardId) {
  if (!storyId || !cardId) return undefined;
  const story = await db.stories.get(storyId);
  if (!story) return undefined;
  const ids = Array.isArray(story.castIds) ? story.castIds.slice() : [];
  if (!ids.includes(cardId)) ids.push(cardId);
  return db.stories.update(storyId, { castIds: ids });
}

export async function detachFromStory(storyId, cardId) {
  if (!storyId || !cardId) return undefined;
  const story = await db.stories.get(storyId);
  if (!story) return undefined;
  const ids = Array.isArray(story.castIds) ? story.castIds : [];
  if (!ids.includes(cardId)) return story;
  return db.stories.update(storyId, { castIds: ids.filter((c) => c !== cardId) });
}

/* Additive helper (the way store.js keeps its own): the cards a story has
 * invited, resolved to full Card objects — the assembler's slot 4 reads
 * these. Missing cards (let go since) are simply skipped. */
export async function castForStory(story) {
  const ids = story && Array.isArray(story.castIds) ? story.castIds : [];
  const cards = [];
  for (const id of ids) {
    const card = await db.settings.get(KEY_PREFIX + id);
    if (card && typeof card === 'object' && typeof card.name === 'string') cards.push(card);
  }
  return cards;
}
