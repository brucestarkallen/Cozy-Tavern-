/* Cozy Tavern — harness laws of M774. His (24 October 2026): "why the housekeeper is stupid?? I ask it to edit characters it
 * doesn't think thoroughly and scan everything that contradict like the page still make the character tall instead of
 * petite". The house's sweep for what a change leaves contradicted read page edits only; a change to who someone is was never
 * held against the pages. Runs the real housekeeper turn, its provider scripted; fails on m773-001. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { housekeeperTurn } from '../../js/agents/housekeeper.js';
import { emptyState, saveState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { extractTurn } from '../../js/agents/extractor.js';
import { buildWorldMessages } from '../../js/agents/world.js';

async function tale(title, pages) {
  const st = await db.stories.create({ title });
  for (const [role, text] of pages) await db.messages.append(st.id, { role, text });
  const led = applyMutations({ ...emptyState(), sheet: { actors: {}, playerName: 'Jovan Wessex', playerAliases: [] } }, [
    { type: 'people.set', name: 'Marguerite Vermaine', field: 'core', text: 'Maker of the Vermaine line.' },
    { type: 'canon.lock', name: 'Marguerite Vermaine', key: 'height', value: 'tall', byHand: true }]).state;
  await saveState(st.id, led);
  return st;
}
const PAGES = [['user', 'I meet her mother.'], ['assistant', 'Marguerite Vermaine rose from the chair, tall and pale, and looked down at him.\n\nJovan did not look away.'],
  ['user', 'I bow.'], ['assistant', 'The hall was tall and cold, its windows black.\n\nSidonie laughed somewhere above.']];

test('M774-1 A CHANGE TO WHO SOMEONE IS IS HELD AGAINST THE PAGES THAT TELL OF THEM: “make Marguerite petite” — the page that has her rise “tall and pale” is handed back in the same answer, never a page where only a hall is tall', async () => {
  const st = await tale('M774-1', PAGES);
  const asked = [];
  const call = async ({ messages }) => {
    asked.push(messages.map((m) => String(m.content)).join('\n'));
    return { text: asked.length === 1
      ? 'Marguerite will be petite.\n<ledits>[{"type":"canon.lock","name":"Marguerite Vermaine","key":"height","value":"petite","reason":"his correction"}]</ledits>'
      : 'Marguerite will be petite, and her page says so.\n<ledits>[{"type":"canon.lock","name":"Marguerite Vermaine","key":"height","value":"petite","reason":"his correction"}]</ledits>' };
  };
  const t = await housekeeperTurn({ storyId: st.id, writerText: 'Make Marguerite petite, not tall', connection: { type: 'openai' }, call });
  assert(t.ok, t.error);
  eq(asked.length, 2, 'handed back once');
  const ripple = asked[1].slice(asked[1].lastIndexOf('[RIPPLE]'));
  assert(/\[RIPPLE\]/.test(asked[1]) && /“tall” \(of Marguerite Vermaine\)/.test(ripple), 'the old height, hers: ' + ripple.slice(0, 300));
  const pages = (await db.messages.list(st.id)).filter((m) => m.role === 'assistant');
  assert(ripple.includes('#' + pages[0].id.slice(0, 6)) || /p2\b|page 2/.test(ripple), 'the page that has her tall: ' + ripple.slice(0, 300));
  assert(!ripple.includes('#' + pages[1].id.slice(0, 6)) && !/p4\b|page 4/.test(ripple), 'not the page where only the hall is tall');
});

test('M774-2 A CHANGE THAT LEAVES NOTHING CONTRADICTED ASKS NOTHING MORE', async () => {
  const st = await tale('M774-2', [['user', 'I wait.'], ['assistant', 'The hall was tall and cold.']]);
  let n = 0;
  const call = async () => { n += 1; return { text: 'Marguerite will be petite.\n<ledits>[{"type":"canon.lock","name":"Marguerite Vermaine","key":"height","value":"petite","reason":"his correction"}]</ledits>' }; };
  const t = await housekeeperTurn({ storyId: st.id, writerText: 'Make Marguerite petite', connection: { type: 'openai' }, call });
  assert(t.ok, t.error); eq(n, 1, 'one call');
});

test('M774-3 A NATURE REWRITTEN IN MORE THAN ONE PLACE: every word it takes away is looked for — “the Progenitor”, “four hundred years” — where the pages tell of her', async () => {
  const st = await db.stories.create({ title: 'M774-3' });
  for (const [role, text] of [['user', 'I ask who she is.'], ['assistant', 'Marguerite Vermaine had been the Progenitor of her line since before the city had a name.\n\nThe fire cracked.'],
    ['user', 'I ask her age.'], ['assistant', '"Four hundred years," Marguerite said, as if it were nothing.']]) await db.messages.append(st.id, { role, text });
  await saveState(st.id, applyMutations({ ...emptyState(), sheet: { actors: {}, playerName: 'Jovan Wessex', playerAliases: [] } }, [
    { type: 'people.set', name: 'Marguerite Vermaine', field: 'core', text: 'The Progenitor of the Vermaine line, four hundred years old, tall and cold.' }]).state);
  const asked = [];
  const answer = 'Her nature put right.\n<ledits>[{"type":"people.set","name":"Marguerite Vermaine","field":"core","text":"An Elder of the Vermaine line, two hundred years old, tall and cold.","reason":"the brief"}]</ledits>';
  const call = async ({ messages }) => { asked.push(messages.map((m) => String(m.content)).join('\n')); return { text: answer }; };
  const t = await housekeeperTurn({ storyId: st.id, writerText: 'Marguerite is an Elder, not the Progenitor, and two hundred years old', connection: { type: 'openai' }, call });
  assert(t.ok, t.error);
  eq(asked.length, 2, 'handed back once');
  const ripple = asked[1].slice(asked[1].lastIndexOf('[RIPPLE]'));
  assert(/“Progenitor” \(of Marguerite Vermaine\)/.test(ripple), 'the Progenitor: ' + ripple.slice(0, 400));
  assert(/“four” \(of Marguerite Vermaine\)/i.test(ripple), 'the four hundred years: ' + ripple.slice(0, 400));
  assert(!/“tall”|“cold”|“Vermaine”/.test(ripple), 'never what the change keeps: ' + ripple.slice(0, 400));
});

test('M774-4 HER OWN OTHER TRUTHS ARE SWEPT TOO: height made petite leaves “build: tall and willowy” standing on her canon — that is handed back; the height itself is not', async () => {
  const st = await db.stories.create({ title: 'M774-4' });
  await db.messages.append(st.id, { role: 'user', text: 'I wait.' });
  await db.messages.append(st.id, { role: 'assistant', text: 'The night was quiet.' });
  await saveState(st.id, applyMutations({ ...emptyState(), sheet: { actors: {}, playerName: 'Jovan Wessex', playerAliases: [] } }, [
    { type: 'canon.lock', name: 'Marguerite Vermaine', key: 'height', value: 'tall', byHand: true },
    { type: 'canon.lock', name: 'Marguerite Vermaine', key: 'build', value: 'tall and willowy', byHand: true }]).state);
  const asked = [];
  const call = async ({ messages }) => { asked.push(messages.map((m) => String(m.content)).join('\n')); return { text: 'Petite.\n<ledits>[{"type":"canon.lock","name":"Marguerite Vermaine","key":"height","value":"petite","reason":"his correction"}]</ledits>' }; };
  const t = await housekeeperTurn({ storyId: st.id, writerText: 'Make Marguerite petite', connection: { type: 'openai' }, call });
  assert(t.ok, t.error);
  eq(asked.length, 2, 'handed back once');
  const ripple = asked[1].slice(asked[1].lastIndexOf('[RIPPLE]'));
  assert(/“tall” \(of Marguerite Vermaine\) in the canon of Marguerite Vermaine/.test(ripple), 'her build: ' + ripple.slice(0, 300));
});

/* His other question: "why during characters introduction that i made the ledger not adjust and think carefully based on
 * brief". The page reader writes a newcomer's nature from the page that introduces them — and it was handed the brief as
 * "what this story is about", never told the brief outranks the page, as the scribe, the auditor and the tidy are. What the
 * model then writes cannot be run here; what is proven is that the rule and the ranked brief reach the request it reads. */
const CONN = { type: 'openai', baseUrl: 'https://fixture.example/v1', apiKey: 'fixture', model: 'fixture', preset: 'custom', contextSize: 200000, reasoning: { effort: 'off' } };
const sse = (v) => new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: JSON.stringify(v) } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
const BRIEF = 'The Progenitors are legend only. The Elders made the seven families; the eldest Elder is two hundred years old.';
test('M774-5 THE PAGE READER IS TOLD THE BRIEF OUTRANKS THE PAGE THAT INTRODUCES SOMEONE, and to write their nature as the brief settles it', async () => {
  const st = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Jovan Wessex' }]).state;
  const sent = [];
  const was = globalThis.fetch;
  globalThis.fetch = async (_, o) => { sent.push(JSON.parse(o.body).messages.map((m) => String(m.content)).join('\n')); return sse({ mutations: [], here: [], people: [] }); };
  try {
    await extractTurn({ connection: CONN, state: st, userText: 'Marguerite Vermaine, the Progenitor of her line, enters.', assistantText: 'Marguerite Vermaine entered the hall.', pageNumber: 2, before: [], brief: BRIEF });
  } finally { globalThis.fetch = was; }
  assert(sent.length >= 1, 'the reader was asked');
  const ask = sent[0];
  const at = ask.indexOf(BRIEF);
  assert(at > 0 && /outranks every page[^\n]*\n[^\n]*\n?$/.test(ask.slice(Math.max(0, at - 400), at)), 'the brief, ranked, right above it: ' + ask.slice(Math.max(0, at - 300), at));
  assert(/The core agrees with the writer.s brief and cast notes/.test(ask), 'the newcomer\u2019s nature as the brief settles it');
});
test('M774-6 THE WORLD KEEPER, WHICH ALSO WRITES A NEW PERSON\u2019S NATURE, IS HANDED THE BRIEF RANKED', () => {
  const st = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Jovan Wessex' }]).state;
  const built = buildWorldMessages({ state: st, userText: 'I wait.', assistantText: 'The hall was quiet.', brief: BRIEF });
  const all = built.system + '\n' + (Array.isArray(built.user) ? built.user.join('\n') : String(built.user));
  const at = all.indexOf(BRIEF);
  assert(at > 0 && /outranks every page/.test(all.slice(Math.max(0, at - 300), at)), 'ranked: ' + all.slice(Math.max(0, at - 300), at));
  assert(/one-line core, agreeing with the brief/.test(all), 'and a new person\u2019s core agrees with it');
});
