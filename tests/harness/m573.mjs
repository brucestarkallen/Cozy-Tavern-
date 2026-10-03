/* Cozy Tavern — harness law of M573: every wiki request of the canon engine has a time limit (a request to a wiki that
 * never answered stayed pending as long as the browser let it). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const src = readFileSync(fileURLToPath(new URL('../../js/canon/grounding.js', import.meta.url)), 'utf8');

test('M573 EVERY WIKI REQUEST OF THE CANON ENGINE HAS A TIME LIMIT — no request to a wiki goes out without one, and the limit is twenty seconds', () => {
  const bare = src.split('\n').filter((l) => /\bfetch\(/.test(l) && !/function wikiFetch|return fetch\(url, \{ signal|wikiFetch\(|catch \(e\) \{ return fetch\(url\); \}/.test(l));
  eq(bare.length, 0, 'a wiki request without a limit: ' + bare.map((l) => l.trim().slice(0, 80)).join(' | '));
  eq((src.match(/await wikiFetch\(/g) || []).length, 8, 'the eight wiki requests');
  assert(/const WIKI_TIMEOUT_MS = 20000;/.test(src), 'twenty seconds');
});

test('M573-2 A SCHOOL\'S TITLES ARE TITLES — "Headmaster Vane" is Aldric Vane, "Instructor Holt" is Mira Holt (no second page for either); "Dean" is never read as a title (it is a first name); two different school titles are two people', async () => {
  const { findPersonKey } = await import('../../js/engine/people.js');
  const chars = { 'Aldric Vane': {}, 'Mira Holt': {}, 'Dean Holloway': {}, 'Headmaster Orrin': {} };
  eq(findPersonKey(chars, 'Headmaster Vane'), 'Aldric Vane');
  eq(findPersonKey(chars, 'Instructor Holt'), 'Mira Holt');
  eq(findPersonKey(chars, 'Dean Holloway'), 'Dean Holloway', 'Dean is his name');
  eq(findPersonKey(chars, 'Principal Orrin'), '', 'a principal is not the headmaster');
});
