/* M343 — the older-model switch: OFF = not one byte; ON = the scene said once more, last, in the ledger's own words and the writer's voice. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { buildRequest } from '../../js/assemble/stack.js';
import { sceneAnchor } from '../../js/assemble/anchor.js';
import { CRAFT_TEXT } from '../../js/assemble/craft.js';
import { emptyState, renderStateFacts } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

function lakeside() {
  const st = applyMutations({ ...emptyState(), page: 40 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'clock.set', year: 2026, month: 8, day: 21, hour: 16, minute: 4 }, { type: 'place.set', name: 'Lakeside path, west-bench bend' },
    { type: 'presence.enter', name: 'Jovan', position: 'hand in hand with Aurora' }, { type: 'presence.enter', name: 'Aurora Sterling' }, { type: 'presence.enter', name: 'Claire Maxwell', position: 'three paces behind' },
    { type: 'knowledge.add', name: 'Aurora Sterling', fact: 'Jovan agreed by text to walk with her at four o’clock from her driveway' }]).state;
  return { ...st, page: 44 };
}
const build = (settings) => buildRequest({ story: { brief: 'Jovan, 16.' }, messages: [{ id: 'u1', role: 'user', text: 'How did you find us?' }], settings: { noteText: 'MY NOTE, AS I WROTE IT.', frameText: 'I am Tony Stark.', tellerName: 'Tony Stark', writerName: 'Bruce', ...settings }, state: lakeside(), modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: '', window: { keeperOn: true, budgetTokens: 500000 } });

test('M343-1 THE SWITCH, OFF (as it ships): not one byte of the request changes', () => {
  const plain = JSON.stringify(build({}));
  eq(JSON.stringify(build({ olderModelNow: false })), plain);
  eq(JSON.stringify(build({ olderModelNow: 'on' })), plain, 'only a true `true` turns it on');
  assert(!/right now, so it is in front of you/.test(plain));
});

test('M343-2 ON: the last thing the storyteller reads before the note is the scene in one breath — the hour, the ground, who is here, and what each was never shown learning — in the LEDGER’S OWN WORDS, in the writer’s voice, as facts and never as orders', () => {
  const r = build({ olderModelNow: true });
  const last = r.messages[r.messages.length - 1].content;
  assert(last.trimEnd().endsWith('MY NOTE, AS I WROTE IT.'), 'the note keeps the last word');
  const anchor = last.slice(0, last.lastIndexOf('MY NOTE')).trim();
  assert(/^Tony Stark — right now, so it is in front of you — The hour: /.test(anchor), anchor.slice(0, 120));
  const facts = renderStateFacts(lakeside(), { scenePages: ['How did you find us?'] }).split('\n');
  for (const head of ['The hour: ', 'The ground: ', 'Here now: ']) { const line = facts.find((l) => l.startsWith(head)); assert(line && anchor.includes(line), 'the ledger’s own line, to the letter: ' + head); }
  assert(/Claire Maxwell has not been shown learning: Jovan agreed by text to walk with her at four o’clock/.test(anchor), 'and her blind spot, where an older model looks hardest');
  eq(anchor.split('\n').length, 1, 'one breath — never a block');
  assert(anchor.length < 900, 'and short: ' + anchor.length);
  assert(!/\b(must|never|always|do not|don't|should|remember to)\b/i.test(anchor.replace(/has not been shown learning/g, '')), 'facts, not orders: ' + anchor);
  assert(!r.systemBlocks.some((b) => /right now, so it is in front of you/.test(b.text)), 'never in the rules');
  eq(r.messages.filter((m) => /right now, so it is in front of you/.test(m.content)).length, 1, 'said once');
});

test('M343-3 with nothing in the ledger there is nothing to say; with no teller named it is said plainly; with the think-on-page switch both ride, the note still last', () => {
  eq(sceneAnchor({ ...emptyState(), page: 0 }, {}), '');
  eq(sceneAnchor(null, {}), '');
  assert(/^Right now, so it is in front of you — The hour: /.test(sceneAnchor(lakeside(), {})), sceneAnchor(lakeside(), {}).slice(0, 60));
  const both = build({ olderModelNow: true, thinkOnPageNow: true });
  const last = both.messages[both.messages.length - 1].content;
  assert(last.indexOf('right now, so it is in front of you') < last.indexOf('<think>') && last.indexOf('<think>') < last.indexOf('MY NOTE'), 'the scene, then the think-line, then his note');
});
