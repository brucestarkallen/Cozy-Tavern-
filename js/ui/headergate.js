/* M322: EVERYTHING BEFORE THE HEADER IS THINKING, NOT PAGE.
 *
 * The writer: with thinking switched OFF (he will not wait for a frontier model's long weighing) the model
 * still thinks — his craft's own Pass tells it to — and the thinking LEAKS into the reply: a paragraph of
 * planning, then the header, then the page. That leak was saved as part of the page, sent back as
 * context on every later turn, and it pushed the header off the first line — the one place the house
 * reads the ground and the hour from (state.js headerMutations), so the ledger lost both.
 *
 * Every story page opens with the header line ([place — date | HH:MM | …], the craft's Header Protocol).
 * So whatever a reply holds BEFORE that line is the model talking to itself: it is moved to the page's
 * thinking (folded above the page, shown or hidden by the tick the writer already has, never part of the
 * page, never sent back) and the page begins at its header. Which also gives him what he asked for
 * first: a model told not to think may think on the page for a few seconds instead, and he never sees it.
 *
 * Nothing is ever thrown away: a reply with NO header is left exactly as it came (the gate gives the held
 * words back as page), and so is an out-of-character answer (the caller does not gate those).
 */

/* a line that IS a header: brackets around at least one "|" and a clock time; models sometimes dress it in ** or > */
const BRACKET_LINE = /(^|\n)([ \t>*_#]*)(\[[^\]\n]*\|[^\]\n]*\])/g;
const HAS_TIME = /\b\d{1,2}:\d{2}\b/;

export function headerIndex(text) {
  const s = String(text || '');
  BRACKET_LINE.lastIndex = 0;
  let m;
  while ((m = BRACKET_LINE.exec(s))) {
    if (HAS_TIME.test(m[3])) return m.index + m[1].length;
  }
  return -1;
}

/* the finished text, split: { lead, page }. No header, or the header first → lead is '' and page is the text. */
export function splitAtHeader(text) {
  const s = String(text || '');
  const at = headerIndex(s);
  if (at <= 0) return { lead: '', page: s };
  const lead = s.slice(0, at);
  if (!lead.trim()) return { lead: '', page: s.slice(at) };
  return { lead: lead.replace(/\s+$/, ''), page: s.slice(at) };
}

/* the same, as the words arrive. onThinking(text) and onProse(text) are called in order; onGiveBack(text) hands
 * back words that were shown as thinking when the reply turns out to have no header at all. */
export function makeHeaderGate({ onThinking, onProse, onGiveBack, giveUpAt = 12000 } = {}) {
  let open = false;
  let buf = '';
  let shown = 0; /* how much of buf has been handed over as thinking */
  const flushLead = (upTo) => {
    if (upTo > shown) { const piece = buf.slice(shown, upTo); shown = upTo; if (piece) onThinking(piece); }
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
      const at = headerIndex(buf);
      if (at !== -1) {
        const lead = buf.slice(0, at);
        if (lead.trim()) flushLead(at); /* leading blank lines are nobody's thinking */
        const page = buf.slice(at);
        open = true; buf = ''; shown = 0;
        onProse(page);
        return;
      }
      if (buf.length > giveUpAt) { giveBack(); return; }
      /* hand over what can no longer become the header: whole lines, except a last line that has begun with a bracket */
      const lastBreak = buf.lastIndexOf('\n');
      if (lastBreak === -1) return;
      /* (the last, unfinished line is always held: it may yet turn out to be the header) */
      const safe = lastBreak + 1;
      if (buf.slice(0, safe).trim()) flushLead(safe);
    },
    /* the stream is over */
    end() { if (!open) giveBack(); },
    get waiting() { return !open; },
  };
}
