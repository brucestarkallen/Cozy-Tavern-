import './idb-shim.mjs';
import assert from 'node:assert/strict';
import {db} from '../../js/store.js';
import {emptyState,saveState,loadState} from '../../js/engine/state.js';
import {auditLedger} from '../../js/agents/auditor.js';
import {extractTurn} from '../../js/agents/extractor.js';
import {ledgerAuditVerified,ledgerRepairInputKey,ledgerVerificationRows,repairRetryCheckpoint} from '../../js/agents/auditprogress.js';

const {id}=await db.stories.create({title:'M698 missed ending position'});
const prose='[the quay | morning | backing across the quay]\n\nNeri backed across the quay. His shoulder reached the iron gate and he stopped there. Mara Vale, the harbor courier, watched beside the pier in her oilskin coat. The attacker lifted his blade again.';
const stop='His shoulder reached the iron gate and he stopped there.';
await db.messages.append(id,{role:'user',text:'I retreat.',ts:1});
await db.messages.append(id,{role:'assistant',text:prose,ts:2});
const initial={...emptyState(),sheet:{actors:{},playerName:'Neri'},place:{name:'the quay'},
  present:[{name:'Neri',position:'backing across the quay'},{name:'Mara Vale',position:'beside the pier',attire:'oilskin coat'}],
  characters:{'Mara Vale':{core:'Harbor courier.'}},relationships:{'Mara Vale':{p:60,r:50,s:0,history:[]}},
  audit:{coverage:{read:2,total:2},pending:[],unresolved:[],unfinished:false}};
await saveState(id,initial);
const pages=await db.messages.list(id),story=await db.stories.get(id);
const legacy={...initial,audit:{...initial.audit,verifiedInput:ledgerRepairInputKey(initial,story,pages)}};
assert(!ledgerAuditVerified(legacy,story,pages),'An empty legacy report cannot certify green.');
const oldFetch=globalThis.fetch;let empty=true,fix=false,extracting=false,calls=0;const requests=[];
globalThis.fetch=async(_,opts)=>{
  const body=JSON.parse(opts.body),content=body.messages.map(m=>String(m.content)).join('\n');
  let reply;
  if(extracting)reply={mutations:[{type:'presence.update',name:'Neri',position:'backing across the quay'}],
    here:[{name:'Neri',at:'at the iron gate',shown:stop},{name:'Mara Vale',at:'beside the pier',wears:'oilskin coat',shown:'Mara Vale, the harbor courier, watched beside the pier in her oilskin coat.'}]};
  else {
    // M708: ONE combined review per audit. M709: a whole-review verdict with explicit
    // open entries replaces per-entry certificates; M710: its scene array is the working
    // ending read, written when it differs from the saved presence.
    calls++;requests.push(content);
    assert(content.includes(prose),'The final reading receives the whole completed page.');
    if(empty)reply={issues:[]}; // Real regression: an empty reading that misses the error and gives no verdict.
    else if(!fix)reply={issues:[],review:{status:'complete',why:'The other entries agree with the page.',
      open:[{id:'presence:Neri',why:'The saved retreat has not been reconciled with the later stop at the iron gate.'}]},standings:[]};
    else reply={scene:[{name:'Neri',ending:{position:'at the iron gate',shown:stop}},{name:'Mara Vale',repair:false,ending:{position:'beside the pier',attire:'oilskin coat'}}],
      issues:[],review:{status:'complete',why:'Read the last stop; the later attacker action does not move this person.',open:[]}};
  }
  const text=JSON.stringify(reply);
  return new Response(body.stream?'data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n':JSON.stringify({choices:[{message:{content:text},finish_reason:'stop'}]}));
};
const connection={type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'m',preset:'custom',context:64000};
try {
  const silent=await auditLedger({storyId:id,connection});
  assert(silent.unfinished,'An empty findings list without a completed verdict cannot certify green.');
  assert.equal(calls,2,'One bounded completion of the same review, no new audit loop.');
  assert.equal((await loadState(id)).audit.verification.read,0);assert(!ledgerAuditVerified(await loadState(id),story,pages));
  empty=false;
  const missed=await auditLedger({storyId:id,connection});
  const unfinished=await loadState(id);
  assert(missed.unfinished);assert(!ledgerAuditVerified(unfinished,story,pages));
  assert(unfinished.audit.verification.pending.some(p=>p.includes('presence:Neri')));
  assert.equal(repairRetryCheckpoint(initial,unfinished,story,pages).stalled,0,'Entry review is real progress.');
  const beforeCalls=calls;fix=true;
  const repaired=await auditLedger({storyId:id,connection});
  const final=await loadState(id);
  assert.equal(calls-beforeCalls,1,'Resume only unfinished entry checks, no duplicate broad read.');
  const resumed=JSON.parse(requests.at(-1).split('REQUIRED CURRENT LEDGER CHECKS:\n')[1].split('\n')[0]).map(r=>r.id);
  assert(resumed.includes('presence:Neri'));assert(!resumed.includes('characters:Mara Vale'),'Approved unchanged entries are not requested again.');
  assert.deepEqual(repaired.pending,[]);assert.equal(final.present[0].position,'at the iron gate');
  assert.equal(final.audit.verification.read,ledgerVerificationRows(final).length);
  assert(ledgerAuditVerified(final,story,pages));
  assert.deepEqual(final.relationships,initial.relationships);assert.deepEqual(await db.messages.list(id),pages);
  assert(!ledgerAuditVerified({...final,worldBrief:{pressure:'changed'}},story,pages),'A changed injected World brief invalidates verification.');
  extracting=true;
  const scene=await extractTurn({connection,state:initial,userText:'I retreat.',assistantText:prose,founding:false});
  assert(scene.mutations.some(m=>m.type==='presence.update'&&m.name==='Neri'&&m.position==='at the iron gate'));
  assert(!scene.mutations.some(m=>m.type==='presence.update'&&m.name==='Neri'&&m.position==='backing across the quay'));
  console.log('PASS missed first reading cannot certify an unreconciled ending; final entry checks repair it; resume avoids repeated broad calls; MC quoted ending supersedes its draft; prose and earned scores preserved. Mock replies, not live model verification.');
}finally{globalThis.fetch=oldFetch;}
