/* Cozy Tavern — agents/rebuild.js
 * M52: the gradual rebuilder — Summaryception's way. Nothing here ever
 * reads the whole story in one prompt: the past is walked six pages at a
 * time from turn 0, each batch read with the record that covers the pages
 * BEFORE it, and the result folded in before the next batch is read.
 *
 *   rebuildRecord({connection, storyId, onProgress, signal, stale})
 *     The record's lines are backed up (memoryBackup:<storyId>) and let go;
 *     the keeper then folds the pages again, holes-first, batch by batch,
 *     until nothing below the window is uncovered. The verifier and the
 *     detail auditor run on every line as they always do.
 *
 *   rebuildPeople({connection, storyId, brief, castNotes, onProgress, signal, stale})
 *     The character pages and the standings are backed up
 *     (peopleBackup:<storyId>) and let go; the founder's digits are written
 *     as the standings' origin; then every batch of six pages is read in
 *     order with the record-so-far, the pages-so-far and the standings-so-
 *     far as context, and answers with the scribe's deltas (people.set) and
 *     the reader's shifts (rel.shift toward the main character, cause
 *     quoting the beat). Applied through the closed vocabulary — logged,
 *     take-back-able as one sweep.
 *
 *   restoreRecord / restorePeople put the backups back.
 */

import { db } from '../store.js';
import { callWorker } from './call.js';
import { balancedCandidates, parseLenient } from './jsonutil.js';
import { withFictionFrame } from './voice.js';
import { loadState, saveState, notify } from '../engine/state.js';
import { applyMutations } from '../engine/apply.js';
import { mcName } from '../engine/duels.js';
import { renderPeopleTiers } from '../engine/people.js';
import { renderRelationships } from '../engine/relationships.js';
import { loadMemory, saveMemory, maybeSummarize, dueRange, cleanWindow, cleanBatch, visiblePages, DEFAULT_BATCH } from './memory.js';
import { pageText } from '../assemble/stack.js';
import { readStatedStandings, samePersonLoose } from './founder.js';

const MAX_TOKENS = 3000;

/* ---------- the record ---------- */

export async function rebuildRecord({ connection, storyId, onProgress, onRetry, signal, stale, renew } = {}) {
  if (!connection || !storyId) return null;
  const mem = await loadMemory(storyId);
  /* M202: THE WAY BACK IS NOT OVERWRITTEN BY A FAILED REBUILD. The backup was
   * taken unconditionally — so a rebuild that stumbled partway (the keeper
   * could not reach the storyteller) left a HALF record, and pressing
   * rebuild again saved that half over the writer's real one. "Put the old
   * record back" then put back the wreckage. The same fault M165 fixed for
   * the people; the record had it too. A record a rebuild made keeps the
   * backup that stands. */
  const heldBackup = await db.settings.get('memoryBackup:' + storyId);
  if (!(heldBackup && mem.rebuiltAt)) {
    await db.settings.set('memoryBackup:' + storyId, { at: Date.now(), nodes: mem.nodes });
  }
  /* M210: REBUILD ALWAYS MEANS FROM THE FIRST PAGE. M203 made a press
   * sometimes resume and sometimes start over, depending on how the LAST run
   * had ended — so one button did two different things and the writer could
   * not tell which they were getting. It is one thing now: the record is let
   * go and folded again from the first page, every single press. The
   * carrying-on belongs INSIDE a run — a round that stumbles waits and tries
   * again, three times, rather than throwing the run away — and never
   * across presses. */
  await saveMemory(storyId, { ...mem, nodes: [], rebuiltAt: Date.now() });
  const history = visiblePages(await db.messages.list(storyId));
  const window = cleanWindow(mem.window || (await db.settings.get('memoryWindow')));
  const batch = cleanBatch(await db.settings.get('memoryBatch'));
  const toFold = Math.max(0, history.length - window);
  /* M211: batches, because a batch is the unit of work a writer can feel. A
   * run folds three of them, so counting runs made the banner leap from
   * nothing to "18 of 99" and sit there. */
  /* M211: FLOOR, not ceil. A batch is only folded when it is FULL (dueRange
   * holds a part-batch back for next time), so counting the leftover pages
   * as a batch left the banner reading "11 of 12 · 92%" at the end of a run
   * that had in fact finished — and a writer watching a bar that never
   * closes has no way to tell finished from stuck. */
  const batches = Math.max(1, Math.floor(toFold / batch));
  let doneBatches = 0;
  let folded = 0;
  let rounds = 0;
  while (rounds < 400) {
    if (stale && stale()) return null;
    /* M207: this round gets its own minute — a rebuild is many calls, and the
     * job's single leash aborted it partway through every long tale. */
    /* M213: an abort reports what it DID fold. Returning null printed as
     * "nothing to rebuild" over a run that had folded eighteen pages. */
    if (typeof renew === 'function' && !renew()) {
      return { folded, toFold, lines: (await loadMemory(storyId)).nodes.length, stalled: true,
        why: 'the run was cut short — press Rebuild to start again' };
    }
    const before = (await loadMemory(storyId)).nodes;
    if (!dueRange(history.length, window, before, batch)) break;
    /* M215: A WIRE THAT FALLS OVER MID-REBUILD IS A STUMBLE, NOT A CRASH.
     * callKeeper THROWS on a connection reset, and nothing here caught it —
     * so the error escaped rebuildRecord entirely, the queue caught it, and
     * the queue retried the WHOLE JOB, which wipes the record and folds from
     * page one again. A hundred pages of work thrown away by one blip, up to
     * five times over. Caught here, it is just a round that wrote nothing,
     * and the retry ladder below is what handles it. */
    try {
      await maybeSummarize({
        connection, storyId, signal, renew,
        onBatch: ({ pages }) => {
          doneBatches += 1;
          folded += pages;
          if (typeof onProgress === 'function') onProgress({ batch: doneBatches, batches, folded, toFold });
        },
      });
    } catch (err) { /* the ladder below decides what to do about it */ }
    let after = (await loadMemory(storyId)).nodes;
    /* M202: A KEEPER THAT STUMBLED IS NOT A RECORD THAT IS FINISHED. This
     * broke out the moment a round wrote nothing — and maybeSummarize
     * swallows a wire that failed, so "couldn't reach the storyteller" read
     * exactly like "there is nothing left to fold". The rebuild stopped
     * halfway, reported its half as the total, and the writer was left with
     * an incomplete record and no idea why. A round that writes nothing
     * while work is STILL DUE is a stumble: it waits and tries again, three
     * times, and only then gives up — and says so. */
    if (after.length === before.length) {
      let recovered = false;
      /* M215: PATIENT ENOUGH TO OUTLAST A HICCUP. Three tries over fifteen
       * seconds is thin — a provider that coughs for half a minute killed a
       * rebuild that was otherwise going fine, and the writer had to come
       * back and press it again. Six tries over about three minutes, each
       * wait counted down on the banner so it never looks dead, and Stop is
       * there the whole time. Beyond that the connection is genuinely gone
       * and saying so is kinder than spinning forever. */
      const pauses = [1500, 4000, 9000, 20000, 45000, 90000];
      for (let a = 0; a < pauses.length; a += 1) {
        const pause = pauses[a];
        if (stale && stale()) return null;
        if (typeof onRetry === 'function') await onRetry({ ms: pause, attempt: a + 1, of: pauses.length });
        else await new Promise((r) => setTimeout(r, pause));
        if (typeof renew === 'function' && !renew()) {
          return { folded, toFold, lines: (await loadMemory(storyId)).nodes.length, stalled: true,
            why: 'the run was cut short — press Rebuild to start again' };
        }
        try {
          await maybeSummarize({
            connection, storyId, signal, renew,
            onBatch: ({ pages }) => {
              doneBatches += 1;
              folded += pages;
              if (typeof onProgress === 'function') onProgress({ batch: doneBatches, batches, folded, toFold });
            },
          });
        } catch (err) { /* still down — the next rung of the ladder */ }
        after = (await loadMemory(storyId)).nodes;
        if (after.length !== before.length) { recovered = true; break; }
      }
      if (!recovered) {
        return {
          folded, toFold, lines: after.length,
          stalled: true,
          why: 'the keeper could not be reached — press Rebuild to start again, or put the old record back',
        };
      }
    }
    folded = after.reduce((n, node) => n + (node.span[1] - node.span[0] + 1), 0);
    rounds += 1;
  }
  return { folded, toFold, lines: (await loadMemory(storyId)).nodes.length };
}

export async function restoreRecord(storyId) {
  const backup = await db.settings.get('memoryBackup:' + storyId);
  if (!backup || !Array.isArray(backup.nodes)) return false;
  const mem = await loadMemory(storyId);
  /* M202: the record is the writer's own again — the next rebuild may back it up */
  const { rebuiltAt, ...rest } = mem;
  await saveMemory(storyId, { ...rest, nodes: backup.nodes });
  return true;
}

/* ---------- the people ---------- */

const READER_SYSTEM = [
  'You are reading a story\'s past, six pages at a time, to rebuild what the house knows of its people.',
  'You are handed what came before (the record, the pages of the people as they stand, the standings as',
  'they stand) and the next few pages. Answer with what THESE pages change — nothing already written.',
  '',
  'Answer with JSON ONLY: {"deltas":[ ... ],"shifts":[ ... ]}',
  '  deltas — the scribe\'s: {"name":"NAME","field":"core|state|arc","text":"…"} — core is who they are (rarely',
  '           changes), state is how they are now, arc is how they stand with the main character and WHY it',
  '           moved. One per person per field at most; only for people these pages show.',
  '  shifts — the reader\'s: {"name":"NAME","axis":"p|r|s","delta":-20..20,"cause":"the beat, quoting the page"}',
  '           — a standing moves ONLY when these pages reveal something new about the main character or the',
  '           bond, through that person\'s own nature; typical ±1–5, a major moment ±10–20. Only toward the',
  '           main character. No revelation, no shift. Everything else in the story is not yours here.',
  'No commentary, no fences: the JSON only.',
].join('\n');

function recordUpTo(mem, pageIndex) {
  return (mem && Array.isArray(mem.nodes) ? mem.nodes : [])
    .filter((n) => n && Array.isArray(n.span) && n.span[1] < pageIndex)
    .sort((a, b) => a.span[0] - b.span[0])
    .map((n) => n.text.trim())
    .join('\n');
}

export function buildReaderMessages({ state, record, pages, mc }) {
  const people = renderPeopleTiers(state, { recentPages: [] }) || '(no pages of the people yet)';
  const standings = renderRelationships(state.relationships) || '(no standings yet)';
  const user = [
    'The main character is ' + (mc || 'the one the writer plays') + '.',
    '',
    'THE RECORD SO FAR (what the pages before these established):',
    record || '(nothing yet — these are the first pages)',
    '',
    'THE PAGES OF THE PEOPLE AS THEY STAND:',
    people,
    '',
    'THE STANDINGS AS THEY STAND (toward ' + (mc || 'the main character') + '):',
    standings,
    '',
    'THE NEXT PAGES:',
    pages.map((p) => (p.role === 'assistant' ? 'STORY: ' : 'PLAYER: ') + String(p.text || '').slice(0, 5000)).join('\n\n'),
    '',
    'What do these pages change? JSON only.',
  ].join('\n');
  return { system: withFictionFrame(READER_SYSTEM), user };
}

export function parseReaderAnswer(raw) {
  try {
    const text = String(raw || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/```(?:json|JSON)?/g, '');
    for (const c of balancedCandidates(text, 5)) {
      const p = parseLenient(c);
      if (p && (Array.isArray(p.deltas) || Array.isArray(p.shifts))) {
        return {
          deltas: (Array.isArray(p.deltas) ? p.deltas : []).filter((d) => d && typeof d.name === 'string' && typeof d.field === 'string' && typeof d.text === 'string'),
          shifts: (Array.isArray(p.shifts) ? p.shifts : []).filter((s) => s && typeof s.name === 'string' && ['p', 'r', 's'].includes(s.axis) && Number.isFinite(Number(s.delta)) && typeof s.cause === 'string'),
        };
      }
    }
  } catch (err) { /* nothing usable */ }
  return { deltas: [], shifts: [] };
}

export async function rebuildPeople({ connection, storyId, brief = '', castNotes = '', onProgress, signal, stale, renew } = {}) {
  if (!connection || !storyId) return null;
  const state = await loadState(storyId);
  const mc = mcName(state) !== 'the player' ? mcName(state) : '';
  /* M165: THE WAY BACK IS NEVER OVERWRITTEN BY A SECOND ATTEMPT. The backup
   * was taken unconditionally, so a writer who ran the rebuild, disliked
   * what it made, and ran it again saved the REBUILD'S OWN OUTPUT over the
   * hand-written world — and "put the people back" then put back the thing
   * they were trying to undo. Proven: forty pages of a written core became
   * "an innkeeper", unreachable. A state that a rebuild produced keeps the
   * backup that stands; only a hand-written world is ever backed up. */
  const hadBackup = await db.settings.get('peopleBackup:' + storyId);
  if (!(hadBackup && state.peopleRebuiltAt)) {
    await db.settings.set('peopleBackup:' + storyId, { at: Date.now(), characters: state.characters, relationships: state.relationships });
  }
  /* let go, in the log, as one sweep */
  const clear = [
    ...Object.keys(state.relationships || {}).map((k) => ({ type: 'rel.clear', name: k, cause: 'rebuilt from the pages by the writer’s hand' })),
  ];
  let { state: s } = applyMutations(state, clear);
  s = { ...s, characters: {} };
  /* the standings' origin: the writer's digits */
  const digits = (await readStatedStandings({ connection, brief, castNotes, mc, signal }))
    .map((st) => ({ type: 'rel.set', name: st.name, p: st.p, r: st.r, s: st.s, cause: 'the brief states (P:' + st.p + ' R:' + st.r + ' S:' + st.s + ') toward ' + (mc || 'the main character') }));
  ({ state: s } = applyMutations(s, digits));
  /* M165: the mark that says this world came from a rebuild, so the next
   * attempt keeps the way back to the hand-written one. */
  s = { ...s, peopleRebuiltAt: Date.now() };
  await saveState(storyId, s);
  notify(storyId);

  const history = visiblePages(await db.messages.list(storyId)).map((m) => ({ role: m.role, text: pageText(m) }));
  const mem = await loadMemory(storyId);
  const batch = DEFAULT_BATCH;
  let read = 0;
  let applied = 0;
  let refused = 0;
  for (let from = 0; from < history.length; from += batch) {
    /* M207: this batch gets its own minute (see the record rebuild).
     * M213: and a run cut short reports what it READ, never null — null
     * printed as "nothing to rebuild" over work that had really happened. */
    if (typeof renew === 'function' && !renew()) {
      return { read, total: history.length, applied, refused, digits: 0, stalled: true,
        why: 'the run was cut short — press Rebuild to start again' };
    }
    if (stale && stale()) return null;
    const pages = history.slice(from, from + batch);
    const current = await loadState(storyId);
    const prompt = buildReaderMessages({ state: current, record: recordUpTo(mem, from), pages, mc });
    const { text } = await callWorker(connection, { system: prompt.system, user: prompt.user, maxTokens: MAX_TOKENS, signal });
    const answer = parseReaderAnswer(text);
    /* a name the ledger already knows wins over the reader's spelling —
     * "Rias" lands on "Rias Wells", never beside her */
    const known = [...Object.keys(current.relationships || {}), ...Object.keys(current.characters || {})];
    const resolve = (name) => known.find((k) => samePersonLoose(k, name)) || name;
    const mutations = [];
    for (const d of answer.deltas) {
      if (mc && samePersonLoose(d.name, mc) && d.field !== 'state') continue; /* the MC's core and arc are the story's */
      mutations.push({ type: 'people.set', name: resolve(d.name), field: d.field, text: d.text });
    }
    for (const sh of answer.shifts) {
      if (mc && samePersonLoose(sh.name, mc)) { refused += 1; continue; }
      mutations.push({ type: 'rel.shift', name: resolve(sh.name), axis: sh.axis, delta: Number(sh.delta), cause: sh.cause });
    }
    if (mutations.length) {
      const fresh = await loadState(storyId);
      const r = applyMutations(fresh, mutations);
      applied += r.applied.length;
      refused += r.rejected.length;
      await saveState(storyId, r.state);
      notify(storyId);
    }
    read = Math.min(history.length, from + batch);
    if (typeof onProgress === 'function') onProgress({ read, total: history.length });
  }
  return { read, total: history.length, applied, refused, digits: digits.length };
}

export async function restorePeople(storyId) {
  const backup = await db.settings.get('peopleBackup:' + storyId);
  if (!backup) return false;
  const state = await loadState(storyId);
  /* M165: the world is hand-written again — the next rebuild may back it up. */
  const { peopleRebuiltAt, ...rest } = state;
  await saveState(storyId, { ...rest, characters: backup.characters || {}, relationships: backup.relationships || {} });
  notify(storyId);
  return true;
}

export function rebuildRecordWords(r) {
  if (!r) return 'nothing to rebuild';
  /* M202: a rebuild that stopped early says so, instead of reporting its
   * half as the whole and leaving the writer to wonder. */
  if (r.stalled) {
    return `the rebuild stopped at ${r.folded} of ${r.toFold} pages — ${r.why}`;
  }
  return `rebuilt the record: folded ${r.folded} of ${r.toFold} pages into ${r.lines} ${r.lines === 1 ? 'line' : 'lines'}`;
}
export function rebuildPeopleWords(r) {
  if (!r) return 'nothing to rebuild';
  /* M214: a run cut short says so. rebuildRecordWords learned this at M202
   * and this one was left behind — so a people rebuild the leash cut off at
   * page 24 of 118 still read "rebuilt the people: read 24 of 118 pages",
   * which is a sentence that sounds like success. */
  if (r.stalled) return `the rebuild stopped at ${r.read} of ${r.total} pages — ${r.why}`;
  return `rebuilt the people: read ${r.read} of ${r.total} pages six at a time — ${r.digits} standings from the brief’s digits, ${r.applied} changes from the pages` + (r.refused ? ` (${r.refused} refused)` : '');
}
