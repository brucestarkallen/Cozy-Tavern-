/* Cozy Tavern — the benchmark, in Settings → Storyteller (M632).
 *
 * "Grade every page" (off as it ships — it is a call to the judge for each page), "Graded by" (any connection; empty is the
 * readers' own), the board (each storyteller: rank, its average, its pages, head to head, and its five averages folded
 * under it), and "Clear the scores". The grading itself runs in the page's background chain (chat.js) — after the page,
 * never before it. */
import { db } from '../store.js';
import { AXES } from '../agents/judge.js';
import { loadBench, boardRows, clearBench } from '../engine/bench.js';
import { runBenchmark } from '../agents/benchrun.js'; /* M633 */

export const BENCH_ON = 'benchOn';
export const BENCH_JUDGE = 'benchJudgeId'; /* M632: one judge (read as the first of the list when the list is unset) */
export const BENCH_JUDGES = 'benchJudges'; /* M633: the judges he ticked — their grades averaged */
export const BENCH_TAKERS = 'benchTakers'; /* M633: the storytellers a run tests, up to four */

/* M633: the judges in force — the ticked list; else the one judge of before; else none (the readers' own, by the caller) */
export async function benchJudgeIds() {
  const list = await db.settings.get(BENCH_JUDGES);
  if (Array.isArray(list)) return list.filter((x) => typeof x === 'string' && x);
  const one = await db.settings.get(BENCH_JUDGE);
  return typeof one === 'string' && one ? [one] : [];
}

export function initBench(ctx) {
  const on = document.getElementById('bench-on');
  const judgesBox = document.getElementById('bench-judges');
  const takersBox = document.getElementById('bench-takers');
  const runBtn = document.getElementById('btn-bench-run');
  const stopBtn = document.getElementById('btn-bench-stop');
  const progress = document.getElementById('bench-progress');
  const lastBox = document.getElementById('bench-last');
  const board = document.getElementById('bench-board');
  const clear = document.getElementById('btn-bench-clear');
  if (!on || !judgesBox || !board) return null;
  let running = null;

  /* a tick per connection; `limit` holds the count (four storytellers at most) */
  function picks(box, conns, chosen, onChange, limit = Infinity) {
    box.textContent = '';
    for (const c of conns) {
      const label = document.createElement('label');
      label.className = 'radio-row';
      const tick = document.createElement('input');
      tick.type = 'checkbox';
      tick.value = c.id;
      tick.checked = chosen.includes(c.id);
      tick.addEventListener('change', async () => {
        const now = [...box.querySelectorAll('input[type=checkbox]')].filter((t) => t.checked).map((t) => t.value);
        if (now.length > limit) { tick.checked = false; return; }
        await onChange(now);
      });
      label.append(tick, document.createTextNode(' ' + (c.label || c.model || 'a connection') + (c.model && c.label ? ' \u00b7 ' + c.model : '')));
      box.appendChild(label);
    }
    if (!conns.length) { const p = document.createElement('p'); p.className = 'quiet'; p.textContent = 'No connection yet — add one above.'; box.appendChild(p); }
  }

  function drawLast(run) {
    if (!lastBox) return;
    lastBox.textContent = '';
    if (!run || !Array.isArray(run.results) || !run.results.length) return;
    const head = document.createElement('p');
    head.className = 'quiet';
    head.textContent = `Last run — “${run.story && run.story.title || 'a tale'}”, page ${run.pageNumber}; graded by ${(run.judges || []).join(', ') || 'one judge'}:`;
    lastBox.appendChild(head);
    run.results.forEach((r, i) => {
      const card = document.createElement('div');
      card.className = 'bench-row bench-run-row';
      card.dataset.writer = r.id;
      const top = document.createElement('div');
      top.className = 'bench-top';
      const rank = document.createElement('span'); rank.className = 'bench-rank'; rank.textContent = r.overall === null ? '—' : '#' + (i + 1);
      const who = document.createElement('span'); who.className = 'bench-who'; who.textContent = r.name + (r.model && r.model !== r.name ? ' \u00b7 ' + r.model : '');
      top.append(rank, who);
      const line = document.createElement('div');
      line.className = 'bench-line';
      if (r.failed) line.textContent = 'could not write it: ' + r.failed;
      else {
        const score = document.createElement('strong'); score.className = 'bench-score'; score.textContent = r.overall === null ? '—' : r.overall.toFixed(1);
        const h2h = r.win + r.loss + r.tie ? ` \u00b7 head to head ${r.win}\u2013${r.loss}` + (r.tie ? `\u2013${r.tie}` : '') : '';
        line.append(score, document.createTextNode(h2h));
      }
      card.append(top, line);
      if (r.text) {
        const more = document.createElement('details');
        const sum = document.createElement('summary'); sum.className = 'quiet'; sum.textContent = 'Read the page it wrote';
        const body = document.createElement('div'); body.className = 'bench-page'; body.textContent = r.text;
        more.append(sum, body);
        card.appendChild(more);
      }
      lastBox.appendChild(card);
    });
  }


  async function draw() {
    on.checked = (await db.settings.get(BENCH_ON)) === true;
    const conns = await db.connections.list();
    /* M633: the judges — none ticked is the readers' own connection */
    picks(judgesBox, conns, await benchJudgeIds(), async (ids) => { await db.settings.set(BENCH_JUDGES, ids); });
    if (takersBox) {
      const wanted = await db.settings.get(BENCH_TAKERS);
      picks(takersBox, conns, Array.isArray(wanted) ? wanted : [], async (ids) => { await db.settings.set(BENCH_TAKERS, ids); }, 4);
    }
    drawLast(await db.settings.get('benchLastRun'));
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
  /* M633: the run — the storytellers ticked, every judge ticked (none: the readers' own connection, as the house resolves it) */
  if (runBtn) runBtn.addEventListener('click', async () => {
    if (running) return;
    const conns = await db.connections.list();
    const want = await db.settings.get(BENCH_TAKERS);
    const takers = conns.filter((c) => Array.isArray(want) && want.includes(c.id)).slice(0, 4);
    const judgeIds = await benchJudgeIds();
    let judges = conns.filter((c) => judgeIds.includes(c.id));
    if (!judges.length && ctx && typeof ctx.readersConnection === 'function') { const r = await ctx.readersConnection(); if (r) judges = [r]; }
    if (!takers.length) { if (progress) { progress.hidden = false; progress.textContent = 'Tick at least one storyteller to test.'; } return; }
    if (!judges.length) { if (progress) { progress.hidden = false; progress.textContent = 'Tick a judge — no connection could grade.'; } return; }
    running = new AbortController();
    runBtn.disabled = true; if (stopBtn) stopBtn.hidden = false;
    if (progress) { progress.hidden = false; progress.textContent = 'Starting…'; }
    try {
      const run = await runBenchmark({ candidates: takers, judges, signal: running.signal, onProgress: (w) => { if (progress) progress.textContent = w; } });
      if (progress) progress.textContent = 'Done — ' + run.results.filter((r) => r.overall !== null).length + ' graded.';
      drawLast(run);
      await draw();
    } catch (err) {
      if (progress) progress.textContent = running && running.signal.aborted ? 'Stopped — nothing of it was kept but what finished.' : 'The run stopped: ' + (err && err.message ? err.message : String(err));
    } finally {
      running = null;
      runBtn.disabled = false; if (stopBtn) stopBtn.hidden = true;
    }
  });
  if (stopBtn) stopBtn.addEventListener('click', () => { if (running) running.abort(); });
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
