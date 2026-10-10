/* One readable explanation for saved changes, without exposing mutation syntax. */
export function changeExplanation(entry) {
  const sources = { writer: 'Your input', extractor: 'Page reader', scribe: 'Character writer', world: 'World simulation', auditor: 'Ledger auditor' };
  const lines = [];
  const where = [Number.isInteger(entry?.page) && entry.page >= 0 ? 'Story page ' + (entry.page + 1) : '', sources[entry?.source] || ''].filter(Boolean).join(' · ');
  if (where) lines.push(where);
  if (entry?.cause) lines.push('Why: ' + entry.cause);
  if (entry?.evidence) lines.push('Source: “' + entry.evidence + '”');
  return lines;
}
