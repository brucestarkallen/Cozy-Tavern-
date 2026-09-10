/* M62 — Chat Assistant's panel, whole: sessions, commands, director tools. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { loadSession, saveSession, loadSessionRoot, listSessions, switchSession, newSession, branchSession, renameSession, deleteSession, clearSession, deleteLastExchange, expandCommand, COMMANDS } from '../../js/agents/housekeeper.js';
import { directorStatus, directorIdeas, directorSteer, directorOff, saveDirector, loadDirector } from '../../js/agents/director.js';
import { db } from '../../js/store.js';

test('M62-1 sessions: the old shape migrates; new, branch, branch-at, rename, delete, clear, delete-last; batches are shared', async () => {
  const sid = 'm62-sess';
  await db.settings.set('hk:' + sid, { turns: [{ role: 'writer', text: 'q1', ts: 1 }, { role: 'housekeeper', text: 'a1', ts: 2 }, { role: 'writer', text: 'q2', ts: 3 }, { role: 'housekeeper', text: 'a2', ts: 4 }], batches: [{ id: 'b1', items: [] }] });
  let s = await loadSession(sid);
  eq(s.name, 'Session 1'); eq(s.turns.length, 4); eq(s.batches.length, 1, 'the old shape migrated');
  s = await newSession(sid);
  eq(s.name, 'Session 2'); eq(s.turns.length, 0); eq(s.batches.length, 1, 'batches shared');
  s = await switchSession(sid, 1);
  eq(s.turns.length, 4);
  s = await branchSession(sid);
  eq(s.name, 'Session 1 (branch)'); eq(s.turns.length, 4);
  s = await switchSession(sid, 1);
  s = await branchSession(sid, 1);
  eq(s.name, 'Session 1 @2'); eq(s.turns.length, 2, 'branched at the first exchange');
  s = await renameSession(sid, 'The porch question');
  eq(s.name, 'The porch question');
  const list = await listSessions(sid);
  eq(list.sessions.length, 4); eq(list.activeId, s.id);
  s = await deleteSession(sid);
  eq((await listSessions(sid)).sessions.length, 3);
  s = await switchSession(sid, 1);
  s = await deleteLastExchange(sid);
  eq(s.turns.length, 2, 'the last question and answer gone');
  s = await clearSession(sid);
  eq(s.turns.length, 0);
  /* saveSession writes the active session's turns into the root */
  s.turns.push({ role: 'writer', text: 'again', ts: 5 });
  await saveSession(sid, s);
  const root = await loadSessionRoot(sid);
  eq(root.sessions.find((x) => x.id === 1).turns.length, 1);
  /* a lone session cannot be deleted, only emptied */
  await db.settings.set('hk:' + 'm62-one', { sessions: [{ id: 1, name: 'Session 1', turns: [{ role: 'writer', text: 'x', ts: 1 }] }], activeId: 1, batches: [] });
  eq((await deleteSession('m62-one')).turns.length, 0);
});

test('M62-2 the shortcut commands expand; the writer’s detail rides; a plain line is untouched', () => {
  for (const k of Object.keys(COMMANDS)) assert(expandCommand('#' + k + ' x').tag === k, k);
  const f = expandCommand('#f');
  assert(/FIX the continuity errors/.test(f.text));
  const p = expandCommand('#p Rias');
  assert(/psychology read/.test(p.text) && /The writer adds: Rias/.test(p.text));
  eq(expandCommand('is Rias here?').tag, '');
  eq(expandCommand('#fixit').tag, '', 'a word that merely starts with a tag is not a command');
});

test('M62-3 the director’s tools: status (spoiler-free), ideas, steer, off', async () => {
  const sid = 'm62-dir';
  await db.messages.append(sid, { role: 'assistant', text: 'Rias waited on the porch.' });
  await saveDirector(sid, { text: 'EPISODE QUESTION: will he tell her? beats: …', episode: 3, concluded: false });
  const call = async ({ system, messages }) => ({ text: /progress/.test(system) ? 'It stands mid-way; one door is still open; not yet.' : /SEEDS/.test(system) ? '1. a door\n2. another\n3. a third' : 'RE-AIMED: ' + messages[0].content.slice(0, 20) });
  const st = await directorStatus({ storyId: sid, call });
  assert(st.ok && /mid-way/.test(st.words));
  const ideas = await directorIdeas({ storyId: sid, story: { brief: 'b' }, call });
  assert(ideas.ok && /3\. a third/.test(ideas.words));
  const steer = await directorSteer({ storyId: sid, story: {}, direction: 'make Kris arrive', call });
  assert(steer.ok && /RE-AIMED/.test((await loadDirector(sid)).text) && (await loadDirector(sid)).episode === 3, 'the episode keeps its number');
  const off = await directorOff(sid);
  assert(off.ok && (await loadDirector(sid)).text === '' && (await loadDirector(sid)).episode === 0);
  const none = await directorStatus({ storyId: sid, call });
  assert(!none.ok);
});

test('M62-4 the panel wears the whole toolbar', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  for (const id of ['hk-session', 'hk-sess-new', 'hk-sess-branch', 'hk-sess-rename', 'hk-sess-delete', 'hk-stop', 'hk-more', 'hk-more-menu', 'hk-cards', 'hk-apply-all', 'hk-dismiss-all', 'hk-repropose', 'hk-toggle-cards', 'hk-clear', 'hk-del-last', 'hk-dir-status', 'btn-hk-full', 'hk-retry']) assert(html.includes('id="' + id + '"'), id);
  for (const act of ['context', 'raw', 'dir-peek', 'dir-ideas', 'dir-off', 'crit-peek', 'name-story', 'rename-story', 'commands', 'rules', 'ask-i', 'ask-p', 'ask-br', 'ask-opt', 'ask-cl']) assert(html.includes('data-act="' + act + '"'), act);
  assert(!html.includes('hk-clear-done'), 'no "clear done" — done cards leave a receipt in the talk');
  const ui = readFileSync(new URL('../../js/ui/housekeeper.js', import.meta.url), 'utf8');
  assert(/hk-branch-here/.test(ui) && /async function sessionAct/.test(ui) && /async function directorTool/.test(ui) && /async function nameStory/.test(ui));
});
