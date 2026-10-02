/* Cozy Tavern — harness laws of M555: "Weigh them again doesn't change anything — Jovan is still 5; and the headmaster is
 * rated 4 (earth 5). Why can't the AI act as a smart GM?" */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { saveState, loadState, emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { maybeSeedSheet, mergeSeed, SEED_SYSTEM, SEED_VERSION } from '../../js/agents/referee.js';

async function tale(actors, seedVersion = SEED_VERSION) {
  const st = await db.stories.create({ title: 'the academy' });
  await db.messages.append(st.id, { role: 'user', text: 'I parry Ivar.' });
  await db.messages.append(st.id, { role: 'assistant', text: 'Jovan turned the blade aside. Ivar stepped back, surprised.' });
  const s = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Jovan Wessex' }, { type: 'presence.enter', name: 'Jovan Wessex' }, { type: 'people.set', name: 'Aldric Vane', field: 'core', text: 'headmaster of the academy' }, { type: 'people.set', name: 'Ivar van Emreis', field: 'core', text: 'the strongest student' }]).state;
  s.sheet = { playerName: 'Jovan Wessex', seedVersion, seededAtPage: 1, actors };
  await saveState(st.id, { ...s, page: 1 });
  return st;
}

test('M555-1 AN ENTRY WITH NO HELPER\'S MARK IS NOT HIS HAND\'S — nothing in Cozy sets a rating by hand, so an older build\'s entry is weighed like any other; only an explicit mark of his hand keeps a rating', () => {
  const s = { ...emptyState(), mc: { name: 'Jovan Wessex' } };
  s.sheet = { playerName: 'Jovan Wessex', actors: { 'Jovan Wessex': { default: 5, domains: { melee: 5 } }, 'Aldric Vane': { default: 4, domains: { earth: 5 } }, 'Mira': { default: 3, domains: { craft: 9 }, _hand: true } } };
  mergeSeed(s, { actors: [{ name: 'Jovan Wessex', default: 6, domains: { melee: 8 } }, { name: 'Aldric Vane', default: 7, domains: { earth: 9 } }, { name: 'Mira', default: 1, domains: { craft: 1 } }] });
  eq(s.sheet.actors['Jovan Wessex'].domains.melee, 8, 'an older build\'s entry is weighed');
  eq(s.sheet.actors['Aldric Vane'].domains.earth, 9);
  eq(s.sheet.actors.Mira.domains.craft, 9, 'his own mark stands');
});

test('M555-2 "WEIGH THEM AGAIN" WEIGHS FRESH — what the weighing says stands, up or down, and an art it left unnamed this time keeps its number; the house\'s own weighings still only let a considered rating rise', async () => {
  const st = await tale({ 'Jovan Wessex': { default: 5, domains: { melee: 5, ice: 7 }, _auto: true, seed: SEED_VERSION }, 'Aldric Vane': { default: 4, domains: { earth: 5, social: 9 }, _auto: true, seed: SEED_VERSION } });
  const answer = { actors: [{ name: 'Jovan Wessex', default: 4, domains: { melee: 8 } }, { name: 'Aldric Vane', default: 7, domains: { earth: 9, social: 9 } }] };
  const out = await maybeSeedSheet({ connection: { id: 'c' }, storyId: st.id, force: true, callLLM: async () => JSON.stringify(answer) });
  assert(out.ok, 'weighed: ' + JSON.stringify(out));
  const sheet = (await loadState(st.id)).sheet.actors;
  eq(sheet['Jovan Wessex'].domains.melee, 8, 'up');
  eq(sheet['Jovan Wessex'].default, 4, 'and down, by hand');
  eq(sheet['Jovan Wessex'].domains.ice, 7, 'his ice kept, left unnamed this time');
  eq(sheet['Aldric Vane'].domains.earth, 9, 'the headmaster as the weighing reads him');
  const s2 = await tale({ 'Jovan Wessex': { default: 6, domains: { melee: 8 }, _auto: true, seed: SEED_VERSION } });
  const auto = await loadState(s2.id); auto.seedDueAfterFight = true; await saveState(s2.id, auto);
  await maybeSeedSheet({ connection: { id: 'c' }, storyId: s2.id, callLLM: async () => JSON.stringify({ actors: [{ name: 'Jovan Wessex', default: 3, domains: { melee: 4 } }] }) });
  eq((await loadState(s2.id)).sheet.actors['Jovan Wessex'].domains.melee, 8, 'after a fight, by itself: a considered rating only rises');
});

test('M555-3 RATED AS A SHARP GAME MASTER WOULD: someone whose measure the pages have not shown is set by their place in the world — a headmaster of mages is a master mage, not a clerk with a title — and a sheet weighed before is weighed again once', () => {
  assert(/RATE AS A SHARP GAME MASTER WOULD/.test(SEED_SYSTEM) && /a headmaster of mages is a master mage \(8-9 in their art\), never a clerk with a title/.test(SEED_SYSTEM) && /In a world where power decides rank, rank tells you power/.test(SEED_SYSTEM), 'the rule');
  assert(SEED_VERSION >= 4, 'weighed again once');
});
