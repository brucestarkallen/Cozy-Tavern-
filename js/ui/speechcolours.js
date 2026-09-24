/* Cozy Tavern — the spoken lines' and the thoughts' colours, per coat (M466).
 *
 * The writer: "each theme I can customize the dialog colour". Every coat
 * ships its own --spoken and --thought (base.css); here he may choose others
 * for the coat he wears, and each coat keeps its own pair ("speechColours":
 * { fantasy: { spoken, thought }, … }). A chosen colour is laid over the
 * coat's token as an inline style on <html> — inline beats the stylesheet, so
 * every .spoken and .thought in the house follows at once, and the drawer's
 * own re-scoped tokens (the academy's parchment) are untouched. "This coat's
 * own colours" lets the pair go.
 *
 * A colour is measured as it is picked against the ground it will stand on
 * (the room's background) and the number is shown; under AA the line says so
 * and offers to brighten it until it reads — a tap, never a silent change of
 * his choice. */
import { db } from '../store.js';

const KEY = 'speechColours';
const TOKENS = { spoken: '--spoken', thought: '--thought' };
let cache = null; /* the map as last read or written, so a coat change applies without a wait */

function coatNow() {
  return (typeof document !== 'undefined' && document.documentElement && document.documentElement.dataset.theme) || 'dark';
}
function isHex(v) { return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v); }

async function readMap() {
  const raw = await db.settings.get(KEY).catch(() => null);
  const map = {};
  if (raw && typeof raw === 'object') {
    for (const [coat, pair] of Object.entries(raw)) {
      if (!pair || typeof pair !== 'object') continue;
      const out = {};
      if (isHex(pair.spoken)) out.spoken = pair.spoken.toLowerCase();
      if (isHex(pair.thought)) out.thought = pair.thought.toLowerCase();
      if (Object.keys(out).length) map[coat] = out;
    }
  }
  cache = map;
  return map;
}

function lay(coat, map) {
  const root = document.documentElement;
  const pair = (map && map[coat]) || {};
  for (const [k, token] of Object.entries(TOKENS)) {
    if (isHex(pair[k])) root.style.setProperty(token, pair[k]);
    else root.style.removeProperty(token);
  }
}

/* called by app.js every time the coat is applied; the first call reads the map */
export function applySpeechColours(coat) {
  const c = coat || coatNow();
  if (cache) { lay(c, cache); return Promise.resolve(); }
  return readMap().then((map) => lay(c, map)).catch(() => {});
}

/* ---- contrast ---- */
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbToHex([r, g, b]) { return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
function lum([r, g, b]) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) { const la = lum(a); const lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
function parseColour(css) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(String(css || ''));
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  if (isHex(String(css || '').trim())) return hexToRgb(String(css).trim());
  return null;
}
function groundNow() {
  const body = document.body ? getComputedStyle(document.body).backgroundColor : '';
  return parseColour(body) || [22, 18, 15];
}
/* the same hue, moved toward the light (a dark ground) or the dark (a light ground) until it reads at 4.5:1 */
function readable(hex, ground) {
  let rgb = hexToRgb(hex);
  if (ratio(rgb, ground) >= 4.5) return hex;
  const towardWhite = lum(ground) < 0.5;
  for (let step = 0; step < 40 && ratio(rgb, ground) < 4.5; step += 1) {
    rgb = rgb.map((v) => (towardWhite ? v + (255 - v) * 0.12 : v * 0.88));
  }
  return rgbToHex(rgb);
}

export function initSpeechColours(ctx) {
  const box = document.getElementById('speech-colours');
  const inputs = { spoken: document.getElementById('speech-colour-spoken'), thought: document.getElementById('speech-colour-thought') };
  const reads = { spoken: document.getElementById('speech-colour-spoken-reads'), thought: document.getElementById('speech-colour-thought-reads') };
  const coatName = document.getElementById('speech-colours-coat');
  const reset = document.getElementById('btn-speech-colours-reset');
  if (!box || !inputs.spoken || !inputs.thought || !reset) return null;

  const COAT_WORDS = { fantasy: 'Fantasy', cyberpunk: 'Cyberpunk', magma: 'Magma', academy: 'The academy', aurora: 'Aurora', starship: 'Starship', deep: 'The deep', dark: 'Lamplight', light: 'Daylight' };

  function coatOwn(k) {
    /* the coat's own colour: read with the override lifted for a moment */
    const root = document.documentElement;
    const kept = root.style.getPropertyValue(TOKENS[k]);
    root.style.removeProperty(TOKENS[k]);
    const own = getComputedStyle(root).getPropertyValue(TOKENS[k]).trim();
    if (kept) root.style.setProperty(TOKENS[k], kept);
    const rgb = parseColour(own);
    return rgb ? rgbToHex(rgb) : (isHex(own) ? own : '#e8c98a');
  }

  function say(k, hex) {
    const el = reads[k];
    if (!el) return;
    el.textContent = '';
    const rgb = hexToRgb(hex);
    const r = ratio(rgb, groundNow());
    const words = document.createElement('span');
    words.textContent = 'reads at ' + (Math.round(r * 10) / 10) + ':1 on this coat' + (r < 4.5 ? ' — hard to read' : '');
    el.appendChild(words);
    if (r < 4.5) {
      const fix = document.createElement('button');
      fix.type = 'button';
      fix.className = 'text-btn';
      fix.textContent = 'Brighten it until it reads';
      fix.addEventListener('click', async () => {
        const better = readable(hex, groundNow());
        inputs[k].value = better;
        await keep(k, better);
      });
      el.append(' ', fix);
    }
  }

  async function keep(k, hex) {
    const coat = coatNow();
    const map = cache || await readMap();
    map[coat] = { ...(map[coat] || {}), [k]: hex.toLowerCase() };
    cache = map;
    await db.settings.set(KEY, JSON.parse(JSON.stringify(map)));
    lay(coat, map);
    say(k, hex);
  }

  for (const k of Object.keys(inputs)) {
    /* as the picker moves: the room follows live, and the number with it */
    inputs[k].addEventListener('input', () => { if (isHex(inputs[k].value)) { document.documentElement.style.setProperty(TOKENS[k], inputs[k].value); say(k, inputs[k].value); } });
    inputs[k].addEventListener('change', async () => { if (isHex(inputs[k].value)) await keep(k, inputs[k].value); });
  }
  reset.addEventListener('click', async () => {
    const coat = coatNow();
    const map = cache || await readMap();
    delete map[coat];
    cache = map;
    await db.settings.set(KEY, JSON.parse(JSON.stringify(map)));
    lay(coat, map);
    await reload();
  });

  async function reload() {
    const coat = coatNow();
    const map = cache || await readMap();
    lay(coat, map);
    if (coatName) coatName.textContent = COAT_WORDS[coat] || coat;
    for (const k of Object.keys(inputs)) {
      const chosen = map[coat] && map[coat][k];
      const hex = isHex(chosen) ? chosen : coatOwn(k);
      inputs[k].value = hex;
      say(k, hex);
    }
    reset.disabled = !map[coat];
  }

  /* the coat's radio was tapped: the pickers show that coat's pair */
  document.querySelectorAll('input[name="theme"]').forEach((radio) => radio.addEventListener('change', () => { setTimeout(() => { reload().catch(() => {}); }, 30); }));

  reload().catch(() => {});
  const api = { reload, apply: applySpeechColours };
  if (ctx) ctx.speechColours = api;
  return api;
}
