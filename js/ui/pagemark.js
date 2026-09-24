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
 * those offsets. Nothing here writes to the thread. */

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
  wrap.appendChild(mark);

  /* the pages' offsets, read once per layout change */
  let tops = [];
  let numbers = [];
  let seenHeight = -1;
  let seenCount = -1;
  function measure() {
    const nodes = thread.querySelectorAll('.msg[data-page]');
    if (thread.scrollHeight === seenHeight && nodes.length === seenCount) return;
    seenHeight = thread.scrollHeight;
    seenCount = nodes.length;
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
  function paint() {
    raf = 0;
    const total = Number(thread.dataset.pages) || 0;
    if (!total) { mark.hidden = true; return; }
    const page = pageUnderEye();
    if (!page) { mark.hidden = true; return; }
    const words = 'page ' + page + ' of ' + total;
    if (mark.textContent !== words) mark.textContent = words;
    mark.setAttribute('aria-valuemax', String(total));
    mark.setAttribute('aria-valuenow', String(page));
    /* the thumb travels the thread's own height, like a scrollbar's */
    const room = Math.max(0, thread.scrollHeight - thread.clientHeight);
    const ratio = room ? Math.min(1, Math.max(0, thread.scrollTop / room)) : 1;
    const travel = Math.max(0, thread.clientHeight - mark.offsetHeight - 16);
    mark.style.top = Math.round(thread.offsetTop + 8 + ratio * travel) + 'px';
    mark.hidden = false;
    mark.classList.add('show');
    clearTimeout(hideTimer);
    if (!dragging) hideTimer = setTimeout(() => { mark.classList.remove('show'); }, 1200);
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(paint); };
  thread.addEventListener('scroll', schedule, { passive: true });

  /* dragged: the thumb's place along the thread becomes the thread's scroll */
  const scrollTo = (clientY) => {
    const box = thread.getBoundingClientRect();
    const travel = Math.max(1, box.height - mark.offsetHeight - 16);
    const ratio = Math.min(1, Math.max(0, (clientY - box.top - 8 - mark.offsetHeight / 2) / travel));
    thread.scrollTop = ratio * Math.max(0, thread.scrollHeight - thread.clientHeight);
    schedule();
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

  const api = { refresh: schedule, pageUnderEye };
  if (ctx) ctx.pageMark = api;
  return api;
}
