/* Cozy Tavern — js/assemble/plain.js
 * M354: WHAT A SMALL MODEL NEEDS, AND ONLY WHEN THE DERESTRICTED SWITCH IS ON.
 *
 * The writer is telling his story with a 27B model (Hemmingway-1, a Qwen3.8-27B finetune). Its own card says where it
 * wins and where it loses: it wins everyday writing, sounding like a person and reading the room — and it LOSES on
 * "hostile storytelling" and "long story turns". Both losses fall out of the same training: a model tuned to give
 * people the finished thing they asked for will (1) soften anyone set against the writer, and (2) on a long turn,
 * finish the scene — which means writing the writer's own character's lines, thoughts and choices, because a scene
 * with nobody answering is not "finished". That is exactly what he sees: cringe words in his character's mouth, his
 * character moved for him, and everyone in the room agreeing with him.
 *
 * So, behind the switch only:
 *   - THE PLAIN RULES: five short lines in his own voice, at the end where a small model looks hardest — his character
 *     is his; people set against him stay set against him; let the room speak; end where he can act; stay in the moment.
 *     Five, not fifteen: a small model keeps a few rules and drops a list.
 *   - THE GUARD: the finished page is read for his character's own speech, thoughts and moves, and a page that took
 *     them is asked for again, ONCE, with those cut. Detection here, the asking in ui/chat.js.
 *
 * THE LAW OF THIS FILE (M354): nothing here is ever sent, counted, or run with the switch OFF. Every help for a small
 * model lives behind it, so his frontier model's turn is byte-for-byte what it was before any of this existed. */

/* the five lines, said as the writer would say them */
export function plainRules(mcName) {
  const who = mcName && mcName !== 'the player' ? mcName : 'my character';
  return [
    'While we tell this one, five things, and nothing else from me:',
    who + ' is mine. Never his words, never his thoughts, never a move he did not make — write everyone else and leave his side of it to me.',
    'Anyone set against him stays set against him: nobody folds, agrees or softens just because he showed up. If someone wants something he is in the way of, they keep wanting it this page.',
    'Let the room talk. The people here have their own mouths — several real exchanges, each in their own way of speaking, never a line of his.',
    'End where I can act: on a live beat, mid-moment, with something still open. No winding down, no summing up what just happened.',
    'Stay in the moment as it is happening — what is seen, heard and touched right now, in your own plain words, and nothing explained afterwards.',
  ].join('\n');
}

/* his character's names — the story name he plays under, and the fuller forms of it the ledger knows */
export function mineNames(mc, also = []) {
  const out = [];
  const add = (n) => { const s = String(n || '').trim(); if (s && s.toLowerCase() !== 'the player' && !out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s); };
  add(mc);
  for (const n of Array.isArray(also) ? also : []) add(n);
  return out;
}

const SAYS = 'said|says|asked|asks|replied|replies|answered|answers|muttered|mutters|whispered|whispers|shouted|shouts|added|adds|breathed|breathes|murmured|murmurs|snapped|snaps|laughed|laughs|told|tells|calls|called|growled|growls|sighed|sighs|offered|offers|countered|counters';
const INNER = 'thought|thinks|realised|realized|realises|realizes|decided|decides|wondered|wonders|felt|feels|knew|knows|remembered|remembers|hoped|hopes|feared|fears|wanted|wants|chose|chooses|understood|understands';
const MOVES = 'stepped|steps|walked|walks|ran|runs|drew|draws|grabbed|grabs|took|takes|turned|turns|nodded|nods|shrugged|shrugs|smiled|smiles|grinned|grins|reached|reaches|pulled|pulls|pushed|pushes|sat|sits|stood|stands|opened|opens|closed|closes|kissed|kisses|hugged|hugs|struck|strikes|swung|swings|lunged|lunges|drank|drinks|ate|eats|left|leaves|entered|enters|knelt|kneels|raised|raises|lowered|lowers|lifted|lifts|crossed|crosses|followed|follows|leaned|leans';

const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* what is inside quotation marks is someone's speech, not the page speaking about him */
const unquoted = (text) => String(text || '').replace(/[“"][^”"]{0,600}[”"]/g, ' ').replace(/[‘'][^’']{0,600}[’']/g, ' ');

/* A page may render what the WRITER just wrote — his own line, his own move — and that is never a theft. So every
 * suspect fragment is weighed against his own words first: if most of what it says is already in his message, the page
 * is telling his move back, not taking it. */
const words = (t) => String(t || '').toLowerCase().match(/[a-z0-9’']{3,}/g) || [];
const STOP = new Set(['the', 'and', 'but', 'for', 'with', 'that', 'this', 'his', 'her', 'him', 'she', 'they', 'them', 'was', 'were', 'had', 'has', 'not', 'you', 'your', 'from', 'into', 'over', 'out', 'are', 'its', 'then', 'than', 'there', 'here', 'what', 'who', 'when', 'where', 'been', 'have', 'will', 'would', 'could', 'should', 'just', 'still', 'like', 'now']);
export function echoesWriter(fragment, writerText) {
  const mine = words(writerText);
  if (!mine.length) return false;
  const said = new Set(mine);
  const bits = words(fragment).filter((w) => !STOP.has(w));
  if (!bits.length) return false;
  const shared = bits.filter((w) => said.has(w) || [...said].some((s) => (w.length > 4 && s.startsWith(w.slice(0, 4))) || (s.length > 4 && w.startsWith(s.slice(0, 4))))).length;
  return shared / bits.length >= 0.5;
}

/* every line the page put in his mouth, either way round */
function hisLines(text, who) {
  const out = [];
  const after = new RegExp('\\b' + who + '(?:\\s+\\w+){0,2}\\s+(?:' + SAYS + ')\\b[^.!?\\n]{0,40}[“"]([^”"]{1,400})[”"]', 'ig');
  const before = new RegExp('[“"]([^”"]{1,400})[”"][,\\s]{0,3}[^”"\\n]{0,40}?\\b' + who + '\\s+(?:' + SAYS + ')\\b', 'ig');
  const flipped = new RegExp('[“"]([^”"]{1,400})[”"][,\\s]{0,3}(?:' + SAYS + ')\\s+' + who + '\\b', 'ig');
  for (const re of [after, before, flipped]) { let m; while ((m = re.exec(text)) !== null) out.push(m[1]); }
  return out;
}

/* the sentence a word stands in — what is weighed against the writer's own message */
function sentenceAround(text, at) {
  const from = Math.max(0, text.lastIndexOf('.', at) + 1, text.lastIndexOf('\n', at) + 1);
  const dot = text.indexOf('.', at);
  return text.slice(from, dot === -1 ? text.length : dot + 1);
}

/* Did this page take his character? Returns '' when it did not, else what it took, in words. Deliberately narrow: a
 * page may still SAY his name (he is in the scene, he is looked at, he is spoken to) — only his own speech, his own
 * inner life, and moves he did not make are his, and anything his own message already said is never counted. */
export function mineLeak(page, { mc = '', also = [], writerText = '' } = {}) {
  const names = mineNames(mc, also);
  if (!names.length) return '';
  const text = stripFurniture(page); /* M357: the header names his room, his coat and where he stands — never his doing */
  if (!text.trim()) return '';
  const who = '(?:' + names.map(escape).join('|') + ')';
  for (const line of hisLines(text, who)) if (!echoesWriter(line, writerText)) return 'gave him words of his own';
  const bare = unquoted(text);
  const inner = new RegExp('\\b' + who + '\\s+(?:' + INNER + ')\\b', 'ig');
  let hit;
  while ((hit = inner.exec(bare)) !== null) if (!echoesWriter(sentenceAround(bare, hit.index), writerText)) return 'thought and decided for him';
  const moves = new RegExp('\\b' + who + '\\s+(?:' + MOVES + ')\\b', 'ig');
  while ((hit = moves.exec(bare)) !== null) if (!echoesWriter(sentenceAround(bare, hit.index), writerText)) return 'moved him without me';
  return '';
}

/* M355: THE SAME WORDS AGAIN. A 27B tells a good page and then tells it again — the same simile, the same half-sentence,
 * the same opening beat, three pages running. It is not a thinking failure and no instruction fixes it after the fact;
 * it is what a narrow model does when the scene, the ledger and the last pages all say the same thing every turn. What
 * the house CAN do is see it and ask once for the page again, naming the phrases it reused. Mechanical, no model, no
 * sampler touched (his dials are his: M12) — and, like everything else here, only with the derestricted switch on. */
const SHINGLE = 6;             /* a phrase this long, said twice, is a phrase reused — not a turn of grammar */
const PLAIN_WORDS = new Set(['the', 'and', 'but', 'for', 'with', 'that', 'this', 'his', 'her', 'him', 'she', 'they', 'them', 'was', 'were', 'had', 'has', 'not', 'you', 'your', 'from', 'into', 'over', 'out', 'are', 'its', 'then', 'than', 'there', 'here', 'what', 'who', 'when', 'where', 'been', 'have', 'will', 'would', 'could', 'should', 'just', 'still', 'like', 'now', 'said', 'says', 'asked', 'asks', 'back', 'down', 'again', 'all', 'one', 'two', 'her', 'their', 'our', 'any', 'off', 'about']);
const wordsOf = (t) => String(t || '').toLowerCase().match(/[a-z0-9’']+/g) || [];
/* M357: A PAGE'S FURNITURE IS NOT ITS PROSE. The header line ([the courtyard — Monday | 09:00 | clear | coat | by the
 * gate]) and any bracketed row is the same shape on every page BY DESIGN — the writer: "why the repetition flagged
 * header wtf". It is cut before anything here is counted, in both readings. */
export const stripFurniture = (t) => String(t || '').split('\n').filter((line) => !/^\s*[[（(].*[\]）)]\s*$/.test(line)).join('\n');
function shinglesOf(text, n = SHINGLE) {
  const w = wordsOf(text);
  const out = [];
  for (let i = 0; i + n <= w.length; i += 1) out.push(w.slice(i, i + n));
  return out;
}
const worthNaming = (shingle) => new Set(shingle.filter((w) => !PLAIN_WORDS.has(w) && w.length > 2)).size >= 3;

/* the phrases this page says that the pages before it (or it itself) already said — his own words never count, and
 * overlapping runs are one phrase, not three */
export function echoedPhrases(rawPage, rawBefore = [], { writerText = '', names = [] } = {}) {
  const page = stripFurniture(rawPage);
  const before = (Array.isArray(rawBefore) ? rawBefore : []).map(stripFurniture);
  const older = new Set();
  for (const past of before) for (const s of shinglesOf(past)) older.add(s.join(' '));
  const mine = new Set(shinglesOf(writerText).map((s) => s.join(' ')));
  const ownNames = new Set((Array.isArray(names) ? names : []).flatMap((n) => wordsOf(n)));
  const shingles = shinglesOf(page);
  const seen = new Set();
  const found = [];
  let i = 0;
  while (i < shingles.length) {
    const phrase = shingles[i].join(' ');
    const worth = worthNaming(shingles[i].filter((w) => !ownNames.has(w)));
    const again = worth && !mine.has(phrase) && (older.has(phrase) || seen.has(phrase));
    seen.add(phrase);
    if (!again) { i += 1; continue; }
    /* one phrase, however many shingles the run covers */
    const words = [...shingles[i]];
    let j = i + 1;
    while (j < shingles.length && words.length < 14) {
      const next = shingles[j].join(' ');
      if (!(older.has(next) || seen.has(next)) || mine.has(next)) break;
      seen.add(next);
      words.push(shingles[j][shingles[j].length - 1]);
      j += 1;
    }
    found.push(words.join(' '));
    if (found.length >= 3) break;
    i = j + 1;
  }
  return found;
}

/* Did this page say what has already been said? '' when it did not, else the phrases it reused. */
export function staleLeak(page, before = [], opts = {}) {
  const text = stripFurniture(page);
  if (text.trim().length < 400) return [];               /* too short to judge; a brief page repeats nothing much */
  return echoedPhrases(text, before, opts);
}

/* M357: SAID BEFORE THE NEXT PAGE, NEVER BY SENDING THE PAGE BACK. The house used to hand a page that took his
 * character (M354) or repeated itself (M355) straight back to the model and ask for it again — the writer: "why the
 * repetition mode is basically make it resend the page again, why not giving it critique before it reply based on
 * previous scene? That's breaking immersion." He is right: a page that has landed is the story. What the house saw is
 * said ONCE at the end of the NEXT turn, in his voice, as a note between the two of them — and then let go. */
export function mineWord(took, mc) {
  if (!took) return '';
  const who = mc && mc !== 'the player' ? mc : 'my character';
  return 'That last page ' + took + ' — ' + who + ' is mine to play. Leave his words, his thoughts and his moves to me from here.';
}
export function staleWord(phrases = []) {
  const said = (Array.isArray(phrases) ? phrases : []).slice(0, 3).filter(Boolean).map((p) => '“' + String(p).trim() + '”');
  if (!said.length) return '';
  return 'The last page said what we had already said — ' + said.join(', ') + '. Find other words for it this time, and don’t open the way the last pages opened.';
}
