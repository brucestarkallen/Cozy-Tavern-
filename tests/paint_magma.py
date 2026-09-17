#!/usr/bin/env python3
"""M301: the magma coat, measured in a real Chromium on a phone-sized screen.

1. The glow is on the screen: the pixels at the foot of the room are red-hot,
   the pixels at its head are teal-black (a coat whose gradient rule missed
   would be flat).
2. Every word that stands OVER the glow holds AA against the pixels actually
   behind it (contrast.py cannot see a gradient — it reads background-color).
3. Scrolling a sixty-page story costs no more than in the deep coat, at 6x CPU
   throttle: the glow is on the column that does not scroll.
Exits 1 when any of the three fails. Shots: /tmp/magma-*.png
"""
import io, os, shutil, subprocess, sys, time
from playwright.sync_api import sync_playwright
from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = '/tmp/cozydata-magma'
PORT = os.environ.get('COZY_TEST_PORT', '8097')
BASE = 'http://127.0.0.1:%s/' % PORT

shutil.rmtree(DATA, ignore_errors=True)
os.makedirs(DATA, exist_ok=True)
env = dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA)
srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], env=env,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)

SEED = """async () => {
  const db = window.__cozy.db;
  const conn = await db.connections.add({ label: 'Test', type: 'openai', baseUrl: 'https://x.example/v1', apiKey: 'k', model: 'm' });
  await db.settings.set('activeConnectionId', conn.id);
  const st = await db.stories.create({ title: 'the magma room' });
  const para = 'The rain kept on against the shutters, and nobody said the thing they meant. "You knew," she said, and did not look up. ';
  for (let i = 0; i < 60; i += 1) {
    await db.messages.append(st.id, { role: 'user', text: 'I wait, and watch the door. (' + i + ')' });
    await db.messages.append(st.id, { role: 'assistant', text: '[The Wayward Lantern — Tuesday, March 4, 2026 | 21:14 | rain | a grey coat | by the door]\\n\\n' + para.repeat(6) + '\\n\\n' + para.repeat(5) });
  }
  window.__cozy.setActiveStoryId(st.id);
  await window.__cozy.chat.renderThread({ structural: true, opening: true });
}"""

SCROLL = """async () => {
  const t = document.getElementById('thread');
  t.scrollTop = t.scrollHeight;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const frames = [];
  let last = performance.now();
  for (let i = 0; i < 90; i += 1) {
    t.scrollTop -= 70;
    await new Promise((r) => requestAnimationFrame(r));
    const now = performance.now();
    frames.push(now - last);
    last = now;
  }
  frames.sort((a, b) => a - b);
  return { median: frames[45], p95: frames[85], worst: frames[89] };
}"""

def lum(rgb):
    def ch(v):
        v /= 255.0
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * ch(rgb[0]) + 0.7152 * ch(rgb[1]) + 0.0722 * ch(rgb[2])

def ratio(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)

fails = []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--no-sandbox'])
        ctx = browser.new_context(viewport={'width': 412, 'height': 915}, is_mobile=True, has_touch=True, device_scale_factor=1)
        page = ctx.new_page()
        cdp = ctx.new_cdp_session(page)
        page.goto(BASE, wait_until='load')
        page.wait_for_function("!!window.__cozy && !!window.__cozy.chat", timeout=25000)
        page.evaluate("async () => { await window.__cozy.db.settings.set('welcomeSeen', true); }")  # a returning writer
        page.reload(wait_until='load')
        page.wait_for_function("!!window.__cozy && !!window.__cozy.chat", timeout=25000)
        page.evaluate(SEED)
        page.wait_for_timeout(600)

        def wear(coat):
            page.evaluate("(c) => document.documentElement.setAttribute('data-theme', c)", coat)
            page.wait_for_timeout(250)

        # 1. the glow
        wear('magma')
        page.evaluate("() => { const t = document.getElementById('thread'); t.scrollTop = t.scrollHeight; }")
        page.wait_for_timeout(300)
        page.screenshot(path='/tmp/magma-story.png')
        # the words hidden, so the pixels read are the room's own
        page.add_style_tag(content=".measure-bare .thread > *, .measure-bare .composer-zone > * { visibility: hidden !important; }")
        page.evaluate("() => document.documentElement.classList.add('measure-bare')")
        page.wait_for_timeout(150)
        bare = Image.open(io.BytesIO(page.screenshot())).convert('RGB')
        page.evaluate("() => document.documentElement.classList.remove('measure-bare')")
        box = page.evaluate("() => { const r = document.querySelector('.thread-wrap').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }")
        head = bare.getpixel((int(box['x'] + box['w'] / 2), int(box['y'] + 12)))
        foot = bare.getpixel((int(box['x'] + box['w'] / 2), int(box['y'] + box['h'] - 3)))
        print('the room: head rgb%s, foot rgb%s' % (head, foot))
        if not (head[2] >= head[0] and max(head) < 40):
            fails.append('the head of the room is not teal-black: %s' % (head,))
        if not (foot[0] > foot[2] + 40 and foot[0] > foot[1] + 30):
            fails.append('the foot of the room does not glow red: %s' % (foot,))

        # 2. every word over the glow, against the pixels behind it
        words = page.evaluate("""() => {
          const out = [];
          const seen = new Set();
          for (const el of document.querySelectorAll('.thread-wrap *')) {
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[hidden]')) continue;
            if (![...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim())) continue;
            // a word with an opaque box of its own somewhere under it is contrast.py's to judge
            let n = el, boxed = false;
            while (n && !n.classList.contains('thread-wrap')) {
              const bg = getComputedStyle(n).backgroundColor.match(/rgba?\\((\\d+), (\\d+), (\\d+)(?:, ([\\d.]+))?/);
              if (bg && (bg[4] === undefined || parseFloat(bg[4]) > 0.95)) { boxed = true; break; }
              n = n.parentElement;
            }
            if (boxed) continue;
            const r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight) continue;
            const c = cs.color.match(/rgba?\\((\\d+), (\\d+), (\\d+)/);
            if (!c) continue;
            const px = parseFloat(cs.fontSize) || 16;
            const bold = (parseInt(cs.fontWeight, 10) || 400) >= 700;
            const key = el.className + cs.color + Math.round(r.top / 40);
            if (seen.has(key)) continue; seen.add(key);
            out.push({ where: el.tagName.toLowerCase() + '.' + String(el.className || '').split(' ')[0], x: r.left + Math.min(r.width, 40) / 2, top: r.top, bottom: r.bottom,
                       fg: [+c[1], +c[2], +c[3]], need: (px >= 24 || (bold && px >= 18.66)) ? 3 : 4.5, px: Math.round(px), text: el.textContent.trim().slice(0, 30) });
          }
          return out;
        }""")
        worst = None
        for w in words:
            ys = [int(max(0, min(bare.height - 1, y))) for y in (w['top'] + 1, (w['top'] + w['bottom']) / 2, w['bottom'] - 1)]
            x = int(max(0, min(bare.width - 1, w['x'])))
            r = min(ratio(w['fg'], bare.getpixel((x, y))) for y in ys)
            if worst is None or r < worst[0]:
                worst = (r, w)
            if r < w['need']:
                fails.append('%.1f:1 (needs %.1f) %s %dpx "%s"' % (r, w['need'], w['where'], w['px'], w['text']))
        print('words standing on the glow: %d measured; the lowest is %.1f:1 — %s "%s"' % (len(words), worst[0], worst[1]['where'], worst[1]['text']))

        # Settings and the ledger in the same coat, for the eye
        page.evaluate("() => { location.hash = '#/settings'; }")
        page.wait_for_timeout(900)
        page.screenshot(path='/tmp/magma-settings.png')
        page.evaluate("() => { location.hash = '#/'; }")
        page.wait_for_timeout(500)

        # 3. the scroll, against the deep coat
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': 6})
        got = {}
        for coat in ('deep', 'magma', 'deep', 'magma'):
            wear(coat)
            m = page.evaluate(SCROLL)
            got.setdefault(coat, []).append(m)
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': 1})
        best = {c: min(v, key=lambda m: m['median']) for c, v in got.items()}
        for c in ('deep', 'magma'):
            print('scrolling sixty pages at 6x throttle, %-5s: median %.1f ms, p95 %.1f ms, worst %.1f ms' % (c, best[c]['median'], best[c]['p95'], best[c]['worst']))
        if best['magma']['median'] > best['deep']['median'] * 1.25 + 2:
            fails.append('the magma room scrolls slower than the deep: %.1f ms against %.1f ms' % (best['magma']['median'], best['deep']['median']))
        browser.close()
finally:
    srv.terminate()

print()
print('the magma room: glowing, readable over its glow, and no slower to scroll' if not fails else 'FAILED:\n  ' + '\n  '.join(fails))
sys.exit(1 if fails else 0)
