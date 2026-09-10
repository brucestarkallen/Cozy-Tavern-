/* Cozy Tavern — version.js
 * The one and only version number of the house. The service worker's cache
 * name is derived from it (sw.js imports this very constant, so a deploy
 * can't forget to bump the cache — the manual-bump drift ends here), and
 * app.js speaks it to the worker registration.
 *
 * The law: any change to a shipped file bumps VERSION.
 */
export const VERSION = 'm57-003';
