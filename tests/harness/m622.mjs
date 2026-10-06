/* M622 — his: "add a default notes CoT … I can drag it or choose where I put it before or after other notes, activate or
 * deactivate it … the best CoT but still fast, reminds about the instruction and still creative". Laws BUILD the real
 * request and read back what the storyteller reads last. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { buildRequest, HOUSE_COT, HOUSE_COT_ID } from '../../js/assemble/stack.js';

const OPTS = () => ({ story: {}, messages: [{ role: 'user', text: 'I draw on Sukuna.' }], state: {}, modules: [], memory: '', window: { keeperOn: true } });
const last = (r) => String(r.messages[r.messages.length - 1].content);
const firstLine = HOUSE_COT.split('\n')[0];

test('M622-1 THE HOUSE\u2019S THINKING NOTE RIDES BY DEFAULT — first above his notes and his note, his character named in it, nothing of it asking for written reasoning', () => {
  const r = buildRequest({ ...OPTS(), state: { sheet: { playerName: 'Jovan Oda', actors: {} } }, settings: { noteText: 'MY NOTE', noteAdds: [{ id: 'a', on: true, text: 'ADDED' }] } });
  const c = last(r);
  const at = c.indexOf(firstLine), added = c.indexOf('ADDED'), mine = c.lastIndexOf('MY NOTE');
  assert(at >= 0 && at < added && added < mine, 'house note, then his added note, then his note: ' + [at, added, mine]);
  assert(/Jovan Oda/.test(c) && !/\{\{user\}\}/.test(c), 'his character is named — no template left');
  assert(/run your pass to yourself — shorthand, a few words each, never on the page/.test(c), 'it is answered to itself, never written out');
  /* M624 moved this: the note is his own preset's pass now — the beat and the last look, pointing at his laws by name */
  for (const must of [/no choice, word, thought or feeling of Jovan Oda's is taken/, /never manufacture one/, /Information Quarantine/, /Unspent Material/, /Intent Horizon/, /Anti Repetition, Swap Test/, /by their own core, does it now/, /never faded out/, /goes back to Jovan Oda/]) assert(must.test(c), 'it holds: ' + must);
  assert(!/let at least one/i.test(c), 'no one is made to act every page');
});

test('M622-2 HIS CHOICE — switched off it is gone; moved after his notes it rides after them; his own words for it ride; put back, the house\u2019s words return', () => {
  const off = buildRequest({ ...OPTS(), settings: { noteText: 'MY NOTE', noteAdds: [{ id: HOUSE_COT_ID, on: false }, { id: 'a', on: true, text: 'ADDED' }] } });
  assert(!last(off).includes(firstLine) && last(off).includes('ADDED'), 'switched off: not sent, his own still are');
  const moved = buildRequest({ ...OPTS(), settings: { noteText: 'MY NOTE', noteAdds: [{ id: 'a', on: true, text: 'ADDED' }, { id: HOUSE_COT_ID, on: true }] } });
  const m = last(moved);
  assert(m.indexOf('ADDED') < m.indexOf(firstLine) && m.indexOf(firstLine) < m.lastIndexOf('MY NOTE'), 'moved down: after his added note, still above his note');
  const own = buildRequest({ ...OPTS(), settings: { noteAdds: [{ id: HOUSE_COT_ID, on: true, text: 'MY OWN CHECK' }] } });
  assert(last(own).endsWith('MY OWN CHECK') && !last(own).includes(firstLine), 'his words for it ride in its place');
  const back = buildRequest({ ...OPTS(), settings: { noteAdds: [{ id: HOUSE_COT_ID, on: true, text: '' }] } });
  assert(last(back).includes(firstLine), 'put back: the house\u2019s words again');
});

test('M622-3 (as M624 changed it) IT STAYS LIGHT — under three hundred words; his pass’s two parts, the beat and the last look', () => {
  const words = HOUSE_COT.split(/\s+/).filter(Boolean).length;
  assert(words < 300, 'words: ' + words);
  assert(/^B — the beat:/m.test(HOUSE_COT) && /^L — the last look:/m.test(HOUSE_COT), 'the beat and the last look');
  eq((HOUSE_COT.match(/^· /gm) || []).length, 7, 'seven points in the last look');
});

test('M622-4 SEARCHING A TALE\u2019S PAGES — his words and the story\u2019s, never a hidden page; any case, across line breaks; the newest page first; twenty places kept with the whole count', async () => {
  const { searchPages, HITS_KEPT } = await import('../../js/engine/search.js');
  const pages = [
    { id: 'p1', role: 'user', text: 'I pocket the Silver\nKey.' },
    { id: 'p2', role: 'assistant', text: 'The silver key glints in the lamp light.' },
    { id: 'p3', role: 'assistant', text: 'A hidden silver key', hidden: true },
    { id: 'p4', role: 'system', text: 'silver key in a system note' },
  ];
  const r = searchPages(pages, '  SILVER   key ');
  eq(r.count, 2, 'two pages hold it');
  eq(r.hits.map((h) => h.id).join(','), 'p2,p1', 'the newest page first');
  eq(r.hits[1].match, 'Silver Key', 'the match as written, across the line break');
  eq(searchPages(pages, 's').count, 0, 'one letter searches nothing');
  const many = Array.from({ length: 30 }, (_, i) => ({ id: 'm' + i, role: 'assistant', text: 'the silver key, again ' + i }));
  const m = searchPages(many, 'silver key');
  eq(m.count, 30, 'the whole count');
  eq(m.hits.length, HITS_KEPT, 'twenty places kept');
  eq(m.hits[0].id, 'm29', 'the newest first');
});

test('M622-5 THE DEVICE SEARCHES EVERY BOOK IT HOLDS — the latest tale first, a page appended to a book\u2019s log found, hidden pages and the house book left out (serve.py search_books, run on real book files)', async () => {
  const { spawnSync } = await import('node:child_process');
  const os = await import('node:os');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-search-'));
  fs.mkdirSync(path.join(dir, 'books'));
  const book = (sid, title, upd, pages) => fs.writeFileSync(path.join(dir, 'books', sid + '.json'), JSON.stringify({ kind: 'story', story: { id: sid, title, updatedAt: upd }, settings: [], messages: pages.map(([role, text, hidden], i) => ({ id: sid + '-' + i, storyId: sid, role, text, ts: i, ...(hidden ? { hidden: true } : {}) })) }));
  book('old', 'Old tale', 1000, [['user', 'I find the Silver\nKey.'], ['assistant', 'The silver key glints.']]);
  book('new', 'New tale', 5000, [['assistant', 'No key here.'], ['user', 'Where is the silver key?'], ['assistant', 'a hidden silver key', true]]);
  fs.writeFileSync(path.join(dir, 'books', '_house.json'), JSON.stringify({ kind: 'house', note: 'silver key' }));
  fs.writeFileSync(path.join(dir, 'books', 'old.log'), JSON.stringify({ at: '2026-10-06T00:00:00.000Z', by: 'b2', m: { id: 'old-9', storyId: 'old', role: 'assistant', text: 'A second silver key falls.', ts: 9 } }) + '\n');
  const script = "import importlib.util, sys, json\nspec = importlib.util.spec_from_file_location('serve', sys.argv[1])\nm = importlib.util.module_from_spec(spec)\nsys.argv = ['serve.py']\nspec.loader.exec_module(m)\nprint(json.dumps(m.search_books('SILVER KEY')))\n";
  const run = spawnSync('python3', ['-c', script, path.resolve('serve.py')], { env: { ...process.env, COZY_DATA_DIR: dir }, encoding: 'utf8', timeout: 30000 });
  fs.rmSync(dir, { recursive: true, force: true });
  eq(run.status, 0, 'python ran: ' + String(run.stderr || '').slice(-300));
  const out = JSON.parse(String(run.stdout).trim().split('\n').pop());
  eq(out.map((r) => r.title + ':' + r.count + ':' + r.hits.map((h) => h.id).join('/')).join(' | '), 'New tale:1:new-1 | Old tale:3:old-9/old-1/old-0', 'the latest tale first; the log\u2019s page first in its tale; the hidden page and the house book left out');
});

test('M622-6 NEVER ON AN OUT-OF-CHARACTER TURN — #question, ((…)) and //… get no thinking note (it plans a page, and an answer to him out of the story is not one); his own notes ride as his note does', () => {
  for (const text of ['#question what does she want?', '((brb — what do you think of the plot?))', '// a word out of the story']) {
    const r = buildRequest({ ...OPTS(), messages: [{ role: 'user', text }], settings: { noteAdds: [{ id: 'a', on: true, text: 'ADDED' }] } });
    const c = last(r);
    assert(!c.includes(firstLine), 'no thinking note on: ' + text);
    assert(c.includes('ADDED'), 'his own note still rides on: ' + text);
  }
  const page = buildRequest({ ...OPTS(), messages: [{ role: 'user', text: 'I draw on Sukuna.' }], settings: {} });
  assert(last(page).includes(firstLine), 'an in-story move carries it');
});
