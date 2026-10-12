import './idb-shim.mjs';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { db } from '../../js/store.js';
import { buildRequest, planRecordSelection, recordLine } from '../../js/assemble/stack.js';
import { recordOf, sourcePrint, essentialsMatch, runEssentials, inspectEssentials, loadEssentials } from '../../js/agents/essentials.js';
import { recallIndex, pickRecall } from '../../js/agents/recallpick.js';
import { renderMemory } from '../../js/agents/memory.js';
import { emptyState } from '../../js/engine/state.js';
import { renderKnowledge, blindSpots, renderBlindSpots, addKnowledge, sameFact, dedupeKnowledge } from '../../js/engine/world.js';
import { settleWitnesses, broadcastPublicMoments } from '../../js/agents/extractor.js';
import { buildOpenAIRequest, createOpenAIProvider } from '../../js/providers/openai.js';
import { buildAnthropicRequest, createAnthropicProvider } from '../../js/providers/anthropic.js';
import { measureTransport } from '../../js/providers/measure.js';
import { bodyAccounting, inputRoom, requestTokens } from '../../js/assemble/budget.js';
import { finalizeReceipt } from '../../js/assemble/receipt.js';
import { sourceBindings, boundRecord } from '../../js/assemble/selection.js';
import { nodeSignature, nodeUnmoved } from '../../js/agents/memory.js';
import { applyMutations, undoLast } from '../../js/engine/apply.js';
import { keepSent, loadSent } from '../../js/sent.js';

const state = {...emptyState(),page:100,sheet:{playerName:'Neri',actors:{}},place:{name:'chapel'},present:[{name:'Neri'},{name:'Mara'},{name:'Ivo'},{name:'Sera'},{name:'Late'}],characters:{
  Mara:{core:'A patient locksmith. She taps twice before opening a door.',arc:'Trust was earned when Neri returned her brother safely.',state:'Keeps her promise.',threads:[]},
  Ivo:{core:'An alert messenger.',threads:[]}, Sera:{core:'A scholar who values proof.',threads:[]}, Late:{core:'A visitor.',threads:[]},
  Absent:{core:'Writer biography. '.repeat(150)+'ABSENT_COMPLETE_FIELD',arc:'An earned change. '.repeat(130)+'ABSENT_COMPLETE_ARC',threads:[]}
},knowledge:{Mara:[{fact:'The key is hidden in the chapel',atTurn:10}],Ivo:[{fact:'saw Mara enter the chapel',atTurn:10}],Sera:[{fact:'believes the key is in the vault',atTurn:11}],Late:[]}};
const nodes = Array.from({length:12},(_,i)=>({id:'r'+i,span:[i*4,i*4+3],text:'[Dawn, the chapel] '+('Quiet scene '+i+'. ').repeat(22)+'End of scene '+i+'.',detail:i===1?'Mara promised help only after her brother was released. EXACT_WORDS: "Tap twice and wait for me."':'An ordinary lasting detail '+i+'.'}));
nodes[1].text += ' The copper key opens the chapel chest BEYOND_OPENING_SIGNAL.';
const summaryNodes=nodes.slice(0,10);
const essentials={text:'[Dawn, chapel] (pages 1 to 40) Neri met Mara. Mara and Neri earned trust by rescuing her brother. The key was hidden; the promise remains conditional.',print:recordOf(summaryNodes).print,sourcePrint:sourcePrint(summaryNodes),upTo:39,complete:true};
const history=Array.from({length:53},(_,i)=>({id:'m'+i,role:i%2?'assistant':'user',text:'Original event '+i+'. A quiet road continues.',ts:i}));
history[5].text='Mara took the copper key to the chapel chest. She touched Neri’s wrist and tapped twice. "Tap twice and wait for me," she said.\n\nNeri waited because her brother was still imprisoned.';
history.at(-2).text='Mara pauses at the chapel chest. Absent has sent a letter.';
history.at(-1).text='I ask Mara about the copper key, the chapel chest and her promise after her brother was released.';
const plan={id:'old',title:'Open the chapel chest',goal:'Recover the copper key',by:'Mara',status:'standing',from:5,parts:[{who:'Mara',does:'Bring the key',when:'only after her brother was released',done:false},{who:'Ivo',does:'Keep watch',when:'after Mara taps twice',done:true}],words:['Tap twice and wait for me.']};
const plans={plans:[plan,...Array.from({length:6},(_,i)=>({id:'new'+i,title:'Unrelated errand '+i,status:'standing',from:20+i,parts:[{who:'Absent',does:'Buy supplies '+i,done:false}]}))]};
const conn={type:'openai',baseUrl:'https://fixture.example/v1',model:'fixture',preset:'custom',contextSize:200000,maxTokens:8000,reasoning:{effort:'off'}};
const settings={frameText:'CUSTOM_FRAME_KEEP',frameOn:true,noteText:'LONG_CLOSING_KEEP '.repeat(300),noteOn:true,refereeOn:false,notesRole:'assistant',ownWords:[{name:'Own exact words',role:'house',place:'after-your-message',text:'CUSTOM_OWN_WORDS_KEEP'}]};
const base={story:{id:'fixture',brief:'WRITER_PREMISE_KEEP. Reference canon yields to this story’s accepted divergence.',castNotes:'AUTHOR_CAST_KEEP'},state,messages:history,settings,modules:[],memory:renderMemory({nodes},Infinity),smallEssentials:essentials,smallPlansBook:plans,recallPicked:['r1'],window:{keeperOn:true,window:5,recordThrough:48,nodes,budgetTokens:200000,answerTokens:8000},transportMeasure:req=>measureTransport(conn,req)};
const textOf=r=>r.systemBlocks.map(b=>b.text).join('\n')+'\n'+r.messages.map(m=>m.content).join('\n');
const originals=structuredClone({state,nodes,history,settings,plans});
const revised=buildRequest(base);const text=textOf(revised);
for(const token of ['BEYOND_OPENING_SIGNAL','Tap twice and wait for me.','only after her brother was released','CUSTOM_FRAME_KEEP','CUSTOM_OWN_WORDS_KEEP','LONG_CLOSING_KEEP','ABSENT_COMPLETE_FIELD','ABSENT_COMPLETE_ARC']) assert(text.includes(token),token);
assert.equal(text.split('BEYOND_OPENING_SIGNAL').length-1,1,'complete record selected once by identity');
assert(revised.selection.records.find(r=>r.id==='r1').detail);
assert(revised.selection.records.find(r=>r.id==='r1').selected);
assert(revised.selection.plans.some(p=>p.id==='old'));
assert(revised.selection.excerpts.some(p=>p.sourceId==='m5'));
assert.equal(text.includes('hasn’t found out'),false,'no categorical legacy ignorance');
assert(text.includes('believes the key is in the vault'));
assert.deepEqual({state,nodes,history,settings,plans},originals,'rendering preserves all original and manual records');
const planned=planRecordSelection({nodes,essentials,state,through:48});
assert(!planned.protectedIds.has('r1'),'old 32000 character exclusion would skip every short entry; actual half-record selection does not');
const index=recallIndex(nodes,{move:history.at(-1).text,lastPage:history.at(-2).text,skip:n=>planned.protectedIds.has(n.id)});
assert(index.some(r=>r.id==='r1'&&r.head.includes('copper key')&&r.head.includes('EXACT_WORDS')));
const selected=await pickRecall({connection:conn,nodes,essentials:essentials.text,move:history.at(-1).text,lastPage:history.at(-2).text,skip:n=>planned.protectedIds.has(n.id),callLLM:async(_c,ask)=>({text:JSON.stringify({lines:[index.find(r=>r.id==='r1').n,99999]})})});
assert.deepEqual(selected.ids,['r1']);
assert.equal((await pickRecall({connection:conn,nodes,callLLM:async()=>({text:'malformed'})})).why,'no usable selection');
const timeout=await pickRecall({connection:conn,nodes,timeoutMs:500,callLLM:async()=>new Promise(()=>{})});assert.equal(timeout.why,'took too long');
const aborted=new AbortController();aborted.abort();assert.equal((await pickRecall({connection:conn,nodes,signal:aborted.signal})).why,'cancelled');
const collision=[{id:'one',span:[0,0],text:'Same rendered description.',detail:'DETAIL_ONE'},{id:'two',span:[1,1],text:'Same rendered description.',detail:'DETAIL_TWO'}];
const collisionPlan=planRecordSelection({nodes:collision,cap:100,state});assert.equal(collisionPlan.recent.nodes.length,1);assert.equal(collisionPlan.recent.nodes[0].id,'two');
assert.equal(collisionPlan.recent.text.includes('DETAIL_ONE'),false);

// Previous complete replacement is retained on both length failure and a failed tightening.
const sid='ess';const prior={text:'[Dawn, old chapel] A usable earlier account. '.repeat(3),print:recordOf([nodes[0]]).print,sourcePrint:sourcePrint([nodes[0]]),upTo:3,complete:true};
await db.settings.set('essentials:'+sid,prior);await db.settings.set('memory:'+sid,{nodes});
let calls=0;
const failed=await runEssentials({connection:conn,storyId:sid,nodes,callLLM:async()=>{calls++;return {text:'[Dawn, chapel] '+ 'Overflow detail. '.repeat(1500),finishReason:'length'};}});
assert.equal(calls,2);assert.equal(failed.wrote,false);assert.equal(failed.pending,true);assert.deepEqual(await db.settings.get('essentials:'+sid),prior);assert.equal((await loadEssentials(sid)).upTo,3);
assert.equal(inspectEssentials('[Dawn, chapel] '+ 'Text '.repeat(50)+'because').complete,false);
const notRepeated=await runEssentials({connection:conn,storyId:sid,nodes,callLLM:async()=>{throw Error('unchanged failed source must not spend again');}});assert.equal(notRepeated.usage.calls,0);assert(notRepeated.pending);
const forced=await runEssentials({connection:conn,storyId:sid,nodes,force:true,callLLM:async()=>({text:'[Dawn, chapel] The writer correction now stands. Mara kept the conditional promise because her brother was released.',finishReason:'stop'})});assert(forced.wrote);assert.equal(forced.usage.calls,1,'manual regeneration must perform a new source reading');
const ownedStory=await db.stories.create({title:'Ownership'});await db.settings.set('memory:'+ownedStory.id,{nodes:[nodes[0]]});
const briefChanged=await runEssentials({connection:conn,storyId:ownedStory.id,nodes:[nodes[0]],callLLM:async()=>{await db.stories.update(ownedStory.id,{brief:'NEW_MANUAL_PREMISE'});return {text:'[Dawn, chapel] A complete source account that must not overwrite the writer’s changed premise during this reading.',finishReason:'stop'};}});assert(!briefChanged.wrote);assert.equal(await db.settings.get('essentials:'+ownedStory.id),undefined);
const huge=await runEssentials({connection:{...conn,contextSize:12000},storyId:'huge',nodes:[{id:'huge',span:[0,0],text:'x'.repeat(100000)}],callLLM:async()=>{throw Error('must not ask');}});assert(huge.why.includes('individual source'));
const divided=Array.from({length:12},(_,i)=>({id:'d'+i,span:[i,i],text:'[Dawn, chapel] '+('Original event '+i+'. ').repeat(700)}));
const combined=await runEssentials({connection:{...conn,contextSize:20000,maxTokens:5000},storyId:'divided',nodes:divided,callLLM:async(_c,ask)=>({text:'[Dawn, chapel] Complete source part: Neri kept the promise because Mara kept her brother safe. '+ 'A lasting consequence. '.repeat(15),finishReason:'stop'})});
assert(combined.wrote);const keptDivided=await db.settings.get('essentials:divided');assert(keptDivided.text.length<=16000);assert.equal(keptDivided.parts.reduce((s,p)=>s+p.share,0)+keptDivided.parts.length-1<=16000,true);
const unchanged=await runEssentials({connection:conn,storyId:'divided',nodes:divided,callLLM:async()=>{throw Error('unchanged source must reuse');}});assert.equal(unchanged.why,'unchanged');
await db.settings.set('memory:late',{nodes:[nodes[0]]});
const manual={text:'MANUAL_CORRECTION_KEEP',upTo:3,print:'manual'};
const late=await runEssentials({connection:conn,storyId:'late',nodes:[nodes[0]],callLLM:async()=>{await db.settings.set('essentials:late',manual);return {text:'[Dawn, chapel] Complete source part: Mara kept her promise because Neri returned her brother safely to the chapel.',finishReason:'stop'};}});assert(!late.wrote);assert.deepEqual(await db.settings.get('essentials:late'),manual);
await db.settings.set('memory:rewind',{nodes:[nodes[0]]});
const rewind=await runEssentials({connection:conn,storyId:'rewind',nodes:[nodes[0]],callLLM:async()=>{await db.settings.set('memory:rewind',{nodes:[]});return {text:'[Dawn, chapel] Complete source part: Mara kept her promise because Neri returned her brother safely to the chapel.',finishReason:'stop'};}});assert(!rewind.wrote);
assert(!essentialsMatch(essentials,[{...summaryNodes[0],detail:'Changed selected source'},...summaryNodes.slice(1)]));
assert(!essentialsMatch(essentials,summaryNodes,20));
assert(!essentialsMatch(essentials,[...summaryNodes,{id:'correction',span:[-1,-1],correction:true,text:'The writer withdraws the old promise.'}]));

// Perspectives expected independently: private Mara, observation Ivo, mistaken Sera, late arrival has no evidence.
const kp={Mara:[{fact:'The key is hidden in the chapel',atTurn:10},{fact:'heard a rumor that the wine is poisoned',atTurn:11}],Ivo:[{fact:'saw Mara enter the chapel',atTurn:10}],Sera:[{fact:'believes the key is in the vault, untrue: the key is hidden in the chapel',atTurn:10}],Late:[]};
const knowledge=renderKnowledge(kp,state.present,undefined,{turn:12,wasThere:()=>true,mc:'Neri'});
assert(!knowledge.includes('Everyone here knows'));
assert(!knowledge.includes('Late knows'));
assert(knowledge.includes('Mara knows: The key is hidden'));
assert(knowledge.includes('rumor'));assert(knowledge.includes('Sera perspective: believes'));
const missing=renderBlindSpots(blindSpots(kp,state.present,{turn:12,scenePages:['the key is hidden in the chapel'],mc:'Neri',wasThere:()=>true}));
assert(missing.includes('Late, learning is not established')||missing.includes('Late, '));assert(!missing.includes('hasn’t found out'));
const about={Mara:[{fact:'The secret concerns Ivo and the chapel key',atTurn:11}],Ivo:[]};assert(blindSpots(about,[{name:'Ivo'}],{turn:12,scenePages:['chapel secret key']}).some(s=>s.name==='Ivo'));
assert(!sameFact('Ivo knows the wine is poisoned','Ivo suspects the wine is poisoned',{fuzzy:true}));
assert(!sameFact('Mara promised to help','Mara promised to help only after her brother was released',{fuzzy:true}));
assert(!sameFact('the key is hidden','the key is not hidden',{fuzzy:true}));
const distinctions=dedupeKnowledge({Ivo:[{fact:'Mara promised to help',atTurn:10},{fact:'Mara promised to help only after her brother was released',atTurn:11}]});assert.equal(distinctions.Ivo.length,2);
const corrected=addKnowledge(kp,'Sera','learned the key is hidden in the chapel',12);assert.equal(corrected.Sera.some(k=>k.fact.startsWith('believes')),false);assert.deepEqual(corrected.Mara,kp.Mara);
const witnessed=settleWitnesses({...state,present:[{name:'Mara'},{name:'Ivo'}]},[{type:'knowledge.add',fact:'saw the banner rise',room:true,decided:true},{type:'presence.enter',name:'Late'}],['Mara','Ivo','Late']);assert.deepEqual(witnessed.filter(m=>m.type==='knowledge.add').map(m=>m.name),['Mara','Ivo']);
const legacy=[{type:'knowledge.add',name:'Mara',fact:'saw the banner rise'}];assert.deepEqual(broadcastPublicMoments(state,legacy),legacy);
const complementary=renderKnowledge(kp,[{name:'Mara'},{name:'Ivo'},{name:'Sera'}],undefined,{turn:12,selectedTexts:['Mara knows: The key is hidden in the chapel.','Ivo knows: saw Mara enter the chapel.']});assert(!complementary.includes('Mara knows: The key is hidden'));assert(complementary.includes('believes'));assert(complementary.includes('rumor'));
const suspicion=addKnowledge(kp,'Sera','the key is hidden in the chapel',12,{kind:'suspicion'});assert(suspicion.Sera.some(k=>k.fact.startsWith('believes')),'suspected truth cannot erase belief');
const starting={...state,knowledge:{Mara:[{fact:'Mara promised to help only after her brother was released',atTurn:10}]}};
const refusedForget=applyMutations(starting,[{type:'knowledge.forget',name:'Mara',fact:'Mara promised to help'}]);assert.equal(refusedForget.state.knowledge.Mara.length,1,'shorter allegation cannot delete a conditional fact');
const changed=applyMutations(starting,[{type:'knowledge.add',name:'Mara',fact:'The copper key opens the chest',kind:'known',pathway:'Neri told Mara',source:{quote:'Neri told Mara about the copper key.',recipients:['Mara']}}]);assert(changed.applied.length);assert.deepEqual(undoLast(changed.state).state.knowledge,starting.knowledge);
const bound={...nodes[0],sourcePages:sourceBindings(history.slice(0,4))};assert(boundRecord(bound,history));const edited=structuredClone(history);edited[1].text='EDITED_SOURCE';assert(!boundRecord(bound,edited));
const staleRecord=buildRequest({...base,messages:edited,window:{...base.window,nodes:[bound,...nodes.slice(1)]}});assert(staleRecord.selection.records.find(r=>r.id===bound.id).available===false);assert(!staleRecord.selection.essentials,'old essentials cannot ride across a changed source binding');
const signature=nodeSignature(bound);assert(!nodeUnmoved([{...bound,detail:'MANUAL_DETAIL_CHANGE'}],bound.id,signature));
const liveCancel=new AbortController();const cancelStart=performance.now();const cancelWork=pickRecall({connection:conn,nodes,signal:liveCancel.signal,callLLM:async()=>new Promise(()=>{})});setTimeout(()=>liveCancel.abort(),20);assert.equal((await cancelWork).why,'cancelled');assert(performance.now()-cancelStart<300);
const explicitPublic=renderKnowledge({Mara:[{fact:'The banner rose',atTurn:12}],Ivo:[{fact:'The banner rose',atTurn:12}],Sera:[{fact:'The banner rose',atTurn:12}]},[{name:'Mara'},{name:'Ivo'},{name:'Sera'}],undefined,{turn:12});assert(explicitPublic.includes('Everyone here knows'));

const metrics=[];
for(const contextSize of [200000,500000]) {
  const c={...conn,contextSize};const t=performance.now();
  const r=buildRequest({...base,window:{...base.window,budgetTokens:contextSize},transportMeasure:req=>measureTransport(c,req)});
  const body=buildOpenAIRequest(c,r);assert.equal(r.receipt.context.inputTokens,bodyAccounting(body).inputTokens);assert(bodyAccounting(body).inputTokens<=inputRoom({budgetTokens:contextSize,answerTokens:bodyAccounting(body).answerTokens}));
  assert(r.messages.some(m=>m.content===history.at(-1).text));assert(r.messages.some(m=>m.content===history.at(-2).text));
  metrics.push({context:contextSize,inputEstimate:r.receipt.context.inputTokens,assemblyMs:Math.round((performance.now()-t)*100)/100});
}
const thinking={...conn,maxTokens:1000,reasoning:{effort:'low'},prefill:'Started reply. '};
assert.equal(measureTransport(thinking,revised).answerTokens,16000);
const claude={...conn,type:'anthropic',model:'claude-fixture',maxTokens:1000,reasoning:{effort:'high',budgetTokens:24000},prefill:'The chapel '};
const ac=measureTransport(claude,revised);assert.equal(ac.answerTokens,buildAnthropicRequest(claude,revised).max_tokens);assert(ac.answerTokens>1000);
const constrainedMessages=Array.from({length:14},(_,i)=>({id:'long'+i,role:i%2?'assistant':'user',text:'UNFOLDED_'+i+' '+('Original long dialogue. ').repeat(600)}));constrainedMessages.push({id:'lastA',role:'assistant',text:'LATEST_EXCHANGE_KEEP'},{id:'lastU',role:'user',text:'CURRENT_MOVE_KEEP'});
const constrainedConn={...conn,contextSize:22000,maxTokens:6000};
const constrained=buildRequest({...base,settings:{...settings,notesRole:'user'},messages:constrainedMessages,memory:'',smallEssentials:null,window:{keeperOn:true,window:30,nodes:[],budgetTokens:22000,answerTokens:6000},transportMeasure:req=>measureTransport(constrainedConn,req)});
assert(textOf(constrained).includes('LATEST_EXCHANGE_KEEP'));assert(textOf(constrained).includes('CURRENT_MOVE_KEEP'));assert(constrained.selection.gaps.length>0);assert(constrained.receipt.context.inputTokens<=constrained.receipt.context.inputRoom);
for(const m of constrained.selection.messages) assert.equal(m.selected,constrained.messages.some(x=>x.id===m.id));
assert.throws(()=>buildRequest({...base,settings:{...settings,frameText:'MANUAL '.repeat(20000)},window:{...base.window,budgetTokens:12000}}),/standing instructions exceed/);
assert(buildRequest({...base,settings:{...settings,frameText:'MANUAL '.repeat(20000)},window:{...base.window,budgetTokens:12000},measureOnly:true}).receipt.context.inputTokens>12000,'probe does not prematurely validate');
const smallPlan={people:[],unknown:[],pressing:[],earlier:[],laws:[],sounds:[],story:'The chapel story.',scene:'An unresolved meeting.',intense:false};
const small=buildRequest({...base,settings:{...settings,smallModelNow:true},smallPlan});assert(textOf(small).includes('BEYOND_OPENING_SIGNAL'));assert.equal(textOf(small).split('BEYOND_OPENING_SIGNAL').length-1,1);assert(textOf(small).includes('only after her brother was released'));
const keeperOff=buildRequest({...base,window:{...base.window,keeperOn:false}});assert(textOf(keeperOff).includes('CURRENT_MOVE_KEEP')||textOf(keeperOff).includes(history.at(-1).text));
const swipeHistory=structuredClone(history);swipeHistory[5]={...swipeHistory[5],swipes:[{text:'OLD_SWIPE_PRIVATE'},{text:'Mara spoke of the copper key at the chapel chest. NEW_SWIPE_PRIVATE.'}],swipeIdx:1};
const swiped=buildRequest({...base,messages:swipeHistory,pageFilter:t=>t.replace('NEW_SWIPE_PRIVATE','AUTHORIZED_WIRE_VIEW')});assert(!textOf(swiped).includes('OLD_SWIPE_PRIVATE'));assert(!textOf(swiped).includes('NEW_SWIPE_PRIVATE'));assert(textOf(swiped).includes('AUTHORIZED_WIRE_VIEW'));assert(swiped.selection.revision!==revised.selection.revision);
const branch=buildRequest({...base,messages:history.slice(0,9),window:{...base.window,nodes:[],recordThrough:0},memory:'',smallEssentials:essentials,smallPlansBook:{plans:[]},state:emptyState()});assert(!textOf(branch).includes('BEYOND_OPENING_SIGNAL'));assert(!branch.selection.essentials);
assert.equal(revised.systemBlocks[1].text,buildRequest({...base,messages:[...history.slice(0,-1),{...history.at(-1),text:'Another move.'}]}).systemBlocks[1].text);
assert.equal(revised.systemBlocks[0].text,buildRequest({...base,messages:[...history.slice(0,-1),{...history.at(-1),text:'Another move.'}]}).systemBlocks[0].text);
const image=buildOpenAIRequest(conn,{systemBlocks:[],messages:[{role:'user',content:'A photo.',image:{dataUrl:'data:image/png;base64,'+'A'.repeat(100000)}}]});assert(bodyAccounting(image).imagesUncertain);assert(bodyAccounting(image).inputTokens<10000);
// Actual transport construction, one successful streaming call for each representative adapter.
const originalFetch=globalThis.fetch;const sent=[];
globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);sent.push(body);const events=body.system?[{type:'content_block_delta',delta:{type:'text_delta',text:'A complete mocked page.'}},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{input_tokens:77,output_tokens:9}}]:[{choices:[{delta:{content:'A complete mocked page.'}}]},{choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:88,completion_tokens:10}}];return new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join('')+'data: [DONE]\n\n');};
try {
 const o=await createOpenAIProvider(thinking).streamChat(revised);assert.equal(sent.length,1);assert.equal(o.usage.prompt_tokens,88);assert.deepEqual(o.sent.body.messages,buildOpenAIRequest(thinking,revised).messages);assert.equal(o.sent.body.max_tokens,16000);
 const a=await createAnthropicProvider(claude).streamChat(revised);assert.equal(sent.length,2);assert.equal(a.usage.input_tokens,77);assert.deepEqual(a.sent.body,buildAnthropicRequest(claude,revised));
 await keepSent({id:'receipt',storyId:'fixture',slots:revised.receipt.slots,requests:[o.sent],selection:revised.selection});const kept=await loadSent('receipt');assert.deepEqual(kept.selection,revised.selection);assert.deepEqual(kept.requests[0].body,o.sent.body);
} finally {globalThis.fetch=originalFetch;}
assert.deepEqual({state,nodes,history,settings,plans},originals);
console.log(JSON.stringify({result:'pass',metrics,summaryFailure:{calls:failed.usage.calls,inputChars:failed.usage.inputChars,outputChars:failed.usage.outputChars},divided:{parts:combined.parts,calls:combined.usage.calls,chars:keptDivided.text.length},transportCalls:sent.length,liveProviderCalls:0,selectedRecords:revised.selection.records.filter(r=>r.selected).map(r=>r.id),selectedPlans:revised.selection.plans.filter(p=>p.selected).map(p=>p.id),gaps:constrained.selection.gaps}));
