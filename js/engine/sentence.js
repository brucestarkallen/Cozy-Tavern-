/* M292: THE FIRST SENTENCE OF A NOTE — a period after a title or an initial
 * does not end one. "Ms. June runs the diner." was cut to "Ms" (and "Mr.
 * Sterling" to "Mr") in every short line and every lean page. No imports: the
 * people and the whole-ledger readers both ask it. */
const ABBREV = new Set(['mr', 'mrs', 'ms', 'mx', 'dr', 'st', 'jr', 'sr', 'prof', 'mt', 'no', 'vs', 'etc', 'capt', 'lt', 'col', 'gen', 'sgt', 'rev', 'hon', 'mme', 'mlle', 'messrs', 'fr', 'sen', 'rep', 'gov', 'pres', 'inc', 'ltd', 'co', 'ave', 'rd', 'blvd', 'dept', 'univ', 'approx', 'est', 'vol', 'fig', 'al']);
export function firstSentence(text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  const re = /[.;!?](?=\s)/g;
  let m;
  while ((m = re.exec(t))) {
    if (t[m.index] === '.') {
      const before = t.slice(0, m.index);
      const word = (before.match(/([\p{L}.]+)$/u) || ['', ''])[1];
      const bare = word.replace(/\./g, '').toLowerCase();
      if (ABBREV.has(bare) || /^\p{L}$/u.test(bare) || /^(\p{L}\.)+\p{L}$/u.test(word)) continue; /* a title, an initial, "e.g" */
    }
    return t.slice(0, t[m.index] === ';' ? m.index : m.index + 1).trim(); /* a sentence keeps its ending */
  }
  return t.replace(/;$/, '');
}
