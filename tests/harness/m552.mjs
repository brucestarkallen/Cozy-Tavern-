/* Cozy Tavern — harness laws of M552: THE AUDIT (his order: "audit everything, no flex tape").
 * 1. The house's own prompt examples named HIS people — his main character and his Bleach premise ("believes Jovan is
 *    only a recruit — untrue: Jovan is the new captain of the 13th Division") in the ledger reader's instructions for every
 *    story; Zaraki, Rukia, Kaelen, Kaiser, Rias, Claire, Kim and Aurora elsewhere. An example a worker echoes becomes a
 *    "fact" (M95 cleaned up one such leak after the fact, by name) — and a leak of his own MC's name could never be caught.
 *    Now the house's examples use two names that are nobody's, and the cleanup knows them.
 * 2. What the wiki check let go is never written back by the world keeper. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
import { RETIRED_EXAMPLE_NAMES } from '../../js/engine/apply.js';
import { exampleLeakHousekeeping } from '../../js/agents/auditor.js';
import { groundAsk, groundUpdateAsk } from '../../js/agents/worldground.js';

const HIS = ['Jovan', 'Rukia', 'Zaraki', 'Kaelen', 'Kaiser', 'Rias', 'Claire', 'Kim', 'Aurora', 'Byakuya', 'Renji', 'Ichigo', 'Hachigor', 'Alexia'];
/* a module's code and strings, never its comments (block comments, and line comments outside quotes) */
function withoutComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((line) => {
    let q = null;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (q) { if (c === '\\') { i += 1; continue; } if (c === q) q = null; continue; }
      if (c === "'" || c === '"' || c === '`') { q = c; continue; }
      if (c === '/' && line[i + 1] === '/' && (i === 0 || /[\s;,)({]/.test(line[i - 1]))) return line.slice(0, i);
    }
    return line;
  }).join('\n');
}

test('M552-1 NO PROMPT OF THE HOUSE NAMES ONE OF HIS PEOPLE: every string the workers and the storyteller are handed, in every module that writes one — only his own Summaryception text (the record\'s prompt, his words) and the craft\'s list of names never to give an NPC may', () => {
  const dirs = ['js/agents', 'js/assemble'];
  const hits = [];
  for (const d of dirs) for (const f of readdirSync(ROOT + d).filter((x) => x.endsWith('.js'))) {
    for (const lit of withoutComments(readFileSync(ROOT + d + '/' + f, 'utf8')).split('\n')) {
      for (const name of HIS) {
        if (!new RegExp('\\b' + name + '\\b').test(lit)) continue;
        if (f === 'memory.js' && /Glass Season|Emilia read it|before judgment caught up|Alexia boarded the train/.test(lit)) continue; /* his own Summaryception prompts, word for word */
        if (f === 'craft.js' && /banned slop names/.test(lit)) continue; /* the names an NPC is never given */
        hits.push(d + '/' + f + ': ' + name + ' in ' + lit.slice(0, 90));
      }
    }
  }
  eq(hits.length, 0, hits.join(' | '));
});

test('M552-2 THE HOUSE\'S EXAMPLE NAMES ARE NOBODY\'S: echoed into the ledger they are let go (seat, page, standing, knowledge) — unless his brief or cast names them, when they are his', () => {
  for (const n of ['orrin vale', 'tamsin hale']) assert(RETIRED_EXAMPLE_NAMES.includes(n), n + ' is known as an example');
  const state = { characters: { 'Orrin Vale': { core: 'the new captain of the guard' }, Mira: { core: 'a baker' } }, relationships: { 'Tamsin Hale': { p: 10 } }, offscreen: {}, canon: {}, present: [{ name: 'Orrin Vale' }] };
  const out = exampleLeakHousekeeping(state, 'A story about Mira.', '');
  eq(out.map((m) => m.type + ':' + m.name).sort().join(' | '), 'people.forget:Orrin Vale | people.forget:Tamsin Hale', 'both echoes let go, Mira stays');
  eq(exampleLeakHousekeeping(state, 'Orrin Vale is my captain; Tamsin Hale his sister.', '').length, 0, 'named in his brief: his');
});

test('M552-3 WHAT THE WIKI ALREADY SHOWED WRONG IS NEVER WRITTEN BACK: the world keeper is handed those lines, on its first build and on every later look', () => {
  const lines = ['Yamamoto leads the Gotei 13 as Captain-Commander.'];
  for (const ask of [groundAsk({ concept: 'x', foundWrong: lines }), groundUpdateAsk({ ground: { parts: { factions: 'y' } }, foundWrong: lines })]) {
    assert(/LINES ALREADY SHOWN WRONG BY THE SERIES’ WIKI — never write these again/.test(ask.user) && ask.user.includes('- ' + lines[0]), 'it is told: ' + ask.user.slice(-300));
  }
  assert(!/SHOWN WRONG/.test(groundAsk({ concept: 'x' }).user), 'none, nothing said');
});
