/* Cozy Tavern — harness laws of M551: ONE CHECK for what a helper wrote from memory about a canon — every kind of fact, in
 * the note "where our story began" and in the automatic brief's world, against everything the wiki says of the people
 * looked up (his question: "does this only fix the hierarchy? I can't have flex tape each time"). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { wikiMaterial, claimsAsk, readClaimsCheck, checkClaims, worldClaims, worldWithout, claimsPrint, CHECK_SYSTEM, PERSON_CHARS } from '../../js/agents/canoncheck.js';
import { startCheckAsk } from '../../js/agents/canonstart.js';

const META = { canon_grounding_cache: {
  'yamamoto': { found: true, name: 'Genryūsai Shigekuni Yamamoto', dossier: { name: 'Genryūsai Shigekuni Yamamoto', identity: 'the former Captain-Commander of the Gotei 13', brief: 'He was killed by Yhwach during the invasion of the Seireitei.', facts: ['He founded the Shin\u014d Academy.'] } },
  'kenpachi zaraki': { found: true, name: 'Kenpachi Zaraki', dossier: { name: 'Kenpachi Zaraki', identity: 'the captain of the 11th Division', abilities: ['Nozarashi, his Zanpakut\u014d, in Bankai'], related: [{ name: 'Yachiru Kusajishi', why: 'his lieutenant, the spirit of his sword' }] } },
  'rukia kuchiki': { found: true, name: 'Rukia Kuchiki', dossier: { name: 'Rukia Kuchiki', identity: 'the captain of the 13th Division', brief: 'She married Renji Abarai.' } },
  'gone': { found: false },
}, cozy_lens: { } };

test('M551-1 EVERYTHING THE WIKI SAYS, NOT ONE LINE: each looked-up person\'s identity, summary, facts, abilities and ties — the people the claims name first, the rest after, within the room; a name the wiki did not find is not there', () => {
  const m = wikiMaterial(META, { claims: 'Yamamoto still leads the Gotei 13 after the war.' });
  eq(m.length, 3, 'three found, one not');
  assert(/^Genryūsai Shigekuni Yamamoto — the former Captain-Commander of the Gotei 13; He was killed by Yhwach during the invasion of the Seireitei\.; He founded the Shinō Academy\./.test(m[0]), 'named first, and all of it: ' + m[0]);
  assert(m.some((l) => /Kenpachi Zaraki — the captain of the 11th Division; .*Nozarashi.*; Yachiru Kusajishi: his lieutenant/.test(l)), 'abilities and ties too');
  const tight = wikiMaterial(META, { claims: 'Rukia', room: 120 });
  assert(tight.length === 1 && /^Rukia Kuchiki/.test(tight[0]), 'a short room keeps the one the claims name');
  assert(wikiMaterial(META, {}).every((l) => l.length <= PERSON_CHARS), 'each held to its room');
  eq(wikiMaterial({}, { claims: 'x' }).length, 0, 'nothing looked up, nothing');
});

test('M551-2 EVERY KIND OF FACT IS ASKED ABOUT — rank, who leads, alive or dead, where, ties, powers, what has happened — with the story\'s moment, the wiki\'s summary of where it stands, and the same law: the wiki is the end; an earlier moment\'s difference is not wrong; silence is never wrong', () => {
  for (const kind of ['who is alive or dead', 'who is where', 'who is tied to or allied with whom', 'what someone can do', 'what has happened by then', 'who leads what']) assert(CHECK_SYSTEM.includes(kind), 'it checks ' + kind);
  const ask = claimsAsk({ moment: 'Bleach — after the war', claims: ['Yamamoto leads the Gotei 13.', 'Rukia is Renji\'s wife.'], material: ['M-LINE'], arc: { title: 'Aftermath', summary: 'ARC-SUMMARY' } });
  assert(ask.user.includes('WHERE THE STORY BEGINS: Bleach — after the war') && ask.user.includes('ARC-SUMMARY') && ask.user.includes('1. Yamamoto leads the Gotei 13.') && ask.user.includes('- M-LINE'), 'the moment, the arc, the facts, the wiki');
  assert(/that is NOT wrong/.test(ask.system) && /Never mark a fact wrong because the wiki does not mention it/.test(ask.system), 'the end, and silence');
  eq(startCheckAsk({ start: { series: 'Bleach', facts: ['x'] }, wiki: ['w'] }).system, CHECK_SYSTEM, 'the note is asked about by the very same check');
});

test('M551-3 THE WORLD\'S SENTENCES: the automatic brief is checked a sentence at a time — only the wrong ones go, a part left empty goes with them, the rest stand word for word; its fingerprint moves with its words and with the wiki', async () => {
  const parts = { factions: 'Yamamoto leads the Gotei 13 as Captain-Commander. The Quincy are scattered.', places: 'The Seireitei is being rebuilt.', standing: 'Yamamoto is alive.' };
  const claims = worldClaims(parts);
  eq(claims.map((c) => c.text).join(' | '), 'Yamamoto leads the Gotei 13 as Captain-Commander. | The Quincy are scattered. | The Seireitei is being rebuilt. | Yamamoto is alive.');
  const kept = worldWithout(parts, claims, [0, 3]);
  eq(JSON.stringify(kept), JSON.stringify({ factions: 'The Quincy are scattered.', places: 'The Seireitei is being rebuilt.' }), 'the wrong ones go; standing, emptied, goes');
  assert(claimsPrint(['a'], ['w']) !== claimsPrint(['a'], ['w', 'w2']) && claimsPrint(['a'], ['w']) !== claimsPrint(['b'], ['w']), 'a new word or a new wiki line: asked again');
  let asked = 0;
  const out = await checkClaims({ connection: { id: 'c' }, moment: 'Bleach — after the war', claims: claims.map((c) => c.text), material: wikiMaterial(META, {}), callLLM: async (c, { user, system }) => { asked += 1; assert(/killed by Yhwach/.test(user) && /alive or dead/.test(system), 'it reads what the wiki says of his death'); return { text: '{"wrong":[1,4]}' }; } });
  eq(asked, 1); eq(JSON.stringify(out), '{"wrong":[0,3]}');
  eq(await checkClaims({ connection: { id: 'c' }, claims: ['x'], material: [], callLLM: async () => { asked += 1; return { text: '{"wrong":[1]}' }; } }), null, 'nothing looked up: never asked');
  eq(asked, 1);
  eq(readClaimsCheck('{"wrong":[9]}', 2).wrong.length, 0, 'a number past the facts is nothing');
});
