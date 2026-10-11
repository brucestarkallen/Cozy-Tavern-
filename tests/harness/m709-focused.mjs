import './idb-shim.mjs';
import assert from 'node:assert/strict';
import {db} from '../../js/store.js';
import {emptyState,saveState,loadState} from '../../js/engine/state.js';
import {applyMutations} from '../../js/engine/apply.js';
import {auditLedger,bindAuditEvidence,completeAuditCheckReply,verifyLedgerChecks,auditView,finalAuditorScope,manualRepairConflict} from '../../js/agents/auditor.js';
import {auditSources} from '../../js/agents/auditsources.js';
import {auditEvidenceBook,auditEvidencePassages} from '../../js/agents/auditevidence.js';
import {ledgerVerificationRows,ledgerAuditVerified,reusableAuditCheckpoint,auditCheckpointStart} from '../../js/agents/auditprogress.js';
import {fingerprint36} from '../../js/engine/fingerprint.js';


const cast="Neri was once a royal guardian. Neri has dark hair and handsome features. Valen is Neri's blonde public face. Elin is queen of the north, calculating and blunt, with purple hair.";
const prose='Neri waited alone at the gate. Elin remained in her northern chambers.';
const {id}=await db.stories.create({title:'Durable auditor scratchbook',castNotes:cast});
await db.messages.append(id,{role:'assistant',text:prose,ts:1});
const story=await db.stories.get(id),pages=await db.messages.list(id),documents=auditSources({castNotes:cast,messages:pages});
const writer=documents.find(d=>d.id.startsWith('cast:'));
const oldId='source:'+fingerprint36(writer.id+':0:'+cast);
let state={...emptyState(),sheet:{actors:{},playerName:'Neri',playerAliases:['Valen']},place:{name:'the gate'},
  present:[{name:'Neri',position:'at the gate'}],characters:{Neri:{core:'A traveler who formerly guarded the royal house; keeps a raven and two faces.',state:'Waiting.'},
    Elin:{core:'Queen of the north; shrewd and plain spoken.',state:'Resting.'}},
  relationships:{Elin:{p:60,r:50,s:0,history:[]}},
  auditSources:Object.fromEntries(documents.map(d=>[d.id,{mark:d.mark,appearanceReviewed:true,profileReviewed:1,people:d.id===writer.id?[
    {name:'Neri',shown:'Neri has dark hair and handsome features.',facts:[{key:'hair',value:'dark',shown:'Neri has dark hair and handsome features.'},
      {key:'features',value:'handsome',shown:'Neri has dark hair and handsome features.'},{key:'hair',value:'blonde',shown:"Valen is Neri's blonde public face."}],
      identityFacts:[{text:'Was once a royal guardian.',shown:'Neri was once a royal guardian.'}]},
    {name:'Elin',shown:'Elin is queen of the north, calculating and blunt, with purple hair.',facts:[{key:'hair',value:'purple',shown:'Elin is queen of the north, calculating and blunt, with purple hair.'}],
      identityFacts:[{text:'calculating and blunt',shown:'Elin is queen of the north, calculating and blunt, with purple hair.'}]},
  ]:[]}]))};
state=applyMutations(state,[{type:'canon.lock',name:'Neri',key:'hair',value:'dark in his own face; blonde in Valen',evidenceId:oldId,shown:cast},
  {type:'canon.lock',name:'Neri',key:'build',value:'handsome features'},
  {type:'canon.lock',name:'Neri',key:'eyes',value:'grey',byHand:true}]).state;
await saveState(id,state);state=await loadState(id);
let calls=0;const prior=globalThis.fetch;
globalThis.fetch=async(_,options)=>{
  const body=JSON.parse(options.body),content=body.messages.map(m=>String(m.content)).join('\n');
  assert(content.includes('FINAL REVIEW CONTRACT'),'Only the final semantic review calls the provider.');
  calls++;
  const rows=JSON.parse(content.split('REQUIRED CURRENT LEDGER CHECKS:\n')[1].split('\n')[0]);
  let reply;
  if(calls===1) {
    // Actual live shape: identityFacts + inCore, no redundant identity arrays.
    // Unknown old source ids on an appearance write no longer block the auditor.
    reply={standings:[],checks:rows.map(r=>({id:r.id,status:'correct',why:'Original sources and complete saved meaning agree.',
      ...(r.section==='characters'?{identityFacts:(r.value.identitySources || []).map(f=>({text:f.text,inCore:true,evidenceId:f.id})),
        ...(r.name==='Elin'?{physicalFacts:[{key:'hair',value:'long purple',evidenceId:'source:old-unavailable'}]}:{})}:{}),
    }))};
  }else{
    assert.equal(calls,2,'There is one request per review, no identity format continuation.');
    reply={issues:[],review:{status:'complete',why:'Reviewed every required entry; no further discrepancy.',open:[]}};
  }
  const answer=JSON.stringify(reply);
  return new Response(body.stream?'data: '+JSON.stringify({choices:[{delta:{content:answer}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n':JSON.stringify({choices:[{message:{content:answer},finish_reason:'stop'}]}));
};
try {
  const connection={type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'m',preset:'custom',contextSize:64000};
  const first=await auditLedger({storyId:id,castNotes:cast,reviewSources:'all',connection});
  const done=await loadState(id);
  assert.deepEqual(first.pending,[]);assert(ledgerAuditVerified(done,story,pages));assert.equal(calls,1);
  assert.equal(done.audit.finalReview.calls,1);assert(!done.audit.finalReview.formatContinuation);
  assert.equal(done.canon.Elin.facts[0].value,'long purple');
  assert.deepEqual(done.canon.Neri,state.canon.Neri);assert.deepEqual(done.characters,state.characters);
  assert.deepEqual(done.relationships,state.relationships);assert.deepEqual(await db.messages.list(id),pages);
  const write=done.journal.find(j=>j.m?.evidenceId==='source:old-unavailable');
  assert(write?.m?.evidenceNote);assert.equal(write.m.shown,'','Never invent a replacement quotation.');
  assert(write.m.sourceRefs.includes(writer.id));
  const kept=reusableAuditCheckpoint(done,story,documents);
  assert(kept.entries['characters:Neri'] && kept.entries['characters:Elin']);
  // Reopen the two exact profiles without changing story prose; the concise
  // whole-review verdict closes them together instead of echoing all atoms.
  const partial={...done,audit:{...done.audit,checkpoint:{...done.audit.checkpoint,entries:{}},verification:{...done.audit.verification,entries:{}}}};
  await saveState(id,partial);
  const second=await auditLedger({storyId:id,castNotes:cast,reviewSources:'all',connection});
  const closed=await loadState(id);
  assert.deepEqual(second.pending,[]);assert(ledgerAuditVerified(closed,story,pages));
  assert.equal(closed.audit.finalReview.calls,1);assert.equal(closed.audit.finalReview.approval,'whole required ledger');
  assert.equal(calls,2);assert.deepEqual(closed.canon,done.canon);
  const pose=ledgerVerificationRows(closed).find(r=>r.id==='presence:Neri');
  const concurrent={...closed,present:[{name:'Neri',position:'A newer manual pose.'}]};
  const checked=verifyLedgerChecks({state:concurrent,snapshot:closed,approvedState:closed,checks:[{id:pose.id,print:pose.print,status:'correct',why:'Reviewed.'}],documents,source:'s',authoritative:true});
  assert(!checked.entries[pose.id],'Newer unreviewed work cannot borrow the final approval.');
  assert(manualRepairConflict({...closed,page:40},{type:'canon.lock',name:'Neri',key:'hair color',value:'red'},40)===false);
  assert(manualRepairConflict({...closed,page:40},{type:'canon.lock',name:'Neri',key:'eye color',value:'blue'},40),'Earlier manual appearance ownership persists across later pages.');
  const rejected=[];
  const scoped=finalAuditorScope([{what:'Writer eye change',mutations:[{type:'canon.lock',name:'Neri',key:'eyes',value:'red',byHand:true}]}],closed,{pageAt:40,rejected});
  assert.equal(scoped[0].mutations.length,0);assert(rejected[0].why.includes('writer explicitly controls'));
  const mcRow=ledgerVerificationRows(closed).find(r=>r.id==='characters:Neri');
  const open=verifyLedgerChecks({state:closed,snapshot:closed,approvedState:closed,checks:[{id:mcRow.id,print:mcRow.print,status:'open',why:'Need an original source.'}],documents,source:'s',authoritative:true});
  assert(!open.entries[mcRow.id],'An explicit unfinished verdict never becomes green.');
  console.log('PASS: actual identityFacts/inCore reply closes in one call; unavailable old source id does not block an approved repair or fabricate a quote; compact whole-review verdict closes all required entries in one call; manual ownership, newer writes, biographies, prose and earned scores remain protected. Mocked provider only.');
}finally{globalThis.fetch=prior;}
