/* Cozy Tavern — harness laws of M528: the deep audit, third pass — a page rewritten by hand. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { runPlans, PLANS_KEY, loadPlansBook, pageRewritten } from '../../js/agents/plans.js';
import { runGround } from '../../js/agents/worldground.js';

test('M528-1 A PAGE REWRITTEN BY HAND IS READ AGAIN FOR PLANS: the keeper\'s reading goes back to the edited page, and its next reading starts there — a page not read yet is left to its turn', async () => {
  const sid = 'plans-edit';
  await db.settings.set(PLANS_KEY(sid), { readTo: 11, readHash: 'h', plans: [] });
  await pageRewritten(sid, 4);
  eq((await loadPlansBook(sid)).readTo, 3, 'read back to the page before the edited one');
  await pageRewritten(sid, 9);
  eq((await loadPlansBook(sid)).readTo, 3, 'an edit of a page not read yet changes nothing');
  const pages = Array.from({ length: 12 }, (_, i) => ({ n: i + 1, who: i % 2 ? 'the storyteller' : 'the writer', text: 'page ' + (i + 1) + (i === 4 ? ' — REWRITTEN: they plan to storm the keep' : '') }));
  let read = '';
  await runPlans({ connection: { id: 'c' }, storyId: sid, pages, callLLM: async (conn, { user }) => { read = user; return '{"new":[],"progress":[],"closed":[]}'; } });
  assert(/REWRITTEN: they plan to storm the keep/.test(read), 'the next reading takes in the edited page');
});

test('M528-2 THE WORLD LOOKS AGAIN WHEN A PAGE IT CAME FROM WAS REWRITTEN (a reason to look, like a new arc or his brief changed); nothing rewritten and too few pages, it is not looked at', async () => {
  const have = { parts: { world: 'W', standing: 'S' }, recordLines: 30, recordPrint: 'old' };
  eq((await runGround({ connection: { id: 'x' }, have, recordLines: 31, input: { recordChanged: false } })).why, 'the world has not moved', 'nothing rewritten: not looked at');
  let looked = false;
  try { const r = await runGround({ connection: { id: 'x' }, have, recordLines: 31, input: { recordChanged: true } }); looked = r.why !== 'the world has not moved'; } catch (err) { looked = true; }
  assert(looked, 'a page it came from rewritten: it looks again');
});
