import './idb-shim.mjs';
import assert from 'node:assert/strict';
import {db} from '../../js/store.js';
import {emptyState,saveState,loadState} from '../../js/engine/state.js';
import {auditLedger} from '../../js/agents/auditor.js';
import {auditSources,parseSourceReview} from '../../js/agents/auditsources.js';
import {sourceAppearanceFacts,reconcileAppearance} from '../../js/agents/appearanceinventory.js';
import {ledgerAuditVerified} from '../../js/agents/auditprogress.js';
import {applyMutations} from '../../js/engine/apply.js';

const {id}=await db.stories.create({title:'Absent appearance recovery'});
const cast='Elin is queen of the north. Her hair is purple. Tala is a gardener with black hair.';
const prose='Neri waited alone at the gate. Elin remained in her northern chambers.';
const later='Tala dyed her hair bronze.';
await db.messages.append(id,{role:'user',text:'I wait at the gate.',ts:1});
await db.messages.append(id,{role:'assistant',text:prose,ts:2});
const story=await db.stories.get(id),pages=await db.messages.list(id),documents=auditSources({castNotes:cast,messages:pages});
const castDoc=documents.find(d=>d.id.startsWith('cast:'));
const review={checked:[castDoc.id],people:[
  {name:'Elin',source:castDoc.id,shown:'Elin is queen of the north.',facts:[{key:'hair',value:'purple',shown:'Elin is queen of the north. Her hair is purple.'}]},
  {name:'Tala',source:castDoc.id,shown:'Tala is a gardener with black hair.',facts:[{key:'hair',value:'black',shown:'Tala is a gardener with black hair.'}]},
]};
const parsed=parseSourceReview(JSON.stringify(review),[castDoc]);
assert.equal(parsed[castDoc.id].appearanceReviewed,true);
assert.deepEqual(parseSourceReview(JSON.stringify({...review,people:[{...review.people[0],facts:undefined}]}),[castDoc]),{},'Old identity-only output is not appearance coverage.');
assert.deepEqual(parseSourceReview(JSON.stringify({...review,people:[{...review.people[0],facts:[{key:'hair',value:'red',shown:'Elin has red hair.'}]}]}),[castDoc]),{},'Invented evidence cannot enter the source inventory.');
let state={...emptyState(),sheet:{actors:{},playerName:'Neri'},place:{name:'the gate'},present:[{name:'Neri',position:'at the gate'}],
  characters:{Elin:{core:'Queen of the north.'},Tala:{core:'Gardener.'}},offscreen:{Elin:{location:'northern chambers',activity:'resting'}},
  relationships:{Elin:{p:60,r:50,s:0,history:[]}},
  // An old identity receipt must be reread once for appearance, never certified as complete.
  auditSources:Object.fromEntries(documents.map(d=>[d.id,{mark:'1:old',people:[]}]))};
state=applyMutations(state,[{type:'canon.lock',name:'Tala',key:'hair',value:'green',byHand:true}]).state;
await saveState(id,state);state=await loadState(id);
let sourceCalls=0,finalCalls=0;const oldFetch=globalThis.fetch;
globalThis.fetch=async(_,opts)=>{
  const body=JSON.parse(opts.body),content=body.messages.map(m=>String(m.content)).join('\n');let reply;
  if(content.includes('SOURCE DOCUMENTS\n')){
    sourceCalls++;const batch=JSON.parse(content.split('SOURCE DOCUMENTS\n')[1]);
    reply={checked:batch.map(d=>d.id),people:review.people.filter(p=>batch.some(d=>d.id===p.source))};
  }else if(content.includes('Find every place the writer STATES'))reply={standings:[]};
  else if(!content.includes('REPAIR FOLLOWUP'))reply={issues:[]};
  else {
    finalCalls++;
    const required=JSON.parse(content.split('REQUIRED CURRENT LEDGER CHECKS:\n')[1].split('\n')[0]);
    const bank=JSON.parse(content.split('ORIGINAL SOURCE PASSAGES FOR REPAIR TARGETS, not summary quotes:\n')[1].split('\n')[0]);
    const now=bank.find(p=>p.text.includes(prose));
    if(finalCalls===2)assert.deepEqual(required.map(r=>r.id),['characters:Elin'],'Only the missing appearance review resumes.');
    reply={issues:[],checks:required.map(r=>({id:r.id,status:finalCalls===2&&r.id==='characters:Elin'?'repair':'correct',why:'Original facts reviewed.',shown:cast,
      ...(r.section==='presence'?{position:r.value.position,positionMatches:true,lastEvidenceId:now.evidenceId}:{}),
      ...(r.id==='characters:Tala'?{appearance:r.value.appearanceSources.map(f=>({id:f.id,status:'manual',key:'hair',value:'green',why:'The current manual lock controls her hair.'}))}:{}),
      ...(finalCalls===2&&r.id==='characters:Elin'?{appearance:r.value.appearanceSources.map(f=>({id:f.id,status:'held',key:'hair',value:'purple',why:'The original appearance is now saved.'}))}:{}),
    }))};
    if(finalCalls===2)reply.profiles=[{name:'Elin',facts:[{key:'hair',value:'purple',shown:'Elin is queen of the north. Her hair is purple.'}]}];
  }
  const answer=JSON.stringify(reply);
  return new Response(body.stream?'data: '+JSON.stringify({choices:[{delta:{content:answer}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n':JSON.stringify({choices:[{message:{content:answer},finish_reason:'stop'}]}));
};
try{
  const args={storyId:id,castNotes:cast,reviewSources:'all',connection:{type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'m',preset:'custom',contextSize:64000}};
  const first=await auditLedger(args),partial=await loadState(id);
  assert(first.unfinished&&!ledgerAuditVerified(partial,story,pages),'Blanket approval cannot hide missing hair.');
  assert(partial.audit.verification.pending.some(p=>p.includes('characters:Elin: hair: source fact has not been reconciled')));
  assert.equal(partial.canon.Elin,undefined);
  assert.equal(partial.canon.Tala.facts[0].value,'green');
  const second=await auditLedger(args),done=await loadState(id);
  assert.deepEqual(second.pending,[]);assert(ledgerAuditVerified(done,story,pages));
  assert.equal(done.canon.Elin.facts[0].value,'purple');assert.equal(sourceCalls,1,'Completed physical source reading is reused.');
  assert.equal(finalCalls,2);assert.deepEqual(done.relationships,state.relationships);assert.deepEqual(await db.messages.list(id),pages);
  const inventory=sourceAppearanceFacts(done),elin=inventory.filter(f=>f.name==='Elin');
  const duplicate={...done,auditSources:{...done.auditSources,duplicate:{...parsed[castDoc.id],people:[review.people[0]]}}};
  assert.equal(sourceAppearanceFacts(duplicate).filter(f=>f.name==='Elin').length,1,'Repeated identical facts share one reconciliation.');
  const answer={id:elin[0].id,status:'held',key:'hair',value:'purple',why:'Held.'};
  assert(!reconcileAppearance({...done,canon:{}},'Elin',elin,[answer],documents).ok,'Claimed saved fact must actually exist.');
  const bronze={...done,canon:{...done.canon,Elin:{facts:[{key:'hair',value:'bronze'}]}}};
  const superseded={...answer,status:'superseded',value:'bronze',shown:later,why:'The later dye replaces it.'};
  assert(!reconcileAppearance(bronze,'Elin',elin,[superseded],documents).ok,'Unsupported supersession fails.');
  assert(reconcileAppearance(bronze,'Elin',elin,[superseded],[...documents,{id:'later',text:later}]).ok,'A source-backed current replacement is allowed.');
  console.log('PASS focused appearance recovery: old source receipts reread; unsupported facts refused; blanket green blocked for an absent character; sourced hair repair finishes automatically on the remaining entry; cached source review reused; manual hair, prose and p60/r50 preserved; repeated facts deduplicated; later replacements need evidence. Mocked provider, not the live queen record.');
}finally{globalThis.fetch=oldFetch;}
