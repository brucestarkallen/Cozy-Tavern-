/* Cozy Tavern — harness laws of M547: the smart recall (M510-50) for a small storyteller too — the older lines his move
 * MEANS ride whole beside the ones its words found, never a line the small request already carries in full, within their
 * room; and the lines the picker is not offered are exactly the ones the small branch carries in full. Every law here
 * builds the real request. M750: the essentials are retired — the request's own selection says what it carries. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { buildRequest, SMALL_PICK_CHARS } from '../../js/assemble/stack.js';
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
/* forty record lines over pages 1–160 (a small request carries the newest of them in full, and the people here) */
function record({ long = {} } = {}) {
  const nodes = [];
  for (let i = 0; i < 40; i += 1) {
    /* M750: each line long enough that a small request's newest ~16,000 characters hold only the newer three quarters */
    let text = 'LINE-' + i + ': the drills went on and the bells rang over the yard, morning after morning. ' + 'The banners were mended and the kettles were scrubbed again. '.repeat(8).trim();
    /* names no one in the scene — a line naming Rukia (here) already rides in full with the people here, and the picker is never offered it */
    if (i === 5) text = 'LINE-5 ATTENDANT: at the gate Jovan told the captains that the old attendant of the manor raised him; only Kim knows the attendant is his mother\'s brother.';
    if (i === 9) text = 'LINE-9 LANTERN: the paper lantern at the harbour burned all night while the ferryman waited for the signal that never came; ' + 'the tide turned twice and the boats knocked together in the dark. '.repeat(6);
    if (i === 12) text = 'LINE-12 KAELEN: Kaelen swore on his staff to take back the fourth seat before the first snow.';
    if (long[i]) text = 'LINE-' + i + ' LONG: ' + long[i];
    nodes.push({ id: 'n' + i, span: [i * 4, i * 4 + 3], level: 1, at: 1, text, ...(i === 5 ? { detail: 'the exact words: "He is the man who raised me, and that is all he is to you."' } : {}) });
  }
  return nodes;
}
const build = ({ picked = [], nodes = record(), move = MOVE, small = true, budgetTokens = 500000 } = {}) => buildRequest({
  story: { brief: 'Jovan, a new seat in the Gotei.' }, messages: pages(move),
  settings: { noteText: 'MY NOTE.', frameOn: false, noteOn: false, smallModelNow: small },
  state: yard(), modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }],
  memory: nodes.map((n) => n.text).join('\n'), window: { keeperOn: true, window: 30, budgetTokens, nodes },
  smallPlan: PLAN, smallIntense: false, recallPicked: picked,
});
const wireOf = (r) => [...(r.systemBlocks || []).map((b) => (typeof b === 'string' ? b : b.text)), ...r.messages.map((m) => String(m.content))].join('\n');
const closingOf = (r) => String(r.messages[r.messages.length - 1].content);
const count = (hay, needle) => hay.split(needle).length - 1;
const planRow = (r) => r.receipt.slots.find((s) => s.name === 'The plan for this page');
/* what the request carries in full, as it says itself (the selection the smart recall reads in chat.js) */
const carried = (r) => new Set(r.selection.records.filter((x) => x.selected).map((x) => x.id));

test('M547-1 THE SMALL STORYTELLER HEARS WHAT HIS MOVE MEANS: a line the smart recall names rides whole, its detail with it, once, under the earlier moments of "Our story so far"; a line already carried in full, or one the record does not hold, changes nothing; no picks, not one byte changes', () => {
  const none = build();
  const wire0 = wireOf(none);
  assert(/What I have in mind for this page/.test(closingOf(none)), 'the small request, its plan in the closing words: ' + closingOf(none).slice(0, 200));
  assert(!/LINE-5 ATTENDANT/.test(wire0), 'his words alone never find the attendant line ("uncle" is not in it)');
  assert(!carried(none).has('n5'), 'the attendant line is offered to the picker (not carried in full)');
  const one = build({ picked: ['n5'] });
  const wire1 = wireOf(one);
  eq(count(wire1, 'LINE-5 ATTENDANT'), 1, 'the named line rides once');
  assert(/In full, earlier moments that matter now — with the people here, and the ones the newest move brings up:[\s\S]*\(pages 21–24\) LINE-5 ATTENDANT: at the gate Jovan told the captains that the old attendant of the manor raised him; only Kim knows the attendant is his mother's brother\./.test(wire1), 'whole, with its own pages, under the earlier moments');
  assert(/Detail worth keeping: the exact words: "He is the man who raised me, and that is all he is to you\."/.test(wire1), 'the detail kept beneath it rides with it');
  const row = one.receipt.slots.find((s) => s.name === 'Earlier moments, in full');
  assert(/1 older line your newest move brings up \(1 of them named by the smart recall/.test(row.source), 'the row that holds it says so: ' + row.source);
  assert(!/smart recall/.test(planRow(one).source), 'and the plan’s row never claims it (M750: it rides in Our story so far, not with the plan)');
  /* a line already carried in full — among the newest (n35) or with the people here (n12, Kaelen) — is never said twice */
  assert(carried(none).has('n35') && carried(none).has('n12'), 'n35 (the newest) and n12 (Kaelen, here) ride in full');
  eq(wireOf(build({ picked: ['n35', 'n12'] })), wire0, 'naming lines already carried changes nothing');
  eq(wireOf(build({ picked: ['n-gone'] })), wire0, 'a line the record no longer holds changes nothing');
  eq(wireOf(build({ picked: [] })), wire0, 'no picks: the same request, byte for byte');
});

test('M547-2 A LINE HIS WORDS FOUND RIDES WHOLE, AND ONCE WHEN THE RECALL NAMES IT TOO; the named lines keep to their room, the first always; oldest first', () => {
  const lantern = 'I walk down to the paper lantern at the harbour where the ferryman waited.';
  const whole = record()[9].text.replace(/\s+/g, ' ').trim();
  const found = wireOf(build({ move: lantern }));
  assert(found.includes(whole), 'his words found it, whole');
  const both = wireOf(build({ move: lantern, picked: ['n9'] }));
  eq(count(both, 'LINE-9 LANTERN'), 1, 'said once');
  /* the room: three long lines — the first two fit SMALL_PICK_CHARS (the room on a context whose 3% is less), the third waits */
  const big = 'x'.repeat(Math.floor(SMALL_PICK_CHARS / 2.4));
  const three = wireOf(build({ nodes: record({ long: { 2: 'A ' + big, 3: 'B ' + big, 4: 'C ' + big } }), picked: ['n2', 'n3', 'n4'], budgetTokens: 60000 }));
  assert(/LINE-2 LONG: A/.test(three) && /LINE-3 LONG: B/.test(three) && !/LINE-4 LONG: C/.test(three), 'two of three fit their room');
  const huge = wireOf(build({ nodes: record({ long: { 2: 'H ' + 'y'.repeat(SMALL_PICK_CHARS + 2000) } }), picked: ['n2', 'n5'], budgetTokens: 60000 }));
  assert(/LINE-2 LONG: H/.test(huge) && !/LINE-5 ATTENDANT/.test(huge), 'the first named line rides even past the room; nothing after it does');
  /* in the order they happened, whatever order they were named in */
  const order = wireOf(build({ picked: ['n9', 'n5'] }));
  assert(order.indexOf('LINE-5 ATTENDANT') < order.indexOf('LINE-9 LANTERN'), 'oldest first');
});

test('M547-3 WHAT THE PICKER IS NOT OFFERED IS EXACTLY WHAT THE SMALL STORYTELLER ALREADY READS IN FULL: the request\'s own selection is the lines of "In full, the newest of it" and "In full, earlier moments" — on this ledger, on one with no one but him here, and on one whose newest lines are long', () => {
  const cases = [
    { name: 'the yard', nodes: record(), state: yard() },
    { name: 'alone', nodes: record(), state: applyMutations({ ...emptyState(), page: 20 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Training yard' }, { type: 'presence.enter', name: 'Jovan' }]).state },
    { name: 'a long newest stretch', nodes: record({ long: Object.fromEntries(Array.from({ length: 10 }, (_, k) => [30 + k, 'z'.repeat(3000) + ' Kaelen'])) }), state: yard() },
  ];
  for (const c of cases) {
    const r = buildRequest({ story: { brief: 'b' }, messages: pages(), settings: { frameOn: false, noteOn: false, smallModelNow: true }, state: c.state, modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: c.nodes.map((n) => n.text).join('\n'), window: { keeperOn: true, window: 30, budgetTokens: 500000, nodes: c.nodes }, smallPlan: PLAN, smallIntense: false });
    const rows = r.receipt.slots.filter((s) => s.name === 'What remains' || s.name === 'Earlier moments, in full').map((s) => String(s.text || '')).join('\n');
    const inFull = carried(r);
    for (const n of c.nodes) eq(inFull.has(n.id), rows.includes(n.text.trim()), c.name + ': ' + n.id + (inFull.has(n.id) ? ' is carried' : ' is offered to the picker'));
    assert(c.nodes.some((n) => !inFull.has(n.id)), c.name + ': a small request leaves older lines for the picker');
  }
});

test('M547-4 / M750 THE FRONTIER STORYTELLER READS THE WHOLE RECORD: every line carried once, so the picker has nothing to name and a named line changes nothing', () => {
  const r = build({ small: false });
  const w = wireOf(r);
  for (const n of record()) eq(count(w, n.text.trim()), 1, n.id + ' rides once');
  assert(record().every((n) => carried(r).has(n.id)), 'every line carried — the smart recall is never asked');
  eq(wireOf(build({ picked: ['n5'], small: false })), w, 'a named line changes nothing');
  assert(!/What I have in mind for this page/.test(w), 'no small plan on the frontier wire');
});
