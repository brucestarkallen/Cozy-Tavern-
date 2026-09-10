/* M45 — the founder: the ledger from the brief, the cast notes, the cards and the lore. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { buildFounderMessages, parseFounderAnswer, foundWorld, founderFingerprint, founderRunWords } from '../../js/agents/founder.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { WORKER_NAMES } from '../../js/agents/status.js';
import { WORKER_ROWS } from '../../js/agents/assign.js';
import { thinkingHouse, withHouse, HOUSES } from './thinkinghouse.mjs';

test('M45-1 the founder sees the brief, the cast notes, the cards and the lore; the law is stated-never-invented and sealed-is-sealed', () => {
  const p = buildFounderMessages({ state: emptyState(), brief: 'Jovan comes home. Aurora, his childhood friend, has loved him since school; nobody knows.', castNotes: 'Mira — his sister', cast: [{ name: 'Kris', description: 'The mother. Runs everything.', personality: 'iron', scenario: 'the house' }], lore: [{ name: 'The studio', keys: ['studio'], content: 'wants the story buried', enabled: true }, { name: 'Off', keys: ['x'], content: 'no', enabled: false }] });
  assert(p.hasMaterial);
  for (const k of ['STATED, NEVER INVENTED', 'THE REAL RECORD', 'SEALED IS SEALED', 'found the WORLD']) assert(p.system.includes(k), 'law: ' + k);
  assert(p.user.includes('has loved him since school') && p.user.includes('Mira — his sister') && p.user.includes('## Kris') && p.user.includes('Personality: iron') && p.user.includes('The studio [studio]'));
  assert(!p.user.includes('Off [x]'), 'a disabled lore entry is not material');
  assert(!buildFounderMessages({ state: emptyState() }).hasMaterial, 'nothing to found from');
  const r = parseFounderAnswer('```json\n{"mutations":[{"type":"people.set","name":"Aurora","field":"core","text":"childhood friend"},]}\n```');
  eq(r.note, 'ok'); eq(r.mutations.length, 1);
  const a = founderFingerprint({ brief: 'a' }); const b = founderFingerprint({ brief: 'b' });
  assert(a && b && a !== b && founderFingerprint({}) === '', 'the fingerprint tracks the material');
});

test('M45-2 end to end: pages, standings, locks, factions, seats, threads and knowledge stand before the first page; sealed stays sealed', async () => {
  const storyId = 'm45';
  await saveState(storyId, emptyState());
  const answer = JSON.stringify({ mutations: [
    { type: 'mc.set', name: 'Jovan' },
    { type: 'people.set', name: 'Aurora', field: 'core', text: 'childhood friend; lives next door; has loved him since school' },
    { type: 'people.set', name: 'Jovan', field: 'core', text: 'should be refused' },
    { type: 'rel.set', name: 'Aurora', p: 40, r: 30, s: 10, cause: 'the brief says she has loved him since school' },
    { type: 'canon.lock', name: 'Aurora', key: 'hair', value: 'black, waist-length' },
    { type: 'faction.set', name: 'the studio', stance: 'furious', agenda: 'bury the story' },
    { type: 'offscreen.set', name: 'Kris', location: 'the office', activity: 'on calls', agenda: 'keep it out of the papers', stance: 'busy' },
    { type: 'thread.set', title: 'Aurora and the unsaid', owner: 'Aurora', heat: 'hot', next: 'find a reason to knock' },
    { type: 'knowledge.add', name: 'Aurora', fact: 'has loved him since school' },
  ] });
  const house = thinkingHouse({ answer });
  const r = await withHouse(house, () => foundWorld({ connection: HOUSES[0].conn, storyId, brief: 'x', castNotes: '', cast: [], lore: [], stale: () => false }));
  eq(r.note, 'ok');
  eq(r.applied.length, 8, r.rejected.map((x) => x.why).join(' | '));
  eq(r.rejected.length, 1, 'the main character’s core is refused');
  const st = await loadState(storyId);
  eq(st.sheet.playerName, 'Jovan');
  assert(st.characters.Aurora && /childhood friend/.test(st.characters.Aurora.core));
  assert(st.relationships.Aurora && st.relationships.Aurora.p === 40);
  assert(st.canon.Aurora || st.canon.aurora, 'the lock stands');
  assert(st.factions['the studio']);
  assert(st.offscreen.Kris && st.offscreen.Kris.stance === 'busy');
  eq(st.threads[0].title, 'Aurora and the unsaid');
  assert(st.knowledge.Aurora && st.knowledge.Aurora.length === 1);
  assert(st.founded && st.founded.print, 'the fingerprint is kept');
  assert(/founded the world in 8 ways/.test(founderRunWords(r)), founderRunWords(r));
  assert(st.log.some((l) => /Aurora/.test(l.words)), 'logged — take-back-able');
});

test('M45-3 the house runs the founder first, once per material, and by hand', () => {
  const chat = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  assert(chat.indexOf("enqueue('founder'") < chat.indexOf("enqueue('extractor'"), 'before the extractor');
  assert(/if \(st\.founded && st\.founded\.print === print && !refound\) return \{ silent: true \};/.test(chat), 'once per material');
  assert(/async function foundNow\(\)/.test(chat) && /foundNow,/.test(chat));
  assert(WORKER_NAMES[0] === 'founder' && WORKER_ROWS[0][0] === 'founder');
  const drawer = readFileSync(new URL('../../js/ui/drawer.js', import.meta.url), 'utf8');
  assert(/Found the world from the brief/.test(drawer));
  const sw = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
  assert(sw.includes("'js/agents/founder.js'"));
});

test('M45-4 AXIS LOCK: the founder refuses a standing whose cause is about anyone but the main character', async () => {
  const storyId = 'm45-lock';
  await saveState(storyId, emptyState());
  const answer = JSON.stringify({ mutations: [
    { type: 'mc.set', name: 'Jovan' },
    { type: 'rel.set', name: 'Rias', p: 85, r: 65, s: 45, cause: 'the brief says Rias is devoted to Jovan, a childhood kiss only she remembers' },
    { type: 'rel.set', name: 'Caleb', p: 35, r: 45, s: 30, cause: 'the brief says Caleb is Rias’s possessive ex who wants answers' },
    { type: 'rel.set', name: 'Alaric', p: 50, r: 60, s: 25, cause: 'a romantic crush on Rias' },
    { type: 'people.set', name: 'Caleb', field: 'core', text: 'Rias’s ex; still possessive; wants answers' },
  ] });
  const house = thinkingHouse({ answer });
  const r = await withHouse(house, () => foundWorld({ connection: HOUSES[0].conn, storyId, brief: 'x', stale: () => false }));
  const st = await loadState(storyId);
  assert(st.relationships.Rias && st.relationships.Rias.p === 85, 'a bond with the main character stands');
  assert(!st.relationships.Caleb && !st.relationships.Alaric, 'feelings for Rias are not standings toward Jovan');
  eq(r.rejected.filter((x) => /toward the main character only/.test(x.why)).length, 2);
  assert(st.characters.Caleb && /possessive/.test(st.characters.Caleb.core), 'the feeling lives in the page as words');
  const p = buildFounderMessages({ state: emptyState(), brief: 'x' });
  assert(/AXIS LOCK/.test(p.system) && /never as numbers/.test(p.system));
  const aud = readFileSync(new URL('../../js/agents/auditor.js', import.meta.url), 'utf8');
  assert(/AXIS LOCK: a standing exists only TOWARD THE MAIN CHARACTER/.test(aud), 'the auditor zeroes the ones already written');
});
