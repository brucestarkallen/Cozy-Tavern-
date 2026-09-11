/* M75 — the housekeeper is decisive, on the storyteller's brains: an asked-for
 * change answered in prose is sent back until the block is there; a brief
 * asked to change without a <brief> block is sent back; it rides the
 * storyteller's connection unless given hands of its own. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { emptyState } from '../../js/engine/state.js';
import { runConversation, asksForChange, asksAboutBrief, claimsChange, hasAnyBlock, parseProtocol } from '../../js/agents/housekeeper.js';

const story = { title: 'Ravenwood', brief: 'Alexia (20), the eldest of the house.\nFirst-years board at the academy.', castNotes: '' };
const house = (writerText, answers) => {
  const sent = [];
  const call = async ({ messages }) => { sent.push(messages[messages.length - 1].content); return { text: answers[Math.min(sent.length - 1, answers.length - 1)] }; };
  return { sent, run: () => runConversation({ story, messages: [], state: emptyState(), modules: [], lore: [], memory: { nodes: [] }, session: { turns: [] }, writerText, contextPages: 8, call }) };
};

test('M75-1 the words: what asks for a change, what names the brief, what claims one', () => {
  assert(asksForChange('change the brief: Alexia age 20 to 19'));
  assert(asksForChange('all first year students are 16, not 15'));
  assert(!asksForChange('who is Alexia?'));
  assert(asksAboutBrief('change the brief: Alexia is 19') && asksAboutBrief('add to the cast notes') && !asksAboutBrief('fix page 3'));
  assert(claimsChange('Done — Alexia is 19 now.') && claimsChange('I have updated the brief.') && !claimsChange('Alexia is 20 in the brief; the pages agree.'));
  assert(hasAnyBlock(parseProtocol('<brief>[{"field":"brief","find":"a","replace":"b"}]</brief>')) && !hasAnyBlock(parseProtocol('just words')));
});

test('M75-2 "change the brief: Alexia 20 → 19" answered as a statement is sent back until the <brief> block is there', async () => {
  const h = house('change the brief: Alexia age 20 to 19', [
    'Noted: Alexia is 20, not 19.',
    'Alexia is 19.\n<brief>[{"field":"brief","find":"Alexia (20)","replace":"Alexia (19)","reason":"the writer set her age"}]</brief>',
  ]);
  const r = await h.run();
  assert(r.ok, r.error);
  eq(h.sent.length, 2, 'asked twice');
  assert(/^\[THE BRIEF\]/.test(h.sent[1]), 'the second ask names the brief: ' + h.sent[1].slice(0, 60));
  eq(r.parsed.brief.length, 1); eq(r.parsed.brief[0].find, 'Alexia (20)');
});

test('M75-3 a "standing rule" instead of the brief is sent back; a change answered with no block at all is sent back; a plain question is not', async () => {
  /* the model added a lore entry when asked to change the brief */
  const h1 = house('in the brief, all first year students are 16', [
    'Added a standing rule.\n<lore>[{"add":true,"name":"First-years","keys":["first-year"],"content":"First-years are 16."}]</lore>',
    'Placed beside the boarding line.\n<brief>[{"field":"brief","find":"First-years board at the academy.","replace":"First-years board at the academy. First-years are 16.","reason":"the writer set it"}]</brief>',
  ]);
  const r1 = await h1.run();
  assert(r1.ok && r1.parsed.brief.length === 1, JSON.stringify(r1.parsed && r1.parsed.brief));
  assert(/^\[THE BRIEF\]/.test(h1.sent[1]));
  /* no block at all for an asked change */
  const h2 = house('rename Kim to Kris on page 3', ['I can do that for you.', 'Done.\n<edits>[{"id":"#abc","find":"Kim","replace":"Kris"}]</edits>']);
  const r2 = await h2.run();
  assert(r2.ok && /^\[NOTHING HAPPENED\]/.test(h2.sent[1]), h2.sent[1].slice(0, 40));
  /* a claim with no block, for an ask that is not obviously a change */
  const h3 = house('is Alexia 19?', ['Done — I set her to 19.', 'No — the brief says 20. Say the word and I will change it: it would be a <brief> card.']);
  const r3 = await h3.run();
  assert(r3.ok && h3.sent.length === 2 && /NOTHING HAPPENED/.test(h3.sent[1]), 'a claimed change with no block is sent back');
  /* a plain question, answered plainly, is not sent back */
  const h4 = house('who is Alexia?', ['Alexia (20) is the eldest of the house, by the brief.']);
  const r4 = await h4.run();
  assert(r4.ok && h4.sent.length === 1, 'one ask');
  /* and only once: a model that never gives the block is not asked forever */
  const h5 = house('change the brief: Alexia is 19', ['Alexia is 20.', 'Alexia is 20, truly.', 'Alexia is 20, I insist.']);
  const r5 = await h5.run();
  assert(r5.ok && h5.sent.length <= 3, 'at most one round per nudge: ' + h5.sent.length);
});

test('M75-4 the prompt is decisive and shows the worked brief example; the housekeeper rides the storyteller’s connection by default', () => {
  const src = readFileSync(new URL('../../js/agents/housekeeper.js', import.meta.url), 'utf8');
  const prompt = src.slice(src.indexOf('const SYSTEM_PROMPT = ['), src.indexOf("].join('\\n');", src.indexOf('const SYSTEM_PROMPT = [')));
  assert(/BE DECISIVE\. When the writer asks for a change, the block that makes it is in/.test(prompt));
  assert(/Alexia \(20\), the eldest/.test(prompt) && /"replace":"Alexia \(19\), the eldest"/.test(prompt), 'the worked example');
  assert(/A fact the brief already states is REPLACED where it stands/.test(prompt));
  const ui = readFileSync(new URL('../../js/ui/housekeeper.js', import.meta.url), 'utf8');
  const rc = ui.slice(ui.indexOf('async function resolveWorkerConnection('), ui.indexOf('async function resolveWorkerConnection(') + 1400);
  assert(rc.indexOf('map.housekeeper') < rc.indexOf('story.connectionId') && rc.indexOf('story.connectionId') < rc.indexOf("'activeConnectionId'") && rc.indexOf("'activeConnectionId'") < rc.indexOf("'workerConnectionId'"), 'its own hands, else the story’s teller, else the active teller, else the workers — in that order');
});
