/* Cozy Tavern — assemble/canonpages.js (M518)
 * CANON ON THEIR OWN PAGE, AND THE NOTE GOES QUIET. His design, the per-person half: "each person stays on their own
 * page — canon writes them onto it once, then only speaks for what the page is missing." Canon's note writes a block per
 * canon person on screen, every page:
 *     Yuki Tsukumo:
 *       - Identity: …            lasting — who they are
 *       - Appearance: …          this scene (shown when their face matters)
 *       - Facts: …               this scene (chosen by what is in play)
 *       - Abilities: …           this scene (chosen by what is in play)
 *       - Voice: "…" / "…"       lasting — how they talk
 *       - With Choso: …          this scene (who else is here)
 *       - Secret (…): …          never kept anywhere but the note
 * The lasting lines are kept on their page (people.canon) and ride in their card; the note then leaves out exactly the
 * lines their card in the same request carries — a line the card lost to its room stays in the note. This scene's lines
 * and secrets always ride in the note. Pure: no store, no DOM. */

const HEAD = /^[^\s][^\n:]{0,80}:$/;
const LASTING = /^ {2}- (?:Identity|Personality|Background|Relationships|Powers & Abilities|Trivia|Voice):/;
const PROSE_BRIEF = /^ {2}(?!- )\S/; /* the curator's written briefing, in place of the Identity line */

/* the note's blocks: a line "Name:" and the indented lines under it */
export function canonBlocks(note) {
  const lines = String(note || '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!HEAD.test(lines[i])) continue;
    const body = [];
    let j = i + 1;
    while (j < lines.length && !HEAD.test(lines[j]) && /^\s/.test(lines[j])) { body.push(lines[j]); j += 1; }
    out.push({ name: lines[i].slice(0, -1).trim(), head: i, lines: body });
  }
  return out;
}

/* what of a block lasts: who they are, how they talk, their nature and history — never this scene's lines, never a secret */
export function lastingLines(body) {
  const lines = Array.isArray(body) ? body : [];
  return lines.filter((l, i) => LASTING.test(l) || (i === 0 && PROSE_BRIEF.test(l)));
}

/* the note without what the people section of this same request already carries: a lasting line of a person's block is
 * left out only when that exact line rides in the people section (their card's "From canon"); a line the card let go for
 * room stays. A block with nothing left loses its name line too. */
export function canonOffPages(note, peopleText) {
  const text = String(note || '');
  const people = String(peopleText || '');
  if (!text.trim() || !people.includes('From canon:')) return text;
  const lines = text.split('\n');
  const drop = new Set();
  for (const b of canonBlocks(text)) {
    const bodyAt = b.head + 1;
    let kept = 0;
    b.lines.forEach((l, k) => {
      const lasting = LASTING.test(l) || (k === 0 && PROSE_BRIEF.test(l));
      if (lasting && l.trim().length > 12 && people.includes(l)) drop.add(bodyAt + k);
      else kept += 1;
    });
    if (!kept && b.lines.length) drop.add(b.head); /* nothing left to say of them: their name goes too */
  }
  return lines.filter((_, i) => !drop.has(i)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
