/* M390: the audit, continued — a SillyTavern chat played with Canon Grounding comes home with its canon memory; the
 * room's "Forget everything it knows here" takes the series' faces out of the ledger with it; "where the scene is"
 * forgets. Each runs the real code. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { parseSTChat, importAsStory } from '../../js/import/chats.js';
import { canonAction, canonMeta, canonMetaKey, canonSyncLedger } from '../../js/canon/bridge.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const RUKIA = { name: 'Rukia Kuchiki', found: true, kind: 'character', wiki: 'bleach', aliases: ['Rukia'], ts: 1, rel: {},
  sections: { identity: 'Rukia Kuchiki is a Shinigami.', physical: 'hair: Black, chin-length; eyes: Violet; height: 144 cm' } };

test('M390-1 A SILLYTAVERN CHAT COMES HOME WITH ITS CANON: everyone it looked up, the wiki it was bound to, his pins, blocks, notes and story position — and a chat without any brings none', async () => {
  const head = { user_name: 'Jovan', character_name: 'Rukia', chat_metadata: {
    summaryception: { ledger: { Rukia: {} } },
    canon_grounding_cache: { rukia: RUKIA },
    canon_grounding_wiki: 'bleach',
    canon_grounding_wiki_ok: { wikis: 'bleach', name: 'Rukia', fp: '(manual)', manual: true, ts: 1 },
    canon_grounding_pin: 'In our story Rukia already knows Jovan’s secret.',
    canon_grounding_pin_names: 'Rukia Kuchiki',
    canon_grounding_block: 'Aizen',
    canon_grounding_arc: { title: 'Soul Society arc', summary: 'x', mode: 'reached', ts: 1 },
  } };
  const jsonl = [JSON.stringify(head), JSON.stringify({ name: 'Jovan', is_user: true, mes: 'I bow.', send_date: 1 }), JSON.stringify({ name: 'Rukia', is_user: false, mes: 'Again.', send_date: 2 })].join('\n');
  const parsed = parseSTChat(jsonl);
  eq(Object.keys(parsed.canon).sort().join(), 'canon_grounding_arc,canon_grounding_block,canon_grounding_cache,canon_grounding_pin,canon_grounding_pin_names,canon_grounding_wiki,canon_grounding_wiki_ok', 'its canon memory, and only that');
  const id = await importAsStory(parsed);
  const kept = await db.settings.get(canonMetaKey(id));
  assert(kept && kept.canon_grounding_cache.rukia.found && kept.canon_grounding_wiki === 'bleach' && kept.canon_grounding_pin_names === 'Rukia Kuchiki' && kept.canon_grounding_block === 'Aizen' && kept.canon_grounding_arc.title === 'Soul Society arc', 'kept as the story’s canon memory');
  assert(!kept.summaryception, 'never another extension’s ledger');
  eq((await db.messages.list(id)).length, 2, 'the pages came too');
  const bare = parseSTChat([JSON.stringify({ user_name: 'J', character_name: 'X', chat_metadata: {} }), JSON.stringify({ name: 'J', is_user: true, mes: 'hi', send_date: 1 })].join('\n'));
  assert(!('canon' in bare), 'a chat played without it brings nothing');
  const id2 = await importAsStory(bare);
  eq(await db.settings.get(canonMetaKey(id2)), undefined, 'and writes nothing');
});

test('M390-2 "FORGET EVERYTHING IT KNOWS HERE" TAKES THE SERIES’ FACES WITH IT; "where the scene is" forgets', async () => {
  const st = await db.stories.create({ title: 'forget all' });
  const story = await db.stories.get(st.id);
  const state = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Jovan' }, { type: 'presence.enter', name: 'Jovan' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }]).state;
  state.characters = { 'Rukia Kuchiki': { core: 'x', state: 'here', threads: [] } };
  await saveState(story.id, applyMutations(state, [{ type: 'canon.lock', name: 'Rukia Kuchiki', key: 'mood', value: 'guarded' }]).state);
  await db.settings.set(canonMetaKey(story.id), { canon_grounding_wiki: 'bleach', canon_grounding_wiki_ok: { wikis: 'bleach', name: 'x', fp: '(manual)', manual: true, ts: 1 }, canon_grounding_cache: { rukia: JSON.parse(JSON.stringify(RUKIA)) }, canon_grounding_setting: 'rukia' });
  await canonSyncLedger(story);
  assert((await loadState(story.id)).canon['Rukia Kuchiki'].facts.some((f) => f.source === 'canon'), 'her series face is in the ledger');
  const bundle = { story, state: await loadState(story.id), messages: [], connection: null };
  await canonAction(bundle, 'clearSetting');
  eq((await canonMeta(story.id)).canon_grounding_setting, '', 'where the scene is, forgotten');
  await canonAction(bundle, 'clearAll');
  eq(Object.keys((await canonMeta(story.id)).canon_grounding_cache || {}).length, 0, 'everything it looked up, forgotten');
  const facts = (await loadState(story.id)).canon['Rukia Kuchiki'].facts;
  eq(facts.filter((f) => f.source === 'canon').length, 0, 'the series’ faces went with it');
  assert(facts.some((f) => f.key === 'mood' && f.value === 'guarded'), 'his own truth stays');
});
