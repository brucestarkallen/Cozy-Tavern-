#!/usr/bin/env python3
"""M468-2: the page mark, measured in a real Chromium on a phone screen.

A tale of forty pages, the last one short. Scrolled to the end, the mark must say the LAST page (it said 154 of 155
on the writer's tale — a reading line fixed at 45% of the screen never reached a short last page). Scrolled to the
top, the first page drawn. Dragged to the foot and back, both ends again. Exits 1 on any miss.

M675 — his: "the page number on scroll … it's making my eyes hurt when reading because it's hidden some words on it".
NOTHING IS PAINTED ON A WORD OF THE STORY: at forty scroll positions down the tale, with the top bar shown and with it
hidden, no painted part of the page mark, of the small "show the top bar" button or of the "latest page" pill lies on
any word in the thread (on the build before this one the page mark alone painted over words at 40 of 40). The number
stands in the line under the composer and follows the scroll; beside the thumb it shows only while it is dragged."""
import os, shutil, subprocess, sys, time
from playwright.sync_api import sync_playwright

REPO = os.environ.get('COZY_TEST_REPO') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = '/tmp/cozydata-pagemark'
PORT = os.environ.get('COZY_TEST_PORT', '8098')
BASE = 'http://127.0.0.1:%s/' % PORT
shutil.rmtree(DATA, ignore_errors=True)
os.makedirs(DATA, exist_ok=True)
env = dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA)
srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], cwd=REPO, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)

SEED = """async () => {
  const { db } = await import('/js/store.js');
  const st = await db.stories.create({ title: 'a numbered tale' });
  const long = 'The rain kept on against the shutters, and nobody said the thing they meant. '.repeat(14);
  for (let i = 1; i <= 40; i += 1) {
    await db.messages.append(st.id, { role: 'user', text: 'Turn ' + i + '. I look at the door and wait for somebody to speak first, as always.' });
    await db.messages.append(st.id, { role: 'assistant', text: '[The Lantern — Monday | 21:' + String(i).padStart(2, '0') + ' | rain | a coat | by the door]\\n\\n' + (i === 40 ? 'The last page is one short line.' : long) });
  }
  await db.settings.set('welcomeSeen', true);
  await db.settings.set('turnsShown', 100);
  window.__cozy.setActiveStoryId(st.id);
  await window.__cozy.chat.renderThread({ structural: true, opening: true });
  return st.id;
}"""
# M675: every painted box of the three things that used to float over the story, and every word of the story under one
PAINTED_OVER = """() => {
  const thread = document.getElementById('thread');
  const alpha = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c || ''); if (!m) return 0; const p = m[1].split(',').map((x) => parseFloat(x)); return p.length > 3 ? p[3] : 1; };
  const paints = (el) => { const cs = getComputedStyle(el); return alpha(cs.backgroundColor) > 0.05 || (parseFloat(cs.borderTopWidth) > 0 && alpha(cs.borderTopColor) > 0.05) || cs.backgroundImage !== 'none'; };
  const visible = (el) => { for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); if (n.hidden || cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false; } return true; };
  const painted = [];
  for (const root of [document.getElementById('page-mark'), document.getElementById('btn-immerse-show'), document.getElementById('btn-jump')]) {
    if (!root || !visible(root)) continue;
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (!visible(el) || !paints(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.height) painted.push({ id: root.id, x: r.left, y: r.top, r: r.right, b: r.bottom });
    }
  }
  const out = { painted: painted.map((b) => b.id), covered: [] };
  if (!painted.length) return out;
  const tb = thread.getBoundingClientRect();
  const walker = document.createTreeWalker(thread, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let node;
  while ((node = walker.nextNode())) {
    const el = node.parentElement;
    if (!el) continue;
    const pr = el.getBoundingClientRect();
    if (pr.bottom < tb.top || pr.top > tb.bottom || !pr.width) continue;
    const re = /\\S+/g; let m;
    while ((m = re.exec(node.nodeValue))) {
      range.setStart(node, m.index); range.setEnd(node, m.index + m[0].length);
      for (const r of range.getClientRects()) {
        if (r.bottom <= tb.top || r.top >= tb.bottom) continue;
        /* what shows of the word is what lies inside the thread's own box — the rest is scrolled out of sight */
        const top = Math.max(r.top, tb.top); const bottom = Math.min(r.bottom, tb.bottom);
        const hit = painted.find((b) => Math.min(r.right, b.r) - Math.max(r.left, b.x) > 0.5 && Math.min(bottom, b.b) - Math.max(top, b.y) > 0.5);
        if (hit) { out.covered.push(hit.id + ' on “' + m[0] + '”'); break; }
      }
    }
  }
  return out;
}"""
def sweep(page, what, steps=40):
    seen = {}; covered = []; at = 0
    for i in range(steps):
        page.evaluate("(f) => { const t = document.getElementById('thread'); t.scrollTop = (t.scrollHeight - t.clientHeight) * f; }", (i + 0.37) / steps)
        page.wait_for_timeout(70)
        m = page.evaluate(PAINTED_OVER)
        for k in set(m['painted']): seen[k] = seen.get(k, 0) + 1
        if m['covered']: at += 1; covered += m['covered']
    print('  %-42s painted at: %s; words painted over at %d of %d positions' % (what, ', '.join('%s %d' % kv for kv in sorted(seen.items())) or 'nothing', at, steps))
    return seen, at, covered
fails = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 412, 'height': 915}, device_scale_factor=2, is_mobile=True, has_touch=True, service_workers='block')
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(BASE, wait_until='load')
        page.wait_for_function("!!window.__cozy && !!window.__cozy.chat", timeout=30000)
        page.wait_for_timeout(1200)
        page.evaluate(SEED)
        page.wait_for_timeout(800)
        page.evaluate("() => { const w = document.getElementById('welcome-overlay'); if (w) { w.classList.remove('open'); w.hidden = true; } }")
        mark = lambda: page.evaluate("() => { const m = document.getElementById('page-mark'); return m ? m.textContent : ''; }")
        under = lambda: page.evaluate("() => window.__cozy && window.__cozy.pageMark ? window.__cozy.pageMark.pageUnderEye() : null")
        def check(what, want):
            got = under()
            print('  %-42s %s (mark: %s)' % (what, got, mark()))
            if got != want: fails.append('%s: got %s, wanted %s' % (what, got, want))
        pages = page.evaluate("() => document.getElementById('thread').dataset.pages")
        if pages != '40': fails.append('forty pages numbered, got ' + str(pages))
        page.evaluate("() => { const t = document.getElementById('thread'); t.scrollTop = t.scrollHeight; }")
        page.wait_for_timeout(250)
        check('at the end (opened there)', 40)
        page.evaluate("() => { const t = document.getElementById('thread'); t.scrollTop = 0; }")
        page.wait_for_timeout(250)
        check('at the top', 1)
        page.evaluate("() => { const t = document.getElementById('thread'); t.scrollTop = (t.scrollHeight - t.clientHeight) / 2; }")
        page.wait_for_timeout(250)
        mid = under()
        print('  %-42s %s' % ('halfway', mid))
        if not (10 <= (mid or 0) <= 30): fails.append('halfway named page %s' % mid)
        # the drag: to the foot, then back to the head
        page.evaluate("() => { const t = document.getElementById('thread'); t.scrollTop = 200; }")
        page.wait_for_timeout(250)
        box = page.evaluate("() => { const m = document.getElementById('page-mark'); const r = m.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }")
        tb = page.evaluate("() => { const r = document.getElementById('thread').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }")
        page.mouse.move(box['x'], box['y']); page.mouse.down(); page.mouse.move(box['x'], tb['bottom'] - 2, steps=8); page.mouse.up()
        page.wait_for_timeout(250)
        check('dragged to the foot', 40)
        box = page.evaluate("() => { const m = document.getElementById('page-mark'); const r = m.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }")
        page.mouse.move(box['x'], box['y']); page.mouse.down(); page.mouse.move(box['x'], tb['top'] + 2, steps=8); page.mouse.up()
        page.wait_for_timeout(250)
        check('dragged to the head', 1)
        # ---------- M675: nothing is painted on a word ----------
        seen, at, covered = sweep(page, 'the top bar shown, forty positions')
        if seen.get('page-mark', 0) < 35: fails.append('the thumb was painted at only %d of 40 positions — the sweep saw nothing to judge' % seen.get('page-mark', 0))
        if seen.get('btn-jump', 0) < 30: fails.append('the latest-page pill was painted at only %d of 40 positions' % seen.get('btn-jump', 0))
        if at: fails.append('words painted over at %d of 40 positions (bar shown): %s' % (at, '; '.join(covered[:4])))
        # the number stands under the composer, and follows the scroll
        for frac in (0.0, 0.5, 1.0):
            page.evaluate("(f) => { const t = document.getElementById('thread'); t.scrollTop = (t.scrollHeight - t.clientHeight) * f; }", frac)
            page.wait_for_timeout(200)
            label = page.evaluate("() => { const l = document.getElementById('meta-page'); return l && !l.hidden && getComputedStyle(l).display !== 'none' ? l.textContent : null; }")
            want = 'page %s of 40' % under()
            print('  %-42s %s' % ('the line under the composer at %d%%' % (frac * 100), label))
            if label != want: fails.append('under the composer at %d%%: “%s”, wanted “%s”' % (frac * 100, label, want))
        geo = page.evaluate("() => { const l = document.getElementById('meta-page').getBoundingClientRect(); const t = document.getElementById('thread').getBoundingClientRect(); return { labelTop: l.top, threadBottom: t.bottom }; }")
        if not geo['labelTop'] >= geo['threadBottom']: fails.append('the number is not below the story: %s' % geo)
        # beside the thumb the number shows only while it is dragged
        page.evaluate("() => { const t = document.getElementById('thread'); t.scrollTop = 400; }")
        page.wait_for_timeout(250)
        bubble = lambda: page.evaluate("() => { const w = document.querySelector('#page-mark .page-mark-words'); return w && getComputedStyle(w).display !== 'none' ? w.textContent : null; }")
        if bubble() is not None: fails.append('the number shows beside the thumb while he only scrolls: %s' % bubble())
        box = page.evaluate("() => { const m = document.getElementById('page-mark'); const r = m.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }")
        page.mouse.move(box['x'], box['y']); page.mouse.down(); page.mouse.move(box['x'], box['y'] + 60, steps=4)
        page.wait_for_timeout(150)
        held = bubble()
        print('  %-42s %s' % ('beside the thumb, while dragged', held))
        if held != 'page %s of 40' % under(): fails.append('while dragged the thumb says “%s”, wanted “page %s of 40”' % (held, under()))
        page.mouse.up()
        page.wait_for_timeout(150)
        if bubble() is not None: fails.append('the number stayed beside the thumb after the drag')
        # the "latest page" pill stands on nothing: below the story, above the box he types in
        page.evaluate("() => { const t = document.getElementById('thread'); t.scrollTop = 300; }")
        page.wait_for_timeout(250)
        pill = page.evaluate("() => { const j = document.getElementById('btn-jump'); if (!j || j.hidden) return null; const a = j.getBoundingClientRect(), t = document.getElementById('thread').getBoundingClientRect(), c = document.getElementById('composer').getBoundingClientRect(); return { top: a.top, bottom: a.bottom, threadBottom: t.bottom, composerTop: c.top }; }")
        print('  %-42s %s' % ('the latest-page pill', pill))
        if not pill: fails.append('the latest-page pill does not show above the tail')
        elif not (pill['top'] >= pill['threadBottom'] and pill['bottom'] <= pill['composerTop']): fails.append('the latest-page pill stands on the story or on the composer: %s' % pill)
        else:
            page.click('#btn-jump')
            page.wait_for_timeout(400)
            end = page.evaluate("() => { const t = document.getElementById('thread'); return { gap: t.scrollHeight - t.scrollTop - t.clientHeight, hidden: document.getElementById('btn-jump').hidden }; }")
            if not (end['gap'] < 8 and end['hidden']): fails.append('the pill did not bring the latest page (or stayed after): %s' % end)
        # the top bar hidden: the small button and the thumb share the gutter, and neither stands on a word
        page.click('#btn-immerse')
        page.wait_for_timeout(300)
        seen, at, covered = sweep(page, 'the top bar hidden, forty positions')
        if seen.get('btn-immerse-show', 0) < 40: fails.append('the small button was painted at only %d of 40 positions' % seen.get('btn-immerse-show', 0))
        if seen.get('page-mark', 0) < 35: fails.append('the thumb was painted at only %d of 40 positions with the bar hidden' % seen.get('page-mark', 0))
        if at: fails.append('words painted over at %d of 40 positions (bar hidden): %s' % (at, '; '.join(covered[:4])))
        page.evaluate("() => { const t = document.getElementById('thread'); t.scrollTop = 0; }")
        page.wait_for_timeout(250)
        clash = page.evaluate("() => { const tab = document.querySelector('#btn-immerse-show > span').getBoundingClientRect(); const bar = document.querySelector('#page-mark .page-mark-bar').getBoundingClientRect(); return { tabBottom: tab.bottom, barTop: bar.top }; }")
        print('  %-42s %s' % ('at the top, bar hidden: tab and thumb', clash))
        if not clash['barTop'] >= clash['tabBottom']: fails.append('the thumb slides under the small button at the top: %s' % clash)
        # M675: the bar is hidden over the STORY only — in Settings it stands (its own way back to the story is a button in it)
        seen_at = lambda: page.evaluate("() => { const b = document.getElementById('btn-settings').getBoundingClientRect(); const t = document.getElementById('btn-immerse-show'); return { bar: b.width > 0 && b.height > 0, tab: getComputedStyle(t).display !== 'none' }; }")
        page.evaluate("() => { location.hash = '#/settings'; }")
        page.wait_for_timeout(500)
        there = seen_at()
        print('  %-42s %s' % ('Settings opened with the bar hidden', there))
        if not there['bar']: fails.append('in Settings, with the bar hidden over the story, there is no bar — and no way back in it')
        if there['tab']: fails.append('the small "show the top bar" tab stands in Settings beside the bar itself')
        page.click('#btn-settings')
        page.wait_for_timeout(500)
        back = seen_at()
        print('  %-42s %s' % ('back at the story', back))
        if back['bar'] or not back['tab']: fails.append('back at the story the bar is not hidden again as he left it: %s' % back)
        page.click('#btn-immerse-show')
        page.wait_for_timeout(200)
        if page.evaluate("() => document.body.classList.contains('immersed')"): fails.append('the small button did not bring the bar back')
        if errors: fails.append('the page threw: ' + errors[0])
        b.close()
finally:
    srv.terminate()
print()
print('the page mark names the right page at both ends and under a drag, and nothing is painted on a word of the story' if not fails else 'FAILED: ' + ' | '.join(fails))
sys.exit(1 if fails else 0)
