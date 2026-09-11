/* Cozy Tavern — commands.js
 * The house commands (M9, SPEC §6; M85: the writer's whole command table).
 * A tiny, testable parser: one function in, one object out, nothing else.
 * Every command maps to a hidden directive in the assembled request (the
 * slot-9/10 area, "The house heard" on the receipt) plus a chip in the
 * composer so the writer sees what the house understood. An unknown #… is
 * NOT swallowed — it passes through as plain words, with a quiet hint on
 * the chip.
 *
 *   parseCommand(text) -> Command
 *   Command = {
 *     kind: null | 'question' | 'beat' | 'skip' | 'continue' | 'time'
 *           | 'ooc' | 'nextScene' | 'timeSkip' | 'story' | 'window' | 'referee',
 *     clean,        // the words to store/send (command stripped; OOC kept whole)
 *     directive,    // the hidden instruction for the wire ('' when none)
 *     chip,         // what the composer chip says ('' when no command parsed)
 *     hidden,       // true when the stored user page must never render
 *     ooc,          // true when the turn is out-of-character (no state work)
 *     name?,        // 'window': whose window; 'story': the new tale's title
 *   }
 *
 * The commands (the writer's Command Table, M85):
 *   #question …      OOC — a direct answer turn, no state work
 *   #p               exactly one beat
 *   #pp              arc transit — skip to the next significant beat
 *   #continue        play the current situation forward to its natural stop
 *   #q               the next scene — the director's preview, then the scene
 *   #time skip X     jump to X (also #timeskip X, #skip to X)
 *   #time            say the hour, briefly (the house's own)
 *   #story concept   a new tale from the concept — chat.js opens it
 *   #Put TWB name    one window beyond the page on that person (also #twb name)
 *   #roll / #skip / # no roll / # roll this — the referee's overrides; the
 *                    words ride as typed, the chip only names them
 *   ((…)) and lines starting with // are OOC asides.
 *   "text # note" — an inline direction mid-message; absorbed by the craft.
 *
 * Each directive carries the command's whole law (M85-002) — it rides the
 * dynamic tail on the turn it is used and never sits in the cached prefix;
 * the craft only says that a command's law arrives with its turn.
 */

/* M85-002: each command carries its WHOLE law here — it rides the dynamic
 * tail only on the turn it is used, never in the cached prefix (the house's
 * own law: only the rules relevant to this response). */
const PARTY_GATE = 'Party Gate: before any transit ask what MC is traveling to, who is functionally essential, and whether they are in the party — a treaty needs its architects, a coronation its crown-bearer; a missing essential NPC is added, in-world.';
const WINDOW_FORM = 'The window\'s form, exact: a line reading *** The World Beyond *** then a line [Location — Day, Time] then the prose — 3-8 sentences, dense, enter late, leave early, full POV depth inside that character\'s head, MC secondary and filtered through their perception, co-located absent people interacting autonomously; it renders what CHANGED since that thread was last on the page, never a recap; and it teaches nobody in the scene anything (Cut Away Quarantine).';
const DIRECTIVES = {
  question: 'The writer asked a question out of character. Step out of the story and answer them plainly, briefly, without advancing the scene — no header, no notes, no markers; if they flag a violation, give the trace, the root cause and the corrected line, then apply the recolor in the next story output: ',
  beat: '#p — exactly ONE beat: MC continues his last action, the world moves one step around him, the output ends there. No proactive MC, no tactics handed to him.',
  skip: '#pp — arc transit: skip to the next significant beat of the arc MC is following; MC moves TO it, not into it. ' + PARTY_GATE + ' The transit summary renders the proportional time delta (the header advances; a day skipped is a day the world moved — show what happened in the gap in proportion). A major event active at the destination -> cinematic cross-cut: transit, then a window beyond the page showing the event in progress, then MC arrives mid-action (' + WINDOW_FORM + '). Unresolved threads of the arc stay active. MC arrives knowing only the transit summary and the visible scene — quarantine holds across the skip.',
  continue: '#continue — play the CURRENT situation forward to its natural stop: full prose, no time skip, no transit summary, as many beats as the situation needs (the walk continues, the escort keeps talking, someone intercepts or nobody does, MC arrives); casual questions and small talk are texture it carries through; it ends where an intervention window returns control — a demand, a loaded question left hanging for him, a decision only he can make — or when the in-progress action completes (arrival reached, door closed), whichever comes first. Still one significant beat: the extra beats are transit and texture, never consequences stacked.',
  nextScene: '#q — the next scene. You are the director presenting the next episode: scan every alive thread — the ledger\'s open threads, the absent and their agendas, what the world\'s word says has ripened — and select the single most compelling scene. Time Horizon = RIGHT NOW (MC walks into it), LATER TODAY (MC arrives as it begins), or TOMORROW (next day, fresh context) — whichever lands hardest; the jump bills proportional world advancement and the header carries the new hour. It produces an active, playable scene MC responds to or walks past — a bully in the hallway, a loaded message, allies arguing in earshot, a rival\'s public move, a quiet weighted moment — NEVER a status report, a travelogue, or "you arrive and nothing is different." Selection order: hot thread agenda -> cold thread returning -> ripening consequence -> living cast hook -> stagnation -> arc milestone -> world momentum. Tone spectrum: quiet | warm | tense | escalation | a pivot between two; intense scenes chain only while a hot thread presses, and three in a row means the next one breathes. Write, in this order: 1) the preview ON THE PAGE, first — one short director paragraph: what is happening, why it matters, who is there, the horizon; a preview, never a request for approval — the scene starts without waiting for one; 2) the bridge — one to three sentences, transit in a clause, ' + PARTY_GATE + ' cut straight to the destination mid-motion; 3) the scene opens with MC arriving AT it, the world already moving; 4) it plays under every law; 5) the intervention window fires -> STOP. Complexity Ratchet = scenes that ADD to the world outrank scenes that resolve neatly; a good #q leaves MC with MORE — new information, tensions, relationships. Earned resolutions land (a goal dead by the Goal Death Test, a debt paid, a timeline concluded by board state); refusing one is manufactured struggle; unearned ease is the ban, never good news. #q is NOT drama injection, not biased toward MC, not a rule bypass, not always big: antagonists do not soften, hard negotiations stay hard, an antagonist\'s arc ends only when the board has already earned it, and a #q that makes the writer\'s next turn easier without board-state cause is the wrong direction.',
  timeSkip: '#time skip — jump to the time or moment named below: a logical transit summary proportional to the delta (the world moved in the gap — show it in proportion; a week skipped is a week of the world), ' + PARTY_GATE + ' Quarantine holds across the skip: MC arrives knowing only the transit summary and the visible scene. Then a new scene at the destination already in motion. The header carries the new date and hour. The destination: ',
  time: 'Out of the flow of the scene, say briefly what hour it is in the story right now, from what the ledger knows — then wait.',
  story: '#story — a new story begins from the concept below. Write the first scene immediately: the header, then the scene, with every unspecified detail (the date, the ground, who is there, what MC is doing) chosen and committed on the page — no proposals, no options, no plan spoken first. The concept: ',
  window: '#Put TWB — this turn, open one window beyond the page on the person named below, from where the ledger says they are and what they want. ' + WINDOW_FORM + ' Then the scene as usual, if there is a scene to write. The person: ',
  ooc: 'The writer is speaking out of character. Answer them plainly and briefly, without advancing the scene.',
};

const QUESTION_RE = /^#question\s+([\s\S]+)$/i;
const BEAT_RE = /^#p\s*$/i;
const SKIP_RE = /^#pp\s*$/i;
const CONTINUE_RE = /^#continue\s*$/i;
const NEXT_RE = /^#q\s*$/i;
const TIME_RE = /^#time\s*$/i;
const TIMESKIP_RE = /^#(?:time\s*skip|timeskip|skip\s+to)\s*([\s\S]*)$/i;
const STORY_RE = /^#story\s+([\s\S]+)$/i;
const WINDOW_RE = /^#(?:put\s*twb|twb)\s+([^\n]+?)\s*$/i;
const REFEREE_RE = /^#(?:roll|skip|noroll)\b/i;
const REFEREE_INLINE_RE = /(?:^|\s)#\s*(?:no\s+roll|roll\s+this|roll|skip|noroll)\b/i;
const INLINE_NOTE_RE = /\S\s+#\s+\S/;
const OOC_PAREN_RE = /^\(\([\s\S]*\)\)\s*$/;
const OOC_SLASH_RE = /^\/\/\s*[\s\S]*$/;
const UNKNOWN_RE = /^#(\S+)/;

function titleFrom(words, cap = 40) {
  const oneLine = String(words || '').replace(/\s+/g, ' ').trim();
  return oneLine.length > cap ? oneLine.slice(0, cap).trimEnd() + '…' : oneLine;
}

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
    return { kind: 'skip', clean: trimmed, directive: DIRECTIVES.skip, chip: 'skip ahead — the next beat of the arc', hidden: false, ooc: false };
  }
  if (CONTINUE_RE.test(trimmed)) {
    /* The continue command IS the hidden nudge: the stored page is hidden,
     * slot 10 does the talking, and (M85) the writer's own #continue law
     * rides with it — play the situation forward, no time skip. */
    return { kind: 'continue', clean: 'continue', directive: DIRECTIVES.continue, chip: 'go on — play it forward to its natural stop', hidden: true, ooc: false };
  }
  if (NEXT_RE.test(trimmed)) {
    return { kind: 'nextScene', clean: trimmed, directive: DIRECTIVES.nextScene, chip: 'the next scene — the director’s pick', hidden: false, ooc: false };
  }
  if (TIME_RE.test(trimmed)) {
    return { kind: 'time', clean: '', directive: DIRECTIVES.time, chip: 'what hour is it?', hidden: false, ooc: false };
  }
  m = trimmed.match(TIMESKIP_RE);
  if (m) {
    const to = m[1].trim() || 'the next morning';
    return {
      kind: 'timeSkip',
      clean: trimmed,
      directive: DIRECTIVES.timeSkip + to,
      chip: 'skip in time — to ' + titleFrom(to, 32),
      hidden: false,
      ooc: false,
    };
  }
  m = trimmed.match(STORY_RE);
  if (m && m[1].trim()) {
    const concept = m[1].trim();
    return {
      kind: 'story',
      clean: concept,
      directive: DIRECTIVES.story + concept,
      chip: 'a new tale — the first scene, written now',
      hidden: false,
      ooc: false,
      name: titleFrom(concept),
    };
  }
  m = trimmed.match(WINDOW_RE);
  if (m && m[1].trim()) {
    const who = m[1].trim();
    return {
      kind: 'window',
      clean: trimmed,
      directive: DIRECTIVES.window + who,
      chip: 'a window beyond the page — on ' + titleFrom(who, 24),
      hidden: false,
      ooc: false,
      name: who,
    };
  }
  if (OOC_PAREN_RE.test(trimmed) || OOC_SLASH_RE.test(trimmed)) {
    return {
      kind: 'ooc',
      clean: trimmed,
      directive: DIRECTIVES.ooc,
      chip: 'out of character — no state work',
      hidden: false,
      ooc: true,
    };
  }
  if (REFEREE_RE.test(trimmed) || REFEREE_INLINE_RE.test(trimmed)) {
    /* The referee's own words ride as typed (agents/referee.js reads them);
     * the chip only says the house saw them. */
    const noRoll = /#\s*(?:no\s+roll|skip|noroll)\b/i.test(trimmed);
    return {
      kind: 'referee',
      clean: raw,
      directive: '',
      chip: noRoll ? 'the referee stands down this turn' : 'the referee rolls this turn',
      hidden: false,
      ooc: false,
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
  if (INLINE_NOTE_RE.test(trimmed)) {
    /* "I step back # play her as suspicious" — an inline direction. The
     * words ride as typed; the craft absorbs the note silently. */
    return { ...none, chip: 'an inline direction — absorbed silently' };
  }
  return none;
}

/* For the composer: whether a text parses as any command or aside (so the
 * chip can live-update as the writer types). */
export function commandChip(text) {
  const parsed = parseCommand(text);
  return parsed.chip || '';
}
