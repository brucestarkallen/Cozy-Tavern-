/* M414: the one matcher, audited — a possessive is not its owner, two titles of one kind are two people, "named on the
 * page" is one answer that never counts a title or "the", and the auditor's permission to take someone out needs a
 * going the NARRATION shows. Every test runs the real ledger (applyMutations) or the real reader on a scripted model. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { HOUSES, withHouse, thinkingHouse } from './thinkinghouse.mjs';
import { db } from '../../js/store.js';
import { auditLedger, showsDeparture } from '../../js/agents/auditor.js';
import { leavesTheyWereShown } from '../../js/agents/extractor.js';
import { quietInScene } from '../../js/agents/world.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { findPersonKey } from '../../js/engine/people.js';
import { samePersonName, nameOnPage, isHere } from '../../js/engine/names.js';

test('M414-1 THE OWNER IS NOT THE PERSON: "Jovan\'s mother" keeps her seat while he is in the scene, walks in when she comes, and a leave meant for her never takes HIM out', () => {
  eq(samePersonName("Jovan's mother", 'Jovan'), false, 'a possessive names its owner, not the person');
  let st = applyMutations({ ...emptyState(), page: 0 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'the Wells kitchen' },
    { type: 'presence.enter', name: 'Jovan' }, { type: 'offscreen.set', name: "Jovan's mother", location: 'the hospital', activity: 'a night shift' }]).state;
  assert(st.offscreen["Jovan's mother"], 'she can be seated elsewhere while he stands in the scene');
  st = applyMutations(st, [{ type: 'clock.advance', minutes: 5 }]).state;
  assert(st.offscreen["Jovan's mother"], 'and the batch law (nobody in two places) does not let her seat go — she is not him');
  const walked = applyMutations(st, [{ type: 'presence.enter', name: "Jovan's mother", position: 'at the door' }]);
  eq(walked.applied.length, 1, 'she walks in — never "already written in"');
  eq(walked.state.present.map((p) => p.name).join(', '), "Jovan, Jovan's mother", 'both are in the scene');
  assert(!walked.state.offscreen["Jovan's mother"], 'and her elsewhere note lets go as she comes in');
  const left = applyMutations(walked.state, [{ type: 'presence.leave', name: "Jovan's mom" }]);
  assert(left.state.present.some((p) => p.name === 'Jovan'), 'a leave under another word for her never takes the main character out');
  eq(left.applied.length, 0, 'and it takes nobody out on a guess');
  eq(samePersonName("O'Brien", 'Brien'), false, 'an apostrophe inside a name is part of it');
});

test('M414-2 TWO TITLES OF ONE KIND ARE TWO PEOPLE: Captain Kuchiki is not Lieutenant Kuchiki (nor Mr. Mrs.) — and Byakuya walking in while Rukia is in the scene comes in', () => {
  const pairs = [
    ['Captain Kuchiki', 'Lieutenant Kuchiki', false], ['Mr. Sterling', 'Mrs. Sterling', false], ['Mr. Sterling', 'Dr. Sterling', false],
    ['Kuchiki-fukutaichō', 'Captain Kuchiki', false], ['King Arthur', 'Prince Arthur', false],
    ['Head Captain Yamamoto', 'Captain Yamamoto', true], ['Lady Rukia', 'Lieutenant Rukia Kuchiki', true], ['Kuchiki-taichō', 'Captain Kuchiki', true],
    ['Lieutenant Rukia Kuchiki', 'Rukia', true], ['Kuchiki Rukia', 'Rukia Kuchiki', true], ['Kyōraku-san', 'Shunsui Kyōraku', true], ['The Constructor', 'constructor', true],
    ['Jackie Chan', 'Chan', true], ['Jackie Chan', 'Jackie', true], ['Rukia-chan', 'Rukia Kuchiki', true], ['Hitsugaya-taichou', 'Captain Hitsugaya', true],
  ];
  for (const [a, b, want] of pairs) eq(samePersonName(a, b), want, a + ' / ' + b);
  const base = applyMutations({ ...emptyState(), page: 0 }, [{ type: 'mc.set', name: 'Oda' }, { type: 'place.set', name: '13th Division barracks' },
    { type: 'presence.enter', name: 'Oda' }, { type: 'presence.enter', name: 'Lieutenant Rukia Kuchiki' },
    { type: 'people.set', name: 'Byakuya Kuchiki', field: 'core', text: 'captain of the 6th Division' },
    { type: 'offscreen.set', name: 'Byakuya Kuchiki', location: '6th Division barracks', activity: 'paperwork' }]).state;
  const cap = applyMutations(base, [{ type: 'presence.enter', name: 'Captain Kuchiki' }]);
  eq(cap.applied.length, 1, 'Captain Kuchiki walks in — Rukia being here does not swallow him');
  assert(!cap.state.offscreen['Byakuya Kuchiki'], 'and his elsewhere note lets go (he is here now)');
  const bare = applyMutations({ ...base, present: [...base.present.slice(0, 1), { name: 'Rukia Kuchiki' }] }, [{ type: 'presence.enter', name: 'Kuchiki' }]);
  eq(bare.applied.length, 1, 'a bare "Kuchiki" walking in while Rukia is here and Byakuya has a page is not "already here" — it could be either');
  const again = applyMutations(base, [{ type: 'presence.enter', name: 'Rukia' }]);
  assert(again.applied.length === 0 && again.rejected[0] && again.rejected[0].same === true, 'but "Rukia" walking in is Rukia, already here');
  eq(findPersonKey({ 'Toshiro Hitsugaya': {}, 'Rukia Kuchiki': {} }, 'Captain Hitsugaya'), 'Toshiro Hitsugaya', 'a rank finds its person\'s page');
  eq(findPersonKey({ 'Byakuya Kuchiki': {}, 'Rukia Kuchiki': {} }, 'Kuchiki Rukia'), 'Rukia Kuchiki', 'family name first finds the page');
  eq(findPersonKey({ 'Byakuya Kuchiki': {}, 'Rukia Kuchiki': {} }, 'Captain Kuchiki'), '', 'two Kuchikis: a rank and a surname decide nobody');
  eq(findPersonKey({ Sterling: {} }, 'Mrs. Sterling'), '', 'M272 stands: Mrs. Sterling is not whoever was written down as plain Sterling');
  eq(findPersonKey({ Hitsugaya: {} }, 'Captain Hitsugaya'), 'Hitsugaya', 'a rank before a surname still finds the bare surname page');
  assert(isHere(cap.state, 'Captain Kuchiki') && isHere(cap.state, 'Rukia'), 'both are here — he under his rank, she under her name');
});

test('M414-3 NAMED ON THE PAGE, ONE ANSWER: never a title, "the" or an owner; a two-letter name counts — through the world agent\'s quiet ones and the page reader\'s leaves', () => {
  const page = 'The lieutenant saluted. Captain Kyoraku tipped his hat. Ed grinned. His mother set down the tray.';
  const cases = [['Lieutenant Rukia Kuchiki', false], ['Shunsui Kyōraku', true], ['Ed', true], ['The bartender', false], ["Jovan's mother", true], ['Jovan', false]];
  for (const [n, want] of cases) eq(nameOnPage(page, n), want, 'named? ' + n);
  eq(nameOnPage("O'Brien said so.", "O'Brien"), true, "O'Brien");
  eq(nameOnPage("Jovan's sword glinted.", 'Jovan'), true, 'a possessive in the text still names its owner');
  const st = applyMutations({ ...emptyState(), page: 0 }, [{ type: 'mc.set', name: 'Oda' }, { type: 'place.set', name: '13th Division barracks' },
    ...['Oda', 'Lieutenant Rukia Kuchiki', 'Ed', 'The bartender'].map((n) => ({ type: 'presence.enter', name: n })),
    ...['Lieutenant Rukia Kuchiki', 'Ed', 'The bartender'].map((n) => ({ type: 'people.set', name: n, field: 'state', text: 'waiting' }))]).state;
  const quiet = quietInScene(st, 'The lieutenant of the 5th saluted at the door. Ed grinned.', 'I nod.');
  assert(quiet.includes('Lieutenant Rukia Kuchiki'), 'a page that only says "the lieutenant" does not name Rukia — she is quiet, and the world agent keeps her alive: ' + quiet.join(', '));
  assert(quiet.includes('The bartender'), '"the" on a page is not the bartender');
  assert(!quiet.includes('Ed'), 'Ed, on the page, is not quiet');
  const leaves = leavesTheyWereShown([{ type: 'presence.leave', name: 'Ed' }, { type: 'presence.leave', name: 'Lieutenant Rukia Kuchiki' }], 'Ed walked out. The lieutenant stayed.');
  eq(leaves.map((m) => m.name).join(', '), 'Ed', 'Ed, shown walking out, may leave (a two-letter name was never "named" before); the lieutenant the page never names stays');
});

/* what the auditor was sent, as one run of words; and its final review's answer (M698–M712), as an auditor gives it */
const told = (house) => house.calls.map((c) => (c.body.messages || []).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n')).join('\n').replace(/\s+/g, ' ');
const review = (more) => JSON.stringify({ scene: [], issues: [], review: { status: 'complete', why: 'every entry read against the newest page, to its end', open: [] }, standings: [], ...more });

/* M689 (the pipeline review he agreed to, docs/LEDGER-PIPELINE-M689.md): "production no longer runs [auditorScope] or the
 * separate departure keyword filter" — whether a sentence is a going is the auditor's own reading now (M709: its final
 * scope keeps supported operations and ownership; docs/LEDGER_PIPELINE.md: no new regex guards over its judgment). The
 * one reading of a going (showsDeparture) still serves the page reader and the house; the auditor is TOLD what a going
 * is, and an auditor that does as it is told takes out only the one the page shows going. */
test('M414-4 THE AUDITOR\'S "SHOWN GOING" IS NARRATED: a side ("to his left", "her left hand") and a line someone says ("Don\'t leave") are not goings — in the house\'s one reading of a going, and in what the real auditor is told; as told, Rukia stays and Byakuya goes', async () => {
  const sentences = {
    'Rukia stood to his left.': false, 'She raised her left hand.': false, '"Don\'t leave," Rukia said.': false, 'He didn\'t leave.': false,
    'Rukia wanted to leave.': false, 'He left the sword untouched.': false, 'The sword was left on the table.': false, 'Rukia turned away from him.': false,
    'Byakuya turned and left the courtyard.': true, 'Renji left.': true, 'Lisa leaves the hall.': true, 'Byakuya flash-stepped away.': true, 'Iba was gone by morning.': true,
  };
  for (const [s, want] of Object.entries(sentences)) eq(showsDeparture(s), want, s);
  const PAGE = 'Rukia stood to his left, arms folded. "Don\'t leave yet," Renji said to her. Byakuya turned and left the courtyard.';
  const st0 = await db.stories.create({ title: 'The barracks' });
  await db.messages.append(st0.id, { role: 'user', text: 'I read the report.' });
  await db.messages.append(st0.id, { role: 'assistant', text: PAGE });
  const st = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Oda' }, { type: 'place.set', name: '13th Division barracks — courtyard' },
    ...['Oda', 'Rukia Kuchiki', 'Renji Abarai', 'Byakuya Kuchiki'].map((n) => ({ type: 'presence.enter', name: n }))]).state;
  await saveState(st0.id, st);
  const house = thinkingHouse({ answer: review({
    scene: [{ name: 'Rukia Kuchiki', repair: false, ending: { position: 'to his left, arms folded', shown: 'Rukia stood to his left, arms folded' } }],
    issues: [{ what: 'Byakuya left the courtyard and is still listed here', fix: 'he walked out', pages: false, mutations: [{ type: 'presence.leave', name: 'Byakuya Kuchiki', shown: 'Byakuya turned and left the courtyard' }] }] }) });
  await withHouse(house, () => auditLedger({ connection: HOUSES[0].conn, storyId: st0.id, brief: 'A Bleach story.' }));
  const words = told(house);
  for (const rule of ['the page\'s own words that show them going, copied exactly', 'Questions, wishes, hypotheticals and requests are not completed events.',
    'Resolve pronouns and titles in context, not by keyword matching.', 'Silence is not departure']) assert(words.includes(rule), 'the auditor is told: ' + rule);
  assert(words.includes(PAGE.replace(/\s+/g, ' ')), 'and is handed the page whole');
  const here = (await loadState(st0.id)).present.map((p) => p.name);
  assert(here.includes('Rukia Kuchiki'), 'Rukia, standing to his left, stays: ' + here.join(', '));
  assert(!here.includes('Byakuya Kuchiki'), 'Byakuya, shown leaving, goes');
});
