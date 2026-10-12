#!/usr/bin/env python3
"""Focused actual send integration through disposable browser storage and mocked transport."""
import functools,threading,os,json
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/tmp/cozy-chromium/chromium'),args=['--no-sandbox'])
  page=browser.new_page(service_workers='block')
  errors=[];requests=[]
  page.on('pageerror',lambda err:errors.append(str(err)))
  page.route('https://**/*',lambda route:route.abort())
  def answer(route):
   body=route.request.post_data_json
   if route.request.method!='POST':route.fulfill(status=200,content_type='application/json',body='{"data":[]}');return
   requests.append(body)
   payload='data: '+json.dumps({'choices':[{'delta':{'content':'[Dawn · Chapel]\n\nMara rests two fingers on the copper chest and waits for Neri’s answer.'}}]})+'\n\n'
   payload+='data: '+json.dumps({'choices':[{'delta':{},'finish_reason':'stop'}],'usage':{'prompt_tokens':321,'completion_tokens':26}})+'\n\ndata: [DONE]\n\n'
   route.fulfill(status=200,content_type='text/event-stream',body=payload)
  page.route('**/fixture-provider/**',answer)
  page.goto(f'http://127.0.0.1:{server.server_port}/');page.wait_for_function('!!window.__cozy?.chat')
  if page.locator('#welcome-overlay').is_visible():page.locator('#btn-welcome-enough').click()
  story=page.evaluate("""async()=>{
    const {db}=await import('/js/store.js');
    for(const [key,value] of Object.entries({memoryKeeper:false,continuityCheck:false,worldAgent:false,auditOn:false,refereeOn:false,smartRecall:false,canonVerify:false,sensorsOn:false,directorOn:false,editorOn:false,frameText:'SEND_FRAME_PRESERVE',noteText:'SEND_CLOSING_PRESERVE',ownWords:[{name:'Fixture words',text:'SEND_OWN_WORDS_PRESERVE',role:'house',place:'after-your-message'}]})) await db.settings.set(key,value);
    const conn=await db.connections.add({label:'Fixture',type:'openai',baseUrl:location.origin+'/fixture-provider/v1',apiKey:'fixture',model:'fixture',contextSize:200000,maxTokens:8000,reasoning:{effort:'off'}});
    const story=await db.stories.create({title:'Send fixture'});
    await db.stories.update(story.id,{connectionId:conn.id,briefMode:'manual',brief:'SEND_BRIEF_PRESERVE',extraction:false,keeper:false,continuity:false,world:false,audit:false});
    await db.messages.append(story.id,{role:'user',text:'We meet Mara at the chapel.'});
    await db.messages.append(story.id,{role:'assistant',text:'LATEST_ORIGINAL_PRESERVE. Mara waits beside the copper chest.'});
    const {emptyState,saveState}=await import('/js/engine/state.js');const state=emptyState();state.sheet.playerName='Neri';state.present=[{name:'Neri'},{name:'Mara'}];state.characters={Mara:{core:'A patient locksmith.',state:'waiting',threads:[]}};state.page=1;await saveState(story.id,state);
    await window.__cozy.chat.openStory(story.id);return story.id;
  }""")
  page.locator('#composer-input').fill('CURRENT_MOVE_PRESERVE. I ask Mara about the copper key.')
  page.locator('#btn-send').click()
  for _ in range(150):
   result=page.evaluate("""async id=>{const {db}=await import('/js/store.js');const {loadSent}=await import('/js/sent.js');const pages=await db.messages.list(id);const last=pages.findLast(m=>m.receipt?.sentId);return last ? {receipt:last.receipt,sent:await loadSent(last.receipt.sentId),original:pages[1].text} : null;}""",story)
   if result and result.get('sent'):break
   page.wait_for_timeout(100)
  assert result,{'errors':errors,'requests':requests,'body':page.locator('body').inner_text()[-3500:]}
  assert requests,errors
  # Only the successful teller is counted; unrelated queued jobs were disabled in the fixture.
  tellers=[r for r in requests if 'SEND_FRAME_PRESERVE' in json.dumps(r)]
  assert len(tellers)==1,(len(tellers),requests)
  actual=json.dumps(tellers[0],ensure_ascii=False)
  for value in ['SEND_FRAME_PRESERVE','SEND_CLOSING_PRESERVE','SEND_OWN_WORDS_PRESERVE','LATEST_ORIGINAL_PRESERVE','CURRENT_MOVE_PRESERVE']:assert value in actual,value
  assert result['receipt']['context']['transport']['inputTokens']==result['receipt']['context']['inputTokens']
  assert result['receipt']['context']['providerUsage']['prompt_tokens']==321
  assert result['receipt']['context']['recall']['why']=='disabled'
  assert result['sent']['selection']['storyId']==story
  assert result['sent']['requests'][0]['body']==tellers[0]
  assert result['original']=='LATEST_ORIGINAL_PRESERVE. Mara waits beside the copper chest.'
  assert not errors,errors
  print(json.dumps({'result':'pass','actualSuccessfulTellerRequests':len(tellers),'estimatedInput':result['receipt']['context']['inputTokens'],'mockUsage':result['receipt']['context']['providerUsage'],'originalPreserved':True,'liveProviderCalls':0}))
  browser.close()
finally:server.shutdown()
