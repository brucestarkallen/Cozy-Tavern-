/* Cozy Tavern — the benchmark's book (M632): grades and duels, kept as two settings rows, and the board read from them.
 * A storyteller is known by the connection that wrote the page (its id, its name, its model); a page from before the
 * receipt named its connection is known by its model alone. Every grade counts once (a page graded again replaces its
 * grade); the newest thousand grades and five hundred duels are kept. */
import { db } from '../store.js';
import { AXES } from '../agents/judge.js';

export const BENCH_GRADES = 'benchGrades';
export const BENCH_DUELS = 'benchDuels';
const KEEP_GRADES = 1000;
const KEEP_DUELS = 500;

export const writerKey = (receipt) => {
  const r = receipt && typeof receipt === 'object' ? receipt : {};
  if (typeof r.connId === 'string' && r.connId) return r.connId;
  return typeof r.model === 'string' && r.model ? 'model:' + r.model : '';
};

export async function loadBench() {
  const grades = await db.settings.get(BENCH_GRADES);
  const duels = await db.settings.get(BENCH_DUELS);
  return { grades: Array.isArray(grades) ? grades : [], duels: Array.isArray(duels) ? duels : [] };
}

export async function recordGrade(row) {
  if (!row || !row.writer || !row.pageKey || !Number.isFinite(row.overall)) return false;
  const { grades } = await loadBench();
  const next = [...grades.filter((g) => g && g.pageKey !== row.pageKey), { ...row, at: row.at || Date.now() }].slice(-KEEP_GRADES);
  await db.settings.set(BENCH_GRADES, next);
  return true;
}

export async function recordDuel(row) {
  if (!row || !row.x || !row.y || row.x === row.y || !row.duelKey) return false;
  const { duels } = await loadBench();
  if (duels.some((d) => d && d.duelKey === row.duelKey)) return false; /* one moment, one pair, judged once */
  await db.settings.set(BENCH_DUELS, [...duels, { ...row, at: row.at || Date.now() }].slice(-KEEP_DUELS));
  return true;
}

export async function clearBench() {
  await db.settings.delete(BENCH_GRADES);
  await db.settings.delete(BENCH_DUELS);
}

/* the board: one row per storyteller that has a grade or a duel, ranked by its average overall (head to head beside it) */
export function boardRows(grades, duels, names = {}) {
  const rows = new Map();
  const row = (k) => {
    if (!rows.has(k)) rows.set(k, { writer: k, label: names[k] || '', model: '', n: 0, sum: 0, axes: Object.fromEntries(AXES.map(([a]) => [a, { sum: 0, n: 0 }])), win: 0, loss: 0, tie: 0 });
    return rows.get(k);
  };
  for (const g of Array.isArray(grades) ? grades : []) {
    if (!g || !g.writer || !Number.isFinite(g.overall)) continue;
    const r = row(g.writer);
    r.n += 1; r.sum += g.overall;
    if (g.label && !r.label) r.label = g.label;
    if (g.model) r.model = g.model;
    for (const [a] of AXES) { const v = g.scores && Number(g.scores[a]); if (Number.isFinite(v)) { r.axes[a].sum += v; r.axes[a].n += 1; } }
  }
  for (const d of Array.isArray(duels) ? duels : []) {
    if (!d || !d.x || !d.y) continue;
    const a = row(d.x), b = row(d.y);
    if (d.xLabel && !a.label) a.label = d.xLabel;
    if (d.yLabel && !b.label) b.label = d.yLabel;
    if (d.winner === 'x') { a.win += 1; b.loss += 1; } else if (d.winner === 'y') { b.win += 1; a.loss += 1; } else { a.tie += 1; b.tie += 1; }
  }
  const out = [...rows.values()].map((r) => ({
    writer: r.writer,
    label: r.label || (r.writer.startsWith('model:') ? r.writer.slice(6) : 'a connection'),
    model: r.model || (r.writer.startsWith('model:') ? r.writer.slice(6) : ''),
    pages: r.n,
    average: r.n ? Math.round((r.sum / r.n) * 10) / 10 : null,
    axes: Object.fromEntries(AXES.map(([a]) => [a, r.axes[a].n ? Math.round((r.axes[a].sum / r.axes[a].n) * 10) / 10 : null])),
    win: r.win, loss: r.loss, tie: r.tie,
  }));
  out.sort((p, q) => ((q.average ?? -1) - (p.average ?? -1)) || ((q.win - q.loss) - (p.win - p.loss)) || (q.pages - p.pages));
  return out.map((r, i) => ({ ...r, rank: r.average === null ? null : i + 1 }));
}
