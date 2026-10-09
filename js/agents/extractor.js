/* Cozy Tavern — agents/extractor.js
 * The extractor: a quiet background worker that reads each finished page —
 * what the writer wrote and what the storyteller answered — and proposes
 * scene-state mutations in the closed v1 vocabulary. It runs AFTER the
 * stream completes, never on the critical path, and it never throws into
 * the chat path: any failure, any garbled answer, resolves {mutations:[]}.
 *
 * Contract (SPEC.md M3, extended by M4):
 *   extractTurn({connection, state, userText, assistantText, signal})
 *     -> {mutations:[...]} | {mutations:[]} on any failure
 *
 * M4 widened the vocabulary (v2): the body ledger, the standings between
 * people, and the off-screen world. The conservatism law is restated in the
 * prompt — only what the prose explicitly shows; injuries only when the blow
 * lands on-page; feelings shift only from on-page acts; never invent
 * off-screen activity for characters the prose doesn't mention.
 *
 * M28: the call rides agents/call.js — the same providers the storyteller
 * uses, thinking explicitly OFF per house, temperature 0 — and the tolerant
 * parser reads the answer. (Before M28 this file carried its own two
 * fetches that never disabled thinking; on a reasoning model the budget
 * went to thought and the ledger starved.) The extractor also knows who the
 * main character is now, and founds a young ledger instead of asking
 * "what changed?" of a page that is the whole world so far.
 *
 * Also living here: the in-flight tracker. chat.js notes each piece of
 * background work it fires; the send path awaits pendingWork(storyId, 5000)
 * before assembling the next request, so state is consistent without prose
 * ever waiting on the workers (the latency law, SPEC.md M3). M6 widened the
 * chain (extractor → memory keeper → continuity check): noteWork tracks
 * every link, and pendingWork gives EACH link its own hard five seconds —
 * first overrun, the send simply proceeds with last-good state (the chain
 * is ordered, so a late link means the later links can't land in time).
 * The M3 names (noteExtraction / pendingExtraction) remain as aliases —
 * they were the published contract. */

import { HERE_MEANS, KNOWING_MEANS, LOOSE_ANSWERED_MEANS } from './herewords.js'; /* M554: who is in the scene — one definition; M677: what goes into who knows what — one definition */
import { writerText, BRIEF_ROOM, CAST_ROOM } from '../engine/whole.js'; /* M283 */
import { nameOnPage, isHere, samePersonName, oneMeaning, foldName } from '../engine/names.js'; /* M402: silence is not leaving; M414: named by the one answer */
import { clearsThatArrive, scenePartOf, narrationOf, pageNameFor, shownOnPage, goneAtTheEnd, quotedGoing, toldOnPage, withinGround, numberOf, restatedPresence, staleAfterJump, applyMutations, lockedLooks, movedThings, samePlace, seatAtScene, sameSpot, mcWalksOff, personBookKey, noOneSpot } from '../engine/apply.js'; /* M444: the room restated; cleared is never nowhere; M446: gone at the page's end */
import { headerMutations, headerDress, closeBy, headerCells } from '../engine/state.js'; /* M446: did this page move the ground? */
import { isMc, findPersonKey } from '../engine/people.js';
import { findRelationship } from '../engine/relationships.js'; /* M641: who has no standing yet */
import { publicMoment } from '../engine/world.js'; /* M509-15: a moment the whole room saw */
import { balancedCandidates, parseLenient } from './jsonutil.js';
import { withFictionFrame } from './voice.js'; /* M21: the workers never break the fiction */
import { callWorker } from './call.js'; /* M28: the one wire path for workers */
import { pauseContinuousAudit } from './continuous.js'; /* M673: nothing waits for a reading of older pages */

import { renderWholeLedger, wholePage, knowledgeRoomFor } from '../engine/whole.js'; /* M259: the whole ledger, and the page read to its end */
import { askWithFetch, fetchLaw, windowOfPages, roomChars, viewBudget, leashFor } from './lookup.js'; /* M259/M261: it may look; the story so far, whole */
import { contextOf } from '../providers/room.js'; /* M679: the reader's answer floor, by its room */
import { mcName } from '../engine/duels.js';

/* M28: the answer is JSON only and thinking is OFF on the wire (call.js),
 * so the budget is the answer's — 1200 tokens holds a long founding read
 * with room to spare. (M26's 2000 was a bandage over thinking models
 * spending the budget on thought; the wire now tells them not to.) */
const MAX_TOKENS = 2400; /* M37: room for a long founding even if a house thinks a little anyway */
/* M679: the reader now answers, by name, for every open thread and every loose end of the page's people as well as for each
 * person shown — on a busy page a whole answer runs past 2400 tokens, and an answer the wire cuts is read as nothing at all.
 * A house of 32,000 tokens or more is sent 6000 (the auditor's and the world agent's own floor — his worker connection
 * already serves it); a smaller house keeps M37's 2400, so the story before the page still fits its view. Only a floor:
 * a connection that says more is sent its own (agents/call.js). */
export const EXTRACTOR_MAX_TOKENS = 6000; /* M444: the page reader's room is measured with its own answer budget */
export function readerBudget(connection) {
  return contextOf(connection) >= 32000 ? EXTRACTOR_MAX_TOKENS : MAX_TOKENS;
}

/* ---------- the in-flight tracker (the send path's courtesy wait) ---------- */

const inFlight = new Map(); // storyId -> Promise[]

/* Note a piece of background work just fired. The promise's own fate is
 * swallowed here — the tracker only cares when it settles. */
export function noteWork(storyId, promise) {
  if (!storyId || !promise || typeof promise.then !== 'function') return;
  let list = inFlight.get(storyId);
  if (!list) { list = []; inFlight.set(storyId, list); }
  list.push(promise);
  const settle = () => {
    const at = list.indexOf(promise);
    if (at !== -1) list.splice(at, 1);
    if (!list.length && inFlight.get(storyId) === list) inFlight.delete(storyId);
  };
  promise.then(settle, settle);
}

/* Await each piece of background work in flight for this story, in order —
 * each gets its own hard timeout; on the first overrun we stop waiting and
 * go on with last-good state. Never rejects. Resolves true when everything
 * settled in time, false when nothing was pending or something overran. */
export async function pendingWork(storyId, timeoutMs = 5000) {
  /* M673: THE CONTINUOUS AUDIT IS NEVER WAITED FOR. Its reading of older pages can take half a minute, and while the
   * house is idle one follows another: every send (five seconds), retry and rewind would have waited on it. Whoever
   * waits for the workers lets that reading go first -- its call is dropped, nothing is written, and the same pages
   * are read later (agents/continuous.js). */
  pauseContinuousAudit(storyId);
  let any = false;
  for (;;) {
    const list = inFlight.get(storyId);
    if (!list || !list.length) return any;
    any = true;
    const promise = list[0];
    let timer = null;
    const done = await Promise.race([
      promise.then(() => 'settled', () => 'settled'),
      new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), timeoutMs); }),
    ]);
    clearTimeout(timer);
    if (done === 'timeout') return false;
  }
}

/* M506: IS ANYTHING STILL OUT FOR THIS STORY? pendingWork answers false both when nothing was pending and when the
 * wait ran out — a branch from the newest page read a settled tale as "the readers are still on it". This is the
 * other half of the answer: true only while a noted piece of work has not settled. */
export function workInFlight(storyId) {
  const list = inFlight.get(storyId);
  return Boolean(list && list.length);
}

/* The M3 names, kept: an extraction noted is one link of work; awaiting an
 * extraction is awaiting the chain. */
export function noteExtraction(storyId, promise) {
  noteWork(storyId, promise);
}

export async function pendingExtraction(storyId, timeoutMs = 5000) {
  return pendingWork(storyId, timeoutMs);
}

/* ---------- the prompt (human-voiced, kept in the code) ---------- */

const VOCABULARY = [
  'mc.set {"type":"mc.set","name":"MAIN CHARACTER"} — ONLY when the ledger does not yet know the main character: the one person the writer plays or narrates as their own',
  'clock.set {"type":"clock.set","year":2026,"month":3,"day":15,"hour":14,"minute":30} — only when the prose states or clearly fixes the time',
  'place.set {"type":"place.set","name":"the chapel"} — the ground the scene stands on, only when first named or it truly moves',
  'clock.advance {"type":"clock.advance","minutes":30,"reason":"the walk to the chapel"} — when time clearly passes; minutes is a number',
  'presence.enter {"type":"presence.enter","name":"NAME","shown":"his aunt came in, shaking rain from her coat","position":"by the fire","attire":"a travel cloak"} — position and attire only if shown; "shown" is the page\'s own words that show them arriving or being here, COPIED EXACTLY from its telling (never from what someone says aloud) — always give it when the telling does not use their name ("his aunt", "the captain", a nickname, "she")',
  'presence.leave {"type":"presence.leave","name":"OTHER NAME","shown":"footsteps measured up the stairs","to":"upstairs in the Wells house","doing":"going up to bed"} — when someone stops sharing the main character\'s space: the page SHOWS them leaving (walks out, is carried off, vanishes), OR he walks away and leaves them behind (they stay where they were — never the main character himself: when he goes, the scene\'s place goes with him); someone the page does not mention is quiet, not gone, and stays. "shown" is the page\'s own words that show them going, COPIED EXACTLY from its telling (a few words are enough; never from what someone says aloud) — the house holds a leaving to the page by them. WHERE THEY WENT IS YOURS TO SAY, FROM THE PAGE: "to" is where the page shows them going, said so it stands on its own — "upstairs in the Wells house", "the car outside the gate", "back to the Sixth\'s barracks" (never just "out" or "away", and never the scene\'s own ground); "doing" is what they went to do, when the page says. Leave "to" out only when the page shows them go with no sign of where: the house then notes where they were last seen. When it is HE who walked away from them, "to" is where he left them, as the page last puts them ("at the hall\'s threshold", "in his own doorway on Gilder\'s Row")',
  'presence.update {"type":"presence.update","name":"NAME","position":"at the window"} — when someone present moves or changes dress',
  /* M256: WHO KNOWS WHAT, FOR THE PEOPLE IN THE ROOM. knowledge.add appeared
   * NOWHERE in this file. The world agent has it, but the world agent is
   * about the ABSENT — so a thing witnessed by someone standing right there
   * was written down by NOBODY, and the auditor picked it up three turns
   * later, one person at a time, which is what the writer kept seeing in his
   * audit reports ("no knowledge line for Claire Stone, who plainly
   * witnessed…"). The worker READING THE PAGE is the one that should write
   * it. */
  /* M258: AND THE THREADS IT WATCHED RESOLVE. thread.close appeared nowhere
   * in this file either — the world agent has it, and the world agent is
   * about the ABSENT. So a question answered, a plan abandoned, a promise
   * kept ON THIS PAGE could be closed by nobody, and the auditor found three
   * of them at once in the writer's own tale: Chloe's clip abandoned,
   * Aurora's message delivered, Caleb's frame posted — every one still
   * burning in the ledger, read to the storyteller every turn as something
   * still hanging. */
  'thread.close {"type":"thread.close","title":"the title as the ledger holds it"} — a story thread THIS page resolved: the question answered, the plan abandoned, the promise kept, the thing found. Use the title the ledger shows, worded as it stands (each title is quoted on the thread list).',
  'knowledge.add {"type":"knowledge.add","who":["NAME","OTHER NAME"],"fact":"that Orrin Vale lived in England"} — when someone in the scene LEARNS something that could matter later: a secret told, a name heard, a lie caught, a thing seen they were not meant to see. A LIE OR A COVER STORY THEY BELIEVE is written as what they believe AND that it is untrue — fact "believes Orrin Vale is only a recruit — untrue: Orrin Vale is the new captain of the guard" — and when the truth comes out in front of them, what they learned: "learned Orrin Vale is the new captain, not a recruit — he had told them otherwise". Only what THIS page put in front of them, and only where being told, or not told, could change what they do. WRITE IT IN THE PAGE\'S OWN TERMS: what was said, seen or overheard, exactly — "their mother" if the page said their mother, never "his stepmother" because you know the family; who said it to whom as the page has it; never what the person would conclude from it. A fact the page did not put in front of them is not knowledge, however likely. WHO IS YOURS TO DECIDE, FROM THE PAGE: "who" names EVERY person the page put it in front of, each by name — close enough to see or hear it, awake, and there when it happened (never someone who came in after it, had gone before it, or from whom it was kept: a whisper is the two it passed between). Write "who":"everyone here" when it happened or was said in front of the whole scene: that means everyone who was in the scene when this page opened and is still in it at its end. Anyone else who was there for it — someone who walked in before it happened, someone who left after it — is added by name: "who":["everyone here","NAME"]. One witness is a list of one. Never the main character, and the one who did or said it is no witness of their own act. ' + KNOWING_MEANS,
  'mode.snapshot {"type":"mode.snapshot","flags":["travel"]} — THE WHOLE BOARD, EVERY PAGE: every mood that holds at the END of this page, from: combat (a fight is on), intimate (sex or intimate touch is on), travel (in transit — a car, a train, a road; NOT once they have arrived and stepped out), socialField (a crowded public place full of voices), isolation (alone, far from help), group (in company of several). Anything you do not name is cleared. An empty list clears them all.',
  'body.injure {"type":"body.injure","name":"NAME","what":"left forearm fractured","sev":2,"treated":false} — only when a blow lands on-page; sev is 1 (a graze), 2 (a real wound), or 3 (severe); treated only if someone tends it on-page',
  'body.strain {"type":"body.strain","name":"NAME","what":"the long climb"} — weariness short of injury, when the prose shows it',
  'body.heal {"type":"body.heal","name":"NAME","what":"forearm"} — only when the prose says a known hurt has healed',
  'rel.shift {"type":"rel.shift","name":"OTHER NAME","axis":"p","delta":8,"cause":"she bandaged his hand without being asked"} — feelings toward the main character only; axis is p (warmth), r (romantic pull), or s (sensual charge); delta a small number, -20 to +20; cause REQUIRED, quoting the on-page beat that earned it',
  'rel.set {"type":"rel.set","name":"OTHER NAME","p":45,"r":60,"cause":"the page reveals she has loved him since they were children"} — when the page, the brief or the story\'s opening states a feeling that already exists (REVEALED, NOT EARNED, below) — never as a guess',
  'offscreen.set {"type":"offscreen.set","name":"NAME","location":"the chapel","activity":"lighting candles for the dead","agenda":"meaning to warn the abbot"} — only for a named character the prose shows leaving or shows elsewhere; never invent off-screen doings for someone the prose doesn’t mention',
  'thing.set {"type":"thing.set","name":"THE THING","where":"where it stands NOW","owner":"WHOSE (optional)","note":"its state, optional"} — a vehicle, weapon, device or object that matters to what can happen next (a jet parked on the roof, the case of cash in the trunk, the letter in her drawer): written when the page brings it in, and again when it moves or changes, under the name the ledger\'s Things list already gives it — never set dressing. The owner is whose it is by right (given, bought, won, handed back to the one it belongs to); a thief or someone only holding it is not its owner — that is where it is',
  'thing.clear {"type":"thing.clear","name":"THE THING","cause":"…"} — when the page destroys it, uses it up or gives it out of the story',
  'offscreen.clear {"type":"offscreen.clear","name":"NAME"} — only for someone who is in the scene now (their elsewhere note is stale); for anyone else whose note no longer holds, write offscreen.set with where they are now — a person the story keeps is always somewhere',
].join('\n');

/* M53: the writer's own law of the standings, given to the reader whole — it
 * had one line ("p warmth, r romantic pull, s sensual charge") and nothing
 * about WHEN a standing moves, so it docked R for a playful "don't waste
 * this one" and never moved P through a night of intimacy. */
const STANDINGS_LAW = [
  'THE STANDINGS (rel.shift). Each named person carries three INDEPENDENT axes toward the main',
  'character, -100..+100: P = warmth and trust (friendship, respect, comfort; negative = dislike,',
  'contempt, distrust); R = romantic pull (attachment, longing, wanting MORE of him, jealousy;',
  'negative = romantic aversion, not "wants less commitment"); S = sexual desire (physical want,',
  'tension; negative = repulsion). They move independently: R can climb while P drops, S without R,',
  'P high with the others at zero. A stranger starts at 0/0/0 and moves only by what the page shows.',
  'SCORES MOVE ON REVELATION: a standing moves ONLY when the page reveals something NEW about the main',
  'character or the bond, read through that person\'s own nature — never on the beat\'s pleasantness',
  'and never on your reading of what she "really" thinks. A public defeat can raise R (he didn\'t defer',
  'to me); a gift can drop P (he\'s buying me); a cruel truth can raise P (he didn\'t lie). No revelation,',
  'no movement — flat is the default. Typical ±1–5; a major moment ±10–20.',
  /* M588 (his report: "someone has romantic feelings for my MC — in #story, the brief, the pages — and the AI puts P+2"):
   * a feeling that ALREADY EXISTS, revealed, is not a beat to inch toward — it is where the standing stands. */
  'REVEALED, NOT EARNED: when the page (or the brief, or the story\'s opening) shows a feeling that ALREADY',
  'EXISTS — she has loved him for years, he has always hated him, a sister\'s devotion — and the standing',
  'does not show it, write rel.set at the level it shows, not a small shift on an empty book. The levels:',
  'R (romance): drawn to him, curious 10–25; a crush, flustered, fond 25–45; in love 55–75; devoted love',
  '75–90. P (warmth): acquaintance 5–15; friend 25–45; close friend or family 50–70; trusted with her life',
  '75–90; dislike −15…−35; hatred −50…−80. S (desire): drawn to his body 15–35; wanting him 40–60; burning',
  '60+. Romantic love is R — never P alone (P is friendship and trust; a lover usually has both).',
  'DISPOSITION NOT MOOD: the standing is the climate, the scene\'s emotion is the weather. Fear FOR him,',
  'worry, grief at his pain, embarrassment on his behalf are SYMPTOMS of warmth — they never subtract.',
  'Only fear OF him, disgust AT him, betrayal BY him lower P. A boundary or a limit she states ("can\'t',
  'see you next weekend", "this is a weekend thing") is a FACT about the bond, not a minus: it lowers R',
  'only if the page shows she wants LESS than she did before; said playfully, or while wanting him',
  'now, it moves nothing — or moves S. Intimacy: S rises with wanting shown; P rises with trust shown',
  '(letting him in, staying after, being unguarded); R rises with attachment shown (wanting more,',
  'longing, jealousy) — each only where the page shows it, none mechanically. Charm from the main',
  'character is not a cause; an NPC who feels handled drops while smiling.',
].join('\n');

/* The standing law of the ledger. M28: it is built per turn now, because two
 * things it says depend on the ledger's age and what it knows — who the
 * main character is, and whether an empty answer is honest. */
function systemPrompt({ mc, founding }) {
  const who = mc
    ? `The main character — the one the writer plays — is ${mc}. Feelings (rel.*) are always toward ${mc}.`
    : 'The ledger does not yet know the main character\'s name. The writer plays or narrates one person as their own — the one whose actions the writer types, the one the story follows. Name them with mc.set (once), and treat rel.* feelings as feelings toward that person.';
  const law = founding
    ? [
      'THE LEDGER IS YOUNG — nothing is written in it yet. Found it from these pages. If the page opens',
      'with a bracketed header line — [Place — Day, Month DD, Year | HH:MM | weather | attire | position] —',
      'that line is the truth for place.set and clock.set (all five numbers are in it), and the attire',
      'and position are the main character\'s (presence.enter with them). When its place names only the area (a city, a',
      'town, a district), the spot in it where the prose puts them is yours to say, in "spot" (the house adds the area):',
      '  - place.set for the ground the scene stands on (a booth at McDonald\'s, a chapel, a train car — the place the prose puts them);',
      '  - presence.enter for EVERY person the pages put in the scene (sharing his space — never someone only seen at a distance), the main character included, with position/attire only if shown;',
      '  - clock.set only if the pages fix a date and hour (never guess a date; if only the hour is known, leave the clock alone);',
      '  - mc.set if the main character is not yet known;',
      '  - mode.set for a mood the pages plainly show (socialField for a crowded public place, intimate, combat, travel, group);',
      /* M532: THE OPENING MOVES FEELINGS TOO. A #story opening — he saves Yuki from her death — was founded as a place and a
       * room and nothing else: the young ledger's law named no standing, the later pages move a standing only on something
       * NEW, and "How they feel toward you" stood empty until he rebuilt the people by hand. The opening is read as any page
       * is for what it does to people. */
      '  - rel.shift for anyone whose feelings toward the main character this opening plainly moves (he saves them, spares them, threatens, humiliates or betrays them), read through their own nature, by THE STANDINGS above; rel.set only where the brief or the prose says where a standing already stands (old friends, a long enmity) — a stranger the page does not move stays at 0/0/0;',
      '  - knowledge.add for what someone here plainly learned on this page (a name heard, a power seen, a secret told);',
      /* M533: the deep audit's sweep for the same fault — the opening's own hurts were not asked for either: a wound the
       * opening shows (Yuki cut before he parries, his own hand burned by the blow) went unwritten until a later page or the
       * auditor. Every kind of change the reader writes on a later page, the opening is now read for. */
      '  - body.injure / body.strain for a hurt the pages plainly show landing or carried in (by the shapes above).',
      'On a young ledger an empty answer is almost always wrong: the scene exists, so someone is somewhere. Write the founding down.',
    ].join('\n')
    : [
      'If the page opens with a bracketed header line — [Place — Day, Month DD, Year | HH:MM | weather |',
      'attire | position] — it is the truth for the hour (clock.set when the date or hour differs from',
      'the ledger) and the ground (place.set when it moved) — but a header that names only the area round where',
      'they already are (a city, a town, a district) is no move by itself: where in that area the scene stands is yours',
      'to say ("spot", when it is asked below), and a step from one spot in it to another — one street to the next, the',
      'street into a tavern — IS a move.',
      'Its attire and position are the storyteller\'s',
      'READING of the ledger, never a change on their own: write the main character\'s attire or position',
      'only when this page or his move SHOWS it change (he changes, dresses, undresses, sits, moves) — a',
      'header that names another outfit or place to stand with nothing changing on the page is the',
      'header\'s slip; the ledger keeps what it holds.',
      '',
      'BEFORE YOU ANSWER, THE FOUR MOST OFTEN MISSED (every one of these',
      'was found by the auditor three turns late, in the writer\'s own tale):',
      '  1. THE GROUND MOVED. The ledger holds it on its "The ground:" line. A page',
      '     that opens with a header line naming the spot has its place written in code;',
      '     a header naming only the area (a city, a town) leaves the spot to you ("spot");',
      '     on a page with none, if the scene now stands somewhere else — a gate, a kitchen,',
      '     one house further down the lane — place.set.',
      '  2. SOMEONE PRESENT MOVED WITHIN IT. Reaching a gate, a hand on a latch,',
      '     crossing to the window: presence.update. Their old position is a lie',
      '     until you write the new one.',
      '  3. SOMEONE LEARNED SOMETHING. Anyone standing there who heard the answer,',
      '     saw the handshake, caught the lie: knowledge.add, every one of them named in its "who".',
      '  4. WHAT THE PAGE ANSWERED. A question asked and answered, a promise kept,',
      '     a plan abandoned — "threads" for the story\'s threads and "loose" for a person\'s own',
      '     loose ends, each decided as it is listed under the page.',
      'THE LEDGER ABOVE IS ALL OF IT — every standing, thread, line of who knows what',
      'and seat. A fact someone already knows, in any words, is not written again.',
      'ONLY THE NEW PAGE IS NEWS: the pages before it are already in the ledger. A beat the',
      'standings\' latest causes already name is already counted. The lists under the page that',
      'ask how the story STANDS at the end of this page (the open threads, the open wounds, the',
      'loose ends, where things are) are the exception: for those, the pages just before count too.',
      'Be conservative. Write down only what the prose explicitly shows — never what it',
      'merely hints at, never what might be true. Injuries only when the blow lands',
      'on-page; feelings shift only from on-page acts, and every shift needs its cause',
      'in words; never invent off-screen activity for characters the prose doesn\'t',
      'mention; when unsure, omit. Time moves only when the prose says it moved. If',
      'nothing changed, return {"mutations":[]} — an empty list is a good and honest',
      'answer on a settled ledger.',
    ].join('\n');
  return [
    'You keep the ledger for a story told between two writers. After each',
    'page is finished, you read it and note — in small, exact changes — what shifted',
    'in the scene: the hour, the ground, who is present, the mood of the room, who',
    'was hurt, how the people involved feel about the main character, and where the',
    'absent have gone.',
    '',
    who,
    '',
    'Answer with JSON ONLY, in exactly this shape:',
    '{"mutations":[ ... ], "threads":[ ... ], "healed":[ ... ], "things":[ ... ], "loose":[ ... ], "here":[ ... ], "looks":[ ... ], "spot":"…"}',
    '"threads" decides EVERY open thread listed under the page, one entry each — {"title":"…","now":"resolved"} or',
    '{"title":"…","now":"open"} (a thread the story has only moved is still open). "healed", "things", "loose" and "spot"',
    'answer the lists under the page that ask for them; [] (or "" for "spot") when there is none.',
    '"here" names EVERYONE in the scene at the END of this page, by the names the ledger uses — each a plain name, or',
    '{"name":"…","at":"where in the room they are as the page ends","wears":"what they have on"} with "at" and "wears" ONLY',
    'as THIS page shows them, in its own words (left out when the page does not show them: the ledger keeps what it has): the main',
    'character, everyone the page shows there with him, and everyone on the ledger\'s "Here now" line who is still with',
    'him — whom the page did not show leaving and he did not walk away from (quiet is not gone; left behind is gone).',
    'Never someone only spoken of or remembered, heard on a phone or seen',
    'on a screen, and never anyone in the window. ' + HERE_MEANS + ' Whoever you name here that the ledger has not written in is',
    'written in; nobody is taken out for being left off — a leaving (theirs, or his walking away from them) is still',
    'presence.leave, shown on the page.',
    '"looks" holds what THIS page — or the writer\'s own message — shows of how someone LOOKS that will still be true',
    'tomorrow: body, build, height, face, hair, eyes, skin, marks, scars, anatomy, the sound of a voice. One entry a fact,',
    '{"name":"NAME","key":"hair","value":"copper red, cut to the jaw"}, the value in the page\'s own words. Never dress, a',
    'mood, a look on a face or a wound (those have their own places), and nothing the ledger already holds for them',
    'under "What\'s true". [] when the page shows none.',
    '',
    'The only mutations that exist:',
    VOCABULARY,
    '',
    STANDINGS_LAW,
    '',
    'THE MOOD IS STATED WHOLE, EVERY PAGE: include one mode.snapshot naming every mood that holds at',
    'the end of this page — a mood you leave out is cleared. A man who has stepped out of the car is',
    'not in transit; a room that emptied is not a social field; a fight that ended is not combat.',
    '',
    law,
    'Names keep the exact spelling the prose uses. No commentary, no markdown fences,',
    'no trailing words: the JSON object only.',
    'A WINDOW IS ELSEWHERE: everything after a line reading *** The World Beyond *** is a cut to',
    'another place — the people in it are NOT in the scene. Never presence.enter them; the world',
    'agent seats them. Only the prose BEFORE the window is the scene.',
    'WHOSE AND WHO: when a line says who called whom, whose phone rang, who gave what to whom, take it',
    'from what the pages before this one established — the phone in her hand is her phone even where a line',
    'only says "the phone"; a call that comes again to the phone she just declined comes to HER, and reaches',
    'someone else only if she hands it over. An ambiguous line is read the way the sequence makes plain, and',
    'never guessed toward the main character.',
    'PLACEHOLDERS: NAME, OTHER NAME, NEW NAME, NAME SURNAME and MAIN CHARACTER in the examples above are placeholders, never people — never write them; write only the names the ledger, the brief and the pages use.',
  ].join('\n');
}

/* Exported for the harness: the two messages any provider flavor receives. */
export const EXTRACTOR_LOOKS = 2;
export function buildExtractorMessages({ state, userText, assistantText, before = [], founding, brief = '', castNotes = '', record = '', pageNumber = 0, contextBudget = Infinity, knowledgeRoom = 0 }) {
  /* founding: passed explicitly by the send path (it already knows), else
   * read off the ledger's own youth. */
  if (typeof founding !== 'boolean') founding = isYoungLedger(state);
  const facts = renderWholeLedger(state, { knowledgeRoom }) || 'Nothing is written in the ledger yet.'; /* M259; M664: fitted to this worker's room */
  const known = mcName(state);
  const mc = known && known !== 'the player' ? known : '';
  const onNow = Object.entries((state && state.mode) || {}).filter(([, v]) => v).map(([k]) => k);
  const FENCE = '"""';
  const unwritten = founding ? [] : unwrittenStandings(state, scenePartOf(assistantText)); /* M641: the people here, or named on this page, whose standing was never written */
  const user = [
    'Here is what the ledger currently says:',
    facts,
    'Moods on the board right now: ' + (onNow.length ? onNow.join(', ') : 'none') + ' — restate the whole board with mode.snapshot.',
    '',
    ...(brief && String(brief).trim()
      ? ['What this story is about, in the writer\'s words:', FENCE, writerText(brief, BRIEF_ROOM, 'brief', true), FENCE, ''] /* M283 */
      : []),
    ...(castNotes && String(castNotes).trim()
      ? ['Who is in it, in the writer\'s words:', FENCE, writerText(castNotes, CAST_ROOM, 'cast notes', true), FENCE, ''] /* M283 */
      : []),
    /* M226: THE STORY BEFORE THE PAGES IT CAN SEE. The extractor writes the
     * ledger from the newest page and the four before it — eight on a deep
     * read — and was NEVER given the record. So on a hundred-page tale
     * everything older than eight pages was invisible to the one worker that
     * decides who is present, where they are, and what is true: it could
     * "discover" a person the story has known for eighty pages, or miss that
     * a thread it sees opening was closed long ago. The folded record is what
     * the storyteller reads in place of those pages; the extractor reads it
     * too now. */
    ...(record && String(record).trim()
      ? ['The story so far, folded — what the pages before these ones hold:', FENCE, String(record).trim(), FENCE, '']
      : []),
    ...(before.length
      ? (() => {
        /* M261: whole, newest first, into the room; the rest by number */
        const w = windowOfPages(before, contextBudget);
        return [
          'The pages just before this one — ALREADY READ. Nothing on them is news and nothing on them is yours to write; they are here so you know who is who, what was promised and where things stand:',
          FENCE, w.shown.join('\n\n') || '(none fit — fetch them by number)', FENCE,
          ...(w.index.length ? ['Earlier pages not shown above (fetch any by its number):', ...w.index] : []),
          '',
        ];
      })()
      : []),
    'The writer just wrote:',
    '"""',
    wholePage(userText, 12000),
    '"""',
    '',
    ...(Number.isInteger(pageNumber) && pageNumber > 0 ? ['(The storyteller\'s page below is page ' + pageNumber + ' of the story; every earlier page can be fetched by its number.)'] : []),
    'And the storyteller answered:',
    '"""',
    wholePage(assistantText),
    '"""',
    '',
    ...(!founding ? openThreadsBlock(state) : []),
    ...(!founding ? openWoundsBlock(state, assistantText) : []),
    ...(!founding ? namedFromAfarBlock(state, assistantText) : []),
    ...(!founding ? withinEarshotBlock(state) : []),
    ...(!founding ? thingsOnPageBlock(state, assistantText) : []),
    ...(!founding ? looseEndsBlock(state, assistantText) : []), /* M679 */
    ...spotBlock(state, assistantText), /* M679: where in the area the scene stands, when the header names only the area */
    ...(!founding ? placesBlock(state, assistantText) : []), /* M677 */
    ...standingsBlock(unwritten), /* M641 */
    founding ? 'Found the ledger from these pages. JSON only.' : 'What changed, if anything? JSON only.',
  ].join('\n');
  return { system: withFictionFrame(systemPrompt({ mc, founding }) + '\n\n' + fetchLaw({ rounds: EXTRACTOR_LOOKS, when: 'Look only when THIS page leans on something you were not shown — a person, a promise or a place from an earlier page, a name the brief defines further on. Most pages need no look.' })), user, founding, mc, standingsFor: unwritten };
}

/* M677 — WHERE EACH OF THEM IS AS THE PAGE ENDS, EACH TO BE ANSWERED. His report: the auditor, every page, "set right" where
 * five people sat ("the ledger has Oda Mei 'both hands pressed over her mouth', but p20 shows her hands come down …").
 * The reader was asked for the room as the page ends with an "at" for each person only where it chose to give one, and
 * told to write a move when someone MOVED — a hand that comes down, a cup picked up, a chin back in a palm is no move
 * across the room, so nothing was written, and the ledger went on telling the storyteller that Mei's hands were over
 * her mouth. The auditor (told the moment is not its job, and doing it anyway) was the only one who restated them. The
 * house knows exactly who is here and what the ledger says of each: the people THIS page shows (its telling, before
 * any window, never the main character — his place is his header's) are handed to the reader by name, each with the
 * ledger's words, and it answers for each in "here". Its words are written where they are the page's own and say
 * something the ledger does not (engine/apply.js restatedPresence); the ledger's own words back are no change. */
export function placesBlock(state, pageText = '') {
  const told = narrationOf(scenePartOf(String(pageText || '').replace(/^\s*\[[^\n]*\][ \t]*/, '')));
  const rows = [];
  for (const p of Array.isArray(state && state.present) ? state.present : []) {
    if (!p || typeof p.name !== 'string' || !p.name.trim() || isMc(state, p.name)) continue;
    if (!shownOnPage(state, told, p.name)) continue;
    const at = typeof p.position === 'string' && p.position.trim() ? p.position.trim() : '';
    const wears = typeof p.attire === 'string' && p.attire.trim() ? p.attire.trim() : '';
    rows.push(p.name + ' \u2014 the ledger has: ' + (at || 'no place written') + (wears ? '; wearing ' + wears : ''));
    if (rows.length >= 16) break;
  }
  if (!rows.length) return [];
  /* M679 — HIS AUDIT: "the ledger seats the cobbler, the fruit-seller, the young priest, the pie-seller and the raven as
   * 'here now' in the scene, but the latest page leaves them all behind on Gilder's Row … while Azrael and Roska walk south
   * to the Bent Kettle". This block told the reader to give EACH person the page shows in "here" — and "here" is the room
   * as the page ends: whoever is in it came along (extractTurn cameAlong). The cobbler the page shows in his doorway as
   * Azrael walks off was to be answered "here, in his own doorway on Gilder's Row" — kept in the scene with a place on
   * another street — and on a move a right leave for him was thrown away beside it. Each person is answered one of TWO
   * ways now: still with him (in "here", with where), or no longer with him (a leave, with where they are now). */
  return [
    'WHERE EACH OF THEM IS AS THIS PAGE ENDS. The page shows these people; answer for EACH of them, one of two ways.',
    'STILL WITH HIM as the page ends: in "here" as {"name":"…","at":"…"} — where they are and what they are doing, in the',
    'page’s own words: a hand that came down, a cup picked up, a place crossed to, a chin back in a palm is where they are',
    'now, and the ledger’s line is a lie until you write it; where the page leaves someone exactly as the ledger has them,',
    'give the ledger’s words back. Add "wears" only when the page shows their dress change.',
    'NO LONGER WITH HIM — they went, or he walked off and left them where they were: NOT in "here", but a presence.leave',
    'for them, with "to" (where they are now, said so it stands on its own) and "shown" (the page’s own words for the',
    'going — theirs, or his).',
    ...rows.map((r, i) => (i + 1) + '. ' + r),
    '',
  ];
}

/* M641: WHO HAS NO STANDING YET, EACH TO BE DECIDED — the open threads' own cure (M280, below), for the same fault. His
 * report: "How they feel toward you, after #story — it's been twenty scenes and it keeps being empty… many versions ago it
 * was fine, or sometimes it's not." The reader's own instructions kept it empty: a standing moves only when THE NEW PAGE
 * reveals something ("flat is the default", "be conservative"), and the pages before it are "already read — nothing on
 * them is yours to write". So a bond the opening's reader did not write — or one that simply shows itself over several
 * pages, with no single page of revelation — could never be written afterwards by any page, however plain it was to
 * anyone reading the story. Whether a tale had standings came down to how bold one reading of one page happened to be.
 * The house knows exactly who is in the scene with him and has no standing: the reader is handed them BY NAME and
 * answers for each, in a slot of its own — where the pages show a feeling toward him it is written (for this, the pages
 * already read count), and where they show none it says so, and nothing is written. Strangers stay at nothing. */
export function unwrittenStandings(state, pageText = '') {
  const out = [];
  const rels = state && state.relationships && typeof state.relationships === 'object' ? state.relationships : {};
  const chars = state && state.characters && typeof state.characters === 'object' ? state.characters : {};
  const take = (raw) => {
    const name = String(raw || '').trim();
    if (out.length >= 8 || !name || !/^\p{Lu}/u.test(name) || isMc(state, name)) return; /* a named person — never "the waitress", "two guards", or him */
    /* "has a standing" exactly as the ledger's own door decides it (apply.js findPersonRel, M419) — a name that door would
     * lead to someone's standing is never asked about, so a decision can only ever open a book, never write over one */
    if (personBookKey(state, rels, name, (map, n) => { const f = findRelationship(map, n); return f ? f.key : null; })) return;
    const key = findPersonKey(chars, name);
    if (key && chars[key] && chars[key].retired) return;
    if (out.some((n) => samePersonName(n, name))) return;
    out.push(name);
  };
  /* everyone in the scene with him as the page begins… */
  for (const p of Array.isArray(state && state.present) ? state.present : []) take(typeof p === 'string' ? p : p && p.name);
  /* …and anyone the people's book knows whom THIS page names — the mother on the phone, the sister who texts: a person he
   * deals with from afar is never "in the scene", and was never asked about at all */
  const page = String(pageText || '');
  if (page.trim()) for (const name of Object.keys(chars)) if (nameOnPage(page, name)) take(name);
  return out;
}
export function standingsBlock(names) {
  const list = (Array.isArray(names) ? names : []).filter((n) => typeof n === 'string' && n.trim());
  if (!list.length) return [];
  return [
    'NO STANDING IS WRITTEN YET for these people, who are in the scene with him or named on this page — decide each one, in a fourth key of your answer, "standings":',
    ...list.map((n, i) => (i + 1) + '. ' + n),
    'One entry for each. {"name":"…","p":N,"r":N,"s":N,"cause":"what on the pages shows it"} when the pages above or this page show how they feel toward him — FOR THIS, the pages already read count: a bond that already exists (REVEALED, NOT EARNED, at its levels), or what their dealings with him have made of it so far. Leave out an axis that stands at zero. {"name":"…","none":"why"} when they have shown no feeling toward him at all — a stranger doing a job, a face in the room: strangers stay at nothing, and nothing is guessed.',
    '',
  ];
}

/* M280: THE OPEN THREADS, EACH TO BE DECIDED. Closing a thread the page
 * resolved was item four of a checklist, under "be conservative" — and a
 * thread resolved over a few pages stayed open until the auditor, reading
 * several at once, closed five in one reading. The page reader is handed the
 * open threads by name and answers, in their own slot, which this page
 * resolved. */
export function openThreadsBlock(state) {
  const threads = (state && Array.isArray(state.threads) ? state.threads : [])
    .filter((t) => t && typeof t === 'object' && typeof t.title === 'string' && t.title.trim());
  if (!threads.length) return [];
  return [
    /* M679 — HIS AUDIT: "the thread 'Roska and the fence behind the no-sign door' is still hot, but the pages show Roska abandon
     * the knock and walk off with Azrael"; "'Marget and the watch' is still hot … the watch's visit is done". Asked for the
     * titles THIS page resolved, the reader answered with a list it could leave empty — and a thread one page left behind and
     * its reader did not close could never be closed by the next page's reader ("the pages before are already read"):
     * only the auditor, reading them all, closed it. Every open thread now gets its own verdict, judged by how the story
     * STANDS at the end of this page (the pages just before count, and so does the window into the world beyond — where
     * the watch's visit ended), the way M641 asks the standings and M677 the room. */
    'OPEN THREADS — decide EVERY one against the story as it stands at the END of this page: this page, the pages just before it (for this they count — a thread one of them already answered is answered), and the page\u2019s window into the world beyond (*** The World Beyond ***) too. In "threads", one entry for each, its title as written here: {"title":"…","now":"resolved"} when the story has ANSWERED it, ENDED it, or LEFT IT BEHIND FOR GOOD — what it waited on has happened, has failed, or can no longer happen (the bell has rung and nobody came; the watcher has heard them out and moved on; the scene it belonged to is over and the story has walked away from it); {"title":"…","now":"open"} when it is still live:',
    ...threads.map((t, i) => (i + 1) + '. \u201c' + t.title.trim() + '\u201d' + (t.owner ? ' (' + t.owner + ')' : '')
      + (t.next ? ' \u2014 next: ' + String(t.next).trim() : '') + (t.heat === 'cold' ? ' [cold]' : '')),
    '',
  ];
}

/* M663 (the audit he asked for: "auditor is final defense, not necessary defense" — the auditor's own checklist, each kind
 * held against who is asked FIRST): THE OPEN WOUNDS, EACH TO BE DECIDED. "A wound the pages show healed still open" is
 * on the auditor's list of what is its to find — and nobody before it was ever ASKED. The page reader may write
 * body.heal, as it could always close a thread; it was the open threads handed by name (M280) that got threads closed
 * on the page that resolved them. The wounds that stand open on the people of this page are handed over the same way,
 * and it answers in a slot of their own which ones this page shows healed. */
export function openWoundsBlock(state, pageText = '') {
  const bodies = state && state.bodies && typeof state.bodies === 'object' ? state.bodies : {};
  const scene = scenePartOf(String(pageText || ''));
  const rows = [];
  for (const [name, body] of Object.entries(bodies)) {
    const open = (body && Array.isArray(body.injuries) ? body.injuries : []).filter((i) => i && !i.healed && typeof i.what === 'string' && i.what.trim());
    if (!open.length) continue;
    if (!(isHere(state, name) || isMc(state, name) || nameOnPage(scene, name))) continue; /* the people of this page */
    for (const i of open.slice(0, 4)) rows.push({ name, what: i.what.trim(), treated: i.treated === true });
    if (rows.length >= 12) break;
  }
  if (!rows.length) return [];
  return [
    /* M679: by how the story STANDS at the end of this page, the pages just before counting — a heal one page showed and its
     * reader missed is closed by the next page's reader, not left for the auditor */
    'OPEN WOUNDS — decide each against the story as it stands at the END of this page (the pages just before it count for this: a wound one of them showed healed is healed); the ones it shows healed, mended or gone go in "healed" as {"name":"…","what":"…"}, worded as written here (a wound the story does not touch stays as it is — never close one because time has passed):',
    ...rows.map((r, n) => (n + 1) + '. ' + r.name + ' — ' + r.what + (r.treated ? ' (treated)' : '')),
    '',
  ];
}

/* M666: NAMED ON THE PAGE, SEATED ELSEWHERE — EACH TO BE DECIDED. The page reader was left to work out for itself that Salla,
 * named in the telling, was still at the tavern's casks: it saw her seat only as one line in the whole ledger. Whoever
 * the ledger keeps somewhere else and this page names is handed over by name, with where the ledger has them, and the
 * one question that matters: did this page bring them face to face with him, or are they seen, heard or calling from
 * where they are? (The world agent has had the cast of the page since M660; the reader, who writes who is here, had not.) */
export function namedFromAfarBlock(state, pageText = '') {
  const scene = scenePartOf(String(pageText || ''));
  if (!scene.trim() || !state || typeof state !== 'object') return [];
  const off = state.offscreen && typeof state.offscreen === 'object' ? state.offscreen : {};
  const rows = [];
  for (const [name, seat] of Object.entries(off)) {
    if (!name || !seat || typeof seat !== 'object' || isMc(state, name) || isHere(state, name) || seat.dead || seat.gone) continue;
    if (!nameOnPage(scene, name)) continue;
    const where = typeof seat.location === 'string' && seat.location.trim() ? seat.location.trim() : (typeof seat.lastSeen === 'string' && seat.lastSeen.trim() ? 'last seen at ' + seat.lastSeen.trim() : 'whereabouts not written');
    rows.push(name + ' [' + where + ']');
    if (rows.length >= 8) break;
  }
  if (!rows.length) return [];
  const mc = mcName(state);
  const him = mc && mc !== 'the player' ? mc : 'the main character';
  return [
    'NAMED ON THIS PAGE BUT NOT IN THE SCENE AS IT OPENS — decide each (where the ledger has them is in brackets):',
    ...rows.map((r, i) => (i + 1) + '. ' + r),
    'One of these goes in "here" ONLY if this page brings them face to face with ' + him + ' where he now is, and they are still there as the page ends. Seen, heard, called to, or watching from where they are is NOT here: leave them out of "here" and write no presence.enter for them (if the page shows where they are now, that is an offscreen.set). What one of them plainly sees or overhears from there, they have learned — name them in that knowledge line\'s "who".',
    '',
  ];
}

/* M667: WITHIN EARSHOT, BY NAME. "The one-armed old campaigner now knows: heard the hooded girl name herself" — written by the
 * auditor. Whoever the ledger keeps close by the scene (state.js closeBy: at the door, in the next room, at the alley's
 * mouth — "they can hear, see, or answer the door") is handed to the page reader by name, with the one thing to
 * decide: did this page show them see or overhear something? Then they have learned it, and the line names them. */
export function withinEarshotBlock(state) {
  const near = closeBy(state).slice(0, 8);
  if (!near.length) return [];
  return [
    'WITHIN EARSHOT — not in the scene, but close enough to see or hear it from where they are (decide each):',
    ...near.map((n, i) => (i + 1) + '. ' + n.key + ' [' + n.location + ']'),
    'If THIS page shows one of them watching, listening or overhearing what is said or done in the scene, they have learned it: write that knowledge line with their name in its "who". If the page shows no such thing, write nothing for them — being near is not knowing.',
    '',
  ];
}
/* M667: THE THINGS THIS PAGE NAMES, EACH TO BE DECIDED (see apply.js movedThings). */
/* M679 — HIS AUDIT: "the ledger's Things list says the purse is in Roska's fist, purse-strings cold in her own hand, though
 * the pages show her drop it into Azrael's open palm". A thing was handed to the reader only when the page named it by its
 * own words — and a handover is told with "it" ("she dropped it into his open palm"): the purse never reached the question,
 * and nobody but the auditor moved it. A thing in the hands or the company of the people of this page (him, the room,
 * anyone its telling names — the people its place names) is handed over too, and the answer may say whose it is now when
 * the page changes that (the list read "(Roska's)" of the purse she had stolen). */
export function thingsOnPageBlock(state, pageText = '') {
  const kept = state && state.things && typeof state.things === 'object' ? state.things : {};
  const told = narrationOf(scenePartOf(String(pageText || '').replace(/^\s*\[[^\n]*\][ \t]*/, '')));
  const scene = told.toLowerCase();
  if (!scene.trim()) return [];
  /* the people of this page: him, everyone in the scene, and anyone its telling names */
  const people = [];
  const add = (n) => { const t = String(n || '').trim(); if (t && !people.some((p) => samePersonName(p, t))) people.push(t); };
  const mc = mcName(state);
  if (mc && mc !== 'the player') add(mc);
  for (const p of Array.isArray(state && state.present) ? state.present : []) add(p && p.name);
  for (const n of Object.keys(state && state.characters && typeof state.characters === 'object' ? state.characters : {})) if (nameOnPage(told, n)) add(n);
  const carried = (t) => people.some((n) => nameOnPage(String(t.where || ''), n));
  const rows = [];
  for (const [name, t] of Object.entries(kept)) {
    if (!t || typeof t !== 'object' || typeof t.where !== 'string' || !t.where.trim()) continue;
    const words = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((w) => w.length >= 4 && !/^(?:from|with|that|this|their|some|into|over|under)$/.test(w));
    const on = words.filter((w) => new RegExp('(?<![\\p{L}])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}])', 'u').test(scene));
    const named = words.length > 0 && on.length / words.length >= 0.5;
    if (!named && !carried(t)) continue;
    rows.push(name + (t.owner ? ' (' + t.owner + '’s)' : '') + ' — ' + t.where.trim());
    if (rows.length >= 12) break;
  }
  if (!rows.length) return [];
  return [
    'THINGS THE LEDGER KEEPS THAT THIS PAGE NAMES, OR IN THE HANDS AND COMPANY OF ITS PEOPLE — decide each: where is it as the story stands at the END of this page? One whose place this page changes goes in "things" as {"name":"…","where":"…"}, named as written here, the place in the page\'s own words — a thing handed over, dropped, pocketed or taken is in its new place even where the page only calls it "it". Add "owner" only when the page changes whose it is by right (given, sold, won, handed back to the one it belongs to — a thief, or someone only holding it, is not its owner). One the page leaves where it was stays out:',
    ...rows.map((r, i) => (i + 1) + '. ' + r),
    '',
  ];
}

/* M679 — HIS AUDIT: "the ledger's Roska page still carries the loose end that the watch has her description and Azrael is
 * hunting her himself, but the pages show Azrael has found her, taken his purse back, and led her to the tavern". A person's
 * loose ends were the one lasting kind of the auditor's list that nobody before it was ASKED about by name: M663 named the
 * scribe — SHOWN them on the people's pages, never asked about each, and reading one page, never the ones before it.
 * The loose ends open on the people of this page (him, everyone in the scene, anyone the page names — its window too)
 * are handed to the page reader, which reads the pages before it, each to be decided in a slot of its own; one the story
 * has answered is closed (people.note unthread, matched by sense — people.js sameLooseEnd). */
export function looseEndsBlock(state, pageText = '') {
  const chars = state && state.characters && typeof state.characters === 'object' ? state.characters : {};
  const page = String(pageText || '');
  const rows = [];
  for (const [name, c] of Object.entries(chars)) {
    if (!c || typeof c !== 'object' || c.retired || !Array.isArray(c.threads) || !c.threads.length) continue;
    if (!(isMc(state, name) || isHere(state, name) || nameOnPage(page, name))) continue; /* the people of this page */
    for (const t of c.threads) {
      if (typeof t === 'string' && t.trim() && rows.length < 16) rows.push({ name, text: t.trim() });
    }
    if (rows.length >= 16) break;
  }
  if (!rows.length) return [];
  return [
    'LOOSE ENDS STILL OPEN on the people of this page — decide EVERY one against the story as it stands at the END of this page (the pages just before it count for this, and so does the page’s window). In "loose", one entry for each, worded exactly as written here: {"name":"…","text":"…","now":"closed"} when the story has answered it, ended it or left it behind for good — a question asked and answered, a promise kept or broken, a search or a hunt over, a debt paid; {"name":"…","text":"…","now":"open"} when it still hangs. ' + LOOSE_ANSWERED_MEANS,
    ...rows.map((r, i) => (i + 1) + '. ' + r.name + ' — “' + r.text + '”'),
    '',
  ];
}

/* M679 — HIS AUDIT: "the ledger's ground is Ilvarren … the latest page leaves them all behind on Gilder's Row and the temple
 * square while Azrael and Roska walk south to the Bent Kettle". His storyteller's header names only the city ("[Ilvarren —
 * …]") and the header is the truth for the ground, in code (M128): the ground was the city on every page, so as far as the
 * ledger knew the scene never moved from one street to the next, and each street's crowd walked along to the next one
 * (leaving people behind, M509-12, needs a move). Nobody was asked where IN the city the scene stood — the reader was told
 * the header's place is written in code, and that a header naming only the area is "no move" (M627). When the page's
 * header names only the area (no one spot — M396's measure), or there is no header and the ledger has only an area, the
 * reader is asked by name, in a slot of its own: where in it does the scene stand as the page ends. */
export function spotBlock(state, pageText = '') {
  const page = String(pageText || '');
  const ground = state && state.place && typeof state.place.name === 'string' ? state.place.name.trim() : '';
  const area = pageArea(page, ground);
  if (!area) return [];
  const said = headerPlaceOf(page);
  return [
    'WHERE THE SCENE STANDS. ' + (said ? 'This page’s header names only the area — “' + said + '” — never where in it the scene is' : 'The ledger has only the area — “' + area + '”') + '; that is yours to say. The ledger has the scene at: “' + (ground || 'nowhere yet') + '”.',
    'In "spot", say where the scene stands as this page ENDS — the street, the building, the room — in the page’s own words (the house adds the area). When the page takes him from one spot in it to another, the scene has moved: whoever stays behind is left behind (presence.leave).',
    '',
  ];
}
/* the place a page's header names, as written ('' when it has none) */
function headerPlaceOf(pageText) {
  const set = headerMutations(String(pageText || ''), { ground: '' }).find((m) => m && m.type === 'place.set');
  return set && typeof set.name === 'string' ? set.name.trim() : '';
}
/* M679: the AREA a page stands in when nothing says the spot — the header's place when it names no one spot; with no header,
 * the ledger's ground when that is only an area. '' when the header (or the ledger, with no header) names a spot. */
export function pageArea(pageText, ground = '') {
  const said = headerPlaceOf(pageText);
  if (said) return noOneSpot(said) ? said : '';
  const g = String(ground || '').trim();
  return !headerCells(pageText) && g && noOneSpot(g) ? g : '';
}
/* M679: the reader's spot, held to the page and written with its area — '' when it is not one spot, or not the page's own
 * words (never a street the page does not name) */
const SPOT_STOP = /^(?:the|this|that|with|from|into|onto|near|back|front|side|outside|inside|over|under|where|there|here|still|street|road|lane|square|room|hall|house)$/;
export function spotOnPage(spot, area, pageText = '') {
  const s = String(spot || '').replace(/[[\]|\n]/g, ' ').replace(/\s+/g, ' ').replace(/^[\s,;:.—–-]+|[\s,;:.—–-]+$/g, '').trim().slice(0, 120);
  if (!s || noOneSpot(s)) return '';
  const page = ' ' + foldName(scenePartOf(String(pageText || ''))) + ' ';
  const words = foldName(s).split(' ').filter((w) => w.length >= 4 && !SPOT_STOP.test(w));
  if (!words.length || words.filter((w) => page.includes(' ' + w + ' ')).length / words.length < 0.5) return '';
  const a = String(area || '').trim();
  if (!a) return s;
  const areaWords = foldName(a).split(' ').filter(Boolean);
  const own = ' ' + foldName(s) + ' ';
  return areaWords.length && areaWords.every((w) => own.includes(' ' + w + ' ')) ? s : s + ', ' + a;
}

/* M28: a ledger is young when it has no ground and nobody in it — the same
 * test the founding read (M27) uses in chat.js. One home for it. */
export function isYoungLedger(state) {
  return !(state && state.place) && !((state && state.present) || []).length;
}

/* ---------- the tolerant parser ---------- */

/* M679: the words a verdict closes with — a thread "resolved", a loose end "closed", as a model may write either */
const CLOSED_WORD = /^(?:resolved|closed|close|done|ended|over|answered|finished|settled|kept|broken|abandoned|left behind(?: for good)?|gone|complete[d]?)\b/i;
const verdictCloses = (v) => v.resolved === true || v.closed === true || CLOSED_WORD.test(String(v.now || v.verdict || v.status || '').trim());

/* Exported for the harness. Fences stripped, first balanced object parsed,
 * mutations kept only if they're objects with a string type — the rest of
 * the validation is the applier's job (engine/apply.js). Any trouble at all
 * resolves to {mutations:[]}. */
export function parseExtractorAnswer(raw, { standingsFor = [] } = {}) {
  try {
    /* M26: reasoning models think out loud first — and their thinking often
     * contains braces, which used to steal the first-balanced-object parse
     * and silently starve the ledger. Thinking spans are stripped, then up
     * to five balanced candidates are tried until one holds a mutations list. */
    let text = String(raw || '');
    text = text.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '');
    text = text.replace(/```(?:json|JSON)?/g, '');
    const candidates = balancedCandidates(text, 5);
    let parsed = null;
    for (const c of candidates) {
      /* M31: strict, then the repair pass (comments, trailing commas, raw
       * newlines in strings) — a cheap model's usual slips. */
      const p = parseLenient(c);
      if (p && Array.isArray(p.mutations)) { parsed = p; break; }
    }
    if (!parsed && candidates[0]) parsed = parseLenient(candidates[0]);
    if (!parsed) return { mutations: [], note: 'unusable' };
    const list = Array.isArray(parsed.mutations) ? parsed.mutations : [];
    const mutations = list.filter(
      (m) => m && typeof m === 'object' && typeof m.type === 'string' && m.type.trim()
    );
    /* M642: WHO SAW IT IS THE READER'S OWN ANSWER. A knowledge.add that says "who" is written for exactly those people —
     * one line each, marked `decided` so nothing downstream guesses again; "everyone here" waits (room: true) for the room
     * this page ends with, which extractTurn knows. A line with only a "name", as the reader always wrote them, is left
     * exactly as it was. */
    for (let i = mutations.length - 1; i >= 0; i -= 1) {
      const m = mutations[i];
      if (m.type !== 'knowledge.add' || m.who === undefined || m.who === null) continue;
      const { who, ...rest } = m;
      /* the whole phrase, never a name that merely begins like it ("All Might" is a person) */
      const EVERYONE = /^\s*(?:(?:everyone|everybody)(?:\s+(?:here|present|there|in\s+the\s+\p{L}+))?|all\s+(?:here|present|of\s+them))\s*$/iu;
      const listed = (Array.isArray(who) ? who : [who]).map((n) => (typeof n === 'string' ? n : n && typeof n.name === 'string' ? n.name : '')).map((n) => String(n || '').trim()).filter((n) => n && n.length <= 80);
      const wholeRoom = listed.some((n) => EVERYONE.test(n));
      const names = [];
      for (const n of [typeof rest.name === 'string' ? rest.name.trim() : '', ...listed.filter((x) => !EVERYONE.test(x))]) if (n && !names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
      const lines = names.map((n) => ({ ...rest, name: n, decided: true }));
      if (wholeRoom) { const { name: _one, ...roomLine } = rest; lines.unshift({ ...roomLine, room: true, decided: true }); }
      mutations.splice(i, 1, ...(lines.length ? lines : [rest]));
    }
    /* M280: each title the page resolved closes its thread (once) */
    const closing = new Set(mutations.filter((m) => m.type === 'thread.close').map((m) => String(m.title || m.name || '').trim().toLowerCase()));
    /* M663: each wound this page healed closes (once) — a body.heal of the same wound among the changes is the same answer */
    for (const h of (Array.isArray(parsed.healed) ? parsed.healed : []).slice(0, 12)) {
      if (!h || typeof h !== 'object' || typeof h.name !== 'string' || typeof h.what !== 'string' || !h.name.trim() || !h.what.trim()) continue;
      const name = h.name.trim().slice(0, 80); const what = h.what.trim().slice(0, 200);
      if (mutations.some((m) => m && m.type === 'body.heal' && String(m.name || '').trim().toLowerCase() === name.toLowerCase() && String(m.what || '').trim().toLowerCase() === what.toLowerCase())) continue;
      mutations.push({ type: 'body.heal', name, what });
    }
    for (const title of (Array.isArray(parsed.resolved) ? parsed.resolved : [])) {
      const t = typeof title === 'string' ? title.trim() : (title && typeof title.title === 'string' ? title.title.trim() : '');
      if (!t || closing.has(t.toLowerCase())) continue;
      closing.add(t.toLowerCase());
      mutations.push({ type: 'thread.close', title: t });
    }
    /* M679: every open thread's own verdict (openThreadsBlock) — "resolved" closes it; "open", or a word that is neither, leaves
     * it as it stands. The old list of titles above is still read, for an answer written the old way. */
    for (const v of (Array.isArray(parsed.threads) ? parsed.threads : []).slice(0, 40)) {
      if (!v || typeof v !== 'object') continue;
      const t = typeof v.title === 'string' ? v.title.trim() : (typeof v.name === 'string' ? v.name.trim() : '');
      if (!t || !verdictCloses(v) || closing.has(t.toLowerCase())) continue;
      closing.add(t.toLowerCase());
      mutations.push({ type: 'thread.close', title: t.slice(0, 200) });
    }
    /* M679: every loose end of the page's people, its own verdict (looseEndsBlock) — "closed" closes it on that person's page */
    for (const v of (Array.isArray(parsed.loose) ? parsed.loose : []).slice(0, 24)) {
      if (!v || typeof v !== 'object' || typeof v.name !== 'string' || typeof v.text !== 'string' || !v.name.trim() || !v.text.trim()) continue;
      if (!verdictCloses(v)) continue;
      const name = v.name.trim().slice(0, 80); const loose = v.text.trim().replace(/^[“"']+|[”"']+$/g, '').slice(0, 300);
      if (mutations.some((m) => m && m.type === 'people.note' && m.field === 'unthread' && m.name === name && m.text === loose)) continue;
      mutations.push({ type: 'people.note', name, field: 'unthread', text: loose });
    }
    /* M444: the room as it stands at the end of the page — names only; the house decides who is written in */
    const here = (Array.isArray(parsed.here) ? parsed.here : [])
      .map((h) => (typeof h === 'string' ? h : h && typeof h.name === 'string' ? h.name : ''))
      .map((h) => String(h || '').trim()).filter((h) => h && h.length <= 80);
    /* M660: …and, where the page shows it, where each stands and what each wears as the page ends */
    const hereNotes = (Array.isArray(parsed.here) ? parsed.here : [])
      .filter((h) => h && typeof h === 'object' && typeof h.name === 'string' && h.name.trim() && (typeof h.at === 'string' || typeof h.wears === 'string'))
      .map((h) => ({ name: h.name.trim().slice(0, 80), at: typeof h.at === 'string' ? h.at.trim() : '', wears: typeof h.wears === 'string' ? h.wears.trim() : '' }))
      .filter((h) => h.at || h.wears);
    /* M641: the standings it was asked to decide, each by name — one that shows a feeling is written where it stands
     * (rel.set, its cause in words); a "none", an entry with no cause, or a name it was not asked about writes nothing */
    const asked = (Array.isArray(standingsFor) ? standingsFor : []).filter((n) => typeof n === 'string' && n.trim());
    if (asked.length) {
      const moved = new Set(mutations.filter((m) => m.type === 'rel.set' || m.type === 'rel.shift').map((m) => String(m.name || '').trim().toLowerCase()));
      for (const e of (Array.isArray(parsed.standings) ? parsed.standings : [])) {
        if (!e || typeof e !== 'object' || typeof e.name !== 'string' || !e.name.trim()) continue;
        const who = asked.find((n) => n.toLowerCase() === e.name.trim().toLowerCase()) || asked.find((n) => samePersonName(n, e.name));
        if (!who || moved.has(who.toLowerCase())) continue;
        const given = {};
        for (const axis of ['p', 'r', 's']) { const v = e[axis] === null || e[axis] === '' || typeof e[axis] === 'boolean' ? NaN : numberOf(e[axis]); if (Number.isFinite(v) && v !== 0) given[axis] = v; } /* M654 */
        const cause = typeof e.cause === 'string' ? e.cause.trim() : '';
        if (!Object.keys(given).length || !cause) continue;
        moved.add(who.toLowerCase());
        mutations.push({ type: 'rel.set', name: who, ...given, cause });
      }
    }
    /* M662: how someone looks, as this page shows it (the house locks what is new and is the page's own — apply.js lockedLooks) */
    const looks = (Array.isArray(parsed.looks) ? parsed.looks : [])
      .filter((l) => l && typeof l === 'object' && typeof l.name === 'string' && typeof l.key === 'string' && typeof l.value === 'string' && l.name.trim() && l.key.trim() && l.value.trim())
      .map((l) => ({ name: l.name.trim().slice(0, 80), key: l.key.trim().slice(0, 40), value: l.value.trim().slice(0, 240) })).slice(0, 12);
    /* M667: where the things this page names now lie (the house writes one when it is the page's own words and new — apply.js movedThings) */
    const things = (Array.isArray(parsed.things) ? parsed.things : [])
      .filter((t) => t && typeof t === 'object' && typeof t.name === 'string' && typeof t.where === 'string' && t.name.trim() && t.where.trim())
      .map((t) => ({ name: t.name.trim().slice(0, 120), where: t.where.trim().slice(0, 240), ...(typeof t.owner === 'string' && t.owner.trim() ? { owner: t.owner.trim().slice(0, 120) } : {}) })).slice(0, 12); /* M679: whose it is, when the page changed that */
    /* M679: where in the area the scene stands as the page ends (spotBlock) — the house holds it to the page (spotOnPage) */
    const spot = typeof parsed.spot === 'string' ? parsed.spot.trim().slice(0, 160) : '';
    return { mutations, note: mutations.length || looks.length || things.length || spot ? 'ok' : 'empty', here, hereNotes, looks, things, spot };
  } catch (err) {
    return { mutations: [], note: 'unusable' };
  }
}

/* ---------- the contract ---------- */

/* Read one finished turn and propose mutations.
 *
 * M28: transport failures THROW — the workers' queue retries them with
 * backoff (honoring Retry-After) and writes one plain word on the workers
 * line. What never throws: an answer we can't use, which resolves
 * {mutations:[], note:'unusable'} so the drawer can say so. A missing
 * connection or an empty page resolves {mutations:[], failed:true}. */
/* M402: SILENCE IS NOT LEAVING. Kyōraku stood at the rail of the very courtyard the scene was in; a page that did not
 * name him was read as him leaving, and the ledger said "elsewhere — last seen at 10th Division HQ, training
 * courtyard", the scene's own ground. The page reader may take someone out of the scene only when the page (or his
 * message) names them — a departure is written about the person who departs; someone the page never mentions is
 * simply quiet, and stays (the world agent keeps them alive, M401). Held in code, whatever the model answered. */
export function leavesTheyWereShown(mutations, text) {
  /* M414: named by the one answer (engine/names.js nameOnPage) — a title or "the" is not the name, "Ed" is */
  return (Array.isArray(mutations) ? mutations : []).filter((m) => !(m && m.type === 'presence.leave' && !nameOnPage(text, m.name)));
}

/* M444: THE ROOM, RESTATED ON EVERY PAGE. Who is here was kept by what CHANGED — someone came in, someone left — and the
 * page reader is told that only the new page is news. So one wrong change stuck for good: Rukia, taken out of the scene
 * by another Kuchiki's leaving, stood beside him page after page, never written back in, because she never walked in —
 * she had been there all along. The mood board is restated whole on every page for exactly this (M47/M92); the room is
 * now too, the page reader's "here". Whoever it names who is not written in walks in — when the page's own telling
 * (before any window, outside the spoken lines) names them, the name means one person, and the same answer does not
 * take them out or seat them elsewhere. The main character is the page's own eye and needs no naming. Nobody is ever
 * taken OUT for being left off (M402: silence is not leaving). */
export function hereFromBoard(state, here, assistantText, mutations = []) {
  const names = (Array.isArray(here) ? here : []).map((h) => String(h || '').trim()).filter(Boolean);
  if (!names.length || !state || typeof state !== 'object') return [];
  const told = narrationOf(scenePartOf(assistantText));
  const list = Array.isArray(mutations) ? mutations : [];
  const said = (types, n) => list.some((m) => m && types.includes(m.type) && typeof m.name === 'string' && samePersonName(m.name, n));
  const mc = mcName(state);
  const out = [];
  for (const n of names) {
    if (isMc(state, n)) {
      if (mc === 'the player' || isHere(state, mc) || said(['presence.enter', 'presence.leave'], mc) || out.some((m) => m.name === mc)) continue;
      out.push({ type: 'presence.enter', name: mc, cause: 'the page is told through their eyes' });
      continue;
    }
    if (isHere(state, n) || said(['presence.enter', 'presence.leave', 'offscreen.set'], n) || !oneMeaning(state, n)) continue;
    const name = pageNameFor(state, n) || n;
    if (!shownOnPage(state, told, n) && !shownOnPage(state, told, name)) continue; /* named as themself, never by a family name another shares */
    if (out.some((m) => samePersonName(m.name, name))) continue;
    out.push({ type: 'presence.enter', name, cause: 'the page shows them here' });
  }
  return out;
}

export { mcWalksOff } from '../engine/apply.js'; /* M598: one reading, kept with goneAtTheEnd — the auditor reads it too */
export async function extractTurn(args = {}) {
  const read = await extractTurnRead(args);
  if (read && Array.isArray(read.mutations)) {
    /* M679: THE SPOT IN AN AREA (spotBlock). When the header names only the area (or there is no header and the ledger has
     * only an area), the reader's "spot" — or its own place.set that names a spot — is the ground, held to the page's own
     * words and written with its area ("Cooper's Row, Ilvarren"); a spot the page does not hold is not written. A place.set
     * of the reader's that names the same area again is the header's to give; one naming another area altogether (a train
     * to Tokyo, M627) stands as before. */
    {
      const groundNow = args.state && args.state.place && typeof args.state.place.name === 'string' ? args.state.place.name : '';
      const area = args.state ? pageArea(args.assistantText, groundNow) : '';
      if (area) {
        const placeOf = (m) => String((m && (m.name || m.place)) || '');
        const sets = read.mutations.filter((m) => m && m.type === 'place.set');
        const given = read.spot || placeOf(sets.find((m) => !noOneSpot(placeOf(m)))) || '';
        const spot = spotOnPage(given, area, args.assistantText);
        /* the area the header itself writes (none when it names only the area round a spot the ledger holds — then a move to
         * another area altogether is the reader's own to write, M627) */
        const headerGives = placeOf(headerMutations(args.assistantText, { ground: groundNow }).find((m) => m && m.type === 'place.set'));
        read.mutations = read.mutations.filter((m) => !(m && m.type === 'place.set' && (spot || !noOneSpot(placeOf(m)) || (headerGives && samePlace(placeOf(m), headerGives)))));
        /* first among the reader's own changes: a move lets every place in the room go (apply.js place.set), and the places
         * this page gives — a newcomer's, the room restated — are written after it, on the new ground */
        if (spot) read.mutations.unshift({ type: 'place.set', name: spot });
      }
      /* M679 (the same fault, wherever it stands): a place.set of the reader's own written AFTER the places it gave on the same
       * page let them go again (a move lets every place in the room go). The ground moves first; the room is written on it. */
      const moves = read.mutations.filter((m) => m && m.type === 'place.set');
      if (moves.length && read.mutations.findIndex((m) => m && m.type !== 'place.set') < read.mutations.findIndex((m) => m && m.type === 'place.set')) {
        read.mutations = [...moves, ...read.mutations.filter((m) => !(m && m.type === 'place.set'))];
      }
    }
    /* M594: a leave needs its person named on the page — unless the page ends on HIM going: then everyone he walks away
     * from is left behind, named or not ("He left without a word" leaves the room behind him) */
    const mcGoing = Boolean(args.state && mcName(args.state) && mcName(args.state) !== 'the player' && mcWalksOff(args.assistantText, mcName(args.state)));
    if (!mcGoing) read.mutations = leavesTheyWereShown(read.mutations, String(args.userText || '') + '\n' + String(args.assistantText || ''));
    /* M446: A LEAVING IS WHAT THE PAGE ENDS ON. Named on the page was enough (M402) — so a step out and back, a walk to
     * the window, or a slip took Rukia out while she stood beside him. A leave stands only when the last sentence of the
     * scene that names them as themself (with the sentences that go on about them) narrates them going
     * (engine/apply.js goneAtTheEnd). */
    /* When the page MOVES the ground, the scene can leave someone behind without a word of their own going ("Ms. June
     * waved them off from the diner door" as they walked home, M304): there a leave stands unless the page's own room
     * (its "here") says they came along. */
    const was = args.state && args.state.place && typeof args.state.place.name === 'string' ? args.state.place.name : '';
    /* M679: the page's ground — its header's place when that names the spot; else the spot the reader gave (an area-only
     * header says nothing of where in it the scene stands); else the header's area */
    const headerSet = headerMutations(args.assistantText, { ground: was }).find((m) => m && m.type === 'place.set');
    const readerSet = read.mutations.find((m) => m && m.type === 'place.set');
    const ground = ((headerSet && !noOneSpot(headerSet.name) ? headerSet : null) || readerSet || headerSet || {}).name || ''; /* M627 */
    /* a header that names less of the same place ("13th Division Barracks" in the captain's office) is no move */
    const moved = Boolean(was && ground && !samePlace(ground, was) && !seatAtScene(was, ground) && !sameSpot(ground, was) && !withinGround(ground, was)); /* M628: the same spot with its area named is no move */
    const cameAlong = (n) => (Array.isArray(read.here) ? read.here : []).some((h) => samePersonName(h, n));
    /* M588 (his report: "my mc walks away from someone, she's not at his location, why is she still here?"): THE MAIN
     * CHARACTER WALKING AWAY IS A LEAVING TOO. A leave stood only when the page ended on HER going (M446) — so when HE
     * walked off and she stayed, the reader's right leave was thrown away. Now a leave also stands when the page ends on
     * the main character going (goneAtTheEnd of him). */
    const mcNow = args.state ? mcName(args.state) : '';
    /* HE is the one going — his name as the subject of a going in the scene's last sentences ("Jovan turned his back on her
     * and walked away"), never as its object ("Kuchiki-taichō nodded to Oda, then left" is the captain going) */
    const mcGone = Boolean(args.state && mcNow && mcNow !== 'the player' && mcWalksOff(args.assistantText, mcNow));
    read.mutations = read.mutations.filter((m) => {
      if (!(m && m.type === 'presence.leave' && args.state)) return true;
      const n = String(m.name || '');
      /* M644: …or the reader hands over the page's own words for it, and they hold (apply.js quotedGoing) */
      return moved ? !cameAlong(n) : (goneAtTheEnd(args.state, args.assistantText, n) || quotedGoing(args.state, args.assistantText, n, m.shown) || (mcGone && !cameAlong(n)));
    });
    /* M509-12: THE CROWD DOES NOT RIDE TO THE NEW GROUND. When the page MOVES the ground and says who is in the new room
     * (its "here"), everyone else who was in the old room is left behind there — Jovan ran out of the Tenth's courtyard
     * onto the approach road with Rukia and the runner, and twenty-one people stood "here now" on the road because the
     * reader had written no leave for the eighteen it did not name. A leave the reader forgot is written for each
     * present person (never the main character, never one the page's room names, never one already leaving); the
     * leave door seats them at the old ground (M304). Only when the page's room is actually named: an empty "here" is
     * a reader that said nothing, not a room with nobody in it. */
    /* a move to another place altogether — not "the Tenth's courtyard" written "Tenth Division courtyard" (one place
     * matcher and the other both miss that), nor a room of the same compound: the two names share no telling word */
    const tellingWords = (t) => new Set(String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((w) => w.length >= 4 && !/^(?:the|division|district|street|road|hall|house|room|floor|gate|north|south|east|west|upper|lower|inner|outer|main|back|front|side)$/.test(w)));
    /* M588: a move is "far" unless one name holds all the other's telling words (one names less of the same place —
     * "the Tenth's courtyard" / "Tenth Division courtyard"). Sharing ONE word was read as the same place: the academy's
     * courtyard and the academy's dormitory were one room, and whoever stood in the courtyard rode along to the dormitory. */
    const wasW = tellingWords(was); const groundW = tellingWords(ground);
    const holds = (a, b) => a.size > 0 && [...a].every((w) => b.has(w));
    const farMove = moved && !holds(wasW, groundW) && !holds(groundW, wasW);
    /* M588: and when the reader names nobody in the new room, the newest page is asked instead — whoever it does not show
     * at the new ground stayed at the old one (an empty "here" used to keep the whole old room standing beside him) */
    const shownHere = (n) => (Array.isArray(read.here) && read.here.length ? cameAlong(n) : shownOnPage(args.state, narrationOf(scenePartOf(args.assistantText)), n));
    /* M666 — HIS PASTED AUDITS, both: "the presence list still holds Salla 'here' in the service alley, but the pages last put
     * her behind the casks in the Gilded Eel" (and the old campaigner, at the dogleg outside). The crowd was left behind
     * only on a FAR move (two place names sharing no telling word); from the Eel to the lane outside it to the alley
     * off that lane, each step shares a word with the last, so the whole tavern walked along, page after page, for
     * the auditor to take out — twice. A NEAR move leaves people behind too — but only one that IS a move: a name that
     * holds all of the other's words is either the same place said more fully ("the Tenth's courtyard" / "Tenth
     * Division courtyard", M509-13b — nobody is left behind, and my first cut of this left two) or a place named BY
     * its neighbour: "the lane OUTSIDE the Gilded Eel", "the service alley OFF the lane". The second kind is told by
     * its own word of place standing before the neighbour's name. On such a move, when the page's own room is NAMED
     * (its "here"), whoever stood in the old room and is not in the new one stayed where they were. */
    const roomNamed = Array.isArray(read.here) && read.here.length > 0;
    const BESIDE = /(?<![\p{L}])(?:outside|behind|off|beyond|near|across from|across|opposite|below|beneath|above|under|past|beside|next to|in front of|back of|rear of|round the corner from|around the corner from)(?![\p{L}])/iu;
    const namedByNeighbour = (longer, shorterW) => { const m = String(longer || '').match(BESIDE); return Boolean(m) && holds(shorterW, tellingWords(String(longer).slice(m.index + m[0].length))); };
    const nearMove = moved && !farMove && roomNamed && ((holds(wasW, groundW) && namedByNeighbour(ground, wasW)) || (holds(groundW, wasW) && namedByNeighbour(was, groundW)));
    if ((farMove || nearMove) && args.state) {
      const leaving = new Set(read.mutations.filter((m) => m && m.type === 'presence.leave').map((m) => String(m.name || '').trim().toLowerCase()));
      for (const p of (Array.isArray(args.state.present) ? args.state.present : [])) {
        const n = p && typeof p.name === 'string' ? p.name.trim() : '';
        if (!n || isMc(args.state, n) || shownHere(n) || leaving.has(n.toLowerCase())) continue;
        read.mutations.push({ type: 'presence.leave', name: n, cause: 'left behind at ' + was + ' when the scene moved to ' + ground });
      }
    }
    /* M666: …and nobody the ledger has SEATED ELSEWHERE is written in against the page's own room. Taken out by the
     * auditor, Salla was "here" again a few pages on: the telling names her ("she called past them to the campaigner")
     * and a walk-in stands when the telling shows the person — though she was calling from the tavern. When the reader
     * names the room as the page ends and she is not in it, its own presence.enter for her is not kept: the room is
     * its last word on who is there. (Someone new, with no seat, is written in as before.) */
    if (roomNamed && args.state && args.state.offscreen && typeof args.state.offscreen === 'object') {
      /* M679: …nor by its other door — a seat let go (offscreen.clear: "they are in the scene now") is a walk-in too (clearsThatArrive,
       * below); against the room it names, the seat stands */
      read.mutations = read.mutations.filter((m) => !(m && (m.type === 'presence.enter' || m.type === 'offscreen.clear') && typeof m.name === 'string' && !isMc(args.state, m.name) && !isHere(args.state, m.name)
        && Object.keys(args.state.offscreen).some((k) => samePersonName(k, m.name)) && !cameAlong(m.name)));
    }
    /* M444: a note let go of someone the page shows is her walking in; and the room, restated, writes in whoever is missing */
    read.mutations = clearsThatArrive(args.state, read.mutations, scenePartOf(args.assistantText));
    read.mutations = [...read.mutations, ...hereFromBoard(args.state, read.here, args.assistantText, read.mutations)];
    /* M541: SOMEONE THE WORLD SEATED ELSEWHERE IS NOT WALKED BACK IN BY A MENTION. Claire drove off, the world seated her at
     * the corner of Mariner's Lane and Larkspur, and the next page — Rias talking about her, the narration naming her text —
     * wrote her back "here" (she stood in Who's here in a blouse with nowhere to stand, the world's seat let go). The page
     * reader's walk-in of someone seated elsewhere stands only when the newest page's own telling shows them and does not
     * show them going at its end — the test the auditor's walk-ins are held to (M535). */
    if (args.state && args.state.offscreen && typeof args.state.offscreen === 'object') {
      const told = narrationOf(scenePartOf(args.assistantText));
      read.mutations = read.mutations.filter((m) => {
        if (!m || m.type !== 'presence.enter' || typeof m.name !== 'string') return true;
        if (isHere(args.state, m.name) || isMc(args.state, m.name)) return true;
        const seated = Object.keys(args.state.offscreen).some((k) => samePersonName(k, m.name));
        if (!seated) return true;
        /* M644: THE TELLING OFTEN DOES NOT USE THE NAME. "The back door opened and his aunt came in", "Auntie", a name only in
         * someone's mouth while the telling says "she came in" — the walk-in of someone the world had seated elsewhere
         * was thrown away on each, and she stood "upstairs, asleep" on the ledger while she shook the rain off in the
         * kitchen. The reader hands over the page's own words that show her here ("shown"); words that ARE in the
         * page's telling stand in for her name. Talked about is still not here (M541): spoken words are not the telling. */
        return (shownOnPage(args.state, told, m.name) || toldOnPage(args.assistantText, m.shown).end !== -1) && !goneAtTheEnd(args.state, args.assistantText, m.name);
      });
    }
    /* M509-15: A MOMENT THE WHOLE ROOM SAW GOES INTO EVERY BOOK IN THE ROOM. The reader writes a public moment into one
     * witness's book — "watched Jovan bow… whisper to Rukia" for Shunsui alone — and every other book stands blind to it.
     * A fact that is public by its own words (engine/world.js publicMoment: seen, or said before all, with no mark of
     * privacy) is written for everyone in the room on this page — the page's own room when the reader named it, else
     * everyone present after this page's walk-ins and leaves — never the main character. A whisper stays with those the
     * reader gave it to. */
    if (args.state) {
      /* M660: where the page's own words show someone standing or dressed otherwise than the ledger has, it is written */
      /* M667: where a thing the page names now lies */
      if (Array.isArray(read.things) && read.things.length) read.mutations = [...read.mutations, ...movedThings(args.state, read.things, args.assistantText, args.userText).filter((t) => !read.mutations.some((m) => m && m.type === 'thing.set' && typeof m.name === 'string' && m.name.trim().toLowerCase() === t.name.toLowerCase()))];
      /* M662: what the page shows of how someone looks is locked among what is true of them */
      if (Array.isArray(read.looks) && read.looks.length) read.mutations = [...read.mutations, ...lockedLooks(args.state, read.looks, args.assistantText, args.userText)];
      /* M661: the header's own attire and position cells are the main character's, on this page — after the reader's own
       * word for him, and written only where the telling bears them out */
      const dress = headerDress(args.assistantText);
      const mcHere = dress ? (Array.isArray(args.state.present) ? args.state.present : []).find((p) => p && typeof p.name === 'string' && isMc(args.state, p.name)) : null;
      const notes = [...(Array.isArray(read.hereNotes) ? read.hereNotes : []), ...(mcHere ? [{ name: mcHere.name, at: dress.position, wears: dress.attire }] : [])];
      if (notes.length) {
        /* judged against the room as it will stand when this page's own header has been read: after a long jump of the
         * clock every place and outfit is let go (staleAfterJump), so what the page shows is written even where it is
         * what the ledger had the night before (found in the walk: Bruce's place at the bend was let go and not restated) */
        const day = args.state.clock && typeof args.state.clock.dayWords === 'string' ? args.state.clock.dayWords : '';
        const letGo = staleAfterJump(args.state, headerMutations(args.assistantText, { ground: (args.state.place || {}).name || '', day }));
        const room = letGo.length ? applyMutations(args.state, letGo).state : args.state;
        read.mutations = [...read.mutations, ...restatedPresence(room, notes, read.mutations, args.assistantText)];
      }
      read.mutations = settleWitnesses(args.state, read.mutations, read.here); /* M642: what the reader itself decided */
      read.mutations = broadcastPublicMoments(args.state, read.mutations, read.here);
      /* the mark has done its work: what goes to the ledger and its journal is the line as it has always been written */
      read.mutations = read.mutations.map((m) => { if (!m || m.decided === undefined) return m; const line = { ...m }; delete line.decided; delete line.room; return line; });
    }
  }
  return read;
}
/* the room a page ends with: the reader's own "here" when it named one, else everyone present after this page's walk-ins
 * and leaves — never the main character, never someone the same answer takes out */
function roomOfPage(state, list, here) {
  const leaving = new Set(list.filter((m) => m && m.type === 'presence.leave').map((m) => String(m.name || '').trim().toLowerCase()));
  const room = [];
  const add = (n) => { const t = String(n || '').trim(); if (!t || isMc(state, t) || leaving.has(t.toLowerCase())) return; if (!room.some((r) => r === t || samePersonName(r, t))) room.push(t); };
  if (Array.isArray(here) && here.length) for (const n of here) add(n);
  else {
    for (const p of (Array.isArray(state.present) ? state.present : [])) add(p && p.name);
    for (const m of list) if (m && m.type === 'presence.enter' && typeof m.name === 'string') add(m.name);
  }
  return room;
}
/* M520/M522: the one who DID a seen or heard moment — the name right after the seeing or hearing — by their whole name or
 * its first word ("the paladin" is "paladin"); never someone merely named in it */
const DOER = /^(?:saw|watched|witnessed|observed|looked on as|was there when|heard|overheard|listened to|listened as)\s+(?:as\s+)?(?:the\s+)?(.*)$/i;
function didIt(name, fact) {
  const m = DOER.exec(String(fact || '').trim());
  if (!m) return false;
  const rest = m[1];
  const words = String(name || '').replace(/^\s*the\s+/i, '').split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lead = (w) => new RegExp('^' + w + '(?:[’\']s)?($|[^\\p{L}\\p{N}])', 'iu');
  return lead(words.map(esc).join('\\s+')).test(rest) || (words[0].length >= 3 && lead(esc(words[0])).test(rest));
}
/* M642: WHO KNOWS WHAT IS THE PAGE READER'S OWN TO DECIDE — his question: "why, most of the time, 'no longer knows' — it
 * needs the auditor to make things right? Why not from their own worker?" Because the reader named ONE witness and CODE
 * guessed the rest from the fact's first word: every line beginning "saw" or "watched" went into every book in the room
 * (a hand only Rukia noticed, in six books), and a thing said in front of everyone went to nobody else unless the line
 * happened to say "aloud" or "before the whole court". Wrong both ways — and the auditor, who reads everything, then took
 * lines out ("no longer knows") and put others in, audit after audit (M509-15, M520, M522 each patched the guess).
 * The reader has the page in front of it. It now says, with every fact, WHO the page put it in front of ("who": names,
 * or "everyone here"), and the house writes exactly that: a line a witness, the main character never, and for "everyone
 * here" the room this page ends with — never the one who did it. A line the reader has decided is guessed over by
 * nothing (broadcastPublicMoments passes it by). */
export function settleWitnesses(state, mutations, here) {
  const list = Array.isArray(mutations) ? mutations : [];
  if (!list.some((m) => m && m.type === 'knowledge.add' && m.decided === true)) return list;
  /* "everyone here": in the scene when the page opened AND still in it at its end — someone who walked in during the page
   * may have come after it, and is the reader's to name (false knowledge is the worse slip: a person who knows what they
   * were not there for) */
  const stood = roomOfPage(state, list, here);
  const before = stood.filter((n) => isHere(state, n));
  const room = before.length ? before : stood;
  const out = [];
  const has = (name, fact) => out.some((m) => m.type === 'knowledge.add' && m.fact === fact && typeof m.name === 'string' && (m.name.toLowerCase() === name.toLowerCase() || samePersonName(m.name, name)));
  for (const m of list) {
    if (!m || m.type !== 'knowledge.add' || m.decided !== true) { out.push(m); continue; }
    if (m.room === true) {
      const { room: _wholeRoom, ...rest } = m;
      for (const n of room) if (!didIt(n, m.fact) && !has(n, m.fact)) out.push({ ...rest, name: n });
      continue;
    }
    if (typeof m.name !== 'string' || isMc(state, m.name) || has(m.name, m.fact)) continue; /* never him; one line a witness */
    out.push(m);
  }
  return out;
}
export function broadcastPublicMoments(state, mutations, here) {
  const list = Array.isArray(mutations) ? mutations : [];
  /* M642: a line whose witnesses the reader named is never guessed over — only a line written the old way, with one name */
  const settled = new Set(list.filter((m) => m && m.type === 'knowledge.add' && m.decided === true).map((m) => m.fact));
  const facts = list.filter((m) => m && m.type === 'knowledge.add' && typeof m.fact === 'string' && typeof m.name === 'string' && !settled.has(m.fact) && publicMoment(m.fact));
  if (!facts.length) return list;
  const room = roomOfPage(state, list, here);
  if (room.length < 2) return list;
  /* M520/M522: a moment someone did is not written into their own book from another's eyes (didIt, above) */
  const out = list.slice();
  for (const f of facts) {
    const holders = new Set(list.filter((m) => m && m.type === 'knowledge.add' && m.fact === f.fact).map((m) => String(m.name).trim().toLowerCase()));
    for (const n of room) {
      if (holders.has(n.toLowerCase()) || [...holders].some((h) => samePersonName(h, n))) continue;
      if (didIt(n, f.fact)) continue;
      out.push({ type: 'knowledge.add', name: n, fact: f.fact, ...(f.at ? { at: f.at } : {}) });
      holders.add(n.toLowerCase());
    }
  }
  return out;
}

async function extractTurnRead({ connection, state, userText, assistantText, before = [], founding, brief = '', castNotes = '', record = '', signal, renew, storyId = '', story = null, pageNumber = 0, moodOwed = true } = {}) {
  if (!connection || typeof connection !== 'object') return { mutations: [], failed: true };
  if (!assistantText || !String(assistantText).trim()) return { mutations: [], failed: true };
  const young = typeof founding === 'boolean' ? founding : isYoungLedger(state);
  /* M259: THE RECORD RIDES. chat.js has handed it over since M226; this line
   * dropped it on arrival, so the extractor never once saw it. */
  const budget = readerBudget(connection); /* M679 */
  const knowledgeRoom = knowledgeRoomFor(roomChars(connection, budget)); /* M664 */
  const bare = buildExtractorMessages({ state, userText, assistantText, before: [], founding: young, brief, castNotes, record, pageNumber, knowledgeRoom });
  const contextBudget = viewBudget(connection, budget, bare.system.length + bare.user.length);
  const prompt = buildExtractorMessages({ state, userText, assistantText, before, founding: young, brief, castNotes, record, pageNumber, contextBudget, knowledgeRoom });
  /* M31: an answer we can't use, or a founding that came back empty, earns
   * ONE second ask with a sharper word — here, not five blind retries in
   * the queue. The raw answer rides out so the drawer can show it. */
  let user = prompt.user;
  let last = null;
  /* M163: THE BEST READING IS KEPT. The sharper second ask (a missing
   * mode.snapshot, an empty founding, an unusable answer) replaced whatever
   * came first — so a page the extractor had read WELL, and was only asked
   * to add one mood line to, lost its whole reading when that second call
   * stumbled on the wire or came back as prose. The ledger got nothing for
   * that page. Whatever we already understood stands unless the re-ask
   * improves on it. */
  let best = null;
  const better = (a, b) => {
    if (!b) return a;
    if (!a) return b;
    const rank = (r) => (r.note === 'ok' ? 2 : r.note === 'empty' ? 1 : 0);
    if (rank(b) !== rank(a)) return rank(b) > rank(a) ? b : a;
    return b.mutations.length >= a.mutations.length ? b : a;
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let read;
    try {
      /* M259: every call gets its own minute (M213), and it may look */
      const { text, finishReason } = await askWithFetch(connection, {
        system: prompt.system,
        user,
        maxTokens: budget,
        signal,
        renew,
        leash: leashFor,
        room: roomChars(connection, budget),
        rounds: attempt === 0 ? EXTRACTOR_LOOKS : 1,
        isAnswer: (t) => { const r = parseExtractorAnswer(t); return r.note === 'ok' || r.note === 'empty'; },
        source: { storyId, story: story || { brief, castNotes } },
      });
      read = parseExtractorAnswer(text, { standingsFor: prompt.standingsFor }); /* M641 */
      read.raw = text;
      if (finishReason === 'length') read.note = read.mutations.length ? read.note : 'cut short';
    } catch (err) {
      /* M163: a wire that fails on the SECOND ask does not erase the first
       * reading; with nothing yet in hand it still throws, and the queue
       * retries the whole page as it always did. */
      if (best) return best;
      throw err;
    }
    last = read;
    best = better(best, read);
    /* M92: the mood board is owed on EVERY page (mode.snapshot — anything not
     * named is cleared). A page whose answer forgot it leaves yesterday's
     * flags standing — "combat" in a quiet bedroom wakes the wrong rules; the
     * writer saw exactly this on his auditor's report. One sharper ask. */
    /* M454: never for a page read out of turn — its mood is not the moment's (M453 drops it), and the second ask only
     * doubled the time every missed page took */
    if (read.note === 'ok' && attempt === 0 && moodOwed !== false && !read.mutations.some((m) => m && m.type === 'mode.snapshot')) {
      user = prompt.user + '\n\nYour answer named no mode.snapshot. The whole board is owed on every page: add ONE mode.snapshot listing every mood that holds at the END of this page (combat, intimate, travel, socialField, isolation, group — an empty list if none), and keep every other mutation you wrote. JSON only.';
      continue;
    }
    if (read.note === 'ok') return read;
    if (attempt === 0) {
      if (read.note === 'unusable' || read.note === 'cut short') {
        user = prompt.user + '\n\nYour last answer was not a JSON object with a "mutations" list. Answer with the JSON object only — no words before or after it.';
      } else if (read.note === 'empty' && young) {
        user = prompt.user + '\n\nThe ledger is empty and the page has a scene, so an empty list is wrong here. Write the founding: place.set for the ground, presence.enter for every person in the scene (the main character included), mc.set if the main character is not yet known. JSON only.';
      } else {
        return read;
      }
    }
  }
  /* M163: the best of the two, never merely the last. */
  return best || last;
}
