import './idb-shim.mjs';
import assert from 'node:assert/strict';
import {db} from '../../js/store.js';
import {emptyState,saveState,loadState} from '../../js/engine/state.js';
import {auditSources,missingSourcePeople} from '../../js/agents/auditsources.js';
import {applyMutations,undoLast} from '../../js/engine/apply.js';
import {healthSnapshot,reconciledWorkerStatus} from '../../js/agents/health.js';
import {auditLedger} from '../../js/agents/auditor.js';
import {ledgerRepairNeeded,ledgerVerificationRows,ledgerRepairInputKey,ledgerRepairStateKey,ledgerAuditVerified,saveAuditCheckpoint} from '../../js/agents/auditprogress.js';
const connection={type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'fixture',preset:'custom',contextSize:200000,reasoning:{effort:'off'}};
const story=await db.stories.create({title:'Voice identity dependency'});
await db.messages.append(story.id,{role:'assistant',text:'The empty courtyard fell quiet.',voices:[{speaker:'Tarn, an off-duty guard',channel:'the gate',content:'I will take the next watch.'},{speaker:'a feed-sack groom',content:'The horses are fed.'},{speaker:"the queen's maid",content:'I will return with the linen.'},{speaker:'a scullery girl',content:'The pot is clean.'}]});
const pages=await db.messages.list(story.id),docs=auditSources({messages:pages}),voice=docs.find(d=>d.id.startsWith('voice:'));
let state={...emptyState(),sheet:{playerName:'Keir',actors:{}},characters:{'a feed-sack groom':{core:''},Mira:{core:'An archivist.',hand:{core:true}}},auditSources:Object.fromEntries(docs.map(d=>[d.id,{mark:d.mark,appearanceReviewed:true,profileReviewed:1,people:(d===voice?['Tarn','an off-duty guard']:d.id.startsWith('voice:')?[pages[0].voices[Number(d.id.split(':').at(-2))].speaker]:[]).map(name=>({name,kind:'person',shown:d.text,identityFacts:[],facts:[]}))}]))};
const rows=ledgerVerificationRows(state),verification={source:ledgerRepairInputKey(state,story,pages),ledger:ledgerRepairStateKey(state),read:rows.length,total:rows.length,entries:Object.fromEntries(rows.map(r=>[r.id,{print:r.print,scope:r.scope,status:'correct',why:'Previously reviewed.'}])),profiles:{}};
const findings=missingSourcePeople(state,docs.flatMap(d=>state.auditSources[d.id].people.map(p=>({...p,source:d.id,label:d.label}))));
state.audit={verification,coverage:{read:docs.length,total:docs.length},finalReview:{status:'ok'},unresolved:findings,unfinished:true,pending:findings.map(i=>i.what)};
state.audit.checkpoint=saveAuditCheckpoint(state,story,docs,verification);await saveState(story.id,state);state=await loadState(story.id);
let calls=0,mode='complete';const originalFetch=globalThis.fetch;
globalThis.fetch=async(_,options)=>{
 calls++;const request=JSON.stringify(JSON.parse(options.body).messages);assert(!request.includes('SOURCE DOCUMENTS'));
 const reply={issues:[{what:'Bind the named guard.',mutations:[{type:'source.resolve',sourceId:voice.id,name:'Tarn',to:'Tarn',kind:'person',cause:'The voice names this guard.'}]}],profiles:[{name:'Tarn',core:{text:'An off-duty guard.',shown:voice.text}},{name:"the queen's maid",open:true}],identities:[{sourceId:voice.id,name:'an off-duty guard',to:'Tarn',kind:'person',why:'The same named speaker.'},...docs.filter(d=>d.id.startsWith('voice:') && d!==voice).map(d=>{const name=state.auditSources[d.id].people[0].name;return {sourceId:d.id,name,kind:'person',...(name==='a scullery girl'?{scope:'local'}:{to:name}),why:name==='a scullery girl'?'A temporary distinct speaker with no continuing identity established.':'The actual continuing person identified by this source.'};})],review:{status:'complete',why:'The sourced identity and its local description are consistent.',open:[]},standings:[]};
 const continued=JSON.parse(options.body).messages.some(m=>m.role==='assistant');
 if (mode==='prerequisite' && !continued) reply.profiles=[];
 if (mode==='prerequisite' && continued) {assert(request.includes('supply the actual established person'));assert(request.includes('availablePeople'));}
 if (mode==='ambiguous') {reply.identities=reply.identities.filter(i=>i.name!=='a scullery girl');reply.review.open=[{id:JSON.parse(JSON.parse(options.body).messages.find(m=>m.role==='user').content.split('REQUIRED SOURCE MENTION DECISIONS:\n')[1].split('\n')[0]).find(t=>t.name==='a scullery girl').id,why:'The source does not establish whether this is the missing continuing person.'}];}
 if (mode==='stale') await db.messages.update(story.id,pages[0].id,{text:'The writer changed the original while the audit was reading.'});
 if (mode==='manual') {const current=await loadState(story.id);current.characters.Mira.core='A manual revision during review.';await saveState(story.id,current);reply.issues.push({what:'Overwrite protected biography.',mutations:[{type:'people.set',name:'Mira',field:'core',text:'An invented biography.'}]});}
 return new Response('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify(reply)}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
};
try {
 const result=await auditLedger({connection,storyId:story.id,reviewSources:'all'});
 assert.equal(result.unfinished,false,JSON.stringify(result.pending));
 const saved=await loadState(story.id);assert(ledgerAuditVerified(saved,story,pages));assert.equal(calls,1);
 assert.equal(saved.auditSources[voice.id].people[0].ledgerName,'Tarn');
 assert.equal(saved.auditSources[voice.id].people[1].ledgerName,'Tarn');
 assert.equal(findings.length,5);
 assert.equal(saved.characters["the queen's maid"].core,'');
 assert.equal(saved.characters['a scullery girl'],undefined);
 assert.equal(saved.characters['a feed-sack groom'].core,'');
 assert.deepEqual(saved.characters.Mira,state.characters.Mira);assert.deepEqual(await db.messages.list(story.id),pages);
 assert(!ledgerRepairNeeded(saved,{},story,pages));
 const count=calls;assert.equal((await auditLedger({connection,storyId:story.id,reviewSources:'all'})).unfinished,false);assert.equal(calls,count);
 const old={auditor:{ok:false,at:saved.audit.at-1,why:'Earlier failed repair.'}};
 const reconciled=reconciledWorkerStatus(old,saved,story,pages);assert(reconciled.auditor.ok);assert.equal(old.auditor.ok,false);
 assert.equal(healthSnapshot({state:saved,story,pages,shelf:old,guards:['auditor']}).status,'green');
 assert.equal(healthSnapshot({state:saved,story,pages,shelf:{...old,world:{ok:false,why:'Transport unavailable.'}},guards:['auditor']}).status,'yellow');
 const voiceWarning={world:{ok:true,unfinished:true,at:saved.audit.at-1,resume:'voice-identities:'+pages[0].id}};
 assert.equal(healthSnapshot({state:saved,story,pages,shelf:voiceWarning}).status,'green');
 assert.equal(healthSnapshot({state:{...saved,audit:{...saved.audit,unfinished:true}},story,pages,shelf:voiceWarning,repairOwed:true,workerRecovery:{world:{eligible:true}}}).next,'auditor');
 assert.equal(healthSnapshot({state:saved,story,pages,shelf:old,running:['world']}).status,'working');
 const reopened={...saved,audit:{...saved.audit,unfinished:true,pending:['Uncertain speaker.']}};
 assert.equal(reconciledWorkerStatus(old,reopened,story,pages),old);assert.equal(healthSnapshot({state:reopened,story,pages,shelf:{auditor:{ok:true}}}).status,'yellow');
 const localDoc=docs.at(-1),localOp={type:'source.resolve',sourceId:localDoc.id,name:'a scullery girl',kind:'person',scope:'local',cause:'A distinct source-local person.',auditorApproved:true,source:'auditor'};
 assert.equal(applyMutations(saved,[localOp]).applied.length,0);
 const localBase={...saved,auditSources:{...saved.auditSources,other:{mark:'other',people:[{name:'a scullery girl',kind:'person',shown:'Another girl speaks.',facts:[],identityFacts:[]}]}}};
 assert.equal(missingSourcePeople(localBase,[{...localBase.auditSources.other.people[0],source:'other'}]).length,1);
 const other=applyMutations(localBase,[{...localOp,sourceId:'other'}]);assert.equal(other.applied.length,1);
 assert.equal(undoLast(other.state).state.auditSources.other.people[0].identityResolution,undefined);
 const invalid=applyMutations(saved,[{...localOp,scope:undefined,to:'Unestablished Person'}]);assert.equal(invalid.applied.length,0);assert.match(invalid.rejected[0].why,/actual established person/);
 const actor=applyMutations({...localBase,sheet:{...localBase.sheet,actors:{'Quiet Visitor':{}}}},[{...localOp,sourceId:'other',scope:undefined,to:'Quiet Visitor'}]);assert.equal(actor.applied.length,1);
 const retired=applyMutations({...localBase,characters:{...localBase.characters,Selene:{core:'',retired:true,aliases:['Sela']}}},[{...localOp,sourceId:'other',scope:undefined,to:'Sela'}]);assert.equal(retired.applied.length,1);assert.equal(retired.state.auditSources.other.people[0].ledgerName,'Selene');
 const object=applyMutations(localBase,[{...localOp,sourceId:'other',scope:undefined,kind:'object',cause:'The source actually describes a statue.'}]);assert.equal(object.applied.length,1);
 await saveState(story.id,state);mode='prerequisite';calls=0;
 const corrected=await auditLedger({connection,storyId:story.id,reviewSources:'all'});assert.equal(corrected.unfinished,false,JSON.stringify(corrected.pending));assert.equal(calls,2);
 await saveState(story.id,state);mode='ambiguous';calls=0;
 // M752 (followup 21) — HIS (15 October 2026): "send them back and if can't debate then it's resolve". An ambiguity was kept
 // open here, and so owed on every pass until the automatic audit paused; a description the reader cannot tie to anyone is
 // now kept as a person of its page only, with the reader's own reason, and the audit completes (a NAME stays owed: M732).
 const blocked=await auditLedger({connection,storyId:story.id,reviewSources:'all'});assert.equal(blocked.unfinished,false,JSON.stringify(blocked.pending));
 {const after=await loadState(story.id),girl=Object.values(after.auditSources).flatMap(r=>r.people||[]).find(p=>p.name==='a scullery girl');
  assert.equal(girl.identityResolution.scope,'local');assert.match(girl.identityResolution.why,/does not establish whether this is the missing continuing person/);
  assert.equal(girl.ledgerName,'');assert(ledgerAuditVerified(after,story,pages));}
 await saveState(story.id,state);mode='manual';
 await auditLedger({connection,storyId:story.id,reviewSources:'all'});assert.equal((await loadState(story.id)).characters.Mira.core,'A manual revision during review.');
 await saveState(story.id,state);mode='stale';
 assert.equal(await auditLedger({connection,storyId:story.id,reviewSources:'all'}),null);assert.equal((await loadState(story.id)).characters.Tarn,undefined);
 console.log('PASS M731: five voice findings settle, profile ordering, empty biography, source-local identities, undo, cached receipts and zero unchanged calls, exact prerequisite clarification, an ambiguous description set aside as a person of its page with its reason, manual/concurrent source protection, verified versus stale worker status. Scripted provider and disposable IndexedDB shim.');
} finally {globalThis.fetch=originalFetch;}
