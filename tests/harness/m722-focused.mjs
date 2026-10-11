import './idb-shim.mjs';
import assert from 'node:assert/strict';
import {db} from '../../js/store.js';
import {emptyState,saveState,loadState} from '../../js/engine/state.js';
import {applyMutations,undoLast} from '../../js/engine/apply.js';
import {auditSources,missingSourcePeople,sourceIdentityNeeded,sourceFactScope} from '../../js/agents/auditsources.js';
import {auditLedger,findingSettled} from '../../js/agents/auditor.js';
import {ledgerVerificationRows,ledgerRepairInputKey,ledgerRepairStateKey,saveAuditCheckpoint,ledgerAuditVerified,ledgerRepairNeeded} from '../../js/agents/auditprogress.js';
import {auditStretch,auditProgress,nextStretch,parseStretchAnswer,scopeStretch,auditWaits,RECOVERY_DELAY,continuousRunStatus,recoveryWords} from '../../js/agents/continuous.js';
import {noteWorkerRun,loadWorkerStatus,historicalRunStatus} from '../../js/agents/status.js';
import {loadMemory,saveMemory} from '../../js/agents/memory.js';
import {loadEssentials,recordOf,runEssentials} from '../../js/agents/essentials.js';
const connection={type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'fixture',preset:'custom',contextSize:200000,reasoning:{effort:'off'}};
const quote='A bodyguard in house mail stood two paces behind William.';
const source='page:guard:0';
const person={name:'the bodyguard',kind:'person',shown:quote,identityFacts:[{text:'Stands behind William.',shown:quote}],facts:[]};
const base={...emptyState(),present:[{name:'the bodyguard'},{name:'William'},{name:'Other Guard'}],characters:{William:{core:'The prince.'}},canon:{William:{facts:[{key:'hair',value:'dark'}]}},auditSources:{[source]:{mark:'original',people:[person]}}};
const issue=missingSourcePeople(base,[{...person,source,label:'Page 86'}])[0];
const resolution={type:'source.resolve',sourceId:source,name:person.name,to:person.name,kind:'person',cause:'This particular guard stands behind William.',auditorApproved:true};
const bound=applyMutations(base,[resolution]);
assert.equal(bound.applied.length,1);
assert(findingSettled(issue,{out:bound.state,applied:[],rejected:[]},[],[]));
assert(!sourceIdentityNeeded(bound.state,bound.state.auditSources[source].people[0]));
assert.deepEqual(bound.state.characters,base.characters);
assert.deepEqual(bound.state.canon,base.canon);
const facts=missingSourcePeople(bound.state,[{...bound.state.auditSources[source].people[0],source}]);
assert.equal(facts.length,1);assert(facts[0].sourceFacts,'Classification closes while specific source facts remain reviewable.');
const same=applyMutations(bound.state,[{...resolution,cause:'William is not this guard.'}]);
assert.equal(same.applied.length,0);assert.equal(same.state.journal.length,bound.state.journal.length);
const changed=applyMutations(bound.state,[{...resolution,to:'Other Guard',cause:'The original establishes the other guard.'}]);
assert.equal(changed.applied.length,1);
assert.equal(undoLast(changed.state).state.auditSources[source].people[0].ledgerName,'the bodyguard');
const independent=applyMutations({...bound.state,auditSources:{...bound.state.auditSources,second:{mark:'second',people:[person]}}},[{...resolution,sourceId:'second',to:'Other Guard'}]).state;
assert.equal(independent.auditSources[source].people[0].ledgerName,'the bodyguard');assert.equal(independent.auditSources.second.people[0].ledgerName,'Other Guard');
const stable={...bound.state,characters:{...bound.state.characters,'the bodyguard':{core:'A royal guard.'}}};
const stableMention={...stable.auditSources[source].people[0],source,identityFacts:[{text:'Brother of the third princess.',shown:'He is the third princess’s brother.'}]};
const stableIssue=missingSourcePeople(stable,[stableMention])[0];assert(stableIssue.sourceFacts);
const recovered=applyMutations(stable,[{type:'people.note',name:'the bodyguard',field:'core',text:'Brother of the third princess.'}]).state;
assert.match(recovered.characters['the bodyguard'].core,/A royal guard/);assert.deepEqual(missingSourcePeople(recovered,[stableMention]),[]);
const scoped=sourceFactScope(stable,stableMention);
const dismissed={...stable,audit:{sourceFactDecisions:{[scoped]:{why:'Equivalent source-grounded wording.'}}}};
assert.deepEqual(missingSourcePeople(dismissed,[stableMention]),[]);
assert.equal(missingSourcePeople({...dismissed,auditSources:{[source]:{...stable.auditSources[source],mark:'changed'}}},[stableMention]).length,1);
let reply={},calls=0,mends=0;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(_,options)=>{
 calls++; const request=JSON.stringify(JSON.parse(options.body).messages);
 assert(!request.includes('SOURCE DOCUMENTS\\n'),'Saved original receipts are reused.');
 let value=typeof reply==='function'?await reply(request):reply;
 if (request.includes('TARGETED HISTORICAL RECOVERY') && value?.issues?.[0]?.record?.fixes?.length) {
  const fix=value.issues[0].record.fixes[0];
  value={outcome:'repair',why:fix.why,evidence:[{source:'1',shown:fix.shown}],record:{fixes:[fix]}};
 }
 const content=typeof value==='string'?value:JSON.stringify(value);
 return new Response('data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
};
try {
 const story=await db.stories.create({title:'Paused bodyguard'});
 await db.messages.append(story.id,{role:'assistant',text:quote});
 const history=await db.messages.list(story.id),docs=auditSources({messages:history});
 let state={...base,auditSources:Object.fromEntries(docs.map(d=>[d.id,{mark:d.mark,appearanceReviewed:true,profileReviewed:1,people:[{...person,identityFacts:[],ledgerName:person.name,identityResolution:{kind:'person',to:person.name,why:'Already bound.'}}]}]))};
 const old={...issue,sourceId:docs[0].id};
 const rows=ledgerVerificationRows(state),verification={source:ledgerRepairInputKey({},story,history),ledger:ledgerRepairStateKey(state),read:rows.length,total:rows.length,entries:Object.fromEntries(rows.map(r=>[r.id,{print:r.print,scope:r.scope,status:'correct',why:'Reviewed actual records.'}])),profiles:{}};
 state.audit={verification,coverage:{read:docs.length,total:docs.length},finalReview:{status:'incomplete decisions'},unresolved:[old],pending:[old.what],unfinished:true,pausedPolicy:5,pausedInput:ledgerRepairInputKey(state,story,history)};
 state.audit.checkpoint=saveAuditCheckpoint(state,story,docs,verification);await saveState(story.id,state);
 assert(ledgerRepairNeeded(state,{},story,history));
 reply={issues:[],standings:[],review:{status:'complete',why:'The saved binding is valid. No stable biography is established.',open:[]}};
 const reviewed=await auditLedger({connection,storyId:story.id,reviewSources:'all'});
 assert.equal(reviewed.unfinished,false,JSON.stringify(reviewed.pending));assert.equal(calls,1);
 const landed=await loadState(story.id);assert(ledgerAuditVerified(landed,story,history));assert(!ledgerRepairNeeded(landed,{},story,history));assert.equal(landed.audit.finalReview.sourceCalls,0);
 assert.equal(landed.journal.length,0,'No repeat saved source decision.');
 // A source extractor's momentary role is judged against this source, not forced into a biography.
 for (const receipt of Object.values(state.auditSources)) receipt.people[0].identityFacts=person.identityFacts;
 await saveState(story.id,state);
 const temporaryFact=missingSourcePeople(state,[{...state.auditSources[docs[0].id].people[0],source:docs[0].id}])[0];
 reply={issues:[],standings:[],resolved:[{what:temporaryFact.what,shown:quote,why:'Standing behind William is a momentary scene role, not a missing stable biography.'}],review:{status:'complete',why:'Saved classification and supported facts reviewed.',open:[]}};
 const classified=await auditLedger({connection,storyId:story.id,reviewSources:'all'});
 assert.equal(classified.unfinished,false,JSON.stringify(classified.pending));
 const classifiedState=await loadState(story.id);
 assert.deepEqual(missingSourcePeople(classifiedState,[{...classifiedState.auditSources[docs[0].id].people[0],source:docs[0].id}]),[]);
 assert(!classifiedState.characters['the bodyguard']);
 assert(!ledgerRepairNeeded(classifiedState,{},story,history));


 const original='The man in travel-dark clothing watched from the yard door. Corven knocked twice and announced Jugram.';
 async function memoryStory(protectedLine=false,legacy=false) {
  const s=await db.stories.create({title:'Memory correction'});
  await db.messages.append(s.id,{role:'assistant',text:original,...(legacy?{findings:[{kind:'audit',words:'The record names the man as a captain without supporting evidence.'}]}:{})});
  await saveMemory(s.id,{window:12,nodes:[{id:'line',span:[0,0],text:"Prince William's captain watched from the yard door; Corven knocked twice and announced Jugram.",level:1,whole:true,...(legacy?{audited:1}:{}),...(protectedLine?{verified:{fixed:'the writer'}}:{})}]});
  await db.settings.set('essentials:'+s.id,{text:'Outdated captain account.',print:recordOf((await loadMemory(s.id)).nodes).print});
  return s;
 }
 const recordIssue={target:'record',pages:true,page:1,what:'The folded record gives the man an unsupported captain identity.',fix:'Do not rewrite the original story.',record:{fixes:[{from:"Prince William's captain",to:'man',shown:original,why:'The original identifies only a man in travel-dark clothing.'}]}};
 reply={issues:[recordIssue]};
 const s=await memoryStory();const beforeCalls=calls;
 const result=await auditStretch({connection,storyId:s.id,mend:async()=>{mends++;return [];}});
 assert.equal(result.lineMended,1);assert.equal(result.open,0);assert.equal(mends,0);
 let memory=await loadMemory(s.id);assert.equal(memory.nodes[0].text,'man watched from the yard door; Corven knocked twice and announced Jugram.');
 assert.equal((await db.messages.list(s.id))[0].text,original);
 assert.equal(await loadEssentials(s.id),null,'Contradictory old Essentials must not be injected.');
 assert.equal(await auditStretch({connection,storyId:s.id}),null);assert.equal(calls,beforeCalls+1);
 const rebuilt=await runEssentials({connection,storyId:s.id,nodes:memory.nodes,callLLM:async()=>({text:'- [Evening, yard] The man watched from the yard door. Corven knocked twice and announced Jugram at the queen’s door; both events remain in their original order.'})});
 assert(rebuilt.wrote);assert(await loadEssentials(s.id));
 const legacyStory=await memoryStory(false,true);
 const legacyResult=await auditStretch({connection,storyId:legacyStory.id});
 assert.equal(legacyResult.lineMended,1,'Reconsider an existing advisory without restarting historical coverage.');
 assert.equal(await auditStretch({connection,storyId:legacyStory.id}),null);
 const protectedStory=await memoryStory(true);
 const protectedResult=await auditStretch({connection,storyId:protectedStory.id});
 assert.equal(protectedResult.lineMended,0);assert(protectedResult.open>0);assert.equal(protectedResult.left,0);
 memory=await loadMemory(protectedStory.id);assert.match(memory.nodes[0].text,/captain/);
 assert.equal(nextStretch(memory,await db.messages.list(protectedStory.id)),null,'Unchanged unresolved protected memory does not loop.');
 memory.nodes[0].verified={};assert(nextStretch(memory,await db.messages.list(protectedStory.id)),'Changed protection reopens only this section.');
 await saveMemory(protectedStory.id,memory);
 const recoveredMemory=await auditStretch({connection,storyId:protectedStory.id});
 assert.equal(recoveredMemory.lineMended,1);assert.equal(recoveredMemory.open,0,'A successful targeted correction clears its pending status.');
 const removalStory=await memoryStory();
 const removalMemory=await loadMemory(removalStory.id);
 removalMemory.nodes[0].text="The man, William's captain, watched from the yard door; Corven knocked twice and announced Jugram.";
 await saveMemory(removalStory.id,removalMemory);
 reply={issues:[{target:'record',what:'Unsupported appositive title.',record:{fixes:[{from:", William's captain,",to:'',operation:'remove',shown:original,why:'The original supports the man and his action but not this title.'}]}}]};
 const removed=await auditStretch({connection,storyId:removalStory.id});
 assert.equal(removed.lineMended,1);assert.equal((await loadMemory(removalStory.id)).nodes[0].text,'The man watched from the yard door; Corven knocked twice and announced Jugram.');

 const genuine=parseStretchAnswer(JSON.stringify({issues:[{target:'story',pages:true,page:1,what:'The story incorrectly says the door is open.',fix:'The door was shut.',evidence:{page:'The door was open.',prior:'The door remains shut.',why:'No intervening action opens it.'}}]}));
 const eligible=scopeStretch(genuine.issues,{state:emptyState(),pages:[{role:'assistant',text:'The door was open.'}],pagesText:'The door was open.',priorText:'The door remains shut.',from:0,to:0});
 assert.equal(eligible.pageFixes.length,1);
 const realStory=await db.stories.create({title:'Actual page fault'});
 await db.messages.append(realStory.id,{role:'assistant',text:'The door was open.'});
 await saveMemory(realStory.id,{nodes:[{id:'door',span:[0,0],text:'The door was open.',level:1,whole:true}]});
 reply={issues:genuine.issues};
 const real=await auditStretch({connection,storyId:realStory.id,brief:'The door remains shut.',mend:async id=>{mends++;return [id];}});
 assert.equal(real.mendedPages,1);assert.equal(mends,1);
 const ambiguous=scopeStretch(parseStretchAnswer(JSON.stringify({issues:[{pages:true,page:1,what:'Possibly wrong captain identity.',fix:'Change the captain.'}]})).issues,{state:emptyState(),pagesText:original,from:0,to:0});
 assert.equal(ambiguous.pageFixes.length,0);assert.equal(ambiguous.unresolved.length,1);
 const additions=scopeStretch(parseStretchAnswer(JSON.stringify({issues:[{record:{detail:'Corven knocked twice'}}]})).issues,{state:emptyState(),pagesText:original,from:0,to:0});
 assert.equal(additions.unresolved.length,0,'Ordinary detail recovery remains supported.');
 // M723 causal recovery cases. No new sources or model calls for healthy sections.
 const broken={target:'record',what:'The captain attribution may be wrong.',record:{fixes:[]}};
 const fixedReply={outcome:'repair',why:'These originals establish only a man; no earlier identity evidence establishes a captain.',evidence:[{source:'1',shown:original}],record:{fixes:recordIssue.record.fixes}};
 let stage=0;
 reply=request=>{stage++;return request.includes('TARGETED HISTORICAL RECOVERY')?fixedReply:{issues:[broken]};};
 const automatic=await memoryStory();
 const auto=await auditStretch({connection,storyId:automatic.id});
 assert.equal(stage,2,'One initial reading and one targeted follow-up.');
 assert.equal(auto.open,0);assert.equal(auto.lineMended,1);
 assert.equal((await db.messages.list(automatic.id))[0].text,original);
 assert.equal((await loadMemory(automatic.id)).nodes[0].detail,undefined);
 assert.equal(await loadEssentials(automatic.id),null);
 const healthyCalls=calls;
 assert.equal(await auditStretch({connection,storyId:automatic.id}),null);
 assert.equal(auditWaits(automatic.id,await loadMemory(automatic.id),await db.messages.list(automatic.id)),-1);
 assert.equal(calls,healthyCalls);
 async function pendingStory() {
  const s=await memoryStory();const m=await loadMemory(s.id);
  m.nodes[0].audited=1;m.nodes[0].correctionReviewed=true;
  m.nodes[0].auditOpen=[{issue:broken,why:'Missing replacement text.',from:0,to:0,input:'old M722 fingerprint'}];
  await saveMemory(s.id,m);return s;
 }
 const savedPending=await pendingStory();
 reply=request=>{assert(request.includes('TARGETED HISTORICAL RECOVERY'));return fixedReply;};
 const savedCalls=calls;
 assert.equal(auditWaits(savedPending.id,await loadMemory(savedPending.id),await db.messages.list(savedPending.id)),0);
 assert.equal((await auditStretch({connection,storyId:savedPending.id})).open,0);
 assert.equal(calls,savedCalls+1,'An old finding goes directly to focused recovery, with no ordinary reread.');

 // Earlier original evidence can refute the allegation without changing memory.
 const earlier=await db.stories.create({title:'Established captain'});
 const earlierQuote="The man in travel-dark clothing is Prince William's captain.";
 await db.messages.append(earlier.id,{role:'user',text:earlierQuote});
 await db.messages.append(earlier.id,{role:'assistant',text:original});
 await saveMemory(earlier.id,{nodes:[{id:'earlier',span:[0,0],level:1,text:earlierQuote,audited:1,correctionReviewed:true},{id:'disputed',span:[1,1],level:1,text:"Prince William's captain watched from the yard door; Corven knocked twice.",audited:1,correctionReviewed:true,auditOpen:[{issue:broken,why:'Title not in local pages.',from:1,to:1,input:'old'}]}]});
 const earlierBefore=await loadMemory(earlier.id);let fetched=false;
 reply=request=>{assert(request.includes('TARGETED HISTORICAL RECOVERY'));if(!request.includes('Requested originals:'))return '<fetch>["1"]</fetch>';fetched=true;return {outcome:'correct',why:'The earlier writer page explicitly identifies this same man as the captain.',evidence:[{source:'1',shown:earlierQuote}]};};
 const correct=await auditStretch({connection,storyId:earlier.id});assert(fetched);assert.equal(correct.open,0);assert.equal(correct.recovery,'correct');
 const earlierAfter=await loadMemory(earlier.id);assert.equal(earlierAfter.nodes[1].text,earlierBefore.nodes[1].text);assert.deepEqual(earlierAfter.nodes[0],earlierBefore.nodes[0]);
 assert.equal(await auditStretch({connection,storyId:earlier.id}),null);

 const uncertain=await pendingStory();
 reply={outcome:'blocked',why:'Earlier evidence does not establish which man this description refers to.'};
 const uncertainty=await auditStretch({connection,storyId:uncertain.id});assert.equal(uncertainty.open,1);assert.equal(uncertainty.pending,0);
 assert.match(recoveryWords(uncertainty),/unresolved after automatic source review/);
 assert.equal(await auditStretch({connection,storyId:uncertain.id}),null);
 const persisted=await loadMemory(uncertain.id);assert.equal(persisted.nodes[0].auditOpen[0].recovery.attempts,1);
 const status=continuousRunStatus({...uncertainty,done:75,folded:75});assert.equal(status.unfinished,false);
 await noteWorkerRun(uncertain.id,'continuous',{ok:true,...status,detail:recoveryWords(uncertainty)});
 const row=(await loadWorkerStatus(uncertain.id)).continuous;
 assert.equal(historicalRunStatus(row).state,'part');assert(!historicalRunStatus(row).words.includes('partway'));assert.match(historicalRunStatus(row).words,/finished reviewing/);

 const failed=await pendingStory();reply='No usable structured response';
 const clock=Date.now;let now=clock();Date.now=()=>now;
 try {
  const failedFirst=await auditStretch({connection,storyId:failed.id});assert.equal(failedFirst.pending,1);
  let m=await loadMemory(failed.id);assert.equal(m.nodes[0].auditOpen[0].recovery.attempts,1);
  assert(auditWaits(failed.id,m,await db.messages.list(failed.id))>0);
  assert.equal(await auditStretch({connection,storyId:failed.id}),null);
  now+=RECOVERY_DELAY+1;
  const failedSecond=await auditStretch({connection,storyId:failed.id});assert.equal(failedSecond.open,1);assert.equal(failedSecond.pending,0);
  m=await loadMemory(failed.id);assert.equal(m.nodes[0].auditOpen[0].recovery.attempts,2);
  now+=RECOVERY_DELAY*10;assert.equal(auditWaits(failed.id,m,await db.messages.list(failed.id)),-1);
  assert.equal(await auditStretch({connection,storyId:failed.id}),null);
  // An actual source change, not reopening the app, permits another targeted attempt.
  const pages=await db.messages.list(failed.id);await db.messages.update(failed.id,pages[0].id,{text:original+' The writer confirms he is unidentified.'});
  assert.equal(auditWaits(failed.id,await loadMemory(failed.id),await db.messages.list(failed.id)),0);
 } finally {Date.now=clock;}

 // An earlier fetched original changing during recovery cannot clear an old allegation.
 const changedEarlier=await loadMemory(earlier.id);
 changedEarlier.nodes[1].auditOpen=[{issue:broken,why:'Recheck original identity.',from:1,to:1}];
 await saveMemory(earlier.id,changedEarlier);
 reply=async request=>{if(!request.includes('Requested originals:'))return '<fetch>["1"]</fetch>';
  const ps=await db.messages.list(earlier.id);await db.messages.update(earlier.id,ps[0].id,{text:'The man’s identity remains unknown.'});
  return {outcome:'correct',why:'Old identity evidence.',evidence:[{source:'1',shown:earlierQuote}]};};
 assert.equal(await auditStretch({connection,storyId:earlier.id}),null);
 const staleEvidence=await loadMemory(earlier.id);assert.equal(staleEvidence.nodes[1].auditOpen.length,1);
 assert.match(staleEvidence.nodes[1].auditOpen[0].recovery.reason,/Source evidence changed/);
 assert.equal(auditWaits(earlier.id,staleEvidence,await db.messages.list(earlier.id)),0);

 // Multiple failed fixes with the same prose allegation remain separate findings.
 const two=await pendingStory();const twoMemory=await loadMemory(two.id);
 twoMemory.nodes[0].auditOpen=[{issue:{...broken,record:{fixes:[{from:"Prince William's captain",to:'man'}]}},why:'Missing evidence',from:0,to:0},
  {issue:{...broken,record:{fixes:[{from:'Corven',to:'Another man'}]}},why:'Another distinct proposed fix',from:0,to:0}];
 await saveMemory(two.id,twoMemory);reply=fixedReply;
 const one=await auditStretch({connection,storyId:two.id});assert.equal(one.open,1,'Only the repaired finding clears.');
 assert.equal((await loadMemory(two.id)).nodes[0].auditOpen[0].issue.record.fixes[0].from,'Corven');

 // A new authoritative writer fact reopens a blocked finding, without a story rewrite.
 await db.stories.update(uncertain.id,{brief:'The yard-door man is an unidentified guest, not a captain.'});
 assert.equal(auditWaits(uncertain.id,await loadMemory(uncertain.id),await db.messages.list(uncertain.id),await db.stories.get(uncertain.id)),0);
 reply=fixedReply;assert.equal((await auditStretch({connection,storyId:uncertain.id})).open,0);

 // A crash after saving the edit but before clearing its finding resumes verification with zero model calls.
 const interrupted=await pendingStory();let interrupt=false;
 const settingsSet=db.settings.set;
 db.settings.set=async function(key,value) {const r=await settingsSet.call(this,key,value);if(key==='memory:'+interrupted.id && value.nodes[0].auditOpen?.[0]?.recovery?.status==='verifying') interrupt=true;return r;};
 try {reply=fixedReply;assert.equal(await auditStretch({connection,storyId:interrupted.id,stale:()=>interrupt}),null);} finally {db.settings.set=settingsSet;}
 const resumedCalls=calls;const resumed=await auditStretch({connection,storyId:interrupted.id});assert.equal(resumed.open,0);assert.equal(calls,resumedCalls);

 // A transport failure persists its retry, then recovers once after the idle delay.
 const transport=await pendingStory();let reject=true;
 reply=()=>{if(reject)throw new Error('Temporary fixture transport failure');return fixedReply;};
 const firstTransport=await auditStretch({connection,storyId:transport.id});assert.equal(firstTransport.open,1);assert.equal(firstTransport.pending,1);
 assert.match(firstTransport.unresolved[0].recovery.reason,/Provider transport failure/);
 const realClock=Date.now;Date.now=()=>realClock()+RECOVERY_DELAY+1;
 try {reject=false;assert.equal((await auditStretch({connection,storyId:transport.id})).open,0);} finally {Date.now=realClock;}

 // A concurrent edit wins over a previously read proposal.
 const staleStory=await pendingStory();
 reply=async()=>{const m=await loadMemory(staleStory.id);m.nodes[0].detail='A newer valid detail.';await saveMemory(staleStory.id,m);return fixedReply;};
 assert.equal(await auditStretch({connection,storyId:staleStory.id}),null);
 assert.equal((await loadMemory(staleStory.id)).nodes[0].detail,'A newer valid detail.');
 assert.match((await loadMemory(staleStory.id)).nodes[0].text,/captain/);
 console.log('M723 passed: automatic and saved-finding recovery, earlier-source withdrawal, bounded durable retries, uncertainty and manual protection, status round-trip, stale writes, Essentials invalidation, zero healthy-case calls. Mocked provider only.');
 console.log('M722 passed: idempotent/undoable source bindings, separate stable facts, paused review reuses receipts; grounded record correction, protected unresolved coverage, no unchanged repeat calls, Essentials invalidation and story-mend eligibility. Mocked provider only.');
} finally {globalThis.fetch=originalFetch;}
