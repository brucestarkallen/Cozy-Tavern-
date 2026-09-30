/* Cozy Tavern — harness laws of M524: a block of tags after the page (his report: "<npc> <the mage> <wound>left arm severed…
 * <standing>P=-15 … </npc>" at the end of a page — his provider, or the frontend?). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { BUILTIN_RULES, applyRules } from '../../js/regex.js';
import { tidyPage } from '../../js/ui/pageshape.js';
import { withoutStandingNumbers } from '../../js/engine/people.js';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const PROSE = '[The throne room — Night | 23:10 | cold | armor | before the throne]\n\n' + 'The demon prince smiled and said nothing for a long while, and the hall held its breath with him. '.repeat(4) + 'Every ounce of the night\'s patience folding into one committed arc.';
const TAIL = '\n\n<npc>\n<the mage>\n<wound>left arm severed at the shoulder by the demon\'s ring-bite (severe, 8m, untreated, arterial)\n<standing>P=-15 (terror-wrapped hatred — he watched his own arm come off in a retrieve-game)\n</the mage>\n<the priestess>\n<standing>P=-10 (saw the mercy-demand enforced as theater)\n</the priestess>\n<the hero>\n<standing>P=-12 (the paladin, then the arm; whether his legs will ever again take him *at* the throne)\n</the hero>\n</npc>';

test('M524-1 AT THE DOOR AND ON THE WIRE: a block of tags a storyteller invents after its page is taken off before the page is saved and off older pages it is sent — HTML a page may truly carry (a phone screen, inline marks), and a block mid-page, are never touched', () => {
  eq(applyRules(PROSE + TAIL, BUILTIN_RULES, { on: 'storyteller', mode: 'page' }), PROSE, 'saved without it');
  eq(applyRules(PROSE + TAIL, BUILTIN_RULES, { on: 'storyteller', mode: 'wire' }), PROSE, 'sent without it');
  for (const kept of [PROSE + '\n\n<div class="phone"><p>Meet me at <b>nine</b>.</p></div>', PROSE + ' She whispered <i>never</i>.', '[Room]\n\n<status>\n<hp>10</hp>\n</status>\n\nThen the prose goes on after it.']) eq(applyRules(kept, BUILTIN_RULES, { on: 'storyteller', mode: 'page' }), kept, 'kept: ' + kept.slice(-40));
  eq(applyRules(PROSE + TAIL, BUILTIN_RULES, { on: 'writer', mode: 'page' }), PROSE + TAIL, 'never his own words');
});

test('M524-2 A PAGE KEPT BEFORE THIS IS MENDED: the same block comes off a page already kept (the mend that runs once a build when a tale opens), and what was taken is said', () => {
  const t = tidyPage(PROSE + TAIL, { mc: 'the hero' });
  eq(t.text, PROSE, 'the page ends on its prose');
  assert(t.did.includes('tags') && /^<npc>/.test(t.removed[0]), 'and says what it took');
  eq(tidyPage(PROSE, { mc: 'the hero' }).text, PROSE, 'a page without one is not touched');
});

test('M524-3 A STANDING IS THE LEDGER\'S NUMBER: "P=-12 (…)" is never written into a person\'s page and never read out of their card — the words beside it stay; words with no such number come back exactly', () => {
  let st = applyMutations({ ...emptyState(), page: 30 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'the mage' }]).state;
  st = applyMutations(st, [{ type: 'people.note', name: 'the mage', field: 'arc', text: 'P=-15 (terror-wrapped hatred — he watched his own arm come off)' }]).state;
  eq(st.characters['the mage'].arc, '(terror-wrapped hatred — he watched his own arm come off)', 'not written');
  eq(withoutStandingNumbers('wary of him (P: -15), still loyal'), 'wary of him, still loyal');
  for (const same of ['a P-51 pilot; R2 unit', 'Double  spaced  words.  ', 'Standing firm at the rail.']) eq(withoutStandingNumbers(same), same, 'untouched: ' + same);
});
