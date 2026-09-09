/* M10 — the showrunners: the director's state machine (modes new/next/
 * seed/edit/restart, the three passes, auto mode, the [EPISODE_END] strip
 * and the auto-next chain), the editor's standing critique and its diff,
 * and the two dynamic-tail injection slots with their receipt names. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { saveState, emptyState, loadState } from '../../js/engine/state.js';
import { buildRequest } from '../../js/assemble/stack.js';
import {
  stripEpisodeEnd, loadDirector, saveDirector, markConcluded,
  renderDirectorNote, runDirector, maybeAutoDirector, afterEpisodeEnd,
  EPISODE_MARK,
} from '../../js/agents/director.js';
import {
  loadEditor, saveEditor, renderEditorNote, parseCritique, diffCritique,
  maybeRunEditor, runEditor,
} from '../../js/agents/editor.js';

/* A fake model caller for the harness: answers by cue words in the
 * system prompt, counts its calls, never touches a network. */
function fakeCaller(answers) {
  const calls = [];
  const fn = async ({ system, messages }) => {
    calls.push({ system, messages });
    const s = String(system || '');
    if (/watcher/i.test(s)) return { text: JSON.stringify(answers.watch || { ok: true }) };
    if (/showrunner/i.test(s)) return { text: answers.polish || '' };
    if (/director/i.test(s)) return { text: answers.draft || '' };
    if (/editor/i.test(s)) return { text: answers.critique || '' };
    return { text: '' };
  };
  fn.calls = calls;
  return fn;
}

const DIRECTIVE_TEXT = [
  'PREMISE — the miller’s debt comes due.',
  'QUESTION — will Mira pay it in coin or in promises?',
  'BEATS — 1. A stranger from the county rides in. 2. The middle turns when',
  'the ledger goes missing. 3. The dilemma: burn the note or sell the mill.',
  '4. B-beat: the dog steals the stranger’s glove.',
  'NPC & WORLD INITIATIVE — the river rises whether anyone watches or not.',
  'LANDING — the debt is repriced whatever branch they take.',
  'HOOK — the glove, planted early.',
  'ARC — Mira learns what the mill is worth to her.',
].join('\n');

/* ---------- the mark ---------- */

test('M10 strip: [EPISODE_END] is stripped from prose before save', () => {
  const r = stripEpisodeEnd('The door closed.\n\n[EPISODE_END]');
  assert(r.ended, 'the mark is read');
  eq(r.text, 'The door closed.', 'the mark never reaches the page');
  const none = stripEpisodeEnd('The door closed.');
  assert(!none.ended && none.text === 'The door closed.', 'no mark, no change');
  const mid = stripEpisodeEnd('It ended. [EPISODE_END]\n');
  assert(mid.ended && !/\[EPISODE_END\]/i.test(mid.text), 'even mid-text marks strip clean');
});

/* ---------- the director's state machine ---------- */

test('M10 director: modes new/next/seed/edit/restart hold the state law', async () => {
  const story = await db.stories.create({ title: 'Modes' });
  const call = fakeCaller({ draft: DIRECTIVE_TEXT });

  /* new — the first episode, all three passes run */
  let r = await runDirector({ storyId: story.id, story, mode: 'new', call });
  assert(r.ok, 'new: ' + r.error);
  eq(r.state.episode, 1, 'episode one stands');
  assert(r.state.text.includes('PREMISE'), 'the directive text landed');
  eq(call.calls.length, 3, 'draft + polish + watcher all ran');

  /* next — the episode advances */
  r = await runDirector({ storyId: story.id, story, mode: 'next', call });
  assert(r.ok, 'next: ' + r.error);
  eq(r.state.episode, 2, 'the episode advanced');
  assert(r.state.concluded === false, 'a fresh directive is not concluded');

  /* seed — the writer’s line rides the brief */
  const callsBefore = call.calls.length;
  r = await runDirector({ storyId: story.id, story, mode: 'seed', seedText: 'a letter never sent', call });
  assert(r.ok, 'seed: ' + r.error);
  eq(r.state.episode, 3, 'the seed opens the next episode');
  assert(String(call.calls[callsBefore].messages[0].content).includes('a letter never sent'),
    'the seed text rode the brief');

  /* edit — hand-inked, no model */
  r = await runDirector({ storyId: story.id, story, mode: 'edit', editText: 'By hand: keep the mill.' });
  assert(r.ok && r.state.text === 'By hand: keep the mill.', 'edit stands');
  eq(r.state.episode, 3, 'the episode number is kept on a hand edit');

  /* restart — the board clears */
  r = await runDirector({ storyId: story.id, story, mode: 'restart' });
  assert(r.ok && r.state.text === '' && r.state.episode === 0, 'the board is clear');
});

test('M10 director: passes are skippable; the watcher’s revision rides', async () => {
  const story = await db.stories.create({ title: 'Passes' });
  const call = fakeCaller({
    draft: 'a rough draft',
    polish: 'a polished draft',
    watch: { ok: false, text: 'the watcher’s revision' },
  });
  const r = await runDirector({ storyId: story.id, story, mode: 'new', call, skipPolish: true, skipWatch: true });
  assert(r.ok, 'skipped passes still land: ' + r.error);
  eq(r.state.text, 'a rough draft', 'the raw draft stands when passes are skipped');
  eq(call.calls.length, 1, 'only the draft pass ran');

  const call2 = fakeCaller({
    draft: DIRECTIVE_TEXT,
    polish: 'polished ' + DIRECTIVE_TEXT.slice(0, 30),
    watch: { ok: false, text: 'PREMISE — revised by the watcher.' },
  });
  const r2 = await runDirector({ storyId: story.id, story, mode: 'next', call: call2 });
  assert(r2.ok, 'the full machine runs: ' + r2.error);
  eq(r2.state.text, 'PREMISE — revised by the watcher.', 'the watcher’s revision is the one kept');
  eq(call2.calls.length, 3, 'three passes ran');
});

test('M10 director: auto mode fires ONLY when none active, in the background', async () => {
  const story = await db.stories.create({ title: 'Auto' });
  const call = fakeCaller({ draft: DIRECTIVE_TEXT });

  /* auto off — nothing happens */
  let ran = await maybeAutoDirector({ storyId: story.id, story, call });
  eq(ran, null, 'auto off stays quiet');

  await saveDirector(story.id, { auto: true });
  ran = await maybeAutoDirector({ storyId: story.id, story, call });
  assert(ran && ran.ok && ran.state.episode === 1, 'auto writes the first episode');

  /* one active at a time: a standing directive is never second-guessed */
  const callsBefore = call.calls.length;
  ran = await maybeAutoDirector({ storyId: story.id, story, call });
  eq(ran, null, 'an active directive is left alone');
  eq(call.calls.length, callsBefore, 'no call was made');

  /* concluded + auto → the next episode comes on its own */
  await markConcluded(story.id);
  ran = await maybeAutoDirector({ storyId: story.id, story, call });
  assert(ran && ran.ok && ran.state.episode === 2, 'auto advances a concluded episode');
});

test('M10 director: the [EPISODE_END] chain — editor review, then auto-next', async () => {
  const story = await db.stories.create({ title: 'Chain' });
  await saveState(story.id, emptyState());
  await db.messages.append(story.id, { role: 'assistant', text: 'The mill wheel stopped.' });
  const call = fakeCaller({
    draft: DIRECTIVE_TEXT,
    critique: 'NORTH STAR: let quiet scenes stay quiet\n1. The endings rush.',
  });
  /* an active directive, the editor on, auto on */
  await runDirector({ storyId: story.id, story, mode: 'new', call });
  await saveDirector(story.id, { auto: true });
  await saveEditor(story.id, { enabled: true });

  const before = call.calls.length;
  const result = await afterEpisodeEnd({ storyId: story.id, story, call });
  const d = await loadDirector(story.id);
  eq(d.episode, 2, 'the next episode stands');
  assert(d.concluded === false && d.text.includes('PREMISE'), 'a fresh directive is active');
  const e = await loadEditor(story.id);
  assert(e.critique && e.critique.northStar.includes('quiet'), 'the editor read the closed episode');
  assert(call.calls.length > before, 'the chain called the model');
  assert(result && result.editor && result.editor.ok, 'the editor’s reading is reported');
});

/* ---------- the editor ---------- */

test('M10 editor: the standing critique parses, stores, and diffs kept vs changed', async () => {
  const story = await db.stories.create({ title: 'Editor' });
  await saveState(story.id, emptyState());
  await db.messages.append(story.id, { role: 'assistant', text: 'Rain again.' });

  const parsed = parseCritique('NORTH STAR: trust the quiet\n1. Endings rush.\n2. The dog gets more agency than Jo.');
  assert(parsed, 'the shape parses');
  eq(parsed.northStar, 'trust the quiet', 'the north star line reads');
  eq(parsed.notes.length, 2, 'the numbered notes read');

  const call = fakeCaller({ critique: 'NORTH STAR: trust the quiet\n1. Endings rush.\n2. Jo’s wants go quiet for pages.' });
  const r1 = await runEditor({ storyId: story.id, story, call });
  assert(r1.ok, 'the first reading lands: ' + (r1 && r1.error));
  eq(r1.diff.added.length, 2, 'everything is new the first time');

  /* second reading: one note kept word for word, one changed */
  const call2 = fakeCaller({ critique: 'NORTH STAR: trust the quiet\n1. Endings rush.\n2. Side characters thin out.' });
  const r2 = await runEditor({ storyId: story.id, story, call: call2 });
  assert(r2.ok, 'the second reading lands');
  eq(r2.diff.kept.length, 1, 'one note kept');
  eq(r2.diff.added.length, 1, 'one note changed');
  eq(r2.diff.retired.length, 1, 'the retired note is named');
  assert(!r2.diff.northStarChanged, 'the north star held');
  const stored = await loadEditor(story.id);
  assert(stored.prev && stored.prev.notes.includes('Jo’s wants go quiet for pages.'),
    'the previous critique is kept for the diff');
});

test('M10 editor: the gate — cadence, episode end, manual', async () => {
  const story = await db.stories.create({ title: 'Gate' });
  await saveState(story.id, emptyState());
  const call = fakeCaller({ critique: 'NORTH STAR: hold the pace\n1. The endings rush.' });

  /* disabled: cadence and episode end rest; manual still fires */
  let r = await maybeRunEditor({ storyId: story.id, story, reason: 'cadence', call });
  eq(r, null, 'off means quiet on the cadence');
  r = await maybeRunEditor({ storyId: story.id, story, reason: 'episode end', call });
  eq(r, null, 'off means quiet at episode end');
  r = await maybeRunEditor({ storyId: story.id, story, reason: 'manual', call });
  assert(r && r.ok, 'a hand-asked reading always fires');

  /* enabled, everyN 8: the cadence waits for turns to pass */
  await saveEditor(story.id, { enabled: true, everyN: 8 });
  r = await maybeRunEditor({ storyId: story.id, story, reason: 'cadence', call });
  eq(r, null, 'too soon after the last reading — it rests');
  /* the turn counter walks on eight turns */
  const s = await loadState(story.id);
  s.turn = (s.turn || 0) + 8;
  await saveState(story.id, s);
  r = await maybeRunEditor({ storyId: story.id, story, reason: 'cadence', call });
  assert(r && r.ok, 'the cadence fires once the turns have passed');
});

/* ---------- the injection slots ---------- */

function stackWith(directorNote, editorEye) {
  return buildRequest({
    story: {}, messages: [{ role: 'user', text: 'a page' }, { role: 'assistant', text: 'another' }],
    settings: {}, state: {}, modules: [], memory: '',
    window: { keeperOn: true }, directorNote, editorEye,
  });
}

test('M10 stack: the director’s note and the editor’s eye ride the dynamic tail, named on the receipt', () => {
  const director = { text: 'PREMISE — the debt.', episode: 2, concluded: false };
  const editor = { enabled: true, critique: { northStar: 'trust the quiet', notes: ['Endings rush.'], at: 1, turn: 1 } };
  const note = renderDirectorNote(director);
  const eye = renderEditorNote(editor);
  assert(note.includes('PREMISE — the debt.'), 'the directive renders');
  assert(note.includes(EPISODE_MARK), 'the note teaches the mark');
  assert(eye.includes('NORTH STAR: trust the quiet'), 'the critique renders');

  const r = stackWith(note, eye);
  const byName = (n) => r.receipt.slots.find((s) => s.name === n);
  assert(byName('The director’s note'), 'the receipt names the director’s slot');
  assert(byName('The editor’s eye'), 'the receipt names the editor’s slot');

  /* before history: the injection sits at the FRONT of the messages */
  const injection = r.messages[0];
  assert(/\[story-state\]/.test(injection.content), 'the dynamic tail rides first');
  assert(injection.content.includes('PREMISE — the debt.'), 'the director’s words are in it');
  assert(injection.content.includes('NORTH STAR: trust the quiet'), 'the editor’s words are in it');
  const firstHistory = r.messages.findIndex((m) => m.content === 'a page');
  assert(firstHistory > 0, 'history comes after the dynamic tail');
});

test('M10 stack: empty showrunner texts omit the slots entirely', () => {
  const r = stackWith('', '');
  assert(!r.receipt.slots.some((s) => s.name === 'The director’s note'), 'no empty director slot');
  assert(!r.receipt.slots.some((s) => s.name === 'The editor’s eye'), 'no empty editor slot');
  /* a concluded directive and a resting editor render empty, too */
  eq(renderDirectorNote({ text: 'PREMISE — x.', episode: 1, concluded: true }), '', 'concluded omits');
  eq(renderEditorNote({ enabled: false, critique: { northStar: 'x', notes: ['y'] } }), '', 'disabled omits');
  const r2 = stackWith('   ', undefined);
  assert(!r2.receipt.slots.some((s) => s.name === 'The director’s note'), 'whitespace omits');
});
