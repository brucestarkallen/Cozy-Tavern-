/* Cozy Tavern — harness laws of M519: when the sound drowns the story (his word: "once the dashes and the sounds start,
 * the small model spams them until I literally can't read it — and it keeps that repeating structure"). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { pageTexture, tooLoud, calmPage, SOUND_BAND, DASH_BAND } from '../../js/assemble/smallprose.js';
import { renderSounds, breathWords } from '../../js/assemble/planwords.js';

const H = '[The courtyard — Monday | 12:04 | noon | haori | at the rail]\n\n';
const SPAM = H + 'Zaraki lunged—steel—steel—steel—and Jovan met it. *CLANG* *CLANG* *CLANG* "Hah—HAH—hah—HAH—hah—!" Zaraki roared—roared—roared, and the yard shook.\n\n"Nngh—ahh—AHHH—" Jovan gritted—gritted—his teeth. *thud* *thud* *thud*\n\n"Gkh—!"\n\n"Hah—!"\n\n"Ahh—!"\n\nThe blades rang—rang—rang. "I—can\'t—stop—it—now—" Rukia whispered—whispered.';
const SPAM_PAGE = SPAM + '\n\n' + SPAM.slice(H.length) + '\n\n' + SPAM.slice(H.length); /* a page of it, not a paragraph */
const PROSE = H + 'The noon wind came off the wall and pushed dust across the stones. Rukia kept her hand on the rail — the wood was hot enough to hurt — and said nothing. Along the gallery the captains had stopped pretending to talk.\n\nZaraki rolled his shoulders once. The bells in his hair answered, and the yard went still around him the way a field goes still before rain. Jovan did not draw. He watched the big man\'s feet instead, the way the weight settled into the left heel, the half-step that would come before the first cut.\n\n*CRACK* The practice sword split in Zaraki\'s grip. He looked at the broken wood as if it had insulted him, then laughed, one short bark, and tossed the pieces aside.\n\n"Wait—" Rukia said, but he was already walking toward the rack, and the captains leaned forward along the rail to see what he would choose next.';

test('M519-1 HOW THICK A PAGE IS: sounds (contact sounds, voiced sound-lines, drawn-out letters) and dashes per hundred words, the header left out — a spammed page far past the band (' + SOUND_BAND + ' sounds, ' + DASH_BAND + ' dashes), good prose inside it', () => {
  const s = pageTexture(SPAM_PAGE); const p = pageTexture(PROSE);
  assert(s.soundPer100 > SOUND_BAND * 2 && s.dashPer100 > DASH_BAND * 2, 'spam: ' + JSON.stringify(s));
  assert(p.soundPer100 <= SOUND_BAND && p.dashPer100 <= DASH_BAND, 'prose: ' + JSON.stringify(p));
});

test('M519-2 THE BRAKE, WITH ITS HOLD: the newest page far past the band, or two of the last three past it, is too loud; once loud it eases only when the newest page is well back inside (70% of the band) — no page-by-page flip-flop', () => {
  const s = pageTexture(SPAM_PAGE); const p = pageTexture(PROSE);
  eq(tooLoud([p, p, p]), false, 'good prose is not loud');
  eq(tooLoud([p, p, s]), true, 'one page far past it is');
  const mild = { soundPer100: SOUND_BAND + 1, dashPer100: 1 };
  eq(tooLoud([p, p, mild]), false, 'one page a little past it is not');
  eq(tooLoud([p, mild, mild]), true, 'two of three a little past it are');
  eq(tooLoud([s, s, { soundPer100: SOUND_BAND * 0.8, dashPer100: 1 }], { wasLoud: true }), true, 'held: a page just under the band does not release it');
  eq(tooLoud([s, s, p], { wasLoud: true }), false, 'released: a page well inside the band');
});

test('M519-3 THE MIRROR EASED, THE PAGE UNTOUCHED: a word said over and over with dashes said once, a strung-out sound kept short, a chain of broken fragments kept to its first two, the same asterisked sound once, a run of sound-only lines one — and ordinary prose (its dashes, its one sound) exactly as written', () => {
  const eased = calmPage(SPAM);
  for (const gone of ['steel—steel', 'roared—roared', 'HAH—hah', '*CLANG* *CLANG*', '*thud* *thud*', 'stop—it—now', 'rang—rang']) assert(!eased.includes(gone), 'eased: ' + gone);
  assert(eased.includes('"Gkh—!"') && !eased.includes('"Ahh—!"'), 'a run of sound-only lines keeps its first');
  assert(eased.includes('Zaraki lunged') && eased.includes('Rukia whispered') && eased.includes('the yard shook'), 'the story itself stays');
  const before = pageTexture(SPAM); const after = pageTexture(eased);
  assert(after.soundPer100 < before.soundPer100 && after.dashPer100 < before.dashPer100 * 0.7, 'thinner: ' + JSON.stringify({ before, after }));
  eq(calmPage(PROSE), PROSE, 'ordinary prose exactly as written');
});

test('M519-4 THE BREATH, NOT A SOUND IN EVERY PARAGRAPH: too loud, the heated page is told to breathe — whole plain sentences, a sound only where a blow lands or a cry breaks, once; never "every paragraph", never the list of sounds', () => {
  const plan = { intense: true, loud: true, sounds: ['"Hah—HAH—"', '*CLANG*'] };
  const normal = renderSounds(plan, {});
  assert(/Every paragraph: a voiced line that stretches or repeats/.test(normal) && /The sounds here/.test(normal), 'not too loud: his heated page as before');
  const breath = renderSounds(plan, { tooLoud: true });
  assert(breath.startsWith(breathWords()) && !/Every paragraph/.test(breath) && !/The sounds here/.test(breath), 'too loud: the breath');
});
