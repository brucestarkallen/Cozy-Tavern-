/* M17: the assignment law — a worker's own hands, then the house choice, then
 * the caller falls back to the storyteller's connection. */
import { test, assert, eq } from './lib.mjs';
import { pickWorkerConnection, WORKER_ROWS } from '../../js/agents/assign.js';

const conns = [
  { id: 'smart', label: 'Claude — the best' },
  { id: 'cheap', label: 'Little quick one' },
  { id: 'fast', label: 'Sprinter' },
];

test('M17 assign: a worker with its own pick rides it', () => {
  const got = pickWorkerConnection({ map: { referee: 'fast' }, legacy: 'cheap', connections: conns }, 'referee');
  eq(got.id, 'fast', 'per-worker pick wins');
});

test('M17 assign: no per-worker pick falls back to the house choice', () => {
  const got = pickWorkerConnection({ map: {}, legacy: 'cheap', connections: conns }, 'keeper');
  eq(got.id, 'cheap', 'legacy general pick');
});

test('M17 assign: neither set -> null (caller falls back to the storyteller)', () => {
  const got = pickWorkerConnection({ map: {}, legacy: null, connections: conns }, 'scribe');
  eq(got, null, 'null lets the caller fall back');
});

test('M17 assign: a stale per-worker id degrades to the house choice, never shadows it', () => {
  const got = pickWorkerConnection({ map: { referee: 'ghost-id' }, legacy: null, connections: conns }, 'referee');
  eq(got, null, 'ghost id with no house choice yields null');
  const got2 = pickWorkerConnection({ map: { referee: 'ghost-id' }, legacy: 'cheap', connections: conns }, 'referee');
  eq(got2.id, 'cheap', 'ghost id degrades to the house choice');
});

test('M17 assign: the roster names every worker the house employs', () => {
  const keys = WORKER_ROWS.map(([k]) => k);
  for (const k of ['extractor', 'scribe', 'keeper', 'continuity', 'referee', 'showrunner', 'housekeeper']) {
    assert(keys.includes(k), `roster covers ${k}`);
  }
  assert(WORKER_ROWS.every(([, words]) => words.length > 10), 'each row speaks in warm words');
});
