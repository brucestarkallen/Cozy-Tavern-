/* M684: source checks for newly introduced identities. Partial name matching is
 * useful for recall, but must never justify an invented surname or royal rank. */
import { foldName } from './names.js';

export function exactNameIn(text, name) {
  const n = foldName(name);
  return Boolean(n) && (' ' + foldName(text) + ' ').includes(' ' + n + ' ');
}

/* M752 (followup 4) — THE ORIGINAL'S WORDS, WHATEVER MARKS A MODEL ECHOES THEM WITH. HIS (14 October 2026): the continuous
 * audit's recovery answered rightly that the record was true to its page, and was refused for good, the correction holding
 * the lamp yellow ("…needs an exact claim from this record…"). A model echoing text normalizes its MARKS: the page's ’ comes
 * back as ', its — as - or --, its … as ..., *emphasis* loses its asterisks, white space moves. Those are not the words. A
 * copy that differs from its original only so IS the original; one that differs in a letter, a word or their order is
 * not. The auditor has held quotes to their originals so since M694 (auditor.js auditorSourceQuote); every reader that
 * holds a quote to its original does now (quotedSource), and what is kept is the ORIGINAL's text, never the copy.
 * `caseless`: letter case too — only for words pointed back to in the record (a disputed claim whose first word was
 * capitalized as a quotation begins), never for evidence. */
const QUOTE1 = new Set([0x2018, 0x2019, 0x201A, 0x201B, 0x2032, 0x02BC]);
const QUOTE2 = new Set([0x201C, 0x201D, 0x201E, 0x201F, 0x2033, 0x00AB, 0x00BB]);
const isDash = (code) => code === 0x2D || (code >= 0x2010 && code <= 0x2015) || code === 0x2212;
const isMark = (c) => c === '*' || c === '_' || c === '`';
/* M752 (followup 9) — A PAGE'S MARKUP AND ITS UNSEEN CHARACTERS ARE NOT ITS WORDS EITHER. HIS (15 October 2026): "3 historical
 * corrections remain unresolved … Evidence "p242": quoted passage does not occur in that original" — after the recovery had
 * been told twice to copy p242 exactly. His storyteller writes phones and notes as markup in the page (the GFX blocks: a
 * <div> for each message, a <div> for each sender, <!-- GFX_END -->), and a model quotes what such a page SAYS: the words of
 * one message and the next, never the tags between them. It drops what it cannot see as well — a zero-width joiner, an
 * emoji's variation selector, a soft hyphen — and writes &amp; as &. Told to copy exactly, it copies the same words again.
 * So a tag is no word (a block's tag — a line, a paragraph, a message — parts the words around it, as the page shows it; an
 * inline one does not), a character reference is the character it names, and an unseen character is nothing. */
const BLOCK_TAG = /^(?:br|p|div|li|ul|ol|tr|td|th|table|thead|tbody|h[1-6]|hr|section|article|header|footer|blockquote|pre|details|summary|figure|figcaption)$/i;
const TAG = /<!--[\s\S]*?-->|<\/?([A-Za-z][A-Za-z0-9-]*)(?:\s[^<>]*)?\/?>/y;
const ENTITY = /&(?:#(\d{1,7})|#[xX]([0-9A-Fa-f]{1,6})|(amp|lt|gt|quot|apos|nbsp));/y;
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const isUnseen = (code) => code === 0xAD || (code >= 0x200B && code <= 0x200F) || (code >= 0x202A && code <= 0x202E)
  || (code >= 0x2060 && code <= 0x2064) || code === 0xFEFF || (code >= 0xFE00 && code <= 0xFE0F);
function entityText(m) {
  if (m[3]) return NAMED[m[3]];
  const n = m[1] ? Number(m[1]) : parseInt(m[2], 16);
  return n > 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : '';
}
/* the words of `value` with its marks aside: `text`, and for each of its characters where in `value` it starts (`at`) and
 * ends (`ends`) */
function plainMarks(value, caseless) {
  const text = [];
  const at = [];
  const ends = [];
  const last = () => text[text.length - 1];
  /* one space for any run of white space; none beside a dash (below) */
  const space = (i) => { if (text.length && last() !== ' ' && last() !== '-') { text.push(' '); at.push(i); ends.push(i + 1); } };
  const put = (ch, code, start, stop) => {
    let c = ch;
    if (isMark(c) || isUnseen(code)) return;
    if (/\s/.test(c)) { space(start); return; }
    if (isDash(code)) {
      /* a hyphen, an en or em dash, a minus, a double hyphen, spaced or not: one mark */
      if (last() === ' ') { text.pop(); at.pop(); ends.pop(); }
      if (last() !== '-') { text.push('-'); at.push(start); ends.push(stop); } else ends[ends.length - 1] = stop;
      return;
    }
    if (code === 0x2026) { text.push('.', '.', '.'); at.push(start, start, start); ends.push(stop, stop, stop); return; } /* … is three stops */
    if (QUOTE1.has(code)) c = "'";
    else if (QUOTE2.has(code)) c = '"';
    else if (caseless) { const low = c.toLowerCase(); if (low.length === 1) c = low; }
    text.push(c);
    at.push(start);
    ends.push(stop);
  };
  for (let i = 0; i < value.length; i += 1) {
    const c = value[i];
    if (c === '<') {
      TAG.lastIndex = i;
      const tag = TAG.exec(value);
      if (tag) {
        if (tag[1] === undefined || BLOCK_TAG.test(tag[1])) space(i);
        i += tag[0].length - 1;
        continue;
      }
    } else if (c === '&') {
      ENTITY.lastIndex = i;
      const ent = ENTITY.exec(value);
      if (ent) {
        const said = entityText(ent);
        const stop = i + ent[0].length;
        for (let j = 0; j < said.length; j += 1) put(said[j], said.charCodeAt(j), i, stop);
        i = stop - 1;
        continue;
      }
    }
    put(c, value.charCodeAt(i), i, i + 1);
  }
  return { text: text.join(''), at, ends };
}

/* Where `source` holds `quote`, its marks aside: { start, end } in `source` (emphasis marks hugging the span included), or
 * null. `after`: look from that index of `source` on. A quote of fewer than four characters holds nothing. */
export function literalSpan(source, quote, { caseless = false, after = 0 } = {}) {
  const src = String(source == null ? '' : source);
  const want = plainMarks(String(quote == null ? '' : quote), caseless).text.trim();
  if (want.length < 4) return null;
  const plain = plainMarks(src, caseless);
  let from = 0;
  if (after > 0) {
    from = plain.at.findIndex((i) => i >= after);
    if (from < 0) return null;
  }
  const k = plain.text.indexOf(want, from);
  if (k < 0) return null;
  let start = plain.at[k];
  let end = plain.ends[k + want.length - 1];
  while (start > 0 && isMark(src[start - 1])) start -= 1;
  while (end < src.length && isMark(src[end])) end += 1;
  return { start, end };
}

export function quotedSource(text, quote) {
  const tidy = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const q = tidy(quote);
  // Provenance depends on literal source membership, not an arbitrary quote
  // size. Readers supply longer original spans; those remain valid evidence.
  if (q.length >= 4 && tidy(text).includes(q)) return q;
  /* M752 (followup 4): the same words with other marks — the original's own text comes back */
  const span = literalSpan(text, quote);
  return span ? tidy(String(text).slice(span.start, span.end)) : '';
}

/* M752 (followup 9) — A PASSAGE QUOTED WITH WORDS LEFT OUT, WHERE EVERY WORD IT KEEPS IS THE ORIGINAL'S. A model quoting a
 * page marks what it leaves out ("…", "...", "[…]") — his own readers do ("chin back on her hand... Rias slid the cookie
 * plate an inch toward them both..."), and so did the continuous audit's recovery, whose repair was then refused for good
 * as "Incorrect original-source quotation". Each piece it keeps is held to the original as any quote is (marks aside,
 * four characters at least), in its order, after the one before; a piece that is not there, or out of order, refuses the
 * whole. What comes back is the ORIGINAL's words of each piece, joined by " … " (one piece: its words alone) — a receipt
 * that says where words were left out, never the copy. '' when the quote leaves nothing out, or is not so. Pure. */
const ELIDED = /\s*(?:\[\s*(?:…|\.{3,})\s*\]|\(\s*(?:…|\.{3,})\s*\)|…|\.{3,})\s*/;
export function elidedSource(text, quote) {
  const said = String(quote == null ? '' : quote);
  if (!ELIDED.test(said)) return '';
  const pieces = said.split(ELIDED).map((p) => p.trim()).filter((p) => /[\p{L}\p{N}]/u.test(p));
  if (!pieces.length) return '';
  const src = String(text == null ? '' : text);
  const kept = [];
  let after = 0;
  for (const piece of pieces) {
    const span = literalSpan(src, piece, { after });
    if (!span) return '';
    kept.push(src.slice(span.start, span.end).replace(/\s+/g, ' ').trim());
    after = span.end;
  }
  return kept.join(' … ');
}

/* M752 (followup 9) — WHERE A QUOTE STOPS BEING ITS ORIGINAL'S WORDS, to be said back: "copy exactly" told a model nothing
 * it could act on — it believed it had, and copied the same words again (p242: twice). Its opening words the original
 * holds as far as they go (`held`), what the quote says after them (`quoteGoesOn`) and what the original says there
 * (`pageGoesOn`, the original's own characters); `skipped`: opening words that are not the original's at all (a speaker's
 * name and a colon before a line, say). null when the whole quote is the original's words. Pure. */
export function quoteDeparture(source, quote) {
  const words = String(quote == null ? '' : quote).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const src = String(source == null ? '' : source);
  const plain = plainMarks(src, false);
  for (let s = 0; s < Math.min(words.length, 8); s += 1) {
    let best = null;
    for (let k = s + 1; k <= words.length; k += 1) {
      const want = plainMarks(words.slice(s, k).join(' '), false).text.trim();
      if (want.length < 4) continue;
      const at = plain.text.indexOf(want);
      if (at < 0) break;
      best = { k, end: plain.ends[at + want.length - 1] };
    }
    if (!best) continue;
    if (s === 0 && best.k === words.length) return null;
    return { skipped: words.slice(0, s).join(' '), held: words.slice(s, best.k).join(' '), quoteGoesOn: words.slice(best.k).join(' '),
      pageGoesOn: best.k === words.length ? '' : src.slice(best.end, best.end + 200).replace(/\s+/g, ' ').trim() };
  }
  return { skipped: '', held: '', quoteGoesOn: words.join(' '), pageGoesOn: '' };
}

export const WRITER_FACTS = 'The writer’s explicit names, ranks, relations and biographies are story facts, even if the reply uses pronouns or omits them. Keep exact names and roles; invent no surname or rank. Read actions in both messages in order: a later departure still wins. Dialogue can establish an identity without placing its speaker’s subject nearby. Questions, wishes, hypotheticals and requests are not completed events. A person deliberately introduced by the writer gets a People page even if absent or quiet; an unnamed extra does not.';
