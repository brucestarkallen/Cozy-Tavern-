/* Cozy Tavern — harness laws of M548: CHOICES MATTER (his ask: "like Detroit: Become Human — a switch; off, everything back
 * to normal; the outcomes decided beforehand so the storyteller can't bias it"). Every law runs the thing: the helper's answer
 * read, the seal kept and broken, the request built, the thread read back. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { readChoices, takenRecord, takenOf, outcomeWords, echoLines, echoesText, flowOf, openOffer, offerOf, offerPatch, versionOf, makeChoices, choiceAsk, CHOICES_MAX } from '../../js/agents/choices.js';
import { buildRequest } from '../../js/assemble/stack.js';
import { CRAFT_TEXT } from '../../js/assemble/craft.js';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const ANSWER = { turning: true, choices: [
  { label: 'Tell her the truth', move: 'I tell Rukia the truth about the attendant.', outcome: 'Rukia goes still, then walks out without a word; she will not come to the gate tomorrow.', echoes: [{ who: 'Rukia', what: 'will remember that he lied to her for a month' }] },
  { label: 'Say nothing', move: 'I say nothing and look at the river.', outcome: 'She waits, then laughs at herself and lets it go — for now.', echoes: [] },
  { label: 'Lie again', move: 'I tell her the attendant is only a servant.', outcome: 'She believes him, and repeats it to her brother that night.', echoes: [{ who: 'Byakuya', what: 'hears the lie and will check it' }, { who: 'Rukia', what: 'will defend the lie in front of the division' }] },
] };

test('M548-1 THE HELPER\'S ANSWER IS READ STRICTLY: two to four whole choices, each named once; a choice missing its name, its move or its outcome is dropped; one choice left is no answer; a quiet page is kept as quiet; thinking out loud before the answer is passed over', () => {
  const read = readChoices('Let me weigh this {"draft":1} then: ' + JSON.stringify(ANSWER));
  eq(read && read.turning, true, 'read past the thinking');
  eq(read.options.map((o) => o.label).join(' | '), 'Tell her the truth | Say nothing | Lie again');
  eq(read.options[2].echoes.length, 2, 'two echoes kept');
  const five = { turning: true, choices: [...ANSWER.choices, { label: 'Leave', move: 'I leave.', outcome: 'The door shuts.' }, { label: 'Kneel', move: 'I kneel.', outcome: 'She stares.' }, { label: 'Say nothing', move: 'again', outcome: 'again' }] };
  eq(readChoices(JSON.stringify(five)).options.length, CHOICES_MAX, 'four at most; a name said twice once');
  const broken = { turning: true, choices: [{ label: 'Go', move: 'I go.', outcome: '' }, { label: '', move: 'x', outcome: 'y' }, { label: 'Stay', move: 'I stay.', outcome: 'Nothing moves.' }] };
  eq(readChoices(JSON.stringify(broken)), null, 'one whole choice is no choice — nothing is offered');
  const quiet = readChoices('{"turning":false}');
  assert(quiet && quiet.turning === false && quiet.options.length === 0, 'a quiet page is kept as quiet');
  eq(readChoices('Sure! The scene is tense.'), null, 'nonsense is no answer');
  const echo3 = { turning: true, choices: [{ label: 'A', move: 'I do A.', outcome: 'A follows.', echoes: [{ who: 'X', what: '1' }, { who: 'Y', what: '2' }, { who: 'Z', what: '3' }, { who: '', what: 'nobody' }] }, { label: 'B', move: 'I do B.', outcome: 'B follows.' }] };
  eq(readChoices(JSON.stringify(echo3)).options[0].echoes.map((e) => e.who).join(','), 'X,Y', 'two echoes at most, each with a who');
});

test('M548-2 THE HELPER IS ASKED WITHOUT KNOWING WHICH HE WILL PICK, AND EVERY ANSWER COMES BACK WHOLE: its question carries the story, the ledger, the people, the pages, the newest page and what his earlier choices set in motion — and nothing of any choice of his to come; a failing call is no answer', async () => {
  const ask = choiceAsk({ brief: 'BRIEF-M', essentials: 'ESS-M', facts: 'FACTS-M', people: 'PEOPLE-M', pages: ['PAGE-A', 'The writer: MOVE-A'], newest: 'NEWEST-M', mc: 'Jovan', echoes: ['- ECHO-M'] });
  for (const mark of ['BRIEF-M', 'ESS-M', 'FACTS-M', 'PEOPLE-M', 'PAGE-A', 'MOVE-A', 'NEWEST-M', 'ECHO-M']) assert(ask.user.includes(mark), 'it reads ' + mark);
  assert(/decided now, before he chooses/.test(ask.system) && /never by what would please him/.test(ask.system), 'sealed before, by the people, not to please him');
  assert(/never decide whether a blow lands or a skill succeeds/.test(ask.system), 'an attempt is for the dice');
  let asked = 0;
  const read = await makeChoices({ connection: { id: 'c' }, ask, callLLM: async () => { asked += 1; return { text: JSON.stringify(ANSWER) }; } });
  eq(asked, 1); eq(read.options.length, 3, 'the answer, read');
  eq(await makeChoices({ connection: { id: 'c' }, ask, callLLM: async () => { throw new Error('down'); } }), null, 'a failing call is no answer — nothing offered');
  eq(await makeChoices({ connection: null, ask }), null, 'no connection, nothing asked');
});

const page = (id, text, extra = {}) => ({ id, role: 'assistant', text, ...extra });
const move = (id, text, extra = {}) => ({ id, role: 'user', text, ...extra });

test('M548-3 THE SEAL: what he took is kept whole on his message and holds while his words are the words sent — a changed word, and it is his own move; on the page, the offer is kept for the version it stands at', () => {
  const offer = readChoices(JSON.stringify(ANSWER));
  const p = page('p1', 'The rain.', { swipes: [{ text: 'The rain.' }, { text: 'The river.' }], swipeIdx: 1 });
  eq(versionOf(p), 1);
  const kept = { ...p, ...offerPatch(p, offer) };
  assert(offerOf(kept) && offerOf(kept).options.length === 3, 'kept for version 2');
  eq(offerOf({ ...kept, swipeIdx: 0 }), null, 'the other version has none of its own');
  const taken = takenRecord(kept, offer, 2);
  eq(taken.label, 'Lie again'); eq(taken.others.join(' | '), 'Tell her the truth | Say nothing', 'the ones not taken, by name only');
  eq(taken.pageId, 'p1'); eq(taken.version, 1);
  const mine = move('u1', 'I tell her the attendant is only a servant.', { choiceTaken: { ...taken, words: 'I tell her the attendant is only a servant.' } });
  assert(takenOf(mine) === mine.choiceTaken, 'the seal holds');
  eq(takenOf({ ...mine, text: 'I tell her the attendant is only a gardener.' }), null, 'one changed word — his own move now');
  eq(takenOf(move('u2', 'I wait.')), null, 'his own move has none');
});

const H = (n) => '[Training yard — Monday, September 7, 2026 | 09:' + String(n % 60).padStart(2, '0') + ' | clear | gi | by the posts]\n\n';
const yard = () => ({ ...applyMutations({ ...emptyState(), page: 6 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Training yard' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rukia' }, { type: 'people.set', name: 'Rukia', field: 'core', text: 'proud, exact, loyal to her brother' }]).state, page: 6 });
function thread({ choose = 2, edited = false } = {}) {
  const offer = readChoices(JSON.stringify(ANSWER));
  const out = [];
  for (let i = 0; i < 6; i += 1) { out.push(move('u' + i, 'turn ' + i)); out.push(page('a' + i, H(i) + 'PAGE-' + i + '. The rain went on.')); }
  const at = { ...out[out.length - 1], ...offerPatch(out[out.length - 1], offer) };
  out[out.length - 1] = at;
  const taken = takenRecord(at, offer, choose);
  out.push(move('u-choice', edited ? 'I say something else.' : taken.move, { choiceTaken: { ...taken, words: taken.move } }));
  return { out, taken };
}
const build = (messages, extra = {}, settings = {}) => buildRequest({ story: { brief: 'Jovan and Rukia.' }, messages, settings: { noteText: 'MY NOTE.', ...settings }, state: yard(), modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: '', window: { keeperOn: false, budgetTokens: 500000 }, ...extra });
const wireOf = (r) => [...(r.systemBlocks || []).map((b) => (typeof b === 'string' ? b : b.text)), ...r.messages.map((m) => String(m.content))].join('\n');
const closingOf = (r) => String(r.messages[r.messages.length - 1].content);
const row = (r, n) => r.receipt.slots.find((s) => s.name === n);

test('M548-4 THE STORYTELLER IS TOLD WHAT FOLLOWS AS SETTLED — first in the closing words, where a ruling would be, in his own voice (the teller named first, as the referee\'s ruling is), never softened; its receipt row says so', () => {
  const { out, taken } = thread();
  const r = build(out, { choicesOn: true, choiceTaken: taken });
  const closing = closingOf(r);
  assert(closing.startsWith('About the choice Jovan made — lie again: She believes him, and repeats it to her brother that night.'), 'first in the closing words: ' + closing.slice(0, 160));
  assert(/What it leaves behind: Byakuya — hears the lie and will check it; Rukia — will defend the lie in front of the division\./.test(closing), 'what it leaves behind');
  assert(/It’s settled — tell it just that way, in the story’s own voice, and keep all of this between us\./.test(closing), 'settled, as the referee settles');
  assert(!/Tell her the truth|Say nothing/.test(wireOf(r)), 'the choices not taken never reach the storyteller');
  assert(row(r, 'Your choice').tokens > 0 && /sealed before you chose/.test(row(r, 'Your choice').source), 'its receipt row');
  const named = build(out, { choicesOn: true, choiceTaken: taken }, { tellerName: 'Tony', writerName: 'Bruce' });
  assert(closingOf(named).startsWith('Tony — about the choice Jovan made — lie again:'), 'in his voice, the teller named: ' + closingOf(named).slice(0, 80));
});

test('M548-5 WHAT HIS CHOICES SET IN MOTION rides in his notes on the pages after — with the page and the choice each came from, before the people\'s minds; a move he edited leaves nothing behind; the room keeps the newest', () => {
  const { out } = thread();
  const after = [...out, page('a-next', H(9) + 'She believed him.'), move('u-next', 'I walk to the gate.')];
  const text = echoesText(after);
  assert(/^What my choices set in motion — each of these still stands and will come back:/.test(text), 'its heading, in his words');
  assert(text.includes('- (page 6, when I chose to lie again) Byakuya — hears the lie and will check it.'), 'with its page and its choice: ' + text);
  const r = build(after, { choicesOn: true, choiceEchoes: text });
  const notes = wireOf(r);
  assert(notes.indexOf('What my choices set in motion') !== -1 && notes.indexOf('What my choices set in motion') < notes.indexOf('On their mind:'), 'in the notes, before the people\'s minds');
  assert(row(r, 'What your choices set in motion').tokens > 0, 'its receipt row');
  eq(echoesText(thread({ edited: true }).out), '', 'an edited move is his own — nothing set in motion');
  const many = [];
  for (let i = 0; i < 40; i += 1) { const t = thread(); many.push(...t.out.slice(-2)); }
  const all = echoLines(many, { room: Infinity });
  const lines = echoLines(many, { room: 400 });
  assert(all.length === 80 && lines.length > 1 && lines.length < all.length, 'some kept, not all: ' + lines.length + ' of ' + all.length);
  assert(lines.join('\n').length <= 400, 'within the room: ' + lines.join('\n').length);
  eq(lines.join('\n'), all.slice(-lines.length).join('\n'), 'the newest kept, oldest first');
});

test('M548-6 OFF IS OFF: with the switch off — even handed a choice and its echoes — the storyteller\'s request is byte for byte the request with no choices at all, and its two rows say the switch is off', () => {
  const { out, taken } = thread();
  const plain = build(out);
  const off = build(out, { choicesOn: false, choiceTaken: taken, choiceEchoes: echoesText(out) });
  eq(wireOf(off), wireOf(plain), 'not one byte');
  eq(JSON.stringify(off.receipt.slots.map((s) => [s.name, s.tokens, s.reason])), JSON.stringify(plain.receipt.slots.map((s) => [s.name, s.tokens, s.reason])), 'the same receipt');
  assert(/^Choices matter is off for this story/.test(row(plain, 'Your choice').reason) && /^Choices matter is off/.test(row(plain, 'What your choices set in motion').reason), 'its rows say why');
  const small = build(out, { choicesOn: false, choiceTaken: taken }, { smallModelNow: true, frameOn: false, noteOn: false });
  eq(wireOf(small), wireOf(build(out, {}, { smallModelNow: true, frameOn: false, noteOn: false })), 'a small storyteller too');
  const onNothing = build(out.slice(0, -1).concat(move('u-own', 'I wait.')), { choicesOn: true });
  eq(wireOf(onNothing), wireOf(build(out.slice(0, -1).concat(move('u-own', 'I wait.')))), 'on, with nothing taken and nothing set in motion: not one byte either');
});

test('M548-7 THE CHOICES HE CAN TAKE, AND THE FLOWCHART: offered only on the newest page with no move of his after it (an aside out of character between them does not count); the flowchart lists every turning point newest first — the one taken with what followed, his own way, the one waiting — and never a quiet page', () => {
  const offer = readChoices(JSON.stringify(ANSWER));
  const withOffer = (p) => ({ ...p, ...offerPatch(p, offer) });
  const quietP = (p) => ({ ...p, ...offerPatch(p, { turning: false, options: [] }) });
  const a1 = withOffer(page('a1', 'One.')); const a2 = quietP(page('a2', 'Two.')); const a3 = withOffer(page('a3', 'Three.')); const a4 = withOffer(page('a4', 'Four.'));
  const t1 = takenRecord(a1, offer, 0);
  const msgs = [move('u0', 'start'), a1, move('u1', t1.move, { choiceTaken: { ...t1, words: t1.move } }), a2, move('u2', 'go on'), a3, move('u3', 'I do my own thing.'), a4];
  const open = openOffer(msgs);
  assert(open && open.page.id === 'a4', 'the newest page is open');
  assert(openOffer([...msgs, move('u-ooc', '((how many pages?))', { ooc: true }), page('a-ooc', 'Twenty.', { ooc: true })]), 'an aside out of character does not close it');
  assert(openOffer([...msgs, move('u-hidden', 'Go on.', { hidden: true })]), 'a hidden "go on" with no page yet does not close it');
  eq(openOffer([...msgs, move('u4', 'I leave.')]), null, 'his move closes it');
  const flow = flowOf(msgs);
  eq(flow.map((f) => f.page).join(','), '4,3,1', 'newest first, the quiet page not listed');
  assert(flow[0].open && !flow[0].own && flow[0].took === null, 'page 4 waits for his move');
  assert(flow[1].own && flow[1].took === null, 'page 3: his own way');
  eq(flow[2].took, 0, 'page 1: the first choice taken');
  eq(flow[2].outcome, ANSWER.choices[0].outcome, 'and what followed it');
  eq(flowOf([...msgs.slice(0, 2), move('u1', 'I say it differently.', { choiceTaken: { ...t1, words: t1.move } })])[0].took, null, 'an edited move is his own way');
});
