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
  const disposition = t(p.disposition) || t(p.outcome);
  return [head, ...parts, ...words, disposition ? '  Current disposition: ' + disposition : ''].join('\n');
}

export function renderStanding(book, options = {}) {
  return (options.selected || selectStanding(book, options)).map(renderPlan).join('\n\n');
}

/* Match supported text for relevance, never as proof a condition was satisfied. */
export function selectStanding(book, { move = '', scene = '', state = null, cap = Infinity, through = Infinity } = {}) {
  const words = s => new Set(String(s || '').toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []);
  const here = (state?.present || []).map(p => typeof p === 'string' ? p : p.name).filter(Boolean);
  const concerns = here.flatMap(name => { const person = state?.characters?.[name]; return [person?.state || '',...(person?.threads || [])]; }).join('\n');
  const wanted = words(move + '\n' + scene + '\n' + (state?.place?.name || '') + '\n' + (state?.clock?.label || '') + '\n' + concerns);
  const overlap = text => [...words(text)].filter(w => wanted.has(w)).length;
  const ranked = standingPlans(book).filter(p => !Number.isFinite(p.from) || p.from < through).map((p,i) => ({ p,i, score: 3 * overlap(p.title + ' ' + (p.goal || '')) + overlap(renderPlan(p)) + (p.parts || []).filter(x => !x.done && here.includes(x.who)).length }));
  ranked.sort((a,b) => b.score - a.score || b.i - a.i);
  const chosen = []; let used = 0;
  for (const {p} of ranked) {
    const cost = renderPlan(p).length + 2;
    if (chosen.length >= STANDING_SHOWN || used + cost > cap) continue;
    chosen.push(p); used += cost;
  }
  return chosen;
}
