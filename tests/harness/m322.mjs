/* M322 — everything before the header is thinking, not page. */
import { test, assert, eq } from './lib.mjs';
import { splitAtHeader, makeHeaderGate, headerIndex } from '../../js/ui/headergate.js';
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
