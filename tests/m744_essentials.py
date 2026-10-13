#!/usr/bin/env python3
"""One disposable Chromium workflow: real accepted snapshot, visible replacement,
automatic quota continuation, honest failure and owner Stop. Simulated SSE only."""
import functools,json,os,re,threading
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
  page=browser.new_page(service_workers='block');errors=[];calls=[];mode=['good'];held=[]
  page.on('pageerror',lambda error:errors.append(str(error)))
  page.route('https://**/*',lambda route:route.abort())
  def answer(route):
   if route.request.method!='POST':route.fulfill(status=200,content_type='application/json',body='{"data":[]}');return
   body=route.request.post_data_json
   if 'You condense the record of a long collaborative story' not in json.dumps(body):
    route.fulfill(status=200,content_type='application/json',body='{"choices":[{"message":{"content":"{}"},"finish_reason":"stop"}]}');return
   calls.append(body)
   if mode[0]=='hold':held.append(route);return
   user=next(m['content'] for m in body['messages'] if m['role']=='user')
   ids=sorted(set(int(i) for i in re.findall(r'SOURCE_(\d+)_KEEP',user)))
   text='Not a usable candidate.' if mode[0]=='bad' else '\n'.join('- [Dawn, chapel] (pages '+str(i+1)+' to '+str(i+1)+') SOURCE_'+str(i)+'_KEEP. Neri owes Mara help only after her brother returns; trust grew because Neri returned the key. The late correction names Ivo as messenger; the unopened letter must leave before sunset.' for i in ids)
   payload='data: '+json.dumps({'choices':[{'delta':{'content':text}}]})+'\n\n'
   payload+='data: '+json.dumps({'choices':[{'delta':{},'finish_reason':'stop'}]})+'\n\ndata: [DONE]\n\n'
   route.fulfill(status=200,content_type='text/event-stream',body=payload)
  page.route('**/fixture-provider/**',answer)
  page.goto(f'http://127.0.0.1:{server.server_port}/');page.wait_for_function('!!window.__cozy?.chat')
  if page.locator('#welcome-overlay').is_visible():page.locator('#btn-welcome-enough').click()
  page.clock.install()
  story=page.evaluate("""async()=>{
   const {db}=await import('/js/store.js');
   for(const [key,value] of Object.entries({memoryKeeper:false,continuityCheck:false,worldAgent:false,auditOn:false,continuousAudit:false,refereeOn:false,smartRecall:false,canonVerify:false,sensorsOn:false,directorOn:false,editorOn:false}))await db.settings.set(key,value);
   const connection=await db.connections.add({label:'Fixture',type:'openai',baseUrl:location.origin+'/fixture-provider/v1',apiKey:'fixture',model:'fixture',contextSize:16000,maxTokens:5000,reasoning:{effort:'off'}});
   let story=await db.stories.create({title:'Essentials availability and continuation'});
   await db.stories.update(story.id,{connectionId:connection.id,briefMode:'manual',brief:'',choices:false,extraction:false,keeper:false,continuity:false,world:false,audit:false});story=await db.stories.get(story.id);
   const {sourceBindings}=await import('/js/assemble/selection.js');
   const nodes=[];
   for(let i=0;i<13;i++){
    const text='[Dawn, chapel] SOURCE_'+i+'_KEEP. Neri promised Mara help only after her brother returns; trust grew after the key came home. Ivo was the messenger, and the letter must leave before sunset.';
    await db.messages.append(story.id,{id:story.id+':p'+i,ts:1000+i,role:'assistant',text});
    const pages=await db.messages.list(story.id);
    nodes.push({id:'n'+i,span:[i,i],text:text+' '+('Incidental weather with no later consequence. '.repeat(185)),level:1,sourcePages:sourceBindings([pages[i]])});
   }
   const {emptyState,saveState,loadState}=await import('/js/engine/state.js');
   let state=emptyState();state.page=12;state.readTo=12;await saveState(story.id,state);state=await loadState(story.id);
   const {runEssentials,loadEssentials}=await import('/js/agents/essentials.js');
   await db.settings.set('memory:'+story.id,{nodes:nodes.slice(0,1)});
   const accepted=await runEssentials({connection,storyId:story.id,nodes:nodes.slice(0,1),mc:'the player'});
   if(!accepted.wrote || !(await loadEssentials(story.id)))throw Error('Fixture did not create a real accepted version.');
   window.__m744Prior=await db.settings.get('essentials:'+story.id);
   nodes[0]={...nodes[0],id:'repacked-prefix',level:2};
   await db.settings.set('memory:'+story.id,{nodes});window.__m744Nodes=nodes;
   const {ledgerVerificationRows,ledgerRepairInputKey,ledgerRepairStateKey,ledgerAuditVerified}=await import('/js/agents/auditprogress.js');
   const pages=await db.messages.list(story.id),rows=ledgerVerificationRows(state);
   state.audit={at:Date.now(),coverage:{read:13,total:13},verifiedInput:ledgerRepairInputKey(state,story,pages),verification:{source:ledgerRepairInputKey({},story,pages),ledger:ledgerRepairStateKey(state),entries:Object.fromEntries(rows.map(r=>[r.id,{print:r.print,scope:r.scope,status:'correct',why:'Unrelated audit fixture approved.'}]))}};
   await saveState(story.id,state);if(!ledgerAuditVerified(await loadState(story.id),story,pages))throw Error('Invalid unrelated audit fixture.');
   const {noteWorkerRun}=await import('/js/agents/status.js');await noteWorkerRun(story.id,'keeper',{ok:true,detail:'Fixture record complete.'});
   await window.__cozy.chat.openStory(story.id);return story.id;
  }""")
  snapshot="""async id=>{const {db}=await import('/js/store.js');const {workIsRunning}=await import('/js/agents/queue.js');return {pending:await db.settings.get('essentialsPending:'+id),kept:await db.settings.get('essentials:'+id),shelf:await db.settings.get('workers:'+id),working:workIsRunning(id),lamp:document.getElementById('btn-ledger').className,pages:(await db.messages.list(id)).length};}"""
  def settle(condition,steps=80,advance=10):
   for _ in range(steps):
    result=page.evaluate(snapshot,story)
    if condition(result):return result
    page.clock.run_for(advance);page.wait_for_timeout(20)
   raise AssertionError({'pending':{k:(result.get('pending') or {}).get(k) for k in ['outcome','cursor','attempts','why']},'worker':result['shelf'].get('essentials'),'working':result['working'],'lamp':result['lamp'],'calls':len(calls),'errors':errors})
  result=settle(lambda r:(r.get('pending') or {}).get('outcome')=='yielded' and not r['working'])
  assert len(calls)==13,(len(calls),result)
  assert result['pending']['attempts']==0 and len(result['pending']['parts'])==12,result
  assert page.evaluate('prior=>JSON.stringify(prior)===JSON.stringify(window.__m744Prior)',result['kept'])
  assert not re.search(r'answer 0|15 minutes',result['shelf']['essentials']['detail']),result
  page.evaluate('()=>window.__cozy.drawer.open()');page.clock.run_for(300)
  page.locator('.drawer-rooms [data-room="books"]').click()
  panel=page.locator('[data-panel="the-essentials"]')
  if 'folded' in panel.get_attribute('class'):panel.locator('h3').click()
  for _ in range(20):
   if 'Previous accepted version' in panel.inner_text():break
   page.clock.run_for(10);page.wait_for_timeout(20)
  assert panel.locator('.essentials-row').first.is_visible(),panel.inner_text()
  assert 'SOURCE_0_KEEP' in panel.inner_text() and 'Previous accepted version' in panel.inner_text(),panel.inner_text()
  assert 'Not made yet' not in panel.inner_text()
  page.clock.run_for(300)
  assert 'all-well' not in page.evaluate(snapshot,story)['lamp']
  # Actual idle scheduler resumes after yielding, without a click or story page.
  page.clock.fast_forward(2000)
  result=settle(lambda r:not r.get('pending') and not r['working'] and 'all-well' in r['lamp'],advance=50)
  assert len(calls)==14,(len(calls),result)
  assert not result['shelf']['essentials']['unfinished'] and result['kept']['upTo']==12,result
  page.clock.run_for(2000);page.wait_for_timeout(150)
  for _ in range(20):
   if 'current story essentials' in panel.inner_text().lower():break
   page.clock.run_for(50);page.wait_for_timeout(20)
  assert 'current story essentials' in panel.inner_text().lower() and panel.locator('.essentials-row').count()==13,panel.inner_text()
  assert result['pages']==13
  # Rejected forced regeneration retains the real panel and stays unfinished.
  mode[0]='bad';before_failure=len(calls)
  page.evaluate('()=>{window.__cozy.chat.remakeEssentials()}')
  result=settle(lambda r:(r.get('pending') or {}).get('outcome')=='failed' and not r['working'])
  assert len(calls)==before_failure+3 and not result['pending']['parts'],result
  page.clock.run_for(2000);page.wait_for_timeout(150)
  assert 'Previous accepted version' in panel.inner_text() and panel.locator('.essentials-row').count()==13,panel.inner_text()
  assert 'all-well' not in page.evaluate(snapshot,story)['lamp']
  # Stop the actual in-flight queue job; neither idle wake nor reopen restarts it.
  mode[0]='hold';page.evaluate('()=>{window.__cozy.chat.remakeEssentials()}')
  for _ in range(50):
   if held:break
   page.wait_for_timeout(20)
  assert held,'fixture did not start the stopped request'
  page.evaluate("async id=>{const {stopWork}=await import('/js/agents/queue.js');if(!stopWork(id))throw Error('No live work to stop');}",story)
  for route in held:
   try:route.abort()
   except Exception:pass
  mode[0]='good';result=settle(lambda r:not r['working'] and r['shelf'].get('essentials',{}).get('detail')=='stopped by hand')
  stopped_calls=len(calls);page.clock.fast_forward(61000);page.evaluate('async id=>{await window.__cozy.chat.openStory(id)}',story);page.clock.run_for(800);page.wait_for_timeout(200)
  assert len(calls)==stopped_calls,(len(calls),stopped_calls)
  result=page.evaluate(snapshot,story);assert result['shelf']['essentials']['detail']=='stopped by hand';assert result['kept']['complete'] and result['kept']['upTo']==12
  assert not errors,errors
  print(json.dumps({'result':'pass','initialAcceptedProviderCalls':1,'quotaRoundProviderCalls':12,'automaticContinuationProviderCalls':1,'previousPanelVisibleDuringYieldAndRejection':True,'firstGenerationPlaceholder':False,'greenOnlyAfterPublication':True,'ownerStopSurvivesIdleAndReopen':True,'sourcePagesPreserved':13,'simulatedStreamedReplies':True,'liveCalls':0}))
  browser.close()
finally:server.shutdown()
