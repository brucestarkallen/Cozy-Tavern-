/* Cozy Tavern — harness law of M556: "I chose a different model and everything is still the same." Every weighing was
 * handed the last sheet's numbers and kept them. A weighing he asks for, and the heal of an older sheet, are weighed blind
 * to the old numbers — from the brief and the story. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { saveState, loadState, emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { maybeSeedSheet, buildSeedUser, SEED_VERSION } from '../../js/agents/referee.js';

const sheetOf = (user) => (user.match(/<sheet>\n([\s\S]*?)\n<\/sheet>/) || [])[1] || '';

test('M556 "WEIGH THEM AGAIN" IS WEIGHED FROM THE STORY, NEVER FROM THE OLD NUMBERS — the helper is shown who is rated and what they carry, not a single old number; the house\'s own weighings still see the last sheet; the new numbers land', async () => {
  const st = await db.stories.create({ title: 'the academy, blind' });
  await db.messages.append(st.id, { role: 'user', text: 'I parry Ivar.' });
  await db.messages.append(st.id, { role: 'assistant', text: 'Jovan turned the strongest student\u2019s blade aside, twice.' });
  const s = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Jovan Wessex' }, { type: 'presence.enter', name: 'Jovan Wessex' }]).state;
  s.sheet = { playerName: 'Jovan Wessex', seedVersion: SEED_VERSION, seededAtPage: 1, actors: {
    'Jovan Wessex': { default: 5, domains: { melee: 6, ice: 7 }, conditions: [{ name: 'dual-named conduit', mod: 1, by: 'seed' }], _auto: true, seed: SEED_VERSION },
    'Aldric Vane': { default: 4, domains: { earth: 5 }, _auto: true, seed: SEED_VERSION },
  } };
  await saveState(st.id, { ...s, page: 1 });
  let seen = '';
  const out = await maybeSeedSheet({ connection: { id: 'c' }, storyId: st.id, force: true, callLLM: async (c, sys, user) => { seen = user; return JSON.stringify({ actors: [{ name: 'Jovan Wessex', default: 7, domains: { melee: 8 } }, { name: 'Aldric Vane', default: 8, domains: { earth: 9 } }] }); } });
  assert(out.ok, JSON.stringify(out));
  const shown = sheetOf(seen);
  assert(/Jovan Wessex \(the main character\) \| carries: dual-named conduit \+1/.test(shown) && /Aldric Vane/.test(shown), 'who is rated and what they carry: ' + shown);
  assert(!/default|\b[0-9]\b(?! *(?:[a-z]))|melee|earth 5/.test(shown.replace(/\+1/g, '')), 'not one old number: ' + shown);
  const after = (await loadState(st.id)).sheet.actors;
  eq(after['Jovan Wessex'].domains.melee, 8); eq(after['Jovan Wessex'].default, 7); eq(after['Aldric Vane'].domains.earth, 9, 'the new numbers land');
  const auto = buildSeedUser({ state: await loadState(st.id), pages: [] });
  assert(/Jovan Wessex \(the main character\): default 7, melee 8/.test(sheetOf(auto)), 'the house\'s own weighing sees the last sheet');
  assert(!/default/.test(sheetOf(buildSeedUser({ state: await loadState(st.id), pages: [], blind: true }))), 'blind is blind');
});
