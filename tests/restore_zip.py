#!/usr/bin/env python3
"""M510-47: "Take a copy" and "Bring a copy back" through the REAL app, a REAL browser and the REAL tavern server — the
device's zip is taken, the library moves on (a tale made after the copy, a setting changed after it), the zip is
brought back through Settings' own file button, and afterwards the device's books AND the browser hold exactly the
copy: the later tale gone from both, the setting as copied, the copied tale's pages whole; the library as it stood kept
in backups. Exits 1 on any miss."""
import os, shutil, subprocess, sys, time, json, urllib.request, zipfile, io
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = '/tmp/cozydata-restore'
PORT = os.environ.get('COZY_TEST_PORT', '8097')
BASE = 'http://127.0.0.1:%s/' % PORT
shutil.rmtree(DATA, ignore_errors=True); os.makedirs(DATA, exist_ok=True)
srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], cwd=REPO, env=dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)
fails = []
def check(ok, what):
  print(('ok   ' if ok else 'MISS ') + what)
  if not ok: fails.append(what)
def device_books():
  books = os.path.join(DATA, 'books')
  return sorted(n[:-5] for n in os.listdir(books) if n.endswith('.json')) if os.path.isdir(books) else []
def wait_for(fn, what, secs=40):
  end = time.time() + secs
  while time.time() < end:
    try:
      if fn(): return True
    except Exception: pass
    time.sleep(0.5)
  check(False, 'waited too long for ' + what); return False
try:
  with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    page = b.new_page()
    page.on('dialog', lambda d: d.accept())
    page.goto(BASE)
    page.wait_for_function("!!window.__cozy && !!window.__cozy.chat && !!window.__cozy.booksStatus && window.__cozy.booksStatus.backed", timeout=40000)
    kept = page.evaluate("""async () => {
      const db = window.__cozy.db;
      const st = await db.stories.create({ title: 'Kept tale' });
      await db.messages.append(st.id, { role: 'user', text: 'I open the gate.' });
      await db.messages.append(st.id, { role: 'assistant', text: '[The gate — Monday, March 3, 2025 | 09:00 | clear]\\n\\nKEPT-PAGE: the gate swung open.' });
      await db.settings.set('notesRole', 'assistant');
      await db.settings.set('voicePresets', [{ id: 'vp-1', name: 'Hulk', voice: { frameText: 'I am Hulk.' }, savedAt: 1 }]);
      await window.__cozy.chat.refreshStories(true);
      return st.id; }""")
    wait_for(lambda: kept in device_books() and '_house' in device_books(), 'the kept tale on the device', 60)
    r = json.load(urllib.request.urlopen(BASE + 'api/backup/now'))
    check(bool(r.get('ok')), 'the device made its copy: ' + str(r.get('name')))
    copy = urllib.request.urlopen(BASE + 'api/backup/file').read()
    check(zipfile.is_zipfile(io.BytesIO(copy)), 'the copy handed over is a zip (' + str(len(copy)) + ' bytes)')
    later = page.evaluate("""async () => {
      const db = window.__cozy.db;
      const st = await db.stories.create({ title: 'Made after the copy' });
      await db.messages.append(st.id, { role: 'user', text: 'LATER-MOVE' });
      await db.settings.set('notesRole', 'user');
      await window.__cozy.chat.refreshStories(true);
      return st.id; }""")
    wait_for(lambda: later in device_books(), 'the later tale on the device too', 60)
    zpath = '/tmp/cozytavern-copy-under-test.zip'
    open(zpath, 'wb').write(copy)
    page.evaluate("() => { const b = document.getElementById('btn-settings') || document.querySelector('[data-act=\"settings\"]'); if (b) b.click(); }")
    time.sleep(0.8)
    page.set_input_files('#import-file', zpath)
    wait_for(lambda: page.evaluate("() => !!window.__cozy && !!window.__cozy.db") and page.evaluate("""async () => { const s = await window.__cozy.db.stories.list(); return s.length > 0 && !s.some((x) => x.title === 'Made after the copy'); }"""), 'the page reloaded on the copy', 60)
    page.wait_for_function("!!window.__cozy && !!window.__cozy.chat", timeout=40000)
    after = page.evaluate("""async (ids) => {
      const db = window.__cozy.db;
      const stories = (await db.stories.list()).map((s) => s.id);
      const pages = (await db.messages.list(ids.kept)).map((m) => m.text);
      return { stories, pages, notesRole: await db.settings.get('notesRole'), presets: await db.settings.get('voicePresets') }; }""", { 'kept': kept, 'later': later })
    check(kept in after['stories'] and later not in after['stories'], 'the browser: the copied tale is here, the later one is gone')
    check(any('KEPT-PAGE' in (t or '') for t in after['pages']), 'the copied tale\'s pages whole')
    check(after['notesRole'] == 'assistant', 'a setting as copied (notesRole: ' + str(after['notesRole']) + ')')
    check(isinstance(after['presets'], list) and after['presets'] and after['presets'][0]['name'] == 'Hulk', 'the presets as copied')
    time.sleep(3)
    check(kept in device_books() and later not in device_books(), 'the device: the copied tale, and not the later one (' + ', '.join(device_books()) + ')')
    house = json.load(open(os.path.join(DATA, 'books', '_house.json')))
    role = [r for r in house.get('settings', []) if r.get('key') == 'notesRole']
    check(bool(role) and role[0].get('value') == 'assistant', 'the device\'s house: the setting as copied')
    safeties = sorted(n for n in os.listdir(os.path.join(DATA, 'backups')) if n.endswith('.zip'))
    held = any(any(n.endswith(later + '.json') for n in zipfile.ZipFile(os.path.join(DATA, 'backups', s)).namelist()) for s in safeties)
    check(held, 'the library as it stood before the restore is kept in backups (the later tale in it)')
    b.close()
finally:
  srv.terminate()
print('\n' + ('the copy came home — the device and the browser hold it exactly' if not fails else '%d missed' % len(fails)))
sys.exit(1 if fails else 0)
