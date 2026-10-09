#!/usr/bin/env python3
"""M678: THE ACADEMY'S MAP, MEASURED ON ITS OWN PIXELS — in a real Chromium, phone and desktop.

contrast.py and paint_coats.py judge a text against the first SOLID colour behind it. In the academy the story stands
on a picture (the map, under a veil, with lamps that flicker), so those probes see only the body's colour. This test
photographs the room twice — words shown, then words made invisible (three frames, so a lamp at its brightest is
caught) — and finds each text's own letters as the pixels that changed inside the boxes of ITS OWN text nodes. The ink
is judged against the WORST ground found right under those letters (the brightest under light ink, the darkest under
dark ink, 99.5th percentile over the three frames). Exits 1 when any line is under AA
(4.5:1, or 3:1 for large type), when a picture or a font the coat names fails to load, when the map is not drawn
behind the room, or when the page throws.

What it does not judge: the house's whispers — a page's actions rest at 0 (mouse) or 0.28 (finger) until he reaches
for them (M8), in every coat; they are judged where they show in full, on the newest page.

What it covers: the story (both kinds of page, the scene card, the labels, the actions, the line under the box he
writes in), the welcome card on the bright map, and Settings' own words over its veiled map.

  python3 tests/paint_academy.py
"""
import io, os, shutil, subprocess, sys, time
import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = '/tmp/cozydata-academy'
PORT = os.environ.get('COZY_TEST_PORT', '8167')
BASE = 'http://127.0.0.1:%s/' % PORT
OUT = '/tmp/academy'

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ast
_src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'paint_coats.py')).read()
SEED = next(n.value.value for n in ast.parse(_src).body if isinstance(n, ast.Assign) and getattr(n.targets[0], 'id', '') == 'SEED')

# every element with words of its own inside the given roots, with its box and its ink
TEXTS = """
(sel) => {
  const out = [];
  for (const root of document.querySelectorAll(sel)) {
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (!el.isConnected) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim());
      if (!own) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
      if (el.closest('[hidden]') || el.closest('.visually-hidden')) continue;
      let o = 1, n = el;
      while (n && n !== document.documentElement) { o *= parseFloat(getComputedStyle(n).opacity); n = n.parentElement; }
      // the house's whispers — a page's actions rest at 0 (a mouse) or 0.28 (a finger) until asked for (M8); they are
      // affordances, not reading, in every coat, and are judged where they are shown in full (on the newest page)
      if (o < 0.5) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      // the boxes of this element's OWN words (not its children's, which have their own ink)
      const rects = [];
      for (const tn of el.childNodes) {
        if (tn.nodeType !== 3 || !tn.nodeValue.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(tn);
        for (const q of range.getClientRects()) if (q.width > 0.5 && q.height > 0.5) rects.push([q.left, q.top, q.right, q.bottom]);
      }
      // a box scrolled out of its scroller is not drawn: keep only what shows through every clipping ancestor
      let clip = [0, 0, innerWidth, innerHeight];
      for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const ac = getComputedStyle(a);
        if (ac.overflowY !== 'visible' || ac.overflowX !== 'visible') {
          const b = a.getBoundingClientRect();
          clip = [Math.max(clip[0], b.left), Math.max(clip[1], b.top), Math.min(clip[2], b.right), Math.min(clip[3], b.bottom)];
        }
      }
      for (let i = rects.length - 1; i >= 0; i -= 1) {
        const q = rects[i];
        const c = [Math.max(q[0], clip[0]), Math.max(q[1], clip[1]), Math.min(q[2], clip[2]), Math.min(q[3], clip[3])];
        if (c[2] - c[0] < 1 || c[3] - c[1] < 1) rects.splice(i, 1); else rects[i] = c;
      }
      if (!rects.length) continue;
      const m = cs.color.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?/);
      if (!m) continue;
      out.push({ x: r.left, y: r.top, w: r.width, h: r.height, rects, rgb: [+m[1], +m[2], +m[3]], a: (m[4] === undefined ? 1 : +m[4]) * o,
                 px: parseFloat(cs.fontSize), bold: (parseInt(cs.fontWeight, 10) || 400) >= 700,
                 words: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40), where: el.tagName.toLowerCase() + '.' + String(el.className || '').split(' ')[0] });
    }
  }
  return out;
}
"""

HIDE_TEXT = """
() => {
  const s = document.createElement('style');
  s.id = 'paint-academy-hide';
  s.textContent = '* { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; } '
    + '.msg-body *, .hearth *, .settings-column * { text-decoration-color: transparent !important; }';
  document.head.appendChild(s);
}
"""


def lum(rgb):
    c = np.asarray(rgb, dtype=float) / 255.0
    c = np.where(c <= 0.03928, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]


def grab(page, dpr):
    """One frame with the words, then three frames without them, 0.7 s apart."""
    shown = np.asarray(Image.open(io.BytesIO(page.screenshot())).convert('RGB')).astype(np.int16)
    page.evaluate(HIDE_TEXT)
    page.wait_for_timeout(250)
    bare = []
    for _ in range(3):
        bare.append(np.asarray(Image.open(io.BytesIO(page.screenshot())).convert('RGB')).astype(np.int16))
        page.wait_for_timeout(700)
    page.evaluate("() => document.getElementById('paint-academy-hide').remove()")
    page.wait_for_timeout(150)
    return shown, bare


def judge(texts, shown, bare, dpr, label):
    """Each text's ink against the worst ground right under its own letters."""
    letters = np.abs(shown - bare[0]).max(axis=2) > 36           # where the words were drawn
    lums = [lum(f) for f in bare]
    bright = np.maximum.reduce(lums)
    dark = np.minimum.reduce(lums)
    H, W = letters.shape
    rows = []
    for t in texts:
        sel = np.zeros_like(letters)
        for (x0, y0, x1, y1) in t['rects']:
            a, b = max(0, int(x0 * dpr)), max(0, int(y0 * dpr))
            c, d = min(W, int(np.ceil(x1 * dpr))), min(H, int(np.ceil(y1 * dpr)))
            if c > a and d > b:
                sel[b:d, a:c] = True
        under = sel & letters
        if under.sum() < 12:
            continue                                               # nothing of it is drawn here (off screen, or ink = ground)
        fg = float(lum(t['rgb']))
        bgb = float(np.percentile(bright[under], 99.5))
        bgd = float(np.percentile(dark[under], 0.5))
        if t['a'] < 0.99:
            fgb = t['a'] * fg + (1 - t['a']) * bgb
            fgd = t['a'] * fg + (1 - t['a']) * bgd
        else:
            fgb = fgd = fg
        ratio = min((max(fgb, bgb) + 0.05) / (min(fgb, bgb) + 0.05), (max(fgd, bgd) + 0.05) / (min(fgd, bgd) + 0.05))
        large = t['px'] >= 24 or (t['bold'] and t['px'] >= 18.66)
        need = 3.0 if large else 4.5
        rows.append(dict(t, ratio=round(ratio, 2), need=need, label=label, rects=None))
    return rows


def main():
    shutil.rmtree(DATA, ignore_errors=True)
    os.makedirs(DATA, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], cwd=REPO, env=dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA),
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    errors, missing, all_rows, notes = [], [], [], []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=['--no-sandbox'])
            for kind, vp, dpr in (('phone', {'width': 412, 'height': 915}, 2), ('desktop', {'width': 1440, 'height': 900}, 1)):
                ctx = browser.new_context(viewport=vp, device_scale_factor=dpr, is_mobile=(kind == 'phone'), has_touch=(kind == 'phone'), service_workers='block')
                page = ctx.new_page()
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.on('response', lambda r: missing.append(r.url) if r.status >= 400 and ('/assets/' in r.url or r.url.endswith('.css')) else None)
                page.goto(BASE, wait_until='load')
                page.wait_for_function("!!window.__cozy && !!window.__cozy.chat", timeout=30000)
                # the hearth first: a connection, no tale
                page.evaluate("""async () => { const { db } = await import('/js/store.js');
                  const conn = await db.connections.add({ label: 'The house choice', type: 'openai', baseUrl: 'https://x.example/v1', apiKey: 'k', model: 'deepseek-chat' });
                  await db.settings.set('activeConnectionId', conn.id); await db.settings.set('welcomeSeen', true); await db.settings.set('theme', 'academy'); }""")
                page.reload(wait_until='load')
                page.wait_for_function("!!window.__cozy && !!window.__cozy.chat", timeout=30000)
                page.wait_for_function("document.documentElement.dataset.theme === 'academy' && !!document.querySelector('#thread > .hearth')", timeout=15000)
                page.evaluate("document.fonts.ready")
                page.wait_for_timeout(1500)
                # the map is drawn behind the room, and the type is the coat's own
                drawn = page.evaluate("""() => { const s = [...document.querySelectorAll('.academy-stage')].find((e) => getComputedStyle(e).display !== 'none');
                  if (!s) return null; const r = s.getBoundingClientRect(); const bg = getComputedStyle(s).backgroundImage;
                  return { w: r.width, h: r.height, bg, covers: r.left <= 0.5 && r.top <= 0.5 && r.right >= innerWidth - 0.5 && r.bottom >= innerHeight - 0.5,
                           fonts: [...document.fonts].filter((f) => f.family.includes('Academy') && f.status === 'loaded').map((f) => f.family + ' ' + f.style) } }""")
                if not drawn or 'map-' not in (drawn['bg'] or '') or not drawn['covers']:
                    errors.append('%s: the map is not laid over the whole screen: %r' % (kind, drawn))
                notes.append('%s: map %s, %dx%d, covers the screen: %s; fonts loaded: %s' % (kind, drawn['bg'].split('/')[-1].rstrip('")'), drawn['w'], drawn['h'], drawn['covers'], ', '.join(sorted(set(drawn['fonts'])))))
                for fam in ('Academy Caslon normal', 'Academy Fell normal'):
                    if fam not in drawn['fonts']:
                        errors.append('%s: %s never loaded' % (kind, fam))
                texts = page.evaluate(TEXTS, '#thread, .composer-zone')
                shown, bare = grab(page, dpr)
                Image.fromarray(bare[0].astype(np.uint8)).save(os.path.join(OUT, '%s-hearth-bare.png' % kind))
                all_rows += judge(texts, shown, bare, dpr, kind + ' welcome')

                # the story
                page.evaluate(SEED.replace("await db.settings.set('welcomeSeen', true);", "await db.settings.set('welcomeSeen', true); await db.settings.set('theme', 'academy');"))
                page.wait_for_timeout(1200)
                page.evaluate("() => { const w = document.querySelector('.welcome-overlay'); if (w) w.hidden = true; }")
                for pos in ('bottom', 'middle', 'top'):
                    page.evaluate("(p) => { const t = document.getElementById('thread'); t.scrollTop = p === 'bottom' ? t.scrollHeight : p === 'top' ? 0 : t.scrollHeight / 2; }", pos)
                    page.wait_for_timeout(400)
                    texts = page.evaluate(TEXTS, '#thread, .composer-zone')
                    shown, bare = grab(page, dpr)
                    if pos == 'bottom':
                        Image.fromarray(bare[0].astype(np.uint8)).save(os.path.join(OUT, '%s-story-bare.png' % kind))
                    all_rows += judge(texts, shown, bare, dpr, '%s story (%s)' % (kind, pos))

                # Settings' own words over its veiled map
                page.evaluate("() => { location.hash = '#/settings'; }")
                page.wait_for_timeout(1000)
                texts = page.evaluate(TEXTS, '.settings-column > :not(.settings-section)')
                shown, bare = grab(page, dpr)
                all_rows += judge(texts, shown, bare, dpr, kind + ' settings')
                page.evaluate("() => { location.hash = '#/'; }")
                ctx.close()
            browser.close()
    finally:
        srv.terminate()

    for n in notes:
        print(n)
    bad = [r for r in all_rows if r['ratio'] < r['need']]
    worst = sorted(all_rows, key=lambda r: r['ratio'] / r['need'])[:8]
    print('lines measured: %d' % len(all_rows))
    print('the eight closest to the line:')
    for r in worst:
        print('   %5.2f:1 (needs %.1f)  [%s] %-30s %2dpx  "%s"' % (r['ratio'], r['need'], r['label'], r['where'][:30], r['px'], r['words']))
    if missing:
        print('FAILED to load:', sorted(set(missing))[:6])
    if errors:
        print('FAILED:', errors[:5])
    if bad:
        print('FAILED: %d lines under AA' % len(bad))
        for r in sorted(bad, key=lambda r: r['ratio'])[:12]:
            print('   %5.2f:1 (needs %.1f)  [%s] %s "%s"' % (r['ratio'], r['need'], r['label'], r['where'], r['words']))
    ok = not bad and not missing and not errors
    print('every line of the academy reads at AA on its own pixels' if ok else '')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
