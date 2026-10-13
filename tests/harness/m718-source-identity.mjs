import './idb-shim.mjs';
import assert from 'node:assert/strict';
import { db } from '../../js/store.js';
import { emptyState, loadState, saveState } from '../../js/engine/state.js';
import { applyMutations, undoLast } from '../../js/engine/apply.js';
import { auditSources, missingSourcePeople, sourcePersonKey } from '../../js/agents/auditsources.js';
import { sourceAppearanceFacts } from '../../js/agents/appearanceinventory.js';
import { auditLedger } from '../../js/agents/auditor.js';
import { ledgerVerificationRows, ledgerRepairInputKey, ledgerRepairStateKey, saveAuditCheckpoint, ledgerAuditVerified, ledgerRepairNeeded } from '../../js/agents/auditprogress.js';

// One reported path: a source descriptor is not a new global character.
const connection={type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'fixture',preset:'custom',contextSize:200000,reasoning:{effort:'off'}};
const intro='Rina is a dancer with black hair. Sela is the fourth princess, with silver hair.';
const oldScene='Rina stepped in. The girl, a dancer with black hair, bowed.';
const latest='Sela stood at the gallery rail. The girl told the steward to send Keir an invitation.';
async function seed(title,lastText=latest) {
  const story=await db.stories.create({title});
  for (const [role,text] of [['user',intro],['assistant',oldScene],['user','The salle quieted.'],['assistant',lastText]]) await db.messages.append(story.id,{role,text});
  const history=await db.messages.list(story.id),documents=auditSources({messages:history});
  const person=(name,shown,value)=>({name,kind:'person',shown,identityFacts:[],facts:value?[{key:'hair',value,shown}]:[]});
  let state={...emptyState(),sheet:{playerName:'Keir',playerAliases:[],actors:{}},
    characters:{Rina:{core:'A dancer.',arc:'Trusts Keir.'},Sela:{core:'The fourth princess.',hand:{core:true},arc:'Curious about Keir.'}},
    canon:{Rina:{facts:[{key:'hair',value:'black'}]},Sela:{facts:[{key:'hair',value:'silver'}]}},
    relationships:{Sela:{p:60,r:50,s:10}},
    auditSources:Object.fromEntries(documents.map(d=>[d.id,{mark:d.mark,appearanceReviewed:true,profileReviewed:1,people:[]}]))};
  state.auditSources[documents[0].id].people=[person('Rina',intro,'black'),person('Sela',intro,'silver')];
  state.auditSources[documents[1].id].people=[{...person('the girl',oldScene,'black'),ledgerName:'Rina',identityResolution:{kind:'person',to:'Rina',why:'The earlier source identifies the dancer.'}}];
  for (const d of documents.slice(3)) state.auditSources[d.id].people=[person('the girl',d.text)];
  await saveState(story.id,state);state=await loadState(story.id);
  const rows=ledgerVerificationRows(state),verification={source:ledgerRepairInputKey({},story,history),ledger:ledgerRepairStateKey(state),read:rows.length,total:rows.length,
    entries:Object.fromEntries(rows.map(r=>[r.id,{print:r.print,scope:r.scope,status:'correct',why:'Actual saved ledger already approved.'}])),profiles:{}};
  const people=documents.flatMap(d=>state.auditSources[d.id].people.map(p=>({...p,source:d.id,label:d.label})));
  const findings=missingSourcePeople(state,people);
  assert.equal(findings.length,documents.length-3,'An older page binding must not silently resolve a different page or section.');
  // Emulate the already saved M717 finding without the new source metadata.
  const oldFindings=findings.map(i=>{const old={...i};delete old.sourceId;delete old.sourceName;return old;});
  state.audit={verification,coverage:{read:documents.length,total:documents.length},finalReview:{status:'ok'},unresolved:oldFindings,unfinished:true,pending:oldFindings.map(i=>i.what),pausedPolicy:3,pausedInput:ledgerRepairInputKey(state,story,history)};
  state.audit.checkpoint=saveAuditCheckpoint(state,story,documents,verification);
  await saveState(story.id,state);
  return {story,history,documents,state:await loadState(story.id)};
}
let calls=0,omitFirst=false;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(_,options)=>{
  calls++;
  const body=JSON.parse(options.body),all=JSON.stringify(body.messages);
  assert(!all.includes('SOURCE DOCUMENTS'),'All completed source receipts must remain cached.');
  assert(all.includes('REQUIRED SOURCE MENTION DECISIONS'),'The final reader sees the outstanding source mention.');
  const request=body.messages.find(m=>m.role==='user' && m.content.includes('REQUIRED SOURCE MENTION DECISIONS')).content;
  const tasks=JSON.parse(request.split('REQUIRED SOURCE MENTION DECISIONS:\n')[1].split('\n')[0]);
  assert.equal(new Set(tasks.map(t=>t.id)).size,tasks.length,'Same-label sections have distinct required decisions.');
  const continued=body.messages.some(m=>m.role==='assistant');
  // M732: the same-conversation correction names each unfinished mention with its original
  // passage and the engine's eligible person targets (one executable identity contract).
  if (continued) {
    const correction=body.messages.at(-1).content;
    assert(correction.includes('Complete the SAME review') && correction.includes('"type":"source_identity"'),'An omitted source decision is completed in the same conversation.');
    assert(tasks.every(t=>correction.includes(JSON.stringify(t.sourceId))) && correction.includes('"originalPassage":"') && correction.includes('"engineEligibleTargets":') && correction.includes('SOURCE IDENTITY DECISION CONTRACT'));
  }
  const reply={issues:[],identities:omitFirst && !continued ? [] : tasks.map(task=>({sourceId:task.sourceId,name:task.name,to:'Sela',kind:'person',why:'This page names Sela before the same girl gives her instruction.'})),
    review:{status:'complete',why:'The actual ledger is correct and the contextual source mention belongs to Sela.',open:[]},standings:[]};
  const content=JSON.stringify(reply);
  return new Response('data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
};
try {
  const saved=await seed('Scoped identity recovery');
  assert(ledgerRepairNeeded(saved.state,{},saved.story,saved.history),'The old paused procedure resumes.');
  const answer=await auditLedger({connection,storyId:saved.story.id,reviewSources:'all'});
  assert(answer);assert.equal(answer.unfinished,false,JSON.stringify(answer.pending));assert.equal(calls,1);
  const landed=await loadState(saved.story.id);
  assert.deepEqual(landed.characters,saved.state.characters,'No duplicate profile, global alias, manual core or arc rewrite.');
  assert.deepEqual(landed.relationships,saved.state.relationships,'Earned feelings are unchanged.');
  assert.equal(sourcePersonKey(landed,'the girl',landed.auditSources[saved.documents[1].id].people[0].ledgerName),'Rina');
  assert.equal(sourcePersonKey(landed,'the girl',landed.auditSources[saved.documents[3].id].people[0].ledgerName),'Sela');
  assert.equal(sourcePersonKey(landed,'the girl'),'','No global source descriptor shortcut.');
  assert(!sourceAppearanceFacts(landed).some(f=>f.name==='the girl'));
  assert(ledgerAuditVerified(landed,saved.story,saved.history));assert(!ledgerRepairNeeded(landed,{},saved.story,saved.history));
  assert.equal(landed.audit.coverage.read,saved.documents.length);assert.equal(landed.audit.finalReview.sourceCalls,0);
  const undone=undoLast(landed).state;
  assert.equal(undone.auditSources[saved.documents[3].id].people[0].ledgerName,undefined);
  assert.equal(undone.auditSources[saved.documents[1].id].people[0].ledgerName,'Rina');
  assert(!ledgerAuditVerified(undone,saved.story,saved.history),'Undoing an identity decision invalidates completion.');
  assert.deepEqual((await db.messages.list(saved.story.id)).map(m=>m.text),saved.history.map(m=>m.text));
  const reference=applyMutations(saved.state,[{type:'source.resolve',sourceId:saved.documents[3].id,name:'the girl',kind:'reference',cause:'This is a comparison-only reference.',auditorApproved:true,source:'auditor'}]);
  assert.equal(reference.applied.length,1);assert.deepEqual(reference.state.characters,saved.state.characters);
  assert.equal(applyMutations(saved.state,[{type:'source.resolve',sourceId:saved.documents[3].id,name:'the girl',to:'Sela',cause:'Unapproved'}]).applied.length,0);

  omitFirst=true;calls=0;
  const continued=await seed('One omitted source decision');
  const completed=await auditLedger({connection,storyId:continued.story.id,reviewSources:'all'});
  assert(completed);assert.equal(completed.unfinished,false,JSON.stringify(completed.pending));assert.equal(calls,2,'One same-conversation completion, no new audit loop.');
  assert(ledgerAuditVerified(await loadState(continued.story.id),continued.story,continued.history));
  omitFirst=false;calls=0;
  const long=await seed('Multiple sections of the same page',(latest+'\n\n').repeat(180));
  assert(long.documents.length>4);
  const whole=await auditLedger({connection,storyId:long.story.id,reviewSources:'all'});
  assert(whole);assert.equal(whole.unfinished,false,JSON.stringify(whole.pending));assert.equal(calls,1,'Resolve every same-label section together, not one per audit cycle.');
  const covered=await loadState(long.story.id);
  for (const d of long.documents.slice(3)) assert.equal(covered.auditSources[d.id].people[0].ledgerName,'Sela');
  console.log('M718 passed: one final call resolves the cached source descriptor, preserves different page identities/manual profiles/feelings/prose, completes all entries and owes no repeat audit. Missing decisions finish inside that conversation; undo clears completion. No source rescan or real provider calls.');
} finally {globalThis.fetch=originalFetch;}
