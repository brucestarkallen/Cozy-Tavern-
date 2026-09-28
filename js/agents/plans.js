/* Cozy Tavern — agents/plans.js (M510-22)
 * THE PLANS KEEPER — his question: "how does it get this kind of detailed information?" — a battle plan laid out on pages
 * 1–5: Artos commands the front line, fights, then fakes a retreat screaming "retreat, protect the gold convoy"; Arsif
 * takes the fake gold convoy into the forest and abandons it; Daros burns the forest. A summary keeps the history of a
 * story, told shorter; a plan is not history — it is what is still to happen, and every part of it matters until it has
 * happened. So a plan is written down the moment a page lays it out — who does what, when or on what signal, the exact
 * words — and kept WHOLE, never retold, until it is carried out or dropped; parts carried out are marked done. A small
 * storyteller reads every plan standing, word for word (assemble/planbook.js); the drawer shows them all.
 *
 * Reads the pages it has not read yet (on the first reading, the last CATCH_UP_PAGES — a plan laid out while another
 * model told the story is found too). Only while a small model tells the tale. An answer that cannot be used is asked
 * for once more, then let go WITHOUT moving on — the same pages are read again after the next page. A failure to reach
 * the model throws — the queue's retries are for that. */
import { db } from '../store.js';
import { callWorker } from './call.js';
import { parseFirstObject } from './jsonutil.js';
import { standingPlans } from '../assemble/planbook.js';

/* NOT 'plans:' — that key is the planning helper's (agents/planner.js, its per-page plans); sharing it overwrote them */
export const PLANS_KEY = (storyId) => 'standingPlans:' + storyId;
export const PLANS_TRIES = 2;
export const PLANS_MAX_TOKENS = 3000;
export const CATCH_UP_PAGES = 30;
export const PAGES_MAX_CHARS = 120000;
export const KEEP_FINISHED = 12;

const clip = (s, n) => { const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };
const titleKey = (t) => clip(t, 200).toLowerCase().replace(/^(?:the|a|an)\s+/, '').replace(/[^\p{L}\p{N} ]/gu, '').trim();
const hashOf = (t) => { let h = 5381; const s = String(t == null ? '' : t); for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

export async function loadPlansBook(storyId) {
  const b = await db.settings.get(PLANS_KEY(storyId));
  return b && typeof b === 'object' && Array.isArray(b.plans)
    ? { plans: b.plans, readTo: Number.isFinite(b.readTo) ? b.readTo : -1, readHash: typeof b.readHash === 'string' ? b.readHash : '' }
    : { plans: [], readTo: -1, readHash: '' };
}

export function plansAsk({ standing = [], pages = [], mc = '' } = {}) {
  const system = [
    'You keep the plans of a long collaborative story: every plan its characters lay out on the page — a battle plan, a heist, an ambush, a rescue, a scheme — written down whole and kept until it is carried out or dropped.',
    'A plan is laid out when a page says who will do what, in what order, or on what signal. A hope, a threat, or one person saying what they will do next is not a plan.',
    'Answer with JSON only: {"new":[…],"progress":[…],"closed":[…]}.',
    '"new" — each plan LAID OUT on these pages: {"title":"a short name for it","by":"whose plan","page":the page number where it is laid out,"goal":"what it is for","parts":[{"who":"NAME or the group","does":"what they do, as the page says it","when":"when, or on what signal"}],"words":["the exact words of a signal, a password or a cry, as the page gives them"]}. Keep every part and every detail the page gives — who, where, in what order, what to shout; one part per person or group; names as the page spells them; invent nothing.',
    '"progress" — when a page carries out or changes part of a plan standing below: {"title":"as it stands below","done":[the numbers of the parts now carried out],"changed":[{"part":N,"who":"…","does":"…","when":"…"}]}.',
    '"closed" — when a plan standing below is carried out in full, abandoned or overtaken: {"title":"as it stands below","how":"done" or "dropped","outcome":"what came of it, in one sentence"}.',
    'Empty arrays when these pages lay out, move or end no plan.',
  ].join('\n');
  const user = [
    mc ? 'The main character (the writer plays him): ' + mc : '',
    'The plans standing:\n' + (standing.length
      ? standing.map((p) => JSON.stringify({ title: p.title, by: p.by, goal: p.goal, parts: (p.parts || []).map((x, i) => ({ part: i + 1, who: x.who, does: x.does, when: x.when, done: Boolean(x.done) })), words: p.words || [] })).join('\n')
      : '(none)'),
    'The pages to read, in order:\n' + pages.map((p) => 'Page ' + p.n + ' (' + p.who + '):\n' + p.text).join('\n\n'),
  ].filter(Boolean).join('\n\n');
  return { system, user };
}

/* the answer, read and bounded; null when it is not the answer asked for (no "new" list) */
export function readPlansAnswer(raw) {
  const o = parseFirstObject(typeof raw === 'string' ? raw : (raw && raw.text) || '', (x) => Array.isArray(x.new));
  if (!o) return null;
  const part = (x) => (x && typeof x === 'object' && clip(x.who, 120) && clip(x.does, 600) ? { who: clip(x.who, 120), does: clip(x.does, 600), when: clip(x.when, 300), done: false } : null);
  const fresh = o.new.map((p) => (p && typeof p === 'object' ? {
    title: clip(p.title, 160), by: clip(p.by, 120), goal: clip(p.goal, 400), page: Number.isInteger(Number(p.page)) ? Number(p.page) : null,
    parts: (Array.isArray(p.parts) ? p.parts : []).map(part).filter(Boolean).slice(0, 16),
    words: (Array.isArray(p.words) ? p.words : []).map((w) => clip(w, 200)).filter(Boolean).slice(0, 6),
  } : null)).filter((p) => p && p.title && p.parts.length);
  const progress = (Array.isArray(o.progress) ? o.progress : []).map((x) => (x && typeof x === 'object' && clip(x.title, 160) ? {
    title: clip(x.title, 160),
    done: (Array.isArray(x.done) ? x.done : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1),
    changed: (Array.isArray(x.changed) ? x.changed : []).filter((c) => c && Number.isInteger(Number(c.part))).map((c) => ({ part: Number(c.part), who: clip(c.who, 120), does: clip(c.does, 600), when: clip(c.when, 300) })),
  } : null)).filter(Boolean);
  const closed = (Array.isArray(o.closed) ? o.closed : []).map((x) => (x && typeof x === 'object' && clip(x.title, 160) ? {
    title: clip(x.title, 160), how: /drop|abandon|overtak|call(?:ed)? off/i.test(String(x.how || '')) ? 'dropped' : 'done', outcome: clip(x.outcome, 400),
  } : null)).filter(Boolean);
  return { fresh, progress, closed };
}

/* the book with the answer written in: a plan laid out again is the newer telling (never a second copy), parts carried
 * out are marked, a plan ended leaves the standing ones and keeps its outcome */
export function applyPlansAnswer(book, answer, { from = null, to = null, at = Date.now() } = {}) {
  const plans = (book && Array.isArray(book.plans) ? book.plans : []).map((p) => ({ ...p, parts: (p.parts || []).map((x) => ({ ...x })), words: [...(p.words || [])] }));
  const standing = (title) => plans.find((p) => p.status === 'standing' && titleKey(p.title) === titleKey(title));
  for (const p of answer.fresh) {
    const page = Number.isInteger(p.page) && p.page >= 1 && (from == null || (p.page - 1 >= from && p.page - 1 <= to)) ? p.page - 1 : from;
    const had = standing(p.title);
    const fields = { title: p.title, by: p.by, goal: p.goal, parts: p.parts, words: p.words };
    if (had) Object.assign(had, fields, { to: page });
    else plans.push({ ...fields, status: 'standing', from: page, to: page, at });
  }
  for (const g of answer.progress) {
    const p = standing(g.title);
    if (!p) continue;
    for (const n of g.done) if (p.parts[n - 1]) p.parts[n - 1].done = true;
    for (const c of g.changed) if (p.parts[c.part - 1]) Object.assign(p.parts[c.part - 1], c.who ? { who: c.who } : {}, c.does ? { does: c.does } : {}, c.when ? { when: c.when } : {});
  }
  for (const c of answer.closed) {
    const p = standing(c.title);
    if (p) Object.assign(p, { status: c.how, outcome: c.outcome, closedAt: to });
  }
  const finished = plans.filter((p) => p.status !== 'standing');
  const drop = new Set(finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED)));
  return { plans: plans.filter((p) => !drop.has(p)) };
}

/* one reading: the pages not read yet (a page since rewritten is read again) */
export async function runPlans({ connection, storyId, pages, mc = '', signal, callLLM = callWorker } = {}) {
  if (!connection || !storyId) return { wrote: false, why: 'no connection' };
  const book = await loadPlansBook(storyId);
  const list = (Array.isArray(pages) ? pages : []).filter((p) => p && typeof p.text === 'string');
  let start = book.readTo >= 0 ? book.readTo + 1 : Math.max(0, list.length - CATCH_UP_PAGES);
  if (book.readTo >= 0 && list[book.readTo] && hashOf(list[book.readTo].text) !== book.readHash) start = book.readTo; /* rewritten since read */
  let slice = list.slice(Math.min(start, list.length)).filter((p) => p.text.trim());
  if (!slice.length) return { wrote: false, why: 'nothing new to read' };
  while (slice.length > 1 && slice.reduce((n, p) => n + p.text.length, 0) > PAGES_MAX_CHARS) slice = slice.slice(1);
  const ask = plansAsk({ standing: standingPlans(book), pages: slice, mc });
  let user = ask.user;
  for (let tries = 0; tries < PLANS_TRIES; tries += 1) {
    const answer = await callLLM(connection, { system: ask.system, user, maxTokens: PLANS_MAX_TOKENS, signal });
    const read = readPlansAnswer(answer);
    if (read) {
      const next = applyPlansAnswer(book, read, { from: slice[0].n - 1, to: slice[slice.length - 1].n - 1 });
      const last = list[list.length - 1];
      await db.settings.set(PLANS_KEY(storyId), { ...next, readTo: list.length - 1, readHash: hashOf(last ? last.text : '') });
      return { wrote: true, fresh: read.fresh.length, progress: read.progress.length, closed: read.closed.length };
    }
    user = ask.user + '\n\nYour last answer was not the JSON asked for. Answer with {"new":[…],"progress":[…],"closed":[…]} only.';
  }
  return { wrote: false, why: 'its answer could not be used' };
}
