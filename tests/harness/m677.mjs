/* Cozy Tavern — harness laws of M677 (his: "Can you fix this — why it needs the auditor to fix it and not found it before
 * the auditor?", with the auditor's reading of his page 20 pasted under it). The room below is his, from that reading. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';

const HEAD = '[Oda Estate, Kyoto Hills — Saturday, January 17, 2026 | 18:34 | ❄ clear, biting cold | dark training gi | seated by the tea brazier]';
const P20 = HEAD + '\n\n'
  + 'Mei’s hands came down from her mouth. “TABS?” she whisper-screamed, and then she was only staring, openly, at the phone buzzing in Jovan’s gi.\n\n'
  + 'Yuki pointed across the brazier at him with her cup. “Jovan. Twenty. The only boy I’ve asked all year.” She settled in, elbows on her knees, braid slipped forward off her shoulder, cup in hand, like a woman prepared to wait all night.\n\n'
  + 'Gojo put his chin back in his palm, delighted, and raised his cup in cheerful confirmation. “He’s doing the goldfish. There should be a plaque.”\n\n'
  + '“There will be no plaque,” Itsuki said, very quietly, to the ceiling beams, from his father’s shoulder.\n\n'
  + 'Kageyoshi lifted his cup, sipped, set it down. “The question is structurally sound. His attachments are due diligence.”\n\n'
  + 'Sakura slid the matchmaker’s portfolio across the tatami, tabs and all, her grandmother’s annotations in the margins.\n\n'
  + '*** The World Beyond ***\n\n'
  + 'At Jujutsu High, 18:47, Megumi Fushiguro sat at the hall end by the window over the west gate, reading the class thread.';

function room() {
  return applyMutations({ ...emptyState(), page: 19 }, [
    { type: 'mc.set', name: 'Jovan' },
    { type: 'place.set', name: 'Oda Estate, Kyoto Hills' },
    { type: 'presence.enter', name: 'Jovan' },
    { type: 'presence.enter', name: 'Oda Mei', position: 'both hands pressed over her mouth', attire: 'a travel blanket wrapped to the chin' },
    { type: 'presence.enter', name: 'Yuki Tsukumo', position: 'leaned forward over it, forearms on her knees', attire: 'a cream wool coat' },
    { type: 'presence.enter', name: 'Gojo Satoru', position: 'legs straightened out toward the cold edge of the room, fingers laced over his stomach' },
    { type: 'presence.enter', name: 'Oda Itsuki', position: 'at his father’s shoulder, immaculate courtesy' },
    { type: 'presence.enter', name: 'Oda Kageyoshi', position: 'at the head of the brazier, one hand palm down on his knee' },
    { type: 'presence.enter', name: 'Oda Sakura', position: 'kneeling beside her husband' },
    { type: 'presence.enter', name: 'Oda Haruto', position: 'asleep against the screen' },
    { type: 'offscreen.set', name: 'Megumi Fushiguro', location: 'Jujutsu High, the hall end by the window over the west gate', activity: 'reading the class thread' },
  ]).state;
}
const posOf = (st, n) => (st.present.find((p) => p.name === n) || {}).position;

test('M677-1 WHERE EACH OF THEM IS, ASKED BY NAME: the page reader is handed, by name, every person his page 20 shows (its telling, before the window) with what the ledger says of them — never the main character (his place is his header’s), never someone here the page does not show, never someone in the window', async () => {
  const { buildExtractorMessages } = await import('../../js/agents/extractor.js');
  const st = room();
  const p = buildExtractorMessages({ state: st, userText: 'Ask me something easier.', assistantText: P20, pageNumber: 20 });
  const at = p.user.indexOf('WHERE EACH OF THEM IS AS THIS PAGE ENDS');
  assert(at !== -1, 'the reader is asked where each of them is');
  const block = p.user.slice(at, p.user.indexOf('\n\n', at));
  for (const [n, was] of [['Oda Mei', 'both hands pressed over her mouth'], ['Yuki Tsukumo', 'leaned forward over it, forearms on her knees'], ['Gojo Satoru', 'fingers laced over his stomach'], ['Oda Itsuki', 'immaculate courtesy'], ['Oda Kageyoshi', 'one hand palm down on his knee'], ['Oda Sakura', 'kneeling beside her husband']]) {
    assert(block.includes(n + ' — the ledger has: ') && block.includes(was), 'asked about ' + n + ', with the ledger’s words: ' + block);
  }
  assert(/wearing a travel blanket wrapped to the chin/.test(block), 'and what the ledger says they wear');
  assert(!/\d\. Jovan /.test(block), 'never the main character');
  assert(!block.includes('Oda Haruto'), 'never someone here the page does not show (quiet is not gone, and not asked about)');
  assert(!block.includes('Megumi'), 'never someone in the window');
  const first = buildExtractorMessages({ state: { ...emptyState() }, userText: 'x', assistantText: P20, founding: true });
  assert(!first.user.includes('WHERE EACH OF THEM IS AS THIS PAGE ENDS'), 'and a founding read is not asked (there is no ledger to restate)');
});

test('M677-2 HIS PAGE 20, READ: what the reader answers for each person lands on the ledger — the five the auditor had to set right are the page’s now; the ledger’s own words given back are no change; words that are not the page’s are not written', async () => {
  const { extractTurn } = await import('../../js/agents/extractor.js');
  const { thinkingHouse, withHouse, HOUSES } = await import('./thinkinghouse.mjs');
  const st = room();
  const answer = JSON.stringify({ mutations: [{ type: 'mode.snapshot', flags: ['group'] }], resolved: [], here: [
    'Jovan',
    { name: 'Oda Mei', at: 'hands come down, staring openly at the phone buzzing in Jovan’s gi' },
    { name: 'Yuki Tsukumo', at: 'elbows on her knees, braid slipped forward off her shoulder, cup in hand, settled in to wait all night' },
    { name: 'Gojo Satoru', at: 'chin back in his palm, delighted, cup raised' },
    { name: 'Oda Itsuki', at: 'at his father’s shoulder, speaking quietly to the ceiling beams' },
    { name: 'Oda Kageyoshi', at: 'at the head of the brazier, one hand palm down on his knee' },
    { name: 'Oda Sakura', at: 'pouring sake for the abbot of a distant temple' },
    'Oda Haruto',
  ] });
  const house = thinkingHouse({ answer });
  const read = await withHouse(house, () => extractTurn({ connection: HOUSES[0].conn, state: st, userText: 'Ask me something easier.', assistantText: P20, pageNumber: 20 }));
  assert(JSON.stringify(house.calls[0].body.messages).includes('WHERE EACH OF THEM IS AS THIS PAGE ENDS'), 'the request that went out asks for each by name');
  const after = applyMutations(st, read.mutations).state;
  eq(posOf(after, 'Oda Mei'), 'hands come down, staring openly at the phone buzzing in Jovan’s gi', 'Mei (it stayed “both hands pressed over her mouth”)');
  eq(posOf(after, 'Yuki Tsukumo'), 'elbows on her knees, braid slipped forward off her shoulder, cup in hand, settled in to wait all night', 'Yuki');
  eq(posOf(after, 'Gojo Satoru'), 'chin back in his palm, delighted, cup raised', 'Gojo');
  eq(posOf(after, 'Oda Itsuki'), 'at his father’s shoulder, speaking quietly to the ceiling beams', 'Itsuki');
  eq(posOf(after, 'Oda Kageyoshi'), 'at the head of the brazier, one hand palm down on his knee', 'Kageyoshi: the ledger’s words back');
  assert(!read.mutations.some((m) => m.type === 'presence.update' && m.name === 'Oda Kageyoshi'), 'and nothing is written for him');
  eq(posOf(after, 'Oda Sakura'), 'kneeling beside her husband', 'Sakura: words that are not the page’s are not written');
  eq(posOf(after, 'Oda Haruto'), 'asleep against the screen', 'Haruto, not on the page, stays as he was');
  assert(after.present.some((p) => p.name === 'Oda Haruto'), 'and stays here');
});

test('M677-3 ONE RULE FOR WHO KNOWS WHAT: the page reader (which writes it) and the auditor (which holds the ledger to it) are sent the same sentence — the auditor no longer counts every beat a person "plainly witnessed" as missing knowledge', async () => {
  const { buildExtractorMessages } = await import('../../js/agents/extractor.js');
  const { buildAuditorMessages } = await import('../../js/agents/auditor.js');
  const { KNOWING_MEANS } = await import('../../js/agents/herewords.js');
  const st = room();
  const reader = buildExtractorMessages({ state: st, userText: 'x', assistantText: P20, pageNumber: 20 });
  const auditor = buildAuditorMessages({ state: st, pages: [{ role: 'assistant', text: P20 }] });
  assert(reader.system.includes(KNOWING_MEANS), 'the reader is sent it');
  assert(auditor.system.includes(KNOWING_MEANS), 'the auditor is sent it');
  assert(!/plainly witnessed something on the latest pages/.test(auditor.system), 'the auditor’s old, wider rule is gone');
  assert(/a joke, a remark, a gasp, a gesture, a look, a cup raised/.test(KNOWING_MEANS), 'and it says what is not knowledge');
});

test('M677-4 THE HOUSE’S OWN WINDOW MARKER IS NOT BOLD: the eye reported “Bold marks (**…**) sit in the prose.” on every page with a window (his page 20: its only asterisks were *** The World Beyond ***); bold in the scene or in the window is still found', async () => {
  const { lintPage } = await import('../../js/agents/lint.js');
  const bold = (page) => lintPage({ mc: 'Jovan', userText: 'x', assistantText: page }).findings.some((f) => /Bold marks/.test(f.words));
  eq(bold(P20), false, 'his page: no bold mark');
  eq(bold(P20.replace('only staring', '**only** staring')), true, 'bold in the scene is found');
  eq(bold(P20.replace('reading the class thread', '**reading** the class thread')), true, 'bold in the window is found');
  eq(bold(P20.replace('*** The World Beyond ***', '**The World Beyond**')), true, 'a marker the finisher has not set right is still found');
});
