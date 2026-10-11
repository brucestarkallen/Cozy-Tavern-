import './idb-shim.mjs';
import assert from 'node:assert/strict';
import {db} from '../../js/store.js';
import {emptyState,saveState,loadState} from '../../js/engine/state.js';
import {auditLedger,parseAuditorAnswer,bindAuditEvidence,verifyLedgerChecks,findingRows,auditorRepairScope} from '../../js/agents/auditor.js';
import {auditSources} from '../../js/agents/auditsources.js';
import {ledgerVerificationRows,ledgerAuditVerified} from '../../js/agents/auditprogress.js';
import {applyMutations,undoEntry} from '../../js/engine/apply.js';
import {explicitMcPersona,isMcAlias} from '../../js/engine/duels.js';

const {id}=await db.stories.create({title:'M702 evidence and identity contract'});
const identity="Note the forms: Neri the traveler; Talin his adventurer's name; Vale his knight's name in the palace.";
const brief=identity;
const profile='Mara is the fourth princess of the coast, cautious and blunt. Her silver hair is pinned up plain.';
const king='King Orren of the coast came around the table and stood in the candlelight.';
const ending='Neri stopped at the gate. Mara leaned forward with gloves under her chin. Soren the hall clerk sat on a witness stool, ledger shut.';
await db.messages.append(id,{role:'user',text:profile,ts:1});
await db.messages.append(id,{role:'assistant',text:king+' '+ending,ts:2});
const pages=await db.messages.list(id),documents=auditSources({brief,messages:pages});
const prior={what:'The duplicate Orren needs merging and its obsolete seat proposal should be reviewed against the saved king.',targets:[{id:'offscreen:Orren'}],mutations:[{type:'offscreen.set',name:'Orren',location:'another old seat'}]};
const state={...emptyState(),sheet:{actors:{},playerName:'Neri'},place:{name:'the hall'},
  present:[{name:'Neri',position:'at the gate'},{name:'Mara',position:'leaning forward with gloves under her chin'},{name:'Soren',position:'on a witness stool, ledger shut'}],
  characters:{Mara:{core:'Mara was assigned an escort.'},Soren:{core:'The hall clerk.',state:'On a witness stool, ledger shut.'},Talin:{core:'The adventurer persona.'},
    'the king':{core:'King Orren of the coast.'},Orren:{core:'King Orren of the coast.'}},
  offscreen:{Talin:{location:'nowhere',activity:'unworn'},Orren:{location:'the upper rooms'},'the king':{location:'the upper rooms'}},
  knowledge:{Orren:[{fact:'He knows the gate account.'}],'the king':[{fact:'He knows the escort assignment.'}]},
  relationships:{Mara:{p:60,r:50,s:0,history:[]}},auditSources:Object.fromEntries(documents.map(d=>[d.id,{mark:d.mark,people:[]}])),
  audit:{unfinished:true,coverage:{read:documents.length,total:documents.length},pending:[prior.what],unresolved:[prior]}};
assert(!explicitMcPersona(state,'Talin',identity),'Declarative shorthand must exercise the auditor decision, not automatic syntax recognition.');
assert.equal(applyMutations(state,[{type:'mc.alias',name:'Talin',shown:identity}]).applied.length,0,'Ordinary workers cannot take the semantic auditor path.');
const refused=[];
auditorRepairScope([{what:'fake',mutations:[{type:'mc.alias',name:'Talin',shown:'Neri and Talin never appeared in these sources.'}]}],state,{sources:brief,identitySources:brief,rejected:refused});
assert.equal(refused.length,1,'Fabricated source proof stays rejected.');
await saveState(id,state);
const oldFetch=globalThis.fetch;let reads=0;
globalThis.fetch=async(_,opts)=>{
  const body=JSON.parse(opts.body),content=body.messages.map(m=>String(m.content)).join('\n');let reply;
  if(content.includes('Find every place the writer STATES')) reply={standings:[]};
  else {
    reads++;
    const follow=content.includes('REPAIR FOLLOWUP');
    const marker=follow?'ORIGINAL SOURCE PASSAGES FOR REPAIR TARGETS, not summary quotes:\n':'ORIGINAL SOURCE PASSAGES FOR THESE TARGETS, labelled by original page and in source order. Earlier facts may be superseded:\n';
    const bank=JSON.parse(content.split(marker)[1].split('\n')[0]);
    const bio=bank.find(p=>p.text.includes(profile)),now=bank.find(p=>p.text.includes(ending));
    assert(bio&&now);
    if(!follow) reply={issues:[
      {what:'Talin is the player own persona.',mutations:[{type:'mc.alias',name:'Talin',shown:identity}]},
      {what:'Orren and the king are the same person.',mutations:[{type:'people.rename',from:'Orren',to:'the king',shown:king}]},
    ],profiles:[{name:'Mara',core:{text:'Fourth princess of the coast; cautious and blunt.',evidenceId:bio.evidenceId},facts:[{key:'hair',value:'silver',evidenceId:bio.evidenceId}]}]};
    else {
      const plans=JSON.parse(content.split('PROVISIONAL IDENTITY MERGES TO VERIFY BEFORE SAVING.')[1].split('\n')[1]);
      assert.deepEqual(new Set(plans.map(p=>p.mutation.type)),new Set(['mc.alias','people.rename']),'Both identity decisions must receive final review.');
      const rows=JSON.parse(content.split('REQUIRED CURRENT LEDGER CHECKS:\n')[1].split('\n')[0]);
      assert(!rows.some(r=>r.id==='characters:Orren'));assert(!rows.some(r=>r.id==='offscreen:Talin'));
      // Checks-only JSON, no hash echoes, and People proof supplied ONLY on
      // each factual item. All three were valid contracts rejected before.
      reply={checks:rows.map(row=>({id:row.id,status:'correct',why:'Current values agree with originals; valid judgments retained.',
        ...(row.section==='presence'?{position:row.value.position,positionMatches:true,lastEvidenceId:now.evidenceId}
          :row.section==='characters'&&!isMcAlias({sheet:{playerName:'Neri',playerAliases:['Talin']}},row.name)?{}
          :{evidenceId:now.evidenceId}),
        ...(row.section==='characters'?{identityReviewed:true,appearanceReviewed:true,
          identityFacts:[{text:row.value.core,inCore:true,evidenceId:row.name==='Mara'?bio.evidenceId:now.evidenceId}],
          physicalFacts:row.name==='Mara'?[{key:'hair',value:'silver',evidenceId:bio.evidenceId}]:[]}:{}),
      }))};
    }
  }
  const answer=JSON.stringify(reply);
  return new Response(body.stream?'data: '+JSON.stringify({choices:[{delta:{content:answer}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n':JSON.stringify({choices:[{message:{content:answer},finish_reason:'stop'}]}));
};
try {
  const result=await auditLedger({storyId:id,brief,connection:{type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'m',preset:'custom',contextSize:64000}});
  const final=await loadState(id);
  assert.deepEqual(result.pending,[]);assert.equal(reads,2);assert(ledgerAuditVerified(final,await db.stories.get(id),pages));
  assert(!final.characters.Orren);assert(final.characters['the king'].aliases.includes('Orren'));
  assert.equal(final.knowledge['the king'].length,2,'Merge retains both knowledge records.');
  assert(isMcAlias(final,'Talin'));assert(!final.offscreen.Talin);
  assert.equal(final.canon.Mara.facts[0].value,'silver');assert.deepEqual(final.relationships,state.relationships);assert.deepEqual(await db.messages.list(id),pages);
  assert(findingRows(prior,final).some(r=>r.id==='characters:the king'),'Historical ids follow a completed merge.');
  const log=final.log.findIndex(l=>l.undo?.kind==='mc.aliases.restore');
  assert(undoEntry(final,log).state.offscreen.Talin,'Identity and cleared seat remain undoable together.');
  const row=ledgerVerificationRows(final).find(r=>r.id==='characters:Mara');
  const bad=bindAuditEvidence(parseAuditorAnswer(JSON.stringify({checks:[{id:row.id,print:'wrong-snapshot',status:'correct',why:'ok',shown:profile,identityReviewed:true,appearanceReviewed:true,identityFacts:[],physicalFacts:[]}]})),[],[row]);
  assert(verifyLedgerChecks({state:final,checks:bad.checks,documents,source:'x'}).pending.some(p=>p.includes('characters:Mara: check fingerprint')),'Explicit wrong hashes must still fail.');
  const missing={...final,audit:{...final.audit,verification:{...final.audit.verification,entries:{...final.audit.verification.entries}}}};
  delete missing.audit.verification.entries[row.id];assert(!ledgerAuditVerified(missing,await db.stories.get(id),pages),'Missing checks cannot become green.');
  console.log('PASS focused complete audit: nested People evidence, checks-only JSON, caller-bound snapshot, role/name merge, declarative player persona, obsolete target reconciliation, source rejection, undo, retained prose/scores and truthful completion. Controlled replies, not a live phone audit.');
} finally {globalThis.fetch=oldFetch;}
