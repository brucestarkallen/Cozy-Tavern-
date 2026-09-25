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
 *   1. (M342: REMOVED. M340 also SHOWED a young tale the page's skeleton in the closing message. It broke the writer's persona,
 *      and the two things below make it unnecessary: not one word about the page's shape is said to the storyteller.)
 *   2. tidyPage — before a page is KEPT (so it is what he reads AND what the next turn copies): a header with no
 *      brackets gets them; a header with no place gets the ledger's ground when it has one; a body whose paragraphs
 *      are parted by single newlines gets blank lines; one unbroken block is parted where speech begins. Words are
 *      never changed — only brackets, the place the ledger already holds, and white space.
 *   3. a display rule for the five-field header (regex-styles.js), for the one page where nobody knows the place yet.
 * Pure: no store, no DOM. */
import { isHeaderLine } from './headergate.js';
import { normalizeWindowMark } from '../engine/window.js'; /* M467 */

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

/* M458: THE MARKS OF SPEECH AND STRESS, MADE WHOLE IN CODE. He: "the storyteller creates formatting issues: missing
 * quotation marks, *""*... why is nothing fixing that?" Only marks, never a word, and only what is plainly broken: speech
 * wrapped in asterisks (*"..."* becomes "..."), an empty pair of quotes, a quote opened and never closed at the end of
 * its paragraph (unless the next paragraph goes on speaking, the old way of long speech), an asterisk opened and never
 * closed. A page whose marks are whole comes back to the letter. */
/* M476: A READABLE OBJECT IS SHIELDED, NOT THE WHOLE PAGE. A page that carried a phone screen (<!-- GFX_START -->…) or
 * a tracker block was skipped by every mend — so a stray quote three paragraphs above the screen stood forever, and
 * the writer asked why the agent fixes nothing. The object's own quotes and asterisks are HTML, not marks: it is
 * lifted out whole, the prose around it is mended, and it is put back to the letter. */
const SHIELD_RE = /<!--\s*GFX_START[\s\S]*?(?:<!--\s*GFX_END\s*-->|$)|```[\s\S]*?(?:```|$)|~t~\*[^\n]*?\*~\/t~|(?<=^|\n)[ \t]*\*\*\* The World Beyond \*\*\*(?=[ \t]*(?:\n|$))|[^\n]*\{(?:PULSE|WATCHLIST|VOICES)\}[\s\S]*?(?=\n[ \t]*\n|$)/g; /* M482: a private thought's markup, and the window's marker, are objects too */
export function shieldObjects(text) {
  const kept = [];
  const safe = String(text == null ? '' : text).replace(SHIELD_RE, (m) => { kept.push(m); return '\uE000' + (kept.length - 1) + '\uE001'; });
  return { safe, restore: (t) => String(t).replace(/\uE000(\d+)\uE001/g, (_, i) => kept[Number(i)] || '') };
}

export function mendMarks(text) {
  const given = String(text == null ? '' : text);
  if (!given.trim()) return { text: given, changed: false };
  const { safe: src, restore } = shieldObjects(given);
  const parts = src.split(/(\n[ \t]*\n)/);
  let changed = false;
  for (let k = 0; k < parts.length; k += 2) {
    let p = parts[k];
    const was = p;
    const nextSpeaks = k + 2 < parts.length && /^\s*[\u201c"]/.test(parts[k + 2]);
    p = p.replace(/\*+[ \t]*(["\u201c][^"\u201c\u201d\n]*["\u201d])[ \t]*\*+/g, '$1');
    /* M482: the eye's two findings, mended instead of only named — bold marks in the prose go; an ACTION wrapped in
     * asterisks (four words or more — never a sound: *bzz*, *pt-pt*, *thud-thud-thud*) loses its asterisks. Marks
     * only; the words stay to the letter. The craft: asterisks wrap contact sounds and nothing else. */
    p = p.replace(/\*\*([^*\n]+)\*\*/g, '$1');
    p = p.replace(/(?<!\*)\*([^*\n]{4,140})\*(?!\*)/g, (m, inner) => (inner.trim().split(/\s+/).length >= 4 ? inner : m));
    /* an empty pair of quotes goes, and only the spaces it leaves behind with it (a page's own white space is its own) */
    const noEmpty = p.replace(/(^|[ \t(])(?:""|\u201c[ \t]*\u201d)(?=[ \t.,!?;:)]|$)/g, '$1');
    if (noEmpty !== p) p = noEmpty.replace(/([^ \t\n])[ \t]{2,}(?=\S)/g, '$1 ').replace(/[ \t]+(?=[.,!?;:])/g, '').replace(/[ \t]+$/g, '');
    const tail = (p.match(/\s*$/) || [''])[0];
    const core = p.slice(0, p.length - tail.length);
    let fixed = core;
    const opens = (core.match(/\u201c/g) || []).length;
    const closes = (core.match(/\u201d/g) || []).length;
    if (opens === closes + 1 && core.lastIndexOf('\u201c') > core.lastIndexOf('\u201d') && !nextSpeaks) fixed += '\u201d';
    const straight = (core.match(/"/g) || []).length;
    if (straight % 2 === 1 && !nextSpeaks) {
      const at = core.lastIndexOf('"');
      /* M476: a lone quote opened after a COMMA onto a lowercase word ("…, "like someone reading the skyline…") is a
       * stray mark in narration, not speech left open — it goes; after a speech verb ('He said "stop') or onto a
       * capital it is speech and is closed, as M458 does */
      if (at > 1 && core[at - 1] === ' ' && core[at - 2] === ',' && /[a-z]/.test(core[at + 1] || '')) fixed = core.slice(0, at) + core.slice(at + 1);
      else if ((at === 0 || /[\s(\[\u2014\u2013-]/.test(core[at - 1])) && /\S/.test(core[at + 1] || '')) fixed += '"';
    }
    let single = -1;
    let count = 0;
    for (let i = 0; i < core.length; i += 1) if (core[i] === '*' && core[i - 1] !== '*' && core[i + 1] !== '*') { count += 1; single = i; }
    if (count % 2 === 1 && single !== -1 && (single === 0 || /\s/.test(core[single - 1])) && /\S/.test(core[single + 1] || '')) fixed += '*';
    p = fixed + tail;
    if (p !== was) { parts[k] = p; changed = true; }
  }
  return { text: changed ? restore(parts.join('')) : given, changed };
}

/* M476: A SOFT WRAP IS JOINED. Inside a page whose paragraphs are parted by blank lines, a lone line break followed by
 * an indent ("…closer to the towers than Dev likes —\n and the thought…"), or one that leaves a sentence hanging and
 * goes on in lowercase, is a wrap the model let through, not a paragraph: joined with one space. White space only. */
export function joinSoftWraps(text) {
  const given = String(text == null ? '' : text);
  if (!/\n[ \t]*\n/.test(given)) return { text: given, changed: false };
  const { safe, restore } = shieldObjects(given);
  const out = safe
    .replace(/([^\n])\n[ \t]+(?=[^\s\n])/g, '$1 ')
    .replace(/([a-z,;:\u2014\u2013-])\n(?=[a-z])/g, '$1 ');
  return out === safe ? { text: given, changed: false } : { text: restore(out), changed: true };
}

/* before the page is kept: brackets, the place the ledger already holds, white space — never a word */
export function tidyPage(text, { place = '' } = {}) {
  /* M467: the window's marker in the exact form, whatever dressing the model gave it ("The World Beyond" bare, bold, a
   * heading) — marks only, the three words as they are — so the 🎨 box, the readers' cut and the lint all see it */
  const given = String(text == null ? '' : text);
  const src = normalizeWindowMark(given);
  const did = src !== given ? ['window'] : [];
  const h = readHeader(src);
  if (!h) { /* M458/M476 */
    const j = joinSoftWraps(src); const m = mendMarks(j.text);
    const done = [...did]; if (j.changed) done.push('wraps'); if (m.changed) done.push('marks');
    return done.length ? { text: m.text, did: done } : { text: src, did };
  }
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
  const wrapped = joinSoftWraps(body); /* M476 */
  if (wrapped.changed) { body = wrapped.text; did.push('wraps'); }
  /* nothing of substance to mend: the page as it came, to the letter (white space alone is nobody's business) */
  const marked = mendMarks(body); /* M458 */
  if (marked.changed) { body = marked.text; did.push('marks'); }
  if (!did.length) return { text: src, did };
  const out = h.lead + '[' + inner + ']' + (body.trim() ? '\n\n' + body.replace(/\s+$/, '') : '');
  return { text: out, did };
}
