/* Cozy Tavern — assemble/planbook.js (M510-22)
 * THE PLANS STANDING, as a small storyteller reads them. A plan the characters laid out — who does what, in what order,
 * on what signal — is kept whole by the plans keeper (agents/plans.js) until it is carried out or dropped; this is how
 * it reads on the page, part by part, with the exact words to be said. Pure: no store, no model. */

export const STANDING_SHOWN = 6;

export function standingPlans(book) {
  return (book && Array.isArray(book.plans) ? book.plans : []).filter((p) => p && p.status === 'standing' && Array.isArray(p.parts) && p.parts.length);
}

function pagesOf(p) {
  if (!Number.isFinite(p.from)) return '';
  const to = Number.isFinite(p.to) && p.to !== p.from ? '–' + (p.to + 1) : '';
  return ', laid out on page' + (to ? 's ' : ' ') + (p.from + 1) + to;
}

export function renderPlan(p) {
  const t = (v) => (typeof v === 'string' ? v : ''); /* M553 (the audit): a kept plan of an older build or a damaged row never breaks the request */
  const head = t(p.title) + (t(p.by) ? ' — ' + t(p.by) + '’s plan' : '') + pagesOf(p) + (t(p.goal) ? '. The aim: ' + t(p.goal).replace(/\.+$/, '') + '.' : '.');
  const parts = p.parts.filter((x) => x && typeof x === 'object').map((x, i) => '  ' + (i + 1) + '. ' + t(x.who) + ' — ' + t(x.does).replace(/\.+$/, '') + (t(x.when) ? ' (' + t(x.when).replace(/\.+$/, '') + ')' : '') + (x.done ? ' — done.' : '.'));
  const said = (Array.isArray(p.words) ? p.words : []).filter((w) => typeof w === 'string' && w.trim());
  const words = said.length ? ['  The words to be said: ' + said.map((w) => '“' + w + '”').join('; ')] : [];
  return [head, ...parts, ...words].join('\n');
}

export function renderStanding(book) {
  return standingPlans(book).slice(-STANDING_SHOWN).map(renderPlan).join('\n\n');
}
