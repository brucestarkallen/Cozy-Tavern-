import {createRequire} from 'node:module';
createRequire(new URL('../dom/package.json',import.meta.url))('fake-indexeddb/auto');
import assert from 'node:assert/strict';
import {db} from '../../js/store.js';
import {sourceBindings,sourceBindingIssues} from '../../js/assemble/selection.js';
import {repairInvalidRecordSources,loadMemory,memoryAfterDeletion,memoryAfterInsertion,memoryTruncatedAt} from '../../js/agents/memory.js';

const connection={id:'fixture',type:'openai',baseUrl:'https://repair.fixture/v1',model:'fixture',apiKey:'fixture',contextSize:200000,maxTokens:32000,reasoning:{effort:'off'}};
const calls=[];
globalThis.fetch=async(url,init={})=>{
 const body=JSON.parse(init.body || '{}'),wire=JSON.stringify(body);calls.push(body);
 const system=(body.messages || []).filter(m=>m.role==='system').map(m=>m.content).join('\n');
 const user=(body.messages || []).filter(m=>m.role==='user').map(m=>m.content).join('\n');
 let text='NONE';
 if(system.includes('You are a precise narrative-state tracker')){
  const current=user.includes('CURRENT_PAGE_EDIT')?'CURRENT_PAGE_EDIT':user.includes('PROMOTED_EDIT')?'PROMOTED_EDIT':'SOURCE_PAGE';
  text='[Dawn, chapel] Neri records '+current+' and preserves the promise to return the copper key.';
 } else if(system.includes('You condense the record of a long collaborative story')){
  assert(user.includes('CURRENT_PAGE_EDIT') || user.includes('PROMOTED_EDIT'));
  text='- [Dawn, chapel] (pages 1 to 4) The first meeting changed trust after the key returned; CURRENT_PAGE_EDIT corrected the earlier account; Mara still owes Neri the unopened letter before sunset, conditional on her brother returning.';
 }
 const events=[
  {choices:[{delta:{content:text}}]},
  {choices:[{delta:{},finish_reason:'stop'}]},
  {choices:[],usage:{prompt_tokens:200,completion_tokens:80,total_tokens:280}},
 ];
 const sse=events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join('')+'data: [DONE]\n\n';
 return new Response(sse,{status:200,headers:{'content-type':'text/event-stream'}});
};

async function make(title,count=4){
 const story=await db.stories.create({title});
 let pages=[];
 for(let i=0;i<count;i++){
  await db.messages.append(story.id,{id:story.id+':p'+i,ts:1000+i,role:'assistant',text:'[Dawn, chapel] SOURCE_PAGE_'+i+' describes the promise and the letter.'});
 }
 pages=(await db.messages.list(story.id)).filter(p=>!p.hidden);
 const nodes=pages.map((page,i)=>({id:'line'+i,span:[i,i],text:'[Dawn, chapel] SOURCE_PAGE_'+i+' preserves an earlier promise.',detail:'manual detail '+i,level:1,sourcePages:sourceBindings([page])}));
 await db.settings.set('memory:'+story.id,{nodes});
 return {story,pages,nodes};
}

// One changed source rereads only its line, while an unrelated hand-edited
// line and all other source receipts remain intact.
const edited=await make('Edited original');
const manual={...edited.nodes[3],text:'[Dawn, chapel] The writer keeps Mara’s independent rule about the letter.',verified:{fixed:'the writer'}};
edited.nodes[3]=manual;
await db.settings.set('memory:'+edited.story.id,{nodes:edited.nodes});
await db.messages.update(edited.story.id,edited.pages[1].id,{text:'[Noon, chapel] CURRENT_PAGE_EDIT corrects the earlier promise; Mara still owes the unopened letter before sunset.'});
let current=(await db.messages.list(edited.story.id)).filter(p=>!p.hidden);
assert.equal(sourceBindingIssues(edited.nodes,current)[0].kind,'edited');
calls.length=0;
let repair=await repairInvalidRecordSources({connection,storyId:edited.story.id});
assert(repair.ok && repair.changed>0 && !repair.remaining,JSON.stringify(repair));
let mem=await loadMemory(edited.story.id);current=(await db.messages.list(edited.story.id)).filter(p=>!p.hidden);
assert.deepEqual(sourceBindingIssues(mem.nodes,current),[]);
assert(mem.nodes.find(n=>n.id==='line1').text.includes('CURRENT_PAGE_EDIT'));
assert.equal(mem.nodes.find(n=>n.id==='line0').text,edited.nodes[0].text);
assert.equal(mem.nodes.find(n=>n.id==='line3').text,manual.text);
assert.deepEqual(mem.nodes.find(n=>n.id==='line3').verified,manual.verified);
assert(calls.length>=2,'the keeper reread and audited only the affected source line');

// A promoted line is reopened through the keeper's existing merged-line path.
const promoted=await make('Promoted source',4);
const merged={id:'promoted',span:[0,3],text:'[Dawn, chapel] The folded source line still holds the original promises.',level:2,sourcePages:sourceBindings(promoted.pages)};
await db.settings.set('memory:'+promoted.story.id,{nodes:[merged]});
await db.messages.update(promoted.story.id,promoted.pages[2].id,{text:'[Noon, chapel] PROMOTED_EDIT establishes that Ivo sent the letter, not Neri.'});
calls.length=0;
repair=await repairInvalidRecordSources({connection,storyId:promoted.story.id});
mem=await loadMemory(promoted.story.id);current=(await db.messages.list(promoted.story.id)).filter(p=>!p.hidden);
assert(repair.ok && !repair.remaining && !mem.nodes.some(n=>n.id==='promoted'),JSON.stringify(repair));
assert(mem.nodes.some(n=>n.text.includes('PROMOTED_EDIT')));
assert.deepEqual(sourceBindingIssues(mem.nodes,current),[]);

// Exact copied branches rebind provenance without a new model call.
const parent=await make('Parent for branch',2);
const branch=await db.stories.create({title:'Proven copied branch'});
for(const page of await db.messages.list(parent.story.id))await db.messages.copy(branch.id,page);
await db.settings.set('memory:'+branch.id,{nodes:structuredClone(parent.nodes)});
calls.length=0;
repair=await repairInvalidRecordSources({connection,storyId:branch.id});
mem=await loadMemory(branch.id);current=(await db.messages.list(branch.id)).filter(p=>!p.hidden);
assert(repair.ok && !repair.remaining && calls.length===0,JSON.stringify(repair));
assert.deepEqual(sourceBindingIssues(mem.nodes,current),[]);
assert.deepEqual(mem.nodes[0].sourceOrigins,parent.nodes[0].sourcePages);
assert.deepEqual(await db.settings.get('memory:'+parent.story.id),{nodes:parent.nodes});

// Span-only drift is repaired from exact unchanged original ids and versions.
const relocated=await make('Relocated metadata',3);
const moved={...relocated.nodes[0],span:[1,1]};
await db.settings.set('memory:'+relocated.story.id,{nodes:[moved]});
assert.equal(sourceBindingIssues([moved],relocated.pages)[0].kind,'relocated');
calls.length=0;
repair=await repairInvalidRecordSources({connection,storyId:relocated.story.id});
mem=await loadMemory(relocated.story.id);
assert(repair.ok && !repair.remaining && calls.length===0,JSON.stringify(repair));
assert.deepEqual(mem.nodes[0].span,[0,0]);assert.equal(mem.nodes[0].text,moved.text);

// Page deletion, insertion and rewind update source receipts with their spans.
const refs=sourceBindings(edited.pages);
const covering={id:'cover',span:[0,3],text:'cover',level:1,sourcePages:refs};
const afterDelete=memoryAfterDeletion({nodes:[covering]},1,{keepCovering:()=>true}).nodes[0];
assert.deepEqual(afterDelete.span,[0,2]);assert.deepEqual(afterDelete.sourcePages,refs);
assert.equal(sourceBindingIssues([afterDelete],edited.pages.filter((_,i)=>i!==1))[0].kind,'binding-shape');
const manualCover={...covering,verified:{fixed:'the writer'}};
const manualDelete=memoryAfterDeletion({nodes:[manualCover]},1,{keepCovering:()=>true}).nodes[0];
assert.equal(manualDelete.sourcePages,undefined);assert.deepEqual(manualDelete.sourceOrigins,refs);assert.equal(manualDelete.text,manualCover.text);
const insertedPages=[edited.pages[0],{id:'new-page',ts:1000.5,role:'assistant',text:'a restored page'},...edited.pages.slice(1)];
const afterInsert=memoryAfterInsertion({nodes:[covering]},1,{keepCovering:()=>true}).nodes[0];
assert.deepEqual(afterInsert.span,[0,4]);assert.deepEqual(afterInsert.sourcePages,refs);
assert.equal(sourceBindingIssues([afterInsert],insertedPages)[0].kind,'binding-shape');
const manualInsert=memoryAfterInsertion({nodes:[manualCover]},1,{keepCovering:()=>true}).nodes[0];
assert.equal(manualInsert.sourcePages,undefined);assert.deepEqual(manualInsert.sourceOrigins,refs);assert.equal(manualInsert.text,manualCover.text);
const cut=memoryTruncatedAt({nodes:[covering]},2,{keepCovering:()=>true}).nodes[0];
assert.deepEqual(cut.span,[0,1]);assert.deepEqual(cut.sourcePages,refs);
assert.equal(sourceBindingIssues([cut],edited.pages.slice(0,2))[0].kind,'binding-shape');
const manualCut=memoryTruncatedAt({nodes:[manualCover]},2,{keepCovering:()=>true}).nodes[0];
assert.equal(manualCut.sourcePages,undefined);assert.deepEqual(manualCut.sourceOrigins,refs);assert.equal(manualCut.text,manualCover.text);
const promotedPair={id:'pair',span:[0,1],text:'pair',level:2,sourcePages:refs.slice(0,2)};
assert.equal(sourceBindingIssues([promotedPair],[edited.pages[1],edited.pages[0],...edited.pages.slice(2)])[0].kind,'reordered');
assert.equal(sourceBindingIssues([promotedPair],edited.pages.slice(1))[0].kind,'unavailable');
assert.deepEqual(sourceBindingIssues([{id:'legacy',span:[0,0],text:'old memory'}],edited.pages),[]);
const stopped=await make('Stopped source repair',1);
await db.messages.update(stopped.story.id,stopped.pages[0].id,{text:'A changed original that waits for the keeper.'});
const beforeStop=await loadMemory(stopped.story.id),stop=new AbortController();stop.abort(new Error('stopped by hand'));
await assert.rejects(repairInvalidRecordSources({connection,storyId:stopped.story.id,signal:stop.signal}),/stopped by hand/);
assert.deepEqual(await loadMemory(stopped.story.id),beforeStop);

console.log(JSON.stringify({result:'pass',editedLineRepaired:true,promotedLineReopened:true,copiedBranchReboundWithoutModelCall:true,relocatedMetadataPreservedWithoutModelCall:true,manualRecordPreserved:true,deletedReorderedRewoundAndLegacyClassified:true,deliberateStopPreserved:true,structuralSourceReceipts:true,copiedBranchModelCalls:calls.length,liveCalls:0}));
