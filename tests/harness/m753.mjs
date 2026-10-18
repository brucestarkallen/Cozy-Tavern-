/* Cozy Tavern — harness laws of M753.
 * (1) HIS PAGE (18 October 2026): "A gift,* she said, slowly, … "From my sister. … hands."" — the quote that should close
 *     "A gift," came out as an asterisk, no rule of the page repair knew that shape, and the screen coloured the narration
 *     as speech and her words as narration. Speech marks are paired now, line by line, as the screen pairs them.
 * (2) HIS: "It's become slow on 70k token story" — the readers' requests begin the same way from one page to the next (a
 *     provider reuses what it has read of a request's beginning), and the readers that need nothing of each other read
 *     together with "Two workers at once" on, never more than two requests at a time, each ledger write in its own turn.
 *   M753-1  his page: the asterisk becomes the closing quote; the screen colours "A gift," and "From my sister…" and nothing else
 *   M753-2  the same fault in its other shapes: a curly closer, an opening quote, a single quote, two kinds in one pair, a mark facing the wrong way
 *   M753-3  never touched: long speech, feet and inches, a quotation inside speech, the plural's apostrophe, emphasis, „…“, two marks that could each be it
 *   M753-4  an asterisk opened and never closed is closed inside its own stretch — the screen shows no stray asterisk
 *   M753-5  what the repair cannot set is seen (speechFaults), and the mender's edit is held to adding quotation marks only
 *   M753-6  the page reader's, the world agent's, the scribe's and the second reader's requests on two pages share their beginning up to the new pages; nothing they said is gone
 *   M753-7  the queue: readers beside each other start together and the next waits for both; never more than two at a time; Stop reaches both; off, one at a time
 *   M753-8  the world agent and the scribe writing at the same moment: both writes land */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import * as shape from '../../js/ui/pageshape.js'; /* new code reached through the module's namespace, so this file loads against the tree before M753 */
const { mendMarks, tidyPage } = shape;
const pairSpeech = (...a) => shape.pairSpeech(...a);
const speechFaults = (...a) => shape.speechFaults(...a);
const insertsOnlyMarks = (...a) => shape.insertsOnlyMarks(...a);
import { inlineMd } from '../../js/ui/prose.js';
import { applyMutations } from '../../js/engine/apply.js';
import { emptyState, loadState, saveState } from '../../js/engine/state.js';
import { buildExtractorMessages } from '../../js/agents/extractor.js';
import { buildWorldMessages, worldTurn } from '../../js/agents/world.js';
import { buildScribeMessages, scribeTurn } from '../../js/agents/scribe.js';
import { buildContinuityMessages } from '../../js/agents/continuity.js';
import { enqueueWork, setSideBySide, stopWork, setSleepForHarness } from '../../js/agents/queue.js';

/* the screen's own reading of a line: the stretches it colours as speech, and every piece it shows as plain text */
const spoken = (line) => inlineMd(line).filter((t) => t.k === 'quote').map((t) => t.children.map((c) => c.text).join(''));
const plainText = (line) => {
  const out = [];
  const walk = (list) => { for (const t of list) { if (t.k === 'text') out.push(t.text); if (t.children) walk(t.children); } };
  walk(inlineMd(line));
  return out.join('');
};

const HIS = [
  '"Within the hour you\'d price your own mother if she held still."',
  'Melisende didn\'t turn. She had her eyes on Jugram, and the lean came back over her own wrists, and her voice dropped into the register that belonged to him and carried exactly one table in each direction. "A gift,* she said, slowly, working the arithmetic aloud now, undisguised. "From my sister. For asking about her sister\'s family. A gift that comes out \'unique.\' How the gifts do grow in a man\'s hands."',
  'Her head tipped, coils sliding, green silk catching the fire. "Tell me honestly, m\'lord Jugram. Did you bring her that word, or did she grow it herself? Because if you coaxed it out of her, you\'re worth every coin this hall\'s spent on you all week, and if she grew it on her own — " the smile widened, delighted and something under the delight — "then you\'re worth a great deal more than that, and all of us have badly underpriced the morning."',
];

test('M753-1 HIS PAGE: the asterisk that stood for the closing quote is made the quote — the screen colours "A gift," and her words, never the narration between them; the rest of the page to the letter', () => {
  const page = HIS.join('\n\n');
  const m = mendMarks(page);
  assert(m.changed, 'the page is mended');
  const paras = m.text.split('\n\n');
  eq(paras[0], HIS[0], 'the first paragraph to the letter');
  eq(paras[2], HIS[2], 'the third paragraph to the letter');
  eq(paras[1], HIS[1].replace('"A gift,* she said', '"A gift," she said'), 'one mark changed, nothing else');
  const said = spoken(paras[1]);
  eq(said.length, 2, 'two lines of speech: ' + JSON.stringify(said));
  eq(said[0], '"A gift,"', 'the first is "A gift," alone');
  assert(said[1].startsWith('"From my sister.') && said[1].endsWith('in a man\'s hands."'), 'the second is her words, whole: ' + said[1]);
  assert(!said.some((s) => /she said, slowly/.test(s)), 'the narration is never coloured as speech');
  /* the way a page arrives (a header) and the way a kept page is mended (none): the same repair */
  const arrived = tidyPage('[The hall — Tuesday, March 4, 1247 | 10:20 | firelight | green silk | at the table]\n\n' + page, {});
  assert(arrived.did.includes('marks') && arrived.text.includes('"A gift," she said'), 'on arrival: ' + JSON.stringify(arrived.did));
  /* before M753 the repair left it, and the screen paired the wrong marks */
  eq(spoken(HIS[1]).length, 1, 'as he saw it: one stretch, the wrong one');
  assert(/she said, slowly/.test(spoken(HIS[1])[0]), 'the narration was what the screen coloured');
});

test('M753-2 THE SAME FAULT IN ITS OTHER SHAPES — a curly closer lost to an asterisk, an opening quote lost to one, a single quote for a double, a pair in two kinds, a curly mark facing the wrong way: each made whole, the words to the letter', () => {
  const rows = [
    ['“A gift,* she said. “From my sister.”', '“A gift,” she said. “From my sister.”'],
    ['*Fine," she said. "Go."', '"Fine," she said. "Go."'],
    ['"A gift,\' she said. "From my sister."', '"A gift," she said. "From my sister."'],
    ['"A gift,* she said.', '"A gift," she said.'],
    ['"A gift,” she said.', '"A gift," she said.'],
    ['“A gift," she said.', '“A gift,” she said.'],
    ['”Hello,” she said.', '“Hello,” she said.'],
    ['She looked up. "A gift,” she said. "From my sister."', 'She looked up. "A gift," she said. "From my sister."'],
  ];
  for (const [given, want] of rows) {
    eq(mendMarks(given).text, want, JSON.stringify(given));
    assert(spoken(want).length >= 1 && !speechFaults(want).length, 'the screen pairs it: ' + want);
  }
});

test('M753-3 NEVER TOUCHED — long speech across paragraphs, feet and inches, a quotation inside speech, the plural\'s apostrophe, emphasis, „…“, and a fault two marks could each answer: to the letter', () => {
  const whole = [
    '“The first part of a long speech.\n\n“And the rest.”',
    '"The first part of a long speech.\n\n"And the rest."',
    'He was 5\'9" tall and grinned. "Not bad," she said.',
    '"She told me, \'Go.\' So I went," he said.',
    'The boys\' gift sat on the table. "Open it," she said.',
    'I take the *bus*, Jovan. "Fine," she said.',
    '„Guten Tag,“ sagte sie.',
    '"Wait—" she said. "—don\'t go."',
    'He said, "we go now," and left.',
    '"Hello?" "Yes?"',
    '"I am here." She smiled. "You came."',
  ];
  for (const t of whole) eq(mendMarks(t).text, t, JSON.stringify(t));
  /* two lone marks that could each be the lost quote: no way to know which — the line stays (the old rules still read it) */
  const two = '"A gift,* she said, *softly. "From my sister."';
  eq(pairSpeech(two), two, 'two candidates: nothing chosen');
  /* the old repairs stand */
  eq(mendMarks('She looked at the bay, "like a name read out.').text, 'She looked at the bay, like a name read out.', 'M476: a stray quote after a comma onto a lowercase word goes');
  eq(mendMarks('"Fine," she said. "Go on.').text, '"Fine," she said. "Go on."', 'M476: speech left open at the end is closed');
  eq(mendMarks('Rukia gasped. “Yamete—\n\nHe did not stop.').text, 'Rukia gasped. “Yamete—”\n\nHe did not stop.', 'M458: a curly quote left open at the end');
  eq(mendMarks('*She smiled at him.').text, '*She smiled at him.*', 'M458: an asterisk opened before a word, closed at the end');
});

test('M753-4 AN ASTERISK OPENED AND NEVER CLOSED IS CLOSED INSIDE ITS OWN STRETCH — inside the speech it opened in, or before the next speech — and the screen shows no stray asterisk (M458 closed it at the paragraph\'s end, after a quote: two stray asterisks)', () => {
  const rows = [
    ['"I *mean it," she said.', '"I *mean it,*" she said.'],
    ['She said *softly and went on. "Hi," he said.', 'She said *softly and went on.* "Hi," he said.'],
  ];
  for (const [given, want] of rows) {
    const got = mendMarks(given).text;
    eq(got, want, JSON.stringify(given));
    assert(!plainText(got).includes('*'), 'no asterisk shown as text: ' + JSON.stringify(plainText(got)));
    assert(inlineMd(got).some((t) => t.k === 'em' || (t.children || []).some((c) => c.k === 'em')), 'the emphasis is drawn');
  }
  /* what M458 did with the first — the closer after the quote — showed two asterisks on the screen */
  eq((plainText('"I *mean it," she said.*').match(/\*/g) || []).length, 2, 'the old closer: two shown');
  /* speech that does not pair leaves no place to know: the asterisk is left as it came, never closed across a quote */
  const broken = 'She said *softly, "Hi, he said. "Go."';
  assert(!mendMarks(broken).text.endsWith('*'), 'not closed at the end across broken speech');
});

test('M753-5 WHAT THE REPAIR CANNOT SET IS SEEN, AND THE MENDER MAY ONLY ADD QUOTATION MARKS — a quote left out mid-line is a fault speechFaults names; an edit that adds the quote passes; one that changes a word, takes a mark away or moves a space does not', () => {
  const page = 'Melisende turned. "A gift, she said. "From my sister."\n\nThe fire cracked.';
  eq(mendMarks(page).text, page, 'no mark stands for it: the repair leaves it');
  const faults = speechFaults(page);
  eq(faults.length, 1, 'one line is seen: ' + JSON.stringify(faults));
  assert(faults[0].includes('"A gift, she said.'), 'the line itself');
  eq(speechFaults(HIS.join('\n\n').replace('"A gift,* she said', '"A gift," she said')).length, 0, 'a page whose speech pairs has none');
  eq(speechFaults('"The first part of a long speech.\n\n"And the rest."').length, 0, 'long speech is no fault');
  const mended = 'Melisende turned. "A gift," she said. "From my sister."\n\nThe fire cracked.';
  eq(insertsOnlyMarks(page, mended), true, 'the quote added');
  eq(speechFaults(mended).length, 0, 'and the line pairs');
  eq(insertsOnlyMarks(page, mended.replace('gift', 'present')), false, 'a word changed');
  eq(insertsOnlyMarks(page, page.replace('"From', 'From')), false, 'a mark taken away');
  eq(insertsOnlyMarks(page, page.replace('turned. "A', 'turned."A')), false, 'a space taken away');
  eq(insertsOnlyMarks(page, page.replace('gift,', 'gift,*')), false, 'an asterisk is no quotation mark');
  eq(insertsOnlyMarks(page, page), false, 'nothing added is no edit');
});

/* ---- (2) the readers' requests and the queue ---- */

const NAMES = ['Mara Vell', 'Tobin Draper', 'Elise Crane', 'Rowan Pike'];
const pageText = (i) => '[The kitchen — Monday, March 3, 2025 | ' + String(9 + i).padStart(2, '0') + ':05 | clear | coat | by the door]\n\nPage ' + i + '. ' + NAMES[i % 4] + ' set down the cup and looked at Jovan for a long time. "You knew," she said. '.repeat(1) + 'The rain kept on. '.repeat(30);
const before = (n) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', number: i + 1, text: i % 2 ? pageText(i) : 'I look at ' + NAMES[i % 4].split(' ')[0] + ' and wait.' }));
function ledgerAt(minutes, extra = []) {
  return applyMutations({ ...emptyState(), page: 3 }, [
    { type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'The kitchen' },
    { type: 'clock.set', year: 2025, month: 3, day: 3, hour: 9, minute: 5 }, { type: 'clock.advance', minutes },
    { type: 'presence.enter', name: 'Jovan', position: 'by the door' },
    ...NAMES.map((n, i) => ({ type: 'offscreen.set', name: n, location: 'the garden', activity: 'waiting', stance: 'busy', agenda: 'see Jovan', etaMinutes: 30 + i })),
    { type: 'knowledge.add', name: 'Mara Vell', fact: 'Jovan read the letter' },
    ...extra,
  ]).state;
}
const sharedUpTo = (a, b) => { let i = 0; const n = Math.min(a.length, b.length); while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i += 1; return i; };
const whole = (m) => m.system + '\n' + m.user;

test('M753-6 THE READERS\' REQUESTS BEGIN THE SAME WAY FROM ONE PAGE TO THE NEXT — the page reader\'s, the world agent\'s, the scribe\'s and the second reader\'s request for the next page share their beginning with the one before up to the new pages (the ledger, its hour and the page come after the story); every block they carried is still in them', () => {
  const brief = 'A long story in a great house. '.repeat(40);
  const castNotes = NAMES.map((n) => n + ' — of the household.').join('\n');
  const record = 'p1–p4: Jovan came to the house; Mara Vell kept the letter. '.repeat(20);
  /* page A: pages 1..5 already read, page 6 new; page B: pages 1..6 read, page 7 new, and the ledger has moved on: its
   * hour, someone come in, something learned */
  const A = { before: before(5), userText: 'I ask Mara about the letter.', assistantText: pageText(5), state: ledgerAt(10) };
  const B = { before: before(6), userText: 'I follow Tobin outside.', assistantText: pageText(6), state: ledgerAt(25, [{ type: 'presence.enter', name: 'Tobin Draper' }, { type: 'knowledge.add', name: 'Tobin Draper', fact: 'Mara kept the letter' }]) };
  const lastShared = before(5)[4].text; /* the last page both requests hold among the pages already read */
  const builders = {
    'page reader': (x) => buildExtractorMessages({ ...x, brief, castNotes, record, pageNumber: x.before.length + 1 }),
    'world agent': (x) => buildWorldMessages({ ...x, brief, castNotes, record, pageNumber: x.before.length + 1, jumpedMinutes: 0 }),
    scribe: (x) => buildScribeMessages({ state: x.state, userText: x.userText, assistantText: x.assistantText, brief, castNotes, record, pages: x.before }),
    'second reader': (x) => buildContinuityMessages({ state: x.state, assistantText: x.assistantText, brief, record, before: x.before, userText: x.userText }),
  };
  for (const [who, build] of Object.entries(builders)) {
    const a = whole(build(A));
    const b = whole(build(B));
    const shared = sharedUpTo(a, b);
    const reach = b.indexOf(lastShared) + lastShared.length;
    assert(b.indexOf(lastShared) > 0, who + ': the pages already read are in the request');
    assert(shared >= reach, who + ': the two requests part at ' + shared + ' of ' + b.length + ', before the end of the pages both hold (' + reach + '): ' + JSON.stringify(b.slice(Math.max(0, shared - 60), shared + 60)));
    assert(shared / b.length > 0.6, who + ': most of the request is the same: ' + Math.round((100 * shared) / b.length) + '%');
    /* nothing lost: the brief, the record, the ledger's hour and its people, the new page */
    for (const words of [brief.slice(0, 40), record.slice(0, 40), 'Tobin Draper', 'I follow Tobin outside.', 'Page 6.']) assert(b.includes(words), who + ': still carries ' + JSON.stringify(words));
  }
  /* the world agent's own words no longer move with the clock: its system words are the same on both pages */
  const wa = buildWorldMessages({ ...A, brief, castNotes, record });
  const wb = buildWorldMessages({ ...B, brief, castNotes, record });
  eq(wa.system, wb.system, 'the world agent\'s system words do not change with the hour');
  assert(/The hour on the clock is Monday, March 3, 2025/.test(wb.user), 'the hour is still told: ' + (wb.user.match(/The hour on the clock is [^\n]*/) || [''])[0]);
  const small = applyMutations(ledgerAt(10), [{ type: 'clock.set', year: 2025, month: 3, day: 3, hour: 23, minute: 30 }]).state;
  const night = buildWorldMessages({ ...A, state: small, brief, castNotes, record, jumpedMinutes: 600 });
  assert(/THE SMALL HOURS/.test(night.user) && /THE CLOCK JUMPED/.test(night.user), 'the hour\'s law and a jump are still told');
  assert(night.user.indexOf('THE SMALL HOURS') < night.user.indexOf('THE LEDGER (the state of the scene)'), 'the hour stands with the ledger, before it');
});

test('M753-7 THE QUEUE: READERS BESIDE EACH OTHER START TOGETHER AND THE NEXT WAITS FOR BOTH; NEVER MORE THAN TWO REQUESTS OF A TALE AT A TIME; HIS STOP REACHES BOTH; with "Two workers at once" off, one at a time', async () => {
  setSleepForHarness(() => Promise.resolve());
  const runOnce = async (on) => {
    setSideBySide(on);
    const sid = 'm753-queue-' + (on ? 'on' : 'off');
    const events = [];
    const gates = {};
    const job = (name, extra = {}) => enqueueWork(sid, { name, ...extra, run: () => new Promise((resolve) => { events.push('start ' + name); gates[name] = () => { events.push('end ' + name); resolve({ silent: true }); }; }) });
    const done = [job('extractor'), job('world'), job('scribe', { beside: true }), job('continuity', { beside: true }), job('keeper')];
    const until = async (cond) => { for (let i = 0; i < 200 && !cond(); i += 1) await new Promise((r) => setTimeout(r, 2)); assert(cond(), 'waited: ' + events.join(', ')); };
    await until(() => gates.extractor); gates.extractor();
    await until(() => gates.world);
    if (on) {
      await until(() => gates.scribe);
      assert(!gates.continuity, 'a third beside waits for a slot: ' + events.join(', '));
      assert(!gates.keeper, 'the next waits for the readers beside each other');
      gates.scribe();
      await until(() => gates.continuity);
      assert(!gates.keeper, 'still waits for the world agent');
      gates.world(); gates.continuity();
    } else {
      assert(!gates.scribe, 'off: the scribe waits for the world agent');
      gates.world(); await until(() => gates.scribe); gates.scribe();
      await until(() => gates.continuity); gates.continuity();
    }
    await until(() => gates.keeper); gates.keeper();
    await Promise.all(done);
    return events;
  };
  const on = await runOnce(true);
  assert(on.indexOf('start scribe') < on.indexOf('end world'), 'on: the scribe started before the world agent ended: ' + on.join(', '));
  const off = await runOnce(false);
  eq(off.join(','), 'start extractor,end extractor,start world,end world,start scribe,end scribe,start continuity,end continuity,start keeper,end keeper', 'off: one at a time, in order');
  /* his Stop: both readers in flight are stopped, the one waiting for a slot too, nothing after them starts */
  setSideBySide(true);
  const sid = 'm753-stop';
  const started = [];
  const pending = (name, extra = {}) => enqueueWork(sid, { name, ...extra, run: ({ signal }) => new Promise((resolve, reject) => { started.push(name); signal.addEventListener('abort', () => { const e = new Error('The operation was aborted.'); e.name = 'AbortError'; reject(e); }); }) });
  const results = [pending('world'), pending('scribe', { beside: true }), pending('continuity', { beside: true }), pending('keeper')];
  for (let i = 0; i < 100 && started.length < 2; i += 1) await new Promise((r) => setTimeout(r, 2));
  eq(started.join(','), 'world,scribe', 'two in flight');
  stopWork(sid);
  const settled = await Promise.all(results);
  assert(settled.every((r) => r && r.ok === false && r.stopped), 'every one stopped: ' + JSON.stringify(settled));
  eq(started.join(','), 'world,scribe', 'nothing else started');
  setSideBySide(false);
  setSleepForHarness(null);
});

test('M753-8 THE WORLD AGENT AND THE SCRIBE WRITING AT THE SAME MOMENT — each reads the ledger, its model answers, and both save: both writes land (each in the ledger\'s turn; before, the later save wrote over the earlier)', async () => {
  const story = await db.stories.create({ title: 'm753 two writers' });
  await db.messages.append(story.id, { role: 'user', text: 'I walk into the kitchen.' });
  const page = '[The kitchen — Monday, March 3, 2025 | 09:05 | clear | coat | by the door]\n\nMara Vell set the cup down. "You knew," Mara said to Jovan. Tobin Draper waited in the garden, far from the house.';
  await db.messages.append(story.id, { role: 'assistant', text: page });
  const led = applyMutations({ ...emptyState(), page: 0 }, [
    { type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'The kitchen' }, { type: 'clock.set', year: 2025, month: 3, day: 3, hour: 9, minute: 5 },
    { type: 'presence.enter', name: 'Jovan', position: 'by the door' }, { type: 'presence.enter', name: 'Mara Vell', position: 'at the table' },
    { type: 'people.set', name: 'Mara Vell', field: 'core', text: 'Mara Vell is the cook of the house.' },
    { type: 'offscreen.set', name: 'Tobin Draper', location: 'the stables', activity: 'brushing the horses', stance: 'busy', agenda: 'see Jovan' },
    { type: 'people.set', name: 'Tobin Draper', field: 'core', text: 'Tobin Draper is the groom.' },
  ]).state;
  await saveState(story.id, led);
  const connection = { type: 'openai', baseUrl: 'https://fixture.example/v1', apiKey: 'fixture', model: 'fixture', preset: 'custom', contextSize: 128000, reasoning: { effort: 'off' } };
  /* the wire: both answers are held until both requests have arrived, then given together — so both readers read the
   * ledger before either writes, and their saves meet */
  const waiting = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (_, options) => {
    const body = JSON.parse(options.body);
    const sys = body.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const content = /world beyond the page/.test(sys)
      ? JSON.stringify({ mutations: [{ type: 'thread.set', title: 'Tobin and the letter', owner: 'Tobin Draper', heat: 'hot', next: 'corner Jovan at the stables' }], brief: { pressure: [], ripe: [], twb: null } })
      : JSON.stringify({ deltas: [{ name: 'Mara Vell', field: 'arc', text: 'Stung that Jovan kept the letter from her.', cause: 'he knew and said nothing', shown: '"You knew," Mara said to Jovan.' }], facts: [], entities: [] });
    await new Promise((resolve) => { waiting.push(resolve); if (waiting.length === 2) waiting.splice(0).forEach((r) => r()); });
    return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  };
  try {
    await Promise.all([
      worldTurn({ connection, storyId: story.id, userText: 'I walk into the kitchen.', assistantText: page, pageAt: 0 }),
      scribeTurn({ connection, storyId: story.id, userText: 'I walk into the kitchen.', assistantText: page, pageAt: 0 }),
    ]);
  } finally { globalThis.fetch = real; }
  const after = await loadState(story.id);
  assert((after.threads || []).some((th) => th && /Tobin and the letter/.test(th.title || '')), 'the world agent\'s thread landed: ' + JSON.stringify((after.threads || []).map((th) => th.title)));
  assert(/Stung that Jovan kept the letter/.test(String((after.characters['Mara Vell'] || {}).arc || '')), 'and the scribe\'s note landed: ' + JSON.stringify(after.characters['Mara Vell']));
});
