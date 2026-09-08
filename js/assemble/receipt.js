/* Cozy Tavern — assemble/receipt.js
 * The Receipt: a per-turn record of exactly what was sent to the storyteller
 * and why, plus how long the answer took to arrive. Drafts are built by
 * assemble/stack.js while the stack is assembled; finalizeReceipt stamps in
 * the timings once the stream finishes. Receipts live on the assistant
 * message they describe (msg.receipt).
 *
 * Contract (SPEC.md M2):
 *   finalizeReceipt(draft, {ttftMs, durationMs, model})
 *   Receipt = {v:1, ts, slots:[{name,tokens,source,reason}], totalTokens,
 *              ttftMs, durationMs, model, stateSummary}
 */

/* A rough word-count for the wire: one token ≈ four characters, rounded up.
 * Good enough to show a person the shape of a turn; never presented as exact. */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

export function finalizeReceipt(draft, timings) {
  const { ttftMs, durationMs, model } = timings || {};
  const safe = draft && typeof draft === 'object' ? draft : {};
  const slots = Array.isArray(safe.slots) ? safe.slots : [];
  return {
    v: 1,
    ts: Date.now(),
    slots: slots.map((s) => ({
      name: String(s.name || ''),
      tokens: typeof s.tokens === 'number' ? s.tokens : 0,
      source: s.source || '',
      reason: s.reason || '',
    })),
    totalTokens: typeof safe.totalTokens === 'number'
      ? safe.totalTokens
      : slots.reduce((sum, s) => sum + (s.tokens || 0), 0),
    ttftMs: typeof ttftMs === 'number' ? Math.round(ttftMs) : null,
    durationMs: typeof durationMs === 'number' ? Math.round(durationMs) : null,
    model: model || '',
    stateSummary: typeof safe.stateSummary === 'string' ? safe.stateSummary : '',
  };
}
