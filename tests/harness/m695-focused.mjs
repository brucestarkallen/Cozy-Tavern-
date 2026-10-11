import './idb-shim.mjs';
import assert from 'node:assert/strict';
import {db} from '../../js/store.js';
import {emptyState,saveState,loadState} from '../../js/engine/state.js';
import {worldTurn,worldOwed} from '../../js/agents/world.js';
import {auditLedger,auditRepairChecklist,parseAuditorAnswer} from '../../js/agents/auditor.js';
import {repairRetryCheckpoint,ledgerAuditVerified} from '../../js/agents/auditprogress.js';

const connection={type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'m',preset:'custom',context:64000};
const {id}=await db.stories.create({title:'M695 same-page recovery loop'});
const prose="Azrael retreated across the ground. His shoulder blade found the cold stone of the salle wall. Alexia's woman remained seated two seats behind Alexia. The guards watched at the far wall.";
const voices=[{speaker:'Corven',content:'The third pass was reported.'}];
await db.messages.append(id,{role:'user',text:'The duel continues.',ts:1});
await db.messages.append(id,{role:'assistant',text:prose,voices,ts:2});
const pages=await db.messages.list(id),story=await db.stories.get(id);
const complaint={what:'The guards must be at the far wall.',fix:'Correct the seat.',pendingReason:'legacy newest-page refusal',mutations:[{type:'presence.update',name:'the guards',position:'at the far wall',attire:'—'}]};
const initial={...emptyState(),sheet:{actors:{},playerName:'Azrael'},clock:{minutes:100},place:{name:'the salle'},
  characters:{Captain:{core:'Captain of the guard.'},Corven:{core:'A captain.'},'the guards':{core:'Guards of the salle.'},"Alexia's woman":{core:'Attendant of Alexia.'}},
  present:[{name:'Azrael',position:'not yet at the wall'},{name:'the guards',position:'far wall'},{name:"Alexia's woman",position:'two seats behind Alexia'}],
  offscreen:{Captain:{location:'the gate',activity:'watching the wicket',sinceMinutes:0},Corven:{location:'the hall',activity:'waiting',sinceMinutes:100}},
  relationships:{Corven:{P:60,R:50}},worldBrief:{pressure:['The existing fourth pass.']},
  audit:{coverage:{read:3,total:3},pending:[complaint.what],unresolved:[complaint]}};
await saveState(id,initial);
const checkpointBefore={audit:{pending:['still open'],coverage:{read:171,total:171}}};
const checkpoint=repairRetryCheckpoint(checkpointBefore,checkpointBefore,story,pages);
const rewrittenPages=pages.map(p=>({...p,voices:[{speaker:'new',content:'a worker regenerated this'}]}));
assert.equal(repairRetryCheckpoint({...checkpointBefore,audit:{...checkpointBefore.audit,retryProgress:checkpoint}},checkpointBefore,story,rewrittenPages).stalled,2);
assert.equal(auditRepairChecklist([complaint],initial)[0].targets[0].current.presence.position,'far wall');
assert.equal(parseAuditorAnswer('{"issues":[{"resolved":true,"id":"finding:1","shown":"actual quote","why":"already correct"}]}').resolved[0].id,'finding:1');
const oldFetch=globalThis.fetch;
let worldCalls=0,auditCalls=0;
globalThis.fetch=async(_,opts)=>{
  const body=JSON.parse(opts.body),content=body.messages.map(m=>String(m.content)).join('\n');
  let reply;
  if(content.includes('AUDIT RECOVERY AT THE SAME STORY MOMENT')){
    worldCalls++;
    reply={mutations:[
      {type:'offscreen.confirm',name:'Captain',cause:'Still watching the gate at the current hour.'},
      {type:'offscreen.set',name:'Corven',location:'another town',activity:'invented rerun'},
      {type:'people.set',name:'new prince',field:'core',text:'An unsolicited new person.'},
      {type:'thread.set',title:'extra story',owner:'Captain',next:'invented rerun'},
    ],brief:{pressure:['A regenerated fourth pass.'],voices:[{speaker:'new prince',content:'A regenerated voice.'}]}};
  }else if(content.includes('Find every place the writer STATES'))reply={standings:[]};
  else if(content.includes('REPAIR FOLLOWUP')){
    auditCalls++;
    assert(content.includes('"position":"at the wall"'));
    reply={issues:[]};
  }else{
    auditCalls++;
    reply={issues:[
      {what:'The ending puts Azrael at the wall.',mutations:[{type:'presence.update',name:'Azrael',position:'at the wall',shown:'His shoulder blade found the cold stone of the salle wall.'}]},
      {what:'The guards need their current location.',mutations:[{type:'presence.update',name:'the guards',position:'at the far wall',shown:'The guards watched at the far wall.'}]},
    ]};
  }
  const text=JSON.stringify(reply);
  return new Response(body.stream?'data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n':JSON.stringify({choices:[{message:{content:text},finish_reason:'stop'}]}));
};
try{
  const before=await loadState(id);
  assert.deepEqual(worldOwed(before),['Captain']);
  await worldTurn({connection,storyId:id,assistantText:prose,recoveryTargets:['Captain']});
  const recovered=await loadState(id);
  assert.deepEqual(worldOwed(recovered),[]);
  assert.deepEqual(recovered.offscreen.Corven,before.offscreen.Corven);
  assert.deepEqual(recovered.worldBrief,before.worldBrief);
  assert.deepEqual(recovered.threads,before.threads);
  assert.equal(recovered.characters['new prince'],undefined);
  assert.deepEqual(await db.messages.list(id),pages);
  const result=await auditLedger({connection,storyId:id});
  const final=await loadState(id);
  assert.deepEqual(result.pending,[]);
  assert(ledgerAuditVerified(final,story,pages));
  assert.equal(final.present.find(p=>p.name==='Azrael').position,'at the wall');
  assert.deepEqual(final.relationships,recovered.relationships);
  assert.deepEqual(await db.messages.list(id),pages);
  assert.equal(worldCalls,1);assert.equal(auditCalls,2);
  console.log('PASS focused same-page World recovery, stable retry history, actual-record checklist, placeholder-attire closure, final scene repair, unchanged saved voices/prose/earned scores. Mock replies only; no live-story certification.');
}finally{globalThis.fetch=oldFetch;}
