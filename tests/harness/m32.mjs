/* M32 — the spoken lines and the thoughts have a colour; untouched builtins follow the coat. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { inlineMd, inlineMarks } from '../../js/ui/prose.js';
import { loadRules, BUILTIN_RULES, REGEX_KEY } from '../../js/regex.js';
import { buildExtractorMessages } from '../../js/agents/extractor.js';
import { buildWorldMessages } from '../../js/agents/world.js';
import { emptyState } from '../../js/engine/state.js';
import { db } from '../../js/store.js';

test('M32-1 spoken lines are tokens with the marks kept; thoughts are tokens with the marks removed; both carry inline marks', () => {
  const toks = inlineMd('She set the cup down. "You *knew*," she said. ~t~*He can’t find out.*~/t~ Then she smiled.');
  const kinds = toks.map((t) => t.k);
  eq(kinds.join(','), 'text,quote,text,thought,text', kinds.join(','));
  const quote = toks[1];
  eq(quote.children[0].text, '"You ', 'the opening mark stays');
  eq(quote.children[1].k, 'em', 'emphasis works inside a spoken line');
  eq(quote.children[2].text, ',"', 'the closing mark stays');
  const thought = toks[3];
  eq(thought.children[0].text, 'He can’t find out.', 'the ~t~* marks are removed');
  /* curly quotes and the other thought spelling */
  const t2 = inlineMd('“Come in,” he said. *~t~Not tonight.~/t~*');
  eq(t2.filter((t) => t.k === 'quote').length, 1);
  eq(t2.filter((t) => t.k === 'thought').length, 1);
  /* an unclosed quote is plain text; a quote never spans lines */
  eq(inlineMd('"never closed').every((t) => t.k === 'text'), true);
  eq(inlineMd('"a\nb"').every((t) => t.k === 'text'), true);
  /* the old marks still work exactly as before on text with no quotes */
  const old = inlineMarks('a **b** *c* `d`');
  eq(old.map((t) => t.k).join(','), 'text,strong,text,em,text,code');
  eq(inlineMd('plain words').length, 1);
});

test('M32-2 an untouched builtin follows the coat; a touched one stands', async () => {
  await db.settings.set(REGEX_KEY, [
    { ...BUILTIN_RULES[0], enabled: true },                    /* seeded by m30 with the header removal ON, never touched */
    { ...BUILTIN_RULES[1], enabled: false, touched: true },   /* the writer switched this one off */
  ]);
  const rules = await loadRules();
  eq(rules.find((r) => r.id === 'builtin-preset-header').enabled, false, 'the m30 seed lands on the m31 default (OFF)');
  eq(rules.find((r) => r.id === 'builtin-plot-momentum').enabled, false, 'the writer’s switch stands');
  const settings = readFileSync(new URL('../../js/ui/settings.js', import.meta.url), 'utf8');
  assert((settings.match(/touched: true/g) || []).length >= 3, 'toggle, edit and restore all mark touched');
});

test('M32-3 the header line is the clock’s truth for the extractor; a person named in passing exists for the world agent', () => {
  const young = buildExtractorMessages({ state: emptyState(), userText: 'u', assistantText: 'a' });
  assert(/bracketed header line/.test(young.system) && /clock\.set \(all five numbers are in it\)/.test(young.system));
  const settled = emptyState(); settled.place = { name: 'x' }; settled.present = [{ name: 'L' }];
  const s2 = buildExtractorMessages({ state: settled, userText: 'u', assistantText: 'a' });
  assert(/bracketed header line/.test(s2.system) && /clock\.set when the date or hour differs/.test(s2.system));
  const w = buildWorldMessages({ state: emptyState(), userText: 'u', assistantText: 'a' });
  assert(/my sister Kim would laugh/.test(w.system) && /from that line on, Kim exists/.test(w.system));
});

test('M32-4 the colour switch exists, is wired, and the theme carries both colours', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert(html.includes('id="colour-speech"'));
  const settings = readFileSync(new URL('../../js/ui/settings.js', import.meta.url), 'utf8');
  assert(/db\.settings\.set\('colourSpeech'/.test(settings) && /plain-speech/.test(settings));
  const css = readFileSync(new URL('../../css/base.css', import.meta.url), 'utf8');
  eq((css.match(/--spoken:/g) || []).length, 2, 'both themes name the spoken colour');
  eq((css.match(/--thought:/g) || []).length, 2, 'both themes name the thought colour');
  assert(/\.spoken \{ color: var\(--spoken\)/.test(css) && /\.thought \{ color: var\(--thought\)/.test(css));
  const app = readFileSync(new URL('../../js/app.js', import.meta.url), 'utf8');
  assert(/plain-speech/.test(app), 'applied at boot');
});
