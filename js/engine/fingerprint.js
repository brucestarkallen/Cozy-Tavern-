/* Cozy Tavern — engine/fingerprint.js (M575)
 * ONE FINGERPRINT. The same few lines (djb2, base 36) had been written out seven times — the world keeper, the essentials,
 * the canon checks, the start's check, the plans keeper, the planner, the rule modules — and twice more with the text's
 * length in front (the canon lens, the canon tidy). His order: no duplicates. One home; every caller's answers are exactly
 * what they were (law M575 holds the old copies against this one on a corpus), so no stored fingerprint moves. */
export function djb2(text) {
  let h = 5381;
  const s = String(text == null ? '' : text);
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h >>> 0;
}
/* the page's, the brief's, the record's fingerprint — what seven callers wrote for themselves */
export function fingerprint36(text) { return djb2(text).toString(36); }
/* the canon lens's and the canon tidy's key: the length, then the fingerprint */
export function lengthKey(text) { const s = String(text == null ? '' : text); return s.length + ':' + djb2(s).toString(36); }
