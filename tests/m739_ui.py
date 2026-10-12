import functools,threading,json
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.sync_api import sync_playwright
from pathlib import Path
ROOT=str(Path(__file__).resolve().parents[1])
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=ROOT))
threading.Thread(target=server.serve_forever,daemon=True).start()
with sync_playwright() as pw:
 b=pw.chromium.launch(executable_path='/tmp/cozy-chromium/chromium',args=['--no-sandbox'])
 p=b.new_page(service_workers='block',viewport={'width':1440,'height':900})
 p.goto(f'http://127.0.0.1:{server.server_port}');p.wait_for_function('!!window.__cozy?.chat')
 if p.locator('#welcome-overlay').is_visible():p.locator('#btn-welcome-enough').click()
 p.evaluate("location.hash='#/settings'")
 p.locator('#settings-quicknav').wait_for(state='visible')
 p.evaluate("document.getElementById('settings-quicknav').openRoomFor('section-appearance')")
 p.evaluate("document.getElementById('section-appearance').classList.remove('folded')")
 p.locator('#btn-speech-colours-orange').click()
 p.wait_for_function("!document.getElementById('btn-speech-colours-reset').disabled")
 result=p.evaluate("""async()=>{const {db}=await import('/js/store.js');return {map:await db.settings.get('speechColours'),color:document.documentElement.style.getPropertyValue('--spoken'),theme:document.documentElement.dataset.theme}}""")
 assert result['color']=='#f49a45',result
 p.locator('#btn-speech-colours-reset').click()
 p.wait_for_function("!document.documentElement.style.getPropertyValue('--spoken')")
 for theme in ['light','neon-tokyo-night']:
  p.locator(f'input[name="theme"][value="{theme}"]').check()
  p.wait_for_timeout(100)
  p.locator('#btn-speech-colours-orange').click()
  p.wait_for_function("!document.getElementById('btn-speech-colours-reset').disabled")
  data=p.evaluate("""async()=>{const {db}=await import('/js/store.js');return {map:await db.settings.get('speechColours'),reads:document.getElementById('speech-colour-spoken-reads').textContent}}""")
  assert 'hard to read' not in data['reads'],data
 assert 'light' in data['map'] and 'neon-tokyo-night' in data['map'],data
 p.locator('#btn-speech-colours-reset').click()
 p.wait_for_function("!document.documentElement.style.getPropertyValue('--spoken')")
 assert p.evaluate("async()=>{const {db}=await import('/js/store.js');return !!(await db.settings.get('speechColours')).light}")
 for width in [1440,390]:
  p.set_viewport_size({'width':width,'height':900})
  metrics=p.evaluate("""()=>{let nav=document.querySelector('.settings-quicknav'),chip=nav.querySelector('button');return {inset:chip.getBoundingClientRect().left-nav.getBoundingClientRect().left,overflow:document.documentElement.scrollWidth>innerWidth}}""")
  assert metrics['inset']>=9 and not metrics['overflow'],metrics
 p.evaluate("location.hash='#/chat';document.body.classList.add('immersed');let e=document.getElementById('btn-immerse-show');e.hidden=false;e.classList.add('all-well')")
 p.wait_for_timeout(100)
 assert p.evaluate("getComputedStyle(document.getElementById('page-mark')).display")=='none'
 metrics=p.evaluate("""()=>{let e=document.getElementById('btn-immerse-show'),s=e.querySelector('span').getBoundingClientRect(),r=e.getBoundingClientRect(),a=getComputedStyle(e,'::after');return {tabCenter:s.x+s.width/2,dotCenter:r.right-parseFloat(a.right),scroll:getComputedStyle(document.getElementById('thread')).overflowY}}""")
 assert abs(metrics['tabCenter']-metrics['dotCenter'])<.1,metrics
 assert metrics['scroll']=='auto',metrics
 print(json.dumps({'passed':'orange selection, contrast, per theme persistence and reset, desktop/mobile nav inset, immersive dot centering, native scrollbar retained','metrics':metrics,'colours':data}))
 b.close()
server.shutdown()
