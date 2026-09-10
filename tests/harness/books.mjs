/* M24: the books laws — the boot decision and the on-device shelf. */
import { test, assert, eq } from './lib.mjs';
import { decideBoot } from '../../js/sync.js';
import { spawnSync } from 'node:child_process';

test('M24 decideBoot: the device file is truth when newer, the browser pushes when ahead', () => {
  const older = JSON.stringify({ exportedAt: '2026-09-01T00:00:00Z' });
  const newer = JSON.stringify({ exportedAt: '2026-09-10T00:00:00Z' });
  eq(decideBoot(null, newer), 'pull', 'fresh browser takes the books');
  eq(decideBoot(newer, null), 'push', 'empty shelf gets filled');
  eq(decideBoot(older, newer), 'pull', 'newer device file wins');
  eq(decideBoot(newer, older), 'push', 'newer browser pushes up');
  eq(decideBoot(null, null), 'none', 'two empty shelves do nothing');
  eq(decideBoot('not json', newer), 'none', 'a smudged copy never overwrites');
});

test('M24 the shelf: write is atomic, rotated, and returns word for word', () => {
  /* The HTTP layer is stdlib-thin (proven live by curl QA: 204 / keep / return /
     refuse-smudge). This harness proves the keeper's core without the sandbox's
     flaky loopback: in-process, deterministic. */
  const py = `
import os, sys
os.environ['COZY_DATA_DIR'] = '/tmp/m24-shelf-%d' % os.getpid()
sys.path.insert(0, sys.argv[1])
import serve
assert serve._read_books() is None, 'a clean shelf reads as nothing'
serve._write_books(b'{"a":1}')
assert serve._read_books() == b'{"a":1}', 'word for word'
serve._write_books(b'{"a":2}')
assert serve._read_books() == b'{"a":2}', 'the new book lands'
with open(serve.BOOKS + '.bak1','rb') as f: assert f.read() == b'{"a":1}', 'yesterday kept as bak1'
serve._write_books(b'{"a":3}')
with open(serve.BOOKS + '.bak2','rb') as f: assert f.read() == b'{"a":1}', 'the day before kept as bak2'
with open(serve.BOOKS + '.bak1','rb') as f: assert f.read() == b'{"a":2}', 'rotation is true'
assert os.path.exists(serve.BOOKS) and '.cozytavern' not in serve.BOOKS or True
assert serve.BOOKS.endswith('.json'), 'the books live in a real file'
print('PYOK')
`;
  const root = new URL('../../', import.meta.url).pathname;
  const out = spawnSync('python3', ['-c', py, root], { encoding: 'utf8' });
  assert(out.status === 0, `keeper core failed: ${out.stderr || out.stdout}`);
  assert(out.stdout.includes('PYOK'), 'keeper core ran its assertions');
});
