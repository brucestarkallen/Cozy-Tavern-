import './idb-shim.mjs';
import assert from 'node:assert/strict';
import { db } from '../../js/store.js';
import { emptyState, loadState, saveState } from '../../js/engine/state.js';
import { findPersonKey } from '../../js/engine/people.js';
import { samePersonName } from '../../js/engine/names.js';
import { applyMutations, duplicatePages } from '../../js/engine/apply.js';
import { sourcePersonKey } from '../../js/agents/auditsources.js';
import { auditLedger, auditorRepairScope } from '../../js/agents/auditor.js';
const princess = 'Alexia', attendant = "Alexia's woman";
assert(!samePersonName(princess, attendant));
assert.equal(findPersonKey({[attendant]: {core:'attendant'}}, princess),'');
assert.equal(findPersonKey({[princess]: {core:'princess'}}, attendant),'');
assert.equal(findPersonKey({[attendant]: {core:'attendant', aliases:[princess]}}, princess),'');
assert.equal(findPersonKey({'Alexia Valois':{}}, princess),'Alexia Valois');
let original = applyMutations({...emptyState(),page:0}, [
 {type:'people.set',name:princess,field:'core',text:'Princess of Ilvarren.'},
 {type:'people.set',name:attendant,field:'core',text:"The princess's attendant."},
 {type:'rel.set',name:princess,p:60,r:50,s:0,cause:'starting bond'},
 {type:'people.set',name:'Corven',field:'state',text:'unrelated manual record',byHand:true},
]).state;
assert.deepEqual(duplicatePages(original),[]);
assert.equal(applyMutations(original,[{type:'people.rename',from:princess,to:attendant}]).applied.length,0);
// Recreate the OLD automatic merge through the explicit rename escape hatch.
let mixed = applyMutations(original,[{type:'people.rename',from:princess,to:attendant,byHand:true}]).state;
const mergeId=mixed.journal.at(-1).id;
delete mixed.journal.at(-1).m.byHand;
mixed.log.at(-1).source='extractor';
mixed = applyMutations(mixed,[{type:'people.set',name:attendant,field:'state',text:'two seats behind the princess',byHand:true}]).state;
const {id}=await db.stories.create({title:'Actual ledger failure fixture'});
await saveState(id,mixed);
const recovered=await loadState(id);
assert.equal(recovered.characters[princess].core,'Princess of Ilvarren.');
assert.equal(recovered.characters[attendant].state,'two seats behind the princess');
assert.equal(recovered.characters.Corven.state,'unrelated manual record');
assert.equal(recovered.relationships[princess].p,60);
assert(recovered.identityRecoveries[mergeId].mixed.characters[attendant]);
assert.equal(sourcePersonKey(recovered,princess,attendant),princess);
assert.equal((await loadState(id)).journal.length,recovered.journal.length);
// The retained journal can recover it even when the short undo log rolled off.
const oldId=(await db.stories.create({title:'Rolled off log'})).id;
await saveState(oldId,{...mixed,log:mixed.log.filter(e=>e.jid!==mergeId)});
assert.equal((await loadState(oldId)).characters[princess].core,'Princess of Ilvarren.');
console.log('PASS separate owner/dependent lookup, blocked automatic merge, recovery with and without undo receipt, manual records and starting scores preserved.');

const earlier='He gave ground across the raked ground.';
const ending='His shoulder blade found the cold stone of the salle wall.';
const woman='Her woman settled two seats behind Alexia.';
const page='[the palace salle | 06:12]\n'+earlier+'\n'+ending+'\n'+woman;
await db.messages.append(id,{role:'user',text:'I give ground.',ts:1});
await db.messages.append(id,{role:'assistant',text:page,ts:2});
await saveState(id,{...recovered,sheet:{...recovered.sheet,playerName:'Azrael'},present:[{name:'Azrael',position:'at the wall'}],audit:{coverage:{read:2,total:2},retryProgress:{source:'retained',stalled:1},pending:['Azrael is not at the wall'],unresolved:[{what:'Azrael is not at the wall',fix:'move him back',mutations:[],pendingReason:'no repair was supplied'}]}});
const originalFetch=globalThis.fetch;
let verified=false;
globalThis.fetch=async (_,options)=>{
 const body=JSON.parse(options.body);
 const content=body.messages.map(m=>String(m.content)).join('\n');
 let answer;
 if(content.includes('Find every place the writer STATES')) answer={standings:[]};
 else if(content.includes('PROVISIONAL SCENE CHANGES TO VERIFY BEFORE SAVING')) {
   verified=true;
   assert(content.includes(ending));
   answer={issues:[{what:'The provisional position missed the later wall contact',fix:'at the wall',mutations:[{type:'presence.update',name:'Azrael',position:'at the wall',shown:ending}]},{what:'Her woman is here',fix:'enter her',mutations:[{type:'presence.enter',name:attendant,position:'two seats behind Alexia',shown:woman}]}],resolved:[{what:'Azrael is not at the wall',shown:ending,why:'The later movement reached the wall.'}]};
 } else answer={issues:[{what:'Azrael should be giving ground',fix:'on the ground',mutations:[{type:'presence.update',name:'Azrael',position:'giving ground, not yet at the wall',shown:earlier}]}]};
 const text=JSON.stringify(answer);
 return new Response(body.stream ? 'data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n' : JSON.stringify({choices:[{message:{content:text},finish_reason:'stop'}]}),{headers:{'Content-Type':body.stream?'text/event-stream':'application/json'}});
};
try {
 const result=await auditLedger({storyId:id,connection:{type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'m',preset:'custom',context:64000}});
 assert(verified);
 const final=await loadState(id);
 assert.equal(final.present.find(p=>p.name==='Azrael').position,'at the wall');
 assert(final.present.some(p=>p.name===attendant));
 assert(final.characters[princess]);
 assert(!result.pending.some(p=>p.startsWith('Azrael is not at the wall')));
 assert.equal(final.audit.retryProgress.source,'retained');
 assert.equal((await db.messages.list(id)).at(-1).text,page);
 console.log('PASS production audit verifies provisional movement, enters the attendant separately, closes the disproved legacy finding and preserves prose and retry metadata.');
} finally {globalThis.fetch=originalFetch;}

const personaQuote = "Jugram is Azrael's own persona.";
const personaState = {...emptyState(),sheet:{actors:{},playerName:'Azrael'}};
assert.equal(auditorRepairScope([{what:'false separate seat',mutations:[{type:'offscreen.clear',name:'Jugram',shown:personaQuote}]}],personaState,{sources:personaQuote,identitySources:personaQuote,sceneSource:'Azrael reached the wall.'})[0].mutations.length,1);
console.log('PASS explicit MC persona evidence remains usable when its identity quote is in the brief.');
