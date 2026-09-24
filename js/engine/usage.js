/* M457: WHAT EVERY CALL TO A MODEL COST — tokens in and out, per day, per connection and model; the storyteller and
 * every worker alike (all of them go through providers/relay.js houseFetch). Pure: the day books, the sums over a day,
 * a week and a month, the averages, and the money from each connection's own prices ($ per million tokens). */

export const USAGE_PREFIX = 'usage:';
const pad = (n) => String(n).padStart(2, '0');

/* the local calendar day a call landed on */
export function dayKey(ms) {
  const d = new Date(Number.isFinite(ms) ? ms : Date.now());
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/* one call added to a day's book: a row per connection and model */
export function addToDay(day, entry) {
  const book = day && typeof day === 'object' ? { ...day } : {};
  const e = entry && typeof entry === 'object' ? entry : {};
  const model = String(e.model || '').trim() || '(no model named)';
  const key = String(e.connId || e.connName || 'unknown') + '|' + model;
  const was = book[key] && typeof book[key] === 'object' ? book[key] : { connId: String(e.connId || ''), name: String(e.connName || ''), model, in: 0, out: 0, calls: 0, estimated: 0 };
  const inTok = Math.max(0, Math.round(Number(e.inTok) || 0));
  const outTok = Math.max(0, Math.round(Number(e.outTok) || 0));
  book[key] = { ...was, name: String(e.connName || was.name || ''), in: was.in + inTok, out: was.out + outTok, calls: was.calls + 1, estimated: was.estimated + (e.estimated ? 1 : 0) };
  return book;
}

/* the money for a row, from its connection's prices — null when no price is set */
export function costOf(row, conn) {
  const pin = conn && Number.isFinite(Number(conn.priceIn)) && conn.priceIn !== null && conn.priceIn !== '' ? Number(conn.priceIn) : null;
  const pout = conn && Number.isFinite(Number(conn.priceOut)) && conn.priceOut !== null && conn.priceOut !== '' ? Number(conn.priceOut) : null;
  if (pin === null && pout === null) return null;
  return (row.in / 1e6) * (pin || 0) + (row.out / 1e6) * (pout || 0);
}

/* the days (ending today) a period covers */
export function daysBack(nowMs, n) {
  const out = [];
  const d = new Date(Number.isFinite(nowMs) ? nowMs : Date.now());
  d.setHours(12, 0, 0, 0);
  for (let i = 0; i < n; i += 1) { out.push(dayKey(d.getTime())); d.setDate(d.getDate() - 1); }
  return out;
}

function sumDays(books, keys, conns) {
  const rows = {};
  for (const k of keys) {
    const day = books[k];
    if (!day || typeof day !== 'object') continue;
    for (const [rk, r] of Object.entries(day)) {
      if (!r || typeof r !== 'object') continue;
      const was = rows[rk] || { connId: r.connId, name: r.name, model: r.model, in: 0, out: 0, calls: 0, estimated: 0 };
      rows[rk] = { ...was, name: r.name || was.name, in: was.in + (r.in || 0), out: was.out + (r.out || 0), calls: was.calls + (r.calls || 0), estimated: was.estimated + (r.estimated || 0) };
    }
  }
  const byId = new Map((Array.isArray(conns) ? conns : []).map((c) => [String(c.id), c]));
  const list = Object.values(rows).map((r) => { const c = byId.get(String(r.connId)); return { ...r, name: (c && (c.label || c.name)) || r.name || 'a connection', cost: costOf(r, c) }; })
    .sort((a, b) => (b.in + b.out) - (a.in + a.out));
  const total = list.reduce((t, r) => ({ in: t.in + r.in, out: t.out + r.out, calls: t.calls + r.calls, estimated: t.estimated + r.estimated, cost: r.cost === null ? t.cost : (t.cost || 0) + r.cost, unpriced: t.unpriced || r.cost === null }), { in: 0, out: 0, calls: 0, estimated: 0, cost: null, unpriced: false });
  return { rows: list, total };
}

/* today, the last 7 days, the last 30 days — and the averages: per day over the days with any call in the last 30
 * (from the first such day to today), a week and a month at that rate */
export function summarize(books, conns, nowMs = Date.now()) {
  const safe = books && typeof books === 'object' ? books : {};
  const month = daysBack(nowMs, 30);
  const out = { today: sumDays(safe, month.slice(0, 1), conns), week: sumDays(safe, month.slice(0, 7), conns), month: sumDays(safe, month, conns) };
  const used = month.map((k, i) => (safe[k] && Object.keys(safe[k]).length ? i : -1)).filter((i) => i >= 0);
  const span = used.length ? Math.max(...used) + 1 : 0;
  const per = (x) => (span ? x / span : 0);
  const m = out.month.total;
  out.days = span;
  out.perDay = { in: per(m.in), out: per(m.out), calls: per(m.calls), cost: m.cost === null ? null : per(m.cost), unpriced: m.unpriced };
  out.perWeek = { in: out.perDay.in * 7, out: out.perDay.out * 7, calls: out.perDay.calls * 7, cost: out.perDay.cost === null ? null : out.perDay.cost * 7, unpriced: m.unpriced };
  out.perMonth = { in: out.perDay.in * 30, out: out.perDay.out * 30, calls: out.perDay.calls * 30, cost: out.perDay.cost === null ? null : out.perDay.cost * 30, unpriced: m.unpriced };
  return out;
}

/* what a call reported, from one JSON body or one stream event (OpenAI-compatible and Anthropic shapes) */
export function usageFrom(j) {
  if (!j || typeof j !== 'object') return null;
  const u = j.usage || (j.message && j.message.usage) || null;
  if (!u || typeof u !== 'object') return null;
  const inTok = Number(u.prompt_tokens ?? ((u.input_tokens ?? NaN) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)));
  const outTok = Number(u.completion_tokens ?? u.output_tokens);
  return { inTok: Number.isFinite(inTok) ? inTok : null, outTok: Number.isFinite(outTok) ? outTok : null };
}
