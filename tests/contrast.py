#!/usr/bin/env python3
"""Every text surface in the room, measured against its own background, in
both coats. WCAG AA is 4.5:1 for body text, 3:1 for large text (>=18.66px
bold or >=24px)."""
import os, re, shutil, subprocess, sys, time
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = '/tmp/cozydata-contrast'
PORT = os.environ.get('COZY_TEST_PORT', '8092')
BASE = 'http://127.0.0.1:%s/' % PORT

shutil.rmtree(DATA, ignore_errors=True)
os.makedirs(DATA, exist_ok=True)
env = dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA)
srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], env=env,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)

PROBE = """
() => {
  const lum = (c) => {
    const m = String(c).match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?/);
    if (!m) return null;
    const a = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (a < 0.95) return null;                       // translucent: not judged here
    const ch = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * ch(+m[1]) + 0.7152 * ch(+m[2]) + 0.0722 * ch(+m[3]);
  };
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = getComputedStyle(n).backgroundColor;
      const l = lum(c);
      if (l !== null) return l;
      n = n.parentElement;
    }
    return lum(getComputedStyle(document.body).backgroundColor) ?? 1;
  };
  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || el.hidden) continue;
    const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim());
    if (!text) continue;
    const fg = lum(cs.color);
    if (fg === null) continue;
    const bg = bgOf(el);
    const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    const px = parseFloat(cs.fontSize) || 16;
    const bold = (parseInt(cs.fontWeight, 10) || 400) >= 700;
    const large = px >= 24 || (bold && px >= 18.66);
    const need = large ? 3 : 4.5;
    const key = el.className + '|' + cs.color + '|' + Math.round(px);
    if (seen.has(key)) continue;
    seen.add(key);
    if (ratio < need) {
      out.push({ where: (el.tagName.toLowerCase() + '.' + String(el.className || '').split(' ')[0]).slice(0, 44),
                 ratio: Math.round(ratio * 10) / 10, need, px: Math.round(px),
                 words: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 34) });
    }
  }
  return out;
}
"""

fails = {}
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--no-sandbox'])
        for coat in ('dark', 'light', 'deep', 'magma', 'fantasy', 'cyberpunk', 'academy', 'aurora', 'starship'):   # M254: the third coat is held to the same law; M465: every coat
            ctx = browser.new_context(viewport={'width': 412, 'height': 915})
            page = ctx.new_page()
            page.goto(BASE, wait_until='load')
            page.wait_for_function("!!window.__cozy && !!window.__cozy.chat", timeout=25000)
            page.evaluate("(c) => document.documentElement.setAttribute('data-theme', c)", coat)
            page.wait_for_timeout(200)
            rows = []
            # the story room, then every room of Settings, then the ledger
            rows += page.evaluate(PROBE)
            page.evaluate("() => { location.hash = '#/settings'; }")
            page.wait_for_timeout(900)
            for room in ('storyteller', 'world', 'readers', 'craft', 'house'):
                page.evaluate("""(r) => { const b = document.querySelector('[data-room="' + r + '"]'); if (b) b.click(); }""", room)
                page.wait_for_timeout(350)
                rows += page.evaluate(PROBE)
            page.evaluate("() => { location.hash = '#/'; }")
            page.wait_for_timeout(400)
            page.evaluate("() => { const b = document.getElementById('btn-ledger'); if (b) b.click(); }")
            page.wait_for_timeout(700)
            rows += page.evaluate(PROBE)

            uniq = {}
            for r in rows:
                uniq[r['where'] + str(r['ratio'])] = r
            rows = sorted(uniq.values(), key=lambda r: r['ratio'])
            print('%s coat — %d text surfaces under AA:' % (coat, len(rows)))
            for r in rows[:14]:
                print('   %5.1f:1 (needs %.1f)  %-44s %2dpx  "%s"' % (r['ratio'], r['need'], r['where'], r['px'], r['words']))
            if rows:
                fails[coat] = rows
            ctx.close()
        browser.close()
finally:
    srv.terminate()

print()
print('every text surface meets AA in every coat' if not fails
      else 'surfaces under AA: ' + ', '.join('%s %d' % (k, len(v)) for k, v in fails.items()))
