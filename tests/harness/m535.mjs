/* Cozy Tavern — harness laws of M535: the captains who left stay gone (his report: sixteen in "Who's here" after the meeting
 * broke up; "the auditor … Byakuya Kuchiki came into the scene. The elsewhere note let go of Byakuya Kuchiki"). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations, walkedBackOverTheWorld } from '../../js/engine/apply.js';
import { auditorScope } from '../../js/agents/auditor.js';

const H = '[The 1st Division assembly hall — Monday, March 3, 2025 | 10:40 | clear | shihakushō | by the long table]\n\n';
const AFTER = H + 'The meeting broke apart. Jovan stood close before Rukia while the hall emptied around them, sandals whispering out through the tall doors and the side door alike, until only the two of them and Shunsui on the table were left in the long room.';
const room = () => {
  let st = applyMutations({ ...emptyState(), page: 20 }, [{ type: 'mc.set', name: 'Jovan Oda' }, { type: 'place.set', name: 'the 1st Division assembly hall' }, { type: 'presence.enter', name: 'Jovan Oda' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }, { type: 'presence.enter', name: 'Shunsui Kyōraku' }, { type: 'presence.enter', name: 'Suì-Fēng' }, { type: 'presence.enter', name: 'Shinji Hirako' }]).state;
  /* the page reader let them go; the world wrote where each went — on page 21 */
  st = applyMutations({ ...st, page: 21 }, [{ type: 'presence.leave', name: 'Suì-Fēng' }, { type: 'presence.leave', name: 'Shinji Hirako' }]).state;
  st = applyMutations({ ...st, page: 21 }, [{ type: 'offscreen.set', name: 'Suì-Fēng', location: 'the 2nd Division road', activity: 'gone out the side door to the gatehouse' }, { type: 'offscreen.set', name: 'Shinji Hirako', location: 'the corridor past the tall doors', activity: 'walking the 5th\'s way with Rose' }]).state;
  return st;
};
const here = (st) => (st.present || []).map((p) => p.name).sort().join(', ');

test('M535-1 THE AUDITOR NEVER WALKS BACK IN SOMEONE THE NEWEST PAGE DOES NOT KEEP: its walk-ins of the captains the world seated elsewhere this page are refused; someone the newest page shows here may still be brought in', () => {
  const st = room();
  const issues = [{ what: 'the ledger lacks people on the latest pages', mutations: [{ type: 'presence.enter', name: 'Suì-Fēng' }, { type: 'presence.enter', name: 'Shinji Hirako' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }] }];
  const kept = auditorScope(issues, st, { header: [], page: AFTER });
  eq(kept.flatMap((i) => i.mutations).map((m) => m.name).join(', '), '', 'Suì-Fēng and Shinji keep their seats (Rukia is already here — nothing to do)');
  const page2 = H + 'Suì-Fēng came back through the side door and stopped at the table, arms folded, looking at Jovan.';
  const kept2 = auditorScope([{ what: 'she is here', mutations: [{ type: 'presence.enter', name: 'Suì-Fēng' }] }], st, { header: [], page: page2 });
  eq(kept2.flatMap((i) => i.mutations).map((m) => m.name).join(', '), 'Suì-Fēng', 'the newest page shows her back: she may come in');
});

test('M535-2 WALKED BACK IN OVER THE WORLD\'S OWN WORD, PUT RIGHT: someone walked in on the same page the world seated them, whom the newest page does not keep, goes back to that seat — never someone the newest page keeps, never a walk-in on a later page', () => {
  let st = room();
  /* what the auditor did on page 21: walked them back in, letting the seats go */
  st = applyMutations({ ...st, page: 21 }, [{ type: 'presence.enter', name: 'Suì-Fēng', position: 'behind the second cushion at the table' }, { type: 'presence.enter', name: 'Shinji Hirako', position: 'seated at the table' }]).state;
  eq(here(st), 'Jovan Oda, Rukia Kuchiki, Shinji Hirako, Shunsui Kyōraku, Suì-Fēng', 'fixture: the wrong walk-ins');
  const fix = walkedBackOverTheWorld(st, AFTER);
  const healed = applyMutations(st, fix).state;
  eq(here(healed), 'Jovan Oda, Rukia Kuchiki, Shunsui Kyōraku', 'they go back out');
  assert(/2nd Division road/.test(JSON.stringify(healed.offscreen)) && /corridor past the tall doors/.test(JSON.stringify(healed.offscreen)), 'to the seats the world gave them');
  const kept = walkedBackOverTheWorld(st, H + 'Suì-Fēng stayed by the table, watching Jovan; Shinji leaned on the wall beside her.');
  eq(kept.length, 0, 'a newest page that keeps them keeps them');
  let later = room();
  later = applyMutations({ ...later, page: 25 }, [{ type: 'presence.enter', name: 'Suì-Fēng' }]).state; /* she came back four pages later */
  eq(walkedBackOverTheWorld(later, AFTER).length, 0, 'a walk-in on a later page than her seat is her own coming back');
});
