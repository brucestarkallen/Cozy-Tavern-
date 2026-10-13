import './idb-shim.mjs';
import assert from 'node:assert/strict';
import {db} from '../../js/store.js';
import {emptyState,saveState,loadState} from '../../js/engine/state.js';
import {auditLedger,bindAuditEvidence,bindFinalAuditEvidence} from '../../js/agents/auditor.js';
import {auditSources,parseSourceReview} from '../../js/agents/auditsources.js';
import {sourceAppearanceFacts} from '../../js/agents/appearanceinventory.js';
import {ledgerAuditVerified} from '../../js/agents/auditprogress.js';
import {applyMutations} from '../../js/engine/apply.js';
import {serveFetch} from '../../js/agents/housekeeper.js';

const {id}=await db.stories.create({title:'Profile evidence and unnamed roles'});
const cast="Neri is a lone traveler with grey eyes. Valen is Neri's gold-haired public face, while Neri's own hair is dark. Elin is queen of the north, calculating and blunt, with purple hair.";
// The story holds what its audit is handed, as every caller hands it (chat.js: story.brief, story.castNotes; create keeps
// a title only). M752: the audit's receipts name the brief and cast notes it READ.
await db.stories.update(id,{castNotes:cast});
const older='The third princess has red hair and a cruel disposition.';
const prose='Neri waited alone at the gate. Elin remained in her northern chambers.';
await db.messages.append(id,{role:'user',text:older,ts:1});
await db.messages.append(id,{role:'assistant',text:prose,ts:2});
const story=await db.stories.get(id),pages=await db.messages.list(id),documents=auditSources({castNotes:cast,messages:pages});
const castDoc=documents.find(d=>d.id.startsWith('cast:')),writerDoc=documents.find(d=>d.label.endsWith(', writer'));
const people=[
  {name:'Neri',source:castDoc.id,shown:'Neri is a lone traveler with grey eyes.',identityFacts:[{text:'lone traveler',shown:'Neri is a lone traveler with grey eyes.'}],facts:[
    {key:'eyes',value:'grey',shown:'Neri is a lone traveler with grey eyes.'},
    {key:'hair',value:'gold',shown:"Valen is Neri's gold-haired public face, while Neri's own hair is dark."},
    {key:'hair',value:'dark',shown:"Valen is Neri's gold-haired public face, while Neri's own hair is dark."},
  ]},
  {name:'Elin',source:castDoc.id,shown:'Elin is queen of the north, calculating and blunt, with purple hair.',identityFacts:[{text:'calculating and blunt',shown:'Elin is queen of the north, calculating and blunt, with purple hair.'}],facts:[{key:'hair',value:'purple',shown:'Elin is queen of the north, calculating and blunt, with purple hair.'}]},
  {name:'third princess',source:writerDoc.id,shown:older,identityFacts:[{text:'third princess',shown:older},{text:'cruel disposition',shown:older}],facts:[{key:'hair',value:'red',shown:older}]},
];
const parsed=parseSourceReview(JSON.stringify({checked:[castDoc.id,writerDoc.id],people}),[castDoc,writerDoc]);
assert.equal(parsed[writerDoc.id].people[0].name,'third princess','An individually established role does not need a personal name.');
let state={...emptyState(),sheet:{actors:{},playerName:'Neri',playerAliases:['Valen']},place:{name:'the gate'},present:[{name:'Neri',position:'at the gate'}],
  characters:{Neri:{core:'A lone traveler who uses two public faces; keeps a raven at his command.'},Elin:{core:'Queen of the north.'}},
  offscreen:{Elin:{location:'northern chambers',activity:'resting'}},relationships:{Elin:{p:60,r:50,s:0,history:[]}},
  // Retain completed M704 appearance reads. Only writer sources need the role/personality upgrade.
  auditSources:Object.fromEntries(documents.map(d=>[d.id,{mark:d.mark,appearanceReviewed:true,people:[]}]))};
state=applyMutations(state,[{type:'canon.lock',name:'Neri',key:'eyes',value:'grey',byHand:true}]).state;
await saveState(id,state);state=await loadState(id);
let sourceCalls=0,finalCalls=0;const oldFetch=globalThis.fetch;
globalThis.fetch=async(_,opts)=>{
  const body=JSON.parse(opts.body),content=body.messages.map(m=>String(m.content)).join('\n');let reply;
  if(content.includes('SOURCE DOCUMENTS\n')){
    sourceCalls++;const batch=JSON.parse(content.split('SOURCE DOCUMENTS\n')[1]);
    assert(batch.every(d=>d.id.startsWith('cast:')||d.label.endsWith(', writer')),'Already reviewed story sources are not reread.');
    reply={checked:batch.map(d=>d.id),people:people.filter(p=>batch.some(d=>d.id===p.source))};
  }else{
    // M708: ONE combined review records the repairs and approves the resulting ledger;
    // M709: a whole-review verdict, with the recovered source facts on each required entry.
    finalCalls++;
    const rows=JSON.parse(content.split('REQUIRED CURRENT LEDGER CHECKS:\n')[1].split('\n')[0]);
    const neri=rows.find(r=>r.id==='characters:Neri').value,elin=rows.find(r=>r.id==='characters:Elin').value;
    const dark=neri.appearanceSources.find(f=>f.value==='dark'),gold=neri.appearanceSources.find(f=>f.value==='gold');
    reply={issues:[{what:'Record both established faces without replacing the player identity.',mutations:[
      {type:'canon.lock',name:'Neri',key:'hair',value:'dark',evidenceId:dark.id},
      {type:'canon.lock',name:'Neri',key:'hair (Valen face)',value:'gold',evidenceId:gold.id},
    ]}],profiles:[
      {name:'Elin',core:{text:'Queen of the north; calculating and blunt.',evidenceId:elin.identitySources[0].id},facts:[{key:'hair',value:'purple',evidenceId:elin.appearanceSources[0].id}]},
      {name:'third princess',core:{text:'Third princess; cruel disposition.',shown:older},facts:[{key:'hair',value:'red',shown:older}]},
    ],review:{status:'complete',why:'Original facts reviewed; explicit physical facts are approved for saving.',open:[]},standings:[]};
  }
  const answer=JSON.stringify(reply);
  return new Response(body.stream?'data: '+JSON.stringify({choices:[{delta:{content:answer}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n':JSON.stringify({choices:[{message:{content:answer},finish_reason:'stop'}]}));
};
try{
  const result=await auditLedger({storyId:id,castNotes:cast,reviewSources:'all',connection:{type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'m',preset:'custom',contextSize:64000}});
  const done=await loadState(id);
  assert.deepEqual(result.pending,[]);assert(ledgerAuditVerified(done,story,pages));
  assert.equal(sourceCalls,1);assert.equal(finalCalls,1,'A single final review records and approves supported physical repairs.');
  assert.equal(done.canon.Neri.facts.find(f=>f.key==='hair').value,'dark');
  assert.equal(done.canon.Neri.facts.find(f=>f.key==='hair (Valen face)').value,'gold');
  assert.equal(done.characters.Neri.core,state.characters.Neri.core,'Player biography and all faces remain intact.');
  assert.equal(done.canon.Elin.facts[0].value,'purple');assert(done.characters.Elin.core.includes('calculating and blunt'));
  assert.equal(done.canon['third princess'].facts[0].value,'red');assert(done.characters['third princess'].core.includes('cruel disposition'));
  assert.deepEqual(done.relationships,state.relationships);assert.deepEqual(await db.messages.list(id),pages);
  const facts=sourceAppearanceFacts(done,documents),proof=facts.find(f=>f.name==='Elin');
  const bound=bindAuditEvidence({issues:[{mutations:[{type:'canon.lock',name:'Elin',key:'hair',value:'purple',evidenceId:proof.id}]}]},facts.map(f=>({evidenceId:f.id,text:f.shown})));
  assert(bound.issues[0].mutations[0].shown&&!bound.issues[0].mutations[0].evidenceError,'The exact appearance ids used by the live failure bind original quotations.');
  // M709: an unknown reference never becomes a quotation; it is kept as an honest provenance note.
  const unknown=bindFinalAuditEvidence({issues:[{mutations:[{type:'canon.lock',evidenceId:'appearance:invented'}]}],checks:[]},[],[],documents);
  assert(!unknown.issues[0].mutations[0].shown && unknown.issues[0].mutations[0].evidenceNote,'Invented references never become quotations.');
  // reconcileIdentity/reconcileAppearance (the per-fact mapping gate) left the audit in M709; they
  // run only in verifyLedgerChecks' non-authoritative branch and the uncalled auditReviewProblems.
  const fetched=serveFetch(['1'],pages,{memory:{nodes:[{span:[0,0],text:'A folded overview omitting the princess description.'}]},story,state:done});
  assert(fetched.includes(older)&&fetched.includes('COMPLETE'),'Folded memory does not replace the fetchable original page.');
  console.log('PASS focused profile connections: supplied appearance IDs bind; direct approved physical facts save; separate persona hair retained; absent queen personality/hair and unnamed princess recovered; old story-source reviews reused; invented IDs never become quotations; folded original page fetchable; manual eyes, biography, prose and p60/r50 retained. Mocked provider, not a live phone audit.');
}finally{globalThis.fetch=oldFetch;}
