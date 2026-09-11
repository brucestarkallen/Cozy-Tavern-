/* M79 — read the order; never duplicate: an edit that adds words a line already
 * holds is refused; an append the field already states is refused; a rule is
 * not invented; the laws are general, not a case. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { emptyState } from '../../js/engine/state.js';
import { parseProtocol, stageProposals, addedWords, duplicateOnLine, locate } from '../../js/agents/housekeeper.js';

const story = { title: 'T', brief: ['Alexia (15) — first year at Ravenwood High, the eldest', 'Claire (16) — first year at Ravenwood High, the neighbor', 'Mina (16) — the quiet one', 'World rules: the academy takes boarders.'].join('\n'), castNotes: '' };
const stage = (answer) => stageProposals(parseProtocol(answer), { messages: [], state: emptyState(), modules: [], lore: [], memory: { nodes: [] }, session: { turns: [] }, story });

test('M79-1 the writer’s order: Alexia 15→16 lands; Mina (16, no first year) gains it; Claire and Alexia, who already say first year, are refused as a second copy — and so is a summary line', () => {
  const props = stage('<brief>[' + [
    '{"field":"brief","find":"Alexia (15)","replace":"Alexia (16)","reason":"the writer set her age"}',
    '{"field":"brief","find":"Mina (16) — the quiet one","replace":"Mina (16) — first year at Ravenwood High, the quiet one","reason":"every 16 is a first-year"}',
    '{"field":"brief","find":"Claire (16) — first year at Ravenwood High, the neighbor","replace":"Claire (16) — first year at Ravenwood High, the neighbor, first year","reason":"same"}',
    '{"field":"brief","find":"Alexia (15) — first year at Ravenwood High, the eldest","replace":"Alexia (15) — first year at Ravenwood High, the eldest — first year at Ravenwood High","reason":"same"}',
    '{"field":"brief","append":"Alexia and Claire are 16 — first year at Ravenwood High.","reason":"a rule"}',
  ].join(',') + ']</brief>');
  eq(props.map((p) => p.status).join(','), 'pending,pending,refused,refused,pending', props.map((p) => p.status + ':' + p.words).join(' | '));
  assert(/already says “first year”/.test(props[2].words), props[2].words);
  assert(/already says “first year at Ravenwood High”/.test(props[3].words), props[3].words);
  /* the summary line is a judgment the prompt now governs (READ THE ORDER / NEVER DUPLICATE);
   * code refuses it only when the field states those exact words already */
  const again = stage('<brief>[{"field":"brief","append":"the academy takes boarders","reason":"x"}]</brief>');
  eq(again[0].status, 'refused'); assert(/already says that/.test(again[0].words), again[0].words);
});

test('M79-2 the helpers: the words an edit adds; a duplicate on the same line; a change that adds new words is not a duplicate', () => {
  eq(addedWords('Mina (16) — the quiet one', 'Mina (16) — first year, the quiet one'), 'first year,');
  eq(addedWords('Alexia (15)', 'Alexia (16)'), '6');
  const text = story.brief;
  const loc = locate(text, 'Claire (16) — first year at Ravenwood High, the neighbor');
  assert(duplicateOnLine(text, loc, 'Claire (16) — first year at Ravenwood High, the neighbor', 'Claire (16) — first year at Ravenwood High, the neighbor — first year'), 'a second first year on Claire’s line is a duplicate');
  const loc2 = locate(text, 'Mina (16) — the quiet one');
  eq(duplicateOnLine(text, loc2, 'Mina (16) — the quiet one', 'Mina (16) — first year, the quiet one'), '', 'Mina’s line does not say it yet');
  const loc3 = locate(text, 'Alexia (15)');
  eq(duplicateOnLine(text, loc3, 'Alexia (15)', 'Alexia (16)'), '', 'an age change adds nothing the line holds');
});

test('M79-3 the laws are general: read the order, never duplicate, say how you read it; a rule only when asked; the class example is gone', () => {
  const src = readFileSync(new URL('../../js/agents/housekeeper.js', import.meta.url), 'utf8');
  const prompt = src.slice(src.indexOf('const SYSTEM_PROMPT = ['), src.indexOf("].join('\\n');", src.indexOf('const SYSTEM_PROMPT = [')));
  for (const w of ['READ THE ORDER, NOT A GUESS AT IT', 'names the FORM the new words take, not a list of who is affected', 'a rule is written only when the writer', 'NEVER DUPLICATE', 'SAY HOW YOU READ IT']) assert(prompt.includes(w), w);
  assert(!/A FACT FOR A CLASS/.test(prompt) && !/MATCH THE SHAPE\. "like Jovan"/.test(prompt), 'the overfit law is gone');
});

test('M80-1 the thinking rides the turn end to end through housekeeperTurn (a nudge round between); the fold sits above the reply; the raw fold says whether thinking came', async () => {
  const { housekeeperTurn, loadSession } = await import('../../js/agents/housekeeper.js');
  const { db } = await import('../../js/store.js');
  const st = await db.stories.create({ title: 'Think' });
  await db.stories.update(st.id, { brief: 'Alexia (20), the eldest.' });
  let n = 0;
  const call = async () => { n += 1; return n === 1 ? { text: 'Alexia is 20.', thinking: 'I weigh the order: 20 → 19.' } : { text: '<brief>[{"field":"brief","find":"Alexia (20)","replace":"Alexia (19)","reason":"set"}]</brief>', thinking: '' }; };
  const t = await housekeeperTurn({ storyId: st.id, writerText: 'change the brief: Alexia is 19', connection: { type: 'openai' }, call });
  assert(t.ok, t.error); eq(n, 2, 'one nudge');
  const sess = await loadSession(st.id);
  const last = sess.turns[sess.turns.length - 1];
  assert(/I weigh the order/.test(last.thinking || ''), 'the first round’s thinking is on the turn: ' + JSON.stringify(last.thinking));
  const ui = readFileSync(new URL('../../js/ui/housekeeper.js', import.meta.url), 'utf8');
  const r = ui.slice(ui.indexOf('session.turns.forEach((turn, i) => {'), ui.indexOf('session.turns.forEach((turn, i) => {') + 300);
  assert(r.indexOf('thinkingFold(turn.thinking)') < r.indexOf('bubble(turn.role'), 'the fold is drawn above the reply');
  assert(/liveThinking \+= tok\.text;/.test(ui) && /last\.thinking = liveThinking\.trim\(\);/.test(ui), 'what streamed is written onto the turn when the wire returned none');
  assert(/no thinking came back on the wire/.test(ui), 'the raw fold says so when none came');
});
