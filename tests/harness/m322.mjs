/* M322 — everything before the header is thinking, not page. */
import { test, assert, eq } from './lib.mjs';
import { splitAtHeader, splitReply, pageOnly, makeHeaderGate, headerIndex, planOnly, isHeaderLine, opensWithPlan, headerKey } from '../../js/ui/headergate.js';
import { headerMutations } from '../../js/engine/state.js';

const HEADER = '[The Wells house — Friday, March 14, 2025 | 20:40 | clear | gray hoodie | on the porch]';
const LEAK = 'Okay — quiet lunch beat. Vanessa is his friend; keep the slow undertone, nothing new.\nB: she deflects. L: header first, no meta.\n\n';
const PAGE = HEADER + '\n\nThey sat on the steps until the street went quiet. "You knew," Liara said.';

function run(pieces, opts) {
  const out = { thinking: '', prose: '', gaveBack: '' , order: [] };
  const gate = makeHeaderGate({ onThinking: (t) => { out.thinking += t; out.order.push('T'); }, onProse: (t) => { out.prose += t; out.order.push('P'); }, onGiveBack: (t) => { out.gaveBack += t; out.thinking = out.thinking.slice(0, out.thinking.length - t.length); }, ...opts });
  for (const p of pieces) gate.feed(p);
  gate.end();
  return out;
}
const chunks = (s, n) => { const a = []; for (let i = 0; i < s.length; i += n) a.push(s.slice(i, i + n)); return a; };

test('M322-1 a reply that thinks aloud before its header: the thinking is thinking, the page begins at its header — and the house can read the ground and the hour again', () => {
  const whole = splitAtHeader(LEAK + PAGE);
  eq(whole.page, PAGE); eq(whole.lead, LEAK.trimEnd());
  eq(headerMutations(LEAK + PAGE).length, 0, 'fixture: with the leak in front, the house could not read the header at all');
  eq(headerMutations(whole.page).map((m) => m.type).join(','), 'place.set,clock.set', 'cut at the header, it reads the ground and the hour');
  /* as it streams, in pieces of every size — the same split, the thinking first */
  for (const n of [1, 3, 7, 40, 500]) {
    const r = run(chunks(LEAK + PAGE, n));
    eq(r.prose, PAGE, 'pieces of ' + n + ': the page');
    eq(r.thinking.trim(), LEAK.trim(), 'pieces of ' + n + ': the thinking');
    assert(r.order.indexOf('P') > r.order.lastIndexOf('T'), 'no word of the page is shown before the thinking is done');
  }
});

test('M322-2 a page that opens with its header is not held back or touched; a dressed header is still a header; a bracket in the thinking is not', () => {
  const r = run(chunks(PAGE, 5));
  eq(r.prose, PAGE); eq(r.thinking, '');
  eq(splitAtHeader('\n\n' + PAGE).page, PAGE, 'leading blank lines are nobody’s thinking');
  eq(splitAtHeader('**' + HEADER + '**\n\nProse.').lead, '', 'a header in bold is first all the same');
  const tricky = 'Plan: [note to self] keep it short. Options [a | b].\n' + PAGE;
  eq(splitAtHeader(tricky).page, PAGE, 'a bracket with no clock in it is not the header');
  eq(headerIndex('no header here at all [just | a list]'), -1);
});

test('M322-3 nothing is ever thrown away: a reply with no header at all comes back whole as the page, whether it ends or runs long', () => {
  const plain = 'She laughed and said nothing for a while.\nThen she stood.\n';
  const ended = run(chunks(plain, 4));
  eq(ended.prose, plain, 'the whole of it is the page'); eq(ended.thinking, '', 'and nothing of it is left as thinking'); eq(ended.gaveBack, 'She laughed and said nothing for a while.\nThen she stood.\n'.slice(0, ended.gaveBack.length));
  const long = ('A line of a page with no header.\n').repeat(60);
  const ran = run(chunks(long, 50), { giveUpAt: 600 });
  eq(ran.prose, long, 'past the give-up mark it stops holding and hands everything over');
  eq(ran.thinking, '');
  eq(splitAtHeader(plain).page, plain);
});

/* ---------- M324 ---------- */
const PLAN = 'Planning: Jovan giggles and wonders aloud about Ravenwood High once school starts — Rias answers as the insider, the VP, the cheer captain, teasing and informative.\nShe\'d mention the power centers (student council, football, cheer), maybe hint at Caleb without belaboring it.\n\nBeat: world answers through Rias, the school\'s ecosystem painted through her insider lens. Small movement: traffic, the sedan ahead, the lake. No slot needed.\n\n';
const PROSE = 'Rias laughed without taking her eyes off the road. "Oh, you have no idea."\n\nThe lake slid past on the left, flat and bright.';

test('M324-1 THE WRITER’S SCREEN: a reply that plans ("Planning: … Beat: …") and then writes its page with NO header at all — the plan is thinking, the page begins at the first paragraph that is not plan', () => {
  eq(headerIndex(PLAN + PROSE), -1, 'fixture: there is no header in this reply — M322 handed the whole of it back as the page');
  const cut = splitAtHeader(PLAN + PROSE);
  eq(cut.page, PROSE); eq(cut.lead, PLAN.trimEnd());
  for (const n of [1, 5, 60]) {
    const r = run(chunks(PLAN + PROSE, n));
    eq(r.prose, PROSE, 'streamed ' + n + ' at a time: the page');
    eq(r.thinking.trim(), PLAN.trim(), 'and the plan');
    eq(r.gaveBack, '', 'nothing was shown as thinking and then taken back');
  }
  /* the Pass's own letters */
  eq(splitAtHeader('B: she deflects.\nL: no meta.\n\n' + PROSE).page, PROSE);
  /* a page that merely OPENS with a plain paragraph is left alone — no label, no plan */
  eq(splitAtHeader(PROSE).lead, '');
  eq(run(chunks(PROSE, 7)).prose, PROSE);
});

test('M324-2 a header is a header however it is dressed or spelled: no pipe but a clock, a pipe but no clock, in bold, in backticks, 13.08 — and a plan, then a header, is still cut at the header', () => {
  for (const h of ['[Rim Road, inland stretch — Friday, August 21, 2026 — 13:08]', '[Rim Road | Friday | clear | white tee | passenger seat]', '**[Rim Road — Friday, August 21, 2026 | 13:08 | clear]**', '`[Rim Road — Friday | 13.08 | clear]`', '> [Rim Road — Friday | 13:08]']) {
    assert(isHeaderLine(h), 'a header: ' + h);
    eq(splitAtHeader(PLAN + h + '\n\n' + PROSE).page, h + '\n\n' + PROSE, 'cut at it: ' + h);
  }
  for (const not of ['[note to self]', '[a | b] and then more words', 'Options: [a | b]', '[x]']) assert(!isHeaderLine(not), 'not a header: ' + not);
  const r = run(chunks(PLAN + HEADER + '\n\n' + PROSE, 3));
  eq(r.prose, HEADER + '\n\n' + PROSE, 'plan, header, page: the page begins at its header, never at the paragraph before it');
});

test('M324-3 a reply that is ALL plan has no page in it — it says so, so the page can be asked for; and it is handed back whole, never thrown away', () => {
  assert(planOnly(PLAN)); assert(!planOnly(PLAN + PROSE)); assert(!planOnly(PROSE)); assert(!planOnly(PLAN + HEADER));
  const r = run(chunks(PLAN, 4));
  eq(r.prose, PLAN, 'handed back whole'); eq(r.thinking, '');
});

test('M325-1 a reply that opens with a plan is known as one whatever follows it — the sign chat.js uses, in a tale whose pages open with a header, to know that a reply with NO header holds no page', () => {
  const trailing = PLAN + 'I should keep it light and end on her question.';
  assert(opensWithPlan(trailing) && headerIndex(trailing) === -1, 'opens with a plan, no header');
  assert(!planOnly(trailing), 'fixture: by labels alone its last paragraph would have been taken for the page');
  assert(opensWithPlan('Planning: one paragraph only,\nover two lines, ending in a full stop.'), 'a single paragraph');
  assert(!opensWithPlan(PROSE) && !opensWithPlan(HEADER + '\n\n' + PROSE) && !opensWithPlan(''), 'a page does not');
});

/* ---------- M326: the writer's five screenshots of one reply ---------- */
const H1 = '[Rim road, moving between overlooks — Friday, August 21, 2026 | 13:11 | sun strobing through the tree line, AC on the lowest setting, lake gold in the windshield | gray tee, dark jeans | passenger seat, basket on his lap]';
const H2 = '[Rim road, moving between overlooks — Friday, August 21, 2026 | 13:11 | sun strobing through the tree line, AC on low, lake gold in the windshield | gray tee, dark jeans | passenger seat, basket on his lap]';
const THOUGHT = 'Okay. #p — one beat. Rias just said something she regrets; keep her silent.\n\n';
const DRAFT1 = H1 + '\n\nThirty seconds had gone. The turnout was behind them. The lake slid on past the driver\'s side window in a long ribbon of white-gold glitter.\n\nRias\'s right hand tightened on the wheel — a slow flex — and then let go.\n\n';
const CRIT1 = 'That\'s solid. Let me check:\n- MC silence ✓ (he literally has an action completion — eating — invented? Hmm. He was eating in the last turn when he said the line.\n\n---\n\n';
const DRAFT2 = H2 + '\n\nThirty seconds had gone. The turnout was behind them.\n\nRias\'s right hand tightened on the wheel — a slow flex, controlled — then let go.\n\nGood lord, what did I just say?\n\nShe glanced sideways at him.\n\n';
const CRIT2 = 'Good — ends on image, quiet, no MC invention. Let me reconstruct final:\n\n---\n\n';
const FINAL = H2 + '\n\nThirty seconds had gone. The turnout was behind them.\n\nRias\'s right hand tightened on the wheel — a slow, controlled flex — then let go.\n\nGood lord, what did I just say?\n\nShe glanced sideways at him. Jovan was finishing the fry he\'d been chewing, and the lake went by.';
const CHECKS = '\n\nThought tag: one. ✓\n\nNo window beyond the page — #p wants exactly ONE beat, a window would be a second scene. Skip.\n\nDialogue ratio: 0% this turn (Rias silent). "NPC spoken dialogue 20-50% of the output" — for a #p one-beat turn that ratio bends; the brief says Length Follows The Scene. Fine.\n\nPost-send checks: no banned words ✓ (jaw, breath, husky, velvet — no) ✓ / no markdown in prose ✓ / header as single line ✓\n\nShip it.';
const REPLY = THOUGHT + DRAFT1 + CRIT1 + DRAFT2 + CRIT2 + FINAL + CHECKS;

test('M326-1 THE WRITER’S FIVE SCREENSHOTS: a plan, three drafts under the same header with critiques between them, and a checklist after — the page is the LAST draft and nothing else; every other word of the reply is its thinking', () => {
  eq(headerKey(H1), headerKey(H2), 'the same header, though the model reworded the weather between drafts');
  const cut = splitReply(REPLY);
  eq(cut.page, FINAL, 'the page he was never given');
  assert(cut.lead.startsWith('Okay. #p') && /That's solid\. Let me check/.test(cut.lead) && /Let me reconstruct final/.test(cut.lead) && cut.lead.includes('a slow flex — and then let go'), 'plan, drafts and critiques are the lead');
  assert(cut.tail.startsWith('Thought tag: one.') && cut.tail.endsWith('Ship it.'), 'the checklist is the tail: ' + cut.tail.slice(0, 40));
  eq(pageOnly(REPLY), FINAL, 'and a later turn is sent the page alone');
  const both = splitAtHeader(REPLY);
  assert(both.lead.includes('Okay. #p') && both.lead.includes('Ship it.') && !both.lead.includes('a slow, controlled flex'), 'all the thinking, none of the page');
  assert(!/✓|Let me|Ship it|That's solid/.test(cut.page), 'not one word of the model talking to itself is left on the page');
});

test('M326-2 as it streams: each draft is shown while it is the newest, taken away when the header comes again, and the checklist never reaches the page', () => {
  for (const n of [1, 4, 37]) {
    let page = ''; let thinking = ''; let restarts = 0;
    const gate = makeHeaderGate({ onThinking: (t) => { thinking += t; }, onProse: (t) => { page += t; }, onGiveBack: () => {}, onRestart: () => { thinking += page; page = ''; restarts += 1; } });
    for (const piece of chunks(REPLY, n)) gate.feed(piece);
    gate.end();
    eq(restarts, 2, n + ' at a time: the page was started again twice');
    eq(page.trim(), FINAL.trim(), n + ' at a time: what stands on the page at the end is the final draft');
    assert(thinking.includes('Ship it.') && thinking.includes('That\'s solid') && !page.includes('✓'), 'the rest went to the thinking');
  }
});

test('M326-3 what must NOT be cut: a window beyond the page (another place) stays in the page; a page with one header and no checks is whole; prose that merely says "good" or holds a colon is prose', () => {
  const windowed = H1 + '\n\nThe lake slid past.\n\n[Ravenwood High, east lot — Friday, August 21, 2026 | 13:11]\n\nEmilia checked her phone again.';
  eq(splitReply(windowed).page, windowed, 'a different place is a window, not a draft');
  const plain = H1 + '\n\n"Good — you made it," she said.\n\nHe read the sign: CLOSED UNTIL MONDAY.\n\nThe note said: back at five.';
  eq(splitReply(plain).page, plain); eq(splitReply(plain).tail, '');
  const r = run(chunks(plain, 5)); eq(r.prose, plain, 'and it streams through untouched'); eq(r.thinking, '');
  const headerOnly = H1 + '\n\nLet me check: nothing written yet.';
  eq(splitReply(headerOnly).page, headerOnly, 'a header with nothing under it is never cut down to a bare header');
});
