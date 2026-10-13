/* Cozy Tavern — assemble/receipt.js
 * The Receipt: a per-turn record of exactly what was sent to the storyteller
 * and why, plus how long the answer took to arrive. Drafts are built by
 * assemble/stack.js while the stack is assembled; finalizeReceipt stamps in
 * the timings once the stream finishes. Receipts live on the assistant
 * message they describe (msg.receipt).
 *
 * Contract (SPEC.md M2, extended M8.5):
 *   finalizeReceipt(draft, {ttftMs, tfftMs, durationMs, model, effort})
 *   Receipt = {v:1, ts, slots:[{name,tokens,source,reason}], totalTokens,
 *              ttftMs, tfftMs, durationMs, model, effort, stateSummary}
 *   tfftMs = time to the first THOUGHT (null when the thinking voice was
 *   off or quiet); effort = the reasoning effort that turn ran with
 *   ('' when off).
 */

/* A rough word-count for the wire: one token ≈ four characters, rounded up.
 * Good enough to show a person the shape of a turn; never presented as exact. */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

/* M752: THE SELECTION AS THE SENT STORE KEEPS IT (js/sent.js, beside the page's words). The request's own selection lists
 * every message of the tale and every record line with its reason — about 198 KB a page on a 600-page tale, kept for the
 * newest 200 pages and pushed to the device — and nothing reads those lists. Their counts are kept, with the parts that
 * are small and say what the request held: the coverage and its gaps, the plans, the people, the passages, and what the
 * caller adds (the smart recall's answer). */
export function selectionForSent(selection, extra = {}) {
  if (!selection || typeof selection !== 'object') return null;
  const records = Array.isArray(selection.records) ? selection.records : [];
  const messages = Array.isArray(selection.messages) ? selection.messages : [];
  return {
    v: selection.v, storyId: selection.storyId, revision: selection.revision,
    messages: { carried: messages.filter((m) => m && m.selected).length, total: messages.length },
    records: { selected: records.filter((r) => r && r.selected).length, unavailable: records.filter((r) => r && r.available === false).length, total: records.length },
    plans: selection.plans, characters: selection.characters, excerpts: selection.excerpts,
    coverage: selection.coverage, gaps: selection.gaps,
    ...extra,
  };
}

export function finalizeReceipt(draft, timings) {
  const { ttftMs, tfftMs, durationMs, model, effort, prefill, sentId, noThought, small, thinkWhy, connId, label } = timings || {};
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
    /* M8.5: the thinking voice's own first mark — null when it stayed
     * quiet, so old receipts and quiet turns read the same. */
    tfftMs: typeof tfftMs === 'number' ? Math.round(tfftMs) : null,
    durationMs: typeof durationMs === 'number' ? Math.round(durationMs) : null,
    model: model || '',
    /* M632: which connection wrote it — the benchmark knows each storyteller by it */
    ...(typeof connId === 'string' && connId ? { connId } : {}),
    ...(typeof label === 'string' && label ? { label } : {}),
    effort: typeof effort === 'string' ? effort : '',
    /* M329: what the prefill did on this turn, in words ('' when the connection has none) */
    prefill: typeof prefill === 'string' ? prefill : '',
    stateSummary: typeof safe.stateSummary === 'string' ? safe.stateSummary : '',
    ...(safe.context ? { context: { ...safe.context } } : {}),
    /* M752: what the page keeps of the request's selection is what is read of it (receiptview: the source gaps). Every
     * record line selected rode on every page's receipt — 16.8 KB a page on a 292-line record, against 4.2 KB for the rest
     * of the receipt — synced and backed up with the book, and read by nothing (M347: nothing heavy rides the page) */
    ...(safe.selection ? { selection: { gaps: Array.isArray(safe.selection.gaps) ? safe.selection.gaps : [] } } : {}),
    /* M347: where this page's words are kept (js/sent.js) — a receipt without it is from before they were kept */
    ...(typeof sentId === 'string' && sentId ? { sentId } : {}),
    /* M348: thinking was asked for and none came back — said on the page, so "did it think?" is never a guess */
    ...(noThought === true ? { noThought: true } : {}),
    /* M512: written by a small storyteller or not — which of the story's pages show its voice at its best */
    ...(typeof small === 'boolean' ? { small } : {}),
    /* M521-2: why no thinking was asked for or sent — said here, never in a banner over the page */
    ...(typeof thinkWhy === 'string' && thinkWhy ? { thinkWhy } : {}),
  };
}
