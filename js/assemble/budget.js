/* Conservative transport accounting, separate from the readable receipt. */
export const ANSWER_RESERVE = 16000;
export const CONTEXT_MARGIN = 3000;
/* Images are an allowance, not their base64 byte count. Without provider dimensions/usage it remains uncertain. */
export const UNKNOWN_IMAGE_ALLOWANCE = 4096;
export function contentTokens(content) {
  if (typeof content === 'string') return Math.ceil(content.length / 3);
  if (!Array.isArray(content)) return Math.ceil(JSON.stringify(content || '').length / 3);
  return content.reduce((n,p) => n + (p?.type === 'text' ? Math.ceil(String(p.text || '').length / 3) : p?.type === 'image' || p?.type === 'image_url' ? UNKNOWN_IMAGE_ALLOWANCE : Math.ceil(JSON.stringify(p).length / 3)),0);
}
export function requestTokens(systemBlocks, messages) {
  const blocks = (systemBlocks || []).filter(b => b?.text);
  return blocks.reduce((n,b) => n + Math.ceil((b.text.length + 2)/3),0)
    + (messages || []).reduce((n,m) => n + contentTokens(m.content) + (m.image ? Number(m.image.estimatedTokens) || UNKNOWN_IMAGE_ALLOWANCE : 0) + (m.reasoning_content ? contentTokens(m.reasoning_content) : 0),0)
    + 24 * ((messages || []).length + blocks.length + 1);
}
export function bodyAccounting(body = {}) {
  const blocks = typeof body.system === 'string' ? [{text:body.system}] : (body.system || []).filter(p => p?.type === 'text');
  const extra = ['tools','tool_choice','response_format'].filter(k => body[k]).reduce((n,k) => n + Math.ceil(JSON.stringify(body[k]).length / 3),0);
  return { inputTokens: requestTokens(blocks, body.messages || []) + extra,
    answerTokens: Number(body.max_tokens || body.max_completion_tokens) || ANSWER_RESERVE,
    answerEstimate: !(Number(body.max_tokens || body.max_completion_tokens) > 0),
    estimate: 'conservative text and wrapper estimate; image allowance when usage is unavailable',
    imagesUncertain: (body.messages || []).some(m => Array.isArray(m.content) && m.content.some(p => p.type === 'image' || p.type === 'image_url')) };
}
export function inputRoom(window) {
  const context = Number(window?.budgetTokens) || 0;
  if (!context) return Infinity;
  const answer = Number(window?.answerTokens) > 0 ? Number(window.answerTokens) : ANSWER_RESERVE;
  return Math.max(0, context - answer - CONTEXT_MARGIN);
}
