/* Last-polish laws (M15): the bug classes the feature-visibility audit
 * found, encoded so they can never silently return.
 *  1. NO GHOST CALLS — every cross-module call is imported (the class that
 *     killed the send path, the lore shelf's hand controls, and nearly the
 *     ledger's standings: a name used but never imported throws only at
 *     runtime, where no harness was watching).
 *  2. The scene-head parser: bracketed tracker lines become typography.
 *  3. The M15 surface laws: motion, pulse, vignette, cards, the colophon.
 *  4. The branch action is wired end to end (row → handler → fork).
 *  5. The guided tour restarts through the machine, not by poking a
 *     getter-only property. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const jsFiles = [];
(function walk(dir) {
  for (const f of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, f.name);
    if (f.isDirectory()) walk(rel);
    else if (rel.endsWith('.js')) jsFiles.push(rel);
  }
})('js');

/* Crude but honest: comments and strings become blanks before scanning, so
 * prose about a name never counts as a use of it. */
function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/gs, '``');
}

test('M15 no-ghost-calls: every cross-module call is imported', () => {
  const exportMap = new Map(); // name -> file that exports it
  for (const rel of jsFiles) {
    const src = strip(read(rel));
    for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) {
      exportMap.set(m[1], rel);
    }
    for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop().trim();
        if (name) exportMap.set(name, rel);
      }
    }
  }
  const problems = [];
  for (const rel of jsFiles) {
    const src = strip(read(rel));
    const bound = new Set();
    for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop().trim();
        if (name) bound.add(name);
      }
    }
    for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) bound.add(m[1]);
    for (const m of src.matchAll(/import\s*\*\s*as\s+([A-Za-z_$][\w$]*)/g)) bound.add(m[1]);
    for (const m of src.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) bound.add(m[1]);
    for (const m of src.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) bound.add(m[1]);
    for (const m of src.matchAll(/(^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = m[2];
      if (bound.has(name)) continue;
      const from = exportMap.get(name);
      if (from && from !== rel) {
        problems.push(`${rel}: calls ${name}() — exported by ${from}, never imported`);
      }
    }
  }
  assert(problems.length === 0, 'ghost calls found:\n' + problems.join('\n'));
});

test('M15 no local ghost calls: render*/init*/load*/save* called are defined', () => {
  const problems = [];
  for (const rel of jsFiles) {
    const src = strip(read(rel));
    const defined = new Set();
    for (const m of src.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
    for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) defined.add(m[1]);
    for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop().trim();
        if (name) defined.add(name);
      }
    }
    for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) defined.add(m[1]);
    for (const m of src.matchAll(/import\s*\*\s*as\s+([\w$]+)/g)) defined.add(m[1]);
    for (const m of src.matchAll(/(^|[^\w$.])((?:render|init|load|save|fetch)[A-Z][\w$]*)\s*\(/g)) {
      if (!defined.has(m[2])) problems.push(`${rel}: ${m[2]}() called, never defined or imported`);
    }
  }
  assert(problems.length === 0, 'local ghost calls found:\n' + problems.join('\n'));
});

test('M15 referee dials: the settings room renders and writes all four', () => {
  const src = read('js/ui/settings.js');
  assert(/async function renderReferee\(/.test(src), 'renderReferee defined (was called, never defined)');
  for (const [el, key] of [
    ['refereeOn', 'refereeOn'],
    ['refereeSensitivity', 'refereeSensitivity'],
    ['refereePreset', 'refereePreset'],
    ['refereeFightStyle', 'refereeFightStyle'],
  ]) {
    assert(new RegExp(`els\\.${el}\\.addEventListener\\('change'`).test(src), `${el} has a change listener`);
    assert(src.includes(`db.settings.set('${key}'`), `${el} writes ${key}`);
    assert(src.includes(`db.settings.get('${key}'`), `${el} reads ${key}`);
  }
});

test('M15 scene heads: the tracker line becomes typography', async () => {
  const { parseScene, SCENE_HEAD_RE } = await import('../../js/ui/chat.js');
  assert(typeof parseScene === 'function', 'parseScene exported');
  const parts = parseScene('[The Wayward Lantern — a wet evening]\n\nRain combed the windows.\n\nMore rain.');
  eq(parts.length, 2, 'head + one prose part');
  eq(parts[0].type, 'head');
  eq(parts[0].text, 'The Wayward Lantern — a wet evening');
  eq(parts[1].type, 'prose');
  assert(parts[1].text.includes('Rain combed the windows.'), 'prose kept whole');
  const plain = parseScene('No brackets here.\n\nJust prose.');
  eq(plain.length, 1, 'no heads, one prose part');
  eq(plain[0].type, 'prose');
  const mid = parseScene('She said [brackets] mid-line stay prose.');
  eq(mid.length, 1, 'mid-line brackets are not a head');
  eq(mid[0].type, 'prose');
  assert(SCENE_HEAD_RE.test('[AB]'), 'short heads count');
  assert(!SCENE_HEAD_RE.test('[unterminated'), 'unterminated is not a head');
  const two = parseScene('[One]\n\nwords\n\n[Two]\n\nmore');
  eq(two.filter((p) => p.type === 'head').length, 2, 'two heads parse');
});

test('M15 branch: the fork is wired end to end', () => {
  const src = read('js/ui/chat.js');
  assert(src.includes("acts.push('branch')"), 'branch in the action row');
  assert(/async function branchFrom\(/.test(src), 'branchFrom defined');
  assert(/act === 'branch'/.test(src), 'click handler routes branch');
  assert(src.includes('BRANCH_CARRY'), 'story ways carry to the fork');
  assert(src.includes("— a branch"), 'the fork is named as one');
  assert(src.includes('!m.hidden'), 'hidden nudges stay behind');
});

test('M15 guided tour: restart goes through the machine', () => {
  const src = read('js/ui/welcome.js');
  assert(src.includes('tour.restart()'), 'the tour restarts through its own machine');
  assert(!/tour\.done\s*=/.test(src), 'no poking the getter-only done (TypeError class)');
});

test('M15 motion & depth: the surface laws hold', () => {
  const chat = read('css/chat.css');
  assert(/\.msg\s*\{\s*animation:\s*msg-rise 0\.25s ease-out/.test(chat), 'messages rise 12px .25s ease-out');
  assert(/@keyframes msg-rise/.test(chat) && /translateY\(12px\)/.test(chat), 'msg-rise keyframes');
  assert(/width:\s*7px/.test(chat) && /steps\(2\)/.test(chat) && /1\.1s steps\(2\)/.test(chat),
    'streaming caret: 7px ember bar, steps(2) 1.1s');
  assert(/@keyframes ember-pulse/.test(chat) && /\.ember-bar\.live/.test(chat), 'ember pulse while streaming');
  assert(/\.thread\s*\{[^}]*radial-gradient/.test(chat), 'thread vignette');
  assert(/\.scene-head/.test(chat), 'scene-head styling');
  assert(/\.story-panel-foot/.test(chat), 'the shelves colophon styling');
  assert(/\.story-item:hover\s*\{\s*background:\s*var\(--surface-2\)/.test(chat), 'story rows warm on hover');
  const base = read('css/base.css');
  assert(/button:active\s*\{\s*transform:\s*scale\(0\.96\)/.test(base), 'press scale .96');
  assert(/translateY\(-1px\)/.test(base), 'hover lift');
  assert(/\.settings-section\s*\{[^}]*border-radius:\s*var\(--r-lg\)[^}]*padding:\s*18px/s.test(base)
    || /\.settings-section\s*\{[^}]*padding:\s*18px[^}]*border-radius:\s*var\(--r-lg\)/s.test(base),
    'settings rooms rest on cards (--r-lg, 18px)');
  const drawer = read('css/drawer.css');
  assert(/\.ledger-panel\s*\{[^}]*border-top:\s*1px solid var\(--border-soft\)/.test(drawer), 'ledger hairlines');
  assert(/\.ledger-panel h3\s*\{[^}]*text-transform:\s*uppercase/.test(drawer), 'ledger heads in the whisper voice');
});

test('M15 swipe: an empty version stack still regenerates', () => {
  const src = read('js/ui/chat.js');
  /* The M9 law: swiping right with nothing after writes a NEW version.
   * The audit found the early return swallowing the action whole. */
  assert(/!msg\.swipes\.length\)\s*\{\s*if \(dir > 0[^)]*\) swipeRegenerate\(msg\)/s.test(src)
    || /!msg\.swipes\.length\)\s*\{\s*if \(dir > 0 && msg\.role === 'assistant'\) swipeRegenerate\(msg\);\s*return;\s*\}/s.test(src),
    'swipeTo regenerates when the stack is empty');
});

test('M15 the workers line can speak (fmtWhenWords exists)', () => {
  const src = read('js/ui/drawer.js');
  assert(src.includes('function fmtWhenWords('), 'fmtWhenWords defined (was called as whenWords, never defined)');
  assert(!/\bwhenWords\(\s*row\.at\s*\)/.test(src), 'no ghost call remains in the workers panel');
  assert(src.includes('loadWorkerStatus(story.id)'), 'the workers shelf is read for the open story');
});

test('M15 the colophon & the ember hook are wired', () => {
  const src = read('js/ui/chat.js');
  assert(src.includes("import { VERSION } from '../version.js'"), 'VERSION imported');
  assert(src.includes('story-panel-foot'), 'the shelves footer is built');
  assert(src.includes("the shelves · "), 'the colophon speaks');
  assert(src.includes("classList.add('live')") && src.includes("classList.remove('live')"),
    'the ember bar breathes while streaming');
});

test('M26 the widened ghost-call law: every jsonutil export used anywhere is imported there', () => {
  const ju = read('js/agents/jsonutil.js');
  const exported = [...ju.matchAll(/export function (\w+)/g)].map((m) => m[1]);
  const agents = fs.readdirSync(path.join(ROOT, 'js/agents')).filter((f) => f.endsWith('.js'));
  for (const f of agents) {
    const src = read('js/agents/' + f);
    for (const name of exported) {
      const uses = new RegExp('\\b' + name + '\\s*\\(').test(src);
      if (!uses) continue;
      const imports = new RegExp("import\\s*\\{[^}]*\\b" + name + "\\b[^}]*\\}\\s*from\\s*['\"]\\./jsonutil\\.js['\"]").test(src) || f === 'jsonutil.js';
      assert(imports, f + ' uses ' + name + ' without importing it (the never-throws law hides these)');
    }
  }
});

test('M26 the masthead law: the house writes headers from the ledger, never the model', async () => {
  const { renderMasthead, emptyState } = await import('../../js/engine/state.js');
  const { applyMutations, undoLast } = await import('../../js/engine/apply.js');
  eq(renderMasthead(emptyState()), null, 'an empty ledger writes no masthead');
  let r = applyMutations(emptyState(), [
    { type: 'clock.set', year: 2026, month: 3, day: 15, hour: 14, minute: 30 },
    { type: 'place.set', name: 'the wayward lantern' },
    { type: 'presence.enter', name: 'Mira' },
  ]);
  const mast = renderMasthead(r.state);
  assert(mast.includes('the wayward lantern'), 'the place leads');
  assert(mast.includes('14:30'), 'the hour rides');
  assert(mast.includes('Mira'), 'who is here is named');
  const undone = undoLast(undoLast(r.state).state);
  eq(undone.state.place, null, 'place undo follows the house convention');
});

test('M26 the extractor answers honestly: thinking stripped, failures flagged', async () => {
  const { parseExtractorAnswer } = await import('../../js/agents/extractor.js');
  const thinky = '<think>braces {live} here</think>{"mutations":[{"type":"place.set","name":"the chapel"}]}';
  const r = parseExtractorAnswer(thinky);
  eq(r.mutations.length, 1, 'the answer survives its thinking');
  eq(r.mutations[0].name, 'the chapel');
  eq(r.note, 'ok');
  eq(parseExtractorAnswer('{"mutations":[]}').note, 'empty', 'an honest empty list');
  eq(parseExtractorAnswer('no json at all').note, 'unusable', 'unusable is named, never silent');
});

test('M26 the workers line carries outcomes', () => {
  const status = read('js/agents/status.js');
  assert(status.includes('detail'), 'status keeps a detail field');
  const drawer = read('js/ui/drawer.js');
  assert(drawer.includes('row.detail'), 'the line renders it');
  const chat = read('js/ui/chat.js');
  assert(chat.includes('nothing to write down') && chat.includes('could not be used'), 'honest words exist');
});

test('M27 the picture law: a picture rides its own turn only', async () => {
  const { wireable } = await import('../../js/assemble/stack.js');
  const msgs = [
    { id: '1', role: 'user', text: 'look', image: { dataUrl: 'data:image/jpeg;base64,AA==' } },
    { id: '2', role: 'assistant', text: 'I see it.' },
    { id: '3', role: 'user', text: 'and now?', image: { dataUrl: 'data:image/jpeg;base64,BB==' } },
  ];
  const wire = wireable(msgs);
  assert(!wire[0].image, 'the older picture stays home');
  assert(wire[0].content.includes('[a picture was shared here]'), 'a quiet note marks it');
  assert(wire[2].image, 'the current page carries its picture');
  const { withImagePart } = await import('../../js/providers/wire.js');
  const an = withImagePart(wire[2], 'anthropic');
  eq(an.content[1].type, 'image', 'anthropic block');
  eq(an.content[1].source.data, 'BB==', 'base64 without the prefix');
  const oa = withImagePart(wire[2], 'openai');
  eq(oa.content[1].type, 'image_url', 'openai part');
});

test('M27 the reader can try again, and the scroll stays where they left it', () => {
  const chat = read('js/ui/chat.js');
  assert(chat.includes("acts.push('try again')"), 'user pages carry try again');
  assert(chat.includes('retryUserMessage'), 'the retry path exists');
  const ungated = [...chat.matchAll(/(?<!if \(nearBottom\)\n)\s+scrollToBottom\(\);/g)];
  assert(chat.includes('if (nearBottom()) scrollToBottom();'), 'completion scroll is gated');
});
