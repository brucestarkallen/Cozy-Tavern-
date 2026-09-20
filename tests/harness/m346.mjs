/* M346: canon verification — the writer's extension (Canon Grounding, vendored whole) runs inside Cozy on its
 * SillyTavern stand-in: the story's pages are its chat, Cozy's people ledger is its cast list, the wiki is asked
 * through fetch, and its note leads the storyteller's briefing. OFF sends nothing. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { canonBeforeSend, canonMetaKey, canonKnown, canonForget, setCanonWikis, ledgerOf, stChat } from '../../js/canon/bridge.js';
import { injectionFor } from '../../js/canon/host.js';
import { buildRequest } from '../../js/assemble/stack.js';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const asked = [];
const realFetch = globalThis.fetch;
function wikiFetch(url) {
  const u = new URL(String(url));
  asked.push(u.hostname + ' ' + (u.searchParams.get('titles') || u.searchParams.get('page') || u.searchParams.get('srsearch') || u.searchParams.get('list') || ''));
  const ok = (obj) => ({ ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) });
  if (u.hostname !== 'bleach.fandom.com') return ok({});
  const titles = u.searchParams.get('titles');
  const page = u.searchParams.get('page');
  const sr = u.searchParams.get('srsearch');
  if (u.searchParams.get('list') === 'recentchanges') return ok({ query: { recentchanges: [{ timestamp: '2026-09-01T00:00:00Z' }] } });
  if (sr) return ok({ query: { search: /rukia/i.test(sr) ? [{ title: 'Rukia Kuchiki' }] : [] } });
  if (titles) return /rukia/i.test(titles) ? ok({ query: { pages: { 7: { pageid: 7, title: 'Rukia Kuchiki' } } } }) : ok({ query: { pages: { '-1': { title: titles, missing: '' } } } });
  if (page && /rukia/i.test(page)) return ok({ parse: { title: 'Rukia Kuchiki', wikitext: { '*': "{{Infobox Character\n| name = Rukia Kuchiki\n| hair = Black, chin-length\n| eyes = Violet\n| height = 144 cm\n}}\n'''Rukia Kuchiki''' is a Shinigami of the Gotei 13.\n== Appearance ==\nRukia is a petite young woman with violet eyes and black hair.\n== Personality ==\nRukia is stern and proud, but caring toward her friends." } } });
  return ok({});
}

test('M346-1 CANON VERIFICATION IN COZY: the story is its chat, Cozy’s ledger its cast, the series’ wiki is asked, and what it keeps rides at the top of the writer’s briefing — labelled as his own notes, on the receipt as “What canon says”', async () => {
  globalThis.fetch = (url, opts) => (/fandom\.com|wiki\.gg/.test(String(url)) ? Promise.resolve(wikiFetch(url)) : realFetch(url, opts));
  try {
    const st = await db.stories.create({ title: 'Soul Society', brief: 'A Bleach story. Jovan, a new Shinigami, trains under Rukia Kuchiki.' });
    const story = await db.stories.get(st.id);
    await setCanonWikis('bleach');
    const state = applyMutations({ ...emptyState(), page: 2 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }]).state;
    state.characters = { 'Rukia Kuchiki': { core: 'Rukia, his instructor.', state: 'drilling him', threads: [] } };
    eq(JSON.stringify(Object.keys(ledgerOf(state)).sort()), JSON.stringify(['Jovan', 'Rukia Kuchiki']), 'Cozy’s ledger is the cast list it reads');
    const messages = [
      { id: 'u1', role: 'user', text: 'I bow to Rukia and ask her to teach me kido.' },
      { id: 'a1', role: 'assistant', text: 'Rukia Kuchiki folded her arms. "Again," she said.' },
      { id: 'u2', role: 'user', text: 'I try again, watching Rukia.' },
    ];
    eq(stChat(messages, { mc: 'Jovan', title: 'Soul Society' })[0].name, 'Jovan', 'his pages are his, by name');
    const note = await canonBeforeSend({ story, state, messages, connection: null });
    assert(asked.some((a) => /bleach\.fandom\.com/.test(a)), 'the series’ wiki was asked: ' + asked.join(' | '));
    assert(/Rukia/.test(note) && /(violet|Black, chin-length|petite)/i.test(note), 'the note carries what the wiki says of her: ' + note.slice(0, 400));
    eq(injectionFor(story.id), note, 'kept for this story');
    const meta = await db.settings.get(canonMetaKey(story.id));
    assert(meta && meta.canon_grounding_cache && Object.values(meta.canon_grounding_cache).some((e) => e && e.found && /Rukia/.test(e.name)), 'what it found is kept with the story');
    assert(!meta.summaryception, 'Cozy’s ledger is lent, never stored as the extension’s own');
    const known = await canonKnown(story.id);
    assert(known.some((k) => k.found && /Rukia/.test(k.name)), 'the Settings list sees it');
    const req = (canonNote) => buildRequest({ story, messages, settings: { tellerName: 'Iron Man', writerName: 'Bruce' }, state, modules: [], memory: '', cast: [], lore: '', loreFired: [], window: { keeperOn: false, window: 30, budgetTokens: 100000 }, directive: '', directorNote: '', editorEye: '', ruling: '', canonNote });
    const on = req(note);
    const briefing = on.messages.find((m) => /Bruce here/.test(String(m.content)));
    assert(briefing && /Rukia/.test(briefing.content), 'it rides in the writer’s briefing');
    const after = briefing.content.split('\n\n')[1] || '';
    assert(/Rukia|[Cc]anon/.test(after), 'at the top of his notes: ' + after.slice(0, 160));
    assert(!/'s note — canon/.test(briefing.content), 'its label is gone — it is his own notes here');
    assert((on.receipt.slots || []).some((s) => s.name === 'What canon says'), 'the receipt names it');
    if (process.env.SHOW_CANON) console.log('BRIEFING>>>\n' + briefing.content.slice(0, 1400));
    const off = req('');
    assert(!/Rukia Kuchiki is|violet/i.test(JSON.stringify(off.messages)) && !(off.receipt.slots || []).some((s) => s.name === 'What canon says'), 'no note, nothing of it');
    const key = known.find((k) => /Rukia/.test(k.name)).key;
    eq(await canonForget(story.id, key), true, 'forgotten by hand');
    assert(!(await canonKnown(story.id)).some((k) => k.key === key), 'and gone from the list');
  } finally {
    globalThis.fetch = realFetch;
  }
});
