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
