/* M27: a picture rides the wire. Each provider spells it differently —
 * anthropic wants base64 blocks, openai-shape wants data-url parts.
 * Lives here (not in the registry) so adapters can import without a cycle. */
export function withImagePart(m, kind) {
  if (!m || !m.image || !m.image.dataUrl) return { role: m.role, content: m.content };
  const match = /^data:([^;]+);base64,(.+)$/.exec(m.image.dataUrl);
  if (!match) return { role: m.role, content: m.content };
  const [, mediaType, data] = match;
  const text = m.content || ' ';
  if (kind === 'anthropic') {
    return { role: m.role, content: [
      { type: 'text', text },
      { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
    ] };
  }
  return { role: m.role, content: [
    { type: 'text', text },
    { type: 'image_url', image_url: { url: m.image.dataUrl } },
  ] };
}

/* M28: the Retry-After header, in milliseconds — seconds or an HTTP date,
 * rounded up; 0 when the house asked for nothing. One home for it (it used
 * to live in agents/scribe.js, where only the scribe could honor it). */
export function retryAfterMs(headers) {
  try {
    const raw = headers && typeof headers.get === 'function' ? headers.get('retry-after') : null;
    if (!raw) return 0;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds * 1000));
    const when = Date.parse(raw);
    return Number.isFinite(when) ? Math.max(0, when - Date.now()) : 0;
  } catch (err) {
    return 0;
  }
}

/* M28: a refused call becomes an Error that carries what the wire knows —
 * the status, and the wait the house asked for — so the workers' queue can
 * back off honestly (agents/queue.js honors err.retryAfterMs) and the chat
 * view can still say the kind words. */
export function transportError(res, message) {
  const err = new Error(message || `The house said no (${res && res.status}).`);
  if (res && Number.isFinite(res.status)) err.status = res.status;
  const wait = retryAfterMs(res && res.headers);
  if (wait > 0) err.retryAfterMs = wait;
  return err;
}
