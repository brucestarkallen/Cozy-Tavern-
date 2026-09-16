/* M279: A STREAMED TEXT, DRAWN LINE BY LINE.
 *
 * The live thinking was rewritten whole on every piece (a phone froze on a
 * long one), then — M269 — shown only by its newest 4,000 characters, so the
 * writer could not read a thinking from its first word while it streamed.
 * Here each line is its own block, and a line that runs long is ended at its
 * next sentence (or, far past that, its next space): a frame's new words
 * touch only the short block they land on, however long the whole grows, and
 * the whole of it is there from the first word. The box follows its own
 * bottom only when the reader is already there — scrolled up to read, he is
 * left where he is. The finished thinking is drawn whole, as it always was. */
const SOFT = 500;   /* past this, a line ends at its next sentence */
const HARD = 1500;  /* past this, at its next space */
const SENTENCE_END = /[.!?…]["”’)\]]?\s+/;

export function streamText(box) {
  let line = null;
  let lineLength = 0;
  let length = 0;
  const newLine = () => {
    line = box.ownerDocument.createElement('div');
    line.className = 'stream-line';
    box.appendChild(line);
    lineLength = 0;
  };
  const add = (text) => {
    if (!text) return;
    line.appendChild(box.ownerDocument.createTextNode(text));
    lineLength += text.length;
  };
  const addToLine = (text) => {
    let rest = text;
    while (rest) {
      if (lineLength >= SOFT) {
        const end = SENTENCE_END.exec(rest);
        if (end) { add(rest.slice(0, end.index + end[0].length)); newLine(); rest = rest.slice(end.index + end[0].length); continue; }
        if (lineLength >= HARD) {
          const space = rest.indexOf(' ');
          if (space !== -1) { add(rest.slice(0, space + 1)); newLine(); rest = rest.slice(space + 1); continue; }
        }
      }
      add(rest);
      break;
    }
  };
  return {
    append(text) {
      const words = String(text || '');
      if (!words || !box) return;
      const follow = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
      words.split('\n').forEach((part, i) => {
        if (i > 0 || !line) newLine();
        addToLine(part);
      });
      length += words.length;
      if (follow) box.scrollTop = box.scrollHeight;
    },
    get length() { return length; },
  };
}
