/* Cozy Tavern — harness laws of M771. His (24 October 2026): "Nothing on your update broke my persona right? Everything still
 * try to make my persona he's batman or something everything natural language". Measured against m768-001: the persona he
 * gives in plain words is read the same; but M769 kept his own name with a title off his page ("Mr. Wayne", "Master Bruce"
 * opened pages of their own beside Bruce Wayne's) and made a woman main character's own titled name another person ("Miss
 * Kyle" and "Ms. Kyle" walked into Selina Kyle's scene beside her). Each law fails on m770-001. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { emptyState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { isMc } from '../../js/engine/people.js';
import { sourcePersonaMutations } from '../../js/engine/duels.js';

const withMc = (mc) => applyMutations({ ...emptyState(), sheet: { actors: {}, playerName: mc, playerAliases: [] } }, [{ type: 'mc.set', name: mc }, { type: 'presence.enter', name: mc }, { type: 'people.note', name: mc, field: 'state', text: 'At home.' }]).state;
const writes = (n) => [{ type: 'people.note', name: n, field: 'thread', text: 'Find the Joker (' + n + ').' }, { type: 'knowledge.add', name: n, fact: 'The Joker escaped (' + n + ').' }];

test('M771-1 THE PERSONA HE GIVES IN PLAIN WORDS IS HIS: “I am Batman”, “My persona is Batman” — Batman is the main character', () => {
  for (const said of ['I am Batman. I swing down from the roof.', 'My persona is Batman, the Dark Knight.']) {
    let s = withMc('Bruce Wayne');
    s = applyMutations(s, sourcePersonaMutations(s, [{ text: said }], ['Batman'])).state;
    assert(isMc(s, 'Batman'), 'Batman is him after “' + said + '”');
    const r = applyMutations(s, [{ type: 'presence.enter', name: 'Batman' }, ...writes('Batman')]).state;
    eq(Object.keys(r.characters).join(','), 'Bruce Wayne', 'no page of his own for Batman');
    eq(r.present.filter((p) => p.name !== 'Bruce Wayne' && p.name !== 'Batman').length, 0, 'nobody else walked in');
  }
});

test('M771-2 HIS OWN NAME WITH A TITLE IS STILL HIS PAGE (“Mr. Wayne”, “Master Bruce” opened pages beside Bruce Wayne’s on m770-001); HIS MOTHER IS NOT HIM', () => {
  const r = applyMutations(withMc('Bruce Wayne'), [{ type: 'people.note', name: 'Mr. Wayne', field: 'thread', text: 'Find the Joker before dawn.' }, { type: 'knowledge.add', name: 'Mr. Wayne', fact: 'The Joker escaped.' },
    { type: 'people.note', name: 'Master Bruce', field: 'thread', text: 'Repay Alfred for the Batmobile repairs.' }, { type: 'knowledge.add', name: 'Master Bruce', fact: 'Alfred hid the key.' }]).state;
  eq(Object.keys(r.characters).join(','), 'Bruce Wayne', 'one page, his: ' + Object.keys(r.characters));
  eq(r.characters['Bruce Wayne'].threads.length, 2, 'both loose ends on it');
  eq(Object.keys(r.knowledge).join(','), 'Bruce Wayne', 'what he knows is his');
  const m = applyMutations(withMc('Jovan Arden'), [{ type: 'people.note', name: 'Mrs. Arden', field: 'core', text: 'His mother, a retired surgeon.' }]).state;
  eq(m.characters['Mrs. Arden'].core, 'His mother, a retired surgeon.', 'his mother has a page of her own (M769-P1)');
});

test('M771-3 A WOMAN MAIN CHARACTER’S OWN TITLED NAME IS HER (“Miss Kyle”, “Ms. Kyle” walked into Selina Kyle’s scene beside her on m770-001)', () => {
  const r = applyMutations(withMc('Selina Kyle'), [{ type: 'presence.enter', name: 'Miss Kyle' }, { type: 'presence.enter', name: 'Ms. Kyle' }, ...writes('Miss Kyle'), ...writes('Lady Kyle')]).state;
  eq(r.present.map((p) => p.name).join(','), 'Selina Kyle', 'she is in her scene once');
  eq(Object.keys(r.characters).join(','), 'Selina Kyle', 'one page, hers: ' + Object.keys(r.characters));
});
