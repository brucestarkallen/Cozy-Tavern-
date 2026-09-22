/* M388: the old pages stop repeating canon — once each, never his hand, nothing added and nothing of the story lost
 * (held in code), journaled. Runs the real cleanup against a scripted worker and the real ledger engine. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { HOUSES, withHouse } from './thinkinghouse.mjs';
import { canonRepeats, cleanCoreHolds, canonTidyPeople, canonTidyWords } from '../../js/agents/canontidy.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { applyMutations, undoEntry } from '../../js/engine/apply.js';

const CONN = HOUSES[0].conn;
function scriptedHouse(answers) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url: String(url), body });
    const text = typeof answers === 'function' ? await answers(body) : answers[Math.min(calls.length - 1, answers.length - 1)];
    if (body.stream) {
      const lines = 'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n' + 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n';
      const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(lines)); c.close(); } });
      return { ok: true, status: 200, headers: new Headers(), body: stream, async json() { return {}; }, async text() { return lines; }, clone() { return this; } };
    }
    const obj = { choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }] };
    return { ok: true, status: 200, headers: new Headers(), async json() { return obj; }, async text() { return JSON.stringify(obj); }, clone() { return this; } };
  };
  return { calls, fetch: fetchImpl };
}

const RUKIA = { name: 'Rukia Kuchiki', found: true, kind: 'character', aliases: ['Rukia'], wiki: 'bleach', ts: 1,
  sections: { identity: 'Rukia Kuchiki is a Shinigami of the Gotei 13 and the adopted sister of Byakuya Kuchiki.', physical: 'hair: Black, chin-length; eyes: Violet; height: 144 cm', look: 'A petite young woman with violet eyes and black hair.', personality: 'Rukia is stern and proud, but caring toward her friends.' } };
const OLD = 'Rukia Kuchiki, a Shinigami of the Gotei 13 and Byakuya’s adopted sister; petite, black hair, violet eyes; stern and proud; took Jovan on as her student when no one else would.';
const CLEAN = 'Took Jovan on as her student when no one else would.';
const meta = () => ({ canon_grounding_cache: { rukia: JSON.parse(JSON.stringify(RUKIA)) } });
const ledger = (pages) => {
  const st = applyMutations({ ...emptyState(), page: 2 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }]).state;
  st.characters = pages;
  return st;
};

test('M388-1 WHICH PAGES REPEAT CANON: a core full of the record is found; a core of the story is not; his hand, a non-canon person and a core already asked about never are', async () => {
  const st = ledger({
    'Rukia Kuchiki': { core: OLD, state: 'here', threads: [] },
    'Rias Wells': { core: 'Jovan’s sister, a Shinigami-obsessed fan of black hair and violet eyes and pride.', state: 'home', threads: [] },
  });
  const found = canonRepeats(st, meta());
  eq(found.map((x) => x.name).join(), 'Rukia Kuchiki', 'her page repeats the record; his own Rias Wells is nobody in canon');
  assert(/Gotei 13/.test(found[0].record), 'the worker is shown the record itself');
  const story = ledger({ 'Rukia Kuchiki': { core: CLEAN, state: 'here', threads: [] } });
  eq(canonRepeats(story, meta()).length, 0, 'a core of the story is left alone');
  const hand = ledger({ 'Rukia Kuchiki': { core: OLD, state: 'here', threads: [], hand: { core: true } } });
  eq(canonRepeats(hand, meta()).length, 0, 'a core his hand wrote is his');
  const m = meta();
  m.cozy_canon_tidied = { 'Rukia Kuchiki': (() => { let h = 5381; for (let i = 0; i < OLD.length; i += 1) h = ((h << 5) + h + OLD.charCodeAt(i)) >>> 0; return OLD.length + ':' + h.toString(36); })() };
  eq(canonRepeats(st, m).length, 0, 'a core already asked about in these words is not asked again');
});

test('M388-2 THE ANSWER HOLDS THE PAGE, OR THE PAGE STAYS: nothing added, nothing of the story lost, and shorter', async () => {
  eq(cleanCoreHolds(OLD, CLEAN, RUKIA, 'Rukia Kuchiki').ok, true, 'the record out, the story kept');
  const invented = cleanCoreHolds(OLD, 'Took Jovan on as her student; she secretly loves him.', RUKIA, 'Rukia Kuchiki');
  assert(!invented.ok && /added/.test(invented.why), 'a word the page never had is refused: ' + invented.why);
  const lost = cleanCoreHolds(OLD, 'Took Jovan on.', RUKIA, 'Rukia Kuchiki');
  assert(!lost.ok && /dropped/.test(lost.why) && /student/.test(lost.why), 'a word of the story dropped is refused: ' + lost.why);
  eq(cleanCoreHolds(OLD, OLD, RUKIA, 'Rukia Kuchiki').ok, false, 'no change is no cleanup');
});

test('M388-3 ONCE, JOURNALED, NEVER HIS: the page is cleaned through the ledger (and can be taken back); asked once; a refused answer leaves the page; a page rewritten meanwhile is not touched', async () => {
  const sid = 'm388-a';
  await saveState(sid, ledger({ 'Rukia Kuchiki': { core: OLD, state: 'here', threads: [] }, 'Byakuya Kuchiki': { core: 'Mine, by hand: aloof.', state: 'x', threads: [], hand: { core: true } } }));
  const m = meta();
  let kept = 0;
  const house = scriptedHouse([JSON.stringify({ pages: [{ name: 'Rukia Kuchiki', core: CLEAN }] })]);
  const r = await withHouse(house, () => canonTidyPeople({ connection: CONN, storyId: sid, meta: m, keepMemo: async () => { kept += 1; } }));
  eq(r.applied.length, 1, 'one page cleaned');
  const after = await loadState(sid);
  eq(after.characters['Rukia Kuchiki'].core, CLEAN, 'what the story made of her stays; the record is gone');
  assert(!JSON.stringify(house.calls[0].body).includes('Mine, by hand'), 'his hand-written page was never sent');
  assert(kept >= 1 && m.cozy_canon_tidied['Rukia Kuchiki'], 'the memo is kept in the story’s canon memory');
  assert(/took what the series already says out of 1 page \(Rukia Kuchiki\)/.test(canonTidyWords(r)), 'the workers’ line says what it did: ' + canonTidyWords(r));
  const back = undoEntry(after, after.log.length - 1);
  assert(back && back.state.characters['Rukia Kuchiki'].core === OLD, 'journaled: it can be taken back');
  const again = scriptedHouse(['{"pages":[]}']);
  const r2 = await withHouse(again, () => canonTidyPeople({ connection: CONN, storyId: sid, meta: m }));
  eq(again.calls.length, 0, 'a cleaned page is not asked about again');
  eq(r2.asked, 0, 'nothing due');
  /* an answer that invents: refused, the page stays, and it is not asked again in the same words */
  const sid2 = 'm388-b';
  await saveState(sid2, ledger({ 'Rukia Kuchiki': { core: OLD, state: 'here', threads: [] } }));
  const m2 = meta();
  const bad = scriptedHouse([JSON.stringify({ pages: [{ name: 'Rukia Kuchiki', core: 'Took Jovan on as her student; she secretly loves him.' }] })]);
  const r3 = await withHouse(bad, () => canonTidyPeople({ connection: CONN, storyId: sid2, meta: m2 }));
  eq(r3.applied.length, 0, 'refused');
  eq((await loadState(sid2)).characters['Rukia Kuchiki'].core, OLD, 'the page stays as it was');
  eq(canonRepeats(await loadState(sid2), m2).length, 0, 'and is not asked again in the same words');
  /* the scribe rewrote the page while the cleanup read it: its answer is for words that are gone */
  const sid3 = 'm388-c';
  await saveState(sid3, ledger({ 'Rukia Kuchiki': { core: OLD, state: 'here', threads: [] } }));
  const racing = scriptedHouse(async () => {
    const st = await loadState(sid3);
    st.characters['Rukia Kuchiki'] = { ...st.characters['Rukia Kuchiki'], core: OLD + ' She owes Jovan a debt now.' };
    await saveState(sid3, st);
    return JSON.stringify({ pages: [{ name: 'Rukia Kuchiki', core: CLEAN }] });
  });
  const r4 = await withHouse(racing, () => canonTidyPeople({ connection: CONN, storyId: sid3, meta: meta() }));
  eq(r4.applied.length, 0, 'not applied over newer words');
  assert(/owes Jovan a debt/.test((await loadState(sid3)).characters['Rukia Kuchiki'].core), 'the newer words stand');
});
