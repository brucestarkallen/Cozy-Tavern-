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
function plainMarks(value, caseless) {
  const text = [];
  const at = [];
  for (let i = 0; i < value.length; i += 1) {
    let c = value[i];
    if (isMark(c)) continue;
    const code = value.charCodeAt(i);
    if (/\s/.test(c)) {
      /* one space for any run of white space; none beside a dash (below) */
      if (text.length && text[text.length - 1] !== ' ' && text[text.length - 1] !== '-') { text.push(' '); at.push(i); }
      continue;
    }
    if (isDash(code)) {
      /* a hyphen, an en or em dash, a minus, a double hyphen, spaced or not: one mark */
      if (text[text.length - 1] === ' ') { text.pop(); at.pop(); }
      if (text[text.length - 1] !== '-') { text.push('-'); at.push(i); }
      continue;
    }
    if (code === 0x2026) { text.push('.', '.', '.'); at.push(i, i, i); continue; } /* … is three stops */
    if (QUOTE1.has(code)) c = "'";
    else if (QUOTE2.has(code)) c = '"';
    else if (caseless) { const low = c.toLowerCase(); if (low.length === 1) c = low; }
    text.push(c);
    at.push(i);
  }
  return { text: text.join(''), at };
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
  let end = plain.at[k + want.length - 1] + 1;
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

export const WRITER_FACTS = 'The writer’s explicit names, ranks, relations and biographies are story facts, even if the reply uses pronouns or omits them. Keep exact names and roles; invent no surname or rank. Read actions in both messages in order: a later departure still wins. Dialogue can establish an identity without placing its speaker’s subject nearby. Questions, wishes, hypotheticals and requests are not completed events. A person deliberately introduced by the writer gets a People page even if absent or quiet; an unnamed extra does not.';
