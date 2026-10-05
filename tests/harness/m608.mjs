/* M608 — the line-by-line audit, part 18: the last small helpers. Every law RUNS the reader or the helper and reads back what
 * it returned or wrote. None reads source text. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { HOUSES, withHouse } from './thinkinghouse.mjs';
import { db } from '../../js/store.js';

const CONN = HOUSES[0].conn;
function scriptedHouse(answer) {
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    const text = await answer(JSON.stringify(body), body);
    const lines = 'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n'
      + 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n' + 'data: [DONE]\n\n';
    if (body.stream) {
      const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(lines)); c.close(); } });
      return { ok: true, status: 200, headers: new Headers(), body: stream, async json() { return {}; }, async text() { return lines; }, clone() { return this; } };
    }
    const obj = { choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }] };
    return { ok: true, status: 200, headers: new Headers(), async json() { return obj; }, async text() { return JSON.stringify(obj); }, clone() { return this; } };
  };
  return { fetch: fetchImpl };
}
const THOUGHT = '<think>The parts are {world, where}; I should keep {it} short.</think>\n';

test('M608-1 THE WORLD\u2019S ANSWER IS READ AS EVERY HELPER\u2019S IS — past a thought with braces in it, a line break inside a part and a trailing comma', async () => {
  const { readGround, readGroundPatch } = await import('../../js/agents/worldground.js');
  const raw = THOUGHT + '{"world": "Soul Society, the afterlife\'s seat of the Gotei 13.\nIts era: after the war.", "factions": "The Gotei 13 under the Captain-Commander.", "places": "", }';
  const parts = readGround(raw);
  assert(parts, 'the world is read');
  eq(parts.world, 'Soul Society, the afterlife\u2019s seat of the Gotei 13. Its era: after the war.'.replace('\u2019', '\''), 'the setting, its two lines as one');
  eq(parts.factions, 'The Gotei 13 under the Captain-Commander.', 'and who holds power');
  const patch = readGroundPatch(THOUGHT + '{"changed": {"standing": "The 13th Division has a new captain.\nHis name is Oda."},}');
  eq(patch && patch.standing, 'The 13th Division has a new captain. His name is Oda.', 'an update is read too');
});

test('M608-2 THE CANON CHECKS ARE READ PAST A THOUGHT — the wrong facts are found, and a canon story is never taken for none by a "canon": false it only thought about', async () => {
  const { readClaimsCheck } = await import('../../js/agents/canoncheck.js');
  const { readCanonStart, placeInCanon } = await import('../../js/agents/canonstart.js');
  eq(JSON.stringify(readClaimsCheck('<think>{"wrong": maybe 1?}</think> {"wrong":[2]}', 3)), '{"wrong":[1]}', 'the second fact is wrong');
  const start = readCanonStart('<think>Is it {canon}? Yes.</think>\n{"canon":true,"series":"Bleach","arc":"after the war","moment":"Oda takes the 13th","when":"","facts":["Rukia is a lieutenant."]}');
  eq(start && start.series, 'Bleach', 'the start is read');
  const answer = '<think>If it were original I would answer {"canon": false}, but it is Bleach.</think>\n{"canon":true,"series":"Bleach","arc":"after the war","moment":"Oda takes the 13th Division","when":"","facts":["Rukia is a lieutenant."]}';
  const placed = await withHouse(scriptedHouse(async () => answer), () => placeInCanon({ connection: CONN, concept: '#story Oda becomes captain of the 13th Division' }));
  assert(placed && placed.start && placed.start.series === 'Bleach', 'a canon story is placed: ' + JSON.stringify(placed));
});

test('M608-3 THE SMART RECALL\u2019S PICK IS READ PAST A THOUGHT', async () => {
  const { readPick } = await import('../../js/agents/recallpick.js');
  eq(JSON.stringify(readPick('<think>Lines {3} and {7} look relevant.</think>\n{"lines":[3,7]}', 10)), '[3,7]', 'the lines it names');
});

test('M608-4 THE ESSENTIALS, THE POLISHED CONCEPT AND THE EDITOR\u2019S NOTES NEVER CARRY THE MODEL\u2019S THINKING', async () => {
  const { readEssentials } = await import('../../js/agents/essentials.js');
  const ess = readEssentials('<think>\n[Sept 1] I should start with the kitchen scene and keep it short.\n</think>\n- [Sept 1, 08:24 · the Wells kitchen] (pages 1–4) Jovan meets Vivi; she hides the letter → he notices.\n- [Sept 2, 09:00 · the school gate] (pages 5–9) Kara walks him in; the rumour starts.');
  assert(ess && !/I should start/.test(ess), 'no thought in the essentials: ' + JSON.stringify(ess));
  assert(/Jovan meets Vivi/.test(ess) && /Kara walks him in/.test(ess), 'the lines themselves are kept');
  const { polishConcept } = await import('../../js/agents/concept.js');
  const out = await withHouse(scriptedHouse(async () => '<think>Fix the grammar.</think>\nJovan Oda becomes the new captain of the 13th Division; Rukia is his lieutenant.'),
    () => polishConcept({ connection: CONN, concept: 'jovan Oda become new captain 13th division, Rukia his lieutenant' }));
  assert(out.polished && !/<think>|Fix the grammar/.test(out.text), 'the brief holds no thought: ' + JSON.stringify(out.text));
  const { parseCritique } = await import('../../js/agents/editor.js');
  const c = parseCritique('<think>\n1. maybe say something about the weather\n</think>\nNORTH STAR: let the quiet scenes breathe\n1. Scenes end on the same beat.');
  eq(c && c.notes.join(' | '), 'Scenes end on the same beat.', 'a numbered thought is not a note');
});

test('M608-5 THE HOUSE\u2019S EYE KNOWS THE MAIN CHARACTER BY HIS FIRST NAME — "Jovan said" is his line when the ledger calls him Jovan Oda', async () => {
  const { lintPage } = await import('../../js/agents/lint.js');
  const page = '[The yard \u2014 Monday, March 3, 2025 | 09:00 | clear]\n\nRukia folded her arms. "You are late," she said.\n\n"I had to see the captain first," Jovan said, brushing dust from his sleeve.';
  const ghosts = (mc) => lintPage({ mc, userText: 'I walk to Rukia.', assistantText: page }).findings.filter((f) => f.law === 'Ghost Dialogue');
  eq(ghosts('Jovan Oda').length, 1, 'his line, written for him, is caught under his full name');
  eq(lintPage({ mc: 'Jovan Oda', userText: 'I say "I had to see the captain first."', assistantText: page }).findings.filter((f) => f.law === 'Ghost Dialogue').length, 0, 'words he typed are his own');
});

test('M608-6 A PAGE WRITTEN AGAIN TAKES BACK THE PLAN ITS OLD WORDS LAID OUT — the plans keeper never keeps a plan from words that no longer stand', async () => {
  const { runPlans, loadPlansBook, pageRewritten } = await import('../../js/agents/plans.js');
  const story = await db.stories.create({ title: 'Plans' });
  const pages = (last) => [
    { n: 1, who: 'the writer', text: 'We gather in the barracks.' },
    { n: 2, who: 'the storyteller', text: last },
  ];
  const laidOut = '{"new":[{"title":"the night raid","by":"Rukia","page":2,"goal":"take the gate","parts":[{"who":"Renji","does":"draws the guards off","when":"at midnight"}]}],"progress":[],"closed":[]}';
  await runPlans({ connection: CONN, storyId: story.id, pages: pages('Rukia lays out the night raid: Renji draws the guards off at midnight.'), callLLM: async () => laidOut });
  eq((await loadPlansBook(story.id)).plans.filter((p) => p.status === 'standing').map((p) => p.title).join(','), 'the night raid', 'the raid is written down');
  /* Try again: the same page, new words that lay out no plan */
  await runPlans({ connection: CONN, storyId: story.id, pages: pages('Rukia shrugs. "We wait for morning."'), callLLM: async () => '{"new":[],"progress":[],"closed":[]}' });
  eq((await loadPlansBook(story.id)).plans.filter((p) => p.status === 'standing').length, 0, 'the raid the replaced words laid out is gone');
  /* an older page rewritten (an edit, a re-ink) takes back what it said too */
  await runPlans({ connection: CONN, storyId: story.id, pages: [...pages('Rukia lays out the night raid.'), { n: 3, who: 'the writer', text: 'I nod.' }], callLLM: async () => laidOut });
  assert((await loadPlansBook(story.id)).plans.some((p) => p.title === 'the night raid' && p.status === 'standing'), 'laid out again');
  await pageRewritten(story.id, 1);
  eq((await loadPlansBook(story.id)).plans.filter((p) => p.status === 'standing').length, 0, 'a page rewritten in place takes its plan back with it');
});
