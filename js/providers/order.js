/* Cozy Tavern — providers/order.js
 * M301: ONE ORDER FOR EVERY LIST OF NAMES THE WRITER PICKS FROM — A to Z.
 * The connections were listed in the order they were made, everywhere: the
 * Connections room (a whole card each), the workers' pickers, the story's own
 * storyteller. With a dozen of them nothing could be found without reading
 * the lot. byName() is the display order and ONLY the display order:
 * db.connections.list() stays in the order they were made, because three
 * resolvers fall back to "the first one" and must not start choosing a
 * different connection because a name begins with A.
 *
 *   byName(rows, nameOf?)  → a new array, A to Z: case and accents ignored,
 *                            numbers in number order ("GLM 5" before "GLM 10"),
 *                            ties in the order they were made. */
const collator = (() => {
  try { return new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }); } catch (err) { return null; }
})();
const compareWords = (a, b) => (collator ? collator.compare(a, b) : (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0));

export function byName(rows, nameOf = (row) => (row && row.label)) {
  return (Array.isArray(rows) ? rows : [])
    .map((row, at) => ({ row, at, name: String(nameOf(row) ?? '').trim() }))
    .sort((x, y) => compareWords(x.name, y.name) || ((x.row && x.row.createdAt) || 0) - ((y.row && y.row.createdAt) || 0) || x.at - y.at)
    .map((x) => x.row);
}
