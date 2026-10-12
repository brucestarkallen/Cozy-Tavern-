import { fingerprint36 } from '../engine/fingerprint.js';
import { pageText } from '../assemble/stack.js';
import { auditSources } from './auditsources.js';
// Factual completion is tied to this contract, never a theme/build release.
const AUDIT_INPUT_VERSION = 1;
// A changed repair procedure can resume an old paused failure once, without
// invalidating completed factual audits merely because an app release changed.
export const LEDGER_REPAIR_POLICY = 7;
// Fixed legacy formats, so skipping a future app release does not erase an
// already completed M713/M714 review. New receipts never include app VERSION.
const LEGACY_REVIEW_RELEASES = ['m713-001','m714-001'];
import { sourceAppearanceFacts,sourceIdentityFacts } from './appearanceinventory.js';

export function ledgerRepairStateKey(state) {
  // Identical values stay reviewed when only timestamps/history metadata move.
  return fingerprint36(JSON.stringify(ledgerVerificationRows(state).map(r => [r.id,r.print,r.scope])));
}
export function ledgerRepairInputKey(state, story, pages) {
  const sources = auditSources({brief:story?.brief || '',castNotes:story?.castNotes || '',messages:pages || []});
  return sourceInputKey(sources,state);
}

function sourceInputKey(documents,state = {}) {
  return fingerprint36(JSON.stringify([AUDIT_INPUT_VERSION,documents.map(d => [d.id,d.mark,d.label.endsWith(', writer')]),ledgerRepairStateKey(state)]));
}
function legacySourceMatches(state,story,pages) {
  if (!Array.isArray(pages)) return false;
  const fields = ['sheet','clock','place','present','offscreen','characters','relationships','knowledge','canon','threads','things','bodies','factions','mode','worldBrief','lastVerdict','pendingVerdict','duel','battle','composure'];
  const emptyLedger = fingerprint36(JSON.stringify(fields.map(() => null)));
  const inputs = [story?.brief,story?.castNotes,story?.connections,pages.map(p => [p.id,p.role,p.ooc,pageText(p),p.voices || []]),emptyLedger];
  return LEGACY_REVIEW_RELEASES.some(version => state.audit?.verification?.source === fingerprint36(JSON.stringify([version,...inputs])));
}

export function verificationReceiptMatches(receipt, row) {
  return Boolean(receipt && receipt.print === row.print && receipt.scope === row.scope
    && ['correct','repair'].includes(receipt.status));
}

const CHECKPOINT_VERSION=1;
const checkpointAuthority=story=>fingerprint36(JSON.stringify([story?.brief || '',story?.castNotes || '']));
const durableSection=row=>['characters','canon'].includes(row.section);

export function reusableAuditCheckpoint(state,story,documents) {
  const checkpoint=state.audit?.checkpoint;
  if (checkpoint?.version!==CHECKPOINT_VERSION || checkpoint.authority!==checkpointAuthority(story)) return {entries:{},profiles:{}};
  const marks=new Map(documents.map(d=>[d.id,d.mark]));
  const reusable=(receipt,row)=>receipt?.print===row.print && receipt.scope===row.scope
    && receipt.dependencies?.length && receipt.dependencies.every(([id,mark])=>marks.get(id)===mark);
  const entries={},profiles={};
  for (const row of ledgerVerificationRows(state).filter(durableSection)) {
    const receipt=checkpoint.entries?.[row.id],partial=checkpoint.profiles?.[row.id];
    if (reusable(receipt,row) && verificationReceiptMatches(receipt,row)) entries[row.id]=receipt;
    if (reusable(partial,row)) profiles[row.id]=partial;
  }
  return {entries,profiles};
}

export function auditCheckpointStart(state,story,documents,pages,latest) {
  const checkpoint=state.audit?.checkpoint;
  if (checkpoint?.version!==CHECKPOINT_VERSION || checkpoint.authority!==checkpointAuthority(story) || !checkpoint.completedThrough) return 0;
  const marks=new Map(documents.map(d=>[d.id,d.mark]));
  if (!Object.entries(checkpoint.scanned || {}).length || Object.entries(checkpoint.scanned).some(([id,mark])=>marks.get(id)!==mark)) return 0;
  const through=pages.findIndex(p=>p.id===checkpoint.completedThrough),end=pages.findIndex(p=>p.id===latest?.id);
  return through>=0 && end>=0?Math.min(through+1,end):0;
}

export function saveAuditCheckpoint(state,story,documents,verification) {
  const entries={},profiles={};
  const originals=new Map(documents.map(d=>[d.id,d]));
  for (const row of ledgerVerificationRows(state).filter(durableSection)) {
    const add=(receipt,book)=>{
      if (!receipt) return;
      const refs=new Set((row.value?.appearanceSources || []).flatMap(f=>f.references || [f.source]));
      for (const f of row.value?.identitySources || []) refs.add(f.source);
      for (const id of receipt.sourceRefs || []) refs.add(id);
      const quotes=[receipt.shown,...(receipt.physicalFacts || []).map(f=>f.shown),...(receipt.appearance || []).map(f=>f.shown),...(receipt.identity || []).map(f=>f.shown)].filter(Boolean);
      for (const [id] of receipt.dependencies || []) refs.add(id);
      for (const quote of quotes) for (const d of documents) if (d.text.includes(quote)) refs.add(d.id);
      const dependencies=[...refs].filter(id=>originals.has(id)).map(id=>[id,originals.get(id).mark]);
      if (dependencies.length) book[row.id]={...receipt,dependencies};
    };
    if (verificationReceiptMatches(verification.entries?.[row.id],row)) add(verification.entries[row.id],entries);
    add(verification.profiles?.[row.id],profiles);
  }
  const prior=state.audit?.checkpoint;
  const completed=verification.read===verification.total;
  const last=[...documents].reverse().find(d=>d.id.startsWith('page:') && d.label.endsWith(', story'));
  return {version:CHECKPOINT_VERSION,authority:checkpointAuthority(story),at:Date.now(),entries,profiles,
    completedThrough:completed && last?last.id.slice(5,last.id.lastIndexOf(':')):prior?.completedThrough,
    scanned:completed?Object.fromEntries(documents.map(d=>[d.id,d.mark])):prior?.scanned,
    source:completed?sourceInputKey(documents):prior?.source};
}

// Actual outstanding work must decrease. Rephrasing ledger text is not closure.
export function repairRetryCheckpoint(before, after, story, pages) {
  // Worker-created voices are checked evidence, but cannot reset retry progress.
  const source = ledgerRepairInputKey({}, story, (pages || []).map(p => ({ ...p, voices: [] })));
  const previous = before.audit?.retryProgress;
  const count = state => (state.audit?.pending || []).length;
  const currentSource = ledgerRepairInputKey({},story,pages);
  const currentEntries = state => state.audit?.verification?.source === currentSource
    ? ledgerVerificationRows(state).filter(row => verificationReceiptMatches(state.audit.verification.entries?.[row.id],row)) : [];
  const factProgress=state=>{
    if (state.audit?.verification?.source!==currentSource) return 0;
    const verification=state.audit.verification;
    return ledgerVerificationRows(state).filter(row=>row.section==='characters').reduce((total,row)=>{
      const ids=[...(row.value?.appearanceSources || []),...(row.value?.identitySources || [])].map(f=>f.id);
      if (verificationReceiptMatches(verification.entries?.[row.id],row)) return total+ids.length;
      const partial=verification.profiles?.[row.id];
      if (partial?.print!==row.print || partial?.scope!==row.scope) return total;
      const done=new Set([...(partial.appearance || []),...(partial.identity || [])].map(f=>f.id));
      return total+ids.filter(id=>done.has(id)).length;
    },0);
  };
  const read = state => (Number(state.audit?.coverage?.read) || 0) + currentEntries(state).length + factProgress(state);
  const old = previous?.source === source ? previous : {
    source, bestPending: count(before), bestRead: read(before), stalled: 0,
  };
  const beforeEntries = new Map(currentEntries(before).map(row => [row.id,row.print]));
  const newlyVerified = currentEntries(after).some(row => beforeEntries.get(row.id) !== row.print);
  const improved = count(after) < old.bestPending || read(after) > old.bestRead || newlyVerified;
  return { source, bestPending: Math.min(old.bestPending, count(after)),
    bestRead: Math.max(old.bestRead, read(after)), stalled: improved ? 0 : old.stalled + 1 };
}
export function auditHasOpenWork(audit) {
  return Boolean(audit?.unfinished || audit?.pending?.length || audit?.unresolved?.length);
}

// Older completed reviews can prove their original inputs through the saved
// source scratchbook. No rescan just to change a version-dependent hash.
export function matchingAuditSourceCheckpoint(state, story, documents, pages = null) {
  const c = state?.audit?.checkpoint;
  if (c?.version !== CHECKPOINT_VERSION || c.authority !== checkpointAuthority(story)) return false;
  if (JSON.stringify(Object.entries(c.scanned || {})) !== JSON.stringify(documents.map(d => [d.id,d.mark]))) return false;
  if (c.source ? c.source !== sourceInputKey(documents) : !legacySourceMatches(state,story,pages)) return false;
  const last = [...documents].reverse().find(d => d.id.startsWith('page:') && d.label.endsWith(', story'));
  return Boolean(last && c.completedThrough === last.id.slice(5,last.id.lastIndexOf(':')));
}
export function ledgerAuditVerified(state, story, pages) {
  const audit = state?.audit;
  if (!audit?.verifiedInput || auditHasOpenWork(audit) || !audit.coverage
    || audit.coverage.read < audit.coverage.total || !audit.verification) return false;
  if (!ledgerVerificationRows(state).every(row => verificationReceiptMatches(audit.verification.entries?.[row.id],row))) return false;
  if (audit.verification.source === ledgerRepairInputKey({},story,pages)
    && audit.verification.ledger === ledgerRepairStateKey(state)
    && audit.verifiedInput === ledgerRepairInputKey(state,story,pages)) return true;
  return matchingAuditSourceCheckpoint(state,story,auditSources({brief:story?.brief || '',castNotes:story?.castNotes || '',messages:pages || []}),pages);
}
export function ledgerRepairNeeded(state, shelf = {}, story = null, pages = null, every = 1) {
  if (story && pages && ledgerAuditVerified(state,story,pages)) return false;
  if (story && pages && state?.audit?.pausedPolicy === LEDGER_REPAIR_POLICY
    && state?.audit?.pausedInput === ledgerRepairInputKey(state,story,pages)) return false;
  if ([shelf.auditor,shelf.world].some(r => r?.detail === 'stopped by hand')) return false;
  const audit = state?.audit;
  const turns = (pages || []).filter(m => m.role === 'assistant' && !m.hidden).length;
  const due = turns > 0 && turns % Math.max(1,every) === 0;
  return (due && story && pages && !ledgerAuditVerified(state,story,pages)) || !audit?.coverage
    || audit.coverage.read < audit.coverage.total
    || Boolean(audit.unfinished || audit.pending?.length || shelf.auditor?.ok === false || shelf.auditor?.unfinished);
}

// Every semantic ledger entry is visible even when the prose renderer leans it.
// History/timestamps are bookkeeping, not a replacement for checking the value.
export function ledgerVerificationRows(state) {
  const rows = [];
  const appearance = sourceAppearanceFacts(state);
  const identities=sourceIdentityFacts(state);
  // A biography edit does not erase somebody else's completed review. Identity
  // merges and physical scene changes do invalidate the entries they affect.
  const identity = fingerprint36(JSON.stringify([state?.sheet?.playerName,state?.sheet?.playerAliases || [],
    Object.entries(state?.characters || {}).map(([name,p]) => [name,p.aliases || []])]));
  const ground = [state?.clock?.minutes,state?.place || null];
  const poses = (state?.present || []).map(p => ({name:p.name,position:p.position || '',attire:p.attire || ''}));
  const scene = fingerprint36(JSON.stringify([identity,ground,state?.mode,poses]));
  const personIdentity=name=>[name,state?.characters?.[name]?.aliases || [],state?.sheet?.playerName,state?.sheet?.playerAliases || []];
  const scopeOf = (section,name) => ['scene','presence','offscreen','characterState'].includes(section) ? scene
    : ['characters','canon'].includes(section)?fingerprint36(JSON.stringify(personIdentity(name))):identity;
  const add = (section, name, value, judgment = false) => {
    const id = section + ':' + name;
    // A later page repeating an already known fact adds provenance, not a new
    // appearance to approve. Preserve the full references for the reader/book.
    const printed=section==='characters' && value?{...value,appearanceSources:(value.appearanceSources || []).map(({references,...fact})=>fact)}:value;
    rows.push({ id, section, name, value, judgment, scope:scopeOf(section,name),print: fingerprint36(JSON.stringify(printed)) });
  };
  const semantic = value => {
    if (Array.isArray(value)) return value.map(semantic);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([k]) => !['atTurn', 'updatedAtTurn', 'atMinutes', 'sinceMinutes', 'checkedMinutes', 'ts', 'history'].includes(k)).map(([k,v]) => [k,semantic(v)]));
  };
  add('scene', 'clock', semantic(state?.clock));
  add('scene', 'place', state?.place || null);
  add('scene', 'mode', state?.mode || {});
  add('scene', 'roster', (state?.present || []).map(p => p.name));
  for (const p of state?.present || []) add('presence', p.name, {position:p.position || '',attire:p.attire || ''});
  for (const section of ['offscreen','characters','relationships','knowledge','canon','things','bodies','factions']) {
    const entries = Object.entries(state?.[section] || {});
    if (!entries.length) add(section, '(empty)', null, true);
    for (const [name, entry] of entries) {
      const value = section === 'characters'
        ? {...Object.fromEntries(['core','coreOrigin','aliases','retired'].filter(k => entry?.[k] !== undefined).map(k => [k,entry[k]])),hand:{core:entry?.hand?.core || false},physicalFacts:semantic(state.canon?.[name] || null),appearanceSources:appearance.filter(f => f.name === name),identitySources:identities.filter(f=>f.name===name)}
        : semantic(entry);
      add(section, name, value, ['offscreen','relationships','factions'].includes(section));
      if (section==='characters') add('characterState',name,semantic({state:entry?.state || '',arc:entry?.arc || '',threads:entry?.threads || [],hand:entry?.hand || {}}));
    }
  }
  for (const t of state?.threads || []) add('threads', t.title, semantic(t), true);
  if (!state?.threads?.length) add('threads', '(empty)', null, true);
  add('rules', 'sheet', semantic(state?.sheet || {}), true);
  add('rules', 'worldBrief', semantic(state?.worldBrief || null), true);
  add('rules', 'lastVerdict', semantic(state?.lastVerdict || null), true);
  for (const field of ['pendingVerdict','duel','battle','composure']) add('rules', field, semantic(state?.[field] ?? null), true);
  return rows;
}
