import { fingerprint36 } from '../engine/fingerprint.js';
import { pageText } from '../assemble/stack.js';
import { VERSION } from '../version.js';

export function ledgerRepairStateKey(state) {
  const fields = ['sheet', 'clock', 'place', 'present', 'offscreen', 'characters', 'relationships', 'knowledge', 'canon', 'threads', 'things', 'bodies', 'factions', 'mode'];
  return fingerprint36(JSON.stringify(fields.map(k => state?.[k] ?? null)));
}
export function ledgerRepairInputKey(state, story, pages) {
  return fingerprint36(JSON.stringify([VERSION, story?.brief, story?.castNotes, story?.connections,
    (pages || []).map(p => [p.id, p.role, p.ooc, pageText(p), p.voices || []]), ledgerRepairStateKey(state)]));
}

// Actual outstanding work must decrease. Rephrasing ledger text is not closure.
export function repairRetryCheckpoint(before, after, story, pages) {
  const source = ledgerRepairInputKey({}, story, pages);
  const previous = before.audit?.retryProgress;
  const count = state => (state.audit?.pending || []).length;
  const read = state => Number(state.audit?.coverage?.read) || 0;
  const old = previous?.source === source ? previous : {
    source, bestPending: count(before), bestRead: read(before), stalled: 0,
  };
  const improved = count(after) < old.bestPending || read(after) > old.bestRead;
  return { source, bestPending: Math.min(old.bestPending, count(after)),
    bestRead: Math.max(old.bestRead, read(after)), stalled: improved ? 0 : old.stalled + 1 };
}
export function auditHasOpenWork(audit) {
  return Boolean(audit?.unfinished || audit?.pending?.length || audit?.unresolved?.length);
}

export function ledgerAuditVerified(state, story, pages) {
  const audit = state?.audit;
  return Boolean(audit?.verifiedInput && !auditHasOpenWork(audit) && audit.coverage
    && audit.coverage.read >= audit.coverage.total
    && audit.verifiedInput === ledgerRepairInputKey(state, story, pages));
}
