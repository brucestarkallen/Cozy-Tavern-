/* Cozy Tavern — agents/jsonutil.js
 * The one tolerant JSON-finder, shared by every agent that asks a model for
 * a JSON object (M9, audit B16 — firstBalancedObject used to live three
 * times: extractor, referee, continuity, and could drift).
 *
 *   firstBalancedObject(text)
 *     Pulls the first balanced {...} out of a string, respecting quoted
 *     text so a brace inside a sentence doesn't count. '' when none
 *     balances.
 */
/* M26: not just the first — up to maxN balanced top-level objects, in order.
 * A reasoning model's first braces often live in its notes, not its answer. */
export function balancedCandidates(text, maxN = 5) {
  const src = String(text || '');
  const out = [];
  let i = 0;
  while (out.length < maxN) {
    const start = src.indexOf('{', i);
    if (start === -1) break;
    let depth = 0; let inStr = false; let esc = false; let end = -1;
    for (let j = start; j < src.length; j++) {
      const ch = src[j];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end === -1) break;
    out.push(src.slice(start, end + 1));
    i = end + 1;
  }
  return out;
}

export function firstBalancedObject(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  if (start === -1) return '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return '';
}

/* The shared first step of every agent parser: strip markdown fences, find
 * the first balanced object, JSON.parse it. null on any trouble — the
 * callers decide what an empty answer means. */
export function parseFirstObject(raw) {
  try {
    const candidate = firstBalancedObject(String(raw || '').replace(/```(?:json|JSON)?/g, ''));
    if (!candidate) return null;
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    return null;
  }
}
