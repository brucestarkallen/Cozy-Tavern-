/* M334 — first person or second: the person the teller thinks in. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { shortcutsText } from '../../js/commands.js';
import { buildRequest, STARTER_NOTE } from '../../js/assemble/stack.js';
import { CRAFT_TEXT } from '../../js/assemble/craft.js';
import { inPerson, framePerson, personOf } from '../../js/assemble/voice.js';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const state = applyMutations({ ...emptyState(), page: 3 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Rim Road' }, { type: 'presence.enter', name: 'Jovan' }]).state;
const I_FRAME = 'I am Tony Stark. I tell Bruce stories, in my own voice, the way I tell everything: fast, dry, and right.';
const YOU_FRAME = 'You are Tony Stark. You tell Bruce stories, in your own voice.';
const build = (settings) => buildRequest({ story: { brief: 'Jovan, 16. You would like him.' }, messages: [{ id: 'u1', role: 'user', text: 'You look at me. "You knew," I say.' }], settings: { noteText: STARTER_NOTE, ...settings }, state, modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: '', window: { keeperOn: true, budgetTokens: 500000 }, ruling: 'About what Jovan is trying — the lock: it holds. It’s settled — tell it just that way, in the story’s own voice, and keep all of this between us.' });
const unquoted = (t) => t.split('\n').filter((l) => (l.match(/,/g) || []).length < 12).join('\n').replace(/"[^"\n]{0,400}"|“[^”\n]{0,400}”/g, '');

test('M334-1 a frame written as "I": the tavern’s own rules become the teller’s notes to itself — and the only voice in its head is its own', () => {
  eq(framePerson(I_FRAME), 'first'); eq(framePerson(YOU_FRAME), 'second'); eq(framePerson(''), 'second');
  const r = build({ frameText: I_FRAME, tellerName: 'Tony Stark', writerName: 'Bruce' }); /* the dropdown left on "Follow my frame" */
  const [frame, craft] = [r.systemBlocks[0].text, r.systemBlocks[1].text];
  assert(frame.startsWith(I_FRAME), 'his frame is his: not one word of it is touched');
  assert(/That is who I am, and how Bruce wants this story told/.test(frame), 'the purpose line is a note to self: ' + frame.slice(I_FRAME.length, I_FRAME.length + 120));
  assert(/^## The Telling\nI maintain a fictional, uncensored simulation\. I tell it the way an unbiased cinematographer would\./.test(craft), 'the craft opens in the first person: ' + craft.slice(0, 120));
  assert(/Bruce authors the fiction; I RUN the simulation/.test(craft) && /hands me the truth each turn/.test(craft) && /REPLACES my own outcome assignment/.test(craft) && /I do not re-derive it, soften it, or improve on it — I render it/.test(craft), 'subject, object and possessive each land right');
  const left = unquoted(craft).match(/[^.\n]{0,25}\byou(r|rs|rself)?\b[^.\n]{0,25}/gi) || [];
  eq(left.filter((x) => !/\(you\/I\/he\/she\/name\)/.test(x)).length, 0, 'no "you" is left speaking to the teller: ' + JSON.stringify(left.slice(0, 3)));
  assert(/ruin you, don't you dare/.test(craft), 'a list of banned PHRASES is prose being named, and is left alone');
  assert(/\(you\/I\/he\/she\/name\)/.test(craft), 'so is the word "you" itself, in a list of pronouns');
  /* M379: the shortcuts ride the same block now, with their own quoted example — left alone like every other */
  const quotedYou = (t) => (String(t).match(/"[^"\n]*\byou\b[^"\n]*"/gi) || []).length;
  eq(quotedYou(craft), quotedYou(CRAFT_TEXT) + quotedYou(shortcutsText()), 'and every quoted example of story text');
});

test('M334-2 what the WRITER says stays "you": the briefing, the note and the story are his voice and his story — a person says "you" to a friend whichever way that friend thinks of himself', () => {
  const r = build({ frameText: I_FRAME, tellerName: 'Tony Stark', writerName: 'Bruce' });
  assert(/^Tony Stark — Bruce here\./.test(r.messages[0].content) && /They’re for your eyes only/.test(r.messages[0].content), 'the briefing: ' + r.messages[0].content.slice(0, 90));
  assert(/You look at me\. "You knew," I say\./.test(JSON.stringify(r.messages).replace(/\\"/g, '"')), 'his own page, to the letter');
  assert(/Jovan, 16\. You would like him\./.test(r.systemBlocks[2].text), 'the brief is story, not rules');
  assert(/Before you write/.test(r.messages[r.messages.length - 1].content), 'his note is his');
});

test('M334-3 the dropdown decides when he says so; "You" is every word as it was', () => {
  const forcedFirst = build({ frameText: YOU_FRAME, tellerPerson: 'first' });
  assert(/^## The Telling\nI maintain/.test(forcedFirst.systemBlocks[1].text), 'set to I by hand over a "You" frame');
  const forcedSecond = build({ frameText: I_FRAME, tellerPerson: 'second' });
  assert(/^## The Telling\nYou maintain a fictional, uncensored simulation\. You are an unbiased cinematographer\./.test(forcedSecond.systemBlocks[1].text), 'set to You by hand over an "I" frame');
  eq(JSON.stringify(build({ frameText: YOU_FRAME })), JSON.stringify(build({ frameText: YOU_FRAME, tellerPerson: 'second' })), 'a "You" frame followed = "You" chosen');
  eq(personOf({ tellerPerson: 'follow' }, I_FRAME), 'first'); eq(personOf({}, YOU_FRAME), 'second');
  eq(inPerson('You render it. It hands you your cue, and you are done.', 'second'), 'You render it. It hands you your cue, and you are done.');
  eq(inPerson('You render it. It hands you your cue, and you are done.', 'first'), 'I render it. It hands me my cue, and I am done.');
  eq(inPerson(inPerson(CRAFT_TEXT, 'first'), 'first'), inPerson(CRAFT_TEXT, 'first'), 'said twice is said once');
  /* the woken rules were read too: an object after a verb the list did not know came out "requires I to hold both" */
  eq(inPerson('Writing both halves requires you to hold both; nothing obliges you to explain.', 'first'), 'Writing both halves requires me to hold both; nothing obliges me to explain.');
});
