/* M22: the parity laws — reasoning ladder, address normalization, prefill
 * profiles, exports, prose rendering, and the reverse id-coverage law. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, assert, eq } from './lib.mjs';
import { EFFORT_RANK, EFFORT_LEVELS, EFFORT_ALIAS, effortFor, effortStepDown, PREFILL_PROFILES, REASONING_REFUSAL } from '../../js/providers/effort.js';
import { normalizeBaseUrl, KNOWN_V1_HOSTS } from '../../js/providers/index.js';
import { loreToWorldbook, worldbookFilename } from '../../js/import/lorebook.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('M22 the ladder: xhigh and max exist, and aliases never send a rejected name', () => {
  eq(EFFORT_RANK.at(-1), 'max', 'max tops the ladder');
  assert(EFFORT_RANK.includes('xhigh'), 'xhigh present');
  eq(EFFORT_ALIAS.zai.xhigh, 'max', 'zai maps xhigh to max');
  eq(EFFORT_ALIAS.zai.medium, 'high', 'zai maps medium to high');
  const mapped = effortFor('zai', 'xhigh');
  assert(mapped === 'max', `zai hears max for xhigh (got ${mapped})`);
  const capped = effortFor('qwen', 'max');
  assert(capped === 'high', `qwen caps max down to high (got ${capped})`);
  eq(effortStepDown('openai', 'max'), 'xhigh', 'step-down from max is xhigh');
  eq(effortStepDown('openai', 'low'), null, 'below low the param drops entirely (retry sends without reasoning)');
});

test('M22 refusal memory: the regex catches provider refusals', () => {
  assert(REASONING_REFUSAL.test("Invalid parameter: reasoning_effort"), 'catches reasoning_effort');
  assert(REASONING_REFUSAL.test("thinking budget_tokens not supported"), 'catches thinking budget');
  assert(!REASONING_REFUSAL.test("rate limit exceeded"), 'never false-fires on a rate limit');
});

test('M22 address normalization: SillyTavern courtesy matrix', () => {
  eq(normalizeBaseUrl('https://api.openai.com'), 'https://api.openai.com/v1', 'known host gains /v1');
  eq(normalizeBaseUrl('https://api.openai.com/'), 'https://api.openai.com/v1', 'trailing slash trimmed first');
  eq(normalizeBaseUrl('https://openrouter.ai/api/v1'), 'https://openrouter.ai/api/v1', 'existing /v1 untouched');
  eq(normalizeBaseUrl('https://api.anthropic.com'), 'https://api.anthropic.com', 'anthropic keeps bare (its path differs)');
  const custom = normalizeBaseUrl('http://192.168.1.5:5000');
  assert(custom === 'http://192.168.1.5:5000' || custom === 'http://192.168.1.5:5000/v1', 'custom hosts never mangled beyond an offered /v1');
  assert(KNOWN_V1_HOSTS.length >= 4, 'known-hosts table exists');
});

test('M22 prefill profiles: per-provider mechanics with honest skips', () => {
  assert(PREFILL_PROFILES, 'profiles exist');
  const keys = Object.keys(PREFILL_PROFILES);
  assert(keys.some((k) => k.includes('anthropic') || k === 'anthropic'), 'anthropic profile');
  assert(keys.some((k) => /moonshot|kimi/.test(k)), 'moonshot partial profile');
  assert(keys.some((k) => /deepseek/.test(k)), 'deepseek prefix profile');
});

test('M22 lore walks back to SillyTavern (worldbook export shape)', () => {
  const wb = loreToWorldbook([
    { id: 'a', keys: ['Mara'], content: 'the coin-counter', enabled: true, constant: true },
    { id: 'b', keys: ['Ashford'], content: 'the wet city', enabled: false, constant: false },
  ], 'Ember novels');
  const entries = wb.entries;
  assert(entries, 'worldbook has entries');
  const first = Object.values(entries)[0];
  eq(first.position, 0, 'constant becomes position 0 (always-on)');
  eq(first.disable, false, 'enabled inverts to disable:false');
  assert(worldbookFilename('Ember novels').endsWith('.json'), 'filename ends in .json');
});

test('M22 reverse id-coverage law: every control in the page is wired', () => {
  const html = read('index.html');
  const js = ['js/ui/chat.js', 'js/ui/settings.js', 'js/ui/drawer.js', 'js/ui/housekeeper.js',
    'js/ui/receiptview.js', 'js/ui/welcome.js', 'js/app.js'].map(read).join('\n');
  const controlIds = [...html.matchAll(/<(button|select|input|textarea)[^>]*\sid="([^"]+)"/g)].map((m) => m[2]);
  const unwired = controlIds.filter((id) => !js.includes(`'${id}'`) && !js.includes(`"${id}"`) && !js.includes(`getElementById('${id}')`));
  assert(unwired.length === 0, `controls with no wiring anywhere: ${unwired.join(', ')}`);
});
