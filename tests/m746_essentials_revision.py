#!/usr/bin/env python3
"""Oversized draft correction through the real idle scheduler in disposable Chromium."""
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
  page=browser.new_page(service_workers='block');errors=[];requests=[]
  page.on('pageerror',lambda error:errors.append(str(error)))
  page.route('https://**/*',lambda route:route.abort())
  def answer(route):
   if route.request.method!='POST':
    route.fulfill(status=200,content_type='application/json',body='{"data":[]}');return
   body=route.request.post_data_json;wire=json.dumps(body);user='\n'.join(m.get('content','') for m in body.get('messages',[]) if m.get('role')=='user')
   if 'You condense the record of a long collaborative story' in wire:
    category='essentials'
    prior=[r for r in requests if r['category']=='essentials']
    if len(prior)<4:
     drafts=[m['content'] for m in body['messages'] if m['role']=='assistant']
     assert drafts and len(drafts[-1])==18000,body
     assert 'over its allocated room' in user
    if len(prior)<3:
     prefix='- [Dawn, chapel] (pages 1 to 3) '
     text=prefix+'x'*(18000-len(prefix)-1)+'.'
    elif len(prior)==3:
     text='- [Dawn, chapel] (pages 1 to 3) Neri met Mara after rescuing her brother; Mara promised help only if Neri returned the copper key; CURRENT_PAGE_EDIT corrects the old account because Ivo sent the letter, not Neri; Mara knows the chest location while Neri knows only that it exists.'
    else:
     text='- [Afternoon, chapel] (pages 4 to 5) The returned key built trust and Mara taught their ritual, tap twice and wait; Mara must send the unopened letter before sunset; Neri owes a report if Mara’s brother returns; MANUAL_UNRELATED_KEEP.'
   elif 'You are a precise narrative-state tracker' in wire:
    category='keeper'
    assert 'CURRENT_PAGE_EDIT' in user and 'STALE_PAGE_FACT' not in user,user
    text='[Noon, chapel] The current source establishes CURRENT_PAGE_EDIT; Mara’s earlier account was corrected, and the unopened letter remains due before sunset.'
   elif 'NONE, or one DETAIL: line.' in wire:
    category='audit';text='NONE'
   else:
    category='other';text='NONE'
   requests.append({'category':category,'body':body,'user':user})
   payload='data: '+json.dumps({'choices':[{'delta':{'content':text}}]})+'\n\n'
   payload+='data: '+json.dumps({'choices':[{'delta':{},'finish_reason':'stop'}]})+'\n\ndata: [DONE]\n\n'
   route.fulfill(status=200,content_type='text/event-stream',body=payload)
  page.route('**/fixture-provider/**',answer)
  page.goto(f'http://127.0.0.1:{server.server_port}/');page.wait_for_function('!!window.__cozy?.chat')
  if page.locator('#welcome-overlay').is_visible():page.locator('#btn-welcome-enough').click()
  page.clock.install()
  story=page.evaluate("""async()=>{
   const {db}=await import('/js/store.js');
   for(const [key,value] of Object.entries({memoryKeeper:false,continuousAudit:false,continuityCheck:false,worldAgent:false,refereeOn:false,smartRecall:false,canonVerify:false,sensorsOn:false,directorOn:false,editorOn:false}))await db.settings.set(key,value);
   const connection=await db.connections.add({label:'Fixture',type:'openai',baseUrl:location.origin+'/fixture-provider/v1',apiKey:'fixture',model:'fixture',contextSize:200000,maxTokens:32000,reasoning:{effort:'off'}});
   let story=await db.stories.create({title:'Recover blocked Essentials',brief:'A conditional promise, a correction and an unopened letter.'});
   await db.stories.update(story.id,{connectionId:connection.id,briefMode:'manual',choices:false,extraction:false,keeper:false,continuity:false,world:false,audit:false});story=await db.stories.get(story.id);
   const source=[
    '[Dawn, chapel] FIRST_MEETING: Neri rescued Mara’s brother, and gratitude became trust.',
    '[Morning, bridge] PROMISE_CONDITION: Mara promised help only if Neri returned the copper key.',
    '[Noon, chapel] CURRENT_PAGE_EDIT: Ivo sent the letter, not Neri; Mara knows the chest location while Neri knows only that it exists.',
    '[Afternoon, chapel] RELATIONSHIP_CHANGE: Neri returned the key, so Mara taught their private ritual, tap twice and wait.',
    '[Evening, chapel] LATEST_OBLIGATION: Mara must send the unopened letter before sunset; Neri still owes a report if her brother returns.'
   ];
   for(let i=0;i<source.length;i++)await db.messages.append(story.id,{id:story.id+':page'+i,ts:1000+i,role:'assistant',text:source[i]});
   const pages=(await db.messages.list(story.id)).filter(p=>!p.hidden);
   const {sourceBindings}=await import('/js/assemble/selection.js');
   const nodes=pages.map((page,i)=>({id:'record'+i,span:[i,i],text:source[i]+' SOURCE_'+i+'_KEEP.',detail:'DETAIL_'+i+'_KEEP.',level:1,sourcePages:sourceBindings([page])}));
   nodes[4]={...nodes[4],text:nodes[4].text+' MANUAL_UNRELATED_KEEP.',verified:{fixed:'the writer'}};
   await db.settings.set('memory:'+story.id,{nodes});
   const {emptyState,saveState,loadState}=await import('/js/engine/state.js');
   let state=emptyState();state.page=4;state.readTo=4;await saveState(story.id,state);state=await loadState(story.id);
   const {ledgerVerificationRows,ledgerRepairInputKey,ledgerRepairStateKey,ledgerAuditVerified}=await import('/js/agents/auditprogress.js');
   const currentPages=await db.messages.list(story.id),rows=ledgerVerificationRows(state),input=ledgerRepairInputKey(state,story,currentPages);
   state.audit={at:Date.now(),coverage:{read:5,total:5},verifiedInput:input,verification:{source:ledgerRepairInputKey({},story,currentPages),ledger:ledgerRepairStateKey(state),entries:Object.fromEntries(rows.map(r=>[r.id,{print:r.print,scope:r.scope,status:'correct',why:'Unrelated audit fixture approved.'}]))}};
   await saveState(story.id,state);if(!ledgerAuditVerified(await loadState(story.id),story,currentPages))throw Error('Fixture audit should already be complete.');
   const {runEssentials,ESSENTIALS_KEY,PENDING_KEY,sourcePrint}=await import('/js/agents/essentials.js');
   try {await runEssentials({connection,storyId:story.id,nodes,brief:story.brief,mc:'the player',callLLM:async()=>{throw Object.assign(new Error('fixture interrupted'),{name:'AbortError'});}});}catch(e){if(e.name!=='AbortError')throw e;}
   const pending=await db.settings.get(PENDING_KEY(story.id)),prefix='- [Dawn, chapel] (pages 1 to 3) ';
   const draft=prefix+'x'.repeat(18000-prefix.length-1)+'.';
   await db.settings.set(PENDING_KEY(story.id),{...pending,repairPolicy:5,phase:'sections',outcome:'failed',attempts:1,nextAt:Date.now()+60000,cursor:0,
    plan:[nodes.slice(0,3),nodes.slice(3)].map(lines=>({lines,print:sourcePrint(lines)})),
    why:'Source section 1 of 2: over its allocated room (answer 18000 characters; available 15200 of the global 16000)',
    diagnostic:{why:'over its allocated room',draft,clipped:true,chars:18000,share:15200,part:1,parts:2}});
   window.__m746Started=Date.now();window.__m746Nodes=structuredClone(nodes);
   const {noteWorkerRun}=await import('/js/agents/status.js');await noteWorkerRun(story.id,'keeper',{ok:true,detail:'Existing source record complete.'});
   await window.__cozy.chat.openStory(story.id);return story.id;
  }""")
  snapshot="""async id=>{const {db}=await import('/js/store.js');const {loadMemory}=await import('/js/agents/memory.js');const {workIsRunning}=await import('/js/agents/queue.js');const {loadEssentialsView}=await import('/js/agents/essentials.js');const {sourceBindingIssues}=await import('/js/assemble/selection.js');const pages=(await db.messages.list(id)).filter(p=>!p.hidden),mem=await loadMemory(id),view=await loadEssentialsView(id);return {pending:await db.settings.get('essentialsPending:'+id),kept:await db.settings.get('essentials:'+id),view,shelf:await db.settings.get('workers:'+id),working:workIsRunning(id),lamp:document.getElementById('btn-ledger').className,pages:pages.length,issues:sourceBindingIssues(mem.nodes,pages),mem};}"""
  def settle(condition,steps=300,advance=50):
   for _ in range(steps):
    result=page.evaluate(snapshot,story)
    if condition(result):return result
    page.clock.run_for(advance);page.wait_for_timeout(15)
   raise AssertionError({'pending':{k:(result.get('pending') or {}).get(k) for k in ['outcome','cursor','attempts','why']},'keeper':result['shelf'].get('keeper'),'essentials':result['shelf'].get('essentials'),'working':result['working'],'issues':result['issues'],'lamp':result['lamp'],'calls':[r['category'] for r in requests],'errors':errors})
  # The old minute cooldown is bypassed. Three rejected edits yield to the
  # queue, then the saved draft is revised again automatically within seconds.
  yielded=settle(lambda r:(r.get('pending') or {}).get('outcome')=='yielded' and not r['working'])
  assert yielded['pending']['attempts']==1 and yielded['pending']['validationRounds']==1,yielded
  assert len(requests)==3 and not yielded.get('kept'),requests
  result=settle(lambda r:not r.get('pending') and r.get('kept',{}).get('complete') and r.get('view',{}).get('eligible') and not r['working'] and 'all-well' in r['lamp'])
  assert page.evaluate('Date.now()-window.__m746Started')<60000
  assert result['view']['current'] and result['issues']==[],result
  assert result['kept']['complete'] and len(result['kept']['text'])<=16000,result['kept']
  assert len(requests)==5 and all(r['category']=='essentials' for r in requests),requests
  assert all(token in result['kept']['text'] for token in ['met Mara after rescuing her brother','only if Neri returned the copper key','tap twice and wait','CURRENT_PAGE_EDIT','Ivo sent the letter, not Neri','unopened letter before sunset','if Mara’s brother returns']),result['kept']
  assert page.evaluate('async id=>JSON.stringify((await (await import("/js/store.js")).db.settings.get("memory:"+id)).nodes)===JSON.stringify(window.__m746Nodes)',story)
  assert result['pending'] is None and not result['shelf']['essentials'].get('unfinished') and result['shelf']['essentials'].get('ok') is True
  # The current request assembler receives the saved result, and the drawer
  # renders it as current rather than showing an empty first-generation panel.
  assembly=page.evaluate("""async id=>{const {db}=await import('/js/store.js');const {buildRequest}=await import('/js/assemble/stack.js');const {loadMemory,renderMemory}=await import('/js/agents/memory.js');const {loadEssentials}=await import('/js/agents/essentials.js');const {measureTransport}=await import('/js/providers/measure.js');const story=await db.stories.get(id),state=await db.settings.get('state:'+id),history=await db.messages.list(id),memory=await loadMemory(id),essentials=await loadEssentials(id),connection=(await db.connections.list()).find(c=>c.id===story.connectionId);const request=buildRequest({story,state,messages:[...history,{id:'next-move',role:'user',text:'Ask Mara about the corrected letter and promise.'}],settings:{frameOn:false,refereeOn:false},modules:[],memory:renderMemory(memory,Infinity),smallEssentials:essentials,window:{keeperOn:true,window:10,nodes:memory.nodes,recordThrough:history.length,budgetTokens:200000,answerTokens:5000},transportMeasure:req=>measureTransport(connection,req)});return {selected:request.selection.essentials,text:request.systemBlocks.map(b=>b.text).join('\\n')+'\\n'+request.messages.map(m=>m.content).join('\\n')}}""",story)
  assert assembly['selected'] and 'CURRENT_PAGE_EDIT' in assembly['text'],assembly
  page.evaluate('()=>window.__cozy.drawer.open()');page.clock.run_for(300);page.locator('.drawer-rooms [data-room="books"]').click()
  panel=page.locator('[data-panel="the-essentials"]')
  if 'folded' in panel.get_attribute('class'):panel.locator('h3').click()
  page.clock.run_for(200);page.wait_for_timeout(100)
  assert 'CURRENT_PAGE_EDIT' in panel.inner_text() and 'Not made yet' not in panel.inner_text(),panel.inner_text()
  # Reopen without changing sources: the summary remains eligible and no
  # duplicate Essentials generation is queued.
  before_reopen=len(requests)
  page.evaluate('async id=>window.__cozy.chat.openStory(id)',story);page.clock.run_for(1000);page.wait_for_timeout(100)
  reopened=page.evaluate(snapshot,story)
  assert reopened['view']['eligible'] and reopened['view']['current'] and reopened['pending'] is None,reopened
  assert len(requests)==before_reopen and [r['category'] for r in requests].count('essentials')==5,[r['category'] for r in requests]
  assert 'all-well' in reopened['lamp'],reopened['lamp']
  assert not errors,errors
  print(json.dumps({'result':'pass','rejectedChars':18000,'oldMinuteCooldownBypassed':True,'savedDraftRevisedAcrossIdleYield':True,'providerRequests':len(requests),'summarySavedDisplayedAndSelected':True,'pendingClearedAndGreen':True,'unchangedReopenNoRequest':True,'sourcesUnchanged':True,'simulatedReplies':True,'liveCalls':0}))
  browser.close()
finally:server.shutdown()
