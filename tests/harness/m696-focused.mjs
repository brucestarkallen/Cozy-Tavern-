import './idb-shim.mjs';
import assert from 'node:assert/strict';
import {db} from '../../js/store.js';
import {emptyState,saveState,loadState} from '../../js/engine/state.js';
import {samePersonName} from '../../js/engine/names.js';
import {findPersonKey} from '../../js/engine/people.js';
import {missingLedgerPeople} from '../../js/agents/auditsources.js';
import {auditLedger,auditFindingId,auditRepairEvidence} from '../../js/agents/auditor.js';
import {auditSources} from '../../js/agents/auditsources.js';
import {ledgerAuditVerified} from '../../js/agents/auditprogress.js';
const captain="Alexander William's captain", short="William's captain";
assert(samePersonName(captain,short));
assert(!samePersonName("Alexia's woman",'Alexia'));
assert(!samePersonName("Alexia's woman","William's woman"));
assert(!samePersonName("William's captain","William's groom"));
assert.equal(findPersonKey({[short]:{core:'Captain of William.'}},captain),short);
const {id}=await db.stories.create({title:'M696 inherited repair failure'});
const wall='His shoulder blade found the cold stone of the salle wall.';
const guards='The guards lined the far wall, murmuring odds against him.';
const fur='Commodus stood at the rail beside Garett, both wrapped in fur.';
const king='King Theodagar of Ilvarren, the king, waits in his counting room.';
const report="William's captain carried the salle account to his prince.";
await db.messages.append(id,{role:'user',text:'The duel continues.',ts:1});
await db.messages.append(id,{role:'assistant',text:wall+' '+guards+' '+fur,voices:[{speaker:'William',content:king+' '+report}],ts:2});
const findings=[
 {what:'The guards position omits the odds.',fix:'Record the far wall and odds.',mutations:[{type:'presence.update',name:'the guards',position:'the far wall with odds against him',attire:'—'}]},
 {what:'Commodus is absent in the kings hall.',fix:'At the rail in fur.',mutations:[{type:'presence.update',name:'Commodus',position:'the rail beside Garett',attire:'wrapped in fur'}]},
 {what:'Alexander Williams captain has no identity.',fix:'Restore the captain.',mutations:[{type:'people.set',name:captain,field:'core',text:'Captain carrying the third pass.'}]},
 {what:'The king and Theodagar are two copies.',fix:'Merge the king.',mutations:[{type:'people.rename',from:'the king',to:'Theodagar',shown:'A paraphrase from a folded summary that is not in any original page.'}]},
];
await saveState(id,{...emptyState(),sheet:{actors:{},playerName:'Azrael'},place:{name:'the salle'},
 characters:{[captain]:{core:''},[short]:{core:'Captain of Prince William; his aide and messenger.'},Commodus:{core:'Second prince.'},'the guards':{core:'Salle guards.'},'the king':{core:'King of Ilvarren.'},Theodagar:{core:'King Theodagar of Ilvarren.'}},
 present:[{name:'Azrael',position:'not yet at the wall'},{name:'the guards',position:'lined along the far wall, the odds against him'},{name:'Commodus',position:'the rail beside Garett',attire:''}],
 offscreen:{[captain]:{location:'the yard stairs',activity:'reporting'},[short]:{location:'the gate',activity:'reporting'}},
 relationships:{Commodus:{P:60,R:50}},audit:{coverage:{read:3,total:3},pending:findings.map(i=>i.what),unresolved:findings}});
const pages=await db.messages.list(id),before=await loadState(id);
assert(!missingLedgerPeople(before).some(s=>s.startsWith(captain)));
assert(auditRepairEvidence(findings,auditSources({messages:pages})).some(p=>p.text.includes(king)));
const oldFetch=globalThis.fetch;let calls=0;
globalThis.fetch=async(_,opts)=>{
 const body=JSON.parse(opts.body),content=body.messages.map(m=>String(m.content)).join('\n');
 // M708: ONE combined review repairs the inherited findings first and certifies the
 // resulting ledger in the same answer (M698/M709 completed verdict); no REPAIR FOLLOWUP.
 calls++;assert(content.includes('HISTORICAL FINDINGS WITH ACTUAL CURRENT RECORDS'));assert(content.includes('FINAL REVIEW CONTRACT'));assert(content.includes(king));
 const reply={repairs:[
   {id:auditFindingId(findings[0]),status:'correct',shown:guards,why:'Current location already includes both the far wall and odds.'},
   {id:auditFindingId(findings[1]),status:'repair',shown:fur,why:'Keep the existing presence and add the missing fur.',mutations:[{type:'presence.update',name:'Commodus',attire:'wrapped in fur',shown:fur}]},
   {id:auditFindingId(findings[2]),status:'repair',shown:report,why:'The full and short owner labels name the same captain.',mutations:[{type:'people.rename',from:captain,to:short,shown:report}]},
   {id:auditFindingId(findings[3]),status:'repair',shown:king,why:'Original World report identifies the king by name.',mutations:[{type:'people.rename',from:'the king',to:'Theodagar',shown:king}]},
  ],issues:[{what:'Azrael ended at the wall.',mutations:[{type:'presence.update',name:'Azrael',position:'at the wall',shown:wall}]}],
  review:{status:'complete',why:'Each inherited finding was checked against the original page and World voice; the resulting ledger is correct.',open:[]},standings:[]};
 const text=JSON.stringify(reply);
 return new Response(body.stream?'data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n':JSON.stringify({choices:[{message:{content:text},finish_reason:'stop'}]}));
};
try{
 const result=await auditLedger({storyId:id,connection:{type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'m',preset:'custom',context:64000}});
 const final=await loadState(id);
 assert.deepEqual(result.pending,[]);
 assert.equal(final.characters[captain],undefined);assert(final.characters[short].core.includes('aide'));
 assert.equal(final.characters['the king'],undefined);assert(final.characters.Theodagar);
 assert.equal(final.present.find(p=>p.name==='Azrael').position,'at the wall');
 assert.equal(final.present.find(p=>p.name==='Commodus').attire,'wrapped in fur');
 assert.equal(final.present.find(p=>p.name==='the guards').position,before.present.find(p=>p.name==='the guards').position);
 assert.deepEqual(final.relationships,before.relationships);assert.deepEqual(await db.messages.list(id),pages);
 assert(ledgerAuditVerified(final,await db.stories.get(id),pages));assert.equal(calls,1);
 console.log('PASS focused inherited findings: equivalent guard closure, missing fur, same-owner captain merge, identity proof in World voice, original passages, final scene check and unchanged prose/scores. Mock model only.');
}finally{globalThis.fetch=oldFetch;}
