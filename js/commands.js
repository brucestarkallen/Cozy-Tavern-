/* Cozy Tavern — commands.js
 * The house commands (M9, SPEC §6). A tiny, testable parser: one function
 * in, one object out, nothing else. Every command maps to a hidden
 * directive in the assembled request (the slot-9/10 area, "The house
 * heard" on the receipt) plus a chip in the composer so the writer sees
 * what the house understood. An unknown #… is NOT swallowed — it passes
 * through as plain words, with a quiet hint on the chip.
 *
 *   parseCommand(text) -> Command
 *   Command = {
 *     kind: null | 'question' | 'beat' | 'skip' | 'continue' | 'time' | 'ooc',
 *     clean,        // the words to store/send (command stripped; OOC kept whole)
 *     directive,    // the hidden instruction for the wire ('' when none)
 *     chip,         // what the composer chip says ('' when no command parsed)
 *     hidden,       // true when the stored user page must never render
 *     ooc,          // true when the turn is out-of-character (no state work)
 *   }
 *
 * The commands: #question …  (OOC — a direct answer turn, no state work)
 *               #p           (one beat only)
 *               #pp          (skip ahead)
 *               #continue    (go on — the hidden nudge, never rendered)
 *               #time        (say the hour, briefly)
 *               ((…)) and lines starting with // are OOC asides.
 */

const DIRECTIVES = {
  question: 'The writer asked a question out of character. Step out of the story and answer them plainly, briefly, without advancing the scene: ',
  beat: 'Write a single beat only — one small step forward, then stop where the writer can pick up.',
  skip: 'Skip ahead: let a little time pass, and open the next scene where it has settled.',
  time: 'Out of the flow of the scene, say briefly what hour it is in the story right now, from what the ledger knows — then wait.',
};

const QUESTION_RE = /^#question\s+([\s\S]+)$/i;
const BEAT_RE = /^#p\s*$/i;
const SKIP_RE = /^#pp\s*$/i;
const CONTINUE_RE = /^#continue\s*$/i;
const TIME_RE = /^#time\s*$/i;
const OOC_PAREN_RE = /^\(\([\s\S]*\)\)\s*$/;
const OOC_SLASH_RE = /^\/\/\s*[\s\S]*$/;
const UNKNOWN_RE = /^#(\S+)/;

export function parseCommand(text) {
  const raw = typeof text === 'string' ? text : '';
  const trimmed = raw.trim();
  const none = { kind: null, clean: raw, directive: '', chip: '', hidden: false, ooc: false };
  if (!trimmed) return none;

  let m = trimmed.match(QUESTION_RE);
  if (m && m[1].trim()) {
    return {
      kind: 'question',
      clean: m[1].trim(),
      directive: DIRECTIVES.question + m[1].trim(),
      chip: 'a question, out of character — no state work',
      hidden: false,
      ooc: true,
    };
  }
  if (BEAT_RE.test(trimmed)) {
    /* The page stores the words as typed (visible, "#p"); the instruction
     * rides hidden in the request. Not empty — so the nudge stays quiet. */
    return { kind: 'beat', clean: trimmed, directive: DIRECTIVES.beat, chip: 'one beat only', hidden: false, ooc: false };
  }
  if (SKIP_RE.test(trimmed)) {
    return { kind: 'skip', clean: trimmed, directive: DIRECTIVES.skip, chip: 'skip ahead', hidden: false, ooc: false };
  }
  if (CONTINUE_RE.test(trimmed)) {
    /* The continue command IS the hidden nudge: the stored page is hidden,
     * and slot 10 does the talking. */
    return { kind: 'continue', clean: 'continue', directive: '', chip: 'go on', hidden: true, ooc: false };
  }
  if (TIME_RE.test(trimmed)) {
    return { kind: 'time', clean: '', directive: DIRECTIVES.time, chip: 'what hour is it?', hidden: false, ooc: false };
  }
  if (OOC_PAREN_RE.test(trimmed) || OOC_SLASH_RE.test(trimmed)) {
    return {
      kind: 'ooc',
      clean: trimmed,
      directive: 'The writer is speaking out of character. Answer them plainly and briefly, without advancing the scene.',
      chip: 'out of character — no state work',
      hidden: false,
      ooc: true,
    };
  }
  m = trimmed.match(UNKNOWN_RE);
  if (m) {
    /* Unknown #… — never swallowed. The words go out as plain text; the
     * chip says the house didn't know the word. */
    return {
      kind: null,
      clean: raw,
      directive: '',
      chip: `#${m[1]} isn’t a house command — sent as plain words`,
      hidden: false,
      ooc: false,
    };
  }
  return none;
}

/* For the composer: whether a text parses as any command or aside (so the
 * chip can live-update as the writer types). */
export function commandChip(text) {
  const parsed = parseCommand(text);
  return parsed.chip || '';
}
