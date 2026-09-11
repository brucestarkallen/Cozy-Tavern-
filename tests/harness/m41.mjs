/* M41 — the auditor: the whole ledger against the brief, the pages and the record. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { buildAuditorMessages, parseAuditorAnswer, auditLedger, auditRunWords, DEFAULT_AUDIT_EVERY } from '../../js/agents/auditor.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { createClock } from '../../js/engine/clock.js';
import { WORKER_NAMES } from '../../js/agents/status.js';
import { WORKER_ROWS } from '../../js/agents/assign.js';
import { db } from '../../js/store.js';
import { thinkingHouse, withHouse, HOUSES } from './thinkinghouse.mjs';

test('M41-1 the auditor sees all of it, in the order of authority, and reads answers leniently', () => {
  const s = emptyState(); s.sheet.playerName = 'Jovan'; s.present = [{ name: 'Liara' }]; s.place = { name: 'McDonald’s' };
  s.characters = { Kim: { core: 'the mother' } };
  s.offscreen = { Kris: { location: 'the office', activity: 'on a call' } };
  const p = buildAuditorMessages({ state: s, brief: 'Jovan dates Kendall Jenner.', castNotes: 'Liara — oldest friend', record: '[Day 1] Jovan sat', pages: [{ role: 'user', text: 'u' }, { role: 'assistant', text: 'STORY page' }] });
  for (const k of ['1. THE BRIEF', '2. THE PAGES', '3. THE RECORD', 'THE HOUR AND THE GROUND', 'WHO IS HERE', 'THE ABSENT', 'THE PEOPLE', 'THE CANON', 'THE THREADS', 'WHO KNOWS WHAT', 'PLACEHOLDERS: NAME']) assert(p.system.includes(k), 'law: ' + k);
  assert(!/Kris Jenner|Kendall/.test(p.system), 'no real family as an example in the law (M95)');
  assert(/The main character is Jovan\./.test(p.system));
  assert(p.user.includes('Jovan dates Kendall Jenner.') && p.user.includes('Kim — core: the mother') && p.user.includes('Kris — the office') && p.user.includes('[Day 1] Jovan sat') && p.user.includes('STORY: STORY page'));
  const r = parseAuditorAnswer('```json\n{"issues":[{"what":"Kim is written as the mother; the brief says Kris","fix":"Kris Jenner is the mother","mutations":[{"type":"people.set","name":"Kim","field":"core","text":"Kendall’s sister"},]},{"what":"the pages contradict the brief about the date","fix":"","mutations":[]}]}\n```');
  eq(r.note, 'ok'); eq(r.issues.length, 2); eq(r.issues[0].mutations.length, 1); eq(r.issues[1].mutations.length, 0);
  eq(parseAuditorAnswer('no').note, 'unusable');
});

test('M41-2 end to end: what is wrong is set right through the ledger; what cannot be is noted; a true ledger is said so', async () => {
  const storyId = 'm41';
  const s = emptyState(); s.sheet.playerName = 'Jovan';
  s.clock = createClock({ calendar: 'real', start: { year: 2025, month: 3, day: 14, hour: 14, minute: 30 } });
  s.present = [{ name: 'Liara' }, { name: 'Kenji' }];
  s.characters = { Kim: { core: 'the mother' } };
  await saveState(storyId, s);
  await db.messages.append(storyId, { role: 'user', text: 'u' });
  await db.messages.append(storyId, { role: 'assistant', text: '[McDonald’s — Friday, March 14, 2025 | 15:10 | ☀️ | hoodie | booth]\n\nKenji had left an hour ago. Liara stayed.' });
  const answer = JSON.stringify({ issues: [
    { what: 'Kenji is marked here; the page says he left an hour ago', fix: 'Kenji is not present', mutations: [{ type: 'presence.leave', name: 'Kenji' }] },
    { what: 'the clock says 14:30; the header says 15:10', fix: '15:10', mutations: [{ type: 'clock.set', year: 2025, month: 3, day: 14, hour: 15, minute: 10 }] },
    { what: 'Kim is written as the mother; the brief says the mother is Kris', fix: 'Kris is the mother', mutations: [{ type: 'people.set', name: 'Kim', field: 'core', text: 'Kendall’s sister' }, { type: 'people.set', name: 'Kris Jenner', field: 'core', text: 'Kendall’s mother' }] },
    { what: 'the brief and the pages disagree about the year', fix: '', mutations: [] },
  ] });
  const house = thinkingHouse({ answer });
  const r = await withHouse(house, () => auditLedger({ connection: HOUSES[0].conn, storyId, brief: 'Kendall’s mother is Kris.', stale: () => false }));
  eq(r.note, 'ok'); eq(r.applied.length, 4, r.rejected.map((x) => x.why).join(' | '));
  const st = await loadState(storyId);
  eq(st.present.length, 1); eq(st.present[0].name, 'Liara');
  eq(st.clock.minutes, s.clock.minutes + 40);
  eq(st.characters.Kim.core, 'Kendall’s sister');
  assert(st.characters['Kris Jenner'] && /mother/.test(st.characters['Kris Jenner'].core));
  eq(st.audit.issues.length, 4); eq(st.audit.issues[3].fixable, false);
  assert(/found 4 things, set 4 right:[\s\S]*1 seen, nothing to change/.test(auditRunWords(r)), auditRunWords(r));
  assert(st.log.some((l) => /Kenji/.test(l.words)), 'the change is logged (and so take-back-able)');
  const clean = thinkingHouse({ answer: '{"issues":[]}' });
  const r2 = await withHouse(clean, () => auditLedger({ connection: HOUSES[0].conn, storyId, stale: () => false }));
  eq(auditRunWords(r2), 'the ledger is true to the story');
});

test('M41-3 the house knows the auditor: last in the chain every few turns, by hand from the drawer, on the roster', () => {
  const chat = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  assert(chat.indexOf("enqueue('continuity'") < chat.indexOf("enqueue('auditor'") && chat.indexOf("enqueue('auditor'") < chat.indexOf("enqueue('checkpoint'"), 'after the second reader, before the checkpoint');
  assert(/visible % every !== 0\) return \{ silent: true \};/.test(chat), 'every few turns');
  assert(/async function auditNow\(\)/.test(chat) && /auditNow,/.test(chat));
  assert(WORKER_NAMES.includes('auditor') && WORKER_ROWS.some(([k]) => k === 'auditor'));
  const drawer = readFileSync(new URL('../../js/ui/drawer.js', import.meta.url), 'utf8');
  assert(/Audit the ledger/.test(drawer) && /The auditor’s last reading/.test(drawer));
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert(html.includes('id="audit-on"') && html.includes('id="audit-every"'));
  eq(DEFAULT_AUDIT_EVERY, 1); /* M94: every page */
  const sw = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
  assert(sw.includes("'js/agents/auditor.js'"));
});
