/* M424: THE FOLD MUST EQUAL THE APPLICATION — WITH EVERY FORM OF A NAME, AND THE CHAIN'S OWN JOINS.
 * fold-fuzz.mjs walks random writes under six plain names. The ledger now writes under ANY form of a name (the one
 * matcher, M414–M423) and the readers' chain joins one person's pages and book entries on its own every page (M406,
 * M418, M419 — people.rename) and lets stale nows go (M405/M421). A branch, a swipe and a take-back fold the journal;
 * if a fold of these writes ever made a different world than the writes did, the ledger would corrupt silently. This
 * walks random pages of them — with the chain's own joins between batches — and holds every fold to the writes. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { applyMutations, duplicatePages, strayBookKeys, staleNows } from '../../js/engine/apply.js';
import { emptyState, foldJournal, snapshotState, loadSnapshots, saveState, loadState } from '../../js/engine/state.js';

let seed = 424242;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const FORMS = ['Rukia', 'Rukia Kuchiki', 'Lieutenant Rukia Kuchiki', 'Kuchiki', 'Byakuya Kuchiki', 'Captain Kuchiki', 'Suì-Fēng', 'Sui-Feng', 'you', 'Oda', 'Mira', 'Mara', "Oda's mother"];
const PLACES = ['10th Division HQ — training courtyard', '10th Division HQ — captain\u2019s office', '13th Division barracks', 'the Kuchiki manor'];
let beat = 0;
function mutation() {
  const name = pick(FORMS);
  switch (Math.floor(rnd() * 12)) {
    case 0: return { type: 'presence.enter', name, position: pick(['by the gate', 'on the sand', '']) };
    case 1: return { type: 'presence.leave', name };
    case 2: return { type: 'place.set', name: pick(PLACES) };
    case 3: return { type: 'body.injure', name, what: pick(['a cut', 'bruised ribs', 'a burned hand']), sev: 1 + Math.floor(rnd() * 3) };
    case 4: return { type: 'body.heal', name, what: pick(['a cut', 'bruised ribs']) };
    case 5: return { type: 'rel.shift', name, axis: pick(['p', 'r', 's']), delta: Math.round(rnd() * 30 - 15), cause: 'beat ' + (beat += 1) };
    case 6: return { type: 'offscreen.set', name, location: pick(PLACES), activity: 'waiting', stance: pick(['busy', 'toward', '']) };
    case 7: return { type: 'canon.lock', name, key: pick(['eyes', 'hair']), value: pick(['violet', 'black']) };
    case 8: return { type: 'people.set', name, field: pick(['core', 'state']), text: 'true of them ' + Math.floor(rnd() * 99) };
    case 9: return { type: 'knowledge.add', name, fact: 'the recruits bet on the duel ' + Math.floor(rnd() * 99) };
    case 10: return { type: 'clock.advance', minutes: 1 + Math.floor(rnd() * 120), reason: 'time passed' };
    default: return { type: 'people.set', name, field: 'state', text: '', clear: true };
  }
}
function worldOf(st) {
  const strip = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
  return JSON.stringify({ present: strip(st.present), place: strip(st.place), bodies: strip(st.bodies), relationships: strip(st.relationships),
    offscreen: strip(st.offscreen), canon: strip(st.canon), characters: strip(st.characters), knowledge: strip(st.knowledge), sheet: strip(st.sheet && st.sheet.playerName) });
}

test('M424-1 FUZZ: every form of a name and the chain\u2019s own joins — a journal fold reproduces the world the writes made, page for page', async () => {
  let runs = 0; let joinsSeen = 0; const bad = [];
  for (let trial = 0; trial < 160; trial += 1) {
    const storyId = 'fuzz-names-' + trial;
    let live = applyMutations({ ...emptyState(), page: 0 }, [{ type: 'mc.set', name: 'Oda' }]).state;
    const pages = 3 + Math.floor(rnd() * 7);
    const at = [];
    for (let page = 0; page < pages; page += 1) {
      live = { ...live, page };
      for (let b = 0, n = 1 + Math.floor(rnd() * 3); b < n; b += 1) {
        const list = [];
        for (let k = 0, m = 1 + Math.floor(rnd() * 4); k < m; k += 1) list.push(mutation());
        live = applyMutations(live, list).state;
      }
      /* the readers' chain's own upkeep, as chat.js runs it: pages joined, book entries joined, stale nows let go */
      const pj = duplicatePages(live);
      if (pj.length) { joinsSeen += pj.length; live = applyMutations(live, pj.map((j) => ({ type: 'people.rename', from: j.from, to: j.to, cause: 'one person, one page' }))).state; }
      const sj = strayBookKeys(live);
      if (sj.length) { joinsSeen += sj.length; live = applyMutations(live, sj.map((j) => ({ type: 'people.rename', from: j.from, to: j.to, cause: 'one name in every book' }))).state; }
      const who = staleNows(live, {});
      if (who.length) live = applyMutations(live, who.map((name) => ({ type: 'people.set', name, field: 'state', text: '', clear: true }))).state;
      await saveState(storyId, live);
      /* checkpoints only now and then (a long tale's are pruned), so most folds REPLAY the journal — a fold that only
       * handed back each page's own checkpoint would prove nothing about the writes */
      if (page % 3 === 0) await snapshotState(storyId, 'msg-' + page, page);
      /* the world as the app holds it — saved and read back (loadState gives an absent now its empty string), which is
       * what every reader and every fold starts from */
      at.push(worldOf(await loadState(storyId)));
    }
    const snaps = await loadSnapshots(storyId);
    for (let page = 0; page < pages; page += 1) {
      const folded = foldJournal(await loadState(storyId), snaps, page, applyMutations);
      /* the fold as the app keeps it: a branch saves its fold and every reader reads it back (loadState gives an absent
       * now its empty string) — so both sides are compared as the app holds them */
      await saveState(storyId + '-fold', folded);
      const foldedHeld = await loadState(storyId + '-fold');
      runs += 1;
      if (worldOf(foldedHeld) !== at[page] && bad.length < 3) {
        const a = JSON.parse(at[page]); const b = JSON.parse(worldOf(foldedHeld));
        bad.push('trial ' + trial + ' page ' + page + ' differs in: ' + Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).join(', '));
      }
    }
  }
  assert(runs > 400 && joinsSeen > 20, 'the fuzz really ran (' + runs + ' folds, ' + joinsSeen + ' joins made by the chain)');
  eq(bad.length, 0, runs + ' folds; mismatches:\n      ' + bad.join('\n      '));
});
