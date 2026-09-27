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
 * So, behind the small-model mode only (M510: the mode is the storyteller connection's own "Small model" tick):
 *   - THE GUARD: the finished page is read for his character's own speech, thoughts and moves. M510: where the page
 *     began writing his side, it ENDS — before it is kept, so neither the page nor the ledger holds what he never did
 *     (mineCutAt; the same repair M469 makes when a model runs on into his next turn).
 *   - THE SOUNDS: how many sound effects and voiced sounds a page carried (soundCount) — the planning helper is told
 *     when a fight or a heated page went quiet.
 * M510 retired the five plain lines (one fought his #p, one asked for "plain words" against his onomatopoeia law) and
 * the "same words again" note (it quoted the repeated phrase back to the model; the connection's own penalties do that
 * job now).
 *
 * THE LAW OF THIS FILE (M354): nothing here is ever sent, counted, or run with the switch OFF. Every help for a small
 * model lives behind it, so his frontier model's turn is byte-for-byte what it was before any of this existed. */

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

/* M357: A PAGE'S FURNITURE IS NOT ITS PROSE. The header line ([the courtyard — Monday | 09:00 | clear | coat | by the
 * gate]) and any bracketed row is the same shape on every page BY DESIGN — the writer: "why the repetition flagged
 * header wtf". It is cut before anything here is counted, in both readings. */
export const stripFurniture = (t) => String(t || '').split('\n').filter((line) => !/^\s*[[（(].*[\]）)]\s*$/.test(line)).join('\n');

/* M357: SAID BEFORE THE NEXT PAGE, NEVER BY SENDING THE PAGE BACK. The house used to hand a page that took his
 * character (M354) or repeated itself (M355, retired at M510) straight back to the model and ask for it again — the writer: "why the
 * repetition mode is basically make it resend the page again, why not giving it critique before it reply based on
 * previous scene? That's breaking immersion." He is right: a page that has landed is the story. What the house saw is
 * said ONCE at the end of the NEXT turn, in his voice, as a note between the two of them — and then let go. */
export function mineWord(took, mc) {
  if (!took) return '';
  const who = mc && mc !== 'the player' ? mc : 'my character';
  return 'That last page ' + took + ' — ' + who + ' is mine to play. Leave his words, his thoughts and his moves to me from here.';
}

/* M510: WHERE THE PAGE BEGAN WRITING HIS SIDE — the start of the sentence that first gave him words, thoughts or a move
 * he did not make (the same three readings as mineLeak, anything his own message said never counted), or -1. Indexes
 * are the page's own: the header row and quoted speech are blanked to spaces, never cut out, so a position found is a
 * position in the page as it came. */
const blankRows = (t) => t.split('\n').map((line) => (/^\s*[[（(].*[\]）)]\s*$/.test(line) ? ' '.repeat(line.length) : line)).join('\n');
const blankQuotes = (t) => t.replace(/[“"][^”"]{0,600}[”"]/g, (q) => ' '.repeat(q.length)).replace(/[‘'][^’']{0,600}[’']/g, (q) => ' '.repeat(q.length));
function sentenceStartAt(text, at) {
  let from = 0;
  for (const mark of ['. ', '! ', '? ', '.\n', '!\n', '?\n', '\n\n', '—\n', '”\n', '" ', '” ']) {
    const i = text.lastIndexOf(mark, at - 1);
    if (i !== -1 && i + mark.length <= at) from = Math.max(from, i + mark.length);
  }
  const nl = text.lastIndexOf('\n', at - 1);
  if (nl !== -1) from = Math.max(from, nl + 1);
  return from;
}
/* The cut reads only what cannot be his action told back: words in his mouth, and a thought, a realisation or a decision
 * that is his. A MOVE is left to the note on the next turn (mineLeak): the craft asks for his typed move to be narrated
 * in the storyteller's own words, and a paraphrase ("Jovan stepped inside the swing" for his "I dodge in") is not a theft
 * — cutting there would end a good page. Sensing and knowing (felt, knew) are the world reaching him, not his mind. */
const THINKS = INNER.split('|').filter((v) => !['felt', 'feels', 'knew', 'knows'].includes(v)).join('|');
export function mineCutAt(page, { mc = '', also = [], writerText = '' } = {}) {
  const names = mineNames(mc, also);
  const raw = String(page == null ? '' : page);
  if (!names.length || !raw.trim()) return -1;
  const text = blankRows(raw);
  const who = '(?:' + names.map(escape).join('|') + ')';
  const hits = [];
  const after = new RegExp('\\b' + who + '(?:\\s+\\w+){0,2}\\s+(?:' + SAYS + ')\\b[^.!?\\n]{0,40}[“"]([^”"]{1,400})[”"]', 'ig');
  const before = new RegExp('[“"]([^”"]{1,400})[”"][,\\s]{0,3}[^”"\\n]{0,40}?\\b' + who + '\\s+(?:' + SAYS + ')\\b', 'ig');
  const flipped = new RegExp('[“"]([^”"]{1,400})[”"][,\\s]{0,3}(?:' + SAYS + ')\\s+' + who + '\\b', 'ig');
  for (const re of [after, before, flipped]) { let m; while ((m = re.exec(text)) !== null) if (!echoesWriter(m[1], writerText)) hits.push(m.index); }
  const bare = blankQuotes(text);
  const thinks = new RegExp('\\b' + who + '\\s+(?:' + THINKS + ')\\b', 'ig');
  let t;
  while ((t = thinks.exec(bare)) !== null) if (!echoesWriter(sentenceAround(bare, t.index), writerText)) hits.push(t.index);
  if (!hits.length) return -1;
  return sentenceStartAt(raw, Math.min(...hits));
}

/* M510: THE SOUNDS A PAGE CARRIED — his craft's two lanes: contact sounds in single asterisks (*CRACK!*, *thud thud
 * thud*, never an asterisked sentence), and voiced ones in quotes that are sound more than words ("Gkh—!", "AHHH—",
 * "hah… hah…", "Mmm—ahhh—yes—"). A count, for the planning helper to hear when a fight or a heated page went quiet. */
export function soundCount(page) {
  const text = stripFurniture(String(page == null ? '' : page)).replace(/<!--\s*GFX_START\s*-->[\s\S]*?<!--\s*GFX_END\s*-->/g, ' ');
  let effects = 0;
  for (const m of text.matchAll(/(^|[^*\w])\*(?!\s)([^*\n]{1,48}?)(?<!\s)\*(?!\*)/g)) {
    const inside = m[2].trim();
    if (inside.split(/\s+/).length <= 4 && !/^~?t~/.test(inside)) effects += 1;
  }
  let voiced = 0;
  for (const m of text.matchAll(/[“"]([^”"\n]{1,48})[”"]/g)) {
    const s = m[1].trim();
    const vocal = /([a-z])\1\1/i.test(s)
      || /^[^a-z]*[A-Za-z]{1,7}[—–-]+[!?.…]*[^a-z]*$/i.test(s)
      || /(?:\b[A-Za-z]{1,5}[—–…]+[\s!?.]*){2,}/.test(s)
      || /^(?:[a-z]{1,4}[—–…!]+\s*)+$/i.test(s);
    if (vocal) voiced += 1;
  }
  return { effects, voiced };
}
