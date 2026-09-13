/* The OLD fuzzy scan, verbatim, run beside the new one on a thousand cases. */
import { locate, wordDistance, minimalDiff } from '../../js/agents/housekeeper.js';

const FUZZY_FLOOR = 0.78, FUZZY_GAP = 0.05, FUZZY_MAX_WORDS = 8000;
function wordsOf(text) {
  const out = []; const re = /\S+/g; let m; const s = String(text);
  while ((m = re.exec(s))) {
    const raw = m[0];
    const cmp = raw.toLowerCase().replace(/^[\s"'“”‘’([{<.,;:!?—–-]+|[\s"'“”‘’)\]}>.,;:!?—–-]+$/g, '');
    out.push({ raw, cmp, start: m.index, end: m.index + raw.length });
  }
  return out;
}
function oldFuzzy(hay, ned) {
  const hWords = wordsOf(hay);
  const nWords = wordsOf(ned).map((w) => w.cmp).filter(Boolean);
  const n = nWords.length;
  if (!n) return { error: 'no words' };
  if (hWords.length > FUZZY_MAX_WORDS) return { error: 'too long' };
  const spread = Math.max(2, Math.round(n * 0.2));
  const nSet = new Set(nWords);
  let best = null;
  const minLen = Math.max(1, n - spread), maxLen = n + spread;
  for (let i = 0; i + minLen <= hWords.length; i += 1) {
    for (let L = minLen; L <= maxLen && i + L <= hWords.length; L += 1) {
      const win = hWords.slice(i, i + L).map((w) => w.cmp);
      let overlap = 0; for (const w of win) if (nSet.has(w)) overlap += 1;
      if (overlap < Math.ceil(n * 0.4)) continue;
      const sim = 1 - wordDistance(nWords, win) / Math.max(n, L);
      if (!best || sim > best.sim) best = { i, L, sim };
    }
  }
  if (!best) return { error: 'nothing close' };
  let second = null;
  for (let i = 0; i + minLen <= hWords.length; i += 1) {
    for (let L = minLen; L <= maxLen && i + L <= hWords.length; L += 1) {
      if (i < best.i + best.L && best.i < i + L) continue;
      const win = hWords.slice(i, i + L).map((w) => w.cmp);
      let overlap = 0; for (const w of win) if (nSet.has(w)) overlap += 1;
      if (overlap < Math.ceil(n * 0.4)) continue;
      const sim = 1 - wordDistance(nWords, win) / Math.max(n, L);
      if (!second || sim > second.sim) second = { i, L, sim };
    }
  }
  if (best.sim < FUZZY_FLOOR) return { error: 'not close enough' };
  if (second && second.sim > best.sim - FUZZY_GAP) return { error: 'too alike' };
  const start = hWords[best.i].start, end = hWords[best.i + best.L - 1].end;
  const md = minimalDiff(ned, hay.slice(start, end));
  const tightStart = start + md.prefix;
  return { start: tightStart, end: Math.max(tightStart + 1, end - md.suffix) };
}

const WORDS = 'rain shutters lantern draught ferryman chapel harvest debt cup ledge sill table stool north road she he said meant answered swung little quiet cold grey morning evening bread wine coin letter horse gate wall stone'.split(' ');
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = () => WORDS[Math.floor(rnd() * WORDS.length)];

let same = 0, diff = 0;
for (let t = 0; t < 600; t += 1) {
  const nWords = 6 + Math.floor(rnd() * 24);
  const pageWords = 60 + Math.floor(rnd() * 400);
  const page = Array.from({ length: pageWords }, pick).join(' ');
  let needle;
  if (rnd() < 0.55) {
    // take a real span and perturb it — the fuzzy path
    const at = Math.floor(rnd() * Math.max(1, pageWords - nWords));
    const span = page.split(' ').slice(at, at + nWords);
    const k = Math.floor(rnd() * 3);
    for (let j = 0; j < k; j += 1) span[Math.floor(rnd() * span.length)] = pick();
    needle = span.join(' ');
  } else {
    needle = Array.from({ length: nWords }, pick).join(' ');
  }
  const a = locate(page, needle);
  const b = oldFuzzy(page, needle);
  const aKey = a.ok ? (a.via === 'fuzzy' ? 'F' + a.start + ':' + a.end : a.via) : 'refused';
  const bKey = b.error ? 'refused' : 'F' + b.start + ':' + b.end;
  // exact/normalized hits never reach the fuzzy scan — compare only fuzzy/refusal
  if (a.ok && a.via !== 'fuzzy') continue;
  if (aKey === bKey) same += 1;
  else { diff += 1; if (diff <= 4) console.log('  DIFFERS  new=' + aKey + '  old=' + bKey + '  needle="' + needle.slice(0, 50) + '"'); }
}
console.log('fuzzy cases compared: ' + (same + diff) + '  identical: ' + same + '  differing: ' + diff);
