/* Cozy Tavern — harness law of M565: the essentials of a long tale — told in parts that fit the keeper's model, each its
 * share of the room; a telling over its share, or cut off, asked again tighter — never the newest stretch lost. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { runEssentials, loadEssentials, ESSENTIALS_MAX_CHARS } from '../../js/agents/essentials.js';

const line = (i, n = 900) => ({ id: 'n' + i, span: [i * 3, i * 3 + 2], text: 'STRETCH-' + i + ' ' + 'x'.repeat(n), level: 1, at: i + 1 });
const told = (user, share) => {
  const ids = [...user.matchAll(/STRETCH-(\d+)/g)].map((m) => m[1]);
  return ids.map((id) => '- [Day ' + id + '] (pages ' + id + ') TOLD-' + id + ' ' + 'y'.repeat(Math.max(10, Math.floor(share / Math.max(1, ids.length)) - 60))).join('\n');
};

test('M565-1 A LONG RECORD IS TOLD IN PARTS THAT FIT ITS MODEL — oldest first, each part only its own lines and its share of the room, joined in order; a short record is one request, as before', async () => {
  const calls = [];
  const nodes = Array.from({ length: 60 }, (_, i) => line(i));
  const out = await runEssentials({ connection: { id: 'c', contextSize: 8000 }, storyId: 'st-565', nodes, callLLM: async (c, { user }) => { calls.push(user); const share = Number((user.match(/at most (\d+) characters/) || [])[1] || ESSENTIALS_MAX_CHARS); return { text: told(user, share), finishReason: 'stop' }; } });
  assert(out.wrote && out.parts >= 3, 'told in parts: ' + JSON.stringify(out));
  eq(calls.length, out.parts, 'one request per part');
  assert(calls.every((u, k) => /This is part \d+ of \d+ of the record, oldest first/.test(u)), 'each told it is a part');
  const firsts = calls.map((u) => Number((u.match(/STRETCH-(\d+)/) || [])[1]));
  assert(firsts.every((v, k) => k === 0 || v > firsts[k - 1]), 'oldest first: ' + firsts.join(','));
  const kept = (await loadEssentials('st-565')).text;
  assert(kept.includes('TOLD-0 ') && kept.includes('TOLD-59 '), 'the opening and the newest both stand');
  const one = [];
  await runEssentials({ connection: { id: 'c', contextSize: 128000 }, storyId: 'st-565b', nodes: nodes.slice(0, 5), callLLM: async (c, { user }) => { one.push(user); return { text: told(user, 4000), finishReason: 'stop' }; } });
  eq(one.length, 1, 'a short record: one request');
  assert(!/This is part/.test(one[0]), 'as before');
});

test('M565-2 A TELLING OVER ITS SHARE, OR CUT OFF BY THE ANSWER\'S ROOM, IS ASKED AGAIN TIGHTER — the newest never lost to a cut', async () => {
  const calls = [];
  const nodes = Array.from({ length: 4 }, (_, i) => line(i, 200));
  await runEssentials({ connection: { id: 'c', contextSize: 128000 }, storyId: 'st-565c', nodes, callLLM: async (c, { user }) => {
    calls.push(user);
    if (calls.length === 1) return { text: told(user, ESSENTIALS_MAX_CHARS * 2), finishReason: 'length' };
    return { text: told(user, 3000), finishReason: 'stop' };
  } });
  eq(calls.length, 2, 'asked again once');
  assert(/Tell it again within \d+ characters: the oldest stretches shorter, every stretch still there, the newest whole/.test(calls[1]), 'tighter');
  const kept = (await loadEssentials('st-565c')).text;
  assert(kept.includes('TOLD-3 '), 'the newest stands');
});
