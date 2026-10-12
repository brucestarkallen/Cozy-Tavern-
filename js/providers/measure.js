/* Pure previews use the same serializer as transport, never a token-count API call. */
import { buildOpenAIRequest } from './openai.js';
import { buildAnthropicRequest } from './anthropic.js';
import { bodyAccounting } from '../assemble/budget.js';
export function measureTransport(connection, request) {
  const body = connection?.type === 'anthropic' ? buildAnthropicRequest(connection,request) : buildOpenAIRequest(connection,request);
  return bodyAccounting(body);
}
