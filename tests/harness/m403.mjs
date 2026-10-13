/* M403: the auditor never moves the ground on its own reading, and never takes someone out of the scene the latest
 * page never shows leaving — his whole Gotei 13 went "elsewhere, last seen at the courtyard" from one audit.
 * M689 (the pipeline review he agreed to, docs/LEDGER-PIPELINE-M689.md) took that judgment out of code: "Auditor
 * production uses a simpler repair contract … The AI interprets the evidence. The old auditorScope export remains for
 * compatibility, but production no longer runs it or the separate departure keyword filter"; M709 left the final
 * review's scope with supported operations and ownership only, and docs/LEDGER_PIPELINE.md forbids replacing the
 * auditor's semantic judgment with new regex guards. What keeps his scene now is what the auditor is TOLD (asserted on the
 * request that really goes out), what an auditor that does as it is told writes, and the doors that still hold in code
 * whatever it answers. Runs the real auditor on a scripted model and the real ledger. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { HOUSES, withHouse, thinkingHouse } from './thinkinghouse.mjs';
import { db } from '../../js/store.js';
import { auditLedger } from '../../js/agents/auditor.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

/* what the auditor was sent, as one run of words */
const told = (house) => house.calls.map((c) => (c.body.messages || []).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n')).join('\n').replace(/\s+/g, ' ');
/* the final review's answer (M698–M712), as an auditor gives it */
const review = (more) => JSON.stringify({ scene: [], issues: [], review: { status: 'complete', why: 'every entry read against the newest page, to its end', open: [] }, standings: [], ...more });

test('M403-1 ONE AUDIT CANNOT EMPTY HIS SCENE: the auditor is told the ground is the page’s and silence is no leaving, and handed the page whole; as told, it moves no ground, takes no quiet captain out, and lands the leave the page shows — and in code, whatever it answers, he never leaves his own scene and nobody a leave takes out is nowhere', async () => {
  const PAGE = 'Zaraki grins across the sand. Across the yard, Lisa shuts her book and walks out through the east gate.';
  const seed = async () => {
    const s = await db.stories.create({ title: 'The courtyard' });
    await db.messages.append(s.id, { role: 'user', text: 'I step onto the sand.' });
    await db.messages.append(s.id, { role: 'assistant', text: PAGE });
    await saveState(s.id, applyMutations({ ...emptyState(), page: 12 }, [{ type: 'mc.set', name: 'Jovan Oda' }, { type: 'place.set', name: '10th Division HQ — training courtyard' },
      ...['Jovan Oda', 'Kenpachi Zaraki', 'Byakuya Kuchiki', 'Renji Abarai', 'Iba Tetsuzaemon', 'Lisa Yadōmaru'].map((n) => ({ type: 'presence.enter', name: n }))]).state);
    return s.id;
  };
  const id = await seed();
  const house = thinkingHouse({ answer: review({
    scene: [{ name: 'Kenpachi Zaraki', repair: false, ending: { position: 'across the sand, grinning', shown: 'Zaraki grins across the sand' } }],
    issues: [{ what: 'Lisa walked out through the east gate and is still listed here', fix: 'she is gone, through the east gate', pages: false,
      mutations: [{ type: 'presence.leave', name: 'Lisa Yadōmaru', shown: 'walks out through the east gate', to: 'beyond the east gate of the 10th Division HQ' }] }] }) });
  await withHouse(house, () => auditLedger({ connection: HOUSES[0].conn, storyId: id, brief: 'A Bleach story.' }));
  const words = told(house);
  for (const rule of ['set them only to what that line says, never to anything else',
    'When the latest page has NO header line and the ground or the hour on the ledger plainly disagrees with where and when that page stands, set them.',
    'Silence is not departure; mentioning a remote person is not presence.',
    'A quiet spectator remains present unless later events establish departure or a scene move.',
    'the page\'s own words that show them going, copied exactly']) assert(words.includes(rule), 'the auditor is told: ' + rule);
  assert(words.includes(PAGE), 'and is handed the newest page whole');
  let st = await loadState(id);
  eq(st.place.name, '10th Division HQ — training courtyard', 'the ground stays where the page has it');
  const here = st.present.map((p) => p.name);
  for (const n of ['Byakuya Kuchiki', 'Renji Abarai', 'Iba Tetsuzaemon', 'Kenpachi Zaraki']) assert(here.includes(n), n + ' is still here');
  assert(!here.includes('Lisa Yadōmaru'), 'Lisa, shown walking out, is gone');
  eq((st.offscreen['Lisa Yadōmaru'] || {}).location, 'beyond the east gate of the 10th Division HQ', 'and seated where she went');
  eq(Object.keys(st.offscreen || {}).filter((k) => /Byakuya|Renji|Iba/.test(k)).length, 0, 'nobody else "elsewhere"');
  /* the doors that hold in code, whatever the answer: he is never taken out of his own scene (M589), and whoever a leave
   * does take out is seated where they were last seen — never nowhere (M304) */
  const id2 = await seed();
  await withHouse(thinkingHouse({ answer: review({ issues: [{ what: 'they went to the assembly', fix: 'take them out', pages: false, mutations: [{ type: 'presence.leave', name: 'Jovan Oda' }, { type: 'presence.leave', name: 'Renji Abarai' }] }] }) }),
    () => auditLedger({ connection: HOUSES[0].conn, storyId: id2, brief: 'A Bleach story.' }));
  st = await loadState(id2);
  assert(st.present.some((p) => p.name === 'Jovan Oda'), 'he never steps out of his own scene');
  assert(st.offscreen['Renji Abarai'] && st.offscreen['Renji Abarai'].location === '10th Division HQ — training courtyard' && st.offscreen['Renji Abarai'].lastSeen, 'one a leave takes out is last seen where the scene stands, never nowhere: ' + JSON.stringify(st.offscreen['Renji Abarai']));
});
