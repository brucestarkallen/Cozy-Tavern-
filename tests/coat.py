#!/usr/bin/env python3
"""Does the 🎨 header card follow the coat? Real Chromium, both themes."""
import os, shutil, subprocess, sys, time
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = '/tmp/cozydata-coat'
PORT = os.environ.get('COZY_TEST_PORT', '8094')
BASE = 'http://127.0.0.1:%s/' % PORT

shutil.rmtree(DATA, ignore_errors=True)
os.makedirs(DATA, exist_ok=True)
env = dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA)
srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], env=env,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)

HEADER = '[The Wayward Lantern — Tuesday, March 4, 2026 | 21:14 | rain | a grey coat | by the door]'


def luminance(rgb):
    def ch(v):
        v = v / 255.0
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = rgb
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


import re as _re


def parse(css):
    # the first rgb(...) in the string — a gradient's "135deg" is not a colour
    m = _re.search(r'rgba?\((\d+),\s*(\d+),\s*(\d+)', str(css))
    return (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else (0, 0, 0)


fails = []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--no-sandbox'])
        for coat in ('dark', 'light', 'deep', 'magma'):
            ctx = browser.new_context()
            page = ctx.new_page()
            page.goto(BASE, wait_until='load')
            page.wait_for_function("!!window.__cozy && !!window.__cozy.chat", timeout=25000)
            page.evaluate("(c) => document.documentElement.setAttribute('data-theme', c)", coat)
            out = page.evaluate("""async (header) => {
              const { applyRules, currentRules, loadRules } = await import('/js/regex.js');
              const { renderHtmlProse } = await import('/js/ui/richhtml.js');
              await loadRules();
              const shown = applyRules(header, currentRules(), { on: 'assistant', mode: 'display' });
              const host = document.createElement('div');
              document.body.appendChild(host);
              host.appendChild(renderHtmlProse(shown));
              const card = host.querySelector('div[style]');
              const place = host.querySelectorAll('div[style]')[1] || card;
              const cs = getComputedStyle(card);
              const ps = getComputedStyle(place);
              const room = getComputedStyle(document.body).backgroundColor;
              const res = { dressed: shown !== header, card: cs.backgroundImage || cs.backgroundColor, place: ps.color, room };
              host.remove();
              return res;
            }""", HEADER)
            room = parse(out['room'])
            card = parse(out['card'])
            ink = parse(out['place'])
            dl = abs(luminance(room) - luminance(card))
            contrast = (max(luminance(card), luminance(ink)) + 0.05) / (min(luminance(card), luminance(ink)) + 0.05)
            ok = out['dressed'] and dl < 0.35 and contrast >= 4.5
            print('  %-6s room %-16s card %-16s place-ink %-16s | card-vs-room lum gap %.2f, ink contrast %.1f:1  %s'
                  % (coat, out['room'], str(card), str(ink), dl, contrast, 'ok' if ok else 'FAIL'))
            if not ok:
                fails.append(coat)
            ctx.close()
        browser.close()
finally:
    srv.terminate()

print()
print('the header card follows the coat' if not fails else 'the header card does NOT belong on: ' + ', '.join(fails))
sys.exit(1 if fails else 0)
