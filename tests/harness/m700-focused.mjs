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
// The story holds what its audit is handed, as every caller hands it (chat.js: story.brief, story.castNotes; create keeps
// a title only). M752: the audit's receipts name the brief and cast notes it READ.
await db.stories.update(id,{brief});
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
 {
  // M708: ONE combined review: its original passages, the historical findings with their
  // ACTUAL current records, the repairs and (M709) the explicit whole-review verdict.
  calls++;
  const bank=JSON.parse(content.split('ORIGINAL SOURCE REFERENCES:\n')[1].split('\n')[0]);
  const old=bank.find(p=>p.text.includes(description)),now=bank.find(p=>p.text.includes('witness stool')),persona=bank.find(p=>p.text.includes('Talin is my own persona'));
  assert(old&&now&&persona,'Actual needed original passages must be supplied.');
  const checklist=JSON.parse(content.split('HISTORICAL FINDINGS WITH ACTUAL CURRENT RECORDS:\n')[1].split('\n')[0]);
  // The current ledger rows keep a person's changing state in its own characterState row.
  assert(checklist.find(i=>i.what===complaints[1].what).currentEntries.some(r=>r.id==='characterState:Soren' && r.value.state==='At the council table.'));
  // Deliberately omit separate resolved/repairs echoes: verified current
  // records must close old no-operation allegations without extra AI runs.
  // M719: profiles recovery appends missing facts to a core; replacing a wrong event
  // sentence is an explicit correction, which keeps its replacing meaning.
  reply={issues:[{what:'Talin is the player own persona, not an absent NPC.',evidenceId:persona.evidenceId,mutations:[{type:'offscreen.clear',name:'Talin'}]},
    {what:'Mara needs her established identity, not an event sentence.',evidenceId:old.evidenceId,mutations:[{type:'people.set',name:'Mara',field:'core',text:'Fourth princess of the coast; cautious and blunt.'}]}],
   profiles:[{name:'Mara',facts:[{key:'hair',value:'silver',evidenceId:old.evidenceId}]},
    {name:'Soren',state:{text:'On a witness stool with his ledger shut.',evidenceId:now.evidenceId}}],
   scene:[{name:'Mara',repair:false,ending:{position:'ankle came down off the other knee, leaning forward with gloves under her chin',shown:"Mara's hooked ankle had come down off the other knee."}}],
   review:{status:'complete',why:'The actual current fields agree; the completed ankle movement means the same resting pose.',open:[]},standings:[]};
 }
 const answer=JSON.stringify(reply);
 return new Response(body.stream?'data: '+JSON.stringify({choices:[{delta:{content:answer}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n':JSON.stringify({choices:[{message:{content:answer},finish_reason:'stop'}]}));
 }catch(error){console.error('Focused fixture reply failed:',error.message);throw error;}
};
try{
 const connection={type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'m',preset:'custom',contextSize:64000};
 const result=await auditLedger({storyId:id,connection,brief});
 const final=await loadState(id);
 assert.deepEqual(result.pending,[]);assert.equal(calls,1);
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
