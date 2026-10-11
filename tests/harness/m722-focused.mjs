import './idb-shim.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
 const ambiguousReply=(shown,why)=>({allegation:'unknown',outcome:'blocked',why,evidence:[{source:'1',shown}],
  sourceFidelity:{status:'genuinelyAmbiguous',claim:"Prince William's captain",sameReferent:null,sameEvent:true,
   assertion:'unclear',relation:'unclear',why,uncertainty:why,conflicts:[]}});

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
 reply=ambiguousReply(original,'Earlier evidence does not establish which man this description refers to.');
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
 // M724: the allegation is disproved, but the first operation contradicts that conclusion.
 const contradiction=await pendingStory();
 const captainQuote="A man in travel-dark lord's colors — Prince William's captain — stood at the yard door.";
 const cp=await db.messages.list(contradiction.id);
 await db.messages.update(contradiction.id,cp[0].id,{text:captainQuote});
 const intactRecord=(await loadMemory(contradiction.id)).nodes[0].text;
 let verdictCalls=0;
 reply=request=>{verdictCalls++;return {allegation:'disproved',outcome:verdictCalls===1?'blocked':'correct',why:'The original explicitly identifies the captain. The record is accurate; removing the title would be wrong.',evidence:[{source:'1',shown:captainQuote}]};};
 const reconciled=await auditStretch({connection,storyId:contradiction.id});
 assert.equal(reconciled.open,0,'A disproved allegation must not remain blocked.');
 assert.equal(verdictCalls,2,'One focused clarification reconciles the contradictory disposition.');
 assert.equal((await loadMemory(contradiction.id)).nodes[0].text,intactRecord);
 const settled=await loadMemory(contradiction.id);
 const receipt=settled.nodes[0].auditRecovery.at(-1);
 assert.equal(receipt.outcome,'correct');assert.equal(receipt.allegation,'disproved');assert.equal(receipt.noEdit,true);
 assert.equal(receipt.evidence[0].shown,captainQuote);
 const afterCalls=calls;
 assert.equal(auditWaits(contradiction.id,await loadMemory(contradiction.id),await db.messages.list(contradiction.id)),-1);
 assert.equal(await auditStretch({connection,storyId:contradiction.id}),null);assert.equal(calls,afterCalls);
 const complete=continuousRunStatus(reconciled);
 await noteWorkerRun(contradiction.id,'continuous',{ok:true,...complete,detail:recoveryWords(reconciled)});
 assert.equal(historicalRunStatus((await loadWorkerStatus(contradiction.id)).continuous).state,'good');
 assert.equal(auditProgress(settled,1).open,0);assert.equal(auditProgress(settled,1).pending,0);
 // The historical gate clears, while independently incomplete Auditor work still blocks verification.
 assert(ledgerAuditVerified(landed,story,history));assert(!ledgerAuditVerified(emptyState(),story,history));

 // A consistent supported correct verdict needs exactly one request; only its finding closes.
 const single=await pendingStory();const sp=await db.messages.list(single.id);
 await db.messages.update(single.id,sp[0].id,{text:captainQuote});
 const sm=await loadMemory(single.id);
 sm.nodes[0].auditOpen.push({issue:{target:'record',what:'A separate unresolved event.'},why:'Separate evidence is needed.',from:0,to:0});
 await saveMemory(single.id,sm);
 const correctReply={allegation:'disproved',outcome:'correct',why:'The original explicitly identifies this man as the captain.',evidence:[{source:'1',shown:captainQuote}]};
 reply=correctReply;const singleCalls=calls;
 assert.equal((await auditStretch({connection,storyId:single.id})).open,1);assert.equal(calls,singleCalls+1);
 assert.equal((await loadMemory(single.id)).nodes[0].auditOpen[0].issue.what,'A separate unresolved event.');

 // An M723 blocked checkpoint is reconsidered once, without resetting coverage.
 const legacyBlocked=await pendingStory();const lp=await db.messages.list(legacyBlocked.id);
 await db.messages.update(legacyBlocked.id,lp[0].id,{text:captainQuote});
 reply=ambiguousReply(captainQuote,'The previous checkpoint could not determine the referent.');
 await auditStretch({connection,storyId:legacyBlocked.id});
 const lm=await loadMemory(legacyBlocked.id);delete lm.nodes[0].auditOpen[0].recovery.dispositionPolicy;
 await saveMemory(legacyBlocked.id,lm);
 assert.equal(auditWaits(legacyBlocked.id,lm,await db.messages.list(legacyBlocked.id)),0);
 reply=correctReply;const legacyCalls=calls;
 const legacyDone=await auditStretch({connection,storyId:legacyBlocked.id});
 assert.equal(legacyDone.open,0);assert.equal(calls,legacyCalls+1);assert.equal(legacyDone.done,1);
 assert.equal(await auditStretch({connection,storyId:legacyBlocked.id}),null);

 // Missing disposition on a blocked legacy answer is clarified, without interpreting prose keywords.
 const omitted=await pendingStory();const op=await db.messages.list(omitted.id);
 await db.messages.update(omitted.id,op[0].id,{text:captainQuote});
 let omittedCalls=0;reply=request=>{omittedCalls++;if(omittedCalls===1)return {...correctReply,allegation:undefined,outcome:'blocked'};
  assert(request.includes('DISPOSITION CLARIFICATION'));return correctReply;};
 assert.equal((await auditStretch({connection,storyId:omitted.id})).open,0);assert.equal(omittedCalls,2);

 // Still inconsistent after one clarification stays visible and never loops on reload.
 const inconsistent=await pendingStory();reply={...correctReply,outcome:'blocked'};const inconsistentCalls=calls;
 const conflict=await auditStretch({connection,storyId:inconsistent.id});
 assert.equal(conflict.open,1);assert.equal(conflict.pending,0);assert.equal(calls,inconsistentCalls+2);
 assert.match(conflict.unresolved[0].recovery.reason,/inconsistent after clarification/);
 assert.equal(await auditStretch({connection,storyId:inconsistent.id}),null);

 // Fabricated evidence cannot dismiss a finding, regardless of the selected conclusion.
 const invalid=await pendingStory();reply={...correctReply,evidence:[{source:'1',shown:'This fabricated captain quotation never appeared.'}]};
 const invalidResult=await auditStretch({connection,storyId:invalid.id});assert.equal(invalidResult.open,1);
 assert.match(invalidResult.unresolved[0].recovery.reason,/incorrect original-source evidence/);
 assert.equal((await loadMemory(invalid.id)).nodes[0].auditRecovery?.length || 0,0);

 // Changed original dependencies reopen only the settled finding, including after promotion.
 const promoted=structuredClone(settled);
 promoted.nodes[0].id='promoted';promoted.nodes[0].level=2;
 await saveMemory(contradiction.id,promoted);
 const unchangedCalls=calls;
 assert.equal(await auditStretch({connection,storyId:contradiction.id}),null);assert.equal(calls,unchangedCalls);
 const pp=await db.messages.list(contradiction.id);
 await db.messages.append(contradiction.id,{role:'assistant',text:'An unrelated later event.'});
 assert.equal(await auditStretch({connection,storyId:contradiction.id}),null);
 await db.messages.update(contradiction.id,pp[0].id,{text:original});
 const changedPages=await db.messages.list(contradiction.id);
 assert.equal(auditProgress(await loadMemory(contradiction.id),changedPages.length,changedPages).open,1);
 assert.equal(auditWaits(contradiction.id,await loadMemory(contradiction.id),changedPages),0);
 reply=ambiguousReply(original,'The changed original no longer establishes this identity.');
 const changedDisposition=await auditStretch({connection,storyId:contradiction.id});assert.equal(changedDisposition.open,1);assert.equal(changedDisposition.pending,0);
 assert.equal(await auditStretch({connection,storyId:contradiction.id}),null);
 // Authoritative writer evidence is a dependency only when cited by the dismissal.
 const writerSupported=await pendingStory();await db.stories.update(writerSupported.id,{brief:captainQuote});
 reply={...correctReply,evidence:[{source:'brief',shown:captainQuote}]};
 assert.equal((await auditStretch({connection,storyId:writerSupported.id})).open,0);
 assert.equal(await auditStretch({connection,storyId:writerSupported.id}),null);
 await db.stories.update(writerSupported.id,{brief:'The man is not identified.'});
 const wm=await loadMemory(writerSupported.id),wp=await db.messages.list(writerSupported.id),ws=await db.stories.get(writerSupported.id);
 assert.equal(auditProgress(wm,wp.length,wp,ws).open,1);
 assert.equal(auditWaits(writerSupported.id,wm,wp,ws),0);
 reply=ambiguousReply(original,'The authoritative identity evidence has changed.');
 assert.equal((await auditStretch({connection,storyId:writerSupported.id})).open,1);
 assert.equal(await auditStretch({connection,storyId:writerSupported.id}),null);
 // M725: M724 accepted unknown/blocked even when the explanation refuted the allegation.
 const fidelityStory=await pendingStory();const fp=await db.messages.list(fidelityStory.id);
 await db.messages.update(fidelityStory.id,fp[0].id,{text:captainQuote});
 const fidelityBefore=await loadMemory(fidelityStory.id);
 const essentialsBefore=await db.settings.get('essentials:'+fidelityStory.id);
 const supportedFidelity={status:'supported',claim:"Prince William's captain",sameReferent:true,sameEvent:true,
  assertion:'direct',relation:'supports',preservesAssertion:true,conflicts:[],why:'The narrative directly identifies the same man at the same yard door event.'};
 let fidelityCalls=0;
 reply=request=>{fidelityCalls++;assert(request.includes('TARGETED HISTORICAL RECOVERY'));
  return {...correctReply,allegation:'unknown',outcome:'blocked',why:'The record faithfully preserves the original assertion. No edit should be made.',
   ...(fidelityCalls>1?{sourceFidelity:supportedFidelity}:{})};};
 const fidelityResult=await auditStretch({connection,storyId:fidelityStory.id});
 assert.equal(fidelityResult.open,0,'M725: an unknown/blocked operation cannot strand a source-supported false allegation.');
 assert.equal(fidelityCalls,2,'One targeted clarification requests the missing source fidelity decision.');
 assert.equal((await loadMemory(fidelityStory.id)).nodes[0].text,fidelityBefore.nodes[0].text);
 assert.equal((await db.messages.list(fidelityStory.id))[0].text,captainQuote);
 assert.deepEqual(await db.settings.get('essentials:'+fidelityStory.id),essentialsBefore);
 const fidelitySaved=await loadMemory(fidelityStory.id);
 assert.equal(fidelitySaved.nodes[0].auditRecovery.at(-1).sourceFidelity.status,'supported');
 assert.equal(fidelitySaved.nodes[0].auditRecovery.at(-1).reportedOutcome,'blocked');
 assert.equal(fidelitySaved.nodes[0].auditRecovery.at(-1).allegation,'disproved');
 assert.equal(fidelityResult.pending,0);
 const fidelityDoneCalls=calls;
 assert.equal(await auditStretch({connection,storyId:fidelityStory.id}),null);assert.equal(calls,fidelityDoneCalls);

 // Existing M724 checkpoints receive one scoped policy transition, not another reading.
 const m724Blocked=await pendingStory();const bps=await db.messages.list(m724Blocked.id);
 await db.messages.update(m724Blocked.id,bps[0].id,{text:captainQuote});
 reply=ambiguousReply(captainQuote,'Previous review left the identity unresolved.');
 await auditStretch({connection,storyId:m724Blocked.id});
 const blocked724=await loadMemory(m724Blocked.id);
 blocked724.nodes[0].auditOpen[0].recovery.dispositionPolicy=1;
 await saveMemory(m724Blocked.id,blocked724);
 assert.equal(auditWaits(m724Blocked.id,blocked724,await db.messages.list(m724Blocked.id)),0);
 const directCalls=calls;
 reply={...correctReply,allegation:'unknown',outcome:'blocked',sourceFidelity:supportedFidelity};
 const legacy725=await auditStretch({connection,storyId:m724Blocked.id});assert.equal(legacy725.open,0);
 assert.equal(calls,directCalls+1,'Consistent source fidelity controls settlement without an extra clarification.');
 assert.equal(legacy725.done,1);assert.equal(await auditStretch({connection,storyId:m724Blocked.id}),null);

 // Matching words about a DIFFERENT person never settle this record claim.
 const other=await pendingStory();const ops=await db.messages.list(other.id);
 const otherQuote="Prince William's captain was upstairs. A different man stood at the yard door.";
 await db.messages.update(other.id,ops[0].id,{text:otherQuote});
 let otherCalls=0;
 reply=()=>{otherCalls++;return {...correctReply,evidence:[{source:'1',shown:otherQuote}],
  sourceFidelity:{...supportedFidelity,sameReferent:false,status:otherCalls===1?'supported':'genuinelyAmbiguous',
   why:'The quoted captain is upstairs; the record concerns a different yard-door man.',uncertainty:'The yard-door man is not identified by this captain reference.'}};};
 const otherResult=await auditStretch({connection,storyId:other.id});assert.equal(otherResult.open,1);assert.equal(otherResult.pending,0);assert.equal(otherCalls,2);
 assert.equal((await loadMemory(other.id)).nodes[0].auditRecovery?.length || 0,0);
 assert.equal(await auditStretch({connection,storyId:other.id}),null);

 // An ambiguous label cannot contradict structured direct support with no actual conflict.
 const vague=await pendingStory();const vps=await db.messages.list(vague.id);
 await db.messages.update(vague.id,vps[0].id,{text:captainQuote});let vagueCalls=0;
 reply=()=>{vagueCalls++;return {...correctReply,allegation:'unknown',outcome:'blocked',sourceFidelity:{...supportedFidelity,
  status:vagueCalls===1?'genuinelyAmbiguous':'supported',uncertainty:'Perhaps an unseen source could disagree.'}};};
 assert.equal((await auditStretch({connection,storyId:vague.id})).open,0);assert.equal(vagueCalls,2);

 // A source-grounded contradiction uses the existing precise repair and Essentials invalidation.
 const wrong=await pendingStory();const wps=await db.messages.list(wrong.id);
 const contrary='The man at the yard door is an unranked visitor, not the captain. Corven knocked twice and announced Jugram.';
 await db.messages.update(wrong.id,wps[0].id,{text:contrary});
 reply={outcome:'blocked',allegation:'unknown',why:'The original contradicts this title.',evidence:[{source:'1',shown:contrary}],
  sourceFidelity:{...supportedFidelity,status:'contradicted',assertion:'negated',relation:'contradicts',why:'The same yard-door man is explicitly not the captain.'},
  record:{fixes:[{from:"Prince William's captain",to:'man',shown:contrary,why:'Preserve the man and event without the contradicted title.'}]}};
 const repaired725=await auditStretch({connection,storyId:wrong.id});assert.equal(repaired725.open,0);
 assert.equal((await loadMemory(wrong.id)).nodes[0].text,'man watched from the yard door; Corven knocked twice and announced Jugram.');
 assert.equal((await db.messages.list(wrong.id))[0].text,contrary);assert.equal(await loadEssentials(wrong.id),null);

 // Protected but correct words may be confirmed, with no rewrite or Essentials rebuild.
 const owned=await pendingStory();const ownedMemory=await loadMemory(owned.id);ownedMemory.nodes[0].verified={fixed:'the writer'};
 await saveMemory(owned.id,ownedMemory);const ownedPages=await db.messages.list(owned.id);
 await db.messages.update(owned.id,ownedPages[0].id,{text:captainQuote});
 reply={...correctReply,sourceFidelity:supportedFidelity};
 assert.equal((await auditStretch({connection,storyId:owned.id})).open,0);
 assert.equal((await loadMemory(owned.id)).nodes[0].text,ownedMemory.nodes[0].text);
 assert.deepEqual((await loadMemory(owned.id)).nodes[0].verified,ownedMemory.nodes[0].verified);

 // A fabricated fidelity quotation gets one clarification, never a dismissal.
 const falseProof=await pendingStory();
 reply={...correctReply,evidence:[{source:'1',shown:'Invented original evidence of a captain.'}],sourceFidelity:supportedFidelity};
 const falseResult=await auditStretch({connection,storyId:falseProof.id});assert.equal(falseResult.open,1);assert.equal(falseResult.pending,0);
 assert.match(falseResult.unresolved[0].recovery.reason,/incorrect original-source evidence/);
 assert.equal(await auditStretch({connection,storyId:falseProof.id}),null);

 // Execute the actual lamp state/class code against controlled completed ledger state.
 // This is a state/DOM-facade check, not a live browser or an owner database test.
 const chatSource=readFileSync(new URL('../../js/ui/chat.js',import.meta.url),'utf8');
 const lampStart=chatSource.indexOf('      const busy = runningWorkers(storyId).length > 0 || queuedCount(storyId) > 0;');
 const lampEnd=chatSource.indexOf('      /* M275:',lampStart);
 assert(lampStart>0 && lampEnd>lampStart);
 const lamp=new Function('auditRead','verificationNeeded','shelf',`
  const storyId='controlled',runningWorkers=()=>[],queuedCount=()=>0;
  const trouble=false,partly=false,behind=false,ran=4,told=1,guards=[],repairOwed=false,repairPaused=false,openAudit=false;
  const otherHandAt=()=>false,ledgerBehind=false,sore=[],part=[],savedAudit={},unfoldedForGood=false;
  let ledgerMark;const classes=new Set();const btn={classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name)},setAttribute:()=>{}};
  ${chatSource.slice(lampStart,lampEnd)}
  return {ledgerMark,green:classes.has('all-well'),yellow:classes.has('has-trouble')};`);
 await noteWorkerRun(fidelityStory.id,'continuous',{ok:true,...continuousRunStatus(fidelityResult),detail:recoveryWords(fidelityResult)});
 const fidelityShelf=await loadWorkerStatus(fidelityStory.id);
 const verified=!ledgerAuditVerified(landed,story,history);
 assert.equal(verified,false);
 assert.deepEqual(lamp(auditProgress(fidelityBefore,1),verified,fidelityShelf),{ledgerMark:'trouble',green:false,yellow:true});
 assert.deepEqual(lamp(auditProgress(fidelitySaved,1),verified,fidelityShelf),{ledgerMark:'well',green:true,yellow:false});
 assert.equal(lamp(auditProgress(fidelitySaved,1),true,fidelityShelf).green,false,'Independent Auditor verification is still required.');
 assert.equal(historicalRunStatus(fidelityShelf.continuous).state,'good');
 console.log('M725 passed: unknown/blocked reproduction settles via source fidelity, one clarification maximum, policy-1 recovery, different referent and invalid evidence rejected, genuine ambiguity bounded, exact repairs preserved, no-edit memory/Essentials retained, controlled production lamp changes from yellow to green with other verification complete. Mocked provider and DOM facade only.');
 console.log('M724 passed: contradictory and omitted dispositions clarified once, supported dismissal without edits, one-time legacy recovery, exact finding settlement, invalid evidence rejection, persisted receipts, changed-source reopening, truthful completion, zero unchanged-material calls. Mocked provider only.');
 console.log('M723 passed: automatic and saved-finding recovery, earlier-source withdrawal, bounded durable retries, uncertainty and manual protection, status round-trip, stale writes, Essentials invalidation, zero healthy-case calls. Mocked provider only.');
 console.log('M722 passed: idempotent/undoable source bindings, separate stable facts, paused review reuses receipts; grounded record correction, protected unresolved coverage, no unchanged repeat calls, Essentials invalidation and story-mend eligibility. Mocked provider only.');
} finally {globalThis.fetch=originalFetch;}
