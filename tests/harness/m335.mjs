/* M335 — the teller's thinking was ordered to be a checklist; a teller with a self thinks in its own voice. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { buildRequest, STARTER_NOTE } from '../../js/assemble/stack.js';
import { CRAFT_TEXT } from '../../js/assemble/craft.js';
import { naturalThinking } from '../../js/assemble/voice.js';
import { houseEyeWords } from '../../js/agents/lint.js';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const state = applyMutations({ ...emptyState(), page: 3 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'The Wells kitchen' }, { type: 'presence.enter', name: 'Jovan' }]).state;
const EYE = houseEyeWords([{ kind: 'craft', severity: 'warn', words: 'Ghost Dialogue: a line was written for Jovan', law: 'Ghost Dialogue' }]);
const build = (settings, craft = CRAFT_TEXT) => buildRequest({ story: {}, messages: [{ id: 'u1', role: 'user', text: 'I answer her.' }], settings: { noteText: STARTER_NOTE, frameText: 'You are Tony Stark.', ...settings }, state, modules: [{ mod: { id: 'core-craft', name: 'The craft', text: craft }, reason: 'always' }], memory: '', window: { keeperOn: true, budgetTokens: 500000 }, houseEye: EYE });
const SHORTHAND = 'Your notes cover two things, in shorthand, never in prose:';

test('M335-1 THE WRITER’S PASTED THINKING ("Bruce’s ledger — backup checks out… canon check… Ledger Mi-na knows… hanging slot… GFX: no… Header: 13:19-ish"): the craft’s own Pass ORDERED notes "in shorthand, never in prose" about named machinery. For a teller with a self it asks for the same checks, thought in the teller’s own plain voice', () => {
  assert(CRAFT_TEXT.includes(SHORTHAND), 'fixture: the order, as the craft gives it');
  const craft = build({ tellerName: 'Tony Stark', writerName: 'Bruce' }).systemBlocks[1].text;
  assert(!craft.includes('in shorthand, never in prose'), 'the order for shorthand is gone');
  assert(/turn the scene over in your head the way you would before telling it to a friend: briefly, in your own voice, in plain sentences about these people/.test(craft), 'thought the way a person turns a scene over');
  assert(/Never name a rule, a heading, or where a fact is written while you think/.test(craft) && /never “canon check” or “the record confirms”/.test(craft) && /no inventory of what you are not doing this turn/.test(craft), 'and never in the machinery’s words — with his own examples');
  assert(/\nB — BEAT: /.test(craft) && /\nL — LAST LOOK: /.test(craft) && /None of the above reaches the page/.test(craft), 'THE CHECKS THEMSELVES ARE UNTOUCHED: the beat, the last look, and nothing of it on the page');
  assert(/nobody acts on the untold/.test(craft) && /no choice of MC's taken/.test(craft), 'what caught his three contradictions still stands');
});

test('M335-2 in the first person it is the teller’s own habit; with no teller to speak of, the craft is the craft, byte for byte; a craft of the writer’s own wording gets the same request at its end', () => {
  const asI = build({ frameText: 'I am Tony Stark. I tell Bruce stories.' }).systemBlocks[1].text;
  assert(/turn the scene over in my head the way I would before telling it to a friend: briefly, in my own voice/.test(asI) && /while I think/.test(asI) && /what I am not doing this turn/.test(asI), 'an "I" frame alone is a self: ' + asI.slice(asI.indexOf('## The Pass'), asI.indexOf('## The Pass') + 300));
  assert(/“she can’t know that yet — she only saw the truck go by”/.test(asI), 'the quoted examples are left as they are');
  const plain = build({}).systemBlocks[1].text;
  assert(plain.includes(SHORTHAND) && !/turn the scene over/.test(plain), 'no name, a "You" frame: not one word changes');
  eq(naturalThinking(CRAFT_TEXT, {}, 'second'), CRAFT_TEXT);
  const own = '## My own craft\nTell it straight.\n## My pass\nPlan, then write.';
  const forked = naturalThinking(own, { teller: 'Steve' }, 'second');
  assert(forked.startsWith(own) && /turn the scene over in your head/.test(forked) && !/Two things to settle:$/.test(forked), 'his own craft: the request is added at its end, his words untouched');
});

test('M335-3 the eye’s note no longer hands the teller a rule’s name to think aloud ("my earlier drift… recolor")', () => {
  assert(/Drift Recovery/.test(EYE), 'fixture: the note names the craft’s rule');
  const named = build({ tellerName: 'Tony Stark', writerName: 'Bruce' }).messages[0].content;
  assert(/Tony Stark — a few things in your last page drifted from the way this story is told\. That page\s+stands as written/.test(named) && !/Drift Recovery/.test(named), 'to a teller with a self: what happened, and no rule’s name: ' + (named.match(/Tony Stark — a few[^\n]{0,160}/) || [''])[0]);
  assert(/Ghost Dialogue: a line was written for Jovan/.test(named), 'what drifted is still said');
  assert(/\(your craft’s Drift Recovery\)/.test(build({}).messages[0].content), 'no teller to speak of: the note as it was');
});
