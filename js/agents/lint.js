/* Cozy Tavern — agents/lint.js
 * M88: the house's eye — the craft's mechanical laws, checked in CODE on
 * every finished page, with no call and no judgment. The second reader
 * (continuity.js) minds facts against the ledger; the auditor minds the
 * ledger against the brief; nothing minded the PAGE against the writer's own
 * hard laws — the ones a machine can hold exactly:
 *
 *   - Ghost Dialogue: a quoted line attributed to the main character that
 *     the writer did not type (MC Agency)
 *   - No Echo: the writer's typed line rendered twice
 *   - Banned Words: the dead collocations, by the list
 *   - Marks On The Page: markdown headers, bold, backticks, a <think> or a
 *     <details> leaking into the prose, an action wrapped in asterisks,
 *     a private thought's markup left unbalanced
 *   - Header Protocol: a story page with no header line
 *   - Dialogue Ratio (note only): NPC speech far outside the craft's band
 *
 * High precision over recall: every check here is one a reader would agree
 * with on sight. Findings land on the page (msg.findings, kind 'craft') and
 * the warns of the LAST page ride to the storyteller's next turn as "the
 * house's eye" — the preset's own Callout Response, run by the house:
 * recolor forward, silently, never lampshaded.
 *
 *   lintPage({ mc, userText, assistantText, ooc }) -> { findings:[{words, severity, kind:'craft', law}] }
 *   houseEyeWords(findings) -> string  (the tail's text; '' when nothing to say)
 */

/* The list, as the craft has it (multi-word collocations warn; the lone
 * modifiers note — "husky" also names a dog). */
export const BANNED_PHRASES = [
  'fresh meat', 'breath hitching', 'breath catching', 'catching in throat', 'pupils blown wide', 'pupils dilated',
  'predatory gleam', 'predatory grin', 'ozone crackle', 'shivers down spine', 'shiver down her spine', 'shiver down his spine',
  'nails biting', 'velvet skin', 'velvet voice', 'vise grip', 'vice grip', 'structural integrity', 'deep curve', 'furnace of desire',
  'calloused hands caressing', 'guttural moan', 'slick folds', 'her assets', 'jaw clenched', 'jaw working', 'barely above a whisper',
  'his musk', 'a beat passed', 'a beat of silence', 'nobody has ever', 'nobody just', 'ruin you', "don't you dare", 'the first time anyone',
];
export const BANNED_WORDS = ['husky', 'throaty', 'unadulterated'];
/* M108: accord tells — the positivity bias in its plainest clothes. Notes,
 * never warns: one is a line; a page full of them is the eye's business. */
export const ACCORD_TELLS = ["you're right", 'you’re right', "you're absolutely right", 'you’re absolutely right', "couldn't agree more", 'couldn’t agree more', 'as always', "that's a great idea", 'that’s a great idea', 'everyone nodded', 'everyone laughed', 'they all nodded', 'they all laughed', 'the room nodded'];

const SPEECH_VERBS = 'said|says|asked|asks|whispered|whispers|muttered|mutters|told|tells|replied|replies|answered|answers|called|calls|shouted|shouts|added|adds|murmured|murmurs|breathed|breathes|managed|manages|offered|offers|snapped|snaps|hissed|hisses|laughed|laughs|sighed|sighs|admitted|admits|repeated|repeats';

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function norm(s) { return String(s || '').toLowerCase().replace(/[“”"‘’'`]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim(); }
function contentWords(s) { return norm(s).split(' ').filter((w) => w.length > 2); }

/* Quoted spans on one line: "…" or “…”. */
function quotes(text) {
  const out = [];
  const re = /["“]([^"”\n]{2,400})["”]/g;
  let m;
  while ((m = re.exec(text))) out.push({ text: m[1], at: m.index, end: m.index + m[0].length });
  return out;
}

/* Is this quote attributed to `mc` by a speech tag within reach of it? */
function attributedTo(text, q, mc) {
  const name = escapeRe(mc);
  const before = text.slice(Math.max(0, q.at - 90), q.at);
  const after = text.slice(q.end, q.end + 90);
  const tagAfter = new RegExp('^[\\s,—-]*(?:' + name + '\\s+(?:' + SPEECH_VERBS + ')|(?:' + SPEECH_VERBS + ')\\s+' + name + ')\\b', 'i');
  const tagBefore = new RegExp('(?:' + name + '\\s+(?:' + SPEECH_VERBS + ')|(?:' + SPEECH_VERBS + ')\\s+' + name + ')\\s*[,:—-]?\\s*$', 'i');
  return tagAfter.test(after) || tagBefore.test(before);
}

/* Did the writer type this line (or nearly)? Typed words carry the quote when
 * most of its content words appear in the writer's message. */
function typedByWriter(quote, userText) {
  const words = contentWords(quote);
  if (words.length < 3) return true; /* a short filler is the writer's own shorthand or a slip too small to convict */
  const typed = norm(userText);
  if (!typed) return false;
  if (typed.includes(norm(quote))) return true;
  const hits = words.filter((w) => typed.includes(w)).length;
  return hits >= Math.ceil(words.length * 0.6);
}

export function lintPage({ mc = '', userText = '', assistantText = '', ooc = false } = {}) {
  const findings = [];
  const page = String(assistantText || '');
  if (!page.trim() || ooc) return { findings };
  const push = (severity, law, words) => { if (findings.length < 8) findings.push({ words, severity, kind: 'craft', law }); };

  /* Header Protocol */
  const firstLine = page.split('\n').find((l) => l.trim()) || '';
  if (!/^\s*\[[^\[\]\n]*\|[^\[\]\n]*\]\s*$/.test(firstLine)) push('warn', 'Header Protocol', 'The page does not open with the header line [Place — Day, Date | HH:MM | weather | attire | position].');

  /* Marks On The Page */
  if (/^\s*#{1,6}\s+\S/m.test(page)) push('warn', 'Marks On The Page', 'A markdown header sits in the prose.');
  if (/\*\*[^*\n]+\*\*/.test(page)) push('warn', 'Marks On The Page', 'Bold marks (**…**) sit in the prose.');
  if (/`[^`\n]+`/.test(page)) push('warn', 'Marks On The Page', 'Backticks sit in the prose.');
  if (/<\s*think\b/i.test(page)) push('warn', 'Marks On The Page', 'A <think> block leaked into the page.');
  if (/<\s*details\b/i.test(page) || /\{(PULSE|WATCHLIST|VOICES)\}/.test(page)) push('warn', 'Marks On The Page', 'A tracker block was written on the page; the house keeps those.');
  const opens = (page.match(/~t~\*/g) || []).length; const closes = (page.match(/\*~\/t~/g) || []).length;
  if (opens !== closes) push('warn', 'NPC Private Thoughts', `A private thought's markup is unbalanced (${opens} opened, ${closes} closed).`);
  /* an action wrapped in asterisks: a span of four or more words that is not a sound */
  const spans = page.replace(/~t~\*[^\n]*?\*~\/t~/g, '').match(/(?<!\*)\*([^*\n]{4,140})\*(?!\*)/g) || [];
  const actions = spans.filter((s) => s.slice(1, -1).trim().split(/\s+/).length >= 4);
  if (actions.length) push('warn', 'Sound As Onomatopoeia', `An action is wrapped in asterisks (${actions[0].slice(0, 60)}) — asterisks wrap contact sounds and nothing else.`);

  /* Banned Words */
  for (const phrase of BANNED_PHRASES) {
    const re = new RegExp('\\b' + escapeRe(phrase).replace(/\\ /g, '\\s+') + '\\b', 'i');
    if (re.test(page)) push('warn', 'Banned Words', `The dead phrase "${phrase}" is on the page.`);
  }
  {
    const lower = page.toLowerCase();
    const hits = ACCORD_TELLS.filter((t) => lower.includes(t));
    if (hits.length) push(hits.length >= 2 ? 'warn' : 'note', 'The World Does Not Bend', 'Accord tells: ' + hits.map((h) => '“' + h + '”').join(', ') + ' — agreement and praise are earned by a CORE and a beat, never given.');
  }
  /* M119: a stray character from another script — a glitch token on the wire
   * (틀 inside an English sentence). A page that is Latin nearly whole and
   * holds one to four characters of Hangul, Han, Cyrillic, Arabic, Thai or
   * Hebrew has been corrupted, never written. The finding names the stray so
   * the house can mend it in code-guided fashion (chat.js). */
  {
    const letters = page.match(/\p{L}/gu) || [];
    const strays = page.match(/[\p{Script=Hangul}\p{Script=Han}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Thai}\p{Script=Hebrew}\p{Script=Hiragana}\p{Script=Katakana}]/gu) || [];
    if (strays.length >= 1 && strays.length <= 4 && letters.length >= 200 && strays.length / letters.length < 0.01) {
      /* one to four characters: a glitch token, mended by the house (M119) */
      push('warn', 'Marks On The Page', 'A stray character from another script — ' + [...new Set(strays)].map((c) => '“' + c + '”').join(', ') + ' — a glitch on the wire, not a word; the house mends it.');
      findings[findings.length - 1].stray = [...new Set(strays)];
    } else if (strays.length > 4 && strays.length <= 60 && letters.length >= 200 && strays.length / letters.length < 0.08) {
      /* M121: a short run of another script — a phrase or a sentence — is the second
       * reader's to judge: a character who speaks it keeps it; a babble is mended */
      push('note', 'Marks On The Page', 'A run of another script (' + strays.length + ' characters) — kept if a character here speaks it, mended if it is noise.');
    }
  }
  /* M116: the same window twice on one page */
  {
    const windows = (page.match(/\*\*\* The World Beyond \*\*\*/g) || []).length;
    const plainHeaders = (page.match(/^\s*\[[^\]\n]+ — [^\]\n]+\]\s*$/gm) || []).length;
    if (windows >= 2 || /The Window Beyond [Tt]he Page/.test(page)) push('warn', 'The Window Beyond The Page', 'The window was written twice (or titled after the rule) — one window, in the exact form, and nothing follows it.');
    else if (windows === 1 && plainHeaders >= 3) push('note', 'The Window Beyond The Page', 'More than one [Location — Day, Time] line beyond the header — a window is one cut, not two.');
  }
  for (const word of BANNED_WORDS) {
    if (new RegExp('\\b' + word + '\\b', 'i').test(page)) push('note', 'Banned Words', `The dead modifier "${word}" is on the page.`);
  }

  /* Ghost Dialogue and No Echo */
  const qs = quotes(page);
  if (mc) {
    const ghost = qs.find((q) => attributedTo(page, q, mc) && !typedByWriter(q.text, userText));
    if (ghost) push('warn', 'Ghost Dialogue', `The page gives ${mc} words the writer did not type: "${ghost.text.slice(0, 80)}".`);
  }
  const typedQuotes = quotes(String(userText || ''));
  for (const tq of typedQuotes) {
    const n = norm(tq.text);
    if (n.split(' ').length < 3) continue;
    const times = qs.filter((q) => norm(q.text) === n).length;
    if (times >= 2) { push('warn', 'No Echo', `The writer's line "${tq.text.slice(0, 60)}" is rendered ${times} times; once is the law.`); break; }
  }

  /* Dialogue Ratio — a note, wide bounds, only on a page long enough to judge */
  const body = page.replace(/^\s*\[[^\n]*\]\s*\n/, '');
  if (body.length > 900) {
    const spoken = qs.reduce((s, q) => s + q.text.length, 0);
    const ratio = spoken / body.length;
    if (ratio < 0.06) push('note', 'Dialogue Ratio', `Spoken dialogue is ${Math.round(ratio * 100)}% of the page; the craft's band is 20-50% unless the scene is empty of people.`);
    if (ratio > 0.75) push('note', 'Dialogue Ratio', `Spoken dialogue is ${Math.round(ratio * 100)}% of the page; the craft's band is 20-50%.`);
  }
  return { findings };
}

/* The tail's words for the next turn — warns only, the preset's own Callout
 * Response run by the house. '' when the last page was clean. */
export function houseEyeWords(findings) {
  const warns = (Array.isArray(findings) ? findings : []).filter((f) => f && f.kind === 'craft' && f.severity === 'warn').slice(0, 3);
  if (!warns.length) return '';
  return [
    'The house\'s eye on the last page — slips against your own craft, to recolor forward THIS turn: the words already',
    'written stand; the meaning and the discipline correct silently from here (Drift Recovery). Never lampshade,',
    'never apologize, never mention this on the page.',
    ...warns.map((w) => '  - ' + w.words + (w.law ? ' (' + w.law + ')' : '')),
  ].join('\n');
}
