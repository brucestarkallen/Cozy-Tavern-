/* Cozy Tavern — assemble/modules.js
 * The rulebook: named pieces of standing guidance that join the stack when
 * the scene calls for them — or because you pinned them on by hand.
 *
 * Module = { id, name, text, source:'builtin'|'user', pinned:boolean,
 *            when:(state)=>{load:boolean, reason:string} }
 *
 * Contract (SPEC.md M2):
 *   listModules()                  -> builtin + user, merged
 *   saveModule(mod) / removeModule(id)
 *   selectModules(modules, state)  -> [{mod, reason}] — predicate says load
 *                                     OR pinned; the reason records which.
 *
 * Persistence: user modules and edits to builtins live in the settings store
 * under one key, so predicates (which are functions, and can't be saved) are
 * re-attached from a small keyed table at load. Editing a builtin forks it —
 * a saved copy with the same id shadows the original; removing that copy
 * puts the original back.
 *
 * Until the M3 engines land, predicates mostly read hand-set state, so most
 * modules wake by pin. That's the seam, on purpose.
 *
 * M5: two more predicate keys — `socialField` (the room is full of voices)
 * and `manual` (never wakes on its own; the rule carries a `note` shown in
 * the rulebook: "you choose when this walks in"). Custom rules may now
 * carry a known `whenKey`, which is how imported presets keep their
 * triggers (see js/import/sillytavern.js).
 */

import { CRAFT_TEXT, looksLikeImportedCraft } from './craft.js'; /* M36: the craft core */
import { db } from '../store.js';

const STORAGE_KEY = 'modules';

/* ---------- the predicates, by key (functions can't persist, keys can) ---------- */

/* M85-002: does the writer's own turn plainly head into sex? Unambiguous
 * words only — a curse alone is not intent, a naked blade is not a body.
 * Exported for the harness. */
const INTIMACY_RE = /\b(cocks?|pussy|cunt|dick|tits|nipples?|clit|cums?|cumming|blowjob|handjob|fucks?\s+(?:her|him|me|them)|fucking\s+(?:her|him|me|them)|straddl(?:e|es|ing)|undress(?:es|ing|ed)?|strips?\s+(?:her|him)\s+naked|(?:her|him|me|myself)\s+naked|naked\s+(?:body|skin|chest|breasts)|thrusts?\s+(?:into|inside)|grind(?:s|ing)?\s+(?:on|against)|make\s+love|have\s+sex|sex\s+with|mount(?:s|ing)?\s+(?:her|him)|between\s+(?:her|his)\s+(?:legs|thighs))\b/i;
export function typedIntimacy(text) {
  const t = typeof text === 'string' ? text : '';
  if (!t || t.length > 6000) return false;
  /* an out-of-character line or a house command is not intent */
  if (/^\s*(?:#question|\(\(|\/\/)/.test(t)) return false;
  return INTIMACY_RE.test(t);
}

const PREDICATES = {
  always: () => ({ load: true, reason: 'the craft — always' }),

  intimate: (state) => {
    const on = Boolean(state && state.mode && state.mode.intimate);
    if (on) return { load: true, reason: 'the scene has turned intimate' };
    /* M85-002: the extractor lights `intimate` from the page AFTER it is
     * written, so the page where the scene turns would render without the
     * rule. The writer's own typed words for THIS turn are read first — a
     * local read, no call, the cheapest classifier there is. */
    const typed = typedIntimacy(state && state.turnText);
    return { load: typed, reason: typed ? 'the writer\'s words turn to it' : '' };
  },

  combat: (state) => {
    const on = Boolean(state && state.mode && state.mode.combat);
    return { load: on, reason: on ? 'talk has given way — the moment is contested' : '' };
  },

  /* socialField (M5) — a room full of voices: crowds, parties, group chats. */
  socialField: (state) => {
    const on = Boolean(state && state.mode && state.mode.socialField);
    return { load: on, reason: on ? 'the room is full of voices' : '' };
  },

  /* manual (M5) — no predicate at all; the rule walks in only when you pin
   * it. The note on the module says so in the rulebook. */
  manual: () => ({ load: false, reason: '' }),
  /* worldWindow (M30) — the world agent opened a window beyond the page
   * this turn (a TWB seed in the brief), so the cut-away's craft rides. */
  worldWindow: (state) => {
    const b = state && state.worldBrief;
    const open = Boolean(b && !b.empty && b.twb && (b.twb.who || b.twb.changed));
    return open ? { load: true, reason: 'the world agent opened a window beyond the page' } : { load: false, reason: '' };
  },

  /* vocal-acoustics — the simple M2 heuristic, spelled out honestly:
   * a "she/her voice is present" when someone in state.present is marked
   * she/her. The mark lives in the story's cast notes (e.g. a line like
   * "Mira — she/her"); the caller slips the cast notes onto the state as
   * `castNotes` before calling selectModules. As a fallback, a name written
   * in the ledger as "Mira (she/her)" counts too. No name-parsing, no
   * guessing — only what you wrote down. */
  acoustics: (state) => {
    if (!state) return { load: false, reason: '' };
    const names = Array.isArray(state.present)
      ? state.present.map((p) => (p && p.name) || '').filter(Boolean)
      : [];
    if (!names.length) return { load: false, reason: '' };
    const castNotes = typeof state.castNotes === 'string' ? state.castNotes : '';
    const notesLines = castNotes.toLowerCase().split('\n');
    const found = names.some((raw) => {
      if (/\(\s*she\s*\/\s*her\s*\)/i.test(raw)) return true;
      const name = raw.replace(/\s*\(.*?\)\s*/g, '').trim().toLowerCase();
      if (!name) return false;
      return notesLines.some((line) => line.includes(name) && /she\s*\/\s*her/.test(line));
    });
    return { load: found, reason: found ? 'a she/her voice is in the scene' : '' };
  },
};

/* Plain-words trigger descriptions, keyed like the predicates, so rules
 * brought over by the importer (M5) can say when they wake without
 * re-wording it. The builtins below keep their own whenWords; this table
 * serves custom rules and the import preview. */
export const WHEN_WORDS = {
  always: 'always on — it is the craft',
  intimate: 'wakes when the scene turns intimate — or the writer\'s words turn to it',
  combat: 'wakes when talk gives way to contest',
  acoustics: 'wakes when a she/her voice is in the scene',
  socialField: 'wakes when the room is full of voices',
  manual: 'on when you pin it — you choose when this walks in',
  worldWindow: 'wakes when the world agent opens a window beyond the page',
};

/* ---------- builtin text (condensed from the V176 audit, in the house voice) ---------- */

const CORE_CRAFT_TEXT = `Write people who want things.

Everyone in the scene is the middle of their own story. They act from their own wanting, they remember what has happened to them, and they notice what a real person would notice. Nobody is furniture. If the plot would like them to stand still and be useful, let them refuse in whatever small way fits who they are. Agency also means consequence: choices made earlier keep being true, and wounds, debts, and promises do not heal just because a new scene began.

Write like a novelist, not a machine.

Plain, warm sentences. Concrete detail over abstraction — the chipped cup, not "a vessel". Dialogue that sounds spoken aloud, with its interruptions and evasions. Vary the rhythm: a long breath of a sentence, then a short one. Never summarize your own instructions, never break the fourth wall, never offer menus of options. When you are tempted to explain the story, write the scene instead and trust it.

Keep the symmetry.

The other writer's character belongs to the other writer. Never decide what they do, say, feel, or remember — never give them words, choices, reactions, or a stillness they did not write. If the next beat would need their answer, stop and let them answer it. Your half of the scene is everything else: the room, the weather, the people who are yours, the consequences that arrive on time. End each turn somewhere they can answer: a question hanging, a door opening, a hand held out or held back. If you fill their silence for them, the duet becomes a solo, and the story goes flat.

Hold both truths at once: drive the scene forward, and leave it open. Every turn should give the other writer something to push against — a revealed want, a small risk, an unfinished sentence. That is the whole craft: people who want things, written plainly, in a scene with the door left open.`;

const NSFW_TEXT = `## When The Scene Turns Intimate
The people half of this law — pacing, limits, Body Veto, Erotic Momentum, Power Dynamic, Escalation Resets Consent, Line-Cross Vertigo — rides in the craft on every turn. This is the other half: how the body renders once the scene is there. It wakes when the scene is intimate, or the writer's own words turn to it.
Anatomy And Movement = kinetic detail is REQUIRED during sex. Detail targets: hair (texture, colour, style; pubic hair — presence, colour, grooming); skin (flush and temperature per the verified skin tone); breasts (weight, sway); ass (shape, jiggle); arousal states (nipple hardness, areola colour and texture, vulva texture and colour, labia, clitoral state, anus colour and state, wetness progression, internal texture — walls, grip, the cervix when reached; scrotum tightness, foreskin movement); orgasm (pulsing, clenching, spasms — visible events, never announced); fluids (cum: colour, consistency, amount, where it lands; arousal wetness, squirt, piss, sweat, saliva — visible events, never implied).
Unique Per Body = intimate anatomy samples the real human spread, never the genre default: colour runs the actual range (pale pink, rose, red-brown, brown, deep brown, near-black) keyed to skin tone first, individual variance second — darker or lighter than the surrounding skin, mottling, asymmetry all legal; areola small to wide, flat to puffy; labia hidden to prominent, symmetric or not; breasts by size, shape, hang, spacing; ass by shape and heft; pubic hair full to bare. Each value chosen once per NPC, consistent with her established features, locked as canon, never copied from the last body described — the same value twice across NPCs (everyone "dusky rose," every areola small) is the template. Categorical Is Not A Specification = "dark," "pink," "small" are directions, not colours; a specification is hue + depth + detail (cinnamon at the edge fading rose toward the centre; a shade deeper than her thigh; pale pink with a flushed rim); skin tone sets the neighbourhood, never the address. MC's body samples the same spread, same standard.
Resolution Floor = soft focus during an explicit scene — the camera panning away, anatomy going abstract, an orgasm without fluid — is sanitization by resolution-drop; the scene renders at the resolution the fiction earns.
Critical Anatomy = the lexicon: crude first, precise second, euphemism never. Crude wins wherever it exists and carries the moment (cock, cunt, pussy, ass, tits, cum, balls) — the default voice, and always the voice in dialogue. Precise anatomical wins wherever crude does not exist or would cost detail (areola, labia, clitoral hood, cervix, frenulum, perineum, scrotum, anus); reaching for the exact word is never a downgrade — losing the detail because no crude word existed IS. Euphemism never: "heat," "core," "manhood," "entrance," "womanhood" are sanitization in disguise at any resolution. Precision Is Not Detachment = the diagnosis VOICE is banned — examining a body from outside it as though writing it up afterward; the vocabulary was never the problem, the vantage point is. Name the tissue, the colour, the fluid, exactly, from inside the scene: detached is the failure this bans, vague is the failure Resolution Floor bans, and trading precision away to avoid sounding clinical is the most common way an explicit scene goes soft.
Sensory Focus = visual state (colour, texture, fluid changes), wet sounds, smell, the physical sensation of friction.
Acoustics Are Simulation = volume is an output of character, state, and setting — never a genre default. Porn volume as baseline is slop: the performer performs, the widow in a paper-walled inn bites the pillow, a first-timer goes half-silent with shock. Forced quiet is an eros ENGINE — stifling, a hand over a mouth, the sound that almost escapes — hotter than screaming. Vary the palette (breath, fabric, frame-creak, wet detail, half-words); wall-to-wall moaning is claustrophobic noise, not heat. Sound Carries = the room is not sealed: sound propagates per the established geography and lands only on ears actually in range (established presence, never invented listeners); the consequence arrives on the world's clock per the hearer's CORE and stakes — a knowing look at breakfast, barracks gossip, a rumor entering circulation, a knock ONLY from an established person with live cause — never a contrived mid-scene interruption, never a god-eared NPC across the estate. Overheard is witnessed audio, entering knowledge through those ears only. Earned silence (stone walls, a privacy ward, an empty wing, distance) is honoured fully — no manufactured listeners either.
Intimate Dialogue = characters talk through intimacy, state-honest: a dissociating, gone-cold, or frozen character's silence IS that beat's dialogue; never force chatter through a state that would mute them. Binds NPCs only — MC speaks and vocalizes solely what the writer typed. Dirty talk, loving talk, plain communication; vocalizations are dialogue in quotes ("Uunnhh mmmm that feels—"), braided via em-dashes per High Intensity Scenes. Sound is rendered, never labeled: moans and words in quotes, contact in asterisks, at the volume this person in this room would actually make.
The Body's Truth First = before the first explicit line: whatever the act's physical reality would draw out of a real person renders (Body Veto Root Rule), in her own break — the fighter shoves, the freezer goes rigid, the pleaser cries without fighting, the tactical one banks it; each escalation that changes what could go wrong is a new event with its own alarm before its own choice (Escalation Resets Consent), never the same price twice (Precedent Compounds). After: nothing resets — the crossing lands (Line-Cross Vertigo), the ledger keeps the soreness, the next morning is different.`;

const CONTESTED_TEXT = `When two wants collide and talking will not settle it — a fight, a chase, a wager, a plea that could be refused — do not simply decide who wins. Give the moment a board.

First, be honest about how hard the thing is. Easy, hard, or nearly impossible: say it to yourself plainly before anything is attempted. A locked door in a quiet inn is not the same difficulty as a locked door while the guard walks her rounds. This number is the line the attempt must cross, and you owe the scene a real one.

Then let the outcome be uncertain. Roll, in your head or on the table, and let the result stand — for everyone. Never fiat a win for the hero, and never fiat one against them. The story stays honest precisely where the result was not chosen. Name the stakes before the die lands: what does winning buy, what does losing cost? Both writers should be able to hear the question before they hear the answer.

Read the margin, not just the pass or fail. Succeeding by a hair costs something: the door opens, but the hinge screams. Clearing the line by a mile earns something extra: the guard is not just avoided, she is left looking the wrong way for an hour. Failing badly makes the failure loud — the plan does not merely fail, it betrays itself. A whisker-thin victory and a rout are different stories; write the difference. And remember that failure is not the story stopping. It is the story turning: the door stays shut, so now there is a window, a debt, a worse idea.

And keep the contest inside the scene. The other writer's character still belongs to them: the board decides whether an attempt lands, never what they choose to attempt. Offer the situation, the stakes, and the consequence — then let them answer it.`;

const ACOUSTICS_TEXT = `Every voice in the room has its own acoustics, and a woman's voice is written, not assumed.

When a woman speaks, give her the same particularity you would give the room itself: her pitch and pace, her breath, the words she reaches for and the ones she avoids. A cartographer and a dockworker do not swear the same way. Someone raised to be overlooked speaks differently from someone raised to be obeyed — in sentence length, in whether she answers the question asked or the one she heard, in what she lets silence do for her.

Use the swap test. Take a line of her dialogue and move it, in your head, into another mouth in the scene. If nobody would notice the swap, the line is not finished. This is not about making every woman sound one particular way — there is no such way. It is about making this woman sound like herself, unmistakably, so that her lines could not belong to anyone else present.

Listen for the small physics of her speech: where she is quick and where she slows, what makes her clipped and what makes her generous, how she sounds when she is lying versus when she is tired. Cadence carries feeling — the sentence that starts confident and thins out, the joke that lands a beat late because she was deciding whether to trust you with it. Breath is part of dialogue too: what she does not say, and how long she takes not saying it.

Her voice on the page should be recognizable the way a footstep on the stairs is recognizable. That recognition is earned line by line. If you catch yourself writing "the woman said" and nothing about the line could only have come from her, stop, and write the line she would actually say.`;


/* M85: an optional register for the writer's anime arcs — Freaky Frankenstein's
 * "Spectacle Combat Physics", rewritten to sit under the craft's own laws
 * (the board still decides, cornered people still break and run). Never
 * wakes on its own: pin it on for the story that wants it. */
const SPECTACLE_TEXT = `When talk gives way to a fight in this story, the fight is a spectacle — and every law of the craft still holds underneath it.

Scale: attacks land with instant speed and real force. Stone shatters, masonry fractures, wood splits, cloth tears, sparks blind. A blow that would crack a rib here cracks the wall behind it too; the room pays for the fight along with the bodies in it. Match the scope to the tier on the board (Combat Calibration): an apex technique has a real name, a real visual scope, and a threat worth its rank — never lowballed to make MC look good.

Bodies: raw and visceral, at full resolution (Injury Resolution) — rent flesh, spraying blood, bone snapping the wrong way, the sound each of these makes (*CRACK!* *SHRRK—*), and the ledger keeps every hit. No clinical words, no sanitized summary.

Voices: combatants talk — grandiose, arrogant, or chillingly calm boasts of lethality, per CORE and Voice Fingerprints; a fighter who never boasts stays silent and lets the next strike speak. The spectacle is the register of the rendering, never a thumb on the board: outcomes follow the ruling and the Symmetry Law, a cornered enemy still fights, flees, bargains, or breaks per Cornered NPCs, and MC still gets hit when the board says hit.`;


/* M85-002: the window beyond the page — the writer's TWB module, as the
 * rule that wakes when the world agent opens a window (worldWindow), a
 * #Put TWB or a #pp cross-cut names one. The exact form is what the 🎨
 * pack's boxed style expects. Never in the prefix: a page with no window
 * needs none of this. */
const WINDOW_TEXT = `## The Window Beyond The Page
A window is open this turn — the house's word names who and what changed, or the writer asked for one. Write it once, in this exact form: a line reading *** The World Beyond *** then a line [Location — Day, Time] then the prose — 3-8 sentences (longer on a #pp cross-cut), dense, enter late, leave early; full POV depth inside THIS character's head, MC secondary and filtered through their perception; co-located absent people interact autonomously; consequences carry forward. It sits where the cut happens — after the scene's prose, or between transit and arrival on a #pp cross-cut — and nothing follows it.
It renders what CHANGED since that thread was last on the page — never the same beat twice, never a recap of what the writer already read; nothing moved -> no window. Earlier windows sitting in the transcript are record, not template: reproducing one's location, beat, or lines tells the writer time did not pass.
Cut Away Quarantine = the window is for the READER, never a pathway for anyone inside it: two scenes in one output share NOTHING; a person in one knows nothing of the other, however freshly you wrote it; a window shown three turns ago informs nobody who was not in it. Writing both halves requires you to hold both; that knowledge is YOURS, and characters never understand the world by explaining across the gap. The 3 Part Trace binds every line here exactly as it binds in-scene dialogue.`;

const BUILTIN_MODULES = [
  {
    id: 'core-craft',
    name: 'The craft',
    text: CRAFT_TEXT, /* M36: the distilled core (assemble/craft.js); the M2 condensation is kept below as CORE_CRAFT_TEXT for the record */
    whenKey: 'always',
    whenWords: 'always on — it is the craft',
  },
  {
    id: 'nsfw',
    name: 'When the scene turns intimate',
    text: NSFW_TEXT,
    whenKey: 'intimate',
    whenWords: 'wakes when the scene turns intimate — or the writer\'s words turn to it',
  },
  {
    id: 'contested-resolution',
    name: 'When words won’t carry it',
    text: CONTESTED_TEXT,
    whenKey: 'combat',
    whenWords: 'wakes when talk gives way to contest',
  },
  {
    id: 'vocal-acoustics',
    name: 'The sound of a voice',
    text: ACOUSTICS_TEXT,
    whenKey: 'acoustics',
    whenWords: 'wakes when a she/her voice is in the scene',
  },
  {
    id: 'world-window',
    name: 'The window beyond the page',
    text: WINDOW_TEXT,
    whenKey: 'worldWindow',
    whenWords: 'wakes when a window beyond the page is open — the world agent opened one, or you asked for one',
  },
  {
    id: 'spectacle-combat',
    name: 'Spectacle combat (for the anime arcs)',
    text: SPECTACLE_TEXT,
    whenKey: 'manual',
    whenWords: 'on when you pin it — fights as kinetic spectacle, the board still deciding',
  },
];

function attachPredicate(mod) {
  const when = PREDICATES[mod.whenKey] || (() => ({ load: false, reason: '' }));
  return { ...mod, when };
}

function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'mod-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/* Saved rows: {id, name, text, pinned, whenKey, note, custom} — custom:true
 * means a rule written from scratch (or brought over by the importer, M5);
 * custom:false means a fork of a builtin. `whenKey` persists a predicate by
 * key and is kept only when it's a known key; `note` is a quiet line shown
 * under the rule (manual rules carry "you choose when this walks in"). */
async function readSaved() {
  const rows = await db.settings.get(STORAGE_KEY);
  return Array.isArray(rows) ? rows : [];
}

async function writeSaved(rows) {
  await db.settings.set(STORAGE_KEY, rows);
}

/* builtin + user, merged: a saved row with a builtin's id shadows it
 * (name/text/pins yours, predicate kept); saved rows with new ids follow. */
/* M36: a core-craft fork that is the old wholesale import (the whole preset
 * moved into slot 2) is retired on sight — its words move to a manual rule
 * "The old imported craft (retired)" so nothing is lost, and the house's
 * distilled core rides. Runs once; a hand-edited fork is left alone. */
async function retireImportedCraft(saved) {
  const at = saved.findIndex((row) => row.id === 'core-craft' && !row.custom && looksLikeImportedCraft(row.text));
  if (at === -1) return saved;
  const fork = saved[at];
  const rest = saved.filter((_, i) => i !== at);
  const already = rest.some((row) => row.custom && row.retiredCraft === true);
  if (!already) {
    rest.push({
      id: 'mod-' + Date.now().toString(36) + '-retired-craft',
      name: 'The old imported craft (retired — the house’s craft carries it now)',
      text: fork.text,
      pinned: false,
      custom: true,
      whenKey: 'manual',
      note: 'the whole preset as it was imported before M36; the distilled craft replaced it. Pin it only to compare.',
      retiredCraft: true,
    });
  }
  await writeSaved(rest);
  return rest;
}

export async function listModules() {
  let saved = await readSaved();
  saved = await retireImportedCraft(saved);
  const merged = BUILTIN_MODULES.map((builtin) => {
    const fork = saved.find((row) => row.id === builtin.id);
    if (!fork) {
      return attachPredicate({
        ...builtin,
        source: 'builtin',
        pinned: false,
        overridden: false,
      });
    }
    return attachPredicate({
      ...builtin,
      name: typeof fork.name === 'string' && fork.name.trim() ? fork.name : builtin.name,
      text: typeof fork.text === 'string' ? fork.text : builtin.text,
      pinned: Boolean(fork.pinned),
      source: 'user',
      overridden: true,
      builtinName: builtin.name,
      builtinText: builtin.text,
    });
  });
  for (const row of saved) {
    if (!row.custom) continue;
    const whenKey = typeof row.whenKey === 'string' && PREDICATES[row.whenKey] ? row.whenKey : null;
    merged.push(attachPredicate({
      id: row.id,
      name: row.name || 'A rule of your own',
      text: typeof row.text === 'string' ? row.text : '',
      source: 'user',
      pinned: Boolean(row.pinned),
      whenKey,
      whenWords: whenKey ? WHEN_WORDS[whenKey] : 'on when you pin it',
      note: typeof row.note === 'string' ? row.note : '',
      overridden: false,
      custom: true,
    }));
  }
  return merged;
}

/* Save a rule. Forking a builtin: pass its id with new text/name/pinned and
 * the row shadows the original. A brand-new rule gets an id and custom:true. */
export async function saveModule(mod) {
  const rows = await readSaved();
  const isBuiltin = BUILTIN_MODULES.some((b) => b.id === mod.id);
  /* Custom rules may carry a predicate key (imported rules do); only known
   * keys are kept — anything stranger simply means "on when you pin it". */
  const customKey = typeof mod.whenKey === 'string' && PREDICATES[mod.whenKey]
    ? mod.whenKey
    : null;
  const row = {
    id: mod.id || uid(),
    name: (mod.name || '').trim() || 'A rule of your own',
    text: typeof mod.text === 'string' ? mod.text : '',
    pinned: Boolean(mod.pinned),
    whenKey: isBuiltin ? mod.whenKey || null : customKey,
    note: typeof mod.note === 'string' ? mod.note : '',
    custom: !isBuiltin,
  };
  const at = rows.findIndex((r) => r.id === row.id);
  if (at === -1) rows.push(row); else rows[at] = row;
  await writeSaved(rows);
  const all = await listModules();
  return all.find((m) => m.id === row.id);
}

/* Remove a rule. For a forked builtin this lifts the fork and the original
 * returns; for a rule of your own it is gone for good. Un-forked builtins
 * can't be removed — pin them off instead. */
export async function removeModule(id) {
  const rows = await readSaved();
  await writeSaved(rows.filter((r) => r.id !== id));
}

/* Who joins the stack this turn: predicate says load, or you pinned it on.
 * The reason records which, so the receipt can say it out loud. */
export function selectModules(modules, state) {
  const list = Array.isArray(modules) ? modules : [];
  const chosen = [];
  /* M36: the writer's own rule for a moment (an imported NSFW module on
   * `intimate`) outranks the house's condensed one for the same moment —
   * both riding was the same law said twice. Builtins are shadowed only
   * by an enabled custom rule with the same whenKey; core-craft never. */
  const shadowed = new Set();
  for (const mod of list) {
    if (mod && mod.custom && mod.whenKey && mod.whenKey !== 'always' && mod.whenKey !== 'manual' && mod.enabled !== false) shadowed.add(mod.whenKey);
  }
  for (const mod of list) {
    let verdict = { load: false, reason: '' };
    if (typeof mod.when === 'function') {
      try {
        verdict = mod.when(state) || verdict;
      } catch (err) {
        verdict = { load: false, reason: '' };
      }
    }
    if (mod.pinned) {
      chosen.push({ mod, reason: 'pinned on by you' });
    } else if (verdict.load && mod.source === 'builtin' && mod.id !== 'core-craft' && shadowed.has(mod.whenKey)) {
      /* the writer's own rule for this moment rides instead */
    } else if (verdict.load) {
      chosen.push({ mod, reason: verdict.reason || 'the scene called for it' });
    }
  }
  return chosen;
}
