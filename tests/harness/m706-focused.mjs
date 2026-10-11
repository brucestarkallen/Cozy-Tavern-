import './idb-shim.mjs';
import assert from 'node:assert/strict';
import {db} from '../../js/store.js';
import {emptyState,saveState,loadState} from '../../js/engine/state.js';
import {auditLedger,profileReconciliationTasks,restoreProfileReconciliation,verifyLedgerChecks} from '../../js/agents/auditor.js';
import {auditSources} from '../../js/agents/auditsources.js';
import {ledgerAuditVerified,ledgerVerificationRows} from '../../js/agents/auditprogress.js';
import {applyMutations} from '../../js/engine/apply.js';

const cast="Neri was once a royal guardian. Neri has dark hair and handsome features. Valen is Neri's blonde public face. Elin is queen of the north, calculating and blunt, with purple hair.";
const prose='Neri waited alone at the gate. Elin remained in her northern chambers.';
const {id}=await db.stories.create({title:'Semantic profile handoff',castNotes:cast});
await db.messages.append(id,{role:'assistant',text:prose,ts:1});
const story=await db.stories.get(id),pages=await db.messages.list(id),documents=auditSources({castNotes:cast,messages:pages});
const writer=documents.find(d=>d.id.startsWith('cast:'));
const neriQuote='Neri has dark hair and handsome features.',queenQuote='Elin is queen of the north, calculating and blunt, with purple hair.';
let state={...emptyState(),sheet:{actors:{},playerName:'Neri',playerAliases:['Valen']},place:{name:'the gate'},
  present:[{name:'Neri',position:'at the gate'}],characters:{
    Neri:{core:'A traveler who formerly guarded the royal house; he has a raven and two public faces.'},
    Elin:{core:'Queen of the north; shrewd and plain spoken.'},
  },offscreen:{Elin:{location:'northern chambers',activity:'resting'}},relationships:{Elin:{p:60,r:50,s:0,history:[]}},
  auditSources:Object.fromEntries(documents.map(d=>[d.id,{mark:d.mark,appearanceReviewed:true,profileReviewed:1,people:d.id===writer.id?[
    {name:'Neri',shown:neriQuote,facts:[{key:'hair',value:'dark',shown:neriQuote},{key:'features',value:'handsome',shown:neriQuote},
      {key:'hair',value:'blonde',shown:"Valen is Neri's blonde public face."}],identityFacts:[{text:'Was once a royal guardian.',shown:'Neri was once a royal guardian.'}]},
    {name:'Elin',shown:queenQuote,facts:[{key:'hair',value:'purple',shown:queenQuote}],identityFacts:[{text:'calculating and blunt',shown:queenQuote}]},
  ]:[]}]))};
state=applyMutations(state,[{type:'canon.lock',name:'Neri',key:'hair',value:'dark in his own face; blonde in his Valen face'},
  {type:'canon.lock',name:'Neri',key:'build',value:'handsome features'},
  {type:'canon.lock',name:'Neri',key:'eyes',value:'grey',byHand:true}]).state;
await saveState(id,state);state=await loadState(id);
let broad=0,focused=0,source=0;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(_,options)=>{
  const body=JSON.parse(options.body),content=body.messages.map(m=>String(m.content)).join('\n');let reply;
  if(content.includes('SOURCE DOCUMENTS\n')){source++;throw Error('Cached sources should not be reread.');}
  else if(content.includes('Find every place the writer STATES'))reply={standings:[]};
  else if(content.includes('REQUIRED PROFILE FACTS WITH ACTUAL SAVED TARGETS:\n')){
    focused++;
    const tasks=JSON.parse(content.split('REQUIRED PROFILE FACTS WITH ACTUAL SAVED TARGETS:\n')[1]);
    assert.equal(tasks.length,2);assert(!content.includes('REQUIRED CURRENT LEDGER CHECKS'));
    reply={checks:tasks.map(t=>({id:t.id,status:t.name==='Elin'?'repair':'correct',why:'The individual source meanings were compared with the actual saved targets.',
      evidenceId:(t.appearance[0] || t.identity[0]).id,
      appearance:t.appearance.map(f=>({id:f.id,status:'held',key:t.name==='Neri'?(f.key==='features'?'build':'hair'):'hair',
        value:t.name==='Neri'?(f.key==='features'?'handsome features':'dark in his own face; blonde in his Valen face'):'purple',why:'This saved field represents this source fact in the correct face.',evidenceId:f.id})),
      identity:t.identity.map(f=>({id:f.id,status:'held',coreText:t.name==='Neri'?'formerly guarded the royal house':'shrewd and plain spoken',why:'This existing core excerpt has the same established meaning.',evidenceId:f.id})),
      ...(t.name==='Elin'?{physicalFacts:[{key:'hair',value:'purple',evidenceId:t.appearance[0].id}]}:{}),
    }))};
  }else if(content.includes('REPAIR FOLLOWUP')){
    broad++;
    const rows=JSON.parse(content.split('REQUIRED CURRENT LEDGER CHECKS:\n')[1].split('\n')[0]);
    const bank=JSON.parse(content.split('ORIGINAL SOURCE PASSAGES FOR REPAIR TARGETS, not summary quotes:\n')[1].split('\n')[0]);
    reply={checks:rows.map(r=>({id:r.id,status:'correct',why:'Profile and ledger checked against sources.',shown:cast,
      ...(r.section==='presence'?{position:r.value.position,positionMatches:true,lastEvidenceId:bank.find(p=>p.text.includes(prose)).evidenceId}:{})
    }))}; // Actual failure shape: all ordinary checks arrive, no nested source mappings.
  }else reply={issues:[]};
  const answer=JSON.stringify(reply);
  return new Response(body.stream?'data: '+JSON.stringify({choices:[{delta:{content:answer}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n':JSON.stringify({choices:[{message:{content:answer},finish_reason:'stop'}]}));
};
try{
  const result=await auditLedger({storyId:id,castNotes:cast,reviewSources:'all',connection:{type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'m',preset:'custom',contextSize:64000}});
  const done=await loadState(id);
  assert.deepEqual(result.pending,[]);assert(ledgerAuditVerified(done,story,pages));
  assert.equal(source,0);assert.equal(broad,1);assert.equal(focused,1);
  assert.equal(done.canon.Elin.facts[0].value,'purple');
  assert.equal(done.characters.Neri.core,state.characters.Neri.core);assert.equal(done.characters.Elin.core,state.characters.Elin.core);
  assert.deepEqual(done.canon.Neri,state.canon.Neri);assert.deepEqual(done.relationships,state.relationships);assert.deepEqual(await db.messages.list(id),pages);
  const rows=ledgerVerificationRows(done),neri=rows.find(r=>r.id==='characters:Neri');
  const receipt=done.audit.verification.entries[neri.id];
  const partial={...receipt,id:neri.id,status:'correct',appearance:receipt.appearance.slice(0,1),identity:[]};
  const saved=verifyLedgerChecks({state:done,snapshot:done,checks:[partial],documents,source:'same'});
  assert(!saved.entries[neri.id],'One accounted atom does not falsely approve the whole profile.');
  const restored=restoreProfileReconciliation(done,[{id:neri.id,status:'correct',why:'Profile read.',shown:cast}],saved.profiles);
  const remaining=profileReconciliationTasks(done,restored,documents);
  assert.equal(remaining[0].appearance.length,2,'The completed appearance mapping is not asked again.');
  const changed={...done,characters:{...done.characters,Neri:{...done.characters.Neri,core:'A changed biography.'}}};
  assert.equal(restoreProfileReconciliation(changed,[{id:neri.id}],saved.profiles)[0].appearance,undefined,'Changed data cannot reuse prior semantic mappings.');
  const forged={...partial,appearance:receipt.appearance.map(a=>({...a,value:'invented'})),identity:receipt.identity};
  assert(!verifyLedgerChecks({state:done,snapshot:done,checks:[forged],documents,source:'same'}).entries[neri.id],'A mapping to absent saved values cannot pass.');
  console.log('PASS: ordinary complete review with omitted mappings reaches a single focused semantic task; combined faces and paraphrased identity reconciled; missing hair saved and verified immediately; partial fact decisions retained only for unchanged data; false mappings rejected; manual eyes, biographies, prose and p60/r50 preserved. Mocked provider, not the live story.');
}finally{globalThis.fetch=originalFetch;}
