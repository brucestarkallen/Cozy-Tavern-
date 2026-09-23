/* M432: a SillyTavern preset comes in as ST used it — the enabled flags of the order ST actually uses (the global 100001),
 * and a block switched off there (or in no order at all) starts unticked, never brought in on. Runs the real parser and
 * the real sorting. */
import { test, assert, eq } from './lib.mjs';
import { parsePreset, decompose } from '../../js/import/sillytavern.js';

test('M432-1 A BLOCK HE SWITCHED OFF COMES IN OFF: the global order decides (not the stale 100000 one), and a block in no order of it starts unticked', () => {
  const preset = {
    prompts: [
      { identifier: 'old', name: 'Old Rule', content: 'The old way of telling it, which he turned off.' },
      { identifier: 'cur', name: 'Current Rule', content: 'The way he tells it now.' },
      { identifier: 'orph', name: 'Orphan Rule', content: 'A block in no order he uses.' },
    ],
    prompt_order: [
      { character_id: 100000, order: [{ identifier: 'old', enabled: true }, { identifier: 'orph', enabled: true }] },
      { character_id: 100001, order: [{ identifier: 'old', enabled: false }, { identifier: 'cur', enabled: true }] },
    ],
  };
  const { entries } = parsePreset(JSON.stringify(preset));
  const byName = Object.fromEntries(entries.map((e) => [e.name, e.enabled]));
  eq(byName['Old Rule'], false, 'off, as the global order has it — never the stale 100000');
  eq(byName['Current Rule'], true, 'on, as the global order has it');
  eq(byName['Orphan Rule'], false, 'in no order ST uses: not in the prompt, so off');
  const plan = decompose(entries);
  const all = [...plan.craft, ...plan.modules];
  const item = (n) => all.find((x) => x.name === n);
  assert(item('Old Rule') && item('Old Rule').include === false && item('Old Rule').wasOff === true, 'switched off: listed, unticked, and says so');
  assert(item('Current Rule') && item('Current Rule').include === true, 'switched on: ticked');
  assert(item('Orphan Rule') && item('Orphan Rule').include === false, 'in no order: unticked');
  const single = parsePreset(JSON.stringify({ prompts: [{ identifier: 'a', name: 'A Rule', content: 'x' }], prompt_order: [{ character_id: 100000, order: [{ identifier: 'a', enabled: true }] }] }));
  eq(single.entries[0].enabled, true, 'a file with one order reads that order');
  const none = parsePreset(JSON.stringify({ prompts: [{ identifier: 'a', name: 'A Rule', content: 'x' }] }));
  eq(none.entries[0].enabled, true, 'a file with no order at all reads everything as on (and says so)');
});
