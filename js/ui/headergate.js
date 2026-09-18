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
 */

const DRESS = '[ \\t>*_#`]*';
const HEADER_LINE = new RegExp('^' + DRESS + '\\[[^\\[\\]\\n]{6,400}\\]' + '[ \\t*_`]*$');
const HAS_TIME = /\b\d{1,2}[:.]\d{2}\b/;
const LABEL = new RegExp('^' + DRESS + '(?:planning|plan|beat|last look|the pass|pass|thinking|thoughts|reasoning|analysis|approach|outline|notes?|check|[blscw])' + '[ \\t*_`]*(?::|\\s[—–-]\\s)', 'i');

export function isHeaderLine(line) {
  const s = String(line || '');
  if (!HEADER_LINE.test(s.trim() ? s : '')) return false;
  return s.includes('|') || HAS_TIME.test(s);
}
export function isPlanLabel(line) { return LABEL.test(String(line || '')); }

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

/* the finished text, split: { lead, page }. Nothing to tell apart → lead '' and page the whole text. */
export function splitAtHeader(text) {
  const s = String(text || '');
  let at = headerIndex(s);
  if (at === -1) { const p = planEnd(s); at = p > 0 && p < s.length ? p : -1; }
  if (at <= 0) return { lead: '', page: s };
  const lead = s.slice(0, at);
  if (!lead.trim()) return { lead: '', page: s.slice(at) };
  return { lead: lead.replace(/\s+$/, ''), page: s.slice(at) };
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
export function makeHeaderGate({ onThinking, onProse, onGiveBack, giveUpAt = 12000 } = {}) {
  let open = false;
  let buf = '';
  let shown = 0; /* how much of buf has been handed over as thinking */
  const flushLead = (upTo) => {
    if (upTo > shown) { const piece = buf.slice(shown, upTo); shown = upTo; if (piece) onThinking(piece); }
  };
  const openAt = (at) => {
    if (buf.slice(0, at).trim()) flushLead(at); /* leading blank lines are nobody's thinking */
    const page = buf.slice(at);
    open = true; buf = ''; shown = 0;
    if (page) onProse(page);
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
      if (open) { onProse(t); return; }
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
      if (open) return;
      const cut = splitAtHeader(buf);
      if (cut.lead) { openAt(buf.length - cut.page.length); return; }
      giveBack();
    },
    get waiting() { return !open; },
  };
}
