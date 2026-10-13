import './idb-shim.mjs';
import assert from 'node:assert/strict';
import {db} from '../../js/store.js';
import {emptyState,saveState,loadState} from '../../js/engine/state.js';
import * as sourceAudit from '../../js/agents/auditsources.js';
import * as applyEngine from '../../js/engine/apply.js';
import * as peopleEngine from '../../js/engine/people.js';
import {auditLedger,parseAuditorAnswer,completeFinalAuditReply} from '../../js/agents/auditor.js';
import {healthSnapshot} from '../../js/agents/health.js';
import * as auditProgress from '../../js/agents/auditprogress.js';

const connection={type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'fixture',preset:'custom',contextSize:200000,reasoning:{effort:'off'}};
const story=await db.stories.create({title:'M732 identity contract reproduction'});
const voiceText='The feed-sack groom calls to Tarn. The off-duty guard answers. The Gate Watch is the company, not the man.';
await db.messages.append(story.id,{role:'assistant',text:'A quiet day passed at the gate.',voices:[
  {speaker:'Tarn, an off-duty guard',channel:'the gate',content:voiceText},
  {speaker:'a feed-sack groom',content:'The horses are fed.'},
  {speaker:"the queen's maid",content:'I will return with the linen.'},
  {speaker:'a scullery girl',content:'The pot is clean.'},
]});
const {auditSources,missingSourcePeople}=sourceAudit;
const pages=await db.messages.list(story.id),documents=auditSources({messages:pages});
const voice=documents.find(d=>d.id.startsWith('voice:'));
const docsByVoice=new Map(documents.filter(d=>d.id.startsWith('voice:')).map(d=>[d.id,pages[0].voices[Number(d.id.split(':').at(-2))]]));
const initial={...emptyState(),sheet:{playerName:'Keir',playerAliases:[],actors:{'Quiet Visitor':{}}},
  characters:{'a feed-sack groom':{core:''},Mira:{core:'An archivist.',hand:{core:true}},Selene:{core:'A retired guard.',retired:true,aliases:['Sela']}},
  factions:{'The Gate Watch':{stance:'holds the gate',agenda:'keep the wall'}}};
initial.auditSources=Object.fromEntries(documents.map(d=>{
  const names=d.id===voice.id?['Tarn','an off-duty guard']:
    docsByVoice.has(d.id)?[docsByVoice.get(d.id).speaker]:[];
  return [d.id,{mark:d.mark,appearanceReviewed:true,profileReviewed:1,
    people:names.map(name=>({name,kind:'person',shown:d.text,identityFacts:[],facts:[]}))}];
}));
const findings=missingSourcePeople(initial,documents.flatMap(d=>(initial.auditSources[d.id].people||[]).map(p=>({...p,source:d.id,label:d.label}))));
const rejectedTargets=['Tarn','an off-duty guard'].map(name=>{
  const finding=findings.find(i=>i.sourceId===voice.id&&i.sourceName===name);
  return {...finding,mutations:[{type:'source.resolve',sourceId:voice.id,name,to:'The Gate Watch',kind:'person',cause:'This named guard belongs to the company.'}],pendingReason:'supply the actual established person, creating a genuinely missing profile in the same answer first'};
});
const rows=auditProgress.ledgerVerificationRows(initial);
const verification={source:auditProgress.ledgerRepairInputKey(initial,story,pages),ledger:auditProgress.ledgerRepairStateKey(initial),read:rows.length,total:rows.length,
  entries:Object.fromEntries(rows.map(r=>[r.id,{print:r.print,scope:r.scope,status:'correct',why:'Previously reviewed.'}])),profiles:{}};
const seeded={...initial,audit:{coverage:{read:documents.length,total:documents.length},verification,finalReview:{status:'incomplete decisions'},
  unresolved:[...rejectedTargets,...findings.filter(i=>!rejectedTargets.some(r=>r.sourceId===i.sourceId&&r.sourceName===i.sourceName))],
  pending:[...findings.map(i=>i.what),...rejectedTargets.map(i=>i.what+': rejected')],unfinished:true,pausedPolicy:7,
  retryProgress:{stalled:2,bestPending:10,bestRead:645}}};
seeded.audit.pausedInput=auditProgress.ledgerRepairInputKey(seeded,story,pages);
seeded.audit.checkpoint=auditProgress.saveAuditCheckpoint(seeded,story,documents,verification);
await saveState(story.id,seeded);

const invalidReply={identities:[
  {sourceId:voice.id,name:'Tarn',to:'The Gate Watch',kind:'person',why:'The groom calls him Tarn, but he is a local unnamed guard covered by the group and has no separate People page.'},
  {sourceId:voice.id,name:'an off-duty guard',to:'The Gate Watch',kind:'person',why:'He is a local unnamed individual covered by the group.'},
],review:{status:'complete',why:'The source identity review is complete.',open:[]},standings:[]};
const correctedReply={profiles:[{name:'Tarn',open:true},{name:"the queen's maid",open:true}],identities:[
  {sourceId:voice.id,name:'Tarn',to:'Tarn',kind:'person',why:'The source names this individual Tarn.'},
  {sourceId:voice.id,name:'an off-duty guard',to:'Tarn',kind:'person',why:'The same passage identifies this guard as Tarn.'},
  {sourceId:documents.find(d=>d.id.startsWith('voice:')&&d!==voice).id,name:'a feed-sack groom',to:'a feed-sack groom',kind:'person',why:'This is the already tracked individual.'},
  {sourceId:documents.find(d=>d.id.includes(':2:')).id,name:"the queen's maid",to:"the queen's maid",kind:'person',why:'The source establishes a distinct continuing maid but no biography.'},
  {sourceId:documents.find(d=>d.id.includes(':3:')).id,name:'a scullery girl',kind:'person',scope:'local',why:'This source establishes a distinct temporary speaker and no continuing identity.'},
],review:{status:'complete',why:'Every source mention now has a supported saved disposition.',open:[]},standings:[]};
const partialReply={profiles:[{name:"the queen's maid",open:true}],identities:[
  {sourceId:documents.find(d=>d.id.includes(':2:')).id,name:"the queen's maid",to:"the queen's maid",kind:'person',why:'This source establishes a distinct continuing maid but no biography.'},
  ...invalidReply.identities,
],review:{status:'complete',why:'The saved maid decision is supported; the other bindings still need correction.',open:[]},standings:[]};
const originalFetch=globalThis.fetch;
let calls=0,mode='repeat',correction='';
const supportedCorrection=text=>[
  'profiles:[{"name":', '"scope":"local"', '"kind":"group"', 'review.open',
  'engineEligibleTargets',
].every(part=>text.includes(part));
const stream=body=>new Response('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify(body)}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
globalThis.fetch=async(_,options)=>{
  calls++;
  const request=JSON.parse(options.body),messages=request.messages;
  assert(!JSON.stringify(messages).includes('SOURCE DOCUMENTS'));
  const continued=messages.some(m=>m.role==='assistant');
  if(!continued) return stream(invalidReply);
  correction=messages.at(-1).content;
  if(mode==='corrected'&&supportedCorrection(correction)) return stream(correctedReply);
  if(mode==='partial') return stream(partialReply);
  return stream(invalidReply);
};
try {
  const invalid=parseAuditorAnswer(JSON.stringify(invalidReply)).issues.flatMap(i=>i.mutations).filter(m=>m.type==='source.resolve');
  assert.equal(invalid[0].scope,undefined,'rationale language must not silently supply local scope');
  assert.equal(invalid[0].to,'The Gate Watch');
  const factionAttempt=applyEngine.applyMutations(seeded,[{type:'source.resolve',sourceId:voice.id,name:'Tarn',to:'The Gate Watch',kind:'person',cause:'Membership alone is not identity.',auditorApproved:true,source:'auditor'}]);
  assert.equal(factionAttempt.applied.length,0);
  assert.match(factionAttempt.rejected[0].why,/actual established person/);
  const groupSource=structuredClone(seeded);
  groupSource.auditSources[voice.id].people.push({name:'The Gate Watch',kind:'person'});
  const groupAttempt=applyEngine.applyMutations(groupSource,[{type:'source.resolve',sourceId:voice.id,name:'The Gate Watch',kind:'group',cause:'The source refers to the company.',auditorApproved:true,source:'auditor'}]);
  assert.equal(groupAttempt.applied.length,1,'a supported nonperson classification is an executable source decision');
  assert.equal(groupAttempt.state.auditSources[voice.id].people.at(-1).kind,'group');
  assert.deepEqual(groupAttempt.state.factions,seeded.factions,'classifying a source mention does not alter or absorb the existing group');
  const aliasAttempt=applyEngine.applyMutations(seeded,[{type:'source.resolve',sourceId:voice.id,name:'Tarn',to:'Sela',kind:'person',cause:'An established alias.',auditorApproved:true,source:'auditor'}]);
  assert.equal(aliasAttempt.applied.length,1);
  assert.equal(aliasAttempt.state.auditSources[voice.id].people.find(p=>p.name==='Tarn').ledgerName,'Selene');
  const actorAttempt=applyEngine.applyMutations(seeded,[{type:'source.resolve',sourceId:voice.id,name:'Tarn',to:'Quiet Visitor',kind:'person',cause:'An established tracked actor.',auditorApproved:true,source:'auditor'}]);
  assert.equal(actorAttempt.applied.length,1);
  assert.equal(actorAttempt.state.auditSources[voice.id].people.find(p=>p.name==='Tarn').ledgerName,'Quiet Visitor');
  const unresolvedReply=parseAuditorAnswer(JSON.stringify({review:{status:'complete',why:'The relationship cannot be established.',open:[{id:'identity:guard',why:'The original does not show whether this is the same continuing person.'}]},standings:[]}));
  assert(completeFinalAuditReply(unresolvedReply,[{id:'identity:guard'}]),'an explicit open finding is a valid unresolved decision, not green');

  mode='repeat';calls=0;
  const blocked=await auditLedger({connection,storyId:story.id,reviewSources:'all'});
  const blockedState=await loadState(story.id);
  console.log('M732 repeated invalid response:',JSON.stringify({calls,pending:blocked.pending.length,finalReview:blockedState.audit.finalReview.status,
    invalidBindings:blockedState.audit.unresolved.flatMap(i=>i.mutations||[]).filter(m=>m.type==='source.resolve'&&m.to==='The Gate Watch').length,
    correctionHasLocalForm:correction.includes('"scope":"local"')}));
  assert(supportedCorrection(correction),'the M731 corrective continuation omits executable identity decisions');
  assert.equal(peopleEngine.sourceIdentityTargetKey(seeded,'The Gate Watch'),'','faction membership is not an individual person target');
  const eligible=peopleEngine.sourceIdentityTargetChoices(seeded);
  assert(eligible.includes('Quiet Visitor'),'tracked actor target appears in the actual operation registry');
  assert(eligible.includes('Selene'),'retired aliases resolve to their canonical target');
  assert(!eligible.includes('The Gate Watch'),'faction names are context, not source.resolve person targets');
  assert.equal(auditProgress.LEDGER_REPAIR_POLICY,9);
  assert(auditProgress.ledgerRepairNeeded(seeded,{},story,pages),'paused M731 work resumes under the changed repair policy');
  assert(blocked.unfinished,'the repeated unavailable target stays unresolved');
  assert.equal(calls,2,'the existing single corrective continuation remains bounded');
  assert.equal(blockedState.audit.finalReview.status,'incomplete decisions');
  assert(blockedState.audit.unresolved.some(i=>(i.mutations||[]).some(m=>m.type==='source.resolve'&&m.to==='The Gate Watch'&&i.pendingReason==='supply the actual established person, creating a genuinely missing profile in the same answer first')),
    'the unavailable historical operation remains visible while no saved disposition exists');
  assert.equal(blockedState.auditSources[voice.id].people.find(p=>p.name==='Tarn').identityResolution,undefined,
    'a rationale mentioning local does not automatically create a local resolution');
  assert.equal(healthSnapshot({state:blockedState,story,pages}).status,'yellow');

  await saveState(story.id,seeded);mode='partial';calls=0;
  const partial=await auditLedger({connection,storyId:story.id,reviewSources:'all'});
  const partialState=await loadState(story.id);
  assert(partial.unfinished,'one valid independent correction does not hide remaining failures');
  assert.equal(partialState.auditSources[documents.find(d=>d.id.includes(':2:')).id].people[0].ledgerName,"the queen's maid");
  assert.equal(partialState.characters["the queen's maid"].core,'','a supported identity can be created without invented biography');
  assert(partialState.audit.unresolved.some(i=>(i.mutations||[]).some(m=>m.type==='source.resolve'&&m.to==='The Gate Watch')));
  assert.equal(healthSnapshot({state:partialState,story,pages}).status,'yellow');

  await saveState(story.id,seeded);mode='corrected';calls=0;
  const settled=await auditLedger({connection,storyId:story.id,reviewSources:'all'});
  const saved=await loadState(story.id);
  assert(supportedCorrection(correction),'the production continuation must present every executable identity form before the scripted correction responds');
  assert(correction.includes(sourceAudit.SOURCE_IDENTITY_DECISION_GUIDANCE),'generated findings and correction share the exact identity decision contract');
  assert(correction.includes(voiceText),'the focused correction includes the original source passage');
  assert(correction.includes('supply the actual established person'),'the engine rejection is included in the source specific blocker');
  const targetsMatch=correction.match(/"engineEligibleTargets":(\[[^\]]*\])/);
  assert(targetsMatch,'correction lists the exact targets accepted by the operation engine');
  const targets=JSON.parse(targetsMatch[1]);
  assert(targets.includes('Quiet Visitor')&&targets.includes('Selene')&&targets.includes('a feed-sack groom'));
  assert(!targets.includes('The Gate Watch'));
  assert(correction.includes('"groupsForContext":["The Gate Watch"]'));
  assert.equal(settled.unfinished,false,JSON.stringify(settled.pending));
  assert.equal(calls,2,'source receipts and completed ledger checks are reused; only the existing review and its continuation run');
  assert.equal(saved.audit.coverage.read,documents.length);
  assert.equal(saved.audit.finalReview.sourceCalls,0);
  assert.equal(saved.audit.finalReview.status,'ok');
  assert(auditProgress.ledgerAuditVerified(saved,story,pages));
  assert.equal(saved.auditSources[voice.id].people.find(p=>p.name==='Tarn').ledgerName,'Tarn');
  assert.equal(saved.auditSources[voice.id].people.find(p=>p.name==='an off-duty guard').ledgerName,'Tarn');
  assert.equal(saved.auditSources[documents.find(d=>d.id.includes(':2:')).id].people[0].ledgerName,"the queen's maid");
  const savedTarn=saved.auditSources[voice.id].people.find(p=>p.name==='Tarn');
  assert.equal(savedTarn.shown,voice.text,'source quotation remains byte for byte unchanged');
  assert.deepEqual(savedTarn.facts,[],'source physical facts remain intact');
  assert.deepEqual(savedTarn.identityFacts,[],'source identity facts remain intact');
  assert.equal(saved.auditSources[voice.id].mark,seeded.auditSources[voice.id].mark,'source receipt mark is preserved');
  assert.equal(saved.auditSources[documents.find(d=>d.id.includes(':3:')).id].people[0].identityResolution.scope,'local');
  const savedScullery=saved.auditSources[documents.find(d=>d.id.includes(':3:')).id].people[0];
  assert.equal(savedScullery.shown,documents.find(d=>d.id.includes(':3:')).text,'local decision preserves the full source passage');
  assert.deepEqual(saved.auditSources[documents.find(d=>d.id.includes(':3:')).id].mark,seeded.auditSources[documents.find(d=>d.id.includes(':3:')).id].mark);
  const oldScullery=seeded.auditSources[documents.find(d=>d.id.includes(':3:')).id].people[0];
  assert.deepEqual(savedScullery.facts,oldScullery.facts);
  assert.deepEqual(savedScullery.identityFacts,oldScullery.identityFacts);
  assert.equal(saved.characters.Tarn.core,'');
  assert.equal(saved.characters["the queen's maid"].core,'');
  assert.equal(saved.characters['a feed-sack groom'].core,'');
  assert.deepEqual(saved.factions,seeded.factions,'the group remains distinct from its individual member');
  assert.equal(saved.characters.Mira.core,seeded.characters.Mira.core);
  assert.deepEqual(saved.characters.Mira.hand,seeded.characters.Mira.hand);
  assert.deepEqual(await db.messages.list(story.id),pages,'the saved story prose and voices remain unchanged');
  assert.equal(saved.audit.unresolved.length,0,'both original identity allegations and obsolete rejected operations close against saved source dispositions');
  assert(!saved.audit.unresolved.some(i=>(i.mutations||[]).some(m=>m.type==='source.resolve'&&m.to==='The Gate Watch')),
    'an obsolete rejected target no longer blocks a different saved source disposition');
  assert.equal(saved.audit.identityDispositionHistory?.length,2,'superseded rejected operations remain inspectable history');
  assert(saved.audit.identityDispositionHistory.every(i=>i.attemptedTarget==='The Gate Watch'&&i.savedTarget==='Tarn'));
  const callsBeforeRepeat=calls;
  assert.equal((await auditLedger({connection,storyId:story.id,reviewSources:'all'})).unfinished,false);
  assert.equal(calls,callsBeforeRepeat,'unchanged verified work creates no new model call');
  assert.equal(healthSnapshot({state:saved,story,pages}).status,'green','shared health reflects the verified saved state');
  const undone=applyEngine.undoLast(saved);
  assert(undone.applied || undone.state,'source decisions retain the existing undo path');
  assert(!auditProgress.ledgerAuditVerified(undone.state,story,pages),'undo cannot leave the old audit completion falsely verified');
  assert.equal(healthSnapshot({state:undone.state,story,pages}).status,'yellow','undo invalidates the shared green health result');
  console.log('PASS M732: invalid M731 shape, actionable bounded correction, partial recovery, saved existing/new/local/group decisions, obsolete rejection history, cached review, reload, unchanged repeat, health and undo. Scripted provider with disposable IndexedDB.');
} finally {globalThis.fetch=originalFetch;}
