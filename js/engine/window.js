/* Cozy Tavern — engine/window.js (M467)
 * ONE DEFINITION OF THE WINDOW'S MARKER. The house asks the storyteller for a line reading *** The World Beyond ***
 * (assemble/modules.js WINDOW_TEXT), and four readers looked for exactly those characters: the 🎨 boxed style, the
 * page reader's "a person seen only inside the window is elsewhere" guard (chat.js, M129), the scene-before-the-window
 * cut (apply.js scenePartOf, M444) and the lint's "one window a page" (agents/lint.js, M116). A model that wrote the
 * marker as a plain line — "The World Beyond" — or bold, or as a heading, fooled all four at once: the window was not
 * boxed, its people could be seated into the scene, its place could pass for the scene's. The writer: "why is the
 * world beyond not being rendered, and why did the agent not fix it?"
 *
 *   WINDOW_MARK           the exact form
 *   WINDOW_LINE           a line that IS the marker, in any dressing (bare, bold, ***bold***, a heading, dashes, ✦)
 *   windowCutAt(text)     where the window begins (the start of its marker line), or -1
 *   normalizeWindowMark   the page with every such line written as the exact form — marks only, never a word
 * Pure: no store, no DOM. */

export const WINDOW_MARK = '*** The World Beyond ***';

/* a whole line that is the marker: optional marks before and after the three words, nothing else on the line */
const MARKS = '[*#_~—–\\-✦•= \\t]*'; /* never a newline: the blank line above or below the marker is the page's own */
export const WINDOW_LINE = new RegExp('^' + MARKS + 'The[ \\t]+World[ \\t]+Beyond' + MARKS + '$', 'im');
const WINDOW_LINE_ALL = new RegExp('^' + MARKS + 'The[ \\t]+World[ \\t]+Beyond' + MARKS + '$', 'gim');

export function windowCutAt(text) {
  const t = String(text == null ? '' : text);
  const m = WINDOW_LINE.exec(t);
  return m ? m.index : -1;
}

export function normalizeWindowMark(text) {
  const t = String(text == null ? '' : text);
  if (!/world\s+beyond/i.test(t)) return t;
  return t.replace(WINDOW_LINE_ALL, (line) => {
    /* keep the line's own indentation, none of its marks */
    const lead = /^[ \t]*/.exec(line)[0];
    return lead + WINDOW_MARK;
  });
}
