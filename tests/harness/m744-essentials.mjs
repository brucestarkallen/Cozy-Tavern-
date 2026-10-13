import {createRequire} from 'node:module';
createRequire(new URL('../dom/package.json',import.meta.url))('fake-indexeddb/auto');
import assert from 'node:assert/strict';
import {db,dropCaches} from '../../js/store.js';
import {runEssentials,loadEssentials,loadEssentialsView,essentialsRecoveryState,essentialsRunNote,ESSENTIALS_KEY,PENDING_KEY,sourcePrint,recordOf} from '../../js/agents/essentials.js';
import {emptyState,saveState,loadState} from '../../js/engine/state.js';
import {sourceBindings} from '../../js/assemble/selection.js';
import {buildRequest} from '../../js/assemble/stack.js';
import {renderMemory} from '../../js/agents/memory.js';
import {measureTransport} from '../../js/providers/measure.js';
import {inputRoom} from '../../js/assemble/budget.js';
import {workerConnection} from '../../js/agents/call.js';
import {enqueueWork,workIsRunning} from '../../js/agents/queue.js';
import {healthSnapshot} from '../../js/agents/health.js';
const connection={id:'fixture',type:'openai',baseUrl:'https://fixture.example/v1',model:'fixture',apiKey:'fixture',contextSize:200000,maxTokens:32000,reasoning:{effort:'off'}};
const meanings=[
 'FIRST_MEETING. Neri met Mara after rescuing her brother; gratitude became trust. Mara promised help only if Neri returned the copper key.',
 'RELATIONSHIP_CHANGE. Neri returned the key, so Mara trusted Neri; Mara taught Neri their private ritual, tap twice and wait.',
 'KNOWLEDGE_BOUNDARY. Mara knows where the hidden chest stands; Neri knows the chest exists but not its location.',
 'UNRESOLVED_OBLIGATION. The search for Mara\'s missing brother remains unfinished; Neri owes Mara a report tomorrow.',
 'LATE_CORRECTION. The messenger was Ivo, not Neri; Mara now knows the promise was paid, but Ivo still believes the debt remains.',
 'LATEST_OBLIGATION. Mara must send the unopened letter before sunset; Neri must keep the location secret until her brother returns.'
];
async function fixture(count=4,pad=0) {
 const story=await db.stories.create({title:'M744 lifecycle',brief:'A promise, a correction and a remaining debt.'});
 let state={...emptyState(),sheet:{actors:{},playerName:'Neri',playerAliases:[]}};await saveState(story.id,state);state=await loadState(story.id);
 const nodes=[];
 for(let i=0;i<count;i++) {
  const gist=meanings[i%meanings.length]+' SOURCE_'+i+'_KEEP.';
  await db.messages.append(story.id,{id:story.id+':page'+i,ts:1000+i,role:'assistant',text:'[Dawn, chapel] '+gist});
  const pages=await db.messages.list(story.id);
  nodes.push({id:'record'+i,span:[i,i],text:'[Dawn, chapel] '+gist+(pad?' '+('Incidental weather, no later consequence. '.repeat(pad)):''),detail:'DETAIL_'+i+'_KEEP.',level:1,sourcePages:sourceBindings([pages[i]])});
 }
 await db.settings.set('memory:'+story.id,{nodes});
 return {story,state,nodes,connection};
}
const output=(lines,extra='')=>lines.map(n=>'- '+(n.text.match(/^\[[^\]]+\]/)?.[0] || '[Dawn, chapel]')+' (pages '+(n.span[0]+1)+' to '+(n.span[1]+1)+') '+meanings[Number(n.id.replace(/\D/g,''))%meanings.length]+' SOURCE_'+Number(n.id.replace(/\D/g,''))+'_KEEP.'+(n.detail?' '+n.detail:'')+extra).join('\n');
const inAsk=(ask,nodes)=>{const user=ask.messages?.[0].content || ask.user;return nodes.filter(n=>user.includes('SOURCE_'+Number(n.id.replace(/\D/g,''))+'_KEEP.'));};
const run=(f,callLLM,opts={})=>runEssentials({...f,storyId:f.story.id,brief:f.story.brief,mc:'Neri',callLLM,...opts});
async function accept(f,nodes=f.nodes) {const result=await run({...f,nodes},async()=>({text:output(nodes)}));assert(result.wrote,JSON.stringify(result));return await db.settings.get(ESSENTIALS_KEY(f.story.id));}
async function grow(f) {
 for(let i=4;i<6;i++) {await db.messages.append(f.story.id,{id:f.story.id+':page'+i,ts:1000+i,role:'assistant',text:'[Noon, chapel] '+meanings[i]});const pages=await db.messages.list(f.story.id);f.nodes.push({id:'record'+i,span:[i,i],text:'[Noon, chapel] '+meanings[i]+' SOURCE_'+i+'_KEEP.',detail:'DETAIL_'+i+'_KEEP.',level:1,sourcePages:sourceBindings([pages[i]])});}
 await db.settings.set('memory:'+f.story.id,{nodes:f.nodes});
}
async function assembly(f,essentials) {
 if(essentials===undefined) essentials=await loadEssentials(f.story.id);
 const history=await db.messages.list(f.story.id),messages=[...history,{id:'move',role:'user',text:'Ask Mara about the promise and unopened letter.'}];
 const req=buildRequest({story:f.story,state:f.state,messages,settings:{frameOn:false,refereeOn:false},modules:[],memory:renderMemory({nodes:f.nodes},Infinity),smallEssentials:essentials,
  window:{keeperOn:true,window:2,nodes:f.nodes,recordThrough:history.length,budgetTokens:200000,answerTokens:5000},transportMeasure:request=>measureTransport(f.connection,request)});
 return {req,text:req.systemBlocks.map(b=>b.text).join('\n')+'\n'+req.messages.map(m=>m.content).join('\n')};
}
// Previously accepted memory is produced through the real generation/save path.
const f=await fixture(),accepted=await accept(f);assert.equal((await loadEssentials(f.story.id)).text,accepted.text);
await grow(f);const originalNodes=structuredClone(f.nodes),rawPrevious=JSON.stringify(accepted);
let calls=0;
const fail=await run(f,async()=>{calls++;return {text:'Not a usable record.'};});assert(fail.pending,JSON.stringify(fail));assert.equal(calls,3);
assert.equal(JSON.stringify(await db.settings.get(ESSENTIALS_KEY(f.story.id))),rawPrevious);
let view=await loadEssentialsView(f.story.id);assert(view.snapshot.text===accepted.text && view.eligible && !view.current);
assert(essentialsRunNote(fail).detail.includes('Previous accepted essentials remain available'));
let selected=await assembly(f);assert(selected.req.selection.essentials);assert(selected.text.includes('LATE_CORRECTION'));assert(selected.text.includes('LATEST_OBLIGATION'));
assert(selected.req.receipt.context.inputTokens<=selected.req.receipt.context.inputRoom);
// A record content change or rewind preserves visible history, never old injection.
const changed=structuredClone(f.nodes);changed[0].text='[Dawn, chapel] CORRECTED_CURRENT_RECORD. Neri never made the old promise.';
await db.settings.set('memory:'+f.story.id,{nodes:changed});view=await loadEssentialsView(f.story.id);assert(view.snapshot && !view.eligible);
selected=await assembly({...f,nodes:changed});assert(!selected.req.selection.essentials);assert(selected.text.includes('CORRECTED_CURRENT_RECORD'));
await db.settings.set('memory:'+f.story.id,{nodes:f.nodes});
await db.messages.deleteFrom(f.story.id,(await db.messages.list(f.story.id))[2].id);await db.settings.set('memory:'+f.story.id,{nodes:f.nodes.slice(0,2)});
view=await loadEssentialsView(f.story.id);assert(view.snapshot.text===accepted.text && !view.eligible);
selected=await assembly({...f,nodes:f.nodes.slice(0,2)});assert(!selected.req.selection.essentials);assert(!selected.text.includes('LATE_CORRECTION'));
await db.settings.set('memory:'+f.story.id,{nodes:f.nodes});const future=await run(f,async()=>{throw Error('future record must not reach provider');});assert.equal(future.outcome,'blocked');
// Source edit invalidates even when old memory nodes have not yet been refolded.
const edited=await fixture();await accept(edited);const pages=await db.messages.list(edited.story.id);await db.messages.update(edited.story.id,pages[0].id,{text:'Current original was edited.'});
assert(!(await loadEssentialsView(edited.story.id)).eligible);
const sourceBlocked=await run(edited,async()=>{throw Error('stale bound originals must not reach a provider');});assert.equal(sourceBlocked.outcome,'blocked');
assert((await db.settings.get(PENDING_KEY(edited.story.id))).outcome==='blocked');
const legacyRecord=await fixture();legacyRecord.nodes=legacyRecord.nodes.map(({sourcePages,...n})=>n);await db.settings.set('memory:'+legacyRecord.story.id,{nodes:legacyRecord.nodes});await accept(legacyRecord);
assert((await loadEssentialsView(legacyRecord.story.id)).eligible);const legacyPage=(await db.messages.list(legacyRecord.story.id))[0];await db.messages.update(legacyRecord.story.id,legacyPage.id,{text:'An edit after a legacy record generation.'});assert(!(await loadEssentialsView(legacyRecord.story.id)).eligible);
// A proven folded layout reuses unchanged page versions; a manual detail edit does not.
const folded=await fixture();const beforeFold=await accept(folded);
const merged={id:'merged',span:[0,3],text:'[Dawn, chapel] The same chronology, folded into one entry.',level:2,sourcePages:sourceBindings(await db.messages.list(folded.story.id))};
await db.settings.set('memory:'+folded.story.id,{nodes:[merged]});view=await loadEssentialsView(folded.story.id);assert(view.eligible && view.current);
assert.equal((await run({...folded,nodes:[merged]},async()=>{throw Error('unchanged refold must not call');})).why,'unchanged');
assert((await assembly({...folded,nodes:[merged]},view.snapshot)).req.selection.essentials);
await db.settings.set('memory:'+folded.story.id,{nodes:folded.nodes.map((n,i)=>i? n:{...n,detail:'A manual change to the record.'})});assert(!(await loadEssentialsView(folded.story.id)).eligible);
// Existing branches copy complete pages with new ids. Rebind only exact copies
// of their explicitly referenced originals, preserving parent records and origins.
const parent=await fixture();const parentMemory=structuredClone(await db.settings.get('memory:'+parent.story.id));
const branchStory=await db.stories.create({title:'A carried branch',brief:parent.story.brief});await saveState(branchStory.id,parent.state);
for(const page of await db.messages.list(parent.story.id))await db.messages.copy(branchStory.id,page);
const branch={...parent,story:branchStory,nodes:structuredClone(parent.nodes)};await db.settings.set('memory:'+branchStory.id,{nodes:branch.nodes});
assert((await run(branch,async(c,ask)=>({text:output(inAsk(ask,branch.nodes))}))).wrote);
const branchMemory=await db.settings.get('memory:'+branchStory.id),branchPages=await db.messages.list(branchStory.id);
assert.equal(branchMemory.nodes[0].sourcePages[0].id,branchPages[0].id);assert.deepEqual(branchMemory.nodes[0].sourceOrigins,parent.nodes[0].sourcePages);
assert.deepEqual(await db.settings.get('memory:'+parent.story.id),parentMemory);assert((await loadEssentialsView(branchStory.id)).eligible);
// Three failed draft replies lead to a genuinely fresh source conversation, not more shrinking.
const replanned=await fixture();const beforeReplacement=await accept(replanned);await grow(replanned);const replanNodes=structuredClone(replanned.nodes);calls=0;let fresh=false,sectionCaps=[];
const rejectedPrefix='- [Dawn, chapel] (pages 1 to 6) ';
const oversized=rejectedPrefix+'X'.repeat(31922-rejectedPrefix.length-1)+'.';assert.equal(oversized.length,31922);
const completed=await run(replanned,async(c,ask)=>{
 calls++;assert.equal((await db.settings.get(ESSENTIALS_KEY(replanned.story.id))).text,beforeReplacement.text);
 const user=ask.messages?.[0].content || ask.user;
 const measured=measureTransport(workerConnection(c,ask),{system:ask.system,messages:ask.messages || [{role:'user',content:ask.user}]});
 assert(measured.inputTokens<=inputRoom({budgetTokens:c.contextSize,answerTokens:measured.answerTokens}));
 if(calls<=3) {if(calls>1)assert(ask.messages.some(m=>m.role==='assistant'));return {text:oversized};}
 if(calls===4) {assert(!ask.messages);assert(user.includes('FRESH SOURCE READING'));for(const n of replanned.nodes)assert(user.includes(n.text));fresh=true;return {text:oversized};}
 const lines=inAsk(ask,replanned.nodes);const cap=Number(user.match(/within (\d+) characters/)[1]);sectionCaps.push(cap);
 const extra=calls===5?' '+('A lasting narrative detail. '.repeat(105)):'';
 return {text:output(lines,extra)};
});assert(completed.wrote && fresh);assert.equal(calls,6);assert(sectionCaps[0]>15000);assert(sectionCaps[1]>5000);
const replacement=await db.settings.get(ESSENTIALS_KEY(replanned.story.id));assert(replacement.text.length<=16000);assert(replacement.text.indexOf('[Noon, chapel]')>replacement.text.indexOf('[Dawn, chapel]'));
for(const token of ['FIRST_MEETING','RELATIONSHIP_CHANGE','only if Neri returned','KNOWLEDGE_BOUNDARY','LATE_CORRECTION','Ivo, not Neri','LATEST_OBLIGATION','before sunset','UNRESOLVED_OBLIGATION','tap twice and wait'])assert(replacement.text.includes(token),token);
assert.equal(await db.settings.get(PENDING_KEY(replanned.story.id)),undefined);assert.deepEqual((await db.settings.get('memory:'+replanned.story.id)).nodes,replanNodes);
assert.equal((await run(replanned,async()=>{throw Error('completed input must not repeat');})).why,'unchanged');
// Processing allowance is a queue yield, including all compatible future receipts.
const many=await fixture(13,200);many.connection={...connection,contextSize:16000,maxTokens:5000};await db.settings.set('memory:'+many.story.id,{nodes:many.nodes.slice(0,1)});
const older=await accept(many,many.nodes.slice(0,1));await db.settings.set('memory:'+many.story.id,{nodes:many.nodes});calls=0;let otherRan=false;
const queued=enqueueWork(many.story.id,{name:'essentials',run:async({signal,stale,renew})=>essentialsRunNote(await run(many,async(c,ask)=>{calls++;return {text:output(inAsk(ask,many.nodes))};},{signal,stale,renew}))});
const other=enqueueWork(many.story.id,{name:'keeper',run:async()=>{otherRan=true;return {detail:'Fair queue fixture.'};}});
await queued;await other;assert(otherRan && !workIsRunning(many.story.id));assert.equal(calls,12);
let pending=await db.settings.get(PENDING_KEY(many.story.id));assert.equal(pending.outcome,'yielded');assert.equal(pending.attempts,0);assert.equal(pending.parts.length,12);assert(pending.nextAt-Date.now()<2000);
assert.equal((await db.settings.get(ESSENTIALS_KEY(many.story.id))).text,older.text);
assert(!essentialsRunNote({...pending,pending:true,progress:{done:12,total:13},previousAvailable:true}).detail.includes('answer 0'));
// Reopening an interrupted traversal must not erase valid sections not yet visited.
pending.plan[0].complete=false;delete pending.plan[0].text;pending.parts=pending.parts.filter(p=>p.print!==pending.plan[0].print);pending.nextAt=0;
await db.settings.set(PENDING_KEY(many.story.id),pending);const abort=new AbortController();
await assert.rejects(run(many,async()=>{abort.abort(new Error('stopped by hand'));throw abort.signal.reason;},{signal:abort.signal}),/stopped by hand/);
dropCaches();pending=await db.settings.get(PENDING_KEY(many.story.id));assert.equal(pending.parts.length,11);assert(pending.plan[11].complete);
const resumed=await import('../../js/agents/essentials.js?reloadFixture');calls=0;
assert((await resumed.runEssentials({...many,storyId:many.story.id,brief:many.story.brief,mc:'Neri',callLLM:async(c,ask)=>{calls++;return {text:output(inAsk(ask,many.nodes))};}})).wrote);assert.equal(calls,2);
// M743 quota/505 records migrate immediately and preserve their real accepted work.
const published=await db.settings.get(ESSENTIALS_KEY(many.story.id));await db.settings.set(ESSENTIALS_KEY(many.story.id),older);
const legacy={...pending,repairPolicy:3,attempts:3,nextAt:Date.now()+900000,why:'source part 1 of 1: bounded recovery round reached its request limit; completed sections are saved (answer 0 characters; allowed 505)',diagnostic:{why:'bounded recovery round reached its request limit',share:505,chars:0},parts:published.parts.slice(0,12),splits:[]};
await db.settings.set(PENDING_KEY(many.story.id),legacy);calls=0;
assert((await run(many,async(c,ask)=>{calls++;assert(!ask.user.includes('within 505 characters'));return {text:output(inAsk(ask,many.nodes))};})).wrote);assert.equal(calls,1);
// Real unchanged failure still backs off and eventually pauses, without false green.
const broken=await fixture();calls=0;let failed;
for(let i=0;i<4;i++) {
 if(i){const p=await db.settings.get(PENDING_KEY(broken.story.id));await db.settings.set(PENDING_KEY(broken.story.id),{...p,nextAt:0});}
 failed=await run(broken,async()=>{calls++;throw Object.assign(new Error('Provider unavailable'),{retryAfterMs:90000});});
 if(i<3)assert(failed.retryAt>=Date.now()+89900);
}
assert.equal(calls,4);assert.equal(failed.outcome,'blocked');
const blockedView=essentialsRecoveryState({kept:await db.settings.get(ESSENTIALS_KEY(broken.story.id)),pending:await db.settings.get(PENDING_KEY(broken.story.id)),nodes:broken.nodes,brief:broken.story.brief,mc:'Neri',connection});
assert(blockedView.blocked);await run(broken,async()=>{throw Error('blocked failure must not loop');});assert.equal(healthSnapshot({essentials:blockedView}).status,'yellow');
assert(essentialsRunNote(failed).detail.includes('No previous accepted essentials are saved yet'));
// A late response cannot overwrite a newer manual value or a different generation.
const manual=await fixture();const manualBefore=await accept(manual);
const won={...manualBefore,text:manualBefore.text+'\n- [Dawn, chapel] (page 4) The writer retained this additional manual decision.'};
const late=await run(manual,async()=>{await db.settings.set(ESSENTIALS_KEY(manual.story.id),won);return {text:output(manual.nodes)};},{force:true});
assert.equal(late.outcome,'superseded');assert.deepEqual(await db.settings.get(ESSENTIALS_KEY(manual.story.id)),won);
assert.equal((await run(manual,async()=>{throw Error('manual completion must not be replaced');})).why,'unchanged');
const foreign=await fixture();const foreignBefore=await accept(foreign);
const lost=await run(foreign,async()=>{const p=await db.settings.get(PENDING_KEY(foreign.story.id));await db.settings.set(PENDING_KEY(foreign.story.id),{...p,generationId:'another-generation'});return {text:output(foreign.nodes)};},{force:true});
assert.equal(lost.outcome,'superseded');assert.equal((await db.settings.get(PENDING_KEY(foreign.story.id))).generationId,'another-generation');assert.deepEqual(await db.settings.get(ESSENTIALS_KEY(foreign.story.id)),foreignBefore);
assert.equal(connection.maxTokens,32000);assert.equal(connection.reasoning.effort,'off');
console.log(JSON.stringify({result:'pass',acceptedVersion:'normal generated metadata',growthAndRequestCoverage:true,editRewindAndRefoldBoundaries:true,wholeRevisionFreshAndSectionsCalls:6,quotaCalls:12,reloadRemainingCalls:2,legacy505ResumeCalls:1,finiteFailures:4,manualAndGenerationOwnership:true,simulatedReplies:true,liveCalls:0}));
