/* THE FOLD MUST EQUAL THE APPLICATION.
 *
 * Every branch, every swipe, every take-back rebuilds the ledger by folding
 * the journal. If a fold ever produces a different world than the writes
 * that made it, the ledger corrupts silently — the writer branches and the
 * scene is subtly wrong, with nothing said. Nothing tested that equality
 * directly; this walks thousands of random mutation sequences and holds the
 * two against each other, field by field.
 */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { applyMutations, undoEntry, undoLast, JOURNAL_CAP } from '../../js/engine/apply.js';
import { emptyState, foldJournal, journalReaches, snapshotState, loadSnapshots, saveState, saveSnapshots } from '../../js/engine/state.js';

let seed = 987654321;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const NAMES = ['Mara', 'Tomas', 'Iris', 'Corvin', 'the ferryman', 'Mira'];
const PLACES = ['the chapel', 'the north road', 'the Wayward Lantern', 'a booth'];
const WORDS = ['a split lip', 'the long climb', 'a broken wrist', 'a sleepless night'];

let beatSeq = 0;
function randomMutation() {
  const name = pick(NAMES);
  switch (Math.floor(rnd() * 14)) {
    case 0: return { type: 'presence.enter', name, position: pick(['by the door', 'at the bar', '']), attire: pick(['a grey coat', '']) };
    case 1: return { type: 'presence.leave', name };
    case 2: return { type: 'presence.update', name, position: pick(['by the fire', 'standing', '']) };
    case 3: return { type: 'place.set', name: pick(PLACES) };
    case 4: return { type: 'clock.advance', minutes: 1 + Math.floor(rnd() * 400), reason: 'time passed' };
    case 5: return { type: 'mode.snapshot', flags: ['combat', 'intimate', 'travel', 'socialField'].filter(() => rnd() < 0.4) };
    case 6: return { type: 'body.injure', name, what: pick(WORDS), sev: 1 + Math.floor(rnd() * 3), treated: rnd() < 0.4 };
    case 7: return { type: 'body.strain', name, what: pick(WORDS) };
    case 8: return { type: 'body.heal', name, what: pick(WORDS) };
    /* M261: a beat is counted once, so a story's beats are its own — never the same words over and over */
    case 9: return { type: 'rel.shift', name, axis: pick(['p', 'r', 's']), delta: Math.round((rnd() * 40) - 20), cause: 'the chapel, beat' + (beatSeq += 1) };
    case 10: return { type: 'offscreen.set', name, location: pick(PLACES), activity: 'waiting', stance: pick(['toward', 'busy', '']) };
    case 11: return { type: 'canon.lock', name, key: pick(['eyes', 'hair', 'trade']), value: pick(['grey', 'black', 'a smith']) };
    case 12: return { type: 'people.set', name, field: pick(['core', 'state', 'arc']), text: 'something true of them ' + Math.floor(rnd() * 99) };
    default: return { type: 'knowledge.add', name, fact: 'the ferryman lied ' + Math.floor(rnd() * 99) };
  }
}

/* The parts of the world a fold must reproduce exactly. The journal's own
 * bookkeeping (seq, the log's timestamps) is not the world. */
function worldOf(st) {
  const strip = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
  return JSON.stringify({
    present: strip(st.present),
    place: strip(st.place),
    clock: st.clock ? { minutes: st.clock.minutes, calendar: st.clock.calendar } : null,
    mode: strip(st.mode),
    bodies: strip(st.bodies),
    relationships: strip(st.relationships),
    offscreen: strip(st.offscreen),
    canon: strip(st.canon),
    characters: strip(st.characters),
    knowledge: strip(st.knowledge),
    threads: strip(st.threads),
    factions: strip(st.factions),
  });
}

test('FUZZ: a journal fold reproduces the world the writes made, page for page', async () => {
  let runs = 0;
  let mismatches = [];
  for (let trial = 0; trial < 300; trial += 1) {
    const storyId = 'fuzz-' + trial;
    let live = emptyState();
    const pageCount = 3 + Math.floor(rnd() * 9);
    const worldAtPage = [];
    for (let page = 0; page < pageCount; page += 1) {
      live = { ...live, page };
      /* a page's chain: one to four batches, as the real chain writes */
      const batches = 1 + Math.floor(rnd() * 4);
      for (let b = 0; b < batches; b += 1) {
        const list = [];
        for (let k = 0, n = 1 + Math.floor(rnd() * 3); k < n; k += 1) list.push(randomMutation());
        live = applyMutations(live, list).state;
      }
      await saveState(storyId, live);
      await snapshotState(storyId, 'msg-' + page, page);
      worldAtPage.push(worldOf(live));
    }

    /* fold back to every page and hold it against what the writes made */
    const snaps = await loadSnapshots(storyId);
    for (let page = 0; page < pageCount; page += 1) {
      const folded = foldJournal(live, snaps, page, applyMutations);
      runs += 1;
      if (worldOf(folded) !== worldAtPage[page]) {
        if (mismatches.length < 3) {
          const a = JSON.parse(worldAtPage[page]);
          const b = JSON.parse(worldOf(folded));
          const differing = Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
          mismatches.push('trial ' + trial + ' page ' + page + ' — differs in: ' + differing.join(', '));
        }
      }
    }
  }
  assert(runs > 500, 'the fuzz really ran (' + runs + ' folds)');
  eq(mismatches.length, 0, runs + ' folds compared; mismatches:\n      ' + mismatches.join('\n      '));
});

/* THE TAKE-BACK MUST RESTORE EXACTLY. Every "Take it back" in the ledger, and
 * every undo the housekeeper's cards ride, rests on this: reversing the last
 * change must leave the world exactly as it stood before that change. If it
 * does not, a take-back quietly rewrites something else. */
test('FUZZ: a take-back leaves the world exactly as it stood before the change', () => {
  let checked = 0;
  const bad = [];
  for (let trial = 0; trial < 400; trial += 1) {
    let st = emptyState();
    st.page = 0;
    /* build a world worth undoing into */
    for (let k = 0, n = 2 + Math.floor(rnd() * 8); k < n; k += 1) {
      st = applyMutations(st, [randomMutation()]).state;
    }
    const before = worldOf(st);
    const m = randomMutation();
    const r = applyMutations(st, [m]);
    if (!r.applied.length) continue;          /* refused — nothing to take back */
    const after = r.state;
    if (worldOf(after) === before) continue;  /* it changed nothing visible */
    const back = undoLast(after);
    checked += 1;
    if (!back || !back.state) { bad.push(m.type + ' — nothing could be taken back'); continue; }
    if (worldOf(back.state) !== before) {
      if (bad.length < 4) {
        const a = JSON.parse(before);
        const b = JSON.parse(worldOf(back.state));
        const differing = Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
        bad.push(m.type + ' — after the take-back these differ: ' + differing.join(', '));
      }
    }
  }
  assert(checked > 200, 'the fuzz really ran (' + checked + ' take-backs)');
  eq(bad.length, 0, checked + ' take-backs compared; wrong:\n      ' + bad.join('\n      '));
});

/* WHEN THE JOURNAL ROLLS. The journal is capped; past it the oldest entries
 * go. A fold to a page the journal no longer reaches must SAY it cannot
 * reach — never quietly fold from nothing and hand the writer a branch with
 * an emptied ledger. (The writer's own report, M91: exactly that happened
 * once from a pre-journal store.) */
test('FUZZ: a story long enough to roll the journal never folds from nothing', async () => {
  const storyId = 'roll-1';
  let live = emptyState();
  const worldAtPage = [];
  /* enough pages, at four writes each, to run well past the cap */
  const pages = Math.ceil((JOURNAL_CAP * 1.6) / 4);
  for (let page = 0; page < pages; page += 1) {
    live = { ...live, page };
    for (let b = 0; b < 4; b += 1) live = applyMutations(live, [randomMutation()]).state;
    worldAtPage.push(worldOf(live));
    if (page % 25 === 0 || page === pages - 1) { await saveState(storyId, live); await snapshotState(storyId, 'msg-' + page, page); }
  }
  assert(live.journal.length <= JOURNAL_CAP, 'the journal really is capped (' + live.journal.length + ' of ' + JOURNAL_CAP + ')');
  assert(pages > 200, 'and the tale really is long (' + pages + ' pages)');

  const snaps = await loadSnapshots(storyId);
  /* the earliest pages are past the journal's reach — it must say so */
  eq(journalReaches(live, snaps, 0), false, 'a page the journal no longer reaches is refused, not folded from nothing');
  /* and every page it DOES claim to reach must fold true */
  let checked = 0;
  const bad = [];
  for (let page = 0; page < pages; page += 5) {
    if (!journalReaches(live, snaps, page)) continue;
    checked += 1;
    if (worldOf(foldJournal(live, snaps, page, applyMutations)) !== worldAtPage[page]) bad.push('page ' + page);
  }
  assert(checked > 0, 'some pages are still within reach (' + checked + ')');
  eq(bad.length, 0, 'every page the journal claims to reach folds true; wrong: ' + bad.join(', '));
});
