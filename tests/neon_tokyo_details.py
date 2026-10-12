#!/usr/bin/env python3
"""Additional focused speech, contrast, subpath and reduced viewport checks."""
import ast,functools,threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=Path('/tmp/cozy-neon-redesign-details');OUT.mkdir(exist_ok=True)
SEED=next(n.value.value for n in ast.parse((ROOT/'tests/paint_coats.py').read_text()).body if isinstance(n,ast.Assign) and getattr(n.targets[0],'id','')=='SEED')
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
s=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT.parent)));threading.Thread(target=s.serve_forever,daemon=True).start()
url=f'http://127.0.0.1:{s.server_port}/{ROOT.name}/'
def ready(p):p.wait_for_function('!!window.__cozy?.chat && !!document.documentElement.dataset.version')
def pick(p,coat):
 p.locator('#btn-settings').click();p.locator('#settings-quicknav').get_by_role('button',name='The house',exact=True).click();p.locator(f'input[name="theme"][value="{coat}"]').check();p.wait_for_function('(c)=>document.documentElement.dataset.theme===c',arg=coat);p.wait_for_function('(c)=>document.querySelector("#speech-colours-coat").textContent===c',arg={'cyberpunk':'Cyberpunk','neon-tokyo-night':'Neon Tokyo Night'}[coat])
def chat(p):p.evaluate("location.hash='#/'");p.wait_for_function("!document.querySelector('#view-chat').hidden")
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(args=['--no-sandbox']);c=b.new_context(viewport={'width':1440,'height':900});p=c.new_page();p.route('https://**/*',lambda r:r.abort());p.goto(url);ready(p)
  if p.locator('#welcome-overlay').is_visible():p.locator('#btn-welcome-enough').click()
  sid=p.evaluate(SEED.replace("import('/js/","import('./js/"))
  original=p.evaluate('(id)=>window.__cozy.db.messages.list(id)',sid)
  for coat,spoken,thought in [('cyberpunk','#bbeecc','#ffaadd'),('neon-tokyo-night','#aabbff','#eebbee')]:
   pick(p,coat)
   for k,v in [('spoken',spoken),('thought',thought)]:p.locator('#speech-colour-'+k).fill(v);p.locator('#speech-colour-'+k).dispatch_event('change')
   p.wait_for_function('(x)=>document.documentElement.style.getPropertyValue("--thought")===x',arg=thought)
   chat(p)
  expected={'cyberpunk':{'spoken':'#bbeecc','thought':'#ffaadd'},'neon-tokyo-night':{'spoken':'#aabbff','thought':'#eebbee'}}
  p.reload();ready(p);assert p.evaluate('()=>window.__cozy.db.settings.get("speechColours")')==expected
  pick(p,'cyberpunk');assert p.locator('#speech-colour-spoken').input_value()=='#bbeecc';chat(p)
  pick(p,'neon-tokyo-night');assert p.locator('#speech-colour-thought').input_value()=='#eebbee'
  p.locator('#btn-speech-colours-reset').click();p.wait_for_function('()=>!document.documentElement.style.getPropertyValue("--spoken")')
  assert p.evaluate('()=>window.__cozy.db.settings.get("speechColours")')=={'cyberpunk':expected['cyberpunk']}
  p.screenshot(path=str(OUT/'desktop-settings.png'));chat(p)
  ratios=p.evaluate('''()=>{
   const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
   const lum=c=>c.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
   const css=getComputedStyle(document.documentElement), ground=rgb('#1d1231').map(v=>v*.94+255*.06);
   return Object.fromEntries(['text','text-2','muted','spoken','thought','danger','ok'].map(k=>{const a=lum(rgb(css.getPropertyValue('--'+k).trim())),b=lum(ground);return [k,(Math.max(a,b)+.05)/(Math.min(a,b)+.05)]}));
  }''')
  assert min(ratios.values())>=4.5,ratios
  print('PASS default prose/color contrast against worst-case white art under 94% local panel:',ratios,flush=True)
  p.screenshot(path=str(OUT/'desktop-story.png'))
  # Artwork is seated at the left and below UI; pointer tests use the actual composer.
  assert p.evaluate('''()=>{const el=document.querySelector('.neon-rias'),c=getComputedStyle(el);const left=el.getBoundingClientRect().left;return Math.abs(left-document.querySelector('.thread-wrap').getBoundingClientRect().left)<1&&c.pointerEvents==='none'}''')
  p.locator('#btn-ledger').click();p.wait_for_function("document.querySelector('#drawer').classList.contains('open')");p.wait_for_timeout(350);p.screenshot(path=str(OUT/'desktop-ledger.png'));p.locator('#btn-drawer-close').click();p.wait_for_timeout(350)
  for w,h in [(760,960),(950,760),(600,900),(390,844),(320,740)]:
   p.set_viewport_size({'width':w,'height':h});p.evaluate('async()=>{window.__cozy.setActiveStoryId(null);await window.__cozy.chat.renderThread({structural:true,opening:true})}');p.wait_for_function("document.documentElement.dataset.thread==='welcome'");p.screenshot(path=str(OUT/f'welcome-{w}.png'))
  p.evaluate('async(id)=>{window.__cozy.setActiveStoryId(id);await window.__cozy.chat.renderThread({structural:true,opening:true})}',sid)
  p.set_viewport_size({'width':390,'height':430});p.locator('#composer-input').click();p.locator('#composer-input').fill('Keyboard viewport check');assert p.locator('#composer-input').is_visible()
  assert p.evaluate("document.querySelector('#composer-input').getBoundingClientRect().bottom<=innerHeight")
  p.locator('#composer-input').fill('');p.set_viewport_size({'width':390,'height':844});p.screenshot(path=str(OUT/'phone-story.png'))
  assert p.evaluate('(id)=>window.__cozy.db.messages.list(id)',sid)==original
  p.wait_for_function('!!navigator.serviceWorker.controller');c.set_offline(True);p.reload();ready(p)
  for asset in ['css/neon-tokyo-night.css','assets/neon-tokyo/neon_tokyo_city.webp','assets/neon-tokyo/rias_seated_extracted.png']:assert p.evaluate('(a)=>fetch(a).then(r=>r.ok)',asset)
  print('PASS independent custom speech/thought persistence and reset, unchanged fixture prose, nested path offline assets, decoration bounds, reduced viewport composer',flush=True)
  b.close()
finally:s.shutdown()
