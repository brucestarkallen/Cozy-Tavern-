/* M322 — everything before the header is thinking, not page. */
import { test, assert, eq } from './lib.mjs';
import { splitAtHeader, makeHeaderGate, headerIndex, planOnly, isHeaderLine, opensWithPlan } from '../../js/ui/headergate.js';
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
