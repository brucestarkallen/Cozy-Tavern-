import './idb-shim.mjs';
import assert from 'node:assert/strict';
import {db} from '../../js/store.js';
import {runEssentials,recordOf,sourcePrint,ESSENTIALS_KEY,PENDING_KEY,essentialsRecoveryState,essentialsRunNote,essentialsRetryDelay} from '../../js/agents/essentials.js';
import {enqueueWork} from '../../js/agents/queue.js';
import {loadWorkerStatus} from '../../js/agents/status.js';
import {healthSnapshot} from '../../js/agents/health.js';
const connection={id:'helper',type:'openai',model:'fixture',contextSize:200000,maxTokens:5000};
const nodes=Array.from({length:49},(_,i)=>({id:'source'+i,span:[i,i],text:'[Dawn, chapel] Neri returned the copper key to Mara; their conditional promise remains open.'}));
const good='[Dawn, chapel] (pages 1 to 49) Neri returned the copper key to Mara; their promise still depends on finding her missing brother.';
const prior={text:good,print:recordOf(nodes.slice(0,3)).print,sourcePrint:sourcePrint(nodes.slice(0,3)),upTo:2,complete:true};
await db.settings.set(ESSENTIALS_KEY('recovery'),prior);
await db.settings.set('memory:recovery',{nodes});
let calls=0,renewals=0;const asks=[];
const failed=await runEssentials({connection,storyId:'recovery',nodes,renew:()=>renewals++,callLLM:async(c,ask)=>{calls++;asks.push(ask);return {text:'[Dawn, chapel] '+ 'Long detail. '.repeat(1500),finishReason:'length'};}});
assert.equal(calls,2);assert.equal(renewals,2);assert(failed.pending);assert.match(failed.why,/over its allocated room/);
assert.match(asks[1].user,/Aim for at most 11200 characters/);
assert.deepEqual(await db.settings.get(ESSENTIALS_KEY('recovery')),prior);
let pending=await db.settings.get(PENDING_KEY('recovery'));assert(pending.nextAt>Date.now());assert.equal(pending.diagnostic.part,1);
const waiting=await runEssentials({connection,storyId:'recovery',nodes,callLLM:async()=>{throw Error('must not call during cooldown');}});
assert.equal(waiting.usage.calls,0);assert.equal(waiting.why,failed.why);
await enqueueWork('recovery',{name:'essentials',run:async()=>essentialsRunNote(waiting)});
assert.equal((await loadWorkerStatus('recovery')).essentials.unfinished,true);
let view=essentialsRecoveryState({kept:prior,pending,nodes,connection});assert(view.needed);
assert.equal(healthSnapshot({essentials:{...view,eligible:false}}).status,'yellow');
assert.equal(healthSnapshot({essentials:{...view,eligible:true}}).next,'essentials');
assert.equal(healthSnapshot({essentials:{...view,eligible:true},running:['essentials']}).next,null);
assert.equal(healthSnapshot({essentials:{...view,eligible:true},otherOwner:true}).next,null);
// Durable cooldown can expire without changing the source or pressing regenerate.
await db.settings.set(PENDING_KEY('recovery'),{...pending,nextAt:Date.now()-1});
const recovered=await runEssentials({connection,storyId:'recovery',nodes,callLLM:async(c,ask)=>{assert.match(ask.user,/previous candidate was over its allocated room/);return {text:good,finishReason:'stop'};}});
assert(recovered.wrote);assert.equal(recovered.usage.calls,1);assert.equal(await db.settings.get(PENDING_KEY('recovery')),undefined);
await enqueueWork('recovery',{name:'essentials',run:async()=>essentialsRunNote(recovered)});
assert.equal((await loadWorkerStatus('recovery')).essentials.unfinished,false);
view=essentialsRecoveryState({kept:await db.settings.get(ESSENTIALS_KEY('recovery')),nodes,connection});
assert.equal(healthSnapshot({essentials:view}).status,'green');
assert(essentialsRecoveryState({kept:await db.settings.get(ESSENTIALS_KEY('recovery')),nodes:[...nodes,{id:'new',span:[49,49],text:'The promise was completed.'}],connection}).needed);
assert.deepEqual((await db.settings.get('memory:recovery')).nodes,nodes);
// Old M737 locks have no time and a different connection fingerprint. Resume once.
await db.settings.set(PENDING_KEY('legacy'),{sourcePrint:sourcePrint(nodes),setupPrint:pending.setupPrint,helperPrint:'legacy',why:'unchanged incomplete attempt'});
assert((await runEssentials({connection,storyId:'legacy',nodes,callLLM:async()=>({text:good})})).wrote);
// Provider errors keep their actual reason, enter a cooldown and recover.
const offline=await runEssentials({connection,storyId:'offline',nodes,callLLM:async()=>{throw Error('fixture provider unavailable');}});
assert(offline.pending);assert.match(offline.why,/fixture provider unavailable/);assert.equal(offline.usage.calls,1);
// A stop and an in-flight manual edit must never be replaced or cached as failure.
const aborter=new AbortController();aborter.abort(new Error('stopped by hand'));
await assert.rejects(runEssentials({connection,storyId:'stop',nodes,signal:aborter.signal,callLLM:async()=>{throw Error('must not call');}}),/stopped by hand/);
assert.equal(await db.settings.get(PENDING_KEY('stop')),undefined);
const manual={text:'WRITER ESSENTIALS KEEP',complete:true};
const changed=await runEssentials({connection,storyId:'manual',nodes,callLLM:async()=>{await db.settings.set(ESSENTIALS_KEY('manual'),manual);return {text:good};}});
assert(!changed.wrote);assert.deepEqual(await db.settings.get(ESSENTIALS_KEY('manual')),manual);assert.equal(await db.settings.get(PENDING_KEY('manual')),undefined);
// Completed source parts survive a later failed part; only the missing part is retried.
const large=Array.from({length:4},(_,i)=>({id:'large'+i,span:[i,i],text:'[Dawn, chapel] '+ 'Original source stays whole. '.repeat(620)}));
const smallConn={...connection,contextSize:20000};let partCalls=[];
const partsFail=await runEssentials({connection:smallConn,storyId:'parts',nodes:large,callLLM:async(c,ask)=>{
 const part=Number(ask.user.match(/Part (\d+) of/)[1]);partCalls.push(part);return {text:part===1?good:'No structured record here.'};
}});
assert(partsFail.pending);let saved=await db.settings.get(PENDING_KEY('parts'));assert.equal(saved.parts.length,1);assert.match(partsFail.why,/source part 2/);
await db.settings.set(PENDING_KEY('parts'),{...saved,nextAt:0});partCalls=[];
assert((await runEssentials({connection:smallConn,storyId:'parts',nodes:large,callLLM:async(c,ask)=>{partCalls.push(Number(ask.user.match(/Part (\d+) of/)[1]));return {text:good};}})).wrote);
assert(!partCalls.includes(1));
assert.equal(essentialsRetryDelay(50),1800000);
console.log(JSON.stringify({result:'pass',sourceEntries:49,initialAttempts:2,cooldownCalls:0,automaticRecoveryCalls:1,legacyRecovery:true,partialResume:true,manualPreserved:true,liveCalls:0}));
