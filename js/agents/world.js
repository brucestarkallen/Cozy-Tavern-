/* Cozy Tavern — agents/world.js
 * M29: the world agent — the sandbox.
 *
 * Every worker before this one RECORDED: the extractor wrote down what the
 * page said, the scribe kept the people true, the keeper folded old pages.
 * None of them moved the world. Aurora left the station three turns ago and
 * stayed on the platform forever, because nothing ever asked where she is
 * NOW. In the old 45k-token preset the storyteller did that work in its
 * own head each turn (Living World, ACW, TWB, The World Advances, The Clock
 * Governs Availability) — against a transcript full of its own stale
 * watchlists. That is the drift the writer felt after 90k tokens.
 *
 * The world agent takes that work off the page. After each finished page
 * it reads the ledger and the page, then advances the world by the clock:
 * where the absent are right now and what they want; who is moving toward
 * the main character and when they arrive; what has ripened out of sight
 * and whom it reached; what each present person witnessed; whether a
 * faction moved; who must now exist. It writes all of that into the ledger
 * through the closed vocabulary (validated, logged, undoable like any
 * other change), and it leaves a short BRIEF for the storyteller — what
 * could reach this scene next turn and when, what ripened, and at most one
 * window into the world beyond. The storyteller gets a specific world and
 * keeps only the beat and the last look for itself. M85: the brief also
 * carries the VOICES — the writer's Voices Block, the world talking to
 * itself in 2-4 lines the main character cannot hear — for the reader,
 * shown under the page by chat.js in the 🎨 pack's dress; the storyteller
 * never sees them.
 *
 *   worldTurn({connection, storyId, userText, assistantText, brief,
 *              castNotes, signal, stale})
 *     -> {applied, rejected, brief} | null when there was nothing to read
 *
 * Laws:
 *   - Runs AFTER the extractor (the page's own truth lands first), off the
 *     send path, through the workers' queue. Never on the critical path.
 *   - May write only the world beyond: offscreen.*, thread.*, knowledge.add,
 *     faction.set, people.set. It never touches the clock, the ground, who
 *     is present, bodies or standings — those are the page's to move.
 *   - Throws on transport failure (the queue retries); a garbled answer is
 *     an empty read, said out loud on the workers line.
 *   - Effort is the worker's setting (worldEffort, default 'off'): a cheap
 *     non-reasoning model does this well when the law is this explicit.
 */

import { writerText, BRIEF_ROOM, CAST_ROOM } from '../engine/whole.js'; /* M283 */
import { db } from '../store.js';
import { callWorker } from './call.js';
import { balancedCandidates, parseLenient } from './jsonutil.js';
import { withFictionFrame } from './voice.js';
import { loadState, saveState, notify, renderStateFacts } from '../engine/state.js';
import { findPersonKey, importanceOf, IMPORTANT_AT, placeWords, isMc, namedInText, seatForPerson } from '../engine/people.js'; /* M304: who matters, as the storyteller's own people block weighs it */
import { isHere, samePersonName, nameOnPage } from '../engine/names.js'; /* M396/M401: one answer to "the same person?"; M414: one answer to "named on the page?" */
import { storyTurn } from '../engine/apply.js';
import { applyMutations } from '../engine/apply.js';
import { renderOffscreen } from '../engine/offscreen.js';
import { renderClock } from '../engine/clock.js';
import { mcName } from '../engine/duels.js';
import { STANCES } from '../engine/world.js';
import { askWithFetch, fetchLaw, windowOfPages, roomChars, viewBudget, leashFor } from './lookup.js'; /* M259/M261: it may look; the story so far, whole */
import { renderAllThreads, renderAllKnowledge, renderAllFactions, wholePage } from '../engine/whole.js'; /* M259: every thread, every line of who knows what, every faction; the page read to its end */

const MAX_TOKENS = 6000; /* M37: room for a long founding even if a house thinks a little anyway */
export const WORLD_SHOWN_MAX = 6;

/* The only doors the world agent may open. Anything else it proposes is
 * dropped before the applier sees it (and counted, so the workers line can
 * say "and 2 it may not touch"). */
export const WORLD_TYPES = new Set([
  'offscreen.set', 'offscreen.clear', 'thread.set', 'thread.close', 'knowledge.add', 'faction.set', 'people.set',
]);

const VOCABULARY = [
  'offscreen.set {"type":"offscreen.set","name":"NAME","location":"the 6:10 train, two stops out","activity":"reading his letter again","agenda":"confront him about it tonight","stance":"toward","etaMinutes":25} — where an ABSENT named person is RIGHT NOW at the hour on the clock, what they are doing, what they want next; stance is one of ' + STANCES.join(', ') + ' (toward = moving toward the main character, seeking = searching for them, tense = unresolved tension with them, busy = taken up with someone else, waiting = holding, want still nameable); etaMinutes = minutes until they reach the main character, ONLY when stance is toward or seeking',
  'offscreen.clear {"type":"offscreen.clear","name":"NAME"} — when an elsewhere note no longer holds (she has arrived and the page shows it, or the thread is closed)',
  'thread.set {"type":"thread.set","title":"NAME and the letter","owner":"NAME","heat":"hot","next":"corner him before OTHER NAME leaves"} — a live agenda someone holds, toward the main character OR toward anyone else in the story ("with":"OTHER NAME" names the other party: two rivals, two sisters, a team and its captain); heat hot|cold; next = what the owner will DO',
  'thread.close {"type":"thread.close","title":"NAME and the letter"} — when it is resolved for good',
  'knowledge.add {"type":"knowledge.add","name":"OTHER NAME","fact":"saw MAIN CHARACTER leave the letter unread"} — one thing one person witnessed or was told, from THIS page; never what they might guess',
  'faction.set {"type":"faction.set","name":"the studio","stance":"quietly furious","agenda":"bury the story before Monday","move":"sent a lawyer to the hotel"} — a faction moves only on cause; move = what it just did',
  'people.set {"type":"people.set","name":"QUIET NAME","field":"state","text":"at the rail, hat low, weighing whether to step in"} — ONLY for someone listed IN THE SCENE, NOT ON THE PAGE: their now, this minute',
  'people.set {"type":"people.set","name":"NEW NAME","field":"core","text":"the main character\'s manager; forty, sleepless, keeps three phones; loyal to the money first"} — ONLY for a NEW named person the world needs (a role that must be filled), their one-line core; then seat them with offscreen.set',
].join('\n');

/* M134: what the hour means, said plainly from the clock — a cheap model
 * read "the clock governs availability" and kept everyone awake at 23:00 */
export function hourLaw(clock) {
  if (!clock || !Number.isFinite(clock.minutes)) return '';
  const h = Math.floor((clock.minutes % 1440) / 60);
  if (h >= 23 || h < 6) return 'THE SMALL HOURS (' + String(h).padStart(2, '0') + ':00). Everyone without a NAMED reason on the ledger is asleep, at home, in their own bed — seat them there and say so ("asleep"), and give them no activity, no agenda, no text, no walk until morning. Only a person the ledger shows awake for a reason (a night shift, a fight, a drive, insomnia the pages gave them) is up, and the seat names that reason. Nobody arrives, calls or schemes at this hour without one.';
  if (h >= 6 && h < 8) return 'EARLY MORNING (' + String(h).padStart(2, '0') + ':00). People are waking, washing, eating, leaving for school or work; a seat at this hour is a morning routine unless the ledger names otherwise.';
  if (h >= 22) return 'LATE EVENING (' + String(h).padStart(2, '0') + ':00). People are winding down, at home, in bed or near it; students and workers are not out unless the ledger says why.';
  return '';
}

function law({ mc, clockWords, hourWords = '', jumpWords = '' }) {
  const who = mc
    ? `The main character is ${mc}.`
    : 'The main character\'s name is not yet known; the writer plays the one whose actions they type.';
  return [
    'You keep the world beyond the page for a slow story told between two writers. The storyteller',
    'writes only what stands in front of the main character. You keep everything else alive: where the',
    'absent are, what they want, what is ripening out of sight, who is moving toward the scene and when',
    'they will arrive, who knows what. You never write a word of the story. You write the ledger, and',
    'a short brief for the storyteller.',
    '',
    who,
    clockWords ? `The hour on the clock is ${clockWords}.` : 'The clock is not set; reckon time in turns and plain words.',
    ...(hourWords ? [hourWords] : []),
    ...(jumpWords ? [jumpWords] : []),
    '',
    'Read the ledger, then the page just finished, then ADVANCE THE WORLD BY THE CLOCK:',
    '',
    'THE PEOPLE’S PHYSICS (M54 — the writer’s own laws, for every move you make off the page):',
    'STRATEGIC PERSISTENCE: a goal survives a setback as a change of tactic, never as deletion — a',
    'coronation changes the rival’s strategy, not his existence. Goal Death Test before letting any want',
    'go: motivation gone + resources gone + allies gone = dead; any remains = alive, tactic changes.',
    'Persistence is intent, not repetition: the same threat re-voiced in the same words is the loop.',
    'SELF-PRESERVATION > LOYALTY > THE MAIN CHARACTER under existential stakes, unless a core says',
    'otherwise (a devoted bodyguard, a fanatic, a parent for a child). Loyalty is real, not absolute.',
    'STAKES WEB: an agenda weighs everyone a person shares history with, never the main character alone —',
    'a brother watches his sister passed over; a lieutenant bristles at strangers; NPC-to-NPC feuds,',
    'envies and schemes run off the page whether the main character is target, witness or absent.',
    'SETTING BASELINE: alarming and remarkable are defined by THE WORLD’s normal, never Earth’s. Everyone',
    'armed, a sword is shoes; a magic academy, a spell is homework. Before anyone off the page reacts to',
    'a thing as news, ask: would a local blink? Default stance to strangers is transactional',
    'indifference — polite, busy, self-interested; warmth, trust and costly favors are earned.',
    'COST IS WORLD LOGIC, NOT PUNISHMENT: the world’s answer to a public act follows who would care,',
    'what they would do, and when it lands — sometimes applause, sometimes a manhunt — never a rule',
    'that the main character must pay, and never that he must not.',
    '',
    'THE QUIET ONES IN THE ROOM (listed below, when there are any). Everyone in the scene the page did not',
    'show is still THERE, living this very minute in their own nature: reacting to what the scene just did,',
    'weighing what to do about it, busy with their own business in the room. For EACH of them write their now',
    'with people.set field "state": one line of what they are doing and weighing — "at the rail, hat tipped low,',
    'one hand drifting toward his sword, weighing whether to stop it before Zaraki dies" — true to their core and',
    'to where the scene stands. Never an instruction to anyone, never a line of dialogue, never moved out of the',
    'scene; the page decides whether they act. Someone the page DID show is the scribe\'s to write, not yours.',
    '',
    'THE ABSENT. Every named person not in the scene has a life — including one the page only names in',
    'passing ("my sister NAME would laugh if she saw us"): from that line on, that sister exists; give her a',
    'one-line core with people.set and seat her somewhere with a want. A person referred to only by',
    'RELATION to someone known — "your mother" said to a known person, "his manager", "her ex" — exists from',
    'that line on exactly the same way: name them and seat them. THE REAL RECORD: when the anchor is a',
    'real person or a character from an established canon (a public figure, a franchise), the relation',
    'is filled from the real record, not invented — a public figure\'s mother is her real mother, by her real name; her siblings',
    'are her real siblings — and a real person\'s core is drawn from their public record',
    '(role, family, known history and traits). Never rename a real person, never give them a made-up',
    'relative where the record has one; invent only where the record is silent. For each absent person the ledger',
    'or the pages know: where are they RIGHT NOW at this hour, what are they doing, what do they WANT next. An agenda',
    'is a want, never a status — "resting" is not an agenda; when you cannot name the want, leave the AGENDA',
    'out, never the person: a seat with a place and a doing is whole. The clock governs availability: at small hours most people sleep, and whoever is up is up',
    'for a reason. Someone moving toward the main character gets stance "toward" and an ETA; before the',
    'ETA they are on the road, never early. A change from what the ledger says needs a cause — a silent',
    'flip is an error, not variety. Someone the page shows arriving is the extractor\'s to seat; you clear',
    'their elsewhere note. Anyone the page shows IN the scene is in it, whatever the list below says — never',
    'seat them elsewhere. Nobody is seated where the scene itself is: someone at that place is in the scene,',
    'or on the way to it ("toward", with an ETA). Only someone on their way has an arrival.',
    '',
    'WHO IS SEATED (M304). EVERYONE WHO MATTERS TO THE STORY HAS A WHEREABOUTS AT EVERY HOUR — family,',
    'friends, rivals, lovers, the writer’s own people, anyone with a standing, a thread, a locked truth or a',
    'history with the main character. The people list below marks whoever matters and has none',
    '("[NO SEAT — seat them]"): seat every one of them in this answer. A line reading "last seen at …" is',
    'the HOUSE’S OWN NOTE of where someone stepped off the page — a sighting, not a life: the first time',
    'you see one, move that person on from it by the clock (the shift ended, she went home, he is asleep)',
    'with a real offscreen.set. There is no limit on how many people you may seat in one answer.',
    'EVERYONE LIVES THEIR OWN LIFE (M366). The people in this ledger are not arranged around the main',
    'character: each has their own day, their own work or school, their own friends, family and plans, and',
    'their own people who call and text THEM (the team texts its captain, a sister calls her brother, friends',
    'make plans without anyone on the page). A line marked "[last placed … ago — where are they now?]" was',
    'written hours or days of story ago: look at that person again and write where their own life has them',
    'NOW with a real offscreen.set — which may be the same place if their life truly keeps them there (asleep',
    'at home at night, at work through a shift), but never simply where the story last left them. After a time',
    'skip, look at everyone this way. A life of their own is never a reason to drop HIM: anyone with a reason',
    'concerning the main character — a thread, a grudge, a want, a debt, a bond — keeps pursuing it through',
    'that life, when that life gives them the chance.',
    'A passer-through — a driver, a waiter, a clerk with one errand and no bond — is not seated at all;',
    'the house clears any seat nothing carries and lets its person pass out of the story.',
    '',
    'THREADS (M367, M368). Threads run between ANY people, not only toward the main character — a rivalry on the team, a sister and her mother, a debt between two neighbours — and every agenda keeps moving: no count, no cap.',
    'A thread is HOT while its owner is in position to press it now; it goes quiet while their own life keeps them away (work, distance, a plan still ripening) and wakes when it lets them — never frozen because too many others are pressing. Name what each hot thread\'s owner will do NEXT.',
    '',
    'RIPENING. Rumors travel at the speed of people. A deadline closes when the clock says. A plan lands',
    'when its owner is in position. Write down what has ripened THIS turn and whom it has reached —',
    'never what would be dramatic.',
    '',
    'WHO KNOWS WHAT. From the page: what did each present person witness or hear this turn? Add it.',
    'Nobody knows what happened where they were not; a cut-away is a window for the reader, never a',
    'pathway for anyone inside it.',
    '',
    'FACTIONS. A faction moves only on cause — and its cause is often its own: its rivals, its money, its people, its politics, not only the main character. When it moved, write its stance and its move.',
    '',
    'NEW PEOPLE. When an absent person talks to someone off the page — a friend, a colleague, a sibling',
    'in a window or a voice — that someone exists from then on: named, given a one-line core, seated.',
    'Roles must be filled — a manager, a bodyguard, a landlord, a mother, a rival. And a',
    'place implies its people: a childhood home implies the neighbor who never moved, the friend from',
    'school still on the street, the sister\'s sister-in-law; a bar implies its regulars; a set implies its',
    'crew. When the world needs someone who must exist, or a place\'s own people have a motive that could',
    'cross the main character\'s presence (she saw the car pull in from her window), name them (a unique',
    'name fitted to the setting), give them a one-line core with people.set, and seat them elsewhere',
    'with a want. At most one new named person per page unless the page itself demands more. Invention',
    'is the job; contradicting what the writer\'s brief states is the only ban.',
    '',
    'THE BRIEF. Then the storyteller\'s word for the next turn, three parts, each short plain sentences:',
    '  pressure — what could reach this scene next turn and when: an arrival on the clock, a runner, an',
    '    interruption, a stranger whose ordinary motive crosses the main character\'s presence (a vendor, a',
    '    fan, a pickpocket) — and, where the world has phones, letters or messengers, a CALL, a TEXT or a',
    '    NOTE from an absent person with a live want and a reason to reach out NOW (name who, by what',
    '    channel, and what they want; the storyteller renders the screen or the voice). A person need not',
    '    walk to the scene to reach it. As real life does it: the people in his life reach out when their own',
    '    lives give them a reason — a mother checking in, a sister wanting something, a friend with plans —',
    '    and on a busy evening that can be several of them at once, or none. No quota and no schedule, never',
    '    invented to fill a scene: each one comes from that person\'s own day and what they want. Empty is a',
    '    valid and common answer.',
    '  ripe — what ripened and whom it reached, one line each. Empty when nothing did.',
    '  twb — at most ONE window into the world beyond, only when something CHANGED since that thread was',
    '    last shown (the list of windows already opened is below) and it does something (a decision, a',
    '    discovery, a confrontation, a plan). Two absent people who share a place and a stake talk to',
    '    each other — that is a window worth opening, and what each learns goes into knowledge.add.',
    '    {"who","where","changed"}. null is the common answer.',
    '  voices — THE WORLD TALKING TO ITSELF (the writer\'s Voices Block, shown to the reader under the page):',
    '    2-4 lines, people the main character cannot currently hear — other rooms, streets, channels,',
    '    comms nets. The prior is NEAR-ALWAYS: fire whenever a live social field is in reach (a market, a',
    '    court, barracks, a sect, a street, a group chat); skip ONLY for true isolation, for the small',
    '    hours in a quiet place, or when a line would fabricate listeners or knowledge. "Nothing important',
    '    to say" is not a reason: mundane chatter IS immersion — prices argued, a wedding rumored, a',
    '    sergeant cursing the drill. Voices follow world logic, not the main character\'s: the default is',
    '    the world talking about itself; one voice may reference the main character only if he did',
    '    something public AND witnessed; nothing public -> zero voices about him. Every voice runs the',
    '    trace — the speaker witnessed it, was told it by a named person, or deduced it in one step from',
    '    what they personally saw; walls block words (a thin wall passes a murmur, never a sentence); a',
    '    private moment needs physical presence; nobody voices another person\'s interior or a longitudinal',
    '    read of him ("he\'s gotten strange"). Then the WORTH REPEATING test: an item carries only if',
    '    repeating it pays the speaker — it entertains, threatens, profits, or costs them to sit on;',
    '    servants hear everything and repeat almost none of it. Register: every voice is a person standing',
    '    somewhere with something to lose by being heard — the closer to something dangerous, shameful, or',
    '    not theirs to know, the smaller the voice (hushed, clipped, half-finished); distance and safety',
    '    buy volume and jokes; no memespeak unless THIS speaker and THIS moment support it; speakers',
    '    differ inside one block. Conversations, not broadcasts: a reply is a line whose speaker is',
    '    "-> Name" (co-present only where a reply threads them; otherwise two lines are two places, and',
    '    neither speaker knows what the other said). Digital channels render as posts, others as quoted',
    '    speech; content is the actual words, no decorative frames. Rotate speakers, channels and topics',
    '    against the voices already spoken (below) — the same vendor every turn is a template. Bystanders',
    '    Act: a voice that overhears something valuable does not merely comment — whoever holds it acts',
    '    per their core, and that action is a thread.set or an offscreen.set in this same answer. Icons:',
    '    📸 social | 💬 DM | 👥 group chat | 📋 notice | 👤 whisper | 🍺 tavern | 🏪 street/market |',
    '    🔥 campfire/barracks | 📜 dispatch | ⚠️ official. Each: {"icon","speaker","channel","content"}',
    '    where channel is the place or medium plus timing only ("the east market · midday"), no speech',
    '    descriptors; a reply carries no channel. An empty list only when the world is genuinely silent.',
    '',
    'SYMMETRY. The world bends for no one — no gifts on a timer, no ambushes on a timer. Outcome follows',
    'cause. Be conservative about the page (only what it shows), generous about the world (invent what',
    'must exist). Never move the clock, the ground, who is present, bodies or standings — those are the',
    'page\'s to move, and any such mutation you write is dropped.',
    '',
    'Answer with JSON ONLY, exactly this shape:',
    '{"mutations":[ ... ], "brief":{"pressure":[ ... ],"ripe":[ ... ],"twb":null,"voices":[ ... ]}}',
    '',
    'The only mutations that exist:',
    VOCABULARY,
    '',
    'Names keep the spelling the ledger uses. No commentary, no fences: the JSON object only.',
    'PLACEHOLDERS: NAME, OTHER NAME, NEW NAME, NAME SURNAME and MAIN CHARACTER in the examples above are placeholders, never people — never write them; write only the names the ledger, the brief and the pages use.',
  ].join('\n');
}

const FENCE = '"""';

function shownWindows(state) {
  const list = Array.isArray(state && state.worldShown) ? state.worldShown : [];
  return list.slice(-WORLD_SHOWN_MAX).map((w) => {
    const bits = [w.who, w.where].filter(Boolean).join(', ');
    return '  - ' + (bits ? bits + ': ' : '') + (w.changed || '') + (Number.isFinite(w.atTurn) ? ' (turn ' + w.atTurn + ')' : '');
  }).join('\n');
}

/* M304: THE WORLD AGENT WAS SHOWN THE FIRST TWENTY PEOPLE EVER WRITTEN. The one
 * worker that decides where the absent are read "the people, as the ledger
 * knows them" from a loop that stopped at twenty, in the order the pages were
 * first made — so in a long tale it knew the people of the opening chapters,
 * passers-through and the retired among them, and nobody who came after:
 * it could not seat a person it was never shown. (NO SILENT CUT, M265, was
 * never applied here.) Now: everyone the story still carries, the most
 * important first (the same weighing the storyteller's people block uses),
 * whole while the room holds them and lean after, the cut SAID; and whoever
 * matters and has no whereabouts is marked, so the agent seats them. */
export const WORLD_PEOPLE_ROOM = 60000;

/* M365: A SEAT GOES STALE. The writer: "Caleb keeps parking at Jovan's neighbor like a weirdo who has no life", and "after
 * a time skip the ledger seems confused, some people still stale". The roster marked only people with NO seat, so anyone
 * seated once — however long ago, however many hours the story then skipped — was never looked at again: seated at the
 * neighbour's on Monday afternoon, still there on Thursday. A seat now has an AGE (story-minutes since it was written,
 * or pages when the story keeps no clock), and a seat past it is marked for moving on exactly like no seat at all. A
 * time skip ages every seat at once, so the whole world is walked forward in the next pass. */
export const STALE_SEAT_MINUTES = 180;  /* three story-hours: a day moves people on */
export const STALE_SEAT_PAGES = 12;     /* when the story keeps no clock */
export function seatAge(state, name) {
  const found = seatForPerson(state, name);
  const seat = found && found.entry ? found.entry : (found && typeof found === 'object' && !found.key ? found : null);
  if (!seat) return null;
  const clock = state && state.clock && Number.isFinite(state.clock.minutes) ? state.clock.minutes : null;
  const minutes = clock !== null && Number.isFinite(seat.sinceMinutes) ? Math.max(0, clock - seat.sinceMinutes) : null;
  const turn = storyTurn(state || {});
  const pages = Number.isFinite(seat.atTurn) ? Math.max(0, turn - seat.atTurn) : null;
  return { minutes, pages };
}
export function seatIsStale(state, name) {
  const age = seatAge(state, name);
  if (!age) return false;
  if (age.minutes !== null) return age.minutes >= STALE_SEAT_MINUTES;
  return age.pages !== null && age.pages >= STALE_SEAT_PAGES;
}
const agoWords = (age) => {
  if (!age) return '';
  if (age.minutes !== null) { const h = Math.round(age.minutes / 60); return h >= 48 ? Math.round(h / 24) + ' days ago' : h >= 1 ? h + (h === 1 ? ' hour ago' : ' hours ago') : 'just now'; }
  return age.pages !== null ? age.pages + ' pages ago' : '';
};
export function peopleForWorld(state, { material = '', castNames = [], room = WORLD_PEOPLE_ROOM } = {}) {
  const chars = state && state.characters && typeof state.characters === 'object' ? state.characters : {};
  const turn = storyTurn(state || {});
  const scene = { placeWords: placeWords(state), lately: [] };
  const lower = (x) => String(x || '').trim().toLowerCase();
  const present = new Set((Array.isArray(state && state.present) ? state.present : []).map((p) => lower(p && p.name)));
  const seated = new Set(Object.keys((state && state.offscreen) || {}).map(lower));
  const own = (name) => namedInText(material, name) || (Array.isArray(castNames) ? castNames : []).some((c) => lower(c) === lower(name) || lower(c).split(/\s+/)[0] === lower(name).split(/\s+/)[0]);
  const rows = [];
  for (const [name, c] of Object.entries(chars)) {
    if (!c || typeof c !== 'object' || c.retired || isMc(state, name)) continue;
    const core = typeof c.core === 'string' ? c.core.trim() : '';
    const now = typeof c.state === 'string' ? c.state.trim() : '';
    const arc = typeof c.arc === 'string' ? c.arc.trim() : '';
    if (!core && !now && !arc) continue;
    const weight = importanceOf(state, name, material, turn, scene) + (own(name) ? 30 : 0);
    const here = present.has(lower(name)) || isHere(state, name); /* M396: under any form of their name */
    const hasSeat = seated.has(lower(name)) || Boolean(seatForPerson(state, name)); /* M320: "Rias" seated IS "Rias Gremory" seated */
    const noSeat = !here && !hasSeat && (weight >= IMPORTANT_AT || own(name));
    /* M365: a seat past its age is due for moving on, exactly like no seat */
    const stale = !here && hasSeat && (weight >= IMPORTANT_AT || own(name)) && seatIsStale(state, name);
    rows.push({ name, core, now, weight, here, noSeat, stale, ago: stale ? agoWords(seatAge(state, name)) : '' });
  }
  rows.sort((a, b) => (b.weight - a.weight) || a.name.localeCompare(b.name));
  const mark = (r) => (r.here ? ' [in the scene]' : r.noSeat ? ' [NO SEAT — seat them]' : r.stale ? ' [last placed ' + (r.ago || 'long ago') + ' — where are they now?]' : '');
  const whole = (r) => r.name + mark(r) + ' — ' + [r.core, r.now && !seated.has(lower(r.name)) && !seatForPerson(state, r.name) ? 'last noted: ' + r.now : ''].filter(Boolean).join(' | ');
  const lean = (r) => { const first = (r.core || r.now).split(/(?<=[.!?])\s+/)[0] || ''; return r.name + mark(r) + ' — ' + (first.length > 240 ? first.slice(0, first.lastIndexOf(' ', 240)) + '…' : first); };
  const lines = [];
  let used = 0;
  let cutAt = -1;
  for (let i = 0; i < rows.length; i += 1) {
    let line = whole(rows[i]);
    if (used + line.length + 1 > room * 0.7) line = lean(rows[i]);
    if (used + line.length + 1 > room) { cutAt = i; break; }
    lines.push(line);
    used += line.length + 1;
  }
  const shown = lines.length; /* people, not lines — the note below is not a person */
  if (cutAt !== -1) {
    const rest = rows.slice(cutAt);
    lines.push('(' + rest.length + ' more the ledger knows did not fit, the least important: ' + rest.map((r) => r.name + (r.noSeat ? ' [NO SEAT]' : '')).join(', ') + ' — fetch any with "person: NAME".)');
  }
  return { text: lines.join('\n'), unseated: rows.filter((r) => r.noSeat).map((r) => r.name), shown, total: rows.length };
}

/* Exported for the harness: the two messages the worker receives. */
/* M85: the voices already spoken, for rotation — the last few blocks the
 * pages carried (chat.js gathers them from the pages' own voices). */
function spokenVoices(voicesBefore) {
  const blocks = Array.isArray(voicesBefore) ? voicesBefore.filter((b) => Array.isArray(b) && b.length).slice(-3) : [];
  if (!blocks.length) return '';
  return blocks.map((b, i) => '  turn -' + (blocks.length - i) + ': ' + b.map((v) => (v.speaker || '?') + ' (' + (v.channel || 'reply') + '): ' + (v.content || '')).join(' · ')).join('\n');
}

export const WORLD_LOOKS = 2;
/* M401: THE QUIET ONES IN THE ROOM. The world agent kept the absent alive by the clock; nobody kept the people who
 * stand in the scene while the page looks at someone else. His duel: Zaraki nearly killed, Kyōraku at the rail — and
 * silent, because nothing in the ledger said what Kyōraku was doing or weighing. Whoever is here (Who's here), is not
 * the main character, and is not named on the latest page or in his message, is the world agent's to keep alive: one
 * line of what they are doing and weighing NOW, written on their own page as their "now" — where the storyteller
 * already reads everyone in the scene. Never an order to the storyteller, never a line of dialogue for them. */
export function quietInScene(state, pageText = '', userText = '') {
  const text = String(pageText || '') + '\n' + String(userText || '');
  const chars = (state && state.characters) || {};
  return (Array.isArray(state && state.present) ? state.present : [])
    .map((p) => (typeof p === 'string' ? p : p && p.name)).filter((n) => typeof n === 'string' && n.trim())
    .filter((n) => !isMc(state, n))
    .filter((n) => {
      const key = findPersonKey(chars, n) || n;
      /* M409: someone here with NO now at all is the world agent's too, mentioned or not — a now is never left for "the
       * next page" (the scribe writes sparsely; the world agent runs every page) */
      const noNow = !(chars[key] && typeof chars[key].state === 'string' && chars[key].state.trim());
      /* a first name, a surname, any word of the name the page used ("Zaraki" is Kenpachi Zaraki) — never a title or
       * "the" (M414: engine/names.js nameOnPage, the one answer every reader asks) */
      return noNow || (!nameOnPage(text, n) && !nameOnPage(text, key));
    });
}

export function buildWorldMessages({ state, userText, assistantText, before = [], brief = '', castNotes = '', castNames = [], voicesBefore = [], jumpedMinutes = 0, record = '', pageNumber = 0, contextBudget = Infinity, peopleRoom = WORLD_PEOPLE_ROOM, canonRecord = '' }) {
  const clockMinutes = state && state.clock && Number.isFinite(state.clock.minutes) ? state.clock.minutes : null;
  const clockWords = state && state.clock ? (renderClock(state.clock) || '') : '';
  const known = mcName(state);
  const mc = known && known !== 'the player' ? known : '';
  const present = Array.isArray(state.present) ? state.present : [];
  const facts = renderStateFacts(state) || 'Nothing is written in the ledger yet.';
  /* M249: IT WAS TOLD TO USE A RECORD IT WAS NEVER GIVEN. Its own brief says a
   * person's life is "filled from the real record, not invented" — and the
   * word record appeared nowhere else in this file. So the one worker that
   * decides what the ABSENT are doing between scenes, and what they want
   * next, knew only the ledger's bare facts and the last few pages. After a
   * time skip it wrote whatever fit those — which is how the writer's own
   * SISTER came back with an agenda of getting his phone number. The folded
   * story rides now, as it does to the extractor (M226). */
  const recordSoFar = String(record || '').trim();
  const FENCE3 = '\u0022\u0022\u0022';
  const elsewhereAll = renderOffscreen(state.offscreen, present, clockMinutes, 40, state.characters || {}); /* M396 */
  const threads = renderAllThreads(state.threads);
  const knowledge = renderAllKnowledge(state.knowledge, present);
  const factions = renderAllFactions(state.factions);
  const people = peopleForWorld(state, { material: String(brief || '') + '\n' + String(castNotes || ''), castNames, room: peopleRoom }); /* M304 */
  const cores = people.text;
  const user = [
    /* M249: the story, before the ledger's bare facts — so a life beyond the
     * scene is filled from what has actually happened, as the brief demands */
    ...(recordSoFar ? ['THE STORY SO FAR, FOLDED — what the pages before these ones hold. A person\u2019s life',
      'beyond the scene is filled from THIS, never invented over it:',
      FENCE3, recordSoFar, FENCE3, ''] : []), /* M265: it was cut again to its first 12,000 — the newest lines lost */
    'THE LEDGER (the state of the scene):',
    facts,
    '',
    'EVERYONE WRITTEN ELSEWHERE (the absent, as last known — advance each by the clock or leave them):',
    elsewhereAll || 'No one is written elsewhere yet.',
    '',
    ...(() => {
      const quiet = quietInScene(state, assistantText, userText);
      if (!quiet.length) return [];
      const chars = (state && state.characters) || {};
      return ['IN THE SCENE, NOT ON THE PAGE — the quiet ones in the room (write each one\'s now: people.set field "state"):',
        ...quiet.map((n) => { const k = findPersonKey(chars, n) || n; const c = chars[k] || {}; return '- ' + k + (c.core ? ' — ' + String(c.core).slice(0, 200) : '') + (c.state ? ' | last now: ' + String(c.state).slice(0, 200) : ''); }), ''];
    })(),
    'THREADS:',
    threads || 'None open yet.',
    '',
    'WHO KNOWS WHAT (every line written, for everyone — a fact already here in other words is already known):',
    knowledge || 'Nothing written yet.',
    '',
    'FACTIONS:',
    factions || 'None written yet.',
    '',
    'WINDOWS BEYOND THE PAGE ALREADY OPENED (never the same beat twice — a thread with nothing new is not eligible):',
    shownWindows(state) || 'None yet.',
    '',
    'VOICES ALREADY SPOKEN (rotate speakers, channels and topics; the same vendor every turn is a template):',
    spokenVoices(voicesBefore) || 'None yet.',
    '',
    ...(cores ? ['THE PEOPLE THE STORY CARRIES, THE MOST IMPORTANT FIRST (M304 — everyone; "[NO SEAT — seat them]" marks someone who matters and has no whereabouts at all):', cores, '',
      ...(people.unseated.length ? ['WITH NO WHEREABOUTS RIGHT NOW — seat EVERY ONE of these in this answer (offscreen.set: where they are at this hour and what they are doing, from their page, the story so far and the clock; the want only if you can name it): ' + people.unseated.join(', '), ''] : [])] : []),
    ...(brief && String(brief).trim() ? ['WHAT THIS STORY IS ABOUT, in the writer\'s words:', FENCE, writerText(brief, BRIEF_ROOM, 'brief', true), FENCE, ''] : []), /* M283 */
    ...(castNotes && String(castNotes).trim() ? ['WHO IS IN IT, in the writer\'s words:', FENCE, writerText(castNotes, CAST_ROOM, 'cast notes', true), FENCE, ''] : []), /* M283 */
    ...(String(canonRecord || '').trim() ? ['WHAT THE SERIES ITSELF SAYS OF ITS PEOPLE HERE (their real record — a canon character\'s family, role and life are these, never invented):', FENCE, String(canonRecord).trim(), FENCE, ''] : []), /* M386 */
    ...(before.length ? (() => {
      /* M261: the story so far, whole, newest first, into the room */
      const w = windowOfPages(before, contextBudget);
      return ['THE PAGES JUST BEFORE (already read — the world they show is already written):', FENCE, w.shown.join('\n\n') || '(none fit — fetch them by number)', FENCE,
        ...(w.index.length ? ['Earlier pages not shown above (fetch any by its number):', ...w.index] : []), ''];
    })() : []),
    ...(Number.isInteger(pageNumber) && pageNumber > 0 ? ['(The storyteller\'s page below is page ' + pageNumber + ' of the story; every earlier page can be fetched by its number.)'] : []),
    'THE WRITER JUST WROTE:',
    FENCE,
    wholePage(userText, 12000),
    FENCE,
    '',
    'AND THE STORYTELLER ANSWERED:',
    FENCE,
    wholePage(assistantText),
    FENCE,
    '',
    'Advance the world by the clock and write the brief. JSON only.',
  ].join('\n');
  const hourWords = hourLaw(state && state.clock);
  const jumpWords = Number.isFinite(jumpedMinutes) && jumpedMinutes >= 180
    ? 'THE CLOCK JUMPED ' + (jumpedMinutes >= 1440 ? Math.round(jumpedMinutes / 1440) + ' day(s)' : Math.round(jumpedMinutes / 60) + ' hours') + ' since the last page. Every seat is stale: re-seat EVERY absent person for the new hour — where they are now, asleep or awake as the hour decides, what changed for them in the gap; close any arrival, want or thread the gap resolved; nothing seated before the jump stands unexamined.'
    : '';
  return { system: withFictionFrame(law({ mc, clockWords, hourWords, jumpWords }) + '\n\n' + fetchLaw({ rounds: WORLD_LOOKS, when: 'Look only when the world you must move rests on a page or a passage you were not shown — who someone is, what they promised, where they went. Most pages need no look.' })), user };
}

/* Exported for the harness. Thinking spans stripped, fences stripped, up to
 * five balanced candidates tried until one carries a mutations list or a
 * brief. Mutations outside WORLD_TYPES are counted, never applied. */
export function parseWorldAnswer(raw) {
  try {
    let text = String(raw || '');
    text = text.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '');
    text = text.replace(/```(?:json|JSON)?/g, '');
    const candidates = balancedCandidates(text, 5);
    let parsed = null;
    for (const c of candidates) {
      const p = parseLenient(c);
      if (p && typeof p === 'object' && (Array.isArray(p.mutations) || (p.brief && typeof p.brief === 'object'))) { parsed = p; break; }
    }
    if (!parsed) return { mutations: [], dropped: 0, brief: null, note: 'unusable' };
    const list = Array.isArray(parsed.mutations) ? parsed.mutations : [];
    let dropped = 0;
    const mutations = [];
    for (const m of list) {
      if (!m || typeof m !== 'object' || typeof m.type !== 'string') { dropped += 1; continue; }
      if (!WORLD_TYPES.has(m.type.trim())) { dropped += 1; continue; }
      mutations.push(m);
    }
    const brief = parsed.brief && typeof parsed.brief === 'object' ? parsed.brief : null;
    return { mutations, dropped, brief, note: mutations.length || brief ? 'ok' : 'empty' };
  } catch (err) {
    return { mutations: [], dropped: 0, brief: null, note: 'unusable' };
  }
}

/* The contract. Resolves null when there was nothing to read; otherwise
 * {applied, rejected, dropped, brief, note}. Throws on transport failure. */
export async function worldTurn({ connection, storyId, userText, assistantText, before = [], brief = '', castNotes = '', castNames = [], voicesBefore = [], effort = 'off', signal, stale, jumpedMinutes = 0, record = '', renew, story = null, pageNumber = 0, canonRecord = '' } = {}) {
  if (!connection || typeof connection !== 'object') return null;
  if (!storyId) return null;
  if (!assistantText || !String(assistantText).trim()) return null;

  const state = await loadState(storyId);
  /* M259: THE RECORD RIDES. chat.js has handed it over since M249; this line
   * dropped it on arrival. */
  /* M304: the people list has a room of its own — a fifth of the connection's, the same in both builds, so the pages' window is measured against the list it will really ride beside */
  const peopleRoom = Math.max(12000, Math.floor(roomChars(connection, MAX_TOKENS) * 0.2));
  const bare = buildWorldMessages({ state, userText, assistantText, before: [], brief, castNotes, castNames, voicesBefore, jumpedMinutes, record, pageNumber, peopleRoom, canonRecord });
  const contextBudget = viewBudget(connection, MAX_TOKENS, bare.system.length + bare.user.length);
  const prompt = buildWorldMessages({ state, userText, assistantText, before, brief, castNotes, castNames, voicesBefore, jumpedMinutes, record, pageNumber, contextBudget, peopleRoom, canonRecord });
  /* M31: an answer we can't use earns ONE second ask with a sharper word;
   * the raw answer rides out so the drawer can show it. */
  let read = null;
  let raw = '';
  let user = prompt.user;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    /* M259: every call gets its own minute (M213), and it may look */
    const { text, finishReason } = await askWithFetch(connection, {
      system: prompt.system,
      user,
      maxTokens: MAX_TOKENS,
      effort,
      signal,
      renew,
      leash: leashFor,
      room: roomChars(connection, MAX_TOKENS),
      rounds: attempt === 0 ? WORLD_LOOKS : 1,
      isAnswer: (t) => { const r = parseWorldAnswer(t); return r.note !== 'unusable' && r.note !== 'cut short'; },
      source: { storyId, story: story || { brief, castNotes } },
    });
    raw = text;
    read = parseWorldAnswer(text);
    if (finishReason === 'length' && read.note === 'unusable') read.note = 'cut short';
    if (read.note !== 'unusable' && read.note !== 'cut short') break;
    user = prompt.user + '\n\nYour last answer was not a JSON object with "mutations" and "brief". Answer with the JSON object only — no words before or after it, and keep it short.';
  }
  if (read.note === 'unusable' || read.note === 'cut short') return { applied: [], rejected: [], dropped: 0, brief: null, note: read.note, raw };
  if (stale && stale()) return null;

  /* Re-read at write time — the ledger may have moved (the extractor's
   * masthead, a hand edit) while the world was being read. */
  const fresh = await loadState(storyId);
  /* M401: ONE WRITER PER NOW. The world agent writes a "now" ONLY for a quiet one in the room — here, not the main
   * character, not on the page; someone the page showed is the scribe's, someone away is the seat's. Anything else it
   * tried is let go here, in code. */
  {
    const quiet = quietInScene(fresh, assistantText, userText).map((n) => findPersonKey(fresh.characters || {}, n) || n);
    const isQuiet = (name) => quiet.some((q) => samePersonName(q, name));
    read.mutations = read.mutations.filter((m) => !(m && m.type === 'people.set' && String(m.field || '').trim() === 'state' && !isQuiet(m.name)));
  }
  /* M40: everyone the agent seats has a page. A seat without a people.set
   * in the same answer gets a minimal core from the seat itself, so the
   * character ledger never shows two people while "elsewhere" shows three;
   * the scribe enriches it later. */
  /* M164: THE GUARD ASKS THE SAME QUESTION THE APPLIER WILL. It compared
   * the seat's name against the ledger's keys EXACTLY, while people.set
   * resolves near-names (findPersonKey). So a seat for "Toma" when the
   * ledger holds "Tomas" looked unknown, earned a minimal core — "seated by
   * the world agent" — and the applier then wrote that stub straight over
   * the smith's real core. Proven: a page that read "the smith — slow to
   * anger, quicker than he looks" became eight words of housekeeping. */
  const hasPage = (name) => Boolean(findPersonKey(fresh.characters || {}, name));
  const pagesInAnswer = new Set(read.mutations.filter((m) => m.type === 'people.set' && typeof m.name === 'string').map((m) => m.name.trim().toLowerCase()));
  const withPages = [];
  for (const m of read.mutations) {
    if (m.type === 'offscreen.set' && typeof m.name === 'string' && m.name.trim()) {
      const key = m.name.trim().toLowerCase();
      if (!hasPage(m.name) && !pagesInAnswer.has(key)) {
        const bits = [m.activity, m.agenda ? 'wants ' + m.agenda : '', m.location ? 'at ' + m.location : ''].filter(Boolean);
        withPages.push({ type: 'people.set', name: m.name.trim(), field: 'core', text: (bits.join('; ') || 'seated by the world agent').slice(0, 4000) }); /* M274: a page field is kept whole */
        pagesInAnswer.add(key);
      }
    }
    withPages.push(m);
  }
  /* M72: the brief is a journaled write too (world.word) — the fold used to
   * revert it to whatever an older snapshot held, so a swipe got a stale
   * world's word. M30's "a window opened is a window remembered" (the last
   * six) lives in the applier now. */
  if (read.brief) withPages.push({ type: 'world.word', brief: read.brief });
  const { state: next, applied: appliedAll, rejected } = applyMutations(fresh, withPages);
  const applied = appliedAll.filter((a) => a.mutation.type !== 'world.word');
  const normalized = read.brief ? next.worldBrief : null;
  if (stale && stale()) return null;
  await saveState(storyId, next);
  notify(storyId);
  return { applied, rejected, dropped: read.dropped, brief: normalized, note: read.note, raw };
}

/* The workers-line words for one run. */
export function worldRunWords(result) {
  if (!result) return 'nothing to read';
  if (result.note === 'unusable') return 'its answer could not be used';
  if (result.note === 'cut short') return 'its answer ran out of room';
  const n = result.applied ? result.applied.length : 0;
  const bits = [];
  bits.push(n ? `moved the world in ${n} ${n === 1 ? 'way' : 'ways'}` : 'the world stood still');
  /* M37: say what moved, not only how much */
  if (n) bits.push(result.applied.slice(0, 4).map((a) => a.words.replace(/\.$/, '')).join(' · ') + (n > 4 ? ' · …' : ''));
  if (result.brief && !result.brief.empty) bits.push('left the world’s word');
  if (result.brief && Array.isArray(result.brief.voices) && result.brief.voices.length) bits.push(`${result.brief.voices.length} ${result.brief.voices.length === 1 ? 'voice' : 'voices'} heard`);
  if (result.rejected && result.rejected.length) bits.push(`${result.rejected.length} refused`);
  if (result.dropped) bits.push(`${result.dropped} it may not touch`);
  return bits.join(', ');
}

/* App-wide switch, default ON; a story may say otherwise (story.world). */
export async function worldAgentOn(story) {
  if (story && story.world === false) return false;
  if (story && story.world === true) return true;
  const v = await db.settings.get('worldAgent');
  return v !== false;
}

export async function worldEffort() {
  const v = await db.settings.get('worldEffort');
  return typeof v === 'string' && v ? v : 'off';
}
