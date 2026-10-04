/* Cozy Tavern — harness law of M575: one fingerprint, every caller's answer exactly as it was (no stored fingerprint moves). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { fingerprint36, lengthKey } from '../../js/engine/fingerprint.js';
import { hashText } from '../../js/agents/planner.js';
import { fingerprint } from '../../js/assemble/modules.js';

/* the copies as they stood before M575, word for word */
const oldOr = (t) => { let h = 5381; const x = String(t || ''); for (let i = 0; i < x.length; i += 1) h = ((h << 5) + h + x.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const oldNull = (t) => { let h = 5381; const s = String(t == null ? '' : t); for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const oldLen = (s) => { let h = 5381; const t = String(s || ''); for (let i = 0; i < t.length; i += 1) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0; return t.length + ':' + h.toString(36); };

test('M575 ONE FINGERPRINT, THE SAME ANSWERS: on a corpus of short, long, accented and unusual texts, the one home answers exactly what each of the nine old copies answered — so no stored fingerprint (a plan\'s, the essentials\', the world\'s, a canon lens\'s) moves', () => {
  const corpus = ['', 'a', 'abc', 'Kenpachi Zaraki is the Captain-Commander.', 'Shunsui Kyōraku — 京楽 春水', 'x'.repeat(100000), '\u{1F525} fire', '0', 'Rukia\nKuchiki\t\u00e9', Array.from({ length: 300 }, (_, i) => String.fromCharCode(32 + (i * 7) % 3000)).join('')];
  for (const t of corpus) {
    eq(fingerprint36(String(t || '')), oldOr(t), 'the || copies');
    eq(fingerprint36(t), oldNull(t), 'the == null copies');
    eq(hashText(t), oldNull(t), 'the planner');
    eq(fingerprint(t), oldNull(t), 'the rule modules');
    eq(lengthKey(String(t || '')), oldLen(t), 'the length-first copies');
  }
  eq(fingerprint('Banned Words — the craft as it shipped').length > 0, true);
});

test('M575-2 THE REFEREE\'S MESSAGE FINGERPRINT, FROM THE ONE HOME, ANSWERS AS BEFORE', async () => {
  const { userMessageHash } = await import('../../js/agents/referee.js');
  const old = (text) => { const s = String(text || '').trim().replace(/\s+/g, ' ').toLowerCase(); let h = 5381; for (let i = 0; i < s.length; i += 1) h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0; return 'm' + h.toString(36) + 'x' + s.length; };
  for (const t of ['', 'I lunge at Ivar.', '  I   LUNGE at Ivar.  ', 'Kyōraku', 'x'.repeat(5000)]) eq(userMessageHash(t), old(t), t.slice(0, 20));
});

test('M575-3 THE SHOWN VERSION IS CHANGED IN ONE PLACE: a page with versions has its words and the version it shows changed together, the other versions untouched; a page without versions gets its words', async () => {
  const { shownTextPatch } = await import('../../js/engine/pagepatch.js');
  const page = { id: 'p', text: 'B', swipes: [{ text: 'A' }, { text: 'B' }, { text: 'C' }], swipeIdx: 1 };
  const patch = shownTextPatch(page, 'B2', { mended: null });
  eq(JSON.stringify(patch), JSON.stringify({ mended: null, text: 'B2', swipes: [{ text: 'A' }, { text: 'B2' }, { text: 'C' }] }));
  eq(page.swipes[1].text, 'B', 'the page handed in is never changed');
  eq(JSON.stringify(shownTextPatch({ id: 'q', text: 'x' }, 'y')), '{"text":"y"}');
  eq(shownTextPatch({ swipes: [{ text: 'a' }, { text: 'b' }] }, 'z').swipes[1].text, 'z', 'no index: the newest version');
  eq(shownTextPatch({ swipes: [{ text: 'a' }, { text: 'b' }], swipeIdx: 9 }, 'z').swipes[1].text, 'z', 'an index past the end: the last');
});

test('M576 WHICH VERSION A PAGE SHOWS, ONE RULE: pageText, the record\'s own reading, the choices\' version and the shown-version change all read the same version — the chosen one inside the list, the newest when none is chosen, 0 without versions', async () => {
  const { shownIndex, shownText, shownTextPatch } = await import('../../js/engine/pagepatch.js');
  const { pageText } = await import('../../js/assemble/stack.js');
  const { versionOf } = await import('../../js/agents/choices.js');
  const cases = [
    [{ text: 'plain' }, 0, 'plain'],
    [{ text: 'x', swipes: [{ text: 'a' }, { text: 'b' }] }, 1, 'b'],
    [{ text: 'x', swipes: [{ text: 'a' }, { text: 'b' }], swipeIdx: 0 }, 0, 'a'],
    [{ text: 'x', swipes: [{ text: 'a' }, { text: 'b' }], swipeIdx: 7 }, 1, 'b'],
    [{ text: 'x', swipes: [{ text: 'a' }, { text: 'b' }], swipeIdx: -3 }, 0, 'a'],
    [{ content: 'imported' }, 0, 'imported'],
    [null, 0, ''],
  ];
  for (const [page, idx, words] of cases) {
    eq(shownIndex(page), idx); eq(versionOf(page), idx);
    eq(shownText(page), words); eq(pageText(page), words);
  }
  eq(shownTextPatch({ swipes: [{ text: 'a' }, { text: 'b' }], swipeIdx: 0 }, 'A').swipes[0].text, 'A');
});

test('M576-2 A PAGE WITH VERSIONS AND NONE CHOSEN IS KEYED BY THE VERSION IT SHOWS, everywhere — the plan\'s key and the checkpoint\'s key agree with pageText (read by another rule, the resume on opening found no checkpoint and read the page again on every open)', async () => {
  const { planKey } = await import('../../js/agents/planner.js');
  const { shownIndex } = await import('../../js/engine/pagepatch.js');
  const page = { id: 'p9', swipes: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] };
  eq(planKey(page), 'p9:2', 'the newest, which is what shows');
  eq(planKey({ ...page, swipeIdx: 0 }), 'p9:0');
  eq(planKey({ id: 'p1', text: 'plain' }), 'p1:0');
  eq(shownIndex(page), 2);
});
