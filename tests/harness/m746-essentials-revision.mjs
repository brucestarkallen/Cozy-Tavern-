import {createRequire} from 'node:module';
createRequire(new URL('../dom/package.json',import.meta.url))('fake-indexeddb/auto');
import assert from 'node:assert/strict';
import {db,dropCaches} from '../../js/store.js';
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
const f=await fixture();let calls=0;
const first=await runEssentials({...f,connection,callLLM:async(c,ask)=>{
 calls++;assert(ask.messages,'saved rejected draft must be edited on the first resumed call');
 assert.equal(ask.messages[1].content,oversized);
 assert(ask.messages[0].content.includes(facts[0]));assert(ask.messages[2].content.includes('over its allocated room'));
 return {text:oversized};
}});
assert.equal(calls,3);assert.equal(first.outcome,'yielded');
let pending=await db.settings.get(PENDING_KEY(f.storyId));
assert.equal(pending.attempts,1,'validation must not increase transport failure count');
assert.equal(pending.validationRounds,1);assert(pending.nextAt-Date.now()<2000);
assert.equal(await db.settings.get(ESSENTIALS_KEY(f.storyId)),undefined);
await db.settings.set(PENDING_KEY(f.storyId),{...pending,nextAt:0});dropCaches();calls=0;
const done=await runEssentials({...f,connection,callLLM:async(c,ask)=>{
 calls++;
 if(calls===1){assert.equal(ask.messages[1].content,oversized);return {text:line(0)};}
 if(calls===2)return {text:'The wrong format, but the letter still names Ivo.'};
 assert.equal(ask.messages[1].content,'The wrong format, but the letter still names Ivo.');
 assert(ask.messages[2].content.includes('no usable record lines'));return {text:line(1)};
}});
assert(done.wrote,JSON.stringify(done));assert.equal(calls,3);assert.equal(await db.settings.get(PENDING_KEY(f.storyId)),undefined);
const view=await loadEssentialsView(f.storyId);assert(view.eligible && view.current);assert.equal(view.snapshot.text,line(0)+'\n'+line(1));
assert.equal((await runEssentials({...f,connection,callLLM:()=>{throw Error('completed work repeated');}})).why,'unchanged');
// Completed sections survive old-policy migration; only the unfinished source
// and its rejected draft are sent back for correction.
const partial=await fixture();let p=await db.settings.get(PENDING_KEY(partial.storyId));
p.plan[0]={...p.plan[0],text:line(0),complete:true};p.parts=[{print:p.plan[0].print,text:line(0),complete:true}];
p.cursor=1;p.diagnostic={...p.diagnostic,part:2};await db.settings.set(PENDING_KEY(partial.storyId),p);calls=0;
assert((await runEssentials({...partial,connection,callLLM:async(c,ask)=>{
 calls++;assert(!ask.messages[0].content.includes(facts[0]));assert(ask.messages[0].content.includes(facts[1]));return {text:line(1)};
}})).wrote);assert.equal(calls,1);
// A genuinely fresh source attempt can revise its own first oversized answer.
const fresh=await fixture();await db.settings.set(PENDING_KEY(fresh.storyId),undefined);calls=0;
assert((await runEssentials({...fresh,connection,callLLM:async(c,ask)=>{
 calls++;
 if(calls<=4)return {text:oversized};
 assert.equal(calls,5);assert.equal(ask.messages[1].content,oversized);assert(ask.messages[0].content.includes('FRESH SOURCE READING'));
 return {text:line(0)+'\n'+line(1)};
}})).wrote);assert.equal(calls,5);
// Four unsuccessful editing rounds remain finite, even with no minute delays.
const bad=await fixture();calls=0;let result;
for(let i=0;i<4;i++){
 const p=await db.settings.get(PENDING_KEY(bad.storyId));await db.settings.set(PENDING_KEY(bad.storyId),{...p,nextAt:0});
 result=await runEssentials({...bad,connection,callLLM:async()=>{calls++;return {text:oversized};}});
}
assert.equal(calls,12);assert.equal(result.outcome,'blocked');
assert.equal((await runEssentials({...bad,connection,callLLM:()=>{throw Error('unbounded loop');}})).outcome,'blocked');
// Actual transport failures retain Retry-After and backoff.
const down=await fixture();const failed=await runEssentials({...down,connection,callLLM:async()=>{throw Object.assign(new Error('Provider unavailable'),{retryAfterMs:90000});}});
assert.equal(failed.outcome,'failed');assert(failed.retryAt-Date.now()>89000);
console.log(JSON.stringify({result:'pass',rejectedChars:18000,oldCooldownBypassed:true,draftReturnedWithExactProblem:true,validationYieldWithoutTransportBackoff:true,reloadResumesDraft:true,formatRevision:true,savedAndCurrent:true,finiteRejectedReplies:12,transportBackoffPreserved:true,simulatedReplies:true,liveCalls:0}));
