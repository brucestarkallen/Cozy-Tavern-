import './idb-shim.mjs';
import assert from 'node:assert/strict';
import {db} from '../../js/store.js';
import {emptyState,saveState,loadState} from '../../js/engine/state.js';
import {auditLedger,auditRepairEvidence,findingRows,findingSettled} from '../../js/agents/auditor.js';
import {auditSources} from '../../js/agents/auditsources.js';
import {ledgerAuditVerified} from '../../js/agents/auditprogress.js';
import {applyMutations,undoEntry} from '../../js/engine/apply.js';
import {isMcAlias,explicitMcPersona} from '../../js/engine/duels.js';

const {id}=await db.stories.create({title:'M700 reported failure paths'});
const brief='The player is Neri. Talin is my own persona. What happens next?';
// The informative passage is beyond the first three occurrences and well
// beyond the first excerpt of its page, just as the live profile was missed.
for(let n=0;n<4;n++){
 await db.messages.append(id,{role:'user',text:'I wait.',ts:n*2+1});
 await db.messages.append(id,{role:'assistant',text:'Mara has been assigned an escort today.',ts:n*2+2});
}
const description='Mara is the fourth princess of the coast, cautious and blunt. Her silver hair is pinned up plain.';
await db.messages.append(id,{role:'user',text:'I listen.',ts:9});
await db.messages.append(id,{role:'assistant',text:'Mara entered the old hall. '+('The hall was quiet. '.repeat(230))+description,ts:10});
const prose='Neri stopped at the iron gate. Mara\'s hooked ankle had come down off the other knee. She leaned forward with gloves under her chin. Soren sat on a witness stool with his ledger shut.';
await db.messages.append(id,{role:'user',text:'I wait by the rail.',ts:11});
await db.messages.append(id,{role:'assistant',text:prose,ts:12});
const pages=await db.messages.list(id),documents=auditSources({brief,messages:pages});
const complaints=[
 {what:"Mara's presence note has her ankle off the other knee, but the latest page shows it had come down off the other knee.",pendingReason:'no repair was supplied',mutations:[]},
 {what:"Soren's People record now places him at the council table, but the newest page puts him on a witness stool.",pendingReason:'no repair was supplied',mutations:[]},
 {what:'Talin is wrongly seated elsewhere although this is the player own persona.',pendingReason:'no repair was supplied',mutations:[]},
];
const state={...emptyState(),sheet:{actors:{},playerName:'Neri'},place:{name:'the hall'},
 present:[{name:'Neri',position:'at the iron gate'},{name:'Mara',position:'ankle off the other knee, leaning forward with gloves under her chin'},{name:'Soren',position:'on a witness stool, ledger shut'}],
 characters:{Mara:{core:'Mara has been assigned an escort today.'},Soren:{core:'The hall clerk.',state:'At the council table.'},Talin:{core:''}},
 offscreen:{Talin:{location:'the hall',activity:'behind Neri\'s eyes',stance:'busy'}},
 relationships:{Mara:{p:60,r:50,s:0,history:[]}},auditSources:Object.fromEntries(documents.map(d=>[d.id,{mark:d.mark,people:[]} ])),
 audit:{coverage:{read:documents.length,total:documents.length},pending:complaints.map(i=>i.what),unresolved:complaints,unfinished:true}};
assert(findingRows(complaints[1],state).some(r=>r.id==='characters:Soren'),'A no-operation complaint must have actual current target records.');
const retrieved=auditRepairEvidence([{profileReview:true,what:'Mara identity',mutations:[{name:'Mara'}]}],documents,16000);
assert(retrieved.some(p=>p.text.includes(description)),'Recover the descriptive later occurrence, not merely the first three mentions.');
assert(!explicitMcPersona(state,'Talin','Maybe Talin is my own persona.'),'An imagined persona is not player identity.');
await saveState(id,state);
let calls=0;const oldFetch=globalThis.fetch;
globalThis.fetch=async(_,opts)=>{
 try {
 const body=JSON.parse(opts.body),content=body.messages.map(m=>String(m.content)).join('\n');
 let reply;
 if(content.includes('Find every place the writer STATES'))reply={standings:[]};
 else{
  calls++;
  const follow=content.includes('REPAIR FOLLOWUP');
  const marker=follow?'ORIGINAL SOURCE PASSAGES FOR REPAIR TARGETS, not summary quotes:\n':'ORIGINAL SOURCE PASSAGES FOR THESE TARGETS, labelled by original page and in source order. Earlier facts may be superseded:\n';
  const bank=JSON.parse(content.split(marker)[1].split('\n')[0]);
  const old=bank.find(p=>p.text.includes(description)),now=bank.find(p=>p.text.includes('witness stool')),persona=bank.find(p=>p.text.includes('Talin is my own persona'));
  assert(old&&now&&persona,'Actual needed original passages must be supplied.');
  if(!follow)reply={issues:[{what:'Talin is the player own persona, not an absent NPC.',evidenceId:persona.evidenceId,mutations:[{type:'offscreen.clear',name:'Talin'}]}],
   profiles:[{name:'Mara',core:{text:'Fourth princess of the coast; cautious and blunt.',evidenceId:old.evidenceId}},
    {name:'Soren',state:{text:'On a witness stool with his ledger shut.',evidenceId:now.evidenceId}}]};
  else{
   const rows=JSON.parse(content.split('REQUIRED CURRENT LEDGER CHECKS:\n')[1].split('\n')[0]);
   const checklist=JSON.parse(content.split('HISTORICAL FINDING IDS TO RECONCILE, including ACTUAL current target records. For every id either repair a real remaining error or return resolved with shown and why; do not leave already-correct items hanging:\n')[1].split('\n')[0]);
   assert(checklist.find(i=>i.what===complaints[1].what).currentEntries.some(r=>r.id==='characters:Soren' && r.value.state.includes('witness stool')));
   // Deliberately omit separate resolved/repairs echoes: verified current
   // records must close old no-operation allegations without extra AI runs.
   reply={issues:[],profiles:[{name:'Mara',facts:[{key:'hair',value:'silver',evidenceId:old.evidenceId}]}],checks:rows.map(row=>({id:row.id,print:row.print,status:row.id==='characters:Mara'?'repair':'correct',why:'The actual current fields agree; the completed ankle movement means the same resting pose.',
    ...(row.section==='presence'?{position:row.name==='Mara'?'ankle came down off the other knee, leaning forward with gloves under her chin':row.value.position,positionMatches:true,lastEvidenceId:now.evidenceId}:{evidenceId:row.name==='Mara'?old.evidenceId:now.evidenceId}),
    ...(row.section==='characters'?{identityReviewed:true,appearanceReviewed:true,identityFacts:row.name==='Mara'?[{text:'Fourth princess; cautious and blunt.',inCore:true,evidenceId:old.evidenceId}]:[],physicalFacts:row.name==='Mara'?[{key:'hair',value:'silver',evidenceId:old.evidenceId}]:[]}:{}),
   }))};
  }
 }
 const answer=JSON.stringify(reply);
 return new Response(body.stream?'data: '+JSON.stringify({choices:[{delta:{content:answer}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n':JSON.stringify({choices:[{message:{content:answer},finish_reason:'stop'}]}));
 }catch(error){console.error('Focused fixture reply failed:',error.message);throw error;}
};
try{
 const connection={type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'m',preset:'custom',contextSize:64000};
 const result=await auditLedger({storyId:id,connection,brief});
 const final=await loadState(id);
 assert.deepEqual(result.pending,[]);assert.equal(calls,2);
 assert(ledgerAuditVerified(final,await db.stories.get(id),pages));
 assert.equal(final.characters.Mara.core,'Fourth princess of the coast; cautious and blunt.');
 assert.equal(final.characters.Soren.state,'On a witness stool with his ledger shut.');
 assert.equal(final.canon.Mara.facts.find(f=>f.key==='hair').value,'silver');
 assert.equal(final.present[1].position,state.present[1].position,'Equivalent completed posture must not cause a rewrite.');
 assert(isMcAlias(final,'Talin'),'Alias must survive saving/loading.');assert(!final.offscreen.Talin);
 assert(applyMutations(final,[{type:'offscreen.set',name:'Talin',location:'the hall'}]).rejected.length,'World cannot recreate the player persona seat.');
 const failed={...final.audit.verification,entries:{...final.audit.verification.entries}};delete failed.entries['characters:Soren'];
 assert(!findingSettled(complaints[1],{out:final,applied:[],rejected:[]},[],documents,failed),'A complaint stays open if its actual People record was not verified.');
 const aliasLog=final.log.findIndex(l=>l.undo?.kind==='mc.aliases.restore');
 const undone=undoEntry(final,aliasLog);
 assert(undone.state?.offscreen.Talin&&!isMcAlias(undone.state,'Talin'),'Undo restores persona identity and its removed seat together.');
 assert.deepEqual(final.relationships,state.relationships);assert.deepEqual(await db.messages.list(id),pages);
 console.log('PASS one focused check: late descriptive source recovery, direct sourced profile/state/hair repair, equivalent posture retained, operationless findings close only against verified current records, persisted player persona blocks World reseating and can be undone; prose and scores unchanged. Controlled replies, not a live story audit.');
}finally{globalThis.fetch=oldFetch;}
