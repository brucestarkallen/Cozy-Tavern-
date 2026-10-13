#!/usr/bin/env python3
"""M735: first-message branch automatic brief reset and retry."""
import ast,functools,threading,os,json
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=Path('/tmp/cozy-m735');OUT.mkdir(exist_ok=True)
SEED=next(n.value.value for n in ast.parse((ROOT/'tests/paint_coats.py').read_text()).body if isinstance(n,ast.Assign) and getattr(n.targets[0],'id','')=='SEED')
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
s=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)));threading.Thread(target=s.serve_forever,daemon=True).start()
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'),args=['--no-sandbox']);c=b.new_context(service_workers='block',viewport={'width':1100,'height':850});p=c.new_page();p.route('https://**/*',lambda r:r.abort());p.goto(f'http://127.0.0.1:{s.server_port}/');p.wait_for_function('!!window.__cozy?.chat')
  if p.locator('#welcome-overlay').is_visible():p.locator('#btn-welcome-enough').click()
  parent=p.evaluate("""async()=>{
   const {db}=await import('/js/store.js');const st=await db.stories.create({title:'Branch brief fixture'});
   await db.stories.update(st.id,{briefMode:'automatic',brief:'Manual premise stays.'});
   const first=await db.messages.append(st.id,{role:'user',text:'Opening orchard is peaceful.'});
   await db.messages.append(st.id,{role:'assistant',text:'The orchard gate is open.'});
   await db.messages.append(st.id,{role:'user',text:'Years later, burn the city.'});
   await db.messages.append(st.id,{role:'assistant',text:'FUTURE_CITY_DESTROYED.'});
   await db.settings.set('worldGround:'+st.id,{by:'writer',words:'FUTURE_CITY_DESTROYED. Edited automatic world.'});
   await window.__cozy.chat.openStory(st.id);return {id:st.id,first:first.id};
  }""")
  p.locator(f'.msg[data-id="{parent["first"]}"] [data-act="branch"]').click()
  p.wait_for_function('(id)=>window.__cozy.getActiveStoryId()!==id',arg=parent['id'])
  p.wait_for_function("async()=>{const {db}=await import('/js/store.js');return !(await db.stories.get(window.__cozy.getActiveStoryId())).building}")
  branch=p.evaluate('window.__cozy.getActiveStoryId()')
  state=p.evaluate("""async id=>{const {db}=await import('/js/store.js');return {ground:await db.settings.get('worldGround:'+id),story:await db.stories.get(id),pages:await db.messages.list(id)}}""",branch)
  assert state['ground']=={'pendingBranch':True}
  assert state['story']['brief']=='Manual premise stays.' and len(state['pages'])==1
  p.reload();p.wait_for_function('!!window.__cozy?.chat')
  assert p.evaluate("async id=>{const {db}=await import('/js/store.js');return (await db.settings.get('worldGround:'+id)).pendingBranch}",branch)
  calls=[]
  def answer(route):
   body=route.request.post_data_json;calls.append(json.dumps(body))
   words=json.dumps({'world':'A peaceful orchard.','standing':'The story has just begun.'})
   payload='data: '+json.dumps({'choices':[{'delta':{'content':words}}]})+'\n\ndata: [DONE]\n\n'
   route.fulfill(status=200,content_type='text/event-stream',body=payload)
  p.route('**/fixture-provider/**',answer)
  p.evaluate("""async id=>{const {db}=await import('/js/store.js');const conn=await db.connections.add({label:'Fixture',type:'openai',baseUrl:location.origin+'/fixture-provider/v1',apiKey:'fixture',model:'fixture'});await db.stories.update(id,{connectionId:conn.id,workerConnections:{ground:conn.id}});await window.__cozy.chat.openStory(id);}""",branch)
  for _ in range(80):
   ground=p.evaluate("async id=>{const {db}=await import('/js/store.js');return await db.settings.get('worldGround:'+id)}",branch)
   if ground and ground.get('parts'):break
   p.wait_for_timeout(100)
  assert ground and ground.get('parts'),ground
  (OUT/'requests.json').write_text(json.dumps(calls))
  assert any('Opening orchard is peaceful.' in x for x in calls)
  assert all('FUTURE_CITY_DESTROYED' not in x for x in calls)
  assert p.evaluate("async id=>{const {db}=await import('/js/store.js');return (await db.settings.get('worldGround:'+id)).words}",parent['id'])=='FUTURE_CITY_DESTROYED. Edited automatic world.'
  print('PASS actual first-message branch clears edited automatic world, preserves manual premise/original, survives reload without connection, rebuilds with retained opening only through mocked provider.')
  b.close()
finally:s.shutdown()
