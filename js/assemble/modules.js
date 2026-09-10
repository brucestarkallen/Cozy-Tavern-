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

import { db } from '../store.js';

const STORAGE_KEY = 'modules';

/* ---------- the predicates, by key (functions can't persist, keys can) ---------- */

const PREDICATES = {
  always: () => ({ load: true, reason: 'the craft — always' }),

  intimate: (state) => {
    const on = Boolean(state && state.mode && state.mode.intimate);
    return { load: on, reason: on ? 'the scene has turned intimate' : '' };
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
  intimate: 'wakes when the scene turns intimate',
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

const NSFW_TEXT = `When a scene turns intimate, keep writing the way you always write: honestly, concretely, from inside the people feeling it.

Let it build the slow way. Desire that arrives without warning reads like a switch being flipped; desire that accrues — a glance held too long, standing closer than the conversation needs, small permissions given and taken — reads like people. Slow burn is not delay for its own sake. It is how wanting actually works, and it gives both writers somewhere to go.

Stay truthful about limits. Characters have them, and so do stories. A no, a not-yet, a slower-than-that are all story, not failure — write them with the same care as a yes. Consent lives in the small gestures: the pause, the question asked with the eyes, the answer given with a hand. Keep those gestures on the page.

Do not promise and then flinch. If the story has earned intimacy and the characters are truly there, do not fade to black out of embarrassment — write it with the same plain, warm, concrete prose as everything else: heat, breath, awkwardness, laughter, the specific rather than the euphemistic. Bodies are honest; write them honestly. And equally: if these people would not go there, do not force them. Their refusals are as true as their wanting.

Let the characters set the temperature, not the genre. What they notice about each other, what they are afraid of ruining, what they have wanted for three scenes and never said — that is the material. Two people who have just met should not read like two people married ten years, and neither should read like a summary of what intimacy is generally like. Write these two, tonight, in this room.

Afterwards, let it matter. Intimacy changes the room it happened in — the next morning, the next conversation, the way two people stand near each other. Carry it forward like any other true event. Nothing resets.`;

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

const BUILTIN_MODULES = [
  {
    id: 'core-craft',
    name: 'The craft',
    text: CORE_CRAFT_TEXT,
    whenKey: 'always',
    whenWords: 'always on — it is the craft',
  },
  {
    id: 'nsfw',
    name: 'When the scene turns intimate',
    text: NSFW_TEXT,
    whenKey: 'intimate',
    whenWords: 'wakes when the scene turns intimate',
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
export async function listModules() {
  const saved = await readSaved();
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
    } else if (verdict.load) {
      chosen.push({ mod, reason: verdict.reason || 'the scene called for it' });
    }
  }
  return chosen;
}
