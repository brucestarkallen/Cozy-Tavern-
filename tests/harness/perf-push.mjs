/* M160: what a push costs on a real shelf. The sync worker exports each
 * changed tale every twenty seconds; before M160 that read EVERY settings
 * row of EVERY tale to find the handful belonging to one. */
import './idb-shim.mjs';
import { db } from '../../js/store.js';

const SHELF = 12;      /* tales on the shelf */
const SNAPS = 120;     /* boundary snapshots per tale (SNAP_CAP) */
const VERSIONS = 60;   /* version ledgers per tale */

function fatLedger(n) {
  const present = [];
  for (let i = 0; i < 8; i += 1) present.push({ name: 'Person ' + i, position: 'by the window', attire: 'a grey coat' });
  const canon = {};
  for (let i = 0; i < 20; i += 1) canon['Person ' + i] = { facts: [{ key: 'eyes', value: 'grey', atMinutes: n }, { key: 'trade', value: 'a smith', atMinutes: n }] };
  const journal = [];
  for (let i = 0; i < 200; i += 1) journal.push({ id: i, p: Math.floor(i / 3), m: { type: 'presence.enter', name: 'Person ' + (i % 8) } });
  return { clock: { minutes: n, label: 'evening' }, present, canon, journal, page: n, log: [] };
}

const ids = [];
for (let t = 0; t < SHELF; t += 1) {
  const st = await db.stories.create({ title: 'Tale ' + t });
  ids.push(st.id);
  for (let m = 0; m < 40; m += 1) await db.messages.append(st.id, { role: m % 2 ? 'assistant' : 'user', text: 'a page of prose '.repeat(40) });
  await db.settings.set('state:' + st.id, fatLedger(t));
  const snaps = [];
  for (let i = 0; i < SNAPS; i += 1) snaps.push({ id: 'turn-' + i, at: i, snap: fatLedger(i) });
  await db.settings.set('snapshots:' + st.id, snaps);
  const versions = {};
  for (let i = 0; i < VERSIONS; i += 1) versions['msg-' + i + ':0'] = fatLedger(i);
  await db.settings.set('versionState:' + st.id, versions);
  await db.settings.set('memory:' + st.id, { nodes: [], window: 30 });
  await db.settings.set('hk:' + st.id, { turns: [] });
}

/* the old way, exactly: read every settings row, keep the ones with this suffix */
const STORY_ROW = (key, set) => { const at = key.lastIndexOf(':'); return at > 0 && set.has(key.slice(at + 1)); };
async function oldExportStory(storyId) {
  const story = await db.stories.get(storyId);
  if (!story) return null;
  const rows = await db.settings.keys().then(async (keys) => {
    const out = [];
    for (const k of keys) out.push({ key: k, value: await db.settings.get(k) });
    return out;
  });
  const mine = rows.filter((r) => STORY_ROW(r.key, new Set([storyId])));
  return JSON.stringify({ story, settings: mine });
}

const time = async (label, fn) => {
  await fn();                       /* warm */
  const t0 = performance.now();
  for (let i = 0; i < 5; i += 1) await fn();
  const ms = (performance.now() - t0) / 5;
  console.log('  ' + label.padEnd(42) + ms.toFixed(1) + ' ms per pushed tale');
  return ms;
};

console.log('A shelf of ' + SHELF + ' tales, each with ' + SNAPS + ' snapshots and ' + VERSIONS + ' version ledgers:');
const before = await time('reading the whole settings store', () => oldExportStory(ids[0]));
const after = await time('reading only this tale\u2019s keys', () => db.exportStory(ids[0]));
console.log('  ' + 'faster by'.padEnd(42) + (before / after).toFixed(1) + '\u00d7  (' + (before - after).toFixed(0) + ' ms saved, per tale, every push)');

/* and the sweep */
await db.stories.remove(ids[0]);
const leftovers = (await db.settings.keys()).filter((k) => k.endsWith(':' + ids[0]));
console.log('\n  rows left behind by a let-go tale:        ' + leftovers.length);
