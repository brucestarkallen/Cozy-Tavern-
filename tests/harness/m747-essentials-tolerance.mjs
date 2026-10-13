import {createRequire} from 'node:module';
createRequire(new URL('../dom/package.json',import.meta.url))('fake-indexeddb/auto');
import assert from 'node:assert/strict';
import {db} from '../../js/store.js';
import {sourceBindings} from '../../js/assemble/selection.js';
import {runEssentials,loadEssentialsView,sourcePrint,ESSENTIALS_KEY,PENDING_KEY} from '../../js/agents/essentials.js';
const connection={id:'fixture',type:'openai',model:'fixture',contextSize:200000,maxTokens:32000,reasoning:{effort:'off'}};
const facts=['Neri returned the copper key, so Mara trusted Neri and promised help only if her brother returned.','Ivo sent the letter, not Neri; Mara knows its location while Neri does not; Mara still owes a report before sunset.'];
const line=i=>'- [Dawn, chapel] (page '+(i+1)+') '+facts[i];
const prefix='- [Dawn, chapel] (page 1) ';
const oversized=prefix+'x'.repeat(18000-prefix.length-1)+'.';
async function fixture(){
 const story=await db.stories.create({title:'Direct rejected draft recovery'});
 for(let i=0;i<2;i++)await db.messages.append(story.id,{id:story.id+':'+i,ts:100+i,role:'assistant',text:'[Dawn, chapel] '+facts[i]});
 const pages=await db.messages.list(story.id),nodes=pages.map((p,i)=>({id:'n'+i,span:[i,i],text:p.text,level:1,sourcePages:sourceBindings([p])}));
 await db.settings.set('memory:'+story.id,{nodes});
 // Interrupt after production ownership metadata is persisted, then restore
 // the exact old two-section, rejected-draft shape from the reported incident.
 await assert.rejects(runEssentials({connection,storyId:story.id,nodes,callLLM:async()=>{throw Object.assign(new Error('fixture stop'),{name:'AbortError'});}}),/fixture stop/);
 const p=await db.settings.get(PENDING_KEY(story.id));
 await db.settings.set(PENDING_KEY(story.id),{...p,repairPolicy:5,phase:'sections',outcome:'failed',attempts:1,nextAt:Date.now()+60000,
  why:'Source section 1 of 2: over its allocated room (answer 18000 characters; available 15200 of the global 16000)',
  plan:nodes.map(n=>({lines:[n],print:sourcePrint([n])})),diagnostic:{why:'over its allocated room',draft:oversized,clipped:true,chars:18000,share:15200,part:1,parts:2}});
 return {storyId:story.id,nodes};
}

const f=await fixture();await db.settings.set(PENDING_KEY(f.storyId),undefined);
const meaning='- [Dawn, chapel] (pages 1 to 2) '+facts.join(' ')+' ';
const near=meaning+'x'.repeat(17000-meaning.length-1)+'.';
let calls=0;
assert((await runEssentials({...f,connection,callLLM:async()=>{calls++;return {text:near,finishReason:'stop'};}})).wrote);
assert.equal(calls,1);let view=await loadEssentialsView(f.storyId);assert(view.eligible && view.current);assert.equal(view.snapshot.text.length,17000);
const {buildRequest}=await import('../../js/assemble/stack.js');
const {emptyState}=await import('../../js/engine/state.js');
const {renderMemory}=await import('../../js/agents/memory.js');
const request=buildRequest({story:await db.stories.get(f.storyId),state:emptyState(),messages:await db.messages.list(f.storyId),settings:{frameOn:false,refereeOn:false},modules:[],memory:renderMemory({nodes:f.nodes},Infinity),smallEssentials:view.snapshot,window:{keeperOn:true,window:10,nodes:f.nodes,recordThrough:2,budgetTokens:200000,answerTokens:5000}});
assert(request.selection.essentials);assert(request.systemBlocks.map(b=>b.text).join(' ').includes(near) || request.messages.some(m=>String(m.content).includes(near)));
// Three oversized answers retain the same candidate, without a fresh full read
// or output-driven source subdivision. The accepted snapshot stays visible.
calls=0;
let out=await runEssentials({...f,connection,force:true,callLLM:async()=>{calls++;return {text:oversized};}});
assert.equal(out.outcome,'yielded');assert.equal(calls,3);
let pending=await db.settings.get(PENDING_KEY(f.storyId));assert.equal(pending.restarts,0);assert.equal(pending.plan.length,1);assert.equal(pending.phase,'whole');
assert.equal((await loadEssentialsView(f.storyId)).snapshot.text,near);
// An old-policy draft within the new tolerance publishes locally, no model.
pending={...pending,repairPolicy:6,outcome:'blocked',validationRounds:4,diagnostic:{...pending.diagnostic,draft:near,chars:17000,finishReason:'stop',providerTruncated:false}};
await db.settings.set(PENDING_KEY(f.storyId),pending);
assert((await runEssentials({...f,connection,callLLM:()=>{throw Error('valid held draft must publish without a call');}})).wrote);
assert.equal(await db.settings.get(PENDING_KEY(f.storyId)),undefined);
assert.equal((await runEssentials({...f,connection,callLLM:()=>{throw Error('unchanged saved output repeated');}})).why,'unchanged');
// Tolerance never accepts a provider-truncated answer.
await db.settings.set(PENDING_KEY(f.storyId),{...pending,acceptedPrint:undefined,diagnostic:{...pending.diagnostic,finishReason:'length',providerTruncated:true}});
// Build current ownership metadata through a genuine forced attempt instead.
await runEssentials({...f,connection,force:true,callLLM:async()=>({text:near,finishReason:'length'})});
pending=await db.settings.get(PENDING_KEY(f.storyId));await db.settings.set(PENDING_KEY(f.storyId),{...pending,nextAt:0});calls=0;
assert((await runEssentials({...f,connection,callLLM:async(c,ask)=>{calls++;assert(ask.messages);return {text:line(0)+'\n'+line(1),finishReason:'stop'};}})).wrote);assert.equal(calls,1);
console.log(JSON.stringify({result:'pass',complete17000AcceptedInOneCall:true,storytellerReceivesFullText:true,previousSnapshotPreserved:true,noWholeRestartOrOutputSubdivision:true,oldDraftPublishedWithoutCall:true,truncatedDraftStillRevised:true,unchangedNoRepeat:true,simulatedReplies:true,liveCalls:0}));
