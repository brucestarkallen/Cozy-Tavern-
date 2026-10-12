/* Local health inventory. Recovery belongs to the existing queues, not the lamp. */
import {historicalAdvisoryView} from './continuous.js';

export function workerRecoveryDue(checkpoint,input,now=Date.now()) {
  if (!checkpoint || checkpoint.input!==input) return 0;
  if (checkpoint.attempts>=2) return -1;
  return Math.max(0,(checkpoint.nextAt || 0)-now);
}

export function healthSnapshot({storyId,shelf={},state={},pages=[],mem={},story={},auditRead=null,
  recordBehind=false,ledgerBehind=false,verificationNeeded=false,repairOwed=false,repairPaused=false,
  guards=[],running=[],queued=0,otherOwner=false,historicalWait=-1,workerRecovery={}}={}) {
  const issues=[];
  const add=(id,owner,reason,route=null,extra={})=>issues.push({id,owner,reason,route,...extra});
  for (const name of ['keeper','extractor','scribe','world']) {
    const row=shelf[name];
    if (row && (row.ok===false || row.unfinished)) {
      const retry=workerRecovery[name];
      add('worker:'+name,name,[row.why || row.detail || 'Required worker did not complete.',retry?.reason].filter(Boolean).join(' '),
        retry?.eligible?'worker:'+name:null,{checkpoint:retry?.input,blocked:retry?.reason || '',state:row.ok===false?'failed':'unfinished'});
    }
  }
  if (recordBehind) add('record-gap','keeper','Original pages still need folding.','record');
  if (ledgerBehind) add('ledger-gap','extractor','Story pages remain unread by the ledger.','ledger');
  const audit=state.audit || {};
  if (verificationNeeded) add('verification','auditor','Current ledger verification is incomplete.',repairOwed?'auditor':null);
  if (audit.coverage && audit.coverage.read<audit.coverage.total) add('source-coverage','auditor','Original source coverage is incomplete.',repairOwed?'auditor':null,{checkpoint:audit.coverage});
  if (audit.verification && audit.verification.read<audit.verification.total) add('entry-coverage','auditor','Ledger entry receipts are incomplete.',repairOwed?'auditor':null);
  if (audit.unfinished || audit.pending?.length || audit.unresolved?.length) add('audit-findings','auditor',audit.pauseReason || (audit.pending || []).join('; ') || 'Auditor findings remain open.',repairOwed?'auditor':null);
  if (repairPaused) add('audit-paused','auditor',audit.pauseReason || 'Unchanged repair attempts are paused.');
  if (repairOwed && !issues.some(i=>i.route==='auditor')) add('audit-repair','auditor','Current evidence requires verification.','auditor');
  for (const name of guards) add('guard:'+name,name,[shelf[name]?.why || 'Required factual check failed.',workerRecovery[name]?.reason].filter(Boolean).join(' '),
    name==='auditor' && repairOwed?'auditor':name==='continuity' && workerRecovery[name]?.eligible?'worker:continuity':null);
  if (auditRead?.left) add('historical-coverage','continuous',auditRead.left+' folded pages await review.',historicalWait>=0?'historical':null);
  for (const f of auditRead?.unresolved || []) add('historical:'+(f.id || JSON.stringify([f.from,f.to,f.issue?.what])),
    'continuous',f.recovery?.reason || f.why || f.issue?.what,historicalWait>=0?'historical':null,{finding:f,state:f.recovery?.status || 'open'});
  const advisories=pages.flatMap(message=>(message.findings || []).filter(f=>f.kind==='audit').map(f=>({sourceId:message.id,...historicalAdvisoryView(f,message,mem,pages,story)})));
  const active=running.length>0 || queued>0;
  const priority=['record','ledger','worker:extractor','worker:world','worker:scribe','worker:keeper','worker:continuity','auditor','historical'];
  const routes=active || otherOwner?[]:priority.filter(route=>issues.some(i=>i.route===route));
  return {storyId,issues,advisories,running,queued,otherOwner,clean:issues.length===0 && !active,
    status:active?'working':issues.length?'yellow':'green',next:routes[0] || null,reasons:issues.map(i=>i.reason)};
}

export function routeHealth(snapshot,owners) {
  const owner=snapshot?.next;
  return owner && typeof owners[owner]==='function' ? owners[owner]() : null;
}
