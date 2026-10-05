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
export function parseFirstObject(raw, want = null) {
  /* M259: the thinking stripped, up to five candidates, the lenient repair —
   * the way every other worker's answer has been read since M26/M31. It took
   * the first brace and parsed it strictly, so the referee's and the
   * director's watcher's answers were lost to a model that thought out loud
   * first or left a trailing comma. `want` picks the object that answers. */
  try {
    let text = String(raw || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/```(?:json|JSON)?/g, '');
    /* M439: an answer typed in curly quotes throughout (no straight one anywhere) — its curly quotes are the delimiters */
    if (!text.includes('"') && /[\u201c\u201d]/.test(text)) text = text.replace(/[\u201c\u201d]/g, '"');
    for (const c of balancedCandidates(text, 5)) {
      const parsed = parseLenient(c);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (typeof want !== 'function' || want(parsed))) return parsed;
    }
    return null;
  } catch (err) {
    return null;
  }
}

/* M31: the repair pass. A cheap model's JSON fails in three known ways —
 * comments, trailing commas, and raw newlines inside a string — and each
 * is mechanical to mend. Run only when a strict parse has failed; the
 * repaired text is parsed again by the caller. Never throws. */
export function repairJson(text) {
  const src = String(text || '');
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === '\\') { out += ch; esc = true; continue; }
      if (ch === '"') { out += ch; inStr = false; continue; }
      /* M607: A LINE BREAK INSIDE A STRING IS KEPT, written the way JSON writes one. It was made a space: a page the mender
       * hands back whole, written with real line breaks, came back as ONE paragraph — its own size check then refused it
       * (every line differed), so the fix never landed; a find spanning a paragraph matched nothing. Every ledger field
       * folds its whitespace itself, so nothing else changes. */
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { out += '\\r'; continue; }
      if (ch === '\t') { out += '\\t'; continue; }
      out += ch;
      continue;
    }
    if (ch === '"') { out += ch; inStr = true; continue; }
    /* comments outside strings */
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (ch === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); i = end === -1 ? src.length : end + 1; continue; }
    out += ch;
  }
  /* trailing commas before a closing bracket or brace */
  /* M607: a trailing comma before a closing bracket goes — outside the strings only: the pattern ran over the strings too,
   * so a value holding ", }" or ", ]" lost its comma */
  let fixed = '';
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < out.length; i += 1) {
    const ch = out[i];
    if (quoted) {
      fixed += ch;
      if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') { quoted = true; fixed += ch; continue; }
    if (ch === ',') {
      let j = i + 1;
      while (j < out.length && /\s/.test(out[j])) j += 1;
      if (out[j] === '}' || out[j] === ']') continue;
    }
    fixed += ch;
  }
  return fixed;
}

/* Parse leniently: strict first, then the repair pass. null on trouble. */
export function parseLenient(candidate) {
  try { return JSON.parse(candidate); } catch (err) { /* try mending */ }
  try { return JSON.parse(repairJson(candidate)); } catch (err) { return null; }
}
