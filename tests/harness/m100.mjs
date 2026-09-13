/* M163 — the ripple's rename: a name the ledger already holds. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { readFileSync } from 'node:fs';

/* M163: A RENAME ONTO A NAME THE LEDGER ALREADY HOLDS MERGES THE TWO.
 * rekey wrote out[to] = v flat, so fixing a name the extractor misheard —
 * the commonest ripple there is — silently threw away the REAL person: her
 * page, her standing, her open wound and everything she knew, replaced by
 * the typo's thin entry, with only the take-back to notice it by. */
test('M163: a rename onto an existing name loses nothing', async () => {
  const { renameInState } = await import('../../js/agents/ripple.js');
  const state = {
    characters: {
      Mira: { core: 'the innkeeper, dry and watchful', state: 'behind the bar', arc: 'wary of you', threads: ['owes the ferryman'], updatedAtTurn: 9 },
      Mirela: { core: '', state: 'by the fire', arc: '', threads: ['left her cloak upstairs'], updatedAtTurn: 4 },
    },
    relationships: {
      Mira: { p: 40, r: 0, s: 0, history: [{ atMinutes: 10, axis: 'p', delta: 40, cause: 'the chapel' }] },
      Mirela: { p: 0, r: 15, s: 0, history: [{ atMinutes: 20, axis: 'r', delta: 15, cause: 'the fire' }] },
    },
    bodies: {
      Mira: { injuries: [{ what: 'a split lip', sev: 2, healed: false }], strain: [] },
      Mirela: { injuries: [], strain: [{ what: 'the long climb' }] },
    },
    knowledge: { Mira: [{ fact: 'the ferryman lied' }], Mirela: [{ fact: 'the north road is watched' }] },
    canon: { Mira: { facts: [{ key: 'eyes', value: 'grey' }] }, Mirela: { facts: [{ key: 'hair', value: 'black' }] } },
    offscreen: {}, present: [{ name: 'Mira' }, { name: 'Mirela' }], threads: [], factions: {},
  };
  const { state: a } = renameInState(state, 'Mirela', 'Mira');

  eq(Object.keys(a.characters).join(','), 'Mira', 'one person now');
  eq(a.characters.Mira.core, 'the innkeeper, dry and watchful', 'the standing page keeps its core');
  eq(a.characters.Mira.arc, 'wary of you', 'and its arc');
  eq(a.characters.Mira.threads.length, 2, 'both loose ends are kept');
  eq(a.characters.Mira.updatedAtTurn, 9, 'the newer stamp stands');
  eq(a.relationships.Mira.p, 40, 'a real standing is never wiped by a zero');
  eq(a.relationships.Mira.r, 15, 'and the other axis is carried across');
  eq(a.relationships.Mira.history.length, 2, 'both causes are remembered, in order');
  eq(a.bodies.Mira.injuries.length, 1, 'the open wound survives');
  eq(a.bodies.Mira.strain.length, 1, 'and the strain joins it');
  eq(a.knowledge.Mira.length, 2, 'she knows both things');
  eq(a.canon.Mira.facts.length, 2, 'and both locks stand');
  eq(a.present.length, 1, 'the scene seats her once, not twice');

  /* a rename to a genuinely new name still just moves */
  const { state: b } = renameInState(state, 'Mirela', 'Corvin');
  eq(b.characters.Corvin.state, 'by the fire', 'a plain rename still moves the entry whole');
  assert(b.characters.Mira && b.characters.Mira.core, 'and never touches anyone else');
});

/* M163: EVERY READER OF AN AGE READS PAGES. M162 moved the STAMPS to pages
 * told; these readers were still on state.turn, the write counter, which
 * runs three to five times faster. Measured: a person last written ten
 * pages ago measured thirty and the auditor RETIRED them — card gone,
 * roster line gone — for a law that says thirty pages. */
test('M163: the retirement law counts pages, so nobody is let go early', async () => {
  const { applyMutations } = await import('../../js/engine/apply.js');
  const { emptyState } = await import('../../js/engine/state.js');
  const { peopleHousekeeping, RETIRE_AFTER } = await import('../../js/agents/auditor.js');
  const after = (pages) => {
    let st = emptyState();
    st.page = 0;
    st = applyMutations(st, [{ type: 'people.note', name: 'Mara', field: 'core', text: 'the innkeeper' }]).state;
    for (let p = 1; p <= pages; p += 1) {
      st.page = p;
      st = applyMutations(st, [{ type: 'presence.enter', name: 'Tomas' }]).state;
      st = applyMutations(st, [{ type: 'world.word', brief: { pressure: ['a rider'], ripe: [], twb: null } }]).state;
      st = applyMutations(st, [{ type: 'people.note', name: 'Tomas', field: 'state', text: 'by the door' }]).state;
    }
    return { st, out: peopleHousekeeping(st) };
  };
  const ten = after(10);
  assert(ten.st.turn > 25, 'the write counter has run well ahead (' + ten.st.turn + ')');
  eq(ten.out.length, 0, 'ten pages on, Mara still stands');
  eq(after(RETIRE_AFTER - 1).out.length, 0, 'and one page short of the law');
  const past = after(RETIRE_AFTER + 1);
  eq(past.out.length, 1, 'past the law she retires');
  eq(past.out[0].name, 'Mara', 'and it is her');
});

/* M164: the world agent's "everyone I seat has a page" guard compared the
 * seat's name against the ledger's keys EXACTLY, while people.set resolves
 * near-names. A seat for "Toma" when the ledger holds "Tomas" looked
 * unknown, earned a minimal core, and the applier wrote that stub straight
 * over the smith's real core. */
test('M164: a seat under a near-name never stubs out the page it belongs to', async () => {
  const { findPersonKey } = await import('../../js/engine/people.js');
  const { applyMutations } = await import('../../js/engine/apply.js');
  const { emptyState } = await import('../../js/engine/state.js');
  let st = emptyState();
  st = applyMutations(st, [{ type: 'people.set', name: 'Tomas', field: 'core', text: 'the smith — slow to anger, quicker than he looks' }]).state;

  /* the shape of the guard, as the world agent now asks it */
  const known = new Set(Object.keys(st.characters).map((k) => k.trim().toLowerCase()));
  eq(known.has('toma'), false, 'an exact-key guard calls the near-name unknown');
  eq(findPersonKey(st.characters, 'Toma'), 'Tomas', 'while the applier resolves it to the smith');

  const src = readFileSync(new URL('../../js/agents/world.js', import.meta.url), 'utf8');
  assert(/const hasPage = \(name\) => Boolean\(findPersonKey\(fresh\.characters \|\| \{\}, name\)\);/.test(src), 'the guard asks the applier’s own question');
  assert(!/known\.has\(key\)/.test(src), 'and the exact-key guard is gone');

  /* and the damage it used to do, held as a law */
  const stubbed = applyMutations(st, [{ type: 'people.set', name: 'Toma', field: 'core', text: 'seated by the world agent' }]).state;
  eq(stubbed.characters.Tomas.core, 'seated by the world agent', 'the applier really would write the stub over him — which is why the guard must resolve');
});

/* M164: the live paint re-dressed the WHOLE page every animation frame —
 * every display rule over the whole text, the scene re-parsed, the subtree
 * rebuilt — while the cost of one paint grew with the page. Measured at 6x
 * CPU throttle: 1.6ms at a thousand characters, 16.4ms at twelve thousand,
 * and the writer's storyteller is set to thirty thousand tokens. Over a
 * 91,000-character page: 90 paints and 4,319ms of main thread before,
 * 27 paints and 777ms after — 5.6x less, 3.5 seconds given back. */
test('M164: the live paint keeps a floor of four times what the last one cost', () => {
  const src = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  const at = src.indexOf('const paintLive = () => {');
  assert(at !== -1, 'the live paint still exists');
  const body = src.slice(at, at + 400);
  assert(/paintedAt \+ paintCostMs \* 4/.test(body), 'the floor is four times the last paint’s cost');
  assert(/if \(paintRaf \|\| paintTimer\) return;/.test(body), 'and only one paint is ever in flight');
  assert(/const stopPainting = \(\) => \{[\s\S]{0,220}cancelAnimationFrame\(paintRaf\)/.test(src), 'a stream that falls over stops painting');
  assert(/stopPainting\(\); \/\* M164/.test(src), 'and the error path calls it');

  /* the arithmetic the floor guarantees: paint work can never exceed a
   * fifth of the thread, whatever the page grows to */
  let clock = 0; let cost = 0; let at2 = -1e9; let paints = 0; let work = 0;
  for (let chunk = 0; chunk < 90; chunk += 1) {
    clock += 40;
    if (clock < at2 + cost * 4) continue;
    cost = 0.6 + chunk * 0.55;   /* a paint's cost grows with the page, as measured */
    at2 = clock; paints += 1; work += cost;
  }
  assert(work / clock < 0.25, 'paint work stays under a quarter of the stream’s wall time (' + Math.round(work) + 'ms of ' + clock + 'ms)');
  assert(paints >= 8, 'and the page still visibly grows while it streams (' + paints + ' paints)');
});

/* M165: the people-rebuild's backup was taken unconditionally, so a writer
 * who ran it, disliked what it made, and ran it again saved the REBUILD'S
 * OWN OUTPUT over the hand-written world — and "put the people back" then
 * put back the very thing they were undoing. */
test('M165: a second rebuild never overwrites the way back to the hand-written world', async () => {
  const src = readFileSync(new URL('../../js/agents/rebuild.js', import.meta.url), 'utf8');
  assert(/const hadBackup = await db\.settings\.get\('peopleBackup:' \+ storyId\);/.test(src), 'the standing backup is read first');
  assert(/if \(!\(hadBackup && state\.peopleRebuiltAt\)\) \{/.test(src), 'and a rebuilt world never overwrites it');
  assert(/s = \{ \.\.\.s, peopleRebuiltAt: Date\.now\(\) \};/.test(src), 'a rebuild marks what it made');
  assert(/const \{ peopleRebuiltAt, \.\.\.rest \} = state;/.test(src), 'and putting the people back clears the mark, so the next rebuild may save again');

  /* the mark must survive a save and a load, or the guard is blind */
  const { saveState, loadState } = await import('../../js/engine/state.js');
  const { emptyState } = await import('../../js/engine/state.js');
  await saveState('rebuild-mark', { ...emptyState(), peopleRebuiltAt: 1234 });
  const back = await loadState('rebuild-mark');
  eq(back.peopleRebuiltAt, 1234, 'the mark rides through the ledger’s normalizer');
});

/* M165: a lore key's pattern was compiled from scratch on every scan of
 * every entry, every turn — a 300-entry shelf with five keys each rebuilt
 * fifteen hundred regexes in the send path, where the writer is waiting. */
test('M165: lore keys compile once, and match exactly as before', async () => {
  const { matchLoreDetailed } = await import('../../js/import/lorebook.js');
  const hit = matchLoreDetailed([{ id: 'x', keys: ['Ravenwood'], content: 'The Ravenwood shelf.' }], ['they rode to Ravenwood at dusk'], 3000);
  eq(hit.fired.length, 1, 'a key still fires');
  assert(/Ravenwood shelf/.test(hit.text), 'and brings its content');
  const miss = matchLoreDetailed([{ id: 'x', keys: ['wood'], content: 'nope' }], ['they rode to Ravenwood at dusk'], 3000);
  eq(miss.fired.length, 0, 'the word boundary still holds — "wood" is not inside "Ravenwood"');
  /* the same key twice must give the same answer, cache or no cache */
  const again = matchLoreDetailed([{ id: 'x', keys: ['Ravenwood'], content: 'The Ravenwood shelf.' }], ['they rode to Ravenwood at dusk'], 3000);
  eq(again.fired.length, 1, 'the second scan of the same key answers the same');
  const src = readFileSync(new URL('../../js/import/lorebook.js', import.meta.url), 'utf8');
  assert(/const KEY_RES = new Map\(\);/.test(src) && /KEY_RES_CAP/.test(src), 'the cache exists and is capped');
  assert(/held\.lastIndex = 0;/.test(src), 'and a held pattern never carries a stale position');
});

/* M166: the housekeeper found the journal ids of its own writes by re-reading
 * the ledger and taking the LAST N log entries. A worker of the background
 * chain that saved in that window put its entries at that tail — so the
 * card's take-back would have reversed the extractor's or the world agent's
 * work instead of its own. */
test('M166: an applied mutation carries its own journal id', async () => {
  const { applyMutations } = await import('../../js/engine/apply.js');
  const { emptyState } = await import('../../js/engine/state.js');
  const r = applyMutations(emptyState(), [
    { type: 'presence.enter', name: 'Mara' },
    { type: 'nonsense.type', name: 'x' },
    { type: 'place.set', name: 'the chapel' },
  ]);
  eq(r.applied.length, 2, 'two held, one refused');
  assert(r.applied.every((a) => Number.isInteger(a.jid)), 'each applied entry names its journal id');
  eq(r.applied.map((a) => a.jid).join(','), r.state.log.slice(-2).map((e) => e.jid).join(','), 'and they are the ids the log wrote');

  /* the tail of a re-read log is NOT a safe substitute — a later write moves it */
  const after = applyMutations(r.state, [{ type: 'presence.enter', name: 'Tomas' }]);
  const tail = after.state.log.slice(-2).map((e) => e.jid);
  assert(tail.join(',') !== r.applied.map((a) => a.jid).join(','), 'a later write moves the tail out from under the old ids');

  const src = readFileSync(new URL('../../js/agents/housekeeper.js', import.meta.url), 'utf8');
  assert(/const jids = applied\.map\(\(a\) => a\.jid\)\.filter\(Number\.isInteger\);/.test(src), 'the housekeeper reads its ids off what it applied');
  assert(!/settled\.log\.slice\(-applied\.length\)/.test(src), 'never off the tail of a re-read log');
});

/* M166: every ledger stores its people under their name as an object key,
 * and next['__proto__'] = entry invokes the prototype setter instead of
 * storing anything. A glitch token from a cheap model landed as a page the
 * applier REPORTED as written — words in the log, an undo entry, a line in
 * the journal — while the ledger held nothing: the log and the world
 * disagreed, and the take-back reached for a key that was never there.
 * duels.js hardened its own key writes (safeKey); the ledgers had not. */
test('M166: the magic keys are refused as names, never silently swallowed', async () => {
  const { applyMutations } = await import('../../js/engine/apply.js');
  const { emptyState } = await import('../../js/engine/state.js');
  for (const bad of ['__proto__', 'constructor', 'prototype', '  __PROTO__  ']) {
    const r = applyMutations(emptyState(), [
      { type: 'people.set', name: bad, field: 'core', text: 'a glitch token' },
      { type: 'canon.lock', name: bad, key: 'eyes', value: 'grey' },
      { type: 'presence.enter', name: bad },
    ]);
    eq(r.applied.length, 0, JSON.stringify(bad) + ' is never applied');
    eq(r.rejected.length, 3, JSON.stringify(bad) + ' is refused, plainly, three times');
    eq(r.state.log.length, 0, 'and nothing is written in the log about it');
  }
  /* the scribe's own door too */
  const { mergeDeltas } = await import('../../js/engine/people.js');
  const merged = mergeDeltas({}, {}, [{ name: '__proto__', field: 'core', text: 'x' }], 1);
  eq(merged.changes.length, 0, 'the scribe’s delta is dropped');
  eq(Object.keys(merged.characters).length, 0, 'and the ledger stays empty');
  assert(({}).core === undefined, 'Object.prototype is untouched');

  /* M170: a faction is stored under its name as a key too, and that door
   * took capText, which does not carry the guard — so a faction called
   * "__proto__" was REPORTED as moved while the ledger stored nothing. */
  for (const bad of ['__proto__', 'constructor', 'prototype']) {
    const f = applyMutations(emptyState(), [{ type: 'faction.set', name: bad, stance: 'hostile', move: 'burned the bridge' }]);
    eq(f.applied.length, 0, 'a faction named ' + bad + ' is refused');
    eq(Object.keys(f.state.factions).length, 0, 'and nothing is stored under it');
  }
  const realFaction = applyMutations(emptyState(), [{ type: 'faction.set', name: 'The Ferrymen', stance: 'watchful' }]);
  eq(realFaction.applied.length, 1, 'a real faction still lands');

  /* every door that stores under a NAME goes through the one guard */
  const src = readFileSync(new URL('../../js/engine/apply.js', import.meta.url), 'utf8');
  assert(/const name = capText\(normalizeName\(m\.name\), 80\);/.test(src), 'the faction door uses the name guard');

  /* and a real name is unharmed */
  const ok = applyMutations(emptyState(), [{ type: 'people.set', name: 'Mara', field: 'core', text: 'the innkeeper' }]);
  eq(ok.applied.length, 1, 'a real name still lands');
  eq(ok.state.characters.Mara.core, 'the innkeeper', 'whole');
});

/* M166: startBattle and startWar prepend the main character's unit, but a
 * fight read back from an older save — or restored from one of the
 * referee's own snapshots — may carry allies that never wore isPlayer, and
 * every reader dereferenced the result. `mc.rating` threw out of the whole
 * referee step: the turn failed and the page was never written. */
test('M166: a fight whose allies lost the player mark never throws the turn away', async () => {
  const { resolveBattleRound, resolveWarRound, engineSettings } = await import('../../js/engine/duels.js');
  const eng = engineSettings({});
  const enemy = () => [{ name: 'a raider', rating: 4, poise: 5, injuries: 0, momentum: 0, standing: true }];
  const field = (allies, kind) => ({
    battle: { active: true, over: false, round: 2, domain: 'melee', kind, cmdA: 5, cmdE: 5, allies, enemies: enemy() },
    sheet: {}, mode: { combat: true },
  });

  const noMark = field([{ name: 'Tomas', rating: 5, poise: 5, injuries: 0, momentum: 0, standing: true }]);
  const r = resolveBattleRound(noMark, { kind: 'strike', circumstance: 0, target: 'a raider' }, eng);
  assert(r && r.mcRes, 'the first ally stands in and the round resolves');
  assert(noMark.battle.allies[0].isPlayer === true, 'and is marked, so the next round is steady');

  const empty = field([]);
  const r2 = resolveBattleRound(empty, { kind: 'strike', circumstance: 0 }, eng);
  eq(r2.mcRes, null, 'a field with no allies is not a battle');
  eq(empty.battle.over, true, 'and it closes cleanly instead of throwing');

  const war = field([{ name: 'the left wing', rating: 5, poise: 5, injuries: 0, momentum: 0, standing: true, strength: 10 }], 'war');
  let threw = '';
  try { resolveWarRound(war, { kind: 'command', circumstance: 0 }, eng); } catch (err) { threw = err.message; }
  eq(threw, '', 'and the war round is guarded the same way');

  const src = readFileSync(new URL('../../js/engine/duels.js', import.meta.url), 'utf8');
  assert(!/b\.allies\.find\(\(u\) => u\.isPlayer\)/.test(src), 'no reader looks the player up unguarded');
});

/* M167: every colour in the writer's 🎨 display pack was a hard hex — a
 * near-black header card with near-white type — so on Daylight (and on
 * "follow the sky" through an afternoon) the scene header sat in the
 * parchment room as a black box. Measured in real Chromium, tests/coat.py:
 * card-vs-room luminance gap 0.86 before, 0.02 after; the Lamplight coat is
 * unchanged to the pixel (card rgb(26,26,37) both ways). */
test('M167: the 🎨 pack paints in tokens, so it follows the coat', async () => {
  const src = readFileSync(new URL('../../js/regex-styles.js', import.meta.url), 'utf8');
  /* every hex must sit inside a var() fallback — never bare */
  const bare = [];
  const re = /(.{0,28})#[0-9a-fA-F]{6}/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (!/var\(--pk-[a-z0-9-]+,$/.test(m[1])) bare.push(m[0].slice(-7));
  }
  eq(bare.length, 0, 'no colour is painted bare: ' + [...new Set(bare)].join(', '));
  assert(src.includes('var(--pk-'), 'the pack paints in house tokens');

  /* and every token it names must be defined in BOTH coats */
  const css = readFileSync(new URL('../../css/base.css', import.meta.url), 'utf8');
  const used = [...new Set([...src.matchAll(/var\((--pk-[a-z0-9-]+),/g)].map((x) => x[1]))];
  assert(used.length >= 20, 'the pack names a full palette (' + used.length + ')');
  const light = css.slice(css.indexOf("html[data-theme='light']"));
  const root = css.slice(0, css.indexOf("html[data-theme='light']"));
  for (const token of used) {
    assert(root.includes(token + ':'), token + ' has a lamplight value');
    assert(light.includes(token + ':'), token + ' has a daylight value');
  }
});

/* M168: B19 darkened the light coat's --ember to #8a5205 so it would read as
 * TEXT on parchment — but --on-ember, the ink painted ON that ember, stayed
 * near-black in BOTH coats. So in daylight every primary button — Keep it,
 * Save, and the send button the writer presses every single turn — was dark
 * brown on dark orange, 2.9:1, under AA. Measured in tests/contrast.py. */
test('M168: the ink on the ember turns with the ember, and every coat defines it once', () => {
  const css = readFileSync(new URL('../../css/base.css', import.meta.url), 'utf8');
  const light = css.slice(css.indexOf("html[data-theme='light']"));
  const root = css.slice(0, css.indexOf("html[data-theme='light']"));
  const inkOf = (block) => (block.match(/--on-ember:\s*([^;]+);/g) || []).map((s) => s.split(':')[1].trim().replace(';', ''));
  const dark = inkOf(root);
  const day = inkOf(light);
  eq(dark.length, 1, 'lamplight names the ink once (' + dark.join(', ') + ')');
  eq(day.length, 1, 'daylight names it once too — a second would shadow the first (' + day.join(', ') + ')');
  assert(dark[0] !== day[0], 'and the two coats do not share one ink over two very different embers');

  /* a native <option> takes the UA's ink unless the page says otherwise */
  assert(/^option \{ color: var\(--text\); background: var\(--surface\); \}$/m.test(css), 'an option is painted by the house, not the browser');

  /* the separator dots are quiet, not absent */
  const chat = readFileSync(new URL('../../css/chat.css', import.meta.url), 'utf8');
  const meta = chat.slice(chat.indexOf('.meta-links {'), chat.indexOf('.meta-links {') + 320);
  assert(!/color: var\(--border\);/.test(meta), 'the dots are not painted --border (1.3:1 — absent, not quiet)');
  assert(/color-mix\(in oklab, var\(--muted\)/.test(meta), 'they are a muted mix — there, and quiet');
});

/* M170: M166's name guard was reaching into free text. body.heal matched a
 * weariness by its WORDS through normalizeName — so a hurt whose words held
 * "constructor" or "prototype" could never be healed: a law applied where it
 * does not live. Names are guarded; words are only tidied. */
test('M170: the magic-key guard judges names, never the words of a hurt', async () => {
  const { applyMutations } = await import('../../js/engine/apply.js');
  const { emptyState } = await import('../../js/engine/state.js');
  const words = 'the constructor scaffolding gave way under her';
  let st = applyMutations(emptyState(), [{ type: 'body.strain', name: 'Mara', what: words }]).state;
  const healed = applyMutations(st, [{ type: 'body.heal', name: 'Mara', what: words }]);
  eq(healed.applied.length, 1, 'a hurt whose words hold a magic key still heals');
  eq(healed.state.bodies.Mara.strain.length, 0, 'and it is really gone');
  /* while a PERSON so named is still refused */
  const bad = applyMutations(emptyState(), [{ type: 'body.strain', name: '__proto__', what: 'x' }]);
  eq(bad.applied.length, 0, 'a person named a magic key is still refused');
  const src = readFileSync(new URL('../../js/engine/apply.js', import.meta.url), 'utf8');
  assert(/function tidyWords\(text\)/.test(src), 'free text has a tidier of its own');
  assert(!/const wanted = normalizeName\(typeof m\.what/.test(src), 'and the name guard is off it');
});

/* M171: locate()'s fuzzy anchor walked every window of every length across
 * the page, rebuilt the window's word array each time, counted the overlap
 * in a second inner loop, ran a FULL word-Levenshtein on each survivor —
 * then did the whole thing again for the runner-up. Measured on a desktop:
 * 148ms on a 438-word page, 974ms on a 6,280-word one. Six seconds of a
 * frozen phone for ONE housekeeper card, and a turn can carry several. */
test('M171: the anchor is fast, and answers exactly as it always did', async () => {
  const { locate } = await import('../../js/agents/housekeeper.js');
  const src = readFileSync(new URL('../../js/agents/housekeeper.js', import.meta.url), 'utf8');
  assert(/function wordDistanceBounded\(a, b, bound, from = 0, len = -1\)/.test(src), 'the distance abandons as soon as it cannot matter');
  assert(/if \(rowMin > bound\) return bound \+ 1;/.test(src), 'and gives up by the row');
  assert(/const hCmp = hWords\.map\(\(w\) => w\.cmp\);/.test(src), 'the page’s words are built once, not per window');
  assert(/overlap \+= inNeedle\[i \+ L - 1\] - inNeedle\[i - 1\];/.test(src), 'the overlap rolls instead of recounting');
  assert(/\(b\.sim - a\.sim\) \|\| \(a\.i - b\.i\) \|\| \(a\.L - b\.L\)/.test(src), 'ties break exactly as the old scan broke them — lowest i, then lowest L');
  assert(!/for \(let i = 0; i \+ minLen <= hWords\.length; i \+= 1\) \{\s*for \(let L = minLen[\s\S]{0,400}second/.test(src), 'and the runner-up is found in the same pass, not a second sweep');

  /* the refusals and the anchors it must still give */
  const page = 'She set the cup down on the ledge and said nothing about the ferryman. He waited by the gate in the grey morning until the bell rang twice.';
  eq(locate(page, 'She  set the cup   down on the ledge').via, 'normalized', 'a whitespace-loose match still lands before the fuzzy scan');
  eq(locate(page, 'the bell rang twice').via, 'exact', 'and an exact one before that');
  const near = locate(page, 'He waited by the gate in the grey morning until the bell rang three times');
  assert(near.ok && near.via === 'fuzzy', 'a near passage still anchors: ' + (near.reason || near.via));
  assert(!locate(page, 'the elephants marched over the bridge at noon carrying lanterns').ok, 'and words that are not there are still refused');
});

/* M172: innerBlocks paired the FIRST open tag with the next close and then
 * searched on from just inside it. So a reply that named a block in its own
 * words before writing it — which the system prompt teaches by example, so
 * models do it constantly — was read as TWO blocks: the same op landed as
 * two identical cards (the second either refused or changed the words
 * somewhere else), and the prose open swallowed everything to the real
 * close, so the writer saw "I can do that. I will write an" and nothing
 * more of the housekeeper's explanation. */
test('M172: a close belongs to the nearest open, and the words survive', async () => {
  const { parseProtocol } = await import('../../js/agents/housekeeper.js');

  const named = parseProtocol('I can do that. I will write an <edits> block for the name. Here it is:\n\n<edits>[{"id":"#a1b2c3","find":"Liara","replace":"Mirela","reason":"renamed"}]</edits>\n\nThat should settle it.');
  eq(named.edits.length, 1, 'the op lands ONCE, not twice');
  assert(/That should settle it\./.test(named.text), 'and every word after the block survives');
  assert(/an edits block for the name/.test(named.text), 'the named tag reads as the word it is');
  assert(!/[<>]/.test(named.text), 'no machinery is shown to the writer');

  const two = parseProtocol('<edits>[{"id":"#a","find":"x","replace":"y"}]</edits> and also <edits>[{"id":"#b","find":"p","replace":"q"}]</edits>');
  eq(two.edits.length, 2, 'two real blocks are still two');
  eq(two.edits[1].id, '#b', 'in order');

  /* M75-003 stands: a block the answer was cut off inside is still read */
  const cut = parseProtocol('Here you go:\n<edits>[{"id":"#a1b2c3","find":"Liara","replace":"Mirela"}]');
  eq(cut.edits.length, 1, 'a cut-off block is still read');

  /* and a tag named with no JSON behind it is prose, as it always was */
  const prose = parseProtocol('It would be an <edits> card, but nothing needs changing.');
  eq(prose.edits.length, 0, 'a tag named in passing proposes nothing');
  assert(/It would be an edits card, but nothing needs changing\./.test(prose.text), 'and the sentence reads whole');
});
