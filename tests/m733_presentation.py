#!/usr/bin/env python3
"""M733: compact Academy footer, upright cutaway prose and quiet Tokyo input focus."""
import ast,functools,threading,os
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=Path('/tmp/cozy-m733');OUT.mkdir(exist_ok=True)
SEED=next(n.value.value for n in ast.parse((ROOT/'tests/paint_coats.py').read_text()).body if isinstance(n,ast.Assign) and getattr(n.targets[0],'id','')=='SEED')
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
s=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)));threading.Thread(target=s.serve_forever,daemon=True).start()
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'),args=['--no-sandbox']);c=b.new_context(service_workers='block');p=c.new_page();p.route('https://**/*',lambda r:r.abort());p.goto(f'http://127.0.0.1:{s.server_port}/');p.wait_for_function('!!window.__cozy?.chat')
  if p.locator('#welcome-overlay').is_visible():p.locator('#btn-welcome-enough').click()
  sid=p.evaluate(SEED)
  p.evaluate(r'''async sid=>{const {db}=await import('/js/store.js');await db.messages.append(sid,{role:'assistant',text:'The room grew quiet.\n\nThe World Beyond\n[The library]\nA lamp burned beside the window. "Stay," she said. *I should go,* he thought.'});await window.__cozy.chat.renderThread({structural:true,opening:true});}''',sid)
  p.evaluate('''()=>{document.querySelector('#quick-switch option').textContent='Synthetic Large Vision model with a long name';document.querySelector('#meta-context').textContent='~53.975 of ~500.000 tokens in the room';}''')
  for theme in ['academy','academy-night']:
   p.evaluate('(t)=>document.documentElement.dataset.theme=t',theme)
   for w,h in [(320,740),(390,844),(696,620),(760,960)]:
    p.set_viewport_size({'width':w,'height':h});p.evaluate('document.fonts.ready')
    p.evaluate("document.querySelector('#thread').scrollTop=1e8")
    p.wait_for_function("document.querySelector('#btn-jump').hidden")
    p.evaluate("document.querySelector('#quick-switch option').textContent='Synthetic Large Vision model with a long name'")
    box=p.locator('.composer-zone').bounding_box()
    assert p.locator('.composer-meta').bounding_box()['height']<34
    assert p.evaluate('''()=>{const m=document.querySelector('.composer-meta').getBoundingClientRect(),q=document.querySelector('.quick-switch').getBoundingClientRect();return Math.abs(q.right-(m.right-18))<2}''')
    p.evaluate("document.querySelector('#thread').scrollTop=100")
    p.wait_for_function("!document.querySelector('#btn-jump').hidden")
    assert abs(box['y']-p.locator('.composer-zone').bounding_box()['y'])<1
    assert p.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
    if w==696:p.screenshot(path=str(OUT/f'{theme}-footer.png'))
  p.evaluate("document.documentElement.dataset.theme='neon-tokyo-night'")
  p.set_viewport_size({'width':390,'height':844})
  p.locator('#composer-input').fill('The lamp is still burning.')
  assert p.locator('#composer-input').evaluate("e=>getComputedStyle(e).outlineStyle")=='none'
  p.wait_for_function("getComputedStyle(document.querySelector('#composer')).borderTopColor==='rgb(221, 143, 231)'")
  p.evaluate("document.querySelector('#thread').scrollTop=1e8")
  summary=p.locator('#thread summary').filter(has_text='The World Beyond').last
  panel=summary.locator('..').locator(':scope > div').last
  assert panel.evaluate("e=>getComputedStyle(e).fontStyle")=='normal'
  assert panel.locator('em').first.evaluate("e=>getComputedStyle(e).fontStyle")=='italic'
  p.screenshot(path=str(OUT/'tokyo-input-world.png'))
  print('PASS compact Academy footer stays right and stable at 320/390/696/760; World Beyond upright with italic thoughts; Tokyo input no outline/cyan focus border.')
  b.close()
finally:s.shutdown()
