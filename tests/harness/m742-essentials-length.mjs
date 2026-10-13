import './idb-shim.mjs';
import assert from 'node:assert/strict';
import {db} from '../../js/store.js';
import {runEssentials,essentialsRepairMessages,PENDING_KEY,ESSENTIALS_KEY} from '../../js/agents/essentials.js';
const connection={id:'helper',type:'openai',model:'fixture',contextSize:200000,maxTokens:12000};
const nodes=Array.from({length:49},(_,i)=>({id:'source'+i,span:[i,i],text:'[Dawn, chapel] SOURCE_PAGE_'+(i+1)+'_KEEP. Neri kept a conditional promise to Mara; the missing brother remains the reason.'}));
const prefix='- [Dawn, chapel] (pages 1 to 49) ';
const oversized=prefix+'A'.repeat(33851-prefix.length-1)+'.';
assert.equal(oversized.length,33851);
const compact=nodes.map((n,i)=>'- [Dawn, chapel] (page '+(i+1)+') '+n.text.split('] ')[1]).join('\n');
assert(compact.length<16000);
let calls=0;const seen=[];
const fixed=await runEssentials({connection,storyId:'exact33851',nodes,callLLM:async(c,ask)=>{
 seen.push(ask);calls++;
 if(calls===1)return {text:oversized,finishReason:'stop'};
 assert.equal(ask.messages.length,3);
 assert.equal(ask.messages[1].role,'assistant');assert.equal(ask.messages[1].content,oversized);
 for(let i=1;i<=49;i++)assert(ask.messages[0].content.includes('SOURCE_PAGE_'+i+'_KEEP'));
 assert.match(ask.messages[2].content,/at most 16000 characters/);
 assert.match(ask.messages[2].content,/original source entries.*authoritative/);
 if(calls===2){assert.match(ask.messages[2].content,/about 10400 characters/);return {text:oversized,finishReason:'length'};}
 assert.match(ask.messages[2].content,/about 8000 characters/);
 assert.match(ask.messages[2].content,/may be cut off or incomplete/);
 return {text:compact,finishReason:'stop'};
}});
assert(fixed.wrote);assert.equal(calls,3);
const saved=await db.settings.get(ESSENTIALS_KEY('exact33851'));
assert.equal(saved.text,compact);assert.equal(saved.upTo,48);assert.equal(saved.sources.length,49);
assert.equal(await db.settings.get(PENDING_KEY('exact33851')),undefined);
// A bounded failed editing round keeps the full draft, not a clipped 16000-char prefix.
const failed=await runEssentials({connection,storyId:'persist',nodes,callLLM:async()=>({text:oversized,finishReason:'stop'})});
assert(failed.pending);let pending=await db.settings.get(PENDING_KEY('persist'));
assert.equal(pending.diagnostic.draft,oversized);assert.equal(await db.settings.get(ESSENTIALS_KEY('persist')),undefined);
await db.settings.set(PENDING_KEY('persist'),{...pending,nextAt:0});
let resumed=0;
assert((await runEssentials({connection,storyId:'persist',nodes,callLLM:async(c,ask)=>{resumed++;assert.equal(ask.messages[1].content,oversized);assert.match(ask.messages[2].content,/about 8000 characters/);return {text:compact};}})).wrote);
assert.equal(resumed,1);
// Changed original material never borrows an older draft.
await db.settings.set(PENDING_KEY('changed'),pending);
assert((await runEssentials({connection,storyId:'changed',nodes:[...nodes,{id:'new',span:[49,49],text:'SOURCE_CHANGED_KEEP.'}],callLLM:async(c,ask)=>{assert.equal(ask.messages,undefined);assert(ask.user.includes('SOURCE_CHANGED_KEEP'));return {text:compact+'\n- [Noon, chapel] (page 50) SOURCE_CHANGED_KEEP. The original source changed and this complete new fact belongs to this record.'};}})).wrote);
// New repair policy resumes the owner's existing M741 five-minute hold immediately.
await db.settings.set(PENDING_KEY('oldpolicy'),{...pending,repairPolicy:undefined,nextAt:Date.now()+300000,diagnostic:{...pending.diagnostic,draft:undefined}});
assert((await runEssentials({connection,storyId:'oldpolicy',nodes,callLLM:async()=>({text:compact})})).wrote);
// A repair must fit the actual helper context, including answer allowance.
assert.equal(essentialsRepairMessages({connection:{...connection,contextSize:16000},system:'Condense.',user:nodes.map(n=>n.text).join('\n'),draft:oversized,share:16000}),null);
assert.equal(connection.maxTokens,12000);
console.log(JSON.stringify({result:'pass',rejectedChars:33851,savedChars:saved.text.length,sourceEntries:49,requests:3,directDraftRevisions:2,persistedDraftResume:true,sourceIsolation:true,contextGuard:true,liveCalls:0}));
