/* Local health inventory. Recovery belongs to the existing queues, not the lamp. */
import {ledgerAuditVerified} from './auditprogress.js';
import {historicalAdvisoryView} from './continuous.js';

// A historical run is evidence of that attempt, not the current audit result.
// Reconcile only the auditor's own factual work; another worker's failed
// simulation/transport cannot be certified by an unrelated successful audit.
export function reconciledWorkerStatus(shelf,state,story,pages) {
  const audit=state?.audit;
  if (!Number.isFinite(audit?.at) || !ledgerAuditVerified(state,story,pages)) return shelf;
  let out=shelf;
  for (const name of ['auditor','world']) {
    const row=shelf?.[name];
    if (!row || !(row.ok===false || row.unfinished) || audit.at<row.at) continue;
    // Only a specifically recorded identity-only World omission can be
    // superseded by the final source audit. Other World work stays owed.
    if (name==='world') {
      if (!row.ok || !row.unfinished || !row.resume?.startsWith('voice-identities:')) continue;
      const id=row.resume.slice('voice-identities:'.length),page=pages.find(p=>p.id===id);
      if (!page?.voices?.length || page.voices.some((v,index)=>!state.auditSources?.['voice:'+id+':'+index+':0'])) continue;
    }
    out={...out,[name]:{...row,ok:true,unfinished:false,why:'',resume:'',
      detail:'Current saved ledger and original sources verified after this earlier attempt.',superseded:row}};
  }
  return out;
}

export function workerRecoveryDue(checkpoint,input,now=Date.now()) {
  if (!checkpoint || checkpoint.input!==input) return 0;
  if (checkpoint.attempts>=2) return -1;
  return Math.max(0,(checkpoint.nextAt || 0)-now);
}

export function healthSnapshot({storyId,shelf={},state={},pages=[],mem={},story={},auditRead=null,
  recordBehind=false,ledgerBehind=false,verificationNeeded=false,repairOwed=false,repairPaused=false,
  guards=[],running=[],queued=0,otherOwner=false,historicalWait=-1,workerRecovery={}}={}) {
  if (pages.some(p=>p.role==='assistant' && !p.hidden && !p.ooc)) verificationNeeded ||= !ledgerAuditVerified(state,story,pages);
  shelf=reconciledWorkerStatus(shelf,state,story,pages);
  guards=guards.filter(name=>name!=='auditor' || shelf.auditor?.ok===false);
  const issues=[];
  const add=(id,owner,reason,route=null,extra={})=>issues.push({id,owner,reason,route,...extra});
  for (const name of ['keeper','extractor','scribe','world']) {
    const row=shelf[name];
    if (row && (row.ok===false || row.unfinished)) {
      const retry=workerRecovery[name];
      add('worker:'+name,name,[row.why || row.detail || 'Required worker did not complete.',retry?.reason].filter(Boolean).join(' '),
        name==='world' && row.ok && row.resume?.startsWith('voice-identities:')?(repairOwed?'auditor':null):retry?.eligible?'worker:'+name:null,{checkpoint:retry?.input,blocked:retry?.reason || '',state:row.ok===false?'failed':'unfinished'});
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
