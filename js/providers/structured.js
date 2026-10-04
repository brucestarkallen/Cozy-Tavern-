/* Cozy Tavern — providers/structured.js (M580)
 * THE STRUCTURED PREFILL. His word: "there's this something called structured prefill … I need everything." The technique
 * is the StructuredPrefill extension's (aimicrocot, "Cheesedozer Edition") — written here from its README and its
 * behaviour, not copied (the repository carries no licence): a prefill sent as an assistant message is text the model is
 * HANDED, and newer models refuse it, ignore it, or reject the request outright. Instead the request asks for a JSON
 * answer whose one field must MATCH A PATTERN that begins with his opening words — so the model writes those words
 * ITSELF to satisfy the schema, and carries on from them. Its answer arrives as {"response":"…"}; the decoder below reads
 * the words out of it as they stream, so the page streams as any page does.
 *
 * What the template may hold (his prefill's reply part — what follows </think>, or the whole of it):
 *   [[keep]]            everything before it is written by the model but never shown (nor kept on the page)
 *   [[end]] [[stop]] [[eos]]   the reply ends where the template ends
 *   [[w:3]] [[w:2-6]] [[words:…]]   that many words
 *   [[opt:yes|no|maybe]]   one of these
 *   [[line]] [[lines:2-4]]   one line / that many lines
 *   [[free]]            any text on one line
 *   [[num]] [[number:1-100]]   a whole number / one in range
 *   [[emotion]] [[mood]]   one common feeling
 *   [[name]]            a capitalised name
 *   [[action]] [[thought]]   a short phrase (1–6 / 1–10 words, no quotes)
 *   [[re:<pattern>]]    his own pattern
 * Anything else in [[…]] is written as it stands.
 *
 * Only an address that takes OpenAI-style JSON-schema answers can do this; one that refuses is remembered (the
 * connection's structuredDownAt, for its model) and the turn goes again with the prefill as written. */

const SLOT = /\[\[([^\]\n]{1,400})\]\]/g;
const EMOTIONS = ['happy', 'sad', 'angry', 'afraid', 'nervous', 'anxious', 'calm', 'tense', 'tired', 'curious', 'surprised',
  'shocked', 'confused', 'embarrassed', 'flustered', 'shy', 'proud', 'jealous', 'guilty', 'ashamed', 'hopeful', 'lonely',
  'bored', 'excited', 'amused', 'annoyed', 'irritated', 'frustrated', 'grateful', 'relieved', 'determined', 'desperate',
  'disgusted', 'hurt', 'wary', 'suspicious', 'content', 'playful', 'tender', 'cold', 'furious', 'terrified', 'grim'];

/* one regex-safe literal; newlines and tabs as escapes (a schema with a raw newline is refused by some houses); in ascii
 * mode every other character outside ASCII as \uXXXX (OpenRouter's Claude routes take only an ASCII pattern) */
export function literalPattern(text, { ascii = false } = {}) {
  let out = '';
  for (const ch of String(text == null ? '' : text)) {
    if (ch === '\n') { out += '\\n'; continue; }
    if (ch === '\r') continue;
    if (ch === '\t') { out += '\\t'; continue; }
    if (/[\\^$.*+?()[\]{}|/]/.test(ch)) { out += '\\' + ch; continue; }
    const code = ch.codePointAt(0);
    if (ascii && code > 0x7e) {
      const units = code > 0xffff ? [0xd800 + ((code - 0x10000) >> 10), 0xdc00 + ((code - 0x10000) & 0x3ff)] : [code];
      out += units.map((u) => '\\u' + u.toString(16).padStart(4, '0')).join('');
      continue;
    }
    out += ch;
  }
  return out;
}

const range = (raw) => {
  const m = String(raw || '').trim().match(/^(\d{1,4})(?:\s*-\s*(\d{1,4}))?$/);
  if (!m) return null;
  const a = Number(m[1]); const b = m[2] === undefined ? a : Number(m[2]);
  return a <= b ? [a, b] : [b, a];
};
const WORD = '[^\\s]+';
const PHRASE_WORD = '[^\\s"“”*()]+';
const wordsPattern = (min, max, word = WORD) => {
  const lo = Math.max(1, min); const hi = Math.max(lo, max);
  return word + (hi === 1 ? '' : '(?: ' + word + '){' + (lo - 1) + ',' + (hi - 1) + '}');
};
function numberPattern(lo, hi) {
  if (hi - lo <= 30) return '(?:' + Array.from({ length: hi - lo + 1 }, (_, i) => String(lo + i)).join('|') + ')';
  const minDigits = String(lo).length; const maxDigits = String(hi).length;
  return '[0-9]{' + minDigits + ',' + maxDigits + '}';
}

/* a slot's pattern, or null when the marker is not a slot (it is then written as it stands) */
export function slotPattern(body, { ascii = false } = {}) {
  const raw = String(body || '').trim();
  const [head, ...restParts] = raw.split(':');
  const name = head.trim().toLowerCase();
  const rest = restParts.join(':');
  if (name === 'w' || name === 'words') { const r = range(rest || '1'); return r ? wordsPattern(r[0], r[1]) : null; }
  if (name === 'opt' || name === 'options') {
    const opts = rest.split('|').map((o) => o.trim()).filter(Boolean);
    return opts.length ? '(?:' + opts.map((o) => literalPattern(o, { ascii })).join('|') + ')' : null;
  }
  if (name === 'line') return '[^\\n]+';
  if (name === 'lines') { const r = range(rest || '1'); return r ? '[^\\n]+(?:\\n[^\\n]+){' + (r[0] - 1) + ',' + (r[1] - 1) + '}' : null; }
  if (name === 'free') return '[^\\n]+';
  if (name === 'num') return '-?[0-9]+';
  if (name === 'number') { const r = range(rest); return r ? numberPattern(r[0], r[1]) : null; }
  if (name === 'emotion' || name === 'mood') return '(?:' + EMOTIONS.join('|') + ')';
  if (name === 'name') return '[A-Z][a-zA-Z\'-]+(?: [A-Z][a-zA-Z\'-]+){0,2}';
  if (name === 'action') return wordsPattern(1, 6, PHRASE_WORD);
  if (name === 'thought') return wordsPattern(1, 10, PHRASE_WORD);
  if (name === 're' || name === 'regex') {
    let src = rest.trim();
    const m = src.match(/^\/([\s\S]*)\/[a-z]*$/i);
    if (m) src = m[1];
    src = src.replace(/\n/g, '\\n');
    try { new RegExp(src); } catch (err) { return null; }
    return src ? '(?:' + src + ')' : null;
  }
  return null;
}

/* the template as a pattern — literal text escaped, slots as their patterns */
export function templatePattern(template, { ascii = false } = {}) {
  const t = String(template == null ? '' : template);
  let out = ''; let at = 0;
  for (const m of t.matchAll(SLOT)) {
    out += literalPattern(t.slice(at, m.index), { ascii });
    const p = slotPattern(m[1], { ascii });
    out += p === null ? literalPattern(m[0], { ascii }) : p;
    at = m.index + m[0].length;
  }
  return out + literalPattern(t.slice(at), { ascii });
}

const KEEP = /\[\[\s*keep\s*\]\]/i;
const END = /\[\[\s*(?:end|stop|eos)\s*\]\]\s*$/i;
/* the prefill's reply part, read: what is written but hidden ([[keep]]), what stays, and whether the reply ends there */
export function readTemplate(text) {
  let t = String(text == null ? '' : text).replace(/\r/g, '');
  const mustEnd = END.test(t);
  if (mustEnd) t = t.replace(END, '');
  const k = t.search(KEEP);
  const hidden = k === -1 ? '' : t.slice(0, k);
  const shown = k === -1 ? t : t.slice(k).replace(KEEP, '');
  return { hidden, shown, whole: hidden + shown, mustEnd };
}

/* does this connection's model take only an ASCII pattern (Claude through OpenRouter)? */
export function asciiOnly(conn) {
  const model = String(conn && conn.model || '').toLowerCase();
  return model.includes('claude') || model.startsWith('anthropic/');
}

export const MIN_AFTER_DEFAULT = 80;
/* the schema his request carries: one string field that must open with the template and carry on at least minChars more */
export function structuredSchema(text, { minChars = MIN_AFTER_DEFAULT, ascii = false, banned = '' } = {}) {
  const tpl = readTemplate(text);
  const head = templatePattern(tpl.whole, { ascii });
  const least = Math.max(1, Math.min(10000, Math.round(Number.isFinite(minChars) ? minChars : MIN_AFTER_DEFAULT)));
  /* M581: with banned words, what follows the opening is the exact "never contains one" pattern (no minimum then — a
   * length cannot be laid over it in one pattern) */
  const pattern = tpl.mustEnd
    ? '^(?:' + head + ')\\s*$'
    : banned ? '^(?:' + head + ')(?:' + banned + ')$'
      : ascii ? '^(?:' + head + ')[\\s\\S]+$' : '^(?:' + head + ')[\\s\\S]{' + least + ',}$';
  return {
    type: 'object',
    properties: { response: { type: 'string', pattern } },
    required: ['response'],
    additionalProperties: false,
  };
}

/* the hidden part as an anchored matcher on the decoded words (built with the same slots) */
export function hiddenMatcher(text) {
  const tpl = readTemplate(text);
  if (!tpl.hidden) return null;
  try { return new RegExp('^(?:' + templatePattern(tpl.hidden) + ')'); } catch (err) { return null; }
}

/* STREAMING: the answer arrives as JSON ({"response":"…"}); feed() takes each raw piece and returns the words decoded so
 * far that may be shown. An answer that does not open with "{" is passed through as it is (the house ignored the
 * format — its words are still the page). The hidden part is held back until it has been written whole, then dropped. */
export function makeStructuredDecoder({ hidden = null, holdMax = 6000 } = {}) {
  let mode = 'start'; /* start → seek → string → done | plain */
  let seekBuf = '';
  let esc = '';   /* an escape split across pieces */
  let words = ''; /* every decoded word of the answer */
  let shownUpTo = 0;
  let hiddenDone = !hidden;
  let hiddenCut = 0;
  const release = (final = false) => {
    if (!hiddenDone) {
      const m = hidden.exec(words);
      if (m && (m[0].length < words.length || final)) { hiddenDone = true; hiddenCut = m[0].length; shownUpTo = hiddenCut; }
      else if (words.length > holdMax || final) { hiddenDone = true; hiddenCut = 0; shownUpTo = 0; } /* it never wrote the hidden part whole — shown as it came */
      else return '';
    }
    const out = words.slice(shownUpTo);
    shownUpTo = words.length;
    return out;
  };
  const decodeString = (s) => {
    let i = 0;
    while (i < s.length && mode === 'string') {
      if (esc) {
        esc += s[i]; i += 1;
        if (esc.length === 2 && esc[1] !== 'u') {
          const map = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
          words += map[esc[1]] !== undefined ? map[esc[1]] : esc[1];
          esc = '';
        } else if (esc.length === 6) {
          const code = parseInt(esc.slice(2), 16);
          words += Number.isFinite(code) ? String.fromCharCode(code) : '';
          esc = '';
        }
        continue;
      }
      const ch = s[i];
      if (ch === '\\') { esc = '\\'; i += 1; continue; }
      if (ch === '"') { mode = 'done'; i += 1; break; }
      words += ch; i += 1;
    }
  };
  return {
    feed(piece) {
      let s = String(piece == null ? '' : piece);
      if (!s) return '';
      if (mode === 'plain') { words += s; return release(); }
      if (mode === 'done') return '';
      if (mode === 'start') {
        const lead = s.replace(/^\s+/, '');
        if (!lead) return '';
        if (lead[0] !== '{') { mode = 'plain'; words += lead; return release(); }
        mode = 'seek'; s = lead;
      }
      if (mode === 'seek') {
        seekBuf += s;
        const m = seekBuf.match(/"(?:response|value|content|text)"\s*:\s*"/);
        if (!m) { if (seekBuf.length > 400) { mode = 'plain'; words += seekBuf; seekBuf = ''; return release(); } return ''; }
        mode = 'string';
        s = seekBuf.slice(m.index + m[0].length);
        seekBuf = '';
      }
      if (mode === 'string') decodeString(s);
      return release();
    },
    end() { return release(true); },
    words() { return words.slice(hiddenDone ? hiddenCut : 0); },
    wasJson() { return mode === 'string' || mode === 'done'; },
  };
}

/* a whole answer at once (a house that did not stream, or a final check): the words of {"response":"…"}, else the text */
export function unwrapStructured(text, { hidden = null } = {}) {
  const d = makeStructuredDecoder({ hidden });
  d.feed(String(text == null ? '' : text));
  d.end();
  return d.words();
}

/* the refusal of a house that takes no such answer, in its own words */
export const STRUCTURED_REFUSAL = /response_format|json_schema|structured[ _-]?output|\bschema\b|pattern|require_parameters|no endpoints found|not support(?:ed)? .*(?:json|format)/i;

/* ---------- banned words (M581): the continuation can never contain one ----------
 * The extension bakes its list into the pattern with a trie of "safe steps" — and that construction lets words through:
 * a step that diverges from a banned word's start swallows the next character as safe, so "oozone" carries "ozone",
 * and "otapestry" carries "tapestry" (checked against its own regex). Written here exactly instead: the automaton that
 * reads text and falls into a dead state on any banned word (Aho–Corasick: every state the longest suffix that is still
 * a word's beginning), turned into ONE pattern for "everything the automaton accepts" by eliminating its states. Letters
 * fold case ("ozone" bars "OZONE" too). A list whose pattern would grow past what a provider takes is refused whole,
 * never cut. */
export const BANNED_PATTERN_MAX = 60000;
const charClassOf = (ch) => {
  const lo = ch.toLowerCase(); const up = ch.toUpperCase();
  const esc = (c) => (/[\\\]^-]/.test(c) ? '\\' + c : c);
  if (lo !== up) return '[' + esc(lo) + esc(up) + ']';
  return /[\\^$.*+?()[\]{}|/]/.test(ch) ? '\\' + ch : ch;
};
export function bannedPattern(words) {
  const list = [...new Set((Array.isArray(words) ? words : String(words || '').split('\n')).map((w) => String(w || '').trim().toLowerCase()).filter(Boolean))];
  if (!list.length) return { pattern: '', words: [] };
  /* the trie */
  const nodes = [{ next: new Map(), fail: 0, dead: false, depth: 0 }];
  for (const w of list) {
    let s = 0;
    for (const ch of w) {
      if (!nodes[s].next.has(ch)) { nodes.push({ next: new Map(), fail: 0, dead: false, depth: nodes[s].depth + 1 }); nodes[s].next.set(ch, nodes.length - 1); }
      s = nodes[s].next.get(ch);
    }
    nodes[s].dead = true;
  }
  const alphabet = [...new Set(list.join(''))];
  /* failure links, breadth first; a state whose suffix is a word is dead too */
  const order = [];
  const queue = [];
  for (const [, t] of nodes[0].next) { nodes[t].fail = 0; queue.push(t); }
  while (queue.length) {
    const s = queue.shift(); order.push(s);
    if (nodes[nodes[s].fail].dead) nodes[s].dead = true;
    for (const [ch, t] of nodes[s].next) {
      let f = nodes[s].fail;
      while (f && !nodes[f].next.has(ch)) f = nodes[f].fail;
      nodes[t].fail = nodes[f].next.has(ch) && nodes[f].next.get(ch) !== t ? nodes[f].next.get(ch) : 0;
      queue.push(t);
    }
  }
  const delta = (s, ch) => { let x = s; while (x && !nodes[x].next.has(ch)) x = nodes[x].fail; return nodes[x].next.has(ch) ? nodes[x].next.get(ch) : 0; };
  const live = nodes.map((n, i) => i).filter((i) => !nodes[i].dead);
  /* the edges between live states, as patterns; "any other character" goes home to the root */
  const other = '[^' + alphabet.map((c) => { const lo = c.toLowerCase(); const up = c.toUpperCase(); const e = (x) => (/[\\\]^-]/.test(x) ? '\\' + x : x); return lo !== up ? e(lo) + e(up) : e(c); }).join('') + ']';
  const S = -1; const F = -2;
  const edges = new Map(); /* key "p>q" → array of alternative patterns */
  const add = (p, q, re) => { const k = p + '>' + q; if (!edges.has(k)) edges.set(k, []); edges.get(k).push(re); };
  add(S, 0, '');
  for (const s of live) {
    add(s, F, '');
    add(s, 0, other);
    for (const ch of alphabet) { const t = delta(s, ch); if (!nodes[t].dead) add(s, t, charClassOf(ch)); }
  }
  const alt = (arr) => { const u = [...new Set(arr)]; if (u.length === 1) return u[0]; const empty = u.includes(''); const rest = u.filter((x) => x !== ''); const body = rest.length === 1 ? rest[0] : '(?:' + rest.join('|') + ')'; return empty ? (rest.length === 1 && /^(?:\[[^\]]*\]|\\?.)$/.test(rest[0]) ? rest[0] + '?' : '(?:' + rest.join('|') + ')?') : body; };
  const label = (p, q) => (edges.has(p + '>' + q) ? alt(edges.get(p + '>' + q)) : null);
  const star = (re) => (!re ? '' : /^(?:\[[^\]]*\]|\\?.)$/.test(re) ? re + '*' : '(?:' + re + ')*');
  const group = (re) => (!re || /^(?:\[[^\]]*\]|\\?.|\(\?:.*\)[*?]?)$/.test(re) && !/\|/.test(re.replace(/\((?:\?:)?[^()]*\)/g, '')) ? re : '(?:' + re + ')');
  /* eliminate the deepest states first, the root last */
  const elim = live.slice().sort((a, b) => nodes[b].depth - nodes[a].depth);
  for (const q of elim) {
    const loop = label(q, q);
    const ins = []; const outs = [];
    for (const k of edges.keys()) { const [a, b] = k.split('>').map(Number); if (b === q && a !== q) ins.push(a); if (a === q && b !== q) outs.push(b); }
    for (const p of ins) for (const r of outs) {
      const re = group(label(p, q)) + star(loop) + group(label(q, r));
      add(p, r, re);
      if (re.length > BANNED_PATTERN_MAX) return { pattern: '', words: list, tooBig: true };
    }
    for (const k of [...edges.keys()]) { const [a, b] = k.split('>').map(Number); if (a === q || b === q) edges.delete(k); }
  }
  const pattern = label(S, F) || '';
  if (pattern.length > BANNED_PATTERN_MAX) return { pattern: '', words: list, tooBig: true };
  try { new RegExp('^(?:' + pattern + ')$'); } catch (err) { return { pattern: '', words: list, tooBig: true }; }
  return { pattern, words: list };
}

/* ---------- ready-made templates (M583) ----------
 * His word: "create basically a preset — template 1 guide, template 2 guide, template 3 guide — I just put my words in …
 * my subscription ends, I can't keep asking you how to put my words." Each template is filled from his own words (when it
 * takes any) and written into the prefill box for him; the guide says what it does and shows what a page looks like. */
export const STRUCTURED_PRESETS = Object.freeze([
  {
    id: 'line',
    name: '1 — Your words open every page, right after the scene header',
    needsWords: true,
    guide: 'Every page: the storyteller writes its scene header line first, then your words exactly as you typed them, then carries on with the scene from there.',
    build: (w) => '[[line]]\n\n' + w,
    example: (w) => '[The training yard — Monday | 09:00]\n\n' + (w || 'Your words') + ' — and the scene carries on from here…',
  },
  {
    id: 'plan',
    name: '2 — It plans first (you never see the plan), then writes the page',
    needsWords: false,
    guide: 'Before every page the storyteller writes itself a short plan — how the last page ended and what this page will do — which you never see; then it writes the page. Helps it stay on track. Your words are optional: if you give some, they open the page right after the header.',
    build: (w) => '<plan>The last page ended with: [[w:4-30]]. This page will: [[w:6-40]]</plan>\n[[keep]]' + (w ? '[[line]]\n\n' + w : ''),
    example: (w) => '[The training yard — Monday | 09:00]\n\n' + (w ? w + ' — ' : '') + 'the page itself; the plan before it is never shown…',
  },
  {
    id: 'opener',
    name: '3 — Another model starts every page (the opener)',
    needsWords: false,
    guide: 'Another model — the one you pick in Settings → The workers → The opener (an uncensored model is the usual choice) — writes the first ten to fifteen words of every page; your storyteller must start with exactly those words and carry on. For a storyteller that refuses or waters scenes down. No words of yours are needed.',
    build: () => '[[pg]]',
    example: () => '[The gate — Monday | 09:00] Kaelen drew his blade before anyone spoke — and the storyteller carries on from the opener’s words…',
  },
]);
/* his words, safe inside a template: no marker can be made of them (a "[[" or "]]" he typed is not a slot) */
export function presetWords(words) {
  return String(words == null ? '' : words).replace(/\[\[|\]\]/g, '').replace(/\s+$/g, '').replace(/^\s+/, '');
}
export function fillPreset(id, words) {
  const p = STRUCTURED_PRESETS.find((x) => x.id === id);
  if (!p) return { error: 'no such template' };
  const w = presetWords(words);
  if (p.needsWords && !w) return { error: 'This template needs your words — type them first.' };
  return { prefill: p.build(w), example: p.example(w), guide: p.guide };
}
