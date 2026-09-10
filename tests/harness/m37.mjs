/* M37 — the writer's provider speaks thinking on/off in its own words; the thread follows only until the hand moves. */
import { test, assert, eq } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { createProvider } from '../../js/providers/index.js';
import { reasonStyle, effortFor, hostIsOpenAI } from '../../js/providers/effort.js';
import { thinkingHouse, withHouse, thinkingOff } from './thinkinghouse.mjs';
import { callWorker } from '../../js/agents/call.js';

async function sent(conn, effort) {
  const house = thinkingHouse({ answer: 'x' });
  await withHouse(house, () => callWorker({ ...conn }, { system: 's', user: 'u', effort }).catch(() => null));
  return house.calls[0].body;
}

test('M37-1 DeepSeek is told to stop thinking in its own spelling; effort rides reasoning_effort on the writer’s ladder', async () => {
  const ds = { type: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'deepseek-chat' };
  eq(reasonStyle(ds), 'deepseek');
  eq(reasonStyle({ type: 'openai', baseUrl: 'https://neuralwatt.example/v1', model: 'DeepSeek-V3.2' }), 'deepseek', 'a DeepSeek model behind another address');
  const off = await sent(ds, 'off');
  eq(off.thinking && off.thinking.type, 'disabled', 'thinking:{type:disabled}');
  assert(!('reasoning_effort' in off), 'no effort when off');
  const high = await sent(ds, 'high');
  eq(high.thinking.type, 'enabled'); eq(high.reasoning_effort, 'high');
  eq(effortFor('deepseek', 'medium'), 'high', 'medium aliases up to high');
  eq(effortFor('deepseek', 'xhigh'), 'max', 'xhigh aliases to max');
  eq((await sent(ds, 'max')).reasoning_effort, 'max');
});

test('M37-2 a generic openai-shaped house gets the thinking switch too; real OpenAI never does', async () => {
  const custom = { type: 'openai', baseUrl: 'https://wafer.example/v1', apiKey: 'k', model: 'some-model' };
  const off = await sent(custom, 'off');
  eq(off.thinking && off.thinking.type, 'disabled');
  const on = await sent(custom, 'high');
  eq(on.thinking.type, 'enabled'); eq(on.reasoning_effort, 'high');
  const real = { type: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'k', model: 'gpt-5' };
  const r = await sent(real, 'high');
  assert(!('thinking' in r), 'real OpenAI takes no thinking block');
  eq(r.reasoning_effort, 'high');
  assert(hostIsOpenAI('https://api.openai.com/v1') && !hostIsOpenAI('https://openrouter.ai/api/v1'));
});

test('M37-3 DeepSeek behind the Anthropic shape takes reasoning.effort none|low|high|max', async () => {
  const ds = { type: 'anthropic', baseUrl: 'https://api.deepseek.com/anthropic', apiKey: 'k', model: 'deepseek-chat' };
  const off = await sent(ds, 'off');
  eq(off.reasoning && off.reasoning.effort, 'none', 'none disables');
  assert(!('thinking' in off), 'no anthropic thinking block');
  const hi = await sent(ds, 'high');
  eq(hi.reasoning.effort, 'high');
  eq((await sent(ds, 'max')).reasoning.effort, 'max');
  eq((await sent(ds, 'medium')).reasoning.effort, 'high');
});

test('M37-4 the follow law: the thread follows the stream only until the hand moves it up', () => {
  const chat = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  assert(/let following = true;/.test(chat) && /function followTail\(\)/.test(chat));
  assert(/if \(t\.scrollTop < lastScrollTop - 2 && !atTail\(\)\) following = false;/.test(chat), 'an upward scroll stops the follow');
  assert(/else if \(atTail\(\)\) following = true;/.test(chat), 'reaching the tail resumes it');
  const stream = chat.slice(chat.indexOf("} else if (channel === 'prose') {"), chat.indexOf("} else if (channel === 'prose') {") + 400);
  assert(/followTail\(\);/.test(stream) && !/const stick = nearBottom\(\)/.test(stream), 'streaming uses the follow law, not the 120px snap');
  assert(/requestAnimationFrame/.test(chat.slice(chat.indexOf('function followTail'), chat.indexOf('function followTail') + 300)), 'one scroll per frame');
});

test('M37-5 the workers say what they wrote, not only how much', () => {
  const chat = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  assert(/wrote \$\{n\} \$\{n === 1 \? 'change' : 'changes'\}: ` \+ applied\.slice\(0, 5\)/.test(chat), 'the extractor names its changes');
  const world = readFileSync(new URL('../../js/agents/world.js', import.meta.url), 'utf8');
  assert(/result\.applied\.slice\(0, 4\)\.map\(\(a\) => a\.words/.test(world), 'the world agent names what moved');
});
