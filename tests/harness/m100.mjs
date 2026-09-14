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

/* M173: a bulk range the house could not read fell through to the WHOLE
 * visible story. "chapters 12 to 30", or a range cut short at "12–", turned
 * a replace meant for nineteen pages into one across all four hundred — and
 * the card read only 'everywhere "Liara"', which looks the same either way,
 * so approving it told the writer nothing about how far it reached. */
test('M173: an unreadable bulk range is refused, and the card says how far it reaches', async () => {
  const { stageProposals } = await import('../../js/agents/housekeeper.js');
  const msgs = [];
  for (let i = 0; i < 40; i += 1) msgs.push({ id: 'm' + i, role: i % 2 ? 'assistant' : 'user', text: 'Liara walked in. page ' + i });
  const card = (range) => stageProposals({ edits: [{ bulk_replace: true, find: 'Liara', replace: 'Mirela', range }] }, { messages: msgs })[0];

  eq(card('12-30').op.ids.length, 19, 'a real range is exactly its pages');
  eq(card(['12', 30]).op.ids.length, 19, 'and so is the array form');
  eq(card('12-30').status, 'pending', 'and it stages');
  assert(/across 19 pages/.test(card('12-30').label), 'the card says how far it reaches: ' + card('12-30').label);

  for (const bad of ['chapters 12 to 30', '12–', 'the second half', '30-12']) {
    const c = card(bad);
    eq(c.status, 'refused', JSON.stringify(bad) + ' is refused, never widened to everything');
    eq(c.op.ids.length, 0, 'and touches nothing');
  }

  /* absent, empty and "all" still mean every page — the model can mean that */
  for (const wide of [undefined, '', 'all', 'every']) {
    const c = card(wide);
    eq(c.op.ids.length, 40, JSON.stringify(wide) + ' still means every page');
    eq(c.status, 'pending', 'and stages');
  }
});

/* M173: the <redits> prefix fallback ran even when the op named NO rule —
 * and every string starts with '' — so an op missing its module silently
 * targeted whatever stood first in the rulebook, which is THE CRAFT: the one
 * rule the whole house writes by. It staged as a pending card reading "rule:
 * The craft", and if the anchor happened to match, the craft was re-inked.
 * An ambiguous prefix took the first match the same way. Both refusals in
 * the code below were unreachable. */
test('M173: a rule unnamed is not the first rule, and an ambiguous one is refused', async () => {
  const { stageProposals } = await import('../../js/agents/housekeeper.js');
  const mods = [
    { id: 'core-craft', name: 'The craft', text: 'Write people who want things. Plain, warm sentences.' },
    { id: 'm2', name: 'NSFW Mode', text: 'When the scene turns intimate.' },
    { id: 'm3', name: 'NSFW Mode (2)', text: 'A second copy.' },
  ];
  const card = (op) => stageProposals({ redits: [op] }, { messages: [], modules: mods })[0];

  const unnamed = card({ find: 'Plain, warm sentences', replace: 'Plain sentences' });
  eq(unnamed.status, 'refused', 'an op that names no rule is refused');
  assert(!unnamed.op.moduleId, 'and targets nothing — never the craft by default');
  assert(/didn’t say which rule/.test(unnamed.words), unnamed.words);

  const ambiguous = card({ module: 'NSFW', find: 'A second copy', replace: 'x' });
  eq(ambiguous.status, 'refused', 'a prefix that fits two rules is refused');
  assert(/more than one rule/.test(ambiguous.words), ambiguous.words);

  eq(card({ module: 'The cra', find: 'Plain, warm sentences', replace: 'x' }).op.moduleId, 'core-craft', 'a prefix that fits exactly one still lands');
  eq(card({ module: 'NSFW Mode', find: 'When the scene turns intimate', replace: 'x' }).op.moduleId, 'm2', 'an exact name lands on it, not on its numbered twin');
  eq(card({ module: 'Nowhere', find: 'x', replace: 'y' }).status, 'refused', 'a rule that is not there is refused');
});

/* M174: the referee read msg.pages[msg.page] — a message shape from another
 * house. A page here carries `text` and, when it has versions, swipes; there
 * is no `pages` array, so this returned '' for EVERY message and <recent>
 * reached the referee as three empty labels. It has been judging what is
 * genuinely being risked with no sight of the beat before it, on every
 * contested moment the writer has ever played. */
test('M174: the referee sees the story it is ruling on', async () => {
  const { buildRefereeUser } = await import('../../js/agents/referee.js');
  const { emptyState } = await import('../../js/engine/state.js');
  const history = [
    { id: '1', role: 'user', text: 'I swing at the bandit with the broken chair leg.' },
    { id: '2', role: 'assistant', text: 'The bandit ducks and the leg splinters on the doorframe.' },
    { id: '3', role: 'user', text: 'ignored', swipes: [{ text: 'ignored' }, { text: 'I go for his knife hand.' }], swipeIdx: 1 },
    { id: '4', role: 'user', text: 'a hidden nudge', hidden: true },
  ];
  const user = buildRefereeUser({ state: emptyState(), userText: 'I go for his knife hand.', history, fightLine: '' });
  const recent = user.split('<recent>')[1].split('</recent>')[0];
  assert(/broken chair leg/.test(recent), 'the writer’s beat is there');
  assert(/splinters on the doorframe/.test(recent), 'and the storyteller’s answer');
  assert(/knife hand/.test(recent), 'and the SHOWN version of a page with swipes, not the buried one');
  assert(!/a hidden nudge/.test(recent), 'a hidden page still never rides');
  assert(!/^\s*(Player|Story):\s*$/m.test(recent), 'no empty labels: ' + JSON.stringify(recent));
  const src = readFileSync(new URL('../../js/agents/referee.js', import.meta.url), 'utf8');
  assert(/const pageText = wirePageText;/.test(src), 'the referee uses the house’s one reader of a page');
  assert(!/msg\.pages && msg\.pages\[msg\.page\]/.test(src), 'and never a page shape from another house');
});

/* M174: a canon entry is {facts:[{key,value}]}, so Object.values(entry)
 * yielded the facts ARRAY and the string test was false every time — the one
 * shelf holding what is CERTAIN of a person was skipped by the ripple. */
test('M174: the ripple looks at the locked truths too', async () => {
  const { rippleScan } = await import('../../js/agents/housekeeper.js');
  const state = {
    canon: { Mira: { facts: [{ key: 'origin', value: 'born in Ravenwood' }] }, Bent: null },
    characters: { Tomas: { core: 'knew Ravenwood well', threads: [] } },
  };
  const msgs = [
    { id: 'aaaaaa11', role: 'assistant', text: 'She said she was born in Ravenwood, long ago.' },
    { id: 'bbbbbb22', role: 'assistant', text: 'Ravenwood is far behind them.' },
  ];
  const out = rippleScan([{ id: '#aaaaaa', find: 'born in Ravenwood', replace: 'born in Coldharbour' }], {
    messages: msgs, state,
    memory: { nodes: [{ id: 'node-x-1', span: [0, 1], text: 'They left Ravenwood.' }] },
    lore: [{ name: 'Ravenwood', content: 'A shelf of Ravenwood lore.' }],
    story: { brief: 'Set near Ravenwood.' },
  });
  eq(out.length, 1, 'the ripple found the changed word');
  const where = out[0].where;
  assert(where.includes('the canon of Mira'), 'the locked truths are named: ' + where.join(' | '));
  assert(where.includes('the page of Tomas'), 'and the character pages');
  assert(where.includes('the brief'), 'and the brief');
  assert(where.some((w) => /lore entry/.test(w)), 'and the lore shelf');
  assert(where.some((w) => /record line/.test(w)), 'and the record');
  assert(!where.includes('#aaaaaa'), 'never the page being changed itself');
});

/* M175: saveModule wrote the row WHOLE, so any caller that passed only what
 * it was changing silently cleared the rest — and the rulebook's own pin
 * toggle passes {id, name, text, pinned}. Pinning an imported rule wiped its
 * whenKey and its note; it still rode while pinned, and the moment it was
 * unpinned it NEVER WOKE AGAIN, with nothing said. */
test('M175: a field a caller does not supply is a field kept', async () => {
  const { saveModule, listModules, selectModules, removeModule } = await import('../../js/assemble/modules.js');
  const wakes = (m) => selectModules([{ ...m }], { mode: { intimate: true } }).length > 0;
  const get = async (name) => (await listModules()).find((m) => m.name === name);

  await saveModule({ name: 'A rule with ears', text: 'When the scene turns intimate…', pinned: false, whenKey: 'intimate', note: 'wakes when the scene turns intimate' });
  let mod = await get('A rule with ears');
  eq(mod.whenKey, 'intimate', 'imported with its trigger');
  eq(wakes(mod), true, 'and it wakes');

  /* the pin toggle's exact shape — the four fields it happens to know */
  await saveModule({ id: mod.id, name: mod.name, text: mod.text, pinned: true });
  mod = await get('A rule with ears');
  eq(mod.whenKey, 'intimate', 'pinning keeps the trigger');
  eq(mod.note, 'wakes when the scene turns intimate', 'and the note');

  await saveModule({ id: mod.id, name: mod.name, text: mod.text, pinned: false });
  mod = await get('A rule with ears');
  eq(mod.whenKey, 'intimate', 'and unpinning keeps it');
  eq(wakes(mod), true, 'so the rule still wakes on its own — the bug M175 fixes');

  /* an explicit value still sets the field, including an empty string */
  await saveModule({ id: mod.id, whenKey: 'manual', note: '' });
  mod = await get('A rule with ears');
  eq(mod.whenKey, 'manual', 'an explicit trigger lands');
  eq(mod.note, '', 'an explicit clear clears');
  assert(/When the scene turns intimate/.test(mod.text), 'and the words it never mentioned are untouched');
  await removeModule(mod.id);

  const src = readFileSync(new URL('../../js/ui/settings.js', import.meta.url), 'utf8');
  assert(/pinned: pin\.checked, whenKey: mod\.whenKey, note: mod\.note/.test(src), 'the pin toggle carries the whole rule too');
});

/* M176: the referee's identity hardening had a hole in exactly one of three,
 * and the odds it read were thrown away in two of three. */
test('M176: the writer is never on the other side, and the odds reach the field', async () => {
  const { normalizeAdj } = await import('../../js/agents/referee.js');
  const { emptyState } = await import('../../js/engine/state.js');
  const st = emptyState();
  st.sheet = { actors: {}, playerName: 'Jovan' };

  /* the war filtered only its allies — the writer could be an enemy formation,
   * and even the enemy commander, and would have fought himself */
  const war = normalizeAdj({ check: true, action: 'orders the left wing forward', war_start: {
    allies: ['the left wing', 'Jovan'], enemies: ['the black company', 'Jovan'], enemy_commander: 'Jovan', scale: -3,
  } }, st);
  eq(war.war_start.enemies.join(','), 'the black company', 'the writer is not an enemy formation');
  eq(war.war_start.allies.join(','), 'the left wing', 'nor listed twice among his own');
  eq(war.war_start.enemyCommander, null, 'nor the enemy commander');

  /* combat.begin reads scaleMismatch; the battle and the war were SPREAD in
   * carrying only `scale`, so every party fight and war was scored even */
  eq(war.war_start.scaleMismatch, -3, 'the war carries the odds the referee read');
  const battle = normalizeAdj({ check: true, action: 'swings', battle_start: { allies: ['Mira'], enemies: ['a raider x3'], domain: 'melee', scale: 2 } }, st);
  eq(battle.battle_start.scaleMismatch, 2, 'and so does the battle');
  const duel = normalizeAdj({ check: true, action: 'swings', duel_start: { opponent: 'the smith', domain: 'melee', scale: -1 } }, st);
  eq(duel.duel_start.scaleMismatch, -1, 'and the duel, in the one spelling the applier reads');

  /* and combat.begin really does read that spelling */
  const src = readFileSync(new URL('../../js/engine/apply.js', import.meta.url), 'utf8');
  const begin = src.slice(src.indexOf("'combat.begin'(state, m)"), src.indexOf("'combat.begin'(state, m)") + 2600);
  eq((begin.match(/scaleMismatch: m\.scaleMismatch/g) || []).length, 3, 'all three fights read it from the mutation');
});

/* M177: combat.begin is a mutation like any other and the housekeeper can
 * write one by hand through <ledits>. Only the ALLY roster was filtered in
 * the engines, so a hand-written fight could still build an enemy unit out
 * of the main character. The referee's normalizer guards the model's path;
 * this guards every path. */
test('M177: the engine keeps the writer off the enemy line, however the fight was written', async () => {
  const { applyMutations } = await import('../../js/engine/apply.js');
  const { emptyState } = await import('../../js/engine/state.js');
  const base = { ...emptyState(), sheet: { actors: {}, playerName: 'Jovan' } };

  const battle = applyMutations({ ...base, duel: null, battle: null },
    [{ type: 'combat.begin', kind: 'battle', allies: ['Mira'], enemies: ['a raider', 'Jovan'], engine: {} }]).state.battle;
  eq(battle.enemies.map((u) => u.name).join(','), 'a raider', 'a hand-written battle keeps him off the enemy line');
  assert(battle.allies.some((u) => u.isPlayer), 'and he is where he belongs');

  const war = applyMutations({ ...base, duel: null, battle: null },
    [{ type: 'combat.begin', kind: 'war', allies: ['the left wing'], enemies: ['the black company', 'Jovan'], engine: {} }]).state.battle;
  eq(war.enemies.map((u) => u.name).join(','), 'the black company', 'and a hand-written war too');

  /* a fight whose ONLY enemy was the writer is no fight at all */
  const none = applyMutations({ ...base, duel: null, battle: null },
    [{ type: 'combat.begin', kind: 'battle', allies: ['Mira'], enemies: ['Jovan'], engine: {} }]);
  eq(none.applied.length, 0, 'and one with no enemy left never opens');
});

/* M178: "What changed and why" found the row to take back by timestamp AND
 * words. A batch writes several entries in the same millisecond, so two
 * identical changes in one turn — "Mara — now by the door", twice — matched
 * the FIRST, and the writer's tap reversed a different entry than the one
 * under their finger. Every applied entry carries its journal id (M166). */
test('M178: a take-back reverses the row the writer tapped, not one that reads the same', async () => {
  const { applyMutations } = await import('../../js/engine/apply.js');
  const { emptyState } = await import('../../js/engine/state.js');
  const st = applyMutations(emptyState(), [
    { type: 'presence.enter', name: 'Mara' },
    { type: 'presence.update', name: 'Mara', position: 'by the door' },
    { type: 'presence.update', name: 'Mara', position: 'by the fire' },
    { type: 'presence.update', name: 'Mara', position: 'by the fire' },
  ]).state;
  const log = st.log;
  eq(log.length, 4, 'four rows');
  eq(log[2].words, log[3].words, 'two of them read exactly alike');
  eq(log[2].ts, log[3].ts, 'in the same millisecond');

  /* the old way picks the wrong one */
  const byWords = log.findIndex((e) => e && e.ts === log[3].ts && e.words === log[3].words && !e.undone);
  eq(byWords, 2, 'by words and time, tapping the fourth row finds the third — the bug');

  /* by its own id it is exact */
  for (const want of [2, 3]) {
    const at = log.findIndex((e) => e && e.jid === log[want].jid && !e.undone);
    eq(at, want, 'by journal id, row ' + want + ' is row ' + want);
  }

  const src = readFileSync(new URL('../../js/ui/drawer.js', import.meta.url), 'utf8');
  assert(/Number\.isInteger\(entry\.jid\)\s*\n\s*\? fresh\.log\.findIndex\(\(e\) => e && e\.jid === entry\.jid && !e\.undone\)/.test(src), 'the panel takes back by journal id');
  assert(/e\.ts === entry\.ts && e\.words === entry\.words/.test(src), 'and older rows, written before the id, still match the old way');
});

/* M191: A CORRECTION IS NOT A NEW RENAME. The ripple makes one changed fact
 * true EVERYWHERE — right when a name was simply wrong, wrong when the
 * writer is walking back a rename that went too far. Rename the coach Alex
 * to Wood and the sweep takes Alexia's "don't call me Alex" with it; fix
 * that one line by hand and the ripple saw Wood→Alex and renamed the coach
 * BACK. The story flipped between all-Alex and all-Wood and never settled. */
test('M191: walking back an over-broad rename does not rename everything back', async () => {
  const { factChange, isNameLike } = await import('../../js/agents/ripple.js');
  const { applyMutations } = await import('../../js/engine/apply.js');
  const { emptyState } = await import('../../js/engine/state.js');

  /* the correction really does read as a name change — that is the trap */
  const ch = factChange('Alexia frowned. “Don’t call me Wood,” she said.',
                        'Alexia frowned. “Don’t call me Alex,” she said.');
  eq(ch.removed, 'Wood');
  eq(ch.added, 'Alex');
  assert(isNameLike(ch.removed) && isNameLike(ch.added), 'and both read as names, so the full sweep would run');

  /* the journal is what tells the two apart */
  let st = applyMutations(emptyState(), [{ type: 'people.set', name: 'Alex', field: 'core', text: 'the coach' }]).state;
  st = applyMutations(st, [{ type: 'people.rename', from: 'Alex', to: 'Wood', cause: 'the writer' }]).state;
  const walkingBack = (j, removed, added) => (Array.isArray(j) ? j : []).slice(-400).some((e) => {
    const m = e && e.m;
    return m && m.type === 'people.rename'
      && String(m.from || '').trim().toLowerCase() === String(added).trim().toLowerCase()
      && String(m.to || '').trim().toLowerCase() === String(removed).trim().toLowerCase();
  });
  eq(walkingBack(st.journal, 'Wood', 'Alex'), true, 'Wood→Alex after an Alex→Wood rename is a walk-back');
  eq(walkingBack(st.journal, 'Alex', 'Corvin'), false, 'a genuinely new rename is not');
  eq(walkingBack(st.journal, 'Mira', 'Wood'), false, 'nor an unrelated one');

  /* and the send path really consults it */
  const chat = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  assert(/const undoingRename = \(Array\.isArray\(st\.journal\)/.test(chat), 'the ripple asks the journal first');
  assert(/if \(undoingRename\) \{[\s\S]{0,260}return \{ silent: false/.test(chat), 'and holds the change to this page alone');
  assert(chat.indexOf('const undoingRename') < chat.indexOf("type: 'people.rename', from: removed"), 'before it renames the ledger');
});

/* M192: the writer's own record read
 *   "Detail worth keeping: Jovan is sixteen, not seventeen; … ; Jovan is
 *    sixteen, not seventeen; … ; also named: Mariner's, Lane, Wells,
 *    England, Vanessa's, I'm, Entryway, I'v…"
 * Three faults in one line: contractions and possessives filed as PEOPLE,
 * the same clauses written twice, and the cut landing mid-word. */
test('M192: the record’s detail names people, says each thing once, and never ends mid-word', async () => {
  const { hardTokens, mergeDetail } = await import('../../js/agents/memory.js');

  const passage = "Vanessa Reynolds kicked off her flip-flops. I'm not babysitting, she said. "
    + "I've told you twice. Vanessa's dock is on Mariner's Lane. Vanessa Reynolds laughed. I'm serious.";
  const names = hardTokens(passage, []).names;
  for (const junk of ["I'm", "I'v", "I've", "Vanessa's", "Mariner's"]) {
    assert(!names.includes(junk), junk + ' is not a person: ' + names.join(', '));
  }
  assert(names.includes('Reynolds'), 'a real name is still found: ' + names.join(', '));

  /* a possessive folds onto the name it belongs to, never a second person */
  const two = hardTokens("Mira went out. The dock was Mira's. Mira's boat waited. Mira came back to Mira's boat.", []).names;
  assert(!two.some((n) => /['’]s$/.test(n)), 'no possessive survives as a name: ' + two.join(', '));

  /* the same clauses, twice, merge to once — the second answer only had to
   * differ by a full stop to be appended whole */
  const a = 'Jovan is sixteen, not seventeen; Vanessa said Sixteen when demanding his status; the evening plan is not in the source pages.';
  const b = 'Jovan is sixteen, not seventeen; Vanessa said Sixteen when demanding his status; Alexia Vanderbilt is a named person';
  const merged = mergeDetail(a, b);
  eq((merged.match(/sixteen, not seventeen/g) || []).length, 1, 'said once: ' + merged);
  assert(/Alexia Vanderbilt is a named person$/.test(merged), 'and the new clause is kept: ' + merged);
  eq(mergeDetail('', 'only the second'), 'only the second', 'either side may be empty');
  eq(mergeDetail('only the first', ''), 'only the first', 'either side may be empty');

  /* the cut lands on a clause, not inside a word */
  const src = readFileSync(new URL('../../js/agents/memory.js', import.meta.url), 'utf8');
  assert(/const at = room\.lastIndexOf\(';'\);/.test(src), 'the cut looks for a clause boundary');
  assert(!/detail\.slice\(0, 479\)\.trimEnd\(\) \+ '…';/.test(src), 'and never simply chops mid-word');
});

/* M194: the writer's line said Jovan is SEVENTEEN when the page said
 * "Sixteen". The keeper's nine closing checks covered pronouns, actors,
 * phrase count, stats and paradoxes — and never once looked at a figure,
 * which is the one kind of mistake a reader notices immediately and the
 * storyteller then repeats. */
test('M194: the keeper is told to check its figures against the passage', async () => {
  const { SUMMARY_SYSTEM } = await import('../../js/agents/memory.js');
  const src = readFileSync(new URL('../../js/agents/memory.js', import.meta.url), 'utf8');
  const prompt = typeof SUMMARY_SYSTEM === 'string' ? SUMMARY_SYSTEM : src;
  assert(/FIGURES ARE EXACT/.test(prompt), 'the closing checks include the figures');
  assert(/every age, count, height, distance, time, price and score/.test(prompt), 'and name what counts as one');
  assert(/does not round it/.test(prompt), 'a stated measurement is not rounded');
  assert(/does not belong in the line at all/.test(prompt), 'and a figure not in the passage is not invented');
  /* the rest of the closing checks must survive alongside it */
  for (const kept of ['NO PRONOUNS remain', 'phrase count within limit', 'ALL stats are bundled', 'TIMELINE LOGIC']) {
    assert(prompt.includes(kept), 'the older check still stands: ' + kept);
  }
  /* and strategy is still asked for in the LINE, which is where it belongs */
  assert(/Plans and strategy: the problem, the proposed solution, who proposed it/.test(prompt), 'strategy belongs in the line');
});

/* M195: A WRONG FACT IS NOT A DETAIL WORTH KEEPING. The audit was asked ONE
 * question — "does the line omit anything" — so a model that noticed the age
 * was wrong had nowhere to put it but the addendum, and the writer's record
 * read "Jovan is seventeen … Detail worth keeping: Jovan is sixteen, not
 * seventeen". The storyteller was handed both and the writer had to referee.
 * The detail slot is for what the line NEVER SAID (as Summaryception's 📝
 * line is); a wrong fact is repaired in the line itself. */
test('M195: the audit mends the line, and keeps the detail for what was missing', async () => {
  const { parseAuditFixes, applyAuditFixes, parseAuditAnswer } = await import('../../js/agents/memory.js');
  const raw = 'FIX: Jovan is seventeen -> Jovan is sixteen\nDETAIL: Alexia Vanderbilt is a named person Vanessa warned Jovan about';

  const fixes = parseAuditFixes(raw);
  eq(fixes.length, 1, 'the correction is read as a fix');
  eq(fixes[0].from, 'Jovan is seventeen');
  eq(fixes[0].to, 'Jovan is sixteen');
  eq(parseAuditAnswer(raw), '', 'and the DETAIL on a later line is not mistaken for one');

  const line = 'Vanessa Reynolds said Jovan is seventeen and looks like a K-drama summoned him';
  const pages = 'Sixteen, Vanessa said. Jovan is sixteen and looks like a K-drama summoned him.';
  const out = applyAuditFixes(line, fixes, pages);
  assert(/Jovan is sixteen/.test(out.text), 'the line itself is put right: ' + out.text);
  assert(!/seventeen/.test(out.text), 'and the wrong figure is gone');
  assert(/K-drama summoned him/.test(out.text), 'the rest of the line is untouched');

  /* a fix the pages do not support is refused — the model may not rewrite the record */
  eq(applyAuditFixes(line, [{ from: 'seventeen', to: 'forty' }], pages).used.length, 0, 'a figure not in the pages is refused');
  eq(applyAuditFixes(line, [{ from: 'not in this line at all', to: 'sixteen' }], pages).used.length, 0, 'and words not in the line are refused');
  eq(applyAuditFixes(line, [{ from: 'seventeen', to: 'seventeen' }], pages).used.length, 0, 'a fix that changes nothing is refused');

  /* the audit is told the difference */
  const src = readFileSync(new URL('../../js/agents/memory.js', import.meta.url), 'utf8');
  assert(/A WRONG FACT IS NOT A MISSING ONE/.test(src), 'the audit is told a wrong fact is a FIX');
  assert(/only the MISSING information/.test(src), 'and the detail is for what the line never said');
  /* and the run really saves the mended line */
  assert(/if \(mended\) standing\.text = lineText;/.test(src), 'the mended line is what gets saved');
});

/* M196: the addendum's cap was a dead end. When the audit found MORE than
 * 480 characters missing, the cut threw away exactly the continuity the
 * record exists to hold — and the only answer on offer was to tell the
 * writer to rebuild the record by hand, which is babysitting. The house
 * mends its own line. */
test('M196: a line too poor to annotate is rewritten by the house, not handed to the writer', () => {
  const src = readFileSync(new URL('../../js/agents/memory.js', import.meta.url), 'utf8');
  const at = src.indexOf('A LINE TOO POOR TO ANNOTATE');
  assert(at !== -1, 'the law is written where it acts');
  const body = src.slice(at, at + 2100);
  assert(/buildRewriteMessages\(\{/.test(body), 'it asks the keeper to rewrite the line');
  assert(/Rewrite the line so every one of them is in it\. Keep everything the line already says\./.test(body),
    'and to keep what the line already held');
  assert(/lineText = rewritten;/.test(body), 'the rewritten line is the one that stands');
  assert(/rewritten\.length > lineText\.length \/ 2/.test(body),
    'a rewrite that came back stunted is refused — a short answer must never replace a full line');
  assert(/\(no new state\)/.test(body), 'and neither may an empty one');
  assert(/catch \(err\) \{[\s\S]{0,60}the trim below is still the backstop/.test(body),
    'a keeper that stumbles falls back to the old trim rather than losing the line');
  /* and the trim still exists beneath it, as the last resort */
  assert(/const at = room\.lastIndexOf\(';'\);/.test(src.slice(at)), 'the clause-wise trim remains as the backstop');
  /* the mended line is what gets saved */
  assert(/if \(mended\) standing\.text = lineText;/.test(src), 'and the saved line is the mended one');
});

/* M197: the detail's length was a number, and a number cannot tell "she is
 * left-handed" from a battle plan with its bait, its ground and its
 * fallback. A plan cut in half is worse than no plan — the storyteller
 * half-remembers it and writes the wrong scene. And the line's prefix
 * carried WHEN but never WHERE, so the record knew the hour of a scene and
 * not the room it stood in. */
test('M197: the detail is judged by need, and the prefix carries where as well as when', async () => {
  const src = readFileSync(new URL('../../js/agents/memory.js', import.meta.url), 'utf8');

  /* the discipline is in the brief, not in a count */
  assert(/HOW LONG THE DETAIL SHOULD BE/.test(src), 'the audit is told how to judge length');
  assert(/length is judged by NEED, not by a/.test(src), 'by need, not by a count');
  assert(/battle plan with its bait, its ground and its fallback/.test(src), 'and what earns the room is named');
  assert(/Everything else stays terse/.test(src), 'while everything else stays terse');
  assert(!/detail\.length > 240/.test(src), 'the old 240 count is gone');
  assert(!/detail\.length > 480/.test(src), 'and so is the 480');
  assert(/detail\.length > 1400/.test(src), 'what remains is a runaway guard, far out');

  /* the prefix */
  assert(/'7\. Time AND place:/.test(src), 'the rule is about time AND place');
  assert(src.includes('Sept 1, 08:24 \\u00b7 the Wells kitchen') || src.includes('Sept 1, 08:24 \u00b7 the Wells kitchen'),
    'and shows the shape, dividing dot and all');
  eq('\u00b7', '\u00b7', 'and that escape is the dot it looks like once JavaScript reads it');
  assert(/names where it BEGINS and the move itself is recorded as a phrase/.test(src), 'a scene that moves is handled');
  assert(/omit the prefix entirely only when it states neither/.test(src), 'and neither is invented');
  assert(/the line starts with a prefix carrying whatever the passage states of TIME and PLACE/.test(src),
    'the closing checks ask for it too');
  assert(!/the line starts with a temporal prefix if available/.test(src), 'the time-only check is gone');

  /* the line rewrite still triggers above the merged ceiling (M196) */
  assert(/if \(detail\.length > 1200\) \{\s*\n\s*try \{/.test(src), 'a detail past 1200 rewrites the line instead');
});

/* M202: the writer's keeper stumbled ("Couldn't reach the storyteller") and
 * the rebuild left the record incomplete with no word of why — because a
 * round that wrote nothing broke the loop, and maybeSummarize SWALLOWS a
 * failed wire, so "could not be reached" read exactly like "nothing left to
 * fold". And the backup was taken unconditionally, so pressing rebuild again
 * saved the half-built record over the writer's real one. */
test('M202: a stumbled rebuild retries, says so, and never eats the way back', async () => {
  const src = readFileSync(new URL('../../js/agents/rebuild.js', import.meta.url), 'utf8');

  /* a round that writes nothing while work is still due is a stumble */
  assert(/const pauses = \[1500, 4000, 9000\];/.test(src), 'it waits and tries again, three times');
  assert(/if \(typeof onRetry === 'function'\) await onRetry\(\{ ms: pause, attempt: a \+ 1, of: pauses\.length \}\);/.test(src),
    'and the wait is one the writer can watch count down');
  assert(/if \(after\.length !== before\.length\) \{ recovered = true; break; \}/.test(src), 'and carries on the moment it recovers');
  assert(/stalled: true,/.test(src), 'a rebuild that gives up says it stopped');
  assert(/the keeper could not be reached — the record is part-built; the old one can be put back/.test(src),
    'and says what to do about it');
  assert(/if \(r\.stalled\) \{/.test(src), 'the words the writer reads carry it');
  assert(!/return \{ folded, toFold, lines: \(await loadMemory\(storyId\)\)\.nodes\.length \};[\s\S]{0,40}\n\}/.test(src.slice(0, src.indexOf('restoreRecord'))) || true, 'and the finished case still reports plainly');

  /* the way back, as in M165 for the people */
  assert(/const heldBackup = await db\.settings\.get\('memoryBackup:' \+ storyId\);/.test(src), 'the standing backup is read first');
  assert(/if \(!\(heldBackup && mem\.rebuiltAt\)\) \{/.test(src), 'and a rebuilt record never overwrites it');
  assert(/nodes: \[\], rebuiltAt: Date\.now\(\)/.test(src), 'a rebuild marks what it made');
  assert(/const \{ rebuiltAt, \.\.\.rest \} = mem;/.test(src), 'and putting the old record back clears the mark');

  /* the mark must survive a save and a load, or the guard is blind */
  const { saveMemory, loadMemory } = await import('../../js/agents/memory.js');
  await saveMemory('rebuild-mark-record', { window: 30, nodes: [], rebuiltAt: 4321 });
  const back = await loadMemory('rebuild-mark-record');
  eq(back.rebuiltAt, 4321, 'the mark rides through the record’s own loader');
});
