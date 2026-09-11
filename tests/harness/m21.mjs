/* M21: shelf previews, the frame's purpose line + echo, TRUE rollback,
 * and the workers' fiction frame. */
import './idb-shim.mjs';
import { readFileSync } from 'node:fs';
import { test, assert, eq } from './lib.mjs';
import { buildRequest, FRAME_PURPOSE, pageText } from '../../js/assemble/stack.js';
import { makePreview, boundaryFor } from '../../js/ui/chat.js';
import {
  emptyState, loadState, saveState, snapshotState, restoreSnapshot, SNAP_CAP,
} from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { FICTION_FRAME } from '../../js/agents/voice.js';
import { buildExtractorMessages } from '../../js/agents/extractor.js';
import { buildScribeMessages } from '../../js/agents/scribe.js';
import { buildMemoryMessages, buildFoldMessages, buildAuditMessages } from '../../js/agents/memory.js';
import { buildContinuityMessages } from '../../js/agents/continuity.js';
import { buildEditorMessages } from '../../js/agents/editor.js';

const root = new URL('../../', import.meta.url);
const src = (p) => readFileSync(new URL(p, root), 'utf8');

/* ---------- A. shelf previews ---------- */

test('M21-A: the preview skips the scene header and reads the beginning', () => {
  const text = '[The Wayward Lantern — a wet evening]\nThe rain would not let up. Mara counted the coins twice. The door opened again.';
  eq(makePreview(text), 'The rain would not let up. Mara counted the coins twice.', 'header skipped, two sentences kept');
});

test('M21-A: the thinking voice never reaches the preview', () => {
  const msg = { role: 'assistant', text: 'The kettle sang. She poured.', thinking: 'weigh the hour, keep it slow' };
  const preview = makePreview(pageText(msg));
  assert(!preview.includes('weigh'), 'thinking stays out of the preview');
  eq(preview, 'The kettle sang. She poured.', 'prose only');
});

test('M21-A: the preview clamps to a sentence or two within ~120 chars', () => {
  const long = 'A short line. ' + 'B'.repeat(200) + '. A third sentence follows here.';
  const preview = makePreview(long);
  assert(preview.length <= 120, 'inside the budget: ' + preview.length);
  eq(preview, 'A short line.', 'a second sentence that would burst the budget simply stays home');
  const oneLong = 'C'.repeat(300);
  const clamped = makePreview(oneLong);
  assert(clamped.length <= 120 && clamped.endsWith('…'), 'one long sentence is trimmed with an ellipsis');
  eq(makePreview('[Only a header]\n'), '', 'a header-only page previews to nothing');
});

test('M21-A: the shelf row gains the preview on append, swipe, and delete', () => {
  const chat = src('js/ui/chat.js');
  const calls = chat.match(/await refreshPreview\(story\.id\)/g) || [];
  assert(calls.length >= 6, 'refreshPreview rides append, swipe (both paths), delete, regenerate, edit: ' + calls.length);
  assert(/async function refreshPreview[\s\S]*?makePreview\(pageText\(last\)\)/.test(chat), 'the preview re-reads the latest page');
  assert(/!m\.hidden/.test(chat.slice(chat.indexOf('async function refreshPreview'), chat.indexOf('async function refreshPreview') + 600)), 'hidden nudges never preview');
  assert(/s\.preview = makePreview\(pageText\(last\)\)/.test(chat), 'backfill derives it from the last page on load');
  assert(chat.includes('story-preview'), 'the row renders the preview');
  assert(/story-preview[\s\S]*?line-clamp: 2/.test(src('css/chat.css')), 'two-line clamp in --text-2 quiet');
});

/* ---------- B. the frame's purpose line + the echo ---------- */

const B_OPTS = () => ({ story: {}, messages: [{ role: 'user', text: 'hello there' }], state: {}, modules: [], memory: '', window: { keeperOn: true } });

test('M21-B: the purpose line rides slot 1 by default, named on the receipt', () => {
  const r = buildRequest({ ...B_OPTS(), settings: {} });
  assert(r.systemBlocks[0].text.includes(FRAME_PURPOSE), 'slot 1 = frame + purpose by default');
  const slotRow = r.receipt.slots.find((s) => s.name === 'The frame');
  assert(/purpose spoken after it/.test(slotRow.reason), 'the receipt names the purpose line');
});

test('M21-B: switched off, the frame stands alone; a cleared line stays cleared', () => {
  const off = buildRequest({ ...B_OPTS(), settings: { frameText: 'frame words', framePurposeOn: false } });
  eq(off.systemBlocks[0].text, 'frame words', 'no purpose when switched off');
  eq(off.receipt.slots.find((s) => s.name === 'The frame').reason, '', 'no purpose reason either');
  const own = buildRequest({ ...B_OPTS(), settings: { frameText: 'frame words', framePurpose: 'My own line.' } });
  assert(own.systemBlocks[0].text === 'frame words\n\nMy own line.', 'the writer’s own line rides');
  const cleared = buildRequest({ ...B_OPTS(), settings: { frameText: 'frame words', framePurpose: '' } });
  eq(cleared.systemBlocks[0].text, 'frame words', 'a cleared line stays cleared');
});

test('M21-B: the echo repeats the whole frame just before the note', () => {
  const r = buildRequest({ ...B_OPTS(), settings: { frameText: 'frame words', noteText: 'the note', frameEcho: true } });
  const echoAt = r.messages.findIndex((m) => m.content.includes('frame words') && m.content.includes(FRAME_PURPOSE));
  const noteAt = r.messages.findIndex((m) => m.content === 'the note');
  assert(echoAt !== -1 && noteAt !== -1, 'both ride the wire');
  eq(noteAt - echoAt, 1, 'the mirror sits immediately before the note at the end');
  const echoRow = r.receipt.slots.find((s) => s.name === 'The frame, said again');
  assert(echoRow && echoRow.tokens > 0, 'the receipt names the echo');
  const noteRowIdx = r.receipt.slots.findIndex((s) => s.name === 'The note at the end');
  eq(r.receipt.slots[noteRowIdx - 1].name, 'The frame, said again', 'receipt order mirrors the wire');
});

test('M21-B: echo off by default — nothing repeats', () => {
  const r = buildRequest({ ...B_OPTS(), settings: { frameText: 'frame words', noteText: 'the note' } });
  assert(!r.receipt.slots.some((s) => s.name === 'The frame, said again'), 'no echo row');
  const tails = r.messages.filter((m) => String(m.content).includes('frame words'));
  eq(tails.length, 0, 'the frame rides slot 1 only');
});

test('M21-B: the settings surface carries the controls and the wiring', () => {
  const html = src('index.html');
  assert(html.includes('id="frame-purpose"') && html.includes('id="frame-purpose-on"') && html.includes('id="frame-echo"'), 'the frame section gains the three controls');
  const settings = src('js/ui/settings.js');
  assert(settings.includes("db.settings.set('framePurpose'") && settings.includes("db.settings.set('framePurposeOn'") && settings.includes("db.settings.set('frameEcho'"), 'all three persist');
  const chat = src('js/ui/chat.js');
  assert(chat.includes('framePurposeOn') && chat.includes('frameEcho'), 'the send path gathers them');
});

/* ---------- C. TRUE rollback — state snapshots ---------- */

test('M21-C: snapshot/restore round-trip', async () => {
  const storyId = 'm21-roundtrip';
  const base = emptyState();
  base.present = [{ name: 'Mira' }];
  await saveState(storyId, base);
  await snapshotState(storyId, 'u1');
  const hurt = applyMutations(await loadState(storyId), [
    { type: 'body.injure', name: 'Mara', what: 'left forearm fractured', sev: 2 },
  ]);
  assert(hurt.applied.length === 1, 'the injury applies');
  await saveState(storyId, hurt.state);
  assert((await loadState(storyId)).bodies.Mara, 'the ledger carries the wound');
  const restored = await restoreSnapshot(storyId, 'u1');
  assert(restored && !restored.bodies.Mara, 'the restore hands back the un-hurt ledger');
  assert(!(await loadState(storyId)).bodies.Mara, 'and it is saved');
});

test('M21-C: the snapshot shelf caps at ' + SNAP_CAP, async () => {
  const storyId = 'm21-cap';
  await saveState(storyId, emptyState());
  /* M44: retention is sparse — dense newest, every fifth older; the newest is always kept, the shelf never exceeds the cap */
  for (let i = 0; i < SNAP_CAP + 5; i += 1) await snapshotState(storyId, 'u' + i);
  const { db } = await import('../../js/store.js');
  const list = await db.settings.get('snapshots:' + storyId);
  assert(list.length <= SNAP_CAP && list.length >= 40, 'the shelf keeps the dense newest and a sparse older set within the cap: ' + list.length);
  eq(list[list.length - 1].id, 'u' + (SNAP_CAP + 4), 'newest kept');
});

test('M21-C: regenerate-rewinds — the injury of a rewritten turn vanishes', async () => {
  const storyId = 'm21-rewind';
  await saveState(storyId, emptyState());
  /* Two turns: u1/a1 pass quietly; at u2's boundary the snapshot is taken,
   * then the turn's workers commit an injury. */
  await snapshotState(storyId, 'u1');
  const hurt = applyMutations(await loadState(storyId), [
    { type: 'body.injure', name: 'Mara', what: 'a opened palm', sev: 1 },
  ]);
  await saveState(storyId, hurt.state);
  const history = [
    { id: 'u1', role: 'user', text: 'we spar' },
    { id: 'a1', role: 'assistant', text: 'steel rang' },
    { id: 'u2', role: 'user', text: 'again' },
    { id: 'a2', role: 'assistant', text: 'the knife bit' },
  ];
  await snapshotState(storyId, 'u2');
  const worse = applyMutations(await loadState(storyId), [
    { type: 'body.injure', name: 'Mara', what: 'a cut across the ribs', sev: 2 },
  ]);
  await saveState(storyId, worse.state);
  eq((await loadState(storyId)).bodies.Mara.injuries.length, 2, 'two wounds stand');
  /* Rewind the second turn (regenerate-from-here at a2): boundary = u2. */
  const boundary = boundaryFor(history, 'a2');
  eq(boundary.id, 'u2', 'the boundary is the turn’s user page');
  await restoreSnapshot(storyId, boundary.id);
  const after = await loadState(storyId);
  eq(after.bodies.Mara.injuries.length, 1, 'the rewritten turn’s injury is gone from the ledger');
  const { db } = await import('../../js/store.js');
  const snaps = await db.settings.get('snapshots:' + storyId);
  /* The boundary itself (u2) stays — it IS the state now standing — and
   * anything newer drops with the rewind. */
  eq(snaps.map((e) => e.id).join(','), 'u1,u2', 'the boundary keeps, the newer snapshots drop');
});

test('M21-C: branch isolation — one telling’s rollback never touches another', async () => {
  const a = 'm21-branch-a';
  const b = 'm21-branch-b';
  const stateA = emptyState();
  stateA.present = [{ name: 'Ash' }];
  await saveState(a, stateA);
  await snapshotState(a, 'u1');
  const stateB = emptyState();
  stateB.present = [{ name: 'Bex' }];
  await saveState(b, stateB);
  eq(await restoreSnapshot(b, 'u1'), null, 'the branch holds no snapshots of the old telling');
  await restoreSnapshot(a, 'u1');
  eq((await loadState(b)).present[0].name, 'Bex', 'the branch’s ledger stands untouched');
});

test('M21-C: the rewind law is wired in chat.js — snapshot before the chain, restore before the rewrite', () => {
  const chat = src('js/ui/chat.js');
  const gen = chat.slice(chat.indexOf('async function generate'));
  /* M72: the boundary is taken AFTER the referee commits — it carries the committed fate, so a swipe replays instead of rolling again */
  assert(gen.indexOf('refereeStep') < gen.indexOf('await snapshotState'), 'the boundary is taken after the referee commits (M72)');
  assert(gen.indexOf('state.page = history.filter') < gen.indexOf('refereeStep'), 'the coming page stamps everything the turn writes before it lands (M72)');
  const regen = chat.slice(chat.indexOf('async function regenerateFrom'), chat.indexOf('/* ---------- swipes'));
  assert(regen.indexOf('rewindTo') < regen.indexOf('deleteFrom'), 'regenerate rewinds (exact or nearest, M44) before deleteFrom');
  assert(regen.indexOf('pendingWork') < regen.indexOf('rewindTo'), 'workers still settle first (B5)');
  const swipeRegen = chat.slice(chat.indexOf('async function swipeRegenerate'), chat.indexOf('/* ---------- edit'));
  assert(/rewindTo/.test(swipeRegen), 'swipe-creation rewinds to the boundary (M44: exact or nearest)');
  assert(src('js/store.js').includes("s.delete('snapshots:' + id)"), 'the snapshots go with a let-go story');
});

/* ---------- D. the workers never break the fiction ---------- */

test('M21-D: every agent module sources the shared FICTION_FRAME', () => {
  assert(FICTION_FRAME.includes('fiction craft for a tale being written together'), 'the standing line');
  const modules = ['extractor', 'scribe', 'memory', 'continuity', 'referee', 'housekeeper', 'director', 'editor'];
  for (const name of modules) {
    const code = src(`js/agents/${name}.js`);
    assert(code.includes("from './voice.js'"), name + ' imports voice.js');
    assert(/withFictionFrame\(/.test(code), name + ' prepends the frame');
  }
});

test('M21-D: the frame actually leads the workers’ system prompts', () => {
  const builders = [
    buildExtractorMessages({ state: {}, userText: 'x', assistantText: 'y' }),
    buildScribeMessages({ state: emptyState(), userText: 'x', assistantText: 'y' }),
    buildMemoryMessages([{ role: 'assistant', text: 'a page' }]),
    buildFoldMessages([{ text: 'a note' }]),
    buildAuditMessages('pages', 'note'),
    buildContinuityMessages({ state: emptyState(), assistantText: 'y' }),
    buildEditorMessages({ story: {}, messages: [], state: emptyState(), prev: {} }),
  ];
  for (const m of builders) {
    assert(String(m.system).startsWith(FICTION_FRAME + '\n\n'), 'the frame leads: ' + String(m.system).slice(0, 60));
  }
});
