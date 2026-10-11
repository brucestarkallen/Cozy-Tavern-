import assert from 'node:assert/strict';
import { auditHasOpenWork, repairRetryCheckpoint } from '../../js/agents/auditprogress.js';
import { auditorRepairScope } from '../../js/agents/auditor.js';
const state = n => ({audit: { pending: Array.from({length:n}, (_,i)=>'finding '+i), coverage: {read:67,total:67} }});
assert(auditHasOpenWork(state(2).audit));
assert(!auditHasOpenWork({pending:[],unfinished:false}));
const story = {brief:'same story'}, pages = [{role:'assistant',text:'same page'}];
let before = state(1);
for (const n of [2,1]) {
 const after = state(n);
 after.present = [{name:'Commodus',position:n===1?'the rail':'at the rail'}];
 after.audit.retryProgress = repairRetryCheckpoint(before,after,story,pages);
 before = after;
}
assert.equal(before.audit.retryProgress.stalled,2);
const improved = repairRetryCheckpoint(before,state(0),story,pages);
assert.equal(improved.stalled,0);
const newPage = repairRetryCheckpoint(before,state(1),story,[{role:'assistant',text:'new page'}]);
assert.equal(newPage.stalled,1);
const quote = 'Commodus stood at the rail.';
const issues = [{what:'missing',mutations:[{type:'presence.enter',name:'Commodus',shown:quote}]}];
assert.equal(auditorRepairScope(issues,{}, {sources:quote,sceneSource:'The room was empty.'})[0].mutations.length,0);
assert.equal(auditorRepairScope(issues,{}, {sources:quote,sceneSource:quote})[0].mutations.length,1);
console.log('PASS open findings, 1/2/1 retry cycle, new evidence reset, newest scene quote scope.');
