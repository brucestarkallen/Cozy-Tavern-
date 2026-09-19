/* Cozy Tavern — pageshape.js
 * M340: THE FIRST PAGES OF A TALE, FOR A MODEL THAT DOES NOT THINK.
 *
 * The writer, two screenshots: the header he loves — a card: 📍 place, the date and hour, the light, what MC wears, where
 * he stands — and the header a non-thinking model gave him on a tale's first page: "Saturday, June 14, 2025 | 08:12 |
 * ☀️ sun through the glass doors… | joggers, t-shirt | leaning at the counter" — five fields, NO PLACE, so none of his
 * header rules (they all want six) dressed it; and under it the prose came with no paragraphs. "A non-thinking model is
 * only good in the middle of a story. At the start it breaks so many things."
 *
 * WHY THE MIDDLE IS FINE AND THE START IS NOT: in the middle every earlier page in front of the model IS the shape —
 * a model that does not reason copies what it sees. On page one there is nothing to copy; the shape exists only as a
 * sentence inside seventy thousand characters of rules. A thinking model works that sentence out. The other needs to
 * be SHOWN. Three things, none of them a setting:
 *   1. shapeReminder — while a tale is young (fewer than three storyteller pages) or its LAST page came out of shape,
 *      the closing message carries the page's skeleton, literally: the bracketed six-field header, a blank line, and
 *      paragraphs with a blank line between them. It stops by itself once the tale's own pages carry the shape.
 *   2. tidyPage — before a page is KEPT (so it is what he reads AND what the next turn copies): a header with no
 *      brackets gets them; a header with no place gets the ledger's ground when it has one; a body whose paragraphs
 *      are parted by single newlines gets blank lines; one unbroken block is parted where speech begins. Words are
 *      never changed — only brackets, the place the ledger already holds, and white space.
 *   3. a display rule for the five-field header (regex-styles.js), for the one page where nobody knows the place yet.
 * Pure: no store, no DOM. */
import { isHeaderLine } from './headergate.js';

const DATEISH = /^(?:\p{Extended_Pictographic}\s*)?(?:mon|tues|wednes|thurs|fri|satur|sun)day\b|^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d|^\d{4}-\d{2}-\d{2}|^\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/iu;
const FENCED = /<!--\s*GFX_START|\{PULSE\}|\{WATCHLIST\}|\{VOICES\}|```/;

/* the header line at the top of a page, read into its parts */
export function readHeader(text) {
  const src = String(text == null ? '' : text);
  const lead = src.match(/^\s*/)[0];
  const rest = src.slice(lead.length);
  const nl = rest.indexOf('\n');
  const line = (nl === -1 ? rest : rest.slice(0, nl)).trimEnd();
  if (!line || !isHeaderLine(line)) return null;
  const bracketed = /^\[.*\]$/.test(line);
  const inner = bracketed ? line.slice(1, -1).trim() : line.replace(/^\[|\]$/g, '').trim();
  const fields = inner.split('|').map((f) => f.trim());
  const first = fields[0] || '';
  const dashed = /\s[—–-]{1,3}\s/.test(first);
  /* six pipe-fields, or five with "Place — Date" in the first: the place is there. Five (or fewer) opening on a date: it is not. */
  const hasPlace = fields.length >= 6 || (dashed && !DATEISH.test(first)) || (!DATEISH.test(first) && fields.length >= 5 && !dashed ? false : dashed);
  const missingPlace = !hasPlace && DATEISH.test(first);
  return { line, bracketed, inner, fields, hasPlace, missingPlace, after: nl === -1 ? '' : rest.slice(nl + 1), lead };
}

/* how a page stands: is its header whole, are its paragraphs parted */
export function shapeOf(text) {
  const h = readHeader(text);
  const body = h ? h.after : String(text || '');
  const trimmed = body.trim();
  const blank = /\n[ \t]*\n/.test(trimmed);
  const lines = trimmed ? trimmed.split('\n').filter((l) => l.trim()).length : 0;
  const paragraphs = !trimmed ? 'none' : blank ? 'parted' : lines >= 3 ? 'single-newlines' : trimmed.length > 900 ? 'one-block' : 'short';
  return { header: Boolean(h), whole: Boolean(h && h.bracketed && h.hasPlace), bracketed: Boolean(h && h.bracketed), missingPlace: Boolean(h && h.missingPlace), paragraphs, sound: Boolean(h && h.bracketed && h.hasPlace) && (paragraphs === 'parted' || paragraphs === 'short' || paragraphs === 'none') };
}

/* before the page is kept: brackets, the place the ledger already holds, white space — never a word */
export function tidyPage(text, { place = '' } = {}) {
  const src = String(text == null ? '' : text);
  const did = [];
  const h = readHeader(src);
  if (!h) return { text: src, did };
  let inner = h.inner;
  const ground = String(place || '').replace(/[\[\]|\n]/g, ' ').replace(/\s+/g, ' ').trim();
  if (h.missingPlace && ground) { inner = ground + ' — ' + inner; did.push('place'); }
  if (!h.bracketed) did.push('brackets');
  let body = h.after.replace(/^\s*\n/, '').replace(/^\n+/, '');
  const trimmed = body.trim();
  if (trimmed && !FENCED.test(trimmed) && !/\n[ \t]*\n/.test(trimmed)) {
    const lines = trimmed.split('\n').filter((l) => l.trim());
    if (lines.length >= 3) { body = lines.map((l) => l.trim()).join('\n\n'); did.push('paragraphs'); }
    else if (lines.length === 1 && trimmed.length > 900) {
      /* one unbroken block: a new paragraph where speech begins after a finished sentence */
      const parted = trimmed.replace(/([.!?…]["”’)]?)[ \t]+(?=["“][^\s])/g, '$1\n\n');
      if (parted !== trimmed) { body = parted; did.push('paragraphs'); }
    }
  }
  /* nothing of substance to mend: the page as it came, to the letter (white space alone is nobody's business) */
  if (!did.length) return { text: src, did };
  const out = h.lead + '[' + inner + ']' + (body.trim() ? '\n\n' + body.replace(/\s+$/, '') : '');
  return { text: out, did };
}

/* the skeleton, shown — the writer speaking (a user-role line) */
export function shapeReminder({ mc = '' } = {}) {
  const given = String(mc || '').trim();
  const who = given && given.toLowerCase() !== 'the player' ? given : 'the main character';
  return [
    'The shape of the page — exactly this, every time:',
    '',
    '[Place, the exact spot — Weekday, Month D, YYYY | HH:MM | weather and light, 2-5 words | what ' + who + ' wears | where ' + who + ' is, what he is doing]',
    '',
    'A paragraph of the scene.',
    '',
    '"Speech opens its own paragraph," she said.',
    '',
    'Another paragraph. The header is ONE line in square brackets and always opens with the place; a blank line stands between every two paragraphs.',
  ].join('\n');
}

/* does this turn need the skeleton? `pages` = the tale's storyteller pages so far (their kept text), oldest first */
export const YOUNG_TALE_PAGES = 3;
export function needsShapeReminder(pages) {
  const list = (Array.isArray(pages) ? pages : []).filter((t) => typeof t === 'string' && t.trim());
  if (list.length < YOUNG_TALE_PAGES) return true;
  return !shapeOf(list[list.length - 1]).sound;
}
