/* Cozy Tavern — harness laws of M770. His (24 October 2026), with the housekeeper's thread pasted: "Why the housekeeper is so
 * stupid!! And always not doing the superseded command?? It should superseded when he updated something from the previous
 * one" — and "Why the current scene is not at the last line of page instead of middle like Emilia close to Jovan not
 * crouching". Each law runs the real housekeeper turn or the real page reader, its provider scripted at the wire, and fails
 * on m769-001. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { housekeeperTurn, loadSession } from '../../js/agents/housekeeper.js';
import { emptyState, headerMutations } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { extractTurn } from '../../js/agents/extractor.js';

const SECTION = '## Vampire Society & Hierarchy\nThe Sanguelis is the higher vampire council that rules the 7 Families.\n* Leadership: the council is headed by the Sanguine family.\n* Succession: a duel every 20 years; the Sanguine have held the seat for 300 years.';
const block = (ops) => '<brief>' + JSON.stringify(ops) + '</brief>';
async function talk(storyId, answers, writerText) {
  let n = 0;
  const call = async () => ({ text: answers[Math.min(n++, answers.length - 1)] });
  const t = await housekeeperTurn({ storyId, writerText, connection: { type: 'openai' }, call });
  assert(t.ok, t.error);
  return t;
}
const standing = (sess) => sess.turns.flatMap((t) => t.proposals || []).filter((p) => p.status === 'pending');
async function tale(title) {
  const st = await db.stories.create({ title });
  await db.stories.update(st.id, { brief: '' });
  await db.settings.set('hkAutoApply', false); /* his cards wait for Apply, as in his thread */
  return st;
}

test('M770-1 THE HOUSEKEEPER’S NEWER SECTION REPLACES ITS OLDER ONE (two appends of “## Vampire Society & Hierarchy” stood side by side; Apply all would have written the section twice, the wrong one first)', async () => {
  const was = await db.settings.get('hkAutoApply');
  try {
    const st = await tale('M770-1');
    await talk(st.id, [block([{ field: 'brief', append: SECTION, reason: 'his lore' }])], 'Add this to the brief: the Sanguelis…');
    const fixed = SECTION.replace('headed by the Sanguine family.', 'headed by whichever family wins the succession duel; any of the 7 can.');
    await talk(st.id, [block([{ field: 'brief', append: fixed, reason: 'the leadership put right' }])], 'No — any family can become the Sanguelis leader');
    const left = standing(await loadSession(st.id));
    eq(left.length, 1, 'one card stands: ' + left.map((p) => p.label).join(' | '));
    assert(left[0].op.append.includes('any of the 7 can'), 'the newer one');
  } finally { if (was === undefined) await db.settings.delete('hkAutoApply'); else await db.settings.set('hkAutoApply', was); }
});

test('M770-2 A CORRECTION OF ITS OWN WAITING CARD IS THAT CARD PUT RIGHT (refused as “it is empty — there is nothing to find”: the words were in its card, not yet in the brief)', async () => {
  const was = await db.settings.get('hkAutoApply');
  try {
    const st = await tale('M770-2');
    await talk(st.id, [block([{ field: 'brief', append: SECTION, reason: 'his lore' }])], 'Add this to the brief: the Sanguelis…');
    await talk(st.id, [block([{ field: 'brief', find: 'headed by the Sanguine family.', replace: 'headed by whichever family wins the succession duel.', reason: 'any family can lead' }])], 'No sanguine is the head because they won duel');
    const left = standing(await loadSession(st.id));
    eq(left.length, 1, 'one card stands: ' + left.map((p) => p.label + ' ' + p.status).join(' | '));
    assert(left[0].op.append.includes('headed by whichever family wins the succession duel.') && !left[0].op.append.includes('headed by the Sanguine family.'), 'the section with the leadership put right: ' + left[0].op.append);
    const sess = await loadSession(st.id);
    assert(!sess.turns.flatMap((t) => t.proposals || []).some((p) => p.status === 'refused'), 'and nothing refused');
  } finally { if (was === undefined) await db.settings.delete('hkAutoApply'); else await db.settings.set('hkAutoApply', was); }
});

test('M770-3 “group: Vampire Society & Hierarchy” WITHDRAWS THE CARDS THAT CARRY IT IN THEIR NAMES; A DISMISSED CARD ALREADY SET ASIDE IS SAID SO', async () => {
  const was = await db.settings.get('hkAutoApply');
  try {
    const st = await tale('M770-3');
    await talk(st.id, [block([{ field: 'brief', append: SECTION, reason: 'his lore' }])], 'Add this to the brief: the Sanguelis…');
    const t = await talk(st.id, ['Withdrawn.\n<supersede>group: Vampire Society & Hierarchy</supersede>'], 'withdraw it');
    eq(standing(await loadSession(st.id)).length, 0, 'nothing stands: ' + t.reply);
    const id = (await loadSession(st.id)).turns.flatMap((x) => x.proposals || [])[0].id;
    await talk(st.id, ['Dismissing it.\n<dismiss>[{"ids":["' + id + '"],"reason":"obsolete"}]</dismiss>'], 'dismiss it');
    const said = (await loadSession(st.id)).turns.at(-1).text;
    assert(/Already settled/.test(said) && !/Unmatched IDs/.test(said), 'said as settled, not unmatched: ' + said);
  } finally { if (was === undefined) await db.settings.delete('hkAutoApply'); else await db.settings.set('hkAutoApply', was); }
});

/* ---------- the page's ending ---------- */
const CONN = { type: 'openai', baseUrl: 'https://fixture.example/v1', apiKey: 'fixture', model: 'fixture', preset: 'custom', contextSize: 200000, reasoning: { effort: 'off' } };
const sse = (v) => new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: JSON.stringify(v) } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
test('M770-4 WHERE SOMEONE ENDS IS WHERE THE PAGE LEAVES THEM (Emilia “crouching in front of Jovan” from the middle of the page; its last lines have her leaning close, her cold cheek nearly touching his)', async () => {
  const st = applyMutations({ ...emptyState(), page: 10 }, [{ type: 'mc.set', name: 'Jovan Wessex' }, { type: 'place.set', name: 'the Vermaine crypt' },
    { type: 'presence.enter', name: 'Jovan Wessex', position: 'on the floor' }, { type: 'presence.enter', name: 'Emilia Vermaine', position: 'by the door' }]).state;
  const PAGE = '[The Vermaine crypt — Friday, October 31, 2025 | 23:40 | cold stone | torn shirt | on the floor]\n\n'
    + 'Emilia Vermaine was crouching in front of Jovan, one hand flat on his chest where the ribs had broken.\n\n'
    + 'The bone knit under her palm with a sound like ice settling. Jovan dragged in a breath that did not tear.\n\n'
    + '"Better," he said.\n\n'
    + 'Emilia leaned close, her cold cheek nearly touching his. "Don\'t thank me yet," she whispered.';
  const asked = [];
  const was = globalThis.fetch;
  globalThis.fetch = async (_, o) => {
    const user = JSON.parse(o.body).messages.filter((m) => m.role === 'user').map((m) => String(m.content)).join('\n');
    asked.push(user);
    const late = /from earlier in the page/.test(user);
    return sse({ mutations: [{ type: 'mode.snapshot', flags: ['intimate'] }], brief: { pressure: [], ripe: [], twb: null }, deltas: [],
      here: [{ name: 'Jovan Wessex', position: 'on the floor', shown: 'Jovan dragged in a breath that did not tear' },
        late ? { name: 'Emilia Vermaine', position: 'leaning close to Jovan, her cold cheek nearly touching his', shown: 'Emilia leaned close, her cold cheek nearly touching his' }
          : { name: 'Emilia Vermaine', position: 'crouching in front of Jovan', shown: 'Emilia Vermaine was crouching in front of Jovan' }] });
  };
  let read;
  try { read = await extractTurn({ connection: CONN, state: st, userText: 'I let her heal me.', assistantText: PAGE, pageNumber: 11, before: [] }); } finally { globalThis.fetch = was; }
  const after = applyMutations({ ...st, page: 11 }, [...headerMutations(PAGE, { ground: 'the Vermaine crypt', day: '' }), ...read.mutations]).state;
  const emilia = after.present.find((p) => p.name === 'Emilia Vermaine');
  eq(emilia.position, 'leaning close to Jovan, her cold cheek nearly touching his', 'as the page leaves her');
  eq(asked.length, 2, 'asked once more, with the page’s last words of her');
  assert(asked[1].includes('Emilia leaned close, her cold cheek nearly touching his'), 'those words are what it was handed');
});

test('M770-5 AN ENDING FROM THE LAST WORDS OF SOMEONE IS NOT ASKED AGAIN', async () => {
  const st = applyMutations({ ...emptyState(), page: 10 }, [{ type: 'mc.set', name: 'Jovan Wessex' }, { type: 'place.set', name: 'the Vermaine crypt' },
    { type: 'presence.enter', name: 'Jovan Wessex' }, { type: 'presence.enter', name: 'Emilia Vermaine' }]).state;
  const PAGE = '[The Vermaine crypt — Friday, October 31, 2025 | 23:40 | cold stone | torn shirt | on the floor]\n\nEmilia Vermaine was crouching in front of Jovan.\n\nJovan breathed.';
  let n = 0;
  const was = globalThis.fetch;
  globalThis.fetch = async () => { n += 1; return sse({ mutations: [{ type: 'mode.snapshot', flags: [] }], here: [{ name: 'Emilia Vermaine', position: 'crouching in front of Jovan', shown: 'Emilia Vermaine was crouching in front of Jovan' }] }); };
  try { await extractTurn({ connection: CONN, state: st, userText: 'I wait.', assistantText: PAGE, pageNumber: 11, before: [] }); } finally { globalThis.fetch = was; }
  eq(n, 1, 'one ask');
});

test('M770-6 THE SAME FAULT ON THE LORE SHELF: A NEW ENTRY OF ONE NAME PROPOSED AGAIN REPLACES THE ONE STILL WAITING', async () => {
  const was = await db.settings.get('hkAutoApply');
  try {
    const st = await tale('M770-6');
    const lore = (content) => '<lore>' + JSON.stringify([{ add: true, name: 'The Sanguelis', keys: ['Sanguelis'], content }]) + '</lore>';
    await talk(st.id, [lore('The council of the 7 Families, headed by the Sanguine.')], 'add a lore entry for the Sanguelis');
    await talk(st.id, [lore('The council of the 7 Families, headed by whichever family wins the duel.')], 'no — any family can lead');
    const left = standing(await loadSession(st.id));
    eq(left.length, 1, 'one entry waits: ' + left.map((p) => p.label).join(' | '));
    assert(/whichever family wins the duel/.test(left[0].op.content), 'the newer one');
  } finally { if (was === undefined) await db.settings.delete('hkAutoApply'); else await db.settings.set('hkAutoApply', was); }
});
