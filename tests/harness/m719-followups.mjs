import './idb-shim.mjs';
import assert from 'node:assert/strict';
import { db } from '../../js/store.js';
import { emptyState,saveState,loadState } from '../../js/engine/state.js';
import { scribeTurn } from '../../js/agents/scribe.js';
import { applyMutations } from '../../js/engine/apply.js';
import { auditSources,missingSourcePeople,sourcePersonKey } from '../../js/agents/auditsources.js';
import { sourceAppearanceFacts } from '../../js/agents/appearanceinventory.js';
const connection={type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'fixture',preset:'custom',contextSize:200000};
const story=await db.stories.create({title:'Two focused followups'});
const prose='Mira is the queen’s sister. Rina is a dancer. The girl has black hair.';
await db.messages.append(story.id,{role:'user',text:prose});
await db.messages.append(story.id,{role:'assistant',text:'Mira waits.'});
const base={...emptyState(),sheet:{playerName:'Keir',actors:{}},characters:{Mira:{core:'An archivist.',hand:{core:true}}}};
let answer={},finish='stop',calls=0;
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{calls++;const content=JSON.stringify(answer);return new Response('data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:finish}]})+'\n\ndata: [DONE]\n\n');};
const run=()=>scribeTurn({connection,storyId:story.id,userText:prose,assistantText:'Mira waits.'});
try {
 await saveState(story.id,base);
 answer={deltas:[{name:'Invented Stranger',field:'core',text:'A mage.',shown:prose},{name:'Mira',field:'core',text:'The queen’s sister.',shown:prose}]};
 let result=await run();assert.equal(result.dropped.length,2);assert.equal(result.unfinished,false);assert.equal(result.pending.length,0);
 assert.equal((await loadState(story.id)).characters.Mira.core,'An archivist.');
 // A supported addition that exceeds available field room remains recoverable.
 await saveState(story.id,{...base,characters:{Mira:{core:'x'.repeat(3990)}}});
 answer={deltas:[{name:'Mira',field:'core',text:'The queen’s sister.',shown:prose}]};
 result=await run();assert.equal(result.unfinished,true);assert.equal(result.pending.length,1);
 const pending=await loadState(story.id);
 // A later ordinary write succeeds and clears that exact pending fact.
 await saveState(story.id,{...pending,characters:{Mira:{core:'An archivist.'}}});
 result=await run();assert.equal(result.unfinished,false);assert.equal(result.pending.length,0);
 assert((await loadState(story.id)).characters.Mira.core.includes('An archivist.'));
 // Recovery-only answers must persist a supported disposition despite no deltas.
 await saveState(story.id,pending);
 answer={deltas:[],recoveries:[{id:pending.peopleRecovery[0].id,status:'unsupported',why:'The proposed wording was not supported.'}]};
 result=await run();assert.equal(result.unfinished,false);assert.deepEqual((await loadState(story.id)).peopleRecovery,[]);
 finish='length';answer={deltas:[]};result=await run();assert.equal(result.unfinished,true);finish='stop';
 const docs=auditSources({messages:await db.messages.list(story.id)}),id=docs[0].id;
 const mention={name:'the girl',kind:'person',ledgerName:'the girl',shown:prose,identityFacts:[],facts:[{key:'hair',value:'black',shown:prose}]};
 let state={...base,characters:{Rina:{core:'A dancer.'},Sela:{core:'A princess.'},'the girl':{core:'A different person.'}},offscreen:{'the annual courier':{agenda:'Deliver a letter.'}},auditSources:{[id]:{mark:docs[0].mark,appearanceReviewed:true,people:[mention]}}};
 assert.equal(sourcePersonKey(state,'the girl','the girl'),'');
 assert.equal(missingSourcePeople(state,[{...mention,source:id}]).length,1);
 assert.equal(sourceAppearanceFacts(state,docs).length,0,'Ambiguous appearance must not attach to the globally identical label.');
 const bind=(s,to)=>applyMutations(s,[{type:'source.resolve',sourceId:id,name:'the girl',to,kind:'person',cause:'This source identifies the speaker.',auditorApproved:true,source:'auditor'}]);
 const first=bind(state,'Rina');assert.equal(first.applied.length,1);
 assert.equal(sourceAppearanceFacts(first.state,docs)[0].name,'Rina');
 const other=bind(state,'Sela');assert.equal(sourceAppearanceFacts(other.state,docs)[0].name,'Sela');
 assert.equal(missingSourcePeople(first.state,first.state.auditSources[id].people).length,0);
 const courier={name:'the annual courier',kind:'person',ledgerName:'the annual courier',identityResolution:{kind:'person',to:'the annual courier',why:'This is the continuing delivery.'},identityFacts:[]};
 assert.equal(missingSourcePeople(state,[courier]).length,0,'A local continuing role needs no biography.');
 assert.equal(missingSourcePeople(state,[{name:'the third princess',kind:'person',identityFacts:[{text:'The queen’s daughter.',shown:prose}]}]).length,1);
 console.log('PASS: People rejection, manual protection, sourced save failure, recovery, empty recovery answer, incomplete execution; contextual collisions, local bindings, appearance ownership, courier, princess. Mocked People calls:',calls);
} finally {globalThis.fetch=originalFetch;}
