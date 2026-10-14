/* Cozy Tavern — harness laws of M673: the continuous audit (js/agents/continuous.js). His: "step by step it makes sure the
 * folds summary, the ledger, the pages is always correct if I toggled on … from turn 1 until 1,000 or beyond". Every law
 * here RUNS the reader: a record is written, pages are read, and what came back is what is asserted. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { emptyState, loadState, saveState, foldJournal } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { KNOWLEDGE_GUARD } from '../../js/engine/world.js';
import { db } from '../../js/store.js';
import {
  loadMemory, saveMemory, auditedOf, auditedAcross, memoryAfterDeletion, memoryTruncatedAt, memoryWithoutPage, maybeSummarize, redoLine, visiblePages,
} from '../../js/agents/memory.js';
import {
  auditProgress, nextStretch, buildStretchMessages, parseStretchAnswer, scopeStretch, pagesSay, storyPageAt, auditStretch, stretchWords,
  ledgerForPages, lineIsHis, beginReading, endReading, pauseContinuousAudit, continuousAuditOn, STRETCH_PAGES, LEDGER_ADDS, PAGE_FIXES, UNREADABLE_TRIES,
  auditWaits, RECOVERY_DELAY,
} from '../../js/agents/continuous.js';
import { fingerprint36 } from '../../js/engine/fingerprint.js';
import { pageText } from '../../js/assemble/stack.js';
import { markWorkerRunning } from '../../js/agents/status.js';
import { pendingWork } from '../../js/agents/extractor.js';

const CONN = { type: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'deepseek-chat', reasoning: { effort: 'off' } };
const sse = (pieces) => { const t = pieces.map((p) => 'data: ' + JSON.stringify(p) + '\n\n').join('') + 'data: [DONE]\n\n'; return { ok: true, status: 200, headers: new Headers(), body: new Response(t).body, text: async () => t }; };
const say = (text) => sse([{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]);
const bodyOf = (opts) => { const b = JSON.parse(opts.body); return { system: String((b.messages.find((m) => m.role === 'system') || {}).content || ''), user: String(b.messages.slice(-1)[0].content || '') }; };
const page = (i, text) => ({ role: i % 2 ? 'assistant' : 'user', text });

/* the six pages every end-to-end law reads, and the line that stands for them (it names the wrong man) */
const SIX = [
  'I show Rukia the seal.',
  '[Thirteenth Division barracks — Monday | 09:10]\n\nJovan drew the seal of the Thirteenth from his coat. Rukia stared at it. "You carry the seal," she said. Renji was nowhere near; he had left for the gate at dawn.',
  'I ask her to keep it hidden.',
  'Rukia promised Jovan she would keep the seal hidden from the captains. Her grey eyes did not leave his.',
  'I thank her.',
  'Renji came back from the gate before noon and found them in the yard. He asked nothing.',
];
const LINE_A = 'Jovan showed Rukia the seal of the Thirteenth; Marcus came back from the gate before noon.';
const ledgerOf = () => {
  const st = applyMutations({ ...emptyState() }, [
    { type: 'mc.set', name: 'Jovan' },
    { type: 'people.set', name: 'Rukia', field: 'core', text: 'a shinigami of the Thirteenth Division' },
    { type: 'people.set', name: 'Renji', field: 'core', text: 'a lieutenant, posted at the gate' },
  ]).state;
  return { ...st, page: 19 };
};
async function tale(title, { lines } = {}) {
  const st = await db.stories.create({ title: title + ' ' + Math.random() });
  for (let i = 0; i < 6; i += 1) await db.messages.append(st.id, page(i, SIX[i]));
  for (let i = 6; i < 44; i += 1) await db.messages.append(st.id, page(i, i % 2 ? 'The yard was quiet that hour, and Rukia swept it. Page ' + i + '.' : 'I wait. ' + i));
  await saveState(st.id, ledgerOf());
  await saveMemory(st.id, { window: 30, nodes: lines || [
    { id: 'a', span: [0, 5], text: LINE_A, level: 1, at: 1, whole: true },
    { id: 'b', span: [6, 11], text: 'Rukia swept the yard; nothing else moved.', level: 1, at: 2, whole: true },
  ] });
  return st;
}
const withFetch = async (impl, fn) => { const prior = globalThis.fetch; globalThis.fetch = impl; try { return await fn(); } finally { globalThis.fetch = prior; } };
/* the writer's brief, which page 2 cannot be true beside. M722: a story fault is mended or noted only when the reader
 * quotes its wrong words on that page AND the brief or earlier record it conflicts with — the answer below is the shape the
 * reader is asked for now (a target for every issue; for a record fix the passage that supports it and why) */
const BRIEF = 'A story of the Thirteenth Division. Renji has stood watch at the gate since the night before the story opens.';
const ANSWER = JSON.stringify({ issues: [
  { what: 'The line names Marcus; the pages have Renji come back from the gate.', target: 'record', record: { fixes: [{ from: 'Marcus', to: 'Renji', shown: 'Renji came back from the gate before noon', why: 'The pages have Renji come back from the gate, not Marcus.' }], detail: 'Rukia promised Jovan to keep the seal hidden from the captains; Rukia has grey eyes; The dragon ate the moon' } },
  { what: 'Rukia learned that Jovan carries the seal.', target: 'knowledge', mutations: [
    { type: 'knowledge.add', name: 'Rukia', fact: 'Jovan carries the seal of the Thirteenth' },
    { type: 'place.set', name: 'The gate' },
    { type: 'knowledge.add', name: 'Marcus', fact: 'Renji came back from the gate' },
    { type: 'knowledge.add', name: 'Jovan', fact: 'Rukia promised to keep the seal hidden' },
    { type: 'knowledge.add', name: 'Rukia', fact: 'The dragon ate the moon over the harbour' },
  ] },
  { what: 'Page 2 has Renji leave at dawn, but the story so far has him at the gate since the night before.', target: 'story', pages: true, page: 2, fix: 'Renji had been at the gate since the night before.',
    evidence: { page: 'he had left for the gate at dawn', prior: 'Renji has stood watch at the gate since the night before the story opens', why: 'The brief has Renji on watch at the gate all night; page 2 has him leave for it only at dawn.' } },
] });

test('M673-1 THE MARK IS ON THE RECORD LINE, AND GOES WHERE THE LINE GOES: how far the audit has read is counted from the lines; the next stretch is the oldest line not read to its end, six pages at most; a line that slides keeps its mark, a line let go takes it along, and lines squeezed into one hand theirs on', async () => {
  const pages = Array.from({ length: 60 }, (_, i) => page(i, 'p' + i));
  const mem = { nodes: [
    { id: 'a', span: [0, 5], text: 'a', level: 1, audited: 6 },
    { id: 'b', span: [6, 11], text: 'b', level: 1, audited: 2 },
    { id: 'c', span: [12, 17], text: 'c', level: 1 },
    { id: 'd', span: [18, 19], text: '', level: 1, empty: true },
    { id: 'm', span: [20, 31], text: 'two lines squeezed', level: 2 },
    { id: 'x', span: [-1, -1], text: '[Correction] it was Tuesday.', level: 1, correction: true, audited: 9 },
    { id: 'gone', span: [70, 75], text: 'a line over pages the story no longer has', level: 1,
      auditOpen: [{ issue: { target: 'record', what: 'an allegation about pages the story no longer has' }, why: 'Missing exact replacement text in record.fixes.', from: 70, to: 75 }] },
  ] };
  eq(auditedOf(mem.nodes[0]), 6); eq(auditedOf(mem.nodes[1]), 2); eq(auditedOf(mem.nodes[2]), 0);
  eq(auditedOf({ span: [0, 5], audited: 99 }), 6, 'never more than the line has pages');
  eq(auditedOf({ span: [0, 5], audited: 'x' }), 0); eq(auditedOf(mem.nodes[5]), 0, 'a correction covers no page and has no mark');
  /* M722/M723: the unresolved historical corrections are counted beside the reading's coverage, never in it (open; pending —
   * those still queued for their bounded recovery); the line past the story's end counts in neither */
  eq(JSON.stringify(auditProgress(mem, pages.length)), JSON.stringify({ done: 8, folded: 32, left: 24, open: 0, pending: 0, unresolved: [] }), 'eight of thirty-two folded pages read (the line past the story’s end is not counted)');
  let s = nextStretch(mem, pages);
  eq([s.from, s.to, s.line.id, s.lineWhole].join(), '8,11,b,false', 'the oldest line not read to its end, from where the reading stopped');
  mem.nodes[1].audited = 6;
  s = nextStretch(mem, pages);
  eq([s.from, s.to, s.line.id, s.lineWhole].join(), '12,17,c,true', 'then the next line, whole');
  mem.nodes[2].audited = 6;
  s = nextStretch(mem, pages);
  eq([s.from, s.to, s.line.id, s.lineWhole].join(), '18,19,d,true', 'a line the keeper left empty is read too');
  mem.nodes[3].audited = 2;
  s = nextStretch(mem, pages);
  eq([s.from, s.to, s.line.id, s.lineWhole].join(), '20,25,m,false', 'a squeezed line is read six pages at a time');
  eq(s.to - s.from + 1, STRETCH_PAGES);
  mem.nodes[4].audited = 6;
  s = nextStretch(mem, pages);
  eq([s.from, s.to, s.lineWhole].join(), '26,31,false', 'and on from where it stopped');
  mem.nodes[4].audited = 12;
  eq(nextStretch(mem, pages), null, 'every line read: nothing is due');
  eq(auditProgress(mem, pages.length).left, 0);
  /* very long pages are read fewer at a time */
  const long = pages.map((p, i) => (i >= 12 && i <= 17 ? { ...p, text: 'x'.repeat(15000) } : p));
  mem.nodes[2].audited = 0;
  s = nextStretch(mem, long);
  eq([s.from, s.to, s.lineWhole].join(), '12,13,false', 'two pages of 15,000 characters fill a reading');
  /* an older page deleted: the lines after it slide and keep their marks; the line over it is let go, mark and all */
  mem.nodes[2].audited = 6;
  const slid = memoryAfterDeletion(mem, 7);
  assert(!slid.nodes.some((n) => n.id === 'b'), 'the line over the deleted page is let go');
  const c = slid.nodes.find((n) => n.id === 'c');
  eq(c.span.join(), '11,16'); eq(auditedOf(c), 6, 'the line that slid is still read');
  eq(auditProgress(slid, 59).left, 0, 'and nothing reads as unread but what has no line');
  eq(auditedOf(memoryTruncatedAt(mem, 12).nodes.find((n) => n.id === 'a')), 6, 'a retry keeps the marks of the lines before it');
  assert(!memoryWithoutPage(mem, 3).nodes.some((n) => n.id === 'a'), 'an edited page’s line goes, and the line written in its place is unread');
  /* squeezed: the mark is handed on as far as the reading had got without a gap */
  eq(auditedAcross([{ span: [0, 5], audited: 6 }, { span: [6, 11], audited: 6 }]), 12);
  eq(auditedAcross([{ span: [6, 11], audited: 6 }, { span: [0, 5], audited: 6 }]), 12, 'in page order, however they are handed over');
  eq(auditedAcross([{ span: [0, 5], audited: 6 }, { span: [6, 7], empty: true, audited: 2 }, { span: [8, 13], audited: 3 }]), 11);
  eq(auditedAcross([{ span: [0, 5], audited: 4 }, { span: [6, 11], audited: 6 }]), 4, 'nothing past a line not read to its end');
  eq(auditedAcross([{ span: [0, 5] }, { span: [6, 11], audited: 6 }]), 0);
  eq(auditedAcross([{ span: [0, 5], audited: 6 }, { span: [8, 11], audited: 4 }]), 6, 'nor past a page no line covers');
  eq(storyPageAt(pages, 5), 2, 'the third storyteller page'); eq(storyPageAt(pages, 0), -1, 'before any');
});

test('M673-2 THE KEEPER’S OWN WORK KEEPS THE MARK TRUE: lines squeezed into one hand their mark to the line they become; a line folded again is a new line and is read in its turn; a line’s detail asked for again leaves the mark alone', async () => {
  const kept = { w: await db.settings.get('memoryWindow'), b: await db.settings.get('memoryBatch'), s: await db.settings.get('memorySqueeze') };
  await db.settings.set('memoryWindow', 10); await db.settings.set('memoryBatch', 6); await db.settings.set('memorySqueeze', 3);
  const st = await db.stories.create({ title: 'the mark and the keeper ' + Math.random() });
  for (let i = 0; i < 34; i += 1) await db.messages.append(st.id, page(i, i % 2 ? 'Rukia swept the yard and Renji mended the gate. Page ' + i + '.' : 'I wait. ' + i));
  await saveState(st.id, ledgerOf());
  const line = (id, a, extra = {}) => ({ id, span: [a, a + 5], text: 'Rukia swept the yard; Renji mended the gate; pages ' + a + ' on.', level: 1, at: a + 1, whole: true, ...extra });
  await saveMemory(st.id, { window: 10, nodes: [line('a', 0, { audited: 6 }), line('b', 6, { audited: 6 }), line('c', 12, { audited: 6 }), line('d', 18, { audited: 2 })] });
  try {
    await withFetch(async (url, opts) => { const { user } = bodyOf(opts); return say(/NONE, or one DETAIL/.test(user) ? 'NONE' : 'Rukia swept the yard through the morning; Renji mended the gate; the yard stayed quiet; nothing else moved.'); }, async () => {
      await maybeSummarize({ connection: { ...CONN }, storyId: st.id, stale: () => false, renew: () => true });
      let mem = await loadMemory(st.id);
      const merged = mem.nodes.find((n) => n.level === 2);
      assert(merged && merged.span.join() === '0,11', 'the two oldest lines were squeezed into one: ' + JSON.stringify(mem.nodes.map((n) => [n.id, n.level, n.span])));
      eq(auditedOf(merged), 12, 'and what was read under them is read under it');
      eq(auditProgress(mem, 34).left, 4, 'so only the four pages never read are left');
      /* a line folded again */
      const r = await redoLine({ connection: { ...CONN }, storyId: st.id, nodeId: 'c' });
      eq(r.ok, true);
      mem = await loadMemory(st.id);
      eq(auditedOf(mem.nodes.find((n) => n.id === 'c')), 0, 'a line folded again is read again');
      /* only its detail asked for again */
      const d = mem.nodes.find((n) => n.id === 'd'); d.audited = 6; await saveMemory(st.id, mem);
      await redoLine({ connection: { ...CONN }, storyId: st.id, nodeId: 'd', detailOnly: true });
      eq(auditedOf((await loadMemory(st.id)).nodes.find((n) => n.id === 'd')), 6, 'the detail asked for again leaves the mark alone');
    });
  } finally { for (const [k, v] of [['memoryWindow', kept.w], ['memoryBatch', kept.b], ['memorySqueeze', kept.s]]) { if (v === undefined) await db.settings.delete(k); else await db.settings.set(k, v); } }
});

test('M673-3 WHAT IT IS ASKED: the brief, the record BEFORE the pages (never after), the pages with their numbers and whose they are, the record line with its detail, and what the ledger holds of what the people these pages name have learned — never the main character’s, never anyone the pages do not name, never where anyone is; it shrinks to fit a small room', async () => {
  const pages = [...SIX.map((t, i) => page(i, t)), ...Array.from({ length: 12 }, (_, i) => page(i + 6, 'Later, Rukia swept the yard. ' + i))];
  let state = ledgerOf();
  state = applyMutations(state, [
    { type: 'knowledge.add', name: 'Rukia', fact: 'Jovan is the heir of the Wells house' },
    { type: 'knowledge.add', name: 'Renji', fact: 'the gate is watched at night' },
    { type: 'knowledge.add', name: 'Jovan', fact: 'his own secret that nobody is shown' },
    { type: 'people.set', name: 'Byakuya', field: 'core', text: 'a captain nobody on these pages names' },
    { type: 'knowledge.add', name: 'Byakuya', fact: 'the council meets on Friday' },
    { type: 'canon.lock', name: 'Rukia', key: 'hair', value: 'black, cut short' },
    { type: 'offscreen.set', name: 'Renji', location: 'the far harbour', activity: 'asleep' },
  ]).state;
  const mem = { nodes: [
    { id: 'z', span: [-1, -1], text: '[Correction] The seal is silver, not gold.', level: 1, correction: true },
    { id: 'a', span: [0, 5], text: LINE_A, detail: 'Rukia stared at the seal', level: 1 },
    { id: 'b', span: [6, 11], text: 'What came AFTER these pages, which this reader must not be shown.', level: 1 },
    { id: 'e', span: [12, 17], text: '', level: 1, empty: true },
  ] };
  const built = buildStretchMessages({ state, brief: 'A story of the Thirteenth Division. Jovan is sixteen.', castNotes: 'Rukia: blunt, loyal.', mem, pages, stretch: nextStretch(mem, pages), room: 200000 });
  assert(/continuity editor/.test(built.system) && /Answer with JSON ONLY/.test(built.system) && /The main character is Jovan\./.test(built.system), 'the law, and whose story it is');
  assert(/knowledge\.add/.test(built.system) && !/canon\.lock|presence\.|place\.set|offscreen/.test(built.system), 'one thing only may be written to the ledger');
  assert(/Jovan is sixteen/.test(built.user) && /Rukia: blunt, loyal/.test(built.user), 'the brief and the cast notes');
  assert(/\[p1\] PLAYER: I show Rukia the seal\./.test(built.user) && /\[p2\] STORY: \[Thirteenth Division barracks/.test(built.user) && /\[p6\] STORY: Renji came back/.test(built.user), 'the pages, numbered, each said whose it is');
  assert(built.user.includes(LINE_A) && /Detail worth keeping: Rukia stared at the seal/.test(built.user), 'the record line with its detail');
  assert(/\[Correction\] The seal is silver/.test(built.user), 'a correction is part of the story so far');
  assert(!/What came AFTER these pages/.test(built.user), 'never the record after these pages');
  assert(/these are the story’s first pages|\[Correction\]/.test(built.user));
  const ledger = built.user.slice(built.user.indexOf('WHAT THE LEDGER HOLDS TODAY'));
  assert(/Rukia\n {2}knows: Jovan is the heir of the Wells house/.test(ledger) && /Renji\n {2}knows: the gate is watched at night/.test(ledger), 'what the people these pages name have learned: ' + ledger.slice(0, 400));
  assert(!/his own secret/.test(ledger) && !/Byakuya|council meets/.test(ledger), 'never the main character’s, never someone these pages do not name');
  assert(!/black, cut short|far harbour|asleep/.test(built.user), 'never how anyone looks today or where anyone is today');
  eq([built.from, built.to, built.lineWhole, built.lineEmpty, built.lineId].join(), '0,5,true,false,a');
  /* a line the keeper left empty says so, and asks for what lasts */
  mem.nodes[1].audited = 6; mem.nodes[2].audited = 6;
  const empty = buildStretchMessages({ state, brief: '', mem, pages, stretch: nextStretch(mem, pages), room: 200000 });
  assert(/THE RECORD LINE: there is none for these pages\./.test(empty.user) && /nothing new happened in these pages -- if something lasting did, give it as "detail"/.test(empty.user) && empty.lineEmpty === true, 'an empty line is said to be empty');
  assert(empty.user.includes('What came AFTER these pages'), 'and the line before these pages is now the story so far');
  /* a small room: the reading shrinks, never below one page */
  mem.nodes[1].audited = 0;
  const big = pages.map((p, i) => (i < 6 ? { ...p, text: p.text + ' ' + 'word '.repeat(1500) } : p));
  const small = buildStretchMessages({ state, brief: 'B'.repeat(4000), mem, pages: big, stretch: nextStretch(mem, big), room: 16000 });
  assert(small.to < 5 && small.to >= 0 && small.lineWhole === false, 'fewer pages in a small room, and the line is then not judged whole: ' + small.to);
  assert(small.system.length + small.user.length <= 16000 * 0.9 || small.to === 0, 'it fits');
  /* the ledger's part alone */
  eq(ledgerForPages(state, 'Nobody the ledger keeps is here.'), '', 'nobody named: nothing shown');
});

test('M673-4 WHAT IT MAY DO IS DECIDED IN CODE: a fact is written only for someone the ledger keeps (never the main character), who is named on these pages, in words these pages hold, that the person does not already know in other words — and never into a full list something older than all of it; nothing but what someone learned; a record fix only when the whole line was read; a page fault only for a page of the stretch', () => {
  const pagesText = SIX.join('\n\n');
  const state = applyMutations(ledgerOf(), [{ type: 'knowledge.add', name: 'Rukia', fact: 'Jovan carries the seal of the Thirteenth Division' }]).state;
  /* the tale's pages and the brief a story fault is held to (M722: a page fault stands only with the page's own wrong words
   * and the brief's, quoted) */
  const pagesOf = [...SIX, ...Array.from({ length: 38 }, (_, k) => ((k + 6) % 2 ? 'The yard was quiet that hour, and Rukia swept it. Page ' + (k + 6) + '.' : 'I wait. ' + (k + 6)))].map((t, i) => page(i, t));
  const priorText = 'Rukia has violet eyes. Rukia never sweeps the yard herself. ' + BRIEF;
  const read = parseStretchAnswer('Here it is:\n```json\n' + JSON.stringify({ issues: [
    { what: 'a', target: 'knowledge', mutations: [
      /* M737: what someone knows is held by its exact statement — the same statement, however it is cased or ended, is known */
      { type: 'knowledge.add', name: 'Rukia', fact: 'jovan carries the seal of the Thirteenth Division.' },
      { type: 'knowledge.add', name: 'Renji', fact: 'Jovan and Rukia were together in the yard before noon' },
      { type: 'knowledge.add', name: 'Renji', fact: 'Jovan and Rukia were together in the yard  before noon.' },
      { type: 'knowledge.add', name: 'OTHER NAME', fact: 'Renji came back from the gate' },
      { type: 'knowledge.add', name: 'Byakuya', fact: 'Renji came back from the gate' },
      { type: 'knowledge.add', name: 'Jovan', fact: 'Rukia promised to keep the seal hidden' },
      { type: 'knowledge.add', name: 'Renji', fact: 'the fleet sailed for the northern islands' },
      { type: 'knowledge.add', name: 'Renji', fact: '' },
      { type: 'canon.lock', name: 'Rukia', key: 'eyes', value: 'grey' },
      { type: 'presence.leave', name: 'Renji' },
      { type: 'rel.shift', name: 'Rukia', axis: 'trust', by: 5 },
    ] },
    { what: 'b', record: 'Rukia promised Jovan to keep the seal hidden; the pages\' own words; NAME learned it' },
    { what: 'c', target: 'record', record: { fixes: [{ from: 'Marcus', to: 'Renji', shown: 'Renji came back from the gate before noon', why: 'The pages have Renji come back, not Marcus.' }, { from: 'the line\'s own wrong words', to: 'Renji' }, { from: 'same', to: 'same' }] } },
    { what: 'd', target: 'story', pages: 'yes', page: 'p4', fix: 'Her eyes are violet, as the brief says.', evidence: { page: 'Her grey eyes did not leave his.', prior: 'Rukia has violet eyes', why: 'The brief gives Rukia violet eyes; page 4 calls them grey.' } },
    { what: 'e', target: 'story', pages: true, page: 40, fix: 'A fault that names a page outside the stretch.', evidence: { page: 'Rukia swept it. Page 39', prior: 'Rukia never sweeps the yard herself', why: 'The brief says she never sweeps it.' } },
    { what: 'f', target: 'story', pages: true, page: 2, fix: 'A third fault.', evidence: { page: 'he had left for the gate at dawn', prior: 'Renji has stood watch at the gate since the night before the story opens', why: 'The brief has him at the gate all night.' } },
    { what: 'g says something stands', pages: false },
  ] }) + '\n```');
  eq(read.note, 'ok'); eq(read.issues.length, 6, 'an issue that asks for nothing is not an issue');
  eq(read.issues[3].page, 4, '"p4" is page 4'); eq(read.issues[3].pages, true, '"yes" is yes');
  const s = scopeStretch(read.issues, { state, pagesText, from: 0, to: 5, lineWhole: true, turn: 3, pages: pagesOf, priorText });
  eq(JSON.stringify(s.mutations), JSON.stringify([{ type: 'knowledge.add', name: 'Renji', fact: 'Jovan and Rukia were together in the yard before noon' }]), 'one fact stands: ' + JSON.stringify(s.mutations));
  eq(JSON.stringify(s.unresolved), '[]', 'and nothing is left as an unresolved correction: each claim went through its own door — the issue that asked for nothing least of all (M723 made it one, with a recovery call of its own)');
  const why = s.refused.map((r) => r.why).join(' | ');
  assert(/Rukia already knows that/.test(why), 'known, as the same statement: ' + why);
  assert(/Renji already knows that/.test(why), 'said twice in one answer');
  /* M737: a statement in OTHER words is another statement to the ledger (exact statements, dates, conditions and certainty
   * stay distinct) — what keeps the reader from writing a thing already listed in other words is its own instruction,
   * over the list it is shown of what that person knows: both in what the reader is actually sent */
  eq(scopeStretch([{ target: 'knowledge', mutations: [{ type: 'knowledge.add', name: 'Rukia', fact: 'Jovan carries the seal of the Thirteenth' }] }], { state, pagesText, from: 0, to: 5, turn: 3 }).mutations.length, 1, 'other words are another statement to the code');
  const lineA = { id: 'a', span: [0, 5], text: LINE_A, level: 1 };
  const sent = buildStretchMessages({ state, brief: BRIEF, mem: { nodes: [lineA] }, pages: pagesOf, stretch: nextStretch({ nodes: [lineA] }, pagesOf) });
  assert(/ONLY WHAT IS MISSING: a thing listed in other words is ALREADY\s+there -- never write it again\./.test(sent.system), 'the reader is told a thing listed in other words is already there');
  assert(/Rukia\n {2}knows: Jovan carries the seal of the Thirteenth Division/.test(sent.user), 'and is shown what she knows: ' + sent.user.slice(sent.user.indexOf('WHAT THE LEDGER HOLDS TODAY'), sent.user.indexOf('WHAT THE LEDGER HOLDS TODAY') + 260));
  assert(/keeps no page for OTHER NAME|keeps no page for that name/.test(why) && /keeps no page for Byakuya/.test(why), 'nobody the ledger does not keep, and never a placeholder');
  assert(/nothing is written for the main character/.test(why) && /these pages do not say that/.test(why) && /did not say what Renji learned/.test(why), why);
  assert(/“canon\.lock” is not the continuous audit’s to write/.test(why) && /“presence\.leave” is not/.test(why) && /“rel\.shift” is not/.test(why), 'nothing but what someone learned: ' + why);
  /* M722: a record fix carries the passage that supports it, why, and whether it replaces or removes; and the allegation it
   * answers (what), so one that cannot land is kept as an unresolved correction in its own words */
  eq(JSON.stringify(s.record.fixes), JSON.stringify([{ from: 'Marcus', to: 'Renji', shown: 'Renji came back from the gate before noon', why: 'The pages have Renji come back, not Marcus.', operation: 'replace', what: 'c' }]), 'the prompt’s own example words are never a fix');
  eq(s.record.detail, 'Rukia promised Jovan to keep the seal hidden', 'a detail is kept clause by clause, each one the pages hold; a placeholder or an echo is not one');
  eq(s.pageFixes.length, PAGE_FIXES, 'two page faults a reading, at most');
  eq(s.pageFixes[0].page, 4); eq(s.pageFixes[1].page, null, 'a page outside the stretch is no page');
  /* the line read in part: what it is missing may be said, what it says may not be judged — the fix is not made; it is kept
   * as an unresolved correction, for its focused review over the whole line (M722/M723) */
  const part = scopeStretch(read.issues, { state, pagesText, from: 0, to: 5, lineWhole: false, turn: 3, pages: pagesOf, priorText });
  eq(part.record.fixes.length, 0); eq(part.record.detail, 'Rukia promised Jovan to keep the seal hidden');
  eq(JSON.stringify(part.unresolved.map((u) => [u.issue.what, u.why])), JSON.stringify([['c', 'Insufficient context: this reading did not cover the complete record source section.']]), 'the fix of a line read in part waits for the whole line');
  /* a line the keeper left EMPTY has no words a fix could correct: a fix said of it is neither made nor kept as a correction
   * still owed (it was: "did not cover the complete record source section", for a line read whole) — what lasts is its line */
  const empty = scopeStretch(read.issues, { state, pagesText, from: 0, to: 5, lineWhole: false, lineEmpty: true, turn: 3, pages: pagesOf, priorText });
  eq(JSON.stringify([empty.record.fixes.length, empty.unresolved.length, empty.record.detail]), JSON.stringify([0, 0, 'Rukia promised Jovan to keep the seal hidden']), 'an empty line is given what lasts, and no correction is owed on it');
  /* these pages do not name him */
  eq(scopeStretch([{ mutations: [{ type: 'knowledge.add', name: 'Renji', fact: 'Rukia swept the yard' }] }], { state, pagesText: 'Rukia swept the yard.', from: 0, to: 0 }).mutations.length, 0);
  /* a full list: something older than everything in it would only push a newer thing out */
  let full = state;
  for (let i = 0; i < KNOWLEDGE_GUARD; i += 1) full = applyMutations({ ...full, page: 100 + i }, [{ type: 'knowledge.add', name: 'Renji', fact: 'on watch number ' + (i + 1) + ' the lamp at post ' + (i * 7 + 3) + ' was lit by hand' }]).state;
  eq(full.knowledge.Renji.length, KNOWLEDGE_GUARD);
  const one = [{ mutations: [{ type: 'knowledge.add', name: 'Renji', fact: 'Jovan and Rukia were together in the yard before noon' }] }];
  const old = scopeStretch(one, { state: full, pagesText, from: 0, to: 5, turn: 3 });
  eq(old.mutations.length, 0); assert(/full of newer things/.test(old.refused[0].why), old.refused[0].why);
  eq(scopeStretch(one, { state: full, pagesText, from: 0, to: 5, turn: 150 }).mutations.length, 1, 'something as new as what the list holds is written');
  /* how many */
  const many = [{ mutations: Array.from({ length: 7 }, (_, i) => ({ type: 'knowledge.add', name: 'Renji', fact: ['Jovan drew the seal from his coat', 'Rukia stared at the seal', 'Rukia promised to keep the seal hidden from the captains', 'Renji came back from the gate before noon', 'Rukia has grey eyes', 'Jovan and Rukia were found in the yard', 'he had left for the gate at dawn'][i] })) }];
  eq(scopeStretch(many, { state: ledgerOf(), pagesText, from: 0, to: 5, turn: 3 }).mutations.length, LEDGER_ADDS, 'four things a reading, at most');
  /* the pages must say it */
  eq(pagesSay('Rukia promised to keep the seal hidden', pagesText.toLowerCase()), true);
  eq(pagesSay('the dragon ate the moon', pagesText.toLowerCase()), false);
  eq(pagesSay('it is so', pagesText.toLowerCase()), false, 'words that carry nothing prove nothing');
  /* an answer that is not the shape asked for */
  eq(parseStretchAnswer('{"mutations":[],"findings":[]}').note, 'unusable');
  eq(parseStretchAnswer('I cannot help with that.').note, 'unusable');
  eq(parseStretchAnswer('<think>hm {"issues":[{"what":"x","fix":"y","pages":true}]}</think>{"issues":[]}').issues.length, 0, 'the thinking is not the answer');
});

test('M673-5 ONE READING, END TO END: the record line is put right where its wrong words stand and the pages’ own words exist; what lasts and was left out is kept beneath it; what someone learned is written to the ledger, dated with the pages it was learned on and journaled there (a ledger set back to a later page keeps it, to an earlier one does not); a page fault the mender leaves is noted on that page; the line is marked read, and is not read twice', async () => {
  const st = await tale('one reading');
  const calls = [];
  const notes = [];
  const mends = [];
  await withFetch(async (url, opts) => { const b = bodyOf(opts); calls.push(b); return say(/pages 1-6 of the story/.test(b.user) ? ANSWER : '{"issues":[]}'); }, async () => {
    const r = await auditStretch({ connection: { ...CONN }, storyId: st.id, brief: BRIEF, stale: () => false, renew: () => true,
      mend: async (id, words) => { mends.push({ id, words }); return []; }, note: async (id, finding) => { notes.push({ id, finding }); } });
    eq(calls.length, 1, 'one call');
    eq(r.open, 0, 'and nothing it found is left as an unresolved correction (each finding went through its own door)');
    assert(/continuity editor/.test(calls[0].system) && calls[0].user.includes(LINE_A) && /\[p4\] STORY: Rukia promised Jovan/.test(calls[0].user), 'the reader was sent the pages and the line');
    eq([r.ok, r.from, r.to, r.sealed, r.passedBy, r.mendedPages].join(), 'true,0,5,true,false,0');
    const mem = await loadMemory(st.id);
    const a = mem.nodes.find((n) => n.id === 'a');
    eq(a.text, 'Jovan showed Rukia the seal of the Thirteenth; Renji came back from the gate before noon.', 'the wrong name is put right in the line');
    eq(a.detail, 'Rukia promised Jovan to keep the seal hidden from the captains; Rukia has grey eyes', 'what lasts is kept beneath it — and what the pages do not say is not');
    eq(auditedOf(a), 6, 'the line is marked read');
    eq(JSON.stringify([r.done, r.folded, r.left]), '[6,12,6]');
    const led = await loadState(st.id);
    eq(JSON.stringify(led.knowledge.Rukia.map((k) => [k.fact, k.atTurn])), JSON.stringify([['Jovan carries the seal of the Thirteenth', 3]]), 'what she learned, dated with the pages she learned it on');
    eq(led.page, 19, 'the ledger’s own page is where it was');
    const entry = led.journal.find((e) => e.m.type === 'knowledge.add');
    eq(entry.p, 2, 'journaled at the storyteller page those pages end on');
    assert(!led.knowledge.Jovan && !led.knowledge.Marcus && (led.place || {}).name !== 'The gate', 'nothing for the main character, a stranger, or the scene');
    eq(r.applied.length, 1); eq(r.refused.length, 4, JSON.stringify(r.refused.map((x) => x.why)));
    assert(led.log.some((l) => /Rukia now knows: Jovan carries the seal of the Thirteenth/.test(l.words)), 'and it is in the ledger’s own log, with its take-back');
    /* the page fault: the mender was asked for that one page, left it, and the fault is noted on it */
    const all = await db.messages.list(st.id);
    eq(mends.length, 1); eq(mends[0].id, all[1].id, 'page 2 is the second page');
    assert(/It should read: Renji had been at the gate since the night before\./.test(mends[0].words));
    eq(notes.length, 1); eq(notes[0].id, all[1].id);
    assert(/^The continuous audit: /.test(notes[0].finding.words) && notes[0].finding.severity === 'warn', JSON.stringify(notes[0].finding));
    const words = stretchWords(r);
    assert(/read pages 1–6 against the story before, the record line and the ledger: set 3 things right/.test(words) && /Rukia now knows: Jovan carries the seal/.test(words) && /the record line put right in 1 place/.test(words) && /kept beneath the record line/.test(words) && /1 page fault noted, not mended/.test(words) && /4 not written/.test(words) && /6 of 12 folded pages read$/.test(words), words);
    /* a ledger set back keeps what was learned on pages it still has */
    const later = foldJournal(led, [], 10, applyMutations);
    assert((later.knowledge.Rukia || []).some((k) => /carries the seal/.test(k.fact)), 'a ledger set back to page 11 still holds it');
    const earlier = foldJournal(led, [], 1, applyMutations);
    assert(!(earlier.knowledge.Rukia || []).some((k) => /carries the seal/.test(k.fact)), 'a ledger set back to before those pages does not');
    /* the next reading is the next line; then nothing is due and nobody is asked */
    const r2 = await auditStretch({ connection: { ...CONN }, storyId: st.id, stale: () => false, renew: () => true });
    eq([r2.from, r2.to, r2.sealed, r2.left].join(), '6,11,true,0');
    assert(/nothing to set right — 12 of 12 folded pages read$/.test(stretchWords(r2)), stretchWords(r2));
    assert(/Jovan showed Rukia the seal of the Thirteenth; Renji came back/.test(calls[1].user) && /Detail worth keeping: Rukia promised Jovan/.test(calls[1].user), 'and it is handed the line before it, as it now stands, as the story so far');
    eq(await auditStretch({ connection: { ...CONN }, storyId: st.id, stale: () => false }), null);
    eq(calls.length, 2, 'a tale read to its end costs nothing more');
  });
});

test('M673-6 A PAGE THAT CANNOT BE TRUE IS MENDED BY THE HOUSE’S OWN MENDER, ONCE: a reading that mends a page writes nothing else — the mend lets the record line go, and the line the keeper writes from the mended words is read in its turn; a page already mended, or one whose words he put back, is never mended again (the fault is noted on it)', async () => {
  const st = await tale('a page mended');
  const all0 = await db.messages.list(st.id);
  let mendCalls = 0;
  const mend = async (id, words) => {
    mendCalls += 1;
    const pg = (await db.messages.list(st.id)).find((m) => m.id === id);
    await db.messages.update(st.id, id, { text: pg.text.replace('he had left for the gate at dawn', 'he had been at the gate since the night before'), mended: { before: pg.text, why: words, at: Date.now() } });
    const k = (await db.messages.list(st.id)).filter((m) => !m.hidden).findIndex((m) => m.id === id);
    await saveMemory(st.id, memoryWithoutPage(await loadMemory(st.id), k)); /* as the house's applyMend does */
    return [{ id }];
  };
  /* the brief holds a second thing page 2 cannot be true beside; the reading after the mend finds it, on the page as it now
   * stands (the reader quotes the page's own words: M722) */
  const brief = BRIEF + ' Jovan keeps the seal of the Thirteenth sewn into his boot.';
  const AGAIN = JSON.stringify({ issues: [...JSON.parse(ANSWER).issues.slice(0, 2),
    { what: 'Page 2 has Jovan draw the seal from his coat, though he keeps it sewn into his boot.', target: 'story', pages: true, page: 2, fix: 'Jovan drew the seal of the Thirteenth from his boot.',
      evidence: { page: 'Jovan drew the seal of the Thirteenth from his coat', prior: 'Jovan keeps the seal of the Thirteenth sewn into his boot', why: 'The brief has the seal sewn into his boot; page 2 has him draw it from his coat.' } }] });
  await withFetch(async (url, opts) => say(/pages 1-6 of the story/.test(bodyOf(opts).user) ? (mendCalls ? AGAIN : ANSWER) : '{"issues":[]}'), async () => {
    const r = await auditStretch({ connection: { ...CONN }, storyId: st.id, brief, stale: () => false, renew: () => true, mend, note: async () => { throw new Error('nothing is noted when the page was mended'); } });
    eq([r.ok, r.mendedPages, r.sealed, r.applied.length].join(), 'true,1,false,0');
    const mem = await loadMemory(st.id);
    assert(!mem.nodes.some((n) => n.id === 'a'), 'the line over the mended page was let go');
    eq((await loadState(st.id)).knowledge.Rukia, undefined, 'and nothing else was written by that reading');
    assert(/mended 1 page that could not be true beside the story before/.test(stretchWords(r)) && /the keeper folds the mended words/.test(stretchWords(r)), stretchWords(r));
    /* the keeper folds those pages again (here: by hand) — the new line is unread, and the page, already mended, is not mended twice */
    mem.nodes.push({ id: 'a2', span: [0, 5], text: LINE_A, level: 1, at: 9, whole: true });
    await saveMemory(st.id, mem);
    const notes = [];
    const r2 = await auditStretch({ connection: { ...CONN }, storyId: st.id, brief, stale: () => false, renew: () => true, mend, note: async (id, f) => { notes.push({ id, f }); } });
    eq(mendCalls, 1, 'a page already mended is never mended again');
    eq(notes.length, 1); eq(notes[0].id, all0[1].id, 'the fault is noted on it instead');
    eq([r2.sealed, r2.mendedPages, r2.applied.length, r2.lineMended].join(), 'true,0,1,1', 'and this time the reading goes through');
    eq(auditedOf((await loadMemory(st.id)).nodes.find((n) => n.id === 'a2')), 6);
  });
  /* the words he put back stay as he put them */
  const st2 = await tale('his words back');
  const pg = (await db.messages.list(st2.id))[1];
  await db.messages.update(st2.id, pg.id, { keptText: pg.text });
  let asked = 0;
  await withFetch(async () => say(ANSWER), async () => {
    const r = await auditStretch({ connection: { ...CONN }, storyId: st2.id, brief: BRIEF, stale: () => false, mend: async () => { asked += 1; return [{ id: pg.id }]; }, note: async () => {} });
    eq(asked, 0, 'the mender is not sent to a page whose words he put back');
    eq(r.sealed, true);
  });
});

test('M673-7 IT NEVER WRITES OVER ANOTHER HAND, AND NEVER GETS STUCK: while the keeper is at the record it neither reads nor writes; a line or a page that moved while it read leaves everything as it was, to be read again; a stop writes nothing; an answer that cannot be read is asked for again, and the third time the pages are passed by and said so; a line the keeper left empty is given what lasts of its pages', async () => {
  /* the keeper at work */
  const st = await tale('the keeper first');
  let calls = 0;
  await withFetch(async () => { calls += 1; return say(ANSWER); }, async () => {
    markWorkerRunning(st.id, 'keeper', true);
    try { eq(await auditStretch({ connection: { ...CONN }, storyId: st.id, stale: () => false }), null); } finally { markWorkerRunning(st.id, 'keeper', false); }
    eq(calls, 0, 'nothing is asked while the keeper is at the record');
  });
  /* the keeper begins while it reads */
  await withFetch(async () => { markWorkerRunning(st.id, 'keeper', true); return say(ANSWER); }, async () => {
    try { eq(await auditStretch({ connection: { ...CONN }, storyId: st.id, stale: () => false }), null); } finally { markWorkerRunning(st.id, 'keeper', false); }
    eq(auditedOf((await loadMemory(st.id)).nodes.find((n) => n.id === 'a')), 0); eq((await loadState(st.id)).knowledge.Rukia, undefined, 'and nothing is written');
  });
  /* the line's detail changed while it read (the keeper's own check landed) */
  await withFetch(async () => { const m = await loadMemory(st.id); m.nodes.find((n) => n.id === 'a').detail = 'Rukia stared at the seal'; await saveMemory(st.id, m); return say(ANSWER); }, async () => {
    eq(await auditStretch({ connection: { ...CONN }, storyId: st.id, stale: () => false }), null);
    const a = (await loadMemory(st.id)).nodes.find((n) => n.id === 'a');
    eq(a.text, LINE_A); eq(a.detail, 'Rukia stared at the seal'); eq(auditedOf(a), 0, 'the line is as the other hand left it, unread');
    eq((await loadState(st.id)).knowledge.Rukia, undefined);
  });
  /* a page edited while it read */
  await withFetch(async () => { const pg = (await db.messages.list(st.id))[3]; await db.messages.update(st.id, pg.id, { text: pg.text + ' She meant it.' }); return say(ANSWER); }, async () => {
    eq(await auditStretch({ connection: { ...CONN }, storyId: st.id, stale: () => false }), null);
    eq(auditedOf((await loadMemory(st.id)).nodes.find((n) => n.id === 'a')), 0); eq((await loadState(st.id)).knowledge.Rukia, undefined);
  });
  /* a rewind under it */
  let gone = false;
  await withFetch(async () => { gone = true; return say(ANSWER); }, async () => {
    eq(await auditStretch({ connection: { ...CONN }, storyId: st.id, stale: () => gone }), null);
    eq(auditedOf((await loadMemory(st.id)).nodes.find((n) => n.id === 'a')), 0); eq((await loadState(st.id)).knowledge.Rukia, undefined);
  });
  /* a stop */
  const stop = new AbortController();
  await withFetch(async (url, opts) => { stop.abort(); const e = new Error('aborted'); e.name = 'AbortError'; if (opts.signal && opts.signal.aborted) throw e; return say(ANSWER); }, async () => {
    let threw = null;
    try { await auditStretch({ connection: { ...CONN }, storyId: st.id, stale: () => false, signal: stop.signal }); } catch (err) { threw = err; }
    assert(threw, 'a stop ends the reading');
    eq(auditedOf((await loadMemory(st.id)).nodes.find((n) => n.id === 'a')), 0); eq((await loadState(st.id)).knowledge.Rukia, undefined, 'and it wrote nothing');
  });
  /* an answer that cannot be read */
  const st3 = await tale('an answer that cannot be read');
  let asked = 0;
  await withFetch(async () => { asked += 1; return say('I am sorry, I cannot do that.'); }, async () => {
    for (let i = 1; i < UNREADABLE_TRIES; i += 1) {
      let threw = null;
      try { await auditStretch({ connection: { ...CONN }, storyId: st3.id, stale: () => false }); } catch (err) { threw = err; }
      assert(threw && /could not be read/.test(threw.message) && /cannot do that/.test(threw.raw), 'asked again, and what it said is kept to be looked at');
      eq(auditedOf((await loadMemory(st3.id)).nodes.find((n) => n.id === 'a')), 0);
    }
    eq(asked, (UNREADABLE_TRIES - 1) * 2, 'each try asks twice: once, and once more saying what was wrong');
    const r = await auditStretch({ connection: { ...CONN }, storyId: st3.id, stale: () => false });
    eq([r.passedBy, r.sealed].join(), 'true,true');
    assert(/pages 1–6 could not be read .* and were passed by — 6 of 12 folded pages read$/.test(stretchWords(r)), stretchWords(r));
    const a = (await loadMemory(st3.id)).nodes.find((n) => n.id === 'a');
    eq(a.text, LINE_A, 'the line is untouched'); eq(auditedOf(a), 6, 'and the house moves on to the next line');
  });
  /* a line the keeper left empty */
  const st4 = await tale('an empty line', { lines: [{ id: 'e', span: [0, 5], text: '', level: 1, at: 1, empty: true, whole: true }, { id: 'h', span: [6, 6], text: '', level: 1, at: 2, empty: true, byHouse: true, whole: true }] });
  const lasting = JSON.stringify({ issues: [{ what: 'Something lasting happened here.', record: { fixes: [{ from: 'x', to: 'Renji' }], detail: 'Rukia promised Jovan to keep the seal hidden from the captains' } }] });
  let emptyCalls = 0;
  await withFetch(async (url, opts) => { emptyCalls += 1; return say(/pages 1-6 of the story/.test(bodyOf(opts).user) ? lasting : '{"issues":[]}'); }, async () => {
    const r = await auditStretch({ connection: { ...CONN }, storyId: st4.id, stale: () => false });
    eq([r.sealed, r.lineWritten].join(), 'true,true');
    /* a line with no words has nothing a fix could correct: the fix said of it is not kept as a correction still owed (it was
     * — "this reading did not cover the complete record source section" — and a recovery call was made for it at once) */
    eq([r.open, emptyCalls].join(), '0,1', 'no correction is owed on a line that had no words, and nothing more is asked');
    const e = (await loadMemory(st4.id)).nodes.find((n) => n.id === 'e');
    eq(e.text, 'Rukia promised Jovan to keep the seal hidden from the captains'); eq(e.empty, false); eq(auditedOf(e), 6);
    assert(/wrote the record line the keeper had left empty: Rukia promised Jovan/.test(stretchWords(r)), stretchWords(r));
    const r2 = await auditStretch({ connection: { ...CONN }, storyId: st4.id, stale: () => false });
    const h = (await loadMemory(st4.id)).nodes.find((n) => n.id === 'h');
    eq([r2.sealed, r2.lineWritten, h.empty, h.byHouse, auditedOf(h)].join(), 'true,false,true,true,1', 'a page with nothing lasting keeps its wordless cover, and is marked read');
  });
});

test('M673-7b HIS OWN WORDS ARE HIS, AND A FIX IS NEVER SWEPT WIDER THAN IT WAS MEANT: a record line he rewrote by hand, or that the housekeeper changed for him, is read and marked but never written over (what someone learned is still written); a line the keeper folds again is the keeper’s once more; a fix whose wrong words stand twice in the line is not applied, nor one that would swap a phrase for a fragment', async () => {
  eq(lineIsHis({ verified: { at: 1, fixed: 'the writer' } }), true); eq(lineIsHis({ verified: { at: 1, fixed: 'the housekeeper' } }), true);
  eq(lineIsHis({ verified: { at: 1, fixed: 'Jovan is sixteen, not seventeen' } }), false, 'the keeper’s own correction is not his hand'); eq(lineIsHis({}), false);
  /* M722/M723: the fix the reader proposed for his line stays VISIBLE as an unresolved correction ("Protected memory remains
   * unresolved"), and the same job gives it its one focused review — which may confirm the fault, never edit his words */
  const PROTECTED = JSON.stringify({ sourceFidelity: { status: 'contradicted', claim: 'Marcus', sameReferent: true, sameEvent: true, assertion: 'direct', relation: 'contradicts', preservesAssertion: false, why: 'The pages have Renji, not Marcus, come back from the gate before noon.', conflicts: [] },
    allegation: 'confirmed', blocker: 'protected', outcome: 'blocked', why: 'The line names Marcus where the pages have Renji; it is the writer’s own memory and is not edited.', evidence: [{ source: '6', shown: 'Renji came back from the gate before noon' }] });
  for (const by of ['the writer', 'the housekeeper']) {
    const st = await tale('his own words ' + by, { lines: [{ id: 'a', span: [0, 5], text: LINE_A, detail: 'Rukia stared at the seal', level: 1, at: 1, whole: true, verified: { at: 5, fixed: by } }] });
    await withFetch(async (url, opts) => say(/TARGETED HISTORICAL RECOVERY/.test(bodyOf(opts).user) ? PROTECTED : ANSWER), async () => {
      const r = await auditStretch({ connection: { ...CONN }, storyId: st.id, brief: BRIEF, stale: () => false, mend: async () => [], note: async () => {} });
      const a = (await loadMemory(st.id)).nodes.find((n) => n.id === 'a');
      eq(a.text, LINE_A, 'the line stands as ' + by + ' left it'); eq(a.detail, 'Rukia stared at the seal', 'and so does its detail');
      eq([r.sealed, r.lineLeft, r.lineMended, r.detailAdded, auditedOf(a)].join(), 'true,true,0,,6', 'read, marked, not written over');
      eq(((await loadState(st.id)).knowledge.Rukia || []).length, 1, 'what she learned is still written to the ledger');
      assert(/the record line is in your own words \(or the housekeeper’s for you\) — left as it is/.test(stretchWords(r)), stretchWords(r));
      eq([r.recovery, r.open, r.pending].join(), 'blocked,1,0', 'the fix for his line is kept as an open correction, reviewed once, and not asked for again');
      assert(/Rukia now knows: Jovan carries the seal/.test(stretchWords(r)) && /1 historical correction remains unresolved after automatic source review\. Protected writer-controlled memory cannot be overwritten\.$/.test(stretchWords(r)), 'the workers’ line says what the reading did, then what became of the correction: ' + stretchWords(r));
    });
  }
  /* folded again by the keeper: it is the keeper's line once more */
  const st2 = await tale('folded again', { lines: [{ id: 'a', span: [0, 5], text: LINE_A, level: 1, at: 1, whole: true, audited: 6, verified: { at: 5, fixed: 'the writer' } }] });
  await withFetch(async (url, opts) => say(/NONE, or one DETAIL/.test(bodyOf(opts).user) ? 'NONE' : LINE_A), async () => {
    const r = await redoLine({ connection: { ...CONN }, storyId: st2.id, nodeId: 'a' });
    eq(r.ok, true);
    const a = (await loadMemory(st2.id)).nodes.find((n) => n.id === 'a');
    eq(lineIsHis(a), false); eq(auditedOf(a), 0, 'and it is read in its turn');
  });
  /* the wrong words stand twice: nothing is swept */
  const twice = 'Marcus showed Rukia the seal; Marcus came back from the gate before noon.';
  const st3 = await tale('a name that stands twice', { lines: [{ id: 'a', span: [0, 5], text: twice, level: 1, at: 1, whole: true }] });
  const two = JSON.stringify({ issues: [{ what: 'Wrong names.', record: { fixes: [{ from: 'Marcus', to: 'Renji' }, { from: 'Marcus showed Rukia', to: 'Jovan' }, { from: 'ga', to: 'Renji' }, { from: 'Marcus came back', to: 'Renji came back' }] } }] });
  await withFetch(async () => say(two), async () => {
    const r = await auditStretch({ connection: { ...CONN }, storyId: st3.id, stale: () => false });
    const a = (await loadMemory(st3.id)).nodes.find((n) => n.id === 'a');
    eq(a.text, 'Marcus showed Rukia the seal; Renji came back from the gate before noon.', 'only the fix whose words stand once, whole for whole, is made — a name that stands twice is not swept, a phrase is not swapped for a fragment, two letters are not an anchor: ' + a.text);
    eq(r.lineMended, 1);
  });
});

test('M673-8 THE STORYTELLER COMES FIRST, AND THE SWITCH IS OFF UNLESS HE TURNS IT ON: a reading in flight is let go the moment anything waits for the workers; only this tale’s; a reading that has ended is not held', async () => {
  eq(await continuousAuditOn(), false, 'off as it ships');
  await db.settings.set('continuousAudit', true);
  try { eq(await continuousAuditOn(), true); } finally { await db.settings.delete('continuousAudit'); }
  const mine = beginReading('tale-one');
  const other = beginReading('tale-two');
  eq(pauseContinuousAudit('tale-three'), false, 'nothing in flight: nothing to let go');
  await pendingWork('tale-one', 10);
  eq(mine.signal.aborted, true, 'whoever waits for the workers lets the reading go first');
  eq(other.signal.aborted, false, 'another tale’s reading is not touched');
  endReading('tale-one', mine);
  eq(pauseContinuousAudit('tale-one'), false, 'a reading that has ended is not held');
  eq(pauseContinuousAudit('tale-two'), true); eq(other.signal.aborted, true);
  endReading('tale-two', other);
});

/* ---------- what M722's routing kept before its guards were put back (the audit of M722-M751): settled by the audit itself ---------- */
/* the recovery state M723 leaves on a finding after its two attempts — its input is the line, its pages and no fetched
 * originals (continuous.js recoveryInput), its writer the story's empty brief and cast. M752 (followup 9): spent under
 * today's reading of a verdict (verdictPolicy 2) — a "did not provide a usable correction verdict" from before it is
 * asked about again once, on purpose (m752-historical.mjs H5), and these laws are not about that */
const exhausted = (line, pages, reason) => ({
  input: fingerprint36(JSON.stringify([line.span, fingerprint36(JSON.stringify([line.text, line.detail, line.verified?.fixed, pages.slice(line.span[0], line.span[1] + 1).map((p) => [p.id, pageText(p)])])), []])),
  writer: fingerprint36(JSON.stringify(['', ''])), dispositionPolicy: 2, evidencePolicy: 2, verdictPolicy: 2, attempts: 2, status: 'blocked', reason, nextAt: 0, sources: [],
});
const UNCLASSIFIED = 'The fault needs grounded story versus record classification.';
const PARTIAL = 'Insufficient context: this reading did not cover the complete record source section.';

test('M673-9 WHAT WAS NEVER A CLAIM IS CLEARED BY THE AUDIT ITSELF — A PAGE OUT OF CHARACTER (the audit of M722-M751: before its guard, M722 kept a fault said of an out-of-character page as an unresolved historical correction; its two recovery attempts left it blocked — the lamp amber for good, its line unable to fold): the next look clears it with no call, keeps a receipt and says so on the workers’ line; not a word of the line is touched, nor a finding said of a page of the story, nor anything on a line in his own words; a second look has nothing to do', async () => {
  const P = [
    { role: 'user', text: 'I show Rukia the seal.' },
    { role: 'assistant', text: 'Jovan drew the seal of the Thirteenth from his coat. Rukia stared at it.' },
    { role: 'user', text: '((does Renji know about the seal?))', ooc: true },
    { role: 'assistant', text: 'No — Renji knows nothing of the seal yet.', ooc: true },
    { role: 'user', text: 'I ask her to keep it hidden.' },
    { role: 'assistant', text: 'Rukia promised Jovan she would keep the seal hidden from the captains.' },
  ];
  const make = async (title, his) => {
    const st = await db.stories.create({ title: title + ' ' + Math.random() });
    for (const pg of P) await db.messages.append(st.id, pg);
    for (let i = 6; i < 44; i += 1) await db.messages.append(st.id, page(i, i % 2 ? 'The yard was quiet that hour, and Rukia swept it. Page ' + i + '.' : 'I wait. ' + i));
    await saveState(st.id, ledgerOf());
    const pages = visiblePages(await db.messages.list(st.id));
    const a = { id: 'a', span: [0, 5], text: 'Jovan showed Rukia the seal of the Thirteenth.', level: 1, at: 1, whole: true, audited: 6, correctionReviewed: true, ...(his ? { verified: { at: 5, fixed: 'the writer' } } : {}) };
    const b = { id: 'b', span: [6, 11], text: 'Rukia swept the yard; nothing else moved.', level: 1, at: 2, whole: true, audited: 6, correctionReviewed: true };
    const said = (what, pageNo, fix) => ({ what, target: 'unknown', evidence: { page: '', prior: '', why: '' }, pages: true, page: pageNo, fix, record: null, mutations: [] });
    const used = 'The focused response did not provide a usable correction verdict.';
    a.auditOpen = [{ issue: said('Page 4 says Renji knows nothing, but the story has him told.', 4, 'Renji already knew of the seal by then.'), why: used, from: 0, to: 5, recovery: exhausted(a, pages, used) }];
    b.auditOpen = [{ issue: said('Page 8 may not agree with the brief.', 8, 'The yard was swept at dawn.'), why: used, from: 6, to: 11, recovery: exhausted(b, pages, used) }];
    await saveMemory(st.id, { window: 30, nodes: [a, b] });
    return st;
  };
  let calls = 0;
  const st = await make('said of an out-of-character page');
  await withFetch(async () => { calls += 1; return say('{"issues":[]}'); }, async () => {
    const before = await loadMemory(st.id);
    const r = await auditStretch({ connection: { ...CONN }, storyId: st.id, stale: () => false });
    eq(calls, 0, 'nothing is asked of any model');
    eq([r && r.recovery, ((r && r.cleared) || []).length, r && r.open].join(), 'cleared,1,1', 'the finding said of the out-of-character page is cleared; the one said of a page of the story stays');
    const after = await loadMemory(st.id);
    const a0 = before.nodes.find((n) => n.id === 'a'); const a1 = after.nodes.find((n) => n.id === 'a');
    eq(JSON.stringify([a1.text, a1.detail, a1.span, a1.audited, a1.verified]), JSON.stringify([a0.text, a0.detail, a0.span, a0.audited, a0.verified]), 'not a word of the line is touched');
    eq(a1.auditOpen.length, 0, 'its line holds no open correction (the keeper folds only lines that hold none)');
    const receipt = (a1.auditRecovery || []).find((x) => x.outcome === 'cleared');
    assert(receipt && receipt.finding.issue.page === 4 && /out-of-character page/.test(receipt.why), 'a receipt keeps what was cleared, and why: ' + JSON.stringify(receipt));
    eq(JSON.stringify(after.nodes.find((n) => n.id === 'b')), JSON.stringify(before.nodes.find((n) => n.id === 'b')), 'the finding said of a page of the story is as it was');
    assert(/Cleared 1 historical correction with nothing to correct: “Page 4 says Renji knows nothing, but the story has him told” — it was said of an out-of-character page\. 1 historical correction remains unresolved after automatic source review\./.test(stretchWords(r)), 'the workers’ line says what was cleared: ' + stretchWords(r));
    eq(auditProgress(after, 44, visiblePages(await db.messages.list(st.id))).open, 1, 'and the lamp counts only what is left');
    eq(await auditStretch({ connection: { ...CONN }, storyId: st.id, stale: () => false }), null, 'a second look has nothing to do');
    eq(JSON.stringify(await loadMemory(st.id)), JSON.stringify(after), 'and changes nothing');
  });
  /* a line in his own words: nothing on it is touched */
  const st2 = await make('said of an out-of-character page, on his line', true);
  await withFetch(async () => { calls += 1; return say('{"issues":[]}'); }, async () => {
    const before = JSON.stringify(await loadMemory(st2.id));
    eq(await auditStretch({ connection: { ...CONN }, storyId: st2.id, stale: () => false }), null, 'nothing is due');
    eq(JSON.stringify(await loadMemory(st2.id)), before, 'his line keeps all that is on it');
  });
  eq(calls, 0, 'and no model was asked anything');
});

test('M673-10 WHAT WAS NEVER A CLAIM IS CLEARED BY THE AUDIT ITSELF — A LINE WITH NO WORDS (the audit of M722-M751: before its guard, M722 kept a fix said of a line the keeper had left without words as an unresolved correction — "this reading did not cover the complete record source section", for a line read whole): a record correction on a line that has no words, or one kept with that reason for a whole line (only a line with no words was ever so read), is cleared at the next look with no call and said so; the correction of a line read in part stays, and so does everything on a line in his own words; not a word of any line is touched', async () => {
  const st = await db.stories.create({ title: 'no words ' + Math.random() });
  for (let i = 0; i < 6; i += 1) await db.messages.append(st.id, page(i, SIX[i]));
  for (let i = 6; i < 44; i += 1) await db.messages.append(st.id, page(i, i % 2 ? 'The yard was quiet that hour, and Rukia swept it. Page ' + i + '.' : 'I wait. ' + i));
  await saveState(st.id, ledgerOf());
  const pages = visiblePages(await db.messages.list(st.id));
  const fix = { what: 'Something lasting happened here.', target: 'record', evidence: { page: '', prior: '', why: '' }, pages: false, page: null, fix: '',
    record: { fixes: [{ from: 'x', to: 'Renji', shown: '', why: '', operation: 'replace' }], detail: 'Rukia promised Jovan to keep the seal hidden from the captains' }, mutations: [] };
  const e = { id: 'e', span: [0, 5], text: '', level: 1, at: 1, empty: true, whole: true, audited: 6, correctionReviewed: true };
  const w = { id: 'w', span: [6, 11], text: 'Rukia promised Jovan to keep the seal hidden from the captains', level: 1, at: 2, whole: true, audited: 6, correctionReviewed: true };
  const l = { id: 'l', span: [12, 23], text: 'Rukia swept the yard for days; nothing else moved.', level: 2, at: 3, audited: 12, correctionReviewed: true };
  const h = { id: 'h', span: [24, 29], text: 'Rukia swept the yard again, as he wrote it.', level: 1, at: 4, whole: true, audited: 6, correctionReviewed: true, verified: { at: 5, fixed: 'the writer' } };
  const mismatch = 'Exact record text mismatch: the proposed from span does not occur.';
  /* the line the keeper left without words (its reading wrote nothing lasting): the finding its two attempts left blocked */
  e.auditOpen = [{ issue: fix, why: mismatch, from: 0, to: 5, recovery: exhausted(e, pages, mismatch) }];
  /* a line its reading wrote from what lasted: the finding as that reading kept it, its review cut off before it ended */
  w.auditOpen = [{ issue: fix, why: PARTIAL, from: 6, to: 11, recovery: { ...exhausted(w, pages, PARTIAL), attempts: 1, status: 'running', nextAt: Date.now() + 60000 } }];
  /* a line read in part — a real correction waiting for the whole line — and his own line: both stay */
  l.auditOpen = [{ issue: { ...fix, what: 'The line has the wrong day.' }, why: PARTIAL, from: 12, to: 17, recovery: exhausted(l, pages, PARTIAL) }];
  h.auditOpen = [{ issue: fix, why: PARTIAL, from: 24, to: 29, recovery: exhausted(h, pages, PARTIAL) }];
  await saveMemory(st.id, { window: 30, nodes: [e, w, l, h] });
  let calls = 0;
  await withFetch(async () => { calls += 1; return say('{"issues":[]}'); }, async () => {
    const r1 = await auditStretch({ connection: { ...CONN }, storyId: st.id, stale: () => false });
    eq([r1 && r1.recovery, ((r1 && r1.cleared) || []).map((c) => c.why).join()].join(' | '), 'cleared | it is a correction for a record line with no words', 'the line left without words first (the oldest)');
    assert(/Cleared 1 historical correction with nothing to correct: “Something lasting happened here” — it is a correction for a record line with no words\./.test(stretchWords(r1)), 'said on the workers’ line: ' + stretchWords(r1));
    const r2 = await auditStretch({ connection: { ...CONN }, storyId: st.id, stale: () => false });
    eq([r2 && r2.recovery, ((r2 && r2.cleared) || []).map((c) => c.why).join()].join(' | '), 'cleared | it is a correction kept for a record line that had no words when it was read', 'then the line that had no words when it was read');
    eq(await auditStretch({ connection: { ...CONN }, storyId: st.id, stale: () => false }), null, 'then nothing is due');
    const mem = await loadMemory(st.id);
    eq(JSON.stringify(mem.nodes.map((n) => [n.id, (n.auditOpen || []).length])), JSON.stringify([['e', 0], ['w', 0], ['l', 1], ['h', 1]]), 'the part-read line keeps its correction, and his line all that is on it');
    eq(JSON.stringify(mem.nodes.map((n) => [n.text, n.detail, n.empty, n.verified, n.span, n.audited])), JSON.stringify([e, w, l, h].map((n) => [n.text, n.detail, n.empty === true, n.verified, n.span, n.audited])), 'not a word of any line is touched');
  });
  eq(calls, 0, 'and no model was asked anything');
});

test('M673-11 A BARE ISSUE KEPT AS AN UNRESOLVED CORRECTION BEFORE ITS PARSE WAS PUT RIGHT IS SETTLED BY ITS ONE BOUNDED REVIEW (the audit of M722-M751: M723 kept an untargeted issue that asked for nothing as an unresolved correction; the house cannot tell one saved so from a correction the reader deliberately left for review, so it is not cleared in code): a reader answering that nothing needs correcting settles it in ONE call and nothing is asked again; a reader whose answers cannot be used is asked twice, a minute apart, and never a third time — the review cannot loop', async () => {
  const bare = { what: 'Rukia stands as the pages tell her.', target: 'unknown', evidence: { page: '', prior: '', why: '' }, pages: false, page: null, fix: '', record: null, mutations: [] };
  const LINE = 'Jovan showed Rukia the seal of the Thirteenth; Rukia promised to keep it hidden.';
  const lines = () => [
    { id: 'a', span: [0, 5], text: LINE, level: 1, at: 1, whole: true, audited: 6, correctionReviewed: true, auditOpen: [{ issue: bare, why: UNCLASSIFIED, from: 0, to: 5 }] },
    { id: 'b', span: [6, 11], text: 'Rukia swept the yard; nothing else moved.', level: 1, at: 2, whole: true, audited: 6, correctionReviewed: true },
  ];
  /* "nothing needs correcting", in the verdict its focused review asks for */
  const NOTHING = JSON.stringify({ sourceFidelity: { status: 'supported', claim: 'Rukia promised to keep it hidden', sameReferent: true, sameEvent: true, assertion: 'direct', relation: 'supports', preservesAssertion: true,
    why: 'Page 4 has Rukia promise to keep the seal hidden; the record says just that.', conflicts: [] },
    allegation: 'disproved', outcome: 'correct', why: 'The record line says what the pages say; nothing needs correcting.', evidence: [{ source: '4', shown: 'Rukia promised Jovan she would keep the seal hidden from the captains.' }] });
  const st = await tale('a bare issue, settled', { lines: lines() });
  let calls = 0;
  await withFetch(async (url, opts) => { calls += 1; assert(/TARGETED HISTORICAL RECOVERY/.test(bodyOf(opts).user), 'only its focused review is asked'); return say(NOTHING); }, async () => {
    const r = await auditStretch({ connection: { ...CONN }, storyId: st.id, stale: () => false });
    eq([r.recovery, r.open, calls].join(), 'correct,0,1', 'one call settles it: nothing needed correcting');
    eq((await loadMemory(st.id)).nodes.find((n) => n.id === 'a').text, LINE, 'the record line is as it was');
    eq(await auditStretch({ connection: { ...CONN }, storyId: st.id, stale: () => false }), null, 'and nothing is asked again');
    eq(auditWaits(st.id, await loadMemory(st.id), visiblePages(await db.messages.list(st.id))), -1, 'nor waiting to be');
  });
  eq(calls, 1, 'one call in all');
  /* answers that cannot be used: two attempts, a minute apart — then blocked, and never a third. M752 (followup 9): within
   * each attempt an answer that is no verdict is said back to the reader, twice at most (CLARIFICATIONS) — three calls */
  const st2 = await tale('a bare issue, unusable answers', { lines: lines() });
  let asked = 0;
  const clock = Date.now; let now = clock(); Date.now = () => now;
  try {
    await withFetch(async () => { asked += 1; return say('{"issues":[]}'); }, async () => {
      const first = await auditStretch({ connection: { ...CONN }, storyId: st2.id, stale: () => false });
      eq([first.recovery, first.open, first.pending, asked].join(), 'blocked,1,1,3', 'its first review could not be used: its answer and two clarifications, the correction still queued');
      eq(await auditStretch({ connection: { ...CONN }, storyId: st2.id, stale: () => false }), null, 'looked at again at once: nothing is asked (it waits its minute)');
      now += RECOVERY_DELAY + 1;
      const second = await auditStretch({ connection: { ...CONN }, storyId: st2.id, stale: () => false });
      eq([second.open, second.pending, asked].join(), '1,0,6', 'its second and last review: two attempts in all, nothing more queued');
      now += RECOVERY_DELAY * 10;
      eq(await auditStretch({ connection: { ...CONN }, storyId: st2.id, stale: () => false }), null, 'and never a third');
      eq(auditWaits(st2.id, await loadMemory(st2.id), visiblePages(await db.messages.list(st2.id))), -1);
    });
  } finally { Date.now = clock; }
  eq(asked, 6, 'two attempts, and no more');
});
