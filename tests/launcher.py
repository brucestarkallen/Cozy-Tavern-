#!/usr/bin/env python3
"""M676: THE WORD HE TYPES — `cozytavern` — RUN AS HE RUNS IT. No browser: a Termux of its own (HOME and PREFIX in a
scratch folder, a `pkg` that does nothing), a copy of this repository to pull from, and the real install.sh and the real
launcher. Each scene types the word and reads back what it said, what the folder is, which server answers, and what the
word on disk has become.

Found running his update end to end: the bake wrote the home into the launcher's own sed as well, so every update wrote
the word back UNBAKED (the next update baked it again), and the self-heal's own test, baked, was true on every run — a
clone in a usual place won over the folder the word was installed for.

  python3 tests/launcher.py            # prints "N ok"; exits 1 with what went wrong (port 8080 must be free: it is the word's own)
"""
import os, shutil, subprocess, sys, tempfile, time, urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = 'http://127.0.0.1:8080/'
MARK = '__COZY' + '_HOME__'

ok = 0
bad = []


def check(cond, what):
    global ok
    if cond:
        ok += 1
        print('ok   ' + what, flush=True)
    else:
        bad.append(what)
        print('FAIL ' + what, flush=True)


def git(*args, cwd=None):
    return subprocess.check_output(['git'] + list(args), cwd=cwd, text=True, stderr=subprocess.STDOUT).strip()


def served():
    try:
        with urllib.request.urlopen(BASE + 'api/version', timeout=2) as r:
            return r.read().decode()
    except Exception:
        return None


def port_free():
    import socket
    s = socket.socket()
    try:
        return s.connect_ex(('127.0.0.1', 8080)) != 0
    finally:
        s.close()


def servers():
    """the command lines of every serve.py running from this scratch folder"""
    out = subprocess.run(['pgrep', '-af', 'serve.py'], capture_output=True, text=True).stdout
    return [ln for ln in out.split('\n') if T in ln]


def douse():
    subprocess.run(['pkill', '-f', T + '/'], capture_output=True)
    for _ in range(40):
        if port_free() and not servers():
            return
        time.sleep(0.1)


def type_word(env, home):
    r = subprocess.run([os.path.join(env['PREFIX'], 'bin', 'cozytavern')], cwd=home, env=env, capture_output=True, text=True, timeout=180)
    lit = servers()
    return r, lit


def baked_for(text, folder):
    """the launcher text exactly as a bake for `folder` leaves it: the mark replaced wherever it literally stands"""
    return text.replace(MARK, folder)


def scene_env(name):
    home = os.path.join(T, name, 'home')
    prefix = os.path.join(T, name, 'usr')
    os.makedirs(os.path.join(prefix, 'bin'))
    os.makedirs(home)
    pkg = os.path.join(prefix, 'bin', 'pkg')
    open(pkg, 'w').write('#!/bin/sh\nexit 0\n')  # Termux's package manager: everything is already there
    os.chmod(pkg, 0o755)
    env = {k: v for k, v in os.environ.items() if k not in ('PORT', 'COZY_DATA_DIR', 'COZY_HOSTS', 'COZY_HOME', 'COZY_TEST_PORT')}
    env.update(HOME=home, PREFIX=prefix, PATH=os.path.join(prefix, 'bin') + ':' + os.environ.get('PATH', ''))
    return env, home


def bump(why):
    """an update arrives on the repository he pulls from"""
    with open(os.path.join(ORIGIN, '.launcher-test-update'), 'a') as f:
        f.write(why + '\n')
    git('add', '.launcher-test-update', cwd=ORIGIN)
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', why, cwd=ORIGIN)
    return git('rev-parse', 'HEAD', cwd=ORIGIN)


T = tempfile.mkdtemp(prefix='cozy-launcher-')
ORIGIN = os.path.join(T, 'origin')
try:
    if not port_free():
        print('FAIL port 8080 is taken — the word lights the tavern there; free it first')
        sys.exit(1)
    # the repository he pulls from: this one, as the working tree has it
    git('clone', '-q', REPO, ORIGIN)
    changed = [f for f in git('diff', '--name-only', 'HEAD', cwd=REPO).split('\n') if f]
    for f in changed:
        src = os.path.join(REPO, f)
        if os.path.exists(src):
            os.makedirs(os.path.dirname(os.path.join(ORIGIN, f)), exist_ok=True)
            shutil.copy2(src, os.path.join(ORIGIN, f))
        elif os.path.exists(os.path.join(ORIGIN, f)):
            os.remove(os.path.join(ORIGIN, f))
    if changed:
        git('add', '-A', cwd=ORIGIN)
        git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'the build under test', cwd=ORIGIN)
    LAUNCHER = open(os.path.join(ORIGIN, 'cozytavern.sh'), encoding='utf-8').read()
    VER = [ln for ln in open(os.path.join(ORIGIN, 'js', 'version.js'), encoding='utf-8') if 'VERSION = ' in ln][0].split("'")[1]
    # the word as every build before M676 wrote it (the newest launcher in history without the split mark)
    OLD_WORD = None
    for c in ['HEAD'] + git('log', '--format=%H', '--', 'cozytavern.sh', cwd=REPO).split('\n'):
        try:
            text = git('show', c + ':cozytavern.sh', cwd=REPO) + '\n'
        except subprocess.CalledProcessError:
            continue
        if 'MARK="__COZY""_HOME__"' not in text:
            OLD_WORD = text
            break
    check(OLD_WORD is not None and MARK in OLD_WORD, 'fixture: the word as the builds before M676 wrote it is in the history')

    # ---------------------------------------------------------------- 1. installed, then an update, then another
    env, home = scene_env('install')
    phone = os.path.join(home, 'cozytavern')
    git('clone', '-q', ORIGIN, phone)
    r = subprocess.run(['bash', os.path.join(phone, 'install.sh')], cwd=home, env=env, capture_output=True, text=True, timeout=180)
    word = os.path.join(env['PREFIX'], 'bin', 'cozytavern')
    good = r.returncode == 0 and 'The tavern is ready' in r.stdout and 'unbaked' not in r.stdout
    check(good, 'install.sh ends cleanly and proves its bake (exit %s)%s' % (r.returncode, '' if good else ': ' + (r.stdout + r.stderr).strip()[-300:]))
    check(os.path.exists(word) and open(word, encoding='utf-8').read() == baked_for(LAUNCHER, phone), 'the word is the launcher, baked with his folder')
    r, lit = type_word(env, home)
    check(r.returncode == 0 and ('Already on %s — the tavern is current.' % VER) in r.stdout, 'typed: it says the tavern is current (exit %s)' % r.returncode)
    check(len(lit) == 1 and (phone + '/serve.py') in lit[0] and VER in (served() or ''), 'and the tavern lit is his folder’s, on %s: %s' % (VER, lit))
    for n in (1, 2, 3):
        new_head = bump('update %d' % n)
        r, lit = type_word(env, home)
        check(r.returncode == 0 and ('Fresh coat on: the tavern is now at %s.' % VER) in r.stdout and git('rev-parse', 'HEAD', cwd=phone) == new_head, 'update %d: typed, it pulls the update and says so' % n)
        check(open(word, encoding='utf-8').read() == baked_for(LAUNCHER, phone), 'update %d: the word it writes back is baked with his folder (it came back unbaked at every other update)' % n)
        check(len(lit) == 1 and (phone + '/serve.py') in lit[0], 'update %d: one tavern lit, his folder’s: %s' % (n, lit))
    douse()

    # ---------------------------------------------------------------- 2. installed for a folder that is not a usual one, a clone standing in a usual one
    env, home = scene_env('elsewhere')
    mine = os.path.join(home, 'stories', 'tavern')
    os.makedirs(os.path.dirname(mine))
    git('clone', '-q', ORIGIN, mine)
    decoy = os.path.join(home, 'cozytavern')
    git('clone', '-q', ORIGIN, decoy)
    r = subprocess.run(['bash', os.path.join(mine, 'install.sh')], cwd=home, env=env, capture_output=True, text=True, timeout=180)
    word = os.path.join(env['PREFIX'], 'bin', 'cozytavern')
    check(r.returncode == 0 and open(word, encoding='utf-8').read() == baked_for(LAUNCHER, mine), 'fixture: the word is installed for ~/stories/tavern')
    r, lit = type_word(env, home)
    check(r.returncode == 0 and len(lit) == 1 and (mine + '/serve.py') in lit[0], 'typed: the tavern lit is the folder the word was installed for, not the clone in ~/cozytavern: %s' % lit)
    new_head = bump('update for the folder elsewhere')
    r, lit = type_word(env, home)
    check(git('rev-parse', 'HEAD', cwd=mine) == new_head and git('rev-parse', 'HEAD', cwd=decoy) != new_head, 'an update is pulled into that folder, and the clone is left alone')
    check(open(word, encoding='utf-8').read() == baked_for(LAUNCHER, mine) and len(lit) == 1 and (mine + '/serve.py') in lit[0], 'and the word stays his folder’s')
    douse()

    # ---------------------------------------------------------------- 3. the words on phones today (written by builds before M676): baked, and unbaked
    for kind, a_kind in (('baked', 'a baked'), ('unbaked', 'an unbaked')):
        env, home = scene_env('old-' + kind)
        phone = os.path.join(home, 'cozytavern')
        git('clone', '-q', ORIGIN, phone)
        word = os.path.join(env['PREFIX'], 'bin', 'cozytavern')
        open(word, 'w', encoding='utf-8').write(baked_for(OLD_WORD, phone) if kind == 'baked' else OLD_WORD)
        os.chmod(word, 0o755)
        new_head = bump('the update that brings M676 to a %s word' % kind)
        r, lit = type_word(env, home)
        check(r.returncode == 0 and git('rev-parse', 'HEAD', cwd=phone) == new_head and len(lit) == 1 and (phone + '/serve.py') in lit[0], '%s word from before: typed, the update is pulled and his tavern lit' % a_kind)
        r, lit = type_word(env, home)
        check(r.returncode == 0 and ('Already on %s — the tavern is current.' % VER) in r.stdout and len(lit) == 1 and (phone + '/serve.py') in lit[0], 'typed again: the word the update wrote finds his tavern')
        check(open(word, encoding='utf-8').read() == baked_for(LAUNCHER, phone), 'and from then on it is the new launcher, baked with his folder')
        new_head = bump('and one more for a %s word' % kind)
        r, lit = type_word(env, home)
        check(git('rev-parse', 'HEAD', cwd=phone) == new_head and open(word, encoding='utf-8').read() == baked_for(LAUNCHER, phone), 'and stays so through the next update')
        douse()
finally:
    douse()
    shutil.rmtree(T, ignore_errors=True)

for w in bad:
    print('FAIL — ' + w)
print('%d ok, %d failed' % (ok, len(bad)))
sys.exit(1 if bad else 0)
