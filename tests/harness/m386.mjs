/* M386: canon verification, whole — Who's here is its cast (named on the page or not), its opening words are the
 * writer's own, what the series says of a face lands in "What's true of them" (never over the brief or his hand, never
 * again once he lets it go), every lever of its panel runs for the story in hand, a branch keeps its canon, and the
 * workers told to write from the real record are handed it. Every test runs the feature: the real extension on its
 * stand-in, the real ledger engine, a wiki answered over fetch. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import {
  canonBeforeSend, canonAction, canonMetaKey, ledgerOf, canonLocks, canonSyncLedger, canonEntryFor, canonFeatures, carryCanonMemory,
  canonRecordFor, canonSettings, setCanonSetting, CANON_SETTINGS_KEY, CANON_HEADER, canonWikis, canonReady, canonMeta,
} from '../../js/canon/bridge.js';
import { buildRequest } from '../../js/assemble/stack.js';
import { emptyState, loadState, saveState } from '../../js/engine/state.js';
import { applyMutations, undoEntry, letGoMark } from '../../js/engine/apply.js';
import { buildScribeMessages } from '../../js/agents/scribe.js';
import { buildWorldMessages } from '../../js/agents/world.js';
import { buildAuditorMessages } from '../../js/agents/auditor.js';

const realFetch = globalThis.fetch;
const asked = [];
const RUKIA = "{{Infobox Character\n| name = Rukia Kuchiki\n| hair = Black, chin-length\n| eyes = Violet\n| height = 144 cm\n}}\n'''Rukia Kuchiki''' is a Shinigami of the Gotei 13 and the adopted sister of Byakuya Kuchiki.\n== Appearance ==\nRukia is a petite young woman with violet eyes and black hair.\n== Personality ==\nRukia is stern and proud, but caring toward her friends.\n== Relationships ==\n=== Byakuya Kuchiki ===\nRukia reveres her adoptive brother Byakuya and long mistook his distance for disdain.";
const BYAKUYA = "{{Infobox Character\n| name = Byakuya Kuchiki\n| hair = Black, long, worn with a kenseikan\n| eyes = Grey\n| height = 180 cm\n}}\n'''Byakuya Kuchiki''' is the captain of the 6th Division and head of the Kuchiki clan.\n== Appearance ==\nByakuya is a tall, slender man with grey eyes and long black hair.\n== Personality ==\nByakuya is aloof and bound by duty.\n== Relationships ==\n=== Rukia Kuchiki ===\nByakuya adopted Rukia to honour a promise to his late wife Hisana, and guards her from a distance.";
function wikiFetch(url) {
  const u = new URL(String(url));
  asked.push(u.hostname + ' ' + (u.searchParams.get('titles') || u.searchParams.get('page') || u.searchParams.get('srsearch') || u.searchParams.get('list') || ''));
  const ok = (obj) => ({ ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) });
  if (u.hostname !== 'bleach.fandom.com') return ok({});
  const titles = u.searchParams.get('titles');
  const page = u.searchParams.get('page');
  const sr = u.searchParams.get('srsearch');
  if (u.searchParams.get('list') === 'recentchanges') return ok({ query: { recentchanges: [{ timestamp: '2026-09-01T00:00:00Z' }] } });
  const who = (t) => (/rukia/i.test(t) ? 'Rukia Kuchiki' : /byakuya/i.test(t) ? 'Byakuya Kuchiki' : '');
  if (sr) return ok({ query: { search: who(sr) ? [{ title: who(sr) }] : [] } });
  if (titles) return who(titles) ? ok({ query: { pages: { 7: { pageid: 7, title: who(titles) } } } }) : ok({ query: { pages: { '-1': { title: titles, missing: '' } } } });
  if (page && !/\//.test(page) && who(page)) return ok({ parse: { title: who(page), wikitext: { '*': who(page) === 'Rukia Kuchiki' ? RUKIA : BYAKUYA } } });
  return ok({});
}
const withWiki = async (fn) => {
  globalThis.fetch = (url, opts) => (/fandom\.com|wiki\.gg/.test(String(url)) ? Promise.resolve(wikiFetch(url)) : realFetch(url, opts));
  try { return await fn(); } finally { globalThis.fetch = realFetch; }
};
const ledgerWith = (present, pages = {}) => {
  const st = applyMutations({ ...emptyState(), page: 2 }, [{ type: 'mc.set', name: 'Jovan' }, ...present.map((n) => ({ type: 'presence.enter', name: n }))]).state;
  st.characters = pages;
  return st;
};
async function freshStory(title, brief) {
  const st = await db.stories.create({ title });
  if (brief) await db.stories.update(st.id, { brief }); /* create() keeps a title only */
  const story = await db.stories.get(st.id);
  /* this story's wiki named, as the room's box does (a manual decree — no discovery call) */
  await db.settings.set(canonMetaKey(story.id), { canon_grounding_wiki: 'bleach', canon_grounding_wiki_ok: { wikis: 'bleach', name: title, fp: '(manual)', manual: true, ts: Date.now() } });
  return story;
}
const RUKIA_ENTRY = { name: 'Rukia Kuchiki', found: true, kind: 'character', wiki: 'bleach', aliases: ['Rukia'], ts: 1, sections: { identity: 'Rukia Kuchiki is a Shinigami.', physical: 'hair: Black, chin-length; eyes: Violet; height: 144 cm; notably: She is petite.', relationship: 'Byakuya Kuchiki (adoptive brother)' }, dossier: { identity: 'A Shinigami of the Gotei 13', facts: ['Adopted into the Kuchiki clan'] } };

test('M386-1 THE ENGINE: a truth the series gave fills only a gap, corrects only its own, and one he lets go stays gone — through the journal, the undo and a fold', async () => {
  let st = ledgerWith(['Rukia Kuchiki']);
  st = applyMutations(st, [{ type: 'canon.lock', name: 'Rukia Kuchiki', key: 'eyes', value: 'blue' }]).state; /* his own */
  let r = applyMutations(st, [{ type: 'canon.lock', name: 'Rukia Kuchiki', key: 'eyes', value: 'Violet', source: 'canon' }, { type: 'canon.lock', name: 'Rukia Kuchiki', key: 'hair', value: 'Black', source: 'canon' }]);
  eq(r.applied.length, 1, 'the series wrote only the gap');
  st = r.state;
  const facts = () => Object.fromEntries(st.canon['Rukia Kuchiki'].facts.map((f) => [f.key, f.value + (f.source ? '|' + f.source : '')]));
  eq(facts().eyes, 'blue', 'his eyes stand');
  eq(facts().hair, 'Black|canon', 'the series’ hair, marked as the series’');
  r = applyMutations(st, [{ type: 'canon.lock', name: 'Rukia Kuchiki', key: 'hair', value: 'Black, chin-length', source: 'canon' }]);
  eq(r.applied.length, 1, 'the series corrects its own truth');
  st = r.state;
  eq(st.canon['Rukia Kuchiki'].facts.filter((f) => f.key === 'hair').length, 1, 'corrected in place, BY KEY — never a second hair');
  eq(facts().hair, 'Black, chin-length|canon', 'the corrected words');
  eq(applyMutations(st, [{ type: 'canon.unlock', name: 'Rukia Kuchiki', key: 'eyes', source: 'canon' }]).applied.length, 0, 'the series never takes back his');
  /* he lets the series' hair go by hand */
  r = applyMutations(st, [{ type: 'canon.unlock', name: 'Rukia Kuchiki', key: 'hair' }]);
  st = r.state;
  assert(st.canonLetGo.includes(letGoMark('Rukia Kuchiki', 'hair')), 'the letting-go is remembered');
  eq(applyMutations(st, [{ type: 'canon.lock', name: 'Rukia Kuchiki', key: 'hair', value: 'Black', source: 'canon' }]).applied.length, 0, 'the series never writes it again');
  eq(applyMutations(st, [{ type: 'canon.lock', name: 'Rukia Kuchiki', key: 'hair', value: 'silver' }]).applied.length, 1, 'but his own hand still can');
  /* taking the unlock back brings the truth AND the series' right to it home */
  const idx = st.log.length - 1;
  const back = undoEntry(st, idx);
  assert(back && back.state, 'the unlock can be taken back');
  assert(!back.state.canonLetGo.includes(letGoMark('Rukia Kuchiki', 'hair')), 'the mark goes with it');
  assert(back.state.canon['Rukia Kuchiki'].facts.some((f) => f.key === 'hair' && f.source === 'canon'), 'the series’ hair is back');
  /* taking back the series' own lock is a letting-go too */
  let s2 = applyMutations(ledgerWith(['Rukia Kuchiki']), [{ type: 'canon.lock', name: 'Rukia Kuchiki', key: 'height', value: '144 cm', source: 'canon' }]).state;
  const took = undoEntry(s2, s2.log.length - 1);
  assert(took && took.state.canonLetGo.includes(letGoMark('Rukia Kuchiki', 'height')), 'a series lock taken back stays let go');
  /* copies never share the list with the caller */
  const before = st.canonLetGo.slice();
  applyMutations(st, [{ type: 'canon.lock', name: 'Rukia Kuchiki', key: 'skin', value: 'pale', source: 'canon' }, { type: 'canon.unlock', name: 'Rukia Kuchiki', key: 'skin' }]);
  eq(JSON.stringify(st.canonLetGo), JSON.stringify(before), 'the caller’s ledger is untouched by a copy’s letting-go');
  /* it survives a save and a load */
  const sid = (await db.stories.create({ title: 'let go, kept' })).id;
  await saveState(sid, st);
  assert((await loadState(sid)).canonLetGo.includes(letGoMark('Rukia Kuchiki', 'hair')), 'kept across a load');
});

test('M386-2 WHO IS WHO: the series’ Rias is never his Rias Wells; a bare first name answers only when nobody else could be meant; the brief speaks for the person it names', async () => {
  const rias = { name: 'Rias Gremory', found: true, kind: 'character', aliases: ['Rias'], sections: { physical: 'hair: Crimson; eyes: Blue-green' } };
  const cache = { rias };
  eq(canonEntryFor(cache, 'Rias Gremory', ['Rias Gremory', 'Rias Wells']).entry.name, 'Rias Gremory', 'her own name');
  eq(canonEntryFor(cache, 'Rias Wells', ['Rias Gremory', 'Rias Wells']), null, 'his Rias Wells is nobody in canon');
  eq(canonEntryFor(cache, 'Rias', ['Rias', 'Rias Wells']), null, 'a bare “Rias” beside Rias Wells answers to nobody');
  eq(canonEntryFor(cache, 'Rias', ['Rias', 'Jovan']).entry.name, 'Rias Gremory', 'alone, it is her');
  eq(canonEntryFor({ place: { name: 'Kuoh Academy', found: true, kind: 'place', sections: { physical: 'hair: x' } } }, 'Kuoh Academy', []), null, 'a place has no face');
  eq(JSON.stringify(canonFeatures({ sections: { physical: 'hair: Crimson; eyes: Blue-green; height: 172 cm; notably: She has a beauty mark.' } })),
    JSON.stringify({ hair: 'Crimson', eyes: 'Blue-green', height: '172 cm', 'distinguishing features': 'She has a beauty mark.' }), 'the face, feature by feature');
  const st = ledgerWith(['Rias Gremory', 'Rias Wells'], { 'Rias Gremory': { core: 'x', state: 'here', threads: [] }, 'Rias Wells': { core: 'his sister', state: 'here', threads: [] } });
  const locks = canonLocks({ state: st, meta: { canon_grounding_cache: cache }, brief: 'Rias Wells has black hair and grey eyes. Rias Gremory keeps her eyes hidden behind dark glasses.' });
  eq(JSON.stringify(locks.map((m) => m.name + ':' + m.key).sort()), JSON.stringify(['Rias Gremory:hair']), 'his brief’s line about Rias Wells says nothing of Rias Gremory’s hair; the line naming Rias Gremory’s eyes keeps them his');
  assert(locks.every((m) => m.source === 'canon'), 'every lock is marked the series’');
});

test('M386-3 THE LEDGER HOLDS THE SERIES’ FACES: synced after a page, idempotent, withdrawn when blocked or forgotten, never over his hand', async () => {
  const story = await freshStory('Faces', 'A Bleach story.');
  const st = ledgerWith(['Rukia Kuchiki'], { 'Rukia Kuchiki': { core: 'his instructor', state: 'drilling him', threads: [] } });
  await saveState(story.id, st);
  const meta = await canonMeta(story.id);
  meta.canon_grounding_cache = { rukia: JSON.parse(JSON.stringify(RUKIA_ENTRY)) };
  const r = await canonSyncLedger(story);
  eq(r.applied.length, 4, 'hair, eyes, height and what marks her');
  const shelf = (await loadState(story.id)).canon['Rukia Kuchiki'].facts;
  eq(shelf.find((f) => f.key === 'eyes').value, 'Violet', 'her eyes as the series has them');
  eq((await canonSyncLedger(story)).applied.length, 0, 'a second sync changes nothing');
  meta.canon_grounding_block = 'Rukia Kuchiki';
  eq((await canonSyncLedger(story)).applied.length, 4, 'blocked: the series’ truths are withdrawn');
  eq(((await loadState(story.id)).canon['Rukia Kuchiki'] || { facts: [] }).facts.filter((f) => f.source === 'canon').length, 0, 'none of the series’ left');
  eq((await loadState(story.id)).canonLetGo.length, 0, 'a withdrawal is not his letting-go');
  meta.canon_grounding_block = '';
  await canonSyncLedger(story);
  let now = await loadState(story.id);
  now = applyMutations(now, [{ type: 'canon.lock', name: 'Rukia Kuchiki', key: 'eyes', value: 'amber' }]).state;
  await saveState(story.id, now);
  delete meta.canon_grounding_cache.rukia; /* forgotten */
  await canonSyncLedger(story);
  const left = (await loadState(story.id)).canon['Rukia Kuchiki'].facts;
  eq(JSON.stringify(left.map((f) => f.key + '=' + f.value)), JSON.stringify(['eyes=amber']), 'forgotten: the series’ truths go, his amber eyes stay');
});

test('M386-4 WHO’S HERE IS THE CAST: a canon person the ledger has in the scene rides with no name on the page, her pair with the other is resolved, and the words before it are his — no wiki, no note, no storyteller', async () => withWiki(async () => {
  const story = await freshStory('Kuchiki manor', 'A Bleach story. Jovan is a guest of the Kuchiki clan.');
  const state = ledgerWith(['Jovan', 'Rukia Kuchiki', 'Byakuya Kuchiki'], {
    'Rukia Kuchiki': { core: 'x', state: 'at the table', threads: [] }, 'Byakuya Kuchiki': { core: 'y', state: 'at the head of the table', threads: [] },
  });
  const marks = ledgerOf(state);
  assert(marks['Rukia Kuchiki'].present && marks['Byakuya Kuchiki'].present && marks.Jovan.present, 'Who’s here is marked in the ledger it is lent');
  const messages = [
    { id: 'u1', role: 'user', text: 'I sit down at the long table and bow.' },
    { id: 'a1', role: 'assistant', text: 'She pours the tea without a word. At the head of the table, he does not look up.' },
    { id: 'u2', role: 'user', text: 'I thank her for the tea.' },
  ];
  const note = await canonBeforeSend({ story, state, messages, connection: null });
  assert(/Rukia Kuchiki:/.test(note) && /Byakuya Kuchiki:/.test(note), 'both ride, though no page names them: ' + note.slice(0, 600));
  assert(/With Byakuya Kuchiki: .*adoptive brother/i.test(note) || /With Rukia Kuchiki: .*Hisana/i.test(note), 'who they are to each other, from the page itself: ' + note.slice(0, 900));
  assert(note.startsWith(CANON_HEADER), 'it opens with his words');
  const req = buildRequest({ story, messages, settings: { tellerName: 'Iron Man', writerName: 'Bruce', frameText: 'You are Iron Man, telling this story with Bruce.' }, state, modules: [], memory: '', cast: [], lore: '', loreFired: [], window: { keeperOn: false, window: 30, budgetTokens: 100000 }, directive: '', directorNote: '', editorEye: '', ruling: '', canonNote: note });
  const briefing = req.messages.find((m) => /Bruce here/.test(String(m.content)));
  eq(briefing.role, 'user', 'it rides in his own briefing — a user message');
  const canonPart = briefing.content.split('\n\n')[1] || '';
  assert(canonPart.startsWith('What canon says about the people here'), 'first in his notes: ' + canonPart.slice(0, 120));
  const opening = canonPart.split('\n')[0];
  assert(!/\bwiki\b|\bnote\b|storyteller|inject|grounding|verification|canon check|\brecord\b|\bsystem\b|\bprompt\b/i.test(opening), 'no machinery in its opening words: ' + opening);
  const ix = req.messages.indexOf(briefing);
  /* the frame rides as the system (the providers put systemBlocks on the wire's system); the briefing is the first
   * message after it, before every page of the story */
  assert(req.systemBlocks[0] && /You are Iron Man/.test(req.systemBlocks[0].text), 'the frame is the system');
  eq(ix, 0, 'after the frame, before every page');
}));

test('M386-5 EVERY LEVER, FOR THE STORY IN HAND: always here and never are one list each; the story’s wiki is a decree that lets another universe go; notes, the story position, forget, look again and the preview run the extension’s own functions', async () => withWiki(async () => {
  const story = await freshStory('Levers', 'A Bleach story.');
  const state = ledgerWith(['Jovan', 'Rukia Kuchiki'], { 'Rukia Kuchiki': { core: 'x', state: 'here', threads: [] } });
  await saveState(story.id, state);
  const messages = [{ id: 'u1', role: 'user', text: 'I greet Rukia.' }, { id: 'a1', role: 'assistant', text: 'Rukia nods.' }, { id: 'u2', role: 'user', text: 'I wait.' }];
  await canonBeforeSend({ story, state, messages, connection: null });
  const bundle = { story, state, messages, connection: null };
  await canonAction(bundle, 'always', { name: 'Byakuya Kuchiki', on: true });
  let meta = await db.settings.get(canonMetaKey(story.id));
  eq(meta.canon_grounding_pin_names, 'Byakuya Kuchiki', 'always here, kept with the story');
  await canonAction(bundle, 'never', { name: 'Byakuya Kuchiki', on: true });
  meta = await db.settings.get(canonMetaKey(story.id));
  eq(meta.canon_grounding_pin_names, '', 'moved out of always');
  eq(meta.canon_grounding_block, 'Byakuya Kuchiki', 'into never — never both');
  await canonAction(bundle, 'never', { name: 'Byakuya Kuchiki', on: false });
  /* the list may hold her under a shorter name: "Not always here" takes every name she answers to */
  await canonAction(bundle, 'always', { name: 'Rukia', on: true });
  const rk = Object.keys((await canonMeta(story.id)).canon_grounding_cache).find((k) => /rukia/i.test(k));
  await canonAction(bundle, 'always', { key: rk, name: 'Rukia Kuchiki', on: false });
  eq((await db.settings.get(canonMetaKey(story.id))).canon_grounding_pin_names, '', '“Rukia” leaves with Rukia Kuchiki');
  await canonAction(bundle, 'note', 'In our story, Rukia already knows Jovan’s secret.');
  const live = await canonMeta(story.id);
  live.canon_grounding_cache.intruder = { name: 'Intruder', found: true, wiki: 'onepiece', sections: { identity: 'x' }, ts: Date.now() };
  const w = await canonAction(bundle, 'wiki', 'Bleach.fandom.com');
  eq(w.binding, 'bleach', 'the box takes a wiki as he pastes it');
  assert(w.verified && w.verified.manual, 'a decree for this story');
  assert(!(await canonMeta(story.id)).canon_grounding_cache.intruder, 'another universe’s find goes with the old wiki');
  const pv = await canonAction(bundle, 'preview');
  assert(pv && /Rukia Kuchiki:/.test(pv.note) && /already knows Jovan’s secret/.test(pv.note), 'the preview is the next page’s words, his note in them: ' + String(pv && pv.note).slice(0, 300));
  const rukiaKey = Object.keys((await canonMeta(story.id)).canon_grounding_cache).find((k) => /rukia/i.test(k));
  const before = asked.length;
  const again = await canonAction(bundle, 'lookAgain', rukiaKey);
  assert(again && again.found && asked.length > before, 'looked up again, now');
  const key2 = Object.keys((await canonMeta(story.id)).canon_grounding_cache).find((k) => /rukia/i.test(k));
  eq(await canonAction(bundle, 'forget', key2), true, 'forgotten');
  assert(!Object.values((await canonMeta(story.id)).canon_grounding_cache).some((e) => e && /Rukia/.test(e.name || '')), 'and gone');
  const cleared = await canonAction(bundle, 'clearArc');
  eq(cleared, true, 'the story position can be let go');
}));

test('M386-6 A BRANCH KEEPS ITS CANON: the series and his decrees always; what the tracker derived from later pages only from the newest page', async () => {
  const from = (await db.stories.create({ title: 'trunk' })).id;
  const meta = {
    canon_grounding_cache: { rukia: RUKIA_ENTRY }, canon_grounding_wiki: 'bleach', canon_grounding_pin: 'his note', canon_grounding_pin_names: 'Rukia Kuchiki',
    canon_grounding_arc: { title: 'Soul Society arc', mode: 'begun' }, canon_grounding_arc_reached: ['Agent of the Shinigami arc'], canon_grounding_setting: 'seireitei',
    summaryception: { ledger: { lent: {} } },
  };
  await db.settings.set(canonMetaKey(from), meta);
  const tip = (await db.stories.create({ title: 'tip' })).id;
  eq(await carryCanonMemory(from, tip, { fromTheTail: true }), true, 'carried');
  const t = await db.settings.get(canonMetaKey(tip));
  assert(t.canon_grounding_cache.rukia && t.canon_grounding_wiki === 'bleach' && t.canon_grounding_pin === 'his note' && t.canon_grounding_arc && t.canon_grounding_setting === 'seireitei', 'from the newest page: all of it');
  assert(!t.summaryception, 'never the lent ledger');
  const old = (await db.stories.create({ title: 'old' })).id;
  await carryCanonMemory(from, old, { fromTheTail: false });
  const o = await db.settings.get(canonMetaKey(old));
  assert(o.canon_grounding_cache.rukia && o.canon_grounding_wiki === 'bleach' && o.canon_grounding_pin_names === 'Rukia Kuchiki', 'from an older page: the series and his decrees');
  assert(!o.canon_grounding_arc && !o.canon_grounding_arc_reached && !o.canon_grounding_setting, 'not the position the later pages reached');
  await db.settings.set(canonMetaKey(from), { ...meta, canon_grounding_arc: { title: 'Soul Society arc', mode: 'reached' } });
  const set = (await db.stories.create({ title: 'set' })).id;
  await carryCanonMemory(from, set, { fromTheTail: false });
  eq((await db.settings.get(canonMetaKey(set))).canon_grounding_arc.title, 'Soul Society arc', 'a position he set himself is his decree, and goes');
  eq(await carryCanonMemory((await db.stories.create({ title: 'none' })).id, (await db.stories.create({ title: 'n2' })).id), false, 'nothing to carry, nothing written');
});

test('M386-7 THE REAL RECORD REACHES THE WORKERS TOLD TO USE IT — and a story without canon sends them the very bytes it sent before', async () => {
  const meta = { canon_grounding_cache: { rukia: RUKIA_ENTRY } };
  const rec = canonRecordFor(meta, ['Rukia Kuchiki', 'Jovan']);
  assert(/^Rukia Kuchiki — A Shinigami of the Gotei 13\. Family and ties: Byakuya Kuchiki \(adoptive brother\)\. Also: Adopted into the Kuchiki clan\.$/.test(rec), 'her record: ' + rec);
  eq(canonRecordFor(meta, ['Jovan']), '', 'nobody canon, nothing');
  const state = ledgerWith(['Jovan', 'Rukia Kuchiki'], { 'Rukia Kuchiki': { core: 'x', state: 'here', threads: [] } });
  const scribe0 = buildScribeMessages({ state, userText: 'hi', assistantText: 'Rukia nods.', brief: 'B', castNotes: '' });
  const scribe1 = buildScribeMessages({ state, userText: 'hi', assistantText: 'Rukia nods.', brief: 'B', castNotes: '', canonRecord: rec });
  assert(scribe1.user.includes(rec) && !scribe0.user.includes('What the series itself says'), 'the scribe is handed it');
  eq(buildScribeMessages({ state, userText: 'hi', assistantText: 'Rukia nods.', brief: 'B', castNotes: '', canonRecord: '' }).user, scribe0.user, 'without it, byte for byte as before');
  const world1 = buildWorldMessages({ state, userText: 'hi', assistantText: 'Rukia nods.', brief: 'B', canonRecord: rec });
  const world0 = buildWorldMessages({ state, userText: 'hi', assistantText: 'Rukia nods.', brief: 'B' });
  assert(world1.user.includes(rec) && !world0.user.includes('WHAT THE SERIES ITSELF SAYS'), 'the world agent is handed it');
  const aud1 = buildAuditorMessages({ state, brief: 'B', record: '', pages: [], pageCount: 0, canonRecord: rec });
  const aud0 = buildAuditorMessages({ state, brief: 'B', record: '', pages: [], pageCount: 0 });
  assert(aud1.user.includes(rec) && !aud0.user.includes('WHAT THE SERIES ITSELF SAYS'), 'the auditor is handed it');
});

test('M386-8 SETTINGS ARE THE EXTENSION’S OWN, LIVE: a switch changed is in force on the next page (no refresh) and kept in the store; its shipped example wiki is never a choice he made', async () => withWiki(async () => {
  await canonReady();
  const s = await canonSettings();
  const was = s.physical;
  try {
    const story = await freshStory('Live settings', 'A Bleach story.');
    const state = ledgerWith(['Jovan', 'Rukia Kuchiki'], { 'Rukia Kuchiki': { core: 'x', state: 'here', threads: [] } });
    const messages = [{ id: 'u1', role: 'user', text: 'I look at Rukia.' }, { id: 'a1', role: 'assistant', text: 'Rukia looks back.' }, { id: 'u2', role: 'user', text: 'I smile.' }];
    await setCanonSetting('physical', true);
    const withFace = await canonBeforeSend({ story, state, messages, connection: null });
    assert(/Appearance:/.test(withFace), 'her face rides: ' + withFace.slice(0, 400));
    await setCanonSetting('physical', false);
    /* M457: each story keeps its own canon settings — the change is kept in THIS story's store at once */
    eq((await db.settings.get(CANON_SETTINGS_KEY + ':' + story.id)).physical, false, 'kept in the story’s own store at once');
    const noFace = await canonBeforeSend({ story, state, messages: [...messages, { id: 'a2', role: 'assistant', text: 'Rukia waits.' }, { id: 'u3', role: 'user', text: 'I bow.' }], connection: null });
    assert(/Rukia Kuchiki:/.test(noFace) && !/Appearance:/.test(noFace), 'switched off, the next page has no face lines: ' + noFace.slice(0, 400));
    assert(s.cozyStamp386 === true && String(s.wikis || '').toLowerCase() !== 'the-eminence-in-shadow', 'the author’s example wiki is not a default here');
    eq(s.enabled, true, 'one switch — Cozy’s');
    assert(typeof (await canonWikis()) === 'string', 'the global first-look wiki reads');
  } finally { await setCanonSetting('physical', was); }
}));

test('M386-9 OFF SENDS NOTHING OF IT: the series’ truths leave the ledger (journaled, never a letting-go of his), a turn that may not write leaves them out of its copy, and switched on again they come back', async () => {
  const { canonWithdraw, withoutCanonTruths } = await import('../../js/canon/bridge.js');
  const story = await freshStory('Off', 'A Bleach story.');
  let st = ledgerWith(['Rukia Kuchiki'], { 'Rukia Kuchiki': { core: 'x', state: 'here', threads: [] } });
  st = applyMutations(st, [
    { type: 'canon.lock', name: 'Rukia Kuchiki', key: 'eyes', value: 'Violet', source: 'canon' },
    { type: 'canon.lock', name: 'Rukia Kuchiki', key: 'mood', value: 'guarded' }, /* his own */
  ]).state;
  await saveState(story.id, st);
  const copy = withoutCanonTruths(st);
  eq(JSON.stringify(copy.canon['Rukia Kuchiki'].facts.map((f) => f.key)), JSON.stringify(['mood']), 'the copy keeps only his');
  eq(st.canon['Rukia Kuchiki'].facts.length, 2, 'the copy never touches the ledger it came from');
  const after = await canonWithdraw(story.id);
  assert(after, 'withdrawn');
  const kept = await loadState(story.id);
  eq(JSON.stringify(kept.canon['Rukia Kuchiki'].facts.map((f) => f.key)), JSON.stringify(['mood']), 'his truth stays, the series’ goes');
  eq(kept.canonLetGo.length, 0, 'switching off is not his letting-go');
  assert(kept.journal.some((j) => j.m && j.m.type === 'canon.unlock' && j.m.source === 'canon'), 'journaled — a branch folds it the same way');
  eq(await canonWithdraw(story.id), null, 'nothing left, nothing written');
  const meta = await canonMeta(story.id);
  meta.canon_grounding_cache = { rukia: JSON.parse(JSON.stringify(RUKIA_ENTRY)) };
  const back = await canonSyncLedger(story);
  assert(back.applied.some((a) => a.mutation.key === 'eyes'), 'on again: the next sync writes them back');
});

test('M386-10 ONE HOME FOR A FACT: once the ledger holds a canon face, the note leaves it there — every face word read once on the next page; his own truths come first on the shelf; his brief’s face keeps the canon look out; “How they look” off takes the series’ faces back; the scribe keeps pages true to the record without repeating it', async () => withWiki(async () => {
  const { FACTS_SHOWN } = await import('../../js/engine/canon.js');
  const { renderCanon } = await import('../../js/engine/canon.js');
  const story = await freshStory('One home', 'A Bleach story. Jovan is a guest at the Kuchiki manor.');
  let state = ledgerWith(['Jovan', 'Rukia Kuchiki', 'Byakuya Kuchiki'], {
    'Rukia Kuchiki': { core: 'Took Jovan on as her student.', state: 'pouring tea', threads: [] },
    'Byakuya Kuchiki': { core: 'Tolerates Jovan for Rukia’s sake.', state: 'at the head of the table', threads: [] },
  });
  await saveState(story.id, state);
  const m1 = [{ id: 'u1', role: 'user', text: 'I sit down at the long table.' }, { id: 'a1', role: 'assistant', text: 'She pours the tea. He does not look up.' }, { id: 'u2', role: 'user', text: 'I thank her.' }];
  const first = await canonBeforeSend({ story, state, messages: m1, connection: null });
  assert(/Rukia Kuchiki:[\s\S]*Appearance:/.test(first), 'page one: nothing holds her face yet, so the note says it');
  const r = await canonSyncLedger(story);
  assert(r.applied.length > 0, 'after the page, the faces go to the ledger');
  state = await loadState(story.id);
  const rk = state.canon['Rukia Kuchiki'].facts;
  assert(rk.some((f) => f.key === 'look' && /violet eyes/i.test(f.value) && f.source === 'canon'), 'her look lives with her face');
  assert(!rk.some((f) => f.key === 'eyes'), 'a feature the look already says in its own words is not a second line');
  assert(rk.some((f) => f.key === 'hair' && /chin-length/.test(f.value)), 'a feature the look does not say stays its own line');
  eq(ledgerOf(state)['Rukia Kuchiki'].holds.join(), 'appearance', 'the ledger tells the note it holds her face');
  const m2 = [...m1, { id: 'a2', role: 'assistant', text: 'She nods once.' }, { id: 'u3', role: 'user', text: 'I ask about the garden.' }];
  const second = await canonBeforeSend({ story, state, messages: m2, connection: null });
  assert(/Rukia Kuchiki:/.test(second) && !/Appearance:/.test(second), 'page two: the note leaves both faces to the ledger: ' + second.slice(0, 500));
  const req = buildRequest({ story, messages: m2, settings: { tellerName: 'Iron Man', writerName: 'Bruce', frameText: 'You are Iron Man.' }, state, modules: [], memory: '', cast: [], lore: '', loreFired: [], window: { keeperOn: false, window: 30, budgetTokens: 100000 }, directive: '', directorNote: '', editorEye: '', ruling: '', canonNote: second });
  const all = [...req.systemBlocks.map((b) => b.text), ...req.messages.map((m) => String(m.content))].join('\n');
  for (const [w, re] of [['violet', /violet/gi], ['144 cm', /144 cm/g], ['grey', /grey/gi], ['180 cm', /180 cm/g], ['kenseikan', /kenseikan/g]]) eq((all.match(re) || []).length, 1, '“' + w + '” is read once');
  /* the writer's own truth, written after the series filled her shelf, is never the one the cap cuts */
  let s2 = applyMutations(state, [1, 2, 3, 4, 5].map((i) => ({ type: 'canon.lock', name: 'Rukia Kuchiki', key: 'canon ' + i, value: 'v' + i, source: 'canon' }))).state;
  s2 = applyMutations(s2, [{ type: 'canon.lock', name: 'Rukia Kuchiki', key: 'mood', value: 'guarded' }]).state;
  assert(s2.canon['Rukia Kuchiki'].facts.length > FACTS_SHOWN, 'more than the shelf shows');
  assert(/Rukia Kuchiki — mood: guarded/.test(renderCanon(s2.canon, ['Rukia Kuchiki'])), 'his truth shows first');
  assert(!ledgerOf(s2)['Rukia Kuchiki'].holds, 'a face the shelf cannot show whole stays in the note');
  /* his brief speaks to her face: the canon look stays out (it would contradict him in one line) */
  const aus = await freshStory('AU', 'A Bleach story where Rukia Kuchiki has silver hair.');
  await saveState(aus.id, ledgerWith(['Rukia Kuchiki'], { 'Rukia Kuchiki': { core: 'x', state: 'here', threads: [] } }));
  (await canonMeta(aus.id)).canon_grounding_cache = JSON.parse(JSON.stringify((await canonMeta(story.id)).canon_grounding_cache));
  await canonSyncLedger(aus);
  const af = (await loadState(aus.id)).canon['Rukia Kuchiki'].facts.map((f) => f.key);
  assert(!af.includes('hair') && !af.includes('look'), 'his silver hair is his; no canon look beside it: ' + af.join());
  /* his own hand on her face: no canon look beside it — and a look the series wrote before his hand spoke is taken back */
  const copyCache = async (id) => { (await canonMeta(id)).canon_grounding_cache = JSON.parse(JSON.stringify((await canonMeta(story.id)).canon_grounding_cache)); };
  const hand = await freshStory('Hand', 'A Bleach story.');
  await saveState(hand.id, applyMutations(ledgerWith(['Rukia Kuchiki'], { 'Rukia Kuchiki': { core: 'x', state: 'here', threads: [] } }), [{ type: 'canon.lock', name: 'Rukia Kuchiki', key: 'eyes', value: 'green' }]).state);
  await copyCache(hand.id);
  await canonSyncLedger(hand);
  const hf = (await loadState(hand.id)).canon['Rukia Kuchiki'].facts;
  assert(hf.some((f) => f.key === 'eyes' && f.value === 'green' && !f.source), 'his green eyes stand');
  assert(!hf.some((f) => f.key === 'look'), 'no canon look beside his hand: ' + hf.map((f) => f.key).join());
  const later = await freshStory('Hand later', 'A Bleach story.');
  await saveState(later.id, ledgerWith(['Rukia Kuchiki'], { 'Rukia Kuchiki': { core: 'x', state: 'here', threads: [] } }));
  await copyCache(later.id);
  await canonSyncLedger(later);
  assert((await loadState(later.id)).canon['Rukia Kuchiki'].facts.some((f) => f.key === 'look' && f.source === 'canon'), 'the series wrote her look');
  await saveState(later.id, applyMutations(await loadState(later.id), [{ type: 'canon.lock', name: 'Rukia Kuchiki', key: 'eyes', value: 'green' }]).state);
  await canonSyncLedger(later);
  const lf = (await loadState(later.id)).canon['Rukia Kuchiki'].facts;
  assert(!lf.some((f) => f.key === 'look') && lf.some((f) => f.key === 'eyes' && f.value === 'green'), 'once his hand speaks to her face, the canon look is taken back and his eyes stand: ' + lf.map((f) => f.key + '=' + f.value).join(' | '));
  /* "How they look" off: the series' faces are taken back */
  const was = (await canonSettings()).physical;
  try {
    await setCanonSetting('physical', false);
    await canonSyncLedger(story);
    const left = ((await loadState(story.id)).canon['Rukia Kuchiki'] || { facts: [] }).facts.filter((f) => f.source === 'canon');
    eq(left.length, 0, 'none of the series’ faces left');
  } finally { await setCanonSetting('physical', was); }
  /* the scribe: true to the record, never repeating it */
  const sc = buildScribeMessages({ state, userText: 'hi', assistantText: 'Rukia nods.', brief: 'B', castNotes: '', canonRecord: canonRecordFor(await canonMeta(story.id), ['Rukia Kuchiki']) });
  assert(/Keep every page true to it/.test(sc.user) && /do not repeat it on the pages/.test(sc.user), 'the scribe is told the division');
}));
