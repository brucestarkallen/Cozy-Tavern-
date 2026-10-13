/* Cozy Tavern — harness laws of the M511 session (after a platform crash cut the m510 session short). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { buildRequest, recordLine, recordOfWhoIsHere } from '../../js/assemble/stack.js';
/* M750: the hybrid's rooms are gone with the Essentials; the speed law below keeps the sizes it was measured at */
const HYBRID_PRESENT_EACH = 6;
const HYBRID_PRESENT_CHARS = 24000;
import { CRAFT_TEXT } from '../../js/assemble/craft.js';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { renderMemory } from '../../js/agents/memory.js';

const wireOf = (r) => [...(r.systemBlocks || []).map((b) => (typeof b === 'string' ? b : b.text)), ...r.messages.map((m) => String(m.content))].join('\n');
const H = (n) => '[Yard — Monday, September 7, 2026 | 09:' + String(n % 60).padStart(2, '0') + ' | clear | gi | by the posts]\n\n';
const PLAN = { scene: 'Kaelen has called Jovan out in front of the yard.', people: [{ name: 'Kaelen', now: 'circling with his staff', wants: 'to humble Jovan', against: 'the seat Jovan was given' }], unknown: [{ name: 'Rukia Kuchiki', fact: 'Jovan met the captain last night' }], pressing: ['the captain is watching'], earlier: ['Kaelen lost to Jovan once'], laws: ['Combat Calibration', 'Voice Fingerprints'], intense: true, loud: true, loudWhy: 'the whole yard is watching', sounds: ['*CRACK!*', '"Gkh—!"'], leaveTo: 'the staff comes down at him' };
const scene = () => ({ ...applyMutations({ ...emptyState(), page: 300 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Thirteenth Division yard' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }, { type: 'presence.enter', name: 'Kenpachi Zaraki' }]).state, page: 300 });
/* a record whose every seventh line carries the auditor's detail (M12), the people here named in older lines */
const record = () => {
  const nodes = [];
  for (let i = 0; i < 60; i += 1) nodes.push({ id: 'b' + i, span: [i * 4, i * 4 + 3], level: 1, text: 'Line ' + i + ': ' + 'the drills went on and the bells rang with it. '.repeat(12) + (i === 9 ? ' Rukia Kuchiki corrects his stance.' : '') + (i === 20 ? ' Zaraki named noon for the duel.' : '') + (i === 30 ? ' Jovan told the captains he serves as personal attendant.' : ''), ...(i % 7 === 0 ? { detail: 'DETAIL-' + i + ' the exact words were kept.' } : {}) });
  return nodes;
};
const moves = (n, last) => { const out = []; for (let i = 0; i < n; i += 1) { out.push({ id: 'u' + i, role: 'user', text: 'turn ' + i }); out.push({ id: 'a' + i, role: 'assistant', text: H(i) + 'PAGE-' + i + ' Rukia watched the yard for a long while, and Zaraki grinned at the posts as the drums began again.' }); } out.push({ id: 'ux', role: 'user', text: last }); return out; };
const request = ({ small = false, nodes = record(), settings = {}, recordCap } = {}) => buildRequest({
  story: { brief: 'A Bleach story.' }, messages: moves(small ? 12 : 8, 'I ask Rukia whose attendant I really am.'), settings: { ...(small ? { smallModelNow: true } : {}), ...settings }, state: scene(),
  modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: renderMemory({ nodes }, 400000),
  window: { keeperOn: true, window: 30, budgetTokens: 262000, nodes, ...(recordCap ? { recordCap } : {}) },
  smallPlansBook: { plans: [{ id: 'p1', title: 'The duel with Zaraki', status: 'standing', parts: [{ who: 'Zaraki', does: 'fights Jovan in the yard', when: 'at noon' }], at: 1 }] },
  recallPicked: small ? [] : ['b30'], ...(small ? { smallPlan: { ...PLAN, story: 'Jovan came to the Seireitei.', intense: false } } : {}),
});

test('M511-1 WHAT THE STORYTELLER SAW IS WHAT WAS SENT (his question: "why is Normal slightly different from Raw — detail worth keeping in Normal but not in Raw; the earlier moments put half in What remains and half in Who\'s here"): for the frontier storyteller with the essentials made, and a small model with and without them, every line a row shows is in the request as sent, and every detail the auditor kept beneath a line that rides rides with it', () => {
  const voices = [{}, { tellerName: 'Hulk', writerName: 'Bruce' }, { tellerName: 'Hulk', writerName: 'Bruce', notesRole: 'user' }, { tellerName: 'Hulk', writerName: 'Bruce', notesRole: 'assistant' }];
  const cases = [];
  for (const v of voices) {
    const say = (x) => x + (v.notesRole ? ', notes as ' + v.notesRole : v.writerName ? ', his names' : '');
    cases.push([say('frontier, the whole record'), request({ settings: v }), record()], [say('frontier, a record past its room'), request({ settings: v, recordCap: 20000 }), record()], [say('small'), request({ small: true, settings: v }), record()]);
  }
  for (const [label, r, nodes] of cases) {
    const wire = wireOf(r);
    let rowsChecked = 0;
    for (const s of r.receipt.slots) {
      if (!s.tokens) continue;
      const missing = String(s.text || '').split('\n').filter((l) => l.trim() && !wire.includes(l.trim()));
      eq(missing.length, 0, label + ': the row “' + s.name + '” shows only what was sent — not sent: ' + JSON.stringify((missing[0] || '').slice(0, 90)));
      rowsChecked += 1;
    }
    assert(rowsChecked >= 4, label + ': rows checked');
    /* the auditor's details: every record line that rides carries its detail beneath it */
    const riding = nodes.filter((n) => wire.includes(n.text.trim()));
    assert(riding.length > 0, label + ': record lines ride');
    for (const n of riding.filter((x) => x.detail)) assert(wire.includes(recordLine(n)), label + ': the detail of line “' + n.text.slice(0, 8) + '” rides beneath it');
    assert(riding.some((n) => n.detail), label + ': a line with a detail rides (the law has something to hold)');
  }
});

test('M511-2 / M750 ONE PART, ONE ROW: the frontier request\'s "Our story so far" lines are the What remains row, line for line — with the line his move brings up in its own place when the record is past its room; a small request\'s "In full, earlier moments that matter now" — the people here AND the lines his newest move brings up, one list — is the "Earlier moments, in full" row, line for line; the old row names are gone', () => {
  const lines = (text) => text.split('\n').filter((l) => /^- |^  • /.test(l)).join('\n');
  for (const r of [request(), request({ recordCap: 20000 })]) {
    const wire = wireOf(r);
    const a = wire.indexOf('Our story so far — '); const b = wire.indexOf('\n\nPlans standing', a);
    assert(a !== -1 && b !== -1, 'the part rides, the plans after it');
    eq(lines(r.receipt.slots.find((s) => s.name === 'What remains').text), lines(wire.slice(a, b)), 'What remains is exactly the part');
    assert(!r.receipt.slots.some((s) => s.name === 'Who’s here, in the record' || s.name === 'Story essentials'), 'the old row names are gone');
  }
  const past = request({ recordCap: 20000 });
  assert(/personal attendant/.test(past.receipt.slots.find((s) => s.name === 'What remains').text), 'past its room, the line his move brings up rides in its place');
  const small = request({ small: true });
  const sw = wireOf(small);
  const e = sw.indexOf('In full, earlier moments that matter now'); const f = sw.indexOf('\n\nPlans standing', e);
  if (e !== -1) eq(lines(small.receipt.slots.find((s) => s.name === 'Earlier moments, in full').text), lines(sw.slice(e, f)), 'the earlier moments are exactly their own part');
  else assert(!small.receipt.slots.find((s) => s.name === 'Earlier moments, in full').tokens, 'no earlier moments part, no row');
});

test('M511-3 A RECORD LINE AS IT RIDES — its pages ("page" for one), its words, the detail beneath it; M750: the whole record rides for a frontier storyteller, every line whole with its detail — no hole', () => {
  eq(recordLine({ span: [4, 7], text: ' Rukia stood. ' }), '(pages 5–8) Rukia stood.', 'pages and words');
  eq(recordLine({ span: [4, 4], text: 'One page.' }), '(page 5) One page.', 'one page says page');
  eq(recordLine({ span: [0, 3], text: 'A line.', detail: ' the exact words. ' }), '(pages 1–4) A line.\n  • Detail worth keeping: the exact words.', 'the detail beneath its line');
  eq(recordLine({ span: [-1, -1], correction: true, text: '[Correction] Jovan is sixteen.' }), '[Correction] Jovan is sixteen.', 'a correction belongs to no page (it read "(page 0)")');
  const nodes = [];
  for (let i = 0; i < 60; i += 1) nodes.push({ id: 'h' + i, span: [i * 4, i * 4 + 3], level: 1, text: 'Line ' + i + ': ' + 'the drills went on and the bells rang with it. '.repeat(12), detail: 'DETAIL-' + i + ' ' + 'the words exactly as said, kept beneath the line. '.repeat(4) });
  const r = buildRequest({ story: {}, messages: moves(8, 'I train.'), settings: {}, state: scene(), modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: renderMemory({ nodes }, 900000), window: { keeperOn: true, window: 30, budgetTokens: 262000, nodes }, recallPicked: [] });
  const wire = wireOf(r);
  const lost = nodes.filter((n) => !wire.includes(recordLine(n)));
  eq(lost.length, 0, 'every line whole, its detail with it — lost: ' + lost.map((n) => n.id).join(', '));
  const twice = nodes.filter((n) => wire.split(n.text.trim()).length - 1 !== 1);
  eq(twice.length, 0, 'and once each — twice: ' + twice.map((n) => n.id).join(', '));
});

test('M511-4 WHO\'S HERE, FOUND ONCE PER PERSON (a measured lag: a dense record — 40 lines of ~7,000 characters, 15 people here — built 13,920 name patterns and took ~300 ms per request, twice a send): each person\'s pattern is built once a call, and the choice is what it was', () => {
  const here = ['Rukia Kuchiki', 'Byakuya Kuchiki', 'Kenpachi Zaraki', 'Toshiro Hitsugaya', 'Shunsui Kyoraku', 'Renji Abarai', 'Yachiru Kusajishi', 'Ikkaku Madarame', 'Yumichika Ayasegawa', 'Rangiku Matsumoto', 'Soi Fon', 'Mayuri Kurotsuchi', 'Nanao Ise', 'Isane Kotetsu', 'Hachigoro Sotome'];
  const st = { page: 150, mc: { name: 'Jovan Oda' }, present: ['Jovan Oda', ...here].map((name) => ({ name })), characters: Object.fromEntries(here.map((n) => [n, { core: 'x' }])), knowledge: {} };
  const nodes = [];
  for (let i = 0; i < 40; i += 1) { let t = ''; let k = i; while (t.length < 7000) { const who = here[(k * 7 + i) % here.length]; t += (k % 3 === 0 ? who.split(' ')[1] : who.split(' ')[0]) + ' watched the gate. '; k += 1; } nodes.push({ id: 'n' + i, span: [i * 4, i * 4 + 3], level: 1, text: t }); }
  let built = 0;
  const Real = globalThis.RegExp;
  globalThis.RegExp = new Proxy(Real, { construct(target, args) { built += 1; return new target(...args); }, apply(target, self, args) { built += 1; return target(...args); } });
  let r;
  try { r = recordOfWhoIsHere(nodes, st, { each: HYBRID_PRESENT_EACH, cap: HYBRID_PRESENT_CHARS }); } finally { globalThis.RegExp = Real; }
  assert(built <= here.length + 4, 'one pattern per person, not per line and pass: ' + built + ' built');
  assert(r.text.length <= HYBRID_PRESENT_CHARS && r.lines >= 1 && r.who.length === here.length, 'the room holds, everyone found');
  eq(r.nodes.length, r.lines, 'it hands back the lines it chose');
});
