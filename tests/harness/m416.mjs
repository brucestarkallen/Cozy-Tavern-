/* M416: the storyteller's notes read the way one person tells another — "busy" never invents company, a thread's next
 * reads right whether it is a plan or a sentence, an away card says "away" (where is said once, under Elsewhere), and
 * who hasn't found out what is told without capitals or a rulebook — while every reader that looks for those lines
 * (the anchor, the second reader) reads the same words. Runs the real renderers on a real ledger. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { emptyState, renderStateFacts, BLIND_HEAD } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { threadNextWords, renderThreads, BLIND_LINE } from '../../js/engine/world.js';
import { renderAllThreads } from '../../js/engine/whole.js';
import { renderPeopleTiers } from '../../js/engine/people.js';
import { sceneAnchor } from '../../js/assemble/anchor.js';
import { buildContinuityMessages } from '../../js/agents/continuity.js';

const ledger = () => applyMutations({ ...emptyState(), page: 3 }, [
  { type: 'mc.set', name: 'Oda' }, { type: 'place.set', name: '13th Division barracks — training courtyard' },
  { type: 'clock.set', year: 2026, month: 6, day: 1, hour: 10, minute: 12 },
  { type: 'presence.enter', name: 'Oda' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }, { type: 'presence.enter', name: 'Renji Abarai' },
  { type: 'people.set', name: 'Byakuya Kuchiki', field: 'core', text: 'captain of the 6th; Rukia\u2019s adoptive brother.' },
  { type: 'offscreen.set', name: 'Byakuya Kuchiki', location: '6th Division barracks — his office', activity: 'reviewing the patrol rosters', stance: 'busy' },
  { type: 'thread.set', title: 'Rukia and the captaincy', owner: 'Rukia Kuchiki', heat: 'hot', next: 'she tests whether Oda deserves it' },
  { type: 'thread.set', title: 'Renji and the bet', owner: 'Renji Abarai', heat: 'hot', next: 'Collect on the bet before sundown' },
  { type: 'knowledge.add', name: 'Rukia Kuchiki', fact: 'Oda skipped the captains\u2019 meeting yesterday' },
]).state;

test('M416-1 BUSY NEVER INVENTS COMPANY: someone alone with their work is "busy with their own affairs" in the storyteller\u2019s notes', () => {
  const facts = renderStateFacts(ledger());
  assert(/Byakuya Kuchiki — 6th Division barracks — his office, reviewing the patrol rosters — busy with their own affairs/.test(facts), facts);
  assert(!/someone else/.test(facts), 'never "taken up with someone else"');
});

test('M416-2 A THREAD\u2019S NEXT READS RIGHT: a plan after "means to", a sentence after "next:" — the same in the storyteller\u2019s notes and the workers\u2019 whole ledger', () => {
  eq(threadNextWords('Rukia Kuchiki', 'corner him before Renji leaves'), ' means to corner him before Renji leaves');
  eq(threadNextWords('Rukia Kuchiki', 'she tests whether Oda deserves it'), ' — next: she tests whether Oda deserves it');
  eq(threadNextWords('Rukia Kuchiki', 'to test him'), ' means to test him');
  eq(threadNextWords('Rukia Kuchiki', 'Rukia confronts Oda at dawn'), ' — next: Rukia confronts Oda at dawn');
  eq(threadNextWords('Kim', 'will text Liara tonight'), ' — next: will text Liara tonight');
  eq(threadNextWords('Byakuya Kuchiki', 'Watch the new captain closely.'), ' means to watch the new captain closely');
  eq(threadNextWords('', 'confront him'), ' — next: confront him');
  const st = ledger();
  for (const text of [renderThreads(st.threads), renderAllThreads(st.threads)]) {
    assert(/Rukia Kuchiki — next: she tests whether Oda deserves it/.test(text), text);
    assert(/Renji Abarai means to collect on the bet before sundown/.test(text), text);
    assert(!/means to she/.test(text), 'never "means to she …"');
  }
});

test('M416-3 AN AWAY CARD SAYS "AWAY" — where they are is said once, under Elsewhere, with no pointer in the notes', () => {
  const st = ledger();
  const people = (renderPeopleTiers(st, { recentPages: ['Byakuya Kuchiki was mentioned at the gate.'], seatsInState: true }) || {}).text || '';
  assert(/Byakuya Kuchiki — captain of the 6th; Rukia’s adoptive brother\.\nNow: away(\n|$)/.test(people), people);
  assert(!/under Elsewhere|see Elsewhere/.test(people), 'no cross-reference');
  assert(/Elsewhere: Byakuya Kuchiki — 6th Division barracks/.test(renderStateFacts(st, { whole: true })), 'and Elsewhere says where');
});

test('M416-4 WHO HASN\u2019T FOUND OUT WHAT, SAID PLAINLY — no capitals, no rulebook; the anchor and the second reader read the same words', () => {
  const st = ledger();
  const facts = renderStateFacts(st, { scenePages: ['Rukia folded her arms. Renji laughed at the gate.'] });
  assert(facts.includes(BLIND_HEAD), 'the head: ' + facts);
  assert(!/\b(NOT|SPEAK|ACT|must)\b/.test(BLIND_HEAD), 'no shouted words, no "must": ' + BLIND_HEAD);
  assert(/Renji Abarai hasn’t found out: Oda skipped the captains’ meeting yesterday \(Rukia Kuchiki knows\)\./.test(facts), facts);
  const anchor = sceneAnchor(st, { scenePages: ['Rukia folded her arms. Renji laughed at the gate.'] });
  assert(anchor.includes('Renji Abarai' + BLIND_LINE + 'Oda skipped'), 'the anchor (derestricted switch) still picks the line up: ' + anchor);
  const reader = buildContinuityMessages({ state: st, userText: 'u', assistantText: 'Renji grinned.' });
  assert(reader.system.includes('"' + BLIND_LINE.trim() + '"'), 'the second reader is told the same words the notes use');
});
