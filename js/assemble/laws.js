/* Cozy Tavern — assemble/laws.js (M510)
 * HIS CRAFT, LAW BY LAW, NEVER REWORDED. The craft (his Simulation Engine V177, distilled — assemble/craft.js, or his own
 * fork of it on the rulebook shelf) is thirteen sections of named laws, each a line that opens "Name = …", some sections
 * opening with a few lines of their own. A small model cannot carry all seventy thousand characters of it: what stands
 * far back is lost (the reason his own onomatopoeia law went unheard). It can carry the few laws a scene needs — in his
 * exact words. This file cuts the craft into those laws and puts chosen ones back together in the craft's own order,
 * each under its section's own heading. Not one word of a law is changed. Pure. */
const HEADING = /^#{1,4}[ \t]+(.+?)[ \t]*$/;
const LAW_START = /^[ \t]*([A-Z][A-Za-z0-9’'&/\-]*(?:[ \t]+[A-Za-z0-9’'&/\-]+){0,7})[ \t]+=[ \t]/;

/* Every law, in order: {name, section, preamble, text, index}. A section's own opening lines (before its first law)
 * are a law named after the section — "The Telling" is kept whole that way. */
export function lawsOf(text) {
  const lines = String(text == null ? '' : text).split('\n');
  const out = [];
  let section = '';
  let cur = null;
  const close = () => {
    if (!cur) return;
    const body = cur.lines.join('\n').replace(/\s+$/, '');
    if (body.trim()) out.push({ name: cur.name, section: cur.section, preamble: cur.preamble, text: body });
    cur = null;
  };
  for (const line of lines) {
    const h = HEADING.exec(line);
    if (h) { close(); section = h[1]; cur = { name: section, section, preamble: true, lines: [] }; continue; }
    const m = LAW_START.exec(line);
    if (m) { close(); cur = { name: m[1].trim(), section, preamble: false, lines: [line] }; continue; }
    if (!cur) cur = { name: section || 'The craft', section, preamble: true, lines: [] };
    cur.lines.push(line);
  }
  close();
  return out.map((law, index) => ({ ...law, index }));
}

export const lawKey = (s) => String(s == null ? '' : s).toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

/* the laws whose names are asked for (a section's name brings its opening lines) */
export function lawsNamed(list, names) {
  const want = new Set((Array.isArray(names) ? names : []).map(lawKey).filter(Boolean));
  return (Array.isArray(list) ? list : []).filter((law) => want.has(lawKey(law.name)));
}

/* chosen laws back together: the craft's own order, each section's heading once, every law's words as they stand */
export function joinLaws(chosen) {
  const seen = new Set();
  const sorted = (Array.isArray(chosen) ? chosen : []).filter((l) => l && !seen.has(l.index) && seen.add(l.index)).sort((a, b) => a.index - b.index);
  const out = [];
  let at = null;
  for (const law of sorted) {
    if (law.section && law.section !== at) { at = law.section; out.push('## ' + at); }
    const words = law.text.split('\n').map((l) => l.replace(/^[ \t]+/, '')).join('\n').trim();
    if (words) out.push(words);
  }
  return out.join('\n');
}

/* WHAT A SMALL MODEL ALWAYS CARRIES: who tells and who plays (The Telling), the header his ledger reads the place and
 * the clock from (Header Protocol — without it the ledger loses the scene), his character left to him (MC Agency and
 * its three companions, Intent Horizon), and what a page may carry (The Page's three laws). */
/* M510-18: and WHAT A PERSON CAN KNOW — his craft's own rule (Epistemic Law: witnessed, told by a named on-page source, or
 * one obvious step; The 3 Part Trace: the ledger's "who knows what" first, then the three questions, all fail → cut it).
 * The frontier model reads the whole list of who knows what (on a long tale, thousands of tokens); a small model reads
 * the scene's part of it and carries the RULE, so no one knows what no page gave them, listed or not. */
export const ALWAYS_LAWS = ['The Telling', 'Header Protocol', 'MC Agency', 'MC Dialogue Is Literal', 'Every MC Action Is An Attempt', 'Intent Horizon', 'Epistemic Law', 'The 3 Part Trace', 'Marks On The Page', 'The Window Beyond The Page', 'Readable Media'];
/* his two sound laws — said right before the page whenever the scene is a fight, sex, torture or a raw peak */
export const SOUND_LAWS = ['Sound As Onomatopoeia', 'High Intensity Scenes'];
/* the laws a small request cannot stand without: if his craft no longer holds them by these names, the small request
 * is not built (the whole craft rides instead) */
export const LOAD_BEARING = ['Header Protocol', 'Marks On The Page'];
export const MAX_CHOSEN_LAWS = 12;

/* M510-7: A FIGHT BEGINS IN HIS OWN WORDS a beat before the ledger marks it (the ledger reads the page AFTER it is written;
 * the combat rule woke only from the ledger's mark) — so the page where he draws his blade reached a small model with no
 * fight laws and no sound. A local read of his message, no call — the M85-002 way the intimacy rule wakes. For a small
 * model's page only; the frontier request is unchanged. An out-of-character line or a house command is not intent. */
const COMBAT_RE = /\b(?:attack(?:s|ed|ing)?\b(?!\s+(?:of|on)\s+(?:nerves|panic))|punch(?:es|ed|ing)?\s+(?:him|her|them|it|at|back|through)|kick(?:s|ed|ing)?\s+(?:him|her|them|at)|strik(?:e|es|ing)\s+(?:him|her|them|at|first|back)|stab(?:s|bed|bing)?|slash(?:es|ed|ing)?|lung(?:e|es|ed|ing)|tackl(?:e|es|ed|ing)|headbutt(?:s|ed|ing)?|uppercut|draw(?:s|ing)?\s+(?:my|his|her|the)\s+(?:sword|blade|zanpakuto|katana|knife|dagger|gun|pistol|weapon)|swing(?:s|ing)?\s+(?:my|his|her|the)\s+(?:sword|blade|zanpakuto|katana|staff|fist|axe|hammer)|(?:shoot|shoots|shot|fire|fires|fired)\s+(?:at\s+)?(?:him|her|them)|hit(?:s|ting)?\s+(?:him|her|them)\b|fight(?:s|ing)?\s+(?:him|her|them|back)|bankai|shikai)/i;
export function typedCombat(text) {
  const t = typeof text === 'string' ? text : '';
  if (!t || t.length > 6000) return false;
  if (/^\s*(?:#question|\(\(|\/\/)/.test(t)) return false;
  return COMBAT_RE.test(t);
}
/* the fight laws a small model carries on a fight's page, whatever the helper picked before the fight began */
export const FIGHT_LAWS = ['Combat Calibration', 'Injury Resolution', 'Symmetry Law'];

