/* Cozy Tavern — harness law of M563: THE AUDIT, PART 5 — every helper's request read as the model receives it. Milestone
 * numbers had leaked into the instructions ("(M372)", "M256 — every one of these…", "(M54 — the writer's own laws)") — the
 * history of patches spoken to the model; and seven helpers were told the story is "slow, warm" or "slow" — his tales are
 * fights, wars and tournaments. Every request built, the whole of what is sent scanned. */
import './idb-shim.mjs';
import { test, assert } from './lib.mjs';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

test('M563 NO HELPER IS TOLD THE HISTORY OF ITS OWN PATCHES OR THE GENRE OF THE STORY: every request builder of every helper, built with a filled ledger — no milestone number anywhere in what is sent, no "slow, warm" or "slow story"', async () => {
  const st = applyMutations({ ...emptyState(), page: 12 }, [{ type: 'mc.set', name: 'Jovan Wessex' }, { type: 'place.set', name: 'the academy yard' }, { type: 'presence.enter', name: 'Jovan Wessex' }, { type: 'presence.enter', name: 'Kaelen' }, { type: 'people.set', name: 'Kaelen', field: 'core', text: 'proud' }]).state;
  const pages = [{ role: 'user', text: 'I raise my sword.' }, { role: 'assistant', text: '[the academy yard — Monday | 09:20]\n\nKaelen lunged.' }];
  const A = { state: st, userText: 'I raise my sword.', assistantText: 'Kaelen lunged.', before: pages, brief: 'BRIEF', castNotes: 'CAST', record: 'REC', pages, mc: 'Jovan Wessex', history: pages, essentials: 'ESS', newest: 'NEWEST', concept: 'CONCEPT', facts: 'FACTS', people: 'PEOPLE', move: 'MOVE', lastPage: 'LAST', index: [], standing: [], claims: ['a'], material: ['m'], start: { series: 'S', facts: ['f'] }, wiki: ['w'], items: [], batch: [], kin: [], seats: {}, recent: 'R', story: { brief: 'BRIEF' }, messages: pages, prev: null, contradiction: 'C', passage: 'P', snippet: 'S', correction: 'X', playerName: 'Jovan Wessex' };
  const mods = ['auditor', 'canoncheck', 'canonlens', 'canonstart', 'canontidy', 'choices', 'continuity', 'editor', 'essentials', 'extractor', 'founder', 'memory', 'planner', 'plans', 'rebuild', 'recallpick', 'referee', 'scribe', 'sensors', 'tidy', 'world', 'worldground'];
  let built = 0; const bad = [];
  for (const m of mods) {
    const mod = await import('../../js/agents/' + m + '.js');
    for (const [name, fn] of Object.entries(mod)) {
      if (typeof fn !== 'function' || !/^build\w*|Ask$/.test(name) || /^build(DirectorBrief|HousekeeperContext)$/.test(name)) continue;
      let r;
      if (name === 'buildMemoryMessages') r = fn(pages, { playerName: 'Jovan Wessex', record: 'REC' });
      else if (name === 'buildFoldMessages') r = fn([{ text: 'n' }], { playerName: 'Jovan Wessex', record: 'REC' });
      else if (name === 'buildAuditMessages') r = fn('SRC', 'NOTE', 'PRIOR');
      else if (name === 'buildLensMessages') r = fn({ name: 'X', dossier: { identity: 'i' } }, [{ key: 'k', text: 't' }], 'PREMISE');
      else if (name === 'buildCanonTidyMessages') r = fn([{ name: 'X', text: 't' }]);
      else if (name === 'chatAsk') r = fn(st);
      else r = fn(A);
      const sent = JSON.stringify(r);
      built += 1;
      const tag = sent.match(/\bM\d{2,3}(?:-\d+)?\b/);
      if (tag) bad.push(m + '.' + name + ': ' + tag[0]);
      if (/slow, warm|slow story/.test(sent)) bad.push(m + '.' + name + ': genre framing');
    }
  }
  assert(built >= 30, 'every builder built: ' + built);
  assert(!bad.length, bad.join(' | '));
});
