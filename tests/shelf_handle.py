# The shelf's edge handle on a touch screen (Chromium, phone emulation). Run: CHROMIUM_PATH=... python3 tests/shelf_handle.py
import functools,threading,os,sys,json
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.sync_api import sync_playwright
from pathlib import Path
ROOT=str(Path(__file__).resolve().parents[1])
class Q(SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
srv=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Q,directory=ROOT));threading.Thread(target=srv.serve_forever,daemon=True).start()
grip="(()=>{const a=getComputedStyle(document.querySelector('.panel-resize'),'::before');return a.backgroundColor+' '+a.height})()"
res={}
with sync_playwright() as pw:
 b=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/tmp/cozy-chromium/chromium'),args=['--no-sandbox'])
 c=b.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,service_workers='block')
 p=c.new_page()
 p.goto(f'http://127.0.0.1:{srv.server_port}');p.wait_for_function('!!window.__cozy?.chat')
 if p.locator('#welcome-overlay').is_visible():p.locator('#btn-welcome-enough').click()
 p.locator('#btn-stories').tap(); p.wait_for_timeout(500)
 res['rest']=p.evaluate(grip)
 h=p.evaluate("(()=>{const r=document.querySelector('.panel-resize').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()")
 res['width_before']=p.evaluate("document.querySelector('.story-panel').getBoundingClientRect().width")
 # a tap: touchstart + touchend, no move
 p.evaluate("""({x,y})=>{const e=document.querySelector('.panel-resize');const t=new Touch({identifier:1,target:e,clientX:x,clientY:y});
  e.dispatchEvent(new TouchEvent('touchstart',{touches:[t],targetTouches:[t],changedTouches:[t],bubbles:true,cancelable:true}));window.__grip=getComputedStyle(e,'::before').backgroundColor+' '+document.body.classList.contains('panel-resizing');
  window.dispatchEvent(new TouchEvent('touchend',{touches:[],changedTouches:[t],bubbles:true}));}""",h)
 res['during_tap']=p.evaluate("window.__grip")
 # a drag of +60 px
 p.evaluate("""({x,y})=>{const e=document.querySelector('.panel-resize');const t=new Touch({identifier:2,target:e,clientX:x,clientY:y}),m=new Touch({identifier:2,target:e,clientX:x+60,clientY:y});
  e.dispatchEvent(new TouchEvent('touchstart',{touches:[t],targetTouches:[t],changedTouches:[t],bubbles:true,cancelable:true}));
  window.dispatchEvent(new TouchEvent('touchmove',{touches:[m],changedTouches:[m],bubbles:true,cancelable:true}));
  window.__m=m;}""",h)
 p.wait_for_timeout(300)
 res['during_drag']=p.evaluate("(()=>{const e=document.querySelector('.panel-resize');return getComputedStyle(e,'::before').backgroundColor+' '+getComputedStyle(e,'::before').height})()")
 p.evaluate("window.dispatchEvent(new TouchEvent('touchend',{touches:[],changedTouches:[window.__m],bubbles:true}))")
 p.wait_for_timeout(300)
 res['width_after']=p.evaluate("document.querySelector('.story-panel').getBoundingClientRect().width")
 res['after']=p.evaluate(grip)
 b.close()
srv.shutdown()
# M752 (followup 6), his: "when I tap the bar on the left there's a wide long thin square at the middle" — the shelf
# handle's resting grip on a phone. Nothing is drawn at rest or on a tap; the drag still widens and lights the edge.
assert res['rest'].startswith('rgba(0, 0, 0, 0)'),res
assert res['during_tap']=='rgba(0, 0, 0, 0) false',res
assert not res['during_drag'].startswith('rgba(0, 0, 0, 0)'),res
assert res['width_after']==res['width_before']+60,res
assert res['after'].startswith('rgba(0, 0, 0, 0)'),res
print(json.dumps({'passed':'no resting grip on a touch screen, nothing on a tap, the drag widens the shelf and lights its edge',**res}))
