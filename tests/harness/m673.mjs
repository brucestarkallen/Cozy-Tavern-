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
  loadMemory, saveMemory, auditedOf, auditedAcross, memoryAfterDeletion, memoryTruncatedAt, memoryWithoutPage, maybeSummarize, redoLine,
} from '../../js/agents/memory.js';
import {
  auditProgress, nextStretch, buildStretchMessages, parseStretchAnswer, scopeStretch, pagesSay, storyPageAt, auditStretch, stretchWords,
  ledgerForPages, lineIsHis, beginReading, endReading, pauseContinuousAudit, continuousAuditOn, STRETCH_PAGES, LEDGER_ADDS, PAGE_FIXES, UNREADABLE_TRIES,
} from '../../js/agents/continuous.js';
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
const ANSWER = JSON.stringify({ issues: [
  { what: 'The line names Marcus; the pages have Renji come back from the gate.', record: { fixes: [{ from: 'Marcus', to: 'Renji' }], detail: 'Rukia promised Jovan to keep the seal hidden from the captains; Rukia has grey eyes; The dragon ate the moon' } },
  { what: 'Rukia learned that Jovan carries the seal.', mutations: [
    { type: 'knowledge.add', name: 'Rukia', fact: 'Jovan carries the seal of the Thirteenth' },
    { type: 'place.set', name: 'The gate' },
    { type: 'knowledge.add', name: 'Marcus', fact: 'Renji came back from the gate' },
    { type: 'knowledge.add', name: 'Jovan', fact: 'Rukia promised to keep the seal hidden' },
    { type: 'knowledge.add', name: 'Rukia', fact: 'The dragon ate the moon over the harbour' },
  ] },
  { what: 'Page 2 has Renji leave at dawn, but the story so far has him at the gate since the night before.', pages: true, page: 2, fix: 'Renji had been at the gate since the night before.' },
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
    { id: 'gone', span: [70, 75], text: 'a line over pages the story no longer has', level: 1 },
  ] };
  eq(auditedOf(mem.nodes[0]), 6); eq(auditedOf(mem.nodes[1]), 2); eq(auditedOf(mem.nodes[2]), 0);
  eq(auditedOf({ span: [0, 5], audited: 99 }), 6, 'never more than the line has pages');
  eq(auditedOf({ span: [0, 5], audited: 'x' }), 0); eq(auditedOf(mem.nodes[5]), 0, 'a correction covers no page and has no mark');
  eq(JSON.stringify(auditProgress(mem, pages.length)), JSON.stringify({ done: 8, folded: 32, left: 24 }), 'eight of thirty-two folded pages read (the line past the story’s end is not counted)');
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
  const read = parseStretchAnswer('Here it is:\n```json\n' + JSON.stringify({ issues: [
    { what: 'a', mutations: [
      { type: 'knowledge.add', name: 'Rukia', fact: 'Jovan carries the seal of the Thirteenth' },
      { type: 'knowledge.add', name: 'Renji', fact: 'Jovan and Rukia were together in the yard before noon' },
      { type: 'knowledge.add', name: 'Renji', fact: 'Jovan was together with Rukia in the yard before noon' },
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
    { what: 'c', record: { fixes: [{ from: 'Marcus', to: 'Renji' }, { from: 'the line\'s own wrong words', to: 'Renji' }, { from: 'same', to: 'same' }] } },
    { what: 'd', pages: 'yes', page: 'p4', fix: 'Her eyes are violet, as the brief says.' },
    { what: 'e', pages: true, page: 40, fix: 'A fault that names a page outside the stretch.' },
    { what: 'f', pages: true, page: 2, fix: 'A third fault.' },
    { what: 'g says something stands', pages: false },
  ] }) + '\n```');
  eq(read.note, 'ok'); eq(read.issues.length, 6, 'an issue that asks for nothing is not an issue');
  eq(read.issues[3].page, 4, '"p4" is page 4'); eq(read.issues[3].pages, true, '"yes" is yes');
  const s = scopeStretch(read.issues, { state, pagesText, from: 0, to: 5, lineWhole: true, turn: 3 });
  eq(JSON.stringify(s.mutations), JSON.stringify([{ type: 'knowledge.add', name: 'Renji', fact: 'Jovan and Rukia were together in the yard before noon' }]), 'one fact stands: ' + JSON.stringify(s.mutations));
  const why = s.refused.map((r) => r.why).join(' | ');
  assert(/Rukia already knows that/.test(why), 'known in other words: ' + why);
  assert(/Renji already knows that/.test(why), 'said twice in one answer');
  assert(/keeps no page for OTHER NAME|keeps no page for that name/.test(why) && /keeps no page for Byakuya/.test(why), 'nobody the ledger does not keep, and never a placeholder');
  assert(/nothing is written for the main character/.test(why) && /these pages do not say that/.test(why) && /did not say what Renji learned/.test(why), why);
  assert(/“canon\.lock” is not the continuous audit’s to write/.test(why) && /“presence\.leave” is not/.test(why) && /“rel\.shift” is not/.test(why), 'nothing but what someone learned: ' + why);
  eq(JSON.stringify(s.record.fixes), JSON.stringify([{ from: 'Marcus', to: 'Renji' }]), 'the prompt’s own example words are never a fix');
  eq(s.record.detail, 'Rukia promised Jovan to keep the seal hidden', 'a detail is kept clause by clause, each one the pages hold; a placeholder or an echo is not one');
  eq(s.pageFixes.length, PAGE_FIXES, 'two page faults a reading, at most');
  eq(s.pageFixes[0].page, 4); eq(s.pageFixes[1].page, null, 'a page outside the stretch is no page');
  /* the line read in part: what it is missing may be said, what it says may not be judged */
  const part = scopeStretch(read.issues, { state, pagesText, from: 0, to: 5, lineWhole: false, turn: 3 });
  eq(part.record.fixes.length, 0); eq(part.record.detail, 'Rukia promised Jovan to keep the seal hidden');
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
    const r = await auditStretch({ connection: { ...CONN }, storyId: st.id, brief: 'A story of the Thirteenth Division.', stale: () => false, renew: () => true,
      mend: async (id, words) => { mends.push({ id, words }); return []; }, note: async (id, finding) => { notes.push({ id, finding }); } });
    eq(calls.length, 1, 'one call');
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
  await withFetch(async (url, opts) => say(/pages 1-6 of the story/.test(bodyOf(opts).user) ? ANSWER : '{"issues":[]}'), async () => {
    const r = await auditStretch({ connection: { ...CONN }, storyId: st.id, stale: () => false, renew: () => true, mend, note: async () => { throw new Error('nothing is noted when the page was mended'); } });
    eq([r.ok, r.mendedPages, r.sealed, r.applied.length].join(), 'true,1,false,0');
    const mem = await loadMemory(st.id);
    assert(!mem.nodes.some((n) => n.id === 'a'), 'the line over the mended page was let go');
    eq((await loadState(st.id)).knowledge.Rukia, undefined, 'and nothing else was written by that reading');
    assert(/mended 1 page that could not be true beside the story before/.test(stretchWords(r)) && /the keeper folds the mended words/.test(stretchWords(r)), stretchWords(r));
    /* the keeper folds those pages again (here: by hand) — the new line is unread, and the page, already mended, is not mended twice */
    mem.nodes.push({ id: 'a2', span: [0, 5], text: LINE_A, level: 1, at: 9, whole: true });
    await saveMemory(st.id, mem);
    const notes = [];
    const r2 = await auditStretch({ connection: { ...CONN }, storyId: st.id, stale: () => false, renew: () => true, mend, note: async (id, f) => { notes.push({ id, f }); } });
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
    const r = await auditStretch({ connection: { ...CONN }, storyId: st2.id, stale: () => false, mend: async () => { asked += 1; return [{ id: pg.id }]; }, note: async () => {} });
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
  await withFetch(async (url, opts) => say(/pages 1-6 of the story/.test(bodyOf(opts).user) ? lasting : '{"issues":[]}'), async () => {
    const r = await auditStretch({ connection: { ...CONN }, storyId: st4.id, stale: () => false });
    eq([r.sealed, r.lineWritten].join(), 'true,true');
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
  for (const by of ['the writer', 'the housekeeper']) {
    const st = await tale('his own words ' + by, { lines: [{ id: 'a', span: [0, 5], text: LINE_A, detail: 'Rukia stared at the seal', level: 1, at: 1, whole: true, verified: { at: 5, fixed: by } }] });
    await withFetch(async () => say(ANSWER), async () => {
      const r = await auditStretch({ connection: { ...CONN }, storyId: st.id, stale: () => false, mend: async () => [], note: async () => {} });
      const a = (await loadMemory(st.id)).nodes.find((n) => n.id === 'a');
      eq(a.text, LINE_A, 'the line stands as ' + by + ' left it'); eq(a.detail, 'Rukia stared at the seal', 'and so does its detail');
      eq([r.sealed, r.lineLeft, r.lineMended, r.detailAdded, auditedOf(a)].join(), 'true,true,0,,6', 'read, marked, not written over');
      eq(((await loadState(st.id)).knowledge.Rukia || []).length, 1, 'what she learned is still written to the ledger');
      assert(/the record line is in your own words \(or the housekeeper’s for you\) — left as it is/.test(stretchWords(r)), stretchWords(r));
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
