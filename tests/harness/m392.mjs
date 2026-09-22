/* M392: canon through his story — his Oda/Rukia premise: what the story changed, and what it has not reached, is not
 * said to the storyteller at all (no fact, no prophecy); what holds rides; the workers' record is the same; a lens is
 * made once per person per premise and made again when the premise or the canon words change. Runs the real extension
 * on its stand-in, the real lens, a scripted worker and a wiki answered over fetch. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { HOUSES } from './thinkinghouse.mjs';
import { lensStatements, overlayFrom, keepHolds, overlayFor, premiseOf, lensFingerprint, LENS_KEY } from '../../js/agents/canonlens.js';
import { canonBeforeSend, canonMeta, canonMetaKey, canonRecordFor } from '../../js/canon/bridge.js';
import { emptyState, saveState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const CONN = HOUSES[0].conn;
const STATES = [
  'She is the current Captain of the 13th Division, having previously served as its lieutenant under Jūshirō Ukitake.',
  'She is the adoptive sister of Byakuya Kuchiki and the younger sister of Hisana Kuchiki.',
  'She is married to Renji Abarai and they have a daughter named Ichika Abarai.',
  'She is a close friend of Ichigo Kurosaki.',
  'Her Zanpakutō is named Sode no Shirayuki.',
];
const RUKIA_ENTRY = () => ({ name: 'Rukia Kuchiki', found: true, kind: 'character', wiki: 'bleach', aliases: ['Rukia'], ts: 1, rel: { 'renji abarai': 'Rukia married Renji after the war; their daughter Ichika was born soon after.' },
  sections: { identity: STATES[0] + ' ' + STATES[1], physical: 'hair: Black; eyes: Violet' },
  dossier: { identity: 'The current Captain of the 13th Division', brief: 'A proud, modest noble who leads the 13th Division. She loves rabbit-themed things.',
    facts: [STATES[2], STATES[3], STATES[4]], secrets: [], abilities: [], voice: [], related: [], dynamics: { 'Renji Abarai': 'Her husband; they bicker like the childhood friends they were.' } } });
/* what a sound lens answers for his premise */
function judge(statements) {
  return { verdicts: statements.map((x) => {
    const t = x.text;
    if (/current Captain of the 13th Division, having previously served as its lieutenant under/.test(t)) return { n: x.n, verdict: 'changed', keep: 'having previously served as its lieutenant under Jūshirō Ukitake' };
    if (/current Captain|leads the 13th/.test(t)) return { n: x.n, verdict: 'changed' };
    if (/married|Ichika|husband/i.test(t)) return { n: x.n, verdict: 'changed' };
    if (/final arc|Royal Guard/i.test(t)) return { n: x.n, verdict: 'later' };
    if (/current captaincy and former lieutenant post/.test(t)) return { n: x.n, verdict: 'changed', keep: '13th Division: former lieutenant post' };
    return { n: x.n, verdict: 'holds' };
  }) };
}
function installFake(realFetch) {
  const asks = { lens: 0, prompts: [] };
  const WT = "{{Infobox Character\n| name = Rukia Kuchiki\n| hair = Black\n| eyes = Violet\n}}\n'''Rukia Kuchiki''' is a Shinigami.";
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (/fandom\.com/.test(u)) {
      const q = new URL(u); const ok = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
      const t = q.searchParams.get('titles'), p = q.searchParams.get('page'), sr = q.searchParams.get('srsearch');
      if (q.searchParams.get('list') === 'recentchanges') return ok({ query: { recentchanges: [{ timestamp: '2026-09-01T00:00:00Z' }] } });
      if (sr) return ok({ query: { search: /rukia/i.test(sr) ? [{ title: 'Rukia Kuchiki' }] : [] } });
      if (t) return /rukia/i.test(t) ? ok({ query: { pages: { 7: { pageid: 7, title: 'Rukia Kuchiki' } } } }) : ok({ query: { pages: { '-1': { title: t, missing: '' } } } });
      if (p && /rukia/i.test(p)) return ok({ parse: { title: 'Rukia Kuchiki', wikitext: { '*': WT } } });
      return ok({});
    }
    if (/z\.ai/.test(u)) {
      const body = JSON.parse(opts.body);
      const sys = String((body.messages || []).find((m) => m.role === 'system')?.content || '');
      const user = String((body.messages || []).filter((m) => m.role === 'user').pop()?.content || '');
      let answer = '{}';
      if (/You keep a canon character true to ONE story/.test(sys)) {
        asks.lens += 1; asks.prompts.push(sys);
        const statements = [...user.matchAll(/^(\d+)\. (.+)$/gm)].map((m) => ({ n: Number(m[1]), text: m[2] }));
        answer = JSON.stringify(judge(statements));
      }
      if (body.stream) {
        const lines = 'data: ' + JSON.stringify({ choices: [{ delta: { content: answer } }] }) + '\n\n' + 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n';
        const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(lines)); c.close(); } });
        return { ok: true, status: 200, headers: new Headers(), body: stream, json: async () => ({}), text: async () => lines, clone() { return this; } };
      }
      const obj = { choices: [{ message: { role: 'assistant', content: answer }, finish_reason: 'stop' }] };
      return { ok: true, status: 200, headers: new Headers(), json: async () => obj, text: async () => JSON.stringify(obj), clone() { return this; } };
    }
    return realFetch(url, opts);
  };
  return asks;
}

const PREMISE_BRIEF = 'A Bleach story after the war. Oda is the new captain of the 13th Division; Rukia Kuchiki is his lieutenant — she had expected the captaincy. Rukia has not married Renji.';

test('M392-1 THE LENS’S OWN LAW: every canon statement judged; what his story changed is not kept; a part that holds is kept in its own words only; nothing without a verdict is lost', () => {
  const e = RUKIA_ENTRY();
  const st = lensStatements(e);
  assert(st.some((x) => x.field === 'facts' && /married to Renji/.test(x.text)) && st.some((x) => x.field === 'pairs' && x.key === 'renji abarai'), 'the facts and the per-pair lines are judged too');
  const { overlay, held } = overlayFrom(e, st, judge(st).verdicts);
  assert(!overlay.facts.some((f) => /married/.test(f)) && overlay.facts.includes(STATES[4]), 'the marriage goes, her sword stays');
  eq(overlay.identity, '', 'a captaincy that is his is not her identity');
  assert(/having previously served as its lieutenant under Jūshirō Ukitake/.test(overlay.sections.identity) && !/current Captain/.test(overlay.sections.identity), 'the part that holds, kept in its own words: ' + overlay.sections.identity);
  eq(overlay.pairs['renji abarai'], '', 'the line that marries them is not said');
  eq(Object.keys(overlay.dynamics).length, 0, 'nor her "husband"');
  assert(held.some((h) => /married to Renji/.test(h.text) && h.why === 'changed'), 'what was held back is kept, with why');
  eq(keepHolds(STATES[0], 'having previously served as its lieutenant under Jūshirō Ukitake'), true, 'a cut is allowed');
  eq(keepHolds(STATES[0], 'she serves as lieutenant under Oda'), false, 'a word the statement never had is not');
  const none = overlayFrom(e, st, []);
  assert(none.overlay.facts.length === 3 && none.held.length === 0, 'with no verdict, nothing is lost');
});

test('M392-2 HIS OODA/RUKIA STORY, LIVE: the page carries none of the captaincy, the marriage or the daughter — her sister, her sword and her friends ride; the lens is made once, again when his premise changes; the workers’ record says the same', async () => {
  const realFetch = globalThis.fetch;
  const asks = installFake(realFetch);
  try {
    const st = await db.stories.create({ title: 'Oda of the 13th' });
    await db.stories.update(st.id, { brief: PREMISE_BRIEF });
    let story = await db.stories.get(st.id);
    await db.settings.set(canonMetaKey(story.id), { canon_grounding_wiki: 'bleach', canon_grounding_wiki_ok: { wikis: 'bleach', name: 'x', fp: '(manual)', manual: true, ts: 1 }, canon_grounding_cache: { rukia: RUKIA_ENTRY() } });
    const state = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Oda' }, { type: 'presence.enter', name: 'Oda' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }]).state;
    state.characters = { 'Rukia Kuchiki': { core: 'Oda’s lieutenant; she had expected the captaincy.', state: 'at the division office', threads: [] } };
    await saveState(story.id, state);
    const messages = [{ id: 'u1', role: 'user', text: 'I hand Rukia the duty roster.' }];
    const note = await canonBeforeSend({ story, state, messages, connection: CONN });
    eq(asks.lens, 1, 'she was lensed on the page she rode');
    assert(/Rukia Kuchiki:/.test(note), 'she rides: ' + note.slice(0, 300));
    assert(!/married|Ichika|husband|current Captain|leads the 13th/i.test(note), 'no captaincy, no marriage, no daughter — not as fact, not as prophecy: ' + note);
    assert(/Sode no Shirayuki/.test(note) && /Ichigo Kurosaki/.test(note), 'her sword and her friend ride');
    const meta = await canonMeta(story.id);
    assert(meta[LENS_KEY] && meta[LENS_KEY]['rukia kuchiki'] && meta[LENS_KEY]['rukia kuchiki'].held.length >= 2, 'the lens is kept in the story’s canon memory');
    assert(!JSON.stringify(meta.canon_grounding_cache.rukia).includes('"held"') && meta.canon_grounding_cache.rukia.dossier.facts.includes(STATES[2]), 'canon’s own memory stays canon');
    const again = await canonBeforeSend({ story, state, messages: [...messages, { id: 'a1', role: 'assistant', text: 'She takes it.' }, { id: 'u2', role: 'user', text: 'I nod to Rukia.' }], connection: CONN });
    eq(asks.lens, 1, 'the same premise asks nothing again');
    assert(!/married/i.test(again), 'and the next page is lensed too');
    const rec = canonRecordFor(meta, ['Rukia Kuchiki']);
    assert(rec && !/married|Ichika|current Captain/i.test(rec) && /Sode no Shirayuki/.test(rec), 'the workers are handed the record as it holds in his story: ' + rec);
    await db.stories.update(story.id, { brief: PREMISE_BRIEF + ' Byakuya is dead.' });
    story = await db.stories.get(story.id);
    await canonBeforeSend({ story, state, messages: [...messages, { id: 'a2', role: 'assistant', text: 'She waits.' }, { id: 'u3', role: 'user', text: 'I ask Rukia to sit.' }], connection: CONN });
    eq(asks.lens, 2, 'a changed premise is judged again');
  } finally { globalThis.fetch = realFetch; }
});

test('M392-3 A LENS IS FOR THE CANON WORDS IT WAS MADE FROM: a page looked up again is not seen through an old lens', () => {
  const e = RUKIA_ENTRY();
  const st = lensStatements(e);
  const { overlay } = overlayFrom(e, st, judge(st).verdicts);
  const meta = { [LENS_KEY]: { 'rukia kuchiki': { fp: lensFingerprint(e), key: 'x', overlay, held: [] } } };
  assert(overlayFor(meta, e), 'the same words: the lens applies');
  const changed = RUKIA_ENTRY(); changed.dossier.facts = [...changed.dossier.facts, 'She is fond of Chappy.'];
  eq(overlayFor(meta, changed), null, 'new canon words: not through the old lens (it is made again)');
  eq(premiseOf({ brief: '' }, {}), '', 'no premise, nothing to judge by');
  /* the workers are handed only what was read through his story, when there is a premise to hold it to */
  const bare = { canon_grounding_cache: { rukia: RUKIA_ENTRY() } };
  eq(canonRecordFor(bare, ['Rukia Kuchiki'], { premise: PREMISE_BRIEF }), '', 'not yet read through his story: not handed to the workers at all');
  assert(/married to Renji/.test(canonRecordFor(bare, ['Rukia Kuchiki'])), 'with no premise, canon as it is');
  const lensed = { ...bare, [LENS_KEY]: meta[LENS_KEY] };
  const rec = canonRecordFor(lensed, ['Rukia Kuchiki'], { premise: PREMISE_BRIEF });
  assert(rec && !/married|Ichika/i.test(rec) && /Sode no Shirayuki/.test(rec), 'read through it: handed as it holds: ' + rec);
});

test('M393-1 NOTHING WRITTEN IS STILL HIS STORY: with no brief at all, she is still read through the story — canon’s end-state (the captaincy, the marriage, the daughter) is not sent; silence is not establishment; and the workers get only what was read', async () => {
  const realFetch = globalThis.fetch;
  const asks = installFake(realFetch);
  try {
    const st = await db.stories.create({ title: 'No brief at all' });
    const story = await db.stories.get(st.id);
    await db.settings.set(canonMetaKey(story.id), { canon_grounding_wiki: 'bleach', canon_grounding_wiki_ok: { wikis: 'bleach', name: 'x', fp: '(manual)', manual: true, ts: 1 }, canon_grounding_cache: { rukia: RUKIA_ENTRY() } });
    const state = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Oda' }, { type: 'presence.enter', name: 'Oda' }, { type: 'presence.enter', name: 'Rukia Kuchiki' }]).state;
    state.characters = { 'Rukia Kuchiki': { core: 'x', state: 'here', threads: [] } };
    await saveState(story.id, state);
    const note = await canonBeforeSend({ story, state, messages: [{ id: 'u1', role: 'user', text: 'I greet Rukia.' }], connection: CONN });
    eq(asks.lens, 1, 'read through the story with nothing written');
    assert(/SILENCE IS NOT ESTABLISHMENT/.test(asks.prompts[0]), 'the lens is told silence is not establishment');
    assert(/Rukia Kuchiki:/.test(note) && !/married|Ichika|current Captain|leads the 13th/i.test(note), 'canon’s end-state is not sent: ' + note.slice(note.indexOf('Rukia Kuchiki:'), note.indexOf('Rukia Kuchiki:') + 400));
    const { canonPremise } = await import('../../js/canon/bridge.js');
    const premise = await canonPremise(story);
    assert(premise.length > 0, 'the premise is never empty');
    const other = { canon_grounding_cache: { rukia: RUKIA_ENTRY() } };
    eq(canonRecordFor(other, ['Rukia Kuchiki'], { premise }), '', 'unread canon never reaches the workers, brief or no brief');
  } finally { globalThis.fetch = realFetch; }
});

test('M394-1 THE LENS DOES NOT WAIT FOR A PAGE: everyone canon knows in the ledger is read through his story at once — powers and the world around them too — and a ledger already read asks nothing', async () => {
  const { canonLensLedger } = await import('../../js/canon/bridge.js');
  const { throughLens } = await import('../../js/agents/canonlens.js');
  const realFetch = globalThis.fetch;
  const asks = installFake(realFetch);
  try {
    const st = await db.stories.create({ title: 'Read at once' });
    await db.stories.update(st.id, { brief: PREMISE_BRIEF });
    const story = await db.stories.get(st.id);
    const r = RUKIA_ENTRY();
    r.dossier.abilities = ['Ōken Clothing: garments of the Royal Guard, from the final arc', 'Sode no Shirayuki: her Zanpakutō'];
    r.dossier.related = [{ name: '13th Division', why: 'Her current captaincy and former lieutenant post' }, { name: 'Kuchiki Clan', why: 'Noble family she was adopted into' }];
    await db.settings.set(canonMetaKey(story.id), { canon_grounding_wiki: 'bleach', canon_grounding_wiki_ok: { wikis: 'bleach', name: 'x', fp: '(manual)', manual: true, ts: 1 }, canon_grounding_cache: { rukia: r } });
    const state = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Oda' }]).state;
    state.characters = { 'Rukia Kuchiki': { core: 'Oda’s lieutenant.', state: 'off duty', threads: [] } }; /* in the ledger, not in the scene */
    await saveState(story.id, state);
    const read = await canonLensLedger(story, { connection: CONN });
    eq(read.join(), 'Rukia Kuchiki', 'read at once — no page sent, not even in the scene');
    const meta = await canonMeta(story.id);
    const seen = throughLens(meta.canon_grounding_cache.rukia, overlayFor(meta, meta.canon_grounding_cache.rukia));
    assert(!seen.dossier.facts.some((f) => /married/.test(f)), 'the marriage is not carried');
    assert(!JSON.stringify(seen.dossier.related).includes('current captaincy') && seen.dossier.related.some((x) => x.name === '13th Division'), 'the 13th stays hers to serve in; "her current captaincy" goes: ' + JSON.stringify(seen.dossier.related));
    assert(seen.dossier.related.some((x) => x.name === 'Kuchiki Clan' && /adopted/.test(x.why)), 'the rest of the world around her stays as canon has it');
    eq(asks.lens, 1, 'one worker call');
    eq((await canonLensLedger(story, { connection: CONN })).length, 0, 'a ledger already read asks nothing');
    eq(asks.lens, 1, 'no second call');
  } finally { globalThis.fetch = realFetch; }
});

test('M395-1 WHERE THE SCENE IS, BY HIS LEDGER: the setting is the canon place the page header names (a part of it will do), a place canon does not know leaves none; and canon’s own notices are kept for its room, never shown as popups', async () => {
  const { canonNote, canonNotes } = await import('../../js/canon/bridge.js');
  const { onToast, toastr } = await import('../../js/canon/host.js');
  const st = await db.stories.create({ title: 'Where we are' });
  const story = await db.stories.get(st.id);
  await db.settings.set(canonMetaKey(story.id), { canon_grounding_wiki: 'bleach', canon_grounding_wiki_ok: { wikis: 'bleach', name: 'x', fp: '(manual)', manual: true, ts: 1 },
    canon_grounding_setting: 'karakura town',
    canon_grounding_cache: {
      'kuchiki manor': { name: 'Kuchiki Manor', found: true, kind: 'place', wiki: 'bleach', aliases: [], ts: Date.now(), sections: { identity: 'The Kuchiki estate.' } },
      'karakura town': { name: 'Karakura Town', found: true, kind: 'place', wiki: 'bleach', aliases: [], ts: Date.now(), sections: { identity: 'A town.' } },
    } });
  const state = applyMutations({ ...emptyState(), page: 1 }, [{ type: 'mc.set', name: 'Oda' }, { type: 'presence.enter', name: 'Oda' }, { type: 'place.set', name: 'Kuchiki Manor — the tea room' }]).state;
  await canonBeforeSend({ story, state, messages: [{ id: 'u1', role: 'user', text: 'Word came from Karakura Town.' }], connection: null });
  eq((await canonMeta(story.id)).canon_grounding_setting, 'kuchiki manor', 'the setting is where his header says the scene is');
  const nowhere = applyMutations(state, [{ type: 'place.set', name: 'a ramen stall by the river' }]).state;
  await canonBeforeSend({ story, state: nowhere, messages: [{ id: 'u1', role: 'user', text: 'We sit down to eat.' }], connection: null });
  eq((await canonMeta(story.id)).canon_grounding_setting, '', 'a place canon does not know: no setting, never a wrong one');
  onToast((w) => canonNote(w));
  toastr.info('📍 setting → Seireitei');
  eq(canonNotes()[0].words, '📍 setting → Seireitei', 'its notice is kept for its room');
});
