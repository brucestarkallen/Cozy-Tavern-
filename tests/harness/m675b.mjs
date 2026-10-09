/* Cozy Tavern — harness laws of M675, the second reading of the readers' slice: four faults a reviewer who had not written
 * the code found in what M675 itself had changed in the continuous audit (js/agents/continuous.js) and in the record's
 * cut (js/agents/memory.js recordFor). Each was made to happen here before it was cured:
 *   B1  a reading cut off by its leash was taken for a stop: nothing was learned, and the same stretch was asked for whole
 *       at every look, for good;
 *   B2  one transient failure of the wire (a 429, a 502, a dropped line) put the line on one page at a time — six more
 *       requests, and a line read in parts is never repaired;
 *   B3  "refused for its words three times" counted every failure, and said "3 times" whatever the count was;
 *   B4  the record before a stretch was cut by joining every line that was left, once for each line let go.
 * Every law here RUNS the reader: the app's own modules, a stubbed fetch, the real queue where a leash is in play; what
 * is asserted is what came back. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { emptyState, saveState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { enqueueWork, chainJob, stopWork } from '../../js/agents/queue.js';
import { forgetRelayCheck } from '../../js/providers/relay.js';
import { loadMemory, saveMemory, recordLinesBefore, recordFor, renderMemory, wholeRecord, recordWithPages, RECORD_HEADER } from '../../js/agents/memory.js';
import {
  auditStretch, auditProgress, stretchWords, forgetAuditTrouble, buildStretchMessages, nextStretch,
  beginReading, endReading, pauseContinuousAudit, UNREADABLE_TRIES,
} from '../../js/agents/continuous.js';

/* ---------- the fixtures (as tests/harness/m675.mjs has them) ---------- */
const CONN = { type: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'deepseek-chat', reasoning: { effort: 'off' } };
const sse = (pieces) => { const t = pieces.map((p) => 'data: ' + JSON.stringify(p) + '\n\n').join('') + 'data: [DONE]\n\n'; return { ok: true, status: 200, headers: new Headers(), body: new Response(t).body, text: async () => t }; };
const say = (text) => sse([{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]);
const refuse = (status, words) => ({ ok: false, status, headers: new Headers(), text: async () => JSON.stringify({ error: { message: words } }), json: async () => ({ error: { message: words } }) });
const bodyOf = (opts) => { const b = JSON.parse(opts.body); return { system: String((b.messages.find((m) => m.role === 'system') || {}).content || ''), user: String(b.messages.slice(-1)[0].content || '') }; };
/* a call that fails with nothing at all makes the provider ask the house whether it relays (providers/relay.js): a
 * request with no body is that question, and this house does not */
const noRelay = { ok: false, status: 404, headers: new Headers(), text: async () => '', json: async () => ({}) };
const withFetch = async (impl, fn) => { const prior = globalThis.fetch; globalThis.fetch = (url, opts) => (opts && typeof opts.body === 'string' ? impl(url, opts) : Promise.resolve(noRelay)); try { return await fn(); } finally { globalThis.fetch = prior; } };
const pg = (i, text) => ({ role: i % 2 ? 'assistant' : 'user', text });
const ledgerOf = () => ({ ...applyMutations({ ...emptyState() }, [
  { type: 'mc.set', name: 'Jovan' },
  { type: 'people.set', name: 'Rukia', field: 'core', text: 'a shinigami of the Thirteenth Division' },
  { type: 'people.set', name: 'Renji', field: 'core', text: 'a lieutenant, posted at the gate' },
]).state, page: 19 });
const SIX = [
  'I show Rukia the seal.',
  '[Thirteenth Division barracks — Monday | 09:10]\n\nJovan drew the seal of the Thirteenth from his coat. Rukia stared at it. "You carry the seal," she said. Renji was nowhere near; he had left for the gate at dawn.',
  'I ask her to keep it hidden.',
  'Rukia promised Jovan she would keep the seal hidden from the captains. Her grey eyes did not leave his.',
  'I thank her.',
  'Renji came back from the gate before noon and found them in the yard. He asked nothing.',
];
const THREE_LINES = () => [
  { id: 'a', span: [0, 5], text: 'Jovan showed Rukia the seal of the Thirteenth; Renji came back from the gate before noon.', level: 1, at: 1, whole: true },
  { id: 'b', span: [6, 11], text: 'Rukia swept the yard; nothing else moved.', level: 1, at: 2, whole: true },
  { id: 'c', span: [12, 17], text: 'Rukia swept the yard again.', level: 1, at: 3, whole: true },
];
async function auditTale(title, lines) {
  const st = await db.stories.create({ title: title + ' ' + Math.random() });
  for (let i = 0; i < 6; i += 1) await db.messages.append(st.id, pg(i, SIX[i]));
  for (let i = 6; i < 44; i += 1) await db.messages.append(st.id, pg(i, i % 2 ? 'The yard was quiet that hour, and Rukia swept it. Page ' + i + '.' : 'I wait. ' + i));
  await saveState(st.id, ledgerOf());
  await saveMemory(st.id, { window: 30, nodes: lines || THREE_LINES() });
  return st;
}
const CLEAN = '{"issues":[]}';
/* the pages a request asks about, as the request itself numbers them ("1-6", "2-2") */
const rangeOf = (opts) => (/THE PAGES \(pages (\d+)-(\d+)/.exec(bodyOf(opts).user) || []).slice(1, 3).join('-');
const lineOf = async (st, id) => (await loadMemory(st.id)).nodes.find((n) => n.id === id);
/* one look of the audit, called as the laws of M675-7 call it; what it did, in a word */
const lookAt = async (st, extra = {}) => {
  try {
    const r = await auditStretch({ connection: CONN, storyId: st.id, ...extra });
    return r ? (r.passedBy ? 'passed by ' : 'read ') + (r.from + 1) + '-' + (r.to + 1) + (r.lineMended ? ' (line repaired)' : '') : 'nothing';
  } catch (err) { return 'threw ' + (err.status || err.message); }
};
/* a provider asks a second time, by itself, after some refusals (providers/openai.js: a 400 once more without the usage
 * request) — what a LOOK asked for is said once, however many times the wire carried it */
const once = (list) => list.filter((x, i) => i === 0 || x !== list[i - 1]);

test('M675-B1 A READING CUT OFF BY ITS LEASH IS A FAILURE OF THAT STRETCH, NOT A STOP (the review of M675: in the app the reading’s own stop follows the job’s — and the audit took every such stop for “stepped aside”, the leash’s too: a stretch a slow model could not answer inside its leash was asked for whole at every look and before every page’s checkpoint, a full leash each time, and no later line was ever read): cut off twice, the same pages are asked for one at a time and the audit reads on to the end; a step aside for the storyteller and his own Stop are still no failure and are not counted; and a mender cut off by its leash is a mender that did not mend — the fault is noted and the reading kept, not asked for again', async () => {
  const prior = { leash: globalThis.__cozyLeashMs, aside: globalThis.__cozyAuditAsideMs };
  globalThis.__cozyLeashMs = 500; /* a minute and more in the house (agents/status.js) */
  delete globalThis.__cozyAuditAsideMs;
  forgetAuditTrouble();
  forgetRelayCheck(); /* a call that is cut off asks the house once whether it relays (providers/relay.js): asked afresh here — this house does not */
  const HUNG = { hung: true };
  /* nothing may hang a law: a look that has not settled long after its leash is said to be hung */
  const settled = (promise) => { let t = null; return Promise.race([promise, new Promise((r) => { t = setTimeout(() => r(HUNG), 4000); })]).finally(() => clearTimeout(t)); };
  const until = async (cond, what) => { for (let i = 0; i < 400; i += 1) { if (cond()) return; await new Promise((r) => setTimeout(r, 5)); } throw new Error('waited too long for ' + what); };
  /* a model that never answers: its call ends only when its signal does — and, as a real fetch does, with the signal's own reason */
  const never = (opts) => new Promise((resolve, reject) => {
    const s = opts.signal;
    const end = () => reject(s.reason !== undefined ? s.reason : Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
    if (s.aborted) end(); else s.addEventListener('abort', end, { once: true });
  });
  /* chat.js continuousStep, as far as a module without a screen allows: the reading's own stop (beginReading — which now
   * follows the job's signal itself), the job's hooks handed on, a step aside answered in silence, anything else thrown
   * to the queue */
  const step = (storyId, more) => async ({ signal, stale, renew } = {}) => {
    const own = beginReading(storyId, signal);
    try {
      const result = await auditStretch({ connection: CONN, storyId, signal: own.signal, stale, renew, ...(more ? more(own) : {}) });
      if (!result) return { silent: true };
      return { silent: false, detail: stretchWords(result), result };
    } catch (err) {
      if (own.signal.aborted && !(signal && signal.aborted)) return { silent: true }; /* stepped aside for the storyteller */
      throw err;
    } finally { endReading(storyId, own); }
  };
  /* the real queue, a job tried once — as continuousCatchUp and the page's chain send it */
  const look = (storyId, more) => settled(enqueueWork(storyId, { name: 'continuous', once: true, run: chainJob(step(storyId, more), () => false) }));
  try {
    /* 1. a stretch too slow for its leash: the six pages asked for together never answer; any page alone does */
    const st = await auditTale('a slow stretch');
    const asked = [];
    await withFetch((url, opts) => { const r = rangeOf(opts); asked.push(r); return r === '1-6' ? never(opts) : Promise.resolve(say(CLEAN)); }, async () => {
      const first = await look(st.id);
      assert(first !== HUNG, 'a reading that outruns its leash ENDS: the reading’s own stop follows the job’s (continuous.js beginReading)');
      eq(first.ok + ' | ' + first.why, 'false | outwaited', 'it ends as a reading that FAILED, said on the workers’ line — the house’s own next look is spaced by it');
      const second = await look(st.id);
      eq(second.ok + ' | ' + asked.join(' '), 'false | 1-6 1-6', 'cut off once, the same stretch is asked for whole once more — the provider may only have had a slow minute');
      const third = await look(st.id);
      eq((third.ok === true && !third.value.silent) + ' | ' + asked.join(' '), 'true | 1-6 1-6 1-1', 'cut off twice: a stretch too slow for its leash will not get faster — the same pages are asked for one at a time (they were asked for whole at every look, for good: 1-6 1-6 1-6 1-6)');
      for (let i = 0; i < 7; i += 1) await look(st.id);
      const end = auditProgress(await loadMemory(st.id), 44);
      eq(asked.join(' ') + ' | ' + end.done + ' of ' + end.folded, '1-6 1-6 1-1 2-2 3-3 4-4 5-5 6-6 7-12 13-18 | 18 of 18', 'and the audit reads on to the end of what is folded (no later line was ever read)');
    });
    /* 2. what is NOT a failure stays so, and is not counted: three steps aside and one Stop of his, then ONE leash —
     * and the stretch is still asked for whole */
    const st2 = await auditTale('stepped aside, and stopped');
    const asked2 = [];
    let slow = true;
    await withFetch((url, opts) => { const r = rangeOf(opts); asked2.push(r); return slow && r === '1-6' ? never(opts) : Promise.resolve(say(CLEAN)); }, async () => {
      for (let i = 1; i <= 3; i += 1) {
        const going = look(st2.id);
        await until(() => asked2.length === i, 'the reading to be in flight');
        eq(pauseContinuousAudit(st2.id), true, 'fixture: a reading in flight is let go');
        const out = await going;
        eq(out.ok + ' | ' + Boolean(out.value && out.value.silent), 'true | true', 'a step aside for the storyteller is no failure, and says nothing');
      }
      const going = look(st2.id);
      await until(() => asked2.length === 4, 'the reading to be in flight');
      stopWork(st2.id);
      eq((await going).stopped, true, 'his own Stop is a stop');
      const cut = await look(st2.id);
      eq(cut.ok, false, 'fixture: one reading cut off by its leash');
      slow = false;
      const whole = await look(st2.id);
      eq((whole.value && whole.value.result ? 'read ' + (whole.value.result.from + 1) + '-' + (whole.value.result.to + 1) : 'nothing') + ' | ' + asked2.join(' '), 'read 1-6 | 1-6 1-6 1-6 1-6 1-6 1-6', 'three steps aside and a Stop counted for nothing: after ONE leash the stretch is still asked for whole — and read');
    });
    /* 3. the reading's second call, the mender: one that never answers is cut off by the same leash. It is a mender that
     * did not mend (as one that failed any other way is): the fault is noted on the page, the reading is kept, the
     * line is marked — it was thrown as a stop, nothing was written, and the same reading AND the same mend were
     * asked for again at every look */
    const st3 = await auditTale('a slow mender');
    const asked3 = [];
    const notes = [];
    let mendsAsked = 0;
    const fault = JSON.stringify({ issues: [{ what: 'Page 2 has Renji leave at dawn, though he had been at the gate since the night before.', pages: true, page: 2, fix: 'Renji had been at the gate since the night before.' }] });
    const slowMender = (own) => ({
      mend: () => { mendsAsked += 1; return never({ signal: own.signal }); },
      note: async (id, finding) => { notes.push(finding.words); },
    });
    await withFetch((url, opts) => { const r = rangeOf(opts); asked3.push(r); return Promise.resolve(say(r === '1-6' ? fault : CLEAN)); }, async () => {
      const out = await look(st3.id, slowMender);
      assert(out !== HUNG, 'a mender that never answers is cut off by the leash');
      const r = out.value && out.value.result;
      eq(out.ok + ' | ' + Boolean(r) + ' | ' + (r && r.mendedPages) + ' | ' + (r && r.faults.length) + ' | ' + (r && r.sealed), 'true | true | 0 | 1 | true', 'the reading is kept: no page mended, the fault noted, the line marked (it was a failed reading with nothing written)');
      assert(notes.length === 1 && /Renji had been at the gate since the night before/.test(notes[0]), 'the fault is left on the page, where the second reader’s notes are: ' + JSON.stringify(notes));
      eq((await lineOf(st3, 'a')).audited, 6, 'the line is read');
      const next = await look(st3.id, slowMender);
      eq((next.value && next.value.result ? 'read ' + (next.value.result.from + 1) + '-' + (next.value.result.to + 1) : 'nothing') + ' | ' + asked3.join(' ') + ' | ' + mendsAsked, 'read 7-12 | 1-6 7-12 | 1', 'and the next look reads the next line: neither the reading nor the mend is asked for again');
    });
  } finally {
    if (prior.leash === undefined) delete globalThis.__cozyLeashMs; else globalThis.__cozyLeashMs = prior.leash;
    if (prior.aside !== undefined) globalThis.__cozyAuditAsideMs = prior.aside;
    forgetAuditTrouble();
    forgetRelayCheck();
  }
});

test('M675-B2 ONE TRANSIENT FAILURE DOES NOT COST A LINE ITS REPAIR (the review of M675: any failure of a stretch of several pages — one 429 was enough — put its line on one page at a time: seven requests for one, and a line read in parts is never repaired, so it was sealed “read” with its wrong fact): a stretch the wire only stumbled on (429, 5xx, a dropped line) is asked for WHOLE again at the next look, and its line is repaired; three such failures in a row and the pages are asked for one at a time; a whole reading that succeeds clears the count — an answer that cannot be used is not one; a stretch refused for its words is asked for one page at a time at once, as before', async () => {
  forgetAuditTrouble();
  forgetRelayCheck(); /* a dropped line asks the house once whether it relays: asked afresh here, and again by whoever comes after */
  /* the line names the seal wrongly; the pages say "of the Thirteenth" */
  const WRONG = () => [
    { id: 'a', span: [0, 5], text: 'Jovan showed Rukia the seal of the Tenth; Renji came back from the gate before noon.', level: 1, at: 1, whole: true },
    { id: 'b', span: [6, 11], text: 'Rukia swept the yard; nothing else moved.', level: 1, at: 2, whole: true },
  ];
  const FIX = JSON.stringify({ issues: [{ what: 'The line names the seal of the Tenth; the pages say the Thirteenth.', record: { fixes: [{ from: 'seal of the Tenth', to: 'seal of the Thirteenth' }] } }] });
  try {
    /* 1. one 429, then the provider answers: two requests, and the line is repaired */
    for (const stumble of [() => refuse(429, 'Rate limit reached, slow down'), () => { throw new TypeError('Failed to fetch'); }, () => refuse(502, 'bad gateway')]) {
      forgetAuditTrouble();
      const st = await auditTale('one stumble', WRONG());
      const asked = [];
      let first = true;
      await withFetch(async (url, opts) => { asked.push(rangeOf(opts)); if (first) { first = false; return stumble(); } return say(FIX); }, async () => {
        const one = await lookAt(st);
        assert(/^threw /.test(one), 'fixture: the first request fails at the wire: ' + one);
        eq(await lookAt(st), 'read 1-6 (line repaired)', 'after one failure that says nothing of the pages (' + one + ') the same stretch is asked for WHOLE again — and the line is repaired (it was asked for one page at a time: read 1-1, and never repaired)');
        const a = await lineOf(st, 'a');
        eq(asked.join(' ') + ' | ' + a.text + ' | ' + a.audited, '1-6 1-6 | Jovan showed Rukia the seal of the Thirteenth; Renji came back from the gate before noon. | 6', 'two requests (it was seven), the wrong fact put right, the line read');
      });
    }
    /* 2. three failures in a row: the whole cannot be had — one page at a time */
    forgetAuditTrouble();
    const st2 = await auditTale('three in a row', WRONG());
    const asked2 = [];
    await withFetch(async (url, opts) => { const r = rangeOf(opts); asked2.push(r); return r === '1-6' ? refuse(502, 'bad gateway') : say(CLEAN); }, async () => {
      eq([await lookAt(st2), await lookAt(st2), await lookAt(st2)].join(' | ') + ' | ' + asked2.join(' '), 'threw 502 | threw 502 | threw 502 | 1-6 1-6 1-6', 'failed twice, it is still asked for whole a third time');
      eq((await lookAt(st2)) + ' | ' + asked2.join(' '), 'read 1-1 | 1-6 1-6 1-6 1-1', 'failed three times in a row: the same pages are asked for one at a time, and the audit goes on');
    });
    /* 3. a whole reading that succeeds clears the count: a line of twelve pages is read in two stretches */
    forgetAuditTrouble();
    const st3 = await auditTale('the count is cleared', [{ id: 'w', span: [0, 11], text: 'Jovan showed Rukia the seal; Rukia swept the yard.', level: 1, at: 1, whole: true }]);
    const asked3 = [];
    const plan = ['fail', 'fail', 'ok', 'fail', 'fail', 'ok'];
    await withFetch(async (url, opts) => { asked3.push(rangeOf(opts)); return plan.shift() === 'fail' ? refuse(503, 'overloaded') : say(CLEAN); }, async () => {
      const looks = [];
      for (let i = 0; i < 6; i += 1) looks.push(await lookAt(st3));
      eq(looks.join(' | '), 'threw 503 | threw 503 | read 1-6 | threw 503 | threw 503 | read 7-12', 'two failures, a reading, two failures, a reading');
      eq(asked3.join(' ') + ' | ' + (await lineOf(st3, 'w')).audited, '1-6 1-6 1-6 7-12 7-12 7-12 | 12', 'the reading in between cleared the count: the second stretch is still asked for whole after its own two failures (four in all, never three in a row)');
    });
    /* 4. refused for its words: the whole cannot be sent — one page at a time at once, as before */
    forgetAuditTrouble();
    const st4 = await auditTale('refused for its words', WRONG());
    const asked4 = [];
    await withFetch(async (url, opts) => { const r = rangeOf(opts); asked4.push(r); return r === '1-6' ? refuse(400, 'Content Exists Risk') : say(CLEAN); }, async () => {
      eq([await lookAt(st4), await lookAt(st4)].join(' | ') + ' | ' + once(asked4).join(' '), 'threw 400 | read 1-1 | 1-6 1-1', 'a refusal of the request’s own words (400, 413, 414, 422, 451) is not waited out: one page at a time from the next look');
    });
    /* 5. an answer that cannot be used is not a reading that succeeded: at every look the first call for the six pages
     * is answered in prose (no JSON), and the house's second call — asked at once — is turned away (429). The prose
     * clears nothing: three such looks, and the pages are asked for one at a time */
    forgetAuditTrouble();
    const st5 = await auditTale('prose, then turned away', WRONG());
    const asked5 = [];
    await withFetch(async (url, opts) => {
      const r = rangeOf(opts);
      asked5.push(r);
      if (r !== '1-6') return say(CLEAN);
      return /Your last answer was not a JSON object/.test(bodyOf(opts).user) ? refuse(429, 'Rate limit reached, slow down') : say('Nothing seems wrong with these pages.');
    }, async () => {
      const looks = [];
      for (let i = 0; i < 4; i += 1) looks.push(await lookAt(st5));
      eq(looks.join(' | ') + ' | ' + once(asked5).join(' '), 'threw 429 | threw 429 | threw 429 | read 1-1 | 1-6 1-1', 'a first answer that is no JSON, its second call turned away — look after look: that is three failures in a row, and the audit goes on one page at a time (counted as a reading that had succeeded, it cleared the count each time: 1-6 at every look, for good)');
    });
  } finally { forgetAuditTrouble(); forgetRelayCheck(); }
});

test('M675-B3 “REFUSED FOR ITS WORDS THREE TIMES” COUNTS REFUSALS FOR ITS WORDS (the review of M675: every failure of a page asked for alone was counted and only the last one’s status looked at — a page the server stumbled on twice (500, 500) was passed by at its FIRST 400, marked read, the workers’ line saying “refused it 3 times”): a page is passed by only when it was refused with 400, 413, 414, 422 or 451 three times while the model answered for other pages — a stumble in between neither counts nor clears the count; the line says how many times it really was refused; and an answer for other pages counts only once the page HAS been refused for its words (one from before — or from the time of the page before it — let a connection that had begun to refuse everything pass a page by)', async () => {
  const prior = globalThis.__cozyAuditAsideMs;
  delete globalThis.__cozyAuditAsideMs; /* the house's own waits: half an hour, doubling */
  const realNow = Date.now;
  let ahead = 0;
  Date.now = () => realNow() + ahead; /* the law's clock: a wait is walked past, not slept out */
  const later = (minutes) => { ahead += minutes * 60000; };
  forgetAuditTrouble();
  try {
    /* 1. a stumble is not a refusal: page 2, alone, answers 500, 500 — then 400, 400, 400 */
    const st = await auditTale('stumbled on, then refused');
    const answers = [500, 500, 400, 400, 400];
    let lookNo = 0;
    const given = new Map(); /* one answer a look, however often the wire asks within it */
    const impl = async (url, opts) => {
      const r = rangeOf(opts);
      if (r === '1-6') return refuse(400, 'Content Exists Risk'); /* the six together are refused for their words: one page at a time at once */
      if (r !== '2-2') return say(CLEAN);
      if (!given.has(lookNo)) given.set(lookNo, answers.length > 1 ? answers.shift() : answers[0]);
      const status = given.get(lookNo);
      return refuse(status, status === 400 ? 'Content Exists Risk' : 'upstream error');
    };
    const look = async () => { lookNo += 1; return lookAt(st); };
    await withFetch(impl, async () => {
      eq([await look(), await look(), await look()].join(' | '), 'threw 400 | read 1-1 | threw 500', 'fixture: one page at a time; page 2, alone, fails — the server stumbled');
      later(31);
      eq(await look(), 'threw 500', 'its wait over, the server stumbles on it again');
      eq(await look(), 'read 7-12', 'set aside, and the model answers for the next line meanwhile');
      later(61);
      eq(await look(), 'threw 400', 'two stumbles and ONE refusal for its words: the page is NOT passed by (it was — marked read, “refused it 3 times”)');
      eq((await lineOf(st, 'a')).audited, 1, 'and nothing is marked read that was not');
      eq(await look(), 'read 13-18', 'the model answers for another line after that refusal');
      later(121);
      eq(await look(), 'threw 400', 'refused for its words a second time: still asked for');
      later(241);
      lookNo += 1;
      const third = await auditStretch({ connection: CONN, storyId: st.id });
      eq(third && third.passedBy + ' | ' + (third.from + 1) + '-' + (third.to + 1), 'true | 2-2', 'refused for its words a third time, with other pages answered for: that one page is passed by');
      assert(new RegExp('refused it ' + UNREADABLE_TRIES + ' times').test(stretchWords(third)) && /Content Exists Risk/.test(stretchWords(third)), 'and the workers’ line says so, with the provider’s own reason: ' + stretchWords(third).slice(0, 170));
      eq(await look(), 'read 3-6', 'the rest of its line is read as any other');
    });
    /* 2. the count that is said is the count that was: a page refused three times before the model had answered for
     * anything else (nothing is passed by then), and once more after it had */
    forgetAuditTrouble();
    const read = (line) => ({ ...line, audited: 6 });
    const [a, b, c] = THREE_LINES();
    const st2 = await auditTale('refused four times', [a, read(b), read(c)]);
    await withFetch(async (url, opts) => { const r = rangeOf(opts); return r === '1-6' || r === '2-2' ? refuse(400, 'Content Exists Risk') : say(CLEAN); }, async () => {
      eq([await lookAt(st2), await lookAt(st2), await lookAt(st2)].join(' | '), 'threw 400 | read 1-1 | threw 400', 'fixture: page 2, alone, is refused for its words');
      later(31);
      eq(await lookAt(st2), 'threw 400', 'a second time');
      later(61);
      eq((await lookAt(st2)) + ' | ' + (await lineOf(st2, 'a')).audited, 'threw 400 | 1', 'a third time — but the model has answered for nothing else since: nothing is passed by');
      { const m = await loadMemory(st2.id); delete m.nodes.find((n) => n.id === 'b').audited; await saveMemory(st2.id, m); } /* a line it can read comes up */
      eq(await lookAt(st2), 'read 7-12', 'it answers for other pages');
      later(121);
      const fourth = await auditStretch({ connection: CONN, storyId: st2.id });
      eq(fourth && fourth.passedBy + ' | ' + (fourth.from + 1) + '-' + (fourth.to + 1), 'true | 2-2', 'refused once more: passed by');
      assert(/refused it 4 times/.test(stretchWords(fourth)), 'and the line says how many times it was refused — four (it said “3 times” whatever the count): ' + stretchWords(fourth).slice(0, 120));
    });
    /* 3. what the model answered BEFORE a page was ever refused for its words says nothing of those refusals: page 2,
     * alone, is stumbled on once (500) and set aside; the other lines are read; then his connection is changed for one
     * that refuses EVERY request (400, a setting its model does not take) — the three refusals that follow are that
     * connection's, not the page's own */
    forgetAuditTrouble();
    const st3 = await auditTale('answered before, refused after');
    let refusesAll = false;
    await withFetch(async (url, opts) => {
      const r = rangeOf(opts);
      if (refusesAll) return refuse(400, 'unsupported parameter: temperature');
      if (r === '1-6') return refuse(400, 'Content Exists Risk');
      return r === '2-2' ? refuse(500, 'upstream error') : say(CLEAN);
    }, async () => {
      eq([await lookAt(st3), await lookAt(st3), await lookAt(st3), await lookAt(st3), await lookAt(st3)].join(' | '), 'threw 400 | read 1-1 | threw 500 | read 7-12 | read 13-18', 'fixture: page 2, alone, is stumbled on and set aside; the model answers for the other lines');
      refusesAll = true;
      const got = [];
      for (const minutes of [31, 61, 121]) { later(minutes); got.push(await lookAt(st3)); }
      eq(got.join(' | ') + ' | ' + (await lineOf(st3, 'a')).audited, 'threw 400 | threw 400 | threw 400 | 1', 'a connection that now refuses everything passes nothing by: the model answered for other pages only BEFORE this page was first refused for its words (it was passed by at the third refusal, marked read, the workers’ line saying the model “answers for other pages”)');
    });
    /* 4. …and what was learned of one page says nothing of the next: page 2 is refused once, the model answers for
     * another line, and then page 2 is read after all — page 3 starts with nothing counted */
    forgetAuditTrouble();
    const st4 = await auditTale('read after all');
    let page2 = 'refused';
    let allRefused = false;
    await withFetch(async (url, opts) => {
      const r = rangeOf(opts);
      if (allRefused) return refuse(400, 'unsupported parameter: temperature');
      return r === '1-6' || (r === '2-2' && page2 === 'refused') ? refuse(400, 'Content Exists Risk') : say(CLEAN);
    }, async () => {
      eq([await lookAt(st4), await lookAt(st4), await lookAt(st4), await lookAt(st4)].join(' | '), 'threw 400 | read 1-1 | threw 400 | read 7-12', 'fixture: page 2, alone, is refused for its words once; the model answers for the next line');
      page2 = 'answered';
      later(31);
      eq(await lookAt(st4), 'read 2-2', 'fixture: its wait over, page 2 is read after all');
      allRefused = true;
      const got = [await lookAt(st4)];
      for (const minutes of [31, 61]) { later(minutes); got.push(await lookAt(st4)); }
      eq(got.join(' | ') + ' | ' + (await lineOf(st4, 'a')).audited, 'threw 400 | threw 400 | threw 400 | 2', 'page 3, refused three times by a connection that refuses everything, is not passed by on the strength of an answer from page 2’s time (it was)');
    });
  } finally {
    Date.now = realNow;
    if (prior !== undefined) globalThis.__cozyAuditAsideMs = prior;
    forgetAuditTrouble();
  }
});

/* ---------- B4: the record's cut ---------- */

/* THE CUT AS IT WAS at m675-001 (memory.js orderedLines, lineWords, recordFor, recordLinesBefore), copied whole — the new
 * cut is held to every answer this one gives. */
const wasOrdered = (mem) => (mem && Array.isArray(mem.nodes) ? mem.nodes : [])
  .filter((n) => n && !n.empty && typeof n.text === 'string' && n.text.trim())
  .sort((x, y) => {
    if (Boolean(x.correction) !== Boolean(y.correction)) return x.correction ? 1 : -1;
    if (x.correction && y.correction) return (x.at || 0) - (y.at || 0);
    return (x.span[0] - y.span[0]) || (y.level - x.level) || ((x.at || 0) - (y.at || 0));
  });
const wasLineWords = (node) => {
  let text = '- ' + node.text.trim();
  if (typeof node.detail === 'string' && node.detail.trim()) text += '\n  • Detail worth keeping: ' + node.detail.trim();
  return text;
};
function wasRecordFor(mem, minLevel = 1, cap = 14000) {
  const lines = wasOrdered(mem).filter((n) => n.level >= minLevel).map(wasLineWords);
  const limit = Number.isFinite(cap) && cap > 0 ? cap : Infinity;
  const note = (n) => (n ? '(' + n + ' earlier ' + (n === 1 ? 'line' : 'lines') + ' not shown — no room)\n' : '');
  let dropped = 0;
  while (lines.length > 1 && (note(dropped) + lines.join('\n')).length > limit) { lines.shift(); dropped += 1; }
  return note(dropped) + lines.join('\n');
}
function wasRecordLinesBefore(mem, pageIndex, cap = Infinity) {
  const nodes = (mem && Array.isArray(mem.nodes) ? mem.nodes : []).filter((n) => n && Array.isArray(n.span) && n.span[1] < pageIndex);
  return wasRecordFor({ nodes }, 1, cap);
}

/* made-up words, the same at every run */
const WORDS = 'the yard the gate Rukia Renji Byakuya seal promise dawn captain barracks lantern letter river bridge market'.split(' ');
const prose = (seed, n) => { let s = ''; let k = seed; while (s.length < n) { k = (k * 1103515245 + 12345) & 0x7fffffff; s += WORDS[k % WORDS.length] + (k % 7 === 0 ? '. ' : ' '); } return s; };
/* the reviewer's long tale: 800 record lines of six pages each, every other one with a detail — 462,744 characters of
 * record before the last line */
function longRecord() {
  const nodes = [];
  for (let l = 0; l < 800; l += 1) nodes.push({ id: 'n' + l, span: [l * 6, l * 6 + 5], text: prose(l + 7, 450), detail: l % 2 ? prose(l + 99, 220) : undefined, level: 1, at: l + 1, whole: true, audited: l < 799 ? 6 : 0 });
  return { window: 30, nodes };
}
const bestOf = (times, fn) => { let best = Infinity; let out; for (let i = 0; i < times; i += 1) { const t0 = performance.now(); out = fn(); best = Math.min(best, performance.now() - t0); } return { ms: best, out }; };

test('M675-B4 THE RECORD BEFORE A STRETCH IS CUT IN ONE PASS, AND IS THE SAME RECORD (the review of M675: memory.js recordFor let the oldest line go and joined every line that was left again to measure it — once for each line let go. Measured over 800 lines, 463,000 characters, on an idle desktop core: about 200 ms for every room the audit tried, 425–450 ms for one request in a small room, on the thread his typing runs on, at every reading): the same answer as the cut it replaces, character for character, over made-up records of 0 to 900 lines and rooms from none to more than the whole; and the long record is cut in a few milliseconds', () => {
  /* 1. the same record, whatever the record and the room */
  let seed = 20261009;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const record = (count, long) => {
    const nodes = [];
    let at = 0;
    for (let i = 0; i < count; i += 1) {
      const kind = rnd(40);
      if (kind === 0) { nodes.push(null); continue; }
      if (kind === 1) { nodes.push({ id: 'x' + i, text: 'a line with no pages' }); continue; }
      if (kind === 2) { nodes.push({ id: 'c' + i, span: [-1, -1], text: '[Correction] ' + prose(seed, 40), level: 1, at: rnd(1000), correction: true }); continue; }
      if (kind === 3) { nodes.push({ id: 'e' + i, span: [at, at + 5], text: '', level: 1, at: i, empty: true }); at += 6; continue; }
      if (kind === 4) { nodes.push({ id: 'w' + i, span: [at, at], text: '   ', level: 1, at: i }); at += 1; continue; }
      const len = 1 + rnd(12);
      const back = rnd(9) === 0 && at > 6 ? 6 : 0; /* now and then two lines over the same pages (a squeeze beside its sources) */
      nodes.push({ id: 'n' + i, span: [at - back, at - back + len - 1], text: (rnd(6) === 0 ? '  ' : '') + prose(seed, long ? 20 + rnd(90) : 1 + rnd(260)), level: 1 + (rnd(5) === 0 ? 1 + rnd(2) : 0), at: rnd(5000), ...(rnd(3) === 0 ? { detail: rnd(7) === 0 ? '  ' : prose(seed + 3, 10 + rnd(120)) } : {}) });
      at += len - back;
    }
    return { mem: { window: 30, nodes }, pages: at };
  };
  let cases = 0;
  const same = (mem, pageIndex, cap, minLevel) => {
    cases += 1;
    const was = wasRecordLinesBefore(mem, pageIndex, cap);
    const now = recordLinesBefore(mem, pageIndex, cap);
    if (was !== now) throw new Error('recordLinesBefore differs from the cut it replaces (' + mem.nodes.length + ' lines, before page ' + pageIndex + ', room ' + cap + '): ' + JSON.stringify(now.slice(0, 80)) + ' … for ' + JSON.stringify(was.slice(0, 80)));
    if (!minLevel) return;
    /* and the cut itself, as the keeper and the page's readers call it (a layer and those above it; a record as the store hands it: every line with its pages) */
    const kept = { ...mem, nodes: mem.nodes.filter((n) => n && Array.isArray(n.span)) };
    if (wasRecordFor(kept, minLevel, cap) !== recordFor(kept, minLevel, cap)) throw new Error('recordFor differs from the cut it replaces (' + mem.nodes.length + ' lines, level ' + minLevel + ', room ' + cap + ')');
  };
  const rooms = (whole) => [0, -5, NaN, Infinity, 1, 30, 46, 47, 200, Math.floor(whole / 3), Math.floor(whole / 2), whole - 1, whole, whole + 1, whole * 2 + 10];
  const sizes = [0, 1, 2, 3, 899, 900];
  for (let i = 0; i < 260; i += 1) sizes.push(rnd(70));
  for (let i = 0; i < 30; i += 1) sizes.push(70 + rnd(230));
  for (let i = 0; i < 6; i += 1) sizes.push(300 + rnd(601));
  for (const count of sizes) {
    const { mem, pages } = record(count, count > 70);
    const whole = wasRecordLinesBefore(mem, pages + 1).length;
    const tried = count > 300 ? [30, Math.floor(whole / 2), whole - 1, whole] : count > 70 ? [...rooms(whole).slice(0, 9), whole - 1, whole, 1 + rnd(whole + 50)] : [...rooms(whole), 1 + rnd(whole + 50), 1 + rnd(whole + 50)];
    for (const cap of tried) same(mem, pages + 1, cap, count > 300 ? 0 : 1 + rnd(3));
    /* and from the middle of the tale: only the lines that end before the page asked for */
    if (pages > 2 && count <= 300) { const mid = 1 + rnd(pages); same(mem, mid, 1 + rnd(wasRecordLinesBefore(mem, mid).length + 20), 0); }
  }
  assert(cases > 3000, 'fixture: the cuts compared (' + cases + ')');
  /* a line let go leaves a line that says how many — the contract, said once in plain sight */
  const [ONE, TWO, THREE] = ['Jovan showed Rukia the seal of the Thirteenth before the noon bell.', 'Rukia promised to keep the seal hidden from every captain she knew.', 'Renji came back from the gate and found the two of them in the yard.'];
  const three = { nodes: [{ id: 'a', span: [0, 5], text: ONE, level: 1, at: 1 }, { id: 'b', span: [6, 11], text: TWO, level: 1, at: 2 }, { id: 'c', span: [12, 17], text: THREE, level: 1, at: 3 }] };
  eq(recordLinesBefore(three, 18, 180), '(1 earlier line not shown — no room)\n- ' + TWO + '\n- ' + THREE, 'the oldest whole lines go first, and a line says how many (the note counts inside the room it speaks of)');
  eq(recordLinesBefore(three, 18, 5), '(2 earlier lines not shown — no room)\n- ' + THREE, 'the newest line is never let go, whatever the room');
  eq(recordLinesBefore(three, 12), '- ' + ONE + '\n- ' + TWO, 'only what was recorded before the page asked for; with no room named, all of it');

  /* 2. the long record: the same answer, and in a few milliseconds */
  const mem = longRecord();
  const pages = Array.from({ length: 4860 }, (_, i) => ({ id: 'p' + i, role: i % 2 ? 'assistant' : 'user', text: i % 2 ? '[The yard — Monday | 09:10]\n\n' + prose(i, 1500) : prose(i, 120) }));
  const stretch = nextStretch(mem, pages);
  eq(stretch.from + ' | ' + recordLinesBefore(mem, stretch.from).length, '4794 | 462744', 'fixture: 799 lines read, the last one due — 462,744 characters of record before it');
  for (const cap of [4000, 26000, 110000]) {
    const was = wasRecordLinesBefore(mem, stretch.from, cap);
    const t = bestOf(5, () => recordLinesBefore(mem, stretch.from, cap));
    assert(t.out === was, 'the long record cut to ' + cap + ' characters is the record the old cut gave');
    assert(t.ms < 40, 'the long record is cut to ' + cap + ' characters in ' + t.ms.toFixed(1) + ' ms (it took about 200 ms: every line that was left was joined again for each line let go)');
  }
  /* and the whole request the audit builds over it, in the smallest room (three rooms tried for the record) */
  let state = applyMutations({ ...emptyState() }, [{ type: 'mc.set', name: 'Jovan' }]).state;
  for (const n of ['Rukia', 'Renji', 'Byakuya']) state = applyMutations(state, [{ type: 'people.set', name: n, field: 'core', text: 'someone of the Seireitei' }]).state;
  const built = bestOf(3, () => buildStretchMessages({ state, brief: prose(3, 9000), castNotes: '', mem, pages, stretch, room: 30000 }));
  assert(built.out.system.length + built.out.user.length <= 30000 * 0.9 && built.out.to >= stretch.from, 'fixture: the request fits its room');
  assert(built.ms < 120, 'one request over the long record, in a 30,000-character room, is built in ' + built.ms.toFixed(1) + ' ms (it took 425–450 ms)');
});

/* ---------- the three other renderers of the record (M675, the second reading) ---------- */
/* THE CUTS AS THEY WERE at m675-001 (memory.js renderMemory, wholeRecord, recordWithPages), copied whole. */
const wasRenderMemory = (mem, cap = 30000) => {
  const lines = wasOrdered(mem).map(wasLineWords);
  if (!lines.length) return '';
  const kept = lines.slice();
  let dropped = 0;
  const body = () => kept.join('\n');
  while (kept.length > 1 && (RECORD_HEADER.length + 1 + body().length) > cap) { kept.shift(); dropped += 1; }
  const head = dropped ? RECORD_HEADER + '\n(' + dropped + ' earlier ' + (dropped === 1 ? 'line' : 'lines') + ' rest beyond the budget.)' : RECORD_HEADER;
  return head + '\n' + body();
};
const wasWholeRecord = (mem, cap = 30000) => {
  const kept = wasOrdered(mem).map(wasLineWords).filter(Boolean);
  let dropped = 0;
  while (kept.length > 1 && kept.join('\n').length > cap) { kept.shift(); dropped += 1; }
  return (dropped ? '(' + dropped + ' earlier ' + (dropped === 1 ? 'line' : 'lines') + ' of the record not shown — no room; what they established still stands)\n' : '') + kept.join('\n');
};
const wasRecordWithPages = (mem, cap = 30000) => {
  const lines = wasOrdered(mem).map((n) => {
    const where = Array.isArray(n.span) && n.span[0] >= 0 ? '[pages ' + (n.span[0] + 1) + (n.span[1] > n.span[0] ? '–' + (n.span[1] + 1) : '') + '] ' : (n.correction ? '[correction] ' : '');
    return wasLineWords(n).replace(/^- /, '- ' + where);
  });
  const kept = lines.slice();
  let dropped = 0;
  while (kept.length > 1 && kept.join('\n').length > cap) { kept.shift(); dropped += 1; }
  return (dropped ? '(' + dropped + ' earlier ' + (dropped === 1 ? 'line' : 'lines') + ' not shown — their pages can be fetched by number)\n' : '') + kept.join('\n');
};

test('M675-B5 THE RECORD IS CUT IN ONE PASS BY EVERY RENDERER, AND IS THE SAME RECORD (the second reading: the cut recordFor was cured of stood in three more — the record the storyteller is sent on every page, the whole record a rebuild reads, and the record with its pages): each gives, character for character, what the cut it replaces gave — over hundreds of made-up records and every room around their sizes — and a long record is cut in a few milliseconds', async () => {
  let seed = 20261010;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const record = (count, long) => {
    const nodes = []; let at = 0;
    for (let i = 0; i < count; i += 1) {
      const kind = rnd(30);
      if (kind === 0) { nodes.push({ id: 'c' + i, span: [-1, -1], text: '[Correction] ' + prose(seed, 40), level: 1, at: rnd(1000), correction: true }); continue; }
      if (kind === 1) { nodes.push({ id: 'e' + i, span: [at, at + 5], text: '', level: 1, at: i, empty: true }); at += 6; continue; }
      if (kind === 2) { nodes.push({ id: 'w' + i, span: [at, at], text: '   ', level: 1, at: i }); at += 1; continue; }
      const len = 1 + rnd(12);
      nodes.push({ id: 'n' + i, span: [at, at + len - 1], text: (rnd(6) === 0 ? '  ' : '') + prose(seed, long ? 20 + rnd(90) : 1 + rnd(260)), level: 1 + (rnd(5) === 0 ? 1 + rnd(2) : 0), at: rnd(5000), ...(rnd(3) === 0 ? { detail: rnd(7) === 0 ? '  ' : prose(seed + 3, 10 + rnd(120)) } : {}) });
      at += len;
    }
    return { window: 30, nodes };
  };
  const pairs = [['renderMemory', wasRenderMemory, renderMemory], ['wholeRecord', wasWholeRecord, wholeRecord], ['recordWithPages', wasRecordWithPages, recordWithPages]];
  let cases = 0;
  const sizes = [0, 1, 2, 3];
  for (let i = 0; i < 220; i += 1) sizes.push(rnd(70));
  for (let i = 0; i < 24; i += 1) sizes.push(70 + rnd(230));
  for (const count of sizes) {
    const mem = record(count, count > 70);
    for (const [name, was, now] of pairs) {
      const whole = was(mem, Infinity).length;
      const rooms = [undefined, 0, -5, NaN, Infinity, 1, 30, RECORD_HEADER.length, RECORD_HEADER.length + 1, RECORD_HEADER.length + 2, 200, Math.floor(whole / 3), Math.floor(whole / 2), whole - 2, whole - 1, whole, whole + 1, 1 + rnd(whole + 50), 1 + rnd(whole + 50)];
      for (const cap of rooms) {
        cases += 1;
        const a = cap === undefined ? was(mem) : was(mem, cap); const b = cap === undefined ? now(mem) : now(mem, cap);
        if (a !== b) throw new Error(name + ' differs from the cut it replaces (' + mem.nodes.length + ' lines, room ' + cap + '): ' + JSON.stringify(b.slice(0, 90)) + ' … for ' + JSON.stringify(a.slice(0, 90)));
      }
    }
  }
  assert(cases > 12000, 'fixture: thousands of cuts compared (' + cases + ')');
  /* a long record, a small room: milliseconds */
  const long = record(800, true);
  const size = wasRenderMemory(long, Infinity).length;
  assert(size > 60000, 'fixture: a long record (' + size + ' characters)');
  const clock = (fn) => { const t0 = performance.now(); fn(); return performance.now() - t0; };
  const before = Math.min(clock(() => wasRenderMemory(long, 30000)), clock(() => wasRenderMemory(long, 30000)));
  const after = Math.min(clock(() => renderMemory(long, 30000)), clock(() => renderMemory(long, 30000)), clock(() => renderMemory(long, 30000)));
  console.log('      M675-B5 the storyteller’s record, ' + long.nodes.length + ' lines / ' + size + ' characters, cut to 30,000: ' + before.toFixed(1) + ' ms as it was, ' + after.toFixed(2) + ' ms now');
  assert(after < 25, 'a long record is cut in a few milliseconds (' + after.toFixed(2) + ' ms; it took ' + before.toFixed(1) + ')');
});
