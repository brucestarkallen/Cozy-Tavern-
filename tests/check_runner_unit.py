#!/usr/bin/env python3
"""The workflow must not reuse changed code, cache timings, or green an empty selector."""
import importlib.util
import contextlib
import io
import json
import sys
import uuid
from unittest.mock import patch
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('cozy_checks', ROOT / 'tools/check.py')
checks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checks)


class Workflow(unittest.TestCase):
    def test_fingerprint_detects_new_and_changed_execution_inputs_but_not_prose(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'js').mkdir()
            (root / 'js/a.js').write_text('original')
            a = checks.source_digest(root)
            (root / 'HANDOFF.md').write_text('new status')
            self.assertEqual(a, checks.source_digest(root))
            (root / 'js/a.js').write_text('changed')
            b = checks.source_digest(root)
            self.assertNotEqual(a, b)
            (root / 'js/new.js').write_text('new guard')
            self.assertNotEqual(b, checks.source_digest(root))

    def test_reuse_requires_matching_success_and_timings_always_run(self):
        functional = dict(name='boot_ready', command=['python', 'boot_ready.py'])
        self.assertTrue(checks.reusable(functional, dict(exit=0, digest='a'), 'a'))
        self.assertFalse(checks.reusable(functional, dict(exit=1, digest='a'), 'a'))
        self.assertFalse(checks.reusable(functional, dict(exit=0, digest='old'), 'new'))
        for name in ('perf_send', 'perf_academy', 'paint_academy', 'academy_ui', 'coat', 'contrast'):
            self.assertFalse(checks.reusable(dict(name=name), dict(exit=0, digest='a'), 'a'))

    def test_release_is_unfiltered_and_full_includes_every_python_test(self):
        release = checks.jobs('release')
        self.assertEqual(len(release), len({job['name'] for job in release}))
        self.assertTrue(set(checks.STANDING) <= {job['name'] for job in release})
        self.assertTrue(all(not job.get('selector') for job in release))
        names = {job['name'] for job in checks.jobs('full')}
        self.assertTrue({p.stem for p in (ROOT / 'tests').glob('*.py')} <= names)

    def test_failed_runner_erases_stale_completion_and_ambient_selectors(self):
        tag = 'workflow_unit_' + uuid.uuid4().hex
        output = Path('/tmp/gates'); output.mkdir(exist_ok=True)
        done = output / (tag + '_done'); done.write_text('ALLDONE\n')
        summary = output / (tag + '_summary.json'); summary.write_text(json.dumps({'complete': True, 'checks': {}}))
        child = "import os,json,sys; assert not json.load(open(sys.argv[1]))['complete']; assert 'ONLY' not in os.environ; assert os.environ['COZY_TEST_REPO'] == os.getcwd(); assert '/tmp/cozy-check-' in os.environ['COZY_TEST_DATA']; raise SystemExit(7)"
        job = dict(name='workflow_probe', command=[sys.executable, '-c', child, str(summary)])
        import os
        try:
            with tempfile.TemporaryDirectory() as root, patch.object(checks, 'ROOT', Path(root)), \
                 patch.object(checks, 'jobs', return_value=[job]), patch.object(checks, 'runtime_digest', return_value='test'), \
                 patch.object(sys, 'argv', ['check.py', 'release', '--tag', tag]), patch.dict(os.environ, {'ONLY':'hidden filter'}), \
                 contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(checks.main(), 1)
            self.assertFalse(done.exists(), 'a previous completion cannot mask a new failed run')
            result = json.loads((output / (tag + '_summary.json')).read_text())
            self.assertFalse(result['complete'])
            self.assertEqual(result['checks']['workflow_probe']['exit'], 7)
        finally:
            for path in output.glob(tag + '_*'): path.unlink()

    def test_empty_selector_is_a_failure(self):
        script = "import { test, runAll } from './tests/harness/lib.mjs'; test('exists', () => {}); await runAll();"
        import os
        run = subprocess.run(['node', '--input-type=module', '-e', script], cwd=ROOT,
                             env=dict(os.environ, ONLY='does not exist'), capture_output=True, text=True)
        self.assertNotEqual(run.returncode, 0, run.stdout)
        self.assertIn('matched no tests', run.stdout)


if __name__ == '__main__':
    unittest.main()
