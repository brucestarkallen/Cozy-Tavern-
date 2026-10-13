#!/usr/bin/env python3
"""Actual browser idle Essentials recovery, persisted cooldown and honest lamp. No live model."""
import functools,json,os,threading
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
  page=browser.new_page(service_workers='block');errors=[];calls=[];mode=['bad']
  page.on('pageerror',lambda err:errors.append(str(err)))
  page.route('https://**/*',lambda r:r.abort())
  def answer(route):
   if route.request.method!='POST':route.fulfill(status=200,content_type='application/json',body='{"data":[]}');return
   body=route.request.post_data_json
   is_ess='You condense the record of a long collaborative story' in json.dumps(body)
   if not is_ess:route.fulfill(status=200,content_type='application/json',body=json.dumps({'choices':[{'message':{'content':'{}'},'finish_reason':'stop'}]}));return
   calls.append(body)
   text='[Dawn, chapel] '+('Long detail. '*1500) if mode[0]=='bad' else '[Dawn, chapel] (pages 1 to 49) Neri returned the copper key to Mara; the promise still depends on finding her missing brother.'
   payload='data: '+json.dumps({'choices':[{'delta':{'content':text}}]})+'\n\n'
   payload+='data: '+json.dumps({'choices':[{'delta':{},'finish_reason':'length' if mode[0]=='bad' else 'stop'}]})+'\n\ndata: [DONE]\n\n'
   route.fulfill(status=200,content_type='text/event-stream',body=payload)
  page.route('**/fixture-provider/**',answer)
  page.goto(f'http://127.0.0.1:{server.server_port}/');page.wait_for_function('!!window.__cozy?.chat')
  if page.locator('#welcome-overlay').is_visible():page.locator('#btn-welcome-enough').click()
  page.clock.install()
  story=page.evaluate("""async()=>{
   const {db}=await import('/js/store.js');
   for(const [key,value] of Object.entries({memoryKeeper:false,continuityCheck:false,worldAgent:false,auditOn:false,continuousAudit:false,refereeOn:false,smartRecall:false,canonVerify:false,sensorsOn:false,directorOn:false,editorOn:false}))await db.settings.set(key,value);
   const conn=await db.connections.add({label:'Fixture',type:'openai',baseUrl:location.origin+'/fixture-provider/v1',apiKey:'fixture',model:'fixture',contextSize:200000,maxTokens:5000,reasoning:{effort:'off'}});
   let story=await db.stories.create({title:'Essentials recovery'});
   await db.stories.update(story.id,{connectionId:conn.id,briefMode:'manual',brief:'',extraction:false,keeper:false,continuity:false,world:false,audit:false});
   story=await db.stories.get(story.id);
   for(let i=0;i<49;i++)await db.messages.append(story.id,{role:'assistant',text:'[Dawn, chapel] Neri returned the copper key to Mara; the conditional promise remains open. Page '+(i+1)+'.'});
   const nodes=Array.from({length:49},(_,i)=>({id:'n'+i,span:[i,i],text:'[Dawn, chapel] Neri returned the copper key to Mara; the conditional promise remains open.'}));
   await db.settings.set('memory:'+story.id,{nodes});
   const {recordOf,sourcePrint}=await import('/js/agents/essentials.js');
   await db.settings.set('essentials:'+story.id,{text:'PREVIOUS_ESSENTIALS_KEEP',print:recordOf(nodes.slice(0,3)).print,sourcePrint:sourcePrint(nodes.slice(0,3)),upTo:2,complete:true});
   const {emptyState,saveState,loadState}=await import('/js/engine/state.js');
   let state=emptyState();state.page=48;state.readTo=48;await saveState(story.id,state);state=await loadState(story.id);
   const {ledgerVerificationRows,ledgerRepairInputKey,ledgerRepairStateKey,ledgerAuditVerified}=await import('/js/agents/auditprogress.js');
   const pages=await db.messages.list(story.id),rows=ledgerVerificationRows(state);
   state.audit={at:Date.now(),coverage:{read:49,total:49},verifiedInput:ledgerRepairInputKey(state,story,pages),verification:{source:ledgerRepairInputKey({},story,pages),ledger:ledgerRepairStateKey(state),entries:Object.fromEntries(rows.map(r=>[r.id,{print:r.print,scope:r.scope,status:'correct',why:'Fixture approved.'}]))}};
   await saveState(story.id,state);
   if(!ledgerAuditVerified(await loadState(story.id),story,pages))throw Error('invalid fixture audit');
   const {noteWorkerRun}=await import('/js/agents/status.js');await noteWorkerRun(story.id,'keeper',{ok:true,detail:'Fixture record complete.'});
   await window.__cozy.chat.openStory(story.id);return story.id;
  }""")
  snapshot="""async id=>{const {db}=await import('/js/store.js');const {workIsRunning}=await import('/js/agents/queue.js');return {pending:await db.settings.get('essentialsPending:'+id),kept:await db.settings.get('essentials:'+id),shelf:await db.settings.get('workers:'+id),working:workIsRunning(id),lamp:document.getElementById('btn-ledger').className,title:document.getElementById('btn-ledger').title,pages:(await db.messages.list(id)).length};}"""
  for _ in range(100):
   result=page.evaluate(snapshot,story)
   if result.get('pending') and not result['working'] and result['shelf'].get('essentials',{}).get('unfinished'):break
   page.wait_for_timeout(100)
  assert len(calls)==2,(len(calls),result,errors)
  assert result['kept']['text']=='PREVIOUS_ESSENTIALS_KEEP',result
  assert result['shelf']['essentials']['unfinished'],result
  page.wait_for_timeout(400)
  assert 'all-well' not in page.evaluate(snapshot,story)['lamp']
  # Reopening must respect persisted cooldown, not restart paid calls.
  await_open="""async id=>{await window.__cozy.chat.openStory(id)}"""
  page.evaluate(await_open,story);page.wait_for_timeout(700)
  assert len(calls)==2,(len(calls),errors)
  # Advance browser time only. Existing health timer must resume without a button.
  mode[0]='good'
  page.clock.fast_forward(61000)
  for _ in range(100):
   page.clock.run_for(300)
   result=page.evaluate(snapshot,story)
   if not result.get('pending') and not result['working'] and 'all-well' in result['lamp']:break
   page.wait_for_timeout(50)
  assert len(calls)==3,(len(calls),result,errors)
  assert not result.get('pending'),result
  assert result['kept']['complete'] and result['kept']['upTo']==48,result
  assert not result['shelf']['essentials']['unfinished'],result
  assert 'all-well' in result['lamp'],result
  assert result['pages']==49
  assert not errors,errors
  print(json.dumps({'result':'pass','initialRejectedCalls':2,'cooldownAndReopenCalls':0,'idleRecoveryCalls':1,'lamp':'green only after saved completion','sourcePagesPreserved':49,'liveCalls':0}))
  browser.close()
finally:server.shutdown()
