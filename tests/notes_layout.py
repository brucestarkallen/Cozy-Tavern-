"""M623 — his screenshot: the house's thinking note's words squeezed into a column one letter wide beside a full-width tick.
The walk runs in jsdom, which lays nothing out, so it could not see it. This check opens the real app in a headless Chromium
at his phone's width, against the real serve.py, adds a note, and MEASURES each note card: its words must take the card's
width, its tick must be a tick, its two choices must be there. Exit 0 when every card holds."""
import os, sys, time, subprocess, tempfile, shutil
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = os.environ.get('NOTES_PORT', '8096')
DATA = tempfile.mkdtemp(prefix='cz-notes-')


def main():
    env = dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA)
    srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=REPO)
    try:
        time.sleep(1.5)
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ok = True
            for width in (360, 412, 900):
                ctx = browser.new_context(viewport={'width': width, 'height': 915}, device_scale_factor=2, service_workers='block')
                page = ctx.new_page()
                page.goto(f'http://127.0.0.1:{PORT}/#/settings')
                page.wait_for_timeout(2500)
                page.evaluate("() => { for (const b of document.querySelectorAll('button')) if (/Enough/.test(b.textContent || '')) { b.click(); break; } }")
                page.evaluate("() => { const n = document.getElementById('settings-quicknav'); if (n && n.openRoomFor) n.openRoomFor('section-note'); }")
                page.wait_for_timeout(1200)
                page.evaluate("() => { const t = document.getElementById('note-add-text'); t.value = 'Keep the scene close.'; t.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('btn-note-add').click(); }")
                page.wait_for_timeout(800)
                cards = page.evaluate("""() => [...document.querySelectorAll('#note-adds-list .note-add-card')].map((c) => {
                  const w = (sel) => { const n = c.querySelector(sel); return n ? Math.round(n.getBoundingClientRect().width) : 0; };
                  return { card: Math.round(c.getBoundingClientRect().width), words: w('textarea'), tick: w('input[type=checkbox]'), choices: c.querySelectorAll('select').length };
                })""")
                print('width', width, cards)
                if len(cards) < 2:
                    ok = False
                    print('FAIL: the house note and the added note should both stand')
                for c in cards:
                    if not (c['card'] > 200 and c['words'] >= 0.8 * c['card'] and 0 < c['tick'] <= 40 and c['choices'] == 2):
                        ok = False
                        print('FAIL: a card is squeezed or missing its choices:', c)
                ctx.close()
            browser.close()
        print('notes layout', 'holds' if ok else 'BROKEN')
        return 0 if ok else 1
    finally:
        srv.terminate()
        shutil.rmtree(DATA, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
