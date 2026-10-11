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
const oldFetch=globalThis.fetch;let fix=false,extracting=false,calls=0;
globalThis.fetch=async(_,opts)=>{
  const body=JSON.parse(opts.body),content=body.messages.map(m=>String(m.content)).join('\n');
  let reply;
  if(extracting)reply={mutations:[{type:'presence.update',name:'Neri',position:'backing across the quay'}],
    here:[{name:'Neri',at:'at the iron gate',shown:stop},{name:'Mara Vale',at:'beside the pier',wears:'oilskin coat',shown:'Mara Vale, the harbor courier, watched beside the pier in her oilskin coat.'}]};
  else if(content.includes('Find every place the writer STATES'))reply={standings:[]};
  else {
    calls++;
    if(!content.includes('REPAIR FOLLOWUP'))reply={issues:[]}; // Real regression: the first reading misses the error.
    else {
      assert(content.includes(prose),'The final reading receives the whole completed page.');
      const rows=JSON.parse(content.split('REQUIRED CURRENT LEDGER CHECKS:\n')[1].split('\n')[0]);
      const bank=JSON.parse(content.split('ORIGINAL SOURCE PASSAGES FOR REPAIR TARGETS, not summary quotes:\n')[1].split('\n')[0]);
      const evidenceId=bank.find(p=>p.text.includes(stop)).evidenceId;
      const checks=rows.map(row=>({id:row.id,print:row.print,status:fix&&row.id==='presence:Neri'?'repair':'correct',
        evidenceId,why:row.section==='presence'?'Read the last stop; the later attacker action does not move this person.':'All factual fields agree; preserve the valid worker judgments.',
        ...(row.section==='presence'?{position:row.name==='Neri'?'at the iron gate':row.value.position,lastEvidenceId:evidenceId}:{})}));
      reply={checks,issues:fix?[{what:'The saved opening retreat is superseded by the later stop.',evidenceId,
        mutations:[{type:'presence.update',name:'Neri',position:'at the iron gate'}]}]:[]};
    }
  }
  const text=JSON.stringify(reply);
  return new Response(body.stream?'data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n':JSON.stringify({choices:[{message:{content:text},finish_reason:'stop'}]}));
};
const connection={type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'m',preset:'custom',context:64000};
try {
  const missed=await auditLedger({storyId:id,connection});
  const unfinished=await loadState(id);
  assert(missed.unfinished);assert(!ledgerAuditVerified(unfinished,story,pages));
  assert(unfinished.audit.verification.pending.some(p=>p.includes('presence:Neri')));
  assert.equal(repairRetryCheckpoint(initial,unfinished,story,pages).stalled,0,'Entry review is real progress.');
  const beforeCalls=calls;fix=true;
  const repaired=await auditLedger({storyId:id,connection});
  const final=await loadState(id);
  assert.equal(calls-beforeCalls,1,'Resume only unfinished entry checks, no duplicate broad read.');
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
