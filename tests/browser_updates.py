#!/usr/bin/env python3
"""Focused real Chromium upgrade. No manual reload fallback or model calls.
Uses the same Playwright, persistent origin and file replacement approach as
upgrade_in_place.py, without its launcher/gameplay/reload fallback coverage.
--baseline reproduces the pre-M720 slow-start takeover race from git HEAD.
"""
import functools,json,re,shutil,subprocess,tempfile,threading,time,sys
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.sync_api import sync_playwright
REPO=Path(__file__).resolve().parents[1]
baseline='--baseline' in sys.argv
migration='--migration' in sys.argv
root=Path(tempfile.mkdtemp(prefix='cozy-update-'))
shutil.copytree(REPO,root,dirs_exist_ok=True,ignore=shutil.ignore_patterns('.git','node_modules','tests','docs'))
if baseline or migration:
 for name in ['js/app.js','js/version.js','sw.js','js/sync.js','js/ui/chat.js','js/ui/settings.js']:
  (root/name).write_bytes(subprocess.check_output(['git','show','2201d546368675d19b45f6ba4bd568274c70d175:'+name],cwd=REPO))
app=root/'js/app.js'
app.write_text(app.read_text().replace('const booksStatus = await initSync(ctx);','window.__startupReached=true; while (window.__holdStartup) await new Promise(r=>setTimeout(r,50));\n  const booksStatus = await initSync(ctx);'))
version=root/'js/version.js'
def publish(v): version.write_text(re.sub(r"VERSION = '[^']+'",f"VERSION = '{v}'",version.read_text()))
publish('update-test-0')
requests=[]
class Handler(SimpleHTTPRequestHandler):
 def log_message(self,*args): pass
 def end_headers(self):
  # Intentionally cache imports/app files, unlike Termux's no-store server.
  self.send_header('Cache-Control','no-store' if migration else ('no-cache' if self.path=='/sw.js' else 'public, max-age=3600'))
  super().end_headers()
 def do_GET(self):
  if self.path in ['/sw.js','/js/version.js','/js/app.js']:
   requests.append({'path':self.path,'cache':self.headers.get('Cache-Control'),'worker':self.headers.get('Service-Worker')})
  super().do_GET()
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start()
url=f'http://127.0.0.1:{server.server_port}/'
errors=[]
def watch(page):
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.add_init_script("window.__events=0; navigator.serviceWorker.addEventListener('controllerchange',()=>window.__events++);")
 return page
def ready(page,v):
 page.wait_for_function('(v)=>document.documentElement.dataset.version===v && window.__cozy?.chat && window.__cozy.booksStatus',arg=v,timeout=45000)
def state(page):
 return page.evaluate('''async()=>{let r=await navigator.serviceWorker.getRegistration();return {loaded:document.documentElement.dataset.version,events:window.__events,active:r.active?.state,installing:r.installing?.state,waiting:r.waiting?.state,cacheMode:r.updateViaCache,caches:await caches.keys(),busy:window.__cozy?.chat?.isBusy()}}''')
def check(page):
 # visibility/online are production triggers, no direct reload or registration.update.
 page.evaluate("window.dispatchEvent(new Event('online'));document.dispatchEvent(new Event('visibilitychange'))")
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(args=['--no-sandbox']);context=browser.new_context()
  page=watch(context.new_page());page.goto(url);ready(page,'update-test-0');page.wait_for_function('!!navigator.serviceWorker.controller')
  navs=[];page.on('framenavigated',lambda f:navs.append(f.url) if f==page.main_frame else None)
  seed=page.evaluate('''async()=>{const db=window.__cozy.db;await db.settings.set('welcomeSeen',true);await db.settings.set('updateTest','keep me');const s=await db.stories.create({title:'Unchanged story'});await db.messages.append(s.id,{role:'user',text:'Original prose.'});document.querySelector('#welcome-overlay').hidden=true;return s.id;}''')
  page.wait_for_timeout(2300);assert not navs,'First install must not reload.'
  if migration:
   firstVisit=page
   page=watch(context.new_page());page.goto(url);ready(page,'update-test-0')
   navs=[];page.on('framenavigated',lambda f:navs.append(f.url) if f==page.main_frame else None)
   for name in ['js/app.js','js/updates.js','js/version.js','sw.js','js/sync.js','js/ui/chat.js','js/ui/settings.js']:
    (root/name).write_bytes((REPO/name).read_bytes())
   publish('update-test-migration');check(page);ready(page,'update-test-migration')
   assert page.evaluate('async()=>await window.__cozy.db.settings.get("updateTest")')=='keep me'
   page.wait_for_timeout(3200);assert len(navs)==1,navs
   assert not errors,errors
   assert firstVisit.evaluate('document.documentElement.dataset.version')=='update-test-0'
   print('CONFIRMED legacy first-install latch also leaves its original tab stale:',json.dumps(state(firstVisit)),flush=True)
   print('PASS actual M719 code to corrected code in the original tab, automatic reload, saved data retained, no loop.',flush=True)
   browser.close();sys.exit(0)
  if '--forms-only' in sys.argv:
   page.evaluate("document.querySelector('#new-story-form').hidden=false;document.querySelector('#new-story-title').value='Unsent title'")
   page.set_input_files('#attach-file',{'name':'draft.txt','mimeType':'text/plain','buffer':b'Unsent attachment'})
   page.wait_for_function('window.__cozy.chat.hasDraft()');publish('update-test-forms');check(page)
   page.wait_for_function('!!document.querySelector("#update-status")');page.wait_for_timeout(3200)
   assert page.evaluate('document.documentElement.dataset.version')=='update-test-0'
   page.evaluate("document.querySelector('#attach-preview .attach-drop').click()")
   page.wait_for_timeout(3200)
   assert page.evaluate('document.documentElement.dataset.version')=='update-test-0'
   page.evaluate("document.querySelector('#new-story-form').hidden=true;document.activeElement.blur()")
   ready(page,'update-test-forms');assert not errors,errors
   print('PASS real attachment, blurred unsent form, automatic reload after completion. No manual reload.',flush=True)
   browser.close();sys.exit(0)
  slow=watch(context.new_page());slow.add_init_script("window.__holdStartup=!sessionStorage.getItem('testHeld');sessionStorage.setItem('testHeld','1');")
  slow.goto(url);slow.wait_for_function('window.__startupReached');page.close()
  publish('update-test-1')
  # Old code has no early listener or production check until startup completes.
  if baseline:
   slow.evaluate('async()=>{let r=await navigator.serviceWorker.getRegistration();await r.update()}')
   slow.wait_for_timeout(3500)
   if slow.evaluate('window.__events')==0:
    print('CONFIRMED cached imported VERSION prevented takeover with imports:',json.dumps(state(slow)))
    # Force browser revalidation solely to isolate the separate missed-event race.
    slow.evaluate("async()=>{await navigator.serviceWorker.register('sw.js',{type:'module',updateViaCache:'none'});await (await navigator.serviceWorker.getRegistration()).update()}")
   slow.wait_for_function('window.__events>0');slow.evaluate('window.__holdStartup=false');ready(slow,'update-test-0');slow.wait_for_timeout(3000)
   assert slow.evaluate('document.documentElement.dataset.version')=='update-test-0'
   print('CONFIRMED missed takeover during startup:',json.dumps(state(slow)))
  else:
   check(slow);slow.wait_for_function('window.__events>0');assert not slow.evaluate('window.__cozy?.booksStatus')
   slow.evaluate('window.__holdStartup=false');ready(slow,'update-test-1')
   print('PASS slow startup automatic upgrade:',json.dumps(state(slow)))
   # Two already-open tabs, one with draft and simulated active-generation guard.
   other=watch(context.new_page());other.goto(url);ready(other,'update-test-1')
   other.fill('#composer-input','Unsent words must survive.');other.evaluate('window.__cozy.chat.isBusy=()=>true')
   navs=[];slow.on('framenavigated',lambda f:navs.append(f.url) if f==slow.main_frame else None)
   publish('update-test-2');check(slow);ready(slow,'update-test-2')
   other.wait_for_timeout(3500)
   assert other.evaluate('document.documentElement.dataset.version')=='update-test-1'
   assert other.input_value('#composer-input')=='Unsent words must survive.'
   assert other.locator('#update-status').is_visible()
   other.evaluate('window.__cozy.chat.isBusy=()=>false');other.wait_for_timeout(3200)
   assert other.input_value('#composer-input')=='Unsent words must survive.'
   assert other.evaluate('document.documentElement.dataset.version')=='update-test-1'
   # User finishes with the draft. Only then may its tab refresh.
   other.fill('#composer-input','');other.evaluate('document.activeElement.blur()');ready(other,'update-test-2')
   data=other.evaluate('''async(id)=>({setting:await window.__cozy.db.settings.get('updateTest'),story:await window.__cozy.db.stories.get(id),pages:await window.__cozy.db.messages.list(id)})''',seed)
   assert data['setting']=='keep me' and data['story']['title']=='Unchanged story' and data['pages'][0]['text']=='Original prose.'
   slow.wait_for_timeout(3500);assert len(navs)==1,navs
   context.set_offline(True);offline=watch(context.new_page());offline.goto(url);ready(offline,'update-test-2')
   assert offline.evaluate('async()=>await window.__cozy.db.settings.get("updateTest")')=='keep me'
   # Reconnect with an update while a real edit box and a held operation exist.
   offline.evaluate('''()=>{const e=document.createElement('textarea');e.className='edit-box';e.value='Unfinished edit';document.querySelector('#thread').append(e);window.__cozy.updates.run(()=>new Promise(r=>window.__finishOperation=r));window.__cozy.chat.isBusy=()=>true;}''')
   publish('update-test-3');context.set_offline(False);check(offline)
   offline.wait_for_function('!!document.querySelector("#update-status")');offline.wait_for_timeout(3200)
   assert offline.evaluate('document.documentElement.dataset.version')=='update-test-2'
   offline.evaluate('document.querySelector("textarea.edit-box").remove()');offline.wait_for_timeout(3200)
   assert offline.evaluate('document.documentElement.dataset.version')=='update-test-2'
   offline.evaluate('window.__finishOperation()');offline.wait_for_timeout(3200)
   assert offline.evaluate('document.documentElement.dataset.version')=='update-test-2','Generation guard alone must defer.'
   offline.evaluate('window.__cozy.chat.isBusy=()=>false');ready(offline,'update-test-3')
   # An actual IndexedDB clone failure must prevent automatic reload.
   offline.evaluate('async()=>{try{await window.__cozy.db.settings.set("bad-fixture",()=>{})}catch{}}')
   publish('update-test-4');check(offline);offline.wait_for_function('document.querySelector("#update-status")?.textContent.includes("save failed")');offline.wait_for_timeout(3200)
   assert offline.evaluate('document.documentElement.dataset.version')=='update-test-3'
   print('PASS reconnect, edit protection, operation hold, generation guard alone, failed IndexedDB save deferral.',flush=True)
   assert not errors,errors
   print('PASS automatic reload, imported-only update under HTTP max-age, two tabs, busy guard, draft deferral, IndexedDB retention, offline shell, no loop. No manual reloads or provider calls.')
  print('HTTP requests:',json.dumps(requests[-18:]));browser.close()
finally:
 server.shutdown();shutil.rmtree(root)
