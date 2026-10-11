import './idb-shim.mjs';
import assert from 'node:assert/strict';
import {db} from '../../js/store.js';
import {emptyState,saveState,loadState} from '../../js/engine/state.js';
import {auditLedger,auditFindingId,parseAuditorAnswer,bindAuditEvidence} from '../../js/agents/auditor.js';
import {ledgerAuditVerified} from '../../js/agents/auditprogress.js';

const parsed=parseAuditorAnswer(JSON.stringify({issues:[],resolved:[{id:'f',status:'repair',evidenceId:'s',why:'Still wrong; repair it.',mutations:[{type:'people.set',name:'Tarin',field:'core',text:'Shipwright.'}]}]}));
assert.equal(parsed.resolved.length,0);assert.equal(parsed.issues.length,1);
const bound=bindAuditEvidence(parsed,[{evidenceId:'s',text:'Tarin is the shipwright.'}]);
assert.equal(bound.issues[0].mutations[0].shown,'Tarin is the shipwright.');
assert.equal(bindAuditEvidence(parsed,[]).issues[0].mutations[0].shown,'');
assert(bindAuditEvidence(parsed,[]).issues[0].mutations[0].evidenceError);
const {id}=await db.stories.create({title:'M697 generic source reference repair'});
const prose='Neri crossed the quay and stopped at the iron gate. Mara Vale waited beside the pier, wearing her oilskin coat.';
const voice='Mara Vale, our courier, delivered the sealed packet yesterday. Dev, another courier, is working at the north post.';
await db.messages.append(id,{role:'user',text:'I follow the packet.',ts:1});
await db.messages.append(id,{role:'assistant',text:prose,voices:[{speaker:'Tarin',content:voice}],ts:2});
const complaint={what:'Mara is missing from the pier.',fix:'Keep her beside the pier in her coat.',mutations:[{type:'presence.update',name:'Mara Vale',attire:'oilskin coat',shown:'An invented summary quotation never written in the story.'}]};
const initial={...emptyState(),sheet:{actors:{},playerName:'Neri'},place:{name:'the quay'},
 characters:{'Mara Vale':{core:'Courier of the harbor; careful with seals.'},'the courier':{core:'Courier of the harbor.'},Dev:{core:'Courier of the north post.'}},
 present:[{name:'Neri',position:'crossing the quay'},{name:'Mara Vale',position:'beside the pier',attire:''}],
 offscreen:{'the courier':{location:'the counting house',activity:'waiting'},Dev:{location:'north post',activity:'working'}},
 relationships:{'Mara Vale':{P:60,R:50}},audit:{coverage:{read:3,total:3},pending:[complaint.what],unresolved:[complaint]}};
await saveState(id,initial);
const pages=await db.messages.list(id),before=await loadState(id);
const mergeFinding='finding:generic_courier';
const oldFetch=globalThis.fetch;let dispute=false,calls=0;
globalThis.fetch=async(_,opts)=>{
 const body=JSON.parse(opts.body),content=body.messages.map(m=>String(m.content)).join('\n');
 let reply;
 if(content.includes('Find every place the writer STATES'))reply={standings:[]};
 else {
  calls++;
  const marker='ORIGINAL SOURCE PASSAGES FOR THESE TARGETS, labelled by original page and in source order. Earlier facts may be superseded:\n';
  const follow=content.includes('REPAIR FOLLOWUP');
  const bank=JSON.parse(content.split(follow?'ORIGINAL SOURCE PASSAGES FOR REPAIR TARGETS, not summary quotes:\n':marker)[1].split('\n')[0]);
  const local=bank.find(p=>p.text.includes('Neri crossed'));
  const remote=bank.find(p=>p.text.includes('Mara Vale, our courier'));
  assert(local?.evidenceId);assert(remote?.evidenceId);
  if(follow)reply={issues:[],repairs:[{id:auditFindingId(complaint),status:'correct',evidenceId:local.evidenceId,why:'Her saved coat now agrees with the story.'},
    ...(dispute?[{id:mergeFinding,status:'open',why:'Treat this identity merge as disputed in this fixture.'}]:[])]};
  else reply={repairs:[{id:auditFindingId(complaint),status:'repair',evidenceId:local.evidenceId,why:'Add the coat already established in the story.',mutations:[{type:'presence.update',name:'Mara Vale',attire:'oilskin coat'}]}],
   issues:[{what:'The ending puts Neri at the iron gate.',evidenceId:local.evidenceId,mutations:[{type:'presence.update',name:'Neri',position:'at the iron gate'}]},
    {what:'The courier is Mara Vale.',findingId:mergeFinding,evidenceId:remote.evidenceId,mutations:[{type:'people.rename',from:'the courier',to:'Mara Vale'}]}]};
 }
 const text=JSON.stringify(reply);
 return new Response(body.stream?'data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n':JSON.stringify({choices:[{message:{content:text},finish_reason:'stop'}]}));
};
const connection={type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'m',preset:'custom',context:64000};
try{
 const result=await auditLedger({storyId:id,connection});
 const final=await loadState(id);
 assert.deepEqual(result.pending,[]);assert.equal(final.characters['the courier'],undefined);
 assert.equal(final.offscreen['the courier'],undefined);
 assert.equal(final.present.find(p=>p.name==='Neri').position,'at the iron gate');
 assert.equal(final.present.find(p=>p.name==='Mara Vale').attire,'oilskin coat');
 assert.deepEqual(final.relationships,before.relationships);assert.deepEqual(await db.messages.list(id),pages);
 assert(ledgerAuditVerified(final,await db.stories.get(id),pages));assert.equal(calls,2);
 // A disputed provisional merge must be withheld, not committed then labelled open.
 await saveState(id,initial);dispute=true;
 const refused=await auditLedger({storyId:id,connection});
 const kept=await loadState(id);
 assert(refused.pending.length);assert(kept.characters['the courier']);assert(kept.characters['Mara Vale']);
 assert(!ledgerAuditVerified(kept,await db.stories.get(id),pages));
 console.log('PASS generic named source references, verbatim app binding, rejected unknown references, repair rows not false withdrawals, verified role merge, disputed merge withheld, scene/coat repaired and prose/scores preserved. Mock model only.');
}finally{globalThis.fetch=oldFetch;}
