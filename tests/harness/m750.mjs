/* Cozy Tavern — harness laws of M750: OUR STORY SO FAR, THE RECORD ITSELF. His choice after the numbers: the Essentials came out
 * as long as the record they shortened, and the hybrid sent them beside the newest half of the record in full — most of the
 * story told twice. A frontier storyteller reads the record whole, each line once, under plain words; a small one keeps its
 * focused request; every helper reads the record; the smart recall is told what the page already has and is never asked
 * when the request carries every line. Every law builds the real request or the real helper prompt. */
import './idb-shim.mjs';
import { test, assert as ok0, eq } from './lib.mjs';
import { buildRequest, recordLine } from '../../js/assemble/stack.js';
import { CRAFT_TEXT } from '../../js/assemble/craft.js';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { renderMemory } from '../../js/agents/memory.js';
import { pickRecall } from '../../js/agents/recallpick.js';
import { choiceAsk } from '../../js/agents/choices.js';
import { groundAsk, groundUpdateAsk } from '../../js/agents/worldground.js';
import { buildSeedUser } from '../../js/agents/referee.js';
import { movedWorkerPicks, WORKER_ROWS } from '../../js/agents/assign.js';
import { healthSnapshot } from '../../js/agents/health.js';

const ok = (c, m) => ok0(c, m);
const wireOf = (r) => [...(r.systemBlocks || []).map((b) => (typeof b === 'string' ? b : b.text)), ...r.messages.map((m) => String(m.content))].join('\n');
const count = (hay, needle) => hay.split(needle).length - 1;
const H = (n) => '[Yard — Monday, September 7, 2026 | 09:' + String(n % 60).padStart(2, '0') + ' | clear | gi | by the posts]\n\n';
const PLAN = { scene: 'Kaelen has called Jovan out.', people: [{ name: 'Kaelen', now: 'circling', wants: 'to humble Jovan', against: 'the seat' }], unknown: [], pressing: ['the captain is watching'], earlier: [], laws: ['Combat Calibration', 'Voice Fingerprints'], intense: false, sounds: [], leaveTo: 'the staff comes down' };
const scene = () => ({ ...applyMutations({ ...emptyState(), page: 300 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Thirteenth Division yard' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }, { type: 'presence.enter', name: 'Kenpachi Zaraki' }]).state, page: 300 });
const record = () => {
  const nodes = [];
  for (let i = 0; i < 60; i += 1) nodes.push({ id: 'b' + i, span: [i * 4, i * 4 + 3], level: 1, text: 'Line ' + i + ': ' + 'the drills went on and the bells rang with it. '.repeat(12) + (i === 9 ? ' Rukia Kuchiki corrects his stance.' : '') + (i === 20 ? ' Zaraki named noon for the duel.' : '') + (i === 30 ? ' Jovan told the captains he serves as personal attendant.' : ''), ...(i % 7 === 0 ? { detail: 'DETAIL-' + i + ' the exact words were kept.' } : {}) });
  return nodes;
};
const moves = (n, last) => { const out = []; for (let i = 0; i < n; i += 1) { out.push({ id: 'u' + i, role: 'user', text: 'turn ' + i }); out.push({ id: 'a' + i, role: 'assistant', text: H(i) + 'PAGE-' + i + ' Rukia watched the yard for a long while, and Zaraki grinned at the posts.' }); } out.push({ id: 'ux', role: 'user', text: last }); return out; };
const plans = { plans: [{ id: 'p1', title: 'The duel with Zaraki', status: 'standing', parts: [{ who: 'Zaraki', does: 'fights Jovan in the yard', when: 'at noon' }], at: 1 }] };
const request = ({ small = false, nodes = record(), budgetTokens = 262000, recordCap, recallPicked = [], settings = {} } = {}) => buildRequest({
  story: { brief: 'A Bleach story.' }, messages: moves(small ? 12 : 8, 'I ask Rukia whose attendant I really am.'), settings: { ...(small ? { smallModelNow: true } : {}), ...settings }, state: scene(),
  modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: renderMemory({ nodes }, 400000),
  window: { keeperOn: true, window: 30, budgetTokens, nodes, ...(recordCap ? { recordCap } : {}) },
  smallPlansBook: plans, recallPicked, ...(small ? { smallPlan: { ...PLAN, story: 'Jovan came to the Seireitei and trains with the Thirteenth.' } } : {}),
});
const BANNED = /essentials|Complete folded|Selected complete folded|compressed (?:timeline|historical)|source ownership|Dialogue may be a belief|instructions overriding the writer|authorized wire view|Historical original excerpt/i;

test('M750-1 A FRONTIER STORYTELLER READS THE WHOLE RECORD: every line once, oldest first, its detail beneath it, under plain words; no essentials row; the earlier-moments row says the whole record rides; every line selected, so the smart recall has nothing to name', async () => {
  const nodes = record();
  const r = request({ nodes });
  const wire = wireOf(r);
  const each = nodes.map((n) => count(wire, n.text.trim()));
  ok(each.every((c) => c === 1), 'frontier: every record line rides exactly once — counts ' + JSON.stringify([...new Set(each)]));
  ok(wire.includes('Our story so far — everything that came before the pages that follow, oldest first.'), 'frontier: the plain heading');
  ok(!BANNED.test(wire), 'frontier: no system labels or Essentials on the wire — found ' + (wire.match(BANNED) || [''])[0]);
  ok(wire.includes('Plans standing — laid out on the page, kept whole until carried out; any of them can still change or fall through'), 'frontier: plans heading');
  const remains = r.receipt.slots.find((s) => s.name === 'What remains');
  ok(remains && remains.tokens > 0 && remains.text.split('\n').filter(Boolean).every((l) => wire.includes(l)), 'frontier: What remains shows exactly what rode');
  ok(!r.receipt.slots.some((s) => s.name === 'Story essentials'), 'frontier: no Story essentials row');
  const earlier = r.receipt.slots.find((s) => s.name === 'Earlier moments, in full');
  ok(earlier && earlier.tokens === 0 && /reads the whole record \(What remains\) — every earlier moment is in it/.test(earlier.reason), 'frontier: Earlier moments row says the whole record rides — ' + (earlier && earlier.reason));
  ok(r.selection.records.filter((x) => x.available !== false).every((x) => x.selected), 'frontier: every record line is selected (the smart recall has nothing to name)');
  const order = nodes.map((n) => wire.indexOf(n.text.trim()));
  ok(order.every((v, i) => i === 0 || v > order[i - 1]), 'frontier: oldest first');
  for (const n of nodes.filter((x) => x.detail)) ok(wire.includes(recordLine(n)), 'frontier: detail rides under line ' + n.id);
});
test('M750-2 PAST ITS ROOM: the oldest lines left out and the part says how many; the line his move means comes back in its own place; never a line twice', async () => {
  const nodes = record();
  const r = request({ nodes, recordCap: 30000, recallPicked: ['b3'] });
  const wire = wireOf(r);
  const each = nodes.map((n) => count(wire, n.text.trim()));
  ok(each.every((c) => c <= 1), 'overflow: no line twice');
  const shown = each.filter((c) => c === 1).length;
  const left = nodes.length - shown;
  ok(left > 0, 'overflow: some lines left out (' + left + ')');
  ok(wire.includes('Our story so far — what came before the pages that follow, oldest first.') && wire.includes('(' + left + ' older lines don’t fit here and are left out — what happened in them still stands.)'), 'overflow: heading and the honest count');
  ok(each[3] === 1 && each[2] === 0, 'overflow: the old line the smart recall named (b3) is called back, its neighbours stay out');
  const order = nodes.map((n) => wire.indexOf(n.text.trim())).filter((v) => v !== -1);
  ok(order.every((v, i) => i === 0 || v > order[i - 1]), 'overflow: still in the order it happened (the recalled line in its place)');
  ok(!BANNED.test(wire), 'overflow: no system labels — ' + (wire.match(BANNED) || [''])[0]);
  const remains = r.receipt.slots.find((s) => s.name === 'What remains');
  ok(/left out — no room/.test(remains.reason) && /1 older line your newest move brings up rides in place \(1 named by the smart recall\)/.test(remains.reason), 'overflow: receipt says what was left out and called back — ' + remains.reason);
  ok(r.selection.records.some((x) => !x.selected), 'overflow: unselected lines remain for the smart recall');
  const earlier = r.receipt.slots.find((s) => s.name === 'Earlier moments, in full');
  ok(earlier && earlier.tokens === 0 && /not every older line fits/.test(earlier.reason) && !/every earlier moment is in it/.test(earlier.reason), 'overflow: the earlier-moments row never claims the whole record rode — ' + (earlier && earlier.reason));
});
test('M750-3 A SMALL STORYTELLER KEEPS ITS FOCUSED REQUEST: the story in short, the newest lines in full, the earlier moments that matter now — each line once, no essentials', async () => {
  const nodes = record();
  const r = request({ small: true, nodes, recallPicked: ['b30'] });
  const wire = wireOf(r);
  const each = nodes.map((n) => count(wire, n.text.trim()));
  ok(each.every((c) => c <= 1), 'small: no line twice — ' + JSON.stringify(each.map((c, i) => c > 1 ? i : null).filter((x) => x !== null)));
  ok(wire.includes('Our story so far — what came before the pages that follow.'), 'small: heading');
  ok(wire.includes('In brief, as I remember it:\nJovan came to the Seireitei and trains with the Thirteenth.'), 'small: the story in short rides');
  ok(/In full, the newest of it \(pages \d+–\d+\):/.test(wire), 'small: the newest lines in full');
  ok(wire.includes('In full, earlier moments that matter now — with the people here, and the ones the newest move brings up:'), 'small: earlier moments heading');
  ok(each[9] === 1 && each[30] === 1, 'small: the line of someone here (b9) and the line his move brings up (b30) ride');
  ok(!BANNED.test(wire), 'small: no system labels — ' + (wire.match(BANNED) || [''])[0]);
  const short = r.receipt.slots.find((s) => s.name === 'The story in short');
  ok(short && short.tokens > 0, 'small: The story in short row carries it');
  ok(!r.receipt.slots.some((s) => s.name === 'Story essentials'), 'small: no Story essentials row');
  const earlier = r.receipt.slots.find((s) => s.name === 'Earlier moments, in full');
  ok(earlier && earlier.tokens > 0 && /1 older line your newest move brings up/.test(earlier.source), 'small: earlier row counts the called-back line — ' + (earlier && earlier.source));
});
test('M750-4 THE SMART RECALL IS TOLD WHAT THE PAGE ALREADY HAS, AND IS NEVER ASKED WHEN NOTHING IS LEFT TO NAME', async () => {
  const nodes = record();
  let asked = null;
  const callLLM = async (_c, o) => { asked = o; return { text: '{"lines":[2]}' }; };
  const conn = { id: 'c', type: 'openai', model: 'm', contextTokens: 128000 };
  const out = await pickRecall({ connection: conn, known: 'The record lines it carries word for word:\n- (pages 1–4) Line 0', nodes, move: 'whose attendant am I', lastPage: 'x', mc: 'Jovan', skip: (n) => Number(n.id.slice(1)) >= 40, callLLM });
  ok(asked && asked.user.includes('WHAT THE NEXT PAGE ALREADY HAS:\nThe record lines it carries word for word:') && asked.user.includes('THE OLDER RECORD LINES IT DOES NOT HAVE:'), 'recall: asked with what the page has');
  ok(!/essentials|timeline/i.test(asked.system + asked.user), 'recall: no Essentials or timeline wording');
  ok(out.ids.length === 1 && Number(out.ids[0].slice(1)) < 40, 'recall: picks an offered line — ' + JSON.stringify(out.ids));
  let calls = 0;
  const none = await pickRecall({ connection: conn, known: 'x', nodes, move: 'm', lastPage: 'p', skip: () => true, callLLM: async () => { calls++; return { text: '{"lines":[]}' }; } });
  ok(calls === 0 && none.ids.length === 0, 'recall: every line carried — no helper is asked');
});
test('M750-5 EVERY HELPER READS THE RECORD: the choices keeper, the world keeper, the referee’s weighing (both ends when it must be shortened)', async () => {
  const c = choiceAsk({ brief: 'B', record: '- RECORD-LINE', facts: 'F', people: 'P', pages: ['p'], newest: 'n', mc: 'Jovan' });
  ok(c.user.includes('OUR STORY SO FAR (the record, oldest first — the pages below come after it):\n- RECORD-LINE') && !/essentials|IN BRIEF/i.test(c.user), 'choices: the record rides');
  const g = groundAsk({ brief: 'B', record: '- OLDER-LINE', recent: ['NEWEST-LINE'] });
  ok(g.user.includes('OUR STORY SO FAR, THE RECORD') && g.user.includes('- OLDER-LINE') && g.user.includes('NEWEST-LINE') && !/essentials|IN BRIEF/i.test(g.user), 'world keeper: the record rides');
  const gu = groundUpdateAsk({ ground: { parts: { world: 'w' } }, record: '- OLDER-LINE', recent: ['NEWEST-LINE'] });
  ok(gu.user.includes('- OLDER-LINE'), 'world keeper update: the record rides');
  const longRecord = 'OPENING-SCENE Jovan parried Ivar.\n' + 'x'.repeat(200000) + '\nNEWEST-SCENE';
  const s = buildSeedUser({ state: scene(), pages: [], brief: 'B', castNotes: '', record: longRecord, room: 60000 });
  ok(s.includes('OPENING-SCENE') && s.includes('NEWEST-SCENE') && !s.includes('story_in_brief'), 'referee weighing: a long record keeps both ends, no story in brief');
});
test('M750-6 THE WORLD KEEPER’S HANDS: a pick he made for the retired essentials keeper moves to the world keeper’s own row — never lost, never doubled', async () => {
  const a = movedWorkerPicks({ essentials: 'conn-1', keeper: 'k' });
  ok(a.changed && a.map.ground === 'conn-1' && !('essentials' in a.map) && a.map.keeper === 'k', 'migration: essentials pick moves to ground');
  const b = movedWorkerPicks({ essentials: 'conn-1', ground: 'conn-2' });
  ok(b.changed && b.map.ground === 'conn-2' && !('essentials' in b.map), 'migration: his own ground pick wins');
  const c = movedWorkerPicks({ keeper: 'k' });
  ok(!c.changed && JSON.stringify(c.map) === '{"keeper":"k"}', 'migration: nothing to move, nothing changes');
  ok(!movedWorkerPicks(undefined).changed, 'migration: no map');
  ok(WORKER_ROWS.some(([k]) => k === 'ground') && !WORKER_ROWS.some(([k]) => k === 'essentials'), 'workers: the world keeper has its own row; the essentials row is gone');
});
test('M750-7 THE LIGHT: nothing owed is green — no essentials reason can hold it yellow', async () => {
  const h = healthSnapshot({ storyId: 's', shelf: {}, state: {}, pages: [], mem: {}, story: {} });
  ok(h.status === 'green', 'light: green with nothing owed — ' + h.status + ' ' + h.reasons.join('; '));
});
test('M750-8 THE PASSAGE HIS MOVE BRINGS UP STILL RIDES WORD FOR WORD (M737’s excerpts — the hybrid called the line back and read its page; with every line riding, the page of the line his move names is read all the same): the page’s own words under plain words, the line itself still once', async () => {
  const nodes = Array.from({ length: 6 }, (_, i) => ({ id: 'w' + i, span: [i * 4, i * 4 + 3], level: 1, text: 'Line ' + i + ': the drills went on in the yard. ' + (i === 1 ? 'Ukitake gave Jovan a silver whistle for the north gate.' : 'The bells rang at noon over the barracks.') }));
  const history = [];
  for (let i = 0; i < 29; i += 1) history.push(i % 2 ? { id: 'p' + i, role: 'assistant', text: H(i) + 'The yard was quiet, page ' + i + '.' } : { id: 'p' + i, role: 'user', text: 'I wait, move ' + i + '.' });
  history[5] = { ...history[5], text: H(5) + 'Ukitake pressed the silver whistle into his palm. "Blow it twice at the north gate, and they will open it for you."\n\nJovan nodded.' };
  history.push({ id: 'move', role: 'user', text: 'I raise the silver whistle Ukitake gave me and blow it twice at the north gate.' });
  const r = buildRequest({ story: { brief: 'A Bleach story.' }, messages: history, settings: {}, state: scene(), modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: renderMemory({ nodes }, 400000), window: { keeperOn: true, window: 5, recordThrough: 24, budgetTokens: 262000, nodes } });
  const wire = wireOf(r);
  ok(nodes.every((n) => count(wire, n.text.trim()) === 1), 'every record line still rides once — ' + JSON.stringify(nodes.map((n) => count(wire, n.text.trim()))));
  ok(r.selection.records.filter((x) => x.available !== false).every((x) => x.selected), 'the whole record rides (nothing is called back)');
  ok(wire.includes('From page 6, word for word — the past, not the scene now:\n' + H(5).trim()) || wire.includes('From page 6, word for word — the past, not the scene now:\nUkitake pressed the silver whistle'), 'the page his move brings up rides in its own words, under plain words');
  ok(count(wire, 'Blow it twice at the north gate') === 1, 'its exact words ride once (the page itself is not carried word for word)');
  ok(r.selection.excerpts.some((x) => x.sourceId === 'p5'), 'the request’s selection names the page — ' + JSON.stringify(r.selection.excerpts.map((x) => x.sourceId)));
  const row = r.receipt.slots.find((s) => s.name === 'Historical original excerpts');
  ok(row && row.tokens > 0 && row.text.includes('Blow it twice at the north gate'), 'its receipt row holds the words that rode');
  ok(!BANNED.test(wire), 'no system labels — ' + (wire.match(BANNED) || [''])[0]);
});
