/* M327 — the two names: who tells, and who listens. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { buildRequest, STARTER_FRAME, STARTER_NOTE, STATE_MARKER } from '../../js/assemble/stack.js';
import { CRAFT_TEXT } from '../../js/assemble/craft.js';
import { voiceOf, inVoice, briefingOpening, isBriefing, cleanName } from '../../js/assemble/voice.js';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const state = applyMutations({ ...emptyState(), page: 3 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'The old house on Rim Road' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rias Wells' }]).state;
const PAGES = [{ id: 'u1', role: 'user', text: 'We walk up to the house. The writer in me wants to describe it.' }, { id: 'a1', role: 'assistant', text: '[Rim Road — Friday | 13:08]\n\nThe house stood dark at the end of the drive.' }, { id: 'u2', role: 'user', text: 'I knock.' }];
const build = (settings) => buildRequest({ story: { brief: 'The writer of this brief says: the house on Rim Road is haunted.' }, messages: PAGES, settings: { frameText: 'You are Tony Stark. You tell the writer stories.', noteText: STARTER_NOTE, ...settings }, state, modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: '', window: { keeperOn: true, budgetTokens: 500000 }, ruling: 'About what Jovan is trying — the lock: it holds. It’s settled — tell it just that way, in the story’s own voice, and keep all of this between us.' });
const houseWords = (r) => [r.systemBlocks[0].text, r.systemBlocks[1].text, r.messages[0].content.split('\n\n')[0], r.messages[r.messages.length - 1].content].join('\n~~\n');

test('M327-1 with both names: every word the HOUSE wrote is said to Tony, as Bruce — and not one word of it says writer, house, persona or role', () => {
  const r = build({ tellerName: 'Tony Stark', writerName: 'Bruce' });
  const said = houseWords(r);
  assert(/^Tony Stark — Bruce here\. This is where things stand in our story right now/.test(r.messages[0].content), 'the briefing opens as Bruce speaking to Tony: ' + r.messages[0].content.slice(0, 70));
  assert(/Tony Stark, that is how Bruce wants this story told/.test(r.systemBlocks[0].text), 'the frame’s purpose line');
  assert(/You tell Bruce stories\./.test(r.systemBlocks[0].text), 'his own frame says his name where it said "the writer"');
  assert(/Bruce authors the fiction; you RUN the simulation/.test(r.systemBlocks[1].text), 'the craft: ' + (r.systemBlocks[1].text.match(/[^.\n]*authors the fiction[^.\n]*/) || [''])[0]);
  assert(/Bruce’s notebook keeps the world between turns/.test(r.systemBlocks[1].text) && /Bruce’s closing words say how an attempt of his turns out/.test(r.systemBlocks[1].text) /* M345: the craft teaches the words the outcome opens with */, '"the house" is his notebook — in the craft’s teaching…');
  /* M345: the settled outcome rides first in the closing words, led by the teller's name — the form the craft teaches */
  assert(/^Tony Stark — about what Jovan is trying — the lock: it holds\./.test(r.messages[r.messages.length - 1].content), '…and the closing words open the way the craft says they do');
  assert(/end where Bruce has something/.test(r.messages[r.messages.length - 1].content), 'the note');
  /* ("Bruce comes to you as their storyteller" stays — that is what Tony is to him, not form-speak) */
  assert(!/\bwriter\b|\bhouse\b|\bthe storyteller\b|\bpersona\b|\bcharacter you\b|\bstory app\b/i.test(said), 'none of the form-speak is left in the house’s own words: ' + (said.match(/[^\n]{0,40}\b(writer|house|the storyteller|persona|story app)\b[^\n]{0,30}/i) || [''])[0]);
});

test('M327-2 the STORY is never touched: a house in a page, in the brief, in the ledger stays a house; the writer’s own typed words stay his', () => {
  const r = build({ tellerName: 'Tony Stark', writerName: 'Bruce' });
  const wire = JSON.stringify(r.messages);
  assert(/We walk up to the house\. The writer in me wants to describe it\./.test(wire), 'his own page, word for word');
  assert(/The house stood dark at the end of the drive/.test(wire), 'the storyteller’s page');
  assert(/The old house on Rim Road/.test(r.messages[0].content), 'the ledger’s ground');
  assert(/The writer of this brief says: the house on Rim Road is haunted\./.test(r.systemBlocks[2].text), 'the brief');
});

test('M327-3 change the name and the next request is for Steve; clear both and every word is exactly what it was', () => {
  const steve = build({ tellerName: 'Steve', writerName: 'Jovan' });
  assert(/^Steve — Jovan here\./.test(steve.messages[0].content), 'the briefing greets Steve, as Jovan');
  assert(/Jovan authors the fiction/.test(steve.systemBlocks[1].text) && /Steve, that is how Jovan wants/.test(steve.systemBlocks[0].text), 'the craft and the purpose line');
  assert(!/Bruce/.test(houseWords(steve)) && !/Tony/.test(steve.systemBlocks[1].text + steve.messages[0].content), 'nothing of the names before is left (his frame is his own to change)');
  const none = build({});
  const was = build({ tellerName: '   ', writerName: '' });
  eq(JSON.stringify(none), JSON.stringify(was), 'blank names are no names');
  assert(none.messages[0].content.startsWith(STATE_MARKER), 'the briefing opens as it did');
  assert(/the writer authors the fiction/.test(none.systemBlocks[1].text) && /The house keeps the world between turns/.test(none.systemBlocks[1].text), 'the craft is the craft');
  for (const v of [{}, { teller: 'Tony' }, { writer: 'Bruce' }, { teller: 'Tony', writer: 'Bruce' }]) assert(isBriefing(briefingOpening(v) + '\n\nnotes'), 'the briefing is known by any of its openings');
  eq(cleanName('  Tony\n[Stark] {x}  '), 'Tony Stark x', 'a name is a name: no brackets, no line breaks');
  eq(inVoice('the writer’s own; The writer; the house’s word', { writer: 'Rias' }), 'Rias’ own; Rias; Rias’ notebook’s word');
});

test('M333-1 one "You are": with a teller named, the only identity the storyteller is handed is the one in the writer’s frame — the craft’s cinematographer is a manner, its rule unchanged; with no teller named the craft is the craft', () => {
  const named = build({ tellerName: 'Tony Stark', writerName: 'Bruce' });
  const sys = named.systemBlocks.map((b) => b.text).join('\n');
  eq((sys.match(/\bYou are\b/g) || []).length, 1, 'one "You are" — his: ' + JSON.stringify((sys.match(/\bYou are\b[^.\n]{0,40}/g) || [])));
  assert(/^You are Tony Stark\./.test(named.systemBlocks[0].text), 'and it is the frame’s');
  assert(/You tell it the way an unbiased cinematographer would\. Prose is grounded, concrete, literal\./.test(sys), 'the craft’s rule is still there, as a manner');
  const tellerOnly = build({ tellerName: 'Steve' });
  assert(/the way an unbiased cinematographer would/.test(tellerOnly.systemBlocks[1].text) && /the writer authors the fiction/.test(tellerOnly.systemBlocks[1].text), 'a teller’s name alone is enough for it (the writer’s words untouched)');
  assert(/You are an unbiased cinematographer\./.test(build({}).systemBlocks[1].text) && /You are an unbiased cinematographer\./.test(build({ writerName: 'Bruce' }).systemBlocks[1].text), 'no teller named: the craft as it was');
});
