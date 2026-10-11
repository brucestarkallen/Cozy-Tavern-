import './idb-shim.mjs';
import assert from 'node:assert/strict';
import {db} from '../../js/store.js';
import {emptyState,saveState,loadState} from '../../js/engine/state.js';
import {applyMutations} from '../../js/engine/apply.js';
import {extractTurn,placesBlock} from '../../js/agents/extractor.js';
import {auditLedger} from '../../js/agents/auditor.js';
import {auditSources} from '../../js/agents/auditsources.js';
import {ledgerVerificationRows,ledgerRepairInputKey,ledgerRepairStateKey,ledgerAuditVerified} from '../../js/agents/auditprogress.js';

// The causal failure: header words occur early in prose, then a pronoun stop
// and outfit change occur later. Another actor and a quiet witness finish it.
const opening='backing across the gravel';
const stop='His shoulder found the stone wall. He took off the blue coat, leaving his white shirt.';
const prose='[the practice yard | 09:00 | cold | blue coat | '+opening+']\n\n'
  +'Neri was backing across the gravel as Rook advanced.\n\n'+stop+'\n\n'
  +'Elin watched from the bench. Rook raised his sword for another stroke.';
const base={...emptyState(),sheet:{actors:{},playerName:'Neri',playerAliases:['Valen']},place:{name:'the practice yard'},
  present:[{name:'Neri',position:'at the starting line',attire:'dark tunic'},{name:'Rook',position:'in the yard'},{name:'Elin',position:'on the bench'}],
  characters:{Neri:{core:'A traveler.',state:'Practicing.'},Rook:{core:'The sword instructor.'},Elin:{core:'Queen of the north.'}},
  relationships:{Elin:{p:60,r:50,s:0,history:[]}}};
assert(placesBlock(base,prose).join('\n').includes('Neri'),'The player gets an explicit ending decision even when the stop uses pronouns.');
const connection={type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'m',preset:'custom',contextSize:64000};
const originalFetch=globalThis.fetch;
let calls=0;
globalThis.fetch=async(_,options)=>{
  calls++;
  const body=JSON.parse(options.body),content=body.messages.map(m=>String(m.content)).join('\n');
  assert(content.includes('DERIVE THE COMPLETED SCENE BEFORE COMPARING'),'The existing request carries the shared ending procedure.');
  let reply;
  if(calls<=2) {
    reply={mutations:[{type:'mode.snapshot',flags:['combat','group']}],here:[
      {name:'Neri',...(calls===1?{at:'against the stone wall',wears:'white shirt',shown:stop}:{shown:'Neri was backing across the gravel as Rook advanced.'})},
      {name:'Rook'},{name:'Elin'}]};
  }else{
    assert.equal(calls,3,'Only one auditor call, no continuation for previously approved rows.');
    const rows=JSON.parse(content.split('REQUIRED CURRENT LEDGER CHECKS:\n')[1].split('\n')[0]);
    assert.equal(rows.length,0,'Exercise the formerly green, retained-entry repair path.');
    reply={scene:[{name:'Valen',position:'against the stone wall',attire:'white shirt',shown:stop}],
      issues:[],review:{status:'complete',why:'Followed the retreat through the final stop and outfit change; quiet witnesses remain.',open:[]},standings:[]};
  }
  const answer=JSON.stringify(reply);
  return new Response(body.stream?'data: '+JSON.stringify({choices:[{delta:{content:answer}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n':JSON.stringify({choices:[{message:{content:answer},finish_reason:'stop'}]}));
};
try {
  const extracted=await extractTurn({connection,state:base,userText:'Continue the practice.',assistantText:prose,moodOwed:false});
  const result=applyMutations(base,extracted.mutations).state;
  assert.equal(result.present[0].position,'against the stone wall');
  assert.equal(result.present[0].attire,'white shirt');
  assert(!extracted.mutations.some(m=>m.position===opening || m.attire==='blue coat'),'Opening cells cannot overwrite the ending read.');
  const omitted=await extractTurn({connection,state:base,userText:'Continue.',assistantText:prose,moodOwed:false});
  assert(!omitted.mutations.some(m=>m.position===opening || m.attire==='blue coat'),'A missing pose does not promote the opening through word overlap.');

  const {id}=await db.stories.create({title:'Completed scene chronology'});
  await db.messages.append(id,{role:'assistant',text:prose,ts:1});
  const story=await db.stories.get(id),pages=await db.messages.list(id),documents=auditSources({messages:pages});
  const stale={...base,present:[{...base.present[0],position:opening,attire:'blue coat'},...base.present.slice(1)],
    auditSources:Object.fromEntries(documents.map(d=>[d.id,{mark:d.mark,appearanceReviewed:true,profileReviewed:1,people:[]}]))};
  const entries=Object.fromEntries(ledgerVerificationRows(stale).map(r=>[r.id,{print:r.print,scope:r.scope,status:'correct',why:'Earlier approval.'}]));
  stale.audit={coverage:{read:documents.length,total:documents.length},verification:{source:ledgerRepairInputKey({},story,pages),ledger:ledgerRepairStateKey(stale),entries},
    verifiedInput:ledgerRepairInputKey(stale,story,pages)};
  await saveState(id,stale);
  const beforeAudit=await loadState(id); // Store normalizes default fields.
  const audit=await auditLedger({connection,storyId:id,reviewSources:'all'});
  const fixed=await loadState(id);
  assert.deepEqual(audit.pending,[]);assert(ledgerAuditVerified(fixed,story,pages));
  assert.equal(fixed.present[0].position,'against the stone wall');assert.equal(fixed.present[0].attire,'white shirt');
  assert.equal(fixed.audit.finalReview.calls,1);assert(!fixed.audit.finalReview.formatContinuation);
  assert.equal(fixed.audit.finalReview.scene.pageId,pages[0].id);
  assert.deepEqual(fixed.present.slice(1),base.present.slice(1));
  assert.deepEqual(fixed.characters,beforeAudit.characters);assert.deepEqual(fixed.relationships,beforeAudit.relationships);
  assert.deepEqual(await db.messages.list(id),pages);
  assert(fixed.journal.some(j=>j.m?.source==='auditor' && j.m?.position==='against the stone wall'),'Repair uses the existing journal and undo path.');
  console.log('PASS: opening pose/outfit cannot overwrite or replace ending evidence; player pronouns are explicitly reviewed; a retained green entry is corrected and approved in one auditor call; witnesses, prose, profiles and earned standings are preserved. Mocked provider only.');
} finally {globalThis.fetch=originalFetch;}
