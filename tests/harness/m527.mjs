/* Cozy Tavern — harness laws of M527: the deep audit, second pass — what pages taken back leave behind. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { db } from '../../js/store.js';
import { runPlans, PLANS_KEY, loadPlansBook } from '../../js/agents/plans.js';

test('M527-1 THE PLANS KEEPER AFTER PAGES TAKEN BACK: a plan born on a page that no longer stands goes, a plan those pages closed stands again, and reading goes on from the page that stands last — nothing is asked of a model for it', async () => {
  const sid = 'plans-rollback';
  await db.settings.set(PLANS_KEY(sid), { readTo: 39, readHash: 'x', plans: [
    { title: 'Hold the gate', status: 'standing', from: 5, to: 12, parts: [], goal: 'hold' },
    { title: 'Ambush at dawn', status: 'standing', from: 30, to: 35, parts: [], goal: 'ambush' },
    { title: 'Free the prisoners', status: 'done', outcome: 'freed on page 33', closedAt: 33, from: 8, to: 33, parts: [], goal: 'free them' },
  ] });
  const pages = Array.from({ length: 20 }, (_, i) => ({ n: i + 1, who: i % 2 ? 'the storyteller' : 'the writer', text: 'page ' + (i + 1) }));
  let asked = 0;
  await runPlans({ connection: { id: 'c' }, storyId: sid, pages, callLLM: async () => { asked += 1; return '{"new":[],"progress":[],"closed":[]}'; } });
  const book = await loadPlansBook(sid);
  eq(book.plans.map((p) => p.title + ':' + p.status).join(' | '), 'Hold the gate:standing | Free the prisoners:standing', 'born on a page taken back: gone; closed on one: standing again');
  eq(book.readTo, 19, 'read from the page that stands last');
  assert(!('outcome' in book.plans[1]) && !('closedAt' in book.plans[1]), 'its closing is let go with the page that closed it');
  eq(asked, 0, 'no model asked — nothing new to read');
});
