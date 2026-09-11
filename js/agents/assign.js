/* Who does which quiet work (M17).
 * The house law: any worker may be given its own hands (its own connection) —
 * cheap, quick work can ride a cheap, quick model while the storyteller keeps
 * the best one. Resolution chain: the worker's own pick -> the general
 * workers' pick (M3) -> the connection telling the story (the caller's
 * fallback). Pure and unit-tested; the DOM never comes here. */

export const WORKER_ROWS = [
  ['founder', 'The founder — reads the brief, the cast, the cards and the lore, and writes the world into the ledger before the story begins'],
  ['extractor', 'The ledger reader — writes down what each page changed'],
  ['world', 'The world beyond — keeps the absent alive, moves the world by the clock, briefs the storyteller'],
  ['scribe', 'The character scribe — keeps every soul true to itself'],
  ['keeper', 'The memory keeper — folds old pages into notes'],
  ['continuity', 'The second reader — quietly flags what drifts'],
  ['auditor', 'The auditor — every few turns, the whole ledger against the brief, the pages and the record'],
  ['referee', 'The referee — rules on contested moments, fast and cold'],
  ['showrunner', 'The showrunners — the director and the editor'],
  ['housekeeper', 'The housekeeper — the one you talk to, who tidies everything'],
];

/* map: settings.workerConnections ({worker: connectionId}); legacy: the M3
 * general workers' pick; connections: all saved connections.
 * Returns the connection the worker should use, or null when none chosen
 * (the caller then falls back to the story's connection). */
export function pickWorkerConnection({ map = {}, legacy = null, connections = [] }, worker) {
  /* The chain, with graceful degradation: the worker's own pick (a stale id —
   * a deleted connection — degrades rather than shadows), then the general
   * workers' pick, then null so the caller falls back to the storyteller. */
  const own = map && map[worker];
  if (own) {
    const hit = connections.find((c) => c.id === own);
    if (hit) return hit;
  }
  if (legacy) return connections.find((c) => c.id === legacy) || null;
  return null;
}
