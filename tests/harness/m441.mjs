/* M441: the housekeeper's sessions are listed by when they were last used — the newest talk first (his rule: activity
 * lists sort by recency, not internal order). Runs the real session shelf on the real store. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { listSessions, newSession, switchSession, saveSession, loadSession } from '../../js/agents/housekeeper.js';

test('M441-1 THE HOUSEKEEPER\u2019S SESSIONS, NEWEST-USED FIRST', async () => {
  const sid = 'm441';
  let s1 = await loadSession(sid); /* Session 1 */
  await saveSession(sid, { ...s1, turns: [{ role: 'writer', text: 'old question', ts: 1000 }] });
  const s2 = await newSession(sid); /* Session 2, made now */
  const s3 = await newSession(sid); /* Session 3, made now */
  await switchSession(sid, s2.id);
  const now = Date.now() + 5000;
  await saveSession(sid, { ...(await loadSession(sid)), turns: [{ role: 'writer', text: 'the latest talk', ts: now }] });
  const { sessions } = await listSessions(sid);
  eq(sessions.map((x) => x.name).join(' | '), [s2.name, s3.name, 'Session 1'].join(' | '), 'the one talked in last first, then the newest made, then the old one');
});
