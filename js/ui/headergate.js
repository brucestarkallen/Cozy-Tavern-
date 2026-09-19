/* M322: EVERYTHING BEFORE THE HEADER IS THINKING, NOT PAGE.
 *
 * The writer: with thinking switched OFF (he will not wait for a frontier model's long weighing) the model
 * still thinks — his craft's own Pass tells it to — and the thinking LEAKS into the reply: a paragraph of
 * planning, then the header, then the page. That leak was saved as part of the page, sent back as
 * context on every later turn, and it pushed the header off the first line — the one place the house
 * reads the ground and the hour from (state.js headerMutations), so the ledger lost both.
 *
 * Whatever a reply holds BEFORE its page is the model talking to itself: it is moved to the page's
 * thinking (folded above the page, shown or hidden by the tick the writer already has, never part of the
 * page, never sent back). Nothing is ever thrown away: a reply in which no page can be told from a plan
 * is left exactly as it came, and an out-of-character answer is not gated at all.
 *
 * M324: WHERE THE PAGE BEGINS — TWO SIGNS, NOT ONE. M322 knew one: a bracketed line holding a "|" AND a
 * clock time. The writer's screen showed the whole plan as the page all the same ("Planning: … Beat: …"),
 * the house's own masthead above it — which the house only draws when a page does NOT open with a header:
 * in that reply the gate had found none. A header is recognised more widely now (a line that is one
 * bracket pair, with a "|" OR a clock time — dressed in **, >, # or backticks or not). And when there is
 * no header at all, a plan that NAMES itself still gives the page away: paragraphs that open with a
 * planning label ("Planning:", "Beat:", "Last look:", the Pass's own letters "B:" "L:"…) are the plan, and
 * the page begins at the first paragraph that does not. A reply that is ALL plan has no page (planOnly) —
 * the caller asks for the page once, the plan handed back.
 *
 * M326: A MODEL WITH NO THINKING CHANNEL DRAFTS ON THE PAGE. The writer's five screenshots of ONE reply: a plan; the
 * header and a first draft; "That's solid. Let me check: …"; "---", the SAME header and a second draft;
 * "Good — … Let me reconstruct final:"; the SAME header and the final draft; then "Thought tag: one. ✓ …
 * Post-send checks: … ✓ … Ship it." — and the reply ends. M322–M325 cut at the FIRST header, so the page
 * he was given was all three drafts with the critiques between them and the checklist after: "it makes
 * thinking and planning but never gives the real output". The real output is in there — it is the LAST
 * draft. So: when a reply repeats its own header (same place, date and hour — a "window beyond the page"
 * is a different place and is left alone), the page begins at the LAST of them; and the page ENDS where
 * the model starts checking its own work (a paragraph that opens with a checking label or phrase, or
 * carries a tick mark). Everything else — plan, earlier drafts, critiques, checklist — is the thinking.
 */

const DRESS = '[ \\t>*_#`]*';
const HEADER_LINE = new RegExp('^' + DRESS + '\\[[^\\[\\]\\n]{6,400}\\]' + '[ \\t*_`]*$');
const HAS_TIME = /\b\d{1,2}[:.]\d{2}\b/;
const LABEL = new RegExp('^' + DRESS + '(?:planning|plan|beat|last look|the pass|pass|thinking|thoughts|reasoning|analysis|approach|outline|notes?|check|[blscw])' + '[ \\t*_`]*(?::|\\s[—–-]\\s)', 'i');

/* M340: A HEADER THAT LOST ITS BRACKETS IS STILL THE HEADER. A model that does not think wrote, on a tale's first page,
 * "Saturday, June 14, 2025 | 08:12 | ☀️ sun through the glass doors… | joggers, t-shirt | leaning at the counter" — no
 * brackets, no place. This gate knew a header only by its brackets, so that page had "no header": before M339 the
 * house drew its own masthead over it; after M339 it would have been taken for the teller THINKING and asked for
 * again. One line of at least three "|" that carries a clock time is a header, dressed in brackets or not (ui/
 * pageshape.js puts the brackets back before the page is kept). */
const BARE_HEADER = new RegExp('^' + DRESS + '[^\\[\\]\\n]{6,400}' + '[ \\t*_`]*$');
export function isHeaderLine(line) {
  const s = String(line || '');
  if (!s.trim()) return false;
  if (HEADER_LINE.test(s)) return s.includes('|') || HAS_TIME.test(s);
  return BARE_HEADER.test(s) && (s.match(/\|/g) || []).length >= 3 && HAS_TIME.test(s) && !LABEL.test(s);
}
export function isPlanLabel(line) { return LABEL.test(String(line || '')); }

/* M326: where a model starts talking to itself about the page it has just written */
const CHECK = new RegExp('^' + DRESS + '(?:' + [
  '(?:thought tags?|dialogue ratio|post-?send checks?|pre-?send checks?|final checks?|self-?checks?|checks?|checklist|word count|length check|banned words?|pov check|continuity check|header check|last look|verdict|revision|revised|draft(?: \\d+)?|final(?: draft| version)?|critique|review|audit)[ \\t*_`]*(?::|\\s[—–-]\\s)',
  'that[\'’]?s (?:solid|good|fine|better|clean)\\b',
  'let me (?:check|reconstruct|revise|rewrite|re-?write|adjust|fix|tighten|re-?read|re-?do|verify|audit|trim)\\b',
  'good\\s[—–-]\\s', 'ok(?:ay)?\\s[—–-]\\s',
  'now (?:let me|the final|for the final)\\b',
  'ship it\\b', 'shipping\\b', 'done\\.?$',
].join('|') + ')', 'i');
const TICK = /[✓✔☑✅]/;
export function isCheckStart(paragraph) {
  const text = String(paragraph || '');
  const first = text.split('\n')[0];
  return CHECK.test(first) || isPlanLabel(first) || TICK.test(text);
}

/* what makes two header lines the SAME header: the place-and-date part (before the first "|") and the hour */
export function headerKey(line) {
  const inner = String(line || '').replace(/^[ \t>*_#`]*\[/, '').replace(/\][ \t*_`]*$/, '');
  const head = inner.split('|')[0].toLowerCase().replace(/\s+/g, ' ').trim();
  const time = (inner.match(HAS_TIME) || [''])[0].replace('.', ':');
  return head.replace(HAS_TIME, '').replace(/[\s—–-]+$/, '').trim() + '@' + time;
}
/* every header line in the text: [{ at, key }] */
export function headersIn(text) {
  const s = String(text || '');
  const out = [];
  let at = 0;
  while (at <= s.length) {
    const end = s.indexOf('\n', at);
    const line = end === -1 ? s.slice(at) : s.slice(at, end);
    if (isHeaderLine(line)) out.push({ at, key: headerKey(line) });
    if (end === -1) break;
    at = end + 1;
  }
  return out;
}
/* where the page begins when there are headers: the LAST line that repeats the first header (drafts), else the first */
function pageStart(s) {
  const hs = headersIn(s);
  if (!hs.length) return -1;
  let at = hs[0].at;
  for (const h of hs) if (h.key === hs[0].key) at = h.at;
  return at;
}
/* where the page ends: the first paragraph after its header paragraph that starts a check; -1 = it runs to the end */
function checkStart(s, from) {
  const ps = paragraphs(s.slice(from)).map((p) => ({ at: p.at + from, text: p.text }));
  for (let i = 0; i < ps.length; i += 1) {
    if (i === 0 && isHeaderLine(ps[0].text.split('\n')[0])) {
      /* the header's own paragraph may run straight into prose; only its later lines are judged */
      const rest = ps[0].text.split('\n').slice(1).join('\n');
      if (rest.trim() && isCheckStart(rest)) return ps[0].at + ps[0].text.indexOf('\n') + 1;
      continue;
    }
    /* a rule line ("---") between the page and the checks belongs to the checks */
    if (/^[ \t]*[-*_]{3,}[ \t]*$/.test(ps[i].text) && ps[i + 1] && isCheckStart(ps[i + 1].text)) return ps[i].at;
    if (isCheckStart(ps[i].text)) return ps[i].at;
  }
  return -1;
}

/* the index at which the first header line begins, or -1 */
export function headerIndex(text) {
  const s = String(text || '');
  let at = 0;
  while (at <= s.length) {
    const end = s.indexOf('\n', at);
    const line = end === -1 ? s.slice(at) : s.slice(at, end);
    if (isHeaderLine(line)) return at;
    if (end === -1) break;
    at = end + 1;
  }
  return -1;
}

/* paragraphs with their offsets: [{ at, text }] (a paragraph is a run of non-blank lines) */
function paragraphs(s) {
  const out = [];
  const re = /[^\n]+(?:\n(?![ \t]*\n)[^\n]*)*/g;
  let m;
  while ((m = re.exec(s))) { if (m[0].trim()) out.push({ at: m.index, text: m[0] }); }
  return out;
}
/* with no header: where a self-labelled plan ends. -1 = the reply does not open with a labelled plan;
 * s.length = it is ALL plan. */
function planEnd(s) {
  const ps = paragraphs(s);
  if (!ps.length || !isPlanLabel(ps[0].text.split('\n')[0])) return -1;
  for (let i = 1; i < ps.length; i += 1) if (!isPlanLabel(ps[i].text.split('\n')[0])) return ps[i].at;
  return s.length;
}

/* the finished text, in three: what came before the page, the page, and what the model said to itself after it */
export function splitReply(text) {
  const s = String(text || '');
  let at = pageStart(s);
  const headed = at !== -1;
  if (!headed) { const p = planEnd(s); at = p > 0 && p < s.length ? p : -1; }
  if (at < 0) return { lead: '', page: s, tail: '' };
  const lead = s.slice(0, at).trim() ? s.slice(0, at).replace(/\s+$/, '') : '';
  let page = s.slice(at);
  let tail = '';
  if (headed) {
    const c = checkStart(s, at);
    if (c > at) {
      const kept = s.slice(at, c).replace(/(?:\n[ \t]*[-*_]{3,}[ \t]*)?\s+$/, '');
      /* never cut a page down to its header alone: a header with nothing under it is not a page worth the cut */
      if (kept.split('\n').slice(1).join('\n').trim()) { page = kept; tail = s.slice(c).trim(); }
    }
  }
  return { lead, page, tail };
}
/* { lead, page } — the lead being ALL the thinking the reply held, before the page and after it */
export function splitAtHeader(text) {
  const cut = splitReply(text);
  return { lead: [cut.lead, cut.tail].filter(Boolean).join('\n\n'), page: cut.page };
}
/* only the page — what a LATER turn is sent of a page that was saved before any of this existed.
 * It runs over EVERY earlier page on every send, so a clean page must cost next to nothing: measured in a real
 * browser on a long tale, splitting every page added 67 ms to the worst frame (100 → 167). A page that opens
 * with its header and holds no second header line, no tick and no checking or planning phrase at the head of a
 * line IS its own page part; and an answer once worked out is remembered. */
const MAYBE_DIRTY = /[✓✔☑✅]|^[ \t>*_#`]*(?:planning|plan|beat|last look|thinking|thoughts|reasoning|analysis|approach|outline|notes?|checks?|checklist|thought tags?|dialogue ratio|post-?send|pre-?send|final|self-?check|word count|banned words?|verdict|revis|draft|critique|review|audit|that[\'’]?s |let me |good\s[—–-]|ok(?:ay)?\s[—–-]|now |ship|done|[blscw][ \t]*:)/im;
const pageOnlyMemo = new Map();
export function pageOnly(text) {
  const s = String(text || '');
  if (!s) return s;
  const known = pageOnlyMemo.get(s);
  if (known !== undefined) return known;
  let out = s;
  const firstLine = s.slice(0, s.indexOf('\n') === -1 ? s.length : s.indexOf('\n'));
  const headerFirst = isHeaderLine(firstLine) || isHeaderLine(s.trimStart().split('\n')[0]);
  const moreHeaders = headerFirst && (s.match(/^[ \t>*_#`]*\[[^\[\]\n]*\|[^\[\]\n]*\]/gm) || []).length > 1;
  if (!headerFirst || moreHeaders || MAYBE_DIRTY.test(s)) out = splitReply(s).page;
  if (pageOnlyMemo.size > 800) pageOnlyMemo.clear();
  pageOnlyMemo.set(s, out);
  return out;
}
/* M325: the reply OPENS with a plan that names itself (whatever follows) */
export function opensWithPlan(text) {
  const ps = paragraphs(String(text || ''));
  return Boolean(ps.length) && isPlanLabel(ps[0].text.split('\n')[0]);
}
/* a reply that is nothing but a self-labelled plan: no header, no page */
export function planOnly(text) {
  const s = String(text || '');
  return Boolean(s.trim()) && headerIndex(s) === -1 && planEnd(s) === s.length;
}

/* the same, as the words arrive. onThinking(text) and onProse(text) are called in order; onGiveBack(text) hands
 * back words that were shown as thinking when the reply turns out to hold no page that can be told apart. */
export function makeHeaderGate({ onThinking, onProse, onGiveBack, onRestart, giveUpAt = 12000 } = {}) {
  let open = false;
  let buf = '';
  let shown = 0; /* how much of buf has been handed over as thinking */
  /* M326, once the page is open: its header's key, whether the model has begun checking its work, and the line in hand */
  let openKey = '';
  let checking = false;
  let line = '';
  let lineOut = 0;      /* how much of `line` has already been handed on */
  let pageHasProse = false;
  let paraStart = true; /* the line in hand begins a paragraph */
  const HOLD = 56;      /* a line is held this long (or to its end, if it opens a bracket) before it is judged */
  const hand = (t) => { if (!t) return; if (checking) onThinking(t); else { onProse(t); } };
  const judge = (whole) => {
    /* called once per line, when enough of it is known (whole = the line is complete) */
    const text = line.replace(/\n$/, ''); /* the line in hand, without the break that ended it */
    if (whole && isHeaderLine(text) && headerKey(text) === openKey && (pageHasProse || checking)) {
      /* the model is writing the page AGAIN: what stood as the page is a draft — the caller takes it to the thinking */
      if (onRestart) onRestart();
      checking = false; pageHasProse = false;
      return;
    }
    if (!checking && paraStart && pageHasProse && (CHECK.test(text) || isPlanLabel(text))) checking = true;
  };
  /* handed on in runs, never a character at a time: once a line has been judged, the rest of it (to its line break)
   * goes on in one piece — the first version called the painter for every character (worst frame 50 → 150 ms) */
  const feedOpen = (t) => {
    let i = 0;
    while (i < t.length) {
      const nl = t.indexOf('\n', i);
      if (lineOut > 0) {
        /* already judged: pass the run through */
        const upTo = nl === -1 ? t.length : nl;
        if (upTo > i) { const run = t.slice(i, upTo); line += run; hand(run); lineOut = line.length; i = upTo; }
        if (nl === -1) break;
      } else {
        /* not judged yet: take what is needed to judge it — to the line break, or to HOLD characters */
        const bracket = /^[ \t>*_#`]*\[/.test(line + t.slice(i, i + 8));
        const room = bracket ? Infinity : Math.max(0, HOLD - line.length);
        const upTo = Math.min(nl === -1 ? t.length : nl, i + room);
        line += t.slice(i, upTo); i = upTo;
        if (i < t.length && t[i] !== '\n') { judge(false); hand(line); lineOut = line.length; continue; }
        if (i >= t.length) { if (!bracket && line.length >= HOLD) { judge(false); hand(line); lineOut = line.length; } break; }
      }
      /* t[i] is the line break */
      line += '\n'; i += 1;
      if (lineOut === 0) judge(true);
      hand(line.slice(lineOut));
      if (!checking && line.trim() && !isHeaderLine(line.replace(/\n$/, ''))) pageHasProse = true;
      paraStart = !line.trim();
      line = ''; lineOut = 0;
    }
  };
  const flushLead = (upTo) => {
    if (upTo > shown) { const piece = buf.slice(shown, upTo); shown = upTo; if (piece) onThinking(piece); }
  };
  const openAt = (at) => {
    if (buf.slice(0, at).trim()) flushLead(at); /* leading blank lines are nobody's thinking */
    const page = buf.slice(at);
    open = true; buf = ''; shown = 0;
    const first = page.split('\n')[0];
    openKey = isHeaderLine(first) ? headerKey(first) : '';
    if (page) feedOpen(page);
  };
  const giveBack = () => {
    const held = buf; const was = buf.slice(0, shown);
    open = true; buf = ''; shown = 0;
    if (was && onGiveBack) onGiveBack(was);
    if (held) onProse(held);
  };
  return {
    feed(text) {
      const t = String(text || '');
      if (!t) return;
      if (open) { feedOpen(t); return; }
      buf += t;
      /* only WHOLE lines are judged: the last, unfinished line may yet turn out to be the header */
      const lastBreak = buf.lastIndexOf('\n');
      const whole = lastBreak === -1 ? '' : buf.slice(0, lastBreak + 1);
      const at = headerIndex(whole.replace(/\n$/, ''));
      if (at !== -1) { openAt(at); return; }
      /* a plan that names itself, and then a paragraph that does not: the page has begun (its first line must be whole,
       * and must not be opening a bracket — that may be the header, which the rule above will see) */
      const p = planEnd(whole);
      if (p > 0 && p < whole.length && !/^[ \t>*_#`]*\[/.test(whole.slice(p))) { openAt(p); return; }
      if (buf.length > giveUpAt) { giveBack(); return; }
      if (whole.trim()) flushLead(whole.length);
    },
    /* the stream is over: the finished text decides */
    end() {
      if (open) { if (line.slice(lineOut)) { if (lineOut === 0) judge(true); hand(line.slice(lineOut)); line = ''; lineOut = 0; } return; }
      const cut = splitAtHeader(buf);
      if (cut.lead) { openAt(buf.length - cut.page.length); return; }
      giveBack();
    },
    get waiting() { return !open; },
  };
}
