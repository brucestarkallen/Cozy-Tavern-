#!/usr/bin/env python3
"""What one streaming paint costs as the page grows, at 6x CPU throttle."""
import os, shutil, subprocess, sys, time
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = '/tmp/cozydata-paint'
PORT = '8095'
BASE = 'http://127.0.0.1:%s/' % PORT

shutil.rmtree(DATA, ignore_errors=True)
os.makedirs(DATA, exist_ok=True)
env = dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA)
srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], env=env,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--no-sandbox'])
        ctx = browser.new_context(viewport={'width': 412, 'height': 915}, is_mobile=True, has_touch=True)
        page = ctx.new_page()
        cdp = ctx.new_cdp_session(page)
        page.goto(BASE, wait_until='load')
        page.wait_for_function("!!window.__cozy && !!window.__cozy.chat", timeout=25000)
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': 6})
        page.wait_for_timeout(300)

        out = page.evaluate("""async () => {
          const mods = await Promise.all([import('/js/regex.js'), import('/js/ui/prose.js'), import('/js/ui/richhtml.js')]);
          const { applyRules, currentRules, loadRules } = mods[0];
          const { parseScene, renderRich } = mods[1];
          const { looksHtml, renderHtmlProse } = mods[2];
          await loadRules();
          const host = document.createElement('div');
          document.body.appendChild(host);
          // the same work dressInto does, measured on its own
          let paintCostMs = 0, paintedAt = 0;
          const dress = (text) => {
            const shown = applyRules(text, currentRules(), { on: 'assistant', mode: 'display' });
            const dressed = shown !== text && looksHtml(shown);
            const frag = document.createDocumentFragment();
            if (dressed) frag.appendChild(renderHtmlProse(shown));
            else for (const part of parseScene(shown)) {
              if (part.type === 'head') { const h = document.createElement('div'); h.textContent = part.text; frag.appendChild(h); }
              else frag.appendChild(renderRich(part.text));
            }
            host.replaceChildren(frag);
          };
          const para = '[The Wayward Lantern — Tuesday, March 4, 2026 | 21:14 | rain | a grey coat | by the door]\\n\\n'
            + 'The rain kept on against the shutters, and nobody said the thing they meant. '.repeat(12) + '\\n\\n';
          // a whole stream, the way it really arrives: a chunk every ~40ms
          const stream = (throttled) => {
            let text = '';
            let cost = 0, at = 0, paints = 0, work = 0;
            const t0 = performance.now();
            for (let step = 0; step < 90; step += 1) {
              text += para;
              const now = t0 + step * 40;              // the clock the chunks arrive on
              if (throttled && now < at + cost * 4) continue;
              const p0 = performance.now();
              dress(text);
              cost = performance.now() - p0;
              at = now;
              paints += 1;
              work += cost;
            }
            return { paints, work: Math.round(work), chars: text.length };
          };
          const before = stream(false);
          const after = stream(true);
          host.remove();
          return { before, after };
        }""")

        b, a = out['before'], out['after']
        print('a 90-chunk page (%d characters) streaming at 6x CPU throttle:' % b['chars'])
        print('  every frame (before M164): %3d paints, %6d ms of main thread spent re-drawing' % (b['paints'], b['work']))
        print('  self-tuning  (after M164): %3d paints, %6d ms' % (a['paints'], a['work']))
        print('\n  main-thread work saved: %.1fx  (%d ms given back to the stream)' % (b['work'] / max(1, a['work']), b['work'] - a['work']))
        browser.close()
finally:
    srv.terminate()
