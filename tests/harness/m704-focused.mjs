import './idb-shim.mjs';
import assert from 'node:assert/strict';
import {db} from '../../js/store.js';
import {emptyState,saveState,loadState} from '../../js/engine/state.js';
import {auditLedger} from '../../js/agents/auditor.js';
import {auditSources,parseSourceReview} from '../../js/agents/auditsources.js';
import {sourceAppearanceFacts} from '../../js/agents/appearanceinventory.js';
import {ledgerAuditVerified} from '../../js/agents/auditprogress.js';
import {applyMutations} from '../../js/engine/apply.js';

const {id}=await db.stories.create({title:'Absent appearance recovery'});
const cast='Elin is queen of the north. Her hair is purple. Tala is a gardener with black hair.';
// The story holds what its audit is handed, as every caller hands it (chat.js: story.brief, story.castNotes; create keeps
// a title only). M752: the audit's receipts name the brief and cast notes it READ.
await db.stories.update(id,{castNotes:cast});
const prose='Neri waited alone at the gate. Elin remained in her northern chambers.';
await db.messages.append(id,{role:'user',text:'I wait at the gate.',ts:1});
await db.messages.append(id,{role:'assistant',text:prose,ts:2});
const story=await db.stories.get(id),pages=await db.messages.list(id),documents=auditSources({castNotes:cast,messages:pages});
const castDoc=documents.find(d=>d.id.startsWith('cast:'));
// M705: a writer source's reading also lists identityFacts (an empty list when none is stated).
const review={checked:[castDoc.id],people:[
  {name:'Elin',source:castDoc.id,shown:'Elin is queen of the north.',identityFacts:[{text:'Queen of the north',shown:'Elin is queen of the north.'}],facts:[{key:'hair',value:'purple',shown:'Elin is queen of the north. Her hair is purple.'}]},
  {name:'Tala',source:castDoc.id,shown:'Tala is a gardener with black hair.',identityFacts:[{text:'Gardener',shown:'Tala is a gardener with black hair.'}],facts:[{key:'hair',value:'black',shown:'Tala is a gardener with black hair.'}]},
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
  }else{
    // M708: ONE combined review per audit. M709: the whole-review verdict is the approval and
    // replaced the per-fact appearance mapping gate, so the recovered source fact must reach the
    // reviewer on the person's required entry; an entry it leaves open stays unfinished.
    finalCalls++;
    const required=JSON.parse(content.split('REQUIRED CURRENT LEDGER CHECKS:\n')[1].split('\n')[0]);
    const elin=required.find(r=>r.id==='characters:Elin');
    assert(elin.value.appearanceSources.some(f=>f.key==='hair' && f.value==='purple' && f.shown.includes('Her hair is purple.')),'The reviewer receives the original hair fact with the entry it approves.');
    if(finalCalls===2)assert.deepEqual(required.map(r=>r.id),['characters:Elin'],'Only the missing appearance review resumes.');
    reply=finalCalls===1
      ?{issues:[],review:{status:'complete',why:'Original facts reviewed; Tala keeps her manual hair.',open:[{id:'characters:Elin',why:'hair: the purple hair from the cast note is not saved yet.'}]},standings:[]}
      :{issues:[],profiles:[{name:'Elin',facts:[{key:'hair',value:'purple',shown:'Elin is queen of the north. Her hair is purple.'}]}],review:{status:'complete',why:'The original appearance is now saved.',open:[]}};
  }
  const answer=JSON.stringify(reply);
  return new Response(body.stream?'data: '+JSON.stringify({choices:[{delta:{content:answer}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n':JSON.stringify({choices:[{message:{content:answer},finish_reason:'stop'}]}));
};
try{
  const args={storyId:id,castNotes:cast,reviewSources:'all',connection:{type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'m',preset:'custom',contextSize:64000}};
  const first=await auditLedger(args),partial=await loadState(id);
  assert(first.unfinished&&!ledgerAuditVerified(partial,story,pages),'An open appearance entry cannot turn green.');
  assert(partial.audit.verification.pending.some(p=>p.startsWith('characters:Elin: hair:')));
  assert.equal(partial.canon.Elin,undefined);
  assert.equal(partial.canon.Tala.facts[0].value,'green');
  const second=await auditLedger(args),done=await loadState(id);
  assert.deepEqual(second.pending,[]);assert(ledgerAuditVerified(done,story,pages));
  assert.equal(done.canon.Elin.facts[0].value,'purple');assert.equal(sourceCalls,1,'Completed physical source reading is reused.');
  assert.equal(finalCalls,2);assert.deepEqual(done.relationships,state.relationships);assert.deepEqual(await db.messages.list(id),pages);
  assert.equal(sourceAppearanceFacts(done).filter(f=>f.name==='Elin').length,1);
  const duplicate={...done,auditSources:{...done.auditSources,duplicate:{...parsed[castDoc.id],people:[review.people[0]]}}};
  assert.equal(sourceAppearanceFacts(duplicate).filter(f=>f.name==='Elin').length,1,'Repeated identical facts share one reconciliation.');
  // M709 retired the per-fact appearance reconciliation (reconcileAppearance now runs only in
  // verifyLedgerChecks' non-authoritative branch and the uncalled auditReviewProblems), so its
  // held/superseded answer checks no longer guard anything the audit does.
  console.log('PASS focused appearance recovery: old source receipts reread; unsupported facts refused; the original hair fact reaches the reviewer and an open entry blocks green; sourced hair repair finishes automatically on the remaining entry; cached source review reused; manual hair, prose and p60/r50 preserved; repeated facts deduplicated. Mocked provider, not the live queen record.');
}finally{globalThis.fetch=oldFetch;}
