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
let clearTimer = 0;
let token = 0;

function parts() {
  if (el && el.isConnected) return true;
  el = document.getElementById('work-banner');
  whatEl = document.getElementById('work-banner-what');
  countEl = document.getElementById('work-banner-count');
  fillEl = document.getElementById('work-banner-fill');
  return Boolean(el && whatEl && countEl && fillEl);
}

function paint(what, count, pct, state) {
  if (!parts()) return;
  clearTimeout(clearTimer);
  el.hidden = false;
  el.classList.toggle('is-waiting', state === 'waiting');
  el.classList.toggle('is-done', state === 'done');
  whatEl.textContent = what || '';
  countEl.textContent = count || '';
  if (Number.isFinite(pct)) fillEl.style.width = Math.max(0, Math.min(100, pct)) + '%';
}

/* Begin a piece of work. Returns a handle; every method on it is a no-op once
 * a newer piece of work has begun, so two actions can never fight over the
 * banner. */
export function beginWork(what) {
  const mine = ++token;
  const live = () => mine === token;
  paint(what, '', 0, 'running');
  return {
    /* "batch 7 of 24 · 29%" — in whatever units the caller counts in */
    step(done, total, unit = 'batch') {
      if (!live()) return;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      paint(what, total > 0 ? unit + ' ' + done + ' of ' + total + ' · ' + pct + '%' : unit + ' ' + done, pct, 'running');
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
    done(words) {
      if (!live()) return;
      paint(words || what, 'done', 100, 'done');
      clearTimer = setTimeout(() => { if (live() && el) el.hidden = true; }, 4500);
    },
    failed(words) {
      if (!live()) return;
      paint(words || what, 'stopped', undefined, 'waiting');
      clearTimer = setTimeout(() => { if (live() && el) el.hidden = true; }, 9000);
    },
    live,
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
