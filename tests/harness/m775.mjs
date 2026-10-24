/* Cozy Tavern — harness laws of M775. His (24 October 2026): "i asked to add characters and it said it's already being put
 * but in the end it's not being put. And everytime i ask for something the housekeeper must have brain of masterstoryteller
 * … and check there are no continuity issues"; "why … i need to send second message is there any continuity issues or not";
 * and the housekeeper's own words he pasted: "the live ledger shows this fact twice on his line; last batch removed one and
 * re-added one, netting no change". Each law runs the real housekeeper turn (its model scripted) or the real ledger, and
 * fails on m774-001. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { housekeeperTurn, loadSession, stageProposals, parseProtocol } from '../../js/agents/housekeeper.js';
import { emptyState, saveState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { samePersonName } from '../../js/engine/names.js';

const ledger = () => applyMutations({ ...emptyState(), sheet: { actors: {}, playerName: 'Jovan Wessex', playerAliases: [] } }, [
  { type: 'mc.set', name: 'Jovan Wessex' },
  { type: 'people.set', name: 'Marguerite Vermaine', field: 'core', text: 'Matriarch of House Vermaine, an Elder.' },
  { type: 'people.set', name: 'Emilia Vermaine', field: 'core', text: 'Eldest daughter of Marguerite.' }]).state;
async function tale(title, brief = '') {
  const st = await db.stories.create({ title });
  await db.stories.update(st.id, { brief });
  await db.messages.append(st.id, { role: 'user', text: 'I wait.' });
  await db.messages.append(st.id, { role: 'assistant', text: 'Marguerite Vermaine watched the door.' });
  await saveState(st.id, ledger());
  return st;
}
const pending = (sess) => sess.turns.flatMap((t) => t.proposals || []).filter((p) => p.status === 'pending');
const ADD = 'Making her.\n<ledits>[{"type":"people.set","name":"Celeste Vermaine","field":"core","text":"Marguerite\'s youngest daughter; bookish, sharp-tongued.","reason":"his idea"}]</ledits>';
const ADD_CHECKED = 'Making her, and seating her.\n<ledits>[{"type":"people.set","name":"Celeste Vermaine","field":"core","text":"Marguerite\'s youngest daughter; bookish, sharp-tongued.","reason":"his idea"},{"type":"offscreen.set","name":"Celeste Vermaine","location":"the Vermaine library","activity":"reading","reason":"a place in the world"}]</ledits>\nContinuity: held against the brief, 3 pages of the people, the pages — Emilia stays the eldest; clean.';

test('M775-1 THE FIRST ASK IS CHECKED: an answer that changes the story is held against the whole house before he sees it — he never has to ask “any continuity issues?”', async () => {
  const st = await tale('M775-1');
  const asked = [];
  const call = async ({ messages }) => { asked.push(String(messages[messages.length - 1].content)); return { text: asked.length === 1 ? ADD : ADD_CHECKED }; };
  const rounds = [];
  const t = await housekeeperTurn({ storyId: st.id, writerText: 'Add Celeste Vermaine, Marguerite’s youngest daughter', connection: { type: 'openai' }, call, onToken: (tok) => { if (tok && tok.channel === 'round') rounds.push(tok.why); } });
  assert(t.ok, t.error);
  eq(asked.length, 2, 'the answer, then its check');
  eq(rounds.join('|'), 'checking its changes against the whole story', 'what he watches says what the second round is');
  assert(/^\[CONTINUITY\][\s\S]*THE BRIEF and THE CAST NOTES first[\s\S]*"Continuity: …"/.test(asked[1]), 'the check: ' + asked[1].slice(0, 120));
  const cards = pending(await loadSession(st.id));
  eq(cards.length, 1, 'one card');
  eq(cards[0].op.mutations.map((m) => m.type).join(','), 'people.set,offscreen.set', 'the checked answer is the one staged — her page and her place');
  assert(/Continuity: held against/.test(t.reply), 'he reads what it held it against: ' + t.reply);
});

test('M775-2 “ALREADY THERE” IS CHECKED BY THE HOUSE: names he asked for that have no page are said back — named in the brief is not a page; a card still waiting is not applied', async () => {
  const st = await tale('M775-2', 'The Vermaine family: Marguerite, Emilia, and Celeste Vermaine, the youngest.');
  const before = await loadSession(st.id);
  before.turns.push({ role: 'housekeeper', text: 'x', ts: 1, proposals: [{ id: 'pw1', kind: 'ledit', label: 'people’s pages changes 1', status: 'pending', op: { mutations: [{ type: 'people.set', name: 'Lord Aurel Vermaine', field: 'core', text: 'Marguerite’s husband.' }] } }] });
  const { saveSession } = await import('../../js/agents/housekeeper.js');
  await saveSession(st.id, before);
  await db.settings.set('hkAutoApply', false);
  const asked = [];
  const answers = ['Celeste Vermaine and Lord Aurel Vermaine are already in the story — nothing to add.', ADD_CHECKED];
  const call = async ({ messages }) => { asked.push(String(messages[messages.length - 1].content)); return { text: answers[Math.min(asked.length - 1, 1)] }; };
  try {
    const t = await housekeeperTurn({ storyId: st.id, writerText: 'Add Celeste Vermaine and Lord Aurel Vermaine as characters', connection: { type: 'openai' }, call });
    assert(t.ok, t.error);
    const check = asked.find((c) => /^\[CONTINUITY\]/.test(c)) || '';
    assert(/THE HOUSE CHECKED[\s\S]*- Celeste Vermaine: named in the brief — a name there is not a page/.test(check), 'Celeste: ' + check.slice(0, 600));
    assert(/- Aurel Vermaine: only in the card “people’s pages changes 1”, still waiting for the writer to apply it/.test(check), 'Aurel: ' + check.slice(0, 600));
    assert(!/- Marguerite/.test(check), 'never a name the ledger holds');
    assert(pending(await loadSession(st.id)).some((p) => p.op.mutations.some((m) => m.name === 'Celeste Vermaine')), 'and her page is made in the same ask');
  } finally { await db.settings.set('hkAutoApply', true); }
});

test('M775-3 A CHECK ANSWERED IN WORDS ALONE KEEPS THE CARDS IT WAS ASKED TO HOLD', async () => {
  const st = await tale('M775-3');
  let n = 0;
  const call = async () => { n += 1; return { text: n === 1 ? ADD : 'Continuity: held against the brief and 3 pages of the people; clean.' }; };
  const t = await housekeeperTurn({ storyId: st.id, writerText: 'Add Celeste Vermaine, Marguerite’s youngest daughter', connection: { type: 'openai' }, call });
  assert(t.ok, t.error);
  eq(n, 2);
  const cards = pending(await loadSession(st.id));
  eq(cards.length, 1, 'her card stands'); eq(cards[0].op.mutations[0].name, 'Celeste Vermaine');
  assert(/Making her\.[\s\S]*Continuity: held against/.test(t.reply), 'both words kept: ' + t.reply);
});

test('M775-4 A CARD WHOSE ENTRIES UNDO EACH OTHER CHANGES NOTHING: “removed one and re-added one, netting no change” is handed back in the same ask, and staged refused, never “landed”', async () => {
  const st = await tale('M775-4');
  const led = applyMutations(ledger(), [{ type: 'knowledge.add', name: 'Emilia Vermaine', fact: 'Jovan is a hunter' }]).state;
  await saveState(st.id, led);
  const NET_ZERO = 'Folding the twice-written fact.\n<ledits>[{"type":"knowledge.forget","name":"Emilia Vermaine","fact":"Jovan is a hunter","reason":"twice"},{"type":"knowledge.add","name":"Emilia Vermaine","fact":"Jovan is a hunter","reason":"once"}]</ledits>';
  const asked = [];
  const call = async ({ messages }) => { asked.push(String(messages[messages.length - 1].content)); return { text: NET_ZERO }; };
  const t = await housekeeperTurn({ storyId: st.id, writerText: 'Emilia knows Jovan is a hunter twice — fix it', connection: { type: 'openai' }, call });
  assert(t.ok, t.error);
  assert(asked.some((c) => /^\[CANNOT LAND\][\s\S]*undo each other/.test(c)), 'handed back: ' + asked.map((c) => c.slice(0, 50)).join(' | '));
  const staged = stageProposals(parseProtocol(NET_ZERO), { messages: [], state: led, modules: [], lore: [] });
  eq(staged[0].status, 'refused', 'staged refused');
  assert(/undo each other/.test(staged[0].words), staged[0].words);
  const real = stageProposals(parseProtocol('<ledits>[{"type":"knowledge.forget","name":"Emilia Vermaine","fact":"Jovan is a hunter","reason":"r"}]</ledits>'), { messages: [], state: led, modules: [], lore: [] });
  eq(real[0].status, 'pending', 'a forget alone is a change');
});

test('M775-5 A MAN’S TITLE AND A WOMAN’S NEVER NAME ONE PERSON: “Mistress Vermaine” was written over “Lord Vermaine”’s page', () => {
  eq(samePersonName('Mistress Vermaine', 'Lord Vermaine'), false, 'mistress / lord');
  eq(samePersonName('Mrs. Vermaine', 'Lord Vermaine'), false, 'mrs / lord');
  eq(samePersonName('Lady Ashford', 'Sir Ashford'), false, 'lady / sir');
  eq(samePersonName('Mistress Vermaine', 'Marguerite Vermaine'), true, 'the house’s mistress is still the woman of that name');
  eq(samePersonName('Mr. Wells', 'Tom Wells'), true, 'M646 holds');
  eq(samePersonName('Lady Rukia', 'Lieutenant Rukia Kuchiki'), true, 'M414 holds');
  const st = applyMutations(applyMutations(emptyState(), [{ type: 'people.set', name: 'Lord Vermaine', field: 'core', text: 'Marguerite’s husband.' }]).state,
    [{ type: 'people.set', name: 'Mistress Vermaine', field: 'core', text: 'The house’s mistress.', byHand: true }]).state;
  eq(st.characters['Lord Vermaine'].core, 'Marguerite’s husband.', 'his page untouched');
  assert(st.characters['Mistress Vermaine'], 'hers her own');
});

test('M775-6 AN ANSWER THAT CHANGES NOTHING IN THE STORY IS NOT CHECKED: a page folded away is one call', async () => {
  const st = await tale('M775-6');
  const pages = await db.messages.list(st.id);
  let n = 0;
  const call = async () => { n += 1; return { text: 'Folding it away.\n<edits>[{"id":"#' + pages[1].id.slice(0, 6) + '","hide":true,"reason":"he asked"}]</edits>' }; };
  const t = await housekeeperTurn({ storyId: st.id, writerText: 'hide the last page', connection: { type: 'openai' }, call });
  assert(t.ok, t.error); eq(n, 1, 'one call');
});
