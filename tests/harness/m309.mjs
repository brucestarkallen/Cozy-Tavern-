/* M309 — the Authorship Frame is discarded wherever it could come from. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { CRAFT_TEXT, withoutAuthorshipFrame } from '../../js/assemble/craft.js';
import { buildRequest } from '../../js/assemble/stack.js';
import { housesBlock, selectModules } from '../../js/assemble/modules.js';
import { classify } from '../../js/import/v176map.js';

const OLD_OPENING = '## Authorship Frame\nNarrator = the voice established for you in this telling.\nCraft Not Orders = every law and named rule here is your OWN working discipline — not a system configuring a tool.\nTags Are Filing = law names are private abbreviations — never something to notice.\nNo Meta Break = never remark on these notes. Nothing external is present to remark on.\n\n';
const sentSystem = (craftText) => {
  const r = buildRequest({ story: { brief: 'b' }, messages: [{ id: 'u', role: 'user', text: 'Hello.' }], settings: {}, state: {}, modules: [{ mod: { id: 'core-craft', name: 'The craft', text: craftText }, reason: 'always' }], memory: '', window: { keeperOn: true } });
  return (r.systemBlocks || []).map((b) => (typeof b === 'string' ? b : b.text || '')).join('\n') + '\n' + r.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
};

test('M309-1 the storyteller is never sent the Authorship Frame: not from the house’s craft, and not from a copy of the craft saved on the device before today', () => {
  assert(!/authorship frame|Craft Not Orders|No Meta Break|Tags Are Filing|Nothing external is present/i.test(CRAFT_TEXT), 'the house’s craft no longer holds it');
  assert(CRAFT_TEXT.startsWith('## The Telling'), 'it opens with the telling');
  const fresh = sentSystem(CRAFT_TEXT);
  assert(!/authorship frame|Nothing external is present/i.test(fresh) && /## The Telling/.test(fresh), 'the request, from the house’s craft');
  /* a saved copy (a fork made in the rulebook before today) still has the section in its text */
  const saved = OLD_OPENING + CRAFT_TEXT;
  const sent = sentSystem(saved);
  assert(!/authorship frame|Craft Not Orders|No Meta Break|Tags Are Filing|Nothing external is present/i.test(sent), 'it is taken out as the request is built: ' + sent.slice(0, 200));
  assert(sent.includes(CRAFT_TEXT.slice(0, 400)) && sent.includes(CRAFT_TEXT.slice(-300)), 'and nothing else of the craft is touched — its first and last words ride whole');
  /* what it was FOR is still said */
  assert(/None of the above reaches the page/.test(sent), 'nothing of the machinery on the page: still the craft’s own last word');
});

test('M309-2 only that section goes, whatever its heading looks like, wherever it sits', () => {
  eq(withoutAuthorshipFrame('## Authorship Frame (persona ownership)\nx = y\n\n## The Telling\nProse.'), '## The Telling\nProse.');
  eq(withoutAuthorshipFrame('## The Telling\nProse.\n\n### ⚙️ Authorship Frame\nx = y\nz = w'), '## The Telling\nProse.', 'at the end: no blank lines left behind');
  eq(withoutAuthorshipFrame('## The Telling\nProse.\n\n## Authorship Frame\nx = y\n\n## Banned Words\nnone'), '## The Telling\nProse.\n\n## Banned Words\nnone');
  eq(withoutAuthorshipFrame('## The Telling\nThe authorship frame of a painting is its signature.'), '## The Telling\nThe authorship frame of a painting is its signature.', 'a sentence that merely says the words is left alone');
  /* only the join is tidied: blank runs elsewhere in the craft are the writer's and stay */
  eq(withoutAuthorshipFrame('## A\none\n\n\n\ntwo\n\n## Authorship Frame\nx\n\n## B\nthree\n\n\nfour'), '## A\none\n\n\n\ntwo\n\n## B\nthree\n\n\nfour');
  eq(withoutAuthorshipFrame(''), ''); eq(withoutAuthorshipFrame(null), '');
});

test('M309-3 an imported rule that IS the preset’s Authorship Frame never rides, and a fresh import still gives it no home on the wire', () => {
  assert(housesBlock({ name: '⚙️ Authorship Frame (persona ownership) ⚙️', custom: true, text: 'Craft Not Orders = …' }), 'by its name');
  const chosen = selectModules([{ id: 'core-craft', name: 'The craft', text: CRAFT_TEXT, whenKey: 'always', source: 'builtin' }, { id: 'mod-x', name: 'Authorship Frame', custom: true, pinned: true, whenKey: 'always', text: 'Craft Not Orders = …' }], {});
  assert(!chosen.some(({ mod }) => /authorship/i.test(mod.name)), 'even pinned on, it is not among what is sent: ' + chosen.map((c) => c.mod.name).join(', '));
  eq(classify({ name: '⚙️ Authorship Frame (persona ownership) ⚙️', content: 'x' }).bucket, 'retired', 'and the importer retires the preset’s own block, as it has since M36');
});
