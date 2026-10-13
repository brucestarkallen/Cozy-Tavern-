/* Cozy Tavern — harness laws of M514: a person with no page gets one (his word: "the people ledger on #story doesn't
 * fill up by itself — I have to rebuild the people"). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { buildScribeMessages } from '../../js/agents/scribe.js';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const opening = () => applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'Thirteenth barracks' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }, { type: 'presence.enter', name: 'Kenpachi Zaraki' }]).state;
const line = (user, head) => (user.split('\n').find((l) => l.startsWith(head)) || '');

test('M514-1 A PERSON WITH NO PAGE GETS ONE: on a #story opening the scribe is told, names first, who the ledger knows with no page (never the main character) and what to write — a core and a now; its law is in its instructions', () => {
  const m = buildScribeMessages({ state: opening(), userText: '#story Jovan joins the Thirteenth', assistantText: 'Rukia bowed. Zaraki grinned.' });
  eq(line(m.user, 'NO CHARACTER PAGE YET: ').split(' — ')[0], 'NO CHARACTER PAGE YET: Rukia Kuchiki, Kenpachi Zaraki', 'the names first, the main character not among them');
  /* M719: "unknown optional biography is not a missing fact" — a page holds the identity facts the originals establish, never
   * a biography owed by every temporary participant, and the now of whoever is here */
  assert(/record only identity facts the originals establish, with no compulsory biography for a temporary participant, and their state if they are in the scene\./.test(line(m.user, 'NO CHARACTER PAGE YET: ')), 'what to write');
  eq(line(m.user, 'IN THE SCENE WITH NO NOW YET'), '', 'not asked twice for the same people');
  /* M713: the main character's core may now hold the writer's own facts ("Founder and People can save ONLY original
   * writer-established MC biography") — what stays forbidden is inventing it; and M719 (identity by evidence): a unique
   * established role gets a page, a generic crowd extra none */
  assert(/A PERSON WITH NO PAGE GETS ONE/.test(m.system) && /Never the main\s+character’s invented nature\./.test(m.system) && /a generic unnamed crowd extra gets no page/.test(m.system), 'the law in its instructions');
});

test('M514-2 ON A LATER PAGE, ONLY THE NEW: someone with a page is not named again (a now still asked where it is missing); someone standing with the main character but not here counts as known; no page is named twice under two spellings', () => {
  let st = applyMutations(opening(), [{ type: 'people.note', name: 'Rukia Kuchiki', field: 'core', text: 'Lieutenant of the Thirteenth; formal.' }, { type: 'presence.enter', name: 'Shunsui Kyoraku' }]).state;
  st = { ...st, relationships: { ...(st.relationships || {}), 'Byakuya Kuchiki': { p: 10, r: 0, s: 0 } } };
  const m = buildScribeMessages({ state: st, userText: 'I greet Shunsui.', assistantText: 'Shunsui tipped his hat.' });
  const names = line(m.user, 'NO CHARACTER PAGE YET: ').replace('NO CHARACTER PAGE YET: ', '').split(' — ')[0].split(', ');
  eq(names.sort().join(' | '), ['Byakuya Kuchiki', 'Kenpachi Zaraki', 'Shunsui Kyoraku'].join(' | '), 'the new, and the one standing with him');
  assert(/IN THE SCENE WITH NO NOW YET[^\n]*Rukia Kuchiki/.test(m.user), 'Rukia has a page but no now: asked for her now');
  const withPages = applyMutations(st, ['Kenpachi Zaraki', 'Shunsui Kyoraku', 'Byakuya Kuchiki'].map((n) => ({ type: 'people.note', name: n, field: 'core', text: n + '.' }))).state;
  eq(line(buildScribeMessages({ state: withPages, userText: 'x', assistantText: 'y' }).user, 'NO CHARACTER PAGE YET'), '', 'everyone has a page: nothing asked');
});
