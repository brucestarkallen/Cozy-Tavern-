/* M457: USAGE AND COST — what every call to a model took and cost (the storyteller and every worker), today, over 7 and
 * 30 days, and on average per day, per week and per month at the rate so far — each connection and model on its own
 * row, and the total. Prices are each connection's own ($ per million tokens, set in its editor). */
import { db } from '../store.js';
import { summarize, busiestDays, USAGE_PREFIX } from '../engine/usage.js';

const tok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n)));
const money = (c) => (c === null || c === undefined ? '—' : '$' + (c >= 100 ? c.toFixed(0) : c >= 1 ? c.toFixed(2) : c.toFixed(3)));
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

export async function readUsageBooks() {
  const keys = (await db.settings.keys()).filter((k) => k.startsWith(USAGE_PREFIX));
  const books = {};
  for (const k of keys) { const v = await db.settings.get(k); if (v && typeof v === 'object') books[k.slice(USAGE_PREFIX.length)] = v; }
  return books;
}

function table(period) {
  const t = mk('table', 'usage-table');
  const head = mk('tr');
  for (const h of ['Connection · model', 'In', 'Out', 'Cost']) head.appendChild(mk('th', '', h));
  t.appendChild(head);
  if (!period.rows.length) { const r = mk('tr'); const c = mk('td', 'quiet', 'No calls yet.'); c.colSpan = 4; r.appendChild(c); t.appendChild(r); return t; }
  for (const r of period.rows) {
    const tr = mk('tr');
    tr.appendChild(mk('td', '', r.name + ' · ' + r.model + (r.estimated ? ' ≈' : '')));
    tr.appendChild(mk('td', 'num', tok(r.in) + (r.cached ? ' (' + tok(r.cached) + ' cached)' : ''))); /* M510-25 */
    tr.appendChild(mk('td', 'num', tok(r.out)));
    tr.appendChild(mk('td', 'num', r.cost === null ? 'no price' : money(r.cost)));
    t.appendChild(tr);
  }
  const tt = period.total;
  const tr = mk('tr', 'usage-total');
  tr.appendChild(mk('td', '', 'Total (' + tt.calls + ' calls)'));
  tr.appendChild(mk('td', 'num', tok(tt.in)));
  tr.appendChild(mk('td', 'num', tok(tt.out)));
  tr.appendChild(mk('td', 'num', money(tt.cost) + (tt.unpriced && tt.cost !== null ? ' +' : '')));
  t.appendChild(tr);
  return t;
}

export async function renderUsage(box, { now = Date.now() } = {}) {
  if (!box) return;
  const [books, conns] = await Promise.all([readUsageBooks(), db.connections.list()]);
  const s = summarize(books, conns, now);
  box.textContent = '';
  const pick = mk('div', 'usage-periods');
  const shown = mk('div', 'usage-shown');
  const periods = [['today', 'Today'], ['week', 'Last 7 days'], ['month', 'Last 30 days']];
  const choose = (key) => {
    for (const b of pick.querySelectorAll('button')) b.classList.toggle('current', b.dataset.period === key);
    shown.textContent = '';
    shown.appendChild(table(s[key]));
  };
  for (const [key, words] of periods) {
    const b = mk('button', 'usage-period', words); /* never 'nav-chip' — that class means a room of Settings */
    b.type = 'button';
    b.dataset.period = key;
    b.addEventListener('click', () => choose(key));
    pick.appendChild(b);
  }
  box.appendChild(pick);
  box.appendChild(shown);
  choose('today');
  const avg = mk('div', 'usage-averages');
  avg.appendChild(mk('p', 'stack-label', s.days ? 'At the rate so far (averaged over ' + s.days + (s.days === 1 ? ' day' : ' days') + ')' : 'At the rate so far'));
  for (const [words, p] of [['Per day', s.perDay], ['Per week', s.perWeek], ['Per month', s.perMonth]]) {
    const line = mk('div', 'usage-avg-row');
    line.dataset.period = words;
    line.appendChild(mk('span', '', words));
    line.appendChild(mk('span', 'num', tok(p.in) + ' in · ' + tok(p.out) + ' out · ' + (p.cost === null ? 'set prices to see the cost' : money(p.cost) + (p.unpriced ? ' (some connections have no price)' : ''))));
    avg.appendChild(line);
  }
  box.appendChild(avg);
  /* M510-25: HIS BUSIEST DAY, PER MODEL — and what a month of days like it would come to */
  const peak = busiestDays(books, conns);
  /* M510-30: folded until he opens it ("it makes everything so cluttered") — and it stays as he left it */
  const busy = document.createElement('details');
  busy.className = 'usage-busiest';
  busy.open = (await db.settings.get('usageBusiestOpen')) === true;
  const fold = document.createElement('summary');
  fold.className = 'stack-label';
  fold.textContent = 'Your busiest day, per model — and a month of days like it';
  busy.appendChild(fold);
  busy.addEventListener('toggle', () => { db.settings.set('usageBusiestOpen', busy.open).catch(() => {}); });
  if (!peak.length) busy.appendChild(mk('p', 'quiet', 'No calls yet.'));
  else {
    const t = mk('table', 'usage-table usage-busiest-table');
    const head = mk('tr');
    for (const h of ['Connection · model', 'Busiest day', 'That day', 'Every day like it, a month']) head.appendChild(mk('th', '', h));
    t.appendChild(head);
    const dayWords = (k) => { const [y, m, d] = String(k).split('-').map(Number); const at = new Date(y, (m || 1) - 1, d || 1); return Number.isFinite(at.getTime()) ? at.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : String(k); };
    for (const p of peak) {
      const tr = mk('tr');
      tr.dataset.model = p.model;
      tr.appendChild(mk('td', '', p.name + ' · ' + p.model + (p.estimated ? ' ≈' : '')));
      tr.appendChild(mk('td', '', dayWords(p.day)));
      tr.appendChild(mk('td', 'num', tok(p.in) + ' in · ' + tok(p.out) + ' out · ' + (p.cost === null ? 'no price' : money(p.cost))));
      tr.appendChild(mk('td', 'num', tok(p.month.in) + ' in · ' + tok(p.month.out) + ' out · ' + (p.month.cost === null ? 'no price' : money(p.month.cost))));
      t.appendChild(tr);
    }
    busy.appendChild(t);
    busy.appendChild(mk('p', 'quiet', 'Of every day recorded. A month of days like it is that day thirty times, at each connection’s prices as they stand.'));
  }
  box.appendChild(busy);
  box.appendChild(mk('p', 'quiet', '≈ where a provider did not say, tokens are estimated at four characters each.'));
}
