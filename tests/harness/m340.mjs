/* M340 — the first pages of a tale, for a model that does not think: the shape is SHOWN, the page is made whole before it is kept, and a header with no place still wears the card. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { readHeader, shapeOf, tidyPage, shapeReminder, needsShapeReminder } from '../../js/ui/pageshape.js';
import { isHeaderLine, splitReply } from '../../js/ui/headergate.js';
import { STYLE_PACK } from '../../js/regex-styles.js';
import { buildRequest, STARTER_NOTE } from '../../js/assemble/stack.js';
import { CRAFT_TEXT } from '../../js/assemble/craft.js';
import { emptyState } from '../../js/engine/state.js';

const BARE = 'Saturday, June 14, 2025 | 08:12 | ☀️ sun through the glass doors, salt-faint breeze | joggers, t-shirt | leaning at the counter, coffee in hand';
const HIS = BARE + '\nThe kitchen was quiet.\n"Morning," Emilia said, not looking up.\nHe set the cup down.\nThe drapes moved.';
const GOOD = '[Arden master bedroom, East Hampton — Saturday, September 14, 2024 | 14:38 | warm September light through the drapes | bare, sheened with sweat | over Emilia]\n\nOne paragraph.\n\n"Two," she said.';

test('M340-1 THE WRITER’S SECOND SCREENSHOT: a header with no brackets and no place, prose with no paragraphs. Before the page is KEPT it is made whole — brackets, the ledger’s ground, blank lines — and never a word is changed', () => {
  assert(isHeaderLine(BARE), 'a header that lost its brackets is still the header (M339 would have taken this page for the teller thinking)');
  assert(!isHeaderLine('He looked at the clock; it was 08:12 and the kitchen was quiet.') && !isHeaderLine('Plan: beat | costs | stops | 10:30 maybe') && !isHeaderLine('| a | b | c |'), 'prose, a labelled plan and a table row are not');
  const was = shapeOf(HIS);
  assert(was.header && !was.bracketed && was.missingPlace && was.paragraphs === 'single-newlines' && !was.sound, JSON.stringify(was));
  const t = tidyPage(HIS, { place: 'Arden kitchen, East Hampton' });
  eq(t.did.join(','), 'place,brackets,paragraphs');
  eq(t.text.split('\n')[0], '[Arden kitchen, East Hampton — ' + BARE + ']', 'the header, whole');
  eq(t.text.split('\n\n').length, 5, 'header + four paragraphs, a blank line between each');
  const words = (x) => x.replace(/[\[\]\s]+/g, ' ').replace('Arden kitchen, East Hampton — ', '').trim();
  eq(words(t.text), words(HIS), 'not one word differs');
  assert(shapeOf(t.text).sound, 'and now it is sound: ' + JSON.stringify(shapeOf(t.text)));
  eq(tidyPage(t.text, { place: 'Somewhere else' }).text, t.text, 'done twice is done once — and a place that is there is never replaced');
  /* no place known yet: brackets and paragraphs only — the place is never invented */
  const blind = tidyPage(HIS, {});
  eq(blind.text.split('\n')[0], '[' + BARE + ']'); assert(!blind.did.includes('place'));
  eq(tidyPage(GOOD, { place: 'X' }).text, GOOD, 'a good page is handed back untouched');
  eq(tidyPage('No header here.\nJust words.\nMore.', { place: 'X' }).text, 'No header here.\nJust words.\nMore.', 'a page with no header is not this function’s business');
  const gfx = '[A — Saturday, June 14, 2025 | 08:12 | sun | tee | here]\nline\n<!-- GFX_START -->\n<div>x</div>\n<!-- GFX_END -->\nmore';
  assert(!tidyPage(gfx, {}).did.includes('paragraphs'), 'a page holding a readable object or a tracker block keeps its own line breaks');
});

test('M340-2 one unbroken block is parted where speech begins; thinking before a bare header is still cut away', () => {
  const block = '[Arden kitchen — Saturday, June 14, 2025 | 08:12 | sun | joggers | at the counter]\n' + 'The kitchen was quiet and the light came flat through the glass doors. '.repeat(8) + '"Morning," Emilia said, not looking up. ' + 'He set the cup down and watched the drapes move. '.repeat(6) + '"You are up early," she said. He shrugged.';
  const t = tidyPage(block, {});
  assert(t.did.includes('paragraphs') && t.text.split('\n\n').length >= 3 && /\n\n"Morning," Emilia said/.test(t.text), String(t.text.split('\n\n').length));
  eq(t.text.replace(/\s+/g, ' '), block.replace(/\s+/g, ' '), 'only white space moved');
  const s = splitReply('Oh this is delicious. Let me write it.\n\n' + HIS);
  assert(/delicious/.test(s.lead) && s.page.startsWith('Saturday, June 14, 2025 | 08:12'), 'the gate finds the bare header: ' + s.page.slice(0, 40));
});

test('M340-3 THE SHAPE IS SHOWN, not told: while a tale is young, or its last page came out of shape, the closing message carries the skeleton — before the note, only under a craft that keeps the Header Protocol — and it stops by itself', () => {
  assert(needsShapeReminder([]) && needsShapeReminder([GOOD]) && needsShapeReminder([GOOD, GOOD]), 'a young tale');
  assert(!needsShapeReminder([GOOD, GOOD, GOOD]), 'three sound pages: the tale’s own pages are the example now');
  assert(needsShapeReminder([GOOD, GOOD, GOOD, HIS]), 'the last page came out of shape: shown again, by itself');
  const build = (settings, craft = CRAFT_TEXT) => buildRequest({ story: {}, messages: [{ id: 'u', role: 'user', text: 'I pour the coffee.' }], settings: { noteText: STARTER_NOTE, ...settings }, state: { ...emptyState(), page: 0, sheet: { playerName: 'Jovan' } }, modules: [{ mod: { id: 'core-craft', name: 'The craft', text: craft }, reason: 'always' }], memory: '', window: { keeperOn: true, budgetTokens: 500000 } });
  const on = build({ pageShapeNow: true }); const last = on.messages[on.messages.length - 1].content;
  assert(/The shape of the page — exactly this, every time:\n\n\[Place, the exact spot — Weekday, Month D, YYYY \| HH:MM \| weather and light, 2-5 words \| what Jovan wears \| where Jovan is, what he is doing\]\n\nA paragraph of the scene\.\n\n"Speech opens its own paragraph," she said\.\n\n/.test(last), last.slice(0, 300));
  assert(last.trimEnd().endsWith(STARTER_NOTE.trim()) && last.indexOf('The shape of the page') < last.indexOf(STARTER_NOTE.trim()), 'before the note, which keeps the last word');
  eq(JSON.stringify(build({})), JSON.stringify(build({ pageShapeNow: false })), 'not needed: not one byte');
  assert(!/The shape of the page/.test(JSON.stringify(build({}))));
  assert(!/The shape of the page/.test(JSON.stringify(build({ pageShapeNow: true }, '## My own craft\nEvery page opens with a line of verse.'))), 'a craft of the writer’s own with another header is never told this one');
  assert(/what the main character wears/.test(shapeReminder({})) && /what the main character wears/.test(shapeReminder({ mc: 'the player' })), 'no name known: no placeholder name');
});

test('M340-4 a header with no place still wears the card — the same card, without the place line — and the six-field header wears its own as before', () => {
  const rule = STYLE_PACK.find((r) => r.id === 'style-header-no-place');
  assert(rule && rule.builtin && rule.enabled && rule.mode === 'display', 'a built-in display rule (seeded into a shelf that lacks it)');
  const re = new RegExp(rule.find, rule.flags);
  const dressed = ('[' + BARE + ']').replace(re, rule.replace);
  assert(/^<div style="background:linear-gradient/.test(dressed) && /Saturday, June 14, 2025<\/span>/.test(dressed) && />08:12<\/span>/.test(dressed) && /leaning at the counter, coffee in hand<\/span>/.test(dressed), dressed.slice(0, 160));
  assert(!/\$\d/.test(dressed) && !/pk-place/.test(dressed), 'every field filled, and no empty place line');
  assert(new RegExp(rule.find, rule.flags).test(BARE), 'bracketed or bare');
  assert(!new RegExp(rule.find, rule.flags).test(GOOD.split('\n')[0]), 'a header WITH its place is not this rule’s');
  const six = STYLE_PACK.filter((r) => /header/i.test(r.id) && r.id !== 'style-header-no-place').some((r) => new RegExp(r.find, r.flags).test(GOOD.split('\n')[0]));
  assert(six, 'it is dressed by the rules it always was');
  assert(STYLE_PACK.indexOf(rule) < STYLE_PACK.findIndex((r) => r.id === 'style-header-6-pipe'), 'and it runs before them');
});
