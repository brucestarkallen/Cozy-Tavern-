#!/usr/bin/env python3
"""Real phone/desktop Appearance controls, continuous story canvas and saved night choice."""
import ast
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = os.environ.get('COZY_TEST_PORT', '8187')
BASE = 'http://127.0.0.1:' + PORT + '/'
OUT = Path('/tmp/academy-m683')
SEED = next(n.value.value for n in ast.parse((ROOT / 'tests/paint_coats.py').read_text()).body
            if isinstance(n, ast.Assign) and getattr(n.targets[0], 'id', '') == 'SEED')
OUT.mkdir(exist_ok=True)


def ready(page):
    page.wait_for_function('!!window.__cozy && !!window.__cozy.chat && !!document.documentElement.dataset.version')


with tempfile.TemporaryDirectory(prefix='cozy-academy-ui-') as data:
    server = subprocess.Popen([sys.executable, str(ROOT / 'serve.py')], cwd=ROOT,
                              env=dict(os.environ, PORT=PORT, COZY_DATA_DIR=data), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(BASE, timeout=1).close()
                break
            except OSError:
                time.sleep(.05)
        with sync_playwright() as pw:
            browser = pw.chromium.launch(args=['--no-sandbox'])
            for label, size in [('phone', {'width': 412, 'height': 915}), ('desktop', {'width': 1440, 'height': 900})]:
                context = browser.new_context(viewport=size, service_workers='block', is_mobile=label == 'phone', has_touch=label == 'phone')
                page = context.new_page()
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(BASE); ready(page)
                if page.locator('#welcome-overlay').is_visible():
                    page.locator('#btn-welcome-enough').click()
                page.evaluate(SEED)
                page.evaluate('async () => { await window.__cozy.booksStatus.pushAll(); }')
                for coat in ['academy', 'academy-night']:
                    page.locator('#btn-settings').click()
                    page.locator('#settings-quicknav').get_by_role('button', name='The house', exact=True).click()
                    page.locator('input[name="theme"][value="' + coat + '"]').check()
                    page.wait_for_function('(c) => document.documentElement.dataset.theme === c', arg=coat)
                    page.evaluate('async () => { await window.__cozy.booksStatus.pushAll(); }')
                    assert page.evaluate("async () => (await import('/js/store.js')).db.settings.get('theme')") == coat
                    if coat == 'academy-night':
                        ratios = page.evaluate(r"""() => {
                          const rgb = s => (s.match(/[\d.]+/g) || []).slice(0,3).map(Number);
                          const lum = s => rgb(s).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((a,v,i) => a + v * [.2126,.7152,.0722][i],0);
                          return [...document.querySelectorAll('.settings-section:not([hidden]) > h3, .settings-section:not([hidden]) .lbl')].map(el => {
                            const a = lum(getComputedStyle(el).color), b = lum(getComputedStyle(el.closest('.settings-section')).backgroundColor);
                            return (Math.max(a,b) + .05) / (Math.min(a,b) + .05);
                          });
                        }""")
                        assert ratios and min(ratios) >= 4.5, ratios
                    page.screenshot(path=str(OUT / (label + '-' + coat + '-settings.png')))
                    page.evaluate("location.hash = '#/'")
                    page.wait_for_function("!document.querySelector('#view-chat').hidden && document.documentElement.dataset.thread === 'story'")
                    page.evaluate('document.fonts.ready')
                    canvas = page.evaluate('''() => {
                      const css = (s) => getComputedStyle(document.querySelector(s));
                      return {ground: css('.thread-wrap').backgroundImage,
                        panels: ['#thread', '.composer-zone', '#composer'].map(s => [css(s).backgroundColor, css(s).backgroundImage]),
                        map: document.querySelector('.academy-stage').getAnimations({subtree:true}).filter(a => a.playState === 'running').length,
                        overflow: document.documentElement.scrollWidth > innerWidth + 1};
                    }''')
                    assert canvas['ground'] != 'none', canvas
                    assert all(color == 'rgba(0, 0, 0, 0)' and image == 'none' for color, image in canvas['panels']), canvas
                    assert canvas['map'] == 0 and not canvas['overflow'], canvas
                    if coat == 'academy-night':
                        assert page.locator('meta[name="theme-color"]').get_attribute('content') == '#0b1320'
                    page.locator('#composer-input').fill('I put my book beside the warm window.')
                    assert page.locator('#composer-input').input_value().startswith('I put my book')
                    page.screenshot(path=str(OUT / (label + '-' + coat + '-story.png')))
                    page.reload(); ready(page)
                    page.wait_for_function('(c) => document.documentElement.dataset.theme === c', arg=coat)
                    assert page.evaluate("document.documentElement.dataset.thread") == 'story'
                page.evaluate('async () => { window.__cozy.setActiveStoryId(null); await window.__cozy.chat.renderThread({structural:true, opening:true}); }')
                page.wait_for_function("!!document.querySelector('#thread > .hearth')")
                page.screenshot(path=str(OUT / (label + '-academy-night-welcome.png')))
                page.emulate_media(reduced_motion='reduce')
                page.wait_for_timeout(150)
                assert page.evaluate("document.querySelector('.academy-stage').getAnimations({subtree:true}).filter(a => a.playState === 'running').length") == 0
                assert not errors, errors
                print(label + ': day/night input canvas, actual Appearance choice, persistence, typing, motion and screenshots PASS')
                context.close()
            browser.close()
    finally:
        server.terminate(); server.wait(timeout=10)
print('PASS; screenshots ' + str(OUT))
