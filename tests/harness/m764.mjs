/* Cozy Tavern — harness law of M764: someone the page only talks about is asked about. His (23 October 2026, 16:26), with his
 * two pages: "* Jovan Wessex — standing by the sedans, phone to his ear … * Vanessa Langley — camel coat * Deputy Vance — at the
 * gate, holding the log sheet for signatures, county uniform — why Vanessa still on the scene and not elsewhere??? AND JUST
 * camel coat wtf is camel coat … latest scene no Vanessa". She walked to her car on the page before; on his latest page the
 * telling never shows her — Vance: "Langley's car's still behind the holly", and her sedan swings for the gate. The page
 * reader is asked where each person is only for those the telling shows, so it was never asked about her; its law keeps
 * whoever the page does not show ("quiet, not gone"), and the house kept her (a named room on a part-of move keeps the quiet,
 * M758). The header's new ground ("the drive by the gate") let her place go: "Vanessa Langley — camel coat". Runs the real
 * page reader with the provider scripted at the wire — a reader that answers for whoever it is asked about — and the real
 * header; fails on m763-001. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { emptyState, headerMutations } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { extractTurn } from '../../js/agents/extractor.js';

const CONN = { type: 'openai', baseUrl: 'https://fixture.example/v1', apiKey: 'fixture', model: 'fixture', preset: 'custom', contextSize: 200000, reasoning: { effort: 'off' } };
const stream = (v) => new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: JSON.stringify(v) } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
const LATEST = `[Blackwood Manor, the drive by the gate — Saturday, November 8, 2025 | 00:23 | Wind thin off the ridge, work-lights buzzing | Slacks, dress shirt, vest — FBI windbreaker zipped | standing by the sedans, phone to his ear]

Jovan thumbed Claire's number while Vance checked taillights through the gate, and she picked up on the second buzz, the clatter of a typed report going still behind her voice.

"Wessex. You're outside, I can hear the wind. What?"

"Claire. I'm going back home. Do you need a ride, or you've got your own drive?"

A beat, small and warm. "Look at you, domestic by midnight. That's the wife's influence, that is. She cooked tonight, didn't she?" Keys chimed on her end as she found them in a pocket, *tink-tk*. "I'm landed, thank you. Mine's the rusted hatchback by the holly, I've been herding it around this county all week and it knows the way better than I do." The clatter resumed, slower. "I'm another twenty minutes, though. Vance wants the gate log countersigned, Langley's got me writing the book niche into the record twice, and Rennick keeps calling wanting me to confirm his own signature exists."

"Some night," he said.

"Some three years," she answered, and then, softer, past the professional: "Go home, Jovan. It's a pile of dead people and it's nobody's fire but ours. Kiss Anne like she kept you alive tonight, because honestly." A dry half-laugh. "I'll see you at first light with the camera probe, assuming Langley doesn't light-fire me for driving the evidence bags at lawful speed."

She rang off before he could renegotiate, *klik*, and Vance glanced up from the gate log with a pen out.

"That the last of your crew?" he asked, pencil hovering. "Langley's car's still behind the holly. You clearing out first?"

The pencil waited, Vance's eyes mild and not idle, the county night man's version of a question. Beyond the holly, a door thumped, *thud*, and headlights woke white down the tree line as the Bureau's gray sedan swung for the gate behind him, Claire's wheels crunching slow gravel toward the gap in the work-lights where Vance stood waiting with his book.`;
const SEDAN = 'Beyond the holly, a door thumped, *thud*, and headlights woke white down the tree line as the Bureau\'s gray sedan swung for the gate behind him';

/* the ledger as the page before left it: she turned toward her car; Marcus Hale stands quiet by the sedans, never named */
function before() {
  return applyMutations({ ...emptyState(), page: 40 }, [
    { type: 'mc.set', name: 'Jovan Wessex' },
    { type: 'place.set', name: 'Blackwood Manor, the drive' },
    { type: 'clock.set', year: 2025, month: 11, day: 8, hour: 0, minute: 21 },
    { type: 'presence.enter', name: 'Jovan Wessex', position: 'stopped on the drive facing Vanessa' },
    { type: 'presence.enter', name: 'Vanessa Langley', position: 'on the drive, turning toward her car', attire: 'camel coat' },
    { type: 'presence.enter', name: 'Marcus Hale', position: 'leaning on the second sedan', attire: 'county parka' },
    { type: 'presence.enter', name: 'Deputy Vance', position: 'at the gate with his clipboard', attire: 'county uniform' },
  ]).state;
}
/* a reader that does as it is told: it answers for each person it is asked about, from the page; whoever it is not asked
 * about it leaves alone (its law: someone the page does not show is quiet, not gone) */
function reader(user) {
  const asked = (name) => new RegExp('\\n\\d+\\. ' + name + ' — the ledger has').test(user);
  return {
    mutations: asked('Vanessa Langley') ? [{ type: 'presence.leave', name: 'Vanessa Langley', to: 'her car behind the holly, driving out through the gate', shown: SEDAN }] : [],
    here: [{ name: 'Jovan Wessex', ending: { position: 'standing by the sedans, phone to his ear', shown: 'Jovan thumbed Claire\'s number' } },
      { name: 'Deputy Vance', ending: { position: 'at the gate, holding the log sheet for signatures', shown: 'Vance glanced up from the gate log with a pen out' } }],
    brief: { pressure: [], ripe: [], twb: null }, deltas: [],
  };
}

test('M764-1 HIS DRIVE BY THE GATE: SHE IS ONLY TALKED ABOUT, AND THE READER IS ASKED WHERE SHE IS — the page puts her at her car and her sedan swings for the gate: she is no longer in the scene (seated where the page puts her), not "here" in the camel coat with no place; Marcus Hale, whom the page never names, is not asked and stays (the quiet stay), and Jovan and Vance stand where the page ends them', async () => {
  const st = before();
  const asked = [];
  const was = globalThis.fetch;
  globalThis.fetch = async (_, o) => { const body = JSON.parse(o.body); const user = body.messages.filter((m) => m.role === 'user').map((m) => String(m.content)).join('\n'); asked.push(user); return stream(reader(user)); };
  let read;
  try { read = await extractTurn({ connection: CONN, state: st, userText: 'I call Claire and head out.', assistantText: LATEST, pageNumber: 42 }); } finally { globalThis.fetch = was; }
  const header = headerMutations(LATEST, { ground: st.place.name, day: '' });
  const after = applyMutations(st, [...header, ...read.mutations]).state;
  eq(after.present.map((p) => p.name + (p.position ? '' : ' (no place)')).join(', '), 'Jovan Wessex, Marcus Hale (no place), Deputy Vance', 'who is in the scene');
  assert(after.offscreen && /holly|gate/.test(String(after.offscreen['Vanessa Langley']?.location || '')), 'she is where the page puts her: ' + JSON.stringify(after.offscreen));
  eq(after.present.find((p) => p.name === 'Deputy Vance').position, 'at the gate, holding the log sheet for signatures', 'Vance where the page ends him');
  assert(asked.some((u) => /\n\d+\. Vanessa Langley — the ledger has: on the drive, turning toward her car; wearing camel coat — the page only TALKS about them/.test(u)), 'the reader was asked where she is');
  assert(!asked.some((u) => /\n\d+\. Marcus Hale — the ledger has/.test(u)), 'never one the page does not name');
});
