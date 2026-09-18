/* Cozy Tavern — agents/call.js
 * M28: the ONE way a worker speaks to a model.
 *
 * Until M28 every ledger worker (extractor, scribe, keeper, second reader,
 * referee) carried its own pair of hand-rolled fetches — six wire paths in
 * the house, five of them ignorant of the reasoning ladder in
 * providers/effort.js. So a worker on a thinking model (GLM on Z.ai, Kimi
 * behind OpenRouter, Qwen on a custom address) was never told to stop
 * thinking: it thought first, spent its whole token budget on
 * reasoning_content, and answered with nothing. The parser saw '' and the
 * ledger sat empty — "its answer could not be used", turn after turn.
 * Raising max_tokens (M26, 600 → 2000) only moved the cliff.
 *
 * The root fix: workers ride the same providers the storyteller rides.
 * createProvider() already spells "no thinking" per house — Z.ai
 * thinking:{type:'disabled'}, OpenRouter reasoning:{enabled:false}, Qwen
 * enable_thinking:false, Anthropic no thinking block, DeepSeek nothing —
 * and already routes any thinking that arrives anyway onto its own channel,
 * so the answer text is the answer text. Rejection memory, address
 * normalization, image parts, kind error words: all of it, once.
 *
 *   callWorker(connection, {system, user | messages, maxTokens, effort,
 *                           temperature, signal})
 *     -> { text, thinking, finishReason, notes }
 *
 * Throws on transport failure (the queue retries with backoff, honoring
 * err.retryAfterMs — see providers/wire.js transportError). Never throws
 * for an empty answer: that is the caller's to judge.
 *
 * Effort defaults to 'off' — a ledger worker is a clerk, not a thinker. A
 * worker that genuinely earns a little thought (the world agent, later)
 * passes its own level; the ladder still decides what the house can say.
 */

import { createProvider } from '../providers/index.js';
import { reasonStyle } from '../providers/effort.js';

export const WORKER_MAX_TOKENS = 1200;
export const ALWAYS_THINKS_FLOOR = 16000; /* M303 */

/* The connection as a worker holds it: the writer's key, address, model and
 * refusal memory — never the storyteller's dials. The prefill and the web
 * search are the storyteller's; a worker gets none of either. */
/* M231: THE CONNECTION THE WRITER CHOSE IS THE CONNECTION THAT ANSWERS.
 * This took a copy of the connection and then threw away its temperature, its
 * top-p, its prefill, its search and its thinking, substituting the house's
 * own — so a connection the writer had made FOR his workers, with the values
 * he wanted, was used for its address and model and nothing else. Worse,
 * top-p was DELETED rather than set, so instead of a chosen value the worker
 * got whatever that provider happens to default to, differently on every
 * house. The writer assigns a connection per worker; that is the place those
 * choices belong.
 * What remains here is only what a connection cannot say: a floor on the room
 * an answer needs, so a storyteller connection set to 200 tokens cannot cut a
 * worker's JSON in half. Everything the connection DOES say, it says. */
/* M328: which connection the storyteller is riding — told by the chat when it sends a turn, and at boot */
let tellerConnectionId = null;
export function noteTellerConnection(id) { tellerConnectionId = typeof id === 'string' && id ? id : null; }

export function workerConnection(connection, { maxTokens, effort, temperature } = {}) {
  const c = { ...connection };
  /* M328: A STORY'S PREFILL IS NOT WELDED ONTO A WORKER. The extension's law for "utility generations", and its
   * reason: a prefill written for the storyteller — "[The Bluebird —", or a thinking seed in the teller's
   * voice — corrupts a summary or a ledger reading (since M307 the started words are put back at the head of
   * the answer: a worker's JSON would begin with a page header). M231 handed workers everything the
   * connection holds, the prefill with it — and that stands for a connection made FOR the workers (a "{" to
   * begin their JSON is theirs, M307-3). Only when a worker rides THE STORYTELLER'S connection is its
   * prefill the story's: then it stays home, unless the connection says "Workers riding this connection get
   * it too". */
  if (c.prefillForWorkers !== true && c.id && c.id === tellerConnectionId) delete c.prefill;
  /* M232: NOTHING SET MEANS THE PROVIDER'S DEFAULT, NOT THE HOUSE'S ZERO.
   * M231 stopped overriding a temperature the connection HAD and then still
   * imposed 0 on one that had none — which is the same overruling, only
   * quieter. A connection that says nothing about temperature is a writer
   * saying "whatever this provider does"; the house has no business
   * answering for him. The key is removed entirely so nothing is sent. */
  if (Number.isFinite(temperature)) c.temperature = temperature;
  else if (!Number.isFinite(c.temperature)) delete c.temperature;
  const room = Number.isFinite(maxTokens) && maxTokens > 0 ? Math.round(maxTokens) : WORKER_MAX_TOKENS;
  c.maxTokens = Math.max(room, Number.isFinite(c.maxTokens) ? Math.round(c.maxTokens) : 0) || room;
  /* M303: A HOUSE THAT CANNOT STOP THINKING NEEDS ROOM TO THINK AND ANSWER.
   * The workers ask for 400 to 4,000 tokens, and on every other house a
   * worker's thinking can be switched off so the room is all answer. Kimi K3
   * always thinks, and its thinking is counted in the same room — a worker
   * riding it would think its 400 tokens away and answer with nothing (the
   * fault M-early fixed for the houses that CAN be told off). The floor is
   * Moonshot's own number for its thinking models ("set max_tokens >= 16000
   * to ensure the full reasoning_content and content can be returned"). It is
   * a ceiling on the reply, never a cost, and the only thing set here that
   * the connection did not say: the floor that keeps an answer whole. */
  if (reasonStyle(c) === 'kimi') c.maxTokens = Math.max(c.maxTokens, ALWAYS_THINKS_FLOOR);
  /* M233: THINKING IS THE WRITER'S TO DECIDE, LIKE EVERYTHING ELSE. Every
   * worker used to ask for effort:'off' outright, and I called that "a worker
   * choosing about its own job" — which was the same paternalism I had just
   * been told twice to stop, dressed as a principle. The writer assigns the
   * connection; if he wants his keeper to think, that is his call and his
   * tokens. No worker asks for 'off' any more: what the connection says
   * stands, and a connection that says nothing sends nothing. */
  if (typeof effort === 'string' && effort) c.reasoning = { ...(c.reasoning || {}), effort };
  else if (!c.reasoning || typeof c.reasoning.effort !== 'string') delete c.reasoning;
  /* M315: A WORKER TOLD TO THINK NEEDS ROOM TO THINK AND ANSWER — ON EVERY HOUSE, NOT ONLY KIMI. Since M233 a
   * worker thinks when the connection it rides says so ("thinking is the writer's to decide"), but its
   * room stayed the few hundred tokens of an answer — and on DeepSeek, Z.ai, Qwen, OpenRouter and the
   * rest, thinking is counted inside that same room. The keeper asks for 1,600: a connection set to
   * think spends them all thinking and answers with nothing, the keeper reads nothing as "the worker
   * went quiet", and the light says "could not fold a gap in the record yet" after every page, for
   * ever, on a connection that tests perfectly. The same floor as M303's, for the same reason. */
  if (c.reasoning && typeof c.reasoning.effort === 'string' && c.reasoning.effort !== 'off') c.maxTokens = Math.max(c.maxTokens, ALWAYS_THINKS_FLOOR);
  return c;
}

export async function callWorker(connection, { system, user, messages, maxTokens, effort, temperature, signal } = {}) {
  if (!connection || typeof connection !== 'object') throw new Error('no connection');
  const conn = workerConnection(connection, { maxTokens, effort, temperature });
  const provider = createProvider(conn);
  const list = Array.isArray(messages) && messages.length
    ? messages
    : [{ role: 'user', content: String(user || '') }];
  const ask = (p) => p.streamChat({
    system: String(system || ''),
    messages: list,
    signal,
    onToken() { /* a worker's words are read whole, never streamed to a page */ },
  });
  let result = await ask(provider);
  /* M315: …AND A HOUSE THAT THINKS WITHOUT BEING ASKED. A connection that says nothing about thinking sends
   * nothing (M232/M233) — and some models then think by default. The sign is unmistakable: the answer
   * is EMPTY while thinking came back, or the reply was cut for length with nothing in it. Asked again,
   * once, with room to finish thinking and answer; the second answer stands whatever it is. */
  const said = typeof result.text === 'string' ? result.text.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').trim() : '';
  const thoughtItAway = !said && ((typeof result.thinking === 'string' && result.thinking.trim()) || String(result.finishReason || '').toLowerCase() === 'length');
  if (thoughtItAway && conn.maxTokens < ALWAYS_THINKS_FLOOR && !(signal && signal.aborted)) {
    const roomier = await ask(createProvider({ ...conn, maxTokens: ALWAYS_THINKS_FLOOR }));
    result = { ...roomier, notes: [...(Array.isArray(result.notes) ? result.notes : []), ...(Array.isArray(roomier.notes) ? roomier.notes : []), 'the first answer was all thinking and no words — asked again with room to answer'] };
  }
  return {
    text: typeof result.text === 'string' ? result.text : '',
    thinking: typeof result.thinking === 'string' ? result.thinking : '',
    finishReason: result.finishReason || null,
    notes: Array.isArray(result.notes) ? result.notes : [],
  };
}
