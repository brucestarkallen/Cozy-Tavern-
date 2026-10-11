import { fingerprint36 } from '../engine/fingerprint.js';
import { pageText } from '../assemble/stack.js';
import { VERSION } from '../version.js';

export function ledgerRepairStateKey(state) {
  const fields = ['sheet', 'clock', 'place', 'present', 'offscreen', 'characters', 'relationships', 'knowledge', 'canon', 'threads', 'things', 'bodies', 'factions', 'mode'];
  return fingerprint36(JSON.stringify(fields.map(k => state?.[k] ?? null)));
}
export function ledgerRepairInputKey(state, story, pages) {
  return fingerprint36(JSON.stringify([VERSION, story?.brief, story?.castNotes, story?.connections,
    (pages || []).map(p => [p.id, p.role, p.ooc, pageText(p)]), ledgerRepairStateKey(state)]));
}
