/* M343 — the older-model switch: OFF = not one byte; ON = the scene said once more, last, in the ledger's own words and the writer's voice. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { buildRequest } from '../../js/assemble/stack.js';
import { sceneAnchor, recallFromRecord, recallLine } from '../../js/assemble/anchor.js';
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
  /* M354: with the switch on, the closing words carry the five plain lines too — the scene is its own part, still one breath */
  const anchor = last.split('\n\n').find((part) => /right now, so it is in front of you/.test(part)) || '';
  assert(/^Tony Stark — right now, so it is in front of you — The hour: /.test(anchor), anchor.slice(0, 120));
  const facts = renderStateFacts(lakeside(), { scenePages: ['How did you find us?'] }).split('\n');
  for (const head of ['The hour: ', 'The ground: ', 'Here now: ']) { const line = facts.find((l) => l.startsWith(head)); assert(line && anchor.includes(line), 'the ledger’s own line, to the letter: ' + head); }
  assert(/Claire Maxwell hasn’t found out: Jovan agreed by text to walk with her at four o’clock/.test(anchor), 'and her blind spot, where an older model looks hardest');
  eq(anchor.split('\n').length, 1, 'one breath — never a block');
  const parts = last.split('\n\n');
  assert(parts.indexOf(anchor) < parts.findIndex((p) => /five things/.test(p)), 'M354: the scene first, then the five plain lines');
  assert(last.trimEnd().endsWith('MY NOTE, AS I WROTE IT.'), 'and his note still last of all');
  assert(anchor.length < 900, 'and short: ' + anchor.length);
  assert(!/\b(must|never|always|do not|don't|should|remember to)\b/i.test(anchor.replace(/hasn’t found out/g, '')), 'facts, not orders: ' + anchor);
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

/* M344 — the switch never removes anything; it calls the record's own far lines back to the end. */
const RECORD = [
  { id: 'a', level: 1, span: [0, 5], at: 1, whole: true, text: '[Aug 19] Jovan fenced with a stick on the lakeside path; Aurora watched from the hedge and said it looked like something out of a movie.' },
  { id: 'b', level: 1, span: [6, 11], at: 2, whole: true, text: '[Aug 19] Mi-na made tea in the kitchen and asked about school.' },
  { id: 'c', level: 1, span: [12, 17], at: 3, whole: true, text: '[Aug 20] Vanessa briefed the Bluebird table about Caleb Thorne, the football captain, and his silver truck.' },
  { id: 'd', level: 1, span: [18, 23], at: 4, whole: true, text: '[Aug 20] Rias drove Jovan home; they argued about the radio.' },
  { id: 'e', level: 1, span: [24, 29], at: 5, whole: true, text: '[Aug 21] Breakfast at the Wells house; Mi-na asked about the truck.' },
  { id: 'f', level: 1, span: [30, 35], at: 6, whole: true, text: '[Aug 21] Aurora texted Jovan about four o’clock.' },
  { id: 'x', span: [-1, -1], correction: true, text: 'a note that must never be recalled about the fence' },
];

test('M344-1 THE WRITER: "never drop… I asked to make it SMART, not to remove details." The switch removes NOTHING: with it on, every page and the whole record ride exactly as with it off — the request only GROWS, by the anchor', () => {
  const pages = []; for (let i = 0; i < 40; i += 1) { pages.push({ id: 'u' + i, role: 'user', text: 'turn ' + i }); pages.push({ id: 'a' + i, role: 'assistant', text: '[Lakeside — Friday, August 21, 2026 | 16:0' + (i % 10) + ' | gold | tee | walking]\n\nPAGE-' + i + '. They walked.' }); }
  pages.push({ id: 'uN', role: 'user', text: 'Tell me about the fence, Aurora asks.' });
  const mk = (on) => buildRequest({ story: {}, messages: pages, settings: { noteText: 'MY NOTE.', olderModelNow: on }, state: lakeside(), modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: RECORD.filter((n) => !n.correction).map((n) => n.text).join('\n'), window: { keeperOn: false, budgetTokens: 200000, nodes: RECORD } });
  const off = mk(false); const on = mk(true);
  const count = (r, re) => (JSON.stringify(r.messages).match(re) || []).length;
  eq(count(on, /PAGE-\d+\./g), count(off, /PAGE-\d+\./g), 'every page that rode still rides');
  eq(JSON.stringify(on.systemBlocks), JSON.stringify(off.systemBlocks), 'the rules, the brief and the record: untouched');
  eq(JSON.stringify(on.messages.slice(0, -1)), JSON.stringify(off.messages.slice(0, -1)), 'every message but the last: untouched');
  assert(on.messages[on.messages.length - 1].content.length > off.messages[off.messages.length - 1].content.length && on.messages[on.messages.length - 1].content.endsWith('MY NOTE.'), 'the last one only grew, and still ends on his note');
});

test('M344-2 THE SMART PART: the record’s FAR line that holds the scene’s own words is called back to the end under its own pages — rare words count, names do not, the newest lines and the house’s notes are never called, and nothing is said to "bear on" anything', () => {
  const scene = ['"Tell me about the fence," Aurora asked, squeezing Jovan’s hand. "The stick on the path looked like something out of a movie."'];
  const got = recallFromRecord(RECORD, scene, { ignore: ['Jovan', 'Aurora Sterling'] });
  eq(got.length, 1, JSON.stringify(got));
  eq(got[0].from + '–' + got[0].to, '1–6'); assert(/fenced with a stick on the lakeside path/.test(got[0].text));
  assert(!recallFromRecord(RECORD, ['Jovan and Aurora and Jovan and Aurora walked.'], { ignore: ['Jovan', 'Aurora Sterling'] }).length, 'names alone call nothing back');
  assert(!recallFromRecord(RECORD, ['Aurora texted about four o’clock again.'], {}).some((r) => /texted Jovan about four/.test(r.text)), 'the record’s newest lines stand near the pages already');
  assert(!recallFromRecord(RECORD, ['a note about the fence that must never be recalled'], {}).some((r) => /must never be recalled/.test(r.text)), 'a note of the house’s is not the story');
  eq(recallFromRecord(RECORD.slice(0, 3), scene, {}).length, 0, 'a short record is all near enough');
  const line = recallLine(got);
  assert(/^And from our story so far, each from its own time — \(pages 1–6\) \[Aug 19\] Jovan fenced with a stick/.test(line), line);
  assert(!/bear|relevan|important|remember/i.test(line), 'dated, never vouched for (M336)');
  const truck = recallFromRecord(RECORD, ['Mi-na asked again about the silver truck and the football captain.'], { ignore: ['Mi-na Wells'] });
  assert(truck.some((t) => /Caleb Thorne, the football captain, and his silver truck/.test(t.text)), 'another scene calls another line: ' + JSON.stringify(truck.map((t) => t.text.slice(0, 40))));
  assert(!truck.some((t) => /Mi-na made tea/.test(t.text)), 'a hyphenated name is a name too — "Mi-na" and a common verb do not call a line back');
  assert(truck.every((t, i) => i === 0 || truck[i - 1].from <= t.from), 'and what is called back is told in the story’s own order');
  eq(recallLine([]), ''); eq(recallFromRecord(null, scene).length, 0);
});

test('M344-3 it rides inside the one breath, after the scene and before his note', () => {
  const r = buildRequest({ story: {}, messages: [{ id: 'u1', role: 'user', text: 'Tell me about the fence — the stick on the path looked like a movie.' }], settings: { noteText: 'MY NOTE.', olderModelNow: true, tellerName: 'Tony Stark' }, state: lakeside(), modules: [], memory: '', window: { keeperOn: false, budgetTokens: 200000, nodes: RECORD } });
  const last = r.messages[r.messages.length - 1].content;
  assert(/^Tony Stark — right now, so it is in front of you — The hour: /.test(last) && /And from our story so far, each from its own time — \(pages 1–6\) \[Aug 19\] Jovan fenced/.test(last) && last.endsWith('MY NOTE.'), last.slice(0, 400));
  eq((last.split('\n\n').find((part) => /right now, so it is in front of you/.test(part)) || '').split('\n').length, 1, 'still one breath (M354: the five plain lines are their own part after it)');
});
