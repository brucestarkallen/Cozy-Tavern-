/* M609 — the line-by-line audit, part 19: the request builder (js/assemble). Laws RUN the guards on real page text. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';

const PAGE = (tag) => '[The 13th Division \u2014 Monday, March 3, 2025 | 09:00 | clear]\n\nRukia folded her arms by the gate. "You are late," she said, and the wind took the rest of it.\n\n"I had to see the captain first," ' + tag + ', brushing dust from his sleeve.';

test('M609-1 THE SMALL MODEL\u2019S GUARDS KNOW HIM BY HIS FIRST NAME AND HIS FAMILY NAME — "Jovan said" and "Oda said" are his lines when the ledger calls him Jovan Oda; never a title, never a name word someone else holds', async () => {
  const { hisNames, mineLeak, mineCutAt } = await import('../../js/assemble/plain.js');
  const others = ['Rukia Kuchiki', 'Byakuya Kuchiki'];
  eq(hisNames('Captain Jovan Oda', others).join('|'), 'Captain Jovan Oda|jovan|oda', 'the full name, then each word of it — the title is not his name');
  eq(mineLeak(PAGE('Jovan said'), { mc: 'Jovan Oda', others, writerText: 'I walk to Rukia.' }), 'gave him words of his own', 'his first name');
  eq(mineLeak(PAGE('Oda said'), { mc: 'Jovan Oda', others, writerText: 'I walk to Rukia.' }), 'gave him words of his own', 'his family name');
  eq(mineLeak(PAGE('Jovan said'), { mc: 'Jovan Oda', others, writerText: 'I say "I had to see the captain first."' }), '', 'words he typed are his own');
  const page = PAGE('Jovan said');
  const at = mineCutAt(page, { mc: 'Jovan Oda', others, writerText: 'I walk to Rukia.' });
  assert(at > 0 && page.slice(at).startsWith('"I had to see the captain first,"'), 'the page is cut where his words begin: ' + JSON.stringify(page.slice(at, at + 40)));
  /* a family name another person shares is not his alone */
  const vivi = ['Vivi Arden'];
  eq(mineLeak(PAGE('Arden said'), { mc: 'Jovan Arden', others: vivi, writerText: 'I wave.' }), '', '"Arden" is his stepsister\u2019s name too — not taken as his');
  eq(mineLeak(PAGE('Jovan said'), { mc: 'Jovan Arden', others: vivi, writerText: 'I wave.' }), 'gave him words of his own', 'his first name still is');
});

test('M609-2 THE HOUSE\u2019S EYE KNOWS HIS FAMILY NAME TOO — "Oda said" is ghost dialogue for Jovan Oda', async () => {
  const { lintPage } = await import('../../js/agents/lint.js');
  const ghosts = (tag, others) => lintPage({ mc: 'Jovan Oda', userText: 'I walk to Rukia.', assistantText: PAGE(tag), others }).findings.filter((f) => f.law === 'Ghost Dialogue').length;
  eq(ghosts('Oda said', ['Rukia Kuchiki']), 1, 'his family name');
  eq(ghosts('Jovan said', ['Rukia Kuchiki']), 1, 'his first name');
  eq(ghosts('Kuchiki said', ['Rukia Kuchiki']), 0, 'another\u2019s family name is never his');
});
