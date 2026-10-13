import './idb-shim.mjs';
import assert from 'node:assert/strict';
import {db} from '../../js/store.js';
import {emptyState,saveState,loadState} from '../../js/engine/state.js';
import {auditLedger,auditorSourceQuote,auditFindingId} from '../../js/agents/auditor.js';
import {auditSources} from '../../js/agents/auditsources.js';
import {ledgerAuditVerified} from '../../js/agents/auditprogress.js';
import {ledgerDebugReport} from '../../js/ui/ledgerdebug.js';
const arrival="Alexia's woman settled two seats behind the princess.";
const ending='Azrael reached the wall. Commodus stood at the rail.';
const voice={speaker:'Alexander William',content:'His captain reports the third pass.'};
const sources=arrival+'\n'+ending;
// M709: the final auditor no longer runs auditorRepairScope's quote gate; the continuing
// spectator's earlier-page evidence is checked through the production audit below.
assert.equal(auditorSourceQuote('*His* captain reports the third pass.','His captain reports the third pass.'),'*His* captain reports the third pass.');
assert.equal(auditorSourceQuote(sources,'Azrael did not reach the wall.'),'');
const issue={what:'A long historical complaint about the spectator.',fix:'enter',mutations:[{type:'presence.enter',name:"Alexia's woman",shown:arrival}],pendingReason:'old guard refusal'};
const {id}=await db.stories.create({title:'M694 specific failure fixture'});
await db.messages.append(id,{role:'user',text:'We enter the salle.',ts:1});
await db.messages.append(id,{role:'assistant',text:arrival,ts:2});
await db.messages.append(id,{role:'user',text:'The duel continues.',ts:3});
await db.messages.append(id,{role:'assistant',text:ending,voices:[voice],ts:4});
const pages=await db.messages.list(id);
assert(auditSources({messages:pages}).some(d=>d.text.includes(voice.content)));
await saveState(id,{...emptyState(),sheet:{actors:{},playerName:'Azrael'},audit:{coverage:{read:5,total:5},pending:[issue.what],unresolved:[issue]}});
assert(!ledgerAuditVerified(await loadState(id),await db.stories.get(id),pages));
const oldFetch=globalThis.fetch;
let reviewed=0;
globalThis.fetch=async(_,opts)=>{
 const body=JSON.parse(opts.body), content=body.messages.map(m=>String(m.content)).join('\n');
 // M708: ONE combined review discovers, repairs and reconciles inherited findings
 // by id; M698/M709: it ends with the explicit completed review verdict.
 reviewed++;assert(content.includes('HISTORICAL FINDINGS WITH ACTUAL CURRENT RECORDS'));
 assert(content.includes(voice.content));assert(content.includes(auditFindingId(issue)));
 const reply={issues:[{what:'Enter the continuing spectator',fix:'keep her present',mutations:[{type:'people.set',name:"Alexia's woman",field:'core',text:'Attendant of the princess.',shown:arrival},{type:'presence.enter',name:"Alexia's woman",shown:arrival}]}],
  resolved:[{id:auditFindingId(issue),shown:arrival,why:'The spectator now has her own presence entry.'}],
  review:{status:'complete',why:'Every required entry was reviewed against both pages and the World voice.',open:[]},standings:[]};
 const text=JSON.stringify(reply);
 return new Response(body.stream?'data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n':JSON.stringify({choices:[{message:{content:text},finish_reason:'stop'}]}));
};
try{
 const result=await auditLedger({storyId:id,connection:{type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'m',preset:'custom',context:64000}});
 assert.equal(reviewed,1);assert.deepEqual(result.pending,[]);
 const state=await loadState(id),story=await db.stories.get(id);
 assert(state.present.some(p=>p.name==="Alexia's woman"),'Earlier-page arrival evidence keeps the continuing spectator.');
 assert(ledgerAuditVerified(state,story,pages));
 assert(!ledgerAuditVerified({...state,audit:{...state.audit,pending:['new real concern']}},story,pages));
 assert(!ledgerAuditVerified({...state,place:{name:'different room'}},story,pages));
 assert(!ledgerAuditVerified(state,story,[...pages,{id:'new',role:'assistant',text:'new page'}]));
 const report=await ledgerDebugReport(id);
 assert(new TextEncoder().encode(report).length<=24000);
 assert(report.includes('"verifiedCurrentLedger": true'));
 assert.deepEqual((await db.messages.list(id)),pages);
 console.log('PASS production audit accepts continuing spectator, reads World voice, closes inherited ID, certifies current ledger, rejects stale/open verification, keeps report bounded and prose unchanged.');
}finally{globalThis.fetch=oldFetch;}
