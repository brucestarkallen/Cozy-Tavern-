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
import { fingerprint36 } from '../engine/fingerprint.js'; /* M575 */
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
const hashOf = (t) => fingerprint36(t);

/* M681: the plans a page rewritten in place had laid out, kept aside (out of every telling) until that page is read again */
const heldOf = (h) => Object.fromEntries(Object.entries(h && typeof h === 'object' ? h : {}).filter(([k, v]) => /^\d+$/.test(k) && Array.isArray(v)));
const heldBelow = (h, n) => Object.fromEntries(Object.entries(heldOf(h)).filter(([k]) => Number(k) < n));
export async function loadPlansBook(storyId) {
  const b = await db.settings.get(PLANS_KEY(storyId));
  return b && typeof b === 'object' && Array.isArray(b.plans)
    ? { plans: b.plans, readTo: Number.isFinite(b.readTo) ? b.readTo : -1, readHash: typeof b.readHash === 'string' ? b.readHash : '', again: Array.isArray(b.again) ? b.again.filter((k) => Number.isInteger(k) && k >= 0) : [], held: heldOf(b.held) }
    : { plans: [], readTo: -1, readHash: '', again: [], held: {} };
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
/* M654: a part's number as a model writes it — "part 2", "#3", "2." are 2, 3 and 2. With Number() they were nothing: a
 * step the worker reported done as "part 2" stayed open, and the storyteller went on being told it was still to come. */
function countOf(v) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  const m = v.match(/\d+/);
  return m ? Number(m[0]) : NaN;
}
export function readPlansAnswer(raw) {
  const o = parseFirstObject(typeof raw === 'string' ? raw : (raw && raw.text) || '', (x) => Array.isArray(x.new));
  if (!o) return null;
  const part = (x) => (x && typeof x === 'object' && clip(x.who, 120) && clip(x.does, 600) ? { who: clip(x.who, 120), does: clip(x.does, 600), when: clip(x.when, 300), done: false } : null);
  const fresh = o.new.map((p) => (p && typeof p === 'object' ? {
    title: clip(p.title, 160), by: clip(p.by, 120), goal: clip(p.goal, 400), page: Number.isInteger(countOf(p.page)) ? countOf(p.page) : null,
    parts: (Array.isArray(p.parts) ? p.parts : []).map(part).filter(Boolean).slice(0, 16),
    words: (Array.isArray(p.words) ? p.words : []).map((w) => clip(w, 200)).filter(Boolean).slice(0, 6),
  } : null)).filter((p) => p && p.title && p.parts.length);
  const progress = (Array.isArray(o.progress) ? o.progress : []).map((x) => (x && typeof x === 'object' && clip(x.title, 160) ? {
    title: clip(x.title, 160),
    done: (Array.isArray(x.done) ? x.done : []).map(countOf).filter((n) => Number.isInteger(n) && n >= 1),
    changed: (Array.isArray(x.changed) ? x.changed : []).filter((c) => c && Number.isInteger(countOf(c.part))).map((c) => ({ part: countOf(c.part), who: clip(c.who, 120), does: clip(c.does, 600), when: clip(c.when, 300) })),
  } : null)).filter(Boolean);
  const closed = (Array.isArray(o.closed) ? o.closed : []).map((x) => (x && typeof x === 'object' && clip(x.title, 160) ? {
    title: clip(x.title, 160), how: /drop|abandon|overtak|call(?:ed)? off/i.test(String(x.how || '')) ? 'dropped' : 'done', outcome: clip(x.outcome, 400),
  } : null)).filter(Boolean);
  return { fresh, progress, closed };
}

/* the book with the answer written in: a plan laid out again is the newer telling (never a second copy), parts carried
 * out are marked, a plan ended leaves the standing ones and keeps its outcome */
export function applyPlansAnswer(book, answer, { from = null, to = null, at = Date.now(), again = false } = {}) {
  const plans = (book && Array.isArray(book.plans) ? book.plans : []).map((p) => ({ ...p, parts: (p.parts || []).map((x) => ({ ...x })), words: [...(p.words || [])] }));
  const standing = (title) => plans.find((p) => p.status === 'standing' && titleKey(p.title) === titleKey(title));
  for (const p of answer.fresh) {
    const page = Number.isInteger(p.page) && p.page >= 1 && (from == null || (p.page - 1 >= from && p.page - 1 <= to)) ? p.page - 1 : from;
    const had = standing(p.title);
    const fields = { title: p.title, by: p.by, goal: p.goal, parts: p.parts, words: p.words };
    /* M681: a page read AGAIN (rewritten in place) restates its own plan — the parts later pages carried out stay carried
     * out, and the plan's last page stays the latest that touched it */
    if (had && again) { const doneWas = (had.parts || []).map((x) => x && x.done); Object.assign(had, fields, { to: Math.max(Number(had.to) || 0, Number(page) || 0) }); had.parts = (had.parts || []).map((x, i) => (doneWas[i] ? { ...x, done: true } : x)); }
    else if (had) Object.assign(had, fields, { to: page });
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
/* M608: what the pages from `cut` on said is taken back — a plan laid out on them goes, one they closed stands again. Used
 * for pages taken back AND for a page rewritten in place (Try again, an edit, a re-ink): a plan the replaced words laid
 * out stood on beside the new words' own, a plan from a timeline that never happened. */
export function plansTakenBackFrom(plans, cut) {
  return (Array.isArray(plans) ? plans : []).filter((p) => !(Number.isFinite(p.from) && p.from >= cut))
    .map((p) => (Number.isFinite(p.closedAt) && p.closedAt >= cut ? (({ outcome: _o, closedAt: _c, ...rest }) => ({ ...rest, status: 'standing' }))(p) : p));
}
export async function runPlans({ connection, storyId, pages, mc = '', signal, callLLM = callWorker } = {}) {
  if (!connection || !storyId) return { wrote: false, why: 'no connection' };
  let book = await loadPlansBook(storyId);
  const list = (Array.isArray(pages) ? pages : []).filter((p) => p && typeof p.text === 'string');
  /* M527: PAGES TAKEN BACK. The book was read to a page that no longer stands (a rewind, a deleted page): a plan born on
   * those pages goes, one they closed stands again, and reading goes on from the page that stands last. */
  if (book.readTo >= list.length) {
    const plans = plansTakenBackFrom(book.plans, list.length);
    const last = list[list.length - 1];
    book = { plans, readTo: list.length - 1, readHash: hashOf(last ? last.text : ''), again: (book.again || []).filter((k) => k < list.length), held: heldBelow(book.held, list.length) }; /* M681: a page still owed its second reading stays owed */
    await db.settings.set(PLANS_KEY(storyId), book);
  }
  /* M681 — A PAGE REWRITTEN IN PLACE IS READ AGAIN ALONE (the books audit's B6, made to happen on m680-001): a typo fixed on
   * page 50 of 100 let go of every plan laid out from page 50 on and sent the reading back to page 50 — and the reading
   * keeps only the newest 120,000 characters of what it is handed, so the plans of the pages it cut were gone for good. The
   * pages after the one rewritten did not change: only what THAT page said is read again. The moment it is rewritten
   * (pageRewritten) the plans it laid out are set aside — out of every telling — and the ones it closed stand open; read
   * again, a plan its new words still lay out (or carry on, or close) comes back with what later pages carried out, one they
   * no longer say is gone. Reading then goes on from where it stood. */
  let readAgain = 0;
  for (const k of [...new Set(book.again || [])].sort((a, b) => a - b)) {
    const pg = list[k];
    const held = (book.held || {})[k] || [];
    const done = () => { const h = { ...(book.held || {}) }; delete h[k]; return { again: (book.again || []).filter((x) => x !== k), held: h }; };
    if (!pg || !pg.text.trim() || k > book.readTo) { book = { ...book, ...done() }; continue; } /* gone, empty, or not read yet: nothing to read again (a page not read yet is read in its turn) */
    const plans = book.plans || [];
    const askK = plansAsk({ standing: standingPlans({ plans: [...plans, ...held] }), pages: [pg], mc });
    let readK = null;
    for (let tries = 0; tries < PLANS_TRIES && !readK; tries += 1) readK = readPlansAnswer(await callLLM(connection, { system: askK.system, user: askK.user, maxTokens: PLANS_MAX_TOKENS, signal }));
    if (!readK) break; /* the page stays owed (book.again) and is read again next time; the reading goes on meanwhile */
    const said = new Set([...readK.fresh, ...readK.progress, ...readK.closed].map((f) => titleKey(f.title)));
    const back = held.filter((p) => said.has(titleKey(p.title)));
    const next = applyPlansAnswer({ plans: [...plans, ...back] }, readK, { from: k, to: k, again: true });
    book = { ...book, plans: next.plans, ...done() };
    await db.settings.set(PLANS_KEY(storyId), book);
    readAgain += 1;
  }
  let start = book.readTo >= 0 ? book.readTo + 1 : Math.max(0, list.length - CATCH_UP_PAGES);
  if (book.readTo >= 0 && list[book.readTo] && hashOf(list[book.readTo].text) !== book.readHash) { start = book.readTo; book = { ...book, plans: plansTakenBackFrom(book.plans, start) }; } /* rewritten since read — M608: what it said goes with it */
  let slice = list.slice(Math.min(start, list.length)).filter((p) => p.text.trim());
  if (!slice.length) return readAgain ? { wrote: true, fresh: 0, progress: 0, closed: 0, readAgain } : { wrote: false, why: 'nothing new to read' };
  while (slice.length > 1 && slice.reduce((n, p) => n + p.text.length, 0) > PAGES_MAX_CHARS) slice = slice.slice(1);
  const ask = plansAsk({ standing: standingPlans(book), pages: slice, mc });
  let user = ask.user;
  for (let tries = 0; tries < PLANS_TRIES; tries += 1) {
    const answer = await callLLM(connection, { system: ask.system, user, maxTokens: PLANS_MAX_TOKENS, signal });
    const read = readPlansAnswer(answer);
    if (read) {
      const next = applyPlansAnswer(book, read, { from: slice[0].n - 1, to: slice[slice.length - 1].n - 1 });
      const last = list[list.length - 1];
      await db.settings.set(PLANS_KEY(storyId), { ...next, readTo: list.length - 1, readHash: hashOf(last ? last.text : ''), again: book.again || [], held: book.held || {} });
      return { wrote: true, fresh: read.fresh.length, progress: read.progress.length, closed: read.closed.length };
    }
    user = ask.user + '\n\nYour last answer was not the JSON asked for. Answer with {"new":[…],"progress":[…],"closed":[…]} only.';
  }
  return { wrote: false, why: 'its answer could not be used' };
}

/* M681 — A PAGE THAT LEAVES THE STORY, OR COMES BACK TO IT (the books audit's B2). The book counts pages as the tale shows
 * them (plansNext: the visible pages, in order): every plan's from/to/closedAt, the reading mark and the pages owed a second
 * reading are those numbers. A page let go in the middle, or folded away by the housekeeper ("Fold this page away"), moved
 * every page after it down one and the book never knew: the next reading saw its mark past the end, took back the plans
 * of the page that had been newest as if it were gone and never read it again (they were lost for good), while the plans
 * the page that went had laid out stood on. A page brought back moved every page after it up one, and was never read.
 * Now the book moves with the pages: what the page that goes said is taken back (a plan it laid out goes, one it closed
 * stands open again) and everything after it moves down one; a page that comes back moves everything from it up one and,
 * where the reading had passed it, is read again alone (book.again). */
export async function pageLeft(storyId, pageIndex) {
  if (!storyId || !Number.isInteger(pageIndex) || pageIndex < 0) return;
  const book = await loadPlansBook(storyId);
  if (book.readTo < pageIndex) return; /* not read yet: nothing of it, or after it, is in the book */
  const k = pageIndex;
  const down = (n) => (Number.isFinite(n) && n > k ? n - 1 : n);
  const plans = (book.plans || []).filter((p) => !(Number.isFinite(p.from) && p.from === k))
    .map((p) => (Number.isFinite(p.closedAt) && p.closedAt === k ? (({ outcome: _o, closedAt: _c, ...rest }) => ({ ...rest, status: 'standing' }))(p) : p))
    .map((p) => { const from = down(p.from); const out = { ...p, from, to: Number.isFinite(p.to) && p.to === k ? Math.max(Number.isFinite(from) ? from : 0, k - 1) : down(p.to) }; if (Number.isFinite(p.closedAt)) out.closedAt = down(p.closedAt); return out; });
  const held = Object.fromEntries(Object.entries(heldOf(book.held)).filter(([key]) => Number(key) !== k).map(([key, v]) => [String(down(Number(key))), v]));
  const again = [...new Set((book.again || []).filter((x) => x !== k).map(down))];
  /* the newest page read went: the mark stays where it was, and the reading settles it as it always has — past the end
   * (the newest page of the tale went) it comes back to the page that stands last; on a page it never read (one that
   * moved down into its place), that page is read */
  await db.settings.set(PLANS_KEY(storyId), { ...book, plans, held, again, readTo: k === book.readTo ? book.readTo : book.readTo - 1 });
}
export async function pageCameBack(storyId, pageIndex) {
  if (!storyId || !Number.isInteger(pageIndex) || pageIndex < 0) return;
  const book = await loadPlansBook(storyId);
  if (book.readTo < pageIndex) return; /* the reading has not reached it: it is read in its turn */
  const k = pageIndex;
  const up = (n) => (Number.isFinite(n) && n >= k ? n + 1 : n);
  const plans = (book.plans || []).map((p) => { const out = { ...p, from: up(p.from), to: up(p.to) }; if (Number.isFinite(p.closedAt)) out.closedAt = up(p.closedAt); return out; });
  const held = Object.fromEntries(Object.entries(heldOf(book.held)).map(([key, v]) => [String(up(Number(key))), v]));
  const again = [...new Set([...(book.again || []).map(up), k])];
  await db.settings.set(PLANS_KEY(storyId), { ...book, plans, held, again, readTo: book.readTo + 1 });
}

/* M528: A PAGE REWRITTEN BY HAND IS READ AGAIN. The keeper checked only the last page it had read; an edited earlier page —
 * where a plan was laid out, carried out or dropped — was never read again. Its reading goes back to that page. */
export async function pageRewritten(storyId, pageIndex) {
  if (!storyId || !Number.isInteger(pageIndex) || pageIndex < 0) return;
  const book = await loadPlansBook(storyId);
  if (book.readTo < pageIndex) return; /* not read yet — it will be */
  /* the newest page read: what it said is taken back and it is read again (M608) — no page after it is touched */
  if (pageIndex === book.readTo) { await db.settings.set(PLANS_KEY(storyId), { ...book, plans: plansTakenBackFrom(book.plans, pageIndex), readTo: pageIndex - 1, readHash: '' }); return; }
  /* M681 (B6): an older page — its own plans set aside and the ones it closed open again, now; it is read again alone */
  const k = pageIndex;
  const bornHere = (p) => p && p.status === 'standing' && Number.isFinite(p.from) && p.from === k;
  const reopened = (book.plans || []).map((p) => (Number.isFinite(p.closedAt) && p.closedAt === k ? (({ outcome: _o, closedAt: _c, ...rest }) => ({ ...rest, status: 'standing' }))(p) : p));
  const plans = reopened.filter((p) => !bornHere(p));
  const held = { ...(book.held || {}), [k]: [...(((book.held || {})[k]) || []), ...reopened.filter(bornHere)] };
  await db.settings.set(PLANS_KEY(storyId), { ...book, plans, held, again: [...new Set([...(book.again || []), k])] });
}

