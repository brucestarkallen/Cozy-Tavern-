/* Who does which quiet work (M17).
 * The house law: any worker may be given its own hands (its own connection) —
 * cheap, quick work can ride a cheap, quick model while the storyteller keeps
 * the best one. Resolution chain: the worker's own pick -> the general
 * workers' pick (M3) -> the connection telling the story (the caller's
 * fallback). Pure and unit-tested; the DOM never comes here. */

export const WORKER_ROWS = [
  ['founder', 'The founder — reads the brief, the cast, the cards and the lore, and writes the world into the ledger before the story begins'],
  ['extractor', 'The ledger reader — writes down what each page changed'],
  ['world', 'The world beyond — simulates everyone the page isn’t showing: the absent where they are, and the people in the scene the page didn’t mention; moves the world by the clock, briefs the storyteller'], /* M407: its row says the whole of what it does (M401) */
  ['scribe', 'The character scribe — keeps every soul true to itself'],
  ['keeper', 'The memory keeper — folds old pages into notes'],
  ['continuity', 'The second reader — quietly flags what drifts'],
  ['auditor', 'The auditor — every few turns, the whole ledger against the brief, the pages and the record'],
  ['referee', 'The referee — rules on contested moments, fast and cold, and weighs the cast it rules from'],
  ['canon', 'Canon verification — reads who is in the scene and writes each canon person’s dossier from the series’ wiki'],
  ['sensors', 'The sensors — read each finished page and answer a few narrow questions about it (a decisions model such as Jev belongs here)'],
  ['planner', 'The planning helper — for a small model: reads the whole story after each page and writes down what the next page needs'],
  ['plans', 'The plans keeper — writes a plan down the moment a page lays it out — who does what, on what signal — and keeps it whole until it is carried out'],
  ['recall', 'The smart recall — before each page, reads your move against the story’s timeline and names the older record lines it means (they ride word for word)'],
  ['choices', 'The choices keeper — Choices matter: at a turning point, writes the two to four choices and seals what each leads to, before you see them'], /* M549 */
  ['essentials', 'The essentials keeper — streamlines your whole record (Summaryception) into the story’s essentials whenever it grows'],
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
