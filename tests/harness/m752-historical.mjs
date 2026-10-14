/* Cozy Tavern — harness laws of M752 (followup 9): A HISTORICAL CORRECTION'S CONVERSATION ENDS ON A VERDICT, NOT ON A MISTAKE
 * NOBODY SAID. HIS (15 October 2026), his 316-page tale with the lamp still yellow: "3 historical corrections remain
 * unresolved after automatic source review. Incorrect original-source quotation; The recovery verdict remains inconsistent
 * after clarification: Evidence "p242": quoted passage does not occur in that original. Copy the words exactly as p242
 * writes them…; The focused response did not provide a usable correction verdict." — the corrections: the development
 * scheme's "donations in eleven minutes" (Rias corrects Vanessa), why Caleb knew the four o'clock walk (the lake-path video
 * and the squad's chat), and whether the postman's wife's "Edie" is Mrs. Dale.
 *   H1  a quote of what a page SAYS, across its markup (a phone's messages, each a <div>), a character reference and an
 *       unseen character, is the page's own words — and one changed word is still refused
 *   H2  a quote that leaves words out ("…") where every word it keeps is the page's, in order, is the page's words; the
 *       donations correction's repair with such a passage is made in one call (it was refused, then blocked)
 *   H3  a repair the house would refuse is said back in the conversation — which edit, why, and what the page says where
 *       the quote departs — and the right repair is made; a model that says no edit in the originals' words can set it
 *       right is taken at its word (its law offered "blocker: unsafe")
 *   H4  "person: Edie Dale" is served as the pages that hold the name (it was dropped without a word, three times); a look
 *       past the two is told "no more", an answer that is no verdict is told what is wrong — and each then settles
 *   H5  his tale as it stands: the corrections blocked so are asked about again, each once; one honestly unsettled is not
 * Each law runs the real recovery against a provider mocked at the wire. New code is reached through module namespaces,
 * so this file loads against the tree before M752 (followup 9) and each law fails there on its own. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import * as continuous from '../../js/agents/continuous.js';
import * as evidenceMod from '../../js/engine/evidence.js';
import { loadMemory, saveMemory } from '../../js/agents/memory.js';

const { auditStretch, auditWaits, auditProgress, RECOVERY_DELAY } = continuous;
const CONN = { id: 'm752-hist', type: 'openai', baseUrl: 'https://m752h.fixture/v1', model: 'fixture', apiKey: 'fixture', contextSize: 200000, maxTokens: 32000, reasoning: { effort: 'off' } };
const sse = (text) => new Response([{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]
  .map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join('') + 'data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
const lastUserOf = (init) => { try { return String((JSON.parse(init.body || '{}').messages || []).filter((m) => m.role === 'user').at(-1)?.content || ''); } catch (err) { return ''; } };
async function withWire(answer, run) {
  const was = globalThis.fetch;
  const wire = { calls: 0, asked: [] };
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).startsWith('/api/relay')) return new Response('no', { status: 404 });
    wire.calls += 1;
    const said = lastUserOf(init);
    wire.asked.push(said);
    const words = answer(said, wire.calls);
    return sse(typeof words === 'string' ? words : JSON.stringify(words));
  };
  try { return await run(wire); } finally { globalThis.fetch = was; }
}
const recoveryPayload = (said) => { try { return JSON.parse(said.split('TARGETED HISTORICAL RECOVERY\n')[1].split('\nAUTHORITATIVE BRIEF')[0]); } catch (err) { return null; } };

/* HIS TALE'S SHAPES, fourteen pages of it: an early page that names Edie Dale; the rim road, where Rias corrects Vanessa;
 * the squad's chat on Rias's phone, written as his storyteller writes phones (a GFX block of <div>s, curly marks, an
 * emoji with its variation selector, &amp;); the postman's wife reading Mrs. Dale's second post */
const EARLY_EDIE = 'Edie Dale — Mrs. Dale to the whole lane — posted her first correction before the kettle had boiled.';
const RIM_ROAD = 'Vanessa leaned over the seat back. “The council chased him out with donations,” Vanessa said, “like, a whole bake sale of them.”\n\nRias didn’t look up from the road. “Donations in eleven minutes,” Rias corrected her. “Get it right, Nessa.”\n\n“Eleven minutes,” Vanessa agreed, delighted.';
const SQUAD = 'Rias set her phone face-up on the counter between them.\n\n<div style="background:#1c1c1e; border-radius:18px; padding:12px; max-width:340px;">\n<div style="text-align:center; color:#aaa; font-size:13px; margin-bottom:8px;">the squad</div>\n<div style="color:#8e8e93; font-size:11px;">Chloe</div>\n<div style="background:#26262b; border-radius:16px; padding:10px 13px; margin:6px 0;">did u see the lake path vid</div>\n<div style="color:#8e8e93; font-size:11px;">Maya</div>\n<div style="background:#26262b; border-radius:16px; padding:10px 13px; margin:6px 0;">caleb has it. he knows about the 4 o’clock walk &amp; who was on it</div>\n<div style="color:#8e8e93; font-size:11px;">Mom</div>\n<div style="background:#26262b; border-radius:16px; padding:10px 13px; margin:6px 0;">Home by 9:30, baby ❤️ That’s a treaty</div>\n</div>\n<!-- GFX_END -->\n\n“That,” Rias said, “is the whole reason Caleb knew the walk. The video and the squad.”';
const POST = 'The postman’s wife read Mrs. Dale’s second correction post aloud from her porch: “Edie says the swan was never inflatable.”';
const TEXTS = { 3: EARLY_EDIE, 9: RIM_ROAD, 11: SQUAD, 13: POST }; /* by page number */
const RECORDS = {
  rim: 'On the rim road Vanessa told the story of the development scheme: donations in eleven minutes, she said, chased the developer out.',
  walk: 'Rias showed Jovan the squad chat: the lake-path video and Chloe and Maya’s gossip were how Caleb knew the four o’clock walk.',
  post: 'The postman’s wife read Mrs. Dale’s second correction post aloud, Edie’s own words about the swan.',
};
const FINDINGS = {
  rim: { issue: { target: 'record', what: 'The record line says the development scheme was stopped by "donations in eleven minutes," as Vanessa told it, but on the pages Rias says the eleven minutes, correcting Vanessa.', record: { fixes: [{ from: 'she said', to: 'Rias corrected her', why: 'Rias corrects Vanessa.' }] } }, why: 'Incorrect original-source quotation.' },
  walk: { issue: { target: 'record', what: 'The record line says Rias told Jovan the whole reason Caleb knew the walk, but the pages give a different chain.' }, why: 'The fault needs grounded story versus record classification.' },
  post: { issue: { target: 'record', what: 'Mrs. Dale’s second correction post as voiced by the postman’s wife calls Mrs. Dale "Edie," but the record before keeps that name for a separate ledger entry, and nothing here establishes the two are the same person.' }, why: 'The fault needs grounded story versus record classification.' },
};
/* one tale; `lines`: which record lines carry their correction — rim over p7–p10, walk over p11, post over p12–p14 */
async function hisTale(title, lines = ['rim', 'walk', 'post']) {
  const s = await db.stories.create({ title });
  for (let i = 0; i < 14; i += 1) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    const text = TEXTS[i + 1] || (role === 'user' ? 'I go on. (' + (i + 1) + ')' : 'Ravenwood went on with its Friday. (' + (i + 1) + ')');
    await db.messages.append(s.id, { role: TEXTS[i + 1] ? 'assistant' : role, text, ts: 1000 + i });
  }
  const line = (id, span) => ({ id, span, level: 1, text: RECORDS[id], whole: true, audited: span[1] - span[0] + 1, correctionReviewed: true,
    ...(lines.includes(id) ? { auditOpen: [{ ...structuredClone(FINDINGS[id]), from: span[0], to: span[1] }] } : {}) });
  await saveMemory(s.id, { window: 12, nodes: [
    { id: 'early', span: [0, 5], level: 2, text: 'Ravenwood, the week Jovan came home; the lane and its gossip.', whole: true, audited: 6, correctionReviewed: true },
    line('rim', [6, 9]), line('walk', [10, 10]), line('post', [11, 13]),
  ] });
  return s;
}
const lineOf = async (s, id) => (await loadMemory(s.id)).nodes.find((n) => n.id === id);
const pagesOf = async (s) => db.messages.list(s.id);

/* the verdicts, as a model writes them */
const RIM_CLAIM = 'donations in eleven minutes, she said';
const rimVerdict = ({ shown, fixShown = shown, to = 'Rias corrected her' } = {}) => ({
  sourceFidelity: { status: 'contradicted', claim: RIM_CLAIM, sameReferent: true, sameEvent: true, assertion: 'attributed', relation: 'contradicts', preservesAssertion: false,
    why: 'On p9 Rias says the eleven minutes, correcting Vanessa; the record gives the words to Vanessa.', conflicts: [], uncertainty: '' },
  allegation: 'confirmed', outcome: 'repair', why: 'Rias, not Vanessa, says "donations in eleven minutes".',
  evidence: [{ source: 'p9', shown }],
  record: { fixes: [{ from: 'she said', to, shown: fixShown, why: 'Rias corrects Vanessa on p9.', operation: 'replace' }] },
});
const WALK_CLAIM = 'the lake-path video and Chloe and Maya’s gossip were how Caleb knew the four o’clock walk';
const walkVerdict = (evidence) => ({
  sourceFidelity: { status: 'supported', claim: WALK_CLAIM, sameReferent: true, sameEvent: true, assertion: 'direct', relation: 'supports', preservesAssertion: true,
    why: 'p11 shows the squad chat — Chloe on the lake path video, Maya saying Caleb has it and knows about the walk — and Rias saying that is the whole reason.', conflicts: [], uncertainty: '' },
  allegation: 'disproved', outcome: 'correct', why: 'The record is true to p11: the video and the squad chat.', evidence,
});
const P3 = { source: 'p3', shown: 'Edie Dale — Mrs. Dale to the whole lane' };
const P13 = { source: 'p13', shown: 'Edie says the swan was never inflatable.' };
const postVerdict = (evidence = [P3, P13]) => ({
  sourceFidelity: { status: 'supported', claim: 'Edie’s own words about the swan', sameReferent: true, sameEvent: true, assertion: 'direct', relation: 'supports', preservesAssertion: true,
    why: 'p3 names Edie Dale as Mrs. Dale; the post p13 reads out is hers.', conflicts: [], uncertainty: '' },
  allegation: 'disproved', outcome: 'correct', why: 'Edie Dale is Mrs. Dale (p3).',
  evidence,
});
/* which correction a request is about */
const about = (said) => { const p = recoveryPayload(said); return p ? Object.keys(RECORDS).find((k) => RECORDS[k] === p.record) : null; };

test('M752-H1 A QUOTE OF WHAT A PAGE SAYS, ACROSS ITS MARKUP, IS THE PAGE’S OWN WORDS (“Evidence "p242": quoted passage does not occur in that original”, twice told to copy exactly, then blocked): the squad’s chat as a reader reads it — the sender and the message of each <div>, the curly apostrophe, &amp; as &, the heart without its variation selector — settles the walk correction in one call, its receipt in the page’s own characters; one changed word is still refused', async () => {
  const { quotedSource } = evidenceMod;
  const ACROSS = "Chloe did u see the lake path vid Maya caleb has it. he knows about the 4 o'clock walk & who was on it";
  assert(quotedSource(SQUAD, ACROSS), 'the messages and their senders, as the page shows them');
  assert(quotedSource(SQUAD, "Home by 9:30, baby ❤ That's a treaty"), 'the heart with no variation selector, a straight apostrophe');
  eq(quotedSource('a&nbsp;b &#8220;c&#8221; &amp; the &lt;3', 'a b "c" & the <3'), 'a&nbsp;b &#8220;c&#8221; &amp; the &lt;3', 'character references are the characters they name');
  assert(quotedSource('Mari­ner​’s Lane', "Mariner's Lane"), 'a soft hyphen and a zero-width space are nothing');
  eq(quotedSource(SQUAD, "Chloe did u see the lake path vid Maya caleb has it. he knows about the 5 o'clock walk"), '', 'one changed word is refused');
  eq(quotedSource(SQUAD, 'Chloe did u see the lake vid'), '', 'a word left out with no mark is refused');
  eq(quotedSource('He said <b>no</b> again.', 'He said no again.'), 'He said <b>no</b> again.', 'an inline tag between words: the original’s text comes back');
  const s = await hisTale('the walk', ['walk']);
  await withWire(() => walkVerdict([{ source: 'p11', shown: ACROSS }, { source: 'p11', shown: "Home by 9:30, baby ❤ That's a treaty" }]), async (wire) => {
    const r = await auditStretch({ connection: CONN, storyId: s.id });
    eq(wire.calls, 1, 'one call: the answer is read');
    eq(r.recovery + ' ' + r.open, 'correct 0', 'settled: the record is true to its page');
  });
  const line = await lineOf(s, 'walk');
  eq(line.text, RECORDS.walk, 'the record line is as it was');
  const receipt = line.auditRecovery.at(-1);
  assert(receipt.evidence.every((e) => SQUAD.replace(/\s+/g, ' ').includes(e.shown)), 'the receipt is in the page’s own characters: ' + JSON.stringify(receipt.evidence.map((e) => e.shown)));
  assert(/&amp; who was on it/.test(receipt.evidence[0].shown) && /<\/div>/.test(receipt.evidence[0].shown), '…markup and all');
});

test('M752-H2 A QUOTE THAT LEAVES WORDS OUT, WHERE EVERY WORD IT KEEPS IS THE PAGE’S, IS THE PAGE’S WORDS (“Incorrect original-source quotation”, then blocked): the pieces in order on one page come back in the page’s words, joined by “ … ”; a piece out of order, changed or not there refuses it — and the donations correction’s repair, its passage so quoted, is made in one call: Rias corrects Vanessa in the record, the pages untouched', async () => {
  const { elidedSource } = evidenceMod;
  eq(typeof elidedSource, 'function', 'the house reads a quote that leaves words out');
  const ELIDED = '"The council chased him out with donations," Vanessa said... "Donations in eleven minutes," Rias corrected her.';
  eq(elidedSource(RIM_ROAD, ELIDED), '“The council chased him out with donations,” Vanessa said … “Donations in eleven minutes,” Rias corrected her.', 'the pieces, in the page’s words');
  eq(elidedSource(RIM_ROAD, '…Rias corrected her. “Get it right, Nessa.”…'), 'Rias corrected her. “Get it right, Nessa.”', 'one piece between ellipses: its words alone');
  eq(elidedSource(RIM_ROAD, '"Donations in eleven minutes," Rias corrected her... "The council chased him out with donations,"'), '', 'out of order: refused');
  eq(elidedSource(RIM_ROAD, '"The council chased him out with donations," Vanessa said... "Donations in ten minutes,"'), '', 'a changed piece: refused');
  eq(elidedSource(RIM_ROAD, 'Vanessa said, "like, a whole bake sale."'), '', 'nothing left out: not this reading’s to take');
  const s = await hisTale('the rim road', ['rim']);
  const before = JSON.stringify(await pagesOf(s));
  await withWire(() => rimVerdict({ shown: ELIDED }), async (wire) => {
    const r = await auditStretch({ connection: CONN, storyId: s.id });
    eq(wire.calls, 1, 'one call');
    eq(r.recovery + ' ' + r.open, 'repaired 0', 'the repair is made');
  });
  const line = await lineOf(s, 'rim');
  eq(line.text, 'On the rim road Vanessa told the story of the development scheme: donations in eleven minutes, Rias corrected her, chased the developer out.', 'Rias corrects Vanessa in the record');
  eq(line.auditRecovery.at(-1).evidence[0].shown, '“The council chased him out with donations,” Vanessa said … “Donations in eleven minutes,” Rias corrected her.', 'the receipt in the page’s words, where words were left out said so');
  eq(JSON.stringify(await pagesOf(s)), before, 'no page is touched');
});

test('M752-H3 A REPAIR THE HOUSE WOULD REFUSE IS SAID BACK IN THE CONVERSATION (it was refused only after it, with no word to the model — “Incorrect original-source quotation”, again a minute later, then blocked): the edit, why, and what the page says where its passage departs; the right repair is then made; a replacement not in the page’s words is said back too (it blocked at once); and a model that says no edit in the originals’ words can set it right is taken at its word', async () => {
  const RIGHT = '“Donations in eleven minutes,” Rias corrected her.';
  /* the fix's passage with one word changed; told where it departs, the model copies the page */
  const s = await hisTale('the rim road, a word changed', ['rim']);
  await withWire((said) => (/HERE IS YOUR MISTAKE/.test(said) && /corrected her/.test(said) ? rimVerdict({ shown: RIGHT }) : rimVerdict({ shown: RIGHT, fixShown: '"Donations in eleven minutes," Rias snapped at her.' })), async (wire) => {
    const r = await auditStretch({ connection: CONN, storyId: s.id });
    eq(wire.calls, 2, 'the answer, one clarification, the right answer');
    const back = wire.asked[1];
    assert(/record edit 1 \(from "she said"\)/.test(back) && /Incorrect original-source quotation/.test(back), 'it names the edit and the mistake: ' + back.slice(0, 300));
    assert(/goes on "corrected her\./.test(back) && /where your quote has "snapped at her\."/.test(back), 'and what the page says where the passage departs: ' + back.slice(0, 900));
    eq(r.recovery + ' ' + r.open, 'repaired 0', 'the repair is made');
  });
  eq((await lineOf(s, 'rim')).text, 'On the rim road Vanessa told the story of the development scheme: donations in eleven minutes, Rias corrected her, chased the developer out.', 'in the record');
  /* a replacement that is no words of the page: said back, then the page's words */
  const t = await hisTale('the rim road, a paraphrase', ['rim']);
  await withWire((said) => (/Replacement is not supported/.test(said) ? rimVerdict({ shown: RIGHT }) : rimVerdict({ shown: RIGHT, to: 'Rias, not Vanessa, said' })), async (wire) => {
    const r = await auditStretch({ connection: CONN, storyId: t.id });
    eq(wire.calls + ' ' + r.recovery, '2 repaired', 'said back once, then made');
    assert(/"to" must be words an original supplied writes/.test(wire.asked[1]), 'with what a replacement must be');
  });
  /* the honest exit its law offers: the claim is contradicted, and no edit in the originals' own words sets it right */
  const u = await hisTale('the rim road, no safe edit', ['rim']);
  const unsafe = { ...rimVerdict({ shown: RIGHT }), outcome: 'blocked', blocker: 'unsafe', why: 'The words that set it right are a correction spoken across two lines; no single phrase of p9 can stand in the record.' };
  delete unsafe.record;
  const clock = Date.now;
  let now = clock();
  Date.now = () => now;
  try {
    await withWire(() => unsafe, async (wire) => {
      const r = await auditStretch({ connection: CONN, storyId: u.id });
      eq(wire.calls, 1, 'one call');
      eq(r.open + ' ' + r.pending, '1 0', 'set aside, not queued');
      const rec = (await lineOf(u, 'rim')).auditOpen[0].recovery;
      eq(rec.status + ' | ' + rec.reason, 'blocked | ' + unsafe.why, 'with its own reason');
      now += RECOVERY_DELAY * 10;
      eq(await auditStretch({ connection: CONN, storyId: u.id }), null, 'never asked again by itself');
      eq(wire.calls, 1, 'no call');
    });
  } finally { Date.now = clock; }
  eq((await lineOf(u, 'rim')).text, RECORDS.rim, 'the record as it was');
});

test('M752-H4 “person: Edie Dale” IS SERVED AS THE PAGES THAT HOLD THE NAME (it was dropped without a word; asked again, and again, the conversation ended “The focused response did not provide a usable correction verdict”): the model is told what it was served instead, reads p3, and settles that Edie Dale is Mrs. Dale; a look past its two is told “no more” and answers; an answer that is no verdict is told what is wrong and answers', async () => {
  const PAGE3 = 'Mrs. Dale to the whole lane';
  const looks = (said) => (said.includes(PAGE3) && /wrote \(/.test(said) ? postVerdict() : /\[find: Edie Dale\]/.test(said) ? '<fetch>["p3"]</fetch>' : '<fetch>["person: Edie Dale"]</fetch>');
  const s = await hisTale('Edie', ['post']);
  await withWire(looks, async (wire) => {
    const r = await auditStretch({ connection: CONN, storyId: s.id });
    eq(wire.calls, 3, 'person:, the page, the verdict');
    assert(/is the ledger’s page, not an original: served instead, the pages that hold "Edie Dale"/.test(wire.asked[1]) && /p3 #/.test(wire.asked[1]), 'told what it was served instead: ' + wire.asked[1].slice(0, 400));
    eq(r.recovery + ' ' + r.open, 'correct 0', 'settled');
  });
  const receipt = (await lineOf(s, 'post')).auditRecovery.at(-1);
  eq(receipt.evidence.map((e) => e.citedAs).join(' '), 'p3 p13', 'its evidence: the page it fetched, and the post');
  /* a model that keeps looking: told there is no more, it answers */
  const t = await hisTale('Edie, a third look', ['post']);
  await withWire((said) => (/You have used both of your looks/.test(said) ? postVerdict() : '<fetch>["p3"]</fetch>'), async (wire) => {
    const r = await auditStretch({ connection: CONN, storyId: t.id });
    eq(wire.calls, 4, 'two looks, a third told “no more”, the verdict');
    assert(/no more <fetch>/.test(wire.asked[2]), 'its second look is served with “no more”: ' + wire.asked[2].slice(-200));
    eq(r.recovery + ' ' + r.open, 'correct 0', 'settled');
  });
  /* an answer the house cannot read: told what is wrong in it, it answers */
  const u = await hisTale('Edie, no outcome', ['post']);
  const noOutcome = { ...postVerdict([P13]) };
  delete noOutcome.outcome;
  await withWire((said) => (/outcome must be "repair", "correct" or "blocked" \(it was missing\)/.test(said) ? postVerdict([P13]) : noOutcome), async (wire) => {
    const r = await auditStretch({ connection: CONN, storyId: u.id });
    eq(wire.calls + ' ' + r.recovery + ' ' + r.open, '2 correct 0', 'told once, settled');
  });
  /* one that never answers at all: its attempt fails after two clarifications, with the reason said */
  const v = await hisTale('Edie, prose only', ['post']);
  await withWire(() => 'I think Edie is probably Mrs. Dale.', async (wire) => {
    const r = await auditStretch({ connection: CONN, storyId: v.id });
    eq(wire.calls, 3, 'the answer and two clarifications');
    eq(r.open + ' ' + r.pending, '1 1', 'a failed attempt, queued once more');
    const rec = (await lineOf(v, 'post')).auditOpen[0].recovery;
    assert(/^The focused response did not provide a usable correction verdict: Your answer held no JSON object/.test(rec.reason), 'its reason says why: ' + rec.reason);
  });
});

test('M752-H5 HIS TALE AS IT STANDS — THE CORRECTIONS BLOCKED BY THESE FAILURES ARE ASKED ABOUT AGAIN, EACH ONCE, AND SETTLE; ONE HONESTLY UNSETTLED IS NOT: blocked with his three reasons, word for word, their attempts spent, they are due at once and said to be queued; right answers settle all three and the lamp has nothing left; a correction the sources left unknown stays set aside', async () => {
  const s = await hisTale('his tale, saved blocked');
  const WHY = {
    rim: 'Incorrect original-source quotation.',
    walk: 'The recovery verdict remains inconsistent after clarification: Evidence "p242": quoted passage does not occur in that original. Copy the words exactly as p242 writes them, as one unbroken passage, without leaving words out or changing them.',
    post: 'The focused response did not provide a usable correction verdict.',
  };
  /* the saved state of his tale: each recovery as the house left it — real reservations, then blocked with his reasons */
  const CLAIMS = { rim: RIM_CLAIM, walk: WALK_CLAIM, post: 'Edie’s own words about the swan' };
  const SEEN = { rim: { source: 'p9', shown: 'Vanessa agreed, delighted' }, walk: { source: 'p11', shown: 'did u see the lake path vid' }, post: P13 };
  const unsettled = (said) => { const which = about(said); return { sourceFidelity: { status: 'genuinelyAmbiguous', claim: CLAIMS[which], sameReferent: null, sameEvent: true, assertion: 'unclear', relation: 'unclear', why: 'Unsettled.', uncertainty: 'Unsettled.', conflicts: [] },
    allegation: 'unknown', outcome: 'blocked', why: 'Unsettled.', evidence: [SEEN[which]] }; };
  await withWire(unsettled, async (wire) => {
    for (let i = 0; i < 3; i += 1) await auditStretch({ connection: CONN, storyId: s.id });
    eq(wire.calls, 3, 'fixture: one call each');
  });
  const saved = await loadMemory(s.id);
  for (const id of Object.keys(WHY)) {
    const rec = saved.nodes.find((n) => n.id === id).auditOpen[0].recovery;
    eq(rec.status, 'blocked', 'fixture: ' + id + ' set aside');
    Object.assign(rec, { attempts: 2, reason: WHY[id], verdictPolicy: 1 });
  }
  await saveMemory(s.id, saved);
  const pages = await pagesOf(s);
  eq(auditWaits(s.id, await loadMemory(s.id), pages), 0, 'due again at once');
  eq(auditProgress(await loadMemory(s.id), pages.length, pages).pending, 3, 'all three queued, not unresolved for good');
  const answers = { rim: rimVerdict({ shown: '"The council chased him out with donations," Vanessa said... "Donations in eleven minutes," Rias corrected her.' }),
    walk: walkVerdict([{ source: 'p11', shown: "Chloe did u see the lake path vid Maya caleb has it. he knows about the 4 o'clock walk" }]) };
  await withWire((said) => {
    const which = about(said);
    if (which === 'rim' || which === 'walk') return answers[which];
    return said.includes('Mrs. Dale to the whole lane') && /wrote \(/.test(said) ? postVerdict() : /\[find: Edie Dale\]/.test(said) ? '<fetch>["p3"]</fetch>' : '<fetch>["person: Edie Dale"]</fetch>';
  }, async (wire) => {
    for (let i = 0; i < 3; i += 1) await auditStretch({ connection: CONN, storyId: s.id });
    eq(wire.calls, 5, 'one call each, and Edie’s two looks');
    const mem = await loadMemory(s.id);
    const read = auditProgress(mem, pages.length, pages);
    eq(read.open + ' ' + read.pending, '0 0', 'nothing left open: the lamp has nothing of the continuous audit');
    eq(await auditStretch({ connection: CONN, storyId: s.id }), null, 'nothing more to read');
    eq(wire.calls, 5, 'and nothing more asked');
  });
  /* a correction its sources honestly left unknown, set aside under the old reading, stays set aside */
  const t = await hisTale('an honest unknown', ['walk']);
  await withWire(() => ({ ...walkVerdict([{ source: 'p11', shown: 'did u see the lake path vid' }]), sourceFidelity: { ...walkVerdict([]).sourceFidelity, status: 'genuinelyAmbiguous', sameReferent: null, relation: 'unclear', assertion: 'unclear', uncertainty: 'Nothing says who sent Caleb the video.' }, allegation: 'unknown', outcome: 'blocked', why: 'Nothing says who sent Caleb the video.' }), async () => {
    await auditStretch({ connection: CONN, storyId: t.id });
  });
  const tm = await loadMemory(t.id);
  const rec = tm.nodes.find((n) => n.id === 'walk').auditOpen[0].recovery;
  eq(rec.status + ' | ' + rec.reason, 'blocked | Nothing says who sent Caleb the video.', 'fixture: set aside, honestly');
  rec.verdictPolicy = 1;
  await saveMemory(t.id, tm);
  eq(auditWaits(t.id, await loadMemory(t.id), await pagesOf(t)), -1, 'not due again');
});
