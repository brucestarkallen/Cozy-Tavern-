#!/usr/bin/env python3
"""Focused theme browser check. Optional argument: clean baseline checkout.
Uses isolated local fixture data and blocks external requests. No provider calls.
"""
import ast, functools,json,threading,sys
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=Path('/tmp/cozy-neon-redesign');OUT.mkdir(exist_ok=True)
SEED=next(n.value.value for n in ast.parse((ROOT/'tests/paint_coats.py').read_text()).body if isinstance(n,ast.Assign) and getattr(n.targets[0],'id','')=='SEED')
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
servers=[]
def serve(root):
 s=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(root)));threading.Thread(target=s.serve_forever,daemon=True).start();servers.append(s);return f'http://127.0.0.1:{s.server_port}/'
def ready(p):p.wait_for_function('!!window.__cozy?.chat && !!document.documentElement.dataset.version')
def pick(p,coat):
 p.locator('#btn-settings').click();p.locator('#settings-quicknav').get_by_role('button',name='The house',exact=True).click();p.locator(f'input[name="theme"][value="{coat}"]').check();p.wait_for_function('(c)=>document.documentElement.dataset.theme===c',arg=coat)
def chat(p):p.evaluate("location.hash='#/'");p.wait_for_function("!document.querySelector('#view-chat').hidden")
def styles(p):return p.evaluate('''()=>Object.fromEntries(['body','.topbar','.thread-wrap','#thread','.composer-zone','#composer','.send-btn','.msg-user .msg-body','#drawer'].map(s=>{const c=getComputedStyle(document.querySelector(s));return [s,Object.fromEntries([...c].map(k=>[k,c.getPropertyValue(k)]))]}))''')
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(args=['--no-sandbox']);baseline=None
  for name,root in ([('baseline',Path(sys.argv[1])),('new',ROOT)] if len(sys.argv)>1 else []):
   url=serve(root);c=b.new_context(viewport={'width':1440,'height':900},service_workers='block');p=c.new_page();p.route('https://**/*',lambda r:r.abort());p.goto(url);ready(p)
   if p.locator('#welcome-overlay').is_visible():p.locator('#btn-welcome-enough').click()
   p.evaluate(SEED);pick(p,'cyberpunk');chat(p);p.locator('#btn-ledger').click();p.wait_for_function("document.querySelector('#drawer').classList.contains('open')");p.wait_for_timeout(250)
   val=styles(p)
   if name=='baseline':baseline=val
   else:assert val==baseline,'Cyberpunk computed style regression'
   p.screenshot(path=str(OUT/f'{name}-cyberpunk.png'));c.close()
  if baseline is not None: print('PASS Cyberpunk baseline versus new: all computed properties on nine main surfaces identical',flush=True)
  url=serve(ROOT)
  for label,w,h in [('desktop',1440,900),('unfolded',760,960),('phone',390,844),('narrow',320,740)]:
   c=b.new_context(viewport={'width':w,'height':h},service_workers='allow',has_touch=w<500);p=c.new_page();errors=[];p.on('pageerror',lambda e:errors.append(str(e)));p.route('https://**/*',lambda r:r.abort());p.goto(url);ready(p)
   if p.locator('#welcome-overlay').is_visible():p.locator('#btn-welcome-enough').click()
   p.evaluate(SEED);pick(p,'neon-tokyo-night');p.screenshot(path=str(OUT/f'{label}-settings.png'));chat(p)
   p.wait_for_function("document.documentElement.dataset.thread==='story'")
   assert not p.evaluate('document.documentElement.scrollWidth>innerWidth+1')
   assert p.locator('.neon-rias').is_visible() == (w>=600)
   if w>=600:
    assert p.evaluate("()=>{const r=document.querySelector('.neon-rias').getBoundingClientRect();return [...document.querySelectorAll('.msg')].every(m=>m.getBoundingClientRect().right<=r.left)}")
   p.locator('#composer-input').fill('A quiet evening by the window.');assert p.locator('#composer-input').input_value()=='A quiet evening by the window.'
   p.screenshot(path=str(OUT/f'{label}-story.png'))
   p.evaluate("document.querySelector('#thread').scrollTop=0")
   p.screenshot(path=str(OUT/f'{label}-story-top.png'))
   assert p.evaluate("document.querySelector('#thread').scrollHeight>document.querySelector('#thread').clientHeight")
   p.locator('#btn-ledger').click();p.wait_for_function("document.querySelector('#drawer').classList.contains('open')");p.wait_for_timeout(350);p.screenshot(path=str(OUT/f'{label}-ledger.png'));p.locator('#btn-drawer-close').click()
   p.locator('#composer-input').fill('');p.reload();ready(p);p.wait_for_function("document.documentElement.dataset.theme==='neon-tokyo-night'")
   assert p.evaluate("document.documentElement.dataset.thread")=='story'
   pick(p,'cyberpunk');chat(p);assert not p.locator('.neon-room').is_visible()
   pick(p,'neon-tokyo-night');chat(p)
   p.evaluate('async()=>{window.__cozy.setActiveStoryId(null);await window.__cozy.chat.renderThread({structural:true,opening:true})}')
   p.wait_for_function("document.documentElement.dataset.thread==='welcome'");p.screenshot(path=str(OUT/f'{label}-welcome.png'))
   assert p.evaluate("()=>{let e=document.querySelector('.hearth')||document.querySelector('.no-connection'),s=getComputedStyle(e,'::before');return parseFloat(s.height)>=180&&s.backgroundImage.includes('rias_seated_extracted')}")
   p.emulate_media(reduced_motion='reduce');assert p.evaluate("document.querySelector('.thread-wrap').getAnimations().length")==0
   p.wait_for_function('!!navigator.serviceWorker.controller')
   for asset in ['css/neon-tokyo-night.css','assets/neon-tokyo/neon_tokyo_city.webp','assets/neon-tokyo/rias_seated_extracted.png']:
    assert p.evaluate('(a)=>caches.match(a).then(Boolean)',asset),asset
   c.set_offline(True);p.reload();ready(p);assert p.evaluate("document.documentElement.dataset.theme")=='neon-tokyo-night'
   for asset in ['css/neon-tokyo-night.css','assets/neon-tokyo/neon_tokyo_city.webp','assets/neon-tokyo/rias_seated_extracted.png']:assert p.evaluate('(a)=>fetch(a).then(r=>r.ok)',asset)
   assert not errors,errors
   print('PASS',label,'selection, reload, long prose, typing, drawer, switching, overflow, reduced motion, offline shell',flush=True);c.close()
  b.close()
finally:
 for s in servers:s.shutdown()
