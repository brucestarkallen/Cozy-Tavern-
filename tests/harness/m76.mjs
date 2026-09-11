/* M76 — the housekeeper thinks, and every card shows its evidence (Chat
 * Assistant's card anatomy, on every kind). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { db } from '../../js/store.js';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { callModel, housekeeperEffort, HK_DEFAULT_EFFORT, parseProtocol, stageProposals } from '../../js/agents/housekeeper.js';
import { thinkingHouse, withHouse, HOUSES, thinkingOff } from './thinkinghouse.mjs';

test('M76-2 the housekeeper thinks as its connection says unless given a setting; set to max, DeepSeek is asked with thinking ENABLED whatever the connection says', async () => {
  eq(HK_DEFAULT_EFFORT, '', 'the house’s choice is the connection’s own switch (M77)');
  await db.settings.delete('hkReasoning');
  eq(await housekeeperEffort(), '');
  const deepseek = { type: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'deepseek-chat', maxTokens: 30000, reasoning: { effort: 'off' } };
  const house0 = thinkingHouse({ answer: 'ok' });
  await withHouse(house0, () => callModel(deepseek, { system: 's', messages: [{ role: 'user', content: 'u' }], maxTokens: 8192 }));
  assert(thinkingOff(house0.calls[0].body, false), 'the connection said off — off it is');
  eq(house0.calls[0].body.max_tokens, 30000, 'the connection’s larger pot stands');
  await db.settings.set('hkReasoning', 'max');
  const house = thinkingHouse({ answer: 'ok' });
  await withHouse(house, () => callModel(deepseek, { system: 's', messages: [{ role: 'user', content: 'u' }], maxTokens: 8192 }));
  const body = house.calls[0].body;
  assert(!thinkingOff(body, false), 'thinking is ON on the wire: ' + JSON.stringify(body.thinking));
  eq(body.reasoning_effort, 'max');
  await db.settings.set('hkReasoning', 'off');
  const house2 = thinkingHouse({ answer: 'ok' });
  await withHouse(house2, () => callModel({ ...deepseek, reasoning: { effort: 'high' } }, { system: 's', messages: [{ role: 'user', content: 'u' }] }));
  assert(thinkingOff(house2.calls[0].body, false), 'off when the writer says off, whatever the connection says');
  await db.settings.delete('hkReasoning');
  const settings = readFileSync(new URL('../../js/ui/settings.js', import.meta.url), 'utf8');
  assert(/id = 'hk-reasoning'/.test(settings) && /'hkReasoning'/.test(settings), 'the setting has a room');
});

test('M76-3 every card carries its evidence: before → after on the brief, the record and the lore; the ledger card says what the ledger will write; a missing reason is shown', () => {
  const state = applyMutations(emptyState(), [{ type: 'presence.enter', name: 'Ann' }]).state;
  const lore = [{ id: 'l1', name: 'Kris', keys: ['Kris'], content: 'Kendall’s mother.', enabled: true }];
  const memory = { nodes: [{ id: 'n1', span: [0, 5], text: 'Ann met Bob at the fair.', level: 1, at: 1 }] };
  const story = { title: 'T', brief: 'Alexia (20), the eldest.', castNotes: '' };
  const parsed = parseProtocol([
    '<brief>[{"field":"brief","find":"Alexia (20)","replace":"Alexia (19)","reason":"the writer set her age"},{"field":"cast","append":"Kim — the neighbor."}]</brief>',
    '<record>[{"line":"#rn1","find":"at the fair","replace":"at the market","reason":"the page says market"}]</record>',
    '<lore>[{"entry":"Kris","content":"Kendall’s mother, Kris Jenner.","reason":"the real record"},{"entry":"Kris","remove":true,"reason":"x"}]</lore>',
    '<ledits>[{"type":"presence.leave","name":"Ann","reason":"she left on page 4"},{"type":"presence.enter","name":"Bob"}]</ledits>',
  ].join('\n'));
  const cards = stageProposals(parsed, { messages: [], state, modules: [], lore, memory, session: { turns: [] }, story });
  const brief = cards.filter((c) => c.kind === 'brief');
  eq(brief[0].op.find, 'Alexia (20)'); eq(brief[0].op.replace, 'Alexia (19)'); eq(brief[0].reason, 'the writer set her age');
  eq(brief[1].op.append, 'Kim — the neighbor.'); eq(brief[1].reason, '', 'no reason came — the card will say so');
  const rec = cards.find((c) => c.kind === 'record');
  assert(rec && rec.status === 'pending' && rec.op.find === 'at the fair' && rec.op.replace === 'at the market', JSON.stringify(rec));
  const lo = cards.filter((c) => c.kind === 'lore');
  eq(lo[0].op.before.content, 'Kendall’s mother.', 'the edit card carries the words it replaces');
  eq(lo[0].op.patch.content, 'Kendall’s mother, Kris Jenner.');
  eq(lo[1].op.beforeContent, 'Kendall’s mother.', 'the remove card shows what leaves');
  const led = cards.find((c) => c.kind === 'ledit');
  assert(led.op.preview && led.op.preview.words.length === 2 && /Ann/.test(led.op.preview.words[0]) && /Bob/.test(led.op.preview.words[1]), 'the dry run says what the ledger will write: ' + JSON.stringify(led.op.preview));
  eq(state.journal.length, 1, 'the dry run left the live state alone');
  const ui = readFileSync(new URL('../../js/ui/housekeeper.js', import.meta.url), 'utf8');
  const d = ui.slice(ui.indexOf('function appendDiff('), ui.indexOf('function cardStatusWords('));
  for (const k of ["p.kind === 'brief'", "p.kind === 'lore'", "p.kind === 'record'", "The ledger will say:"]) assert(d.includes(k), 'the card draws: ' + k);
  assert(/reason\.textContent = p\.reason \|\| '\(no reason given\)'/.test(ui), 'a missing reason is shown');
  assert(/const handField = /.test(ui) && /'patch\.content'/.test(ui), 'edit-by-hand on every text card');
  assert(/tok\.channel === 'thinking'/.test(ui) && /How it’s weighing it…/.test(ui) && /' \(\+' \+ thinkChars \+ ' thinking\)'/.test(ui), 'the thinking streams live with a ticker');
  const prompt = readFileSync(new URL('../../js/agents/housekeeper.js', import.meta.url), 'utf8');
  assert(/EVERY OP CARRIES A REASON/.test(prompt) && /SAY WHAT YOU DID, PER CHANGE/.test(prompt), 'the laws');
});


test('M77-1 the thinking of every round is kept — a nudge’s follow-up no longer throws the first round’s reasoning away', async () => {
  const { runConversation } = await import('../../js/agents/housekeeper.js');
  const story = { title: 'T', brief: 'Alexia (20), the eldest.', castNotes: '' };
  const sent = [];
  const call = async ({ messages }) => {
    sent.push(messages[messages.length - 1].content);
    if (sent.length === 1) return { text: 'Alexia is 20.', thinking: 'First I weigh what the writer asked: Alexia should be 19.' };
    return { text: '<brief>[{"field":"brief","find":"Alexia (20)","replace":"Alexia (19)","reason":"the writer set it"}]</brief>', thinking: '' };
  };
  const r = await runConversation({ story, messages: [], state: emptyState(), modules: [], lore: [], memory: { nodes: [] }, session: { turns: [] }, writerText: 'change the brief: Alexia is 19', contextPages: 8, call });
  assert(r.ok && r.parsed.brief.length === 1);
  eq(sent.length, 2, 'one nudge');
  assert(/First I weigh/.test(r.thinking), 'the first round’s thinking rides: ' + JSON.stringify(r.thinking));
  const ui = readFileSync(new URL('../../js/ui/housekeeper.js', import.meta.url), 'utf8');
  assert(/id = 'hk-pop'/.test(ui) && /hk-pop-copy/.test(ui) && /if \(e\.key === 'Escape' && viewerOpen\(\)\)/.test(ui), 'the viewers open in a pop-up with Copy and Close; Esc closes it first');
  assert(!/thread\.append\(det\);\n    thread\.scrollTop = thread\.scrollHeight;\n  \}\n\n  \/\* M62: the session shelf/.test(ui), 'no viewer is dumped into the talk');
  const prompt = readFileSync(new URL('../../js/agents/housekeeper.js', import.meta.url), 'utf8');
  assert(/A FACT FOR A CLASS/.test(prompt) && /MATCH THE SHAPE/.test(prompt) && /Claire \(16\) — first year at Ravenwood High, the neighbor/.test(prompt), 'the class and shape laws, with the writer’s own case as the example');
});
