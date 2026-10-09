/* Cozy Tavern — the page mark (M466).
 *
 * The writer: "add the scroll button on the right to display which number of
 * page it's currently scrolled". A small thumb rides the thread's right edge,
 * exactly where a scrollbar's thumb would be: while the story scrolls it says
 * "page 37 of 114" — the storyteller page under the eye, numbered over the
 * WHOLE tale (chat.js stamps every page with data-page at render) — and it can
 * be dragged, like a scrollbar, to any page. It fades a second after the last
 * scroll or drag and costs nothing while it rests.
 *
 * COST: the scroll listener is passive and coalesced to one frame; the pages'
 * offsets are read once per layout change (the thread's scrollHeight or its
 * page count moved), not per frame; the current page is a binary search over
 * those offsets. Nothing here writes to the thread.
 *
 * M675 — HIS: "problem solve the page number on scroll, it's making my eyes hurt when reading because it's hidden some
 * words on it." The thumb WAS the number: a pill 116 px wide that rode down the right edge over the prose. Measured on a
 * phone (390 × 844, a real Chromium, forty scroll positions down a tale): it painted over words at 40 of the 40 — three
 * words of whatever line it stood on, every time he scrolled, which while reading is all the time. Now nothing of it is
 * ever painted on a word:
 *   - THE THUMB is a slim bar that stands wholly inside the thread's own right gutter (16 px; the bar is 5 px, 3 px in
 *     from the edge). It still shows while the story scrolls, still fades a second after, still drags to any page —
 *     the finger's target is wider than the bar, and unpainted.
 *   - THE NUMBER ("page 37 of 114") stands in the line under the composer (#meta-page), where no word of the story is:
 *     always there, never flashing. Only WHILE HE DRAGS the thumb does the number also show beside it — he is choosing
 *     a page then, not reading one.
 *   - with the top bar hidden, the thumb's track begins below the small button that brings the bar back (they share
 *     the gutter; the pill used to slide under it).
 * tests/pagemark.py holds it in a real browser: no word painted over at any of forty positions, bar shown and hidden. */

export function initPageMark(ctx) {
  const thread = document.getElementById('thread');
  const wrap = thread ? thread.parentElement : null;
  if (!thread || !wrap) return null;

  const mark = document.createElement('div');
  mark.id = 'page-mark';
  mark.className = 'page-mark';
  mark.setAttribute('role', 'slider');
  mark.setAttribute('aria-label', 'Which page is under your eye — drag to another');
  mark.setAttribute('aria-valuemin', '1');
  mark.hidden = true;
  /* M675: what is painted — the bar in the gutter, and the number beside it while it is dragged */
  const words = document.createElement('span');
  words.className = 'page-mark-words';
  const bar = document.createElement('span');
  bar.className = 'page-mark-bar';
  mark.append(words, bar);
  wrap.appendChild(mark);
  const label = document.getElementById('meta-page'); /* M675: the number, in the line under the composer */

  /* the pages' offsets, read once per layout change */
  let tops = [];
  let numbers = [];
  let seenHeight = -1;
  let seenCount = -1;
  let seenLast = '';
  function measure() {
    const nodes = thread.querySelectorAll('.msg[data-page]');
    const last = nodes.length ? nodes[nodes.length - 1].dataset.page + ':' + (thread.dataset.pages || '') : '';
    if (thread.scrollHeight === seenHeight && nodes.length === seenCount && last === seenLast) return;
    seenHeight = thread.scrollHeight;
    seenCount = nodes.length;
    seenLast = last; /* M483: a page replaced in place (a landed page, a re-ink) is measured again */
    tops = [];
    numbers = [];
    for (const n of nodes) { tops.push(n.offsetTop); numbers.push(Number(n.dataset.page) || 0); }
  }
  /* the page whose top is the last one above the reading line. M468-2: THE LINE SLIDES WITH THE SCROLL — at the
   * top of the tale it sits 45% down the screen (the page under the eye), and it moves to the screen's foot as the
   * scroll reaches the end, so the LAST page is the one named when the thread stands at its end. A fixed 45% line
   * named page 154 of 155 at the very bottom whenever the last page was shorter than half the screen. */
  function pageUnderEye() {
    measure();
    if (!tops.length) return 0;
    const room = Math.max(0, thread.scrollHeight - thread.clientHeight);
    const ratio = room ? Math.min(1, Math.max(0, thread.scrollTop / room)) : 1;
    const line = thread.scrollTop + thread.clientHeight * (0.45 + 0.55 * ratio) - (ratio >= 1 ? 1 : 0);
    let lo = 0; let hi = tops.length - 1; let at = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (tops[mid] <= line) { at = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return numbers[at];
  }

  let hideTimer = 0;
  let dragging = false;
  let raf = 0;
  let showOwed = false; /* M675: only a scroll or a drag shows the thumb; a redraw of the thread only sets the number right */
  /* where the thumb's track begins: under the small "show the top bar" button when the bar is hidden (M675) */
  const inset = () => (document.body.classList.contains('immersed') ? 44 : 8);
  function paint() {
    raf = 0;
    const show = showOwed; showOwed = false;
    const total = Number(thread.dataset.pages) || 0;
    const page = total ? pageUnderEye() : 0;
    if (!page) {
      mark.hidden = true;
      if (label) { label.textContent = ''; label.hidden = true; }
      return;
    }
    const text = 'page ' + page + ' of ' + total;
    if (words.textContent !== text) words.textContent = text;
    if (label) { if (label.textContent !== text) label.textContent = text; label.hidden = false; }
    mark.setAttribute('aria-valuemax', String(total));
    mark.setAttribute('aria-valuenow', String(page));
    mark.setAttribute('aria-valuetext', text);
    mark.hidden = false;
    /* the thumb travels the thread's own height, like a scrollbar's */
    const room = Math.max(0, thread.scrollHeight - thread.clientHeight);
    const ratio = room ? Math.min(1, Math.max(0, thread.scrollTop / room)) : 1;
    const top = inset();
    const travel = Math.max(0, thread.clientHeight - mark.offsetHeight - top - 8);
    mark.style.top = Math.round(thread.offsetTop + top + ratio * travel) + 'px';
    if (!show && !dragging) return;
    mark.classList.add('show');
    clearTimeout(hideTimer);
    if (!dragging) hideTimer = setTimeout(() => { mark.classList.remove('show'); }, 1200);
  }
  const schedule = (show = true) => { if (show) showOwed = true; if (!raf) raf = requestAnimationFrame(paint); };
  thread.addEventListener('scroll', () => schedule(true), { passive: true });
  /* M675: the number under the composer is always there, so it follows the thread itself — a page landed, a tale opened,
   * a page let go — not only the scroll (a tale too short to scroll never fires one). Coalesced to the same one frame. */
  {
    const Observer = typeof MutationObserver === 'function' ? MutationObserver : (document.defaultView && document.defaultView.MutationObserver);
    if (typeof Observer === 'function') new Observer(() => schedule(false)).observe(thread, { childList: true, attributes: true, attributeFilter: ['data-pages'] });
    schedule(false);
  }

  /* dragged: the thumb's place along the thread becomes the thread's scroll */
  const scrollTo = (clientY) => {
    const box = thread.getBoundingClientRect();
    const top = inset();
    const travel = Math.max(1, box.height - mark.offsetHeight - top - 8);
    const ratio = Math.min(1, Math.max(0, (clientY - box.top - top - mark.offsetHeight / 2) / travel));
    thread.scrollTop = ratio * Math.max(0, thread.scrollHeight - thread.clientHeight);
    schedule(true);
  };
  mark.addEventListener('pointerdown', (e) => {
    dragging = true;
    mark.classList.add('dragging');
    clearTimeout(hideTimer);
    try { if (typeof mark.setPointerCapture === 'function') mark.setPointerCapture(e.pointerId); } catch (err) { /* a browser without capture still drags while the pointer stays on the thumb */ }
    e.preventDefault();
  });
  mark.addEventListener('pointermove', (e) => { if (dragging) scrollTo(e.clientY); });
  const release = () => {
    if (!dragging) return;
    dragging = false;
    mark.classList.remove('dragging');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { mark.classList.remove('show'); }, 1200);
  };
  mark.addEventListener('pointerup', release);
  mark.addEventListener('pointercancel', release);
  mark.addEventListener('lostpointercapture', release);

  const api = { refresh: () => schedule(false), pageUnderEye };
  if (ctx) ctx.pageMark = api;
  return api;
}
