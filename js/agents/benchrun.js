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
        sentId: pick.m.receipt.sentId, /* M634: how a kept run finds its page again */
        pageNumber: told.indexOf(pick) + 1,
        request,
        context: { before: before ? pageText(before) : '', move: move ? pageText(move) : '', notes },
        original: { writer: writerKey(pick.m.receipt), label: pick.m.receipt.label || pick.m.receipt.model || '', text: pageText(pick.m) },
      };
    }
  }
  return null;
}

export async function writeWith(connection, request, signal, onStream = () => {}) {
  const provider = createProvider(connection);
  let prose = 0, thought = 0;
  const r = await provider.streamChat({ systemBlocks: request.systemBlocks, messages: request.messages, signal, onToken({ channel, text } = {}) {
    /* M634: its progress, as it comes — thinking first for a model that thinks, then the page's words */
    if (channel === 'thinking') thought += String(text || '').length; else if (channel === 'prose') prose += String(text || '').length;
    onStream({ prose, thought });
  } });
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

/* M634: HIS: "I waited five minutes on a four-storyteller run — how do I know it is progressing? And if I stop, can it
 * continue, or does everything restart?" The run said one line while all four wrote and nothing more until the slowest
 * was done (a thinking model on a long story can take minutes; a stalled one, forever), and a Stop let everything go.
 * Now: each storyteller's own line, live — thinking, writing (how much so far), done, failed or out of time — and the
 * judging step by step; a storyteller (or a judge) that runs past its time is let go and the run goes on with the rest;
 * and the run is KEPT after every step (benchRunState: the page, every page written, every grade, every head to head),
 * so a stopped or interrupted run CONTINUES where it stood — only what is missing is asked again. */
export const RUN_STATE = 'benchRunState';
export const WRITE_LIMIT_MS = 8 * 60000;  /* a storyteller writing one page of a long story */
export const JUDGE_LIMIT_MS = 3 * 60000;  /* a judge's one reading */

/* a signal that ends with the run's own, or when its time is up */
export function limited(signal, ms) {
  const ctl = new AbortController();
  const stop = () => ctl.abort(signal && signal.reason ? signal.reason : new Error('stopped'));
  if (signal) { if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true }); }
  const timer = setTimeout(() => ctl.abort(new Error('out of time')), ms);
  return { signal: ctl.signal, done: () => { clearTimeout(timer); if (signal) signal.removeEventListener('abort', stop); }, timedOut: () => ctl.signal.aborted && !(signal && signal.aborted) };
}
const saveRun = (state) => db.settings.set(RUN_STATE, state);
export async function loadRunState() { const s = await db.settings.get(RUN_STATE); return s && typeof s === 'object' && s.runId ? s : null; }
export async function dropRunState() { await db.settings.delete(RUN_STATE); }

/* the moment a kept run stood on, found again by its page's kept request */
async function momentOf(state) {
  const story = await db.stories.get(state.storyId);
  const rec = await loadSent(state.sentId);
  const body = rec && Array.isArray(rec.requests) && rec.requests[0] && rec.requests[0].body;
  if (!story || !body) return null;
  return { story: { id: story.id, title: story.title || 'a tale' }, pageNumber: state.pageNumber, request: neutralRequest(body), context: state.context };
}

export async function runBenchmark({ candidates = [], judges = [], signal, onProgress = () => {}, onStatus = () => {}, rnd = Math.random, resume = false } = {}) {
  let state = resume ? await loadRunState() : null;
  let moment;
  if (state) {
    moment = await momentOf(state);
    if (!moment) { await dropRunState(); throw new Error('the page that run stood on is gone — start a new run'); }
  } else {
    const takers = candidates.filter(Boolean).slice(0, 4);
    if (!takers.length) throw new Error('choose at least one storyteller to test');
    if (!judges.length) throw new Error('no judge to grade with');
    onProgress('Finding a page of your stories to replay…');
    const picked = await pickMoment({ rnd });
    if (!picked) throw new Error('no page of yours has its request kept yet — write a page or two first');
    moment = picked;
    state = {
      runId: 'run' + Date.now().toString(36), at: Date.now(), storyId: picked.story.id, title: picked.story.title, pageNumber: picked.pageNumber,
      sentId: picked.sentId, context: picked.context,
      takers: takers.map((c) => c.id), judges: judges.map((c) => c.id), pages: {}, graded: {}, duels: {},
    };
    await saveRun(state);
  }
  const all = await db.connections.list();
  const takers = state.takers.map((id) => all.find((c) => c.id === id)).filter(Boolean);
  const judgeConns = state.judges.map((id) => all.find((c) => c.id === id)).filter(Boolean);
  if (!judgeConns.length) throw new Error('none of the run\u2019s judges is a connection any more');
  const status = new Map(takers.map((c) => [c.id, state.pages[c.id] ? { name: nameOf(c), step: state.pages[c.id].text ? 'written' : 'failed', note: state.pages[c.id].failed || '' } : { name: nameOf(c), step: 'waiting' }]));
  const tellStatus = () => onStatus([...status.entries()].map(([id, v]) => ({ id, ...v })));
  tellStatus();
  /* 1. the pages — only the ones not written yet, all at once */
  const toWrite = takers.filter((c) => !state.pages[c.id]);
  if (toWrite.length) {
    onProgress(`“${moment.story.title}”, page ${moment.pageNumber} — ${toWrite.length === 1 ? 'one storyteller is' : toWrite.length + ' storytellers are'} writing it…`);
    await Promise.all(toWrite.map(async (c) => {
      const started = Date.now();
      status.set(c.id, { name: nameOf(c), step: 'asking', since: started }); tellStatus();
      const lim = limited(signal, WRITE_LIMIT_MS);
      try {
        const text = await writeWith(c, moment.request, lim.signal, ({ prose, thought }) => {
          status.set(c.id, { name: nameOf(c), step: prose ? 'writing' : 'thinking', since: started, prose, thought }); tellStatus();
        });
        state.pages[c.id] = text ? { text } : { text: '', failed: 'it answered with no page' };
      } catch (err) {
        if (signal && signal.aborted) return; /* stopped: nothing kept for it, it is asked again on Continue */
        state.pages[c.id] = { text: '', failed: lim.timedOut() ? 'out of time after ' + Math.round(WRITE_LIMIT_MS / 60000) + ' minutes' : String((err && err.message) || err) };
      } finally { lim.done(); }
      const kept = state.pages[c.id];
      status.set(c.id, { name: nameOf(c), step: kept ? (kept.text ? 'written' : 'failed') : 'waiting', note: kept && kept.failed ? kept.failed : '', took: Date.now() - started }); tellStatus();
      await saveRun(state);
    }));
  }
  if (signal && signal.aborted) throw new Error('stopped');
  /* 2. the grades — only the pages not graded yet */
  const written = takers.filter((c) => state.pages[c.id] && state.pages[c.id].text);
  let g = 0;
  for (const c of written) {
    g += 1;
    if (state.graded[c.id]) continue;
    if (signal && signal.aborted) throw new Error('stopped');
    onProgress(`Grading ${g} of ${written.length} — ${nameOf(c)}’s page, ${judgeConns.length === 1 ? 'one judge' : judgeConns.length + ' judges'}…`);
    status.set(c.id, { ...status.get(c.id), step: 'grading' }); tellStatus();
    const lim = limited(signal, JUDGE_LIMIT_MS);
    let grade = null;
    try { grade = await gradeWithJudges(judgeConns, moment.context, state.pages[c.id].text, lim.signal); } finally { lim.done(); }
    if (signal && signal.aborted) throw new Error('stopped');
    state.graded[c.id] = grade || { none: true };
    if (grade) await recordGrade({ writer: c.id, label: nameOf(c), model: c.model || '', storyId: moment.story.id, pageKey: state.runId + ':' + c.id, scores: grade.scores, overall: grade.overall, why: grade.why, run: state.runId });
    status.set(c.id, { ...status.get(c.id), step: grade ? 'graded' : 'not graded', overall: grade ? grade.overall : null }); tellStatus();
    await saveRun(state);
  }
  /* 3. head to head — only the pairs not judged yet */
  const pairs = [];
  for (let i = 0; i < written.length; i += 1) for (let j = i + 1; j < written.length; j += 1) pairs.push([written[i], written[j]]);
  let n = 0;
  for (const [a, b] of pairs) {
    n += 1;
    const key = a.id + ':' + b.id;
    if (state.duels[key]) continue;
    if (signal && signal.aborted) throw new Error('stopped');
    onProgress(`Head to head ${n} of ${pairs.length} — ${nameOf(a)} and ${nameOf(b)}, blind, both ways round…`);
    const lim = limited(signal, JUDGE_LIMIT_MS * 2);
    let d = null;
    try { d = await duelWithJudges(judgeConns, moment.context, state.pages[a.id].text, state.pages[b.id].text, lim.signal); } finally { lim.done(); }
    if (signal && signal.aborted) throw new Error('stopped');
    state.duels[key] = d ? { winner: d.winner } : { winner: 'none' };
    if (d) await recordDuel({ x: a.id, y: b.id, xLabel: nameOf(a), yLabel: nameOf(b), winner: d.winner, why: d.why, duelKey: state.runId + ':' + key, run: state.runId });
    await saveRun(state);
  }
  /* the result, the run let go */
  const results = takers.map((c) => {
    const page = state.pages[c.id] || {};
    const grade = state.graded[c.id] && !state.graded[c.id].none ? state.graded[c.id] : null;
    let win = 0, loss = 0, tie = 0;
    for (const [key, d] of Object.entries(state.duels)) {
      const [x, y] = key.split(':');
      if (x !== c.id && y !== c.id) continue;
      if (d.winner === 'tie') tie += 1; else if ((d.winner === 'x' && x === c.id) || (d.winner === 'y' && y === c.id)) win += 1; else if (d.winner === 'x' || d.winner === 'y') loss += 1;
    }
    return { id: c.id, name: nameOf(c), model: c.model || '', text: page.text || '', failed: page.failed || '', overall: grade ? grade.overall : null, scores: grade ? grade.scores : {}, win, loss, tie };
  }).sort((p, q) => ((q.overall ?? -1) - (p.overall ?? -1)) || ((q.win - q.loss) - (p.win - p.loss)));
  const run = { runId: state.runId, at: Date.now(), story: moment.story, pageNumber: moment.pageNumber, judges: judgeConns.map(nameOf), results };
  await db.settings.set('benchLastRun', run);
  await dropRunState();
  return run;
}
