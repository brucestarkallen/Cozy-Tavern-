/* M349: "if I use a GLM model on Synthetic it'll work? or another provider?" — every request, measured through the real
 * provider: Synthetic speaks one field (reasoning_effort) with the values it lists per model; Z.ai's GLM is spoken to by
 * its generation. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { createProvider } from '../../js/providers/index.js';
import { reasonStyle, familyStyle, spokenAs, thinkingHint } from '../../js/providers/effort.js';

const LEVELS = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];
async function wireAt(conn) {
  const out = {};
  const real = globalThis.fetch;
  let last = null;
  globalThis.fetch = async (url, opts) => {
    last = JSON.parse(opts.body);
    const text = 'data: {"choices":[{"delta":{"content":"Ok."}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } }), async json() { return {}; }, async text() { return text; } };
  };
  try {
    for (const l of LEVELS) {
      await createProvider({ ...conn, reasoning: { effort: l } }).streamChat({ systemBlocks: [{ text: 'x' }], messages: [{ role: 'user', content: 'y' }], onToken() {} });
      const b = last;
      const think = {};
      for (const k of ['reasoning_effort', 'thinking', 'enable_thinking', 'reasoning']) if (k in b) think[k] = b[k];
      out[l] = JSON.stringify(think);
    }
  } finally { globalThis.fetch = real; }
  return out;
}
const SYN = 'https://api.synthetic.new/openai/v1';
const synModel = (model, hf, efforts) => ({ type: 'openai', baseUrl: SYN, apiKey: 'k', model, identFor: model + '@' + SYN, modelHf: hf, modelEfforts: efforts });
const only = (v) => (v ? JSON.stringify({ reasoning_effort: v }) : '{}');

test('M349-1 SYNTHETIC IS SPOKEN TO IN ITS OWN WORDS FOR EVERY MODEL — one field, reasoning_effort, one of the values it lists (the live listing: GLM-5.2 none/high/max, Kimi K3 low/high/max, Qwen low/medium/xhigh)', async () => {
  const cases = [
    { name: 'GLM-5.2', conn: synModel('hf:zai-org/GLM-5.2', 'zai-org/GLM-5.2', ['none', 'high', 'max']), want: { off: 'none', low: 'high', medium: 'high', high: 'high', xhigh: 'max', max: 'max' } },
    /* a route whose weights the listing does not name: no family alias to lean on — the house's own law, nearest below */
    { name: 'an unnamed route', conn: synModel('syn:large:text', '', ['none', 'high', 'max']), want: { off: 'none', low: 'high', medium: 'high', high: 'high', xhigh: 'high', max: 'max' } },
    { name: 'Kimi K3 (syn:large:vision)', conn: synModel('syn:large:vision', 'moonshotai/Kimi-K3', ['low', 'high', 'max']), want: { off: 'low', low: 'low', medium: 'high', high: 'high', xhigh: 'max', max: 'max' } },
    { name: 'Qwen3.8-27B', conn: synModel('hf:Qwen/Qwen3.8-27B', 'Qwen/Qwen3.8-27B', ['low', 'medium', 'xhigh']), want: { off: 'low', low: 'low', medium: 'medium', high: 'medium', xhigh: 'xhigh', max: 'xhigh' } },
  ];
  for (const c of cases) {
    eq(reasonStyle(c.conn), 'declared', c.name + ': spoken in the relay’s own words');
    const got = await wireAt(c.conn);
    for (const l of LEVELS) eq(got[l], only(c.want[l]), c.name + ' at ' + l + ': reasoning_effort "' + c.want[l] + '" and nothing else');
    process.env.SHOW_M349 && console.log(c.name, JSON.stringify(got));
  }
  assert(/Off is sent as “none”/.test(thinkingHint(cases[0].conn)), 'the form says Off is “none” here');
  assert(/always thinks/.test(spokenAs(cases[2].conn, 'off')), 'and that K3 cannot be off');
});

test('M349-2 GLM ON Z.AI BY ITS GENERATION: 5.3 always thinks (low/high/max — never a switch-off it refuses); 5.2 takes off/high/max (Low is its “high”, never the max an unsaid effort means); before 5.2, a switch', async () => {
  const at = 'https://api.z.ai/api/paas/v4';
  const z = (model) => ({ type: 'openai', baseUrl: at, apiKey: 'k', model, preset: 'zai' });
  const on = (e) => JSON.stringify(e ? { reasoning_effort: e, thinking: { type: 'enabled' } } : { thinking: { type: 'enabled' } });
  const offSwitch = JSON.stringify({ thinking: { type: 'disabled' } });
  const g53 = await wireAt(z('glm-5.3'));
  const w53 = { off: 'low', low: 'low', medium: 'high', high: 'high', xhigh: 'max', max: 'max' };
  for (const l of LEVELS) eq(g53[l], on(w53[l]), 'GLM-5.3 at ' + l);
  const g52 = await wireAt(z('glm-5.2'));
  eq(g52.off, offSwitch, 'GLM-5.2 off: the switch');
  const w52 = { low: 'high', medium: 'high', high: 'high', xhigh: 'max', max: 'max' };
  for (const l of Object.keys(w52)) eq(g52[l], on(w52[l]), 'GLM-5.2 at ' + l);
  const g46 = await wireAt(z('glm-4.6'));
  eq(g46.off, offSwitch, 'GLM-4.6 off');
  for (const l of LEVELS.slice(1)) eq(g46[l], on(''), 'GLM-4.6 at ' + l + ': on, with no effort it does not take');
  assert(/GLM-5.3 always thinks/.test(spokenAs(z('glm-5.3'), 'off')), 'the card says what off means for 5.3');
  process.env.SHOW_M349 && console.log('GLM-5.3', JSON.stringify(g53), '\nGLM-5.2', JSON.stringify(g52));
});

test('M349-3 KIMI K3 ELSEWHERE IS UNCHANGED: Moonshot and any host whose model name says kimi-k3 get reasoning_effort only; OpenRouter its own reasoning object', async () => {
  const k3 = await wireAt({ type: 'openai', baseUrl: 'https://api.together.xyz/v1', apiKey: 'k', model: 'moonshotai/Kimi-K3' });
  eq(familyStyle({ type: 'openai', baseUrl: 'https://api.together.xyz/v1', model: 'moonshotai/Kimi-K3' }), 'kimi', 'read as K3');
  eq(k3.low, only('low'), 'low');
  eq(k3.off, only('low'), 'off is its least');
  const or = await wireAt({ type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', model: 'moonshotai/kimi-k3' });
  eq(or.high, JSON.stringify({ reasoning: { effort: 'high' } }), 'OpenRouter: its own shape');
});

test('M349-4 “CANNOT STOP THINKING” IS ONE TEST, HOWEVER THE MODEL IS REACHED: K3 behind Synthetic’s alias, GLM-5.3 and Moonshot’s K3 are; GLM-5.2 (on Synthetic or Z.ai) and DeepSeek are not — and a worker on the first kind is given room to think and answer', async () => {
  const { alwaysThinks } = await import('../../js/providers/effort.js');
  const { callWorker, ALWAYS_THINKS_FLOOR } = await import('../../js/agents/call.js');
  const { thinkingHouse, withHouse } = await import('./thinkinghouse.mjs');
  const k3syn = synModel('syn:large:vision', 'moonshotai/Kimi-K3', ['low', 'high', 'max']);
  const glmSyn = synModel('hf:zai-org/GLM-5.2', 'zai-org/GLM-5.2', ['none', 'high', 'max']);
  const z = (model) => ({ type: 'openai', baseUrl: 'https://api.z.ai/api/paas/v4', apiKey: 'k', model });
  eq(alwaysThinks(k3syn), true, 'K3 on Synthetic');
  eq(alwaysThinks(glmSyn), false, 'GLM-5.2 on Synthetic (it lists "none")');
  eq(alwaysThinks(z('glm-5.3')), true, 'GLM-5.3');
  eq(alwaysThinks(z('glm-5.2')), false, 'GLM-5.2 on Z.ai');
  eq(alwaysThinks({ type: 'openai', baseUrl: 'https://api.moonshot.ai/v1', model: 'kimi-k3' }), true, 'Moonshot’s K3');
  eq(alwaysThinks({ type: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }), false, 'DeepSeek');
  const sent = async (conn) => { const house = thinkingHouse({ answer: 'x' }); await withHouse(house, () => callWorker({ ...conn, maxTokens: 1200 }, { system: 's', user: 'u', effort: 'off' }).catch(() => null)); return house.calls[0].body; };
  assert((await sent(k3syn)).max_tokens >= ALWAYS_THINKS_FLOOR, 'a worker on K3 behind the alias gets the floor (M348 made it K3; M349 kept it)');
  assert((await sent(z('glm-5.3'))).max_tokens >= ALWAYS_THINKS_FLOOR, 'a worker on GLM-5.3 gets it too');
  eq((await sent(glmSyn)).max_tokens, 1200, 'GLM-5.2 on Synthetic keeps its own room');
});
