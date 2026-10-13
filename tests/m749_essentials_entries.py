#!/usr/bin/env python3
"""Per-entry Essentials through the real scheduler, drawer and storyteller."""
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
  page=browser.new_page(service_workers='block');errors=[]
  page.on('pageerror',lambda error:errors.append(str(error)))
  page.route('https://**/*',lambda route:route.abort())
  page.goto(f'http://127.0.0.1:{server.server_port}/');page.wait_for_function('!!window.__cozy?.chat')
  if page.locator('#welcome-overlay').is_visible():page.locator('#btn-welcome-enough').click()
  page.clock.install()
  page.evaluate(r"""()=>{
   const realFetch=window.fetch.bind(window),encoder=new TextEncoder();window.__requests=[];window.__hold=false;
   window.fetch=async(input,options={})=>{
    const url=typeof input==='string'?input:input.url;
    if(!url.includes('/fixture-provider/'))return realFetch(input,options);
    const body=JSON.parse(options.body),source=body.messages.find(m=>m.role==='user')?.content || '';
    const found=[...source.matchAll(/ENTRY_(\d+)_SOURCE/g)];
    if(found.length!==1)throw Error('Essentials must read exactly one detailed record entry.');
    const index=Number(found[0][1]),range=source.match(/\(pages ([\d–]+)\)/)[1];
    window.__requests.push({index,body,at:Date.now()});
    const fact=source.match(/ENTRY_\d+_SOURCE\. ([\s\S]+?) DETAIL_START/)[1];
    const text='- [Day '+(index+1)+', chapel] (pages '+range+') ENTRY_'+index+'_CONCISE. '+fact+' '+Array.from({length:12},(_,i)=>'Continuity '+i+': '+fact).join(' ');
    const stream=new ReadableStream({start(controller){
     let finished=false,timer;
     options.signal?.addEventListener('abort',()=>{if(!finished){finished=true;clearTimeout(timer);controller.error(options.signal.reason);}},{once:true});
     if(window.__hold)return;
     timer=setTimeout(()=>{if(finished)return;finished=true;
      controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\n'));
      controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'));controller.close();
     },50);
    }});
    return new Response(stream,{status:200,headers:{'Content-Type':'text/event-stream'}});
   };
  }""")
  story=page.evaluate("""async()=>{
   const {db}=await import('/js/store.js');
   for(const [key,value] of Object.entries({memoryKeeper:false,continuousAudit:false,continuityCheck:false,worldAgent:false,refereeOn:false,smartRecall:false,canonVerify:false,sensorsOn:false,directorOn:false,editorOn:false}))await db.settings.set(key,value);
   const connection=await db.connections.add({label:'Fixture',type:'openai',baseUrl:location.origin+'/fixture-provider/v1',apiKey:'fixture',model:'fixture',contextSize:200000,maxTokens:32000,reasoning:{effort:'off'}});
   let story=await db.stories.create({title:'Fifteen detailed sections, fifteen concise counterparts',brief:'A conditional promise, a late correction and an unresolved obligation.'});
   await db.stories.update(story.id,{connectionId:connection.id,briefMode:'manual',choices:false,extraction:false,keeper:false,continuity:false,world:false,audit:false});story=await db.stories.get(story.id);
   const facts=Array.from({length:15},(_,i)=>i===13?'The late correction establishes that Ivo sent the letter, not Neri; Mara knows its location while Neri knows only that it exists.':i===14?'Mara still owes the report before sunset; Neri must return the key before Mara will help; the missing brother leaves that promise unresolved.':'Neri and Mara met at the chapel on day '+(i+1)+'; returning the copper key built trust; Mara promised help only if Neri found her brother.');
   for(let i=0;i<48;i++)await db.messages.append(story.id,{id:story.id+':page'+i,ts:1000+i,role:'assistant',text:facts[Math.min(14,Math.floor(i/3))]+' Original page '+i+'.'});
   const pages=await db.messages.list(story.id),{sourceBindings}=await import('/js/assemble/selection.js');
   const nodes=facts.map((fact,i)=>{const span=[i*3,i===14?47:i*3+2];return {id:'record'+i,span,level:2,text:'[Day '+(i+1)+', chapel] ENTRY_'+i+'_SOURCE. '+fact+' DETAIL_START',detail:Array.from({length:26},(_,k)=>'Witness '+k+': '+fact).join(' '),sourcePages:sourceBindings(pages.slice(span[0],span[1]+1))};});
   await db.settings.set('memory:'+story.id,{nodes});window.__sourceRecord=JSON.stringify(nodes);
   const {emptyState,saveState,loadState}=await import('/js/engine/state.js');let state=emptyState();state.page=47;state.readTo=47;await saveState(story.id,state);state=await loadState(story.id);
   const {ledgerVerificationRows,ledgerRepairInputKey,ledgerRepairStateKey,ledgerAuditVerified}=await import('/js/agents/auditprogress.js');
   state.audit={at:Date.now(),coverage:{read:48,total:48},verifiedInput:ledgerRepairInputKey(state,story,pages),verification:{source:ledgerRepairInputKey({},story,pages),ledger:ledgerRepairStateKey(state),entries:Object.fromEntries(ledgerVerificationRows(state).map(r=>[r.id,{print:r.print,scope:r.scope,status:'correct',why:'Unrelated audit fixture approved.'}]))}};
   await saveState(story.id,state);if(!ledgerAuditVerified(await loadState(story.id),story,pages))throw Error('Fixture ledger must already be complete.');
   const {runEssentials,PENDING_KEY,sourcePrint}=await import('/js/agents/essentials.js');
   try{await runEssentials({connection,storyId:story.id,nodes,brief:story.brief,mc:'the player',callLLM:()=>{throw Object.assign(Error('fixture stop'),{name:'AbortError'});}});}catch(e){if(e.name!=='AbortError')throw e;}
   const pending=await db.settings.get(PENDING_KEY(story.id));
   await db.settings.set(PENDING_KEY(story.id),{...pending,repairPolicy:8,plan:[{lines:nodes,print:sourcePrint(nodes)}],outcome:'blocked',validationRounds:4,nextAt:Date.now()+900000,why:'over its allocated room'});
   const {noteWorkerRun}=await import('/js/agents/status.js');await noteWorkerRun(story.id,'keeper',{ok:true,detail:'All detailed entries already saved.'});
   await window.__cozy.chat.openStory(story.id);return story.id;
  }""")
  snapshot="""async id=>{const {db}=await import('/js/store.js'),{loadEssentialsView}=await import('/js/agents/essentials.js'),{workIsRunning}=await import('/js/agents/queue.js');return {view:await loadEssentialsView(id),shelf:await db.settings.get('workers:'+id),working:workIsRunning(id),lamp:document.getElementById('btn-ledger').className,calls:window.__requests.map(r=>r.index)};}"""
  def settle(predicate,steps=350):
   for _ in range(steps):
    result=page.evaluate(snapshot,story)
    if predicate(result):return result
    page.clock.run_for(50);page.wait_for_timeout(15)
   raise AssertionError({'outcome':result['view'].get('pending',{}),'calls':result['calls'],'lamp':result['lamp'],'errors':errors})
  progress=settle(lambda r:(r['view'].get('pending') or {}).get('outcome')=='yielded' and len(r['view']['progress'])==12)
  assert progress['calls']==list(range(12)) and not progress['view'].get('snapshot')
  assert progress['view']['pending']['attempts']==0
  page.evaluate('()=>window.__cozy.drawer.open()');page.clock.run_for(100);page.locator('.drawer-rooms [data-room="books"]').click()
  panel=page.locator('[data-panel="the-essentials"]')
  if 'folded' in panel.get_attribute('class'):panel.locator('h3').click()
  page.clock.run_for(100);page.wait_for_timeout(100)
  assert '12 of 15 concise record sections saved' in panel.inner_text(),panel.inner_text()
  assert 'ENTRY_0_CONCISE' in panel.inner_text(),panel.inner_text()
  # Reopening the story during the idle yield preserves the twelve saved entries.
  page.evaluate('async id=>window.__cozy.chat.openStory(id)',story)
  final=settle(lambda r:r['view'].get('current') and not r['view'].get('pending') and not r['working'] and 'all-well' in r['lamp'])
  assert final['calls']==list(range(15)),final['calls']
  saved=final['view']['snapshot'];assert len(saved['text'])>17000 and len(saved['parts'])==15
  assert 'Ivo sent the letter, not Neri' in saved['text'] and 'Mara still owes the report before sunset' in saved['text']
  assert final['shelf']['essentials']['ok'] and not final['shelf']['essentials']['unfinished']
  assert page.evaluate('async id=>JSON.stringify((await (await import("/js/store.js")).db.settings.get("memory:"+id)).nodes)===window.__sourceRecord',story)
  assembly=page.evaluate("""async id=>{const {db}=await import('/js/store.js'),{buildRequest}=await import('/js/assemble/stack.js'),{renderMemory}=await import('/js/agents/memory.js'),{loadEssentials}=await import('/js/agents/essentials.js'),{measureTransport}=await import('/js/providers/measure.js');const story=await db.stories.get(id),state=await db.settings.get('state:'+id),memory=await db.settings.get('memory:'+id),pages=await db.messages.list(id),kept=await loadEssentials(id),conn=(await db.connections.list()).find(c=>c.id===story.connectionId);const out=buildRequest({story,state,messages:pages,settings:{frameOn:false,refereeOn:false},modules:[],memory:renderMemory(memory,Infinity),smallEssentials:kept,window:{keeperOn:true,window:10,nodes:memory.nodes,recordThrough:pages.length,budgetTokens:200000,answerTokens:5000},transportMeasure:req=>measureTransport(conn,req)});return {selected:out.selection.essentials,whole:(out.systemBlocks.map(b=>b.text).join(' ')+out.messages.map(m=>m.content).join(' ')).includes(kept.text)};}""",story)
  assert assembly['selected'] and assembly['whole'],assembly
  page.evaluate('()=>window.__cozy.drawer.open()');page.clock.run_for(200);page.locator('.drawer-rooms [data-room="books"]').click()
  panel=page.locator('[data-panel="the-essentials"]')
  if 'folded' in panel.get_attribute('class'):panel.locator('h3').click()
  page.clock.run_for(200);page.wait_for_timeout(100)
  assert 'The current story essentials' in panel.inner_text() and 'ENTRY_14_CONCISE' in panel.inner_text(),panel.inner_text()
  page.evaluate('async id=>window.__cozy.chat.openStory(id)',story);page.clock.run_for(2000);page.wait_for_timeout(100)
  reopened=page.evaluate(snapshot,story);assert reopened['calls']==list(range(15)) and reopened['view']['current'] and 'all-well' in reopened['lamp']
  # A deliberate Stop on a changed entry is respected on reopen, and the
  # previously accepted collection stays visible while the edit is unfinished.
  page.evaluate("""async id=>{window.__hold=true;const {db}=await import('/js/store.js');const memory=await db.settings.get('memory:'+id);memory.nodes[4].detail+=' A new witness confirms the deadline.';await db.settings.set('memory:'+id,memory);await window.__cozy.chat.openStory(id);}""",story)
  settle(lambda r:len(r['calls'])==16 and r['working'])
  page.evaluate('async id=>(await import("/js/agents/queue.js")).stopWork(id)',story)
  stopped=settle(lambda r:not r['working'] and r['shelf'].get('essentials',{}).get('detail')=='stopped by hand')
  assert stopped['view']['snapshot']['text']==saved['text'] and not stopped['view']['eligible']
  page.evaluate('async id=>window.__cozy.chat.openStory(id)',story);page.clock.run_for(65000);page.wait_for_timeout(100)
  assert len(page.evaluate(snapshot,story)['calls'])==16
  assert not errors,errors
  print(json.dumps({'result':'pass','sourcePages':48,'detailedEntries':15,'conciseEntries':15,'acceptedChars':len(saved['text']),'initialRequests':15,'oneEntryPerRequest':True,'automaticQuotaContinuation':True,'partialProgressDisplayed':True,'completeCollectionSavedDisplayedSelectedAndGreen':True,'unchangedReopenNoCall':True,'stopRespected':True,'originalRecordsUnchanged':True,'simulatedStreamedReplies':True,'liveCalls':0}))
  browser.close()
finally:server.shutdown()
