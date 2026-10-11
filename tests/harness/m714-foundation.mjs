import './idb-shim.mjs';
import assert from 'node:assert/strict';
import { buildRequest } from '../../js/assemble/stack.js';
import { CRAFT_TEXT } from '../../js/assemble/craft.js';
import { requestTokens, inputRoom } from '../../js/assemble/budget.js';
import { finalizeReceipt } from '../../js/assemble/receipt.js';
import { emptyState } from '../../js/engine/state.js';
import { buildWorldMessages } from '../../js/agents/world.js';
import { auditSources, reviewAuditSources } from '../../js/agents/auditsources.js';
import { workerProfileSources } from '../../js/agents/ledgercontext.js';
import { noteWork, pendingWork } from '../../js/agents/extractor.js';
import { ledgerVerificationRows, saveAuditCheckpoint, reusableAuditCheckpoint } from '../../js/agents/auditprogress.js';

// One local causal check. No real provider, app walk, gameplay or unrelated suite.
const state = { ...emptyState(), sheet:{playerName:'Neri',actors:{}}, page:100,
  place:{name:'the yard'}, present:[{name:'Neri'},{name:'Rook'}],
  characters:{Neri:{core:'A cartographer.'}, Rook:{core:'An instructor.',threads:['Keep the old sealed promise OLD_PROMISE_SIGNAL','Buy tea','Mend coat','Sharpen blade','Sweep yard','Pay rent']},Elin:{core:'Queen of the northern realm.'}},
  canon:{Elin:{facts:[{key:'hair',value:'DISTINCT_VIOLET_SIGNAL'}]}},
  knowledge:{Neri:[{fact:'The sealed promise opens the northern gate OLD_KNOWLEDGE_SIGNAL',atTurn:1},...Array.from({length:6},(_,i)=>({fact:'Recent daily news '+i,atTurn:90+i}))]},
  offscreen:{Elin:{location:'the tower',activity:'reading',stance:'busy'}} };
for(let i=0;i<100;i++) state.characters['Citizen '+i]={core:'A resident.',threads:[]};
state.things={'sealed relic':{where:'the vault',owner:'Elin',note:'OLD_THING_SIGNAL',atTurn:1}};
const before = structuredClone(state);
const move='I go to meet Elin about the sealed promise at the northern gate and the sealed relic.';
const messages=Array.from({length:30},(_,i)=>({id:'m'+i,role:i%2?'assistant':'user',text:i%2?'An ordinary page. '.repeat(4000):'Walk onward.',ts:i}));
messages.push({id:'latest',role:'user',text:move,ts:31});
const settings={refereeOn:false,ownWords:[{name:'Closing rule',role:'house',place:'after-your-message',text:'KEEP_THIS_CLOSING_RULE '.repeat(400)}]};
const base={story:{brief:'Preserve the writer’s stated world.'},messages,state,settings,modules:[{mod:{id:'core-craft',text:CRAFT_TEXT}}]};
const budgets=[];
for(const keeperOn of [true,false]) {
  const window={keeperOn,window:30,budgetTokens:200000,answerTokens:16000};
  const result=buildRequest({...base,window});
  const text=result.systemBlocks.map(b=>b.text).join('\n')+'\n'+result.messages.map(m=>m.content).join('\n');
  for(const fact of ['DISTINCT_VIOLET_SIGNAL','OLD_PROMISE_SIGNAL','OLD_KNOWLEDGE_SIGNAL','OLD_THING_SIGNAL','KEEP_THIS_CLOSING_RULE']) assert(text.includes(fact),fact+' reaches the actual storyteller request');
  assert(result.messages.some(m=>m.content===move));
  assert(result.messages.some(m=>m.content===messages.at(-2).text));
  assert(requestTokens(result.systemBlocks,result.messages)<=inputRoom(window));
  assert.equal(finalizeReceipt(result.receipt,{}).context.inputTokens,requestTokens(result.systemBlocks,result.messages));
  budgets.push(result.receipt.context.inputTokens);
}
assert.deepEqual(state,before,'Rendering never edits stored records or earned judgments.');
assert.throws(()=>buildRequest({...base,window:{budgetTokens:12000,answerTokens:6000}}),/standing instructions exceed/);
const world=buildWorldMessages({state,userText:move,assistantText:'Rook stays in the yard.'});
const worldText=world.messages?.map(m=>m.content).join('\n') || world.user;
assert.equal(worldText.split('OLD_KNOWLEDGE_SIGNAL').length-1,1,'World reads one knowledge copy.');
const quote='Queen Elin has violet hair and is the sovereign of the northern realm.';
const originals=[{id:'source',role:'user',text:quote+' Quiet roads.'.repeat(5500)}];
const documents=auditSources({messages:originals});
const conn={type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'fixture',preset:'custom',contextSize:200000,reasoning:{effort:'off'}};
let calls=0,packed=0,truncate=false;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(_,options)=>{
  calls++;
  const body=JSON.parse(options.body);
  const user=body.messages.findLast(m=>String(m.content).includes('SOURCE DOCUMENTS\n')).content;
  const batch=JSON.parse(user.split('SOURCE DOCUMENTS\n')[1]);packed=Math.max(packed,batch.length);
  const people=batch.filter(d=>d.text.includes(quote)).map(d=>({name:'Elin',source:d.id,shown:quote,identityFacts:[{text:'Sovereign of the northern realm.',shown:quote}],facts:[{key:'hair',value:'violet',shown:quote}]}));
  const finish=truncate&&batch.length>1?'length':'stop';truncate=false;
  const content=JSON.stringify({checked:batch.map(d=>d.id),people});
  return new Response(body.stream?'data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:finish}]})+'\n\ndata: [DONE]\n\n':JSON.stringify({choices:[{message:{content},finish_reason:finish}]}));
};
try {
  const reviewed=await reviewAuditSources({connection:conn,documents,mode:'all',state});
  assert.equal(reviewed.read,documents.length);assert.equal(calls,1);assert(packed>2);
  const reused=await reviewAuditSources({connection:conn,documents,previous:reviewed.cache,mode:'all',state});
  assert.equal(reused.calls,0);assert.equal(calls,1);
  truncate=true;
  const retried=await reviewAuditSources({connection:conn,documents,mode:'all',state});
  assert.equal(retried.read,documents.length);assert.equal(retried.pending.length,0);
  const recovered={...state,auditSources:reviewed.cache,canon:{Elin:{facts:[{key:'hair',value:'violet'}]}},characters:{...state.characters,Elin:{core:'Sovereign of the northern realm.'}}};
  assert.equal(workerProfileSources(recovered,documents),'','Already held original profile facts consume no repeated worker context.');
  const row=ledgerVerificationRows(recovered).find(r=>r.id==='canon:Elin');
  const verification={read:1,total:1,entries:{[row.id]:{print:row.print,scope:row.scope,status:'correct',shown:quote}},profiles:{}};
  const checkpoint=saveAuditCheckpoint(recovered,{},documents,verification);
  const later={...recovered,clock:{minutes:500},audit:{checkpoint}};
  assert(reusableAuditCheckpoint(later,{},documents).entries[row.id]);
  assert(!reusableAuditCheckpoint({...later,canon:{Elin:{facts:[{key:'hair',value:'red'}]}}},{},documents).entries[row.id]);
} finally {globalThis.fetch=originalFetch;}
const start=Date.now();
const first=new Promise(resolve=>setTimeout(resolve,40));
const second=first.then(()=>new Promise(resolve=>setTimeout(resolve,80)));
noteWork('deadline',first);noteWork('deadline',second);
assert.equal(await pendingWork('deadline',75),false);
assert(Date.now()-start<110,'The wait has one deadline, not a reset per worker.');
await second;
console.log(JSON.stringify({result:'pass',estimatedInputs:budgets,sourceChunks:documents.length,packedChunks:packed,realProviderCalls:0}));
