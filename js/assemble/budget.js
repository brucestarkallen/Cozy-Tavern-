/* Conservative transport accounting, separate from the readable receipt. */
export const ANSWER_RESERVE = 16000;
export const CONTEXT_MARGIN = 3000;
export function requestTokens(systemBlocks, messages) {
  const blocks = (systemBlocks || []).filter(b => b?.text);
  const chars = blocks.reduce((n,b) => n + b.text.length + 2, 0)
    + (messages || []).reduce((n,m) => n + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content || '').length) + 2, 0);
  return Math.ceil(chars / 3) + 24 * ((messages || []).length + blocks.length + 1);
}
export function inputRoom(window) {
  const context = Number(window?.budgetTokens) || 0;
  if (!context) return Infinity;
  const answer = Number(window?.answerTokens) > 0 ? Number(window.answerTokens) : ANSWER_RESERVE;
  return Math.max(0, context - answer - CONTEXT_MARGIN);
}
