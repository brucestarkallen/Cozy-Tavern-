/* Conservative transport accounting, separate from the readable receipt. */
export const ANSWER_RESERVE = 16000;
/* M752: THE LEAST ROOM AN ANSWER IS REFUSED BELOW. A connection with no Max tokens sends nothing for the answer (his rule:
 * if he set nothing, nothing is sent and the provider's default applies), so ANSWER_RESERVE is only the house's own
 * assumption — the room it keeps free for a long, thinking answer when it can, and the room the pages are sized against.
 * Refusing every request that left less than that refused requests the provider would answer: no OpenAI-style
 * connection under ~47k context could send at all, and a 32k local model failed on every page. With no Max tokens set, a
 * request is refused only when not even this much would be left for the answer; between the two it is sent, and the
 * receipt says the answer had less room than usual. A Max tokens he set stays a hard limit: input and that answer fit. */
export const ANSWER_FLOOR = 4096;
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
/* M752: the input a request may not exceed — where it is refused, by the house (assemble/stack.js) and by the provider
 * adapters alike. `answerEstimate` (bodyAccounting: no max tokens in the body) means the answer allowance is only the
 * house's assumed reserve, so ANSWER_FLOOR is what must stay free; otherwise the allowance the body carries is a hard
 * limit. */
export function refusalRoom({ budgetTokens, answerTokens, answerEstimate } = {}) {
  return inputRoom({ budgetTokens, answerTokens: answerEstimate === true ? ANSWER_FLOOR : answerTokens });
}
