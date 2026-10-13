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

/* M752: THE LEDGER WAITS FOR VERIFICATION ONLY WHERE AN AUDIT IS OWED. "Not verified" was asked of every tale: with the
 * auditor switched off, or this story's readers off, nothing will ever verify it — a yellow lamp for good, with no one
 * to send (the keeper-off record's fault, M675); and with the auditor reading every few pages (auditEvery), every page
 * between two audits turned the lamp yellow too. Owed is what the auditor acts on: its switch and the readers on, and a
 * page it reads on (every Nth storyteller page, as the chain's own auditor link counts them) or a ledger never audited.
 * A finished audit's open findings, its unread sources and its pause stay their own issues. */
export function verificationOwed({state={},story={},pages=[],auditEnabled=true,auditEvery=1}={}) {
  if (!auditEnabled || !pages.some(p=>p.role==='assistant' && !p.hidden && !p.ooc)) return false;
  if (ledgerAuditVerified(state,story,pages)) return false;
  const told=pages.filter(p=>p.role==='assistant' && !p.hidden).length;
  return told%Math.max(1,Math.round(Number(auditEvery)) || 1)===0 || !state?.audit?.coverage;
}

/* M250, M248, M668 — THE LAMP SAYS WHO, AND THAT NOTHING IS LOST. Its words named the reader that fell over and said the
 * pages were safe ("keeper stumbled; the pages are safe and will be folded when it comes back"), or that it would carry on by
 * itself ("scribe stopped partway; it will carry on by itself"), and named the check that failed on the newest page ("the
 * second reader did not finish on the newest page; the story is safe, and it is asked again on the next"). M727 put these
 * reasons on the lamp in their place, holding only the worker's own why ("could not reach the storyteller"): which reader
 * had fallen over, and that his pages were safe, went unsaid — and the why ran on into the retry's sentence with no stop. */
const ownWhy=row=>String(row?.why || row?.detail || '').trim().replace(/[\s.;:,]+$/u,'');
const saidWith=(words,row)=>{const why=ownWhy(row);return words+(why?' ('+why+')':'')+'.';};
const GUARD_NAMES={continuity:'the second reader',auditor:'the auditor'};

export function healthSnapshot({storyId,shelf={},state={},pages=[],mem={},story={},auditRead=null,
  recordBehind=false,ledgerBehind=false,verificationNeeded=false,repairOwed=false,repairPaused=false,
  guards=[],running=[],queued=0,otherOwner=false,historicalWait=-1,workerRecovery={},
  auditEnabled=true,auditEvery=1,recordWait=0,ledgerWait=0}={}) {
  verificationNeeded ||= verificationOwed({state,story,pages,auditEnabled,auditEvery});
  shelf=reconciledWorkerStatus(shelf,state,story,pages);
  guards=guards.filter(name=>name!=='auditor' || shelf.auditor?.ok===false);
  const issues=[];
  const add=(id,owner,reason,route=null,extra={})=>issues.push({id,owner,reason,route,...extra});
  for (const name of ['keeper','extractor','scribe','world']) {
    const row=shelf[name];
    if (row && (row.ok===false || row.unfinished)) {
      const retry=workerRecovery[name];
      /* M675: while the record has a gap, the keeper's work is the record's own errand (fillRecordGap: tried once, its own
       * wait between tries — a minute, two, four …). Its worker retry was sent beside it once M752 let the next owner go
       * while the record waits out its pause: a keeper that could not be reached was asked twice as often, the same pages
       * each time (walk DOM-260). The keeper's own retry is for what is not a record gap. */
      const ownedByRecord=name==='keeper' && recordBehind;
      add('worker:'+name,name,[saidWith(name+(row.ok===false?' stumbled; the pages are safe and will be folded when it comes back':' stopped partway; it will carry on by itself'),row),retry?.reason].filter(Boolean).join(' '),
        name==='world' && row.ok && row.resume?.startsWith('voice-identities:')?(repairOwed?'auditor':null):retry?.eligible && !ownedByRecord?'worker:'+name:null,{checkpoint:retry?.input,blocked:retry?.reason || '',state:row.ok===false?'failed':'unfinished'});
    }
  }
  /* M752: an owner waiting out its own pause (a fill that folded or read nothing waits a minute, two, four …, and one with
   * no connection cannot act at all) is not the one to send now. Only the first route is ever sent, so a record its keeper
   * could not fold held every other idle repair back — the ledger's missed pages, a failed worker, the auditor, the
   * continuous audit — for as long as that lasted. The issue still stands and is said; the next owner is sent meanwhile,
   * and the waiting one's own look comes back when its pause is over. */
  if (recordBehind) add('record-gap','keeper','The memory record needs current original-page coverage.',recordWait>0?null:'record');
  if (ledgerBehind) add('ledger-gap','extractor','Story pages remain unread by the ledger.',ledgerWait>0?null:'ledger');
  const audit=state.audit || {};
  if (verificationNeeded) add('verification','auditor','Current ledger verification is incomplete.',repairOwed?'auditor':null);
  /* M752: an audit cut short is unfinished only where the auditor will finish it (its switch on, this story's readers on) */
  if (auditEnabled && audit.coverage && audit.coverage.read<audit.coverage.total) add('source-coverage','auditor','Original source coverage is incomplete.',repairOwed?'auditor':null,{checkpoint:audit.coverage});
  if (auditEnabled && audit.verification && audit.verification.read<audit.verification.total) add('entry-coverage','auditor','Ledger entry receipts are incomplete.',repairOwed?'auditor':null);
  if (audit.unfinished || audit.pending?.length || audit.unresolved?.length) add('audit-findings','auditor',audit.pauseReason || (audit.pending || []).join('; ') || 'Auditor findings remain open.',repairOwed?'auditor':null);
  if (repairPaused) add('audit-paused','auditor',audit.pauseReason || 'Unchanged repair attempts are paused.');
  if (repairOwed && !issues.some(i=>i.route==='auditor')) add('audit-repair','auditor','Current evidence requires verification.','auditor');
  for (const name of guards) add('guard:'+name,name,[saidWith((GUARD_NAMES[name] || name)+' did not finish on the newest page; the story is safe, and it is asked again on the next',shelf[name]),workerRecovery[name]?.reason].filter(Boolean).join(' '),
    name==='auditor' && repairOwed?'auditor':name==='continuity' && workerRecovery[name]?.eligible?'worker:continuity':null);
  /* M752: the continuous audit reading on is progress, said in the lamp's words ("has read 12 of 300 folded pages; it reads
   * on when the house is idle", M673) and sent on by its route — never trouble by itself: counted as one, a long tale's
   * lamp went yellow between every two readings, for hours, on a story with nothing wrong in it */
  if (auditRead?.left) add('historical-coverage','continuous',auditRead.left+' folded pages await review.',historicalWait>=0?'historical':null,{progress:true});
  for (const f of auditRead?.unresolved || []) add('historical:'+(f.id || JSON.stringify([f.from,f.to,f.issue?.what])),
    'continuous',f.recovery?.reason || f.why || f.issue?.what,historicalWait>=0?'historical':null,{finding:f,state:f.recovery?.status || 'open'});
  const advisories=pages.flatMap(message=>(message.findings || []).filter(f=>f.kind==='audit').map(f=>({sourceId:message.id,...historicalAdvisoryView(f,message,mem,pages,story)})));
  const active=running.length>0 || queued>0;
  const priority=['record','ledger','worker:extractor','worker:world','worker:scribe','worker:keeper','worker:continuity','auditor','historical'];
  const routes=active || otherOwner?[]:priority.filter(route=>issues.some(i=>i.route===route));
  const troubles=issues.filter(i=>!i.progress);
  return {storyId,issues,advisories,running,queued,otherOwner,clean:troubles.length===0 && !active,
    status:active?'working':troubles.length?'yellow':'green',next:routes[0] || null,reasons:issues.map(i=>i.reason)};
}

/* M752 — WHAT THE INVENTORY ADDS TO THE LAMP. M727 painted the lamp blue ("reading this scene now") whenever anything at all
 * was running — the continuous audit too, reading older pages while the house is idle: M673's rule ("reading older pages
 * is not reading this scene" — the lamp says what is true of the scene, green when all is read and folded, and the audit
 * has its own small light) was undone, and on a long tale the lamp stayed blue for as long as the audit read on. Blue is
 * this scene's own readers at work, or the audit at work while a historical correction is open (its words: "resolving a
 * historical memory correction"); yellow is an issue that is trouble. null: the lamp's own reading stands. */
export function healthLamp(health) {
  if (!health) return null;
  if (health.status==='working') {
    const auditingAlone=health.queued===0 && health.running.length>0 && health.running.every(name=>name==='continuous');
    const resolving=health.issues.some(i=>i.owner==='continuous' && i.finding);
    return !auditingAlone || resolving ? 'working' : null;
  }
  return health.clean ? null : 'trouble';
}

export function routeHealth(snapshot,owners) {
  const owner=snapshot?.next;
  return owner && typeof owners[owner]==='function' ? owners[owner]() : null;
}
