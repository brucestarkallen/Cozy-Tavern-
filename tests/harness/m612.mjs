/* M612 — the line-by-line audit, part 22: the importers. Laws RUN the importer on a real export's shape. */
import './idb-shim.mjs';
import { test, eq } from './lib.mjs';

test('M612-1 A SILLYTAVERN LOREBOOK\u2019S SCAN DEPTH IS ITS scanDepth — its "depth" (where the entry is placed in the chat) is never read as how far back it listens; the export writes both back as SillyTavern reads them', async () => {
  const { parseLorebook, matchLore, loreToWorldbook } = await import('../../js/import/lorebook.js');
  /* the shape SillyTavern exports: depth 4 is the insertion depth, scanDepth null means the book's own */
  const book = JSON.stringify({ entries: {
    0: { uid: 0, key: ['oak'], keysecondary: [], comment: 'The oak', content: 'The old oak stands by the gate.', constant: false, disable: false, depth: 4, scanDepth: null },
    1: { uid: 1, key: ['well'], keysecondary: [], comment: 'The well', content: 'The well is dry.', constant: false, disable: false, depth: 4, scanDepth: 6 },
  } });
  const entries = parseLorebook(book);
  eq(entries[0].depth, undefined, 'no scan depth of its own: the book\u2019s two pages apply');
  eq(entries[1].depth, 6, 'its own scan depth is read');
  const pages = ['They passed the oak.', 'A quiet morning.', 'They talked.', 'Nothing more.'];
  eq(matchLore([entries[0]], pages), '', 'the oak, named four pages back, is not heard by an entry that listens two pages back');
  const out = loreToWorldbook(entries, 'Test');
  eq(out.entries['1'].scanDepth, 6, 'the export writes the scan depth where SillyTavern reads it');
  eq(out.entries['1'].depth, 4, 'and SillyTavern\u2019s own insertion depth beside it');
  eq(out.entries['0'].scanDepth, null, 'an entry with none says none');
});
