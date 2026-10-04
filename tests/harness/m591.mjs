/* Cozy Tavern — harness law of M591: the header gate never loses the page's last line ("I just said hi — the provider ended
 * its answer after the thinking with no page in it… Nothing was cut by the house"). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { makeHeaderGate } from '../../js/ui/headergate.js';

function run(text, step) {
  let page = ''; let lead = '';
  const g = makeHeaderGate({ onThinking: (x) => { lead += x; }, onProse: (x) => { page += x; }, onGiveBack: (x) => { lead = lead.slice(0, lead.length - x.length); } });
  for (let i = 0; i < text.length; i += step) g.feed(text.slice(i, i + step));
  g.end();
  return { page, lead };
}

test('M591 THE LAST LINE IS ALWAYS HANDED ON: a reply whose planning was only judged at its end, then a short line with no break after it ("Hey there!"), keeps that line as the page — in any size of pieces; a reply with no header and no planning is the page whole', () => {
  for (const step of [1, 3, 7, 50, 1000]) {
    const a = run('Planning: greet him.\nBeat: a warm hello.\n\nHey there!', step);
    eq(a.page, 'Hey there!', 'the short last line is the page (pieces of ' + step + ')');
    assert(/Planning: greet him/.test(a.lead), 'the plan in the thinking');
    eq(run('Hi! How are you?', step).page, 'Hi! How are you?', 'no header, no plan: the page whole');
    eq(run('Plan: open warm.\n\n[The gate — Monday | 09:00]\n\nHey.', step).page, '[The gate — Monday | 09:00]\n\nHey.', 'a header after the plan: the page from the header, its last short line kept');
  }
});

test('M593 A VOICE PRESET KEPT UNDER AN ID THAT IS GONE, WITH NO NAME, IS NOTHING TO SAVE — never a throw', async () => {
  const { savePreset } = await import('../../js/engine/voicepresets.js');
  eq(await savePreset('', { tellerName: 'Hulk' }, { id: 'vp-gone' }), null);
  const kept = await savePreset('Hulk night', { tellerName: 'Hulk' });
  assert(kept && kept.name === 'Hulk night', 'a named one is kept');
});
