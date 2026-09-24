#!/usr/bin/env python3
"""M465: every coat, on a LEDGER WITH A STORY IN IT, in a real Chromium on a phone screen.

contrast.py measures the empty house; this one seeds a tale the shape of the writer's — people here and
elsewhere, standings, hurts, locked truths, the world's word, a ruling, findings, a mended page, a
record of changes — and measures every text surface of the story room and of all four rooms of the
ledger, in every coat, against the pixels' own backgrounds (an ink over a translucent wash is judged on
the first solid ground beneath it, as contrast.py does). It also photographs each room to
/tmp/coats/<coat>-<room>.png for the eye. Exits 1 when any surface is under AA (4.5:1 body, 3:1 large)
or the page throws.

  python3 tests/paint_coats.py            # every coat
  python3 tests/paint_coats.py academy    # one
"""
import os, shutil, subprocess, sys, time
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = '/tmp/cozydata-coats'
PORT = os.environ.get('COZY_TEST_PORT', '8099')
BASE = 'http://127.0.0.1:%s/' % PORT
OUT = '/tmp/coats'
COATS = sys.argv[1:] or ['dark', 'light', 'deep', 'magma', 'fantasy', 'cyberpunk', 'academy', 'aurora', 'starship']

shutil.rmtree(DATA, ignore_errors=True)
os.makedirs(DATA, exist_ok=True)
os.makedirs(OUT, exist_ok=True)
env = dict(os.environ, PORT=PORT, COZY_DATA_DIR=DATA)
srv = subprocess.Popen([sys.executable, os.path.join(REPO, 'serve.py')], cwd=REPO, env=env,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)

SEED = """
async () => {
  const { db } = await import('/js/store.js');
  const { saveState, emptyState } = await import('/js/engine/state.js');
  const conn = await db.connections.add({ label: 'The house choice', type: 'openai', baseUrl: 'https://x.example/v1', apiKey: 'k', model: 'deepseek-chat' });
  await db.settings.set('activeConnectionId', conn.id);
  const names = ['Rias Gremory', 'Aurora Vale', 'Claire Moreau', 'Kaelen Stahl', 'Rukia Kuchiki', 'Byakuya Kuchiki', 'Renji Abarai', 'Mara Quist', 'Old Pell', 'Sister Nives', 'Ivo the ferryman', 'Tamsin Lund'];
  const story = await db.stories.create({ title: 'The Wayward Lantern' });
  await db.stories.update(story.id, { brief: 'Jovan comes home for one last summer. Rias, Aurora and Claire live in town; Kaelen is the rival.', castNotes: 'Rias — heir of her house.' });
  const header = (h) => '[The Wayward Lantern — Tuesday, March 4, 2026 | ' + h + ' | rain | a grey coat | by the door]\\n\\n';
  const para = 'The rain kept on against the shutters, and nobody said the thing they meant. "You knew," Rias said, and did not look up. *He is lying,* Aurora thought, and turned her glass.\\n\\n"Then say it," Claire said. "Say it once, plainly, and we can all go home."';
  for (let i = 0; i < 14; i += 1) {
    await db.messages.append(story.id, { role: 'user', text: 'I set the cup down and look at the door. "Anyone coming?" I ask. (' + i + ')' });
    const m = await db.messages.append(story.id, { role: 'assistant', text: header((19 + Math.floor(i / 4)) + ':' + String((i * 7) % 60).padStart(2, '0')) + para + '\\n\\n' + para });
    if (i === 12) await db.messages.update(story.id, m.id, { findings: [{ words: 'Rias speaks of the ferry as if it left at dusk; the ledger has it leaving at dawn.', severity: 'warn' }, { words: 'Aurora is written with a violin case she left at home on page 9.', severity: 'note' }], mended: { before: 'old words', why: 'the ferry leaves at dawn, as the record says' } });
  }
  const st = emptyState();
  st.sheet = { actors: { 'Kaelen Stahl': { ratings: { strength: 7, wit: 4 }, domains: ['blades'], conditions: ['a bruised forearm'] } }, playerName: 'Jovan' };
  st.clock = { calendar: 'gregorian', minutes: 29610914, label: '' };
  st.place = { name: 'The Wayward Lantern' };
  st.present = [{ name: 'Jovan', position: 'by the door', attire: 'a grey coat' }, { name: 'Rias Gremory', position: 'at the bar, turning her glass' }, { name: 'Aurora Vale', position: 'by the window' }, { name: 'Claire Moreau' }];
  st.mode = { combat: false, intimate: false, travel: false, socialField: true, isolation: false, group: true };
  st.page = 13; st.readTo = 13; st.tidiedGen = 999; st.turn = 40;
  names.forEach((n, i) => {
    st.characters[n] = { core: 'Someone of the town; steady, watchful, slow to trust.', state: 'weighing whether to tell Jovan about the letter tonight', arc: i % 3 ? 'warmed to Jovan after the fair; still wary of his leaving' : '', threads: i % 4 ? ['owes the ferryman a favour', 'means to ask about the letter'] : [], updatedAtTurn: 13 - (i % 5), firstSeenTurn: i, ...(i >= 10 ? { retired: true } : {}) };
    if (i >= 4 && i < 10) st.offscreen[n] = { location: i % 2 ? 'the market square' : 'the harbour steps', activity: i % 2 ? 'closing the stall for the night' : 'waiting on the last ferry', agenda: i % 3 ? 'catch Jovan before he leaves' : undefined, stance: ['toward', 'seeking', 'tense', 'busy', 'waiting'][i % 5], sinceMinutes: 29610900 - i * 11, atTurn: 13 - i };
    if (i < 6) st.relationships[n] = { p: (i * 13) % 60 - 20, r: i * 4, s: 0, history: [{ atMinutes: 29610000, axis: 'p', delta: 2, cause: 'the page showed warmth' }] };
    if (i < 5) st.knowledge[n] = [{ fact: 'saw Jovan at the harbour speaking with ' + names[(i + 1) % names.length], atTurn: 3 }];
    if (i < 4) st.canon[n] = { facts: [{ key: 'kin', value: 'a cousin of ' + names[(i + 1) % names.length], atMinutes: 1 }] };
  });
  st.bodies = { 'Kaelen Stahl': { injuries: [{ what: 'left forearm bruised to the bone', sev: 2, atMinutes: 29610800, treated: false, healed: false }], strain: [{ what: 'two nights without sleep', atMinutes: 29610700 }] } };
  st.threads = [{ title: 'Rias and the letter', owner: 'Rias Gremory', heat: 'hot', next: 'wait for the fair, then speak', atTurn: 2 }, { title: 'Ivo and the ferry', owner: 'Ivo the ferryman', heat: 'cold', next: 'the last crossing at dawn', atTurn: 5 }];
  st.worldBrief = { pressure: 'The last ferry leaves at dawn and half the town means to be on it.', ripe: 'Kaelen has found the letter and is walking it to the Lantern.', twb: 'Elsewhere the fair is closing.', atTurn: 13 };
  st.worldShown = [{ who: 'Kaelen Stahl', where: 'the harbour steps', changed: 'read the letter twice', atTurn: 12 }];
  st.lastVerdict = { words: 'Kaelen lands the blow, but slips on the wet boards — a real wound.', at: Date.now() };
  st.audit = { at: Date.now(), turn: 13, issues: [{ what: "Rias's seat said the market; the page has her at the bar.", fix: 'moved her seat to the Lantern', fixable: true, landed: true }] };
  st.log = Array.from({ length: 8 }, (_, i) => ({ ts: Date.now() - i * 60000, words: names[i] + ' — now ' + ['by the stove', 'at the bar', 'gone to the harbour', 'warmer toward Jovan (+2): the page showed it'][i % 4] + '.', undone: i === 3, jid: 100 - i }));
  st.journal = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, p: Math.floor(i / 3), m: { type: 'presence.update', name: names[i % names.length], position: 'by the stove' } }));
  st.journalSeq = 20;
  await saveState(story.id, st);
  await db.settings.set('activeStoryId', story.id);
  await db.settings.set('welcomeSeen', true);
  window.__cozy.setActiveStoryId(story.id);
  await window.__cozy.chat.renderThread({ structural: true, opening: true });
  return story.id;
}
"""

# the same probe as contrast.py, word for word 
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
errors = []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--no-sandbox'])
        ctx = browser.new_context(viewport={'width': 412, 'height': 915}, device_scale_factor=2, is_mobile=True, has_touch=True, service_workers='block')
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(BASE, wait_until='load')
        page.wait_for_function("!!window.__cozy && !!window.__cozy.chat", timeout=30000)
        page.wait_for_timeout(1200)
        page.evaluate(SEED)
        page.wait_for_timeout(1200)
        page.evaluate("() => { const w = document.querySelector('.welcome-overlay'); if (w) w.hidden = true; }")
        for coat in COATS:
            page.evaluate("(c) => document.documentElement.setAttribute('data-theme', c)", coat)
            page.wait_for_timeout(300)
            rows = []
            page.evaluate("() => { const t = document.getElementById('thread'); if (t) t.scrollTop = t.scrollHeight; }")
            page.wait_for_timeout(200)
            page.screenshot(path=os.path.join(OUT, '%s-story.png' % coat))
            rows += [dict(r, room='story') for r in page.evaluate(PROBE)]
            page.click('#btn-ledger')
            page.wait_for_function("() => { const d = document.getElementById('drawer'); return d && !d.hidden && d.classList.contains('open'); }", timeout=10000)
            page.wait_for_timeout(500)
            for room in ('scene', 'people', 'world', 'books'):
                page.click('#drawer-panels .nav-chip[data-room="%s"]' % room)
                page.wait_for_timeout(600)
                page.screenshot(path=os.path.join(OUT, '%s-%s.png' % (coat, room)))
                rows += [dict(r, room=room) for r in page.evaluate(PROBE) if True]
            page.click('#btn-drawer-close')
            page.wait_for_timeout(350)
            # the ledger's own surfaces only: the story room's are measured above, and every room's probe sees the whole page
            uniq = {}
            for r in rows:
                uniq[r['room'] + r['where'] + str(r['ratio'])] = r
            bad = sorted(uniq.values(), key=lambda r: r['ratio'])
            print('%-9s %d surfaces under AA' % (coat, len(bad)))
            for r in bad[:12]:
                print('   %5.1f:1 (needs %.1f)  [%s] %-40s %2dpx  "%s"' % (r['ratio'], r['need'], r['room'], r['where'], r['px'], r['words']))
            if bad:
                fails[coat] = bad
        browser.close()
finally:
    srv.terminate()

print()
if errors:
    print('the page threw:', errors[:3])
print('every text surface of the seeded ledger meets AA in every coat' if not fails and not errors
      else 'FAILED: ' + ', '.join('%s %d' % (k, len(v)) for k, v in fails.items()))
sys.exit(1 if fails or errors else 0)
