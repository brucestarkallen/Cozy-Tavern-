/* Cozy Tavern — the benchmark, in Settings → Storyteller (M632).
 *
 * "Grade every page" (off as it ships — it is a call to the judge for each page), "Graded by" (any connection; empty is the
 * readers' own), the board (each storyteller: rank, its average, its pages, head to head, and its five averages folded
 * under it), and "Clear the scores". The grading itself runs in the page's background chain (chat.js) — after the page,
 * never before it. */
import { db } from '../store.js';
import { AXES } from '../agents/judge.js';
import { loadBench, boardRows, clearBench } from '../engine/bench.js';

export const BENCH_ON = 'benchOn';
export const BENCH_JUDGE = 'benchJudgeId';

export function initBench(ctx) {
  const on = document.getElementById('bench-on');
  const judge = document.getElementById('bench-judge');
  const board = document.getElementById('bench-board');
  const clear = document.getElementById('btn-bench-clear');
  if (!on || !judge || !board) return null;


  async function draw() {
    on.checked = (await db.settings.get(BENCH_ON)) === true;
    const conns = await db.connections.list();
    const want = (await db.settings.get(BENCH_JUDGE)) || '';
    judge.textContent = '';
    const first = document.createElement('option');
    first.value = '';
    first.textContent = 'The readers\u2019 own connection';
    judge.appendChild(first);
    for (const c of conns) { const o = document.createElement('option'); o.value = c.id; o.textContent = (c.label || c.model || 'a connection') + (c.model && c.label ? ' \u00b7 ' + c.model : ''); judge.appendChild(o); }
    judge.value = conns.some((c) => c.id === want) ? want : '';
    const names = Object.fromEntries(conns.map((c) => [c.id, (c.label || c.model || 'a connection')]));
    const { grades, duels } = await loadBench();
    const rows = boardRows(grades, duels, names);
    board.textContent = '';
    if (!rows.length) {
      const p = document.createElement('p');
      p.className = 'quiet';
      p.textContent = 'No page graded yet. Tick "Grade every page" and write — each storyteller\u2019s score builds as its pages land.';
      board.appendChild(p);
      return;
    }
    /* one card per storyteller — a phone-wide table cut the head to head off the edge (measured: 456 px in a 380 px room) */
    const list = document.createElement('div');
    list.className = 'bench-list';
    for (const r of rows) {
      const card = document.createElement('div');
      card.className = 'bench-row';
      card.dataset.writer = r.writer;
      const top = document.createElement('div');
      top.className = 'bench-top';
      const rank = document.createElement('span');
      rank.className = 'bench-rank';
      rank.textContent = r.rank ? '#' + r.rank : '—';
      const who = document.createElement('span');
      who.className = 'bench-who';
      who.textContent = r.label + (r.model && r.model !== r.label ? ' \u00b7 ' + r.model : '');
      top.append(rank, who);
      const line = document.createElement('div');
      line.className = 'bench-line';
      const score = document.createElement('strong');
      score.className = 'bench-score';
      score.textContent = r.average === null ? '—' : r.average.toFixed(1);
      const h2h = r.win + r.loss + r.tie ? ` \u00b7 head to head ${r.win}\u2013${r.loss}` + (r.tie ? `\u2013${r.tie}` : '') : '';
      line.append(score, document.createTextNode(` \u00b7 ${r.pages === 1 ? 'one page' : r.pages + ' pages'}${h2h}${r.pages < 5 ? ' \u00b7 few pages yet' : ''}`));
      const axes = document.createElement('div');
      axes.className = 'bench-axes quiet';
      axes.textContent = AXES.map(([k, words]) => words + ' ' + (r.axes[k] === null ? '—' : r.axes[k].toFixed(1))).join(' \u00b7 ');
      card.append(top, line, axes);
      list.appendChild(card);
    }
    board.appendChild(list);
    const note = document.createElement('p');
    note.className = 'quiet';
    note.textContent = 'Ranked by the average of every page graded. Head to head is wins–losses(–ties) where one moment had pages from two storytellers, judged blind both ways round — the fairest test; when it and the score disagree, trust head to head.';
    board.appendChild(note);
  }

  on.addEventListener('change', async () => { await db.settings.set(BENCH_ON, on.checked); });
  judge.addEventListener('change', async () => { if (judge.value) await db.settings.set(BENCH_JUDGE, judge.value); else await db.settings.delete(BENCH_JUDGE); });
  if (clear) clear.addEventListener('click', async () => {
    if (typeof window.confirm === 'function' && !window.confirm('Clear every score and head to head? The pages stay as they are.')) return;
    await clearBench();
    await draw();
  });

  draw().catch(() => {});
  const api = { reload: draw };
  if (ctx) ctx.bench = api;
  return api;
}
