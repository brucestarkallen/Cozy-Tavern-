/* Cozy Tavern — the benchmark run (M633).
 *
 * His word: "a manual random generation: I choose 1 to 4 connections, press it, and a random story is written by each —
 * one by one or all — and the judge grades them; and several judges, averaged, because I mostly use one model".
 * A RANDOM MOMENT OF HIS OWN STORIES, REPLAYED EXACTLY: every page he wrote kept the very request its storyteller was sent
 * (js/sent.js — his frame, the craft, the ledger's notes, the record, the pages; the newest two hundred of each tale). A run
 * picks one at random, and each chosen storyteller writes that same page from that same request, at once — nothing of his
 * tales is touched. A made-up scene would test a model on a story he never plays; this tests it on his.
 * Then every judge he ticked grades every page against its moment (the page before, his move, where things stood, as they
 * were sent), the judges' grades averaged; and every pair is judged head to head, blind, both ways round, each judge
 * voting and the majority standing (an even split is a tie). Both go into the board with his everyday grades. */
import { db } from '../store.js';
import { loadSent } from '../sent.js';
import { createProvider } from '../providers/index.js';
import { pageText } from '../assemble/stack.js';
import { splitAtHeader } from '../ui/headergate.js';
import { AXES, gradePage, duelPages } from './judge.js';
import { recordGrade, recordDuel, writerKey } from '../engine/bench.js';

/* a kept request, as a provider sent it (OpenAI's messages, or Anthropic's system and messages), back to the house's own
 * shape — system blocks and messages — so any connection can be sent it; the original's prefill (a trailing assistant
 * message) is left off: each storyteller writes with its own connection's settings, its own prefill among them */
export function neutralRequest(body) {
  const b = body && typeof body === 'object' ? body : {};
  const text = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('') : '');
  const systemBlocks = [];
  if (typeof b.system === 'string' && b.system.trim()) systemBlocks.push({ text: b.system });
  else if (Array.isArray(b.system)) for (const s of b.system) { const t = text([s]); if (t.trim()) systemBlocks.push({ text: t }); }
  const all = Array.isArray(b.messages) ? b.messages : [];
  let i = 0;
  if (!systemBlocks.length) while (i < all.length && all[i] && all[i].role === 'system') { const t = text(all[i].content); if (t.trim()) systemBlocks.push({ text: t }); i += 1; }
  const messages = all.slice(i)
    .map((m) => ({ role: m && m.role === 'assistant' ? 'assistant' : m && m.role === 'system' ? 'system' : 'user', content: text(m && m.content) }))
    .filter((m) => m.content.trim());
  while (messages.length && messages[messages.length - 1].role === 'assistant') messages.pop();
  return { systemBlocks, messages };
}

/* a random moment of his stories that kept its request — the newest fifty pages of a random tale, then another tale */
export async function pickMoment({ rnd = Math.random } = {}) {
  const tales = (await db.stories.list()).filter((s) => s && !(s.building && typeof s.building === 'object'));
  const order = tales.map((s) => ({ s, k: rnd() })).sort((a, b) => a.k - b.k).map((x) => x.s);
  for (const story of order) {
    const all = (await db.messages.list(story.id)).filter((m) => m && !m.hidden);
    const told = all.map((m, i) => ({ m, i })).filter(({ m }) => m.role === 'assistant' && !m.ooc && m.receipt && m.receipt.sentId);
    if (!told.length) continue;
    const recent = told.slice(-50);
    const tries = recent.map((x) => ({ x, k: rnd() })).sort((a, b) => a.k - b.k).map((y) => y.x);
    for (const pick of tries) {
      const rec = await loadSent(pick.m.receipt.sentId);
      const body = rec && Array.isArray(rec.requests) && rec.requests[0] && rec.requests[0].body;
      if (!body) continue;
      const request = neutralRequest(body);
      if (!request.messages.some((m) => m.role === 'user')) continue;
      const before = [...all.slice(0, pick.i)].reverse().find((m) => m.role === 'assistant');
      const move = [...all.slice(0, pick.i)].reverse().find((m) => m.role === 'user');
      const notes = ((rec.slots || []).find((s) => s && s.name === 'The state of things') || {}).text || '';
      return {
        story: { id: story.id, title: story.title || 'a tale' },
        pageNumber: told.indexOf(pick) + 1,
        request,
        context: { before: before ? pageText(before) : '', move: move ? pageText(move) : '', notes },
        original: { writer: writerKey(pick.m.receipt), label: pick.m.receipt.label || pick.m.receipt.model || '', text: pageText(pick.m) },
      };
    }
  }
  return null;
}

export async function writeWith(connection, request, signal) {
  const provider = createProvider(connection);
  const r = await provider.streamChat({ systemBlocks: request.systemBlocks, messages: request.messages, signal, onToken() { /* read whole */ } });
  const said = String((r && r.text) || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').trim();
  return splitAtHeader(said).page.trim(); /* the page the house would keep: a plan before its header is thinking (M322) */
}

/* every judge grades; the grades averaged, axis by axis */
export async function gradeWithJudges(judges, context, page, signal) {
  const got = (await Promise.all((judges || []).map((j) => gradePage({ connection: j, ...context, page, signal }).catch(() => null))))
    .filter((g) => g && Number.isFinite(g.overall));
  if (!got.length) return null;
  const avg = (vals) => (vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null);
  const scores = {};
  for (const [k] of AXES) { const v = avg(got.map((g) => g.scores[k]).filter((n) => Number.isFinite(n))); if (v !== null) scores[k] = v; }
  return { scores, overall: avg(got.map((g) => g.overall)), judges: got.length, why: got.map((g) => g.why).filter(Boolean).join(' / ').slice(0, 400) };
}

/* every judge reads the pair blind, both ways round; the majority of their verdicts stands, an even split is a tie */
export async function duelWithJudges(judges, context, x, y, signal) {
  const votes = (await Promise.all((judges || []).map((j) => duelPages({ connection: j, ...context, x, y, signal }).catch(() => null)))).filter(Boolean);
  if (!votes.length) return null;
  const forX = votes.filter((v) => v.winner === 'x').length;
  const forY = votes.filter((v) => v.winner === 'y').length;
  return { winner: forX > forY ? 'x' : forY > forX ? 'y' : 'tie', votes: votes.length, why: (votes.find((v) => v.why) || {}).why || '' };
}

const nameOf = (c) => (c && (c.label || c.model)) || 'a connection';

export async function runBenchmark({ candidates = [], judges = [], signal, onProgress = () => {}, rnd = Math.random } = {}) {
  const takers = candidates.filter(Boolean).slice(0, 4);
  if (!takers.length) throw new Error('choose at least one storyteller to test');
  if (!judges.length) throw new Error('no judge to grade with');
  onProgress('Finding a moment of your stories to replay…');
  const moment = await pickMoment({ rnd });
  if (!moment) throw new Error('no page of yours has its request kept yet — write a page or two first');
  const runId = 'run' + Date.now().toString(36);
  onProgress(`From “${moment.story.title}”, page ${moment.pageNumber} — ${takers.length === 1 ? 'one storyteller writes it' : takers.length + ' storytellers write it at once'}…`);
  const pages = await Promise.all(takers.map(async (c) => {
    try { return { c, text: await writeWith(c, moment.request, signal) }; } catch (err) { if (signal && signal.aborted) throw err; return { c, text: '', failed: String((err && err.message) || err) }; }
  }));
  if (signal && signal.aborted) throw new Error('stopped');
  const written = pages.filter((p) => p.text);
  onProgress(`Grading ${written.length === 1 ? 'the page' : 'the ' + written.length + ' pages'} — ${judges.length === 1 ? 'one judge' : judges.length + ' judges'}…`);
  for (const p of written) {
    p.grade = await gradeWithJudges(judges, moment.context, p.text, signal);
    if (p.grade) await recordGrade({ writer: p.c.id, label: nameOf(p.c), model: p.c.model || '', storyId: moment.story.id, pageKey: runId + ':' + p.c.id, scores: p.grade.scores, overall: p.grade.overall, why: p.grade.why, run: runId });
  }
  for (const p of written) { p.win = 0; p.loss = 0; p.tie = 0; }
  const pairs = [];
  for (let i = 0; i < written.length; i += 1) for (let j = i + 1; j < written.length; j += 1) pairs.push([written[i], written[j]]);
  let n = 0;
  for (const [a, b] of pairs) {
    if (signal && signal.aborted) throw new Error('stopped');
    n += 1;
    onProgress(`Head to head ${n} of ${pairs.length} — ${nameOf(a.c)} and ${nameOf(b.c)}, blind, both ways round…`);
    const d = await duelWithJudges(judges, moment.context, a.text, b.text, signal);
    if (!d) continue;
    await recordDuel({ x: a.c.id, y: b.c.id, xLabel: nameOf(a.c), yLabel: nameOf(b.c), winner: d.winner, why: d.why, duelKey: runId + ':' + a.c.id + ':' + b.c.id, run: runId });
    if (d.winner === 'x') { a.win += 1; b.loss += 1; } else if (d.winner === 'y') { b.win += 1; a.loss += 1; } else { a.tie += 1; b.tie += 1; }
  }
  const results = pages.map((p) => ({ id: p.c.id, name: nameOf(p.c), model: p.c.model || '', text: p.text, failed: p.failed || '', overall: p.grade ? p.grade.overall : null, scores: p.grade ? p.grade.scores : {}, win: p.win || 0, loss: p.loss || 0, tie: p.tie || 0 }))
    .sort((p, q) => ((q.overall ?? -1) - (p.overall ?? -1)) || ((q.win - q.loss) - (p.win - p.loss)));
  const run = { runId, at: Date.now(), story: moment.story, pageNumber: moment.pageNumber, judges: judges.map(nameOf), results };
  await db.settings.set('benchLastRun', run);
  return run;
}
