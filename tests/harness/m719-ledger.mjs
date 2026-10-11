import './idb-shim.mjs';
import assert from 'node:assert/strict';
import {db} from '../../js/store.js';
import {emptyState,loadState,saveState} from '../../js/engine/state.js';
import {applyMutations,undoLast} from '../../js/engine/apply.js';
import {seat} from '../../js/engine/offscreen.js';
import {worldParticipation,renderPeopleTiers} from '../../js/engine/people.js';
import {peopleForWorld,worldOwed,worldSeatView,worldReviewPlan,worldTurn} from '../../js/agents/world.js';
import {auditSources,missingSourcePeople,missingLedgerPeople,reviewAuditSources} from '../../js/agents/auditsources.js';
import {auditLedger,seatHousekeeping,reconcileAuditScene,carriedBy} from '../../js/agents/auditor.js';
import {ledgerAuditVerified,ledgerRepairNeeded,repairRetryCheckpoint} from '../../js/agents/auditprogress.js';
import {workerPeopleContext,retainPeopleFailures,workerProfileSources} from '../../js/agents/ledgercontext.js';
import {buildRequest} from '../../js/assemble/stack.js';
import {requestTokens,inputRoom} from '../../js/assemble/budget.js';
const connection={type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'fixture',preset:'custom',contextSize:200000,reasoning:{effort:'off'}};
const courier='the annual courier';
const base={...emptyState(),page:60,clock:{minutes:600},sheet:{playerName:'Jovan',actors:{}},characters:{},offscreen:{[courier]:{location:'the road',activity:'delivering a letter',agenda:'deliver the letter',stance:'toward',arrivesAtMinutes:630,sinceMinutes:590,atTurn:59}}};
assert.deepEqual(missingLedgerPeople(base),[]);
assert.deepEqual(missingSourcePeople(base,[{name:courier,kind:'person',source:'old',identityFacts:[],facts:[]}]),[]);
assert(worldParticipation(base,courier));
const courierDone=applyMutations({...base,characters:{[courier]:{core:''}}},[
 {type:'offscreen.set',name:courier,location:'the post station',activity:'delivery completed',agenda:'',stance:'busy',cause:'The letter was delivered.'},
 {type:'people.retire',name:courier,cause:'The delivery ended with no further obligation.'},{type:'offscreen.clear',name:courier}]);
assert(courierDone.state.characters[courier].retired);assert(!courierDone.state.offscreen[courier]);assert.equal(courierDone.state.characters[courier].core,'');
const princessQuote='The third princess is the queen’s youngest daughter, a distinct individual with silver hair.';
const historical=[{id:'scene10',role:'user',text:princessQuote},{id:'scene10story',role:'assistant',text:'The herald introduced her.'},...Array.from({length:98},(_,i)=>({id:'later'+i,role:i%2?'assistant':'user',text:i%2?'The hall was quiet.':'Wait.'}))];
const docs=auditSources({messages:historical});
const originalFetch=globalThis.fetch;
let sourceCalls=0,finalCalls=0,mode='princess';
globalThis.fetch=async(_,options)=>{
 const body=JSON.parse(options.body),user=body.messages.findLast(m=>m.role==='user').content;
 let reply;
 if(user.includes('SOURCE DOCUMENTS\n')) {
  sourceCalls++;
  const batch=JSON.parse(user.split('SOURCE DOCUMENTS\n')[1]);
  reply={checked:batch.map(d=>d.id),people:batch.filter(d=>d.passages.some(p=>p.text.includes(princessQuote))).map(d=>({name:'the third princess',kind:'person',source:d.id,evidence:d.passages[0].id,identityFacts:[{text:'The queen’s youngest daughter, the third princess.',evidence:d.passages[0].id}],facts:[{key:'hair',value:'silver',evidence:d.passages[0].id}]}))};
 } else {
  finalCalls++;
  reply={issues:[],standings:[],review:{status:'complete',why:'Original sources and actual current records reviewed. Optional biography remains unknown.',open:[]},
   ...(mode==='princess'?{profiles:[{name:'the third princess',core:{text:'The queen’s youngest daughter, the third princess.',shown:princessQuote},facts:[{key:'hair',value:'silver',shown:princessQuote}]}]}:{})};
 }
 const content=JSON.stringify(reply);
 return new Response('data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
};
try {
 const reviewed=await reviewAuditSources({connection,documents:docs,state:base,mode:'all'});
 assert.equal(reviewed.read,docs.length);
 assert.equal(missingSourcePeople(base,reviewed.people).length,1,'Original review finds the absent unnamed princess.');
 assert.equal((await reviewAuditSources({connection,documents:docs,state:base,previous:reviewed.cache,mode:'all'})).calls,0);
 const story=await db.stories.create({title:'M719 original omission'});
 for(const m of historical) await db.messages.append(story.id,m);
 const pages=await db.messages.list(story.id),actualDocs=auditSources({messages:pages});
 const cache=Object.fromEntries(actualDocs.map((d,i)=>[d.id,{...reviewed.cache[docs[i].id],mark:d.mark}]));
 await saveState(story.id,{...base,audit:{unfinished:true,pending:[courier+' is already tracked but has no identity on their People page'],unresolved:[{what:courier+' is already tracked but has no identity on their People page',mutations:[]}]},auditSources:cache,characters:{'the first princess':{core:'The eldest daughter.',hand:{core:true}}}});
 const audited=await auditLedger({connection,storyId:story.id,reviewSources:'all'});
 assert(audited);assert.equal(audited.unfinished,false,JSON.stringify(audited.pending));
 let state=await loadState(story.id);
 assert.equal(state.characters['the first princess'].core,'The eldest daughter.');
 assert.equal(state.characters['the third princess'].core,'The queen’s youngest daughter, the third princess.');
 assert.equal(state.canon['the third princess'].facts.find(f=>f.key==='hair').value,'silver');
 assert(!state.characters[courier]?.core,'Courier biography is not invented.');
 assert(ledgerAuditVerified(state,story,pages));assert(!ledgerRepairNeeded(state,{},story,pages));
 const callsBefore=finalCalls;
 mode='courier';await auditLedger({connection,storyId:story.id,reviewSources:'all'});
 assert.equal(finalCalls,callsBefore,'Completed unchanged review reuses its approval.');
 assert(ledgerAuditVerified(await loadState(story.id),story,pages));
 assert(!ledgerAuditVerified(state,story,pages.map((m,i)=>i===0?{...m,text:m.text+' Her eyes are blue.'}:m)));
 assert(!ledgerAuditVerified(undoLast(state).state,story,pages));
 let stuck={...base,audit:{unfinished:true,pending:['a genuine unsupported correction'],coverage:{read:0,total:1}}};
 for(let i=0;i<3;i++) stuck={...stuck,audit:{...stuck.audit,retryProgress:repairRetryCheckpoint(stuck,stuck,story,pages)}};
 assert(stuck.audit.retryProgress.stalled>=2,'Genuine unchanged failures retain bounded retry accounting.');
 assert.deepEqual((await db.messages.list(story.id)).map(m=>m.text),historical.map(m=>m.text));
} finally {globalThis.fetch=originalFetch;}
// An ordinary paid journey retains its history and description without recurring simulation.
let driver={...base,offscreen:{Michael:{location:'the taxi stand',activity:'fare completed',sinceMinutes:1,atTurn:1}},characters:{Michael:{core:'A driver with blue eyes.',firstSeenTurn:60,updatedAtTurn:1}},canon:{Michael:{facts:[{key:'eyes',value:'blue'}]}}};
assert.equal(worldParticipation(driver,'Michael'),'');
assert(!worldOwed(driver).includes('Michael'));
let unseated={...driver,offscreen:{}};assert(!peopleForWorld(unseated).unseated.includes('Michael'),'Newcomer and appearance weights do not require World activity.');
for(let turn=2;turn<60;turn++) driver.offscreen=seat(driver.offscreen,'Michael',{location:'the taxi stand',activity:'waiting'},turn,turn);
assert.equal(driver.offscreen.Michael.firstAtTurn,1);
assert.equal(carriedBy(driver,'Michael'),'','Repeated seat writes cannot keep a passerby fresh forever.');
const retired=applyMutations(driver,seatHousekeeping(driver));
assert(retired.state.characters.Michael.retired);assert(!retired.state.offscreen.Michael);
assert.equal(retired.state.characters.Michael.core,driver.characters.Michael.core);
assert.deepEqual(retired.state.canon,driver.canon);
assert(retired.state.characters.Michael.lastKnown.historical);
assert(workerPeopleContext(retired.state,{material:'Michael returns.'}).includes('blue eyes'));
assert(JSON.stringify(renderPeopleTiers(retired.state,{recentPages:['Michael returns.']})).includes('blue eyes'));
const woke=applyMutations(retired.state,[{type:'people.wake',name:'Michael',cause:'He returns.'}]);
assert(!woke.state.characters.Michael.retired);
let retirementCalls=0;
const retiringStory=await db.stories.create({title:'Completed fare'});
await saveState(retiringStory.id,driver);
globalThis.fetch=async(_,options)=>{
 retirementCalls++;
 const reply={mutations:[{type:'people.retire',name:'Michael',cause:'The paid fare ended with no continuing obligation.'},{type:'offscreen.clear',name:'Michael'}],brief:null};
 const content=JSON.stringify(reply);
 return new Response('data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
};
try {
 const done=await worldTurn({connection,storyId:retiringStory.id,userText:'I paid Michael.',assistantText:'Michael finished the fare. Jovan entered the hotel.'});
 assert.equal(retirementCalls,1);assert.equal(done.pending.length,0);
 const gone=await loadState(retiringStory.id);assert(gone.characters.Michael.retired);assert(!gone.offscreen.Michael);assert(!gone.present.some(p=>p.name==='Michael'));
} finally {globalThis.fetch=originalFetch;}

const important={...base,characters:{},offscreen:{},threads:[]};
for(let i=0;i<55;i++) {const name='Envoy '+i;important.characters[name]={core:'An envoy.',updatedAtTurn:1};important.offscreen[name]={location:'province '+i,activity:'negotiating',agenda:'Fulfil treaty obligation '+i,atTurn:1,sinceMinutes:1};}
const plan=worldReviewPlan(important);
assert(plan.selected.length<55);assert.equal(plan.selected.length+plan.deferred.length,55);
const advanced=structuredClone(important);for(const n of plan.selected) advanced.offscreen[n].checkedMinutes=600;
assert(worldReviewPlan(advanced).selected.every(n=>plan.deferred.includes(n)));
const viewBefore=structuredClone(important);
const smallView=worldSeatView(important,{room:3000});
assert(smallView.text.length<=3000);assert(smallView.deferred.length>0);assert.deepEqual(important,viewBefore);
assert.deepEqual(seatHousekeeping(important),[],'More than 40 meaningful absentees retain their seats.');
assert.equal(applyMutations(important,[{type:'people.retire',name:'Envoy 1'}]).applied.length,0);
const held=seat(important.offscreen,'Envoy 1',{location:'province 1',activity:'resting'},700,61);
assert.equal(held['Envoy 1'].agenda,'Fulfil treaty obligation 1');
const related={...base,offscreen:{},characters:{A:{core:'An ally.'},B:{core:'A rival.'}},threads:[{title:'Political dispute',owner:'A',with:'B'}]};
assert(worldParticipation(related,'B'),'NPC-to-NPC obligations carry both parties.');
const coreState={...base,offscreen:{},characters:{Mira:{core:'A royal archivist. Patient, proud, keeper of the northern seals.',arc:'Trust earned slowly.'}},relationships:{Mira:{p:60,r:0,s:0}},canon:{Mira:{facts:[{key:'eyes',value:'green'}]}}};
const added=applyMutations(coreState,[{type:'people.note',name:'Mira',field:'core',text:'Sister of the third princess.'}]);
assert.equal(added.applied.length,1);assert(added.state.characters.Mira.core.startsWith(coreState.characters.Mira.core));
assert.deepEqual(added.state.relationships,coreState.relationships);assert.deepEqual(added.state.canon,coreState.canon);
const failed=[{delta:{name:'Mira',field:'core',text:'Sister of the third princess.',shown:princessQuote},why:'temporary write conflict'}];
const recovery=retainPeopleFailures(coreState,docs,failed);
assert.equal(recovery.length,1);
assert(workerProfileSources({...coreState,peopleRecovery:recovery},docs).includes('UNSAVED IDENTITY PROPOSAL'));
assert.equal(retainPeopleFailures({...added.state,peopleRecovery:recovery},docs,[]).length,0);
const cup={...base,present:[{name:'Mira',position:'offering a cup'}]};
const ending=reconcileAuditScene({issues:[],scene:[{name:'Mira',repair:true,position:'offering a cup',earlier:'offered the cup',ending:{position:'hands free after the cup was accepted',shown:'He accepted the cup.'}}]},cup);
assert(JSON.stringify(ending.issues).includes('hands free after the cup was accepted'));
assert(!JSON.stringify(ending.issues).includes('"position":"offering a cup"'));
assert.equal(reconcileAuditScene({issues:[],scene:[{name:'Mira',repair:false,ending:{position:'her hands now free'}}]},cup).issues.length,0);
const metrics=[];
for(const budgetTokens of [200000,1000000]) {
 const messages=[...Array.from({length:60},(_,i)=>({id:'history'+i,role:i%2?'assistant':'user',text:i%2?'The quiet hall settled after a long day. '.repeat(2500):'Continue the journey.'})),{role:'user',text:'I meet Michael.'},{role:'assistant',text:'Michael waits in the lobby.'},{role:'user',text:'I ask Michael about the paid journey.'}];
 const window={keeperOn:true,window:64,budgetTokens,answerTokens:16000};
 const before=structuredClone(retired.state);
 const req=buildRequest({story:{brief:'Preserve the writer facts.'},messages,state:retired.state,settings:{refereeOn:false},window});
 const text=req.systemBlocks.map(b=>b.text).join('\n')+JSON.stringify(req.messages);
 assert(text.includes('blue eyes'));assert(text.includes(messages.at(-1).text));
 assert(requestTokens(req.systemBlocks,req.messages)<=inputRoom(window));
 assert.deepEqual(retired.state,before);
 metrics.push({context:budgetTokens,input:requestTokens(req.systemBlocks,req.messages),output:16000,inputRoom:inputRoom(window)});
}
console.log(JSON.stringify({result:'M719 focused scenarios passed',sourceCalls,finalCalls,metrics,liveProvider:false}));
