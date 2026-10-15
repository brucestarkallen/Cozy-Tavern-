import './idb-shim.mjs';
import assert from 'node:assert/strict';
import {db} from '../../js/store.js';
import {emptyState,saveState,loadState} from '../../js/engine/state.js';
import {auditSources,missingSourcePeople,sourceFactScope,sourcePersonKey} from '../../js/agents/auditsources.js';
import {auditLedger,auditFindingId} from '../../js/agents/auditor.js';
import {ledgerVerificationRows,ledgerRepairInputKey,ledgerRepairStateKey,ledgerAuditVerified,ledgerRepairNeeded,saveAuditCheckpoint,repairRetryCheckpoint,LEDGER_REPAIR_POLICY} from '../../js/agents/auditprogress.js';
import {emptyPerson} from '../../js/engine/people.js';
import {healthSnapshot} from '../../js/agents/health.js';
const connection={type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'fixture',preset:'custom',contextSize:200000,reasoning:{effort:'off'}};
const fact="A chandler's boy on Cooper's Row, Ilvarren, retailing the Gilder's Row rich-cloak-and-cutpurse story";
const core=fact+' in the late morning.';
const original="On Cooper's Row, Ilvarren, a chandler's boy retailed the Gilder's Row rich-cloak-and-cutpurse story in the late morning. The salle ground-keeper swept elsewhere.";
const key="a chandler's boy",label="the chandler's boy";
const story=await db.stories.create({title:'Source fact closure'});
await db.messages.append(story.id,{role:'assistant',text:original});
const pages=await db.messages.list(story.id),documents=auditSources({messages:pages}),d=documents[0];
function fixture(profile=core,legacy=false) {
 const mention={name:label,kind:'person',ledgerName:key,identityResolution:{kind:'person',to:key,why:'The original speaker is this established individual.'},shown:original,facts:[],identityFacts:[{text:fact,shown:original}]};
 const state={...emptyState(),sheet:{actors:{},playerName:'Keir',playerAliases:[]},characters:{[key]:{...emptyPerson(),core:profile},Mira:{...emptyPerson(),core:'Manual biography stays.',hand:{core:true}}},auditSources:{[d.id]:{mark:d.mark,appearanceReviewed:true,profileReviewed:1,people:[mention,{name:'the salle ground-keeper',kind:'person',identityResolution:{kind:'person',scope:'local',why:'A distinct local worker.'},shown:original,facts:[],identityFacts:[]}]}}};
 const rows=ledgerVerificationRows(state),entries=Object.fromEntries(rows.map(r=>[r.id,{print:r.print,scope:r.scope,status:'correct',why:'Original evidence reviewed.',sourceRefs:[d.id]}]));
 if(profile!==core) delete entries['characters:'+key];
 const verification={source:ledgerRepairInputKey({},story,pages),ledger:ledgerRepairStateKey(state),entries,profiles:{},read:Object.keys(entries).length,total:rows.length};
 const issue={what:key+' has source identity facts to reconcile: '+fact,mutations:[],...(legacy?{sourceId:d.id,name:key,sourceFacts:true,profileRecovery:true}:{name:key,sourceId:d.id,sourceName:label,sourceFacts:true,profileRecovery:true,facts:mention.identityFacts,pages:false,shown:original})};
 state.audit={coverage:{read:1,total:1},verification,finalReview:{status:'ok'},unfinished:true,pending:[issue.what],unresolved:[issue],pausedPolicy:8,retryProgress:{source:ledgerRepairInputKey({},story,pages),bestPending:0,bestRead:1000,stalled:2}};
 state.audit.pausedInput=ledgerRepairInputKey(state,story,pages);state.audit.checkpoint=saveAuditCheckpoint(state,story,documents,verification);
 return state;
}
const fetchBefore=globalThis.fetch;let calls=0,mode='complete',lastRequest='';
const stream=value=>new Response('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify(value)}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
globalThis.fetch=async(_,options)=>{
 calls++;lastRequest=JSON.stringify(JSON.parse(options.body).messages);assert(!lastRequest.includes('SOURCE DOCUMENTS'));
 const tasks=JSON.parse(JSON.parse(options.body).messages.find(m=>m.role==='user').content.split('REQUIRED SOURCE MENTION DECISIONS:\n')[1].split('\n')[0]);
 const task=tasks.find(t=>t.sourceFacts);
 const reply={issues:[],review:{status:'complete',why:'The original fact is represented by the saved wording.',open:[]},standings:[]};
 if(mode==='open') {assert(task);reply.review.open=[{id:task.id,why:'The original relationship remains uncertain.'}];reply.issues=[{what:fixture().audit.unresolved[0].what,mutations:[]}];}
 if(mode==='repair') reply.issues=[{what:'Restore the actual missing source fact.',mutations:[{type:'people.note',name:key,field:'core',text:fact,shown:original}]}];
 if(mode==='concurrent') {const current=await loadState(story.id);current.characters[key].core='The writer changed this profile while reading.';await saveState(story.id,current);}
 return stream(reply);
};
try {
 const exact=fixture(core,true);assert.equal(missingSourcePeople(exact,[{...exact.auditSources[d.id].people[0],source:d.id}]).length,0);
 await saveState(story.id,exact);calls=0;
 const closed=await auditLedger({connection,storyId:story.id,reviewSources:'all'});
 assert.equal(closed.unfinished,false,'represented legacy source fact must close without rewriting the biography');
 assert.equal(calls,0,'matching completed receipts need no further model call');
 const cached=await loadState(story.id);assert(ledgerAuditVerified(cached,story,pages));assert.equal(cached.characters[key].core,core);
 assert((await auditLedger({connection,storyId:story.id,reviewSources:'all'})).unfinished===false);assert.equal(calls,0);
 const equivalent=fixture('A young candle seller from Cooper\'s Row in Ilvarren who spreads the rich cloak and cutpurse tale from Gilder\'s Row.');
 await saveState(story.id,equivalent);calls=0;mode='complete';
 const settled=await auditLedger({connection,storyId:story.id,reviewSources:'all'});
 assert.equal(settled.unfinished,false,JSON.stringify(settled.pending));assert.equal(calls,1);
 let saved=await loadState(story.id),mention={...saved.auditSources[d.id].people[0],source:d.id};
 const scope=sourceFactScope(saved,mention);assert(saved.audit.sourceFactDecisions[scope]);assert.equal(saved.characters[key].core,equivalent.characters[key].core);
 assert.deepEqual(saved.characters.Mira,equivalent.characters.Mira);assert.deepEqual(saved.auditSources[d.id].people[1],equivalent.auditSources[d.id].people[1]);
 assert(ledgerAuditVerified(saved,story,pages));assert.equal(healthSnapshot({state:saved,story,pages,shelf:{auditor:{ok:true,unfinished:true,at:saved.audit.at-1}}}).status,'green');
 assert.equal((await auditLedger({connection,storyId:story.id,reviewSources:'all'})).unfinished,false);assert.equal(calls,1);
 const changed=structuredClone(saved);changed.auditSources[d.id].mark+='changed';assert.equal(missingSourcePeople(changed,[mention]).length,1);
 const profileChanged=structuredClone(saved);profileChanged.characters[key].core='Only a boy.';assert.equal(missingSourcePeople(profileChanged,[mention]).length,1);
 const second={...mention,source:'distinct',ledgerName:undefined,identityResolution:undefined};
 assert.equal(sourcePersonKey(saved,second.name,second.ledgerName,second.identityResolution),'');assert.equal(missingSourcePeople(saved,[second]).length,1);
 await saveState(story.id,equivalent);mode='open';const open=await auditLedger({connection,storyId:story.id,reviewSources:'all'});
 // M752 (followup 21) — HIS (15 October 2026): "send them back and if can't debate then it's resolve". A fact the reader kept
 // open stayed owed on every audit until the automatic audit paused, the lamp yellow for good; it is now decided as left as it
 // stands, with the reader's own reason — the profile untouched — and the next unchanged audit owes nothing.
 saved=await loadState(story.id);assert.equal(open.unfinished,false,JSON.stringify(open.pending));assert(ledgerAuditVerified(saved,story,pages));
 assert(Object.values(saved.audit.sourceFactDecisions || {}).some(x=>/remains uncertain/.test(x.why)),'decided with the reader’s reason');
 assert.deepEqual(saved.characters[key],equivalent.characters[key],'the profile is left as it stands');assert.equal(healthSnapshot({state:saved,story,pages}).status,'green');
 {const before=calls;assert.equal((await auditLedger({connection,storyId:story.id,reviewSources:'all'})).unfinished,false,'not owed on the next audit');assert.equal(calls,before,'and that audit costs nothing');}
 await saveState(story.id,fixture('A candle seller.'));mode='repair';const repaired=await auditLedger({connection,storyId:story.id,reviewSources:'all'});
 saved=await loadState(story.id);assert.equal(repaired.unfinished,false,JSON.stringify(repaired.pending));assert(saved.characters[key].core.includes('A candle seller.'));assert(saved.characters[key].core.includes(fact));assert.deepEqual(saved.characters.Mira,equivalent.characters.Mira);
 await saveState(story.id,equivalent);mode='concurrent';const stale=await auditLedger({connection,storyId:story.id,reviewSources:'all'});
 saved=await loadState(story.id);assert(stale.unfinished);assert.equal(saved.characters[key].core,'The writer changed this profile while reading.');assert(!saved.audit.sourceFactDecisions?.[sourceFactScope(saved,{...saved.auditSources[d.id].people[0],source:d.id})]);
 // The historical zero is not a permanent baseline for later factual work.
 const before=fixture(),after=structuredClone(before);before.audit.pending=[];before.audit.unresolved=[];
 before.audit.retryProgress={source:ledgerRepairInputKey({},story,pages),policy:LEDGER_REPAIR_POLICY,work:[],bestPending:0,bestRead:1000,stalled:2};
 const progress=repairRetryCheckpoint(before,after,story,pages);assert.equal(progress.stalled,0);assert.equal(progress.bestPending,1);assert(progress.progress);
 after.audit.retryProgress=progress;const stuck=repairRetryCheckpoint(after,after,story,pages);assert.equal(stuck.stalled,1);after.audit.retryProgress=stuck;assert.equal(repairRetryCheckpoint(after,after,story,pages).stalled,2);
 assert(ledgerRepairNeeded(equivalent,{},story,pages),'changed policy resumes the previous paused repair once');
 assert.deepEqual(await db.messages.list(story.id),pages);
 console.log('PASS M743 auditor: represented legacy finding closes without calls, semantic scoped persistence, reload/source/profile invalidation, missing fact additive repair, distinct identity and local receipts, manual/concurrent preservation, a fact kept open is left as it stands with its reason (green), discovery resets zero baseline and repeated stalls stay bounded. Simulated provider, disposable IndexedDB.');
} finally {globalThis.fetch=fetchBefore;}
