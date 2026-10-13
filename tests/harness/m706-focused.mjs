import './idb-shim.mjs';
import assert from 'node:assert/strict';
import {db} from '../../js/store.js';
import {emptyState,saveState,loadState} from '../../js/engine/state.js';
import {auditLedger} from '../../js/agents/auditor.js';
import {auditSources} from '../../js/agents/auditsources.js';
import {ledgerAuditVerified} from '../../js/agents/auditprogress.js';
import {applyMutations} from '../../js/engine/apply.js';

const cast="Neri was once a royal guardian. Neri has dark hair and handsome features. Valen is Neri's blonde public face. Elin is queen of the north, calculating and blunt, with purple hair.";
const prose='Neri waited alone at the gate. Elin remained in her northern chambers.';
const {id}=await db.stories.create({title:'Semantic profile handoff',castNotes:cast});
// The story holds what its audit is handed, as every caller hands it (chat.js: story.brief, story.castNotes; create keeps
// a title only). M752: the audit's receipts name the brief and cast notes it READ.
await db.stories.update(id,{castNotes:cast});
await db.messages.append(id,{role:'assistant',text:prose,ts:1});
const story=await db.stories.get(id),pages=await db.messages.list(id),documents=auditSources({castNotes:cast,messages:pages});
const writer=documents.find(d=>d.id.startsWith('cast:'));
const neriQuote='Neri has dark hair and handsome features.',queenQuote='Elin is queen of the north, calculating and blunt, with purple hair.';
let state={...emptyState(),sheet:{actors:{},playerName:'Neri',playerAliases:['Valen']},place:{name:'the gate'},
  present:[{name:'Neri',position:'at the gate'}],characters:{
    Neri:{core:'A traveler who formerly guarded the royal house; he has a raven and two public faces.'},
    Elin:{core:'Queen of the north; shrewd and plain spoken.'},
  },offscreen:{Elin:{location:'northern chambers',activity:'resting'}},relationships:{Elin:{p:60,r:50,s:0,history:[]}},
  auditSources:Object.fromEntries(documents.map(d=>[d.id,{mark:d.mark,appearanceReviewed:true,profileReviewed:1,people:d.id===writer.id?[
    {name:'Neri',shown:neriQuote,facts:[{key:'hair',value:'dark',shown:neriQuote},{key:'features',value:'handsome',shown:neriQuote},
      {key:'hair',value:'blonde',shown:"Valen is Neri's blonde public face."}],identityFacts:[{text:'Was once a royal guardian.',shown:'Neri was once a royal guardian.'}]},
    {name:'Elin',shown:queenQuote,facts:[{key:'hair',value:'purple',shown:queenQuote}],identityFacts:[{text:'calculating and blunt',shown:queenQuote}]},
  ]:[]}]))};
state=applyMutations(state,[{type:'canon.lock',name:'Neri',key:'hair',value:'dark in his own face; blonde in his Valen face'},
  {type:'canon.lock',name:'Neri',key:'build',value:'handsome features'},
  {type:'canon.lock',name:'Neri',key:'eyes',value:'grey',byHand:true}]).state;
await saveState(id,state);state=await loadState(id);
// M708 removed the separate focused profile request and M709 the per-fact mapping gate it fed
// (restoreProfileReconciliation, profileReconciliationTasks and the non-authoritative
// verifyLedgerChecks branch no longer decide anything in the audit). M743 carries the same
// semantic hand-off: an unmatched source identity fact is a SOURCE FACT DECISION inside the one
// combined review, and a completed verdict approves equivalent wording without a cosmetic write.
let reviews=0,source=0;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(_,options)=>{
  const body=JSON.parse(options.body),content=body.messages.map(m=>String(m.content)).join('\n');let reply;
  if(content.includes('SOURCE DOCUMENTS\n')){source++;throw Error('Cached sources should not be reread.');}
  else {
    reviews++;
    const tasks=JSON.parse(content.split('REQUIRED SOURCE MENTION DECISIONS:\n')[1].split('\n')[0]);
    const elin=tasks.find(t=>t.name==='Elin');
    assert(elin && elin.sourceFacts && elin.facts.some(f=>f.text==='calculating and blunt') && elin.originalPassage.includes(queenQuote),'The unmatched writer fact reaches the review with its original passage.');
    assert(elin.currentEntries.some(r=>r.id==='characters:Elin' && r.value.core==='Queen of the north; shrewd and plain spoken.'),'It is compared with the actual saved profile.');
    reply={issues:[],profiles:[{name:'Elin',facts:[{key:'hair',value:'purple',shown:queenQuote}]}],
      review:{status:'complete',why:'Shrewd and plain spoken is the established calculating and blunt; the combined hair field keeps both faces; the missing purple hair is saved.',open:[]},standings:[]};
  }
  const answer=JSON.stringify(reply);
  return new Response(body.stream?'data: '+JSON.stringify({choices:[{delta:{content:answer}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n':JSON.stringify({choices:[{message:{content:answer},finish_reason:'stop'}]}));
};
try{
  const result=await auditLedger({storyId:id,castNotes:cast,reviewSources:'all',connection:{type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'m',preset:'custom',contextSize:64000}});
  const done=await loadState(id);
  assert.deepEqual(result.pending,[]);assert(ledgerAuditVerified(done,story,pages));
  assert.equal(source,0);assert.equal(reviews,1,'One combined review settles the profile facts; no separate focused request.');
  assert.equal(done.canon.Elin.facts[0].value,'purple');
  assert.equal(done.characters.Neri.core,state.characters.Neri.core);assert.equal(done.characters.Elin.core,state.characters.Elin.core,'Equivalent wording is not rewritten.');
  assert.deepEqual(done.canon.Neri,state.canon.Neri);assert.deepEqual(done.relationships,state.relationships);assert.deepEqual(await db.messages.list(id),pages);
  assert.equal(Object.keys(done.audit.sourceFactDecisions||{}).length,1,'The completed semantic decision is saved for that source and profile.');
  const again=await auditLedger({storyId:id,castNotes:cast,reviewSources:'all',connection:{type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'m',preset:'custom',contextSize:64000}});
  assert.deepEqual(again.pending,[]);assert.equal(reviews,1,'An unchanged settled profile is not asked again.');
  console.log('PASS: an unmatched writer fact reaches the one combined review with its original passage and saved profile; paraphrased identity and combined faces approved without rewrites; missing hair saved and verified immediately; the decision persists and is not asked again; manual eyes, biographies, prose and p60/r50 preserved. Mocked provider, not the live story.');
}finally{globalThis.fetch=originalFetch;}
