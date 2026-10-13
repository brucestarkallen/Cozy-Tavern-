import {createRequire} from 'node:module';
createRequire(new URL('../dom/package.json',import.meta.url))('fake-indexeddb/auto');
import assert from 'node:assert/strict';
import {db,dropCaches} from '../../js/store.js';
import {sourceBindings} from '../../js/assemble/selection.js';
import {emptyState} from '../../js/engine/state.js';
import {buildRequest} from '../../js/assemble/stack.js';
import {renderMemory} from '../../js/agents/memory.js';
import {runEssentials,loadEssentialsView,readEssentials,recordOf,sourcePrint,ESSENTIALS_KEY,PENDING_KEY} from '../../js/agents/essentials.js';

const connection={id:'fixture',type:'openai',model:'fixture',contextSize:200000,maxTokens:32000,reasoning:{effort:'off'}};
const facts=[
  'Neri first met Mara after rescuing her brother at the chapel.',
  'Mara promised help only if Neri returned the copper key before sunset.',
  'Ivo hid the sealed letter in the chapel cupboard because the bridge was watched.',
  'Neri returned the key instead of selling it, so Mara began to trust Neri.',
  'Mara knows where Ivo hid the letter; Neri knows only that a letter exists.',
  'Ivo demanded payment but Neri refused until the brother reached safety.',
  'Neri injured the left ankle while crossing the flooded road to avoid the guards.',
  'Mara and Neri began touching the bell before leaving, their promise to return together.',
  'Mara gave Neri a coat after Neri confessed fear; suspicion became affection.',
  'The bridge guards agreed to wait until sunset because Mara vouched for Neri.',
  'Neri chose the mill path while Mara stayed to protect the crossing.',
  'The ribbon in the mill proved that the missing brother had crossed alive.',
  'Ivo admitted taking Mara’s seal, explaining why the witnesses blamed Mara.',
  'The late correction establishes that Ivo sent the warning letter, not Mara; Neri now knows.',
  'Mara still owes the bridge report before sunset; the missing brother leaves the promise unresolved.',
  'Neri returned with the report but the brother remains missing; Mara must keep the crossing open.'
];
const marker=i=>'ENTRY_'+String(i).padStart(2,'0');
const expanded=i=>Array.from({length:28},(_,k)=>'Witness note '+k+': '+facts[i]).join(' ');
const reply=(i,n)=>'- [Day '+(i+1)+', chapel] (pages '+(n.span[0]+1)+' to '+(n.span[1]+1)+') '+marker(i)+'_CONCISE. '+facts[i]+' '+Array.from({length:14},(_,k)=>'Continuity '+k+': '+facts[i]).join(' ');
const story=await db.stories.create({title:'Fifteen independent concise counterparts'}),id=story.id;
await db.settings.set('state:'+id,emptyState());
for(let i=0;i<48;i++)await db.messages.append(id,{id:id+':'+i,ts:100+i,role:'assistant',text:'[Chapel] '+facts[Math.min(14,Math.floor(i/3))]+' Original page '+i+'.'});
let pages=await db.messages.list(id);
let nodes=facts.slice(0,15).map((fact,i)=>{
  const span=[i*3,i===14?47:i*3+2];
  return {id:marker(i),level:2,span,text:'[Day '+(i+1)+', chapel] '+marker(i)+'_SOURCE. '+fact,detail:expanded(i),sourcePages:sourceBindings(pages.slice(span[0],span[1]+1))};
});
await db.settings.set('memory:'+id,{nodes});
const rawPages=JSON.stringify(pages),rawNodes=JSON.stringify(nodes);
const args=()=>({connection,storyId:id,nodes,mc:'the player'});
let calls=[];
const answer=async(c,ask)=>{
  const source=ask.messages?.[0].content || ask.user;
  const found=[...source.matchAll(/ENTRY_(\d+)_SOURCE/g)].map(m=>Number(m[1]));
  assert.equal(found.length,1,'Each request reads just its original detailed section.');
  const i=found[0];calls.push(i);
  assert(source.includes(expanded(i)),'Attached detail must be sent without clipping.');
  assert(!source.includes('global target'));
  return {text:reply(i,nodes.find(n=>n.id===marker(i))),finishReason:'stop'};
};

// Capture genuine ownership, then reproduce a blocked M748 whole-record plan.
await assert.rejects(runEssentials({...args(),callLLM:async()=>{throw Object.assign(Error('fixture interrupted'),{name:'AbortError'});}}),/fixture interrupted/);
let pending=await db.settings.get(PENDING_KEY(id));
await db.settings.set(PENDING_KEY(id),{...pending,repairPolicy:8,outcome:'blocked',nextAt:Date.now()+900000,
  plan:[{lines:nodes,print:sourcePrint(nodes)}],validationRounds:4,why:'over its allocated room',
  diagnostic:{print:sourcePrint(nodes),draft:'- [Dawn] (pages 1 to 48) '+ 'old whole-story draft '.repeat(900),chars:18000,why:'over its allocated room'}});
let out=await runEssentials({...args(),callLLM:answer});
assert.equal(out.outcome,'yielded');assert.equal(calls.length,12);
pending=await db.settings.get(PENDING_KEY(id));
assert.equal(pending.parts.length,12);assert.equal(pending.plan.length,15);assert.equal(pending.attempts,0);assert.equal(pending.validationRounds || 0,0);
assert(pending.nextAt<Date.now()+3000);assert.equal(await db.settings.get(ESSENTIALS_KEY(id)),undefined);
assert.equal((await loadEssentialsView(id)).progress.length,12);
dropCaches();
await db.settings.set(PENDING_KEY(id),{...pending,nextAt:0});
out=await runEssentials({...args(),callLLM:answer});assert(out.wrote);
assert.deepEqual(calls,Array.from({length:15},(_,i)=>i));
let view=await loadEssentialsView(id),saved=view.snapshot;
assert(view.current && view.eligible);assert(saved.text.length>17000,'Complete saved collection may exceed the former global limit.');
assert.equal(saved.parts.length,15);assert.equal(saved.text,saved.parts.map(p=>p.text).join('\n'));
assert.equal(readEssentials(saved.text),saved.text,'The public parser must not reintroduce the old global cap.');
assert.equal(await db.settings.get(PENDING_KEY(id)),undefined);
for(let i=0;i<15;i++){assert(saved.parts[i].text.includes(facts[i]));assert(saved.parts[i].text.length<recordOf([nodes[i]]).text.length);}
assert.equal(JSON.stringify(await db.messages.list(id)),rawPages);assert.equal(JSON.stringify((await db.settings.get('memory:'+id)).nodes),rawNodes);
const request=buildRequest({story,state:emptyState(),messages:pages,settings:{frameOn:false,refereeOn:false},modules:[],memory:renderMemory({nodes},Infinity),smallEssentials:saved,
  window:{keeperOn:true,window:10,nodes,recordThrough:pages.length,budgetTokens:200000,answerTokens:5000}});
assert(request.selection.essentials);const wire=request.systemBlocks.map(b=>b.text).join('\n')+request.messages.map(m=>m.content).join('\n');
assert(wire.includes(saved.text),'Entire concise collection reaches actual storyteller assembly.');
assert.equal((await runEssentials({...args(),callLLM:()=>{throw Error('unchanged completion repeated');}})).why,'unchanged');

// Adding one detailed section makes one request, retaining all 15 counterparts.
for(let i=48;i<51;i++)await db.messages.append(id,{id:id+':'+i,ts:100+i,role:'assistant',text:facts[15]+' Original page '+i+'.'});
pages=await db.messages.list(id);nodes.push({id:marker(15),level:1,span:[48,50],text:'[Day 16, bridge] '+marker(15)+'_SOURCE. '+facts[15],detail:expanded(15),sourcePages:sourceBindings(pages.slice(48))});
await db.settings.set('memory:'+id,{nodes});
view=await loadEssentialsView(id);assert(view.eligible && !view.current);assert.equal(view.snapshot.text,saved.text);
calls=[];assert((await runEssentials({...args(),callLLM:answer})).wrote);assert.deepEqual(calls,[15]);
view=await loadEssentialsView(id);assert.deepEqual(view.snapshot.parts.slice(0,15),saved.parts);saved=view.snapshot;

// One manual record amendment only changes its corresponding concise entry.
nodes[3]={...nodes[3],text:nodes[3].text+' MANUAL_FACT_KEEP: Mara explicitly forgave the debt.'};
await db.settings.set('memory:'+id,{nodes});
view=await loadEssentialsView(id);assert(!view.eligible);assert.equal(view.snapshot.text,saved.text);
calls=[];assert((await runEssentials({...args(),callLLM:async(c,ask)=>{const value=await answer(c,ask);assert((ask.messages?.[0].content || ask.user).includes('MANUAL_FACT_KEEP'));return {...value,text:value.text+' MANUAL_FACT_KEEP: Mara explicitly forgave the debt.'};}})).wrote);
assert.deepEqual(calls,[3]);view=await loadEssentialsView(id);
for(let i=0;i<16;i++)if(i!==3)assert.deepEqual(view.snapshot.parts[i],saved.parts[i]);
assert((await db.settings.get('memory:'+id)).nodes[3].text.includes('MANUAL_FACT_KEEP'));saved=view.snapshot;

// A transport failure preserves the accepted collection and prior sections.
calls=[];
nodes[14]={...nodes[14],text:nodes[14].text+' Another current witness confirmed the deadline.'};
await db.settings.set('memory:'+id,{nodes});
out=await runEssentials({...args(),callLLM:async()=>{calls.push(14);throw Error('provider unavailable');}});
assert.equal(out.outcome,'failed');assert.equal(calls.length,1);assert.deepEqual(await db.settings.get(ESSENTIALS_KEY(id)),saved);
pending=await db.settings.get(PENDING_KEY(id));assert.equal(pending.parts.length,15);assert.equal(pending.attempts,1);
dropCaches();await db.settings.set(PENDING_KEY(id),{...pending,nextAt:0});calls=[];
assert((await runEssentials({...args(),callLLM:answer})).wrote);assert.deepEqual(calls,[14]);

// Removing later pages cannot make their former concise text eligible.
nodes=nodes.slice(0,4);for(const page of pages.slice(12))await db.messages.update(id,page.id,{hidden:true});
await db.settings.set('memory:'+id,{nodes});assert(!(await loadEssentialsView(id)).eligible);
calls=[];assert((await runEssentials({...args(),callLLM:answer})).wrote);assert.equal(calls.length,0);
view=await loadEssentialsView(id);assert(view.current && view.eligible);assert(!view.snapshot.text.includes('ENTRY_14_CONCISE'));
console.log(JSON.stringify({result:'pass',initialPages:48,detailedSections:15,initialCalls:15,acceptedChars:saved.text.length,
  noGlobalCharacterCap:true,oneSectionPerRequest:true,completedProgressSurvivesReload:true,appendCalls:1,editCalls:1,
  allConciseSectionsInStoryteller:true,manualAndOriginalRecordsPreserved:true,failedRequestPreservesAccepted:true,rewindExcludesFutureFacts:true,simulatedReplies:true,liveCalls:0}));
