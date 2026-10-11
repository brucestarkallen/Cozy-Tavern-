import './idb-shim.mjs';
import assert from 'node:assert/strict';
import { db } from '../../js/store.js';
import { emptyState, loadState, saveState } from '../../js/engine/state.js';
import { applyMutations, undoLast } from '../../js/engine/apply.js';
import { auditSources, sourceReviewResult, missingSourcePeople } from '../../js/agents/auditsources.js';
import { sourceAppearanceFacts } from '../../js/agents/appearanceinventory.js';
import { scribeTurn } from '../../js/agents/scribe.js';
import { auditLedger, finalAuditorScope, verifyLedgerChecks } from '../../js/agents/auditor.js';
import { ledgerVerificationRows, ledgerAuditVerified, ledgerRepairInputKey, ledgerRepairNeeded, LEDGER_REPAIR_POLICY } from '../../js/agents/auditprogress.js';

// Only the reported identity/appearance ownership path. No live provider calls.
const quote='Prince Rowan of Linden rules Linden, a kingdom. Rowan has blue eyes and fair hair.';
const scene='Rowan waited at the rail. The kingdom of Linden lay beyond the palace.';
const connection={type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'fixture',preset:'custom',contextSize:200000,reasoning:{effort:'off'}};
const badPerson={name:'Linden',shown:quote,identityFacts:[],facts:[{key:'eyes',value:'blue',shown:quote},{key:'hair',value:'fair',shown:quote}]};
async function seed(title) {
  const story=await db.stories.create({title});
  await db.messages.append(story.id,{role:'user',text:quote});
  await db.messages.append(story.id,{role:'assistant',text:scene});
  const history=await db.messages.list(story.id), documents=auditSources({messages:history});
  const state={...emptyState(),sheet:{playerName:'Keir',playerAliases:[],actors:{}},
    characters:{Rowan:{core:'Prince Rowan, ruler of Linden.'},Linden:{}},canon:{Linden:{facts:[{key:'eyes',value:'blue'},{key:'hair',value:'fair'}]}},
    present:[{name:'Keir'},{name:'Rowan',position:'at the rail'}],place:{name:'the palace'},
    auditSources:Object.fromEntries(documents.map((d,i)=>[d.id,{mark:d.mark,appearanceReviewed:true,profileReviewed:1,people:i ? [] : [{...badPerson,source:d.id}]}]))};
  await saveState(story.id,state);
  return {story,history,documents,state:await loadState(story.id)};
}
let mode='scribe',calls=0;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(_,options)=>{
  calls++;
  const body=JSON.parse(options.body);
  const all=JSON.stringify(body.messages);
  assert(!all.includes('SOURCE DOCUMENTS\\n'),'Existing source receipts must remain covered.');
  let reply;
  if (mode==='scribe') {
    assert(all.includes('Identify the SUBJECT'),'People learns subject ownership before audit.');
    reply={deltas:[],entities:[{name:'Linden',kind:'place',cause:'Linden is the kingdom, Rowan owns his appearance.',shown:quote}],
      facts:[{name:'Rowan',key:'eyes',value:'blue',shown:quote,replaces:'brown',cause:'The original establishes blue, with no subsequent eye change.'},{name:'Rowan',key:'hair',value:'fair',shown:quote}]};
  } else reply={issues:[{what:'Linden is the kingdom, not a person.',fix:'Archive the erroneous individual and retain Rowan\'s actual appearance.',mutations:[
    {type:'people.reclassify',name:'Linden',kind:'place',cause:'The original names Linden as a kingdom.'},
    {type:'canon.lock',name:'Rowan',key:'eyes',value:'blue'},
    {type:'canon.lock',name:'Rowan',key:'hair',value:'fair'}]}],review:{status:'complete',why:'All actual individuals and their physical facts reviewed, the false place identity corrected.',open:[]},standings:[]};
  const content=JSON.stringify(reply);
  return new Response(body.stream ? 'data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'
    : JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]}));
};
try {
  const upstream=await seed('Subject ownership before auditor');
  upstream.state.canon.Rowan={facts:[{key:'eyes',value:'brown'}]};
  await saveState(upstream.story.id,upstream.state);
  const before=structuredClone(upstream.state);
  const run=await scribeTurn({connection,storyId:upstream.story.id,userText:quote,assistantText:scene,pageAt:0});
  assert.equal(calls,1);assert(run.changes.length);
  const stored=await loadState(upstream.story.id);
  assert(!stored.characters.Linden);assert(!stored.canon.Linden);
  assert.equal(stored.canon.Rowan.facts.find(f=>f.key==='eyes').value,'blue');
  assert.equal(stored.canon.Rowan.facts.find(f=>f.key==='hair').value,'fair');
  assert.equal(stored.entityCorrections.Linden.records.canon.value.facts.length,2,'Misplaced records remain archived.');
  assert(!sourceAppearanceFacts(stored).some(f=>f.name==='Linden'));
  assert.deepEqual(missingSourcePeople(stored,Object.values(stored.auditSources).flatMap(r=>r.people)),[]);
  assert.equal(stored.auditSources[upstream.documents[0].id].mark,before.auditSources[upstream.documents[0].id].mark);
  assert.equal((await db.messages.list(upstream.story.id))[0].text,quote,'Original prose remains intact.');

  const reclassified=applyMutations(before,[{type:'people.reclassify',name:'Linden',kind:'place',auditorApproved:true,source:'auditor'}]).state;
  const undone=undoLast(reclassified).state;
  assert.deepEqual(undone.characters.Linden,before.characters.Linden);assert.deepEqual(undone.canon.Linden,before.canon.Linden);
  assert.equal(undone.auditSources[upstream.documents[0].id].people[0].kind,undefined);
  const protectedState=structuredClone(before);protectedState.characters.Linden.hand={core:true};
  assert.equal(applyMutations(protectedState,[{type:'people.reclassify',name:'Linden',kind:'place',auditorApproved:true}]).applied.length,0);
  assert.equal(finalAuditorScope([{mutations:[{type:'people.reclassify',name:'Keir',kind:'place'}]}],before)[0].mutations.length,0,'Player cannot be reclassified.');

  // The actual final transaction must certify the same resulting Rowan record,
  // rather than rejecting its own repair as a concurrent change.
  mode='auditor';calls=0;
  const recovery=await seed('Already saved false entity');
  const answer=await auditLedger({connection,storyId:recovery.story.id,reviewSources:'all'});
  assert(answer);assert.equal(answer.unfinished,false,JSON.stringify(answer.pending));assert.equal(calls,1);
  const repaired=await loadState(recovery.story.id);
  assert(!repaired.characters.Linden);assert(!repaired.canon.Linden);
  assert.equal(repaired.audit.coverage.read,recovery.documents.length);
  assert.equal(repaired.audit.verification.read,repaired.audit.verification.total);
  assert(ledgerAuditVerified(repaired,recovery.story,recovery.history));
  assert(!ledgerRepairNeeded(repaired,{},recovery.story,recovery.history),'No repeat audit on unchanged reopening.');

  const paused=structuredClone(before);paused.audit={unfinished:true,pending:['False entity'],pausedInput:ledgerRepairInputKey(paused,upstream.story,upstream.history)};
  assert(ledgerRepairNeeded(paused,{},upstream.story,upstream.history),'Old paused input resumes the new repair procedure.');
  paused.audit.pausedPolicy=LEDGER_REPAIR_POLICY;
  assert(!ledgerRepairNeeded(paused,{},upstream.story,upstream.history),'Same unsuccessful procedure cannot retry forever.');
  const classified=sourceReviewResult(JSON.stringify({checked:[upstream.documents[0].id],people:[{...badPerson,kind:'place',source:upstream.documents[0].id}]}),[upstream.documents[0]]);
  assert.equal(classified.receipts[upstream.documents[0].id].people[0].kind,'place');

  const row=ledgerVerificationRows(repaired).find(r=>r.id==='characters:Rowan');
  const later=structuredClone(repaired);later.characters.Rowan.core='An unreviewed concurrent change.';
  const check=verifyLedgerChecks({state:later,snapshot:repaired,approvedState:repaired,documents:recovery.documents,checks:[{id:row.id,print:row.print,status:'correct',why:'Reviewed',finalReview:true}],authoritative:true});
  assert(!check.entries[row.id],'A real concurrent value cannot borrow the old approval.');
  console.log('M716 passed: one People call repairs entity ownership before audit; one final audit call repairs stored false entity, finishes all entries, preserves archive/undo/manual fields/prose, and owes no repeated review. Real concurrent changes remain unverified.');
} finally {globalThis.fetch=originalFetch;}
