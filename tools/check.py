#!/usr/bin/env python3
"""Measured fast, release and full checks. No application keys or live model calls."""
import argparse
import concurrent.futures
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import tempfile

ROOT = Path(__file__).resolve().parents[1]
STANDING = ('perf_send holdsone cutthinking notes_layout backup backupdupes restore_backup_unit restore_zip '
            'backup_fresh backup_sent rowtap device_guard static_host device_pair perf_repair boot_open '
            'boot_ready vendor_canon_unit launcher upgrade_in_place paint_academy perf_academy').split()
SMOKE = r'^(DOM-1 |DOM-2 |DOM-13 |DOM-M683-)'
FAST_LAWS = r'^(M683-|M167:|M168:|M254:|M32-4 |M2\b|M3\b|M4\b|M6\b|M9\b|M62-|M75-|M78-|M82-|M397-|M440-|M510-3\b|M510-29\b|M682-)'


def jobs(profile):
    core = [dict(name='harness', command=['node', 'tests/harness/run.mjs'], selector=FAST_LAWS if profile == 'fast' else None),
            dict(name='walk', command=['node', 'tests/dom/run.mjs'], selector=SMOKE if profile == 'fast' else None),
            dict(name='lint', command=['bash', 'tests/audit_lint.sh'])]
    if profile != 'fast':
        core.insert(2, dict(name='long', command=['node', 'tests/dom/longplay.mjs']))
    names = ['check_runner_unit', 'academy_ui', 'boot_ready'] if profile == 'fast' else STANDING + ['check_runner_unit', 'academy_ui', 'housekeeper_rounds', 'perf_housekeeper']
    if profile == 'full':
        names = sorted(p.stem for p in (ROOT / 'tests').glob('*.py'))
    result = core + [dict(name=name, command=[sys.executable, '-B', 'tests/' + name + '.py']) for name in dict.fromkeys(names)]
    if profile != 'fast':
        result += [dict(name='paint_academy_night', command=[sys.executable, '-B', 'tests/paint_academy.py'], environment={'COZY_TEST_COAT': 'academy-night'}),
                   dict(name='perf_academy_night', command=[sys.executable, '-B', 'tests/perf_academy.py'], environment={'COZY_TEST_COAT': 'academy-night'}),
                   dict(name='paint_academy_panels', command=[sys.executable, '-B', 'tests/paint_coats.py', 'academy', 'academy-night'])]
    return result


def isolated(job):
    name = job['name']
    safe = set(STANDING) | {'check_runner_unit', 'academy_ui', 'housekeeper_rounds'}
    return name not in safe or name in ('launcher', 'upgrade_in_place') or name.startswith(('perf_', 'paint'))


def can_reuse(job):
    # Pixel and timing results depend on the machine, not just the source.
    return not job['name'].startswith(('perf_', 'paint')) and job['name'] not in ('contrast', 'coat', 'academy_ui')


def source_digest(root=ROOT):
    """Hash all product/test inputs, including new files. Documentation cannot change execution."""
    paths = []
    for folder in ('js', 'css', 'assets', 'tests', 'tools'):
        for p in (root / folder).rglob('*'):
            if p.is_file() and not set(p.parts) & {'node_modules', '__pycache__', '.git'}:
                if p.suffix not in ('.md', '.log') or folder == 'assets':
                    paths.append(p)
    for name in ('index.html', 'sw.js', 'serve.py', 'serve.sh', 'install.sh', 'cozytavern.sh', 'audit/gates.sh'):
        if (root / name).is_file():
            paths.append(root / name)
    digest = hashlib.sha256()
    for p in sorted(set(paths)):
        digest.update(str(p.relative_to(root)).encode() + b'\0' + p.read_bytes() + b'\0')
    return digest.hexdigest()


def runtime_digest():
    versions = [sys.version, sys.platform, subprocess.check_output(['node', '--version'], text=True).strip()]
    for name in ('playwright', 'numpy', 'pillow'):
        try:
            versions.append(name + ':' + importlib.metadata.version(name))
        except importlib.metadata.PackageNotFoundError:
            versions.append(name + ':absent')
    return hashlib.sha256('\n'.join(versions).encode()).hexdigest()


def job_digest(job, source, runtime):
    return hashlib.sha256(json.dumps([job, source, runtime], sort_keys=True).encode()).hexdigest()


def reusable(job, previous, digest):
    return can_reuse(job) and previous.get('exit') == 0 and previous.get('digest') == digest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('profile', nargs='?', choices=['fast', 'release', 'full'], default='fast')
    parser.add_argument('--tag', default=None)
    parser.add_argument('--jobs', type=int, choices=[1, 2], default=2, help='independent functional browser checks only')
    parser.add_argument('--resume', action='store_true', help='reuse successful functional checks of identical source and runtime')
    parser.add_argument('--list', action='store_true')
    args = parser.parse_args()
    tag = args.tag or 'check_' + args.profile
    if not re.fullmatch(r'[A-Za-z0-9_]+', tag):
        parser.error('tag must contain letters, numbers or underscores')
    selected = jobs(args.profile)
    if args.list:
        print(json.dumps({'profile': args.profile, 'checks': selected}, indent=2))
        return 0
    output = Path('/tmp/gates')
    output.mkdir(exist_ok=True)
    summary_file = output / (tag + '_summary.json')
    previous = {}
    if args.resume and summary_file.exists():
        try:
            previous = json.loads(summary_file.read_text()).get('checks', {})
        except (ValueError, OSError):
            pass
    done = output / (tag + '_done')
    done.unlink(missing_ok=True)
    source, runtime = source_digest(), runtime_digest()
    started = time.monotonic()
    report = {'profile': args.profile, 'source_digest': source, 'runtime_digest': runtime,
              'scope': 'focused development checks' if args.profile == 'fast' else 'all 22 standing checks plus workflow/housekeeper/theme checks' if args.profile == 'release' else 'every top-level Python test',
              'complete': False, 'checks': {}}
    # A previous green summary must not appear complete while its next run is in progress.
    summary_file.write_text(json.dumps(report, indent=2) + '\n')
    print(args.profile.upper() + ': ' + report['scope'] + '; ' + str(len(selected)) + ' checks', flush=True)
    # Explicit selectors belong only to fast mode. Ambient diagnostic selectors must never thin a release.
    environment = os.environ.copy()
    for key in ('ONLY', 'TEST_REPORT', 'SCENE', 'COZY_TEST_SCENE', 'COZY_TEST_SCENES', 'COZY_TEST_COAT'):
        environment.pop(key, None)
    # Proxying a local fake provider is unrelated to the application and can break tavern.test.
    for key in ('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'):
        environment.pop(key, None)
    # Diagnostic script options cannot point a release at another checkout, thin it, or use a live library.
    for test_file in (ROOT / 'tests').glob('*.py'):
        for key in re.findall(r"os\.(?:environ\.get|getenv)\(['\"]([^'\"]+)", test_file.read_text()):
            if key != 'PATH':
                environment.pop(key, None)
    environment['COZY_TEST_REPO'] = str(ROOT)
    environment['REPO_DIR'] = str(ROOT)
    environment['NO_PROXY'] = 'localhost,127.0.0.1,tavern.test'
    environment['PYTHONDONTWRITEBYTECODE'] = '1'

    def run(job):
        name = job['name']
        digest = job_digest(job, source, runtime)
        old = previous.get(name, {})
        if args.resume and reusable(job, old, digest):
            print(name + ' REUSED, identical source and runtime', flush=True)
            return name, dict(old, reused=True)
        env = dict(environment)
        env.update(job.get('environment', {}))
        if job.get('selector'):
            env['ONLY'] = job['selector']
        if name in ('harness', 'walk', 'long'):
            env['TEST_REPORT'] = str(output / (tag + '_' + name + '_timings.json'))
        # Each test already uses its own fixture directory. Give browser tests distinct ports too.
        if name not in ('launcher', 'upgrade_in_place'):
            index = [j['name'] for j in selected].index(name)
            env['COZY_TEST_PORT'] = str(18000 + index)
            env['NOTES_PORT'] = str(18000 + index)
            env['FAKE_PORT'] = str(20000 + index)
        log_path = output / (tag + '_' + name + '.log')
        start = time.monotonic()
        with tempfile.TemporaryDirectory(prefix='cozy-check-' + name + '-') as fixture, log_path.open('w') as log:
            env['COZY_TEST_DATA'] = fixture
            try:
                process = subprocess.Popen(job['command'], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
                code = process.wait(timeout=1200)
            except KeyboardInterrupt:
                os.killpg(process.pid, signal.SIGTERM)
                process.wait(timeout=10)
                raise
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
                code = 124
            log.write('\nEXIT ' + str(code) + '\n')
        seconds = round(time.monotonic() - start, 2)
        print(name + ' EXIT ' + str(code) + ' (' + str(seconds) + 's)', flush=True)
        return name, {'exit': code, 'seconds': seconds, 'digest': digest, 'log': str(log_path), 'reused': False}

    def save(result):
        name, value = result
        report['checks'][name] = value
        summary_file.write_text(json.dumps(report, indent=2) + '\n')

    # Core UI, fixed-port launchers and measurements run alone. Only independent functional browser tests overlap.
    for job in selected:
        if isolated(job):
            save(run(job))
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futures = [pool.submit(run, job) for job in selected if not isolated(job)]
        for future in concurrent.futures.as_completed(futures):
            save(future.result())
    unchanged = source_digest() == source
    report.update({'complete': unchanged and len(report['checks']) == len(selected) and all(v['exit'] == 0 for v in report['checks'].values()),
                   'source_unchanged_during_checks': unchanged, 'seconds': round(time.monotonic() - started, 2)})
    summary_file.write_text(json.dumps(report, indent=2) + '\n')
    done = output / (tag + '_done')
    if report['complete']:
        done.write_text('ALLDONE\n')
    elif done.exists():
        done.unlink()
    print('PASS' if report['complete'] else 'FAIL, see ' + str(summary_file), flush=True)
    print('Complete ' + args.profile + ' profile: ' + str(report['seconds']) + 's; report ' + str(summary_file), flush=True)
    return 0 if report['complete'] else 1


if __name__ == '__main__':
    sys.exit(main())
