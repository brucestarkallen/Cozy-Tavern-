/* Cozy Tavern — agents/housekeeper.js
 * The housekeeper (M10): the one intelligence that can see the whole story
 * and surgically edit it — prose pages, the ledger, the rulebook — through
 * staged proposal cards and drift-guarded undo. It talks to the writer in
 * its own panel (ui/housekeeper.js), reads the story through a served
 * context (brief + message index + the last pages in full + the ledger +
 * the rulebook's names + the showrunners' blocks), and answers in natural
 * words carrying small protocol blocks:
 *
 *   <edits>[...]</edits>     page ops: {id, find, replace, reason}
 *                            | {id, hide:true|false}
 *                            | {bulk_replace:true, find, replace, range}
 *   <ledits>[...]</ledits>   ledger ops — the closed apply.js vocabulary
 *                            (clock/presence/mode/body/rel/offscreen/canon),
 *                            plus {type:'module.pin', module, pinned}
 *   <redits>[...]</redits>   rulebook ops: {module, find, replace, reason}
 *   <lore>[...]</lore>       lore ops (M38): {add:true, name, keys, content, constant?}
 *                            | {entry, content?, keys?, name?, enabled?, constant?}
 *                            | {entry, remove:true}
 *   <fetch>[refs]</fetch>    self-serve full pages (<= 3 rounds a turn)
 *   <supersede>a, b</supersede>  retire pending cards by label
 *
 * The laws that keep it honest:
 *  - locate(): exact (refuse when >1 occurrence) → quote/whitespace-
 *    normalized exact → word-Levenshtein fuzzy, accepted iff similarity
 *    >= 0.78 AND no second window within 0.05; a minimalDiff salvage strips
 *    the common prefix/suffix once so only the true change is swapped.
 *    Ambiguity is always a clean refusal with a reason, never a guess.
 *  - Ledger edits ride engine/apply.js — validated, logged, undoable.
 *    Nothing here writes ledger state behind the applier's back.
 *  - Every applied card lands as one undo batch holding before-values and
 *    after-hashes; undo REFUSES loudly when a target drifted (a swipe, an
 *    edit, a worker's write) since the card landed. Cap 50 batches.
 *  - Everything runs on the worker connection, off the story-generation
 *    path, and nothing here ever throws into the chat path.
 *
 * Sessions live in the settings store under `hk:<storyId>` (so backups
 * carry them and they go with their story):
 *   { turns:[{role:'writer'|'housekeeper', text, proposals?, ts}],
 *     batches:[UndoBatch] }
 * Proposal = {id, ts, kind:'edit'|'ledit'|'redit', label, reason, op,
 *             status:'pending'|'applying'|'applied'|'skipped'|'stale'|
 *                    'refused'|'superseded', words, review:[{target, hash}]}
 * UndoBatch = {id, ts, label, undone, items:[
 *   {kind:'message', messageId, before, afterHash} |
 *   {kind:'module', moduleId, beforeRow|null, afterHash} |
 *   {kind:'ledger', before, afterHash, words} ]}
 */

import { db } from '../store.js';
import { loadState, saveState, notify, renderStateFacts } from '../engine/state.js';
import { applyMutations } from '../engine/apply.js';
import { listModules, saveModule, removeModule } from '../assemble/modules.js';
import { loadLore, saveLore } from '../import/lorebook.js'; /* M38: the housekeeper keeps the lore shelf too */
import { loadMemory, saveMemory } from './memory.js'; /* M61: and the record */
import { pageText } from '../assemble/stack.js';
import { createProvider } from '../providers/index.js';
import { withFictionFrame } from './voice.js'; /* M21: the workers never break the fiction */

const SESSION_PREFIX = 'hk:';
const SESSION_TURNS_CAP = 60;
export const UNDO_CAP = 50;
export const MAX_FETCH_ROUNDS = 3;
export const DEFAULT_CONTEXT_PAGES = 12;
const CONTEXT_PAGES_MIN = 4;
const CONTEXT_PAGES_MAX = 40;
const PREVIEW_CHARS = 150;
const INDEX_CAP = 200;         // index lines served; older pages still fetchable
/* M61 (Chat Assistant v2.72, ported): a page is served WHOLE, or it says
 * it is not. The old caps cut a page at 4,000/8,000 chars with "…" while
 * labelling it "in full" — a truncation the reader cannot detect produces
 * confident wrong answers about where a page ends. No cap now; every
 * served page carries its exact character count and COMPLETE. */
export const FULL_PAGE_CAP = 0;
export const FETCH_PAGE_CAP = 0;
export function formatPage(msg) {
  const speaker = msg.role === 'assistant' ? 'the storyteller' : 'the writer';
  const text = pageText(msg);
  return refOf(msg) + ' ' + speaker + ' wrote (' + text.length + ' chars, COMPLETE — first character to last):\n"""' + '\n' + text + '\n' + '"""';
}

/* ---------- small faithful tools ---------- */

/* FNV-1a, 32-bit — the fingerprint every review-hash and after-hash rides.
 * Sync on purpose: the applier and the undo guard both want it cheap. */
export function hashText(value) {
  const s = String(value == null ? '' : value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16);
}

function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'hk-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/* Strip the longest common prefix and suffix from a find/replace pair —
 * once each — so only the words that truly change are swapped and shown.
 * Guards against emptying either side. */
export function minimalDiff(find, replace) {
  const a = String(find == null ? '' : find);
  const b = String(replace == null ? '' : replace);
  let pre = 0;
  const preMax = Math.min(a.length, b.length);
  while (pre < preMax && a[pre] === b[pre]) pre += 1;
  let suf = 0;
  const sufMax = Math.min(a.length, b.length) - pre;
  while (suf < sufMax && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf += 1;
  return {
    find: a.slice(pre, a.length - suf),
    replace: b.slice(pre, b.length - suf),
    prefix: pre,
    suffix: suf,
  };
}

/* ---------- locate() ---------- */

/* Quote/whitespace normalization with an index map back to the original:
 * curly quotes and dashes straighten, ellipses unfold, whitespace runs
 * collapse to one space. map[i] = the original char index of normalized
 * char i. */
function normalizeWithMap(input) {
  const s = String(input == null ? '' : input);
  let out = '';
  const map = [];
  let pendingSpace = false;
  for (let i = 0; i < s.length; i += 1) {
    let ch = s[i];
    if (ch === '“' || ch === '”' || ch === '„') ch = '"';
    else if (ch === '‘' || ch === '’' || ch === '‚') ch = '\'';
    else if (ch === '—' || ch === '–') ch = '-';
    if (ch === '…') {
      if (pendingSpace) { out += ' '; map.push(i); pendingSpace = false; }
      out += '...'; map.push(i, i, i);
      continue;
    }
    if (/\s/.test(ch)) {
      if (out.length) pendingSpace = true;
      continue;
    }
    if (pendingSpace) { out += ' '; map.push(i); pendingSpace = false; }
    out += ch;
    map.push(i);
  }
  return { text: out, map };
}

function occurrences(hay, needle) {
  const hits = [];
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at === -1) break;
    hits.push(at);
    from = at + 1;
  }
  return hits;
}

/* Words with char offsets; `cmp` is the comparison form — lowercase, edge
 * punctuation dropped — so a comma or a quote mark never counts as a
 * change. */
function wordsOf(text) {
  const out = [];
  const re = /\S+/g;
  let m;
  const s = String(text);
  while ((m = re.exec(s))) {
    const raw = m[0];
    const cmp = raw.toLowerCase().replace(/^[\s"'“”‘’([{<.,;:!?—–-]+|[\s"'“”‘’)\]}>.,;:!?—–-]+$/g, '');
    out.push({ raw, cmp, start: m.index, end: m.index + raw.length });
  }
  return out;
}

/* Classic word-level Levenshtein between two arrays of comparison words. */
export function wordDistance(a, b) {
  const n = a.length;
  const m = b.length;
  if (!n) return m;
  if (!m) return n;
  let prev = new Array(m + 1);
  for (let j = 0; j <= m; j += 1) prev[j] = j;
  for (let i = 1; i <= n; i += 1) {
    const cur = new Array(m + 1);
    cur[0] = i;
    for (let j = 1; j <= m; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[m];
}

const FUZZY_FLOOR = 0.78;
const FUZZY_GAP = 0.05;
const FUZZY_MAX_WORDS = 8000;

function fuzzyLocate(hay, ned) {
  const hWords = wordsOf(hay);
  const nWords = wordsOf(ned).map((w) => w.cmp).filter(Boolean);
  const n = nWords.length;
  if (!n) return { error: 'the edit gave no words to look for' };
  if (hWords.length > FUZZY_MAX_WORDS) return { error: 'the page is too long to search loosely — quote a shorter passage' };
  const spread = Math.max(2, Math.round(n * 0.2));
  const nSet = new Set(nWords);

  /* Slide windows of about the needle's length; a cheap overlap filter
   * skips the hopeless ones before the DP runs. */
  let best = null;
  const minLen = Math.max(1, n - spread);
  const maxLen = n + spread;
  for (let i = 0; i + minLen <= hWords.length; i += 1) {
    for (let L = minLen; L <= maxLen && i + L <= hWords.length; L += 1) {
      const win = hWords.slice(i, i + L).map((w) => w.cmp);
      let overlap = 0;
      for (const w of win) if (nSet.has(w)) overlap += 1;
      if (overlap < Math.ceil(n * 0.4)) continue;
      const dist = wordDistance(nWords, win);
      const sim = 1 - dist / Math.max(n, L);
      if (!best || sim > best.sim) best = { i, L, sim };
    }
  }
  if (!best) return { error: 'nothing on the page reads close to those words' };

  /* The second-best window must not overlap the best — a near window of
   * the SAME passage is not a rival; a different passage that reads just
   * as close is. */
  let second = null;
  for (let i = 0; i + minLen <= hWords.length; i += 1) {
    for (let L = minLen; L <= maxLen && i + L <= hWords.length; L += 1) {
      if (i < best.i + best.L && best.i < i + L) continue; // overlaps the best
      const win = hWords.slice(i, i + L).map((w) => w.cmp);
      let overlap = 0;
      for (const w of win) if (nSet.has(w)) overlap += 1;
      if (overlap < Math.ceil(n * 0.4)) continue;
      const dist = wordDistance(nWords, win);
      const sim = 1 - dist / Math.max(n, L);
      if (!second || sim > second.sim) second = { i, L, sim };
    }
  }

  if (best.sim < FUZZY_FLOOR) {
    return { error: 'nothing on the page reads close enough to those words — it may have been rewritten since' };
  }
  if (second && second.sim > best.sim - FUZZY_GAP) {
    return { error: 'two passages read too much alike — the change can’t tell them apart; quote more of the passage' };
  }

  /* minimalDiff salvage: the needle and the matched passage often share
   * ragged edges; strip the common prefix/suffix once so the replacement
   * touches only what truly changes. */
  const start = hWords[best.i].start;
  const end = hWords[best.i + best.L - 1].end;
  const matched = hay.slice(start, end);
  const md = minimalDiff(ned, matched);
  const tightStart = start + md.prefix;
  const tightEnd = end - md.suffix;
  return {
    start: tightStart,
    end: Math.max(tightStart + 1, tightEnd),
    via: 'fuzzy',
    similarity: best.sim,
  };
}

/* The one anchor every page edit rides. Returns
 *   {ok:true, start, end, via:'exact'|'normalized'|'fuzzy', similarity?}
 * or {ok:false, reason} — ambiguity is always a clean refusal. */
export function locate(haystack, needle) {
  const hay = String(haystack == null ? '' : haystack);
  const ned = String(needle == null ? '' : needle);
  if (!ned.trim()) return { ok: false, reason: 'the change gave nothing to look for' };
  if (!hay) return { ok: false, reason: 'there is no text on the page to search' };

  /* 1. Exact. More than one landing place is a refusal, never a guess. */
  const hits = occurrences(hay, ned);
  if (hits.length === 1) return { ok: true, start: hits[0], end: hits[0] + ned.length, via: 'exact' };
  if (hits.length > 1) {
    return { ok: false, reason: 'those exact words appear ' + hits.length + ' times on the page — quote more of the passage' };
  }

  /* 2. Quote/whitespace-normalized exact. */
  const nHay = normalizeWithMap(hay);
  const nNed = normalizeWithMap(ned).text;
  if (nNed) {
    const nHits = occurrences(nHay.text, nNed);
    if (nHits.length === 1) {
      const start = nHay.map[nHits[0]];
      const end = nHay.map[nHits[0] + nNed.length - 1] + 1;
      return { ok: true, start, end, via: 'normalized' };
    }
    if (nHits.length > 1) {
      return { ok: false, reason: 'even loosely, those words land in ' + nHits.length + ' places — quote more of the passage' };
    }
  }

  /* 3. Word-Levenshtein fuzzy, with the ambiguity bar. */
  const fuzzy = fuzzyLocate(hay, ned);
  if (fuzzy && fuzzy.error) return { ok: false, reason: fuzzy.error };
  return { ok: true, ...fuzzy };
}

/* ---------- the edit protocol (hostile-tolerant parsing) ---------- */

/* Every <tag>…</tag> region, case-insensitive, in source order. A missing
 * close tag reads to the end of the reply (a truncated answer still yields
 * what it wrote). */
function innerBlocks(text, tag) {
  const s = String(text);
  const lower = s.toLowerCase();
  const open = '<' + tag + '>';
  const close = '</' + tag + '>';
  const out = [];
  let from = 0;
  for (;;) {
    const at = lower.indexOf(open, from);
    if (at === -1) break;
    const bodyStart = at + open.length;
    const endAt = lower.indexOf(close, bodyStart);
    out.push({
      start: at,
      end: endAt === -1 ? s.length : endAt + close.length,
      body: s.slice(bodyStart, endAt === -1 ? s.length : endAt),
    });
    from = bodyStart;
  }
  return out;
}

/* The LAST balanced [...] in a string, respecting quoted text — when a
 * model rambles a broken attempt and then a good one, the good one (the
 * last) is what we keep. '' when none balances. */
export function lastBalancedArray(text) {
  const s = String(text || '');
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;
  let last = '';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '[') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === ']') {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start !== -1) {
          last = s.slice(start, i + 1);
          start = -1;
        }
      }
    }
  }
  return last;
}

/* One pass that makes hostile JSON parseable: raw control characters
 * inside strings become escapes (stray ones are dropped), and trailing
 * commas before } or ] vanish — all without touching string contents
 * otherwise. */
export function sanitizeJson(text) {
  const s = String(text);
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inString) {
      if (escaped) { out += ch; escaped = false; continue; }
      if (ch === '\\') { out += ch; escaped = true; continue; }
      if (ch === '"') { out += ch; inString = false; continue; }
      const code = ch.charCodeAt(0);
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { out += '\\r'; continue; }
      if (ch === '\t') { out += '\\t'; continue; }
      if (code < 0x20) continue; // stray control char — let it go
      out += ch;
      continue;
    }
    if (ch === '"') { out += ch; inString = true; continue; }
    if (ch === ',') {
      /* a comma whose next real char closes a bracket is trailing */
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j += 1;
      if (s[j] === '}' || s[j] === ']') continue;
      out += ch;
      continue;
    }
    out += ch;
  }
  return out;
}

/* The tolerant reader for every JSON payload in the protocol: fences out,
 * LAST balanced array (or single balanced object) kept, plain parse first,
 * sanitized parse as the salvage. null on any remaining trouble. */
export function tolerantJson(raw) {
  try {
    const text = String(raw == null ? '' : raw).replace(/```(?:json|JSON)?/g, '');
    let candidate = lastBalancedArray(text);
    if (!candidate) {
      /* a single object payload (one op written bare) still counts */
      const start = text.indexOf('{');
      if (start === -1) return null;
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let i = start; i < text.length; i += 1) {
        const ch = text[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === '\\') escaped = true;
          else if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '{') depth += 1;
        else if (ch === '}') {
          depth -= 1;
          if (depth === 0) { candidate = text.slice(start, i + 1); break; }
        }
      }
    }
    if (!candidate) return null;
    try {
      return JSON.parse(candidate);
    } catch (err) {
      const cleaned = sanitizeJson(candidate);
      try { return JSON.parse(cleaned); } catch (err2) { return null; }
    }
  } catch (err) {
    return null;
  }
}

/* <fetch>[3, "#a1b2c3"]</fetch> — the ids may come as numbers, quoted
 * strings, or bare #codes (not valid JSON), so refs are read token-wise
 * after a tolerant parse attempt. */
function parseFetchRefs(body) {
  const isRef = (t) => /^#?[0-9a-f]{3,12}$/i.test(t) || /^\d{1,5}$/.test(t);
  const parsed = tolerantJson(body);
  if (Array.isArray(parsed)) {
    return parsed.map((r) => String(r).trim()).filter((t) => t && isRef(t));
  }
  const inner = String(body || '').replace(/^\s*\[/, '').replace(/\]\s*$/, '');
  return inner.split(',')
    .map((t) => t.trim().replace(/^["']+|["']+$/g, ''))
    .filter((t) => t && isRef(t));
}

/* <supersede>label one, label two</supersede> — commas or newlines. */
function parseLabels(body) {
  return String(body || '')
    .split(/[,\n]+/)
    .map((s) => s.trim().replace(/^["']+|["']+$/g, ''))
    .filter(Boolean);
}

/* Parse one housekeeper reply into its protocol blocks and the natural
 * words around them. `text` is the reply with every block lifted out —
 * what the panel bubble shows. Never throws. */
export function parseProtocol(raw) {
  const source = String(raw == null ? '' : raw);
  const out = { edits: [], ledits: [], redits: [], lore: [], record: [], fetch: [], supersede: [], fetchMalformed: false, text: '' };
  try {
    const spans = [];
    for (const tag of ['edits', 'ledits', 'redits', 'lore', 'record', 'fetch', 'supersede']) {
      for (const block of innerBlocks(source, tag)) {
        spans.push(block);
        if (tag === 'fetch') {
          const refs = parseFetchRefs(block.body);
          /* M61 (v2.79): words instead of refs is unreadable, not "no fetch" */
          if (!refs.length && String(block.body || '').trim()) out.fetchMalformed = true;
          out.fetch.push(...refs);
        } else if (tag === 'supersede') {
          out.supersede.push(...parseLabels(block.body));
        } else {
          const parsed = tolerantJson(block.body);
          const list = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
          for (const item of list) {
            if (item && typeof item === 'object' && !Array.isArray(item)) out[tag].push(item);
          }
        }
      }
    }
    spans.sort((a, b) => b.start - a.start);
    let display = source;
    for (const s of spans) display = display.slice(0, s.start) + display.slice(s.end);
    out.text = display.replace(/\n{3,}/g, '\n\n').trim();
  } catch (err) {
    out.text = source.trim();
  }
  return out;
}

/* ---------- message refs ---------- */

/* The handle the index serves for a page: '#' + the id's first six. */
export function refOf(message) {
  return '#' + String(message && message.id || '').slice(0, 6);
}

/* Resolve a ref the model wrote back to a message: the full id, the
 * served #code (prefix, 4+ chars), or a bare ordinal into the visible
 * index (1-based, as served). null when nothing answers to it. */
export function resolveMessageRef(messages, ref) {
  const list = Array.isArray(messages) ? messages : [];
  const raw = String(ref == null ? '' : ref).trim();
  if (!raw) return null;
  const bare = raw.replace(/^#/, '');
  const exact = list.find((m) => m && m.id === raw);
  if (exact) return exact;
  if (bare.length >= 4) {
    const prefixed = list.filter((m) => m && typeof m.id === 'string' && m.id.startsWith(bare));
    if (prefixed.length === 1) return prefixed[0];
  }
  if (/^\d+$/.test(bare)) {
    const visible = list.filter((m) => m && !m.hidden);
    const at = Number(bare) - 1;
    if (at >= 0 && at < visible.length) return visible[at];
  }
  return null;
}

/* ---------- the context served to the model ---------- */

/* One index line per visible page: #code, speaker, a 150-char preview. */
export function messageIndexLine(msg, ordinal) {
  const speaker = msg.role === 'assistant' ? 'the storyteller' : 'the writer';
  const aside = msg.ooc ? ' (aside)' : '';
  const preview = pageText(msg).replace(/\s+/g, ' ').trim();
  const cut = preview.length > PREVIEW_CHARS
    ? preview.slice(0, PREVIEW_CHARS - 1).trimEnd() + '…'
    : preview;
  return refOf(msg) + ' ' + speaker + aside + ' — ' + (cut || '(an empty page)');
}

export function cleanContextPages(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_CONTEXT_PAGES;
  return Math.min(CONTEXT_PAGES_MAX, Math.max(CONTEXT_PAGES_MIN, n));
}

/* The whole served picture, as one document: the brief, the page index,
 * the last N visible pages in full, the ledger summary, the rulebook's
 * names, and the showrunners' blocks when they have something to say. */
export function buildHousekeeperContext({
  story, messages, state, modules, lore, memory, session, directorText, editorText, contextPages,
} = {}) {
  const visible = (Array.isArray(messages) ? messages : []).filter((m) => m && !m.hidden);
  const n = cleanContextPages(contextPages);
  const indexStart = Math.max(0, visible.length - INDEX_CAP);

  const indexLines = [];
  if (indexStart > 0) {
    indexLines.push('(…and ' + indexStart + ' earlier pages; ask for any by #code with <fetch>)');
  }
  for (let i = indexStart; i < visible.length; i += 1) {
    indexLines.push(messageIndexLine(visible[i], i + 1));
  }

  const fullPages = visible.slice(-n).map((m) => formatPage(m));

  const ledger = renderStateFacts(state) || 'The ledger is blank so far.';
  const rulebook = (Array.isArray(modules) ? modules : [])
    .map((mod) => mod && typeof mod.name === 'string'
      ? mod.name + (mod.pinned ? ' (pinned on)' : '')
      : '')
    .filter(Boolean);

  const parts = [];
  const brief = story && typeof story.brief === 'string' ? story.brief.trim() : '';
  parts.push('The story is “' + ((story && story.title) || 'an untitled tale') + '”.');
  if (brief) parts.push('Its brief, in the writer’s own words:\n' + brief);
  parts.push('The pages of the story, one line each:\n' + (indexLines.join('\n') || '(no pages yet)'));
  if (fullPages.length) {
    parts.push('The last ' + fullPages.length + ' pages in full:\n\n' + fullPages.join('\n\n'));
  }
  parts.push('What the ledger says:\n' + ledger);
  parts.push('The rulebook holds: ' + (rulebook.join('; ') || 'nothing but the craft itself') + '.');
  /* M61: the record — the memory the housekeeper keeps consistent — whole,
   * each line with its handle (#r…) so a <record> edit can name it */
  const recordLines = (memory && Array.isArray(memory.nodes) ? memory.nodes : [])
    .filter((nd) => nd && Array.isArray(nd.span) && typeof nd.text === 'string' && nd.text.trim())
    .sort((a, b) => a.span[0] - b.span[0]);
  if (recordLines.length) {
    parts.push('THE RECORD (the memory of the pages that left the window; oldest to newest; each line covers pages ' + '"span"' + ' — quote a line exactly to edit it with <record>):\n'
      + recordLines.map((nd) => '[#r' + String(nd.id).slice(0, 6) + ' pages ' + (nd.span[0] + 1) + '–' + (nd.span[1] + 1) + '] ' + nd.text.trim()).join('\n'));
  } else {
    parts.push('THE RECORD: nothing folded yet — every page is still in the window.');
  }
  /* M61 (v2.82): the pending cards, with STALE marked where the anchor no
   * longer matches — so the model can withdraw or re-anchor, never guess */
  const pending = [];
  for (const turn of (session && Array.isArray(session.turns) ? session.turns : [])) {
    for (const pr of (Array.isArray(turn.proposals) ? turn.proposals : [])) {
      if (!pr || pr.status !== 'pending') continue;
      let stale = '';
      if (pr.kind === 'edit' && pr.op && pr.op.find && pr.op.messageId) {
        const m = (Array.isArray(messages) ? messages : []).find((x) => x && x.id === pr.op.messageId);
        if (!m) stale = ' ⚠ STALE — the page is gone';
        else if (!locate(pageText(m), pr.op.find).ok) stale = ' ⚠ STALE — its anchor no longer matches (already fixed, or the text changed)';
      }
      pending.push('- “' + pr.label + '”' + (pr.op && pr.op.messageId ? ' on ' + refOf({ id: pr.op.messageId }) : '') + stale);
    }
  }
  parts.push(pending.length
    ? 'PENDING CARDS (staged earlier, not yet applied by the writer). A card marked STALE must be withdrawn with <supersede> or re-proposed with a fresh anchor in THIS answer; a card the writer no longer needs is withdrawn the same way — prose never removes a card:\n' + pending.join('\n')
    : 'PENDING CARDS: none.');
  const shelf = Array.isArray(lore) ? lore : [];
  if (shelf.length) {
    parts.push('The lore shelf holds:\n' + shelf.map((e) => '- ' + (e.name || (e.keys || [])[0] || 'an unnamed entry') + ' [' + (e.keys || []).join(', ') + ']' + (e.enabled === false ? ' (off)' : '') + (e.constant ? ' (always rides)' : '') + ': ' + String(e.content || '').slice(0, 200).replace(/\s+/g, ' ')).join('\n'));
  } else {
    parts.push('The lore shelf is empty.');
  }
  if (directorText) parts.push('[DIRECTOR]\n' + directorText);
  if (editorText) parts.push('[EDITOR]\n' + editorText);
  return parts.join('\n\n');
}

/* ---------- the prompt (human-voiced, kept in the code) ---------- */

const SYSTEM_PROMPT = [
  'You are the housekeeper of a cozy tavern where two writers tell a slow, warm',
  'story together. You can see the whole of it — the pages, the ledger, the',
  'rulebook — and the writer talks to you when something needs a steady hand:',
  'a name that drifted, a contradiction to repair, a passage to re-ink, a truth',
  'to write down or let go.',
  '',
  'Answer in plain, warm words. When a change is called for, propose it inside',
  'your reply with these blocks — they are staged as cards the writer must',
  'approve; nothing you write here changes the story on its own:',
  '',
  '<edits>[ ... ]</edits> — changes to pages. Each op is one of:',
  '  {"id":"#a1b2c3","find":"the exact passage","replace":"the new words","reason":"why"}',
  '  {"id":"#a1b2c3","hide":true} — or false to bring a hidden page back',
  '  {"bulk_replace":true,"find":"Mira","replace":"Mara","range":"12-30","reason":"why"}',
  '  Quote the passage exactly as written. If it could land in more than one',
  '  place, quote more of it — an ambiguous find is refused, never guessed at.',
  '  Optional "label":"a-short-name" names the card.',
  '<ledits>[ ... ]</ledits> — changes to the ledger, in its own closed',
  '  vocabulary: clock.set {year,month,day,hour,minute}; clock.advance',
  '  {minutes,reason}; presence.enter/leave/update {name,position?,attire?};',
  '  mode.set/mode.clear {flag of combat|intimate|travel|socialField|isolation|group};',
  '  body.injure {name,what,sev 1-3,treated}; body.strain {name,what}; body.heal',
  '  {name,what}; rel.shift {name,axis p|r|s,delta,cause}; rel.set {name,p?,r?,s?,cause};',
  '  offscreen.set {name,location,activity,agenda?}; offscreen.clear {name};',
  '  canon.lock {name,key,value}; canon.unlock {name,key};',
  '  and {"type":"module.pin","module":"the rule’s name","pinned":true|false}.',
  '  Every op carries its "type". Unknown types are rejected by the ledger itself.',
  '<redits>[ ... ]</redits> — changes to a rulebook rule’s text:',
  '  {"module":"the rule’s name","find":"…","replace":"…","reason":"why"}',
  '<record>[ ... ]</record> — changes to the record’s lines (the memory of the pages that',
  '  left the window): {"line":"#r1a2b3c","find":"…","replace":"…","reason":"why"} — "line" is the',
  '  handle shown with each line; find is quoted exactly from that line. Never invent an event',
  '  into the record; repair what it says.',
  '<lore>[ ... ]</lore> — changes to the lore shelf (the entries that wake when',
  '  their keys are spoken in the latest pages):',
  '  {"add":true,"name":"Aurora","keys":["Aurora","the neighbor"],"content":"…","constant":false,"reason":"why"}',
  '  {"entry":"Aurora","content":"…","keys":[…],"enabled":true|false,"constant":true|false,"reason":"why"}',
  '  {"entry":"Aurora","remove":true,"reason":"why"}',
  '  "entry" is the entry’s name or its first key. Content is the truth the',
  '  storyteller should carry when the key is spoken — facts, not prose.',
  '<fetch>["#a1b2c3", "#d4e5f6"]</fetch> — ask to be served full pages you',
  '  only have one-line previews of. You may ask up to three times in a turn.',
  '<supersede>label, label</supersede> — retire still-pending cards from your',
  '  earlier answers when this answer replaces them.',
  '',
  'Be surgical and be honest. Propose only what the writer asked for or what',
  'clearly needs repair; say plainly when nothing needs doing. Never rewrite a',
  'page wholesale when a sentence will do. The find text must always be the',
  'story’s own words, exactly as they stand.',
  '',
  'ANCHORS ARE COPIES, NOT DESCRIPTIONS. A find is quoted from the full text you hold.',
  'The one-line index shows what is roughly where and can never be quoted; if you do',
  'not hold a page whole, <fetch> it first. Fetching is the block, not the words —',
  'never ask the writer whether to fetch, never announce a fetch: write the block.',
  'ONE FACT, EVERY SURFACE. A story fact lives in the pages, the record’s lines, the',
  'pages of the people, the canon and the lore at once; correcting one and leaving the',
  'rest manufactures a new contradiction. When you correct a fact, sweep the other',
  'surfaces in the same answer and say what you checked.',
  'WITHDRAW WITH THE BLOCK. When a pending card is stale, moot, or you agree with the',
  'writer it is unneeded, name its label in <supersede> in that same answer; agreeing',
  'in prose removes nothing.',
].join('\n');

/* ---------- fingerprints (staleness + drift) ---------- */

function messageHashOf(msg) {
  return hashText(String(msg && msg.text || '') + '' + (msg && msg.hidden === true ? '1' : '0'));
}

function moduleHashOf(mod) {
  return hashText(String(mod && mod.name || '') + '' + String(mod && mod.text || '')
    + '' + (mod && mod.pinned ? '1' : '0'));
}

function stateHashOf(state) {
  try { return hashText(JSON.stringify(state || {})); } catch (err) { return hashText(''); }
}

/* ---------- the session store ---------- */

export async function loadSession(storyId) {
  const fresh = { turns: [], batches: [] };
  if (!storyId) return fresh;
  try {
    const saved = await db.settings.get(SESSION_PREFIX + storyId);
    if (!saved || typeof saved !== 'object') return fresh;
    return {
      turns: (Array.isArray(saved.turns) ? saved.turns : [])
        .filter((t) => t && typeof t === 'object' && typeof t.text === 'string')
        .map((t) => ({
          role: t.role === 'housekeeper' ? 'housekeeper' : 'writer',
          text: t.text,
          ts: Number.isFinite(t.ts) ? t.ts : 0,
          ...(Array.isArray(t.proposals) ? { proposals: t.proposals } : {}),
        })),
      batches: (Array.isArray(saved.batches) ? saved.batches : [])
        .filter((b) => b && typeof b === 'object' && Array.isArray(b.items)),
    };
  } catch (err) {
    return fresh;
  }
}

export async function saveSession(storyId, session) {
  if (!storyId || !session || typeof session !== 'object') return;
  await db.settings.set(SESSION_PREFIX + storyId, {
    turns: (session.turns || []).slice(-SESSION_TURNS_CAP),
    batches: (session.batches || []).slice(-UNDO_CAP),
  });
}

/* ---------- staging: parsed protocol -> proposal cards ---------- */

function cleanReason(value) {
  const s = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return s.length > 200 ? s.slice(0, 199).trimEnd() + '…' : s;
}

/* Parse a range the model offered: "3-9", [3,9], "all", or nothing. */
function parseRange(range, visibleCount) {
  if (Array.isArray(range) && range.length === 2) {
    const a = Math.max(1, Math.round(Number(range[0]) || 1));
    const b = Math.min(visibleCount, Math.round(Number(range[1]) || visibleCount));
    return a <= b ? [a, b] : null;
  }
  const m = /^\s*(\d+)\s*[-–—]\s*(\d+)\s*$/.exec(String(range == null ? '' : range));
  if (m) {
    const a = Math.max(1, Number(m[1]));
    const b = Math.min(visibleCount, Number(m[2]));
    return a <= b ? [a, b] : null;
  }
  return [1, Math.max(1, visibleCount)]; // no range named = every visible page
}

/* Turn a parsed reply into staged proposal cards, each fingerprinted
 * against its targets (the review-hash: if a target drifts after staging,
 * the card reads stale). */
export function stageProposals(parsed, { messages, state, modules, lore, memory, session } = {}) {
  const proposals = [];
  const all = Array.isArray(messages) ? messages : [];
  const visible = all.filter((m) => m && !m.hidden);
  const mods = Array.isArray(modules) ? modules : [];
  let auto = 0;
  const nextLabel = (base) => { auto += 1; return base + ' ' + auto; };
  /* M61 (v2.76): a pending card whose anchor is dead is retired by a newer
   * proposal for the same page — never by anchor equality */
  const retireDead = (messageId) => {
    for (const turn of (session && Array.isArray(session.turns) ? session.turns : [])) {
      for (const pr of (Array.isArray(turn.proposals) ? turn.proposals : [])) {
        if (!pr || pr.status !== 'pending' || pr.kind !== 'edit' || !pr.op || pr.op.messageId !== messageId || !pr.op.find) continue;
        const m = all.find((x) => x && x.id === messageId);
        if (!m || !locate(pageText(m), pr.op.find).ok) { pr.status = 'superseded'; pr.words = 'Set aside — its anchor no longer matches; replaced by the newer proposal.'; }
      }
    }
  };

  for (const op of (parsed && Array.isArray(parsed.edits) ? parsed.edits : [])) {
    if (!op || typeof op !== 'object') continue;
    if (op.bulk_replace === true) {
      const find = typeof op.find === 'string' ? op.find : '';
      const replace = typeof op.replace === 'string' ? op.replace : '';
      if (!find) continue;
      const range = parseRange(op.range, visible.length);
      const ids = range
        ? visible.slice(range[0] - 1, range[1]).map((m) => m.id)
        : [];
      const targets = all.filter((m) => ids.includes(m.id));
      proposals.push({
        id: uid(),
        ts: Date.now(),
        kind: 'edit',
        label: typeof op.label === 'string' && op.label.trim()
          ? op.label.trim() : nextLabel('everywhere “' + find.slice(0, 24) + '”'),
        reason: cleanReason(op.reason),
        op: { bulk: true, find, replace, ids },
        status: targets.length ? 'pending' : 'refused',
        words: targets.length ? '' : 'the range it named holds no pages',
        review: [{ target: 'bulk', hash: hashText(targets.map(messageHashOf).join('|')) }],
      });
      continue;
    }
    const msg = resolveMessageRef(all, op.id);
    if (!msg) {
      proposals.push({
        id: uid(), ts: Date.now(), kind: 'edit',
        label: typeof op.label === 'string' && op.label.trim() ? op.label.trim() : nextLabel('edit'),
        reason: cleanReason(op.reason),
        op: { messageId: '', ref: String(op.id || '') },
        status: 'refused',
        words: 'no page answers to “' + String(op.id || '?') + '”',
        review: [],
      });
      continue;
    }
    if (op.hide === true || op.hide === false) {
      proposals.push({
        id: uid(), ts: Date.now(), kind: 'edit',
        label: typeof op.label === 'string' && op.label.trim()
          ? op.label.trim() : (op.hide ? 'fold away ' : 'bring back ') + refOf(msg),
        reason: cleanReason(op.reason),
        op: { messageId: msg.id, hide: op.hide },
        status: 'pending',
        words: '',
        review: [{ target: 'msg:' + msg.id, hash: messageHashOf(msg) }],
      });
      continue;
    }
    if (typeof op.find === 'string' && op.find && typeof op.replace === 'string') {
      /* M61 (v2.76): the anchor is checked at arrival with Apply's own matcher —
       * a card that cannot land says so now, never as a failed Apply later */
      const loc = locate(pageText(msg), op.find);
      retireDead(msg.id);
      proposals.push({
        id: uid(), ts: Date.now(), kind: 'edit',
        label: typeof op.label === 'string' && op.label.trim()
          ? op.label.trim() : 're-ink ' + refOf(msg),
        reason: cleanReason(op.reason),
        op: { messageId: msg.id, find: op.find, replace: op.replace },
        status: loc.ok ? 'pending' : 'refused',
        words: loc.ok ? '' : 'its anchor does not match the page: ' + loc.reason,
        review: loc.ok ? [{ target: 'msg:' + msg.id, hash: messageHashOf(msg) }] : [],
      });
    }
  }

  /* M61: the record's lines */
  const nodes = memory && Array.isArray(memory.nodes) ? memory.nodes : [];
  for (const op of (parsed && Array.isArray(parsed.record) ? parsed.record : [])) {
    if (!op || typeof op !== 'object' || typeof op.find !== 'string' || !op.find || typeof op.replace !== 'string') continue;
    const handle = String(op.line || '').replace(/^#?r/i, '').trim().toLowerCase();
    let node = handle ? nodes.find((nd) => nd && String(nd.id).slice(0, 6).toLowerCase() === handle.slice(0, 6)) : null;
    if (!node) node = nodes.find((nd) => nd && typeof nd.text === 'string' && locate(nd.text, op.find).ok) || null;
    if (!node) {
      proposals.push({ id: uid(), ts: Date.now(), kind: 'record', label: 'record: ' + (op.line || '?'), reason: cleanReason(op.reason), op, status: 'refused', words: 'no record line answers to “' + (op.line || op.find.slice(0, 40)) + '”', review: [] });
      continue;
    }
    const loc = locate(node.text, op.find);
    proposals.push({
      id: uid(), ts: Date.now(), kind: 'record',
      label: typeof op.label === 'string' && op.label.trim() ? op.label.trim() : 'record line #r' + String(node.id).slice(0, 6),
      reason: cleanReason(op.reason),
      op: { nodeId: node.id, find: op.find, replace: op.replace },
      status: loc.ok ? 'pending' : 'refused',
      words: loc.ok ? '' : 'its anchor does not match the line: ' + loc.reason,
      review: loc.ok ? [{ target: 'record:' + node.id, hash: hashText(node.text) }] : [],
    });
  }

  const ledits = parsed && Array.isArray(parsed.ledits) ? parsed.ledits : [];
  const mutations = ledits.filter((m) => m && typeof m === 'object' && typeof m.type === 'string' && m.type.trim());
  if (mutations.length) {
    const reasonOp = ledits.find((m) => m && typeof m.reason === 'string' && m.reason.trim());
    proposals.push({
      id: uid(),
      ts: Date.now(),
      kind: 'ledit',
      label: nextLabel('ledger changes'),
      reason: cleanReason(reasonOp ? reasonOp.reason : ''),
      op: { mutations },
      status: 'pending',
      words: '',
      review: [{ target: 'state', hash: stateHashOf(state) }],
    });
  }

  for (const op of (parsed && Array.isArray(parsed.redits) ? parsed.redits : [])) {
    if (!op || typeof op !== 'object') continue;
    if (typeof op.find !== 'string' || !op.find || typeof op.replace !== 'string') continue;
    const wanted = String(op.module || '').trim().toLowerCase();
    const named = wanted
      ? mods.filter((m) => m && typeof m.name === 'string' && m.name.trim().toLowerCase() === wanted)
      : [];
    const mod = named.length === 1 ? named[0]
      : mods.find((m) => m && typeof m.name === 'string'
          && m.name.trim().toLowerCase().startsWith(wanted)) || null;
    if (!mod) {
      proposals.push({
        id: uid(), ts: Date.now(), kind: 'redit',
        label: 'rule: ' + (op.module || '?'),
        reason: cleanReason(op.reason),
        op: { moduleName: String(op.module || ''), find: op.find, replace: op.replace },
        status: 'refused',
        words: wanted
          ? (named.length > 1
            ? 'more than one rule answers to “' + op.module + '”'
            : 'the rulebook holds no rule called “' + op.module + '”')
          : 'it didn’t say which rule',
        review: [],
      });
      continue;
    }
    proposals.push({
      id: uid(), ts: Date.now(), kind: 'redit',
      label: typeof op.label === 'string' && op.label.trim()
        ? op.label.trim() : 'rule: ' + mod.name,
      reason: cleanReason(op.reason),
      op: { moduleId: mod.id, moduleName: mod.name, find: op.find, replace: op.replace },
      status: 'pending',
      words: '',
      review: [{ target: 'mod:' + mod.id, hash: moduleHashOf(mod) }],
    });
  }

  /* M38: the lore shelf */
  const shelf = Array.isArray(lore) ? lore : [];
  const findEntry = (ref) => {
    const w = String(ref || '').trim().toLowerCase();
    if (!w) return null;
    return shelf.find((e) => e && ((typeof e.name === 'string' && e.name.trim().toLowerCase() === w) || e.id === ref))
      || shelf.find((e) => e && Array.isArray(e.keys) && e.keys.some((k) => String(k).trim().toLowerCase() === w))
      || null;
  };
  for (const op of (parsed && Array.isArray(parsed.lore) ? parsed.lore : [])) {
    if (!op || typeof op !== 'object') continue;
    const reason = cleanReason(op.reason);
    if (op.add === true) {
      const keys = Array.isArray(op.keys) ? op.keys.map((k) => String(k == null ? '' : k).trim()).filter(Boolean) : [];
      const content = typeof op.content === 'string' ? op.content.trim() : '';
      const name = typeof op.name === 'string' ? op.name.trim() : '';
      if (!keys.length && !name) { proposals.push({ id: uid(), ts: Date.now(), kind: 'lore', label: 'lore: (unnamed)', reason, op, status: 'refused', words: 'an entry needs a name or a key', review: [] }); continue; }
      if (!content) { proposals.push({ id: uid(), ts: Date.now(), kind: 'lore', label: 'lore: ' + (name || keys[0]), reason, op, status: 'refused', words: 'an entry needs its content', review: [] }); continue; }
      proposals.push({
        id: uid(), ts: Date.now(), kind: 'lore',
        label: typeof op.label === 'string' && op.label.trim() ? op.label.trim() : 'lore: add ' + (name || keys[0]),
        reason,
        op: { add: true, name: name || null, keys: keys.length ? keys : [name], content, constant: op.constant === true },
        status: 'pending', words: '', review: [{ target: 'lore:shelf', hash: hashText(JSON.stringify(shelf.map((e) => e.id))) }],
      });
      continue;
    }
    const entry = findEntry(op.entry);
    if (!entry) {
      proposals.push({ id: uid(), ts: Date.now(), kind: 'lore', label: 'lore: ' + (op.entry || '?'), reason, op, status: 'refused', words: op.entry ? 'the shelf holds no entry called “' + op.entry + '”' : 'it didn’t say which entry', review: [] });
      continue;
    }
    if (op.remove === true) {
      proposals.push({
        id: uid(), ts: Date.now(), kind: 'lore', label: 'lore: remove ' + (entry.name || entry.keys[0]), reason,
        op: { entryId: entry.id, remove: true },
        status: 'pending', words: '', review: [{ target: 'lore:' + entry.id, hash: hashText(JSON.stringify(entry)) }],
      });
      continue;
    }
    const patch = {};
    if (typeof op.content === 'string') patch.content = op.content;
    if (typeof op.name === 'string') patch.name = op.name;
    if (Array.isArray(op.keys)) patch.keys = op.keys;
    if (typeof op.enabled === 'boolean') patch.enabled = op.enabled;
    if (typeof op.constant === 'boolean') patch.constant = op.constant;
    if (!Object.keys(patch).length) { proposals.push({ id: uid(), ts: Date.now(), kind: 'lore', label: 'lore: ' + (entry.name || entry.keys[0]), reason, op, status: 'refused', words: 'it didn’t say what should change', review: [] }); continue; }
    proposals.push({
      id: uid(), ts: Date.now(), kind: 'lore', label: 'lore: ' + (entry.name || entry.keys[0]), reason,
      op: { entryId: entry.id, patch },
      status: 'pending', words: '', review: [{ target: 'lore:' + entry.id, hash: hashText(JSON.stringify(entry)) }],
    });
  }

  return proposals;
}

/* M61 (v2.77): what an edit actually removes — find minus the head and tail
 * it shares with replace — and every other surface where those words still
 * sit. Pure; exported for the harness. */
export function removedWords(find, replace) {
  const f = String(find || ''); const r = String(replace || '');
  let head = 0;
  while (head < f.length && head < r.length && f[head] === r[head]) head += 1;
  let tail = 0;
  while (tail < f.length - head && tail < r.length - head && f[f.length - 1 - tail] === r[r.length - 1 - tail]) tail += 1;
  /* never split a word: widen to the whitespace on either side */
  while (head > 0 && /\S/.test(f[head - 1])) head -= 1;
  while (tail > 0 && /\S/.test(f[f.length - tail])) tail -= 1;
  return f.slice(head, f.length - tail).trim();
}
export function rippleScan(edits, { messages, memory, state, lore } = {}) {
  const out = [];
  const pages = (Array.isArray(messages) ? messages : []).filter((m) => m && !m.hidden);
  for (const op of (Array.isArray(edits) ? edits : [])) {
    if (!op || typeof op !== 'object' || typeof op.find !== 'string' || typeof op.replace !== 'string') continue;
    const removed = removedWords(op.find, op.replace);
    if (removed.length < 3 || !/\p{L}|\d/u.test(removed)) continue; /* a name like "Kim" counts; bare punctuation does not */
    const where = [];
    const target = op.bulk_replace ? null : resolveMessageRef(pages, op.id);
    for (const m of pages) {
      if (target && m.id === target.id) continue;
      if (pageText(m).includes(removed)) where.push(refOf(m));
      if (where.length >= 8) break;
    }
    for (const nd of (memory && Array.isArray(memory.nodes) ? memory.nodes : [])) {
      if (nd && typeof nd.text === 'string' && nd.text.includes(removed)) where.push('the record line #r' + String(nd.id).slice(0, 6));
    }
    for (const [name, c] of Object.entries((state && state.characters) || {})) {
      if (c && ['core', 'state', 'arc'].some((k) => typeof c[k] === 'string' && c[k].includes(removed))) where.push('the page of ' + name);
    }
    for (const [name, facts] of Object.entries((state && state.canon) || {})) {
      if (facts && Object.values(facts).some((v) => typeof v === 'string' && v.includes(removed))) where.push('the canon of ' + name);
    }
    for (const e of (Array.isArray(lore) ? lore : [])) {
      if (e && typeof e.content === 'string' && e.content.includes(removed)) where.push('the lore entry “' + (e.name || (e.keys || [])[0] || '?') + '”');
    }
    if (where.length) out.push({ removed: removed.slice(0, 80), where: [...new Set(where)] });
  }
  return out;
}

/* M61 (v2.78): labels match loosely — "memory fix #1" lands on "Memory fix 1" */
function labelKey(v) { return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

/* Supersede: retire still-pending cards whose labels the reply named.
 * Returns {count, unmatched}. */
export function applySupersede(session, labels) {
  const wanted = new Map((Array.isArray(labels) ? labels : []).map((l) => [labelKey(l), String(l).trim()]).filter(([k]) => k));
  if (!wanted.size) return { count: 0, unmatched: [] };
  let count = 0;
  const hit = new Set();
  for (const turn of (session && Array.isArray(session.turns) ? session.turns : [])) {
    for (const p of (Array.isArray(turn.proposals) ? turn.proposals : [])) {
      const k = labelKey(p && p.label);
      if (p && p.status === 'pending' && wanted.has(k)) {
        p.status = 'superseded';
        p.words = 'Set aside — a later answer withdrew it.';
        count += 1;
        hit.add(k);
      }
    }
  }
  const unmatched = [...wanted.entries()].filter(([k]) => !hit.has(k)).map(([, raw]) => raw);
  return { count, unmatched };
}

export function findProposal(session, proposalId) {
  for (const turn of (session && Array.isArray(session.turns) ? session.turns : [])) {
    const list = Array.isArray(turn.proposals) ? turn.proposals : [];
    const found = list.find((p) => p && p.id === proposalId);
    if (found) return found;
  }
  return null;
}

/* ---------- the apply engine (cards become true, with a way back) ---------- */

function pushBatch(session, batch) {
  session.batches = Array.isArray(session.batches) ? session.batches : [];
  session.batches.push(batch);
  if (session.batches.length > UNDO_CAP) {
    session.batches = session.batches.slice(session.batches.length - UNDO_CAP);
  }
}

/* The staleness gate: every review-hash is recomputed against the world as
 * it stands NOW; any mismatch marks the card stale and the apply never
 * happens. Returns '' when everything still stands as staged. */
async function stalenessCheck(storyId, p) {
  const review = Array.isArray(p.review) ? p.review : [];
  if (!review.length) return '';
  const all = await db.messages.list(storyId);
  for (const r of review) {
    if (!r || typeof r.target !== 'string') continue;
    if (r.target.startsWith('msg:')) {
      const msg = all.find((m) => m && m.id === r.target.slice(4));
      if (!msg) return 'the page it would change has gone from the story';
      if (messageHashOf(msg) !== r.hash) return 'the page has been re-inked since this was staged';
    } else if (r.target === 'bulk') {
      const ids = Array.isArray(p.op && p.op.ids) ? p.op.ids : [];
      const targets = all.filter((m) => ids.includes(m.id));
      if (hashText(targets.map(messageHashOf).join('|')) !== r.hash) {
        return 'some of those pages have shifted since this was staged';
      }
    } else if (r.target.startsWith('record:')) {
      const mem = await loadMemory(storyId);
      const nd = (mem.nodes || []).find((x) => x && x.id === r.target.slice(7));
      if (!nd) return 'that record line has gone';
      if (hashText(nd.text) !== r.hash) return 'that record line has been rewritten since this was staged';
    } else if (r.target === 'lore:shelf') {
      const shelf = await loadLore(storyId);
      if (hashText(JSON.stringify(shelf.map((e) => e.id))) !== r.hash) return 'the lore shelf has changed since this was staged';
    } else if (r.target.startsWith('lore:')) {
      const shelf = await loadLore(storyId);
      const entry = shelf.find((e) => e && e.id === r.target.slice(5));
      if (!entry) return 'that lore entry has gone from the shelf';
      if (hashText(JSON.stringify(entry)) !== r.hash) return 'that lore entry has been edited since this was staged';
    } else if (r.target === 'state') {
      const fresh = await loadState(storyId);
      if (stateHashOf(fresh) !== r.hash) return 'the ledger has been written since this was staged';
    } else if (r.target.startsWith('mod:')) {
      const mods = await listModules();
      const mod = mods.find((m) => m && m.id === r.target.slice(4));
      if (!mod) return 'the rule it would change is gone from the rulebook';
      if (moduleHashOf(mod) !== r.hash) return 'the rule’s words have changed since this was staged';
    }
  }
  return '';
}

/* Swap the located span for the replacement, through minimalDiff so only
 * the words that truly change are touched. */
function applyLocated(text, located, replace) {
  const found = text.slice(located.start, located.end);
  const md = minimalDiff(found, replace);
  const start = located.start + md.prefix;
  const end = located.end - md.suffix;
  return text.slice(0, start) + md.replace + text.slice(end);
}

/* A page patch that keeps the swipes in step, the way a hand edit does. */
function editPatchFor(msg, newText) {
  const patch = { text: newText };
  if (Array.isArray(msg.swipes) && msg.swipes.length) {
    const idx = Number.isFinite(msg.swipeIdx)
      ? Math.min(msg.swipes.length - 1, Math.max(0, msg.swipeIdx))
      : msg.swipes.length - 1;
    const swipes = msg.swipes.slice();
    swipes[idx] = { ...swipes[idx], text: newText };
    patch.swipes = swipes;
  }
  return patch;
}

async function applyEditOp(storyId, p, batch) {
  const op = p.op;
  const all = await db.messages.list(storyId);

  if (op.bulk) {
    /* Every exact occurrence across the named pages. */
    const targets = all.filter((m) => (op.ids || []).includes(m.id));
    let hits = 0;
    for (const msg of targets) {
      const text = typeof msg.text === 'string' ? msg.text : '';
      if (!text.includes(op.find)) continue;
      hits += text.split(op.find).length - 1;
      const newText = text.split(op.find).join(op.replace);
      batch.items.push({
        kind: 'message',
        messageId: msg.id,
        before: { text: msg.text, swipes: msg.swipes, swipeIdx: msg.swipeIdx, hidden: msg.hidden === true },
        afterHash: messageHashOf({ text: newText, hidden: msg.hidden === true }),
      });
      await db.messages.update(storyId, msg.id, editPatchFor(msg, newText));
    }
    if (!hits) return { ok: false, words: '“' + op.find + '” doesn’t appear in those pages' };
    return { ok: true, words: 'Re-inked ' + hits + (hits === 1 ? ' place' : ' places') + ' across the named pages.' };
  }

  const msg = all.find((m) => m && m.id === op.messageId);
  if (!msg) return { ok: false, words: 'the page it would change has gone from the story' };

  if (op.hide === true || op.hide === false) {
    const hidden = op.hide === true;
    if ((msg.hidden === true) === hidden) {
      return { ok: false, words: hidden ? 'that page was already folded away' : 'that page already shows' };
    }
    batch.items.push({
      kind: 'message',
      messageId: msg.id,
      before: { text: msg.text, swipes: msg.swipes, swipeIdx: msg.swipeIdx, hidden: msg.hidden === true },
      afterHash: messageHashOf({ text: msg.text, hidden }),
    });
    await db.messages.update(storyId, msg.id, { hidden });
    return { ok: true, words: hidden ? 'The page is folded away.' : 'The page shows again.' };
  }

  const text = typeof msg.text === 'string' ? msg.text : '';
  const located = locate(text, op.find);
  if (!located.ok) return { ok: false, words: located.reason };
  const newText = applyLocated(text, located, op.replace);
  if (newText === text) return { ok: false, words: 'the new words are the words already there' };
  batch.items.push({
    kind: 'message',
    messageId: msg.id,
    before: { text: msg.text, swipes: msg.swipes, swipeIdx: msg.swipeIdx, hidden: msg.hidden === true },
    afterHash: messageHashOf({ text: newText, hidden: msg.hidden === true }),
  });
  await db.messages.update(storyId, msg.id, editPatchFor(msg, newText));
  return {
    ok: true,
    words: 'The page is re-inked'
      + (located.via === 'fuzzy' ? ' (the anchor was loose, but sure)' : '') + '.',
  };
}

async function applyLeditOp(storyId, p, batch) {
  const mutations = Array.isArray(p.op && p.op.mutations) ? p.op.mutations : [];
  /* Module pins ride beside the ledger vocabulary but live in the
   * rulebook's own store — validated and reversible all the same. */
  const pins = mutations.filter((m) => m.type === 'module.pin');
  const ledgerOps = mutations.filter((m) => m.type !== 'module.pin');

  const words = [];
  if (ledgerOps.length) {
    const fresh = await loadState(storyId);
    const { state: next, applied, rejected } = applyMutations(fresh, ledgerOps);
    if (applied.length) {
      await saveState(storyId, next);
      notify(storyId);
      /* The after-hash is read back through the store so it fingerprints
       * exactly what a later undo will compare against. */
      const settled = await loadState(storyId);
      batch.items.push({
        kind: 'ledger',
        before: fresh,
        afterHash: stateHashOf(settled),
        words: applied.map((a) => a.words),
      });
      words.push(...applied.map((a) => a.words));
    }
    for (const r of rejected) words.push('Declined: ' + r.why + '.');
  }

  for (const pin of pins) {
    const mods = await listModules();
    const wantedName = String(pin.module || '').trim().toLowerCase();
    const mod = mods.find((m) => m && typeof m.name === 'string'
      && m.name.trim().toLowerCase() === wantedName);
    if (!mod) { words.push('Declined: the rulebook holds no rule called “' + (pin.module || '?') + '”.'); continue; }
    const pinned = pin.pinned !== false;
    if (Boolean(mod.pinned) === pinned) {
      words.push('“' + mod.name + '” was already ' + (pinned ? 'pinned on' : 'resting') + '.');
      continue;
    }
    /* What was saved before — null when no saved row stood (a pristine
     * builtin): undo then lifts the fork, which restores the builtin. */
    const savedRows = await db.settings.get('modules');
    const beforeRow = (Array.isArray(savedRows) ? savedRows : []).find((r) => r && r.id === mod.id) || null;
    const saved = await saveModule({
      id: mod.id, name: mod.name, text: mod.text,
      pinned, whenKey: mod.whenKey, note: mod.note,
    });
    batch.items.push({
      kind: 'module',
      moduleId: mod.id,
      beforeRow,
      afterHash: moduleHashOf(saved || { ...mod, pinned }),
    });
    words.push(pinned ? '“' + mod.name + '” is pinned on.' : '“' + mod.name + '” rests now.');
  }

  if (!batch.items.length) {
    return { ok: false, words: words.join(' ') || 'nothing in it held' };
  }
  return { ok: true, words: words.join(' ') };
}

async function applyReditOp(storyId, p, batch) {
  const op = p.op;
  const mods = await listModules();
  const mod = mods.find((m) => m && m.id === op.moduleId);
  if (!mod) return { ok: false, words: 'the rule it would change is gone from the rulebook' };
  const located = locate(mod.text, op.find);
  if (!located.ok) return { ok: false, words: located.reason };
  const newText = applyLocated(mod.text, located, op.replace);
  if (newText === mod.text) return { ok: false, words: 'the new words are the words already there' };
  const savedRows = await db.settings.get('modules');
  const beforeRow = (Array.isArray(savedRows) ? savedRows : []).find((r) => r && r.id === mod.id) || null;
  const saved = await saveModule({
    id: mod.id, name: mod.name, text: newText,
    pinned: mod.pinned, whenKey: mod.whenKey, note: mod.note,
  });
  batch.items.push({
    kind: 'module',
    moduleId: mod.id,
    beforeRow,
    afterHash: moduleHashOf(saved || { ...mod, text: newText }),
  });
  return { ok: true, words: 'The rule “' + mod.name + '” reads differently now.' };
}

/* M61: a record line, re-inked by the smallest edit; the whole line is kept
 * for the undo. */
async function applyRecordOp(storyId, p, batch) {
  const op = p.op;
  const mem = await loadMemory(storyId);
  const at = (mem.nodes || []).findIndex((nd) => nd && nd.id === op.nodeId);
  if (at === -1) return { ok: false, words: 'that record line has gone' };
  const node = mem.nodes[at];
  const located = locate(node.text, op.find);
  if (!located.ok) return { ok: false, words: located.reason };
  const newText = applyLocated(node.text, located, op.replace);
  if (newText === node.text) return { ok: false, words: 'the new words are the words already there' };
  const nodes = mem.nodes.slice();
  nodes[at] = { ...node, text: newText, verified: { at: Date.now(), fixed: 'the housekeeper' } };
  await saveMemory(storyId, { ...mem, nodes });
  batch.items.push({ kind: 'record', nodeId: node.id, before: node.text, afterHash: hashText(newText) });
  return { ok: true, words: 'The record line reads differently now.' };
}

/* M38: the lore shelf. Every op reads the shelf, changes it, writes it
 * back; the batch keeps the whole shelf as it was. */
async function applyLoreOp(storyId, p, batch) {
  const op = p.op;
  const shelf = await loadLore(storyId);
  const beforeShelf = JSON.parse(JSON.stringify(shelf));
  let next;
  let words;
  if (op.add) {
    const id = 'lore-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    const entry = { id, name: op.name || null, keys: op.keys, content: op.content, enabled: true, constant: op.constant === true, secondaryKeys: [], depth: 2 };
    next = [...shelf, entry];
    words = 'The shelf gained “' + (entry.name || entry.keys[0]) + '”.';
  } else {
    const at = shelf.findIndex((e) => e && e.id === op.entryId);
    if (at === -1) return { ok: false, words: 'that entry has gone from the shelf' };
    if (op.remove) {
      next = shelf.filter((e) => e.id !== op.entryId);
      words = 'The shelf let “' + (shelf[at].name || shelf[at].keys[0]) + '” go.';
    } else {
      const e = { ...shelf[at] };
      const pch = op.patch || {};
      if (typeof pch.content === 'string') e.content = pch.content;
      if (typeof pch.name === 'string') e.name = pch.name.trim() || null;
      if (Array.isArray(pch.keys)) e.keys = pch.keys.map((k) => String(k == null ? '' : k).trim()).filter(Boolean);
      if (typeof pch.enabled === 'boolean') e.enabled = pch.enabled;
      if (typeof pch.constant === 'boolean') e.constant = pch.constant;
      next = shelf.slice(); next[at] = e;
      words = 'The entry “' + (e.name || e.keys[0]) + '” reads differently now.';
    }
  }
  await saveLore(storyId, next);
  batch.items.push({ kind: 'lore', beforeShelf, afterHash: hashText(JSON.stringify(next)) });
  return { ok: true, words };
}

/* Apply one card. Claim-then-apply: the status flips synchronously at the
 * door, so a second click (or a racing render) meets "already spoken for"
 * instead of a double write. Returns {ok, words, stale?, touched}. */
export async function applyProposal(session, storyId, proposalId) {
  const p = findProposal(session, proposalId);
  if (!p) return { ok: false, words: 'that card is gone' };
  if (p.status !== 'pending') {
    return { ok: false, words: p.status === 'applying'
      ? 'that card is already being applied'
      : 'that card is already spoken for' };
  }
  p.status = 'applying'; // the claim — before any await
  try {
    const stale = await stalenessCheck(storyId, p);
    if (stale) {
      p.status = 'stale';
      p.words = stale + ' — ask, and it can be proposed again.';
      return { ok: false, stale: true, words: p.words };
    }
    const batch = {
      id: uid(),
      ts: Date.now(),
      label: p.label,
      undone: false,
      items: [],
    };
    const run = p.kind === 'ledit' ? applyLeditOp
      : p.kind === 'redit' ? applyReditOp
      : p.kind === 'lore' ? applyLoreOp
      : p.kind === 'record' ? applyRecordOp
      : applyEditOp;
    const result = await run(storyId, p, batch);
    if (!result.ok) {
      p.status = 'refused';
      p.words = result.words;
      return { ok: false, words: result.words };
    }
    if (batch.items.length) pushBatch(session, batch);
    p.status = 'applied';
    p.words = result.words;
    return {
      ok: true,
      words: result.words,
      touched: {
        messages: batch.items.some((i) => i.kind === 'message'),
        state: batch.items.some((i) => i.kind === 'ledger'),
        modules: batch.items.some((i) => i.kind === 'module'),
        lore: batch.items.some((i) => i.kind === 'lore'),
      },
    };
  } catch (err) {
    /* a failed apply hands the card back, unspoken-for, with kind words */
    p.status = 'pending';
    p.words = '';
    return { ok: false, words: (err && err.message) || 'it wouldn’t hold — nothing was changed' };
  }
}

/* Apply every pending card in order; the words of each are gathered. */
export async function applyAllPending(session, storyId) {
  const pending = [];
  for (const turn of (session && Array.isArray(session.turns) ? session.turns : [])) {
    for (const p of (Array.isArray(turn.proposals) ? turn.proposals : [])) {
      if (p && p.status === 'pending') pending.push(p);
    }
  }
  const words = [];
  const touched = { messages: false, state: false, modules: false };
  let any = false;
  for (const p of pending) {
    const result = await applyProposal(session, storyId, p.id);
    if (result.ok) {
      any = true;
      if (result.touched) {
        touched.messages = touched.messages || result.touched.messages;
        touched.state = touched.state || result.touched.state;
        touched.modules = touched.modules || result.touched.modules;
      }
    }
    if (result.words) words.push(result.words);
  }
  return { ok: any, words: words.join(' '), touched, count: pending.length };
}

/* ---------- drift-guarded undo ---------- */

/* Take back the newest batch that still stands. Every target's after-hash
 * is checked first; a target that drifted (a swipe, an edit, a worker's
 * write) refuses the whole undo LOUDLY and nothing is touched. */
export async function undoLatest(session, storyId) {
  const batches = session && Array.isArray(session.batches) ? session.batches : [];
  const batch = [...batches].reverse().find((b) => b && !b.undone);
  if (!batch) {
    return { ok: false, words: 'Nothing the housekeeper changed still stands to take back.' };
  }

  const all = await db.messages.list(storyId);
  for (const item of batch.items) {
    if (item.kind === 'message') {
      const msg = all.find((m) => m && m.id === item.messageId);
      if (!msg) {
        return { ok: false, refused: true, words: 'Not taken back — the page “' + batch.label + '” touched has gone from the story. The change stands; re-ink it by hand if it must move.' };
      }
      if (messageHashOf(msg) !== item.afterHash) {
        return { ok: false, refused: true, words: 'Not taken back — that page has been re-inked or swiped since “' + batch.label + '” landed. The change stands; undo by hand if it must move.' };
      }
    } else if (item.kind === 'module') {
      const mods = await listModules();
      const mod = mods.find((m) => m && m.id === item.moduleId);
      if (!mod || moduleHashOf(mod) !== item.afterHash) {
        return { ok: false, refused: true, words: 'Not taken back — the rule “' + batch.label + '” touched has changed since. The change stands; edit the rulebook by hand if it must move.' };
      }
    } else if (item.kind === 'record') {
      const mem = await loadMemory(storyId);
      const nd = (mem.nodes || []).find((x) => x && x.id === item.nodeId);
      if (!nd || hashText(nd.text) !== item.afterHash) {
        return { ok: false, refused: true, words: 'Not taken back — that record line has been rewritten since “' + batch.label + '” landed.' };
      }
    } else if (item.kind === 'lore') {
      const now = await loadLore(storyId);
      if (hashText(JSON.stringify(now)) !== item.afterHash) {
        return { ok: false, refused: true, words: 'Not taken back — the lore shelf has changed since “' + batch.label + '” landed. The change stands; edit the shelf by hand if it must move.' };
      }
    } else if (item.kind === 'ledger') {
      const fresh = await loadState(storyId);
      if (stateHashOf(fresh) !== item.afterHash) {
        return { ok: false, refused: true, words: 'Not taken back — the ledger has been written since “' + batch.label + '” landed (a page turned, or a hand wrote in it). The change stands; the drawer’s own “Take it back” can walk the log.' };
      }
    }
  }

  for (const item of batch.items) {
    if (item.kind === 'message') {
      await db.messages.update(storyId, item.messageId, item.before);
    } else if (item.kind === 'module') {
      if (item.beforeRow) await saveModule(item.beforeRow);
      else await removeModule(item.moduleId); // lifts the fork; a builtin returns
    } else if (item.kind === 'record') {
      const mem = await loadMemory(storyId);
      const nodes = (mem.nodes || []).map((x) => (x && x.id === item.nodeId ? { ...x, text: item.before } : x));
      await saveMemory(storyId, { ...mem, nodes });
    } else if (item.kind === 'lore') {
      await saveLore(storyId, item.beforeShelf);
    } else if (item.kind === 'ledger') {
      const restored = JSON.parse(JSON.stringify(item.before));
      restored.log = Array.isArray(restored.log) ? restored.log : [];
      restored.log.push({
        ts: Date.now(),
        words: 'Taken back — the housekeeper’s change: ' + batch.label + '.',
        undone: false,
      });
      if (restored.log.length > 200) restored.log = restored.log.slice(restored.log.length - 200);
      await saveState(storyId, restored);
      notify(storyId);
    }
  }
  batch.undone = true;
  return { ok: true, words: 'Taken back — ' + batch.label + '.' };
}

/* ---------- the model call (worker connection, off the story path) ---------- */

/* The shared one-call spine for the housekeeper and the showrunners.
 * Rides the provider registry (system string accepted, thinking channel
 * honored). Never throws into a caller that didn't ask for it — errors
 * come back as {error}. */
export async function callModel(connection, { system, messages, maxTokens, signal, onToken } = {}) {
  try {
    if (!connection || typeof connection !== 'object') return { error: 'no connection' };
    const conn = { ...connection };
    if (typeof conn.maxTokens !== 'number' || conn.maxTokens <= 0) {
      conn.maxTokens = maxTokens || 1600;
    }
    const provider = createProvider(conn);
    const result = await provider.streamChat({
      system: String(system || ''),
      messages: Array.isArray(messages) ? messages : [],
      signal,
      onToken: typeof onToken === 'function' ? onToken : undefined,
    });
    return { text: typeof result.text === 'string' ? result.text : '', thinking: result.thinking || '' };
  } catch (err) {
    return { error: (err && err.message) || 'the call went quiet' };
  }
}

/* The pages a <fetch> asked for, served whole (capped). */
function serveFetch(refs, messages) {
  const lines = [];
  for (const ref of refs.slice(0, 4)) {
    const msg = resolveMessageRef(messages, ref);
    if (!msg) {
      lines.push(refOf({ id: ref }) + ' — no page answers to “' + ref + '”.');
      continue;
    }
    lines.push(formatPage(msg));
  }
  /* M61 (v2.72): over-cap ids are named back, never dropped */
  if (refs.length > 4) lines.push('Not served this round (ask again for them): ' + refs.slice(4).join(', '));
  return lines.join('\n\n');
}

/* One conversation turn with the housekeeper, fetch-rounds included.
 * `call` is injectable for the harness; the default rides callModel.
 * Never throws. Returns {ok, raw, parsed, fetchRounds, thinking, error?}. */
export async function runConversation({
  connection, story, messages, state, modules, lore, memory, directorText, editorText,
  session, writerText, contextPages, call, signal, onToken,
} = {}) {
  try {
    const caller = typeof call === 'function'
      ? call
      : (req) => callModel(connection, req);
    const contextDoc = buildHousekeeperContext({
      story, messages, state, modules, lore, memory, session, directorText, editorText, contextPages,
    });
    /* M61: which pages the model holds WHOLE — the served window plus every
     * fetched page. An edit to any other page is blind (v2.76/v2.80). */
    const visibleAll = (Array.isArray(messages) ? messages : []).filter((m) => m && !m.hidden);
    const served = new Set(visibleAll.slice(-cleanContextPages(contextPages)).map((m) => m.id));
    let correctedAnchors = false;
    let sweptRipple = false;
    let fetchedBlind = false;
    let toldMalformed = false;
    /* Session history rides after the served context — newest first is NOT
     * wanted here; the talk reads in order, capped. */
    const sessionWire = (session && Array.isArray(session.turns) ? session.turns : [])
      .slice(-20)
      .map((t) => ({
        role: t.role === 'housekeeper' ? 'assistant' : 'user',
        content: t.text,
      }));
    const wire = [
      { role: 'user', content: 'Here is the whole house as it stands:\n\n' + contextDoc },
      ...sessionWire,
      { role: 'user', content: String(writerText || '') },
    ];

    let round = 0;
    for (;;) {
      const answer = await caller({
        system: withFictionFrame(SYSTEM_PROMPT),
        messages: wire,
        maxTokens: 2000,
        signal,
        onToken: round === 0 ? onToken : undefined,
      });
      if (answer && answer.error) return { ok: false, error: answer.error };
      const raw = answer && typeof answer.text === 'string' ? answer.text : '';
      const thinking = answer && typeof answer.thinking === 'string' ? answer.thinking : '';
      if (!raw.trim()) return { ok: false, error: 'the housekeeper went quiet — nothing came back' };
      const parsed = parseProtocol(raw);
      if (parsed.fetch.length && round < MAX_FETCH_ROUNDS) {
        round += 1;
        for (const ref of parsed.fetch.slice(0, 4)) { const m = resolveMessageRef(messages, ref); if (m) served.add(m.id); }
        wire.push({ role: 'assistant', content: raw });
        wire.push({
          role: 'user',
          content: 'The pages you asked for:\n\n' + serveFetch(parsed.fetch, messages),
        });
        continue;
      }
      /* M61 (v2.79): a fetch written in words is unreadable — say so once */
      if (parsed.fetchMalformed && !parsed.fetch.length && !toldMalformed) {
        toldMalformed = true;
        wire.push({ role: 'assistant', content: raw });
        wire.push({ role: 'user', content: 'Your <fetch> block could not be read — it must hold page handles only, like <fetch>["#a1b2c3", "#d4e5f6"]</fetch> (the handles shown in the index). Resend it as such, or answer without it.' });
        continue;
      }
      /* M61 (v2.76/v2.80): a blind edit — a page the model never held whole —
       * is fetched and the answer asked again, once, instead of staged */
      const blind = [];
      for (const op of parsed.edits) {
        if (!op || typeof op !== 'object' || op.bulk_replace === true) continue;
        const m = resolveMessageRef(messages, op.id);
        if (m && !served.has(m.id) && typeof op.find === 'string' && op.find) blind.push(m);
      }
      if (blind.length && !fetchedBlind) {
        fetchedBlind = true;
        for (const m of blind.slice(0, 4)) served.add(m.id);
        wire.push({ role: 'assistant', content: raw });
        wire.push({ role: 'user', content: '[BLIND EDIT] You proposed edits to pages you had only seen as one-line index entries: ' + blind.slice(0, 4).map(refOf).join(', ') + '. Here they are whole. Re-send your whole answer with anchors quoted from these pages (and keep any other proposals you still stand by):\n\n' + serveFetch(blind.slice(0, 4).map(refOf), messages) });
        continue;
      }
      /* M61 (v2.76): anchors are checked at arrival with the apply's own
       * resolver; a miss is corrected in the same run, once */
      const misses = [];
      for (const op of parsed.edits) {
        if (!op || typeof op !== 'object' || op.bulk_replace === true || typeof op.find !== 'string' || !op.find) continue;
        const m = resolveMessageRef(messages, op.id);
        if (!m) continue;
        const loc = locate(pageText(m), op.find);
        if (!loc.ok) misses.push({ ref: refOf(m), find: op.find, why: loc.reason });
      }
      if (misses.length && !correctedAnchors) {
        correctedAnchors = true;
        wire.push({ role: 'assistant', content: raw });
        wire.push({ role: 'user', content: '[ANCHOR CHECK] These finds do not match the page as it stands (checked with the same matcher Apply uses):\n' + misses.map((x) => '- ' + x.ref + ': “' + x.find.slice(0, 120) + '” — ' + x.why).join('\n') + '\nRe-send your whole answer with each find copied exactly from the page (quote more of it if it could land in two places); keep the proposals that were fine.' });
        continue;
      }
      /* M61 (v2.77): the ripple — the words an edit removes still sit on
       * other surfaces; they are found in code and handed back once */
      if (!sweptRipple) {
        const leftovers = rippleScan(parsed.edits, { messages, memory, state, lore });
        if (leftovers.length) {
          sweptRipple = true;
          wire.push({ role: 'assistant', content: raw });
          wire.push({ role: 'user', content: '[RIPPLE] The words your edits remove still stand elsewhere:\n' + leftovers.map((l) => '- “' + l.removed + '” in ' + l.where.join(', ')).join('\n') + '\nSweep them in this answer — bulk_replace for pages (or one edit each), <record> for a record line, <ledits> people.set for a page of the people, <lore> for an entry — and say what you checked. Keep every proposal you already made.' });
          continue;
        }
      }
      return { ok: true, raw, parsed, fetchRounds: round, thinking };
    }
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'the housekeeper stumbled' };
  }
}

/* The panel's whole turn, store to store: load everything, run the
 * conversation, stage the cards, honor supersede, persist the session.
 * Never throws. */
export async function housekeeperTurn({
  storyId, writerText, connection, call, signal, onToken,
  directorText, editorText,
} = {}) {
  try {
    if (!storyId) return { ok: false, error: 'no story is open' };
    const story = await db.stories.get(storyId);
    if (!story) return { ok: false, error: 'that story has gone' };
    const [messages, state, modules, session, pagesSetting, lore, mem] = await Promise.all([
      db.messages.list(storyId),
      loadState(storyId),
      listModules(),
      loadSession(storyId),
      db.settings.get('hkContextPages'),
      loadLore(storyId),
      loadMemory(storyId),
    ]);
    const result = await runConversation({
      connection, story, messages, state, modules, lore, memory: mem,
      directorText, editorText,
      session, writerText,
      contextPages: cleanContextPages(pagesSetting),
      call, signal, onToken,
    });
    if (!result.ok) return { ok: false, error: result.error || 'the housekeeper went quiet' };

    const proposals = stageProposals(result.parsed, { messages, state, modules, lore, memory: mem, session });
    let withdrawNote = '';
    if (result.parsed.supersede.length) {
      const sup = applySupersede(session, result.parsed.supersede);
      if (sup.unmatched.length) withdrawNote = '\n\n(No pending card answers to: ' + sup.unmatched.map((l) => '“' + l + '”').join(', ') + ' — nothing was withdrawn for those.)';
      else if (sup.count && !proposals.length) withdrawNote = '\n\n(Withdrew ' + sup.count + (sup.count === 1 ? ' card' : ' cards') + '.)';
    }

    session.turns.push({ role: 'writer', text: String(writerText || ''), ts: Date.now() });
    const turn = {
      role: 'housekeeper',
      text: result.parsed.text + withdrawNote,
      ts: Date.now(),
    };
    if (proposals.length) turn.proposals = proposals;
    if (result.thinking) turn.thinking = result.thinking;
    session.turns.push(turn);
    await saveSession(storyId, session);
    return {
      ok: true,
      reply: result.parsed.text,
      thinking: result.thinking || '',
      proposals,
      fetchRounds: result.fetchRounds,
      session,
    };
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'the housekeeper stumbled' };
  }
}
