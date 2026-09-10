/* M40 — versions keep their ledger; the swipe bar; the thinking clock; seated people have pages; rescan. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { parseWorldAnswer, worldTurn } from '../../js/agents/world.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { thinkingHouse, withHouse, HOUSES } from './thinkinghouse.mjs';

const chat = () => readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');

test('M40-1 a cancelled swipe gives the ledger back; every version keeps the ledger it earned', () => {
  const c = chat();
  assert(/const leaving = await loadState\(story\.id\);[\s\S]*const landed = await generate\(\{ swipeTarget: msg \}\);[\s\S]*if \(!landed\) \{[\s\S]*await saveState\(story\.id, leaving\);/.test(c), 'the swipe keeps the ledger it left and gives it back on a cancel');
  assert(/enqueue\('checkpoint'/.test(c) && /saveVersionState\(story\.id, msg\.id, idx, await loadState\(story\.id\)\)/.test(c), 'a checkpoint per version after the readers finish');
  assert(/const known = await versionStateFor\(story\.id, msg\.id, next\);[\s\S]*if \(known\) \{[\s\S]*await saveState\(story\.id, known\);/.test(c), 'walking to a version restores its ledger');
  assert(/return landed;/.test(c), 'generate says whether a page landed');
});

test('M40-2 the swipe bar: arrows and n/N at the page’s foot; the word "swipe" left the row', () => {
  const c = chat();
  const row = c.slice(c.indexOf('function actionsNode('), c.indexOf('function actionsNode(') + 1600);
  assert(!/acts\.push\('swipe'\)/.test(row), 'no swipe word in the row');
  assert(/wrap\.className = 'swipe-bar'/.test(c) && /if \(swipes\.length < 2 && !isLastAssistant\) return null;/.test(c), 'the bar shows on the last page, or where versions exist');
  const css = readFileSync(new URL('../../css/chat.css', import.meta.url), 'utf8');
  assert(/\.swipe-bar \{ display: flex; justify-content: flex-end/.test(css));
});

test('M40-3 the thinking clock is kept on the page and its versions', () => {
  const c = chat();
  assert(/function thinkingWords\(ms\)/.test(c) && /thinkingNode\(msg\.thinking, msg\.thinkingMs\)/.test(c));
  assert(/thinkingMs: thinkStart \? Math\.max\(1, thinkMs\) : undefined/.test(c), 'saved on the page and the swipe whenever a thought was seen (M46)');
  assert(/setInterval\(\(\) => \{/.test(c) && /thinking-took/.test(c), 'a live clock while it thinks');
});

test('M40-4 starters are off unless asked; the rescan exists; the people panel exists', () => {
  const c = chat();
  assert(/\(await db\.settings\.get\('showStarters'\)\) !== true\) \{ els\.promptChips\.hidden = true; return; \}/.test(c));
  assert(/async function rescanLedger\(\)/.test(c) && /startBackgroundWork\(story, last, lastUser \? pageText\(lastUser\) : '', \{ deep: true \}\)/.test(c));
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert(html.includes('id="show-starters"'));
  const drawer = readFileSync(new URL('../../js/ui/drawer.js', import.meta.url), 'utf8');
  assert(/id: 'the-people'/.test(drawer) && /Read the pages again/.test(drawer));
});

test('M40-5 everyone the world agent seats has a page', async () => {
  const storyId = 'm40-pages';
  const s = emptyState(); s.sheet.playerName = 'Jovan';
  await saveState(storyId, s);
  const answer = JSON.stringify({ mutations: [
    { type: 'offscreen.set', name: 'Kim', location: 'her apartment', activity: 'scrolling', agenda: 'find out who he is with', stance: 'seeking' },
    { type: 'people.set', name: 'Kris', field: 'core', text: 'the mother' },
    { type: 'offscreen.set', name: 'Kris', location: 'the office', activity: 'on a call' },
  ], brief: { pressure: [], ripe: [], twb: null } });
  const house = thinkingHouse({ answer });
  await withHouse(house, () => worldTurn({ connection: HOUSES[0].conn, storyId, userText: 'u', assistantText: 'a', stale: () => false }));
  const st = await loadState(storyId);
  const names = Object.keys(st.characters).map((k) => k.toLowerCase());
  assert(names.includes('kim') && names.includes('kris'), 'both seated people have pages: ' + names.join(', '));
  assert(/scrolling; wants find out who he is with; at her apartment/.test(st.characters.Kim.core), 'a minimal core from the seat: ' + st.characters.Kim.core);
  eq(st.characters.Kris.core, 'the mother', 'an explicit page is kept as given');
});
