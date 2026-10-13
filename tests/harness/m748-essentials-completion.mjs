import {createRequire} from 'node:module';
createRequire(new URL('../dom/package.json',import.meta.url))('fake-indexeddb/auto');
import assert from 'node:assert/strict';
import {db,dropCaches} from '../../js/store.js';
import {sourceBindings} from '../../js/assemble/selection.js';
import {runEssentials,loadEssentialsView,recordOf,ESSENTIALS_KEY,PENDING_KEY} from '../../js/agents/essentials.js';

const connection={id:'fixture',type:'openai',model:'fixture',contextSize:200000,maxTokens:32000,reasoning:{effort:'off'}};
const events=[
  'Neri first met Mara in the chapel after finding a copper key beneath the broken bell.',
  'Mara promised Neri passage across the river only if Neri brought Mara\'s missing brother home alive.',
  'Neri traced the key to Ivo\'s sealed letter and kept the letter in the chapel cupboard.',
  'Neri returned the copper key instead of selling it, so Mara began to trust Neri.',
  'Mara knows where the letter is hidden; Neri does not know Mara has read the letter.',
  'Ivo demanded the key before sunset, but Mara refused because the missing brother still needed it.',
  'Neri chose the flooded road to avoid Ivo\'s guards and injured Neri\'s left ankle.',
  'Mara and Neri began touching the chapel bell before leaving, a promise to return together.',
  'Mara gave Neri a dry coat after Neri confessed fear; their suspicion became open affection.',
  'Neri thought Mara had sent the warning letter because it bore Mara\'s wax seal.',
  'Mara agreed to guard the bridge while Neri searched the abandoned mill for Mara\'s brother.',
  'Neri found a ribbon in the mill, evidence that Mara\'s brother had crossed the river alive.',
  'Ivo admitted taking Mara\'s seal but refused to reveal who now held the brother.',
  'The late correction establishes that Ivo sent the warning letter, not Mara; Neri now knows this.',
  'Mara still owes the bridge report before sunset; the brother remains missing, so promised passage is still conditional.'
];
async function fixture(){
  const story=await db.stories.create({title:'Forty eight pages and fifteen folded records'});
  for(let i=0;i<48;i++){
    const event=Math.min(14,Math.floor(i/3));
    await db.messages.append(story.id,{id:story.id+':page:'+i,ts:100+i,role:'assistant',
      text:'[Day '+(event+1)+', chapel] '+events[event]+' Original page '+(i+1)+' records the current scene.'});
  }
  const pages=await db.messages.list(story.id);
  const nodes=events.map((event,i)=>{
    const span=[i*3,i===14?47:i*3+2];
    return {id:'fold:'+i,span,level:2,text:'[Day '+(i+1)+', chapel] '+event,sourcePages:sourceBindings(pages.slice(span[0],span[1]+1))};
  });
  await db.settings.set('memory:'+story.id,{nodes});
  return {storyId:story.id,nodes,pages};
}

const f=await fixture(),beforePages=JSON.stringify(f.pages),beforeMemory=JSON.stringify(await db.settings.get('memory:'+f.storyId));
const record=recordOf(f.nodes).text;
assert(record.length<17000);
let calls=0;
const completed=await runEssentials({...f,connection,callLLM:async()=>{calls++;throw Error('already compact complete record must not call the model');}});
assert(completed.wrote && completed.usedRecord,JSON.stringify(completed));
assert.equal(calls,0);assert.equal(completed.usage.calls,0);
let view=await loadEssentialsView(f.storyId);
assert(view.current && view.eligible);assert.equal(view.snapshot.text,record);
assert.equal(view.snapshot.sources.length,15);assert.equal(view.snapshot.sourcePages.length,48);
for(const event of events)assert(view.snapshot.text.includes(event));
assert.equal(await db.settings.get(PENDING_KEY(f.storyId)),undefined);
dropCaches();
view=await loadEssentialsView(f.storyId);assert(view.current && view.eligible);assert.equal(view.snapshot.text,record);
assert.equal((await runEssentials({...f,connection,callLLM:()=>{throw Error('unchanged completed record repeated');}})).why,'unchanged');

// Page receipts are structural coverage. Equivalent header spelling cannot
// discard a complete response or spend three more provider requests.
const meaning=events.join(' ');
for(const header of ['[Day 1, chapel] (pages: 1–48)','[Day 1, chapel] (pp.1–48)','[Day 1, chapel · pages 1 to 48]']){
  calls=0;const text='- '+header+' '+meaning;
  const out=await runEssentials({...f,connection,force:true,callLLM:async()=>{calls++;return {text,finishReason:'stop'};}});
  assert(out.wrote,JSON.stringify(out));assert.equal(calls,1);assert(!out.usedRecord);
  assert.equal((await loadEssentialsView(f.storyId)).snapshot.text,text);
}
const accepted=await db.settings.get(ESSENTIALS_KEY(f.storyId));
for(const text of ['- [Day 1, chapel] (pages 1 to 47) '+meaning,
  '- [Day 1, chapel] '+meaning+' Neri discussed the record (pages 1 to 48).']){
  calls=0;
  const out=await runEssentials({...f,connection,force:true,callLLM:async()=>{calls++;return {text,finishReason:'stop'};}});
  assert.equal(out.outcome,'yielded');assert.equal(calls,3);
  assert.match(out.why,/chronological source ranges are incomplete/);
  assert.deepEqual(await db.settings.get(ESSENTIALS_KEY(f.storyId)),accepted);
}

// Queue timeouts remain failed requests even though the queue's signal has
// aborted. The same explicit candidate retains a finite failure count.
calls=0;
for(let attempt=1;attempt<=4;attempt++){
  if(attempt>1){const pending=await db.settings.get(PENDING_KEY(f.storyId));await db.settings.set(PENDING_KEY(f.storyId),{...pending,nextAt:0});}
  const controller=new AbortController();
  const out=await runEssentials({...f,connection,force:attempt===1,signal:controller.signal,callLLM:async()=>{
    calls++;controller.abort(new Error('timeout'));throw new Error('provider stream aborted');
  }});
  assert.equal(out.outcome,attempt===4?'blocked':'failed');
  const pending=await db.settings.get(PENDING_KEY(f.storyId));
  assert.equal(pending.attempts,attempt);assert(pending.explicit);
  if(attempt<4)assert(out.retryAt>Date.now());
  assert.deepEqual(await db.settings.get(ESSENTIALS_KEY(f.storyId)),accepted);
}
assert.equal(calls,4);
assert.equal((await runEssentials({...f,connection,callLLM:()=>{throw Error('unchanged repeated timeouts must stay bounded');}})).outcome,'blocked');
const stop=new AbortController();
await assert.rejects(runEssentials({...f,connection,force:true,signal:stop.signal,callLLM:async()=>{
  stop.abort(new Error('stopped by owner'));throw stop.signal.reason;
}}),/stopped by owner/);
assert.deepEqual(await db.settings.get(ESSENTIALS_KEY(f.storyId)),accepted);
assert.equal(JSON.stringify(await db.messages.list(f.storyId)),beforePages);
assert.equal(JSON.stringify(await db.settings.get('memory:'+f.storyId)),beforeMemory);
console.log(JSON.stringify({result:'pass',pages:48,foldedRecords:15,compactRecordChars:record.length,
  compactRecordProviderCalls:0,exactCurrentRecordSaved:true,chronologyAndConditionalPromiseAndLateCorrection:true,
  reloadCurrentWithoutCall:true,headerVariantsOneCallEach:3,missingAndNarrativeOnlyCoverageRejected:true,
  queueTimeoutFailureCountPersists:true,timeoutsBoundedAt:4,deliberateStopPreservesAccepted:true,
  originalPagesAndFoldedRecordsUnchanged:true,simulatedReplies:true,liveCalls:0}));
