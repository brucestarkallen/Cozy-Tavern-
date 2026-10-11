import './idb-shim.mjs';
import assert from 'node:assert/strict';
import {db} from '../../js/store.js';
import {emptyState,saveState,loadState} from '../../js/engine/state.js';
import {applyMutations} from '../../js/engine/apply.js';
import {auditLedger,bindAuditEvidence,completeAuditCheckReply,verifyLedgerChecks,auditView} from '../../js/agents/auditor.js';
import {auditSources} from '../../js/agents/auditsources.js';
import {auditEvidenceBook,auditEvidencePassages} from '../../js/agents/auditevidence.js';
import {ledgerVerificationRows,ledgerAuditVerified,reusableAuditCheckpoint,auditCheckpointStart} from '../../js/agents/auditprogress.js';
import {fingerprint36} from '../../js/engine/fingerprint.js';
import '../../js/ui/auditscratchbook.js';

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
let finalReads=0,focused=0,sourceCalls=0;const prior=globalThis.fetch;
globalThis.fetch=async(_,options)=>{
  const body=JSON.parse(options.body),content=body.messages.map(m=>String(m.content)).join('\n');let reply;
  if(content.includes('SOURCE DOCUMENTS\n')){sourceCalls++;throw Error('Unchanged originals must remain cached.');}
  else if(content.includes('Find every place the writer STATES'))reply={standings:[]};
  else if(content.includes('REQUIRED PROFILE FACTS WITH ACTUAL SAVED TARGETS:\n')){
    focused++;
    const tasks=JSON.parse(content.split('REQUIRED PROFILE FACTS WITH ACTUAL SAVED TARGETS:\n')[1].split('\n')[0]);
    reply={checks:tasks.map(t=>({id:t.id,status:'correct',why:'Meaning compared with saved fields and original quotations.',evidenceId:oldId,
      appearance:t.appearance.map(f=>({id:f.id,status:'held',key:f.key==='features'?'build':'hair',value:f.key==='features'?'handsome features':'dark in his own face; blonde in Valen',why:'This actual field holds the right face and feature.',evidenceId:oldId})),
      identity:t.identity.map(f=>({id:f.id,status:'held',coreText:t.name==='Neri'?'formerly guarded the royal house':'shrewd and plain spoken',why:'Equivalent established identity.',evidenceId:oldId})),
      ...(t.name==='Neri'?{physicalFacts:[{key:'build',value:'handsome features',evidenceId:oldId}]}:{}),
    }))}; // References from the broad reading are valid in this focused reading too.
  }else if(content.includes('REPAIR FOLLOWUP')){
    finalReads++;
    if(finalReads===1) reply={issues:[]}; // Actual report: usable JSON, zero requested checks returned.
    else {
      assert.equal(finalReads,2,'Only one format continuation, not repeated whole audits.');
      assert(content.includes('format continuation of the SAME review'));
      const rows=JSON.parse(content.split('REQUIRED CURRENT LEDGER CHECKS:\n')[1].split('\n')[0]);
      const bank=JSON.parse(content.split('ORIGINAL SOURCE PASSAGES FOR REPAIR TARGETS, not summary quotes:\n')[1].split('\n')[0]);
      reply={checks:rows.map(r=>({id:r.id,status:'correct',why:'Actual entry and original sources reviewed.',evidenceId:oldId,
        ...(r.section==='presence'?{position:r.value.position,positionMatches:true,lastEvidenceId:bank.find(p=>p.text.includes(prose)).evidenceId}:{}),
        ...(r.id==='characters:Elin'?{physicalFacts:[{key:'hair',value:'purple',evidenceId:oldId}]}:{}),
      }))};
    }
  }else reply={issues:[]};
  const answer=JSON.stringify(reply);
  return new Response(body.stream?'data: '+JSON.stringify({choices:[{delta:{content:answer}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n':JSON.stringify({choices:[{message:{content:answer},finish_reason:'stop'}]}));
};
try {
  const result=await auditLedger({storyId:id,castNotes:cast,reviewSources:'all',connection:{type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'m',preset:'custom',contextSize:64000}});
  const done=await loadState(id);
  assert.deepEqual(result.pending,[]);assert(ledgerAuditVerified(done,story,pages));
  assert.equal(sourceCalls,0);assert.equal(finalReads,2);assert.equal(focused,1);
  assert.equal(done.canon.Elin.facts[0].value,'purple');assert.deepEqual(done.canon.Neri,state.canon.Neri);
  assert.deepEqual(done.characters,state.characters);assert.deepEqual(done.relationships,state.relationships);assert.deepEqual(await db.messages.list(id),pages);
  const next={...done,clock:{...done.clock,minutes:(done.clock?.minutes || 0)+10},place:{name:'the garden'},
    present:[{name:'Neri',position:'at the garden fountain'}],characters:{...done.characters,Neri:{...done.characters.Neri,state:'Walking in the garden.'}}};
  const newPages=[...pages,{id:'new-page',role:'assistant',text:'Neri waited at the garden fountain, his dark hair damp.'}];
  const newDocs=auditSources({castNotes:cast,messages:newPages});
  assert.equal(auditCheckpointStart(done,story,newDocs,newPages,newPages.at(-1)),1,'A completed scene cursor begins at the next scene, not page one.');
  assert.deepEqual(auditView(newPages,1,Infinity,1).shown.map(p=>p.ordinal),[2],'The actual reader view respects the cursor, including when fewer than ten pages exist.');
  assert.equal(auditCheckpointStart(done,story,documents,pages,pages.at(-1)),0,'The latest scene remains available for edits on that same page.');
  const kept=reusableAuditCheckpoint(next,story,newDocs);
  assert(kept.entries['characters:Neri']&&kept.entries['characters:Elin']&&kept.entries['canon:Neri'],'Append-only scene changes retain unchanged identities and appearance.');
  assert(!kept.entries['characterState:Neri'],'Current state is reviewed separately.');
  const repeatDoc=newDocs.find(d=>d.id==='page:new-page:0');
  const repeated={...next,auditSources:{...next.auditSources,[repeatDoc.id]:{mark:repeatDoc.mark,appearanceReviewed:true,profileReviewed:1,
    people:[{name:'Neri',shown:repeatDoc.text,facts:[{key:'hair',value:'dark',shown:repeatDoc.text}],identityFacts:[]}]}}};
  assert(reusableAuditCheckpoint(repeated,story,newDocs).entries['characters:Neri'],'Another source reporting the same fact does not restart identity approval.');
  const changed=applyMutations(next,[{type:'canon.lock',name:'Neri',key:'hair',value:'red'}]).state;
  assert(!reusableAuditCheckpoint(changed,story,newDocs).entries['characters:Neri'],'Changed saved appearance reopens the affected identity.');
  assert(reusableAuditCheckpoint(changed,story,newDocs).entries['characters:Elin'],'Unrelated profile remains checked.');
  const erased=documents.filter(d=>d.id!==writer.id);
  assert.equal(Object.keys(reusableAuditCheckpoint(next,story,erased).entries).length,0,'Removed source evidence invalidates its checkpoint.');
  assert.equal(auditCheckpointStart(done,story,erased,newPages,newPages.at(-1)),0,'Removed or changed history resets the reading cursor.');
  const registry=auditEvidenceBook(documents,[],done.audit.evidenceBook),passages=auditEvidencePassages(documents,registry);
  const recovered=bindAuditEvidence({issues:[{mutations:[{type:'canon.lock',name:'Elin',key:'hair',value:'purple',evidenceId:oldId,evidenceError:'old missing reference'}]}]},passages,[],documents);
  assert.equal(recovered.issues[0].mutations[0].shown,cast);assert(!recovered.issues[0].mutations[0].evidenceError,'Successful rebinding removes an obsolete transport error.');
  assert(!auditEvidencePassages(erased,auditEvidenceBook(erased,[],registry)).some(p=>p.evidenceId===oldId));
  const forged=bindAuditEvidence({issues:[{mutations:[{evidenceId:'source:invented'}]}]},passages,[],documents);
  assert(forged.issues[0].mutations[0].evidenceError,'An invented reference without original evidence does not pass.');
  const literal=bindAuditEvidence({issues:[{mutations:[{evidenceId:'source:old-unavailable',shown:cast}]}]},[],[],documents);
  assert(!literal.issues[0].mutations[0].evidenceError,'Valid original quotation does not need a redundant opaque id.');
  assert(!completeAuditCheckReply('{"issues":[]}',ledgerVerificationRows(done)),'Zero checks cannot be called a completed review.');
  const stateRow=ledgerVerificationRows(done).find(r=>r.id==='characterState:Neri');
  const repaired={...done,characters:{...done.characters,Neri:{...done.characters.Neri,state:'Waiting at the gate.'}}};
  const check={id:stateRow.id,print:stateRow.print,status:'correct',why:'The corrected resulting state agrees with the page.',shown:prose};
  const write={mutation:{type:'people.set',name:'Neri',field:'state',text:'Waiting at the gate.'}};
  assert(verifyLedgerChecks({state:repaired,snapshot:done,approvedState:repaired,checks:[check],applied:[write],documents,source:'s'}).entries[stateRow.id],
    'The same approved supported repair closes even when its resulting entry was called correct.');
  const concurrent={...repaired,characters:{...repaired.characters,Neri:{...repaired.characters.Neri,state:'A later manual change.'}}};
  assert(!verifyLedgerChecks({state:concurrent,snapshot:done,approvedState:repaired,checks:[check],applied:[write],documents,source:'s'}).entries[stateRow.id],
    'A concurrent unreviewed value cannot borrow the old repair approval.');
  console.log('PASS: omitted checks continue once in the same review; shared original references bind across stages and reopening; stale errors clear; absent hair saves; lasting profile checkpoints survive a new scene, while changed facts and removed sources reopen only valid dependencies; manual eyes, all biographies, prose and p60/r50 preserved. Mocked provider, no live story calls.');
}finally{globalThis.fetch=prior;}
