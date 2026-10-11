import './idb-shim.mjs';
import assert from 'node:assert/strict';
import { auditSources, reviewAuditSources } from '../../js/agents/auditsources.js';
import { ledgerRepairInputKey, ledgerRepairStateKey, ledgerVerificationRows, saveAuditCheckpoint, ledgerAuditVerified, ledgerRepairNeeded } from '../../js/agents/auditprogress.js';
import { auditLedger } from '../../js/agents/auditor.js';
import { emptyState, loadState, saveState } from '../../js/engine/state.js';
import { fingerprint36 } from '../../js/engine/fingerprint.js';
import { pageText } from '../../js/assemble/stack.js';
import { db } from '../../js/store.js';

// One causal milestone fixture. Only mocked source replies, no live provider.
const connection = {type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'fixture',preset:'custom',contextSize:200000,reasoning:{effort:'off'}};
const quote = 'Elin is queen and has violet hair.';
const pages = [{id:'writer',role:'user',text:quote},{id:'story',role:'assistant',text:'The rain eased.'}];
const documents = auditSources({messages:pages});
const person = {name:'Elin',source:documents[0].id,shown:quote,facts:[{key:'hair',value:'violet',shown:quote}],identityFacts:[{text:'Queen.',shown:quote}]};
const originalFetch = globalThis.fetch;
let calls = 0, keepBad = false, weatherOnly = false;
globalThis.fetch = async (_,options) => {
  calls++;
  const body = JSON.parse(options.body);
  const first = body.messages.find(m => String(m.content).startsWith('SOURCE DOCUMENTS\n'));
  assert(first,'Source-only recovery must not call the whole ledger reviewer.');
  const batch = JSON.parse(first.content.split('SOURCE DOCUMENTS\n')[1]);
  const correction = body.messages.find(m => String(m.content).startsWith('Complete the SAME source reading.'));
  let reply;
  if (weatherOnly) {
    reply = {checked:correction ? [batch[0].id] : batch.slice(1).map(d=>d.id),people:[]};
  } else if (correction) {
    assert(body.messages.some(m=>m.role==='assistant'),'Correction retains the preceding reading.');
    assert(correction.content.includes('identityFacts:[]'),'Correction includes the precise refusal.');
    assert(!correction.content.split('\n')[0].includes(documents[1].id),'Completed source is not requested again.');
    reply = {checked:[documents[0].id],people:[keepBad ? {...person,identityFacts:undefined} : person]};
  } else reply = {checked:batch.map(d=>d.id),people:[{...person,identityFacts:undefined}]};
  const content = JSON.stringify(reply);
  return new Response(body.stream
    ? 'data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'
    : JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]}));
};
function reviewed(state,story,history) {
  const docs = auditSources({brief:story.brief,castNotes:story.castNotes,messages:history});
  const rows = ledgerVerificationRows(state);
  const verification = {source:ledgerRepairInputKey({},story,history),ledger:ledgerRepairStateKey(state),read:rows.length,total:rows.length,
    entries:Object.fromEntries(rows.map(r=>[r.id,{print:r.print,scope:r.scope,status:'correct',why:'Reviewed actual value.'}])),profiles:{}};
  state.audit = {verification,verifiedInput:ledgerRepairInputKey(state,story,history),coverage:{read:docs.length,total:docs.length},finalReview:{status:'ok'},pending:[],unresolved:[],unfinished:false};
  state.audit.checkpoint = saveAuditCheckpoint(state,story,docs,verification);
  return state;
}
try {
  const result = await reviewAuditSources({connection,documents,mode:'all'});
  assert.equal(calls,2);assert.equal(result.read,2);assert.deepEqual(result.pending,[]);
  assert.equal(result.cache[documents[0].id].people[0].facts[0].value,'violet');
  assert.equal((await reviewAuditSources({connection,documents,previous:result.cache,mode:'all'})).calls,0);
  assert.equal(calls,2);
  keepBad=true;calls=0;
  const open = await reviewAuditSources({connection,documents,mode:'all'});
  assert.equal(calls,2);assert.equal(open.read,1);assert.equal(open.failures[0].source,documents[0].id);
  assert(open.failures[0].problems.some(p=>p.why.includes('identityFacts')));assert(open.pending.length);

  const story = {brief:'',castNotes:'',connections:{auditor:'one'}};
  const state = reviewed({...emptyState(),characters:{Elin:{core:'Queen.'}}},story,pages);
  assert(ledgerAuditVerified(state,story,pages));
  assert(!ledgerRepairNeeded(state,{auditor:{ok:false,unfinished:true}},story,pages),'Old shelf errors do not restart completion.');
  const metadata = structuredClone(state);metadata.characters.Elin.updatedAtTurn=900;
  assert(ledgerAuditVerified(metadata,{...story,connections:{auditor:'two'}},pages),'Bookkeeping and provider changes preserve completion.');
  const fact = structuredClone(state);fact.characters.Elin.core='Princess.';
  assert(!ledgerAuditVerified(fact,story,pages));
  assert(!ledgerAuditVerified(state,story,pages.map(p=>p.id==='writer'?{...p,text:quote+' A new fact.'}:p)));
  assert(!ledgerAuditVerified(state,story,pages.map(p=>p.id==='writer'?{...p,role:'assistant'}:p)));
  assert(!ledgerAuditVerified(state,story,[...pages].reverse()));

  const legacy = structuredClone(state);
  delete legacy.audit.checkpoint.source;
  legacy.audit.verification.source = fingerprint36(JSON.stringify(['m713-001',story.brief,story.castNotes,story.connections,
    pages.map(p=>[p.id,p.role,p.ooc,pageText(p),p.voices || []]),fingerprint36(JSON.stringify(Array(20).fill(null)))]));
  legacy.audit.verifiedInput='old version key';legacy.audit.verification.ledger='old raw ledger key';
  assert(ledgerAuditVerified(legacy,story,pages),'Real M713 completion migrates without another review.');
  assert(!ledgerRepairNeeded(legacy,{},story,pages));
  assert(!ledgerAuditVerified(legacy,story,pages.map(p=>p.id==='writer'?{...p,role:'assistant'}:p)));
  const unfinished = structuredClone(legacy);unfinished.audit.pending=['One source remains unread.'];
  assert(!ledgerAuditVerified(unfinished,story,pages));

  // Exercise the actual persisted audit path with a previously approved ledger
  // and one unfinished source, asserting it sends only the source correction.
  weatherOnly=true;calls=0;
  const tale = await db.stories.create({title:'Source recovery fixture'});
  await db.messages.append(tale.id,{role:'user',text:'The morning was quiet.'});
  await db.messages.append(tale.id,{role:'assistant',text:'The rain eased.'});
  const history = await db.messages.list(tale.id);
  const originals = auditSources({messages:history});
  await saveState(tale.id,await loadState(tale.id));
  let saved = await loadState(tale.id);
  saved = reviewed(saved,tale,history);
  saved.auditSources = {[originals[1].id]:{mark:originals[1].mark,appearanceReviewed:true,profileReviewed:1,people:[]}};
  saved.audit.coverage.read=1;saved.audit.unfinished=true;saved.audit.pending=['One original source section still needs review.'];saved.audit.verifiedInput=null;
  await saveState(tale.id,saved);
  const recovered = await auditLedger({connection,storyId:tale.id,reviewSources:'all'});
  assert(recovered);assert.equal(recovered.unfinished,false,JSON.stringify({pending:recovered.pending,issues:recovered.issues,calls}));assert.equal(calls,2);
  const landed = await loadState(tale.id);
  assert.equal(landed.audit.finalReview.retained,true);assert.equal(landed.audit.finalReview.calls,0);
  assert(ledgerAuditVerified(landed,tale,history));assert(!ledgerRepairNeeded(landed,{},tale,history));
  console.log('M715 passed: focused source correction, exact failures, cached completion and M713 migration; persisted source-only recovery made two mocked source calls and zero ledger review calls.');
} finally {globalThis.fetch=originalFetch;}
