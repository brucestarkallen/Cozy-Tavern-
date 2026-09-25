/* M482 — a descriptor is not a person: "Jovan's stepsister" is Vivi at every door; the eye's asterisks and bold are
 * mended, not only named; a knowledge line is written in the page's own terms (the rule is on the contract). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { applyMutations } from '../../js/engine/apply.js';
import { resolveDescriptor } from '../../js/engine/people.js';
import { emptyState } from '../../js/engine/state.js';
import { mendMarks, tidyPage } from '../../js/ui/pageshape.js';
import { buildExtractorMessages } from '../../js/agents/extractor.js';

const mk = () => { const s = emptyState(); s.sheet = { actors: {}, playerName: 'Jovan Arden' };
  s.characters = { Vivi: { core: 'Jovan’s rich younger stepsister; loud, a manicure.', state: 'texting', updatedAtTurn: 1 }, Claire: { core: 'His older sister.', updatedAtTurn: 1 }, 'Kara Zor-El': { core: 'Supergirl, bloodied.', updatedAtTurn: 1 }, Mara: { core: 'the innkeeper; her sister runs the ferry', updatedAtTurn: 1 }, Nell: { core: 'Mara’s sister, the ferrywoman', updatedAtTurn: 1 } };
  return s; };

test('M482-1 resolveDescriptor: the relation to a named person finds the one page that carries it; adjectives narrow it; a pronoun owner is the main character; another person’s pronoun never; two answers are none', () => {
  const s = mk();
  eq(resolveDescriptor(s, "Jovan's stepsister"), 'Vivi');
  eq(resolveDescriptor(s, 'Jovan’s rich younger stepsister'), 'Vivi');
  eq(resolveDescriptor(s, 'his stepsister'), 'Vivi', 'his = the main character');
  eq(resolveDescriptor(s, 'my stepsister'), 'Vivi');
  eq(resolveDescriptor(s, 'the older sister'), 'Claire', 'the adjective narrows it');
  eq(resolveDescriptor(s, "Mara's sister"), 'Nell', 'by her name, not by Claire’s "his"');
  eq(resolveDescriptor(s, "Jovan's sister"), null, 'two sisters answer: nobody — a page of its own may stand');
  eq(resolveDescriptor(s, "Kara's cousin"), null, 'nobody carries it');
  eq(resolveDescriptor(s, 'Vivi'), null, 'a name is not a descriptor');
  eq(resolveDescriptor(s, 'Ivo the ferryman'), null);
});

test('M482-2 every door: a seat, a page, a knowledge line, a walk-in and a standing under the descriptor land on Vivi — never a second person', () => {
  const s = mk();
  const r = applyMutations(s, [
    { type: 'offscreen.set', name: "Jovan's stepsister", location: 'the family house', activity: 'calling their mother' },
    { type: 'people.set', name: "Jovan's stepsister", field: 'state', text: 'furious, dialling' },
    { type: 'knowledge.add', name: "Jovan's stepsister", fact: 'that Jovan answered after fourteen missed calls' },
    { type: 'rel.shift', name: 'his stepsister', axis: 'p', delta: -2, cause: 'the missed calls' },
    { type: 'thread.set', title: 'the call to their mother', owner: "Jovan's stepsister", heat: 'hot', next: 'she dials' },
  ]);
  eq(Object.keys(r.state.characters).filter((k) => /stepsister/i.test(k)).length, 0, 'no page under the descriptor');
  eq(r.state.characters.Vivi.state, 'furious, dialling', 'her page took the state');
  assert(r.state.offscreen.Vivi && !r.state.offscreen["Jovan's stepsister"], 'one seat, hers');
  assert(r.state.knowledge.Vivi && r.state.knowledge.Vivi.length === 1, 'her knowledge');
  assert(r.state.relationships.Vivi && !r.state.relationships['his stepsister'], 'her standing');
  const r2 = applyMutations(r.state, [{ type: 'presence.enter', name: 'his stepsister', position: 'at the door' }]);
  assert(r2.state.present.some((p) => p.name === 'Vivi') && !r2.state.present.some((p) => /stepsister/i.test(p.name)), 'she walks in as Vivi: ' + r2.state.present.map((p) => p.name).join(','));
  assert(!r2.state.offscreen.Vivi, 'and her seat is let go');
});

test('M482-3 the page repair mends what the eye only named: bold marks go, an action in asterisks loses them, a sound and a short thought keep theirs, a private thought’s markup is untouched', () => {
  const t = 'The phone buzzed. *bzz-bzz.* **Bold words** here. *hah— hh— it’s warm, it’s— oh my god it’s warm—* she said. *He is lying,* Aurora thought. ~t~*She is not telling the whole truth about the night.*~/t~';
  const m = mendMarks(t).text;
  assert(m.includes('*bzz-bzz.*'), 'a sound keeps its asterisks');
  assert(m.includes('Bold words here') && !m.includes('**'), 'bold marks go');
  assert(m.includes(' hah— hh— it’s warm, it’s— oh my god it’s warm— she said'), 'the action lost its asterisks: ' + m);
  assert(m.includes('*He is lying,*'), 'a short thought keeps them');
  assert(m.includes('~t~*She is not telling the whole truth about the night.*~/t~'), 'a private thought is an object');
  const page = '[X — Monday | 09:00 | sun | coat | here]\n\n' + t;
  assert(tidyPage(page, {}).did.includes('marks'));
  const msgs = buildExtractorMessages({ state: mk(), userText: 'I wait.', assistantText: 'The room was quiet.', pageNumber: 3 });
  assert(/in the page.s own terms/i.test(JSON.stringify(msgs)), 'the knowledge rule is on the contract');
});
