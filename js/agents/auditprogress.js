import { fingerprint36 } from '../engine/fingerprint.js';
import { pageText } from '../assemble/stack.js';
import { VERSION } from '../version.js';

export function ledgerRepairStateKey(state) {
  const fields = ['sheet', 'clock', 'place', 'present', 'offscreen', 'characters', 'relationships', 'knowledge', 'canon', 'threads', 'things', 'bodies', 'factions', 'mode', 'worldBrief', 'lastVerdict', 'pendingVerdict', 'duel', 'battle', 'composure'];
  return fingerprint36(JSON.stringify(fields.map(k => state?.[k] ?? null)));
}
export function ledgerRepairInputKey(state, story, pages) {
  return fingerprint36(JSON.stringify([VERSION, story?.brief, story?.castNotes, story?.connections,
    (pages || []).map(p => [p.id, p.role, p.ooc, pageText(p), p.voices || []]), ledgerRepairStateKey(state)]));
}

// Actual outstanding work must decrease. Rephrasing ledger text is not closure.
export function repairRetryCheckpoint(before, after, story, pages) {
  // Worker-created voices are checked evidence, but cannot reset retry progress.
  const source = ledgerRepairInputKey({}, story, (pages || []).map(p => ({ ...p, voices: [] })));
  const previous = before.audit?.retryProgress;
  const count = state => (state.audit?.pending || []).length;
  const currentSource = ledgerRepairInputKey({},story,pages);
  const currentEntries = state => state.audit?.verification?.source === currentSource
    ? ledgerVerificationRows(state).filter(row => state.audit.verification.entries?.[row.id]?.print === row.print) : [];
  const read = state => (Number(state.audit?.coverage?.read) || 0) + currentEntries(state).length;
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

export function ledgerAuditVerified(state, story, pages) {
  const audit = state?.audit;
  return Boolean(audit?.verifiedInput && !auditHasOpenWork(audit) && audit.coverage
    && audit.coverage.read >= audit.coverage.total && audit.verification
    && audit.verification.source === ledgerRepairInputKey({}, story, pages)
    && audit.verification.ledger === ledgerRepairStateKey(state)
    && ledgerVerificationRows(state).every(row => audit.verification.entries?.[row.id]?.print === row.print)
    && audit.verifiedInput === ledgerRepairInputKey(state, story, pages));
}

// Every semantic ledger entry is visible even when the prose renderer leans it.
// History/timestamps are bookkeeping, not a replacement for checking the value.
export function ledgerVerificationRows(state) {
  const rows = [];
  const add = (section, name, value, judgment = false) => {
    const id = section + ':' + name;
    rows.push({ id, section, name, value, judgment, print: fingerprint36(JSON.stringify(value)) });
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
        ? {...Object.fromEntries(['core','state','arc','threads','aliases','retired','hand'].filter(k => entry?.[k] !== undefined).map(k => [k,entry[k]])), physicalFacts:semantic(state.canon?.[name] || null)}
        : semantic(entry);
      add(section, name, value, ['offscreen','relationships','factions'].includes(section));
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
