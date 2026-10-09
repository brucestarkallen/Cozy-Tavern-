/* Cozy Tavern — ui/workbanner.js
 *
 * M203: WHAT THE HOUSE IS DOING, WHILE IT DOES IT.
 *
 * Every manual action — audit the ledger, read the pages again, found the
 * world, rebuild the record, rebuild the people, put the old record back —
 * handed its work to the background chain and then said nothing, or one toast
 * that vanished. A two-hundred-page rebuild is minutes of silence, and the
 * writer was left scrolling to guess whether it had finished, stalled, or
 * died. Summaryception has shown the shape for years: a banner that stays put
 * and counts.
 *
 * It says three things and nothing more:
 *   what is running     "Rebuilding the record"
 *   how far it has got  "batch 7 of 24 · 29%"
 *   when it stumbles    "trying again in 4s (2 of 3)"
 *
 * It never asks the writer for anything. It clears itself when the work
 * lands, and it is the same banner for every action, so there is one place to
 * look.
 */

let el = null;
let whatEl = null;
let countEl = null;
let fillEl = null;
let stopEl = null;
let clearTimer = 0;
let token = 0;
let onStop = null;
let taleOfBanner = null; /* M510-42: the tale whose work the banner shows */
let knows = { openTale: () => null, titleOf: () => '' };
let lastPaint = null;

function parts() {
  if (el && el.isConnected) return true;
  el = document.getElementById('work-banner');
  whatEl = document.getElementById('work-banner-what');
  countEl = document.getElementById('work-banner-count');
  fillEl = document.getElementById('work-banner-fill');
  stopEl = document.getElementById('work-banner-stop');
  if (stopEl && !stopEl.dataset.wired) {
    stopEl.dataset.wired = '1';
    stopEl.addEventListener('click', () => {
      if (typeof onStop === 'function') { const f = onStop; onStop = null; f(taleOfBanner); } /* M510-42: its own tale */
    });
  }
  return Boolean(el && whatEl && countEl && fillEl);
}

/* M510-42: A BANNER BELONGS TO ITS TALE. His report: "I branch to the start of my message and a banner still says it is
 * reading the pages the ledger missed, 1 of 9 — while the tale is literally empty." One banner serves the whole house,
 * and the work goes on in its own tale after he opens another (the origin's readers, catching up) — so the empty branch
 * showed the origin's count, naming no tale, and its Stop stopped whatever tale was OPEN at the tap. Now each banner
 * knows its tale: on another tale it says whose work it is ("“Bleach” — Reading the pages the ledger missed"), it is
 * repainted the moment the open tale changes, and Stop stops its own tale's work. */
const ask = (fn, arg) => { try { return fn(arg); } catch (err) { return null; } };
export function bannerKnowsTales(k) { knows = { ...knows, ...(k || {}) }; }
function whatShown(what) {
  const open = ask(knows.openTale);
  if (!what || !taleOfBanner || !open || taleOfBanner === open) return what || '';
  const title = String(ask(knows.titleOf, taleOfBanner) || '').trim();
  return (title ? '“' + title + '”' : 'Another tale') + ' — ' + what;
}
/* the open tale changed: the banner on show says again whose work it is */
export function repaintWork() {
  if (lastPaint && el && el.isConnected && !el.hidden) { whatEl.textContent = whatShown(lastPaint); }
}
function paint(what, count, pct, state) {
  if (!parts()) return;
  clearTimeout(clearTimer);
  el.hidden = false;
  el.classList.toggle('is-waiting', state === 'waiting');
  el.classList.toggle('is-done', state === 'done');
  lastPaint = what || '';
  whatEl.textContent = whatShown(what);
  countEl.textContent = count || '';
  if (Number.isFinite(pct)) fillEl.style.width = Math.max(0, Math.min(100, pct)) + '%';
}

/* Begin a piece of work. Returns a handle; every method on it is a no-op once
 * a newer piece of work has begun, so two actions can never fight over the
 * banner. */
export function beginWork(what, stop, tale) {
  const mine = ++token;
  const live = () => mine === token;
  /* M675: ITS LAST WORD IS SAID (done, paused or failed). Whoever follows a piece of work to its end asks `open()`: still
   * the banner on show, and nothing has ended it — so work that ends some way its own code did not foresee (its model
   * never answering, its tale let go) is ended by its follower, and a banner is never left standing over nothing. */
  let over = false;
  onStop = typeof stop === 'function' ? stop : null;
  taleOfBanner = (typeof tale === 'string' && tale) ? tale : (ask(knows.openTale) || null); /* M510-42: the tale whose work this is */
  paint(what, '', 0, 'running');
  if (stopEl) stopEl.hidden = !onStop;
  return {
    /* "batch 7 of 24 · 29%" — in whatever units the caller counts in */
    /* "batch 4 of 17 · 24% · 24 of 99 pages" — the unit the work is really
     * done in, and what that means in pages beside it. */
    step(done, total, unit = 'batch', aside) {
      if (!live()) return;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      const count = (total > 0 ? unit + ' ' + done + ' of ' + total + ' · ' + pct + '%' : unit + ' ' + done)
        + (aside ? ' · ' + aside : '');
      paint(what, count, pct, 'running');
    },
    /* a stumble, with the wait counting down so the writer sees it is alive */
    waiting(seconds, attempt, of) {
      if (!live()) return;
      const left = Math.max(0, Math.round(seconds));
      paint(what, 'trying again in ' + left + 's' + (attempt ? ' (' + attempt + ' of ' + of + ')' : ''), undefined, 'waiting');
    },
    /* a plain word, when there is nothing to count */
    say(words) {
      if (!live()) return;
      paint(what, words || '', undefined, 'running');
    },
    /* M675: A BANNER THAT IS NO LONGER THE ONE ON SHOW ENDS IN SILENCE. These three hid the Stop button and forgot its
     * handler BEFORE asking whether they were still the banner on show — so work that ended while a newer piece of
     * work held the banner (the house's own reading of missed pages finishing after he pressed "Audit the ledger")
     * took the NEWER banner's Stop away: it went on saying "reading the whole ledger" with nothing to stop it by. */
    done(words) {
      over = true;
      if (!live()) return;
      if (stopEl) stopEl.hidden = true;
      onStop = null;
      paint(words || what, 'done', 100, 'done');
      clearTimer = setTimeout(() => { if (live() && el) el.hidden = true; }, 4500);
    },
    /* M454: a pause the house will come back from by itself — said, then out of the way */
    paused(words) {
      over = true;
      if (!live()) return;
      if (stopEl) stopEl.hidden = true;
      onStop = null;
      paint(words || what, 'paused', undefined, 'waiting');
      clearTimer = setTimeout(() => { if (live() && el) el.hidden = true; }, 6000);
    },
    failed(words) {
      over = true;
      if (!live()) return;
      if (stopEl) stopEl.hidden = true;
      onStop = null;
      paint(words || what, 'stopped', undefined, 'waiting');
      clearTimer = setTimeout(() => { if (live() && el) el.hidden = true; }, 9000);
    },
    live,
    open: () => live() && !over,
  };
}

/* A wait the writer can watch, counting down, for a pause a worker is already
 * inside. Settles when the wait is over. */
export async function waitVisibly(handle, ms, attempt, of) {
  const until = Date.now() + ms;
  for (;;) {
    const left = until - Date.now();
    if (left <= 0) return;
    if (handle && typeof handle.waiting === 'function') handle.waiting(left / 1000, attempt, of);
    /* eslint-disable-next-line no-await-in-loop */
    await new Promise((r) => setTimeout(r, Math.min(1000, Math.max(120, left))));
  }
}
