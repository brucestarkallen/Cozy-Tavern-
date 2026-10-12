#!/usr/bin/env python3
"""Active folding/orientation without reload, and final welcome composition."""
import ast,functools,threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=Path('/tmp/cozy-academy');OUT.mkdir(exist_ok=True)
SEED=next(n.value.value for n in ast.parse((ROOT/'tests/paint_coats.py').read_text()).body if isinstance(n,ast.Assign) and getattr(n.targets[0],'id','')=='SEED')
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
s=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)));threading.Thread(target=s.serve_forever,daemon=True).start()
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(args=['--no-sandbox']);c=b.new_context(service_workers='block');p=c.new_page();p.route('https://**/*',lambda r:r.abort());p.goto(f'http://127.0.0.1:{s.server_port}/');p.wait_for_function('!!window.__cozy?.chat')
  if p.locator('#welcome-overlay').is_visible():p.locator('#btn-welcome-enough').click()
  p.evaluate(SEED)
  for theme in ['academy','academy-night']:
   p.evaluate('(t)=>document.documentElement.dataset.theme=t',theme)
   p.evaluate('document.fonts.ready')
   for w,h in [(390,844),(696,620),(760,960),(390,430)]:
    p.set_viewport_size({'width':w,'height':h})
    p.locator('#composer-input').fill('A quiet evening in the library.')
    p.evaluate("document.querySelector('#thread').scrollTop=1e8")
    p.wait_for_function("document.querySelector('#btn-jump').hidden")
    before=p.locator('.composer-zone').bounding_box()
    p.evaluate("document.querySelector('#thread').scrollTop=100")
    p.wait_for_function("!document.querySelector('#btn-jump').hidden")
    after=p.locator('.composer-zone').bounding_box()
    assert abs(before['y']-after['y'])<1,(theme,w,before,after)
    assert abs(before['height']-after['height'])<1
    assert p.locator('#composer-input').input_value()=='A quiet evening in the library.'
    assert p.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
    assert after['y']+after['height']<=h+1
    if w in [390,760] and h>500:p.screenshot(path=str(OUT/f'{theme}-{w}.png'))
    p.locator('#btn-jump').click()
    p.wait_for_function("document.querySelector('#btn-jump').hidden")
    assert abs(p.locator('.composer-zone').bounding_box()['y']-before['y'])<1
   print('PASS',theme,'scroll up / jump down: stable composer at phone, unfolded and short heights; draft and input retained')
  b.close()
finally:s.shutdown()
