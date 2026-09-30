/* Cozy Tavern — assemble/smallprose.js (M512)
 * THE SMALL MODEL'S EAR. His word: "make the small model the best — realistic, beautiful prose, natural, no old LLM
 * repetition". A small model writes like what it read last, and the only prose it read was its own last eight pages: a
 * stock phrase written once was written again, page after page, and nothing held up how the story sounds at its best.
 * Pure readers of the story's own pages (no store, no DOM, no model):
 *   sceneParagraphs(text)       the page's prose — no header line, no world beyond, no screen or boxed object
 *   voicePassage(text)          its best run of one to three paragraphs, word for word (narration and speech together)
 *   pickVoicePage(pages, opts)  which page it comes from: the newest page a big model wrote, older than the pages sent
 *                               whole; else the page of the story that repeats the others least
 *   voiceSampleOf(pages, opts)  both together: { text, at } or null
 *   wornPhrases(texts, opts)    the turns of phrase the last pages keep using — four words or more, in two pages or
 *                               more, never a name, a place or small words alone, never a stretched sound */
import { windowCutAt } from '../engine/window.js';

const OBJECTS = /<!--\s*GFX_START[\s\S]*?(?:<!--\s*GFX_END\s*-->|$)|```[\s\S]*?(?:```|$)/g;
const THOUGHT_MARKS = /\*?~\/?t~\*?/g;

/* the page's prose paragraphs, in order */
export function sceneParagraphs(text) {
  let t = String(text == null ? '' : text).replace(/\r/g, '');
  const cut = windowCutAt(t);
  if (cut !== -1) t = t.slice(0, cut);
  t = t.replace(OBJECTS, '\n\n');
  t = t.replace(/^\s*\[[^\]\n]{0,400}\][ \t]*(?:\n|$)/, ''); /* the header line */
  return t.split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !/^\[[^\]\n]*\]$/.test(p) && !/^[#|>]/.test(p) && !/^[*\-—–_=~•✦\s]+$/.test(p));
}

const hasSpeech = (p) => /["“”]/.test(p);
const hasNarration = (p) => p.replace(/["“][^"”]*["”]/g, '').replace(/\s+/g, ' ').trim().length >= 60;

/* a paragraph longer than the room, cut at its last sentence end inside it */
function cutToRoom(p, room) {
  if (p.length <= room) return p;
  const head = p.slice(0, room);
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('." '), head.lastIndexOf('.” '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  return end > room * 0.4 ? head.slice(0, end + 1).trim() : '';
}

/* the page's best run of one to three paragraphs within the room: speech and narration together first, then the fuller */
export function voicePassage(text, { cap = 1400, min = 450 } = {}) {
  const paras = sceneParagraphs(text).filter((p) => p.length >= 40);
  let best = null;
  for (let i = 0; i < paras.length; i += 1) {
    const run = [];
    let size = 0;
    for (let j = i; j < Math.min(paras.length, i + 3); j += 1) {
      const room = cap - size - (run.length ? 2 : 0);
      const piece = cutToRoom(paras[j], room);
      if (!piece) break;
      run.push(piece);
      size += piece.length + (run.length > 1 ? 2 : 0);
      const words = run.join('\n\n');
      const score = Math.min(size, cap) + (run.some(hasSpeech) ? 500 : 0) + (run.some(hasNarration) ? 300 : 0) + (i > 0 ? 100 : 0); /* an opening often only sets the stage */
      if (size >= min && (!best || score > best.score)) best = { words, score };
      if (piece !== paras[j]) break; /* cut short at its sentence: the run ends there (and still counts) */
    }
  }
  return best ? best.words : '';
}

/* word n-grams of a text, sentence by sentence */
function sentencesOf(text) {
  return sceneParagraphs(text).join('\n\n').replace(THOUGHT_MARKS, ' ').split(/(?<=[.!?…])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}
const WORD = /[\p{L}\p{N}][\p{L}\p{N}’'-]*/gu;
function gramsOf(text, n) {
  const out = new Set();
  for (const s of sentencesOf(text)) {
    const w = (s.match(WORD) || []).map((x) => x.toLowerCase());
    for (let i = 0; i + n <= w.length; i += 1) out.add(w.slice(i, i + n).join(' '));
  }
  return out;
}

/* which page the voice comes from */
export function pickVoicePage(pages, { skipNewest = 8, min = 450, look = 60 } = {}) {
  const list = (Array.isArray(pages) ? pages : []).filter((p) => p && typeof p.text === 'string');
  const older = list.slice(0, Math.max(0, list.length - skipNewest)).map((p, i) => ({ ...p, i }));
  const holds = (p) => voicePassage(p.text, { min }).length >= min;
  /* the newest page a big model wrote that holds a passage — read from the newest back, and no further than needed (a
   * six-hundred-page story read every page's paragraphs on every send: ~50 ms, ×6 on his phone) */
  for (let k = older.length - 1; k >= 0; k -= 1) if (older[k].big === true && holds(older[k])) return older[k];
  /* no page a big model wrote: the one that repeats the rest least (a page stuck in the story's worn phrases is the
   * last one to hold up), among the newest few dozen */
  const pool = older.slice(-look).filter(holds);
  if (!pool.length) return null;
  const grams = pool.map((p) => gramsOf(p.text, 4));
  const seen = new Map();
  grams.forEach((g) => { for (const k of g) seen.set(k, (seen.get(k) || 0) + 1); });
  let best = null;
  pool.forEach((p, k) => {
    const g = grams[k];
    if (!g.size) return;
    let own = 0;
    for (const x of g) if (seen.get(x) === 1) own += 1;
    const words = (sentencesOf(p.text).join(' ').match(WORD) || []).map((w) => w.toLowerCase());
    const richness = words.length ? new Set(words).size / Math.sqrt(words.length) : 0;
    const score = own / g.size + richness / 20;
    if (!best || score > best.score) best = { p, score };
  });
  return best ? best.p : null;
}

export function voiceSampleOf(pages, opts = {}) {
  const page = pickVoicePage(pages, opts);
  if (!page) return null;
  const text = voicePassage(page.text, opts);
  return text ? { text, at: page.i, big: page.big === true } : null;
}

const SMALL_WORDS = new Set(('a an the and or but nor so yet of to in on at by for with from into onto upon over under out up down off '
  + 'as than then that this these those there here it its it’s it\'s is was were be been being am are do did does done '
  + 'have has had having he she they we you i me him her them us his hers their our your my mine not no nor only just '
  + 'very too also even still again all any some each every both one two own same other such what which who whom whose '
  + 'when where why how if while though although because until after before about against between through during '
  + 'without within across behind beside toward towards around like more most less least much many few can could '
  + 'would should will shall may might must let s t d ll re ve m o').split(/\s+/));

/* the turns of phrase the last pages keep using: every stretch of words a sentence shares with another page (four words or
 * more), taken whole — the longest stretch, as the page wrote it, commas and all — once */
let lastWorn = { key: null, out: [] }; /* the same pages read twice in one send (the probe, then the request) are read once */
export function wornPhrases(texts, { names = [], max = 6, minPages = 2, least = 4, longest = 12 } = {}) {
  const pages = (Array.isArray(texts) ? texts : []).map((t) => String(t == null ? '' : t)).filter((t) => t.trim());
  if (pages.length < 2) return [];
  const memo = pages.join('\u0001') + '\u0002' + (Array.isArray(names) ? names.join('\u0003') : '') + '\u0002' + [max, minPages, least, longest].join(',');
  if (lastWorn.key === memo) return lastWorn.out.slice();
  const out = wornUncached(pages, { names, max, minPages, least, longest });
  lastWorn = { key: memo, out };
  return out.slice();
}
function wornUncached(pages, { names, max, minPages, least, longest }) {
  /* a name, a title, a place: any word the pages write capitalised in the middle of a sentence, and every word of the
   * names the story knows */
  const proper = new Set();
  for (const n of Array.isArray(names) ? names : []) for (const w of String(n || '').match(WORD) || []) if (!SMALL_WORDS.has(w.toLowerCase())) proper.add(w.toLowerCase()); /* "the" of "the Tenth Division courtyard" is not a name */
  const read = pages.map((t) => sentencesOf(t).map((s) => {
    const toks = [];
    const re = new RegExp(WORD.source, 'gu');
    let m;
    while ((m = re.exec(s))) toks.push({ low: m[0].toLowerCase(), at: m.index, end: m.index + m[0].length, cap: /^\p{Lu}/u.test(m[0]) });
    const lows = toks.map((tok) => tok.low);
    const grams = []; /* each position's four-word key, made once */
    for (let i = 0; i + least <= lows.length; i += 1) grams.push(lows.slice(i, i + least).join(' '));
    return { s, toks, grams };
  }));
  for (const list of read) for (const { toks } of list) for (let i = 1; i < toks.length; i += 1) if (toks[i].cap) proper.add(toks[i].low);
  /* the four-word stretches found on two pages or more (or three times anywhere) */
  const seen = new Map();
  read.forEach((list, page) => { for (const { grams } of list) for (const k of grams) {
    const f = seen.get(k) || { pages: new Set(), count: 0 };
    f.pages.add(page); f.count += 1; seen.set(k, f);
  } });
  const repeated = (k) => { const f = seen.get(k); return Boolean(f) && (f.pages.size >= minPages || f.count >= 3); };
  /* each sentence's longest runs of repeated words, as the page wrote them */
  const spans = new Map();
  read.forEach((list, page) => { for (const { s, toks, grams } of list) {
    const marked = new Array(toks.length).fill(false);
    for (let i = 0; i < grams.length; i += 1) if (repeated(grams[i])) for (let j = i; j < i + least; j += 1) marked[j] = true;
    for (let i = 0; i < toks.length;) {
      if (!marked[i]) { i += 1; continue; }
      let j = i;
      while (j + 1 < toks.length && marked[j + 1]) j += 1;
      const run = toks.slice(i, j + 1);
      const key = run.map((t) => t.low).join(' ');
      const f = spans.get(key) || { key, words: run.map((t) => t.low), pages: new Set(), count: 0, shown: s.slice(run[0].at, run[run.length - 1].end) };
      f.pages.add(page); f.count += 1; spans.set(key, f);
      i = j + 1;
    }
  } });
  const worn = [...spans.values()].filter((f) => {
    if (f.pages.size < minPages && f.count < 3) return false;
    if (new Set(f.words).size < 3) return false; /* a stretched sound ("hah hah hah hah") is the page's sound, not a worn phrase */
    const content = f.words.filter((x) => !SMALL_WORDS.has(x) && !proper.has(x) && x.length >= 3 && !/^\d+$/.test(x));
    return content.length >= 2;
  }).sort((a, b) => (b.pages.size - a.pages.size) || (b.words.length - a.words.length) || (b.count - a.count));
  const kept = [];
  for (const f of worn) {
    if (kept.some((k) => (' ' + k.key + ' ').includes(' ' + f.key + ' ') || (' ' + f.key + ' ').includes(' ' + k.key + ' '))) continue; /* one phrase once */
    kept.push(f);
    if (kept.length >= max) break;
  }
  return kept.map((f) => {
    let shown = f.shown;
    if (f.words.length > longest) {
      const cut = new RegExp('^(?:[^\\p{L}\\p{N}]*[\\p{L}\\p{N}][\\p{L}\\p{N}’\'-]*){' + longest + '}', 'u').exec(shown);
      let head = cut ? cut[0] : shown;
      for (let m = /[\s,;:—–-]+([\p{L}’']+)$/u.exec(head); m && SMALL_WORDS.has(m[1].toLowerCase()); m = /[\s,;:—–-]+([\p{L}’']+)$/u.exec(head)) head = head.slice(0, m.index); /* never end on "the…" */
      shown = head + '…';
    }
    shown = shown.replace(/[,;:—–-]+$/, '');
    return proper.has(f.words[0]) ? shown : shown.charAt(0).toLowerCase() + shown.slice(1); /* a name keeps its capital */
  });
}

/* M519: WHEN THE SOUND DROWNS THE STORY. His word: "once the dashes and the sounds start, the small model spams them until
 * I literally can't read it — the masterful writing is gone, and it keeps that repeating structure." Two things kept it
 * going: every heated page was asked for "a voiced line that stretches or repeats" in EVERY paragraph (with a word when a
 * page went quiet, and none when it went too loud), and the small model's only example of how to write was its own last
 * eight pages — once they were strung with "Hah—HAH—hah—" and "I—can't—", each page copied the last.
 *   pageTexture(text)   how thick a page is with sounds and dashes, per hundred words
 *   tooLoud(textures)   the last pages past the band (the newest well past it, or two of the last three past it); once
 *                       loud, it stays so until the newest page is back under 70% of the band
 *   calmPage(text)      the same page with its strung-out sounds and dash chains eased — for the copy a small model
 *                       reads of its own recent pages while it is too loud; his stored page is never touched */
export const SOUND_BAND = 5;   /* sounds per hundred words a page may carry and still read */
export const DASH_BAND = 6;    /* dashes per hundred words */

/* the sounds of a page: contact sounds in asterisks, voiced lines that are sound more than words, and drawn-out letters */
/* a line that is only sound — interjections and drawn-out letters, nothing a person says in words */
const SOUND_WORD = /^(?:[a-z]*([a-z])\1\1[a-z]*|a+h+|o+h+|h+a+h*|h+e+h|n+g*h+|n+n+g*|g+k+h*|g+u+h|k+u+h|u+g+h+|a+r+g+h+|g+a+h+|m+|h+m+|t+c+h|u+h+|o+o+f|o+w+|e+h+|h+n+g*|k+h+|h+a+a+h*)$/i;
const SOUNDY = (inner) => { const toks = String(inner || '').split(/[—–…\s!?.,~-]+/).filter(Boolean); return toks.length > 0 && toks.every((w) => SOUND_WORD.test(w)); };
const VOICED = (inner) => /([a-z])\1\1/i.test(inner) || /^[^a-z]*[A-Za-z]{1,7}[—–-]+[!?.…]*[^a-z]*$/i.test(inner) || /(?:\b[A-Za-z]{1,5}[—–…]+[\s!?.]*){2,}/.test(inner) || /^(?:[a-z]{1,4}[—–…!]+\s*)+$/i.test(inner);
export function pageTexture(text) {
  const t = sceneParagraphs(text).join('\n\n');
  const words = (t.match(WORD) || []).length || 1;
  const effects = (t.match(/(^|[^*\w])\*(?!\s)[^*\n]{1,48}?(?<!\s)\*(?!\*)/g) || []).length;
  const voiced = [...t.matchAll(/[“"]([^”"\n]{1,48})[”"]/g)].filter((m) => VOICED(m[1].trim())).length;
  const drawn = (t.replace(/[“"][^”"\n]{1,48}[”"]/g, ' ').match(/\b[A-Za-z]*([a-z])\1\1[A-Za-z]*\b/gi) || []).length; /* "Ahhh", "Nnngh" outside a voiced line */
  const dashes = (t.match(/[—–]|--/g) || []).length;
  const base = Math.max(words, 150); /* a short page is not judged loud for two sounds in forty words */
  const per = (n) => Math.round((n * 1000) / base) / 10;
  return { words, sounds: effects + voiced + drawn, dashes, soundPer100: per(effects + voiced + drawn), dashPer100: per(dashes) };
}

const past = (x, k = 1) => x && (x.soundPer100 > SOUND_BAND * k || x.dashPer100 > DASH_BAND * k);
export function tooLoud(textures, { wasLoud = false } = {}) {
  const list = (Array.isArray(textures) ? textures : []).filter(Boolean).slice(-3);
  if (!list.length) return false;
  const newest = list[list.length - 1];
  if (wasLoud) return past(newest, 0.7); /* it eases only when the newest page is well back inside the band */
  return past(newest, 1.5) || list.filter((x) => past(x)).length >= 2;
}

export function calmPage(text) {
  let t = String(text == null ? '' : text);
  /* the same word said over and over with dashes — "roared—roared—roared", "steel—steel—steel—" — once */
  t = t.replace(/\b([\w’']+)(?:[—–]\1\b)+/gi, '$1');
  /* a sound said over and over — "Hah—HAH—hah—Hah—" — is said twice */
  t = t.replace(/\b([A-Za-z]{1,8})((?:[—–]|-{2}|…|\.{3})[!?]*)(?:\s*\1(?:[—–]|-{2}|…|\.{3})[!?]*){2,}/gi, (m, w, sep) => w + sep + w.toUpperCase() + sep);
  /* a chain of broken fragments — "I—can't—stop—it—", "Nngh—ahh—AHHH—" — keeps its first two */
  t = t.replace(/(\b[\w’']{1,12}[—–])(\s*[\w’']{1,12}[—–]){2,}/g, (m) => m.split(/(?<=[—–])/).slice(0, 2).join(''));
  /* the same sound in asterisks again and again — *thud* *thud* *thud* — once */
  t = t.replace(/(\*[^*\n]{1,40}\*)(?:[\s,.!]*\1)+/gi, '$1');
  /* two or more lines of nothing but sound in a row keep the first */
  t = t.replace(/((?:^|\n\n)\s*(?:["“][^"”\n]{1,40}["”]|\*[^*\n]{1,40}\*)[!?.]*[ \t]*)(?:\n\n\s*(?:["“][^"”\n]{1,40}["”]|\*[^*\n]{1,40}\*)[!?.]*[ \t]*)+(?=\n\n|$)/g, '$1');
  /* the breath it is asked for, shown: a paragraph keeps its first sound — the others (asterisked sounds, lines that are
   * sound more than words) go; a sentence with three dashes or more keeps its first, the rest become commas. Real speech
   * and a sentence's own dash or pair of dashes are left as they are. */
  t = t.split(/(\n\s*\n)/).map((para) => {
    if (/^\s*$/.test(para)) return para;
    let heard = false;
    let out = para.replace(/(\*(?!\s)[^*\n]{1,48}?(?<!\s)\*(?!\*))|([“"])([^”"\n]{1,48})([”"])/g, (m, star, q1, inner, q2) => {
      const sound = Boolean(star) || SOUNDY(String(inner || '').trim()); /* only a line of pure sound — "Wait—" is speech and stays */
      if (!sound) return m;
      if (heard) return '';
      heard = true;
      return m;
    });
    out = out.replace(/[^.!?\n]*[.!?]?/g, (sentence) => {
      const parts = sentence.split(/([“"][^”"\n]*[”"])/); /* speech keeps its own dashes */
      const outside = parts.filter((x, i) => i % 2 === 0).join('');
      if ((outside.match(/[—–]/g) || []).length < 3) return sentence;
      let first = true;
      return parts.map((x, i) => (i % 2 ? x : x.replace(/[—–]/g, () => { if (first) { first = false; return '—'; } return ', '; }))).join('');
    });
    return out.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').replace(/,\s*,/g, ',').trim() ? out.replace(/[ \t]{2,}/g, ' ').replace(/ +([,.!?])/g, '$1') : '';
  }).join('');
  return t.replace(/\n{3,}/g, '\n\n');
}
