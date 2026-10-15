/* Cozy Tavern — harness laws of M752 (followup 22): AN UNCHANGED ENTRY THE NEW PAGE DOES NOT NAME KEEPS ITS APPROVAL.
 * HIS (15 October 2026): "if your explanation are wrong means the auditor can be optimized to be fast while still give the same
 * or better results". With every entry approved, each new page asked the review again for every standing, every person's
 * knowledge and every thread — 334 of 413 on a 200-page tale, 70,000 characters of each page's review — though none had
 * changed: an approval was tied to the whole set of originals, and a page added changes the set.
 *   CA1  a page only added: the entries of someone it does not name are not asked again, and stand approved; the entries of
 *        someone it names are asked again; the audit completes
 *   CA2  an older page edited: every entry is asked again (its originals changed)
 *   CA3  an entry whose value changed is asked again, named or not
 *   CA4  someone in the scene, meant without a name ("the lieutenant"), has their entries asked again
 *   CA5  the reviewer still sees a kept entry and can repair it: the repair lands and the audit completes on it
 * New code is reached through module namespaces, so this file loads against the tree before followup 22. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { emptyState, loadState, saveState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { auditLedger } from '../../js/agents/auditor.js';
import { ledgerAuditVerified } from '../../js/agents/auditprogress.js';

const connection = { type: 'openai', baseUrl: 'https://fixture.example/v1', apiKey: 'fixture', model: 'fixture', preset: 'custom', contextSize: 200000, reasoning: { effort: 'off' } };
const H = (t) => '[The yard — Monday, March 3, 2025 | ' + t + ' | clear]\n\n';

/* the wire: the source reading checks what it is given; the review approves whatever it is asked, and its asks are kept */
async function onWire(fn, review = () => ({})) {
  const asked = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (_, options) => {
    const body = JSON.parse(options.body);
    const user = String(body.messages.filter((m) => m.role === 'user').at(-1).content);
    let content;
    if (user.startsWith('SOURCE DOCUMENTS')) content = JSON.stringify({ checked: JSON.parse(user.slice('SOURCE DOCUMENTS\n'.length)).map((d) => d.id), people: [] });
    else {
      const rows = user.includes('REQUIRED CURRENT LEDGER CHECKS:\n') ? JSON.parse(user.split('REQUIRED CURRENT LEDGER CHECKS:\n')[1].split('\n')[0]) : [];
      asked.push(rows.map((r) => r.id));
      content = JSON.stringify({ issues: [], review: { status: 'complete', why: 'Every entry was compared with the originals.', open: [] }, standings: [], scene: [], ...review(user) });
    }
    return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  };
  try { await fn(); return asked; } finally { globalThis.fetch = real; }
}

async function tale(title) {
  const story = await db.stories.create({ title });
  await db.messages.append(story.id, { role: 'user', text: 'I walk into the yard.' });
  await db.messages.append(story.id, { role: 'assistant', text: H('09:00') + 'Rukia Kuchiki trained in the yard. Renji Abarai watched from the wall and said nothing.' });
  const led = applyMutations({ ...emptyState(), sheet: { playerName: 'Jovan', playerAliases: [], actors: {} } }, [
    { type: 'mc.set', name: 'Jovan' }, { type: 'place.set', name: 'The yard' }, { type: 'presence.enter', name: 'Jovan' },
    { type: 'rel.set', name: 'Rukia Kuchiki', p: 30, r: 10, s: 0, cause: 'she trained beside him' },
    { type: 'rel.set', name: 'Renji Abarai', p: 20, r: 0, s: 0, cause: 'he watched him from the wall' },
    { type: 'knowledge.add', name: 'Renji Abarai', fact: 'Renji knows Jovan trains in the yard' },
    { type: 'thread.set', title: 'Renji’s silence', owner: 'Renji Abarai', heat: 'warm', next: 'ask him why' },
  ]).state;
  led.characters = { 'Rukia Kuchiki': { core: 'A shinigami of the thirteenth.' }, 'Renji Abarai': { core: 'Lieutenant of the sixth.' } };
  await saveState(story.id, led);
  const all = await onWire(() => auditLedger({ connection, storyId: story.id, reviewSources: 'all' }));
  assert(all.length >= 1, 'fixture: the first review was asked');
  assert(ledgerAuditVerified(await loadState(story.id), await db.stories.get(story.id), await db.messages.list(story.id)), 'fixture: the whole ledger stands approved');
  return story;
}
const addPage = async (id, text) => { await db.messages.append(id, { role: 'user', text: 'I wait.' }); await db.messages.append(id, { role: 'assistant', text }); };
const renjis = (ids) => ids.filter((x) => /Renji/.test(x));

test('M752-CA1 A PAGE ONLY ADDED: THE ENTRIES OF SOMEONE IT DOES NOT NAME KEEP THEIR APPROVAL — Renji’s standing, knowledge and thread are not asked again; Rukia’s, named on it, are; the audit completes (his current state, the scene’s, still is: M707)', async () => {
  const story = await tale('carry over');
  await addPage(story.id, H('09:10') + 'Rukia Kuchiki lowered her sword and turned to Jovan.');
  const [asked] = await onWire(() => auditLedger({ connection, storyId: story.id, reviewSources: 'next' }));
  /* (his current state is the scene's — reviewed every page the scene moves, M707) */
  eq(renjis(asked).filter((x) => !x.startsWith('characterState:')).join(' | '), '', 'none of Renji’s standing, knowledge or thread asked again');
  assert(asked.includes('relationships:Rukia Kuchiki'), 'Rukia’s standing is asked again: ' + asked.join(', '));
  assert(ledgerAuditVerified(await loadState(story.id), story, await db.messages.list(story.id)), 'the audit stands complete');
});

test('M752-CA2 AN OLDER PAGE EDITED: EVERY ENTRY IS ASKED AGAIN — its originals changed', async () => {
  const story = await tale('an older page edited');
  const first = (await db.messages.list(story.id)).find((m) => m.role === 'assistant');
  await db.messages.update(story.id, first.id, { text: H('09:00') + 'Rukia Kuchiki trained in the yard. Renji Abarai watched from the gate and said nothing.' });
  await addPage(story.id, H('09:10') + 'Rukia Kuchiki lowered her sword.');
  const [asked] = await onWire(() => auditLedger({ connection, storyId: story.id, reviewSources: 'all' }));
  assert(asked.includes('relationships:Renji Abarai') && asked.includes('knowledge:Renji Abarai'), 'Renji’s entries are asked again: ' + asked.join(', '));
});

test('M752-CA3 AN ENTRY WHOSE VALUE CHANGED IS ASKED AGAIN, NAMED OR NOT', async () => {
  const story = await tale('a value changed');
  const st = await loadState(story.id);
  await saveState(story.id, applyMutations(st, [{ type: 'rel.set', name: 'Renji Abarai', p: 5, r: 0, s: 0, cause: 'a cold word, off the page' }]).state);
  await addPage(story.id, H('09:10') + 'Rukia Kuchiki lowered her sword.');
  const [asked] = await onWire(() => auditLedger({ connection, storyId: story.id, reviewSources: 'next' }));
  assert(asked.includes('relationships:Renji Abarai'), 'his changed standing is asked again: ' + asked.join(', '));
  assert(!asked.includes('knowledge:Renji Abarai'), 'his unchanged knowledge is not');
});

test('M752-CA4 SOMEONE IN THE SCENE, MEANT WITHOUT A NAME (“the lieutenant”), HAS THEIR ENTRIES ASKED AGAIN', async () => {
  const story = await tale('in the scene');
  const st = await loadState(story.id);
  await saveState(story.id, applyMutations(st, [{ type: 'presence.enter', name: 'Renji Abarai' }]).state);
  await addPage(story.id, H('09:10') + 'The lieutenant pushed off the wall and walked out without a word.');
  const [asked] = await onWire(() => auditLedger({ connection, storyId: story.id, reviewSources: 'next' }));
  assert(asked.includes('relationships:Renji Abarai') && asked.includes('knowledge:Renji Abarai') && asked.includes('threads:Renji’s silence'), 'his entries are asked again: ' + asked.join(', '));
});

test('M752-CA5 THE REVIEWER STILL SEES A KEPT ENTRY AND CAN REPAIR IT: Renji’s thread, not asked again, shown in the ledger, is closed by the review and the audit completes on the closed thread', async () => {
  const story = await tale('a kept entry repaired');
  await addPage(story.id, H('09:10') + 'Rukia Kuchiki lowered her sword.');
  const [asked] = await onWire(() => auditLedger({ connection, storyId: story.id, reviewSources: 'next' }), (user) => {
    assert(/Renji’s silence/.test(user.split('REQUIRED CURRENT LEDGER CHECKS')[0]), 'the kept thread is in front of the reviewer');
    return { issues: [{ what: 'Renji’s silence is answered: the writer settled it off the page.', mutations: [{ type: 'thread.close', title: 'Renji’s silence', cause: 'fixture: the reviewer closes it' }] }] };
  });
  assert(!asked.includes('threads:Renji’s silence'), 'it was not on the checklist');
  const after = await loadState(story.id);
  assert(!(after.threads || []).some((t) => t.title === 'Renji’s silence' && !t.closed), 'the repair landed: ' + JSON.stringify(after.threads));
  assert(ledgerAuditVerified(after, story, await db.messages.list(story.id)), 'and the audit completes on it');
});
