/* M389: the audit's fixes — a tale's canon memory and sensor readings are the tale's rows (never the house book's, swept
 * with the tale); one reader of a wiki name for every box; a face his brief describes keeps canon's Appearance out from
 * the very first page; the opening words say whose story wins. Each runs the real code. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { wikiName, ledgerOf, canonBeforeSend, canonAction, canonMetaKey, CANON_HEADER } from '../../js/canon/bridge.js';
import { emptyState, saveState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

test('M389-1 A TALE’S CANON MEMORY AND ITS SENSOR READINGS ARE THE TALE’S: they ride its book, never the house’s; a gone tale’s are swept; they go with the tale', async () => {
  const tale = await db.stories.create({ title: 'a tale with canon' });
  await db.settings.set('canonMeta:' + tale.id, { canon_grounding_wiki: 'bleach' });
  await db.settings.set('sensors:' + tale.id, { readings: [] });
  await db.settings.set('canonMeta:a-tale-long-gone', { canon_grounding_wiki: 'onepiece' });
  await db.settings.set('sensors:a-tale-long-gone', { readings: [] });
  const bookKeys = JSON.parse(await db.exportStory(tale.id)).settings.map((r) => r.key);
  assert(bookKeys.includes('canonMeta:' + tale.id) && bookKeys.includes('sensors:' + tale.id), 'they ride the tale’s book: ' + bookKeys.join(', '));
  const houseKeys = JSON.parse(await db.exportHouse()).settings.map((r) => r.key);
  for (const k of ['canonMeta:' + tale.id, 'sensors:' + tale.id, 'canonMeta:a-tale-long-gone', 'sensors:a-tale-long-gone']) assert(!houseKeys.includes(k), 'never the house book: ' + k);
  await db.sweepOrphans();
  let keys = await db.settings.keys();
  assert(!keys.includes('canonMeta:a-tale-long-gone') && !keys.includes('sensors:a-tale-long-gone'), 'a gone tale’s are swept');
  assert(keys.includes('canonMeta:' + tale.id) && keys.includes('sensors:' + tale.id), 'a living tale’s stand');
  await db.stories.remove(tale.id);
  keys = await db.settings.keys();
  assert(!keys.includes('canonMeta:' + tale.id) && !keys.includes('sensors:' + tale.id), 'and they go with the tale');
});

test('M389-2 ONE READER OF A WIKI NAME: a bare name, a pasted Fandom address, a wiki.gg host with a page path — the same name, in both boxes', async () => {
  eq(wikiName('https://Bleach.fandom.com/wiki/Rukia_Kuchiki'), 'bleach', 'a pasted Fandom page');
  eq(wikiName(' terraria.wiki.gg/wiki/Main_Page '), 'terraria.wiki.gg', 'a wiki.gg host keeps its host, drops the page');
  eq(wikiName('highschooldxd, https://naruto.fandom.com/'), 'highschooldxd,naruto', 'several, with commas');
  eq(wikiName(''), '', 'nothing is nothing');
  const st = await db.stories.create({ title: 'wiki box' });
  const story = await db.stories.get(st.id);
  const state = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Jovan' }]).state;
  const w = await canonAction({ story, state, messages: [], connection: null }, 'wiki', 'https://terraria.wiki.gg/wiki/Guide');
  eq(w.binding, 'terraria.wiki.gg', 'the story’s box binds the host, never a page path');
});

test('M389-3 HIS BRIEF’S FACE IS HIS FROM THE FIRST PAGE: a face the brief describes gets no canon Appearance line before the founder has locked it; a face the brief is silent on still does; the opening words say our story wins', async () => {
  const realFetch = globalThis.fetch;
  const WT = "{{Infobox Character\n| name = Rukia Kuchiki\n| hair = Black, chin-length\n| eyes = Violet\n}}\n'''Rukia Kuchiki''' is a Shinigami.\n== Appearance ==\nRukia is a petite young woman with violet eyes and black hair.";
  globalThis.fetch = async (url, opts) => {
    if (!/fandom\.com|wiki\.gg/.test(String(url))) return realFetch(url, opts);
    const u = new URL(String(url)); const ok = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
    const t = u.searchParams.get('titles'), p = u.searchParams.get('page'), sr = u.searchParams.get('srsearch');
    if (u.searchParams.get('list') === 'recentchanges') return ok({ query: { recentchanges: [{ timestamp: '2026-09-01T00:00:00Z' }] } });
    if (sr) return ok({ query: { search: /rukia/i.test(sr) ? [{ title: 'Rukia Kuchiki' }] : [] } });
    if (t) return /rukia/i.test(t) ? ok({ query: { pages: { 7: { pageid: 7, title: 'Rukia Kuchiki' } } } }) : ok({ query: { pages: { '-1': { title: t, missing: '' } } } });
    if (p && /rukia/i.test(p)) return ok({ parse: { title: 'Rukia Kuchiki', wikitext: { '*': WT } } });
    return ok({});
  };
  try {
    const run = async (title, brief) => {
      const st = await db.stories.create({ title });
      await db.stories.update(st.id, { brief });
      const story = await db.stories.get(st.id);
      await db.settings.set(canonMetaKey(story.id), { canon_grounding_wiki: 'bleach', canon_grounding_wiki_ok: { wikis: 'bleach', name: title, fp: '(manual)', manual: true, ts: Date.now() } });
      const state = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }]).state;
      state.characters = { 'Rukia Kuchiki': { core: 'x', state: 'here', threads: [] } };
      await saveState(story.id, state);
      const marks = ledgerOf(state, { brief });
      const note = await canonBeforeSend({ story, state, messages: [{ id: 'u1', role: 'user', text: 'I bow to Rukia.' }], connection: null });
      return { marks, note };
    };
    const au = await run('AU face', 'A Bleach story where Rukia Kuchiki has silver hair, cut short.');
    eq((au.marks['Rukia Kuchiki'].holds || []).join(), 'appearance', 'the ledger tells the note her face is his brief’s');
    assert(/Rukia Kuchiki:/.test(au.note) && !/Appearance:/.test(au.note), 'page one: no canon face beside his silver hair: ' + au.note.slice(0, 400));
    const plain = await run('Canon face', 'A Bleach story. Jovan trains under Rukia Kuchiki.');
    assert(!plain.marks['Rukia Kuchiki'].holds, 'a brief silent on her face claims nothing');
    assert(/Appearance:/.test(plain.note) && /violet/i.test(plain.note), 'and page one says canon’s face');
    assert(/where our story has made something otherwise, our story wins/.test(CANON_HEADER) && plain.note.startsWith(CANON_HEADER), 'the opening words say whose story wins');
  } finally { globalThis.fetch = realFetch; }
});
