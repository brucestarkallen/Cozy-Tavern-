/* Cozy Tavern — harness laws of M516: where our story began in its canon (his word: "#story jujutsu kaisen … it confuses
 * every timeline: Yuta abroad, the Zenin clan not destroyed by Maki"). */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { canonStartAsk, readCanonStart, canonStartWords } from '../../js/agents/canonstart.js';
import { buildRequest } from '../../js/assemble/stack.js';
import { CRAFT_TEXT } from '../../js/assemble/craft.js';

const ANSWER = { canon: true, series: 'Jujutsu Kaisen', arc: 'Culling Game arc', moment: 'Kenjaku attacks Tengen\'s barrier; Yuki Tsukumo and Choso stand against him', when: 'December 2018', facts: ['Gojo Satoru is sealed in the Prison Realm since the Shibuya Incident.', 'Yuta Okkotsu is back in Japan and has already fought Ryu Ishigori and Takako Uro in the Sendai Colony.', 'The Zenin clan was wiped out by Maki Zenin after Shibuya.'] };
const wireOf = (r) => [...r.systemBlocks.map((b) => b.text), ...r.messages.map((m) => String(m.content))].join('\n');

test('M516-1 THE QUESTION, ASKED ALONE: which canon, which arc, which moment, and what is true of that world then — the states that changed earlier said as they stand, never anything after the moment, never his own character; his line and brief ride with it', () => {
  const a = canonStartAsk({ concept: 'jujutsu kaisen Jovan Oda… he sees Yuki going to die and parries it', brief: 'An alternate universe.' });
  assert(a.user.includes('he sees Yuki going to die and parries it') && a.user.includes('An alternate universe.'), 'his line and brief');
  assert(/someone who was abroad and has since come back, a clan already wiped\s+out/.test(a.system) && /Never anything that happens AFTER the moment/.test(a.system) && /never describe them/.test(a.system), 'the timestamp rules');
});

test('M516-2 READ STRICTLY, SAID IN HIS VOICE: a placed story becomes "Where our story began in …" with what was true then and the line that nothing after it has happened; "not canon", no series or no moment is nothing; his own correction stands word for word', () => {
  const start = readCanonStart('Here: ' + JSON.stringify(ANSWER) + ' done');
  eq(start.series, 'Jujutsu Kaisen', 'read out of surrounding words');
  const words = canonStartWords(start);
  assert(words.startsWith('Where our story began in Jujutsu Kaisen: Culling Game arc — Kenjaku attacks Tengen\'s barrier; Yuki Tsukumo and Choso stand against him (December 2018).'), words.slice(0, 160));
  assert(words.includes('- Yuta Okkotsu is back in Japan') && words.includes('- The Zenin clan was wiped out by Maki Zenin') && /Nothing in canon after this moment has happened here — from it on, only our own pages decide\.$/.test(words), 'what was true, and the line after');
  eq(readCanonStart('{"canon":false}'), null, 'not canon');
  eq(readCanonStart(JSON.stringify({ canon: true, series: '', moment: 'x' })), null, 'no series');
  eq(canonStartWords({ words: 'His own: the Culling Game, after Sendai.' }), 'His own: the Culling Game, after Sendai.', 'his correction stands');
  eq(canonStartWords({ none: true }), '', 'no canon: nothing');
});

test('M516-3 IT RIDES WITH EVERY PAGE, FOR EVERY STORYTELLER: in the notes beside canon\'s note, on its own row exactly as sent; with none, nothing and the row says why', () => {
  const words = canonStartWords(readCanonStart(JSON.stringify(ANSWER)));
  const msgs = [{ id: 'u1', role: 'user', text: '#story jujutsu kaisen Jovan' }];
  for (const settings of [{}, { tellerName: 'Hulk', writerName: 'Bruce' }, { smallModelNow: true }]) {
    const r = buildRequest({ story: { brief: '' }, messages: msgs, settings, state: null, modules: [{ mod: { id: 'core-craft', name: 'The craft', text: CRAFT_TEXT }, reason: 'always' }], memory: '', window: { keeperOn: false }, canonStart: words });
    assert(wireOf(r).includes(words), 'rides: ' + JSON.stringify(settings));
    const row = r.receipt.slots.find((s) => s.name === 'Where our story began');
    assert(row && row.tokens > 0 && wireOf(r).includes(row.text), 'its own row, as sent');
  }
  const none = buildRequest({ story: {}, messages: msgs, settings: {}, state: null, modules: [], memory: '', window: { keeperOn: false } });
  const row = none.receipt.slots.find((s) => s.name === 'Where our story began');
  assert(row && !row.tokens && /not a story set in an existing canon/.test(row.reason) && !/Where our story began in/.test(wireOf(none)), 'none: nothing, and why');
});
