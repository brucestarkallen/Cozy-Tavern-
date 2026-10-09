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
import { TAG_TAIL_SOURCE } from '../regex.js'; /* M524 */
import { isHeaderLine } from './headergate.js';
import { normalizeWindowMark, WINDOW_LINE } from '../engine/window.js'; /* M467; M510-34 */

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
  /* M510-17: a header in another dress loses the dress (bold, a heading mark) and, with no "|" at all, gains one before
   * its hour — "[Hillside cemetery — Tuesday, March 4, 2026 | 22:31]", the shape the ledger reads the ground and hour from */
  let inner = bracketed ? line.slice(1, -1).trim() : line.replace(/^[ \t>*_#`]+/, '').replace(/[ \t*_`]+$/, '').replace(/^\[|\]$/g, '').trim();
  if (!bracketed && !inner.includes('|')) inner = inner.replace(/[ \t]*(?:[—–,-][ \t]*)?(\b\d{1,2}[:.]\d{2}\b)/, ' | $1').replace(/^ \| /, '');
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
const SHIELD_RE = /<!--\s*GFX_START[\s\S]*?(?:<!--\s*GFX_END\s*-->|$)|```[\s\S]*?(?:```|$)|~t~\*[^\n]*?\*~\/t~|\*~t~[^\n]*?~\/t~\*|(?<=^|\n)[ \t]*\*\*\* The World Beyond \*\*\*(?=[ \t]*(?:\n|$))|[^\n]*\{(?:PULSE|WATCHLIST|VOICES)\}[\s\S]*?(?=\n[ \t]*\n|$)/g; /* M482: a private thought's markup, and the window's marker, are objects too */
export function shieldObjects(text) {
  const kept = [];
  const safe = String(text == null ? '' : text).replace(SHIELD_RE, (m) => { kept.push(m); return '\uE000' + (kept.length - 1) + '\uE001'; });
  return { safe, restore: (t) => String(t).replace(/\uE000(\d+)\uE001/g, (_, i) => kept[Number(i)] || '') };
}

/* M498: A PRIVATE THOUGHT IN ITS EXACT FORM. The craft asks for ~t~*…*~/t~ ("exact markup, no variations"); the model
 * wrote "~t~Okay — okay, he's — oh.~" — no asterisks, closed with a bare "~" — and the display, which needs the closing
 * "t", showed the raw marks. Within one line: an opener ~t~ (with or without its asterisk), the words, and whatever
 * closer the model wrote — ~/t~, ~\t~, /t~, a bare ~, *~/t~ without the opener's asterisk — or none before the line
 * ends, is written in the exact form. The two exact forms (~t~*…*~/t~ and *~t~…~/t~*) are left to the letter. Marks
 * only; the thought's words stay as they are.
 * M506: THE EXACT FORMS ARE SHIELDED FIRST. M498 judged "exact" only after its one regex had matched — and a bare "~"
 * INSIDE a well-formed thought's words ("~t~*Nya~*~/t~", "~t~*Hello~ she thinks*~/t~") was taken as the closer, so the
 * thought was cut there and its real closer left standing as an orphan; the page repair runs on every kept page and on
 * every open (M488), so it rewrote pages that were right. Now both exact forms are taken out of the text before the
 * broken shapes are looked at, and the shape that mend made of such a thought (~t~*W*~/t~ + R + *~/t~ on one line, the
 * lost character being the ~ itself) is put back together, so a page it had already touched heals on the next open. */
const EXACT_THOUGHT_RE = /~t~\*[^\n]*?\*~\/t~|\*~t~[^\n]*?~\/t~\*/g;
const MANGLED_ONE_RE = /~t~\*([^\n]*?)\*~\/t~((?:(?!~t~)[^\n*])*?)\*~\/t~/g; /* ~t~*W*~/t~R*~/t~ → ~t~*W~R*~/t~ (R carries no emphasis: a second thought written with its closer only is left as it was) */
const MANGLED_TWO_RE = /\*~t~\*([^\n]*?)\*~\/t~((?:(?!~t~)[^\n*])*?)~\/t~\*/g; /* *~t~*W*~/t~R~/t~* → *~t~W~R~/t~* */
/* M509-16: AN OPENER THAT LOST ITS SECOND TILDE. "~tHe's very handsome. They wouldn't believe this.~" — the model wrote
 * "~t" straight into the words and closed with a bare "~"; there was no "~t~" anywhere on the page, so the mend never
 * looked, and the marks stood on the page under a green light. Within one line, "~t" followed by the thought's first
 * letter (or its asterisk or quote) and closed by any closer the model writes — a bare ~, ~/t~, /t~ — is given back its
 * opener, and the mend below writes it in the exact form. A "~t" with no closer on its line is left alone (a tilde
 * before a word is not a thought). */
/* M510-32: …and the closer written back to front — "~t/~", "t/~" — is a closer too */
const LOST_OPENER_RE = /~t(?!~)(?=[*\p{L}\u2018\u2019'"“”])((?:(?!~t~)[^\n~])*?)(~[\/\\]t~|[\/\\]t~|~t[\/\\]~|(?<![A-Za-z])t[\/\\]~|~)(?!~)/gu;
export function mendThoughts(text) {
  const src0 = String(text == null ? '' : text);
  const src = /~t(?!~)(?=[*\p{L}\u2018\u2019'"“”])/u.test(src0) ? src0.replace(LOST_OPENER_RE, (m, words, closer) => '~t~' + words + closer) : src0;
  if (!/~t~/i.test(src)) return src;
  const kept = [];
  const shielded = src
    .replace(MANGLED_ONE_RE, (m, w, r) => '~t~*' + w + '~' + r + '*~/t~')
    .replace(MANGLED_TWO_RE, (m, w, r) => '*~t~' + w + '~' + r + '~/t~*')
    .replace(EXACT_THOUGHT_RE, (m) => { kept.push(m); return '\uE002' + (kept.length - 1) + '\uE003'; });
  const mended = shielded.replace(/(\*?)~t~(\*?)((?:(?!~t~)[^\n\uE002])*?)(\*?)(~[\/\\]t~|[\/\\]t~|~t[\/\\]~|(?<![A-Za-z])t[\/\\]~|~(?![\/\\]?t~)|(?=~t~)|(?=\uE002)|$)(\*?)/gim, (m, pre, openStar, words, closeStar, closer, post) => {
    const inner = String(words || '').trim();
    if (!inner) return m; /* nothing to wrap */
    const trail = closer ? '' : String(words || '').slice(String(words || '').trimEnd().length); /* a closer that is the next thought or the line's end keeps the space before it */
    return (pre && post ? '' : pre) + '~t~*' + inner + '*~/t~' + (pre && post ? '' : post) + trail;
  });
  return mended.replace(/\uE002(\d+)\uE003/g, (_, i) => kept[Number(i)] || '');
}

export function mendMarks(text) {
  const original = String(text == null ? '' : text);
  const given = mendThoughts(original); /* M498: a thought in its exact form first, so the shield below keeps it */
  if (!given.trim()) return { text: original, changed: false };
  const { safe: shielded, restore } = shieldObjects(given);
  /* M489-3: a line that is only one, two or three asterisks — with single newlines around it, or a non-breaking space
   * before it — is the scene break that lost its shape: its own paragraph, "* * *" */
  /* M490: every space a model sends (any white space but a newline — em, thin, ideographic, NBSP, a CR), the zero-width
   * marks, and the asterisk look-alikes (∗ ⁎ ＊ ✱) */
  const src = shielded
    .replace(/\r\n?/g, '\n')
    /* M501: a thought's closer split across a line break leaves a fragment — "/t Shunsui stood…" at a line's start, or
     * "…he said. ~/t" at its end — outside any thought (the exact thoughts are shielded here): the fragment goes */
    .replace(/(^|\n)[ \t]*~?[\/\\]t~?[ \t]+(?=\S)/g, '$1')
    /* M510-32: A THOUGHT'S CLOSER STANDING ALONE — his report: a lone stray "t/~" after an NPC. The model wrote the closer
     * back to front ("~t/~", "t/~") or one closer too many ("…*~/t~ t/~", "…she said. t/~"); the mend knew only ~/t~ and
     * /t~, so the stray stood on the page. Every thought in its exact form is shielded here; any closer left over belongs
     * to no thought, and goes — with the space it leaves. (Both exact forms are shielded — M506 caught the second,
     * *~t~…~/t~*, going unshielded here and its closer taken for a stray; and a right-shaped closer on a line that
     * holds a thought is left, as M506 leaves it.) */
    /* the closer written back to front is never a thought's own: it goes wherever it stands */
    .replace(/(^|\n)[ \t]*(?:~t[\/\\]~|t[\/\\]~)[ \t]*/g, '$1')
    .replace(/[ \t]*(?:~t[\/\\]~|(?<![A-Za-z~*])t[\/\\]~)(?=[ \t\n]|$|[.,!?;:"”’)*])/g, '')
    /* a closer in its right shape goes only from a line with no thought on it — on a line that has one, it may be that
     * thought's own, a shape M506 leaves to the letter ("~t~*a*~/t~ she says. *emph*~/t~") */
    .replace(/(^|\n)([^\n]*)/g, (m, nl, line) => (/~t~|\uE000/.test(line) ? m : nl + line
      .replace(/^([ \t]*)(?:~[\/\\]t~|[\/\\]t~)[ \t]*/, '$1')
      .replace(/[ \t]*(?:~[\/\\]t~|(?<![A-Za-z~*])[\/\\]t~)(?=[ \t]|$|[.,!?;:"”’)*])/g, '')))
    .replace(/[ \t]+~?[\/\\]t~?[ \t]*(?=\n|$)/g, '')
    .replace(/\n[^\S\n]+(?=\n)/g, '\n') /* a line of spaces alone is a blank line (the gap round his break) */
    .replace(/(^|\n)(?:[^\S\n]|\u200b|\u200c|\u200d|\u2060)*[*\u2217\u204e\uff0a\u2731](?:(?:[^\S\n]|\u200b|\u200c|\u200d|\u2060)*[*\u2217\u204e\uff0a\u2731]){0,2}(?:[^\S\n]|\u200b|\u200c|\u200d|\u2060)*(\n|$)/g, (m, lead, end) => (lead ? '\n\n' : '') + '* * *' + (end ? '\n\n' : ''))
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, (m) => (/^\n/.test(shielded) ? m : ''))
    .replace(/\n+$/, (m) => (/\n$/.test(shielded) ? '\n' : ''));
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
    p = p.replace(/\*\*(?=[^\s*])([^*\n]*?[^\s*])\*\*/g, '$1'); /* M490/M490-2: flanking — never a span of spaces or of asterisks */
    p = p.replace(/(?<!\*)\*(?=\S)([^*\n]{4,140})(?<=\S)\*(?!\*)/g, (m, inner) => (inner.trim().split(/\s+/).length >= 4 ? inner : m)); /* M490: flanking */
    /* an empty pair of quotes goes, and only the spaces it leaves behind with it (a page's own white space is its own) */
    const noEmpty = p.replace(/(^|[ \t(])(?:""|\u201c[ \t]*\u201d)(?=[ \t.,!?;:)]|$)/g, '$1');
    if (noEmpty !== p) p = noEmpty.replace(/([^ \t\n])[ \t]{2,}(?=\S)/g, '$1 ').replace(/[ \t]+(?=[.,!?;:])/g, '').replace(/[ \t]+$/g, '');
    const tail = (p.match(/\s*$/) || [''])[0];
    const core = p.slice(0, p.length - tail.length);
    /* M489: A LONE ASTERISK ON A LINE IS A SCENE BREAK THAT LOST ITS SHAPE. The storyteller wrote "  *" between a
     * closing line and a new beat where its own earlier pages wrote "* * *"; one, two or three asterisks with nothing
     * else on the line are written as the break — marks only */
    if (/^[ \t]*\*(?:[ \t]*\*){0,2}[ \t]*$/.test(core)) { parts[k] = '* * *' + tail; changed = true; continue; }
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
  const out = restore(parts.join(''));
  return out === original ? { text: original, changed: false } : { text: out, changed: true };
}

/* M476: A SOFT WRAP IS JOINED. Inside a page whose paragraphs are parted by blank lines, a lone line break followed by
 * an indent ("…closer to the towers than Dev likes —\n and the thought…"), or one that leaves a sentence hanging and
 * goes on in lowercase, is a wrap the model let through, not a paragraph: joined with one space. White space only. */
export function joinSoftWraps(text) {
  const given = String(text == null ? '' : text);
  if (!/\n[ \t]*\n/.test(given)) return { text: given, changed: false };
  const { safe, restore } = shieldObjects(given);
  /* M489-3: a line that is only marks (a scene break "*", "* * *", "---") is its own thing — never glued to the line
   * above it nor swallowed into the one below; it was joined as "…know you.\" *" and no mark rule could see it after */
  const MARK_LINE = /^(?:[^\S\n]|\u200b|\u200c|\u200d|\u2060)*(?:[*\u2217\u204e\uff0a\u2731_~—–-]+(?:[^\S\n]|\u200b|\u200c|\u200d|\u2060)*)+$/; /* M490: every space and zero-width mark */
  const out = safe.split('\n').reduce((acc, line, i, arr) => {
    if (i === 0) return line;
    const prev = arr[i - 1];
    if (MARK_LINE.test(line) || MARK_LINE.test(prev)) return acc + '\n' + line;
    if (/^[ \t]+\S/.test(line) && /\S/.test(prev)) return acc + ' ' + line.replace(/^[ \t]+/, '');
    if (/[a-z,;:\u2014\u2013-]$/.test(prev) && /^[a-z]/.test(line)) return acc + ' ' + line;
    return acc + '\n' + line;
  }, '');
  return out === safe ? { text: given, changed: false } : { text: restore(out), changed: true };
}

/* the paragraphs a page came without: single line breaks become blank lines (three lines or more), and one unbroken block
 * is parted where speech begins after a finished sentence — white space only, never a word (M510-17: for a page with a
 * header and, now, for one without) */
export function partParagraphs(text) {
  const given = String(text == null ? '' : text);
  const trimmed = given.trim();
  if (!trimmed || FENCED.test(trimmed) || /\n[ \t]*\n/.test(trimmed)) return { text: given, changed: false };
  const lines = trimmed.split('\n').filter((l) => l.trim());
  if (lines.length >= 3) return { text: lines.map((l) => l.trim()).join('\n\n'), changed: true };
  if (lines.length === 1 && trimmed.length > 900) {
    const parted = trimmed.replace(/([.!?…]["”’)]?)[ \t]+(?=["“][^\s])/g, '$1\n\n');
    if (parted !== trimmed) return { text: parted, changed: true };
  }
  return { text: given, changed: false };
}

/* before the page is kept: brackets, the place the ledger already holds, white space — never a word */
/* M510-34: THE PAGE FINISHED — his word: "make something careful, not changing the story, that absolutely makes sure no
 * stupid things are on the page: several *** The World Beyond *** at the end with nothing under them; the storyteller
 * breaking the fourth wall, talking nonsense at the end — something smart, not flex tape, autonomous, that never breaks
 * the story." Two kinds of thing, and only these, leave a page — never a word of the story:
 *   THE WINDOW'S MARKER WITH NOTHING UNDER IT (up to the next marker or the page's end) goes; and of the markers that
 *   stand, only the first opens the window — a later one inside it goes, its words staying in the one window.
 *   THE STORYTELLER TALKING TO HIM AT THE PAGE'S END — the last paragraphs only, from the end back, each one a note to the
 *   writer and nothing else: a question or offer to "you" ("What will you do?", "Would you like me to…", "Let me know…",
 *   "Shall I continue?"), what does <his character> do next, a note, OOC, an author's note, "to be continued", "your
 *   move", a word count, a separator left with nothing after it, a header with no page under it. A paragraph that opens
 *   on a line of speech, or carries one, is story — never touched; so is anything past 400 characters.
 * Careful by construction: at most four paragraphs and 900 characters come off, and never when less than 200 characters
 * of page would be left — then the page stands as it came. What came off is returned (removed), so it is kept with the
 * page and a tap puts it back (chat.js: the page's earlier words, msg.mended). */
const TAIL_SEPARATOR = /^[ \t]*(?:[-–—_=~•·*][ \t]*){3,}$/;
const TAIL_META = [
  /^(?:so,?\s+|now,?\s+|and\s+)?(?:what|how|where)\s+(?:will|would|do|does|should|shall)\s+(?:you|we)\b[^"“”]{0,140}\?$/i,
  /^(?:would|do)\s+you\s+(?:like|want)\s+(?:me\s+)?to\b/i,
  /^(?:shall|should)\s+i\s+(?:continue|go\s+on|keep\s+going|proceed|write|carry\s+on)\b/i,
  /^let\s+me\s+know\s+(?:if|what|how|whether|when)\b/i,
  /^feel\s+free\s+to\b/i,
  /^i\s+hope\s+(?:this|that|the\s+(?:scene|page|chapter|response|continuation))\s+(?:captures|works|fits|meets|continues|is\s+what\s+you|helps|flows|feels|reads)\b/i,
  /^i\s+hope\s+you\s+(?:enjoy|like|liked|enjoyed)\b/i,
  /^i(?:'ve|’ve|\s+have)\s+(?:written|kept|tried\s+to|focused\s+on|made\s+sure|included|continued)\b[^"“”]{0,200}\b(?:scene|page|response|story|chapter|tone|pacing|character|continuation)\b/i,
  /^here(?:'s|’s|\s+is)\s+(?:the|your|a)\s+(?:next|continuation|scene|page|chapter|response)\b/i,
  /^(?:ooc|out\s+of\s+character|author'?s?\s+note|author’s\s+note|a\/n|note\s+to\s+(?:the\s+)?(?:writer|reader|user)|note)\s*[:\-—–]/i,
  /^(?:to\s+be\s+continued|continued?|end\s+of\s+(?:the\s+)?(?:page|scene|chapter|response|part)|awaiting\s+your\s+(?:response|input|move|reply)|your\s+(?:turn|move)(?:,\s*[^.!?]{1,40})?|(?:what|how)\s+(?:do|will)\s+you\s+respond)\s*[.!?…]*$/i,
  /^word\s+count\s*[:\-—–]?\s*\d/i,
];
const TAIL_WRAPS = /^[\s>*_~#(\[]+|[\s*_~)\].]+$/g;
/* M669 — HIS: "detect fourth-wall breaking, safely: at the end of my story there's a stray 'The World Beyond stays where it cut
 * — nothing follows it, and nobody in 1-D learns anything from it'". That is the WINDOW'S OWN RULE SAID BACK: the house
 * tells the storyteller the window "sits where the cut happens… and nothing follows it", and the storyteller wrote the
 * rule onto the page as if it were story. It is known by what it is: a sentence whose SUBJECT IS THE WINDOW BY NAME
 * ("The World Beyond", "The Window Beyond the Page") and that says what the window does on the page — stays, sits,
 * ends, closes, cuts, nothing follows it. Story never talks about its own window. A sentence right after it that only
 * goes on about "it" ("…and nobody in 1-D learns anything from it") leaves with it. Nothing else is touched: no
 * speech, nothing past 400 characters, and the window's own marker line is not a sentence about the window. */
/* the window BY NAME — capitals, as the house writes it ("the world beyond the mountains stays quiet" is a sentence of
 * story) — and one of the rule's own turns of phrase, not just any verb.
 * M675 (the audit of M669): THE PATTERN TOOK STORY. It asked only that the name stand SOMEWHERE in the sentence and one of
 * a dozen phrases somewhere after it — so "The World Beyond is over there, past the ridge…" (is over), "The World Beyond
 * is closed to the living, the priest had told her once." (is closed), "She thought of the World Beyond, where nothing
 * follows a soul but its own name." and "In the World Beyond the river stops there and the dead wait." were each taken
 * off a page as the rule said back (run: all four). A page that tells of a place by that name is story. The rule said
 * back is narrower, and is known by all of this at once:
 *   - the window is the SUBJECT: the sentence opens with its name ("Nothing follows The World Beyond." is the one
 *     turn that names it last);
 *   - and it says the rule's own thing — WHERE THE CUT IS ("stays where it cut", "sits where the cut happens") or that
 *     NOTHING FOLLOWS ("nothing follows it", "…and nothing follows.") —
 *   - or it says only how the window stands and not a word more ("The World Beyond is closed.", "…ends here."): the
 *     whole sentence, to its full stop. "…is closed to the living" goes on, and is story. */
const WINDOW_NAME = '(?:[Tt]he\\s+)?(?:World|Window)\\s+Beyond(?:\\s+[Tt]he\\s+Page)?';
const OPENS = '^[\\s>*_~(\\[“"]*';
const CLOSES = '[\\s.!…*_~)\\]”"]*$';
const ECHO_SUBJECT = new RegExp(OPENS + WINDOW_NAME + '(?![\\p{L}])', 'u');
const ECHO_SAYS = /(?<![\p{L}])(?:where\s+it\s+cuts?(?![\p{L}])|where\s+the\s+cut(?:\s+(?:happens|happened|falls|fell|is|was|comes|came|lands|landed)(?![\p{L}])|(?=\s*(?:[,;.!…—–-]|$)))|nothing\s+(?:follows|comes\s+after)(?:\s+(?:it|this|that|the\s+window))?(?=\s*(?:[,;.!…—–-]|and(?![\p{L}])|$)))/iu;
const ECHO_BARE = new RegExp(OPENS + WINDOW_NAME + '\\s+(?:(?:stays|sits|ends|closes|stops)\\s+(?:here|there)|is\\s+(?:closed|written|done|over))' + CLOSES, 'u');
const ECHO_NAMED_LAST = new RegExp(OPENS + '[Nn]othing\\s+(?:follows|comes\\s+after)\\s+' + WINDOW_NAME + CLOSES, 'u');
const isEchoSentence = (x) => { const t = String(x || ''); return (ECHO_SUBJECT.test(t) && ECHO_SAYS.test(t)) || ECHO_BARE.test(t) || ECHO_NAMED_LAST.test(t); };
const ECHO_GOES_ON = /^(?:[,;—–-]\s*)?(?:and\s+|so\s+)?(?:nothing\s+follows\s+it|(?:nobody|no\s+one|none)\s+(?:in|at|on|of)\s+[^.!?\n]{1,60}\s+(?:learns|knows|hears|sees)\s+(?:anything|nothing|a\s+thing)\s+(?:from|of|about)\s+it)[.!…]*$/iu;
const sentencesOfTail = (t) => String(t || '').split(/(?<=[.!?…])\s+/).map((x) => x.trim()).filter(Boolean);
/* the sentences of a paragraph WITH WHERE EACH BEGINS in it — so what is cut can be cut out of the paragraph as it is
 * written, line breaks and all (M675) */
function sentenceSpans(raw) {
  const out = [];
  const re = /(?<=[.!?…])\s+/g;
  let from = 0; let m;
  const push = (start, end) => { const piece = raw.slice(start, end); const lead = piece.length - piece.trimStart().length; if (piece.trim()) out.push({ text: piece.trim(), start: start + lead }); };
  while ((m = re.exec(raw))) { push(from, m.index); from = m.index + m[0].length; }
  push(from, raw.length);
  return out;
}
/* a paragraph that is nothing but the rule said back (and what goes on about "it") */
export function isRuleEcho(para) {
  const raw = String(para || '').trim();
  if (!raw || raw.length > 400 || WINDOW_LINE.test(raw)) return false;
  if (/["“][^"”\n]{2,}["”]/.test(raw)) return false; /* speech is story, whatever it says */
  const parts = sentencesOfTail(raw.replace(/^[\s>*_~(\[“"]+|[\s*_~)\]”"]+$/g, ''));
  if (!parts.length || !isEchoSentence(parts[0])) return false;
  return parts.every((x) => isEchoSentence(x) || ECHO_GOES_ON.test(x));
}
/* the rule said back at the END of a paragraph of story: only those last sentences come off.
 * M675 (the audit of M669): AND THE PARAGRAPH STAYS AS IT WAS WRITTEN. What was kept was put together again from its
 * sentences with a space between each — so every line break that followed a sentence inside that paragraph was gone.
 * Run on both builds: a storyteller that sets its paragraphs apart with ONE line break has a whole page that is one
 * "paragraph" here, and it came out as a single block — three paragraphs, one block (the repair that makes them
 * paragraphs runs after this and found nothing left to part); a letter, a verse, the lines of a window's prose lost
 * their breaks the same way. (A window's marker and its place-and-hour line end in no full stop, and kept theirs.)
 * The cut is made at the place the first echoed sentence begins; nothing before it is touched. */
export function cutRuleEchoTail(para) {
  const raw = String(para || '');
  const parts = sentenceSpans(raw);
  if (parts.length < 2) return null;
  let at = -1;
  for (let i = parts.length - 1; i >= 1; i -= 1) {
    if (isEchoSentence(parts[i].text) && !/["“]/.test(parts[i].text)) { at = i; continue; }
    if (at !== -1 || !ECHO_GOES_ON.test(parts[i].text)) break;
  }
  if (at === -1) return null;
  /* everything from the echo on must be the echo and what goes on about it */
  if (!parts.slice(at).every((x) => isEchoSentence(x.text) || ECHO_GOES_ON.test(x.text))) return null;
  return { kept: raw.slice(0, parts[at].start).replace(/\s+$/, ''), cut: raw.slice(parts[at].start).trim() };
}
/* M675 (the second reading) — THE FINISHER AS M669 SHIPPED IT: its pattern, which took story, and its cut, which ran a
 * paragraph's lines together (both described above, where they were put right). Kept for ONE use: to know a page that
 * still stands exactly as that finisher left it (tidyPage `asM669`, asked by chat.js refinishedFromEarlier) — the only
 * pages the house may put right by itself. Never used to finish a page. */
const WINDOW_RULE_ECHO_M669 = /(?<![\p{L}])(?:[Tt]he\s+)?(?:World|Window)\s+Beyond(?:\s+[Tt]he\s+Page)?(?![\p{L}])[^\n.!?]{0,160}?(?<![\p{L}])(?:[Nn]othing\s+follows|where\s+(?:it|the)\s+cut|where\s+the\s+cut\s+happens|(?:stays|sits|ends|closes|stops)\s+(?:where|here|there)|is\s+(?:closed|written|done|over))(?![\p{L}])/u;
function isRuleEchoM669(para) {
  const raw = String(para || '').trim();
  if (!raw || raw.length > 400 || WINDOW_LINE.test(raw)) return false;
  if (/["“][^"”\n]{2,}["”]/.test(raw)) return false;
  const parts = sentencesOfTail(raw.replace(/^[\s>*_~(\[“"]+|[\s*_~)\]”"]+$/g, ''));
  if (!parts.length || !WINDOW_RULE_ECHO_M669.test(parts[0])) return false;
  return parts.every((x) => WINDOW_RULE_ECHO_M669.test(x) || ECHO_GOES_ON.test(x));
}
function cutRuleEchoTailM669(para) {
  const raw = String(para || '');
  const parts = sentencesOfTail(raw.trim());
  if (parts.length < 2) return null;
  let at = -1;
  for (let i = parts.length - 1; i >= 1; i -= 1) {
    if (WINDOW_RULE_ECHO_M669.test(parts[i]) && !/["“]/.test(parts[i])) { at = i; continue; }
    if (at !== -1 || !ECHO_GOES_ON.test(parts[i])) break;
  }
  if (at === -1) return null;
  if (!parts.slice(at).every((x) => WINDOW_RULE_ECHO_M669.test(x) || ECHO_GOES_ON.test(x))) return null;
  return { kept: parts.slice(0, at).join(' '), cut: parts.slice(at).join(' ') };
}
function tailIsNote(para, mc, echo = isRuleEcho) {
  const raw = String(para || '').trim();
  if (!raw || raw.length > 400) return false;
  if (echo(raw)) return true; /* M669 */
  if (/^[\s>*_~(\[]*["“'‘]/.test(raw) || /["“][^"”\n]{2,}["”]/.test(raw)) return false; /* speech is story */
  if (TAIL_SEPARATOR.test(raw)) return true;
  if (WINDOW_LINE.test(raw) && !/\n/.test(raw)) return true; /* the window's marker as the page's last paragraph: nothing under it */
  if (isHeaderLine(raw) && !/\n/.test(raw)) return true; /* a header with no page under it */
  const b = raw.replace(TAIL_WRAPS, '').trim() + (/[?!]$/.test(raw.replace(/[\s*_~)\]]+$/, '')) ? raw.replace(/[\s*_~)\]]+$/, '').slice(-1) : '');
  const bare = b.replace(/([?!])\1$/, '$1');
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mcAsk = mc ? new RegExp('^(?:so,?\\s+|now,?\\s+)?(?:what|how)\\s+(?:do|does|will|would|should)\\s+(?:' + esc(mc) + '|' + esc(mc.split(/\s+/)[0]) + ')\\s+(?:do|say|respond|react|choose|decide|want)\\b[^"“”]{0,100}\\?$', 'i') : null;
  const isNote = (x) => TAIL_META.some((re) => re.test(x)) || (mcAsk && mcAsk.test(x)) || /^let\s+me\s+know[.!…]*$/i.test(x);
  if (isNote(bare)) return true;
  /* a paragraph of a few sentences, every one of them a note to him ("What will you do next? Let me know!") */
  const sentences = bare.split(/(?<=[.!?…])\s+/).map((x) => x.replace(TAIL_WRAPS, '').trim()).filter(Boolean);
  if (sentences.length > 1 && sentences.length <= 4 && sentences.every((x) => isNote(x.replace(/([?!])\1$/, '$1')) || isNote(x + (/[?!.]$/.test(x) ? '' : '?')))) return true;
  /* a paragraph wholly in brackets, addressed to "you": a note to the writer */
  if (/^[\s*_]*[(\[][^\n|]{3,300}[)\]][\s*_.!?]*$/.test(raw) && /\byou(?:r)?\b/i.test(raw)) return true;
  return false;
}
export function finishPage(text, { mc = '', asM669 = false } = {}) {
  const echo = asM669 ? isRuleEchoM669 : isRuleEcho; /* M675: see isRuleEchoM669 — only to know a page that finisher left */
  const cutTail = asM669 ? cutRuleEchoTailM669 : cutRuleEchoTail;
  const given = String(text == null ? '' : text);
  const removed = [];
  const did = [];
  let lines = given.split('\n');
  const marks = lines.map((l, i) => (WINDOW_LINE.test(l) ? i : -1)).filter((i) => i >= 0);
  if (marks.length) {
    const drop = new Set();
    marks.forEach((i, k) => {
      const end = k + 1 < marks.length ? marks[k + 1] : lines.length;
      if (!lines.slice(i + 1, end).join('\n').trim()) drop.add(i);
    });
    marks.filter((i) => !drop.has(i)).slice(1).forEach((i) => drop.add(i));
    if (drop.size) {
      const empties = marks.filter((i) => drop.has(i)).length;
      lines = lines.filter((_, i) => !drop.has(i));
      removed.push(empties === 1 ? 'a World Beyond with nothing under it, or a second one inside the first' : empties + ' World Beyond markers with nothing under them, or inside the first');
      did.push('windows');
    }
  }
  let page = lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
  /* M524: a block of tags the storyteller invented after the page (<npc> <the mage> <standing>P=-15… </npc>) — the same
   * pattern as the house's own rule at the door (regex.js TAG_TAIL_SOURCE), here for the pages kept before it */
  {
    const tm = new RegExp(TAG_TAIL_SOURCE, 'i').exec(page);
    if (tm && page.slice(0, tm.index).replace(/\s+/g, ' ').trim().length >= 200) {
      removed.push(tm[0].trim().slice(0, 900));
      page = page.slice(0, tm.index).replace(/\s+$/, '');
      did.push('tags');
    }
  }
  const paras = page.split(/\n[ \t]*\n/);
  const taken = [];
  while (paras.length > 1 && taken.length < 4) {
    const last = paras[paras.length - 1];
    if (!last.trim()) { paras.pop(); continue; }
    /* M669: a line that only goes on about "it" leaves when the rule said back stands right above it */
    const goesOn = ECHO_GOES_ON.test(last.trim()) && paras.length > 2 && echo(paras[paras.length - 2]);
    if (!tailIsNote(last, mc, echo) && !goesOn) break;
    taken.unshift(last.trim());
    paras.pop();
  }
  /* M669: …and when it closes a paragraph of story, only its own sentences come off */
  if (paras.length) {
    const tail = cutTail(paras[paras.length - 1]);
    if (tail && tail.kept.trim() && taken.length < 4) { paras[paras.length - 1] = tail.kept; taken.unshift(tail.cut); }
  }
  if (taken.length) {
    const left = paras.join('\n\n');
    if (taken.join('\n').length <= 900 && left.replace(/\s+/g, ' ').trim().length >= 200) {
      page = left;
      removed.push(...taken);
      did.push('tail');
    }
  }
  if (!did.length) return { text: given, removed: [], did: [] };
  return { text: page + (given.endsWith('\n') ? '\n' : ''), removed, did };
}

/* M626: A STRAY OF ANOTHER SCRIPT GLUED TO THE FRONT OF AN ENGLISH WORD COMES OFF IN CODE — his: "sometimes there's stray
 * Chinese or Japanese … basically normal alphabet with Chinese glued to 'eat'". A model trained on Chinese slips a token of
 * its other language in front of the English word it meant ("吃eat"): the word itself is there, so the stray is noise and
 * goes, here, with no model asked. Only that shape: one to four characters, right before a Latin letter, after a space or a
 * mark (never inside a word), on a page that is Latin nearly whole (two hundred letters at least, four strays at most — a
 * phrase a character speaks is longer, and stays). A stray that REPLACES a word ("to吃 the food") is not touched here: the
 * house's eye names it and the mender writes the word it meant (M119). */
const STRAY = '[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}\\p{Script=Cyrillic}\\p{Script=Arabic}\\p{Script=Thai}\\p{Script=Hebrew}]';
export function dropGluedStrays(text) {
  const src = String(text == null ? '' : text);
  const all = src.match(new RegExp(STRAY, 'gu')) || [];
  if (!all.length || all.length > 4) return { text: src, changed: false };
  if ((src.match(/\p{L}/gu) || []).length < 200) return { text: src, changed: false };
  const out = src.replace(new RegExp('(?<![\\p{L}\\p{N}])' + STRAY + '{1,4}(?=\\p{Script=Latin})', 'gu'), '');
  return { text: out, changed: out !== src };
}

/* M626: A HEADER THAT LEFT OUT THE MAIN CHARACTER'S ATTIRE AND POSITION GETS THEM FROM THE LEDGER — his: "sometimes it
 * puts the header not detailed". The header is five fields — [Place — Date | HH:MM | weather | attire | position]; one that
 * stops after the weather is given the two the ledger holds for him, the way a header that lost its place is given the
 * ground (M340). Only a header of exactly three fields (where the two missing are surely those two); never a field written. */
function withLedgerFields(inner, { attire = '', position = '' } = {}) {
  const fields = String(inner).split('|').map((f) => f.trim());
  if (fields.length !== 3) return null;
  const clean = (v) => String(v || '').replace(/[[\]|\n]/g, ' ').replace(/\s+/g, ' ').trim();
  const a = clean(attire), p = clean(position);
  if (!a && !p) return null;
  return [...fields, a || '—', p || '—'].join(' | ');
}

export function tidyPage(text, { place = '' , mc = '', finish = true, attire = '', position = '', asM669 = false } = {}) {
  /* M467: the window's marker in the exact form, whatever dressing the model gave it ("The World Beyond" bare, bold, a
   * heading) — marks only, the three words as they are — so the 🎨 box, the readers' cut and the lint all see it */
  const given = String(text == null ? '' : text);
  const windowed = normalizeWindowMark(given);
  const did = windowed !== given ? ['window'] : [];
  /* M510-34: the page finished — the empty or doubled window and the storyteller's note to him at the end, and nothing
   * else (never for an out-of-character answer: finish false) */
  const fin = finish ? finishPage(windowed, { mc, asM669 }) : { text: windowed, removed: [], did: [] };
  const unglued = dropGluedStrays(fin.text); /* M626 */
  const src = unglued.text;
  did.push(...fin.did);
  if (unglued.changed) did.push('stray');
  const removed = fin.removed;
  const h = readHeader(src);
  if (!h) { /* M458/M476 — a text with no header keeps its line breaks here: this mend also runs over every stored page and
     * out-of-character answer (M477/M488), whose line breaks are theirs (M340-1). A NEW story page with no header is
     * given its paragraphs where it is kept (chat.js, M510-17). */
    const j = joinSoftWraps(src); const m = mendMarks(j.text);
    const done = [...did]; if (j.changed) done.push('wraps'); if (m.changed) done.push('marks');
    return done.length ? { text: m.text, did: done, ...(removed.length ? { removed } : {}) } : { text: src, did };
  }
  let inner = h.inner;
  const ground = String(place || '').replace(/[\[\]|\n]/g, ' ').replace(/\s+/g, ' ').trim();
  if (h.missingPlace && ground) { inner = ground + ' — ' + inner; did.push('place'); }
  { const filled = withLedgerFields(inner, { attire, position }); if (filled) { inner = filled; did.push('header'); } } /* M626 */
  if (!h.bracketed) did.push('brackets');
  let body = h.after.replace(/^\s*\n/, '').replace(/^\n+/, '');
  { const pp = partParagraphs(body); if (pp.changed) { body = pp.text; did.push('paragraphs'); } } /* M510-17: one mend, both branches */
  const wrapped = joinSoftWraps(body); /* M476 */
  if (wrapped.changed) { body = wrapped.text; did.push('wraps'); }
  /* nothing of substance to mend: the page as it came, to the letter (white space alone is nobody's business) */
  const marked = mendMarks(body); /* M458 */
  if (marked.changed) { body = marked.text; did.push('marks'); }
  if (!did.length) return { text: src, did };
  const out = h.lead + '[' + inner + ']' + (body.trim() ? '\n\n' + body.replace(/\s+$/, '') : '');
  return { text: out, did, ...(removed.length ? { removed } : {}) }; /* M510-34: what came off, only when something did */
}
