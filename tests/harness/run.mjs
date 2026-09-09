/* Cozy Tavern — the in-repo harness (M9, A8).
 * Run it: node tests/harness/run.mjs */
import './stack.mjs';
import './store.mjs';
import './engine.mjs';
import './agents.mjs';
import './referee.mjs';
import './providers.mjs';
import './tablock.mjs';
import './source.mjs';
import './housekeeper.mjs';
import './showrunners.mjs';
import './finishing.mjs';
import './beauty.mjs';
import { runAll } from './lib.mjs';

console.log('Cozy Tavern — harness');
await runAll();
