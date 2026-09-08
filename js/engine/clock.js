/* Cozy Tavern — engine/clock.js
 * The in-world clock. A clock is kept as a count of minutes since a fixed
 * story epoch (the same proleptic Gregorian epoch civil calendars use), so
 * advancing time is just arithmetic and rendering is just calendar math —
 * no Date objects, no timezones, no drift.
 *
 * Contract (SPEC.md M3):
 *   createClock({calendar='real', start=null})   -> ClockState
 *     ClockState = {calendar, minutes, label}    // minutes = story-epoch
 *                                                // minutes; label cached render
 *   setClock(state, {year,month,day,hour,minute})-> a mutation-applied copy
 *   advanceClock(state, deltaMinutes, reason)    // clamps 0..24*365
 *   renderClock(state)  // "Sunday, March 15, 2026 — 14:30" | custom names
 *
 * Custom calendars: a story may carry its own monthNames (12) and dayNames
 * (7) on the clock — written by hand from the ledger's clock panel as comma
 * lists. Where a name is missing, the real world's name stands in. The M3
 * clock does NOT derive travel ETAs; that rides with the offscreen engine
 * (M4). Clock only.
 *
 * These helpers are pure: they never mutate their argument, they return a
 * fresh copy. apply.js is the only caller that turns them into logged,
 * undoable mutations.
 */

/* Real-world names, kept here so a custom calendar can borrow them for any
 * slot it doesn't name itself. */
export const REAL_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const REAL_DAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

/* The most time the clock will move in one step: 24*365 minutes, per the
 * spec's clamp (about six days). Anything longer is almost certainly the
 * extractor mishearing the prose, and gets clamped. */
export const MAX_ADVANCE_MINUTES = 24 * 365;

const MINUTES_PER_DAY = 24 * 60;

/* ---------- civil calendar math (proleptic Gregorian, epoch 1970-01-01) ----
 * Howard Hinnant's days-from-civil, written out longhand. It handles leap
 * years exactly, so "Sunday, March 15, 2026" falls on the right weekday. */

function daysFromCivil(year, month, day) {
  let y = year;
  if (month <= 2) y -= 1;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;                                  // [0, 399]
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(z) {
  const shifted = z + 719468;
  const era = Math.floor(shifted / 146097);
  const doe = shifted - era * 146097;                         // [0, 146096]
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  return { year: month <= 2 ? y + 1 : y, month, day };
}

/* 1970-01-01 was a Thursday; index 0 = Sunday. */
function weekdayFromDays(days) {
  return (((days + 4) % 7) + 7) % 7;
}

function daysInMonth(year, month) {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1] || 31;
}

/* ---------- small helpers ---------- */

function clampInt(value, lo, hi, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function cleanNames(list, expected) {
  if (!Array.isArray(list)) return null;
  const names = list
    .slice(0, expected)
    .map((n) => (typeof n === 'string' ? n.trim() : ''));
  return names.some(Boolean) ? names : null;
}

function nameAt(names, fallback, index) {
  const custom = names && names[index];
  return custom || fallback[index];
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/* Minutes from wall-clock components. Forgiving by clamp: a 13th month
 * becomes December, a 40th day becomes the month's last. Type-level junk
 * (NaN, strings that aren't numbers) is rejected in apply.js before it ever
 * reaches here. */
function minutesFromComponents({ year, month, day, hour, minute }) {
  const y = clampInt(year, -99999, 99999, 1970);
  const mo = clampInt(month, 1, 12, 1);
  const d = clampInt(day, 1, daysInMonth(y, mo), 1);
  const h = clampInt(hour, 0, 23, 0);
  const mi = clampInt(minute, 0, 59, 0);
  return daysFromCivil(y, mo, d) * MINUTES_PER_DAY + h * 60 + mi;
}

/* ---------- the contract ---------- */

/* Create a fresh clock. `start` may be wall-clock components, a Date, or
 * null — null begins the clock at the device's own current wall-clock time,
 * a sensible "the story starts now". Custom month/day names ride along on
 * the state so renderClock can speak them. */
export function createClock({ calendar = 'real', start = null, monthNames = null, dayNames = null } = {}) {
  let minutes;
  if (start && typeof start === 'object' && typeof start.getTime === 'function') {
    minutes = minutesFromComponents({
      year: start.getFullYear(),
      month: start.getMonth() + 1,
      day: start.getDate(),
      hour: start.getHours(),
      minute: start.getMinutes(),
    });
  } else if (start && typeof start === 'object') {
    minutes = minutesFromComponents(start);
  } else {
    const now = new Date();
    minutes = minutesFromComponents({
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
      hour: now.getHours(),
      minute: now.getMinutes(),
    });
  }
  const clock = {
    calendar: calendar === 'custom' ? 'custom' : 'real',
    minutes,
    monthNames: cleanNames(monthNames, 12),
    dayNames: cleanNames(dayNames, 7),
    label: '',
  };
  clock.label = renderClock(clock);
  return clock;
}

/* Set the clock to an exact moment. Returns a fresh copy; the calendar and
 * its names are carried over untouched. */
export function setClock(state, components) {
  const base = state && typeof state === 'object' ? state : {};
  const next = {
    calendar: base.calendar === 'custom' ? 'custom' : 'real',
    minutes: minutesFromComponents(components || {}),
    monthNames: cleanNames(base.monthNames, 12),
    dayNames: cleanNames(base.dayNames, 7),
    label: '',
  };
  next.label = renderClock(next);
  return next;
}

/* Move the clock on. The delta clamps to 0..MAX_ADVANCE_MINUTES — the clock
 * only moves forward, and never by a jump the prose couldn't possibly hold
 * (apply.js says a word in the log when a jump runs past twelve hours).
 * Reason is accepted for the signature's sake; the log words are written in
 * apply.js. */
export function advanceClock(state, deltaMinutes, reason) {
  if (!state || typeof state.minutes !== 'number') return state || null;
  const raw = Number(deltaMinutes);
  const delta = Number.isFinite(raw)
    ? Math.min(MAX_ADVANCE_MINUTES, Math.max(0, Math.round(raw)))
    : 0;
  const next = { ...state, minutes: state.minutes + delta };
  next.label = renderClock(next);
  return next;
}

/* Render the clock the way a person would say it:
 * "Sunday, March 15, 2026 — 14:30". A custom calendar speaks its own month
 * and day names, borrowing the real ones for any it never named. */
export function renderClock(state) {
  if (!state || typeof state.minutes !== 'number' || !Number.isFinite(state.minutes)) return '';
  const days = Math.floor(state.minutes / MINUTES_PER_DAY);
  const within = ((state.minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const { year, month, day } = civilFromDays(days);
  const weekday = weekdayFromDays(days);
  const months = state.calendar === 'custom' ? state.monthNames : null;
  const dayNames = state.calendar === 'custom' ? state.dayNames : null;
  const monthName = nameAt(months, REAL_MONTHS, month - 1);
  const dayName = nameAt(dayNames, REAL_DAYS, weekday);
  return (
    dayName + ', ' + monthName + ' ' + day + ', ' + year +
    ' — ' + pad2(Math.floor(within / 60)) + ':' + pad2(within % 60)
  );
}
