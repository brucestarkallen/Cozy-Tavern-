import './idb-shim.mjs';
import assert from 'node:assert/strict';
import {db} from '../../js/store.js';
import {runEssentials,sourcePrint,recordOf,ESSENTIALS_KEY,PENDING_KEY,essentialsRecoveryState,essentialsRunNote} from '../../js/agents/essentials.js';
import {healthSnapshot} from '../../js/agents/health.js';
import {workerConnection} from '../../js/agents/call.js';
const connection={id:'helper',type:'openai',baseUrl:'https://fixture.example/v1',model:'fixture',apiKey:'fixture',contextSize:200000,maxTokens:32000,reasoning:{effort:'off'}};
const nodes=Array.from({length:12},(_,i)=>({id:'entry'+i,span:[i,i],text:'[Dawn, chapel] SOURCE_'+i+'_KEEP. Neri owes Mara a promise conditional on finding her brother; '+ 'original meaningful scene details. '.repeat(75),detail:'DETAIL_'+i+'_KEEP.'}));
nodes.push({id:'correction',span:[11,11],correction:true,at:100,text:'[Noon, chapel] CORRECTION_KEEP. Mara now knows the promise was paid, but her missing brother remains an open obligation.'});
const prefix='- [Dawn, chapel] (pages 1 to 12) ';
const oversized=prefix+'A'.repeat(31922-prefix.length-1)+'.';assert.equal(oversized.length,31922);
const prior={text:'PREVIOUS USABLE ESSENTIALS KEEP',print:'previous',setupPrint:'previous',upTo:0,complete:true};
const originalFetch=globalThis.fetch;let calls=0,mode='success',requests=[];
const output=user=>{
 const chosen=nodes.filter(n=>user.includes(n.correction?'CORRECTION_KEEP':'SOURCE_'+nodes.indexOf(n)+'_KEEP'));
 return chosen.map(n=>'- [Dawn, chapel] (page '+(n.span[0]+1)+') '+(n.correction?'CORRECTION_KEEP. Mara knows the promise was paid; her missing brother remains an open obligation.':'SOURCE_'+nodes.indexOf(n)+'_KEEP. Neri owes Mara a conditional promise to find her brother, keeping their first meeting and its cause.')).join('\n');
};
const stream=text=>new Response('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
globalThis.fetch=async(_,options)=>{
 calls++;const body=JSON.parse(options.body);requests.push(body);
 assert(body.max_tokens<=5000,'the memory request must not inherit the configured 32000 token floor');
 const user=body.messages.find(m=>m.role==='user').content;
 const all=nodes.every(n=>user.includes(n.correction?'CORRECTION_KEEP':'SOURCE_'+nodes.indexOf(n)+'_KEEP'));
 if(all && mode!=='direct') {
  if(calls===2 || calls===3) {assert(body.messages.some(m=>m.role==='assistant'&&m.content===oversized));assert.match(body.messages.at(-1).content,/Revise the draft above/);}
  assert.deepEqual(await db.settings.get(ESSENTIALS_KEY('whole')),prior);
  return stream(oversized);
 }
 if(mode==='direct' && calls===1) return stream(oversized);
 if(mode==='resume' || !all) {
  for(const n of nodes.filter(n=>user.includes(n.correction?'CORRECTION_KEEP':'SOURCE_'+nodes.indexOf(n)+'_KEEP'))) {
   assert(user.includes(n.text));if(n.detail) assert(user.includes(n.detail));
  }
  if(mode==='partial' && user.includes('CORRECTION_KEEP')) throw Error('fixture provider unavailable on newest section');
 }
 return stream(mode==='folded'?output(user).replace(/\(page \d+\)/g,'(pages 1 to 12)'):output(user));
};
try {
 await db.settings.set(ESSENTIALS_KEY('whole'),prior);await db.settings.set('memory:whole',{nodes});
 const fixed=await runEssentials({connection,storyId:'whole',nodes});assert(fixed.wrote);assert.equal(calls,5);assert.equal(fixed.parts,1);
 const saved=await db.settings.get(ESSENTIALS_KEY('whole'));assert(saved.text.length<=16000);assert.equal(saved.sources.length,nodes.length);
 for(let i=0;i<12;i++) assert(saved.text.includes('SOURCE_'+i+'_KEEP'));
 assert(saved.text.includes('CORRECTION_KEEP'));assert(saved.text.indexOf('SOURCE_0_KEEP')<saved.text.indexOf('SOURCE_11_KEEP'));
 assert.equal(await db.settings.get(PENDING_KEY('whole')),undefined);assert.deepEqual((await db.settings.get('memory:whole')).nodes,nodes);
 assert.equal(healthSnapshot({essentials:essentialsRecoveryState({kept:saved,nodes,connection})}).status,'green');
 // One folded node can contain several chronological lines without losing its identity.
 const folded=[{id:'folded-original',span:[0,11],text:nodes.map(n=>n.text+(n.detail?' '+n.detail:'')).join('\n')}];
 await db.settings.set(ESSENTIALS_KEY('whole'),prior);await db.settings.set('memory:whole',{nodes:folded});calls=0;requests=[];mode='folded';
 const foldedResult=await runEssentials({connection,storyId:'whole',nodes:folded});assert(foldedResult.wrote);assert.equal(calls,5);
 const foldedSaved=await db.settings.get(ESSENTIALS_KEY('whole'));assert.equal(foldedSaved.sources[0].id,'folded-original');
 for(let i=0;i<12;i++)assert(foldedSaved.text.includes('SOURCE_'+i+'_KEEP'));assert(foldedSaved.text.includes('CORRECTION_KEEP'));
 await db.settings.set('memory:whole',{nodes});
 // A successful whole-record draft revision still needs only the original two calls.
 calls=0;requests=[];mode='direct';assert((await runEssentials({connection,storyId:'direct',nodes})).wrote);assert.equal(calls,2);assert(requests[1].messages.some(m=>m.role==='assistant'&&m.content===oversized));
 // Persist a completed oldest section while only the newest section fails.
 await db.settings.set(ESSENTIALS_KEY('whole'),prior);await db.settings.delete(PENDING_KEY('whole'));calls=0;requests=[];mode='partial';
 const failed=await runEssentials({connection,storyId:'whole',nodes});assert(failed.pending);assert.equal(calls,6,'existing transport retry repeats the failed fetch once');assert.deepEqual(await db.settings.get(ESSENTIALS_KEY('whole')),prior);
 let pending=await db.settings.get(PENDING_KEY('whole'));assert.equal(pending.parts.length,1);assert.equal(pending.splits.length,1);assert(pending.parts[0].text.includes('SOURCE_0_KEEP'));assert(!pending.parts[0].text.includes('CORRECTION_KEEP'));
 assert.equal(essentialsRunNote(failed).unfinished,true);assert.equal(healthSnapshot({essentials:essentialsRecoveryState({kept:prior,pending,nodes,connection})}).status,'yellow');
 calls=0;await runEssentials({connection,storyId:'whole',nodes});assert.equal(calls,0,'cooldown does not generate a replacement');
 await db.settings.set(PENDING_KEY('whole'),{...pending,nextAt:0});mode='resume';calls=0;requests=[];
 const reload=await import('../../js/agents/essentials.js?fixtureReload');
 assert((await reload.runEssentials({connection,storyId:'whole',nodes})).wrote);assert.equal(calls,1);assert(!requests[0].messages.find(m=>m.role==='user').content.includes('SOURCE_0_KEEP'));
 assert.equal(await db.settings.get(PENDING_KEY('whole')),undefined);
 // Changed sources cannot reuse the old split plan, draft or completed leaf.
 await db.settings.set(PENDING_KEY('changed'),pending);calls=0;requests=[];mode='direct';
 const changed=nodes.map(n=>({...n,text:n.text+' NEW_SOURCE_KEEP.'}));
 assert((await runEssentials({connection,storyId:'changed',nodes:changed})).wrote);assert.equal(calls,2);assert(requests[0].messages.find(m=>m.role==='user').content.includes('SOURCE_0_KEEP'));
 // A small answer omitting later source ranges is still incomplete.
 await db.settings.set(PENDING_KEY('coverage'),{...pending,nextAt:0});
 globalThis.fetch=async(_,options)=>{const user=JSON.parse(options.body).messages.find(m=>m.role==='user').content;return stream('- [Dawn, chapel] (page 7) Only the opening of this section was told; the later pages are absent from this deliberately incomplete candidate.');};
 const omitted=await runEssentials({connection,storyId:'coverage',nodes});assert(omitted.pending);assert.match(omitted.why,/chronological source ranges are incomplete/);assert.equal(await db.settings.get(ESSENTIALS_KEY('coverage')),undefined);
 // A noncompliant model on an indivisible source cannot certify capacity.
 mode='impossible';calls=0;const one=[nodes[0]];globalThis.fetch=async()=>{calls++;return stream(oversized);};
 await db.settings.set(ESSENTIALS_KEY('impossible'),prior);
 const impossible=await runEssentials({connection,storyId:'impossible',nodes:one});assert(impossible.pending);assert.equal(calls,3);assert.deepEqual(await db.settings.get(ESSENTIALS_KEY('impossible')),prior);
 assert.equal(connection.maxTokens,32000);assert.equal(connection.reasoning.effort,'off');
 assert(workerConnection({...connection,type:'kimi',model:'kimi-k3'},{maxTokens:5000,maxTokensLimit:5000}).maxTokens>=16000,'mandatory reasoning floor remains');
 assert.equal(workerConnection(connection,{maxTokens:5000}).maxTokens,32000,'unrelated workers keep their configured allowance');
 console.log(JSON.stringify({result:'pass',rejectedChars:31922,acceptedBudget:16000,savedChars:saved.text.length,sourceReceipts:saved.sources.length,wholeAndRevisionCalls:3,chronologicalRepairCalls:2,resumedCalls:1,sourceIsolation:true,impossiblePending:true,liveCalls:0}));
} finally {globalThis.fetch=originalFetch;}
