#!/usr/bin/env python3
"""Active folding/orientation without reload, and final welcome composition."""
import ast,functools,threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=Path('/tmp/cozy-neon-redesign');OUT.mkdir(exist_ok=True)
SEED=next(n.value.value for n in ast.parse((ROOT/'tests/paint_coats.py').read_text()).body if isinstance(n,ast.Assign) and getattr(n.targets[0],'id','')=='SEED')
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
s=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)));threading.Thread(target=s.serve_forever,daemon=True).start()
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(args=['--no-sandbox']);c=b.new_context(service_workers='block');p=c.new_page();p.route('https://**/*',lambda r:r.abort());p.goto(f'http://127.0.0.1:{s.server_port}/');p.wait_for_function('!!window.__cozy?.chat')
  if p.locator('#welcome-overlay').is_visible():p.locator('#btn-welcome-enough').click()
  sid=p.evaluate(SEED)
  p.locator('#btn-settings').click();p.locator('#settings-quicknav').get_by_role('button',name='The house',exact=True).click();p.locator('input[name="theme"][value="neon-tokyo-night"]').check();p.evaluate("location.hash='#/'");p.wait_for_function("!document.querySelector('#view-chat').hidden")
  p.locator('#composer-input').fill('Unsent words survive folding.');p.evaluate('window.__foldMarker=42')
  for w,h in [(390,844),(600,900),(760,960),(950,760),(1440,900),(844,390),(320,740),(390,430)]:
   p.set_viewport_size({'width':w,'height':h});p.wait_for_timeout(120)
   assert p.evaluate('window.__foldMarker')==42
   assert p.locator('#composer-input').input_value()=='Unsent words survive folding.'
   assert p.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
   assert p.evaluate("document.querySelector('#composer-input').getBoundingClientRect().bottom<=innerHeight")
   room=p.locator('.thread-wrap').bounding_box()
   assert p.locator('.neon-rias').is_visible()==(room['width']>=600)
   if room['width']>=600:assert p.evaluate("()=>{const r=document.querySelector('.thread').getBoundingClientRect();return [...document.querySelectorAll('.msg')].every(m=>{const b=m.getBoundingClientRect();return Math.abs((b.left+b.right)-(r.left+r.right))<2})}")
   if w in [760,1440]:p.screenshot(path=str(OUT/f'centered-story-{w}.png'))
   if room['width']>=600:assert p.evaluate("()=>{const a=document.querySelector('.neon-rias').getBoundingClientRect(),r=document.querySelector('.neon-room').getBoundingClientRect();return Math.abs(a.left-r.left)<1&&Math.abs(a.bottom-r.bottom)<1}")
   if w==320:assert p.locator('.brand').is_visible()
  p.locator('#composer-input').fill('')
  p.evaluate('async()=>{window.__cozy.setActiveStoryId(null);await window.__cozy.chat.renderThread({structural:true,opening:true})}')
  for label,w,h in [('phone',390,844),('narrow',320,740),('unfolded',760,960),('desktop',1440,900)]:
   p.set_viewport_size({'width':w,'height':h});p.wait_for_timeout(100);p.screenshot(path=str(OUT/f'{label}-welcome.png'))
   assert p.locator('.hearth').is_visible()
  print('PASS live folding 390/600/760/950/844 landscape/320/short keyboard: no reload, draft retained, composer visible, no overflow, centered prose above artwork; final welcomes captured.')
  b.close()
finally:s.shutdown()
