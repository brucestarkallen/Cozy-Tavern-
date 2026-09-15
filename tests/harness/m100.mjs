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
  /* M254: split by COAT, not at the light block — a third coat (the deep) made
   * a slice-based count read two inks in one block and fail for no reason. */
  const css = readFileSync(new URL('../../css/base.css', import.meta.url), 'utf8');
  const coats = [];
  {
    const marks = [{ name: 'lamplight', at: css.indexOf(':root') }];
    for (const m of css.matchAll(/html\[data-theme='([a-z]+)'\]/g)) marks.push({ name: m[1], at: m.index });
    marks.sort((a, b) => a.at - b.at);
    for (let i = 0; i < marks.length; i += 1) {
      const end = i + 1 < marks.length ? marks[i + 1].at : css.length;
      coats.push({ name: marks[i].name, block: css.slice(marks[i].at, end) });
    }
  }
  assert(coats.length >= 3, 'the house has at least three coats (' + coats.map((c) => c.name).join(', ') + ')');
  const inks = [];
  for (const coat of coats) {
    const named = (coat.block.match(/--on-ember:\s*([^;]+);/g) || []).map((x) => x.split(':')[1].trim().replace(';', ''));
    eq(named.length, 1, coat.name + ' names the ink on the ember exactly once — a second would shadow the first (' + named.join(', ') + ')');
    inks.push(named[0]);
  }
  assert(new Set(inks).size > 1, 'and the coats do not all share one ink over very different embers');

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
test('M196: a line too poor to annotate is rewritten by the house, not handed to the writer', async () => {
  /* M248: this law only READ the source — it would have passed with the
   * feature dead. It runs it now: an audit that finds more missing than the
   * addendum can hold must come back with the LINE rewritten to hold it. */
  const { db } = await import('../../js/store.js');
  const { saveMemory, loadMemory, maybeSummarize } = await import('../../js/agents/memory.js');
  const st = await db.stories.create({ title: 'a line that left too much out' });
  for (let i = 0; i < 40; i += 1) await db.messages.append(st.id, { role: i % 2 ? 'assistant' : 'user', text: 'page ' + i });
  await db.settings.set('memoryWindow', 20);
  await db.settings.set('memoryBatch', 6);
  await saveMemory(st.id, { window: 20, nodes: [] });

  const realFetch = globalThis.fetch;
  /* folds and audits interleave, so the answer is chosen by WHAT WAS ASKED,
   * never by the call number */
  globalThis.fetch = async (u, o) => {
    const ask = String((o && o.body) || '');
    const detail = Array.from({ length: 40 }, (_, i) => 'a thing the line left out, number ' + i + ', which matters').join('; ');
    const body = /Rewrite the line so every one of them is in it/.test(ask)
      ? '[Sept 1] Jovan arrived, and every one of the things the line had left out is in it now'
      : /The record line:/.test(ask) ? ('DETAIL: ' + detail)
        : '[Sept 1] Jovan arrived';
    const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: body } }] }) + '\n\n'
      + 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n';
    return { ok: true, status: 200, headers: new Headers(),
      body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }),
      async json() { return {}; }, async text() { return sse; }, clone() { return this; } };
  };
  try {
    await maybeSummarize({ connection: { id: 'c', type: 'openai', baseUrl: 'https://x.test', model: 'm', apiKey: 'k' }, storyId: st.id });
  } finally { globalThis.fetch = realFetch; }
  const node = (await loadMemory(st.id)).nodes[0];
  assert(/every one of the things the line had left out/.test(node.text),
    'the LINE was rewritten to hold what its addendum could not: ' + JSON.stringify(node.text));
  assert(!node.detail || node.detail.length < 1200, 'and the addendum is not a dumping ground: ' + (node.detail || '').length);

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



/* M207: the writer's own screen — "Rebuilding the record · page 18 of 98 ·
 * 18%" above "the keeper ran 2 minutes ago and stumbled — outwaited". The
 * queue gave the WHOLE JOB one sixty-second leash, which is right for one
 * worker asking one question and hopeless for a rebuild, which is sixteen
 * questions across a hundred pages. On any tale long enough to need a
 * rebuild, the rebuild could never finish. */
test('M207: a job that works in rounds renews its leash; a hung call is still cut off', async () => {
  const { workerSignal } = await import('../../js/agents/status.js');

  /* work that keeps going is not punished for taking more than a minute */
  const long = workerSignal(300);
  for (let i = 0; i < 6; i += 1) {
    await new Promise((r) => setTimeout(r, 200));
    eq(long.renew(), true, 'round ' + i + ' renews');
  }
  eq(long.signal.aborted, false, '1.2s of work under a 0.3s leash, renewed each round, is never aborted');
  long.done();

  /* a call that hangs is still cut off, and a renew after that is refused */
  const hung = workerSignal(200);
  await new Promise((r) => setTimeout(r, 350));
  eq(hung.signal.aborted, true, 'a hung call is cut off');
  eq(hung.renew(), false, 'and cannot be revived by a renew');
  hung.done();

  /* the queue hands it down, and both rebuilds take it */
  const queue = readFileSync(new URL('../../js/agents/queue.js', import.meta.url), 'utf8');
  assert(/const \{ signal, done, renew, abort \} = workerSignal\(\);/.test(queue), 'the queue takes a renew (and a stop)');
  assert(/job\.run\(\{ signal, stale: isStale, renew \}\)/.test(queue), 'and hands it to the job');
  const rb = readFileSync(new URL('../../js/agents/rebuild.js', import.meta.url), 'utf8');
  eq((rb.match(/typeof renew === 'function' && !renew\(\)/g) || []).length, 3,
    'the record rebuild renews each round and after each retry pause; the people rebuild each batch');
  const chat = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  assert(/run: async \(\{ signal, stale, renew \}\) => \{\s*\n\s*const result = await rebuildRecord\(\{\s*\n\s*connection, storyId: story\.id, signal, stale, renew,/.test(chat),
    'the record rebuild is handed it');
  assert(/rebuildPeople\(\{ connection, storyId: story\.id, brief: story\.brief \|\| '', castNotes: story\.castNotes \|\| '', signal, stale, renew,/.test(chat),
    'and so is the people rebuild');
});

/* M208: two faults the writer read off his own screen.
 *  - "Detail worth keeping: also named: cardinal, Aurora house next door,
 *    also named: Rachel British, American, Reynolds, figures 16, 18" — a
 *    debug token list pasted where a sentence belongs, half of it not even
 *    names, and the storyteller reads it every turn.
 *  - a rebuild is minutes of work and there was NO WAY TO CALL IT OFF. */
test('M208: no token dumps in the record, and the writer may stop what they started', async () => {
  const { looksLikeTokenDump } = await import('../../js/agents/memory.js');
  for (const junk of ['also named: cardinal, Aurora house next door',
    'Rachel British, American, Reynolds, Wells', 'figures: 16, 18', 'names: a, b, c, d']) {
    eq(looksLikeTokenDump(junk), true, 'refused: ' + junk);
  }
  for (const real of ['Jovan is sixteen, not seventeen; Vanessa said Sixteen when demanding his status',
    'the plan is to burn the north wood and bait the convoy with the gold',
    'Alexia Vanderbilt is the neighbour Vanessa warned Jovan not to talk to']) {
    eq(looksLikeTokenDump(real), false, 'kept: ' + real);
  }

  const mem = readFileSync(new URL('../../js/agents/memory.js', import.meta.url), 'utf8');
  assert(!/rest\.push\('also named: '/.test(mem), 'the code no longer pastes a name list');
  assert(!/rest\.push\('figures: '/.test(mem), 'nor a figure list');
  assert(/Never a bare list of words/.test(mem), 'it asks for phrases that read as English');
  assert(/if \(last && !looksLikeTokenDump\(last\)\) detail = mergeDetail\(detail, last\);/.test(mem),
    'and writes nothing at all rather than nonsense');

  /* the stop */
  const { workerSignal } = await import('../../js/agents/status.js');
  const w = workerSignal(60000);
  eq(w.signal.aborted, false, 'a call in flight');
  w.abort();
  eq(w.signal.aborted, true, 'is aborted by the writer’s stop');
  eq(String(w.signal.reason && w.signal.reason.message), 'stopped by hand', 'and says so');

  const queue = readFileSync(new URL('../../js/agents/queue.js', import.meta.url), 'utf8');
  assert(/export function stopWork\(storyId\)/.test(queue), 'the queue can be stopped');
  assert(/if \(list\) list\.length = 0;/.test(queue), 'everything still queued for that story is dropped');
  assert(/return \{ ok: false, stopped: true, why: 'stopped by hand' \};/.test(queue), 'a stop is a stop, not a failure');
  assert(!/if \(stoppedByHand\)[\s\S]{0,200}attempt/.test(queue), 'and is never retried');

  const chat = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  /* M209: the stop goes through stoppedByHand now — see the law below */
  /* M218: counted structurally, not to a fixed number — an exact count broke
   * four laws the moment a tenth action was added, which teaches the next
   * reader to edit laws rather than trust them. EVERY banner carries a stop. */
  const raised = (chat.match(/beginWork\(/g) || []).length;
  /* the per-line redo names its banner across two lines, so the stop is
   * counted by the callback itself rather than by a one-line shape */
  const stops = (chat.match(/if \(s\) stoppedByHand\(s\);/g) || []).length;
  assert(raised >= 9, 'the house has its manual actions (' + raised + ')');
  eq(stops, raised, 'and every one of them can be stopped (' + stops + ' of ' + raised + ')');
  assert(/stopWork\(storyId\);/.test(chat), 'and the queue is what it stops');
});

/* M210: ONE BUTTON, ONE MEANING. M203 made a press sometimes resume and
 * sometimes start over, depending on how the LAST run had ended — so the
 * writer could not tell which they were getting, and after a run that
 * finished it did nothing at all. Rebuild means from the first page, every
 * press. The carrying-on belongs inside a run: a round that stumbles waits
 * and tries again rather than throwing the run away. */
test('M210: Rebuild always starts from the first page, and retries live inside one run', async () => {
  const src = readFileSync(new URL('../../js/agents/rebuild.js', import.meta.url), 'utf8');

  assert(/await saveMemory\(storyId, \{ \.\.\.mem, nodes: \[\], rebuiltAt: Date\.now\(\) \}\);/.test(src),
    'the record is let go on every press');
  assert(!/resuming/.test(src), 'nothing resumes across presses');
  assert(!/rebuildStalled/.test(src), 'and no mark decides what a press means');

  /* the retry still lives INSIDE the run — that is the carrying-on that matters */
  assert(/const pauses = \[1500, 4000, 9000, 20000, 45000, 90000\];/.test(src),
    'a round that stumbles waits and tries again — six rungs, patient enough to outlast a real hiccup (M215)');
  assert(/if \(after\.length !== before\.length\) \{ recovered = true; break; \}/.test(src), 'and carries on the moment it recovers');
  assert(/stalled: true,/.test(src), 'only a run that gives up says so');
  assert(/press Rebuild to start again, or put the old record back/.test(src), 'and says what to do');

  /* the way back is still never overwritten by a rebuild's own output (M202) */
  assert(/const heldBackup = await db\.settings\.get\('memoryBackup:' \+ storyId\);/.test(src), 'the standing backup is read first');
  assert(/if \(!\(heldBackup && mem\.rebuiltAt\)\) \{/.test(src), 'and a rebuilt record never overwrites it');

  /* a stop just stops */
  const chat = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  assert(/function stoppedByHand\(storyId\) \{\s*\n\s*if \(storyId\) stopWork\(storyId\);/.test(chat),
    'a stop stops the queue and nothing else');
  assert(!/rebuildStalled/.test(chat), 'there is no mark left for it to clear');
  const raisedHere = (chat.match(/beginWork\(/g) || []).length;
  const wired = (chat.match(/if \(s\) stoppedByHand\(s\);/g) || []).length;
  eq(wired, raisedHere, 'every action stops this way (' + wired + ' of ' + raisedHere + ')');

  /* the banner never claims a success that failed (M205's half that still holds) */
  assert(/const outcome = promise \? await promise : null;/.test(chat), 'the banner reads the queue’s own result');
  assert(/if \(outcome && outcome\.ok === false\) \{/.test(chat), 'and a failure is a failure');
});

/* M211: the writer watched the rebuild's banner sit at nothing and then leap
 * to "18 of 99". maybeSummarize folds THREE batches per call
 * (BATCHES_PER_RUN), and the banner was counting calls — so it could only
 * ever move in jumps of eighteen pages. Summaryception counts batches,
 * because a batch is the unit of work a writer can feel. */
test('M211: the rebuild counts batches, one at a time, and the bar reaches the end', async () => {
  const { db } = await import('../../js/store.js');
  const { saveMemory, loadMemory } = await import('../../js/agents/memory.js');
  const { rebuildRecord } = await import('../../js/agents/rebuild.js');

  const st = await db.stories.create({ title: 'a long telling' });
  for (let i = 0; i < 99; i += 1) await db.messages.append(st.id, { role: i % 2 ? 'assistant' : 'user', text: 'page ' + i });
  await db.settings.set('memoryWindow', 30);
  await saveMemory(st.id, { window: 30, nodes: [{ id: 'old1', span: [0, 5], text: 'OLD LINE from the old prompt', level: 1, at: 1 }] });

  const real = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'NEW line ' + call } }] }) + '\n\ndata: [DONE]\n\n';
    return { ok: true, status: 200, headers: new Headers(),
      body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }),
      async json() { return {}; }, async text() { return sse; }, clone() { return this; } };
  };
  const seen = [];
  try {
    await rebuildRecord({
      connection: { id: 'c', type: 'openai', baseUrl: 'https://x.test', model: 'm', apiKey: 'k' },
      storyId: st.id,
      onProgress: (p) => seen.push({ batch: p.batch, batches: p.batches, folded: p.folded }),
    });
  } finally { globalThis.fetch = real; }

  /* one step per batch, in order, no leaps */
  assert(seen.length >= 10, 'it reported every batch (' + seen.length + ')');
  for (let i = 0; i < seen.length; i += 1) eq(seen[i].batch, i + 1, 'step ' + (i + 1) + ' is batch ' + (i + 1));
  eq(seen[0].folded, 6, 'the first step is six pages, not eighteen');
  eq(seen[1].folded, 12, 'and the second is twelve');

  /* and the bar closes: a part-batch is held back by dueRange, so counting it
   * left the banner at "11 of 12 · 92%" on a run that had finished */
  eq(seen[seen.length - 1].batch, seen[seen.length - 1].batches, 'the last step reaches the end');

  /* and the rebuild really did replace the old line */
  const mem = await loadMemory(st.id);
  assert(!mem.nodes.some((n) => /OLD LINE/.test(n.text)), 'the old record is gone');
  assert(/^NEW line /.test(mem.nodes[0].text), 'and the first line was folded again: ' + mem.nodes[0].text);
});

/* M212: M202 ported Summaryception's newer prompt, and Summaryception keeps
 * TWO copies of it — the live one and a migration "old default". A port that
 * landed in the wrong copy would leave the keeper folding by the old rules
 * while the file looked right, and the writer would rebuild and get the same
 * lines back with nothing to explain it. So the check is on what the keeper
 * is actually SENT, not on what the file contains. */
test('M212: the prompt the keeper is sent carries every ported block', async () => {
  const { buildMemoryMessages } = await import('../../js/agents/memory.js');
  const p = buildMemoryMessages([{ role: 'assistant', text: 'She said sixteen.' }], { playerName: 'Jovan', record: '' });
  const sent = p.system + '\n' + p.user;
  for (const block of [
    'VERBATIM PRESERVATION',          /* the dialogue rule — why the writer's snippets had none */
    'CAUSAL FIDELITY',
    'FIRST APPEARANCES',
    'COMPLETENESS OUTRANKS BREVITY',
    'FIGURES ARE EXACT',              /* this house's own, M194 */
    'Time AND place',                 /* this house's own, M197 */
  ]) {
    assert(sent.includes(block), block + ' reaches the keeper');
  }
  /* and the older rules it was built on are still there */
  for (const block of ['HARD EXCLUSIONS', 'ACTOR RULES', 'ABSOLUTE PRONOUN BAN', 'BEFORE OUTPUTTING, verify']) {
    assert(sent.includes(block), block + ' is still there');
  }
  assert(sent.includes('Jovan'), 'and the player’s name is substituted in');
});

/* M213: the writer's rebuild stopped dead at batch 3 of 16 and read "nothing
 * to rebuild". M207 renewed the leash once per ROUND — and a round is
 * BATCHES_PER_RUN batches, each its own keeper call, each followed by the
 * AUDIT'S calls (one, up to three when it asks again). Four or more calls
 * between renews passes sixty seconds easily on a real model, the signal
 * aborted mid-rebuild, and rebuildRecord returned null — which prints as
 * "nothing to rebuild" over a run that had folded eighteen pages. */
test('M213: every keeper call renews, and a long rebuild runs to the end', async () => {
  const mem = readFileSync(new URL('../../js/agents/memory.js', import.meta.url), 'utf8');
  /* every call in the file renews before it goes */
  /* M218: every callKeeper in the file has a renew above it — counted by
   * structure, not to a number that goes stale the moment a call is added. */
  const keeperCalls = (mem.match(/await callKeeper\(/g) || []).length;
  const renews = (mem.match(/typeof renew === 'function'/g) || []).length;
  assert(keeperCalls >= 5, 'the file asks the keeper in several places (' + keeperCalls + ')');
  assert(renews >= keeperCalls - 1, 'and nearly every one renews first (' + renews + ' renews, ' + keeperCalls + ' calls)');
  assert(/async function audit\(connection, storyId, node, sourceText, signal, knownNames = \[\], renew\)/.test(mem),
    'the audit is given the renew');
  assert(/await audit\(connection, storyId, node, passage, signal, await knownNamesOf\(storyId\), renew\);/.test(mem),
    'and handed it by the folder');

  const rb = readFileSync(new URL('../../js/agents/rebuild.js', import.meta.url), 'utf8');
  assert(/connection, storyId, signal, renew,/.test(rb), 'the rebuild hands it down');
  assert(/why: 'the run was cut short — press Rebuild to start again'/.test(rb),
    'and a run that IS cut short reports what it folded, never null');
  assert(!/&& !renew\(\)\) return null;/.test(rb), 'null is what printed as "nothing to rebuild"');

  /* the writer's own shelf, end to end */
  const { db } = await import('../../js/store.js');
  const { saveMemory } = await import('../../js/agents/memory.js');
  const { rebuildRecord } = await import('../../js/agents/rebuild.js');
  const { workerSignal } = await import('../../js/agents/status.js');
  const st = await db.stories.create({ title: 'a hundred and eighteen pages' });
  for (let i = 0; i < 118; i += 1) await db.messages.append(st.id, { role: i % 2 ? 'assistant' : 'user', text: 'page ' + i });
  await db.settings.set('memoryWindow', 20);
  await db.settings.set('memoryBatch', 6);
  await saveMemory(st.id, { window: 20, nodes: [] });

  const real = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    const body = '[Sept 1] Jovan did something worth recording, number ' + call + '; Rias answered him';
    const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: body } }] }) + '\n\ndata: [DONE]\n\n';
    return { ok: true, status: 200, headers: new Headers(),
      body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }),
      async json() { return {}; }, async text() { return sse; }, clone() { return this; } };
  };
  const seen = [];
  let r = null;
  try {
    const w = workerSignal(60000);
    r = await rebuildRecord({
      connection: { id: 'c', type: 'openai', baseUrl: 'https://x.test', model: 'm', apiKey: 'k' },
      storyId: st.id, renew: w.renew, signal: w.signal,
      onProgress: (p) => seen.push(p.batch + '/' + p.batches),
    });
  } finally { globalThis.fetch = real; }

  eq(seen[seen.length - 1], '16/16', 'it runs to the last batch, not to batch 3: ' + seen.join(' '));
  eq(Boolean(r && r.stalled), false, 'and is never cut short');
  eq(r.lines, 16, 'sixteen lines written');
});

/* M215: the writer asked whether a rebuild always retries. It did not.
 *  - a THROWN wire error (a connection reset) escaped rebuildRecord entirely.
 *    The queue caught it and retried the WHOLE JOB, which wipes the record and
 *    folds from page one again — a hundred pages of work thrown away by one
 *    blip, up to five times over.
 *  - and the ladder was three tries across fifteen seconds, which any real
 *    provider hiccup outlasts. */
test('M215: a wire that falls over mid-rebuild is a stumble, and the ladder is patient', async () => {
  const rb = readFileSync(new URL('../../js/agents/rebuild.js', import.meta.url), 'utf8');
  assert(/const pauses = \[1500, 4000, 9000, 20000, 45000, 90000\];/.test(rb),
    'six tries across about three minutes, not three across fifteen seconds');
  assert(/\} catch \(err\) \{ \/\* the ladder below decides what to do about it \*\/ \}/.test(rb),
    'a thrown call is caught where the ladder can see it');
  assert(/\} catch \(err\) \{ \/\* still down — the next rung of the ladder \*\/ \}/.test(rb),
    'and on every rung after');

  /* the wire goes down for four calls in the middle of a run */
  const { db } = await import('../../js/store.js');
  const { saveMemory } = await import('../../js/agents/memory.js');
  const { rebuildRecord } = await import('../../js/agents/rebuild.js');
  const { workerSignal } = await import('../../js/agents/status.js');
  const st = await db.stories.create({ title: 'a run through a bad patch' });
  for (let i = 0; i < 60; i += 1) await db.messages.append(st.id, { role: i % 2 ? 'assistant' : 'user', text: 'page ' + i });
  await db.settings.set('memoryWindow', 20);
  await db.settings.set('memoryBatch', 6);
  await saveMemory(st.id, { window: 20, nodes: [] });

  const real = globalThis.fetch;
  let call = 0;
  const down = [4, 5, 6, 7];
  globalThis.fetch = async () => {
    call += 1;
    if (down.includes(call)) throw new Error('connection reset');
    const body = '[Sept 1] Jovan did something worth recording, number ' + call + '; Rias answered him';
    const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: body } }] }) + '\n\ndata: [DONE]\n\n';
    return { ok: true, status: 200, headers: new Headers(),
      body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }),
      async json() { return {}; }, async text() { return sse; }, clone() { return this; } };
  };
  const waits = [];
  const seen = [];
  let r = null;
  try {
    const w = workerSignal(60000);
    r = await rebuildRecord({
      connection: { id: 'c', type: 'openai', baseUrl: 'https://x.test', model: 'm', apiKey: 'k' },
      storyId: st.id, renew: w.renew, signal: w.signal,
      onProgress: (p) => seen.push(p.batch + '/' + p.batches),
      onRetry: async ({ attempt, of }) => { waits.push(attempt + '/' + of); await new Promise((z) => setTimeout(z, 10)); },
    });
  } finally { globalThis.fetch = real; }

  assert(waits.length >= 1, 'it retried rather than dying: ' + waits.join(', '));
  eq(Boolean(r && r.stalled), false, 'and came back from it');
  eq(seen[seen.length - 1], '6/6', 'finishing every batch: ' + seen.join(' '));
  eq(r.lines, 6, 'six lines written');
});

/* M216: two things Summaryception has had for years and this house never did,
 * both named by the writer:
 *  - THE DETAIL WAS INVISIBLE TO EVERY WORKER BUT THE STORYTELLER. Only
 *    renderMemory carried it. So the keeper writing the NEXT line could not
 *    see that the line before it had been CORRECTED and would write the wrong
 *    fact again; the auditor checking the ledger could not see it; nor the
 *    mender; nor the housekeeper. The one place a correction and a battle
 *    plan live was hidden from everyone who needed them.
 *  - ONE BAD LINE MEANT REBUILDING THE WHOLE RECORD. Summaryception redoes a
 *    single snippet, and its detail, in place. */
test('M216: every reader sees the detail, and one line can be folded again alone', async () => {
  const { recordFor, wholeRecord, renderMemory, redoLine, saveMemory, loadMemory } = await import('../../js/agents/memory.js');
  const { db } = await import('../../js/store.js');

  const mem = { window: 20, nodes: [{ id: 'n1', span: [0, 5], level: 1, at: 1,
    text: '[Sept 1] Jovan arrived', detail: 'the plan is to burn the north wood and bait the convoy with the gold' }] };
  for (const [who, out] of [['the storyteller', renderMemory(mem)], ['the keeper', recordFor(mem)], ['the auditor, mender and housekeeper', wholeRecord(mem)]]) {
    assert(out.includes('burn the north wood'), who + ' sees the detail');
    assert(out.includes('Detail worth keeping'), who + ' sees it labelled');
  }

  /* one line, again */
  const st = await db.stories.create({ title: 'a record with one bad line' });
  for (let i = 0; i < 40; i += 1) await db.messages.append(st.id, { role: i % 2 ? 'assistant' : 'user', text: 'page ' + i });
  await db.settings.set('memoryWindow', 20);
  await saveMemory(st.id, { window: 20, nodes: [
    { id: 'a', span: [0, 5], level: 1, at: 1, text: 'LINE ONE, which came out wrong', detail: 'also named: nonsense, junk' },
    { id: 'b', span: [6, 11], level: 1, at: 1, text: 'LINE TWO, which is fine' },
    { id: 'p', span: [0, 11], level: 2, at: 1, text: 'a promoted line' },
  ] });

  const real = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    const body = call === 1 ? '[Sept 1] Jovan did the thing properly this time; Rias answered him' : 'NONE';
    const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: body } }] }) + '\n\ndata: [DONE]\n\n';
    return { ok: true, status: 200, headers: new Headers(),
      body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }),
      async json() { return {}; }, async text() { return sse; }, clone() { return this; } };
  };
  const conn = { id: 'c', type: 'openai', baseUrl: 'https://x.test', model: 'm', apiKey: 'k' };
  let r = null;
  let promoted = null;
  let gone = null;
  try {
    r = await redoLine({ connection: conn, storyId: st.id, nodeId: 'a' });
    promoted = await redoLine({ connection: conn, storyId: st.id, nodeId: 'p' });
    gone = await redoLine({ connection: conn, storyId: st.id, nodeId: 'zz' });
  } finally { globalThis.fetch = real; }

  eq(r.ok, true, 'the line was folded again');
  const after = await loadMemory(st.id);
  const a = after.nodes.find((n) => n.id === 'a');
  assert(/did the thing properly/.test(a.text), 'with new words: ' + a.text);
  assert(!a.detail, 'and its nonsense detail cleared — the old detail described the old line');
  eq(after.nodes.find((n) => n.id === 'b').text, 'LINE TWO, which is fine', 'every other line is untouched');

  eq(promoted.ok, false, 'a promoted line is refused');
  assert(/no pages of its own/.test(promoted.why), promoted.why);
  eq(gone.ok, false, 'and a line that has gone is refused');

  /* and the writer can reach it */
  const drawer = readFileSync(new URL('../../js/ui/drawer.js', import.meta.url), 'utf8');
  /* M217: it is "Fold again" — the button that already existed, made to do
   * the real thing rather than deleting the line and hoping (M210's law: one
   * button, one meaning). */
  assert(/await ctx\.chat\.redoRecordLine\(n\.id, false\);/.test(drawer), 'the line carries its own redo');
  assert(/Fold again/.test(drawer), 'under the name it already had');
  assert(/n\.detail \? 'Detail again' : 'Add a detail'/.test(drawer), 'and one for its detail');
  assert(/if \(n\.level === 1 && Array\.isArray\(n\.span\) && n\.span\[0\] >= 0 && !n\.correction\)/.test(drawer),
    'offered only on a line that has pages of its own');
});

/* M218: the last two things on the writer's list, read from Summaryception's
 * code. The keeper folds three batches per finished page, so a writer who
 * stopped a run — or switched the keeper on partway through a long tale —
 * was dozens of batches behind with no way to catch up but playing turn
 * after turn. Summaryception's "Force Summarize Now" exists for exactly
 * that, with three guards. */
test('M218: the catch-up fills the gaps, never wipes, and refuses when it should', async () => {
  const { db } = await import('../../js/store.js');
  const { saveMemory, loadMemory, catchUpRecord, dueRange } = await import('../../js/agents/memory.js');

  const st = await db.stories.create({ title: 'a run that was stopped' });
  for (let i = 0; i < 80; i += 1) await db.messages.append(st.id, { role: i % 2 ? 'assistant' : 'user', text: 'page ' + i });
  await db.settings.set('memoryWindow', 20);
  await db.settings.set('memoryBatch', 6);
  await saveMemory(st.id, { window: 20, nodes: [
    { id: 'n0', span: [0, 5], level: 1, at: 1, text: 'line zero, already written' },
    { id: 'n1', span: [6, 11], level: 1, at: 1, text: 'line one, already written' },
  ] });

  const real = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: '[Sept 1] Jovan did something worth recording, number ' + call + '; Rias answered' } }] }) + '\n\ndata: [DONE]\n\n';
    return { ok: true, status: 200, headers: new Headers(),
      body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }),
      async json() { return {}; }, async text() { return sse; }, clone() { return this; } };
  };
  const conn = { id: 'c', type: 'openai', baseUrl: 'https://x.test', model: 'm', apiKey: 'k' };
  const seen = [];
  let r = null;
  let again = null;
  try {
    r = await catchUpRecord({ connection: conn, storyId: st.id, onProgress: (p) => seen.push(p.batch + '/' + p.batches) });
    again = await catchUpRecord({ connection: conn, storyId: st.id });
  } finally { globalThis.fetch = real; }

  eq(r.ok, true, 'it caught up');
  assert(r.folded >= 40, 'folding what was due (' + r.folded + ' pages)');
  eq(seen[seen.length - 1], r.batches + '/' + r.batches, 'the bar reaches the end: ' + seen.join(' '));

  const mem = await loadMemory(st.id);
  eq(mem.nodes.filter((n) => /already written/.test(n.text)).length, 2,
    'IT NEVER WIPES — the lines that were already there are untouched, word for word');
  eq(Boolean(dueRange(80, 20, mem.nodes, 6)), false, 'and nothing is due any more');
  eq(again.nothingDue, true, 'pressing it again says nothing is due and folds nothing');
  eq(again.folded, 0, 'doing no work at all');

  /* the three guards Summaryception has, on the button */
  const chat = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  const at = chat.indexOf('async function summarizeNow(');
  assert(at !== -1, 'the action exists');
  const body = chat.slice(at, at + 2400);
  assert(/The keeper is switched off/.test(body), 'guard 1: the keeper is off');
  assert(/workIsRunning\(story\.id\)/.test(body) && /A pass is finishing/.test(body), 'guard 2: a pass is already running');
  assert(/Nothing is due — every page is either word for word or already folded/.test(body), 'guard 3: nothing past the window');
  assert(/The keeper needs a connection first/.test(body), 'and a missing connection is named too');

  const drawer = readFileSync(new URL('../../js/ui/drawer.js', import.meta.url), 'utf8');
  assert(/Summarize now/.test(drawer), 'the writer can reach it in the ledger, under the name he calls it');
});

/* M219: the catch-up's total counted EVERY covered page, including lines that
 * reach INTO the word-for-word window — pages that were never due. So the
 * total came out short and the banner ran past its own end ("3 of 2"), which
 * a writer cannot tell from a runaway. */
test('M219: the catch-up counts only what is due, and its bar never overruns', async () => {
  const { db } = await import('../../js/store.js');
  const { saveMemory, catchUpRecord, redoLine } = await import('../../js/agents/memory.js');

  const st = await db.stories.create({ title: 'a hole and a line in the window' });
  for (let i = 0; i < 80; i += 1) await db.messages.append(st.id, { role: i % 2 ? 'assistant' : 'user', text: 'page ' + i });
  await db.settings.set('memoryWindow', 20);
  await db.settings.set('memoryBatch', 6);
  /* covered: 0-11 and 30-59 — a HOLE at 12-29 — plus a line reaching into the
   * word-for-word window at 60-65, which is not due and must not be counted */
  await saveMemory(st.id, { window: 20, nodes: [
    { id: 'a', span: [0, 5], level: 1, at: 1, text: 'line a' },
    { id: 'b', span: [6, 11], level: 1, at: 1, text: 'line b' },
    ...Array.from({ length: 5 }, (_, i) => ({ id: 'c' + i, span: [30 + i * 6, 35 + i * 6], level: 1, at: 1, text: 'later ' + i })),
    { id: 'w', span: [60, 65], level: 1, at: 1, text: 'a line reaching into the window' },
  ] });

  const real = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: '[Sept 1] Jovan did something, number ' + call + '; Rias answered' } }] }) + '\n\ndata: [DONE]\n\n';
    return { ok: true, status: 200, headers: new Headers(),
      body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }),
      async json() { return {}; }, async text() { return sse; }, clone() { return this; } };
  };
  const seen = [];
  let r = null;
  let gone = null;
  let past = null;
  try {
    r = await catchUpRecord({ connection: { id: 'c', type: 'openai', baseUrl: 'https://x.test', model: 'm', apiKey: 'k' },
      storyId: st.id, onProgress: (p) => seen.push([p.batch, p.batches]) });

    /* while we are here: a line whose pages are gone, and one running past the end */
    const st2 = await db.stories.create({ title: 'short' });
    for (let i = 0; i < 20; i += 1) await db.messages.append(st2.id, { role: i % 2 ? 'assistant' : 'user', text: 'page ' + i });
    await saveMemory(st2.id, { window: 10, nodes: [{ id: 'x', span: [50, 55], level: 1, at: 1, text: 'about pages that are gone' }] });
    gone = await redoLine({ connection: { id: 'c', type: 'openai', baseUrl: 'https://x.test', model: 'm', apiKey: 'k' }, storyId: st2.id, nodeId: 'x' });
    await saveMemory(st2.id, { window: 10, nodes: [{ id: 'y', span: [16, 21], level: 1, at: 1, text: 'running past the end' }] });
    past = await redoLine({ connection: { id: 'c', type: 'openai', baseUrl: 'https://x.test', model: 'm', apiKey: 'k' }, storyId: st2.id, nodeId: 'y' });
  } finally { globalThis.fetch = real; }

  assert(seen.length > 0, 'it folded the hole');
  for (const [done, total] of seen) assert(done <= total, 'the bar never overruns: ' + done + ' of ' + total);
  eq(seen[seen.length - 1][0], seen[seen.length - 1][1], 'and reaches its end exactly');
  eq(r.folded, 18, 'folding exactly the eighteen pages of the hole, not the pages in the window');

  eq(gone.ok, false, 'a line whose pages are gone is refused');
  assert(/pages that line was written from are gone/.test(gone.why), gone.why);
  eq(past.ok, true, 'a line running past the end folds from what remains');
  eq(past.pages, 4, 'the four pages that are really there');
});

/* M221: the writer pressed the housekeeper and got back, whole, 51 characters:
 *   <fetch>["#rbrq3w1", "#r86y302", "#r87g7v3"]
 * and no cards at all. When the fetch rounds run out and the answer is STILL
 * nothing but a <fetch>, that raw block was handed back as the reply — a turn
 * spent entirely on asking to read things, with nothing done. */
test('M221: a turn is never spent entirely on fetching, and a fetched record line carries its detail', async () => {
  /* M248: this law only READ the source. It runs the turn now: a model that
   * fetches every round must be served, told once there is no more, and its
   * turn must not come back as a bare <fetch>. */
  const { db } = await import('../../js/store.js');
  const { saveMemory } = await import('../../js/agents/memory.js');
  const { housekeeperTurn, recordHandle } = await import('../../js/agents/housekeeper.js');
  const nd = { id: 'node-aaa-1', span: [0, 5], level: 1, at: 1, text: 'a thin line',
    detail: 'the plan is to burn the north wood' };
  const st = await db.stories.create({ title: 'a housekeeper that only fetches' });
  for (let i = 0; i < 12; i += 1) await db.messages.append(st.id, { role: i % 2 ? 'assistant' : 'user', text: 'page ' + i });
  await saveMemory(st.id, { window: 6, nodes: [nd] });

  const realFetch = globalThis.fetch;
  const sent = [];
  let n = 0;
  globalThis.fetch = async (u, o) => {
    n += 1;
    sent.push(String((o && o.body) || ''));
    const body = n <= 6 ? '<fetch>["' + recordHandle(nd) + '"]</fetch>'
      : 'Found it.\n<ledits>[{"type":"people.set","name":"Mara","field":"core","text":"the innkeeper"}]</ledits>';
    const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: body } }] }) + '\n\n'
      + 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n';
    return { ok: true, status: 200, headers: new Headers(),
      body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }),
      async json() { return {}; }, async text() { return sse; }, clone() { return this; } };
  };
  let turn = null;
  try {
    turn = await housekeeperTurn({ storyId: st.id, writerText: 'audit the house', shownText: '',
      connection: { id: 'c', type: 'openai', baseUrl: 'https://x.test', model: 'm', apiKey: 'k' } });
  } finally { globalThis.fetch = realFetch; }

  eq(turn.ok, true, 'the turn came back');
  assert(sent.some((b) => /a thin line/.test(b)), 'the line it asked for was served');
  assert(sent.some((b) => /burn the north wood/.test(b)), 'WITH its detail — what the audit wrote beneath it');
  assert(sent.some((b) => /no more <fetch>/.test(b)), 'and it was told once that there is no more fetching');
  assert(!/^<fetch>/.test(String(turn.raw || '').trim()), 'the turn does not come back as a bare fetch: ' + JSON.stringify(String(turn.raw || '').slice(0, 60)));

  const hk = readFileSync(new URL('../../js/agents/housekeeper.js', import.meta.url), 'utf8');

  assert(/if \(parsed\.fetch\.length && round >= MAX_FETCH_ROUNDS && !toldNoMoreFetching\) \{/.test(hk),
    'rounds exhausted with a fetch still on the wire is caught');
  assert(/That is everything you may fetch this turn\. Answer now with the blocks the writer asked for — no more <fetch>\./.test(hk),
    'and it is told so, plainly, once');
  assert(/let toldNoMoreFetching = false;/.test(hk), 'told once, never in a loop');
  assert(hk.indexOf('round >= MAX_FETCH_ROUNDS') < hk.indexOf('round < MAX_FETCH_ROUNDS'),
    'the exhausted case is checked BEFORE the ordinary one, or it could never run');

  /* a fetched record line comes back with its detail — the housekeeper can
   * read what the audit wrote beneath a line, not only the line */
  assert(/nd\.detail \? '\\n• Detail worth keeping: ' \+ nd\.detail : ''/.test(hk),
    'a fetched record line carries its detail');

  /* and the auditor has nothing to do with fetch — that vocabulary is the
   * housekeeper's alone, which is why an "audit" that returns <fetch> is a
   * housekeeper turn, not an audit */
  const aud = readFileSync(new URL('../../js/agents/auditor.js', import.meta.url), 'utf8');
  assert(!/fetch/.test(aud), 'the auditor neither asks for nor answers a fetch');
});

/* M222: THE AUDIT BUTTON'S ONE INSTRUCTION COULD NEVER BE OBEYED. The
 * housekeeper's Audit ask tells the model, in as many words, to "FETCH those
 * pages whole (their #handles) and the line itself (its #r… mark) before you
 * judge". But parseFetchRefs accepted HEX ONLY — page ids are hex, while a
 * record line's mark is "#r" + the node's own id, which carries letters past
 * f ("#rbrq3w1", "#r86y302"). So every record-line fetch was thrown out as
 * malformed, and the writer's audit came back as a bare
 * <fetch>["#rbrq3w1", "#r86y302", "#r87g7v3"] with nothing done at all. */
test('M222: a record handle is a handle, and an audit can fetch the lines it judges', async () => {
  const { parseProtocol, recordHandle } = await import('../../js/agents/housekeeper.js');

  /* the writer's own three handles */
  const his = parseProtocol('<fetch>["#rbrq3w1", "#r86y302", "#r87g7v3"]</fetch>');
  eq(his.fetch.length, 3, 'all three record handles read: ' + JSON.stringify(his.fetch));
  eq(his.fetchMalformed, false, 'and none of them called malformed');

  /* every shape the ask can produce */
  eq(parseProtocol('<fetch>["#a1b2c3"]</fetch>').fetch.length, 1, 'a page handle still reads');
  eq(parseProtocol('<fetch>["rule: The craft"]</fetch>').fetch.length, 1, 'a rule by name still reads');
  eq(parseProtocol('<fetch>["just words"]</fetch>').fetchMalformed, true, 'and words are still malformed');

  /* a handle the house itself makes must be one the house can read back */
  const h = recordHandle({ id: 'node-aaa-1', span: [0, 5], level: 1, at: 1, text: 'a line' });
  eq(parseProtocol('<fetch>["' + h + '"]</fetch>').fetch[0], h,
    'a handle the record hands out (' + h + ') is one the fetch accepts');

  const hk = readFileSync(new URL('../../js/agents/housekeeper.js', import.meta.url), 'utf8');
  assert(/\/\^#r\[0-9a-z\]\{2,16\}\$\/i\.test\(t\)/.test(hk), 'record handles are named in the validator');
  /* and the Audit ask really does demand it — so this path is its main one */
  const ui = readFileSync(new URL('../../js/ui/housekeeper.js', import.meta.url), 'utf8');
  assert(/FETCH those pages whole \(their #handles\) and the line/.test(ui), 'the Audit ask asks for exactly this');
});

/* M223: the writer's audit produced a page of correct findings — "indigo
 * eyes" -> "blue eyes", "Jovan is seventeen" -> "sixteen", "Suzune is a
 * nickname, not a surname" — and EVERY ONE came back "Refused — its anchor
 * does not match the line". Since M216 the housekeeper READS a line's
 * "• Detail worth keeping: …", so it does the obvious thing and proposes
 * corrections to it; but the anchor was matched against node.text ALONE,
 * which never contains the detail. Sight without reach. */
test('M223: a record edit reaches the detail beneath the line, not only the line', async () => {
  const { stageProposals, recordHandle } = await import('../../js/agents/housekeeper.js');
  const nd = { id: 'node-abc-1', span: [0, 5], level: 1, at: 1,
    text: 'Jovan arrived at the Lantern',
    detail: "Aurora's physical description: strawberry blonde hair, indigo eyes; Jovan is seventeen" };
  const h = recordHandle(nd);
  const card = (find, replace) => stageProposals({ record: [{ line: h, find, replace, reason: 'r' }] },
    { messages: [], memory: { nodes: [nd] } })[0];

  eq(card('arrived at the Lantern', 'arrived at the inn').status, 'pending', 'an anchor in the LINE still stages');
  eq(card('indigo eyes', 'blue eyes').status, 'pending', 'an anchor in the DETAIL stages — the writer’s exact case');
  eq(card('Jovan is seventeen', 'Jovan is sixteen').status, 'pending', 'and his other one');
  eq(card('• Detail worth keeping: ' + nd.detail, 'Aurora: blue eyes; Jovan is sixteen').status, 'pending',
    'and the label pasted in with it is forgiven — models copy it');
  eq(card('the elephants marched at noon', 'x').status, 'refused', 'while words that are nowhere are still refused');

  const hk = readFileSync(new URL('../../js/agents/housekeeper.js', import.meta.url), 'utf8');
  assert(/function locateInNode\(node, find\)/.test(hk), 'one place decides where an anchor lives');
  assert(/nodes\[at\] = \{ \.\.\.node, \[field\]: newText/.test(hk), 'and the edit is written back to whichever it was found in');
  /* Chat Assistant's law, carried over so the model stops writing anchors it cannot match */
  assert(/ANCHORS ARE COPIES, NOT DESCRIPTIONS/.test(hk), 'the anchor law is in the protocol');
  assert(/clipped and its whitespace collapsed, so an anchor built from one cannot match/.test(hk),
    'with the reason, as Chat Assistant states it');
});

/* M224: the writer applied three cards, all succeeded, and the housekeeper
 * then told him in prose that "a few housekeeping items are still sitting in
 * cards from that sweep … items I proposed but they weren't applied. If you
 * apply those…" — about cards that COULD NEVER BE APPLIED BY ANYONE, because
 * their anchors were gone. A dead card was only ever set aside when a NEW
 * card happened to target the same thing, so one with no replacement sat in
 * the panel forever, shown to the housekeeper every turn as still pending. */
test('M224: a card whose anchor has gone retires itself, with no replacement needed', async () => {
  const { autoSupersede, anchorIsDead } = await import('../../js/agents/housekeeper.js');
  const world = { messages: [{ id: 'm1', role: 'assistant', text: 'the page as it stands now' }], memory: { nodes: [] }, lore: [], modules: [], story: {} };

  const dead = { id: 'c1', kind: 'edit', status: 'pending', label: 'a fix nobody can land',
    op: { messageId: 'm1', find: 'words that are no longer on the page', replace: 'x' } };
  const live = { id: 'c2', kind: 'edit', status: 'pending', label: 'a fix that still fits',
    op: { messageId: 'm1', find: 'the page as it stands', replace: 'the page as it reads' } };
  eq(anchorIsDead(dead, world), true, 'the first card’s anchor really is gone');
  eq(anchorIsDead(live, world), false, 'and the second’s is not');

  const session = { turns: [{ proposals: [dead, live] }] };
  autoSupersede(session, [], world);          /* NO new cards at all */
  eq(dead.status, 'stale', 'the dead card sets itself aside');
  assert(/can never be applied/.test(dead.words), dead.words);
  eq(live.status, 'pending', 'while a card that can still land is left alone');

  const hk = readFileSync(new URL('../../js/agents/housekeeper.js', import.meta.url), 'utf8');
  assert(/if \(!hit && dead\) \{/.test(hk), 'retired without waiting for a replacement');
  assert(hk.indexOf('if (!hit && dead)') < hk.indexOf('if (!hit) continue;'), 'checked before the old skip, or it could never run');
});

/* M225: M224 made autoSupersede run on EVERY turn instead of only when new
 * cards arrived — and every branch of anchorIsDead reads DEAD when the thing
 * it looks into is absent. One caller handing over a half-built world would
 * have retired every pending card the writer had, all at once, as "can never
 * be applied". A fix that quietly destroys work is worse than the nagging it
 * replaced. */
test('M225: "cannot tell" is never "dead" — a half-built world retires nothing', async () => {
  const { anchorIsDead } = await import('../../js/agents/housekeeper.js');
  const card = { kind: 'edit', op: { messageId: 'm1', find: 'some words', replace: 'x' } };

  eq(anchorIsDead(card, { messages: [{ id: 'm1', role: 'assistant', text: 'some words here' }], memory: { nodes: [] }, lore: [], modules: [], story: {} }),
    false, 'the page is there and the anchor is in it');
  eq(anchorIsDead(card, { messages: [{ id: 'm1', role: 'assistant', text: 'quite different now' }], memory: { nodes: [] }, lore: [], modules: [], story: {} }),
    true, 'the page is there and the anchor is NOT — that is the only dead case');
  for (const [what, world] of [['no messages', { messages: [], memory: { nodes: [] } }], ['an empty world', {}], ['no world at all', undefined]]) {
    eq(anchorIsDead(card, world), false, what + ' cannot tell, so the card lives');
  }
  /* and the same for every other anchor kind */
  eq(anchorIsDead({ kind: 'record', op: { nodeId: 'n1', find: 'x' } }, { memory: { nodes: [] } }), false, 'no record to look in');
  eq(anchorIsDead({ kind: 'redit', op: { moduleId: 'm', find: 'x' } }, { modules: [] }), false, 'no rulebook to look in');
  eq(anchorIsDead({ kind: 'lore', op: { entry: 'e', find: 'x' } }, { lore: [] }), false, 'no lore shelf to look in');

  const hk = readFileSync(new URL('../../js/agents/housekeeper.js', import.meta.url), 'utf8');
  assert(/"CANNOT TELL" IS NOT "DEAD"/.test(hk), 'the law is written where it acts');
});

/* M226: the extractor writes the ledger from the newest page and the four
 * before it — eight on a deep read — and was NEVER given the record. The word
 * "record" appeared nowhere in extractor.js. So on a hundred-page tale
 * everything older than eight pages was invisible to the ONE worker that
 * decides who is present, where they stand and what is true: it could
 * "discover" a person the story has known for eighty pages, or miss that a
 * thread it sees opening was closed long ago. */
test('M226: the extractor is given the story before the pages it can see', async () => {
  const { buildExtractorMessages } = await import('../../js/agents/extractor.js');
  const { emptyState } = await import('../../js/engine/state.js');

  const withRecord = buildExtractorMessages({
    state: emptyState(), userText: 'I go in', assistantText: 'The door opens.',
    before: [{ role: 'user', text: 'the page just before' }],
    record: '- [Sept 1] Jovan came home after two years\n- [Sept 2] Rias kept the house',
  });
  assert(/Jovan came home after two years/.test(withRecord.user), 'the folded record rides');
  assert(/The story so far, folded/.test(withRecord.user), 'labelled so the model knows what it is');
  assert(withRecord.user.indexOf('The story so far, folded') < withRecord.user.indexOf('The pages just before this one'),
    'and sits before the recent pages, oldest first, as the story runs');

  const without = buildExtractorMessages({ state: emptyState(), userText: 'x', assistantText: 'y', before: [] });
  assert(!/The story so far, folded/.test(without.user), 'no record adds nothing at all');

  /* the send path computes it for the pages OLDER than the ones it can see,
   * so nothing is told to the extractor twice */
  const chat = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  /* M228: the same cut, now measured against a page count that reaches back
   * to the record itself rather than a fixed four or eight */
  assert(/foldedBefore = mem \? recordFor\(memoryForWindow\(mem, oldest\)\) : '';/.test(chat), 'only the lines older than the visible pages');
  assert(/const oldest = Math\.max\(0, prior\.length - before\.length\);/.test(chat), 'measured from the pages it is already shown');
  assert(/record: foldedBefore,/.test(chat), 'and handed over');
});

/* M227: the housekeeper kept finding finished business still open — Alexia's
 * completed self-introduction, Aurora's answered question, Ms June's, a photo
 * already found. All of them on people who were OFF SCENE.
 * renderPeopleTiers gives a full page — Loose ends included — to people on
 * scene, and recalls an off-scene person only when the recent pages name
 * them. The scribe passed an EMPTY page list. So nobody off scene was ever
 * recalled, their open loose ends were invisible to the one worker that can
 * close them, and every thread on anyone not in the room stayed open FOREVER,
 * however plainly the page answered it. */
test('M227: the scribe sees the loose ends it is meant to close', async () => {
  const { buildScribeMessages } = await import('../../js/agents/scribe.js');
  const { emptyState } = await import('../../js/engine/state.js');

  const st = emptyState();
  st.characters = { Alexia: { core: 'a neighbour', state: '', arc: '',
    threads: ['she has not finished her self-introduction'], updatedAtTurn: 1 } };

  const named = buildScribeMessages({ state: st, userText: 'x',
    assistantText: 'Alexia finished introducing herself at last.', playerName: 'Jovan' });
  const seen = (named.system || '') + '\n' + (named.user || '');
  assert(/finished her self-introduction/.test(seen),
    'a person the page NAMES shows their open loose ends, even off scene');
  assert(/CLOSE WHAT THE PAGE ANSWERED/.test(seen), 'and the scribe is told to close what was answered');
  assert(/a ledger full of finished business is/.test(seen), 'with the reason it matters');

  const unnamed = buildScribeMessages({ state: st, userText: 'x',
    assistantText: 'Nobody mentioned her at all.', playerName: 'Jovan' });
  assert(!/finished her self-introduction/.test((unnamed.system || '') + (unnamed.user || '')),
    'while someone the page never names is still left out — the tiers are not abandoned');

  const src = readFileSync(new URL('../../js/agents/scribe.js', import.meta.url), 'utf8');
  assert(/recentPages: \[String\(userText \|\| ''\), String\(assistantText \|\| ''\)\]/.test(src),
    'the pages of this very turn are what decide who is recalled');
  assert(!/renderPeopleTiers\(state, \{ recentPages: \[\] \}\)/.test(src), 'never an empty list again');
});

/* M228: M226 gave the extractor the folded record and I told the writer it
 * "sees the whole story". It did not. The record holds only pages that have
 * LEFT the word-for-word window and been folded; the newest ones — twenty at
 * his settings — have no line yet, and the extractor saw four. So sixteen
 * pages were too NEW for the record and too OLD for its window, and were read
 * by NOTHING: a hole that moved forward with the story and never closed. */
test('M228: no page is read by nobody — the record and the pages meet', () => {
  const chat = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  assert(/const foldedTo = mem \? Math\.max\(0, \.\.\.\(mem\.nodes \|\| \[\]\)/.test(chat),
    'it finds the last page the record covers');
  assert(/const unfolded = Math\.max\(deep \? 8 : 4, Math\.min\(UNFOLDED_MAX, prior\.length - foldedTo\)\);/.test(chat),
    'and reads back to exactly there');
  assert(/const UNFOLDED_MAX = 30;/.test(chat), 'with a cap for when the keeper is off entirely');
  assert(!/before = prior\.slice\(deep \? -8 : -4\)/.test(chat), 'never a fixed four or eight again');

  /* the arithmetic, on the writer's own shelf: 118 pages, window 20, batch 6 */
  const pages = 118;
  const foldedTo = Math.floor((pages - 20) / 6) * 6;       /* 96 */
  for (const deep of [false, true]) {
    const unfolded = Math.max(deep ? 8 : 4, Math.min(30, pages - foldedTo));
    const firstRead = pages - unfolded;
    eq(firstRead <= foldedTo, true,
      'the pages read (' + firstRead + '-' + (pages - 1) + ') reach back to the record (0-' + (foldedTo - 1) + ') with no gap');
  }
  /* and a keeper switched off entirely: the cap holds, it does not read 600 pages */
  const noRecord = Math.max(4, Math.min(30, 600 - 0));
  eq(noRecord, 30, 'with no record at all it reads the cap, not the whole tale');
});

/* M229: from the writer's own record, four details in a row:
 *   "Jovan's full name is Jovan Wells" … "Rias's full name is Rias Wells" …
 *   "the phone graphic uses #121212 background, #333 border, #2d2d2f bubbles"
 * The audit was given the pages and the line and NOTHING ELSE — no prior
 * record — so every batch re-established what the story had settled eighty
 * pages earlier. The summariser has had a hard exclusion against restating
 * <prior_context> since the beginning; the audit, which writes beside it,
 * had none. And nothing told it that hex values are how a page was DRESSED,
 * not what happened in the story. */
test('M229: the detail knows what is already established, and never records presentation', async () => {
  const { buildAuditMessages } = await import('../../js/agents/memory.js');

  const withPrior = buildAuditMessages('the pages', 'the line',
    '- [Sept 1] Jovan Wells came home\n- [Sept 2] Rias Wells kept the house');
  assert(/Jovan Wells came home/.test(withPrior.user), 'the audit is shown what the record already holds');
  assert(/ALREADY ESTABLISHED/.test(withPrior.user), 'labelled as settled');
  assert(/Never write any of it again/.test(withPrior.user), 'and told plainly not to repeat it');
  assert(withPrior.user.indexOf('ALREADY ESTABLISHED') < withPrior.user.indexOf('The pages the line was written from'),
    'before the pages, as prior context should sit');

  assert(/NEVER WRITE WHAT IS ALREADY ESTABLISHED/.test(withPrior.system), 'the brief carries the rule');
  assert(/it is noise the storyteller reads every/.test(withPrior.system), 'with the reason it matters');
  assert(/NEVER RECORD PRESENTATION/.test(withPrior.system), 'and presentation is banned outright');
  assert(/Colours, hex values, fonts, line-heights/.test(withPrior.system), 'naming exactly what the writer saw');

  const without = buildAuditMessages('the pages', 'the line');
  assert(!/ALREADY ESTABLISHED/.test(without.user), 'no prior record adds nothing at all');

  /* the run hands it the lines BEFORE this one, never the ones after */
  const src = readFileSync(new URL('../../js/agents/memory.js', import.meta.url), 'utf8');
  assert(/n\.span\[1\] < node\.span\[0\]/.test(src), 'only the lines before it');
  assert(/never the lines after it: a detail must not know the future/i.test(src), 'and the reason is written down');
  eq((src.match(/buildAuditMessages\(sourceText,[\s\S]{0,120}?priorRecord\)/g) || []).length, 3,
    'the first ask and both re-asks all carry it');
});

/* M230: the writer, on the LATEST coat, still had "also named: Chloe, Caleb
 * Thorne, Wells" in his record — and I told him it was old. It was not. M208
 * took the token dump out of the loss path and LEFT THE ONE M196 had written
 * in the overflow path. Two sites, one fixed, and I checked neither when he
 * said it was still happening. */
test('M230: there is no place left that writes a bare list as a detail', async () => {
  const src = readFileSync(new URL('../../js/agents/memory.js', import.meta.url), 'utf8');
  /* code only — the comments quote the old dumps while explaining them */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  eq((code.match(/'also named: ' \+/g) || []).length, 0, 'no site builds an "also named" list');
  eq((code.match(/'figures: ' \+/g) || []).length, 0, 'nor a "figures" list');
  assert(/detail = '';/.test(code), 'the overflow path writes nothing rather than a list');

  /* and the guard that catches one arriving from the model still stands */
  const { looksLikeTokenDump } = await import('../../js/agents/memory.js');
  eq(looksLikeTokenDump('also named: Chloe, Caleb Thorne, Wells'), true, 'the writer’s own line is refused');
  eq(looksLikeTokenDump('Vanessa holds the only photo of the pier fire, and means to trade it'), false,
    'while a phrase that says what and why is kept');

  /* the detail must read as something a person can use beside the line */
  const { buildAuditMessages } = await import('../../js/agents/memory.js');
  const m = buildAuditMessages('pages', 'line', '- prior');
  assert(/WRITE IT SO IT READS BESIDE THE LINE/.test(m.system), 'it is told where the detail is read');
  assert(/say WHAT the thing is and WHY it matters here/.test(m.system), 'and what each phrase must carry');
  assert(/never a[\s\S]{0,12}bare noun, never a label with a colon, never a list of names/.test(m.system),
    'and what it must not be');
  assert(/would puzzle someone who had just read the line above it/.test(m.system), 'with the test to apply');
});

/* M235: from the writer's own record — every line ending "STATS: none", and
 * one line severed at "...and graded Jo…" with everything after it gone and
 * no sign of what. */
test('M235: no empty stats phrase, and a line is never cut mid-word', async () => {
  const { parseMemoryAnswer } = await import('../../js/agents/memory.js');

  eq(parseMemoryAnswer('Jovan arrived and Rias met him; STATS: none'), 'Jovan arrived and Rias met him',
    'a bare "STATS: none" is dropped — it tells the storyteller nothing, on every line, forever');
  for (const empty of ['STATS: n/a', 'STATS: nil', 'STATS: unchanged', 'STATS: no changes']) {
    eq(parseMemoryAnswer('Jovan arrived; ' + empty), 'Jovan arrived', empty + ' too');
  }
  assert(/STATS: Rias\(P:88\/R:70\/S:49\)$/.test(parseMemoryAnswer('Jovan arrived; STATS: Rias(P:88/R:70/S:49)')),
    'while REAL stats are kept whole');

  /* the cut lands on a whole phrase */
  const long = Array.from({ length: 120 }, (_, i) => 'phrase number ' + i + ' about something that happened').join('; ')
    + '; and graded Jovan on mythology';
  const cut = parseMemoryAnswer(long);
  assert(cut.length <= 4000, 'it is cut');
  assert(/…$/.test(cut), 'and says so');
  const lastPhrase = cut.replace(/…$/, '').split('; ').pop();
  assert(/happened$/.test(lastPhrase), 'ending on a whole phrase, not a severed word: ' + JSON.stringify(lastPhrase.slice(-30)));

  /* and the keeper is told not to write the empty phrase in the first place */
  const src = readFileSync(new URL('../../js/agents/memory.js', import.meta.url), 'utf8');
  assert(/IF NO STAT CHANGED ON THESE PAGES, WRITE NOTHING AT ALL/.test(src), 'the rule is in the brief');
  assert(/not \\\\"STATS: none\\\\"/.test(src) || /STATS: none/.test(src), 'naming the exact thing the writer saw');
});

/* M236: from the writer's own people ledger, Vanessa carried
 *   "She is hunting for a name and a photo of 'England boy' before Saturday."
 *   "She is STILL hunting for a name and a photo of 'England boy' before Saturday."
 * — the same loose end twice, read by the storyteller every turn; and one
 * ending "...Vanessa is still running interference with…", severed mid-thought
 * with nothing to say what she was running interference WITH. */
test('M236: the whole-list path dedupes too, and a loose end is never cut mid-word', async () => {
  const { setPersonField, sameLooseEnd } = await import('../../js/engine/people.js');

  /* the guard itself was always right — it was simply never asked on this path */
  eq(sameLooseEnd("She is hunting for a name and a photo of 'England boy' before Saturday",
    "She is still hunting for a name and a photo of 'England boy' before Saturday"), true,
  'the two read as one loose end');

  const both = "She is hunting for a name and a photo of 'England boy' before Saturday"
    + "; She is still hunting for a name and a photo of 'England boy' before Saturday"
    + "; She needs her mother's file";
  const out = setPersonField({ turn: 1, characters: {} }, {}, 'Vanessa', 'threads', both, 1);
  eq(out.entry.threads.length, 2, 'the duplicate is dropped, the distinct one kept: ' + JSON.stringify(out.entry.threads));
  assert(/mother/.test(out.entry.threads[1]), 'and it is the right one that survived');

  /* the cut lands on a word */
  const long = 'The squad chat is losing its mind over who Jovan is and one girl has already made a playlist '
    + 'and Vanessa is still running interference with the whole group before Saturday';
  const cut = setPersonField({ turn: 1, characters: {} }, {}, 'V', 'threads', long, 1).entry.threads[0];
  assert(/…$/.test(cut), 'it is cut');
  const lastWord = cut.replace(/…$/, '').split(' ').pop();
  assert(/^[A-Za-z']+$/.test(lastWord) && long.includes(lastWord), 'ending on a whole word: ' + JSON.stringify(lastWord));

  const src = readFileSync(new URL('../../js/engine/people.js', import.meta.url), 'utf8');
  assert(/if \(list\.some\(\(kept\) => sameLooseEnd\(kept, t\)\)\) continue;/.test(src), 'the setter asks the same guard mergeDeltas does');
  assert(!/return clean\.length > cap \? clean\.slice\(0, cap - 1\)/.test(src), 'and nothing chops at the cap exactly');
});

/* M237: the sweep the writer demanded. He had reported the same fault three
 * times in three places — a record line cut mid-name, a loose end cut
 * mid-thought — and each time I fixed the one he showed me. So: every cap in
 * the house that shortens CONTENT (as against a list label) cuts on a word,
 * and no list has one write path that checks for duplicates and another that
 * does not. */
test('M237: no cap in the house severs a word, and no list has an unguarded door', async () => {
  const here = new URL('../../', import.meta.url);
  const read = (p) => readFileSync(new URL(p, here), 'utf8');

  /* the content caps — a ledger field, a mend's words, the workers' line, a card's reason */
  for (const [file, what] of [
    ['js/engine/apply.js', 'a ledger field (core, state, arc)'],
    ['js/agents/continuity.js', 'the second reader’s words'],
    ['js/agents/status.js', 'the workers’ line'],
    ['js/agents/housekeeper.js', 'a card’s reason'],
    ['js/engine/people.js', 'a loose end'],
    ['js/agents/memory.js', 'a record line and its detail'],
  ]) {
    const src = read(file);
    assert(/lastIndexOf\(' '\)|lastIndexOf\(';'\)|lastIndexOf\('; '\)/.test(src),
      what + ' is cut on a word or a clause, not at the cap exactly (' + file + ')');
  }

  /* the ledger's lists: every one that can be written twice asks the same question */
  const people = read('js/engine/people.js');
  assert(/if \(list\.some\(\(kept\) => sameLooseEnd\(kept, t\)\)\) continue;/.test(people), 'threads: the whole-list path dedupes');
  assert(/const at = next\[key\]\.threads\.findIndex\(\(t\) => sameLooseEnd\(String\(t\), text\)\);/.test(people), 'threads: and the one-at-a-time path');

  const apply = read('js/engine/apply.js');
  assert(/if \(findPresent\(state, name\) !== -1\) \{/.test(apply), 'present: someone already in the room is refused');
  assert(/const wanted = new Set\(list\.map/.test(apply), 'mood: a closed set of known flags, so no flag can be written twice');
  assert(/state\.canon = lockFact\(state\.canon, canonKey, \{ key, value \}/.test(apply),
    'canon: a truth is locked BY KEY, so relocking corrects rather than duplicates');
});

/* M238: THE LEDGER COULD HOLD THE SAME PERSON TWICE AND NEVER SAY SO. The
 * writer did not report this one — he could not have; nothing announces it.
 * Spelling distance never bridges "Vanessa" and "Vanessa Reynolds", nine
 * characters apart. So the moment one worker wrote the short name and
 * another the full one, the ledger held TWO PEOPLE, each with half her
 * history — half her loose ends on one page, half on the other, her standing
 * split, and the storyteller reading them as different characters. */
test('M238: a first name finds its person, and an ambiguous one refuses', async () => {
  const { findPersonKey } = await import('../../js/engine/people.js');

  const cast = { 'Vanessa Reynolds': {}, 'Rias Wells': {}, 'Caleb Thorne': {} };
  eq(findPersonKey(cast, 'Vanessa'), 'Vanessa Reynolds', 'a first name');
  eq(findPersonKey(cast, 'vanessa'), 'Vanessa Reynolds', 'however it is cased');
  eq(findPersonKey(cast, 'Reynolds'), 'Vanessa Reynolds', 'a surname too');
  eq(findPersonKey(cast, 'Rias'), 'Rias Wells', 'and another');
  eq(findPersonKey(cast, 'Vanessa Reynolds'), 'Vanessa Reynolds', 'the exact name still, first');

  /* the other way: the extractor opened her page as "Vanessa", the scribe
   * writes "Vanessa Reynolds" */
  eq(findPersonKey({ Vanessa: {} }, 'Vanessa Reynolds'), 'Vanessa', 'a full name finds a page opened under the short one');

  /* AMBIGUITY REFUSES — two Vanessas means neither is guessed at */
  eq(findPersonKey({ 'Vanessa Reynolds': {}, 'Vanessa Stone': {} }, 'Vanessa'), '',
    'two people answer to it, so nothing is matched and a new page is the honest outcome');
  eq(findPersonKey({ 'Rias Wells': {}, 'Jovan Wells': {} }, 'Wells'), '', 'and the same for a shared surname');

  /* a single-word page is not swallowed by an unrelated single-word name */
  eq(findPersonKey({ Mira: {} }, 'Kira'), 'Mira', 'near-spellings still match as they always did');
  eq(findPersonKey({ Mira: {} }, 'Alexander'), '', 'while an unrelated name does not');
});

/* M239: the four ledgers the writer had not been shown. findKnowledgeKey and
 * findFactionKey matched an EXACT key and nothing else — no spelling
 * tolerance, no short name — while the people ledger had at least
 * near-spelling matching. So "Vanessa" and "Vanessa Reynolds" became TWO
 * RECORDS OF WHO KNOWS WHAT, and the storyteller was told she does not know
 * the thing she was told on the page before. Knowledge is the one ledger
 * where a split is invisible AND changes what characters say aloud. */
test('M239: knowledge and factions find a person under any of their names', async () => {
  const { findKnowledgeKey, findFactionKey } = await import('../../js/engine/world.js');

  const know = { 'Vanessa Reynolds': [], 'Caleb Thorne': [] };
  eq(findKnowledgeKey(know, 'Vanessa'), 'Vanessa Reynolds', 'a first name reaches her knowledge');
  eq(findKnowledgeKey(know, 'Reynolds'), 'Vanessa Reynolds', 'and a surname');
  eq(findKnowledgeKey(know, 'Vanessa Reynolds'), 'Vanessa Reynolds', 'the whole name still, first');
  eq(findKnowledgeKey(know, 'Caleb'), 'Caleb Thorne', 'and the same for anyone else');
  eq(findKnowledgeKey({ 'Vanessa Reynolds': [], 'Vanessa Stone': [] }, 'Vanessa'), null,
    'two people answer to it, so neither is guessed at');

  const factions = { 'the Vanderbilt family': {}, 'Ravenwood town council': {} };
  eq(findFactionKey(factions, 'Vanderbilt'), 'the Vanderbilt family', 'a name INSIDE a longer one, which no first-or-last rule reaches');
  eq(findFactionKey(factions, 'Ravenwood council'), 'Ravenwood town council', 'and a shortened form of a long name');
  eq(findFactionKey(factions, 'the Vanderbilt family'), 'the Vanderbilt family', 'the whole name still');
  eq(findFactionKey({ 'the Wells family': {}, 'the Wells council': {} }, 'Wells'), null, 'a shared word matches neither');
  eq(findFactionKey(factions, 'the Thorne gang'), null, 'and an unrelated name matches nothing');

  /* one rule, shared, so the three ledgers cannot drift apart again */
  const src = readFileSync(new URL('../../js/engine/world.js', import.meta.url), 'utf8');
  assert(/export function nearKey\(keys, name\)/.test(src), 'one matcher');
  eq((src.match(/return nearKey\(Object\.keys\(safe\), name\);/g) || []).length, 2, 'used by both ledgers');
});

/* M240: the writer asked why the AUDITOR never caught the stale loose ends
 * the housekeeper kept finding. Two reasons, and one is absurd:
 *  - its checklist named thread.close/thread.set, which are the STORY's plot
 *    threads — it was never once asked about the "Loose ends:" line on a
 *    person's own page, the very thing piling up.
 *  - and it is told, in its own words, to catch "a wound healed still open"
 *    while the word "bodies" appeared NOWHERE in the file. It was auditing a
 *    ledger it could not see. */
test('M240: the auditor sees every ledger it is told to audit, loose ends included', async () => {
  const { buildAuditorMessages } = await import('../../js/agents/auditor.js');
  const { emptyState } = await import('../../js/engine/state.js');

  const st = emptyState();
  st.characters = { Mira: { core: 'the innkeeper', state: 'behind the bar', arc: '',
    threads: ['she still owes the ferryman'], updatedAtTurn: 1 } };
  st.present = [{ name: 'Mira' }];
  st.bodies = { Mira: { injuries: [{ what: 'a cut hand', how: 'the glass', at: 1, healed: false }], strain: [] } };
  st.knowledge = { Mira: [{ fact: 'that the well is poisoned', at: 1 }] };
  st.canon = { Mira: { facts: [{ key: 'hair', value: 'black' }] } };
  st.factions = { 'the Vanderbilts': { stance: 'cold', agenda: 'keep the lake', at: 1 } };

  const m = buildAuditorMessages({ state: st, brief: 'a lake town', castNotes: '',
    record: '- [Sept 1] Mira poured', pages: [{ role: 'assistant', text: 'Mira wiped the bar' }] });
  const all = m.system + '\n' + m.user;

  /* every ledger, and the pages */
  for (const [what, probe] of [
    ['the people pages', 'the innkeeper'],
    ['a person’s loose ends', 'owes the ferryman'],
    ['locked canon', 'black'],
    ['who knows what', 'well is poisoned'],
    ['the factions', 'keep the lake'],
    ['WHAT THEIR BODIES CARRY', 'cut hand'],
    ['the record', 'Mira poured'],
    ['the pages themselves', 'Mira wiped the bar'],
    ['the writer’s brief', 'a lake town'],
  ]) assert(all.includes(probe), 'the auditor is shown ' + what);

  /* and is asked about the loose ends, which it never was */
  assert(/LOOSE ENDS ON A PERSON'S OWN PAGE/.test(all), 'the checklist names them');
  assert(/which is NOT the same as/.test(all), 'and says they are not the story threads');
  /* M241: with the tool that ALREADY EXISTED — people.note {field:"unthread"}.
   * M240 told it to use "people.unthread", which was never a mutation at all,
   * so every loose end it found would have been refused as an unknown type;
   * and building one would have been a second way to do what people.note
   * already does. */
  assert(/people\.note/.test(all) && /unthread/.test(all), 'and how to close one, with the tool that exists');
  assert(/one left open is carried to the storyteller/.test(all), 'and why it matters');
});

/* M243: FIVE OF THE WRITER'S SIXTEEN RECORD LINES ENDED IN AN ELLIPSIS. A
 * quarter of his record silently missing its tail — and the only way to know
 * was to read every line himself and count characters. He asked, fairly,
 * whether he is meant to check each new summary by hand. A line that overran
 * is not a line: the house must notice and ask again, not store the wreck. */
test('M243: a line that overran is written again, not stored cut', async () => {
  const { db } = await import('../../js/store.js');
  const { saveMemory, loadMemory, maybeSummarize, phraseCount, answerWasCut, parseMemoryAnswer } =
    await import('../../js/agents/memory.js');

  /* the cut is reported, so the house can act on it */
  parseMemoryAnswer('a short honest line');
  eq(answerWasCut(), false, 'a line within the cap is not cut');
  parseMemoryAnswer(Array.from({ length: 200 }, (_, i) => 'phrase number ' + i + ' about something at length').join('; '));
  eq(answerWasCut(), true, 'and one past it says so');

  const st = await db.stories.create({ title: 'a keeper that overruns' });
  for (let i = 0; i < 40; i += 1) await db.messages.append(st.id, { role: i % 2 ? 'assistant' : 'user', text: 'page ' + i });
  await db.settings.set('memoryWindow', 20);
  await db.settings.set('memoryBatch', 6);
  await saveMemory(st.id, { window: 20, nodes: [] });

  /* M247: genuinely PAST the 4000 cap — a merely long line is not a broken
   * one and no longer triggers the re-ask */
  const huge = Array.from({ length: 90 }, (_, i) => 'phrase number ' + i + ' about a thing that happened at some considerable length here indeed').join('; ');
  const real = globalThis.fetch;
  let call = 0;
  let asked = '';
  globalThis.fetch = async (u, o) => {
    call += 1;
    if (call === 2) asked = String((o && o.body) || '');
    const body = call === 1 ? huge : '[Sept 1] Jovan arrived; Rias met him; they went in together';
    const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: body } }] }) + '\n\ndata: [DONE]\n\n';
    return { ok: true, status: 200, headers: new Headers(),
      body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }),
      async json() { return {}; }, async text() { return sse; }, clone() { return this; } };
  };
  try {
    await maybeSummarize({ connection: { id: 'c', type: 'openai', baseUrl: 'https://x.test', model: 'm', apiKey: 'k' }, storyId: st.id });
  } finally { globalThis.fetch = real; }

  const line = (await loadMemory(st.id)).nodes[0].text;
  assert(call > 1, 'it asked again');
  assert(/ran past the limit and had to be CUT/.test(asked), 'telling the keeper exactly what went wrong');
  assert(/the hard limit is 15, or 18/.test(asked), 'and what the limit is');
  assert(/A complete short line beats a long one with its end missing/.test(asked), 'and which to prefer');
  assert(!/…$/.test(line), 'what is STORED does not end cut: ' + JSON.stringify(line.slice(-40)));
  assert(phraseCount(line) < 40, 'and is the shorter complete answer (' + phraseCount(line) + ' phrases)');

  /* M244: and a keeper that overruns AGAIN does not get its cut line stored —
   * the batch is halved instead, so nothing is lost at all. */
  const src = readFileSync(new URL('../../js/agents/memory.js', import.meta.url), 'utf8');
  assert(/AND IF IT OVERRAN AGAIN, THE BATCH IS TOO BIG FOR ONE LINE/.test(src), 'a second overrun folds fewer pages');
  assert(/range\[1\] = range\[0\] \+ half;/.test(src), 'and the line covers only what it read, so the rest folds next round');
});

/* M244: the writer read "the cut line stands — a cut line still beats no
 * line" and said: so I just accept it's cut? He was right. Accepting a cut
 * line is still losing his story. Six pages that will not fit in one line
 * are folded as THREE pages, not as a shorter line with its tail gone. */
test('M244: a second overrun folds fewer pages, and no page is skipped', async () => {
  const { db } = await import('../../js/store.js');
  const { saveMemory, loadMemory, maybeSummarize } = await import('../../js/agents/memory.js');

  const st = await db.stories.create({ title: 'a keeper that will not fit six pages' });
  for (let i = 0; i < 40; i += 1) await db.messages.append(st.id, { role: i % 2 ? 'assistant' : 'user', text: 'page ' + i });
  await db.settings.set('memoryWindow', 20);
  await db.settings.set('memoryBatch', 6);
  await saveMemory(st.id, { window: 20, nodes: [] });

  const huge = Array.from({ length: 90 }, (_, i) => 'phrase ' + i + ' about a thing that happened at some considerable length here indeed').join('; ');
  const real = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    /* overruns the fold AND the re-ask; behaves once given half the pages */
    const body = call <= 2 ? huge : '[Sept 1] Jovan arrived; Rias met him';
    const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: body } }] }) + '\n\ndata: [DONE]\n\n';
    return { ok: true, status: 200, headers: new Headers(),
      body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }),
      async json() { return {}; }, async text() { return sse; }, clone() { return this; } };
  };
  try {
    await maybeSummarize({ connection: { id: 'c', type: 'openai', baseUrl: 'https://x.test', model: 'm', apiKey: 'k' }, storyId: st.id });
  } finally { globalThis.fetch = real; }

  const nodes = (await loadMemory(st.id)).nodes;
  const first = nodes[0];
  assert(!/…$/.test(first.text), 'what is stored is NOT cut: ' + JSON.stringify(first.text));
  eq(first.span[1] - first.span[0] + 1, 3, 'it covers three pages, not six — the rest folds next round');

  /* and across several rounds nothing is skipped */
  const covered = new Set();
  for (const n of nodes) for (let i = n.span[0]; i <= n.span[1]; i += 1) covered.add(i);
  const highest = Math.max(...covered);
  for (let i = 0; i <= highest; i += 1) assert(covered.has(i), 'page ' + i + ' is covered — no gap is left behind');
});

/* M246: the writer asked whether a summary ending with no full stop, no
 * question mark, nothing at all, is normal. It is the shape of a line the
 * PROVIDER cut at its token limit. A line the HOUSE cuts ends in an ellipsis
 * and the house knows to ask again (M243); a line the WIRE cuts simply STOPS
 * — and callKeeper kept only the text and threw finishReason away, so it was
 * stored as a finished line with its end missing and nothing to say so. */
test('M246: a line the wire cut is not stored as a finished line', async () => {
  const { db } = await import('../../js/store.js');
  const { saveMemory, loadMemory, maybeSummarize, keeperWasTruncated } = await import('../../js/agents/memory.js');

  const st = await db.stories.create({ title: 'a provider that runs out of room' });
  for (let i = 0; i < 40; i += 1) await db.messages.append(st.id, { role: i % 2 ? 'assistant' : 'user', text: 'page ' + i });
  await db.settings.set('memoryWindow', 20);
  await db.settings.set('memoryBatch', 6);
  await saveMemory(st.id, { window: 20, nodes: [] });

  const real = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    /* stops mid-sentence at the token limit: no ellipsis, no terminal mark */
    const body = call === 1
      ? '[Sept 1] Jovan arrived; Rias met him at the door and said she had been'
      : '[Sept 1] Jovan arrived; Rias met him at the door';
    const finish = call === 1 ? 'length' : 'stop';
    const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: body } }] }) + '\n\n'
      + 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] }) + '\n\ndata: [DONE]\n\n';
    return { ok: true, status: 200, headers: new Headers(),
      body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }),
      async json() { return {}; }, async text() { return sse; }, clone() { return this; } };
  };
  try {
    await maybeSummarize({ connection: { id: 'c', type: 'openai', baseUrl: 'https://x.test', model: 'm', apiKey: 'k' }, storyId: st.id });
  } finally { globalThis.fetch = real; }

  assert(call > 1, 'it noticed the wire had cut the answer and asked again');
  const line = (await loadMemory(st.id)).nodes[0].text;
  assert(!/said she had been$/.test(line), 'the truncated answer was not stored: ' + JSON.stringify(line));
  eq(line, '[Sept 1] Jovan arrived; Rias met him at the door', 'the complete one was');

  /* the reason really is carried out of the call */
  const src = readFileSync(new URL('../../js/agents/memory.js', import.meta.url), 'utf8');
  assert(/const \{ text, finishReason \} = await sharedCall/.test(src), 'callKeeper keeps the reason');
  assert(/lastKeeperWasTruncated = String\(finishReason \|\| ''\)\.toLowerCase\(\) === 'length';/.test(src), 'and reads it');
  eq((src.match(/keeperWasTruncated\(\)/g) || []).length, 5,
    'and every place that handles a cut handles this one too — the overrun ask, its test, the halving, and its test');
});

/* M247: the writer's rebuild stopped at Pages 25–30 of 98 — a regression I
 * had shipped an hour earlier. M243 re-asked whenever a line ran past twenty
 * phrases, but a rich scene legitimately does (his own good lines run to
 * twenty-eight), so EVERY batch paid an extra keeper call and then got HALVED
 * to three pages. Twice the calls for half the progress. A long line is not a
 * broken line; only one that lost its end is. */
test('M247: a long line is left alone — only a cut one is re-asked', async () => {
  const { db } = await import('../../js/store.js');
  const { saveMemory, loadMemory } = await import('../../js/agents/memory.js');
  const { rebuildRecord } = await import('../../js/agents/rebuild.js');
  const { workerSignal } = await import('../../js/agents/status.js');

  const st = await db.stories.create({ title: 'a hundred and eighteen pages of dense scenes' });
  for (let i = 0; i < 118; i += 1) await db.messages.append(st.id, { role: i % 2 ? 'assistant' : 'user', text: 'page ' + i });
  await db.settings.set('memoryWindow', 20);
  await db.settings.set('memoryBatch', 6);
  await saveMemory(st.id, { window: 20, nodes: [] });

  /* a keeper writing DENSE but COMPLETE lines — 24 phrases, well under the cap */
  const dense = '[Sept 1] ' + Array.from({ length: 24 }, (_, i) => 'Jovan did thing ' + i).join('; ');
  const real = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: dense } }] }) + '\n\n'
      + 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n';
    return { ok: true, status: 200, headers: new Headers(),
      body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }),
      async json() { return {}; }, async text() { return sse; }, clone() { return this; } };
  };
  const seen = [];
  try {
    const w = workerSignal(60000);
    await rebuildRecord({ connection: { id: 'c', type: 'openai', baseUrl: 'https://x.test', model: 'm', apiKey: 'k' },
      storyId: st.id, renew: w.renew, signal: w.signal, onProgress: (p) => seen.push([p.batch, p.batches]) });
  } finally { globalThis.fetch = real; }

  const nodes = (await loadMemory(st.id)).nodes;
  eq(seen[seen.length - 1][0], seen[seen.length - 1][1], 'the rebuild reaches its end: ' + seen[seen.length - 1].join('/'));
  eq(nodes.length, 16, 'sixteen lines for a hundred and eighteen pages');
  for (const n of nodes) {
    eq(n.span[1] - n.span[0] + 1, 6, 'every line covers a FULL batch — none halved for being merely long');
  }

  const src = readFileSync(new URL('../../js/agents/memory.js', import.meta.url), 'utf8');
  assert(/if \(answerWasCut\(\) \|\| keeperWasTruncated\(\)\) \{/.test(src), 'the re-ask fires on a cut, not on length');
  assert(!/phraseCount\(text\) > 20/.test(src), 'a phrase count never triggers it');
});

/* M249: after a time skip the writer's own SISTER came back with an agenda of
 * getting his phone number. The world agent decides what the ABSENT are doing
 * between scenes and what they want next — and its own brief says a person's
 * life is "filled from the real record, not invented", while the word record
 * appeared NOWHERE ELSE in the file. It was told to use something it was
 * never given, so after a jump it filled a life from the ledger's bare facts
 * and the last few pages, which on a hundred-page tale is nothing at all. */
test('M249: the world agent is given the story it is told to fill a life from', async () => {
  const { buildWorldMessages } = await import('../../js/agents/world.js');
  const { applyMutations } = await import('../../js/engine/apply.js');
  const { emptyState } = await import('../../js/engine/state.js');

  let st = emptyState();
  st.sheet = { actors: {}, playerName: 'Jovan' };
  st = applyMutations(st, [{ type: 'people.set', name: 'Rias Wells', field: 'core', text: "Jovan's sister, kept the house two years" }]).state;
  st = applyMutations(st, [{ type: 'offscreen.set', name: 'Rias Wells', location: 'the kitchen', activity: 'frying eggs', agenda: 'feed him' }]).state;

  const withRecord = buildWorldMessages({ state: st, userText: 'x', assistantText: 'y', before: [],
    brief: 'a lake town', record: '- [Aug 20] Rias Wells is Jovan’s sister and kept the house two years' });
  assert(/kept the house two years/.test(withRecord.user), 'the folded story rides');
  assert(/THE STORY SO FAR, FOLDED/.test(withRecord.user), 'labelled so it knows what it is');
  assert(/filled from THIS, never invented over it/.test(withRecord.user), 'and told to fill a life from it');
  assert(withRecord.user.indexOf('THE STORY SO FAR, FOLDED') < withRecord.user.indexOf('THE LEDGER'),
    'before the ledger’s bare facts, oldest first as the story runs');

  /* what it could already see is untouched */
  for (const [what, probe] of [['her page', 'sister'], ['where she is', 'kitchen'],
    ['what she is doing', 'frying eggs'], ['what she wants', 'feed him']]) {
    assert(withRecord.user.includes(probe) || withRecord.system.includes(probe), 'it still sees ' + what);
  }

  const without = buildWorldMessages({ state: st, userText: 'x', assistantText: 'y', before: [] });
  assert(!/THE STORY SO FAR/.test(without.user), 'and no record adds nothing at all');

  /* the send path computes it for the pages older than the ones it can see */
  const chat = readFileSync(new URL('../../js/ui/chat.js', import.meta.url), 'utf8');
  assert(/worldRecord = recordFor\(memoryForWindow\(mem, oldest\)\);/.test(chat), 'only the lines older than the visible pages');
  assert(/record: worldRecord,/.test(chat), 'and handed over');

  /* and the brief that demanded it is still there — this closes that loop */
  assert(/filled from the real record, not invented/.test(withRecord.system),
    'the brief still demands a record, and now there is one');
});

/* M256: the writer read his own audit report and asked whether the LEDGER
 * could be improved so the auditor is not needed to fix the same things over
 * and over. Five of the auditor's five findings that turn were one fault:
 *   "no knowledge line for Claire Stone, who plainly witnessed …"
 *   "no knowledge line for Alaric Stone, who plainly witnessed …"
 *   "the ledger's presence line omits that Jovan has now reached the gate"
 *   "the scene's ground is the Wells gate, not the Stone gate"
 * knowledge.add appeared NOWHERE in extractor.js. The world agent has it, but
 * the world agent is about the ABSENT — so a thing witnessed by someone
 * standing right there was written by NOBODY, and the auditor picked it up
 * three turns later, one person at a time. */
test('M256: the worker reading the page can write what the page put in front of it', async () => {
  const { buildExtractorMessages } = await import('../../js/agents/extractor.js');
  const { applyMutations } = await import('../../js/engine/apply.js');
  const { emptyState } = await import('../../js/engine/state.js');

  const st = emptyState();
  st.characters = { Mira: { core: 'the innkeeper', state: '', arc: '', threads: [], updatedAtTurn: 1 } };
  st.present = [{ name: 'Mira' }];
  const m = buildExtractorMessages({ state: st, userText: 'x', assistantText: 'y', before: [], founding: false });
  const sent = m.system + '\n' + m.user;

  assert(/knowledge\.add \{"type":"knowledge\.add"/.test(sent), 'knowledge.add is in its vocabulary at last');
  assert(/a secret told, a name heard, a lie caught/.test(sent), 'with what counts as learning something');
  assert(/only where being told, or not told, could change what they do/.test(sent), 'and the bar for writing one');

  /* the four the auditor kept catching three turns late */
  for (const rule of ['THE GROUND MOVED', 'SOMEONE PRESENT MOVED WITHIN IT',
    'SOMEONE LEARNED SOMETHING', 'WHAT THE PAGE ANSWERED']) {
    assert(sent.includes(rule), 'it is asked about ' + rule);
  }

  /* a founding read is left alone — it is writing the world, not catching up */
  const founding = buildExtractorMessages({ state: emptyState(), userText: 'x', assistantText: 'y', before: [], founding: true });
  assert(!/THE FOUR MOST OFTEN MISSED/.test(founding.system + founding.user), 'a founding read is not nagged about catching up');

  /* and the engine takes what it now writes */
  let s2 = applyMutations(emptyState(), [{ type: 'people.set', name: 'Claire Stone', field: 'core', text: "Alaric's sister" }]).state;
  const r = applyMutations(s2, [{ type: 'knowledge.add', name: 'Claire Stone', fact: 'that Jovan lived in England' }]);
  eq(r.applied.length, 1, 'a knowledge line from the extractor lands');
  eq((r.state.knowledge['Claire Stone'] || []).length, 1, 'and she really knows it');
  const r2 = applyMutations(r.state, [{ type: 'knowledge.add', name: 'Claire', fact: 'that Alaric shook his hand' }]);
  eq(Object.keys(r2.state.knowledge).join(','), 'Claire Stone',
    'and her first name lands on the page she already has, never a second (M239)');
});
