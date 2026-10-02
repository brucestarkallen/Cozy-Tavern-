/* Cozy Tavern — harness laws of M547: the smart recall (M510-50) for a small storyteller too — the older lines his move
 * MEANS ride whole beside the ones its words found, never a line the small request already carries in full, within their
 * room; and the lines the picker is not offered are exactly the ones the small branch carries in full. Every law here
 * builds the real request. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { buildRequest, smallRecordWhole, SMALL_PICK_CHARS } from '../../js/assemble/stack.js';
import { CRAFT_TEXT } from '../../js/assemble/craft.js';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const H = (n) => '[Training yard — Monday, September 7, 2026 | 09:' + String(n % 60).padStart(2, '0') + ' | clear | gi | by the posts]\n\n';
function yard() {
  const st = applyMutations({ ...emptyState(), page: 20 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'clock.set', year: 2026, month: 9, day: 7, hour: 9, minute: 20 }, { type: 'place.set', name: 'Training yard' },
    { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Kaelen' }, { type: 'presence.enter', name: 'Rukia Kuchiki' },
    { type: 'people.set', name: 'Kaelen', field: 'core', text: 'fourth seat, proud, fights with a staff' }]).state;
  return { ...st, page: 20 };
}
const PLAN = { scene: 'Byakuya has stopped the drill to ask a question in front of the yard.', people: [{ name: 'Kaelen', now: 'leaning on his staff', wants: 'to see Jovan squirm', against: 'the seat Jovan was given' }], unknown: [], pressing: ['the whole yard is listening'], earlier: [], laws: ['Voice Fingerprints'], intense: false, loud: false, sounds: [], leaveTo: 'what Jovan answers' };
const MOVE = 'Byakuya asks who my uncle is, in front of the whole yard.';
const pages = (move = MOVE) => { const out = []; for (let i = 0; i < 20; i += 1) { out.push({ id: 'u' + i, role: 'user', text: 'turn ' + i }); out.push({ id: 'a' + i, role: 'assistant', text: H(i) + 'PAGE-' + i + '. The drill went on.' }); } out.push({ id: 'u-last', role: 'user', text: move }); return out; };
/* forty record lines over pages 1–160; the essentials cover pages 1–120, so lines 30–39 are \"since then\" */
function record({ long = {} } = {}) {
  const nodes = [];
  for (let i = 0; i < 40; i += 1) {
    let text = 'LINE-' + i + ': the drills went on and the bells rang over the yard, morning after morning.';
    /* names no one in the scene — a line naming Rukia (here) already rides in full with the people here, and the picker is never offered it */
    if (i === 5) text = 'LINE-5 ATTENDANT: at the gate Jovan told the captains that the old attendant of the manor raised him; only Kim knows the attendant is his mother\'s brother.';
    if (i === 9) text = 'LINE-9 LANTERN: the paper lantern at the harbour burned all night while the ferryman waited for the signal that never came; ' + 'the tide turned twice and the boats knocked together in the dark. '.repeat(6);
    if (i === 12) text = 'LINE-12 KAELEN: Kaelen swore on his staff to take back the fourth seat before the first snow.';
    if (long[i]) text = 'LINE-' + i + ' LONG: ' + long[i];
    nodes.push({ id: 'n' + i, span: [i * 4, i * 4 + 3], level: 1, at: 1, text, ...(i === 5 ? { detail: 'the exact words: "He is the man who raised me, and that is all he is to you."' } : {}) });
  }
  return nodes;
}
const ESS = { text: '- [Day 1 · the Seireitei] (pages 1–120) Jovan arrives; is given the fourth seat over Kaelen; trains; the yard waits on the rematch.', upTo: 119, at: 1 };
const build = ({ picked = [], nodes = record(), move = MOVE, small = true } = {}) => buildRequest({
  story: { brief: 'Jovan, a new seat in the Gotei.' }, messages: pages(move),
  settings: { noteText: 'MY NOTE.', frameOn: false, noteOn: false, smallModelNow: small },
  state: yard(), modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }],
  memory: nodes.map((n) => n.text).join('\n'), window: { keeperOn: true, window: 30, budgetTokens: 500000, nodes },
  smallPlan: PLAN, smallIntense: false, smallEssentials: ESS, recallPicked: picked,
});
const wireOf = (r) => [...(r.systemBlocks || []).map((b) => (typeof b === 'string' ? b : b.text)), ...r.messages.map((m) => String(m.content))].join('\n');
const closingOf = (r) => String(r.messages[r.messages.length - 1].content);
const count = (hay, needle) => hay.split(needle).length - 1;
const planRow = (r) => r.receipt.slots.find((s) => s.name === 'The plan for this page');

test('M547-1 THE SMALL STORYTELLER HEARS WHAT HIS MOVE MEANS: a line the smart recall names rides whole, its detail with it, once, in the closing words beside the ones his words found; a line already carried in full, or one the record does not hold, changes nothing; no picks, not one byte changes', () => {
  const none = build();
  const wire0 = wireOf(none);
  assert(/What I have in mind for this page/.test(closingOf(none)), 'the small request, its plan in the closing words: ' + closingOf(none).slice(0, 200));
  assert(!/LINE-5 ATTENDANT/.test(wire0), 'his words alone never find the attendant line ("uncle" is not in it)');
  const one = build({ picked: ['n5'] });
  const wire1 = wireOf(one);
  eq(count(wire1, 'LINE-5 ATTENDANT'), 1, 'the named line rides once');
  assert(/LINE-5 ATTENDANT: at the gate Jovan told the captains that the old attendant of the manor raised him; only Kim knows the attendant is his mother's brother\./.test(closingOf(one)), 'whole, in the closing words: ' + closingOf(one).slice(-600));
  assert(!smallRecordWhole(record(), ESS, yard()).has(record()[5]) && ![...smallRecordWhole(record(), ESS, yard())].some((n) => n.id === 'n5'), 'the attendant line is offered to the picker (not carried in full)');
  assert(/\(pages 21–24\) LINE-5 ATTENDANT/.test(closingOf(one)), 'with its own pages');
  assert(/detail worth keeping: the exact words: "He is the man who raised me, and that is all he is to you\."/.test(closingOf(one)), 'the detail kept beneath it rides with it');
  assert(/with 1 older line named by the smart recall for what your move means/.test(planRow(one).source), 'the receipt says so: ' + planRow(one).source);
  assert(!/smart recall/.test(planRow(none).source), 'and says nothing when it named nothing');
  /* a line already carried in full — since the essentials (n35) or with the people here (n12, Kaelen) — is never said twice */
  const riding = smallRecordWhole(record(), ESS, yard());
  assert([...riding].some((n) => n.id === 'n35') && [...riding].some((n) => n.id === 'n12'), 'n35 (since then) and n12 (Kaelen, here) ride in full: ' + [...riding].map((n) => n.id).join(','));
  eq(wireOf(build({ picked: ['n35', 'n12'] })), wire0, 'naming lines already carried changes nothing');
  eq(wireOf(build({ picked: ['n-gone'] })), wire0, 'a line the record no longer holds changes nothing');
  eq(wireOf(build({ picked: [] })), wire0, 'no picks: the same request, byte for byte');
});

test('M547-2 A LINE HIS WORDS FOUND AS A GLIMPSE RIDES WHOLE WHEN THE RECALL NAMES IT TOO — once; and the named lines keep to their room, the first always', () => {
  const lantern = 'I walk down to the paper lantern at the harbour where the ferryman waited.';
  const glimpse = build({ move: lantern });
  const c0 = closingOf(glimpse);
  assert(/LINE-9 LANTERN/.test(c0) && /…/.test(c0.slice(c0.indexOf('LINE-9 LANTERN'))), 'his words found it, cut to a glimpse: ' + c0.slice(c0.indexOf('LINE-9'), c0.indexOf('LINE-9') + 320));
  const both = closingOf(build({ move: lantern, picked: ['n9'] }));
  eq(count(both, 'LINE-9 LANTERN'), 1, 'said once');
  assert(both.includes(record()[9].text.replace(/\s+/g, ' ').trim()), 'whole, not the glimpse');
  /* the room: three long lines — the first two fit SMALL_PICK_CHARS, the third waits */
  const big = 'x'.repeat(Math.floor(SMALL_PICK_CHARS / 2.4));
  const three = closingOf(build({ nodes: record({ long: { 2: 'A ' + big, 3: 'B ' + big, 4: 'C ' + big } }), picked: ['n2', 'n3', 'n4'] }));
  assert(/LINE-2 LONG: A/.test(three) && /LINE-3 LONG: B/.test(three) && !/LINE-4 LONG: C/.test(three), 'two of three fit their room');
  const huge = closingOf(build({ nodes: record({ long: { 2: 'H ' + 'y'.repeat(SMALL_PICK_CHARS + 2000) } }), picked: ['n2', 'n5'] }));
  assert(/LINE-2 LONG: H/.test(huge) && !/LINE-5 ATTENDANT/.test(huge), 'the first named line rides even past the room; nothing after it does');
  /* in the order they happened, whatever order they were named in */
  const order = closingOf(build({ picked: ['n9', 'n5'] }));
  assert(order.indexOf('LINE-5 ATTENDANT') < order.indexOf('LINE-9 LANTERN'), 'oldest first');
});

test('M547-3 WHAT THE PICKER IS NOT OFFERED IS EXACTLY WHAT THE SMALL STORYTELLER ALREADY READS IN FULL: smallRecordWhole is the lines of "In full, since then" and "In full, earlier moments with the people here" — on this ledger, on one with no one but him here, and on one whose essentials reach the end', () => {
  const cases = [
    { name: 'the yard', nodes: record(), ess: ESS, state: yard() },
    { name: 'alone', nodes: record(), ess: ESS, state: applyMutations({ ...emptyState(), page: 20 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Training yard' }, { type: 'presence.enter', name: 'Jovan' }]).state },
    { name: 'essentials to the end', nodes: record(), ess: { ...ESS, upTo: 159 }, state: yard() },
    { name: 'a long since', nodes: record({ long: Object.fromEntries(Array.from({ length: 10 }, (_, k) => [30 + k, 'z'.repeat(3000) + ' Kaelen'])) }), ess: ESS, state: yard() },
  ];
  for (const c of cases) {
    const r = buildRequest({ story: { brief: 'b' }, messages: pages(), settings: { frameOn: false, noteOn: false, smallModelNow: true }, state: c.state, modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: c.nodes.map((n) => n.text).join('\n'), window: { keeperOn: true, window: 30, budgetTokens: 500000, nodes: c.nodes }, smallPlan: PLAN, smallIntense: false, smallEssentials: c.ess });
    const rows = r.receipt.slots.filter((s) => s.name === 'What remains' || s.name === 'Earlier moments, in full').map((s) => String(s.text || '')).join('\n');
    const whole = smallRecordWhole(c.nodes, c.ess, c.state);
    for (const n of c.nodes) eq(whole.has(n), rows.includes(n.text.trim()), c.name + ': ' + n.id + (whole.has(n) ? ' is offered as carried' : ' is offered to the picker'));
  }
  eq(smallRecordWhole(record(), null, yard()).size, 0, 'no essentials, nothing set aside (the picker is never asked then)');
});

test('M547-4 THE FRONTIER STORYTELLER IS UNTOUCHED: its request with the same picks is what M510-50 made it — the named line under "earlier moments that matter now", whole', () => {
  const r = build({ picked: ['n5'], small: false });
  const w = wireOf(r);
  assert(/In full, earlier moments that matter now[\s\S]*LINE-5 ATTENDANT/.test(w), 'the hybrid carries it where it always did');
  assert(!/What I have in mind for this page/.test(w), 'no small plan on the frontier wire');
});
