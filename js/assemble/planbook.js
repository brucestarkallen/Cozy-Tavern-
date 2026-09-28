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
  const head = p.title + (p.by ? ' — ' + p.by + '’s plan' : '') + pagesOf(p) + (p.goal ? '. The aim: ' + p.goal.replace(/\.+$/, '') + '.' : '.');
  const parts = p.parts.map((x, i) => '  ' + (i + 1) + '. ' + x.who + ' — ' + x.does.replace(/\.+$/, '') + (x.when ? ' (' + x.when.replace(/\.+$/, '') + ')' : '') + (x.done ? ' — done.' : '.'));
  const words = Array.isArray(p.words) && p.words.length ? ['  The words to be said: ' + p.words.map((w) => '“' + w + '”').join('; ')] : [];
  return [head, ...parts, ...words].join('\n');
}

export function renderStanding(book) {
  return standingPlans(book).slice(-STANDING_SHOWN).map(renderPlan).join('\n\n');
}
