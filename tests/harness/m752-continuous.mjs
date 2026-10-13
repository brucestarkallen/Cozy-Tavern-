/* Cozy Tavern — harness laws of M752 (followup 4): THE CONTINUOUS AUDIT'S HISTORICAL CORRECTIONS ARE SETTLED, NOT STRANDED.
 * HIS (14 October 2026): "Finished reviewing all 96 folded pages. 1 historical correction remains unresolved after automatic
 * source review. The recovery verdict remains inconsistent after clarification: The fidelity decision needs an exact claim
 * from this record and a valid status." — with the recovery's own answer beside it: the record was true to page 94; the
 * claim was the record's words under "Alexia:" in quotation marks; the pages were named "p94 (#8793a1, the court, Oct 15
 * 1247 10:20)"; page 64, an earlier scene, was listed as a conflict and explained away. "Create automatic repair for this —
 * whether sending back to the continuous audit 'here's your mistake' and whether the mistake is true or not — or you've
 * better solution."
 *   C1  his answer, as he pasted it: read as far as the house can read it, its one real mistake said back, settled true
 *   C2  his story as it stands: the correction the old reading blocked is asked about again, by itself, once
 *   C3  a verdict still unreadable after two clarifications is a failed attempt — tried once more with its reason, then
 *       set aside (bounded, never a dismissal) — and his press asks again
 *   C4  a quote in the same words with other marks is the original's own words; C4b a record edit so is made in the
 *       record's own words
 *   C5  a page named with its context is that page; two pages, or a page that disagrees with its handle, are none
 * Each law runs the real recovery against a provider mocked at the wire. New code is reached through module namespaces,
 * so this file loads against the tree before M752 (followup 4) and each law fails there on its own. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import * as continuous from '../../js/agents/continuous.js';
import * as evidenceMod from '../../js/engine/evidence.js';
import { messageRefResult } from '../../js/agents/housekeeper.js';
import { loadMemory, saveMemory } from '../../js/agents/memory.js';
import { healthSnapshot } from '../../js/agents/health.js';

const { auditStretch, auditWaits, auditProgress, recoveryWords, RECOVERY_DELAY } = continuous;
const CONN = { id: 'm752-cont', type: 'openai', baseUrl: 'https://m752.fixture/v1', model: 'fixture', apiKey: 'fixture', contextSize: 200000, maxTokens: 32000, reasoning: { effort: 'off' } };
const sse = (text) => new Response([{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]
  .map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join('') + 'data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
const lastUserOf = (init) => { try { return String((JSON.parse(init.body || '{}').messages || []).filter((m) => m.role === 'user').at(-1)?.content || ''); } catch (err) { return ''; } };
/* a provider at the wire: answer(lastUserMessage, callNumber) gives the words; every request's last user message is kept */
async function withWire(answer, run) {
  const was = globalThis.fetch;
  const wire = { calls: 0, asked: [] };
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).startsWith('/api/relay')) return new Response('no', { status: 404 });
    wire.calls += 1;
    const said = lastUserOf(init);
    wire.asked.push(said);
    return sse(answer(said, wire.calls));
  };
  try { return await run(wire); } finally { globalThis.fetch = was; }
}

/* HIS STORY'S SHAPE: 96 pages; page 64 the gallery scene that morning, page 94 the court — the storyteller writes curly
 * apostrophes and dashes; the keeper's record line for page 94 keeps them */
const GALLERY = 'Alexia watched from the salle gallery, silver hair pinned up plain, riding gloves on, one ankle hooked over the other.';
const COURT = 'Alexia crossed the last of the court at a walking pace that didn’t hurry and didn’t yield, silver hair pinned up plain, dark riding dress, no gloves — her hands bare, small, and held loose at her sides like a fighter’s hands.';
const RECORD = 'Freeday, Oct 15 1247: Alexia crossed the court to test Jugram before the dressing bell — silver hair pinned up plain, dark riding dress, no gloves, hands bare, small, held loose like a fighter’s.';
const RECORD_CLAIM = 'silver hair pinned up plain, dark riding dress, no gloves, hands bare, small, held loose like a fighter’s';
const FINDING = { issue: { target: 'record', what: 'The record has Alexia barehanded, but she wore riding gloves that morning.', record: { fixes: [{ from: 'no gloves, hands bare, ', to: '', why: 'She wore riding gloves.' }] } }, why: 'The record says no gloves; page 64 has riding gloves on.', from: 93, to: 93 };
async function hisStory(title = 'Alexia at the court') {
  const s = await db.stories.create({ title });
  for (let i = 0; i < 96; i += 1) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    const id = i === 63 ? '0a268c-gallery' : i === 93 ? '8793a1-court' : undefined;
    const text = i === 63 ? GALLERY : i === 93 ? COURT : role === 'user' ? 'I go on. (' + i + ')' : 'The salle went on with its morning. (' + i + ')';
    await db.messages.append(s.id, { ...(id ? { id } : {}), role, text, ts: 1000 + i });
  }
  /* the folded record: every page read by the continuous audit; the line over page 94 with the correction on it */
  await saveMemory(s.id, { window: 12, nodes: [
    { id: 'early', span: [0, 92], level: 2, text: 'The salle and the court, morning to the dressing bell.', whole: true, audited: 93, correctionReviewed: true },
    { id: 'line94', span: [93, 95], level: 1, text: RECORD, whole: true, audited: 3, correctionReviewed: true, auditOpen: [structuredClone(FINDING)] },
  ] });
  return s;
}
/* HIS ANSWER, as he pasted it: the claim under a label in quotation marks, straight apostrophes, the pages named with their
 * place and hour, the earlier scene listed as a conflict and explained away */
const P64 = { source: 'p64 (#0a268c, salle gallery, Oct 15 1247 06:10)', shown: 'silver hair pinned up plain, riding gloves on, one ankle hooked over the other', why: 'Temporal difference only: the gallery scene is hours earlier at the salle with gloves on; p94 explicitly states \'no gloves\'.' };
const hisAnswer = (conflicts) => JSON.stringify({
  sourceFidelity: { status: 'supported', claim: "Alexia: 'silver hair pinned up plain, dark riding dress, no gloves, hands bare, small, held loose like a fighter's'", sameReferent: true, sameEvent: true, assertion: 'direct', relation: 'supports', preservesAssertion: true,
    why: "The disputed span is a near-verbatim reproduction of p94's own narration.", conflicts, uncertainty: '' },
  allegation: 'disproved', blocker: '', outcome: 'correct', why: 'p94 holds the record’s words; the finding is mistaken.',
  evidence: [{ source: 'p94 (#8793a1, the court, Oct 15 1247 10:20)', shown: "Alexia crossed the last of the court at a walking pace that didn't hurry and didn't yield, silver hair pinned up plain, dark riding dress, no gloves" }],
});
/* a model that reads what it is told: once told a passage from another moment is no conflict, it leaves page 64 out */
const reads = (said) => (/HERE IS YOUR MISTAKE/.test(said) && /is no conflict/.test(said) ? hisAnswer([]) : hisAnswer([P64]));
const recoveryPayload = (said) => { try { return JSON.parse(said.split('TARGETED HISTORICAL RECOVERY\n')[1].split('\nAUTHORITATIVE BRIEF')[0]); } catch (err) { return null; } };

test('M752-C1 HIS ANSWER IS READ AS FAR AS THE HOUSE CAN READ IT, ITS ONE REAL MISTAKE IS SAID BACK, AND THE CORRECTION SETTLES TRUE: the claim under “Alexia:” in quotation marks is the record’s own words, “p94 (#8793a1, the court, …)” is page 94, “didn\'t” is the page’s “didn’t”; only page 64 — listed as a conflict and explained away — is sent back, with what a conflict is; the next answer settles it in two calls: the finding withdrawn, the record and the pages untouched, the receipt in the originals’ own words, the lamp’s inventory clear (it said “needs an exact claim from this record”, then blocked it for good)', async () => {
  const s = await hisStory();
  const pagesBefore = JSON.stringify(await db.messages.list(s.id));
  await withWire(reads, async (wire) => {
    const r = await auditStretch({ connection: CONN, storyId: s.id });
    assert(r, 'the recovery ran');
    eq(wire.calls, 2, 'his answer, one clarification, the settled answer');
    const back = wire.asked[1];
    assert(/HERE IS YOUR MISTAKE/.test(back), 'the clarification says the mistake: ' + back.slice(0, 200));
    assert(/p64/.test(back) && /is no conflict/.test(back), 'it names page 64 and what a conflict is: ' + back.slice(0, 600));
    assert(!/exact claim/.test(back) && !/Evidence "p94/.test(back), 'the claim and page 94 were read, not sent back: ' + back.slice(0, 600));
    eq(r.recovery, 'correct', 'the allegation is disproved: the record is true to its page');
    eq(r.open, 0, 'no correction is left open');
    assert(/Original evidence supports the record\. The mistaken finding was withdrawn\./.test(recoveryWords(r)) && /No historical corrections remain unresolved\./.test(recoveryWords(r)), 'the workers’ line says so: ' + recoveryWords(r));
  });
  const mem = await loadMemory(s.id);
  const line = mem.nodes.find((n) => n.id === 'line94');
  eq(line.text, RECORD, 'the record line is as it was');
  eq((line.auditOpen || []).length, 0, 'the finding is withdrawn');
  const receipt = line.auditRecovery.at(-1);
  eq(receipt.outcome + ' ' + receipt.allegation + ' ' + receipt.noEdit, 'correct disproved true', 'the receipt settles it, with no edit');
  eq(receipt.sourceFidelity.claim, RECORD_CLAIM, 'the claim kept is the record’s own words (its curly apostrophe), never the label and quotes');
  eq(receipt.evidence[0].source, '8793a1-court', 'the evidence names page 94 itself');
  eq(receipt.evidence[0].citedAs, 'p94 (#8793a1, the court, Oct 15 1247 10:20)', '…as it was cited');
  assert(COURT.includes(receipt.evidence[0].shown) && /didn’t hurry/.test(receipt.evidence[0].shown), 'the evidence kept is the page’s own words: ' + receipt.evidence[0].shown);
  eq(JSON.stringify(await db.messages.list(s.id)), pagesBefore, 'no page is touched');
  const pages = await db.messages.list(s.id);
  const read = auditProgress(mem, pages.length, pages);
  eq(read.open + ' ' + read.pending, '0 0', 'nothing open, nothing pending');
  const health = healthSnapshot({ storyId: s.id, pages, mem, story: await db.stories.get(s.id), auditRead: read, historicalWait: -1, auditEnabled: false });
  assert(!health.issues.some((i) => i.owner === 'continuous'), 'the lamp’s inventory holds nothing of the continuous audit: ' + JSON.stringify(health.issues));
  await withWire(() => { throw new Error('nothing more is asked'); }, async (wire) => {
    eq(auditWaits(s.id, mem, pages), -1, 'nothing is due');
    eq(await auditStretch({ connection: CONN, storyId: s.id }), null, 'and nothing is read again');
    eq(wire.calls, 0, 'no call');
  });
});

test('M752-C2 HIS STORY AS IT STANDS — THE CORRECTION THE OLD READING BLOCKED IS ASKED ABOUT AGAIN, BY ITSELF, ONCE: blocked with “The recovery verdict remains inconsistent after clarification: The fidelity decision needs an exact claim from this record and a valid status.” it is due again at once and said to be queued; one right answer settles it; a verdict failure under today’s reading, set aside after its attempts, stays set aside (it was due never again: the lamp yellow for good)', async () => {
  const s = await hisStory('Alexia, saved blocked');
  /* the saved state of his story: one attempt made, blocked by the old reading of the verdict */
  await withWire(() => JSON.stringify({ sourceFidelity: { status: 'genuinelyAmbiguous', claim: RECORD_CLAIM, sameReferent: null, sameEvent: true, assertion: 'unclear', relation: 'unclear', why: 'Unsettled.', uncertainty: 'Unsettled.', conflicts: [] },
    allegation: 'unknown', outcome: 'blocked', why: 'Unsettled.', evidence: [{ source: 'p94', shown: 'silver hair pinned up plain, dark riding dress' }] }), async () => { await auditStretch({ connection: CONN, storyId: s.id }); });
  const saved = await loadMemory(s.id);
  const r = saved.nodes.find((n) => n.id === 'line94').auditOpen[0].recovery;
  eq(r.status, 'blocked', 'fixture: a recovery set aside');
  delete r.verdictPolicy;
  r.reason = 'The recovery verdict remains inconsistent after clarification: The fidelity decision needs an exact claim from this record and a valid status.';
  await saveMemory(s.id, saved);
  const pages = await db.messages.list(s.id);
  eq(auditWaits(s.id, await loadMemory(s.id), pages), 0, 'his blocked correction is due again at once');
  eq(auditProgress(await loadMemory(s.id), pages.length, pages).pending, 1, '…and said to be queued, not unresolved for good');
  await withWire(() => hisAnswer([]), async (wire) => {
    const done = await auditStretch({ connection: CONN, storyId: s.id });
    eq(wire.calls, 1, 'one call');
    eq(done.recovery + ' ' + done.open, 'correct 0', 'settled: the record is true');
    eq(await auditStretch({ connection: CONN, storyId: s.id }), null, 'nothing more to read');
    eq(wire.calls, 1, 'and nothing more asked');
  });
  /* a verdict failure under today's reading, its two attempts spent, is not reopened by the policy */
  const t = await hisStory('Alexia, unreadable twice');
  const clock = Date.now;
  let now = clock();
  Date.now = () => now;
  try {
    await withWire(() => hisAnswer([P64]), async (wire) => {
      await auditStretch({ connection: CONN, storyId: t.id });
      now += RECOVERY_DELAY + 1;
      await auditStretch({ connection: CONN, storyId: t.id });
      const kept = (await loadMemory(t.id)).nodes.find((n) => n.id === 'line94').auditOpen[0].recovery;
      eq(kept.status + ' ' + kept.attempts, 'blocked 2', 'fixture: set aside after its two attempts');
      const at = wire.calls;
      now += RECOVERY_DELAY * 10;
      const tp = await db.messages.list(t.id);
      eq(auditWaits(t.id, await loadMemory(t.id), tp), -1, 'not due again by itself');
      eq(await auditStretch({ connection: CONN, storyId: t.id }), null, 'nothing read');
      eq(wire.calls, at, 'no call');
    });
  } finally { Date.now = clock; }
});

test('M752-C3 A VERDICT STILL UNREADABLE AFTER TWO CLARIFICATIONS IS A FAILED ATTEMPT, NOT A FACT ABOUT THE STORY: three calls, then queued with its reason; asked again after the wait, carrying that reason (validationFailure); after its second attempt set aside, never dismissed — the record, its receipts and the pages as they were; and his press (freshTryForCorrections) asks again, carrying the reason, and a right answer then settles it (one clarification, then blocked for good)', async () => {
  const s = await hisStory('Alexia, never corrected');
  const clock = Date.now;
  let now = clock();
  Date.now = () => now;
  try {
    await withWire(() => hisAnswer([P64]), async (wire) => {
      const first = await auditStretch({ connection: CONN, storyId: s.id });
      eq(wire.calls, 3, 'the answer and two clarifications');
      eq(first.open + ' ' + first.pending, '1 1', 'still open, and queued for another attempt');
      let rec = (await loadMemory(s.id)).nodes.find((n) => n.id === 'line94').auditOpen[0].recovery;
      eq(rec.status + ' ' + rec.attempts, 'retry 1', 'a failed attempt, one more to come');
      assert(/^The recovery verdict remains inconsistent after clarification: /.test(rec.reason) && /p64/.test(rec.reason), 'its reason is the mistake: ' + rec.reason);
      eq(await auditStretch({ connection: CONN, storyId: s.id }), null, 'not asked again before the wait');
      eq(wire.calls, 3, 'no call');
      now += RECOVERY_DELAY + 1;
      const second = await auditStretch({ connection: CONN, storyId: s.id });
      eq(wire.calls, 6, 'the second attempt: three calls');
      const payload = recoveryPayload(wire.asked[3]);
      eq(payload && payload.validationFailure, rec.reason, 'the second attempt is told why the first failed');
      eq(second.open + ' ' + second.pending, '1 0', 'set aside after its second attempt');
      rec = (await loadMemory(s.id)).nodes.find((n) => n.id === 'line94').auditOpen[0].recovery;
      eq(rec.status + ' ' + rec.attempts, 'blocked 2', 'blocked, its attempts spent');
      now += RECOVERY_DELAY * 10;
      eq(await auditStretch({ connection: CONN, storyId: s.id }), null, 'never asked again by itself');
      eq(wire.calls, 6, 'no call');
    });
    const line = (await loadMemory(s.id)).nodes.find((n) => n.id === 'line94');
    eq(line.text + ' | ' + (line.auditRecovery || []).length, RECORD + ' | 0', 'never dismissed: no receipt, the record as it was');
    /* his press: every open correction given a fresh try, carrying its last reason */
    eq(typeof continuous.freshTryForCorrections, 'function', 'the house has a fresh try by hand');
    eq(await continuous.freshTryForCorrections(s.id), 1, 'one open correction given a fresh try');
    const pages = await db.messages.list(s.id);
    eq(auditWaits(s.id, await loadMemory(s.id), pages), 0, 'due at once');
    const lastReason = (await loadMemory(s.id)).nodes.find((n) => n.id === 'line94').auditOpen[0].recovery.reason;
    await withWire(reads, async (wire) => {
      const done = await auditStretch({ connection: CONN, storyId: s.id });
      eq(recoveryPayload(wire.asked[0]).validationFailure, lastReason, 'asked again with the reason it last failed');
      eq(wire.calls + ' ' + done.recovery + ' ' + done.open, '2 correct 0', 'the right answer settles it');
    });
  } finally { Date.now = clock; }
});

test('M752-C4 A QUOTE IN THE SAME WORDS WITH OTHER MARKS IS THE ORIGINAL’S OWN WORDS (a curly apostrophe refused a right answer): straight for curly quotes, a hyphen or two for a dash, three stops for an ellipsis, emphasis marks, white space — the original’s text comes back; one changed letter or word is refused', async () => {
  const { quotedSource } = evidenceMod;
  eq(quotedSource(COURT, "a walking pace that didn't hurry and didn't yield"), 'a walking pace that didn’t hurry and didn’t yield', 'straight apostrophes: the page’s words');
  eq(quotedSource(COURT, 'no gloves - her hands bare'), 'no gloves — her hands bare', 'a hyphen for the dash');
  eq(quotedSource(COURT, 'no gloves--her hands bare'), 'no gloves — her hands bare', 'two hyphens, unspaced');
  eq(quotedSource('She *did* go… and   came back.', 'She did go... and came back.'), 'She *did* go… and came back.', 'emphasis, an ellipsis, white space');
  eq(quotedSource(COURT, "a walking pace that didn't hurry and didn't wait"), '', 'one changed word is refused');
  eq(quotedSource(COURT, 'a walking pace that doesn’t hurry'), '', 'one changed letter is refused');
  eq(quotedSource(COURT, 'no gloves — her hands bare'), 'no gloves — her hands bare', 'the exact words, as ever');
});

test('M752-C4b A RECORD EDIT IN THE SAME WORDS WITH OTHER MARKS IS MADE IN THE RECORD’S OWN WORDS (refused as “the proposed from span does not occur”, it was left open as a historical correction): a reading’s fix echoed with straight apostrophes over a record written with curly ones lands in the reading, in the record’s marks', async () => {
  /* a reading proposes a fix in straight apostrophes over a record written with curly ones */
  const s = await db.stories.create({ title: 'Gloves by the well' });
  const PAGE = 'By the well, Alexia’s gloves were grey and worn at the fingers; she kept them on.';
  await db.messages.append(s.id, { role: 'user', text: 'I wait by the well.' });
  await db.messages.append(s.id, { role: 'assistant', text: PAGE });
  await saveMemory(s.id, { window: 12, nodes: [{ id: 'well', span: [0, 1], level: 1, text: 'By the well: Alexia’s gloves were black; she kept them on.', whole: true }] });
  const answer = JSON.stringify({ issues: [{ target: 'record', what: 'The record gives Alexia black gloves; the page has them grey.',
    record: { fixes: [{ from: "Alexia's gloves were black", to: "Alexia's gloves were grey", shown: "Alexia's gloves were grey and worn at the fingers", why: 'The page says grey.' }] } }] });
  await withWire(() => answer, async () => {
    const r = await auditStretch({ connection: CONN, storyId: s.id });
    eq(r.lineMended + ' ' + r.open, '1 0', 'the fix lands in the reading; no correction is left open');
  });
  eq((await loadMemory(s.id)).nodes[0].text, 'By the well: Alexia’s gloves were grey; she kept them on.', 'in the record’s own marks');
});

test('M752-C5 A PAGE NAMED WITH ITS CONTEXT IS THAT PAGE (“p94 (#8793a1, the court, Oct 15 1247 10:20)” was “source reference could not be resolved”): number and handle agree — that page; they disagree, or two pages, or the wrong speaker — none; a label that does not begin with a page, or runs on into words, is no page', async () => {
  const s = await hisStory('Alexia, references');
  const pages = await db.messages.list(s.id);
  const id = (ref) => messageRefResult(pages, ref).message?.id || messageRefResult(pages, ref).error;
  eq(id('p94 (#8793a1, the court, Oct 15 1247 10:20)'), '8793a1-court', 'number, handle, place and hour');
  eq(id('p64 (#0a268c, salle gallery, Oct 15 1247 06:10)'), '0a268c-gallery', 'the gallery');
  eq(id('#8793a1 (the court)'), '8793a1-court', 'a handle first');
  eq(id('p94 — the court'), '8793a1-court', 'after a dash');
  eq(id('p94, the storyteller'), '8793a1-court', 'with its speaker');
  eq(id('p94 (#0a268c, the court)'), 'inconsistent', 'a handle of another page');
  eq(id('p94 (the writer)'), 'inconsistent', 'the wrong speaker');
  eq(id('p94, p95'), 'ambiguous', 'two pages');
  eq(id('p200 (the court)'), 'unavailable', 'no such page');
  eq(id('the court, p94'), 'unresolved', 'not beginning with a page');
  eq(id('page 72 extra'), 'unresolved', 'running on into words (M726)');
  eq(id('p94'), '8793a1-court', 'the plain number, as ever');
});
