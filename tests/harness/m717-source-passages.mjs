import './idb-shim.mjs';
import assert from 'node:assert/strict';
import { db } from '../../js/store.js';
import { emptyState, loadState, saveState } from '../../js/engine/state.js';
import { auditSources, sourcePassages, sourceReviewResult, reviewAuditSources, peopleSourceIndex } from '../../js/agents/auditsources.js';
import { auditLedger } from '../../js/agents/auditor.js';
import { ledgerVerificationRows, ledgerRepairInputKey, ledgerRepairStateKey, saveAuditCheckpoint, ledgerAuditVerified, ledgerRepairNeeded, LEDGER_REPAIR_POLICY } from '../../js/agents/auditprogress.js';

// Only source transport and retained final approval. No real provider calls.
const connection={type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'fixture',preset:'custom',contextSize:200000,reasoning:{effort:'off'}};
const scene='Keir stood by the rail, sword in his left hand.\n\nNara rose. Her woman followed.\n\nThe fourth princess of Linden held both gloves in one fist.\n\nShe had silver hair. "Tell m\'lord Keir that Thursday he will wear the house colors," she said.';
const doc=auditSources({messages:[{id:'latest',role:'assistant',text:scene}]})[0];
function answer(d) {
  const spans=sourcePassages(d),ref=text=>spans.find(p=>p.text.includes(text)).id;
  return {name:'Princess Nara',kind:'person',source:d.id,evidence:ref('Nara rose.'),
    shown:'An invented paraphrase must never replace selected original evidence.',
    identityFacts:[{text:'The fourth princess of Linden',evidence:ref('The fourth princess')}],
    facts:[{key:'hair',value:'silver',evidence:ref('She had silver hair.')} ]};
}
const selected=answer(doc);
const parsed=sourceReviewResult(JSON.stringify({checked:[doc.id],people:[selected]}),[doc]);
assert.deepEqual(parsed.problems,[]);
const receipt=parsed.receipts[doc.id];
assert.equal(receipt.people[0].shown,'Nara rose. Her woman followed.\n\n');
assert.equal(receipt.people[0].facts[0].shown,sourcePassages(doc).at(-1).text);
assert(!receipt.people[0].shown.includes('Princess'),'A valid canonical title need not be repeated in the identity passage.');
assert.equal(peopleSourceIndex({characters:{'Princess Nara':{core:'The fourth princess'}}},[doc],[{...receipt.people[0],source:doc.id}])[0].sources[0].id,doc.id,'Selected original references remain fetchable even without the canonical title wording.');
assert.equal(sourcePassages(doc).map(p=>p.text).join(''),doc.text,'The model sees the complete unmodified source once.');
const long={...doc,text:'A'.repeat(1800)+'\r\n\r\n'+'B'.repeat(1700)};
assert.equal(sourcePassages(long).map(p=>p.text).join(''),long.text,'Long paragraphs and CRLF lose no characters.');
const spanning=sourceReviewResult(JSON.stringify({checked:[doc.id],people:[{...selected,evidence:[sourcePassages(doc)[1].id,sourcePassages(doc)[2].id]}]}),[doc]);
assert(doc.text.includes(spanning.receipts[doc.id].people[0].shown),'Cross-passage evidence is one actual original span.');
const unknown=sourceReviewResult(JSON.stringify({checked:[doc.id],people:[{...selected,evidence:'not-supplied'}]}),[doc]);
assert(!unknown.receipts[doc.id],'Unknown references cannot certify a section.');
const legacy=sourceReviewResult(JSON.stringify({checked:[doc.id],people:[{name:'Princess Nara',source:doc.id,shown:'Nara rose. Her woman followed.',identityFacts:[],facts:[]}]}),[doc]);
assert(legacy.receipts[doc.id],'Legacy literal quotes retain provenance without the title wording gate.');

let calls=0,malformedFirst=false;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(_,options)=>{
  calls++;
  const body=JSON.parse(options.body);
  const original=body.messages.find(m=>String(m.content).startsWith('SOURCE DOCUMENTS\n'));
  assert(original,'This source-only recovery must not run the ledger review again.');
  const supplied=JSON.parse(original.content.slice('SOURCE DOCUMENTS\n'.length));
  assert.equal(supplied.length,1,'Already reviewed sections are not sent again.');
  assert.equal(supplied[0].passages.map(p=>p.text).join(''),scene);
  assert(!('text' in supplied[0]),'Do not duplicate the full source beside its passages.');
  const correction=body.messages.some(m=>String(m.content).startsWith('Complete the SAME source reading.'));
  if (correction) assert(body.messages.at(-1).content.includes('Do not copy quotations.'));
  const row=answer({...doc,id:supplied[0].id});
  const reply={checked:[supplied[0].id],people:[malformedFirst && !correction ? {...row,evidence:'not-supplied'} : row]};
  const content=JSON.stringify(reply);
  return new Response('data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
};
try {
  // Same-conversation recovery selects a reference, rather than copying again.
  malformedFirst=true;
  const fixed=await reviewAuditSources({connection,documents:[doc],mode:'all'});
  assert.equal(calls,2);assert.equal(fixed.read,1);assert.deepEqual(fixed.pending,[]);
  malformedFirst=false;calls=0;
  assert.equal((await reviewAuditSources({connection,documents:[doc],previous:fixed.cache,mode:'all'})).calls,0);

  const story=await db.stories.create({title:'Existing completed ledger with one unfinished source'});
  const introduction='Nara is the fourth princess of Linden. She has silver hair.';
  await db.messages.append(story.id,{role:'user',text:introduction});
  await db.messages.append(story.id,{role:'assistant',text:scene});
  const history=await db.messages.list(story.id),documents=auditSources({messages:history});
  let state={...emptyState(),sheet:{playerName:'Keir',playerAliases:[],actors:{}},characters:{'Princess Nara':{core:'The fourth princess of Linden'}},canon:{'Princess Nara':{facts:[{key:'hair',value:'silver'}]}},
    auditSources:{[documents[0].id]:{mark:documents[0].mark,appearanceReviewed:true,profileReviewed:1,people:[{
      name:'Princess Nara',kind:'person',shown:introduction,
      identityFacts:[{text:'The fourth princess of Linden',shown:introduction}],facts:[{key:'hair',value:'silver',shown:introduction}]
    }]}}};
  await saveState(story.id,state);state=await loadState(story.id);
  const rows=ledgerVerificationRows(state);
  const verification={source:ledgerRepairInputKey({},story,history),ledger:ledgerRepairStateKey(state),read:rows.length,total:rows.length,
    entries:Object.fromEntries(rows.map(r=>[r.id,{print:r.print,scope:r.scope,status:'correct',why:'The actual ledger was already reviewed.'}])),profiles:{}};
  state.audit={verification,coverage:{read:1,total:2},finalReview:{status:'ok'},pending:['One source response remains unfinished.'],unresolved:[],unfinished:true,
    pausedPolicy:2,pausedInput:ledgerRepairInputKey(state,story,history)};
  state.audit.checkpoint=saveAuditCheckpoint(state,story,documents,verification);
  assert.equal(LEDGER_REPAIR_POLICY,3);assert(ledgerRepairNeeded(state,{},story,history),'The paused preceding procedure can resume once.');
  await saveState(story.id,state);
  const result=await auditLedger({connection,storyId:story.id,reviewSources:'all'});
  assert(result);assert.equal(result.unfinished,false,JSON.stringify(result.pending));assert.equal(calls,1,'One normal source call, zero repeated ledger calls.');
  const landed=await loadState(story.id);
  assert.equal(landed.audit.finalReview.retained,true);assert.equal(landed.audit.finalReview.calls,0);
  assert.equal(landed.audit.coverage.read,2);assert.equal(landed.audit.verification.read,landed.audit.verification.total);
  assert(ledgerAuditVerified(landed,story,history));assert(!ledgerRepairNeeded(landed,{},story,history),'Unchanged reopen owes no more audit.');
  assert.equal((await db.messages.list(story.id))[1].text,scene);
  console.log('M717 passed: original passage references handle canonical titles, pronouns and dialogue; one source call finishes a paused source-only audit with retained ledger approval and no review owed on reopen. Unknown references stay unverified; focused correction and exact original preservation work.');
} finally {globalThis.fetch=originalFetch;}
