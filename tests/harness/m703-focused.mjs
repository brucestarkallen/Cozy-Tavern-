import './idb-shim.mjs';
import assert from 'node:assert/strict';
import {db} from '../../js/store.js';
import {emptyState,saveState,loadState} from '../../js/engine/state.js';
import {auditLedger,auditorRepairScope,verifyLedgerChecks} from '../../js/agents/auditor.js';
import {auditSources} from '../../js/agents/auditsources.js';
import {ledgerVerificationRows,ledgerRepairInputKey,ledgerRepairStateKey,ledgerAuditVerified,verificationReceiptMatches} from '../../js/agents/auditprogress.js';
import {applyMutations,mcPageOnlyHis,undoEntry} from '../../js/engine/apply.js';

const {id}=await db.stories.create({title:'M703 connected authority and resuming review'});
const bio='Neri is a hooded traveler with deep blue eyes and a raven at his command.';
const cast='Mara is the fourth princess, cautious and blunt, with silver hair. Soren is a quiet gardener who raises blue roses and keeps his own counsel.';
const prose='Neri stopped at the gate. Mara leaned forward with her gloves under her chin. Soren stayed in the garden.';
await db.messages.append(id,{role:'user',text:'I wait.',ts:1});
await db.messages.append(id,{role:'assistant',text:prose,ts:2});
const story=await db.stories.get(id),pages=await db.messages.list(id),documents=auditSources({brief:bio,castNotes:cast,messages:pages});
const core='Hooded traveler with deep blue eyes; a raven at his command.';
const oldGardener='Quiet gardener; raises blue roses; keeps his own counsel.';
let state={...emptyState(),sheet:{actors:{},playerName:'Neri'},place:{name:'the hall'},
  present:[{name:'Neri',position:'at the gate'},{name:'Mara',position:'leaning forward with her gloves under her chin'}],
  characters:{Neri:{core:''},Mara:{core:'Fourth princess; cautious and blunt.'},Soren:{core:oldGardener,state:'In the garden.'}},
  offscreen:{Soren:{location:'the garden',activity:'raising blue roses'}},canon:{Mara:{facts:[{key:'hair',value:'silver'}]}},
  relationships:{Mara:{p:60,r:50,s:0,history:[]}},
  auditSources:Object.fromEntries(documents.map(d=>[d.id,{mark:d.mark,people:[]}])),
};
// Receipts refer to actual persisted shapes, including normal migration defaults.
await saveState(id,state);state=await loadState(id);
const source=ledgerRepairInputKey({},story,pages),rows=ledgerVerificationRows(state);
const already=rows.filter(r=>['characters:Mara','relationships:Mara'].includes(r.id));
state.audit={unfinished:true,coverage:{read:documents.length,total:documents.length},
  pending:['Neri biography is missing'],unresolved:[{what:'Neri biography is empty despite writer facts.',mutations:[{type:'people.set',name:'Neri',field:'core',text:core}]}],
  verification:{source,ledger:'a different prior ledger state',entries:Object.fromEntries(already.map(r=>[r.id,{print:r.print,scope:r.scope,status:'correct',why:'Reviewed previously.',shown:cast}]))}};
assert.equal(applyMutations(state,[{type:'people.set',name:'Neri',field:'core',text:'An invented coward.'}]).applied.length,0,'Ordinary workers still cannot invent the player biography.');
const refused=[];
auditorRepairScope([{what:'not writer facts',mutations:[{type:'people.set',name:'Neri',field:'core',text:'An invented coward.',shown:prose,writerEstablished:true,byHand:true}]}],state,{sources:bio+'\n'+prose,writerSources:bio,rejected:refused});
assert.equal(refused.length,1,'Provider flags cannot grant themselves writer authority.');
const hand=applyMutations(state,[{type:'people.set',name:'Neri',field:'core',text:'My own biography.',byHand:true}]).state;
assert.equal(mcPageOnlyHis(hand).length,0,'Opening does not erase a manual biography.');
await saveState(id,state);
let reads=0;const oldFetch=globalThis.fetch;
globalThis.fetch=async(_,opts)=>{
  const body=JSON.parse(opts.body),content=body.messages.map(m=>String(m.content)).join('\n');let reply;
  if(content.includes('Find every place the writer STATES'))reply={standings:[]};
  else {
    reads++;const follow=content.includes('REPAIR FOLLOWUP');
    const marker=follow?'ORIGINAL SOURCE PASSAGES FOR REPAIR TARGETS, not summary quotes:\n':'ORIGINAL SOURCE PASSAGES FOR THESE TARGETS, labelled by original page and in source order. Earlier facts may be superseded:\n';
    const bank=JSON.parse(content.split(marker)[1].split('\n')[0]);
    const writer=bank.find(p=>p.text.includes(bio)),now=bank.find(p=>p.text.includes(prose)),castProof=bank.find(p=>p.text.includes('Soren is a quiet gardener'));
    assert(writer&&now&&castProof,'Provide factual references, including original player material.');
    if(!follow)reply={profiles:[{name:'Neri',core:{text:core,evidenceId:writer.evidenceId}},
      {name:'Soren',core:{text:'Quiet gardener.',evidenceId:castProof.evidenceId}}]};
    else {
      const required=JSON.parse(content.split('REQUIRED CURRENT LEDGER CHECKS:\n')[1].split('\n')[0]);
      assert(!required.some(r=>already.some(a=>a.id===r.id)),'Unrelated repairs do not erase completed checks.');
      if(reads===2){
        const plans=JSON.parse(content.split('PROVISIONAL BIOGRAPHIES TO VERIFY BEFORE SAVING, including their exact prior text:\n')[1].split('\n')[0]);
        assert(plans.some(p=>p.id==='characters:Soren'&&p.before===oldGardener&&p.after==='Quiet gardener.'),'Final housekeeper sees the facts a draft omitted.');
      } else assert.deepEqual(required.map(r=>r.id),['characters:Soren'],'Resume only the unfinished unchanged entry.');
      reply={checks:required.filter(r=>!(reads===2&&r.id==='characters:Soren')).map(r=>({id:r.id,status:'correct',why:'Original facts and current values reviewed; judgments retained.',
        ...(r.section==='presence'?{position:r.value.position,positionMatches:true,lastEvidenceId:now.evidenceId}
          :{evidenceId:r.name==='Neri'?writer.evidenceId:r.section==='characters'||r.section==='canon'?castProof.evidenceId:now.evidenceId}),
      }))}; // The semantic approval is enough; no redundant profile arrays/flags.
    }
  }
  const answer=JSON.stringify(reply);
  return new Response(body.stream?'data: '+JSON.stringify({choices:[{delta:{content:answer}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n':JSON.stringify({choices:[{message:{content:answer},finish_reason:'stop'}]}));
};
try {
  const args={storyId:id,brief:bio,castNotes:cast,connection:{type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'m',preset:'custom',contextSize:64000}};
  const first=await auditLedger(args),part=await loadState(id);
  assert.equal(part.characters.Neri.core,core);assert.equal(part.characters.Neri.coreOrigin.kind,'writer');
  assert.equal(part.characters.Soren.core,oldGardener,'An unapproved shortening never replaces the old biography.');
  assert(first.unfinished&&!ledgerAuditVerified(part,story,pages));assert.equal(part.audit.verification.pending.length,1);
  assert.equal(mcPageOnlyHis(part).length,0,'Approved writer biography survives opening cleanup.');
  const second=await auditLedger(args),final=await loadState(id);
  assert.deepEqual(second.pending,[]);assert.equal(reads,3,'One repair reading, one review, then only the missing check.');
  assert(ledgerAuditVerified(final,story,pages));assert.deepEqual(final.relationships,state.relationships);assert.deepEqual(await db.messages.list(id),pages);
  const row=ledgerVerificationRows(final).find(r=>r.id==='characters:Mara'),receipt=final.audit.verification.entries[row.id];
  assert(verificationReceiptMatches(receipt,row));
  const moved={...final,present:final.present.map(p=>p.name==='Mara'?{...p,position:'at the door'}:p)};
  assert(!verificationReceiptMatches(receipt,ledgerVerificationRows(moved).find(r=>r.id===row.id)),'A changed related scene invalidates the biography review.');
  const changedSource={...story,brief:'Different original facts'};
  assert(!ledgerAuditVerified(final,changedSource,pages),'Changed original material cannot reuse green.');
  const decline=verifyLedgerChecks({state:final,checks:[{id:row.id,print:row.print,status:'correct',why:'ok',shown:cast,identityReviewed:false}],documents,source});
  assert(decline.pending.some(p=>p.startsWith(row.id)),'An explicitly incomplete semantic review is not approval.');
  const index=final.log.findIndex(l=>l.source==='auditor'&&l.undo?.name==='Neri');
  assert.equal(undoEntry(final,index).state.characters.Neri.core,'','Writer biography and provenance remain undoable.');
  console.log('PASS focused connected audit: sourced player facts survive save/open and undo; provider ownership spoofing refused; prior biography retained without approval; valid receipts survive unrelated ledger repair; only unfinished check resumes; changed context/source and incomplete reviews prevent green; prose and scores unchanged. Controlled replies, not a live phone audit.');
}finally{globalThis.fetch=oldFetch;}
